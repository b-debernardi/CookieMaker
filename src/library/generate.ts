// Builds library versions in their own worker, so making a new size from the
// library doesn't touch what is open in the editor.

import GeoWorker from '../geometry/worker?worker&inline';
import type { BuildRequest, BuildResult } from '../geometry/protocol';
import { parseSvg } from '../input/svg';
import { cloneParams, cutMargin, type Params, type Piece } from '../model/params';
import { toStl } from '../export/stl';

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (r: BuildResult) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new GeoWorker();
  worker.onmessage = (ev: MessageEvent<BuildResult>) => {
    const done = waiting.get(ev.data.id);
    waiting.delete(ev.data.id);
    done?.(ev.data);
  };
  return worker;
}

/**
 * The parameters of `base` (made for `from`) scaled so the longest side of
 * the `to` piece measures `size` mm. Sizes are measured outside the cutting
 * wall, so the wall margin stays fixed and only the design scales.
 */
export function paramsAtSize(base: Params, size: number, from: Piece, to: Piece = from): Params {
  const p = cloneParams(base);
  const m0 = 2 * cutMargin(base, from), m1 = 2 * cutMargin(p, to);
  const w = Math.max(1e-3, p.sizeW - m0), h = Math.max(1e-3, p.sizeH - m0);
  const k = Math.max(1, size - m1) / Math.max(w, h);
  p.sizeW = Math.round((w * k + m1) * 1000) / 1000;
  p.sizeH = Math.round((h * k + m1) * 1000) / 1000;
  return p;
}

export interface Generated {
  stl: Blob;
  dims: [number, number, number];
  warnings: string[];
}

export function generate(svg: string, params: Params, piece: Piece): Promise<Generated> {
  const design = parseSvg(svg, params.resolution);
  const req: BuildRequest = { id: ++seq, design, params: cloneParams(params), piece };
  return new Promise((resolve, reject) => {
    waiting.set(req.id, (r) => {
      if (!r.ok) return reject(new Error(r.error || 'No se pudo generar.'));
      const parts = r.meshes.filter((m) => m.role === 'part');
      resolve({
        stl: toStl(parts),
        dims: r.size.map((v) => Math.round(v * 10) / 10) as [number, number, number],
        warnings: r.issues.filter((i) => i.level !== 'info').map((i) => i.text),
      });
    });
    getWorker().postMessage(req);
  });
}
