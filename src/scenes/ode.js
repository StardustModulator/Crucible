// Flows. An ODE is a wind map: at every spot an arrow says "go this way".
// Drop leaves and they ride the wind (RK4). Then: what one step really does,
// and why a big Euler step spirals off a circle while RK4 stays on it.
import { C, alpha } from '../viz/palette.js';
import { rk4, eulerStep, pendulumDeriv } from '../core/dynamics.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const pend = pendulumDeriv({ m: 1, l: 1, g: 1.2, b: 0 });
const FIELDS = {
  sink: { f: (t, [x, y]) => [-0.16 * x - y, x - 0.16 * y], B: [-4, -3, 4, 3] },
  center: { f: (t, [x, y]) => [-y, x], B: [-4, -3, 4, 3] },
  saddle: { f: (t, [x, y]) => [0.7 * x + 0.25 * y, 0.25 * x - 0.7 * y], B: [-4, -3, 4, 3] },
  pend: { f: (t, p) => pend(t, p), B: [-7, -3.2, 7, 3.2] },
};

export default {
  eq: [
    [['ẋ', 'teal'], ' = ', ['f(x)', 'blue'], '        (the wind arrow at x)'],
    ['Euler: ', ['xₙ₊₁ = xₙ + h·f(xₙ)', 'coral']],
    ['RK4: ', ['xₙ₊₁ = xₙ + h·(k₁ + 2k₂ + 2k₃ + k₄)/6', 'lime'], '     ', ['k', 'purple'], ' = arrows sampled along the step'],
    ['Euler error per step ∝ ', ['h²', 'coral'], ' ,   RK4 ∝ ', ['h⁵', 'lime']],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const R = rng(11);
    const s = { beat: 0, field: 'sink', leaves: [], p1: [1.3, 0.35], h: 0.6, start: [2, 0], eu: [], rk: [], tick: 0, spray: 0 };
    const F = () => FIELDS[s.field];
    const fitBounds = () => {
      const want = s.beat === 2 ? CB : s.beat === 1 ? (F().B2 ??= F().B.map((v) => v * 0.5)) : F().B;
      if (g.bounds !== want) g.setBounds(want);
    };
    const CB = [-3.6, -3, 3.6, 3];
    const seed = () => {
      s.leaves = [];
      const [x0, y0, x1, y1] = F().B;
      for (let i = 0; i < 14; i++) addLeaf([R.uniform(x0 * 0.9, x1 * 0.9), R.uniform(y0 * 0.9, y1 * 0.9)]);
    };
    const addLeaf = (p) => { s.leaves.push({ p: p.slice(), trail: [p.slice()], age: 0 }); if (s.leaves.length > 70) s.leaves.shift(); };
    const resetRace = () => { s.eu = [s.start.slice()]; s.rk = [s.start.slice()]; s.tick = 0; };

    stage.handle({ pen: g, color: 'orange', r: 11, visible: () => s.beat === 1, get: () => s.p1, set: (p) => (s.p1 = p) });
    stage.handle({ pen: g, color: 'orange', r: 11, visible: () => s.beat === 2, get: () => s.start, set: (p) => { s.start = [clamp(p[0], -2.8, 2.8), clamp(p[1], -2.8, 2.8)]; resetRace(); } });
    const offD = stage.on('down', (e) => { if (s.beat === 0 && e.pen === g) { addLeaf(e.p); s.spray = 0; } });
    const offM = stage.on('move', (e) => {
      if (s.beat === 0 && stage.pointer.down && e.pen === g) { s.spray += 1; if (s.spray % 4 === 0) addLeaf(e.p); }
    });

    const groups = [ui.group(), ui.group()];
    ui.choice({
      into: groups[0], value: s.field, color: 'blue', options: [
        { icon: '🌀', value: 'sink', title: 'spiral in' }, { icon: '⭕', value: 'center', title: 'circle' },
        { icon: '🐴', value: 'saddle', title: 'saddle' }, { icon: '🕰️', value: 'pend', title: 'pendulum' },
      ], onChange: (v) => { s.field = v; fitBounds(); seed(); },
    });
    ui.button({ into: groups[0], icon: '🧹', title: 'clear leaves', onClick: () => (s.leaves = []) });
    ui.slider({ into: groups[1], icon: '👣', color: 'orange', min: 0.05, max: 1.4, step: 0.01, value: s.h, title: 'step size h', onInput: (v) => { s.h = v; resetRace(); } });
    ui.readout(() => (s.beat === 2 ? fmt(Math.hypot(...s.eu[s.eu.length - 1]) / Math.hypot(...s.start), 2) : String(s.leaves.length)), { icon: '🔴', color: 'coral', title: 'Euler radius growth / leaves' });
    const showGroups = () => { groups[0].style.display = s.beat < 2 ? '' : 'none'; groups[1].style.display = s.beat > 0 ? '' : 'none'; };
    ui.beats(['🍃', '👣', '⭕'], (b) => { s.beat = b; if (b === 2) resetRace(); showGroups(); fitBounds(); });
    showGroups(); fitBounds(); seed(); resetRace();

    return {
      update(dt) {
        if (s.beat === 0) {
          const [x0, y0, x1, y1] = g.view;
          for (const l of s.leaves) {
            for (let k = 0; k < 3; k++) l.p = rk4(F().f, 0, l.p, dt / 3);
            if (s.field === 'pend') { if (l.p[0] > 7.5) { l.p[0] -= 4 * Math.PI; l.trail = []; } if (l.p[0] < -7.5) { l.p[0] += 4 * Math.PI; l.trail = []; } }
            l.age += dt;
            const last = l.trail[l.trail.length - 1];
            if (!last || Math.hypot(l.p[0] - last[0], l.p[1] - last[1]) > 0.04) l.trail.push(l.p.slice());
            if (l.trail.length > 90) l.trail.shift();
          }
          s.leaves = s.leaves.filter((l) => l.p[0] > x0 - 1 && l.p[0] < x1 + 1 && l.p[1] > y0 - 1 && l.p[1] < y1 + 1);
          if (s.leaves.length < 4) addLeaf([R.uniform(x0, x1), R.uniform(y0, y1)]);
        }
        if (s.beat === 2) {
          s.tick += dt;
          if (s.tick > 0.3) {
            s.tick = 0;
            const f = FIELDS.center.f;
            const e = s.eu[s.eu.length - 1], r = s.rk[s.rk.length - 1];
            s.eu.push(eulerStep(f, 0, e, s.h)); s.rk.push(rk4(f, 0, r, s.h));
            if (s.eu.length * s.h > 4 * Math.PI || Math.hypot(...s.eu[s.eu.length - 1]) > 9) resetRace();
          }
        }
      },
      draw() {
        fitBounds();
        if (s.beat === 0) drawFlow();
        else if (s.beat === 1) drawStep();
        else drawRace();
      },
      dispose() { offD(); offM(); },
    };

    function windArrows(f, a = 0.5) {
      const [x0, y0, x1, y1] = g.view;
      const cell = Math.max(0.42, (x1 - x0) / 34);
      const nx = Math.round((x1 - x0) / cell), ny = Math.round((y1 - y0) / cell);
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const p = [x0 + (i + 0.5) * (x1 - x0) / nx, y0 + (j + 0.5) * (y1 - y0) / ny], v = f(0, p);
        const n = Math.hypot(v[0], v[1]); if (n < 1e-6) continue;
        const L = cell * clamp(0.3 + 0.25 * n, 0.3, 0.8) / n;
        g.arrow([p[0] - v[0] * L / 2, p[1] - v[1] * L / 2], [p[0] + v[0] * L / 2, p[1] + v[1] * L / 2], { color: alpha('blue', a), width: 1.8, head: 6 });
      }
    }

    function drawFlow() {
      g.grid({ step: 1 });
      windArrows(F().f, 0.45);
      if (s.field === 'pend') {
        for (const x of [-2 * Math.PI, 0, 2 * Math.PI]) g.dot([x, 0], 6, { color: 'lime', ring: 'bg' });
        for (const x of [-Math.PI, Math.PI]) g.dot([x, 0], 6, { color: 'coral', ring: 'bg' });
      } else g.dot([0, 0], 6, { color: s.field === 'saddle' || s.field === 'center' ? 'gold' : 'lime', ring: 'bg' });
      for (const l of s.leaves) {
        const n = l.trail.length;
        for (let i = 1; i < n; i++) g.line(l.trail[i - 1], l.trail[i], { color: alpha('teal', 0.1 + 0.75 * (i / n)), width: 2.5 });
        const v = F().f(0, l.p), ang = Math.atan2(v[1], v[0]);
        const [sx, sy] = g.toScreen(l.p), ctx = g.ctx;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(-ang + Math.PI / 4 + Math.PI);
        ctx.font = '22px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🍃', 0, 0); ctx.restore();
      }
      if (s.field === 'pend') { g.emoji('🕰️', [g.view[0] + 0.6, g.view[3] - 0.5], 24); }
    }

    function drawStep() {
      g.grid({ step: 1 });
      const f = F().f;
      windArrows(f, 0.25);
      const p = s.p1, h = s.h;
      // the truth: follow the wind for time h with tiny steps
      const tr = [p]; let q = p;
      for (let i = 0; i < 40; i++) { q = rk4(f, 0, q, h / 40); tr.push(q); }
      g.path(tr, { color: 'gold', width: 4, dash: [8, 6] });
      g.dot(q, 8, { color: 'gold', ring: 'bg' });
      // Euler: straight along the first arrow
      const v = f(0, p), eu = [p[0] + h * v[0], p[1] + h * v[1]];
      g.arrow(p, eu, { color: 'coral', width: 4 });
      g.dot(eu, 8, { color: 'coral', ring: 'bg' });
      g.line(eu, q, { color: alpha('coral', 0.6), width: 2, dash: [3, 3] });
      // RK4: four sampled arrows, averaged
      const k1 = f(0, p), p2 = [p[0] + h / 2 * k1[0], p[1] + h / 2 * k1[1]];
      const k2 = f(0, p2), p3 = [p[0] + h / 2 * k2[0], p[1] + h / 2 * k2[1]];
      const k3 = f(0, p3), p4 = [p[0] + h * k3[0], p[1] + h * k3[1]];
      const k4 = f(0, p4);
      [[p, k1], [p2, k2], [p3, k3], [p4, k4]].forEach(([o, k], i) => {
        g.vec(o, [k[0] * h * 0.5, k[1] * h * 0.5], { color: alpha('purple', 0.85), width: 2.5, head: 8 });
        g.dot(o, 4, { color: 'purple' });
        g.text(String(i + 1), [o[0] - 0.12, o[1] + 0.14], { color: 'purple', size: 13 });
      });
      const rk = rk4(f, 0, p, h);
      g.arrow(p, rk, { color: 'lime', width: 3 });
      g.dot(rk, 8, { color: 'lime', ring: 'bg' });
      g.emoji('🍃', [p[0] - 0.22, p[1] - 0.25], 22);
    }

    function drawRace() {
      g.grid({ step: 1 });
      windArrows(FIELDS.center.f, 0.25);
      const r0 = Math.hypot(...s.start);
      g.circle([0, 0], r0, { color: 'gold', width: 3, dash: [8, 6] });
      g.path(s.eu, { color: 'coral', width: 3 });
      s.eu.forEach((p) => g.dot(p, 4.5, { color: 'coral' }));
      g.path(s.rk, { color: 'lime', width: 3 });
      s.rk.forEach((p) => g.dot(p, 4.5, { color: 'lime' }));
      const e = s.eu[s.eu.length - 1], r = s.rk[s.rk.length - 1];
      g.dot(e, 9, { color: 'coral', ring: 'bg' });
      g.dot(r, 9, { color: 'lime', ring: 'bg' });
      const re = Math.hypot(...e);
      g.emoji(re > r0 * 1.6 ? '😵' : '🙂', [e[0] + 0.35, e[1] + 0.35], 22);
      g.emoji('😎', [r[0] + 0.35, r[1] + 0.35], 22);
      g.dot([0, 0], 5, { color: 'ink' });
    }
  },
};
void C;
