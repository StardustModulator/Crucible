// Behavior cloning: a little neural net 🧠 learns to steer by copying an expert 🧑‍🏫.
// The expert never makes mistakes — so the copy never sees how to RECOVER.
// Its tiny errors push it into places the expert never drove, where it has no idea → 💥.
// DAgger: let the copy drive, have the expert label where it went (gold arrows), retrain.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { MLP, Optimizer, trainBatch } from '../core/learning.js';
import { rng, clamp, wrapAngle } from '../core/random.js';

// ---------------- the road ----------------
const N = 900, W = 0.28, V = 1.4, DT = 0.02, NOISE = 0.35, SEED = 3;
const P = [];
for (let i = 0; i < N; i++) { const u = (i / N) * 2 * Math.PI; P.push([2.4 * Math.cos(u) + 0.2 * Math.cos(2 * u), 1.35 * Math.sin(u) + 0.3 * Math.sin(2 * u)]); }
const HEAD = P.map((p, i) => { const q = P[(i + 1) % N]; return Math.atan2(q[1] - p[1], q[0] - p[0]); });
const SEG = P.map((p, i) => Math.hypot(P[(i + 1) % N][0] - p[0], P[(i + 1) % N][1] - p[1]));
const KAP = HEAD.map((h, i) => wrapAngle(HEAD[(i + 1) % N] - h) / SEG[i]);
const LEN = SEG.reduce((a, b) => a + b, 0), LAP = Math.round(LEN / V / DT);
const NRM = P.map((_, i) => [-Math.sin(HEAD[i]), Math.cos(HEAD[i])]);
const EDGE_L = P.map((p, i) => [p[0] + NRM[i][0] * W, p[1] + NRM[i][1] * W]);
const EDGE_R = P.map((p, i) => [p[0] - NRM[i][0] * W, p[1] - NRM[i][1] * W]);

function near(p, hint) {
  let best = hint, bd = Infinity;
  for (let k = -60; k <= 60; k++) { const i = (hint + k + N) % N, d = (p[0] - P[i][0]) ** 2 + (p[1] - P[i][1]) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
function sense(car) {
  const i = near(car.p, car.i); car.i = i;
  const r = [car.p[0] - P[i][0], car.p[1] - P[i][1]];
  return { d: Math.cos(HEAD[i]) * r[1] - Math.sin(HEAD[i]) * r[0], psi: wrapAngle(car.h - HEAD[i]), k: KAP[i], i };
}
const expert = (f) => clamp(f.k - 5 * f.d - 3.2 * f.psi, -3, 3);   // steer back to the middle
const feat = (f) => [f.d / 0.25, f.psi / 0.4, f.k / 1.5];
const newCar = (seed) => ({ p: P[0].slice(), h: HEAD[0], i: 0, crashed: 0, t: 0, trail: [], cum: 0, err: [], R: rng(seed), visits: [] });
function stepCar(car, pol) {
  const f = sense(car);
  if (Math.abs(f.d) > W) { car.crashed = 1.3; return f; }
  const c = pol(f) + car.R.normal(0, NOISE);
  car.h += V * c * DT;
  car.p = [car.p[0] + V * Math.cos(car.h) * DT, car.p[1] + V * Math.sin(car.h) * DT];
  car.t += DT;
  return f;
}

function makeNet() { const net = new MLP([3, 16, 16, 1], ['tanh', 'tanh', 'linear'], SEED); return { net, opt: new Optimizer(net, { lr: 0.006 }), R: rng(SEED) }; }
function train(m, D, iters, log) {
  for (let it = 0; it < iters; it++) {
    const b = []; for (let k = 0; k < 32; k++) b.push(D[Math.floor(m.R() * D.length)]);
    const l = trainBatch(m.net, m.opt, b.map((x) => x[0]), b.map((x) => x[1]));
    if (log && it % 10 === 0) log.push(l);
  }
}
const policy = (m) => (f) => clamp(m.net.predict(feat(f))[0] * 2, -3, 3);
const clone = (m) => { const n = new MLP([3, 16, 16, 1], ['tanh', 'tanh', 'linear'], SEED); n.W = m.net.W.map((L) => L.map((r) => r.slice())); n.b = m.net.b.map((r) => r.slice()); return { net: n }; };

export default {
  eq: [
    ['BC:   min_θ  Σ_{s ∼ ', ['d_expert', 'lime'], '} ‖ ', ['π_θ(s)', 'blue'], ' − ', ['a*(s)', 'gold'], ' ‖²'],
    ['test states come from ', ['d_π', 'blue'], ' ≠ ', ['d_expert', 'lime'], '   →   mistakes add up:  ', ['J ≲ J* + T² ε', 'coral']],
    ['DAgger:  drive with ', ['π', 'blue'], ', ask the expert ', ['a*(s)', 'gold'], ' on those states, add them, retrain'],
    ['   →   ', ['J ≲ J* + T ε', 'blue'], '   (linear, not quadratic)'],
  ],
  setup({ stage, ui }) {
    const [A, B] = stage.split([[-2.85, -1.9, 2.85, 1.9], [0, 0, 10, 10]], [1.55, 1]);
    // expert data: exactly on the lane center (the expert never wobbles)
    const demo = [];
    for (let j = 0; j < N; j += 3) { const f = { d: 0, psi: 0, k: KAP[j] }; demo.push({ p: P[j], x: feat(f), y: [expert(f) / 2] }); }
    const D0 = demo.map((o) => [o.x, o.y]);
    const bc = makeNet(), lossLog = [];
    train(bc, D0, 600, lossLog);
    const bcPol = policy(bc);
    let dag = null, dagPol = null;
    const s = {
      beat: 0, t: 0, acc: 0, expertCar: null, car: null, car2: null, labels: [], rounds: [], round: 0,
      D: D0.slice(), phase: 'drive', hold: 0, race: [],
    };
    const startBeat = (i) => {
      s.beat = i; s.t = 0; s.acc = 0; s.labels = []; s.rounds = []; s.round = 0; s.phase = 'drive'; s.hold = 0;
      s.expertCar = i === 0 ? newCar(5) : null;
      s.car = newCar(99);
      if (i === 2) { dag = makeNet(); train(dag, D0, 600); dagPol = policy(dag); s.D = D0.slice(); }
      if (i === 3) {
        if (!dagPol || s.roundsDone < 2) { dag = makeNet(); let D = D0.slice(); train(dag, D, 600); dagPol = policy(dag); for (let r = 0; r < 2; r++) { const c = newCar(50 + r); for (let k = 0; k < LAP * 2 && !c.crashed; k++) { const f = stepCar(c, dagPol); if (k % 3 === 0) D.push([feat(f), [expert(f) / 2]]); } train(dag, D, 600); } dagPol = policy(dag); }
        s.car = newCar(99); s.car2 = newCar(99);
      } else s.car2 = null;
    };
    s.roundsDone = 0;
    ui.beats(['🐒', '📉', '🧑‍🏫', '📊'], startBeat);
    ui.button({ icon: '🔁', title: 'drive again', onClick: () => startBeat(s.beat) });
    ui.readout(() => (s.beat === 2 ? '🧑‍🏫×' + s.round : fmt(s.car ? Math.abs(sense({ ...s.car })?.d ?? 0) * 100 : 0, 0)), { icon: '🚗', color: 'blue', title: 'distance from the middle' });
    startBeat(0);

    const record = (car, f) => {
      if (car.t - (car.lastRec ?? -1) > 1 / 15) {
        car.lastRec = car.t;
        car.trail.push(car.p.slice()); if (car.trail.length > 400) car.trail.shift();
        car.cum += Math.min(Math.abs(f.d), W) * (1 / 15);
        car.err.push([car.t, Math.abs(f.d), car.cum]);
      }
    };

    return {
      update(dt) {
        dt = Math.max(0, dt); // the shell's dt can dip below 0 after a wake()
        s.t += dt; s.acc += dt;
        let steps = 0;
        while (s.acc >= DT && steps < 12) {
          s.acc -= DT; steps++;
          // beat 0: the expert drives one lap first, then the copy tries
          if (s.expertCar && s.expertCar.t < LEN / V) {
            const f = stepCar(s.expertCar, (ff) => clamp(ff.k - 5 * ff.d - 3.2 * ff.psi, -3, 3) - s.expertCar.R.normal(0, NOISE) * 0); record(s.expertCar, f);
            continue;
          }
          for (const [car, pol, isDag] of [[s.car, s.beat === 3 ? bcPol : s.beat === 2 ? dagPol : bcPol, false], [s.car2, dagPol, true]]) {
            if (!car) continue;
            if (car.crashed) {
              car.crashed -= DT;
              if (car.crashed <= 0) {
                if (s.beat === 2) { endRound(); }
                else if (s.beat === 3) { car.crashed = 1e9; } // stays crashed; cost keeps counting below
                else { const c = newCar(99); if (isDag) s.car2 = c; else s.car = c; }
              }
              if (s.beat === 3) { car.t += DT; car.cum += W * DT; if (car.t - (car.lastRec ?? -1) > 1 / 15) { car.lastRec = car.t; car.err.push([car.t, W, car.cum]); } }
              continue;
            }
            const f = stepCar(car, pol);
            if (s.beat === 2 && Math.floor(car.t / DT) % 3 === 0) car.visits.push({ p: car.p.slice(), h: car.h, f });
            record(car, f);
            if (s.beat === 2 && car.t > LEN / V * 1.15) endRound();
            if (s.beat === 3 && car.t > 18) { car.crashed = 1e9; }
          }
        }
        function endRound() {
          // the expert labels every state the copy visited → aggregate → retrain
          const c = s.car;
          c.visits.forEach((v) => { s.D.push([feat(v.f), [expert(v.f) / 2]]); s.labels.push(v); });
          s.rounds.push(c.err.map((e) => [e[0], e[1]]));
          train(dag, s.D, 600); dagPol = policy(dag);
          s.round++; s.roundsDone = s.round;
          s.car = newCar(60 + s.round);
        }
      },
      draw() {
        // ---------------- road ----------------
        A.fillBg(alpha('lime', 0.06));
        const ctx = A.ctx;
        ctx.save();
        A.path(P.concat([P[0]]), { color: alpha('slate', 0.38), width: A.px(2 * W) });
        ctx.restore();
        A.path(EDGE_L.concat([EDGE_L[0]]), { color: 'ink', width: 2 });
        A.path(EDGE_R.concat([EDGE_R[0]]), { color: 'ink', width: 2 });
        A.path(P.concat([P[0]]), { color: alpha('white', 0.7), width: 2, dash: [10, 10] });
        A.emoji('🏁', [P[0][0] + 0.2, P[0][1] - 0.5], 22);

        // expert data (teal dots on the lane center) and expert trail (lime)
        const showData = s.beat === 1 || s.beat === 2 || (s.beat === 0 && s.expertCar);
        if (showData) {
          const upto = s.beat === 0 && s.expertCar ? Math.min(N, Math.floor((s.expertCar.t * V) / LEN * N)) : N;
          demo.forEach((o, j) => { if (j * 3 <= upto) A.dot(o.p, 2.6, { color: 'teal' }); });
        }
        if (s.expertCar) {
          A.path(s.expertCar.trail, { color: 'lime', width: 5, alpha: 0.75 });
          if (s.expertCar.t < LEN / V) drawCar(A, s.expertCar.p, s.expertCar.h, 'lime');
        }
        if (s.beat === 2) {
          // gold arrows: what the expert says to do at the places the copy actually went
          s.labels.forEach((v, k) => {
            if (k % 3) return;
            const a = v.h + expert(v.f) * 0.3;
            A.vec(v.p, [Math.cos(a) * 0.17, Math.sin(a) * 0.17], { color: alpha('gold', 0.85), width: 2, head: 7 });
          });
        }
        const showCar = (car, color, trail) => {
          if (!car || (s.beat === 0 && s.expertCar && s.expertCar.t < LEN / V)) return;
          A.path(car.trail.slice(-160), { color: trail, width: 3.5 });
          drawCar(A, car.p, car.h, color);
          if (car.crashed) A.emoji('💥', car.p, 40);
        };
        if (s.beat === 3) { showCar(s.car, 'blue', alpha('coral', 0.8)); showCar(s.car2, 'blue', alpha('blue', 0.7)); }
        else showCar(s.car, 'blue', alpha(s.beat === 2 ? 'blue' : 'coral', 0.8));
        if (s.beat === 3) {
          if (s.car) A.emoji('🐒', [s.car.p[0], s.car.p[1] + 0.28], 20);
          if (s.car2) A.emoji('🧑‍🏫', [s.car2.p[0], s.car2.p[1] + 0.28], 20);
        }

        // ---------------- plots ----------------
        const px0 = 0.7, px1 = 9.6, py0 = 0.7, py1 = 9.3;
        B.rect(px0, py0, px1 - px0, py1 - py0, { color: alpha('muted', 0.3), width: 1 });
        if (s.beat === 0) {
          // learning curve (log loss), revealed while the expert drives
          const frac = s.expertCar ? clamp(s.expertCar.t / (LEN / V), 0, 1) : 1;
          const n = Math.max(2, Math.floor(lossLog.length * frac));
          const ls = lossLog.slice(0, n).map((l) => Math.log10(l + 1e-9));
          const lo = -6, hi = Math.max(...lossLog.map((l) => Math.log10(l + 1e-9)));
          B.path(ls.map((v, i) => [px0 + (i / (lossLog.length - 1)) * (px1 - px0), py0 + ((v - lo) / (hi - lo)) * (py1 - py0)]), { color: 'teal', width: 3 });
          B.emoji('🧠', [px1 - 0.6, py1 - 0.6], 24);
        } else if (s.beat === 1 || s.beat === 2) {
          // distance from the lane center over time (road edge = danger line)
          const T = 10, X = (t) => px0 + (t / T) * (px1 - px0), Y = (d) => py0 + (clamp(d, 0, W * 1.1) / (W * 1.1)) * (py1 - py0);
          B.line([px0, Y(W)], [px1, Y(W)], { color: 'coral', width: 2, dash: [6, 5] });
          s.rounds.forEach((r, k) => B.path(r.filter((e) => e[0] <= T).map((e) => [X(e[0]), Y(e[1])]), { color: alpha('blue', 0.15 + 0.6 * (k + 1) / (s.rounds.length + 1)), width: 2 }));
          if (s.car) B.path(s.car.err.filter((e) => e[0] <= T).map((e) => [X(e[0]), Y(e[1])]), { color: s.beat === 1 ? 'coral' : 'blue', width: 3 });
          B.emoji('💥', [px0 + 0.4, Y(W) + 0.45], 18);
        } else {
          // total mistakes so far: copy (quadratic-ish, then off the road) vs DAgger (linear)
          const T = 18, X = (t) => px0 + (t / T) * (px1 - px0);
          const cm = Math.max(0.6, ...(s.car?.err ?? []).map((e) => e[2]), ...(s.car2?.err ?? []).map((e) => e[2]));
          const Y = (c) => py0 + (c / cm) * (py1 - py0);
          if (s.car) B.path(s.car.err.map((e) => [X(e[0]), Y(e[2])]), { color: 'coral', width: 3 });
          if (s.car2) B.path(s.car2.err.map((e) => [X(e[0]), Y(e[2])]), { color: 'blue', width: 3 });
          B.emoji('🐒', [px1 - 0.5, py1 - 0.5], 20);
          B.emoji('🧑‍🏫', [px1 - 0.5, py1 - 1.4], 20);
          B.text('Σ|e|', [px0 + 0.7, py1 - 0.4], { size: 14, color: 'muted' });
        }
      },
    };
  },
};

function drawCar(g, p, h, color) {
  const ctx = g.ctx, [x, y] = g.toScreen(p), L = g.px(0.24), Wd = g.px(0.13);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-h);
  ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.roundRect(-L / 2 + 2, -Wd / 2 + 3, L, Wd, 4); ctx.fill();
  ctx.fillStyle = C[color] ?? color; ctx.beginPath(); ctx.roundRect(-L / 2, -Wd / 2, L, Wd, 4); ctx.fill();
  ctx.fillStyle = alpha('white', 0.75); ctx.beginPath(); ctx.roundRect(L * 0.08, -Wd * 0.35, L * 0.22, Wd * 0.7, 2); ctx.fill();
  ctx.restore();
}
