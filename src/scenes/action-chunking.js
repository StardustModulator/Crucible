// Action chunking: instead of one move at a time, the policy predicts a CHUNK
// of k future moves (a little ribbon 🍫). Play each chunk blindly → jerky jumps at
// the seams. Ask every step and trust only the newest → jittery. Average all the
// chunks that talk about "now", older ones weighted more (temporal ensembling) → smooth.
import { alpha, SERIES } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rng, clamp } from '../core/random.js';

const DT = 0.05, PERIOD = 12;
const ref = (t) => { const th = (2 * Math.PI * t) / PERIOD, r = 1.25 + 0.38 * Math.cos(3 * th); return [r * Math.cos(th), r * Math.sin(th)]; };
const MODES = ['chunk', 'newest', 'ensemble'];
const MODE_COL = { chunk: 'orange', newest: 'purple', ensemble: 'pink' };

// The "policy": looks at where the pen is and predicts the next k positions.
// It knows the plan, but each prediction has its own small bias + drift (noise).
function predict(x, i, k, sigma) {
  const R = rng(9001 + i * 7919);
  const b = [R.normal(0, sigma), R.normal(0, sigma)], dr = [R.normal(0, sigma / 25), R.normal(0, sigma / 25)];
  const off = [x[0] - ref(i * DT)[0], x[1] - ref(i * DT)[1]];
  return Array.from({ length: k }, (_, j) => {
    const r = ref((i + 1 + j) * DT), g = 0.8 ** (j + 1);
    return [r[0] + off[0] * g + b[0] + dr[0] * j, r[1] + off[1] * g + b[1] + dr[1] * j];
  });
}

function makeRunner(mode) {
  const x0 = ref(0);
  return { mode, i: 0, x: x0, prev: x0, prev2: x0, chunks: [], trail: [x0], jerk: 0, err: 0, n: 0, used: [] };
}

function stepRunner(r, k, sigma, m) {
  const i = r.i;
  if (r.mode !== 'chunk' || i % k === 0) r.chunks.push({ start: i, acts: predict(r.x, i, k, sigma) });
  r.chunks = r.chunks.filter((c) => c.start + c.acts.length > i);
  let a;
  r.used = [];
  if (r.mode === 'chunk') {
    const c = r.chunks[r.chunks.length - 1]; a = c.acts[i - c.start]; r.used = [{ c, w: 1 }];
  } else if (r.mode === 'newest') {
    const c = r.chunks[r.chunks.length - 1]; a = c.acts[0]; r.used = [{ c, w: 1 }];
  } else {
    // temporal ensemble: w = exp(−m · idx), idx 0 = OLDEST prediction for this step
    const live = r.chunks.filter((c) => i - c.start < c.acts.length);
    let sw = 0; a = [0, 0];
    live.forEach((c, idx) => { const w = Math.exp(-m * idx); sw += w; const p = c.acts[i - c.start]; a[0] += w * p[0]; a[1] += w * p[1]; r.used.push({ c, w }); });
    a = [a[0] / sw, a[1] / sw];
    r.used.forEach((u) => (u.w /= sw));
  }
  r.prev2 = r.prev; r.prev = r.x; r.x = a; r.i++;
  r.trail.push(a); if (r.trail.length > 140) r.trail.shift();
  const jx = r.x[0] - 2 * r.prev[0] + r.prev2[0], jy = r.x[1] - 2 * r.prev[1] + r.prev2[1];
  const e = ref(r.i * DT);
  r.jerk += jx * jx + jy * jy; // jerk energy: big jumps count a lot
  r.err += Math.hypot(r.x[0] - e[0], r.x[1] - e[1]); r.n++;
}

export default {
  eq: [
    [['π(o_t)', 'blue'], ' → ( ', ['a_t, a_{t+1}, …, a_{t+k−1}', 'orange'], ' )      one query = a chunk of ', ['k', 'orange'], ' actions'],
    ['🍫 open loop: query every ', ['k', 'orange'], ' steps → seams (jumps)       🔁 newest only → jitter'],
    ['🧈 ', ['â_t', 'pink'], ' = Σᵢ ', ['wᵢ', 'gold'], ' a_t^(i) / Σᵢ ', ['wᵢ', 'gold'], ',    ', ['wᵢ', 'gold'], ' = e^{−m·i}   (i = 0 is the oldest prediction)'],
    ['averaging ~k independent ', ['errors', 'purple'], ' shrinks them ≈ 1/√k  and blends the seams'],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[-1.9, -1.9, 1.9, 1.9], [0, 0, 10, 10]], [1.15, 1]);
    const s = { beat: 0, k: 10, sigma: 0.09, m: 0.1, acc: 0, runners: [makeRunner('chunk')] };
    const reset = () => {
      s.acc = 0;
      s.runners = s.beat === 3 ? MODES.map(makeRunner) : [makeRunner(MODES[s.beat])];
    };
    ui.slider({ icon: '🍫', title: 'chunk size k', color: 'orange', min: 1, max: 25, step: 1, value: s.k, onInput: (v) => { s.k = v; reset(); } });
    ui.slider({ icon: '🌫️', title: 'noise', color: 'purple', min: 0, max: 0.25, step: 0.005, value: s.sigma, onInput: (v) => (s.sigma = v) });
    ui.slider({ icon: '⚖️', title: 'ensemble weight decay m', color: 'gold', min: 0, max: 0.6, step: 0.01, value: s.m, onInput: (v) => (s.m = v) });
    ui.button({ icon: '🔁', title: 'start over', onClick: reset });
    ui.beats(['🍫', '🔁', '🧈', '📊'], (i) => { s.beat = i; reset(); });
    ui.readout(() => fmt(Math.sqrt(s.runners[0].jerk / Math.max(1, s.runners[0].n)) * 100, 1), { icon: '🫨', color: 'coral', title: 'jerkiness' });

    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        s.acc += dt;
        let n = 0;
        while (s.acc >= DT && n < 10) { s.acc -= DT; n++; s.runners.forEach((r) => stepRunner(r, s.k, s.sigma, s.m)); }
      },
      draw() {
        const f = clamp(s.acc / DT, 0, 1);
        A.grid({ step: 0.5 });
        const plan = []; for (let j = 0; j <= 200; j++) plan.push(ref((j / 200) * PERIOD));
        A.path(plan, { color: alpha('gold', 0.45), width: 3, dash: [7, 6] });

        if (s.beat < 3) {
          const r = s.runners[0];
          // live chunks: future ribbons in space
          r.chunks.forEach((c) => {
            const u = r.used.find((x) => x.c === c);
            const w = u ? u.w : 0.15;
            const col = SERIES[c.start % SERIES.length];
            const pts = c.acts.slice(Math.max(0, r.i - c.start - 1));
            A.path(pts, { color: alpha(col, clamp(0.15 + w * 1.6, 0.15, 0.95)), width: 2 + 5 * w });
          });
          if (r.mode === 'ensemble') {
            // the votes for "next": dots, opacity = weight
            r.used.forEach((u) => { const p = u.c.acts[r.i - 1 - u.c.start] ?? u.c.acts[0]; A.dot(p, 3 + 6 * u.w, { color: alpha(SERIES[u.c.start % SERIES.length], clamp(0.25 + u.w * 2, 0.25, 1)) }); });
          }
          A.pathGradient(r.trail, (j, t) => alpha('pink', 0.15 + 0.85 * t), { width: 3.5 });
          const tip = [r.prev[0] + (r.x[0] - r.prev[0]) * f, r.prev[1] + (r.x[1] - r.prev[1]) * f];
          A.dot(tip, 9, { color: 'pink', ring: 'bg', ringWidth: 2.5 });
          A.emoji('🖊️', [tip[0] + 0.14, tip[1] + 0.16], 20);
          drawTimeline(B, r, s.k);
        } else {
          s.runners.forEach((r) => {
            A.path(r.trail, { color: alpha(MODE_COL[r.mode], 0.85), width: 3 });
            A.dot(r.x, 7, { color: MODE_COL[r.mode], ring: 'bg' });
          });
          drawCompare(B, s.runners);
        }
      },
    };
  },
};

function drawTimeline(B, r, k) {
  // time runs left → right; each chunk is a ribbon covering the steps it predicts
  const win = 50, i0 = r.i - 32;
  const X = (step) => 0.4 + ((step - i0) / win) * 9.2;
  const rows = r.mode === 'chunk' ? 1 : Math.max(1, k);
  const rowH = Math.min(1.1, 7.6 / rows);
  const yOf = (c) => (r.mode === 'chunk' ? 5 : 9 - ((c.start % rows) + 0.5) * (8 / rows));
  B.clip(() => {
    const hist = (r.hist = (r.hist ?? []).filter((c) => c.start + c.acts.length > i0));
    r.chunks.forEach((c) => { if (!hist.includes(c)) hist.push(c); });
    hist.forEach((c) => {
      const u = r.used.find((x) => x.c === c);
      const live = c.start + c.acts.length > r.i - 1;
      const w = u ? u.w : 0;
      const col = SERIES[c.start % SERIES.length];
      const x0 = X(c.start + 1), x1 = X(c.start + c.acts.length + 1), y = yOf(c);
      const a = live ? clamp(0.25 + w * 1.8, 0.25, 1) : 0.12;
      B.rrect(x0, y - rowH / 2, x1 - x0, rowH * 0.9, 4, { fill: alpha(col, a) });
      if (r.mode === 'chunk') for (let j = 1; j < c.acts.length; j++) B.line([X(c.start + 1 + j), y - rowH / 2], [X(c.start + 1 + j), y + rowH * 0.4], { color: alpha('bg', 0.5), width: 1 });
    });
  });
  // "now" cursor
  B.line([X(r.i), 0.3], [X(r.i), 9.7], { color: 'pink', width: 3 });
  B.emoji('⏱️', [X(r.i), 0.25], 18);
}

function drawCompare(B, runners) {
  const items = runners.map((r) => ({ c: MODE_COL[r.mode], j: Math.sqrt(r.jerk / Math.max(1, r.n)), e: r.err / Math.max(1, r.n), ic: r.mode === 'chunk' ? '🍫' : r.mode === 'newest' ? '🔁' : '🧈' }));
  const jm = Math.max(...items.map((x) => x.j), 1e-6), em = Math.max(...items.map((x) => x.e), 1e-6);
  B.emoji('🫨', [1.0, 9.3], 24);
  B.emoji('🎯', [1.0, 4.3], 24);
  items.forEach((it, k) => {
    const x = 2.2 + k * 2.5;
    B.bar(x, 5.6, 1.4, (it.j / jm) * 3.4, { color: it.c });
    B.bar(x, 0.6, 1.4, (it.e / em) * 3.4, { color: it.c });
    B.emoji(it.ic, [x + 0.7, 5.15], 20);
  });
  B.line([1.8, 5.6], [9.6, 5.6], { color: alpha('muted', 0.4), width: 1 });
  B.line([1.8, 0.6], [9.6, 0.6], { color: alpha('muted', 0.4), width: 1 });
}
