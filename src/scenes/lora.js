// LoRA: a big brain is a big wall of numbers W. Instead of repainting the
// whole wall to teach it something new, freeze it ❄️ and add a change made of
// two THIN strips: tall B times wide A. Each pair of stripes paints one
// "plaid" layer; a few layers add up to most of the picture, for way fewer numbers.
import { C, alpha, cmapCSS } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { svd, mmul } from '../core/linalg.js';
import { rng, clamp } from '../core/random.js';

const N = 16, RMAX = 8, VR = 1.2;
const cellCol = (v) => cmapCSS(0.5 + 0.5 * clamp(v / VR, -1, 1), 'div');

function smiley() {
  const M = [];
  for (let i = 0; i < N; i++) {
    const row = [];
    for (let j = 0; j < N; j++) {
      const x = (j - 7.5) / 7.5, y = (7.5 - i) / 7.5, r = Math.hypot(x, y);
      let v = r < 0.95 ? 0.75 : 0;
      if (Math.hypot(x + 0.36, y - 0.3) < 0.16 || Math.hypot(x - 0.36, y - 0.3) < 0.16) v = -1;
      if (r > 0.42 && r < 0.62 && y < -0.12) v = -1;
      row.push(v);
    }
    M.push(row);
  }
  return M;
}

export default {
  eq: [
    [['W′', 'blue'], ' = ', ['W', 'slate'], ' ❄️ + ', ['ΔW', 'blue'], '  ·  ', ['ΔW', 'blue'], ' = ', ['B', 'teal'], ' ', ['A', 'pink'], ''],
    [['B', 'teal'], ': d × ', ['r', 'orange'], '  ·  ', ['A', 'pink'], ': ', ['r', 'orange'], ' × d  ·  ', ['ΔW', 'blue'], ' = Σₖ ', ['bₖ', 'teal'], ' ', ['aₖ', 'pink'], 'ᵀ  (', ['r', 'orange'], ' outer products)'],
    ['numbers:  d² → 2d', ['r', 'orange'], '  ·  d = 4096, r = 8:  16.8M → 65.5K'],
    ['best rank-', ['r', 'orange'], ':  ', ['ΔW', 'blue'], ' = Σₖ≤r σₖ uₖ vₖᵀ  ·  ', ['error', 'coral'], '² = Σₖ>r σₖ²  ·  (target ', ['ΔW*', 'lime'], ')'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const R = rng(6);
    // frozen pretrained W: smooth-ish random wall
    const z = Array.from({ length: N + 3 }, () => Array.from({ length: N + 3 }, () => R.normal()));
    const W = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => 0.45 * (z[i][j] + z[i + 1][j + 1] + z[i + 2][j] + z[i][j + 2] + z[i + 1][j + 1]) / 2.2));
    const s = { beat: 0, t: 0, r: 3, target: smiley(), paint: null };
    let dec = null;
    const refresh = () => { dec = svd(s.target); };
    refresh();
    const factors = (r) => {
      const B = Array.from({ length: N }, (_, i) => Array.from({ length: r }, (_, k) => dec.U[i][k] * Math.sqrt(dec.S[k])));
      const A = Array.from({ length: r }, (_, k) => Array.from({ length: N }, (_, j) => dec.V[j][k] * Math.sqrt(dec.S[k])));
      return { B, A, dW: mmul(B, A) };
    };
    const errOf = (r) => Math.sqrt(dec.S.slice(r).reduce((a, x) => a + x * x, 0) / dec.S.reduce((a, x) => a + x * x, 0));

    const setB = (b) => { if (!g.bounds || g.bounds.join() !== b.join()) g.setBounds(b); };
    const mat = (M, tl, size, frame, o = {}) => {
      g.cells(M, tl, size, { colorFn: (v) => cellCol(v), gridColor: o.grid ?? alpha('bg', 0.6) });
      const h = M.length * size, w = M[0].length * size;
      if (frame) g.rect(tl[0] - 0.12, tl[1] - h - 0.12, w + 0.24, h + 0.24, { color: frame, width: o.fw ?? 3 });
    };

    // painting the target (beat 5)
    const cellAt = (p) => { const l = lay4(); const j = Math.floor((p[0] - l.tgt[0]) / l.sz), i = Math.floor((l.tgt[1] - p[1]) / l.sz); return i >= 0 && j >= 0 && i < N && j < N ? [i, j] : null; };
    stage.on('down', (e) => {
      if (s.beat !== 4) return;
      const c = cellAt(e.p); if (!c) return;
      s.paint = s.target[c[0]][c[1]] > 0.5 ? 0 : 1;
      s.target[c[0]][c[1]] = s.paint; refresh();
    });
    stage.on('move', (e) => {
      if (s.beat !== 4 || s.paint === null || !stage.pointer.down) return;
      const c = cellAt(e.p); if (c && s.target[c[0]][c[1]] !== s.paint) { s.target[c[0]][c[1]] = s.paint; refresh(); }
    });
    stage.on('up', () => (s.paint = null));

    ui.beats(['🧱', '🪶', '✖️', '📊', '🎯'], (b) => { s.beat = b; s.t = 0; });
    const rSl = ui.slider({ icon: '🪶', color: 'orange', min: 1, max: RMAX, step: 1, value: s.r, title: 'rank r', onInput: (v) => (s.r = v) });
    ui.button({ icon: '🙂', title: 'smiley target', onClick: () => { s.target = smiley(); refresh(); } });
    ui.button({ icon: '🧽', title: 'blank target', onClick: () => { s.target = s.target.map((row) => row.map(() => 0)); s.target[0][0] = 0.01; refresh(); } });
    ui.readout(() => `${N * N} → ${2 * N * s.r}`, { icon: '🔢', color: 'blue', title: 'numbers to train' });
    ui.readout(() => fmt(errOf(s.r) * 100, 0) + '%', { icon: '📏', color: 'coral', title: 'error left' });
    void rSl;

    function lay4() {
      return stage.portrait ? { b: [-1, -1, 35, 40], tgt: [0, 38], app: [18, 38], sz: 1, sv: [0, 2, 32, 15] }
        : { b: [-1, -1, 56, 18.5], tgt: [0, 16], app: [18, 16], sz: 1, sv: [37, 1, 15, 14] };
    }

    return {
      update(dt) { s.t += Math.max(0, dt); },
      draw() {
        const P = stage.portrait, r = s.r, f = factors(r);
        if (s.beat === 0) {
          setB([-2, -2, 18, 18.5]);
          // every number in the wall wants to change: they all shimmer
          const wig = W.map((row, i) => row.map((v, j) => v + 0.25 * Math.sin(s.t * 3 + i * 0.9 + j * 1.7)));
          mat(wig, [0, 16], 1, 'slate');
          g.emoji('🧱', [-1, 17.4], 26);
          g.text(String(N * N), [8, 17.4], { size: 22, color: 'slate' });
        } else if (s.beat === 1) {
          // W ❄️ + B·A, laid out like a multiplication
          const L = P ? { b: [-2, -1, 26.5, 46], W: [9, 44.5], plus: [17, 27], B: [8 - r, 16], A: [9, 17 + r], D: [9, 16] }
            : { b: [-1.5, -1, 45, 26], W: [0, 16], plus: [17.6, 8], B: [27 - r, 16], A: [28, 17 + r], D: [28, 16] };
          setB(L.b);
          mat(W, L.W, 1, 'slate');
          g.emoji('❄️', [L.W[0] + 15, L.W[1] + 0.9], 22);
          g.text('+', L.plus, { size: 34, color: 'muted' });
          mat(f.B, L.B, 1, 'teal');
          mat(f.A, L.A, 1, 'pink');
          mat(f.dW, L.D, 1, 'blue');
          g.text('B', [L.B[0] - 0.8, L.B[1] - 8], { size: 20, color: 'teal' });
          g.text('A', [L.A[0] - 1, L.A[1] - r / 2], { size: 20, color: 'pink' });
          g.text('ΔW', [L.D[0] + 8, L.D[1] - 16.9], { size: 20, color: 'blue' });
          // one stripe pair at a time lights up
          const k = Math.floor(s.t / 1.2) % r;
          g.rect(L.B[0] + k, L.B[1] - 16, 1, 16, { color: 'gold', width: 3 });
          g.rect(L.A[0], L.A[1] - k - 1, 16, 1, { color: 'gold', width: 3 });
        } else if (s.beat === 2) {
          // the stripes: each bₖaₖᵀ is a plaid; they stack up into ΔW
          const sz = 0.45, step = 8.6, per = 4;
          const L = P ? { b: [-1, -1, 34.5, 39], s0: [0, 37.5], D: [9, 16], eq: [12, 17.2] } : { b: [-1, -1, 53, 19.5], s0: [0, 17.6], D: [36, 16], eq: [34.4, 8] };
          setB(L.b);
          const shown = Math.min(r, Math.floor(s.t / 1.1) % (r + 2));
          let acc = Array.from({ length: N }, () => new Array(N).fill(0));
          for (let k = 0; k < r; k++) {
            const tl = [L.s0[0] + (k % per) * step, L.s0[1] - Math.floor(k / per) * step];
            const stripe = f.B.map((row) => f.A[k].map((a) => row[k] * a));
            if (k < shown) { acc = acc.map((row, i) => row.map((v, j) => v + stripe[i][j])); mat(stripe, tl, sz, k === shown - 1 ? 'gold' : alpha('muted', 0.5), { grid: null, fw: 2 }); }
            else g.rect(tl[0], tl[1] - N * sz, N * sz, N * sz, { color: alpha('muted', 0.35), dash: [4, 4], width: 1.5 });
            if (k % per) g.text('+', [tl[0] - 0.7, tl[1] - N * sz / 2], { size: 18, color: 'muted' });
          }
          g.text('=', L.eq, { size: 30, color: 'muted' });
          mat(acc, L.D, 1, 'blue');
          g.text(`${shown}`, [L.D[0] + 8, L.D[1] + 1], { size: 22, color: 'orange' });
        } else if (s.beat === 3) {
          // how many numbers do we have to train?
          setB(P ? [-1, -1, 13, 18.6] : [-1, -1, 24, 13]);
          const groups = [[N, '16'], [4096, '4096']];
          groups.forEach(([d, lab], gi) => {
            const x0 = P ? 0 : gi * 12, y0 = P ? (1 - gi) * 9.6 : 0, full = d * d, lo = 2 * d * r, H = P ? 6 : 10;
            const hf = H, hl = Math.max(0.12, H * lo / full);
            g.bar(x0 + 1, y0 + 0.6, 3.6, hf, { color: alpha('slate', 0.75) });
            g.bar(x0 + 5.6, y0 + 0.6, 3.6, hl, { color: 'blue' });
            g.text(full.toLocaleString('en-US'), [x0 + 2.8, y0 + 0.6 + hf + 0.5], { size: 15, color: 'slate' });
            g.text(lo.toLocaleString('en-US'), [x0 + 7.4, y0 + 0.6 + hl + 0.5], { size: 15, color: 'blue' });
            g.emoji('🧱', [x0 + 2.8, y0 - 0.1], 18); g.emoji('🪶', [x0 + 7.4, y0 - 0.1], 18);
            g.text(`d=${lab}`, [x0 + 5.1, y0 + 0.6 + hf + 1.4], { size: 14, color: 'muted' });
            g.text(`÷${fmt(full / lo, 0)}`, [x0 + 9.9, y0 + 0.6 + H * 0.5], { size: 24, color: 'gold' });
          });
        } else {
          // target vs best rank-r; singular values show where the picture's "energy" lives
          const l = lay4(); setB(l.b);
          mat(s.target, l.tgt, l.sz, 'lime');
          mat(f.dW, l.app, l.sz, 'blue');
          g.text('≈', [17, l.tgt[1] - 8], { size: 26, color: 'muted' });
          g.emoji('✏️', [l.tgt[0] + 15.5, l.tgt[1] + 0.9], 18);
          const [sx, sy, sw, shh] = l.sv, mx = dec.S[0] || 1, bw = sw / N;
          dec.S.forEach((sv, k) => g.bar(sx + k * bw + bw * 0.15, sy, bw * 0.7, (shh * sv) / mx, { color: k < r ? 'orange' : alpha('muted', 0.35) }));
          g.line([sx + r * bw, sy - 0.3], [sx + r * bw, sy + shh], { color: 'orange', width: 2, dash: [4, 4] });
          g.text('σₖ', [sx + 0.6, sy + shh + 0.9], { size: 18, color: 'orange' });
          // error meter
          const e = errOf(r), ex = P ? 34 : 54, eh = P ? 15 : 14;
          g.rect(ex - 0.5, sy, 1, eh, { color: alpha('coral', 0.5), width: 1.5 });
          g.rect(ex - 0.5, sy, 1, eh * e, { fill: 'coral', stroke: false });
          g.emoji('📏', [ex, sy + eh + 0.9], 16);
        }
        void C;
      },
    };
  },
};
