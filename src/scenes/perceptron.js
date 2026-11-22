// A neuron is a tiny voting machine: each input is pushed through a wire whose
// thickness is how much it counts (its weight), everything is added up, and a
// step says yes / no. In the plane that yes/no is a straight line — a fence.
import { C, alpha } from '../viz/palette.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const POS = 'orange', NEG = 'blue';            // 🍊 = +1, 🫐 = −1 (tints match the fruit)
const FRUIT = { 1: '🍊', '-1': '🫐' };

function makeData(kind, seed) {
  const r = rng(seed);
  const pts = [];
  if (kind === 'xor') {
    for (const [cx, cy, y] of [[1.4, 1.4, 1], [-1.4, -1.4, 1], [1.4, -1.4, -1], [-1.4, 1.4, -1]])
      for (let i = 0; i < 4; i++) pts.push({ p: [cx + r.normal(0, 0.35), cy + r.normal(0, 0.35)], y });
  } else {
    // two separable clumps whose best fence is tilted
    for (let i = 0; i < 9; i++) pts.push({ p: [r.normal(1.2, 0.55), r.normal(0.9, 0.55)], y: 1 });
    for (let i = 0; i < 9; i++) pts.push({ p: [r.normal(-1.0, 0.55), r.normal(-1.1, 0.55)], y: -1 });
  }
  return pts;
}

// keep the part of polygon where f ≥ 0 (one Sutherland–Hodgman pass)
function clipHalf(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

export default {
  eq: [
    [['z', 'gold'], ' = ', ['w₁', 'blue'], ['x₁', 'teal'], ' + ', ['w₂', 'blue'], ['x₂', 'teal'], ' + ', ['b', 'blue']],
    [['ŷ', 'pink'], ' = step(', ['z', 'gold'], ')     🍊 if ', ['z', 'gold'], ' > 0,   🫐 if ', ['z', 'gold'], ' < 0'],
    ['the fence:  ', ['w', 'blue'], ' · ', ['x', 'teal'], ' + ', ['b', 'blue'], ' = 0     (', ['w', 'blue'], ' points to the 🍊 side)'],
    ['on a mistake:  ', ['w', 'blue'], ' ← ', ['w', 'blue'], ' + η ', ['y', 'lime'], ' ', ['x', 'teal'], ' ,   ', ['b', 'blue'], ' ← ', ['b', 'blue'], ' + η ', ['y', 'lime'], '      (', ['y', 'lime'], ' = ±1)'],
    ['XOR: no single ', ['w', 'blue'], ', ', ['b', 'blue'], ' gets all four corners right  😵'],
  ],
  setup({ stage, ui }) {
    const [N, P] = stage.split([[0, -2.1, 10, 2.1], [-3, -3, 3, 3]], [0.8, 1.2]);
    const s = {
      beat: 0, w: [0.35, 1.0], b: 0.3, a: [[-1, 0], [1, 0]], probe: [1.3, 0.6], t: 0,
      data: makeData('blobs', 3), seed: 3, add: 1, eta: 0.3, clock: 0, tug: null, hist: [], best: 0, step: 0,
    };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
    const z = (p) => dot(s.w, p) + s.b;
    const wn = () => Math.hypot(s.w[0], s.w[1]) || 1e-9;
    const proj = (p) => { const k = z(p) / wn() ** 2; return [p[0] - k * s.w[0], p[1] - k * s.w[1]]; };
    const BOX = 2.75;
    // where the fence crosses the box [-BOX, BOX]²
    const segment = () => {
      const n = wn(), d = [-s.w[1] / n, s.w[0] / n], p0 = proj([0, 0]);
      let t0 = -1e9, t1 = 1e9;
      for (let k = 0; k < 2; k++) {
        if (Math.abs(d[k]) < 1e-9) { if (Math.abs(p0[k]) > BOX) return null; continue; }
        let ta = (-BOX - p0[k]) / d[k], tb = (BOX - p0[k]) / d[k];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 > t1) return null;
      return [[p0[0] + d[0] * t0, p0[1] + d[1] * t0], [p0[0] + d[0] * t1, p0[1] + d[1] * t1]];
    };
    const reanchor = () => {
      const sg = segment();
      if (!sg) { s.a = [proj([0, 0]), proj([0, 0])].map((p, i) => [p[0] + (i ? 1 : -1) * -s.w[1], p[1] + (i ? 1 : -1) * s.w[0]]); return; }
      const [A, B] = sg;
      s.a = [[A[0] + (B[0] - A[0]) * 0.2, A[1] + (B[1] - A[1]) * 0.2], [A[0] + (B[0] - A[0]) * 0.8, A[1] + (B[1] - A[1]) * 0.8]];
    };
    const refit = () => {
      const [a1, a2] = s.a, d = [a2[0] - a1[0], a2[1] - a1[1]], L = Math.hypot(...d);
      if (L < 0.15) return;
      let n = [-d[1] / L, d[0] / L];
      if (dot(n, s.w) < 0) n = [-n[0], -n[1]];
      const m = wn();
      s.w = [n[0] * m, n[1] * m];
      s.b = -dot(s.w, a1);
    };
    reanchor();
    const correct = () => s.data.filter((d) => Math.sign(z(d.p) || -1) === d.y).length;

    const inBox = (p) => [clamp(p[0], -2.9, 2.9), clamp(p[1], -2.9, 2.9)];
    for (let i = 0; i < 2; i++) {
      stage.handle({ pen: P, color: 'blue', r: 10, get: () => proj(s.a[i]), set: (p) => { s.a[i] = inBox(p); refit(); }, onEnd: () => reanchor() });
    }
    stage.handle({ pen: P, color: 'teal', kind: 'ring', r: 12, visible: () => s.beat <= 1, get: () => s.probe, set: (p) => (s.probe = inBox(p)) });
    // click empty space to drop a fruit
    stage.on('down', (e) => {
      if (e.pen !== P) return;
      const p = e.p;
      if (Math.abs(p[0]) > 3 || Math.abs(p[1]) > 3) return;
      const hit = s.data.findIndex((d) => Math.hypot(d.p[0] - p[0], d.p[1] - p[1]) < 0.22);
      if (hit >= 0) s.data.splice(hit, 1); else s.data.push({ p: inBox(p), y: s.add });
      s.hist = [];
    });

    const reset = (kind) => {
      s.data = makeData(kind, s.seed);
      s.hist = []; s.tug = null; s.best = 0; s.step = 0;
    };
    ui.beats(['🔘', '✂️', '🏃', '😵'], (b) => {
      s.beat = b; s.t = 0; s.clock = 0;
      if (b === 3) { reset('xor'); s.w = [0.9, 0.3]; s.b = 0.2; }
      else if (s.data.length === 16 && b < 3) { reset('blobs'); }
      if (b === 2) { s.w = [-1.0, 0.25]; s.b = 0.5; s.hist = []; }
      reanchor();
    });
    ui.choice({ value: 1, options: [{ icon: '🍊', value: 1, title: 'drop oranges', color: POS }, { icon: '🫐', value: -1, title: 'drop blueberries', color: NEG }], onChange: (v) => (s.add = v) });
    ui.slider({ icon: '👣', color: 'coral', min: 0.05, max: 1, value: s.eta, title: 'learning rate η', onInput: (v) => (s.eta = v) });
    ui.button({ icon: '🎲', title: 'new fruit + new fence', onClick: () => {
      s.seed += 7; reset(s.beat === 3 ? 'xor' : 'blobs');
      const r = rng(s.seed); const th = r.uniform(0, 6.28); s.w = [Math.cos(th), Math.sin(th)]; s.b = r.uniform(-1, 1); reanchor();
    } });
    ui.readout(() => `${correct()}/${s.data.length}`, { icon: '✅', color: 'lime', title: 'fruit on the right side' });

    // one perceptron update on the next misclassified fruit (cycling through the data)
    const learnStep = () => {
      const n = s.data.length;
      for (let k = 0; k < n; k++) {
        const i = (s.step + k) % n, d = s.data[i];
        if (Math.sign(z(d.p) || -1) !== d.y) {
          const before = proj(d.p);
          s.w = [s.w[0] + s.eta * d.y * d.p[0], s.w[1] + s.eta * d.y * d.p[1]];
          s.b += s.eta * d.y;
          s.tug = { from: before, to: d.p, y: d.y, life: 1 };
          s.step = i + 1;
          reanchor();
          return true;
        }
      }
      return false;
    };

    return {
      update(dt) {
        dt = Math.max(0, dt);                 // the shell can hand a tiny negative dt right after ⏭
        s.t += dt;
        if (s.tug) s.tug.life -= dt * 2.2;
        if (s.beat >= 2) {
          s.clock += dt;
          if (s.clock > 0.6) {
            s.clock = 0;
            const moved = learnStep();
            const c = correct();
            s.best = Math.max(s.best, c);
            if (moved || s.hist.length === 0) { s.hist.push(s.data.length - c); if (s.hist.length > 60) s.hist.shift(); }
          }
        }
      },
      draw() {
        drawPlane();
        drawNeuron();
      },
    };

    function drawPlane() {
      const g = P;
      g.clip(() => {
        const [vx0, vy0, vx1, vy1] = g.view, box = [[vx0, vy0], [vx1, vy0], [vx1, vy1], [vx0, vy1]];
        const pos = clipHalf(box, z), neg = clipHalf(box, (p) => -z(p));
        if (pos.length > 2) g.poly(pos, { fill: alpha(POS, 0.13), stroke: false });
        if (neg.length > 2) g.poly(neg, { fill: alpha(NEG, 0.13), stroke: false });
        g.grid({ step: 1 });
        // the fence
        const n = wn(), d = [-s.w[1] / n, s.w[0] / n], p0 = proj([0, 0]);
        g.line([p0[0] - d[0] * 9, p0[1] - d[1] * 9], [p0[0] + d[0] * 9, p0[1] + d[1] * 9], { color: 'blue', width: 4 });
        // w arrow: sticks out toward the 🍊 side
        const m = proj([(s.a[0][0] + s.a[1][0]) / 2, (s.a[0][1] + s.a[1][1]) / 2]);
        const k = 0.9 / n;
        g.arrow(m, [m[0] + s.w[0] * k, m[1] + s.w[1] * k], { color: 'blue', width: 3 });
        g.text('w', [m[0] + s.w[0] * k * 1.35, m[1] + s.w[1] * k * 1.35], { color: 'blue', size: 17, weight: 700 });

        // how far each fruit sits from the fence (that distance is z / |w|)
        if (s.beat === 1) for (const dd of s.data) {
          const ok = Math.sign(z(dd.p) || -1) === dd.y;
          g.line(dd.p, proj(dd.p), { color: alpha(ok ? 'lime' : 'coral', 0.8), width: 2, dash: [4, 4] });
        }
        // fruit
        for (const dd of s.data) {
          const ok = Math.sign(z(dd.p) || -1) === dd.y;
          if (!ok && s.beat >= 1) {
            g.dot(dd.p, 15, { color: alpha('coral', 0.18 + 0.12 * Math.sin(s.t * 6)) });
            g.circle(dd.p, g.world(15), { color: 'coral', width: 2.5, stroke: true });
          }
          g.emoji(FRUIT[dd.y], dd.p, 21);
        }
        // the tug of the last mistake
        if (s.tug && s.tug.life > 0) {
          const { from, to, y } = s.tug;
          g.arrow(from, to, { color: alpha('coral', clamp(s.tug.life, 0, 1)), width: 4 });
          g.emoji(y > 0 ? '🍊' : '🫐', [to[0], to[1] + 0.42], 15, { alpha: clamp(s.tug.life, 0, 1) });
        }
        if (s.beat >= 2 && correct() === s.data.length) g.emoji('🎉', [2.4, 2.4], 30);
        if (s.beat === 3) g.emoji('😵', [2.4, 2.4], 30 + 3 * Math.sin(s.t * 4));
        // probe
        if (s.beat <= 1) {
          const zz = z(s.probe);
          g.emoji(zz > 0 ? '🍊' : '🫐', [s.probe[0] + 0.42, s.probe[1] + 0.42], 16, { alpha: 0.85 });
        }
      });
      // mistakes over time (sparkline, bottom-left corner of the plane)
      if (s.beat >= 2 && s.hist.length > 1) {
        const ctx = stage.ctx, r = P.area;
        const W = Math.min(150, r.w * 0.36), H = 46, x0 = r.x + 10, y0 = r.y + r.h - H - 10;
        ctx.save();
        ctx.fillStyle = alpha('panel', 0.9); ctx.beginPath(); ctx.roundRect(x0, y0, W, H, 8); ctx.fill();
        const mx = Math.max(4, ...s.hist);
        ctx.strokeStyle = C.coral; ctx.lineWidth = 2; ctx.beginPath();
        s.hist.forEach((v, i) => { const x = x0 + 22 + (i / Math.max(12, s.hist.length - 1)) * (W - 30), y = y0 + H - 6 - (v / mx) * (H - 12); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
        ctx.font = '13px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('❌', x0 + 11, y0 + H / 2);
        ctx.restore();
      }
    }

    function drawNeuron() {
      const g = N;
      const x = s.beat <= 1 ? s.probe : (s.tug && s.tug.life > 0 ? s.tug.to : s.probe);
      const ins = [[1.0, 1.35], [1.0, 0.0], [1.0, -1.35]];
      const vals = [x[0], x[1], 1];
      const ws = [s.w[0], s.w[1], s.b];
      const S = [4.6, 0];
      const zz = ws[0] * vals[0] + ws[1] * vals[1] + ws[2];
      // wires: thickness = |weight|, color = sign
      for (let i = 0; i < 3; i++) {
        const wc = ws[i] >= 0 ? 'blue' : 'coral';
        g.line(ins[i], S, { color: alpha(wc, 0.85), width: 2 + 7 * Math.min(Math.abs(ws[i]), 2.2) });
        // flowing beads: size = |w·x|, color = sign of the push
        const push = ws[i] * vals[i], pc = push >= 0 ? 'blue' : 'coral';
        for (let k = 0; k < 3; k++) {
          const f = ((s.t * 0.6 + k / 3) % 1);
          const p = [ins[i][0] + (S[0] - ins[i][0]) * f, ins[i][1] + (S[1] - ins[i][1]) * f];
          g.dot(p, 2.5 + 5 * Math.min(Math.sqrt(Math.abs(push)), 1.8), { color: pc, ring: 'bg', ringWidth: 1.5 });
        }
        const mid = [ins[i][0] + (S[0] - ins[i][0]) * 0.52, ins[i][1] + (S[1] - ins[i][1]) * 0.52 + 0.33];
        g.text(fmt(ws[i], 1), mid, { color: wc, size: 13, weight: 700 });
      }
      // inputs
      ['x₁', 'x₂', '1'].forEach((lab, i) => {
        g.circle(ins[i], 0.42, { fill: 'bg' });
        g.circle(ins[i], 0.42, { fill: i < 2 ? alpha('teal', 0.25) : alpha('muted', 0.15), color: i < 2 ? 'teal' : 'muted', width: 2.5, stroke: true });
        g.text(i < 2 ? fmt(vals[i], 1) : '1', ins[i], { color: i < 2 ? 'teal' : 'muted', size: 14, weight: 700 });
      });
      // sum node
      const zc = zz >= 0 ? POS : NEG;
      g.circle(S, 0.7, { fill: 'bg' });
      g.circle(S, 0.7, { fill: alpha(zc, 0.2), color: 'gold', width: 3, stroke: true });
      g.text('Σ', [S[0], S[1] + 0.22], { color: 'gold', size: 20, weight: 800 });
      g.text(fmt(zz, 1), [S[0], S[1] - 0.3], { color: 'gold', size: 13, weight: 700 });
      // step box
      const B = [6.0, -0.9, 2.1, 1.8];
      g.line([S[0] + 0.7, 0], [B[0], 0], { color: 'gold', width: 3, stroke: true });
      g.rrect(B[0], B[1], B[2], B[3], 10, { fill: alpha('panel', 1), color: 'faint', width: 1.5, stroke: true });
      const cx = B[0] + B[2] / 2, sx = (v) => cx + clamp(v, -3, 3) * 0.3;
      g.line([B[0] + 0.1, 0], [B[0] + B[2] - 0.1, 0], { color: 'faint', width: 1 });
      g.path([[B[0] + 0.15, -0.55], [cx, -0.55], [cx, 0.55], [B[0] + B[2] - 0.15, 0.55]], { color: 'ink', width: 2.5, stroke: true });
      g.dot([sx(zz), zz > 0 ? 0.55 : -0.55], 6, { color: 'gold', ring: 'bg' });
      // output
      g.arrow([B[0] + B[2], 0], [8.75, 0], { color: 'pink', width: 3 });
      g.circle([9.35, 0], 0.55, { fill: alpha('pink', 0.15), color: 'pink', width: 2.5, stroke: true });
      g.emoji(zz > 0 ? '🍊' : '🫐', [9.35, 0], 30);
    }
  },
};
