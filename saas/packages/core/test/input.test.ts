// Image thresholding and text outlines.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import opentype from 'opentype.js';
import { thresholdPixels } from '../src/input/threshold';
import { MAX_TEXT_LENGTH, textToDesign } from '../src/input/text';
import { designBounds } from '../src/input/types';

const require = createRequire(import.meta.url);

describe('thresholdPixels', () => {
  const W = 10, H = 10;
  const solid = (r: number, g: number, b: number, a = 255) => {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < px.length; i += 4) px.set([r, g, b, a], i);
    return px;
  };
  const at = (px: Uint8ClampedArray, x: number, y: number) => px[(y * W + x) * 4];

  it('turns dark pixels black and keeps a white border', () => {
    const px = solid(20, 20, 20);
    thresholdPixels(px, W, H, 50, false, 2);
    expect(at(px, 5, 5)).toBe(0);
    expect(at(px, 0, 0)).toBe(255);
    expect(at(px, 1, 8)).toBe(255);
  });

  it('treats transparent pixels as white', () => {
    const px = solid(0, 0, 0, 0);
    thresholdPixels(px, W, H, 50, false, 0);
    expect(at(px, 5, 5)).toBe(255);
  });

  it('inverts when asked', () => {
    const px = solid(250, 250, 250);
    thresholdPixels(px, W, H, 50, true, 0);
    expect(at(px, 5, 5)).toBe(0);
  });

  it('rejects a buffer smaller than the size given', () => {
    expect(() => thresholdPixels(new Uint8ClampedArray(10), W, H, 50, false)).toThrow();
  });
});

describe('textToDesign', () => {
  const buf = readFileSync(require.resolve('@fontsource/fredoka/files/fredoka-latin-600-normal.woff'));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const opts = { letterSpacing: 0, lineHeight: 1.1, resolution: 100 };

  it('outlines text into one filled layer', () => {
    const d = textToDesign(font, { ...opts, text: 'Hola' });
    expect(d.layers).toHaveLength(1);
    expect(d.layers[0].kind).toBe('fill');
    expect(designBounds(d)).not.toBeNull();
  });

  it('gives an empty design for blank text', () => {
    expect(textToDesign(font, { ...opts, text: '  \n ' }).layers).toEqual([]);
  });

  it('cuts very long text', () => {
    const long = textToDesign(font, { ...opts, text: 'a'.repeat(MAX_TEXT_LENGTH * 5) });
    const max = textToDesign(font, { ...opts, text: 'a'.repeat(MAX_TEXT_LENGTH) });
    expect(designBounds(long)).toEqual(designBounds(max));
  });
});
