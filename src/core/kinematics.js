// Forward/inverse kinematics, Jacobians, manipulability.
import { mmul, mvec, T, dampedPinv, svd, det, vsub, vnorm, vadd, eye } from './linalg.js';
import { expSE3, adjoint, homog, rotZ, rotX, transOf } from './lie.js';

// ---------- planar serial chain (revolute joints) ----------
// Returns the joint positions [base, j1, ..., tip] and absolute link angles.
export function planarFK(lengths, q, base = [0, 0]) {
  const pts = [base.slice()];
  const angles = [];
  let a = 0, x = base[0], y = base[1];
  for (let i = 0; i < lengths.length; i++) {
    a += q[i];
    x += lengths[i] * Math.cos(a);
    y += lengths[i] * Math.sin(a);
    pts.push([x, y]);
    angles.push(a);
  }
  return { points: pts, angles, tip: pts[pts.length - 1], heading: a };
}

// 2×n positional Jacobian of the tip. Column i = how the tip moves per unit q_i:
// rotate the vector (tip − joint_i) by 90°.
export function planarJacobian(lengths, q, base = [0, 0]) {
  const { points, tip } = planarFK(lengths, q, base);
  const J = [new Array(q.length).fill(0), new Array(q.length).fill(0)];
  for (let i = 0; i < q.length; i++) {
    const r = vsub(tip, points[i]);
    J[0][i] = -r[1];
    J[1][i] = r[0];
  }
  return J;
}

// 3×n Jacobian including the end-effector heading (x, y, φ).
export function planarJacobianFull(lengths, q, base = [0, 0]) {
  const J = planarJacobian(lengths, q, base);
  return [...J, new Array(q.length).fill(1)];
}

// One damped-least-squares IK step toward a target point.
export function planarIKStep(lengths, q, target, { lambda = 0.08, gain = 0.5, base = [0, 0] } = {}) {
  const { tip } = planarFK(lengths, q, base);
  const e = vsub(target, tip);
  const J = planarJacobian(lengths, q, base);
  const dq = mvec(dampedPinv(J, lambda), e.map((x) => x * gain));
  return { q: vadd(q, dq), error: vnorm(e), dq };
}

// Run IK to convergence (or iteration limit). Returns trajectory of q.
export function planarIK(lengths, q0, target, opts = {}) {
  const iters = opts.iters ?? 100;
  const traj = [q0.slice()];
  let q = q0.slice();
  for (let k = 0; k < iters; k++) {
    const r = planarIKStep(lengths, q, target, opts);
    q = r.q;
    traj.push(q.slice());
    if (r.error < (opts.tol ?? 1e-4)) break;
  }
  return traj;
}

// Analytic IK for a 2-link arm (elbow up/down).
export function twoLinkIK(l1, l2, x, y, elbowUp = true) {
  const c2 = (x * x + y * y - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  if (c2 < -1 || c2 > 1) return null;
  const s2 = (elbowUp ? 1 : -1) * Math.sqrt(1 - c2 * c2);
  const q2 = Math.atan2(s2, c2);
  const q1 = Math.atan2(y, x) - Math.atan2(l2 * s2, l1 + l2 * c2);
  return [q1, q2];
}

// Manipulability: Yoshikawa measure + velocity ellipse axes from SVD of J.
export function manipulability(J) {
  const JJt = mmul(J, T(J));
  const { U, S } = svd(J);
  return { w: Math.sqrt(Math.max(det(JJt), 0)), axes: U, radii: S };
}

// ---------- spatial chains: product of exponentials ----------
// screws: list of 6-vector space-frame screw axes; M: home pose (4×4).
export function poeFK(screws, M, q) {
  let Tm = eye(4);
  for (let i = 0; i < screws.length; i++) Tm = mmul(Tm, expSE3(screws[i].map((s) => s * q[i])));
  return mmul(Tm, M);
}

// Intermediate frames (for drawing): pose of each joint's screw "carrier".
export function poeFrames(screws, M, q) {
  const frames = [];
  let Tm = eye(4);
  for (let i = 0; i < screws.length; i++) {
    Tm = mmul(Tm, expSE3(screws[i].map((s) => s * q[i])));
    frames.push(Tm);
  }
  return { frames, end: mmul(Tm, M) };
}

// 6×n space Jacobian: column i = Ad(e^{S1 q1}···e^{S_{i-1} q_{i-1}}) S_i.
export function spaceJacobian(screws, q) {
  const cols = [];
  let Tm = eye(4);
  for (let i = 0; i < screws.length; i++) {
    cols.push(i === 0 ? screws[0].slice() : mvec(adjoint(Tm), screws[i]));
    Tm = mmul(Tm, expSE3(screws[i].map((s) => s * q[i])));
  }
  return T(cols);
}

// ---------- Denavit–Hartenberg (classic) ----------
// Each row {theta, d, a, alpha}. A_i = Rz(θ) Tz(d) Tx(a) Rx(α).
export function dhTransform({ theta, d, a, alpha }) {
  const Rz = homog(rotZ(theta), [0, 0, d]);
  const Rx = homog(rotX(alpha), [a, 0, 0]);
  return mmul(Rz, Rx);
}
export function dhChain(rows) {
  const frames = [eye(4)];
  let Tm = eye(4);
  for (const r of rows) { Tm = mmul(Tm, dhTransform(r)); frames.push(Tm); }
  return { frames, end: Tm, points: frames.map(transOf) };
}
