// Trajectories: HOW the hand gets from A to B matters. Carry a cup of water —
// a jerky plan sloshes and spills it, a smooth plan keeps every drop.
import { C, alpha } from '../viz/palette.js';
import { planarFK, twoLinkIK } from '../core/kinematics.js';
import { cubic, quintic, trapezoid } from '../core/control.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const L = [1.4, 1.25];
const A = -1.35, B = 1.65, Y = 1.15, D = B - A;
const FLOOR = -0.17;
const GEFF = 30;                 // how strongly gravity holds the water flat (scaled for the picture)
const W0 = 2 * Math.PI * 1.4;    // slosh frequency
const ZETA = 0.12;
const R0 = 0.5, R1 = 1.1;        // rests at A and at B
const KINDS = ['jump', 'linear', 'cubic', 'quintic', 'trap'];
const ICONS = ['🦘', '📏', '〰️', '🧈', '⛰️'];

// One leg A→B of duration T: {q, qd, qdd} plus where infinite spikes sit.
function makeProfile(kind, T) {
  if (kind === 'jump') return { f: (t) => ({ q: t > 0 ? B : A, qd: 0, qdd: 0 }), spikesV: [0], spikesA: [0] };
  if (kind === 'linear') return { f: (t) => ({ q: A + D * clamp(t / T, 0, 1), qd: t > 0 && t < T ? D / T : 0, qdd: 0 }), spikesV: [], spikesA: [0, T] };
  if (kind === 'cubic') return { f: cubic(A, B, T), spikesV: [], spikesA: [] };
  if (kind === 'quintic') return { f: quintic(A, B, T), spikesV: [], spikesA: [] };
  const ta = T / 4, vmax = D / (T - ta), amax = vmax / ta;
  return { f: trapezoid(A, B, vmax, amax), spikesV: [], spikesA: [], vmax };
}

export default {
  eq: [
    [['x', 'pink'], '(t) from ', ['A', 'muted'], ' to ', ['B', 'gold'], ' in time ', ['T', 'ink'], ':   s = t / T'],
    ['🦘  ', ['x', 'pink'], ' jumps  ⇒  ', ['ẋ', 'purple'], ', ', ['ẍ', 'coral'], ' = ∞'],
    ['📏  ', ['x', 'pink'], ' = A + (B−A)s   ⇒  ', ['ẍ', 'coral'], ' = ∞ at the ends'],
    ['〰️  ', ['x', 'pink'], ' = A + (B−A)(3s² − 2s³)        ', ['ẋ', 'purple'], '(0) = ', ['ẋ', 'purple'], '(T) = 0'],
    ['🧈  ', ['x', 'pink'], ' = A + (B−A)(10s³ − 15s⁴ + 6s⁵)   ', ['ẋ', 'purple'], ' = ', ['ẍ', 'coral'], ' = 0 at both ends'],
    ['⛰️  ', ['ẋ', 'purple'], ' ≤ ', ['v_max', 'gold'], ',  |', ['ẍ', 'coral'], '| ≤ a_max   (speed up · cruise · slow down)'],
    ['💧  water surface tilts by  atan(', ['ẍ', 'coral'], ' / g)'],
  ],
  setup({ stage, ui }) {
    const [g, h] = stage.split([[-2.0, -0.75, 2.3, 2.75], [0, 0, 1, 1]], [1.25, 1]);
    const R = rng(11);
    const s = {
      kind: 'jump', T: 1.6, t: 0, prof: null,
      x: A, xp: A, vp: 0, a: 0, phi: 0, phid: 0, water: 1, drops: [], puddle: [], spilled: 0,
    };
    const build = () => { s.prof = makeProfile(s.kind, s.T); s.t = 0; s.x = s.xp = A; s.vp = 0; s.phi = s.phid = 0; s.water = 1; s.drops = []; s.puddle = []; };
    const cycle = () => R0 + s.T + R1 + s.T + R1;
    // hand position over one round trip
    const at = (t) => {
      const T = s.T, f = s.prof.f;
      if (t < R0) return { q: A, qd: 0, qdd: 0 };
      if (t < R0 + T) return f(t - R0);
      if (t < R0 + T + R1) return { q: B, qd: 0, qdd: 0 };
      if (t < R0 + 2 * T + R1) { const r = f(t - R0 - T - R1); return { q: A + B - r.q, qd: -r.qd, qdd: -r.qdd }; }
      return { q: A, qd: 0, qdd: 0 };
    };

    ui.beats(ICONS, (b) => { s.kind = KINDS[b]; build(); });
    ui.slider({ icon: '⏱️', color: 'ink', min: 0.7, max: 3, step: 0.05, value: s.T, title: 'duration', onInput: (v) => { s.T = v; build(); } });
    ui.readout(() => `${Math.round(s.water * 100)}%`, { icon: '💧', color: 'blue', title: 'water left' });
    ui.readout(() => fmt(Math.abs(s.a) > 999 ? Infinity : Math.abs(s.a), 1), { icon: '💥', color: 'coral', title: 'acceleration' });
    build();

    return {
      update(dt) {
        const n = 8, hh = dt / n;
        for (let k = 0; k < n; k++) {
          s.t += hh;
          if (s.t > cycle()) { s.t -= cycle(); }
          // refill at home
          if (s.t < R0) s.water = Math.min(1, s.water + hh * 1.2);
          const x = at(s.t).q;
          const v = (x - s.xp) / hh, a = (v - s.vp) / hh;
          s.xp = x; s.vp = v; s.a = a;
          s.x = x;
          // slosh: a damped pendulum pushed by the hand's acceleration
          s.phid += hh * (-W0 * W0 * (s.phi + a / GEFF) - 2 * ZETA * W0 * s.phid);
          s.phid = clamp(s.phid, -30, 30);
          s.phi = clamp(s.phi + hh * s.phid, -1.25, 1.25);
          const over = Math.abs(s.phi) - 0.32;
          if (over > 0 && s.water > 0.02) {
            const dw = Math.min(s.water, over * 1.6 * hh + (Math.abs(s.phi) > 1.2 ? 2 * hh : 0));
            s.water -= dw;
            s.spilled += dw * 60;
            while (s.spilled > 1 && s.drops.length < 160) {
              s.spilled -= 1;
              const side = s.phi > 0 ? 1 : -1;   // the low rim
              const cx = x + side * 0.2, cy = Y + 0.5;
              s.drops.push({ p: [cx, cy], v: [v * 0.6 + side * R.uniform(0.3, 1.6), R.uniform(0.2, 1.8)] });
            }
          }
        }
        // flying drops → puddle
        for (const d of s.drops) { d.v[1] -= 7 * dt; d.p[0] += d.v[0] * dt; d.p[1] += d.v[1] * dt; }
        const landed = s.drops.filter((d) => d.p[1] <= FLOOR);
        for (const d of landed) if (s.puddle.length < 240) s.puddle.push(d.p[0]);
        s.drops = s.drops.filter((d) => d.p[1] > FLOOR && Math.abs(d.p[0]) < 4);
      },
      draw() {
        g.grid({ step: 0.5 });
        // floor + puddle
        g.clip(() => {
          g.rect(-6, FLOOR - 3, 12, 3, { fill: alpha('slate', 0.18), stroke: false });
          g.line([-6, FLOOR], [6, FLOOR], { color: 'slate', width: 2 });
          for (const px of s.puddle) g.ellipse([px, FLOOR + 0.01], 0.09, 0.025, 0, { fill: alpha('blue', 0.35), stroke: false });
        });
        // rail from A to B
        g.line([A, Y], [B, Y], { color: alpha('muted', 0.5), width: 3, dash: [2, 7] });
        g.circle([A, Y], 0.1, { color: 'muted', width: 3 });
        g.circle([B, Y], 0.13, { color: 'gold', width: 3.5 });
        g.text('A', [A, Y - 0.3], { color: 'muted', size: 15 });
        g.text('B', [B, Y - 0.3], { color: 'gold', size: 15 });

        const q = twoLinkIK(L[0], L[1], s.x, Y, false) ?? [Math.atan2(Y, s.x), 0];
        const f = planarFK(L, q);
        g.arm(f.points, { width: 16, colors: ['slate', 'slate'] });
        drawCup(g, f.tip, s.water, s.phi);
        // speed & push arrows on the hand
        const v = at(s.t).qd;
        if (Math.abs(v) > 0.05) g.arrow([s.x, Y + 0.95], [s.x + v * 0.25, Y + 0.95], { color: 'purple', width: 4 });
        g.clip(() => { for (const d of s.drops) g.dot(d.p, 3.5, { color: alpha('blue', 0.8) }); });
        if (s.drops.length > 6) g.emoji('💦', [s.x + (s.phi > 0 ? 0.45 : -0.45), Y + 0.85], 26);

        drawPlots(h, s, at, cycle());
      },
    };
  },
};

// A glass with water whose surface tilts by phi.
function drawCup(g, base, level, phi) {
  const ctx = g.ctx;
  const bw = 0.17, tw = 0.23, H = 0.52;
  const pts = [[base[0] - bw, base[1]], [base[0] + bw, base[1]], [base[0] + tw, base[1] + H], [base[0] - tw, base[1] + H]].map((p) => g.toScreen(p));
  ctx.save();
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath();
  ctx.fillStyle = alpha('white', 0.25); ctx.fill();
  ctx.save(); ctx.clip();
  if (level > 0.005) {
    const c = g.toScreen([base[0], base[1] + H * 0.85 * level]);
    const k = g.px(1);
    ctx.translate(c[0], c[1]); ctx.rotate(-phi);
    ctx.fillStyle = alpha('blue', 0.6);
    ctx.fillRect(-k, 0, 2 * k, k);
    ctx.strokeStyle = alpha('white', 0.7); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-k, 0); ctx.lineTo(k, 0); ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(...pts[3]); ctx.lineTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2]); ctx.stroke();
  ctx.restore();
}

// Three stacked plots: x (pink), ẋ (purple), ẍ (coral), with a gold time cursor.
function drawPlots(h, s, at, Tc) {
  const ctx = h.ctx, Ar = h.area;
  const padL = 34, padR = 14, padT = 12, gap = 10;
  const ph = (Ar.h - padT * 2 - gap * 2) / 3;
  const x0 = Ar.x + padL, x1 = Ar.x + Ar.w - padR;
  const X = (t) => x0 + ((x1 - x0) * t) / Tc;
  const vm = (2.1 * D) / s.T, am = (7 * D) / (s.T * s.T);
  const rows = [
    { key: 'q', color: 'pink', sym: 'x', lo: A - 0.2, hi: B + 0.2 },
    { key: 'qd', color: 'purple', sym: 'ẋ', lo: -vm, hi: vm },
    { key: 'qdd', color: 'coral', sym: 'ẍ', lo: -am, hi: am },
  ];
  const T = s.T, legs = [[R0, 1], [R0 + T + R1, -1]];
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.55); ctx.fillRect(Ar.x, Ar.y, Ar.w, Ar.h);
  rows.forEach((r, i) => {
    const top = Ar.y + padT + i * (ph + gap), bot = top + ph;
    const Yv = (v) => bot - ((clamp(v, r.lo, r.hi) - r.lo) / (r.hi - r.lo)) * ph;
    ctx.fillStyle = alpha(r.color, 0.06); ctx.fillRect(x0, top, x1 - x0, ph);
    ctx.strokeStyle = alpha('muted', 0.5); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, Yv(i === 0 ? A : 0)); ctx.lineTo(x1, Yv(i === 0 ? A : 0)); ctx.stroke();
    ctx.font = '700 18px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C[r.color]; ctx.fillText(r.sym, Ar.x + padL / 2, top + ph / 2);
    if (i === 1 && s.prof.vmax) {
      ctx.strokeStyle = C.gold; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      for (const sg of [1, -1]) { ctx.beginPath(); ctx.moveTo(x0, Yv(sg * s.prof.vmax)); ctx.lineTo(x1, Yv(sg * s.prof.vmax)); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // curve
    ctx.strokeStyle = C[r.color]; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.beginPath();
    const N = 360;
    for (let k = 0; k <= N; k++) {
      const t = (Tc * k) / N, v = at(t)[r.key];
      const px = X(t), py = Yv(v);
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    // infinite spikes
    const spikes = i === 1 ? s.prof.spikesV : i === 2 ? s.prof.spikesA : [];
    for (const [t0, sg] of legs) for (const ts of spikes) {
      const dir = i === 2 && ts > 0 ? -sg : sg;
      const px = X(t0 + ts), y0 = Yv(0), y1 = dir > 0 ? top + 4 : bot - 4;
      ctx.strokeStyle = C[r.color]; ctx.fillStyle = C[r.color]; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, y1 - dir * 2); ctx.lineTo(px - 6, y1 + dir * 9); ctx.lineTo(px + 6, y1 + dir * 9); ctx.closePath(); ctx.fill();
      ctx.font = '700 14px ui-rounded, system-ui, sans-serif';
      ctx.fillText('∞', px + 12, y1 + dir * 8);
    }
  });
  // time cursor
  const cx = X(s.t);
  ctx.strokeStyle = C.gold; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cx, Ar.y + padT - 4); ctx.lineTo(cx, Ar.y + Ar.h - padT + 4); ctx.stroke();
  ctx.restore();
}
