// Loads the Manifold WASM module once. Manifold wraps Clipper2 for 2D
// (CrossSection) and gives guaranteed-manifold 3D booleans.
//
// The caller says how to get the .wasm bytes: the browser fetches them from
// the bundled URL (see browser/manifold.ts); Node lets Manifold find its own.

import Module from 'manifold-3d';

export type Wasm = Awaited<ReturnType<typeof Module>>;
export type CS = InstanceType<Wasm['CrossSection']>;
export type M = InstanceType<Wasm['Manifold']>;

let mod: Promise<Wasm> | null = null;

export function loadManifold(getBinary?: () => Promise<ArrayBuffer>): Promise<Wasm> {
  if (!mod) {
    mod = (async () => {
      const wasmBinary = getBinary ? await getBinary() : undefined;
      // Upstream types only list locateFile; wasmBinary is a standard Emscripten option.
      const m = await Module(wasmBinary ? ({ wasmBinary } as unknown as Parameters<typeof Module>[0]) : undefined);
      m.setup();
      return m;
    })();
    // A failed load (network, bad binary) must not stick: let the next build retry.
    mod.catch(() => { mod = null; });
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
