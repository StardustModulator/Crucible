// A neural network is a team of neurons. Each first-layer neuron draws ONE
// straight cut; the next layers bend, fold and glue those cuts together until
// the blue and orange dots each get their own territory.
import { C, alpha } from '../viz/palette.js';
import { MLP, Optimizer, trainBatch } from '../core/learning.js';
import { rng } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const N = 170;
function makeData(kind, seed = 4) {
  const r = rng(seed), X = [], Y = [];
  const push = (x, y, c) => { X.push([x, y]); Y.push([c]); };
  for (let i = 0; i < N; i++) {
    if (kind === 'circles') {
      const c = i % 2, a = r.uniform(0, 6.283), rad = c ? r.uniform(0, 0.42) : r.uniform(0.62, 0.95);
      push(rad * Math.cos(a), rad * Math.sin(a), c);
    } else if (kind === 'xor') {
      let x = r.uniform(-0.95, 0.95), y = r.uniform(-0.95, 0.95);
      if (Math.abs(x) < 0.07) x += 0.14 * Math.sign(x || 1);
      if (Math.abs(y) < 0.07) y += 0.14 * Math.sign(y || 1);
      push(x, y, x * y > 0 ? 1 : 0);
    } else if (kind === 'spiral') {
      const c = i % 2, t = (Math.floor(i / 2) / (N / 2)) * 1.0, a = t * 3.6 * Math.PI / 1.2 + c * Math.PI, rad = 0.08 + 0.85 * t;
      push(rad * Math.cos(a) + r.normal(0, 0.025), rad * Math.sin(a) + r.normal(0, 0.025), c);
    } else {
      const c = i % 2, a = r.uniform(0, Math.PI);
      const x = c ? 1 - Math.cos(a) : Math.cos(a), y = c ? 0.35 - Math.sin(a) : Math.sin(a) - 0.15;
      push(0.6 * (x - 0.5) + r.normal(0, 0.11), 0.9 * y - 0.05 + r.normal(0, 0.11), c);
    }
  }
  return { X, Y };
}

const rgb = (c) => { if (c.startsWith('#')) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } return (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number); };
// value v ∈ [−1, 1] → bg tinted toward blue (−) or orange (+)
function tintFn(strength) {
  const bg = rgb(C.bg), b = rgb(C.blue), o = rgb(C.orange);
  return (v) => { const t = Math.min(1, Math.abs(v)) * strength, c = v < 0 ? b : o; return [0, 1, 2].map((k) => bg[k] + (c[k] - bg[k]) * t); };
}
function makeCanvas(n, m, px) {
  const cv = document.createElement('canvas'); cv.width = n; cv.height = m;
  const cx = cv.getContext('2d'), img = cx.createImageData(n, m);
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const c = px(i, j); img.data.set([c[0], c[1], c[2], 255], 4 * (j * n + i)); }
  cx.putImageData(img, 0, 0);
  return cv;
}

export default {
  eq: [
    [['h₁', 'blue'], ' = tanh(', ['W₁', 'blue'], ' ', ['x', 'teal'], ' + ', ['b₁', 'blue'], ')      each row of ', ['W₁', 'blue'], ' = one straight cut'],
    [['hₖ', 'blue'], ' = tanh(', ['Wₖ', 'blue'], ' ', ['hₖ₋₁', 'blue'], ' + ', ['bₖ', 'blue'], ')      each layer bends & folds the last one'],
    [['p', 'orange'], ' = sigmoid(', ['w', 'blue'], '·', ['h', 'blue'], ' + ', ['b', 'blue'], ')      🟠 if ', ['p', 'orange'], ' > ½,  🔵 otherwise'],
    [['L', 'coral'], ' = −mean[ ', ['y', 'lime'], ' log ', ['p', 'orange'], ' + (1−', ['y', 'lime'], ') log(1−', ['p', 'orange'], ') ]      trained with Adam on small batches'],
    ['wire color:  ', ['+ weight', 'blue'], '   ', ['− weight', 'coral'], '      thickness = |weight|'],
  ],
  setup({ stage, ui }) {
    const [D, R] = stage.split([[-1.12, -1.12, 1.12, 1.12], [0, -0.1, 10, 7.4]], [1, 1.12]);
    const s = { kind: 'circles', width: 4, depth: 2, beat: 0, steps: 0, hist: [], ema: null, seed: 1, t: 0, ver: 0, acc: 0 };
    let data = makeData(s.kind), net, opt, maps = null, mapsVer = -1, outCv = null, outKey = '';
    const r = rng(9);
    const build = () => {
      const sizes = [2, ...new Array(s.depth).fill(s.width), 1];
      net = new MLP(sizes, [...new Array(s.depth).fill('tanh'), 'sigmoid'], s.seed);
      opt = new Optimizer(net, { type: 'adam', lr: 0.03 });
      s.steps = 0; s.hist = []; s.ema = null; s.ver++;
    };
    build();
    const pred = (x) => net.predict(x)[0];
    const accuracy = () => data.X.reduce((a, x, i) => a + ((pred(x) > 0.5 ? 1 : 0) === data.Y[i][0] ? 1 : 0), 0) / data.X.length;

    // drop a "rebel" dot: it takes the colour the net currently gets WRONG there
    stage.on('down', (e) => {
      if (e.pen !== D || Math.abs(e.p[0]) > 1.1 || Math.abs(e.p[1]) > 1.1) return;
      data.X.push([e.p[0], e.p[1]]); data.Y.push([pred(e.p) > 0.5 ? 0 : 1]);
    });

    const setKind = (k) => { s.kind = k; data = makeData(k); build(); };
    const kindC = ui.choice({ value: 'circles', color: 'teal', options: [
      { icon: '⭕', value: 'circles', title: 'circles' }, { icon: '❌', value: 'xor', title: 'xor' },
      { icon: '🌀', value: 'spiral', title: 'spiral' }, { icon: '🌙', value: 'moons', title: 'moons' },
    ], onChange: setKind });
    const widthC = ui.choice({ value: 4, color: 'blue', options: [2, 4, 8].map((w) => ({ icon: `↕${w}`, value: w, title: `${w} neurons per layer` })), onChange: (v) => { s.width = v; build(); } });
    const depthC = ui.choice({ value: 2, color: 'blue', options: [1, 2, 3].map((d) => ({ icon: `🧱${d}`, value: d, title: `${d} hidden layers` })), onChange: (v) => { s.depth = v; build(); } });
    ui.button({ icon: '🎲', title: 'start again from new random weights', onClick: () => { s.seed++; build(); } });
    ui.readout(() => fmt(s.ema ?? 0, 3), { icon: '📉', color: 'coral', title: 'loss' });
    ui.readout(() => `${Math.round(100 * s.acc)}%`, { icon: '✅', color: 'lime', title: 'accuracy' });
    ui.beats(['🧠', '🪢', '🏗️', '📉'], (b) => {
      s.beat = b;
      const cfg = [['circles', 4, 2], ['xor', 4, 1], ['spiral', 8, 3], ['moons', 4, 2]][b];
      kindC.set(cfg[0], false); widthC.set(cfg[1], false); depthC.set(cfg[2], false);
      s.kind = cfg[0]; s.width = cfg[1]; s.depth = cfg[2]; data = makeData(s.kind); build();
    });

    const refreshMaps = () => {
      // one pass over a coarse grid gives EVERY neuron's picture at once
      const n = 22, L = net.W.length, layers = [];
      for (let l = 1; l <= L; l++) layers.push(net.W[l - 1].map(() => new Float32Array(n * n)));
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = net.forward([-1.1 + 2.2 * (i + 0.5) / n, 1.1 - 2.2 * (j + 0.5) / n]);
        for (let l = 1; l <= L; l++) for (let k = 0; k < a[l].length; k++) layers[l - 1][k][j * n + i] = l === L ? 2 * a[l][k] - 1 : a[l][k];
      }
      const tint = tintFn(0.85);
      maps = layers.map((lay) => lay.map((v) => makeCanvas(n, n, (i, j) => tint(v[j * n + i]))));
    };
    const refreshOut = () => {
      const n = 70, tint = tintFn(0.42);
      outCv = makeCanvas(n, n, (i, j) => tint(2 * pred([-1.12 + 2.24 * (i + 0.5) / n, 1.12 - 2.24 * (j + 0.5) / n]) - 1));
    };

    return {
      update(dt) {
        dt = Math.max(0, dt);                 // the shell can hand a tiny negative dt right after ⏭
        s.t += dt;
        const per = Math.max(1, Math.round(dt * 60 * 3));
        for (let k = 0; k < per; k++) {
          const Xb = [], Yb = [];
          for (let q = 0; q < 24; q++) { const i = r.int(0, data.X.length); Xb.push(data.X[i]); Yb.push(data.Y[i]); }
          const l = trainBatch(net, opt, Xb, Yb, 'bce');
          s.ema = s.ema === null ? l : s.ema * 0.97 + l * 0.03;
          s.steps++;
          if (s.steps % 6 === 0) { s.hist.push(s.ema); if (s.hist.length > 400) s.hist.splice(0, 2).forEach(() => {}); }
          if (s.steps % 12 === 0) s.ver++;
        }
      },
      draw() {
        const key = `${s.ver}|${C.bg}`;
        if (key !== outKey) { refreshOut(); refreshMaps(); s.acc = accuracy(); outKey = key; }
        drawData();
        drawNet();
      },
    };

    function img(pen, cv, x0, y0, x1, y1) {
      const a = pen.toScreen([x0, y1]), b = pen.toScreen([x1, y0]);
      const ctx = stage.ctx; ctx.save(); ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cv, a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.restore();
    }

    function drawData() {
      const g = D;
      img(g, outCv, -1.12, -1.12, 1.12, 1.12);
      g.rect(-1.12, -1.12, 2.24, 2.24, { color: 'faint', width: 1 });
      // 🪢 each first-layer neuron is a straight cut: w·x + b = 0
      if (s.beat === 1) {
        const ctx = stage.ctx, A = g.toScreen([-1.12, 1.12]), B = g.toScreen([1.12, -1.12]);
        ctx.save(); ctx.beginPath(); ctx.rect(A[0], A[1], B[0] - A[0], B[1] - A[1]); ctx.clip();
        net.W[0].forEach((w, i) => {
          const b = net.b[0][i], n2 = w[0] * w[0] + w[1] * w[1];
          if (n2 < 1e-6) return;
          const p0 = [-b * w[0] / n2, -b * w[1] / n2], d = [-w[1], w[0]].map((v) => v / Math.sqrt(n2));
          g.line([p0[0] - d[0] * 3, p0[1] - d[1] * 3], [p0[0] + d[0] * 3, p0[1] + d[1] * 3], { color: alpha('ink', 0.55), width: 2, dash: [7, 5] });
          const m = [p0[0] + d[0] * 0.0, p0[1] + d[1] * 0.0];
          if (Math.abs(m[0]) < 1.0 && Math.abs(m[1]) < 1.0) g.text(`${i + 1}`, m, { color: 'ink', size: 14, weight: 800 });
        });
        ctx.restore();
      }
      data.X.forEach((x, i) => {
        const y = data.Y[i][0], ok = (pred(x) > 0.5 ? 1 : 0) === y;
        if (s.beat === 3 && !ok) g.circle(x, g.world(9), { color: 'coral', width: 2.5 });
        g.dot(x, 4.5, { color: y ? 'orange' : 'blue', ring: 'bg', ringWidth: 1.5 });
      });
    }

    function drawNet() {
      const g = R, L = net.W.length, sizes = net.sizes;
      const big = s.beat === 3;
      const top = 7.2, bot = big ? 3.6 : 2.0;
      const colX = (l) => 0.7 + l * (8.6 / L);
      const sz = Math.min(0.9, (top - bot) / (Math.max(...sizes) * 1.18));
      const pos = sizes.map((n, l) => Array.from({ length: n }, (_, i) => [colX(l), (top + bot) / 2 + ((n - 1) / 2 - i) * sz * 1.18]));
      // wires
      for (let l = 0; l < L; l++) {
        const W = net.W[l], mx = Math.max(0.5, ...W.flat().map(Math.abs));
        W.forEach((row, i) => row.forEach((w, j) => {
          g.line(pos[l][j], pos[l + 1][i], { color: alpha(w >= 0 ? 'blue' : 'coral', 0.18 + 0.6 * Math.min(1, Math.abs(w) / mx)), width: 0.6 + 4 * Math.min(1, Math.abs(w) / mx) });
        }));
      }
      // input nodes: x₁ and x₂ as pictures
      const half = sz / 2;
      ['x₁', 'x₂'].forEach((lab, i) => {
        const [x, y] = pos[0][i];
        g.rrect(x - half, y - half, sz, sz, 4, { fill: 'panel', color: 'teal', width: 2, stroke: true });
        const ctx = stage.ctx, A = g.toScreen([x - half, y + half]), B = g.toScreen([x + half, y - half]);
        const grd = i === 0 ? ctx.createLinearGradient(A[0], 0, B[0], 0) : ctx.createLinearGradient(0, B[1], 0, A[1]);
        grd.addColorStop(0, alpha('blue', 0.6)); grd.addColorStop(0.5, alpha('bg', 0.2)); grd.addColorStop(1, alpha('orange', 0.6));
        ctx.save(); ctx.fillStyle = grd; ctx.fillRect(A[0] + 2, A[1] + 2, B[0] - A[0] - 4, B[1] - A[1] - 4); ctx.restore();
        g.text(lab, [x - half - 0.28, y], { color: 'teal', size: 13, weight: 800 });
      });
      // hidden + output neurons: each is its own little heat map
      for (let l = 1; l <= L; l++) pos[l].forEach(([x, y], i) => {
        const cv = maps?.[l - 1]?.[i];
        const hz = half;
        if (cv) img(g, cv, x - hz, y - hz, x + hz, y + hz);
        g.rrect(x - hz, y - hz, 2 * hz, 2 * hz, 4, { color: l === L ? 'pink' : 'blue', width: l === L ? 3 : 1.5 });
        if (l === 1 && s.beat === 1) g.text(`${i + 1}`, [x - hz + 0.16, y + hz - 0.16], { color: 'ink', size: 13, weight: 800 });
      });
      // loss over training
      const px0 = 0.6, px1 = 9.6, py0 = 0.25, py1 = big ? 3.1 : 1.6;
      g.line([px0, py0], [px1, py0], { color: 'muted', width: 1.5 });
      g.line([px0, py0], [px0, py1], { color: 'muted', width: 1.5 });
      g.text('L', [px0 - 0.25, py1], { color: 'coral', size: 14, weight: 800 });
      if (s.hist.length > 1) {
        const mx = Math.max(0.75, ...s.hist), n = s.hist.length;
        const pts = s.hist.map((v, i) => [px0 + (i / Math.max(n - 1, 60)) * (px1 - px0), py0 + (v / mx) * (py1 - py0) * 0.95]);
        g.plot(pts, { color: 'coral', width: 2.5, fillTo: py0, fillAlpha: 0.12 });
      }
    }
  },
};
