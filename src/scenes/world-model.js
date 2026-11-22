// A world model lets the robot DAYDREAM: "if I steer like this, where do I end up?"
// It dreams many futures (purple), keeps the best few (lime), dreams again
// around those, then takes ONE real step and dreams again (MPC + CEM).
// If its dream-physics is wrong, dreams and reality drift apart (coral gap).
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { cemStep } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';

const HZ = 14;                    // planning horizon (steps)
const ROCK = [0, 0.25], RR = 0.75;
const RIVER = 1.3;                // |x| < RIVER has a downstream current
const START = [-3.1, -1.6];

// one step of the rover: velocity has drag, action pushes, river pushes down
function step(st, a, riverK) {
  const ax = clamp(a[0], -1, 1), ay = clamp(a[1], -1, 1);
  const cur = Math.abs(st[0]) < RIVER ? -1.5 * riverK * Math.cos((st[0] / RIVER) * Math.PI / 2) : 0;
  const vx = 0.75 * st[2] + 0.3 * ax, vy = 0.75 * st[3] + 0.3 * ay + 0.2 * cur;
  return [st[0] + 0.4 * vx, st[1] + 0.4 * vy, vx, vy];
}
function rollout(st, acts, riverK) {
  const out = [st];
  for (let k = 0; k < HZ; k++) { st = step(st, [acts[2 * k], acts[2 * k + 1]], riverK); out.push(st); }
  return out;
}

export default {
  eq: [
    [['ŝₖ₊₁', 'blue'], ' = ', ['f̂(sₖ, aₖ)', 'blue'], '  ·  (learned dynamics: imagination)'],
    [['a*', 'lime'], ' = argmin Σₖ ‖', ['ŝₖ', 'blue'], ' − ', ['g', 'gold'], '‖ + λ‖aₖ‖²  ·  over ', ['a ~ 𝒩(μ, σ²)', 'purple']],
    ['CEM: keep ', ['elites', 'lime'], ' → μ, σ ← mean, std(', ['elites', 'lime'], ')'],
    ['MPC: do a₀ only, observe ', ['s₁', 'teal'], ', plan again', '  ·  ', ['gap', 'coral'], ' = ‖f(s,a) − f̂(s,a)‖'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-4, -3, 4, 3]);
    const R = rng(12);
    const s = {
      beat: 0, t: 0, goal: [3.0, 2.0], st: [...START, 0, 0], err: 0, trail: [START.slice()],
      mu: new Array(2 * HZ).fill(0), sig: new Array(2 * HZ).fill(0.8), last: null, it: 0, clock: 0, win: 0,
    };
    const modelK = () => 1 - s.err;   // the model's belief about the river
    const cost = (acts) => {
      const tr = rollout(s.st, acts, modelK());
      let c = 0;
      tr.forEach((p, k) => {
        if (!k) return;
        c += (0.4 + k / HZ) * Math.hypot(p[0] - s.goal[0], p[1] - s.goal[1]);
        const d = Math.hypot(p[0] - ROCK[0], p[1] - ROCK[1]);
        if (d < RR + 0.2) c += 6 * (RR + 0.2 - d) + 3;
        if (Math.abs(p[0]) > 3.9 || Math.abs(p[1]) > 2.9) c += 5;
      });
      for (let k = 0; k < HZ; k++) c += 0.05 * (acts[2 * k] ** 2 + acts[2 * k + 1] ** 2);
      return c;
    };
    const plan = (iters) => {
      for (let i = 0; i < iters; i++) {
        const r = cemStep(cost, s.mu, s.sig, { n: 48, elite: 6, rand: R });
        s.mu = r.mu; s.sig = r.sigma.map((x) => Math.max(x, 0.04)); s.last = r;
      }
    };
    const resetAgent = () => { s.st = [...START, 0, 0]; s.trail = [START.slice()]; s.mu.fill(0); s.sig.fill(0.8); s.win = 0; s.it = 0; s.last = null; };

    stage.handle({ pen: g, color: 'gold', r: 13, icon: '🎯', get: () => s.goal, set: (p) => { s.goal = [clamp(p[0], -3.7, 3.7), clamp(p[1], -2.7, 2.7)]; } });
    stage.handle({ pen: g, color: 'orange', r: 11, visible: () => s.beat < 2, get: () => s.st, set: (p) => { s.st = [clamp(p[0], -3.7, 3.7), clamp(p[1], -2.7, 2.7), 0, 0]; s.trail = [s.st.slice(0, 2)]; s.mu.fill(0); s.sig.fill(0.8); s.it = 0; } });

    const errSl = ui.slider({ icon: '😵', color: 'coral', min: 0, max: 1, step: 0.01, value: 0, title: 'model error', onInput: (v) => (s.err = v) });
    ui.beats(['🔮', '🏆', '🔁', '😵'], (b) => {
      s.beat = b; s.t = 0; resetAgent();
      s.err = b === 3 ? 0.85 : 0; errSl.set(s.err);
    });
    ui.button({ icon: '🏠', title: 'back to start', onClick: resetAgent });
    ui.readout(() => fmt(s.sig.reduce((a, b) => a + b, 0) / s.sig.length, 2), { icon: '🌫️', color: 'purple', title: 'plan spread σ' });
    ui.readout(() => fmt(Math.hypot(s.st[0] - s.goal[0], s.st[1] - s.goal[1]), 1), { icon: '🎯', color: 'gold', title: 'distance to goal' });

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt; s.clock += dt;
        if (s.beat === 0) {
          // just dreaming: random futures, no learning, no moving
          if (s.clock > 0.9 || !s.last) { s.clock = 0; s.mu.fill(0); s.sig.fill(0.8); s.last = cemStep(cost, s.mu, s.sig, { n: 48, elite: 6, rand: R }); }
        } else if (s.beat === 1) {
          if (s.clock > 0.75 || !s.last) {
            s.clock = 0;
            if (s.it >= 6) { s.mu.fill(0); s.sig.fill(0.8); s.it = 0; }
            plan(1); s.it++;
          }
        } else {
          // MPC: plan, do the first action in the REAL world, shift, repeat
          if (s.clock > 0.2) {
            s.clock = 0;
            const done = Math.hypot(s.st[0] - s.goal[0], s.st[1] - s.goal[1]) < 0.25;
            if (done) { s.win += 0.2; if (s.win > 1.2) resetAgent(); return; }
            s.sig.fill(0.5); plan(3);
            s.st = step(s.st, [s.mu[0], s.mu[1]], 1);   // reality always has the full river
            s.trail.push(s.st.slice(0, 2)); if (s.trail.length > 400) s.trail.shift();
            s.mu = [...s.mu.slice(2), 0, 0];
          }
        }
      },
      draw() {
        g.grid({ step: 1 });
        // river: the real current, flowing down
        g.rect(-RIVER, -3.2, 2 * RIVER, 6.4, { fill: alpha('blue', 0.07), stroke: false });
        for (let i = -2; i <= 2; i++) for (let j = 0; j < 4; j++) {
          const x = i * 0.5, y = 3 - (((s.t * 0.6 + j * 1.6 + i * 0.37) % 6.4 + 6.4) % 6.4);
          const k = Math.cos((x / RIVER) * Math.PI / 2);
          g.arrow([x, y + 0.25 * k], [x, y - 0.25 * k], { color: alpha('slate', 0.45), width: 2, head: 7 });
        }
        g.circle(ROCK, RR, { fill: alpha('slate', 0.6), color: 'slate', width: 2 });
        g.emoji('🪨', ROCK, 26);
        // dreams
        if (s.last) {
          const elite = new Set(s.last.elite);
          s.last.samples.forEach(({ s: a }) => {
            if (elite.has(a)) return;
            g.path(rollout(s.st, a, modelK()), { color: alpha('purple', s.beat === 2 || s.beat === 3 ? 0.18 : 0.35), width: 1.2 });
          });
          if (s.beat >= 1) s.last.elite.forEach((a) => g.path(rollout(s.st, a, modelK()), { color: alpha('lime', 0.85), width: 2.2 }));
        }
        // the plan the robot believes (blue), and — with a bad model — what would REALLY happen
        if (s.beat >= 1) {
          const dream = rollout(s.st, s.mu, modelK());
          g.path(dream, { color: 'blue', width: 3.5, dash: [7, 5] });
          dream.forEach((p, k) => k && g.dot(p, 3.2, { color: 'blue' }));
          if (s.beat === 3) {
            const real = rollout(s.st, s.mu, 1);
            real.forEach((p, k) => k && g.line(p, dream[k], { color: alpha('coral', 0.85), width: 2.5 }));
            g.path(real, { color: 'teal', width: 2.5, dash: [3, 4] });
            real.forEach((p, k) => k && g.dot(p, 3, { color: 'teal' }));
          }
        }
        // what really happened
        if (s.trail.length > 1) g.path(s.trail, { color: 'teal', width: 3.5 });
        g.emoji('🎯', s.goal, 28);
        g.circle(s.st, 0.24, { fill: alpha('orange', 0.9), stroke: false });
        g.emoji(s.beat === 3 && s.err > 0.4 ? '😵' : s.beat === 0 ? '💭' : '🤖', [s.st[0], s.st[1] + 0.42], 22);
        if (s.win > 0) g.emoji('🎉', [s.goal[0], s.goal[1] + 0.55], 26);
        // CEM iteration counter as little dots
        if (s.beat === 1) for (let i = 0; i < 6; i++) g.dot([g.view[0] + 0.4 + i * 0.32, g.view[3] - 0.35], 6, { color: i < s.it ? 'lime' : alpha('muted', 0.3) });
        void C;
      },
    };
  },
};
