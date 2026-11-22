// Convolution = a sliding stamp. At each spot: multiply what is under the stamp
// by the stamp's numbers, add them up, write the answer below. Blur, edges and
// sharpening are just different stamps. Real convolution flips the stamp first.
import { C, alpha } from '../viz/palette.js';
import { conv1d, conv2d } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const K1 = {
  box: [1, 1, 1, 1, 1].map((v) => v / 5),
  gauss: [1, 4, 6, 4, 1].map((v) => v / 16),
  edge: [-1, 0, 1].map((v) => v / 2),
  sharp: [-1, 3, -1],
};
const K2 = {
  box: [[1, 1, 1], [1, 1, 1], [1, 1, 1]].map((r) => r.map((v) => v / 9)),
  gauss: [[1, 2, 1], [2, 4, 2], [1, 2, 1]].map((r) => r.map((v) => v / 16)),
  edge: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]].map((r) => r.map((v) => v / 4)),
  sharp: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]],
};
const FLIPK = [1, 0.65, 0.3, 0, 0];
const HEART = [
  '............',
  '..##....##..',
  '.####..####.',
  '############',
  '############',
  '############',
  '.##########.',
  '..########..',
  '...######...',
  '....####....',
  '.....##.....',
  '............',
];

export default {
  eq: [
    [['y', 'pink'], '[i] = Σⱼ ', ['k', 'orange'], '[j] · ', ['x', 'teal'], '[i − j]      (convolution: the stamp is flipped)'],
    [['y', 'pink'], '[i] = Σⱼ ', ['k', 'orange'], '[j] · ', ['x', 'teal'], '[i + j]      (correlation: what CNNs actually do)'],
    [['Y', 'pink'], '[r,c] = Σᵤ Σᵥ ', ['K', 'orange'], '[u,v] · ', ['X', 'teal'], '[r+u, c+v]'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const R = rng(13);
    const N = 64;
    const sig = Array.from({ length: N }, (_, i) => {
      const t = i / N;
      return (t > 0.18 && t < 0.42 ? 1.4 : 0.3) + 0.9 * Math.exp(-((t - 0.7) ** 2) / 0.004) + R.normal(0, 0.18);
    });
    const spike = Array.from({ length: N }, (_, i) => (i === 18 ? 1.6 : 0) + (i >= 40 ? 0.8 : 0));
    const img = HEART.map((row) => row.split('').map((ch) => (ch === '#' ? 1 : 0) + R.normal(0, 0.18)));
    const s = { beat: 0, ker: 'gauss', pos: 4, auto: true, t: 0, k2: 0 };

    const X = (i) => -6.2 + (12.4 * (i + 0.5)) / N, DX = 12.4 / N;
    const SIG_Y = 1.25, SIG_K = 0.95, OUT_Y = -3.1, OUT_K = 0.95;

    stage.handle({ pen: g, color: 'orange', r: 11, visible: () => s.beat === 0, get: () => [X(Math.round(s.pos)), SIG_Y + 2.15], set: (p) => { s.pos = clamp((p[0] + 6.2) / DX - 0.5, 0, N - 1); s.auto = false; }, onEnd: () => setTimeout(() => (s.auto = true), 1500) });

    const groups = [ui.group()];
    ui.choice({
      into: groups[0], value: s.ker, color: 'orange', options: [
        { icon: '🟫', value: 'box', title: 'box blur' }, { icon: '🌫️', value: 'gauss', title: 'soft blur' },
        { icon: '📐', value: 'edge', title: 'edges' }, { icon: '✨', value: 'sharp', title: 'sharpen' },
      ], onChange: (v) => { s.ker = v; s.k2 = 0; },
    });
    ui.readout(() => {
      if (s.beat === 0) { const i = Math.round(s.pos); return fmt(conv1d(sig, K1[s.ker])[i], 2); }
      if (s.beat === 1) return String(Math.min(144, Math.floor(s.k2)));
      return '🔄';
    }, { icon: '🩷', color: 'pink', title: 'output' });
    ui.beats(['〰️', '🖼️', '🔄'], (b) => { s.beat = b; s.k2 = 0; groups[0].style.display = b === 2 ? 'none' : ''; fit(); });
    const fit = () => {
      const b = s.beat === 1 ? (stage.portrait ? [-3, -6.2, 3, 8.6] : [-8.2, -3.4, 8.2, 3.6]) : [-6.6, -3.5, 6.6, 3.7];
      if (!s.b || s.b.join() !== b.join()) { s.b = b; g.setBounds(b); }
    };
    fit();

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 0 && s.auto) { s.pos += dt * 7; if (s.pos > N - 1) s.pos = 0; }
        if (s.beat === 1) { s.k2 += dt * 14; if (s.k2 > 144 + 30) s.k2 = 0; }
      },
      draw() {
        fit();
        if (s.beat === 0) draw1D(); else if (s.beat === 1) draw2D(); else drawFlip();
      },
    };

    function signalBars(x, y0, K, color, upto = x.length) {
      for (let i = 0; i < upto; i++) g.line([X(i), y0], [X(i), y0 + x[i] * K], { color: alpha(color, 0.35), width: Math.max(1, g.px(DX) * 0.5) });
      g.path(x.slice(0, upto).map((v, i) => [X(i), y0 + v * K]), { color, width: 2.5 });
    }

    function draw1D() {
      g.grid({ step: 1, axes: false });
      const k = K1[s.ker], c = Math.floor(k.length / 2), out = conv1d(sig, k), i = Math.round(s.pos);
      const lo = Math.min(...out, 0), hi = Math.max(...out);
      const OK = Math.min(OUT_K, 1.7 / Math.max(hi - lo, 1e-6));
      const oy = OUT_Y - lo * OK;
      g.line([-6.4, SIG_Y], [6.4, SIG_Y], { color: alpha('muted', 0.5), width: 1 });
      g.line([-6.4, oy], [6.4, oy], { color: alpha('muted', 0.5), width: 1 });
      signalBars(sig, SIG_Y, SIG_K, 'teal');
      // the stamp window on the signal
      const a = X(i - c) - DX / 2, b = X(i + c) + DX / 2;
      g.rrect(a, SIG_Y - 0.25, b - a, 2.3, 6, { fill: alpha('orange', 0.12), color: 'orange', width: 2.5 });
      // magnified stamp: for each tap, the stamp number (orange) and number × signal (purple); they add up (Σ) to the pink dot
      const kmax = Math.max(...k.map(Math.abs)), W = 0.62, MY = -0.35, MK = 0.55;
      const cx = clamp(X(i), -6.2 + W * (c + 0.6), 6.2 - W * (c + 0.6));
      g.rrect(cx - W * (c + 0.55), MY - 0.75, W * (2 * c + 1.1), 1.5, 8, { fill: alpha('panel', 0.85), color: alpha('orange', 0.5), width: 1.5 });
      g.line([cx - W * (c + 0.5), MY], [cx + W * (c + 0.5), MY], { color: alpha('muted', 0.7), width: 1 });
      k.forEach((kv, j) => {
        const idx = i + j - c, xv = sig[idx] ?? 0, pr = kv * xv, x = cx + (j - c) * W;
        g.line([X(idx), SIG_Y - 0.25], [x, MY + 0.75], { color: alpha('orange', 0.3), width: 1.2 });
        g.bar(x - W * 0.36, MY, W * 0.32, (kv / kmax) * MK, { color: 'orange', r: 2 });
        g.bar(x + W * 0.04, MY, W * 0.32, (pr / kmax) * MK, { color: 'purple', r: 2 });
      });
      g.arrow([cx, MY - 0.8], [X(i), oy + out[i] * OK + 0.2], { color: alpha('pink', 0.7), width: 2.5 });
      g.text('Σ', [cx + 0.35, MY - 0.95], { color: 'purple', size: 18, weight: 800 });
      // the output builds as the stamp moves
      signalBars(out, oy, OK, 'pink', i + 1);
      g.dot([X(i), oy + out[i] * OK], 7, { color: 'pink', ring: 'bg' });
      g.text('x', [-6.45, SIG_Y + 1.85], { color: 'teal', size: 18, weight: 800 });
      g.text('y', [-6.45, oy + 1.4], { color: 'pink', size: 18, weight: 800 });
      g.text('k', [-6.45, MY + 0.3], { color: 'orange', size: 18, weight: 800 });
    }

    function draw2D() {
      const K = K2[s.ker], out = conv2d(img, K, { pad: 1 });
      const P = stage.portrait, sz = P ? 0.43 : 0.43;
      const ks = P ? 0.8 : 0.5, inTL = P ? [-2.58, 8.2] : [-7.8, 2.6], outTL = P ? [-2.58, -0.6] : [2.65, 2.6], kTL = P ? [-1.2, 2.6] : [-0.75, 0.75];
      const done = Math.min(144, Math.floor(s.k2)), cur = Math.min(143, done);
      const r = Math.floor(cur / 12), c = cur % 12;
      g.cells(img, inTL, sz, { min: -0.2, max: 1.2, cmap: 'mono' });
      // stamp on the input
      g.rrect(inTL[0] + (c - 1) * sz, inTL[1] - (r + 2) * sz, 3 * sz, 3 * sz, 4, { color: 'orange', width: 3.5 });
      // the stamp itself, with its numbers
      const kv = K.flat(), km = Math.max(...kv.map(Math.abs));
      g.cells(K, kTL, ks, { min: -km, max: km, cmap: 'div', values: true, fontSize: 12, format: (v) => (Math.abs(v) < 0.5 && v !== 0 ? fmt(v, 2).replace('0.', '.') : fmt(v, 0)) });
      g.rrect(kTL[0], kTL[1] - 3 * ks, 3 * ks, 3 * ks, 4, { color: 'orange', width: 3 });
      // output, revealed up to the stamp
      const edge = s.ker === 'edge';
      const vals = out.flat(), om = Math.max(...vals.map(Math.abs));
      const shown = out.map((row, rr) => row.map((v, cc) => (rr * 12 + cc <= cur ? v : NaN)));
      g.cells(shown, outTL, sz, {
        colorFn: (v) => (Number.isNaN(v) ? alpha('slate', 0.12) : `rgb(${cmapFor(edge ? (v / om + 1) / 2 : (v + 0.2) / 1.4, edge).join(',')})`),
      });
      g.rrect(outTL[0] + c * sz, outTL[1] - (r + 1) * sz, sz, sz, 3, { color: 'pink', width: 3 });
      // connector lines: input window → stamp → output pixel
      const w = [inTL[0] + (c + 0.5) * sz, inTL[1] - (r + 0.5) * sz], o = [outTL[0] + (c + 0.5) * sz, outTL[1] - (r + 0.5) * sz];
      const kc = [kTL[0] + 1.5 * ks, kTL[1] - 1.5 * ks];
      g.line(w, kc, { color: alpha('orange', 0.45), width: 2, dash: [4, 4] });
      g.arrow(kc, o, { color: alpha('pink', 0.6), width: 2.5 });
      g.text('×  Σ', P ? [kTL[0] + 3 * ks + 0.5, kc[1]] : [kc[0], kTL[1] + 0.3], { color: 'purple', size: 16, weight: 800 });
    }
    function cmapFor(t, div) {
      t = clamp(t, 0, 1);
      const S = div ? [[40, 110, 240], [235, 235, 240], [240, 100, 30]] : [[20, 30, 60], [70, 120, 230], [230, 245, 255]];
      const x = t * (S.length - 1), i = Math.min(Math.floor(x), S.length - 2), f = x - i;
      return S[i].map((v, k) => Math.round(v + (S[i + 1][k] - v) * f));
    }

    function drawFlip() {
      g.grid({ step: 1, axes: false });
      const kr = FLIPK.slice().reverse();
      const corr = conv1d(spike, FLIPK), conv = conv1d(spike, kr); // conv1d slides WITHOUT flipping (= correlation)
      const SY = 1.7, CY = -0.6, RY = -2.9;
      g.line([-6.4, SY], [6.4, SY], { color: alpha('muted', 0.5), width: 1 });
      signalBars(spike, SY, 0.9, 'teal');
      // the two stamps (as bars), one flipped
      const stamp = (k, y, col) => k.forEach((v, j) => g.bar(-6.55 + j * 0.22, y, 0.18, v * 0.7, { color: col, r: 2 }));
      g.line([-6.4, CY], [6.4, CY], { color: alpha('muted', 0.5), width: 1 });
      g.line([-6.4, RY], [6.4, RY], { color: alpha('muted', 0.5), width: 1 });
      signalBars(conv, CY, 0.9, 'pink');
      signalBars(corr, RY, 0.9, 'blue');
      stamp(kr, CY + 1.05, 'orange'); g.emoji('🔄', [-5.15, CY + 1.4], 20);
      stamp(FLIPK, RY + 1.05, 'orange'); g.emoji('➡️', [-5.15, RY + 1.4], 20);
      // the spike's echo: convolution copies the stamp as-is, correlation copies it backwards
      const xi = 18;
      g.rrect(X(xi - 2) - DX / 2, CY - 0.1, 5 * DX, 1.6, 6, { color: alpha('pink', 0.6), width: 2, dash: [4, 4] });
      g.rrect(X(xi - 2) - DX / 2, RY - 0.1, 5 * DX, 1.6, 6, { color: alpha('blue', 0.6), width: 2, dash: [4, 4] });
      g.text('x', [-6.45, SY + 1.4], { color: 'teal', size: 18, weight: 800 });
      g.text('∗', [6.35, CY + 0.6], { color: 'pink', size: 24, weight: 800 });
      g.text('⋆', [6.35, RY + 0.6], { color: 'blue', size: 24, weight: 800 });
    }
  },
};
void C;
