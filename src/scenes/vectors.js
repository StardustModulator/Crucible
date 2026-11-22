// An arrow is a "walk": go this far, in this direction.
// Add arrows = walk one, then the other. Stretch = walk it k times.
// Dot = the shadow one arrow casts on the other. Cross = the area they sweep.
import { C, alpha } from '../viz/palette.js';
import { vadd, vscale, vdot, vnorm, cross2 } from '../core/linalg.js';
import { smoothstep, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

export default {
  eq: [
    [['a', 'blue'], ' + ', ['b', 'orange'], ' = (a₁+b₁, a₂+b₂)', '   ', ['🐜', 'pink']],
    [['k', 'purple'], '·', ['a', 'blue'], ' = (k·a₁, k·a₂)      k < 0 ⇒ flipped'],
    [['a', 'blue'], '·', ['b', 'orange'], ' = a₁b₁ + a₂b₂ = |a||b| cos θ = ', ['shadow', 'lime'], ' · |b|'],
    [['a', 'blue'], ' × ', ['b', 'orange'], ' = a₁b₂ − a₂b₁ = ', ['± area', 'gold'], '   (+ ↺, − ↻)'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-2.2, -1.5, 3.8, 3.3]);
    const s = { a: [2.2, 0.6], b: [0.7, 1.9], k: 2, beat: 0, t: 0 };
    const snap = (p) => [clamp(Math.round(p[0] * 10) / 10, g.view[0] + 0.3, g.view[2] - 0.3), clamp(Math.round(p[1] * 10) / 10, g.view[1] + 0.3, g.view[3] - 0.3)];
    stage.handle({ pen: g, color: 'blue', get: () => s.a, set: (p) => (s.a = snap(p)) });
    stage.handle({ pen: g, color: 'orange', visible: () => s.beat !== 1, get: () => s.b, set: (p) => (s.b = snap(p)) });

    // controls grouped per beat so only the relevant ones show
    const groups = [ui.group(), ui.group(), ui.group(), ui.group()];
    // controls not used in this beat are taken out of the dock (not just hidden)
    const showBeat = (b) => { groups.forEach((el) => el.remove()); ui.dock.appendChild(groups[b]); };
    ui.readout(() => `(${fmt(s.a[0] + s.b[0], 1)}, ${fmt(s.a[1] + s.b[1], 1)})`, { icon: '🐜', color: 'pink', title: 'a + b', into: groups[0] });
    const kSl = ui.slider({ icon: '✖️', color: 'purple', min: -2, max: 2.5, step: 0.1, value: s.k, title: 'stretch k', into: groups[1], onInput: (v) => (s.k = v) });
    ui.button({ icon: '🪞', title: 'flip (k = −1)', into: groups[1], onClick: () => { s.k = -1; kSl.set(-1); } });
    ui.readout(() => fmt(s.k, 1), { icon: '✖️', color: 'purple', title: 'k', into: groups[1] });
    ui.readout(() => fmt(vdot(s.a, s.b), 2), { icon: '🔦', color: 'lime', title: 'a · b', into: groups[2] });
    ui.button({ icon: '📐', title: 'make a right angle', into: groups[2], onClick: () => { const L = vnorm(s.a) || 1, n = [-s.b[1], s.b[0]], nb = vnorm(n) || 1; s.a = snap(vscale(n, L / nb)); } });
    ui.readout(() => fmt(cross2(s.a, s.b), 2), { icon: '🟨', color: 'gold', title: 'a × b (signed area)', into: groups[3] });
    ui.button({ icon: '🔁', title: 'swap a and b', into: groups[3], onClick: () => { const t = s.a; s.a = s.b; s.b = t; } });
    ui.beats(['➕', '✖️', '🔦', '🟨'], (b) => { s.beat = b; s.t = 0; showBeat(b); g.setBounds(b === 1 ? [-3.6, -2.4, 5.4, 3.4] : [-2.2, -1.5, 3.8, 3.3]); });
    showBeat(0);

    const angOf = (v) => Math.atan2(v[1], v[0]);

    function drawSum() {
      hudEq(stage.hud, [['(', 'muted'], [fmt(s.a[0], 1), 'blue'], ['+', 'muted'], [fmt(s.b[0], 1), 'orange'], [',', 'muted'], [fmt(s.a[1], 1), 'blue'], ['+', 'muted'], [fmt(s.b[1], 1), 'orange'], [')', 'muted']]);
      const { a, b } = s, ab = vadd(a, b);
      // the parallelogram: both walking orders land on the same spot
      g.poly([[0, 0], a, ab, b], { fill: alpha('pink', 0.08), stroke: false });
      g.arrow(a, ab, { color: alpha('orange', 0.55), width: 3, dash: [7, 6] });
      g.arrow(b, ab, { color: alpha('blue', 0.55), width: 3, dash: [7, 6] });
      g.arrow([0, 0], ab, { color: 'pink', width: 5 });
      // the ant walks a, then b
      const P = 5, ph = s.t % P;
      const u1 = smoothstep((ph - 0.3) / 1.6), u2 = smoothstep((ph - 2.1) / 1.6);
      const pos = vadd(vscale(a, u1), vscale(b, u2));
      const trail = [];
      for (let i = 0; i <= 24; i++) { const k = i / 24; trail.push(k <= 0.5 ? vscale(a, u1 * k * 2) : vadd(vscale(a, u1), vscale(b, u2 * (k - 0.5) * 2))); }
      g.path(trail, { color: alpha('pink', 0.6), width: 3, dash: [2, 6] });
      if (ph > 3.8) g.emoji('✨', vadd(ab, [0.35, 0.35]), 24);
      const head = ph < 2.0 ? a : b;
      emojiRot(g, '🐜', pos, 28, Math.atan2(head[1], head[0]) - Math.PI);
      g.dot(ab, 6, { color: 'pink', ring: 'bg' });
    }

    function drawScale() {
      const { a } = s, L = vnorm(a) || 1, d = vscale(a, 1 / L);
      // every k·a lives on this one line
      g.line(vscale(d, -12), vscale(d, 12), { color: alpha('purple', 0.35), width: 2, dash: [3, 6] });
      for (let m = -3; m <= 3; m++) if (m) g.dot(vscale(a, m), 4, { color: alpha('purple', 0.55) });
      const ka = vscale(a, s.k);
      // stacked copies of a show "k times"
      const n = Math.floor(Math.abs(s.k));
      const sg = Math.sign(s.k) || 1;
      for (let i = 0; i < n; i++) g.line(vscale(a, i * sg), vscale(a, (i + 1) * sg), { color: alpha('blue', i % 2 ? 0.25 : 0.4), width: 12, cap: 'butt' });
      g.arrow([0, 0], ka, { color: s.k < 0 ? 'purple' : 'blue', width: 6 });
      g.arrow([0, 0], a, { color: alpha('blue', 0.45), width: 3, dash: [6, 5] });
      const tip = vadd(ka, vscale(d, g.world(34) * sg)), V = g.view, m = g.world(30);
      g.text(`×${fmt(s.k, 1)}`, [clamp(tip[0], V[0] + m, V[2] - m), clamp(tip[1], V[1] + m, V[3] - m)], { size: 18, color: 'purple' });
      if (s.k < 0) g.emoji('🪞', vadd(vscale(ka, 0.5), [-d[1] * 0.45, d[0] * 0.45]), 22);
    }

    function drawDot() {
      const { a, b } = s, Lb = vnorm(b) || 1e-9, bh = vscale(b, 1 / Lb);
      const sh = vdot(a, bh), proj = vscale(bh, sh);
      const cos = sh / (vnorm(a) || 1e-9);
      // the floor is b's line
      g.line(vscale(bh, -12), vscale(bh, 12), { color: alpha('orange', 0.35), width: 2 });
      // light falls straight down onto b's line
      g.poly([[0, 0], a, proj], { fill: alpha('gold', 0.2), stroke: false });
      for (let i = 1; i <= 4; i++) { const p = vscale(a, i / 4); g.line(p, vscale(bh, vdot(p, bh)), { color: alpha('gold', 0.55), width: 1.5, dash: [3, 4] }); }
      // right-angle mark at the foot
      const nrm = [-bh[1], bh[0]], side = Math.sign(vdot(a, nrm)) || 1, m = 0.18;
      if (Math.abs(sh) > 0.25 && vnorm(vadd(a, vscale(proj, -1))) > 0.25) {
        const back = vscale(bh, -Math.sign(sh) * m), up = vscale(nrm, side * m);
        g.path([vadd(proj, back), vadd(vadd(proj, back), up), vadd(proj, up)], { color: alpha('ink', 0.6), width: 1.5 });
      }
      const flat = Math.abs(cos) < 0.04;
      const sc = flat ? 'muted' : sh > 0 ? 'lime' : 'coral';
      g.line([0, 0], proj, { color: alpha(sc, 0.9), width: 11, cap: 'butt' });
      g.arrow([0, 0], b, { color: 'orange', width: 5 });
      g.arrow([0, 0], a, { color: 'blue', width: 5 });
      // flashlight sits above a's tip, shining down at b's line
      const lamp = vadd(a, vscale(nrm, side * g.world(46)));
      emojiRot(g, '🔦', lamp, 30, Math.atan2(-nrm[1] * side, -nrm[0] * side) - (3 * Math.PI) / 4);
      // angle between them
      const a0 = angOf(b), a1 = angOf(a);
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      g.wedge([0, 0], 0.55, a0, a0 + da, { color: flat ? 'gold' : 'orange', alpha: 0.3 });
      const mid = a0 + da / 2;
      g.text('θ', [Math.cos(mid) * 0.8, Math.sin(mid) * 0.8], { size: 16, color: 'orange' });
      const val = vdot(a, b);
      const lbl = vadd(vscale(proj, 0.5), vscale(nrm, -side * 0.32));
      g.text(flat ? '0' : fmt(sh, 1), lbl, { size: 18, color: sc, weight: 800 });
      hudEq(stage.hud, [[fmt(sh, 1), sc], ['×', 'muted'], [fmt(Lb, 1), 'orange'], ['=', 'muted'], [fmt(val, 1), sc]]);
      if (flat) g.text('⊥', [Math.cos(mid) * 1.1, Math.sin(mid) * 1.1], { size: 24, color: 'gold' });
    }

    function drawCross() {
      const { a, b } = s, ab = vadd(a, b), cr = cross2(a, b);
      const c = Math.abs(cr) < 0.05 ? 'coral' : cr > 0 ? 'gold' : 'purple';
      g.poly([[0, 0], a, ab, b], { fill: alpha(c, 0.32), color: c, width: 2 });
      g.arrow([0, 0], a, { color: 'blue', width: 5 });
      g.arrow([0, 0], b, { color: 'orange', width: 5 });
      // turning arrow from a toward b
      const a0 = angOf(a);
      let da = angOf(b) - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const r = 0.75;
      g.arc([0, 0], r, a0, a0 + da * 0.85, { color: c, width: 3 });
      const e = a0 + da * 0.85, e2 = a0 + da;
      g.arrow([Math.cos(e) * r, Math.sin(e) * r], [Math.cos(e2) * r, Math.sin(e2) * r], { color: c, width: 3, head: 10 });
      const ctr = vscale(ab, 0.5);
      g.emoji(Math.abs(cr) < 0.05 ? '🥞' : cr > 0 ? '↺' : '↻', vadd(ctr, [0, 0.28]), 26, { color: c, weight: 800 });
      g.text(fmt(cr, 1), vadd(ctr, [0, -0.22]), { size: 20, color: c, weight: 800 });
      hudEq(stage.hud, [[fmt(a[0], 1), 'blue'], ['·', 'muted'], [fmt(b[1], 1), 'orange'], ['−', 'muted'], [fmt(a[1], 1), 'blue'], ['·', 'muted'], [fmt(b[0], 1), 'orange'], ['=', 'muted'], [fmt(cr, 1), c]]);
    }

    return {
      update(dt) { s.t += dt; },
      draw() {
        g.grid({ step: 1 });
        if (s.beat === 0) {
          drawSum();
          g.arrow([0, 0], s.a, { color: 'blue', width: 5 });
          g.arrow([0, 0], s.b, { color: 'orange', width: 5 });
        } else if (s.beat === 1) drawScale();
        else if (s.beat === 2) drawDot();
        else drawCross();
        // names next to the tips
        const lab = (v, str, c) => { const L = vnorm(v) || 1; g.text(str, vadd(v, vscale(v, g.world(28) / L)), { size: 22, color: c, weight: 800 }); };
        lab(s.a, 'a', 'blue');
        if (s.beat !== 1) lab(s.b, 'b', 'orange');
        g.dot([0, 0], 5, { color: 'ink' });
        void C;
      },
    };
  },
};

// Emoji drawn turned so its "nose" points along a world angle (y up).
export function emojiRot(pen, ch, p, size, ang) {
  const ctx = pen.ctx, [x, y] = pen.toScreen(p);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-ang);
  ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}

// A little row of colored numbers/symbols in the top-right corner (no words).
export function hudEq(hud, parts, { y = 14, size = 20 } = {}) {
  const ctx = hud.ctx;
  ctx.save();
  ctx.font = `800 ${size}px ui-rounded, system-ui, sans-serif`;
  const gap = 6, ws = parts.map(([t]) => ctx.measureText(t).width);
  const W = ws.reduce((a, b) => a + b, 0) + gap * (parts.length - 1) + 24;
  const X = hud.area.w - W - 12;
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(X, y, W, size + 18, 12); ctx.fill();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let x = X + 12;
  parts.forEach(([t, c], i) => { ctx.fillStyle = C[c] ?? c; ctx.fillText(t, x, y + (size + 18) / 2); x += ws[i] + gap; });
  ctx.restore();
}
