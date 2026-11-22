// Learning kernel: tiny neural nets with backprop, optimizers, convolution,
// attention, RL (value iteration, Q-learning, REINFORCE), Gaussian processes,
// GMMs, DMPs, PCA, diffusion / flow-matching helpers.
import { rng as makeRng } from './random.js';
import { cholesky, mvec, T, zeros, symEig, mean, covariance, inv, det, vsub } from './linalg.js';

// ---------- activations ----------
export const act = {
  tanh: { f: Math.tanh, df: (y) => 1 - y * y },                           // df in terms of output y
  relu: { f: (x) => (x > 0 ? x : 0), df: (y) => (y > 0 ? 1 : 0) },
  sigmoid: { f: (x) => 1 / (1 + Math.exp(-x)), df: (y) => y * (1 - y) },
  linear: { f: (x) => x, df: () => 1 },
  leaky: { f: (x) => (x > 0 ? x : 0.05 * x), df: (y) => (y > 0 ? 1 : 0.05) },
};

export function softmax(z, temp = 1) {
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp((x - m) / temp));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

// ---------- multilayer perceptron with manual backprop ----------
export class MLP {
  // sizes e.g. [2, 8, 8, 1]; acts e.g. ['tanh', 'tanh', 'linear']
  constructor(sizes, acts, seed = 1) {
    const r = makeRng(seed);
    this.sizes = sizes;
    this.acts = acts ?? sizes.slice(1).map((_, i) => (i === sizes.length - 2 ? 'linear' : 'tanh'));
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const fanIn = sizes[l], fanOut = sizes[l + 1];
      const scale = this.acts[l] === 'relu' ? Math.sqrt(2 / fanIn) : Math.sqrt(1 / fanIn); // He / Xavier-ish
      this.W.push(Array.from({ length: fanOut }, () => Array.from({ length: fanIn }, () => r.normal(0, scale))));
      this.b.push(new Array(fanOut).fill(0));
    }
  }
  // Returns all layer activations (a[0] = input).
  forward(x) {
    const a = [x];
    for (let l = 0; l < this.W.length; l++) {
      const z = this.W[l].map((row, i) => row.reduce((s, w, j) => s + w * a[l][j], this.b[l][i]));
      a.push(z.map(act[this.acts[l]].f));
    }
    return a;
  }
  predict(x) { const a = this.forward(x); return a[a.length - 1]; }
  // Backprop from dL/d(output). Returns grads + per-layer deltas (for visualizing the flow).
  backward(a, dLdy) {
    const L = this.W.length;
    const gW = this.W.map((Wl) => Wl.map((r) => r.map(() => 0)));
    const gb = this.b.map((bl) => bl.map(() => 0));
    const deltas = new Array(L);
    let delta = dLdy.map((g, i) => g * act[this.acts[L - 1]].df(a[L][i]));
    for (let l = L - 1; l >= 0; l--) {
      deltas[l] = delta;
      for (let i = 0; i < delta.length; i++) {
        gb[l][i] += delta[i];
        for (let j = 0; j < a[l].length; j++) gW[l][i][j] += delta[i] * a[l][j];
      }
      if (l > 0) {
        const prev = a[l].map((_, j) => this.W[l].reduce((s, row, i) => s + row[j] * delta[i], 0));
        delta = prev.map((g, j) => g * act[this.acts[l - 1]].df(a[l][j]));
      }
    }
    return { gW, gb, deltas };
  }
  params() { return [...this.W.flatMap((Wl) => Wl), this.b]; }
}

// Adam / SGD / momentum on MLP parameters.
export class Optimizer {
  constructor(net, { type = 'adam', lr = 0.01, beta1 = 0.9, beta2 = 0.999, momentum = 0.9, l2 = 0 } = {}) {
    Object.assign(this, { net, type, lr, beta1, beta2, momentum, l2 });
    const z = () => ({ W: net.W.map((Wl) => Wl.map((r) => r.map(() => 0))), b: net.b.map((bl) => bl.map(() => 0)) });
    this.m = z(); this.v = z(); this.t = 0;
  }
  step(gW, gb, batch = 1) {
    this.t++;
    const { beta1: b1, beta2: b2, lr } = this;
    const upd = (P, G, M, V, decay) => {
      for (let i = 0; i < P.length; i++) {
        const g = G[i] / batch + (decay ? this.l2 * P[i] : 0);
        if (this.type === 'sgd') P[i] -= lr * g;
        else if (this.type === 'momentum') { M[i] = this.momentum * M[i] + g; P[i] -= lr * M[i]; }
        else {
          M[i] = b1 * M[i] + (1 - b1) * g;
          V[i] = b2 * V[i] + (1 - b2) * g * g;
          const mh = M[i] / (1 - b1 ** this.t), vh = V[i] / (1 - b2 ** this.t);
          P[i] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
        }
      }
    };
    this.net.W.forEach((Wl, l) => Wl.forEach((row, i) => upd(row, gW[l][i], this.m.W[l][i], this.v.W[l][i], true)));
    this.net.b.forEach((bl, l) => upd(bl, gb[l], this.m.b[l], this.v.b[l], false));
  }
}

// Train one minibatch with MSE (regression) or BCE-with-sigmoid (classification).
export function trainBatch(net, opt, X, Y, loss = 'mse') {
  const L = net.W.length;
  const gW = net.W.map((Wl) => Wl.map((r) => r.map(() => 0)));
  const gb = net.b.map((bl) => bl.map(() => 0));
  let total = 0;
  for (let n = 0; n < X.length; n++) {
    const a = net.forward(X[n]);
    const y = a[L];
    let dLdy;
    if (loss === 'bce') {
      total += -Y[n].reduce((s, t, i) => s + t * Math.log(y[i] + 1e-9) + (1 - t) * Math.log(1 - y[i] + 1e-9), 0);
      // With sigmoid output, dL/dz = y - t; divide by σ' since backward multiplies it back in.
      dLdy = y.map((yi, i) => (yi - Y[n][i]) / Math.max(yi * (1 - yi), 1e-6));
    } else {
      total += y.reduce((s, yi, i) => s + 0.5 * (yi - Y[n][i]) ** 2, 0);
      dLdy = y.map((yi, i) => yi - Y[n][i]);
    }
    const g = net.backward(a, dLdy);
    for (let l = 0; l < L; l++) {
      for (let i = 0; i < gW[l].length; i++) {
        gb[l][i] += g.gb[l][i];
        for (let j = 0; j < gW[l][i].length; j++) gW[l][i][j] += g.gW[l][i][j];
      }
    }
  }
  opt.step(gW, gb, X.length);
  return total / X.length;
}

// ---------- convolution / pooling ----------
export function conv2d(img, k, { stride = 1, pad = 0 } = {}) {
  const H = img.length, W = img[0].length, kh = k.length, kw = k[0].length;
  const oh = Math.floor((H + 2 * pad - kh) / stride) + 1, ow = Math.floor((W + 2 * pad - kw) / stride) + 1;
  const out = zeros(oh, ow);
  for (let i = 0; i < oh; i++)
    for (let j = 0; j < ow; j++) {
      let s = 0;
      for (let u = 0; u < kh; u++)
        for (let v = 0; v < kw; v++) {
          const y = i * stride + u - pad, x = j * stride + v - pad;
          if (y >= 0 && x >= 0 && y < H && x < W) s += img[y][x] * k[u][v];
        }
      out[i][j] = s;
    }
  return out;
}
export function maxPool(img, size = 2) {
  const oh = Math.floor(img.length / size), ow = Math.floor(img[0].length / size);
  const out = zeros(oh, ow);
  for (let i = 0; i < oh; i++)
    for (let j = 0; j < ow; j++) {
      let m = -Infinity;
      for (let u = 0; u < size; u++) for (let v = 0; v < size; v++) m = Math.max(m, img[i * size + u][j * size + v]);
      out[i][j] = m;
    }
  return out;
}
export const conv1d = (x, k) => x.map((_, i) => k.reduce((s, kk, j) => s + kk * (x[i + j - Math.floor(k.length / 2)] ?? 0), 0));

// ---------- attention ----------
// Scaled dot-product attention. Q: n×d, K: m×d, V: m×dv. Returns { out, weights }.
export function attention(Q, K, V, mask = null) {
  const d = Q[0].length;
  const weights = Q.map((q, i) => softmax(K.map((k, j) => {
    if (mask && !mask[i][j]) return -1e9;
    return q.reduce((s, x, t) => s + x * k[t], 0) / Math.sqrt(d);
  })));
  const out = weights.map((w) => V[0].map((_, c) => w.reduce((s, wj, j) => s + wj * V[j][c], 0)));
  return { out, weights };
}
export const positionalEncoding = (pos, d) =>
  Array.from({ length: d }, (_, i) => (i % 2 === 0 ? Math.sin : Math.cos)(pos / 10000 ** ((2 * Math.floor(i / 2)) / d)));

// ---------- reinforcement learning on grid worlds ----------
// world: { W, H, walls:Set('x,y'), rewards: Map('x,y' -> r), terminal: Set('x,y') }
export const ACTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up right down left
export function gridStep(world, s, a, slip = 0, rand = Math.random) {
  if (slip > 0 && rand() < slip) a = (a + (rand() < 0.5 ? 1 : 3)) % 4;
  const [dx, dy] = ACTIONS[a];
  let nx = s[0] + dx, ny = s[1] + dy;
  if (nx < 0 || ny < 0 || nx >= world.W || ny >= world.H || world.walls.has(`${nx},${ny}`)) { nx = s[0]; ny = s[1]; }
  const k = `${nx},${ny}`;
  return { s: [nx, ny], r: (world.rewards.get(k) ?? 0) + (world.stepCost ?? -0.01), done: world.terminal.has(k) };
}

// One sweep of value iteration (Bellman optimality backup). Returns new V and max change.
export function valueIterationSweep(world, V, gamma = 0.9, slip = 0) {
  const nV = V.map((r) => r.slice());
  let delta = 0;
  for (let y = 0; y < world.H; y++)
    for (let x = 0; x < world.W; x++) {
      const k = `${x},${y}`;
      if (world.walls.has(k) || world.terminal.has(k)) continue;
      let best = -Infinity;
      for (let a = 0; a < 4; a++) {
        const outcomes = slip > 0 ? [[a, 1 - slip], [(a + 1) % 4, slip / 2], [(a + 3) % 4, slip / 2]] : [[a, 1]];
        let q = 0;
        for (const [aa, p] of outcomes) {
          const st = gridStep(world, [x, y], aa);
          const term = world.terminal.has(`${st.s[0]},${st.s[1]}`);
          q += p * (st.r + (term ? 0 : gamma * V[st.s[1]][st.s[0]]));
        }
        best = Math.max(best, q);
      }
      delta = Math.max(delta, Math.abs(best - V[y][x]));
      nV[y][x] = best;
    }
  return { V: nV, delta };
}

// argmax that breaks ties at random, so untrained agents don't all drift the same way.
export function argmaxRandomTie(xs, rand = Math.random) {
  const m = Math.max(...xs);
  const best = xs.map((x, i) => (x === m ? i : -1)).filter((i) => i >= 0);
  return best[Math.floor(rand() * best.length)];
}

export function qLearningEpisode(world, Q, { start, alpha = 0.3, gamma = 0.9, eps = 0.1, maxSteps = 100, rand = Math.random, slip = 0 }) {
  let s = start.slice();
  const trail = [s.slice()];
  let ret = 0;
  for (let t = 0; t < maxSteps; t++) {
    const qs = Q[s[1]][s[0]];
    const a = rand() < eps ? Math.floor(rand() * 4) : argmaxRandomTie(qs, rand);
    const st = gridStep(world, s, a, slip, rand);
    const target = st.r + (st.done ? 0 : gamma * Math.max(...Q[st.s[1]][st.s[0]]));
    qs[a] += alpha * (target - qs[a]);
    ret += st.r;
    s = st.s;
    trail.push(s.slice());
    if (st.done) break;
  }
  return { trail, ret };
}

// ---------- Gaussian process regression (RBF kernel) ----------
export const rbf = (a, b, ell = 1, sf = 1) => sf * sf * Math.exp(-((a - b) ** 2) / (2 * ell * ell));
export function gpPosterior(X, Y, Xs, { ell = 1, sf = 1, sn = 0.1 } = {}) {
  const n = X.length;
  if (n === 0) return { mu: Xs.map(() => 0), sd: Xs.map(() => sf) };
  const K = X.map((a, i) => X.map((b, j) => rbf(a, b, ell, sf) + (i === j ? sn * sn : 0)));
  const L = cholesky(K);
  // α = K⁻¹ y via two triangular solves.
  const fwd = (Lm, b) => { const x = []; for (let i = 0; i < b.length; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= Lm[i][k] * x[k]; x.push(s / Lm[i][i]); } return x; };
  const bwd = (Lm, b) => { const n2 = b.length, x = new Array(n2); for (let i = n2 - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n2; k++) s -= Lm[k][i] * x[k]; x[i] = s / Lm[i][i]; } return x; };
  const alpha = bwd(L, fwd(L, Y));
  const mu = [], sd = [];
  for (const xs of Xs) {
    const ks = X.map((a) => rbf(a, xs, ell, sf));
    mu.push(ks.reduce((s, k, i) => s + k * alpha[i], 0));
    const v = fwd(L, ks);
    sd.push(Math.sqrt(Math.max(sf * sf - v.reduce((s, x) => s + x * x, 0), 1e-12)));
  }
  return { mu, sd };
}

// ---------- Gaussian mixture via EM (2D) ----------
export function gmmInit(points, k, seed = 2) {
  const r = makeRng(seed);
  const C = covariance(points);
  return {
    pi: new Array(k).fill(1 / k),
    mu: Array.from({ length: k }, () => points[r.int(0, points.length)].slice()),
    S: Array.from({ length: k }, () => C.map((row) => row.map((x) => x / k))),
  };
}
function gaussPdf2(x, mu, S) {
  const d = vsub(x, mu), Si = inv(S), D = det(S);
  if (!Si || D <= 0) return 1e-300;
  const m = d[0] * (Si[0][0] * d[0] + Si[0][1] * d[1]) + d[1] * (Si[1][0] * d[0] + Si[1][1] * d[1]);
  return Math.exp(-0.5 * m) / (2 * Math.PI * Math.sqrt(D));
}
export function gmmStep(points, model) {
  const k = model.pi.length;
  const resp = points.map((x) => {
    const p = model.pi.map((pi, j) => pi * gaussPdf2(x, model.mu[j], model.S[j]));
    const s = p.reduce((a, b) => a + b, 0) || 1e-300;
    return p.map((v) => v / s);
  });
  const Nk = Array.from({ length: k }, (_, j) => resp.reduce((s, r) => s + r[j], 0) + 1e-9);
  const mu = Nk.map((n, j) => [0, 1].map((d) => resp.reduce((s, r, i) => s + r[j] * points[i][d], 0) / n));
  const S = Nk.map((n, j) => {
    const C = zeros(2);
    points.forEach((p, i) => {
      const dx = p[0] - mu[j][0], dy = p[1] - mu[j][1], w = resp[i][j];
      C[0][0] += w * dx * dx; C[0][1] += w * dx * dy; C[1][1] += w * dy * dy;
    });
    C[1][0] = C[0][1];
    return C.map((row, a) => row.map((v, b) => v / n + (a === b ? 1e-4 : 0)));
  });
  const ll = points.reduce((s, x) => s + Math.log(model.pi.reduce((t, pi, j) => t + pi * gaussPdf2(x, model.mu[j], model.S[j]), 0) + 1e-300), 0);
  return { pi: Nk.map((n) => n / points.length), mu, S, resp, ll };
}

// ---------- k-means ----------
export function kmeansStep(points, centers) {
  const assign = points.map((p) => {
    let b = 0, bd = Infinity;
    centers.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < bd) { bd = d; b = j; } });
    return b;
  });
  const nc = centers.map((c, j) => {
    const mine = points.filter((_, i) => assign[i] === j);
    return mine.length ? mean(mine) : c;
  });
  return { centers: nc, assign };
}

// ---------- PCA ----------
export function pca(points) {
  const mu = mean(points);
  const { values, vectors } = symEig(covariance(points, mu));
  return { mean: mu, variances: values, components: T(vectors) }; // components as rows
}

// ---------- dynamic movement primitives (1 DoF, discrete) ----------
// τ ÿ = α(β(g − y) − ẏ) + f(x) (g − y0);  τ ẋ = −a_x x
export class DMP {
  constructor({ nBasis = 20, alpha = 25, beta = 6.25, ax = 4 } = {}) {
    Object.assign(this, { nBasis, alpha, beta, ax });
    this.c = Array.from({ length: nBasis }, (_, i) => Math.exp((-ax * i) / (nBasis - 1)));
    this.h = this.c.map((c, i) => 1 / ((this.c[i + 1] ?? c * 0.6) - c) ** 2);
    this.w = new Array(nBasis).fill(0);
  }
  psi(x) { return this.c.map((c, i) => Math.exp(-this.h[i] * (x - c) ** 2)); }
  forcing(x) {
    const p = this.psi(x), s = p.reduce((a, b) => a + b, 0) + 1e-10;
    return (p.reduce((a, pi, i) => a + pi * this.w[i], 0) / s) * x;
  }
  // Learn weights from a demo y(t) sampled uniformly over duration tau (locally weighted regression).
  fit(demo, tau = 1) {
    const n = demo.length, dt = tau / (n - 1);
    const y0 = demo[0], g = demo[n - 1];
    this.y0 = y0; this.g = g; this.tau = tau;
    const yd = demo.map((_, i) => (demo[Math.min(i + 1, n - 1)] - demo[Math.max(i - 1, 0)]) / ((i === 0 || i === n - 1 ? 1 : 2) * dt));
    const ydd = yd.map((_, i) => (yd[Math.min(i + 1, n - 1)] - yd[Math.max(i - 1, 0)]) / ((i === 0 || i === n - 1 ? 1 : 2) * dt));
    const xs = demo.map((_, i) => Math.exp((-this.ax * i * dt) / tau));
    const fTarget = demo.map((y, i) => tau * tau * ydd[i] - this.alpha * (this.beta * (g - y) - tau * yd[i]));
    const scale = g - y0 || 1;
    this.w = this.c.map((_, b) => {
      let num = 0, den = 0;
      xs.forEach((x, i) => {
        const p = Math.exp(-this.h[b] * (x - this.c[b]) ** 2);
        num += p * x * fTarget[i] / scale;
        den += p * x * x;
      });
      return num / (den + 1e-10);
    });
    return this;
  }
  // Roll out to a (possibly new) goal. Returns array of y.
  rollout({ y0 = this.y0, g = this.g, tau = this.tau, steps = 200, push = null } = {}) {
    const dt = tau / steps;
    let y = y0, v = 0, x = 1;
    const out = [y];
    for (let k = 0; k < steps * 1.3; k++) {
      const f = this.forcing(x) * (g - y0);
      const vd = (this.alpha * (this.beta * (g - y) - v) + f) / tau;
      v += vd * dt;
      if (push) v += push(k * dt) * dt;
      y += (v / tau) * dt;
      x += ((-this.ax * x) / tau) * dt;
      out.push(y);
    }
    return out;
  }
}

// ---------- diffusion & flow matching on toy 2D data ----------
export function linearBetaSchedule(T = 100, b0 = 1e-4, b1 = 0.05) {
  const beta = Array.from({ length: T }, (_, t) => b0 + ((b1 - b0) * t) / (T - 1));
  const alphaBar = [];
  let p = 1;
  for (const b of beta) { p *= 1 - b; alphaBar.push(p); }
  return { beta, alphaBar, T };
}
// q(x_t | x_0) = N(√ᾱ x0, (1−ᾱ) I)
export const forwardNoise = (x0, abar, eps) => x0.map((x, i) => Math.sqrt(abar) * x + Math.sqrt(1 - abar) * eps[i]);

// Exact score ∇log p_t(x) for a mixture of isotropic Gaussians that has been diffused to level ᾱ.
export function mixtureScore(x, centers, sigma0, abar) {
  const s2 = abar * sigma0 * sigma0 + (1 - abar);
  const logw = centers.map((c) => -((x[0] - Math.sqrt(abar) * c[0]) ** 2 + (x[1] - Math.sqrt(abar) * c[1]) ** 2) / (2 * s2));
  const w = softmax(logw);
  return [0, 1].map((d) => w.reduce((s, wi, i) => s + (wi * (Math.sqrt(abar) * centers[i][d] - x[d])) / s2, 0));
}

// Flow matching (rectified flow) target velocity along a straight path x_t = (1−t) x0 + t x1.
export const flowTarget = (x0, x1) => x1.map((v, i) => v - x0[i]);

// Cross-entropy method: one iteration on a cost function over R^d.
export function cemStep(cost, mu, sigma, { n = 40, elite = 8, rand }) {
  const samples = Array.from({ length: n }, () => mu.map((m, i) => rand.normal(m, sigma[i])));
  const scored = samples.map((s) => ({ s, c: cost(s) })).sort((a, b) => a.c - b.c);
  const el = scored.slice(0, elite).map((o) => o.s);
  const nmu = mu.map((_, i) => el.reduce((a, s) => a + s[i], 0) / elite);
  const nsig = mu.map((_, i) => Math.sqrt(el.reduce((a, s) => a + (s[i] - nmu[i]) ** 2, 0) / elite) + 1e-3);
  return { mu: nmu, sigma: nsig, samples: scored, elite: el };
}

export { mvec };
