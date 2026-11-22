// Rotations and rigid motions: SO(3), SE(3), quaternions, exponential maps.
import { cross, vnorm, vscale, vadd, mmul, mvec, eye, T, zeros, madd, mscale, trace } from './linalg.js';

// ---------- so(3) ----------
export const hat = (w) => [
  [0, -w[2], w[1]],
  [w[2], 0, -w[0]],
  [-w[1], w[0], 0],
];
export const vee = (W) => [W[2][1], W[0][2], W[1][0]];

// Rodrigues: exp([ω]θ) for an arbitrary rotation vector r = ω θ.
export function expSO3(r) {
  const th = vnorm(r);
  if (th < 1e-12) return madd(eye(3), hat(r));
  const W = hat(vscale(r, 1 / th));
  const W2 = mmul(W, W);
  return madd(madd(eye(3), mscale(W, Math.sin(th))), mscale(W2, 1 - Math.cos(th)));
}

// Matrix log of a rotation → rotation vector (axis * angle), angle in [0, π].
export function logSO3(R) {
  const c = Math.min(1, Math.max(-1, (trace(R) - 1) / 2));
  const th = Math.acos(c);
  if (th < 1e-9) return [0, 0, 0];
  if (Math.PI - th < 1e-6) {
    // Near π: pick the largest diagonal entry for a stable axis.
    let i = 0;
    if (R[1][1] > R[i][i]) i = 1;
    if (R[2][2] > R[i][i]) i = 2;
    const w = [0, 0, 0];
    w[i] = Math.sqrt(Math.max(0, (R[i][i] + 1) / 2));
    for (let j = 0; j < 3; j++) if (j !== i) w[j] = R[i][j] / (2 * w[i]);
    const n = vnorm(w);
    return vscale(w, th / n);
  }
  const W = mscale(madd(R, mscale(T(R), -1)), 1 / (2 * Math.sin(th)));
  return vscale(vee(W), th);
}

export const rotX = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
export const rotY = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
export const rotZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

// ZYX (yaw-pitch-roll) Euler angles.
export const eulerZYX = (yaw, pitch, roll) => mmul(mmul(rotZ(yaw), rotY(pitch)), rotX(roll));

// ---------- quaternions [w, x, y, z] ----------
export const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
export const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
export const qnormalize = (q) => { const n = Math.hypot(...q); return q.map((x) => x / n); };
export function qFromAxisAngle(axis, angle) {
  const n = vnorm(axis) || 1, s = Math.sin(angle / 2) / n;
  return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}
export function qToMat(q) {
  const [w, x, y, z] = qnormalize(q);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}
export function qFromMat(R) {
  const tr = trace(R);
  let q;
  if (tr > 0) {
    const s = 2 * Math.sqrt(tr + 1);
    q = [s / 4, (R[2][1] - R[1][2]) / s, (R[0][2] - R[2][0]) / s, (R[1][0] - R[0][1]) / s];
  } else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
    const s = 2 * Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]);
    q = [(R[2][1] - R[1][2]) / s, s / 4, (R[0][1] + R[1][0]) / s, (R[0][2] + R[2][0]) / s];
  } else if (R[1][1] > R[2][2]) {
    const s = 2 * Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]);
    q = [(R[0][2] - R[2][0]) / s, (R[0][1] + R[1][0]) / s, s / 4, (R[1][2] + R[2][1]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]);
    q = [(R[1][0] - R[0][1]) / s, (R[0][2] + R[2][0]) / s, (R[1][2] + R[2][1]) / s, s / 4];
  }
  return qnormalize(q);
}
export const qRotate = (q, v) => qmul(qmul(q, [0, ...v]), qconj(q)).slice(1);
export function slerp(a, b, t) {
  let d = a.reduce((s, x, i) => s + x * b[i], 0);
  if (d < 0) { b = b.map((x) => -x); d = -d; }
  if (d > 0.9995) return qnormalize(a.map((x, i) => x + t * (b[i] - x)));
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((x, i) => wa * x + wb * b[i]);
}

// ---------- SE(3) as 4×4 homogeneous matrices ----------
export function homog(R, p) {
  return [[...R[0], p[0]], [...R[1], p[1]], [...R[2], p[2]], [0, 0, 0, 1]];
}
export const rotOf = (Tm) => Tm.slice(0, 3).map((r) => r.slice(0, 3));
export const transOf = (Tm) => [Tm[0][3], Tm[1][3], Tm[2][3]];
export function invSE3(Tm) {
  const R = rotOf(Tm), p = transOf(Tm), Rt = T(R);
  return homog(Rt, vscale(mvec(Rt, p), -1));
}
export const applySE3 = (Tm, p) => vadd(mvec(rotOf(Tm), p), transOf(Tm));

// Twist V = [ω; v]. exp of a screw motion (Lynch & Park convention).
export function expSE3(V) {
  const w = V.slice(0, 3), v = V.slice(3, 6);
  const th = vnorm(w);
  if (th < 1e-12) return homog(eye(3), v);
  const wn = vscale(w, 1 / th), vn = vscale(v, 1 / th);
  const W = hat(wn), W2 = mmul(W, W);
  const R = expSO3(w);
  const G = madd(madd(mscale(eye(3), th), mscale(W, 1 - Math.cos(th))), mscale(W2, th - Math.sin(th)));
  return homog(R, mvec(G, vn));
}

export function logSE3(Tm) {
  const R = rotOf(Tm), p = transOf(Tm);
  const r = logSO3(R);
  const th = vnorm(r);
  if (th < 1e-9) return [0, 0, 0, ...p];
  const W = hat(vscale(r, 1 / th)), W2 = mmul(W, W);
  const Ginv = madd(madd(mscale(eye(3), 1 / th), mscale(W, -0.5)),
    mscale(W2, 1 / th - 0.5 / Math.tan(th / 2)));
  return [...r, ...vscale(mvec(Ginv, p), th)];
}

// 6×6 adjoint of T: maps twists between frames.
export function adjoint(Tm) {
  const R = rotOf(Tm), P = hat(transOf(Tm));
  const A = zeros(6);
  const PR = mmul(P, R);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      A[i][j] = R[i][j];
      A[i + 3][j + 3] = R[i][j];
      A[i + 3][j] = PR[i][j];
    }
  return A;
}

// Screw axis from a unit rotation axis ω through point q with pitch h.
// v = -ω × q + hω = q × ω + hω
export const screwAxis = (w, q, h = 0) => [...w, ...vadd(cross(q, w), vscale(w, h))];
export const rotationAngle = (R) => Math.acos(Math.min(1, Math.max(-1, (trace(R) - 1) / 2)));
