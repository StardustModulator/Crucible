// State estimation & registration: Gaussians, Kalman/EKF, particle filters,
// least squares, Kabsch/SVD registration, ICP, RANSAC, occupancy grids.
import {
  mmul, mvec, T, inv, madd, msub, eye, vsub, vadd, vscale, vnorm, svd, det, mean, zeros, outer, mscale,
} from './linalg.js';
import { rng as makeRng } from './random.js';

export const gauss1 = (x, mu, sigma) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));

export function gaussN(x, mu, S) {
  const d = vsub(x, mu), Si = inv(S);
  const m = d.reduce((s, di, i) => s + di * Si[i].reduce((t, sij, j) => t + sij * d[j], 0), 0);
  return Math.exp(-0.5 * m) / Math.sqrt((2 * Math.PI) ** mu.length * det(S));
}

// Product of two 1D Gaussians (the heart of the Kalman update).
export function fuse1(mu1, var1, mu2, var2) {
  const k = var1 / (var1 + var2);
  return { mu: mu1 + k * (mu2 - mu1), var: (1 - k) * var1, k };
}

// Linear Kalman filter.
export class KalmanFilter {
  constructor({ x, P, F, B = null, H, Q, R }) { Object.assign(this, { x, P, F, B, H, Q, R }); }
  predict(u = null) {
    this.x = mvec(this.F, this.x);
    if (this.B && u) this.x = vadd(this.x, mvec(this.B, u));
    this.P = madd(mmul(mmul(this.F, this.P), T(this.F)), this.Q);
    return this;
  }
  update(z) {
    const y = vsub(z, mvec(this.H, this.x));
    const S = madd(mmul(mmul(this.H, this.P), T(this.H)), this.R);
    const K = mmul(mmul(this.P, T(this.H)), inv(S));
    this.x = vadd(this.x, mvec(K, y));
    this.P = mmul(msub(eye(this.x.length), mmul(K, this.H)), this.P);
    this.K = K; this.innovation = y; this.S = S;
    return this;
  }
}

// Extended Kalman filter: f, h are nonlinear; F(x,u), H(x) return Jacobians.
export class EKF {
  constructor({ x, P, f, F, h, H, Q, R }) { Object.assign(this, { x, P, f, F, h, H, Q, R }); }
  predict(u) {
    const Fj = this.F(this.x, u);
    this.x = this.f(this.x, u);
    this.P = madd(mmul(mmul(Fj, this.P), T(Fj)), typeof this.Q === 'function' ? this.Q(this.x, u) : this.Q);
    return this;
  }
  update(z, h = this.h, H = this.H, R = this.R, wrap = null) {
    const Hj = H(this.x);
    let y = vsub(z, h(this.x));
    if (wrap) y = wrap(y);
    const S = madd(mmul(mmul(Hj, this.P), T(Hj)), R);
    const K = mmul(mmul(this.P, T(Hj)), inv(S));
    this.x = vadd(this.x, mvec(K, y));
    this.P = mmul(msub(eye(this.x.length), mmul(K, Hj)), this.P);
    return this;
  }
}

// Low-variance (systematic) resampling. weights need not be normalized.
export function systematicResample(particles, weights, rand = Math.random) {
  const n = particles.length;
  const W = weights.reduce((a, b) => a + b, 0) || 1;
  const out = [];
  const step = W / n;
  let u = rand() * step, c = weights[0], i = 0;
  for (let m = 0; m < n; m++) {
    while (u > c && i < n - 1) { i++; c += weights[i]; }
    out.push(structuredClone(particles[i]));
    u += step;
  }
  return out;
}

export const effectiveSampleSize = (w) => {
  const s = w.reduce((a, b) => a + b, 0);
  return s * s / w.reduce((a, b) => a + b * b, 0);
};

// Best-fit rotation + translation mapping points P onto Q (Kabsch / Arun via SVD).
// Works in 2D or 3D. Returns { R, t } with Q ≈ R P + t.
export function kabsch(P, Q) {
  const mp = mean(P), mq = mean(Q);
  const d = mp.length;
  let H = zeros(d);
  for (let i = 0; i < P.length; i++) H = madd(H, outer(vsub(P[i], mp), vsub(Q[i], mq)));
  const { U, V } = svd(H);
  let R = mmul(V, T(U));
  if (det(R) < 0) {
    const D = eye(d); D[d - 1][d - 1] = -1;
    R = mmul(mmul(V, D), T(U));
  }
  const t = vsub(mq, mvec(R, mp));
  return { R, t, H };
}

// One ICP iteration (brute-force nearest neighbours). Returns new source points + transform.
export function icpStep(src, dst) {
  const pairs = src.map((p) => {
    let best = 0, bd = Infinity;
    for (let j = 0; j < dst.length; j++) {
      const dx = dst[j][0] - p[0], dy = dst[j][1] - p[1], dz = (dst[j][2] ?? 0) - (p[2] ?? 0);
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < bd) { bd = dd; best = j; }
    }
    return { j: best, d: Math.sqrt(bd) };
  });
  const matched = pairs.map((p) => dst[p.j]);
  const { R, t } = kabsch(src, matched);
  const moved = src.map((p) => vadd(mvec(R, p), t));
  const err = pairs.reduce((s, p) => s + p.d * p.d, 0) / pairs.length;
  return { points: moved, R, t, pairs, err };
}

// Total-least-squares line through points: returns { point, dir, normal }.
export function fitLineTLS(pts) {
  const m = mean(pts);
  let C = zeros(2);
  for (const p of pts) C = madd(C, outer(vsub(p, m), vsub(p, m)));
  const { U } = svd(C);
  return { point: m, dir: [U[0][0], U[1][0]], normal: [U[0][1], U[1][1]] };
}

// Ordinary least-squares y = a x + b.
export function fitLineOLS(pts) {
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1e-12);
  return { a, b: (sy - a * sx) / n };
}

// RANSAC line fit. Returns best model + inlier mask + the history of hypotheses.
export function ransacLine(pts, { iters = 60, thresh = 0.15, seed = 3 } = {}) {
  const r = makeRng(seed);
  let best = { inliers: [], model: null };
  const history = [];
  for (let k = 0; k < iters; k++) {
    const i = r.int(0, pts.length);
    let j = r.int(0, pts.length);
    if (j === i) j = (j + 1) % pts.length;
    const p = pts[i], q = pts[j];
    const dir = vsub(q, p), L = vnorm(dir);
    if (L < 1e-9) continue;
    const n = [-dir[1] / L, dir[0] / L];
    const inl = pts.map((s) => Math.abs((s[0] - p[0]) * n[0] + (s[1] - p[1]) * n[1]) < thresh);
    const count = inl.filter(Boolean).length;
    history.push({ p, q, count, inliers: inl });
    if (count > best.inliers.filter(Boolean).length) best = { inliers: inl, model: { p, q } };
  }
  return { ...best, history };
}

// RANSAC iterations needed: N = log(1-p) / log(1 - w^s).
export const ransacIterations = (p, w, s) => Math.ceil(Math.log(1 - p) / Math.log(1 - w ** s));

// Occupancy grid log-odds update helpers.
export const logit = (p) => Math.log(p / (1 - p));
export const unlogit = (l) => 1 / (1 + Math.exp(-l));

// Bresenham ray between two cells.
export function rayCells(x0, y0, x1, y1) {
  const cells = [];
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return cells;
}

// Pinhole camera: project 3D point (camera frame) to pixels with intrinsics K.
export function project(K, p) {
  if (p[2] <= 1e-9) return null;
  return [K[0][0] * p[0] / p[2] + K[0][2], K[1][1] * p[1] / p[2] + K[1][2]];
}

// Sample covariance-weighted ellipse points (for drawing a 2D Gaussian).
export function sigmaPoints2(mu, S, k = 1, n = 48) {
  const { U, S: sv } = svd(S);
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    const v = [Math.cos(a) * k * Math.sqrt(sv[0]), Math.sin(a) * k * Math.sqrt(sv[1])];
    return vadd(mu, mvec(U, v));
  });
}
export { mscale, vscale };
