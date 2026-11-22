// Bayes: what you believed × what you just saw = what you believe now.
// Look for a lost teddy — every empty search shrinks that spot's bar and grows
// the others. Then the same rule with smooth bumps, and the famous test puzzle.
import { C, alpha } from '../viz/palette.js';
import { gauss1, fuse1 } from '../core/estimation.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const SPOTS = ['🛏️', '📦', '🪴', '🧺', '🚪', '🛋️'];
const PRIOR0 = [0.1, 0.24, 0.08, 0.3, 0.1, 0.18];
const DETECT = 0.8;
let BAR_H = 4.2; // world height of probability 1 (taller on phones)
const SPOT_Y = -1.6;

export default {
  eq: [
    [['P(spot | 🙈)', 'blue'], ' = ', ['P(🙈 | spot)', 'teal'], ' · ', ['P(spot)', 'purple'], ' / Σ'],
    [['posterior', 'blue'], ' ∝ ', ['likelihood', 'teal'], ' × ', ['prior', 'purple']],
    ['Gaussians:  ', ['1/σ²', 'blue'], ' = ', ['1/σ_p²', 'purple'], ' + ', ['1/σ_z²', 'teal'], '      ', ['μ', 'blue'], ' = ', ['μ_p', 'purple'], ' + k(', ['z', 'teal'], ' − ', ['μ_p', 'purple'], ')'],
    [['P(🤒 | ➕)', 'blue'], ' = ', ['P(➕|🤒)', 'teal'], ['P(🤒)', 'purple'], ' / ( ', ['P(➕|🤒)', 'teal'], ['P(🤒)', 'purple'], ' + ', ['P(➕|🙂)', 'coral'], ['P(🙂)', 'purple'], ' )'],
  ],
  setup({ stage, ui }) {
    const g = stage.g;
    const R = rng(21);
    const s = {
      beat: 0, p: PRIOR0.slice(), shown: PRIOR0.slice(), teddy: 0, found: false, flash: null, misses: new Array(6).fill(0),
      mp: -1.5, sp: 1.3, z: 1.2, sz: 0.8,
      prev: 0.05, fpr: 0.1, sens: 0.9, t: 0,
    };
    const spotX = (i) => -5 + 2 * i;
    const hide = () => {
      let u = R(), i = 0; while (i < 5 && u > s.p[i]) { u -= s.p[i]; i++; }
      s.teddy = i; s.found = false; s.misses.fill(0);
    };
    const resetTeddy = () => { s.p = PRIOR0.slice(); hide(); };
    const search = (i) => {
      if (s.found) return;
      s.flash = { i, t: 0 };
      if (i === s.teddy && R() < DETECT) { s.found = true; return; }
      // Bayes: P(empty search | here) = 1 − d, P(empty | elsewhere) = 1
      const lik = s.p.map((_, j) => (j === i ? 1 - DETECT : 1));
      const un = s.p.map((p, j) => p * lik[j]), Z = un.reduce((a, b) => a + b, 0);
      s.p = un.map((u) => u / Z);
      s.misses[i]++;
    };
    resetTeddy();

    const bounds = () => (s.beat === 0 ? (stage.portrait ? [-6.2, -2.6, 6.2, 6.4] : [-6.2, -2.4, 6.2, 3.6]) : s.beat === 1 ? [-5.5, -0.6, 5.5, 4.0] : (stage.portrait ? [-3, -5.9, 3, 5.6] : [-6.2, -3.2, 6.2, 3.3]));
    const fit = () => { const b = bounds(); if (!s.b || s.b.join() !== b.join()) { s.b = b; g.setBounds(b); } };

    // beat 0: drag bar tops to set the prior (others rescale)
    SPOTS.forEach((_, i) => stage.handle({
      pen: g, color: 'purple', r: 8, kind: 'square', visible: () => s.beat === 0 && !s.found && s.misses.every((m) => m === 0),
      get: () => [spotX(i), SPOT_Y + 0.55 + s.shown[i] * BAR_H],
      set: (p) => {
        const v = clamp((p[1] - SPOT_Y - 0.55) / BAR_H, 0.01, 0.9), rest = 1 - s.p[i];
        s.p = s.p.map((q, j) => (j === i ? v : (q / rest) * (1 - v)));
      },
      onEnd: () => hide(),
    }));
    // beat 1: prior / likelihood peaks — sideways = where, up = how sure
    const peakY = (sd) => gauss1(0, 0, sd) * 2.2;
    stage.handle({ pen: g, color: 'purple', r: 10, visible: () => s.beat === 1, get: () => [s.mp, peakY(s.sp)], set: (p) => { s.mp = clamp(p[0], -4.5, 4.5); s.sp = clamp(2.2 / (Math.sqrt(2 * Math.PI) * clamp(p[1], 0.25, 2.4)), 0.35, 3.5); } });
    stage.handle({ pen: g, color: 'teal', r: 10, visible: () => s.beat === 1, get: () => [s.z, peakY(s.sz)], set: (p) => { s.z = clamp(p[0], -4.5, 4.5); s.sz = clamp(2.2 / (Math.sqrt(2 * Math.PI) * clamp(p[1], 0.25, 2.4)), 0.35, 3.5); } });

    const offDown = stage.on('down', (e) => {
      if (s.beat !== 0 || e.pen !== g) return;
      const i = Math.round((e.p[0] + 5) / 2);
      if (i >= 0 && i < 6 && Math.abs(e.p[0] - spotX(i)) < 0.9) search(i);
    });

    const groups = [ui.group(), ui.group(), ui.group()];
    ui.button({ into: groups[0], icon: '🔁', title: 'hide again', onClick: resetTeddy });
    ui.button({ into: groups[1], icon: '🎯', title: 'sharp sensor', onClick: () => { s.sz = 0.45; } });
    ui.button({ into: groups[1], icon: '🌫️', title: 'blurry sensor', onClick: () => { s.sz = 2.4; } });
    ui.slider({ into: groups[2], icon: '🤒', color: 'purple', min: 0.01, max: 0.5, step: 0.01, value: s.prev, title: 'how many are sick', onInput: (v) => (s.prev = v) });
    ui.slider({ into: groups[2], icon: '🚨', color: 'coral', min: 0, max: 0.3, step: 0.01, value: s.fpr, title: 'false alarms', onInput: (v) => (s.fpr = v) });
    ui.readout(() => {
      if (s.beat === 0) return Math.round(s.p[s.teddy] * 100) + '%';
      if (s.beat === 1) { const f = fuse1(s.mp, s.sp ** 2, s.z, s.sz ** 2); return 'σ ' + fmt(Math.sqrt(f.var), 2); }
      return Math.round(postSick() * 100) + '%';
    }, { icon: '🔵', color: 'blue', title: 'belief' });
    const showGroups = () => groups.forEach((gr, i) => (gr.style.display = i === s.beat ? '' : 'none'));
    ui.beats(['🧸', '🔔', '🧪'], (b) => { s.beat = b; showGroups(); fit(); });
    showGroups(); fit();

    function postSick() { const a = s.sens * s.prev, b = s.fpr * (1 - s.prev); return a / (a + b || 1); }

    return {
      update(dt) {
        s.t += dt;
        s.shown = s.shown.map((v, i) => v + (s.p[i] - v) * Math.min(1, dt * 6));
        if (s.flash) { s.flash.t += dt; if (s.flash.t > 0.8) s.flash = null; }
      },
      draw() {
        fit();
        BAR_H = stage.portrait ? 8 : 4.2;
        if (s.beat === 0) drawTeddy(); else if (s.beat === 1) drawCurves(); else drawTest();
      },
      dispose() { offDown(); },
    };

    // ---------------------------------------------------------------- 🧸
    function drawTeddy() {
      g.grid({ step: 1, axes: false });
      g.line([-6, SPOT_Y + 0.55], [6, SPOT_Y + 0.55], { color: alpha('muted', 0.5), width: 1.5 });
      const best = s.p.indexOf(Math.max(...s.p));
      SPOTS.forEach((em, i) => {
        const x = spotX(i), h = s.shown[i] * BAR_H;
        g.rrect(x - 0.55, SPOT_Y + 0.55, 1.1, BAR_H * 0.62, 8, { fill: alpha('purple', 0.06), stroke: false });
        g.bar(x - 0.45, SPOT_Y + 0.55, 0.9, h, { color: alpha('purple', 0.85) });
        g.text(Math.round(s.shown[i] * 100) + '%', [x, SPOT_Y + 0.85 + h], { color: 'purple', size: stage.portrait ? 10 : 14, weight: 800 });
        const fl = s.flash && s.flash.i === i ? 1 - s.flash.t / 0.8 : 0;
        if (fl > 0) g.circle([x, SPOT_Y], 0.75 + (1 - fl) * 0.4, { fill: alpha('gold', 0.45 * fl), stroke: false });
        g.emoji(em, [x, SPOT_Y], stage.portrait ? 26 : 40);
        for (let m = 0; m < Math.min(s.misses[i], 5); m++) g.emoji('❌', [x - 0.4 + m * 0.2, SPOT_Y - 0.62], 11);
        if (s.found && i === s.teddy) { g.emoji('🧸', [x + 0.35, SPOT_Y + 0.25], 34); g.emoji('🎉', [x, SPOT_Y + 1.0 + h], 30); }
      });
      if (!s.found) g.emoji('👉', [spotX(best) - 0.9, SPOT_Y + 0.15], 22);
      const ty = g.view[3] - 0.6;
      g.emoji('🔦', [-5.7, ty], 26);
      g.emoji('🧸', [-4.95, ty], 26);
      g.text('?', [-4.45, ty + 0.05], { color: 'purple', size: 26, weight: 800 });
    }

    // ---------------------------------------------------------------- 🔔
    function drawCurves() {
      g.grid({ step: 1, axes: false });
      const K = 2.2;
      const f = fuse1(s.mp, s.sp ** 2, s.z, s.sz ** 2), sd = Math.sqrt(f.var);
      const prior = (x) => gauss1(x, s.mp, s.sp) * K, lik = (x) => gauss1(x, s.z, s.sz) * K, post = (x) => gauss1(x, f.mu, sd) * K;
      g.line([-5.5, 0], [5.5, 0], { color: 'slate', width: 2 });
      g.plot(prior, { color: 'purple', width: 3, fillTo: 0, fillAlpha: 0.12 });
      g.plot(lik, { color: 'teal', width: 3, fillTo: 0, fillAlpha: 0.12 });
      // the raw product (before rescaling to area 1): small, but the same shape
      const prod = (x) => prior(x) * lik(x) / K;
      g.plot(prod, { color: alpha('blue', 0.6), width: 2, dash: [4, 4] });
      g.plot(post, { color: 'blue', width: 4.5, fillTo: 0, fillAlpha: 0.22 });
      // arrows: posterior mean sits between, closer to the sharper one
      g.line([s.mp, -0.25], [s.z, -0.25], { color: alpha('muted', 0.6), width: 2 });
      g.dot([s.mp, -0.25], 5, { color: 'purple' }); g.dot([s.z, -0.25], 5, { color: 'teal' });
      g.dot([f.mu, -0.25], 7, { color: 'blue', ring: 'bg' });
      g.emoji('📡', [s.z, peakY(s.sz) + 0.4], 20);
      g.emoji('💭', [s.mp, peakY(s.sp) + 0.4], 20);
      hudRow([['▬', 'purple'], ['×', 'muted'], ['▬', 'teal'], ['=', 'muted'], ['▬', 'blue']]);
    }
    function hudRow(toks) {
      const ctx = stage.hud.ctx, A = g.area;
      ctx.save(); ctx.font = '800 22px ui-rounded, system-ui, sans-serif'; ctx.textBaseline = 'middle';
      const ws = toks.map(([t]) => ctx.measureText(t).width + 12), W = ws.reduce((a, b) => a + b, 0) + 18;
      ctx.fillStyle = alpha('panel', 0.92); ctx.beginPath(); ctx.roundRect(A.x + 12, A.y + 12, W, 38, 10); ctx.fill();
      let x = A.x + 26; toks.forEach(([t, c], i) => { ctx.fillStyle = C[c]; ctx.fillText(t, x, A.y + 31); x += ws[i]; });
      ctx.restore();
    }

    // ---------------------------------------------------------------- 🧪
    function drawTest() {
      g.grid({ step: 1, axes: false });
      const sick = Math.round(100 * s.prev), tp = Math.round(sick * s.sens), fp = Math.round((100 - sick) * s.fpr);
      // which dots: sick ones scattered (seeded), positives chosen deterministically
      const order = s.order ?? (s.order = rng(4).shuffle(Array.from({ length: 100 }, (_, i) => i)));
      const kind = new Array(100);
      for (let r = 0; r < 100; r++) {
        const id = order[r];
        const isSick = r < sick, pos = isSick ? r < tp : r - sick < fp;
        kind[id] = { isSick, pos };
      }
      const P = stage.portrait;
      const cell = P ? 0.5 : 0.5, gx0 = P ? -2.25 : -5.6, gy0 = P ? 5.2 : 2.5;
      const at = (id) => [gx0 + (id % 10) * cell, gy0 - Math.floor(id / 10) * cell];
      g.rrect(gx0 - 0.35, gy0 - 9 * cell - 0.35, 9 * cell + 0.7, 9 * cell + 0.7, 10, { fill: alpha('panel', 0.6), color: alpha('muted', 0.3), width: 1.5 });
      for (let id = 0; id < 100; id++) {
        const k = kind[id], p = at(id);
        g.dot(p, 7.5, { color: k.isSick ? 'coral' : alpha('slate', 0.55) });
        if (k.pos) g.dot(p, 10.5, { color: 'rgba(0,0,0,0)', ring: 'teal', ringWidth: 3 });
      }
      // the positives, pulled out into their own box
      const bx0 = P ? -2.25 : 1.0, by0 = P ? -0.6 : 2.5;
      const posIds = []; for (let id = 0; id < 100; id++) if (kind[id].pos) posIds.push(id);
      posIds.sort((a, b) => Number(kind[b].isSick) - Number(kind[a].isSick));
      const pc = 0.62, cols = 7;
      g.arrow(P ? [0, -0.05 + 0.0] : [-0.3, 0.3], P ? [0, -0.35] : [0.5, 0.3], { color: 'teal', width: 3 });
      posIds.forEach((id, j) => {
        const p = [bx0 + (j % cols) * pc, by0 - Math.floor(j / cols) * pc];
        g.dot(p, 13, { color: kind[id].isSick ? 'coral' : alpha('slate', 0.45), ring: 'teal', ringWidth: 2.5 });
        g.emoji(kind[id].isSick ? '🤒' : '🙂', p, 17);
      });
      // belief bar: of all ➕, how many are really sick?
      const by = P ? -4.6 : -2.6, bw = P ? 4.6 : 4.6, bx = P ? -2.3 : 1.0;
      const frac = postSick();
      g.rrect(bx, by, bw, 0.45, 8, { fill: alpha('slate', 0.25), stroke: false });
      g.rrect(bx, by, Math.max(0.02, bw * frac), 0.45, 8, { fill: 'blue', stroke: false });
      g.text(Math.round(frac * 100) + '%', [bx + bw + 0.55, by + 0.22], { color: 'blue', size: 18, weight: 800 });
      g.emoji('➕', [bx - 0.4, by + 0.22], 18);
      g.dot([bx + 0.15, by + 0.95], 8, { color: 'coral' });
      g.text(`${tp}`, [bx + 0.45, by + 0.95], { color: 'coral', size: 17, weight: 800, align: 'left' });
      g.dot([bx + 1.45, by + 0.95], 8, { color: alpha('slate', 0.55) });
      g.text(`${fp}`, [bx + 1.75, by + 0.95], { color: 'slate', size: 17, weight: 800, align: 'left' });
    }
  },
};
