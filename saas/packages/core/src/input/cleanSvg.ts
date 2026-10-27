// The only SVG the cloud library accepts: what designToSvg() writes. The
// database runs the same check (private.is_clean_svg); the tests run both
// on the same inputs so they can't drift apart.

const MAX_BYTES = 1024 * 1024;
const TAGS = new Set(['svg', 'path']);
const ATTRS = new Set(['xmlns', 'viewBox', 'd', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const ATTR_RE = /([^\s<>"=]+)\s*=\s*"([^"]*)"/g;

export function isCleanSvg(svg: string): boolean {
  if (new TextEncoder().encode(svg).length > MAX_BYTES) return false;
  if (!/^\s*<svg[\s>]/.test(svg) || !/<\/svg>\s*$/.test(svg)) return false;
  // No entities, comments, CDATA, processing instructions or single quotes.
  if (svg.includes('&') || /<[!?]/.test(svg) || svg.includes("'")) return false;
  for (const m of svg.matchAll(/<\s*\/?\s*([^\s/>]*)/g)) if (!TAGS.has(m[1])) return false;
  let attrs = 0;
  for (const m of svg.matchAll(ATTR_RE)) {
    attrs++;
    if (!ATTRS.has(m[1])) return false;
    if (m[1] === 'xmlns' ? m[2] !== SVG_NS : !/^[A-Za-z0-9#.,\- ]*$/.test(m[2])) return false;
  }
  // Every "=" must belong to a quoted attribute matched above.
  return (svg.match(/=/g)?.length ?? 0) === attrs;
}
