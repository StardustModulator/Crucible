// Product of exponentials: every joint is a glowing screw axis fixed in space.
// Pose = (twist about axis 1) · (twist about axis 2) · … · (home pose M).
import { View3D } from '../viz/view3d.js';
import { C, alpha, mix } from '../viz/palette.js';
import { eye, mvec } from '../core/linalg.js';
import { homog, screwAxis, transOf } from '../core/lie.js';
import { poeFK, poeFrames, spaceJacobian } from '../core/kinematics.js';
import { smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const H = 1.0, L1 = 1.15, L2 = 0.95, L3 = 0.4;
const W = [[0, 0, 1], [0, -1, 0], [0, -1, 0], [0, -1, 0]];
const Q = [[0, 0, 0], [0, 0, H], [L1, 0, H], [L1 + L2, 0, H]];
const SCREWS = W.map((w, i) => screwAxis(w, Q[i]));
const M = homog(eye(3), [L1 + L2 + L3, 0, H]);
const HOME = [[0, 0, 0], [0, 0, H], [L1, 0, H], [L1 + L2, 0, H], [L1 + L2 + L3, 0, H]];
const shade = (i) => [mix('orange', 'red', 0.4), mix('orange', 'red', 0.12), mix('orange', 'gold', 0.25), mix('orange', 'gold', 0.6)][i];
const SUB = ['₁', '₂', '₃', '₄'];

const xf = (Tm, p) => [0, 1, 2].map((i) => Tm[i][0] * p[0] + Tm[i][1] * p[1] + Tm[i][2] * p[2] + Tm[i][3]);
const rotv = (Tm, p) => [0, 1, 2].map((i) => Tm[i][0] * p[0] + Tm[i][1] * p[1] + Tm[i][2] * p[2]);
const add = (a, b, k = 1) => a.map((x, i) => x + k * b[i]);
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export default {
  eq: [
    [['T', 'pink'], '(θ) = ', ['e^[S₁]θ₁', 'orange'], ' ', ['e^[S₂]θ₂', 'orange'], ' ', ['e^[S₃]θ₃', 'orange'], ' ', ['e^[S₄]θ₄', 'orange'], ' ', ['M', 'pink']],
    [['Sᵢ', 'orange'], ' = (', ['ωᵢ', 'orange'], ', −', ['ωᵢ', 'orange'], ' × ', ['qᵢ', 'gold'], ')     unit axis ωᵢ through point qᵢ, written at home'],
    [['M', 'pink'], ' = hand pose when every θ = 0   🏠'],
    [['J_s', 'orange'], ' = [ ', ['S₁', 'orange'], '  Ad(e^[S₁]θ₁)', ['S₂', 'orange'], '  …  ]      ', ['V_s', 'pink'], ' = ', ['J_s', 'orange'], ' θ̇'],
  ],
  setup({ stage, ui }) {
    const pen = stage.g;
    const v = new View3D(pen, { yaw: -1.2, pitch: 0.36, dist: 4.8, target: [1.0, 0, 1.0] });
    const s = { beat: 0, t: 0, q: [0.7, 0.55, -0.95, 0.55], order: 1, touched: false };

    ui.beats(['🏠', '🔩', '🔗', '🕹️'], (b) => {
      s.beat = b; s.t = 0;
      gq.style.display = b >= 2 ? '' : 'none';
      go.style.display = b === 2 ? '' : 'none';
    });
    const gq = ui.group(), go = ui.group();
    const sl = [0, 1, 2, 3].map((i) => ui.slider({
      into: gq, icon: `θ${SUB[i]}`, color: shade(i), min: -Math.PI, max: Math.PI, step: 0.01, value: s.q[i], width: 90,
      title: `joint ${i + 1}`, onInput: (x) => { s.q[i] = x; s.t = 0; s.touched = true; },
    }));
    void sl;
    ui.choice({
      into: go, value: 1, color: 'orange', onChange: (x) => { s.order = x; s.t = 0; },
      options: [{ icon: '1→4', value: 1, title: 'base first' }, { icon: '4→1', value: -1, title: 'hand first' }],
    });
    gq.style.display = 'none'; go.style.display = 'none';
    ui.readout(() => { const p = transOf(poeFK(SCREWS, M, liveQ())); return `${fmt(p[0], 1)} ${fmt(p[1], 1)} ${fmt(p[2], 1)}`; }, { icon: '🖐️', color: 'pink', title: 'hand position' });

    const STEP = 1.3, HOLD = 1.6;
    // joint angles being shown right now
    const liveQ = () => {
      if (s.beat === 0) return [0, 0, 0, 0];
      if (s.beat === 1) {
        const k = Math.floor(s.t / 2.2) % 4, ph = (s.t % 2.2) / 2.2;
        return [0, 1, 2, 3].map((i) => (i === k ? 0.5 * Math.sin(ph * 2 * Math.PI) : 0));
      }
      if (s.beat === 2) {
        const T = s.t % (4 * STEP + HOLD);
        return s.q.map((x, i) => {
          const slot = s.order === 1 ? i : 3 - i;
          return x * smoothstep((T - slot * STEP) / (STEP * 0.85));
        });
      }
      return s.q;
    };
    const activeJoint = () => {
      if (s.beat === 1) return Math.floor(s.t / 2.2) % 4;
      if (s.beat === 2) { const T = s.t % (4 * STEP + HOLD), slot = Math.floor(T / STEP); if (slot > 3) return -1; return s.order === 1 ? slot : 3 - slot; }
      return -1;
    };

    return {
      update(dt) { s.t += dt; v.tick(dt); },
      draw() {
        const q = liveQ(), act = activeJoint();
        const { frames, end } = poeFrames(SCREWS, M, q);
        v.begin();
        v.floor(2, 0.5);
        v.frame(eye(3), [0, 0, 0], 0.6, { width: 3, alpha: 0.8 });

        // the screw axes, fixed in space (home)
        if (s.beat >= 1) {
          for (let i = 0; i < 4; i++) {
            const on = s.beat === 1 ? i === act : true;
            glowLine(v, Q[i], W[i], shade(i), on ? 1 : 0.3, i === 0 ? [-0.2, 2.2] : [-1.4, 1.4]);
            if (s.beat === 1 && on) {
              v.point(Q[i], 7, { color: 'gold', ring: 'bg' });
              v.text(`q${SUB[i]}`, add(Q[i], [0, 0.25, -0.25]), { color: 'gold', size: 17 });
              v.arrow(Q[i], add(Q[i], W[i], 0.75), { color: shade(i), width: 5, head: 14 });
              v.text(`ω${SUB[i]}`, add(Q[i], W[i], 0.95), { color: shade(i), size: 17 });
              const nrm = W[i];
              v.circle(Q[i], nrm, 0.32, { color: shade(i), width: 3, from: 0, to: 4.8 });
            }
          }
        }
        // home ghost
        if (s.beat !== 0) drawArm(v, HOME.map((p) => p), null, { ghost: true });
        // the arm now
        const pts = [HOME[0], HOME[1], xf(frames[1], HOME[2]), xf(frames[2], HOME[3]), xf(frames[3], HOME[4])];
        drawArm(v, pts, frames, { act });
        // the axis of the joint that is turning right now, where it really is
        if (s.beat === 2 && act >= 0) {
          const Js = spaceJacobian(SCREWS, q);
          const S = Js.map((r) => r[act]);
          const w = S.slice(0, 3), pnt = crs(w, S.slice(3));
          glowLine(v, pnt, w, shade(act), 1, [-1.2, 1.2]);
        }
        // hand frame + home frame M
        v.frameT(end, 0.55, { width: 4 });
        if (s.beat === 0) {
          v.frameT(M, 0.8, { width: 5, head: 15 });
          v.line([0, 0, 0], transOf(M), { color: 'pink', width: 3, dash: [6, 5] });
          v.text('M', add(transOf(M), [0, 0, 0.45]), { color: 'pink', size: 24, weight: 800 });
          v.text('🏠', add(transOf(M), [0, 0, 0.85]), { size: 26 });
        }
        if (s.beat === 3) {
          // space-Jacobian columns: each joint's twist and the hand speed it would cause
          const Js = spaceJacobian(SCREWS, q);
          const p = transOf(end);
          for (let i = 0; i < 4; i++) {
            const S = Js.map((r) => r[i]), w = S.slice(0, 3), vv = S.slice(3);
            const pnt = crs(w, vv);
            const vp = add(vv, crs(w, p));                // hand point velocity from this column
            v.arrow(p, add(p, vp, 0.6), { color: shade(i), width: 4, head: 13 });
            v.arrow(pnt, add(pnt, w, 0.55), { color: shade(i), width: 3, head: 11, alpha: 0.85 });
          }
        }
        v.flush();
        if (s.beat === 0) drawM(stage.hud);
        if (s.beat === 1) drawS(stage.hud, act);
        if (s.beat === 2) drawTiles(stage.hud, act, s.order);
        if (s.beat === 3) drawJ(stage.hud, spaceJacobian(SCREWS, q));
        void mvec; void poeFK;
      },
    };
  },
};

function glowLine(v, p, w, color, a, [t0, t1]) {
  const A = add(p, w, t0), B = add(p, w, t1);
  v.line(A, B, { color: alpha(color, 0.22 * a), width: 12, bias: 0.3 });
  v.line(A, B, { color, width: 2.5, alpha: a, dash: [7, 5] });
}

function drawArm(v, P, frames, o = {}) {
  const g = o.ghost;
  const lc = g ? alpha('slate', 0.18) : 'slate';
  v.cylinder([0, 0, 0], [0, 0, 0.12], 0.42, { color: g ? alpha('slate', 0.12) : 'slate', sides: 16 });
  v.cylinder([0, 0, 0.12], P[1], 0.11, { color: lc, sides: 10 });
  for (let i = 1; i < 4; i++) v.cylinder(P[i], P[i + 1], i === 3 ? 0.07 : 0.1, { color: lc, sides: 10 });
  // joints: short cylinders along each current axis
  for (let i = 0; i < 4; i++) {
    const R = !frames || i === 0 ? eye(4) : frames[i - 1];
    const w = rotv(R, W[i]), c = i === 0 ? [0, 0, 0.45] : P[i];
    const half = i === 0 ? 0.2 : 0.17, r = i === 0 ? 0.17 : 0.15;
    const col = g ? alpha(shade(i), 0.2) : o.act === i ? mix('gold', 'orange', 0.3) : shade(i);
    v.cylinder(add(c, w, -half), add(c, w, half), r, { color: col, sides: 14 });
  }
  v.sphere(P[4], 0.1, { color: g ? alpha('pink', 0.3) : 'pink' });
}

function hudBox(ctx, x, y, w, h) {
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
}
function cellText(ctx, t, x, y, color, size = 14, weight = 700) {
  ctx.font = `${weight} ${size}px ui-rounded, system-ui, sans-serif`; ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y);
}

// M as a 4×4: rotation columns red/green/blue, position pink
function drawM(hud) {
  const ctx = hud.ctx, cw = 46, ch = 26, X = hud.area.w - cw * 4 - 30, Y = 14;
  ctx.save();
  hudBox(ctx, X - 30, Y, cw * 4 + 46, ch * 4 + 12);
  cellText(ctx, 'M', X - 15, Y + 6 + ch * 2, C.pink, 20, 800);
  const cols = [C.red, C.green, C.blue, C.pink];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) cellText(ctx, fmt(M[r][c], 2), X + cw * (c + 0.5), Y + 6 + ch * (r + 0.5), r === 3 ? C.muted : cols[c]);
  ctx.restore();
}

// the four screw axes as columns (ω on top, v below)
function drawS(hud, act) {
  const ctx = hud.ctx, cw = 50, ch = 22, X = hud.area.w - cw * 4 - 22, Y = 14;
  ctx.save();
  hudBox(ctx, X - 26, Y, cw * 4 + 36, ch * 7 + 14);
  for (let c = 0; c < 4; c++) {
    if (c === act) { ctx.fillStyle = alpha(shade(c), 0.3); ctx.beginPath(); ctx.roundRect(X + cw * c + 3, Y + 5, cw - 6, ch * 7 + 4, 8); ctx.fill(); }
    cellText(ctx, `S${SUB[c]}`, X + cw * (c + 0.5), Y + 6 + ch * 0.5, shade(c), 15, 800);
    for (let r = 0; r < 6; r++) cellText(ctx, fmt(SCREWS[c][r], 1), X + cw * (c + 0.5), Y + 6 + ch * (r + 1.5) + (r >= 3 ? 3 : 0), r < 3 ? shade(c) : C.ink, 13);
  }
  cellText(ctx, 'ω', X - 12, Y + 6 + ch * 2.5, C.orange, 15, 800);
  cellText(ctx, 'v', X - 12, Y + 6 + ch * 5.5 + 3, C.ink, 15, 800);
  ctx.restore();
}

// the product, one factor at a time
function drawTiles(hud, act, order) {
  const ctx = hud.ctx, Wd = hud.area.w;
  const tw = Math.min(70, (Wd - 30) / 6.2), th = 40, gap = 5;
  const total = 5 * (tw + gap) + tw * 0.4;
  let x = Math.max(8, Wd - total - 16);
  const y = 14;
  ctx.save();
  hudBox(ctx, x - 8, y - 6, total + 14, th + 12);
  const done = (i) => act < 0 || (order === 1 ? i < act : i > act);
  for (let i = 0; i < 5; i++) {
    const isM = i === 4, c = isM ? C.pink : shade(i);
    const on = !isM && i === act, dn = isM || done(i);
    ctx.fillStyle = alpha(c, on ? 0.45 : dn ? 0.22 : 0.06); ctx.strokeStyle = c; ctx.lineWidth = on ? 3 : 1.2;
    ctx.beginPath(); ctx.roundRect(x, y, tw, th, 9); ctx.fill(); ctx.stroke();
    cellText(ctx, isM ? 'M' : `e^[S${SUB[i]}]θ${SUB[i]}`, x + tw / 2, y + th / 2, isM ? C.pink : c, Math.round(tw * (isM ? 0.32 : 0.2)), 800);
    x += tw + gap;
  }
  ctx.font = `${Math.round(tw * 0.32)}px system-ui, "Apple Color Emoji", sans-serif`;
  ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('=🖐️', x + tw * 0.15, y + th / 2);
  ctx.restore();
}

// the space Jacobian, columns tinted per joint
function drawJ(hud, J) {
  const ctx = hud.ctx, cw = 50, ch = 22, X = hud.area.w - cw * 4 - 22, Y = 14;
  ctx.save();
  hudBox(ctx, X - 26, Y, cw * 4 + 36, ch * 7 + 14);
  for (let c = 0; c < 4; c++) {
    ctx.fillStyle = alpha(shade(c), 0.16); ctx.beginPath(); ctx.roundRect(X + cw * c + 3, Y + 5, cw - 6, ch * 7 + 4, 8); ctx.fill();
    cellText(ctx, `J${SUB[c]}`, X + cw * (c + 0.5), Y + 6 + ch * 0.5, shade(c), 15, 800);
    for (let r = 0; r < 6; r++) cellText(ctx, fmt(J[r][c], 1), X + cw * (c + 0.5), Y + 6 + ch * (r + 1.5) + (r >= 3 ? 3 : 0), shade(c), 13);
  }
  cellText(ctx, 'ω', X - 12, Y + 6 + ch * 2.5, C.orange, 15, 800);
  cellText(ctx, 'v', X - 12, Y + 6 + ch * 5.5 + 3, C.ink, 15, 800);
  ctx.restore();
}
