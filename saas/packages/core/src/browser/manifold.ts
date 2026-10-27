// Manifold in the browser: the .wasm file is bundled by Vite and fetched once.

import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { loadManifold, type Wasm } from '../geometry/wasm';

export function loadManifoldBrowser(): Promise<Wasm> {
  return loadManifold(async () => {
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  });
}
