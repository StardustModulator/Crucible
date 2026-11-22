// Chain rule = gears. Turn the first gear: every mesh multiplies the speed by a
// ratio, and the ratios multiply down the chain. Then the same thing with number
// lines (a tiny wiggle gets stretched twice), then a long chain of 5 (backprop!).
import { C, alpha, mix } from '../viz/palette.js';
import { numJacobian } from '../core/dynamics.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const MOD = 0.16;                 // tooth size: radius = teeth · MOD / 2
const rad = (n) => (n * MOD) / 2;

function gearPts(c, n, th) {
  const r = rad(n), rr = r - 1.15 * MOD, rt = r + MOD, p = (2 * Math.PI) / n, pts = [];
  for (let k = 0; k < n; k++) {
    const a = th + k * p;
    for (const [rad_, da] of [[rr, -0.3], [rt, -0.14], [rt, 0.14], [rr, 0.3]]) pts.push([c[0] + rad_ * Math.cos(a + da * p), c[1] + rad_ * Math.sin(a + da * p)]);
  }
  return pts;
}
function drawGear(g, c, n, th, color, o = {}) {
  const r = rad(n);
  const pts = gearPts(c, n, th);
  g.poly(pts, { fill: 'panel', stroke: false });
  g.poly(pts, { fill: alpha(color, o.fillA ?? 0.3), color, width: 2 });
  g.circle(c, r * 0.55, { color: alpha(color, 0.6), width: 1.5 });
  for (let k = 0; k < 3; k++) { const a = th + (k * 2 * Math.PI) / 3; g.line(c, [c[0] + r * 0.55 * Math.cos(a), c[1] + r * 0.55 * Math.sin(a)], { color: alpha(color, 0.7), width: 3 }); }
  g.dot([c[0] + r * 0.78 * Math.cos(th), c[1] + r * 0.78 * Math.sin(th)], 5, { color: 'ink' });
  g.dot(c, 5, { color: 'ink' });
}
// curved arrow showing spin direction & speed (sweep ∝ |ω|)
function spinArrow(g, c, r, w, color) {
  const sweep = clamp(Math.abs(w) * 1.4, 0.15, 5.2) * Math.sign(w || 1);
  const a0 = Math.PI / 2 - sweep / 2, a1 = a0 + sweep, n = 24, pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (sweep * i) / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  g.path(pts.slice(0, -2), { color, width: 3.5 });
  g.arrow(pts[n - 3], pts[n], { color, width: 3.5, head: 12 });
  void a1;
}

const f = (x) => 1.6 * Math.sin(0.9 * x);
const gg = (y) => 0.5 * y + 0.3 * y ** 3;
const d1 = (fn, x) => numJacobian((v) => [fn(v[0])], [x])[0][0];
const LINE_K = 2;                 // world units per number-line unit
const YX = 2.2, YY = 0.0, YZ = -2.2; // heights of the x / y / z number lines

export default {
  eq: [
    [['ω₃', 'pink'], ' = ', ['k₂', 'purple'], ' · ', ['k₁', 'blue'], ' · ', ['ω₁', 'orange'], '      (gear ratios multiply)'],
    [['dz/dx', 'gold'], ' = ', ['dz/dy', 'purple'], ' · ', ['dy/dx', 'blue'], '   with ', ['y = f(x)', 'teal'], ', ', ['z = g(y)', 'pink']],
    [['∂L/∂x₀', 'gold'], ' = ', ['k₅', 'blue'], '·', ['k₄', 'blue'], '·', ['k₃', 'blue'], '·', ['k₂', 'blue'], '·', ['k₁', 'blue'], '    ', ['kᵢ = wᵢ·tanh′(wᵢ uᵢ₋₁)', 'blue']],
    ['many ', ['k < 1', 'blue'], ' → 🫥 vanishing     many ', ['k > 1', 'blue'], ' → 💥 exploding'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const s = {
      beat: 0, n1: 14, n2: 26, np: 10, n3: 18, th1: 0, w1: 0.8, drag: false, t: 0,
      x0: -0.6, eps: 0.12, chainX: 0.3, w: [1.3, 0.8, 1.6, 0.7, 1.2],
    };
    const layout = () => {
      const r1 = rad(s.n1), r2 = rad(s.n2), rp = rad(s.np), r3 = rad(s.n3);
      const phi = stage.portrait ? -1.25 : -0.55;
      const c1 = [0, 0], c2 = [r1 + r2, 0], c3 = [c2[0] + (rp + r3) * Math.cos(phi), (rp + r3) * Math.sin(phi)];
      const xs = [c1[0] - r1, c2[0] + r2, c3[0] + r3, c3[0] - r3], ys = [r1, r2, c3[1] - r3, c3[1] + r3];
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2 - 0.2;
      const sh = (c) => [c[0] - cx, c[1] - cy];
      const ext = [Math.min(...xs) - cx - 0.9, Math.min(...ys) - cy - 0.6, Math.max(...xs) - cx + 0.9, Math.max(...ys) - cy + 1.0];
      return { c1: sh(c1), c2: sh(c2), c3: sh(c3), r1, r2, rp, r3, phi, ext };
    };
    const ratios = () => ({ k1: -s.n1 / s.n2, k2: -s.np / s.n3 });
    const angles = (L) => {
      const { k1, k2 } = ratios();
      const th2 = Math.PI + k1 * s.th1 + Math.PI / s.n2;
      const th3 = L.phi + Math.PI + k2 * (th2 - L.phi) + Math.PI / s.n3;
      return [s.th1, th2, th3];
    };

    const fitBounds = () => {
      if (s.beat === 0 && stage.portrait) {
        const e = layout().ext, top = e[3] + 1.6; // room for the factor row
        const key = e.map((v) => v.toFixed(2)).join();
        if (s.gearKey !== key || g.bounds !== s.gearB) { s.gearKey = key; s.gearB = [e[0], e[1], e[2], top]; g.setBounds(s.gearB); }
        return;
      }
      const want = s.beat === 0 ? B0 : s.beat === 1 ? (stage.portrait ? BP1 : B1) : (stage.portrait ? BP2 : B2);
      if (g.bounds !== want) g.setBounds(want);
    };
    const B0 = [-6.3, -3.3, 6.3, 3.1];
    const B1 = [-6.6, -3.2, 6.6, 3.2], BP1 = [-6.2, -5.2, 5.6, 3.0];
    const B2 = [-6.9, -2.7, 6.9, 3.1], BP2 = [-6.7, -2.7, 6.7, 3.1];

    // beat 0: crank on gear 1
    stage.handle({
      pen: g, color: 'orange', r: 11, visible: () => s.beat === 0,
      get: () => { const L = layout(); return [L.c1[0] + L.r1 * 0.78 * Math.cos(s.th1), L.c1[1] + L.r1 * 0.78 * Math.sin(s.th1)]; },
      set: (p) => {
        const L = layout(); const a = Math.atan2(p[1] - L.c1[1], p[0] - L.c1[0]);
        let d = a - s.th1; d = Math.atan2(Math.sin(d), Math.cos(d));
        s.th1 += d; s.w1 = s.w1 * 0.7 + 0.3 * d / (1 / 60);
      },
      onStart: () => (s.drag = true), onEnd: () => { s.drag = false; s.w1 = clamp(s.w1, -3, 3); },
    });
    // beat 1: x on the top number line
    stage.handle({ pen: g, color: 'orange', r: 10, visible: () => s.beat === 1, get: () => [s.x0 * LINE_K, YX], set: (p) => (s.x0 = clamp(p[0] / LINE_K, -2.3, 2.3)) });
    // beat 2: one weight knob per machine
    const nodeX = (i) => -6 + 2.4 * i, boxX = (i) => nodeX(i) + 1.2, KY = (w) => -2.0 + w * 0.55;
    s.w.forEach((_, i) => stage.handle({
      pen: g, color: 'blue', r: 9, kind: 'square', visible: () => s.beat === 2,
      get: () => [boxX(i) - 0.2, KY(s.w[i])], set: (p) => (s.w[i] = clamp((p[1] + 2.0) / 0.55, 0.1, 3)),
    }));

    // controls per beat
    const groups = [ui.group(), ui.group(), ui.group()];
    ui.slider({ into: groups[0], icon: '🟠', color: 'orange', min: 8, max: 26, step: 1, value: s.n1, title: 'gear 1 size', onInput: (v) => (s.n1 = v) });
    ui.slider({ into: groups[0], icon: '🟢', color: 'teal', min: 6, max: 16, step: 1, value: s.np, title: 'small gear size', onInput: (v) => (s.np = v) });
    ui.slider({ into: groups[0], icon: '🩷', color: 'pink', min: 8, max: 26, step: 1, value: s.n3, title: 'gear 3 size', onInput: (v) => (s.n3 = v) });
    ui.slider({ into: groups[1], icon: '〰️', color: 'orange', min: 0.03, max: 0.4, step: 0.01, value: s.eps, title: 'wiggle size', onInput: (v) => (s.eps = v) });
    const xSl = ui.slider({ into: groups[2], icon: '🟠', color: 'orange', min: -2, max: 2, step: 0.01, value: s.chainX, title: 'input x₀', onInput: (v) => (s.chainX = v) });
    ui.button({ into: groups[2], icon: '🫥', title: 'vanishing', onClick: () => { s.w = [0.6, 0.5, 0.7, 0.5, 0.6]; } });
    ui.button({ into: groups[2], icon: '✅', title: 'balanced', onClick: () => { s.w = [1, 1, 1, 1, 1]; s.chainX = 0; xSl.set(0); } });
    ui.button({ into: groups[2], icon: '💥', title: 'exploding', onClick: () => { s.w = [2, 2.2, 1.9, 2.1, 2]; s.chainX = 0; xSl.set(0); } });
    ui.readout(() => {
      if (s.beat === 0) { const { k1, k2 } = ratios(); return '×' + fmt(k1 * k2, 2); }
      if (s.beat === 1) return '×' + fmt(d1(gg, f(s.x0)) * d1(f, s.x0), 2);
      return '×' + fmtBig(chain().prod);
    }, { icon: '🔍', color: 'gold', title: 'total stretch' });
    const showGroups = () => groups.forEach((gr, i) => (gr.style.display = i === s.beat ? '' : 'none'));
    ui.beats(['⚙️', '📏', '⛓️'], (b) => { s.beat = b; s.t = 0; showGroups(); fitBounds(); });
    showGroups(); fitBounds();

    function chain() {
      const us = [s.chainX], ks = [];
      for (let i = 0; i < 5; i++) {
        const w = s.w[i], u = us[i];
        ks.push(d1((v) => Math.tanh(w * v), u));
        us.push(Math.tanh(w * u));
      }
      return { us, ks, prod: ks.reduce((a, b) => a * b, 1) };
    }

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 0 && !s.drag) { s.w1 += (1.0 * Math.sign(s.w1 || 1) - s.w1) * Math.min(1, dt * 1.5); s.th1 += s.w1 * dt; }
      },
      draw() {
        fitBounds();
        if (s.beat === 0) drawGears();
        else if (s.beat === 1) drawLines();
        else drawChain();
      },
    };

    // ---------------------------------------------------------------- gears
    function drawGears() {
      const L = layout(), [a1, a2, a3] = angles(L), { k1, k2 } = ratios();
      const w1 = s.w1, w2 = k1 * w1, w3 = k2 * w2;
      g.grid({ step: 1, axes: false });
      drawGear(g, L.c2, s.n2, a2, 'teal', { fillA: 0.18 });
      drawGear(g, L.c2, s.np, a2, 'teal', { fillA: 0.45 });
      drawGear(g, L.c1, s.n1, a1, 'orange');
      drawGear(g, L.c3, s.n3, a3, 'pink');
      spinArrow(g, L.c1, L.r1 + 0.42, w1, 'orange');
      spinArrow(g, L.c2, L.r2 + 0.42, w2, 'teal');
      spinArrow(g, L.c3, L.r3 + 0.42, w3, 'pink');
      // mesh points glow
      const m12 = [L.c1[0] + L.r1, L.c1[1]];
      const m23 = [L.c2[0] + L.rp * Math.cos(L.phi), L.c2[1] + L.rp * Math.sin(L.phi)];
      g.dot(m12, 9, { color: alpha('blue', 0.5) });
      g.dot(m23, 9, { color: alpha('purple', 0.5) });
      g.emoji('✋', [L.c1[0] - L.r1 - 0.55, L.c1[1] + L.r1 * 0.4], 26);
      g.emoji(Math.abs(w3) > Math.abs(w1) * 1.05 ? '🐇' : Math.abs(w3) < Math.abs(w1) * 0.95 ? '🐢' : '🟰', [L.c3[0] + L.r3 + 0.6, L.c3[1] + L.r3 * 0.6], 26);
      // the chain of factors, as a row: ⚙️ ×k1 ⚙️ ×k2 ⚙️ = ×k1k2
      hudRow([['●', 'orange'], ['×' + fmt(k1, 2), 'blue'], ['●', 'teal'], ['×' + fmt(k2, 2), 'purple'], ['●', 'pink'], ['=', 'muted'], ['×' + fmt(k1 * k2, 2), 'gold']]);
    }
    function hudRow(toks) {
      const ctx = stage.hud.ctx, A = g.area;
      ctx.save();
      ctx.font = '800 18px ui-rounded, system-ui, sans-serif'; ctx.textBaseline = 'middle';
      const ws = toks.map(([t]) => ctx.measureText(t).width + 10), W = ws.reduce((a, b) => a + b, 0) + 16;
      const x0 = A.x + 12, y0 = A.y + 12;
      ctx.fillStyle = alpha('panel', 0.92); ctx.beginPath(); ctx.roundRect(x0, y0, W, 34, 10); ctx.fill();
      let x = x0 + 13;
      toks.forEach(([t, c], i) => { ctx.fillStyle = C[c]; ctx.fillText(t, x, y0 + 17); x += ws[i]; });
      ctx.restore();
    }

    // ---------------------------------------------------------------- number lines
    function drawLines() {
      const [vx0, , vx1] = g.view;
      const rows = [[YX, 'orange', 'x'], [YY, 'teal', 'y'], [YZ, 'pink', 'z']];
      // fan: where each tick lands
      for (let x = -2.4; x <= 2.401; x += 0.2) {
        const y = f(x), z = gg(y);
        g.line([x * LINE_K, YX], [y * LINE_K, YY], { color: alpha('teal', 0.22), width: 1.2 });
        g.line([y * LINE_K, YY], [clamp(z, -3.4, 3.4) * LINE_K, YZ], { color: alpha('pink', 0.22), width: 1.2 });
      }
      rows.forEach(([yy, c, nm]) => {
        g.line([-5.4, yy], [5.4, yy], { color: c, width: 3 });
        for (let k = -2; k <= 2; k++) { g.line([k * LINE_K, yy - 0.1], [k * LINE_K, yy + 0.1], { color: c, width: 2 }); g.text(String(k), [k * LINE_K, yy - 0.35], { color: alpha('muted', 0.9), size: 11 }); }
        g.text(nm, [-5.9, yy], { color: c, size: 22, weight: 800 });
      });
      g.text('f', [-5.9, (YX + YY) / 2], { color: 'blue', size: 18 });
      g.text('g', [-5.9, (YY + YZ) / 2], { color: 'purple', size: 18 });
      g.arrow([-5.9, YX - 0.4], [-5.9, YY + 0.4], { color: alpha('muted', 0.6), width: 1.5 });
      g.arrow([-5.9, YY - 0.4], [-5.9, YZ + 0.4], { color: alpha('muted', 0.6), width: 1.5 });

      const e = s.eps, x0 = s.x0, y0 = f(x0), z0 = gg(y0);
      const wig = Math.sin(s.t * 5);
      const xa = x0 - e, xb = x0 + e;
      // image intervals (true images, not linearised)
      const ys = [], zs = [];
      for (let i = 0; i <= 20; i++) { const x = xa + ((xb - xa) * i) / 20; ys.push(f(x)); zs.push(gg(f(x))); }
      const yr = [Math.min(...ys), Math.max(...ys)], zr = [Math.min(...zs), Math.max(...zs)];
      g.poly([[xa * LINE_K, YX], [xb * LINE_K, YX], [f(xb) * LINE_K, YY], [f(xa) * LINE_K, YY]], { fill: alpha('blue', 0.18), stroke: false });
      g.poly([[f(xa) * LINE_K, YY], [f(xb) * LINE_K, YY], [gg(f(xb)) * LINE_K, YZ], [gg(f(xa)) * LINE_K, YZ]], { fill: alpha('purple', 0.18), stroke: false });
      g.line([xa * LINE_K, YX], [xb * LINE_K, YX], { color: 'orange', width: 10 });
      g.line([yr[0] * LINE_K, YY], [yr[1] * LINE_K, YY], { color: 'teal', width: 10 });
      g.line([zr[0] * LINE_K, YZ], [zr[1] * LINE_K, YZ], { color: 'pink', width: 10 });
      const xw = x0 + e * wig;
      g.dot([xw * LINE_K, YX], 6, { color: 'ink' });
      g.dot([f(xw) * LINE_K, YY], 6, { color: 'ink' });
      g.dot([gg(f(xw)) * LINE_K, YZ], 6, { color: 'ink' });
      void z0;

      // magnifier bars (stretch factors) on the right
      const k1 = d1(f, x0), k2 = d1(gg, y0), k = k1 * k2;
      if (stage.portrait) {
        magnifier([-3, -4.0], k1, 'blue');
        magnifier([0, -4.0], k2, 'purple');
        magnifier([3, -4.0], k, 'gold', true);
        g.text('·', [-1.5, -4.0], { color: 'muted', size: 22 }); g.text('=', [1.5, -4.0], { color: 'muted', size: 22 });
      } else {
        const bx = Math.min(vx1 - 0.5, 6.1);
        magnifier([bx - 1.5, (YX + YY) / 2], k1, 'blue');
        magnifier([bx - 1.5, (YY + YZ) / 2], k2, 'purple');
        magnifier([bx, 0], k, 'gold', true);
      }
      void vx0;
    }
    function magnifier(p, k, color, big = false) {
      const h = clamp(Math.abs(k) * 0.55, 0.04, 2.0);
      g.bar(p[0] - 0.18, p[1] - h / 2, 0.36, h, { color: alpha(color, k < 0 ? 0.45 : 0.9) });
      if (k < 0) g.rrect(p[0] - 0.18, p[1] - h / 2, 0.36, h, 4, { color, width: 2, dash: [3, 3] });
      g.text('×' + fmt(k, 2), [p[0], p[1] + h / 2 + 0.3], { color, size: big ? 18 : 15, weight: 800 });
      g.emoji('🔍', [p[0], p[1] - h / 2 - 0.3], big ? 20 : 15);
    }

    // ---------------------------------------------------------------- long chain
    function drawChain() {
      const { us, ks, prod } = chain();
      const GAIN = 1.0;
      const amp0 = 0.25;
      let amp = amp0;
      const amps = [amp0];
      ks.forEach((k) => { amp *= Math.abs(k); amps.push(amp); });
      const wig = Math.sin(s.t * 5);
      // wires
      g.line([nodeX(0), 1.3], [nodeX(5), 1.3], { color: alpha('muted', 0.4), width: 2, dash: [4, 6] });
      for (let i = 0; i <= 5; i++) {
        const x = nodeX(i), a = amps[i] * GAIN;
        const c = i === 0 ? 'orange' : i === 5 ? 'pink' : 'teal';
        const hh = Math.min(a, 1.25);
        g.rrect(x - 0.32, 1.3 - 1.35, 0.64, 2.7, 10, { fill: alpha(c, 0.08), color: alpha(c, 0.5), width: 1.5 });
        g.bar(x - 0.2, 1.3 - hh, 0.4, 2 * hh, { color: alpha(c, 0.55) });
        // the wiggling value
        const sign = i === 0 ? 1 : Math.sign(ks.slice(0, i).reduce((p, k) => p * k, 1)) || 1;
        g.dot([x, 1.3 + clamp(a * wig * sign, -1.3, 1.3)], 7, { color: c, ring: 'bg' });
        if (a > 1.3) g.emoji('💥', [x, 2.85], 22);
        else if (a < 0.015) g.emoji('🫥', [x, 2.85], 22);
        g.text(['x₀', 'u₁', 'u₂', 'u₃', 'u₄', 'L'][i], [x, -0.35], { color: c, size: 15, weight: 800 });
      }
      // machines with weight knobs and factor bars
      for (let i = 0; i < 5; i++) {
        const x = boxX(i);
        g.arrow([x - 0.9, 1.3], [x + 0.9, 1.3], { color: alpha('muted', 0.7), width: 2 });
        g.rrect(x - 0.45, 0.95, 0.9, 0.7, 8, { fill: alpha('blue', 0.14), color: 'blue', width: 2 });
        drawTanh(x, 1.3);
        // weight knob track (w) and, beside it, the factor bar k on the same scale
        g.line([x - 0.2, KY(0.1)], [x - 0.2, KY(3)], { color: alpha('blue', 0.25), width: 6 });
        g.line([x - 0.5, KY(1)], [x + 0.55, KY(1)], { color: alpha('muted', 0.9), width: 1.5, dash: [3, 3] });
        const k = ks[i], h = clamp(Math.abs(k), 0.02, 3) * 0.55;
        g.bar(x + 0.12, KY(0), 0.3, h, { color: mix('blue', Math.abs(k) < 1 ? 'purple' : 'coral', Math.min(1, Math.abs(Math.log(Math.abs(k) + 1e-9)))) });
        g.text('×' + fmt(k, 2), [x + 0.27, KY(0) - 0.28], { color: 'blue', size: 13, weight: 800 });
      }
      g.text('w', [boxX(0) - 0.55, KY(2.6)], { color: 'blue', size: 15 });
      g.text('1', [boxX(0) - 0.7, KY(1)], { color: 'muted', size: 12 });
      // total
      const tot = prod;
      g.text('×' + fmtBig(tot), [nodeX(5), KY(0.6)], { color: 'gold', size: 20, weight: 800 });
      g.emoji('🔍', [nodeX(5), KY(1.4)], 20);
      void us;
    }
    function drawTanh(x, y) {
      const pts = []; for (let i = 0; i <= 20; i++) { const u = -1 + i / 10; pts.push([x + u * 0.32, y + Math.tanh(u * 2.5) * 0.24]); }
      g.path(pts, { color: 'blue', width: 2.5 });
    }
  },
};
const fmtBig = (v) => (Math.abs(v) >= 100 ? Math.round(v).toString() : Math.abs(v) < 0.01 ? v.toExponential(0) : fmt(v, 2));
void C;
