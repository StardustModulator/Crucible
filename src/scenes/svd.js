// SVD: every matrix is just  turn → stretch → turn.
// A round smiley goes in, gets spun (Vᵀ), squeezed along the two axes (Σ),
// spun again (U) — and comes out as an egg. The egg's long and short axes
// are the singular vectors; how long they are is σ₁, σ₂.
// Then: a picture is a matrix too, and it can be rebuilt from "stripe layers".
import { C, alpha, mix, cmapCSS } from '../viz/palette.js';
import { svd, mmul, mvec, det, outer, rot2 } from '../core/linalg.js';
import { smoothstep, clamp, lerp } from '../core/random.js';
import { fmt } from '../viz/ui.js';
import { drawMatrix } from './matrix.js';

// 16×16 pixel cat. '#' = 1, '+' = .75, '@' = .5, '.' = 0
const ART = [
  '................',
  '.#............#.',
  '.##..........##.',
  '.#+#........#+#.',
  '.#++########++#.',
  '.#............#.',
  '#..............#',
  '#...@@....@@...#',
  '#...@@....@@...#',
  '#..............#',
  '#......++......#',
  '.#....#..#....#.',
  '..#....##....#..',
  '...#........#...',
  '....########....',
  '................',
].map((r) => [...r].map((ch) => ({ '#': 1, '+': 0.75, '@': 0.5 }[ch] ?? 0)));
const ART_SVD = svd(ART);

// Decompose A = R(θu) · diag(σ1, s2) · R(−θv) with both outer factors pure turns
// (a mirror, if any, is folded into the sign of s2).
function turnStretchTurn(A) {
  const { U, S, V } = svd(A);
  const u = U.map((r) => r.slice()), v = V.map((r) => r.slice());
  if (det(v) < 0) { v[0][1] *= -1; v[1][1] *= -1; u[0][1] *= -1; u[1][1] *= -1; }
  let s2 = S[1];
  if (det(u) < 0) { u[0][1] *= -1; u[1][1] *= -1; s2 = -s2; }
  return { th_u: Math.atan2(u[1][0], u[0][0]), th_v: Math.atan2(v[1][0], v[0][0]), s1: S[0], s2, U: u, V: v, S };
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The partial map after progress p ∈ [0, 3]: 0..1 turn, 1..2 stretch, 2..3 turn.
function stageMap(d, p) {
  const a = clamp(p, 0, 1), b = clamp(p - 1, 0, 1), c = clamp(p - 2, 0, 1);
  const Vt = rot2(-wrap(d.th_v) * smoothstep(a));
  const S = [[lerp(1, d.s1, smoothstep(b)), 0], [0, lerp(1, d.s2, smoothstep(b))]];
  const U = rot2(wrap(d.th_u) * smoothstep(c));
  return mmul(U, mmul(S, Vt));
}

// The smiley (in its own unit-circle world)
const RING = Array.from({ length: 25 }, (_, k) => [Math.cos((2 * Math.PI * k) / 24), Math.sin((2 * Math.PI * k) / 24)]);
const CIRC = Array.from({ length: 73 }, (_, k) => [Math.cos((2 * Math.PI * k) / 72), Math.sin((2 * Math.PI * k) / 72)]);
const EYE = (cx) => Array.from({ length: 16 }, (_, k) => [cx + 0.13 * Math.cos((2 * Math.PI * k) / 16), 0.3 + 0.17 * Math.sin((2 * Math.PI * k) / 16)]);
const MOUTH = Array.from({ length: 17 }, (_, k) => { const a = Math.PI * (1.15 + 0.7 * (k / 16)); return [0.58 * Math.cos(a), 0.05 + 0.58 * Math.sin(a)]; });

export default {
  eq: [
    [['A', 'orange'], ' = ', ['U', 'ink'], ' ', ['Σ', 'gold'], ' ', ['V', 'ink'], 'ᵀ    (turn · stretch · turn)'],
    [['A', 'orange'], ['v₁', 'red'], ' = ', ['σ₁', 'red'], ['u₁', 'red'], '      ', ['A', 'orange'], ['v₂', 'green'], ' = ', ['σ₂', 'green'], ['u₂', 'green'], '      σ₁ ≥ σ₂ ≥ 0'],
    [['A', 'orange'], '  = ', ['σ₁', 'gold'], ' u₁v₁ᵀ + ', ['σ₂', 'gold'], ' u₂v₂ᵀ + …     ', ['A', 'orange'], '_k = first k layers (best rank-k picture)'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const s = { i: [1.5, 0.6], j: [0.25, 0.85], beat: 0, t: 0, k: 0, auto: true, kt: 0 };
    const A = () => [[s.i[0], s.j[0]], [s.i[1], s.j[1]]];
    const BOUNDS = {
      main: [-2.5, -2.1, 2.5, 2.1],
      stripL: [-2.1, -2.3, 15.9, 2.4], stripP: [-2.1, -6.6, 6.7, 2.4],
      imgL: [0, 0, 41, 19], imgP: [0, -21, 17.5, 19],
    };
    const want = () => s.beat === 1 ? (stage.portrait ? BOUNDS.stripP : BOUNDS.stripL)
      : s.beat === 3 ? (stage.portrait ? BOUNDS.imgP : BOUNDS.imgL) : BOUNDS.main;
    g.setBounds(want());
    const snap = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    const onMain = () => s.beat === 0 || s.beat === 2;
    stage.handle({ pen: g, color: 'orange', visible: onMain, get: () => s.i, set: (p) => (s.i = snap(p)) });
    stage.handle({ pen: g, color: 'orange', visible: onMain, get: () => s.j, set: (p) => (s.j = snap(p)) });

    const gMat = ui.group(), gImg = ui.group();
    const showFor = (b) => { gMat.remove(); gImg.remove(); ui.dock.appendChild(b === 3 ? gImg : gMat); };
    ui.beats(['🥚', '🎞️', '📏', '🖼️'], (b) => { s.beat = b; s.t = 0; showFor(b); g.setBounds(want()); if (b === 3) { s.k = 0; s.kt = 0; auto.set(true, false); s.auto = true; kSl.set(0); } });
    ui.button({ icon: '⚪', title: 'plain', into: gMat, onClick: () => { s.i = [1, 0]; s.j = [0, 1]; } });
    ui.button({ icon: '↗️', title: 'shear', into: gMat, onClick: () => { s.i = [1, 0]; s.j = [1.2, 1]; } });
    ui.button({ icon: '🪞', title: 'mirror', into: gMat, onClick: () => { s.i = [1.2, 0.4]; s.j = [0.6, -0.8]; } });
    ui.button({ icon: '🥞', title: 'flatten', into: gMat, onClick: () => { s.i = [1.2, 0.6]; s.j = [0.6, 0.3]; } });
    ui.readout(() => fmt(turnStretchTurn(A()).S[0], 2), { icon: 'σ₁', color: 'red', title: 'biggest stretch', into: gMat });
    ui.readout(() => fmt(turnStretchTurn(A()).S[1], 2), { icon: 'σ₂', color: 'green', title: 'smallest stretch', into: gMat });
    const kSl = ui.slider({ icon: '🧅', color: 'gold', min: 0, max: 16, step: 1, value: 0, title: 'layers k', into: gImg, onInput: (v) => { s.k = v; s.auto = false; auto.set(false, false); } });
    const auto = ui.toggle({ icon: '🎬', title: 'build it layer by layer', value: true, color: 'gold', into: gImg, onChange: (v) => { s.auto = v; if (v) { s.k = 0; s.kt = 0; kSl.set(0); } } });
    ui.readout(() => `k=${s.k}`, { icon: '🧅', color: 'gold', title: 'layers used', into: gImg });
    ui.readout(() => { const S = ART_SVD.S, tot = S.reduce((a, x) => a + x * x, 0); return `${Math.round((100 * S.slice(0, s.k).reduce((a, x) => a + x * x, 0)) / tot)}%`; }, { icon: '🔋', color: 'lime', title: 'how much of the picture', into: gImg });
    showFor(0);

    // ------------------------------------------------------------ drawing helpers
    function smiley(f, o = {}) {
      const fade = o.fade ?? 1;
      g.poly(CIRC.map(f), { fill: alpha('teal', 0.13 * fade), color: alpha('teal', 0.9 * fade), width: o.width ?? 2.5 });
      g.poly(EYE(-0.35).map(f), { fill: alpha('ink', 0.85 * fade), stroke: false });
      g.poly(EYE(0.35).map(f), { fill: alpha('ink', 0.85 * fade), stroke: false });
      g.path(MOUTH.map(f), { color: alpha('pink', fade), width: o.mouth ?? 4 });
      if (o.dots !== false) RING.slice(0, 24).forEach((p, k) => g.dot(f(p), k === 0 ? 5 : 3, { color: k === 0 ? 'pink' : alpha('teal', 0.9 * fade) }));
    }
    function axesArrows(M, d, at = [0, 0], sc = 1, w = 4) {
      const v1 = [d.V[0][0], d.V[1][0]], v2 = [d.V[0][1], d.V[1][1]];
      const a = mvec(M, v1), b = mvec(M, v2);
      g.arrow(at, [at[0] + a[0] * sc, at[1] + a[1] * sc], { color: 'red', width: w });
      g.arrow(at, [at[0] + b[0] * sc, at[1] + b[1] * sc], { color: 'green', width: w });
    }
    function sigmaBars(d, p) {
      // two bars: how much each axis is stretched right now
      const hud = stage.hud, ctx = hud.ctx;
      const b = clamp(p - 1, 0, 1), cur = [lerp(1, d.s1, smoothstep(b)), lerp(1, Math.abs(d.s2), smoothstep(b))];
      const X = 14, H = 120, Y = hud.area.h - H - 30, unit = H / 3;
      ctx.save();
      ctx.fillStyle = alpha('panel', 0.92); ctx.beginPath(); ctx.roundRect(X, Y - 10, 112, H + 36, 12); ctx.fill();
      ctx.strokeStyle = alpha('muted', 0.6); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X + 8, Y + H - unit); ctx.lineTo(X + 104, Y + H - unit); ctx.stroke(); ctx.setLineDash([]);
      ['red', 'green'].forEach((c, q) => {
        const h = Math.min(cur[q], 3) * unit, x = X + 18 + q * 48;
        ctx.fillStyle = C[c]; ctx.beginPath(); ctx.roundRect(x, Y + H - h, 30, Math.max(h, 2), 6); ctx.fill();
        ctx.font = '800 14px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(fmt(cur[q], 2), x + 15, Y + H + 6);
      });
      ctx.restore();
    }
    function stageChips(p) {
      const hud = stage.hud, ctx = hud.ctx, labels = ['Vᵀ 🔄', 'Σ ↔️', 'U 🔄'];
      const w = 74, X = hud.area.w / 2 - (w * 3 + 16) / 2, Y = 12;
      ctx.save(); ctx.font = '800 16px ui-rounded, system-ui, "Noto Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      labels.forEach((l, q) => {
        const on = p > q && p < q + 1.0001, done = p >= q + 1;
        ctx.fillStyle = on ? alpha('gold', 0.35) : alpha('panel', 0.9);
        ctx.beginPath(); ctx.roundRect(X + q * (w + 8), Y, w, 32, 10); ctx.fill();
        if (on) { ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.fillStyle = done || on ? C.ink : C.muted; ctx.fillText(l, X + q * (w + 8) + w / 2, Y + 16);
      });
      ctx.restore();
    }

    function drawMain(d) {
      g.grid({ step: 1 });
      // ghost start circle and ghost final egg
      g.path(CIRC, { color: alpha('muted', 0.45), width: 1.5, dash: [4, 5] });
      const Af = A();
      g.path(CIRC.map((p) => mvec(Af, p)), { color: alpha('orange', 0.5), width: 1.5, dash: [6, 5] });
      if (s.beat === 0) {
        const T = s.t % 10;
        const p = T < 0.6 ? 0 : T < 2.4 ? (T - 0.6) / 1.8 : T < 3.0 ? 1 : T < 4.8 ? 1 + (T - 3) / 1.8 : T < 5.4 ? 2 : T < 7.2 ? 2 + (T - 5.4) / 1.8 : 3;
        const M = stageMap(d, p);
        // the axes it is stretching along (only during Σ)
        if (p >= 1 && p <= 2) { g.line([-9, 0], [9, 0], { color: alpha('red', 0.3), width: 2 }); g.line([0, -9], [0, 9], { color: alpha('green', 0.3), width: 2 }); }
        smiley((q) => mvec(M, q));
        axesArrows(M, d);
        stageChips(p);
        sigmaBars(d, p);
        if (p >= 3) g.emoji('🥚', [g.view[0] + g.world(40), g.view[3] - g.world(40)], 30);
      } else {
        // the egg and its axes = singular vectors
        smiley((q) => q, { fade: 0.35, dots: false, mouth: 2 });
        smiley((q) => mvec(Af, q), { dots: false });
        const v1 = [d.V[0][0], d.V[1][0]], v2 = [d.V[0][1], d.V[1][1]];
        const u1 = [d.U[0][0], d.U[1][0]], u2 = [d.U[0][1], d.U[1][1]];
        g.line([-u1[0] * 9, -u1[1] * 9], [u1[0] * 9, u1[1] * 9], { color: alpha('red', 0.25), width: 2 });
        g.line([-u2[0] * 9, -u2[1] * 9], [u2[0] * 9, u2[1] * 9], { color: alpha('green', 0.25), width: 2 });
        g.arrow([0, 0], v1, { color: alpha('red', 0.6), width: 3, dash: [5, 4] });
        g.arrow([0, 0], v2, { color: alpha('green', 0.6), width: 3, dash: [5, 4] });
        g.arrow([0, 0], [u1[0] * d.s1, u1[1] * d.s1], { color: 'red', width: 5 });
        g.arrow([0, 0], [u2[0] * d.s2, u2[1] * d.s2], { color: 'green', width: 5 });
        // where v goes: curved hop from v to σu
        for (const [v, u, sg, c] of [[v1, u1, d.s1, 'red'], [v2, u2, d.s2, 'green']]) {
          const a = v, b = [u[0] * sg, u[1] * sg], mid = [(a[0] + b[0]) / 2 * 1.25, (a[1] + b[1]) / 2 * 1.25];
          const pts = []; for (let q = 0; q <= 16; q++) { const t = q / 16; pts.push([(1 - t) ** 2 * a[0] + 2 * t * (1 - t) * mid[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * mid[1] + t * t * b[1]]); }
          g.path(pts, { color: alpha(c, 0.55), width: 1.5, dash: [2, 4] });
          const lab = [b[0] + Math.sign(b[0] || 1) * g.world(22), b[1] + Math.sign(b[1] || 1) * g.world(16)];
          g.text(`σ=${fmt(Math.abs(sg), 1)}`, lab, { size: 16, color: c, weight: 800 });
        }
        sigmaBars(d, 3);
      }
      g.text('î', [s.i[0] + g.world(18), s.i[1] - g.world(16)], { size: 18, color: 'orange' });
      g.text('ĵ', [s.j[0] - g.world(16), s.j[1] + g.world(16)], { size: 18, color: 'orange' });
      g.dot([0, 0], 4, { color: 'ink' });
      drawMatrix(stage.hud, Af, { colColors: ['orange', 'orange'] });
    }

    function drawStrip(d) {
      const P = stage.portrait;
      const centers = P ? [[0, 0], [4.6, 0], [4.6, -4.6], [0, -4.6]] : [[0, 0], [4.6, 0], [9.2, 0], [13.8, 0]];
      const sc = 1.6 / Math.max(1, d.s1, Math.abs(d.s2));
      const Ms = [0, 1, 2, 3].map((p) => stageMap(d, p));
      const syms = [['Vᵀ', 'ink'], ['Σ', 'gold'], ['U', 'ink']];
      centers.forEach((c, q) => {
        g.rrect(c[0] - 1.9, c[1] - 1.9, 3.8, 3.8, 14, { fill: alpha('panel2', 0.5), stroke: false });
        if (q === 2) { g.line([c[0] - 1.8, c[1]], [c[0] + 1.8, c[1]], { color: alpha('red', 0.3), width: 2 }); g.line([c[0], c[1] - 1.8], [c[0], c[1] + 1.8], { color: alpha('green', 0.3), width: 2 }); }
        const M = Ms[q];
        smiley((p) => { const m = mvec(M, p); return [c[0] + m[0] * sc, c[1] + m[1] * sc]; }, { width: 2, mouth: 3 });
        axesArrows(M, d, c, sc, 3);
        if (q < 3) {
          const n = centers[q + 1], dx = Math.sign(n[0] - c[0]), dy = Math.sign(n[1] - c[1]);
          const a = [c[0] + dx * 1.95, c[1] + dy * 1.95], b = [n[0] - dx * 1.95, n[1] - dy * 1.95];
          g.arrow(a, b, { color: alpha('muted', 0.8), width: 2.5 });
          g.text(syms[q][0], [(a[0] + b[0]) / 2 + (dy ? 0.4 : 0), (a[1] + b[1]) / 2 + (dx ? 0.4 : 0)], { size: 22, color: syms[q][1], weight: 800 });
        }
      });
      g.emoji('⚪', [centers[0][0], centers[0][1] + 2.15], 18);
      g.emoji('🥚', [centers[3][0], centers[3][1] + 2.15], 18);
    }

    function drawImage() {
      const P = stage.portrait;
      const { U, S, V } = ART_SVD;
      const n = 16, k = s.k;
      const R = ART.map((row, r) => row.map((_, c) => { let v = 0; for (let q = 0; q < k; q++) v += S[q] * U[r][q] * V[c][q]; return v; }));
      const ink = (v) => mix('panel2', 'ink', clamp(v, 0, 1));
      const main = P ? [0.75, 18.5] : [0.5, 18.5];
      g.cells(R, main, 1, { colorFn: (v) => ink(v), gridColor: alpha('bg', 0.25) });
      g.rect(main[0], main[1] - n, n, n, { color: alpha('muted', 0.6), width: 1.5 });
      // the newest layer: σₖ uₖ vₖᵀ — a "stripes" picture (orange +, blue −) made from a column u and a row v
      const ls = 0.5, lay = P ? [4.75, 0] : [20, 17.4];
      g.rect(lay[0], lay[1] - 8, 8, 8, { color: alpha('muted', 0.5), width: 1.5, dash: [4, 4] });
      if (k > 0) {
        const L = outer(U.map((r) => r[k - 1]), V.map((r) => r[k - 1])).map((row) => row.map((x) => x * S[k - 1]));
        const mx = Math.max(...L.flat().map(Math.abs)) || 1;
        g.cells(L, lay, ls, { colorFn: (v) => cmapCSS(0.5 + v / (2 * mx), 'div'), gridColor: null });
        g.cells(U.map((r) => [r[k - 1]]), [lay[0] - 0.8, lay[1]], ls, { colorFn: (v) => cmapCSS(0.5 + v * 1.4, 'div'), gridColor: null });
        g.cells([V.map((r) => r[k - 1])], [lay[0], lay[1] + 0.8], ls, { colorFn: (v) => cmapCSS(0.5 + v * 1.4, 'div'), gridColor: null });
        g.text('×', [lay[0] - 0.55, lay[1] + 0.55], { size: 16, color: 'muted' });
        // the layer gets added onto the picture
        const pulse = 0.5 + 0.5 * Math.sin(s.t * 6);
        if (P) g.arrow([lay[0] + 4, lay[1] + 1.3], [lay[0] + 4, 2.2], { color: alpha('gold', 0.6 + 0.4 * pulse), width: 4 });
        else g.arrow([lay[0] - 1.1, lay[1] - 4], [main[0] + n + 0.3, lay[1] - 4], { color: alpha('gold', 0.6 + 0.4 * pulse), width: 4 });
        g.text('+', P ? [lay[0] + 4.8, 1.75] : [(lay[0] - 1.1 + main[0] + n + 0.3) / 2, lay[1] - 3.3], { size: 24, color: 'gold', weight: 800 });
      }
      // σ bars: the strength of each layer
      const bx = P ? 0.9 : 20, by = P ? -19.5 : 1.2, bw = P ? 1 : 1.15, H = P ? 7.5 : 6.2, top = S[0];
      S.forEach((sg, q) => {
        g.bar(bx + q * bw, by, bw * 0.75, Math.max((sg / top) * H, 0.06), { color: q < k ? (q === k - 1 ? 'gold' : alpha('gold', 0.55)) : alpha('muted', 0.35) });
      });
      g.text('σ', [bx - 0.55, by + H], { size: 18, color: 'gold' });
      // the original, small, for comparison
      if (!P) {
        g.cells(ART, [31.5, 17.4], 0.45, { colorFn: (v) => ink(v), gridColor: null });
        g.emoji('🎯', [31.5 + 3.6, 17.4 + 0.9], 20);
      }
    }

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 3 && s.auto) {
          s.kt += dt;
          const hold = s.k >= 16 ? 2.5 : s.k < 4 ? 1.1 : 0.7;
          if (s.kt > hold) { s.kt = 0; s.k = s.k >= 16 ? 0 : s.k + 1; kSl.set(s.k); }
        }
      },
      draw() {
        const w = want(); if (g.bounds !== w) g.setBounds(w);
        if (s.beat === 3) return drawImage();
        const d = turnStretchTurn(A());
        if (s.beat === 1) drawStrip(d); else drawMain(d);
      },
    };
  },
};
