import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Everything (JS, worker, WASM, fonts) is inlined into a single index.html,
// so the page opens straight from disk without a server.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
  },
  worker: { format: 'iife' },
});
