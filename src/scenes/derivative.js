// Slopes. A skier rides a hill: the ski IS the tangent line. Steep up = coral,
// steep down = lime. Shrink the gap between two dots and the "secant" turns
// into the tangent. In 2D the slope becomes an arrow field pointing uphill,
// and a ball rolls the opposite way.
import { C, alpha, mix } from '../viz/palette.js';
import { solve } from '../core/linalg.js';
import { rk4 } from '../core/dynamics.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

// ---------- natural cubic spline through (xs, ys), linear outside ----------
function spline(xs, ys) {
  const n = xs.length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  A[0][0] = 1; A[n - 1][n - 1] = 1;
  for (let i = 1; i < n - 1; i++) {
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
    A[i][i - 1] = h0 / 6; A[i][i] = (h0 + h1) / 3; A[i][i + 1] = h1 / 6;
    b[i] = (ys[i + 1] - ys[i]) / h1 - (ys[i] - ys[i - 1]) / h0;
  }
  const M = solve(A, b);
  const seg = (x) => { let i = 0; while (i < n - 2 && x > xs[i + 1]) i++; return i; };
  const ev = (x) => {
    if (x < xs[0] || x > xs[n - 1]) {
      const e = x < xs[0] ? 0 : n - 1, d = ev1(xs[e]);
      return [d[0] + d[1] * (x - xs[e]), d[1], 0];
    }
    return ev1(x);
  };
  const ev1 = (x) => {
    const i = seg(x), h = xs[i + 1] - xs[i], a = (xs[i + 1] - x) / h, t = (x - xs[i]) / h;
    const y = a * ys[i] + t * ys[i + 1] + ((a ** 3 - a) * M[i] + (t ** 3 - t) * M[i + 1]) * h * h / 6;
    const dy = (ys[i + 1] - ys[i]) / h + ((-(3 * a * a - 1)) * M[i] + (3 * t * t - 1) * M[i + 1]) * h / 6;
    const d2 = a * M[i] + t * M[i + 1];
    return [y, dy, d2];
  };
  return ev;
}

// ---------- marching squares: segments of the level set f = level ----------
function contourSegs(F, [x0, y0, x1, y1], nx, ny, levels) {
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
  const V = [];
  for (let j = 0; j <= ny; j++) { const r = []; for (let i = 0; i <= nx; i++) r.push(F(x0 + i * dx, y0 + j * dy)); V.push(r); }
  return levels.map((L) => {
    const segs = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const v = c.map(([a, b]) => V[b][a]);
      const pts = [];
      for (let k = 0; k < 4; k++) {
        const a = v[k], b = v[(k + 1) % 4];
        if ((a < L) !== (b < L)) {
          const t = (L - a) / (b - a), p = c[k], q = c[(k + 1) % 4];
          pts.push([x0 + (p[0] + (q[0] - p[0]) * t) * dx, y0 + (p[1] + (q[1] - p[1]) * t) * dy]);
        }
      }
      if (pts.length === 2) segs.push(pts);
      else if (pts.length === 4) { segs.push([pts[0], pts[1]], [pts[2], pts[3]]); }
    }
    return segs;
  });
}
function drawSegs(pen, segs, color, width = 1.2) {
  const ctx = pen.ctx;
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  for (const [a, b] of segs) { const A = pen.toScreen(a), B = pen.toScreen(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); }
  ctx.stroke(); ctx.restore();
}
function emojiRot(pen, ch, p, size, ang, flip = 1, lift = 0) {
  const ctx = pen.ctx, [sx, sy] = pen.toScreen(p);
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(-ang); ctx.scale(flip, 1);
  ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ch, 0, -lift);
  ctx.restore();
}
// slope → color: uphill coral, downhill lime, flat gold
const slopeColor = (m) => (m >= 0 ? mix('muted', 'coral', Math.min(1, m / 0.5)) : mix('muted', 'lime', Math.min(1, -m / 0.5)));

const HILL_X = [-4.6, -2.76, -0.92, 0.92, 2.76, 4.6];
const SLOPE_Y = -1.95, SLOPE_K = 0.42; // where & how tall the slope strip is drawn

export default {
  eq: [
    [['f′(x)', 'coral'], ' = lim', ['h', 'orange'], '→0  ', ['[f(x+h) − f(x)] / h', 'blue']],
    [['rise', 'green'], ' / ', ['run', 'red'], ' = slope of the ', ['ski', 'gold'], '  (', ['+ uphill', 'coral'], ', ', ['− downhill', 'lime'], ')'],
    [['∇f', 'coral'], ' = [ ', ['∂f/∂x', 'red'], ' , ', ['∂f/∂y', 'green'], ' ]   points straight uphill'],
    ['ball: ', ['ẋ = −∇f(x)', 'teal'], '   (roll downhill)'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const R = rng(7);
    const s = {
      beat: 0, ys: [1.0, 2.3, 1.1, 0.5, 2.0, 1.2], x: -3.5, dir: 1, hold: 0, h: 2.5, hAuto: true, t: 0,
      hills: [{ c: [-1.6, 0.8], a: 1.6, w: 0.9 }, { c: [1.7, -0.7], a: 1.3, w: 0.8 }, { c: [1.4, 1.3], a: -1.1, w: 0.7 }, { c: [-1.5, -1.3], a: -1.3, w: 0.8 }],
      probe: [0.3, 0.2], balls: [], fieldKey: 0,
    };
    let xs = HILL_X.slice(), xsKey = '';
    let f = spline(xs, s.ys);
    const refit = () => { f = spline(xs, s.ys); };
    // spread the hill's control points across whatever width the screen shows
    const fitXs = () => {
      const [vx0, , vx1] = g.view, key = vx0.toFixed(3) + vx1.toFixed(3);
      if (key === xsKey) return;
      xsKey = key;
      xs = HILL_X.map((_, i) => vx0 + 0.6 + (vx1 - vx0 - 1.2) * i / (HILL_X.length - 1));
      refit();
    };
    const xLo = () => xs[0], xHi = () => xs[xs.length - 1];

    // 2D landscape: bumps + a gentle bowl so balls end in the pits
    const F = (x, y) => s.hills.reduce((acc, h) => acc + h.a * Math.exp(-((x - h.c[0]) ** 2 + (y - h.c[1]) ** 2) / (2 * h.w * h.w)), 0.035 * (x * x + y * y));
    const gradF = (x, y) => s.hills.reduce((acc, h) => {
      const e = h.a * Math.exp(-((x - h.c[0]) ** 2 + (y - h.c[1]) ** 2) / (2 * h.w * h.w)) / (h.w * h.w);
      return [acc[0] - e * (x - h.c[0]), acc[1] - e * (y - h.c[1])];
    }, [0.07 * x, 0.07 * y]);

    const B1 = [-5, -3.25, 5, 3.15], B1p = [-3.4, -3.25, 3.4, 3.15], B2 = [-4.2, -2.6, 4.2, 2.6];
    const fitBounds = () => { const want = s.beat < 2 ? (stage.portrait ? B1p : B1) : B2; if (g.bounds !== want) g.setBounds(want); };
    const setBeat = (b) => {
      s.beat = b; fitBounds();
      if (b === 1) { s.hAuto = true; s.t = 0; s.x = clamp(s.x, xLo() + 0.5, xHi() - 3.2); }
      if (b === 3) dropBalls();
    };
    const dropBalls = () => {
      s.balls = [];
      for (let i = 0; i < 7; i++) addBall([R.uniform(-3.6, 3.6), R.uniform(-2.2, 2.2)]);
    };
    const addBall = (p) => s.balls.push({ p: p.slice(), trail: [p.slice()] });

    // hill control points (vertical drags only)
    HILL_X.forEach((_, i) => stage.handle({
      pen: g, color: 'orange', r: 8, visible: () => s.beat < 2,
      get: () => [xs[i], s.ys[i]], set: (p) => { s.ys[i] = clamp(p[1], 0.15, 2.9); refit(); },
    }));
    // the skier: drag along the hill
    stage.handle({
      pen: g, color: 'pink', r: 10, kind: 'ring', visible: () => s.beat < 2,
      get: () => [s.x, f(s.x)[0]], set: (p) => { s.x = clamp(p[0], xLo(), s.beat === 1 ? xHi() - 3.1 : xHi()); s.hold = 1e9; },
      onEnd: () => { s.hold = 1.2; },
    });
    // 2D: hill & pit centers, and a probe
    s.hills.forEach((h) => stage.handle({
      pen: g, color: h.a > 0 ? 'gold' : 'blue', r: 8, kind: 'ring', visible: () => s.beat >= 2,
      get: () => h.c, set: (p) => { h.c = [clamp(p[0], -4, 4), clamp(p[1], -2.4, 2.4)]; s.fieldKey++; },
    }));
    stage.handle({ pen: g, color: 'coral', r: 10, visible: () => s.beat === 2, get: () => s.probe, set: (p) => (s.probe = p) });
    const offDown = stage.on('down', (e) => { if (s.beat === 3 && e.pen === g) addBall(e.p); });

    ui.beats(['🏔️', '🔍', '🗺️', '⚽'], setBeat);
    const hSl = ui.slider({ icon: '↔️', color: 'orange', min: 0.02, max: 3, step: 0.01, value: s.h, title: 'gap h', onInput: (v) => { s.h = v; s.hAuto = false; } });
    ui.button({ icon: '🎲', title: 'new hill', onClick: () => {
      if (s.beat < 2) { s.ys = s.ys.map(() => R.uniform(0.3, 2.7)); refit(); }
      else { s.hills.forEach((h) => (h.c = [R.uniform(-3.5, 3.5), R.uniform(-2, 2)])); s.fieldKey++; if (s.beat === 3) dropBalls(); }
    } });
    ui.readout(() => fmt(f(s.x)[1], 2), { icon: '⛷️', color: 'coral', title: 'slope' });
    ui.readout(() => (s.beat === 1 ? fmt((f(s.x + s.h)[0] - f(s.x)[0]) / s.h, 2) : '·'), { icon: '📐', color: 'blue', title: 'secant slope' });
    setBeat(0);

    let contourCache = { key: null, segs: [] };
    const getContours = (range) => {
      const key = s.fieldKey + ':' + range.map((v) => v.toFixed(2)).join(',');
      if (contourCache.key !== key) {
        const levels = []; for (let L = -1.2; L <= 1.8; L += 0.2) levels.push(L);
        contourCache = { key, segs: contourSegs(F, range, 84, 52, levels) };
      }
      return contourCache.segs;
    };

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 0) {
          if (s.hold > 0) s.hold -= dt;
          else {
            // ride: faster downhill, slower uphill (still just a toy)
            const m = f(s.x)[1];
            s.x += s.dir * dt * clamp(1.3 - 0.5 * m * s.dir, 0.45, 2.4);
            if (s.x > xHi() - 0.1) { s.x = xHi() - 0.1; s.dir = -1; }
            if (s.x < xLo() + 0.1) { s.x = xLo() + 0.1; s.dir = 1; }
          }
        }
        if (s.beat === 1 && s.hAuto) {
          const ph = (s.t % 7) / 5;
          s.h = ph >= 1 ? 0.02 : 0.02 + 2.98 * (1 - ph) ** 2;
          hSl.set(s.h);
        }
        if (s.beat === 3) {
          const flow = (t, p) => { const gr = gradF(p[0], p[1]); return [-gr[0], -gr[1]]; };
          for (const b of s.balls) {
            for (let k = 0; k < 2; k++) b.p = rk4(flow, 0, b.p, dt * 1.6);
            const last = b.trail[b.trail.length - 1];
            if (Math.hypot(b.p[0] - last[0], b.p[1] - last[1]) > 0.05) b.trail.push(b.p.slice());
            if (b.trail.length > 200) b.trail.shift();
          }
        }
      },
      draw() {
        fitBounds();
        if (s.beat < 2) drawHill(); else drawField();
      },
      dispose() { offDown(); },
    };

    function drawHill() {
      fitXs();
      g.grid({ step: 1, axes: false });
      const vx0 = xLo(), vx1 = xHi();
      // ground fill + hill
      const pts = []; for (let i = 0; i <= 240; i++) { const x = vx0 + (vx1 - vx0) * i / 240; pts.push([x, f(x)[0]]); }
      g.poly([[vx0, 0], ...pts, [vx1, 0]], { fill: alpha('slate', 0.16), stroke: false });
      // snow color by slope along the hill
      for (let i = 1; i < pts.length; i++) g.line(pts[i - 1], pts[i], { color: slopeColor(f((pts[i][0] + pts[i - 1][0]) / 2)[1]), width: 5 });
      g.line([vx0, 0], [vx1, 0], { color: alpha('muted', 0.5), width: 1 });

      // slope strip below: f′(x)
      g.line([vx0, SLOPE_Y], [vx1, SLOPE_Y], { color: alpha('muted', 0.6), width: 1 });
      const sp = pts.map(([x]) => [x, SLOPE_Y + SLOPE_K * clamp(f(x)[1], -3, 3)]);
      for (let i = 1; i < sp.length; i++) {
        const m = (sp[i][1] + sp[i - 1][1]) / 2 - SLOPE_Y;
        g.poly([[sp[i - 1][0], SLOPE_Y], sp[i - 1], sp[i], [sp[i][0], SLOPE_Y]], { fill: alpha(m > 0 ? 'coral' : 'lime', 0.28), stroke: false });
      }
      g.path(sp, { color: 'coral', width: 2.5 });
      g.text('f′', [vx0 + 0.35, SLOPE_Y + 0.75], { color: 'coral', size: 18 });
      g.text('f', [vx0 + 0.35, 2.9], { color: 'ink', size: 18 });
      g.text('0', [vx0 + 0.35, SLOPE_Y], { color: 'muted', size: 12 });

      const [y, m] = f(s.x);
      const P = [s.x, y];
      const mc = slopeColor(m);
      // link skier ↔ its slope dot
      const sd = [s.x, SLOPE_Y + SLOPE_K * clamp(m, -3, 3)];
      g.line(P, sd, { color: alpha('muted', 0.5), dash: [3, 4], width: 1.2 });
      g.dot(sd, 6, { color: mc, ring: 'bg' });

      if (s.beat === 0) {
        // rise / run triangle (run = 1)
        const run = s.dir > 0 ? 1 : -1;
        const Q = [s.x + run, y], Rr = [s.x + run, y + m * run];
        g.poly([P, Q, Rr], { fill: alpha(mc, 0.2), stroke: false });
        g.line(P, Q, { color: 'red', width: 2.5 });
        g.line(Q, Rr, { color: 'green', width: 3 });
        g.text('1', [s.x + run / 2, y - 0.22], { color: 'red', size: 14 });
        g.text(fmt(m * run, 1), [Q[0] + 0.38 * run, (y + Rr[1]) / 2], { color: 'green', size: 15 });
        // the ski = tangent
        const L = 1.3 / Math.sqrt(1 + m * m);
        g.line([s.x - L, y - m * L], [s.x + L, y + m * L], { color: mc, width: 6 });
        const ang = Math.atan(m);
        emojiRot(g, '⛷️', P, 46, ang, s.dir > 0 ? -1 : 1, 24);
        g.emoji(m * s.dir > 0.15 ? '😤' : m * s.dir < -0.15 ? '😆' : '🙂', [s.x, y + 1.45], 24);
      } else {
        // secant through x and x+h → tangent as h → 0
        const x2 = s.x + s.h, y2 = f(x2)[0], ms = (y2 - y) / s.h;
        const T = 6;
        g.line([s.x - T, y - m * T], [s.x + T, y + m * T], { color: 'gold', width: 2.5, dash: [8, 6] });
        g.line([s.x - T, y - ms * T], [s.x + T, y + ms * T], { color: 'blue', width: 3 });
        g.poly([P, [x2, y], [x2, y2]], { fill: alpha('blue', 0.12), stroke: false });
        g.line(P, [x2, y], { color: 'red', width: 2.5 });
        g.line([x2, y], [x2, y2], { color: 'green', width: 3 });
        if (s.h > 0.5) g.text('h', [s.x + s.h / 2, y - 0.22], { color: 'orange', size: 16 });
        g.dot(P, 7, { color: 'orange', ring: 'bg' });
        g.dot([x2, y2], 7, { color: 'orange', ring: 'bg' });
        if (s.h < 0.06) g.emoji('🎯', [s.x, y + 0.75], 22);
      }
    }

    function drawField() {
      const view = g.view;
      g.heat((x, y) => F(x, y), { cacheKey: 'F' + s.fieldKey + view.map((v) => v.toFixed(2)).join(), res: 110, min: -1.3, max: 1.9 });
      const levels = getContours(view);
      levels.forEach((segs, i) => drawSegs(g, segs, alpha('white', i % 5 === 1 ? 0.55 : 0.28), i % 5 === 1 ? 1.6 : 1));
      // gradient arrows (coral) all pointing uphill
      const step = 0.55;
      for (let x = Math.ceil(view[0] / step) * step; x < view[2]; x += step)
        for (let y = Math.ceil(view[1] / step) * step; y < view[3]; y += step) {
          const gr = gradF(x, y), n = Math.hypot(gr[0], gr[1]);
          if (n < 0.03) continue;
          const L = Math.min(0.42, 0.25 * n + 0.08) / n;
          g.arrow([x - gr[0] * L / 2, y - gr[1] * L / 2], [x + gr[0] * L / 2, y + gr[1] * L / 2], { color: alpha('coral', s.beat === 2 ? 0.95 : 0.5), width: 2, head: 7 });
        }
      s.hills.forEach((h) => g.emoji(h.a > 0 ? '⛰️' : '🕳️', [h.c[0], h.c[1] + 0.45], 24));
      if (s.beat === 2) {
        const p = s.probe, gr = gradF(p[0], p[1]);
        const k = 0.9 / Math.max(0.35, Math.hypot(gr[0], gr[1]));
        g.arrow(p, [p[0] + gr[0] * k, p[1]], { color: 'red', width: 3, dash: [5, 4] });
        g.arrow(p, [p[0], p[1] + gr[1] * k], { color: 'green', width: 3, dash: [5, 4] });
        g.arrow(p, [p[0] + gr[0] * k, p[1] + gr[1] * k], { color: 'coral', width: 6 });
        g.text('∇f', [p[0] + gr[0] * k * 1.15 + 0.15, p[1] + gr[1] * k * 1.15 + 0.2], { color: 'coral', size: 18 });
      } else {
        for (const b of s.balls) {
          g.path(b.trail, { color: alpha('white', 0.85), width: 2.5 });
          const gr = gradF(b.p[0], b.p[1]), n = Math.hypot(gr[0], gr[1]);
          if (n > 0.05) {
            const k = Math.min(0.7, n) / n;
            g.arrow(b.p, [b.p[0] + gr[0] * k, b.p[1] + gr[1] * k], { color: 'coral', width: 2.5, dash: [4, 3] });
            g.arrow(b.p, [b.p[0] - gr[0] * k, b.p[1] - gr[1] * k], { color: 'teal', width: 3.5 });
          }
          g.emoji('⚽', b.p, 24);
        }
      }
    }
  },
};
void C;
