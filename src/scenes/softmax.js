// Softmax turns "scores" into a pie of chances. Exponentiating makes the big
// scores BIG and the small ones tiny; dividing by the total makes it a pie.
// Temperature melts the pie flat (hot) or freezes it into one winner (cold).
// Cross-entropy is the surprise when the true answer had a thin slice.
import { C, alpha, mix } from '../viz/palette.js';
import { softmax } from '../core/learning.js';
import { clamp, smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const ANIMALS = ['🐱', '🐶', '🐰', '🦊'];
const CLS = ['orange', 'pink', 'green', 'blue'];

export default {
  eq: [
    [['pᵢ', 'purple'], ' = ', ['e', 'ink'], ['^(zᵢ / T)', 'orange'], '  /  Σⱼ e^(zⱼ / T)        (zᵢ = score bars,  ', ['p', 'purple'], ' = pie slices / %)'],
    [['T', 'coral'], ' → 0: winner takes all ❄️        ', ['T', 'coral'], ' → ∞: all slices equal 🔥'],
    [['L', 'coral'], ' = −log ', ['p', 'purple'], ['_true', 'gold'], '     (the surprise tower)'],
    [['∂L/∂zᵢ', 'coral'], ' = (', ['pᵢ', 'purple'], ' − ', ['yᵢ', 'lime'], ') / ', ['T', 'coral'], '      push the true score up ⬆, every other score down ⬇'],
  ],
  setup({ stage, ui }) {
    const [Lp, Rp] = stage.split([[0, -3.4, 10, 4.3], [-2.3, -2.3, 3.9, 2.3]], [1.15, 1]);
    const s = { z: [2.0, 1.0, 0.2, -0.8], T: 1, beat: 0, t: 0, bt: 0, truth: 1, learn: false, pShow: [0.25, 0.25, 0.25, 0.25] };
    const P = () => softmax(s.z, s.T);
    const xs = (i) => 0.25 + i * 1.05, xe = (i) => 5.35 + i * 1.05, BW = 0.62;

    s.z.forEach((_, i) => stage.handle({
      pen: Lp, color: CLS[i], r: 10,
      get: () => [xs(i) + BW / 2, s.z[i]],
      set: (p) => (s.z[i] = Math.round(clamp(p[1], -3, 3.6) * 10) / 10),
    }));

    ui.beats(['🥧', '🚀', '🌡️', '😲'], (b) => { s.beat = b; s.bt = 0; if (b < 3) { learnT.set(false); } });
    const tSl = ui.slider({ icon: '🌡️', color: 'coral', min: -1.6, max: 1.6, step: 0.01, value: 0, title: 'temperature', onInput: (v) => (s.T = Math.exp(v)) });
    ui.choice({ value: 1, color: 'gold', options: ANIMALS.map((a, i) => ({ icon: a, value: i, title: 'true answer' })), onChange: (v) => (s.truth = v) });
    const learnT = ui.toggle({ icon: '🏃', color: 'coral', title: 'learn: follow the gradient', onChange: (v) => (s.learn = v) });
    ui.readout(() => fmt(-Math.log(P()[s.truth]), 2), { icon: '😲', color: 'coral', title: 'cross-entropy (surprise)' });
    void tSl;

    return {
      update(dt) {
        dt = Math.max(0, dt);                 // the shell can hand a tiny negative dt right after ⏭
        s.t += dt; s.bt += dt;
        if (s.learn) {
          const p = P();
          for (let i = 0; i < 4; i++) s.z[i] = clamp(s.z[i] - 1.2 * dt * (p[i] - (i === s.truth ? 1 : 0)) / s.T, -3, 3.6);
        }
        const p = P();
        s.pShow = s.pShow.map((v, i) => v + (p[i] - v) * Math.min(1, dt * 8));
      },
      draw() { drawBars(); drawPie(); },
    };

    function drawBars() {
      const g = Lp, p = P();
      const e = s.z.map((z) => Math.exp(z / s.T)), em = Math.max(...e);
      g.line([0.05, 0], [4.45, 0], { color: 'muted', width: 1.5 });
      for (let i = 0; i < 4; i++) {
        const c = CLS[i];
        // score bar (can be negative)
        g.bar(xs(i), 0, BW, s.z[i], { color: alpha(c, 0.85) });
        g.text(fmt(s.z[i], 1), [xs(i) + BW / 2, s.z[i] + (s.z[i] >= 0 ? 0.45 : -0.45)], { color: c, size: 13, weight: 700 });
        g.emoji(ANIMALS[i], [xs(i) + BW / 2, -3.05], 22);
        if (i === s.truth && s.beat >= 3) g.rrect(xs(i) - 0.08, -3.35, BW + 0.16, 0.62, 8, { color: 'gold', width: 2.5 });
        // gradient arrows: −∂L/∂z (lime up for the truth, coral down for the rest)
        if (s.beat >= 3) {
          const gr = -(p[i] - (i === s.truth ? 1 : 0));
          const ax = xs(i) + BW + 0.2;
          if (Math.abs(gr) > 0.01) g.arrow([ax, s.z[i]], [ax, s.z[i] + gr * 2.6], { color: gr > 0 ? 'lime' : 'coral', width: 4 });
        }
      }
      if (s.beat >= 1) {
        // the exponential pump
        const k = s.beat === 1 ? smoothstep((s.bt % 4) / 1.6) : 1;
        g.arrow([4.5, 1.2], [5.15, 1.2], { color: 'ink', width: 3 });
        g.text(s.beat >= 2 ? 'eᶻᐟᵀ' : 'eᶻ', [4.8, 1.8], { color: 'orange', size: 22, weight: 800 });
        g.line([5.2, 0], [9.3, 0], { color: 'muted', width: 1.5 });
        for (let i = 0; i < 4; i++) {
          const target = 3.9 * e[i] / em, from = Math.max(s.z[i], 0.05);
          const h = from + (target - from) * k;
          g.bar(xe(i), 0, BW, Math.max(h, 0.03), { color: alpha(CLS[i], 0.85) });
          g.emoji(ANIMALS[i], [xe(i) + BW / 2, -3.05], 22);
          g.text(`${Math.round(p[i] * 100)}%`, [xe(i) + BW / 2, Math.max(h, 0.03) + 0.4], { color: 'purple', size: 13, weight: 700 });
        }
        // ghost of the plain scores: the tall ones stretched far more than the short ones
        for (let i = 0; i < 4; i++) if (s.z[i] > 0) g.rect(xe(i), 0, BW, s.z[i], { color: alpha('ink', 0.45), dash: [4, 4], width: 1.5 });
      }
    }

    function drawPie() {
      const g = Rp, p = s.pShow;
      const R = 1.85, c = [0, 0];
      let a = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const a1 = a - p[i] * Math.PI * 2;
        g.wedge(c, R, a1, a, { color: CLS[i], alpha: 0.82 });
        a = a1;
      }
      a = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const a1 = a - p[i] * Math.PI * 2, mid = (a + a1) / 2;
        g.line(c, [Math.cos(a) * R, Math.sin(a) * R], { color: 'bg', width: 2.5 });
        if (p[i] > 0.06) {
          const rr = p[i] > 0.2 ? R * 0.58 : R * 0.72;
          g.emoji(ANIMALS[i], [Math.cos(mid) * rr, Math.sin(mid) * rr], 14 + 22 * Math.sqrt(p[i]));
        }
        if (s.beat >= 3 && i === s.truth) {
          g.arc(c, R + 0.12, a1, a, { color: 'gold', width: 6 });
        }
        a = a1;
      }
      g.circle(c, R, { color: alpha('ink', 0.25), width: 1.5 });

      if (s.beat === 2) {
        // ❄️ cold and 🔥 hot versions of the same scores
        const mini = (T, at, icon) => {
          const q = softmax(s.z, T);
          let b = Math.PI / 2;
          q.forEach((v, i) => { const b1 = b - v * Math.PI * 2; g.wedge(at, 0.55, b1, b, { color: CLS[i], alpha: 0.82 }); b = b1; });
          g.circle(at, 0.55, { color: alpha('ink', 0.25), width: 1 });
          g.emoji(icon, [at[0], at[1] + 0.82], 20);
        };
        mini(0.2, [3.05, 0.95], '❄️');
        mini(5, [3.05, -1.25], '🔥');
        // thermometer reading
        const tt = clamp((Math.log(s.T) + 1.6) / 3.2, 0, 1);
        g.rrect(-2.2, -1.6, 0.22, 3.2, 6, { fill: alpha('faint', 0.5) });
        g.rrect(-2.2, -1.6, 0.22, 3.2 * tt + 0.05, 6, { fill: mix('blue', 'coral', tt) });
        g.text(`T ${fmt(s.T, 2)}`, [-2.09, 1.9], { color: 'coral', size: 13, weight: 700 });
        g.emoji('🌡️', [-2.09, -1.9], 18);
      }
      if (s.beat >= 3) {
        // surprise tower: −log p(true)
        const L = -Math.log(Math.max(p[s.truth], 1e-6));
        const unit = 0.8, x0 = 2.6, w = 0.8;
        const H = Math.min(L, 4.2) * unit;
        const n = Math.floor(L / 1);
        for (let k = 0; k < Math.min(n, 4); k++) g.rrect(x0, -2.1 + k * unit, w, unit - 0.06, 5, { fill: alpha('coral', 0.85) });
        const rest = Math.min(L, 4.2) - Math.min(n, 4);
        if (rest > 0.02 && n < 5) g.rrect(x0, -2.1 + n * unit, w, rest * unit - 0.03, 5, { fill: alpha('coral', 0.55) });
        g.line([x0 - 0.15, -2.12], [x0 + w + 0.15, -2.12], { color: 'muted', width: 2 });
        const face = L < 0.3 ? '😌' : L < 1.2 ? '🙂' : L < 2.5 ? '😮' : '😱';
        g.emoji(face, [x0 + w / 2, -2.1 + H + 0.42], 26);
        g.emoji(ANIMALS[s.truth], [x0 + w / 2, -2.1 + H + 0.95], 16);
      }
    }
  },
};
