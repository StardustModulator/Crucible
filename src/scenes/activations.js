// An activation is a bendy mirror for numbers. Pour a pile of inputs in at the
// bottom, they bounce off the curve and land as a new pile on the side.
// Where the curve goes flat its slope is ~0: gradients fall asleep there (😴).
// Stacking ReLUs folds the number line like paper → zigzags with many pieces.
import { C, alpha, mix } from '../viz/palette.js';
import { act } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const gelu = (x) => 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
const FUNCS = {
  step: { f: (x) => (x > 0 ? 1 : 0), df: () => 0, icon: '🪜' },
  sigmoid: { f: act.sigmoid.f, df: (x) => act.sigmoid.df(act.sigmoid.f(x)), icon: '〰️' },
  tanh: { f: act.tanh.f, df: (x) => act.tanh.df(act.tanh.f(x)), icon: '🌊' },
  relu: { f: act.relu.f, df: (x) => act.relu.df(act.relu.f(x)), icon: '📐' },
  leaky: { f: act.leaky.f, df: (x) => act.leaky.df(act.leaky.f(x)), icon: '🦵' },
  gelu: { f: gelu, df: (x) => (gelu(x + 1e-4) - gelu(x - 1e-4)) / 2e-4, icon: '🫧' },
};
const FLAT = 0.05;
const NS = 500;
// one fold = two ReLUs: tent(h) = 2·relu(h) − 4·relu(h − ½)   (maps [0,1] onto [0,1] twice)
const tent = (h) => 2 * act.relu.f(h) - 4 * act.relu.f(h - 0.5);
const strip = (x) => (x < 0.5 ? mix('teal', 'gold', x * 2) : mix('gold', 'pink', x * 2 - 1));

export default {
  eq: [
    [['y', 'pink'], ' = σ(', ['x', 'teal'], ')       sigmoid 1/(1+e⁻ˣ),  tanh,  ReLU max(0,x),  leaky max(0.05x, x),  GELU x·Φ(x)'],
    [['∂L/∂x', 'coral'], ' = ', ['σ′(x)', 'coral'], ' · ', ['∂L/∂y', 'coral'], '     where ', ['σ′ ≈ 0', 'coral'], ' the signal dies (saturation / vanishing gradient)'],
    ['sigmoid′ ≤ ¼,   tanh′ ≤ 1,   ReLU′ ∈ {0, 1}'],
    ['fold = ', ['2·relu(h) − 4·relu(h − ½)', 'blue'], ';   k folds → ', ['2ᵏ', 'gold'], ' straight pieces from only 2k neurons'],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[-5.7, -2.75, 3.4, 3.2], [-3.4, -0.45, 3.4, 1.35]], [1.45, 1]);
    const s = { fn: 'sigmoid', beat: 0, x: 0.8, mu: 0, sig: 1, layers: 3, t: 0, parts: [] };
    const F = () => FUNCS[s.fn];
    const r = rng(11);
    const base = Array.from({ length: NS }, () => r.normal());
    const samples = () => base.map((z) => s.mu + s.sig * z);
    const D = 5, SX = 3.2 / D, X0 = -D, X1 = D, XL = -3.45;   // data x ∈ [−5, 5] drawn squeezed by SX

    stage.handle({ pen: A, color: 'orange', r: 10, visible: () => s.beat === 0, get: () => [SX * s.x, 0], set: (p) => (s.x = clamp(p[0] / SX, -D, D)) });
    stage.handle({ pen: A, color: 'teal', r: 10, kind: 'square', visible: () => s.beat === 1 || s.beat === 2, get: () => [SX * s.mu, -2.6], set: (p) => (s.mu = clamp(p[0] / SX, -4, 4)) });

    ui.beats(['📈', '🌊', '😴', '📄'], (b) => {
      s.beat = b;
      if (b === 2) { s.mu = 1.5; s.sig = 1.6; sigSl.set(1.6); if (s.fn === 'relu' || s.fn === 'leaky' || s.fn === 'gelu') { s.fn = 'sigmoid'; fnC.set('sigmoid', false); } }
      if (b === 1) { s.mu = 0; s.sig = 1; sigSl.set(1); }
    });
    const fnC = ui.choice({ value: 'sigmoid', color: 'blue', options: Object.entries(FUNCS).map(([k, v]) => ({ icon: v.icon, value: k, title: k })), onChange: (v) => (s.fn = v) });
    const sigSl = ui.slider({ icon: '↔️', color: 'purple', min: 0.2, max: 3, value: 1, title: 'spread of the inputs', onInput: (v) => (s.sig = v) });
    ui.slider({ icon: '📄', color: 'blue', min: 1, max: 6, step: 1, value: 3, title: 'number of folding layers', onInput: (v) => (s.layers = v) });
    ui.readout(() => {
      if (s.beat === 0) return fmt(F().df(s.x), 2);
      if (s.beat === 3) return `${2 ** s.layers}`;
      const xs = samples(); return `${Math.round(100 * xs.filter((x) => Math.abs(F().df(x)) < FLAT).length / NS)}%`;
    }, { icon: '📏', color: 'coral', title: 'slope / share of sleeping inputs / pieces' });

    return {
      update(dt) {
        dt = Math.max(0, dt);                 // the shell can hand a tiny negative dt right after ⏭
        s.t += dt;
        if (s.beat === 1 || s.beat === 2) {
          // spawn falling beads
          for (let k = 0; k < 1; k++) s.parts.push({ x: s.mu + s.sig * r.normal(), u: 0 });
          for (const p of s.parts) p.u += dt * 0.55;
          s.parts = s.parts.filter((p) => p.u < 1);
        } else s.parts = [];
      },
      draw() {
        if (s.beat === 3) { drawFold(); return; }
        drawCurve(); drawSlope();
      },
    };

    function flatSpans(xa, xb) {
      const spans = []; let st = null;
      for (let i = 0; i <= 240; i++) {
        const x = xa + (xb - xa) * i / 240, fl = Math.abs(F().df(x)) < FLAT;
        if (fl && st === null) st = x;
        if (!fl && st !== null) { spans.push([st, x]); st = null; }
      }
      if (st !== null) spans.push([st, xb]);
      return spans;
    }

    function drawCurve() {
      const g = A, f = F().f;
      const showFlat = s.beat === 2;
      const curve = (a, b) => { const pts = []; for (let i = 0; i <= 200; i++) { const x = a + (b - a) * i / 200, y = f(x); if (y <= 3.15) pts.push([SX * x, y]); } return pts; };
      if (showFlat) for (const [a, b] of flatSpans(X0, X1)) g.rect(SX * a, -1.25, SX * (b - a), 4.35, { fill: alpha('coral', 0.12), stroke: false });
      g.line([SX * X0, 0], [SX * X1, 0], { color: 'muted', width: 1.5 });
      g.line([0, -1.25], [0, 3.1], { color: 'muted', width: 1.5 });
      for (const v of [-1, 1, 2, 3]) g.line([-0.08, v], [0.08, v], { color: 'muted', width: 1.5 });
      for (const v of [-4, -2, 2, 4]) g.line([SX * v, -0.08], [SX * v, 0.08], { color: 'muted', width: 1.5 });
      g.path(curve(X0, X1), { color: 'blue', width: 4 });
      if (showFlat) for (const [a, b] of flatSpans(X0, X1)) g.path(curve(a, b), { color: 'coral', width: 6 });

      if (s.beat === 0) {
        const xd = s.x, x = SX * xd, y = f(xd), d = F().df(xd) / SX;
        g.line([x, 0], [x, Math.min(y, 3.1)], { color: 'orange', width: 2, dash: [5, 4] });
        if (y > 3.1) return;
        g.arrow([x, y], [XL + 0.15, y], { color: alpha('pink', 0.8), width: 2.5 });
        // tangent: the slope
        const h = 0.9 / Math.sqrt(1 + d * d);
        g.line([x - h, y - d * h], [x + h, y + d * h], { color: 'coral', width: 4 });
        g.dot([x, y], 7, { color: 'blue', ring: 'bg' });
        g.dot([XL, y], 8, { color: 'pink', ring: 'bg' });
        g.text(fmt(y, 2), [XL - 0.75, y], { color: 'pink', size: 15, weight: 700 });
        g.text(fmt(xd, 1), [x, -0.45], { color: 'orange', size: 15, weight: 700 });
        g.emoji(Math.abs(d) < FLAT ? '😴' : '🏃', [x + 0.55, y + 0.6], 22);
        return;
      }
      // histograms: input (teal, bottom) → output (pink, left)
      const xs = samples(), ys = xs.map(f);
      const nb = 32;
      const hin = new Array(nb).fill(0), hout = new Array(nb).fill(0);
      const ylo = -1.2, yhi = 3.1;
      for (let i = 0; i < NS; i++) {
        const bi = Math.floor((xs[i] - X0) / (X1 - X0) * nb); if (bi >= 0 && bi < nb) hin[bi]++;
        const bo = Math.floor((ys[i] - ylo) / (yhi - ylo) * nb); if (bo >= 0 && bo < nb) hout[bo]++;
      }
      const bw = (X1 - X0) / nb, bh = (yhi - ylo) / nb;
      const mi = Math.max(...hin), mo = Math.max(...hout);
      for (let i = 0; i < nb; i++) {
        const xc = X0 + (i + 0.5) * bw;
        const flat = showFlat && Math.abs(F().df(xc)) < FLAT;
        if (hin[i]) g.rect(SX * (X0 + i * bw) + 0.01, -2.6, SX * bw - 0.02, 1.0 * hin[i] / mi, { fill: alpha(flat ? 'coral' : 'teal', 0.75), stroke: false });
        if (hout[i]) g.rect(XL - 1.9 * hout[i] / mo, ylo + i * bh + 0.01, 1.9 * hout[i] / mo, bh - 0.02, { fill: alpha('pink', 0.75), stroke: false });
      }
      g.line([SX * X0, -2.6], [SX * X1, -2.6], { color: 'muted', width: 1 });
      g.line([XL, ylo], [XL, yhi], { color: 'muted', width: 1 });
      // beads: up from the input pile, bounce off the curve, out to the output pile
      for (const p of s.parts) {
        const y = f(p.x);
        const flat = showFlat && Math.abs(F().df(p.x)) < FLAT;
        let q;
        const xw = SX * p.x;
        if (Math.abs(p.x) > D || y > 3.1) continue;
        if (p.u < 0.5) { const k = p.u / 0.5; q = [xw, -1.55 + (y + 1.55) * k]; }
        else { const k = (p.u - 0.5) / 0.5; q = [xw + (XL - xw) * k, y]; }
        g.dot(q, 4, { color: flat ? 'coral' : p.u < 0.5 ? 'teal' : 'pink', ring: 'bg', ringWidth: 1 });
      }
    }

    function drawSlope() {
      const g = B, df = F().df;
      const sc = s.fn === 'sigmoid' ? 3 : 1;           // sigmoid′ ≤ ¼ — zoom so it is visible
      const showFlat = s.beat === 2;
      if (showFlat) for (const [a, b] of flatSpans(X0, X1)) g.rect(SX * a, -0.12, SX * (b - a), 1.3, { fill: alpha('coral', 0.14), stroke: false });
      g.line([-3.2, 0], [3.2, 0], { color: 'muted', width: 1.5 });
      g.line([0, -0.12], [0, 1.2], { color: 'muted', width: 1.5 });
      g.line([-0.08, 1], [0.08, 1], { color: 'muted', width: 1.5 });
      g.text('1', [-0.25, 1], { color: 'muted', size: 12 });
      if (s.fn === 'step') {
        g.line([-3.2, 0.01], [3.2, 0.01], { color: 'coral', width: 5 });
        g.arrow([0, 0], [0, 1.15], { color: 'coral', width: 3 });
      } else {
        g.plot((xw) => df(xw / SX) * sc, { range: [-3.2, 0, 3.2, 0], color: 'coral', width: 3.5, fillTo: 0, samples: 240 });
      }
      if (sc !== 1) g.text('×' + sc, [2.9, 1.1], { color: 'coral', size: 13, weight: 700 });
      g.text('σ′', [-3.0, 1.1], { color: 'coral', size: 16, weight: 800 });
      if (s.beat === 0) {
        const d = df(s.x);
        g.line([SX * s.x, 0], [SX * s.x, d * sc], { color: 'orange', width: 2, dash: [4, 4] });
        g.dot([SX * s.x, d * sc], 7, { color: 'coral', ring: 'bg' });
      }
      if (s.beat === 2) {
        for (const p of s.parts) {
          const d = df(p.x);
          if (Math.abs(p.x) < D) g.dot([SX * p.x, d * sc], 3.5, { color: Math.abs(d) < FLAT ? 'coral' : 'teal' });
        }
        const xs = samples(), sleep = xs.filter((x) => Math.abs(df(x)) < FLAT).length / NS;
        g.emoji('😴', [2.5, 0.65], 16 + 26 * sleep);
      }
    }

    // the paper: M points of [0,1]; after c folds each has a position h and a sheet index ℓ
    function paper(c) {
      const M = 360, pts = [];
      for (let i = 0; i <= M; i++) {
        let h = i / M, l = 0;
        for (let k = 0; k < c; k++) { if (h >= 0.5) l = 2 ** (k + 1) - 1 - l; h = tent(h); }
        pts.push({ x: i / M, h, l });
      }
      return pts;
    }
    function drawFold() {
      const g = A, K = s.layers;
      const per = 1.7, cyc = K * per + 2.2, tt = s.t % cyc;
      const c = Math.min(K, Math.floor(tt / per)), u = c < K ? (tt - c * per) / per : 1;
      const ua = clamp(u / 0.6, 0, 1), ub = clamp((u - 0.65) / 0.35, 0, 1);
      const L0 = -5.1, W = 8.1, dy = Math.min(0.24, 4.0 / 2 ** K), base = 0.1 - (2 ** K - 1) * dy / 2;
      const pts = paper(c);
      const ease = (v) => v * v * (3 - 2 * v);
      const P = [];
      for (const p of pts) {
        let x = p.h, y = p.l * dy;
        if (c < K) {
          const nl = p.h >= 0.5 ? 2 ** (c + 1) - 1 - p.l : p.l;
          if (p.h >= 0.5) {
            const th = Math.PI * ease(ua), d = p.h - 0.5;
            x = 0.5 + d * Math.cos(th);
            y = p.l * dy + (nl - p.l) * dy * ease(ua) + d * Math.sin(th) * 2.2;
            if (ub > 0) x = (1 - p.h) * (1 + ease(ub));
          } else if (ub > 0) x = p.h * (1 + ease(ub));
          if (ub > 0) y = nl * dy;
        }
        P.push([L0 + W * x, base + y]);
      }
      // the strip itself: neighbours on the paper stay joined, so the creases show
      for (let i = 1; i < P.length; i++) g.line(P[i - 1], P[i], { color: strip(pts[i].x), width: 4 });
      // fold line + which fold we are on
      if (c < K && ua > 0 && ub === 0) g.line([L0 + W * 0.5, base - 0.4], [L0 + W * 0.5, base + 2 ** K * dy + 0.3], { color: alpha('blue', 0.6), width: 2, dash: [6, 5] });
      for (let k = 0; k < K; k++) g.emoji(k < c ? '📐' : '▫️', [L0 + 0.35 + k * 0.62, 2.85], 18);
      g.text(`${2 ** c}`, [L0 + W - 0.2, 2.85], { color: 'gold', size: 20, weight: 800 });
      // B: the same paper read as a function — a zigzag with 2^K straight pieces
      const h = B, N = 600;
      h.line([-3.2, -0.05], [3.2, -0.05], { color: 'muted', width: 1 });
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const x = i / N; let y = x; for (let k = 0; k < K; k++) y = tent(y);
        const p = [-3.2 + 6.4 * x, y * 1.15];
        if (prev) h.line(prev, p, { color: strip(x), width: 3 });
        prev = p;
      }
      h.line([-3.2, 0], [3.2, 1.15], { color: alpha('muted', 0.5), width: 1.5, dash: [4, 4] });
      void C;
    }
  },
};
