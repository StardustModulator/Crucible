// Stability = a bowl. V(x) is the height of the bowl over the state plane; if every
// motion goes "downhill in V" (arrows cross the rings inward), the ball must settle.
// Flip the bowl and it runs away; remove friction and it circles one ring forever.
import { C, alpha } from '../viz/palette.js';
import { rk4 } from '../core/dynamics.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

function contourSegs(F, [x0, y0, x1, y1], nx, ny, levels) {
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny, V = [];
  for (let j = 0; j <= ny; j++) { const r = []; for (let i = 0; i <= nx; i++) r.push(F(x0 + i * dx, y0 + j * dy)); V.push(r); }
  return levels.map((L) => {
    const segs = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], v = c.map(([a, b]) => V[b][a]), pts = [];
      for (let k = 0; k < 4; k++) {
        const a = v[k], b = v[(k + 1) % 4];
        if ((a < L) !== (b < L)) { const t = (L - a) / (b - a), p = c[k], q = c[(k + 1) % 4]; pts.push([x0 + (p[0] + (q[0] - p[0]) * t) * dx, y0 + (p[1] + (q[1] - p[1]) * t) * dy]); }
      }
      if (pts.length === 2) segs.push(pts); else if (pts.length === 4) segs.push([pts[0], pts[1]], [pts[2], pts[3]]);
    }
    return segs;
  });
}
function drawSegs(pen, segs, color, width) {
  const ctx = pen.ctx; ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  for (const [a, b] of segs) { const A = pen.toScreen(a), B = pen.toScreen(b); ctx.moveTo(...A); ctx.lineTo(...B); }
  ctx.stroke(); ctx.restore();
}

const PRESETS = [{ k: 1.5, c: 0.5 }, { k: -1.0, c: 0.3 }, { k: 1.5, c: 0 }, { k: 1.5, c: 0.5 }];

export default {
  eq: [
    [['ẋ', 'pink'], ' = v ,   ', ['v̇', 'pink'], ' = −', ['k', 'orange'], 'x − ', ['c', 'coral'], 'v'],
    [['V', 'gold'], '(x, v) = ½', ['k', 'orange'], 'x² + ½v²     (the bowl)'],
    [['V̇', 'coral'], ' = ∇', ['V', 'gold'], ' · ', ['f', 'blue'], ' = −', ['c', 'coral'], 'v²  ≤ 0   ⇒  🥣 stable'],
    [['V', 'gold'], ' > 0 away from 0  and  ', ['V̇', 'coral'], ' ≤ 0  ⇒  Lyapunov stable'],
  ],
  setup({ stage, ui }) {
    const wide = (W, H) => W >= H * 1.05;
    const Lp = stage.pen((W, H) => (wide(W, H) ? { x: 0, y: 0, w: 0.4, h: 1 } : { x: 0, y: 0, w: 1, h: 0.44 }), [-2.6, -2.6, 2.6, 2.7], { frame: true });
    const Rp = stage.pen((W, H) => (wide(W, H) ? { x: 0.4, y: 0, w: 0.6, h: 1 } : { x: 0, y: 0.44, w: 1, h: 0.56 }), [-2.5, -2.1, 2.5, 2.1], { frame: true });
    const s = { beat: 0, k: 1.5, c: 0.5, x: [1.6, 0.5], start: [1.6, 0.5], trail: [], hist: [], t: 0, boom: 0 };

    const f = (t, [x, v]) => [v, -s.k * x - s.c * v];
    const V = (x, v) => 0.5 * s.k * x * x + 0.5 * v * v;
    const restart = () => { s.x = s.start.slice(); s.trail = [s.x.slice()]; s.hist = []; s.t = 0; s.boom = 0; };

    stage.handle({ pen: Rp, color: 'orange', r: 11, get: () => s.x, set: (p) => { s.start = [clamp(p[0], -2.3, 2.3), clamp(p[1], -1.95, 1.95)]; restart(); }, onStart: () => (s.held = true), onEnd: () => (s.held = false) });

    const kSl = ui.slider({ icon: '🥣', color: 'orange', min: -1.5, max: 3, step: 0.05, value: s.k, title: 'bowl steepness k', onInput: (v) => { s.k = v; restart(); } });
    const cSl = ui.slider({ icon: '🧽', color: 'coral', min: 0, max: 1.5, step: 0.01, value: s.c, title: 'friction c', onInput: (v) => { s.c = v; } });
    ui.readout(() => fmt(V(...s.x), 2), { icon: '🥣', color: 'gold', title: 'V' });
    ui.readout(() => fmt(-s.c * s.x[1] ** 2, 2), { icon: '📉', color: 'coral', title: 'V dot' });
    ui.beats(['🥣', '⛰️', '🔄', '📉'], (b) => {
      s.beat = b; Object.assign(s, PRESETS[b]); kSl.set(s.k); cSl.set(s.c);
      s.start = b === 1 ? [0.35, 0.25] : [1.6, 0.5];
      Lp.setBounds(b === 3 ? [-2.6, -3.4, 2.6, 2.7] : [-2.6, -2.6, 2.6, 2.7]);
      restart();
    });
    restart();

    let cache = { key: null };
    return {
      update(dt) {
        if (s.held) return;
        if (s.boom > 0) { s.boom -= dt; if (s.boom <= 0) restart(); return; }
        s.t += dt;
        for (let i = 0; i < 4; i++) s.x = rk4(f, 0, s.x, dt / 4);
        const last = s.trail[s.trail.length - 1];
        if (Math.hypot(s.x[0] - last[0], s.x[1] - last[1]) > 0.03) s.trail.push(s.x.slice());
        if (s.trail.length > 400) s.trail.shift();
        s.hist.push([s.t, V(...s.x), -s.c * s.x[1] ** 2]);
        if (s.hist.length > 900) s.hist.shift();
        if (s.k < 0 && (Math.abs(s.x[0]) > 2.45 || Math.abs(s.x[1]) > 2.4)) s.boom = 1.4;
        if (s.beat !== 1 && s.t > 14) restart();
      },
      draw() { drawSide(); drawPhase(); },
    };

    // ---------------------------------------------------------------- side view: the ball in the bowl
    function drawSide() {
      const P = Lp;
      const base = s.k >= 0 ? 0.2 : 2.2, A = 0.42;
      const U = (x) => base + A * s.k * x * x;
      P.grid({ step: 1, axes: false });
      const pts = []; for (let i = 0; i <= 100; i++) { const x = -2.4 + 4.8 * i / 100; pts.push([x, clamp(U(x), -0.2, 2.6)]); }
      P.poly([[-2.4, -0.2], ...pts, [2.4, -0.2]], { fill: alpha('slate', 0.2), stroke: false });
      P.path(pts, { color: 'slate', width: 6 });
      const x = clamp(s.x[0], -2.4, 2.4), y = U(x);
      const d = 2 * A * s.k * x, n = [-d / Math.hypot(1, d), 1 / Math.hypot(1, d)];
      const c = [x + n[0] * 0.24, y + n[1] * 0.24];
      if (s.boom > 0) P.emoji('💥', c, 44);
      else {
        P.circle(c, 0.24, { fill: 'pink', stroke: false });
        P.circle([c[0] - 0.07, c[1] + 0.07], 0.07, { fill: alpha('white', 0.45), stroke: false });
        if (Math.abs(s.x[1]) > 0.1) P.arrow(c, [c[0] + s.x[1] * 0.35, c[1] + s.x[1] * 0.35 * d], { color: 'blue', width: 3 });
      }
      P.emoji(s.beat === 1 ? '⛰️' : '🥣', [-2.15, 2.4], 22);
      // V(t): only ever goes down while c > 0
      const top = -0.45, bot = s.beat === 3 ? -3.3 : -2.5, x0 = -2.4, x1 = 2.4, T = 14;
      P.rrect(x0 - 0.1, bot - 0.05, x1 - x0 + 0.2, top - bot + 0.1, 8, { fill: alpha('panel', 0.8), stroke: false });
      const V0 = Math.max(0.2, V(...s.start)) * 1.1;
      const X = (t) => x0 + (t / T) * (x1 - x0), Y = (v) => bot + 0.1 + clamp(v / V0, -0.05, 1.05) * (top - bot - 0.2);
      P.line([x0, Y(0)], [x1, Y(0)], { color: alpha('muted', 0.6), width: 1 });
      const pv = s.hist.map(([t, v]) => [X(t), Y(v)]);
      if (pv.length > 1) P.poly([[pv[0][0], Y(0)], ...pv, [pv[pv.length - 1][0], Y(0)]], { fill: alpha('gold', 0.18), stroke: false });
      P.path(pv, { color: 'gold', width: 3 });
      if (s.beat === 3) {
        // V̇ = −c v² drawn hanging below zero (coral): never above the line
        const Yd = (v) => Y(0) + clamp(v / V0, -0.6, 0.05) * (top - bot - 0.2);
        P.path(s.hist.map(([t, , vd]) => [X(t), Yd(vd)]), { color: 'coral', width: 2.5 });
        P.text('V̇', [x1 - 0.2, Y(0) - 0.35], { color: 'coral', size: 16, weight: 800 });
      }
      P.text('V', [x0 + 0.2, top - 0.2], { color: 'gold', size: 16, weight: 800 });
      if (pv.length) P.dot(pv[pv.length - 1], 5, { color: 'gold' });
    }

    // ---------------------------------------------------------------- phase plane: the bowl seen from above
    function drawPhase() {
      const P = Rp, view = P.view;
      const key = `${s.k}|${view.map((v) => v.toFixed(2)).join()}`;
      P.heat((x, v) => V(x, v), { cacheKey: key, res: 90, transform: (t) => Math.sqrt(t) });
      if (cache.key !== key) {
        const lv = []; for (let i = -6; i <= 12; i++) lv.push(i * 0.35);
        cache = { key, segs: contourSegs(V, view, 70, 56, lv.filter((l) => Math.abs(l) > 1e-6)) };
      }
      cache.segs.forEach((sg) => drawSegs(P, sg, alpha('white', 0.35), 1.2));
      // flow arrows
      const st = 0.42;
      for (let x = Math.ceil(view[0] / st) * st; x < view[2]; x += st)
        for (let v = Math.ceil(view[1] / st) * st; v < view[3]; v += st) {
          const d = f(0, [x, v]), n = Math.hypot(...d); if (n < 1e-3) continue;
          const L = 0.15 / n;
          P.arrow([x - d[0] * L, v - d[1] * L], [x + d[0] * L, v + d[1] * L], { color: alpha('white', 0.4), width: 1.4, head: 5 });
        }
      // level set through the current state, in gold
      const lvl = V(...s.x);
      const ring = contourSegs(V, view, 90, 70, [lvl])[0];
      drawSegs(P, ring, C.gold, 2.5);
      // trail
      const n = s.trail.length;
      for (let i = 1; i < n; i++) P.line(s.trail[i - 1], s.trail[i], { color: alpha('pink', 0.2 + 0.8 * i / n), width: 3 });
      if (s.boom > 0) { P.emoji('💥', s.x.map((u) => clamp(u, -2.3, 2.1)), 40); return; }
      // at the state: where it goes (blue) vs uphill in V (coral) — the angle between them says V̇ < 0
      const d = f(0, s.x), gV = [s.k * s.x[0], s.x[1]];
      const nd = Math.hypot(...d) || 1, ng = Math.hypot(...gV) || 1;
      P.arrow(s.x, [s.x[0] + gV[0] / ng * 0.6, s.x[1] + gV[1] / ng * 0.6], { color: 'coral', width: 3, dash: [5, 4] });
      P.arrow(s.x, [s.x[0] + d[0] / nd * 0.75, s.x[1] + d[1] / nd * 0.75], { color: 'blue', width: 4 });
      P.dot([0, 0], 6, { color: s.k > 0 ? 'lime' : 'coral', ring: 'bg' });
      P.text('x', [view[2] - 0.2, 0.18], { color: 'muted', size: 14 });
      P.text('v', [0.18, view[3] - 0.2], { color: 'muted', size: 14 });
    }
  },
};
