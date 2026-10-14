// Simple image editor shown before tracing: crop, paint and erase.
// Painting is pure black (drawing) and erasing pure white (background), so
// the threshold afterwards sees exactly what was drawn.

import { h, segmented } from './controls';

type Tool = 'crop' | 'brush' | 'eraser';
interface Rect { x: number; y: number; w: number; h: number }

/** Largest side kept while editing; tracing works at 1200 px anyway. */
const MAX_SIDE = 1600;
const UNDO_LIMIT = 15;
/** Brush sizes as a fraction of the image's longest side. */
const SIZES = [
  { value: '0.006', label: 'Fino' },
  { value: '0.015', label: 'Medio' },
  { value: '0.03', label: 'Grueso' },
  { value: '0.06', label: 'Extra' },
];
const HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
type Handle = (typeof HANDLES)[number];

let open = false;
export const isImageEditorOpen = () => open;

/**
 * Opens the editor on `image`. Resolves with the edited image, or null when
 * the user cancels. `original` is what "Restablecer" goes back to.
 */
export function openImageEditor(image: CanvasImageSource & { width: number; height: number }, original = image): Promise<ImageBitmap | null> {
  open = true;
  return new Promise((resolve) => {
    // ---------- Working canvas ----------
    const work = document.createElement('canvas');
    const wctx = work.getContext('2d', { willReadFrequently: true })!;
    const load = (src: typeof image) => {
      const s = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
      work.width = Math.max(1, Math.round(src.width * s));
      work.height = Math.max(1, Math.round(src.height * s));
      wctx.fillStyle = '#fff';
      wctx.fillRect(0, 0, work.width, work.height);
      wctx.drawImage(src, 0, 0, work.width, work.height);
    };
    load(image);

    const undo: ImageData[] = [];
    const redo: ImageData[] = [];
    const snapshot = () => wctx.getImageData(0, 0, work.width, work.height);
    const restore = (d: ImageData) => {
      work.width = d.width;
      work.height = d.height;
      wctx.putImageData(d, 0, 0);
    };
    const pushUndo = () => {
      undo.push(snapshot());
      if (undo.length > UNDO_LIMIT) undo.shift();
      redo.length = 0;
      refreshButtons();
    };

    // ---------- State ----------
    let tool: Tool = 'brush';
    let size = +SIZES[1].value;
    let crop: Rect = full();
    function full(): Rect { return { x: 0, y: 0, w: work.width, h: work.height }; }
    const cropPending = () => crop.x > 0.5 || crop.y > 0.5 || crop.w < work.width - 0.5 || crop.h < work.height - 0.5;

    // ---------- DOM ----------
    const frame = h('div', { class: 'ed-frame' });
    frame.append(work);
    const box = h('div', { class: 'ed-crop' }, ...HANDLES.map((k) => h('span', { class: `ed-handle ${k}`, 'data-h': k })));
    const ring = h('div', { class: 'ed-ring' });
    frame.append(box, ring);
    const area = h('div', { class: 'ed-area' }, frame);

    const toolSeg = segmented<Tool>(
      [{ value: 'crop', label: 'Recortar' }, { value: 'brush', label: 'Pincel' }, { value: 'eraser', label: 'Goma' }],
      tool, (v) => setTool(v), 'pill',
    );
    const sizeSeg = segmented(SIZES, SIZES[1].value, (v) => { size = +v; }, 'pill');
    const applyCropBtn = h('button', { class: 'btn small', type: 'button', onClick: () => applyCrop() }, 'Aplicar recorte');
    const resetCropBtn = h('button', { class: 'btn small', type: 'button', onClick: () => { crop = full(); layout(); } }, 'Todo');
    const sizeGroup = h('div', { class: 'ed-group' }, h('span', { class: 'ed-label' }, 'Grosor'), sizeSeg.el);
    const cropGroup = h('div', { class: 'ed-group' }, resetCropBtn, applyCropBtn);
    const undoBtn = h('button', { class: 'btn icon', type: 'button', title: 'Deshacer (Ctrl+Z)', onClick: () => doUndo() }, 'Deshacer');
    const redoBtn = h('button', { class: 'btn icon', type: 'button', title: 'Rehacer (Ctrl+Shift+Z)', onClick: () => doRedo() }, 'Rehacer');
    const resetBtn = h('button', {
      class: 'btn icon', type: 'button', title: 'Volver a la imagen original',
      onClick: () => { pushUndo(); load(original); crop = full(); layout(); },
    }, 'Restablecer');

    const sheet = h('div', { class: 'ed-sheet glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Editar imagen' },
      h('div', { class: 'ed-head' },
        h('button', { class: 'btn', type: 'button', onClick: () => close(false) }, 'Cancelar'),
        h('div', { class: 'panel-title' }, 'Editar imagen'),
        h('button', { class: 'btn primary', type: 'button', onClick: () => close(true) }, 'Usar imagen'),
      ),
      h('div', { class: 'ed-tools' }, toolSeg.el, sizeGroup, cropGroup, h('div', { class: 'ed-spacer' }), undoBtn, redoBtn, resetBtn),
      area,
      h('div', { class: 'ed-foot' }, 'Lo negro es dibujo y lo blanco es fondo. Pintá para agregar líneas y borrá con la goma lo que sobra.'),
    );
    const backdrop = h('div', { class: 'ed-backdrop' }, sheet);
    document.body.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    // ---------- Layout ----------
    let scale = 1; // display px per image px
    function layout() {
      const r = area.getBoundingClientRect();
      const pad = 16;
      scale = Math.min((r.width - pad * 2) / work.width, (r.height - pad * 2) / work.height, 4);
      if (!(scale > 0)) scale = 1;
      frame.style.width = `${work.width * scale}px`;
      frame.style.height = `${work.height * scale}px`;
      Object.assign(box.style, {
        left: `${crop.x * scale}px`, top: `${crop.y * scale}px`,
        width: `${crop.w * scale}px`, height: `${crop.h * scale}px`,
      });
      ring.style.width = ring.style.height = `${size * Math.max(work.width, work.height) * scale}px`;
    }
    const ro = new ResizeObserver(layout);
    ro.observe(area);

    function setTool(t: Tool) {
      if (tool === 'crop' && t !== 'crop' && cropPending()) applyCrop();
      tool = t;
      toolSeg.set(t);
      sheet.dataset.tool = t;
      sizeGroup.hidden = t === 'crop';
      cropGroup.hidden = t !== 'crop';
      box.hidden = t !== 'crop';
      ring.hidden = true;
      layout();
    }

    function refreshButtons() {
      undoBtn.disabled = !undo.length;
      redoBtn.disabled = !redo.length;
    }

    function applyCrop() {
      if (!cropPending()) return;
      const c = {
        x: Math.round(crop.x), y: Math.round(crop.y),
        w: Math.max(1, Math.round(crop.w)), h: Math.max(1, Math.round(crop.h)),
      };
      pushUndo();
      const d = wctx.getImageData(c.x, c.y, c.w, c.h);
      restore(d);
      crop = full();
      layout();
    }

    function doUndo() {
      const d = undo.pop();
      if (!d) return;
      redo.push(snapshot());
      restore(d);
      crop = full();
      layout();
      refreshButtons();
    }
    function doRedo() {
      const d = redo.pop();
      if (!d) return;
      undo.push(snapshot());
      restore(d);
      crop = full();
      layout();
      refreshButtons();
    }

    // ---------- Pointer ----------
    const toImg = (e: PointerEvent): [number, number] => {
      const r = frame.getBoundingClientRect();
      return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
    };
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

    let drag: null | {
      kind: 'paint'; last: [number, number];
    } | {
      kind: 'move'; start: [number, number]; orig: Rect;
    } | {
      kind: 'resize'; handle: Handle; orig: Rect;
    } | {
      kind: 'new'; start: [number, number];
    } = null;

    const paintTo = (p: [number, number], from: [number, number]) => {
      wctx.save();
      wctx.strokeStyle = wctx.fillStyle = tool === 'eraser' ? '#fff' : '#000';
      wctx.lineWidth = size * Math.max(work.width, work.height);
      wctx.lineCap = 'round';
      wctx.lineJoin = 'round';
      wctx.beginPath();
      wctx.moveTo(from[0], from[1]);
      wctx.lineTo(p[0], p[1]);
      wctx.stroke();
      wctx.restore();
    };

    const moveRing = (e: PointerEvent) => {
      if (tool === 'crop' || e.pointerType === 'touch') { ring.hidden = true; return; }
      const r = frame.getBoundingClientRect();
      ring.hidden = false;
      ring.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px) translate(-50%, -50%)`;
    };

    frame.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      frame.setPointerCapture(e.pointerId);
      const p = toImg(e);
      if (tool === 'crop') {
        const hd = (e.target as HTMLElement).dataset.h as Handle | undefined;
        if (hd) drag = { kind: 'resize', handle: hd, orig: { ...crop } };
        else if (p[0] >= crop.x && p[0] <= crop.x + crop.w && p[1] >= crop.y && p[1] <= crop.y + crop.h && cropPending()) {
          drag = { kind: 'move', start: p, orig: { ...crop } };
        } else drag = { kind: 'new', start: [clamp(p[0], 0, work.width), clamp(p[1], 0, work.height)] };
        return;
      }
      pushUndo();
      drag = { kind: 'paint', last: p };
      paintTo(p, p);
    });

    frame.addEventListener('pointermove', (e) => {
      moveRing(e);
      if (!drag) return;
      const p = toImg(e);
      const W = work.width, H = work.height, min = 8;
      if (drag.kind === 'paint') {
        // Coalesced events keep fast strokes smooth.
        const pts = (e.getCoalescedEvents?.() ?? [e]).map(toImg);
        for (const q of pts) { paintTo(q, drag.last); drag.last = q; }
        return;
      }
      if (drag.kind === 'move') {
        const o = drag.orig;
        crop = { ...o, x: clamp(o.x + p[0] - drag.start[0], 0, W - o.w), y: clamp(o.y + p[1] - drag.start[1], 0, H - o.h) };
      } else if (drag.kind === 'new') {
        const [sx, sy] = drag.start;
        const x = clamp(p[0], 0, W), y = clamp(p[1], 0, H);
        crop = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.max(min, Math.abs(x - sx)), h: Math.max(min, Math.abs(y - sy)) };
        crop.w = Math.min(crop.w, W - crop.x);
        crop.h = Math.min(crop.h, H - crop.y);
      } else {
        const o = drag.orig;
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        const x = clamp(p[0], 0, W), y = clamp(p[1], 0, H);
        if (drag.handle.includes('w')) x0 = Math.min(x, x1 - min); else x1 = Math.max(x, x0 + min);
        if (drag.handle.includes('n')) y0 = Math.min(y, y1 - min); else y1 = Math.max(y, y0 + min);
        crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      layout();
    });

    const endDrag = () => { drag = null; };
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);
    frame.addEventListener('pointerleave', () => { ring.hidden = true; });

    // ---------- Keyboard ----------
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
      else if (mod) return;
      else if (e.key === 'b' || e.key === 'p') setTool('brush');
      else if (e.key === 'e') setTool('eraser');
      else if (e.key === 'c') setTool('crop');
      else if (e.key === '[' || e.key === ']') {
        const i = SIZES.findIndex((s) => +s.value === size);
        const n = clamp(i + (e.key === ']' ? 1 : -1), 0, SIZES.length - 1);
        size = +SIZES[n].value;
        sizeSeg.set(SIZES[n].value);
        layout();
      }
    };
    window.addEventListener('keydown', onKey, true);

    let closed = false;
    async function close(accept: boolean) {
      if (closed) return;
      closed = true;
      if (accept && cropPending()) applyCrop();
      window.removeEventListener('keydown', onKey, true);
      ro.disconnect();
      const result = accept ? await createImageBitmap(work) : null;
      backdrop.classList.remove('open');
      const done = () => { backdrop.remove(); open = false; };
      backdrop.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 400);
      resolve(result);
    }

    // Size buttons also resize the cursor ring.
    sizeSeg.el.addEventListener('click', () => layout());
    setTool('brush');
    refreshButtons();
  });
}
