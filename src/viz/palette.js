// One visual language for the whole engine. The SAME color always means the
// SAME idea, in every scene — that is how pictures "talk" without words.
//
//   red / green / blue   x / y / z axes (and rotation about them)
//   orange               joints, inputs, "the thing you turn"
//   pink                 the hand / end-effector / output
//   gold                 goals & targets
//   teal                 data, measurements, samples
//   blue                 the model / estimate / belief
//   purple               uncertainty, noise, probability mass
//   lime                 the truth / correct answer
//   coral                error, gradient, "push back" forces
//   slate                obstacles, walls

const dark = {
  bg: '#0b0e1f', panel: '#151a33', panel2: '#1d2347', ink: '#f1f3ff', muted: '#9aa5cf',
  faint: '#343c6b', grid: '#1f2650', shadow: 'rgba(0,0,0,0.35)',
  red: '#ff5d6c', green: '#3ddc84', blue: '#4ea8ff', orange: '#ffa94d', pink: '#ff6ad5',
  gold: '#ffd43b', teal: '#2ee6d6', purple: '#b18cff', lime: '#a3e635', coral: '#ff7b54',
  slate: '#6b7896', white: '#ffffff', black: '#000000',
};
const light = {
  bg: '#fbf6ea', panel: '#fffdf7', panel2: '#f4eddc', ink: '#1d2340', muted: '#5d6687',
  faint: '#d6cfbd', grid: '#ece3cf', shadow: 'rgba(30,30,60,0.15)',
  red: '#e03140', green: '#16a35a', blue: '#1f7ae0', orange: '#ec7a00', pink: '#d6339f',
  gold: '#d49b00', teal: '#0aa595', purple: '#7a4fe0', lime: '#5c9a0b', coral: '#e8532d',
  slate: '#7a8399', white: '#ffffff', black: '#000000',
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
