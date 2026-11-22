// Particle filter: instead of one guess, keep hundreds of little "maybe I'm here"
// dots. When the robot sees something, dots that agree get BIG, the others shrink;
// then we redraw the crowd from the big ones. The crowd walks to the truth.
import { alpha } from '../viz/palette.js';
import { systematicResample, effectiveSampleSize } from '../core/estimation.js';
import { rng, clamp, smoothstep, wrapAngle } from '../core/random.js';
import { fmt } from '../viz/ui.js';

// ---------------------------------------------------------------- 1D hallway
const HALL = 20, DOORS = [2.5, 5.6, 13.2];
const nearDoor = (x) => DOORS.some((d) => Math.abs(((x - d + HALL * 1.5) % HALL) - HALL / 2) < 0.55);
const pDoor = (x) => (nearDoor(x) ? 0.85 : 0.08);              // p(see a door | standing at x)
const wrap = (x) => ((x % HALL) + HALL) % HALL;

// ---------------------------------------------------------------- 2D room
const RW = 10, RH = 7;
const SEGS = [
  [[0, 0], [RW, 0]], [[RW, 0], [RW, RH]], [[RW, RH], [0, RH]], [[0, RH], [0, 0]],
  [[3.6, 0], [3.6, 2.6]], [[3.6, 4.0], [3.6, RH]],           // wall with a doorway
  [[6.2, 4.6], [RW, 4.6]],                                   // shelf on the right
  [[6.6, 1.2], [7.8, 1.2]], [[7.8, 1.2], [7.8, 2.2]], [[7.8, 2.2], [6.6, 2.2]], [[6.6, 2.2], [6.6, 1.2]], // box
  [[1.0, 5.2], [2.2, 5.2]], [[2.2, 5.2], [2.2, 6.0]], [[2.2, 6.0], [1.0, 6.0]], [[1.0, 6.0], [1.0, 5.2]], // table
];
const BEAMS = [-Math.PI * 0.75, -Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, Math.PI * 0.75, Math.PI];
const ZMAX = 6, ZSIG = 0.35;
function castRay(x, y, a) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best = ZMAX;
  for (const [[x1, y1], [x2, y2]] of SEGS) {
    const ex = x2 - x1, ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((x1 - x) * ey - (y1 - y) * ex) / den;
    const u = ((x1 - x) * dy - (y1 - y) * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}
function clearance(x, y) {
  let best = Infinity;
  for (const [[x1, y1], [x2, y2]] of SEGS) {
    const ex = x2 - x1, ey = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * ex + (y - y1) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(x - x1 - ex * t, y - y1 - ey * t));
  }
  return best;
}
const inBox = (x, y) => (x > 6.6 && x < 7.8 && y > 1.2 && y < 2.2) || (x > 1.0 && x < 2.2 && y > 5.2 && y < 6.0);
const freeSpot = (r) => { for (;;) { const x = r.uniform(0.3, RW - 0.3), y = r.uniform(0.3, RH - 0.3); if (!inBox(x, y) && Math.abs(x - 3.6) > 0.25 && !(x > 6.2 && Math.abs(y - 4.6) < 0.25)) return [x, y, r.uniform(-Math.PI, Math.PI)]; } };

export default {
  eq: [
    ['belief = a crowd of ', ['particles', 'blue'], '  xᵢ  with weights  wᵢ'],
    ['move:     xᵢ ← f(xᵢ, ', ['u', 'orange'], ') + ', ['noise', 'purple']],
    ['sense:    wᵢ ∝ p(', ['z', 'teal'], ' | xᵢ)          (big dot = agrees with the sensor)'],
    ['resample: draw N new ', ['particles', 'blue'], ' ∝ wᵢ        ', ['N_eff', 'gold'], ' = (Σwᵢ)² / Σwᵢ²'],
    ['kidnapped? inject random ', ['particles', 'blue'], ' when p(', ['z', 'teal'], ') suddenly drops (w_fast / w_slow)'],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait;
    const g = stage.g;
    const B1 = tall ? [-0.4, -6.5, HALL + 0.4, 6.0] : [-0.4, -3.4, HALL + 0.4, 4.6];
    const B2 = tall ? [-0.3, -4.2, RW + 0.3, RH + 0.3] : [-0.3, -0.3, RW + 3.2, RH + 0.3];
    const r = rng(21);
    const s = { beat: 0, phase: 'move', ph: 0, n1: 300, n2: 600, inject: true, fast: 0, slow: 0, ess: 1, flash: 0, kid: 0 };

    // ---------- 1D state
    const reset1 = () => {
      s.x = 0.8; s.P = Array.from({ length: s.n1 }, () => r.uniform(0, HALL)); s.W = new Array(s.n1).fill(1);
      s.jit = Array.from({ length: s.n1 }, () => r()); s.phase = 'move'; s.ph = 0; s.prev = null; s.z = null; s.ess = s.n1;
    };
    // ---------- 2D state
    const reset2 = (keepRobot = false) => {
      if (!keepRobot) s.rb = [1.6, 1.6, 0.3];
      s.Q = Array.from({ length: s.n2 }, () => freeSpot(r)); s.QW = new Array(s.n2).fill(1 / s.n2);
      s.acc = 0; s.zr = BEAMS.map((b) => castRay(s.rb[0], s.rb[1], s.rb[2] + b)); s.ess = s.n2; s.fast = 0; s.slow = 0;
    };

    ui.beats(['🚪', '🗺️', '🫳'], (b) => {
      s.beat = b; g.setBounds(b === 0 ? B1 : B2);
      if (b === 0) reset1(); else reset2();
      s.inject = b === 2; injT.set(s.inject, false);
      if (b === 2) s.kidT = 6;
    });
    ui.button({ icon: '🫳', title: 'kidnap the robot', onClick: () => kidnap() });
    const injT = ui.toggle({ icon: '✨', title: 'sprinkle random particles', value: false, color: 'blue', onChange: (v) => (s.inject = v) });
    ui.button({ icon: '🌪️', title: 'scatter all particles', onClick: () => { if (s.beat === 0) reset1(); else reset2(true); } });
    ui.readout(() => `${fmt(100 * s.ess / (s.beat === 0 ? s.n1 : s.n2), 0)}%`, { icon: '⚖️', color: 'gold', title: 'effective sample size' });

    function kidnap() {
      if (s.beat === 0) { s.x = wrap(s.x + r.uniform(6, 14)); s.kid = 1.2; return; }
      let p;
      do { p = freeSpot(r); } while (Math.hypot(p[0] - s.rb[0], p[1] - s.rb[1]) < 4);
      s.rb = p; s.kid = 1.2;
    }
    g.setBounds(B1);
    reset1();

    // ---------------------------------------------------------------- 1D steps
    function step1(dt) {
      s.ph += dt;
      if (s.phase === 'move') {
        const u = 1.25 * dt;
        s.x = wrap(s.x + u);
        s.P = s.P.map((p) => wrap(p + u + r.normal(0, 0.12 * Math.sqrt(dt))));
        if (s.ph > 1.3) {
          s.phase = 'sense'; s.ph = 0;
          s.z = r() < pDoor(s.x);                           // does the robot see a door?
          s.W = s.P.map((p) => (s.z ? pDoor(p) : 1 - pDoor(p)));
          s.ess = effectiveSampleSize(s.W);
        }
      } else if (s.phase === 'sense' && s.ph > 1.0) {
        s.phase = 'resample'; s.ph = 0; s.prev = s.P;
        const idx = systematicResample(s.P.map((_, i) => i), s.W, r);
        s.from = idx.map((i) => s.P[i]);
        s.P = s.from.map((p) => wrap(p + r.normal(0, 0.05)));
        if (s.inject) s.P = s.P.map((p) => (r() < 0.03 ? r.uniform(0, HALL) : p));
        s.srcIdx = idx;
        s.W = new Array(s.n1).fill(1);
      } else if (s.phase === 'resample' && s.ph > 0.7) {
        s.phase = 'move'; s.ph = 0; s.z = null; s.ess = s.n1;
      }
    }

    // ---------------------------------------------------------------- 2D steps
    function step2(dt) {
      // the real robot wanders and turns away from walls (using its true ranges)
      const front = castRay(s.rb[0], s.rb[1], s.rb[2]);
      const left = castRay(s.rb[0], s.rb[1], s.rb[2] + 0.7), right = castRay(s.rb[0], s.rb[1], s.rb[2] - 0.7);
      const v = front < 0.55 ? 0 : front < 1.0 ? 0.3 : 0.95;
      if (front < 1.4 && !s.turn) s.turn = left > right ? 2.4 : -2.4;
      if (front > 1.6) s.turn = 0;
      const w = s.turn || r.normal(0, 0.6);
      const dd = v * dt, dth = w * dt;
      const nx = s.rb[0] + Math.cos(s.rb[2]) * dd, ny = s.rb[1] + Math.sin(s.rb[2]) * dd;
      const ok = clearance(nx, ny) > 0.3 || clearance(nx, ny) > clearance(s.rb[0], s.rb[1]);
      s.rb = ok ? [nx, ny, wrapAngle(s.rb[2] + dth)] : [s.rb[0], s.rb[1], wrapAngle(s.rb[2] + (s.turn || 2.4) * dt)];
      // particles move with the same odometry + noise
      s.Q = s.Q.map((q) => {
        const d = dd + r.normal(0, 0.08 * Math.sqrt(dt) + 0.1 * dd), th = q[2] + dth + r.normal(0, 0.12 * Math.sqrt(dt));
        return [clamp(q[0] + Math.cos(th) * d, 0.05, RW - 0.05), clamp(q[1] + Math.sin(th) * d, 0.05, RH - 0.05), th];
      });
      s.acc += dt; s.kid = Math.max(0, s.kid - dt); s.flash = Math.max(0, s.flash - dt);
      if (s.beat === 2) { s.kidT -= dt; if (s.kidT < 0) { kidnap(); s.kidT = 14; } }
      if (s.acc < 0.4) return;
      s.acc = 0;
      // sense: 8 noisy ranges
      s.zn = BEAMS.map(() => r.normal(0, ZSIG * 0.3));
      s.zr = BEAMS.map((b, k) => Math.min(ZMAX, castRay(s.rb[0], s.rb[1], s.rb[2] + b) + s.zn[k]));
      const logw = s.Q.map((q) => {
        let lw = 0;
        for (let k = 0; k < BEAMS.length; k++) {
          const e = castRay(q[0], q[1], q[2] + BEAMS[k]) - s.zr[k];
          lw += Math.log(0.92 * Math.exp(-0.5 * (e / ZSIG) ** 2) + 0.08 * 0.05);   // Gaussian + a little "junk reading" floor
        }
        return lw + (inBox(q[0], q[1]) ? -30 : 0);
      });
      const mx = Math.max(...logw);
      const wts = logw.map((l, i) => s.QW[i] * Math.exp(l - mx));
      const avg = Math.exp(mx) * wts.reduce((a, b) => a + b, 0);  // average likelihood (for kidnap detection)
      s.slow = s.slow ? s.slow + 0.06 * (avg - s.slow) : avg;
      s.fast = s.fast ? s.fast + 0.6 * (avg - s.fast) : avg;
      const sum = wts.reduce((a, b) => a + b, 0) || 1;
      s.QW = wts.map((w2) => w2 / sum);
      s.ess = effectiveSampleSize(s.QW);
      if (s.ess < s.n2 * 0.5) {
        const pInj = s.inject ? Math.max(0, Math.min(0.25, 1 - s.fast / s.slow)) + 0.01 : 0;
        s.Q = systematicResample(s.Q, s.QW, r).map((q) => (r() < pInj ? freeSpot(r) : q));
        s.QW = new Array(s.n2).fill(1 / s.n2);
        s.flash = 0.35;
        s.ess = s.n2;
        s.lastInj = pInj;
      }
    }

    return {
      update(dt) {
        dt = Math.max(0, Math.min(dt, 0.05));
        if (s.beat === 0) step1(dt); else step2(dt);
      },
      draw() { if (s.beat === 0) draw1(); else draw2(); },
    };

    // ---------------------------------------------------------------- drawing
    function draw1() {
      const yW0 = 0.35, yW1 = 2.4;
      // belief histogram (probability mass) on top
      const nb = 40, bins = new Array(nb).fill(0);
      const wsum = s.W.reduce((a, b) => a + b, 0);
      s.P.forEach((p, i) => { bins[Math.min(nb - 1, Math.floor(p / HALL * nb))] += s.W[i] / wsum; });
      const top = tall ? 5.6 : 4.4, base = yW1 + 0.25;
      const hmax = Math.max(0.12, ...bins);
      bins.forEach((b, k) => g.bar((k / nb) * HALL + 0.03, base, HALL / nb - 0.06, (b / hmax) * (top - base) * 0.92, { color: alpha('purple', 0.7) }));
      // the hallway wall with doors
      g.rect(0, yW0, HALL, yW1 - yW0, { fill: alpha('slate', 0.22), stroke: false });
      for (const d of DOORS) {
        g.rect(d - 0.55, yW0, 1.1, 1.75, { fill: alpha('orange', 0.28), color: alpha('orange', 0.8), width: 2 });
        g.emoji('🚪', [d, yW0 + 0.9], Math.min(46, g.px(1.5)));
      }
      g.line([0, 0], [HALL, 0], { color: 'muted', width: 2 });
      // robot (truth)
      if (s.phase === 'sense') {
        g.circle([s.x, 0.8], 0.55 + 0.25 * Math.sin(s.ph * 10), { color: alpha('teal', 0.8), width: 3 });
        g.text(s.z ? '🚪' : '🧱', [s.x, tall ? 3.3 : 2.95], { size: 26 });
        g.text(s.z ? '✓' : '✗', [s.x + 0.65, tall ? 3.6 : 3.25], { size: 20, color: 'teal' });
      }
      g.emoji('🤖', [s.x, 0.62], Math.min(40, g.px(1.2)));
      g.dot([s.x, -0.12], 5, { color: 'lime' });
      if (s.kid > 0) g.emoji('🫳', [s.x, 2.1], 30);
      // particles (dot size = weight)
      const rows = tall ? 5.4 : 2.6;
      const wmax = Math.max(...s.W);
      const k = s.phase === 'resample' ? smoothstep(s.ph / 0.5) : 1;
      s.P.forEach((p, i) => {
        let x = p;
        if (s.phase === 'resample' && s.from) {
          // fly from the parent particle to the new one
          const a = s.prev[s.srcIdx[i]];
          let d = p - a; if (d > HALL / 2) d -= HALL; if (d < -HALL / 2) d += HALL;
          x = wrap(a + d * k);
        }
        const y = -0.45 - s.jit[i] * rows;
        const w = s.W[i] / wmax;
        const rad = s.phase === 'sense' ? 1.2 + 5.5 * Math.sqrt(w) * smoothstep(s.ph / 0.4) + 2.5 * (1 - smoothstep(s.ph / 0.4)) : 3;
        g.dot([x, y], rad, { color: alpha('blue', s.phase === 'sense' ? 0.35 + 0.6 * w : 0.75) });
      });
      g.meter('⚖️', s.ess, s.n1, { color: 'gold', slot: 0, width: 130 });
    }

    function draw2() {
      g.rect(0, 0, RW, RH, { fill: alpha('panel', 0.6), stroke: false });
      for (const [a, b] of SEGS) g.line(a, b, { color: 'slate', width: 5 });
      g.rect(6.6, 1.2, 1.2, 1.0, { fill: alpha('slate', 0.5), stroke: false });
      g.rect(1.0, 5.2, 1.2, 0.8, { fill: alpha('slate', 0.5), stroke: false });
      // particles
      const wmax = Math.max(...s.QW);
      const ln = g.world(7);
      s.Q.forEach((q, i) => {
        const w = s.QW[i] / wmax;
        const a = 0.25 + 0.65 * w;
        g.line([q[0], q[1]], [q[0] + Math.cos(q[2]) * ln, q[1] + Math.sin(q[2]) * ln], { color: alpha('blue', a), width: 1.2 });
        g.dot([q[0], q[1]], 1.4 + 2.4 * Math.sqrt(w), { color: alpha('blue', a) });
      });
      // sensor beams (measured ranges)
      BEAMS.forEach((b, k) => {
        const a = s.rb[2] + b;
        const z = Math.min(ZMAX, castRay(s.rb[0], s.rb[1], a) + (s.zn ? s.zn[k] : 0));
        const tip = [s.rb[0] + Math.cos(a) * z, s.rb[1] + Math.sin(a) * z];
        g.line([s.rb[0], s.rb[1]], tip, { color: alpha('teal', 0.65), width: 1.6 });
        if (z < ZMAX) g.dot(tip, 3.5, { color: 'teal' });
      });
      // robot (truth)
      g.circle([s.rb[0], s.rb[1]], 0.26, { fill: alpha('lime', 0.3), color: 'lime', width: 3 });
      g.line([s.rb[0], s.rb[1]], [s.rb[0] + Math.cos(s.rb[2]) * 0.4, s.rb[1] + Math.sin(s.rb[2]) * 0.4], { color: 'lime', width: 3 });
      g.emoji('🤖', [s.rb[0], s.rb[1] + 0.55], 22);
      if (s.kid > 0) g.emoji('🫳', [s.rb[0], s.rb[1] + 1.2], 32 + 8 * s.kid);
      if (s.flash > 0) g.rect(0, 0, RW, RH, { color: alpha('gold', s.flash * 2), width: 6 });
      // meters: effective sample size + (beat 3) how surprised the sensor is
      const mx = tall ? 0.4 : RW + 0.4, my = tall ? -1.0 : RH - 0.6;
      barMeter([mx, my], '⚖️', s.ess / s.n2, 'gold');
      if (s.beat === 2) {
        const ratio = s.slow ? clamp(s.fast / s.slow, 0, 1.5) / 1.5 : 1;
        barMeter([mx, my - (tall ? 1.0 : 1.0)], '😲', 1 - ratio, 'coral');
        barMeter([mx, my - 2.0], '✨', s.inject ? Math.min(1, (s.lastInj ?? 0) * 4) : 0, 'blue');
      }
    }
    function barMeter(p, icon, v, color) {
      const w = tall ? RW - 1.4 : 2.3, h = 0.32;
      g.emoji(icon, [p[0] + 0.25, p[1] + h / 2], 18);
      g.rrect(p[0] + 0.6, p[1], w, h, 6, { fill: alpha('faint', 0.6), stroke: false });
      g.rrect(p[0] + 0.6, p[1], Math.max(0.05, w * clamp(v, 0, 1)), h, 6, { fill: color, stroke: false });
    }
  },
};
