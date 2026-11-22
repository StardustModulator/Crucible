// Linear algebra kernel. Vectors are plain arrays, matrices are arrays of rows.
// Everything here is small-dimensional (robot arms, filters, tiny networks),
// so clarity beats raw speed.

// ---------- vectors ----------
export const vadd = (a, b) => a.map((x, i) => x + b[i]);
export const vsub = (a, b) => a.map((x, i) => x - b[i]);
export const vscale = (a, s) => a.map((x) => x * s);
export const vdot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const vnorm = (a) => Math.sqrt(vdot(a, a));
export const vnormalize = (a) => { const n = vnorm(a); return n < 1e-12 ? a.map(() => 0) : vscale(a, 1 / n); };
export const vlerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
export const vdist = (a, b) => vnorm(vsub(a, b));
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
export const rot2 = (th) => [[Math.cos(th), -Math.sin(th)], [Math.sin(th), Math.cos(th)]];

// ---------- matrices ----------
export const zeros = (r, c = r) => Array.from({ length: r }, () => new Array(c).fill(0));
export const eye = (n) => { const I = zeros(n); for (let i = 0; i < n; i++) I[i][i] = 1; return I; };
export const diag = (d) => { const D = zeros(d.length); d.forEach((x, i) => (D[i][i] = x)); return D; };
export const clone = (A) => A.map((r) => r.slice());
export const shape = (A) => [A.length, A[0]?.length ?? 0];
export const T = (A) => A[0].map((_, j) => A.map((r) => r[j]));
export const madd = (A, B) => A.map((r, i) => r.map((x, j) => x + B[i][j]));
export const msub = (A, B) => A.map((r, i) => r.map((x, j) => x - B[i][j]));
export const mscale = (A, s) => A.map((r) => r.map((x) => x * s));
export const mvec = (A, v) => A.map((r) => vdot(r, v));
export const outer = (a, b) => a.map((x) => b.map((y) => x * y));
export const trace = (A) => A.reduce((s, r, i) => s + r[i], 0);
export const col = (A, j) => A.map((r) => r[j]);
export const fnorm = (A) => Math.sqrt(A.reduce((s, r) => s + r.reduce((t, x) => t + x * x, 0), 0));

export function mmul(A, B) {
  const n = A.length, m = B[0].length, k = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++)
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      for (let j = 0; j < m; j++) C[i][j] += a * B[p][j];
    }
  return C;
}
export const mchain = (...Ms) => Ms.reduce((acc, M) => mmul(acc, M));

// LU-free Gauss-Jordan with partial pivoting. Returns null if singular.
export function inv(A) {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...eye(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r.slice(n));
}

export function solve(A, b) {
  const Ai = inv(A);
  return Ai ? mvec(Ai, b) : null;
}

export function det(A) {
  const n = A.length;
  if (n === 1) return A[0][0];
  if (n === 2) return A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const M = clone(A);
  let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return 0;
    if (p !== c) { [M[c], M[p]] = [M[p], M[c]]; d = -d; }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j < n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return d;
}

// Cholesky: A = L Lᵀ for symmetric positive definite A. Returns null otherwise.
export function cholesky(A) {
  const n = A.length;
  const L = zeros(n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  return L;
}

// Symmetric eigen-decomposition (cyclic Jacobi). Returns {values, vectors}
// with vectors as COLUMNS of an orthonormal matrix, sorted by value descending.
export function symEig(S, sweeps = 60) {
  const n = S.length;
  const A = clone(S);
  const V = eye(n);
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const idx = [...Array(n).keys()].sort((i, j) => A[j][j] - A[i][i]);
  return {
    values: idx.map((i) => A[i][i]),
    vectors: V.map((row) => idx.map((i) => row[i])),
  };
}

// Eigenvalues of a general 2x2 (may be complex): returns [{re, im}, {re, im}].
export function eig2(A) {
  const tr = A[0][0] + A[1][1];
  const d = det(A);
  const disc = tr * tr / 4 - d;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    return [{ re: tr / 2 + s, im: 0 }, { re: tr / 2 - s, im: 0 }];
  }
  const s = Math.sqrt(-disc);
  return [{ re: tr / 2, im: s }, { re: tr / 2, im: -s }];
}

// Real eigenvectors of a 2x2 for a real eigenvalue lambda.
export function eigvec2(A, lambda) {
  const a = A[0][0] - lambda, b = A[0][1], c = A[1][0], d = A[1][1] - lambda;
  let v = Math.abs(b) + Math.abs(a) > Math.abs(c) + Math.abs(d) ? [-b, a] : [-d, c];
  if (vnorm(v) < 1e-12) v = [1, 0];
  return vnormalize(v);
}

// Singular value decomposition A = U Σ Vᵀ via one-sided Jacobi.
// A is m×n. Returns { U (m×k), S (k), V (n×k) } with k = min(m, n), S descending.
export function svd(A) {
  const [m, n] = shape(A);
  if (m < n) {
    const r = svd(T(A));
    return { U: r.V, S: r.S, V: r.U };
  }
  const U = clone(A);
  const V = eye(n);
  for (let sweep = 0; sweep < 80; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        let alpha = 0, beta = 0, gamma = 0;
        for (let i = 0; i < m; i++) {
          alpha += U[i][p] * U[i][p];
          beta += U[i][q] * U[i][q];
          gamma += U[i][p] * U[i][q];
        }
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta) || Math.abs(gamma) < 1e-300) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < m; i++) {
          const up = U[i][p], uq = U[i][q];
          U[i][p] = c * up - s * uq;
          U[i][q] = s * up + c * uq;
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i][p], vq = V[i][q];
          V[i][p] = c * vp - s * vq;
          V[i][q] = s * vp + c * vq;
        }
      }
    if (!rotated) break;
  }
  const S = [];
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += U[i][j] * U[i][j];
    s = Math.sqrt(s);
    S.push(s);
    for (let i = 0; i < m; i++) U[i][j] = s > 1e-14 ? U[i][j] / s : 0;
  }
  // Fill any zero-singular columns of U with an orthonormal completion.
  for (let j = 0; j < n; j++) {
    if (S[j] > 1e-14) continue;
    for (let e = 0; e < m; e++) {
      let v = new Array(m).fill(0); v[e] = 1;
      for (let k = 0; k < n; k++) {
        if (k === j || (S[k] <= 1e-14 && k > j)) continue;
        const ck = col(U, k), d = vdot(v, ck);
        v = vsub(v, vscale(ck, d));
      }
      if (vnorm(v) > 1e-6) { v = vnormalize(v); for (let i = 0; i < m; i++) U[i][j] = v[i]; break; }
    }
  }
  const idx = [...Array(n).keys()].sort((i, j) => S[j] - S[i]);
  return {
    U: U.map((r) => idx.map((j) => r[j])),
    S: idx.map((j) => S[j]),
    V: V.map((r) => idx.map((j) => r[j])),
  };
}

// Moore–Penrose pseudo-inverse via SVD.
export function pinv(A, tol = 1e-9) {
  const { U, S, V } = svd(A);
  const Sinv = S.map((s) => (s > tol ? 1 / s : 0));
  return mmul(V.map((r) => r.map((x, j) => x * Sinv[j])), T(U));
}

// Damped least-squares inverse: Jᵀ (J Jᵀ + λ² I)⁻¹ — stays finite at singularities.
export function dampedPinv(J, lambda = 0.05) {
  const JJt = mmul(J, T(J));
  const n = JJt.length;
  for (let i = 0; i < n; i++) JJt[i][i] += lambda * lambda;
  return mmul(T(J), inv(JJt));
}

// Ordinary least squares: argmin ||A x - b||².
export const lstsq = (A, b) => mvec(pinv(A), b);

// 2D covariance ellipse: returns {rx, ry, angle} for the k-sigma contour.
export function covEllipse(S, k = 1) {
  const { values, vectors } = symEig(S);
  return {
    rx: k * Math.sqrt(Math.max(values[0], 0)),
    ry: k * Math.sqrt(Math.max(values[1], 0)),
    angle: Math.atan2(vectors[1][0], vectors[0][0]),
  };
}

export function mean(points) {
  const d = points[0].length;
  const m = new Array(d).fill(0);
  for (const p of points) for (let i = 0; i < d; i++) m[i] += p[i];
  return m.map((x) => x / points.length);
}

export function covariance(points, mu = mean(points)) {
  const d = mu.length;
  const C = zeros(d);
  for (const p of points) {
    const r = vsub(p, mu);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) C[i][j] += r[i] * r[j];
  }
  return mscale(C, 1 / Math.max(points.length - 1, 1));
}
