// Information = surprise. A rare thing happening is a BIG surprise (tall tower),
// a common thing is a small one. Entropy is the average tower height; a fair coin
// is the most surprising coin. KL is the extra surprise you get from believing
// the wrong odds — it vanishes exactly when your guess matches the truth.
import { C, alpha } from '../viz/palette.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

let BIT = 0.75;               // world height of one bit
const S = (p) => -Math.log2(Math.max(p, 1e-9));
const ANIMALS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦉', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐢', '🐙'];
const FRUIT = ['🍎', '🍌', '🍇', '🍊'];
const H2 = (p) => p * S(p) + (1 - p) * S(1 - p);

export default {
  eq: [
    [['surprise', 'gold'], '(x) = −log₂ ', ['p(x)', 'purple'], '      (bits)'],
    [['H(p)', 'gold'], ' = Σ ', ['p(x)', 'purple'], ' · (−log₂ ', ['p(x)', 'purple'], ')  = average tower height'],
    ['N equally likely things → ', ['log₂ N', 'gold'], ' yes/no questions'],
    [['H(p, q)', 'blue'], ' = Σ ', ['p', 'lime'], ' · (−log₂ ', ['q', 'blue'], ')      ', ['KL(p‖q)', 'coral'], ' = ', ['H(p, q)', 'blue'], ' − ', ['H(p)', 'lime'], ' ≥ 0'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const R = rng(17);
    const s = {
      beat: 0, p: 0.8, flips: [], tick: 0, pop: null, t: 0,
      n: 16, secret: 0, step: 0, qt: 0,
      P: [0.4, 0.3, 0.2, 0.1], Q: [0.15, 0.2, 0.25, 0.4],
    };
    const newSecret = () => { s.secret = R.int(0, s.n); s.step = 0; s.qt = 0; };
    newSecret();

    const B = () => {
      if (s.beat <= 1) return stage.portrait ? [-5, -2.4, 5, 5.4] : [-5.4, -2.6, 5.4, 4.3];
      if (s.beat === 2) return stage.portrait ? [-5, -3, 5, 4.6] : [-5.4, -2.6, 5.4, 4.0];
      return stage.portrait ? [-5, -5.6, 5, 5.4] : [-5.6, -1.7, 5.8, 2.9];
    };
    const fit = () => { const b = B(); if (!s.b || s.b.join() !== b.join()) { s.b = b; g.setBounds(b); } };

    // KL beat: drag the tops of the blue (guess) bars; lime (truth) too
    const barX = (i, which) => (stage.portrait ? -4.4 + i * 2.4 + (which ? 0.75 : 0) : -5.2 + i * 1.35 + (which ? 0.5 : 0));
    const BAR_Y = () => (stage.portrait ? 1.2 : -0.6), BAR_K = 4.2;
    for (const which of [0, 1]) [0, 1, 2, 3].forEach((i) => stage.handle({
      pen: g, color: which ? 'blue' : 'lime', r: 8, kind: which ? 'square' : 'ring', visible: () => s.beat === 3,
      get: () => [barX(i, which) + 0.22, BAR_Y() + (which ? s.Q : s.P)[i] * BAR_K],
      set: (p) => {
        const arr = which ? s.Q : s.P, v = clamp((p[1] - BAR_Y()) / BAR_K, 0.02, 0.9), rest = 1 - arr[i];
        const next = arr.map((x, j) => (j === i ? v : (x / rest) * (1 - v)));
        if (which) s.Q = next; else s.P = next;
      },
    }));

    const groups = [ui.group(), ui.group(), ui.group()];
    ui.slider({ into: groups[0], icon: '🪙', color: 'purple', min: 0.02, max: 0.98, step: 0.01, value: s.p, title: 'chance of 🌞', onInput: (v) => (s.p = v) });
    ui.choice({ into: groups[1], value: s.n, color: 'gold', options: [2, 4, 8, 16, 32].map((n) => ({ icon: String(n), value: n, title: `${n} things` })), onChange: (v) => { s.n = v; newSecret(); } });
    ui.button({ into: groups[2], icon: '🟰', title: 'guess = truth', onClick: () => { s.Q = s.P.slice(); } });
    ui.button({ into: groups[2], icon: '🎲', title: 'new guess', onClick: () => { const r = [0, 1, 2, 3].map(() => R.uniform(0.1, 1)), t = r.reduce((a, b) => a + b, 0); s.Q = r.map((x) => x / t); } });
    ui.readout(() => {
      if (s.beat <= 1) return fmt(H2(s.p), 2);
      if (s.beat === 2) return String(Math.log2(s.n));
      return fmt(kl(), 2);
    }, { icon: '😮', color: 'gold', title: 'bits' });
    const showGroups = () => groups.forEach((gr, i) => (gr.style.display = i === (s.beat <= 1 ? 0 : s.beat - 1) ? '' : 'none'));
    ui.beats(['😮', '⚖️', '🌳', '🎯'], (b) => { s.beat = b; showGroups(); fit(); if (b === 2) newSecret(); });
    showGroups(); fit();

    const kl = () => s.P.reduce((a, p, i) => a + p * (S(s.Q[i]) - S(p)), 0);

    return {
      update(dt) {
        s.t += dt;
        if (s.beat <= 1) {
          s.tick += dt;
          if (s.tick > 0.7) { s.tick = 0; const h = R() < s.p; s.flips.push(h); if (s.flips.length > 40) s.flips.shift(); s.pop = { h, t: 0 }; }
          if (s.pop) s.pop.t += dt;
        }
        if (s.beat === 2) {
          s.qt += dt;
          if (s.qt > 1.3) { s.qt = 0; s.step++; if (s.step > Math.log2(s.n) + 2) newSecret(); }
        }
      },
      draw() {
        fit();
        BIT = s.beat === 3 ? 0.62 : 0.75;
        if (s.beat <= 1) drawCoin(); else if (s.beat === 2) drawQuestions(); else drawKL();
      },
    };

    // ---------------------------------------------------------------- coin towers
    function drawCoin() {
      g.grid({ step: 1, axes: false });
      const P = stage.portrait, ent = s.beat === 1;
      const x0 = ent && !P ? -5.0 : -4.6, x1 = ent && !P ? 0.6 : 4.6, W = x1 - x0, y0 = -1.0;
      const parts = [[s.p, '🌞', true], [1 - s.p, '🌙', false]];
      let x = x0;
      for (const [p, em, h] of parts) {
        const w = W * p, hh = S(p) * BIT;
        // the probability slice (purple) …
        g.rrect(x + 0.03, y0 - 0.55, w - 0.06, 0.45, 6, { fill: alpha('purple', h ? 0.85 : 0.5), stroke: false });
        // … and the surprise tower standing on it (gold)
        const pop = s.pop && s.pop.h === h ? Math.max(0, 1 - s.pop.t / 0.6) : 0;
        g.rrect(x + 0.03, y0, w - 0.06, hh, 6, { fill: alpha('gold', 0.55 + 0.4 * pop), stroke: false });
        if (pop > 0) g.rrect(x + 0.03, y0, w - 0.06, hh, 6, { color: 'gold', width: 3 + 4 * pop });
        g.emoji(em, [x + w / 2, y0 - 0.95], 24);
        if (w > 0.5) g.text(fmt(S(p), 1), [x + w / 2, y0 + hh + 0.3], { color: 'gold', size: 15, weight: 800 });
        if (pop > 0) g.emoji(S(p) > 2 ? '😱' : S(p) > 1 ? '😮' : '🙂', [x + w / 2, y0 + hh + 0.85], 22 + 26 * Math.min(1, S(p) / 4) * pop);
        x += w;
      }
      // bit ruler
      for (let b = 1; b <= 6; b++) { const y = y0 + b * BIT; if (y > g.view[3] - 0.2) break; g.line([x0 - 0.25, y], [x0 - 0.05, y], { color: 'muted', width: 1.5 }); g.text(String(b), [x0 - 0.45, y], { color: 'muted', size: 11 }); }
      // recent flips
      const fl = s.flips.slice(P ? -14 : -18);
      fl.forEach((h, i) => g.emoji(h ? '🌞' : '🌙', [x0 + 0.25 + i * 0.5, g.view[3] - 0.4], 18));
      if (ent) {
        // entropy = average tower height: pour the towers flat → water level
        const H = H2(s.p) * BIT;
        g.line([x0, y0 + H], [x1, y0 + H], { color: 'gold', width: 3.5, dash: [9, 6] });
        g.text('H', [x1 + 0.3, y0 + H], { color: 'gold', size: 18, weight: 800 });
        // H(p) curve: highest for a fair coin
        const px0 = P ? -4.2 : 1.6, px1 = P ? 4.2 : 5.0, pyb = P ? 3.0 : 0.2, ph = P ? 1.6 : 2.6;
        const X = (p) => px0 + p * (px1 - px0), Y = (h) => pyb + h * ph;
        g.rrect(px0 - 0.2, pyb - 0.3, px1 - px0 + 0.4, ph + 0.6, 8, { fill: alpha('panel', 0.85), stroke: false });
        g.line([X(0), Y(0)], [X(1), Y(0)], { color: alpha('muted', 0.6), width: 1 });
        g.plot((p) => Y(H2(clamp((p - px0) / (px1 - px0), 1e-6, 1 - 1e-6))), { color: 'gold', width: 3, range: [px0, 0, px1] });
        g.line([X(0.5), Y(0)], [X(0.5), Y(1)], { color: alpha('muted', 0.4), width: 1, dash: [3, 4] });
        g.dot([X(s.p), Y(H2(s.p))], 7, { color: 'purple', ring: 'bg' });
        g.emoji('⚖️', [X(0.5), Y(1) + 0.3], 18);
      }
    }

    // ---------------------------------------------------------------- 20 questions
    function drawQuestions() {
      g.grid({ step: 1, axes: false });
      const n = s.n, L = Math.log2(n), P = stage.portrait;
      const xL = -4.9, xR = 4.9, cw = (xR - xL) / n, rowY = -1.7;
      const X = (i) => xL + (i + 0.5) * cw;
      const asked = Math.min(s.step, L);
      // current interval after `asked` questions
      let lo = 0, hi = n;
      const bits = [];
      for (let q = 0; q < asked; q++) { const mid = (lo + hi) / 2, right = s.secret >= mid; bits.push(right ? 1 : 0); if (right) lo = mid; else hi = mid; }
      // the tree: each level halves the set
      const topY = P ? 3.9 : 3.5, levY = (d) => topY - (d / L) * (topY - rowY - 0.7);
      for (let d = 0; d < L; d++) {
        const segs = 2 ** d, w = n / segs;
        for (let k = 0; k < segs; k++) {
          const a = k * w, m = a + w / 2;
          const cx = xL + (a + w / 2) * cw, lx = xL + (a + w / 4) * cw, rx = xL + (m + w / 4) * cw;
          const onPath = d < asked && s.secret >= a && s.secret < a + w;
          const col = onPath ? 'gold' : alpha('muted', 0.3);
          g.line([cx, levY(d)], [lx, levY(d + 1)], { color: onPath && bits[d] === 0 ? 'gold' : alpha('muted', 0.3), width: onPath && bits[d] === 0 ? 4 : 1.5 });
          g.line([cx, levY(d)], [rx, levY(d + 1)], { color: onPath && bits[d] === 1 ? 'gold' : alpha('muted', 0.3), width: onPath && bits[d] === 1 ? 4 : 1.5 });
          g.dot([cx, levY(d)], onPath ? 6 : 3, { color: col });
        }
      }
      // the animals: knocked-out ones fade
      const em = Math.min(30, g.px(cw) * 0.85);
      for (let i = 0; i < n; i++) {
        const alive = i >= lo && i < hi;
        g.emoji(ANIMALS[i], [X(i), rowY], em, { alpha: alive ? 1 : 0.15 });
      }
      // the question now being asked: "is it in this half?"
      if (s.step < L) {
        const mid = (lo + hi) / 2, half = s.qt > 0.6 ? (s.secret >= mid ? [mid, hi] : [lo, mid]) : [lo, mid];
        g.rrect(xL + half[0] * cw, rowY - 0.45, (half[1] - half[0]) * cw, 0.9, 8, { color: 'gold', width: 3, dash: [6, 4] });
        g.emoji('❓', [xL + ((lo + mid) / 2) * cw, rowY + 0.75], 22);
      } else {
        g.circle([X(s.secret), rowY], cw * 0.55, { color: 'gold', width: 4 });
        g.emoji('🎉', [X(s.secret), rowY + 0.85], 26);
      }
      // the answers so far = the secret's binary code
      bits.forEach((b, i) => g.text(String(b), [xL + 0.3 + i * 0.55, rowY - 0.9], { color: 'gold', size: 22, weight: 800 }));
    }

    // ---------------------------------------------------------------- KL
    function drawKL() {
      g.grid({ step: 1, axes: false });
      const P = stage.portrait, by = BAR_Y();
      // probability bars: truth p (lime) vs guess q (blue)
      g.line([barX(0, 0) - 0.3, by], [barX(3, 1) + 0.75, by], { color: 'slate', width: 2 });
      for (let i = 0; i < 4; i++) {
        g.bar(barX(i, 0), by, 0.44, s.P[i] * BAR_K, { color: 'lime' });
        g.bar(barX(i, 1), by, 0.44, s.Q[i] * BAR_K, { color: 'blue' });
        g.emoji(FRUIT[i], [barX(i, 0) + 0.47, by - 0.4], 22);
      }
      // surprise towers, each as wide as how often the thing REALLY happens (p)
      const tx0 = P ? -4.6 : 0.4, tx1 = P ? 2.4 : 4.0, ty = P ? -5.0 : -1.0;
      const W = tx1 - tx0;
      let x = tx0;
      for (let i = 0; i < 4; i++) {
        const w = W * s.P[i], hp = S(s.P[i]) * BIT, hq = S(s.Q[i]) * BIT;
        g.rect(x + 0.02, ty, w - 0.04, hp, { fill: alpha('lime', 0.75), stroke: false });
        if (hq > hp) g.rect(x + 0.02, ty + hp, w - 0.04, hq - hp, { fill: alpha('coral', 0.75), stroke: false });
        else g.rect(x + 0.02, ty + hq, w - 0.04, hp - hq, { fill: alpha('blue', 0.18), stroke: false });
        g.rect(x + 0.02, ty, w - 0.04, hq, { color: 'blue', width: 2 });
        if (w > 0.35) g.emoji(FRUIT[i], [x + w / 2, ty - 0.35], 18);
        x += w;
      }
      // summary: H(p) (lime), H(p,q) (blue), KL (coral) = the difference
      const Hp = s.P.reduce((a, p) => a + p * S(p), 0), Hpq = s.P.reduce((a, p, i) => a + p * S(s.Q[i]), 0);
      const sx = tx1 + 0.55;
      g.bar(sx, ty, 0.4, Hp * BIT, { color: 'lime' });
      g.rrect(sx + 0.55, ty, 0.4, Hpq * BIT, 4, { color: 'blue', width: 2.5 });
      g.bar(sx + 0.55, ty, 0.4, Hp * BIT, { color: alpha('lime', 0.5) });
      g.bar(sx + 0.55, ty + Hp * BIT, 0.4, (Hpq - Hp) * BIT, { color: 'coral' });
      g.text(fmt(Hpq - Hp, 2), [sx + 0.75, ty + Hpq * BIT + 0.3], { color: 'coral', size: 16, weight: 800 });
      g.text(fmt(Hp, 2), [sx + 0.2, ty + Hp * BIT + 0.3], { color: 'lime', size: 14, weight: 800, dx: -10 });
      if (Hpq - Hp < 0.005) g.emoji('🎯', [sx + 0.75, ty + Hpq * BIT + 0.85], 24);
      g.text('p', [barX(0, 0) + 0.22, by + s.P[0] * BAR_K + 0.35], { color: 'lime', size: 18, weight: 800 });
      g.text('q', [barX(0, 1) + 0.22, by + s.Q[0] * BAR_K + 0.35], { color: 'blue', size: 18, weight: 800 });
    }
  },
};
void C;
