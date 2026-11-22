// Bell curves appear whenever many little random pushes add up: balls bouncing
// through pegs, sums of dice. In 2D the bell is a fuzzy blob whose shape is the
// covariance ellipse — stretch it, tilt it, and the dots follow.
import { C, alpha } from '../viz/palette.js';
import { cholesky, covariance, mean, mvec, inv } from '../core/linalg.js';
import { gauss1 } from '../core/estimation.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const ROWS = 12, DY = 0.33, TOP = 3.25, SP = 0.5;
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };

export default {
  eq: [
    [['N(x; μ, σ²)', 'purple'], ' = e^{−(x−μ)²/2σ²} / √(2πσ²)'],
    ['sum of n dice:  ', ['μ = 3.5n', 'purple'], ' ,  ', ['σ² = 35n/12', 'purple'], '   (central limit theorem)'],
    [['x', 'teal'], ' = μ + ', ['L', 'orange'], 'z ,   ', ['L', 'orange'], ['L', 'orange'], 'ᵀ = ', ['Σ', 'purple'], ' ,   z ~ N(0, I)'],
    ['1σ, 2σ, 3σ:  1D → 68%, 95%, 99.7%    2D → 39%, 86%, 99%'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const R = rng(5);
    const s = {
      beat: 0, p: 0.5, balls: [], bins: new Array(ROWS + 1).fill(0), spawn: 0,
      nd: 3, dice: [], sums: {}, rolls: 0, tick: 0,
      ang: 0.6, s1: 1.4, s2: 0.55,
    };
    const wide = (W, H) => W >= H * 1.05;
    const PA = stage.pen((W, H) => (s.beat !== 3 ? Z : wide(W, H) ? { x: 0, y: 0, w: 0.45, h: 1 } : { x: 0, y: 0, w: 1, h: 0.42 }), [-3.7, -1.45, 4.5, 2.3], { frame: true });
    const PB = stage.pen((W, H) => (s.beat !== 3 ? Z : wide(W, H) ? { x: 0.45, y: 0, w: 0.55, h: 1 } : { x: 0, y: 0.42, w: 1, h: 0.58 }), [-3.4, -3.1, 3.4, 3.1], { frame: true });
    const Zs = Array.from({ length: 500 }, () => [R.normal(), R.normal()]);
    const Z1 = Array.from({ length: 20000 }, () => R.normal());
    const frac1 = [1, 2, 3].map((k) => Z1.filter((x) => Math.abs(x) <= k).length / Z1.length);
    const Sigma = () => {
      const c = Math.cos(s.ang), sn = Math.sin(s.ang), a = s.s1 * s.s1, b = s.s2 * s.s2;
      return [[c * c * a + sn * sn * b, c * sn * (a - b)], [c * sn * (a - b), sn * sn * a + c * c * b]];
    };
    const points = () => { const L = cholesky(Sigma()); return Zs.map((z) => mvec(L, z)); };

    const resetBoard = () => { s.balls = []; s.bins = new Array(ROWS + 1).fill(0); };
    const resetDice = () => { s.sums = {}; s.rolls = 0; s.dice = []; };
    const setBeat = (b) => {
      s.beat = b;
      g.setBounds(b === 0 ? [-4, -3.75, 4, 3.6] : b === 1 ? [-4.2, -2.4, 4.2, 3.4] : [-3.6, -3.2, 3.6, 3.2]);
      PA.layout(); PB.layout();
      showGroups();
    };

    // covariance handles (in beat 2 on g, in beat 3 on PB)
    for (const pen of [g, PB]) {
      const vis = pen === g ? () => s.beat === 2 : () => s.beat === 3;
      stage.handle({ pen, color: 'purple', r: 11, visible: vis, get: () => [s.s1 * Math.cos(s.ang), s.s1 * Math.sin(s.ang)], set: (p) => { s.s1 = clamp(Math.hypot(...p), 0.2, 2.8); s.ang = Math.atan2(p[1], p[0]); if (s.s2 > s.s1) s.s2 = s.s1; } });
      stage.handle({ pen, color: 'purple', r: 9, kind: 'ring', visible: vis, get: () => [-s.s2 * Math.sin(s.ang), s.s2 * Math.cos(s.ang)], set: (p) => { s.s2 = clamp(-p[0] * Math.sin(s.ang) + p[1] * Math.cos(s.ang), 0.12, s.s1); } });
    }

    const groups = [ui.group(), ui.group(), ui.group()];
    ui.slider({ into: groups[0], icon: '⚖️', color: 'purple', min: 0.15, max: 0.85, step: 0.01, value: s.p, title: 'bounce right chance', onInput: (v) => { s.p = v; resetBoard(); } });
    ui.button({ into: groups[0], icon: '🧹', title: 'empty bins', onClick: resetBoard });
    ui.slider({ into: groups[1], icon: '🎲', color: 'orange', min: 1, max: 10, step: 1, value: s.nd, title: 'number of dice', onInput: (v) => { s.nd = v; resetDice(); } });
    ui.button({ into: groups[2], icon: '⚪', title: 'round blob', onClick: () => { s.s1 = 1.1; s.s2 = 1.1; } });
    ui.button({ into: groups[2], icon: '🥖', title: 'tilted blob', onClick: () => { s.s1 = 1.8; s.s2 = 0.35; s.ang = 0.75; } });
    ui.readout(() => {
      if (s.beat === 0) return String(s.bins.reduce((a, b) => a + b, 0));
      if (s.beat === 1) return String(s.rolls);
      const S = Sigma(); return 'ρ ' + fmt(S[0][1] / Math.sqrt(S[0][0] * S[1][1]), 2);
    }, { icon: '🔢', color: 'teal', title: 'count / correlation' });
    function showGroups() { groups.forEach((gr, i) => (gr.style.display = i === Math.min(s.beat, 2) ? '' : 'none')); }
    const prefill = () => { for (let i = 0; i < 160; i++) { let k = 0; for (let r = 0; r < ROWS; r++) if (R() < s.p) k++; s.bins[k]++; } };
    prefill();
    ui.beats(['📍', '🎲', '🫧', '🎯'], setBeat);
    setBeat(0);

    return {
      update(dt) {
        if (s.beat === 0) {
          s.spawn += dt * 24;
          while (s.spawn > 1) {
            s.spawn -= 1;
            const path = []; let k = 0;
            for (let r = 0; r < ROWS; r++) { const right = R() < s.p; path.push(right); if (right) k++; }
            s.balls.push({ path, u: 0, k, jit: R.uniform(-0.08, 0.08) });
          }
          for (const b of s.balls) b.u += dt * 11;
          s.balls = s.balls.filter((b) => { if (b.u >= ROWS + 1.5) { s.bins[b.k]++; return false; } return true; });
        } else if (s.beat === 1) {
          s.tick += dt * 18;
          while (s.tick > 1) {
            s.tick -= 1;
            s.dice = Array.from({ length: s.nd }, () => R.int(1, 7));
            const sum = s.dice.reduce((a, b) => a + b, 0);
            s.sums[sum] = (s.sums[sum] ?? 0) + 1; s.rolls++;
          }
        }
      },
      draw() {
        if (s.beat === 0) drawGalton();
        else if (s.beat === 1) drawDice();
        else if (s.beat === 2) drawCloud(g, false);
        else { drawBell(); drawCloud(PB, true); }
      },
    };

    // ---------------------------------------------------------------- Galton board
    function ballPos(b) {
      const r = Math.min(Math.floor(b.u), ROWS), f = b.u - r;
      let k = 0; for (let i = 0; i < r; i++) if (b.path[i]) k++;
      const pegX = (row, kk) => (kk - row / 2) * SP;
      if (r >= ROWS) {
        const x = pegX(ROWS, k), y0 = TOP - ROWS * DY;
        return [x + b.jit, y0 - (b.u - ROWS) * 1.4];
      }
      const x0 = pegX(r, k), x1 = pegX(r + 1, k + (b.path[r] ? 1 : 0));
      const y0 = TOP - r * DY + 0.14, y1 = TOP - (r + 1) * DY + 0.14;
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f + Math.sin(f * Math.PI) * 0.12];
    }
    function drawGalton() {
      g.grid({ step: 1, axes: false });
      const base = -3.6, H = 2.3, total = s.bins.reduce((a, b) => a + b, 0);
      // funnel
      g.path([[-1.2, TOP + 0.5], [-0.18, TOP + 0.12]], { color: 'slate', width: 4 });
      g.path([[1.2, TOP + 0.5], [0.18, TOP + 0.12]], { color: 'slate', width: 4 });
      for (let r = 0; r < ROWS; r++) for (let k = 0; k <= r; k++) g.dot([(k - r / 2) * SP, TOP - r * DY], 3.5, { color: 'slate' });
      // bins
      const expect = s.bins.map((_, k) => binom(ROWS, k) * s.p ** k * (1 - s.p) ** (ROWS - k));
      const scale = H / Math.max(Math.max(...s.bins) / Math.max(total, 1), Math.max(...expect) * 1.05);
      for (let k = 0; k <= ROWS; k++) {
        const x = (k - ROWS / 2) * SP;
        g.line([x - SP / 2, base], [x - SP / 2, base + H + 0.1], { color: alpha('slate', 0.35), width: 1.5 });
        if (total) g.bar(x - SP * 0.4, base, SP * 0.8, (s.bins[k] / total) * scale, { color: alpha('teal', 0.85), r: 3 });
      }
      g.line([-ROWS / 2 * SP - SP / 2, base], [ROWS / 2 * SP + SP / 2, base], { color: 'slate', width: 3 });
      // the bell it is heading for (binomial → normal)
      const mu = ROWS * s.p, sd = Math.sqrt(ROWS * s.p * (1 - s.p));
      g.plot((x) => base + gauss1(x / SP + ROWS / 2, mu, sd) * scale, { color: 'purple', width: 3, range: [-3.4, 0, 3.4] });
      for (const b of s.balls) g.dot(ballPos(b), 5, { color: 'teal', ring: 'bg', ringWidth: 1 });
    }

    // ---------------------------------------------------------------- dice
    function drawDie(c, v, sz) {
      g.rrect(c[0] - sz / 2, c[1] - sz / 2, sz, sz, 6, { fill: 'panel', color: 'ink', width: 2 });
      const P = { 1: [[0, 0]], 2: [[-1, 1], [1, -1]], 3: [[-1, 1], [0, 0], [1, -1]], 4: [[-1, 1], [1, 1], [-1, -1], [1, -1]], 5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]], 6: [[-1, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]] }[v];
      for (const [a, b] of P) g.dot([c[0] + a * sz * 0.27, c[1] + b * sz * 0.27], Math.max(2, g.px(sz) * 0.09), { color: 'orange' });
    }
    function drawDice() {
      g.grid({ step: 1, axes: false });
      const n = s.nd, lo = n, hi = 6 * n, X = (v) => -3.8 + ((v - lo + 0.5) / (hi - lo + 1)) * 7.6, w = 7.6 / (hi - lo + 1);
      const sz = Math.min(0.62, 7 / n * 0.8);
      s.dice.forEach((v, i) => drawDie([(i - (n - 1) / 2) * sz * 1.25, 2.75], v, sz));
      const base = -1.9, H = 3.6;
      const mu = 3.5 * n, sd = Math.sqrt((35 / 12) * n);
      const peak = Math.max(...Object.values(s.sums).map((c) => c / Math.max(1, s.rolls)), gauss1(mu, mu, sd));
      const sc = H / peak / 1.05;
      for (let v = lo; v <= hi; v++) { const c = (s.sums[v] ?? 0) / Math.max(1, s.rolls); if (c) g.bar(X(v) - w * 0.42, base, w * 0.84, c * sc, { color: alpha('teal', 0.85), r: 2 }); }
      g.line([-3.9, base], [3.9, base], { color: 'slate', width: 2 });
      if (n > 1) g.plot((x) => base + gauss1(lo - 0.5 + ((x + 3.8) / 7.6) * (hi - lo + 1), mu, sd) * sc, { color: 'purple', width: 3, range: [-3.8, 0, 3.8] });
      const sum = s.dice.reduce((a, b) => a + b, 0);
      if (sum) { g.arrow([X(sum), 2.1], [X(sum), base + ((s.sums[sum] ?? 0) / Math.max(1, s.rolls)) * sc + 0.15], { color: alpha('orange', 0.7), width: 2.5 }); g.text(String(sum), [X(sum), 1.95 + 0.0], { color: 'orange', size: 16, weight: 800, dy: -2 }); }
      for (const v of [lo, Math.round(mu), hi]) g.text(String(v), [X(v), base - 0.25], { color: 'muted', size: 12 });
    }

    // ---------------------------------------------------------------- 2D cloud
    function drawCloud(P, rings) {
      P.grid({ step: 1 });
      const pts = points(), S = Sigma();
      if (!rings) {
        // marginal bells on the edges
        const [x0, y0, , y1] = P.view;
        P.plot((x) => y0 + 0.05 + gauss1(x, 0, Math.sqrt(S[0][0])) * 1.3, { color: alpha('purple', 0.8), width: 2.5, fillTo: y0 + 0.05, fillAlpha: 0.12 });
        const side = []; for (let i = 0; i <= 120; i++) { const y = y0 + (y1 - y0) * i / 120; side.push([x0 + 0.05 + gauss1(y, 0, Math.sqrt(S[1][1])) * 1.3, y]); }
        P.path(side, { color: alpha('purple', 0.8), width: 2.5 });
      }
      for (const p of pts) P.dot(p, 2.6, { color: alpha('teal', 0.75) });
      if (rings) {
        const Si = inv(S), m = pts.map((p) => p[0] * (Si[0][0] * p[0] + Si[0][1] * p[1]) + p[1] * (Si[1][0] * p[0] + Si[1][1] * p[1]));
        [1, 2, 3].forEach((k) => {
          P.cov([0, 0], S, k, { color: 'purple', width: 3 - (k - 1) * 0.6, dash: k === 1 ? [] : [7, 5] });
          const frac = m.filter((d) => d <= k * k).length / m.length;
          const dir = [-Math.cos(s.ang), -Math.sin(s.ang)];
          P.text(Math.round(frac * 100) + '%', [dir[0] * (s.s1 * k + 0.3), dir[1] * (s.s1 * k + 0.3)], { color: 'purple', size: 15, weight: 800 });
        });
      } else {
        P.blob([0, 0], Math.sqrt((S[0][0] + S[1][1]) / 2) * 0.6, { color: 'purple', alpha: 0.25 });
        P.cov([0, 0], S, 1, { color: 'purple', width: 3.5 });
        const Se = covariance(pts), mu = mean(pts);
        P.cov(mu, Se, 1, { color: 'teal', width: 2, dash: [6, 5] });
        // the two axes of the ellipse (what the handles grab)
        P.line([0, 0], [s.s1 * Math.cos(s.ang), s.s1 * Math.sin(s.ang)], { color: alpha('purple', 0.6), width: 2 });
        P.line([0, 0], [-s.s2 * Math.sin(s.ang), s.s2 * Math.cos(s.ang)], { color: alpha('purple', 0.6), width: 2 });
        P.text('σ₁', [s.s1 * Math.cos(s.ang) * 1.18, s.s1 * Math.sin(s.ang) * 1.18 + 0.25], { color: 'purple', size: 16 });
      }
      P.dot([0, 0], 4, { color: 'ink' });
    }
    function drawBell() {
      const P = PA;
      P.grid({ step: 1, axes: false });
      const f = (x) => gauss1(x, 0, 1) * 5.2;
      for (let k = 3; k >= 1; k--) {
        const pts = []; for (let i = 0; i <= 80; i++) { const x = -k + (2 * k * i) / 80; pts.push([x, f(x)]); }
        P.poly([[-k, 0], ...pts, [k, 0]], { fill: alpha('purple', 0.14 + (3 - k) * 0.12), stroke: false });
        P.line([-k, 0], [-k, f(k) + 0.05], { color: alpha('purple', 0.6), width: 1.5 });
        P.line([k, 0], [k, f(k) + 0.05], { color: alpha('purple', 0.6), width: 1.5 });
      }
      P.plot(f, { color: 'purple', width: 3.5, range: [-3.5, 0, 3.5] });
      P.line([-3.5, 0], [3.5, 0], { color: 'slate', width: 2 });
      for (let k = 1; k <= 3; k++) {
        const meas = frac1[k - 1];
        const y = -0.42 - (k - 1) * 0.32;
        P.line([-k, y], [k, y], { color: alpha('purple', 0.95 - (k - 1) * 0.25), width: 8 });
        P.text(`${k}σ`, [k, 0.18 - 0.0], { color: 'purple', size: 13, weight: 800, dy: -2 });
        P.text(Math.round(meas * 1000) / 10 + '%', [k + 0.2, y], { color: 'purple', size: 14, weight: 800, align: 'left' });
      }
    }
  },
};
const Z = { x: 0, y: 0, w: 0, h: 0 };
void C;
