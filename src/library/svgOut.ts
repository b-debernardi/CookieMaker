// Design -> SVG, so traced pictures and text are kept as a vector that the
// SVG reader turns back into the same design when a new version is made.

import { designBounds, type Design, type Pt } from '../input/types';

const n = (v: number) => +v.toFixed(3);

export function designToSvg(d: Design): string {
  const flip = d.yDown ? 1 : -1;
  const path = (pts: Pt[], close: boolean) =>
    pts.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y * flip)}`).join('') + (close ? 'Z' : '');
  const bb = designBounds(d) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  // Include light paint too: it can stick out of the dark areas.
  let { minX, minY, maxX, maxY } = bb;
  for (const l of d.layers) {
    const lists = l.kind === 'fill' ? l.contours : l.lines;
    for (const c of lists) for (const [x, y] of c) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const [y0, y1] = flip > 0 ? [minY, maxY] : [-maxY, -minY];
  const pad = Math.max(maxX - minX, y1 - y0) * 0.02;
  const body = d.layers.map((l) => {
    if (l.kind === 'fill') {
      const dd = l.contours.map((c) => path(c, true)).join('');
      return `<path d="${dd}" fill="${l.color}" fill-rule="${l.fillRule === 'EvenOdd' ? 'evenodd' : 'nonzero'}"/>`;
    }
    const dd = l.lines.map((c, i) => path(c, l.closed[i])).join('');
    return `<path d="${dd}" fill="none" stroke="${l.color}" stroke-width="${n(l.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('\n');
  const vb = [minX - pad, y0 - pad, maxX - minX + 2 * pad, y1 - y0 + 2 * pad].map(n).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">\n${body}\n</svg>\n`;
}
