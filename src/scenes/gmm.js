// A Gaussian mixture says "the berries grow in a few fuzzy clumps".
// EM finds the clumps by repeating two moves:
//   🎨 E: every berry asks "which clump do I belong to?" (it gets a color mix)
//   🏃 M: every clump walks to the middle of the berries that picked it and reshapes.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { gmmInit, gmmStep } from '../core/learning.js';
import { rng, clamp, smoothstep } from '../core/random.js';

const KC = ['blue', 'orange', 'pink'];           // the three model clumps
const CLUSTERS = [[-2.2, 1.1], [1.9, 1.5], [0.4, -1.6]];
const SHAPES = [[0.55, 0.3, 0.6], [0.35, 0.6, -0.3], [0.75, 0.32, 0.1]]; // sx, sy, angle

const rgbOf = (key) => { const h = C[key].slice(1); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const blend = (w, keys) => {
  const c = [0, 0, 0];
  w.forEach((wi, j) => { const r = rgbOf(keys[j]); for (let d = 0; d < 3; d++) c[d] += wi * r[d]; });
  return `rgb(${c.map((x) => Math.round(x)).join(',')})`;
};
const lerpS = (A, B, k) => A.map((r, i) => r.map((x, j) => x + (B[i][j] - x) * k));

// Little log-likelihood chart in the HUD corner.
function miniPlot(hud, ys, { w = 170, h = 84, color = 'gold', icon = '📈' } = {}) {
  if (ys.length < 2) return;
  const ctx = hud.ctx, X = hud.area.w - w - 12, Y = 12;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.9); ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(X, Y, w, h, 10); ctx.fill(); ctx.stroke();
  ctx.font = '15px system-ui, "Apple Color Emoji", sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillText(icon, X + 7, Y + 6);
  if (ys.length > 1) {
    const lo = Math.min(...ys), hi = Math.max(...ys), n = Math.max(ys.length - 1, 12);
    const px = (i) => X + 30 + ((w - 40) * i) / n, py = (v) => Y + h - 10 - ((h - 20) * (v - lo)) / (hi - lo || 1);
    ctx.beginPath(); ys.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
    ctx.strokeStyle = C[color]; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(px(ys.length - 1), py(ys[ys.length - 1]), 4, 0, 7); ctx.fillStyle = C[color]; ctx.fill();
  }
  ctx.restore();
}

export default {
  eq: [
    [['p(x)', 'purple'], ' = Σₖ πₖ 𝒩(', ['x', 'teal'], ' | ', ['μₖ', 'blue'], ', ', ['Σₖ', 'blue'], ')'],
    [['E', 'pink'], ':  ', ['γᵢₖ', 'pink'], ' = πₖ𝒩(xᵢ|μₖ,Σₖ) / Σⱼ πⱼ𝒩(xᵢ|μⱼ,Σⱼ)'],
    [['M', 'orange'], ':  ', ['μₖ', 'blue'], ' = Σᵢ ', ['γᵢₖ', 'pink'], ' ', ['xᵢ', 'teal'], ' / Σᵢ ', ['γᵢₖ', 'pink'], '  ·  Σₖ = weighted spread'],
    [['log L', 'gold'], ' = Σᵢ log Σₖ πₖ𝒩(xᵢ|μₖ,Σₖ)  never goes down'],
    [['GMR', 'blue'], ':  ', ['x̂(t)', 'blue'], ' = Σₖ hₖ(t) [μₓₖ + Σₓₜₖ Σₜₜₖ⁻¹ (t − μₜₖ)]'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-4.4, -3.2, 4.4, 3.4]);
    const R0 = rng(5);
    // fixed "berry offsets" for each cluster; dragging a cluster center just slides them
    const offs = CLUSTERS.map((_, c) => Array.from({ length: 42 }, () => {
      const [sx, sy, a] = SHAPES[c], u = R0.normal() * sx, v = R0.normal() * sy;
      return [u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)];
    }));
    const s = {
      beat: 0, t: 0, centers: CLUSTERS.map((c) => c.slice()), seed: 3, probe: [-0.6, 0.4],
      phase: 'idle', ph: 0, auto: true, ll: [], hump: [0.8, 1.2], gmrT: 0,
    };
    const dataPoints = () => s.centers.flatMap((c, k) => offs[k].map((o) => [c[0] + o[0], c[1] + o[1]]));
    s.pts = dataPoints();

    // ---- GMR demos: several taught motions x(t), all passing near the hump ----
    const demoR = rng(21);
    const demoVar = Array.from({ length: 6 }, () => ({ a: demoR.normal(1, 0.22), sh: demoR.normal(0, 0.3), off: demoR.normal(0, 0.28), hs: demoR.normal(1, 0.2) }));
    const base = (t) => -0.6 + 1.3 * Math.sin(0.5 * t);
    const demoX = (t, d) => d.off * (0.4 + 0.6 * Math.abs(Math.sin(0.4 * t))) + d.a * (base(t + d.sh) + 0.6) - 0.6
      + s.hump[1] * d.hs * Math.exp(-((t + d.sh - s.hump[0]) ** 2) / 0.9);
    const demos = () => demoVar.map((d) => Array.from({ length: 22 }, (_, i) => { const t = -4 + (8 * i) / 21; return [t, demoX(t, d)]; }));

    const initModel = (pts, k, seed, spreadT = false) => {
      const m = gmmInit(pts, k, seed);
      if (spreadT) { const sorted = pts.slice().sort((a, b) => a[0] - b[0]); m.mu = m.mu.map((_, j) => sorted[Math.floor(((j + 0.5) / k) * sorted.length)].slice()); }
      else { // a deliberately clumsy start so the walk is visible
        const r = rng(seed);
        m.mu = m.mu.map(() => [r.uniform(-1.6, 1.6), r.uniform(-1, 1.2)]);
        m.S = m.S.map(() => [[0.5, 0], [0, 0.5]]);
      }
      return m;
    };
    const reset = () => {
      s.pts = s.beat === 4 ? demos().flat() : dataPoints();
      s.model = initModel(s.pts, s.beat === 4 ? 5 : 3, s.seed, s.beat === 4);
      s.disp = { mu: s.model.mu.map((m) => m.slice()), S: s.model.S.map((S) => S.map((r) => r.slice())) };
      s.resp = gmmStep(s.pts, s.model).resp; s.dispResp = s.resp.map((r) => r.slice());
      s.ll = []; s.phase = 'idle'; s.ph = 0; s.from = null;
    };
    reset();

    // handles: data clumps (beat 0, 3), model means (beats 1, 2), the probe berry (beat 1), the demo hump (beat 4)
    s.centers.forEach((_, k) => stage.handle({
      pen: g, color: 'teal', kind: 'ring', r: 12, visible: () => s.beat === 0 || s.beat === 3,
      get: () => s.centers[k], set: (p) => { s.centers[k] = [clamp(p[0], -3.6, 3.6), clamp(p[1], -2.6, 2.8)]; s.pts = dataPoints(); },
    }));
    KC.forEach((c, k) => stage.handle({
      pen: g, color: c, r: 9, visible: () => (s.beat === 1 || s.beat === 2) && s.phase !== 'M',
      get: () => s.disp.mu[k], set: (p) => { s.model.mu[k] = [clamp(p[0], -4, 4), clamp(p[1], -3, 3)]; s.disp.mu[k] = s.model.mu[k].slice(); s.ll = []; },
    }));
    stage.handle({ pen: g, color: 'teal', kind: 'ring', r: 9, visible: () => s.beat === 1, get: () => s.probe, set: (p) => (s.probe = [clamp(p[0], -4, 4), clamp(p[1], -3, 3)]) });
    stage.handle({ pen: g, color: 'teal', icon: '⛰️', r: 13, visible: () => s.beat === 4, get: () => [s.hump[0], base(s.hump[0]) + s.hump[1]],
      set: (p) => { s.hump = [clamp(p[0], -3, 3), clamp(p[1] - base(clamp(p[0], -3, 3)), -1.6, 2.2)]; s.pts = demos().flat(); } });

    ui.beats(['🫐', '🎨', '🏃', '📈', '🦾'], (b) => { s.beat = b; s.t = 0; reset(); });
    const emBtn = ui.button({ icon: '👣', title: 'one EM step', onClick: () => startStep() });
    ui.toggle({ icon: '🔁', title: 'keep stepping', value: true, color: 'gold', onChange: (v) => (s.auto = v) });
    ui.button({ icon: '🎲', title: 'new random start', onClick: () => { s.seed += 1; reset(); } });
    ui.readout(() => (s.ll.length ? fmt(s.ll[s.ll.length - 1] / s.pts.length, 2) : '–'), { icon: '📈', color: 'gold', title: 'log-likelihood per point' });
    void emBtn;

    function startStep() {
      if (s.beat === 0 || s.phase !== 'idle') return;
      const res = gmmStep(s.pts, s.model);
      s.ll.push(res.ll); if (s.ll.length > 60) s.ll.shift();
      s.from = { mu: s.model.mu.map((m) => m.slice()), S: s.model.S.map((S) => S.map((r) => r.slice())), resp: s.dispResp.map((r) => r.slice()) };
      s.next = res; s.phase = 'E'; s.ph = 0;
    }

    return {
      update(dt) {
        dt = Math.max(0, dt); // first frame can report a negative dt
        s.t += dt;
        const dur = s.beat === 3 || s.beat === 4 ? 0.18 : 0.6;
        if (s.phase === 'E') {
          s.ph += dt / dur;
          const k = smoothstep(s.ph);
          s.dispResp = s.from.resp.map((r, i) => r.map((x, j) => x + ((s.next.resp[i]?.[j] ?? x) - x) * k));
          if (s.ph >= 1) { s.phase = 'M'; s.ph = 0; }
        } else if (s.phase === 'M') {
          s.ph += dt / dur;
          const k = smoothstep(s.ph);
          s.disp.mu = s.from.mu.map((m, j) => [m[0] + (s.next.mu[j][0] - m[0]) * k, m[1] + (s.next.mu[j][1] - m[1]) * k]);
          s.disp.S = s.from.S.map((S, j) => lerpS(S, s.next.S[j], k));
          if (s.ph >= 1) {
            s.model = { pi: s.next.pi, mu: s.next.mu, S: s.next.S };
            s.phase = 'idle'; s.ph = 0; s.wait = s.beat === 2 ? 0.7 : 0.05;
          }
        } else if (s.beat >= 2 && s.auto) {
          s.wait = (s.wait ?? 0) - dt;
          const conv = s.ll.length > 3 && Math.abs(s.ll[s.ll.length - 1] - s.ll[s.ll.length - 2]) < 1e-3 * s.pts.length;
          if (s.wait <= 0 && !conv) startStep();
        }
        if (s.beat === 1 || (s.phase === 'idle' && s.beat !== 4)) {
          // E-step live: berries recolor the instant a clump moves
          s.resp = gmmStep(s.pts, s.model).resp;
          if (s.phase === 'idle') s.dispResp = s.resp;
        }
        if (s.beat === 4) s.gmrT = (s.gmrT + dt * 0.25) % 1.25;
      },
      draw() {
        g.grid({ step: 1 });
        if (s.beat === 4) return drawGMR();
        const showModel = s.beat > 0;
        // ellipses (1σ, 2σ)
        if (showModel) KC.forEach((c, j) => {
          g.cov(s.disp.mu[j], s.disp.S[j], 2, { color: alpha(c, 0.55), width: 2, fill: alpha(c, 0.06) });
          g.cov(s.disp.mu[j], s.disp.S[j], 1, { color: c, width: 2.5, fill: alpha(c, 0.12) });
        });
        // where each clump is walking to during an M-step
        if (s.phase === 'M' && s.next) KC.forEach((c, j) => g.arrow(s.from.mu[j], s.next.mu[j], { color: alpha(c, 0.8), width: 3, dash: [5, 4] }));
        // berries
        s.pts.forEach((p, i) => {
          const fill = showModel ? blend(s.dispResp[i] ?? [1, 0, 0], KC) : C.teal;
          g.dot(p, 5, { color: fill, ring: alpha('bg', 0.9), ringWidth: 1.2 });
        });
        if (s.beat === 0) s.centers.forEach((c) => g.emoji('🫐', [c[0], c[1] + 0.55], 20));
        if (showModel) KC.forEach((c, j) => { if (s.beat !== 1 && s.beat !== 2) g.dot(s.disp.mu[j], 6, { color: c, ring: 'bg' }); });
        // probe berry: three strings, thick = "mostly mine"
        if (s.beat === 1) {
          const w = gmmStep([s.probe], s.model).resp[0];
          KC.forEach((c, j) => g.line(s.probe, s.disp.mu[j], { color: alpha(c, 0.35 + 0.6 * w[j]), width: 1 + 12 * w[j] }));
          g.dot(s.probe, 9, { color: blend(w, KC), ring: 'bg', ringWidth: 2 });
          // tiny pie
          let a0 = Math.PI / 2; const pc = [s.probe[0] + 0.55, s.probe[1] + 0.55];
          w.forEach((wj, j) => { g.wedge(pc, 0.3, a0, a0 + wj * 2 * Math.PI, { color: KC[j], alpha: 0.95 }); a0 += wj * 2 * Math.PI; });
        }
        if (s.beat >= 1) miniPlot(stage.hud, s.ll.map((v) => v / s.pts.length), stage.portrait ? { w: 130, h: 64 } : {});
      },
    };

    function drawGMR() {
      const m = s.model, k = m.pi.length;
      // components
      for (let j = 0; j < k; j++) g.cov(s.disp.mu[j] ?? m.mu[j], s.disp.S[j] ?? m.S[j], 1.5, { color: alpha('blue', 0.5), width: 1.5, fill: alpha('blue', 0.07) });
      // conditional mean + variance band (Gaussian mixture regression)
      const ts = [], mean = [], lo = [], hi = [];
      for (let i = 0; i <= 90; i++) {
        const t = -4.2 + (8.4 * i) / 90;
        const h = m.mu.map((mu, j) => m.pi[j] * Math.exp(-((t - mu[0]) ** 2) / (2 * m.S[j][0][0])) / Math.sqrt(m.S[j][0][0]));
        const hs = h.reduce((a, b) => a + b, 0) || 1e-300;
        let mx = 0, ex2 = 0;
        m.mu.forEach((mu, j) => {
          const S = m.S[j], mk = mu[1] + (S[1][0] / S[0][0]) * (t - mu[0]), vk = S[1][1] - (S[1][0] ** 2) / S[0][0];
          mx += (h[j] / hs) * mk; ex2 += (h[j] / hs) * (vk + mk * mk);
        });
        const sd = Math.sqrt(Math.max(ex2 - mx * mx, 1e-9));
        ts.push(t); mean.push(mx); lo.push(mx - 2 * sd); hi.push(mx + 2 * sd);
      }
      g.band(ts, lo, hi, { color: 'purple', alpha: 0.25 });
      // demos
      for (const d of demos()) g.path(d, { color: alpha('teal', 0.8), width: 1.6 });
      for (const p of s.pts) g.dot(p, 2.6, { color: 'teal' });
      g.path(ts.map((t, i) => [t, mean[i]]), { color: 'blue', width: 4.5 });
      // the robot replays the blended motion
      const i = Math.min(90, Math.round(Math.min(1, s.gmrT) * 90));
      g.line([ts[i], lo[i]], [ts[i], hi[i]], { color: alpha('purple', 0.8), width: 3 });
      g.emoji('🦾', [ts[i], mean[i] + 0.38], 26);
      g.dot([ts[i], mean[i]], 6, { color: 'pink', ring: 'bg' });
      const v = g.view;
      g.arrow([v[0] + 0.3, v[1] + 0.3], [v[0] + 1.5, v[1] + 0.3], { color: 'muted', width: 2 });
      g.emoji('⏱️', [v[0] + 1.85, v[1] + 0.32], 16);
      miniPlot(stage.hud, s.ll.map((x) => x / s.pts.length), stage.portrait ? { w: 130, h: 64 } : {});
    }
  },
};
