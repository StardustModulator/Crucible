// Newton–Euler: how a robot works out the torque each motor needs.
// ➡️ Motion flows OUT from the base (each link adds its joint's spin),
// ⬅️ forces flow BACK from the tip (each link carries everything beyond it),
// 🏋️ and the joint torques it finds are exactly τ = M q̈ + C q̇ + g.
import { alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { twoLink, twoLinkTau } from '../core/dynamics.js';
import { planarFK, planarIKStep } from '../core/kinematics.js';
import { clamp } from '../core/random.js';

const GV = [0, -9.81];
const perp = (r) => [-r[1], r[0]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const sc = (a, k) => [a[0] * k, a[1] * k];

function chain(n) {
  if (n === 2) return { l: [1, 1], m: [1, 1], lc: [0.5, 0.5], I: [1 / 12, 1 / 12] };
  const l = n === 3 ? 0.78 : 0.6, m = n === 3 ? 0.8 : 0.6;
  return { l: Array(n).fill(l), m: Array(n).fill(m), lc: Array(n).fill(l / 2), I: Array(n).fill((m * l * l) / 12) };
}

// Recursive Newton–Euler for a planar chain + a point payload at the tip.
function rnea(P, q, qd, qdd, mp, g = GV) {
  const n = q.length;
  const { points } = planarFK(P.l, q);
  const L = [];
  let th = 0, w = 0, al = 0, v = [0, 0], a = [0, 0];
  for (let i = 0; i < n; i++) {
    th += q[i]; w += qd[i]; al += qdd[i];
    const u = [Math.cos(th), Math.sin(th)];
    const r = sc(u, P.l[i]), rc = sc(u, P.lc[i]);
    const vc = add(v, sc(perp(rc), w));
    const ac = add(add(a, sc(perp(rc), al)), sc(rc, -w * w));
    const vN = add(v, sc(perp(r), w));
    const aN = add(add(a, sc(perp(r), al)), sc(r, -w * w));
    L.push({ p: points[i], pe: points[i + 1], c: add(points[i], rc), w, al, vc, ac, r, rc });
    v = vN; a = aN;
  }
  const tip = { p: points[n], v, a };
  // backward
  let f = sc(sub(a, g), mp), nn = 0;
  const fTip = f;
  for (let i = n - 1; i >= 0; i--) {
    const Li = L[i];
    const inert = sc(sub(Li.ac, g), P.m[i]);           // m(a − g)
    const fi = add(f, inert);
    const ni = nn + P.I[i] * Li.al + cross(Li.r, f) + cross(Li.rc, inert);
    Li.fChild = f; Li.f = fi; Li.n = ni; Li.inert = inert;
    f = fi; nn = ni;
  }
  return { L, tip, fTip, tau: L.map((x) => x.n) };
}

// Independent check: τ = Σ J_cᵀ m (a_c − g) + Σ J_ωᵀ I α  (= M q̈ + C q̇ + g),
// with COM accelerations from finite differences of the forward kinematics.
function lagrangeTau(P, q, qd, qdd, mp) {
  const n = q.length, h = 1e-3;
  if (n === 2) {
    // fold the payload into link 2 (parallel-axis) and use the closed-form arm dynamics
    const m2 = P.m[1] + mp, lc2 = (P.m[1] * P.lc[1] + mp * P.l[1]) / m2;
    const I2 = P.I[1] + P.m[1] * (P.lc[1] - lc2) ** 2 + mp * (P.l[1] - lc2) ** 2;
    return twoLinkTau({ ...twoLink, m2, lc2, I2 }, q, qd, qdd);
  }
  const coms = (qq) => {
    const { points } = planarFK(P.l, qq); let th = 0;
    const cs = qq.map((_, i) => { th += qq[i]; return add(points[i], sc([Math.cos(th), Math.sin(th)], P.lc[i])); });
    cs.push(points[n]);
    return cs;
  };
  const qp = q.map((x, i) => x + qd[i] * h + 0.5 * qdd[i] * h * h), qm = q.map((x, i) => x - qd[i] * h + 0.5 * qdd[i] * h * h);
  const c0 = coms(q), cp = coms(qp), cm = coms(qm);
  const acc = c0.map((c, k) => sc(add(sub(cp[k], sc(c, 2)), cm[k]), 1 / (h * h)));
  const { points } = planarFK(P.l, q);
  const tau = new Array(n).fill(0);
  let al = 0;
  for (let i = 0; i <= n; i++) {
    const m = i < n ? P.m[i] : mp;
    const F = sc(sub(acc[i], GV), m);
    for (let j = 0; j <= Math.min(i, n - 1); j++) tau[j] += cross(sub(c0[i], points[j]), F);
    if (i < n) { al += qdd[i]; for (let j = 0; j <= i; j++) tau[j] += P.I[i] * al; }
  }
  return tau;
}

export default {
  eq: [
    ['➡️  ', ['ωᵢ', 'blue'], ' = ', ['ωᵢ₋₁', 'blue'], ' + ', ['q̇ᵢ', 'orange'], '     ', ['aᵢ₊₁', 'purple'], ' = ', ['aᵢ', 'purple'], ' + αᵢ × rᵢ − ', ['ωᵢ', 'blue'], '² rᵢ'],
    ['⬅️  ', ['fᵢ', 'coral'], ' = ', ['fᵢ₊₁', 'coral'], ' + mᵢ(', ['a_cᵢ', 'purple'], ' − ', ['g', 'green'], ')'],
    ['     ', ['τᵢ', 'orange'], ' = ', ['τᵢ₊₁', 'orange'], ' + Iᵢαᵢ + r_cᵢ × mᵢ(', ['a_cᵢ', 'purple'], ' − ', ['g', 'green'], ') + rᵢ × ', ['fᵢ₊₁', 'coral']],
    ['✔  ', ['τ', 'orange'], ' = ', ['M(q) q̈ + C(q,q̇) q̇', 'purple'], ' + ', ['g(q)', 'green'], '   ', ['(same numbers)', 'lime']],
    ['cost: O(n) instead of O(n³)'],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[-0.4, -0.95, 2.6, 1.95], [0, 0, 10, 10]], [1.3, 1]);
    const s = {
      beat: 0, n: 3, mp: 1, t: 0, sweep: 0, auto: true, speed: 1,
      q: [], qd: [], qdd: [], qref: [], target: null,
    };
    let P = chain(3);
    const home = (n) => (n === 2 ? [0.35, -0.75] : n === 3 ? [0.45, -0.45, -0.45] : [0.5, -0.35, -0.35, -0.35]);
    const setN = (n) => {
      s.n = n; P = chain(n);
      s.q = home(n); s.qref = home(n).slice(); s.qd = Array(n).fill(0); s.qdd = Array(n).fill(0);
    };
    setN(3);

    stage.handle({
      pen: A, color: 'pink', r: 12,
      get: () => planarFK(P.l, s.q).tip,
      set: (pt) => { s.auto = false; autoT.set(false, false); s.target = pt; },
      onEnd: () => {},
    });
    const autoT = ui.toggle({ icon: '🌊', title: 'wave', value: true, color: 'blue', onChange: (v) => { s.auto = v; s.target = null; } });
    ui.choice({ value: 3, color: 'orange', options: [{ icon: '2️⃣', value: 2, title: 'two links' }, { icon: '3️⃣', value: 3, title: 'three links' }, { icon: '4️⃣', value: 4, title: 'four links' }], onChange: setN });
    ui.slider({ icon: '🏋️', title: 'payload', color: 'slate', min: 0, max: 2.5, step: 0.05, value: 1, onInput: (v) => (s.mp = v) });
    ui.slider({ icon: '🐇', title: 'speed', color: 'blue', min: 0, max: 2.2, step: 0.01, value: 1, onInput: (v) => (s.speed = v) });
    ui.beats(['➡️', '⬅️', '🏋️', '🧩'], (i) => { s.beat = i; s.sweep = 0; });
    ui.readout(() => {
      const R = rnea(P, s.q, s.qd, s.qdd, s.mp), Q = lagrangeTau(P, s.q, s.qd, s.qdd, s.mp);
      return fmt(Math.max(...R.tau.map((x, i) => Math.abs(x - Q[i]))), 3);
    }, { icon: '✔', color: 'lime', title: 'difference from M q̈ + C q̇ + g' });

    const H = 0.002;
    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        s.t += dt * s.speed;
        s.sweep += dt;
        const n = s.n;
        if (s.auto) {
          const h = home(n);
          s.qref = h.map((x, i) => x + 0.4 * Math.sin(2.1 * s.t + i * 1.1) * (i === 0 ? 0.6 : 1));
        } else if (s.target) {
          for (let k = 0; k < 4; k++) s.qref = planarIKStep(P.l, s.qref, s.target, { lambda: 0.15, gain: 0.5 }).q;
        }
        // joints follow their reference through a smooth 2nd-order filter → exact q, q̇, q̈
        const wf = 7 * Math.max(0.35, s.speed);
        const steps = Math.min(60, Math.round(dt / H));
        for (let k = 0; k < steps; k++) {
          for (let i = 0; i < n; i++) {
            const qdd = wf * wf * (s.qref[i] - s.q[i]) - 2 * wf * s.qd[i];
            s.qdd[i] = qdd; s.qd[i] += qdd * H; s.q[i] += s.qd[i] * H;
          }
        }
      },
      draw() {
        const R = rnea(P, s.q, s.qd, s.qdd, s.mp);
        const Rg = rnea(P, s.q, s.q.map(() => 0), s.q.map(() => 0), s.mp);
        const check = lagrangeTau(P, s.q, s.qd, s.qdd, s.mp);
        const n = s.n, pts = R.L.map((x) => x.p).concat([R.tip.p]);
        const per = 0.6, hold = 1.0, cycle = n * per + hold;
        const ph = s.sweep % cycle, front = ph / per;  // how far the wave has travelled (links)

        A.grid({ step: 0.5 });
        // glow on the links the wave has reached
        const lit = (i) => (s.beat === 0 ? i < front : s.beat === 1 ? n - 1 - i < front : false);
        const curB = n - 1 - Math.floor(front);
        for (let i = 0; i < n; i++) if (lit(i)) A.line(pts[i], pts[i + 1], { color: alpha('gold', s.beat === 1 && i !== curB ? 0.2 : 0.5), width: 30 });
        A.arm(pts, { width: 14 });
        // payload: a kettlebell hanging from the hand
        const tip = R.tip.p, rw = 0.09 + 0.07 * Math.sqrt(s.mp);
        if (s.mp > 0.01) {
          const wc = [tip[0], tip[1] - 0.22 - rw];
          A.line(tip, [wc[0], wc[1] + rw], { color: 'slate', width: 3 });
          A.circle(wc, rw, { fill: 'slate', color: 'slate' });
          A.text(fmt(s.mp, 1), wc, { size: 11, color: 'white', halo: false });
        }

        if (s.beat === 0) {
          // forward pass: velocities (blue) and accelerations (purple) appear link by link
          if (front < n) {
            const i = Math.floor(front), f = front - i;
            A.blob(add(pts[i], sc(sub(pts[i + 1], pts[i]), f)), 0.12, { color: 'gold', alpha: 0.9 });
          }
          R.L.forEach((Li, i) => {
            if (!lit(i)) return;
            A.vec(Li.c, sc(Li.vc, 0.5), { color: 'blue', width: 3.5 });
            A.vec(Li.c, sc(Li.ac, 0.22), { color: 'purple', width: 3.5 });
            spinArc(A, Li.c, 0.17, Li.w * 0.5, 'blue');
          });
          if (front >= n) {
            A.vec(tip, sc(R.tip.v, 0.5), { color: 'blue', width: 3.5 });
            A.vec(tip, sc(R.tip.a, 0.22), { color: 'purple', width: 3.5 });
          }
        } else if (s.beat === 1) {
          // backward pass: free-body diagram of the link being visited
          const k = Math.floor(front), cur = n - 1 - k;
          if (s.mp > 0.01) A.vec([tip[0] + 0.25, tip[1]], sc(GV, 0.04 * s.mp), { color: 'green', width: 3 });
          R.L.forEach((Li, i) => {
            if (!lit(i)) return;
            const on = i === cur;
            const a = on ? 1 : 0.35;
            A.vec(Li.c, sc(GV, 0.04 * P.m[i]), { color: alpha('green', a), width: on ? 3.5 : 2 });
            if (on) {
              A.vec(Li.pe, sc(Li.fChild, -0.04), { color: 'coral', width: 3.5 });      // child pulls on me
              A.vec(Li.c, sc(Li.inert, 0.04), { color: alpha('purple', 0.8), width: 2, dash: [5, 4] });
            }
            A.vec(Li.p, sc(Li.f, 0.04), { color: alpha('coral', on ? 1 : 0.45), width: on ? 4 : 2.5 }); // parent holds me
            spinArc(A, Li.p, 0.26, clamp(Li.n * 0.08, -2.8, 2.8), on ? 'orange' : alpha('orange', 0.45), 4);
          });
        } else {
          R.L.forEach((Li) => spinArc(A, Li.p, 0.26, clamp(Li.n * 0.08, -2.8, 2.8), 'orange', 4));
          if (s.mp > 0.01) A.vec([tip[0] + 0.25, tip[1]], sc(GV, 0.04 * s.mp), { color: 'green', width: 3 });
        }

        // ---------------- right panel ----------------
        const cols = n, gap = 9 / cols;
        const xOf = (i) => 0.8 + i * gap + gap * 0.18, W = gap * 0.5;
        if (s.beat === 0) {
          // ω_i = q̇₁ + … + q̇ᵢ : each link adds its own joint's spin
          const y0 = 5;
          B.line([0.5, y0], [9.6, y0], { color: alpha('muted', 0.5), width: 1 });
          for (let i = 0; i < n; i++) {
            if (!lit(i)) continue;
            let base = y0;
            for (let j = 0; j <= i; j++) {
              const h = clamp(s.qd[j] * 2.6, -4.4, 4.4);
              B.bar(xOf(i), base, W, h, { color: j === i ? 'blue' : alpha('blue', 0.4 + 0.15 * j), r: 2 });
              base += h;
            }
            B.line([xOf(i) - 0.1, base], [xOf(i) + W + 0.1, base], { color: 'ink', width: 2 });
            B.dot([xOf(i) + W / 2, 0.7], 9, { color: 'orange' });
            B.text(String(i + 1), [xOf(i) + W / 2, 0.7], { size: 12, color: 'bg', halo: false });
          }
          B.text('ω', [0.4, 9.4], { size: 22, color: 'blue' });
        } else {
          // joint torques: orange bars (Newton–Euler) vs lime ticks (M q̈ + C q̇ + g)
          const y0 = 5, k = 0.11;
          B.line([0.5, y0], [9.6, y0], { color: alpha('muted', 0.5), width: 1 });
          for (let i = 0; i < n; i++) {
            const show = s.beat !== 1 || lit(i);
            if (show) {
              if (s.beat === 3) {
                const hg = clamp(Rg.tau[i] * k, -4.3, 4.3), hm = clamp((R.tau[i] - Rg.tau[i]) * k, -4.3, 4.3);
                // waterfall: gravity part, then the motion part on top of it
                B.bar(xOf(i), y0, W * 0.5, hg, { color: 'green', r: 2 });
                B.line([xOf(i), y0 + hg], [xOf(i) + W, y0 + hg], { color: alpha('green', 0.6), width: 1.5, dash: [3, 3] });
                B.bar(xOf(i) + W * 0.5, y0 + hg, W * 0.5, hm, { color: 'purple', r: 2 });
              } else B.bar(xOf(i), y0, W, clamp(R.tau[i] * k, -4.3, 4.3), { color: 'orange' });
              if (s.beat >= 2) {
                const yc = y0 + clamp(check[i] * k, -4.3, 4.3);
                B.line([xOf(i) - 0.2, yc], [xOf(i) + W + 0.2, yc], { color: 'lime', width: 4 });
                B.text(fmt(R.tau[i], 1), [xOf(i) + W / 2, R.tau[i] >= 0 ? y0 - 0.45 : y0 + 0.45], { size: 13, color: 'orange' });
              }
            }
            B.dot([xOf(i) + W / 2, 0.5], 9, { color: 'orange' });
            B.text(String(i + 1), [xOf(i) + W / 2, 0.5], { size: 12, color: 'bg', halo: false });
          }
          B.text('τ', [0.4, 9.4], { size: 22, color: 'orange' });
          if (s.beat === 3) { B.emoji('⬇️', [8.6, 9.4], 18); B.emoji('🏃', [9.4, 9.4], 18); }
        }
      },
    };
  },
};

function spinArc(g, c, r, da, color, width = 2.5) {
  if (Math.abs(da) < 0.08) return;
  da = clamp(da, -3, 3);
  const n = 20, pts = [];
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + (da * i) / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  g.path(pts.slice(0, n - 1), { color, width });
  g.arrow(pts[n - 3], pts[n], { color, width, head: 9 });
}
