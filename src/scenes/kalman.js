// Kalman filter: "where is my car?" is a fuzzy blob. Driving makes the blob
// spread (purple); a GPS ping is another blob (teal); multiply them and you get a
// sharper blob (blue) that sits at the balance point of a seesaw.
import { C, alpha, mix } from '../viz/palette.js';
import { KalmanFilter, fuse1, gauss1 } from '../core/estimation.js';
import { rng, clamp, smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';
import { hudPlot } from './registration.js';


export default {
  eq: [
    ['predict:  ', ['x̂⁻', 'purple'], ' = F ', ['x̂', 'blue'], '      ', ['P⁻', 'purple'], ' = F ', ['P', 'blue'], ' Fᵀ + ', ['Q', 'purple']],
    ['gain:      ', ['K', 'gold'], ' = ', ['P⁻', 'purple'], ' Hᵀ (H ', ['P⁻', 'purple'], ' Hᵀ + ', ['R', 'teal'], ')⁻¹          1D:  ', ['K', 'gold'], ' = ', ['σ²₋', 'purple'], ' / (', ['σ²₋', 'purple'], ' + ', ['σ²ᶻ', 'teal'], ')'],
    ['update:  ', ['x̂', 'blue'], ' = ', ['x̂⁻', 'purple'], ' + ', ['K', 'gold'], '(', ['z', 'teal'], ' − H ', ['x̂⁻', 'purple'], ')      ', ['P', 'blue'], ' = (I − ', ['K', 'gold'], 'H) ', ['P⁻', 'purple']],
    ['1D: ', ['μ', 'blue'], ' = (', ['μ₋', 'purple'], '/', ['σ²₋', 'purple'], ' + ', ['z', 'teal'], '/', ['σ²ᶻ', 'teal'], ') / (1/', ['σ²₋', 'purple'], ' + 1/', ['σ²ᶻ', 'teal'], ')   ← the seesaw’s balance point'],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait;
    const g = stage.g;
    const B1 = tall ? [-3.2, -3.0, 3.2, 5.0] : [-4.6, -2.7, 4.6, 4.6];
    const B2 = tall ? [-3.6, -6.2, 3.6, 4.4] : [-6.4, -4.6, 6.4, 3.2];
    const r = rng(7);
    const s = {
      beat: 0, q: 0.12, rr: 0.35, t: 0,
      // 1D
      x: 1, mu: 1, v: 0.04, phase: 'drive', ph: 0, z: null, fused: null, prior: null, sinceMerge: 9,
      // 2D
      truth: [0, 0], tv: [0, 0], drag: null, kf: null, meas: [], trail: [], etrail: [], errs: [], merrs: [], tm: 0, lastMeas: 0, T: 0,
    };
    const U = 1.5;                                  // commanded speed

    const reset1 = () => { s.x = 0; s.mu = 0; s.v = 0.03; s.cam = 0; s.phase = 'drive'; s.ph = 0; s.z = null; s.fused = null; s.sinceMerge = 9; };
    const reset2 = () => {
      const dt = 1 / 30, q = s.q * 2.5, rr = s.rr;
      s.T = 0; s.drag = null;
      s.truth = path(0); s.tv = [0, 0];
      s.kf = new KalmanFilter({
        x: [s.truth[0] + 0.6, s.truth[1] - 0.5, 0, 0],
        P: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 2, 0], [0, 0, 0, 2]],
        F: [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]],
        H: [[1, 0, 0, 0], [0, 1, 0, 0]],
        Q: Qcv(dt, q), R: [[rr * rr, 0], [0, rr * rr]],
      });
      s.meas = []; s.trail = []; s.etrail = []; s.errs = []; s.merrs = []; s.tm = 0;
    };
    const Qcv = (dt, q) => {
      const a = q * dt ** 3 / 3, b = q * dt ** 2 / 2, c = q * dt;
      return [[a, 0, b, 0], [0, a, 0, b], [b, 0, c, 0], [0, b, 0, c]];
    };
    const path = (T) => (tall ? [2.5 * Math.sin(0.25 * T), 0.6 + 3.0 * Math.sin(0.5 * T)] : [4.6 * Math.sin(0.25 * T), 0.3 + 2.2 * Math.sin(0.5 * T)]);

    // drag the bug in 2D (the truth follows your finger)
    stage.handle({ pen: g, color: 'lime', r: 12, icon: '🐞', visible: () => s.beat >= 2, get: () => s.truth,
      set: (p) => { s.drag = [clamp(p[0], B2[0] + 0.3, B2[2] - 0.3), clamp(p[1], B2[1] + 1.4, B2[3] - 0.3)]; },
      onEnd: () => { s.resume = true; } });

    ui.beats(['🚗', '⚖️', '🎯', '🙈'], (b) => {
      s.beat = b; s.t = 0;
      g.setBounds(b < 2 ? B1 : B2);
      if (b < 2) reset1(); else reset2();
    });
    ui.slider({ icon: '🌫️', color: 'purple', min: 0.02, max: 0.6, value: s.q, title: 'model wobble (Q)', onInput: (v) => { s.q = v; if (s.kf) s.kf.Q = Qcv(1 / 30, v * 2.5); } });
    ui.slider({ icon: '📡', color: 'teal', min: 0.08, max: 1.2, value: s.rr, title: 'sensor noise (R)', onInput: (v) => { s.rr = v; if (s.kf) s.kf.R = [[v * v, 0], [0, v * v]]; } });
    ui.readout(() => fmt(s.beat < 2 ? (s.fused?.k ?? s.lastK ?? 0) : (s.kf?.K ? s.kf.K[0][0] : 0), 2), { icon: '⚖️', color: 'gold', title: 'Kalman gain' });
    ui.readout(() => (s.beat < 2 ? fmt(Math.sqrt(s.v), 2) : fmt(Math.sqrt(s.kf?.P[0][0] ?? 0), 2)), { icon: '🌫️', color: 'purple', title: 'spread σ' });

    g.setBounds(B1);
    reset1();

    function step1(dt) {
      s.cam += (s.x + 0.4 - s.cam) * Math.min(1, dt * 3);
      // truth: commanded speed + a wobble the model doesn't know about
      if (s.phase === 'drive' || s.beat === 0) {
        s.x += U * dt + r.normal(0, Math.sqrt(s.q * dt));
        s.mu += U * dt; s.v += s.q * dt;              // predict: blob slides & spreads
        s.sinceMerge += dt;
      }
      s.ph += dt;
      if (s.beat === 0) {
        if (s.v > 2.2) reset1();
        return;
      }
      if (s.phase === 'drive' && s.ph > 1.5) { s.phase = 'ping'; s.ph = 0; s.z = s.x + r.normal(0, s.rr); s.prior = { mu: s.mu, v: s.v }; }
      else if (s.phase === 'ping' && s.ph > 0.9) { s.phase = 'merge'; s.ph = 0; s.fused = fuse1(s.prior.mu, s.prior.v, s.z, s.rr * s.rr); s.lastK = s.fused.k; }
      else if (s.phase === 'merge' && s.ph > 1.3) {
        s.mu = s.fused.mu; s.v = s.fused.var; s.phase = 'drive'; s.ph = 0; s.sinceMerge = 0; s.fused = null; s.z = null;
      }
    }

    function step2(dt) {
      const h = 1 / 30;
      s.acc = (s.acc ?? 0) + dt;
      while (s.acc >= h) {
        s.acc -= h; s.T += h; s.tm += h;
        const prev = s.truth;
        if (s.drag) { s.truth = s.drag; if (s.resume) { s.drag = null; s.resume = false; s.T0 = s.T; s.off = [s.truth[0] - path(s.T)[0], s.truth[1] - path(s.T)[1]]; } }
        else {
          const p = path(s.T), k = s.off ? Math.max(0, 1 - (s.T - s.T0) / 2) : 0;
          s.truth = s.off ? [p[0] + s.off[0] * k, p[1] + s.off[1] * k] : p;
        }
        s.tv = [(s.truth[0] - prev[0]) / h, (s.truth[1] - prev[1]) / h];
        s.kf.predict();
        const blind = s.beat === 3 && (s.T % 8) > 3 && (s.T % 8) < 5.6;
        s.blind = blind;
        if (s.tm >= 0.25 && !blind) {
          s.tm = 0;
          const rr = s.rr;
          const z = [s.truth[0] + r.normal(0, rr), s.truth[1] + r.normal(0, rr)];
          s.kf.update(z);
          s.meas.push({ z, t: s.T, pre: s.lastP });
          s.merrs.push(Math.hypot(z[0] - s.truth[0], z[1] - s.truth[1]));
        } else s.merrs.push(NaN);
        s.lastP = s.kf.P;
        s.trail.push([...s.truth]); s.etrail.push([s.kf.x[0], s.kf.x[1]]);
        s.errs.push(Math.hypot(s.kf.x[0] - s.truth[0], s.kf.x[1] - s.truth[1]));
        for (const a of [s.trail, s.etrail, s.errs, s.merrs]) if (a.length > 180) a.shift();
        if (s.meas.length > 14) s.meas.shift();
      }
    }

    return {
      update(dt) {
        dt = Math.max(0, dt);   // the shell can hand us a tiny negative dt right after a redraw
        s.t += dt; if (s.beat < 2) step1(dt); else step2(dt);
      },
      draw() { if (s.beat < 2) draw1(); else draw2(); },
    };

    // ------------------------------------------------------------------ 1D
    function curve(mu, v, color, a = 1, lift = 0) {
      const sd = Math.sqrt(v), H = 2.6;
      const pts = [];
      for (let i = 0; i <= 160; i++) {
        const x = s.cam - 6 + (i / 160) * 12;
        pts.push([x - s.cam, lift + Math.min(4.2, H * gauss1(x, mu, sd))]);
      }
      g.poly([[pts[0][0], lift], ...pts, [pts.at(-1)[0], lift]], { fill: alpha(color, 0.22 * a), stroke: false });
      g.path(pts, { color: alpha(color, a), width: 3 });
      g.blob([mu - s.cam, 0], sd, { color, alpha: 0.5 * a });
    }
    function draw1() {
      // the road
      g.rect(-8, -0.32, 16, 0.64, { fill: alpha('slate', 0.25), stroke: false });
      for (let k = Math.floor(s.cam) - 7; k <= s.cam + 7; k++) {
        g.line([k - s.cam, -0.02], [k - s.cam + 0.45, -0.02], { color: alpha('ink', 0.2), width: 2 });
        if (k % 2 === 0) g.line([k - s.cam, -0.45], [k - s.cam, -0.6], { color: alpha('muted', 0.5), width: 1.5 });
      }
      // belief: purple while driving (fresh from a merge it is still blue)
      const fresh = s.beat === 1 ? smoothstep(1 - s.sinceMerge / 0.8) : 0;
      const beliefCol = fresh > 0 ? mix(C.purple, C.blue, fresh) : 'purple';
      if (s.phase === 'drive' || s.beat === 0) curve(s.mu, s.v, beliefCol);
      if (s.beat === 1 && s.phase !== 'drive') {
        const kM = s.phase === 'merge' ? smoothstep(s.ph / 0.8) : 0;
        curve(s.prior.mu, s.prior.v, 'purple', 1 - 0.6 * kM);
        const kz = smoothstep(s.ph / 0.4);
        curve(s.z, s.rr * s.rr, 'teal', (s.phase === 'ping' ? kz : 1) * (1 - 0.6 * kM));
        g.dot([s.z - s.cam, 0], 6, { color: alpha('teal', kz), ring: 'bg' });
        seesaw(s.prior, s.z, s.rr * s.rr, kM);
        if (s.phase === 'merge') curve(s.fused.mu, s.fused.var, 'blue', kM);
      }
      // the car (truth)
      g.emoji('🚗', [s.x - s.cam, 0.02], 38, { dy: -7 });
      g.dot([s.x - s.cam, -0.38], 4.5, { color: 'lime' });
      // spread meter
      g.meter('🌫️', Math.sqrt(s.v), 1.6, { color: 'purple', slot: 0, width: 120 });
    }
    // weights ∝ how sure each blob is; the fulcrum sits where they balance = fused mean
    // A seesaw with a weight for each blob (heavier = surer). The fulcrum slides to
    // where it balances: that fraction of the way from 🧠 to 📡 IS the Kalman gain.
    function seesaw(prior0, z0, vz, kM) {
      const pm = prior0.mu - s.cam, z = z0 - s.cam;
      const wp = 1 / prior0.v, wz = 1 / vz, tot = wp + wz, K = wz / tot;
      const L = tall ? 4.6 : 5.2, sgn = z >= pm ? 1 : -1, y = -1.75;
      const c = (pm + z) / 2, A = c - sgn * L / 2;            // 🧠 end; 📡 end is A + sgn·L
      const f = 0.5 + (K - 0.5) * kM;                         // fulcrum: middle → balance point
      const torque = wz * (1 - f) - wp * f;                   // > 0: the 📡 side sinks
      const ang = -0.32 * Math.tanh(1.6 * torque / tot) * (1 - kM);
      const F = [A + sgn * f * L, y];
      const at = (u) => [F[0] + (u - f) * L * sgn * Math.cos(ang), F[1] + (u - f) * L * Math.sin(ang)];
      const P0 = at(0), P1 = at(1);
      // threads from the blobs down to their weights
      g.line([pm, -0.4], [P0[0], P0[1] + 0.1], { color: alpha('purple', 0.5), width: 1.5, dash: [3, 4] });
      g.line([z, -0.4], [P1[0], P1[1] + 0.1], { color: alpha('teal', 0.6), width: 1.5, dash: [3, 4] });
      const fh = g.world(16);
      g.poly([[F[0], F[1] - 0.04], [F[0] - fh, F[1] - fh * 1.6], [F[0] + fh, F[1] - fh * 1.6]], { fill: 'gold', stroke: false });
      g.line(P0, P1, { color: 'ink', width: 5 });
      const side = (w) => 0.3 + 0.75 * Math.sqrt(w / tot);
      const sp = side(wp), sz = side(wz);
      g.rrect(P0[0] - sp / 2, P0[1] + 0.05, sp, sp, 6, { fill: 'purple', stroke: false });
      g.rrect(P1[0] - sz / 2, P1[1] + 0.05, sz, sz, 6, { fill: 'teal', stroke: false });
      g.emoji('🧠', [P0[0], P0[1] + sp / 2 + 0.05], Math.max(13, g.px(sp) * 0.55));
      g.emoji('📡', [P1[0], P1[1] + sz / 2 + 0.05], Math.max(13, g.px(sz) * 0.55));
      g.text(`K = ${fmt(K, 2)}`, [F[0], F[1] - fh * 1.6 - 0.3], { color: 'gold', size: 16, alpha: 0.4 + 0.6 * kM });
      // and the fused blob sits right above the fulcrum's matching spot on the road
      if (kM > 0) g.line([pm + K * (z - pm), -0.4], [F[0], F[1]], { color: alpha('blue', 0.6 * kM), width: 2, dash: [2, 4] });
    }

    // ------------------------------------------------------------------ 2D
    function draw2() {
      g.grid({ step: 1 });
      const kf = s.kf;
      g.path(s.trail, { color: alpha('lime', 0.7), width: 2.5 });
      g.path(s.etrail, { color: alpha('blue', 0.8), width: 2.5 });
      // measurements fade with age
      s.meas.forEach((m, i) => {
        const a = (i + 1) / s.meas.length;
        g.dot(m.z, 5.5, { color: alpha('teal', 0.25 + 0.75 * a) });
      });
      const last = s.meas.at(-1);
      if (last && s.T - last.t < 0.35) {
        // just measured: show the bigger "before" blob shrinking to the new one
        if (last.pre) g.cov([kf.x[0], kf.x[1]], last.pre.slice(0, 2).map((r2) => r2.slice(0, 2)), 2, { color: alpha('purple', 0.5 * (1 - (s.T - last.t) / 0.35)), width: 2, dash: [4, 4] });
        g.circle(last.z, g.world(12 + 40 * (s.T - last.t)), { color: alpha('teal', 1 - (s.T - last.t) / 0.35), width: 2 });
      }
      const P2 = kf.P.slice(0, 2).map((r2) => r2.slice(0, 2));
      g.cov([kf.x[0], kf.x[1]], P2, 2, { fill: alpha('purple', 0.16), color: alpha('purple', 0.9), width: 2 });
      g.blob([kf.x[0], kf.x[1]], Math.sqrt(Math.max(P2[0][0], P2[1][1])) * 0.6, { color: 'purple', alpha: 0.35 });
      g.arrow([kf.x[0], kf.x[1]], [kf.x[0] + kf.x[2] * 0.4, kf.x[1] + kf.x[3] * 0.4], { color: 'blue', width: 2.5 });
      g.dot([kf.x[0], kf.x[1]], 7, { color: 'blue', ring: 'bg' });
      if (s.blind) g.emoji('🙈', [B2[0] + 0.7, B2[3] - 0.6], 30);
      else g.emoji('📡', [B2[0] + 0.7, B2[3] - 0.6], 26);
      // errors: estimate (coral line) vs raw sensor (teal dots)
      const area = g.area, w = Math.min(area.w - 24, 420), h = tall ? 76 : 88;
      hudPlot(stage.hud, { x: area.x + area.w - w - 12, y: area.y + area.h - h - 10, w, h },
        [{ vals: s.merrs, color: 'teal', line: false, dots: true, dotR: 2.2 }, { vals: s.errs, color: 'coral', width: 2.5 }],
        { icon: '📏', ymin: 0, ymax: Math.max(0.6, s.rr * 2.6), n: 180 });
    }
  },
};
