// Impedance control: the hand is tied to the gold target by an invisible
// spring (teal) and shock absorber (purple), made by the motors:
//   τ = Jᵀ( K (x_d − x) − D ẋ ) + g(q)
// Poke it and it springs back; push it into a wall and it pushes with K × (how far);
// a soft hand can hold an egg 🥚, a stiff one cracks it 🍳.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rk4, twoLink, twoLinkG, twoLinkDeriv } from '../core/dynamics.js';
import { planarFK, planarJacobian, twoLinkIK } from '../core/kinematics.js';
import { mvec, T } from '../core/linalg.js';
import { clamp } from '../core/random.js';

const H = 0.001, L = [twoLink.l1, twoLink.l2], RH = 0.05;
const WALL_X = 1.5, K_WALL = 4000, B_WALL = 40;
const EGG_R = 0.16, K_EGG = 2500, B_EGG = 20, CRACK = 35;

function makeArm(base, xd) {
  const q = twoLinkIK(L[0], L[1], xd[0] - base[0], xd[1] - base[1], false) ?? [0.3, -0.8];
  return { base, x: [...q, 0, 0], xd: xd.slice(), Fc: [0, 0], egg: null, trace: [], fh: [] };
}

export default {
  eq: [
    [['τ', 'ink'], ' = Jᵀ( ', ['K', 'teal'], '(', ['x_d', 'gold'], ' − ', ['x', 'pink'], ') − ', ['D', 'purple'], ' ', ['ẋ', 'pink'], ' ) + ', ['g(q)', 'green']],
    ['the hand behaves like:   ', ['F_ext', 'coral'], ' = ', ['K', 'teal'], ' Δx + ', ['D', 'purple'], ' Δẋ  (+ Λ Δẍ)'],
    [['K', 'teal'], ' = diag(', ['Kₓ', 'teal'], ', ', ['K_y', 'teal'], ')   →   push ', ['F', 'coral'], ' ⇒ move ', ['Δx', 'pink'], ' = ', ['K', 'teal'], '⁻¹', ['F', 'coral'], '  (not parallel!)'],
    ['wall:  ', ['F_wall', 'coral'], ' ≈ ', ['K', 'teal'], ' · (how far the target is inside)'],
  ],
  setup({ stage, ui }) {
    const A = stage.g;
    const s = { beat: 0, kx: 300, ky: 300, d: 25, t: 0, poke: null, poking: false, lastS: 0 };
    let arms = [makeArm([0, 0], [1.15, 0.25])];
    const view = (b) => A.setBounds(b === 3 ? [-0.45, -1.35, 5.75, 1.25] : b === 1 ? [-0.5, -1.35, 2.7, 1.45] : [-0.6, -1.4, 2.3, 1.5]);
    view(0);

    const hand = (a) => { const t = planarFK(L, [a.x[0], a.x[1]], a.base).tip; return t; };
    stage.handle({
      pen: A, color: 'gold', r: 12, kind: 'ring',
      visible: () => s.beat !== 3,
      get: () => arms[0].xd,
      set: (p) => {
        const r = Math.hypot(p[0], p[1]), k = r > 1.95 ? 1.95 / r : r < 0.3 ? 0.3 / Math.max(r, 1e-6) : 1;
        arms[0].xd = [p[0] * k, p[1] * k];
      },
    });
    stage.handle({
      pen: A, color: 'pink', r: 12,
      visible: () => s.beat !== 3,
      get: () => (s.poking && s.poke ? s.poke : hand(arms[0])),
      set: (p) => (s.poke = p),
      onStart: () => { s.poking = true; s.poke = hand(arms[0]); },
      onEnd: () => { s.poking = false; s.poke = null; },
    });
    const kxS = ui.slider({ icon: '↔️', title: 'stiffness x', color: 'teal', min: 20, max: 1200, step: 5, value: s.kx, onInput: (v) => (s.kx = v) });
    const kyS = ui.slider({ icon: '↕️', title: 'stiffness y', color: 'teal', min: 20, max: 1200, step: 5, value: s.ky, onInput: (v) => (s.ky = v) });
    const dS = ui.slider({ icon: '🛞', title: 'damping', color: 'purple', min: 0, max: 60, step: 0.5, value: s.d, onInput: (v) => (s.d = v) });
    ui.beats(['🫧', '🧱', '🏈', '🥚'], (i) => {
      s.beat = i; s.t = 0; view(i);
      const set = (kx, ky, d) => { s.kx = kx; s.ky = ky; s.d = d; kxS.set(kx); kyS.set(ky); dS.set(d); };
      if (i === 0) { set(300, 300, 25); arms = [makeArm([0, 0], [1.15, 0.25])]; }
      if (i === 1) { set(300, 300, 25); arms = [makeArm([0, 0], [1.3, 0.2])]; arms[0].xd = [1.8, 0.2]; }
      if (i === 2) { set(700, 90, 18); arms = [makeArm([0, 0], [1.15, 0.0])]; }
      if (i === 3) {
        arms = [makeArm([0, 0], [1.3, -0.2]), makeArm([2.9, 0], [4.2, -0.2])];
        arms[0].kk = 80; arms[1].kk = 900;
        arms.forEach((a) => (a.egg = { c: [a.base[0] + 1.3, -0.78], broken: 0 }));
      }
    });
    ui.readout(() => fmt(Math.hypot(...arms[0].Fc), 0), { icon: '💥', color: 'coral', title: 'push force' });

    const contact = (a, x, v) => {
      let F = [0, 0];
      if (s.beat === 1) {
        const pen = x[0] + RH - WALL_X;
        if (pen > 0) F[0] = -Math.max(0, K_WALL * pen + B_WALL * v[0]);
      }
      if (a.egg && !a.egg.broken) {
        const d = [x[0] - a.egg.c[0], x[1] - a.egg.c[1]], r = Math.hypot(d[0], d[1]) || 1e-9;
        const pen = EGG_R + RH - r;
        if (pen > 0) {
          const n = [d[0] / r, d[1] / r], vn = v[0] * n[0] + v[1] * n[1];
          const f = Math.max(0, K_EGG * pen - B_EGG * vn);
          F = [F[0] + f * n[0], F[1] + f * n[1]];
        }
      }
      return F;
    };

    const step = (a, n) => {
      const kx = a.kk ?? s.kx, ky = a.kk ?? s.ky, d = a.kk ? 2 * Math.sqrt(a.kk) * 1.0 : s.d;
      let Fext = [0, 0];
      if (a === arms[0] && s.poking && s.poke) { const h = hand(a); Fext = [(s.poke[0] - h[0]) * 90, (s.poke[1] - h[1]) * 90]; }
      if (s.beat === 2 && !s.poking) Fext = [30 * Math.cos(1.3 * s.t), 30 * Math.sin(1.3 * s.t)];
      a.Fext = Fext;
      const law = (t, q, qd) => {
        const J = planarJacobian(L, q, a.base), x = planarFK(L, q, a.base).tip, v = mvec(J, qd);
        const Fc = contact(a, x, v);
        a.FcNow = Fc;
        const F = [kx * (a.xd[0] - x[0]) - d * v[0] + Fext[0] + Fc[0], ky * (a.xd[1] - x[1]) - d * v[1] + Fext[1] + Fc[1]];
        const tq = mvec(T(J), F), G = twoLinkG(twoLink, q);
        return [tq[0] + G[0], tq[1] + G[1]];
      };
      const f = twoLinkDeriv(twoLink, law, 0.2);
      for (let k = 0; k < n; k++) a.x = rk4(f, 0, a.x, H);
      // contact force at the final state (for display / egg cracking)
      law(0, [a.x[0], a.x[1]], [a.x[2], a.x[3]]);
      a.Fc = a.FcNow;
      if (a.egg) {
        if (!a.egg.broken && Math.hypot(...a.Fc) > CRACK) a.egg.broken = 2.4;
      }
    };

    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        const n = Math.min(120, Math.round(dt / H));
        s.t += dt;
        if (s.beat === 3) {
          const press = 0.5 - 0.5 * Math.cos(s.t * 1.6);
          arms.forEach((a) => { a.xd = [a.egg.c[0], a.egg.c[1] + EGG_R + 0.28 - 0.62 * press]; });
          arms.forEach((a) => { if (a.egg.broken) { a.egg.broken = Math.max(0, a.egg.broken - dt); } });
        }
        arms.forEach((a) => step(a, n));
        if (s.t - s.lastS > 1 / 30 || s.t < s.lastS) {
          s.lastS = s.t;
          arms.forEach((a) => {
            a.trace.push(hand(a)); if (a.trace.length > 160) a.trace.shift();
            a.fh.push(Math.hypot(...a.Fc) + Math.hypot(...(a.Fext ?? [0, 0])) * (s.beat === 0 ? 1 : 0)); if (a.fh.length > 150) a.fh.shift();
          });
        }
      },
      draw() {
        A.grid({ step: 0.25 });
        const [vx0, vy0, vx1, vy1] = A.view;
        if (s.beat === 1) {
          A.rect(WALL_X, vy0, vx1 - WALL_X, vy1 - vy0, { fill: alpha('slate', 0.3), stroke: false });
          A.line([WALL_X, vy0], [WALL_X, vy1], { color: 'slate', width: 4 });
          A.emoji('🧱', [WALL_X + 0.35, 1.15], 28);
        }
        arms.forEach((a, idx) => {
          const pts = planarFK(L, [a.x[0], a.x[1]], a.base).points, h = pts[2];
          const kx = a.kk ?? s.kx, ky = a.kk ?? s.ky;
          if (a.egg) drawEgg(A, a.egg);
          // stiffness ellipse at the target: long where it is stiff
          const kr = (k) => 0.05 + 0.33 * Math.sqrt(k / 1200);
          A.ellipse(a.xd, kr(kx), kr(ky), 0, { color: alpha('teal', 0.7), width: 2, fill: alpha('teal', 0.1) });
          if (s.beat === 2) {
            // where a 20 N push can move the hand: Δx = K⁻¹F (compliance ellipse)
            A.ellipse(a.xd, 30 / kx, 30 / ky, 0, { color: alpha('pink', 0.6), width: 2, dash: [5, 4] });
            A.path(a.trace.slice(-90), { color: alpha('pink', 0.8), width: 2.5 });
          }
          // virtual spring + damper between target and hand (side by side)
          const dx = h[0] - a.xd[0], dy = h[1] - a.xd[1], len = Math.hypot(dx, dy);
          if (len > 0.03) {
            const nx = (-dy / len) * 0.045, ny = (dx / len) * 0.045;
            A.spring([a.xd[0] + nx, a.xd[1] + ny], [h[0] + nx, h[1] + ny], { color: 'teal', width: 2.5, coils: 6 });
            A.damper([a.xd[0] - nx, a.xd[1] - ny], [h[0] - nx, h[1] - ny], { color: 'purple' });
          }
          A.arm(pts, { width: 15 });
          // forces at the hand
          const Fe = a.Fext ?? [0, 0];
          if (Math.hypot(...Fe) > 0.5) A.vec(h, [Fe[0] * 0.012, Fe[1] * 0.012], { color: 'coral', width: 4 });
          if (Math.hypot(...a.Fc) > 0.5) A.vec(h, [clamp(a.Fc[0] * 0.004, -1.2, 1.2), clamp(a.Fc[1] * 0.004, -1.2, 1.2)], { color: 'coral', width: 5 });
          A.dot(a.xd, 7, { color: 'gold', ring: 'bg' });
          // force meter for this arm (top-left)
          const fmax = s.beat === 3 ? 70 : 300, W = 150;
          const fval = Math.hypot(...a.Fc) + (s.beat === 0 || s.beat === 2 ? Math.hypot(...Fe) : 0);
          A.meter(s.beat === 3 ? (idx === 0 ? '🧸' : '🦾') : '💥', clamp(fval, 0, fmax), fmax, { slot: idx, color: 'coral', width: W });
          if (s.beat === 3) {
            const ctx = A.ctx, r = A.area, x = r.x + 12 + 26 + (W * CRACK) / fmax, y = r.y + 12 + idx * 26;
            ctx.save(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x, y + 17); ctx.stroke(); ctx.restore();
            A.emoji(idx === 0 ? '🧸' : '🦾', [a.base[0] + 0.35, 0.5], 28);
          }
        });
        if (s.poking && s.poke) A.dot(s.poke, 6, { color: 'coral' });
      },
    };
  },
};

function drawEgg(g, egg) {
  const c = egg.c;
  g.line([c[0] - 0.5, c[1] - EGG_R], [c[0] + 0.5, c[1] - EGG_R], { color: 'slate', width: 4 });
  if (egg.broken) {
    g.emoji('🍳', [c[0], c[1] - 0.05], 46);
  } else {
    g.ellipse([c[0], c[1] + 0.01], EGG_R * 0.85, EGG_R * 1.02, 0, { fill: 'white', color: 'ink', width: 2.5 });
  }
}
