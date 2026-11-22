// Forward kinematics: turn the joints → the hand goes somewhere.
// The hand's place is a chain of "turn, then slide" steps, one per link.
import { C, alpha, mix } from '../viz/palette.js';
import { planarFK, twoLinkIK } from '../core/kinematics.js';
import { rng, clamp, smoothstep, wrapAngle } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const L = [1.3, 1.0, 0.6];
const LIM = [Math.PI, 2.0, 2.0];                     // joint limits (links can't pass through each other)
const shade = (i) => [mix('orange', 'red', 0.35), C.orange, mix('orange', 'gold', 0.55)][i];
const SUB = ['₁', '₂', '₃'];

export default {
  eq: [
    [['p', 'pink'], ' = f(', ['θ₁', 'orange'], ', ', ['θ₂', 'orange'], ', ', ['θ₃', 'orange'], ')'],
    [['x', 'red'], ' = L₁cos ', ['θ₁', 'orange'], ' + L₂cos(', ['θ₁+θ₂', 'orange'], ') + L₃cos(', ['θ₁+θ₂+θ₃', 'orange'], ')'],
    [['y', 'green'], ' = L₁sin ', ['θ₁', 'orange'], ' + L₂sin(', ['θ₁+θ₂', 'orange'], ') + L₃sin(', ['θ₁+θ₂+θ₃', 'orange'], ')'],
    [['T', 'pink'], ' = ', ['R(θ₁)', 'orange'], ' ', ['Tx(L₁)', 'slate'], ' ', ['R(θ₂)', 'orange'], ' ', ['Tx(L₂)', 'slate'], ' ', ['R(θ₃)', 'orange'], ' ', ['Tx(L₃)', 'slate']],
    [['workspace', 'teal'], ' = { f(', ['θ', 'orange'], ') : ', ['θ', 'orange'], ' within limits }'],
    ['3 joints, 2 numbers to hit → a whole ', ['curve of θ', 'gold'], ' gives the same ', ['p', 'pink']],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-3.05, -3.05, 3.05, 3.05]);
    const R = rng(7);
    const s = {
      q: [0.55, 0.75, -0.6], beat: 0, t: 0, touched: false, trail: [],
      cloud: [], cloudN: 3200, inner: Infinity,
      target: [1.35, 1.05], phi: 0, sweep: 0,
    };
    const fk = () => planarFK(L, s.q);

    // ---- joint dial handles: grab the ring on a link and swing it around its joint ----
    const dialR = [0.5, 0.42, 0.34];
    const parentAngle = (i, f) => (i === 0 ? 0 : f.angles[i - 1]);
    const sliders = [];
    for (let i = 0; i < 3; i++) {
      stage.handle({
        pen: g, kind: 'ring', r: 10, color: 'orange',
        visible: () => s.beat !== 3,
        get: () => { const f = fk(); const a = f.angles[i]; return [f.points[i][0] + dialR[i] * Math.cos(a), f.points[i][1] + dialR[i] * Math.sin(a)]; },
        set: (p) => {
          const f = fk();
          const a = Math.atan2(p[1] - f.points[i][1], p[0] - f.points[i][0]);
          s.q[i] = clamp(wrapAngle(a - parentAngle(i, f)), -LIM[i], LIM[i]);
          sliders[i]?.set(s.q[i]);
          s.touched = true;
        },
      });
    }
    stage.handle({
      pen: g, color: 'gold', r: 12, icon: '🎯', visible: () => s.beat === 3,
      get: () => s.target,
      set: (p) => { const r = Math.hypot(...p), m = clamp(r, 0.35, 2.75); s.target = [p[0] * m / (r || 1), p[1] * m / (r || 1)]; },
    });

    const near = [-2.9, -1.75, 2.9, 3.0], far = [-3.05, -3.05, 3.05, 3.05];
    ui.beats(['🦾', '🔗', '🍩', '🔁'], (b) => { s.beat = b; s.t = 0; s.trail = []; g.setBounds(b === 2 ? far : near); });
    g.setBounds(near);
    const grp = ui.group();
    for (let i = 0; i < 3; i++) {
      sliders.push(ui.slider({
        into: grp, icon: ['1️⃣', '2️⃣', '3️⃣'][i], color: shade(i), min: -LIM[i], max: LIM[i], step: 0.01, value: s.q[i],
        title: `joint ${i + 1}`, onInput: (v) => { s.q[i] = v; s.touched = true; },
      }));
    }
    ui.button({ icon: '🏠', title: 'straight', onClick: () => { s.q = [0, 0, 0]; s.touched = true; sliders.forEach((x) => x.set(0)); } });
    ui.button({ icon: '🎲', title: 'random pose', onClick: () => {
      s.q = s.q.map((_, i) => R.uniform(-LIM[i], LIM[i]) * 0.8); s.touched = true; sliders.forEach((x, i) => x.set(s.q[i]));
    } });
    ui.readout(() => { const p = fk().tip; return `${fmt(p[0], 2)}, ${fmt(p[1], 2)}`; }, { icon: '🖐️', color: 'pink', title: 'hand position' });

    // feasible hand headings φ that still let the 3-link arm reach the target (beat 4)
    const feasible = () => {
      const ok = [];
      for (let k = 0; k < 360; k++) {
        const ph = (k / 360) * 2 * Math.PI;
        const w = [s.target[0] - L[2] * Math.cos(ph), s.target[1] - L[2] * Math.sin(ph)];
        const r = Math.hypot(...w);
        ok.push(r > Math.abs(L[0] - L[1]) + 0.02 && r < L[0] + L[1] - 0.02);
      }
      // longest circular run of feasible headings
      let best = [0, 0], start = -1;
      for (let k = 0; k < 720; k++) {
        if (ok[k % 360]) { if (start < 0) start = k; if (k - start + 1 > best[1] - best[0] && k - start < 360) best = [start, k + 1]; }
        else start = -1;
      }
      return best.map((k) => (k / 360) * 2 * Math.PI);
    };
    const solveAt = (ph) => {
      const w = [s.target[0] - L[2] * Math.cos(ph), s.target[1] - L[2] * Math.sin(ph)];
      const qq = twoLinkIK(L[0], L[1], w[0], w[1], true);
      if (!qq) return null;
      return [qq[0], qq[1], wrapAngle(ph - qq[0] - qq[1])];
    };

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 0 && !s.touched) {
          // gentle dance until somebody grabs a joint
          s.q = [0.55 + 0.5 * Math.sin(s.t * 0.9), 0.75 + 0.6 * Math.sin(s.t * 1.3 + 1), -0.6 + 0.8 * Math.sin(s.t * 1.7 + 2)];
          sliders.forEach((x, i) => x.set(s.q[i]));
        }
        if (s.beat === 0) {
          s.trail.push(fk().tip);
          if (s.trail.length > 90) s.trail.shift();
        }
        if (s.beat === 2) {
          for (let k = 0; k < 60 && s.cloud.length < s.cloudN; k++) {
            const qq = [R.uniform(-LIM[0], LIM[0]), R.uniform(-LIM[1], LIM[1]), R.uniform(-LIM[2], LIM[2])];
            const p = planarFK(L, qq).tip;
            s.cloud.push(p);
            s.inner = Math.min(s.inner, Math.hypot(...p));
          }
        }
        if (s.beat === 3) {
          const [a0, a1] = feasible();
          s.range = [a0, a1];
          const u = smoothstep((1 - Math.cos(s.t * 0.9)) / 2);
          s.phi = a0 + (a1 - a0) * (0.06 + 0.88 * u);
          const qq = solveAt(s.phi);
          if (qq) { s.q = qq; sliders.forEach((x, i) => x.set(clamp(qq[i], -LIM[i], LIM[i]))); }
        }
      },
      draw() {
        g.grid({ step: 0.5 });
        const f = fk();
        const P = f.points;

        if (s.beat === 2) drawCloud(g, s);
        if (s.beat === 3) drawRedundancy(g, stage.hud, s, solveAt);

        // joint dials: how far each joint has turned from its parent link
        if (s.beat !== 3) {
          for (let i = 0; i < 3; i++) {
            const pa = parentAngle(i, f), a = f.angles[i];
            const c = P[i], r = dialR[i];
            g.arc(c, r, pa - LIM[i], pa + LIM[i], { color: alpha(shade(i), 0.2), width: 5 });
            g.line(c, [c[0] + Math.cos(pa) * r * 1.15, c[1] + Math.sin(pa) * r * 1.15], { color: alpha('muted', 0.6), width: 1.5, dash: [3, 4] });
            g.wedge(c, r * 0.8, pa, a, { color: shade(i), alpha: 0.28 });
            g.arc(c, r * 0.8, pa, a, { color: shade(i), width: 3 });
          }
        }

        if (s.beat === 0 && s.trail.length > 1) {
          for (let k = 1; k < s.trail.length; k++) g.line(s.trail[k - 1], s.trail[k], { color: alpha('pink', (k / s.trail.length) * 0.8), width: 4 });
        }

        if (s.beat === 1) drawChain(g, stage.hud, s, f);
        else {
          g.arm(P, { width: 18, colors: ['slate', 'slate', 'slate'] });
          for (let i = 0; i < 3; i++) g.dot(P[i], 7, { color: shade(i), ring: 'bg' });
          drawHand(g, f.tip, f.heading, 30);
        }
        if (s.beat === 2) g.dot(f.tip, 6, { color: 'pink', ring: 'bg' });
      },
    };
  },
};

function drawHand(g, p, heading, size) {
  const ctx = g.ctx, sp = g.toScreen(p);
  ctx.save();
  ctx.translate(sp[0], sp[1]);
  ctx.rotate(-heading + Math.PI / 2);
  ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🖐️', 0, -size * 0.45);
  ctx.restore();
}

// ---- beat 2: chain of turn/slide steps, animated as a frame walking out the arm ----
function drawChain(g, hud, s, f) {
  const P = f.points;
  const STEP = 1.0, HOLD = 1.6, n = 6;
  const T = s.t % (n * STEP + HOLD);
  const k = Math.min(n, Math.floor(T / STEP)), u = k < n ? smoothstep((T - k * STEP) / (STEP * 0.8)) : 1;
  // walk: frame angle a and origin o after step k (partially u)
  let a = 0, o = [0, 0];
  for (let j = 0; j < n; j++) {
    const i = j >> 1, frac = j < k ? 1 : j === k ? u : 0;
    if (j % 2 === 0) a += s.q[i] * frac;
    else o = [o[0] + L[i] * frac * Math.cos(a), o[1] + L[i] * frac * Math.sin(a)];
  }
  // ghost arm and every link frame
  g.arm(P, { width: 18, colors: ['slate', 'slate', 'slate'], alpha: 0.28, hand: false });
  for (let i = 0; i <= 3; i++) g.frame(P[i], i === 3 ? f.heading : f.angles[i], 0.38, { width: 2, dot: 3, xColor: alpha('red', 0.45), yColor: alpha('green', 0.45), color: alpha('ink', 0.4) });
  // the part already built
  const built = [[0, 0]];
  for (let i = 0; i < 3; i++) if (2 * i + 1 < k) built.push(P[i + 1]);
  if (built.length > 1) g.arm(built, { width: 18, colors: ['slate', 'slate', 'slate'], hand: false, base: false });
  if (k < n && k % 2 === 1) {
    const i = k >> 1;
    g.line(P[i], o, { color: 'slate', width: 18, alpha: 0.9 });
  }
  // the rotation / slide happening now
  if (k < n) {
    const i = k >> 1;
    if (k % 2 === 0) {
      const pa = i === 0 ? 0 : f.angles[i - 1];
      g.wedge(P[i], 0.55, pa, a, { color: shade(i), alpha: 0.35 });
      g.arc(P[i], 0.55, pa, a, { color: shade(i), width: 4 });
    } else {
      g.line(P[i], o, { color: 'ink', width: 3, dash: [6, 5] });
    }
  }
  for (let i = 0; i < 3; i++) g.dot(P[i], 7, { color: shade(i), ring: 'bg' });
  g.frame(o, a, 0.6, { width: 5, dot: 6 });
  if (k === n) drawHand(g, f.tip, f.heading, 30);

  // HUD: the product of turns and slides, active tile glowing
  const ctx = hud.ctx, W = hud.area.w;
  const tw = Math.min(64, (W - 40) / 7.4), th = 46, gap = 4;
  const total = n * (tw + gap) + tw * 0.9;
  let x = Math.max(10, (W - total) / 2);
  const y = 12;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(x - 8, y - 6, total + 14, th + 12, 12); ctx.fill();
  for (let j = 0; j < n; j++) {
    const i = j >> 1, rot = j % 2 === 0, active = j === k, done = j < k;
    const colr = rot ? shade(i) : C.slate;
    ctx.fillStyle = alpha(colr, active ? 0.45 : done ? 0.2 : 0.07);
    ctx.strokeStyle = colr; ctx.lineWidth = active ? 3 : 1.2;
    ctx.beginPath(); ctx.roundRect(x, y, tw, th, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rot ? colr : C.ink;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(tw * 0.27)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillText(rot ? `⟲θ${SUB[i]}` : `→L${SUB[i]}`, x + tw / 2, y + th * 0.32);
    ctx.font = `600 ${Math.round(tw * 0.24)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillText(rot ? `${Math.round(s.q[i] * 180 / Math.PI)}°` : fmt(L[i], 1), x + tw / 2, y + th * 0.72);
    x += tw + gap;
  }
  ctx.font = `${Math.round(tw * 0.5)}px system-ui, "Apple Color Emoji", sans-serif`;
  ctx.globalAlpha = k === n ? 1 : 0.35;
  ctx.fillText('=🖐️', x + tw * 0.4, y + th / 2);
  ctx.restore();
}

// ---- beat 3: every hand spot the arm can ever reach ----
function drawCloud(g, s) {
  const ctx = g.ctx;
  ctx.save();
  ctx.fillStyle = alpha('teal', 0.45);
  ctx.beginPath();
  for (const p of s.cloud) { const q = g.toScreen(p); ctx.moveTo(q[0] + 2, q[1]); ctx.arc(q[0], q[1], 2, 0, Math.PI * 2); }
  ctx.fill();
  ctx.restore();
  const R = L[0] + L[1] + L[2];
  g.circle([0, 0], R, { color: alpha('teal', 0.8), width: 2, dash: [8, 6] });
  if (s.cloud.length > 300) g.circle([0, 0], s.inner, { color: alpha('teal', 0.8), width: 2, dash: [8, 6] });
  // a fast "sweeper" arm painting the cloud
  const t = s.t;
  const qq = [Math.PI * Math.sin(t * 0.53), LIM[1] * Math.sin(t * 1.37 + 0.4), LIM[2] * Math.sin(t * 2.11 + 1.1)];
  const f = planarFK(L, qq);
  g.arm(f.points, { width: 10, colors: ['teal', 'teal', 'teal'], alpha: 0.3, base: false, jointColor: 'teal', handColor: 'teal' });
}

// ---- beat 4: many joint settings, one hand spot ----
function drawRedundancy(g, hud, s, solveAt) {
  const [a0, a1] = s.range ?? [0, 0];
  const ghosts = [0.12, 0.5, 0.88].map((u) => solveAt(a0 + (a1 - a0) * u)).filter(Boolean);
  const gcol = ['teal', 'purple', 'blue'];
  ghosts.forEach((qq, k) => {
    const f = planarFK(L, qq);
    g.arm(f.points, { width: 12, colors: [gcol[k], gcol[k], gcol[k]], alpha: 0.42, base: false, hand: false, jointColor: gcol[k] });
  });
  // the path the wrist slides along while the hand stays put
  const pts = [];
  for (let k = 0; k <= 60; k++) { const ph = a0 + ((a1 - a0) * k) / 60; pts.push([s.target[0] - L[2] * Math.cos(ph), s.target[1] - L[2] * Math.sin(ph)]); }
  g.path(pts, { color: alpha('gold', 0.7), width: 3, dash: [5, 5] });
  g.circle(s.target, 0.16, { color: 'gold', width: 3 });

  // HUD: three different orange triples → one pink spot
  const ctx = hud.ctx;
  const rows = ghosts.length, rh = 30, W = 250;
  const X = hud.area.w - W - 14, Y = 14;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(X, Y, W, rows * rh + 14, 12); ctx.fill();
  ctx.textBaseline = 'middle';
  ghosts.forEach((qq, k) => {
    const y = Y + 7 + rh * (k + 0.5);
    ctx.fillStyle = C[gcol[k]];
    ctx.beginPath(); ctx.roundRect(X + 10, y - 4, 16, 8, 4); ctx.fill();
    ctx.font = '700 15px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'right';
    qq.forEach((v, i) => { ctx.fillStyle = shade(i); ctx.fillText(`${Math.round(v * 180 / Math.PI)}°`, X + 78 + i * 52, y); });
    ctx.font = '18px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = C.ink;
    ctx.fillText('→🖐️', X + W - 30, y);
  });
  ctx.restore();
}
