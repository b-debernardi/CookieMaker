// Geometry runs here so the page stays responsive while a model is built.

import { Arena, loadManifold, type M } from './wasm';
import { Geo } from './ops';
import { buildPieces, prepare } from './build';
import type { BuildRequest, BuildResult, Issue, MeshOut } from './protocol';

const PIECE_GAP = 10;

function toMesh(m: M, name: string, role: MeshOut['role'], dx = 0, dy = 0): MeshOut {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const n = mesh.vertProperties.length / np;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = mesh.vertProperties[i * np] + dx;
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1] + dy;
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
  }
  return { name, role, positions, indices: new Uint32Array(mesh.triVerts) };
}

interface Slot { pieces: number[]; x0: number; x1: number; y0: number; y1: number; dx: number; dy: number }

async function build(req: BuildRequest): Promise<BuildResult> {
  const t0 = performance.now();
  const fail = (error: string, issues: Issue[] = []): BuildResult =>
    ({ id: req.id, ok: false, error, meshes: [], issues, size: [0, 0, 0], shapes: 0, aspect: 1, ms: 0 });
  let w;
  try {
    w = await loadManifold();
  } catch (e) {
    return fail(`No se pudo cargar el motor de geometría: ${e}`);
  }
  w.setMinCircularAngle(4);
  w.setMinCircularEdgeLength(0.2);
  const arena = new Arena();
  const g = new Geo(w, arena);
  const issues: Issue[] = [];
  try {
    const pr = prepare(g, req.design, req.params, issues, req.piece);
    if (!pr) return fail('El diseño está vacío.', issues);
    const pieces = buildPieces(g, pr, req.params, req.piece, issues);

    // Group each piece with the ones printed inside it, then lay the groups
    // out in rows that fit the bed, centred on it.
    const boxes = pieces.map((pc) => pc.part.boundingBox());
    const slots: Slot[] = [];
    pieces.forEach((pc, i) => {
      const b = boxes[i];
      const last = slots[slots.length - 1];
      if (pc.inPlace && last) {
        last.pieces.push(i);
        last.x0 = Math.min(last.x0, b.min[0]);
        last.x1 = Math.max(last.x1, b.max[0]);
        last.y0 = Math.min(last.y0, b.min[1]);
        last.y1 = Math.max(last.y1, b.max[1]);
      } else {
        slots.push({ pieces: [i], x0: b.min[0], x1: b.max[0], y0: b.min[1], y1: b.max[1], dx: 0, dy: 0 });
      }
    });
    const bed = req.params.bedSize;
    const rowMax = Math.max(bed - PIECE_GAP, ...slots.map((s) => s.x1 - s.x0));
    let x = 0, y = 0, rowH = 0;
    for (const s of slots) {
      const sw = s.x1 - s.x0, sh = s.y1 - s.y0;
      if (x > 0 && x + sw > rowMax) {
        y -= rowH + PIECE_GAP;
        x = 0;
        rowH = 0;
      }
      s.dx = x - s.x0;
      s.dy = y - s.y1;
      x += sw + PIECE_GAP;
      rowH = Math.max(rowH, sh);
    }
    const minX = Math.min(...slots.map((s) => s.x0 + s.dx)), maxX = Math.max(...slots.map((s) => s.x1 + s.dx));
    const minY = Math.min(...slots.map((s) => s.y0 + s.dy)), maxY = Math.max(...slots.map((s) => s.y1 + s.dy));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const meshes: MeshOut[] = [];
    let maxZ = 0;
    for (const s of slots) {
      for (const i of s.pieces) {
        const pc = pieces[i];
        const status = pc.part.status();
        if (status !== 'NoError') issues.push({ level: 'error', text: `La malla de ${pc.name} no es válida (${status}).` });
        if (pc.part.isEmpty()) issues.push({ level: 'error', text: `La pieza ${pc.name} quedó vacía.` });
        meshes.push(toMesh(pc.part, pc.name, 'part', s.dx - cx, s.dy - cy));
        for (const im of pc.issues) meshes.push(toMesh(im, pc.name, 'issue', s.dx - cx, s.dy - cy));
        for (const md of pc.mods ?? []) {
          meshes.push({ ...toMesh(md.m, pc.name, 'modifier', s.dx - cx, s.dy - cy), mod: md.index, mirrored: md.mirrored });
        }
        maxZ = Math.max(maxZ, boxes[i].max[2]);
      }
    }
    const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ];
    if (slots.length > 1 && (size[0] > bed || size[1] > bed)) {
      issues.push({ level: 'warn', text: `Las piezas juntas no entran en la cama de ${bed} mm; exportalas por separado.` });
    }
    return { id: req.id, ok: true, meshes, issues, size, shapes: pr.shapes, aspect: pr.aspect, ms: performance.now() - t0 };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), issues);
  } finally {
    arena.free();
  }
}

self.onmessage = async (ev: MessageEvent<BuildRequest>) => {
  const res = await build(ev.data);
  const transfer: Transferable[] = [];
  for (const m of res.meshes) transfer.push(m.positions.buffer, m.indices.buffer);
  (self as unknown as Worker).postMessage(res, transfer);
};
