// Sim → Real: a robot hand learns to push a box onto the gold line.
// Trained in ONE pretend world it learns a lazy push that only works there.
// The real floor is stickier → the box doesn't even budge. Train in MANY
// pretend worlds with random floors → a push that works in all of them,
// including the real one it never saw.
import { C, alpha, mix } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rng, clamp } from '../core/random.js';

const DT = 0.02, TN = 200, GR = 9.8, FMAX = 14, TOL = 0.2;
const NK = 16, NC = 16;
const KS = Array.from({ length: NK }, (_, i) => 0.5 * 1.3 ** i);   // push strength
const CS = Array.from({ length: NC }, (_, i) => i * 0.6);          // braking

// box on a floor with Coulomb friction μ, pushed by F = k (D − x) − c v
function simulate(k, c, mu, D, keep = false) {
  let x = 0, v = 0, E = 0;
  const xs = keep ? [0] : null, fs = keep ? [0] : null;
  for (let i = 0; i < TN; i++) {
    const F = clamp(k * (D - x) - c * v, -FMAX, FMAX), fr = mu * GR;
    E += F * F * DT;
    if (Math.abs(v) < 1e-3) { if (Math.abs(F) > fr) v += (F - Math.sign(F) * fr) * DT; else v = 0; }
    else { const nv = v + (F - Math.sign(v) * fr) * DT; v = Math.sign(nv) !== Math.sign(v) ? 0 : nv; }
    x += v * DT;
    if (keep) { xs.push(x); fs.push(F); }
  }
  return { x, E, xs, fs };
}
const floorCol = (mu) => mix('blue', 'orange', clamp(mu / 0.6, 0, 1));

export default {
  eq: [
    ['policy: ', ['F', 'orange'], ' = k (', ['D', 'gold'], ' − x) − c ẋ  ·  friction ', ['μ', 'slate'], ' m g'],
    ['one sim:  θ* = argmin J(θ; ', ['μ_sim', 'slate'], ')  ·  J = (x_T − ', ['D', 'gold'], ')² + λ∫', ['F', 'orange'], '²'],
    ['randomized:  θ* = argmin ', ['E', 'purple'], '_{μ ~ U(', ['μ₋, μ₊', 'purple'], ')} J(θ; μ)'],
    [['real', 'lime'], ' μ ∈ [', ['μ₋, μ₊', 'purple'], ']  ⇒  ', ['✅', 'lime'], '  ·  else  ', ['gap', 'coral'], ' = |x_T − D|'],
  ],
  setup({ stage, ui }) {
    const [L, Hm] = stage.split([[-1.3, -3.3, 6.5, 3.3], [-2.2, -2.2, NK + 0.6, NC + 0.8]], [2.3, 1]);
    const s = { beat: 0, t: 0, D: 4, muSim: 0.12, muReal: 0.45, spread: 0.3, pick: null, seed: 4 };
    const drMus = () => { const r = rng(s.seed); const c = 0.3; return Array.from({ length: 7 }, (_, i) => clamp(c + s.spread * ((i / 6) * 2 - 1) + r.normal(0, 0.02), 0.02, 0.8)); };
    const costMap = (mus) => KS.map((k) => CS.map((c) => mus.reduce((acc, mu) => { const r = simulate(k, c, mu, s.D); return acc + (r.x - s.D) ** 2 + 0.0006 * r.E; }, 0) / mus.length));
    const argmin = (M) => { let b = [0, 0]; M.forEach((row, i) => row.forEach((v, j) => { if (v < M[b[0]][b[1]]) b = [i, j]; })); return b; };

    let cache = {};
    function train() {
      const key = `${s.D.toFixed(2)}|${s.spread.toFixed(2)}`;
      if (cache.key === key) return;
      const simM = costMap([s.muSim]), drM = costMap(drMus());
      cache = { key, simM, drM, simB: argmin(simM), drB: argmin(drM) };
      s.runKey = null;
    }
    train();
    const pol = (which) => { const b = which === 'dr' ? cache.drB : cache.simB; return [KS[b[0]], CS[b[1]]]; };

    stage.handle({ pen: L, color: 'gold', r: 13, icon: '🎯', get: () => [s.D, 2.9], set: (p) => { s.D = clamp(Math.round(p[0] * 10) / 10, 2, 5.6); s.pick = null; } });
    stage.on('down', (e) => {
      if (e.pen !== Hm) return;
      const i = Math.floor(e.p[0]), j = Math.floor(e.p[1]);
      if (i >= 0 && i < NK && j >= 0 && j < NC) { s.pick = [i, j]; s.runKey = null; s.t = 0; }
    });

    ui.beats(['🎮', '🌍', '🎭', '✅'], (b) => { s.beat = b; s.t = 0; s.pick = null; s.runKey = null; });
    ui.slider({ icon: '🌍', color: 'lime', min: 0.03, max: 0.7, step: 0.01, value: s.muReal, title: 'real floor friction', onInput: (v) => { s.muReal = v; s.runKey = null; } });
    ui.slider({ icon: '🎭', color: 'purple', min: 0, max: 0.4, step: 0.01, value: s.spread, title: 'randomization spread', onInput: (v) => { s.spread = v; } });
    ui.button({ icon: '🎲', title: 'new random worlds', onClick: () => { s.seed++; cache = {}; } });
    ui.readout(() => (s.realGap === undefined ? '–' : fmt(s.realGap, 2)), { icon: '🌍', color: 'coral', title: 'real-world miss' });

    // which worlds to show, and which policy drives each
    function lanes() {
      const sim = { mu: s.muSim, icon: '🎮' }, real = { mu: s.muReal, icon: '🌍', real: true };
      const usePick = s.pick ? [KS[s.pick[0]], CS[s.pick[1]]] : null;
      if (s.beat === 0) return [{ ...sim, th: usePick ?? pol('sim') }];
      if (s.beat === 1) return [{ ...sim, th: usePick ?? pol('sim') }, { ...real, th: usePick ?? pol('sim') }];
      if (s.beat === 2) return drMus().map((mu) => ({ mu, icon: '🎲', th: usePick ?? pol('dr') }));
      return [{ ...real, th: pol('sim'), ghost: true }, { ...real, th: usePick ?? pol('dr') }];
    }

    return {
      update(dt) { s.t += Math.max(0, dt); },
      draw() {
        train();
        const ls = lanes();
        const key = `${cache.key}|${s.beat}|${s.muReal}|${s.pick}|${ls.map((l) => l.mu.toFixed(3)).join()}`;
        if (s.runKey !== key) {
          s.runs = ls.map((l) => simulate(l.th[0], l.th[1], l.mu, s.D, true));
          s.runKey = key;
          const ri = ls.findIndex((l, i) => l.real && !l.ghost && i === ls.length - 1);
          s.realGap = ri >= 0 ? Math.abs(s.runs[ri].x - s.D) : undefined;
        }
        // ---------- lanes ----------
        const n = ls.length, lh = Math.min(1.25, 5.6 / n), y0 = (n * lh) / 2;
        const step = Math.min(TN, Math.floor(((s.t % 5.2) / 4) * TN));
        L.clip(() => {
          ls.forEach((l, i) => {
            const yb = y0 - (i + 1) * lh, yc = yb + lh / 2;
            L.rect(-0.6, yb + 0.06, 6.9, lh - 0.12, { fill: alpha(floorCol(l.mu), l.ghost ? 0.12 : 0.28), stroke: false });
            // grains: more grains = stickier floor
            const r = rng(31 + i), ng = Math.round(l.mu * 90);
            for (let k = 0; k < ng; k++) L.dot([r.uniform(-0.5, 6.2), r.uniform(yb + 0.1, yb + lh * 0.3)], 1.4, { color: alpha(floorCol(l.mu), 0.9) });
            L.emoji(l.icon, [-0.95, yc], Math.min(26, L.px(lh) * 0.6));
            const run = s.runs[i], x = run.xs[step], F = run.fs[step];
            const bs = lh * 0.5, by = yb + 0.08 + lh * 0.3;
            const done = step >= TN;
            const ok = Math.abs(run.x - s.D) < TOL;
            if (l.ghost) {
              L.rect(x - bs / 2, by, bs, bs, { color: alpha('coral', 0.7), width: 2, dash: [4, 3] });
            } else {
              L.emoji('📦', [x, by + bs / 2], L.px(bs) * 0.95);
              // the robot hand pushes (arrow = force)
              // the robot's hand (pink) pressing on the box
              L.rrect(x - bs / 2 - 0.2, by + bs * 0.2, 0.18, bs * 0.6, 4, { fill: 'pink', stroke: false });
              L.line([x - bs / 2 - 0.2, by + bs / 2], [x - bs / 2 - 0.75, by + bs / 2], { color: 'slate', width: 5 });
              if (Math.abs(F) > 0.1) L.vec([x + bs / 2 + 0.05, by + bs * 0.85], [Math.sign(F) * Math.min(1.5, Math.abs(F) * 0.11), 0], { color: 'orange', width: 3, head: 8 });
            }
            if (done || step > TN * 0.85) {
              if (!ok) L.line([run.x, by + bs * 0.2], [s.D, by + bs * 0.2], { color: 'coral', width: 4 });
              L.emoji(ok ? '✅' : '❌', [Math.max(s.D, run.x) + 0.45, yc + lh * 0.15], Math.min(22, L.px(lh) * 0.45));
            }
          });
          // gold target line + tolerance band
          L.rect(s.D - TOL, -y0 - 0.1, 2 * TOL, 2 * y0 + 0.2, { fill: alpha('gold', 0.15), stroke: false });
          L.line([s.D, -y0 - 0.1], [s.D, 2.9], { color: 'gold', width: 3 });
        });
        // ---------- what the policy learned: cost over (k, c) ----------
        const M = s.beat >= 2 ? cache.drM : cache.simM;
        const lm = M.flat().map((v) => Math.log(v + 1e-3)), lo = Math.min(...lm), hi = Math.max(...lm);
        const T = M[0].map((_, j) => M.map((row) => row[j])).reverse(); // rows = c (top = big c)
        Hm.cells(T, [0, NC], 1, { colorFn: (v) => cmapNice(1 - (Math.log(v + 1e-3) - lo) / (hi - lo || 1)), gridColor: null });
        const star = (b, colr, sz) => Hm.emoji(colr, [b[0] + 0.5, b[1] + 0.5], sz);
        if (s.beat >= 2) { Hm.dot([cache.simB[0] + 0.5, cache.simB[1] + 0.5], 7, { color: 'coral', ring: 'bg' }); star(cache.drB, '⭐', 24); }
        else star(cache.simB, '⭐', 24);
        if (s.pick) Hm.circle([s.pick[0] + 0.5, s.pick[1] + 0.5], 0.6, { color: 'ink', width: 3 });
        Hm.arrow([0, -0.8], [NK, -0.8], { color: 'orange', width: 2.5 });
        Hm.text('k', [NK / 2, -1.5], { color: 'orange', size: 18 });
        Hm.arrow([-0.8, 0], [-0.8, NC], { color: 'muted', width: 2.5 });
        Hm.text('c', [-1.6, NC / 2], { color: 'muted', size: 18 });
        Hm.emoji(s.beat >= 2 ? '🎭' : '🎮', [NK - 0.6, NC + 0.3], 18);
        void C;
      },
    };

    function cmapNice(t) { return mix('panel2', 'gold', clamp(t, 0, 1) ** 2.2); }
  },
};
