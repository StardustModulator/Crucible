// Monte Carlo: answer hard questions by throwing lots of random darts.
// Fraction of darts inside the circle → π. Inside a weird blob → its area.
// Darts from the "wrong" bell get weights (importance sampling), and uniform
// darts bounced off a CDF curve land as a bell (inverse-CDF sampling).
import { C, alpha } from '../viz/palette.js';
import { gauss1, effectiveSampleSize } from '../core/estimation.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const Z = { x: 0, y: 0, w: 0, h: 0 };
const TARGET = (x) => 0.65 * gauss1(x, 1.4, 0.6) + 0.35 * gauss1(x, -1.3, 0.55);
const DISTS = {
  bell: (x) => gauss1(x, 0, 1),
  camel: (x) => 0.5 * gauss1(x, -1.5, 0.6) + 0.5 * gauss1(x, 1.5, 0.6),
  slope: (x) => (x < -3 ? 0 : 0.9 * Math.exp(-0.9 * (x + 3))),
};

export default {
  eq: [
    ['π ≈ 4 · ', ['inside', 'teal'], ' / ', ['all', 'muted'], '        error ∝ ', ['1/√n', 'purple']],
    ['area ≈ ', ['box', 'muted'], ' · ', ['hits', 'teal'], ' / n'],
    ['E', ['p', 'lime'], '[f] ≈ Σ wᵢ f(xᵢ) / Σ wᵢ ,   xᵢ ~ ', ['q', 'blue'], ' ,   ', ['wᵢ = p(xᵢ) / q(xᵢ)', 'gold']],
    ['u ~ U(0,1)  →  x = ', ['F⁻¹(u)', 'blue'], '  ~ ', ['p', 'lime']],
  ],
  setup({ stage, ui }) {
    const R = rng(3);
    const wide = (W, H) => W >= H * 1.05;
    const s = {
      beat: 0, darts: [], hits: 0, hist: [], rate: 0, acc: 0,
      blob: [1.2, 0.8, 1.35, 0.7, 1.1, 1.3, 0.65], blobArea: 0,
      mq: -0.5, sq: 1.6, zs: Array.from({ length: 260 }, () => R.normal()),
      dist: 'bell', drops: [], bins: new Array(36).fill(0), spawn: 0,
    };
    const two = () => s.beat <= 1;
    const PL = stage.pen((W, H) => (!two() ? Z : wide(W, H) ? { x: 0, y: 0, w: 0.5, h: 1 } : { x: 0, y: 0, w: 1, h: 0.6 }), [-1.2, -1.2, 1.2, 1.2], { frame: true });
    const PR = stage.pen((W, H) => (!two() ? Z : wide(W, H) ? { x: 0.5, y: 0, w: 0.5, h: 1 } : { x: 0, y: 0.6, w: 1, h: 0.4 }), [-0.3, 0, 10.3, 1], { frame: true });
    const g = stage.g;

    // blob boundary: periodic Catmull–Rom through 7 radii
    const blobR = (th) => {
      const n = s.blob.length, u = ((th / (2 * Math.PI)) * n % n + n) % n, i = Math.floor(u), t = u - i;
      const p0 = s.blob[(i - 1 + n) % n], p1 = s.blob[i], p2 = s.blob[(i + 1) % n], p3 = s.blob[(i + 2) % n];
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    };
    const inBlob = ([x, y]) => Math.hypot(x, y) <= blobR(Math.atan2(y, x));
    const blobPoly = () => Array.from({ length: 240 }, (_, i) => { const th = (i / 240) * 2 * Math.PI, r = blobR(th); return [r * Math.cos(th), r * Math.sin(th)]; });
    const shoelace = (P) => Math.abs(P.reduce((a, p, i) => { const q = P[(i + 1) % P.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    const BOX = () => (s.beat === 0 ? 1 : 1.5); // half-size of the dart box
    const truth = () => (s.beat === 0 ? Math.PI : s.blobArea);
    const resetDarts = () => { s.darts = []; s.hits = 0; s.hist = []; s.rate = 0; s.acc = 0; s.blobArea = shoelace(blobPoly()); };

    s.blob.forEach((_, i) => stage.handle({
      pen: PL, color: 'lime', r: 8, visible: () => s.beat === 1,
      get: () => { const th = (i / s.blob.length) * 2 * Math.PI; return [s.blob[i] * Math.cos(th), s.blob[i] * Math.sin(th)]; },
      set: (p) => { const th = (i / s.blob.length) * 2 * Math.PI; s.blob[i] = clamp(p[0] * Math.cos(th) + p[1] * Math.sin(th), 0.25, 1.45); resetDarts(); },
    }));
    const qPeak = () => [s.mq, gauss1(s.mq, s.mq, s.sq) * 3];
    stage.handle({ pen: g, color: 'blue', r: 10, visible: () => s.beat === 2, get: qPeak, set: (p) => { s.mq = clamp(p[0], -4, 4); s.sq = clamp(3 / (Math.sqrt(2 * Math.PI) * clamp(p[1], 0.3, 3)), 0.4, 3); } });

    const groups = [ui.group(), ui.group(), ui.group()];
    ui.button({ into: groups[0], icon: '🔁', title: 'again', onClick: resetDarts });
    ui.choice({ into: groups[2], value: s.dist, color: 'lime', options: [{ icon: '🔔', value: 'bell', title: 'bell' }, { icon: '🐫', value: 'camel', title: 'two humps' }, { icon: '📉', value: 'slope', title: 'falling' }], onChange: (v) => { s.dist = v; s.bins.fill(0); s.drops = []; prefill(); } });
    ui.readout(() => {
      if (s.beat <= 1) return s.darts.length ? fmt((s.hits / s.darts.length) * 4 * BOX() * BOX(), 3) : '…';
      if (s.beat === 2) return 'n̂ ' + Math.round(effectiveSampleSize(weights()));
      return String(s.bins.reduce((a, b) => a + b, 0));
    }, { icon: '🔵', color: 'blue', title: 'estimate' });
    const showGroups = () => groups.forEach((gr, i) => (gr.style.display = i === (s.beat <= 1 ? 0 : s.beat - 1) ? '' : 'none'));
    ui.beats(['🎯', '🫧', '⚖️', '🪜'], (b) => {
      s.beat = b; PL.layout(); PR.layout();
      PL.setBounds(b === 0 ? [-1.15, -1.15, 1.15, 1.15] : [-1.6, -1.6, 1.6, 1.6]);
      PR.setBounds(b === 0 ? [-0.3, 2.35, 10.3, 3.95] : [-0.3, 0, 10.3, 1]);
      g.setBounds(b === 2 ? [-5, -0.9, 5, 3.0] : [-4.6, -2.0, 4.6, 3.0]);
      resetDarts(); showGroups();
    });
    PR.setBounds([-0.3, 2.35, 10.3, 3.95]);
    function prefill() { for (let i = 0; i < 400; i++) { const x = invCdf(R()); const b = Math.floor((x + 4.5) / 9 * s.bins.length); if (b >= 0 && b < s.bins.length) s.bins[b]++; } }
    showGroups(); resetDarts();

    function weights() { return s.zs.map((z) => { const x = s.mq + s.sq * z; return TARGET(x) / gauss1(x, s.mq, s.sq); }); }
    const cdf = (x) => { const f = DISTS[s.dist]; let a = 0; const n = 160, x0 = -4.5; for (let i = 0; i < n; i++) { const u = x0 + ((x - x0) * (i + 0.5)) / n; a += f(u); } return (a * (x - x0)) / n; };
    let cdfCache = { key: null };
    const cdfTable = () => {
      if (cdfCache.key === s.dist) return cdfCache;
      const xs = [], Fs = []; let a = 0; const f = DISTS[s.dist];
      for (let i = 0; i <= 600; i++) { const x = -4.5 + 9 * i / 600; if (i) a += (f(x) + f(x - 0.015)) / 2 * 0.015; xs.push(x); Fs.push(a); }
      const tot = a; cdfCache = { key: s.dist, xs, Fs: Fs.map((v) => v / tot) };
      return cdfCache;
    };
    const invCdf = (u) => { const { xs, Fs } = cdfTable(); let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Fs[m] < u) lo = m; else hi = m; } const t = (u - Fs[lo]) / ((Fs[hi] - Fs[lo]) || 1); return xs[lo] + (xs[hi] - xs[lo]) * t; };
    void cdf;
    prefill();

    return {
      update(dt) {
        if (s.beat <= 1) {
          s.rate = Math.min(700, s.rate + dt * (8 + s.rate * 1.5));
          s.acc += dt * s.rate;
          const B = BOX();
          while (s.acc > 1 && s.darts.length < 8000) {
            s.acc -= 1;
            const p = [R.uniform(-B, B), R.uniform(-B, B)];
            const hit = s.beat === 0 ? p[0] * p[0] + p[1] * p[1] <= 1 : inBlob(p);
            s.darts.push([p[0], p[1], hit]); if (hit) s.hits++;
            const n = s.darts.length;
            if (n < 50 || n % 5 === 0) s.hist.push([n, (s.hits / n) * 4 * B * B]);
          }
        } else if (s.beat === 3) {
          s.spawn += dt * 9;
          while (s.spawn > 1) { s.spawn -= 1; const u = R(); s.drops.push({ u, x: invCdf(u), ph: 0 }); }
          for (const d of s.drops) d.ph += dt * 1.6;
          s.drops = s.drops.filter((d) => {
            if (d.ph < 2) return true;
            const b = Math.floor((d.x + 4.5) / 9 * s.bins.length); if (b >= 0 && b < s.bins.length) s.bins[b]++;
            return false;
          });
        }
      },
      draw() {
        if (s.beat <= 1) { drawDarts(); drawConv(); } else if (s.beat === 2) drawImportance(); else drawInverse();
      },
    };

    // ---------------------------------------------------------------- darts
    function drawDarts() {
      const P = PL, B = BOX();
      P.grid({ step: 0.5, axes: false });
      P.rect(-B, -B, 2 * B, 2 * B, { fill: alpha('slate', 0.08), color: 'slate', width: 2.5 });
      if (s.beat === 0) P.circle([0, 0], 1, { fill: alpha('lime', 0.1), color: 'lime', width: 3 });
      else P.poly(blobPoly(), { fill: alpha('lime', 0.1), color: 'lime', width: 3 });
      const n = s.darts.length, r = n < 300 ? 4 : n < 2000 ? 2.6 : 1.8;
      const ctx = P.ctx;
      for (const [hit, colr] of [[true, C.teal], [false, alpha('slate', 0.6)]]) {
        ctx.fillStyle = colr; ctx.beginPath();
        for (const d of s.darts) if (d[2] === hit) { const [x, y] = P.toScreen(d); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 7); }
        ctx.fill();
      }
      for (const d of s.darts.slice(-3)) P.emoji('🎯', [d[0], d[1]], 18);
    }
    function drawConv() {
      const P = PR, tr = truth(), B = BOX();
      const [, y0, , y1] = P.bounds, span = y1 - y0, mid = (y0 + y1) / 2;
      // plot y-range is centred on the truth
      const Y = (v) => mid + (v - tr) * (span / (s.beat === 0 ? 1.6 : tr * 0.8));
      const X = (n) => Math.log10(n) * 2.5;
      P.grid({ step: 2.5, axes: false });
      // the funnel: how far off a typical estimate is after n darts
      const xs = [], lo = [], hi = [];
      const p = tr / (4 * B * B), sd = 4 * B * B * Math.sqrt(p * (1 - p));
      for (let i = 0; i <= 80; i++) { const n = 10 ** (i / 20); xs.push(X(n)); lo.push(Y(tr - 2 * sd / Math.sqrt(n))); hi.push(Y(tr + 2 * sd / Math.sqrt(n))); }
      P.clip(() => {
        P.band(xs, lo, hi, { color: 'purple', alpha: 0.16 });
        P.line([0, Y(tr)], [10, Y(tr)], { color: 'lime', width: 3 });
        P.path(s.hist.map(([n, v]) => [X(n), Y(v)]), { color: 'blue', width: 2.5 });
        if (s.hist.length) P.dot([X(s.hist[s.hist.length - 1][0]), Y(s.hist[s.hist.length - 1][1])], 6, { color: 'blue', ring: 'bg' });
      });
      if (s.beat === 0) P.text('π', [10.0, Y(tr) + span * 0.07], { color: 'lime', size: 22, weight: 800 });
      for (const n of [10, 100, 1000]) P.text(String(n), [X(n), y0 + span * 0.04], { color: 'muted', size: 11 });
    }

    // ---------------------------------------------------------------- importance sampling
    function drawImportance() {
      g.grid({ step: 1, axes: false });
      const K = 3, w = weights(), wsum = w.reduce((a, b) => a + b, 0), wmax = Math.max(...w);
      const xs = s.zs.map((z) => s.mq + s.sq * z);
      // weighted histogram → should look like p
      const nb = 40, x0 = -5, bw = 10 / nb, H = new Array(nb).fill(0);
      xs.forEach((x, i) => { const b = Math.floor((x - x0) / bw); if (b >= 0 && b < nb) H[b] += w[i] / wsum / bw; });
      H.forEach((h, b) => { if (h > 0) g.bar(x0 + b * bw + bw * 0.08, 0, bw * 0.84, h * K, { color: alpha('teal', 0.45), r: 2 }); });
      g.line([-5, 0], [5, 0], { color: 'slate', width: 2 });
      g.plot((x) => TARGET(x) * K, { color: 'lime', width: 4 });
      g.plot((x) => gauss1(x, s.mq, s.sq) * K, { color: 'blue', width: 3, dash: [8, 6] });
      // weight curve p/q (gold), squashed to fit
      g.plot((x) => clamp(TARGET(x) / gauss1(x, s.mq, s.sq), 0, 6) * 0.35, { color: alpha('gold', 0.8), width: 2, dash: [3, 4] });
      // the samples, sized by weight
      xs.forEach((x, i) => g.dot([x, -0.45 + ((i * 7) % 5) * 0.07], 1.5 + 9 * Math.sqrt(w[i] / wmax), { color: alpha('teal', 0.55) }));
      g.text('p', [1.4, TARGET(1.4) * K + 0.25], { color: 'lime', size: 20, weight: 800 });
      g.text('q', [s.mq + 0.35, gauss1(s.mq, s.mq, s.sq) * K + 0.25], { color: 'blue', size: 20, weight: 800 });
      g.text('w', [3.4, clamp(TARGET(3.4) / gauss1(3.4, s.mq, s.sq), 0, 6) * 0.35 + 0.3], { color: 'gold', size: 18, weight: 800 });
    }

    // ---------------------------------------------------------------- inverse CDF
    function drawInverse() {
      g.grid({ step: 1, axes: false });
      const H = 2.6, Yc = (u) => 0.15 + u * H, base = -1.85, f = DISTS[s.dist];
      const { xs, Fs } = cdfTable();
      g.line([-4.5, Yc(0)], [4.5, Yc(0)], { color: alpha('muted', 0.5), width: 1 });
      g.line([-4.5, Yc(1)], [4.5, Yc(1)], { color: alpha('muted', 0.5), width: 1, dash: [3, 4] });
      g.line([-4.5, Yc(0)], [-4.5, Yc(1)], { color: 'orange', width: 4 });
      g.text('u', [-4.5, Yc(1) + 0.25], { color: 'orange', size: 16, weight: 800 });
      g.path(xs.map((x, i) => [x, Yc(Fs[i])]), { color: 'blue', width: 4 });
      g.text('F', [3.9, Yc(1) - 0.25], { color: 'blue', size: 18, weight: 800 });
      // histogram + target density
      const total = s.bins.reduce((a, b) => a + b, 0), bw = 9 / s.bins.length;
      const peak = Math.max(...xs.map(f)), Kd = 1.45 / peak;
      s.bins.forEach((c, b) => { if (c) g.bar(-4.5 + b * bw + bw * 0.08, base, bw * 0.84, (c / Math.max(total, 1) / bw) * Kd, { color: alpha('teal', 0.8), r: 2 }); });
      g.line([-4.5, base], [4.5, base], { color: 'slate', width: 2 });
      g.plot((x) => base + f(x) * Kd, { color: 'lime', width: 3, range: [-4.5, 0, 4.5] });
      // flying dots: → right until the curve, then ↓ down to the pile
      for (const d of s.drops) {
        const y = Yc(d.u);
        let p;
        if (d.ph < 1) p = [-4.5 + (d.x + 4.5) * d.ph, y];
        else p = [d.x, y + (base + 0.05 - y) * Math.min(1, (d.ph - 1) ** 1.6)];
        if (d.ph < 1) g.line([-4.5, y], p, { color: alpha('orange', 0.35), width: 1.5 });
        else g.line([d.x, y], p, { color: alpha('teal', 0.35), width: 1.5 });
        g.dot(p, 4.5, { color: d.ph < 1 ? 'orange' : 'teal', ring: 'bg', ringWidth: 1 });
      }
    }
    void g;
  },
};
