// Attention: every word asks a question (query 🔑), every word wears a label (key),
// and listens to the others in proportion to how well question and label match.
// Lines = who listens to whom (thicker = more). The answer is a blend of the others'
// colors (values), mixed in exactly those proportions.
import { C, alpha, mix } from '../viz/palette.js';
import { attention, positionalEncoding, softmax } from '../core/learning.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const TOK = ['🐱', '😋', '🍣', '🤖', '⚡', '🔋'];
const VAL = ['orange', 'pink', 'teal', 'blue', 'gold', 'lime'];
// meaning vectors: [cat-ness, food-ness, robot-ness, power-ness]
const EMB = [[1, 0, 0, 0], [0.3, 0.6, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0.3, 0.6], [0, 0, 0, 1]];
const F = [0.866, 0.5], Pw = [-0.866, 0.5], D = [0, -1];               // 2-D "directions": food, power, other
const sc = (v, k) => [v[0] * k, v[1] * k];
const WQ = [sc(F, 2.2), sc(D, 0.6), sc(Pw, 2.2), sc(D, 0.6)];       // 4 → 2
const WK = [sc(D, 0.5), sc(F, 2.0), sc(D, 0.5), sc(Pw, 2.0)];
const proj = (X, Wm) => X.map((x) => [0, 1].map((c) => x.reduce((s, xi, i) => s + xi * Wm[i][c], 0)));
const rgb = (c) => { const h = C[c]; if (h?.startsWith('#')) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } return [128, 128, 128]; };

export default {
  eq: [
    [['Q', 'gold'], ' = X ', ['W_Q', 'gold'], ',   ', ['K', 'blue'], ' = X ', ['W_K', 'blue'], ',   ', ['V', 'pink'], ' = X ', ['W_V', 'pink']],
    ['scores = ', ['Q', 'gold'], ' ', ['Kᵀ', 'blue'], ' / √d        (dot product = how well the arrows line up)'],
    [['A', 'purple'], ' = softmax(scores)  — each row is a pie that sums to 1 (line thickness)'],
    ['out = ', ['A', 'purple'], ' ', ['V', 'pink'], '        (a blend of the value colors)'],
    ['PE(pos, 2i) = sin(pos / 10000^(2i/d)),   PE(pos, 2i+1) = cos(…)   — added so order matters 🌊'],
    ['multi-head: several (', ['W_Q', 'gold'], ', ', ['W_K', 'blue'], ') pairs look for different things at once'],
  ],
  setup({ stage, ui }) {
    const [Lp, Rp] = stage.split([[-0.8, -2.5, 5.8, 3.3], [-0.2, -0.2, 7.4, 7.0]], [1.15, 1]);
    const s = { q: 0, beat: 0, pe: false, heads: false, t: 0, order: [0, 1, 2, 3, 4, 5], drag: null, dragX: 0 };

    // everything computed for the current order of tokens
    const compute = () => {
      const X = s.order.map((id, pos) => {
        const e = EMB[id].slice();
        if (s.pe) { const pe = positionalEncoding(pos, 4); return e.map((v, i) => v + 0.6 * pe[i]); }
        return e;
      });
      const Q = proj(X, WQ), K = proj(X, WK);
      const V = s.order.map((id) => rgb(VAL[id]));
      const h1 = attention(Q, K, V);
      // head 2 reads ONLY position: query = PE rotated by one step, key = PE → "look at my left neighbour"
      const PE = s.order.map((_, pos) => positionalEncoding(pos, 4));
      const c1 = Math.cos(1), s1 = Math.sin(1);
      const Q2 = PE.map((p) => [3 * (p[0] * c1 - p[1] * s1), 3 * (p[0] * s1 + p[1] * c1)]);
      const K2 = PE.map((p) => [p[0], p[1]]);
      const h2 = attention(Q2, K2, V);
      const scores = Q.map((q) => K.map((k) => (q[0] * k[0] + q[1] * k[1]) / Math.SQRT2));
      return { Q, K, V, h1, h2, scores };
    };
    const posOf = (id) => s.order.indexOf(id);

    // tokens are handles: tap = make it the query, drag sideways = reorder
    const hs = TOK.map((_, id) => stage.handle({
      pen: Lp, color: 'gold', kind: 'ring', r: 17,
      visible: () => true,
      get: () => [s.drag === id ? s.dragX : posOf(id), 0],
      set: (p) => { s.drag = id; s.dragX = clamp(p[0], 0, 5); },
      onStart: () => { s.q = id; },
      onEnd: () => {
        if (s.drag === null) return;
        const to = Math.round(s.dragX), from = posOf(id);
        s.order.splice(from, 1); s.order.splice(to, 0, id); s.drag = null;
      },
    }));

    ui.beats(['👀', '🔑', '🥧', '🎨', '🌊'], (b) => { s.beat = b; s.pe = b === 4; s.heads = b === 4; peT.set(s.pe, false); hdT.set(s.heads, false); });
    const peT = ui.toggle({ icon: '🌊', color: 'pink', title: 'add position waves', onChange: (v) => (s.pe = v) });
    const hdT = ui.toggle({ icon: '👥', color: 'pink', title: 'second head', onChange: (v) => (s.heads = v) });
    ui.button({ icon: '🔀', title: 'shuffle order', onClick: () => { s.order = [s.order[3], s.order[0], s.order[5], s.order[1], s.order[4], s.order[2]]; } });
    ui.readout(() => { const m = compute(), qi = posOf(s.q), w = m.h1.weights[qi], j = w.indexOf(Math.max(...w)); return `${TOK[s.order[j]]} ${Math.round(100 * w[j])}%`; }, { icon: '👀', color: 'purple', title: 'who the query listens to most' });

    return {
      update(dt) { dt = Math.max(0, dt); s.t += dt; },
      draw() {
        hs.forEach((h, id) => { h.color = id === s.q ? 'gold' : alpha('muted', 0.45); h.r = clamp(Lp.px(0.36), 10, 17); });
        const m = compute();
        drawTokens(m);
        if (s.beat === 0) drawMatrix(m.h1.weights, 'blue', [0.4, 6.6], 0.95);
        else if (s.beat === 1) drawArrows(m);
        else if (s.beat === 2) drawSoftmax(m);
        else if (s.beat === 3) drawMix(m);
        else { drawMatrix(m.h1.weights, 'blue', [0.0, 6.7], 0.5); drawMatrix(m.h2.weights, 'pink', [3.6, 6.7], 0.5); drawWaveKey(); }
      },
    };

    function arc(g, a, b, h, o) {
      const pts = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push([a + (b - a) * t, 0.55 + h * 4 * t * (1 - t)]); }
      g.path(pts, o);
    }

    function drawTokens(m) {
      const g = Lp, qi = posOf(s.q);
      const sets = [[m.h1.weights, 'blue', 1]];
      if (s.heads) sets.push([m.h2.weights, 'pink', -1]);
      // listening lines from the query to everyone (thickness = attention weight)
      for (const [Wt, colr, dir] of sets) {
        Wt[qi].forEach((w, j) => {
          const x = s.drag !== null && s.order[j] === s.drag ? s.dragX : j;
          if (j === qi) { g.circle([x, 0.95 * dir], 0.32, { color: alpha(colr, 0.25 + 0.75 * w), width: 1 + 14 * w }); return; }
          if (dir > 0) arc(g, qi, x, 0.5 + 0.38 * Math.abs(x - qi), { color: alpha(colr, 0.2 + 0.8 * w), width: 1 + 16 * w });
          else { const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push([qi + (x - qi) * t, -0.55 - (0.25 + 0.2 * Math.abs(x - qi)) * 4 * t * (1 - t)]); } g.path(pts, { color: alpha(colr, 0.2 + 0.8 * w), width: 1 + 16 * w }); }
        });
      }
      // tokens + their value colors
      s.order.forEach((id, j) => {
        const x = s.drag === id ? s.dragX : j;
        g.circle([x, 0], 0.36, { fill: 'panel' });
        if (id === s.q) g.circle([x, 0], 0.42, { fill: alpha('gold', 0.25) });
        g.emoji(TOK[id], [x, 0], clamp(g.px(0.62), 16, 30));
        if (s.beat === 3) g.rrect(x - 0.2, -0.95, 0.4, 0.28, 5, { fill: VAL[id] });
      });
      // positional waves under the tokens
      if (s.pe) {
        for (let k = 0; k < 2; k++) {
          const pts = [];
          const yw = -1.95 - k * 0.38;
          for (let i = 0; i <= 100; i++) { const x = -0.3 + 5.6 * i / 100; pts.push([x, yw + 0.15 * positionalEncoding(x, 4)[k]]); }
          g.path(pts, { color: alpha('pink', 0.55), width: 2 });
          for (let j = 0; j < 6; j++) g.dot([j, yw + 0.15 * positionalEncoding(j, 4)[k]], 4, { color: 'pink' });
        }
      }
      // the output: blend of value colors
      if (s.beat === 3) {
        const out = m.h1.out[qi];
        const x = qi;
        g.arrow([x, -1.05], [x, s.pe ? -2.05 : -1.55], { color: 'muted', width: 2 });
        g.circle([x, s.pe ? -2.25 : -1.85], 0.27, { fill: `rgb(${out.map(Math.round).join(',')})` });
        g.circle([x, s.pe ? -2.25 : -1.85], 0.27, { color: 'ink', width: 2 });
      }
    }

    function drawMatrix(Wt, colr, tl, cs) {
      const g = Rp, qi = posOf(s.q), n = 6;
      Wt.forEach((row, i) => row.forEach((w, j) => {
        g.rect(tl[0] + (j + 1) * cs, tl[1] - (i + 2) * cs, cs, cs, { fill: mix('panel', colr, Math.pow(w, 0.6)), stroke: false });
        if (cs > 0.7) g.text(`${Math.round(w * 100)}`, [tl[0] + (j + 1.5) * cs, tl[1] - (i + 1.5) * cs], { size: 11, color: w > 0.45 ? 'white' : 'muted', halo: false, weight: 700 });
      }));
      for (let k = 0; k < n; k++) {
        g.emoji(TOK[s.order[k]], [tl[0] + (k + 1.5) * cs, tl[1] - 0.5 * cs], cs > 0.7 ? 20 : 14);
        g.emoji(TOK[s.order[k]], [tl[0] + 0.5 * cs, tl[1] - (k + 1.5) * cs], cs > 0.7 ? 20 : 14);
      }
      g.rect(tl[0] + cs, tl[1] - (qi + 2) * cs, n * cs, cs, { color: 'gold', width: 3 });
    }

    function drawArrows(m) {
      // the query arrow (gold) and every key arrow (blue): dot product = how much they line up
      const g = Rp, qi = posOf(s.q), O = [3.6, 3.2], k = 1.0;
      g.circle(O, 2.5, { color: 'grid', width: 1 });
      g.line([O[0] - 2.7, O[1]], [O[0] + 2.7, O[1]], { color: 'grid', width: 1 });
      g.line([O[0], O[1] - 2.7], [O[0], O[1] + 2.7], { color: 'grid', width: 1 });
      const q = m.Q[qi], qn = Math.hypot(...q) || 1;
      const sc0 = m.scores[qi];
      m.K.forEach((kv, j) => {
        const tip = [O[0] + kv[0] * k, O[1] + kv[1] * k];
        g.arrow(O, tip, { color: alpha('blue', 0.85), width: 3 });
        // shadow of k on q = the score
        const d = (kv[0] * q[0] + kv[1] * q[1]) / qn;
        const foot = [O[0] + q[0] / qn * d * k, O[1] + q[1] / qn * d * k];
        g.line(tip, foot, { color: alpha('muted', 0.5), width: 1.2, dash: [3, 4] });
        g.emoji(TOK[s.order[j]], [O[0] + kv[0] * k * 1.18 + 0.001, O[1] + kv[1] * k * 1.18], 18);
        g.text(fmt(sc0[j], 1), [O[0] + kv[0] * k * 1.18, O[1] + kv[1] * k * 1.18 - 0.42], { color: sc0[j] >= 0 ? 'blue' : 'coral', size: 12, weight: 800 });
      });
      g.arrow(O, [O[0] + q[0] * k, O[1] + q[1] * k], { color: 'gold', width: 5 });
      g.emoji(TOK[s.q], [0.5, 6.4], 26);
      g.text('Q', [1.15, 6.4], { color: 'gold', size: 18, weight: 800 });
      g.text('K', [1.15, 5.8], { color: 'blue', size: 18, weight: 800 });
    }

    function drawSoftmax(m) {
      const g = Rp, qi = posOf(s.q), sc0 = m.scores[qi], w = m.h1.weights[qi];
      // scores (left) → softmax pie slices as bars (right)
      const base = 3.2;
      g.line([0.2, base], [7.2, base], { color: 'muted', width: 1.5 });
      sc0.forEach((v, j) => {
        const x = 0.4 + j * 0.55;
        g.bar(x, base, 0.42, clamp(v, -3, 3) * 0.7, { color: v >= 0 ? 'blue' : 'coral' });
        g.emoji(TOK[s.order[j]], [x + 0.21, 0.6], 16);
      });
      g.arrow([3.75, base + 1.2], [4.25, base + 1.2], { color: 'ink', width: 3 });
      g.text('eˣ/Σ', [4.0, base + 1.65], { color: 'purple', size: 13, weight: 800 });
      w.forEach((v, j) => {
        const x = 4.5 + j * 0.45;
        g.bar(x, base, 0.36, v * 3.4, { color: 'purple' });
        g.text(`${Math.round(v * 100)}`, [x + 0.18, base + v * 3.4 + 0.25], { color: 'purple', size: 11, weight: 700 });
        g.emoji(TOK[s.order[j]], [x + 0.18, 0.6], 14);
      });
      // and the same row as a pie
      let a = Math.PI / 2;
      const P = [5.9, 1.55];
      void softmax;
      w.forEach((v, j) => { const a1 = a - v * Math.PI * 2; g.wedge(P, 0.55, a1, a, { color: 'purple', alpha: 0.2 + 0.7 * v }); g.line(P, [P[0] + 0.55 * Math.cos(a), P[1] + 0.55 * Math.sin(a)], { color: 'bg', width: 2 }); a = a1; });
      void m;
    }

    function drawMix(m) {
      // pie of contributions, each slice in its token's value color → the blended swatch
      const g = Rp, qi = posOf(s.q), w = m.h1.weights[qi], out = m.h1.out[qi];
      const P = [2.4, 3.4];
      let a = Math.PI / 2;
      w.forEach((v, j) => {
        const a1 = a - v * Math.PI * 2, mid = (a + a1) / 2;
        g.wedge(P, 2.0, a1, a, { color: VAL[s.order[j]], alpha: 0.95 });
        if (v > 0.07) g.emoji(TOK[s.order[j]], [P[0] + 1.3 * Math.cos(mid), P[1] + 1.3 * Math.sin(mid)], 16 + 14 * Math.sqrt(v));
        a = a1;
      });
      g.arrow([4.65, 3.4], [5.35, 3.4], { color: 'ink', width: 3 });
      g.circle([6.4, 3.4], 0.85, { fill: `rgb(${out.map(Math.round).join(',')})` });
      g.circle([6.4, 3.4], 0.85, { color: 'ink', width: 2.5 });
      g.emoji(TOK[s.q], [6.4, 4.75], 24);
    }

    function drawWaveKey() {
      const g = Rp;
      g.emoji('🧠', [1.8, 0.6], 18); g.line([1.2, 0.25], [2.4, 0.25], { color: 'blue', width: 4 });
      g.emoji('🌊', [5.5, 0.6], 18); g.line([4.9, 0.25], [6.1, 0.25], { color: 'pink', width: 4 });
    }
  },
};
