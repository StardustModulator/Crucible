// Optimization = finding the bottom of a landscape. Roll downhill (gradient
// descent); on a bumpy land different balls get stuck in different valleys; on a
// string (constraint) the best spot is where a contour just kisses the string —
// there the two arrows ∇f and ∇g line up, and λ is how much longer one is.
import { C, alpha } from '../viz/palette.js';
import { rk4 } from '../core/dynamics.js';
import { rng, clamp } from '../core/random.js';
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
const A = [[1.0, 0.45], [0.45, 0.6]];
const BALL_COLORS = ['orange', 'teal', 'pink', 'purple', 'blue', 'lime', 'coral'];

export default {
  eq: [
    [['x', 'teal'], ' ← ', ['x', 'teal'], ' − ', ['η', 'orange'], ' ', ['∇f(x)', 'coral'], '        too big ', ['η', 'orange'], ' → zig-zag 💥'],
    ['non-convex f: each start rolls into its own valley (local minimum)'],
    ['min f(x)  s.t.  ', ['g(x) = 0', 'teal'], '   ⇒   ', ['∇f', 'coral'], ' = ', ['λ', 'gold'], ' ', ['∇g', 'teal']],
    ['min f(x)  s.t.  ', ['g(x) ≤ 0', 'lime'], '   ⇒   ', ['λ', 'gold'], ' ≥ 0 ,  ', ['λ', 'gold'], '·g(x) = 0   (inside → ', ['λ', 'gold'], ' = 0)'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-4.2, -2.8, 4.2, 2.8]);
    let R = rng(8);
    const s = {
      beat: 0, c: [0.6, 0.3], start: [-3.2, 1.9], eta: 0.5, path: [], tick: 0,
      pits: [], balls: [], o: [-1.0, -0.4], r: 1.3, th: 2.2, x3: [-3, 2], fkey: 0,
    };
    const fQ = (x, y) => { const d = [x - s.c[0], y - s.c[1]]; return 0.5 * (d[0] * (A[0][0] * d[0] + A[0][1] * d[1]) + d[1] * (A[1][0] * d[0] + A[1][1] * d[1])); };
    const gQ = ([x, y]) => { const d = [x - s.c[0], y - s.c[1]]; return [A[0][0] * d[0] + A[0][1] * d[1], A[1][0] * d[0] + A[1][1] * d[1]]; };
    const fB = (x, y) => s.pits.reduce((a, p) => a - p.a * Math.exp(-((x - p.m[0]) ** 2 + (y - p.m[1]) ** 2) / (2 * p.w * p.w)), 0.035 * (x * x + y * y));
    const gB = ([x, y]) => s.pits.reduce((a, p) => {
      const e = p.a * Math.exp(-((x - p.m[0]) ** 2 + (y - p.m[1]) ** 2) / (2 * p.w * p.w)) / (p.w * p.w);
      return [a[0] + e * (x - p.m[0]), a[1] + e * (y - p.m[1])];
    }, [0.07 * x, 0.07 * y]);
    const F = (x, y) => (s.beat === 1 ? fB(x, y) : fQ(x, y));
    const grad = (p) => (s.beat === 1 ? gB(p) : gQ(p));

    const newPits = () => {
      s.pits = [];
      const cells = R.shuffle([[-2.6, 1.3], [0, 1.4], [2.6, 1.3], [-2.6, -1.3], [0, -1.4], [2.6, -1.3], [-1.3, 0], [1.3, 0]]).slice(0, 6);
      for (const c of cells) s.pits.push({ m: [c[0] + R.uniform(-0.4, 0.4), c[1] + R.uniform(-0.3, 0.3)], a: R.uniform(0.7, 1.4), w: R.uniform(0.45, 0.65) });
      s.fkey++;
    };
    const dropBalls = () => { s.balls = Array.from({ length: 18 }, () => { const p = [R.uniform(-3.8, 3.8), R.uniform(-2.5, 2.5)]; return { p, trail: [p.slice()] }; }); };
    const resetGD = () => { s.path = [s.start.slice()]; s.tick = 0; };
    newPits(); dropBalls(); resetGD();

    // handles
    stage.handle({ pen: g, color: 'gold', r: 11, icon: '🎯', visible: () => s.beat !== 1, get: () => s.c, set: (p) => { s.c = [clamp(p[0], -3.8, 3.8), clamp(p[1], -2.5, 2.5)]; s.fkey++; resetGD(); } });
    stage.handle({ pen: g, color: 'teal', r: 10, visible: () => s.beat === 0, get: () => s.path[0], set: (p) => { s.start = p; resetGD(); } });
    stage.handle({ pen: g, color: 'teal', r: 9, kind: 'ring', visible: () => s.beat >= 2, get: () => s.o, set: (p) => { s.o = [clamp(p[0], -3.5, 3.5), clamp(p[1], -2.3, 2.3)]; } });
    stage.handle({ pen: g, color: 'teal', r: 8, kind: 'square', visible: () => s.beat >= 2, get: () => [s.o[0] + s.r, s.o[1]], set: (p) => { s.r = clamp(Math.hypot(p[0] - s.o[0], p[1] - s.o[1]), 0.3, 2.6); } });
    stage.handle({ pen: g, color: 'pink', r: 9, visible: () => s.beat === 2, get: () => bead(), set: (p) => { s.th = Math.atan2(p[1] - s.o[1], p[0] - s.o[0]); } });
    stage.handle({ pen: g, color: 'pink', r: 9, visible: () => s.beat === 3, get: () => s.x3, set: (p) => { s.x3 = p; } });
    const offDown = stage.on('down', (e) => { if (s.beat === 1 && e.pen === g) { const p = e.p.slice(); s.balls.push({ p, trail: [p.slice()] }); } });
    const bead = () => [s.o[0] + s.r * Math.cos(s.th), s.o[1] + s.r * Math.sin(s.th)];

    const groups = [ui.group(), ui.group()];
    ui.slider({ into: groups[0], icon: '👣', color: 'orange', min: 0.05, max: 2.2, step: 0.01, value: s.eta, title: 'step size η', onInput: (v) => { s.eta = v; resetGD(); } });
    ui.button({ into: groups[1], icon: '🎲', title: 'new landscape', onClick: () => { newPits(); dropBalls(); } });
    ui.button({ into: groups[1], icon: '⚽', title: 'drop again', onClick: dropBalls });
    ui.readout(() => {
      if (s.beat === 0) return fmt(fQ(...s.path[s.path.length - 1]), 3);
      if (s.beat === 1) return String(new Set(s.balls.map((b) => b.p.map((v) => v.toFixed(1)).join())).size);
      const p = s.beat === 2 ? bead() : s.x3;
      const gf = gQ(p), gg = [2 * (p[0] - s.o[0]), 2 * (p[1] - s.o[1])];
      const lam = -(gf[0] * gg[0] + gf[1] * gg[1]) / (gg[0] ** 2 + gg[1] ** 2);
      return 'λ ' + fmt(s.beat === 3 && Math.hypot(p[0] - s.o[0], p[1] - s.o[1]) < s.r - 0.02 ? 0 : lam, 2);
    }, { icon: '📉', color: 'gold', title: 'loss / valleys / λ' });
    const showGroups = () => { groups[0].style.display = s.beat === 0 ? '' : 'none'; groups[1].style.display = s.beat === 1 ? '' : 'none'; };
    ui.beats(['⛰️', '🎒', '🧵', '🚧'], (b) => { s.beat = b; s.fkey++; showGroups(); if (b === 0) resetGD(); if (b === 1) dropBalls(); if (b === 3) s.x3 = [-3, 2]; });
    showGroups();

    let cc = { key: null };
    return {
      update(dt) {
        if (s.beat === 0) {
          s.tick += dt;
          if (s.tick > 0.35) {
            s.tick = 0;
            const p = s.path[s.path.length - 1], gr = gQ(p);
            const q = [p[0] - s.eta * gr[0], p[1] - s.eta * gr[1]];
            if (Math.hypot(gr[0], gr[1]) < 0.01 || s.path.length > 40 || Math.hypot(...q) > 30) resetGD(); else s.path.push(q);
          }
        } else if (s.beat === 1) {
          const flow = (t, p) => { const gr = gB(p); return [-gr[0], -gr[1]]; };
          for (const b of s.balls) {
            b.p = rk4(flow, 0, b.p, dt * 3);
            const l = b.trail[b.trail.length - 1];
            if (Math.hypot(b.p[0] - l[0], b.p[1] - l[1]) > 0.05) b.trail.push(b.p.slice());
          }
        } else if (s.beat === 2) {
          // gradient descent along the string: only the part of −∇f tangent to the circle moves the bead
          const p = bead(), gr = gQ(p), tng = [-Math.sin(s.th), Math.cos(s.th)];
          s.th -= dt * 1.5 * (gr[0] * tng[0] + gr[1] * tng[1]) / s.r * 1.5;
        } else {
          // projected gradient descent: step downhill, then pull back inside the fence
          for (let k = 0; k < 3; k++) {
            const gr = gQ(s.x3); let q = [s.x3[0] - dt * 0.9 * gr[0], s.x3[1] - dt * 0.9 * gr[1]];
            const d = Math.hypot(q[0] - s.o[0], q[1] - s.o[1]);
            if (d > s.r) q = [s.o[0] + (q[0] - s.o[0]) * s.r / d, s.o[1] + (q[1] - s.o[1]) * s.r / d];
            s.x3 = q;
          }
        }
      },
      draw() {
        const view = g.view, key = `${s.fkey}|${s.beat === 1}|${view.map((v) => v.toFixed(2)).join()}`;
        g.heat((x, y) => F(x, y), { cacheKey: key, res: 100, transform: (t) => Math.pow(t, s.beat === 1 ? 0.8 : 0.45), alpha: 0.92 });
        if (cc.key !== key) {
          let lv = [];
          if (s.beat === 1) for (let L = -1.3; L < 1.6; L += 0.12) lv.push(L);
          else for (let k = 1; k < 18; k++) lv.push(0.02 * k * k);
          cc = { key, segs: contourSegs(F, view, 96, 64, lv) };
        }
        cc.segs.forEach((sg) => drawSegs(g, sg, alpha('white', 0.3), 1.1));
        if (s.beat === 0) drawGD(); else if (s.beat === 1) drawBumpy(); else drawConstrained();
      },
      dispose() { offDown(); },
    };

    function drawGD() {
      const P = s.path;
      g.path(P, { color: 'white', width: 2.5 });
      P.forEach((p, i) => g.dot(p, i === P.length - 1 ? 0 : 4, { color: 'teal', ring: 'white', ringWidth: 1.5 }));
      const p = P[P.length - 1], gr = gQ(p), n = Math.hypot(...gr);
      if (n > 0.02) {
        const k = Math.min(1.2, n) / n;
        g.arrow(p, [p[0] + gr[0] * k, p[1] + gr[1] * k], { color: 'coral', width: 4 });
        g.arrow(p, [p[0] - s.eta * gr[0], p[1] - s.eta * gr[1]], { color: 'teal', width: 3, dash: [5, 4] });
      }
      g.emoji('⚽', p, 24);
    }

    function drawBumpy() {
      // global minimum: the deepest of all the valleys the balls found (plus a dense check)
      let best = null, bv = Infinity;
      for (let x = -4; x <= 4; x += 0.1) for (let y = -2.7; y <= 2.7; y += 0.1) { const v = fB(x, y); if (v < bv) { bv = v; best = [x, y]; } }
      const ends = [];
      for (const b of s.balls) {
        let ci = ends.findIndex((e) => Math.hypot(e[0] - b.p[0], e[1] - b.p[1]) < 0.3);
        if (ci < 0) { ends.push(b.p); ci = ends.length - 1; }
        const col = BALL_COLORS[ci % BALL_COLORS.length];
        g.path(b.trail, { color: alpha(col, 0.85), width: 2.5 });
        g.dot(b.trail[0], 3.5, { color: alpha('white', 0.8) });
        g.dot(b.p, 7, { color: col, ring: 'white', ringWidth: 2 });
      }
      g.emoji('⭐', [best[0], best[1] + 0.35], 22);
    }

    function drawConstrained() {
      const ineq = s.beat === 3;
      if (ineq) g.circle(s.o, s.r, { fill: alpha('lime', 0.28), stroke: false });
      g.circle(s.o, s.r, { color: ineq ? 'lime' : 'teal', width: 4, dash: ineq ? [8, 5] : [] });
      const p = ineq ? s.x3 : bead(), fp = fQ(...p);
      // the contour through the current point (gold): at the best point it just kisses the string
      drawSegs(g, contourSegs(fQ, g.view, 110, 76, [fp])[0], C.gold, 2.5);
      const gf = gQ(p), gg = [2 * (p[0] - s.o[0]), 2 * (p[1] - s.o[1])];
      const onEdge = Math.hypot(p[0] - s.o[0], p[1] - s.o[1]) > s.r - 0.02;
      const nf = Math.hypot(...gf), ng = Math.hypot(...gg);
      if (!ineq || onEdge) {
        const kf = 1.1 / Math.max(nf, 0.5), kg = 1.1 / Math.max(ng, 0.5);
        g.arrow(p, [p[0] + gf[0] * kf, p[1] + gf[1] * kf], { color: 'coral', width: 4.5 });
        g.arrow(p, [p[0] + gg[0] * kg, p[1] + gg[1] * kg], { color: 'teal', width: 4.5 });
        g.text('∇f', [p[0] + gf[0] * kf * 1.2, p[1] + gf[1] * kf * 1.2 + 0.18], { color: 'coral', size: 16, weight: 800 });
        g.text('∇g', [p[0] + gg[0] * kg * 1.2, p[1] + gg[1] * kg * 1.2 - 0.18], { color: 'teal', size: 16, weight: 800 });
        const cosang = Math.abs(gf[0] * gg[0] + gf[1] * gg[1]) / (nf * ng || 1);
        if (cosang > 0.995 || nf < 0.02) g.emoji('✨', [p[0] - 0.35, p[1] + 0.35], 20);
      } else g.emoji('✨', [p[0] - 0.35, p[1] + 0.35], 20);
      g.emoji('⚽', p, 22);
      g.dot(s.o, 4, { color: 'teal' });
    }
  },
};
