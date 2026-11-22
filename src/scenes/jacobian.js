// The Jacobian: wiggle one joint → the hand moves along one arrow.
// Wiggle them all → the hand moves along the SUM of the arrows.
import { C, alpha, mix } from '../viz/palette.js';
import { planarFK, planarJacobian } from '../core/kinematics.js';
import { pinv, mvec } from '../core/linalg.js';
import { clamp, wrapAngle } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const L = [1.3, 1.0, 0.6];
const LIM = [Math.PI, 2.4, 2.4];
const K = 0.55;                                     // arrow length per unit joint speed (world units)
const shade = (i) => [mix('orange', 'red', 0.35), C.orange, mix('orange', 'gold', 0.55)][i];
const SUB = ['₁', '₂', '₃'];

export default {
  eq: [
    [['ẋ', 'pink'], ' = ', ['J', 'orange'], '(θ) ', ['θ̇', 'orange']],
    [['ẋ', 'pink'], ' = ', ['J₁', 'orange'], ' θ̇₁ + ', ['J₂', 'orange'], ' θ̇₂ + ', ['J₃', 'orange'], ' θ̇₃'],
    [['Jᵢ', 'orange'], ' = ẑ × (', ['p', 'pink'], ' − pᵢ) = ( −(', ['y', 'green'], '−yᵢ), ', ['x', 'red'], '−xᵢ )'],
    [['θ̇', 'orange'], ' = ', ['J', 'orange'], '⁺ ', ['ẋ*', 'gold'], '      ', ['J', 'orange'], '⁺ = Jᵀ(JJᵀ)⁻¹'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-1.3, -0.9, 3.7, 3.2]);
    const s = { q: [0.1, 1.0, 0.95], beat: 0, t: 0, which: 1, qd: [0.6, 0.7, 1.0], vdes: [0.5, 1.4], trail: [] };
    const base = () => planarFK(L, s.q);
    const Jb = () => planarJacobian(L, s.q);

    // joint ring handles (on each link) — turn the arm to any pose
    const dialR = [0.55, 0.45, 0.35];
    for (let i = 0; i < 3; i++) {
      stage.handle({
        pen: g, kind: 'ring', r: 10, color: 'orange',
        get: () => { const f = base(); const a = f.angles[i]; return [f.points[i][0] + dialR[i] * Math.cos(a), f.points[i][1] + dialR[i] * Math.sin(a)]; },
        set: (p) => {
          const f = base(), pa = i ? f.angles[i - 1] : 0;
          s.q[i] = clamp(wrapAngle(Math.atan2(p[1] - f.points[i][1], p[0] - f.points[i][0]) - pa), -LIM[i], LIM[i]);
          s.trail = [];
        },
      });
    }
    // desired hand velocity (beat 3)
    stage.handle({
      pen: g, color: 'gold', r: 11, visible: () => s.beat === 2,
      get: () => { const t = base().tip; return [t[0] + K * s.vdes[0], t[1] + K * s.vdes[1]]; },
      set: (p) => {
        const t = base().tip; let v = [(p[0] - t[0]) / K, (p[1] - t[1]) / K];
        const n = Math.hypot(...v); if (n > 2.2) v = v.map((x) => (x * 2.2) / n);
        s.vdes = v;
      },
    });

    const beats = ui.beats(['🕹️', '➕', '🎯', '🔢'], (b) => { s.beat = b; s.t = 0; s.trail = []; show(); });
    const gW = ui.group(), gS = ui.group();
    ui.choice({
      into: gW, value: s.which, onChange: (v) => { s.which = v; s.trail = []; },
      options: [0, 1, 2].map((i) => ({ icon: ['1️⃣', '2️⃣', '3️⃣'][i], value: i, title: `wiggle joint ${i + 1}`, color: shade(i) })),
    });
    const sl = [0, 1, 2].map((i) => ui.slider({
      into: gS, icon: `θ̇${SUB[i]}`, color: shade(i), min: -1, max: 1, step: 0.05, value: s.qd[i],
      title: `joint ${i + 1} speed`, onInput: (v) => { s.qd[i] = v; s.trail = []; },
    }));
    void sl;
    ui.readout(() => fmt(Math.hypot(...handVel()), 2), { icon: '🖐️💨', color: 'pink', title: 'hand speed' });
    const show = () => {
      gW.style.display = s.beat === 0 ? '' : 'none';
      gS.style.display = s.beat === 1 || s.beat === 3 ? '' : 'none';
    };
    show();
    void beats;

    // joint speeds being shown this beat
    const speeds = () => {
      if (s.beat === 0) return [0, 1, 2].map((i) => (i === s.which ? 1 : 0));
      if (s.beat === 2) return mvec(pinv(Jb()), s.vdes);
      return s.qd;
    };
    const handVel = () => mvec(Jb(), speeds());

    return {
      update(dt) {
        s.t += dt;
        // wiggle: the arm rocks around the chosen pose with the chosen joint speeds
        if (s.beat !== 2) {
          const qd = speeds();
          const w = Math.sin(s.t * 2.4) * 0.22;
          s.live = s.q.map((x, i) => x + qd[i] * w);
          s.trail.push(planarFK(L, s.live).tip);
          if (s.trail.length > 160) s.trail.shift();
        } else s.live = s.q.slice();
      },
      draw() {
        g.grid({ step: 0.5 });
        const f0 = base(), J = Jb();
        const tip = f0.tip;
        const qd = speeds();
        const live = planarFK(L, s.live ?? s.q);

        // dashed "lever" from each joint to the hand, and the circle the hand would swing on
        for (let i = 0; i < 3; i++) {
          const on = s.beat !== 0 || i === s.which;
          const r = Math.hypot(tip[0] - f0.points[i][0], tip[1] - f0.points[i][1]);
          if (s.beat === 0 && on) g.circle(f0.points[i], r, { color: alpha(shade(i), 0.35), width: 1.5, dash: [3, 6] });
          g.line(f0.points[i], tip, { color: alpha(shade(i), on ? 0.85 : 0.25), width: 2, dash: [6, 5] });
        }

        // ghost of the resting pose + the moving arm
        if (s.beat !== 2) g.arm(f0.points, { width: 16, colors: ['slate', 'slate', 'slate'], alpha: 0.2, hand: false });
        if (s.trail.length > 1) for (let k = 1; k < s.trail.length; k++) g.line(s.trail[k - 1], s.trail[k], { color: alpha('pink', 0.15 + 0.6 * (k / s.trail.length)), width: 3 });
        g.arm(live.points, { width: 16, colors: ['slate', 'slate', 'slate'] });
        for (let i = 0; i < 3; i++) g.dot(live.points[i], 6, { color: shade(i), ring: 'bg' });

        // the Jacobian columns: one arrow per joint, standing at the hand
        for (let i = 0; i < 3; i++) {
          const c = [J[0][i], J[1][i]];
          const on = s.beat !== 0 || i === s.which;
          const a = on ? (s.beat === 0 ? 1 : 0.3) : 0.18;
          g.arrow(tip, [tip[0] + K * c[0], tip[1] + K * c[1]], { color: alpha(shade(i), a), width: s.beat === 0 && on ? 5 : 2.5 });
          if (s.beat === 0 && on) {
            g.arrow(tip, [tip[0] - K * c[0], tip[1] - K * c[1]], { color: alpha(shade(i), 0.35), width: 3, dash: [5, 5] });
            rightAngle(g, f0.points[i], tip, c, shade(i));
            g.text(`J${SUB[i]}`, [tip[0] + K * c[0] * 1.12 + 0.12, tip[1] + K * c[1] * 1.12 + 0.12], { color: shade(i), size: 20, weight: 800 });
          }
        }

        // tip-to-tail sum → pink hand velocity
        if (s.beat >= 1) {
          let p = tip;
          for (let i = 0; i < 3; i++) {
            const d = [K * J[0][i] * qd[i], K * J[1][i] * qd[i]];
            const q = [p[0] + d[0], p[1] + d[1]];
            g.arrow(p, q, { color: shade(i), width: 4.5 });
            p = q;
          }
          const v = mvec(J, qd);
          g.arrow(tip, [tip[0] + K * v[0], tip[1] + K * v[1]], { color: 'pink', width: 7 });
          if (s.beat === 2) {
            const gt = [tip[0] + K * s.vdes[0], tip[1] + K * s.vdes[1]];
            g.line(tip, gt, { color: alpha('gold', 0.8), width: 2, dash: [4, 4] });
          }
        }
        g.dot(tip, 6, { color: 'pink', ring: 'bg' });

        if (s.beat === 1 || s.beat === 2) drawBars(stage.hud, qd, s.beat === 2);
        if (s.beat === 3) drawMatrixEq(stage.hud, J, qd);
      },
    };
  },
};

function rightAngle(g, joint, tip, c, color) {
  const r = [tip[0] - joint[0], tip[1] - joint[1]], rn = Math.hypot(...r) || 1, cn = Math.hypot(...c) || 1;
  const e = 0.12, u = [-r[0] / rn * e, -r[1] / rn * e], n = [c[0] / cn * e, c[1] / cn * e];
  g.path([[tip[0] + u[0], tip[1] + u[1]], [tip[0] + u[0] + n[0], tip[1] + u[1] + n[1]], [tip[0] + n[0], tip[1] + n[1]]], { color, width: 2 });
}

function hudPanel(ctx, x, y, w, h) {
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
}

// three joint-speed bars (the answer the pseudo-inverse gives)
function drawBars(hud, qd, gold) {
  const ctx = hud.ctx;
  const W = 180, H = 150, X = hud.area.w - W - 14, Y = 14, mid = Y + H / 2 + 6, sc = 46;
  ctx.save();
  hudPanel(ctx, X, Y, W, H);
  if (gold) { ctx.strokeStyle = alpha('gold', 0.9); ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(X, Y, W, H, 12); ctx.stroke(); }
  ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X + 14, mid); ctx.lineTo(X + W - 14, mid); ctx.stroke();
  qd.forEach((v, i) => {
    const x = X + 26 + i * 50, h = clamp(v, -1.4, 1.4) * sc;
    ctx.fillStyle = shade(i);
    ctx.beginPath(); ctx.roundRect(x, Math.min(mid, mid - h), 28, Math.max(Math.abs(h), 2), 5); ctx.fill();
    ctx.font = '700 13px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt(v, 2), x + 14, v >= 0 ? mid + 12 : mid - 12);
    ctx.fillText(`θ̇${SUB[i]}`, x + 14, Y + 12);
  });
  ctx.restore();
}

// [ẋ ẏ] = J · θ̇ with live numbers, columns tinted per joint
function drawMatrixEq(hud, J, qd) {
  const ctx = hud.ctx;
  const v = mvec(J, qd);
  const cw = 54, ch = 34;
  const W = cw * 6 + 70, H = ch * 3 + 20;
  const X = Math.max(8, hud.area.w - W - 14), Y = 14;
  ctx.save();
  hudPanel(ctx, X, Y, W, H);
  ctx.font = '700 15px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const yc = Y + H / 2;
  // pink result
  let x = X + 12;
  [0, 1].forEach((r) => { ctx.fillStyle = C.pink; ctx.fillText(fmt(v[r], 2), x + cw / 2, yc + (r - 0.5) * ch); });
  bracket(ctx, x, yc - ch, cw, ch * 2);
  x += cw + 6; ctx.fillStyle = C.ink; ctx.fillText('=', x + 6, yc); x += 16;
  // J columns
  for (let c = 0; c < 3; c++) {
    ctx.fillStyle = alpha(shade(c), 0.18);
    ctx.beginPath(); ctx.roundRect(x + c * cw + 3, yc - ch, cw - 6, ch * 2, 8); ctx.fill();
    [0, 1].forEach((r) => { ctx.fillStyle = shade(c); ctx.fillText(fmt(J[r][c], 2), x + c * cw + cw / 2, yc + (r - 0.5) * ch); });
  }
  bracket(ctx, x, yc - ch, cw * 3, ch * 2);
  x += cw * 3 + 8;
  // θ̇ column
  qd.forEach((q, r) => { ctx.fillStyle = shade(r); ctx.fillText(fmt(q, 2), x + cw / 2, yc + (r - 1) * ch * 0.95); });
  bracket(ctx, x, yc - ch * 1.45, cw, ch * 2.9);
  ctx.restore();
}
function bracket(ctx, x, y, w, h) {
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + 6, y + h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w - 6, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - 6, y + h); ctx.stroke();
}
