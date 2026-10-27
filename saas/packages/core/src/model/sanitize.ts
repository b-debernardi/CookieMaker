// Parameters that come from outside the app (the cloud library, an imported
// file) are untrusted: the database only checks that they are a small JSON
// object. This turns anything into valid Params: unknown keys are dropped,
// wrong types fall back to the default, numbers are clamped to the limits of
// their field and lists are capped.

import { DEFAULTS, SECTIONS, cloneParams, type ManualBridge, type Modifier, type Params } from './params';

/** Most manual bridges or zones kept. */
export const MAX_LIST = 20;

/** Limits for sizes, which have no field in SECTIONS. */
const SIZE_LIMITS = { min: 5, max: 500 };

type Limits = { min: number; max: number };

/** Widest limits per numeric key (some keys appear in more than one section). */
const NUM_LIMITS = new Map<keyof Params, Limits>();
/** Allowed values per choice key. */
const CHOICES = new Map<keyof Params, Set<string>>();
for (const s of SECTIONS) {
  for (const f of s.fields) {
    if (f.min !== undefined && f.max !== undefined) {
      const cur = NUM_LIMITS.get(f.key);
      NUM_LIMITS.set(f.key, cur ? { min: Math.min(cur.min, f.min), max: Math.max(cur.max, f.max) } : { min: f.min, max: f.max });
    }
    if (f.choices) {
      const set = CHOICES.get(f.key) ?? new Set<string>();
      for (const c of f.choices) set.add(c.value);
      CHOICES.set(f.key, set);
    }
  }
}
NUM_LIMITS.set('sizeW', SIZE_LIMITS);
NUM_LIMITS.set('sizeH', SIZE_LIMITS);
CHOICES.set('partsMode', new Set(['largest', 'outline', 'set']));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (v: number, l: Limits) => Math.min(l.max, Math.max(l.min, v));

function num(v: unknown, fallback: number, l: Limits): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, l) : fallback;
}

function bridge(v: unknown): ManualBridge | null {
  if (!isObj(v)) return null;
  return {
    angle: num(v.angle, 0, { min: 0, max: 179 }),
    pos: num(v.pos, 50, { min: 0, max: 100 }),
    width: num(v.width, DEFAULTS.bridgeWidth, { min: 0.2, max: 10 }),
  };
}

function modifier(v: unknown): Modifier | null {
  if (!isObj(v)) return null;
  return {
    shape: v.shape === 'rect' ? 'rect' : 'circle',
    x: num(v.x, 0, { min: -500, max: 500 }),
    y: num(v.y, 0, { min: -500, max: 500 }),
    w: num(v.w, 10, { min: 0.5, max: 500 }),
    h: num(v.h, 10, { min: 0.5, max: 500 }),
    forceMinThickness: typeof v.forceMinThickness === 'boolean' ? v.forceMinThickness : true,
    minThickness: num(v.minThickness, DEFAULTS.minThickness, { min: 0.2, max: 5 }),
  };
}

export function sanitizeParams(raw: unknown): Params {
  const out = cloneParams(DEFAULTS);
  if (!isObj(raw)) return out;
  const o = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof Params)[]) {
    const def = DEFAULTS[key];
    const v = raw[key];
    if (key === 'manualBridges' || key === 'modifiers') continue;
    if (typeof def === 'number') {
      o[key] = num(v, def, NUM_LIMITS.get(key) ?? { min: -1e6, max: 1e6 });
    } else if (typeof def === 'boolean') {
      if (typeof v === 'boolean') o[key] = v;
    } else if (typeof def === 'string') {
      const allowed = CHOICES.get(key);
      if (typeof v === 'string' && allowed?.has(v)) o[key] = v;
    }
  }
  if (Array.isArray(raw.manualBridges)) {
    out.manualBridges = raw.manualBridges.slice(0, MAX_LIST).map(bridge).filter((b): b is ManualBridge => b !== null);
  }
  if (Array.isArray(raw.modifiers)) {
    out.modifiers = raw.modifiers.slice(0, MAX_LIST).map(modifier).filter((m): m is Modifier => m !== null);
  }
  return out;
}
