// The geometric pipeline from the plan: normalise -> clean -> scale to mm ->
// bridges -> cutting wall -> grip base / tapered handle -> relief -> meshes.
//
// Everything is 2.5D: each part is a stack of extruded cross-sections, joined
// with Manifold so the result is always a closed mesh.

import polylabel from 'polylabel';
import type { Design, Pt } from '../input/types';
import type { Params, Piece } from '../model/params';
import { Geo, strokePolys } from './ops';
import { autoBridges, manualBar } from './bridges';
import type { CS, M } from './wasm';
import type { Issue } from './protocol';

const EPS = 1e-3;

export interface Prepared {
  /** Every visible dark area (drawing) in mm, design orientation (+y up). */
  dark: CS;
  /** Outline: dark area with holes filled (or the envelope). */
  outline: CS;
  /** Relief lines in "edges" mode: borders between colours plus strokes. */
  edgeLines: CS;
  /** Separate shapes in the design (laurels, stars around a shield…). */
  shapes: number;
  /** Height / width of the design as built (after "largest only"). */
  aspect: number;
}

/** Separate shapes of an outline, biggest first, ignoring specks. */
function separateShapes(g: Geo, outline: CS, minArea = 0): CS[] {
  const parts = outline.decompose().map((c) => g.keep(c)).sort((a, b) => b.area() - a.area());
  if (!parts.length) return [];
  const min = Math.max(minArea, parts[0].area() * 0.002);
  return parts.filter((c) => c.area() >= min);
}

/** Steps 1–3 of the pipeline: paint the layers, clean, scale to mm. */
export function prepare(g: Geo, d: Design, p: Params, issues: Issue[], piece: Piece = 'cutter'): Prepared | null {
  // Painter's model: each colour is a region; later layers cover earlier ones.
  const fillRegions = new Map<string, CS>();
  const paintRegions = new Map<string, CS>();
  const strokeLines: { lines: Pt[][]; closed: boolean[] }[] = [];
  const paint = (regions: Map<string, CS>, shape: CS, color: string, light: boolean) => {
    for (const [k, r] of regions) regions.set(k, g.sub(r, shape));
    if (!light) regions.set(color, regions.has(color) ? g.union([regions.get(color)!, shape]) : shape);
  };
  for (const l of d.layers) {
    if (l.kind === 'fill') {
      const shape = g.cs(l.contours, l.fillRule);
      paint(fillRegions, shape, l.color, l.light);
      paint(paintRegions, shape, l.color, l.light);
    } else {
      const shape = g.cs(strokePolys(l.lines, l.closed, l.width));
      paint(paintRegions, shape, l.color, l.light);
      strokeLines.push({ lines: l.lines, closed: l.closed });
    }
  }
  let dark0 = g.union([...paintRegions.values()]);
  if (dark0.isEmpty()) return null;

  // Separate shapes: in the cutter + stamp set the user picks what to do
  // with them; "largest only" drops everything but the biggest one here, so
  // the size applies to it.
  const shapes0 = separateShapes(g, g.fillHoles(dark0));
  const shapes = shapes0.length;
  let mask: CS | null = null;
  if (piece === 'set' && p.partsMode === 'largest' && shapes > 1) {
    mask = shapes0[0];
    dark0 = g.inter(dark0, mask);
    for (const regions of [fillRegions, paintRegions]) {
      for (const [k, r] of regions) regions.set(k, g.inter(r, mask));
    }
  }

  // Scale so the design fits the requested size, centred on the origin.
  const bb = dark0.bounds();
  const w = bb.max[0] - bb.min[0], h = bb.max[1] - bb.min[1];
  if (w < EPS || h < EPS) return null;
  let sx: number, sy: number;
  if (p.lockAspect) {
    sx = sy = p.sizeW / w;
  } else {
    sx = p.sizeW / w;
    sy = p.sizeH / h;
  }
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const fx = p.mirror ? -sx : sx;
  const fy = d.yDown ? -sy : sy;
  const tf = (c: CS) => g.simplify(g.keep(g.keep(c.translate([-cx, -cy])).scale([fx, fy])), p.simplifyTol);
  const tp = (pt: Pt): Pt => [(pt[0] - cx) * fx, (pt[1] - cy) * fy];

  const dark = tf(dark0);
  let outline = g.fillHoles(dark);
  if (p.envelope !== 'none') outline = envelope(g, outline, p);

  // Edge lines: a band of lineWidth centred on every border between regions.
  const lw = p.lineWidth;
  const bands: CS[] = [];
  for (const r of fillRegions.values()) {
    if (r.isEmpty()) continue;
    const rr = tf(r);
    bands.push(g.sub(g.offset(rr, lw / 2), g.offset(rr, -lw / 2)));
  }
  for (const s of strokeLines) {
    const lines = s.lines.map((l) => l.map(tp));
    bands.push(g.cs(strokePolys(lines, s.closed, lw)));
  }
  let edgeLines = g.union(bands);
  if (mask) edgeLines = g.inter(edgeLines, g.offset(tf(mask), lw));

  if (sx * w > p.bedSize || sy * h > p.bedSize) {
    issues.push({ level: 'error', text: `El diseño no entra en la cama de ${p.bedSize} mm.` });
  }
  return { dark, outline, edgeLines, shapes, aspect: h / w };
}

function envelope(g: Geo, outline: CS, p: Params): CS {
  const pad = p.envelopePad;
  if (p.envelope === 'hull') return g.offset(g.keep(outline.hull()), pad);
  const bb = outline.bounds();
  if (p.envelope === 'rect') {
    const r = Math.min(3, pad + 1);
    const rect = g.cs([[
      [bb.min[0] - pad + r, bb.min[1] - pad + r],
      [bb.max[0] + pad - r, bb.min[1] - pad + r],
      [bb.max[0] + pad - r, bb.max[1] + pad - r],
      [bb.min[0] - pad + r, bb.max[1] + pad - r],
    ]]);
    return g.offset(rect, r);
  }
  // Circle around the centre of the bounding box.
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  let rmax = 0;
  for (const poly of g.polys(outline)) for (const [x, y] of poly) rmax = Math.max(rmax, Math.hypot(x - cx, y - cy));
  return g.keep(g.keep(g.w.CrossSection.circle(rmax + pad, 128)).translate([cx, cy]));
}

/** Parts thinner than `w`, ignoring the specks every sharp corner leaves. */
function thinParts(g: Geo, a: CS, w: number): CS[] {
  // Drop the hairline slivers a slightly uneven edge leaves behind, or a
  // line that is wide enough gets thickened in beads along its sides.
  const rest = g.open(g.sub(a, g.open(a, w * 0.98)), Math.min(0.1, w * 0.2));
  if (rest.isEmpty()) return [];
  return rest.decompose().map((c) => g.keep(c)).filter((c) => c.area() > w * w * 0.6);
}

interface Relief {
  lines: CS;
  thin: CS[];
}

/** Relief region shared by the imprint cutter and the stamp. */
function relief(g: Geo, pr: Prepared, p: Params, issues: Issue[]): Relief {
  let L = p.reliefMode === 'fill' ? pr.dark : pr.edgeLines;
  if (p.reliefMode === 'edges' && !p.eraseBorder) {
    // The outer border line sits fully inside the outline, not half outside.
    L = g.union([g.inter(L, pr.outline), g.sub(pr.outline, g.offset(pr.outline, -p.lineWidth))]);
  }
  if (p.invertRelief) L = g.sub(pr.outline, L);
  if (p.eraseBorder) {
    const band = Math.max(p.lineWidth, 1);
    L = g.sub(L, g.sub(pr.outline, g.offset(pr.outline, -band)));
  }
  if (p.imprintThickness) L = g.offset(L, p.imprintThickness);
  L = g.inter(L, pr.outline);
  const w = p.minThickness;
  let thin = thinParts(g, L, w);
  if (thin.length && p.forceMinThickness) {
    const fixed = g.inter(g.union([L, ...thin.map((t) => g.offset(t, w / 2))]), pr.outline);
    // Drop leftovers that still can't be printed (dust from tiny details).
    const parts = fixed.decompose().map((c) => g.keep(c));
    const keep = parts.filter((c) => c.area() >= w * w);
    const dropped = parts.length - keep.length;
    issues.push({
      level: 'info',
      text: `Se engrosaron ${thin.length} ${thin.length === 1 ? 'línea fina' : 'líneas finas'} a ${w} mm` +
        (dropped ? ` y se descartaron ${dropped} ${dropped === 1 ? 'detalle' : 'detalles'} demasiado chicos.` : '.'),
    });
    L = g.union(keep);
    thin = [];
  } else if (thin.length) {
    issues.push({
      level: 'warn',
      text: `${thin.length} ${thin.length === 1 ? 'zona del relieve es más fina' : 'zonas del relieve son más finas'} que ${w} mm (en rojo).`,
    });
  }
  return { lines: L, thin };
}

export interface PieceOut {
  name: string;
  part: M;
  issues: M[];
  /** Printed nested in the previous piece, so it keeps its position. */
  inPlace?: boolean;
}

interface CutterOut extends PieceOut {
  /** Everything the cutter occupies seen from above (walls, base, bars). */
  keepOut: CS;
}

/** Cutter or imprint cutter, built base-down and mirrored for printing. */
function buildCutter(g: Geo, R: CS, p: Params, rel: Relief | null, issues: Issue[]): CutterOut {
  const t = p.bladeThickness;
  const H = p.baseHeight + p.bladeDepth;
  const outward = !p.bladeInside;
  const wallAt = (th: number) => (outward ? g.sub(g.offset(R, th), R) : g.sub(R, g.offset(R, -th)));
  const wallOuter = outward ? g.offset(R, t) : R;
  const wallInner = outward ? R : g.offset(R, -t);
  const solids: (M | null)[] = [];

  // Cutting wall, with the sharp edge as thin slices tapering to the tip.
  const ch = p.tipWidth < t ? Math.min(p.chamferHeight, p.bladeDepth) : 0;
  solids.push(g.extrude(wallAt(t), 0, H - ch));
  if (ch > 0) {
    const n = Math.max(2, Math.ceil(ch / 0.1));
    for (let i = 0; i < n; i++) {
      const z0 = H - ch + (ch * i) / n, z1 = H - ch + (ch * (i + 1)) / n;
      const f = (i + 0.5) / n;
      solids.push(g.extrude(wallAt(t + (p.tipWidth - t) * f), z0, z1));
    }
  }
  if (p.extraThickness > 0) {
    const top = Math.min(p.baseHeight + p.extraDepth, H - ch);
    solids.push(g.extrude(wallAt(t + p.extraThickness), 0, top));
  }

  // Grip base, with an optional rounded or chamfered top edge.
  const baseRing = (inset: number) => {
    const out = g.offset(wallOuter, p.baseWidth - inset);
    const inn = p.baseSymmetric ? g.offset(wallInner, -(p.baseWidth - inset)) : wallInner;
    return g.sub(out, inn);
  };
  const bh = p.baseHeight;
  if (p.baseShape === 'rect' || p.baseWidth <= 0) {
    solids.push(g.extrude(baseRing(0), 0, bh));
  } else {
    const r = Math.min(p.baseWidth, bh) * 0.8;
    solids.push(g.extrude(baseRing(0), 0, bh - r));
    const n = Math.max(3, Math.ceil(r / 0.15));
    for (let i = 0; i < n; i++) {
      const z0 = bh - r + (r * i) / n, z1 = bh - r + (r * (i + 1)) / n;
      const u = ((i + 0.5) / n) * r; // height into the profile
      const inset = p.baseShape === 'chamfer' ? u : r - Math.sqrt(Math.max(0, r * r - u * u));
      solids.push(g.extrude(baseRing(inset), z0, z1));
    }
  }

  // Imprint: support floor and relief lines inside the cutting region.
  let reliefLines: CS | null = null;
  let floor: CS | null = null;
  let reliefTop = bh;
  const manual = p.manualBridges.map((b) => manualBar(g, { ...b, width: b.width || p.bridgeWidth }, g.offset(wallOuter, p.baseWidth)));
  if (rel) {
    reliefLines = g.inter(rel.lines, R);
    if (p.solidBridges && manual.length) reliefLines = g.sub(reliefLines, g.union(manual));
    reliefTop = Math.max(bh, H - p.imprintDepth);
    if (!p.removeFloor) floor = g.inter(g.offset(reliefLines, p.floorWidth), R);
    if (floor) solids.push(g.extrude(floor, 0, bh));
    solids.push(g.extrude(reliefLines, 0, reliefTop));
  }

  // Bridges: manual bars, then automatic ones for anything still loose.
  let footprint = g.union([baseRing(0), wallAt(t), ...(floor ? [floor] : []), ...(reliefLines ? [reliefLines] : []), ...manual]);
  const bars: CS[] = [...manual];
  if (p.autoBridges) {
    const auto = autoBridges(g, footprint, p.bridgeWidth);
    if (auto.count) {
      issues.push({ level: 'info', text: `Se agregaron ${auto.count} ${auto.count === 1 ? 'puente' : 'puentes'} para unir partes sueltas.` });
      bars.push(...auto.bars);
      footprint = g.union([footprint, ...auto.bars]);
    }
  }
  if (bars.length) solids.push(g.extrude(g.union(bars), 0, bh));
  const loose = footprint.decompose().map((c) => g.keep(c)).length;
  if (loose > 1) {
    issues.push({ level: 'warn', text: `El cortador tiene ${loose} partes sueltas. Activá los puentes automáticos o agregá uno manual.` });
  }

  const mirror = (m: M) => g.keep(m.mirror([1, 0, 0]));
  const part = mirror(g.munion(solids));
  const issueSolids: M[] = [];
  if (rel?.thin.length && reliefLines) {
    for (const th of rel.thin) {
      const m = g.extrude(g.offset(th, 0.15), reliefTop, reliefTop + 0.3);
      if (m) issueSolids.push(mirror(m));
    }
  }
  const keepOut = g.union([footprint, wallAt(Math.max(t, p.tipWidth, t + p.extraThickness))]);
  return { name: rel ? 'imprint' : 'cortador', part, issues: issueSolids, keepOut };
}

/**
 * Stamp for the cutter + stamp set: a flat plate printed inside the cutter,
 * with the relief on top. It shares the cutter's mirrored frame, so when the
 * cutter is flipped to cut, the relief faces the dough and reads right.
 */
function buildInsetStamp(g: Geo, R: CS, cutter: CutterOut, p: Params, rel: Relief, issues: Issue[]): PieceOut {
  // Plate: the cutting region minus the cutter (walls and any bars across
  // the inside) grown by the clearance.
  const gap = Math.max(0, p.setClearance);
  const raw = g.sub(R, g.offset(cutter.keepOut, gap));
  const minArea = Math.max(4, p.minThickness * p.minThickness * 4);
  const parts = g.open(raw, Math.min(0.4, p.minThickness / 2)).decompose().map((c) => g.keep(c)).filter((c) => c.area() >= minArea);
  if (!parts.length) {
    throw new Error('La holgura con el cortador es mayor que la forma: el sello quedaría vacío.');
  }
  const So = g.union(parts);
  if (parts.length > 1) {
    issues.push({ level: 'info', text: `El sello quedó en ${parts.length} partes para no chocar con las paredes o puentes del cortador.` });
  }

  const Ls = g.open(g.inter(rel.lines, So), Math.min(0.4, p.minThickness / 2));
  let d = p.reliefDepth;
  if (Ls.isEmpty()) {
    issues.push({ level: 'warn', text: 'El sello no tiene relieve: todas las líneas caen sobre bordes que corta el cortador.' });
    d = 0;
  }
  let back = p.backing;
  if (d < 0 && back <= -d) {
    issues.push({ level: 'error', text: 'La placa tiene que ser más gruesa que el hundido; se ajustó a hundido + 1 mm.' });
    back = -d + 1;
  }

  const solids: (M | null)[] = [];
  // The plate sits on the bed, so the elephant foot compensation goes there.
  const ef = p.efComp ? Math.min(p.efAmount, 0.6) : 0;
  if (ef > 0 && back > 0.4) {
    solids.push(g.extrude(g.offset(So, -ef / 2), 0, 0.2));
    solids.push(g.extrude(So, 0.2, back));
  } else {
    solids.push(g.extrude(So, 0, back));
  }
  let part: M;
  if (d >= 0) {
    solids.push(g.extrude(Ls, back, back + d));
    part = g.munion(solids);
  } else {
    const sunk = g.extrude(Ls, back + d, back + 1);
    const plate = g.munion(solids);
    part = sunk ? g.keep(plate.subtract(sunk)) : plate;
  }

  const top = back + Math.max(0, d);
  const H = p.baseHeight + p.bladeDepth;
  if (top > H) {
    issues.push({ level: 'warn', text: `El sello (${top.toFixed(1)} mm) es más alto que el cortador (${H.toFixed(1)} mm).` });
  }

  const mirror = (m: M) => g.keep(m.mirror([1, 0, 0]));
  const issueSolids: M[] = [];
  for (const th of rel.thin) {
    const m = g.extrude(g.offset(g.inter(th, So), 0.15), top + 0.05, top + 0.35);
    if (m) issueSolids.push(mirror(m));
  }
  return { name: 'sello', part: mirror(part), issues: issueSolids, inPlace: true };
}

/** Stamp with an integrated tapered handle, built face-down. */
function buildStamp(g: Geo, R: CS, p: Params, rel: Relief, issues: Issue[]): PieceOut {
  let So = g.offset(R, -p.clearance);
  if (So.isEmpty()) {
    throw new Error('La holgura es mayor que la forma: el sello quedaría vacío.');
  }
  // Clipping to the stamp leaves slivers along its edge; drop them.
  const Ls = g.open(g.inter(rel.lines, So), Math.min(0.4, p.minThickness / 2));
  let d = p.reliefDepth;
  if (Ls.isEmpty()) {
    issues.push({ level: 'warn', text: 'El sello no tiene relieve: todas las líneas caen sobre bordes que corta el cortador.' });
    d = 0;
  }
  let back = p.backing;
  const solids: (M | null)[] = [];
  let top: number;

  // Separate parts (letters, for example) share one backing through bars.
  const parts = So.decompose().map((c) => g.keep(c));
  if (parts.length > 1) {
    const auto = autoBridges(g, So, Math.max(3, p.bridgeWidth * 2));
    So = g.union([So, ...auto.bars]);
  }

  if (d >= 0) {
    const ef = p.efComp ? Math.min(p.efAmount, 0.6) : 0;
    if (ef > 0 && d > 0.2) {
      solids.push(g.extrude(g.offset(Ls, -ef / 2), 0, 0.2));
      solids.push(g.extrude(Ls, 0.2, d));
    } else {
      solids.push(g.extrude(Ls, 0, d));
    }
    solids.push(g.extrude(So, d, d + back));
    top = d + back;
  } else {
    if (back <= -d) {
      issues.push({ level: 'error', text: 'El respaldo tiene que ser más grueso que el hundido; se ajustó a hundido + 1 mm.' });
      back = -d + 1;
    }
    const plate = g.extrude(So, 0, back)!;
    const sunk = g.extrude(Ls, -1, -d);
    solids.push(sunk ? g.keep(plate.subtract(sunk)) : plate);
    top = back;
  }

  // Tapered tower: a truncated cone on the largest inscribed circle.
  const { c, rin } = towerSpot(g, So, p);
  const H = p.towerHeight;
  const tan = Math.tan((p.taperAngle * Math.PI) / 180);
  let rTop = p.capDiameter / 2;
  let rBot = rTop + H * tan;
  let rf = p.filletRadius;
  const limit = rin - 0.2;
  if (rBot + rf > limit) {
    rf = Math.max(0, limit - rBot);
    if (rBot > limit) {
      rBot = Math.max(1, limit);
      rTop = Math.max(1, Math.min(rTop, rBot - H * tan));
    }
    issues.push({ level: 'info', text: `El mango se achicó para entrar en la forma (base de ${(rBot * 2).toFixed(1)} mm).` });
  }
  const segs = 96;
  solids.push(g.keep(g.keep(g.w.Manifold.cylinder(H, rBot, rTop, segs)).translate([c[0], c[1], top])));
  if (rf > 0.05) {
    const coneR = (z: number) => rBot - (rBot - rTop) * (z / H);
    const n = Math.max(3, Math.ceil(rf / 0.15));
    for (let i = 0; i < n; i++) {
      const z0 = (rf * i) / n, z1 = (rf * (i + 1)) / n, zm = (z0 + z1) / 2;
      const r = coneR(zm) + rf - Math.sqrt(Math.max(0, rf * rf - (rf - zm) * (rf - zm)));
      solids.push(g.keep(g.keep(g.w.Manifold.cylinder(z1 - z0, r, r, segs)).translate([c[0], c[1], top + z0])));
    }
  }

  const issueSolids: M[] = [];
  for (const th of rel.thin) {
    const m = g.extrude(g.offset(g.inter(th, So), 0.15), -0.35, -0.05);
    if (m) issueSolids.push(m);
  }
  return { name: 'sello', part: g.munion(solids), issues: issueSolids };
}

function towerSpot(g: Geo, So: CS, p: Params): { c: Pt; rin: number } {
  const parts = So.decompose().map((x) => g.keep(x));
  const biggest = parts.reduce((a, b) => (b.area() > a.area() ? b : a));
  const polys = g.polys(biggest);
  const outer = polys.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a));
  const rings = [outer, ...polys.filter((x) => x !== outer)];
  if (p.towerAuto) {
    const pt = polylabel(rings as any, 0.05) as unknown as Pt & { distance: number };
    return { c: [pt[0], pt[1]], rin: pt.distance };
  }
  const bb = So.bounds();
  const c: Pt = [
    bb.min[0] + ((bb.max[0] - bb.min[0]) * p.towerX) / 100,
    bb.min[1] + ((bb.max[1] - bb.min[1]) * p.towerY) / 100,
  ];
  let rin = Infinity;
  for (const poly of g.polys(So)) {
    for (let i = 0; i < poly.length; i++) rin = Math.min(rin, segDist(c, poly[i] as Pt, poly[(i + 1) % poly.length] as Pt));
  }
  const inside = !g.inter(So, g.cs([[[c[0] - 0.01, c[1] - 0.01], [c[0] + 0.01, c[1] - 0.01], [c[0] + 0.01, c[1] + 0.01], [c[0] - 0.01, c[1] + 0.01]]])).isEmpty();
  return { c, rin: inside ? rin : 1 };
}

function area(p: Pt[]): number {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return s / 2;
}

function segDist(q: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}

/**
 * One solid silhouette around every part of the design (a logo with laurels
 * and stars around it, for example), so a stamp gets a single full plate and
 * the parts become relief on it. Closes the gaps with growing radii and falls
 * back to the convex hull.
 */
function mergeParts(g: Geo, outline: CS, p: Params, issues: Issue[]): CS {
  const parts = separateShapes(g, outline, 1);
  if (parts.length <= 1) return outline;
  const all = g.union(parts);
  // Start wide enough to fill the slits between, say, a laurel and the shield,
  // not just to connect the parts by a thin neck.
  const bb = all.bounds();
  const r0 = Math.max(2, 0.1 * Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]));
  for (const r of [r0, r0 * 2, r0 * 4]) {
    const closed = g.simplify(g.fillHoles(g.offset(g.offset(all, r), -r)), Math.max(p.simplifyTol, 0.05));
    if (closed.decompose().map((c) => g.keep(c)).filter((c) => c.area() >= 1).length === 1) {
      issues.push({ level: 'info', text: `Las ${parts.length} partes del diseño se unieron en una sola placa; el detalle queda en relieve.` });
      return closed;
    }
  }
  issues.push({ level: 'info', text: `Las ${parts.length} partes del diseño están muy separadas; se unieron con su contorno convexo.` });
  return g.keep(all.hull());
}

/** Cutter + stamp set, following the chosen way to handle separate shapes. */
function buildSet(g: Geo, pr: Prepared, cutRegion: CS, p: Params, issues: Issue[]): PieceOut[] {
  const several = pr.shapes > 1 && p.envelope === 'none';
  if (several && p.partsMode === 'outline') {
    // One silhouette around everything; the rest becomes relief.
    const merged = mergeParts(g, pr.outline, p, issues);
    const prm = { ...pr, outline: merged };
    const R = merged;
    const cutter = buildCutter(g, R, p, null, issues);
    const stamp = buildInsetStamp(g, R, cutter, p, relief(g, prm, p, issues), issues);
    issues.push({ level: 'info', text: 'El sello se imprime adentro del cortador, con el relieve hacia arriba.' });
    return [cutter, stamp];
  }
  if (several && p.partsMode === 'set') {
    // A cutter with its stamp for every shape, laid out side by side.
    const rel = relief(g, pr, p, issues);
    const out: PieceOut[] = [];
    const shapes = separateShapes(g, pr.outline, 2);
    let skipped = 0;
    shapes.forEach((shape, i) => {
      const R = g.inter(cutRegion, shape);
      const local: Issue[] = [];
      const cutter = buildCutter(g, R, p, null, local);
      cutter.name = `cortador ${i + 1}`;
      out.push(cutter);
      try {
        const stamp = buildInsetStamp(g, R, cutter, p, rel, local);
        stamp.name = `sello ${i + 1}`;
        out.push(stamp);
      } catch {
        skipped++;
      }
      for (const it of local) if (!issues.some((x) => x.text === it.text)) issues.push(it);
    });
    issues.push({ level: 'info', text: `Se armó un set de ${shapes.length} cortadores, cada uno con su sello adentro.` });
    if (skipped) {
      issues.push({ level: 'info', text: `${skipped} ${skipped === 1 ? 'forma es muy chica' : 'formas son muy chicas'} para llevar sello; ${skipped === 1 ? 'queda' : 'quedan'} solo con cortador.` });
    }
    return out;
  }
  const cutter = buildCutter(g, cutRegion, p, null, issues);
  const stamp = buildInsetStamp(g, cutRegion, cutter, p, relief(g, pr, p, issues), issues);
  issues.push({ level: 'info', text: 'El sello se imprime adentro del cortador, con el relieve hacia arriba.' });
  return [cutter, stamp];
}

export function buildPieces(g: Geo, pr0: Prepared, p: Params, piece: Piece, issues: Issue[]): PieceOut[] {
  const merge = p.mergeParts && p.envelope === 'none' && piece === 'stamp';
  const pr = merge ? { ...pr0, outline: mergeParts(g, pr0.outline, p, issues) } : pr0;
  const cutRegion = p.cutMode === 'holes' && p.envelope === 'none' ? pr.dark : pr.outline;
  if (p.bladeThickness < p.minThickness) {
    issues.push({ level: 'warn', text: `La pared de corte (${p.bladeThickness} mm) es más fina que el mínimo de ${p.minThickness} mm.` });
  }
  if (p.bridgeWidth < 1.2) {
    issues.push({ level: 'warn', text: 'Puentes de menos de 1.2 mm pueden romperse.' });
  }
  if (piece !== 'stamp') {
    issues.push({ level: 'info', text: 'El cortador se ve espejado porque se imprime con la base abajo: al darlo vuelta para cortar queda al derecho.' });
  }
  switch (piece) {
    case 'cutter':
      return [buildCutter(g, cutRegion, p, null, issues)];
    case 'imprint':
      if (p.edgesOnly) {
        // Every edge cuts: the drawing's own areas become the cutting region.
        return [buildCutter(g, pr.dark, p, null, issues)];
      }
      return [buildCutter(g, cutRegion, p, relief(g, pr, p, issues), issues)];
    case 'stamp':
      return [buildStamp(g, pr.outline, p, relief(g, pr, p, issues), issues)];
    case 'set':
      return buildSet(g, pr, cutRegion, p, issues);
  }
}
