// Motion planning: grid search (A*/Dijkstra), RRT, PRM, potential fields, C-space.
import { rng as makeRng } from './random.js';

// Grid A*. grid[y][x] truthy = blocked. Returns { path, expanded (in order), cost }.
export function astar(grid, start, goal, { heuristic = 'euclid', weight = 1, diagonal = true } = {}) {
  const H = grid.length, W = grid[0].length;
  const key = (x, y) => y * W + x;
  const h = (x, y) => {
    if (heuristic === 'zero') return 0;
    const dx = Math.abs(x - goal[0]), dy = Math.abs(y - goal[1]);
    return heuristic === 'manhattan' ? dx + dy : Math.hypot(dx, dy);
  };
  const g = new Map([[key(...start), 0]]);
  const parent = new Map();
  const open = [{ x: start[0], y: start[1], f: weight * h(...start) }];
  const closed = new Set();
  const expanded = [];
  const moves = diagonal
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);
    expanded.push([cur.x, cur.y]);
    if (cur.x === goal[0] && cur.y === goal[1]) {
      const path = [[cur.x, cur.y]];
      let k = ck;
      while (parent.has(k)) { k = parent.get(k); path.push([k % W, Math.floor(k / W)]); }
      return { path: path.reverse(), expanded, cost: g.get(ck) };
    }
    for (const [dx, dy] of moves) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || grid[ny][nx]) continue;
      if (dx && dy && (grid[cur.y][nx] || grid[ny][cur.x])) continue; // no corner cutting
      const nk = key(nx, ny);
      const ng = g.get(ck) + Math.hypot(dx, dy);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        parent.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + weight * h(nx, ny) });
      }
    }
  }
  return { path: null, expanded, cost: Infinity };
}

// Segment–circle collision.
export function segHitsCircle(a, b, c, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-12;
  let t = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const px = a[0] + t * dx - c[0], py = a[1] + t * dy - c[1];
  return px * px + py * py < r * r;
}

// RRT in a box with circular obstacles. Step-able: call grow() repeatedly.
export class RRT {
  constructor({ start, goal, bounds, obstacles, step = 0.3, goalBias = 0.08, goalTol = 0.3, seed = 5 }) {
    Object.assign(this, { start, goal, bounds, obstacles, step, goalBias, goalTol });
    this.rand = makeRng(seed);
    this.nodes = [{ p: start.slice(), parent: -1 }];
    this.done = false;
    this.path = null;
  }
  free(a, b) { return !this.obstacles.some((o) => segHitsCircle(a, b, o.c, o.r)); }
  grow() {
    if (this.done) return null;
    const [x0, y0, x1, y1] = this.bounds;
    const sample = this.rand() < this.goalBias ? this.goal.slice() : [this.rand.uniform(x0, x1), this.rand.uniform(y0, y1)];
    let bi = 0, bd = Infinity;
    this.nodes.forEach((n, i) => {
      const d = Math.hypot(n.p[0] - sample[0], n.p[1] - sample[1]);
      if (d < bd) { bd = d; bi = i; }
    });
    const near = this.nodes[bi].p;
    const s = Math.min(this.step, bd);
    const nw = bd < 1e-9 ? sample : [near[0] + ((sample[0] - near[0]) * s) / bd, near[1] + ((sample[1] - near[1]) * s) / bd];
    const ev = { sample, near, added: null };
    if (this.free(near, nw)) {
      this.nodes.push({ p: nw, parent: bi });
      ev.added = nw;
      if (Math.hypot(nw[0] - this.goal[0], nw[1] - this.goal[1]) < this.goalTol && this.free(nw, this.goal)) {
        this.nodes.push({ p: this.goal.slice(), parent: this.nodes.length - 1 });
        this.done = true;
        this.path = [];
        let k = this.nodes.length - 1;
        while (k >= 0) { this.path.push(this.nodes[k].p); k = this.nodes[k].parent; }
        this.path.reverse();
      }
    }
    return ev;
  }
}

// Probabilistic roadmap: sample, connect k nearest collision-free neighbours.
export function prm({ bounds, obstacles, n = 80, k = 6, seed = 9 }) {
  const r = makeRng(seed);
  const [x0, y0, x1, y1] = bounds;
  const inObs = (p) => obstacles.some((o) => Math.hypot(p[0] - o.c[0], p[1] - o.c[1]) < o.r);
  const nodes = [];
  while (nodes.length < n) {
    const p = [r.uniform(x0, x1), r.uniform(y0, y1)];
    if (!inObs(p)) nodes.push(p);
  }
  const edges = [];
  nodes.forEach((p, i) => {
    const near = nodes.map((q, j) => ({ j, d: Math.hypot(p[0] - q[0], p[1] - q[1]) }))
      .filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, k);
    for (const { j } of near)
      if (i < j && !obstacles.some((o) => segHitsCircle(p, nodes[j], o.c, o.r))) edges.push([i, j]);
  });
  return { nodes, edges };
}

// Dijkstra on an explicit graph (nodes as points, edges as index pairs).
export function graphShortestPath(nodes, edges, s, t) {
  const adj = nodes.map(() => []);
  for (const [i, j] of edges) {
    const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
    adj[i].push([j, d]); adj[j].push([i, d]);
  }
  const dist = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = nodes.map(() => false);
  dist[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    if (u === t) break;
    for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  if (dist[t] === Infinity) return null;
  const path = [];
  for (let u = t; u >= 0; u = prev[u]) path.push(u);
  return path.reverse();
}

// Attractive (quadratic/conic) + repulsive potential and its negative gradient.
export function potentialField(goal, obstacles, { katt = 1, krep = 0.5, rho0 = 1.0, dstar = 2 } = {}) {
  const U = (p) => {
    const dg = Math.hypot(p[0] - goal[0], p[1] - goal[1]);
    let u = dg <= dstar ? 0.5 * katt * dg * dg : dstar * katt * dg - 0.5 * katt * dstar * dstar;
    for (const o of obstacles) {
      const d = Math.max(Math.hypot(p[0] - o.c[0], p[1] - o.c[1]) - o.r, 1e-3);
      if (d < rho0) u += 0.5 * krep * (1 / d - 1 / rho0) ** 2;
    }
    return u;
  };
  const force = (p) => {
    const dx = p[0] - goal[0], dy = p[1] - goal[1], dg = Math.hypot(dx, dy) || 1e-9;
    let f = dg <= dstar ? [-katt * dx, -katt * dy] : [(-dstar * katt * dx) / dg, (-dstar * katt * dy) / dg];
    for (const o of obstacles) {
      const ox = p[0] - o.c[0], oy = p[1] - o.c[1], dc = Math.hypot(ox, oy) || 1e-9;
      const d = Math.max(dc - o.r, 1e-3);
      if (d < rho0) {
        const m = krep * (1 / d - 1 / rho0) / (d * d);
        f = [f[0] + (m * ox) / dc, f[1] + (m * oy) / dc];
      }
    }
    return f;
  };
  return { U, force };
}

// Minkowski sum of a convex polygon obstacle with a (reflected) robot polygon → C-space obstacle.
export function minkowski(A, B) {
  const pts = [];
  for (const a of A) for (const b of B) pts.push([a[0] - b[0], a[1] - b[1]]);
  return convexHull(pts);
}

export function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crossO = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && crossO(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && crossO(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
