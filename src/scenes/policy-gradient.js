// Policy gradient: the archer does not know the right angle. Her "maybe" is a
// purple bell of angles. Shoot a few arrows, score them, then slide the bell
// TOWARD better-than-usual shots and AWAY from worse ones. Repeat → the bell
// narrows on the angle that hits.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rng, clamp, smoothstep, lerp } from '../core/random.js';

const V0 = 9, GRAV = 9.8, H0 = 0.6, N = 10;
const B = [-1.6, -3.55, 10.6, 3.3];
const IN = { x0: 0, x1: 9.6, y0: -3.1, amax: 64 }; // the bell-over-angles inset
const ax = (deg) => IN.x0 + (deg / IN.amax) * (IN.x1 - IN.x0);
const pdf = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));

function flight(deg, wind) {
  const th = (deg * Math.PI) / 180, vs = V0 * Math.sin(th), vc = V0 * Math.cos(th);
  const T = (vs + Math.sqrt(vs * vs + 2 * GRAV * H0)) / GRAV;
  const at = (t) => [vc * t + 0.5 * wind * t * t, H0 + vs * t - 0.5 * GRAV * t * t];
  return { T, at, land: at(T)[0] };
}

export default {
  eq: [
    ['policy:  ', ['θ', 'teal'], ' ~ 𝒩(', ['μ', 'blue'], ', ', ['σ', 'purple'], '²)        score  ', ['R', 'gold'], ' = 3 − |landing − 🎯|'],
    ['∇', ['μ', 'blue'], ' J ≈ mean[ (', ['R', 'gold'], ' − ', ['b', 'orange'], ') · (', ['θ', 'teal'], ' − ', ['μ', 'blue'], ')/', ['σ', 'purple'], '² ]        ', ['μ', 'blue'], ' ← ', ['μ', 'blue'], ' + α ∇', ['μ', 'blue'], ' J'],
    [['b', 'orange'], ' = mean ', ['R', 'gold'], '  (baseline):  same direction on average, much less ', ['jitter', 'purple']],
    [['better than b', 'lime'], ' → pull the bell closer,   ', ['worse than b', 'coral'], ' → push it away'],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait, VS = tall ? 2.1 : 1; // phones: stretch the bell inset vertically
    const g = stage.g.setBounds(tall ? [B[0], -0.45 - 3.1 * VS, B[2], B[3]] : B);
    const rand = rng(12), spr = rng(99);
    const s = {
      beat: 0, D: 6.6, wind: 0, base: true, mu: 12, sig: 8, t: 0, phase: 'fly', pt: 0,
      shots: [], next: null, curve: [], spray: [], streaks: Array.from({ length: 16 }, (_, i) => [((i * 0.61) % 1) * 12 - 1.5, 1.2 + ((i * 0.37) % 1) * 3.2]),
    };
    const reward = (x) => 3 - Math.abs(x - s.D);
    const volley = (r, mu = s.mu, sig = s.sig) => {
      const th = Array.from({ length: N }, () => clamp(r.normal(mu, sig), 1, 80));
      const R = th.map((t) => reward(flight(t, s.wind).land));
      return { th, R };
    };
    // REINFORCE step for a Gaussian policy (mean and log-std)
    const grad = ({ th, R }, mu, sig, useBase) => {
      const b = useBase ? R.reduce((a, c) => a + c, 0) / R.length : 0;
      const A = R.map((r) => r - b);
      const gmu = A.reduce((a, c, i) => a + (c * (th[i] - mu)) / (sig * sig), 0) / R.length;
      const gls = A.reduce((a, c, i) => a + c * ((th[i] - mu) ** 2 / (sig * sig) - 1), 0) / R.length;
      return { A, b, gmu, gls };
    };
    const LR_MU = 9, LR_LS = 0.06;
    const shoot = () => {
      const v = volley(rand);
      const gr = grad(v, s.mu, s.sig, s.base);
      s.shots = v.th.map((t, i) => ({ th: t, R: v.R[i], A: gr.A[i], f: flight(t, s.wind) }));
      s.gr = gr;
      const mu2 = clamp(s.mu + LR_MU * gr.gmu, 2, 75), sig2 = clamp(Math.exp(Math.log(s.sig) + LR_LS * gr.gls), 1.0, 16);
      s.next = { mu0: s.mu, sig0: s.sig, mu: mu2, sig: sig2 };
      s.phase = 'fly'; s.pt = 0;
      // gradient "jitter": many other volleys we could have shot right now
      if (s.beat === 2) s.spray = Array.from({ length: 22 }, () => LR_MU * grad(volley(spr), s.mu, s.sig, s.base).gmu);
    };
    shoot();

    stage.handle({ pen: g, color: 'gold', icon: '🎯', r: 15, get: () => [s.D, 0.45],
      set: (p) => { s.D = clamp(p[0], 2.5, 8.6); } });
    ui.beats(['🎯', '🏹', '📏', '📈'], (b) => { s.beat = b; s.curve = []; shoot(); });
    ui.slider({ icon: '🌬️', color: 'teal', min: -3, max: 3, step: 0.1, value: 0, title: 'wind', onInput: (v) => (s.wind = v) });
    ui.toggle({ icon: '📏', title: 'baseline on/off', value: true, color: 'orange', onChange: (v) => { s.base = v; if (s.beat === 2) shoot(); } });
    ui.button({ icon: '🔄', title: 'forget (wide bell again)', onClick: () => { s.mu = 12; s.sig = 8; s.curve = []; shoot(); } });
    ui.readout(() => `${fmt(s.mu, 1)}°`, { icon: 'μ', color: 'blue', title: 'mean angle' });
    ui.readout(() => `${fmt(s.sig, 1)}°`, { icon: 'σ', color: 'purple', title: 'spread' });
    ui.readout(() => fmt(s.shots.reduce((a, c) => a + c.R, 0) / s.shots.length, 2), { icon: '⭐', color: 'gold', title: 'average score' });
    ui.readout(() => (s.base ? fmt(s.gr?.b ?? 0, 2) : '0'), { icon: 'b', color: 'orange', title: 'baseline' });

    const durs = () => (s.beat === 3 ? [0.6, 0.25, 0.3] : [1.2, 0.9, 0.8]);

    return {
      update(dt) {
        s.t += dt; s.pt += dt;
        for (const st of s.streaks) { st[0] += (s.wind * 0.9 + (s.wind === 0 ? 0 : Math.sign(s.wind) * 0.3)) * dt; if (st[0] > 10.5) st[0] = -1.5; if (st[0] < -1.5) st[0] = 10.5; }
        const [dFly, dScore, dUpd] = durs();
        if (s.phase === 'fly' && s.pt > dFly) { s.phase = 'score'; s.pt = 0; }
        else if (s.phase === 'score' && s.pt > dScore) {
          s.phase = s.beat === 0 ? 'rest' : 'update'; s.pt = 0;
          s.curve.push(s.shots.reduce((a, c) => a + c.R, 0) / N); if (s.curve.length > 60) s.curve.shift();
        } else if (s.phase === 'update') {
          const u = smoothstep(s.pt / dUpd);
          s.mu = lerp(s.next.mu0, s.next.mu, u); s.sig = lerp(s.next.sig0, s.next.sig, u);
          if (s.pt > dUpd) shoot();
        } else if (s.phase === 'rest' && s.pt > 0.6) shoot();
      },
      draw() {
        const [dFly] = durs();
        // sky streaks = wind
        if (Math.abs(s.wind) > 0.05) for (const [x, y] of s.streaks) g.line([x, y], [x + Math.sign(s.wind) * (0.25 + Math.abs(s.wind) * 0.18), y], { color: alpha('teal', 0.35), width: 2 });
        // ground + target
        g.line([-1.6, 0], [10.4, 0], { color: 'muted', width: 2 });
        g.rect(-1.6, -0.12, 12, 0.12, { fill: alpha('muted', 0.15), stroke: false });
        g.line([s.D, 0], [s.D, 0.25], { color: 'gold', width: 3 });
        g.rect(s.D - 0.5, -0.06, 1.0, 0.06, { fill: alpha('gold', 0.5), stroke: false });
        // the archer and her bell of directions
        const O = [0, H0];
        g.emoji('🧍', [-0.55, 0.62], Math.max(26, g.px(1.0)));
        g.emoji('🏹', [-0.12, 0.62], Math.max(16, g.px(0.45)));
        const bell = [];
        for (let a = 0; a <= 80; a += 1) {
          const r = 0.45 + 2.8 * Math.tanh(pdf(a, s.mu, s.sig) * 14), th = (a * Math.PI) / 180;
          bell.push([O[0] + Math.cos(th) * r, O[1] + Math.sin(th) * r]);
        }
        const inner = []; for (let a = 80; a >= 0; a -= 2) { const th = (a * Math.PI) / 180; inner.push([O[0] + Math.cos(th) * 0.45, O[1] + Math.sin(th) * 0.45]); }
        g.poly([...bell, ...inner], { fill: alpha('purple', 0.28), color: alpha('purple', 0.8), width: 2 });
        const mt = (s.mu * Math.PI) / 180;
        g.line(O, [O[0] + Math.cos(mt) * 2.9, O[1] + Math.sin(mt) * 2.9], { color: 'blue', width: 2.5, dash: [6, 4] });
        // the volley
        const fly = s.phase === 'fly' ? smoothstep(s.pt / dFly) : 1;
        const scored = s.phase !== 'fly';
        const Amax = Math.max(0.3, ...s.shots.map((x) => Math.abs(x.A)));
        for (const sh of s.shots) {
          const t = fly * sh.f.T, pts = [];
          for (let k = 0; k <= 30; k++) pts.push(sh.f.at((t * k) / 30));
          const good = sh.A >= 0;
          const colr = !scored || s.beat === 0 ? 'teal' : good ? 'lime' : 'coral';
          const a = !scored || s.beat === 0 ? 0.55 : 0.25 + 0.65 * (Math.abs(sh.A) / Amax);
          g.path(pts, { color: alpha(colr, a), width: 2 });
          const p = pts[pts.length - 1], q = pts[pts.length - 2];
          const d = [p[0] - q[0], p[1] - q[1]], L = Math.hypot(...d) || 1;
          g.line([p[0] - (d[0] / L) * 0.35, p[1] - (d[1] / L) * 0.35], p, { color: colr === 'teal' ? 'ink' : colr, width: 3 });
          if (scored) g.dot([sh.f.land, 0], 4.5, { color: s.beat === 0 ? (sh.R > 2 ? 'gold' : 'teal') : colr });
        }
        drawInset(scored);
        if (s.beat >= 1) drawCurve();
      },
    };

    function drawInset(scored) {
      const y0 = -0.2 - 2.9 * VS, hmax = 1.75 * VS;
      g.line([IN.x0, y0], [IN.x1, y0], { color: 'muted', width: 1.5 });
      for (const a of [0, 15, 30, 45, 60]) { g.line([ax(a), y0], [ax(a), y0 - 0.1], { color: 'muted', width: 1.5 }); g.text(`${a}°`, [ax(a), y0 - 0.25], { size: 11, color: 'muted' }); }
      // the bell over angles
      const pts = []; for (let a = 0; a <= IN.amax; a += 0.5) pts.push([ax(a), y0 + hmax * Math.tanh(pdf(a, s.mu, s.sig) * 12)]);
      g.poly([[ax(0), y0], ...pts, [ax(IN.amax), y0]], { fill: alpha('purple', 0.25), color: 'purple', width: 2 });
      g.line([ax(s.mu), y0], [ax(s.mu), y0 + hmax + 0.15], { color: 'blue', width: 2.5, dash: [5, 4] });
      // where each arrow's angle sits, and which way it nudges μ
      const sh = s.shots;
      sh.forEach((x) => g.line([ax(x.th), y0], [ax(x.th), y0 + 0.22], { color: !scored || s.beat === 0 ? 'teal' : x.A >= 0 ? 'lime' : 'coral', width: 3 }));
      if (scored && s.beat > 0 && s.gr) {
        // each arrow's share of the step: (LR/N)·A·(θ−μ)/σ² — they add up to the blue step
        const mu0 = s.next.mu0, sig0 = s.next.sig0, wpd = (IN.x1 - IN.x0) / IN.amax;
        const share = sh.map((x) => ((LR_MU / N) * x.A * (x.th - mu0)) / (sig0 * sig0));
        const M = 1.9 / Math.max(1e-6, ...share.map((c) => Math.abs(c) * wpd));
        share.forEach((c, i) => {
          const y = y0 + 0.3 * VS + i * 0.16 * VS, L = c * wpd * M;
          if (Math.abs(L) > 0.02) g.arrow([ax(mu0), y], [ax(mu0) + L, y], { color: sh[i].A >= 0 ? 'lime' : 'coral', width: 2.4, head: 8, alpha: 0.9 });
        });
        const yN = y0 + hmax + 0.3 * VS;
        if (s.beat === 2 && s.spray.length) {
          // the jitter: the same step computed from 22 other volleys we might have shot
          s.spray.forEach((d, i) => { const yy = yN + 0.14 * VS + i * 0.022 * VS; g.arrow([ax(mu0), yy], [ax(mu0) + clamp(d * wpd * M, -4.5, 4.5), yy], { color: alpha('purple', 0.45), width: 1.4, head: 5 }); });
        }
        g.arrow([ax(mu0), yN], [ax(mu0) + clamp((s.next.mu - mu0) * wpd * M, -4.5, 4.5), yN], { color: 'blue', width: 5.5 });
      }
    }

    function drawCurve() {
      // reward per volley (top-right of the sky)
      const X0 = 7.0, X1 = 10.2, Y0 = 1.75, Y1 = 3.05, lo = -1, hi = 3;
      g.rrect(X0 - 0.25, Y0 - 0.25, X1 - X0 + 0.4, Y1 - Y0 + 0.45, 10, { fill: alpha('panel', 0.85), color: alpha('muted', 0.3), width: 1 });
      g.line([X0, Y0], [X1, Y0], { color: 'muted', width: 1 });
      g.line([X0, Y0], [X0, Y1], { color: 'muted', width: 1 });
      g.emoji('⭐', [X0 + 0.02, Y1 + 0.02], 13);
      const n = Math.max(20, s.curve.length);
      const pts = s.curve.map((r, i) => [X0 + ((X1 - X0) * i) / (n - 1), Y0 + ((clamp(r, lo, hi) - lo) / (hi - lo)) * (Y1 - Y0)]);
      if (pts.length > 1) g.path(pts, { color: 'gold', width: 2.5 });
      for (const p of pts) g.dot(p, 2.5, { color: 'gold' });
      void C;
    }
  },
};
