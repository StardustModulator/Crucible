// Value iteration: every square asks "how good is my best neighbour?" — over and
// over — until the whole map knows the way to the candy and away from the lava.
import { C, alpha, cmapCSS } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { ACTIONS, gridStep, valueIterationSweep } from '../core/learning.js';
import { rng, clamp, smoothstep } from '../core/random.js';

const GW = 9, GH = 5;
const LAVA = [1, 2, 3, 4, 5, 6, 7].map((x) => `${x},4`);
const START = [0, 4];
const ANG = [Math.PI / 2, 0, -Math.PI / 2, Math.PI]; // up right down left, in world (y up)

export default {
  eq: [
    [['V', 'blue'], '(s) ← max over moves  Σ ', ['P(s′|s,a)', 'purple'], ' [ ', ['r', 'gold'], ' + ', ['γ', 'orange'], ' ', ['V', 'blue'], '(s′) ]'],
    ['wind: ', ['1 − p', 'gold'], ' go where you aim,  ', ['p/2', 'purple'], ' slide left,  ', ['p/2', 'purple'], ' slide right'],
    ['repeat until  ', ['Δ', 'coral'], ' = max |', ['V', 'blue'], '_new − ', ['V', 'blue'], '_old| ≈ 0      policy = the best ', ['arrow', 'ink']],
  ],
  setup({ stage, ui }) {
    const [G, P] = stage.split([[0, 0, GW, GH], [0, 0, 1, 1]], [3, 1.15]);
    const rand = rng(21);
    const s = {
      beat: 0, gamma: 0.9, slip: 0, candy: [8, 4], walls: new Set(['4,0', '4,1', '6,2', '2,2']),
      V: null, prev: null, changed: new Set(), deltas: [], timer: 0, done: false, hold: 0, t: 0,
      bot: null, tally: { win: 0, lose: 0 }, hover: [2, 3], pulse: 0,
    };
    const world = () => ({
      W: GW, H: GH, walls: s.walls,
      rewards: new Map([[`${s.candy[0]},${s.candy[1]}`, 1], ...LAVA.filter((k) => k !== `${s.candy[0]},${s.candy[1]}`).map((k) => [k, -1])]),
      terminal: new Set([`${s.candy[0]},${s.candy[1]}`, ...LAVA]),
      stepCost: -0.02,
    });
    let Wd = world();
    const zeros = () => Array.from({ length: GH }, () => new Array(GW).fill(0));
    const restart = () => { Wd = world(); s.V = zeros(); s.prev = s.V; s.deltas = []; s.done = false; s.timer = 0; s.hold = 0; s.changed = new Set(); };
    const sweep = () => {
      const r = valueIterationSweep(Wd, s.V, s.gamma, s.slip);
      s.changed = new Set();
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (Math.abs(r.V[y][x] - s.V[y][x]) > 2e-3) s.changed.add(`${x},${y}`);
      s.prev = s.V; s.V = r.V; s.pulse = 1;
      s.deltas.push(r.delta); if (s.deltas.length > 120) s.deltas.shift();
      if (r.delta < 1e-4) s.done = true;
    };
    const qOf = (x, y, a) => {
      const outs = s.slip > 0 ? [[a, 1 - s.slip], [(a + 1) % 4, s.slip / 2], [(a + 3) % 4, s.slip / 2]] : [[a, 1]];
      return outs.reduce((acc, [aa, p]) => { const st = gridStep(Wd, [x, y], aa); const term = Wd.terminal.has(`${st.s[0]},${st.s[1]}`); return acc + p * (st.r + (term ? 0 : s.gamma * s.V[st.s[1]][st.s[0]])); }, 0);
    };
    const bestA = (x, y) => { let b = 0, bq = -Infinity; for (let a = 0; a < 4; a++) { const q = qOf(x, y, a); if (q > bq + 1e-9) { bq = q; b = a; } } return b; };
    const decided = (x, y) => { const q = [0, 1, 2, 3].map((a) => qOf(x, y, a)); return Math.max(...q) - Math.min(...q) > 1e-6; };
    const resetBot = () => { s.bot = { c: START.slice(), from: START.slice(), u: 1, wait: 0.5, mood: null, trail: [START.slice()], slipped: 0 }; };
    restart(); resetBot();

    // world (y up) ↔ grid (row 0 at the top)
    const cellRect = (x, y) => [x, GH - 1 - y];
    const ctr = (x, y) => [x + 0.5, GH - 1 - y + 0.5];
    const toCell = (p) => [Math.floor(p[0]), GH - 1 - Math.floor(p[1])];
    const inGrid = ([x, y]) => x >= 0 && y >= 0 && x < GW && y < GH;

    stage.handle({ pen: G, color: 'gold', icon: '🍬', r: 15, get: () => ctr(...s.candy),
      set: (p) => { const c = toCell(p); if (!inGrid(c) || LAVA.includes(`${c[0]},${c[1]}`) || (c[0] === START[0] && c[1] === START[1])) return; s.walls.delete(`${c[0]},${c[1]}`); if (c[0] !== s.candy[0] || c[1] !== s.candy[1]) { s.candy = c; restart(); if (s.beat >= 2) fastForward(); } } });
    const offs = [
      stage.on('down', (e) => {
        if (e.pen !== G || s.beat === 3) return;
        const c = toCell(e.p), k = `${c[0]},${c[1]}`;
        if (!inGrid(c) || Wd.terminal.has(k) || (c[0] === START[0] && c[1] === START[1])) return;
        if (s.walls.has(k)) s.walls.delete(k); else s.walls.add(k);
        restart(); if (s.beat >= 2) fastForward();
      }),
      stage.on('move', (e) => { if (e.pen === G) { const c = toCell(e.p); if (inGrid(c)) s.hover = c; } }),
    ];
    const fastForward = () => { for (let i = 0; i < 400 && !s.done; i++) sweep(); };

    ui.beats(['💧', '🏁', '🌬️', '🤖'], (b) => {
      s.beat = b; restart(); resetBot(); s.tally = { win: 0, lose: 0 };
      if (b === 2 && s.slip === 0) windSl.set(0.3, true);
      if (b === 3) fastForward();
    });
    ui.slider({ icon: 'γ', color: 'orange', min: 0.5, max: 0.99, step: 0.01, value: s.gamma, title: 'how much later candy is worth', onInput: (v) => { s.gamma = v; s.done = false; s.deltas = []; if (s.beat === 3) fastForward(); } });
    const windSl = ui.slider({ icon: '🌬️', color: 'purple', min: 0, max: 0.6, step: 0.01, value: s.slip, title: 'wind (slip chance)', onInput: (v) => { s.slip = v; s.done = false; s.deltas = []; if (s.beat === 3) fastForward(); } });
    ui.button({ icon: '💧', title: 'one sweep', onClick: () => sweep() });
    ui.readout(() => String(s.deltas.length), { icon: '🔁', color: 'blue', title: 'sweeps' });
    ui.readout(() => (s.deltas.length ? fmt(s.deltas[s.deltas.length - 1], 3) : '—'), { icon: 'Δ', color: 'coral', title: 'biggest change in the last sweep' });

    return {
      update(dt) {
        s.t += dt; s.pulse = Math.max(0, s.pulse - dt * 1.5);
        if (s.beat <= 2) {
          s.timer += dt;
          const every = s.beat === 0 ? 1.1 : 0.09;
          if (!s.done && s.timer > every) { s.timer = 0; sweep(); }
          if (s.done && s.beat === 1) { s.hold += dt; if (s.hold > 2.5) restart(); }
          if (s.done && s.beat === 0) { s.hold += dt; if (s.hold > 3) restart(); }
        } else {
          if (!s.done) fastForward();
          const b = s.bot;
          if (b.u < 1) b.u = Math.min(1, b.u + dt * 3.2);
          else if ((b.wait -= dt) < 0) {
            if (b.mood) { resetBot(); return; }
            const k = `${b.c[0]},${b.c[1]}`;
            if (Wd.terminal.has(k)) { b.mood = Wd.rewards.get(k) > 0 ? '🎉' : '😱'; b.mood === '🎉' ? s.tally.win++ : s.tally.lose++; b.wait = 1.1; return; }
            const a = bestA(...b.c);
            const st = gridStep(Wd, b.c, a, s.slip, rand);
            const intended = gridStep(Wd, b.c, a).s;
            b.slipped = intended[0] !== st.s[0] || intended[1] !== st.s[1] ? 1 : 0;
            b.from = b.c; b.c = st.s; b.u = 0; b.wait = 0.12;
            b.trail.push(st.s.slice());
          }
          s.bot.slipped = Math.max(0, s.bot.slipped - dt * 2);
        }
      },
      draw() {
        drawGrid();
        drawPanel();
      },
      dispose() { offs.forEach((f) => f()); },
    };

    function drawGrid() {
      const px = G.px(1), showNums = s.beat <= 1 && px > 40;
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        const k = `${x},${y}`, [rx, ry] = cellRect(x, y);
        if (s.walls.has(k)) { G.rrect(rx + 0.03, ry + 0.03, 0.94, 0.94, 6, { fill: C.slate, stroke: false }); continue; }
        if (Wd.terminal.has(k)) {
          const good = Wd.rewards.get(k) > 0;
          G.rrect(rx + 0.03, ry + 0.03, 0.94, 0.94, 6, { fill: alpha(good ? 'gold' : 'coral', good ? 0.35 : 0.3), stroke: false });
          if (!good) G.emoji('🔥', ctr(x, y), Math.max(14, px * 0.55));
          continue;
        }
        const v = s.V[y][x];
        G.rrect(rx + 0.03, ry + 0.03, 0.94, 0.94, 6, { fill: cmapCSS(clamp(0.5 + 0.5 * v, 0, 1), 'div'), stroke: false, alpha: 0.85 });
        if (s.changed.has(k) && s.pulse > 0) G.rrect(rx + 0.06, ry + 0.06, 0.88, 0.88, 6, { color: alpha('teal', s.pulse), width: 3 });
        if (showNums) G.text(fmt(v, 2), [rx + 0.5, ry + 0.2], { size: clamp(px * 0.2, 9, 14), color: 'black', halo: false, alpha: 0.75 });
        if (s.deltas.length && decided(x, y)) {
          const a = bestA(x, y), c = ctr(x, y), L = 0.3;
          const d = [Math.cos(ANG[a]) * L, Math.sin(ANG[a]) * L];
          G.arrow([c[0] - d[0] * 0.8, c[1] - d[1] * 0.8 + (showNums ? 0.08 : 0)], [c[0] + d[0], c[1] + d[1] + (showNums ? 0.08 : 0)], { color: alpha('black', 0.7), width: Math.max(2, px * 0.05), head: Math.max(7, px * 0.16) });
        }
      }
      G.rect(0, 0, GW, GH, { color: alpha('muted', 0.5), width: 1.5 });
      G.emoji('🏠', ctr(...START), Math.max(14, px * 0.4), { alpha: 0.6 });
      // wind: the three places one push can land you (the cell under the pointer)
      if (s.beat === 2 && s.deltas.length) {
        const [hx, hy] = s.hover, k = `${hx},${hy}`;
        if (!s.walls.has(k) && !Wd.terminal.has(k)) {
          const a = bestA(hx, hy), c = ctr(hx, hy);
          const outs = [[a, 1 - s.slip, 'gold'], [(a + 1) % 4, s.slip / 2, 'purple'], [(a + 3) % 4, s.slip / 2, 'purple']];
          for (const [aa, p, colr] of outs) if (p > 0.005) G.vec(c, [Math.cos(ANG[aa]) * 0.85, Math.sin(ANG[aa]) * 0.85], { color: colr, width: 2 + 9 * p, alpha: 0.9 });
          G.rrect(hx + 0.02, GH - 1 - hy + 0.02, 0.96, 0.96, 6, { color: 'ink', width: 2.5 });
        }
        // drifting wind streaks
        if (s.slip > 0.01) G.clip(() => {
          for (let i = 0; i < 14; i++) {
            const y = ((i * 0.37) % 1) * GH, x = ((s.t * (0.4 + s.slip * 2) + i * 0.71) % 1.2) * GW - 0.5;
            G.line([x, y], [Math.min(GW, x + 0.5 + s.slip), y + 0.06], { color: alpha('purple', 0.25 + s.slip), width: 2 });
          }
        });
      }
      if (s.beat === 3) {
        const b = s.bot;
        G.path(b.trail.map((c) => ctr(...c)), { color: alpha('pink', 0.55), width: 3 });
        const a = ctr(...b.from), z = ctr(...b.c), u = smoothstep(b.u);
        const p = [a[0] + (z[0] - a[0]) * u, a[1] + (z[1] - a[1]) * u + Math.sin(Math.PI * u) * 0.15];
        if (b.slipped > 0) G.blob(p, 0.3, { color: 'purple', alpha: 0.6 * b.slipped });
        G.emoji(b.mood ?? '🤖', p, Math.max(18, px * 0.6));
      }
    }

    function drawPanel() {
      const ctx = P.ctx, A = P.area;
      ctx.save();
      const pad = 16, x0 = A.x + pad + 18, y0 = A.y + pad + 14, w = A.w - 2 * pad - 24, h = A.h - 2 * pad - 30;
      ctx.font = '15px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (s.beat === 3) {
        // tally: how many walks ended in candy vs lava
        const tot = Math.max(1, s.tally.win + s.tally.lose);
        [['🍬', s.tally.win, 'gold'], ['🔥', s.tally.lose, 'coral']].forEach(([ic, n, c], i) => {
          const bw = w / 4, bx = x0 + w * (0.2 + 0.45 * i), bh = (h - 20) * (n / tot);
          ctx.fillStyle = alpha('faint', 0.4); ctx.fillRect(bx, y0, bw, h - 20);
          ctx.fillStyle = C[c]; ctx.fillRect(bx, y0 + h - 20 - bh, bw, bh);
          ctx.fillStyle = C.ink; ctx.fillText(ic, bx + bw / 2, y0 + h);
          ctx.font = '700 14px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = C[c]; ctx.fillText(String(n), bx + bw / 2, y0 + h - 30 - bh);
          ctx.font = '15px system-ui, "Apple Color Emoji", sans-serif';
        });
        ctx.restore(); return;
      }
      // convergence: biggest change per sweep, on a log scale
      ctx.strokeStyle = alpha('muted', 0.6); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + h); ctx.lineTo(x0 + w, y0 + h); ctx.stroke();
      ctx.fillStyle = C.coral; ctx.font = '700 16px ui-rounded, system-ui, sans-serif';
      ctx.fillText('Δ', x0 - 12, y0 + 4);
      ctx.font = '14px system-ui, "Apple Color Emoji", sans-serif'; ctx.fillStyle = C.ink; ctx.fillText('🔁', x0 + w - 6, y0 + h + 16);
      const ly = (d) => y0 + h * clamp((0 - Math.log10(Math.max(d, 1e-5))) / 5, 0, 1);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = alpha('lime', 0.8);
      ctx.beginPath(); ctx.moveTo(x0, ly(1e-4)); ctx.lineTo(x0 + w, ly(1e-4)); ctx.stroke(); ctx.setLineDash([]);
      const n = Math.max(25, s.deltas.length);
      ctx.strokeStyle = C.coral; ctx.lineWidth = 2.5; ctx.beginPath();
      s.deltas.forEach((d, i) => { const X = x0 + (w * i) / (n - 1), Y = ly(d); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke();
      s.deltas.forEach((d, i) => { ctx.fillStyle = C.coral; ctx.beginPath(); ctx.arc(x0 + (w * i) / (n - 1), ly(d), 3, 0, 2 * Math.PI); ctx.fill(); });
      if (s.done) { ctx.font = '22px system-ui, "Apple Color Emoji", sans-serif'; ctx.fillText('✅', x0 + w - 16, ly(1e-4) - 18); }
      ctx.restore();
      void ACTIONS;
    }
  },
};
