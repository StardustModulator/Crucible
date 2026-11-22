// Every rigid motion is a SCREW: turn about one line while sliding along it.
// The twist (ω, v) says how fast you turn and slide; exp() means "keep doing
// that tiny motion over and over" — and it carries a box along a helix.
// Blending the matrices directly instead squishes the box.
import { View3D } from '../viz/view3d.js';
import { C, alpha } from '../viz/palette.js';
import { mmul, eye, madd, mscale, vnorm, vscale, vdot, cross, fnorm, msub } from '../core/linalg.js';
import { expSE3, logSE3, screwAxis, homog, invSE3, rotZ, rotX, applySE3, rotOf, transOf } from '../core/lie.js';
import { smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const HALF = [0.32, 0.22, 0.14];
// 4×4 "hat" of a twist: [[ω]  v; 0 0]
const twistHat = (V) => [[0, -V[2], V[1], V[3]], [V[2], 0, -V[0], V[4]], [-V[1], V[0], 0, V[5]], [0, 0, 0, 0]];
const lerpT = (A, B, t) => A.map((r, i) => r.map((x, j) => x + (B[i][j] - x) * t));

export default {
  eq: [
    [['ξ', 'ink'], ' = (', ['ω', 'orange'], ', ', ['v', 'teal'], ')      ', ['v', 'teal'], ' = −', ['ω', 'orange'], ' × q + h', ['ω', 'orange'], '      (turn about a line through q, slide h per turn)'],
    ['T(t) = exp([', ['ξ', 'ink'], '] t) T₀ = lim (I + [', ['ξ', 'ink'], '] t / n)ⁿ   — ', ['helix', 'lime']],
    [['ξ', 'ink'], ' = log(T₁ T₀⁻¹)      ', ['(1−t)T₀ + tT₁', 'coral'], ' is NOT a rigid move (it squishes)'],
    [['ω', 'orange'], ' = 0 ⇒ pure slide (straight line)      h = 0 ⇒ pure turn (circle)'],
  ],
  setup({ stage, ui }) {
    const v = new View3D(stage.g, { yaw: -0.55, pitch: 0.36, dist: 6.0, target: [0.6, -0.2, 0.75] });
    const s = { beat: 0, t: 0, h: 0.18, n: 4, autoN: true, tgt: [2.3, 0.6, 1.1, -1.9], kind: 2 };
    const TA = homog(eye(3), [1.7, 0, 0.35]);
    const Q0 = [0.5, 0, 0];

    const groups = [ui.group(), ui.group(), ui.group(), ui.group()];
    // controls not used in this beat are taken out of the dock (not just hidden)
    const showBeat = (b) => { groups.forEach((el) => el.remove()); ui.dock.appendChild(groups[b]); };
    ui.slider({ icon: '🔩', color: 'teal', min: -0.45, max: 0.45, step: 0.01, value: s.h, title: 'pitch h (slide per turn)', into: groups[0], onInput: (x) => (s.h = x) });
    ui.readout(() => fmt(s.h, 2), { icon: 'h', color: 'teal', title: 'pitch', into: groups[0] });
    const nSl = ui.slider({ icon: '👣', color: 'coral', min: 1, max: 40, step: 1, value: s.n, title: 'number of tiny steps n', into: groups[1], onInput: (x) => { s.n = x; s.autoN = false; } });
    ui.button({ icon: '🎬', title: 'more and more steps', into: groups[1], onClick: () => { s.autoN = true; s.t = 0; } });
    ui.readout(() => `n=${s.n}`, { icon: '👣', color: 'coral', title: 'steps', into: groups[1] });
    ui.readout(() => fmt(s.err ?? 0, 3), { icon: '📏', color: 'coral', title: 'miss distance from exp', into: groups[1] });
    const tg = (i, icon, color, min, max, title) => ui.slider({ icon, color, min, max, step: 0.01, value: s.tgt[i], title, into: groups[2], onInput: (x) => (s.tgt[i] = x) });
    tg(0, '🔵', 'blue', -Math.PI, Math.PI, 'target turn about z');
    tg(1, '🔴', 'red', -1.5, 1.5, 'target tilt about x');
    tg(2, '↕️', 'blue', -0.3, 1.6, 'target lift');
    tg(3, '↔️', 'green', -2.2, 1.5, 'target slide');
    ui.choice({ into: groups[3], value: 2, color: 'orange', options: [{ icon: '➡️', value: 0, title: 'slide only' }, { icon: '🔄', value: 1, title: 'turn only' }, { icon: '🔩', value: 2, title: 'turn + slide' }], onChange: (x) => { s.kind = x; s.t = 0; } });
    ui.beats(['🔩', '⏱️', '🎯', '↔️'], (b) => { s.beat = b; s.t = 0; showBeat(b); });
    showBeat(0);

    // ------------------------------------------------------------ helpers
    function nutBox(T, o = {}) {
      const R = rotOf(T), p = transOf(T);
      v.box(R, p, HALF, { color: o.color ?? 'slate', alpha: o.alpha ?? 1 });
      if (o.frame !== false) v.frameT(T, 0.55, { width: 3, alpha: o.alpha ?? 1 });
    }
    function axisOf(V) {
      const w = V.slice(0, 3), th = vnorm(w);
      if (th < 1e-6) return null;
      const wn = vscale(w, 1 / th), vn = vscale(V.slice(3), 1 / th);
      return { w: wn, q: cross(wn, vn), h: vdot(wn, vn), th };
    }
    function drawAxis(ax, len = 2.6) {
      if (!ax) return;
      const a = ax.q.map((x, i) => x - ax.w[i] * len), b = ax.q.map((x, i) => x + ax.w[i] * len);
      v.line(a, b, { color: alpha('orange', 0.35), width: 7 });
      v.line(a, b, { color: 'orange', width: 2, dash: [6, 5] });
    }
    function twistArrows(V, lift = 0) {
      const ax = axisOf(V);
      if (ax) { const b = ax.q.map((x, i) => x + ax.w[i] * lift); v.arrow(b, b.map((x, i) => x + ax.w[i] * 1.0), { color: 'orange', width: 5 }); v.point(ax.q, 5, { color: 'orange' }); }
      const vv = V.slice(3), L = vnorm(vv), k = ax ? 1 / ax.th : 1;
      if (L * k > 1e-3) v.arrow([0, 0, 0], vscale(vv, k * Math.min(1, 1.4 / (L * k))), { color: 'teal', width: 4 });
    }
    function pathOf(V, T0, upto = 1, n = 80) {
      const pts = []; for (let k = 0; k <= n; k++) pts.push(applySE3(expSE3(vscale(V, (upto * k) / n)), transOf(T0)));
      return pts;
    }
    // six bars: ω (orange) and v (teal)
    function twistBars(V) {
      const ctx = stage.hud.ctx, X = 14, Y = 14, H = 30, bw = 13, gap = 4;
      ctx.save();
      ctx.fillStyle = alpha('panel', 0.92); ctx.beginPath(); ctx.roundRect(X, Y, 6 * (bw + gap) + 20, 2 * H + 30, 10); ctx.fill();
      const mid = Y + 22 + H;
      ctx.strokeStyle = alpha('muted', 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X + 6, mid); ctx.lineTo(X + 6 * (bw + gap) + 14, mid); ctx.stroke();
      const mx = Math.max(1, ...V.map(Math.abs));
      V.forEach((x, i) => {
        const h = (x / mx) * H, bx = X + 10 + i * (bw + gap) + (i >= 3 ? 4 : 0);
        ctx.fillStyle = C[i < 3 ? 'orange' : 'teal']; ctx.beginPath(); ctx.roundRect(bx, Math.min(mid, mid - h), bw, Math.max(Math.abs(h), 1.5), 3); ctx.fill();
      });
      ctx.font = '800 15px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = C.orange; ctx.fillText('ω', X + 10 + 1.5 * (bw + gap), Y + 11);
      ctx.fillStyle = C.teal; ctx.fillText('v', X + 14 + 4.5 * (bw + gap), Y + 11);
      ctx.restore();
    }

    // ------------------------------------------------------------ beats
    function beatScrew() {
      const S = screwAxis([0, 0, 1], Q0, s.h), turns = 1.25, th = 2 * Math.PI * turns;
      const T = s.t % 7, k = smoothstep((T - 0.5) / 5);
      // the bolt: a rod along the axis with a thread of pitch h
      v.cylinder([Q0[0], Q0[1], -0.2], [Q0[0], Q0[1], 2.6], 0.16, { color: 'slate', sides: 10 });
      const thread = []; for (let q = 0; q <= 160; q++) { const a = (q / 160) * 6 * Math.PI; thread.push([Q0[0] + 0.19 * Math.cos(a), Q0[1] + 0.19 * Math.sin(a), 1.2 + s.h * (a - 3 * Math.PI)]); }
      v.path(thread.filter((p) => p[2] > -0.2 && p[2] < 2.6), { color: alpha('ink', 0.5), width: 1.5 });
      const path = pathOf(vscale(S, th), TA);
      v.path(path, { color: alpha('lime', 0.9), width: 3 });
      const Tk = mmul(expSE3(vscale(S, th * k)), TA);
      nutBox(TA, { alpha: 0.25, frame: false });
      // the wrench arm from the axis to the box
      const c = transOf(Tk);
      v.line([Q0[0], Q0[1], c[2]], c, { color: 'orange', width: 5 });
      nutBox(Tk);
      twistArrows(S, 2.65);
      return () => twistBars(S);
    }

    function beatSteps() {
      const S = screwAxis([0, 0, 1], Q0, 0.2), th = 1.5 * Math.PI, X = vscale(S, th);
      if (s.autoN) { const n = Math.min(40, 1 + Math.floor(Math.pow(s.t / 0.35, 1.35))); if (n !== s.n) { s.n = n; nSl.set(n); } if (s.t > 14) s.t = 0; }
      const n = s.n, M = madd(eye(4), mscale(twistHat(X), 1 / n));
      v.line([Q0[0], Q0[1], -0.2], [Q0[0], Q0[1], 2.4], { color: alpha('orange', 0.6), width: 3, dash: [6, 5] });
      const exact = mmul(expSE3(X), TA);
      v.path(pathOf(X, TA), { color: alpha('lime', 0.9), width: 3 });
      nutBox(exact, { color: 'gold', alpha: 0.45, frame: false });
      // n tiny steps of "do ξ for a moment"
      let P = eye(4);
      const pts = [transOf(TA)];
      const every = Math.max(1, Math.round(n / 6));
      for (let k = 1; k <= n; k++) {
        P = mmul(M, P);
        const Tk = mmul(P, TA);
        pts.push(transOf(Tk));
        if (k % every === 0 && k < n) nutBox(Tk, { color: 'coral', alpha: 0.25, frame: false });
      }
      const Tn = mmul(P, TA);
      v.path(pts, { color: 'coral', width: 3 });
      pts.forEach((p) => v.point(p, 3.5, { color: 'coral' }));
      nutBox(Tn, { color: 'coral' });
      s.err = fnorm(msub(Tn, exact));
      twistArrows(S, 2.45);
      return () => twistBars(S);
    }

    function targetPose() {
      const [yaw, tilt, lift, slide] = s.tgt;
      return homog(mmul(rotZ(yaw), rotX(tilt)), [TA[0][3] - 0.6, TA[1][3] + slide, TA[2][3] + lift]);
    }
    function beatTarget() {
      const TB = targetPose();
      const V = logSE3(mmul(TB, invSE3(TA)));
      const ax = axisOf(V);
      drawAxis(ax);
      v.path(pathOf(V, TA), { color: 'lime', width: 4 });
      const naive = []; for (let k = 0; k <= 40; k++) naive.push(transOf(lerpT(TA, TB, k / 40)));
      v.path(naive, { color: alpha('coral', 0.9), width: 3, dash: [6, 5] });
      nutBox(TA, { alpha: 0.3, frame: false });
      nutBox(TB, { color: 'gold', alpha: 0.5, frame: false });
      const T = s.t % 6, k = smoothstep((T - 0.6) / 4);
      nutBox(lerpT(TA, TB, k), { color: 'coral', alpha: 0.6, frame: false });
      nutBox(mmul(expSE3(vscale(V, k)), TA));
      twistArrows(V);
      return () => twistBars(V);
    }

    function beatSpecial() {
      let V;
      if (s.kind === 0) V = [0, 0, 0, -0.6, 1.4, 0.8];
      else if (s.kind === 1) V = vscale(screwAxis([0, 0, 1], Q0, 0), 1.6 * Math.PI);
      else V = vscale(screwAxis([0, 0, 1], Q0, 0.25), 1.6 * Math.PI);
      drawAxis(axisOf(V));
      v.path(pathOf(V, TA), { color: 'lime', width: 4 });
      const T = s.t % 6, k = smoothstep((T - 0.5) / 4);
      nutBox(TA, { alpha: 0.25, frame: false });
      nutBox(mmul(expSE3(V), TA), { color: 'gold', alpha: 0.45, frame: false });
      nutBox(mmul(expSE3(vscale(V, k)), TA));
      twistArrows(V);
      if (s.kind === 0) v.text('∞', [TA[0][3] - 1.2, TA[1][3] - 0.6, 1.8], { size: 26, color: 'orange' });
      return () => twistBars(V);
    }

    return {
      update(dt) { s.t += dt; v.tick(dt); },
      draw() {
        v.begin();
        v.floor(2.5, 0.5);
        v.frame(eye(3), [0, 0, 0], 0.8, { alpha: 0.3, width: 2 });
        const hud = [beatScrew, beatSteps, beatTarget, beatSpecial][s.beat]();
        v.flush();
        hud?.();
      },
    };
  },
};
