// Test designs shared by the geometry tests: a shield with a hole, a logo with
// separate shapes, a star with strokes and a ring.

import type { Design, Pt } from '../src/input/types';

const star: Pt[] = [];
for (let i = 0; i < 10; i++) {
  const r = i % 2 ? 20 : 50, t = (i / 10) * Math.PI * 2;
  star.push([Math.cos(t) * r, Math.sin(t) * r]);
}

export const circle = (r: number, cx = 0, cy = 0, n = 64): Pt[] =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * 6.283) * r, cy + Math.sin((i / n) * 6.283) * r] as Pt);

// Shield: flat top, sides curving down to a point.
const shield: Pt[] = [[-29, 37.5], [29, 37.5]];
for (let i = 1; i < 32; i++) {
  const t = i / 32;
  shield.push([29 * Math.cos(t * Math.PI / 2) ** 0.6, 37.5 - 75 * t ** 1.4]);
}
shield.push([0, -37.5]);
for (let i = 31; i > 0; i--) {
  const t = i / 32;
  shield.push([-29 * Math.cos(t * Math.PI / 2) ** 0.6, 37.5 - 75 * t ** 1.4]);
}

// Small star centred at (cx, cy).
const starAt = (cx: number, cy: number, r: number): Pt[] =>
  Array.from({ length: 10 }, (_, i) => {
    const rr = i % 2 ? r * 0.45 : r, t = Math.PI / 2 + (i / 10) * Math.PI * 2;
    return [cx + Math.cos(t) * rr, cy + Math.sin(t) * rr] as Pt;
  });

// Laurel-like arc of small leaves beside the shield.
const leaves = (side: number): Pt[][] => Array.from({ length: 7 }, (_, i) => {
  const t = -1.1 + i * 0.35;
  const cx = side * (36 + 6 * Math.cos(t)), cy = 40 * Math.sin(t);
  return circle(2.2, cx, cy, 16).map(([x, y]) => [cx + (x - cx) * 0.6, y] as Pt);
});

export const DESIGNS: Record<string, Design> = {
  shield: { source: 'svg', yDown: false, layers: [
    { kind: 'fill', contours: [shield.slice().reverse()], fillRule: 'NonZero', color: '#000000', light: false },
    { kind: 'fill', contours: [circle(12, 0, 8)], fillRule: 'NonZero', color: '#ffffff', light: true },
  ] },
  logo: { source: 'image', yDown: false, layers: [
    { kind: 'fill', contours: [shield.slice().reverse(), starAt(-12, 48, 5), starAt(12, 48, 5), ...leaves(1), ...leaves(-1)], fillRule: 'NonZero', color: '#000000', light: false },
    { kind: 'fill', contours: [circle(12, 0, 8)], fillRule: 'NonZero', color: '#ffffff', light: true },
  ] },
  star: { source: 'svg', yDown: true, layers: [
    { kind: 'fill', contours: [star], fillRule: 'NonZero', color: '#000000', light: false },
    { kind: 'fill', contours: [circle(6, -10, -5), circle(6, 10, -5)], fillRule: 'NonZero', color: '#ffffff', light: true },
    { kind: 'stroke', lines: [[[-10, 8], [0, 12], [10, 8]]], closed: [false], width: 2, color: '#ffffff', light: true },
  ] },
  ring: { source: 'text', yDown: false, layers: [
    { kind: 'fill', contours: [circle(40), circle(25).reverse()], fillRule: 'NonZero', color: '#000000', light: false },
  ] },
};
