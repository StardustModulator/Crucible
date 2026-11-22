// Manipulability: a circle of joint speeds becomes an ellipse (a football) of
// hand speeds. Fat football = the hand can zip any way. Flat football = stuck.
import { C, alpha } from '../viz/palette.js';
import { planarFK, planarJacobian, twoLinkIK, manipulability } from '../core/kinematics.js';
import { mvec, pinv, T } from '../core/linalg.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const L = [1.3, 1.1];
const RMIN = Math.abs(L[0] - L[1]), RMAX = L[0] + L[1];
const KV = 0.55;   // world length per unit hand speed
const KF = 0.5;    // world length per unit force

export default {
  eq: [
    [['ẋ', 'pink'], ' = ', ['J', 'orange'], ' ', ['θ̇', 'orange'], '       ‖', ['θ̇', 'orange'], '‖ = 1  →  ', ['ellipse', 'pink']],
    [['J', 'orange'], ' = ', ['U', 'pink'], ' Σ ', ['V', 'orange'], 'ᵀ      Σ = diag(', ['σ₁', 'pink'], ', ', ['σ₂', 'pink'], ')'],
    [['w', 'teal'], ' = √det(', ['J', 'orange'], ['J', 'orange'], 'ᵀ) = ', ['σ₁', 'pink'], ['σ₂', 'pink'], ' = L₁L₂|sin θ₂|'],
    [['τ', 'orange'], ' = ', ['J', 'orange'], 'ᵀ', ['F', 'coral'], '   →  ', ['force ellipse', 'coral'], ': same axes, radii 1/σᵢ'],
    [['σ₂', 'pink'], ' → 0  ⇒  ', ['w', 'teal'], ' → 0  🚫'],
  ],
  setup({ stage, ui }) {
    const [g, h] = stage.split([[-2.55, -1.35, 2.55, 2.6], [-1.45, -1.45, 1.45, 1.45]], [2.7, 1]);
    const s = { q: twoLinkIK(L[0], L[1], 0.9, 1.3, true), elbow: true, beat: 0, t: 0, drag: false, ang: 0.95, flash: 0 };
    const fk = () => planarFK(L, s.q);
    const setHand = (p) => {
      const r = Math.hypot(...p), m = clamp(r, RMIN + 0.01, RMAX - 1e-4);
      const q = twoLinkIK(L[0], L[1], (p[0] * m) / (r || 1), (p[1] * m) / (r || 1), s.elbow);
      if (q) s.q = q;
    };
    stage.handle({
      pen: g, color: 'pink', r: 12, get: () => fk().tip, set: setHand,
      onStart: () => (s.drag = true), onEnd: () => { s.drag = false; s.ang = Math.atan2(fk().tip[1], fk().tip[0]); s.t = 0; },
    });

    ui.beats(['🏈', '🗺️', '🏋️', '🚫'], (b) => { s.beat = b; s.t = 0; s.ang = Math.atan2(fk().tip[1], fk().tip[0]); });
    ui.button({ icon: '🔀', title: 'flip elbow', onClick: () => { s.elbow = !s.elbow; setHand(fk().tip); } });
    ui.button({ icon: '📏', title: 'stretch out', onClick: () => { const a = Math.atan2(fk().tip[1], fk().tip[0]); setHand([Math.cos(a) * RMAX, Math.sin(a) * RMAX]); } });
    ui.readout(() => fmt(manipulability(planarJacobian(L, s.q)).w, 2), { icon: '🏈', color: 'teal', title: 'manipulability w' });

    const wOfR = (r) => { const c2 = (r * r - L[0] ** 2 - L[1] ** 2) / (2 * L[0] * L[1]); return L[0] * L[1] * Math.sqrt(Math.max(0, 1 - c2 * c2)); };
    const WMAX = L[0] * L[1];

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 3 && !s.drag) {
          // slide the hand in and out along a ray: folded → stretched → folded
          const u = (1 - Math.cos(s.t * 0.7)) / 2;
          const r = RMIN + 0.002 + (RMAX - RMIN - 0.003) * u;
          setHand([Math.cos(s.ang) * r, Math.sin(s.ang) * r]);
        }
        const { radii } = manipulability(planarJacobian(L, s.q));
        if (radii[1] < 0.07) s.flash = 1; else s.flash = Math.max(0, s.flash - dt * 2);
      },
      draw() {
        const f = fk(), tip = f.tip;
        const J = planarJacobian(L, s.q);
        const m = manipulability(J);
        const U = m.axes, S = m.radii;
        const ang = Math.atan2(U[1][0], U[0][0]);

        // ---------------- main panel ----------------
        g.clip(() => {
          if (s.flash > 0) g.fillBg(alpha('coral', 0.12 * s.flash));
          if (s.beat === 1) {
            g.heat((x, y) => { const r = Math.hypot(x, y); return r < RMIN || r > RMAX ? -1 : wOfR(r); },
              { cacheKey: 'w', res: 120, min: 0, max: WMAX, cmap: 'heat', alphaFn: (t) => (t < 0 ? 0 : 0.2 + 0.6 * t) });
          }
          g.grid({ step: 0.5 });
          g.circle([0, 0], RMAX, { color: alpha('muted', 0.5), width: 1.5, dash: [6, 6] });
          g.circle([0, 0], RMIN, { color: alpha('muted', 0.5), width: 1.5, dash: [6, 6] });
          if (s.beat === 1) ellipseField(g, s.elbow);
        });

        if (s.beat === 3) g.line([Math.cos(s.ang) * RMIN, Math.sin(s.ang) * RMIN], [Math.cos(s.ang) * RMAX, Math.sin(s.ang) * RMAX], { color: alpha('pink', 0.5), width: 3, dash: [2, 6] });
        g.arm(f.points, { width: 18, colors: ['slate', 'slate'] });

        if (s.beat === 2) {
          // force ellipse: strong where slow (reciprocal radii)
          g.ellipse(tip, S[0] * KV, S[1] * KV, ang, { color: alpha('pink', 0.5), width: 2, dash: [5, 5] });
          const f1 = Math.min(KF / Math.max(S[0], 1e-6), 2.6), f2 = Math.min(KF / Math.max(S[1], 1e-6), 2.6);
          g.ellipse(tip, f1, f2, ang, { color: 'coral', width: 3.5, fill: alpha('coral', 0.14) });
          axes(g, tip, U, [f1, f2], 'coral');
          const tau = [Math.cos(s.t * 1.3), Math.sin(s.t * 1.3)];
          const F = mvec(pinv(T(J), 1e-6), tau);
          const Fn = Math.hypot(...F), cap = 2.6 / KF;
          const Fv = Fn > cap ? F.map((x) => (x * cap) / Fn) : F;
          g.arrow(tip, [tip[0] + KF * Fv[0], tip[1] + KF * Fv[1]], { color: 'coral', width: 4 });
        } else {
          g.ellipse(tip, S[0] * KV, Math.max(S[1] * KV, 0.004), ang, { color: 'pink', width: 3.5, fill: alpha('pink', 0.16) });
          axes(g, tip, U, [S[0] * KV, S[1] * KV], 'pink');
          if (s.beat === 0) {
            const qd = [Math.cos(s.t * 1.3), Math.sin(s.t * 1.3)];
            const v = mvec(J, qd);
            g.arrow(tip, [tip[0] + KV * v[0], tip[1] + KV * v[1]], { color: 'pink', width: 4 });
            g.dot([tip[0] + KV * v[0], tip[1] + KV * v[1]], 5, { color: 'pink', ring: 'bg' });
          }
        }
        for (let i = 0; i < 2; i++) g.dot(f.points[i], 7, { color: 'orange', ring: 'bg' });
        if (s.flash > 0.05) g.emoji('🚫', [tip[0] + 0.35, tip[1] + 0.4], 30, { alpha: Math.min(1, s.flash * 1.5) });

        // ---------------- inset panel ----------------
        h.fillBg(alpha('panel', 0.5));
        if (s.beat === 0 || s.beat === 2) {
          // circle of joint inputs (speeds or torques) — every direction, same size
          h.line([-1.3, 0], [1.3, 0], { color: alpha('muted', 0.5), width: 1 });
          h.line([0, -1.3], [0, 1.3], { color: alpha('muted', 0.5), width: 1 });
          h.circle([0, 0], 1, { color: 'orange', width: 3, fill: alpha('orange', 0.1), stroke: true });
          const { V } = svdV(J);
          if (s.beat === 0) for (let k = 0; k < 2; k++) h.line([-V[0][k], -V[1][k]], [V[0][k], V[1][k]], { color: alpha('orange', 0.7), width: 2, dash: [4, 4] });
          const a = s.t * 1.3, d = [Math.cos(a), Math.sin(a)];
          h.arrow([0, 0], d, { color: 'orange', width: 4 });
          h.text(s.beat === 0 ? 'θ̇₁' : 'τ₁', [1.25, -0.18], { color: 'orange', size: 15 });
          h.text(s.beat === 0 ? 'θ̇₂' : 'τ₂', [0.22, 1.25], { color: 'orange', size: 15 });
          h.text(s.beat === 0 ? '→ 🏈' : '→ 🏋️', [0, -1.28], { size: 18 });
        } else {
          // w as a function of reach r: zero at both edges of the donut
          const x0 = -1.25, x1 = 1.25, y0 = -1.0, y1 = 1.1;
          const X = (r) => x0 + ((r - RMIN) / (RMAX - RMIN)) * (x1 - x0), Y = (w) => y0 + (w / WMAX) * (y1 - y0);
          h.line([x0, y0], [x1, y0], { color: alpha('muted', 0.7), width: 1.5 });
          h.line([x0, y0], [x0, y1], { color: alpha('muted', 0.7), width: 1.5 });
          const pts = []; for (let k = 0; k <= 80; k++) { const r = RMIN + ((RMAX - RMIN) * k) / 80; pts.push([X(r), Y(wOfR(r))]); }
          h.path(pts, { color: 'teal', width: 3 });
          const r = Math.hypot(...tip), w = m.w;
          h.line([X(r), y0], [X(r), Y(w)], { color: alpha('teal', 0.6), dash: [3, 3], width: 1.5 });
          h.dot([X(r), Y(w)], 7, { color: 'teal', ring: 'bg' });
          h.text('w', [x0 - 0.12, y1], { color: 'teal', size: 16 });
          h.text('r', [x1 + 0.1, y0 - 0.05], { color: 'ink', size: 16 });
          h.emoji('🚫', [X(RMIN) + 0.05, y0 - 0.25], 18);
          h.emoji('🚫', [X(RMAX) - 0.05, y0 - 0.25], 18);
        }
      },
    };
  },
};

function svdV(J) {
  // right singular vectors = eigenvectors of JᵀJ (2×2, closed form)
  const a = J[0][0] ** 2 + J[1][0] ** 2, b = J[0][0] * J[0][1] + J[1][0] * J[1][1], d = J[0][1] ** 2 + J[1][1] ** 2;
  const th = 0.5 * Math.atan2(2 * b, a - d);
  return { V: [[Math.cos(th), -Math.sin(th)], [Math.sin(th), Math.cos(th)]] };
}

function axes(g, c, U, r, color) {
  for (let k = 0; k < 2; k++) {
    const d = [U[0][k] * r[k], U[1][k] * r[k]];
    g.line([c[0] - d[0], c[1] - d[1]], [c[0] + d[0], c[1] + d[1]], { color: alpha(color, 0.8), width: 2, dash: k ? [2, 4] : [] });
  }
  g.text('σ₁', [c[0] + U[0][0] * r[0] * 1.08 + 0.12, c[1] + U[1][0] * r[0] * 1.08 + 0.1], { color, size: 15 });
}

// a lattice of tiny footballs: how nimble the hand is at every spot
function ellipseField(g, elbow) {
  for (let x = -2.4; x <= 2.41; x += 0.4)
    for (let y = -1.2; y <= 2.41; y += 0.4) {
      const r = Math.hypot(x, y);
      if (r < RMIN + 0.05 || r > RMAX - 0.02) continue;
      const q = twoLinkIK(L[0], L[1], x, y, elbow);
      if (!q) continue;
      const { radii, axes: U } = manipulability(planarJacobian(L, q));
      g.ellipse([x, y], radii[0] * 0.095, Math.max(radii[1] * 0.095, 0.004), Math.atan2(U[1][0], U[0][0]), { color: alpha('ink', 0.55), width: 1.2, fill: alpha('white', 0.25) });
    }
}
