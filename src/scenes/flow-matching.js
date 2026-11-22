// Flow matching: pair every fuzzy purple dot with a teal heart dot and draw
// a straight string between them. The wind that blows along all strings
// (averaged where they cross) is the model. Ride the wind → you make hearts.
import { C, alpha, mix } from '../viz/palette.js';
import { flowTarget, linearBetaSchedule, mixtureScore } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';

const M0 = [0, 0.1], S0 = 0.5;          // source blob
const HC = [0, -0.2], HS = 1.9;         // heart
const NP = 170, NF = 110, NDIFF = 70, NTR = 22, BW = 0.3;    // pairs, flowing particles, kernel width
const DS = linearBetaSchedule(60, 1e-4, 0.25);

function heartPoints(n, R) {
  const out = [];
  while (out.length < n) {
    const x = R.uniform(-1.2, 1.2), y = R.uniform(-1.05, 1.3);
    if ((x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0) out.push([HC[0] + HS * x, HC[1] + HS * y]);
  }
  return out;
}

export default {
  eq: [
    [['xₜ', 'ink'], ' = (1 − t) ', ['x₀', 'purple'], ' + t ', ['x₁', 'teal'], '  ·  (a straight string)'],
    [['u', 'gold'], ' = ', ['x₁', 'teal'], ' − ', ['x₀', 'purple'], '  ·  loss = ‖', ['v(xₜ, t)', 'blue'], ' − ', ['u', 'gold'], '‖²'],
    [['v(x, t)', 'blue'], ' = E[ ', ['x₁', 'teal'], ' − ', ['x₀', 'purple'], ' | xₜ = x ] ≈ Σᵢ wᵢ ', ['uᵢ', 'gold'], ' / Σᵢ wᵢ'],
    ['dx/dt = ', ['v(x, t)', 'blue'], '  ·  vs  diffusion: ', ['dx = [f − g² ∇log p] dt + g dW', 'purple']],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-3.4, -2.6, 3.4, 2.9]);
    const R = rng(3);
    const x1 = heartPoints(NP, R);
    const heartLine = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 80) * 2 * Math.PI, x = 16 * Math.sin(a) ** 3, y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
      return [HC[0] + HS * 0.071 * x, HC[1] + HS * (0.071 * y + 0.27)];
    });
    const x0 = Array.from({ length: NP }, () => [R.normal(M0[0], S0), R.normal(M0[1], S0)]);
    const U = x0.map((a, i) => flowTarget(a, x1[i]));
    const s = { beat: 0, t: 0, tt: 0, dir: 1, hold: 0, probe: [-0.3, 0.6], steps: 24, seed: 9, field: null, fieldT: -1 };

    // the model: kernel-average of the straight-line velocities passing nearby
    function vel(x, t, wOut) {
      let sx = 0, sy = 0, sw = 0;
      for (let i = 0; i < NP; i++) {
        const px = (1 - t) * x0[i][0] + t * x1[i][0], py = (1 - t) * x0[i][1] + t * x1[i][1];
        const w = Math.exp(-((x[0] - px) ** 2 + (x[1] - py) ** 2) / (2 * BW * BW));
        if (wOut) wOut[i] = w;
        sx += w * U[i][0]; sy += w * U[i][1]; sw += w;
      }
      return sw < 1e-12 ? [0, 0] : [sx / sw, sy / sw];
    }
    // fresh particles: flow (ODE, Euler) and diffusion (DDPM reverse) from the SAME noise
    const tgtY = x1.map((p) => [(p[0] - M0[0]) / S0, (p[1] - M0[1]) / S0]);
    function launch() {
      const r = rng(s.seed++);
      const start = Array.from({ length: NF }, () => [r.normal(M0[0], S0), r.normal(M0[1], S0)]);
      s.flow = start.map((p) => [p.slice()]);
      s.diff = start.slice(0, NDIFF).map((p) => [p.slice()]);
      s.dy = start.slice(0, NDIFF).map((p) => [(p[0] - M0[0]) / S0, (p[1] - M0[1]) / S0]);
      s.dk = DS.T; s.fk = 0; s.tt = 0; s.done = 0; s.dr = r;
    }
    launch();

    stage.handle({ pen: g, color: 'blue', kind: 'ring', r: 10, visible: () => s.beat === 1, get: () => s.probe, set: (p) => { s.probe = [clamp(p[0], -4, 4), clamp(p[1], -2.2, 2.2)]; } });

    ui.beats(['🧵', '🌬️', '▶️', '🌫️'], (b) => { s.beat = b; s.hold = 0; s.tt = 0; s.dir = 1; launch(); });
    const tSl = ui.slider({ icon: '⏱️', color: 'orange', min: 0, max: 1, step: 0.01, value: 0, title: 'time t', onInput: (v) => { s.tt = v; s.hold = 3; } });
    ui.slider({ icon: '🪜', color: 'blue', min: 1, max: 30, step: 1, value: s.steps, title: 'ODE steps', onInput: (v) => { s.steps = v; launch(); } });
    ui.button({ icon: '🎲', title: 'new dots', onClick: () => launch() });
    ui.readout(() => (s.beat >= 2 ? s.steps : '·'), { icon: '🪜', color: 'blue', title: 'flow steps' });

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt;
        s.hold = Math.max(0, s.hold - dt);
        if (s.beat < 2) {
          if (s.hold === 0) {
            s.tt += s.dir * dt * 0.35;
            if (s.tt > 1.25) s.dir = -1; if (s.tt < -0.25) s.dir = 1;
            tSl.set(clamp(s.tt, 0, 1));
          }
          return;
        }
        // integrate: t runs 0 → 1 in ~2.6 s
        if (s.tt < 1) {
          s.tt = Math.min(1, s.tt + dt / 2.6);
          tSl.set(s.tt);
          // flow: Euler steps of size 1/steps
          while (s.fk < s.steps && s.fk / s.steps < s.tt) {
            const t = s.fk / s.steps, h = 1 / s.steps;
            s.flow.forEach((tr) => { const p = tr[tr.length - 1], v = vel(p, t); tr.push([p[0] + h * v[0], p[1] + h * v[1]]); });
            s.fk++;
          }
          // diffusion: DDPM reverse steps with the exact score of the (noised) heart
          if (s.beat === 3) while (s.dk > 0 && 1 - s.dk / DS.T < s.tt) {
            const k = s.dk - 1, b = DS.beta[k];
            s.dy = s.dy.map((y, i) => {
              const sc = mixtureScore(y, tgtY, 0.08, DS.alphaBar[k]);
              const ny = [0, 1].map((d) => (y[d] + b * sc[d]) / Math.sqrt(1 - b) + (k > 0 ? Math.sqrt(b) * s.dr.normal() : 0));
              s.diff[i].push([M0[0] + S0 * ny[0], M0[1] + S0 * ny[1]]);
              return ny;
            });
            s.dk--;
          }
        } else {
          s.done += dt;
          if (s.done > 1.6) launch();
        }
      },
      draw() {
        g.grid({ step: 1 });
        const t = clamp(s.tt, 0, 1);
        // source and target, always faintly visible
        g.blob(M0, S0, { color: 'purple', alpha: 0.35 });
        g.path(heartLine, { color: alpha('teal', 0.6), width: 2, dash: [5, 5], close: true });
        x1.forEach((p) => g.dot(p, 2.6, { color: alpha('teal', s.beat >= 2 ? 0.4 : 0.6) }));
        if (s.beat < 2) {
          // straight strings and the dots riding them
          x0.forEach((a, i) => g.line(a, x1[i], { color: alpha('muted', s.beat === 0 ? 0.22 : 0.1), width: 1 }));
          if (s.beat === 1) {
            if (Math.abs(s.fieldT - t) > 0.004) {
              const v = g.view, f = [];
              const nx = stage.portrait ? 9 : 17, ny = stage.portrait ? 13 : 9;
              for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
                const p = [v[0] + ((i + 0.5) * (v[2] - v[0])) / nx, v[1] + ((j + 0.5) * (v[3] - v[1])) / ny];
                f.push([p, vel(p, t)]);
              }
              s.field = f; s.fieldT = t;
            }
            for (const [p, v] of s.field) {
              const L = Math.hypot(...v), m = Math.min(0.42, L * 0.1) / (L || 1);
              g.vec(p, [v[0] * m, v[1] * m], { color: alpha('blue', 0.65), width: 2, head: 7 });
            }
          }
          x0.forEach((a, i) => {
            const p = [(1 - t) * a[0] + t * x1[i][0], (1 - t) * a[1] + t * x1[i][1]];
            g.dot(p, 4, { color: mix('purple', 'teal', t) });
          });
          if (s.beat === 1) {
            // the probe: many strings pass nearby, their arrows get averaged
            const w = new Array(NP), v = vel(s.probe, t, w);
            const ws = w.reduce((a, b) => a + b, 0) || 1;
            x0.forEach((a, i) => {
              if (w[i] / ws < 0.02) return;
              const p = [(1 - t) * a[0] + t * x1[i][0], (1 - t) * a[1] + t * x1[i][1]];
              g.vec(p, [U[i][0] * 0.18, U[i][1] * 0.18], { color: alpha('gold', 0.25 + 2 * w[i] / ws), width: 1.5, head: 6 });
            });
            g.circle(s.probe, BW * 2, { color: alpha('blue', 0.4), dash: [3, 4], width: 1.5 });
            g.vec(s.probe, [v[0] * 0.3, v[1] * 0.3], { color: 'blue', width: 5 });
          }
        } else {
          // trails: flow = smooth blue strings, diffusion = shaky purple ones
          if (s.beat === 3) s.diff.forEach((tr, i) => { if (i < NTR) g.path(tr, { color: alpha('purple', 0.6), width: 1.4 }); });
          s.flow.forEach((tr, i) => { if (s.beat === 2 || i < NTR) g.path(tr, { color: alpha('blue', s.beat === 2 ? 0.45 : 0.8), width: s.beat === 2 ? 1.4 : 2 }); });
          if (s.beat === 3) s.diff.forEach((tr) => g.dot(tr[tr.length - 1], 3.2, { color: 'purple' }));
          s.flow.forEach((tr, i) => (s.beat === 2 || i < NDIFF) && g.dot(tr[tr.length - 1], 3.6, { color: 'blue', ring: alpha('bg', 0.8), ringWidth: 1 }));
          if (s.tt >= 1) g.emoji(s.beat === 3 ? '🏁' : '💙', [g.view[2] - 0.45, g.view[3] - 0.45], 26);
        }
        // time bar along the bottom
        const v = g.view, y = v[1] + 0.18, xa = v[0] + 0.4, xb = v[2] - 0.4;
        g.line([xa, y], [xb, y], { color: alpha('muted', 0.3), width: 5 });
        g.line([xa, y], [xa + (xb - xa) * t, y], { color: 'orange', width: 5 });
        g.dot([xa + (xb - xa) * t, y], 6, { color: 'orange', ring: 'bg' });
        void C;
      },
    };
  },
};
