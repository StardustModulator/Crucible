// Rigid-body dynamics for small systems + numerical integration.
import { inv, mvec, vadd, vscale, vsub } from './linalg.js';

// Classic RK4 for state x' = f(t, x). x is an array.
export function rk4(f, t, x, h) {
  const k1 = f(t, x);
  const k2 = f(t + h / 2, vadd(x, vscale(k1, h / 2)));
  const k3 = f(t + h / 2, vadd(x, vscale(k2, h / 2)));
  const k4 = f(t + h, vadd(x, vscale(k3, h)));
  return vadd(x, vscale(vadd(vadd(k1, vscale(k2, 2)), vadd(vscale(k3, 2), k4)), h / 6));
}
export const eulerStep = (f, t, x, h) => vadd(x, vscale(f(t, x), h));
export function semiImplicitEuler(acc, q, qd, h) {
  const qdd = acc(q, qd);
  const qd2 = vadd(qd, vscale(qdd, h));
  return { q: vadd(q, vscale(qd2, h)), qd: qd2 };
}

// ---------- simple pendulum: θ'' = -(g/l) sin θ - b θ' + τ/(m l²) ----------
export const pendulum = { m: 1, l: 1, g: 9.81, b: 0 };
export function pendulumDeriv(p = pendulum, tau = () => 0) {
  return (t, [th, om]) => [om, -(p.g / p.l) * Math.sin(th) - p.b * om + tau(t, th, om) / (p.m * p.l * p.l)];
}
export function pendulumEnergy(p, th, om) {
  const KE = 0.5 * p.m * p.l * p.l * om * om;
  const PE = p.m * p.g * p.l * (1 - Math.cos(th));
  return { KE, PE, E: KE + PE };
}

// ---------- 2-link planar arm (angles measured from +x, gravity along -y) ----------
export const twoLink = {
  m1: 1, m2: 1, l1: 1, l2: 1, lc1: 0.5, lc2: 0.5, I1: 1 / 12, I2: 1 / 12, g: 9.81,
};

// Mass matrix M(q) from the Euler–Lagrange equations.
export function twoLinkM(p, q) {
  const c2 = Math.cos(q[1]);
  const a = p.I1 + p.I2 + p.m1 * p.lc1 ** 2 + p.m2 * (p.l1 ** 2 + p.lc2 ** 2 + 2 * p.l1 * p.lc2 * c2);
  const b = p.I2 + p.m2 * (p.lc2 ** 2 + p.l1 * p.lc2 * c2);
  const d = p.I2 + p.m2 * p.lc2 ** 2;
  return [[a, b], [b, d]];
}

// Coriolis/centrifugal matrix C(q, q̇) built from Christoffel symbols (Ṁ − 2C skew).
export function twoLinkC(p, q, qd) {
  const h = -p.m2 * p.l1 * p.lc2 * Math.sin(q[1]);
  return [[h * qd[1], h * (qd[0] + qd[1])], [-h * qd[0], 0]];
}

// Gravity vector g(q) = ∂V/∂q.
export function twoLinkG(p, q) {
  const g1 = (p.m1 * p.lc1 + p.m2 * p.l1) * p.g * Math.cos(q[0]) + p.m2 * p.lc2 * p.g * Math.cos(q[0] + q[1]);
  const g2 = p.m2 * p.lc2 * p.g * Math.cos(q[0] + q[1]);
  return [g1, g2];
}

// Forward dynamics: q̈ = M⁻¹ (τ − C q̇ − g − b q̇).
export function twoLinkAccel(p, q, qd, tau = [0, 0], damping = 0) {
  const M = twoLinkM(p, q), C = twoLinkC(p, q, qd), G = twoLinkG(p, q);
  const rhs = vsub(vsub(vsub(tau, mvec(C, qd)), G), vscale(qd, damping));
  return mvec(inv(M), rhs);
}

// Inverse dynamics: τ = M q̈ + C q̇ + g.
export function twoLinkTau(p, q, qd, qdd) {
  return vadd(vadd(mvec(twoLinkM(p, q), qdd), mvec(twoLinkC(p, q, qd), qd)), twoLinkG(p, q));
}

export function twoLinkEnergy(p, q, qd) {
  const M = twoLinkM(p, q);
  const KE = 0.5 * (qd[0] * (M[0][0] * qd[0] + M[0][1] * qd[1]) + qd[1] * (M[1][0] * qd[0] + M[1][1] * qd[1]));
  const y1 = p.lc1 * Math.sin(q[0]);
  const y2 = p.l1 * Math.sin(q[0]) + p.lc2 * Math.sin(q[0] + q[1]);
  const PE = p.m1 * p.g * y1 + p.m2 * p.g * y2;
  return { KE, PE, E: KE + PE };
}

// State-space derivative for the 2-link arm with a torque law τ(t, q, q̇).
export function twoLinkDeriv(p, tauFn = () => [0, 0], damping = 0) {
  return (t, x) => {
    const q = [x[0], x[1]], qd = [x[2], x[3]];
    const qdd = twoLinkAccel(p, q, qd, tauFn(t, q, qd), damping);
    return [qd[0], qd[1], qdd[0], qdd[1]];
  };
}

// ---------- cart-pole (for linearization / LQR) ----------
export const cartPole = { M: 1, m: 0.3, l: 0.8, g: 9.81 };
// State [x, ẋ, θ, θ̇] with θ = 0 upright. Force u on cart.
export function cartPoleDeriv(p = cartPole, uFn = () => 0) {
  return (t, s) => {
    const [, xd, th, thd] = s;
    const u = uFn(t, s);
    const st = Math.sin(th), ct = Math.cos(th);
    const den = p.M + p.m * st * st;
    const xdd = (u + p.m * st * (p.l * thd * thd - p.g * ct)) / den;
    const thdd = (-u * ct - p.m * p.l * thd * thd * ct * st + (p.M + p.m) * p.g * st) / (p.l * den);
    return [xd, xdd, thd, thdd];
  };
}
// Linearization about the upright equilibrium: ẋ = A x + B u.
export function cartPoleLinear(p = cartPole) {
  const A = [
    [0, 1, 0, 0],
    [0, 0, -p.m * p.g / p.M, 0],
    [0, 0, 0, 1],
    [0, 0, (p.M + p.m) * p.g / (p.M * p.l), 0],
  ];
  const B = [[0], [1 / p.M], [0], [-1 / (p.M * p.l)]];
  return { A, B };
}

// Numerical Jacobian of f: Rⁿ → Rᵐ (central differences). Useful for linearizing anything.
export function numJacobian(f, x, h = 1e-6) {
  const fx = f(x);
  const J = fx.map(() => new Array(x.length).fill(0));
  for (let j = 0; j < x.length; j++) {
    const xp = x.slice(), xm = x.slice();
    xp[j] += h; xm[j] -= h;
    const a = f(xp), b = f(xm);
    for (let i = 0; i < fx.length; i++) J[i][j] = (a[i] - b[i]) / (2 * h);
  }
  return J;
}
