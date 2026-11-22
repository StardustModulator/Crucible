// A GAN is a forger 🎨 and a detective 🕵️. The forger turns random noise into
// fake numbers (blue); the detective draws a curve saying "how real does this
// look?" (coral). Each one learns from the other until the fakes pile up exactly
// where the real ones (lime) are… or, sometimes, the forger gets lazy and only
// copies ONE bump (mode collapse).
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { MLP, Optimizer, trainBatch } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';

const NB = 42, X0 = -4, X1 = 4, HH = 1.45;   // histogram bins / range / height
const DY = 2.2;                               // D(x) = 1 drawn at this height
const sc = (x) => [x / 2];                    // detective's input scaling

function hist(xs) {
  const h = new Array(NB).fill(0), w = (X1 - X0) / NB;
  for (const x of xs) { const i = Math.floor((x - X0) / w); if (i >= 0 && i < NB) h[i]++; }
  const m = Math.max(...h, 1); return h.map((v) => v / m);
}

export default {
  eq: [
    ['min', ['G', 'blue'], ' max', ['D', 'coral'], '  E[log ', ['D(x)', 'coral'], '] + E[log(1 − ', ['D(G(z))', 'coral'], ')]'],
    [['x', 'lime'], ' ~ real  ·  ', ['z', 'purple'], ' ~ 𝒩(0, 1)  ·  ', ['G(z)', 'blue'], ' = forger’s fake'],
    ['🕵️ step:  push ', ['D', 'coral'], ' ↑ on ', ['x', 'lime'], ', ↓ on ', ['G(z)', 'blue']],
    ['🎨 step:  move ', ['G(z)', 'blue'], ' along ', ['∂D/∂x', 'gold'], '  ·  (loss −log ', ['D(G(z))', 'coral'], ')'],
    ['best detective  ', ['D*', 'coral'], ' = p_real / (p_real + p_fake)  → ½ when they match'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-4.2, -1.75, 4.2, 2.75]);
    const s = { beat: 0, t: 0, real: 1.5, it: 0, dHist: [] };
    const V = rng(77);                              // display-only randomness
    const zs = Array.from({ length: 500 }, () => V.normal());
    const eps = Array.from({ length: 500 }, () => V.normal());
    const coin = Array.from({ length: 500 }, () => V());

    function build() {
      s.R = rng(1);
      if (s.beat === 3) {
        // a small curvy forger that starts drawing near the right bump
        s.G = new MLP([1, 4, 1], ['tanh', 'linear'], 7);
        s.G.W.forEach((W) => W.forEach((r) => r.forEach((v, j) => (r[j] = v * 0.2))));
        s.G.b[1][0] = 2.4;
      } else { s.G = new MLP([1, 1], ['linear'], 7); s.G.W[0][0][0] = 0.35; s.G.b[0][0] = -2.2; }
      s.D = new MLP([1, 16, 1], ['tanh', 'sigmoid'], 8);
      s.oG = new Optimizer(s.G, { lr: s.beat === 3 ? 0.003 : 0.01, beta1: 0.5 });
      s.oD = new Optimizer(s.D, { lr: s.beat === 3 ? 0.02 : 0.01, beta1: 0.5 });
      s.it = 0; s.dHist = [];
    }
    const realSample = (R) => (s.beat === 3 ? (R() < 0.5 ? R.normal(-2.4, 0.3) : R.normal(2.4, 0.3)) : R.normal(s.real, 0.5));
    const realFixed = () => eps.map((e, i) => (s.beat === 3 ? (coin[i] < 0.5 ? -2.4 : 2.4) + 0.3 * e : s.real + 0.5 * e));
    const gen = (z) => { const a = s.G.forward([z]); return a[a.length - 1][0]; };
    const Dx = (x) => s.D.predict(sc(x))[0];
    const dDdx = (x) => { const a = s.D.forward(sc(x)), d = a[2][0], b = s.D.backward(a, [1]); void d; return s.D.W[0].reduce((acc, row, j) => acc + row[0] * b.deltas[0][j], 0) / 2; };

    function stepD() {
      const R = s.R, X = [], Y = [];
      for (let i = 0; i < 16; i++) { X.push(sc(realSample(R))); Y.push([1]); X.push(sc(gen(R.normal()))); Y.push([0]); }
      trainBatch(s.D, s.oD, X, Y, 'bce');
    }
    function stepG() {
      const R = s.R, G = s.G;
      const gW = G.W.map((W) => W.map((r) => r.map(() => 0))), gb = G.b.map((b) => b.map(() => 0));
      for (let i = 0; i < 16; i++) {
        const aG = G.forward([R.normal()]), x = aG[aG.length - 1][0];
        const aD = s.D.forward(sc(x)), d = aD[2][0];
        const bd = s.D.backward(aD, [-1 / Math.max(d, 1e-6)]);                 // non-saturating −log D
        const dx = s.D.W[0].reduce((acc, row, j) => acc + row[0] * bd.deltas[0][j], 0) / 2;
        const bg = G.backward(aG, [dx]);
        bg.gW.forEach((W, l) => W.forEach((r, a) => r.forEach((v, b) => (gW[l][a][b] += v))));
        bg.gb.forEach((b, l) => b.forEach((v, a) => (gb[l][a] += v)));
      }
      s.oG.step(gW, gb, 16);
    }
    build();

    // forger's knobs (affine forger only): center and spread
    stage.handle({ pen: g, color: 'blue', r: 11, icon: '🎨', visible: () => s.beat < 3, get: () => [s.G.b[0][0], -0.32],
      set: (p) => { s.G.b[0][0] = clamp(p[0], -3.8, 3.8); } });
    stage.handle({ pen: g, color: 'blue', kind: 'ring', r: 8, visible: () => s.beat < 3, get: () => [s.G.b[0][0] + 2 * Math.abs(s.G.W[0][0][0]), -0.32],
      set: (p) => { s.G.W[0][0][0] = clamp((p[0] - s.G.b[0][0]) / 2, 0.05, 1.8); } });
    stage.handle({ pen: g, color: 'lime', r: 10, visible: () => s.beat < 3, get: () => [s.real, HH + 0.12], set: (p) => { s.real = clamp(p[0], -3, 3); } });

    ui.beats(['🎨', '🕵️', '🔁', '😴'], (b) => { s.beat = b; s.t = 0; build(); });
    ui.button({ icon: '🔄', title: 'start training over', onClick: () => build() });
    ui.readout(() => fmt(s.dFake ?? 0, 2), { icon: '🕵️', color: 'coral', title: 'detective score on fakes' });
    ui.readout(() => s.it, { icon: '🔁', color: 'blue', title: 'training rounds' });

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt;
        const n = s.beat === 0 ? 0 : 2;
        for (let i = 0; i < n; i++) {
          stepD();
          if (s.beat >= 2) stepG();
          s.it++;
        }
        if (n && s.it % 4 === 0) {
          const df = zs.slice(0, 80).reduce((a, z) => a + Dx(gen(z)), 0) / 80;
          s.dHist.push(df); if (s.dHist.length > 120) s.dHist.shift();
        }
      },
      draw() {
        const realX = realFixed(), fakeX = zs.map(gen);
        const hr = hist(realX), hf = hist(fakeX), w = (X1 - X0) / NB;
        g.line([X0 - 0.2, 0], [X1 + 0.2, 0], { color: alpha('muted', 0.6), width: 1.5 });
        // real pile (lime) and fake pile (blue)
        hr.forEach((v, i) => v > 0 && g.bar(X0 + i * w + w * 0.08, 0, w * 0.84, v * HH, { color: alpha('lime', 0.55) }));
        hf.forEach((v, i) => v > 0 && g.bar(X0 + i * w + w * 0.2, 0, w * 0.6, v * HH, { color: alpha('blue', 0.7) }));
        // noise → forger → fake (a few strings)
        const zy = -1.25;
        g.line([X0 - 0.2, zy], [X1 + 0.2, zy], { color: alpha('purple', 0.35), width: 1 });
        for (let i = 0; i < 26; i++) {
          const z = zs[i], x = fakeX[i];
          g.line([z * 1.1, zy], [x, -0.02], { color: alpha('blue', 0.18), width: 1 });
          g.dot([z * 1.1, zy], 3, { color: 'purple' });
        }
        g.emoji('🎲', [X0 - 0.05, zy], 18);
        // the detective's opinion
        if (s.beat >= 1) {
          g.line([X0, DY / 2], [X1, DY / 2], { color: alpha('coral', 0.35), dash: [4, 5], width: 1.5 });
          g.text('½', [X1 + 0.1, DY / 2], { color: 'coral', size: 14 });
          g.plot((x) => DY * Dx(x), { color: 'coral', width: 3.5, range: [X0, 0, X1, 0], samples: 120 });
          g.emoji('🕵️', [X0 + 0.15, DY + 0.25], 22);
          // which way would look "more real" for a few fakes
          if (s.beat <= 2) for (let i = 0; i < 9; i++) {
            const x = fakeX[i * 7], d = dDdx(x) / Math.max(Dx(x), 1e-3), L = clamp(d * 0.25, -0.8, 0.8); // ∂ log D / ∂x
            if (Math.abs(L) > 0.04) g.arrow([x, 0.12 + i * 0.07], [x + L, 0.12 + i * 0.07], { color: 'gold', width: 2.5, head: 7 });
          }
        }
        if (s.beat === 3) {
          // the bump nobody copies
          const left = fakeX.filter((x) => x < 0).length / fakeX.length, right = 1 - left;
          if (left < 0.1) g.emoji('😴', [-2.4, HH + 0.4], 30);
          if (right < 0.1) g.emoji('😴', [2.4, HH + 0.4], 30);
        }
        g.emoji('🎨', [X0 + 0.15, -0.65], 20);
        s.dFake = fakeX.slice(0, 80).reduce((a, x) => a + (s.beat ? Dx(x) : 0), 0) / 80;
        // mini plot: detective score on fakes over time → ½
        if (s.dHist.length > 1) {
          const ctx = stage.hud.ctx, W = stage.portrait ? 120 : 160, H = 60, X = stage.hud.area.w - W - 12, Y = 12;
          ctx.save(); ctx.fillStyle = alpha('panel', 0.9); ctx.strokeStyle = C.grid;
          ctx.beginPath(); ctx.roundRect(X, Y, W, H, 10); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = alpha('coral', 0.4); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X + 6, Y + H / 2); ctx.lineTo(X + W - 6, Y + H / 2); ctx.stroke(); ctx.setLineDash([]);
          ctx.strokeStyle = C.coral; ctx.lineWidth = 2; ctx.beginPath();
          s.dHist.forEach((v, i) => { const px = X + 6 + ((W - 12) * i) / 119, py = Y + H - 6 - (H - 12) * v; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
          ctx.stroke(); ctx.restore();
        }
      },
    };
  },
};
