// EKF & SLAM: a robot drives a loop among stars ⭐. Wheels alone → its "where am I"
// blob balloons. Glance at a star (teal ray) → the blob snaps tight. Bend the
// world too much and the true belief is a banana the EKF ellipse can't draw.
// Don't know where the stars are either? Learn them too — that's SLAM.
import { alpha } from '../viz/palette.js';
import { EKF } from '../core/estimation.js';
import { mmul, T, madd, zeros } from '../core/linalg.js';
import { rng, clamp, smoothstep, wrapAngle } from '../core/random.js';
import { fmt } from '../viz/ui.js';
import { hudPlot } from './registration.js';

const STARS = [[3.9, 2.6], [0.6, 4.4], [-3.0, 3.6], [-4.6, -0.4], [-2.6, -3.9], [1.2, -4.4], [4.4, -2.0], [0.3, 0.4]];
const RANGE = 2.9, V = 1.1, RAD = 3.0;

// unicycle motion & its Jacobian
const f3 = (x, u, dt) => [x[0] + u[0] * dt * Math.cos(x[2]), x[1] + u[0] * dt * Math.sin(x[2]), wrapAngle(x[2] + u[1] * dt)];
const F3 = (x, u, dt) => [[1, 0, -u[0] * dt * Math.sin(x[2])], [0, 1, u[0] * dt * Math.cos(x[2])], [0, 0, 1]];
// noise on (v, ω) pushed through the motion: V M Vᵀ
const Q3 = (x, dt, sv, sw) => {
  const Vj = [[dt * Math.cos(x[2]), 0], [dt * Math.sin(x[2]), 0], [0, dt]];
  const M = [[sv * sv / dt, 0], [0, sw * sw / dt]];
  return mmul(mmul(Vj, M), T(Vj));
};
const wrapZ = (y) => [y[0], wrapAngle(y[1])];

export default {
  eq: [
    ['predict:  ', ['x̂', 'blue'], ' ← f(', ['x̂', 'blue'], ', ', ['u', 'orange'], ')      ', ['P', 'purple'], ' ← F ', ['P', 'purple'], ' Fᵀ + ', ['Q', 'purple'], '      F = ∂f/∂x  (straight-line guess of a curvy f)'],
    ['measure:  ', ['z', 'teal'], ' = [ range, bearing ] to a ', ['⭐', 'gold'], '      H = ∂h/∂x'],
    ['update:   ', ['K', 'gold'], ' = ', ['P', 'purple'], 'Hᵀ(H', ['P', 'purple'], 'Hᵀ + ', ['R', 'teal'], ')⁻¹    ', ['x̂', 'blue'], ' ← ', ['x̂', 'blue'], ' + ', ['K', 'gold'], '(', ['z', 'teal'], ' − h(', ['x̂', 'blue'], '))    ', ['P', 'purple'], ' ← (I − ', ['K', 'gold'], 'H)', ['P', 'purple']],
    ['SLAM: ', ['x̂', 'blue'], ' = [ robot, ', ['⭐₁', 'gold'], ', ', ['⭐₂', 'gold'], ', … ]  — one big Gaussian; re-seeing an old ', ['⭐', 'gold'], ' shrinks everything'],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait;
    const g = stage.g.setBounds(tall ? [-5.2, -8.4, 5.2, 5.2] : [-9.4, -5.2, 5.3, 5.2]);
    const r = rng(9);
    const s = {
      beat: 0, sv: 0.12, sw: 0.1, sr: 0.12, sb: 0.06, stars: STARS.map((p) => [...p]),
      truth: null, ekf: null, tp: [], ep: [], rays: [], tz: 0, T: 0, sig: [], lsig: [], closure: 0,
      thSig: 0.35, parts: [], bt: 0,
    };
    const start = () => [RAD, 0, Math.PI / 2];
    const u = () => [V, V / RAD];

    function resetLoc() {
      s.truth = start(); s.T = 0; s.tz = 0; s.tp = []; s.ep = []; s.rays = []; s.sig = []; s.lsig = [];
      s.ekf = new EKF({
        x: start(), P: [[1e-3, 0, 0], [0, 1e-3, 0], [0, 0, 1e-4]],
        f: (x, uu) => f3(x, uu, s.dt), F: (x, uu) => F3(x, uu, s.dt),
        Q: (x) => Q3(x, s.dt, s.sv, s.sw), R: [[s.sr ** 2, 0], [0, s.sb ** 2]],
      });
    }
    // ---------- SLAM: state = [x, y, θ, ⭐₁x, ⭐₁y, …]
    function resetSlam() {
      resetLoc();
      const n = 3 + 2 * s.stars.length;
      const P = zeros(n); P[0][0] = P[1][1] = 1e-3; P[2][2] = 1e-4;
      const x = new Array(n).fill(0); start().forEach((v, i) => (x[i] = v));
      s.seen = s.stars.map(() => false); s.closure = 0; s.firstSeenT = s.stars.map(() => -1);
      s.ekf = new EKF({
        x, P,
        f: (X, uu) => { const out = X.slice(); f3(X, uu, s.dt).forEach((v, i) => (out[i] = v)); return out; },
        F: (X, uu) => { const Fm = zeros(n); for (let i = 0; i < n; i++) Fm[i][i] = 1; const f = F3(X, uu, s.dt); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Fm[i][j] = f[i][j]; return Fm; },
        Q: (X) => { const Qm = zeros(n); const q = Q3(X, s.dt, s.sv, s.sw); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Qm[i][j] = q[i][j]; return Qm; },
        R: [[s.sr ** 2, 0], [0, s.sb ** 2]],
      });
    }
    function resetBanana() {
      s.bt = 0;
      const p0 = tall ? [0, -6.6] : [-7.4, 0], th0 = tall ? Math.PI / 2 : 0;
      s.b0 = [p0[0], p0[1], th0];
      s.parts = Array.from({ length: 500 }, () => [p0[0] + r.normal(0, 0.05), p0[1] + r.normal(0, 0.05), th0 + r.normal(0, s.thSig)]);
      s.ekf = new EKF({
        x: [...s.b0], P: [[0.0025, 0, 0], [0, 0.0025, 0], [0, 0, s.thSig ** 2]],
        f: (x, uu) => f3(x, uu, s.dt), F: (x, uu) => F3(x, uu, s.dt), Q: (x) => Q3(x, s.dt, 0.22, 0.01), R: [[1, 0], [0, 1]],
      });
    }

    // landmark (range, bearing) model for star j, given the slot of its x in the state (or a fixed spot)
    function hFor(m, slot) {
      const get = (X) => (slot === null ? m : [X[slot], X[slot + 1]]);
      const h = (X) => { const p = get(X), dx = p[0] - X[0], dy = p[1] - X[1]; return [Math.hypot(dx, dy), wrapAngle(Math.atan2(dy, dx) - X[2])]; };
      const H = (X) => {
        const p = get(X), dx = p[0] - X[0], dy = p[1] - X[1], q = dx * dx + dy * dy, rr = Math.sqrt(q);
        const Hm = zeros(2, X.length);
        Hm[0][0] = -dx / rr; Hm[0][1] = -dy / rr;
        Hm[1][0] = dy / q; Hm[1][1] = -dx / q; Hm[1][2] = -1;
        if (slot !== null) { Hm[0][slot] = dx / rr; Hm[0][slot + 1] = dy / rr; Hm[1][slot] = -dy / q; Hm[1][slot + 1] = dx / q; }
        return Hm;
      };
      return { h, H };
    }
    function observe() {
      s.rays = [];
      const x = s.truth, ekf = s.ekf;
      s.stars.forEach((m, j) => {
        const dx = m[0] - x[0], dy = m[1] - x[1], d = Math.hypot(dx, dy);
        if (d > RANGE) return;
        const z = [d + r.normal(0, s.sr), wrapAngle(Math.atan2(dy, dx) - x[2] + r.normal(0, s.sb))];
        s.rays.push({ j, z });
        const R = [[s.sr ** 2, 0], [0, s.sb ** 2]];
        if (s.beat !== 3) { const { h, H } = hFor(m, null); ekf.update(z, h, H, R, wrapZ); return; }
        const slot = 3 + 2 * j;
        if (!s.seen[j]) {
          // first sighting: put the star where the ray says, with the robot's doubt + the sensor's doubt
          const X = ekf.x, P = ekf.P, n = X.length, a = X[2] + z[1], c = Math.cos(a), sn = Math.sin(a);
          X[slot] = X[0] + z[0] * c; X[slot + 1] = X[1] + z[0] * sn;
          const Gr = [[1, 0, -z[0] * sn], [0, 1, z[0] * c]], Gz = [[c, -z[0] * sn], [sn, z[0] * c]];
          const Prr = [0, 1, 2].map((i) => [0, 1, 2].map((k) => P[i][k]));
          const Pmm = madd(mmul(mmul(Gr, Prr), T(Gr)), mmul(mmul(Gz, R), T(Gz)));
          const Prow = [0, 1, 2].map((i) => P[i]);          // 3 × n
          const Pmx = mmul(Gr, Prow);                         // 2 × n
          for (let k = 0; k < n; k++) { P[slot][k] = Pmx[0][k]; P[slot + 1][k] = Pmx[1][k]; P[k][slot] = Pmx[0][k]; P[k][slot + 1] = Pmx[1][k]; }
          P[slot][slot] = Pmm[0][0]; P[slot][slot + 1] = Pmm[0][1]; P[slot + 1][slot] = Pmm[1][0]; P[slot + 1][slot + 1] = Pmm[1][1];
          s.seen[j] = true; s.firstSeenT[j] = s.T;
        } else {
          if (s.T - s.firstSeenT[j] > 12) s.closure = 1.5;   // an OLD friend: loop closure!
          const { h, H } = hFor(null, slot);
          ekf.update(z, h, H, R, wrapZ);
        }
      });
    }

    // ⭐ handles (move the map in beats 1–2)
    s.stars.forEach((_, j) => stage.handle({ pen: g, color: 'gold', r: 11, icon: '⭐', visible: () => s.beat < 2, get: () => s.stars[j], set: (p) => (s.stars[j] = p) }));

    ui.beats(['🚗', '📡', '🍌', '🗺️'], (b) => {
      s.beat = b;
      if (b === 2) resetBanana(); else if (b === 3) resetSlam(); else resetLoc();
      thS.el.style.display = b === 2 ? '' : 'none';
    });
    ui.slider({ icon: '🛞', color: 'purple', min: 0.02, max: 0.35, value: s.sv, title: 'wheel slip (odometry noise)', onInput: (v) => { s.sv = v; s.sw = v * 0.8; } });
    ui.slider({ icon: '📡', color: 'teal', min: 0.03, max: 0.5, value: s.sr, title: 'sensor noise', onInput: (v) => { s.sr = v; s.sb = v / 2; } });
    const thS = ui.slider({ icon: '🧭', color: 'purple', min: 0.05, max: 0.9, value: s.thSig, title: 'heading doubt', onInput: (v) => { s.thSig = v; resetBanana(); } });
    thS.el.style.display = 'none';
    ui.button({ icon: '↩️', title: 'drive again', onClick: () => (s.beat === 2 ? resetBanana() : s.beat === 3 ? resetSlam() : resetLoc()) });
    ui.readout(() => fmt(Math.sqrt(Math.max(0, s.ekf.P[0][0] + s.ekf.P[1][1])), 2), { icon: '🌫️', color: 'purple', title: 'position spread' });
    resetLoc();

    return {
      update(dt) {
        dt = clamp(dt, 0, 0.05);
        if (dt === 0) return;
        s.dt = dt;
        if (s.beat === 2) return stepBanana(dt);
        s.T += dt;
        const uu = u();
        // truth: same commands + slip the robot doesn't know about
        const un = [uu[0] + r.normal(0, s.sv / Math.sqrt(dt)), uu[1] + r.normal(0, s.sw / Math.sqrt(dt))];
        s.truth = f3(s.truth, un, dt);
        s.ekf.predict(uu);
        if (s.beat >= 1) { s.tz += dt; if (s.tz > 0.3) { s.tz = 0; observe(); } else if (s.tz > 0.12) s.rays = []; }
        s.closure = Math.max(0, s.closure - dt);
        s.tp.push([s.truth[0], s.truth[1]]); s.ep.push([s.ekf.x[0], s.ekf.x[1]]);
        if (s.tp.length > 900) { s.tp.shift(); s.ep.shift(); }
        if ((s.ep.length % 6) === 0) {
          s.sig.push(Math.sqrt(s.ekf.P[0][0] + s.ekf.P[1][1]));
          if (s.beat === 3) { const ls = s.seen.map((sn, j) => (sn ? Math.sqrt(s.ekf.P[3 + 2 * j][3 + 2 * j] + s.ekf.P[4 + 2 * j][4 + 2 * j]) : NaN)).filter(Number.isFinite); s.lsig.push(ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : NaN); }
          if (s.sig.length > 200) { s.sig.shift(); s.lsig.shift(); }
        }
        const lap = 2 * Math.PI * RAD / V;
        if (s.beat === 0 && (s.T > lap * 1.05 || s.ekf.P[0][0] > 9)) resetLoc();
        if (s.beat === 3 && s.T > lap * 2.2) resetSlam();
      },
      draw() {
        g.grid({ step: 1 });
        if (s.beat === 2) return drawBanana();
        const ekf = s.ekf, x = ekf.x;
        // the map
        s.stars.forEach((m, j) => {
          const known = s.beat !== 3;
          if (!known) g.emoji('⭐', m, 18, { alpha: 0.35 });
          if (s.beat === 3 && s.seen[j]) {
            const sl = 3 + 2 * j, mu = [x[sl], x[sl + 1]];
            const Pm = [[ekf.P[sl][sl], ekf.P[sl][sl + 1]], [ekf.P[sl + 1][sl], ekf.P[sl + 1][sl + 1]]];
            g.cov(mu, Pm, 2, { fill: alpha('purple', 0.15), color: alpha('purple', 0.85), width: 1.8 });
            g.dot(mu, 5, { color: 'blue', ring: 'bg' });
            g.line(mu, m, { color: alpha('coral', 0.6), width: 1.5 });
          }
        });
        // the loop we mean to drive
        g.circle([0, 0], RAD, { color: alpha('orange', 0.22), width: 2, dash: [5, 7] });
        g.path(s.tp, { color: alpha('lime', 0.8), width: 2.5 });
        g.path(s.ep, { color: alpha('blue', 0.8), width: 2.5 });
        // measurements: teal rays from the robot to the stars it can see
        for (const ray of s.rays) {
          const a = s.truth[2] + ray.z[1];
          g.line([s.truth[0], s.truth[1]], [s.truth[0] + Math.cos(a) * ray.z[0], s.truth[1] + Math.sin(a) * ray.z[0]], { color: 'teal', width: 2.5 });
        }
        if (s.beat >= 1) g.circle([s.truth[0], s.truth[1]], RANGE, { color: alpha('teal', 0.18), width: 1.5, dash: [3, 6] });
        // robot belief + truth
        const Pr = [[ekf.P[0][0], ekf.P[0][1]], [ekf.P[1][0], ekf.P[1][1]]];
        g.cov([x[0], x[1]], Pr, 2, { fill: alpha('purple', 0.16), color: 'purple', width: 2.2 });
        robot([x[0], x[1], x[2]], 'blue');
        robot(s.truth, 'lime');
        if (s.closure > 0) g.emoji('🔁', [x[0], x[1] + 0.9], 24 + 10 * smoothstep(s.closure / 1.5));
        // spread over time (robot = purple line, stars = gold dots)
        const area = g.area, w = tall ? area.w - 24 : Math.min(330, area.w * 0.3), h = tall ? 90 : 110;
        const series = [{ vals: s.sig, color: 'purple', width: 2.5 }];
        if (s.beat === 3) series.push({ vals: s.lsig, color: 'gold', width: 2 });
        hudPlot(stage.hud, { x: area.x + 12, y: tall ? area.y + area.h - h - 10 : area.y + 12, w, h }, series, { icon: '🌫️', ymin: 0, n: 200 });
      },
    };

    function robot(p, color) {
      g.circle([p[0], p[1]], 0.22, { fill: alpha(color, 0.25), color, width: 2.5 });
      g.line([p[0], p[1]], [p[0] + Math.cos(p[2]) * 0.38, p[1] + Math.sin(p[2]) * 0.38], { color, width: 3 });
    }

    // ---------------------------------------------------------------- 🍌
    function stepBanana(dt) {
      s.bt += dt;
      if (s.bt > 5.0) { resetBanana(); return; }
      if (s.bt > 3.0) return;
      const uu = [2.1, 0];
      s.parts = s.parts.map((p) => f3(p, [uu[0] + r.normal(0, 0.22 / Math.sqrt(dt)), r.normal(0, 0.01 / Math.sqrt(dt))], dt));
      s.ekf.predict(uu);
    }
    function drawBanana() {
      const x = s.ekf.x;
      g.emoji('🤖', [s.b0[0] - 0.5, s.b0[1] - 0.3], 26);
      // true belief = where the particles went (purple sand)
      for (const p of s.parts) g.dot([p[0], p[1]], 2.2, { color: alpha('purple', 0.55) });
      const n = s.parts.length;
      const mx = s.parts.reduce((a, p) => a + p[0], 0) / n, my = s.parts.reduce((a, p) => a + p[1], 0) / n;
      // EKF's guess: one ellipse (it can only draw ovals)
      const Pr = [[s.ekf.P[0][0], s.ekf.P[0][1]], [s.ekf.P[1][0], s.ekf.P[1][1]]];
      g.cov([x[0], x[1]], Pr, 2, { color: 'blue', width: 3 });
      g.cov([x[0], x[1]], Pr, 1, { color: alpha('blue', 0.5), width: 1.5, dash: [4, 4] });
      g.dot([x[0], x[1]], 7, { color: 'blue', ring: 'bg' });
      // the real average sits inside the bend — the EKF overshoots
      g.circle([mx, my], g.world(8), { color: 'purple', width: 3 });
      g.line([mx - g.world(13), my], [mx + g.world(13), my], { color: 'purple', width: 2 });
      g.line([mx, my - g.world(13)], [mx, my + g.world(13)], { color: 'purple', width: 2 });
      if (s.bt > 3.0) g.line([mx, my], [x[0], x[1]], { color: 'coral', width: 3 });
      // heading doubt fan at the start
      g.wedge([s.b0[0], s.b0[1]], 1.2, s.b0[2] - 2 * s.thSig, s.b0[2] + 2 * s.thSig, { color: 'purple', alpha: 0.18 });
      g.arrow([s.b0[0], s.b0[1]], [s.b0[0] + Math.cos(s.b0[2]) * 1.2, s.b0[1] + Math.sin(s.b0[2]) * 1.2], { color: 'orange', width: 3 });
    }
  },
};
