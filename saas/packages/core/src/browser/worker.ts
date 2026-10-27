// Geometry runs here so the page stays responsive while a model is built.
// Import with `@app/core/browser/worker?worker`.

import { loadManifoldBrowser } from './manifold';
import { failedBuild, runBuild } from '../geometry/run';
import type { BuildRequest, BuildResult } from '../geometry/protocol';

async function build(req: BuildRequest): Promise<BuildResult> {
  let w;
  try {
    w = await loadManifoldBrowser();
  } catch (e) {
    return failedBuild(req.id, `No se pudo cargar el motor de geometría: ${String(e)}`);
  }
  return runBuild(w, req);
}

self.onmessage = async (ev: MessageEvent<BuildRequest>) => {
  const res = await build(ev.data);
  const transfer: Transferable[] = [];
  for (const m of res.meshes) transfer.push(m.positions.buffer, m.indices.buffer);
  (self as unknown as Worker).postMessage(res, transfer);
};
