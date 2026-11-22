// Statics: push on the hand → each joint feels a twist. τ = Jᵀ F.
// A straight arm is a bone: push along it and the joints feel (almost) nothing.
import { C, alpha, mix } from '../viz/palette.js';
import { planarFK, planarJacobian, twoLinkIK, manipulability } from '../core/kinematics.js';
import { mvec, T } from '../core/linalg.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const L = [1.3, 1.1];
const RMIN = Math.abs(L[0] - L[1]) + 0.02, RMAX = L[0] + L[1];
const K = 0.6;                         // world length per unit force
const shade = (i) => [mix('orange', 'red', 0.35), mix('orange', 'gold', 0.45)][i];
const SUB = ['₁', '₂'];

export default {
  eq: [
    [['τ', 'orange'], ' = ', ['J', 'orange'], 'ᵀ ', ['F', 'coral']],
    [['τ₁', 'orange'], ' = ', ['J₁', 'orange'], ' · ', ['F', 'coral'], '      ', ['τ₂', 'orange'], ' = ', ['J₂', 'orange'], ' · ', ['F', 'coral'], '      (Jᵢ = column i of J)'],
    ['🪨:  ', ['F', 'coral'], ' = (0, −m g)'],
    [['F', 'coral'], ' ∥ arm  ⇒  ', ['F', 'coral'], ' ⊥ every ', ['Jᵢ', 'orange'], '  ⇒  ', ['τ', 'orange'], ' ≈ 0  🦴'],
    ['power: ', ['τ', 'orange'], 'ᵀ', ['θ̇', 'orange'], ' = ', ['F', 'coral'], 'ᵀ', ['ẋ', 'pink'], '   ⇒   ', ['velocity ellipse', 'pink'], ' radii σᵢ,  ', ['force ellipse', 'coral'], ' radii 1/σᵢ'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-1.3, -1.9, 3.3, 2.7]);
    const s = { q: twoLinkIK(L[0], L[1], 1.7, 0.5, false), beat: 0, t: 0, m: 1.0, F: [-0.9, -0.7], spin: true, phi: 0 };
    const fk = () => planarFK(L, s.q);
    const setHand = (p) => {
      const r = Math.hypot(...p), m = clamp(r, RMIN, RMAX - 1e-3);
      const q = twoLinkIK(L[0], L[1], (p[0] * m) / (r || 1), (p[1] * m) / (r || 1), false);
      if (q) s.q = q;
    };
    stage.handle({ pen: g, color: 'pink', r: 12, get: () => fk().tip, set: setHand });
    // the finger that pushes: drag it around the hand
    stage.handle({
      pen: g, color: 'coral', r: 11, visible: () => s.beat === 1 || s.beat === 2,
      get: () => { const t = fk().tip; return [t[0] - K * s.F[0], t[1] - K * s.F[1]]; },
      set: (p) => {
        const t = fk().tip; let F = [(t[0] - p[0]) / K, (t[1] - p[1]) / K];
        const n = Math.hypot(...F); if (n > 2.4) F = F.map((x) => (x * 2.4) / n); if (n < 0.2) F = F.map((x) => (x * 0.2) / (n || 1));
        s.F = F;
      },
      onStart: () => (s.spin = false),
    });

    ui.beats(['🏋️', '👊', '🦴', '🔁'], (b) => {
      s.beat = b; s.t = 0; s.spin = true;
      if (b === 2) { const a = Math.atan2(fk().tip[1], fk().tip[0]); setHand([Math.cos(a) * (RMAX - 0.004), Math.sin(a) * (RMAX - 0.004)]); }
      gm.style.display = b === 0 ? '' : 'none';
    });
    const gm = ui.group();
    ui.slider({ into: gm, icon: '🪨', color: 'coral', min: 0.2, max: 2, step: 0.05, value: s.m, title: 'weight', onInput: (v) => (s.m = v) });
    ui.button({ icon: '📏', title: 'straighten', onClick: () => { const a = Math.atan2(fk().tip[1], fk().tip[0]); setHand([Math.cos(a) * (RMAX - 0.004), Math.sin(a) * (RMAX - 0.004)]); } });
    ui.button({ icon: '💪', title: 'bend', onClick: () => setHand([1.2, 0.9]) });
    ui.readout(() => fmt(Math.hypot(...tauNow()), 2), { icon: '💪', color: 'orange', title: 'joint effort' });

    const force = () => (s.beat === 0 ? [0, -s.m] : s.F);
    const tauNow = () => mvec(T(planarJacobian(L, s.q)), force());

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 2 && s.spin) { s.phi += dt * 0.7; s.F = [1.4 * Math.cos(s.phi), 1.4 * Math.sin(s.phi)]; }
      },
      draw() {
        g.grid({ step: 0.5 });
        const f = fk(), tip = f.tip, J = planarJacobian(L, s.q);
        const F = force();
        const tau = mvec(T(J), F);

        if (s.beat === 2) {
          // how hard the joints must twist for a push of size 1 in each direction
          const pts = [];
          for (let k = 0; k <= 120; k++) {
            const a = (k / 120) * 2 * Math.PI, u = [Math.cos(a), Math.sin(a)];
            const t = mvec(T(J), u), r = 0.35 * Math.hypot(...t);
            pts.push([tip[0] + r * u[0], tip[1] + r * u[1]]);
          }
          g.path(pts, { color: 'orange', width: 2.5, fill: alpha('orange', 0.12), close: true });
          const a = Math.atan2(f.points[2][1] - f.points[0][1], f.points[2][0] - f.points[0][0]);
          g.line([tip[0] - Math.cos(a) * 1.2, tip[1] - Math.sin(a) * 1.2], [tip[0] + Math.cos(a) * 1.2, tip[1] + Math.sin(a) * 1.2], { color: alpha('muted', 0.6), width: 1.5, dash: [3, 5] });
        }
        if (s.beat === 3) {
          const m = manipulability(J), U = m.axes, S = m.radii, ang = Math.atan2(U[1][0], U[0][0]);
          g.ellipse(tip, S[0] * 0.55, Math.max(S[1] * 0.55, 0.004), ang, { color: 'pink', width: 3.5, fill: alpha('pink', 0.14) });
          g.ellipse(tip, Math.min(0.55 / S[0], 2.8), Math.min(0.55 / Math.max(S[1], 1e-6), 2.8), ang, { color: 'coral', width: 3.5, fill: alpha('coral', 0.1) });
          for (let k = 0; k < 2; k++) g.line([tip[0] - U[0][k] * 2.8, tip[1] - U[1][k] * 2.8], [tip[0] + U[0][k] * 2.8, tip[1] + U[1][k] * 2.8], { color: alpha('muted', 0.45), width: 1, dash: [3, 5] });
          const far = (k, r) => { const a = [tip[0] + U[0][k] * r, tip[1] + U[1][k] * r], b = [tip[0] - U[0][k] * r, tip[1] - U[1][k] * r]; return Math.hypot(...a) > Math.hypot(...b) ? a : b; };
          const e1 = far(0, S[0] * 0.55 + 0.25), e2 = far(1, Math.min(0.55 / Math.max(S[1], 1e-6), 2.8) + 0.2);
          g.emoji('🏃', e1, 22);
          g.emoji('🏋️', e2, 22);
        }

        g.arm(f.points, { width: 20, colors: ['slate', 'slate'] });
        if (s.beat === 2 && Math.abs(Math.hypot(...tau)) < 0.25) {
          g.emoji('🦴', [(f.points[0][0] + f.points[2][0]) / 2 + 0.0, (f.points[0][1] + f.points[2][1]) / 2 + 0.3], 30);
        }

        // torque twists at each joint
        if (s.beat !== 3) for (let i = 0; i < 2; i++) twist(g, f.points[i], [0.42, 0.34][i], tau[i], shade(i));
        for (let i = 0; i < 2; i++) g.dot(f.points[i], 8, { color: shade(i), ring: 'bg' });

        // the force on the hand
        if (s.beat === 0) {
          const w = 0.16 + 0.1 * Math.sqrt(s.m);
          const c = [tip[0], tip[1] - 0.45 - w];
          g.line(tip, [c[0], c[1] + w * 0.6], { color: 'ink', width: 2 });
          g.circle(c, w, { fill: 'slate', color: 'slate' });
          g.arc([c[0], c[1] + w * 0.85], w * 0.45, 0.2, Math.PI - 0.2, { color: 'slate', width: 4 });
          g.arrow(c, [c[0], c[1] - K * s.m - w], { color: 'coral', width: 5 });
        } else if (s.beat !== 3) {
          const tail = [tip[0] - K * F[0], tip[1] - K * F[1]];
          g.arrow(tail, tip, { color: 'coral', width: 6 });
          const n = Math.hypot(...F) || 1;
          g.emoji('👊', [tail[0] - (F[0] / n) * 0.28, tail[1] - (F[1] / n) * 0.28], 26);
        }
        g.dot(tip, 7, { color: 'pink', ring: 'bg' });

        if (s.beat !== 3) drawBars(stage.hud, tau);
      },
    };
  },
};

// a curved arrow around a joint; sweep grows with the torque
function twist(g, c, r, tau, color) {
  const sweep = clamp(tau * 1.4, -5.6, 5.6);
  if (Math.abs(sweep) < 0.04) { g.circle(c, r, { color: alpha(color, 0.25), width: 2, dash: [2, 4] }); return; }
  const a0 = Math.PI / 2, a1 = a0 + sweep;
  g.arc(c, r, a0, a1, { color, width: 5 });
  const e = [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)];
  const d = Math.sign(sweep);
  const tdir = [-Math.sin(a1) * d, Math.cos(a1) * d];
  g.arrow([e[0] - tdir[0] * 0.12, e[1] - tdir[1] * 0.12], [e[0] + tdir[0] * 0.04, e[1] + tdir[1] * 0.04], { color, width: 5, head: 14 });
}

function drawBars(hud, tau) {
  const ctx = hud.ctx;
  const W = 140, H = 150, X = hud.area.w - W - 14, Y = 14, mid = Y + H / 2 + 6, sc = 22;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(X, Y, W, H, 12); ctx.fill();
  ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X + 12, mid); ctx.lineTo(X + W - 12, mid); ctx.stroke();
  tau.forEach((v, i) => {
    const x = X + 26 + i * 56, h = clamp(v, -2.6, 2.6) * sc;
    ctx.fillStyle = shade(i);
    ctx.beginPath(); ctx.roundRect(x, Math.min(mid, mid - h), 32, Math.max(Math.abs(h), 2), 5); ctx.fill();
    ctx.font = '700 13px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt(v, 2), x + 16, v >= 0 ? mid + 12 : mid - 12);
    ctx.fillText(`τ${SUB[i]}`, x + 16, Y + 13);
  });
  ctx.restore();
}
