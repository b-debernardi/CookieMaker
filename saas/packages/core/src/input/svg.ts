// SVG text -> Design. Curves are sampled into polylines with SVGLoader.

import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { Color, type Vector2 } from 'three';
import type { Design, Layer, Pt } from './types';

/** Curve divisions per segment for a resolution of 1..200. */
export function divisionsFor(resolution: number): number {
  return Math.max(2, Math.round((resolution / 100) * 16));
}

function paint(c: string | undefined): { color: string; light: boolean } | null {
  if (!c || c === 'none' || c === 'transparent') return null;
  const col = new Color(0, 0, 0);
  try {
    col.setStyle(c);
  } catch {
    /* unknown colour: treat as black */
  }
  const lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
  return { color: '#' + col.getHexString(), light: lum > 0.6 };
}

function toPts(points: Vector2[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p.x) < 1e-9 && Math.abs(last[1] - p.y) < 1e-9) continue;
    out.push([p.x, p.y]);
  }
  return out;
}

/** The part of SVGLoader's per-path style object that we read. */
interface SvgStyle {
  fill?: string;
  fillOpacity?: number;
  fillRule?: string;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  opacity?: number;
}

export function parseSvg(text: string, resolution: number, source: Design['source'] = 'svg'): Design {
  const data = new SVGLoader().parse(text);
  const div = divisionsFor(resolution);
  const layers: Layer[] = [];

  for (const path of data.paths) {
    const style = (path.userData?.style ?? {}) as SvgStyle;
    const fill = paint(style.fill);
    const fillOpacity = (style.fillOpacity ?? 1) * (style.opacity ?? 1);
    const contours: Pt[][] = [];
    const lines: Pt[][] = [];
    const closed: boolean[] = [];
    for (const sp of path.subPaths) {
      const pts = toPts(sp.getPoints(div));
      if (pts.length < 2) continue;
      const first = pts[0], last = pts[pts.length - 1];
      const isClosed = sp.autoClose || (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6);
      if (isClosed && pts.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) pts.pop();
      if (pts.length >= 3) contours.push(pts);
      lines.push(pts);
      closed.push(isClosed);
    }
    if (fill && fillOpacity > 0.05 && contours.length) {
      layers.push({
        kind: 'fill',
        ...fill,
        contours,
        fillRule: style.fillRule === 'evenodd' ? 'EvenOdd' : 'NonZero',
      });
    }
    const stroke = paint(style.stroke);
    const strokeOpacity = (style.strokeOpacity ?? 1) * (style.opacity ?? 1);
    if (stroke && strokeOpacity > 0.05 && (style.strokeWidth ?? 1) > 0 && lines.length) {
      layers.push({ kind: 'stroke', ...stroke, lines, closed, width: style.strokeWidth ?? 1 });
    }
  }
  return { source, layers, yDown: true };
}
