// Computed torque: to track a fast figure-8, a plain PD controller lags and wobbles
// (coral). Computed torque first CANCELS the arm's physics using the model
// (M, C, g) and then adds a spring toward the plan — so it tracks perfectly (lime)…
// as long as the model is right.
import { alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rk4, twoLink, twoLinkM, twoLinkC, twoLinkG, twoLinkDeriv } from '../core/dynamics.js';
import { planarFK, twoLinkIK } from '../core/kinematics.js';
import { mvec } from '../core/linalg.js';
import { clamp } from '../core/random.js';

const H = 0.001, L = [twoLink.l1, twoLink.l2];
const PD = { kp: 120, kd: 18 }, CT = { kp: 100, kd: 20 };
const hand = (ph) => [1.15 + 0.42 * Math.sin(ph), -0.5 + 0.28 * Math.sin(2 * ph)];
const ik = (ph) => { const h = hand(ph); return twoLinkIK(L[0], L[1], h[0], h[1], false); };
// desired joint motion from the hand path (IK), derivatives by central differences in phase
function ref(ph, w) {
  const e = 1e-3, a = ik(ph - e), b = ik(ph), c = ik(ph + e);
  return {
    q: b,
    qd: b.map((x, i) => ((c[i] - a[i]) / (2 * e)) * w),
    qdd: b.map((x, i) => ((c[i] - 2 * x + a[i]) / (e * e)) * w * w),
  };
}

export default {
  eq: [
    ['PD:   ', ['τ', 'coral'], ' = Kₚ e + K_d ė                         e = ', ['q_d', 'gold'], ' − q'],
    ['CT:   ', ['τ', 'lime'], ' = ', ['M̂(q)', 'blue'], '( ', ['q̈_d', 'gold'], ' + ', ['K_d ė + Kₚ e', 'teal'], ' ) + ', ['Ĉ(q,q̇)q̇ + ĝ(q)', 'green']],
    ['if ', ['M̂', 'blue'], ' = M:   ë + K_d ė + Kₚ e = 0     (every joint becomes a perfect spring)'],
    ['if ', ['M̂', 'blue'], ' ≠ M:   ë + K_d ė + Kₚ e = ', ['M⁻¹(M̂ − M)(…)', 'coral'], '   → error comes back'],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[-0.3, -1.3, 1.85, 1.1], [0, 0, 10, 10]], [1.25, 1]);
    const p = { ...twoLink };
    const s = { beat: 0, ph: 0, w: (2 * Math.PI) / 2.6, mh: 1, pd: null, ct: null, tPD: [], tCT: [], eh: [], t: 0, lastS: 0, tauCT: null };
    const reset = () => {
      const r = ref(s.ph, s.w);
      s.pd = [...r.q, ...r.qd]; s.ct = [...r.q, ...r.qd];
      s.tPD = []; s.tCT = []; s.eh = []; s.t = 0; s.lastS = -1;
    };
    reset();
    const model = () => ({ ...p, m1: p.m1 * s.mh, m2: p.m2 * s.mh, I1: p.I1 * s.mh, I2: p.I2 * s.mh });
    const ctParts = (r, q, v) => {
      const ph = model();
      const e = [r.q[0] - q[0], r.q[1] - q[1]], ed = [r.qd[0] - v[0], r.qd[1] - v[1]];
      const M = twoLinkM(ph, q);
      const ff = mvec(M, r.qdd);
      const fb = mvec(M, [CT.kp * e[0] + CT.kd * ed[0], CT.kp * e[1] + CT.kd * ed[1]]);
      const cg = mvec(twoLinkC(ph, q, v), v).map((x, i) => x + twoLinkG(ph, q)[i]);
      return { ff, fb, cg, tau: [ff[0] + fb[0] + cg[0], ff[1] + fb[1] + cg[1]] };
    };

    const mhS = ui.slider({ icon: '🎭', title: 'model mass guess', color: 'blue', min: 0.3, max: 1.7, step: 0.01, value: 1, onInput: (v) => (s.mh = v) });
    ui.slider({ icon: '🐇', title: 'speed', color: 'gold', min: 0.4, max: 1.6, step: 0.01, value: 1, onInput: (v) => (s.w = ((2 * Math.PI) / 2.6) * v) });
    ui.button({ icon: '🔁', title: 'restart', onClick: reset });
    ui.beats(['🐢', '🪄', '🎭'], (i) => {
      s.beat = i;
      s.mh = i === 2 ? 0.45 : 1; mhS.set(s.mh);
      reset();
    });
    const handErr = (x) => { const h = planarFK(L, [x[0], x[1]]).tip, d = hand(s.ph); return Math.hypot(h[0] - d[0], h[1] - d[1]); };
    ui.readout(() => fmt(handErr(s.pd) * 100, 0), { icon: '🐢', color: 'coral', title: 'PD hand error' });
    ui.readout(() => (s.beat > 0 ? fmt(handErr(s.ct) * 100, 0) : '·'), { icon: '🪄', color: 'lime', title: 'computed torque hand error' });

    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        const n = Math.min(160, Math.round(dt / H));
        for (let k = 0; k < n; k++) {
          const ph0 = s.ph;
          const pdLaw = (t, q, v) => { const r = ref(ph0 + s.w * t, s.w); return [0, 1].map((i) => PD.kp * (r.q[i] - q[i]) + PD.kd * (r.qd[i] - v[i])); };
          const ctLaw = (t, q, v) => ctParts(ref(ph0 + s.w * t, s.w), q, v).tau;
          s.pd = rk4(twoLinkDeriv(p, pdLaw), 0, s.pd, H);
          if (s.beat > 0) s.ct = rk4(twoLinkDeriv(p, ctLaw), 0, s.ct, H);
          s.ph += s.w * H; s.t += H;
        }
        const tipPD = planarFK(L, [s.pd[0], s.pd[1]]).tip, tipCT = planarFK(L, [s.ct[0], s.ct[1]]).tip;
        const keep = Math.round(60 * (2 * Math.PI / s.w) * 1.1);
        s.tPD.push(tipPD); while (s.tPD.length > keep) s.tPD.shift();
        if (s.beat > 0) { s.tCT.push(tipCT); while (s.tCT.length > keep) s.tCT.shift(); }
        if (s.t - s.lastS > 1 / 30 || s.t < s.lastS) {
          s.lastS = s.t;
          s.eh.push([s.t, handErr(s.pd), s.beat > 0 ? handErr(s.ct) : null]);
          while (s.eh.length && s.eh[0][0] < s.t - 6) s.eh.shift();
        }
      },
      draw() {
        A.grid({ step: 0.25 });
        // the plan: a figure-8 for the hand
        const path = []; for (let i = 0; i <= 120; i++) path.push(hand((i / 120) * 2 * Math.PI));
        A.path(path, { color: alpha('gold', 0.55), width: 3, dash: [8, 6] });
        const Ppd = planarFK(L, [s.pd[0], s.pd[1]]).points;
        A.pathGradient(s.tPD, (i, t) => alpha('coral', 0.15 + 0.8 * t), { width: 4 });
        if (s.beat > 0) A.pathGradient(s.tCT, (i, t) => alpha('lime', 0.15 + 0.8 * t), { width: 4 });
        A.arm(Ppd, { width: 15, color: alpha('coral', 0.85), alpha: s.beat > 0 ? 0.55 : 1 });
        if (s.beat > 0) A.arm(planarFK(L, [s.ct[0], s.ct[1]]).points, { width: 15, color: 'lime' });
        const d = hand(s.ph);
        A.dot(d, 9, { color: 'gold', ring: 'bg', ringWidth: 3 });
        A.emoji('🎯', [d[0] + 0.16, d[1] + 0.16], 16);

        // ---------- right: error over time ----------
        const px0 = 0.5, px1 = 9.6, py0 = s.beat > 0 ? 5.4 : 1, py1 = 9.5, emax = 0.35;
        B.rect(px0, py0, px1 - px0, py1 - py0, { color: alpha('muted', 0.3), width: 1 });
        const t0 = s.eh.length ? s.eh[0][0] : 0;
        const X = (t) => px0 + ((t - t0) / 6) * (px1 - px0), Y = (e) => py0 + (clamp(e, 0, emax) / emax) * (py1 - py0);
        B.path(s.eh.map((h) => [X(h[0]), Y(h[1])]), { color: 'coral', width: 3, fillTo: undefined });
        if (s.beat > 0) B.path(s.eh.filter((h) => h[2] !== null).map((h) => [X(h[0]), Y(h[2])]), { color: 'lime', width: 3 });
        B.text('|e|', [px0 + 0.45, py1 - 0.35], { size: 15, color: 'coral' });

        if (s.beat > 0) {
          // what computed torque is made of, per joint: plan × model (gold) + physics cancel (green) + spring (teal)
          const r = ref(s.ph, s.w), parts = ctParts(r, [s.ct[0], s.ct[1]], [s.ct[2], s.ct[3]]);
          const y0 = 2.5, k = 0.16;
          B.line([0.5, y0], [9.6, y0], { color: alpha('muted', 0.4), width: 1 });
          [0, 1].forEach((j) => {
            const x = 1 + j * 4.6;
            const items = [['gold', parts.ff[j], '🎯'], ['green', parts.cg[j], '⚖️'], ['teal', parts.fb[j], '🌀']];
            items.forEach(([c, v, ic], i) => {
              B.bar(x + i * 1.15, y0, 0.85, clamp(v * k, -2.2, 2.2), { color: c });
              B.emoji(ic, [x + i * 1.15 + 0.42, 0.35], 15);
            });
            B.dot([x - 0.35, y0], 8, { color: 'orange' });
            B.text(String(j + 1), [x - 0.35, y0], { size: 11, color: 'bg', halo: false });
          });
        }
      },
    };
  },
};
