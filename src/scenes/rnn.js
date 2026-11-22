// A recurrent net reads a sequence one token at a time and carries a little
// "memory" from step to step. Task: remember the FIRST fruit until the ❓ at the end.
// A plain RNN squeezes its memory through the same layer every step, so it fades
// (and so does the blame flowing back in time). An LSTM keeps memory on a
// conveyor belt guarded by doors (gates): write once, keep, read at the end.
import { C, alpha, mix } from '../viz/palette.js';
import { act, softmax } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const KEYS = ['🍊', '🫐', '🌸'], KC = ['orange', 'blue', 'pink'];
const DIS = ['🌧️', '🚗', '🎈', '⚽', '🍄', '🎵'];
const sig = act.sigmoid.f;
// fixed little "meaning vectors" for the distractor tokens
const er = rng(3);
const DEMB = DIS.map(() => [er.normal(0, 0.75), er.normal(0, 0.75), er.normal(0, 0.75)]);

// x = [key one-hot ×3, distractor vector ×3, isKey, isQuery]
function encode(tok) {
  if (tok.k !== undefined) return [0, 1, 2].map((i) => (i === tok.k ? 2 : 0)).concat([0, 0, 0, 1, 0]);
  if (tok.q) return [0, 0, 0, 0, 0, 0, 0, 1];
  return [0, 0, 0, ...DEMB[tok.d], 0, 0];
}
// plain RNN:  h ← tanh(W h + U x),  W = 0.9·I (its best shot at remembering)
function runRNN(seq) {
  let h = [0, 0, 0];
  const hs = [], J = [];
  for (const tok of seq) {
    const x = encode(tok);
    const z = h.map((v, i) => 0.9 * v + x[i] + x[3 + i]);
    h = z.map(Math.tanh);
    hs.push(h.slice());
    J.push(h.map((v) => 0.9 * (1 - v * v)));          // ∂h_t/∂h_{t−1} is diagonal here
  }
  // how much the final memory still depends on step t: ‖∏ J‖
  const grads = seq.map((_, t) => { let g = [1, 1, 1]; for (let s = t + 1; s < seq.length; s++) g = g.map((v, i) => v * J[s][i]); return Math.max(...g.map(Math.abs)); });
  return { hs, mem: hs, p: softmax(h.map((v) => 4 * v)), grads };
}
// LSTM with hand-set gate weights:  f = σ(5),  i = σ(−5 + 10·isKey),  o = σ(−5 + 10·isQuery)
function runLSTM(seq) {
  let c = [0, 0, 0], h = [0, 0, 0];
  const cs = [], hs = [], gates = [];
  for (const tok of seq) {
    const x = encode(tok);
    const f = sig(5 + 0.2 * h[0]), i = sig(-5 + 10 * x[6]), o = sig(-5 + 10 * x[7]);
    const gg = [0, 1, 2].map((k) => Math.tanh(x[k] + 0.3 * x[3 + k]));
    c = c.map((v, k) => f * v + i * gg[k]);
    h = c.map((v) => o * Math.tanh(v));
    cs.push(c.slice()); hs.push(h.slice()); gates.push({ f, i, o });
  }
  const grads = seq.map((_, t) => { let g = 1; for (let s = t + 1; s < seq.length; s++) g *= gates[s].f; return g; });   // ∂c_T/∂c_t = ∏ f
  const hT = hs[hs.length - 1];
  return { hs, mem: cs, gates, p: softmax(hT.map((v) => 4 * v)), grads };
}

export default {
  eq: [
    ['RNN:  ', ['hₜ', 'purple'], ' = tanh(', ['W', 'blue'], ' ', ['hₜ₋₁', 'purple'], ' + ', ['U', 'blue'], ' ', ['xₜ', 'teal'], ')'],
    [['∂h_T/∂hₜ', 'coral'], ' = ∏ diag(1 − h²) ', ['W', 'blue'], '   → shrinks like 0.9ᵏ  🌫️'],
    ['LSTM:  ', ['cₜ', 'gold'], ' = ', ['f', 'lime'], ' ⊙ ', ['cₜ₋₁', 'gold'], ' + ', ['i', 'lime'], ' ⊙ tanh(…),    ', ['hₜ', 'purple'], ' = ', ['o', 'lime'], ' ⊙ tanh(', ['cₜ', 'gold'], ')'],
    ['gates ', ['f, i, o', 'lime'], ' = σ(…) ∈ (0, 1) — door openness;    ', ['∂c_T/∂cₜ', 'coral'], ' = ∏ ', ['f', 'lime'], ' ≈ 1  🚪'],
    ['(gate weights here are set by hand to show the mechanism; training finds similar ones)'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const s = { beat: 0, key: 0, T: 5, seed: 4, step: 0, t: 0, hold: 0 };
    let seq = [];
    const makeSeq = () => {
      const r = rng(s.seed);
      seq = [{ k: s.key }];
      for (let i = 0; i < s.T - 2; i++) seq.push({ d: r.int(0, DIS.length) });
      seq.push({ q: true });
      s.step = 0; s.hold = 0;
    };
    makeSeq();

    ui.beats(['🔁', '🌫️', '🚪', '🏁'], (b) => {
      s.beat = b;
      s.T = [5, 10, 10, stage.portrait ? 10 : 18][b]; lenS.set(s.T);
      makeSeq();
    });
    ui.choice({ value: 0, color: 'gold', options: KEYS.map((k, i) => ({ icon: k, value: i, title: 'fruit to remember', color: KC[i] })), onChange: (v) => { s.key = v; makeSeq(); } });
    const lenS = ui.slider({ icon: '🏁', color: 'teal', min: 3, max: 22, step: 1, value: s.T, title: 'sequence length', onInput: (v) => { s.T = v; makeSeq(); } });
    ui.button({ icon: '🎲', title: 'new middle tokens', onClick: () => { s.seed++; makeSeq(); } });
    ui.readout(() => { const m = s.beat === 2 ? runLSTM(seq) : runRNN(seq); return `${Math.round(100 * m.p[s.key])}%`; }, { icon: '🎯', color: 'gold', title: 'chance it names the right fruit' });

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt;
        if (s.step < seq.length) { s.step = Math.min(seq.length, s.step + dt / 0.5); }
        else { s.hold += dt; if (s.hold > 3.2) { s.step = 0; s.hold = 0; } }
      },
      draw() {
        const T = seq.length, two = s.beat === 3;
        // phones: wrap the chain into rows of 5
        const cpr = stage.portrait ? Math.min(T, 5) : T, rows = Math.ceil(T / cpr), RH = 4.0;
        const blockH = rows * RH, H = (two ? 2 : 1) * blockH;
        const W = cpr * 1.25 + 2.6;
        g.setBounds([-1.4, -0.2, W - 1.2, H + 0.2]);
        if (two) {
          drawRow(runRNN(seq), H - 2.4, false, cpr, RH);
          drawRow(runLSTM(seq), H - blockH - 2.4, true, cpr, RH);
        } else drawRow(s.beat === 2 ? runLSTM(seq) : runRNN(seq), H - 2.4, s.beat === 2, cpr, RH);
      },
    };

    function memColor(v) {
      // mix the three fruit colors by how strongly each is remembered
      const w = v.map((x) => Math.max(0, x)), sum = w.reduce((a, b) => a + b, 0);
      if (sum < 1e-3) return alpha('muted', 0.3);
      let c = KC[0], acc = w[0];
      for (let k = 1; k < 3; k++) { if (w[k] > 0) { c = mix(c, KC[k], w[k] / (acc + w[k])); acc += w[k]; } }
      return mix('faint', c, clamp(Math.max(...w) / 0.9, 0, 1));
    }

    // a sliding door: closed = coral bar across the path, open = lime bar slid out of the way
    function slideDoor(c, open, vertical) {
      const L = 0.36, off = open * 0.34;
      const colr = mix('coral', 'lime', clamp(open, 0, 1));
      const w = clamp(g.px(0.12), 3, 6);
      if (vertical) g.line([c[0], c[1] - L / 2 + off], [c[0], c[1] + L / 2 + off], { color: colr, width: w, cap: 'butt' });
      else g.line([c[0] - L / 2 + off, c[1]], [c[0] + L / 2 + off, c[1]], { color: colr, width: w, cap: 'butt' });
    }

    function drawRow(m, Y0, lstm, cpr, RH) {
      const T = seq.length, shown = Math.floor(s.step), part = s.step - shown;
      const X = (t) => (t % cpr) * 1.25, Yt = (t) => Y0 - Math.floor(t / cpr) * RH;
      const done = s.step >= T;
      // tokens
      seq.forEach((tok, t) => {
        if (t > shown) return;
        const a = t === shown ? clamp(part * 2, 0, 1) : 1, Y = Yt(t);
        const em = tok.k !== undefined ? KEYS[tok.k] : tok.q ? '❓' : DIS[tok.d];
        g.emoji(em, [X(t), Y + 2.15 - (1 - a) * 0.5], clamp(g.px(0.85), 12, 22), { alpha: a });
        g.line([X(t), Y + 1.85], [X(t), lstm ? Y + 1.12 : Y + 0.47], { color: alpha('teal', 0.5 * a), width: 2 });
      });
      // conveyor belt (LSTM cell state): each stretch is tinted by what it carries
      if (lstm) {
        for (let t = 0; t <= Math.min(shown, T - 1); t++) {
          const yb = Yt(t) + 1.05, x0 = X(t) - 0.62, x1 = X(t) + 0.63;
          g.line([x0, yb], [x1, yb], { color: memColor(m.mem[t]), width: clamp(g.px(0.22), 5, 11), cap: 'butt' });
          for (let k = 0; k < 3; k++) { const xx = x0 + ((k * 0.42 + s.t * 0.6) % 1.25); g.line([xx, yb - 0.09], [xx, yb + 0.09], { color: alpha('bg', 0.55), width: 1.5 }); }
        }
      }
      for (let t = 0; t < T; t++) {
        const vis = t <= shown, Y = Yt(t), yb = Y + 1.05;
        const bx = X(t) - 0.42;
        g.rrect(bx, Y - 0.45, 0.84, 0.9, 6, { fill: vis ? alpha('blue', 0.12) : alpha('faint', 0.15), color: vis ? 'blue' : alpha('muted', 0.3), width: 2, stroke: true });
        if (t < T - 1) {
          const colr = vis && t < shown ? memColor(m.hs[t]) : alpha('muted', 0.3);
          if (Yt(t + 1) === Y) g.arrow([X(t) + 0.45, Y], [X(t + 1) - 0.47, Y], { color: colr, width: 4 });
          else g.path([[X(t) + 0.45, Y], [X(t) + 0.75, Y], [X(t) + 0.75, Y - 0.95], [X(t + 1) - 0.75, Y - 0.95], [X(t + 1) - 0.75, Yt(t + 1)]], { color: colr, width: 3, dash: [5, 4] });
        }
        if (!vis) continue;
        // memory: three little bars (🍊 🫐 🌸)
        const v = m.hs[t];
        for (let k = 0; k < 3; k++) g.bar(bx + 0.12 + k * 0.22, Y - 0.35, 0.16, 0.7 * clamp(Math.abs(v[k]), 0, 1) + 0.02, { color: alpha(KC[k], v[k] >= 0 ? 0.9 : 0.3) });
        if (lstm) {
          const G = m.gates[t];
          slideDoor([X(t) - 0.62, yb], G.f, true);       // keep door ON the belt
          slideDoor([X(t), Y + 1.45], G.i, false);      // write door: token → belt
          g.line([X(t) + 0.3, yb - 0.1], [X(t) + 0.3, Y + 0.47], { color: alpha('gold', 0.6), width: 2 });
          slideDoor([X(t) + 0.3, Y + 0.72], G.o, false); // read door: belt → memory out
        }
      }
      // the answer
      if (done) {
        const p = m.p, best = p.indexOf(Math.max(...p)), ok = best === s.key && p[best] > 0.5;
        const ex = X(T - 1) + 1.05, ey = Yt(T - 1);
        g.emoji(ok ? KEYS[best] : '🤷', [ex, ey + 0.05], clamp(g.px(1), 14, 26));
        g.emoji(ok ? '✅' : '❌', [ex, ey + 0.8], clamp(g.px(0.7), 11, 18));
        // backward in time: how much the answer still "feels" each step (coral, log scale)
        const k = clamp(s.hold / 1.2, 0, 1);
        m.grads.forEach((gv, t) => {
          if ((T - 1 - t) / T > k) return;
          const hgt = clamp((Math.log10(Math.max(gv, 1e-9)) + 4) / 4, 0, 1) * 0.75;
          g.bar(X(t) - 0.2, Yt(t) - 1.45, 0.4, Math.max(hgt, 0.02), { color: alpha('coral', 0.25 + 0.75 * hgt / 0.75) });
          g.line([X(t) - 0.62, Yt(t) - 1.45], [X(t) + 0.63, Yt(t) - 1.45], { color: 'muted', width: 1 });
        });
      }
      g.emoji(lstm ? '🚪' : '🔁', [-1.0, Y0], clamp(g.px(0.8), 12, 20));
    }
    void C; void fmt;
  },
};
