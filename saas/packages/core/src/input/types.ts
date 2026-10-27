// The common shape every input (SVG, image, text) is converted into before
// geometry runs. Units are whatever the source used; the worker scales to mm.

export type Pt = [number, number];

interface LayerBase {
  /** Normalised colour (#rrggbb). Each colour becomes its own region. */
  color: string;
  /** Light paint (white icing, background) cuts into what is below it. */
  light: boolean;
}

export interface FillLayer extends LayerBase {
  kind: 'fill';
  contours: Pt[][];
  fillRule: 'NonZero' | 'EvenOdd';
}

export interface StrokeLayer extends LayerBase {
  kind: 'stroke';
  lines: Pt[][];
  closed: boolean[];
  width: number;
}

export type Layer = FillLayer | StrokeLayer;

export interface Design {
  source: 'svg' | 'image' | 'text';
  /** In paint order: later layers cover earlier ones. */
  layers: Layer[];
  /** True when +y points down (SVG, images). */
  yDown: boolean;
}

export function designBounds(d: Design): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (pts: Pt[], pad = 0) => {
    for (const [x, y] of pts) {
      if (x - pad < minX) minX = x - pad;
      if (y - pad < minY) minY = y - pad;
      if (x + pad > maxX) maxX = x + pad;
      if (y + pad > maxY) maxY = y + pad;
    }
  };
  for (const l of d.layers) {
    if (l.light) continue;
    if (l.kind === 'fill') for (const c of l.contours) visit(c);
    else for (const s of l.lines) visit(s, l.width / 2);
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}
