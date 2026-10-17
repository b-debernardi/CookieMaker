// The cutter library, kept in the browser (IndexedDB) because the app runs
// from disk with no server. A cutter ("item") holds the design as SVG, the
// picture it came from and its category; each version holds the parameters
// it was generated with and its STL, so new sizes can be made later.

import type { Params, Piece } from '../model/params';

export interface LibItem {
  id: string;
  name: string;
  category: string;
  source: 'svg' | 'image' | 'text';
  /** The design as SVG: the file itself, or the traced image / text outline. */
  svg: string;
  /** Picture the design was traced from, as used (with the edits from the image editor). */
  image?: Blob;
  imageName?: string;
  /** The text and font, for designs made from text. */
  text?: string;
  fontId?: string;
  letterSpacing?: number;
  thumb?: Blob;
  created: number;
  updated: number;
}

export interface LibVersion {
  id: string;
  itemId: string;
  piece: Piece;
  params: Params;
  /** Longest side of the design, mm: what "8 cm" means. */
  size: number;
  /** Bounding box of the generated parts, mm. */
  dims: [number, number, number];
  stl: Blob;
  thumb?: Blob;
  created: number;
}

const DB = 'cookiemaker';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('items', { keyPath: 'id' });
      db.createObjectStore('versions', { keyPath: 'id' }).createIndex('itemId', 'itemId');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function store(name: 'items' | 'versions', mode: IDBTransactionMode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export async function listItems(): Promise<LibItem[]> {
  return req((await store('items')).getAll() as IDBRequest<LibItem[]>);
}

export async function getItem(id: string): Promise<LibItem | undefined> {
  return req((await store('items')).get(id) as IDBRequest<LibItem | undefined>);
}

export async function putItem(item: LibItem) {
  await req((await store('items', 'readwrite')).put(item));
}

export async function listVersions(itemId?: string): Promise<LibVersion[]> {
  const s = await store('versions');
  const all = await req((itemId ? s.index('itemId').getAll(itemId) : s.getAll()) as IDBRequest<LibVersion[]>);
  return all.sort((a, b) => a.size - b.size || a.created - b.created);
}

export async function putVersion(v: LibVersion) {
  await req((await store('versions', 'readwrite')).put(v));
}

export async function deleteVersion(id: string) {
  await req((await store('versions', 'readwrite')).delete(id));
}

export async function deleteItem(id: string) {
  const db = await open();
  const tx = db.transaction(['items', 'versions'], 'readwrite');
  tx.objectStore('items').delete(id);
  const idx = tx.objectStore('versions').index('itemId');
  const keys = await req(idx.getAllKeys(id));
  for (const k of keys) tx.objectStore('versions').delete(k);
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

/** "8 cm", "4.5 cm": how sizes are named everywhere. */
export function sizeLabel(mm: number): string {
  const cm = Math.round(mm) / 10;
  return `${cm.toLocaleString('es-AR', { maximumFractionDigits: 1 })} cm`;
}
