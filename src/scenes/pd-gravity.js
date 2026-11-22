// PD + gravity compensation: each joint has a spring (P) and a shock absorber (D)
// pulling it toward the gold pose. Gravity drags the arm down, so it SAGS 😩 —
// unless balloons 🎈 (the g(q) term) hold up exactly the arm's weight.
// The energy V = ½q̇ᵀMq̇ + ½eᵀKₚe is a bowl the error ball always rolls down.
import { alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rk4, twoLink, twoLinkM, twoLinkG, twoLinkDeriv } from '../core/dynamics.js';
import { planarFK, planarJacobian, twoLinkIK } from '../core/kinematics.js';
import { mvec, T } from '../core/linalg.js';
import { clamp, wrapAngle } from '../core/random.js';

const H = 0.001, L = [twoLink.l1, twoLink.l2];
const ES = 1.0; // e-space scale in the bowl panel (world units per radian)

// a torsional spring: zig-zag along an arc around a joint
function coilArc(g, c, r, a0, da, o = {}) {
  if (Math.abs(da) < 0.02) return;
  const n = Math.max(8, Math.round(Math.abs(da) * 22)), pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (da * i) / n, rr = r + (i === 0 || i === n ? 0 : (i % 2 ? 1 : -1) * g.world(6));
    pts.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
  }
  g.path(pts, { color: o.color ?? 'teal', width: o.width ?? 2.5 });
  g.dot(pts[n], 3.5, { color: o.color ?? 'teal' });
}

export default {
  eq: [
    [['τ', 'ink'], ' = ', ['Kₚ e', 'teal'], ' − ', ['K_d q̇', 'purple'], ' + ', ['g(q)', 'green'], '        e = ', ['q_d', 'gold'], ' − q'],
    ['without ', ['g(q)', 'green'], ':  ', ['Kₚ e∞', 'teal'], ' = ', ['g(q∞)', 'green'], '  → sag ', ['e∞', 'coral'], ' ≠ 0'],
    [['V', 'lime'], ' = ½ q̇ᵀ', ['M(q)', 'orange'], 'q̇ + ½ eᵀ', ['Kₚ', 'teal'], 'e  ≥ 0'],
    [['V̇', 'lime'], ' = −q̇ᵀ', ['K_d', 'purple'], 'q̇ ≤ 0   (Ṁ − 2C is skew)  ⇒  e → 0  (LaSalle)'],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[-2.3, -2.3, 2.3, 2.3], [-1.75, -2.75, 1.75, 1.75]], [1.3, 1]);
    const p = { ...twoLink };
    const s = {
      beat: 0, x: [-1.2, 0.4, 0, 0], qd: [0.35, 0.5], kp: 40, kd: 10, comp: false,
      F: [0, 0], ptr: null, poking: false, t: 0, trail: [], vh: [], lastS: 0, nextPoke: 2,
    };
    const q = () => [s.x[0], s.x[1]];
    const pts = (qq) => planarFK(L, qq).points;
    const err = () => [wrapAngle(s.qd[0] - s.x[0]), wrapAngle(s.qd[1] - s.x[1])];
    const V = () => {
      const M = twoLinkM(p, q()), v = [s.x[2], s.x[3]], e = err();
      const KE = 0.5 * (v[0] * (M[0][0] * v[0] + M[0][1] * v[1]) + v[1] * (M[1][0] * v[0] + M[1][1] * v[1]));
      const PE = 0.5 * s.kp * (e[0] * e[0] + e[1] * e[1]);
      return { KE, PE, V: KE + PE };
    };
    const setTarget = (pt) => {
      const r = Math.hypot(pt[0], pt[1]), k = r > 1.95 ? 1.95 / r : r < 0.15 ? 0.15 / Math.max(r, 1e-6) : 1;
      const sol = twoLinkIK(p.l1, p.l2, pt[0] * k, pt[1] * k, s.qd[1] >= 0);
      if (sol) s.qd = sol;
    };

    // gold: where we want the hand; pink: poke the real hand
    stage.handle({ pen: A, color: 'gold', r: 12, kind: 'ring', get: () => pts(s.qd)[2], set: setTarget });
    stage.handle({
      pen: A, color: 'pink', r: 12,
      get: () => (s.poking && s.ptr ? s.ptr : pts(q())[2]),
      set: (pt) => (s.ptr = pt),
      onStart: () => { s.poking = true; s.ptr = pts(q())[2]; },
      onEnd: () => { s.poking = false; s.ptr = null; s.F = [0, 0]; },
    });
    const kpS = ui.slider({ icon: '🌀', title: 'Kp spring', color: 'teal', min: 5, max: 200, step: 1, value: s.kp, onInput: (v) => (s.kp = v) });
    ui.slider({ icon: '🛞', title: 'Kd damper', color: 'purple', min: 0, max: 40, step: 0.5, value: s.kd, onInput: (v) => (s.kd = v) });
    const compT = ui.toggle({ icon: '🎈', title: 'gravity compensation', color: 'green', value: false, onChange: (v) => (s.comp = v) });
    const poke = () => { s.x[2] += 4; s.x[3] -= 6; };
    ui.button({ icon: '👋', title: 'poke', onClick: poke });
    ui.beats(['😩', '🎈', '🥣', '👋'], (i) => {
      s.beat = i; s.trail = []; s.vh = []; s.t = 0; s.lastS = -1; s.nextPoke = 1.5;
      s.qd = [0.35, 0.5];
      kpS.set(40); s.kp = 40;
      if (i === 0) { compT.set(false); s.x = [-0.6, 0.4, 0, 0]; }
      if (i === 1) { compT.set(true); s.x = [-0.6, 0.4, 0, 0]; }
      if (i === 2) { compT.set(true); s.x = [-1.4, -0.9, 0, 0]; }
      if (i === 3) { compT.set(true); s.x = [s.qd[0], s.qd[1], 0, 0]; }
    });
    ui.readout(() => fmt(V().V, 1), { icon: '🥣', color: 'lime', title: 'energy V' });

    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        const n = Math.min(160, Math.round(dt / H));
        if (s.poking && s.ptr) {
          const tip = pts(q())[2];
          s.F = [(s.ptr[0] - tip[0]) * 60, (s.ptr[1] - tip[1]) * 60];
        }
        const tau = (t, qq, qdot) => {
          const e = [wrapAngle(s.qd[0] - qq[0]), wrapAngle(s.qd[1] - qq[1])];
          let u = [s.kp * e[0] - s.kd * qdot[0], s.kp * e[1] - s.kd * qdot[1]];
          if (s.comp) { const G = twoLinkG(p, qq); u = [u[0] + G[0], u[1] + G[1]]; }
          if (s.F[0] || s.F[1]) { const Jt = T(planarJacobian(L, qq)); const te = mvec(Jt, s.F); u = [u[0] + te[0], u[1] + te[1]]; }
          return u;
        };
        const f = twoLinkDeriv(p, tau, 0.05);
        for (let k = 0; k < n; k++) s.x = rk4(f, 0, s.x, H);
        s.t += dt;
        if (s.beat === 3 && !s.poking && s.t > s.nextPoke) { poke(); s.nextPoke = s.t + 3.2; }
        if (s.t - s.lastS > 1 / 30 || s.t < s.lastS) {
          s.lastS = s.t;
          const e = err();
          s.trail.push([e[0], e[1]]); if (s.trail.length > 150) s.trail.shift();
          s.vh.push([s.t, V().V]); while (s.vh.length && s.vh[0][0] < s.t - 8) s.vh.shift();
        }
      },
      draw() {
        const qq = q(), P = pts(qq), Pd = pts(s.qd);
        const e = err();
        // ---------------- arm ----------------
        A.grid({ step: 0.5 });
        A.arm(Pd, { color: alpha('gold', 0.35), jointColor: alpha('gold', 0.6), handColor: alpha('gold', 0.6), width: 16, base: false });
        const G = twoLinkG(p, qq);
        // gravity on each link (green), balloons when compensating
        const coms = [[P[0][0] * 0.5 + P[1][0] * 0.5, P[0][1] * 0.5 + P[1][1] * 0.5], [P[1][0] * 0.5 + P[2][0] * 0.5, P[1][1] * 0.5 + P[2][1] * 0.5]];
        A.arm(P, { width: 16 });
        coms.forEach((c) => {
          A.vec(c, [0, -0.38], { color: 'green', width: 3 });
          if (s.comp) {
            const b = [c[0] + 0.08, c[1] + 0.62];
            A.line(c, [b[0], b[1] - 0.15], { color: alpha('muted', 0.8), width: 1.2 });
            A.emoji('🎈', b, 26);
          }
        });
        // joint springs: from where each link IS toward where it SHOULD be
        coilArc(A, P[0], 0.6, qq[0], e[0], { color: 'teal', width: 3.5 });
        coilArc(A, P[1], 0.5, qq[0] + qq[1], e[1], { color: 'teal', width: 3.5 });
        if (Math.hypot(P[2][0] - Pd[2][0], P[2][1] - Pd[2][1]) > 0.06) A.line(P[2], Pd[2], { color: 'coral', width: 2.5, dash: [5, 4] });
        // poke force
        if (s.poking && s.ptr) A.arrow(P[2], s.ptr, { color: 'coral', width: 4 });
        const off = Math.hypot(P[2][0] - Pd[2][0], P[2][1] - Pd[2][1]);
        A.emoji(off > 0.06 ? '😩' : '😊', [P[2][0] + 0.32, P[2][1] - 0.32], 26);

        // ---------------- energy bowl in error space ----------------
        const c0 = [0, 0.15], R = 1.5;
        const toB = (ee) => [c0[0] + clamp(ee[0] * ES, -R, R), c0[1] + clamp(ee[1] * ES, -R, R)];
        for (let k = 6; k >= 1; k--) {
          const r = (R * k) / 6;
          B.circle(c0, r, { fill: alpha('teal', 0.05 + 0.03 * (6 - k)), color: alpha('teal', 0.35), width: 1 });
        }
        B.line([c0[0] - R, c0[1]], [c0[0] + R, c0[1]], { color: alpha('muted', 0.35), width: 1 });
        B.line([c0[0], c0[1] - R], [c0[0], c0[1] + R], { color: alpha('muted', 0.35), width: 1 });
        B.text('e₁', [c0[0] + R + 0.12, c0[1]], { color: 'coral', size: 14 });
        B.text('e₂', [c0[0], c0[1] + R + 0.12], { color: 'coral', size: 14 });
        B.text('★', c0, { color: 'gold', size: 22 });
        B.pathGradient(s.trail.map(toB), (i, t) => alpha('coral', 0.1 + 0.6 * t), { width: 2.5 });
        const ball = toB(e);
        // what gravity does to the ball (pushes it off-center unless balloons cancel it)
        if (!s.comp) B.vec(ball, [G[0] * 0.025, G[1] * 0.025], { color: 'green', width: 3 });
        B.dot(ball, 10, { color: 'coral', ring: 'bg', ringWidth: 2.5 });
        // V(t) plot + meter
        const v = V(), px0 = -1.6, px1 = 1.15, py0 = -2.6, py1 = -1.55;
        B.rect(px0, py0, px1 - px0, py1 - py0, { color: alpha('muted', 0.3), width: 1 });
        const vmax = Math.max(8, ...s.vh.map((h) => h[1])) * 1.05;
        const t0 = s.vh.length ? s.vh[0][0] : 0;
        B.path(s.vh.map(([t, val]) => [px0 + ((t - t0) / 8) * (px1 - px0), py0 + (val / vmax) * (py1 - py0)]), { color: 'lime', width: 2.5 });
        const mx = 1.3, mh = 4.0, my = -2.6;
        B.rect(mx, my, 0.3, mh, { color: alpha('muted', 0.3), width: 1 });
        const vm = Math.max(vmax, v.V);
        B.bar(mx, my, 0.3, (v.PE / vm) * mh, { color: 'teal', r: 0 });
        B.bar(mx, my + (v.PE / vm) * mh, 0.3, (v.KE / vm) * mh, { color: 'orange', r: 0 });
        B.emoji('🥣', [mx + 0.15, my + mh + 0.22], 18);
      },
    };
  },
};
