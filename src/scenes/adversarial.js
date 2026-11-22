// Adversarial examples: a trained classifier draws a border between 🐼 and 🦍.
// Take a point, ask "which tiny push makes the loss grow fastest?" (the sign of the
// gradient, coral arrow), push by ε in every direction at once (the ε-square), and the
// label flips — even though the point barely moved. In a picture the push is faint static
// you can hardly see. Training on such pushed points moves the border away from the data.
import { C, alpha, mix } from '../viz/palette.js';
import { MLP, Optimizer, trainBatch } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const CL = ['🐼', '🦍'], CC = ['blue', 'orange'];
const rgb = (c) => { if (c.startsWith('#')) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } return (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number); };

function moons(seed) {
  const r = rng(seed), X = [], Y = [];
  for (let i = 0; i < 140; i++) {
    const c = i % 2, a = r.uniform(0, Math.PI);
    const x = c ? 1 - Math.cos(a) : Math.cos(a), y = c ? 0.45 - Math.sin(a) : Math.sin(a) - 0.05;
    X.push([0.95 * (x - 0.5) + r.normal(0, 0.09), 1.0 * (y - 0.2) + r.normal(0, 0.09)]); Y.push([c]);
  }
  return { X, Y };
}
// ∂L/∂x for binary cross-entropy at label y (through the core MLP's backward pass)
function inputGrad(net, x, y) {
  const a = net.forward(x), p = a[a.length - 1][0];
  const { deltas } = net.backward(a, [(p - y) / Math.max(p * (1 - p), 1e-6)]);
  return [0, 1].map((j) => net.W[0].reduce((s, row, i) => s + row[j] * deltas[0][i], 0));
}
// FGSM step for an image-like input on a linear (logistic) model: sign(∂L/∂x) = ±sign(w)
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

// 8×8 pictures: a panda face and a gorilla face (values 0 = dark … 1 = light)
const PANDA = ['.#....#.', '##.oo.##', '.oooooo.', '.##oo##.', '.##oo##.', '.oo##oo.', '.oo##oo.', '..oooo..'];
const GORILLA = ['..####..', '.######.', '##o##o##', '########', '.#oooo#.', '.#o##o#.', '.#oooo#.', '..####..'];
const UP = 3, SIDE = 8 * UP;                     // 24×24 pictures (576 pixels)
const pic = (rows) => Array.from({ length: SIDE }, (_, i) => Array.from({ length: SIDE }, (_, j) => {
  const ch = rows[Math.floor(i / UP)][Math.floor(j / UP)];
  return ch === 'o' ? 0.95 : ch === '#' ? 0.1 : 0.55;
}));

export default {
  eq: [
    ['FGSM:  ', ['x′', 'coral'], ' = ', ['x', 'teal'], ' + ', ['ε', 'purple'], ' · sign(', ['∇ₓ L(x, y)', 'coral'], ')       (one step, every coordinate moves ±ε)'],
    ['allowed pushes: the ', ['ε', 'purple'], '-square  ‖', ['x′', 'coral'], ' − ', ['x', 'teal'], '‖∞ ≤ ', ['ε', 'purple']],
    ['linear model:  Δz = ', ['ε', 'purple'], ' ‖w‖₁  — tiny per pixel, huge when summed over many pixels'],
    ['adversarial training:  min over θ of  L(θ, ', ['x', 'teal'], ') + L(θ, ', ['x′', 'coral'], ')     → the border moves away from the data 🛡️'],
  ],
  setup({ stage, ui }) {
    const [Lp, Rp] = stage.split([[-1.55, -1.45, 1.55, 1.45], [0, 0, 10, 8]], [1.3, 1]);
    const r = rng(12);
    const s = { beat: 0, eps: 0.12, x: [0.05, 0.42], t: 0, ver: 0, advSteps: 0 };
    const data = moons(6);
    const clean = new MLP([2, 16, 16, 1], ['tanh', 'tanh', 'sigmoid'], 3);
    const opt = new Optimizer(clean, { type: 'adam', lr: 0.02 });
    const batch = () => { const Xb = [], Yb = []; for (let i = 0; i < 32; i++) { const k = r.int(0, data.X.length); Xb.push(data.X[k]); Yb.push(data.Y[k]); } return [Xb, Yb]; };
    for (let i = 0; i < 700; i++) trainBatch(clean, opt, ...batch(), 'bce');
    const copy = (src) => { const n = new MLP(src.sizes, src.acts, 3); n.W = src.W.map((M) => M.map((row) => row.slice())); n.b = src.b.map((v) => v.slice()); return n; };
    let robust = copy(clean), ropt = new Optimizer(robust, { type: 'adam', lr: 0.01 });
    const net = () => (s.beat === 3 ? robust : clean);
    const P = (x, n = net()) => n.predict(x)[0];

    // the pixel world: logistic regression (a 576 → 1 core MLP) trained on 8 noisy panda / gorilla
    // pictures. It is right on new pictures too — but with 576 knobs, a tiny push on every pixel adds up.
    const imgs = [pic(PANDA), pic(GORILLA)];
    const lin = new MLP([SIDE * SIDE, 1], ['sigmoid'], 5);
    const lopt = new Optimizer(lin, { type: 'adam', lr: 0.1 });
    const pr = rng(12), Xtr = [], Ytr = [];
    for (let k = 0; k < 8; k++) { const c = k % 2; Xtr.push(imgs[c].flat().map((v) => clamp(v + pr.normal(0, 0.45), 0, 1))); Ytr.push([c]); }
    for (let it = 0; it < 400; it++) trainBatch(lin, lopt, Xtr, Ytr, 'bce');

    {
      // start the probe on a 🐼 dot that a 0.12-push can fool, near the middle
      let best = null, bd = Infinity;
      data.X.forEach((x, i) => {
        if (data.Y[i][0] !== 0 || P(x, clean) > 0.5) return;
        const y = 0, g0 = inputGrad(clean, x, y), xa = [x[0] + 0.12 * sgn(g0[0]), x[1] + 0.12 * sgn(g0[1])];
        const d = Math.hypot(x[0], x[1] - 0.3);
        if (P(xa, clean) > 0.5 && d < bd) { bd = d; best = x; }
      });
      if (best) s.x = best.slice();
    }
    stage.handle({ pen: Lp, color: 'teal', kind: 'ring', r: 12, visible: () => s.beat !== 2, get: () => s.x, set: (p) => (s.x = [clamp(p[0], -1.45, 1.45), clamp(p[1], -1.35, 1.35)]) });
    ui.beats(['🐼', '🏹', '🖼️', '🛡️'], (b) => {
      s.beat = b;
      if (b === 3) { robust = copy(clean); ropt = new Optimizer(robust, { type: 'adam', lr: 0.01 }); s.advSteps = 0; s.ver++; }
      const e = [0.12, 0.12, 0.09, 0.2][b]; s.eps = e; epsS.set(e);
    });
    const epsS = ui.slider({ icon: 'ε', color: 'purple', min: 0, max: 0.4, step: 0.005, value: s.eps, title: 'push size ε', onInput: (v) => (s.eps = v) });
    ui.readout(() => { const a = attack(s.x); return `${CL[P(s.x) > 0.5 ? 1 : 0]}→${CL[P(a) > 0.5 ? 1 : 0]}`; }, { icon: '🏹', color: 'coral', title: 'label before → after the push' });

    function attack(x, n = net(), eps = s.eps) {
      const y = n.predict(x)[0] > 0.5 ? 1 : 0;                 // push AWAY from what it believes now
      const gr = inputGrad(n, x, y);
      return [x[0] + eps * sgn(gr[0]), x[1] + eps * sgn(gr[1])];
    }

    const picCache = new Map();
    // cached background: class tint + the p = ½ border (marching squares)
    const caches = new Map();
    const field = (n, key) => {
      if (caches.has(key)) return caches.get(key);
      const nx = 64, ny = 60, [x0, y0, x1, y1] = [-1.55, -1.45, 1.55, 1.45];
      const grid = [];
      for (let j = 0; j <= ny; j++) { const row = []; for (let i = 0; i <= nx; i++) row.push(n.predict([x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny])[0]); grid.push(row); }
      const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
      const cx = cv.getContext('2d'), img = cx.createImageData(nx, ny), bg = rgb(C.bg), b = rgb(C.blue), o = rgb(C.orange);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p = grid[ny - 1 - j][i], t = Math.min(1, Math.abs(2 * p - 1)) * 0.38, c = p < 0.5 ? b : o;
        img.data.set([...bg.map((v, k) => v + (c[k] - v) * t), 255], 4 * (j * nx + i));
      }
      cx.putImageData(img, 0, 0);
      const segs = [];
      const X = (i) => x0 + (x1 - x0) * i / nx, Y = (j) => y0 + (y1 - y0) * j / ny;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]], c = [[X(i), Y(j)], [X(i + 1), Y(j)], [X(i + 1), Y(j + 1)], [X(i), Y(j + 1)]], pts = [];
        for (let e = 0; e < 4; e++) { const a = v[e], bb = v[(e + 1) % 4]; if ((a < 0.5) !== (bb < 0.5)) { const t = (0.5 - a) / (bb - a); pts.push([c[e][0] + (c[(e + 1) % 4][0] - c[e][0]) * t, c[e][1] + (c[(e + 1) % 4][1] - c[e][1]) * t]); } }
        if (pts.length >= 2) segs.push([pts[0], pts[1]]); if (pts.length === 4) segs.push([pts[2], pts[3]]);
      }
      const out = { cv, segs };
      caches.set(key, out);
      if (caches.size > 6) caches.delete(caches.keys().next().value);
      return out;
    };

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt;
        if (s.beat === 3 && s.advSteps < 900) {
          // adversarial training: train on the data AND on their FGSM-pushed copies
          for (let k = 0; k < 4; k++) {
            const [Xb, Yb] = batch();
            const Xa = Xb.map((x, i) => { const g = inputGrad(robust, x, Yb[i][0]); return [x[0] + 0.18 * sgn(g[0]), x[1] + 0.18 * sgn(g[1])]; });
            trainBatch(robust, ropt, [...Xb, ...Xa], [...Yb, ...Yb], 'bce');
            s.advSteps++;
          }
          if (s.advSteps % 40 === 0) s.ver++;
        }
      },
      draw() {
        drawPlane();
        if (s.beat === 2) drawPixels(); else if (s.beat === 3) drawShield(); else drawSide();
      },
    };

    function drawSegs(g, segs, o) {
      const ctx = stage.ctx;
      ctx.save(); ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.setLineDash(o.dash ?? []); ctx.beginPath();
      for (const [a, b] of segs) { const A = g.toScreen(a), B = g.toScreen(b); ctx.moveTo(...A); ctx.lineTo(...B); }
      ctx.stroke(); ctx.restore();
    }

    function drawPlane() {
      const g = Lp, n = net();
      const F = field(n, `${s.beat === 3 ? 'r' + s.ver : 'c'}|${C.bg}`);
      const a = g.toScreen([-1.55, 1.45]), b = g.toScreen([1.55, -1.45]);
      stage.ctx.save(); stage.ctx.imageSmoothingEnabled = true; stage.ctx.drawImage(F.cv, a[0], a[1], b[0] - a[0], b[1] - a[1]); stage.ctx.restore();
      if (s.beat === 3) drawSegs(g, field(clean, `c|${C.bg}`).segs, { color: alpha('ink', 0.5), width: 2, dash: [6, 5] });
      drawSegs(g, F.segs, { color: C.ink, width: 3 });
      data.X.forEach((x, i) => g.dot(x, 3.5, { color: CC[data.Y[i][0]], ring: 'bg', ringWidth: 1 }));
      if (s.beat === 2) return;
      // the probe, its ε-square and the FGSM push
      const x = s.x, p = P(x), xa = attack(x), pa = P(xa);
      const flip = (p > 0.5) !== (pa > 0.5);
      if (s.beat >= 1) {
        g.rect(x[0] - s.eps, x[1] - s.eps, 2 * s.eps, 2 * s.eps, { fill: alpha('purple', 0.12), color: 'purple', width: 2, dash: [5, 4], stroke: true });
        g.arrow(x, xa, { color: 'coral', width: 4 });
        g.dot(xa, 7, { color: CC[pa > 0.5 ? 1 : 0], ring: 'coral', ringWidth: 3 });
        g.emoji(CL[pa > 0.5 ? 1 : 0], [xa[0] + 0.2, xa[1] - 0.2], 24);
        if (flip) g.emoji('💥', [xa[0] + 0.05, xa[1] + 0.27], 20 + 4 * Math.sin(s.t * 9));
      }
      g.emoji(CL[p > 0.5 ? 1 : 0], [x[0] - 0.22, x[1] + 0.2], 28);
      if (s.beat === 3) {
        // how many data points survive an ε-push: clean vs robust border
        const cnt = (n2) => data.X.reduce((acc, xx, i) => acc + (((P(attack(xx, n2, s.eps), n2) > 0.5) ? 1 : 0) === data.Y[i][0] ? 1 : 0), 0);
        s.surv = [cnt(clean), cnt(robust)].map((v) => v / data.X.length);
      }
    }

    function drawSide() {
      const g = Rp, x = s.x, p = P(x), xa = attack(x), pa = P(xa);
      // two bars per point: chance of 🐼 and of 🦍, before (teal) and after the push (coral)
      const bars = (q, x0, ring) => {
        [1 - q, q].forEach((v, k) => {
          g.bar(x0 + k * 1.3, 1.5, 1.0, v * 4.6, { color: alpha(CC[k], 0.85) });
          g.emoji(CL[k], [x0 + k * 1.3 + 0.5, 0.9], 22);
          g.text(`${Math.round(v * 100)}`, [x0 + k * 1.3 + 0.5, 1.5 + v * 4.6 + 0.35], { color: CC[k], size: 13, weight: 800 });
        });
        g.circle([x0 + 1.15, 7.2], 0.32, { color: ring, width: 3 });
      };
      g.line([0.4, 1.5], [9.6, 1.5], { color: 'muted', width: 1.5 });
      bars(p, 0.8, 'teal');
      if (s.beat >= 1) {
        g.arrow([3.6, 4.2], [5.1, 4.2], { color: 'coral', width: 4 });
        g.text(`ε ${fmt(s.eps, 2)}`, [4.35, 4.75], { color: 'purple', size: 14, weight: 800 });
        bars(pa, 5.9, 'coral');
      }
    }

    function drawShield() {
      // how many dots keep their label after an ε-push: old border (dashed) vs adversarially trained (solid)
      const g = Rp;
      if (!s.surv) return;
      g.line([0.6, 1.2], [9.4, 1.2], { color: 'muted', width: 1.5 });
      [[s.surv[0], 0.4, [6, 5], 2.4], [s.surv[1], 1, [], 6.2]].forEach(([v, a, dash, x]) => {
        g.bar(x - 1.0, 1.2, 2.0, v * 5.2, { color: alpha('lime', a) });
        g.text(`${Math.round(v * 100)}%`, [x, 1.2 + v * 5.2 + 0.4], { color: 'lime', size: 16, weight: 800 });
        g.line([x - 0.9, 0.55], [x + 0.9, 0.55], { color: 'ink', width: dash.length ? 2 : 3.5, dash });
      });
      g.emoji('🏹', [4.3, 7.4], 24);
      g.text(`ε ${fmt(s.eps, 2)}`, [5.4, 7.4], { color: 'purple', size: 14, weight: 800 });
      g.emoji('🛡️', [6.2, 6.95], 26);
      g.text(`${s.advSteps}`, [8.9, 0.75], { color: 'muted', size: 11 });
    }

    // pictures are painted into small offscreen canvases (cached per ε / theme)
    function picCanvas(key, M, colorFn) {
      if (picCache.has(key)) return picCache.get(key);
      const n = M.length, cv = document.createElement('canvas'); cv.width = n; cv.height = n;
      const cx = cv.getContext('2d'), im = cx.createImageData(n, n);
      M.forEach((row, i) => row.forEach((v, j) => im.data.set([...colorFn(v), 255], 4 * (i * n + j))));
      cx.putImageData(im, 0, 0);
      picCache.set(key, cv);
      if (picCache.size > 12) picCache.delete(picCache.keys().next().value);
      return cv;
    }
    function blit(cv, x0, y0, size) {
      const a = Rp.toScreen([x0, y0]), b = Rp.toScreen([x0 + size, y0 - size]), ctx = stage.ctx;
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(cv, a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.restore();
      Rp.rect(x0, y0 - size, size, size, { color: 'faint', width: 1 });
    }
    function drawPixels() {
      // picture + ε × sign(w) = picture′ — it looks the same to us, but the model changes its mind
      const g = Rp, w = lin.W[0][0], img = imgs[0];
      const noise = img.map((row, i) => row.map((_, j) => sgn(w[i * SIDE + j])));   // push AWAY from 🐼 (label 0)
      const adv = img.map((row, i) => row.map((v, j) => clamp(v + s.eps * noise[i][j], 0, 1)));
      const gray = (v) => { const k = Math.round(255 * v); return [k, k, k]; };
      const pur = rgb(C.purple), pan = rgb(C.panel);
      const sz = 2.75, top = 7.7;
      blit(picCanvas('img', img, gray), 0.1, top, sz);
      g.text('+', [3.2, top - sz / 2], { size: 24, weight: 800, color: 'ink' });
      blit(picCanvas(`n|${C.purple}`, noise, (v) => (v > 0 ? pur : pan.map((c, k) => c + (pur[k] - c) * 0.15))), 3.62, top, sz);
      g.text(`× ε ${fmt(s.eps, 2)}`, [3.62 + sz / 2, top - sz - 0.32], { color: 'purple', size: 13, weight: 800 });
      g.text('=', [6.78, top - sz / 2], { size: 24, weight: 800, color: 'ink' });
      blit(picCanvas(`a|${s.eps}`, adv, gray), 7.15, top, sz);
      // the model's verdicts
      const p0 = lin.predict(img.flat())[0], p1 = lin.predict(adv.flat())[0];
      const verdict = (q, cx) => {
        [1 - q, q].forEach((v, k) => {
          g.bar(cx - 1.1 + k * 1.2, 0.6, 0.9, v * 2.9, { color: alpha(CC[k], 0.85) });
          g.emoji(CL[k], [cx - 0.65 + k * 1.2, 0.25], 18);
        });
        g.emoji(CL[q > 0.5 ? 1 : 0], [cx, 4.15], 30);
      };
      verdict(p0, 1.5);
      verdict(p1, 8.5);
      if ((p0 > 0.5) !== (p1 > 0.5)) g.emoji('💥', [5.0, 2.2], 34);
      g.line([0.2, 0.6], [9.8, 0.6], { color: 'muted', width: 1.5 });
    }
  },
};
