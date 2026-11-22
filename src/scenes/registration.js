// Point matching (registration): two copies of the same dino, and we KNOW which
// dot goes with which. Slide both middles together, then find the one best turn —
// the SVD of a little 2×2 "how do the dots line up" table tells you exactly.
import { C, alpha, cmapCSS, col } from '../viz/palette.js';
import { kabsch } from '../core/estimation.js';
import { mean, mvec, rot2, vadd, vsub } from '../core/linalg.js';
import { rng, smoothstep, wrapAngle } from '../core/random.js';
import { fmt } from '../viz/ui.js';

// ------------------------------------------------------------------ shared helpers
// (exported so the ICP scene can reuse the dino + HUD widgets)

// A friendly long-neck dino outline (closed polygon), roughly 4.3 × 2.9 world units.
const DINO_POLY = [
  [-2.3, 0.1], [-1.6, 0.38], [-0.9, 0.8], [-0.2, 0.95], [0.5, 0.78], [0.9, 0.9], [1.15, 1.45], [1.3, 1.85],
  [1.65, 1.97], [2.0, 1.78], [1.78, 1.6], [1.45, 1.38], [1.2, 0.6], [1.08, -0.9], [0.74, -0.9], [0.7, -0.12],
  [0.1, -0.05], [-0.33, -0.15], [-0.36, -0.9], [-0.74, -0.9], [-0.8, 0.0], [-1.5, 0.05],
];
// Points evenly spaced along the outline (not centered).
function outline(n) {
  const P = DINO_POLY, L = [];
  let tot = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); L.push(d); tot += d; }
  const out = [];
  for (let k = 0; k < n; k++) {
    let s = (k / n) * tot, i = 0;
    while (s > L[i]) { s -= L[i]; i++; }
    const a = P[i], b = P[(i + 1) % P.length], t = s / L[i];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
// n points along the dino, centered on their mean, plus its eye (same frame).
export function dino(n = 28, scale = 1) {
  const out = outline(n), m = mean(out);
  return out.map((p) => [(p[0] - m[0]) * scale, (p[1] - m[1]) * scale]);
}
export function dinoEye(n = 28, scale = 1) {
  const m = mean(outline(n));
  return [(1.62 - m[0]) * scale, (1.8 - m[1]) * scale];
}
export const poseApply = (pts, th, t) => { const R = rot2(th); return pts.map((p) => vadd(mvec(R, p), t)); };

// Rounded HUD card in pixel space.
export function hudBox(hud, x, y, w, h, a = 0.92) {
  const ctx = hud.ctx;
  ctx.save(); ctx.fillStyle = alpha('panel', a);
  ctx.strokeStyle = alpha('faint', 0.7); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill(); ctx.stroke(); ctx.restore();
}
// Tiny line plot in a pixel rect. series = [{ vals, color, width, dash, dots }]
export function hudPlot(hud, r, series, o = {}) {
  const ctx = hud.ctx;
  hudBox(hud, r.x, r.y, r.w, r.h);
  const all = series.flatMap((s) => s.vals).filter(Number.isFinite);
  const ymin = o.ymin ?? 0, ymax = o.ymax ?? Math.max(1e-9, ...all) * 1.08;
  const n = o.n ?? Math.max(2, ...series.map((s) => s.vals.length));
  const px = r.x + 30, pw = r.w - 40, py = r.y + 10, ph = r.h - 22;
  const X = (i) => px + (n <= 1 ? 0 : (i / (n - 1)) * pw);
  const Y = (v) => py + ph - ((Math.min(Math.max(v, ymin), ymax) - ymin) / (ymax - ymin || 1)) * ph;
  ctx.save();
  ctx.strokeStyle = alpha('muted', 0.6); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + ph); ctx.lineTo(px + pw, py + ph); ctx.stroke();
  if (o.icon) { ctx.font = '14px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.icon, r.x + 15, r.y + r.h / 2); }
  if (o.hline !== undefined) {
    ctx.strokeStyle = col(o.hlineColor ?? 'gold'); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, Y(o.hline)); ctx.lineTo(px + pw, Y(o.hline)); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const s of series) {
    if (!s.vals.length) continue;
    ctx.strokeStyle = col(s.color); ctx.lineWidth = s.width ?? 2.2; ctx.setLineDash(s.dash ?? []);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (s.line !== false) {
      ctx.beginPath();
      let pen = false;
      s.vals.forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return; } if (pen) ctx.lineTo(X(i), Y(v)); else ctx.moveTo(X(i), Y(v)); pen = true; });
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (s.dots) { ctx.fillStyle = col(s.color); s.vals.forEach((v, i) => { if (!Number.isFinite(v)) return; ctx.beginPath(); ctx.arc(X(i), Y(v), s.dotR ?? 2.6, 0, 7); ctx.fill(); }); }
  }
  if (o.marker) {
    const [i, v, c] = o.marker;
    ctx.fillStyle = col(c ?? 'blue'); ctx.strokeStyle = C.bg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(i), Y(v), 5.5, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  return { X, Y };
}
// Small matrix with per-cell colors. Returns its box. colorAt(r,c) → palette key.
export function hudMatrix(hud, M, o = {}) {
  const ctx = hud.ctx;
  const cw = o.cw ?? 52, ch = o.ch ?? 26, d = o.digits ?? 1;
  const W = cw * M[0].length + 22, H = ch * M.length + 12 + (o.title ? 22 : 0);
  const x = o.x ?? hud.area.w - W - 12, y = o.y ?? 12;
  hudBox(hud, x, y, W, H);
  ctx.save();
  let y0 = y + 6;
  if (o.title) {
    ctx.font = '700 15px ui-rounded, system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col(o.titleColor ?? 'ink'); ctx.fillText(o.title, x + W / 2, y + 15); y0 += 22;
  }
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6;
  const bx0 = x + 7, bx1 = x + W - 7, by0 = y0, by1 = y0 + ch * M.length;
  ctx.beginPath(); ctx.moveTo(bx0 + 5, by0); ctx.lineTo(bx0, by0); ctx.lineTo(bx0, by1); ctx.lineTo(bx0 + 5, by1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx1 - 5, by0); ctx.lineTo(bx1, by0); ctx.lineTo(bx1, by1); ctx.lineTo(bx1 - 5, by1); ctx.stroke();
  M.forEach((row, r) => row.forEach((v, c) => {
    const cx = x + 11 + cw * (c + 0.5), cy = y0 + ch * (r + 0.5);
    if (o.cellFill) { const f = o.cellFill(v, r, c); if (f) { ctx.fillStyle = f; ctx.beginPath(); ctx.roundRect(cx - cw / 2 + 2, cy - ch / 2 + 2, cw - 4, ch - 4, 6); ctx.fill(); } }
    ctx.font = `700 ${o.size ?? 15}px ui-rounded, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col(o.colorAt ? o.colorAt(r, c, v) : 'ink');
    ctx.fillText(typeof v === 'string' ? v : fmt(v, d), cx, cy + 1);
  }));
  ctx.restore();
  return { x, y, w: W, h: H };
}
// Draw a ⊕ "middle" marker.
export function centroidMark(g, p, color, size = 9) {
  const s = g.world(size);
  g.circle(p, s, { color, width: 2.5 });
  g.line([p[0] - s * 1.6, p[1]], [p[0] + s * 1.6, p[1]], { color, width: 2 });
  g.line([p[0], p[1] - s * 1.6], [p[0], p[1] + s * 1.6], { color, width: 2 });
}
const rmsDist = (A, B) => Math.sqrt(A.reduce((s, a, i) => s + (a[0] - B[i][0]) ** 2 + (a[1] - B[i][1]) ** 2, 0) / A.length);

// ------------------------------------------------------------------ the scene
export default {
  eq: [
    [['p̄', 'blue'], ' = mean(', ['pᵢ', 'blue'], ')     ', ['q̄', 'gold'], ' = mean(', ['qᵢ', 'gold'], ')'],
    [['H', 'purple'], ' = Σ (', ['pᵢ', 'blue'], ' − ', ['p̄', 'blue'], ')(', ['qᵢ', 'gold'], ' − ', ['q̄', 'gold'], ')ᵀ  =  U Σ Vᵀ'],
    [['R', 'orange'], ' = V Uᵀ      ', ['t', 'orange'], ' = ', ['q̄', 'gold'], ' − ', ['R', 'orange'], ' ', ['p̄', 'blue']],
    ['min  Σ ‖', ['R', 'orange'], ' ', ['pᵢ', 'blue'], ' + ', ['t', 'orange'], ' − ', ['qᵢ', 'gold'], '‖²  =  ', ['error²', 'coral']],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait;
    const g = stage.g.setBounds(tall ? [-3.6, -5.4, 3.6, 5.4] : [-6.6, -3.4, 6.6, 3.4]);
    const base = dino(28, 1.1), eye = dinoEye(28, 1.1);
    const s = {
      beat: 0, t: 0, noise: 0, seed: 5,
      src: { th: -0.85, t: tall ? [-0.4, 2.7] : [-3.6, -0.4] },
      tgt: { th: 0.35, t: tall ? [0.3, -2.9] : [3.4, 0.35] },
    };
    let Q = [];
    const makeTarget = () => {
      const r = rng(s.seed);
      Q = poseApply(base, s.tgt.th, s.tgt.t).map((q) => [q[0] + r.normal(0, s.noise), q[1] + r.normal(0, s.noise)]);
    };
    makeTarget();
    const P = () => poseApply(base, s.src.th, s.src.t);
    const rotHandle = () => vadd(s.src.t, mvec(rot2(s.src.th), [0, 1.9]));

    stage.handle({ pen: g, color: 'blue', kind: 'square', r: 10, icon: '✋', get: () => s.src.t, set: (p) => { s.src.t = p; s.t = 0; } });
    stage.handle({ pen: g, color: 'orange', kind: 'ring', r: 10, get: rotHandle, set: (p) => { s.src.th = Math.atan2(p[1] - s.src.t[1], p[0] - s.src.t[0]) - Math.PI / 2; s.t = 0; } });

    ui.beats(['🎯', '🔄', '✅', '🫨'], (b) => {
      s.beat = b; s.t = 0; noiseS.el.style.opacity = b === 3 ? 1 : 0.55;
      if (b === 3 && s.noise < 0.05) { s.noise = 0.22; noiseS.set(0.22); makeTarget(); }
    });
    const noiseS = ui.slider({ icon: '🫨', color: 'purple', min: 0, max: 0.45, value: 0, title: 'noise', onInput: (v) => { s.noise = v; makeTarget(); } });
    noiseS.el.style.opacity = 0.55;
    ui.button({ icon: '🎲', title: 'new noise', onClick: () => { s.seed++; makeTarget(); s.t = 0; } });
    ui.button({ icon: '🔀', title: 'scramble start', onClick: () => { const r = rng(s.seed++ * 7); s.src = { th: r.uniform(-3, 3), t: tall ? [r.uniform(-1, 1), r.uniform(1.8, 3.2)] : [r.uniform(-4.5, -2), r.uniform(-1.5, 1.5)] }; s.t = 0; } });
    ui.readout(() => fmt(view.err, 2), { icon: '📏', color: 'coral', title: 'mismatch' });

    const view = { err: 0 };

    return {
      update(dt) { s.t += dt; },
      draw() {
        g.grid({ step: 1 });
        const Ps = P();
        const sol = kabsch(Ps, Q);
        const mp = mean(Ps), mq = mean(Q);
        const H = sol.H;
        const thStar = Math.atan2(H[0][1] - H[1][0], H[0][0] + H[1][1]);
        // current displayed copies
        let A = Ps, B = Q, shownTh = 0;
        const cyc = 4.6, ph = s.t % cyc;
        const k = smoothstep((ph - 0.7) / 1.6);
        if (s.beat === 0) {
          A = Ps.map((p) => vsub(p, mp.map((x) => x * k)));
          B = Q.map((q) => vsub(q, mq.map((x) => x * k)));
        } else if (s.beat === 1) {
          shownTh = thStar * k;
          A = poseApply(Ps.map((p) => vsub(p, mp)), shownTh, [0, 0]);
          B = Q.map((q) => vsub(q, mq));
        } else {
          // rotate about own middle while sliding the middle onto the target's middle
          const kk = s.beat === 3 ? Math.max(k, smoothstep(s.t / 1.2)) : k;
          const Rk = rot2(thStar * kk), c = vadd(mp, vsub(mq, mp).map((x) => x * kk));
          A = Ps.map((p) => vadd(mvec(Rk, vsub(p, mp)), c));
        }
        view.err = rmsDist(A, B);

        // ghost of where the dragged source really sits
        if (s.beat !== 2 || k < 1) g.poly(Ps, { fill: alpha('blue', 0.05), color: alpha('blue', 0.3), width: 1.5, dash: [4, 5] });
        // the two shapes
        g.poly(B, { fill: alpha('gold', 0.12), color: alpha('gold', 0.85), width: 2 });
        g.poly(A, { fill: alpha('blue', 0.14), color: alpha('blue', 0.85), width: 2 });
        // known matches: thin teal threads; turn coral as the leftover error once aligned
        const settled = s.beat >= 2 && k > 0.98;
        A.forEach((a, i) => g.line(a, B[i], { color: settled ? alpha('coral', 0.9) : alpha('teal', 0.55), width: settled ? 2.5 : 1.2 }));
        A.forEach((p) => g.dot(p, 4.5, { color: 'blue' }));
        B.forEach((q) => g.circle(q, g.world(6), { color: 'gold', width: 2.2 }));
        // eyes (so you can tell head from tail)
        const eyeOf = (pts) => { const sol2 = kabsch(base, pts); return vadd(mvec(sol2.R, eye), sol2.t); };
        g.dot(eyeOf(A), 3.5, { color: 'ink' }); g.dot(eyeOf(B), 3.5, { color: 'ink' });
        // rotate lever
        g.line(s.src.t, rotHandle(), { color: alpha('orange', 0.5), width: 2, dash: [3, 4] });

        if (s.beat === 0) {
          const cA = mean(A), cB = mean(B);
          if (k < 0.99) {
            g.arrow(cA, [0, 0], { color: alpha('blue', 0.5), width: 2, dash: [5, 5] });
            g.arrow(cB, [0, 0], { color: alpha('gold', 0.6), width: 2, dash: [5, 5] });
          }
          centroidMark(g, cA, 'blue'); centroidMark(g, cB, 'gold');
          g.emoji('🎯', [0, -0.05], 20 + 8 * k);
        }
        if (s.beat === 1) {
          // the turn: a wedge from 0 to the angle found by SVD
          g.wedge([0, 0], 2.7, Math.PI / 2, Math.PI / 2 + shownTh, { color: 'orange', alpha: 0.18 });
          g.arc([0, 0], 2.7, Math.PI / 2, Math.PI / 2 + thStar, { color: alpha('orange', 0.5), width: 2, dash: [4, 4] });
          const tip = [-Math.sin(shownTh) * 2.7, Math.cos(shownTh) * 2.7];
          g.arrow([0, 0], tip, { color: 'orange', width: 3 });
          g.text(`${fmt(shownTh * 180 / Math.PI, 0)}°`, [tip[0] * 1.2, tip[1] * 1.15], { color: 'orange', size: 18 });
          centroidMark(g, [0, 0], 'ink', 7);
          drawH(H, thStar, shownTh);
        }
        if (s.beat >= 2) {
          centroidMark(g, mean(B), 'gold', 6);
          if (k > 0.98) {
            g.emoji(view.err < 0.15 ? '✅' : '👌', vadd(mq, [0, 2.0]), 30);
          } else {
            g.arrow(mp, vadd(mp, vsub(mq, mp).map((x) => x * Math.max(k, 0.02))), { color: alpha('orange', 0.6), width: 2.5 });
          }
          errMeter(stage.hud, view.err, rmsDist(Ps, Q));
        }
      },
    };

    // the 2×2 table H (cells tinted by value) + the "which turn is cheapest" valley
    function drawH(H, thStar, shownTh) {
      const hud = stage.hud, area = g.area;
      const mx = Math.max(...H.flat().map(Math.abs)) || 1;
      const box = hudMatrix(hud, H, {
        title: 'H', titleColor: 'purple', digits: 1, cw: area.w < 500 ? 46 : 56, ch: 30,
        x: tall ? area.x + 10 : area.x + area.w - (area.w < 500 ? 46 : 56) * 2 - 34,
        y: tall ? area.y + area.h - 92 : area.y + 10,
        cellFill: (v) => alpha(cmapCSS(0.5 + 0.5 * v / mx, 'div'), 0.85),
        colorAt: () => 'black',
      });
      // E(θ) valley: error after turning by θ (the dot rolls to the bottom = θ*)
      const Pc = Ps0().map((p) => vsub(p, mean(Ps0()))), Qc = Q.map((q) => vsub(q, mean(Q)));
      const vals = [], n = 61;
      for (let i = 0; i < n; i++) {
        const th = -Math.PI + (2 * Math.PI * i) / (n - 1);
        vals.push(rmsDist(poseApply(Pc, th, [0, 0]), Qc));
      }
      const w = tall ? area.w - box.w - 30 : Math.min(250, area.w * 0.5), h = tall ? box.h : 104;
      const idx = ((wrapAngle(shownTh) + Math.PI) / (2 * Math.PI)) * (n - 1);
      const cur = rmsDist(poseApply(Pc, shownTh, [0, 0]), Qc);
      const pl = hudPlot(hud, { x: area.x + area.w - w - 12, y: tall ? box.y : box.y + box.h + 8, w, h }, [{ vals, color: 'coral' }], { icon: '📏', ymin: 0, marker: [idx, cur, 'orange'] });
      const iStar = ((wrapAngle(thStar) + Math.PI) / (2 * Math.PI)) * (n - 1);
      const ctx = hud.ctx;
      ctx.save(); ctx.fillStyle = col('gold'); ctx.beginPath(); ctx.arc(pl.X(iStar), pl.Y(0) + 0.5, 4, 0, 7); ctx.fill(); ctx.restore();
    }
    function Ps0() { return P(); }
    function errMeter(hud, e, e0) {
      const area = g.area, w = Math.min(230, area.w * 0.5);
      const x = area.x + area.w - w - 12, y = area.y + 12;
      hudBox(hud, x, y, w, 58);
      const ctx = hud.ctx;
      const bar = (yy, v, color) => {
        const t = Math.min(1, v / Math.max(e0, 1e-6));
        ctx.fillStyle = alpha('faint', 0.6); ctx.beginPath(); ctx.roundRect(x + 34, yy, w - 46, 12, 6); ctx.fill();
        ctx.fillStyle = col(color); ctx.beginPath(); ctx.roundRect(x + 34, yy, Math.max(3, (w - 46) * t), 12, 6); ctx.fill();
      };
      ctx.save();
      ctx.font = '15px system-ui, "Apple Color Emoji", sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText('🏁', x + 17, y + 18); ctx.fillText('✅', x + 17, y + 40);
      bar(y + 12, e0, alpha('coral', 0.45)); bar(y + 34, e, 'coral');
      ctx.restore();
    }
  },
};
