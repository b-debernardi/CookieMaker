// Text -> Design using opentype.js glyph outlines.

import opentype from 'opentype.js';
import fredokaUrl from '@fontsource/fredoka/files/fredoka-latin-600-normal.woff?url';
import pacificoUrl from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';
import bebasUrl from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url';
import type { Design, Pt } from './types';
import { divisionsFor } from './svg';

export const BUILTIN_FONTS = [
  { id: 'fredoka', label: 'Fredoka', url: fredokaUrl },
  { id: 'pacifico', label: 'Pacifico', url: pacificoUrl },
  { id: 'bebas', label: 'Bebas Neue', url: bebasUrl },
];

const cache = new Map<string, opentype.Font>();

export async function loadFont(id: string): Promise<opentype.Font> {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = BUILTIN_FONTS.find((f) => f.id === id);
  if (!def) throw new Error(`Fuente desconocida: ${id}`);
  const buf = await (await fetch(def.url)).arrayBuffer();
  const font = opentype.parse(buf);
  cache.set(id, font);
  return font;
}

export function registerFont(id: string, buf: ArrayBuffer): opentype.Font {
  const font = opentype.parse(buf);
  cache.set(id, font);
  return font;
}

export interface TextOptions {
  text: string;
  fontId: string;
  letterSpacing: number; // em/100
  lineHeight: number; // multiple of font size
  resolution: number;
}

export async function textToDesign(o: TextOptions): Promise<Design> {
  const font = await loadFont(o.fontId);
  const size = 100;
  const div = divisionsFor(o.resolution);
  const contours: Pt[][] = [];
  const lines = o.text.split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const path = font.getPath(line, 0, i * size * o.lineHeight, size, {
      letterSpacing: o.letterSpacing / 100,
      kerning: true,
    } as any);
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
