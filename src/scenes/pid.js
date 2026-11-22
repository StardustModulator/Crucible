// PID: a drone tries to hover at the gold line.
//   P = a spring pulling it toward the line (teal)
//   I = a bucket that slowly fills while it is still wrong (gold)
//   D = a shock absorber that resists speed (purple)
import { alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { PID } from '../core/control.js';
import { rk4 } from '../core/dynamics.js';
import { clamp } from '../core/random.js';

const MASS = 1, G = 9.81, DRAG = 0.25, UMAX = 40, H = 0.001, WIN = 10;
const PRESETS = [
  { kp: 15, ki: 0, kd: 0 },     // 🌀 P only: bouncy, sags
  { kp: 15, ki: 0, kd: 6 },     // 🛞 +D: calm, still sags
  { kp: 15, ki: 10, kd: 6 },    // 🪣 +I: sag gone
  { kp: 60, ki: 120, kd: 1 },   // 🤪 way too much
];

export default {
  eq: [
    [['u', 'pink'], ' = ', ['Kₚ e', 'teal'], ' + ', ['Kᵢ ∫e dt', 'gold'], ' − ', ['K_d ẏ', 'purple'], '        e = ', ['r', 'gold'], ' − ', ['y', 'pink']],
    ['m ÿ = ', ['u', 'pink'], ' − ', ['m g', 'green'], ' − c ẏ + ', ['wind', 'coral']],
    ['P only:  steady sag  ', ['e∞', 'coral'], ' = ', ['m g', 'green'], ' / ', ['Kₚ', 'teal'], '      with I:  ', ['e∞', 'coral'], ' = 0'],
    ['poles:  m s³ + (c+', ['K_d', 'purple'], ') s² + ', ['Kₚ', 'teal'], ' s + ', ['Kᵢ', 'gold'], ' = 0   (unstable if (c+K_d)Kₚ < m Kᵢ)'],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[-2.1, -0.35, 2.3, 4.75], [0, 0, 10, 10]], [1.15, 1]);
    const s = { y: 0, v: 0, r: 2.6, t: 0, gust: 0, hist: [], beat: 0, u: 0, terms: { p: 0, i: 0, d: 0 }, spin: 0, lastS: 0 };
    const pid = new PID(15, 0, 0, { iLimit: 3 });
    const sl = {};
    const restart = () => { s.y = 0; s.v = 0; s.t = 0; s.hist = []; pid.reset(); s.lastS = -1; };

    stage.handle({ pen: A, color: 'gold', r: 12, kind: 'square', get: () => [1.75, s.r], set: (p) => (s.r = clamp(p[1], 0.4, 4.3)) });
    sl.kp = ui.slider({ icon: '🌀', title: 'P: spring', color: 'teal', min: 0, max: 80, step: 0.5, value: 15, onInput: (v) => (pid.kp = v) });
    sl.ki = ui.slider({ icon: '🪣', title: 'I: bucket', color: 'gold', min: 0, max: 150, step: 0.5, value: 0, onInput: (v) => (pid.ki = v) });
    sl.kd = ui.slider({ icon: '🛞', title: 'D: shock absorber', color: 'purple', min: 0, max: 15, step: 0.1, value: 0, onInput: (v) => (pid.kd = v) });
    ui.button({ icon: '💨', title: 'wind gust', onClick: () => (s.gust = 0.5) });
    ui.button({ icon: '🛬', title: 'land and take off again', onClick: restart });
    ui.beats(['🌀', '🛞', '🪣', '🤪'], (i) => {
      s.beat = i;
      const pr = PRESETS[i];
      pid.kp = pr.kp; pid.ki = pr.ki; pid.kd = pr.kd;
      sl.kp.set(pr.kp); sl.ki.set(pr.ki); sl.kd.set(pr.kd);
      s.r = 2.6; restart();
    });
    ui.readout(() => fmt(s.r - s.y, 2), { icon: '📏', color: 'coral', title: 'error' });

    const plant = (u, w) => (t, x) => [x[1], (u - MASS * G - DRAG * x[1] + w) / MASS];

    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        const n = Math.min(200, Math.round(dt / H));
        for (let k = 0; k < n; k++) {
          const u = clamp(pid.step(s.r, s.y, H), 0, UMAX);
          const w = s.gust > 0 ? -16 : 0;
          let x = rk4(plant(u, w), 0, [s.y, s.v], H);
          if (x[0] < 0) x = [0, Math.max(0, x[1])];          // the ground
          if (x[0] > 4.5) x = [4.5, Math.min(0, x[1])];      // the ceiling
          s.y = x[0]; s.v = x[1]; s.u = u; s.terms = pid.terms;
          s.gust = Math.max(0, s.gust - H);
          s.t += H;
        }
        s.spin += dt * (10 + s.u);
        if (s.t - s.lastS > 1 / 40) {
          s.lastS = s.t;
          s.hist.push([s.t, s.y, s.r]);
          while (s.hist.length && s.hist[0][0] < s.t - WIN) s.hist.shift();
        }
      },
      draw() {
        const y = s.y;
        // ---------- world ----------
        A.grid({ step: 0.5 });
        const [vx0, vy0, vx1] = A.view;
        A.rect(vx0, vy0, vx1 - vx0, -vy0, { fill: alpha('slate', 0.3), stroke: false });
        A.line([vx0, 0], [vx1, 0], { color: 'slate', width: 2 });
        // target line
        A.line([vx0, s.r], [vx1, s.r], { color: 'gold', width: 3, dash: [10, 6] });
        // P: spring from the drone to the line
        const bodyY = y + 0.25;
        A.spring([0.85, bodyY], [0.85, s.r], { color: 'teal', width: 2.5, coils: 7 });
        A.dot([0.85, s.r], 5, { color: 'teal' });
        // D: shock absorber from the ground
        if (bodyY > 0.15) A.damper([-0.85, 0], [-0.85, bodyY], { color: 'purple' });
        // I: bucket on the ground filling up
        const bx = -1.75, bw = 0.5, bh = 1.6;
        const lvl = clamp(s.terms.i / (MASS * G * 1.5), -1, 1);
        A.path([[bx, bh], [bx + 0.05, 0.02], [bx + bw - 0.05, 0.02], [bx + bw, bh]], { color: 'gold', width: 3 });
        if (lvl > 0) A.poly([[bx + 0.05, 0.03], [bx + bw - 0.05, 0.03], [bx + bw - 0.05 + 0.05 * lvl, lvl * bh * 0.97], [bx + 0.05 - 0.05 * lvl, lvl * bh * 0.97]], { fill: alpha('gold', 0.6), stroke: false });
        else if (lvl < 0) A.poly([[bx + 0.05, 0.03], [bx + bw - 0.05, 0.03], [bx + bw - 0.05, -lvl * bh * 0.97], [bx + 0.05, -lvl * bh * 0.97]], { fill: alpha('coral', 0.5), stroke: false });
        A.line([bx + bw, bh * 0.6], [-0.85 - 0.2, bodyY], { color: alpha('gold', 0.35), width: 1.5, dash: [3, 5] });

        // error bracket
        if (Math.abs(s.r - bodyY) > 0.04) {
          A.line([1.25, bodyY], [1.25, s.r], { color: 'coral', width: 3 });
          A.line([1.15, bodyY], [1.35, bodyY], { color: 'coral', width: 3 });
          A.text('e', [1.42, (bodyY + s.r) / 2], { color: 'coral', size: 16, align: 'left' });
        }
        // gust
        if (s.gust > 0) {
          for (let k = 0; k < 4; k++) {
            const xx = -0.5 + k * 0.35, yy = bodyY + 0.9 - ((s.t * 6 + k * 0.3) % 1) * 0.7;
            A.vec([xx, yy + 0.3], [0, -0.3], { color: alpha('coral', 0.7), width: 2.5 });
          }
          A.emoji('💨', [0, bodyY + 1.25], 30);
        }
        drone(A, [0, bodyY], s.spin, s.u);
        // force arrows on the drone: thrust (pink) up, weight (green) down
        A.vec([0.12, bodyY + 0.12], [0, s.u * 0.04], { color: 'pink', width: 4 });
        A.vec([-0.12, bodyY - 0.05], [0, -MASS * G * 0.04], { color: 'green', width: 4 });

        // ---------- right: force bars + step response ----------
        const y0 = 6.7, k = 0.11;
        const bars = [['teal', s.terms.p, '🌀'], ['gold', s.terms.i, '🪣'], ['purple', s.terms.d, '🛞'], ['pink', s.u, '🚁']];
        B.line([0.4, y0], [9.6, y0], { color: alpha('muted', 0.5), width: 1 });
        bars.forEach(([c, v, ic], i) => {
          const x = 0.8 + i * 2.2;
          B.bar(x, y0, 1.2, clamp(v * k, -1.5, 2.5), { color: c });
          B.emoji(ic, [x + 0.6, 9.65], 20);
          if (i < 2) B.text('+', [x + 1.7, y0 + 0.4], { size: 18, color: 'muted' });
          if (i === 2) B.text('=', [x + 1.7, y0 + 0.4], { size: 18, color: 'muted' });
        });
        B.line([7.2, y0 + MASS * G * k], [9.2, y0 + MASS * G * k], { color: 'green', width: 3, dash: [6, 4] });
        // step response
        const px0 = 0.6, px1 = 9.6, py0 = 0.4, py1 = 4.7;
        const t0 = Math.max(0, s.t - WIN);
        const X = (t) => px0 + ((t - t0) / WIN) * (px1 - px0), Y = (v) => py0 + (v / 4.6) * (py1 - py0);
        B.rect(px0, py0, px1 - px0, py1 - py0, { color: alpha('muted', 0.3), width: 1 });
        B.path(s.hist.map((h) => [X(h[0]), Y(h[2])]), { color: 'gold', width: 2.5, dash: [8, 5] });
        B.path(s.hist.map((h) => [X(h[0]), Y(h[1] + 0.25)]), { color: 'pink', width: 3 });
        const last = s.hist[s.hist.length - 1];
        if (last) B.dot([X(last[0]), Y(last[1] + 0.25)], 5, { color: 'pink' });
      },
    };
  },
};

function drone(g, c, spin, u) {
  const [x, y] = c;
  // air pushed down
  const n = Math.round(clamp(u / 8, 0, 5));
  for (let k = 0; k < n; k++) {
    const ph = (spin * 0.05 + k / n) % 1;
    for (const sx of [-0.45, 0.45]) g.line([x + sx, y - 0.1 - ph * 0.45], [x + sx, y - 0.22 - ph * 0.45], { color: alpha('blue', 0.45 * (1 - ph)), width: 2 });
  }
  g.line([x - 0.45, y], [x + 0.45, y], { color: 'ink', width: 4 });
  for (const sx of [-0.45, 0.45]) {
    g.line([x + sx, y], [x + sx, y + 0.1], { color: 'ink', width: 3 });
    const w = 0.28 * Math.abs(Math.cos(spin * 0.6 + sx * 3));
    g.ellipse([x + sx, y + 0.12], Math.max(w, 0.04), 0.035, 0, { fill: alpha('muted', 0.6), color: 'muted', width: 1 });
  }
  g.rrect(x - 0.2, y - 0.1, 0.4, 0.2, 7, { fill: 'slate' });
  g.dot([x, y], 4, { color: 'pink' });
}
