// A VAE squeezes each little picture into a fuzzy blob on a 2-D map,
// picks a random spot inside the blob (🎲), and must redraw the picture from
// that spot. A magnet (KL) pulls all blobs toward the middle so the map has
// no holes — then ANY spot on the map draws a sensible new picture.
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
import { MLP, Optimizer } from '../core/learning.js';
import { rng, clamp } from '../core/random.js';

const PX = 8;
const sprite = (r, cx) => { const a = []; for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) a.push(clamp(r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - 4), 0, 1)); return a; };
const SHOW = [[1.1, 2.2], [3.1, 4], [1.8, 5.8], [2.4, 3], [1.3, 4.3]]; // the five pictures we follow

export default {
  eq: [
    ['encoder: ', ['x', 'teal'], ' → ', ['μ', 'blue'], ', ', ['σ', 'purple'], '  ·  decoder: ', ['z', 'pink'], ' → ', ['x̂', 'blue']],
    [['z', 'pink'], ' = ', ['μ', 'blue'], ' + ', ['σ', 'purple'], ' ⊙ ', ['ε', 'purple'], '  ·  ', ['ε', 'purple'], ' ~ 𝒩(0, I)  ·  🎲'],
    ['loss = ', ['−log p(x | z)', 'coral'], ' + ', ['β', 'orange'], ' · ', ['KL(𝒩(μ, σ²) ‖ 𝒩(0, I))', 'gold']],
    [['KL', 'gold'], ' = ½ Σ (', ['μ', 'blue'], '² + ', ['σ', 'purple'], '² − 1 − log ', ['σ', 'purple'], '²)'],
    ['new picture:  ', ['z', 'pink'], ' ~ 𝒩(0, I)  →  decoder'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const R = rng(1);
    const data = Array.from({ length: 200 }, () => sprite(R.uniform(1, 3.2), R.uniform(2, 6)));
    const shows = SHOW.map(([r, cx]) => sprite(r, cx));
    const enc = new MLP([PX * PX, 24, 4], ['tanh', 'linear'], 3), dec = new MLP([2, 24, PX * PX], ['tanh', 'sigmoid'], 4);
    const oe = new Optimizer(enc, { lr: 0.005 }), od = new Optimizer(dec, { lr: 0.005 });
    const s = { beat: 0, t: 0, beta: 1, sel: 0, eps: [0.6, -0.4], roll: 0, probe: [0.8, -0.6], gal: [], rec: 40, kl: 0, steps: 0 };

    const encode = (x) => { const o = enc.predict(x); return { mu: [o[0], o[1]], sd: [clamp(o[2], -8, 4), clamp(o[3], -8, 4)].map((v) => Math.exp(0.5 * v)) }; };
    const decode = (z) => dec.predict(z);
    const zeroG = (n) => ({ gW: n.W.map((W) => W.map((r) => r.map(() => 0))), gb: n.b.map((b) => b.map(() => 0)) });
    const addG = (A, B) => { A.gW.forEach((W, l) => W.forEach((r, i) => r.forEach((_, j) => (r[j] += B.gW[l][i][j])))); A.gb.forEach((b, l) => b.forEach((_, i) => (b[i] += B.gb[l][i]))); };
    // one minibatch of the real VAE objective, reparameterization gradients by hand
    function trainStep(B = 8) {
      const ge = zeroG(enc), gd = zeroG(dec); let rec = 0, kl = 0;
      for (let n = 0; n < B; n++) {
        const x = data[R.int(0, data.length)];
        const ae = enc.forward(x), o = ae[2];
        const mu = [o[0], o[1]], lv = [o[2], o[3]].map((v) => clamp(v, -8, 4)), sd = lv.map((v) => Math.exp(0.5 * v));
        const e = [R.normal(), R.normal()], z = [mu[0] + sd[0] * e[0], mu[1] + sd[1] * e[1]];
        const ad = dec.forward(z), y = ad[2];
        rec += -x.reduce((acc, t, i) => acc + t * Math.log(y[i] + 1e-7) + (1 - t) * Math.log(1 - y[i] + 1e-7), 0);
        kl += 0.5 * [0, 1].reduce((acc, i) => acc + mu[i] ** 2 + Math.exp(lv[i]) - 1 - lv[i], 0);
        const bd = dec.backward(ad, y.map((yi, i) => (yi - x[i]) / Math.max(yi * (1 - yi), 1e-6)));
        addG(gd, bd);
        const dz = [0, 1].map((j) => dec.W[0].reduce((acc, row, i) => acc + row[j] * bd.deltas[0][i], 0));
        const dmu = [0, 1].map((i) => dz[i] + s.beta * mu[i]);
        const dlv = [0, 1].map((i) => dz[i] * e[i] * 0.5 * sd[i] + s.beta * 0.5 * (Math.exp(lv[i]) - 1));
        addG(ge, enc.backward(ae, [...dmu, ...dlv]));
      }
      oe.step(ge.gW, ge.gb, B); od.step(gd.gW, gd.gb, B);
      s.rec += (rec / B - s.rec) * 0.05; s.kl += (kl / B - s.kl) * 0.05; s.steps++;
    }

    // layout: wide → [pictures | map | drawings], tall → stacked
    const lay = () => {
      const P = stage.portrait;
      const b = P ? [-3.75, -6.1, 3.75, 6.1] : [-8.6, -3.7, 8.6, 3.7];
      if (!g.bounds || g.bounds.join() !== b.join()) g.setBounds(b);
      const inP = (i) => (P ? [-3.1 + i * 1.55, 5.2] : [-7.4, 2.9 - i * 1.45]);
      const outP = (i) => (P ? [-3.1 + i * 1.55, -5.2] : [7.4, 2.9 - i * 1.45]);
      return { P, inP, outP, sc: 1.05, sz: 1.2 };
    };
    const Lz = (z, l) => [z[0] * l.sc, z[1] * l.sc];

    stage.handle({ pen: g, color: 'pink', r: 10, visible: () => s.beat === 3, get: () => Lz(s.probe, lay()), set: (p) => { s.probe = [clamp(p[0] / 1.05, -3, 3), clamp(p[1] / 1.05, -3, 3)]; } });
    stage.on('down', (e) => { // tap a picture to follow it
      const l = lay();
      SHOW.forEach((_, i) => { const c = l.inP(i); if (Math.abs(e.p[0] - c[0]) < 0.7 && Math.abs(e.p[1] - c[1]) < 0.7) { s.sel = i; s.roll = 0; s.t = 0; s.tapped = true; } });
    });

    ui.beats(['🗜️', '🎲', '🧲', '🗺️', '✨'], (b) => { s.beat = b; s.t = 0; s.gal = []; });
    ui.slider({ icon: '🧲', color: 'orange', min: 0, max: 4, step: 0.05, value: s.beta, title: 'KL weight β', onInput: (v) => (s.beta = v) });
    ui.button({ icon: '🎲', title: 'roll the dice', onClick: () => { s.roll = 0; newEps(); if (s.beat === 4) addGen(); } });
    ui.readout(() => fmt(s.rec, 1), { icon: '🖼️', color: 'coral', title: 'redraw error' });
    ui.readout(() => fmt(s.kl, 2), { icon: '🧲', color: 'gold', title: 'KL' });

    const newEps = () => { s.eps = [R.normal(), R.normal()]; };
    const addGen = () => { const z = [R.normal(), R.normal()]; s.gal.unshift(z); if (s.gal.length > 5) s.gal.pop(); };

    function hudMeter(icon, v, slot, colr) { // top-center bar, clear of the picture columns
      const ctx = stage.hud.ctx, W = 120, X = stage.hud.area.w / 2 - 150 + slot * 160, Y = stage.portrait ? g.toScreen([0, -3.95])[1] - 8 : 10;
      ctx.save(); ctx.font = '15px system-ui, "Apple Color Emoji", sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(icon, X, Y + 8);
      ctx.fillStyle = alpha('faint', 0.6); ctx.beginPath(); ctx.roundRect(X + 24, Y + 2, W, 12, 6); ctx.fill();
      ctx.fillStyle = C[colr]; ctx.beginPath(); ctx.roundRect(X + 24, Y + 2, Math.max(2, W * clamp(v, 0, 1)), 12, 6); ctx.fill(); ctx.restore();
    }
    function pic(x, c, size, colr, o = {}) { // 8×8 picture centered at c
      const cs = size / PX, tl = [c[0] - size / 2, c[1] + size / 2];
      g.rect(tl[0] - 0.05, tl[1] - size - 0.05, size + 0.1, size + 0.1, { fill: alpha('panel', 0.95), color: o.ring ?? alpha('muted', 0.35), width: o.ring ? 3 : 1 });
      const M = []; for (let r = 0; r < PX; r++) M.push(x.slice(r * PX, r * PX + PX));
      g.cells(M, tl, cs, { colorFn: (v) => alpha(colr, clamp(v, 0, 1)), gridColor: null, min: 0, max: 1 });
    }

    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt; s.roll += dt;
        for (let i = 0; i < 2; i++) trainStep();
        if (s.beat === 1 && s.roll > 1.1) { s.roll = 0; newEps(); if (s.t > 3.3) { s.t = 0; if (!s.tapped) s.sel = (s.sel + 1) % SHOW.length; s.tapped = false; } }
        if (s.beat === 4 && s.roll > 0.9) { s.roll = 0; addGen(); }
      },
      draw() {
        const l = lay();
        // the latent map: prior rings (gold) and axes
        g.line(Lz([-3.2, 0], l), Lz([3.2, 0], l), { color: alpha('muted', 0.35), width: 1 });
        g.line(Lz([0, -3.2], l), Lz([0, 3.2], l), { color: alpha('muted', 0.35), width: 1 });
        if (s.beat === 3) {
          // decoded pictures tiling the map
          for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) pic(decode([i * 0.85, j * 0.85]), Lz([i * 0.85, j * 0.85], l), 0.8, 'blue', { ring: alpha('muted', 0.2) });
        }
        g.circle([0, 0], l.sc, { color: alpha('gold', 0.7), dash: [5, 5], width: 2 });
        g.circle([0, 0], 2 * l.sc, { color: alpha('gold', 0.45), dash: [5, 5], width: 1.5 });
        // every training picture's center, faint
        if (s.beat !== 3) for (let i = 0; i < data.length; i += 2) g.dot(Lz(encode(data[i]).mu, l), 2.2, { color: alpha('teal', 0.45) });
        // the five followed pictures
        const encs = shows.map(encode);
        shows.forEach((x, i) => {
          const c = l.inP(i), e = encs[i], m = Lz(e.mu, l);
          const on = s.beat === 1 ? i === s.sel : s.beat !== 3 && s.beat !== 4;
          pic(x, c, l.sz, 'teal', { ring: s.beat === 1 && i === s.sel ? 'teal' : undefined });
          if (!on) return;
          g.line(l.P ? [c[0], c[1] - l.sz / 2 - 0.1] : [c[0] + l.sz / 2 + 0.1, c[1]], m, { color: alpha('teal', 0.35), width: 1.5, dash: [3, 4] });
          g.ellipse(m, e.sd[0] * l.sc * 2, e.sd[1] * l.sc * 2, 0, { fill: alpha('purple', 0.15), color: alpha('purple', 0.75), width: 2 });
          g.dot(m, 5, { color: 'blue', ring: 'bg' });
          if (s.beat === 2) {
            const pull = [-e.mu[0] * 0.35 * s.beta, -e.mu[1] * 0.35 * s.beta];
            g.vec(m, [pull[0] * l.sc, pull[1] * l.sc], { color: 'coral', width: 3 });
            pic(decode(e.mu), l.outP(i), l.sz, 'blue');
          }
          if (s.beat === 0) pic(decode(e.mu), l.outP(i), l.sz, 'blue');
        });
        if (s.beat === 0) g.emoji('🗜️', l.P ? [3.3, 3.9] : [-5.6, -3.3], 24);
        if (s.beat === 1) {
          const e = encs[s.sel], m = Lz(e.mu, l), z = [e.mu[0] + e.sd[0] * s.eps[0], e.mu[1] + e.sd[1] * s.eps[1]], zp = Lz(z, l);
          g.arrow(m, zp, { color: 'purple', width: 3 });
          g.dot(zp, 7, { color: 'pink', ring: 'bg' });
          const wob = s.roll < 0.35 ? Math.sin(s.roll * 40) * 0.2 : 0;
          g.emoji('🎲', [zp[0] + 0.45, zp[1] + 0.45 + wob], 22);
          const oc = l.outP(2);
          g.line(zp, oc, { color: alpha('pink', 0.4), width: 1.5, dash: [3, 4] });
          pic(decode(z), oc, l.sz * (l.P ? 1.4 : 1.8), 'blue', { ring: 'pink' });
        }
        if (s.beat === 2) {
          hudMeter('🖼️', s.rec / 45, 0, 'coral');
          hudMeter('🧲', s.kl / 6, 1, 'gold');
        }
        if (s.beat === 3) {
          const zp = Lz(s.probe, l), oc = l.outP(2);
          g.line(zp, oc, { color: alpha('pink', 0.45), width: 1.5, dash: [3, 4] });
          pic(decode(s.probe), oc, l.sz * (l.P ? 1.4 : 1.8), 'blue', { ring: 'pink' });
        }
        if (s.beat === 4) {
          s.gal.forEach((z, i) => {
            const zp = Lz(z, l), oc = l.outP(i);
            g.emoji('✨', zp, i ? 14 : 22);
            if (!i) g.line(zp, oc, { color: alpha('pink', 0.5), width: 1.5, dash: [3, 4] });
            pic(decode(z), oc, l.sz, 'blue', { ring: i ? undefined : 'pink' });
          });
          g.emoji('🎲', [0, 0], 30 + (s.roll < 0.3 ? 8 * Math.sin(s.roll * 30) : 0));
        }
        void C;
      },
    };
  },
};
