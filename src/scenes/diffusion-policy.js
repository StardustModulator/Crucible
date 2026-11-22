// Two good ways around the rock: left or right. Averaging the teacher's
// moves drives straight into the rock 💥. A diffusion policy instead starts
// from a scribble and cleans it up step by step — it commits to ONE way.
import { C, alpha, mix } from '../viz/palette.js';
import { linearBetaSchedule, softmax } from '../core/learning.js';
import { rng, clamp, lerp } from '../core/random.js';

const H = 12;                 // interior waypoints of an action path (24 numbers)
const SC = 1.1;               // world units per normalized unit (paths are stored as wiggles off the straight line)
const START = [0, -2.6], GOAL = [0, 2.6];
const SIG0 = 0.04;            // width of each demo "bump" in path space
const SCH = linearBetaSchedule(40, 1e-4, 0.2);

// Exact score of the noised demo mixture in path space (the thing a diffusion net learns).
// (core mixtureScore is 2-D only; this is the same formula in D dimensions.)
function scoreND(x, centers, abar) {
  const s2 = abar * SIG0 * SIG0 + (1 - abar), ra = Math.sqrt(abar);
  const logw = centers.map((c) => { let d = 0; for (let i = 0; i < x.length; i++) d += (x[i] - ra * c[i]) ** 2; return -d / (2 * s2); });
  const w = softmax(logw);
  return x.map((xi, i) => w.reduce((acc, wk, k) => acc + (wk * (ra * centers[k][i] - xi)) / s2, 0));
}
const toPts = (v) => [START, ...Array.from({ length: H }, (_, i) => {
  const u = (i + 1) / (H + 1);
  return [lerp(START[0], GOAL[0], u) + v[2 * i] * SC, lerp(START[1], GOAL[1], u) + v[2 * i + 1] * SC];
}), GOAL];

export default {
  eq: [
    [['â', 'blue'], ' = argmin Σᵢ ‖a − ', ['aᵢ', 'teal'], '‖²  =  mean(', ['aᵢ', 'teal'], ')  → ', ['💥', 'coral']],
    [['xₜ₋₁', 'blue'], ' = (xₜ + βₜ ', ['∇log pₜ(xₜ)', 'blue'], ') / √(1−βₜ) + √βₜ ', ['z', 'purple']],
    [['∇log pₜ(x)', 'blue'], ' = Σᵢ wᵢ (√ᾱₜ ', ['aᵢ', 'teal'], ' − x) / σₜ²  ·  wᵢ = softmax(−‖x − √ᾱₜ aᵢ‖² / 2σₜ²)'],
    [['x_T', 'purple'], ' ~ 𝒩(0, I)  →  ', ['x₀', 'blue'], ' = one clean mode'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-3.2, -3.3, 3.2, 3.3]);
    const s = { beat: 0, t: 0, obs: [0, 0.1], r: 0.85, k: SCH.T, hold: 0, seed: 1, tally: [0, 0], drive: 0, wait: 0 };
    const dR = rng(4);
    const dv = Array.from({ length: 12 }, (_, i) => ({ side: i % 2 ? 1 : -1, c: dR.uniform(0.35, 0.75), w: dR.uniform(0.22, 0.32), sh: dR.normal(0, 0.05) }));

    function makeDemos() {
      const so = clamp((s.obs[1] - START[1]) / (GOAL[1] - START[1]), 0.25, 0.75);
      s.demos = dv.map((d) => {
        const v = [];
        const target = s.obs[0] + d.side * (s.r + d.c);  // pass beside the rock
        for (let i = 1; i <= H; i++) {
          const u = i / (H + 1);
          const bump = Math.exp(-(((u - so - d.sh) / d.w) ** 2)) * Math.sin(Math.PI * u) / Math.sin(Math.PI * so);
          v.push(((target - lerp(START[0], GOAL[0], so)) * bump) / SC, 0);
        }
        return v;
      });
      s.mean = s.demos[0].map((_, i) => s.demos.reduce((a, d) => a + d[i], 0) / s.demos.length);
    }
    // one full reverse chain x_T → x_0
    function sampleChain(seed) {
      const R = rng(seed);
      let x = Array.from({ length: 2 * H }, () => R.normal());
      const chain = new Array(SCH.T + 1);
      chain[SCH.T] = { x: x.slice(), sc: x.map(() => 0) };
      for (let t = SCH.T - 1; t >= 0; t--) {
        const b = SCH.beta[t], sc = scoreND(x, s.demos, SCH.alphaBar[t]);
        chain[t + 1].sc = sc.map((v) => v * b);
        x = x.map((xi, i) => (xi + b * sc[i]) / Math.sqrt(1 - b) + (t > 0 ? Math.sqrt(b) * R.normal() : 0));
        chain[t] = { x: x.slice(), sc: x.map(() => 0) };
      }
      return chain;
    }
    const sideOf = (v) => { const p = toPts(v); let best = p[0]; p.forEach((q) => { if (Math.abs(q[1] - s.obs[1]) < Math.abs(best[1] - s.obs[1])) best = q; }); return best[0] < s.obs[0] ? 0 : 1; };
    const crash = (pts) => {
      for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 6; k++) {
        const p = [lerp(pts[i - 1][0], pts[i][0], k / 6), lerp(pts[i - 1][1], pts[i][1], k / 6)];
        if (Math.hypot(p[0] - s.obs[0], p[1] - s.obs[1]) < s.r) return { at: p, seg: i - 1 + k / 6 };
      }
      return null;
    };
    const resample = () => {
      const n = s.beat === 3 ? 6 : 1;
      s.chains = Array.from({ length: n }, (_, i) => sampleChain(s.seed * 17 + i));
      s.seed++; s.k = SCH.T; s.counted = false; s.drive = 0;
    };
    makeDemos(); resample();

    stage.handle({ pen: g, color: 'slate', r: 12, icon: '🪨', get: () => s.obs, set: (p) => { s.obs = [clamp(p[0], -1.2, 1.2), clamp(p[1], -1.2, 1.4)]; makeDemos(); if (s.beat >= 2) resample(); } });

    ui.beats(['🎭', '💥', '🌪️', '🎲'], (b) => { s.beat = b; s.t = 0; s.drive = 0; s.tally = [0, 0]; resample(); });
    const tSl = ui.slider({ icon: '🌪️', color: 'purple', min: 0, max: SCH.T, step: 1, value: SCH.T, title: 'noise step t', onInput: (v) => { s.k = v; s.hold = 2.5; } });
    ui.button({ icon: '🎲', title: 'sample again', onClick: () => resample() });
    ui.readout(() => `${s.tally[0]} · ${s.tally[1]}`, { icon: '👈👉', color: 'blue', title: 'left vs right samples' });

    const drawPath = (pts, o) => g.path(pts, { width: 3, ...o });
    const robotOn = (pts, u) => { // position along a polyline, u in [0,1]
      const f = clamp(u, 0, 1) * (pts.length - 1), i = Math.min(Math.floor(f), pts.length - 2), r = f - i;
      return [lerp(pts[i][0], pts[i + 1][0], r), lerp(pts[i][1], pts[i + 1][1], r)];
    };

    return {
      update(dt) {
        dt = Math.max(0, dt); // first frame can report a negative dt
        s.t += dt;
        s.hold = Math.max(0, s.hold - dt);
        if (s.beat >= 2 && s.hold === 0) {
          if (s.k > 0) { s.acc = (s.acc ?? 0) + dt * 14; while (s.acc >= 1 && s.k > 0) { s.k--; s.acc--; } }
          else {
            if (!s.counted) { s.chains.forEach((c) => s.tally[sideOf(c[0].x)]++); s.counted = true; }
            s.drive += dt * 0.45;
            if (s.drive > 1.5) resample();
          }
          tSl.set(s.k);
        }
        if (s.beat < 2) s.drive = (s.drive + dt * 0.35) % 1.4;
      },
      draw() {
        g.grid({ step: 1 });
        // the rock and the goal
        g.circle(s.obs, s.r, { fill: alpha('slate', 0.55), color: 'slate', width: 2 });
        g.emoji('🎯', GOAL, 30);
        const demoPts = s.demos.map(toPts);
        const faint = s.beat >= 2;
        demoPts.forEach((p) => drawPath(p, { color: alpha('teal', faint ? 0.22 : 0.7), width: faint ? 1.5 : 2.2 }));

        if (s.beat === 0) {
          const which = Math.floor(s.t / 1.4) % demoPts.length, p = demoPts[which];
          drawPath(p, { color: 'teal', width: 4.5 });
          g.emoji('🤖', robotOn(p, s.drive), 30);
          g.emoji(dv[which].side < 0 ? '👈' : '👉', [dv[which].side * 2.5, s.obs[1]], 30);
        } else if (s.beat === 1) {
          const p = toPts(s.mean), hit = crash(p);
          drawPath(p, { color: 'blue', width: 5 });
          const u = Math.min(s.drive, hit ? hit.seg / (p.length - 1) : 1);
          const pos = robotOn(p, u);
          if (hit && s.drive >= hit.seg / (p.length - 1)) {
            g.blob(hit.at, 0.35, { color: 'coral', alpha: 0.8 });
            g.emoji('💥', hit.at, 44);
          } else g.emoji('🤖', pos, 30);
          // the average of a left and a right
          g.emoji('👈', [-2.5, s.obs[1]], 26); g.text('+', [-1.9, s.obs[1]], { size: 26, color: 'muted' });
          g.emoji('👉', [2.5, s.obs[1]], 26); g.text('÷2', [1.85, s.obs[1]], { size: 20, color: 'muted' });
        } else {
          const k = s.k, prog = 1 - k / SCH.T;
          const colr = mix('purple', 'blue', prog ** 3);
          s.chains.forEach((ch, ci) => {
            const v = ch[k].x, p = toPts(v);
            const done = k === 0, hit = done && crash(p);
            drawPath(p, { color: done ? (hit ? 'coral' : 'blue') : colr, width: s.beat === 3 ? 2.4 : 3.5, alpha: s.beat === 3 && !done ? 0.6 : 0.95 });
            p.slice(1, -1).forEach((q, i) => {
              g.dot(q, s.beat === 3 ? 3 : 5, { color: colr });
              if (s.beat === 2 && k > 0) {
                const sc = ch[k].sc; const len = Math.hypot(sc[2 * i], sc[2 * i + 1]) * SC;
                const m = Math.min(1, 0.9 / (len + 1e-9));
                g.vec(q, [sc[2 * i] * SC * m, sc[2 * i + 1] * SC * m], { color: alpha('blue', 0.7), width: 2 });
              }
            });
            if (done && ci < (s.beat === 3 ? 6 : 1)) {
              const pos = robotOn(p, Math.min(1, s.drive));
              g.emoji('🤖', pos, s.beat === 3 ? 22 : 30);
              if (s.drive >= 1 && !hit) g.emoji('✅', [GOAL[0] + 0.55, GOAL[1]], 22);
            }
          });
          if (k > 0) g.emoji('🌪️', [-2.6, 2.7], 22 + 10 * (1 - prog));
          // noise thermometer: purple bar shrinking as t → 0
          const v = g.view, x = v[2] - 0.35;
          g.rect(x - 0.12, -2, 0.24, 4, { color: alpha('purple', 0.4), width: 1.5 });
          g.rect(x - 0.12, -2, 0.24, 4 * (k / SCH.T), { fill: alpha('purple', 0.7), stroke: false });
          g.text('t', [x, 2.3], { color: 'purple', size: 16 });
        }
        if (s.beat >= 2 && s.k > 0) g.emoji('🤖', START, 30);
        void C;
      },
    };
  },
};
