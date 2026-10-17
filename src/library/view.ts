// "Biblioteca": the saved cutters with search and filters, and the window of
// one cutter with its versions (one per size and piece), where new sizes are
// generated from the saved SVG.

import { strToU8, zipSync } from 'fflate';
import { PIECES, type Piece } from '../model/params';
import { download, h } from '../ui/controls';
import {
  deleteItem, deleteVersion, listItems, listVersions, newId, putItem, putVersion, sizeLabel,
  type LibItem, type LibVersion,
} from './db';
import { generate, paramsAtSize } from './generate';

export interface LibraryHooks {
  openVersion(item: LibItem, version: LibVersion): void;
  goToEditor(): void;
  toast(text: string): void;
  /** After any change: how many cutters there are. */
  onChange(count: number): void;
}

export interface Entry {
  item: LibItem;
  versions: LibVersion[];
}

const PIECE_LABEL = Object.fromEntries(PIECES.map((p) => [p.value, p.label])) as Record<Piece, string>;
const PIECE_FILE: Record<Piece, string> = { cutter: 'cortador', imprint: 'imprint', stamp: 'sello', set: 'cortador-sello' };
const SIZE_PRESETS = [4, 6, 8, 10, 12, 15];
const NO_CATEGORY = 'Sin categoría';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-')
  .replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'cortante';
const catOf = (i: LibItem) => i.category.trim() || NO_CATEGORY;
const dateFmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
const dimsLabel = (d: [number, number, number]) => `${d.map((v) => v.toLocaleString('es-AR', { maximumFractionDigits: 1 })).join(' × ')} mm`;
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const versionFile = (item: LibItem, v: LibVersion) => `${slug(item.name)}-${Math.round(v.size) / 10}cm-${PIECE_FILE[v.piece]}`;

function icon(paths: string): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${paths}</svg>`;
  return t.content.firstChild as SVGSVGElement;
}
const ICON_SEARCH = '<circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/>';
const ICON_CLOSE = '<path d="M5 5l10 10M15 5L5 15"/>';
const ICON_DOWN = '<path d="M10 3.5V13M6 9l4 4 4-4M3.5 16.5h13"/>';
const ICON_TRASH = '<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10h7.4l.8-10"/>';

/** Object URLs for blobs read from the database, freed when no longer shown. */
class Urls {
  private map = new Map<string, string>();
  get(key: string, blob?: Blob): string | null {
    if (!blob) return null;
    let u = this.map.get(key);
    if (!u) { u = URL.createObjectURL(blob); this.map.set(key, u); }
    return u;
  }
  drop(key: string) {
    const u = this.map.get(key);
    if (u) URL.revokeObjectURL(u);
    this.map.delete(key);
  }
}

export function createLibrary(hooks: LibraryHooks) {
  let entries: Entry[] = [];
  let loaded = false;
  const urls = new Urls();
  const filter = { q: '', category: null as string | null, piece: null as Piece | null };

  // ---------- Filters ----------

  const q = h('input', {
    type: 'search', placeholder: 'Nombre o categoría', 'aria-label': 'Buscar cortantes', autocomplete: 'off',
    onInput: () => { filter.q = q.value; render(); },
  });
  const catList = h('div', { class: 'list', role: 'group', 'aria-label': 'Categoría' });
  const pieceChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Pieza' });
  const sidebar = h('aside', { class: 'sidebar' },
    h('label', { class: 'search' }, icon(ICON_SEARCH), q),
    h('section', { class: 'cat-sec' }, h('h2', {}, 'Categoría'), catList),
    h('section', {}, h('h2', {}, 'Pieza'), pieceChips),
  );

  // ---------- Results ----------

  const count = h('p', { class: 'count' });
  const clearBtn = h('button', { class: 'text', type: 'button', hidden: true, onClick: () => clearFilters() }, 'Quitar filtros');
  const grid = h('div', { class: 'grid' });
  const empty = h('div', { class: 'empty', hidden: true });
  const results = h('section', { class: 'results' },
    h('div', { class: 'results-head' }, count, clearBtn),
    grid,
    empty,
  );
  const cats = h('datalist', { id: 'lib-cats' });
  const el = h('main', { class: 'view library', hidden: true }, sidebar, results, cats);

  function clearFilters() {
    filter.q = '';
    q.value = '';
    filter.category = null;
    filter.piece = null;
    render();
  }

  const matches = (e: Entry, f = filter) => {
    if (f.category && catOf(e.item) !== f.category) return false;
    if (f.piece && !e.versions.some((v) => v.piece === f.piece)) return false;
    const t = f.q.trim().toLowerCase();
    if (t && !`${e.item.name} ${e.item.category}`.toLowerCase().includes(t)) return false;
    return true;
  };

  async function load() {
    const [items, versions] = await Promise.all([listItems(), listVersions()]);
    const byItem = new Map<string, LibVersion[]>();
    for (const v of versions) (byItem.get(v.itemId) ?? byItem.set(v.itemId, []).get(v.itemId)!).push(v);
    entries = items
      .map((item) => ({ item, versions: byItem.get(item.id) ?? [] }))
      .sort((a, b) => b.item.updated - a.item.updated);
    loaded = true;
    cats.replaceChildren(...categories().map((c) => h('option', { value: c })));
    hooks.onChange(entries.length);
  }

  function categories(): string[] {
    return [...new Set(entries.map((e) => e.item.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  }

  function render() {
    // Categories, with how many cutters each has under the other filters.
    const byCat = new Map<string, number>();
    for (const e of entries) if (matches(e, { ...filter, category: null })) byCat.set(catOf(e.item), (byCat.get(catOf(e.item)) ?? 0) + 1);
    const catBtn = (label: string, value: string | null, n: number) =>
      h('button', {
        type: 'button', 'aria-pressed': String(filter.category === value),
        onClick: () => { filter.category = filter.category === value ? null : value; render(); },
      }, label, h('span', {}, String(n)));
    const catNames = [...byCat.keys()].sort((a, b) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b, 'es')));
    if (filter.category && !byCat.has(filter.category)) catNames.push(filter.category);
    catList.replaceChildren(
      catBtn('Todas', null, [...byCat.values()].reduce((a, b) => a + b, 0)),
      ...catNames.map((c) => catBtn(c, c, byCat.get(c) ?? 0)),
    );
    pieceChips.replaceChildren(...PIECES.map((p) =>
      h('button', {
        type: 'button', 'aria-pressed': String(filter.piece === p.value),
        onClick: () => { filter.piece = filter.piece === p.value ? null : p.value; render(); },
      }, p.label),
    ));

    const shown = entries.filter((e) => matches(e));
    const filtered = !!(filter.q.trim() || filter.category || filter.piece);
    count.replaceChildren(
      `${shown.length} ${shown.length === 1 ? 'cortante' : 'cortantes'}`,
      ...(filtered ? [h('small', {}, `de ${entries.length}`)] : []),
    );
    clearBtn.hidden = !filtered;
    sidebar.classList.toggle('is-empty', !entries.length);
    grid.replaceChildren(...shown.map(card));
    empty.hidden = shown.length > 0;
    if (!entries.length) {
      empty.replaceChildren(
        h('p', { class: 'empty-title' }, 'Todavía no hay cortantes guardados'),
        h('p', { class: 'muted' }, 'Cuando guardes o exportes un cortante en Diseñar, queda acá con su SVG, la imagen, los parámetros y el STL.'),
        h('button', { class: 'primary', type: 'button', onClick: () => hooks.goToEditor() }, 'Ir a Diseñar'),
      );
    } else {
      empty.replaceChildren(
        h('p', { class: 'empty-title' }, 'Ningún cortante coincide'),
        h('p', { class: 'muted' }, 'Probá con otra búsqueda o quitá algún filtro.'),
        h('button', { class: 'secondary', type: 'button', onClick: () => clearFilters() }, 'Quitar filtros'),
      );
    }
  }

  function photo(item: LibItem, cls: string): HTMLElement {
    const src = urls.get(`t:${item.id}:${item.updated}`, item.thumb) ?? svgUrl(item.svg);
    const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async', class: item.thumb ? '' : 'flat' });
    return h('div', { class: cls }, img);
  }

  function sizesOf(e: Entry): number[] {
    return [...new Set(e.versions.map((v) => Math.round(v.size)))].sort((a, b) => a - b);
  }

  function card(e: Entry): HTMLElement {
    const sizes = sizesOf(e);
    return h('button', { class: 'lcard', type: 'button', 'aria-label': `${e.item.name}, ${e.versions.length} versiones`, onClick: () => openItem(e.item.id) },
      photo(e.item, 'ph'),
      h('div', { class: 'meta' },
        h('div', { class: 't' }, e.item.name),
        h('div', { class: 's' },
          h('span', { class: 'badge' }, catOf(e.item)),
          h('span', {}, `${e.versions.length} ${e.versions.length === 1 ? 'versión' : 'versiones'}`),
        ),
      ),
      h('div', { class: 'sizes' }, ...sizes.map((s) => h('span', {}, sizeLabel(s)))),
    );
  }

  // ---------- One cutter: details and versions ----------

  const dlg = h('dialog', { class: 'dlg dlg-item', 'aria-labelledby': 'di-title' });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  let openId: string | null = null;
  let lastPiece: Piece | null = null;
  dlg.addEventListener('close', () => { openId = null; });

  async function openItem(id: string) {
    if (!loaded) await load();
    openId = id;
    renderItem();
    if (!dlg.open) dlg.showModal();
  }

  function renderItem() {
    const e = entries.find((x) => x.item.id === openId);
    if (!e) { dlg.close(); return; }
    const { item, versions } = e;

    const saveMeta = async () => {
      const name = nameIn.value.trim() || item.name;
      const category = catIn.value.trim();
      if (name === item.name && category === item.category) return;
      item.name = name;
      item.category = category;
      item.updated = Date.now();
      await putItem(item);
      await refresh();
      hooks.toast('Cambios guardados');
    };
    const nameIn = h('input', { value: item.name, autocomplete: 'off', 'aria-label': 'Nombre', onChange: saveMeta });
    const catIn = h('input', { value: item.category, list: 'lib-cats', placeholder: 'Ej.: fútbol, navidad', autocomplete: 'off', onChange: saveMeta });

    const files = h('div', { class: 'di-files' },
      h('button', { class: 'secondary', type: 'button', onClick: () => download(new Blob([item.svg], { type: 'image/svg+xml' }), `${slug(item.name)}.svg`) },
        icon(ICON_DOWN), 'SVG'),
      item.image ? h('button', { class: 'secondary', type: 'button', onClick: () => download(item.image!, `${slug(item.name)}-imagen.png`) },
        icon(ICON_DOWN), 'Imagen') : null,
      h('button', { class: 'secondary', type: 'button', title: 'SVG, imagen, y parámetros y STL de cada versión', onClick: () => downloadAll(e) },
        icon(ICON_DOWN), 'Todo (.zip)'),
    );

    const removeItem = confirmButton('Borrar cortante', '¿Borrar todo?', async () => {
      await deleteItem(item.id);
      urls.drop(`t:${item.id}:${item.updated}`);
      dlg.close();
      await refresh();
      hooks.toast(`“${item.name}” borrado`);
    }, 'text danger small');

    const side = h('aside', { class: 'di-side' },
      photo(item, 'di-ph'),
      h('label', { class: 'input' }, h('span', {}, 'Nombre'), nameIn),
      h('label', { class: 'input' }, h('span', {}, 'Categoría'), catIn),
      h('div', {},
        h('h3', {}, 'Archivos del diseño'),
        h('p', { class: 'muted small' }, sourceNote(item)),
        files,
      ),
      removeItem,
    );

    const vlist = h('div', { class: 'vlist' }, ...versions.map((v) => versionRow(item, v)));
    if (!versions.length) vlist.append(h('p', { class: 'muted small' }, 'Sin versiones. Generá una abajo.'));

    const main = h('section', { class: 'di-main' },
      h('div', { class: 'sec-head' }, h('h3', {}, 'Versiones'), h('span', { class: 'muted small' }, `${versions.length}`)),
      vlist,
      newVersionForm(e),
    );

    dlg.replaceChildren(
      h('div', { class: 'dlg-head' },
        h('h2', { id: 'di-title' }, item.name),
        h('span', { class: 'badge' }, catOf(item)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onClick: () => dlg.close() }, icon(ICON_CLOSE)),
      ),
      h('div', { class: 'di-body' }, side, main),
    );
  }

  function sourceNote(item: LibItem): string {
    if (item.source === 'image') return `Trazado de ${item.imageName || 'una imagen'}. Las versiones nuevas salen del SVG.`;
    if (item.source === 'text') return `Texto “${item.text ?? ''}”. Las versiones nuevas salen del SVG.`;
    return 'Las versiones nuevas salen de este SVG.';
  }

  function versionRow(item: LibItem, v: LibVersion): HTMLElement {
    const thumb = urls.get(`v:${v.id}:${v.created}`, v.thumb);
    return h('div', { class: 'vrow' },
      h('div', { class: 'vph' }, thumb ? h('img', { src: thumb, alt: '' }) : h('b', {}, sizeLabel(v.size))),
      h('div', { class: 'vinfo' },
        h('div', { class: 'vtitle' }, h('b', {}, sizeLabel(v.size)), h('span', { class: 'badge' }, PIECE_LABEL[v.piece])),
        h('small', {}, `${dimsLabel(v.dims)} · ${dateFmt.format(v.created)}`),
      ),
      h('div', { class: 'vacts' },
        h('button', { class: 'secondary', type: 'button', title: 'Descargar STL', onClick: () => download(v.stl, `${versionFile(item, v)}.stl`) }, icon(ICON_DOWN), 'STL'),
        h('button', { type: 'button', title: 'Descargar los parámetros (JSON)', onClick: () => download(paramsBlob(item, v), `${versionFile(item, v)}-parametros.json`) }, 'Parámetros'),
        h('button', { class: 'secondary', type: 'button', onClick: () => { dlg.close(); hooks.openVersion(item, v); } }, 'Abrir en Diseñar'),
        confirmButton('', 'Borrar', async () => {
          await deleteVersion(v.id);
          urls.drop(`v:${v.id}:${v.created}`);
          await refresh();
          hooks.toast(`Versión de ${sizeLabel(v.size)} borrada`);
        }, 'icon-btn danger', icon(ICON_TRASH), `Borrar la versión de ${sizeLabel(v.size)}`),
      ),
    );
  }

  function newVersionForm(e: Entry): HTMLElement {
    const { item, versions } = e;
    const latest = [...versions].sort((a, b) => b.created - a.created)[0];
    const sizeIn = h('input', { type: 'number', min: '1', max: '40', step: '0.5', inputmode: 'decimal', 'aria-label': 'Tamaño en cm', required: true });
    const pieceSel = h('select', { class: 'select', 'aria-label': 'Pieza' },
      ...PIECES.map((p) => h('option', { value: p.value, selected: p.value === (lastPiece ?? latest?.piece ?? 'cutter') }, p.label)));
    const baseSel = h('select', { class: 'select', 'aria-label': 'Parámetros de' },
      ...versions.map((v) => h('option', { value: v.id, selected: v === latest }, `${sizeLabel(v.size)} · ${PIECE_LABEL[v.piece]}`)));
    const result = h('p', { class: 'result', role: 'status' });
    const go = h('button', { class: 'primary', type: 'submit' }, 'Generar versión');
    const presets = h('div', { class: 'chips presets' }, ...SIZE_PRESETS.map((cm) =>
      h('button', { type: 'button', onClick: () => { sizeIn.value = String(cm); sizeIn.focus(); } }, `${cm} cm`)));

    const form = h('form', { class: 'newv' },
      h('h3', {}, 'Nueva versión'),
      h('p', { class: 'muted small' }, 'Se genera desde el SVG guardado con los parámetros de la versión que elijas, cambiando solo el tamaño (el lado más largo).'),
      presets,
      h('div', { class: 'newv-fields' },
        h('label', { class: 'input' }, h('span', {}, 'Tamaño'), h('span', { class: 'unit' }, sizeIn, h('i', {}, 'cm'))),
        h('label', { class: 'input' }, h('span', {}, 'Pieza'), pieceSel),
        h('label', { class: 'input' }, h('span', {}, 'Parámetros de'), baseSel),
      ),
      h('div', { class: 'actions' }, go, result),
    );
    if (!versions.length) {
      form.replaceChildren(h('h3', {}, 'Nueva versión'), h('p', { class: 'muted small' }, 'Abrí el diseño en Diseñar y guardalo para tener una primera versión con parámetros.'));
      return form;
    }
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const cm = parseFloat(sizeIn.value.replace(',', '.'));
      if (!(cm > 0)) { result.textContent = 'Poné un tamaño en cm.'; result.className = 'result bad'; return; }
      const base = versions.find((v) => v.id === baseSel.value) ?? latest;
      const piece = pieceSel.value as Piece;
      lastPiece = piece;
      const size = cm * 10;
      go.disabled = true;
      go.textContent = 'Generando…';
      result.className = 'result';
      result.textContent = `Generando ${sizeLabel(size)} · ${PIECE_LABEL[piece]}`;
      try {
        const params = paramsAtSize(base.params, size);
        const out = await generate(item.svg, params, piece);
        const same = versions.find((v) => v.piece === piece && Math.round(v.size) === Math.round(size));
        await putVersion({
          id: same?.id ?? newId(), itemId: item.id, piece, params, size, dims: out.dims, stl: out.stl,
          thumb: base.piece === piece ? base.thumb : undefined, created: Date.now(),
        });
        item.updated = Date.now();
        await putItem(item);
        await refresh();
        hooks.toast(`${same ? 'Reemplazada' : 'Lista'} la versión de ${sizeLabel(size)}${out.warnings.length ? ` · ${out.warnings.length} avisos` : ''}`);
      } catch (err) {
        console.error(err);
        go.disabled = false;
        go.textContent = 'Generar versión';
        result.className = 'result bad';
        result.textContent = `No se pudo generar: ${(err as Error).message}`;
      }
    });
    return form;
  }

  function paramsBlob(item: LibItem, v: LibVersion): Blob {
    const data = { app: 'CookieMaker', cortante: item.name, categoria: item.category, pieza: v.piece, tamano_mm: v.size, medidas_mm: v.dims, fecha: new Date(v.created).toISOString(), parametros: v.params };
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }

  async function downloadAll(e: Entry) {
    const { item, versions } = e;
    const files: Record<string, Uint8Array> = { [`${slug(item.name)}.svg`]: strToU8(item.svg) };
    if (item.image) files[`${slug(item.name)}-imagen.png`] = new Uint8Array(await item.image.arrayBuffer());
    for (const v of versions) {
      const base = versionFile(item, v);
      files[`${base}/${base}.stl`] = new Uint8Array(await v.stl.arrayBuffer());
      files[`${base}/${base}-parametros.json`] = new Uint8Array(await paramsBlob(item, v).arrayBuffer());
    }
    download(new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: 'application/zip' }), `${slug(item.name)}.zip`);
  }

  /** A button that asks once more before doing something that can't be undone. */
  function confirmButton(label: string, confirmLabel: string, run: () => void, cls: string, ic?: SVGSVGElement, aria?: string) {
    let armed = false;
    let timer = 0;
    const b = h('button', { class: cls, type: 'button', 'aria-label': aria }, ...(ic ? [ic] : []), label);
    const reset = () => { armed = false; b.classList.remove('armed'); b.replaceChildren(...(ic ? [ic] : []), label); };
    b.addEventListener('click', () => {
      if (armed) { clearTimeout(timer); reset(); run(); return; }
      armed = true;
      b.classList.add('armed');
      b.textContent = confirmLabel;
      timer = window.setTimeout(reset, 3500);
    });
    return b;
  }

  async function refresh() {
    await load();
    if (!el.hidden) render();
    if (openId && dlg.open) renderItem();
  }

  return {
    el,
    async show() { await load(); render(); },
    refresh,
    openItem,
    get: (id: string) => entries.find((e) => e.item.id === id),
    categories,
    ready: () => (loaded ? Promise.resolve() : load()),
  };
}
