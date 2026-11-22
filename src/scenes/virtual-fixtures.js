// Virtual fixtures: your hand says where to go (gold), the robot tool goes as
// close as it is ALLOWED to (pink). Every frame a tiny least-squares problem with
// rules ("not past this wall", "stay inside this tube") picks the allowed spot.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { dampedPinv, mvec, inv, T, mmul } from '../core/linalg.js';
import { planarFK, planarJacobian } from '../core/kinematics.js';
import { clamp, smoothstep } from '../core/random.js';

const B = [-4.2, -3, 4.2, 3];
const WALL = (() => { const n = [1, 0.45], l = Math.hypot(...n); const u = [n[0] / l, n[1] / l]; return { n: u, b: u[0] * 2.2 }; })();
const ZONE = { c: [-1.3, 1.25], r: 0.8 };
const tubeY = (x) => 1.0 * Math.sin(0.95 * x) - 0.2;
const TUBE_R = 0.42;
const TUBE = Array.from({ length: 161 }, (_, i) => { const x = -5 + (10 * i) / 160; return [x, tubeY(x)]; });
const ARM = { base: [-0.6, -2.85], L: [2.6, 2.2] };

// 2-D quadratic program by active-set enumeration:
//   min ½ xᵀHx − fᵀx   s.t.  aᵢ·x ≤ cᵢ
function qp2(H, f, cons) {
  const Hi = inv(H), obj = (x) => 0.5 * (x[0] * (H[0][0] * x[0] + H[0][1] * x[1]) + x[1] * (H[1][0] * x[0] + H[1][1] * x[1])) - f[0] * x[0] - f[1] * x[1];
  const x0 = mvec(Hi, f);
  const cands = [{ x: x0, act: [] }];
  cons.forEach((k, i) => {
    const Ha = mvec(Hi, k.a), den = k.a[0] * Ha[0] + k.a[1] * Ha[1];
    const m = (k.a[0] * x0[0] + k.a[1] * x0[1] - k.c) / den;
    cands.push({ x: [x0[0] - Ha[0] * m, x0[1] - Ha[1] * m], act: [i], lam: [m] });
  });
  for (let i = 0; i < cons.length; i++) for (let j = i + 1; j < cons.length; j++) {
    const a = cons[i].a, b = cons[j].a, d = a[0] * b[1] - a[1] * b[0];
    if (Math.abs(d) < 1e-9) continue;
    cands.push({ x: [(cons[i].c * b[1] - a[1] * cons[j].c) / d, (a[0] * cons[j].c - cons[i].c * b[0]) / d], act: [i, j] });
  }
  const viol = (x) => cons.reduce((m, k) => Math.max(m, k.a[0] * x[0] + k.a[1] * x[1] - k.c), 0);
  let best = null;
  for (const c of cands) { c.v = viol(c.x); c.o = obj(c.x); if (c.v < 1e-9 && (!best || c.o < best.o)) best = c; }
  if (!best) best = cands.reduce((a, b) => (b.v < a.v ? b : a));
  return best;
}

export default {
  eq: [
    [['x*', 'pink'], ' = argmin ‖x − ', ['x_des', 'gold'], '‖²   s.t.  ', ['nᵢ·x ≤ bᵢ', 'slate']],
    ['soft:  min ‖x − ', ['x_des', 'gold'], '‖² + ', ['w', 'orange'], ' Σ max(0, nᵢ·x − bᵢ)²     ', ['w', 'orange'], ' → ∞  = hard'],
    ['arm:  min ‖', ['J', 'blue'], ['q̇', 'orange'], ' − ', ['ẋ_des', 'gold'], '‖² + λ²‖', ['q̇', 'orange'], '‖²   s.t.  ', ['n·(x + J q̇ Δt) ≤ b', 'slate']],
    ['no rule active →  ', ['q̇', 'orange'], ' = ', ['J', 'blue'], 'ᵀ(', ['J', 'blue'], ['J', 'blue'], 'ᵀ + λ²I)⁻¹', ['ẋ_des', 'gold'], '   (damped pseudo-inverse)'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds(B);
    const s = {
      beat: 0, hand: [3.0, 0.6], tool: [-2.4, -1.2], trail: [], star: [0, 0], active: [], t: 0, idle: 0, held: false,
      wv: 0.6, q: [0.9, -1.0], qd: [0, 0], xdes: [0, 0], xact: [0, 0], depth: 0,
    };
    const W = () => { const v = s.wv; return v >= 0.995 ? Infinity : 10 ** (4 * v - 2); };

    // Constraints (n·x ≤ b), linearized at point p.
    const linCons = (p) => {
      if (s.beat === 1) {
        let bi = 0, bd = Infinity;
        TUBE.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
        const a = TUBE[Math.max(0, bi - 1)], b = TUBE[Math.min(TUBE.length - 1, bi + 1)];
        const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty), n = [-ty / tl, tx / tl], c = TUBE[bi];
        const nc = n[0] * c[0] + n[1] * c[1];
        return [{ a: n, c: nc + TUBE_R, kind: 'tube', at: c, n }, { a: [-n[0], -n[1]], c: -nc + TUBE_R, kind: 'tube', at: c, n: [-n[0], -n[1]] }];
      }
      const d = [p[0] - ZONE.c[0], p[1] - ZONE.c[1]], dl = Math.hypot(...d) || 1e-9, m = [d[0] / dl, d[1] / dl];
      // outside the circle: −m·x ≤ −(m·c + r)  (tangent half-plane)
      return [
        { a: WALL.n, c: WALL.b, kind: 'wall' },
        { a: [-m[0], -m[1]], c: -(m[0] * ZONE.c[0] + m[1] * ZONE.c[1] + ZONE.r), kind: 'zone', at: [ZONE.c[0] + m[0] * ZONE.r, ZONE.c[1] + m[1] * ZONE.r], n: m },
      ];
    };
    const I2 = [[1, 0], [0, 1]];
    const hardProject = (xd, p) => {
      let x = p, res = null;
      for (let it = 0; it < 3; it++) { res = qp2(I2, xd, linCons(x)); x = res.x; }
      return res;
    };
    const softProject = (xd, p) => {
      const w = W();
      if (!Number.isFinite(w)) return hardProject(xd, p);
      const cons = linCons(p);
      let x = xd.slice(), act = [];
      for (let it = 0; it < 4; it++) {
        act = cons.map((k, i) => (k.a[0] * x[0] + k.a[1] * x[1] > k.c ? i : -1)).filter((i) => i >= 0);
        const H = [[1, 0], [0, 1]], f = xd.slice();
        for (const i of act) { const a = cons[i].a; H[0][0] += w * a[0] * a[0]; H[0][1] += w * a[0] * a[1]; H[1][0] += w * a[1] * a[0]; H[1][1] += w * a[1] * a[1]; f[0] += w * cons[i].c * a[0]; f[1] += w * cons[i].c * a[1]; }
        x = mvec(inv(H), f);
      }
      return { x, act };
    };

    stage.handle({ pen: g, color: 'gold', icon: '✋', r: 17, get: () => s.hand,
      set: (p) => { s.hand = [clamp(p[0], B[0], B[2]), clamp(p[1], B[1], B[3])]; s.idle = 0; },
      onStart: () => (s.held = true), onEnd: () => { s.held = false; s.idle = 0; } });

    ui.beats(['🚫', '🛤️', '⚖️', '🦾'], (b) => {
      s.beat = b; s.trail = []; s.idle = 0;
      if (b === 1) { s.tool = [-3.4, tubeY(-3.4)]; s.hand = [-1.2, -1.6]; }
      else if (b === 3) { s.q = [1.75, -1.25]; s.tool = planarFK(ARM.L, s.q, ARM.base).tip; s.hand = [2.6, 0.2]; }
      else { s.tool = [-2.4, -1.2]; s.hand = [3.0, 0.6]; }
    });
    ui.slider({ icon: '⚖️', color: 'orange', min: 0, max: 1, step: 0.005, value: s.wv, title: 'soft ↔ hard', onInput: (v) => (s.wv = v) });
    ui.readout(() => (s.beat === 2 ? (Number.isFinite(W()) ? fmt(W(), W() < 1 ? 2 : 0) : '∞') : '∞'), { icon: '⚖️', color: 'orange', title: 'stiffness w' });
    ui.readout(() => fmt(s.depth, 2), { icon: '↧', color: 'coral', title: 'how far into the forbidden zone' });

    const autoHand = (t) => {
      if (s.beat === 1) { const x = 3.4 * Math.sin(0.42 * t); return [x, tubeY(x) + 1.3 * Math.sin(1.15 * t + 0.5)]; }
      if (s.beat === 3) return [0.4 + 2.1 * Math.sin(0.55 * t), -0.3 + 1.0 * Math.sin(0.83 * t + 1)];
      return [0.5 + 2.8 * Math.sin(0.5 * t), 0.1 + 2.0 * Math.sin(0.77 * t + 0.6)];
    };
    const depthOf = (x) => {
      if (s.beat === 1) { let bd = Infinity; for (const q of TUBE) bd = Math.min(bd, Math.hypot(q[0] - x[0], q[1] - x[1])); return Math.max(0, bd - TUBE_R); }
      return Math.max(0, x[0] * WALL.n[0] + x[1] * WALL.n[1] - WALL.b, ZONE.r - Math.hypot(x[0] - ZONE.c[0], x[1] - ZONE.c[1]));
    };

    return {
      update(dt) {
        s.t += dt; s.idle += dt;
        if (!s.held && s.idle > 3) {
          const k = smoothstep((s.idle - 3) / 1.5), tgt = autoHand(s.t);
          s.hand = [s.hand[0] + (tgt[0] - s.hand[0]) * 0.06 * (0.3 + k), s.hand[1] + (tgt[1] - s.hand[1]) * 0.06 * (0.3 + k)];
        }
        const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
        for (let it = 0; it < n; it++) {
          if (s.beat === 3) stepArm(h);
          else {
            const res = s.beat === 2 ? softProject(s.hand, s.tool) : hardProject(s.hand, s.tool);
            s.star = res.x; s.active = res.act;
            // tool chases the allowed spot (first-order, speed-limited), re-linearizing every substep
            const d = [s.star[0] - s.tool[0], s.star[1] - s.tool[1]], L = Math.hypot(...d), v = Math.min(5, 8 * L);
            const step = L > 1e-9 ? [(d[0] / L) * v * h, (d[1] / L) * v * h] : [0, 0];
            const cand = [s.tool[0] + step[0], s.tool[1] + step[1]];
            s.tool = s.beat === 2 ? cand : hardProject(cand, cand).x;
          }
        }
        s.depth = depthOf(s.tool);
        const lt = s.trail[s.trail.length - 1];
        if (!lt || Math.hypot(lt[0] - s.tool[0], lt[1] - s.tool[1]) > 0.04) s.trail.push(s.tool.slice());
        if (s.trail.length > 220) s.trail.shift();
      },
      draw() {
        g.grid({ step: 0.5, axes: false });
        if (s.beat === 1) drawTube(); else drawWallZone();
        if (s.beat === 3) return drawArm();
        g.path(s.trail, { color: alpha('pink', 0.45), width: 3 });
        // desired (gold) vs allowed (pink)
        g.line(s.tool, s.hand, { color: alpha('gold', 0.5), width: 2, dash: [3, 5] });
        g.arrow(s.tool, s.hand, { color: 'gold', width: 3.5, alpha: 0.85 });
        if (Math.hypot(s.star[0] - s.tool[0], s.star[1] - s.tool[1]) > 0.05) g.arrow(s.tool, s.star, { color: 'pink', width: 5 });
        const push = [s.star[0] - s.hand[0], s.star[1] - s.hand[1]], pl = Math.hypot(...push);
        if (pl > 0.05) g.vec(s.tool, [push[0] * 0.6, push[1] * 0.6], { color: 'coral', width: 3 });
        if (s.beat === 2 && s.depth > 0.01) {
          const cons = linCons(s.tool);
          for (const k of cons) {
            const over = k.a[0] * s.tool[0] + k.a[1] * s.tool[1] - k.c;
            if (over > 0.01) g.spring(s.tool, [s.tool[0] - k.a[0] * over, s.tool[1] - k.a[1] * over], { color: 'coral', width: 2.5, coils: 6 });
          }
        }
        g.dot(s.star, 6, { color: alpha('pink', 0.5) });
        g.dot(s.tool, 11, { color: 'pink', ring: 'bg', ringWidth: 3 });
      },
    };

    function stepArm(h) {
      const fk = planarFK(ARM.L, s.q, ARM.base), x = fk.tip;
      const J = planarJacobian(ARM.L, s.q, ARM.base);
      const e = [s.hand[0] - x[0], s.hand[1] - x[1]], el = Math.hypot(...e), sp = Math.min(3.5, 4 * el);
      const xdes = el > 1e-9 ? [(e[0] / el) * sp, (e[1] / el) * sp] : [0, 0];
      const lam = 0.12;
      // min ‖J q̇ − ẋ_des‖² + λ²‖q̇‖²  s.t.  n·(x + J q̇ h) ≤ b   (constraints on the tip, linearized)
      const H = mmul(T(J), J); H[0][0] += lam * lam; H[1][1] += lam * lam;
      const f = mvec(T(J), xdes);
      const q0 = mvec(dampedPinv(J, lam), xdes); // unconstrained answer
      const cons = linCons(x).map((k) => { const a = mvec(T(J), k.a).map((v) => v * h); return { a, c: k.c - (k.a[0] * x[0] + k.a[1] * x[1]) }; });
      // the elbow obeys the same rules (its Jacobian only feels joint 1)
      const eb = fk.points[1], Je = [[-ARM.L[0] * Math.sin(s.q[0]), 0], [ARM.L[0] * Math.cos(s.q[0]), 0]];
      for (const k of linCons(eb)) cons.push({ a: mvec(T(Je), k.a).map((v) => v * h), c: k.c - (k.a[0] * eb[0] + k.a[1] * eb[1]) });
      const res = qp2(H, f, cons);
      const qd = res.act.length ? res.x : q0;
      s.armAct = res.act.some((i) => i < 2);
      s.qd = qd; s.xdes = xdes; s.xact = mvec(J, qd); s.active = res.act;
      s.q = [s.q[0] + qd[0] * h, s.q[1] + qd[1] * h];
      s.tool = planarFK(ARM.L, s.q, ARM.base).tip;
    }

    function drawWallZone() {
      // half-plane wall with hatching on the forbidden side
      const n = WALL.n, t = [-n[1], n[0]], p0 = [n[0] * WALL.b, n[1] * WALL.b];
      const a = [p0[0] - t[0] * 8, p0[1] - t[1] * 8], b = [p0[0] + t[0] * 8, p0[1] + t[1] * 8];
      g.clip(() => {
        g.poly([a, b, [b[0] + n[0] * 8, b[1] + n[1] * 8], [a[0] + n[0] * 8, a[1] + n[1] * 8]], { fill: alpha('slate', s.beat === 2 ? 0.28 : 0.4), stroke: false });
        for (let k = -16; k <= 16; k++) {
          const q = [p0[0] + t[0] * k * 0.4, p0[1] + t[1] * k * 0.4];
          g.line(q, [q[0] + n[0] * 3 + t[0] * 1.2, q[1] + n[1] * 3 + t[1] * 1.2], { color: alpha('slate', 0.45), width: 2 });
        }
      });
      const wallHot = s.beat !== 1 && s.depth < 0.02 && s.tool[0] * n[0] + s.tool[1] * n[1] > WALL.b - 0.03;
      g.line(a, b, { color: wallHot ? 'coral' : 'slate', width: 5 });
      const zd = Math.hypot(s.tool[0] - ZONE.c[0], s.tool[1] - ZONE.c[1]);
      g.circle(ZONE.c, ZONE.r, { fill: alpha('slate', s.beat === 2 ? 0.35 : 0.55), color: zd < ZONE.r + 0.03 ? 'coral' : 'slate', width: 4 });
      g.emoji('🚫', ZONE.c, Math.max(18, g.px(ZONE.r) * 0.8));
    }

    function drawTube() {
      const up = TUBE.map(([x, y], i) => { const a = TUBE[Math.max(0, i - 1)], b = TUBE[Math.min(TUBE.length - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty); return [x - (ty / l) * TUBE_R, y + (tx / l) * TUBE_R]; });
      const dn = TUBE.map(([x, y], i) => { const a = TUBE[Math.max(0, i - 1)], b = TUBE[Math.min(TUBE.length - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty); return [x + (ty / l) * TUBE_R, y - (tx / l) * TUBE_R]; });
      g.clip(() => {
        g.poly([...up, ...dn.slice().reverse()], { fill: alpha('lime', 0.16), stroke: false });
        g.path(TUBE, { color: alpha('lime', 0.7), width: 2, dash: [8, 6] });
        g.path(up, { color: 'slate', width: 4 });
        g.path(dn, { color: 'slate', width: 4 });
      });
    }

    function drawArm() {
      const fk = planarFK(ARM.L, s.q, ARM.base);
      g.path(s.trail, { color: alpha('pink', 0.45), width: 3 });
      g.arm(fk.points, { width: 16 });
      // joint speeds as little arcs
      for (let i = 0; i < 2; i++) {
        const sweep = clamp(s.qd[i] * 0.5, -2, 2);
        if (Math.abs(sweep) > 0.02) g.arc(fk.points[i], 0.6, fk.angles[i], fk.angles[i] + sweep, { color: 'orange', width: 6 });
      }
      const x = fk.tip, sc = 0.45;
      g.line(x, s.hand, { color: alpha('gold', 0.5), width: 2, dash: [3, 5] });
      g.vec(x, [s.xdes[0] * sc, s.xdes[1] * sc], { color: 'gold', width: 4 });
      g.vec(x, [s.xact[0] * sc, s.xact[1] * sc], { color: 'pink', width: 5 });
      if (s.armAct) g.vec(x, [(s.xact[0] - s.xdes[0]) * sc, (s.xact[1] - s.xdes[1]) * sc], { color: 'coral', width: 3 });
      g.dot(x, 9, { color: 'pink', ring: 'bg', ringWidth: 3 });
      void C;
    }
  },
};
