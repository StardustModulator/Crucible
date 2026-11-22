// A rigid move = a turn plus a slide. Pack both into one 3×3 matrix
// T = [R p; 0 1] and moves chain like train cars: world → table → cup.
// The trick behind the "1": lift the flat world up to height 1, and a slide
// becomes a lean (shear) of 3D space.
import { View3D } from '../viz/view3d.js';
import { C, alpha } from '../viz/palette.js';
import { mmul, mvec, inv } from '../core/linalg.js';
import { smoothstep, clamp, wrapAngle } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const T2 = (th, p) => [[Math.cos(th), -Math.sin(th), p[0]], [Math.sin(th), Math.cos(th), p[1]], [0, 0, 1]];
const apply = (T, q) => { const r = mvec(T, [q[0], q[1], 1]); return [r[0], r[1]]; };
const angOf = (T) => Math.atan2(T[1][0], T[0][0]);
const posOf = (T) => [T[0][2], T[1][2]];
const TABLE = [[-1.4, -0.8], [1.4, -0.8], [1.4, 0.8], [-1.4, 0.8]];

// 3×3 homogeneous matrix: R block in red/green columns, p column gold, last row muted.
function drawT(ctx, X, Y, M, { cw = 50, ch = 26, font = 15, title = null, titleColor = 'ink', glow = null } = {}) {
  const W = cw * 3 + 16, H = ch * 3 + 12 + (title ? 22 : 0);
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.93); ctx.beginPath(); ctx.roundRect(X, Y, W, H, 10); ctx.fill();
  if (glow) { ctx.strokeStyle = C[glow]; ctx.lineWidth = 2; ctx.stroke(); }
  const y0 = Y + 6 + (title ? 22 : 0);
  if (title) { ctx.font = `800 ${font}px ui-rounded, system-ui, sans-serif`; ctx.fillStyle = C[titleColor]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(title, X + W / 2, Y + 14); }
  ctx.fillStyle = alpha('gold', 0.14); ctx.beginPath(); ctx.roundRect(X + 8 + cw * 2 + 2, y0, cw - 4, ch * 2, 6); ctx.fill();
  ctx.font = `700 ${font}px ui-rounded, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    ctx.fillStyle = i === 2 ? C.muted : j === 2 ? C.gold : C[j === 0 ? 'red' : 'green'];
    ctx.fillText(i === 2 ? String(M[i][j]) : fmt(M[i][j], 1), X + 8 + cw * (j + 0.5), y0 + ch * (i + 0.5));
  }
  ctx.strokeStyle = alpha('muted', 0.4); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X + 8 + cw * 2, y0 + 2); ctx.lineTo(X + 8 + cw * 2, y0 + ch * 3 - 2); ctx.moveTo(X + 10, y0 + ch * 2); ctx.lineTo(X + W - 10, y0 + ch * 2); ctx.stroke();
  ctx.restore();
  return W;
}

export default {
  eq: [
    [['T', 'ink'], ' = [ ', ['R', 'red'], '  ', ['p', 'gold'], ' ; 0  1 ]      ', ['x', 'teal'], '′ = ', ['R', 'red'], ['x', 'teal'], ' + ', ['p', 'gold'], '   (turn, then slide)'],
    [['T', 'pink'], '_wc = ', ['T', 'orange'], '_wt · ', ['T', 'pink'], '_tc      (world → table → cup)'],
    [['T', 'ink'], '⁻¹ = [ ', ['R', 'red'], 'ᵀ  −', ['R', 'red'], 'ᵀ', ['p', 'gold'], ' ; 0  1 ]'],
    ['[x y 1]: the plane at height 1 — a slide ', ['p', 'gold'], ' is a shear of 3D;  [x y 0] (arrows) ignore ', ['p', 'gold']],
  ],
  setup({ stage, ui }) {
    const s = { beat: 0, t: 0, tp: [3.4, 1.4], tth: 0.35, cp: [0.75, 0.25], cth: 0.9, u: 1, auto: true };
    // two panels, the 3D one only shows up in the last beat
    const rect2 = (W, H) => (s.beat !== 3 ? { x: 0, y: 0, w: 1, h: 1 } : W >= H * 1.05 ? { x: 0, y: 0, w: 0.5, h: 1 } : { x: 0, y: 0, w: 1, h: 0.5 });
    const rect3 = (W, H) => (s.beat !== 3 ? { x: 0, y: 0, w: 0, h: 0 } : W >= H * 1.05 ? { x: 0.5, y: 0, w: 0.5, h: 1 } : { x: 0, y: 0.5, w: 1, h: 0.5 });
    const g = stage.pen(rect2, [-1.3, -1.3, 7.2, 4.4]);
    const p3 = stage.pen(rect3, [-1, -1, 1, 1]);
    const v = new View3D(p3, { yaw: -1.1, pitch: 0.38, dist: 4.3, target: [0.9, 0.55, 0.5] });
    const relayout = () => { g.layout(); p3.layout(); };

    const Twt = () => T2(s.tth, s.tp), Ttc = () => T2(s.cth, s.cp), Twc = () => mmul(Twt(), Ttc());
    const inV = (p) => [clamp(p[0], g.view[0] + 0.2, g.view[2] - 0.2), clamp(p[1], g.view[1] + 0.2, g.view[3] - 0.2)];
    // table: slide handle + turn handle
    stage.handle({ pen: g, color: 'orange', kind: 'square', r: 10, visible: () => s.beat !== 3, get: () => s.tp, set: (p) => (s.tp = inV(p)) });
    stage.handle({ pen: g, color: 'orange', kind: 'ring', r: 9, visible: () => s.beat !== 3, get: () => apply(Twt(), [1.25, 0]), set: (p) => (s.tth = Math.atan2(p[1] - s.tp[1], p[0] - s.tp[0])) });
    // cup: slide + turn (stored in the table's frame, but grabbed in the world)
    const cupVis = () => s.beat === 1 || s.beat === 2;
    stage.handle({ pen: g, color: 'pink', r: 9, visible: cupVis, get: () => posOf(Twc()), set: (p) => { const q = apply(inv(Twt()), inV(p)); s.cp = q; } });
    stage.handle({ pen: g, color: 'pink', kind: 'ring', r: 8, visible: cupVis, get: () => apply(Twc(), [0.8, 0]), set: (p) => { const c = posOf(Twc()); s.cth = wrapAngle(Math.atan2(p[1] - c[1], p[0] - c[0]) - s.tth); } });

    const g3 = ui.group();
    ui.beats(['📦', '🔗', '↩️', '🪜'], (b) => { s.beat = b; s.t = 0; relayout(); if (b === 3) ui.dock.appendChild(g3); else g3.remove(); });
    ui.button({ icon: '🏠', title: 'home pose', onClick: () => { s.tp = [0, 0]; s.tth = 0; } });
    ui.button({ icon: '🔄', title: 'turn only', onClick: () => { s.tp = [0, 0]; s.tth = 1.2; } });
    ui.button({ icon: '➡️', title: 'slide only', onClick: () => { s.tp = [3.4, 1.4]; s.tth = 0; } });
    ui.readout(() => `${Math.round((wrapAngle(s.tth) * 180) / Math.PI)}°`, { icon: '🔄', color: 'orange', title: 'table turn' });
    const uSl = ui.slider({ icon: '🪜', color: 'gold', min: 0, max: 1, step: 0.01, value: 1, title: 'amount of move', into: g3, onInput: (x) => { s.u = x; s.auto = false; } });
    ui.button({ icon: '🎬', title: 'play', into: g3, onClick: () => (s.auto = true) });
    g3.remove();

    // ------------------------------------------------------------ drawing
    function world() {
      g.grid({ step: 1 });
      g.frame([0, 0], 0, 0.9, { width: 3.5 });
      g.emoji('🌍', [-0.55, -0.55], 22);
    }
    function table(T, o = {}) {
      const a = o.alpha ?? 1;
      g.poly(TABLE.map((q) => apply(T, q)), { fill: alpha('slate', 0.22 * a), color: alpha('slate', 0.8 * a), width: 2.5 });
      // legs at the corners (seen from above)
      for (const q of TABLE) g.dot(apply(T, [q[0] * 0.85, q[1] * 0.8]), 4, { color: alpha('slate', 0.8 * a) });
      if (o.frame !== false) g.frame(posOf(T), angOf(T), 1.0, { width: 3 * a });
    }
    function cup(T, o = {}) {
      const a = o.alpha ?? 1, c = posOf(T);
      g.circle(c, 0.32, { fill: alpha('pink', 0.25 * a), color: alpha('pink', a), width: 3 });
      g.circle(apply(T, [0, 0.42]), 0.1, { color: alpha('pink', a), width: 3 });
      g.emoji('☕', c, 20, { alpha: a });
      if (o.frame !== false) g.frame(c, angOf(T), 0.7, { width: 2.5 });
    }
    // turn-then-slide replay of a move T, starting from the world origin
    function replay(T, period = 5) {
      const ph = s.t % period, th = angOf(T), p = posOf(T);
      const a = smoothstep((ph - 0.4) / 1.3), b = smoothstep((ph - 2.0) / 1.5);
      return { M: T2(th * a, [p[0] * b, p[1] * b]), a, b, th, p };
    }

    function beatMove() {
      world();
      const T = Twt(), { M, a, th, p } = replay(T);
      table(T, { alpha: 0.25, frame: false });
      // the turn (orange wedge at home) and the slide (gold arrow)
      if (Math.abs(th) > 0.02) g.wedge([0, 0], 1.1, 0, th * a, { color: 'orange', alpha: 0.25 });
      g.arrow([0, 0], p, { color: alpha('gold', 0.9), width: 4, dash: [8, 6] });
      table(M);
      drawT(stage.hud.ctx, stage.hud.area.w - 186, 14, T, { title: 'T', glow: null });
    }

    function beatChain() {
      world();
      const A = Twt(), B = Ttc(), W = Twc();
      table(A);
      cup(W);
      const pt = posOf(A), pc = posOf(W);
      // train cars: world → table → cup, then the direct link
      g.arrow([0, 0], pt, { color: 'orange', width: 4 });
      g.arrow(pt, pc, { color: alpha('pink', 0.8), width: 4 });
      g.arrow([0, 0], pc, { color: alpha('pink', 0.6), width: 3, dash: [8, 6] });
      const ctx = stage.hud.ctx, avail = stage.hud.area.w - 20;
      const cw = Math.min(46, Math.floor((avail - 3 * 16 - 2 * 18) / 9)), P = cw < 40;
      const sz = { cw, ch: P ? 20 : 24, font: P ? 11 : 14 };
      let x = stage.hud.area.w - (3 * (3 * cw + 16) + (P ? 32 : 44)) - 10;
      const y = 12;
      x += drawT(ctx, x, y, A, { ...sz, title: 'T_wt', titleColor: 'orange' });
      ctx.save(); ctx.font = '800 18px ui-rounded, system-ui'; ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('·', x + (P ? 8 : 11), y + 50); ctx.restore();
      x += P ? 16 : 22;
      x += drawT(ctx, x, y, B, { ...sz, title: 'T_tc', titleColor: 'pink' });
      ctx.save(); ctx.font = '800 18px ui-rounded, system-ui'; ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('=', x + (P ? 8 : 11), y + 50); ctx.restore();
      x += P ? 16 : 22;
      drawT(ctx, x, y, W, { ...sz, title: 'T_wc', titleColor: 'pink', glow: 'pink' });
    }

    function beatInverse() {
      world();
      const W = Twc(), th = angOf(W), p = posOf(W);
      table(Twt(), { alpha: 0.35, frame: false });
      cup(W, { alpha: 0.3, frame: false });
      // go back home: first un-slide, then un-turn  (T⁻¹ = un-turn · un-slide)
      const ph = s.t % 5.5, a = smoothstep((ph - 0.5) / 1.5), b = smoothstep((ph - 2.3) / 1.4);
      const M = T2(th * (1 - b), [p[0] * (1 - a), p[1] * (1 - a)]);
      g.arrow(p, [p[0] * (1 - a), p[1] * (1 - a)], { color: alpha('gold', 0.9), width: 4 });
      if (b > 0 && Math.abs(th) > 0.02) g.wedge([0, 0], 0.9, th, th * (1 - b), { color: 'orange', alpha: 0.3 });
      cup(M);
      if (ph > 4) g.emoji('🏠', [0.55, 0.55], 26);
      const Wi = inv(W);
      drawT(stage.hud.ctx, stage.hud.area.w - 186, 14, Wi.map((r, i) => (i === 2 ? [0, 0, 1] : r)), { title: 'T⁻¹', glow: 'gold' });
    }

    function beatLift() {
      // the move, partly applied: M(u) = [R(uθ) u·p; 0 0 1]
      if (s.auto) { const ph = s.t % 6; s.u = smoothstep(ph < 3 ? (ph - 0.4) / 2 : 1 - (ph - 3.4) / 2); uSl.set(s.u); }
      const T = Twt(), M = T2(angOf(T) * s.u, posOf(T).map((x) => x * s.u));
      g.clip(() => {
        world();
        table(T2(0, [0, 0]), { alpha: 0.25, frame: false });
        table(M);
        g.arrow([0, 0], posOf(M), { color: alpha('gold', 0.9), width: 3, dash: [6, 5] });
      });
      drawT(stage.hud.ctx, g.area.x + 10, g.area.y + 10, M, stage.portrait ? { cw: 36, ch: 20, font: 12, title: 'M', titleColor: 'gold' } : { title: 'M', titleColor: 'gold' });
      // 3D: world points live at height z = 1; shown scaled by k in x, y
      const k = 0.42, D = (x, y, z) => [k * x, k * y, z];
      v.begin();
      v.floor(1.6, 0.4);
      // the "height 1" sheet
      const sh = [[-1.5, -1.5], [6, -1.5], [6, 4], [-1.5, 4]].map(([x, y]) => D(x, y, 1));
      v.poly(sh, { color: alpha('blue', 0.08), shade: false, bias: 50 });
      v.path([...sh, sh[0]], { color: alpha('blue', 0.4), width: 1.5 });
      // rays from the origin to the table corners — the move leans them (a shear)
      const cornersH = TABLE.map((q) => [q[0], q[1], 1]);
      const M3 = M; // acts on [x y w]
      const home = cornersH.map(([x, y]) => D(x, y, 1));
      const moved = cornersH.map((q) => { const r = mvec(M3, q); return D(r[0], r[1], r[2]); });
      home.forEach((h) => v.line([0, 0, 0], h, { color: alpha('slate', 0.35), width: 1.5, dash: [3, 4] }));
      moved.forEach((h) => v.line([0, 0, 0], h, { color: alpha('gold', 0.85), width: 2 }));
      v.poly(home, { color: alpha('slate', 0.15), shade: false });
      v.poly(moved, { color: alpha('slate', 0.55), shade: false, stroke: C.slate });
      const c = mvec(M3, [0, 0, 1]);
      v.arrow(D(0, 0, 1), D(c[0], c[1], 1), { color: 'gold', width: 3 });
      // an arrow on the floor (w = 0): it turns, but never slides
      const d = mvec(M3, [1.6, 0, 0]);
      v.arrow([0, 0, 0], D(1.6, 0, 0), { color: alpha('red', 0.3), width: 3 });
      v.arrow([0, 0, 0], D(d[0], d[1], 0), { color: 'red', width: 4 });
      v.frame([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0], 0.5, { alpha: 0.5, width: 2 });
      v.text('1', [-0.15, -0.15, 1], { size: 16, color: 'blue' });
      v.text('0', [-0.15, -0.15, 0], { size: 16, color: 'muted' });
      v.flush();
      // separator
      const ctx = stage.ctx, r = p3.area;
      ctx.save(); ctx.strokeStyle = C.grid; ctx.lineWidth = 2; ctx.beginPath();
      if (r.x > 0) { ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + r.h); } else { ctx.moveTo(0, r.y); ctx.lineTo(r.w, r.y); }
      ctx.stroke(); ctx.restore();
    }

    return {
      update(dt) { s.t += dt; v.tick(dt); },
      draw() {
        g.clip(() => {
          if (s.beat === 0) beatMove();
          else if (s.beat === 1) beatChain();
          else if (s.beat === 2) beatInverse();
        });
        if (s.beat === 3) beatLift();
      },
    };
  },
};
