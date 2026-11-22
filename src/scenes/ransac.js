// RANSAC: lots of dots, some are junk. Pick two at random, draw the line through
// them, and let every dot VOTE if it sits inside the stripe. Most votes wins.
// Plain least squares listens to everybody — so the junk drags it off.
import { C, alpha, col } from '../viz/palette.js';
import { ransacLine, ransacIterations, fitLineOLS, fitLineTLS } from '../core/estimation.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const NPTS = 64, TRIES = 32;

export default {
  eq: [
    ['pick ', ['s', 'orange'], ' = 2 random dots → line;  ', ['votes', 'teal'], ' = #dots with ', ['|dist| < τ', 'purple']],
    ['keep the line with the most ', ['votes', 'teal'], ' → refit on its ', ['inliers', 'teal'], ' → ', ['best', 'gold']],
    ['least squares: min Σ ', ['rᵢ²', 'coral'], ' over ALL dots (one far dot ⇒ huge ', ['r²', 'coral'], ')'],
    ['P(all ', ['N', 'gold'], ' tries fail) = (1 − ', ['w', 'teal'], '^', ['s', 'orange'], ')^', ['N', 'gold'], ' ≤ 1 − ', ['p', 'gold']],
    [['N', 'gold'], ' = log(1 − ', ['p', 'gold'], ') / log(1 − ', ['w', 'teal'], '^', ['s', 'orange'], ')'],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait;
    const [g, R] = stage.split([[-5, -3.3, 5, 3.3], [0, 0, 10, 6.6]], tall ? [1.25, 1] : [1.7, 1]);
    const s = {
      beat: 0, junk: 0.35, thresh: 0.28, seed: 11, round: 0,
      a: [-4.2, -1.9], b: [4.2, 1.6], pts: [], truthIn: [],
      res: null, k: 0, t: 0, done: false, hold: 0,
    };
    const gen = () => {
      const r = rng(s.seed);
      const nOut = Math.round(NPTS * s.junk), nIn = NPTS - nOut;
      s.pts = []; s.truthIn = [];
      for (let i = 0; i < nIn; i++) {
        const u = r.uniform(0.02, 0.98);
        const p = [s.a[0] + (s.b[0] - s.a[0]) * u, s.a[1] + (s.b[1] - s.a[1]) * u];
        const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), n = [-(s.b[1] - s.a[1]) / L, (s.b[0] - s.a[0]) / L];
        const e = r.normal(0, 0.09);
        s.pts.push([p[0] + n[0] * e, p[1] + n[1] * e]); s.truthIn.push(true);
      }
      // junk: some scattered, a clump on one side (that's what really hurts least squares)
      for (let i = 0; i < nOut; i++) {
        const clump = i % 3 === 0;
        s.pts.push(clump ? [r.normal(2.6, 0.5), r.normal(-2.3, 0.35)] : [r.uniform(-4.8, 4.8), r.uniform(-3.1, 3.1)]);
        s.truthIn.push(false);
      }
      const order = r.shuffle([...s.pts.keys()]);
      s.pts = order.map((i) => s.pts[i]); s.truthIn = order.map((i) => s.truthIn[i]);
      newRound(false);
    };
    const newRound = (reseed = true) => {
      if (reseed) s.round++;
      s.res = ransacLine(s.pts, { iters: TRIES, thresh: s.thresh, seed: 100 + s.round });
      s.k = 0; s.t = 0; s.done = false; s.hold = 0;
    };
    const clampP = (p) => [clamp(p[0], -4.8, 4.8), clamp(p[1], -3.1, 3.1)];
    stage.handle({ pen: g, color: 'lime', r: 10, get: () => s.a, set: (p) => { s.a = clampP(p); if (Math.abs(s.b[0] - s.a[0]) < 1) s.a[0] = s.b[0] - Math.sign(s.b[0] - s.a[0] || 1); gen(); } });
    stage.handle({ pen: g, color: 'lime', r: 10, get: () => s.b, set: (p) => { s.b = clampP(p); if (Math.abs(s.b[0] - s.a[0]) < 1) s.b[0] = s.a[0] + Math.sign(s.b[0] - s.a[0] || 1); gen(); } });

    ui.beats(['🗳️', '💥', '📏', '🎲'], (b) => {
      if (s.beat === 2 && b !== 2) { s.thresh = 0.28; thrS.set(0.28); }
      s.beat = b; s.breathe = b === 2; s.bt = 0; newRound();
    });
    ui.slider({ icon: '🗑️', color: 'coral', min: 0, max: 0.75, step: 0.01, value: s.junk, title: 'junk fraction', onInput: (v) => { s.junk = v; gen(); } });
    const thrS = ui.slider({ icon: '📏', color: 'purple', min: 0.05, max: 1.4, step: 0.01, value: s.thresh, title: 'stripe width', onInput: (v) => { s.breathe = false; s.thresh = v; newRound(false); } });
    ui.button({ icon: '🎲', title: 'new dots', onClick: () => { s.seed++; gen(); } });
    ui.readout(() => (s.best ? s.best.count : 0), { icon: '🏆', color: 'gold', title: 'most votes' });
    ui.readout(() => ransacIterations(0.99, Math.max(1 - s.junk, 0.05), 2), { icon: '🎲', color: 'gold', title: 'tries needed for 99%' });
    gen();

    const dur = () => (s.beat === 0 ? 0.7 : s.beat === 3 ? 0.4 : 0.16);
    const lineThrough = (p, d, o) => g.line([p[0] - d[0] * 30, p[1] - d[1] * 30], [p[0] + d[0] * 30, p[1] + d[1] * 30], o);
    const dirOf = (p, q) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[0] - p[0]) / L, (q[1] - p[1]) / L]; };

    return {
      update(dt) {
        if (s.breathe) {
          // the stripe breathes thin ↔ fat until you grab the slider
          s.bt += dt;
          s.thresh = 0.06 + 0.6 * (1 - Math.cos(s.bt * 0.9));
          thrS.set(s.thresh);
          const k = s.k, t = s.t, done = s.done, hold = s.hold;
          s.res = ransacLine(s.pts, { iters: TRIES, thresh: s.thresh, seed: 100 + s.round });
          Object.assign(s, { k: Math.min(k, s.res.history.length - 1), t, done, hold });
        }
        if (s.done) { s.hold += dt; if (s.hold > (s.beat === 0 ? 3 : 2.2)) newRound(); return; }
        s.t += dt / dur();
        if (s.t >= 1) { s.t = 0; s.k++; if (s.k >= s.res.history.length) { s.k = s.res.history.length - 1; s.done = true; s.hold = 0; } }
      },
      draw() {
        g.grid({ step: 1 });
        const H = s.res.history, cur = H[s.k];
        // best so far (up to and including the current try once its votes are in)
        const seen = H.slice(0, s.k + (s.t > 0.66 || s.done ? 1 : 0));
        let best = null, bi = -1;
        seen.forEach((h, i) => { if (!best || h.count > best.count) { best = h; bi = i; } });
        s.best = best;
        const showLS = s.beat >= 1;
        g.clip(() => {
          // truth
          lineThrough(s.a, dirOf(s.a, s.b), { color: alpha('lime', 0.75), width: 2, dash: [8, 6] });
          // least squares listens to everyone
          if (showLS) {
            const ols = fitLineOLS(s.pts);
            g.line([-6, ols.a * -6 + ols.b], [6, ols.a * 6 + ols.b], { color: 'coral', width: 4 });
            // the pull: residuals of the junk
            s.pts.forEach((p, i) => { if (!s.truthIn[i] && s.beat === 1) g.line(p, [p[0], ols.a * p[0] + ols.b], { color: alpha('coral', 0.35), width: 1.5 }); });
          }
          // best so far glows gold
          if (best) {
            if (s.done) {
              const inl = s.pts.filter((_, i) => best.inliers[i]);
              const L = fitLineTLS(inl);
              lineThrough(L.point, L.dir, { color: alpha('gold', 0.35), width: 14 });
              lineThrough(L.point, L.dir, { color: 'gold', width: 4.5 });
            } else {
              lineThrough(best.p, dirOf(best.p, best.q), { color: alpha('gold', 0.3), width: 12 });
              lineThrough(best.p, dirOf(best.p, best.q), { color: 'gold', width: 3 });
            }
          }
          // current candidate: pair → line → stripe → votes
          if (cur && !s.done) {
            const d = dirOf(cur.p, cur.q), n = [-d[1], d[0]], w = s.thresh;
            if (s.t > 0.33 || s.beat !== 0) {
              const A = [cur.p[0] - d[0] * 30, cur.p[1] - d[1] * 30], B = [cur.p[0] + d[0] * 30, cur.p[1] + d[1] * 30];
              g.poly([[A[0] + n[0] * w, A[1] + n[1] * w], [B[0] + n[0] * w, B[1] + n[1] * w], [B[0] - n[0] * w, B[1] - n[1] * w], [A[0] - n[0] * w, A[1] - n[1] * w]], { fill: alpha('purple', 0.14), color: alpha('purple', 0.4), width: 1 });
              lineThrough(cur.p, d, { color: 'blue', width: 2.5 });
            }
          }
        });
        // the dots
        const voting = cur && !s.done && (s.t > 0.66 || s.beat !== 0);
        s.pts.forEach((p, i) => {
          const isIn = s.done ? best.inliers[i] : voting && cur.inliers[i];
          if (isIn) g.dot(p, 5.5, { color: 'teal', ring: 'bg' });
          else g.dot(p, 4.2, { color: alpha('muted', 0.85) });
        });
        if (cur && !s.done) {
          for (const p of [cur.p, cur.q]) { g.circle(p, g.world(10), { color: 'orange', width: 3 }); g.dot(p, 5, { color: 'orange' }); }
          if (voting) g.text(`🗳️ ${cur.count}`, [cur.q[0] + 0.15, cur.q[1] + 0.55], { size: 18, color: 'teal' });
        }
        if (s.done) g.emoji('🏆', [best.q[0], best.q[1] + 0.6], 26);

        // right panel
        R.fillBg('panel');
        if (s.beat < 3) tally(H, bi); else tries(H);
      },
    };

    // vote tally: one bar per try, the leader in gold
    function tally(H, bi) {
      const n = H.length, upto = s.done ? n : s.k + (s.t > 0.66 ? 1 : 0);
      const bw = 9.2 / n, top = 5.6;
      const trueIn = s.truthIn.filter(Boolean).length;
      R.line([0.4, 0.6], [9.8, 0.6], { color: 'muted', width: 1.5 });
      R.emoji('🗳️', [0.4, 6.15], 20, { align: 'left' });
      const y = (c) => 0.6 + (c / NPTS) * (top - 0.6) / 0.9;
      R.line([0.4, y(trueIn)], [9.8, y(trueIn)], { color: alpha('lime', 0.8), dash: [6, 5], width: 2 });
      for (let i = 0; i < upto; i++) {
        const h = H[i];
        R.bar(0.6 + i * bw, 0.6, bw * 0.78, y(h.count) - 0.6, { color: i === bi ? 'gold' : alpha('blue', 0.55) });
      }
      if (!s.done && H[s.k]) R.rect(0.6 + s.k * bw - 0.04, 0.55, bw * 0.86, Math.max(0.2, y(H[s.k].count) - 0.5), { color: 'orange', width: 2 });
      R.text(String(s.best ? s.best.count : 0), [9.6, 6.15], { color: 'gold', size: 20, align: 'right' });
    }
    // how many tries? chance that EVERY try so far picked junk, on a log ladder
    function tries(H) {
      const w = Math.max(1 - s.junk, 0.05), N = ransacIterations(0.99, w, 2);
      const K = Math.min(60, Math.max(12, Math.ceil(N * 1.35)));
      const bw = 9.0 / K;
      const yv = (p) => 0.7 + (1 - Math.log10(Math.max(p, 1e-3)) / -3) * 4.3;  // 1 → top, 0.001 → bottom
      R.line([0.6, 0.7], [9.8, 0.7], { color: 'muted', width: 1.5 });
      for (const [v, lab] of [[1, '100%'], [0.1, '10%'], [0.01, '1%']]) R.text(lab, [0.55, yv(v)], { size: 11, color: v === 0.01 ? 'gold' : 'muted', align: 'right' });
      R.line([0.65, yv(0.01)], [9.8, yv(0.01)], { color: 'gold', width: 2, dash: [6, 4] });
      // tries we actually made (the current round): a pair of dots per try, lime = both real
      const ok = H.map((h) => {
        const ii = s.pts.indexOf(h.p), jj = s.pts.indexOf(h.q);
        return [s.truthIn[ii], s.truthIn[jj]];
      });
      const upto = s.done ? H.length : s.k + 1;
      let firstWin = -1;
      for (let k = 1; k <= K; k++) {
        const pr = (1 - w * w) ** k, x = 0.8 + (k - 1) * bw;
        const below = pr <= 0.01;
        R.bar(x, 0.7, bw * 0.8, yv(pr) - 0.7, { color: k === N ? 'gold' : below ? alpha('purple', 0.25) : alpha('purple', 0.7) });
        if (k <= upto && k <= H.length) {
          const [a, b] = ok[k - 1];
          const r = Math.min(4, R.px(bw) * 0.22);
          R.dot([x + bw * 0.4, 5.55], r, { color: a ? 'lime' : 'coral' });
          R.dot([x + bw * 0.4, 5.85], r, { color: b ? 'lime' : 'coral' });
          if (a && b && firstWin < 0) firstWin = k;
        }
      }
      if (firstWin > 0) R.emoji('✅', [0.8 + (firstWin - 1) * bw + bw * 0.4, 6.3], 16);
      const xN = 0.8 + (N - 1) * bw + bw * 0.4;
      R.text(`N = ${N}`, [Math.min(xN, 8.6), yv((1 - w * w) ** N) + 0.55], { color: 'gold', size: 18 });
      R.text(`w = ${fmt(w, 2)}`, [9.7, 0.35], { color: 'teal', size: 13, align: 'right' });
      void C; void col;
    }
  },
};
