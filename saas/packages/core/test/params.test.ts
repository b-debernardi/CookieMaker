// Defaults, field limits and resizing.

import { describe, expect, it } from 'vitest';
import { DEFAULTS, SECTIONS, cloneParams, cutMargin, type Params } from '../src/model/params';
import { paramsAtSize } from '../src/model/size';

describe('DEFAULTS', () => {
  it('every default is inside the limits of its field', () => {
    for (const s of SECTIONS) {
      for (const f of s.fields) {
        const v = DEFAULTS[f.key];
        if (typeof v !== 'number') continue;
        if (f.min !== undefined) expect(v, f.key).toBeGreaterThanOrEqual(f.min);
        if (f.max !== undefined) expect(v, f.key).toBeLessThanOrEqual(f.max);
      }
    }
  });

  it('choice fields default to one of their choices', () => {
    for (const s of SECTIONS) {
      for (const f of s.fields) {
        if (f.kind !== 'choice') continue;
        expect(f.choices?.map((c) => c.value), f.key).toContain(DEFAULTS[f.key]);
      }
    }
  });
});

describe('cloneParams', () => {
  it('copies nested lists so edits do not leak back', () => {
    const a: Params = { ...cloneParams(DEFAULTS), manualBridges: [{ angle: 0, pos: 50, width: 1 }] };
    const b = cloneParams(a);
    b.manualBridges[0].width = 3;
    expect(a.manualBridges[0].width).toBe(1);
  });
});

describe('paramsAtSize', () => {
  it('sets the longest side to the new size and keeps the proportions of the design', () => {
    const base = { ...cloneParams(DEFAULTS), sizeW: 80, sizeH: 60 };
    const p = paramsAtSize(base, 40, 'cutter');
    expect(Math.max(p.sizeW, p.sizeH)).toBeCloseTo(40, 3);
    const m = 2 * cutMargin(base, 'cutter');
    expect((p.sizeW - m) / (p.sizeH - m)).toBeCloseTo((80 - m) / (60 - m), 3);
  });

  it('accounts for the extra clearance when moving to a cutter + stamp set', () => {
    const base = { ...cloneParams(DEFAULTS), sizeW: 80, sizeH: 80 };
    const p = paramsAtSize(base, 80, 'cutter', 'set');
    expect(p.sizeW).toBeCloseTo(80, 3);
    expect(cutMargin(p, 'set')).toBeGreaterThan(cutMargin(p, 'cutter'));
  });
});
