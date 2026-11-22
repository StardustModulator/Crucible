// ICP: nobody tells us which dot goes with which. So we GUESS — every blue dot
// grabs its nearest gold dot (spaghetti!) — solve the best turn for those guesses,
// snap, and guess again. Good start: it clicks into place. Bad start: stuck.
import { alpha, col } from '../viz/palette.js';
import { icpStep, kabsch } from '../core/estimation.js';
import { mean, mvec, rot2, vadd, vsub } from '../core/linalg.js';
import { rng, smoothstep, wrapAngle } from '../core/random.js';
import { fmt } from '../viz/ui.js';
import { dino, dinoEye, hudPlot, centroidMark } from './registration.js';

const SCALE = 1.15;
const STARTS = [
  { th: 0.55, t: [-2.2, 0.9] },   // 🧷 good start
  { th: 2.7, t: [-1.2, -0.6] },   // 😵 bad start: flipped around
  { th: 0.5, t: [-2.0, -0.8] },   // 🫨 noise + junk
  { th: 1.4, t: [0, 0] },         // 🎯 basin dial
];

export default {
  eq: [
    ['repeat:'],
    ['  1. ', ['j(i)', 'teal'], ' = nearest ', ['q', 'gold'], ' to ', ['pᵢ', 'blue'], '        (guess the matches)'],
    ['  2. ', ['R', 'orange'], ', ', ['t', 'orange'], ' = argmin Σ ‖', ['R', 'orange'], ' ', ['pᵢ', 'blue'], ' + ', ['t', 'orange'], ' − ', ['q', 'gold'], ['ⱼ₍ᵢ₎', 'teal'], '‖²   (SVD, like point matching)'],
    ['  3. ', ['pᵢ', 'blue'], ' ← ', ['R', 'orange'], ' ', ['pᵢ', 'blue'], ' + ', ['t', 'orange'], '      until ', ['error', 'coral'], ' stops falling'],
    ['only finds the ', ['nearest valley', 'coral'], ': start must be close enough'],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait;
    const g = stage.g.setBounds(tall ? [-3.7, -5.6, 3.7, 4.6] : [-6.8, -3.4, 5.8, 3.4]);
    const tgtC = tall ? [0, 0.9] : [1.5, 0];
    const Q = dino(64, SCALE).map((p) => vadd(p, tgtC));      // the model (gold)
    const eye = dinoEye(64, SCALE);
    const scanBase = dino(34, SCALE);                             // what the sensor sees (different dots!)
    const s = {
      beat: 0, noise: 0, junk: 0, seed: 3,
      start: null,
      pts: [], prev: null, pairs: null, step: null, errs: [], trueErrs: [], iter: 0,
      phase: 'look', ph: 0, auto: true, done: false, hold: 0, basin: null, basinKey: '',
    };
    const starts = STARTS.map((st) => ({ th: st.th, t: tall ? [st.t[1] * 0.7, st.t[0] * 1.05] : [...st.t] }));

    const scan = () => {
      const r = rng(s.seed);
      const pts = scanBase.map((p) => [p[0] + r.normal(0, s.noise), p[1] + r.normal(0, s.noise)]);
      const nJ = Math.round(s.junk * scanBase.length);
      for (let i = 0; i < nJ; i++) pts.push([r.uniform(-2.6, 2.6), r.uniform(-1.8, 1.8)]);
      return pts;
    };
    // source pose: rotate by th about the model's middle, then shift by t
    const placed = (st) => scan().map((p) => vadd(vadd(mvec(rot2(st.th), p), tgtC), st.t));
    const reset = () => {
      s.pts = placed(s.start); s.prev = null; s.pairs = null; s.errs = []; s.trueErrs = []; s.iter = 0;
      s.phase = 'look'; s.ph = 0; s.done = false; s.hold = 0;
      look();
    };
    // the real pose error: where did the true (un-noised) dino end up?
    const truePose = () => {
      const k = scanBase.length;
      const sol = kabsch(scanBase.map((p) => vadd(p, tgtC)), s.pts.slice(0, k));
      return { th: Math.atan2(sol.R[1][0], sol.R[0][0]), sol };
    };
    const look = () => {
      s.step = icpStep(s.pts, Q);
      s.pairs = s.step.pairs;
      s.errs.push(Math.sqrt(s.step.err));
      s.trueErrs.push(Math.abs(wrapAngle(truePose().th)));
    };
    const stepOnce = () => {
      if (s.done) return;
      s.prev = s.pts; s.pts = s.step.points; s.iter++;
      const last = s.errs.at(-1);
      look();
      if (s.iter >= 40 || Math.abs(last - s.errs.at(-1)) < 1e-5) { s.done = true; s.hold = 0; }
    };

    // drag the start: square = slide, ring = turn
    const lever = () => vadd(vadd(tgtC, s.start.t), mvec(rot2(s.start.th), [0, s.beat === 3 ? 2.9 : 2.0]));
    stage.handle({ pen: g, color: 'blue', kind: 'square', icon: '✋', r: 10, visible: () => s.beat !== 3, get: () => vadd(tgtC, s.start.t), set: (p) => { s.start.t = vsub(p, tgtC); reset(); } });
    stage.handle({ pen: g, color: 'orange', kind: 'ring', r: 10, get: lever, set: (p) => { const c = vadd(tgtC, s.start.t); s.start.th = Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.PI / 2; reset(); } });

    const sliders = [];
    ui.beats(['🧷', '😵', '🫨', '🎯'], (b) => {
      s.beat = b; s.start = { th: starts[b].th, t: [...starts[b].t] };
      if (b === 2 && s.noise === 0 && s.junk === 0) { s.noise = 0.08; s.junk = 0.25; sliders[0].set(0.08); sliders[1].set(0.25); }
      if (b !== 2) { s.noise = 0; s.junk = 0; sliders[0].set(0); sliders[1].set(0); }
      reset();
    });
    ui.button({ icon: '👣', title: 'one step', onClick: () => { s.auto = false; autoT.set(false, false); if (s.done) reset(); else s.go = true; } });
    const autoT = ui.toggle({ icon: '🔁', title: 'auto play', value: true, color: 'teal', onChange: (v) => (s.auto = v) });
    ui.button({ icon: '🔀', title: 'random start', onClick: () => { const r = rng(++s.seed * 13); s.start = { th: r.uniform(-Math.PI, Math.PI), t: s.beat === 3 ? [0, 0] : [r.uniform(-2.4, 0), r.uniform(-1, 1)] }; reset(); } });
    sliders.push(ui.slider({ icon: '🫨', color: 'purple', min: 0, max: 0.25, value: 0, title: 'sensor noise', onInput: (v) => { s.noise = v; reset(); } }));
    sliders.push(ui.slider({ icon: '🗑️', color: 'purple', min: 0, max: 0.6, value: 0, title: 'junk points', onInput: (v) => { s.junk = v; reset(); } }));
    ui.readout(() => s.iter, { icon: '🔁', color: 'teal', title: 'iterations' });
    ui.readout(() => fmt(s.errs.at(-1) ?? 0, 2), { icon: '📏', color: 'coral', title: 'nearest-dot error' });

    // 🎯 basin: from each starting turn, does ICP find home?
    const basin = () => {
      const key = `${s.noise}|${s.junk}|${s.seed}`;
      if (s.basinKey === key) return s.basin;
      const out = [];
      for (let k = 0; k < 36; k++) {
        const th = -Math.PI + (k + 0.5) * (2 * Math.PI / 36);
        let pts = placed({ th, t: [0, 0] });
        for (let it = 0; it < 40; it++) pts = icpStep(pts, Q).points;
        const sol = kabsch(scanBase.map((p) => vadd(p, tgtC)), pts.slice(0, scanBase.length));
        out.push(Math.abs(Math.atan2(sol.R[1][0], sol.R[0][0])) < 0.17);
      }
      s.basin = out; s.basinKey = key;
      return out;
    };
    s.start = { th: starts[0].th, t: [...starts[0].t] };
    reset();

    return {
      update(dt) {
        if (s.done) { s.hold += dt; if (s.auto && s.hold > 2.6) reset(); return; }
        const speed = Math.max(0.3, 0.88 ** s.iter);
        s.ph += dt / ((s.phase === 'look' ? 0.5 : 0.38) * speed);
        if (s.ph >= 1) {
          if (s.phase === 'look') {
            if (!s.auto && !s.go) { s.ph = 1; return; }
            s.go = false; s.phase = 'snap'; s.ph = 0; s.from = s.pts; stepOnce(); s.to = s.pts;
          }
          else { s.phase = 'look'; s.ph = 0; }
        }
      },
      draw() {
        g.grid({ step: 1 });
        const cur = s.phase === 'snap' && s.from ? interp(s.from, s.ph) : s.pts;
        if (s.beat === 3) drawBasin();
        // model
        g.poly(Q, { fill: alpha('gold', 0.1), color: alpha('gold', 0.55), width: 1.5 });
        Q.forEach((q) => g.dot(q, 3.2, { color: 'gold' }));
        g.dot(vadd(eye, tgtC), 3.5, { color: 'ink' });
        // spaghetti: every blue dot → its nearest gold dot
        if (s.phase === 'look' && s.pairs) {
          const a = Math.min(1, s.ph * 2.2);
          s.pts.forEach((p, i) => g.line(p, Q[s.pairs[i].j], { color: alpha('teal', 0.75 * a), width: 1.4 }));
        }
        // scan
        const k = scanBase.length;
        g.path([...cur.slice(0, k), cur[0]], { color: alpha('blue', 0.45), width: 1.5 });
        cur.forEach((p, i) => g.dot(p, i < k ? 4.6 : 4, { color: i < k ? 'blue' : alpha('blue', 0.7), ring: i < k ? null : 'purple' }));
        const sol = kabsch(scanBase, cur.slice(0, k));
        g.dot(vadd(mvec(sol.R, eye), sol.t), 3.5, { color: 'ink' });
        g.line(vadd(tgtC, s.start.t), lever(), { color: alpha('orange', 0.5), width: 2, dash: [3, 4] });
        if (s.beat !== 3) centroidMark(g, vadd(tgtC, s.start.t), alpha('blue', 0.5), 6);
        if (s.done) {
          const ok = Math.abs(wrapAngle(truePose().th)) < 0.17;
          g.emoji(ok ? '✅' : '😵', vadd(tgtC, [0, 2.4]), 34);
        }
        // error per iteration
        const area = g.area, w = tall ? area.w - 24 : Math.min(300, area.w * 0.32), h = tall ? 84 : 120;
        hudPlot(stage.hud, { x: tall ? area.x + 12 : area.x + 12, y: tall ? area.y + area.h - h - 10 : area.y + 12, w, h },
          [{ vals: s.errs, color: 'coral', dots: true }], { icon: '📏', ymin: 0, ymax: (s.errs[0] ?? 1) * 1.08, n: Math.max(12, s.errs.length) });
      },
    };

    function interp(from, k) {
      // rigid in-between: turn about the old middle while sliding to the new middle
      const kk = smoothstep(k);
      const c0 = mean(from), c1 = mean(s.to);
      const sol = kabsch(from, s.to);
      const phi = Math.atan2(sol.R[1][0], sol.R[0][0]) * kk;
      const Rk = rot2(phi), c = vadd(c0, vsub(c1, c0).map((x) => x * kk));
      return from.map((p) => vadd(mvec(Rk, vsub(p, c0)), c));
    }
    function drawBasin() {
      const b = basin(), R0 = 2.7, R1 = 3.1;
      for (let i = 0; i < 36; i++) {
        const a0 = -Math.PI + i * (2 * Math.PI / 36) + Math.PI / 2, a1 = a0 + 2 * Math.PI / 36;
        const pts = [];
        for (let j = 0; j <= 4; j++) { const a = a0 + (a1 - a0) * j / 4; pts.push([tgtC[0] + Math.cos(a) * R1, tgtC[1] + Math.sin(a) * R1]); }
        for (let j = 4; j >= 0; j--) { const a = a0 + (a1 - a0) * j / 4; pts.push([tgtC[0] + Math.cos(a) * R0, tgtC[1] + Math.sin(a) * R0]); }
        g.poly(pts, { fill: alpha(b[i] ? 'lime' : 'coral', 0.55), color: col('bg'), width: 1 });
      }
      // home = no turn
      g.emoji('🏠', [tgtC[0], tgtC[1] + R1 + 0.3], 18);
    }
  },
};
