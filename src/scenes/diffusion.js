// Diffusion: take a drawing made of dots and sprinkle noise until it is just
// a round fuzzy blob. Then learn the arrows that point "back toward a drawing"
// (the score). Start from fresh fuzz, follow the arrows → a brand-new drawing.
import { C, alpha, mix } from '../viz/palette.js';
import { linearBetaSchedule, forwardNoise, mixtureScore } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';

const SCH = linearBetaSchedule(100, 1e-4, 0.08);
const ND = 200, NP = 200, SIG0 = 0.05;

function makeData(kind, R) {
  const pts = [];
  if (kind === 'smile') {
    const ring = (n, c, r, a0 = 0, a1 = 2 * Math.PI) => { for (let i = 0; i < n; i++) { const a = R.uniform(a0, a1); pts.push([c[0] + r * Math.cos(a) + R.normal(0, 0.03), c[1] + r * Math.sin(a) + R.normal(0, 0.03)]); } };
    ring(100, [0, 0], 1.6);
    for (const c of [[-0.55, 0.55], [0.55, 0.55]]) for (let i = 0; i < 22; i++) pts.push([c[0] + R.normal(0, 0.09), c[1] + R.normal(0, 0.12)]);
    ring(56, [0, 0.05], 0.95, Math.PI * 1.15, Math.PI * 1.85);
  } else {
    for (let i = 0; i < ND; i++) { const u = R.uniform(0.15, 1), a = 3.4 * Math.PI * u; pts.push([1.65 * u * Math.cos(a) + R.normal(0, 0.03), 1.65 * u * Math.sin(a) + R.normal(0, 0.03)]); }
  }
  return pts;
}

export default {
  eq: [
    [['xₜ', 'purple'], ' = √ᾱₜ ', ['x₀', 'teal'], ' + √(1−ᾱₜ) ', ['ε', 'purple'], '  ·  ᾱₜ = Πₛ(1 − βₛ)'],
    [['s(x, t)', 'blue'], ' = ∇ₓ log pₜ(x) = Σᵢ wᵢ (√ᾱₜ ', ['xᵢ', 'teal'], ' − x) / σₜ²'],
    [['xₜ₋₁', 'blue'], ' = (xₜ + βₜ ', ['s(xₜ, t)', 'blue'], ') / √(1−βₜ) + √βₜ ', ['z', 'purple']],
    ['a network learns ', ['s', 'blue'], ' by guessing the ', ['ε', 'purple'], ' that was added:  ‖ε − ε_θ(xₜ, t)‖²'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-3, -2.7, 3, 2.7]);
    const R = rng(8);
    const s = { beat: 0, t: 0, k: 0, dir: 1, hold: 0, kind: 'smile', probe: [2.2, 1.8], gen: [], seed: 20 };
    s.probeTrail = [s.probe];
    const eps = Array.from({ length: ND }, () => [R.normal(), R.normal()]);
    const setData = () => { s.data = makeData(s.kind, rng(s.kind === 'smile' ? 2 : 3)); s.field = null; s.gen = []; launch(); };
    function launch() {
      const r = rng(s.seed++);
      s.parts = Array.from({ length: NP }, () => { const p = [r.normal(), r.normal()]; return { p, trail: [p] }; });
      s.rk = SCH.T; s.rr = r; s.rest = 0;
    }
    const abarAt = (k) => (k <= 0 ? 1 : SCH.alphaBar[k - 1]);
    setData();

    stage.handle({ pen: g, color: 'blue', kind: 'ring', r: 10, visible: () => s.beat === 1, get: () => s.probe, set: (p) => { s.probe = [clamp(p[0], -2.9, 2.9), clamp(p[1], -2.6, 2.6)]; s.probeTrail = [s.probe]; } });

    ui.beats(['🌫️', '🧭', '⏪', '🎲'], (b) => { s.beat = b; s.hold = 0; s.gen = []; launch(); if (b === 1) { s.k = 35; tSl.set(35); } });
    const tSl = ui.slider({ icon: '🌫️', color: 'purple', min: 0, max: SCH.T, step: 1, value: 0, title: 'noise step t', onInput: (v) => { s.k = v; s.hold = 3; } });
    ui.choice({ value: 'smile', color: 'teal', options: [{ icon: '🙂', value: 'smile', title: 'smiley' }, { icon: '🌀', value: 'spiral', title: 'spiral' }], onChange: (v) => { s.kind = v; setData(); } });
    ui.button({ icon: '🎲', title: 'new noise', onClick: () => launch() });
    ui.readout(() => (s.beat >= 2 ? s.rk : s.k), { icon: 't', color: 'purple', title: 'noise step' });

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt;
        s.hold = Math.max(0, s.hold - dt);
        if (s.beat === 0 && s.hold === 0) {
          s.kf = clamp((s.kf ?? 0) + s.dir * dt * 40, -25, SCH.T + 25);
          if (s.kf >= SCH.T + 25) s.dir = -1; if (s.kf <= -25) s.dir = 1;
          s.k = clamp(Math.round(s.kf), 0, SCH.T); tSl.set(s.k);
        }
        if (s.beat === 1 && s.probeTrail) {
          // the probe slides along the arrows (annealed Langevin at the current level)
          const ab = abarAt(s.k), sc = mixtureScore(s.probe, s.data, SIG0, ab), h = 0.02 * (1 - ab + 0.05);
          s.probe = [s.probe[0] + h * sc[0] * 3, s.probe[1] + h * sc[1] * 3];
          s.probeTrail.push(s.probe); if (s.probeTrail.length > 80) s.probeTrail.shift();
        }
        if (s.beat >= 2) {
          if (s.rk > 0) {
            s.acc = (s.acc ?? 0) + dt * (s.beat === 3 ? 70 : 38);
            while (s.acc >= 1 && s.rk > 0) {
              s.acc--;
              const k = s.rk - 1, b = SCH.beta[k], ab = SCH.alphaBar[k];
              for (const q of s.parts) {
                const sc = mixtureScore(q.p, s.data, SIG0, ab);
                q.p = [0, 1].map((d) => (q.p[d] + b * sc[d]) / Math.sqrt(1 - b) + (k > 0 ? Math.sqrt(b) * s.rr.normal() : 0));
                q.trail.push(q.p); if (q.trail.length > 8) q.trail.shift();
              }
              s.rk--;
            }
            tSl.set(s.rk);
          } else {
            s.rest += dt;
            if (s.beat === 3 && s.rest > 0.6) { s.gen.push(...s.parts.map((q) => q.p)); if (s.gen.length > 1200) s.gen.splice(0, NP); launch(); }
            if (s.beat === 2 && s.rest > 1.8) launch();
          }
        }
      },
      draw() {
        g.grid({ step: 1 });
        const k = s.beat >= 2 ? s.rk : s.k, ab = abarAt(k), prog = 1 - k / SCH.T;
        // the noise blob it all dissolves into
        g.blob([0, 0], 1, { color: 'purple', alpha: 0.12 + 0.25 * (1 - prog) });
        g.circle([0, 0], 2, { color: alpha('purple', 0.35), dash: [4, 6], width: 1.5 });
        if (s.beat < 2) {
          s.data.forEach((x0, i) => g.dot(x0, 2, { color: alpha('teal', 0.25) }));
          if (s.beat === 1) {
            if (!s.field || s.fieldK !== k) {
              const v = g.view, f = [], nx = stage.portrait ? 11 : 19, ny = stage.portrait ? 15 : 12;
              for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
                const p = [v[0] + ((i + 0.5) * (v[2] - v[0])) / nx, v[1] + ((j + 0.5) * (v[3] - v[1])) / ny];
                f.push([p, mixtureScore(p, s.data, SIG0, ab)]);
              }
              s.field = f; s.fieldK = k;
            }
            const sig2 = ab * SIG0 * SIG0 + 1 - ab;
            for (const [p, sc] of s.field) {
              const e = [sc[0] * Math.sqrt(sig2), sc[1] * Math.sqrt(sig2)], L = Math.hypot(...e); // ε-scale: bounded length
              const m = Math.min(0.26, L * 0.13) / (L || 1);
              g.vec(p, [e[0] * m, e[1] * m], { color: alpha('blue', 0.4 + 0.4 * Math.min(1, L / 2)), width: 2, head: 6 });
            }
          }
          s.data.forEach((x0, i) => {
            const p = forwardNoise(x0, ab, eps[i]);
            g.dot(p, 3.5, { color: mix('teal', 'purple', Math.sqrt(1 - ab)) });
          });
          if (s.beat === 1 && s.probeTrail) g.path(s.probeTrail, { color: alpha('blue', 0.7), width: 3 });
        } else {
          s.data.forEach((p) => g.dot(p, 2, { color: alpha('teal', s.beat === 3 ? 0.35 : 0.2) }));
          if (s.beat === 3) s.gen.forEach((p) => g.dot(p, 2.2, { color: alpha('blue', 0.45) }));
          const colr = mix('purple', 'blue', prog ** 2);
          for (const q of s.parts) {
            if (s.beat === 2 && s.rk > 0) g.path(q.trail, { color: alpha('blue', 0.22), width: 1 });
            g.dot(q.p, 3.5, { color: colr });
          }
          if (s.rk === 0) g.emoji(s.beat === 3 ? '✨' : '🎨', [g.view[2] - 0.4, g.view[3] - 0.4], 26);
        }
        // the noise dial
        const v = g.view, x = v[0] + 0.3;
        g.rect(x - 0.1, -2, 0.2, 4, { color: alpha('purple', 0.4), width: 1.5 });
        g.rect(x - 0.1, -2, 0.2, 4 * (k / SCH.T), { fill: alpha('purple', 0.7), stroke: false });
        g.emoji(s.beat >= 2 ? '⏪' : s.beat === 0 ? (s.dir > 0 ? '⏩' : '⏪') : '🧭', [x, 2.35], 18);
        void C;
      },
    };
  },
};
