// Bellman: how good is a room? = what you get now + γ × how good the best next room is.
// Value flows BACKWARD from the candy like water filling a staircase of cups.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rng, clamp, smoothstep, lerp } from '../core/random.js';

const B = [0, 0, 11, 7];
const BOX = 1.15;

// Worlds: nodes {p, icon?, r (reward for ENTERING), term}, acts[i] = [[{to, p}], ...]
function world(beat, slip) {
  if (beat === 0) {
    const nodes = [{ p: [1.8, 3.4] }, { p: [5.5, 3.4], start: true }, { p: [9.2, 3.4], icon: '🍬', r: 1, term: true }];
    const acts = [[[{ to: 1, p: 1 }]], [[{ to: 0, p: 1 }], [{ to: 2, p: 1 }]], []];
    return { nodes, acts, start: 1 };
  }
  if (beat <= 2) {
    const nodes = [];
    for (let k = 0; k < 6; k++) nodes.push({ p: [0.9 + 1.55 * k, 0.9 + 0.95 * k], start: k === 0 });
    nodes.push({ p: [10.2, 6.2], icon: '🍬', r: 1, term: true });
    const acts = nodes.map((_, k) => (k === 6 ? [] : [[{ to: k + 1, p: 1 }], ...(k > 0 ? [[{ to: k - 1, p: 1 }]] : [])]));
    return { nodes, acts, start: 0 };
  }
  // stairs over a lava pit, or a longer safe ladder
  const nodes = [
    { p: [0.9, 1.2], start: true }, { p: [2.6, 2.0] }, { p: [4.3, 2.8] }, { p: [6.0, 3.6] }, { p: [7.7, 4.4] },
    { p: [9.9, 5.4], icon: '🍬', r: 1, term: true },
    { p: [5.15, 0.75], icon: '🔥', r: -1, term: true, wide: true },
    { p: [2.2, 4.0] }, { p: [3.9, 5.6] }, { p: [6.0, 6.1] },
  ];
  const up = (k, fall) => (fall ? [{ to: k + 1, p: 1 - slip }, { to: 6, p: slip }] : [{ to: k + 1, p: 1 }]);
  const acts = [
    [up(0, false)],
    [up(1, false), [{ to: 7, p: 1 }], [{ to: 0, p: 1 }]],
    [up(2, true), [{ to: 1, p: 1 }]],
    [up(3, true), [{ to: 2, p: 1 }]],
    [[{ to: 5, p: 1 }], [{ to: 3, p: 1 }], [{ to: 9, p: 1 }]],
    [], [],
    [[{ to: 8, p: 1 }], [{ to: 1, p: 1 }]],
    [[{ to: 9, p: 1 }], [{ to: 7, p: 1 }]],
    [[{ to: 4, p: 1 }], [{ to: 8, p: 1 }]],
  ];
  return { nodes, acts, start: 0 };
}

// One synchronous Bellman backup over every room.
function backup(W, V, gamma) {
  const nV = V.slice(), best = V.map(() => -1);
  let delta = 0;
  W.nodes.forEach((n, i) => {
    if (n.term) return;
    let bq = -Infinity;
    W.acts[i].forEach((outs, a) => {
      const q = outs.reduce((s, o) => s + o.p * ((W.nodes[o.to].r ?? 0) + (W.nodes[o.to].term ? 0 : gamma * V[o.to])), 0);
      if (q > bq + 1e-12) { bq = q; best[i] = a; }
    });
    nV[i] = bq; delta = Math.max(delta, Math.abs(bq - V[i]));
  });
  return { V: nV, best, delta };
}

export default {
  eq: [
    [['V', 'blue'], '(s) = max over moves [ ', ['r', 'gold'], ' + ', ['γ', 'orange'], ' · ', ['V', 'blue'], '(next) ]'],
    ['k steps from the candy:  ', ['V', 'blue'], ' = ', ['γ', 'orange'], 'ᵏ · ', ['🍬', 'gold']],
    ['random steps:  ', ['V', 'blue'], '(s) = max Σ ', ['P(s′|s,a)', 'purple'], ' [ ', ['r', 'gold'], ' + ', ['γ', 'orange'], ' ', ['V', 'blue'], '(s′) ]'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds(B);
    const rand = rng(4);
    const s = { beat: 0, gamma: 0.85, slip: 0.2, W: null, V: [], Vd: [], best: [], sweeps: 0, timer: 0, phase: 'fill', flow: 0, kid: null, rest: 0, sel: 3, t: 0 };
    const reset = () => {
      s.W = world(s.beat, s.slip);
      s.V = s.W.nodes.map(() => 0); s.Vd = s.V.slice(); s.best = s.V.map(() => -1);
      s.sweeps = 0; s.timer = 0; s.phase = 'fill'; s.flow = 0;
      s.kid = { at: s.W.start, from: s.W.start, u: 1, mood: null };
      if (s.beat === 2) converge();
    };
    const sweep = () => {
      const r = backup(s.W, s.V, s.gamma);
      s.prevV = s.V; s.V = r.V; s.best = r.best; s.sweeps++; s.flow = 0;
      return r.delta;
    };
    const converge = () => { for (let i = 0; i < 300; i++) if (sweep() < 1e-6) break; s.Vd = s.V.slice(); s.phase = 'walk'; };

    ui.beats(['🍬', '🪜', '💸', '🎲'], (b) => { s.beat = b; reset(); });
    ui.slider({ icon: 'γ', color: 'orange', min: 0.3, max: 1, step: 0.01, value: s.gamma, title: 'how much later candy is worth',
      onInput: (v) => { s.gamma = v; if (s.beat === 2) converge(); else if (s.phase !== 'fill') { s.phase = 'fill'; } } });
    ui.slider({ icon: '🎲', color: 'purple', min: 0, max: 0.6, step: 0.01, value: s.slip, title: 'how slippery the stairs are',
      onInput: (v) => { s.slip = v; if (s.beat === 3) { const keep = s.V; s.W = world(3, s.slip); s.V = keep; s.phase = 'fill'; } } });
    ui.button({ icon: '🔁', title: 'empty the cups', onClick: reset });
    ui.readout(() => String(s.sweeps), { icon: '💧', color: 'blue', title: 'backups so far' });
    ui.readout(() => fmt(s.V[s.W.start] ?? 0, 2), { icon: '🧒', color: 'blue', title: 'value of the start room' });
    reset();

    // click a room to see its "expected next value" arrows (beat 4)
    const offDown = stage.on('down', (e) => {
      if (s.beat !== 3) return;
      s.W.nodes.forEach((n, i) => { if (!n.term && Math.abs(e.p[0] - n.p[0]) < BOX / 2 && Math.abs(e.p[1] - n.p[1]) < BOX / 2) s.sel = i; });
    });

    return {
      update(dt) {
        s.t += dt;
        s.flow = Math.min(1, s.flow + dt * 1.6);
        for (let i = 0; i < s.V.length; i++) s.Vd[i] = lerp(s.Vd[i], s.V[i], 1 - Math.exp(-dt * 5));
        if (s.phase === 'fill') {
          s.timer += dt;
          const every = s.beat === 3 ? 0.55 : 0.85;
          if (s.timer > every) { s.timer = 0; if (sweep() < 1e-4) { s.phase = 'walk'; s.kid = { at: s.W.start, from: s.W.start, u: 1, mood: null, wait: 0.4 }; } }
        } else if (s.phase === 'walk') {
          const k = s.kid;
          if (k.u < 1) { k.u = Math.min(1, k.u + dt * 1.8); }
          else if (k.mood) { k.wait -= dt; if (k.wait < 0) { if (s.beat === 1) reset(); else s.kid = { at: s.W.start, from: s.W.start, u: 1, mood: null, wait: 0.6 }; } }
          else if ((k.wait -= dt) < 0) {
            const node = s.W.nodes[k.at];
            if (node.term) { k.mood = node.r > 0 ? '🎉' : '😱'; k.wait = 1.4; }
            else {
              const outs = s.W.acts[k.at][Math.max(0, s.best[k.at])];
              let x = rand(), to = outs[outs.length - 1].to;
              for (const o of outs) { if (x < o.p) { to = o.to; break; } x -= o.p; }
              k.from = k.at; k.at = to; k.u = 0; k.wait = 0.25;
            }
          }
        }
      },
      draw() {
        const W = s.W;
        g.grid({ step: 1, axes: false });
        if (s.beat === 3) {
          // the pit under the risky stairs
          const L = W.nodes[6].p;
          g.rrect(L[0] - 2.1, L[1] - 0.55, 4.2, 1.1, 14, { fill: alpha('coral', 0.18), color: alpha('coral', 0.6), width: 2 });
        }
        // moves between rooms (all faint; the best one bright)
        W.nodes.forEach((n, i) => W.acts[i].forEach((outs, a) => {
          const isBest = s.best[i] === a && s.sweeps > 0;
          for (const o of outs) {
            const q = W.nodes[o.to].p, d = [q[0] - n.p[0], q[1] - n.p[1]], L = Math.hypot(...d), u = [d[0] / L, d[1] / L];
            const off = o.to === 6 ? 0.45 : BOX * 0.62;
            const twoWay = W.acts[o.to]?.some((oo) => oo.some((z) => z.to === i));
            const sh = twoWay ? 0.17 : 0, nrm = [u[1] * sh, -u[0] * sh]; // keep two-way moves apart
            const A = [n.p[0] + u[0] * BOX * 0.62 + nrm[0], n.p[1] + u[1] * BOX * 0.62 + nrm[1]], Bp = [q[0] - u[0] * off + nrm[0], q[1] - u[1] * off + nrm[1]];
            if (!isBest) { if (o.p > 0.999) g.arrow(A, Bp, { color: alpha('muted', 0.3), width: 1.5, head: 8 }); continue; }
            const slipOut = outs.length > 1 && o.to === 6;
            const w = 1.5 + 7 * o.p;
            g.arrow(A, Bp, { color: slipOut ? 'purple' : 'gold', width: w, alpha: 0.9 });
            // water drops flowing BACKWARD along the best move during a backup
            if (s.phase === 'fill' && s.flow < 1 && !slipOut) {
              const f = smoothstep(s.flow);
              g.dot([Bp[0] + (A[0] - Bp[0]) * f, Bp[1] + (A[1] - Bp[1]) * f], 5, { color: 'blue' });
            }
            if (s.beat === 3 && i === s.sel && outs.length > 1) {
              const m = [(A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2];
              g.text(fmt(o.p, 2), [m[0] + (slipOut ? 0.35 : -0.25), m[1] + (slipOut ? 0 : 0.35)], { color: slipOut ? 'purple' : 'gold', size: 14 });
            }
          }
        }));
        // the rooms: cups of water (value)
        W.nodes.forEach((n, i) => {
          const [x, y] = n.p, h = BOX, w = n.wide ? 1.6 : BOX;
          if (n.term) {
            g.blob(n.p, 0.5, { color: n.r > 0 ? 'gold' : 'coral', alpha: 0.45 });
            g.emoji(n.icon, n.p, Math.max(26, g.px(0.85)));
            g.text(n.r > 0 ? '+1' : '−1', [x, y + 0.78], { color: n.r > 0 ? 'gold' : 'coral', size: 16 });
            return;
          }
          const v = s.Vd[i];
          g.rrect(x - w / 2, y - h / 2, w, h, 10, { fill: alpha('panel', 0.95), stroke: false });
          if (v > 0.002) g.rrect(x - w / 2, y - h / 2, w, h * clamp(v, 0, 1), 8, { fill: alpha('blue', 0.55), stroke: false });
          if (v < -0.002) g.rrect(x - w / 2, y + h / 2 - h * clamp(-v, 0, 1), w, h * clamp(-v, 0, 1), 8, { fill: alpha('coral', 0.5), stroke: false });
          g.rrect(x - w / 2, y - h / 2, w, h, 10, { color: i === s.sel && s.beat === 3 ? 'purple' : alpha('muted', 0.7), width: i === s.sel && s.beat === 3 ? 3 : 2 });
          if (s.beat === 2 && v > 0.01) g.emoji('🍬', [x, y], Math.max(6, g.px(0.8) * v));
          g.text(fmt(v, 2), [x, y + h / 2 + 0.28], { color: 'blue', size: 15 });
        });
        // the kid hopping along the best moves
        const k = s.kid;
        if (k) {
          const a = W.nodes[k.from].p, b = W.nodes[k.at].p, u = smoothstep(k.u);
          const p = [lerp(a[0], b[0], u), lerp(a[1], b[1], u) + Math.sin(Math.PI * u) * 0.6];
          g.emoji(k.mood ?? '🧒', [p[0], p[1] + (W.nodes[k.at].term && k.u >= 1 ? 0.75 : 0)], Math.max(22, g.px(0.6)));
        }
        if (s.beat === 0 && s.sweeps > 0) {
          // each move's worth = r + γ·V(next); the bigger one wins (gold)
          const p = W.nodes[1].p;
          W.acts[1].forEach((outs, a) => {
            const o = outs[0], nx = W.nodes[o.to];
            const q = (nx.r ?? 0) + (nx.term ? 0 : s.gamma * s.V[o.to]);
            const m = [(p[0] + nx.p[0]) / 2, p[1] + (nx.p[0] > p[0] ? -0.5 : 0.5)];
            g.text(fmt(q, 2), m, { size: 17, color: s.best[1] === a ? 'gold' : 'muted' });
          });
        }
        void C;
      },
      dispose() { offDown(); },
    };
  },
};
