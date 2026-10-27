// Image -> Design in the browser: draw into a canvas, threshold, then trace
// with Potrace.

import { init, potrace } from 'esm-potrace-wasm';
import type { Design } from '../input/types';
import { parseSvg } from '../input/svg';
import { thresholdPixels, TRACE_PAD } from '../input/threshold';

let ready: Promise<void> | null = null;

/** Longest side the picture is scaled down to before tracing, px. */
const MAX_SIDE = 1200;
/** Largest picture file accepted, bytes. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Largest picture accepted, px per side, before scaling down. */
export const MAX_IMAGE_SIDE = 8000;

/** Decodes a picture the user loaded. Throws if it is too big. */
export async function loadImageBitmap(file: Blob): Promise<ImageBitmap> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande (máximo 15 MB).');
  const img = await createImageBitmap(file);
  if (img.width > MAX_IMAGE_SIDE || img.height > MAX_IMAGE_SIDE) {
    img.close();
    throw new Error(`La imagen es demasiado grande (máximo ${MAX_IMAGE_SIDE} px por lado).`);
  }
  return img;
}

/** Black/white version of the image: dark (drawing) pixels black, the rest white. */
export function binarize(img: ImageBitmap, threshold: number, invert: boolean): ImageData {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = new OffscreenCanvas(w + TRACE_PAD * 2, h + TRACE_PAD * 2);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('El navegador no permite dibujar la imagen.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, TRACE_PAD, TRACE_PAD, w, h);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  thresholdPixels(data.data, canvas.width, canvas.height, threshold, invert);
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
  return parseSvg(String(svg), resolution, 'image');
}

export function imageDataToUrl(d: ImageData): string {
  const c = document.createElement('canvas');
  c.width = d.width;
  c.height = d.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite dibujar la imagen.');
  ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}
