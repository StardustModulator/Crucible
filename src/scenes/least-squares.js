// Least squares: hang a stick among the dots with little springs.
// Each spring's stretch is an error; draw it as a real SQUARE — the best
// line is the one whose squares have the smallest total area.
import { C, alpha, themeName } from '../viz/palette.js';
import { lstsq, pinv, mvec } from '../core/linalg.js';
import { ransacLine } from '../core/estimation.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const XA = 0.4, XB = 9.6; // where the two line handles live

export default {
  eq: [
    [['r', 'coral'], 'ᵢ = ', ['yᵢ', 'teal'], ' − (', ['m', 'blue'], 'xᵢ + ', ['c', 'blue'], ')        ', ['E', 'coral'], ' = Σ ', ['rᵢ²', 'coral'], '  (total square area)'],
    ['A = [x  1]      ', ['θ', 'gold'], '* = argmin ‖A', ['θ', 'blue'], ' − ', ['y', 'teal'], '‖² = (AᵀA)⁻¹Aᵀ', ['y', 'teal'], ' = A⁺', ['y', 'teal']],
    ['polynomial:  A = [1  x  x²  …  xᵈ]     same A⁺', ['y', 'teal'], '  (big d ⇒ wiggles)'],
    ['one ', ['😈', 'coral'], ' far away: its ', ['r²', 'coral'], ' is huge ⇒ it yanks the line   →  RANSAC'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-0.3, -0.6, 10.3, 7.4]);
    const R = rng(7);
    const s = {
      pts: [1, 2, 3, 4.2, 5, 6.3, 7.4, 8.6].map((x) => [x, clamp(0.5 * x + 1.2 + R.normal(0, 0.55), 0.3, 6.6)]),
      out: [7.6, 0.4],
      L: [4.6, 1.2], // line heights at XA, XB
      beat: 0, t: 0, deg: 2, ransac: false, pull: false,
    };
    const lineAt = (x) => s.L[0] + ((s.L[1] - s.L[0]) * (x - XA)) / (XB - XA);
    const inView = (p) => [clamp(p[0], 0.1, 9.9), clamp(p[1], -0.3, 7.1)];
    s.pts.forEach((p, k) => stage.handle({ pen: g, color: 'teal', r: 8, get: () => s.pts[k], set: (q) => (s.pts[k] = inView(q)) }));
    stage.handle({ pen: g, color: 'coral', r: 9, icon: '', visible: () => s.beat === 3, get: () => s.out, set: (q) => (s.out = inView(q)) });
    const lineVis = () => s.beat <= 1;
    stage.handle({ pen: g, color: 'blue', kind: 'square', r: 9, visible: lineVis, get: () => [XA, s.L[0]], set: (q) => { s.L[0] = clamp(q[1], -0.4, 7.2); s.pull = false; } });
    stage.handle({ pen: g, color: 'blue', kind: 'square', r: 9, visible: lineVis, get: () => [XB, s.L[1]], set: (q) => { s.L[1] = clamp(q[1], -0.4, 7.2); s.pull = false; } });

    // ---- math: best line / polynomial via the pseudo-inverse
    const xs = (P) => P.map((p) => p[0]), ys = (P) => P.map((p) => p[1]);
    const u = (x) => (x - 5) / 4.6; // scaled x keeps the polynomial well-conditioned
    function bestLine(P) { const [m, c] = lstsq(P.map((p) => [p[0], 1]), ys(P)); return (x) => m * x + c; }
    function bestPoly(P, d) {
      const A = P.map((p) => Array.from({ length: d + 1 }, (_, k) => u(p[0]) ** k));
      const w = mvec(pinv(A, 1e-10), ys(P));
      return (x) => w.reduce((acc, wk, k) => acc + wk * u(x) ** k, 0);
    }
    const areaOf = (P, f) => P.reduce((a, p) => a + (p[1] - f(p[0])) ** 2, 0);

    const groups = [ui.group(), ui.group(), ui.group(), ui.group()];
    // controls not used in this beat are taken out of the dock (not just hidden)
    const showBeat = (b) => { groups.forEach((el) => el.remove()); ui.dock.appendChild(groups[b]); };
    ui.readout(() => fmt(areaOf(s.pts, lineAt), 2), { icon: '🟥', color: 'coral', title: 'total square area', into: groups[0] });
    ui.button({ icon: '🧲', title: 'snap to best', into: groups[0], onClick: () => { const f = bestLine(s.pts); s.L = [f(XA), f(XB)]; } });
    ui.button({ icon: '🧲', title: 'let the springs pull', into: groups[1], onClick: () => { s.L = [1 + Math.random() * 5, 1 + Math.random() * 5]; s.pull = true; } });
    ui.readout(() => fmt(areaOf(s.pts, lineAt), 2), { icon: '🟥', color: 'coral', title: 'total square area', into: groups[1] });
    const dSl = ui.slider({ icon: '〰️', color: 'blue', min: 0, max: 7, step: 1, value: s.deg, title: 'polynomial degree', into: groups[2], onInput: (v) => (s.deg = v) });
    ui.readout(() => `d=${s.deg}`, { icon: '〰️', color: 'blue', title: 'degree', into: groups[2] });
    ui.readout(() => fmt(areaOf(s.pts, bestPoly(s.pts, s.deg)), 2), { icon: '🟥', color: 'coral', title: 'total square area', into: groups[2] });
    ui.toggle({ icon: '🗳️', title: 'vote out the troublemaker (RANSAC)', color: 'lime', into: groups[3], onChange: (v) => (s.ransac = v) });
    ui.readout(() => { const all = [...s.pts, s.out], f = bestLine(all); const tot = areaOf(all, f) || 1; return `${Math.round((100 * (s.out[1] - f(s.out[0])) ** 2) / tot)}%`; }, { icon: '😈', color: 'coral', title: "troublemaker's share of the area", into: groups[3] });
    void dSl;

    ui.beats(['🖐️', '🧲', '📈', '😈'], (b) => {
      s.beat = b; s.t = 0; showBeat(b);
      if (b === 0) s.L = [4.6, 1.2];
      if (b === 1) { s.L = [5.8, 0.8]; s.pull = true; }
    });
    showBeat(0);

    // ---- drawing helpers
    function squares(P, f, o = {}) {
      P.forEach((p) => {
        const y0 = f(p[0]), r = p[1] - y0, a = Math.abs(r);
        if (a < 1e-3) return;
        const c = 'coral', fa = (typeof o.fill === 'function' ? o.fill(p) : (o.fill ?? 0.18)) * (themeName === 'dark' ? 1.6 : 1);
        // the square sits beside its spring; flip left near the right edge
        const left = p[0] + a > 10.1;
        g.rect(left ? p[0] - a : p[0], Math.min(y0, p[1]), a, a, { fill: alpha(c, fa), color: alpha(c, 0.3 + fa), width: 1.5 });
        g.spring([p[0], y0], p, { color: alpha(c, 0.95), width: 2, coils: Math.max(3, Math.min(9, Math.round(a * 4))), amp: g.world(5) });
      });
    }
    function curve(f, color = 'blue', o = {}) {
      const pts = []; for (let k = 0; k <= 200; k++) { const x = -0.3 + (10.6 * k) / 200; pts.push([x, clamp(f(x), -50, 50)]); }
      g.clip(() => g.path(pts, { color, width: o.width ?? 4, dash: o.dash, alpha: o.alpha }));
    }
    function areaMeter(area, best, parts) {
      // top-left: coral bar = how much square area we have; gold tick = the best possible
      const hud = stage.hud, ctx = hud.ctx, X = 12, Y = 12, W = Math.min(220, hud.area.w * 0.45);
      const max = Math.max(best * 4, 8);
      ctx.save();
      ctx.fillStyle = alpha('panel', 0.92); ctx.beginPath(); ctx.roundRect(X, Y, W + 54, 40, 12); ctx.fill();
      ctx.font = '18px system-ui, "Noto Color Emoji", sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('🟥', X + 8, Y + 20);
      const bx = X + 38, bw = W;
      ctx.fillStyle = alpha('faint', 0.6); ctx.beginPath(); ctx.roundRect(bx, Y + 13, bw, 14, 7); ctx.fill();
      let x = bx;
      for (const [v, c] of parts ?? [[area, 'coral']]) {
        const w = Math.min(bw - (x - bx), (bw * v) / max);
        ctx.fillStyle = C[c] ?? c; ctx.beginPath(); ctx.roundRect(x, Y + 13, Math.max(w, 2), 14, 7); ctx.fill();
        x += w;
      }
      if (best !== null) {
        const tx = bx + Math.min(bw, (bw * best) / max);
        ctx.strokeStyle = C.gold; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(tx, Y + 6); ctx.lineTo(tx, Y + 34); ctx.stroke();
      }
      ctx.restore();
      if (best !== null && area <= best * 1.02 + 1e-6) g.emoji('🏆', g.toWorld([X + W + 36, Y + 20]), 22);
    }

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 1 && s.pull) {
          // the springs pull the stick: gradient flow on Σ r² (centered so both knobs move independently)
          const P = s.pts, xm = P.reduce((a, p) => a + p[0], 0) / P.length;
          const sxx = P.reduce((a, p) => a + (p[0] - xm) ** 2, 0);
          const r = P.map((p) => p[1] - lineAt(p[0]));
          const dc = r.reduce((a, x) => a + x, 0) / P.length, dm = r.reduce((a, x, k) => a + x * (P[k][0] - xm), 0) / sxx;
          const k = Math.min(1, dt * 1.6);
          s.L = [s.L[0] + k * (dc + dm * (XA - xm)), s.L[1] + k * (dc + dm * (XB - xm))];
        }
      },
      draw() {
        g.grid({ step: 1 });
        const P = s.pts;
        if (s.beat <= 1) {
          const best = bestLine(P);
          const area = areaOf(P, lineAt), bestA = areaOf(P, best);
          curve(best, alpha('gold', 0.9), { width: 2.5, dash: [8, 6] });
          squares(P, lineAt);
          g.clip(() => g.line([-1, lineAt(-1)], [11, lineAt(11)], { color: 'blue', width: 5 }));
          areaMeter(area, bestA);
        } else if (s.beat === 2) {
          const f = bestPoly(P, s.deg);
          squares(P, f);
          curve(f, 'blue', { width: 4 });
          areaMeter(areaOf(P, f), null);
          let wild = 0; for (let x = 0; x <= 10; x += 0.1) wild = Math.max(wild, Math.abs(f(x) - 3.5));
          if (wild > 5) g.emoji('😵', [g.view[2] - g.world(34), g.view[3] - g.world(80)], 30);
        } else {
          const all = [...P, s.out];
          const clean = bestLine(P), yank = bestLine(all);
          curve(clean, alpha('lime', 0.9), { width: 3, dash: [8, 6] });
          squares(all, yank, { fill: (p) => (p === s.out ? 0.38 : 0.12) });
          curve(yank, 'blue', { width: 5 });
          if (s.ransac) {
            const res = ransacLine(all, { thresh: 0.9, iters: 80, seed: 5 });
            const inl = all.filter((_, k) => res.inliers[k]);
            if (inl.length >= 2) curve(bestLine(inl), 'gold', { width: 4 });
            all.forEach((p, k) => { if (!res.inliers[k]) g.circle(p, g.world(16), { color: 'coral', width: 3 }); });
          }
          const sh = (s.out[1] - yank(s.out[0])) ** 2, tot = areaOf(all, yank);
          areaMeter(tot, null, [[tot - sh, alpha('coral', 0.4)], [sh, 'coral']]);
          g.emoji('😈', [s.out[0], s.out[1] - g.world(26)], 24);
        }
        P.forEach((p) => g.dot(p, 6, { color: 'teal', ring: 'bg' }));
      },
    };
  },
};
