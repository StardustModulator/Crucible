// One visual language for the whole engine. The SAME color always means the
// SAME idea, in every scene — that is how pictures "talk" without words.
//
//   red / green / blue   x / y / z axes (and rotation about them)
//   orange               joints, inputs, "the thing you turn"
//   pink                 the hand / end-effector / output
//   gold                 goals, targets, the answer (cardinal red)
//   teal                 data, measurements, samples
//   blue                 the model / estimate / belief
//   purple               uncertainty, noise, probability mass
//   lime                 the truth / correct answer
//   coral                error, gradient, "push back" forces
//   slate                obstacles, walls (silver gray)

// Cardinal red + silver gray + black & white, with a quiet scientific palette for meanings.
const dark = {
  bg: '#0b0b0c', panel: '#141416', panel2: '#1c1c1f', ink: '#f4f4f2', muted: '#9b9b9e',
  faint: '#3a3a3e', grid: '#1e1e21', shadow: 'rgba(0,0,0,0.45)',
  red: '#ef5b6c', green: '#45c08a', blue: '#5b9cff', orange: '#f2994a', pink: '#e4669f',
  gold: '#e8465c', teal: '#3cc6c0', purple: '#a58bf0', lime: '#8fcf5a', coral: '#ff8a5c',
  slate: '#8a8b8c', white: '#ffffff', black: '#000000',
};
const light = {
  bg: '#ffffff', panel: '#f7f7f6', panel2: '#efefed', ink: '#111111', muted: '#6b6b6e',
  faint: '#d0d0d0', grid: '#ececea', shadow: 'rgba(0,0,0,0.12)',
  red: '#d1495b', green: '#2e9a68', blue: '#2563c9', orange: '#dd7a1f', pink: '#c2367a',
  gold: '#a31f34', teal: '#13918f', purple: '#6d4fc2', lime: '#4f9a35', coral: '#e4572e',
  slate: '#8a8b8c', white: '#ffffff', black: '#000000',
};

// Live palette object: scenes read C.blue etc. at draw time, so theme switches are instant.
export const C = { ...dark };
export const themes = { dark, light };
export let themeName = 'dark';

export function setTheme(name) {
  themeName = name in themes ? name : 'dark';
  Object.assign(C, themes[themeName]);
  document.documentElement.dataset.theme = themeName;
}

// Ordered list for "many things" (clusters, particles, classes, links).
export const SERIES = ['blue', 'orange', 'teal', 'pink', 'gold', 'purple', 'lime', 'coral'];
export const series = (i) => C[SERIES[((i % SERIES.length) + SERIES.length) % SERIES.length]];

// Resolve a color: palette key ('blue') or raw CSS ('#fff', 'rgba(...)').
export const col = (c) => (c in C ? C[c] : c);

export function alpha(color, a) {
  const c = col(color);
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  if (c.startsWith('rgba')) return c.replace(/[\d.]+\)$/, `${a})`);
  if (c.startsWith('rgb')) return c.replace('rgb', 'rgba').replace(')', `,${a})`);
  return c;
}

export function mix(a, b, t) {
  const pa = toRGB(col(a)), pb = toRGB(col(b));
  const m = pa.map((x, i) => Math.round(x + (pb[i] - x) * t));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}
function toRGB(c) {
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/[\d.]+/g) || [0, 0, 0];
  return m.slice(0, 3).map(Number);
}

// Colormaps for heat images: t in [0,1] → [r,g,b].
const stops = {
  // cool → warm, readable on dark & light; used for "value", "cost", "probability"
  heat: [[13, 18, 60], [60, 40, 160], [180, 60, 160], [255, 120, 80], [255, 220, 90]],
  // diverging: negative blue, zero neutral, positive orange
  div: [[40, 110, 240], [120, 170, 250], [235, 235, 240], [255, 180, 100], [240, 100, 30]],
  // probability on transparent
  mono: [[20, 30, 60], [70, 120, 230], [140, 200, 255], [230, 245, 255]],
};
export function cmap(t, name = 'heat') {
  const s = stops[name] || stops.heat;
  t = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (s.length - 1);
  const i = Math.min(Math.floor(t), s.length - 2), f = t - i;
  return s[i].map((x, k) => Math.round(x + (s[i + 1][k] - x) * f));
}
export const cmapCSS = (t, name) => { const [r, g, b] = cmap(t, name); return `rgb(${r},${g},${b})`; };
