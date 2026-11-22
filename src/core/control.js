// Feedback control: PID, LQR, trajectory generation, discretization.
import { mmul, madd, msub, T, inv, eye, mscale, zeros, fnorm, eig2 } from './linalg.js';

export class PID {
  constructor(kp = 1, ki = 0, kd = 0, { iLimit = Infinity } = {}) {
    Object.assign(this, { kp, ki, kd, iLimit });
    this.reset();
  }
  reset() { this.i = 0; this.prev = null; }
  // Derivative on measurement avoids "kicks" when the setpoint jumps.
  step(target, measured, dt) {
    const e = target - measured;
    this.i = Math.max(-this.iLimit, Math.min(this.iLimit, this.i + e * dt));
    const d = this.prev === null ? 0 : -(measured - this.prev) / dt;
    this.prev = measured;
    this.terms = { p: this.kp * e, i: this.ki * this.i, d: this.kd * d };
    return this.terms.p + this.terms.i + this.terms.d;
  }
}

// Zero-order-hold style discretization (first-order + second-order terms).
export function discretize(A, B, dt) {
  const n = A.length;
  const Adt = mscale(A, dt);
  const Ad = madd(madd(eye(n), Adt), mscale(mmul(Adt, Adt), 0.5));
  const Bd = mmul(madd(mscale(eye(n), dt), mscale(mmul(A, mscale(eye(n), dt * dt)), 0.5)), B);
  return { Ad, Bd };
}

// Discrete-time LQR via Riccati iteration. Returns gain K (u = −K x) and P.
export function dlqr(Ad, Bd, Q, R, iters = 5000) {
  let P = Q.map((r) => r.slice());
  let K = null;
  for (let k = 0; k < iters; k++) {
    const BtP = mmul(T(Bd), P);
    K = mmul(inv(madd(R, mmul(BtP, Bd))), mmul(BtP, Ad));
    const AmBK = msub(Ad, mmul(Bd, K));
    const Pn = madd(madd(Q, mmul(mmul(T(K), R), K)), mmul(mmul(T(AmBK), P), AmBK));
    const diff = fnorm(msub(Pn, P));
    P = Pn;
    if (diff < 1e-10 * (1 + fnorm(P))) break;
  }
  return { K, P };
}

// Continuous LQR approximated by a fine discretization.
export function lqr(A, B, Q, R, dt = 0.002) {
  const { Ad, Bd } = discretize(A, B, dt);
  return dlqr(Ad, Bd, mscale(Q, dt), mscale(R, dt));
}

// Cubic trajectory with zero start/end velocity: returns s(t), ṡ(t), s̈(t) over [0, Tf].
export function cubic(q0, qf, Tf) {
  const a2 = (3 * (qf - q0)) / Tf ** 2, a3 = (-2 * (qf - q0)) / Tf ** 3;
  return (t) => {
    t = Math.max(0, Math.min(Tf, t));
    return { q: q0 + a2 * t * t + a3 * t ** 3, qd: 2 * a2 * t + 3 * a3 * t * t, qdd: 2 * a2 + 6 * a3 * t };
  };
}

// Quintic with zero start/end velocity and acceleration (smooth jerk-free endpoints).
export function quintic(q0, qf, Tf) {
  const d = qf - q0;
  return (t) => {
    const s = Math.max(0, Math.min(1, t / Tf));
    return {
      q: q0 + d * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5),
      qd: (d * (30 * s ** 2 - 60 * s ** 3 + 30 * s ** 4)) / Tf,
      qdd: (d * (60 * s - 180 * s ** 2 + 120 * s ** 3)) / Tf ** 2,
    };
  };
}

// Trapezoidal velocity profile.
export function trapezoid(q0, qf, vmax, amax) {
  const D = Math.abs(qf - q0), sgn = Math.sign(qf - q0) || 1;
  let ta = vmax / amax;
  let Tf;
  if (amax * ta * ta > D) { ta = Math.sqrt(D / amax); vmax = amax * ta; Tf = 2 * ta; }
  else Tf = 2 * ta + (D - amax * ta * ta) / vmax;
  const f = (t) => {
    t = Math.max(0, Math.min(Tf, t));
    let s, v, a;
    if (t < ta) { s = 0.5 * amax * t * t; v = amax * t; a = amax; }
    else if (t < Tf - ta) { s = 0.5 * amax * ta * ta + vmax * (t - ta); v = vmax; a = 0; }
    else { const r = Tf - t; s = D - 0.5 * amax * r * r; v = amax * r; a = -amax; }
    return { q: q0 + sgn * s, qd: sgn * v, qdd: sgn * a };
  };
  f.duration = Tf;
  return f;
}

// Closed-loop poles of a 2nd-order system ẍ + kd ẋ + kp x = 0.
export const secondOrderPoles = (kp, kd) => eig2([[0, 1], [-kp, -kd]]);

// Phase-portrait vector field helper for 2D systems.
export function vectorField(f, xr, yr, n = 15) {
  const out = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = xr[0] + ((xr[1] - xr[0]) * (i + 0.5)) / n;
      const y = yr[0] + ((yr[1] - yr[0]) * (j + 0.5)) / n;
      out.push({ p: [x, y], v: f([x, y]) });
    }
  return out;
}
export { zeros };
