// Built-in fonts for text designs, bundled by Vite and parsed on first use.

import opentype from 'opentype.js';
import fredokaUrl from '@fontsource/fredoka/files/fredoka-latin-600-normal.woff?url';
import pacificoUrl from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';
import bebasUrl from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url';

export const BUILTIN_FONTS = [
  { id: 'fredoka', label: 'Fredoka', url: fredokaUrl },
  { id: 'pacifico', label: 'Pacifico', url: pacificoUrl },
  { id: 'bebas', label: 'Bebas Neue', url: bebasUrl },
];

/** Largest font file accepted from the user, bytes. */
export const MAX_FONT_BYTES = 5 * 1024 * 1024;

const cache = new Map<string, opentype.Font>();

export async function loadFont(id: string): Promise<opentype.Font> {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = BUILTIN_FONTS.find((f) => f.id === id);
  if (!def) throw new Error(`Fuente desconocida: ${id}`);
  const res = await fetch(def.url);
  if (!res.ok) throw new Error(`No se pudo cargar la fuente (HTTP ${res.status}).`);
  const font = opentype.parse(await res.arrayBuffer());
  cache.set(id, font);
  return font;
}

/** A font file the user loaded. Throws if it is too big or not a font. */
export function registerFont(id: string, buf: ArrayBuffer): opentype.Font {
  if (buf.byteLength > MAX_FONT_BYTES) throw new Error('La fuente es demasiado grande (máximo 5 MB).');
  const font = opentype.parse(buf);
  cache.set(id, font);
  return font;
}
