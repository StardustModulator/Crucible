// Gradient descent = a ball rolling downhill on the loss landscape.
// Step size too small → 🐌 crawl; too big → it bounces out 💥.
// Momentum = a heavy bowling ball that keeps rolling; Adam = a ball that
// sizes its steps separately along each direction.
import { C, alpha, mix } from '../viz/palette.js';
import { Optimizer } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const LANDS = {
  bowl: { f: (x, y) => 0.5 * (x * x + y * y), g: (x, y) => [x, y], min: [0, 0], start: [-2.5, 1.6] },
  valley: { f: (x, y) => 0.04 * x * x + 1.0 * y * y, g: (x, y) => [0.08 * x, 2 * y], min: [0, 0], start: [-2.6, 1.3] },
  banana: {
    f: (x, y) => { const v = y - 0.35 * x * x + 0.5; return 0.2 * (1 - x) ** 2 + 1.5 * v * v; },
    g: (x, y) => { const v = y - 0.35 * x * x + 0.5; return [-0.4 * (1 - x) + 3 * v * (-0.7 * x), 3 * v]; },
    min: [1, -0.15], start: [-2.4, 1.5],
  },
  bumpy: {
    f: (x, y) => 0.12 * (x * x + y * y) + 0.35 * (1 - Math.cos(2.4 * x) * Math.cos(2.4 * y)),
    g: (x, y) => [0.24 * x + 0.84 * Math.sin(2.4 * x) * Math.cos(2.4 * y), 0.24 * y + 0.84 * Math.cos(2.4 * x) * Math.sin(2.4 * y)],
    min: [0, 0], start: [-2.5, 1.55],
  },
};
const KINDS = {
  sgd: { color: 'blue', icon: '⚪', base: 0.25 },
  momentum: { color: 'pink', icon: '🎳', base: 0.05 },
  adam: { color: 'green', icon: '🧭', base: 0.08 },
};
const MAXSTEP = 240;

export default {
  eq: [
    ['SGD:  ', ['θ', 'blue'], ' ← ', ['θ', 'blue'], ' − ', ['η', 'orange'], ' ', ['∇L(θ)', 'coral'], '        (', ['∇L', 'coral'], ' + ', ['noise', 'purple'], ' from small batches)'],
    ['momentum 🎳:  ', ['m', 'pink'], ' ← 0.9 ', ['m', 'pink'], ' + ', ['∇L', 'coral'], ',   ', ['θ', 'pink'], ' ← ', ['θ', 'pink'], ' − ', ['η', 'orange'], ' ', ['m', 'pink']],
    ['Adam 🧭:  ', ['m', 'green'], ' ← avg(', ['∇L', 'coral'], '),  ', ['v', 'green'], ' ← avg(', ['∇L', 'coral'], '²),   ', ['θ', 'green'], ' ← ', ['θ', 'green'], ' − ', ['η', 'orange'], ' ', ['m', 'green'], ' / √', ['v', 'green'], '   (per axis)'],
    ['stable only if ', ['η', 'orange'], ' < 2 / (steepest curvature)   — bigger → bounce 💥,  much smaller → 🐌'],
  ],
  setup({ stage, ui }) {
    const [Lp, Pp] = stage.split([[-3, -2, 3, 2], [0, 0, 1.25, 1]], [1.7, 1]);
    const s = { land: 'bowl', beat: 0, k: 1, noise: 0, start: LANDS.bowl.start.slice(), clock: 0, hold: 0, steps: 0, balls: [], r: rng(5), t: 0 };
    const L = () => LANDS[s.land];

    const makeBall = (kind, lrMul = 1, icon = null) => {
      const net = { W: [[[s.start[0], s.start[1]]]], b: [[]] };
      const K = KINDS[kind];
      return { kind, color: K.color, icon: icon ?? K.icon, lrMul, net, opt: new Optimizer(net, { type: kind, lr: K.base * lrMul * s.k, momentum: 0.9 }), trail: [s.start.slice()], losses: [], dead: false, g: [0, 0] };
    };
    const rebuild = () => {
      s.r = rng(5); s.steps = 0; s.hold = 0; s.clock = 0;
      if (s.beat === 0) s.balls = [makeBall('sgd')];
      else if (s.beat === 1) s.balls = [makeBall('sgd', 0.12, '🐌'), makeBall('sgd', 1, '⚪'), makeBall('sgd', 4.4, '🦘')];
      else if (s.beat === 2) s.balls = [makeBall('sgd'), makeBall('momentum')];
      else s.balls = [makeBall('sgd'), makeBall('momentum'), makeBall('adam')];
    };
    const setLand = (k) => { s.land = k; s.start = LANDS[k].start.slice(); rebuild(); };

    stage.handle({ pen: Lp, color: 'orange', kind: 'ring', r: 11, get: () => s.start, set: (p) => { s.start = [clamp(p[0], -2.9, 2.9), clamp(p[1], -1.9, 1.9)]; rebuild(); } });
    stage.on('down', (e) => { if (e.pen === Lp) { s.start = [clamp(e.p[0], -2.9, 2.9), clamp(e.p[1], -1.9, 1.9)]; rebuild(); } });

    const landC = ui.choice({ value: 'bowl', color: 'coral', options: [
      { icon: '🥣', value: 'bowl', title: 'round bowl' }, { icon: '🛶', value: 'valley', title: 'long narrow valley' },
      { icon: '🍌', value: 'banana', title: 'curved banana valley' }, { icon: '🏔️', value: 'bumpy', title: 'bumpy hills' },
    ], onChange: setLand });
    const noiseSl = ui.slider({ icon: '🌫️', color: 'purple', min: 0, max: 1.2, value: 0, title: 'gradient noise (small batches)', onInput: (v) => (s.noise = v) });
    ui.beats(['⛷️', '🐌', '🎳', '🧭'], (b) => {
      s.beat = b;
      const land = ['bowl', 'valley', 'valley', 'banana'][b];
      const nz = [0, 0, 0.2, 0.12][b];
      s.noise = nz; noiseSl.set(nz);
      landC.set(land, false); s.land = land; s.start = LANDS[land].start.slice();
      rebuild();
    });
    ui.slider({ icon: '👣', color: 'orange', min: -2.3, max: 2.3, value: 0, title: 'learning rate (step size)', onInput: (v) => {
      s.k = Math.exp(v);
      for (const b of s.balls) b.opt.lr = KINDS[b.kind].base * b.lrMul * s.k;
    } });
    ui.readout(() => `${s.steps}`, { icon: '👣', color: 'ink', title: 'steps taken' });
    rebuild();

    const stepAll = () => {
      const land = L();
      for (const b of s.balls) {
        if (b.dead) continue;
        const p = b.net.W[0][0];
        const g = land.g(p[0], p[1]);
        const gn = [g[0] + s.noise * s.r.normal(), g[1] + s.noise * s.r.normal()];
        b.g = g;
        b.opt.step([[gn]], [[]]);
        const q = b.net.W[0][0];
        if (!Number.isFinite(q[0]) || !Number.isFinite(q[1]) || Math.abs(q[0]) > 8 || Math.abs(q[1]) > 6) { b.dead = true; b.boom = s.t; continue; }
        b.trail.push([q[0], q[1]]);
        if (b.trail.length > 400) b.trail.shift();
        b.losses.push(land.f(q[0], q[1]));
      }
      s.steps++;
    };

    // own terrain: smooth coral tint (higher = more loss) + vector contour lines (cached)
    let terrain = null, terrainKey = '', iso = [];
    const buildTerrain = () => {
      const [x0, y0, x1, y1] = Lp.view, land = L();
      const nx = 120, ny = Math.max(2, Math.round(nx * (y1 - y0) / (x1 - x0)));
      const T = (x, y) => Math.log1p(4 * land.f(x, y));
      const grid = [];
      let mx = 0;
      for (let j = 0; j <= ny; j++) { const row = []; for (let i = 0; i <= nx; i++) { const v = T(x0 + i / nx * (x1 - x0), y0 + j / ny * (y1 - y0)); row.push(v); mx = Math.max(mx, v); } grid.push(row); }
      const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
      const cx = cv.getContext('2d'), img = cx.createImageData(nx, ny);
      const lo = rgb(C.bg), hi = rgb(C.coral);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const t = grid[ny - 1 - j][i] / (mx || 1), a = 0.04 + 0.36 * t;
        img.data.set([...lo.map((v, q) => v + (hi[q] - v) * a), 255], 4 * (j * nx + i));
      }
      cx.putImageData(img, 0, 0);
      terrain = cv;
      // marching squares
      iso = [];
      const X = (i) => x0 + i / nx * (x1 - x0), Y = (j) => y0 + j / ny * (y1 - y0);
      for (let k = 1; k <= 13; k++) {
        const lv = (k / 14) * mx, segs = [];
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
          const pts = [];
          const e = (va, vb, pa, pb) => { if ((va < lv) !== (vb < lv)) { const t = (lv - va) / (vb - va); pts.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]); } };
          e(a, b, [X(i), Y(j)], [X(i + 1), Y(j)]);
          e(b, c, [X(i + 1), Y(j)], [X(i + 1), Y(j + 1)]);
          e(c, d, [X(i + 1), Y(j + 1)], [X(i), Y(j + 1)]);
          e(d, a, [X(i), Y(j + 1)], [X(i), Y(j)]);
          if (pts.length >= 2) segs.push([pts[0], pts[1]]);
          if (pts.length === 4) segs.push([pts[2], pts[3]]);
        }
        iso.push(segs);
      }
    };
    const drawIso = () => {
      const ctx = stage.ctx;
      ctx.save(); ctx.lineWidth = 1.2;
      iso.forEach((segs, k) => {
        ctx.strokeStyle = alpha('coral', 0.18 + 0.025 * k);
        ctx.beginPath();
        for (const [a, b] of segs) { const A = Lp.toScreen(a), B = Lp.toScreen(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); }
        ctx.stroke();
      });
      ctx.restore();
    };

    return {
      update(dt) {
        dt = Math.max(0, dt);                 // the shell can hand a tiny negative dt right after ⏭
        s.t += dt;
        if (s.steps >= MAXSTEP || s.balls.every((b) => b.dead)) { s.hold += dt; if (s.hold > 2) rebuild(); return; }
        s.clock += dt;
        let n = 0;
        while (s.clock > 1 / 22 && n < 4) { s.clock -= 1 / 22; stepAll(); n++; }
      },
      draw() {
        const key = `${s.land}|${C.bg}|${Lp.area.w}x${Lp.area.h}`;
        if (key !== terrainKey) { buildTerrain(); terrainKey = key; }
        const [x0, y0, x1, y1] = Lp.view;
        const a = Lp.toScreen([x0, y1]), b = Lp.toScreen([x1, y0]);
        stage.ctx.save(); stage.ctx.imageSmoothingEnabled = true;
        stage.ctx.drawImage(terrain, a[0], a[1], b[0] - a[0], b[1] - a[1]);
        stage.ctx.restore();
        drawIso();
        const g = Lp, land = L();
        g.emoji('⭐', land.min, 22);
        g.clip(() => {
          for (const ball of s.balls) {
            g.path(ball.trail, { color: alpha(ball.color, 0.85), width: 2.5 });
            for (const p of ball.trail) g.dot(p, 2, { color: ball.color });
          }
          for (const ball of s.balls) {
            const p = ball.trail[ball.trail.length - 1];
            if (ball.dead) {
              const pc = [clamp(p[0], x0 + 0.3, x1 - 0.3), clamp(p[1], y0 + 0.3, y1 - 0.3)];
              g.emoji('💥', pc, 30 + 6 * Math.sin(s.t * 8));
              continue;
            }
            // which way is downhill: −∇L (coral)
            if (s.beat === 0) {
              const gg = land.g(p[0], p[1]), n = Math.hypot(...gg);
              if (n > 0.02) { const k = Math.min(0.9, n * 0.6) / n; g.arrow(p, [p[0] - gg[0] * k, p[1] - gg[1] * k], { color: 'coral', width: 4 }); }
            }
            g.dot(p, 10, { color: ball.color, ring: 'bg', ringWidth: 2.5 });
            if (ball.icon !== '⚪') g.emoji(ball.icon, [p[0] + g.world(16), p[1] + g.world(16)], 18);
          }
        });
        drawPlot();
      },
    };

    function drawPlot() {
      const g = Pp;
      const X = (i) => 0.1 + (i / MAXSTEP) * 1.08;
      const lo = -3, hi = 1.3;
      const Y = (v) => 0.1 + clamp((Math.log10(v + 1e-3) - lo) / (hi - lo), 0, 1.05) * 0.82;
      g.line([0.1, 0.1], [1.2, 0.1], { color: 'muted', width: 1.5 });
      g.line([0.1, 0.1], [0.1, 0.96], { color: 'muted', width: 1.5 });
      for (let d = lo; d <= hi; d += 1) g.line([0.1, Y(10 ** d)], [1.2, Y(10 ** d)], { color: 'grid', width: 1 });
      g.text('L', [0.05, 0.94], { color: 'coral', size: 16, weight: 800 });
      g.text('👣', [1.17, 0.04], { size: 14 });
      for (const ball of s.balls) {
        if (ball.losses.length < 2 && !ball.dead) continue;
        const pts = ball.losses.map((v, i) => [X(i + 1), Y(v)]);
        g.path(pts, { color: ball.color, width: 2.5, dash: ball.icon === '🐌' ? [2, 4] : ball.icon === '🦘' ? [8, 4] : undefined });
        const last = pts[pts.length - 1] ?? [X(0), Y(L().f(...s.start))];
        g.emoji(ball.dead ? '💥' : ball.icon === '⚪' ? '' : ball.icon, [last[0] + 0.04, last[1]], 14);
        if (ball.icon === '⚪' && !ball.dead) g.dot(last, 5, { color: ball.color, ring: 'bg' });
      }
    }
  },
};

function rgb(c) {
  if (c.startsWith('#')) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
}
void mix; void fmt;
