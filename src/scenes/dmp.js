// Dynamic Movement Primitives: draw a squiggle ✍️ and the robot learns it as
// "a spring pulling to the goal 🎯 + a little learned push along the way".
// The push is a sum of bumps ψ (one per moment), each with its own weight.
// Move the goal → the shape stretches to fit. Shove the pen → it recovers.
import { alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { DMP } from '../core/learning.js';
import { clamp } from '../core/random.js';

const NB = 34, NS = 200;

// a hand starts and stops gently: minimum-jerk timing along the stroke
const mj = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
// default demo: a cursive swoosh with two little loops ("ee")
function defaultDemo() {
  const pts = [];
  for (let i = 0; i < NS; i++) {
    const u = mj(i / (NS - 1)), ph = 2 * Math.PI * 2 * u, r = 0.42;
    const bx = 0.45 + 2.9 * u, by = 0.75 + 0.9 * Math.sin(Math.PI * u * 0.75);
    pts.push([bx + r * Math.sin(ph), by + r * (1 - Math.cos(ph))]);
  }
  return pts;
}
// resample a hand-drawn stroke to NS points evenly spaced along its length
function resample(raw) {
  const d = [0];
  for (let i = 1; i < raw.length; i++) d.push(d[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const L = d[d.length - 1], out = [];
  let j = 0;
  for (let i = 0; i < NS; i++) {
    const t = L * mj(i / (NS - 1));
    while (j < d.length - 2 && d[j + 1] < t) j++;
    const f = (t - d[j]) / (d[j + 1] - d[j] || 1);
    out.push([raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f, raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f]);
  }
  return { pts: out, L };
}

// One integration step of τÿ = α(β(g−y) − ẏ) + f(x)(g−y0),  τẋ = −aₓx  (same law as DMP.rollout).
function dmpStep(d, st, g, y0, tau, dt, forcing = true) {
  // (g − y0) scaling makes the shape stretch with the goal; when the demo barely moves
  // in this direction, the scaling would explode, so we just translate instead.
  const span = d.g - d.y0, ratio = Math.abs(span) > 0.4 ? clamp((g - y0) / span, -2, 2) : 1;
  const f = forcing ? d.forcing(st.x) * ratio * (span || 1) : 0; // (span || 1) mirrors DMP.fit
  const vd = (d.alpha * (d.beta * (g - st.y) - st.v) + f) / tau;
  st.v += vd * dt;
  st.y += (st.v / tau) * dt;
  st.x += ((-d.ax * st.x) / tau) * dt;
  return st;
}
function plan(dx, dy, start, goal, forcing = true) {
  const sx = { y: start[0], v: 0, x: 1 }, sy = { y: start[1], v: 0, x: 1 }, out = [start.slice()];
  for (let k = 0; k < 340; k++) { dmpStep(dx, sx, goal[0], start[0], 1, 1 / 260, forcing); dmpStep(dy, sy, goal[1], start[1], 1, 1 / 260, forcing); if (k % 2) out.push([sx.y, sy.y]); }
  return out;
}

export default {
  eq: [
    ['τ ÿ = ', ['α(β(g − y) − ẏ)', 'teal'], ' + ', ['f(x)', 'blue'], '·(', ['g', 'gold'], ' − y₀)        τ ẋ = −aₓ x   (phase clock)'],
    [['f(x)', 'blue'], ' = Σᵢ ', ['wᵢ', 'red'], ' ', ['ψᵢ(x)', 'purple'], ' x / Σᵢ ', ['ψᵢ(x)', 'purple'], '        ', ['ψᵢ', 'purple'], ' = exp(−hᵢ(x − cᵢ)²)'],
    ['learn ', ['wᵢ', 'red'], ' from the ', ['demo', 'teal'], ' by weighted least squares (one per bump)'],
    ['x → 0  ⇒  ', ['f', 'blue'], ' → 0  ⇒  only the ', ['spring', 'teal'], ' is left  ⇒  always ends at ', ['g', 'gold']],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[0, 0, 4, 3.1], [0, 0, 10, 10]], [1.3, 1]);
    const s = {
      beat: 0, demo: defaultDemo(), dx: null, dy: null, goal: null, start: null, path: null, raw: null, drawing: false,
      play: null, tauS: 1, t: 0, pushT: -1, pushV: null, pause: 0, dragTip: null, slow: null, plain: null, pathOrig: null,
    };
    const learn = () => {
      const xs = s.demo.map((p) => p[0]), ys = s.demo.map((p) => p[1]);
      s.dx = new DMP({ nBasis: NB }).fit(xs, 1);
      s.dy = new DMP({ nBasis: NB }).fit(ys, 1);
      s.start = s.demo[0].slice(); s.goal = s.demo[NS - 1].slice();
      s.pathOrig = plan(s.dx, s.dy, s.start, s.goal);
      replan(); restart();
    };
    const replan = () => { s.path = plan(s.dx, s.dy, s.start, s.goal); s.plainPath = plan(s.dx, s.dy, s.start, s.goal, false); };
    const newRun = () => ({ x: { y: s.start[0], v: 0, x: 1 }, y: { y: s.start[1], v: 0, x: 1 }, t: 0, trail: [s.start.slice()] });
    const restart = () => { s.play = newRun(); s.slow = newRun(); s.plain = newRun(); s.pause = 0; s.pushed = false; };
    learn();

    // draw a new demo anywhere on the left
    stage.on('down', (e) => { if (e.pen !== A) return; s.drawing = true; s.raw = [{ p: e.p }]; });
    stage.on('move', (e) => { if (!s.drawing) return; const last = s.raw[s.raw.length - 1].p; if (Math.hypot(e.p[0] - last[0], e.p[1] - last[1]) > 0.01) s.raw.push({ p: e.p }); });
    stage.on('up', () => {
      if (!s.drawing) return;
      s.drawing = false;
      const pts = s.raw.map((r) => r.p);
      if (pts.length > 8) { const r = resample(pts); if (r.L > 0.4) { s.demo = r.pts; learn(); } }
      s.raw = null;
    });
    stage.handle({ pen: A, color: 'gold', r: 12, kind: 'ring', icon: '', get: () => s.goal, set: (p) => { s.goal = [clamp(p[0], 0, 4), clamp(p[1], 0, 3.1)]; replan(); } });
    stage.handle({
      pen: A, color: 'pink', r: 11,
      get: () => (s.dragTip ?? [s.play.x.y, s.play.y.y]),
      set: (p) => (s.dragTip = p),
      onStart: () => (s.dragTip = [s.play.x.y, s.play.y.y]),
      onEnd: () => { s.dragTip = null; },
    });
    ui.slider({ icon: '⏩', title: 'speed (τ)', color: 'orange', min: 0.4, max: 2.5, step: 0.01, value: 1, onInput: (v) => (s.tauS = v) });
    ui.button({ icon: '👋', title: 'push', onClick: () => { s.pushV = [0, 9]; s.pushT = 0.12; } });
    ui.button({ icon: '🔄', title: 'back to the swoosh', onClick: () => { s.demo = defaultDemo(); learn(); } });
    ui.beats(['✍️', '🎯', '👋', '⏩', '🌱'], (i) => {
      s.beat = i;
      s.goal = s.demo[NS - 1].slice();
      if (i === 1) s.goal = [s.goal[0] - 0.45, s.goal[1] + 0.2];
      replan(); restart();
    });
    ui.readout(() => fmt(Math.hypot(s.play.x.y - s.goal[0], s.play.y.y - s.goal[1]), 2), { icon: '🎯', color: 'gold', title: 'distance to goal' });

    const TAU = () => 2.0 / s.tauS;  // seconds for one playback
    const advance = (run, tau, dt, forcing = true) => {
      const H = 0.002, n = Math.min(60, Math.round(dt / H));
      for (let k = 0; k < n; k++) {
        dmpStep(s.dx, run.x, s.goal[0], s.start[0], tau, H, forcing);
        dmpStep(s.dy, run.y, s.goal[1], s.start[1], tau, H, forcing);
      }
      run.t += n * H;
      run.trail.push([run.x.y, run.y.y]); if (run.trail.length > 400) run.trail.shift();
    };

    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        if (!s.play || s.drawing) return;
        const tau = TAU();
        if (s.pause > 0) { s.pause -= dt; if (s.pause <= 0) restart(); return; }
        // push: during the 👋 beat, shove the pen once per playback
        if (s.beat === 2 && !s.pushed && s.play.t > tau * 0.35) { s.pushed = true; s.pushV = [6, -14]; s.pushT = 0.12; }
        if (s.pushT > 0) {
          s.pushT -= dt;
          s.play.x.v += s.pushV[0] * dt * tau * 8; s.play.y.v += s.pushV[1] * dt * tau * 8;
        }
        if (s.dragTip) { s.play.x.y = s.dragTip[0]; s.play.y.y = s.dragTip[1]; s.play.x.v = 0; s.play.y.v = 0; }
        advance(s.play, tau, dt);
        if (s.beat === 3) advance(s.slow, tau * 2, dt);
        if (s.beat === 4) advance(s.plain, tau, dt, false);
        const done = s.play.t > tau * 1.35 && (s.beat !== 3 || s.slow.t > tau * 2 * 1.35);
        if (done && !s.dragTip) s.pause = 0.8;
      },
      draw() {
        A.grid({ step: 0.25 });
        // demo (teal = data)
        A.path(s.demo, { color: alpha('teal', s.beat === 0 ? 0.9 : 0.45), width: s.beat === 0 ? 7 : 5 });
        if (s.raw) A.path(s.raw.map((r) => r.p), { color: 'teal', width: 6 });
        if (s.beat === 1 && s.pathOrig) A.path(s.pathOrig, { color: alpha('blue', 0.25), width: 3, dash: [6, 5] });
        // the learned plan (blue = model)
        A.path(s.path, { color: alpha('blue', 0.8), width: 3, dash: s.beat === 0 ? [7, 5] : undefined });
        if (s.beat === 4) {
          A.path(s.plainPath, { color: alpha('teal', 0.8), width: 3, dash: [7, 5] });
          const pt = [s.plain.x.y, s.plain.y.y];
          A.spring(pt, s.goal, { color: alpha('teal', 0.7), width: 2, coils: 7 });
          A.path(s.plain.trail, { color: 'teal', width: 4 });
          A.dot(pt, 9, { color: 'teal', ring: 'bg' });
          A.emoji('🌱', [pt[0], pt[1] + 0.22], 20);
        }
        if (s.beat === 3) {
          A.path(s.slow.trail, { color: alpha('orange', 0.7), width: 4 });
          A.dot([s.slow.x.y, s.slow.y.y], 8, { color: 'orange', ring: 'bg' });
          A.emoji('🐢', [s.slow.x.y, s.slow.y.y + 0.22], 20);
        }
        A.pathGradient(s.play.trail, (i, t) => alpha('pink', 0.2 + 0.8 * t), { width: 4 });
        const tip = [s.play.x.y, s.play.y.y];
        if (s.pushT > 0) A.vec([tip[0] - s.pushV[0] * 0.03, tip[1] - s.pushV[1] * 0.03], [s.pushV[0] * 0.03, s.pushV[1] * 0.03], { color: 'coral', width: 5 });
        if (s.beat === 3) A.emoji('🐇', [tip[0], tip[1] + 0.25], 20);
        A.dot(s.start, 7, { color: 'teal', ring: 'bg' });
        A.emoji('🎯', [s.goal[0] + 0.2, s.goal[1] + 0.2], 20);
        if (s.beat === 0 && !s.raw) A.emoji('✍️', [0.25, 2.85], 26);

        // ---------------- right: the bumps and their weights ----------------
        drawBasis(B, s.dx, 7.4, 'red', s.play.x.x);
        drawBasis(B, s.dy, 2.6, 'green', s.play.y.x);
        B.text('x', [0.3, 9.6], { size: 16, color: 'red' });
        B.text('y', [0.3, 4.8], { size: 16, color: 'green' });
      },
    };
  },
};

// Gaussian bumps ψᵢ over time (purple) with weights wᵢ (bars), and their blend f (blue).
function drawBasis(B, d, yc, color, phase) {
  const T = 1.3, x0 = 0.7, x1 = 9.6, X = (t) => x0 + (t / T) * (x1 - x0), H = 2.0;
  const wmax = Math.max(...d.w.map(Math.abs), 1e-6);
  B.line([x0, yc], [x1, yc], { color: alpha('muted', 0.4), width: 1 });
  const ts = []; for (let i = 0; i <= 120; i++) ts.push((T * i) / 120);
  d.c.forEach((c, i) => {
    const pts = ts.map((t) => { const x = Math.exp(-d.ax * t); return [X(t), yc + Math.exp(-d.h[i] * (x - c) ** 2) * H * 0.5]; });
    B.path(pts, { color: alpha('purple', 0.3), width: 1.2 });
    const tc = -Math.log(c) / d.ax;
    if (tc <= T) B.bar(X(tc) - 0.08, yc, 0.16, (d.w[i] / wmax) * H, { color: alpha(color, 0.85), r: 2 });
  });
  // the forcing term (normalized)
  const f = ts.map((t) => d.forcing(Math.exp(-d.ax * t)));
  const fm = Math.max(...f.map(Math.abs), 1e-6);
  B.path(ts.map((t, i) => [X(t), yc + (f[i] / fm) * H]), { color: 'blue', width: 2.5 });
  // where the phase clock is now
  const tNow = -Math.log(Math.max(phase, 1e-6)) / d.ax;
  if (tNow <= T) B.line([X(tNow), yc - H - 0.1], [X(tNow), yc + H + 0.1], { color: 'pink', width: 2.5 });
}
