// Inverse kinematics: "where should my joints go so my hand lands on the 🎯?"
// The arm takes small guesses — each guess is a faded ghost — until it touches.
import { C, alpha } from '../viz/palette.js';
import { planarFK, planarJacobian, planarIKStep, twoLinkIK } from '../core/kinematics.js';
import { pinv, mvec, vsub } from '../core/linalg.js';
import { wrapAngle, smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const L3 = [1.3, 1.0, 0.6];
const L2 = [1.5, 1.2];
const STEP_T = 0.32;        // seconds per iteration (so each guess is visible)
const MAX_IT = 24;
const SPOTS = [[1.6, 1.5], [-1.2, 1.9], [2.2, -0.4], [0.4, 2.4], [-1.9, 0.3]];

export default {
  eq: [
    [['e', 'coral'], ' = ', ['🎯', 'gold'], ' − ', ['p(θ)', 'pink']],
    [['Δθ', 'orange'], ' = ', ['J', 'orange'], 'ᵀ(', ['J', 'orange'], ['J', 'orange'], 'ᵀ + ', ['λ', 'purple'], '²I)⁻¹ ', ['e', 'coral'], '      ', ['θ', 'orange'], ' ← ', ['θ', 'orange'], ' + ', ['Δθ', 'orange']],
    [['λ', 'purple'], ' → 0: pseudo-inverse ', ['J⁺', 'orange'], ' — huge ', ['Δθ', 'orange'], ' near σ → 0'],
    ['min ‖', ['J', 'orange'], ['Δθ', 'orange'], ' − ', ['e', 'coral'], '‖² + ', ['λ', 'purple'], '²‖', ['Δθ', 'orange'], '‖²'],
    ['2 links: cos ', ['θ₂', 'orange'], ' = (x²+y²−L₁²−L₂²) / 2L₁L₂  →  ', ['±θ₂', 'orange'], ' ✌️'],
  ],
  setup({ stage, ui }) {
    const [g, h] = stage.split([[-2.95, -1.5, 2.95, 3.05], [0, 0, 1, 1]], [2.6, 1]);
    const s = {
      beat: 0, t: 0, lam: 0.05, gain: 0.8,
      target: SPOTS[0], spot: 0, touched: false, idle: 0,
      q: [0.2, 0.6, 0.5], qp: null, from: null, ghosts: [], errs: [], it: 0, clock: 0, done: false,
      // beat 3 (unreachable) runs a pinv arm side by side
      qb: null, fromb: null, ghostsb: [], errsb: [],
      morph: 0,
    };
    const Q0 = [0.2, 0.05, 0.05];

    const restart = (fromStart) => {
      if (fromStart) s.q = (s.beat === 2 ? [0.3, 0.4, 0.3] : Q0).slice();
      s.from = s.q.slice(); s.ghosts = [s.q.slice()]; s.errs = [err(s.q)]; s.it = 0; s.clock = 0; s.done = false; s.idle = 0;
      s.qb = s.q.slice(); s.fromb = s.qb.slice(); s.ghostsb = [s.qb.slice()]; s.errsb = [err(s.qb)];
    };
    const err = (q) => Math.hypot(...vsub(s.target, planarFK(L3, q).tip));

    stage.handle({
      pen: g, color: 'gold', r: 13, icon: '🎯', get: () => s.target,
      set: (p) => { s.target = p; s.touched = true; if (s.beat !== 3) restart(s.beat === 1 || s.beat === 2); },
    });

    ui.beats(['🎯', '🌀', '🚫', '✌️'], (b) => {
      s.beat = b; s.t = 0;
      if (b === 0) { s.target = SPOTS[s.spot]; restart(false); }
      if (b === 1) { s.target = [0.6, 2.55]; lamS.set(Math.log10(0.002)); s.lam = 0.002; restart(true); }
      if (b === 2) { s.target = [3.0, 1.7]; lamS.set(Math.log10(0.3)); s.lam = 0.3; restart(true); }
      if (b === 3) s.target = [1.4, 1.2];
      gl.style.display = b === 1 || b === 2 ? '' : 'none';
    });
    const gl = ui.group();
    const lamS = ui.slider({
      into: gl, icon: 'λ', color: 'purple', min: -3, max: 0.5, step: 0.05, value: Math.log10(s.lam), title: 'damping λ',
      onInput: (v) => { s.lam = 10 ** v; restart(true); },
    });
    gl.style.display = 'none';
    ui.button({ icon: '🔁', title: 'try again', onClick: () => restart(s.beat === 1 || s.beat === 2) });
    const two = () => twoLinkIK(L2[0], L2[1], s.target[0], s.target[1], true);
    ui.readout(() => (s.beat === 3 ? fmt(two() ? 0 : Math.hypot(...s.target) - L2[0] - L2[1], 3) : fmt(s.errs.at(-1) ?? 0, 3)), { icon: '📏', color: 'coral', title: 'distance to target' });
    ui.readout(() => (s.beat === 3 ? `✌️ ${two() ? 2 : 0}` : String(s.it)), { icon: '🔁', color: 'ink', title: 'guesses / answers' });
    restart(false);

    const pinvStep = (q) => {
      const e = vsub(s.target, planarFK(L3, q).tip);
      const dq = mvec(pinv(planarJacobian(L3, q)), e.map((x) => x * 0.5));
      return q.map((x, i) => x + dq[i]);
    };

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 3) { s.morph = smoothstep((1 - Math.cos(s.t * 1.1)) / 2); return; }
        s.clock += dt;
        if (s.done) {
          s.idle += dt;
          if (s.beat === 0 && !s.touched && s.idle > 1.6) { s.spot = (s.spot + 1) % SPOTS.length; s.target = SPOTS[s.spot]; restart(false); }
          if ((s.beat === 1 || s.beat === 2) && s.idle > 2.2) restart(true);
          return;
        }
        if (s.clock >= STEP_T) {
          s.clock = 0;
          s.from = s.q.slice();
          const gain = s.beat === 2 ? 0.5 : s.gain;
          const lam = s.beat === 0 ? 0.08 : s.lam;
          s.q = planarIKStep(L3, s.q, s.target, { lambda: lam, gain }).q;
          s.ghosts.push(s.q.slice()); s.errs.push(err(s.q)); s.it++;
          if (s.beat === 2) {
            s.fromb = s.qb.slice(); s.qb = pinvStep(s.qb);
            s.ghostsb.push(s.qb.slice()); s.errsb.push(err(s.qb));
          }
          if (s.errs.at(-1) < 0.004 || s.it >= MAX_IT) s.done = true;
        }
      },
      draw() {
        g.grid({ step: 0.5 });
        const reach = s.beat === 3 ? L2[0] + L2[1] : L3[0] + L3[1] + L3[2];
        g.circle([0, 0], reach, { color: alpha('muted', 0.45), width: 1.5, dash: [6, 6] });
        if (s.beat === 3) drawTwo(g, s);
        else {
          const u = s.done ? 1 : smoothstep(s.clock / (STEP_T * 0.7));
          const between = (a, b) => a.map((x, i) => x + wrapAngle(b[i] - x) * u);
          // ghosts of every guess so far
          if (s.beat === 2) drawGhosts(g, s.ghostsb, 'purple');
          drawGhosts(g, s.ghosts, 'blue');
          if (s.beat === 2) {
            const fb = planarFK(L3, between(s.fromb, s.qb));
            g.arm(fb.points, { width: 14, colors: ['purple', 'purple', 'purple'], alpha: 0.75, jointColor: 'orange', handColor: 'pink', base: false });
          }
          const f = planarFK(L3, between(s.from, s.q));
          g.arm(f.points, { width: 18, colors: ['slate', 'slate', 'slate'] });
          g.line(f.tip, s.target, { color: 'coral', width: 2.5, dash: [5, 4] });
          if (s.done && s.errs.at(-1) < 0.01) g.emoji('✅', [s.target[0] + 0.35, s.target[1] + 0.35], 24);
          if (s.beat === 2) g.emoji('🚫', [s.target[0] + 0.3, s.target[1] + 0.4], 24);
        }
        drawPlot(h, s);
      },
    };
  },
};

function drawGhosts(g, ghosts, color) {
  const n = ghosts.length;
  ghosts.forEach((q, k) => {
    if (k === n - 1) return;
    const f = planarFK(L3, q);
    const a = 0.08 + 0.3 * ((k + 1) / n);
    g.arm(f.points, { width: 9, colors: [color, color, color], alpha: a, base: false, jointColor: color, handColor: 'pink' });
  });
  // hand path: where each guess put the hand
  const tips = ghosts.map((q) => planarFK(L3, q).tip);
  g.path(tips, { color: alpha(color === 'blue' ? 'pink' : color, 0.6), width: 2, dash: [2, 4] });
  tips.forEach((p) => g.dot(p, 3.5, { color: color === 'blue' ? 'pink' : color }));
}

// two analytic answers for a 2-link arm: elbow up ✌️ elbow down
function drawTwo(g, s) {
  const [x, y] = s.target;
  const up = twoLinkIK(L2[0], L2[1], x, y, false), dn = twoLinkIK(L2[0], L2[1], x, y, true);
  if (!up) {
    const a = Math.atan2(y, x);
    const f = planarFK(L2, [a, 0]);
    g.arm(f.points, { width: 18, colors: ['slate', 'slate'] });
    g.line(f.tip, s.target, { color: 'coral', width: 2.5, dash: [5, 4] });
    g.emoji('🚫', [x + 0.3, y + 0.4], 26);
    return;
  }
  const fu = planarFK(L2, up), fd = planarFK(L2, dn);
  // both answers are real arms; they take turns glowing
  const k = s.morph;
  g.arm(fd.points, { width: 17, colors: ['purple', 'purple'], alpha: 0.3 + 0.65 * k, jointColor: 'orange' });
  g.arm(fu.points, { width: 17, colors: ['teal', 'teal'], alpha: 0.3 + 0.65 * (1 - k), jointColor: 'orange', base: false });
  g.emoji('☝️', [fu.points[1][0], fu.points[1][1] + 0.38], 24);
  g.emoji('👇', [fd.points[1][0], fd.points[1][1] - 0.38], 24);
  g.circle(s.target, 0.2, { color: 'gold', width: 3 });
}
function arcPts(a, b, r) {
  const a0 = Math.atan2(a[1], a[0]), a1 = a0 + wrapAngle(Math.atan2(b[1], b[0]) - a0);
  const pts = []; for (let k = 1; k < 20; k++) { const t = a0 + ((a1 - a0) * k) / 20; pts.push([r * Math.cos(t), r * Math.sin(t)]); }
  return pts;
}

// error vs guess number, log scale
function drawPlot(h, s) {
  const v = h.view, W = v[2] - v[0], H = v[3] - v[1];
  const [x0, y0, x1, y1] = [v[0] + 0.14 * W, v[1] + 0.12 * H, v[2] - 0.06 * W, v[3] - 0.1 * H];
  h.fillBg(alpha('panel', 0.5));
  if (s.beat === 3) {
    // two answers, side by side as joint-angle pairs
    const [x, y] = s.target;
    const up = twoLinkIK(L2[0], L2[1], x, y, false), dn = twoLinkIK(L2[0], L2[1], x, y, true);
    // pixel layout so it fits both a tall side panel and a short strip under the arm
    const A = h.area, ctx = h.ctx, wide = A.w > A.h * 1.3;
    const cx = A.x + A.w / 2, cy = A.y + A.h / 2;
    const rowW = Math.min(200, A.w * (wide ? 0.5 : 0.8)), rowH = 38;
    const ox = wide ? cx - rowW / 2 + 40 : cx - rowW / 2;
    const top = wide ? cy - rowH - 4 : cy - rowH * 0.3;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '40px system-ui, "Apple Color Emoji", sans-serif'; ctx.fillStyle = C.ink;
    ctx.fillText(up ? '✌️' : '🚫', wide ? ox - 70 : cx, wide ? cy : top - 46);
    if (up) [[up, 'teal', '☝️'], [dn, 'purple', '👇']].forEach(([q, c, e], k) => {
      const y = top + k * (rowH + 8);
      ctx.strokeStyle = C[c]; ctx.lineWidth = 2.5; ctx.fillStyle = alpha(c, 0.12);
      ctx.beginPath(); ctx.roundRect(ox, y, rowW, rowH, 10); ctx.fill(); ctx.stroke();
      ctx.font = '20px system-ui, "Apple Color Emoji", sans-serif'; ctx.fillStyle = C.ink;
      ctx.fillText(e, ox + 22, y + rowH / 2);
      ctx.font = '700 17px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = C.orange;
      ctx.fillText(`${Math.round(q[0] * 180 / Math.PI)}°`, ox + rowW * 0.48, y + rowH / 2);
      ctx.fillText(`${Math.round(q[1] * 180 / Math.PI)}°`, ox + rowW * 0.8, y + rowH / 2);
    });
    ctx.restore();
    return;
  }
  const X = (k) => x0 + ((x1 - x0) * k) / MAX_IT;
  const Y = (e) => y0 + ((y1 - y0) * (Math.log10(Math.max(e, 1e-3)) + 3)) / 4;
  h.line([x0, y0], [x1, y0], { color: alpha('muted', 0.7), width: 1.5 });
  h.line([x0, y0], [x0, y1], { color: alpha('muted', 0.7), width: 1.5 });
  for (const e of [0.01, 0.1, 1]) h.line([x0, Y(e)], [x1, Y(e)], { color: 'grid', width: 1 });
  h.text('|e|', [x0, y1 + 0.05 * H], { color: 'coral', size: 15 });
  h.text('🔁', [x1, y0 - 0.06 * H], { size: 15 });
  for (const [e, lab] of [[0.01, '0.01'], [0.1, '0.1'], [1, '1']]) h.text(lab, [x0 - 0.02 * W, Y(e)], { color: 'muted', size: 11, align: 'right' });
  const series = (errs, color) => {
    const pts = errs.map((e, k) => [X(k), Y(e)]);
    h.path(pts, { color, width: 3 });
    pts.forEach((p) => h.dot(p, 3.5, { color }));
  };
  if (s.beat === 2) series(s.errsb, 'purple');
  series(s.errs, 'coral');
}
