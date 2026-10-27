// Bridges: bars that tie loose parts (islands) to the rest of the piece.

import type { Pt } from '../input/types';
import type { CS } from './wasm';
import { type Geo, segmentRect } from './ops';
import type { ManualBridge } from '../model/params';

/** Contour points of a cross-section, densified so no gap exceeds `step`. */
function samplePoints(polys: Pt[][], step: number): Pt[] {
  const out: Pt[] = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  return out;
}

class Grid {
  private cells = new Map<string, { p: Pt; comp: number }[]>();
  constructor(private size: number) {}
  private key(x: number, y: number) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
  }
  add(p: Pt, comp: number) {
    const k = this.key(p[0], p[1]);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push({ p, comp });
  }
  /** Nearest stored point to q, searching outward ring by ring. */
  nearest(q: Pt, maxRings = 400): { p: Pt; comp: number; d: number } | null {
    const cx = Math.floor(q[0] / this.size), cy = Math.floor(q[1] / this.size);
    let best: { p: Pt; comp: number; d: number } | null = null;
    for (let r = 0; r <= maxRings; r++) {
      for (let x = cx - r; x <= cx + r; x++) {
        for (let y = cy - r; y <= cy + r; y++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          const c = this.cells.get(`${x},${y}`);
          if (!c) continue;
          for (const e of c) {
            const d = Math.hypot(e.p[0] - q[0], e.p[1] - q[1]);
            if (!best || d < best.d) best = { ...e, d };
          }
        }
      }
      // Anything in ring r+1 is at least r*size away.
      if (best && (best as { d: number }).d <= r * this.size) break;
    }
    return best;
  }
}

/**
 * Connects every separate part of `footprint` to the largest one with the
 * shortest possible bars (Prim's algorithm over contour points).
 */
export function autoBridges(g: Geo, footprint: CS, width: number): { bars: CS[]; count: number } {
  const comps = footprint.decompose().map((c) => g.keep(c));
  if (comps.length <= 1) return { bars: [], count: 0 };
  const pts = comps.map((c) => samplePoints(g.polys(c), 0.5));
  const areas = comps.map((c) => c.area());
  const main = areas.indexOf(Math.max(...areas));
  const grid = new Grid(2);
  const connected = new Set<number>([main]);
  for (const p of pts[main]) grid.add(p, main);
  const bars: Pt[][] = [];
  while (connected.size < comps.length) {
    let best: { from: Pt; to: Pt; comp: number; d: number } | null = null;
    for (let i = 0; i < comps.length; i++) {
      if (connected.has(i)) continue;
      const list = pts[i];
      const stride = Math.max(1, Math.floor(list.length / 600));
      for (let k = 0; k < list.length; k += stride) {
        const n = grid.nearest(list[k]);
        if (n && (!best || n.d < best.d)) best = { from: list[k], to: n.p, comp: i, d: n.d };
      }
    }
    if (!best) break;
    // Refine around the coarse match using every point of that part.
    for (const q of pts[best.comp]) {
      if (Math.hypot(q[0] - best.from[0], q[1] - best.from[1]) > 6) continue;
      const n = grid.nearest(q);
      if (n && n.d < best.d) best = { ...best, from: q, to: n.p, d: n.d };
    }
    const rect = segmentRect(best.from, best.to, width, width);
    if (rect) bars.push(rect);
    connected.add(best.comp);
    for (const p of pts[best.comp]) grid.add(p, best.comp);
  }
  return { bars: bars.map((b) => g.cs([b])), count: bars.length };
}

/** A full-width bar across the design, clipped to `limit`. */
export function manualBar(g: Geo, b: ManualBridge, limit: CS): CS {
  const bb = limit.bounds();
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const w = bb.max[0] - bb.min[0], h = bb.max[1] - bb.min[1];
  const t = (b.angle * Math.PI) / 180;
  const ux = Math.cos(t), uy = Math.sin(t);
  const nx = -uy, ny = ux;
  const span = Math.abs(nx) * w + Math.abs(ny) * h;
  const off = ((b.pos - 50) / 100) * span;
  const px = cx + nx * off, py = cy + ny * off;
  const L = w + h;
  const rect = segmentRect([px - ux * L, py - uy * L], [px + ux * L, py + uy * L], b.width)!;
  return g.inter(g.cs([rect]), limit);
}
