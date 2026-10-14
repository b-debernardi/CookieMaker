// Loads the Manifold WASM module once. Manifold wraps Clipper2 for 2D
// (CrossSection) and gives guaranteed-manifold 3D booleans.

import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

export type Wasm = Awaited<ReturnType<typeof Module>>;
export type CS = InstanceType<Wasm['CrossSection']>;
export type M = InstanceType<Wasm['Manifold']>;

let mod: Promise<Wasm> | null = null;

export function loadManifold(): Promise<Wasm> {
  if (!mod) {
    mod = (async () => {
      const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
      const m = await Module({ wasmBinary } as any);
      m.setup();
      return m;
    })();
  }
  return mod;
}

/**
 * Collects every WASM object created during one build so they can all be
 * freed at the end; Manifold objects are not garbage collected.
 */
export class Arena {
  private items: { delete(): void }[] = [];
  keep<T extends { delete(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
  free() {
    for (const x of this.items) {
      try {
        x.delete();
      } catch {
        /* already freed */
      }
    }
    this.items = [];
  }
}
