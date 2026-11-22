// Occupancy map: the room is hidden. The robot's flashlight-rays say "empty, empty,
// empty, WALL!". Every cell keeps a score — add a bit for "wall", subtract a bit for
// "empty" — and the map paints itself: clear = empty, slate = wall, purple fog = ?
import { alpha, col } from '../viz/palette.js';
import { rayCells, logit, unlogit } from '../core/estimation.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';
import { hudBox } from './registration.js';

const NX = 48, NY = 32, CELL = 0.25, W = NX * CELL, H = NY * CELL;
// inverse sensor model: a hit says p(wall)=0.7, a pass-through says 0.4; never surer than 99%
const L_OCC = logit(0.7), L_FREE = logit(0.4), L_MAX = logit(0.99);
const NRAY = 60, RMAX = 4.2;
// the hidden room (world units)
const RECTS = [
  [0, 0, 12, 0.25], [0, 7.75, 12, 8], [0, 0, 0.25, 8], [11.75, 0, 12, 8],
  [4.75, 0, 5.0, 2.4], [4.75, 3.4, 5.0, 5.6], [4.75, 6.6, 5.0, 8],
  [5.0, 4.75, 8.4, 5.0], [9.4, 4.75, 12, 5.0],
  [1.2, 6.0, 2.4, 7.0], [2.0, 1.2, 2.8, 2.0], [9.6, 6.2, 11.2, 6.9], [7.2, 6.9, 7.9, 7.75],
];
const CIRCLES = [[8.4, 2.3, 0.5], [3.6, 4.6, 0.3]];
const ROUTE = [[2.4, 3.6], [3.8, 2.9], [6.5, 2.9], [6.5, 1.0], [10.6, 1.0], [10.6, 3.6], [8.9, 3.9], [8.9, 6.2], [6.2, 6.1], [3.6, 6.1], [1.0, 4.4]];

const toRGB = (c) => {
  c = col(c);
  if (c.startsWith('#')) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
};

export default {
  eq: [
    ['each cell keeps a score   ', ['ℓ', 'purple'], ' = log ( p / (1 − p) )'],
    ['ray passes through:   ', ['ℓ', 'purple'], ' ← ', ['ℓ', 'purple'], ' + ', ['ℓ_free', 'teal'], '   (', ['−0.4', 'teal'], ')'],
    ['ray ends here:          ', ['ℓ', 'purple'], ' ← ', ['ℓ', 'purple'], ' + ', ['ℓ_occ', 'slate'], '    (', ['+0.85', 'slate'], ')'],
    ['p(wall) = 1 / (1 + e^(−', ['ℓ', 'purple'], '))      (Bayes in log-odds = just adding)'],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait;
    const g = stage.g.setBounds(tall ? [-0.2, -3.2, W + 0.2, H + 0.2] : [-0.2, -0.2, W + 4.4, H + 0.2]);
    const truth = new Uint8Array(NX * NY);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const x = (i + 0.5) * CELL, y = (j + 0.5) * CELL;
      const occ = RECTS.some(([a, b, c, d]) => x > a && x < c && y > b && y < d) || CIRCLES.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r);
      truth[j * NX + i] = occ ? 1 : 0;
    }
    const L = new Float32Array(NX * NY);
    const r = rng(4);
    const s = {
      beat: 0, robot: [...ROUTE[0]], noise: 0.0, roam: false, seg: 0, segT: 0, scanT: 0, scan: null,
      reveal: false, sel: [28, 19], hist: [], scans: 0,
    };
    const cellOf = (p) => [clamp(Math.floor(p[0] / CELL), 0, NX - 1), clamp(Math.floor(p[1] / CELL), 0, NY - 1)];
    const clear = () => { L.fill(0); s.hist = []; s.scans = 0; };

    // a point `d` along a ray from the robot, never leaving the map (keeps the ray straight)
    function along(dir, d) {
      let t = d;
      if (dir[0] > 1e-9) t = Math.min(t, (W - 1e-4 - s.robot[0]) / dir[0]);
      if (dir[0] < -1e-9) t = Math.min(t, (s.robot[0] - 1e-4) / -dir[0]);
      if (dir[1] > 1e-9) t = Math.min(t, (H - 1e-4 - s.robot[1]) / dir[1]);
      if (dir[1] < -1e-9) t = Math.min(t, (s.robot[1] - 1e-4) / -dir[1]);
      return [s.robot[0] + dir[0] * t, s.robot[1] + dir[1] * t];
    }
    // one lidar sweep: real ray casting in the hidden room, then the log-odds update
    function sweep() {
      const [ci, cj] = cellOf(s.robot);
      const rays = [];
      const phantom = s.noise * 0.12;
      const a0 = r.uniform(0, 2 * Math.PI / NRAY);
      for (let k = 0; k < NRAY; k++) {
        const a = a0 + (k / NRAY) * 2 * Math.PI;
        const dir = [Math.cos(a), Math.sin(a)];
        const end = along(dir, RMAX);
        const [ei, ej] = cellOf(end);
        const cells = rayCells(ci, cj, ei, ej);
        let hitIdx = -1;
        for (let m = 0; m < cells.length; m++) if (truth[cells[m][1] * NX + cells[m][0]]) { hitIdx = m; break; }
        // true range → noisy range
        let range = hitIdx >= 0 ? Math.hypot((cells[hitIdx][0] + 0.5) * CELL - s.robot[0], (cells[hitIdx][1] + 0.5) * CELL - s.robot[1]) : RMAX;
        let hit = hitIdx >= 0;
        if (s.noise > 0) {
          range += r.normal(0, s.noise);
          if (r() < phantom) { range = r.uniform(0.3, RMAX); hit = true; }
        }
        range = clamp(range, 0.05, RMAX);
        if (range >= RMAX - 1e-6) hit = false;
        const tip = along(dir, range);
        const [ti, tj] = cellOf(tip);
        const path = rayCells(ci, cj, ti, tj);
        path.forEach(([i, j], m) => {
          const last = m === path.length - 1;
          const d = last && hit ? L_OCC : L_FREE;
          const idx = j * NX + i;
          L[idx] = clamp(L[idx] + d, -L_MAX, L_MAX);
          if (i === s.sel[0] && j === s.sel[1]) s.hist.push(d);
        });
        rays.push({ tip, hit });
      }
      if (s.hist.length > 40) s.hist.splice(0, s.hist.length - 40);
      s.scan = rays; s.scans++;
    }

    stage.handle({ pen: g, color: 'orange', r: 13, icon: '🤖', get: () => s.robot,
      set: (p) => {
        const q = [clamp(p[0], 0.4, W - 0.4), clamp(p[1], 0.4, H - 0.4)];
        const [i, j] = cellOf(q);
        if (truth[j * NX + i]) return;                     // can't drive into a wall
        s.robot = q; s.roam = false; roamT.set(false, false);
        if (s.beat === 0) clear();
        sweep();
      } });
    stage.handle({ pen: g, color: 'gold', kind: 'ring', r: 9, visible: () => s.beat === 3,
      get: () => [(s.sel[0] + 0.5) * CELL, (s.sel[1] + 0.5) * CELL],
      set: (p) => { const c = cellOf(p); if (c[0] !== s.sel[0] || c[1] !== s.sel[1]) { s.sel = c; s.hist = []; } } });

    ui.beats(['🔦', '🗺️', '🎲', '📊'], (b) => {
      s.beat = b; clear();
      s.roam = b > 0; roamT.set(s.roam, false);
      if (b === 2) { s.noise = 0.35; noiseS.set(0.35); } else if (b !== 3) { s.noise = 0; noiseS.set(0); }
      if (b === 0) { s.robot = [...ROUTE[0]]; s.seg = 0; s.segT = 0; }
      sweep();
    });
    const roamT = ui.toggle({ icon: '🚶', title: 'roam', value: false, color: 'orange', onChange: (v) => (s.roam = v) });
    const noiseS = ui.slider({ icon: '🎲', color: 'purple', min: 0, max: 0.7, value: 0, title: 'sensor noise', onInput: (v) => (s.noise = v) });
    ui.toggle({ icon: '👁️', title: 'peek at the real room', value: false, color: 'lime', onChange: (v) => (s.reveal = v) });
    ui.button({ icon: '🧽', title: 'forget the map', onClick: () => { clear(); sweep(); } });
    ui.readout(() => `${fmt(100 * stats().seen, 0)}%`, { icon: '🗺️', color: 'teal', title: 'explored' });
    ui.readout(() => `${fmt(100 * stats().right, 0)}%`, { icon: '✅', color: 'lime', title: 'correct cells' });
    let cache = { t: -1 };
    function stats() {
      if (cache.n === s.scans && cache.t === s.beat) return cache;
      let seen = 0, right = 0, free = 0;
      for (let k = 0; k < L.length; k++) {
        if (truth[k] === 0) free++;
        if (Math.abs(L[k]) > 0.3) { seen++; if ((L[k] > 0) === (truth[k] === 1)) right++; }
      }
      cache = { n: s.scans, t: s.beat, seen: Math.min(1, seen / (free * 1.08)), right: seen ? right / seen : 0 };
      return cache;
    }
    sweep();

    // offscreen picture of the map (one pixel per cell)
    const cv = document.createElement('canvas'); cv.width = NX; cv.height = NY;
    const cx = cv.getContext('2d'), img = cx.createImageData(NX, NY);

    return {
      update(dt) {
        dt = Math.max(0, dt);
        if (s.roam) {
          const a = ROUTE[s.seg], b = ROUTE[(s.seg + 1) % ROUTE.length];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          s.segT += (1.3 * dt) / len;
          if (s.segT >= 1) { s.segT = 0; s.seg = (s.seg + 1) % ROUTE.length; }
          const t = s.segT;
          s.robot = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          s.scanT += dt;
          if (s.scanT > 0.16) { s.scanT = 0; sweep(); }
        }
      },
      draw() {
        const bg = toRGB('bg'), sl = toRGB('slate'), pu = toRGB('purple'), pa = toRGB('panel');
        for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
          const l = L[j * NX + i], p = unlogit(l);
          const occ = Math.max(0, 2 * p - 1), fr = Math.max(0, 1 - 2 * p), unk = 1 - Math.abs(2 * p - 1);
          const o = ((NY - 1 - j) * NX + i) * 4;
          for (let c = 0; c < 3; c++) {
            let v = bg[c] * (1 - fr) + pa[c] * fr;               // free → clean
            v = v * (1 - 0.3 * unk) + pu[c] * 0.3 * unk;       // unknown → purple fog
            v = v * (1 - 0.95 * occ ** 0.8) + sl[c] * 0.95 * occ ** 0.8;  // wall → slate
            img.data[o + c] = v;
          }
          img.data[o + 3] = 255;
        }
        cx.putImageData(img, 0, 0);
        const a = g.toScreen([0, H]), b = g.toScreen([W, 0]);
        const ctx = g.ctx;
        ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(cv, a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.restore();
        // faint cell grid
        if (g.px(CELL) > 7) for (let i = 0; i <= NX; i += 4) g.line([i * CELL, 0], [i * CELL, H], { color: alpha('grid', 0.6), width: 1 });
        if (g.px(CELL) > 7) for (let j = 0; j <= NY; j += 4) g.line([0, j * CELL], [W, j * CELL], { color: alpha('grid', 0.6), width: 1 });
        g.rect(0, 0, W, H, { color: alpha('muted', 0.5), width: 1.5 });
        if (s.reveal) {
          for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) if (truth[j * NX + i]) g.rect(i * CELL + 0.03, j * CELL + 0.03, CELL - 0.06, CELL - 0.06, { color: alpha('lime', 0.85), width: 1.2 });
        }
        // the current sweep
        if (s.scan) {
          for (const ray of s.scan) g.line(s.robot, ray.tip, { color: alpha('teal', s.beat === 0 ? 0.55 : 0.3), width: 1.2 });
          for (const ray of s.scan) if (ray.hit) g.dot(ray.tip, s.beat === 0 ? 3.5 : 2.6, { color: 'teal' });
        }
        if (s.roam) g.path([...ROUTE, ROUTE[0]], { color: alpha('orange', 0.25), width: 2, dash: [4, 6] });
        if (s.beat === 3) drawCell();
        legend();
      },
    };

    // the probability scale: −ℓ … 0 … +ℓ  ↔  clear … fog … wall
    function legend() {
      if (tall && s.beat === 3) return;   // the cell panel takes this spot
      const n = 24;
      const x0 = tall ? 0.5 : W + 0.7, y0 = tall ? -1.1 : H - 1.0, w = tall ? W - 1.0 : 3.2, h = 0.55;
      for (let k = 0; k < n; k++) {
        const p = (k + 0.5) / n;
        const occ = Math.max(0, 2 * p - 1), fr = Math.max(0, 1 - 2 * p), unk = 1 - Math.abs(2 * p - 1);
        const bg = toRGB('bg'), sl = toRGB('slate'), pu = toRGB('purple'), pa = toRGB('panel');
        const c = [0, 1, 2].map((i) => {
          let v = bg[i] * (1 - fr) + pa[i] * fr; v = v * (1 - 0.3 * unk) + pu[i] * 0.3 * unk; return Math.round(v * (1 - 0.95 * occ ** 0.8) + sl[i] * 0.95 * occ ** 0.8);
        });
        g.rect(x0 + (k / n) * w, y0, w / n + 0.01, h, { fill: `rgb(${c.join(',')})`, stroke: false });
      }
      g.rect(x0, y0, w, h, { color: alpha('muted', 0.6), width: 1 });
      const ty = y0 - g.world(11);
      g.text('0', [x0, ty], { size: 13, color: 'muted' });
      g.text('½', [x0 + w / 2, ty], { size: 13, color: 'purple' });
      g.text('1', [x0 + w, ty], { size: 13, color: 'muted' });
      const ey = tall ? ty - g.world(20) : y0 + h + g.world(15);
      g.emoji('🚶', [x0, ey], 20); g.emoji('❓', [x0 + w / 2, ey], 18); g.emoji('🧱', [x0 + w, ey], 20);
    }

    // one cell's score: every look adds or subtracts a fixed step (no fancy math!)
    function drawCell() {
      const area = g.area, ctx = stage.hud.ctx;
      const bw = tall ? area.w - 24 : Math.min(360, area.w * 0.3), bh = tall ? 120 : 190;
      const X = area.x + area.w - bw - 12, Y = tall ? area.y + area.h - bh - 8 : area.y + area.h - bh - 74;
      hudBox(stage.hud, X, Y, bw, bh);
      // staircase of ℓ over the last looks
      const steps = s.hist, n = 40;
      const gx = X + 34, gw = bw * 0.62 - 40, gy = Y + 12, gh = bh - 24;
      const yl = (l) => gy + gh / 2 - (l / L_MAX) * (gh / 2);
      ctx.save();
      ctx.strokeStyle = alpha('muted', 0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx, yl(0)); ctx.lineTo(gx + gw, yl(0)); ctx.stroke();
      ctx.font = '13px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🧱', X + 16, yl(L_MAX * 0.75)); ctx.fillText('🚶', X + 16, yl(-L_MAX * 0.75));
      ctx.fillStyle = col('purple'); ctx.font = '700 14px ui-rounded, system-ui'; ctx.fillText('ℓ', X + 16, yl(0));
      let l = Math.max(-L_MAX, Math.min(L_MAX, L[s.sel[1] * NX + s.sel[0]] - steps.reduce((a, b) => a + b, 0)));
      // replay (clamped) from the value before these steps
      const xs = (k) => gx + (k / n) * gw;
      steps.forEach((d, k) => {
        const l2 = Math.max(-L_MAX, Math.min(L_MAX, l + d));
        ctx.fillStyle = d > 0 ? col('slate') : col('teal');
        const y0 = yl(l), y1 = yl(l2);
        ctx.beginPath(); ctx.roundRect(xs(k) + 1, Math.min(y0, y1), Math.max(2, gw / n - 2), Math.max(2, Math.abs(y1 - y0)), 2); ctx.fill();
        l = l2;
      });
      // sigmoid: ℓ → p
      const sx = X + bw * 0.64, sw = bw * 0.32;
      const px = (p) => sx + p * sw;
      ctx.strokeStyle = alpha('muted', 0.5); ctx.beginPath(); ctx.moveTo(sx, gy); ctx.lineTo(sx, gy + gh); ctx.stroke();
      ctx.strokeStyle = col('purple'); ctx.lineWidth = 2.5; ctx.beginPath();
      for (let k = 0; k <= 40; k++) { const ll = -L_MAX + (2 * L_MAX * k) / 40, p = unlogit(ll); k ? ctx.lineTo(px(p), yl(ll)) : ctx.moveTo(px(p), yl(ll)); }
      ctx.stroke();
      const lc = L[s.sel[1] * NX + s.sel[0]], pc = unlogit(lc);
      ctx.strokeStyle = alpha('gold', 0.6); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(gx, yl(lc)); ctx.lineTo(px(pc), yl(lc)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col('gold'); ctx.beginPath(); ctx.arc(px(pc), yl(lc), 6, 0, 7); ctx.fill();
      ctx.fillStyle = col('ink'); ctx.font = '700 13px ui-rounded, system-ui'; ctx.fillText(`p = ${fmt(pc, 2)}`, sx + sw / 2, gy + gh - 2);
      ctx.restore();
      // ring the chosen cell on the map
      g.rect(s.sel[0] * CELL, s.sel[1] * CELL, CELL, CELL, { color: 'gold', width: 2.5 });
    }
  },
};
