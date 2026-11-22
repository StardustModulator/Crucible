// Overfitting = a coat that fits too tight. Too simple a model (a loose coat)
// misses the shape; too flexible a model wiggles through every noisy dot and
// then misses the NEW dots it never saw. Penalties (L2) and dropout calm the wiggles.
import { C, alpha } from '../viz/palette.js';
import { solve } from '../core/linalg.js';
import { MLP, Optimizer } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const truth = (x) => 0.85 * Math.sin(2.6 * x) + 0.25 * x;
const NT = 10, NTEST = 18, SIG = 0.25, DMAX = 9;
// Legendre polynomials keep the least-squares problem well conditioned on [−1, 1]
function legendre(x, d) {
  const P = [1, x];
  for (let n = 1; n < d; n++) P.push(((2 * n + 1) * x * P[n] - n * P[n - 1]) / (n + 1));
  return P.slice(0, d + 1);
}
function fitPoly(X, Y, d, lam) {
  const Phi = X.map((x) => legendre(x, d));
  const A = Array.from({ length: d + 1 }, (_, i) => Array.from({ length: d + 1 }, (_, j) => Phi.reduce((s, r) => s + r[i] * r[j], 0) + (i === j && i > 0 ? lam : 0)));
  const b = Array.from({ length: d + 1 }, (_, i) => Phi.reduce((s, r, k) => s + r[i] * Y[k], 0));
  const w = solve(A, b) ?? new Array(d + 1).fill(0);
  return (x) => legendre(x, d).reduce((s, p, i) => s + p * w[i], 0);
}
const mse = (f, X, Y) => X.reduce((s, x, i) => s + (f(x) - Y[i]) ** 2, 0) / X.length;

export default {
  eq: [
    [['ŷ(x)', 'blue'], ' = Σₖ ', ['wₖ', 'blue'], ' Pₖ(x),   k = 0 … ', ['d', 'gold'], '        (', ['d', 'gold'], ' = how bendy the model may be)'],
    ['fit:  min  Σ (', ['ŷ', 'blue'], ' − ', ['y', 'teal'], ')²  +  ', ['λ', 'purple'], ' ‖', ['w', 'blue'], '‖²        (L2 penalty = 🧴)'],
    [['train error', 'teal'], ' always falls as ', ['d', 'gold'], ' grows;   ', ['test error', 'coral'], ' is U-shaped'],
    ['dropout:  ', ['h', 'blue'], ' ← ', ['h', 'blue'], ' ⊙ ', ['mask', 'purple'], ' / (1 − p),   a new random ', ['mask', 'purple'], ' every step'],
    ['truth ', ['f(x)', 'lime'], ',  noise σ = 0.25'],
  ],
  setup({ stage, ui }) {
    const [Lp, Rp] = stage.split([[-2.2, -1.75, 2.2, 1.75], [0, 0, 10, 7.4]], [1.25, 1]);
    const r = rng(21);
    const s = { d: 1, lam: 1e-7, beat: 0, t: 0, seed: 31, curve: null, dropT: 0, mask: [] };
    let train, test;
    const makeData = () => {
      const rr = rng(s.seed);
      train = { X: [], Y: [] }; test = { X: [], Y: [] };
      for (let i = 0; i < NT; i++) { const x = -0.97 + 1.94 * (i + rr.uniform(0.1, 0.9)) / NT; train.X.push(x); train.Y.push(truth(x) + rr.normal(0, SIG)); }
      for (let i = 0; i < NTEST; i++) { const x = -0.98 + 1.96 * (i + 0.5) / NTEST; test.X.push(x); test.Y.push(truth(x) + rr.normal(0, SIG)); }
      s.curve = null; resetNets();
    };

    // two little nets for the dropout chapter: same start, one with dropout
    const H = 28, P = 0.3;
    let nets;
    function resetNets() {
      nets = [false, true].map((drop) => {
        const net = new MLP([1, H, 1], ['tanh', 'linear'], 7);
        net.W[0].forEach((w) => (w[0] *= 4));            // steep first-layer units → a very bendy net
        return { drop, net, opt: new Optimizer(net, { type: 'adam', lr: 0.03 }), steps: 0, err: null };
      });
    }
    const netF = (n) => (x) => n.net.predict([x])[0];
    // one full-batch step of 1-hidden-layer backprop with an optional dropout mask (per sample)
    const netStep = (n) => {
      const { net } = n;
      const gW = [net.W[0].map(() => [0]), [new Array(H).fill(0)]], gb = [new Array(H).fill(0), [0]];
      train.X.forEach((x, k) => {
        const mask = Array.from({ length: H }, () => (!n.drop || r() > P ? (n.drop ? 1 / (1 - P) : 1) : 0));
        if (n.drop && k === 0 && s.t - s.dropT > 0.22) { s.mask = mask.map((m) => m > 0); s.dropT = s.t; }
        const a = net.W[0].map((w, i) => Math.tanh(w[0] * x + net.b[0][i]));
        const h = a.map((v, i) => v * mask[i]);
        const y = net.W[1][0].reduce((sum, w, i) => sum + w * h[i], net.b[1][0]);
        const dy = y - train.Y[k];
        gb[1][0] += dy;
        for (let i = 0; i < H; i++) {
          gW[1][0][i] += dy * h[i];
          const dz = dy * net.W[1][0][i] * mask[i] * (1 - a[i] * a[i]);
          gW[0][i][0] += dz * x; gb[0][i] += dz;
        }
      });
      n.opt.step(gW, gb, train.X.length);
      n.steps++;
    };
    makeData();

    const dSl = ui.slider({ icon: '〰️', color: 'gold', min: 0, max: DMAX, step: 1, value: s.d, title: 'how bendy (polynomial degree)', onInput: (v) => (s.d = v) });
    const lSl = ui.slider({ icon: '🧴', color: 'purple', min: -7, max: 0, step: 0.1, value: -7, title: 'L2 penalty λ (log)', onInput: (v) => { s.lam = 10 ** v; s.curve = null; } });
    ui.button({ icon: '🎲', title: 'new noisy dots', onClick: () => { s.seed++; makeData(); } });
    ui.readout(() => (s.beat === 4 ? fmt(mse(netF(nets[1]), test.X, test.Y), 3) : fmt(mse(fit(), test.X, test.Y), 3)), { icon: '◯', color: 'coral', title: 'error on new (test) dots' });
    ui.beats(['🧥', '✅', '🪢', '🧴', '💤'], (b) => {
      s.beat = b;
      s.d = [1, 4, DMAX, DMAX, DMAX][b]; dSl.set(s.d);
      const l = b === 3 ? -2.5 : -7; lSl.set(l); s.lam = 10 ** l; s.curve = null;
      if (b === 4) resetNets();
    });

    let fitKey = '', fitFn = null;
    function fit() {
      const k = `${s.d}|${s.lam}|${s.seed}`;
      if (k !== fitKey) { fitFn = fitPoly(train.X, train.Y, s.d, s.lam); fitKey = k; }
      return fitFn;
    }
    const uCurve = () => {
      if (!s.curve) s.curve = Array.from({ length: DMAX + 1 }, (_, d) => { const f = fitPoly(train.X, train.Y, d, s.lam); return [mse(f, train.X, train.Y), mse(f, test.X, test.Y)]; });
      return s.curve;
    };

    return {
      update(dt) {
        dt = Math.max(0, dt);                 // the shell can hand a tiny negative dt right after ⏭
        s.t += dt;
        if (s.beat === 4) {
          for (let k = 0; k < 6; k++) nets.forEach((n) => { if (n.steps < 6000) netStep(n); });
          // how far each net is from the true (lime) curve, smoothed
          nets.forEach((n) => { let e = 0; for (let i = 0; i < 60; i++) { const x = -0.98 + 1.96 * i / 59; e += (netF(n)(x) - truth(x)) ** 2; } e /= 60; n.err = n.err === null ? e : n.err * 0.95 + e * 0.05; });
        }
      },
      draw() {
        drawData();
        if (s.beat === 4) drawDropout(); else drawU();
      },
    };

    function drawData() {
      const g = Lp, X = (x) => 2 * x;
      g.line([-2.1, 0], [2.1, 0], { color: 'grid', width: 1 });
      g.plot((u) => truth(u / 2), { range: [-2, 0, 2, 0], color: alpha('lime', 0.9), width: 2.5, dash: [8, 6] });
      g.clip(() => {
        if (s.beat === 4) {
          g.plot((u) => netF(nets[0])(u / 2), { range: [-2, 0, 2, 0], color: alpha('blue', 0.45), width: 2.5, dash: [3, 5], samples: 160 });
          g.plot((u) => netF(nets[1])(u / 2), { range: [-2, 0, 2, 0], color: 'blue', width: 4, samples: 160 });
        } else {
          const f = fit();
          // test misses (coral)
          test.X.forEach((x, i) => g.line([X(x), test.Y[i]], [X(x), clamp(f(x), -3, 3)], { color: alpha('coral', 0.75), width: 2 }));
          g.plot((u) => f(u / 2), { range: [-2, 0, 2, 0], color: 'blue', width: 4, samples: 400 });
        }
      });
      train.X.forEach((x, i) => g.dot([X(x), train.Y[i]], 6, { color: 'teal', ring: 'bg', ringWidth: 2 }));
      test.X.forEach((x, i) => { g.dot([X(x), test.Y[i]], 6, { color: 'bg' }); g.circle([X(x), test.Y[i]], g.world(5.5), { color: 'teal', width: 2.5 }); });
      const face = s.beat === 4 ? '💤' : s.d <= 2 ? '🧥' : s.d >= 8 && s.lam < 1e-3 ? '🪢' : '✅';
      g.emoji(face, [1.85, 1.45], 30);
    }

    function drawU() {
      const g = Rp, U = uCurve();
      const x0 = 1.0, x1 = 9.6, y0 = 1.2, y1 = 6.9, lo = -2.2, hi = 1.0;
      const X = (d) => x0 + (d / DMAX) * (x1 - x0), Y = (v) => y0 + clamp((Math.log10(v) - lo) / (hi - lo), 0, 1) * (y1 - y0);
      g.line([x0, y0], [x1, y0], { color: 'muted', width: 1.5 });
      g.line([x0, y0], [x0, y1], { color: 'muted', width: 1.5 });
      for (let d = 0; d <= DMAX; d++) g.line([X(d), y0], [X(d), y0 - 0.12], { color: 'muted', width: 1.2 });
      // noise floor: the best anyone can do
      g.line([x0, Y(SIG * SIG)], [x1, Y(SIG * SIG)], { color: alpha('purple', 0.6), width: 1.5, dash: [5, 5] });
      g.plot(U.map((u, d) => [X(d), Y(u[0])]), { color: 'teal', width: 3.5 });
      g.plot(U.map((u, d) => [X(d), Y(u[1])]), { color: 'coral', width: 3.5 });
      U.forEach((u, d) => { g.dot([X(d), Y(u[0])], 4, { color: 'teal' }); g.dot([X(d), Y(u[1])], 4, { color: 'coral' }); });
      const best = U.reduce((b, u, d) => (u[1] < U[b][1] ? d : b), 0);
      g.emoji('⭐', [X(best), Y(U[best][1]) - 0.45], 16);
      g.line([X(s.d), y0], [X(s.d), y1], { color: 'gold', width: 2.5 });
      g.dot([X(s.d), Y(U[s.d][1])], 8, { color: 'coral', ring: 'gold', ringWidth: 2.5 });
      g.dot([X(s.d), Y(U[s.d][0])], 8, { color: 'teal', ring: 'gold', ringWidth: 2.5 });
      g.emoji('🧥', [X(1), y0 - 0.6], 20); g.emoji('✅', [X(4), y0 - 0.6], 20); g.emoji('🪢', [X(DMAX), y0 - 0.6], 20);
      g.dot([x0 + 0.35, y1 + 0.1], 6, { color: 'teal' });
      g.dot([x0 + 1.25, y1 + 0.1], 6, { color: 'bg' }); g.circle([x0 + 1.25, y1 + 0.1], g.world(5.5), { color: 'coral', width: 2.5 });
    }

    function drawDropout() {
      const g = Rp;
      // the dropout net: 1 → H → 1, neurons blink off at random
      const inp = [1.2, 4.0], out = [8.8, 4.0];
      const ys = Array.from({ length: H }, (_, i) => 6.9 - (i / (H - 1)) * 5.8);
      const net = nets[1].net;
      ys.forEach((y, i) => {
        const on = s.mask[i] ?? true, hx = 5.0 + (i % 2 ? 0.45 : -0.45);
        const w1 = net.W[0][i][0], w2 = net.W[1][0][i];
        g.line(inp, [hx, y], { color: alpha(w1 >= 0 ? 'blue' : 'coral', on ? 0.55 : 0.08), width: 0.5 + Math.min(3, Math.abs(w1)) });
        g.line([hx, y], out, { color: alpha(w2 >= 0 ? 'blue' : 'coral', on ? 0.55 : 0.08), width: 0.5 + Math.min(3, Math.abs(w2) * 2) });
      });
      const nr = clamp(g.px(5.8 / (H - 1)) * 0.95, 2.5, 7);
      ys.forEach((y, i) => {
        const on = s.mask[i] ?? true, hx = 5.0 + (i % 2 ? 0.45 : -0.45);
        if (on) g.dot([hx, y], nr, { color: 'blue', ring: 'bg', ringWidth: nr > 4 ? 2 : 1 });
        else { g.dot([hx, y], nr, { color: alpha('purple', 0.18) }); g.circle([hx, y], g.world(nr), { color: alpha('purple', 0.6), width: 1.5, dash: [2, 2] }); }
      });
      g.dot(inp, 12, { color: 'teal', ring: 'bg' }); g.text('x', inp, { color: 'white', size: 13, weight: 800, halo: false });
      g.dot(out, 12, { color: 'blue', ring: 'bg' }); g.text('ŷ', out, { color: 'white', size: 13, weight: 800, halo: false });
      g.emoji('🎲', [5.0, 7.25], 18);
      // distance of each net from the true curve (coral bars): plain (faint) vs dropout
      const e0 = nets[0].err ?? 0, e1 = nets[1].err ?? 0, m = Math.max(e0, e1, 0.03);
      g.line([0.6, 0.3], [3.4, 0.3], { color: 'muted', width: 1 });
      g.bar(0.9, 0.3, 0.7, 2.2 * e0 / m, { color: alpha('coral', 0.45) });
      g.bar(2.3, 0.3, 0.7, 2.2 * e1 / m, { color: 'coral' });
      g.line([0.85, 2.85], [1.65, 2.85], { color: alpha('blue', 0.6), width: 2.5, dash: [3, 4] });
      g.line([2.25, 2.85], [3.05, 2.85], { color: 'blue', width: 4 });
      g.emoji('💤', [2.65, 3.35], 16);
      void C;
    }
  },
};
