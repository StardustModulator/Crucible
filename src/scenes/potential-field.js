// Potential field: the goal is a valley, obstacles are hills, the robot is a
// marble that rolls downhill (ẋ = −∇U). Sometimes the marble gets stuck in a
// little dip that is NOT the goal — a local minimum.
import { C, alpha, mix } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { potentialField } from '../core/planning.js';
import { rng, clamp } from '../core/random.js';

const B = [-5.2, -3.3, 5.2, 3.3];
const LAYOUTS = {
  open: [{ c: [-1.4, 1.0], r: 0.75 }, { c: [0.8, -0.9], r: 0.6 }, { c: [1.9, 1.5], r: 0.5 }],
  // a cup opening toward the robot: the marble rolls in and cannot get out
  trap: [{ c: [1.0, -1.05], r: 0.48 }, { c: [1.0, 0], r: 0.48 }, { c: [1.0, 1.05], r: 0.48 }, { c: [0.15, 1.45], r: 0.48 }, { c: [0.15, -1.45], r: 0.48 }],
};

const hexRGB = (c) => { const h = c.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// Marching squares: iso-lines of a sampled field.
function contourSegs(vals, nx, ny, [x0, y0, x1, y1], levels) {
  const segs = [];
  const X = (i) => x0 + (i / (nx - 1)) * (x1 - x0), Y = (j) => y0 + (j / (ny - 1)) * (y1 - y0);
  for (const L of levels)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const v = [vals[j * nx + i], vals[j * nx + i + 1], vals[(j + 1) * nx + i + 1], vals[(j + 1) * nx + i]];
        const P = [[X(i), Y(j)], [X(i + 1), Y(j)], [X(i + 1), Y(j + 1)], [X(i), Y(j + 1)]];
        const pts = [];
        for (let e = 0; e < 4; e++) {
          const a = v[e], b = v[(e + 1) % 4];
          if ((a - L) * (b - L) < 0) {
            const t = (L - a) / (b - a), A = P[e], Bp = P[(e + 1) % 4];
            pts.push([A[0] + (Bp[0] - A[0]) * t, A[1] + (Bp[1] - A[1]) * t]);
          }
        }
        if (pts.length >= 2) segs.push([pts[0], pts[1]]);
        if (pts.length === 4) segs.push([pts[2], pts[3]]);
      }
  return segs;
}

export default {
  eq: [
    [['U', 'ink'], '(x) = ½', ['k', 'gold'], '‖x − ', ['x🎯', 'gold'], '‖²  +  Σ ½', ['η', 'coral'], '(1/', ['ρ', 'slate'], ' − 1/ρ₀)²'],
    [['ẋ', 'pink'], ' = −∇', ['U', 'ink'], ' = ', ['F🧲', 'gold'], ' + ', ['F🧱', 'coral']],
    ['∇', ['U', 'ink'], ' = 0  but  x ≠ ', ['x🎯', 'gold'], '  →  ', ['local min', 'coral']],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds(B);
    const rand = rng(7);
    const s = {
      beat: 0, goal: [3.6, 0.2], start: [-4.2, -1.6], robot: [-4.2, -1.6], trail: [],
      obs: LAYOUTS.open.map((o) => ({ c: o.c.slice(), r: o.r })),
      katt: 1, krep: 0.6, held: false, still: 0, arrived: 0, t: 0, marbles: [], ver: 0,
    };
    const active = () => (s.beat === 0 ? [] : s.obs);
    const params = () => ({ katt: s.katt, krep: s.krep, rho0: 1.1, dstar: 2 });
    let field = potentialField(s.goal, active(), params());
    let attOnly = potentialField(s.goal, [], params());
    const rebuild = () => { field = potentialField(s.goal, active(), params()); attOnly = potentialField(s.goal, [], params()); s.ver++; s.still = 0; };
    const respawn = () => { s.robot = s.start.slice(); s.trail = [s.robot.slice()]; s.still = 0; s.arrived = 0; };
    const seedMarbles = () => {
      s.marbles = [];
      for (let i = 0; i < 14; i++) {
        const y = -3 + (6 * (i + 0.5)) / 14;
        s.marbles.push({ p: [-4.9, y], tr: [[-4.9, y]] });
      }
    };

    stage.handle({ pen: g, color: 'gold', icon: '🎯', r: 14, get: () => s.goal,
      set: (p) => { s.goal = [clamp(p[0], B[0] + 0.3, B[2] - 0.3), clamp(p[1], B[1] + 0.3, B[3] - 0.3)]; rebuild(); s.arrived = 0; if (s.beat === 2) seedMarbles(); } });
    stage.handle({ pen: g, color: 'pink', icon: '🤖', r: 16, get: () => s.robot,
      set: (p) => { s.robot = [clamp(p[0], B[0], B[2]), clamp(p[1], B[1], B[3])]; s.start = s.robot.slice(); s.trail = [s.robot.slice()]; s.still = 0; s.arrived = 0; },
      onStart: () => (s.held = true), onEnd: () => (s.held = false) });
    const obsHandles = [0, 1, 2, 3, 4].map((i) => stage.handle({
      pen: g, color: 'slate', kind: 'ring', r: 20,
      visible: () => s.beat > 0 && i < s.obs.length,
      get: () => s.obs[i].c,
      set: (p) => { s.obs[i].c = [clamp(p[0], B[0], B[2]), clamp(p[1], B[1], B[3])]; rebuild(); if (s.beat === 2) seedMarbles(); },
    }));

    ui.beats(['🧲', '🧱', '🏃', '😵'], (b) => {
      s.beat = b;
      if (b === 3) {
        s.obs = LAYOUTS.trap.map((o) => ({ c: o.c.slice(), r: o.r }));
        s.goal = [3.8, 0]; s.start = [-4.2, 0.0];
      } else {
        s.obs = LAYOUTS.open.map((o) => ({ c: o.c.slice(), r: o.r }));
        s.goal = [3.6, 0.2]; s.start = [-4.2, -1.6];
      }
      rebuild(); respawn();
      if (b === 2) seedMarbles();
    });
    const sa = ui.slider({ icon: '🧲', color: 'gold', min: 0.2, max: 2, value: s.katt, title: 'goal pull', onInput: (v) => { s.katt = v; rebuild(); } });
    const sr = ui.slider({ icon: '🧱', color: 'coral', min: 0.05, max: 2, value: s.krep, title: 'obstacle push', onInput: (v) => { s.krep = v; rebuild(); } });
    void sa; void sr;
    ui.button({ icon: '🫨', title: 'shake the robot', onClick: () => {
      s.robot = [s.robot[0] + rand.normal(0, 0.6), s.robot[1] + rand.normal(0, 0.9)]; s.still = 0; s.trail.push(s.robot.slice());
    } });
    ui.readout(() => fmt(field.U(s.robot), 2), { icon: '⛰️', color: 'ink', title: 'height U at the robot' });
    ui.readout(() => fmt(Math.hypot(...field.force(s.robot)), 2), { icon: '➡️', color: 'pink', title: 'slope |∇U|' });

    // ---- cached field picture: heat-tinted terrain + contour lines ----
    let cache = { key: '' };
    const fieldPicture = () => {
      const V = g.view.map((v) => Math.round(v * 100) / 100);
      const key = `${s.ver}|${C.bg}|${C.slate}|${C.gold}|${V}`;
      if (cache.key === key) return cache;
      const [x0, y0, x1, y1] = V;
      const NX = 150, NY = Math.max(20, Math.round(150 * (y1 - y0) / (x1 - x0)));
      const vals = new Float64Array(NX * NY), reps = new Float64Array(NX * NY);
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const p = [x0 + (i / (NX - 1)) * (x1 - x0), y0 + (j / (NY - 1)) * (y1 - y0)];
          const u = field.U(p);
          vals[j * NX + i] = Math.log1p(u);
          reps[j * NX + i] = clamp(Math.log1p(Math.max(0, u - attOnly.U(p))) / Math.log1p(12), 0, 1);
        }
      const top = Math.log1p(30);
      const cv = cache.cv ?? document.createElement('canvas');
      cv.width = NX; cv.height = NY;
      const cx = cv.getContext('2d');
      const img = cx.createImageData(NX, NY);
      const gold = hexRGB(C.gold), hill = hexRGB(C.slate), coral = hexRGB(C.coral);
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const t = clamp(vals[j * NX + i] / top, 0, 1);
          const k = 4 * ((NY - 1 - j) * NX + i);
          let rgb, a;
          const rp = reps[j * NX + i];
          const wg = t < 0.3 ? 0.45 * (1 - t / 0.3) ** 2 : 0, wh = 0.4 * Math.min(1, t / 0.8) * (1 - wg);
          a = wg + wh;
          rgb = gold.map((x, q) => (x * wg + hill[q] * wh) / (a || 1));
          if (rp > 0) { rgb = rgb.map((x, q) => x + (coral[q] - x) * rp * 0.55); a = a + (0.6 - a) * rp; }
          img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2]; img.data[k + 3] = Math.round(255 * a);
        }
      cx.putImageData(img, 0, 0);
      const levels = []; for (let L = 0.35; L < top; L += 0.28) levels.push(L);
      cache = { key, cv, V, segs: contourSegs(vals, NX, NY, V, levels) };
      return cache;
    };

    const stepRobot = (p, h) => {
      const f = field.force(p), n = Math.hypot(...f), cap = 2.4;
      const k = n > cap ? cap / n : 1;
      return [clamp(p[0] + f[0] * k * h, B[0], B[2]), clamp(p[1] + f[1] * k * h, B[1], B[3])];
    };

    return {
      update(dt) {
        s.t += dt;
        const n = Math.max(1, Math.ceil(dt / (1 / 60)));
        const h = dt / n;
        for (let k = 0; k < n; k++) {
          if (!s.held && s.arrived === 0) {
            const before = s.robot;
            s.robot = stepRobot(s.robot, h);
            const moved = Math.hypot(s.robot[0] - before[0], s.robot[1] - before[1]) / h;
            const dg = Math.hypot(s.robot[0] - s.goal[0], s.robot[1] - s.goal[1]);
            if (dg < 0.12) s.arrived = 1e-6;
            else if (moved < 0.06) s.still += h; else s.still = 0;
          }
          if (s.beat === 2) for (const m of s.marbles) {
            if (Math.hypot(m.p[0] - s.goal[0], m.p[1] - s.goal[1]) < 0.1) continue;
            m.p = stepRobot(m.p, h);
            const last = m.tr[m.tr.length - 1];
            if (Math.hypot(m.p[0] - last[0], m.p[1] - last[1]) > 0.06) m.tr.push(m.p.slice());
          }
        }
        if (s.arrived > 0) { s.arrived += dt; if (s.arrived > 1.4) respawn(); }
        const last = s.trail[s.trail.length - 1];
        if (!last || Math.hypot(s.robot[0] - last[0], s.robot[1] - last[1]) > 0.05) s.trail.push(s.robot.slice());
        if (s.beat === 2 && s.marbles.every((m) => Math.hypot(m.p[0] - s.goal[0], m.p[1] - s.goal[1]) < 0.12 || m.tr.length > 400)) {
          s.marbleDone = (s.marbleDone ?? 0) + dt;
          if (s.marbleDone > 2) { seedMarbles(); s.marbleDone = 0; }
        }
      },
      draw() {
        for (const [i, h] of obsHandles.entries()) if (s.obs[i]) h.r = Math.max(12, g.px(s.obs[i].r) - 4);
        g.clip(() => {
          const pic = fieldPicture();
          const V = pic.V, a = g.toScreen([V[0], V[3]]), b = g.toScreen([V[2], V[1]]);
          const ctx = g.ctx;
          ctx.save(); ctx.imageSmoothingEnabled = true;
          ctx.drawImage(pic.cv, a[0], a[1], b[0] - a[0], b[1] - a[1]);
          // contour lines (iso-height)
          ctx.strokeStyle = alpha('ink', 0.16); ctx.lineWidth = 1;
          ctx.beginPath();
          for (const [p, q] of pic.segs) { const P = g.toScreen(p), Q = g.toScreen(q); ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]); }
          ctx.stroke();
          ctx.restore();
        });

        // force-arrow field: −∇U at a lattice of points
        if (s.beat < 2 || s.beat === 3) {
          const step = 0.62, V = g.view;
          const xs = Math.ceil((V[0] - s.goal[0]) / step) * step + s.goal[0], ys = Math.ceil((V[1] - s.goal[1]) / step) * step + s.goal[1];
          for (let x = xs + 0.2; x < V[2]; x += step)
            for (let y = ys + 0.2; y < V[3]; y += step) {
              const p = [x, y];
              if (active().some((o) => Math.hypot(x - o.c[0], y - o.c[1]) < o.r + 0.08)) continue;
              if (Math.hypot(x - s.goal[0], y - s.goal[1]) < 0.3) continue;
              const f = field.force(p), fa = attOnly.force(p);
              const fr = [f[0] - fa[0], f[1] - fa[1]];
              const n = Math.hypot(...f);
              if (n < 1e-6) continue;
              const rep = Math.hypot(...fr) / (Math.hypot(...fr) + Math.hypot(...fa) + 1e-9);
              const L = 0.18 + 0.2 * Math.min(1, n / 2);
              const colr = mix('muted', 'coral', clamp(rep * 1.4, 0, 1));
              g.arrow([x - (f[0] / n) * L * 0.5, y - (f[1] / n) * L * 0.5], [x + (f[0] / n) * L * 0.5, y + (f[1] / n) * L * 0.5], { color: colr, width: 1.6, head: 6, alpha: 0.85 });
            }
        }

        // obstacles = hills
        for (const o of active()) {
          g.blob(o.c, o.r * 0.7, { color: 'coral', alpha: 0.18 });
          g.circle(o.c, o.r, { fill: alpha('slate', 0.92), color: 'slate', width: 2 });
          g.circle(o.c, o.r * 0.55, { fill: alpha('white', 0.08), stroke: false });
        }

        // goal valley
        const pulse = 0.5 + 0.5 * Math.sin(s.t * 3);
        g.circle(s.goal, 0.35 + 0.1 * pulse, { color: alpha('gold', 0.5), width: 2 });

        // many marbles (beat 3): every start flows downhill
        if (s.beat === 2) {
          for (const m of s.marbles) {
            g.path(m.tr, { color: alpha('pink', 0.4), width: 2 });
            g.dot(m.p, 4, { color: 'pink' });
          }
        }

        // the robot's trail and the arrows acting on it
        g.path(s.trail, { color: alpha('pink', 0.75), width: 3 });
        const stuck = s.still > 0.6 && s.beat > 0;
        if (s.beat >= 1) {
          const f = field.force(s.robot), fa = attOnly.force(s.robot), fr = [f[0] - fa[0], f[1] - fa[1]];
          const sc = 0.55;
          g.vec(s.robot, [fa[0] * sc, fa[1] * sc], { color: 'gold', width: 3.5 });
          if (Math.hypot(...fr) > 0.02) g.vec(s.robot, [Math.max(-4, Math.min(4, fr[0])) * sc, Math.max(-4, Math.min(4, fr[1])) * sc], { color: 'coral', width: 3.5 });
          if (Math.hypot(...f) > 0.05) g.vec(s.robot, [f[0] * sc, f[1] * sc].map((v) => clamp(v, -2.2, 2.2)), { color: 'pink', width: 4.5 });
        } else {
          const f = field.force(s.robot);
          g.vec(s.robot, [f[0] * 0.55, f[1] * 0.55], { color: 'gold', width: 4 });
        }
        if (stuck) {
          g.circle(s.robot, 0.42 + 0.1 * pulse, { color: 'coral', width: 3 });
          g.blob(s.robot, 0.35, { color: 'coral', alpha: 0.45 });
          g.emoji('😵', [s.robot[0], s.robot[1] + 0.62], 26);
        }
        if (s.arrived > 0) {
          g.blob(s.goal, 0.5, { color: 'gold', alpha: 0.7 });
          g.emoji('🎉', [s.goal[0], s.goal[1] + 0.7], 28);
        }
      },
    };
  },
};
