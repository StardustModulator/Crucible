// Denavit–Hartenberg: walk a little frame from one joint to the next using only
// four moves — turn about z (θ), slide along z (d), slide along x (a), twist about x (α).
import { View3D } from '../viz/view3d.js';
import { C, alpha, mix } from '../viz/palette.js';
import { mmul, eye } from '../core/linalg.js';
import { homog } from '../core/lie.js';
import { dhTransform, dhChain } from '../core/kinematics.js';
import { smoothstep, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const STEP_COL = ['orange', 'teal', 'pink', 'purple'];
const STEP_SYM = ['θ', 'd', 'a', 'α'];
const STEP_ICON = ['⟲z', '↑z', '→x', '⟲x'];
const shade = (i) => [mix('orange', 'red', 0.35), C.orange, mix('orange', 'gold', 0.55)][i];
const SUB = ['₁', '₂', '₃'];

// 4×4 helpers
const xf = (Tm, p) => [0, 1, 2].map((i) => Tm[i][0] * p[0] + Tm[i][1] * p[1] + Tm[i][2] * p[2] + Tm[i][3]);
const ax = (Tm, j) => [Tm[0][j], Tm[1][j], Tm[2][j]];
const org = (Tm) => [Tm[0][3], Tm[1][3], Tm[2][3]];
const add = (a, b, k = 1) => a.map((x, i) => x + k * b[i]);
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export default {
  eq: [
    [['Aᵢ', 'ink'], ' = ', ['Rz(θᵢ)', 'orange'], ' · ', ['Tz(dᵢ)', 'teal'], ' · ', ['Tx(aᵢ)', 'pink'], ' · ', ['Rx(αᵢ)', 'purple']],
    [['θ', 'orange'], ': turn about z₍ᵢ₋₁₎   ', ['d', 'teal'], ': slide along z₍ᵢ₋₁₎   ', ['a', 'pink'], ': slide along xᵢ   ', ['α', 'purple'], ': twist about xᵢ'],
    ['xᵢ ⟂ zᵢ₋₁ and xᵢ ⟂ zᵢ  (the common normal between the two joint axes)'],
    [['T', 'ink'], ' = A₁ A₂ A₃ …       revolute joint → ', ['θᵢ', 'orange'], ' moves, ', ['d', 'teal'], ', ', ['a', 'pink'], ', ', ['α', 'purple'], ' fixed'],
  ],
  setup({ stage, ui }) {
    const pen = stage.g;
    const v = new View3D(pen, { yaw: -1.0, pitch: 0.3, dist: 4.6, target: [0.55, 0.45, 1.0] });
    const s = { p: [0.9, 0.8, 1.4, 0.95], beat: 0, t: 0, q: [0.5, 0.6, -1.0], touched: false };
    const B = homog(eye(3), [0, 0, 0.5]);

    ui.beats(['🔄', '⬆️', '➡️', '🌀', '🦾'], (b) => {
      s.beat = b; s.t = 0;
      g4.style.display = b < 4 ? '' : 'none'; g3.style.display = b === 4 ? '' : 'none';
      v.target = b === 4 ? [0.5, 0.3, 1.0] : [0.55, 0.45, 1.0]; v.dist = b === 4 ? 5.0 : 4.6;
    });
    const g4 = ui.group(), g3 = ui.group();
    const rng4 = [[-Math.PI, Math.PI], [0, 1.6], [0, 2], [-Math.PI, Math.PI]];
    STEP_SYM.forEach((sym, i) => ui.slider({
      into: g4, icon: sym, color: STEP_COL[i], min: rng4[i][0], max: rng4[i][1], step: 0.01, value: s.p[i],
      title: ['turn θ', 'slide d', 'slide a', 'twist α'][i], onInput: (x) => (s.p[i] = x),
    }));
    const sl3 = [0, 1, 2].map((i) => ui.slider({
      into: g3, icon: `θ${SUB[i]}`, color: shade(i), min: -Math.PI, max: Math.PI, step: 0.01, value: s.q[i],
      title: `joint ${i + 1}`, onInput: (x) => { s.q[i] = x; s.touched = true; },
    }));
    g3.style.display = 'none';

    const CYC = 3.6;
    return {
      update(dt) {
        s.t += dt; v.tick(dt);
        if (s.beat === 4 && !s.touched) {
          s.q = [0.5 + 0.6 * Math.sin(s.t * 0.5), 0.6 + 0.4 * Math.sin(s.t * 0.7 + 1), -1.0 + 0.6 * Math.sin(s.t * 0.9 + 2)];
          sl3.forEach((x, i) => x.set(s.q[i]));
        }
      },
      draw() {
        v.begin();
        v.floor(1.5, 0.5);
        if (s.beat < 4) {
          const k = s.beat;
          const ph = s.t % CYC;
          const u = smoothstep((ph - 0.5) / 1.8);
          const fr = [0, 1, 2, 3].map((j) => (j < k ? 1 : j === k ? u : 0));
          const [th, d, a, al] = s.p;
          const Tfull = mmul(B, dhTransform({ theta: th, d, a, alpha: al }));
          const Tnow = mmul(B, dhTransform({ theta: th * fr[0], d: d * fr[1], a: a * fr[2], alpha: al * fr[3] }));
          const O0 = org(B), O1 = org(Tfull);
          const Tth = mmul(B, dhTransform({ theta: th, d: 0, a: 0, alpha: 0 }));
          const xi = ax(Tth, 0);                       // the new x direction (common normal)
          const pd = add(O0, [0, 0, d]);
          // the two joint axes
          jointAxis(v, B, 'orange', 1);
          jointAxis(v, Tfull, 'orange', 1);
          // the physical link: up the first axis, then along the common normal
          // the physical link, coloured by the move that builds it: d (teal) then a (pink)
          const dd = d * (k === 1 ? u : k > 1 ? 1 : 0), aa = a * (k === 2 ? u : k > 2 ? 1 : 0);
          if (d > 0.01) v.cylinder(O0, pd, 0.075, { color: alpha('teal', 0.25), sides: 10 });
          if (dd > 0.01) v.cylinder(O0, add(O0, [0, 0, dd]), 0.09, { color: 'teal', sides: 10 });
          if (a > 0.01) v.cylinder(pd, O1, 0.075, { color: alpha('pink', 0.25), sides: 10 });
          if (aa > 0.01) v.cylinder(pd, add(pd, xi, aa), 0.09, { color: 'pink', sides: 10 });
          // the four moves: done = solid, now = animated, later = faint
          const st = (j) => (j < k ? 1 : j === k ? 1 : 0.22);
          // θ: arc about z from x_{i-1} to x_i
          arc(v, O0, [0, 0, 1], [1, 0, 0], th * (k === 0 ? u : 1), 0.95, STEP_COL[0], st(0));
          v.text('θ', add(O0, [Math.cos(th / 2) * 1.18, Math.sin(th / 2) * 1.18, 0]), { color: STEP_COL[0], size: 20, weight: 800 });
          // d: slide along z
          v.text('d', add(O0, [-0.22, -0.22, d / 2]), { color: STEP_COL[1], size: 20, weight: 800 });
          // a: slide along x_i
          v.text('a', add(add(pd, xi, a / 2), [0, 0, 0.22]), { color: STEP_COL[2], size: 20, weight: 800 });
          // α: twist about x_i from z_{i-1} to z_i
          arc(v, O1, xi, [0, 0, 1], al * (k === 3 ? u : 1), 0.75, STEP_COL[3], st(3));
          const zm = rotAbout([0, 0, 1], xi, al / 2);
          v.text('α', add(O1, zm, 0.98), { color: STEP_COL[3], size: 20, weight: 800 });
          // frames: start (faint), goal (ghost), and the traveller
          v.frame(eye(3), O0, 0.7, { width: 2.5, alpha: 0.45 });
          v.frameT(Tfull, 0.7, { width: 2.5, alpha: 0.3 });
          v.frameT(Tnow, 1.05, { width: 5, head: 15, dot: 6 });
          v.flush();
          drawTiles(stage.hud, s.p, k, u);
        } else {
          const rows = [
            { theta: s.q[0], d: 1.0, a: 0, alpha: Math.PI / 2 },
            { theta: s.q[1], d: 0, a: 1.3, alpha: 0 },
            { theta: s.q[2], d: 0, a: 1.1, alpha: 0 },
          ];
          const B4 = homog(eye(3), [0, 0, 0.4]);
          const frames = dhChain(rows).frames.map((F) => mmul(B4, F));
          v.cylinder([0, 0, 0], [0, 0, 0.1], 0.5, { color: 'slate', sides: 18 });
          v.cylinder([0, 0, 0.1], [0, 0, 0.2], 0.24, { color: 'slate', sides: 14 });
          for (let i = 0; i < 3; i++) {
            const A = frames[i], Bf = frames[i + 1];
            v.cylinder(org(A), org(Bf), 0.1, { color: alpha('slate', 0.9), sides: 8 });
            jointAxis(v, A, shade(i), 0.8);
          }
          for (let i = 0; i <= 3; i++) v.frameT(frames[i], i === 3 ? 0.6 : 0.5, { width: i === 3 ? 4 : 2.5 });
          v.sphere(org(frames[3]), 0.13, { color: 'pink' });
          v.flush();
          drawTable(stage.hud, rows);
        }
      },
    };
  },
};

// rotate vector p about unit axis n by angle t (Rodrigues)
function rotAbout(p, n, t) {
  const c = Math.cos(t), s = Math.sin(t), d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2], x = crs(n, p);
  return [0, 1, 2].map((i) => p[i] * c + x[i] * s + n[i] * d * (1 - c));
}

// joint = short fat cylinder along the frame's z, plus its long dashed axis line
function jointAxis(v, Tm, color, k) {
  const o = org(Tm), z = ax(Tm, 2);
  v.line(add(o, z, -1.1 * k), add(o, z, 1.5 * k), { color: alpha('blue', 0.5), width: 2, dash: [6, 5] });
  v.cylinder(add(o, z, -0.28 * k), add(o, z, 0.28 * k), 0.17 * k, { color, sides: 14 });
}

// a filled arc showing a turn of angle t about axis n, starting from direction e1
function arc(v, c, n, e1, t, r, color, a) {
  if (Math.abs(t) < 1e-3) return;
  const e2 = crs(n, e1);
  const N = Math.max(6, Math.ceil(Math.abs(t) * 14));
  const pts = [];
  for (let i = 0; i <= N; i++) { const s = (t * i) / N; pts.push(add(add(c, e1, r * Math.cos(s)), e2, r * Math.sin(s))); }
  v.poly([c, ...pts], { color: alpha(color, 0.22 * a), shade: false });
  v.path(pts, { color, width: 4, alpha: a });
  const end = pts[N], prev = pts[N - 1];
  const dir = add(end, prev, -1), L = Math.hypot(...dir) || 1;
  v.arrow(prev, add(end, dir, 0.12 / L), { color, width: 4, head: 13, alpha: a });
}

// HUD: the four moves as tiles, the active one glowing
function drawTiles(hud, p, k, u) {
  const ctx = hud.ctx, W = hud.area.w;
  const tw = Math.min(76, (W - 40) / 4.6), th = 54, gap = 6;
  const total = 4 * tw + 3 * gap;
  let x = Math.max(10, W - total - 18);
  const y = 14;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(x - 8, y - 6, total + 16, th + 12, 12); ctx.fill();
  for (let j = 0; j < 4; j++) {
    const c = C[STEP_COL[j]], active = j === k, done = j < k;
    ctx.fillStyle = alpha(STEP_COL[j], active ? 0.25 + 0.25 * u : done ? 0.22 : 0.06);
    ctx.strokeStyle = c; ctx.lineWidth = active ? 3.5 : 1.2;
    ctx.beginPath(); ctx.roundRect(x, y, tw, th, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(tw * 0.24)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillText(`${STEP_ICON[j]} ${STEP_SYM[j]}`, x + tw / 2, y + th * 0.32);
    ctx.font = `700 ${Math.round(tw * 0.22)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillText(j === 0 || j === 3 ? `${Math.round((p[j] * 180) / Math.PI)}°` : fmt(p[j], 2), x + tw / 2, y + th * 0.72);
    x += tw + gap;
  }
  ctx.restore();
}

// HUD: the DH table of the little arm
function drawTable(hud, rows) {
  const ctx = hud.ctx, W = hud.area.w;
  const cw = Math.min(60, (W - 60) / 4.4), ch = 28;
  const X = Math.max(8, W - cw * 4 - 46), Y = 14;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(X - 30, Y, cw * 4 + 40, ch * 4 + 12, 12); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 16px ui-rounded, system-ui, sans-serif';
  STEP_SYM.forEach((sym, j) => { ctx.fillStyle = C[STEP_COL[j]]; ctx.fillText(sym, X + cw * (j + 0.5), Y + 6 + ch / 2); });
  rows.forEach((r, i) => {
    const yy = Y + 6 + ch * (i + 1.5);
    ctx.fillStyle = shade(i); ctx.font = '800 14px ui-rounded, system-ui, sans-serif';
    ctx.fillText(String(i + 1), X - 14, yy);
    ctx.font = '700 14px ui-rounded, system-ui, sans-serif';
    const vals = [`${Math.round((r.theta * 180) / Math.PI)}°`, fmt(r.d, 1), fmt(r.a, 1), `${Math.round((r.alpha * 180) / Math.PI)}°`];
    vals.forEach((t, j) => {
      if (j === 0) { ctx.fillStyle = alpha('orange', 0.18); ctx.beginPath(); ctx.roundRect(X + 3, yy - ch / 2 + 2, cw - 6, ch - 4, 6); ctx.fill(); }
      ctx.fillStyle = j === 0 ? shade(i) : C[STEP_COL[j]];
      ctx.fillText(t, X + cw * (j + 0.5), yy);
    });
  });
  ctx.restore();
  void clamp;
}
