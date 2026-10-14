// Manufacturing profiles: every parameter except the design-specific ones,
// saved in the browser and compared against the current values.

import { DEFAULTS, DESIGN_KEYS, type Params } from './params';

const KEY = 'cookiemaker.profiles.v1';
const LAST = 'cookiemaker.last.v1';
export const BASE_PROFILE = 'Perfil base';

export type Profile = Partial<Params>;

function strip(p: Params): Profile {
  const out: Record<string, unknown> = { ...p };
  for (const k of DESIGN_KEYS) delete out[k];
  return out as Profile;
}

function read(): Record<string, Profile> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function write(all: Record<string, Profile>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: profiles last for this visit only */
  }
}

export function listProfiles(): string[] {
  return [BASE_PROFILE, ...Object.keys(read()).filter((n) => n !== BASE_PROFILE).sort()];
}

export function getProfile(name: string): Profile {
  if (name === BASE_PROFILE) return strip(DEFAULTS);
  return read()[name] ?? strip(DEFAULTS);
}

export function saveProfile(name: string, p: Params) {
  const all = read();
  all[name] = strip(p);
  write(all);
}

export function deleteProfile(name: string) {
  const all = read();
  delete all[name];
  write(all);
}

export function isModified(name: string, p: Params): boolean {
  const prof = getProfile(name);
  const cur = strip(p) as Record<string, unknown>;
  return Object.keys(cur).some((k) => JSON.stringify(cur[k]) !== JSON.stringify((prof as any)[k] ?? (DEFAULTS as any)[k]));
}

export function applyProfile(name: string, p: Params): Params {
  return { ...p, ...strip({ ...DEFAULTS, ...getProfile(name) } as Params) };
}

export interface Session {
  params: Params;
  profile: string;
}

export function saveSession(s: Session) {
  try {
    localStorage.setItem(LAST, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(LAST) || 'null');
    if (!s?.params) return null;
    return { params: { ...DEFAULTS, ...s.params }, profile: s.profile || BASE_PROFILE };
  } catch {
    return null;
  }
}
