import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as la from '../src/core/linalg.js';
import * as lie from '../src/core/lie.js';
import * as kin from '../src/core/kinematics.js';
import * as dyn from '../src/core/dynamics.js';
import * as ctl from '../src/core/control.js';
import * as est from '../src/core/estimation.js';
import * as plan from '../src/core/planning.js';
import * as ml from '../src/core/learning.js';
import { rng } from '../src/core/random.js';

const close = (a, b, tol = 1e-6, msg = '') => {
  const fa = [a].flat(Infinity), fb = [b].flat(Infinity);
  assert.equal(fa.length, fb.length, msg + ' shape');
  fa.forEach((x, i) => assert.ok(Math.abs(x - fb[i]) < tol, `${msg} [${i}] ${x} vs ${fb[i]}`));
};
const randMat = (r, m, n) => Array.from({ length: m }, () => Array.from({ length: n }, () => r.normal()));

test('inverse and determinant', () => {
  const r = rng(1);
  const A = randMat(r, 4, 4);
  close(la.mmul(A, la.inv(A)), la.eye(4), 1e-9);
  close(la.det(la.mmul(A, A)), la.det(A) ** 2, 1e-8);
});

test('symmetric eigen decomposition reconstructs', () => {
  const r = rng(2);
  const B = randMat(r, 5, 5), S = la.mmul(B, la.T(B));
  const { values, vectors } = la.symEig(S);
  close(la.mmul(la.mmul(vectors, la.diag(values)), la.T(vectors)), S, 1e-8);
  for (let i = 1; i < values.length; i++) assert.ok(values[i - 1] >= values[i]);
});

test('SVD reconstructs for tall, wide, and rank-deficient matrices', () => {
  const r = rng(3);
  for (const [m, n] of [[5, 3], [3, 5], [2, 2], [6, 6]]) {
    const A = randMat(r, m, n);
    const { U, S, V } = la.svd(A);
    close(la.mmul(la.mmul(U, la.diag(S)), la.T(V)), A, 1e-8, `svd ${m}x${n}`);
    close(la.mmul(la.T(V), V), la.eye(V[0].length), 1e-8);
  }
  const R1 = la.outer([1, 2, 3], [4, 5, 6]);
  const { S } = la.svd(R1);
  assert.ok(S[1] < 1e-8 && S[2] < 1e-8);
  const P = la.pinv(R1);
  close(la.mmul(la.mmul(R1, P), R1), R1, 1e-8);
});

test('so3 exp/log round trip and quaternion agreement', () => {
  const r = rng(4);
  for (let k = 0; k < 20; k++) {
    const w = [r.normal(), r.normal(), r.normal()];
    const th = la.vnorm(w);
    const wv = th > 3 ? la.vscale(w, 3 / th) : w;
    const R = lie.expSO3(wv);
    close(la.mmul(R, la.T(R)), la.eye(3), 1e-9);
    close(lie.logSO3(R), wv, 1e-7);
    const q = lie.qFromAxisAngle(wv, la.vnorm(wv));
    close(lie.qToMat(q), R, 1e-9);
    const q2 = lie.qFromMat(R);
    close(Math.abs(q2.reduce((s, x, i) => s + x * q[i], 0)), 1, 1e-9);
  }
});

test('se3 exp/log round trip', () => {
  const r = rng(5);
  for (let k = 0; k < 10; k++) {
    const V = [r.normal() * 0.8, r.normal() * 0.8, r.normal() * 0.8, r.normal(), r.normal(), r.normal()];
    close(lie.logSE3(lie.expSE3(V)), V, 1e-6);
  }
});

test('planar Jacobian matches finite differences; IK converges', () => {
  const L = [1, 0.8, 0.5], q = [0.3, -0.7, 1.1];
  const J = kin.planarJacobian(L, q);
  const Jn = dyn.numJacobian((qq) => kin.planarFK(L, qq).tip, q);
  close(J, Jn, 1e-6);
  const traj = kin.planarIK(L, [0.1, 0.1, 0.1], [1.2, 0.9], { iters: 300, lambda: 0.01 });
  close(kin.planarFK(L, traj.at(-1)).tip, [1.2, 0.9], 1e-3);
  const [q1, q2] = kin.twoLinkIK(1, 1, 1.2, 0.5);
  close(kin.planarFK([1, 1], [q1, q2]).tip, [1.2, 0.5], 1e-9);
});

test('space Jacobian matches finite differences of PoE', () => {
  const screws = [
    lie.screwAxis([0, 0, 1], [0, 0, 0]),
    lie.screwAxis([0, 1, 0], [0, 0, 0.5]),
    lie.screwAxis([0, 1, 0], [1, 0, 0.5]),
    lie.screwAxis([1, 0, 0], [1.6, 0, 0.5]),
  ];
  const M = lie.homog(la.eye(3), [1.6, 0, 0.5]);
  const q = [0.4, -0.3, 0.8, 0.2];
  const Js = kin.spaceJacobian(screws, q);
  const h = 1e-6;
  const T0 = kin.poeFK(screws, M, q), T0i = lie.invSE3(T0);
  for (let i = 0; i < q.length; i++) {
    const qp = q.slice(); qp[i] += h;
    const dT = la.mscale(la.msub(kin.poeFK(screws, M, qp), T0), 1 / h);
    const Vs = la.mmul(dT, T0i); // [V_s] = Ṫ T⁻¹
    close([Vs[2][1], Vs[0][2], Vs[1][0], Vs[0][3], Vs[1][3], Vs[2][3]], la.col(Js, i), 1e-4, `col ${i}`);
  }
});

test('2-link dynamics: energy conserved, Ṁ − 2C skew-symmetric, inverse ∘ forward = id', () => {
  const p = dyn.twoLink;
  let x = [0.3, 0.8, 0, 0];
  const E0 = dyn.twoLinkEnergy(p, [x[0], x[1]], [x[2], x[3]]).E;
  const f = dyn.twoLinkDeriv(p);
  for (let k = 0; k < 2000; k++) x = dyn.rk4(f, 0, x, 0.001);
  const E1 = dyn.twoLinkEnergy(p, [x[0], x[1]], [x[2], x[3]]).E;
  assert.ok(Math.abs(E1 - E0) < 1e-6, `energy drift ${E1 - E0}`);
  const q = [0.4, 1.1], qd = [0.7, -1.3];
  const h = 1e-6;
  const Mdot = la.mscale(la.msub(dyn.twoLinkM(p, la.vadd(q, la.vscale(qd, h))), dyn.twoLinkM(p, q)), 1 / h);
  const N = la.msub(Mdot, la.mscale(dyn.twoLinkC(p, q, qd), 2));
  close(la.madd(N, la.T(N)), la.zeros(2), 1e-4);
  const qdd = [0.5, -2];
  const tau = dyn.twoLinkTau(p, q, qd, qdd);
  close(dyn.twoLinkAccel(p, q, qd, tau), qdd, 1e-9);
});

test('LQR stabilizes the linearized cart-pole', () => {
  const { A, B } = dyn.cartPoleLinear();
  const { K } = ctl.lqr(A, B, la.diag([1, 1, 10, 1]), [[0.1]]);
  const Acl = la.msub(A, la.mmul(B, K));
  let x = [0.5, 0, 0.2, 0];
  for (let k = 0; k < 20000; k++) x = la.vadd(x, la.vscale(la.mvec(Acl, x), 0.001));
  assert.ok(la.vnorm(x) < 1e-3, `state ${x}`);
  let s = [0.3, 0, 0.15, 0];
  const f = dyn.cartPoleDeriv(dyn.cartPole, (t, st) => -la.mvec(K, st)[0]);
  for (let k = 0; k < 8000; k++) s = dyn.rk4(f, 0, s, 0.001);
  assert.ok(la.vnorm(s) < 1e-2, `nonlinear state ${s}`);
});

test('trajectories hit endpoints', () => {
  const q = ctl.quintic(1, 3, 2);
  close([q(0).q, q(2).q, q(0).qd, q(2).qd, q(0).qdd, q(2).qdd], [1, 3, 0, 0, 0, 0], 1e-9);
  const tr = ctl.trapezoid(0, 2, 1, 2);
  close(tr(tr.duration).q, 2, 1e-9);
});

test('Kalman filter converges to the truth', () => {
  const r = rng(7);
  const kf = new est.KalmanFilter({ x: [0, 0], P: la.eye(2), F: [[1, 0.1], [0, 1]], H: [[1, 0]], Q: la.mscale(la.eye(2), 1e-4), R: [[0.25]] });
  let truth = [0, 1];
  for (let k = 0; k < 300; k++) {
    truth = [truth[0] + 0.1 * truth[1], truth[1]];
    kf.predict().update([truth[0] + r.normal(0, 0.5)]);
  }
  assert.ok(Math.abs(kf.x[1] - 1) < 0.1);
});

test('Kabsch recovers a rigid transform; ICP converges', () => {
  const r = rng(8);
  const P = Array.from({ length: 30 }, () => [r.normal(), r.normal(), r.normal()]);
  const R = lie.expSO3([0.3, -0.5, 0.9]), t = [1, -2, 0.5];
  const Q = P.map((p) => la.vadd(la.mvec(R, p), t));
  const fit = est.kabsch(P, Q);
  close(fit.R, R, 1e-8); close(fit.t, t, 1e-8);
  const shape = Array.from({ length: 40 }, (_, i) => [Math.cos(i / 6) * (1 + i / 40), Math.sin(i / 6) * 1.5]);
  let src = shape.map((p) => la.vadd(la.mvec(la.rot2(0.25), p), [0.3, -0.2]));
  const e0 = est.icpStep(src, shape).err;
  let prev = Infinity;
  for (let k = 0; k < 40; k++) {
    const s = est.icpStep(src, shape);
    assert.ok(s.err <= prev + 1e-12, 'ICP error must not increase');
    prev = s.err; src = s.points;
  }
  assert.ok(prev < e0 / 10);
});

test('RANSAC finds the line through outliers', () => {
  const r = rng(9);
  const pts = Array.from({ length: 30 }, (_, i) => [i / 10, 0.5 * (i / 10) + 1 + r.normal(0, 0.02)]);
  for (let i = 0; i < 20; i++) pts.push([r.uniform(0, 3), r.uniform(-2, 4)]);
  const { inliers } = est.ransacLine(pts, { iters: 200, thresh: 0.1 });
  assert.ok(inliers.slice(0, 30).filter(Boolean).length >= 28);
});

test('A* finds an optimal path; RRT reaches goal', () => {
  const grid = Array.from({ length: 10 }, (_, y) => Array.from({ length: 10 }, (_, x) => x === 5 && y < 8));
  const a = plan.astar(grid, [0, 0], [9, 0]);
  const d = plan.astar(grid, [0, 0], [9, 0], { heuristic: 'zero' });
  assert.ok(a.path && Math.abs(a.cost - d.cost) < 1e-9);
  assert.ok(a.expanded.length <= d.expanded.length);
  const rrt = new plan.RRT({ start: [0, 0], goal: [4, 4], bounds: [-1, -1, 5, 5], obstacles: [{ c: [2, 2], r: 1 }] });
  for (let k = 0; k < 3000 && !rrt.done; k++) rrt.grow();
  assert.ok(rrt.done);
});

test('MLP learns XOR with backprop + Adam; gradients match finite differences', () => {
  const net = new ml.MLP([2, 6, 1], ['tanh', 'sigmoid'], 3);
  const opt = new ml.Optimizer(net, { lr: 0.05 });
  const X = [[0, 0], [0, 1], [1, 0], [1, 1]], Y = [[0], [1], [1], [0]];
  for (let k = 0; k < 1500; k++) ml.trainBatch(net, opt, X, Y, 'bce');
  X.forEach((x, i) => assert.ok(Math.abs(net.predict(x)[0] - Y[i][0]) < 0.1));
  const n2 = new ml.MLP([3, 4, 2], ['tanh', 'linear'], 4);
  const x = [0.3, -0.2, 0.9], t = [0.5, -1];
  const loss = () => n2.predict(x).reduce((s, y, i) => s + 0.5 * (y - t[i]) ** 2, 0);
  const a = n2.forward(x);
  const g = n2.backward(a, a[2].map((y, i) => y - t[i]));
  const h = 1e-6, w0 = n2.W[0][1][2];
  n2.W[0][1][2] = w0 + h; const lp = loss();
  n2.W[0][1][2] = w0 - h; const lm = loss();
  n2.W[0][1][2] = w0;
  assert.ok(Math.abs((lp - lm) / (2 * h) - g.gW[0][1][2]) < 1e-6);
});

test('attention rows sum to one; value iteration converges; GP interpolates', () => {
  const { weights } = ml.attention([[1, 0], [0, 1]], [[1, 0], [0, 1], [1, 1]], [[1], [2], [3]]);
  weights.forEach((w) => close(w.reduce((a, b) => a + b, 0), 1, 1e-12));
  const world = { W: 4, H: 3, walls: new Set(['1,1']), rewards: new Map([['3,0', 1], ['3,1', -1]]), terminal: new Set(['3,0', '3,1']) };
  let V = la.zeros(3, 4), delta = 1;
  for (let k = 0; k < 200 && delta > 1e-9; k++) ({ V, delta } = ml.valueIterationSweep(world, V, 0.9));
  assert.ok(V[0][2] > 0.9 && V[2][0] > 0);
  const { mu, sd } = ml.gpPosterior([0, 1, 2], [0, 1, 0], [1, 5], { sn: 1e-3 });
  assert.ok(Math.abs(mu[0] - 1) < 1e-3 && sd[0] < 0.01 && sd[1] > 0.9);
});

test('DMP reproduces a demo and generalizes to a new goal', () => {
  const demo = Array.from({ length: 101 }, (_, i) => { const s = i / 100; return 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5 + 0.4 * Math.sin(Math.PI * s) ** 2; });
  const dmp = new ml.DMP({ nBasis: 30 }).fit(demo, 1);
  const out = dmp.rollout({ steps: 100 });
  assert.ok(Math.abs(out.at(-1) - 1) < 0.02);
  const mid = out[50];
  assert.ok(Math.abs(mid - demo[50]) < 0.15, `mid ${mid} vs ${demo[50]}`);
  const out2 = dmp.rollout({ g: 2, steps: 100 });
  assert.ok(Math.abs(out2.at(-1) - 2) < 0.04);
});

test('GMM EM increases likelihood; PCA finds the long axis', () => {
  const r = rng(11);
  const pts = [];
  for (let i = 0; i < 100; i++) pts.push([r.normal(-2, 0.4), r.normal(0, 0.4)]);
  for (let i = 0; i < 100; i++) pts.push([r.normal(2, 0.4), r.normal(1, 0.4)]);
  let m = ml.gmmInit(pts, 2), prev = -Infinity;
  for (let k = 0; k < 30; k++) { m = ml.gmmStep(pts, m); assert.ok(m.ll >= prev - 1e-6); prev = m.ll; }
  const line = Array.from({ length: 200 }, () => { const t = r.normal(); return [3 * t + r.normal(0, 0.1), t + r.normal(0, 0.1)]; });
  const { components } = ml.pca(line);
  assert.ok(Math.abs(Math.abs(components[0][0]) - 3 / Math.sqrt(10)) < 0.02);
});
