// Q-learning: a mouse tries moves, and each square remembers "how good was going
// up / right / down / left from here?" (four little triangles). Good memories
// leak backward from the cheese, one bump at a time, until the mouse just runs.
import { C, alpha, cmapCSS } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { gridStep, qLearningEpisode } from '../core/learning.js';
import { rng, clamp, smoothstep } from '../core/random.js';

const GW = 7, GH = 5;
const WALLS = ['3,0', '1,1', '3,1', '5,1', '1,2', '5,2', '1,3', '3,4', '5,4'];
const START = [0, 4], CHEESE = '6,0', TRAP = '3,2';
const ANG = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];

export default {
  eq: [
    [['Q', 'blue'], '(s,a) ← ', ['Q', 'blue'], '(s,a) + ', ['α', 'orange'], ' [ ', ['r', 'gold'], ' + ', ['γ', 'orange'], ' max ', ['Q', 'blue'], '(s′,·) − ', ['Q', 'blue'], '(s,a) ]'],
    ['pick a move:  random with chance ', ['ε', 'purple'], ',  else the best ', ['Q', 'blue']],
    ['one bump per step → good news travels back from ', ['🧀', 'gold'], ' one square per visit'],
  ],
  setup({ stage, ui }) {
    const [G, P] = stage.split([[0, 0, GW, GH], [0, 0, 1, 1]], [3, 1.15]);
    const rand = rng(8);
    const world = { W: GW, H: GH, walls: new Set(WALLS), rewards: new Map([[CHEESE, 1], [TRAP, -1]]), terminal: new Set([CHEESE, TRAP]), stepCost: -0.04 };
    const s = {
      beat: 0, eps: 0.2, alpha: 0.5, gamma: 0.9, Q: null, ep: 0, rets: [], t: 0,
      m: null, acc: 0, flash: null,
    };
    const freshQ = () => Array.from({ length: GH }, () => Array.from({ length: GW }, () => [0, 0, 0, 0]));
    const newEp = () => { s.m = { c: START.slice(), from: START.slice(), u: 1, ret: 0, steps: 0, trail: [{ c: START.slice(), explore: false }], end: null, wait: 0 }; };
    s.Q = freshQ(); newEp();
    const settings = () => (s.beat === 0 ? { eps: 1, alpha: 0 } : s.beat === 2 ? { eps: 0, alpha: 0 } : { eps: s.eps, alpha: s.alpha });
    const argmaxRand = (qs) => { const m = Math.max(...qs); const ties = [0, 1, 2, 3].filter((a) => qs[a] > m - 1e-9); return ties[Math.floor(rand() * ties.length)]; };

    // one step of real Q-learning (same rule as qLearningEpisode, one step at a time so we can watch)
    const step = () => {
      const m = s.m, { eps, alpha: al } = settings();
      const qs = s.Q[m.c[1]][m.c[0]];
      const explore = rand() < eps;
      const a = explore ? Math.floor(rand() * 4) : argmaxRand(qs);
      const st = gridStep(world, m.c, a, 0, rand);
      const target = st.r + (st.done ? 0 : s.gamma * Math.max(...s.Q[st.s[1]][st.s[0]]));
      const before = qs[a];
      qs[a] += al * (target - qs[a]);
      if (al > 0 && Math.abs(qs[a] - before) > 1e-4) s.flash = { c: m.c.slice(), a, t: 0, up: qs[a] > before };
      m.ret += st.r; m.steps++;
      m.from = m.c; m.c = st.s; m.u = 0;
      m.trail.push({ c: st.s.slice(), explore });
      if (st.done || m.steps >= 80) { m.end = st.done ? (st.r > 0 ? '🎉' : '💥') : '😴'; m.wait = 0.7; }
    };
    const finishEp = () => { s.rets.push({ r: s.m.ret, eps: settings().eps }); if (s.rets.length > 150) s.rets.shift(); s.ep++; newEp(); };
    const fastTrain = (n) => {
      for (let i = 0; i < n; i++) {
        const r = qLearningEpisode(world, s.Q, { start: START, alpha: s.alpha, gamma: s.gamma, eps: Math.max(0.1, s.eps), maxSteps: 80, rand });
        s.rets.push({ r: r.ret, eps: Math.max(0.1, s.eps) }); s.ep++;
      }
      if (s.rets.length > 150) s.rets.splice(0, s.rets.length - 150);
      newEp();
    };

    ui.beats(['🎲', '🧠', '🏃', '⚖️'], (b) => {
      s.beat = b; newEp();
      if (b === 0) { s.Q = freshQ(); s.rets = []; s.ep = 0; }
      if (b === 2 && s.ep < 80) fastTrain(80 - s.ep);
    });
    ui.slider({ icon: '🎲', color: 'purple', min: 0, max: 1, step: 0.01, value: s.eps, title: 'explore chance ε', onInput: (v) => (s.eps = v) });
    ui.button({ icon: '⏩', title: 'practice 25 times', onClick: () => fastTrain(25) });
    ui.button({ icon: '🧽', title: 'forget everything', onClick: () => { s.Q = freshQ(); s.rets = []; s.ep = 0; newEp(); } });
    ui.readout(() => String(s.ep), { icon: '🏁', color: 'teal', title: 'tries' });
    ui.readout(() => fmt(s.m.ret, 2), { icon: '🧀', color: 'gold', title: 'reward this try' });

    const ctr = (x, y) => [x + 0.5, GH - 1 - y + 0.5];

    return {
      update(dt) {
        s.t += dt;
        if (s.flash) { s.flash.t += dt; if (s.flash.t > 0.6) s.flash = null; }
        const m = s.m;
        const rate = s.beat === 2 ? 5 : s.beat === 0 ? 10 : 14;
        if (m.u < 1) { m.u = Math.min(1, m.u + dt * rate); return; }
        if (m.end) { m.wait -= dt; if (m.wait < 0) finishEp(); return; }
        step();
      },
      draw() { drawMaze(); drawPlot(); },
    };

    function drawMaze() {
      const px = G.px(1), showQ = s.beat > 0;
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        const k = `${x},${y}`, X = x, Y = GH - 1 - y;
        if (world.walls.has(k)) { G.rrect(X + 0.03, Y + 0.03, 0.94, 0.94, 6, { fill: C.slate, stroke: false }); continue; }
        if (k === CHEESE || k === TRAP) {
          G.rrect(X + 0.03, Y + 0.03, 0.94, 0.94, 6, { fill: alpha(k === CHEESE ? 'gold' : 'coral', 0.35), stroke: false });
          G.emoji(k === CHEESE ? '🧀' : '🪤', ctr(x, y), Math.max(16, px * 0.55));
          continue;
        }
        if (!showQ) { G.rrect(X + 0.03, Y + 0.03, 0.94, 0.94, 6, { fill: alpha('panel', 0.9), color: alpha('muted', 0.3), width: 1 }); continue; }
        // four triangles: Q(s, up/right/down/left)
        const c = [X + 0.5, Y + 0.5], corners = [[X + 0.03, Y + 0.97], [X + 0.97, Y + 0.97], [X + 0.97, Y + 0.03], [X + 0.03, Y + 0.03]];
        const tri = [[corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[3]], [corners[3], corners[0]]];
        const qs = s.Q[y][x];
        for (let a = 0; a < 4; a++) {
          G.poly([tri[a][0], tri[a][1], c], { fill: cmapCSS(clamp(0.5 + 0.5 * qs[a], 0, 1), 'div'), color: alpha('white', 0.7), width: 1.2 });
        }
        if (s.flash && s.flash.c[0] === x && s.flash.c[1] === y) {
          const a = s.flash.a;
          G.poly([tri[a][0], tri[a][1], c], { fill: 'transparent', color: s.flash.up ? 'teal' : 'coral', width: 3.5, alpha: 1 - s.flash.t / 0.6 });
        }
        if (s.beat >= 2 && Math.max(...qs) - Math.min(...qs) > 1e-6) {
          const a = qs.indexOf(Math.max(...qs)), d = [Math.cos(ANG[a]) * 0.26, Math.sin(ANG[a]) * 0.26];
          G.arrow([c[0] - d[0], c[1] - d[1]], [c[0] + d[0], c[1] + d[1]], { color: alpha('black', 0.75), width: Math.max(2, px * 0.045), head: Math.max(7, px * 0.15) });
        }
      }
      G.rect(0, 0, GW, GH, { color: alpha('muted', 0.5), width: 1.5 });
      G.emoji('🏠', ctr(...START), Math.max(12, px * 0.32), { alpha: 0.5 });
      // this try's trail (purple steps = random "explore" steps)
      const tr = s.m.trail;
      for (let i = 1; i < tr.length; i++) {
        const a = ctr(...tr[i - 1].c), b = ctr(...tr[i].c);
        const o = (i % 5) * 0.03 - 0.06;
        G.line([a[0] + o, a[1] + o], [b[0] + o, b[1] + o], { color: tr[i].explore && s.beat !== 0 ? alpha('purple', 0.75) : alpha('pink', 0.55), width: 3 });
      }
      const m = s.m, a = ctr(...m.from), b = ctr(...m.c), u = smoothstep(m.u);
      const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + Math.sin(Math.PI * u) * 0.12];
      G.emoji('🐭', p, Math.max(20, px * 0.55));
      if (m.end) G.emoji(m.end, [p[0], p[1] + 0.55], Math.max(18, px * 0.45));
    }

    function drawPlot() {
      const ctx = P.ctx, A = P.area;
      const pad = 16, x0 = A.x + pad + 22, y0 = A.y + pad + 10, w = A.w - 2 * pad - 30, h = A.h - 2 * pad - 30;
      ctx.save();
      const lo = -2.5, hi = 1;
      const Y = (r) => y0 + h * (1 - (clamp(r, lo, hi) - lo) / (hi - lo));
      ctx.strokeStyle = alpha('muted', 0.6); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + h); ctx.lineTo(x0 + w, y0 + h); ctx.stroke();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = alpha('muted', 0.5);
      ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x0 + w, Y(0)); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '15px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.ink;
      ctx.fillText('🧀', x0 - 14, y0 + 6); ctx.fillText('🏁', x0 + w - 6, y0 + h + 16);
      const R = s.rets, n = Math.max(30, R.length);
      R.forEach((e, i) => { ctx.fillStyle = alpha(e.eps > 0.5 ? 'purple' : 'teal', 0.75); ctx.beginPath(); ctx.arc(x0 + (w * i) / (n - 1), Y(e.r), 3, 0, 2 * Math.PI); ctx.fill(); });
      // moving average
      ctx.strokeStyle = C.blue; ctx.lineWidth = 3; ctx.beginPath();
      R.forEach((_, i) => { const k0 = Math.max(0, i - 9); let sm = 0; for (let k = k0; k <= i; k++) sm += R[k].r; const X = x0 + (w * i) / (n - 1), Yv = Y(sm / (i - k0 + 1)); i ? ctx.lineTo(X, Yv) : ctx.moveTo(X, Yv); });
      ctx.stroke();
      ctx.restore();
    }
  },
};
