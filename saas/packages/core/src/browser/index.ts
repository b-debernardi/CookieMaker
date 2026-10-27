// Browser-only parts of the engine (Vite asset imports, canvas, Potrace).
// The geometry worker is imported on its own: `@app/core/browser/worker?worker`.

export { loadManifoldBrowser } from './manifold';
export { BUILTIN_FONTS, MAX_FONT_BYTES, loadFont, registerFont } from './fonts';
export { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, binarize, imageDataToUrl, loadImageBitmap, traceImage } from './image';
