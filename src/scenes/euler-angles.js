// Euler angles: three rings inside each other (yaw, pitch, roll) hold a toy plane.
// Turn them one at a time and you can reach any pose… until the middle ring
// tips 90°: then the outer and inner rings spin about the SAME line and one
// way of wiggling is simply gone (gimbal lock). Quaternions don't have rings.
import { View3D } from '../viz/view3d.js';
import { C, alpha } from '../viz/palette.js';
import { mmul, eye, vnormalize } from '../core/linalg.js';
import { rotX, rotY, rotZ, expSO3, qFromMat, logSO3 } from '../core/lie.js';
import { smoothstep, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const CEN = [0, 0, 2.3];
const at = (R, l, c = CEN) => [0, 1, 2].map((i) => c[i] + R[i][0] * l[0] + R[i][1] * l[1] + R[i][2] * l[2]);
const colOf = (R, j) => [R[0][j], R[1][j], R[2][j]];

function toyPlane(v, R, p, o = {}) {
  const a = o.alpha ?? 1, k = o.scale ?? 1, P = (l) => at(R, l.map((x) => x * k), p);
  v.box(R, p, [0.75 * k, 0.13 * k, 0.13 * k], { color: o.body ?? 'slate', alpha: a });
  v.box(R, P([0.05, 0, 0]), [0.22 * k, 0.85 * k, 0.03 * k], { color: o.wing ?? 'blue', alpha: a });
  v.box(R, P([-0.62, 0, 0.18]), [0.1 * k, 0.03 * k, 0.2 * k], { color: o.tail ?? 'orange', alpha: a });
  v.box(R, P([-0.62, 0, 0.02]), [0.08 * k, 0.3 * k, 0.02 * k], { color: o.wing ?? 'blue', alpha: a });
  v.sphere(P([0.8, 0, 0]), 0.1 * k, { color: 'pink', alpha: a });
}
// ZYX angles back out of a rotation matrix
const eulerOf = (R) => [Math.atan2(R[1][0], R[0][0]), Math.asin(clamp(-R[2][0], -1, 1)), Math.atan2(R[2][1], R[2][2])];

export default {
  eq: [
    ['R = ', ['R_z(ψ)', 'blue'], ' ', ['R_y(θ)', 'green'], ' ', ['R_x(φ)', 'red'], '      (yaw, pitch, roll — outer → inner ring)'],
    ['wiggle axes: ', ['ẑ', 'blue'], ',  ', ['R_z ŷ', 'green'], ',  ', ['R_z R_y x̂', 'red'], '      det[…] = cos θ'],
    ['θ = ±90°  ⇒  ', ['yaw axis', 'blue'], ' ∥ ', ['roll axis', 'red'], '  ⇒  only 2 ways to wiggle (', ['gimbal lock', 'coral'], ')'],
    [['R_z R_y R_x', 'ink'], ' ≠ ', ['R_x R_y R_z', 'ink'], '   (order matters)        fix: 🌐 quaternions — no rings, no lock'],
  ],
  setup({ stage, ui }) {
    const v = new View3D(stage.g, { yaw: -0.65, pitch: 0.28, dist: 8.2, target: [0.4, 0.5, 1.9] });
    const s = { beat: 0, t: 0, ang: [0.5, 0.35, 0.3], lockAuto: true, cur: [0.5, 0.35, 0.3] };

    const sl = [['🔵', 'blue', 'yaw (outer ring)'], ['🟢', 'green', 'pitch (middle ring)'], ['🔴', 'red', 'roll (inner ring)']].map(([icon, color, title], i) =>
      ui.slider({ icon, color, min: i === 1 ? -Math.PI / 2 : -Math.PI, max: i === 1 ? Math.PI / 2 : Math.PI, step: 0.01, value: s.ang[i], title, onInput: (x) => { s.ang[i] = x; if (i === 1) s.lockAuto = false; } }));
    const homeBtn = ui.button({ icon: '🏠', title: 'home', onClick: () => { s.ang = [0, 0, 0]; sl.forEach((x) => x.set(0)); } });
    const lockBtn = ui.button({ icon: '🔒', title: 'tip to 90°', onClick: () => { s.ang[1] = Math.PI / 2 - 0.001; sl[1].set(s.ang[1]); s.lockAuto = false; } });
    const roomRead = ui.readout(() => fmt(Math.abs(Math.cos(s.cur[1])), 2), { icon: '📦', color: 'purple', title: 'wiggle room (det = cos θ)' });
    const setAng = (a) => { s.ang = a.slice(); sl.forEach((x, i) => x.set(a[i])); };
    ui.beats(['🎡', '🔒', '🔢', '🌐'], (b) => {
      s.beat = b; s.t = 0; s.lockAuto = true;
      v.dist = b === 2 ? 7.6 : 8.2; v.target = b === 2 ? [0, 0, 1.5] : [0.4, 0.5, 1.9];
      if (b === 2) setAng([1.0, 0.6, 1.3]);
      else if (b === 1) setAng([v.yaw + 0.1, 0.2, 0.4]);
      else if (Math.abs(s.ang[1]) > 1.3) setAng([0.5, 0.35, 0.3]);
      showCtl(b);
    });
    // controls a beat doesn't use are taken out of the dock
    const ctlGroups = [...sl.map((x) => x.el.parentElement), homeBtn.parentElement, lockBtn.parentElement, roomRead.parentElement];
    const showCtl = (b) => { ctlGroups.forEach((el) => el.remove()); ctlGroups.forEach((el, i) => { if ((i < 4 && b !== 3) || (i === 4 && b === 1) || i === 5) ui.dock.appendChild(el); }); };
    showCtl(0);

    // ------------------------------------------------------------ the gimbal
    function frames(a) {
      const Ry = rotZ(a[0]), Rp = mmul(Ry, rotY(a[1])), Rr = mmul(Rp, rotX(a[2]));
      return { Ry, Rp, Rr };
    }
    function ring(c, normal, r, color, o = {}) {
      v.circle(c, normal, r, { color, width: o.width ?? 7, alpha: o.alpha ?? 1, segments: 64 });
      v.circle(c, normal, r, { color: alpha('white', 0.22), width: 1, segments: 64 });
    }
    function gimbal(a, o = {}) {
      const { Ry, Rp, Rr } = frames(a);
      const hl = o.active ?? -1, lock = o.lock ?? 0;
      // stand
      v.cylinder([0, 0, 0], [0, 0, CEN[2] - 2.25], 0.08, { color: 'slate', sides: 8 });
      v.box(eye(3), [0, 0, 0.06], [0.7, 0.7, 0.06], { color: 'slate' });
      const outerC = lock > 0 ? 'coral' : 'blue', midC = lock > 0 ? 'coral' : 'green';
      // outer (yaw) ring: pivots on the stand along z
      ring(CEN, colOf(Ry, 0), 2.0, outerC, { width: hl === 0 ? 10 : 7 });
      v.line(at(eye(3), [0, 0, -2.25]), at(eye(3), [0, 0, -1.95]), { color: 'ink', width: 4 });
      v.line(at(eye(3), [0, 0, 1.95]), at(eye(3), [0, 0, 2.25]), { color: 'ink', width: 4 });
      // middle (pitch) ring: pins along the outer ring's y
      ring(CEN, colOf(Rp, 2), 1.7, midC, { width: hl === 1 ? 10 : 7 });
      v.line(at(Ry, [0, 1.65, 0]), at(Ry, [0, 2.0, 0]), { color: 'ink', width: 4 });
      v.line(at(Ry, [0, -1.65, 0]), at(Ry, [0, -2.0, 0]), { color: 'ink', width: 4 });
      // inner (roll) ring: pins along the middle ring's x
      ring(CEN, colOf(Rr, 1), 1.4, 'red', { width: hl === 2 ? 10 : 7 });
      v.line(at(Rp, [1.35, 0, 0]), at(Rp, [1.7, 0, 0]), { color: 'ink', width: 4 });
      v.line(at(Rp, [-1.35, 0, 0]), at(Rp, [-1.7, 0, 0]), { color: 'ink', width: 4 });
      if (hl >= 0) {
        const axis = [[0, 0, 1], colOf(Ry, 1), colOf(Rp, 0)][hl];
        v.line(at(eye(3), axis.map((x) => -x * 2.7)), at(eye(3), axis.map((x) => x * 2.7)), { color: ['blue', 'green', 'red'][hl], width: 2.5, dash: [6, 5] });
      }
      toyPlane(v, Rr, CEN, { alpha: o.planeAlpha });
      return { Ry, Rp, Rr };
    }

    // ------------------------------------------------------------ beats
    function beatTurns() {
      // each ring wiggles in turn
      const P = 2.6, k = Math.floor(s.t / P) % 3, ph = (s.t % P) / P;
      const a = s.ang.slice();
      a[k] += 0.7 * Math.sin(2 * Math.PI * smoothstep(ph));
      s.cur = a;
      gimbal(a, { active: k });
    }

    function beatLock() {
      const a = s.ang.slice();
      if (s.lockAuto) {
        const ph = s.t % 8;
        a[1] = ph < 3 ? (Math.PI / 2) * smoothstep(ph / 3) : ph < 5.5 ? Math.PI / 2 : (Math.PI / 2) * (1 - smoothstep((ph - 5.5) / 2.5));
        a[1] = Math.min(a[1], Math.PI / 2 - 1e-4);
        sl[1].set(a[1]);
      }
      s.cur = a;
      const vol = Math.abs(Math.cos(a[1]));
      const lock = vol < 0.08 ? 1 : 0;
      const { Ry, Rp } = gimbal(a, { lock: lock && Math.sin(s.t * 10) > -0.3 ? 1 : 0, planeAlpha: 0.9 });
      // the three wiggle axes, drawn from the nose: yaw (z), pitch (outer's y), roll (middle's x)
      const W = [[0, 0, 1], colOf(Ry, 1), colOf(Rp, 0)];
      const right = [-Math.sin(v.yaw), Math.cos(v.yaw), 0];
      const o = [CEN[0] + right[0] * 3.1, CEN[1] + right[1] * 3.1, CEN[2] + 0.2];
      const L = 1.2;
      const tip = (w) => o.map((x, i) => x + w[i] * L);
      // the wiggle-room box (parallelepiped) — flat when locked
      const A = tip(W[0]), B = tip(W[1]), Cc = tip(W[2]);
      const add = (p, w) => p.map((x, i) => x + w[i] * L);
      const faces = [[o, A, add(A, W[1]), B], [o, B, add(B, W[2]), Cc], [o, Cc, add(Cc, W[0]), A]];
      for (const f of faces) v.poly(f, { color: alpha(lock ? 'coral' : 'purple', 0.22), shade: false });
      ['blue', 'green', 'red'].forEach((c, i) => v.arrow(o, tip(W[i]), { color: c, width: 5, bias: -0.05 * i }));
      v.point(o, 5, { color: 'ink' });
      if (lock) v.text('🔒', [o[0], o[1], o[2] + 1.25], { size: 30 });
      // both pivot lines of the outer and inner rings — they line up when locked
      v.line(at(eye(3), [0, 0, -2.7]), at(eye(3), [0, 0, 2.7]), { color: alpha('blue', 0.7), width: 2.5, dash: [6, 5] });
      const x = colOf(Rp, 0);
      v.line(at(eye(3), x.map((q) => -q * 2.7)), at(eye(3), x.map((q) => q * 2.7)), { color: alpha('red', 0.7), width: 2.5, dash: [2, 5] });
      return () => stage.g.meter('📦', vol, 1, { color: lock ? 'coral' : 'purple', width: 140 });
    }

    function beatOrder() {
      // same three numbers, two different orders
      const [y, p, r] = s.ang;
      s.cur = s.ang;
      const T = s.t % 7.5, k = [0, 1, 2].map((i) => smoothstep((T - 0.4 - i * 1.6) / 1.3));
      const zyx = mmul(mmul(rotZ(y * k[0]), rotY(p * k[1])), rotX(r * k[2]));           // first yaw, then pitch, then roll (intrinsic)
      const xyz = mmul(mmul(rotX(r * k[0]), rotY(p * k[1])), rotZ(y * k[2]));           // first roll, then pitch, then yaw
      const L = [0, -1.9, 1.6], Rr = [0, 1.9, 1.6];
      for (const [Rm, c] of [[zyx, L], [xyz, Rr]]) {
        v.cylinder([c[0], c[1], 0], [c[0], c[1], c[2] - 0.35], 0.05, { color: 'slate', sides: 6 });
        toyPlane(v, Rm, c);
        v.frame(Rm, c, 1.05, { width: 3 });
      }
      v.text('🔵 🟢 🔴', [L[0], L[1], 3.25], { size: 22 });
      v.text('🔴 🟢 🔵', [Rr[0], Rr[1], 3.25], { size: 22 });
      const diff = Math.hypot(...logSO3(mmul(zyx, [[xyz[0][0], xyz[1][0], xyz[2][0]], [xyz[0][1], xyz[1][1], xyz[2][1]], [xyz[0][2], xyz[1][2], xyz[2][2]]])));
      if (T > 5.3) v.text(diff > 0.05 ? '≠' : '=', [0, 0, 1.7], { size: 44, color: diff > 0.05 ? 'coral' : 'lime' });
    }

    function beatFix() {
      // a gentle motion that passes right by the pole: the plane moves smoothly,
      // but the yaw and roll rings have to whirl — the quaternion just glides.
      const axis = vnormalize([0.06, 1, 0]);
      const R0 = rotY(-0.15);
      const motion = (u) => mmul(expSO3(axis.map((x) => x * (-Math.PI * 0.95 * u))), R0);
      const ph = (s.t % 8) / 8, u = smoothstep(ph < 0.5 ? ph * 2 : 2 - ph * 2);
      const Rm = motion(u);
      const a = eulerOf(Rm);
      s.cur = a;
      gimbal(a, { planeAlpha: 1, lock: Math.abs(Math.cos(a[1])) < 0.1 ? 1 : 0 });
      // sample both stories over the whole motion
      const N = 120, eu = [], qs = [];
      let prevE = null, prevQ = null;
      for (let k = 0; k <= N; k++) {
        const Rk = motion(k / N);
        let e = eulerOf(Rk);
        if (prevE) e = e.map((x, i) => { let d = x - prevE[i]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return prevE[i] + d; });
        let q = qFromMat(Rk);
        if (prevQ && q.reduce((acc, x, i) => acc + x * prevQ[i], 0) < 0) q = q.map((x) => -x);
        eu.push(e); qs.push(q); prevE = e; prevQ = q;
      }
      return () => {
        const ctx = stage.hud.ctx, W = Math.min(190, (stage.hud.area.w - 40) / 2), H = 92, Y = stage.hud.area.h - H - 14;
        miniPlot(ctx, 12, Y, W, H, eu, ['blue', 'green', 'red'], u, Math.PI * 1.1, '🎡');
        miniPlot(ctx, 24 + W, Y, W, H, qs, ['ink', 'red', 'green', 'blue'], u, 1.05, '🌐');
      };
    }
    function miniPlot(ctx, X, Y, W, H, rows, colors, u, scale, icon) {
      ctx.save();
      ctx.fillStyle = alpha('panel', 0.93); ctx.beginPath(); ctx.roundRect(X, Y, W, H, 10); ctx.fill();
      const x0 = X + 30, x1 = X + W - 8, mid = Y + H / 2, k = (H / 2 - 8) / scale;
      ctx.strokeStyle = alpha('muted', 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(x1, mid); ctx.stroke();
      const n = rows.length - 1;
      colors.forEach((c, j) => {
        ctx.strokeStyle = C[c]; ctx.lineWidth = 2.2; ctx.beginPath();
        rows.forEach((r, i) => { const x = x0 + ((x1 - x0) * i) / n, y = mid - clamp(r[j] * k, -H / 2 + 3, H / 2 - 3); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      });
      const cx = x0 + (x1 - x0) * u;
      ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, Y + 4); ctx.lineTo(cx, Y + H - 4); ctx.stroke();
      ctx.font = '18px system-ui, "Noto Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.ink;
      ctx.fillText(icon, X + 16, mid);
      ctx.restore();
    }

    return {
      update(dt) { s.t += dt; v.tick(dt); },
      draw() {
        v.begin();
        v.floor(2.5, 0.5);
        let hud = null;
        if (s.beat === 0) beatTurns();
        else if (s.beat === 1) hud = beatLock();
        else if (s.beat === 2) beatOrder();
        else hud = beatFix();
        v.flush();
        hud?.();
      },
    };
  },
};
