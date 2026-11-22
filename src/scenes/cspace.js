// Configuration space: every pose of the arm is ONE dot in a square of joint
// angles (q₁, q₂). Obstacles in the room turn into strange blobs in that square,
// and planning a motion becomes "draw a line between two dots that avoids blobs".
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { planarFK, twoLinkIK } from '../core/kinematics.js';
import { astar, segHitsCircle, minkowski, pointInPolygon } from '../core/planning.js';
import { clamp, lerp, smoothstep, wrapAngle } from '../core/random.js';

const PI = Math.PI;
const LEN = [1.15, 0.95];
const N = 90;                       // C-space grid resolution (N×N cells)
const LB = [-2.5, -2.5, 2.5, 2.5];  // workspace
const CB = [-PI - 0.4, -PI - 0.4, PI + 0.15, PI + 0.15]; // configuration square
const ICONS = ['🍄', '🌵', '🧊'];
const LINK_R = 0.07;                // link half-thickness used in collision checks

const hexRGB = (c) => { const h = c.replace('#', ''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const qOf = (i) => -PI + ((i + 0.5) * 2 * PI) / N;
const cellOf = (q) => clamp(Math.floor(((q + PI) / (2 * PI)) * N), 0, N - 1);

// Convex obstacle + triangle robot for the Minkowski beat.
const POLY = Array.from({ length: 5 }, (_, i) => { const a = (i / 5) * 2 * PI + 0.3; return [0.35 + 0.75 * Math.cos(a), 0.1 + 0.62 * Math.sin(a)]; });
const TRI = [[0, 0], [0.72, 0.12], [0.22, 0.62]];

export default {
  eq: [
    [['q', 'orange'], ' = (', ['q₁', 'red'], ', ', ['q₂', 'green'], ')  ∈  [−π, π)²   (a torus)'],
    [['C_obs', 'slate'], ' = { ', ['q', 'orange'], ' : arm(', ['q', 'orange'], ') ∩ ', ['obstacle', 'slate'], ' ≠ ∅ }'],
    ['plan:  ', ['q_start', 'orange'], ' → ', ['q_goal', 'gold'], '  through  C_free   (A* on a grid)'],
    ['translating robot:  ', ['C_obs', 'slate'], ' = ', ['O', 'slate'], ' ⊕ (−', ['R', 'pink'], ')   (Minkowski sum)'],
  ],
  setup({ stage, ui }) {
    const [L, R] = stage.split([LB, CB], [1, 1]);
    const s = {
      beat: 0, q: [0.6, 0.9], start: [-2.2, 0.4], goal: [1.9, -0.6], t: 0, idle: 0, dragging: false,
      obs: [{ c: [1.3, 0.95], r: 0.32 }, { c: [-1.0, 1.3], r: 0.3 }, { c: [0.55, -1.62], r: 0.34 }],
      reveal: 1, trail: [], tipTrail: [], ver: 0, plan: null, playT: 0,
      mink: { p: [1.6, 1.4], u: 0, dragging: false, idle: 9, trail: [] },
    };
    const CO = minkowski(POLY, TRI); // C-space obstacle for the triangle
    const coPerim = (() => { const pts = [...CO, CO[0]]; let Ltot = 0; const seg = []; for (let i = 0; i < CO.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); Ltot += l; } return { pts, seg, Ltot }; })();
    const onCO = (u) => {
      let d = (((u % 1) + 1) % 1) * coPerim.Ltot;
      for (let i = 0; i < coPerim.seg.length; i++) {
        if (d <= coPerim.seg[i]) {
          const t = d / coPerim.seg[i], a = coPerim.pts[i], b = coPerim.pts[i + 1];
          const nx = b[1] - a[1], ny = a[0] - b[0], nl = Math.hypot(nx, ny) || 1; // outward normal (hull is CCW)
          return [lerp(a[0], b[0], t) + (nx / nl) * 0.012, lerp(a[1], b[1], t) + (ny / nl) * 0.012];
        }
        d -= coPerim.seg[i];
      }
      return CO[0];
    };

    const hits = (q) => {
      const P = planarFK(LEN, q).points;
      for (let k = 0; k < s.obs.length; k++) {
        const o = s.obs[k];
        if (segHitsCircle(P[0], P[1], o.c, o.r + LINK_R) || segHitsCircle(P[1], P[2], o.c, o.r + LINK_R)) return k + 1;
      }
      return 0;
    };
    // collision-check EVERY cell of the configuration square
    let cgrid = null, cimg = { key: '' };
    const computeC = () => {
      cgrid = [];
      for (let j = 0; j < N; j++) { const row = new Uint8Array(N); for (let i = 0; i < N; i++) row[i] = hits([qOf(i), qOf(j)]); cgrid.push(row); }
      s.ver++;
    };
    const image = () => {
      const key = `${s.ver}|${C.slate}|${C.ink}`;
      if (cimg.key === key) return cimg.cv;
      const cv = cimg.cv ?? document.createElement('canvas');
      cv.width = N; cv.height = N;
      const cx = cv.getContext('2d'), img = cx.createImageData(N, N);
      const sl = hexRGB(C.slate);
      const shade = [1, 0.82, 1.12];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const v = cgrid[j][i], k = 4 * ((N - 1 - j) * N + i);
        if (!v) continue;
        const f = shade[(v - 1) % 3];
        img.data[k] = clamp(sl[0] * f, 0, 255); img.data[k + 1] = clamp(sl[1] * f, 0, 255); img.data[k + 2] = clamp(sl[2] * f, 0, 255); img.data[k + 3] = 225;
      }
      cx.putImageData(img, 0, 0);
      cimg = { key, cv };
      return cv;
    };
    const replan = () => {
      const blocked = cgrid.map((row) => Array.from(row, (v) => v > 0));
      const a = [cellOf(s.start[0]), cellOf(s.start[1])], b = [cellOf(s.goal[0]), cellOf(s.goal[1])];
      if (blocked[a[1]][a[0]] || blocked[b[1]][b[0]]) { s.plan = { path: null }; return; }
      const res = astar(blocked, a, b, { heuristic: 'euclid' });
      const pts = res.path ? res.path.map(([i, j]) => [qOf(i), qOf(j)]) : null;
      if (pts) { pts[0] = s.start.slice(); pts[pts.length - 1] = s.goal.slice(); }
      s.plan = { path: pts, expanded: res.expanded.length };
      s.playT = 0;
    };
    computeC();
    replan();

    const touch = () => { s.idle = 0; };
    const clampQ = (p) => [clamp(p[0], -PI, PI - 1e-6), clamp(p[1], -PI, PI - 1e-6)];
    // the joint-space dot ↔ the arm
    stage.handle({ pen: R, color: 'orange', r: 10, visible: () => s.beat < 3,
      get: () => (s.beat === 2 ? s.start : s.q),
      set: (p) => { touch(); if (s.beat === 2) { s.start = clampQ(p); replan(); } else s.q = clampQ(p); },
      onStart: () => (s.dragging = true), onEnd: () => (s.dragging = false) });
    stage.handle({ pen: R, color: 'gold', r: 10, kind: 'ring', visible: () => s.beat === 2,
      get: () => s.goal, set: (p) => { s.goal = clampQ(p); replan(); } });
    stage.handle({ pen: L, color: 'pink', r: 11, visible: () => s.beat < 2,
      get: () => planarFK(LEN, s.q).tip,
      set: (p) => {
        touch();
        const d = Math.hypot(...p), m = LEN[0] + LEN[1] - 1e-3, n = Math.abs(LEN[0] - LEN[1]) + 1e-3;
        const k = d > m ? m / d : d < n ? n / (d || 1) : 1;
        const sol = twoLinkIK(LEN[0], LEN[1], p[0] * k, p[1] * k, s.q[1] >= 0);
        if (sol) s.q = sol.map(wrapAngle);
      },
      onStart: () => (s.dragging = true), onEnd: () => (s.dragging = false) });
    const obsH = s.obs.map((o, i) => stage.handle({ pen: L, color: 'slate', kind: 'ring', r: 16, visible: () => s.beat === 1 || s.beat === 2,
      get: () => s.obs[i].c,
      set: (p) => { s.obs[i].c = [clamp(p[0], LB[0], LB[2]), clamp(p[1], LB[1], LB[3])]; computeC(); s.reveal = 1; if (s.beat === 2) replan(); } }));
    stage.handle({ pen: L, color: 'pink', r: 10, visible: () => s.beat === 3,
      get: () => s.mink.p, set: (p) => { s.mink.p = [clamp(p[0], LB[0], LB[2]), clamp(p[1], LB[1], LB[3])]; s.mink.idle = 0; },
      onStart: () => (s.mink.dragging = true), onEnd: () => (s.mink.dragging = false) });

    ui.beats(['🦾', '🧱', '🛤️', '🔺'], (b) => {
      s.beat = b; s.t = 0; s.trail = []; s.tipTrail = [];
      R.setBounds(b === 3 ? LB : CB);
      if (b === 1) s.reveal = 0;
      if (b === 2) { s.reveal = 1; replan(); }
      if (b === 3) { s.mink.trail = []; s.mink.idle = 9; s.mink.u = 0; s.mink.p = onCO(0); }
    });
    ui.readout(() => (s.beat === 3 ? (pointInPolygon(s.mink.p, CO) ? '💥' : '✅') : s.beat === 0 ? '✅' : hits(s.beat === 2 && s.plan?.path ? s.qPlay ?? s.start : s.q) ? '💥' : '✅'), { icon: '🦾', title: 'touching?' });
    ui.readout(() => (s.beat === 3 ? '—' : `${fmt(s.q[0] * 180 / PI, 0)}°, ${fmt(s.q[1] * 180 / PI, 0)}°`), { icon: '📐', color: 'orange', title: 'joint angles' });

    const armAt = (q, o = {}) => {
      const fk = planarFK(LEN, q);
      L.arm(fk.points, { width: o.width ?? 14, color: o.color ?? 'blue', handColor: o.hand ?? 'pink', alpha: o.alpha, base: o.base });
      return fk;
    };
    const wedges = (q, fk) => {
      L.wedge(fk.points[0], 0.42, 0, q[0], { color: 'red', alpha: 0.28 });
      L.arc(fk.points[0], 0.42, 0, q[0], { color: 'red', width: 2.5 });
      L.wedge(fk.points[1], 0.32, q[0], q[0] + q[1], { color: 'green', alpha: 0.28 });
      L.arc(fk.points[1], 0.32, q[0], q[0] + q[1], { color: 'green', width: 2.5 });
      L.line(fk.points[0], [0.6, 0], { color: alpha('red', 0.5), dash: [3, 3], width: 1.5 });
      const e = fk.points[1], d = [Math.cos(q[0]) * 0.5, Math.sin(q[0]) * 0.5];
      L.line(e, [e[0] + d[0], e[1] + d[1]], { color: alpha('green', 0.5), dash: [3, 3], width: 1.5 });
    };
    const drawObstacles = () => {
      s.obs.forEach((o, k) => {
        L.circle(o.c, o.r, { fill: alpha('slate', 0.9), color: 'slate', width: 2 });
        L.emoji(ICONS[k], o.c, Math.max(14, L.px(o.r) * 0.95));
      });
    };
    const drawSquare = () => {
      // the configuration square with "glued" edges (it is really a donut)
      R.rect(-PI, -PI, 2 * PI, 2 * PI, { fill: alpha('panel', 0.7), color: alpha('muted', 0.45), width: 1.5 });
      for (const v of [-PI / 2, 0, PI / 2]) {
        R.line([v, -PI], [v, PI], { color: alpha('muted', 0.15), width: 1 });
        R.line([-PI, v], [PI, v], { color: alpha('muted', 0.15), width: 1 });
      }
      R.line([-PI, -PI], [-PI, PI], { color: alpha('green', 0.55), width: 3, dash: [8, 6] });
      R.line([PI, -PI], [PI, PI], { color: alpha('green', 0.55), width: 3, dash: [8, 6] });
      R.line([-PI, -PI], [PI, -PI], { color: alpha('red', 0.55), width: 3, dash: [8, 6] });
      R.line([-PI, PI], [PI, PI], { color: alpha('red', 0.55), width: 3, dash: [8, 6] });
      R.arrow([-PI, -PI - 0.2], [-PI + 1.2, -PI - 0.2], { color: 'red', width: 3 });
      R.text('q₁', [-PI + 1.5, -PI - 0.2], { color: 'red', size: 19 });
      R.arrow([-PI - 0.2, -PI], [-PI - 0.2, -PI + 1.2], { color: 'green', width: 3 });
      R.text('q₂', [-PI - 0.2, -PI + 1.5], { color: 'green', size: 19 });
    };
    const drawCObs = (upto = 1) => {
      const cv = image();
      const a = R.toScreen([-PI, PI]), b = R.toScreen([PI, -PI]);
      const ctx = R.ctx;
      ctx.save();
      ctx.beginPath(); ctx.rect(a[0], a[1], (b[0] - a[0]) * upto, b[1] - a[1]); ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cv, a[0], a[1], b[0] - a[0], b[1] - a[1]);
      ctx.restore();
      // tag each blob with its obstacle's icon (arm pointing straight at the obstacle)
      s.obs.forEach((o, k) => {
        const q = [Math.atan2(o.c[1], o.c[0]), 0];
        if (q[0] > -PI + 2 * PI * upto) return;
        if (cgrid[cellOf(q[1])][cellOf(q[0])] === k + 1) R.emoji(ICONS[k], q, 18);
      });
    };

    return {
      update(dt) {
        s.t += dt; s.idle += dt;
        if (s.beat === 1 && s.reveal < 1) s.reveal = Math.min(1, s.reveal + dt / 3);
        if (s.beat < 2 && !s.dragging && s.idle > 2.5) {
          // wander gently so the dot ↔ arm link is visible even without touching
          const w = smoothstep((s.idle - 2.5) / 1.5), tt = s.t * 0.35;
          const target = [2.6 * Math.sin(tt), 2.2 * Math.sin(tt * 1.7 + 0.8)];
          s.q = [lerp(s.q[0], target[0], 0.04 * w), lerp(s.q[1], target[1], 0.04 * w)];
        }
        if (s.beat < 2) {
          const tip = planarFK(LEN, s.q).tip;
          const lt = s.trail[s.trail.length - 1];
          if (!lt || Math.hypot(lt[0] - s.q[0], lt[1] - s.q[1]) > 0.04) { s.trail.push(s.q.slice()); s.tipTrail.push(tip); }
          if (s.trail.length > 160) { s.trail.shift(); s.tipTrail.shift(); }
        }
        if (s.beat === 2 && s.plan?.path) {
          s.playT += dt * 28;
          const n = s.plan.path.length;
          if (s.playT > n + 30) s.playT = 0;
          const k = Math.min(s.playT, n - 1), i = Math.floor(k), f = k - i;
          const a = s.plan.path[i], b = s.plan.path[Math.min(i + 1, n - 1)];
          s.qPlay = [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
          s.q = s.qPlay;
        }
        if (s.beat === 3) {
          const m = s.mink;
          m.idle += dt;
          if (!m.dragging && m.idle > 1.5) {
            m.u = (m.u + dt * 0.09) % 1;
            const tgt = onCO(m.u), w = smoothstep((m.idle - 1.5) / 1.5);
            m.p = [lerp(m.p[0], tgt[0], 0.05 + 0.95 * w), lerp(m.p[1], tgt[1], 0.05 + 0.95 * w)];
          }
          const lt = m.trail[m.trail.length - 1];
          if (!lt || Math.hypot(lt[0] - m.p[0], lt[1] - m.p[1]) > 0.03) m.trail.push(m.p.slice());
          if (m.trail.length > 400) m.trail.shift();
        }
      },
      draw() {
        obsH.forEach((h, i) => (h.r = Math.max(12, L.px(s.obs[i].r) - 2)));
        L.grid({ step: 0.5, axes: false });
        if (s.beat === 3) return drawMink();
        R.fillBg('bg');
        drawSquare();
        if (s.beat >= 1) drawObstacles();
        if (s.beat >= 1) drawCObs(s.beat === 1 ? s.reveal : 1);

        if (s.beat === 1 && s.reveal < 1) {
          // the scanner: test a whole column of elbow angles for this shoulder angle
          const q1 = -PI + 2 * PI * s.reveal;
          R.line([q1, -PI], [q1, PI], { color: 'teal', width: 2.5 });
          for (let k = 0; k < 12; k++) {
            const q = [q1, -PI + ((k + 0.5) * 2 * PI) / 12], hit = hits(q);
            const P = planarFK(LEN, q).points;
            L.path(P, { color: hit ? alpha('coral', 0.6) : alpha('teal', 0.22), width: hit ? 3 : 2 });
            R.dot(q, 3, { color: hit ? 'coral' : 'teal' });
          }
        }
        if (s.beat < 2) {
          // trails: the dot's path in the square = the tip's path in the room
          if (s.trail.length > 1) R.path(s.trail, { color: alpha('orange', 0.45), width: 2.5 });
          if (s.tipTrail.length > 1) L.path(s.tipTrail, { color: alpha('pink', 0.45), width: 2.5 });
          const hit = s.beat === 1 && hits(s.q);
          const fk = armAt(s.q, { color: hit ? 'coral' : 'blue' });
          wedges(s.q, fk);
          R.line([s.q[0], -PI], [s.q[0], s.q[1]], { color: alpha('red', 0.5), dash: [3, 4], width: 1.5 });
          R.line([-PI, s.q[1]], [s.q[0], s.q[1]], { color: alpha('green', 0.5), dash: [3, 4], width: 1.5 });
          if (hit) { R.emoji('💥', [s.q[0] + 0.35, s.q[1] + 0.35], 18); L.emoji('💥', fk.tip, 22); }
        }
        if (s.beat === 2) {
          const P = s.plan;
          const ga = planarFK(LEN, s.goal), sa = planarFK(LEN, s.start);
          L.arm(sa.points, { width: 12, color: alpha('orange', 0.55), jointColor: 'orange', handColor: 'orange', base: false, alpha: 0.7 });
          L.arm(ga.points, { width: 12, color: alpha('gold', 0.6), jointColor: 'gold', handColor: 'gold', base: false, alpha: 0.7 });
          if (P?.path) {
            R.path(P.path, { color: 'gold', width: 4 });
            // stroboscope of the motion in the room
            for (let i = 0; i < P.path.length; i += 6) {
              const pts = planarFK(LEN, P.path[i]).points;
              L.path(pts, { color: alpha('blue', 0.13), width: 5 });
            }
            L.path(P.path.map((q) => planarFK(LEN, q).tip), { color: alpha('gold', 0.8), width: 2.5, dash: [5, 4] });
            const fk = armAt(s.qPlay ?? s.start);
            void fk;
            R.dot(s.qPlay ?? s.start, 6, { color: 'pink', ring: 'bg' });
          } else {
            armAt(s.start, { color: 'coral' });
            R.emoji('🚫', [(s.start[0] + s.goal[0]) / 2, (s.start[1] + s.goal[1]) / 2], 26);
          }
        }
      },
    };

    function drawMink() {
      const m = s.mink;
      const tri = TRI.map((v) => [m.p[0] + v[0], m.p[1] + v[1]]);
      const hit = pointInPolygon(m.p, CO);
      // workspace: polygon obstacle and the sliding triangle
      L.poly(CO, { fill: alpha('slate', 0.08), color: alpha('slate', 0.35), width: 1.5, dash: [5, 5] });
      L.poly(POLY, { fill: alpha('slate', 0.9), color: 'slate', width: 2 });
      if (m.trail.length > 1) L.path(m.trail, { color: 'pink', width: 3 });
      L.poly(tri, { fill: alpha(hit ? 'coral' : 'pink', 0.35), color: hit ? 'coral' : 'pink', width: 2.5 });
      L.dot(m.p, 5, { color: 'ink', ring: 'bg' });

      // configuration space of a sliding robot: the obstacle grows by the flipped robot
      R.fillBg('bg');
      R.grid({ step: 0.5, axes: false });
      for (const o of POLY) R.poly(TRI.map((v) => [o[0] - v[0], o[1] - v[1]]), { fill: alpha('pink', 0.08), color: alpha('pink', 0.4), width: 1.2 });
      R.poly(CO, { fill: alpha('slate', 0.75), color: 'slate', width: 2.5 });
      R.poly(POLY, { fill: alpha('slate', 0.95), color: alpha('bg', 0.6), width: 1.5, dash: [4, 4] });
      // the flipped robot, drawn once, as the "stamp"
      const s1 = [-2.25, 1.35], s2 = [-0.6, 2.15];
      R.poly(TRI.map((v) => [s1[0] + v[0], s1[1] + v[1]]), { fill: alpha('pink', 0.3), color: 'pink', width: 2 });
      R.dot(s1, 4, { color: 'ink' });
      R.arrow([s1[0] + 0.85, s1[1] + 0.35], [s2[0] - 0.85, s2[1] - 0.3], { color: 'muted', width: 2 });
      R.emoji('🙃', [(s1[0] + s2[0]) / 2 + 0.05, (s1[1] + s2[1]) / 2 + 0.35], 18);
      R.poly(TRI.map((v) => [s2[0] - v[0], s2[1] - v[1]]), { fill: alpha('pink', 0.3), color: 'pink', width: 2 });
      R.dot(s2, 4, { color: 'ink' });
      if (m.trail.length > 1) R.path(m.trail, { color: alpha('pink', 0.75), width: 2 });
      R.dot(m.p, 8, { color: hit ? 'coral' : 'pink', ring: 'bg' });
      if (hit) { R.emoji('💥', [m.p[0] + 0.3, m.p[1] + 0.3], 20); L.emoji('💥', [m.p[0] + 0.3, m.p[1] + 0.5], 20); }
      R.text('⊕', [CO.reduce((a, p) => a + p[0], 0) / CO.length, CO.reduce((a, p) => a + p[1], 0) / CO.length], { size: 24, color: 'bg', halo: false });
    }
  },
};
