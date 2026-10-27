// Rescaling saved parameters to a new size, used when the library makes a
// new version of a cutter.

import { cloneParams, cutMargin, type Params, type Piece } from './params';

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
