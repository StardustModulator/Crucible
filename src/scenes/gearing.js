// Motors & gears: a small fast motor + a big slow gear = a strong arm.
// Speed ÷ N, torque × N, and the arm feels N² times lighter to the motor.
import { C, alpha } from '../viz/palette.js';
import { clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';

const Z1 = 10, MOD = 0.075;          // pinion teeth, gear module (world units)
const TS = 1.0, W0 = 14;            // motor stall torque, free speed (rad/s)
const IM = 0.05;                    // motor rotor inertia
const ARM = 1.55, IARM0 = 0.25;     // output arm length, its own inertia
const GRAV = 1.0, BDAMP = 0.05;
const GC = [0.7, 0.1];              // big gear centre (fixed)

export default {
  eq: [
    ['N = ', ['z₂', 'pink'], ' / ', ['z₁', 'orange'], '   (teeth)'],
    [['ω_out', 'pink'], ' = ', ['ω_m', 'orange'], ' / N        ', ['τ_out', 'pink'], ' = N ', ['τ_m', 'orange'], '        (power ', ['τω', 'gold'], ' is kept)'],
    [['I', 'orange'], '_felt = ', ['I_m', 'orange'], ' + ', ['I_arm', 'pink'], ' / N²'],
    [['τ_m', 'orange'], ' = τ_stall (1 − ', ['ω_m', 'orange'], ' / ω_free)     load: ', ['τ_out', 'pink'], ' = m g L cos θ'],
    ['(', ['I_arm', 'pink'], ' + N²', ['I_m', 'orange'], ') θ̈ = N ', ['τ_m', 'orange'], ' − m g L cos θ'],
  ],
  setup({ stage, ui }) {
    const [g, h] = stage.split([[-3.0, -2.05, 2.5, 2.25], [0, 0, 1, 1]], [1.6, 1]);
    const s = { N: 3, m: 1.2, beat: 0, th: -Math.PI / 2, w: 0, on: true, turnsM: 0, turnsO: 0, th0: -Math.PI / 2, strain: 0 };
    const z2 = () => Math.round(Z1 * s.N);
    const Nn = () => z2() / Z1;
    const rp = () => (MOD * Z1) / 2, rg = () => (MOD * z2()) / 2;
    const PC = () => [GC[0] - rp() - rg(), GC[1]];
    const Iarm = () => s.m * ARM * ARM + IARM0;
    const motorTau = (wm) => (s.on ? clamp(TS * (1 - wm / W0), -0.2, 1.6 * TS) : 0);

    ui.beats(['⚙️', '🏋️', '🪶', '🔌'], (b) => { s.beat = b; });
    ui.slider({ icon: '⚙️', color: 'pink', min: 1, max: 5, step: 0.1, value: s.N, title: 'gear ratio N', onInput: (v) => (s.N = v) });
    ui.slider({ icon: '🪨', color: 'coral', min: 0.3, max: 2.5, step: 0.05, value: s.m, title: 'weight', onInput: (v) => (s.m = v) });
    ui.readout(() => `×${fmt(Nn(), 1)}`, { icon: '⚙️', color: 'pink', title: 'gear ratio' });

    return {
      update(dt) {
        const n = 6, hh = dt / n, N = Nn();
        for (let k = 0; k < n; k++) {
          const wm = N * s.w;
          const tau = N * motorTau(wm) - s.m * GRAV * ARM * Math.cos(s.th) - BDAMP * s.w;
          const I = Iarm() + N * N * IM;
          s.w += (hh * tau) / I;
          s.th += hh * s.w;
          s.turnsM += (N * s.w * hh) / (2 * Math.PI);
          s.turnsO += (s.w * hh) / (2 * Math.PI);
        }
        // stuck = the motor pushes with everything it has and nothing moves
        s.strain = Math.abs(s.w) < 0.08 ? Math.min(1, s.strain + dt * 2) : Math.max(0, s.strain - dt * 2);
        if (s.turnsO > 9.95) { s.turnsO -= 10; s.turnsM -= 10 * N; }
      },
      draw() {
        const N = Nn(), P = PC();
        g.grid({ step: 0.5 });
        // motor housing + spinning rotor (its inertia disk)
        const phiP = Math.PI / Z1 - N * (s.th - Math.PI);
        g.rrect(P[0] - 0.95, P[1] - 0.95, 1.9, 1.9, 18, { fill: alpha('slate', 0.5), stroke: false });
        if (s.strain > 0.1) g.circle(P, 1.05, { fill: alpha('coral', 0.22 * s.strain), stroke: false });
        disk(g, P, 0.82, phiP, 'orange');
        g.emoji('⚡', [P[0] - 0.7, P[1] + 1.2], 24);
        // the two gears
        gear(g, GC, z2(), s.th, 'pink');
        gear(g, P, Z1, phiP, 'orange');
        // output arm + weight
        const tip = [GC[0] + ARM * Math.cos(s.th), GC[1] + ARM * Math.sin(s.th)];
        g.arm([GC, tip], { width: 16, colors: ['slate'], base: false, hand: false, jointColor: 'pink' });
        const wr = 0.13 + 0.09 * Math.sqrt(s.m);
        const wc = [tip[0], tip[1] - 0.3 - wr];
        g.line(tip, [wc[0], wc[1] + wr * 0.6], { color: 'ink', width: 2 });
        g.circle(wc, wr, { fill: 'slate', color: 'slate' });
        g.arc([wc[0], wc[1] + wr * 0.85], wr * 0.45, 0.2, Math.PI - 0.2, { color: 'slate', width: 4 });
        g.dot(GC, 7, { color: 'pink', ring: 'bg' });
        g.dot(P, 6, { color: 'orange', ring: 'bg' });
        if (s.strain > 0.5) g.emoji('🥵', [P[0] + 0.1, P[1] + 1.2], 26);

        const wm = Math.abs(N * s.w), tm = motorTau(N * s.w);
        if (s.beat === 0) dials(h, s, N);
        if (s.beat === 1) bars(h, wm, Math.abs(s.w), tm, N * tm, N);
        if (s.beat === 2) inertia(h, IM, Iarm(), N);
        if (s.beat === 3) curve(h, N * s.w, tm, s.m * GRAV * ARM * Math.cos(s.th) / N, true);
      },
    };
  },
};

// A toothed gear drawn as one polygon.
function gear(g, c, z, ang, color) {
  const r = (MOD * z) / 2, ro = r + MOD * 0.9, ri = r - MOD * 1.1;
  const pts = [];
  for (let k = 0; k < z; k++) {
    const a = ang + (2 * Math.PI * k) / z, w = (2 * Math.PI) / z;
    pts.push([ri, a - w * 0.5], [ri, a - w * 0.28], [ro, a - w * 0.16], [ro, a + w * 0.16], [ri, a + w * 0.28]);
  }
  const P = pts.map(([rr, a]) => [c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
  g.poly(P, { fill: alpha(color, 0.28), color, width: 2 });
  g.circle(c, ri * 0.55, { color: alpha(color, 0.6), width: 2 });
  for (let k = 0; k < 3; k++) {
    const a = ang + (2 * Math.PI * k) / 3;
    g.line([c[0] + 0.1 * Math.cos(a), c[1] + 0.1 * Math.sin(a)], [c[0] + ri * 0.9 * Math.cos(a), c[1] + ri * 0.9 * Math.sin(a)], { color: alpha(color, 0.6), width: 3 });
  }
}

// a spinning disk with a stripe so you can see it turn
function disk(g, c, r, a, color) {
  g.circle(c, r, { fill: alpha(color, 0.18), color: alpha(color, 0.8), width: 2.5, stroke: true });
  g.wedge(c, r, a, a + 0.5, { color, alpha: 0.5 });
  g.wedge(c, r, a + Math.PI, a + Math.PI + 0.5, { color, alpha: 0.5 });
}

const px = (ctx, font, color) => { ctx.font = font; ctx.fillStyle = col(color); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; };
const col = (c) => (c in C ? C[c] : c);
function panel(h) {
  const A = h.area, ctx = h.ctx;
  ctx.fillStyle = alpha('panel', 0.55); ctx.fillRect(A.x, A.y, A.w, A.h);
  return { A, ctx, cx: A.x + A.w / 2, cy: A.y + A.h / 2 };
}

// beat 1: the motor turns N times for every 1 turn of the arm
function dials(h, s, N) {
  const { A, ctx, cx, cy } = panel(h);
  const tall = A.h > A.w * 0.8;
  const R = tall ? Math.min(A.w * 0.3, A.h * 0.16) : Math.min(A.w * 0.14, A.h * 0.3);
  const pos = tall ? [[cx, cy - A.h * 0.24], [cx, cy + A.h * 0.2]] : [[cx - A.w * 0.25, cy - 10], [cx + A.w * 0.25, cy - 10]];
  const items = [[N * (s.th - s.th0), 'orange', s.turnsM], [s.th - s.th0, 'pink', s.turnsO]];
  ctx.save();
  items.forEach(([ang, c, turns], i) => {
    const [x, y] = pos[i];
    ctx.fillStyle = alpha(c, 0.12); ctx.strokeStyle = col(c); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + R * 0.85 * Math.cos(-ang - Math.PI / 2), y + R * 0.85 * Math.sin(-ang - Math.PI / 2)); ctx.stroke();
    ctx.fillStyle = col(c); ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    px(ctx, '700 20px ui-rounded, system-ui, sans-serif', c);
    ctx.fillText(`🔄${fmt(Math.abs(turns), 1)}`, x, y + R * 0.5);
  });
  px(ctx, '800 24px ui-rounded, system-ui, sans-serif', 'ink');
  ctx.fillText(tall ? `⬇ ÷${fmt(N, 1)}` : `➡ ÷${fmt(N, 1)}`, cx, tall ? (pos[0][1] + pos[1][1]) / 2 : cy - 10);
  ctx.restore();
}

// beat 2: speed bars shrink by N, torque bars grow by N
function bars(h, wm, wo, tm, to, N) {
  const { A, ctx, cx, cy } = panel(h);
  const groups = [['🏃', wm, wo, W0, `÷${fmt(N, 1)}`], ['💪', tm, to, 5 * TS, `×${fmt(N, 1)}`]];
  const gw = Math.min(A.w * 0.42, 170), bh = A.h * 0.62, base = cy + bh / 2;
  ctx.save();
  groups.forEach(([icon, a, b, max, op], k) => {
    const x0 = cx + (k - 0.5) * gw * 1.15 - gw / 2;
    const bw = gw * 0.3;
    [[a, 'orange'], [b, 'pink']].forEach(([v, c], j) => {
      const hh = clamp(v / max, 0, 1) * bh;
      const x = x0 + gw * 0.12 + j * gw * 0.46;
      ctx.fillStyle = alpha(c, 0.15); ctx.beginPath(); ctx.roundRect(x, base - bh, bw, bh, 6); ctx.fill();
      ctx.fillStyle = col(c); ctx.beginPath(); ctx.roundRect(x, base - Math.max(hh, 2), bw, Math.max(hh, 2), 6); ctx.fill();
      px(ctx, '700 13px ui-rounded, system-ui, sans-serif', c);
      ctx.fillText(fmt(v, 1), x + bw / 2, base + 12);
    });
    px(ctx, '24px system-ui, "Apple Color Emoji", sans-serif', 'ink');
    ctx.fillText(icon, x0 + gw / 2, base - bh - 20);
    px(ctx, '800 15px ui-rounded, system-ui, sans-serif', 'ink');
    ctx.fillText(op, x0 + gw / 2, base + 32);
  });
  ctx.restore();
}

// beat 3: disks with area ∝ inertia. The arm, as the motor feels it, shrinks by N².
function inertia(h, im, ia, N) {
  const { A, ctx, cx, cy } = panel(h);
  const wide = A.w > A.h * 0.9;
  const k = (wide ? Math.min(0.2 * A.w, 0.4 * A.h) : Math.min(0.4 * A.w, 0.2 * A.h)) / 2.6;
  const rr = (I) => k * Math.sqrt(I);
  ctx.save();
  // left/top: the real arm. right/bottom: the motor + what it feels
  const p1 = wide ? [cx - A.w * 0.25, cy] : [cx, cy - A.h * 0.25];
  const p2 = wide ? [cx + A.w * 0.25, cy] : [cx, cy + A.h * 0.25];
  const circ = (p, r, c, dash) => {
    ctx.setLineDash(dash ? [6, 5] : []); ctx.fillStyle = alpha(c, dash ? 0.25 : 0.35); ctx.strokeStyle = col(c); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(r, 2), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  };
  circ(p1, rr(ia), 'pink', false);
  px(ctx, '22px system-ui, "Apple Color Emoji", sans-serif', 'ink'); ctx.fillText('🏋️', p1[0], p1[1]);
  // motor rotor + felt arm, stacked as rings (total felt inertia)
  const felt = ia / (N * N);
  circ(p2, rr(im + felt), 'pink', true);
  circ(p2, rr(im), 'orange', false);
  px(ctx, '22px system-ui, "Apple Color Emoji", sans-serif', 'ink');
  ctx.fillText(felt < im ? '🪶' : '🏋️', p2[0], p2[1] - rr(im + felt) - 18);
  px(ctx, '800 16px ui-rounded, system-ui, sans-serif', 'ink');
  ctx.fillText(`${wide ? '➡' : '⬇'} ÷${fmt(N * N, 1)}`, (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
  px(ctx, '700 13px ui-rounded, system-ui, sans-serif', 'pink');
  ctx.fillText(fmt(ia, 2), p1[0], p1[1] + rr(ia) + 14);
  ctx.fillText(fmt(felt, 2), p2[0], p2[1] + rr(im + felt) + 14);
  ctx.restore();
}

// beat 4: the motor's torque–speed line and where it is working right now
function curve(h, wm, tm, need, on) {
  const { A, ctx } = panel(h);
  const x0 = A.x + 44, x1 = A.x + A.w - 18, y0 = A.y + A.h - 40, y1 = A.y + 26;
  const X = (w) => x0 + (clamp(w, -2, W0 * 1.05) / (W0 * 1.05)) * (x1 - x0);
  const Y = (t) => y0 - (clamp(t, -0.2, 1.6) / 1.2) * (y0 - y1);
  ctx.save();
  ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0, y1 - 6); ctx.lineTo(x0, y0); ctx.lineTo(x1 + 6, y0); ctx.stroke();
  // power hump
  ctx.strokeStyle = alpha('gold', 0.5); ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let k = 0; k <= 60; k++) { const w = (W0 * k) / 60, p = (TS * (1 - w / W0) * w) / (TS * W0 / 4); const xx = X(w), yy = Y(p * 1.0); k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
  ctx.stroke(); ctx.setLineDash([]);
  // the motor line
  ctx.strokeStyle = C.orange; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(X(0), Y(TS)); ctx.lineTo(X(W0), Y(0)); ctx.stroke();
  // what the load asks the motor for
  ctx.strokeStyle = C.pink; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(x0, Y(need)); ctx.lineTo(x1, Y(need)); ctx.stroke(); ctx.setLineDash([]);
  // operating point
  if (on) {
    ctx.fillStyle = C.gold; ctx.strokeStyle = C.bg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(wm), Y(tm), 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  px(ctx, '20px system-ui, "Apple Color Emoji", sans-serif', 'ink');
  ctx.fillText('💪', x0 - 22, y1 + 6);
  ctx.fillText('🏃', x1 - 6, y0 + 22);
  ctx.fillText('🔌', X(W0 * 0.55), Y(TS * 0.45) - 24);
  ctx.fillText('🏋️', x1 - 14, Y(need) - 16);
  ctx.restore();
}
