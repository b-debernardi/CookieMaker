// Geometry runs here so the page stays responsive while a model is built.

import { Arena, loadManifold, type M } from './wasm';
import { Geo } from './ops';
import { buildPieces, prepare } from './build';
import type { BuildRequest, BuildResult, Issue, MeshOut } from './protocol';

const PIECE_GAP = 10;

function toMesh(m: M, name: string, role: MeshOut['role'], dx = 0): MeshOut {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const n = mesh.vertProperties.length / np;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = mesh.vertProperties[i * np] + dx;
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
  }
  return { name, role, positions, indices: new Uint32Array(mesh.triVerts) };
}

async function build(req: BuildRequest): Promise<BuildResult> {
  const t0 = performance.now();
  let w;
  try {
    w = await loadManifold();
  } catch (e) {
    return { id: req.id, ok: false, error: `No se pudo cargar el motor de geometría: ${e}`, meshes: [], issues: [], size: [0, 0, 0], ms: 0 };
  }
  w.setMinCircularAngle(4);
  w.setMinCircularEdgeLength(0.2);
  const arena = new Arena();
  const g = new Geo(w, arena);
  const issues: Issue[] = [];
  try {
    const pr = prepare(g, req.design, req.params, issues);
    if (!pr) {
      return { id: req.id, ok: false, error: 'El diseño está vacío.', meshes: [], issues, size: [0, 0, 0], ms: 0 };
    }
    const pieces = buildPieces(g, pr, req.params, req.piece, issues);

    // Lay pieces side by side, centred on the bed.
    const boxes = pieces.map((pc) => pc.part.boundingBox());
    const widths = boxes.map((b) => b.max[0] - b.min[0]);
    const total = widths.reduce((a, b) => a + b, 0) + PIECE_GAP * (pieces.length - 1);
    let x = -total / 2;
    const meshes: MeshOut[] = [];
    let minY = Infinity, maxY = -Infinity, maxZ = 0;
    pieces.forEach((pc, i) => {
      const b = boxes[i];
      const dx = x - b.min[0];
      const status = pc.part.status();
      if (status !== 'NoError') issues.push({ level: 'error', text: `La malla de ${pc.name} no es válida (${status}).` });
      if (pc.part.isEmpty()) issues.push({ level: 'error', text: `La pieza ${pc.name} quedó vacía.` });
      meshes.push(toMesh(pc.part, pc.name, 'part', dx));
      for (const im of pc.issues) meshes.push(toMesh(im, pc.name, 'issue', dx));
      minY = Math.min(minY, b.min[1]);
      maxY = Math.max(maxY, b.max[1]);
      maxZ = Math.max(maxZ, b.max[2]);
      x += widths[i] + PIECE_GAP;
    });
    const size: [number, number, number] = [total, maxY - minY, maxZ];
    if (pieces.length > 1 && (total > req.params.bedSize || size[1] > req.params.bedSize)) {
      issues.push({ level: 'warn', text: `Las dos piezas juntas no entran en la cama de ${req.params.bedSize} mm; exportalas por separado.` });
    }
    return { id: req.id, ok: true, meshes, issues, size, ms: performance.now() - t0 };
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e), meshes: [], issues, size: [0, 0, 0], ms: 0 };
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
