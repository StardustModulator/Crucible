// An autoencoder squeezes every 2-number point through a straw that only fits
// ONE number, then tries to rebuild the point. With a straight straw (linear)
// the best you can do is slide points onto a line — that's PCA. With a bendy
// brain (nonlinear) the line can curl along curvy data.
import { C, alpha, cmapCSS } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { MLP, Optimizer, trainBatch, act, pca } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';

const codeCol = (c, lo, hi) => cmapCSS(0.12 + 0.85 * clamp((c - lo) / (hi - lo || 1), 0, 1), 'heat');

export default {
  eq: [
    [['x', 'teal'], ' ∈ ℝ²  →  encoder  →  ', ['c', 'orange'], ' ∈ ℝ¹  →  decoder  →  ', ['x̂', 'blue'], ' ∈ ℝ²'],
    ['loss = Σ ‖', ['x', 'teal'], ' − ', ['x̂', 'blue'], '‖²  ·  (', ['error', 'coral'], ')'],
    ['linear:  ', ['c', 'orange'], ' = uᵀ(', ['x', 'teal'], ' − μ),  ', ['x̂', 'blue'], ' = μ + u ', ['c', 'orange'], '  ·  best u = top eigenvector of Σ  (', ['PCA', 'gold'], ')'],
    ['nonlinear:  2 → 8 → ', ['1', 'orange'], ' → 8 → 2  ·  (tanh)  — the line can bend'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-3.4, -2.7, 3.4, 2.7]);
    const R = rng(3);
    const cloud = [], curve = [];
    for (let i = 0; i < 90; i++) { const u = R.normal(0, 1.25), v = R.normal(0, 0.35), a = 0.5; cloud.push([u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a) - 0.2]); }
    for (let i = 0; i < 140; i++) { const u = R.uniform(0, 1), a = -0.6 + u * 4.2, r = 1.7 - 0.5 * u; curve.push([r * Math.cos(a) + R.normal(0, 0.06), r * Math.sin(a) + R.normal(0, 0.06)]); }
    const s = { beat: 0, t: 0, ang: -0.3, loss: [], net: null };
    const data = () => (s.beat >= 2 ? curve : cloud);
    const newNet = () => { s.net = new MLP([2, 8, 1, 8, 2], ['tanh', 'linear', 'tanh', 'linear'], 2); s.opt = new Optimizer(s.net, { lr: 0.01 }); s.loss = []; };
    newNet();
    // run part of the network: layers [from, to)
    const run = (x, from, to) => { let a = x; for (let l = from; l < to; l++) a = s.net.W[l].map((row, i) => act[s.net.acts[l]].f(row.reduce((acc, w, j) => acc + w * a[j], s.net.b[l][i]))); return a; };
    const enc = (x) => run(x, 0, 2)[0], decd = (c) => run([c], 2, 4);

    // linear straw = a line through the mean along angle ang
    const lineFit = (pts, ang) => {
      const mu = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
      const u = [Math.cos(ang), Math.sin(ang)];
      const codes = pts.map((p) => (p[0] - mu[0]) * u[0] + (p[1] - mu[1]) * u[1]);
      const rec = codes.map((c) => [mu[0] + c * u[0], mu[1] + c * u[1]]);
      const err = pts.reduce((a, p, i) => a + (p[0] - rec[i][0]) ** 2 + (p[1] - rec[i][1]) ** 2, 0) / pts.length;
      return { mu, u, codes, rec, err };
    };
    const pcaAng = () => { const P = pca(data()); return Math.atan2(P.components[0][1], P.components[0][0]); };

    stage.handle({ pen: g, color: 'orange', r: 11, visible: () => s.beat === 1 || s.beat === 2,
      get: () => { const f = lineFit(data(), s.ang); return [f.mu[0] + 2.2 * f.u[0], f.mu[1] + 2.2 * f.u[1]]; },
      set: (p) => { const f = lineFit(data(), s.ang); s.ang = Math.atan2(p[1] - f.mu[1], p[0] - f.mu[0]); } });

    ui.beats(['🗜️', '📏', '🌀', '🧠'], (b) => { s.beat = b; s.t = 0; if (b === 0) s.ang = pcaAng(); if (b === 1) s.ang = pcaAng() + 0.9; if (b === 2) s.ang = pcaAng(); if (b === 3) newNet(); });
    ui.button({ icon: '🎯', title: 'snap to PCA', onClick: () => (s.ang = pcaAng()) });
    ui.button({ icon: '🔄', title: 'retrain', onClick: newNet });
    ui.readout(() => fmt(s.err ?? 0, 3), { icon: '📏', color: 'coral', title: 'squeeze error' });
    s.ang = pcaAng();

    function codeBar(codes, lo, hi, colorFn) {
      const v = g.view, y = v[1] + 0.3, xa = v[0] + 0.7, xb = v[2] - 0.7;
      g.line([xa, y], [xb, y], { color: alpha('orange', 0.35), width: 8 });
      codes.forEach((c, i) => g.dot([xa + (xb - xa) * clamp((c - lo) / (hi - lo || 1), 0, 1), y], 3.2, { color: colorFn(c, i) }));
      g.emoji('🗜️', [xa - 0.35, y], 18);
    }
    function miniCurve(errAt, cur, best) { // error vs line angle, in the HUD corner
      const ctx = stage.hud.ctx, W = stage.portrait ? 130 : 170, H = 70, X = stage.hud.area.w - W - 12, Y = 12;
      const as = Array.from({ length: 61 }, (_, i) => (i / 60) * Math.PI), es = as.map(errAt), mx = Math.max(...es), mn = Math.min(...es);
      const px = (a) => X + 8 + ((W - 16) * a) / Math.PI, py = (e) => Y + H - 8 - ((H - 16) * (e - mn)) / (mx - mn || 1);
      ctx.save(); ctx.fillStyle = alpha('panel', 0.9); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.roundRect(X, Y, W, H, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = C.coral; ctx.lineWidth = 2; ctx.beginPath(); as.forEach((a, i) => (i ? ctx.lineTo(px(a), py(es[i])) : ctx.moveTo(px(a), py(es[i])))); ctx.stroke();
      const m = (a) => ((a % Math.PI) + Math.PI) % Math.PI;
      ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(px(m(best)), py(errAt(m(best))), 5, 0, 7); ctx.fill();
      ctx.fillStyle = C.orange; ctx.beginPath(); ctx.arc(px(m(cur)), py(errAt(m(cur))), 6, 0, 7); ctx.fill();
      ctx.restore();
    }

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt;
        if (s.beat === 3) {
          let L = 0;
          for (let k = 0; k < 4; k++) { const B = []; for (let i = 0; i < 32; i++) B.push(curve[R.int(0, curve.length)]); L += trainBatch(s.net, s.opt, B, B); }
          s.loss.push(L / 4); if (s.loss.length > 200) s.loss.shift();
        }
      },
      draw() {
        g.grid({ step: 1 });
        const pts = data();
        if (s.beat < 3) {
          const f = lineFit(pts, s.ang), best = pcaAng();
          s.err = f.err;
          // squeeze animation in beat 0: points slide onto the line and back
          const k = s.beat === 0 ? 0.5 - 0.5 * Math.cos(s.t * 1.6) : 1;
          const L = 4.5;
          if (s.beat >= 1) g.line([f.mu[0] - L * Math.cos(best), f.mu[1] - L * Math.sin(best)], [f.mu[0] + L * Math.cos(best), f.mu[1] + L * Math.sin(best)], { color: alpha('gold', 0.8), width: 2, dash: [7, 6] });
          g.line([f.mu[0] - L * f.u[0], f.mu[1] - L * f.u[1]], [f.mu[0] + L * f.u[0], f.mu[1] + L * f.u[1]], { color: 'blue', width: 3.5 });
          pts.forEach((p, i) => g.line(p, f.rec[i], { color: alpha('coral', 0.75), width: 1.8 }));
          const lo = Math.min(...f.codes), hi = Math.max(...f.codes);
          pts.forEach((p, i) => {
            const q = [p[0] + (f.rec[i][0] - p[0]) * k, p[1] + (f.rec[i][1] - p[1]) * k];
            if (s.beat === 0) g.dot(p, 3, { color: alpha('teal', 0.35) });
            g.dot(s.beat === 0 ? q : p, 4.5, { color: 'teal' });
            if (s.beat > 0) g.dot(f.rec[i], 3, { color: codeCol(f.codes[i], lo, hi) });
          });
          g.dot(f.mu, 6, { color: 'ink' });
          codeBar(f.codes, lo, hi, (c) => codeCol(c, lo, hi));
          if (s.beat >= 1) miniCurve((a) => lineFit(pts, a).err, s.ang, best);
          if (s.beat === 2) g.emoji('😖', [2.6, 2.1], 30);
          if (s.beat === 0) drawStraw();
        } else {
          // nonlinear: the learned 1-D curve lives inside the 2-D space
          const codes = curve.map(enc), lo = Math.min(...codes), hi = Math.max(...codes);
          const line = []; for (let i = 0; i <= 100; i++) { const c = lo - 0.1 * (hi - lo) + (1.2 * (hi - lo) * i) / 100; line.push(decd(c)); }
          const recs = codes.map(decd);
          curve.forEach((p, i) => g.line(p, recs[i], { color: alpha('coral', 0.75), width: 1.8 }));
          g.path(line, { color: 'blue', width: 4 });
          curve.forEach((p, i) => g.dot(p, 4, { color: 'teal' }));
          recs.forEach((q, i) => g.dot(q, 3, { color: codeCol(codes[i], lo, hi) }));
          codeBar(codes, lo, hi, (c) => codeCol(c, lo, hi));
          s.err = curve.reduce((a, p, i) => a + (p[0] - recs[i][0]) ** 2 + (p[1] - recs[i][1]) ** 2, 0) / curve.length;
          // loss going down
          if (s.loss.length > 1) {
            const ctx = stage.hud.ctx, W = stage.portrait ? 130 : 170, H = 70, X = stage.hud.area.w - W - 12, Y = 12;
            const mx = Math.max(...s.loss);
            ctx.save(); ctx.fillStyle = alpha('panel', 0.9); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.roundRect(X, Y, W, H, 10); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = C.coral; ctx.lineWidth = 2; ctx.beginPath();
            s.loss.forEach((v, i) => { const x = X + 8 + ((W - 16) * i) / 199, y = Y + H - 8 - (H - 16) * Math.sqrt(v / mx); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
            ctx.stroke(); ctx.restore();
          }
          g.emoji('🧠', [2.6, 2.1], 30);
        }
      },
    };

    // little picture of the straw network: 2 → 1 → 2
    function drawStraw() {
      const ctx = stage.hud.ctx, X = stage.hud.area.w - 150, Y = 16, W = 136, H = 76;
      ctx.save(); ctx.fillStyle = alpha('panel', 0.9); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.roundRect(X, Y, W, H, 10); ctx.fill(); ctx.stroke();
      const L = [[X + 22, Y + 22], [X + 22, Y + 54]], M = [X + 68, Y + 38], Rr = [[X + 114, Y + 22], [X + 114, Y + 54]];
      ctx.lineWidth = 2; ctx.strokeStyle = alpha('muted', 0.6);
      for (const a of L) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...M); ctx.stroke(); }
      for (const b of Rr) { ctx.beginPath(); ctx.moveTo(...M); ctx.lineTo(...b); ctx.stroke(); }
      const node = (p, c, r = 9) => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fillStyle = C[c]; ctx.fill(); };
      L.forEach((p) => node(p, 'teal')); Rr.forEach((p) => node(p, 'blue')); node(M, 'orange', 11);
      ctx.restore();
    }
  },
};
