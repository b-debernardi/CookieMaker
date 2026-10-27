// @vitest-environment happy-dom
// SVG reading and writing. The writer is what the cloud library will store,
// so it must only ever produce plain <path> elements.

import { describe, expect, it } from 'vitest';
import { parseSvg } from '../src/input/svg';
import { designToSvg } from '../src/input/svgOut';
import { SAMPLES } from '../src/input/samples';
import { designBounds } from '../src/input/types';

const tags = (svg: string) => [...svg.matchAll(/<([a-zA-Z][\w:-]*)/g)].map((m) => m[1]);

describe('parseSvg', () => {
  for (const s of SAMPLES) {
    it(`reads the sample "${s.label}"`, () => {
      const d = parseSvg(s.svg, 100);
      expect(d.layers.length).toBeGreaterThan(0);
      expect(designBounds(d)).not.toBeNull();
    });
  }

  it('keeps light paint as light layers', () => {
    const d = parseSvg(SAMPLES[0].svg, 100);
    expect(d.layers.some((l) => l.light)).toBe(true);
    expect(d.layers.some((l) => !l.light)).toBe(true);
  });

  it('returns no layers for text that is not SVG', () => {
    expect(parseSvg('esto no es un svg', 100).layers).toEqual([]);
  });
});

describe('designToSvg', () => {
  for (const s of SAMPLES) {
    it(`round-trips "${s.label}" with the same bounds`, () => {
      const d = parseSvg(s.svg, 100);
      const back = parseSvg(designToSvg(d), 100);
      const a = designBounds(d)!, b = designBounds(back)!;
      for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(b[k]).toBeCloseTo(a[k], 1);
      expect(back.layers.length).toBe(d.layers.length);
    });
  }

  it('drops scripts, links and anything else that is not a shape', () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
      <script>alert(1)</script>
      <a xlink:href="javascript:alert(1)"><rect width="10" height="10" fill="#000"/></a>
      <foreignObject><div>hola</div></foreignObject>
      <image href="https://example.com/x.png"/>
    </svg>`;
    const out = designToSvg(parseSvg(evil, 100));
    expect(new Set(tags(out))).toEqual(new Set(['svg', 'path']));
    expect(out).not.toMatch(/script|javascript|onload|href|foreignObject|example\.com/i);
  });
});
