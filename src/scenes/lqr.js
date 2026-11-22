// LQR: balance a stick on a cart. You only say what you CARE about —
// angle 📐, position 📍, effort 💪 — and LQR computes the best gains K for you
// (u = −K x) by solving the Riccati equation on the linearized cart-pole.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rk4, cartPole, cartPoleDeriv, cartPoleLinear } from '../core/dynamics.js';
import { lqr } from '../core/control.js';
import { clamp, rng, wrapAngle } from '../core/random.js';

const H = 0.001, UMAX = 60, TRACK = 2.55, WIN = 8;
const BAD_K = [-1, -1, -15, -1.5]; // a "hand-tuned" guess: looks reasonable, isn't
const diag = (d) => d.map((v, i) => d.map((_, j) => (i === j ? v : 0)));
const KCOL = ['gold', 'gold', 'orange', 'orange'];

export default {
  eq: [
    ['ẋ = A x + B ', ['u', 'pink'], '     x = [', ['p', 'gold'], ', ', ['ṗ', 'gold'], ', ', ['θ', 'orange'], ', ', ['θ̇', 'orange'], ']'],
    ['J = ∫ ( xᵀ', ['Q', 'orange'], 'x + ', ['u', 'pink'], 'ᵀ', ['R', 'pink'], ['u', 'pink'], ' ) dt   →  min'],
    [['u', 'pink'], ' = −', ['K', 'blue'], ' x,     ', ['K', 'blue'], ' = ', ['R', 'pink'], '⁻¹Bᵀ', ['P', 'blue'], '     Aᵀ', ['P', 'blue'], ' + ', ['P', 'blue'], 'A − ', ['P', 'blue'], 'B', ['R', 'pink'], '⁻¹Bᵀ', ['P', 'blue'], ' + ', ['Q', 'orange'], ' = 0'],
    ['cheap ', ['R', 'pink'], ' → big ', ['K', 'blue'], ' (aggressive)     pricey ', ['R', 'pink'], ' → small ', ['K', 'blue'], ' (lazy)'],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[-3.0, -0.72, 3.0, 1.38], [0, 0, 10, 10]], [2.1, 1]);
    const { A: Am, B: Bm } = cartPoleLinear(cartPole);
    const s = {
      beat: 0, qx: 10, qt: 100, r: 1, K: null, dirty: true,
      st: [0, 0, 0.25, 0], bad: null, xt: 0, t: 0, nextPush: 2, hand: 0, handSide: 1,
      Jx: 0, Ju: 0, hist: [], lastS: 0, u: 0, ub: 0, badFall: 0,
    };
    const R = rng(7);
    const solve = () => { s.K = lqr(Am, Bm, diag([s.qx, 1, s.qt, 1]), [[s.r]]).K[0]; s.dirty = false; };
    solve();

    stage.handle({ pen: A, color: 'gold', r: 11, kind: 'square', get: () => [s.xt, -0.55], set: (p) => (s.xt = clamp(p[0], -2.1, 2.1)) });
    const lg = (v) => 10 ** v;
    const sl = {
      qt: ui.slider({ icon: '📐', title: 'care about angle', color: 'orange', min: 0, max: 3, step: 0.01, value: 2, onInput: (v) => { s.qt = lg(v); s.dirty = true; } }),
      qx: ui.slider({ icon: '📍', title: 'care about position', color: 'gold', min: -1, max: 2, step: 0.01, value: 1, onInput: (v) => { s.qx = lg(v); s.dirty = true; } }),
      r: ui.slider({ icon: '💪', title: 'effort is expensive', color: 'pink', min: -2, max: 1.3, step: 0.01, value: 0, onInput: (v) => { s.r = lg(v); s.dirty = true; } }),
    };
    const push = () => { s.handSide = R() < 0.5 ? -1 : 1; s.st[3] += 1.3 * s.handSide; if (s.bad) s.bad[3] += 1.3 * s.handSide; s.hand = 0.45; };
    ui.button({ icon: '👋', title: 'push', onClick: push });
    ui.beats(['🤸', '👋', '⚖️', '📉'], (i) => {
      s.beat = i; s.t = 0; s.nextPush = i === 0 ? Infinity : 1.5; s.Jx = 0; s.Ju = 0; s.hist = []; s.lastS = -1;
      s.st = [0, 0, i === 0 ? 0.3 : 0.05, 0]; s.xt = 0;
      s.bad = i === 3 ? s.st.slice() : null; s.badFall = 0;
      sl.qt.set(2); sl.qx.set(1); sl.r.set(i === 2 ? -1.5 : 0);
      s.qt = 100; s.qx = 10; s.r = i === 2 ? lg(-1.5) : 1; s.dirty = true;
    });
    ui.readout(() => fmt(s.Jx + s.Ju, 1), { icon: '🧾', color: 'coral', title: 'cost so far' });

    const ctrl = (K, xt) => (t, x) => clamp(-(K[0] * (x[0] - xt) + K[1] * x[1] + K[2] * wrapAngle(x[2]) + K[3] * x[3]), -UMAX, UMAX);
    const wall = (x) => { if (Math.abs(x[0]) > TRACK) { x[0] = Math.sign(x[0]) * TRACK; x[1] = 0; } return x; };

    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        if (s.dirty) solve();
        const n = Math.min(120, Math.round(dt / H));
        const law = ctrl(s.K, s.xt), lawBad = ctrl(BAD_K, s.xt);
        const f = cartPoleDeriv(cartPole, law), fb = cartPoleDeriv(cartPole, lawBad);
        for (let k = 0; k < n; k++) {
          const u = law(0, s.st);
          s.st = wall(rk4(f, 0, s.st, H));
          const e = [s.st[0] - s.xt, s.st[1], wrapAngle(s.st[2]), s.st[3]];
          s.Jx += (s.qx * e[0] ** 2 + e[1] ** 2 + s.qt * e[2] ** 2 + e[3] ** 2) * H;
          s.Ju += s.r * u * u * H;
          s.u = u;
          if (s.bad) {
            if (s.badFall > 0) {
              // fallen: let it dangle until it is reset
              s.bad[2] = Math.sign(wrapAngle(s.bad[2])) * 1.45; s.bad[3] = 0; s.bad[1] *= 0.995; s.bad[0] += s.bad[1] * H; s.bad = wall(s.bad); s.ub = 0;
            } else { s.ub = lawBad(0, s.bad); s.bad = wall(rk4(fb, 0, s.bad, H)); }
          }
        }
        s.t += dt;
        if (s.bad) {
          if (!s.badFall && Math.abs(wrapAngle(s.bad[2])) > 1.2) s.badFall = 3;
          if (s.badFall) { s.badFall -= dt; if (s.badFall <= 0) { s.badFall = 0; s.bad = s.st.slice(); } }
        }
        if (s.t > s.nextPush) { push(); s.nextPush = s.t + 3; }
        s.hand = Math.max(0, s.hand - dt);
        if (s.t - s.lastS > 1 / 30 || s.t < s.lastS) {
          s.lastS = s.t;
          s.hist.push([s.t, wrapAngle(s.st[2]), s.st[0] - s.xt, s.u, s.bad ? wrapAngle(s.bad[2]) : null]);
          while (s.hist.length && s.hist[0][0] < s.t - WIN) s.hist.shift();
        }
      },
      draw() {
        const [vx0, vy0, vx1] = A.view;
        // track
        A.rect(vx0, -0.72, vx1 - vx0, 0.5, { fill: alpha('slate', 0.16), stroke: false });
        void vy0;
        A.line([-TRACK - 0.3, -0.22], [TRACK + 0.3, -0.22], { color: 'slate', width: 3 });
        for (const sx of [-1, 1]) A.rect(sx * (TRACK + 0.3) - (sx > 0 ? 0 : 0.12), -0.22, 0.12, 0.6, { fill: 'slate', stroke: false });
        // target flag
        A.line([s.xt, -0.22], [s.xt, 1.35], { color: alpha('gold', 0.5), width: 2, dash: [6, 5] });
        if (s.bad) drawCart(A, s.bad, s.ub, { ghost: true, fallen: s.badFall > 0 });
        drawCart(A, s.st, s.u, {});
        if (s.hand > 0) {
          const bob = [s.st[0] + cartPole.l * Math.sin(s.st[2]), cartPole.l * Math.cos(s.st[2]) + 0.12];
          A.emoji(s.handSide > 0 ? '🫲' : '🫱', [bob[0] - s.handSide * (0.25 + s.hand * 0.4), bob[1]], 30);
        }
        // K: computed gains as colored numbers (and the bad guess)
        drawK(stage.hud, A.area, [s.K], ['blue']);
        if (s.bad) drawK(stage.hud, A.area, [s.K, BAD_K], ['blue', 'coral']);
        // cost so far: state part (orange) + effort part (pink)
        const cx = A.area.x + 14, cy = A.area.y + 14, W = 160;
        const tot = s.Jx + s.Ju, sc = W / Math.max(40, tot * 1.15);
        const ctx = stage.hud.ctx;
        ctx.save();
        ctx.font = '18px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textBaseline = 'middle';
        ctx.fillText('🧾', cx, cy + 9);
        ctx.fillStyle = alpha('faint', 0.5); ctx.beginPath(); ctx.roundRect(cx + 28, cy + 2, W, 14, 7); ctx.fill();
        ctx.fillStyle = C.orange; ctx.beginPath(); ctx.roundRect(cx + 28, cy + 2, Math.max(2, s.Jx * sc), 14, [7, 0, 0, 7]); ctx.fill();
        ctx.fillStyle = C.pink; ctx.beginPath(); ctx.roundRect(cx + 28 + s.Jx * sc, cy + 2, Math.max(0, s.Ju * sc), 14, [0, 7, 7, 0]); ctx.fill();
        ctx.restore();

        // ---------- right: θ(t), p(t), u(t) ----------
        const t0 = s.hist.length ? s.hist[0][0] : 0;
        const X = (t) => 0.4 + ((t - t0) / WIN) * 9.2;
        const lane = (y0, h, k, idx, color) => {
          B.line([0.4, y0], [9.6, y0], { color: alpha('muted', 0.35), width: 1 });
          B.path(s.hist.filter((r) => r[idx] !== null).map((r) => [X(r[0]), y0 + clamp(r[idx] * k, -h, h)]), { color, width: 2.5 });
        };
        if (s.bad) lane(8.2, 1.5, 2.2, 4, alpha('coral', 0.8));
        lane(8.2, 1.5, 2.2, 1, 'orange');
        lane(5, 1.4, 0.9, 2, 'gold');
        lane(1.8, 1.5, 0.05, 3, 'pink');
        B.text('θ', [0.3, 9.6], { size: 16, color: 'orange', align: 'left' });
        B.text('p', [0.3, 6.4], { size: 16, color: 'gold', align: 'left' });
        B.text('u', [0.3, 3.3], { size: 16, color: 'pink', align: 'left' });
      },
    };
  },
};

function drawCart(g, st, u, { ghost = false, fallen = false }) {
  const [x, , th] = st, l = cartPole.l;
  const a = ghost ? 0.55 : 1;
  const body = ghost ? 'coral' : 'slate';
  const top = [x, 0.08], bob = [x + l * Math.sin(th), 0.08 + l * Math.cos(th)];
  // force on the cart
  if (Math.abs(u) > 0.3) g.vec([x + Math.sign(u) * 0.32, -0.02], [clamp(u * 0.04, -1.2, 1.2), 0], { color: ghost ? alpha('coral', 0.7) : 'pink', width: 5 });
  g.rrect(x - 0.3, -0.12, 0.6, 0.26, 7, { fill: alpha(body, ghost ? 0.4 : 0.95) });
  for (const sx of [-0.18, 0.18]) g.circle([x + sx, -0.15], 0.06, { fill: alpha('ink', 0.8 * a), color: alpha('ink', 0.8 * a) });
  // angle wedge from vertical
  if (!ghost && Math.abs(th) > 0.02) g.wedge(top, 0.35, Math.PI / 2, Math.PI / 2 - th, { color: 'orange', alpha: 0.3 });
  g.line(top, [x, top[1] + 0.45], { color: alpha('muted', 0.35 * a), width: 1.5, dash: [3, 4] });
  g.line(top, bob, { color: ghost ? alpha('coral', 0.6) : 'blue', width: ghost ? 7 : 9 });
  g.dot(top, 7, { color: alpha('orange', a) });
  g.circle(bob, 0.1, { fill: alpha(ghost ? 'coral' : 'pink', ghost ? 0.5 : 1), color: alpha(ghost ? 'coral' : 'pink', a) });
  if (fallen) g.emoji('💥', [bob[0], bob[1] + 0.25], 30);
}

function drawK(hud, area, rows, colors) {
  const ctx = hud.ctx, cw = 58, ch = 26;
  const X = area.x + area.w - cw * 4 - 36, Y = area.y + 12;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(X, Y, cw * 4 + 26, ch * rows.length + 12, 10); ctx.fill();
  ctx.font = '700 15px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  rows.forEach((K, r) => {
    ctx.fillStyle = C[colors[r]];
    ctx.fillText('K', X + 12, Y + 6 + ch * (r + 0.5));
    K.forEach((k, j) => { ctx.fillStyle = C[r === 0 ? KCOL[j] : colors[r]]; ctx.fillText(fmt(k, 1), X + 26 + cw * (j + 0.5), Y + 6 + ch * (r + 0.5)); });
  });
  ctx.restore();
}
