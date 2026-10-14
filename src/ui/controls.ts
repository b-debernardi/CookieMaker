// Small DOM helpers and the controls the panels are built from.

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return el;
}

/** Segmented control with a sliding selection thumb. */
export function segmented<T extends string>(
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
  cls = '',
): { el: HTMLElement; set(v: T): void } {
  const thumb = h('div', { class: 'thumb' });
  const buttons = options.map((o) =>
    h('button', {
      type: 'button',
      'aria-pressed': String(o.value === value),
      onClick: () => {
        set(o.value);
        onChange(o.value);
      },
    }, o.label),
  );
  const el = h('div', { class: `seg ${cls}`, role: 'group' }, thumb, ...buttons);
  let current = value;
  const place = () => {
    const i = options.findIndex((o) => o.value === current);
    const b = buttons[i];
    if (!b || !b.offsetWidth) return;
    thumb.style.width = `${b.offsetWidth}px`;
    thumb.style.transform = `translateX(${b.offsetLeft}px)`;
  };
  const set = (v: T) => {
    current = v;
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === v)));
    place();
  };
  new ResizeObserver(place).observe(el);
  requestAnimationFrame(place);
  return { el, set };
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, label: string): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked, onChange: () => onChange(input.checked) });
  return { el: h('label', { class: 'switch' }, input, h('span')), input };
}

export function select(
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void,
  label: string,
): HTMLSelectElement {
  const s = h('select', { class: 'select', 'aria-label': label, onChange: () => onChange(s.value) },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
  );
  return s;
}

export function setRangeFill(r: HTMLInputElement) {
  const min = +r.min, max = +r.max, v = +r.value;
  r.style.setProperty('--pct', `${((v - min) / (max - min || 1)) * 100}%`);
}

export function download(blob: Blob, name: string) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
