// Word-free controls. Every control is an icon + color; meaning comes from the picture.
// `title` strings are only used as accessible tooltips (screen readers / hover).
import { col } from './palette.js';

const el = (tag, cls, attrs = {}) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, v);
  return e;
};

export class UI {
  constructor(dock, storyHost = dock) {
    this.dock = dock;
    this.storyHost = storyHost;
    this.readouts = [];
    this.cleanups = [];
  }
  group(cls = '') { const g = el('div', 'ui-group ' + cls); this.dock.appendChild(g); return g; }
  _host(o) { return o.into ?? this.group(); }

  // A slider with an icon. Track tinted with the color of the thing it controls.
  slider({ icon = '', color = 'blue', min = 0, max = 1, step = 0.01, value = 0, onInput = () => {}, title, into, width } = {}) {
    const host = this._host({ into });
    const wrap = el('label', 'ui-slider', { title });
    if (icon) { const i = el('span', 'ui-icon'); i.textContent = icon; wrap.appendChild(i); }
    const input = el('input', '', { type: 'range', min, max, step, value, 'aria-label': title ?? icon });
    if (width) input.style.width = width + 'px';
    const paint = () => {
      const t = (input.value - min) / (max - min);
      input.style.setProperty('--fill', `${t * 100}%`);
      input.style.setProperty('--tint', col(color));
    };
    input.addEventListener('input', () => { paint(); onInput(Number(input.value)); });
    paint();
    wrap.appendChild(input);
    host.appendChild(wrap);
    return {
      get value() { return Number(input.value); },
      set(v, fire = false) { input.value = v; paint(); if (fire) onInput(Number(input.value)); },
      el: wrap,
    };
  }

  button({ icon, title, onClick = () => {}, color, into, big = false } = {}) {
    const host = this._host({ into });
    const b = el('button', 'ui-btn' + (big ? ' big' : ''), { type: 'button', title, 'aria-label': title ?? icon });
    b.textContent = icon;
    if (color) b.style.setProperty('--tint', col(color));
    b.addEventListener('click', onClick);
    host.appendChild(b);
    return b;
  }

  toggle({ icon, title, value = false, onChange = () => {}, color = 'gold', into } = {}) {
    const host = this._host({ into });
    const b = el('button', 'ui-btn ui-toggle', { type: 'button', title, 'aria-label': title ?? icon, 'aria-pressed': String(value) });
    b.textContent = icon;
    b.style.setProperty('--tint', col(color));
    const api = {
      value,
      set(v, fire = true) { api.value = v; b.setAttribute('aria-pressed', String(v)); b.classList.toggle('on', v); if (fire) onChange(v); },
      el: b,
    };
    b.classList.toggle('on', value);
    b.addEventListener('click', () => api.set(!api.value));
    host.appendChild(b);
    return api;
  }

  // Segmented choice: options [{ icon, value, title }]
  choice({ options, value, onChange = () => {}, color = 'blue', into } = {}) {
    const host = this._host({ into });
    const seg = el('div', 'ui-seg', { role: 'radiogroup' });
    const btns = options.map((o) => {
      const b = el('button', 'ui-btn', { type: 'button', title: o.title, role: 'radio', 'aria-label': o.title ?? o.icon });
      b.textContent = o.icon;
      b.style.setProperty('--tint', col(o.color ?? color));
      b.addEventListener('click', () => api.set(o.value));
      seg.appendChild(b);
      return b;
    });
    const api = {
      value,
      set(v, fire = true) {
        api.value = v;
        options.forEach((o, i) => { btns[i].classList.toggle('on', o.value === v); btns[i].setAttribute('aria-checked', String(o.value === v)); });
        if (fire) onChange(v);
      },
    };
    api.set(value, false);
    host.appendChild(seg);
    return api;
  }

  // Story beats: a row of icons; the scene changes "chapter" when one is picked.
  // Auto-advance happens only if the scene calls api.next().
  beats(icons, onChange = () => {}, { into } = {}) {
    const host = into ?? this.storyHost;
    const row = el('div', 'ui-beats');
    const dots = icons.map((ic, i) => {
      const b = el('button', 'ui-beat', { type: 'button', 'aria-label': `step ${i + 1}` });
      b.innerHTML = `<span class="n">${i + 1}</span><span class="ic">${ic}</span>`;
      b.addEventListener('click', () => api.set(i));
      row.appendChild(b);
      return b;
    });
    const api = {
      index: 0,
      set(i, fire = true) {
        api.index = Math.max(0, Math.min(icons.length - 1, i));
        dots.forEach((d, k) => { d.classList.toggle('on', k === api.index); d.classList.toggle('done', k < api.index); });
        if (fire) onChange(api.index);
      },
      next() { api.set((api.index + 1) % icons.length); },
    };
    api.set(0, false);
    host.appendChild(row);
    return api;
  }

  // Live number/emoji readout, refreshed every frame by the app shell.
  readout(fn, { icon = '', color = 'ink', title, into } = {}) {
    const host = this._host({ into });
    const r = el('div', 'ui-readout', { title });
    r.style.setProperty('--tint', col(color));
    r.innerHTML = '<span class="ui-icon"></span><span class="v"></span>';
    r.querySelector('.ui-icon').textContent = icon;
    host.appendChild(r);
    const v = r.querySelector('.v');
    this.readouts.push(() => { const s = String(fn()); if (v.textContent !== s) v.textContent = s; });
    return r;
  }

  refresh() { for (const f of this.readouts) f(); }
  clear() { this.dock.innerHTML = ''; this.storyHost.innerHTML = ''; this.readouts = []; }
}

export const fmt = (x, d = 2) => (Number.isFinite(x) ? (Math.abs(x) < 10 ** -d / 2 ? 0 : x).toFixed(d) : '∞');
