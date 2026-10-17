// Builds library versions in their own worker, so making a new size from the
// library doesn't touch what is open in the editor.

import GeoWorker from '../geometry/worker?worker&inline';
import type { BuildRequest, BuildResult } from '../geometry/protocol';
import { parseSvg } from '../input/svg';
import { cloneParams, type Params, type Piece } from '../model/params';
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

/** The parameters of `base` scaled so the longest side of the design is `size` mm. */
export function paramsAtSize(base: Params, size: number): Params {
  const p = cloneParams(base);
  const longest = Math.max(p.sizeW, p.sizeH) || size;
  const k = size / longest;
  p.sizeW = Math.round(p.sizeW * k * 1000) / 1000;
  p.sizeH = Math.round(p.sizeH * k * 1000) / 1000;
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
