// Arm dynamics: a two-link arm swinging under gravity, computed from the
// Euler–Lagrange equations  M(q)q̈ + C(q,q̇)q̇ + g(q) = τ.
// Fling it, watch energy slosh between "moving" and "height", see how heavy
// the arm feels (M as an ellipse), the sideways Coriolis kicks, and chaos.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rk4, twoLink, twoLinkM, twoLinkC, twoLinkG, twoLinkEnergy, twoLinkDeriv, twoLinkAccel } from '../core/dynamics.js';
import { planarFK, planarJacobian, twoLinkIK } from '../core/kinematics.js';
import { inv, mmul, T, mvec } from '../core/linalg.js';
import { clamp, wrapAngle } from '../core/random.js';
import { drawMatrix } from './matrix.js';

const H = 0.001;          // physics substep (s)
const MAX_SUB = 160;      // cap per frame
const PE_MIN = -(twoLink.m1 * twoLink.lc1 + twoLink.m2 * (twoLink.l1 + twoLink.lc2)) * twoLink.g;

// Principal axes of a symmetric 2×2 matrix.
function sym2(S) {
  const a = S[0][0], b = S[0][1], d = S[1][1];
  const tr = (a + d) / 2, disc = Math.sqrt(Math.max(((a - d) / 2) ** 2 + b * b, 0));
  const l1 = tr + disc, l2 = tr - disc;
  const ang = Math.abs(b) < 1e-12 ? (a >= d ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b);
  return { l1, l2, ang };
}

// Curved arrow around c (a torque), from angle a0 sweeping da radians.
function arcArrow(g, c, r, a0, da, o = {}) {
  if (Math.abs(da) < 0.06) return;
  const n = 26, pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (da * i) / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  g.path(pts.slice(0, n - 1), o);
  g.arrow(pts[n - 3], pts[n], { ...o, head: 11 });
}

export default {
  eq: [
    [['M(q)', 'orange'], ' ', ['q̈', 'orange'], ' + ', ['C(q,q̇) q̇', 'coral'], ' + ', ['g(q)', 'green'], ' = τ − ', ['b', 'purple'], ' q̇'],
    ['L = ', ['KE', 'orange'], ' − ', ['PE', 'green'], '      d/dt ∂L/∂q̇ − ∂L/∂q = τ'],
    [['KE', 'orange'], ' = ½ q̇ᵀ ', ['M(q)', 'orange'], ' q̇      ', ['PE', 'green'], ' = Σ mᵢ g yᵢ      ', ['E', 'lime'], ' = ', ['KE', 'orange'], ' + ', ['PE', 'green'], ' = const'],
    [['Λ', 'pink'], ' = (J ', ['M', 'orange'], '⁻¹ Jᵀ)⁻¹   (how heavy the hand feels)'],
    ['chaos: ', ['|δq(t)|', 'coral'], ' ≈ ', ['|δq(0)|', 'purple'], ' e^{λt}'],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[-2.35, -2.35, 2.35, 2.35], [0, 0, 10, 10]], [1.35, 1]);
    const p = { ...twoLink };
    const s = {
      beat: 0, t: 0, x: [2.3, 0.9, 0, 0], ghost: null, b: 0,
      trail: [], gtrail: [], hist: [], div: [],
      drag: false, dragQ: null, prevQ: null, vel: [0, 0], lastSample: 0,
    };
    const L = [p.l1, p.l2];
    const pts = (x) => planarFK(L, [x[0], x[1]]).points;

    const reset = (x0, ghost = false) => {
      s.x = x0.slice(); s.trail = []; s.gtrail = []; s.hist = []; s.div = []; s.t = 0;
      s.ghost = ghost ? [x0[0] + 0.001, x0[1], x0[2], x0[3]] : null;
    };

    // Drag the hand: the arm follows (inverse kinematics); let go to fling it.
    stage.handle({
      pen: A, color: 'pink', r: 13,
      get: () => pts(s.x)[2],
      set: (pt) => {
        const r = Math.hypot(pt[0], pt[1]), k = r > 1.985 ? 1.985 / r : r < 0.05 ? 0.05 / Math.max(r, 1e-6) : 1;
        const tx = pt[0] * k, ty = pt[1] * k;
        const a = twoLinkIK(p.l1, p.l2, tx, ty, true), b = twoLinkIK(p.l1, p.l2, tx, ty, false);
        const cand = [a, b].filter(Boolean);
        if (!cand.length) return;
        const dist = (q) => Math.abs(wrapAngle(q[1] - s.x[1])) + Math.abs(wrapAngle(q[0] - s.x[0]));
        const q = cand.sort((u, v) => dist(u) - dist(v))[0];
        // keep angles continuous so the velocity estimate is clean
        s.dragQ = [s.x[0] + wrapAngle(q[0] - s.x[0]), s.x[1] + wrapAngle(q[1] - s.x[1])];
        if (stage.paused) { s.x[0] = s.dragQ[0]; s.x[1] = s.dragQ[1]; }
      },
      onStart: () => { s.drag = true; s.prevQ = [s.x[0], s.x[1]]; s.vel = [0, 0]; s.dragQ = [s.x[0], s.x[1]]; },
      onEnd: () => {
        s.drag = false;
        s.x[2] = clamp(s.vel[0], -14, 14); s.x[3] = clamp(s.vel[1], -14, 14);
        if (s.beat === 3) s.ghost = [s.x[0] + 0.001, s.x[1], s.x[2], s.x[3]];
        s.trail = []; s.gtrail = []; s.div = [];
      },
    });

    const grav = ui.toggle({ icon: '🌍', title: 'gravity', color: 'green', value: true, onChange: (v) => (p.g = v ? twoLink.g : 0) });
    ui.slider({ icon: '🍯', title: 'friction (damping)', color: 'purple', min: 0, max: 1.5, step: 0.01, value: 0, onInput: (v) => (s.b = v) });
    const spin = () => { s.x[2] = 5.5; s.x[3] = -1.5; s.trail = []; };
    ui.button({ icon: '🌀', title: 'spin both joints', onClick: spin });
    ui.button({ icon: '🔁', title: 'drop from high', onClick: () => reset([2.0, 2.6, 0, 0], s.beat === 3) });

    ui.beats(['🎢', '🏈', '🌀', '🦋'], (i) => {
      s.beat = i;
      if (i === 0) { grav.set(true); reset([2.3, 0.9, 0, 0]); }
      if (i === 1) { grav.set(true); reset([0.2, 1.4, 0, 0]); }
      if (i === 2) { grav.set(false); reset([0.3, 1.9, 0, 0]); spin(); }
      if (i === 3) { grav.set(true); reset([2.0, 2.6, 0, 0], true); }
    });
    ui.readout(() => fmt(energies(s.x).E, 1), { icon: '⚡', color: 'lime', title: 'total energy' });

    const energies = (x) => {
      const e = twoLinkEnergy(p, [x[0], x[1]], [x[2], x[3]]);
      const PE = e.PE - PE_MIN * (p.g / twoLink.g);
      return { KE: e.KE, PE, E: e.KE + PE };
    };

    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        const n = Math.min(MAX_SUB, Math.round(dt / H));
        if (s.drag && s.dragQ) {
          // kinematic drag: follow the pointer; estimate joint speeds for the fling
          const q0 = [s.x[0], s.x[1]];
          s.x[0] = s.dragQ[0]; s.x[1] = s.dragQ[1];
          if (dt > 0) {
            const v = [(s.x[0] - q0[0]) / dt, (s.x[1] - q0[1]) / dt];
            s.vel = s.vel.map((o, i) => o + (v[i] - o) * 0.5);
          }
          s.x[2] = s.vel[0]; s.x[3] = s.vel[1];
          if (s.ghost) s.ghost = [s.x[0] + 0.001, s.x[1], s.x[2], s.x[3]];
        } else {
          const f = twoLinkDeriv(p, () => [0, 0], s.b);
          for (let k = 0; k < n; k++) {
            s.x = rk4(f, 0, s.x, H);
            if (s.ghost) s.ghost = rk4(f, 0, s.ghost, H);
          }
        }
        s.t += dt;
        // trails & histories (sampled ~60 Hz)
        s.trail.push(pts(s.x)[2]); if (s.trail.length > 110) s.trail.shift();
        if (s.ghost) { s.gtrail.push(pts(s.ghost)[2]); if (s.gtrail.length > 110) s.gtrail.shift(); }
        if (s.t - s.lastSample > 1 / 30 || s.t < s.lastSample) {
          s.lastSample = s.t;
          s.hist.push({ t: s.t, ...energies(s.x) }); if (s.hist.length > 240) s.hist.shift();
          if (s.ghost) {
            const d = Math.hypot(wrapAngle(s.x[0] - s.ghost[0]), wrapAngle(s.x[1] - s.ghost[1])) + 1e-6;
            s.div.push([s.t, Math.log10(d)]); if (s.div.length > 600) s.div.shift();
          }
        }
      },
      draw() {
        const q = [s.x[0], s.x[1]], qd = [s.x[2], s.x[3]];
        const P = pts(s.x);
        // ---------------- left: the arm ----------------
        A.grid({ step: 0.5 });
        A.circle([0, 0], 2, { color: alpha('muted', 0.35), dash: [4, 6], width: 1.2 });
        if (p.g) A.vec([2.05, 1.6], [0, -0.55], { color: alpha('green', 0.8), width: 3 });
        if (s.ghost) {
          const G = pts(s.ghost);
          A.path(s.gtrail, { color: alpha('purple', 0.55), width: 2.5 });
          A.arm(G, { color: alpha('purple', 0.6), alpha: 0.55, width: 14, base: false, jointColor: 'purple', handColor: 'purple' });
        }
        A.pathGradient(s.trail, (i, t) => alpha('pink', 0.1 + 0.75 * t), { width: 3 });
        A.arm(P, { width: 16 });

        if (s.beat === 1) {
          // How heavy the HAND feels if you push it: Λ = (J M⁻¹ Jᵀ)⁻¹
          const J = planarJacobian(L, q), M = twoLinkM(p, q);
          const Lam = inv(mmul(mmul(J, inv(M)), T(J)));
          const e = sym2(Lam), k = 0.32;
          A.ellipse(P[2], clamp(e.l1 * k, 0.05, 1.6), clamp(e.l2 * k, 0.05, 1.6), e.ang, { color: 'pink', width: 2.5, fill: alpha('pink', 0.14) });
          A.emoji('🏈', [P[2][0] + 0.32, P[2][1] + 0.32], 18);
        }
        if (s.beat === 2) {
          // Coriolis / centrifugal torques: what the spinning does to each joint.
          const cq = mvec(twoLinkC(p, q, qd), qd);
          const P1 = P[1], a1 = s.x[0] + s.x[1];
          arcArrow(A, P[0], 0.42, s.x[0], clamp(-cq[0] * 0.1, -2.6, 2.6), { color: 'coral', width: 4 });
          arcArrow(A, P1, 0.36, a1, clamp(-cq[1] * 0.1, -2.6, 2.6), { color: 'coral', width: 4 });
          // centrifugal pull on the forearm mass: outward from the base
          const cm = [P1[0] + 0.5 * Math.cos(a1), P1[1] + 0.5 * Math.sin(a1)];
          const w = qd[0], r = Math.hypot(cm[0], cm[1]) || 1;
          A.vec(cm, [cm[0] / r * w * w * 0.03, cm[1] / r * w * w * 0.03], { color: alpha('coral', 0.7), width: 2.5, dash: [5, 4] });
        }

        // ---------------- right panel ----------------
        if (s.beat === 0) drawEnergy(B, s);
        else if (s.beat === 1) drawMass(B, stage, p, q, qd);
        else if (s.beat === 2) drawBalance(B, p, q, qd, s.b);
        else drawChaos(B, s);
      },
    };

    function drawEnergy(g, s) {
      const e = energies(s.x);
      const max = Math.max(40, e.E * 1.05);
      const h = (v) => (v / max) * 5.2;
      const base = 4.1, W = 1.5;
      const col = [[1.2, 'orange', e.KE, '🏃'], [3.4, 'green', e.PE, '⛰️']];
      for (const [x, c, v, ic] of col) {
        g.rect(x, base, W, 5.2, { color: alpha('muted', 0.25), width: 1 });
        g.bar(x, base, W, h(v), { color: c });
        g.emoji(ic, [x + W / 2, base - 0.5], 24);
      }
      g.text('+', [3.05, base + 2], { size: 26, color: 'muted' });
      g.text('=', [5.35, base + 2], { size: 26, color: 'muted' });
      // stacked total: same height, colors slosh
      const x = 6.2;
      g.bar(x, base, W, h(e.PE), { color: 'green', r: 0 });
      g.bar(x, base + h(e.PE), W, h(e.KE), { color: 'orange', r: 0 });
      g.rect(x - 0.08, base - 0.02, W + 0.16, h(e.E) + 0.06, { color: 'lime', width: 3 });
      g.emoji('⚡', [x + W / 2, base - 0.5], 24);
      // history
      const hs = s.hist, t1 = hs.length ? hs[hs.length - 1].t : 0, t0 = Math.max(0, t1 - 8);
      const X = (t) => 0.5 + ((t - t0) / 8) * 9, Y = (v) => 0.4 + (v / max) * 2.6;
      g.line([0.5, 0.4], [9.5, 0.4], { color: alpha('muted', 0.5), width: 1 });
      const ser = (k) => hs.filter((r) => r.t >= t0).map((r) => [X(r.t), Y(r[k])]);
      g.path(ser('PE'), { color: 'green', width: 2 });
      g.path(ser('KE'), { color: 'orange', width: 2 });
      g.path(ser('E'), { color: 'lime', width: 3 });
    }

    function drawMass(g, stage, p, q, qd) {
      // joint-space picture: axes are the two joint angles (orange)
      const c = [5, 5.2];
      g.line([1, c[1]], [9, c[1]], { color: alpha('orange', 0.5), width: 1.5 });
      g.line([c[0], 1.2], [c[0], 9.2], { color: alpha('orange', 0.5), width: 1.5 });
      g.text('q₁', [9.3, c[1]], { color: 'orange', size: 16 });
      g.text('q₂', [c[0], 9.6], { color: 'orange', size: 16 });
      const M = twoLinkM(p, q), e = sym2(M), k = 1.45;
      // faint: M when the arm is straight vs folded, for comparison
      for (const q2 of [0, Math.PI * 0.95]) {
        const Mx = twoLinkM(p, [0, q2]), ex = sym2(Mx);
        g.ellipse(c, ex.l1 * k, Math.max(ex.l2 * k, 0.04), ex.ang, { color: alpha('muted', 0.35), dash: [3, 5], width: 1.2 });
      }
      g.ellipse(c, e.l1 * k, Math.max(e.l2 * k, 0.04), e.ang, { color: 'orange', width: 3, fill: alpha('orange', 0.18) });
      g.emoji('🏈', [c[0] + Math.cos(e.ang) * e.l1 * k * 0.55, c[1] + Math.sin(e.ang) * e.l1 * k * 0.55 + 0.6], 20);
      // the joint velocity, and its kinetic energy ½q̇ᵀMq̇
      g.vec(c, [clamp(qd[0] * 0.4, -3.8, 3.8), clamp(qd[1] * 0.4, -3.8, 3.8)], { color: 'ink', width: 2.5 });
      // elbow angle dial (what M depends on)
      const d = [1.6, 1.4];
      g.arc(d, 0.7, 0, Math.PI, { color: alpha('muted', 0.4), width: 6 });
      const a = Math.PI * (1 - Math.abs(wrapAngle(q[1])) / Math.PI);
      g.line(d, [d[0] + 0.7 * Math.cos(a), d[1] + 0.7 * Math.sin(a)], { color: 'orange', width: 3 });
      g.dot(d, 5, { color: 'orange' });
      g.emoji('💪', [d[0], d[1] - 0.45], 18);
      drawMatrix(stage.hud, M, { x: B.area.x + B.area.w - 170, y: B.area.y + 10, colColors: ['orange', 'orange'] });
    }

    function drawBalance(g, p, q, qd, b) {
      // M q̈ + C q̇ + g = −b q̇ : three pushes that always add up
      const qdd = twoLinkAccel(p, q, qd, [0, 0], b);
      const Mq = mvec(twoLinkM(p, q), qdd), Cq = mvec(twoLinkC(p, q, qd), qd), G = twoLinkG(p, q);
      const rows = [[7.3, 0], [2.8, 1]];
      const sc = (v) => clamp(v * 0.09, -1.9, 1.9);
      for (const [y, j] of rows) {
        const items = [['orange', Mq[j], 'q̈'], ['coral', Cq[j], '🌀'], ['green', G[j], '⬇']];
        g.line([0.4, y], [9.6, y], { color: alpha('muted', 0.4), width: 1 });
        items.forEach(([c, v, ic], i) => {
          const x = 0.8 + i * 2.6;
          g.bar(x, y, 1.3, sc(v), { color: c });
          g.text(ic, [x + 0.65, y - 2.25], { size: 16, color: c });
          if (i < 2) g.text('+', [x + 1.95, y], { size: 20, color: 'muted' });
        });
        g.text('=', [8.6, y], { size: 20, color: 'muted' });
        g.bar(9.05, y, 0.55, sc(-b * qd[j]), { color: 'purple' });
        g.dot([0.35, y + 2], 7, { color: 'orange' });
        g.text(String(j + 1), [0.35, y + 2], { size: 11, color: 'bg', halo: false });
      }
    }

    function drawChaos(g, s) {
      // log₁₀ of the gap between the two arms, over time
      const t1 = Math.max(10, s.t), t0 = t1 - 10;
      const X = (t) => 0.6 + ((t - t0) / 10) * 9, Y = (v) => 1 + ((v + 3.5) / 4.2) * 7.6;
      for (let k = -3; k <= 0; k++) {
        g.line([0.6, Y(k)], [9.6, Y(k)], { color: alpha('muted', 0.2), width: 1 });
        g.text(`10${['⁻³', '⁻²', '⁻¹', '⁰'][k + 3]}`, [0.3, Y(k)], { size: 11, color: 'muted' });
      }
      g.path(s.div.filter((d) => d[0] >= t0).map((d) => [X(d[0]), Y(clamp(d[1], -3.5, 0.7))]), { color: 'coral', width: 3 });
      g.emoji('🦋', [1.4, 9.3], 24);
      g.emoji('🌪️', [8.8, 9.3], 24);
      const last = s.div[s.div.length - 1];
      if (last) g.dot([X(last[0]), Y(clamp(last[1], -3.5, 0.7))], 6, { color: 'coral' });
    }
  },
};
