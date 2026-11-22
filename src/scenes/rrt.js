// RRT grows like a plant: throw a random seed somewhere, find the closest
// branch, grow one small step toward it. Repeat until a branch touches the goal.
// PRM throws all the seeds first, links neighbours into a road map, then searches it.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { RRT, prm, graphShortestPath, segHitsCircle } from '../core/planning.js';
import { rng, clamp, smoothstep } from '../core/random.js';

const B = [-5, -3, 5, 3];
const OBS0 = [
  { c: [-2.3, -0.4], r: 0.95 }, { c: [0.2, 1.4], r: 0.9 }, { c: [0.6, -1.7], r: 0.8 },
  { c: [2.9, 0.2], r: 0.75 }, { c: [-0.9, 2.5], r: 0.45 },
];
const plen = (P) => { let L = 0; for (let i = 1; i < (P?.length ?? 0); i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return P ? L : Infinity; };

export default {
  eq: [
    [['x_rand', 'teal'], ' ~ uniform      ', ['x_near', 'green'], ' = argmin ‖x − ', ['x_rand', 'teal'], '‖'],
    [['x_new', 'green'], ' = ', ['x_near', 'green'], ' + ', ['η', 'orange'], '·(', ['x_rand', 'teal'], ' − ', ['x_near', 'green'], ')/‖·‖     (if no ', ['obstacle', 'slate'], ' in between)'],
    ['with probability ', ['p', 'gold'], ':  ', ['x_rand', 'teal'], ' = ', ['x🎯', 'gold']],
    ['PRM: sample ', ['n', 'teal'], ' points, link k nearest, then Dijkstra → ', ['path', 'gold']],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds(B);
    const s = {
      beat: 0, start: [-4.3, -2.3], goal: [4.2, 2.2], obs: OBS0.map((o) => ({ c: o.c.slice(), r: o.r })),
      bias: 0.05, step: 0.35, seed: 3, tree: null, acc: 0, hold: 0, recent: [], runs: [], t: 0,
      n: 90, road: null, roadT: 0, cut: null,
    };
    const newTree = () => {
      s.tree = new RRT({ start: s.start, goal: s.goal, bounds: B, obstacles: s.obs, step: s.step, goalBias: s.beat === 1 ? s.bias : 0.05, goalTol: 0.35, seed: s.seed });
      s.depth = [0]; s.recent = []; s.hold = 0; s.acc = 0;
    };
    const growOne = () => {
      const T = s.tree, before = T.nodes.length;
      const ev = T.grow();
      if (!ev) return;
      for (let i = before; i < T.nodes.length; i++) s.depth[i] = s.depth[T.nodes[i].parent] + 1;
      s.recent.push({ ...ev, age: 0, goalPick: ev.sample[0] === s.goal[0] && ev.sample[1] === s.goal[1] });
      if (s.recent.length > 8) s.recent.shift();
    };
    // PRM road map: built once, queried many times
    const buildRoad = () => {
      const r = prm({ bounds: B, obstacles: s.obs, n: s.n, k: 6, seed: 11 });
      s.road = { nodes: r.nodes, edges: r.edges };
      s.roadT = 0;
      query();
    };
    const query = () => {
      const R = s.road, nodes = [...R.nodes, s.start, s.goal], edges = R.edges.slice();
      const free = (a, b) => !s.obs.some((o) => segHitsCircle(a, b, o.c, o.r));
      for (const qi of [nodes.length - 2, nodes.length - 1]) {
        const q = nodes[qi];
        R.nodes.map((p, j) => ({ j, d: Math.hypot(p[0] - q[0], p[1] - q[1]) })).sort((a, b) => a.d - b.d).slice(0, 8)
          .forEach(({ j }) => { if (free(q, R.nodes[j])) edges.push([qi, j]); });
      }
      const path = graphShortestPath(nodes, edges, nodes.length - 2, nodes.length - 1);
      s.road.q = { nodes, edges, path: path ? path.map((i) => nodes[i]) : null };
    };
    // shortcutting: grow a full RRT, then try straight-line cuts between random path points
    const startCut = () => {
      const T = new RRT({ start: s.start, goal: s.goal, bounds: B, obstacles: s.obs, step: 0.35, goalBias: 0.05, goalTol: 0.35, seed: s.seed });
      for (let i = 0; i < 6000 && !T.done; i++) T.grow();
      s.cut = { orig: T.path ? T.path.map((p) => p.slice()) : null, path: T.path ? T.path.map((p) => p.slice()) : null, tries: 0, last: null, timer: 0, rand: rng(s.seed * 7 + 1), hold: 0, tree: T };
    };
    const reset = () => { if (s.beat <= 1) newTree(); else if (s.beat === 2) buildRoad(); else startCut(); };

    stage.handle({ pen: g, color: 'green', icon: '🌱', r: 15, get: () => s.start,
      set: (p) => { s.start = [clamp(p[0], B[0] + 0.2, B[2] - 0.2), clamp(p[1], B[1] + 0.2, B[3] - 0.2)]; if (s.beat === 2) query(); else reset(); } });
    stage.handle({ pen: g, color: 'gold', icon: '🎯', r: 15, get: () => s.goal,
      set: (p) => { s.goal = [clamp(p[0], B[0] + 0.2, B[2] - 0.2), clamp(p[1], B[1] + 0.2, B[3] - 0.2)]; if (s.beat === 2) query(); else reset(); } });
    const oh = s.obs.map((o, i) => stage.handle({ pen: g, color: 'slate', kind: 'ring', r: 20, get: () => s.obs[i].c,
      set: (p) => { s.obs[i].c = [clamp(p[0], B[0], B[2]), clamp(p[1], B[1], B[3])]; reset(); } }));

    ui.beats(['🌳', '🎯', '🕸️', '🧹'], (b) => { s.beat = b; s.t = 0; reset(); });
    ui.slider({ icon: '🎯', color: 'gold', min: 0, max: 0.6, step: 0.01, value: s.bias, title: 'how often to aim at the goal', onInput: (v) => { s.bias = v; if (s.beat === 1) newTree(); } });
    ui.slider({ icon: '🌰', color: 'teal', min: 20, max: 250, step: 1, value: s.n, title: 'road-map points', onInput: (v) => { s.n = v; if (s.beat === 2) buildRoad(); } });
    ui.button({ icon: '🎲', title: 'new random seed', onClick: () => { s.seed++; reset(); } });
    ui.readout(() => (s.beat <= 1 ? String(s.tree.nodes.length) : s.beat === 2 ? String(s.road?.nodes.length ?? 0) : String(s.cut?.path?.length ?? 0)), { icon: '🌳', color: 'green', title: 'nodes' });
    ui.readout(() => (s.beat <= 1 ? fmt(plen(s.tree.path), 1) : s.beat === 2 ? fmt(plen(s.road?.q?.path), 1) : fmt(plen(s.cut?.path), 1)), { icon: '🛤️', color: 'gold', title: 'path length' });
    newTree();

    return {
      update(dt) {
        s.t += dt;
        for (const r of s.recent) r.age += dt;
        if (s.beat <= 1) {
          if (!s.tree.done && s.tree.nodes.length < 1800) {
            s.acc += dt * (s.beat === 1 ? 90 : 30);
            let k = 0;
            while (s.acc >= 1 && k++ < 40) { s.acc -= 1; growOne(); if (s.tree.done) break; }
            if (s.tree.done && s.beat === 1) { s.runs.push([s.bias, s.tree.nodes.length]); if (s.runs.length > 80) s.runs.shift(); }
          } else {
            s.hold += dt;
            if (s.hold > (s.beat === 1 ? 1.0 : 2.6)) { s.seed++; newTree(); }
          }
        } else if (s.beat === 2) {
          s.roadT += dt;
        } else if (s.cut?.path) {
          const c = s.cut;
          c.timer += dt;
          if (c.timer > 0.35 && c.tries < 60) {
            c.timer = 0; c.tries++;
            const P = c.path;
            if (P.length > 2) {
              const i = Math.floor(c.rand() * (P.length - 2)), j = i + 2 + Math.floor(c.rand() * (P.length - i - 2));
              const ok = !s.obs.some((o) => segHitsCircle(P[i], P[j], o.c, o.r));
              c.last = { a: P[i], b: P[j], ok, age: 0 };
              if (ok) c.path = [...P.slice(0, i + 1), ...P.slice(j)];
            }
          }
          if (c.last) c.last.age += dt;
          if (c.tries >= 60 || c.path.length <= 2) { c.hold += dt; if (c.hold > 2.5) { s.seed++; startCut(); } }
        }
      },
      draw() {
        oh.forEach((h, i) => (h.r = Math.max(12, g.px(s.obs[i].r) - 2)));
        g.grid({ step: 1, axes: false });
        g.rect(B[0], B[1], B[2] - B[0], B[3] - B[1], { color: alpha('muted', 0.35), width: 1.5 });
        for (const o of s.obs) g.circle(o.c, o.r, { fill: alpha('slate', 0.9), color: 'slate', width: 2 });
        if (s.beat <= 1) drawTree(); else if (s.beat === 2) drawRoad(); else drawCut();
        g.blob(s.goal, 0.3, { color: 'gold', alpha: 0.4 });
        g.circle(s.goal, 0.35, { color: alpha('gold', 0.6), width: 2, dash: [4, 4] });
        if (s.beat === 1) drawRuns();
      },
    };

    function drawTree() {
      const T = s.tree;
      // branches: thick trunk near the seed, thin twigs at the tips
      for (let i = 1; i < T.nodes.length; i++) {
        const n = T.nodes[i], p = T.nodes[n.parent];
        g.line(p.p, n.p, { color: alpha('green', 0.85), width: Math.max(1.3, 4.5 - (s.depth[i] ?? 0) * 0.12) });
      }
      for (const r of s.recent) {
        const a = Math.max(0, 1 - r.age * 1.2);
        if (a <= 0) continue;
        g.line(r.near, r.sample, { color: alpha(r.goalPick ? 'gold' : 'teal', 0.6 * a), width: 1.5, dash: [3, 4] });
        g.dot(r.sample, 5, { color: alpha(r.goalPick ? 'gold' : 'teal', a) });
        if (r.added) g.dot(r.added, 4.5, { color: alpha('lime', a), ring: 'bg' });
        else g.emoji('✖', r.sample, 14, { color: 'coral', alpha: a });
      }
      if (T.path) {
        g.path(T.path, { color: 'gold', width: 5 });
        g.emoji('🌸', [s.goal[0], s.goal[1] + 0.55], 24);
      }
    }

    function drawRoad() {
      const R = s.road, Q = R.q;
      const tN = smoothstep(s.roadT / 1.2), tE = smoothstep((s.roadT - 1.2) / 1.2), tP = smoothstep((s.roadT - 2.4) / 0.8);
      const nE = Math.floor(Q.edges.length * tE);
      for (let i = 0; i < nE; i++) { const [a, b] = Q.edges[i]; g.line(Q.nodes[a], Q.nodes[b], { color: alpha('teal', 0.35), width: 1.3 }); }
      const nN = Math.floor(R.nodes.length * tN);
      for (let i = 0; i < nN; i++) g.dot(R.nodes[i], 3.5, { color: 'teal' });
      if (Q.path && tP > 0) {
        const k = Math.max(2, Math.ceil(Q.path.length * tP));
        g.path(Q.path.slice(0, k), { color: 'gold', width: 5 });
      }
      if (!Q.path && tP >= 1) g.emoji('🚫', [(s.start[0] + s.goal[0]) / 2, (s.start[1] + s.goal[1]) / 2], 30);
    }

    function drawCut() {
      const c = s.cut;
      if (!c?.path) { g.emoji('🚫', [0, 0], 30); return; }
      const T = c.tree;
      for (let i = 1; i < T.nodes.length; i++) { const n = T.nodes[i]; g.line(T.nodes[n.parent].p, n.p, { color: alpha('green', 0.18), width: 1.2 }); }
      g.path(c.orig, { color: alpha('coral', 0.55), width: 3, dash: [5, 5] });
      g.path(c.path, { color: 'gold', width: 5 });
      for (const p of c.path) g.dot(p, 4, { color: 'gold', ring: 'bg' });
      if (c.last && c.last.age < 0.5) {
        const a = 1 - c.last.age / 0.5;
        g.line(c.last.a, c.last.b, { color: alpha(c.last.ok ? 'lime' : 'coral', a), width: 4 });
        const m = [(c.last.a[0] + c.last.b[0]) / 2, (c.last.a[1] + c.last.b[1]) / 2];
        g.emoji(c.last.ok ? '✂️' : '✖', m, 20, { alpha: a, color: 'coral' });
      }
    }

    function drawRuns() {
      // little experiment chart: each finished tree = one dot (aim-at-goal vs tree size)
      const hud = stage.hud, ctx = hud.ctx, a = g.area;
      const w = 176, h = 118, x = a.x + a.w - w - 10, y = a.y + a.h - h - 10;
      ctx.save();
      ctx.fillStyle = alpha('panel', 0.92); ctx.strokeStyle = alpha('muted', 0.3);
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill(); ctx.stroke();
      const px = (b) => x + 30 + (b / 0.6) * (w - 42), maxN = Math.max(200, ...s.runs.map((r) => r[1]));
      const py = (n) => y + h - 26 - (n / maxN) * (h - 40);
      ctx.strokeStyle = alpha('muted', 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 30, y + 12); ctx.lineTo(x + 30, y + h - 26); ctx.lineTo(x + w - 10, y + h - 26); ctx.stroke();
      ctx.font = '14px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🌳', x + 15, y + 22); ctx.fillText('🎯', x + w - 18, y + h - 12);
      s.runs.forEach(([b, n], i) => {
        ctx.fillStyle = alpha('gold', 0.35 + 0.65 * (i / s.runs.length));
        ctx.beginPath(); ctx.arc(px(b), py(n), 3.5, 0, 2 * Math.PI); ctx.fill();
      });
      ctx.strokeStyle = C.gold; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px(s.bias), y + 12); ctx.lineTo(px(s.bias), y + h - 26); ctx.stroke();
      ctx.restore();
    }
  },
};
