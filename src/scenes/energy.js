// Energy is a bucket that never leaks: up high = blue (height energy), going fast =
// orange (motion energy). They pour back and forth; the total stays level. Friction
// turns some into heat 🔥. The Lagrangian is the DIFFERENCE of the two bars.
import { C, alpha } from '../viz/palette.js';
import { solve } from '../core/linalg.js';
import { rk4, pendulumDeriv, pendulumEnergy } from '../core/dynamics.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const G = 9.81;
function spline(xs, ys) {
  const n = xs.length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
  A[0][0] = 1; A[n - 1][n - 1] = 1;
  for (let i = 1; i < n - 1; i++) {
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
    A[i][i - 1] = h0 / 6; A[i][i] = (h0 + h1) / 3; A[i][i + 1] = h1 / 6;
    b[i] = (ys[i + 1] - ys[i]) / h1 - (ys[i] - ys[i - 1]) / h0;
  }
  const M = solve(A, b);
  return (x) => {
    x = clamp(x, xs[0], xs[n - 1]);
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], a = (xs[i + 1] - x) / h, t = (x - xs[i]) / h;
    return [
      a * ys[i] + t * ys[i + 1] + ((a ** 3 - a) * M[i] + (t ** 3 - t) * M[i + 1]) * h * h / 6,
      (ys[i + 1] - ys[i]) / h + (-(3 * a * a - 1) * M[i] + (3 * t * t - 1) * M[i + 1]) * h / 6,
      a * M[i] + t * M[i + 1],
    ];
  };
}

const XS = [-6, -4, -2, 0, 2, 4, 6];

export default {
  eq: [
    [['T', 'orange'], ' = ½ m v²      ', ['V', 'blue'], ' = m g h'],
    [['T', 'orange'], ' + ', ['V', 'blue'], ' + ', ['Q', 'coral'], ' = ', ['E', 'gold'], ' = const     (', ['Q', 'coral'], ' = heat from friction)'],
    [['L', 'pink'], ' = ', ['T', 'orange'], ' − ', ['V', 'blue'], '        d/dt(∂', ['L', 'pink'], '/∂q̇) − ∂', ['L', 'pink'], '/∂q = 0'],
  ],
  setup({ stage, ui }) {
    const s = {
      beat: 0, ys: [3.6, 1.4, 0.4, 1.6, 0.5, 1.2, 3.2], x: [-5.6, 0, 0], fr: false, t: 0,
      pend: [1.2, 0, 0], hist: [], E0: 0,
    };
    let h = spline(XS, s.ys);
    const P = { m: 1, l: 1.7, g: G, b: 0 };
    const wide = (W, H) => W >= H * 1.05;
    const L = stage.pen((W, H) => (wide(W, H) ? { x: 0, y: 0, w: 0.76, h: 1 } : { x: 0, y: 0, w: 1, h: 0.64 }), [-6.5, -0.6, 6.5, 4.6], { frame: true });
    const Rr = stage.pen((W, H) => (wide(W, H) ? { x: 0.76, y: 0, w: 0.24, h: 1 } : { x: 0, y: 0.64, w: 1, h: 0.36 }), [0, -0.5, 4.2, 5.2], { frame: true });

    const trackE = () => { const [y, d] = h(s.x[0]); return { KE: 0.5 * (1 + d * d) * s.x[1] ** 2, PE: G * y, Q: s.x[2] }; };
    const pendE = () => { const e = pendulumEnergy(P, s.pend[0], s.pend[1]); return { KE: e.KE, PE: e.PE, Q: s.pend[2] }; };
    const energies = () => (s.beat === 0 ? trackE() : pendE());
    const resetE = () => { const e = energies(); s.E0 = e.KE + e.PE; s.hist = []; };
    const PIV = [0, 3.7];
    const bob = () => [PIV[0] + P.l * Math.sin(s.pend[0]), PIV[1] - P.l * Math.cos(s.pend[0])];

    XS.forEach((x, i) => stage.handle({
      pen: L, color: 'slate', r: 8, kind: 'square', visible: () => s.beat === 0,
      get: () => [x, s.ys[i]], set: (p) => { s.ys[i] = clamp(p[1], 0.1, 4.2); h = spline(XS, s.ys); s.x[1] = 0; s.x[2] = 0; resetE(); },
    }));
    stage.handle({
      pen: L, color: 'pink', r: 12, visible: () => s.beat === 0,
      get: () => [s.x[0], h(s.x[0])[0] + 0.32], set: (p) => { s.x = [clamp(p[0], -5.9, 5.9), 0, 0]; resetE(); },
      onStart: () => (s.held = true), onEnd: () => (s.held = false),
    });
    stage.handle({
      pen: L, color: 'pink', r: 13, visible: () => s.beat > 0, get: bob,
      set: (p) => { s.pend = [Math.atan2(p[0] - PIV[0], -(p[1] - PIV[1])), 0, 0]; resetE(); },
      onStart: () => (s.held = true), onEnd: () => (s.held = false),
    });

    ui.beats(['🛹', '🕰️', '➖'], (b) => {
      s.beat = b; s.t = 0;
      L.setBounds(b === 0 ? [-6.5, -0.6, 6.5, 4.6] : b === 1 ? [-3.4, -0.3, 3.4, 4.6] : [-3.4, -3.4, 3.4, 4.6]);
      if (b > 0) s.pend = [1.3, 0, 0];
      resetE();
    });
    ui.toggle({ icon: '🔥', color: 'coral', title: 'friction', value: false, onChange: (v) => { s.fr = v; } });
    ui.button({ icon: '🔁', title: 'start again', onClick: () => { if (s.beat === 0) s.x = [-5.6, 0, 0]; else s.pend = [1.3, 0, 0]; resetE(); } });
    ui.readout(() => fmt(energies().KE + energies().PE + energies().Q, 1), { icon: '🪣', color: 'gold', title: 'total energy' });
    resetE();

    return {
      update(dt) {
        s.t += dt;
        if (s.held) return;
        const c = s.fr ? 0.35 : 0;
        const n = 8, hh = Math.min(dt, 0.05) / n;
        if (s.beat === 0) {
          const f = (t, [x, v]) => {
            const [, d, d2] = h(x), M = 1 + d * d;
            return [v, -(G * d + d * d2 * v * v) / M - c * v, c * M * v * v];
          };
          for (let k = 0; k < n; k++) {
            s.x = rk4(f, 0, s.x, hh);
            if (s.x[0] < XS[0]) { s.x[0] = 2 * XS[0] - s.x[0]; s.x[1] = -s.x[1]; }
            if (s.x[0] > XS[6]) { s.x[0] = 2 * XS[6] - s.x[0]; s.x[1] = -s.x[1]; }
          }
        } else {
          P.b = s.fr ? 0.35 : 0;
          const pd = pendulumDeriv(P);
          // heat = work done by the damping torque
          const f = (t, [th, om]) => { const d = pd(t, [th, om]); return [d[0], d[1], P.b * P.m * P.l * P.l * om * om]; };
          for (let k = 0; k < n; k++) s.pend = rk4(f, 0, s.pend, hh);
        }
        const e = energies();
        s.hist.push([s.t, e.KE, e.PE]);
        while (s.hist.length && s.hist[0][0] < s.t - 6) s.hist.shift();
      },
      draw() {
        if (s.beat === 0) drawTrack(); else drawPendulum();
        drawBars();
      },
    };

    function drawTrack() {
      L.grid({ step: 1, axes: false });
      const pts = []; for (let i = 0; i <= 200; i++) { const x = XS[0] + (XS[6] - XS[0]) * i / 200; pts.push([x, h(x)[0]]); }
      L.poly([[XS[0], -0.6], ...pts, [XS[6], -0.6]], { fill: alpha('slate', 0.18), stroke: false });
      L.path(pts, { color: 'slate', width: 6 });
      L.line([XS[0] - 0.4, 0], [XS[6] + 0.4, 0], { color: alpha('muted', 0.6), width: 1.5 });
      const e = trackE(), top = (e.KE + e.PE) / G;
      // the "can't climb above here" line (drops when friction eats energy)
      L.line([XS[0], top], [XS[6], top], { color: 'gold', width: 2, dash: [8, 6] });
      if (s.fr) L.line([XS[0], s.E0 / G], [XS[6], s.E0 / G], { color: alpha('gold', 0.35), width: 1.5, dash: [3, 6] });
      const [y, d] = h(s.x[0]);
      const nrm = [-d / Math.hypot(1, d), 1 / Math.hypot(1, d)];
      const c = [s.x[0] + nrm[0] * 0.32, y + nrm[1] * 0.32];
      L.line([c[0], c[1] - 0.32], [c[0], 0], { color: 'blue', width: 3, dash: [5, 4] });
      const v = s.x[1], dir = [1 / Math.hypot(1, d), d / Math.hypot(1, d)], sp = Math.abs(v) * Math.hypot(1, d);
      if (sp > 0.2) L.arrow(c, [c[0] + dir[0] * v * 0.25 * Math.hypot(1, d), c[1] + dir[1] * v * 0.25 * Math.hypot(1, d)], { color: 'orange', width: 5 });
      ball(L, c, 0.3, -s.x[0] / 0.3);
      if (s.fr && sp > 0.5) L.emoji('🔥', [c[0] - dir[0] * Math.sign(v) * 0.5, c[1] - 0.35], 16);
    }
    function ball(pen, c, r, spin) {
      pen.circle(c, r, { fill: 'pink', stroke: false });
      pen.line(c, [c[0] + r * Math.cos(spin), c[1] + r * Math.sin(spin)], { color: alpha('white', 0.85), width: 3 });
      pen.circle([c[0] - r * 0.3, c[1] + r * 0.3], r * 0.25, { fill: alpha('white', 0.35), stroke: false });
    }

    function drawPendulum() {
      L.grid({ step: 1, axes: false });
      const b = bob(), e = pendE();
      const low = PIV[1] - P.l;
      L.line([-3.2, low], [3.2, low], { color: alpha('muted', 0.6), width: 1.5 });
      // swing arc reachable with the energy left
      const reach = Math.acos(clamp(1 - (e.KE + e.PE) / (P.m * G * P.l), -1, 1));
      L.arc(PIV, P.l, -Math.PI / 2 - reach, -Math.PI / 2 + reach, { color: 'gold', width: 2, dash: [6, 5] });
      L.line([b[0], b[1]], [b[0], low], { color: 'blue', width: 3, dash: [5, 4] });
      L.line(PIV, b, { color: 'slate', width: 4 });
      L.rect(-0.6, PIV[1], 1.2, 0.2, { fill: 'slate', stroke: false });
      const om = s.pend[1], tang = [Math.cos(s.pend[0]), Math.sin(s.pend[0])];
      if (Math.abs(om) > 0.2) L.arrow(b, [b[0] + tang[0] * om * P.l * 0.22, b[1] + tang[1] * om * P.l * 0.22], { color: 'orange', width: 5 });
      ball(L, b, 0.3, s.pend[0] * 3);
      if (s.beat === 2) drawLagrangePlot();
    }
    function drawLagrangePlot() {
      // T (orange), V (blue) and L = T − V (pink) over the last 6 seconds
      const Y0 = -1.9, K = 1.25 / Math.max(s.E0, 1e-6), x0 = -3.1, x1 = 3.1, t1 = s.t;
      const X = (t) => x1 - ((t1 - t) / 6) * (x1 - x0);
      L.rrect(x0 - 0.1, Y0 - 1.4, x1 - x0 + 0.2, 2.8, 8, { fill: alpha('panel', 0.7), stroke: false });
      L.line([x0, Y0], [x1, Y0], { color: alpha('muted', 0.7), width: 1 });
      const pT = s.hist.map(([t, T]) => [X(t), Y0 + T * K]);
      const pV = s.hist.map(([t, , V]) => [X(t), Y0 + V * K]);
      const pL = s.hist.map(([t, T, V]) => [X(t), Y0 + (T - V) * K]);
      if (pL.length > 1) L.poly([[pL[0][0], Y0], ...pL, [pL[pL.length - 1][0], Y0]], { fill: alpha('pink', 0.22), stroke: false });
      L.path(pT, { color: 'orange', width: 2.5 });
      L.path(pV, { color: 'blue', width: 2.5 });
      L.path(pL, { color: 'pink', width: 3.5 });
      L.text('L', [x0 + 0.2, Y0 + 1.15], { color: 'pink', size: 18, weight: 800 });
      L.text('0', [x0 - 0.05, Y0 + 0.18], { color: 'muted', size: 11 });
    }

    function drawBars() {
      const e = energies(), E0 = Math.max(s.E0, 1e-6), K = 4.0 / E0, es = stage.portrait ? 13 : 18;
      Rr.line([0.05, 0], [4.15, 0], { color: alpha('muted', 0.6), width: 1.5 });
      const items = s.beat === 2
        ? [['orange', e.KE, '🏃'], ['blue', e.PE, '⛰️'], ['pink', e.KE - e.PE, 'L']]
        : [['orange', e.KE, '🏃'], ['blue', e.PE, '⛰️'], ['coral', e.Q, '🔥']];
      items.forEach(([c, v, ic], i) => {
        const x = 0.25 + i * 0.95;
        Rr.rrect(x, 0, 0.7, 4.0, 6, { fill: alpha(c, 0.08), stroke: false });
        if (ic === 'L') { Rr.bar(x, 2, 0.7, v * K / 2, { color: c }); Rr.line([x - 0.08, 2], [x + 0.78, 2], { color: 'muted', width: 2 }); }
        else Rr.bar(x, 0, 0.7, v * K, { color: c });
        if (ic === 'L') Rr.text('L', [x + 0.35, -0.3], { color: 'pink', size: 18, weight: 800 });
        else Rr.emoji(ic, [x + 0.35, -0.3], es);
      });
      // the total bucket: stacked, always the same height
      const x = 3.25;
      let y = 0;
      for (const [c, v] of [['blue', e.PE], ['orange', e.KE], ['coral', e.Q]]) { Rr.bar(x, y, 0.7, Math.max(0, v) * K, { color: c, r: 0 }); y += Math.max(0, v) * K; }
      Rr.line([x - 0.1, 4.0], [x + 0.8, 4.0], { color: 'gold', width: 3 });
      Rr.emoji('🪣', [x + 0.35, -0.3], es);
      Rr.text('=', [x - 0.12, 4.35], { color: 'gold', size: 18, weight: 800 });
      if (s.beat === 2) {
        Rr.text('−', [1.18, 4.5], { color: 'ink', size: 20, weight: 800 });
      }
    }
  },
};
void C;
