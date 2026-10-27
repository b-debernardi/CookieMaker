// Builds every piece for each test design and checks the meshes are valid,
// closed, the right size, and that a stamp printed inside its cutter never
// touches it.

import { beforeAll, describe, expect, it } from 'vitest';
import { Arena, loadManifold, type Wasm } from '../src/geometry/wasm';
import { Geo } from '../src/geometry/ops';
import { buildPieces, prepare } from '../src/geometry/build';
import { runBuild } from '../src/geometry/run';
import type { Issue, MeshOut } from '../src/geometry/protocol';
import { DEFAULTS, cloneParams, type PartsMode, type Piece } from '../src/model/params';
import { DESIGNS } from './designs';

const PIECES: Piece[] = ['cutter', 'imprint', 'stamp', 'set'];
let w: Wasm;

beforeAll(async () => {
  w = await loadManifold();
  w.setMinCircularAngle(4);
  w.setMinCircularEdgeLength(0.2);
});

/** Every edge of a closed mesh is shared by exactly two triangles, once in each direction. */
function isClosed(m: MeshOut): boolean {
  const edges = new Map<string, number>();
  const I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = I[t + k], b = I[t + ((k + 1) % 3)];
      const key = `${a},${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of edges) {
    const [a, b] = key.split(',');
    if (n !== 1 || edges.get(`${b},${a}`) !== 1) return false;
  }
  return edges.size > 0;
}

/** Builds with prepare/buildPieces directly and checks pieces printed in place don't collide. */
function expectNoCollision(name: string, piece: Piece, params = cloneParams(DEFAULTS)) {
  const arena = new Arena();
  try {
    const g = new Geo(w, arena);
    const issues: Issue[] = [];
    const pr = prepare(g, DESIGNS[name], params, issues, piece);
    expect(pr).not.toBeNull();
    const out = buildPieces(g, pr!, params, piece, issues);
    expect(out.length).toBeGreaterThan(0);
    for (let k = 0; k < out.length; k++) {
      expect(out[k].part.status()).toBe('NoError');
      expect(out[k].part.isEmpty()).toBe(false);
      if (k === 0 || !out[k].inPlace) continue;
      const overlap = arena.keep(out[k - 1].part.intersect(out[k].part));
      expect(overlap.volume(), `${out[k].name} choca con ${out[k - 1].name}`).toBeLessThan(1e-3);
    }
  } finally {
    arena.free();
  }
}

describe('runBuild', () => {
  for (const name of Object.keys(DESIGNS)) {
    for (const piece of PIECES) {
      for (const cutMode of ['outline', 'holes'] as const) {
        it(`${name} / ${piece} / ${cutMode}`, () => {
          const params = { ...cloneParams(DEFAULTS), cutMode, baseShape: 'round' as const };
          const r = runBuild(w, { id: 1, design: DESIGNS[name], params, piece });
          expect(r.ok, r.error).toBe(true);
          expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
          const parts = r.meshes.filter((m) => m.role === 'part');
          expect(parts.length).toBeGreaterThan(0);
          for (const m of parts) expect(isClosed(m), `${m.name} tiene agujeros`).toBe(true);
          // Fits the bed and is never smaller than the requested size on its longest side.
          const longest = Math.max(r.size[0], r.size[1]);
          expect(longest).toBeLessThanOrEqual(params.bedSize);
          expect(longest).toBeGreaterThan(Math.max(params.sizeW, params.sizeH) * 0.9);
          expect(r.size[2]).toBeGreaterThan(0);
        });
      }
    }
  }

  it('reports an empty design instead of throwing', () => {
    const r = runBuild(w, { id: 7, design: { source: 'svg', yDown: true, layers: [] }, params: cloneParams(DEFAULTS), piece: 'cutter' });
    expect(r.ok).toBe(false);
    expect(r.id).toBe(7);
    expect(r.error).toMatch(/vacío/);
  });

  it('cutter height follows the blade depth', () => {
    const lo = runBuild(w, { id: 1, design: DESIGNS.star, params: { ...cloneParams(DEFAULTS), bladeDepth: 10 }, piece: 'cutter' });
    const hi = runBuild(w, { id: 2, design: DESIGNS.star, params: { ...cloneParams(DEFAULTS), bladeDepth: 20 }, piece: 'cutter' });
    expect(hi.size[2] - lo.size[2]).toBeCloseTo(10, 0);
  });
});

describe('stamp inside cutter', () => {
  for (const name of Object.keys(DESIGNS)) {
    it(`${name}: the stamp does not touch the cutter`, () => expectNoCollision(name, 'set'));
  }
  for (const partsMode of ['largest', 'outline', 'set'] as PartsMode[]) {
    it(`logo with separate shapes, mode ${partsMode}`, () => {
      expectNoCollision('logo', 'set', { ...cloneParams(DEFAULTS), partsMode });
    });
  }
});

describe('degenerate input', () => {
  it('a design with only tiny contours is reported as empty', () => {
    const design = { source: 'svg' as const, yDown: true, layers: [
      { kind: 'fill' as const, contours: [[[0, 0], [1, 1]] as [number, number][]], fillRule: 'NonZero' as const, color: '#000000', light: false },
    ] };
    const r = runBuild(w, { id: 3, design, params: cloneParams(DEFAULTS), piece: 'imprint' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/vacío/);
  });
});
