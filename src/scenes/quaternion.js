// Quaternions: a turn written as 4 numbers (w, x, y, z) that live on a ball
// in 4D. Their secret: they go around TWICE for every one turn of the toy —
// that's why a ribbon tied to a spinning plate is tangled after one turn
// but magically untangles after two.
import { View3D } from '../viz/view3d.js';
import { C, alpha } from '../viz/palette.js';
import { qmul, qFromAxisAngle, qToMat, qRotate, slerp, eulerZYX, qFromMat, qnormalize } from '../core/lie.js';
import { vnormalize } from '../core/linalg.js';
import { smoothstep, clamp, rng } from '../core/random.js';
import { fmt } from '../viz/ui.js';

// Toy airplane made of boxes (body frame: x = nose, y = left wing, z = up).
export function toyPlane(v, R, p, o = {}) {
  const at = (l) => [0, 1, 2].map((i) => p[i] + R[i][0] * l[0] + R[i][1] * l[1] + R[i][2] * l[2]);
  const a = o.alpha ?? 1, k = o.scale ?? 1;
  v.box(R, p, [0.75 * k, 0.13 * k, 0.13 * k], { color: o.body ?? 'slate', alpha: a });
  v.box(R, at([0.05 * k, 0, 0]), [0.22 * k, 0.85 * k, 0.03 * k], { color: o.wing ?? 'blue', alpha: a });
  v.box(R, at([-0.62 * k, 0, 0.18 * k]), [0.1 * k, 0.03 * k, 0.2 * k], { color: o.tail ?? 'orange', alpha: a });
  v.box(R, at([-0.62 * k, 0, 0.02 * k]), [0.08 * k, 0.3 * k, 0.02 * k], { color: o.wing ?? 'blue', alpha: a });
  v.sphere(at([0.8 * k, 0, 0]), 0.1 * k, { color: o.nose ?? 'pink', alpha: a });
}

// Four bars: w (ink) x (red) y (green) z (blue), each in [−1, 1].
function qBars(ctx, X, Y, q, label, o = {}) {
  const bw = o.bw ?? 14, gap = 5, H = o.h ?? 34, cols = ['ink', 'red', 'green', 'blue'];
  const W = 4 * bw + 3 * gap + 16;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92); ctx.beginPath(); ctx.roundRect(X, Y, W, 2 * H + 34, 10); ctx.fill();
  if (o.ring) { ctx.strokeStyle = C[o.ring]; ctx.lineWidth = 2; ctx.stroke(); }
  const mid = Y + 24 + H;
  ctx.strokeStyle = alpha('muted', 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X + 6, mid); ctx.lineTo(X + W - 6, mid); ctx.stroke();
  q.forEach((x, i) => {
    const h = clamp(x, -1, 1) * H, bx = X + 8 + i * (bw + gap);
    ctx.fillStyle = C[cols[i]]; ctx.beginPath(); ctx.roundRect(bx, Math.min(mid, mid - h), bw, Math.max(Math.abs(h), 1.5), 3); ctx.fill();
  });
  ctx.font = '800 15px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = C[o.color ?? 'ink']; ctx.fillText(label, X + W / 2, Y + 12);
  ctx.restore();
  return W;
}

export default {
  eq: [
    [['q', 'ink'], ' = (cos ½θ,  ', ['n', 'orange'], ' sin ½θ)   =  (', ['w', 'ink'], ', ', ['x', 'red'], ', ', ['y', 'green'], ', ', ['z', 'blue'], ')     |q| = 1'],
    ['θ = 360°  ⇒  ', ['q', 'ink'], ' = −1   (🎀 still twisted)      θ = 720°  ⇒  ', ['q', 'ink'], ' = +1   (🎀 free)'],
    [['q', 'ink'], ' and ', ['−q', 'purple'], ' give the same turn:  R(q) = R(−q)'],
    ['slerp(', ['q₀', 'ink'], ', ', ['q₁', 'gold'], ', t) = ', ['q₀', 'ink'], '(', ['q₀', 'ink'], '⁻¹', ['q₁', 'gold'], ')ᵗ  — ', ['smooth arc', 'lime'], ';  Euler-angle blend ', ['wobbles', 'coral']],
    ['first ', ['q₁', 'blue'], ' then ', ['q₂', 'red'], ':   ', ['q', 'gold'], ' = ', ['q₂', 'red'], ' ', ['q₁', 'blue'], '     v′ = q v q⁻¹'],
  ],
  setup({ stage, ui }) {
    const pen = stage.g;
    const v = new View3D(pen, { yaw: -0.75, pitch: 0.32, dist: 6.4, target: [0, 0, 1.1] });
    const R = rng(11);
    const s = {
      beat: 0, t: 0, turns: 2, theta: 0, thetaHeld: false,
      qA: [1, 0, 0, 0], qB: qFromMat(eulerZYX(2.88, 1.26, 2.73)),
      a1: Math.PI / 2, a2: Math.PI / 2,
    };

    const groups = [ui.group(), ui.group(), ui.group(), ui.group()];
    // controls not used in this beat are taken out of the dock (not just hidden)
    const showBeat = (b) => { groups.forEach((el) => el.remove()); ui.dock.appendChild(groups[b]); };
    ui.choice({ into: groups[0], value: 2, color: 'pink', options: [{ icon: '1️⃣', value: 1, title: 'one full turn' }, { icon: '2️⃣', value: 2, title: 'two full turns' }], onChange: (x) => { s.turns = x; s.t = 0; } });
    ui.readout(() => `${fmt(s.spin / (2 * Math.PI), 2)}`, { icon: '🔄', color: 'orange', title: 'turns of the plate', into: groups[0] });
    ui.button({ icon: '🎲', title: 'new target pose', into: groups[1], onClick: () => {
      // pick a target where the two routes really differ
      for (let k = 0; k < 60; k++) {
        s.qB = qFromMat(eulerZYX(R.uniform(-3, 3), R.uniform(-1.3, 1.3), R.uniform(-3, 3)));
        const r = routes(); if (r.lenE / r.lenS > 1.15 && r.lenS > 1) break;
      }
      s.t = 0;
    } });
    ui.readout(() => fmt(s.lenS ?? 0, 2), { icon: '📏', color: 'lime', title: 'nose path length (slerp)', into: groups[1] });
    ui.readout(() => fmt(s.lenE ?? 0, 2), { icon: '📏', color: 'coral', title: 'nose path length (Euler blend)', into: groups[1] });
    const thSl = ui.slider({ icon: '🔄', color: 'orange', min: 0, max: 4 * Math.PI, step: 0.01, value: 0, title: 'turn angle (0 … 720°)', into: groups[2], onInput: (x) => { s.theta = x; s.thetaHeld = true; } });
    ui.button({ icon: '🎬', title: 'auto spin', into: groups[2], onClick: () => (s.thetaHeld = false) });
    ui.readout(() => `${Math.round((s.theta * 180) / Math.PI)}°`, { icon: '📐', color: 'orange', title: 'turn angle', into: groups[2] });
    ui.slider({ icon: '🔵', color: 'blue', min: -Math.PI, max: Math.PI, step: 0.01, value: s.a1, title: 'first turn (about z)', into: groups[3], onInput: (x) => (s.a1 = x) });
    ui.slider({ icon: '🔴', color: 'red', min: -Math.PI, max: Math.PI, step: 0.01, value: s.a2, title: 'second turn (about x)', into: groups[3], onInput: (x) => (s.a2 = x) });
    ui.beats(['🎀', '🛣️', '⚖️', '🧮'], (b) => { s.beat = b; s.t = 0; showBeat(b); v.target = b === 0 ? [0, 0, 1.1] : [0, 0, 0.1]; v.dist = b === 0 ? 6.4 : 5.4; });
    showBeat(0);
    s.spin = 0;

    // ------------------------------------------------------------ belt trick
    // The ribbon is a path of turns q(s), s∈[0,1], from the fixed base (q = 1) to the plate.
    // Its centre line follows its own "up" arrow, so the ribbon really bends.
    function beltState(T) {
      const N = s.turns, spinT = 2.2 * N, hold = 0.8, untw = 3.2, back = 1.4;
      const P = spinT + hold + untw + hold + untw * 0.6 + back + spinT * 0.5 + 0.4;
      const t = T % P;
      let theta = 0, beta = 0;
      const t1 = spinT, t2 = t1 + hold, t3 = t2 + untw, t4 = t3 + hold, t5 = t4 + untw * 0.6, t6 = t5 + spinT * 0.5;
      if (t < t1) theta = 2 * Math.PI * N * smoothstep(t / t1);
      else if (t < t2) theta = 2 * Math.PI * N;
      else if (t < t3) { theta = 2 * Math.PI * N; beta = (Math.PI / 2) * smoothstep((t - t2) / untw); }
      else if (t < t4) { theta = 2 * Math.PI * N; beta = Math.PI / 2; }
      else if (t < t5) { theta = 2 * Math.PI * N; beta = (Math.PI / 2) * (1 - smoothstep((t - t4) / (untw * 0.6))); }
      else if (t < t6) theta = 2 * Math.PI * N * (1 - smoothstep((t - t5) / (spinT * 0.5)));
      return { theta, beta, done: t >= t3 && t < t4 };
    }
    function ribbonQ(sv, theta, beta) {
      const N = s.turns;
      if (beta === 0) return qFromAxisAngle([0, 0, 1], sv * theta);
      if (N === 2) {
        // a family of loops on the 4D ball, shrinking to a point (always starting/ending at q = 1)
        const sb = Math.sin(beta), cb = Math.cos(beta), ph = 2 * Math.PI * sv;
        return qnormalize([sb * sb + cb * cb * Math.cos(ph), sb * cb - sb * cb * Math.cos(ph), 0, cb * Math.sin(ph)]);
      }
      // one turn: q must end at −1 — the half-loop can swing but never shrink away
      const a = Math.PI * sv;
      return [Math.cos(a), Math.sin(beta) * Math.sin(a), 0, Math.cos(beta) * Math.sin(a)];
    }
    function drawBelt() {
      const { theta, beta, done } = beltState(s.t);
      s.spin = theta;
      const H = 2.4, n = 48, w = 0.32;
      const fwd = v._b.fwd;
      let p = [0, 0, 0.25];
      const pts = [p.slice()], qs = [ribbonQ(0, theta, beta)];
      for (let k = 0; k < n; k++) {
        const q = ribbonQ((k + 0.5) / n, theta, beta), tg = qRotate(q, [0, 0, 1]);
        p = p.map((x, i) => x + (tg[i] * H) / n);
        pts.push(p.slice()); qs.push(ribbonQ((k + 1) / n, theta, beta));
      }
      // base
      v.box([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0.12], [0.6, 0.6, 0.12], { color: 'slate' });
      for (let k = 0; k < n; k++) {
        const x0 = qRotate(qs[k], [w, 0, 0]), x1 = qRotate(qs[k + 1], [w, 0, 0]);
        const nn = qRotate(qs[k], [0, 1, 0]);
        const front = nn[0] * fwd[0] + nn[1] * fwd[1] + nn[2] * fwd[2] < 0;
        const a = pts[k], b = pts[k + 1];
        v.poly([[a[0] - x0[0], a[1] - x0[1], a[2] - x0[2]], [a[0] + x0[0], a[1] + x0[1], a[2] + x0[2]], [b[0] + x1[0], b[1] + x1[1], b[2] + x1[2]], [b[0] - x1[0], b[1] - x1[1], b[2] - x1[2]]],
          { color: front ? 'pink' : 'teal', shade: false, stroke: alpha('bg', 0.35) });
      }
      // plate at the end of the ribbon
      const qe = qs[n], Rm = qToMat(qe), tip = pts[n];
      const up = [Rm[0][2], Rm[1][2], Rm[2][2]];
      const c = tip.map((x, i) => x + up[i] * 0.06);
      v.box(Rm, c, [0.5, 0.5, 0.05], { color: 'orange' });
      const nose = [Rm[0][0], Rm[1][0], Rm[2][0]];
      v.arrow(c.map((x, i) => x + up[i] * 0.08), c.map((x, i) => x + up[i] * 0.08 + nose[i] * 0.65), { color: 'red', width: 4 });
      if (beta > 0 && done) v.text(s.turns === 2 ? '🎉' : '😵', [tip[0], tip[1], tip[2] + 0.8], { size: 34 });
      // the plate's quaternion: w goes 1 → −1 → 1 over two turns
      const qp = qFromAxisAngle([0, 0, 1], theta);
      return () => { const w = qBars(stage.hud.ctx, 14, 14, qp, 'q', { color: qp[0] < -0.5 ? 'purple' : 'ink' }); turnClock(stage.hud.ctx, 14 + w + 8, 14, theta); };
    }
    // two clocks: the plate goes around once per 360°, q goes around once per 720°
    function turnClock(ctx, X, Y, theta, icon = '🍽️') {
      ctx.save();
      ctx.fillStyle = alpha('panel', 0.92); ctx.beginPath(); ctx.roundRect(X, Y, 150, 102, 10); ctx.fill();
      const dial = (cx, a, colr, icon, neg) => {
        const cy = Y + 58, r = 26;
        ctx.strokeStyle = alpha('muted', 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = C[colr]; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + r * Math.sin(a), cy - r * Math.cos(a)); ctx.stroke();
        ctx.fillStyle = C[colr]; ctx.beginPath(); ctx.arc(cx + r * Math.sin(a), cy - r * Math.cos(a), 5, 0, Math.PI * 2); ctx.fill();
        if (neg) { ctx.strokeStyle = C.purple; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx - r * Math.sin(a), cy + r * Math.cos(a), 5, 0, Math.PI * 2); ctx.stroke(); }
        ctx.font = '16px system-ui, "Noto Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.ink;
        ctx.fillText(icon, cx, Y + 16);
      };
      dial(X + 40, theta, 'orange', icon);
      dial(X + 110, theta / 2, 'ink', '🌐', true);
      ctx.restore();
    }

    // ------------------------------------------------------------ slerp vs Euler blend
    function eulerOf(q) {
      const Rm = qToMat(q);
      return [Math.atan2(Rm[1][0], Rm[0][0]), Math.asin(clamp(-Rm[2][0], -1, 1)), Math.atan2(Rm[2][1], Rm[2][2])];
    }
    function sphereWire(r) {
      for (let k = -2; k <= 2; k++) { const z = (k / 3) * r, rr = Math.sqrt(r * r - z * z); v.circle([0, 0, z], [0, 0, 1], rr, { color: alpha('muted', 0.22), width: 1 }); }
      for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 6; v.circle([0, 0, 0], [Math.cos(a), Math.sin(a), 0], r, { color: alpha('muted', 0.22), width: 1 }); }
    }
    const NOSE_R = 1.5;
    function routes() {
      const r = NOSE_R, eA = eulerOf(s.qA), eB = eulerOf(s.qB);
      const RS = (t) => qToMat(slerp(s.qA, s.qB, t));
      const RE = (t) => eulerZYX(eA[0] + (eB[0] - eA[0]) * t, eA[1] + (eB[1] - eA[1]) * t, eA[2] + (eB[2] - eA[2]) * t);
      const noseOf = (Rm) => [Rm[0][0] * r, Rm[1][0] * r, Rm[2][0] * r];
      const ps = [], pe = [];
      for (let k = 0; k <= 60; k++) { ps.push(noseOf(RS(k / 60))); pe.push(noseOf(RE(k / 60))); }
      const L = (P) => P.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - P[k][0], p[1] - P[k][1], p[2] - P[k][2]), 0);
      return { RS, RE, noseOf, ps, pe, lenS: L(ps) / r, lenE: L(pe) / r };
    }
    function drawSlerp() {
      const r = NOSE_R, { RS, RE, noseOf, ps, pe, lenS, lenE } = routes();
      s.lenS = lenS; s.lenE = lenE;
      sphereWire(r);
      v.path(pe, { color: 'coral', width: 4 });
      v.path(ps, { color: 'lime', width: 4 });
      v.point(ps[0], 7, { color: 'ink' });
      v.point(ps[60], 8, { color: 'gold', ring: 'bg' });
      // fly one plane at a time: first the slerp one, then the Euler-blend one
      const T = s.t % 10, euler = T >= 5, k = smoothstep(((T % 5) - 0.5) / 3);
      const Rk = euler ? RE(k) : RS(k), nose = noseOf(Rk), c = euler ? 'coral' : 'lime';
      if (euler) toyPlane(v, Rk, [0, 0, 0], { body: 'coral', nose: 'coral', scale: 0.8 });
      else toyPlane(v, Rk, [0, 0, 0], { scale: 0.8 });
      v.line([Rk[0][0] * 0.72, Rk[1][0] * 0.72, Rk[2][0] * 0.72], nose, { color: c, width: 2, dash: [3, 3] });
      v.point(nose, 8, { color: c, ring: 'bg' });
      v.text('🎯', [ps[60][0] * 1.18, ps[60][1] * 1.18, ps[60][2] * 1.18 + 0.1], { size: 22 });
    }

    // ------------------------------------------------------------ q and −q
    function drawDouble() {
      const axis = vnormalize([0.35, -0.3, 1]);
      const th = s.theta;
      const q = qFromAxisAngle(axis, th), nq = q.map((x) => -x);
      v.line(axis.map((x) => -x * 2), axis.map((x) => x * 2), { color: 'orange', width: 2, dash: [6, 5] });
      const Rm = qToMat(q);
      toyPlane(v, Rm, [0, 0, 0]);
      // a sweep wedge showing how far it has turned (mod 360)
      v.circle([0, 0, 0], axis, 1.3, { color: alpha('orange', 0.6), width: 3, from: 0, to: th % (2 * Math.PI), segments: 60 });
      return () => {
        const ctx = stage.hud.ctx;
        const w1 = qBars(ctx, 14, 14, q, 'q');
        qBars(ctx, 14 + w1 + 8, 14, nq, '−q', { color: 'purple' });
        turnClock(ctx, 14, 124, th, '✈️');
      };
    }

    // ------------------------------------------------------------ composition
    function drawCompose() {
      const q1 = qFromAxisAngle([0, 0, 1], s.a1), q2 = qFromAxisAngle([1, 0, 0], s.a2), q = qmul(q2, q1);
      const T = s.t % 7.5, I = [1, 0, 0, 0];
      let Rm, ghost = null;
      if (T < 1.6) Rm = qToMat(slerp(I, q1, smoothstep(T / 1.4)));
      else if (T < 3.4) Rm = qToMat(qmul(slerp(I, q2, smoothstep((T - 1.6) / 1.4)), q1));
      else { Rm = qToMat(q); ghost = qToMat(slerp(I, q, smoothstep((T - 4.0) / 1.8))); }
      v.line([0, 0, -1.8], [0, 0, 1.8], { color: alpha('blue', 0.5), width: 2, dash: [5, 5] });
      v.line([-1.8, 0, 0], [1.8, 0, 0], { color: alpha('red', 0.5), width: 2, dash: [5, 5] });
      toyPlane(v, Rm, [0, 0, 0], { alpha: ghost ? 0.45 : 1 });
      if (ghost) {
        const vecp = q.slice(1), sn = Math.hypot(...vecp);
        if (sn > 1e-6) { const ax = vecp.map((x) => (x / sn) * 2); v.line(ax.map((x) => -x), ax, { color: 'gold', width: 3 }); }
        toyPlane(v, ghost, [0, 0, 0], { wing: 'gold' });
      }
      return () => {
        const ctx = stage.hud.ctx;
        let x = 14;
        x += qBars(ctx, x, 14, q1, 'q₁', { color: 'blue', ring: T < 1.6 ? 'blue' : null }) + 6;
        x += qBars(ctx, x, 14, q2, 'q₂', { color: 'red', ring: T >= 1.6 && T < 3.4 ? 'red' : null }) + 6;
        qBars(ctx, x, 14, q, 'q₂q₁', { color: 'gold', ring: ghost ? 'gold' : null });
      };
    }

    return {
      update(dt) {
        s.t += dt; v.tick(dt);
        if (s.beat === 2 && !s.thetaHeld) { s.theta = (s.theta + dt * 1.3) % (4 * Math.PI); thSl.set(s.theta); }
      },
      draw() {
        v.begin();
        v.floor(2.5, 0.5);
        let hud = null;
        if (s.beat === 0) hud = drawBelt();
        else {
          v.frame([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0], 1.0, { alpha: 0.25, width: 2 });
          hud = s.beat === 1 ? drawSlerp() : s.beat === 2 ? drawDouble() : drawCompose();
        }
        v.flush();           // 3D first, then the flat HUD on top
        hud?.();
      },
    };
  },
};
