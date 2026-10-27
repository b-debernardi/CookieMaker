// Black/white step of image tracing, on raw RGBA pixels so it runs anywhere.
// The browser draws the picture into a canvas first (browser/image.ts).

/** White margin, px, so shapes touching the edge still close. */
export const TRACE_PAD = 4;

/**
 * Turns RGBA pixels into pure black (drawing) and white (the rest), in place.
 * Transparent pixels count as white; the outer `pad` pixels are always white.
 */
export function thresholdPixels(px: Uint8ClampedArray, W: number, H: number, threshold: number, invert: boolean, pad = TRACE_PAD) {
  if (px.length < W * H * 4) throw new Error('La imagen no tiene el tamaño indicado.');
  const cut = (threshold / 100) * 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = px[i + 3] / 255;
      const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * a + 255 * (1 - a);
      let dark = lum < cut;
      if (invert) dark = !dark;
      if (x < pad || y < pad || x >= W - pad || y >= H - pad) dark = false;
      const v = dark ? 0 : 255;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
}
