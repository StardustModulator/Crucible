// Eigenvectors: push a whole flower of arrows through a matrix. Most arrows
// get knocked sideways — but a few special ones only get longer or shorter.
// Those stubborn directions (gold) are the eigenvectors; how much they
// stretch is λ.
import { C, alpha, mix } from '../viz/palette.js';
import { mvec, vnorm, vscale, vdot, cross2, eig2, eigvec2, symEig } from '../core/linalg.js';
import { smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';
import { drawMatrix } from './matrix.js';

const N = 24;
const PETALS = Array.from({ length: N }, (_, k) => [Math.cos((2 * Math.PI * k) / N), Math.sin((2 * Math.PI * k) / N)]);

// Real eigen-directions of a 2×2 (deduplicated); [] when the eigenvalues are complex.
function eigenLines(A) {
  const sym = Math.abs(A[0][1] - A[1][0]) < 1e-9;
  if (sym) {
    const { values, vectors } = symEig(A);
    return values.map((l, i) => ({ l, v: [vectors[0][i], vectors[1][i]] }));
  }
  const ev = eig2(A);
  if (ev[0].im !== 0) return [];
  const out = [];
  for (const e of ev) {
    const v = eigvec2(A, e.re);
    if (!out.some((o) => Math.abs(cross2(o.v, v)) < 1e-4)) out.push({ l: e.re, v });
  }
  return out;
}

export default {
  eq: [
    [['A', 'blue'], ['v', 'gold'], ' = ', ['λ', 'gold'], ['v', 'gold'], '     (', ['v', 'gold'], ' stays on its own line)'],
    ['det(', ['A', 'blue'], ' − ', ['λ', 'gold'], 'I) = 0  ⇒  ', ['λ', 'gold'], '² − tr(', ['A', 'blue'], ')', ['λ', 'gold'], ' + det(', ['A', 'blue'], ') = 0'],
    [['A', 'blue'], 'ⁿ', ['x', 'teal'], ' ≈ c₁', ['λ₁', 'gold'], 'ⁿ', ['v₁', 'gold'], '   (biggest |', ['λ', 'gold'], '| wins)'],
    ['tr² < 4 det  ⇒  ', ['λ', 'purple'], ' = a ± b i  (no real lines: it spins)'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-2.5, -2.1, 2.5, 2.1]);
    const s = { i: [1.5, 0.3], j: [0.6, 0.8], beat: 0, t: 0, probe: [1.3 * Math.cos(1.2), 1.3 * Math.sin(1.2)], dirs: [], prev: [], n: 0, tick: 0, trails: [] };
    const A = () => [[s.i[0], s.j[0]], [s.i[1], s.j[1]]];
    const snap = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    stage.handle({ pen: g, color: 'red', get: () => s.i, set: (p) => { s.i = snap(p); resetPower(); } });
    stage.handle({ pen: g, color: 'green', get: () => s.j, set: (p) => { s.j = snap(p); resetPower(); } });
    stage.handle({
      pen: g, color: 'teal', kind: 'ring', r: 9, visible: () => s.beat === 1, get: () => s.probe,
      set: (p) => { const L = (vnorm(p) || 1) / 1.3; s.probe = [p[0] / L, p[1] / L]; },
    });

    function resetPower() {
      s.dirs = PETALS.map((p) => p.slice()); s.prev = s.dirs.map((d) => d.slice());
      s.n = 0; s.tick = 0; s.trails = s.dirs.map((d) => [d.slice()]); s.gain = NaN;
    }
    resetPower();
    const preset = (i, j) => () => { s.i = i; s.j = j; resetPower(); };

    ui.beats(['🌸', '🧭', '🔁', '🌀'], (b) => {
      s.beat = b; s.t = 0; resetPower();
      if (b === 3) { s.i = [0.8, 0.55]; s.j = [-0.55, 0.8]; }
      else if (b !== 0 && eigenLines(A()).length === 0) { s.i = [1.5, 0.3]; s.j = [0.6, 0.8]; }
    });
    ui.button({ icon: '↔️', title: 'stretch', onClick: preset([1.8, 0], [0, 0.6]) });
    ui.button({ icon: '🥚', title: 'symmetric', onClick: preset([1.4, 0.6], [0.6, 0.9]) });
    ui.button({ icon: '↗️', title: 'shear', onClick: preset([1, 0], [0.8, 1]) });
    ui.button({ icon: '🪞', title: 'mirror', onClick: preset([0.2, 1], [1, -0.2]) });
    ui.button({ icon: '🔄', title: 'turn', onClick: preset([0.8, 0.55], [-0.55, 0.8]) });
    const lamText = (k) => () => {
      const e = eig2(A());
      if (e[0].im !== 0) return `${fmt(e[0].re, 2)}${k ? '−' : '+'}${fmt(Math.abs(e[0].im), 2)}i`;
      return fmt(e[k].re, 2);
    };
    ui.readout(lamText(0), { icon: 'λ₁', color: 'gold', title: 'eigenvalue 1' });
    ui.readout(lamText(1), { icon: 'λ₂', color: 'gold', title: 'eigenvalue 2' });

    const turnAmt = (v, w) => Math.abs(cross2(v, w)) / ((vnorm(v) * vnorm(w)) || 1); // |sin| of the knock-sideways angle
    const petalColor = (sn) => (sn < 0.05 ? C.gold : sn < 0.2 ? mix('gold', 'blue', smoothstep((sn - 0.05) / 0.15)) : C.blue);

    function drawEigenLines(M, strong) {
      const lines = eigenLines(M);
      for (const { l, v } of lines) {
        g.line(vscale(v, -10), vscale(v, 10), { color: alpha('gold', strong ? 0.75 : 0.4), width: strong ? 3 : 2, dash: strong ? [] : [8, 6] });
        if (strong) {
          for (const sg of [1, -1]) {
            const u = vscale(v, sg);
            g.arrow([0, 0], u, { color: alpha('ink', 0.45), width: 3, dash: [5, 4] });
            g.arrow([0, 0], vscale(u, l), { color: 'gold', width: 6 });
          }
          const tip = vscale(v, Math.max(Math.abs(l), 1) + g.world(30));
          g.text(`λ=${fmt(l, 1)}`, Math.abs(tip[1]) < 2.3 && Math.abs(tip[0]) < 3 ? tip : vscale(v, 1.3), { size: 17, color: 'gold', weight: 800 });
        }
      }
      if (lines.length === 2 && Math.abs(M[0][1] - M[1][0]) < 1e-9) {
        // symmetric: the special lines meet at a right angle
        const a = lines[0].v, b = lines[1].v, r = 0.28;
        g.path([vscale(a, r), [a[0] * r + b[0] * r, a[1] * r + b[1] * r], vscale(b, r)], { color: alpha('gold', 0.9), width: 2 });
      }
      return lines;
    }

    function drawFlower(M, m, fade = 1) {
      // unit circle → ellipse
      g.circle([0, 0], 1, { color: alpha('muted', 0.4 * fade), width: 1.5, dash: [4, 5] });
      const ring = []; for (let k = 0; k <= 64; k++) { const a = (2 * Math.PI * k) / 64; const v = [Math.cos(a), Math.sin(a)]; ring.push(mvec(M, v).map((x, q) => (1 - m) * v[q] + m * x)); }
      g.path(ring, { color: alpha('blue', 0.35 * fade), width: 2 });
      for (const v of PETALS) {
        const w = mvec(M, v), u = [(1 - m) * v[0] + m * w[0], (1 - m) * v[1] + m * w[1]];
        const sn = turnAmt(v, w);
        const c = petalColor(sn);
        g.arrow([0, 0], u, { color: sn < 0.05 ? c : alpha(c, 0.75 * fade), width: sn < 0.05 ? 4 : 2.5, head: 9 });
      }
    }

    function drawProbe(M) {
      const v = s.probe, w = mvec(M, v), sn = turnAmt(v, w);
      const a0 = Math.atan2(v[1], v[0]);
      let da = Math.atan2(w[1], w[0]) - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const hit = sn < 0.04;
      if (!hit) g.wedge([0, 0], 0.7, a0, a0 + da, { color: 'coral', alpha: 0.28 });
      g.arrow([0, 0], w, { color: hit ? 'gold' : 'blue', width: 5 });
      g.arrow([0, 0], v, { color: 'teal', width: 4 });
      if (hit) g.emoji('✨', vscale(w, 1 + g.world(26) / (vnorm(w) || 1)), 26);
    }

    function stepPower(M) {
      s.prev = s.dirs.map((d) => d.slice());
      let gsum = 0;
      s.dirs = s.dirs.map((d) => { const w = mvec(M, d); const L = vnorm(w) || 1; gsum += L; return [w[0] / L, w[1] / L]; });
      s.gain = gsum / s.dirs.length;
      s.n++;
      s.dirs.forEach((d, k) => s.trails[k].push(d.slice()));
    }

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 2) {
          s.tick += dt;
          if (s.tick > 0.9) { s.tick = 0; if (s.n >= 14) resetPower(); else stepPower(A()); }
        }
      },
      draw() {
        const M = A();
        g.grid({ step: 1 });
        let lines = [];
        if (s.beat === 0) {
          const ph = (s.t % 5) / 5;
          const m = smoothstep(ph < 0.5 ? (ph - 0.08) / 0.3 : 1 - (ph - 0.6) / 0.3);
          drawFlower(M, m);
          lines = eigenLines(M);
        } else if (s.beat === 1) {
          drawFlower(M, 1, 0.35);
          lines = drawEigenLines(M, true);
          drawProbe(M);
        } else if (s.beat === 2) {
          lines = drawEigenLines(M, false);
          const k = smoothstep(s.tick / 0.5);
          s.trails.forEach((tr) => {
            const pts = [];
            for (let q = 1; q < tr.length; q++) {
              const a0 = Math.atan2(tr[q - 1][1], tr[q - 1][0]);
              let da = Math.atan2(tr[q][1], tr[q][0]) - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
              for (let r = 0; r <= 8; r++) { const a = a0 + (da * r) / 8; pts.push([1.6 * Math.cos(a), 1.6 * Math.sin(a)]); }
            }
            g.path(pts, { color: alpha('purple', 0.3), width: 2 });
          });
          s.dirs.forEach((d, q) => {
            const p = s.prev[q];
            let a0 = Math.atan2(p[1], p[0]), a1 = Math.atan2(d[1], d[0]);
            let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
            const a = a0 + da * k, u = [Math.cos(a) * 1.6, Math.sin(a) * 1.6];
            const sn = lines.length ? Math.min(...lines.map((L) => Math.abs(cross2(L.v, u) / 1.6))) : 1;
            g.arrow([0, 0], u, { color: petalColor(sn), width: 2.5, head: 9 });
          });
          g.text(`n=${s.n}`, [g.view[0] + g.world(50), g.view[1] + g.world(24)], { size: 18, color: 'purple', align: 'left' });
          if (Number.isFinite(s.gain)) g.text(`×${fmt(s.gain, 2)}`, [g.view[0] + g.world(50), g.view[1] + g.world(52)], { size: 18, color: 'gold', align: 'left' });
        } else {
          // complex: everything turns — follow one point as A is applied again and again
          const ph = (s.t % 5) / 5;
          drawFlower(M, smoothstep(ph < 0.5 ? (ph - 0.08) / 0.3 : 1 - (ph - 0.6) / 0.3), 0.8);
          let p = [1.9, 0];
          const pts = [p];
          for (let q = 0; q < 40; q++) { p = mvec(M, p); pts.push(p); if (vnorm(p) > 6) break; }
          g.path(pts, { color: alpha('purple', 0.7), width: 2 });
          const shown = Math.min(pts.length - 1, Math.floor(s.t * 3) % (pts.length + 6));
          pts.slice(0, shown + 1).forEach((q, k) => g.dot(q, k === shown ? 7 : 3.5, { color: k === shown ? 'purple' : alpha('purple', 0.6) }));
          if (eig2(M)[0].im !== 0) g.emoji('🌀', [g.view[0] + g.world(40), g.view[1] + g.world(36)], 30);
          lines = drawEigenLines(M, false);
        }
        if (s.beat === 0) for (const { v } of lines) g.line(vscale(v, -10), vscale(v, 10), { color: alpha('gold', 0.25), width: 2, dash: [3, 7] });
        // î and ĵ — the knobs that make the matrix
        g.arrow([0, 0], s.i, { color: alpha('red', 0.85), width: 3 });
        g.arrow([0, 0], s.j, { color: alpha('green', 0.85), width: 3 });
        g.dot([0, 0], 5, { color: 'ink' });
        drawMatrix(stage.hud, M);
        lambdaPlane(stage.hud, M);
      },
    };
  },
};

// Little λ-plane inset: real eigenvalues sit on the line (gold), complex ones float off it (purple).
function lambdaPlane(hud, M) {
  const ctx = hud.ctx, W = 128, H = 104, X = hud.area.w - W - 14, Y = 108;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(X, Y, W, H, 12); ctx.fill();
  const cx = X + W / 2, cy = Y + H / 2, sc = 22;
  ctx.strokeStyle = alpha('muted', 0.6); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X + 8, cy); ctx.lineTo(X + W - 8, cy); ctx.moveTo(cx, Y + 8); ctx.lineTo(cx, Y + H - 8); ctx.stroke();
  ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(cx, cy, sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  const e = eig2(M), cplx = e[0].im !== 0;
  for (const l of e) {
    const x = cx + Math.max(-2.6, Math.min(2.6, l.re)) * sc, y = cy - Math.max(-2, Math.min(2, l.im)) * sc;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = C[cplx ? 'purple' : 'gold']; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.bg; ctx.stroke();
  }
  ctx.font = '700 13px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('λ', X + 8, Y + 6);
  ctx.restore();
}
