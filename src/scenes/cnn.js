// A convolution is a little 3×3 stamp sliding over a picture. At each spot it
// multiplies the 9 pixels under it by its 9 numbers and adds them up → one new
// pixel. Different stamps find different things (edges, blur…). Pooling keeps
// the strongest answer in each 2×2 block, and stacking layers lets one deep
// pixel "see" a bigger and bigger window of the picture.
import { C, alpha, mix } from '../viz/palette.js';
import { conv2d, maxPool, act } from '../core/learning.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const PICS = {
  smile: [
    '..............', '....######....', '...#......#...', '..#........#..', '.#..##..##..#.', '.#..##..##..#.', '.#..........#.',
    '.#..........#.', '.#.#......#.#.', '.#..#....#..#.', '..#..####..#..', '...#......#...', '....######....', '..............'],
  house: [
    '..............', '......##......', '.....####.....', '....##..##....', '...##....##...', '..##......##..', '.############.',
    '..#........#..', '..#.##..##.#..', '..#.##..##.#..', '..#........#..', '..#...##...#..', '..#...##...#..', '..##########..'],
  seven: [
    '..............', '.###########..', '.###########..', '.........###..', '........###...', '.......###....', '......###.....',
    '.....###......', '.....###......', '....###.......', '....###.......', '...###........', '...###........', '..............'],
};
const toImg = (rows) => rows.map((r) => [...r].map((ch) => (ch === '#' ? 1 : 0)));
const KERNELS = {
  vert: { k: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], icon: '▥' },
  horiz: { k: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]], icon: '▤' },
  blur: { k: [[1, 1, 1], [1, 1, 1], [1, 1, 1]].map((r) => r.map((v) => v / 9)), icon: '🌫️' },
  sharp: { k: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]], icon: '✨' },
};
const KN = Object.keys(KERNELS);

export default {
  eq: [
    [['out', 'pink'], '[i, j] = Σᵤ Σᵥ ', ['K', 'orange'], '[u, v] · ', ['img', 'ink'], '[i+u, j+v]        (one stamp = 9 multiplies + 1 sum)'],
    ['edge stamp  ', ['K', 'orange'], ' = [−1 0 1; −2 0 2; −1 0 1]     blur = all ', ['1/9', 'orange']],
    [['pool', 'gold'], '[i, j] = max of each 2×2 block        (keeps the strongest answer, ¼ the size)'],
    ['receptive field after n stacked 3×3 layers:  (2n + 1) × (2n + 1)  →  3, 5, 7 …'],
  ],
  setup({ stage, ui }) {
    const [Lp, Rp] = stage.split([[-0.6, -0.6, 14.6, 14.6], [-0.6, -0.6, 14.6, 18.6]], [1, 1]);
    const DS = 0.47;                                     // cell size of the deep-stack maps
    const s = { pic: 'smile', ker: 'vert', beat: 0, scan: 0, manual: 0, t: 0, deep: [3, 4], pool: 0 };
    let img = toImg(PICS.smile);
    const feat = (name) => conv2d(img, KERNELS[name].k, { pad: 1 });
    const IMGC = (v) => mix('bg', 'ink', clamp(v, 0, 1) * 0.85);
    const featC = (m) => (v) => (v >= 0 ? mix('bg', 'orange', Math.min(1, v / m)) : mix('bg', 'blue', Math.min(1, -v / m)));
    const kerC = (v) => (v >= 0 ? mix('panel', 'orange', 0.2 + 0.7 * Math.min(1, Math.abs(v) / 2)) : mix('panel', 'blue', 0.2 + 0.7 * Math.min(1, Math.abs(v) / 2)));
    const maxAbs = (M) => Math.max(1e-6, ...M.flat().map(Math.abs));

    // receptive-field stack (no padding, so each layer shrinks by 2)
    const stack = () => {
      const relu = (M) => M.map((r) => r.map(act.relu.f));
      const l1 = relu(conv2d(img, KERNELS.vert.k)), l2 = relu(conv2d(l1, KERNELS.blur.k)), l3 = conv2d(l2, KERNELS.blur.k);
      return [l1, l2, l3];
    };

    const win = () => { const k = Math.min(195, Math.floor(s.scan)); return s.beat <= 1 ? [k % 14, Math.floor(k / 14)] : [0, 0]; };
    stage.handle({ pen: Lp, color: 'gold', kind: 'square', r: 9, visible: () => s.beat <= 1,
      get: () => { const [c, r] = win(); return [c + 0.5, 13.5 - r]; },
      set: (p) => { const c = clamp(Math.floor(p[0]), 0, 13), r = clamp(Math.floor(14 - p[1]), 0, 13); s.scan = r * 14 + c; s.manual = 3; } });
    stage.handle({ pen: Rp, color: 'gold', kind: 'square', r: 9, visible: () => s.beat === 3,
      get: () => { const o = deepOrigin(); return [o[0] + (s.deep[0] + 0.5) * DS, o[1] - (s.deep[1] + 0.5) * DS]; },
      set: (p) => { const o = deepOrigin(); s.deep = [clamp(Math.floor((p[0] - o[0]) / DS), 0, 7), clamp(Math.floor((o[1] - p[1]) / DS), 0, 7)]; s.manual = 3; } });

    ui.beats(['🧽', '🗺️', '🔽', '🔭'], (b) => { s.beat = b; s.scan = 0; s.pool = 0; s.t = 0; });
    ui.choice({ value: 'smile', color: 'teal', options: [{ icon: '😀', value: 'smile' }, { icon: '🏠', value: 'house' }, { icon: '7️⃣', value: 'seven' }], onChange: (v) => { s.pic = v; img = toImg(PICS[v]); } });
    ui.choice({ value: 'vert', color: 'orange', options: KN.map((k) => ({ icon: KERNELS[k].icon, value: k, title: k })), onChange: (v) => (s.ker = v) });
    ui.readout(() => { const [c, r] = win(); return fmt(feat(s.ker)[r][c], 1); }, { icon: 'Σ', color: 'pink', title: 'stamp output here' });

    return {
      update(dt) {
        dt = Math.max(0, dt);                 // the shell can hand a tiny negative dt right after ⏭
        s.t += dt;
        if (s.manual > 0) { s.manual -= dt; return; }
        if (s.beat <= 1) s.scan = (s.scan + dt * 26) % (196 + 30);
        if (s.beat === 2) s.pool = (s.pool + dt * 3) % (49 + 8);
        if (s.beat === 3) { const k = Math.floor(s.t / 1.2) % 64; s.deep = [k % 8, Math.floor(k / 8)]; }
      },
      draw() {
        const scanI = Math.floor(s.scan);
        drawImage(scanI);
        if (s.beat === 0) drawOne(scanI);
        else if (s.beat === 1) drawMany(scanI);
        else if (s.beat === 2) drawPool();
        else drawDeep();
      },
    };

    function drawImage(scanI) {
      const g = Lp;
      g.cells(img, [0, 14], 1, { colorFn: IMGC, gridColor: alpha('muted', 0.25) });
      if (s.beat <= 1 && scanI < 196) {
        const c = scanI % 14, r = Math.floor(scanI / 14), K = KERNELS[s.ker].k;
        // the stamp: 3×3 tinted cells with their numbers
        for (let u = 0; u < 3; u++) for (let v = 0; v < 3; v++) {
          const x = c - 1 + v, y = 14 - (r - 1 + u);
          if (x < 0 || x > 13 || y > 14 || y < 1) continue;
          g.rect(x, y - 1, 1, 1, { fill: kerC(K[u][v]), stroke: false });
          g.text(fmt(K[u][v], Math.abs(K[u][v]) < 1 && K[u][v] !== 0 ? 2 : 0), [x + 0.5, y - 0.5], { size: clamp(g.px(1) * 0.36, 7, 12), weight: 800, color: 'ink' });
        }
        g.rect(c - 1, 14 - r - 2, 3, 3, { color: 'gold', width: 3.5 });
      }
    }

    function link(fromPen, a, toPen, b) {
      const A = fromPen.toScreen(a), B = toPen.toScreen(b), ctx = stage.ctx;
      ctx.save(); ctx.strokeStyle = alpha('gold', 0.7); ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.stroke(); ctx.restore();
    }

    function drawOne(scanI) {
      const g = Rp, F = feat(s.ker), m = maxAbs(F), col = featC(m);
      const shown = F.map((row, r) => row.map((v, c) => (r * 14 + c <= scanI ? v : null)));
      shown.forEach((row, r) => row.forEach((v, c) => {
        g.rect(c, 13 - r, 1, 1, { fill: v === null ? alpha('faint', 0.25) : col(v), stroke: false });
      }));
      g.rect(0, 0, 14, 14, { color: 'faint', width: 1 });
      // the stamp itself, up top
      const K = KERNELS[s.ker].k, ks = 1.15, kx = 7 - 1.5 * ks;
      K.forEach((row, u) => row.forEach((v, w) => {
        g.rect(kx + w * ks, 18.2 - (u + 1) * ks, ks, ks, { fill: kerC(v), stroke: false });
        g.text(fmt(v, Math.abs(v) < 1 && v !== 0 ? 2 : 0), [kx + (w + 0.5) * ks, 18.2 - (u + 0.5) * ks], { size: clamp(g.px(ks) * 0.36, 7, 13), weight: 800 });
      }));
      g.rect(kx, 18.2 - 3 * ks, 3 * ks, 3 * ks, { color: 'orange', width: 2.5 });
      if (scanI < 196) {
        const c = scanI % 14, r = Math.floor(scanI / 14);
        g.rect(c, 13 - r, 1, 1, { color: 'gold', width: 3 });
        g.text(fmt(F[r][c], 1), [c + 0.5, 14.6 - r + 0.2 > 14.6 ? 13 - r - 0.5 : 14 - r + 0.45], { color: 'pink', size: 14, weight: 800 });
        link(Lp, [c + 0.5, 13.5 - r], Rp, [c + 0.5, 13.5 - r]);
      }
    }

    function drawMany(scanI) {
      const g = Rp, sz = 6.6 / 14;
      KN.forEach((name, q) => {
        const ox = (q % 2) * 7.4, oy = 14 - Math.floor(q / 2) * 7.6 + 2.6;
        const F = feat(name), col = featC(maxAbs(F));
        F.forEach((row, r) => row.forEach((v, c) => {
          if (r * 14 + c > scanI) return;
          g.rect(ox + c * sz, oy - (r + 1) * sz, sz, sz, { fill: col(v), stroke: false });
        }));
        g.rect(ox, oy - 14 * sz, 14 * sz, 14 * sz, { color: name === s.ker ? 'gold' : 'faint', width: name === s.ker ? 3 : 1 });
        // its stamp
        const K = KERNELS[name].k, ks = 0.3;
        K.forEach((row, u) => row.forEach((v, w) => g.rect(ox + 14 * sz - 3 * ks + w * ks, oy + 0.15 + (3 - u) * ks - ks, ks, ks, { fill: kerC(v), stroke: false })));
        g.emoji(KERNELS[name].icon, [ox + 0.3, oy + 0.55], 16);
        if (scanI < 196) { const c = scanI % 14, r = Math.floor(scanI / 14); g.rect(ox + c * sz, oy - (r + 1) * sz, sz, sz, { color: 'gold', width: 2 }); }
      });
    }

    function drawPool() {
      const g = Rp, F = feat(s.ker), P = maxPool(F, 2), m = maxAbs(F), col = featC(m);
      const sz = 0.5, oy = 15.5, ox = 0, px = 7.6, ps = 6.6 / 7;
      F.forEach((row, r) => row.forEach((v, c) => g.rect(ox + c * sz, oy - (r + 1) * sz, sz, sz, { fill: col(v), stroke: false })));
      g.rect(ox, oy - 7, 7, 7, { color: 'faint', width: 1 });
      const k = Math.floor(s.pool);
      P.forEach((row, r) => row.forEach((v, c) => {
        if (r * 7 + c > k) { g.rect(px + c * ps, oy - (r + 1) * ps, ps, ps, { fill: alpha('faint', 0.25), stroke: false }); return; }
        g.rect(px + c * ps, oy - (r + 1) * ps, ps, ps, { fill: col(v), stroke: false });
      }));
      g.rect(px, oy - 7 * ps, 7 * ps, 7 * ps, { color: 'faint', width: 1 });
      g.emoji('🏆', [7.3, oy + 0.6], 18);
      if (k < 49) {
        const c = k % 7, r = Math.floor(k / 7);
        g.rect(ox + 2 * c * sz, oy - (2 * r + 2) * sz, 2 * sz, 2 * sz, { color: 'gold', width: 3 });
        // which of the 4 won
        let best = [0, 0];
        for (let u = 0; u < 2; u++) for (let v = 0; v < 2; v++) if (F[2 * r + u][2 * c + v] > F[2 * r + best[0]][2 * c + best[1]]) best = [u, v];
        g.dot([ox + (2 * c + best[1] + 0.5) * sz, oy - (2 * r + best[0] + 0.5) * sz], 4, { color: 'gold' });
        g.rect(px + c * ps, oy - (r + 1) * ps, ps, ps, { color: 'gold', width: 3 });
        g.line([ox + (2 * c + 1) * sz, oy - (2 * r + 1) * sz], [px + (c + 0.5) * ps, oy - (r + 0.5) * ps], { color: alpha('gold', 0.6), width: 2, dash: [4, 4] });
      }
      g.emoji('🔽', [7.3, oy - 3.5], 22);
      // small picture of the same sizes, as a reminder: 14×14 → 7×7
      g.text('14×14', [3.5, oy - 7.6], { color: 'muted', size: 12, weight: 700 });
      g.text('7×7', [px + 3.3, oy - 7.6], { color: 'muted', size: 12, weight: 700 });
    }

    function deepOrigin() { return [22 * DS + 0.8, 9 + 4 * DS]; }
    function drawDeep() {
      const g = Rp, [l1, l2, l3] = stack();
      const lays = [{ M: l1, n: 12, o: [0, 9 + 6 * DS] }, { M: l2, n: 10, o: [12 * DS + 0.4, 9 + 5 * DS] }, { M: l3, n: 8, o: deepOrigin() }];
      const [dc, dr] = s.deep;
      // patches: layer3 cell (dc,dr) sees 3×3 of l2 at (dc..dc+2), 5×5 of l1, 7×7 of the image
      const patch = [[dc, dr, 5], [dc, dr, 3], [dc, dr, 1]];
      lays.forEach((L, li) => {
        const col = featC(maxAbs(L.M));
        L.M.forEach((row, r) => row.forEach((v, c) => g.rect(L.o[0] + c * DS, L.o[1] - (r + 1) * DS, DS, DS, { fill: col(v), stroke: false })));
        g.rect(L.o[0], L.o[1] - L.n * DS, L.n * DS, L.n * DS, { color: 'faint', width: 1 });
        const [pc, pr, pn] = patch[li];
        g.rect(L.o[0] + pc * DS, L.o[1] - (pr + pn) * DS, pn * DS, pn * DS, { fill: alpha('gold', 0.25), color: 'gold', width: 2.5, stroke: true });
      });
      // cone lines between layers
      for (let li = 2; li > 0; li--) {
        const A = lays[li], B = lays[li - 1], [ac, ar, an] = patch[li], [bc, br, bn] = patch[li - 1];
        const ca = [[A.o[0] + ac * DS, A.o[1] - ar * DS], [A.o[0] + ac * DS, A.o[1] - (ar + an) * DS]];
        const cb = [[B.o[0] + (bc + bn) * DS, B.o[1] - br * DS], [B.o[0] + (bc + bn) * DS, B.o[1] - (br + bn) * DS]];
        g.line(ca[0], cb[0], { color: alpha('gold', 0.7), width: 1.5 });
        g.line(ca[1], cb[1], { color: alpha('gold', 0.7), width: 1.5 });
      }
      ['5×5', '3×3', '1'].forEach((t, i) => g.text(t, [lays[i].o[0] + lays[i].n * DS / 2, lays[i].o[1] - lays[i].n * DS - 0.55], { color: 'gold', size: 13, weight: 800 }));
      Lp.text('7×7', [dc + 3.5, 14 - dr - 7.5], { color: 'gold', size: 15, weight: 800 });
      g.emoji('🔭', [12.6, 13.6], 26);
      // the 7×7 window on the input picture
      Lp.rect(dc, 14 - dr - 7, 7, 7, { fill: alpha('gold', 0.22), color: 'gold', width: 3.5, stroke: true });
      link(Rp, [lays[0].o[0] + (dc + 2.5) * DS, lays[0].o[1] - (dr + 2.5) * DS], Lp, [dc + 7, 14 - dr - 3.5]);
      void C;
    }
  },
};
