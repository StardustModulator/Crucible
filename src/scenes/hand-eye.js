// Hand–eye calibration: a camera is bolted to the robot's hand, but nobody wrote
// down exactly where (the ghost ❓). Move the hand (A, orange), watch how the camera
// thinks it moved (B, teal). Going "hand-move then bolt" must equal "bolt then
// camera-move": A X = X B. A few different wiggles pin the bolt X down.
import { View3D } from '../viz/view3d.js';
import { alpha, col } from '../viz/palette.js';
import { kabsch } from '../core/estimation.js';
import { expSO3, logSO3, homog, invSE3, rotOf, transOf, rotX, rotY, rotZ } from '../core/lie.js';
import { mmul, mvec, vadd, vsub, vscale, vnorm, cross, lstsq, T } from '../core/linalg.js';
import { rng, smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const DEG = 180 / Math.PI;
// the TRUE bolt (hand → camera): a little to the side, a bit tilted
const X_TRUE = homog(mmul(rotZ(0.6), rotX(-0.3)), [0.1, -0.08, 0.04]);
const vnz = (v) => vscale(v, 1 / (vnorm(v) || 1));

// hand poses: on a dome above the board, looking at it, with different twists
function lookAt(p, target, roll) {
  const z = vnz(vsub(target, p));
  const up = Math.abs(z[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  let x = vnz(cross(up, z));
  const y0 = cross(z, x);
  x = vadd(vscale(x, Math.cos(roll)), vscale(y0, Math.sin(roll)));
  const y = cross(z, x);
  return homog(T([x, y, z]), p);
}
const POSES = [
  [0.15, -0.55, 1.05, 0.0], [0.62, -0.2, 0.95, 0.7], [-0.45, -0.5, 1.15, -0.6], [0.35, 0.5, 1.0, 1.4],
  [-0.6, 0.25, 0.9, 2.2], [0.05, 0.1, 1.25, -1.3], [0.55, 0.4, 1.2, -2.4], [-0.3, 0.6, 1.05, 0.35], [-0.65, -0.15, 1.2, 2.9],
].map(([x, y, z, roll]) => lookAt([x, y, z], [x * 0.25, y * 0.25, 0], roll));

// a hand move that just twists the camera about its own lens axis
const SPIN = mmul(mmul(mmul(POSES[0], X_TRUE), homog(rotZ(1.2), [0, 0, 0])), invSE3(X_TRUE));

// Interpolate two poses (straight line + shortest turn).
function lerpPose(Ta, Tb, k) {
  const Ra = rotOf(Ta), Rb = rotOf(Tb);
  const R = mmul(Ra, expSO3(vscale(logSO3(mmul(T(Ra), Rb)), k)));
  return homog(R, vadd(transOf(Ta), vscale(vsub(transOf(Tb), transOf(Ta)), k)));
}
const rotErr = (Ra, Rb) => vnorm(logSO3(mmul(T(Ra), Rb))) * DEG;

// The solver: rotation by Park–Martin (axes of A and B line up through R_X),
// translation by least squares on (R_A − I) t_X = R_X t_B − t_A.
export function solveHandEye(As, Bs) {
  const al = As.map((A) => logSO3(rotOf(A))), be = Bs.map((B) => logSO3(rotOf(B)));
  // α = R_X β for every motion. kabsch removes centroids, so feed ± copies (centroid = 0).
  const { R } = kabsch([...be, ...be.map((b) => vscale(b, -1))], [...al, ...al.map((a) => vscale(a, -1))]);
  const M = [], y = [];
  As.forEach((A, i) => {
    const RA = rotOf(A), rhs = vsub(mvec(R, transOf(Bs[i])), transOf(A));
    for (let r = 0; r < 3; r++) { M.push([RA[r][0] - (r === 0), RA[r][1] - (r === 1), RA[r][2] - (r === 2)]); y.push(rhs[r]); }
  });
  return { R, t: lstsq(M, y), axes: { al, be } };
}

export default {
  eq: [
    [['A', 'orange'], ' = ✋₀⁻¹ ✋ᵢ  (hand moved)      ', ['B', 'teal'], ' = 📷₀⁻¹ 📷ᵢ  (camera saw itself move, from the 🏁)'],
    [['A', 'orange'], ' ', ['X', 'blue'], '  =  ', ['X', 'blue'], ' ', ['B', 'teal'], '      (both paths around the square end at the same 📷ᵢ)'],
    ['rotation:  ', ['α', 'orange'], 'ᵢ = log R_', ['A', 'orange'], 'ᵢ,  ', ['β', 'teal'], 'ᵢ = log R_', ['B', 'teal'], 'ᵢ  ⇒  ', ['α', 'orange'], 'ᵢ = R_', ['X', 'blue'], ' ', ['β', 'teal'], 'ᵢ   → best R_', ['X', 'blue'], ' by SVD (Park–Martin)'],
    ['shift:  (R_', ['A', 'orange'], 'ᵢ − I) t_', ['X', 'blue'], ' = R_', ['X', 'blue'], ' t_', ['B', 'teal'], 'ᵢ − t_', ['A', 'orange'], 'ᵢ   (stack all, least squares)'],
    ['one motion = one turning axis ⇒ ', ['X', 'blue'], ' can still spin about it: need ≥ 2 different axes'],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait;
    const g = stage.g;
    const v = new View3D(g, { yaw: -0.55, pitch: 0.38, dist: tall ? 3.0 : 2.15, target: [0, 0, 0.62] });
    const s = {
      beat: 0, n: 0, noise: 0, seed: 2, t: 0, move: 1, from: POSES[0], to: POSES[0], cyc: 0, list: POSES,
      Xhat: homog([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]), Xshow: null, Xfrom: null, xk: 1, phi: 0,
    };
    let Es = [];  // what the camera measures: board pose seen from the camera, with noise
    const measure = () => {
      const r = rng(100 + s.seed);
      Es = s.list.map((H) => {
        const Cw = mmul(H, X_TRUE), E = invSE3(Cw);   // board (= world) seen from camera
        const nr = s.noise / DEG, nt = s.noise * 0.002;
        return homog(mmul(expSO3([r.normal(0, nr), r.normal(0, nr), r.normal(0, nr)]), rotOf(E)), vadd(transOf(E), [r.normal(0, nt), r.normal(0, nt), r.normal(0, nt)]));
      });
    };
    const motions = (k) => {
      const As = [], Bs = [];
      for (let i = 1; i <= k; i++) { As.push(mmul(invSE3(s.list[0]), s.list[i])); Bs.push(mmul(Es[0], invSE3(Es[i]))); }
      return { As, Bs };
    };
    const resolve = (animate = true) => {
      const old = s.Xshow ?? s.Xhat;
      if (s.n === 0) s.Xhat = homog([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]);
      else { const { As, Bs } = motions(s.n); const sol = solveHandEye(As, Bs); s.Xhat = homog(sol.R, sol.t); s.sol = sol; }
      s.Xfrom = old; s.xk = animate ? 0 : 1;
    };
    const goTo = (i) => { s.from = s.cur ?? s.list[0]; s.to = s.list[i]; s.move = 0; s.target = i; };
    measure(); resolve(false);

    ui.beats(['🤝', '➕', '📏', '🚫'], (b) => {
      s.beat = b; s.t = 0;
      if (b === 0) { s.n = 0; s.cyc = 0; }
      if (b === 1) { s.n = 0; goTo(0); }
      if (b === 2) { s.n = s.list.length - 1; if (s.noise === 0) { s.noise = 1.5; noiseS.set(1.5); } }
      // 🚫: the one motion turns the camera about its own lens axis → that spin can't be seen
      s.list = b === 3 ? [POSES[0], SPIN, ...POSES.slice(2)] : POSES;
      if (b === 3) { s.n = 1; s.noise = 0; noiseS.set(0); goTo(1); v.target = transOf(mmul(POSES[0], X_TRUE)); v.dist = tall ? 1.7 : 1.25; }
      else { v.target = [0, 0, 0.62]; v.dist = tall ? 3.0 : 2.15; }
      measure(); resolve(false);
    });
    ui.button({ icon: '➕', title: 'add a motion', onClick: () => {
      if (s.beat === 0) s.beat = 1;
      if (s.n >= s.list.length - 1) s.n = 0;
      s.n++; goTo(s.n); resolve();
    } });
    ui.button({ icon: '🔁', title: 'start over with no motions', onClick: () => { s.n = 0; goTo(0); resolve(); } });
    const noiseS = ui.slider({ icon: '📏', color: 'purple', min: 0, max: 5, value: 0, title: 'camera noise', onInput: (x) => { s.noise = x; measure(); resolve(false); } });
    ui.button({ icon: '🎲', title: 'new noise', onClick: () => { s.seed++; measure(); resolve(false); } });
    ui.readout(() => s.n, { icon: '🤖', color: 'orange', title: 'motions used' });
    ui.readout(() => `${fmt(rotErr(rotOf(s.Xshow ?? s.Xhat), rotOf(X_TRUE)), 1)}°`, { icon: '🔄', color: 'coral', title: 'turn error' });
    ui.readout(() => `${fmt(vnorm(vsub(transOf(s.Xshow ?? s.Xhat), transOf(X_TRUE))) * 1000, 0)} mm`, { icon: '↔️', color: 'coral', title: 'shift error' });

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt; v.tick(dt);
        s.move = Math.min(1, s.move + dt / 1.1);
        s.xk = Math.min(1, s.xk + dt / 0.8);
        if (s.beat === 0) {
          // tour the poses so you can see the camera ride along
          s.cyc += dt;
          if (s.cyc > 2.2) { s.cyc = 0; goTo(((s.target ?? 0) % (s.list.length - 1)) + 1); }
        }
        s.phi += dt * 1.3;
      },
      draw() {
        const H = (s.cur = lerpPose(s.from, s.to, smoothstep(s.move)));
        // the ghost bolt we currently believe in
        let Xg = s.xk < 1 && s.Xfrom ? lerpPose(s.Xfrom, s.Xhat, smoothstep(s.xk)) : s.Xhat;
        let spinAxis = null;
        if (s.beat === 3 && s.n === 1) {
          // one motion: every turn about β (and slide along it) fits equally well
          // every X̂·S fits, where S is any turn φ (and slide d) about B's own screw axis
          const { As, Bs } = motions(1), sol = solveHandEye(As, Bs), B = Bs[0], be = vnz(sol.axes.be[0]);
          const RB = rotOf(B), tB = transOf(B);
          const q = lstsq([0, 1, 2].map((r) => [0, 1, 2].map((c) => (r === c) - RB[r][c])), vsub(tB, vscale(be, be[0] * tB[0] + be[1] * tB[1] + be[2] * tB[2])));
          const Rs = expSO3(vscale(be, s.phi)), d = 0.05 * Math.sin(s.phi * 0.7);
          const S = homog(Rs, vadd(vsub(q, mvec(Rs, q)), vscale(be, d)));
          Xg = mmul(homog(sol.R, sol.t), S);
          spinAxis = mvec(rotOf(H), mvec(rotOf(Xg), be));
        }
        s.Xshow = Xg;
        v.begin();
        v.floor(1.2, 0.2);
        board();
        // past hand poses (faint) — the "wiggles" we have used
        if (s.beat >= 1) for (let i = 0; i <= s.n; i++) if (s.list[i] !== s.to) v.frameT(s.list[i], 0.1, { alpha: 0.35, width: 2 });
        const Ctrue = mmul(H, X_TRUE), Cg = mmul(H, Xg);
        gripper(H);
        cam(Ctrue, { color: 'slate' });
        v.line(transOf(H), transOf(Ctrue), { color: 'slate', width: 5 });
        // camera rays to the board corners
        for (const c of [[-0.36, -0.3, 0], [0.36, -0.3, 0], [0.36, 0.3, 0], [-0.36, 0.3, 0]]) v.line(transOf(Ctrue), c, { color: alpha('teal', 0.35), width: 1.2 });
        // ghost ❓ = our estimate of where the camera is bolted
        cam(Cg, { color: 'blue', alpha: 0.4, ghost: true });
        v.frameT(Cg, s.beat === 3 ? 0.2 : 0.14, { width: 2.5, alpha: 0.85 });
        v.text(s.n >= 2 && rotErr(rotOf(Xg), rotOf(X_TRUE)) < 3 ? '✅' : '❓', vadd(transOf(Cg), [0, 0, 0.16]), { size: 20 });
        if (spinAxis) {
          const c = transOf(Cg);
          v.line(vsub(c, vscale(spinAxis, 0.35)), vadd(c, vscale(spinAxis, 0.35)), { color: 'orange', width: 2.5, dash: [5, 4] });
          v.circle(c, spinAxis, 0.16, { color: alpha('orange', 0.8), width: 2.5 });
        }
        // the loop: path 1 = A then X (lands at H·X̂), path 2 = X then B (lands at H₀·X̂·B)
        if (s.n >= 1 && s.beat !== 2) loop3D(Xg);
        v.flush();
        squareHUD(Xg);
        if (s.beat === 2) barsHUD();
      },
    };

    function board() {
      const sq = 0.12;
      for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) {
        const x0 = -0.36 + i * sq, y0 = -0.3 + j * sq;
        v.poly([[x0, y0, 0.001], [x0 + sq, y0, 0.001], [x0 + sq, y0 + sq, 0.001], [x0, y0 + sq, 0.001]], { color: (i + j) % 2 ? 'white' : 'black', alpha: 0.85, shade: false, bias: 0.5 });
      }
    }
    function at(Tm, l) { return vadd(mvec(rotOf(Tm), l), transOf(Tm)); }
    function gripper(H) {
      const R = rotOf(H);
      v.cylinder(at(H, [0, 0, -0.55]), at(H, [0, 0, -0.03]), 0.03, { color: 'slate', sides: 8 });
      v.box(R, at(H, [0, 0, 0]), [0.03, 0.08, 0.025], { color: 'pink' });
      v.box(R, at(H, [0, 0.065, 0.06]), [0.015, 0.012, 0.045], { color: 'pink' });
      v.box(R, at(H, [0, -0.065, 0.06]), [0.015, 0.012, 0.045], { color: 'pink' });
      v.frameT(H, 0.12, { width: 2.5 });
    }
    function cam(Cm, o = {}) {
      const R = rotOf(Cm);
      v.box(R, at(Cm, [0, 0, -0.03]), [0.045, 0.035, 0.03], { color: o.color, alpha: o.alpha, stroke: o.ghost ? col('blue') : undefined });
      v.cylinder(at(Cm, [0, 0, 0]), at(Cm, [0, 0, 0.035]), 0.02, { color: o.ghost ? 'blue' : 'ink', alpha: o.alpha, sides: 8 });
    }
    function loop3D(Xg) {
      const i = Math.max(1, Math.min(s.n, s.target ?? s.n));
      const { As, Bs } = motions(i);
      const A = As[i - 1], B = Bs[i - 1];
      const H0 = s.list[0], Hi = s.list[i];
      const end1 = mmul(Hi, Xg), end2 = mmul(mmul(H0, Xg), B);
      const p0 = transOf(H0), pi = transOf(Hi), c0 = transOf(mmul(H0, Xg));
      v.frameT(H0, 0.1, { alpha: 0.6, width: 2 });
      v.arrow(p0, pi, { color: 'orange', width: 3 });                       // A
      v.arrow(pi, transOf(end1), { color: 'blue', width: 2.5 });            // X
      v.arrow(p0, c0, { color: 'blue', width: 2.5 });                       // X
      v.arrow(c0, transOf(end2), { color: 'teal', width: 3 });              // B
      const gap = vnorm(vsub(transOf(end1), transOf(end2)));
      if (gap > 0.015) v.line(transOf(end1), transOf(end2), { color: 'coral', width: 4 });
      void A;
    }
    // The commuting square, flat: ✋₀ →A→ ✋ᵢ →X→ 📷ᵢ  vs  ✋₀ →X→ 📷₀ →B→ 📷ᵢ
    function squareHUD(Xg) {
      const area = g.area, S = tall ? 92 : 112, x = area.x + area.w - S - 54, y = area.y + 30;
      const ctx = stage.hud.ctx;
      ctx.save();
      ctx.fillStyle = alpha('panel', 0.92); ctx.strokeStyle = alpha('faint', 0.7);
      ctx.beginPath(); ctx.roundRect(x - 34, y - 26, S + 68, S + 52, 12); ctx.fill(); ctx.stroke();
      const P = { h0: [x, y], hi: [x + S, y], c0: [x, y + S], ci: [x + S, y + S] };
      let gap = 0;
      if (s.n >= 1) {
        const i = Math.max(1, Math.min(s.n, s.target ?? s.n)), { Bs } = motions(i);
        gap = vnorm(vsub(transOf(mmul(s.list[i], Xg)), transOf(mmul(mmul(s.list[0], Xg), Bs[i - 1]))));
      }
      const edge = (a, b, c, label, dash) => {
        ctx.strokeStyle = col(c); ctx.lineWidth = 4; ctx.setLineDash(dash ? [6, 5] : []);
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.setLineDash([]);
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...d);
        ctx.fillStyle = col(c); ctx.beginPath();
        ctx.moveTo(m[0] + d[0] / L * 8, m[1] + d[1] / L * 8); ctx.lineTo(m[0] - d[1] / L * 6, m[1] + d[0] / L * 6); ctx.lineTo(m[0] + d[1] / L * 6, m[1] - d[0] / L * 6); ctx.fill();
        ctx.font = '700 15px ui-rounded, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, m[0] - d[1] / L * 16, m[1] + d[0] / L * 16);
      };
      edge(P.h0, P.hi, 'orange', 'A');
      edge(P.hi, P.ci, 'blue', 'X', true);
      edge(P.h0, P.c0, 'blue', 'X', true);
      edge(P.c0, P.ci, 'teal', 'B');
      ctx.font = '20px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✋', P.h0[0] - 4, P.h0[1] - 4); ctx.fillText('✋', P.hi[0] + 4, P.hi[1] - 4);
      ctx.fillText('📷', P.c0[0] - 4, P.c0[1] + 4);
      ctx.fillText(s.n === 0 ? '📷' : gap < 0.015 ? '📷' : '💥', P.ci[0] + 4, P.ci[1] + 4);
      // two travellers take the two roads and should meet
      const k = (s.t % 3) / 2.4;
      if (k < 1) {
        const tr = (path) => { const seg = k < 0.5 ? [path[0], path[1], k * 2] : [path[1], path[2], (k - 0.5) * 2]; return [seg[0][0] + (seg[1][0] - seg[0][0]) * seg[2], seg[0][1] + (seg[1][1] - seg[0][1]) * seg[2]]; };
        const a = tr([P.h0, P.hi, P.ci]), b = tr([P.h0, P.c0, P.ci]);
        const off = s.n >= 1 ? Math.min(14, gap * 300) * smoothstep((k - 0.5) * 2) : 0;
        for (const [p, c, dx] of [[a, 'orange', 0], [b, 'teal', off]]) { ctx.fillStyle = col(c); ctx.beginPath(); ctx.arc(p[0] + dx, p[1] - dx * 0.4, 6, 0, 7); ctx.fill(); }
      }
      ctx.restore();
    }
    // error vs how many motions we used (current noise)
    function barsHUD() {
      const area = g.area, W = tall ? area.w - 24 : 280, Hh = tall ? 92 : 120, x = area.x + 12, y = area.y + area.h - Hh - 10;
      const ctx = stage.hud.ctx;
      ctx.save();
      ctx.fillStyle = alpha('panel', 0.92); ctx.strokeStyle = alpha('faint', 0.7);
      ctx.beginPath(); ctx.roundRect(x, y, W, Hh, 10); ctx.fill(); ctx.stroke();
      const errs = [];
      for (let k = 2; k < s.list.length; k++) { const { As, Bs } = motions(k), sol = solveHandEye(As, Bs); errs.push(rotErr(sol.R, rotOf(X_TRUE))); }
      const mx = Math.max(2, ...errs), bw = (W - 50) / errs.length;
      ctx.font = '15px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🔄', x + 18, y + Hh / 2);
      errs.forEach((e, i) => {
        const h = (e / mx) * (Hh - 34), bx = x + 38 + i * bw;
        ctx.fillStyle = col(i + 2 === s.n ? 'coral' : alpha('coral', 0.55)); ctx.beginPath(); ctx.roundRect(bx, y + Hh - 20 - h, bw * 0.7, Math.max(2, h), 3); ctx.fill();
        ctx.fillStyle = col('muted'); ctx.font = '700 11px ui-rounded, system-ui'; ctx.fillText(String(i + 2), bx + bw * 0.35, y + Hh - 9);
      });
      ctx.restore();
    }
  },
};
