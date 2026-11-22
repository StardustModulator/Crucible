// A Gaussian process is a bag of wiggly guesses. Before any data it could be
// anything (spaghetti everywhere). Every dot you drop pinches all the guesses
// together right there — and far from the dots they fan out again.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { gpPosterior, rbf } from '../core/learning.js';
import { cholesky } from '../core/linalg.js';
import { rng, clamp } from '../core/random.js';

const MAXP = 14;           // handle pool
const NS = 5;              // spaghetti strands
const M = 72;              // grid for the joint (strand) posterior
const SF = 1.3;            // signal std σf
const truth = (x) => 1.1 * Math.sin(0.9 * x) + 0.45 * Math.cos(2.1 * x + 0.4) + 0.15 * x;

// lower-triangular solve L v = b
function fwd(L, b) { const x = []; for (let i = 0; i < b.length; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * x[k]; x.push(s / L[i][i]); } return x; }

export default {
  eq: [
    [['f', 'blue'], ' ~ GP(0, k)  ·  k(x,x′) = σf² exp(−(x−x′)² / 2', ['ℓ', 'orange'], '²)'],
    [['μ*', 'blue'], ' = k*ᵀ (K + ', ['σn', 'purple'], '² I)⁻¹ ', ['y', 'teal']],
    [['σ*²', 'purple'], ' = k** − k*ᵀ (K + ', ['σn', 'purple'], '² I)⁻¹ k*'],
    [['x next', 'gold'], ' = argmax ', ['σ*(x)', 'purple']],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-5, -3.3, 5, 3.4]);
    const R = rng(7);
    const s = {
      pts: [], ell: 1.0, sn: 0.12, beat: 0, t: 0, dirty: true, key: '',
      eps: Array.from({ length: NS }, () => [Array.from({ length: M }, () => R.normal()), Array.from({ length: M }, () => R.normal())]),
      phase: Array.from({ length: NS }, () => R.uniform(0, 6.28)),
      robot: { x: 0, timer: 0, drop: 0 }, noise: rng(11),
    };
    const preset = () => [[-3.2, truth(-3.2)], [-1.1, truth(-1.1)], [0.6, truth(0.6)], [3.4, truth(3.4)]];

    // one handle per point slot
    for (let i = 0; i < MAXP; i++) {
      stage.handle({
        pen: g, color: 'teal', r: 8, visible: () => i < s.pts.length && s.beat > 0,
        get: () => s.pts[i], set: (p) => { const v = g.view; s.pts[i] = [clamp(p[0], v[0] + 0.2, v[2] - 0.2), clamp(p[1], -3, 3)]; s.dirty = true; },
      });
    }
    stage.on('down', (e) => {
      if (e.pen !== g || s.beat === 0 || s.pts.length >= MAXP) return;
      s.pts.push([e.p[0], clamp(e.p[1], -3, 3)]); s.dirty = true;
    });

    ui.beats(['🌫️', '📍', '📏', '🤖'], (b) => {
      s.beat = b; s.dirty = true;
      if (b === 0) s.pts = [];
      if (b === 1 || b === 2) { if (s.pts.length < 2) s.pts = preset(); }
      if (b === 3) { s.pts = [[-2.2, truth(-2.2) + 0.05]]; s.robot.timer = 0.6; }
    });
    const ell = ui.slider({ icon: '📏', color: 'orange', min: 0.25, max: 3, step: 0.01, value: s.ell, title: 'length-scale ℓ', onInput: (v) => { s.ell = v; s.dirty = true; } });
    ui.slider({ icon: '🌫️', color: 'purple', min: 0.02, max: 0.9, step: 0.01, value: s.sn, title: 'noise σn', onInput: (v) => { s.sn = v; s.dirty = true; } });
    ui.button({ icon: '↩️', title: 'remove last point', onClick: () => { s.pts.pop(); s.dirty = true; } });
    ui.button({ icon: '🧽', title: 'clear points', onClick: () => { s.pts = []; s.dirty = true; } });
    ui.readout(() => s.pts.length, { icon: '📍', color: 'teal', title: 'data points' });
    ui.readout(() => fmt(s.maxSd ?? SF, 2), { icon: '🌫️', color: 'purple', title: 'biggest uncertainty' });
    void ell;

    // ---- the real math, recomputed only when something changed ----
    function recompute() {
      const v = g.view;
      const xs = Array.from({ length: M }, (_, i) => v[0] + ((v[2] - v[0]) * i) / (M - 1));
      const pts = s.beat === 0 ? [] : s.pts;
      const X = pts.map((p) => p[0]), Y = pts.map((p) => p[1]);
      const hyp = { ell: s.ell, sf: SF, sn: s.sn };
      const { mu, sd } = gpPosterior(X, Y, xs, hyp);
      // joint posterior covariance on the grid → Cholesky → strands
      let Kp = xs.map((a) => xs.map((b) => rbf(a, b, s.ell, SF)));
      if (X.length) {
        const K = X.map((a, i) => X.map((b, j) => rbf(a, b, s.ell, SF) + (i === j ? s.sn * s.sn : 0)));
        const L = cholesky(K);
        if (L) {
          const V = xs.map((x) => fwd(L, X.map((a) => rbf(a, x, s.ell, SF))));
          Kp = Kp.map((row, i) => row.map((k, j) => k - V[i].reduce((acc, vi, n) => acc + vi * V[j][n], 0)));
        }
      }
      let Lp = null;
      for (let jit = 1e-6; !Lp && jit < 1; jit *= 10) Lp = cholesky(Kp.map((row, i) => row.map((k, j) => (i === j ? k + jit * SF * SF : k))));
      s.gp = { xs, mu, sd, Lp };
      // only search the robot's room (the drawn box), not the far-away margins
      let bi = -1; sd.forEach((d, i) => { if (Math.abs(xs[i]) <= 4.6 && (bi < 0 || d > sd[bi])) bi = i; });
      s.maxSd = sd[bi]; s.best = xs[bi]; s.bestI = bi;
      s.dirty = false;
    }

    return {
      update(dt) {
        dt = Math.max(0, dt); // first frame can report a negative dt
        s.t += dt;
        if (s.beat === 3) {
          // the robot flies to the most uncertain spot and measures there
          if (!s.gp) recompute();
          s.robot.x += (s.best - s.robot.x) * Math.min(1, dt * 3);
          s.robot.timer -= dt;
          s.robot.drop = Math.max(0, s.robot.drop - dt);
          if (s.robot.timer <= 0 && Math.abs(s.robot.x - s.best) < 0.08) {
            if (s.pts.length >= 10) s.pts = [[s.noise.uniform(-3, 3), 0]].map((p) => [p[0], truth(p[0])]);
            else {
              const x = s.robot.x; s.pts.push([x, truth(x) + s.noise.normal(0, 0.08)]);
              s.robot.drop = 0.5;
            }
            s.dirty = true; s.robot.timer = 1.5;
          }
        }
      },
      draw() {
        const v = g.view;
        const key = v.map((x) => x.toFixed(2)).join();
        if (key !== s.key) { s.key = key; s.dirty = true; }
        if (s.dirty || !s.gp) recompute();
        const { xs, mu, sd, Lp } = s.gp;
        g.grid({ step: 1 });
        // hidden truth (only when the robot explores)
        if (s.beat === 3) g.plot(truth, { color: alpha('lime', 0.75), width: 2, dash: [6, 6] });
        // ±2σ band
        g.band(xs, mu.map((m, i) => m - 2 * sd[i]), mu.map((m, i) => m + 2 * sd[i]), { color: 'purple', alpha: 0.2 });
        g.band(xs, mu.map((m, i) => m - sd[i]), mu.map((m, i) => m + sd[i]), { color: 'purple', alpha: 0.14 });
        // spaghetti: f = μ + L·ε(t), ε rotating on a circle so each strand stays a true sample
        for (let k = 0; k < NS; k++) {
          const a = s.t * 0.7 + s.phase[k], c = Math.cos(a), sn = Math.sin(a);
          const e = s.eps[k][0].map((x, i) => c * x + sn * s.eps[k][1][i]);
          const f = xs.map((x, i) => { let acc = mu[i]; for (let j = 0; j <= i; j++) acc += Lp[i][j] * e[j]; return [x, acc]; });
          g.path(f, { color: alpha('purple', s.beat === 0 ? 0.75 : 0.45), width: s.beat === 0 ? 2.2 : 1.5 });
        }
        // mean
        g.path(xs.map((x, i) => [x, mu[i]]), { color: 'blue', width: 4 });
        // length-scale: each point's "reach" as an orange hill + a ruler
        if (s.beat === 2) {
          const base = v[1] + 0.25;
          for (const p of s.pts) {
            const hill = []; for (let i = 0; i <= 60; i++) { const x = p[0] - 3.5 * s.ell + (7 * s.ell * i) / 60; hill.push([x, base + 0.9 * Math.exp(-((x - p[0]) ** 2) / (2 * s.ell * s.ell))]); }
            g.poly([[hill[0][0], base], ...hill, [hill[60][0], base]], { fill: alpha('orange', 0.18), color: alpha('orange', 0.7), width: 1.5 });
            g.line([p[0], base], p, { color: alpha('orange', 0.35), dash: [2, 4], width: 1 });
          }
          const x0 = v[0] + 0.5, y0 = v[3] - 0.45;
          g.line([x0, y0], [x0 + s.ell, y0], { color: 'orange', width: 4 });
          g.line([x0, y0 - 0.15], [x0, y0 + 0.15], { color: 'orange', width: 3 });
          g.line([x0 + s.ell, y0 - 0.15], [x0 + s.ell, y0 + 0.15], { color: 'orange', width: 3 });
          g.text('ℓ', [x0 + s.ell / 2, y0 + 0.32], { color: 'orange', size: 20 });
        }
        // data with ±2σn whiskers
        if (s.beat > 0) for (const p of s.pts) {
          g.line([p[0], p[1] - 2 * s.sn], [p[0], p[1] + 2 * s.sn], { color: alpha('purple', 0.8), width: 2 });
        }
        // the robot picks where to measure next
        if (s.beat === 3) {
          const x = s.robot.x, top = v[3] - 0.5;
          let bi = 0; xs.forEach((xx, i) => { if (Math.abs(xx - x) < Math.abs(xs[bi] - x)) bi = i; });
          const tip = mu[bi] + 2 * sd[bi] + 0.15, b = s.bestI;
          g.line([s.best, mu[b] - 2 * sd[b]], [s.best, mu[b] + 2 * sd[b]], { color: 'gold', width: 3, dash: [4, 4] });
          if (top - 0.35 > tip) g.arrow([x, top - 0.35], [x, tip], { color: 'gold', width: 4 });
          g.emoji('🤖', [x, top], 30);
          if (s.robot.drop > 0) g.circle(s.pts[s.pts.length - 1], 0.15 + (0.5 - s.robot.drop) * 1.2, { color: alpha('teal', s.robot.drop * 2), width: 3 });
          for (const p of s.pts) g.dot(p, 7, { color: 'teal', ring: 'bg' });
        }
        // empty-world hint: tap to add
        if (s.beat === 1 && s.pts.length === 0) g.emoji('👆', [0, 0.4 + 0.15 * Math.sin(s.t * 4)], 34);
        if (s.beat === 0) g.emoji('🍝', [v[2] - 0.6, v[3] - 0.5], 26);
        void C;
      },
    };
  },
};
