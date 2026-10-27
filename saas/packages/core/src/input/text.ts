// Text -> Design using opentype.js glyph outlines. Loading the font file is
// the caller's job (browser/fonts.ts), so this runs the same in Node.

import type opentype from 'opentype.js';
import type { Design, Pt } from './types';
import { divisionsFor } from './svg';

export interface TextOptions {
  text: string;
  letterSpacing: number; // em/100
  lineHeight: number; // multiple of font size
  resolution: number;
}

/** Maximum characters turned into outlines; longer text is cut, so a paste can't stall the page. */
export const MAX_TEXT_LENGTH = 200;

export function textToDesign(font: opentype.Font, o: TextOptions): Design {
  const size = 100;
  const div = divisionsFor(o.resolution);
  const contours: Pt[][] = [];
  const lines = o.text.slice(0, MAX_TEXT_LENGTH).split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    // letterSpacing is read by opentype.js but missing from its type definitions.
    const opts: opentype.RenderOptions & { letterSpacing: number } = { letterSpacing: o.letterSpacing / 100, kerning: true };
    const path = font.getPath(line, 0, i * size * o.lineHeight, size, opts);
    // Centre each line horizontally.
    const bb = path.getBoundingBox();
    const dx = -(bb.x1 + bb.x2) / 2;
    let cur: Pt[] = [];
    let px = 0, py = 0;
    const flush = () => {
      if (cur.length >= 3) contours.push(cur);
      cur = [];
    };
    for (const c of path.commands) {
      switch (c.type) {
        case 'M':
          flush();
          px = c.x + dx; py = c.y;
          cur.push([px, py]);
          break;
        case 'L':
          px = c.x + dx; py = c.y;
          cur.push([px, py]);
          break;
        case 'Q': {
          const x0 = px, y0 = py;
          for (let k = 1; k <= div; k++) {
            const t = k / div, u = 1 - t;
            cur.push([
              u * u * x0 + 2 * u * t * (c.x1 + dx) + t * t * (c.x + dx),
              u * u * y0 + 2 * u * t * c.y1 + t * t * c.y,
            ]);
          }
          px = c.x + dx; py = c.y;
          break;
        }
        case 'C': {
          const x0 = px, y0 = py;
          for (let k = 1; k <= div; k++) {
            const t = k / div, u = 1 - t;
            cur.push([
              u * u * u * x0 + 3 * u * u * t * (c.x1 + dx) + 3 * u * t * t * (c.x2 + dx) + t * t * t * (c.x + dx),
              u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
            ]);
          }
          px = c.x + dx; py = c.y;
          break;
        }
        case 'Z':
          flush();
          break;
      }
    }
    flush();
  });
  return {
    source: 'text',
    layers: contours.length
      ? [{ kind: 'fill', contours, fillRule: 'NonZero', color: '#000000', light: false }]
      : [],
    yDown: true,
  };
}
