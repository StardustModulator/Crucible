// Poles. Where you put the orange × on the complex plane decides how the spring
// toy behaves: left/right (real part) = how fast it calms down (or blows up),
// up/down (imaginary part) = how fast it wiggles. Left half = safe (lime).
import { C, alpha } from '../viz/palette.js';
import { rk4 } from '../core/dynamics.js';
import { secondOrderPoles } from '../core/control.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const T = 10;
const PRESETS = [[-0.8, 2.6], [-2.0, 2.0], [-0.45, 3.6], [0.3, 2.2]];

export default {
  eq: [
    ['s = ', ['σ', 'red'], ' ± i', ['ω', 'green'], '        x(t) ≈ 1 − ', ['e^{σt}', 'red'], ' · ', ['cos(ωt)', 'green']],
    [['ẍ', 'pink'], ' + ', ['k_d', 'purple'], ' ẋ + ', ['k_p', 'teal'], ' x = ', ['k_p', 'teal'], '·1     →   s² + ', ['k_d', 'purple'], 's + ', ['k_p', 'teal'], ' = 0'],
    [['k_d', 'purple'], ' = −2', ['σ', 'red'], ' ,  ', ['k_p', 'teal'], ' = ', ['σ', 'red'], '² + ', ['ω', 'green'], '²'],
    [['σ < 0', 'lime'], ' → settles     ', ['σ > 0', 'coral'], ' → 💥'],
  ],
  setup({ stage, ui }) {
    const wide = (W, H) => W >= H * 1.05;
    const S = stage.pen((W, H) => (wide(W, H) ? { x: 0, y: 0, w: 0.42, h: 1 } : { x: 0, y: 0, w: 1, h: 0.44 }), [-4.3, -4.3, 2.3, 4.3], { frame: true });
    const R = stage.pen((W, H) => (wide(W, H) ? { x: 0.42, y: 0, w: 0.58, h: 1 } : { x: 0, y: 0.44, w: 1, h: 0.56 }), [0, -3.1, 10, 3.5], { frame: true });
    const s = { beat: 0, p: PRESETS[0].slice(), t: 0, traj: null, gains: null };

    const recompute = () => {
      const [sg, w] = s.p;
      const kp = sg * sg + w * w, kd = -2 * sg;
      const f = (t, [x, v]) => [v, -kp * (x - 1) - kd * v];
      const pts = []; let x = [0, 0];
      const h = 0.01;
      for (let i = 0; i <= T / h; i++) { pts.push(x[0]); x = rk4(f, 0, x, h); if (!Number.isFinite(x[0]) || Math.abs(x[0]) > 1e4) x = [Math.sign(x[0] || 1) * 1e4, 0]; }
      s.traj = pts; s.gains = { kp, kd }; s.eig = secondOrderPoles(kp, kd);
    };
    const at = (t) => s.traj[clamp(Math.round(t / 0.01), 0, s.traj.length - 1)];

    stage.handle({
      pen: S, color: 'orange', r: 13, kind: 'ring',
      get: () => [s.eig[0].re, Math.abs(s.eig[0].im)],
      set: (p) => { s.p = [clamp(p[0], -4, 1.2), clamp(p[1], 0, 4)]; if (s.p[1] < 0.12) s.p[1] = 0; recompute(); s.t = 0; },
    });

    ui.readout(() => fmt(s.p[0], 2), { icon: '↔️', color: 'red', title: 'real part σ' });
    ui.readout(() => fmt(s.p[1], 2), { icon: '〰️', color: 'green', title: 'imaginary part ω' });
    ui.button({ icon: '🔁', title: 'again', onClick: () => (s.t = 0) });
    ui.beats(['🪀', '⏱️', '〰️', '💥'], (b) => { s.beat = b; s.p = PRESETS[b].slice(); recompute(); s.t = 0; });
    recompute();

    return {
      update(dt) { s.t += dt; if (s.t > T + 1.2) s.t = 0; },
      draw() { drawS(); drawToy(); },
    };

    function drawS() {
      const P = S, [x0, y0, x1, y1] = P.view;
      P.rect(x0, y0, -x0, y1 - y0, { fill: alpha('lime', 0.12), stroke: false });
      P.rect(0, y0, x1, y1 - y0, { fill: alpha('coral', s.beat === 3 ? 0.2 : 0.1), stroke: false });
      P.grid({ step: 1, axes: false });
      P.line([x0, 0], [x1, 0], { color: 'red', width: 2.5 });
      P.line([0, y0], [0, y1], { color: 'green', width: 2.5 });
      P.text('σ', [x1 - 0.25, 0.3], { color: 'red', size: 18, weight: 800 });
      P.text('iω', [0.35, y1 - 0.3], { color: 'green', size: 18, weight: 800 });
      P.emoji('😌', [x0 + 0.5, y1 - 0.5], 24);
      P.emoji('😱', [x1 - 0.45, y1 - 0.5], 24);
      const [sg, w] = [s.eig[0].re, Math.abs(s.eig[0].im)];
      // projections: real part → red, imaginary part → green
      P.line([sg, w], [sg, 0], { color: 'red', width: s.beat === 1 ? 4 : 2, dash: [5, 4] });
      P.line([sg, w], [0, w], { color: 'green', width: s.beat === 2 ? 4 : 2, dash: [5, 4] });
      P.line([sg, -w], [sg, 0], { color: alpha('red', 0.5), width: 1.5, dash: [5, 4] });
      if (s.beat === 1) P.arrow([sg, 0.0], [sg - 0.9, 0], { color: 'red', width: 3 });
      if (s.beat === 2) P.arrow([0, w], [0, w + 0.9], { color: 'green', width: 3 });
      // both poles (computed from the gains by eig2 — the dot and the × always agree)
      for (const e of s.eig) cross(P, [e.re, e.im], e.im < 0 ? 0.55 : 1);
    }
    function cross(P, c, a) {
      const r = 0.22, col = alpha('orange', a);
      P.line([c[0] - r, c[1] - r], [c[0] + r, c[1] + r], { color: col, width: 5 });
      P.line([c[0] - r, c[1] + r], [c[0] + r, c[1] - r], { color: col, width: 5 });
    }

    function drawToy() {
      const P = R;
      P.grid({ step: 1, axes: false });
      const t = Math.min(s.t, T), x = at(t), blew = x > 2.05 || x < -0.2;
      // --- the spring toy
      const Y = 2.3, X = (u) => 1.3 + 4.0 * u;
      P.rect(0.2, Y - 0.9, 0.3, 1.8, { fill: 'slate', stroke: false });
      P.line([X(1), Y - 1.0], [X(1), Y + 1.0], { color: 'gold', width: 3, dash: [6, 5] });
      P.emoji('🎯', [X(1), Y + 1.0], 18);
      const bx = clamp(X(x), 1.0, 9.6);
      P.spring([0.5, Y + 0.25], [bx - 0.45, Y + 0.25], { color: 'teal', width: 2.5, coils: 9 });
      P.damper([0.5, Y - 0.35], [bx - 0.45, Y - 0.35], { color: s.gains.kd < 0 ? 'coral' : 'purple' });
      if (blew) P.emoji('💥', [bx, Y], 50);
      else {
        P.rrect(bx - 0.45, Y - 0.6, 0.9, 1.2, 8, { fill: 'pink', stroke: false });
        P.emoji(Math.abs(x - 1) < 0.05 && t > 0.5 ? '😊' : Math.abs(at(t + 0.05) - x) > 0.05 ? '😵' : '🙂', [bx, Y], 24);
      }
      // --- step response plot
      const top = 0.9, bot = -2.9, px0 = 0.35, px1 = 9.75;
      const PX = (tt) => px0 + (tt / T) * (px1 - px0), PY = (v) => bot + (clamp(v, -0.6, 2.6) + 0.6) / 3.2 * (top - bot);
      P.rrect(px0 - 0.15, bot - 0.1, px1 - px0 + 0.3, top - bot + 0.2, 8, { fill: alpha('panel', 0.75), stroke: false });
      P.line([px0, PY(0)], [px1, PY(0)], { color: alpha('muted', 0.6), width: 1 });
      P.line([px0, PY(1)], [px1, PY(1)], { color: 'gold', width: 2, dash: [6, 5] });
      const sg = s.p[0], w = s.p[1];
      // red envelope 1 ± e^{σt}: how fast it calms down
      const env = (sgn) => { const a = []; for (let i = 0; i <= 120; i++) { const tt = (T * i) / 120; a.push([PX(tt), PY(1 + sgn * Math.exp(sg * tt) * Math.hypot(1, sg / (w || 1)))]); } return a; };
      P.clip(() => {
        P.path(env(1), { color: alpha('red', s.beat === 1 ? 0.9 : 0.45), width: s.beat === 1 ? 3 : 2, dash: [6, 5] });
        P.path(env(-1), { color: alpha('red', s.beat === 1 ? 0.9 : 0.45), width: s.beat === 1 ? 3 : 2, dash: [6, 5] });
        if (s.beat === 2 && w > 0.05) {
          for (let k = 1; (2 * Math.PI * k) / w < T; k++) {
            const tt = (2 * Math.PI * k) / w;
            P.line([PX(tt), bot + 0.05], [PX(tt), bot + 0.4], { color: 'green', width: 3 });
          }
        }
        const pts = []; for (let tt = 0; tt <= t; tt += 0.02) pts.push([PX(tt), PY(at(tt))]);
        P.path(pts, { color: 'pink', width: 3.5 });
        if (pts.length) P.dot(pts[pts.length - 1], 6, { color: 'pink', ring: 'bg' });
      });
      if (s.beat === 1 && sg < -0.05) {
        const ts = 4 / -sg;
        if (ts < T) { P.line([PX(ts), bot], [PX(ts), top], { color: alpha('red', 0.7), width: 2 }); P.emoji('🏁', [PX(ts), top + 0.25], 20); }
      }
      P.text('t', [px1 - 0.15, PY(0) - 0.25], { color: 'muted', size: 13 });
    }
  },
};
void C;
