// Thin helpers over Manifold's CrossSection/Manifold that register every
// intermediate object in the build's arena.

import type { Arena, CS, M, Wasm } from './wasm';
import type { Pt } from '../input/types';

export class Geo {
  constructor(public w: Wasm, public arena: Arena) {}

  keep<T extends CS | M>(x: T): T {
    return this.arena.keep(x);
  }

  cs(polys: Pt[][], rule: 'NonZero' | 'EvenOdd' | 'Positive' = 'Positive'): CS {
    const clean = polys.filter((p) => p.length >= 3);
    return this.keep(new this.w.CrossSection(clean as any, rule));
  }

  empty(): CS {
    return this.keep(new this.w.CrossSection([] as any));
  }

  union(list: CS[]): CS {
    const l = list.filter(Boolean);
    if (l.length === 0) return this.empty();
    if (l.length === 1) return l[0];
    return this.keep(this.w.CrossSection.union(l));
  }

  sub(a: CS, b: CS): CS {
    return this.keep(a.subtract(b));
  }

  inter(a: CS, b: CS): CS {
    return this.keep(a.intersect(b));
  }

  offset(a: CS, d: number, join: 'Round' | 'Miter' | 'Square' = 'Round'): CS {
    if (Math.abs(d) < 1e-9) return a;
    return this.keep(a.offset(d, join, 2));
  }

  simplify(a: CS, eps: number): CS {
    return eps > 0 ? this.keep(a.simplify(eps)) : a;
  }

  /** Removes parts narrower than w (morphological opening). */
  open(a: CS, w: number): CS {
    return this.offset(this.offset(a, -w / 2), w / 2);
  }

  /** Fills every hole: keeps only the outer (counter-clockwise) contours. */
  fillHoles(a: CS): CS {
    const outer = a.toPolygons().filter((p) => signedArea(p as Pt[]) > 0) as Pt[][];
    return this.cs(outer);
  }

  extrude(a: CS, z0: number, z1: number): M | null {
    if (z1 - z0 < 1e-6 || a.isEmpty()) return null;
    const m = this.keep(a.extrude(z1 - z0));
    return z0 === 0 ? m : this.keep(m.translate([0, 0, z0]));
  }

  munion(list: (M | null)[]): M {
    const l = list.filter((x): x is M => !!x);
    if (l.length === 0) return this.keep(this.w.Manifold.cube([0, 0, 0]) as M);
    if (l.length === 1) return l[0];
    return this.keep(this.w.Manifold.union(l));
  }

  polys(a: CS): Pt[][] {
    return a.toPolygons() as Pt[][];
  }
}

export function signedArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return s / 2;
}

/** CCW rectangle around the segment a-b, `w` wide, extended by `ext` at both ends. */
export function segmentRect(a: Pt, b: Pt, w: number, ext = 0): Pt[] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len, uy = dy / len;
  const nx = -uy * (w / 2), ny = ux * (w / 2);
  const ax = a[0] - ux * ext, ay = a[1] - uy * ext;
  const bx = b[0] + ux * ext, by = b[1] + uy * ext;
  return [
    [ax - nx, ay - ny],
    [bx - nx, by - ny],
    [bx + nx, by + ny],
    [ax + nx, ay + ny],
  ];
}

export function circlePoly(c: Pt, r: number, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]);
  }
  return out;
}

/** Polylines thickened to width w with round joints and caps. */
export function strokePolys(lines: Pt[][], closed: boolean[], w: number): Pt[][] {
  const out: Pt[][] = [];
  const n = Math.max(8, Math.min(24, Math.round(w * 8)));
  lines.forEach((pts, li) => {
    const segs = closed[li] ? pts.length : pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const r = segmentRect(pts[i], pts[(i + 1) % pts.length], w);
      if (r) out.push(r);
    }
    pts.forEach((p, i) => {
      const end = !closed[li] && (i === 0 || i === pts.length - 1);
      const prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
      const a1 = Math.atan2(p[1] - prev[1], p[0] - prev[0]);
      const a2 = Math.atan2(next[1] - p[1], next[0] - p[0]);
      let turn = Math.abs(a2 - a1);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      // Round caps at the ends, and joints only where the line turns noticeably.
      if (end || turn > 0.15) out.push(circlePoly(p, w / 2, n));
    });
  });
  return out;
}
