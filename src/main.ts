import './ui/styles.css';
import GeoWorker from './geometry/worker?worker&inline';
import { Viewer } from './viewer/viewer';
import {
  DEFAULTS, PARTS_MODES, PIECES, SECTIONS, cloneParams,
  type FieldMeta, type FieldContext, type Params, type Piece, type Units,
} from './model/params';
import {
  BASE_PROFILE, applyProfile, deleteProfile, isModified, listProfiles, loadSession, saveProfile, saveSession,
} from './model/profiles';
import type { BuildRequest, BuildResult, Issue, MeshOut } from './geometry/protocol';
import { designBounds, type Design } from './input/types';
import { parseSvg } from './input/svg';
import { BUILTIN_FONTS, registerFont, textToDesign } from './input/text';
import { binarize, imageDataToUrl, traceImage } from './input/image';
import { SAMPLES } from './input/samples';
import { toStl } from './export/stl';
import { to3mf } from './export/threemf';
import { download, h, segmented, select, setRangeFill, toggle } from './ui/controls';
import { isImageEditorOpen, openImageEditor } from './ui/imageEditor';

// ---------- State ----------

type Source = 'svg' | 'image' | 'text';

interface State {
  source: Source;
  piece: Piece;
  units: Units;
  params: Params;
  profile: string;
  svgText: string;
  svgName: string;
  image: ImageBitmap | null;
  /** The image as loaded, before any edit. */
  imageOriginal: ImageBitmap | null;
  imageName: string;
  text: string;
  fontId: string;
  letterSpacing: number;
  lineHeight: number;
}

const session = loadSession();
// Sizes saved while the design kept shrinking on reload: start over.
if (session && Math.max(session.params.sizeW, session.params.sizeH) < 10) {
  session.params.sizeW = DEFAULTS.sizeW;
  session.params.sizeH = DEFAULTS.sizeH;
}
const state: State = {
  source: 'svg',
  piece: 'cutter',
  units: 'mm',
  params: session ? session.params : cloneParams(DEFAULTS),
  profile: session?.profile ?? BASE_PROFILE,
  svgText: SAMPLES[0].svg,
  svgName: SAMPLES[0].label,
  image: null,
  imageOriginal: null,
  imageName: '',
  text: 'Hola',
  fontId: 'fredoka',
  letterSpacing: 0,
  lineHeight: 1.1,
};
try {
  const ui = JSON.parse(localStorage.getItem('cookiemaker.ui.v1') || '{}');
  if (ui.piece) state.piece = ui.piece;
  if (ui.units) state.units = ui.units;
} catch {
  /* first visit */
}

let design: Design | null = null;
// Start from the saved proportions so nothing rescales before the first build.
const savedAspect = state.params.sizeH / state.params.sizeW;
let designAspect = isFinite(savedAspect) && savedAspect > 0 ? savedAspect : 1; // height / width of the design as built
let sourceAspect = designAspect; // height / width of the whole input design
let lastResult: BuildResult | null = null;
let binPreview = '';

const ctx = (): FieldContext => ({ piece: state.piece, source: state.source });

// ---------- Layout ----------

const app = document.getElementById('app')!;
const stage = h('div', { class: 'stage' });
const viewer = new Viewer(stage);
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
viewer.setTheme(darkQuery.matches);
darkQuery.addEventListener('change', (e) => viewer.setTheme(e.matches));
viewer.buildBed(state.params.bedSize);
viewer.setEdges(state.params.showEdges);

const pieceSeg = segmented(PIECES, state.piece, (v) => {
  state.piece = v;
  persistUi();
  refreshVisibility();
  refreshPartsCard();
  requestBuild(true);
}, 'pill wide');
const topbar = h('div', { class: 'topbar glass' }, pieceSeg.el);

const leftScroll = h('div', { class: 'scroll' });
const sourceSeg = segmented<Source>(
  [{ value: 'svg', label: 'SVG' }, { value: 'image', label: 'Imagen' }, { value: 'text', label: 'Texto' }],
  state.source,
  (v) => setSource(v),
);
const left = h('aside', { class: 'left glass', 'aria-label': 'Entrada' },
  h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, 'CookieMaker')),
  h('div', { style: { padding: '0 0.875rem 0.25rem' } }, sourceSeg.el),
  leftScroll,
);

const rightScroll = h('div', { class: 'scroll' });
const unitsSeg = segmented<Units>([{ value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }], state.units, (v) => {
  state.units = v;
  persistUi();
  rows.forEach((r) => r.update());
  updateBottom();
});
const profileSelect = h('select', { class: 'select', 'aria-label': 'Perfil' });
const modifiedTag = h('span', { class: 'modified' });
const revertBtn = h('button', {
  class: 'btn small', type: 'button', title: 'Volver a los valores guardados del perfil', hidden: true,
  onClick: () => onRevertProfile(),
}, 'Revertir');
const right = h('aside', { class: 'right glass', 'aria-label': 'Parámetros' },
  h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, 'Ajustes'), unitsSeg.el),
  h('div', { class: 'profile-bar' },
    profileSelect,
    modifiedTag,
    revertBtn,
    h('button', { class: 'btn small', type: 'button', onClick: () => onSaveProfile() }, 'Guardar'),
  ),
  rightScroll,
);

const dimsEl = h('span', { class: 'dims' }, '—');
const dot = h('span', { class: 'dot busy' });
const statusText = h('span', {}, 'Generando');
const statusBtn = h('button', {
  class: 'btn status-pill', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
  onClick: () => togglePopover(),
}, dot, statusText);
const popover = h('div', { class: 'popover glass', role: 'dialog', 'aria-label': 'Avisos' });
const bottombar = h('div', { class: 'bottombar glass' },
  dimsEl,
  statusBtn,
  h('button', { class: 'btn', type: 'button', onClick: () => exportAs('stl') }, 'STL'),
  h('button', { class: 'btn primary', type: 'button', onClick: () => exportAs('3mf') }, 'Exportar 3MF'),
);
const views = h('div', { class: 'views glass' },
  h('button', { class: 'btn icon', type: 'button', onClick: () => viewer.view('iso') }, '3D'),
  h('button', { class: 'btn icon', type: 'button', onClick: () => viewer.view('top') }, 'Arriba'),
  h('button', { class: 'btn icon', type: 'button', onClick: () => viewer.view('bottom') }, 'Abajo'),
  h('button', { class: 'btn icon', type: 'button', onClick: () => viewer.frame() }, 'Encuadrar'),
);
const toast = h('div', { class: 'toast glass', role: 'status' });

// Separate shapes in the cutter + stamp set: pick what to do with them.
const partsTitle = h('strong');
const partsHint = h('div', { class: 'parts-hint' });
const partsSeg = segmented(PARTS_MODES, state.params.partsMode, (v) => {
  setParam('partsMode', v);
  refreshPartsCard();
}, 'pill');
const partsCard = h('div', { class: 'parts-card', role: 'group', 'aria-label': 'Formas separadas', hidden: true },
  h('div', { class: 'parts-head' },
    h('span', { class: 'parts-icon', 'aria-hidden': 'true' }, 'i'),
    h('div', {}, partsTitle, h('small', {}, 'Elegí qué hacer con ellas')),
  ),
  partsSeg.el,
  partsHint,
);

function refreshPartsCard() {
  const n = lastResult?.ok ? lastResult.shapes : 0;
  const show = state.piece === 'set' && n > 1 && state.params.envelope === 'none';
  partsCard.hidden = !show;
  if (!show) return;
  partsTitle.textContent = `Se detectaron ${n} formas separadas`;
  partsSeg.set(state.params.partsMode);
  partsHint.textContent = PARTS_MODES.find((m) => m.value === state.params.partsMode)!.hint;
}

stage.append(views);
const syncInsets = () => {
  if (innerWidth <= 860) return viewer.setInsets(0, 0);
  const l = left.getBoundingClientRect(), r = right.getBoundingClientRect();
  viewer.setInsets(l.right + 8, innerWidth - r.left + 8);
};
new ResizeObserver(syncInsets).observe(document.body);
left.append(partsCard);
app.append(stage, topbar, left, right, popover, bottombar, toast);

// ---------- Input panel ----------

const fileInput = h('input', { type: 'file', hidden: true, onChange: () => fileInput.files?.[0] && loadFile(fileInput.files[0]) });
document.body.append(fileInput);

function dropZone(title: string, sub: string, accept: string): HTMLElement {
  const z = h('div', {
    class: 'drop', role: 'button', tabindex: '0',
    onClick: () => { fileInput.accept = accept; fileInput.click(); },
    onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.accept = accept; fileInput.click(); } },
  }, h('strong', {}, title), h('small', {}, sub));
  return z;
}

function renderLeft() {
  leftScroll.replaceChildren();
  if (state.source === 'svg') {
    leftScroll.append(
      dropZone('Elegir un SVG', 'o arrastralo o pegalo con Ctrl+V', '.svg,image/svg+xml'),
      h('div', { class: 'file-name' }, state.svgName),
      h('div', { class: 'group-title' }, 'Ejemplos'),
      h('div', { class: 'chips' }, SAMPLES.map((s) =>
        h('button', { class: 'btn small', type: 'button', onClick: () => { state.svgText = s.svg; state.svgName = s.label; renderLeft(); updateDesign(); } }, s.label),
      )),
    );
  } else if (state.source === 'image') {
    leftScroll.append(dropZone('Elegir una imagen', 'o pegala con Ctrl+V. Mejor una silueta o un dibujo con líneas limpias', 'image/*'));
    if (state.imageName) leftScroll.append(h('div', { class: 'file-name' }, state.imageName));
    if (state.image) {
      leftScroll.append(h('button', { class: 'btn small edit-btn', type: 'button', onClick: () => editImage() }, 'Editar imagen'));
    }
    if (binPreview) {
      leftScroll.append(h('div', { class: 'preview' },
        h('img', { src: binPreview, alt: 'Vista binarizada' }),
        h('div', { class: 'cap' }, 'Así ve la imagen el trazado. Ajustá el umbral en Diseño.'),
      ));
    }
  } else {
    const ta = h('textarea', {
      class: 'text-in', 'aria-label': 'Texto', value: state.text, rows: 2,
      onInput: () => { state.text = ta.value; updateDesign(); },
    });
    const fontSel = select(
      [...BUILTIN_FONTS.map((f) => ({ value: f.id, label: f.label })), ...(customFonts.map((f) => ({ value: f, label: f })))],
      state.fontId,
      (v) => { state.fontId = v; updateDesign(); },
      'Fuente',
    );
    const spacing = h('input', {
      type: 'range', min: '-20', max: '40', step: '1', value: String(state.letterSpacing), 'aria-label': 'Espaciado',
      onInput: () => { state.letterSpacing = +spacing.value; setRangeFill(spacing); spacingVal.textContent = spacing.value; updateDesign(); },
    });
    const spacingVal = h('span', { class: 'label', style: { color: 'var(--text-2)' } }, String(state.letterSpacing));
    setRangeFill(spacing);
    leftScroll.append(
      ta,
      h('div', { class: 'group', style: { marginTop: '0.75rem' } },
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Fuente'), fontSel),
        h('div', { class: 'row slider' }, h('span', { class: 'label' }, 'Espaciado'), spacingVal, spacing),
        h('div', { class: 'row' },
          h('span', { class: 'label' }, 'Fuente propia'),
          h('button', { class: 'btn small', type: 'button', onClick: () => { fileInput.accept = '.ttf,.otf,.woff'; fileInput.click(); } }, 'Cargar'),
        ),
      ),
    );
  }
}

const customFonts: string[] = [];

async function loadFile(file: File) {
  fileInput.value = '';
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.svg') || file.type === 'image/svg+xml') {
      state.svgText = await file.text();
      state.svgName = file.name;
      setSource('svg');
    } else if (/\.(ttf|otf|woff)$/.test(name)) {
      registerFont(file.name, await file.arrayBuffer());
      if (!customFonts.includes(file.name)) customFonts.push(file.name);
      state.fontId = file.name;
      setSource('text');
    } else if (file.type.startsWith('image/')) {
      const original = await createImageBitmap(file);
      const edited = await openImageEditor(original);
      if (!edited) return; // cancelled: keep whatever was there
      state.imageOriginal = original;
      state.image = edited;
      state.imageName = file.name;
      setSource('image');
    } else {
      showToast('Ese tipo de archivo no se puede usar');
    }
  } catch (e) {
    showToast(`No se pudo abrir ${file.name}`);
    console.error(e);
  }
}

async function editImage() {
  if (!state.image || isImageEditorOpen()) return;
  const edited = await openImageEditor(state.image, state.imageOriginal ?? state.image);
  if (!edited) return;
  state.image = edited;
  updateDesign(true);
}

function setSource(s: Source) {
  const changed = s !== state.source;
  state.source = s;
  sourceSeg.set(s);
  // Text usually wants every hole cut (O, A, B); drawings only the outline.
  if (changed) {
    state.params.cutMode = s === 'text' ? 'holes' : 'outline';
    state.params.reliefMode = s === 'svg' ? 'edges' : 'fill';
    rows.forEach((r) => r.update());
  }
  renderLeft();
  refreshVisibility();
  updateDesign(true);
}

// Drag and drop anywhere on the page.
window.addEventListener('dragover', (e) => { e.preventDefault(); if (isImageEditorOpen()) return; document.querySelector('.drop')?.classList.add('over'); });
window.addEventListener('dragleave', () => document.querySelector('.drop')?.classList.remove('over'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.querySelector('.drop')?.classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f && !isImageEditorOpen()) loadFile(f);
});

// Paste an image (or SVG code) copied from anywhere, without saving it first.
window.addEventListener('paste', (e) => {
  if (isImageEditorOpen()) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
  const cd = e.clipboardData;
  if (!cd) return;
  const file = [...cd.files].find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    const ext = file.type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
    loadFile(file.name && file.name !== 'image.png' ? file : new File([file], `imagen-pegada.${ext}`, { type: file.type }));
    return;
  }
  const text = cd.getData('text/plain').trim();
  if (/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) {
    e.preventDefault();
    loadFile(new File([text], 'svg-pegado.svg', { type: 'image/svg+xml' }));
  }
});

// ---------- Design ----------

let designSeq = 0;
async function updateDesign(frame = false) {
  const seq = ++designSeq;
  const p = state.params;
  let d: Design | null = null;
  try {
    if (state.source === 'svg') {
      d = parseSvg(state.svgText, p.resolution);
    } else if (state.source === 'text') {
      d = state.text.trim() ? await textToDesign({
        text: state.text, fontId: state.fontId, letterSpacing: state.letterSpacing,
        lineHeight: state.lineHeight, resolution: p.resolution,
      }) : null;
    } else if (state.image) {
      const bw = binarize(state.image, p.threshold, p.invertImage);
      binPreview = imageDataToUrl(bw);
      d = await traceImage(bw, p.resolution);
      if (seq === designSeq) renderLeft();
    }
  } catch (e) {
    console.error(e);
    showToast('No se pudo leer el diseño');
  }
  if (seq !== designSeq) return; // a newer edit superseded this one
  design = d;
  const bb = d && designBounds(d);
  if (bb) {
    const newAspect = (bb.maxY - bb.minY) / Math.max(1e-9, bb.maxX - bb.minX);
    if (p.lockAspect && Math.abs(newAspect - sourceAspect) > 1e-6) {
      // Keep the longest side when a new design comes in. Read it from the
      // saved size, not the aspect: after a reload the aspect starts at 1 and
      // the width alone would shrink the design a bit on every visit.
      const longest = Math.max(p.sizeW, p.sizeH);
      p.sizeW = round(newAspect > 1 ? longest / newAspect : longest, 2);
      p.sizeH = round(p.sizeW * newAspect, 2);
    }
    designAspect = sourceAspect = newAspect;
    rows.forEach((r) => r.update());
  }
  requestBuild(frame);
}

// ---------- Geometry worker (latest request wins) ----------

const worker = new GeoWorker();
let busy = false;
let pending: BuildRequest | null = null;
let reqId = 0;
let frameNext = true;
let busyTimer = 0;

function requestBuild(frame = false) {
  if (frame) frameNext = true;
  if (!design) {
    viewer.setMeshes([]);
    lastResult = null;
    setStatus([{ level: 'warn', text: state.source === 'image' ? 'Cargá una imagen para empezar.' : 'No hay nada para generar todavía.' }], false);
    return;
  }
  pending = { id: ++reqId, design, params: cloneParams(state.params), piece: state.piece };
  pump();
}

function pump() {
  if (busy || !pending) return;
  busy = true;
  const req = pending;
  pending = null;
  clearTimeout(busyTimer);
  busyTimer = window.setTimeout(() => setBusy(true), 120);
  worker.postMessage(req);
}

worker.onmessage = (ev: MessageEvent<BuildResult>) => {
  busy = false;
  clearTimeout(busyTimer);
  const res = ev.data;
  if (pending) {
    pump();
    return; // a newer request is already on its way
  }
  setBusy(false);
  if (!res.ok) {
    setStatus([{ level: 'error', text: res.error || 'Error al generar.' }, ...res.issues], true);
    return;
  }
  lastResult = res;
  viewer.setMeshes(res.meshes);
  if (frameNext) {
    viewer.frame();
    frameNext = false;
  }
  setStatus(res.issues, true);
  updateBottom();
  refreshPartsCard();
  // "Largest only" builds part of the design: follow its proportions.
  const p = state.params;
  if (p.lockAspect && res.aspect > 0 && Math.abs(res.aspect / designAspect - 1) > 0.01) {
    const longest = Math.max(p.sizeW, p.sizeH);
    designAspect = res.aspect;
    p.sizeW = round(designAspect > 1 ? longest / designAspect : longest, 2);
    p.sizeH = round(p.sizeW * designAspect, 2);
    rows.forEach((r) => r.update());
    saveSession({ params: p, profile: state.profile });
    requestBuild(true);
  }
};

worker.onerror = (e) => {
  busy = false;
  setBusy(false);
  console.error('worker error', e.message, e.filename, e.lineno);
  setStatus([{ level: 'error', text: 'El generador falló. Recargá la página.' }], true);
};

// ---------- Status, issues, bottom bar ----------

let issues: Issue[] = [];
function setBusy(on: boolean) {
  if (on) {
    dot.className = 'dot busy';
    statusText.textContent = 'Generando';
  } else {
    setStatus(issues, true);
  }
}

function setStatus(list: Issue[], done: boolean) {
  issues = list;
  if (!done) return;
  const errors = list.filter((i) => i.level === 'error').length;
  const warns = list.filter((i) => i.level === 'warn').length;
  dot.className = `dot ${errors ? 'error' : warns ? 'warn' : ''}`;
  statusText.textContent = errors
    ? `${errors} ${errors === 1 ? 'error' : 'errores'}`
    : warns
      ? `${warns} ${warns === 1 ? 'aviso' : 'avisos'}`
      : 'Listo para imprimir';
  popover.replaceChildren(
    ...(list.length ? list : [{ level: 'info', text: 'Sin problemas de imprimibilidad.' } as Issue]).map((i) =>
      h('div', { class: `issue ${i.level}` }, h('span', { class: `dot ${i.level === 'error' ? 'error' : i.level === 'warn' ? 'warn' : ''}` }), h('div', {}, i.text)),
    ),
  );
}

function togglePopover(force?: boolean) {
  const open = force ?? !popover.classList.contains('open');
  popover.classList.toggle('open', open);
  statusBtn.setAttribute('aria-expanded', String(open));
}
window.addEventListener('pointerdown', (e) => {
  if (popover.classList.contains('open') && !popover.contains(e.target as Node) && !statusBtn.contains(e.target as Node)) togglePopover(false);
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') togglePopover(false); });

function updateBottom() {
  if (!lastResult) {
    dimsEl.textContent = '—';
    return;
  }
  const [x, y, z] = lastResult.size;
  const u = state.units;
  const f = (v: number) => (u === 'in' ? (v / 25.4).toFixed(2) : v.toFixed(1));
  dimsEl.textContent = `${f(x)} × ${f(y)} × ${f(z)} ${u}`;
}

let toastTimer = 0;
function showToast(text: string) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function exportAs(kind: 'stl' | '3mf') {
  if (!lastResult?.ok) {
    showToast('Todavía no hay un modelo para exportar');
    return;
  }
  const parts: MeshOut[] = lastResult.meshes.filter((m) => m.role === 'part');
  const base = baseName();
  const pieceName = { cutter: 'cortador', imprint: 'imprint', stamp: 'sello', set: 'cortador-sello' }[state.piece];
  const blob = kind === 'stl' ? toStl(parts) : to3mf(parts);
  download(blob, `${base}-${pieceName}.${kind}`);
  showToast(kind === 'stl' ? 'STL descargado' : '3MF descargado');
}

function baseName(): string {
  const raw = state.source === 'svg' ? state.svgName : state.source === 'image' ? state.imageName : state.text;
  return (raw || 'galleta').replace(/\.[a-z0-9]+$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'galleta';
}

// ---------- Parameter panel ----------

interface RowHandle {
  key?: keyof Params;
  el: HTMLElement;
  meta?: FieldMeta;
  section: string;
  update(): void;
}
const rows: RowHandle[] = [];
const sectionEls = new Map<string, HTMLElement>();
const moreEls = new Map<string, HTMLElement>();

const isLen = (m: FieldMeta) => m.kind === 'len';
const toDisplay = (m: FieldMeta, v: number) => (isLen(m) && state.units === 'in' ? v / 25.4 : v);
const fromDisplay = (m: FieldMeta, v: number) => (isLen(m) && state.units === 'in' ? v * 25.4 : v);
const unitLabel = (m: FieldMeta) => (m.kind === 'len' ? state.units : m.kind === 'deg' ? '°' : m.kind === 'pct' ? '%' : '');
const decimals = (m: FieldMeta) => (isLen(m) && state.units === 'in' ? 3 : (m.step ?? 1) < 1 ? String(m.step).split('.')[1].length : 0);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

const DESIGN_PARAMS = new Set<keyof Params>(['resolution', 'threshold', 'invertImage']);

function setParam<K extends keyof Params>(key: K, value: Params[K]) {
  state.params[key] = value;
  if (key === 'bedSize') viewer.buildBed(value as number);
  if (key === 'showEdges') viewer.setEdges(value as boolean);
  refreshVisibility();
  refreshProfile();
  saveSession({ params: state.params, profile: state.profile });
  if (key === 'showEdges') return;
  if (DESIGN_PARAMS.has(key)) updateDesign();
  else requestBuild();
}

function numberRow(m: FieldMeta, section: string): RowHandle {
  const key = m.key;
  const range = h('input', { type: 'range', min: String(m.min), max: String(m.max), step: String(m.step ?? 1), 'aria-label': m.label });
  const num = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': `${m.label} (valor)` });
  const unit = h('span');
  range.addEventListener('input', () => {
    setRangeFill(range);
    const v = +range.value;
    num.value = String(round(toDisplay(m, v), decimals(m)));
    setParam(key, v as any);
  });
  const commit = () => {
    const raw = parseFloat(num.value.replace(',', '.'));
    if (!isFinite(raw)) return update();
    const v = round(fromDisplay(m, raw), 4);
    setParam(key, v as any);
    update();
  };
  num.addEventListener('change', commit);
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); });
  const el = h('div', { class: 'row slider' },
    h('label', {}, m.label),
    h('span', { class: 'num' }, num, unit),
    range,
    m.hint ? h('div', { class: 'hint' }, m.hint) : null,
  );
  const update = () => {
    const v = state.params[key] as number;
    range.value = String(Math.min(m.max!, Math.max(m.min!, v)));
    setRangeFill(range);
    num.value = String(round(toDisplay(m, v), decimals(m)));
    unit.textContent = unitLabel(m);
  };
  update();
  return { key, el, meta: m, section, update };
}

function boolRow(m: FieldMeta, section: string): RowHandle {
  const t = toggle(state.params[m.key] as boolean, (v) => setParam(m.key, v as any), m.label);
  const el = h('div', { class: 'row' }, h('span', { class: 'label' }, m.label), t.el, m.hint ? h('div', { class: 'hint' }, m.hint) : null);
  return { key: m.key, el, meta: m, section, update: () => { t.input.checked = state.params[m.key] as boolean; } };
}

function choiceRow(m: FieldMeta, section: string): RowHandle {
  const opts = m.choices!;
  if (opts.length <= 3) {
    const seg = segmented(opts, state.params[m.key] as string, (v) => setParam(m.key, v as any));
    const el = h('div', { class: 'row', style: { gridTemplateColumns: '1fr' } },
      h('span', { class: 'label' }, m.label), seg.el, m.hint ? h('div', { class: 'hint' }, m.hint) : null);
    return { key: m.key, el, meta: m, section, update: () => seg.set(state.params[m.key] as string) };
  }
  const s = select(opts, state.params[m.key] as string, (v) => setParam(m.key, v as any), m.label);
  const el = h('div', { class: 'row' }, h('span', { class: 'label' }, m.label), s, m.hint ? h('div', { class: 'hint' }, m.hint) : null);
  return { key: m.key, el, meta: m, section, update: () => { s.value = state.params[m.key] as string; } };
}

function sizeRow(): RowHandle {
  const mW: FieldMeta = { key: 'sizeW', label: 'Ancho', kind: 'len', step: 0.5 };
  const w = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Ancho' });
  const hh = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Alto' });
  const uw = h('span'), uh = h('span');
  const lock = h('button', {
    class: 'lock', type: 'button', title: 'Mantener proporción',
    onClick: () => {
      state.params.lockAspect = !state.params.lockAspect;
      if (state.params.lockAspect) state.params.sizeH = round(state.params.sizeW * designAspect, 2);
      update();
      setParam('lockAspect', state.params.lockAspect);
    },
  });
  const commit = (which: 'w' | 'h') => {
    const raw = parseFloat((which === 'w' ? w : hh).value.replace(',', '.'));
    if (!isFinite(raw) || raw <= 0) return update();
    const v = fromDisplay(mW, raw);
    const p = state.params;
    if (which === 'w') {
      p.sizeW = round(v, 3);
      if (p.lockAspect) p.sizeH = round(v * designAspect, 3);
    } else {
      p.sizeH = round(v, 3);
      if (p.lockAspect) p.sizeW = round(v / designAspect, 3);
    }
    update();
    setParam('sizeW', p.sizeW);
  };
  for (const [inp, which] of [[w, 'w'], [hh, 'h']] as const) {
    inp.addEventListener('change', () => commit(which));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  }
  const el = h('div', { class: 'row' },
    h('span', { class: 'label' }, 'Tamaño'),
    h('div', { class: 'size-row' },
      h('span', { class: 'num' }, w, uw),
      lock,
      h('span', { class: 'num' }, hh, uh),
    ),
    h('div', { class: 'hint' }, 'Ancho y alto del diseño, del lado de corte.'),
  );
  const update = () => {
    const p = state.params;
    const d = state.units === 'in' ? 3 : 1;
    if (p.lockAspect) p.sizeH = round(p.sizeW * designAspect, 3);
    w.value = String(round(toDisplay(mW, p.sizeW), d));
    hh.value = String(round(toDisplay(mW, p.sizeH), d));
    uw.textContent = uh.textContent = state.units;
    lock.setAttribute('aria-pressed', String(p.lockAspect));
    lock.innerHTML = p.lockAspect
      ? '<svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="6" width="10" height="7" rx="1.6" fill="currentColor"/><path d="M3.2 6V4.2a2.8 2.8 0 0 1 5.6 0V6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
      : '<svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="6" width="10" height="7" rx="1.6" fill="currentColor"/><path d="M3.2 6V4.2a2.8 2.8 0 0 1 5.4-1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  };
  update();
  return { el, section: 'design', update };
}

function bridgesBlock(): RowHandle {
  const list = h('div');
  const el = h('div', {}, list);
  const update = () => {
    list.replaceChildren();
    const bridges = state.params.manualBridges;
    if (!bridges.length) list.append(h('div', { class: 'empty-note' }, 'Sin puentes manuales.'));
    bridges.forEach((b, i) => {
      const field = (label: string, key: 'angle' | 'pos' | 'width', unit: string) => {
        const inp = h('input', {
          type: 'text', inputmode: 'decimal', 'aria-label': `Puente ${i + 1}: ${label}`, title: label,
          value: String(key === 'width' && state.units === 'in' ? round(b[key] / 25.4, 3) : b[key]),
          onChange: () => {
            let v = parseFloat(inp.value.replace(',', '.'));
            if (!isFinite(v)) return update();
            if (key === 'width' && state.units === 'in') v *= 25.4;
            if (key === 'angle') v = Math.min(179, Math.max(0, v));
            if (key === 'pos') v = Math.min(100, Math.max(0, v));
            b[key] = v;
            setParam('manualBridges', state.params.manualBridges);
          },
        });
        return h('span', { class: 'num' }, inp, h('span', {}, unit));
      };
      list.append(h('div', { class: 'bridge-row' },
        field('Ángulo', 'angle', '°'),
        field('Posición', 'pos', '%'),
        field('Ancho', 'width', state.units),
        h('button', {
          class: 'btn icon x', type: 'button', 'aria-label': `Quitar puente ${i + 1}`,
          onClick: () => { state.params.manualBridges.splice(i, 1); update(); setParam('manualBridges', state.params.manualBridges); },
        }, '✕'),
      ));
    });
    list.append(h('div', { class: 'row' },
      h('span', { class: 'label' }, 'Puentes manuales'),
      h('button', {
        class: 'btn small', type: 'button',
        onClick: () => {
          state.params.manualBridges.push({ angle: 90, pos: 50, width: state.params.bridgeWidth });
          update();
          setParam('manualBridges', state.params.manualBridges);
        },
      }, 'Agregar'),
    ));
  };
  update();
  return { el, section: 'bridges', update };
}

function modifiersBlock(): RowHandle {
  const list = h('div');
  const el = h('div', {}, list);
  const u = () => state.units;
  const toUnit = (v: number) => (u() === 'in' ? round(v / 25.4, 3) : round(v, 2));
  const fromUnit = (v: number) => (u() === 'in' ? v * 25.4 : v);
  const changed = () => setParam('modifiers', state.params.modifiers);
  const update = () => {
    list.replaceChildren();
    const mods = state.params.modifiers;
    if (!mods.length) {
      list.append(h('div', { class: 'empty-note' },
        'Zonas con su propio grosor mínimo, como los modificadores de un slicer. Fuera de ellas vale el ajuste general de Avanzado.'));
    }
    mods.forEach((m, i) => {
      const num = (label: string, key: 'x' | 'y' | 'w' | 'h' | 'minThickness') => {
        const inp = h('input', {
          type: 'text', inputmode: 'decimal', 'aria-label': `Zona ${i + 1}: ${label}`, value: String(toUnit(m[key])),
          onChange: () => {
            const v = parseFloat(inp.value.replace(',', '.'));
            if (!isFinite(v)) return update();
            m[key] = key === 'x' || key === 'y' ? fromUnit(v) : Math.max(key === 'minThickness' ? 0.2 : 0.5, fromUnit(v));
            changed();
            update();
          },
          onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') inp.blur(); },
        });
        return h('label', { class: 'mod-field' }, h('span', {}, label), h('span', { class: 'num' }, inp, h('span', {}, u())));
      };
      const shape = segmented([{ value: 'circle', label: 'Círculo' }, { value: 'rect', label: 'Rectángulo' }], m.shape, (v) => {
        m.shape = v as 'circle' | 'rect';
        changed();
      });
      const force = toggle(m.forceMinThickness, (v) => { m.forceMinThickness = v; changed(); }, `Zona ${i + 1}: forzar grosor mínimo`);
      list.append(h('div', { class: 'mod-card' },
        h('div', { class: 'mod-head' },
          h('span', { class: 'mod-dot', 'aria-hidden': 'true' }),
          h('strong', {}, `Zona ${i + 1}`),
          h('button', {
            class: 'btn icon x', type: 'button', 'aria-label': `Quitar zona ${i + 1}`,
            onClick: () => { mods.splice(i, 1); changed(); update(); },
          }, '✕'),
        ),
        shape.el,
        h('div', { class: 'mod-grid' }, num('X', 'x'), num('Y', 'y'), num('Ancho', 'w'), num('Alto', 'h')),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Forzar grosor mínimo'), force.el),
        num('Grosor mínimo', 'minThickness'),
      ));
    });
    list.append(h('div', { class: 'row' },
      h('span', { class: 'label' }, mods.length ? 'Arrastrá las zonas en la vista 3D' : 'Zonas'),
      h('button', {
        class: 'btn small', type: 'button',
        onClick: () => {
          const p = state.params;
          const size = Math.round(Math.max(8, Math.min(p.sizeW, p.sizeH) / 4));
          mods.push({ shape: 'circle', x: 0, y: 0, w: size, h: size, forceMinThickness: true, minThickness: p.minThickness });
          changed();
          update();
        },
      }, 'Agregar zona'),
    ));
  };
  update();
  return { el, section: 'modifiers', update };
}

// Dragging a zone in the 3D view moves it.
viewer.onModifierMove = (index, dx, dy) => {
  const m = state.params.modifiers[index];
  if (!m) return;
  m.x = round(m.x + dx, 2);
  m.y = round(m.y + dy, 2);
  rows.find((r) => r.section === 'modifiers' && !r.key)?.update();
  setParam('modifiers', state.params.modifiers);
};

function buildPanel() {
  for (const sec of SECTIONS) {
    const main = h('div', { class: 'group' });
    const moreInner = h('div', { class: 'more-inner' });
    const more = h('div', { class: 'more' }, moreInner);
    const add = (r: RowHandle, adv?: boolean) => {
      rows.push(r);
      (adv ? moreInner : main).append(r.el);
    };
    if (sec.id === 'design') add(sizeRow());
    for (const m of sec.fields) {
      const r = m.kind === 'bool' ? boolRow(m, sec.id) : m.kind === 'choice' ? choiceRow(m, sec.id) : numberRow(m, sec.id);
      add(r, m.adv);
    }
    if (sec.id === 'bridges') add(bridgesBlock(), true);
    if (sec.id === 'modifiers') add(modifiersBlock());
    const hasAdv = moreInner.childElementCount > 0;
    if (hasAdv) {
      const btn = h('button', {
        class: 'more-toggle', type: 'button', 'aria-expanded': 'false',
        onClick: () => {
          const open = !more.classList.contains('open');
          more.classList.toggle('open', open);
          btn.setAttribute('aria-expanded', String(open));
          btn.firstChild!.textContent = open ? 'Menos opciones' : 'Más opciones';
        },
      }, h('span', {}, 'Más opciones'), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
      main.append(more, btn);
      moreEls.set(sec.id, more);
    }
    const wrap = h('section', {}, h('div', { class: 'group-title' }, sec.title), main);
    sectionEls.set(sec.id, wrap);
    rightScroll.append(wrap);
  }
}

function refreshVisibility() {
  const c = ctx();
  for (const sec of SECTIONS) sectionEls.get(sec.id)!.hidden = !sec.pieces.includes(c.piece);
  for (const r of rows) {
    if (r.meta?.when) r.el.hidden = !r.meta.when(state.params, c);
  }
}

// ---------- Profiles ----------

function renderProfiles() {
  profileSelect.replaceChildren(
    ...listProfiles().map((n) => h('option', { value: n, selected: n === state.profile }, n)),
    h('option', { value: '__new' }, 'Guardar como nuevo…'),
    ...(state.profile !== BASE_PROFILE ? [h('option', { value: '__delete' }, `Borrar “${state.profile}”`)] : []),
  );
  refreshProfile();
}

profileSelect.addEventListener('change', () => {
  const v = profileSelect.value;
  if (v === '__new') {
    onSaveProfile(true);
  } else if (v === '__delete') {
    deleteProfile(state.profile);
    showToast(`Perfil “${state.profile}” borrado`);
    state.profile = BASE_PROFILE;
  } else {
    state.profile = v;
    loadProfileParams();
    showToast(`Perfil “${v}” aplicado`);
  }
  saveSession({ params: state.params, profile: state.profile });
  renderProfiles();
});

function onSaveProfile(asNew = false) {
  let name = state.profile;
  if (asNew || name === BASE_PROFILE) {
    const n = prompt('Nombre del perfil', name === BASE_PROFILE ? 'Mi impresora' : `${name} 2`);
    if (!n?.trim()) return renderProfiles();
    name = n.trim();
  }
  saveProfile(name, state.params);
  state.profile = name;
  saveSession({ params: state.params, profile: state.profile });
  renderProfiles();
  showToast(`Perfil “${name}” guardado`);
}

function loadProfileParams() {
  state.params = applyProfile(state.profile, state.params);
  viewer.buildBed(state.params.bedSize);
  viewer.setEdges(state.params.showEdges);
  rows.forEach((r) => r.update());
  refreshVisibility();
  requestBuild();
}

/** Drops the unsaved changes and goes back to the profile's saved values. */
function onRevertProfile() {
  loadProfileParams();
  saveSession({ params: state.params, profile: state.profile });
  refreshProfile();
  showToast(`Cambios de “${state.profile}” revertidos`);
}

function refreshProfile() {
  const modified = isModified(state.profile, state.params);
  modifiedTag.textContent = modified ? 'Modificado' : '';
  revertBtn.hidden = !modified;
}

function persistUi() {
  try {
    localStorage.setItem('cookiemaker.ui.v1', JSON.stringify({ piece: state.piece, units: state.units }));
  } catch {
    /* ignore */
  }
}

// ---------- Start ----------

buildPanel();
syncInsets();
renderProfiles();
renderLeft();
refreshVisibility();
pieceSeg.set(state.piece);
updateDesign(true);

// Exposed for automated checks.
(window as any).cookiemaker = { state, get result() { return lastResult; }, setSource, updateDesign };
