// Deep nets learn by sending a "blame" light backwards from the loss through
// every layer. Each layer multiplies the light by its gain: a bit less than 1,
// twenty times over → darkness (vanishing); a bit more than 1 → 💥 (exploding).
// Skip-connection highways carry the light around each layer (gradient = 1 + f′),
// and careful starting scales (Xavier / He) keep every layer's signal the same size.
import { C, alpha } from '../viz/palette.js';
import { MLP } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const N = 16;

export default {
  eq: [
    [['∂L/∂h₀', 'coral'], ' = ', ['W₁ᵀ', 'blue'], ' ', ['W₂ᵀ', 'blue'], ' ⋯ ', ['W_Dᵀ', 'blue'], ' ', ['∂L/∂h_D', 'coral'], '      → size ≈ ', ['g', 'orange'], 'ᴰ'],
    [['g', 'orange'], ' < 1: ', ['0.8²⁰ ≈ 0.01', 'coral'], ' 🌑        ', ['g', 'orange'], ' > 1: ', ['1.3²⁰ ≈ 190', 'coral'], ' 💥'],
    ['residual:  h ← h + f(h)   ⇒   ', ['∂L/∂h', 'coral'], ' ← (I + ', ['∂f/∂h', 'blue'], ')ᵀ ', ['∂L/∂h', 'coral'], '      the "1" is the highway 🛣️'],
    ['init:  Var(', ['W', 'blue'], ') = 1/n (Xavier, tanh)  or  2/n (He, ReLU)  keeps Var(', ['h', 'blue'], ') the same in every layer'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-0.2, -0.9, 13.6, 8.6]);
    const r = rng(8);
    const s = { gain: 1, depth: 14, beat: 0, res: false, init: 'he', t: 0 };
    // random ROTATIONS as base weights (Gram–Schmidt on Gaussian rows): each layer's gain is then exactly g
    const orth = () => {
      const Q = [];
      for (let i = 0; i < N; i++) {
        let w = Array.from({ length: N }, () => r.normal());
        for (const q of Q) { const d = w.reduce((a, x, j) => a + x * q[j], 0); w = w.map((x, j) => x - d * q[j]); }
        const n = Math.hypot(...w); Q.push(w.map((x) => x / n));
      }
      return Q;
    };
    const base = Array.from({ length: 24 }, orth);
    const u = (() => { const v = Array.from({ length: N }, () => r.normal()); const n = Math.hypot(...v); return v.map((x) => x / n); })();
    const X = Array.from({ length: 120 }, () => Array.from({ length: N }, () => r.normal()));

    // backward pass: gradient size at every layer (index 0 = first layer, D = at the loss)
    let cacheKey = '', norms = [];
    const gradNorms = () => {
      const key = `${s.gain}|${s.depth}|${s.res}`;
      if (key === cacheKey) return norms;
      cacheKey = key;
      const D = s.depth;
      if (!s.res) {
        // plain deep linear net — straight from the core MLP's backward pass
        const net = new MLP(new Array(D + 1).fill(N), new Array(D).fill('linear'));
        for (let l = 0; l < D; l++) net.W[l] = base[l].map((row) => row.map((w) => w * s.gain));
        const a = net.forward(X[0]);
        const { deltas } = net.backward(a, u);
        const pre = deltas.map((d) => Math.hypot(...d));                // gradient arriving at each layer's output
        const first = base[0][0].map((_, j) => net.W[0].reduce((acc, row, i) => acc + row[j] * deltas[0][i], 0));
        norms = [Math.hypot(...first), ...pre];                          // [input, layer1 … layerD]
      } else {
        // residual: δ ← δ + (a·W)ᵀ δ  for each block
        let d = u.slice();
        const out = [1];
        for (let l = D - 1; l >= 0; l--) {
          const k = 0.3 * s.gain;
          d = d.map((x, j) => x + k * base[l].reduce((acc, row, i) => acc + row[j] * d[i], 0));
          out.unshift(Math.hypot(...d));
        }
        norms = out;
      }
      return norms;
    };
    // forward signal sizes for the init chapter (ReLU net)
    let fKey = '', fwd = [];
    const forwardStats = () => {
      const key = `${s.init}|${s.depth}`;
      if (key === fKey) return fwd;
      fKey = key;
      const D = s.depth, sc = { tiny: 0.5, he: Math.sqrt(2), huge: 2.4 }[s.init];
      const net = new MLP(new Array(D + 1).fill(N), new Array(D).fill('relu'));
      for (let l = 0; l < D; l++) net.W[l] = base[l].map((row) => row.map((w) => w * sc));
      const acts = Array.from({ length: D + 1 }, () => []);
      for (const x of X.slice(0, 80)) net.forward(x).forEach((a, l) => acts[l].push(...a));
      fwd = acts;
      return fwd;
    };

    ui.beats(['🔦', '🌑', '💥', '🛣️', '⚖️'], (b) => {
      s.beat = b; s.t = 0;
      s.res = b === 3; resT.set(s.res, false);
      const gv = [1, 0.7, 1.4, 1, s.gain][b]; s.gain = gv; gS.set(gv);
    });
    const gS = ui.slider({ icon: '🎚️', color: 'orange', min: 0.5, max: 1.5, step: 0.01, value: 1, title: 'layer gain', onInput: (v) => (s.gain = v) });
    ui.slider({ icon: '🏗️', color: 'blue', min: 4, max: 24, step: 1, value: s.depth, title: 'number of layers', onInput: (v) => (s.depth = v) });
    const resT = ui.toggle({ icon: '🛣️', color: 'lime', title: 'skip connections', onChange: (v) => (s.res = v) });
    ui.choice({ value: 'he', color: 'blue', options: [{ icon: '🐜', value: 'tiny', title: 'too small start' }, { icon: '⚖️', value: 'he', title: 'He start' }, { icon: '🐘', value: 'huge', title: 'too big start' }], onChange: (v) => (s.init = v) });
    ui.readout(() => { const n = gradNorms(); const v = n[0] / n[n.length - 1]; return v >= 1e4 || v < 1e-3 ? v.toExponential(0) : fmt(v, v < 1 ? 3 : 1); }, { icon: '🔦', color: 'coral', title: 'gradient at the first layer ÷ at the loss' });

    const X0 = 0.9, X1 = 12.1;
    const bx = (k) => X0 + (k / (s.depth - 1 || 1)) * (X1 - X0);    // box k = layer k+1
    const sp = () => (X1 - X0) / (s.depth - 1 || 1);

    return {
      update(dt) { dt = Math.max(0, dt); s.t += dt; },
      draw() {
        const D = s.depth, n = gradNorms(), bw = Math.min(0.62, sp() * 0.62), BY = 6.0, BH = 1.2;
        // highways
        if (s.res) for (let k = 0; k < D; k++) {
          const a = k === 0 ? X0 - sp() * 0.75 : bx(k - 1), b = bx(k);
          const m = [(a + b) / 2, BY + BH + 0.15], rr = (b - a) / 2;
          g.arc([m[0], BY + BH / 2], rr, 0, Math.PI, { color: alpha('lime', 0.8), width: 3 });
          void m;
        }
        // wire + boxes
        g.line([0.15, BY + BH / 2], [13.0, BY + BH / 2], { color: alpha('muted', 0.5), width: 2 });
        for (let k = 0; k < D; k++) g.rrect(bx(k) - bw / 2, BY, bw, BH, 5, { fill: alpha('blue', 0.18), color: 'blue', width: 2, stroke: true });
        g.emoji('📥', [0.15, BY + BH / 2], 20);
        g.emoji('🎯', [13.15, BY + BH / 2], 24);

        if (s.beat === 4) { drawInit(bw); return; }
        // the light pulse travelling backwards (loss → input)
        const cyc = 3.2, ph = (s.t % cyc) / 2.6;
        if (ph <= 1) {
          const pos = 12.9 - ph * (12.9 - 0.15);
          // gradient size at this x: interpolate between layer outputs in log space
          const xs = [0.15, ...Array.from({ length: D }, (_, k) => bx(k) + bw / 2 + 0.01)];
          let lv = Math.log10(n[n.length - 1]);
          for (let k = 0; k < xs.length; k++) if (pos <= xs[k]) { lv = Math.log10(n[k]); break; }
          const val = 10 ** lv;
          const bright = clamp(0.15 + 0.85 * (lv + 2.5) / 2.5, 0, 1);
          const big = clamp(1 + lv / 1.5, 0.15, 3.5);
          const colr = lv > 0.7 ? 'coral' : 'gold';
          g.blob([pos, BY + BH / 2], 0.35 * big, { color: colr, alpha: bright });
          g.dot([pos, BY + BH / 2], 3 + 5 * Math.min(big, 2), { color: alpha(colr, bright) });
          if (val > 300) g.emoji('💥', [pos, BY + BH + 0.9], 22 + 6 * Math.sin(s.t * 12));
          if (val < 0.01) g.emoji('🌑', [pos, BY + BH + 0.9], 20);
          if (s.res) g.blob([pos, BY + BH + 0.6], 0.25, { color: 'lime', alpha: 0.5 });
        }
        // gradient size per layer, log scale (1 = the middle line)
        const y0 = 0.0, H = 4.6, lo = -4, hi = 4;
        const Y = (v) => y0 + H * clamp((Math.log10(v) - lo) / (hi - lo), 0, 1);
        g.line([0.1, Y(1)], [13.1, Y(1)], { color: alpha('gold', 0.7), width: 2, dash: [6, 5] });
        for (let e = lo; e <= hi; e += 2) g.line([-0.05, Y(10 ** e)], [0.12, Y(10 ** e)], { color: 'muted', width: 1.5 });
        g.text('1', [-0.1, Y(1) + 0.28], { color: 'gold', size: 12, weight: 800 });
        const cols = [0.15, ...Array.from({ length: D }, (_, k) => bx(k))];
        n.forEach((v, k) => {
          const x = cols[k], w = k === 0 ? 0.3 : bw * 0.75, h = Y(v) - y0;
          const t = clamp((Math.log10(v) + 3) / 3, 0, 1);
          g.bar(x - w / 2, y0, w, Math.max(h, 0.03), { color: Math.log10(v) > 0.5 ? 'coral' : alpha('coral', 0.25 + 0.75 * t) });
          if (Math.log10(v) > hi) g.emoji('💥', [x, Y(10 ** hi) + 0.25], 14);
        });
        g.line([0.1, y0], [13.1, y0], { color: 'muted', width: 1.5 });
        g.text('|∂L/∂h|', [1.0, H + 0.35], { color: 'coral', size: 13, weight: 800 });
      },
    };

    function drawInit(bw) {
      // under each box: the pile of its activations (ReLU outputs), same scale for all layers
      const acts = forwardStats(), D = s.depth;
      const top = 5.2, bottom = 0.3, vmax = 4.5, nb = 12;
      const cols = [0.15, ...Array.from({ length: D }, (_, k) => bx(k))];
      acts.forEach((a, l) => {
        const h = new Array(nb).fill(0); let over = 0;
        // (ReLU zeros are left out; the shape of the rest is what matters)
        a.forEach((v) => { if (v <= 0) return; if (v >= vmax) over++; else h[Math.floor(v / vmax * nb)]++; });
        const m = Math.max(...h, over, 1), cx = cols[l], hw = (l === 0 ? 0.3 : bw * 0.9) / 2 + 0.08;
        const bh = (top - bottom) / (nb + 1);
        h.forEach((c, k) => { if (c) g.rect(cx - hw * Math.sqrt(c / m), bottom + k * bh, 2 * hw * Math.sqrt(c / m), bh * 0.92, { fill: alpha('blue', 0.8), stroke: false }); });
        if (over) g.rect(cx - hw * Math.sqrt(over / m), bottom + nb * bh, 2 * hw * Math.sqrt(over / m), bh * 0.92, { fill: 'coral', stroke: false });
        const sd = Math.sqrt(a.reduce((acc, v) => acc + v * v, 0) / a.length);
        g.text(sd > 99 ? '∞' : fmt(sd, sd < 0.1 ? 2 : 1), [cx, bottom - 0.45], { color: 'blue', size: 11, weight: 700 });
      });
      g.line([0.1, 0.3], [13.1, 0.3], { color: 'muted', width: 1.5 });
      g.emoji({ tiny: '🐜', he: '⚖️', huge: '🐘' }[s.init], [12.9, 4.9], 26);
      void C;
    }
  },
};
