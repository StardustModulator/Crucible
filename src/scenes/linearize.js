// Zoom in and everything is flat. A wiggly curve becomes a straight line under
// a strong enough magnifying glass; a warped 2D grid becomes a straight
// parallelogram grid — the Jacobian. Far away, the straight guess drifts (coral gap).
import { C, alpha } from '../viz/palette.js';
import { numJacobian } from '../core/dynamics.js';
import { solve, mvec } from '../core/linalg.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';
import { drawMatrix } from './matrix.js';

const f = (x) => Math.sin(1.3 * x) + 0.12 * x * x + 0.2 * Math.cos(3.1 * x);
const df = (x) => 1.3 * Math.cos(1.3 * x) + 0.24 * x - 0.62 * Math.sin(3.1 * x);
const d2f = (x) => -1.69 * Math.sin(1.3 * x) + 0.24 - 1.922 * Math.cos(3.1 * x);

const MAPS = {
  wave: { F: ([x, y]) => [x + 0.45 * Math.sin(1.3 * y), y + 0.45 * Math.sin(1.3 * x)], dom: [-3, -3, 3, 3] },
  polar: { F: ([x, y]) => { const r = 2.2 + 0.55 * y, th = 0.5 * x; return [r * Math.cos(th) - 1.6, r * Math.sin(th)]; }, dom: [-3, -3, 3, 3] },
  swirl: { F: ([x, y]) => { const a = 0.9 * Math.exp(-(x * x + y * y) / 5); return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; }, dom: [-3, -3, 3, 3] },
};

export default {
  eq: [
    [['f(x₀+h)', 'blue'], ' ≈ ', ['f(x₀)', 'orange'], ' + ', ['f′(x₀)', 'gold'], '·h        ', ['gap', 'coral'], ' ≈ ½', ['f″', 'purple'], '·h²'],
    [['F(p₀+δ)', 'blue'], ' ≈ ', ['F(p₀)', 'orange'], ' + ', ['J', 'gold'], 'δ ,   ', ['J', 'gold'], ' = [ ', ['∂F/∂x', 'red'], '  ', ['∂F/∂y', 'green'], ' ]'],
    ['zoom ×10 → ', ['gap', 'coral'], ' ×1/100 relative to the view ×1/10'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const s = { beat: 0, x0: 0.6, zoom: 1, zAuto: true, t: 0, map: 'wave', p0: [0.8, 0.6], lens: 0.6, d: 1.8, second: false };
    const wide = (W, H) => W >= H * 1.05;
    // beat-1 panels: warped world | lens; beat-2 panels: curve | gap plot
    const L = stage.pen((W, H) => (s.beat === 0 ? Z : wide(W, H) ? { x: 0, y: 0, w: s.beat === 1 ? 0.58 : 0.66, h: 1 } : { x: 0, y: 0, w: 1, h: s.beat === 1 ? 0.56 : 0.64 }), [-3, -3, 3, 3]);
    const R = stage.pen((W, H) => (s.beat === 0 ? Z : wide(W, H) ? { x: s.beat === 1 ? 0.58 : 0.66, y: 0, w: s.beat === 1 ? 0.42 : 0.34, h: 1 } : { x: 0, y: s.beat === 1 ? 0.56 : 0.64, w: 1, h: s.beat === 1 ? 0.44 : 0.36 }), [-1.1, -1.1, 1.1, 1.1]);
    const relayout = () => {
      g.setBounds(viewBox0());
      const m = MAPS[s.map], E = extent(m);
      L.setBounds(s.beat === 1 ? E : [-4.2, -1.6, 4.2, 3.4]);
      R.setBounds(s.beat === 1 ? [-1.15, -1.15, 1.15, 1.15] : [-3.3, -0.4, 3.3, 3.2]);
    };
    const extent = (m) => {
      let a = [Infinity, Infinity, -Infinity, -Infinity];
      const [x0, y0, x1, y1] = m.dom;
      for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
        const q = m.F([x0 + (x1 - x0) * i / 20, y0 + (y1 - y0) * j / 20]);
        a = [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[0]), Math.max(a[3], q[1])];
      }
      return [a[0] - 0.3, a[1] - 0.3, a[2] + 0.3, a[3] + 0.3];
    };
    // beat 0: the view itself zooms toward the dot
    const viewBox0 = () => {
      const k = 1 - 1 / s.zoom, cx = s.x0 * k, cy = 1.1 + (f(s.x0) - 1.1) * k, w = 4.4 / s.zoom, h = 2.6 / s.zoom;
      return [cx - w, cy - h, cx + w, cy + h];
    };

    // handles
    stage.handle({ pen: g, color: 'orange', r: 11, visible: () => s.beat === 0 && s.zoom < 1.3, get: () => [s.x0, f(s.x0)], set: (p) => (s.x0 = clamp(p[0], -4, 4)) });
    const Fm = () => MAPS[s.map].F;
    stage.handle({
      pen: L, color: 'gold', r: 12, kind: 'ring', icon: '🔍', visible: () => s.beat === 1,
      get: () => Fm()(s.p0),
      set: (q) => {
        // invert F with a few Newton steps (uses the Jacobian, of course)
        let p = s.p0.slice();
        for (let k = 0; k < 6; k++) {
          const J = numJacobian(Fm(), p), r = Fm()(p);
          const dp = solve(J, [q[0] - r[0], q[1] - r[1]]);
          if (!dp.every(Number.isFinite)) break;
          p = [clamp(p[0] + dp[0], -3, 3), clamp(p[1] + dp[1], -3, 3)];
        }
        s.p0 = p;
      },
    });
    stage.handle({ pen: L, color: 'orange', r: 10, visible: () => s.beat === 2, get: () => [s.x0, f(s.x0)], set: (p) => (s.x0 = clamp(p[0], -3.6, 3.6)) });
    stage.handle({ pen: L, color: 'blue', r: 9, kind: 'ring', visible: () => s.beat === 2, get: () => [s.x0 + s.d, f(s.x0 + s.d)], set: (p) => (s.d = clamp(p[0] - s.x0, -3, 3)) });

    const groups = [ui.group(), ui.group(), ui.group()];
    const zSl = ui.slider({ into: groups[0], icon: '🔍', color: 'orange', min: 0, max: 2, step: 0.01, value: 0, title: 'zoom', onInput: (v) => { s.zoom = 10 ** v; s.zAuto = false; } });
    ui.choice({ into: groups[1], value: s.map, color: 'blue', options: [{ icon: '🌊', value: 'wave', title: 'wavy' }, { icon: '🌈', value: 'polar', title: 'bend' }, { icon: '🌀', value: 'swirl', title: 'swirl' }], onChange: (v) => { s.map = v; s.p0 = [0.8, 0.6]; relayout(); } });
    ui.slider({ into: groups[1], icon: '🔍', color: 'gold', min: 0.08, max: 1.5, step: 0.01, value: s.lens, title: 'lens size', onInput: (v) => (s.lens = v) });
    ui.toggle({ into: groups[2], icon: '➕', color: 'purple', title: 'add the curve term', value: false, onChange: (v) => (s.second = v) });
    ui.readout(() => (s.beat === 0 ? '×' + fmt(s.zoom, s.zoom < 10 ? 1 : 0) : s.beat === 1 ? fmt(lensErr(), 3) : fmt(gapAt(s.d), 2)), { icon: '📏', color: 'coral', title: 'gap' });
    const showGroups = () => groups.forEach((gr, i) => (gr.style.display = i === s.beat ? '' : 'none'));
    ui.beats(['🔍', '🕸️', '📏'], (b) => { s.beat = b; s.t = 0; if (b === 0) { s.zAuto = true; } showGroups(); relayout(); });
    showGroups(); relayout();

    const tangentAt = (x) => f(s.x0) + df(s.x0) * (x - s.x0);
    const quadAt = (x) => tangentAt(x) + 0.5 * d2f(s.x0) * (x - s.x0) ** 2;
    const gapAt = (d) => f(s.x0 + d) - (s.second ? quadAt(s.x0 + d) : tangentAt(s.x0 + d));
    function lensErr() {
      // biggest mismatch between the true and the straight grid at the lens rim, relative to lens size
      const F = Fm(), J = numJacobian(F, s.p0), c = F(s.p0);
      let m = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 2 * Math.PI, dp = [s.lens * Math.cos(a), s.lens * Math.sin(a)];
        const q = F([s.p0[0] + dp[0], s.p0[1] + dp[1]]), l = mvec(J, dp);
        m = Math.max(m, Math.hypot(q[0] - c[0] - l[0], q[1] - c[1] - l[1]));
      }
      return m / s.lens;
    }

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 0) {
          if (s.zAuto) { const ph = (Math.sin(s.t * 0.55 - Math.PI / 2) + 1) / 2; s.zoom = 10 ** (2 * ph); zSl.set(Math.log10(s.zoom)); }
          g.setBounds(viewBox0());
        }
      },
      draw() {
        if (s.beat === 0) drawZoom();
        else if (s.beat === 1) drawLens();
        else drawTaylor();
      },
    };

    // ---------------------------------------------------------------- beat 0
    function drawZoom() {
      g.grid({ axes: false });
      const [vx0, , vx1] = g.view;
      const y0 = f(s.x0), m = df(s.x0);
      // coral: what the straight line misses
      const n = 200, xs = Array.from({ length: n + 1 }, (_, i) => vx0 + ((vx1 - vx0) * i) / n);
      g.band(xs, xs.map((x) => Math.min(f(x), y0 + m * (x - s.x0))), xs.map((x) => Math.max(f(x), y0 + m * (x - s.x0))), { color: 'coral', alpha: 0.28 });
      g.plot(f, { color: 'blue', width: 4, samples: 300 });
      g.line([vx0, y0 + m * (vx0 - s.x0)], [vx1, y0 + m * (vx1 - s.x0)], { color: 'gold', width: 2.5, dash: [9, 7] });
      // a lens rim around the whole view = "you are looking through the glass"
      const A = g.area, ctx = g.ctx;
      ctx.save();
      const rr = Math.min(A.w, A.h) * 0.47;
      ctx.strokeStyle = alpha('slate', 0.35); ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(A.x + A.w / 2, A.y + A.h / 2, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      g.dot([s.x0, y0], 8, { color: 'orange', ring: 'bg' });
      miniMap();
      const flat = 1 - Math.min(1, lensFlat());
      if (flat > 0.97) g.emoji('📏', [s.x0, y0 + 2.6 / s.zoom * 0.6], 28);
    }
    function lensFlat() {
      // relative bend inside the view: |f''| · (half width)² / view height
      const w = 4.4 / s.zoom; return Math.abs(d2f(s.x0)) * w * w / 2 / (2.6 / s.zoom);
    }
    function miniMap() {
      const ctx = stage.hud.ctx, A = g.area;
      const W = Math.min(220, A.w * 0.34), H = W * 0.55, X = A.x + A.w - W - 12, Y = A.y + 12;
      const wx0 = -5, wx1 = 5, wy0 = -1.6, wy1 = 3.8;
      const P = (x, y) => [X + ((x - wx0) / (wx1 - wx0)) * W, Y + H - ((y - wy0) / (wy1 - wy0)) * H];
      ctx.save();
      ctx.fillStyle = alpha('panel', 0.94); ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(X, Y, W, H, 10); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(X, Y, W, H); ctx.clip();
      ctx.strokeStyle = C.blue; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 120; i++) { const x = wx0 + (wx1 - wx0) * i / 120, p = P(x, f(x)); i ? ctx.lineTo(...p) : ctx.moveTo(...p); }
      ctx.stroke();
      const [a, b, c, d] = g.view, p0 = P(a, d), p1 = P(c, b);
      ctx.strokeStyle = C.orange; ctx.lineWidth = 2;
      ctx.strokeRect(p0[0], p0[1], Math.max(3, p1[0] - p0[0]), Math.max(3, p1[1] - p0[1]));
      ctx.fillStyle = C.orange; const q = P(s.x0, f(s.x0)); ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, 7); ctx.fill();
      ctx.restore();
    }

    // ---------------------------------------------------------------- beat 1
    function drawLens() {
      const F = Fm(), m = MAPS[s.map], [x0, y0, x1, y1] = m.dom;
      L.clip(() => {
        L.grid({ step: 1, axes: false });
        L.warpedGrid(F, { range: m.dom, step: 0.5, color: alpha('blue', 0.55), width: 1.3, axisColorX: alpha('red', 0.75), axisColorY: alpha('green', 0.75) });
        // outline of the warped square
        const edge = [];
        for (let i = 0; i <= 40; i++) edge.push(F([x0 + (x1 - x0) * i / 40, y0]));
        for (let i = 0; i <= 40; i++) edge.push(F([x1, y0 + (y1 - y0) * i / 40]));
        for (let i = 0; i <= 40; i++) edge.push(F([x1 - (x1 - x0) * i / 40, y1]));
        for (let i = 0; i <= 40; i++) edge.push(F([x0, y1 - (y1 - y0) * i / 40]));
        L.path(edge, { color: 'blue', width: 2.5 });
        // the lens footprint: the image of a small circle around p0
        const c = F(s.p0), ring = [];
        for (let k = 0; k <= 48; k++) { const a = k / 48 * 2 * Math.PI; ring.push(F([s.p0[0] + s.lens * Math.cos(a), s.p0[1] + s.lens * Math.sin(a)])); }
        L.poly(ring, { fill: alpha('gold', 0.18), color: 'gold', width: 2.5 });
        const J = numJacobian(F, s.p0), k = 0.7;
        L.arrow(c, [c[0] + J[0][0] * k, c[1] + J[1][0] * k], { color: 'red', width: 4 });
        L.arrow(c, [c[0] + J[0][1] * k, c[1] + J[1][1] * k], { color: 'green', width: 4 });
      });
      // inside the lens: true tiny grid (blue) vs straight grid (gold dashed)
      const F0 = F(s.p0), J = numJacobian(F, s.p0), r = s.lens;
      const sc = 1 / (r * Math.max(Math.hypot(J[0][0], J[1][0]), Math.hypot(J[0][1], J[1][1])) * 1.15);
      const toLens = (q) => [(q[0] - F0[0]) * sc, (q[1] - F0[1]) * sc];
      const ctx = R.ctx, cc = R.toScreen([0, 0]), rad = R.px(1.08);
      ctx.save();
      ctx.beginPath(); ctx.arc(cc[0], cc[1], rad, 0, Math.PI * 2); ctx.fillStyle = C.panel; ctx.fill(); ctx.clip();
      const N = 4, st = r / 2.5;
      for (let i = -N; i <= N; i++) {
        const a = [], b = [], la = [], lb = [];
        for (let j = -N * 4; j <= N * 4; j++) {
          const u = (j / 4) * st, v = i * st;
          a.push(toLens(F([s.p0[0] + u, s.p0[1] + v]))); b.push(toLens(F([s.p0[0] + v, s.p0[1] + u])));
          la.push(toLens([F0[0] + J[0][0] * u + J[0][1] * v, F0[1] + J[1][0] * u + J[1][1] * v]));
          lb.push(toLens([F0[0] + J[0][0] * v + J[0][1] * u, F0[1] + J[1][0] * v + J[1][1] * u]));
        }
        R.path(a, { color: i === 0 ? 'red' : 'blue', width: i === 0 ? 2.5 : 1.6 });
        R.path(b, { color: i === 0 ? 'green' : 'blue', width: i === 0 ? 2.5 : 1.6 });
        R.path(la, { color: 'gold', width: 1.6, dash: [6, 5] });
        R.path(lb, { color: 'gold', width: 1.6, dash: [6, 5] });
      }
      // coral: how far each true grid point is from its straight guess
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const u = i * st, v = j * st;
        const q = toLens(F([s.p0[0] + u, s.p0[1] + v])), l = toLens([F0[0] + J[0][0] * u + J[0][1] * v, F0[1] + J[1][0] * u + J[1][1] * v]);
        if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.02) R.line(l, q, { color: 'coral', width: 2.5 });
      }
      R.arrow([0, 0], toLens([F0[0] + J[0][0] * st * 2, F0[1] + J[1][0] * st * 2]), { color: 'red', width: 4 });
      R.arrow([0, 0], toLens([F0[0] + J[0][1] * st * 2, F0[1] + J[1][1] * st * 2]), { color: 'green', width: 4 });
      R.dot([0, 0], 5, { color: 'orange' });
      ctx.restore();
      ctx.save(); ctx.lineWidth = 8; ctx.strokeStyle = C.gold; ctx.beginPath(); ctx.arc(cc[0], cc[1], rad, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      // handle of the magnifier
      const hx = cc[0] + rad * 0.72, hy = cc[1] + rad * 0.72;
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = alpha('gold', 0.8); ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + rad * 0.22, hy + rad * 0.22); ctx.stroke(); ctx.restore();
      drawMatrix(stage.hud, J, { x: L.area.x + 10, y: L.area.y + 10 });
      if (lensErr() < 0.03) R.emoji('📏', [0.95, 1.0], 26);
    }

    // ---------------------------------------------------------------- beat 2
    function drawTaylor() {
      L.clip(() => {
        L.grid({ step: 1 });
        const [vx0, , vx1] = L.view;
        const n = 200, xs = Array.from({ length: n + 1 }, (_, i) => vx0 + ((vx1 - vx0) * i) / n);
        const approx = (x) => (s.second ? quadAt(x) : tangentAt(x));
        L.band(xs, xs.map((x) => Math.min(f(x), approx(x))), xs.map((x) => Math.max(f(x), approx(x))), { color: 'coral', alpha: 0.16 });
        L.plot(f, { color: 'blue', width: 4 });
        L.plot(tangentAt, { color: 'gold', width: 2.5, dash: [9, 7] });
        if (s.second) L.plot(quadAt, { color: 'purple', width: 2.5, dash: [4, 5] });
        const xd = s.x0 + s.d;
        L.line([xd, approx(xd)], [xd, f(xd)], { color: 'coral', width: 6 });
        L.line([s.x0, f(s.x0)], [xd, f(s.x0)], { color: alpha('muted', 0.7), width: 1.5, dash: [3, 4] });
        L.text('h', [(s.x0 + xd) / 2, f(s.x0) - 0.25], { color: 'muted', size: 15 });
        L.dot([xd, approx(xd)], 6, { color: s.second ? 'purple' : 'gold', ring: 'bg' });
      });
      // gap vs distance: a parabola (½ f″ h²) — or a cubic once the curve term is added
      R.clip(() => {
        R.grid({ step: 1 });
        R.plot((d) => Math.abs(gapAt(d)), { color: 'coral', width: 3, range: [-3.2, 0, 3.2], fillTo: 0, fillAlpha: 0.15 });
        if (!s.second) R.plot((d) => Math.abs(0.5 * d2f(s.x0) * d * d), { color: 'purple', width: 2, dash: [4, 5], range: [-3.2, 0, 3.2] });
        R.line([s.d, 0], [s.d, Math.abs(gapAt(s.d))], { color: 'coral', width: 5 });
        R.dot([s.d, Math.abs(gapAt(s.d))], 6, { color: 'coral', ring: 'bg' });
        R.dot([0, 0], 6, { color: 'orange', ring: 'bg' });
        R.text('h', [3.0, -0.22], { color: 'muted', size: 14 });
      });
      L.drawFrame(); R.drawFrame();
    }
  },
};
const Z = { x: 0, y: 0, w: 0, h: 0 };
