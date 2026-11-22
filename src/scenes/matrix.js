// A matrix is a recipe for squishing space: it says where the two little
// arrows î and ĵ go — every other point just follows along.
import { C, alpha } from '../viz/palette.js';
import { det, mvec } from '../core/linalg.js';
import { smoothstep } from '../core/random.js';
import { fmt } from '../viz/ui.js';

// A little house + sun so kids can SEE the squish.
const HOUSE = [[0.2, 0.2], [1.6, 0.2], [1.6, 1.2], [0.9, 1.9], [0.2, 1.2]];
const DOOR = [[0.75, 0.2], [1.05, 0.2], [1.05, 0.75], [0.75, 0.75]];

export default {
  eq: [
    [['A', 'blue'], ' = [ ', ['î', 'red'], '  ', ['ĵ', 'green'], ' ]'],
    [['A', 'blue'], ['x', 'teal'], ' = x₁·', ['î', 'red'], ' + x₂·', ['ĵ', 'green']],
    ['det ', ['A', 'blue'], ' = ', ['area', 'gold'], ' of the squished square'],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-3.2, -2.4, 3.2, 3.2]);
    const s = { i: [1.4, 0.4], j: [-0.5, 1.2], beat: 0, morph: 1, t: 0, probe: [1, 1] };
    const A = () => [[s.i[0], s.j[0]], [s.i[1], s.j[1]]];
    const At = () => {
      // blend identity → A (beat 4 animates this)
      const k = s.morph;
      return [[1 + (s.i[0] - 1) * k, s.j[0] * k], [s.i[1] * k, 1 + (s.j[1] - 1) * k]];
    };
    const snap = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    stage.handle({ pen: g, color: 'red', get: () => s.i, set: (p) => (s.i = snap(p)) });
    stage.handle({ pen: g, color: 'green', get: () => s.j, set: (p) => (s.j = snap(p)) });
    stage.handle({ pen: g, color: 'teal', r: 9, kind: 'ring', visible: () => s.beat === 2, get: () => s.probe, set: (p) => (s.probe = snap(p)) });

    const beats = ui.beats(['➡️', '🟨', '🏠', '🎬'], (b) => { s.beat = b; s.t = 0; s.morph = 1; });
    ui.button({ icon: '🔁', title: 'back to plain', onClick: () => { s.i = [1, 0]; s.j = [0, 1]; } });
    ui.button({ icon: '🔄', title: 'turn', onClick: () => { s.i = [0.7, 0.7]; s.j = [-0.7, 0.7]; } });
    ui.button({ icon: '↔️', title: 'stretch', onClick: () => { s.i = [2, 0]; s.j = [0, 0.6]; } });
    ui.button({ icon: '↗️', title: 'shear', onClick: () => { s.i = [1, 0]; s.j = [1, 1]; } });
    ui.button({ icon: '🪞', title: 'mirror', onClick: () => { s.i = [-1, 0]; s.j = [0, 1]; } });
    ui.button({ icon: '🥞', title: 'flatten', onClick: () => { s.i = [1, 0.5]; s.j = [2, 1]; } });
    ui.readout(() => fmt(det(A()), 2), { icon: '🟨', color: 'gold', title: 'area (determinant)' });
    void beats;

    return {
      update(dt) {
        s.t += dt;
        if (s.beat === 3) s.morph = smoothstep((Math.sin(s.t * 1.2 - Math.PI / 2) + 1) / 2);
      },
      draw() {
        const M = s.beat === 3 ? At() : A();
        const f = (p) => mvec(M, p);
        g.grid({ step: 1 });
        // the squished world
        g.warpedGrid(f, { range: [-6, -6, 6, 6], step: 1, color: alpha('blue', 0.45), width: 1.4, axisColorX: alpha('red', 0.6), axisColorY: alpha('green', 0.6) });
        const d = det(M);
        // unit square → parallelogram (its area IS the determinant)
        if (s.beat >= 1) {
          const sq = [[0, 0], [1, 0], [1, 1], [0, 1]].map(f);
          const colr = Math.abs(d) < 0.03 ? 'coral' : d < 0 ? 'purple' : 'gold';
          g.poly(sq, { fill: alpha(colr, 0.35), color: colr, width: 2 });
          g.rect(0, 0, 1, 1, { color: alpha('gold', 0.5), dash: [4, 4], width: 1.5 });
          const c = f([0.5, 0.5]);
          g.emoji(Math.abs(d) < 0.03 ? '🥞' : d < 0 ? '🪞' : Math.abs(d) > 1.05 ? '🎈' : Math.abs(d) < 0.95 ? '🤏' : '🟨', c, 22);
        }
        if (s.beat >= 2) {
          const house = HOUSE.map(f), door = DOOR.map(f);
          g.poly(HOUSE, { fill: alpha('muted', 0.08), color: alpha('muted', 0.3), dash: [3, 4], width: 1 });
          g.poly(house, { fill: alpha('teal', 0.25), color: 'teal', width: 2.5 });
          g.poly(door, { fill: alpha('orange', 0.6), stroke: false });
          const sun = f([-1.3, 1.9]);
          g.emoji('☀️', sun, 22);
        }
        if (s.beat === 2) {
          // a probe point: its new spot = x₁·î + x₂·ĵ, drawn as the two-step walk
          const p = s.probe, q = f(p);
          const a = [M[0][0] * p[0], M[1][0] * p[0]];
          g.vec([0, 0], a, { color: alpha('red', 0.7), width: 2, dash: [5, 4] });
          g.arrow(a, q, { color: alpha('green', 0.7), width: 2 });
          g.dot(q, 7, { color: 'teal', ring: 'bg' });
          g.line(p, q, { color: alpha('teal', 0.5), dash: [2, 5], width: 1.5 });
        }
        // the two arrows that define everything
        const ii = f([1, 0]), jj = f([0, 1]);
        g.arrow([0, 0], ii, { color: 'red', width: 5 });
        g.arrow([0, 0], jj, { color: 'green', width: 5 });
        g.text('î', [ii[0] + 0.22, ii[1] - 0.18], { color: 'red', size: 22 });
        g.text('ĵ', [jj[0] - 0.2, jj[1] + 0.2], { color: 'green', size: 22 });
        g.dot([0, 0], 5, { color: 'ink' });
        // the matrix itself, as colored columns, in the corner
        drawMatrix(stage.hud, M);
      },
    };
  },
};

export function drawMatrix(hud, M, { x = null, y = 16, colColors = ['red', 'green'] } = {}) {
  const ctx = hud.ctx;
  const cw = 64, ch = 34;
  const W = cw * M[0].length + 24;
  const X = x ?? hud.area.w - W - 14;
  ctx.save();
  ctx.fillStyle = alpha('panel', 0.92);
  ctx.beginPath(); ctx.roundRect(X, y, W, ch * M.length + 16, 12); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  // brackets
  const bx0 = X + 8, bx1 = X + W - 8, by0 = y + 6, by1 = y + ch * M.length + 10;
  ctx.beginPath(); ctx.moveTo(bx0 + 6, by0); ctx.lineTo(bx0, by0); ctx.lineTo(bx0, by1); ctx.lineTo(bx0 + 6, by1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx1 - 6, by0); ctx.lineTo(bx1, by0); ctx.lineTo(bx1, by1); ctx.lineTo(bx1 - 6, by1); ctx.stroke();
  ctx.font = '700 17px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  M.forEach((row, r) => row.forEach((v, c) => {
    ctx.fillStyle = C[colColors[c]] ?? C.ink;
    ctx.fillText(fmt(v, 1), X + 12 + cw * (c + 0.5), y + 8 + ch * (r + 0.5));
  }));
  ctx.restore();
}
