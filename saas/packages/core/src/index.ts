// The CookieMaker engine: design input, geometry and export, with no browser
// APIs except DOMParser (used by the SVG reader). Browser-only helpers live in
// `@app/core/browser`.

export * from './model/params';
export { paramsAtSize } from './model/size';
export { sanitizeParams, MAX_LIST } from './model/sanitize';
export * from './input/types';
export { parseSvg, divisionsFor } from './input/svg';
export { designToSvg } from './input/svgOut';
export { isCleanSvg } from './input/cleanSvg';
export { textToDesign, MAX_TEXT_LENGTH, type TextOptions } from './input/text';
export { thresholdPixels, TRACE_PAD } from './input/threshold';
export { loadManifold, Arena, type Wasm, type CS, type M } from './geometry/wasm';
export { runBuild, failedBuild } from './geometry/run';
export type { BuildRequest, BuildResult, MeshOut, Issue } from './geometry/protocol';
export { toStl } from './export/stl';
export { to3mf } from './export/threemf';
export { SAMPLES } from './input/samples';
