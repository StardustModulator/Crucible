// Robots that "talk" in tokens: a smooth motion is chopped into LEGO blocks.
// 🔤 Binning: snap every moment to a shelf → a staircase, one block per moment.
// 🎼 DCT: write the motion as a few cosine waves → few blocks, smooth result.
// 🧱 Then a transformer reads/writes the blocks one by one.
import { C, alpha, cmapCSS, cmap } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { attention, positionalEncoding } from '../core/learning.js';
import { clamp } from '../core/random.js';

const N = 24;                 // time steps in one action chunk
const YR = 2;                 // action range [-YR, YR]
const CU = [0, 0.2, 0.4, 0.6, 0.8, 1];

function catmull(ys, u) {     // smooth curve through the control values
  const n = ys.length - 1, f = clamp(u, 0, 1) * n, i = Math.min(Math.floor(f), n - 1), t = f - i;
  const p0 = ys[Math.max(i - 1, 0)], p1 = ys[i], p2 = ys[i + 1], p3 = ys[Math.min(i + 2, n)];
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}
const dctS = (k) => Math.sqrt((k ? 2 : 1) / N);
const dct = (x) => x.map((_, k) => dctS(k) * x.reduce((s, xn, n) => s + xn * Math.cos((Math.PI / N) * (n + 0.5) * k), 0));
const idctAt = (X, keep, u) => { // continuous inverse (u in [0,1]) using the first `keep` waves
  const n = u * N - 0.5; let s = 0;
  for (let k = 0; k < keep; k++) s += dctS(k) * X[k] * Math.cos((Math.PI / N) * (n + 0.5) * k);
  return s;
};
const mse = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length;

export default {
  eq: [
    [['a(t)', 'teal'], ' → [a₁ … a₂₄]  ·  (one action chunk)'],
    ['bin: ', ['token', 'orange'], 'ᵢ = ⌊(aᵢ + 2) · k / 4⌋  ·  → ', ['24 tokens', 'orange']],
    ['DCT: ', ['Xₖ', 'purple'], ' = sₖ Σₙ aₙ cos(π(n+½)k / N)  ·  keep k < K  → ', ['K tokens', 'purple']],
    [['â', 'blue'], ' = Σₖ<K sₖ ', ['Xₖ', 'purple'], ' cos(…)  ·  ', ['error', 'coral'], ' = mean (a − ', ['â', 'blue'], ')²'],
    ['p(', ['token', 'orange'], 'ᵢ | ', ['token', 'orange'], '₁ … ', ['token', 'orange'], 'ᵢ₋₁)  — read & written by attention'],
  ],
  setup({ stage, ui }) {
    const split = (W, H) => (W < H ? 0.48 : 0.6);
    const top = stage.pen((W, H) => ({ x: 0, y: 0, w: W, h: H * split(W, H) }), [-0.4, -2.5, 10.4, 2.5], { frame: true });
    const bot = stage.pen((W, H) => ({ x: 0, y: H * split(W, H), w: W, h: H * (1 - split(W, H)) }), [-0.4, -1.4, 10.4, 1.6], { frame: true });
    const s = { beat: 0, t: 0, ys: [-0.6, 1.2, 0.3, -1.3, 0.2, 1.0], bins: 6, keep: 5, Wc: 10, play: 0, seq: 0 };

    // fit the drawing width to the panel shape (wide screen → long timeline)
    const fit = () => {
      const a = top.area, Wc = clamp((a.w / a.h) * 5 - 1.6, 7, 16), key = `${a.w}x${a.h}x${bot.area.h}`;
      if (key !== s.fitKey) {
        s.Wc = Wc; s.fitKey = key;
        top.setBounds([-0.5, -2.5, Wc + 0.5, 2.5]);
        const bb = bot.area, Hb = Math.max(2.6, ((Wc + 1) * bb.h) / bb.w);
        bot.setBounds([-0.5, -Hb / 2 + 0.1, Wc + 0.5, Hb / 2 + 0.1]);
      }
    };
    const X = (u) => u * s.Wc;
    const samples = () => Array.from({ length: N }, (_, i) => catmull(s.ys, i / (N - 1)));

    CU.forEach((u, j) => stage.handle({
      pen: top, color: 'orange', r: 10, get: () => [X(u), s.ys[j]],
      set: (p) => { s.ys[j] = clamp(p[1], -1.9, 1.9); },
    }));

    ui.beats(['〰️', '🔤', '🎼', '🧱'], (b) => { s.beat = b; s.t = 0; s.seq = 0; });
    ui.slider({ icon: '🔤', color: 'orange', min: 2, max: 16, step: 1, value: s.bins, title: 'number of bins', onInput: (v) => (s.bins = v) });
    ui.slider({ icon: '🎼', color: 'purple', min: 1, max: N, step: 1, value: s.keep, title: 'cosine waves kept', onInput: (v) => (s.keep = v) });
    ui.readout(() => (s.beat === 2 ? s.keep : N), { icon: '🧱', color: 'orange', title: 'tokens used' });

    const binOf = (y) => clamp(Math.floor(((y + YR) / (2 * YR)) * s.bins), 0, s.bins - 1);
    const binMid = (b) => -YR + ((b + 0.5) * 2 * YR) / s.bins;
    const binCol = (b) => cmapCSS(0.12 + (0.86 * b) / Math.max(1, s.bins - 1), 'heat');

    function block(x, y, w, h, fill, label) {
      bot.rrect(x + 0.04, y, w - 0.08, h, 5, { fill, stroke: false });
      const sw = (w - 0.08) * 0.22;
      for (const k of [0.27, 0.73]) bot.rrect(x + 0.04 + (w - 0.08) * k - sw / 2, y + h - 0.01, sw, h * 0.18, 2, { fill, stroke: false });
      bot.rrect(x + 0.04, y, w - 0.08, h, 5, { color: alpha('ink', 0.25), width: 1 });
      if (label !== undefined && bot.px(w) > 15) bot.text(String(label), [x + w / 2, y + h / 2], { size: Math.min(14, bot.px(w) * 0.45), color: 'white', haloColor: 'black' });
    }

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt;
        s.play = (s.play + dt * 0.22) % 1;
        if (s.beat === 3) s.seq += dt * 3.2;
      },
      draw() {
        fit();
        const a = samples(), Xc = dct(a);
        const qBin = a.map((y) => binMid(binOf(y)));
        const errBin = mse(a, qBin);
        const rec = a.map((_, i) => idctAt(Xc, s.keep, i / (N - 1) * (N - 1) / N + 0.5 / N));
        const errDct = mse(a, rec);
        const dx = s.Wc / (N - 1);

        // ---------- top: the motion ----------
        top.clip(() => {
          if (s.beat === 1 || s.beat === 3) {
            for (let b = 0; b < s.bins; b++) {
              const y0 = -YR + (b * 2 * YR) / s.bins;
              top.rect(-0.5, y0, s.Wc + 1, (2 * YR) / s.bins, { fill: alpha(binCol(b), 0.12), stroke: false });
              top.line([-0.5, y0], [s.Wc + 0.5, y0], { color: alpha('muted', 0.25), width: 1 });
            }
          } else top.grid({ step: 1 });
          top.line([-0.5, 0], [s.Wc + 0.5, 0], { color: alpha('muted', 0.4), width: 1 });
          // smooth truth
          const curve = []; for (let i = 0; i <= 120; i++) curve.push([X(i / 120), catmull(s.ys, i / 120)]);
          top.path(curve, { color: 'teal', width: s.beat === 0 ? 4.5 : 3 });
          a.forEach((y, i) => top.dot([i * dx, y], s.beat === 0 ? 4 : 3, { color: 'teal' }));
          if (s.beat === 0) {
            // play head + gripper following the motion
            const u = s.play, y = catmull(s.ys, u);
            top.line([X(u), -2.4], [X(u), 2.4], { color: alpha('muted', 0.4), dash: [4, 4], width: 1.5 });
            top.dot([X(u), y], 8, { color: 'pink', ring: 'bg' });
            top.emoji('🤖', [X(u), 2.15], 24);
          }
          if (s.beat === 1) {
            const st = [];
            qBin.forEach((q, i) => { st.push([i * dx - dx / 2, q], [i * dx + dx / 2, q]); });
            qBin.forEach((q, i) => top.line([i * dx, a[i]], [i * dx, q], { color: alpha('coral', 0.8), width: 2 }));
            top.path(st, { color: 'blue', width: 3.5 });
          }
          if (s.beat === 2) {
            // the kept waves, each faint, then their sum
            for (let k = 0; k < s.keep; k++) {
              const wpts = []; for (let i = 0; i <= 80; i++) { const u = i / 80; wpts.push([X(u), dctS(k) * Xc[k] * Math.cos((Math.PI / N) * (u * (N - 1) + 0.5) * k)]); }
              top.path(wpts, { color: alpha('purple', 0.35), width: 1.5 });
            }
            const rp = []; for (let i = 0; i <= 120; i++) { const u = i / 120; rp.push([X(u), idctAt(Xc, s.keep, (u * (N - 1) + 0.5) / N)]); }
            rec.forEach((r, i) => top.line([i * dx, a[i]], [i * dx, r], { color: alpha('coral', 0.8), width: 2 }));
            top.path(rp, { color: 'blue', width: 3.5 });
          }
          if (s.beat === 3) {
            const n = Math.min(N, Math.floor(s.seq));
            const st = [];
            for (let i = 0; i < n; i++) st.push([i * dx - dx / 2, qBin[i]], [i * dx + dx / 2, qBin[i]]);
            top.path(st, { color: 'blue', width: 3.5 });
            if (n < N) top.emoji('✏️', [n * dx, qBin[Math.max(0, n - 1)] + 0.35], 22);
          }
        });
        // error meters (top-left)
        if (s.beat === 1 || s.beat === 2) {
          top.meter('🔤', Math.sqrt(errBin), 1, { slot: 0, color: s.beat === 1 ? 'coral' : alpha('coral', 0.4) });
          top.meter('🎼', Math.sqrt(errDct), 1, { slot: 1, color: s.beat === 2 ? 'coral' : alpha('coral', 0.4) });
        }

        // ---------- bottom: the blocks ----------
        const bv = bot.view, P = stage.portrait, per = P ? 8 : N;
        const bw = P ? (s.Wc + 0.6) / per : dx, bh = Math.min(bw * 0.8, (bv[3] - bv[1]) * (P ? 0.17 : 0.3)), gap = bh * 0.45;
        const rows = Math.ceil(N / per);
        // block i: bottom-left corner; rows wrap on narrow screens
        const slot = (i, yTop) => [P ? -0.3 + (i % per) * bw : i * dx - dx / 2, yTop - Math.floor(i / per) * (bh + gap)];
        if (s.beat === 0) {
          // just the raw numbers: one dot-stick per moment
          a.forEach((y, i) => { bot.line([i * dx, 0], [i * dx, y * 0.5], { color: alpha('teal', 0.6), width: 3 }); bot.dot([i * dx, y * 0.5], 4, { color: 'teal' }); });
          bot.line([-0.3, 0], [s.Wc + 0.3, 0], { color: alpha('muted', 0.4), width: 1 });
        }
        if (s.beat === 1) {
          const top0 = ((rows - 1) * (bh + gap)) / 2 - bh / 2;
          a.forEach((y, i) => { const b = binOf(y), [x, yy] = slot(i, top0); block(x, yy, bw, bh, binCol(b), b); });
        }
        if (s.beat === 2) {
          const mx = Math.max(...Xc.map(Math.abs)) || 1, sc = (bv[3] - bv[1]) * 0.36 / mx;
          bot.line([-0.3, 0], [s.Wc + 0.3, 0], { color: alpha('muted', 0.4), width: 1 });
          Xc.forEach((c, k) => {
            const kept = k < s.keep;
            bot.bar(k * dx - dx * 0.35, 0, dx * 0.7, c * sc, { color: kept ? 'purple' : alpha('muted', 0.25) });
          });
          bot.line([(s.keep - 0.5) * dx, bv[1] + 0.1], [(s.keep - 0.5) * dx, bv[3] - 0.1], { color: 'orange', width: 2.5, dash: [5, 4] });
          bot.emoji('✂️', [(s.keep - 0.5) * dx, bv[3] - 0.3], 20);
        }
        if (s.beat === 3) {
          // blocks march into the brain one by one; arcs = how much the new block "listens" to old ones
          const n = Math.min(N, Math.floor(s.seq)), frac = s.seq - Math.floor(s.seq);
          const toks = a.map((y) => binOf(y));
          const E = toks.slice(0, Math.max(1, n)).map((b, i) => [((b + 0.5) / s.bins) * 2 - 1, ...positionalEncoding(i, 3)].map((x) => x * 2));
          const { weights } = attention([E[E.length - 1]], E, E);
          const y0 = bv[1] + 0.2 + (rows - 1) * (bh + gap);
          for (let i = 0; i < n; i++) { const [x, y] = slot(i, y0); block(x, y, bw, bh, binCol(toks[i]), toks[i]); }
          if (n > 1) weights[0].forEach((w, j) => {
            if (j === n - 1) return;
            const [xa, ya] = slot(j, y0), [xb, yb] = slot(n - 1, y0);
            const A = [xa + bw / 2, ya + bh * 1.2], B = [xb + bw / 2, yb + bh * 1.2];
            const h = 0.25 + 0.1 * Math.hypot(B[0] - A[0], B[1] - A[1]), top = Math.max(A[1], B[1]) + h;
            const pts = []; for (let k = 0; k <= 24; k++) { const u = k / 24; pts.push([(1 - u) ** 2 * A[0] + 2 * u * (1 - u) * (A[0] + B[0]) / 2 + u * u * B[0], (1 - u) ** 2 * A[1] + 2 * u * (1 - u) * top + u * u * B[1]]); }
            bot.path(pts, { color: alpha('blue', 0.25 + 0.75 * w), width: 1 + 10 * w });
          });
          if (n < N) { // the next block flying in from the right
            const [tx, ty] = slot(n, y0), k = Math.min(1, frac * 1.6);
            block(s.Wc + 0.3 - (s.Wc + 0.3 - tx) * k, ty + (1 - k) * 0.6, bw, bh, binCol(toks[n]), toks[n]);
          } else bot.emoji('✅', [s.Wc, bv[3] - 0.4], 22);
          if (s.seq > N + 2.5) s.seq = 0;
          bot.emoji('🧠', [s.Wc * 0.5, bv[3] - 0.35], 24);
        }
        void C; void cmap; void fmt;
      },
    };
  },
};
