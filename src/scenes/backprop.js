// Backprop is a relay race on a little machine of bubbles.
// Forward: numbers (blue) flow left → right and become the loss.
// Backward: "how much does the loss care?" (coral) flows right → left, and every
// wire multiplies it by its own gear ratio (the local slope) — the chain rule.
import { C, alpha } from '../viz/palette.js';
import { MLP } from '../core/learning.js';
import { clamp, smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';

// The machine: L = (w·x + b − y)²
const NODES = {
  x: { at: [0.9, 4.9], pat: [0.8, 7.0], leaf: 'teal', sym: 'x' },
  w: { at: [0.9, 3.0], pat: [2.7, 7.0], leaf: 'blue', sym: 'w' },
  mul: { at: [3.4, 3.95], pat: [1.75, 5.4], op: '×', ins: ['w', 'x'] },
  b: { at: [3.4, 1.55], pat: [4.1, 5.4], leaf: 'blue', sym: 'b' },
  add: { at: [5.8, 2.95], pat: [2.85, 3.85], op: '+', ins: ['mul', 'b'] },
  y: { at: [5.8, 0.75], pat: [5.2, 3.85], leaf: 'lime', sym: 'y' },
  sub: { at: [8.0, 2.1], pat: [3.95, 2.3], op: '−', ins: ['add', 'y'] },
  sq: { at: [10.2, 2.1], pat: [3.95, 0.6], op: '(·)²', ins: ['sub'] },
};
const ORDER = ['mul', 'add', 'sub', 'sq'];
// edges grouped by "time step" of the relay
const LEVELS = [[['x', 'mul'], ['w', 'mul']], [['mul', 'add'], ['b', 'add']], [['add', 'sub'], ['y', 'sub']], [['sub', 'sq']]];

function forward(v) {
  const val = { ...v };
  val.mul = val.w * val.x; val.add = val.mul + val.b; val.sub = val.add - val.y; val.sq = val.sub * val.sub;
  return val;
}
// local slope of parent wrt child (the gear ratio on that wire)
function slope(val, child, parent) {
  if (parent === 'mul') return child === 'w' ? val.x : val.w;
  if (parent === 'add') return 1;
  if (parent === 'sub') return child === 'add' ? 1 : -1;
  return 2 * val.sub; // sq
}
function backward(val) {
  const g = { sq: 1 };
  for (const p of [...ORDER].reverse()) for (const c of NODES[p].ins) g[c] = (g[c] ?? 0) + g[p] * slope(val, c, p);
  return g;
}

export default {
  eq: [
    [['L', 'coral'], ' = (', ['w', 'blue'], '·', ['x', 'teal'], ' + ', ['b', 'blue'], ' − ', ['y', 'lime'], ')²'],
    ['chain rule:  ', ['∂L/∂w', 'coral'], ' = ', ['∂L/∂L', 'coral'], ' · ', ['2e', 'orange'], ' · ', ['1', 'orange'], ' · ', ['1', 'orange'], ' · ', ['x', 'orange'], '  =  2(', ['w', 'blue'], ['x', 'teal'], ' + ', ['b', 'blue'], ' − ', ['y', 'lime'], ')·', ['x', 'teal']],
    ['each wire multiplies the coral number by its gear ratio ', ['∂(parent)/∂(child)', 'orange']],
    ['nudge test:  ', ['ΔL / Δw', 'gold'], ' ≈ ', ['∂L/∂w', 'coral'], '   for tiny Δw'],
    ['learn:  ', ['w', 'blue'], ' ← ', ['w', 'blue'], ' − η ', ['∂L/∂w', 'coral'], ',   ', ['b', 'blue'], ' ← ', ['b', 'blue'], ' − η ', ['∂L/∂b', 'coral']],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const s = { v: { x: 1.5, w: 0.8, b: -0.5, y: 2.0 }, beat: 0, t: 0, hist: [], nudge: 0 };
    let portrait = null;
    const P = (n) => (portrait ? n.pat : n.at);
    const layout = () => {
      if (portrait === stage.portrait) return;
      portrait = stage.portrait;
      g.setBounds(portrait ? [-0.1, -0.2, 6.3, 7.8] : [-0.2, -0.3, 11.4, 6.2]);
    };

    const sl = {};
    const mk = (k, icon, color, min, max) => (sl[k] = ui.slider({ icon, color, min, max, step: 0.1, value: s.v[k], title: k, onInput: (v) => { s.v[k] = v; } }));
    mk('w', 'w', 'blue', -2, 2); mk('b', 'b', 'blue', -2, 2); mk('x', 'x', 'teal', -2, 2); mk('y', 'y', 'lime', -3, 3);
    ui.beats(['🫧', '➡️', '⬅️', '🔬', '🏃'], (b) => { s.beat = b; s.t = 0; s.hist = []; });
    ui.button({ icon: '🎲', title: 'new numbers', onClick: () => {
      const r = () => Math.round((Math.random() * 3 - 1.5) * 10) / 10;
      for (const k of ['w', 'b', 'x']) { s.v[k] = r(); sl[k].set(s.v[k]); }
      s.v.y = Math.round((Math.random() * 4 - 2) * 10) / 10; sl.y.set(s.v.y); s.hist = [];
    } });
    const val = () => forward(s.v);
    ui.readout(() => fmt(val().sq, 2), { icon: 'L', color: 'coral', title: 'loss' });
    ui.readout(() => fmt(backward(val()).w, 2), { icon: '∂w', color: 'coral', title: 'dL/dw' });

    // core cross-check: the same thing as a 1→1 linear net, gradient from MLP.backward
    const coreGrad = () => {
      const net = new MLP([1, 1], ['linear']);
      net.W[0][0][0] = s.v.w; net.b[0][0] = s.v.b;
      const a = net.forward([s.v.x]);
      const gr = net.backward(a, [2 * (a[1][0] - s.v.y)]);
      return [gr.gW[0][0][0], gr.gb[0][0]];
    };

    return {
      update(dt) {
        dt = Math.max(0, dt);                 // the shell can hand a tiny negative dt right after ⏭
        s.t += dt;
        if (s.beat === 4) {
          const gr = backward(val());
          s.v.w = clamp(s.v.w - 0.6 * dt * gr.w, -2, 2); s.v.b = clamp(s.v.b - 0.6 * dt * gr.b, -2, 2);
          sl.w.set(Math.round(s.v.w * 100) / 100); sl.b.set(Math.round(s.v.b * 100) / 100);
          if (Math.floor((s.t - dt) * 10) !== Math.floor(s.t * 10)) { s.hist.push(val().sq); if (s.hist.length > 90) s.hist.shift(); }
        }
      },
      draw() {
        layout();
        const base = val(), grads = backward(base);
        // 🔬: wiggle w by a tiny amount and watch L wiggle along
        const eps = 0.15;
        s.nudge = s.beat === 3 ? Math.sin(s.t * 2.4) : 0;
        const v = s.beat === 3 ? forward({ ...s.v, w: s.v.w + eps * s.nudge }) : base;
        const cyc = 4.2, ph = (s.t % cyc) / 3.4;                // relay progress 0..1 (+ pause)
        const lvF = s.beat === 1 ? ph * 4 : 99;                  // forward front (in levels)
        const lvB = s.beat === 2 ? ph * 4 : 99;                  // backward front

        // wires
        LEVELS.forEach((lev, li) => lev.forEach(([c, p]) => {
          const A = P(NODES[c]), B = P(NODES[p]);
          const d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d), u = [d[0] / L, d[1] / L];
          const a = [A[0] + u[0] * 0.55, A[1] + u[1] * 0.55], b = [B[0] - u[0] * 0.6, B[1] - u[1] * 0.6];
          const fwdOn = s.beat === 1 && lvF >= li && lvF < li + 1;
          const bwdOn = s.beat === 2 && 3 - lvB + 0 <= li + 0.0 && lvB >= 3 - li && lvB < 4 - li;
          g.arrow(a, b, { color: fwdOn ? 'blue' : bwdOn ? 'coral' : alpha('muted', 0.55), width: fwdOn || bwdOn ? 4 : 2.5 });
          // gear: local slope
          if (s.beat >= 2) {
            const m = [(a[0] + b[0]) / 2 - u[1] * 0.38, (a[1] + b[1]) / 2 + u[0] * 0.38];
            const k = slope(v, c, p);
            gear(m, 0.2, (bwdOn ? s.t * 4 : 0) * Math.sign(k || 1), bwdOn ? 'orange' : alpha('orange', 0.7));
            g.text(`×${fmt(k, 1)}`, [m[0] + 0.02, m[1] + (portrait ? 0 : 0.36)], { color: 'orange', size: 13, weight: 800, dx: portrait ? 30 : 0 });
          }
          // packets
          if (fwdOn) {
            const f = smoothstep(lvF - li), q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
            bubbleNum(q, fmt(v[c], 1), 'blue');
          }
          if (bwdOn) {
            const f = smoothstep(lvB - (3 - li)), q = [b[0] + (a[0] - b[0]) * f, b[1] + (a[1] - b[1]) * f];
            bubbleNum(q, fmt(grads[p] * (f > 0.5 ? slope(v, c, p) : 1), 1), 'coral');
          }
        }));

        // bubbles
        const levelOf = { x: -1, w: -1, b: 0, y: 1, mul: 0, add: 1, sub: 2, sq: 3 };
        const gLevelOf = { sq: -1, sub: 0, add: 1, y: 1, mul: 2, b: 2, x: 3, w: 3 };
        for (const [k, n] of Object.entries(NODES)) {
          const c = P(n), r = 0.55;
          const shown = s.beat !== 1 || lvF >= levelOf[k] + 1 || n.leaf;
          g.circle(c, r, { fill: 'panel' });
          g.circle(c, r, { fill: alpha(n.leaf ?? (k === 'sq' ? 'coral' : 'blue'), 0.14), color: n.leaf ?? (k === 'sq' ? 'coral' : 'ink'), width: 3, stroke: true });
          if (n.leaf) {
            g.text(n.sym, [c[0], c[1] + 0.2], { color: n.leaf, size: 17, weight: 800 });
            g.text(fmt(v[k], 1), [c[0], c[1] - 0.2], { color: n.leaf, size: 14, weight: 700 });
            if (k === 'w' && s.beat === 3) g.arrow([c[0] - 0.8, c[1]], [c[0] - 0.8, c[1] + 0.5 * s.nudge], { color: 'gold', width: 3 });
          } else {
            g.text(n.op, [c[0], c[1] + 0.13], { color: k === 'sq' ? 'coral' : 'ink', size: 22, weight: 800 });
            if (shown) g.text(fmt(v[k], 2), [c[0], c[1] - 0.27], { color: k === 'sq' ? 'coral' : 'blue', size: 13, weight: 700 });
          }
          // gradients (coral): how much L cares about this bubble
          const gShown = s.beat >= 3 || (s.beat === 2 && lvB >= gLevelOf[k] + 1);
          if (gShown && k !== 'y' && k !== 'x' || (gShown && s.beat === 2)) {
            const q = portrait ? [c[0] + 0.95, c[1]] : [c[0], c[1] + 0.85];
            g.text(fmt(grads[k], 2), q, { color: 'coral', size: 14, weight: 800 });
          }
        }
        // the loss bubble glows with its size
        const Lc = P(NODES.sq);
        g.emoji(v.sq < 0.05 ? '🎯' : v.sq < 1 ? '🙂' : v.sq < 4 ? '😬' : '😱', portrait ? [Lc[0] + 1.0, Lc[1]] : [Lc[0] + 0.98, Lc[1]], 26);

        if (s.beat === 3) nudgePanel(grads, eps);
        if (s.beat === 4) lossPlot();
      },
    };

    function bubbleNum(q, str, color) {
      g.dot(q, 15, { color: alpha(color, 0.92), ring: 'bg', ringWidth: 2 });
      g.text(str, q, { color: 'white', size: 11, weight: 800, halo: false });
    }
    function gear(c, r, ang, color) {
      const pts = [];
      for (let i = 0; i < 32; i++) { const a = ang + (i / 32) * Math.PI * 2, rr = r * ((i % 4) < 2 ? 1 : 0.72); pts.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]); }
      g.poly(pts, { fill: color, stroke: false });
      g.circle(c, r * 0.3, { fill: 'bg' });
    }
    function nudgePanel(grads, eps) {
      // wiggle w by Δw → L wiggles by ΔL. Their ratio (gold) matches backprop's ∂L/∂w (coral).
      const n = s.nudge, dw = eps * n, dL = forward({ ...s.v, w: s.v.w + dw }).sq - forward(s.v).sq;
      const k = 0.5 / eps;
      const Lc = P(NODES.sq), off = portrait ? [-0.85, 0] : [0, -0.85];
      const tip = [Lc[0] + off[0], Lc[1] + off[1]];
      g.arrow([tip[0] - 0.12, tip[1]], [tip[0] - 0.12, tip[1] + clamp(dL * k, -1.6, 1.6)], { color: 'gold', width: 3 });
      // exact check: tiny central difference + the core MLP's backward pass
      const h = 1e-4, num = (forward({ ...s.v, w: s.v.w + h }).sq - forward({ ...s.v, w: s.v.w - h }).sq) / (2 * h), [cw] = coreGrad();
      const ratio = Math.abs(dw) > 1e-3 ? dL / dw : num;
      const o = portrait ? [0.35, 1.4] : [0.3, 1.2], mx = Math.max(1, Math.abs(ratio), Math.abs(grads.w)), H = 0.95;
      g.line([o[0] - 0.15, o[1]], [o[0] + 1.25, o[1]], { color: 'muted', width: 1.5 });
      g.bar(o[0], o[1], 0.45, (ratio / mx) * H, { color: 'gold' });
      g.bar(o[0] + 0.6, o[1], 0.45, (grads.w / mx) * H, { color: 'coral' });
      const ty = o[1] + (grads.w >= 0 ? -0.3 : 0.3);
      g.text(fmt(ratio, 1), [o[0] + 0.22, ty], { color: 'gold', size: 12, weight: 800 });
      g.text(fmt(grads.w, 1), [o[0] + 0.82, ty], { color: 'coral', size: 12, weight: 800 });
      g.text(Math.abs(num - grads.w) < 1e-3 && Math.abs(cw - grads.w) < 1e-6 ? '✅' : '❌', [o[0] + 1.55, o[1]], { size: 20, halo: false });
    }
    function lossPlot() {
      if (s.hist.length < 2) return;
      const o = portrait ? [0.2, 0.2] : [0.2, 0.0], W = portrait ? 2.2 : 3.0, H = 1.2, mx = Math.max(...s.hist, 1e-3);
      g.line([o[0], o[1]], [o[0] + W, o[1]], { color: 'muted', width: 1.5 });
      g.line([o[0], o[1]], [o[0], o[1] + H], { color: 'muted', width: 1.5 });
      g.plot(s.hist.map((v, i) => [o[0] + (i / 89) * W, o[1] + (v / mx) * H]), { color: 'coral', width: 2.5 });
      g.text('L', [o[0] - 0.2, o[1] + H], { color: 'coral', size: 13, weight: 800 });
    }
    void C;
  },
};
