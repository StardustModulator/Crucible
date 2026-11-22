// Bandits: four slot machines, each secretly pays from its own bell curve.
// Play the one that LOOKS best (exploit) or try others to learn more (explore)?
// Greedy gets stuck, ε-greedy wastes a little forever, UCB is hopeful about the
// machines it knows least — and its regret grows slowest.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { rng, clamp, smoothstep } from '../core/random.js';

const MU = [0.45, 0.7, 0.3, 0.6], SD = 0.35, BEST = Math.max(...MU);
const XS = [1.25, 3.75, 6.25, 8.75];
const LO = -0.35, HI = 1.35;                   // payout axis range
const Y = (r) => 0.75 + ((clamp(r, LO, HI) - LO) / (HI - LO)) * 3.9;
const KINDS = {
  you: { icon: '✋', color: 'pink' }, greedy: { icon: '🤑', color: 'orange' },
  eps: { icon: '🎲', color: 'purple' }, ucb: { icon: '📏', color: 'blue' },
};
const UCB_C = 0.25;

function agent(kind, seed) { return { kind, r: rng(seed), n: [0, 0, 0, 0], sum: [0, 0, 0, 0], t: 0, regret: 0, curve: [0], samples: [[], [], [], []], last: null }; }
const means = (A) => A.n.map((k, i) => (k ? A.sum[i] / k : 0));
const bonus = (A, i) => (A.n[i] ? UCB_C * Math.sqrt((2 * Math.log(Math.max(1, A.t))) / A.n[i]) : Infinity);
function choose(A, eps) {
  const first = A.n.indexOf(0);
  if (first >= 0) return { a: first, explore: false };
  const m = means(A);
  if (A.kind === 'eps' && A.r() < eps) return { a: Math.floor(A.r() * 4), explore: true };
  if (A.kind === 'ucb') { const u = m.map((x, i) => x + bonus(A, i)); return { a: u.indexOf(Math.max(...u)), explore: false }; }
  return { a: m.indexOf(Math.max(...m)), explore: false };
}
function pull(A, a, explore = false) {
  const x = A.r.normal(MU[a], SD);
  A.n[a]++; A.sum[a] += x; A.t++; A.regret += BEST - MU[a]; A.curve.push(A.regret);
  A.samples[a].push(x); if (A.samples[a].length > 40) A.samples[a].shift();
  A.last = { a, x, age: 0, explore };
}

export default {
  eq: [
    ['estimate:  ', ['μ̂ᵢ', 'blue'], ' = average payout of machine i      pulls ', ['nᵢ', 'teal']],
    [['🤑', 'orange'], ' greedy: argmax ', ['μ̂ᵢ', 'blue'], '     ', ['🎲', 'purple'], ' ε-greedy: random with chance ', ['ε', 'purple']],
    [['📏', 'blue'], ' UCB: argmax ', ['μ̂ᵢ', 'blue'], ' + c·√(2 ln t / ', ['nᵢ', 'teal'], ')   ← ', ['hope', 'gold'], ' for the less-known'],
    [['regret', 'coral'], '(T) = Σₜ ( ', ['μ*', 'lime'], ' − μ_chosen )     UCB grows like log T, greedy can grow like T'],
  ],
  setup({ stage, ui }) {
    const [L, R] = stage.split([[0, -0.2, 10, 7.4], [0, 0, 1, 1]], [1.7, 1]);
    const s = { beat: 0, eps: 0.1, reveal: false, A: agent('you', 9), race: null, timer: 0, t: 0, lever: [0, 0, 0, 0] };
    const newRace = () => {
      const seeds = [9, 25, 3, 14, 7, 21];
      s.race = ['greedy', 'eps', 'ucb'].map((k) => ({ kind: k, runs: seeds.map((sd) => agent(k, sd)) }));
    };
    const reset = () => {
      s.A = agent(['you', 'greedy', 'eps', 'ucb', 'ucb'][s.beat], 9);
      s.timer = 0;
      if (s.beat === 4) newRace();
    };
    const doPull = (a, explore) => { pull(s.A, a, explore); s.lever[a] = 1; };

    ui.beats(['🎰', '🤑', '🎲', '📏', '📉'], (b) => { s.beat = b; reset(); });
    ui.slider({ icon: '🎲', color: 'purple', min: 0, max: 0.5, step: 0.01, value: s.eps, title: 'explore chance ε', onInput: (v) => (s.eps = v) });
    ui.toggle({ icon: '👁️', title: 'peek at the secret payout bells', color: 'purple', value: false, onChange: (v) => (s.reveal = v) });
    ui.button({ icon: '🔁', title: 'start over', onClick: reset });
    ui.readout(() => String(s.beat === 4 ? s.race[0].runs[0].t : s.A.t), { icon: '🎰', color: 'teal', title: 'pulls' });
    ui.readout(() => fmt(s.beat === 4 ? s.race[2].runs.reduce((a, r) => a + r.regret, 0) / s.race[2].runs.length : s.A.regret, 1), { icon: '📉', color: 'coral', title: 'regret' });

    const off = stage.on('down', (e) => {
      if (e.pen !== L || s.beat !== 0) return;
      const i = XS.findIndex((x) => Math.abs(e.p[0] - x) < 1.15);
      if (i >= 0) doPull(i, false);
    });

    return {
      update(dt) {
        s.t += dt; s.timer += dt;
        s.lever = s.lever.map((v) => Math.max(0, v - dt * 3));
        if (s.A.last) s.A.last.age += dt;
        if (s.beat >= 1 && s.beat <= 3) {
          const every = s.A.t < 12 ? 0.35 : 0.16;
          if (s.timer > every && s.A.t < 400) { s.timer = 0; const c = choose(s.A, s.eps); doPull(c.a, c.explore); }
        }
        if (s.beat === 4) {
          const steps = Math.min(6, Math.floor(s.timer / 0.03));
          if (steps > 0) {
            s.timer -= steps * 0.03;
            for (let k = 0; k < steps; k++) for (const grp of s.race) for (const A of grp.runs) if (A.t < 600) { const c = choose(A, s.eps); pull(A, c.a, c.explore); }
          }
        }
      },
      draw() { drawMachines(); drawRegret(); },
      dispose() { off(); },
    };

    function drawMachines() {
      const A = s.A, m = means(A), race = s.beat === 4;
      // payout axis grid lines
      for (const r of [0, 0.5, 1]) L.line([0.1, Y(r)], [9.9, Y(r)], { color: alpha('muted', r === 0 ? 0.45 : 0.18), width: 1, dash: r === 0 ? [] : [3, 5] });
      L.text('0', [0.05, Y(0)], { size: 11, color: 'muted', align: 'left' });
      L.text('1', [0.05, Y(1)], { size: 11, color: 'muted', align: 'left' });
      XS.forEach((x, i) => {
        const chosen = A.last && A.last.a === i && A.last.age < 0.3 && !race;
        // the machine
        const top = 7.05, bot = 5.25, lv = smoothstep(s.lever[i]);
        L.rrect(x - 0.9, bot, 1.8, top - bot, 12, { fill: alpha(chosen ? 'gold' : 'panel', chosen ? 0.35 : 0.95), color: chosen ? 'gold' : alpha('muted', 0.6), width: chosen ? 3 : 2 });
        L.emoji('🎰', [x, (top + bot) / 2 + 0.05], Math.max(22, L.px(1.05)));
        L.line([x + 0.95, bot + 0.9], [x + 1.12, bot + 0.9 + 0.75 * (1 - lv) - 0.35 * lv], { color: 'muted', width: 3 });
        L.dot([x + 1.12, bot + 0.9 + 0.75 * (1 - lv) - 0.35 * lv], 5, { color: 'coral' });
        if (race) {
          // pull counts per strategy (averaged over runs)
          s.race.forEach((grp, k) => {
            const n = grp.runs.reduce((a, r) => a + r.n[i], 0) / grp.runs.length, tot = Math.max(1, grp.runs[0].t);
            const h = 3.9 * (n / tot), bx = x - 0.6 + k * 0.42;
            L.rrect(bx, Y(LO), 0.34, Math.max(0.02, h), 4, { fill: col(KINDS[grp.kind].color), stroke: false, alpha: 0.85 });
          });
          if (MU[i] === BEST) L.emoji('👑', [x, 4.95], 18);
          return;
        }
        // secret bell (sideways), and the truth line
        if (s.reveal) {
          const pts = [];
          for (let r = LO; r <= HI + 1e-9; r += 0.025) pts.push([x + 0.05 + 0.75 * Math.exp(-0.5 * ((r - MU[i]) / SD) ** 2), Y(r)]);
          L.poly([[x + 0.05, Y(LO)], ...pts, [x + 0.05, Y(HI)]], { fill: alpha('purple', 0.18), color: alpha('purple', 0.8), width: 1.8 });
          L.line([x - 0.7, Y(MU[i])], [x + 0.85, Y(MU[i])], { color: 'lime', width: 2.5, dash: [6, 4] });
          if (MU[i] === BEST) L.emoji('👑', [x, 4.95], 18);
        }
        // samples: every payout this machine gave
        A.samples[i].forEach((v, k) => L.dot([x - 0.55 + ((k * 0.37) % 1) * 0.5, Y(v)], 3.2, { color: alpha('teal', 0.6) }));
        if (A.n[i]) {
          const cb = A.kind === 'ucb' || s.beat === 0 ? bonus(A, i) : Infinity;
          if (Number.isFinite(cb) && (A.kind === 'ucb')) {
            L.rect(x - 0.32, Y(m[i] - cb), 0.64, Y(m[i] + cb) - Y(m[i] - cb), { fill: alpha('blue', 0.16), stroke: false });
            L.line([x - 0.42, Y(m[i] + cb)], [x + 0.42, Y(m[i] + cb)], { color: 'gold', width: 4 });
          }
          L.line([x - 0.5, Y(m[i])], [x + 0.5, Y(m[i])], { color: 'blue', width: 4.5 });
        }
        L.text(String(A.n[i]), [x, 0.3], { size: 16, color: 'teal' });
      });
      // the newest payout pops out as a coin
      const l = A.last;
      if (l && l.age < 0.8 && !race) {
        const u = smoothstep(l.age / 0.8), x = XS[l.a];
        L.emoji('🪙', [x, 5.0 - u * 0.25], 18, { alpha: 1 - u * 0.6 });
        L.text(fmt(l.x, 2), [x + 0.5, 5.0 - u * 0.25], { size: 13, color: l.x > 0.5 ? 'lime' : 'coral', align: 'left' });
        if (l.explore) L.emoji('🎲', [x - 0.6, 5.0], 18);
      }
      if (s.beat === 0 && A.t === 0) {
        const k = Math.floor(s.t * 1.2) % 4, b = 0.5 + 0.5 * Math.sin(s.t * 6);
        L.emoji('👆', [XS[k] + 0.2, 4.95 - b * 0.15], 24);
      }
    }

    function drawRegret() {
      const ctx = R.ctx, Ar = R.area;
      const pad = 16, x0 = Ar.x + pad + 24, y0 = Ar.y + pad + 12, w = Ar.w - 2 * pad - 34, h = Ar.h - 2 * pad - 34;
      const lines = s.beat === 4
        ? s.race.map((grp) => ({ kind: grp.kind, pts: grp.runs[0].curve.map((_, t) => grp.runs.reduce((a, r) => a + (r.curve[t] ?? r.regret), 0) / grp.runs.length) }))
        : [{ kind: s.A.kind, pts: s.A.curve }];
      const T = Math.max(s.beat === 4 ? 600 : 60, ...lines.map((l) => l.pts.length));
      const Rmax = Math.max(4, ...lines.map((l) => l.pts[l.pts.length - 1] ?? 0)) * 1.15;
      ctx.save();
      ctx.strokeStyle = alpha('muted', 0.6); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + h); ctx.lineTo(x0 + w, y0 + h); ctx.stroke();
      ctx.font = '15px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = C.coral; ctx.fillText('📉', x0 - 14, y0 + 4);
      ctx.fillStyle = C.ink; ctx.fillText('🎰', x0 + w - 6, y0 + h + 17);
      for (const l of lines) {
        const colr = C[KINDS[l.kind].color];
        ctx.strokeStyle = colr; ctx.lineWidth = 3; ctx.beginPath();
        const step = Math.max(1, Math.floor(l.pts.length / 300));
        for (let t = 0; t < l.pts.length; t += step) { const X = x0 + (w * t) / T, Yv = y0 + h - (h * l.pts[t]) / Rmax; t ? ctx.lineTo(X, Yv) : ctx.moveTo(X, Yv); }
        ctx.stroke();
        const t = l.pts.length - 1, X = x0 + (w * t) / T, Yv = y0 + h - (h * l.pts[t]) / Rmax;
        ctx.font = '16px system-ui, "Apple Color Emoji", sans-serif';
        ctx.fillText(KINDS[l.kind].icon, Math.min(X + 12, x0 + w + 6), Yv - 10);
      }
      ctx.restore();
    }
  },
};

const col = (c) => (c in C ? C[c] : c);
