// A rotation matrix is just "where the three arrows point now".
// Its columns ARE the red, green, blue arrows of the turned toy.
import { View3D } from '../viz/view3d.js';
import { C, alpha } from '../viz/palette.js';
import { mmul, T, eye } from '../core/linalg.js';
import { rotX, rotY, rotZ, expSO3, logSO3 } from '../core/lie.js';
import { smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';

// A toy airplane made of boxes, in its own body frame (x = nose, y = left wing, z = up).
function plane(v, R, p, o = {}) {
  const at = (l) => [0, 1, 2].map((i) => p[i] + R[i][0] * l[0] + R[i][1] * l[1] + R[i][2] * l[2]);
  const Rb = R;
  v.box(Rb, p, [0.75, 0.13, 0.13], { color: o.body ?? 'slate', alpha: o.alpha });
  v.box(Rb, at([0.05, 0, 0]), [0.22, 0.85, 0.03], { color: o.wing ?? 'blue', alpha: o.alpha });
  v.box(Rb, at([-0.62, 0, 0.18]), [0.1, 0.03, 0.2], { color: o.tail ?? 'orange', alpha: o.alpha });
  v.box(Rb, at([-0.62, 0, 0.02]), [0.08, 0.3, 0.02], { color: o.wing ?? 'blue', alpha: o.alpha });
  v.sphere(at([0.8, 0, 0]), 0.1, { color: 'pink', alpha: o.alpha });
}

export default {
  eq: [
    [['R', 'ink'], ' = [ ', ['x̂', 'red'], '  ', ['ŷ', 'green'], '  ', ['ẑ', 'blue'], ' ]   (columns = where the arrows point)'],
    [['R', 'ink'], 'ᵀ', ['R', 'ink'], ' = I      det ', ['R', 'ink'], ' = +1'],
    [['R', 'ink'], '₁', ['R', 'ink'], '₂ ≠ ', ['R', 'ink'], '₂', ['R', 'ink'], '₁        ', ['R', 'ink'], '⁻¹ = ', ['R', 'ink'], 'ᵀ'],
  ],
  setup({ stage, ui }) {
    const pen = stage.g;
    const v = new View3D(pen, { yaw: -0.9, pitch: 0.38, dist: 7.5, target: [0, 0, 0.3] });
    const s = { ang: [0.0, -0.35, 0.6], beat: 0, t: 0, spinAxis: 2, R: eye(3) };

    ui.beats(['🔄', '🧱', '🔀', '↩️'], (b) => { s.beat = b; s.t = 0; });
    const sl = ['red', 'green', 'blue'].map((c, i) => ui.slider({
      icon: ['🔴', '🟢', '🔵'][i], color: c, min: -Math.PI, max: Math.PI, step: 0.01, value: s.ang[i],
      title: `turn about ${'xyz'[i]}`, onInput: (x) => (s.ang[i] = x),
    }));
    ui.button({ icon: '🏠', title: 'home pose', onClick: () => { s.ang = [0, 0, 0]; sl.forEach((x) => x.set(0)); } });
    ui.readout(() => `${fmt((logSO3(s.R).reduce((a, b) => a + b * b, 0) ** 0.5) * 180 / Math.PI, 0)}°`, { icon: '📐', color: 'orange', title: 'total turn angle' });

    return {
      update(dt) {
        s.t += dt;
        v.tick(dt);
        s.R = mmul(mmul(rotZ(s.ang[2]), rotY(s.ang[1])), rotX(s.ang[0]));
      },
      draw() {
        v.begin();
        v.floor(2.5, 0.5);
        // world frame, faint
        v.frame(eye(3), [0, 0, 0], 1.0, { alpha: 0.28, width: 2 });
        const R = s.R;
        if (s.beat === 0) {
          // single spin: show the axis of the total rotation and the arc the nose travels
          const r = logSO3(R), th = Math.hypot(...r);
          if (th > 1e-3) {
            const axis = r.map((x) => x / th);
            v.line(axis.map((x) => -x * 2), axis.map((x) => x * 2), { color: 'orange', width: 2, dash: [6, 5] });
            const k = smoothstep((s.t % 3) / 2);
            const Rk = expSO3(r.map((x) => x * k));
            plane(v, Rk, [0, 0, 0], { alpha: 0.95 });
            v.frame(Rk, [0, 0, 0], 1.3, { width: 4 });
            // trail of the nose
            const pts = []; for (let i = 0; i <= 30; i++) { const Ri = expSO3(r.map((x) => (x * i) / 30 * k)); pts.push([Ri[0][0] * 1.3, Ri[1][0] * 1.3, Ri[2][0] * 1.3]); }
            v.path(pts, { color: alpha('red', 0.6), width: 2 });
          } else { plane(v, R, [0, 0, 0]); v.frame(R, [0, 0, 0], 1.3, { width: 4 }); }
        } else if (s.beat === 1) {
          plane(v, R, [0, 0, 0], { alpha: 0.5 });
          v.frame(R, [0, 0, 0], 1.6, { width: 5 });
          for (let j = 0; j < 3; j++) {
            const tip = [R[0][j] * 1.6, R[1][j] * 1.6, R[2][j] * 1.6];
            v.line(tip, [tip[0], tip[1], 0], { color: alpha(['red', 'green', 'blue'][j], 0.35), dash: [3, 4], width: 1.5 });
          }
        } else if (s.beat === 2) {
          // Order matters: turn-x-then-z vs turn-z-then-x land in different places.
          const k = smoothstep((s.t % 4) / 1.5), k2 = smoothstep((s.t % 4 - 1.5) / 1.5);
          const A = rotX(Math.PI / 2 * k), B = rotZ(Math.PI / 2 * k2);
          const left = mmul(B, A);              // first x, then z (about world axes)
          const A2 = rotZ(Math.PI / 2 * k), B2 = rotX(Math.PI / 2 * k2);
          const right = mmul(B2, A2);           // first z, then x
          plane(v, left, [0, -1.6, 0.4]); v.frame(left, [0, -1.6, 0.4], 0.9);
          plane(v, right, [0, 1.6, 0.4]); v.frame(right, [0, 1.6, 0.4], 0.9);
          v.text('🔴→🔵', [0, -1.6, 1.7], { size: 20 });
          v.text('🔵→🔴', [0, 1.6, 1.7], { size: 20 });
        } else {
          // Inverse = transpose: play R, then Rᵀ, back home.
          const ph = s.t % 4;
          const r = logSO3(R);
          const k = ph < 1.6 ? smoothstep(ph / 1.4) : 1 - smoothstep((ph - 2) / 1.4);
          const Rk = expSO3(r.map((x) => x * k));
          plane(v, Rk, [0, 0, 0]);
          v.frame(Rk, [0, 0, 0], 1.3, { width: 4 });
          v.text(ph < 1.8 ? 'R' : 'Rᵀ', [0, 0, 2.0], { size: 26, color: ph < 1.8 ? 'ink' : 'gold' });
        }
        v.flush();
        drawRotMatrix(stage.hud, s.beat === 2 ? null : R, s.beat === 1);
      },
    };
  },
};

function drawRotMatrix(hud, R, glow) {
  if (!R) return;
  const ctx = hud.ctx;
  const cw = 58, ch = 30, X = hud.area.w - cw * 3 - 34, Y = 14;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(X, Y, cw * 3 + 20, ch * 3 + 14, 12); ctx.fill();
  const cols = ['red', 'green', 'blue'];
  for (let j = 0; j < 3; j++) {
    if (glow) { ctx.fillStyle = alpha(cols[j], 0.18); ctx.beginPath(); ctx.roundRect(X + 10 + cw * j + 3, Y + 6, cw - 6, ch * 3 + 2, 8); ctx.fill(); }
    for (let i = 0; i < 3; i++) {
      ctx.font = '700 15px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = C[cols[j]];
      ctx.fillText(fmt(R[i][j], 2), X + 10 + cw * (j + 0.5), Y + 7 + ch * (i + 0.5));
    }
  }
  ctx.restore();
  void T;
}
