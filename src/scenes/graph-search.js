// Graph search: a mouse looks for cheese in a maze. Dijkstra spreads out like a
// puddle (a ripple of "how far from the mouse"); A* adds a hunch "the cheese is
// THAT way" and only explores a beam. The weight on the hunch trades speed for
// the very shortest path. Finally: the same search on a graph of corners.
import { C, alpha, mix } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { astar, graphShortestPath, pointInPolygon } from '../core/planning.js';
import { clamp, smoothstep } from '../core/random.js';

const POLYS0 = [
  [[2.2, 2.0], [5.2, 1.6], [5.6, 4.6], [3.0, 5.4]],
  [[7.4, 5.2], [9.6, 4.4], [10.8, 7.0], [8.6, 8.6], [7.0, 7.6]],
  [[12.2, 1.2], [15.0, 1.8], [14.2, 4.6], [12.0, 4.0]],
  [[12.6, 6.4], [15.2, 6.0], [16.0, 8.4], [13.4, 9.0]],
];

function segCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

export default {
  eq: [
    ['f(n) = ', ['g(n)', 'teal'], ' + ', ['w', 'orange'], '·', ['h(n)', 'gold'], '     expand the smallest f first'],
    [['g', 'teal'], ' = steps so far        ', ['h', 'gold'], ' = ‖n − 🧀‖  (straight-line hunch)'],
    ['Dijkstra: ', ['w', 'orange'], ' = 0     A*: ', ['w', 'orange'], ' = 1 → shortest ✓     ', ['w', 'orange'], ' > 1 → fewer cells, maybe longer'],
    ['visibility graph: corners are nodes, straight lines are edges'],
  ],
  setup({ stage, ui }) {
    const portrait = stage.portrait;
    const W = portrait ? 15 : 30, H = portrait ? 20 : 17;
    const GB = portrait ? [0, -3.4, W, H] : [-4.6, 0, W, H]; // extra room for the race bars
    const g = stage.g.setBounds(GB);
    const walls = Array.from({ length: H }, () => new Array(W).fill(false));
    const wallRect = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < W && y < H) walls[y][x] = true; };
    if (portrait) {
      wallRect(2, 6, 14, 6); wallRect(0, 12, 11, 12); wallRect(6, 15, 6, 19); wallRect(9, 2, 9, 5);
    } else {
      wallRect(9, 3, 9, 13); wallRect(19, 4, 19, 16); wallRect(13, 8, 16, 8); wallRect(22, 9, 26, 9); wallRect(4, 4, 6, 4);
    }
    const s = {
      beat: 0, start: portrait ? [3, 2] : [3, 9], goal: portrait ? [11, 17] : [26, 6], weight: 2.5,
      res: null, opt: null, dij: null, k: 0, t: 0, phase: 'search', hold: 0, painting: null,
      polys: POLYS0.map((p) => p.map((v) => v.slice())), vs: [1.0, 7.0], vg: [17.0, 3.0], vgraph: null, run: 0,
    };
    // keep the visibility world inside the visible box
    const VB = [0, 0, 18, 10];

    const heur = () => (s.beat === 0 ? { heuristic: 'zero' } : s.beat === 1 ? { heuristic: 'euclid', weight: 1 } : { heuristic: s.weight === 0 ? 'zero' : 'euclid', weight: s.weight });
    const search = (instant = false) => {
      s.res = astar(walls, s.start, s.goal, heur());
      s.dij = astar(walls, s.start, s.goal, { heuristic: 'zero' });
      s.opt = s.dij;
      s.order = new Map(s.res.expanded.map(([x, y], i) => [y * W + x, i]));
      s.k = instant ? s.res.expanded.length : 0;
      s.phase = instant ? 'run' : 'search'; s.run = instant ? 1 : 0; s.hold = 0;
    };
    const buildVis = () => {
      const pad = 0.14;
      const grown = s.polys.map((P) => {
        const c = P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length], [0, 0]);
        return P.map((p) => { const d = Math.hypot(p[0] - c[0], p[1] - c[1]); return [p[0] + ((p[0] - c[0]) / d) * pad, p[1] + ((p[1] - c[1]) / d) * pad]; });
      });
      const inside = (p) => s.polys.some((P) => pointInPolygon(p, P));
      const nodes = [s.vs, s.vg];
      for (const P of grown) for (const p of P) if (!inside(p)) nodes.push(p);
      const free = (a, b) => {
        for (const P of s.polys) for (let i = 0; i < P.length; i++) if (segCross(a, b, P[i], P[(i + 1) % P.length])) return false;
        for (let t = 0.1; t < 1; t += 0.1) if (inside([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return false;
        return true;
      };
      const edges = [];
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (free(nodes[i], nodes[j])) edges.push([i, j]);
      const path = graphShortestPath(nodes, edges, 0, 1);
      let cost = 0;
      if (path) for (let i = 1; i < path.length; i++) cost += Math.hypot(nodes[path[i]][0] - nodes[path[i - 1]][0], nodes[path[i]][1] - nodes[path[i - 1]][1]);
      s.vgraph = { nodes, edges, path, cost };
      s.run = 0; s.hold = 0;
    };
    search();

    const onGrid = () => s.beat < 3;
    const snap = (p) => [clamp(Math.floor(p[0]), 0, W - 1), clamp(Math.floor(p[1]), 0, H - 1)];
    const ctr = (c) => [c[0] + 0.5, c[1] + 0.5];
    stage.handle({ pen: g, color: 'orange', icon: '🐭', r: 16,
      get: () => (onGrid() ? ctr(s.start) : s.vs),
      set: (p) => {
        if (onGrid()) { const c = snap(p); if (c[0] === s.goal[0] && c[1] === s.goal[1]) return; walls[c[1]][c[0]] = false; s.start = c; search(true); }
        else { s.vs = [clamp(p[0], VB[0] + 0.2, VB[2] - 0.2), clamp(p[1], VB[1] + 0.2, VB[3] - 0.2)]; buildVis(); s.run = 1; }
      } });
    stage.handle({ pen: g, color: 'gold', icon: '🧀', r: 16,
      get: () => (onGrid() ? ctr(s.goal) : s.vg),
      set: (p) => {
        if (onGrid()) { const c = snap(p); if (c[0] === s.start[0] && c[1] === s.start[1]) return; walls[c[1]][c[0]] = false; s.goal = c; search(true); }
        else { s.vg = [clamp(p[0], VB[0] + 0.2, VB[2] - 0.2), clamp(p[1], VB[1] + 0.2, VB[3] - 0.2)]; buildVis(); s.run = 1; }
      } });
    s.polys.forEach((P, i) => stage.handle({ pen: g, color: 'slate', kind: 'square', r: 8, visible: () => s.beat === 3,
      get: () => s.polys[i].reduce((a, p) => [a[0] + p[0] / s.polys[i].length, a[1] + p[1] / s.polys[i].length], [0, 0]),
      set: (p) => {
        const P = s.polys[i], c = P.reduce((a, q) => [a[0] + q[0] / P.length, a[1] + q[1] / P.length], [0, 0]);
        const d = [clamp(p[0], VB[0] + 1, VB[2] - 1) - c[0], clamp(p[1], VB[1] + 1, VB[3] - 1) - c[1]];
        s.polys[i] = P.map((q) => [q[0] + d[0], q[1] + d[1]]); buildVis(); s.run = 1;
      } }));

    // paint / erase walls
    const paint = (e) => {
      if (!onGrid() || e.pen !== g) return;
      const [x, y] = [Math.floor(e.p[0]), Math.floor(e.p[1])];
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      if ((x === s.start[0] && y === s.start[1]) || (x === s.goal[0] && y === s.goal[1])) return;
      if (s.painting === null) s.painting = !walls[y][x];
      if (walls[y][x] !== s.painting) { walls[y][x] = s.painting; search(true); }
    };
    const offs = [
      stage.on('down', (e) => { s.painting = null; paint(e); }),
      stage.on('move', (e) => { if (stage.pointer.down && s.painting !== null) paint(e); }),
      stage.on('up', () => { s.painting = null; }),
    ];

    ui.beats(['🌊', '⭐', '⚖️', '🕸️'], (b) => {
      s.beat = b;
      if (b === 3) { g.setBounds(portrait ? [0, -4, 18, 14] : VB); buildVis(); }
      else { g.setBounds(GB); search(); }
    });
    ui.slider({ icon: '⚖️', color: 'orange', min: 0, max: 5, step: 0.1, value: 2.5, title: 'how much to trust the hunch', onInput: (x) => { s.weight = x; if (s.beat === 2) search(true); } });
    ui.button({ icon: '🧹', title: 'clear walls', onClick: () => { walls.forEach((r) => r.fill(false)); if (onGrid()) search(); } });
    ui.button({ icon: '🔁', title: 'search again', onClick: () => (onGrid() ? search() : buildVis()) });
    ui.readout(() => (onGrid() ? String(Math.floor(Math.min(s.k, s.res.expanded.length))) : String(s.vgraph?.nodes.length ?? 0)), { icon: '🔍', color: 'teal', title: 'cells looked at' });
    ui.readout(() => (onGrid() ? (s.res.path ? fmt(s.res.cost, 1) : '∞') : fmt(s.vgraph?.cost ?? Infinity, 1)), { icon: '🛤️', color: 'gold', title: 'path length' });

    const pathPoint = (pts, u) => {
      if (!pts || pts.length < 2) return pts?.[0];
      let Ltot = 0; const seg = [];
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); Ltot += l; }
      let d = clamp(u, 0, 1) * Ltot;
      for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) { const t = d / (seg[i] || 1); return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; } d -= seg[i]; }
      return pts[pts.length - 1];
    };

    return {
      update(dt) {
        s.t += dt;
        if (onGrid()) {
          const n = s.res.expanded.length;
          if (s.phase === 'search') {
            s.k += dt * Math.max(25, n / 3);
            if (s.k >= n) { s.k = n; s.phase = 'run'; s.run = 0; }
          } else if (s.phase === 'run') {
            s.run += dt / Math.max(0.8, (s.res.path?.length ?? 1) * 0.06);
            if (s.run >= 1) { s.run = 1; s.hold += dt; if (s.hold > 2.2) search(); }
          }
        } else {
          s.run = Math.min(1, s.run + dt / 2.5);
          if (s.run >= 1) { s.hold += dt; if (s.hold > 1.5) { s.run = 0; s.hold = 0; } }
        }
      },
      draw() {
        if (onGrid()) drawGrid(); else drawVis();
      },
      dispose() { offs.forEach((f) => f()); },
    };

    function drawGrid() {
      const n = s.res.expanded.length, k = Math.floor(s.k);
      g.rect(0, 0, W, H, { fill: alpha('panel', 0.6), color: alpha('muted', 0.4), width: 1.5 });
      // explored cells, colored by the ORDER they were taken out of the queue
      for (let i = 0; i < Math.min(k, n); i++) {
        const [x, y] = s.res.expanded[i];
        const t = i / Math.max(1, n - 1);
        g.rect(x + 0.04, y + 0.04, 0.92, 0.92, { fill: alpha(mix('teal', 'blue', t), 0.22 + 0.3 * (1 - t)), stroke: false });
      }
      // the wavefront: the newest cells glow
      if (s.phase === 'search') for (let i = Math.max(0, k - 14); i < k; i++) {
        const [x, y] = s.res.expanded[i];
        g.rect(x + 0.08, y + 0.08, 0.84, 0.84, { fill: alpha('teal', 0.75), stroke: false });
      }
      // grid lines
      const ctx = g.ctx;
      ctx.save(); ctx.strokeStyle = alpha('muted', 0.12); ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 1; x < W; x++) { const a = g.toScreen([x, 0]), b = g.toScreen([x, H]); ctx.moveTo(Math.round(a[0]) + 0.5, a[1]); ctx.lineTo(Math.round(b[0]) + 0.5, b[1]); }
      for (let y = 1; y < H; y++) { const a = g.toScreen([0, y]), b = g.toScreen([W, y]); ctx.moveTo(a[0], Math.round(a[1]) + 0.5); ctx.lineTo(b[0], Math.round(b[1]) + 0.5); }
      ctx.stroke(); ctx.restore();
      // walls
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walls[y][x]) g.rrect(x + 0.03, y + 0.03, 0.94, 0.94, 3, { fill: col('slate'), stroke: false });
      // the hunch: straight line to the cheese
      if (s.beat >= 1 && !(s.beat === 2 && s.weight === 0)) g.line(ctr(s.start), ctr(s.goal), { color: alpha('gold', 0.6), width: 2, dash: [2, 6] });
      // optimal path (lime, dashed) vs found path (gold)
      if (s.phase === 'run' && s.res.path) {
        const pts = s.res.path.map(ctr);
        const worse = s.res.cost > s.opt.cost + 1e-6;
        if (s.beat === 2 && worse && s.opt.path) g.path(s.opt.path.map(ctr), { color: alpha('lime', 0.9), width: 3, dash: [6, 5] });
        const u = smoothstep(Math.min(1, s.run * 1.6));
        const shown = []; const L = pts.length;
        for (let i = 0; i < Math.max(2, Math.ceil(L * u)); i++) shown.push(pts[Math.min(i, L - 1)]);
        g.path(shown, { color: worse ? 'coral' : 'gold', width: 5 });
        const m = pathPoint(pts, s.run);
        if (m) g.emoji('🐭', m, Math.max(18, g.px(0.9)));
        if (s.run >= 1) g.emoji('🎉', [s.goal[0] + 0.5, s.goal[1] + 1.4], Math.max(18, g.px(0.9)));
      }
      if (!s.res.path && s.k >= n) g.emoji('🚫', [(s.start[0] + s.goal[0]) / 2 + 0.5, (s.start[1] + s.goal[1]) / 2 + 0.5], 34);
      // race bars: how many cells each method opened
      if (s.beat >= 1) bars();
    }

    function bars() {
      // a race: how many cells each method had to open (Dijkstra vs the current search)
      const free = walls.flat().filter((x) => !x).length;
      const rows = [['🌊', s.dij.expanded.length, 'teal'], [s.beat === 1 ? '⭐' : '⚖️', Math.floor(Math.min(s.k, s.res.expanded.length)), s.beat === 1 ? 'gold' : 'orange']];
      rows.forEach(([ic, v, c], i) => {
        if (portrait) {
          const y = -1.1 - i * 1.3, x0 = 1.4, Lm = W - 4;
          g.emoji(ic, [0.6, y], 18);
          g.rrect(x0, y - 0.35, Lm, 0.7, 6, { fill: alpha('faint', 0.5), stroke: false });
          g.rrect(x0, y - 0.35, Math.max(0.1, (Lm * v) / free), 0.7, 6, { fill: col(c), stroke: false });
          g.text(String(v), [x0 + Lm + 0.3, y], { color: c, size: 13, align: 'left' });
        } else {
          const x = -3.6 + i * 1.8, y0 = 1.6, Lm = H - 4.6;
          g.rrect(x - 0.4, y0, 0.8, Lm, 6, { fill: alpha('faint', 0.5), stroke: false });
          g.rrect(x - 0.4, y0, 0.8, Math.max(0.1, (Lm * v) / free), 6, { fill: col(c), stroke: false });
          g.emoji(ic, [x, y0 + Lm + 0.8], 20);
          g.text(String(v), [x, 0.8], { color: c, size: 14 });
        }
      });
    }

    function drawVis() {
      const V = s.vgraph;
      g.grid({ step: 1, axes: false });
      for (const [i, j] of V.edges) g.line(V.nodes[i], V.nodes[j], { color: alpha('teal', 0.28), width: 1.2 });
      for (const P of s.polys) g.poly(P, { fill: alpha('slate', 0.9), color: 'slate', width: 2 });
      for (let i = 2; i < V.nodes.length; i++) g.dot(V.nodes[i], 3.5, { color: 'teal' });
      if (V.path) {
        const pts = V.path.map((i) => V.nodes[i]);
        g.path(pts, { color: 'gold', width: 5 });
        const m = pathPoint(pts, smoothstep(s.run));
        g.emoji('🐭', m, 24);
      } else g.emoji('🚫', [(s.vs[0] + s.vg[0]) / 2, (s.vs[1] + s.vg[1]) / 2], 30);
    }
  },
};

const col = (c) => (c in C ? C[c] : c);
