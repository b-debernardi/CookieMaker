// Image -> Design: grayscale, threshold, then trace with Potrace.

import { init, potrace } from 'esm-potrace-wasm';
import type { Design } from './types';
import { parseSvg } from './svg';

let ready: Promise<void> | null = null;

const MAX_SIDE = 1200;

export async function loadImageBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** Black/white version of the image: dark (drawing) pixels black, the rest white. */
export function binarize(img: ImageBitmap, threshold: number, invert: boolean): ImageData {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const pad = 4; // white margin so shapes touching the edge still close
  const canvas = new OffscreenCanvas(w + pad * 2, h + pad * 2);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, pad, pad, w, h);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const cut = (threshold / 100) * 255;
  const W = canvas.width, H = canvas.height;
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
  return data;
}

export async function traceImage(bw: ImageData, resolution: number): Promise<Design> {
  if (!ready) ready = init();
  await ready;
  const svg = await potrace(bw, {
    turdsize: 4,
    turnpolicy: 4,
    alphamax: 1,
    opticurve: 1,
    opttolerance: 0.2,
    pathonly: false,
    extractcolors: false,
  });
  return parseSvg(svg as string, resolution, 'image');
}

export function imageDataToUrl(d: ImageData): string {
  const c = document.createElement('canvas');
  c.width = d.width;
  c.height = d.height;
  c.getContext('2d')!.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}
