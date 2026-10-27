// Untrusted parameters (from the cloud library or a file) become valid Params.

import { describe, expect, it } from 'vitest';
import { DEFAULTS, SECTIONS, type Params } from '../src/model/params';
import { MAX_LIST, sanitizeParams } from '../src/model/sanitize';

describe('sanitizeParams', () => {
  it('keeps valid parameters as they are', () => {
    const p: Params = { ...DEFAULTS, sizeW: 90, bladeDepth: 15, cutMode: 'holes', manualBridges: [{ angle: 45, pos: 30, width: 1.5 }] };
    expect(sanitizeParams(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('gives the defaults for anything that is not an object', () => {
    for (const v of [null, undefined, 3, 'x', [1, 2]]) expect(sanitizeParams(v)).toEqual(DEFAULTS);
  });

  it('drops unknown keys, including __proto__', () => {
    const p = sanitizeParams(JSON.parse('{"__proto__": {"polluted": true}, "extra": 1, "sizeW": 50}')) as Params & Record<string, unknown>;
    expect(p.sizeW).toBe(50);
    expect(p.extra).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(p).sort()).toEqual(Object.keys(DEFAULTS).sort());
  });

  it('clamps numbers to their field limits and replaces non-finite ones', () => {
    const p = sanitizeParams({ bladeDepth: 1e9, bladeThickness: -5, sizeW: 1e6, resolution: NaN, minThickness: 'gordo' });
    const blade = SECTIONS.flatMap((s) => s.fields).find((f) => f.key === 'bladeDepth')!;
    expect(p.bladeDepth).toBe(blade.max);
    expect(p.bladeThickness).toBe(0.4);
    expect(p.sizeW).toBe(500);
    expect(p.resolution).toBe(DEFAULTS.resolution);
    expect(p.minThickness).toBe(DEFAULTS.minThickness);
  });

  it('only accepts known choices', () => {
    const p = sanitizeParams({ cutMode: 'todo', baseShape: 'round', partsMode: 'set', envelope: '<script>' });
    expect(p.cutMode).toBe(DEFAULTS.cutMode);
    expect(p.baseShape).toBe('round');
    expect(p.partsMode).toBe('set');
    expect(p.envelope).toBe(DEFAULTS.envelope);
  });

  it('caps and cleans the lists', () => {
    const p = sanitizeParams({
      manualBridges: [...Array.from({ length: 50 }, () => ({ angle: 400, pos: -3, width: 2 })), 'x'],
      modifiers: [{ shape: 'hexagon', x: 1e9, w: 0 }, null],
    });
    expect(p.manualBridges).toHaveLength(MAX_LIST);
    expect(p.manualBridges[0]).toEqual({ angle: 179, pos: 0, width: 2 });
    expect(p.modifiers).toEqual([{ shape: 'circle', x: 500, y: 0, w: 0.5, h: 10, forceMinThickness: true, minThickness: DEFAULTS.minThickness }]);
  });
});
