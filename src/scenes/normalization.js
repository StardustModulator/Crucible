// Normalization = re-centering every layer's pile of numbers before passing it on.
// Without it each layer's pile wanders and stretches as the weights change;
// batch-norm snaps every pile back to "centered at 0, width 1", then two knobs
// (γ stretch, β shift) let the net choose the width & place it really wants.
// Bonus: on normalized inputs the loss bowl is round, so descent walks straight in.
import { C, alpha } from '../viz/palette.js';
import { solve, symEig, inv, mscale } from '../core/linalg.js';
import { act } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const NL = 5, W = 8, NB = 260;
const LAYC = ['teal', 'blue', 'purple', 'pink', 'orange'];

export default {
  eq: [
    [['μ', 'gold'], ' = mean of the batch,   ', ['σ²', 'purple'], ' = variance of the batch          (per neuron)'],
    [['ẑ', 'blue'], ' = (z − ', ['μ', 'gold'], ') / √(', ['σ²', 'purple'], ' + ε)      → mean 0, width 1'],
    [['y', 'blue'], ' = ', ['γ', 'purple'], ' ẑ + ', ['β', 'orange'], '        (learned stretch & shift)'],
    ['round bowl:  loss Hessian ∝ E[x xᵀ] ≈ I  after normalizing  →  steps of ', ['η', 'coral'], ' head straight to the ', ['⭐', 'gold']],
  ],
  setup({ stage, ui }) {
    const [Lp, Rp] = stage.split([[-6.4, -0.4, 6.2, 5.6], [-4.4, -0.5, 4.4, 4.6]], [1.25, 1]);
    const r = rng(17);
    const s = { beat: 0, bn: false, gamma: 1, beta: 0, t: 0, trail: [], gd: null };
    // a batch and a 5-layer net whose weights keep drifting (as if it were training)
    const X = Array.from({ length: NB }, () => Array.from({ length: W }, () => r.normal()));
    const scales = [1.9, 0.6, 2.2, 0.9, 2.6], shifts = [0.8, -1.2, 1.6, -0.6, 2.0];
    const W0 = scales.map((sc) => Array.from({ length: W }, () => Array.from({ length: W }, () => r.normal(0, sc / Math.sqrt(W)))));
    const b0 = shifts.map((m) => Array.from({ length: W }, () => m + r.normal(0, 0.3)));
    const Wt = W0.map((M) => M.map((row) => row.slice())), bt = b0.map((v) => v.slice());

    const forward = () => {
      // returns, per layer, the pre-activation values of neuron 0 (raw) and after BN (if on)
      let h = X;
      const out = [];
      for (let l = 0; l < NL; l++) {
        const Z = h.map((x) => Wt[l].map((row, i) => row.reduce((acc, w, j) => acc + w * x[j], bt[l][i])));
        let Y = Z;
        if (s.bn) {
          const mu = new Array(W).fill(0), va = new Array(W).fill(0);
          Z.forEach((z) => z.forEach((v, i) => (mu[i] += v / NB)));
          Z.forEach((z) => z.forEach((v, i) => (va[i] += (v - mu[i]) ** 2 / NB)));
          Y = Z.map((z) => z.map((v, i) => s.gamma * (v - mu[i]) / Math.sqrt(va[i] + 1e-5) + s.beta));
        }
        out.push({ raw: Z.map((z) => z[0]), y: Y.map((z) => z[0]) });
        h = Y.map((z) => z.map(act.relu.f));
      }
      return out;
    };
    const stats = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return [m, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length)]; };

    ui.beats(['📊', '⚖️', '🎚️', '🏃'], (b) => {
      s.beat = b; s.trail = [];
      bnT.set(b >= 1 && b <= 2, false); s.bn = b >= 1 && b <= 2;
      if (b !== 2) { s.gamma = 1; s.beta = 0; gS.set(1); bS.set(0); }
      if (b === 2) { s.gamma = 1.8; s.beta = 1.2; gS.set(1.8); bS.set(1.2); }
      if (b === 3) startGD();
    });
    const bnT = ui.toggle({ icon: '⚖️', color: 'gold', title: 'batch-norm on / off', onChange: (v) => { s.bn = v; s.trail = []; } });
    const gS = ui.slider({ icon: 'γ', color: 'purple', min: 0.2, max: 3, value: 1, title: 'γ (stretch)', onInput: (v) => (s.gamma = v) });
    const bS = ui.slider({ icon: 'β', color: 'orange', min: -3, max: 3, value: 0, title: 'β (shift)', onInput: (v) => (s.beta = v) });
    ui.readout(() => (s.beat === 3 && s.gd ? `${s.gd[0].steps}` : fmt(s.spread ?? 0, 1)), { icon: '↔️', color: 'purple', title: 'how different the layers are' });

    // ---- 🏃: linear regression on raw vs normalized features ----
    function startGD() {
      const rr = rng(5), N = 200;
      const raw = Array.from({ length: N }, () => [3 + 0.45 * rr.normal(), 0.4 * rr.normal()]);
      const y = raw.map((x) => 0.5 * x[0] + 1.2 * x[1] + 0.1 * rr.normal());
      const m = [0, 1].map((k) => raw.reduce((a, x) => a + x[k], 0) / N);
      const sd = [0, 1].map((k) => Math.sqrt(raw.reduce((a, x) => a + (x[k] - m[k]) ** 2, 0) / N));
      const ym = y.reduce((a, b) => a + b, 0) / N;
      const nrm = raw.map((x) => [(x[0] - m[0]) / sd[0], (x[1] - m[1]) / sd[1]]);
      const make = (F, Y, u0) => {
        const A = [[0, 0], [0, 0]], b = [0, 0];
        F.forEach((x, i) => { for (let a = 0; a < 2; a++) { b[a] += x[a] * Y[i] / N; for (let c = 0; c < 2; c++) A[a][c] += x[a] * x[c] / N; } });
        const wstar = solve(A, b), lmax = Math.max(...symEig(A).values);
        const w = [wstar[0] + u0[0], wstar[1] + u0[1]];
        return { A, b, wstar, eta: 0.9 / lmax, w, path: [u0.slice()], steps: 0, L0: null };
      };
      s.gd = [make(raw, y, [-0.35, 2.6]), make(nrm, y.map((v) => v - ym), [-2.3, 2.0])];
      s.gdClock = 0;
    }
    const lossU = (P, u) => u[0] * (P.A[0][0] * u[0] + P.A[0][1] * u[1]) + u[1] * (P.A[1][0] * u[0] + P.A[1][1] * u[1]);
    const gdStep = (P) => {
      const g = [0, 1].map((a) => 2 * (P.A[a][0] * P.w[0] + P.A[a][1] * P.w[1] - P.b[a]));
      P.w = [P.w[0] - P.eta * g[0], P.w[1] - P.eta * g[1]];
      P.path.push([P.w[0] - P.wstar[0], P.w[1] - P.wstar[1]]);
      if (P.path.length > 400) P.path.shift();
      P.steps++;
    };

    return {
      update(dt) {
        dt = Math.max(0, dt);                 // the shell can hand a tiny negative dt right after ⏭
        s.t += dt;
        // weights drift (random walk pulled back toward where they started)
        const k = Math.sqrt(dt) * 0.35;
        for (let l = 0; l < NL; l++) {
          for (let i = 0; i < W; i++) {
            for (let j = 0; j < W; j++) Wt[l][i][j] += dt * 0.25 * (W0[l][i][j] - Wt[l][i][j]) + k * r.normal() / Math.sqrt(W);
            bt[l][i] += dt * 0.25 * (b0[l][i] - bt[l][i]) + k * r.normal();
          }
        }
        if (s.beat === 3 && s.gd) {
          s.gdClock += dt;
          while (s.gdClock > 0.12) {
            s.gdClock -= 0.12;
            if (s.gd[0].steps >= 150) { startGD(); break; }
            s.gd.forEach(gdStep);
          }
        }
      },
      draw() {
        if (s.beat === 3) { drawBowl(Lp, s.gd[0], '🐌'); drawBowl(Rp, s.gd[1], '🚀'); return; }
        Lp.setBounds([-6.4, -0.4, 6.2, 5.6]); Rp.setBounds([-4.4, -0.5, 4.4, 4.6]);
        const F = forward();
        drawHists(F);
        drawStats(F);
      },
    };

    function hist(v, lo, hi, nb) {
      const h = new Array(nb).fill(0);
      v.forEach((x) => { const k = Math.floor((x - lo) / (hi - lo) * nb); if (k >= 0 && k < nb) h[k]++; });
      return h;
    }

    function drawHists(F) {
      const g = Lp, lo = -6, hi = 6, nb = 48, bw = (hi - lo) / nb;
      g.line([0, -0.2], [0, 5.4], { color: alpha('gold', 0.55), width: 1.5, dash: [4, 4] });
      F.forEach((L, l) => {
        const y0 = 4.2 - l * 1.05, c = LAYC[l];
        g.line([lo, y0], [hi, y0], { color: 'grid', width: 1 });
        if (s.bn) {
          const hr = hist(L.raw, lo, hi, nb), m = Math.max(...hr);
          hr.forEach((n, k) => { if (n) g.rect(lo + k * bw, y0, bw, 0.85 * n / m, { color: alpha(c, 0.35), width: 1 }); });
        }
        const v = s.bn ? L.y : L.raw, h = hist(v, lo, hi, nb), m = Math.max(...h);
        h.forEach((n, k) => { if (n) g.rect(lo + k * bw + 0.01, y0, bw - 0.02, 0.85 * n / m, { fill: alpha(c, 0.8), stroke: false }); });
        const [mu, sd] = stats(v);
        g.line([clamp(mu, lo, hi), y0 - 0.12], [clamp(mu, lo, hi), y0 + 0.92], { color: 'gold', width: 3 });
        g.line([clamp(mu - sd, lo, hi), y0 + 0.45], [clamp(mu + sd, lo, hi), y0 + 0.45], { color: 'purple', width: 2.5 });
        g.dot([lo - 0.3, y0 + 0.4], 10, { color: c });
        g.text(`${l + 1}`, [lo - 0.3, y0 + 0.4], { color: 'white', size: 12, weight: 800, halo: false });
      });
    }

    function drawStats(F) {
      const g = Rp;
      // axes: mean → right, width ↑
      g.line([-4, 0], [4, 0], { color: 'muted', width: 1.5 });
      g.line([0, 0], [0, 4.3], { color: 'muted', width: 1.5 });
      g.text('μ', [4.15, 0.25], { color: 'gold', size: 16, weight: 800 });
      g.text('σ', [0.3, 4.35], { color: 'purple', size: 16, weight: 800 });
      for (let k = 1; k <= 4; k++) g.line([-0.08, k], [0.08, k], { color: 'muted', width: 1.5 });
      const target = s.bn ? [s.beta, s.gamma] : [0, 1];
      g.emoji('⭐', target, 24);
      const pts = F.map((L) => { const [m, sd] = stats(s.bn ? L.y : L.raw); return [clamp(m, -4, 4), clamp(sd, 0, 4.3)]; });
      s.trail.push(pts); if (s.trail.length > 90) s.trail.shift();
      for (let l = 0; l < NL; l++) g.path(s.trail.map((P) => P[l]), { color: alpha(LAYC[l], 0.35), width: 2 });
      pts.forEach((p, l) => { g.dot(p, 11, { color: LAYC[l], ring: 'bg' }); g.text(`${l + 1}`, p, { color: 'white', size: 12, weight: 800, halo: false }); });
      g.circle(target, g.world(17), { color: 'gold', width: 3 });
      s.spread = pts.reduce((a, p) => a + Math.hypot(p[0] - target[0], p[1] - target[1]), 0) / NL;
    }

    function drawBowl(g, P, icon) {
      g.setBounds([-3.1, -3.1, 3.1, 3.1]);
      const L0 = lossU(P, P.path[0]);
      const Ainv = inv(P.A);
      for (let k = 1; k <= 7; k++) {
        const c = L0 * (k / 6) ** 2;
        g.clip(() => g.cov([0, 0], mscale(Ainv, c), 1, { color: alpha('coral', 0.2 + 0.06 * k), width: 1.5 }));
      }
      g.emoji('⭐', [0, 0], 22);
      g.clip(() => g.path(P.path, { color: 'blue', width: 2.5 }));
      P.path.forEach((p) => g.dot(p, 2.5, { color: 'blue' }));
      const last = P.path[P.path.length - 1];
      g.dot(last, 9, { color: 'blue', ring: 'bg', ringWidth: 2.5 });
      g.emoji(icon, [2.5, 2.6], 26);
      const Lc = lossU(P, last);
      g.text(`L ${fmt(Lc / (L0 || 1), 3)}`, [-2.3, -2.75], { color: 'coral', size: 14, weight: 800 });
      void C;
    }
  },
};
