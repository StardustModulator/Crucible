// Pinhole camera: light from every point squeezes through one tiny hole and lands
// on the back wall — upside down! Move the wall back (focal length) and the picture
// grows; far things look small. K turns that picture into pixel numbers, and
// calibration finds K by staring at checkerboards until the coral arrows vanish.
import { View3D } from '../viz/view3d.js';
import { alpha, col, mix } from '../viz/palette.js';
import { project } from '../core/estimation.js';
import { expSO3 } from '../core/lie.js';
import { mmul, mvec, T, vadd, solve } from '../core/linalg.js';
import { rng, clamp } from '../core/random.js';
import { fmt } from '../viz/ui.js';
import { hudMatrix, hudPlot } from './registration.js';

const IW = 320, IH = 240;            // image size in pixels
const SENSOR = 1.1;                  // sensor width in world units
const PPU = IW / SENSOR;             // pixels per world unit on the sensor
const CAM = [0, 0, 0.9];             // the pinhole, in the world (z up, camera looks along +x)

// camera frame (x right, y down, z forward) ↔ world
const toCam = (p) => [-(p[1] - CAM[1]), -(p[2] - CAM[2]), p[0] - CAM[0]];
const toWorld = (c) => [CAM[0] + c[2], CAM[1] - c[0], CAM[2] - c[1]];

// a little house: faces in world coords (front face at x = d)
function house(d, y0 = 0, s = 1) {
  const X0 = d, X1 = d + 1.0 * s, Y0 = y0 - 0.7 * s, Y1 = y0 + 0.7 * s, Z1 = 0.9 * s, ZR = 1.5 * s;
  const XM = (X0 + X1) / 2;
  return [
    { pts: [[X0, Y0, 0], [X0, Y1, 0], [X0, Y1, Z1], [X0, Y0, Z1]], color: 'teal' },                // front wall
    { pts: [[X0, Y0, 0], [X1, Y0, 0], [X1, Y0, Z1], [X0, Y0, Z1]], color: 'teal', dim: 0.7 },      // side wall
    { pts: [[X0, Y1, 0], [X1, Y1, 0], [X1, Y1, Z1], [X0, Y1, Z1]], color: 'teal', dim: 0.7 },
    { pts: [[X0, Y0, Z1], [X0, Y1, Z1], [XM, Y1, ZR], [XM, Y0, ZR]], color: 'coral' },             // roof (front slope)
    { pts: [[X1, Y0, Z1], [X1, Y1, Z1], [XM, Y1, ZR], [XM, Y0, ZR]], color: 'coral', dim: 0.75 },
    { pts: [[X0 - 0.01, y0 - 0.16 * s, 0], [X0 - 0.01, y0 + 0.16 * s, 0], [X0 - 0.01, y0 + 0.16 * s, 0.52 * s], [X0 - 0.01, y0 - 0.16 * s, 0.52 * s]], color: 'orange' },
  ];
}

// checkerboard: 5×4 squares, the 4×3 inner corners are what calibration measures
const SQ = 0.22;
const CORNERS = []; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) CORNERS.push([(i - 1.5) * SQ, (j - 1) * SQ, 0]);
const SQUARES = []; for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) SQUARES.push({ dark: (i + j) % 2 === 0, pts: [[(i - 2.5) * SQ, (j - 2) * SQ, 0], [(i - 1.5) * SQ, (j - 2) * SQ, 0], [(i - 1.5) * SQ, (j - 1) * SQ, 0], [(i - 2.5) * SQ, (j - 1) * SQ, 0]] });
const VIEWS = [ // true board poses in the camera frame: rotation vector + translation
  { r: [0.55, 0.5, 0.1], t: [-0.55, -0.3, 2.3] },
  { r: [-0.5, 0.6, -0.2], t: [0.55, -0.28, 2.4] },
  { r: [0.4, -0.6, 0.25], t: [-0.5, 0.32, 2.5] },
  { r: [-0.6, -0.45, -0.1], t: [0.5, 0.3, 2.2] },
];

export default {
  eq: [
    ['pinhole:  ', ['u', 'teal'], ' = ', ['f', 'orange'], ' · X / Z + ', ['cₓ', 'gold'], '      ', ['v', 'teal'], ' = ', ['f', 'orange'], ' · Y / Z + ', ['c_y', 'gold'], '      (far ⇒ big Z ⇒ small)'],
    ['Z [', ['u', 'teal'], ' ', ['v', 'teal'], ' 1]ᵀ = ', ['K', 'ink'], ' [X Y Z]ᵀ      ', ['K', 'ink'], ' = [[', ['f', 'orange'], ' 0 ', ['cₓ', 'gold'], '] [0 ', ['f', 'orange'], ' ', ['c_y', 'gold'], '] [0 0 1]]'],
    ['world → camera:  [X Y Z]ᵀ = R ', ['p', 'teal'], ' + t      (a rigid move, then the pinhole)'],
    ['calibration:  min over ', ['K', 'blue'], ', Rᵢ, tᵢ  of  Σ ‖ project(', ['K', 'blue'], ', Rᵢ ', ['corner', 'teal'], ' + tᵢ) − ', ['seen', 'teal'], ' ‖²  =  Σ ', ['arrow²', 'coral']],
  ],
  setup({ stage, ui }) {
    const tall = stage.portrait;
    const [L, Rp] = stage.split([[-1, -1, 1, 1], [-8, tall ? -8 : -126, IW + 8, IH + 8]], tall ? [1.15, 1] : [1.3, 1]);
    const v = new View3D(L, { yaw: -1.42, pitch: 0.3, dist: tall ? 6.4 : 5.4, target: [1.6, 0, 0.8] });
    const s = { beat: 0, f: 0.9, d: 3.3, cx: IW / 2, cy: IH / 2, t: 0, it: 0, errs: [], lmT: 0, seed: 1 };
    const K = () => [[s.f * PPU, 0, s.cx], [0, s.f * PPU, s.cy], [0, 0, 1]];
    const pix = (uv) => [uv[0], IH - uv[1]];   // pixel (v down) → image pen (y up)

    // ---------------- calibration data + Levenberg–Marquardt
    const Ktrue = [291, 291, 160, 120];
    let obs = [], P = [], lam = 1e-2;
    const poseOf = (p, k) => ({ R: expSO3(p.slice(4 + 6 * k, 7 + 6 * k)), t: p.slice(7 + 6 * k, 10 + 6 * k) });
    const Kof = (p) => [[p[0], 0, p[2]], [0, p[1], p[3]], [0, 0, 1]];
    const predict = (p) => VIEWS.map((_, k) => { const { R, t } = poseOf(p, k); return CORNERS.map((c) => project(Kof(p), vadd(mvec(R, c), t)) ?? [1e4, 1e4]); });
    const resid = (p) => { const pr = predict(p), out = []; pr.forEach((vw, k) => vw.forEach((uv, i) => out.push(uv[0] - obs[k][i][0], uv[1] - obs[k][i][1]))); return out; };
    const rms = (rr) => Math.sqrt(rr.reduce((a, b) => a + b * b, 0) / (rr.length / 2));
    function calibReset() {
      const r = rng(30 + s.seed);
      const truthP = [...Ktrue, ...VIEWS.flatMap((w) => [...w.r, ...w.t])];
      obs = []; obs = predict(truthP).map((vw) => vw.map((uv) => [uv[0] + r.normal(0, 0.3), uv[1] + r.normal(0, 0.3)]));
      // a bad first guess: wrong zoom, wrong center, boards a bit off
      P = [Ktrue[0] * r.uniform(0.6, 0.7), Ktrue[1] * r.uniform(0.6, 0.7), Ktrue[2] + r.uniform(-30, 30), Ktrue[3] + r.uniform(-25, 25),
        ...VIEWS.flatMap((w) => [...w.r.map((x) => x + r.normal(0, 0.12)), w.t[0] + r.normal(0, 0.15), w.t[1] + r.normal(0, 0.15), w.t[2] * r.uniform(0.8, 0.9)])];
      lam = 1e-2; s.errs = [rms(resid(P))]; s.it = 0; s.lmT = 0; s.prevP = P; s.animK = 1;
    }
    function lmStep() {
      const r0 = resid(P), n = P.length, m = r0.length;
      const J = Array.from({ length: m }, () => new Array(n).fill(0));
      for (let j = 0; j < n; j++) {
        const h = 1e-6 * Math.max(1, Math.abs(P[j])), q = P.slice(); q[j] += h;
        const rj = resid(q);
        for (let i = 0; i < m; i++) J[i][j] = (rj[i] - r0[i]) / h;
      }
      const Jt = T(J), A = mmul(Jt, J), gvec = mvec(Jt, r0);
      const c0 = r0.reduce((a, b) => a + b * b, 0);
      for (let tries = 0; tries < 8; tries++) {
        const Ad = A.map((row, i) => row.map((x, j) => (i === j ? x * (1 + lam) + 1e-9 : x)));
        const dlt = solve(Ad, gvec.map((x) => -x));
        if (dlt) {
          const q = P.map((x, i) => x + dlt[i]);
          const c1 = resid(q).reduce((a, b) => a + b * b, 0);
          if (c1 < c0) { s.prevP = P; P = q; lam = Math.max(1e-7, lam / 4); break; }
        }
        lam *= 5;
      }
      s.errs.push(rms(resid(P))); s.it++; s.animK = 0;
    }
    calibReset();

    // ---------------- controls
    ui.beats(['📦', '🔭', '🧮', '🏁'], (b) => {
      s.beat = b; s.t = 0;
      if (b === 3) calibReset();
      if (b < 2) { s.cx = IW / 2; s.cy = IH / 2; }
      if (b === 3) { v.target = [1.0, 0, 0.8]; v.dist = tall ? 6 : 5; } else frameView();
      fS.el.style.display = dS.el.style.display = b === 3 ? 'none' : '';
    });
    const fS = ui.slider({ icon: '🔭', color: 'orange', min: 0.45, max: 1.7, value: 0.9, title: 'focal length (zoom)', onInput: (x) => { s.f = x; frameView(); } });
    const dS = ui.slider({ icon: '🏠', color: 'teal', min: 1.7, max: 7, value: 3.3, title: 'how far the house is', onInput: (x) => { s.d = x; frameView(); } });
    ui.button({ icon: '🎲', title: 'new bad guess', onClick: () => { s.seed++; calibReset(); } });
    ui.readout(() => (s.beat === 3 ? `${fmt(s.errs.at(-1), 1)} px` : `${fmt(imgHeight(), 0)} px`), { icon: '📏', color: 'coral', title: 'size in the picture / reprojection error' });
    // drag the principal point (beat 3)
    stage.handle({ pen: Rp, color: 'gold', kind: 'ring', r: 10, visible: () => s.beat === 2, get: () => pix([s.cx, s.cy]),
      set: (p) => { s.cx = clamp(Math.round(p[0]), 40, IW - 40); s.cy = clamp(Math.round(IH - p[1]), 30, IH - 30); } });
    const SUN = () => [s.d + 2.4, -1.5, 2.5], TREE = () => [s.d + 0.4, 1.55, 0.6];
    function imgHeight() {
      const top = project(K(), toCam([s.d, 0, 1.5])), bot = project(K(), toCam([s.d, 0, 0]));
      return top && bot ? Math.abs(top[1] - bot[1]) : 0;
    }

    frameView();
    return {
      update(dt) {
        dt = Math.max(0, dt);
        s.t += dt; v.tick(dt);
        if (s.beat === 3) {
          s.animK = Math.min(1, (s.animK ?? 1) + dt / 0.5);
          s.lmT += dt;
          const done = s.it >= 14 || (s.errs.length > 2 && s.errs.at(-2) - s.errs.at(-1) < 1e-3);
          if (!done && s.lmT > 0.9) { s.lmT = 0; lmStep(); }
          if (done && s.lmT > 4) { s.seed++; calibReset(); }
        }
      },
      draw() {
        Rp.fillBg('panel');
        if (s.beat === 3) { draw3DCalib(); drawImageCalib(); return; }
        draw3D();
        drawImage();
      },
    };

    // ------------------------------------------------------------------ scenes
    function objects() {
      const faces = house(s.d);
      const posts = [];
      if (s.beat === 1) faces.push(...house(s.d + 5, 2.4, 1));
      if (s.beat >= 1) for (let k = 0; k < 6; k++) posts.push(s.d - 0.4 + k * 2.2);
      return { faces, posts };
    }

    function draw3D() {
      const f = s.f, phys = s.beat === 0;
      v.begin();
      v.floor(4, 0.5);
      const { faces, posts } = objects();
      for (const fc of faces) v.poly(fc.pts, { color: fc.dim ? alpha(fc.color, 0.75) : fc.color, alpha: 0.85, stroke: alpha('ink', 0.4) });
      v.text('☀️', SUN(), { size: 30, halo: false });
      v.text('🌳', TREE(), { size: Math.min(60, v.project(TREE()).scale * 1.1), halo: false });
      if (s.beat >= 1) {
        // road rails running away from the camera
        for (const y of [-0.95, 0.95]) v.line([0.4, y, 0], [16, y, 0], { color: alpha('slate', 0.9), width: 3 });
        for (const x of posts) v.cylinder([x, -1.25, 0], [x, -1.25, 1.2], 0.05, { color: 'slate', sides: 6, caps: false });
      }
      // camera: a box with a hole (physical) or a small body + screen in front (math model)
      const hw = SENSOR / 2, hh = (SENSOR * IH / IW) / 2;
      if (phys) {
        const X0 = -f;
        const back = [[X0, -hw, CAM[2] - hh], [X0, hw, CAM[2] - hh], [X0, hw, CAM[2] + hh], [X0, -hw, CAM[2] + hh]];
        v.poly(back, { color: 'panel', alpha: 0.95, stroke: 'ink', strokeWidth: 1.5, shade: false, bias: 0.2 });
        for (const [a, b] of [[[X0, -hw, -hh], [0, -hw, -hh]], [[X0, hw, -hh], [0, hw, -hh]], [[X0, -hw, hh], [0, -hw, hh]], [[X0, hw, hh], [0, hw, hh]]])
          v.line(vadd(a, [0, 0, CAM[2]]), vadd(b, [0, 0, CAM[2]]), { color: alpha('slate', 0.8), width: 2 });
        v.poly([[0, -hw, CAM[2] - hh], [0, hw, CAM[2] - hh], [0, hw, CAM[2] + hh], [0, -hw, CAM[2] + hh]], { color: 'slate', alpha: 0.14, stroke: 'slate', shade: false });
        v.poly([[X0, -hw, CAM[2] - hh], [0, -hw, CAM[2] - hh], [0, -hw, CAM[2] + hh], [X0, -hw, CAM[2] + hh]], { color: 'slate', alpha: 0.12, shade: false });
        // the upside-down picture on the back wall
        const onWall = (P) => { const k = f / (P[0] - CAM[0]); return [CAM[0] - f, CAM[1] - (P[1] - CAM[1]) * k, CAM[2] - (P[2] - CAM[2]) * k]; };
        for (const fc of faces) v.poly(fc.pts.map(onWall), { color: fc.color, alpha: 0.9, shade: false, bias: 0.1 });
        // rays through the hole
        const keys = [[s.d + 0.5, -0.7, 1.5], [s.d + 0.5, 0.7, 1.5], [s.d, -0.7, 0], [s.d, 0.7, 0], SUN()];
        keys.forEach((P, i) => {
          const c = i === 4 ? 'gold' : i < 2 ? 'coral' : 'teal';
          v.line(P, CAM, { color: alpha(c, 0.55), width: 1.6 });
          v.line(CAM, onWall(P), { color: c, width: 2 });
          v.point(onWall(P), 3.5, { color: c });
        });
        v.point(CAM, 5, { color: 'ink', ring: 'gold' });
      } else {
        // small body behind the pinhole + the "virtual" screen in front at distance f
        v.box([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [-0.25, 0, CAM[2]], [0.22, 0.22, 0.17], { color: 'slate' });
        v.cylinder([-0.03, 0, CAM[2]], [0.06, 0, CAM[2]], 0.1, { color: 'ink', sides: 10 });
        const corner = (u, vv) => toWorld([(u - s.cx) / PPU, (vv - s.cy) / PPU, f]);
        const scr = [corner(0, 0), corner(IW, 0), corner(IW, IH), corner(0, IH)];
        v.poly(scr, { color: 'panel', alpha: 0.55, stroke: 'ink', strokeWidth: 1.5, shade: false });
        if (s.beat === 2) {
          for (let u = 40; u < IW; u += 40) v.line(corner(u, 0), corner(u, IH), { color: alpha('muted', 0.5), width: 1 });
          for (let vv = 40; vv < IH; vv += 40) v.line(corner(0, vv), corner(IW, vv), { color: alpha('muted', 0.5), width: 1 });
          v.line(CAM, toWorld([0, 0, f * 1.6]), { color: 'gold', width: 2, dash: [5, 4] });
          v.point(toWorld([0, 0, f]), 5, { color: 'gold' });
          v.point(corner(0, 0), 4, { color: 'ink' });
        }
        // rays from a few points pierce the screen where the picture is
        const keys = [[s.d + 0.5, 0, 1.5], [s.d, 0.7, 0], [s.d, -0.7, 0]];
        if (s.beat === 1) keys.push([s.d - 0.4 + 5 * 2.2, -1.25, 1.2], [s.d - 0.4 + 5 * 2.2, -1.25, 0]);
        keys.forEach((P, i) => {
          const pc = toCam(P), hit = toWorld(pc.map((x) => (x * f) / pc[2]));
          const c = i === 0 ? 'coral' : 'teal';
          v.line(P, CAM, { color: alpha(c, 0.5), width: 1.5 });
          v.point(hit, 4, { color: c });
        });
        v.line(CAM, toWorld([0, 0, f]), { color: alpha('orange', 0.9), width: 3 });
        v.point(CAM, 5, { color: 'ink', ring: 'gold' });
      }
      v.flush();
      // focal length marker
      const a = v.project(CAM).s, b = v.project(phys ? [CAM[0] - f, CAM[1], CAM[2]] : toWorld([0, 0, f])).s;
      const ctx = L.ctx; ctx.save(); ctx.font = '700 16px ui-rounded, system-ui'; ctx.fillStyle = col('orange'); ctx.textAlign = 'center';
      ctx.fillText('f', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 12); ctx.restore();
    }

    // what lands on the sensor, painted in the right panel
    function drawImage() {
      const k = K(), flip = s.beat === 0;
      const P = (w) => { const uv = project(k, toCam(w)); if (!uv) return null; return pix(flip ? [IW - uv[0], IH - uv[1]] : uv); };
      Rp.rect(0, 0, IW, IH, { fill: alpha('bg', 1), stroke: false });
      Rp.clip(() => {
        const ctx = Rp.ctx, a = Rp.toScreen([0, IH]), b = Rp.toScreen([IW, 0]);
        ctx.save(); ctx.beginPath(); ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.clip();
        // ground below the horizon (horizon = principal row for a level camera)
        const hz = flip ? IH - s.cy : s.cy;
        Rp.rect(-2, flip ? IH - hz : -2, IW + 4, flip ? hz + 2 : IH - hz + 2, { fill: alpha('slate', 0.1), stroke: false });
        if (s.beat >= 1) {
          for (const y of [-0.95, 0.95]) { const p1 = P([0.6, y, 0]), p2 = P([60, y, 0]); if (p1 && p2) Rp.line(p1, p2, { color: 'slate', width: 2.5 }); }
          Rp.dot(pix([s.cx, s.cy]), 4, { color: 'gold' });
          for (const x of objects().posts) { const p1 = P([x, -1.25, 0]), p2 = P([x, -1.25, 1.2]); if (p1 && p2) Rp.line(p1, p2, { color: 'slate', width: Math.max(1.5, 0.1 * s.f * PPU / (x - CAM[0])) }); }
        }
        const { faces } = objects();
        const sorted = faces.map((fc) => ({ fc, z: fc.pts.reduce((acc, p) => acc + toCam(p)[2], 0) / fc.pts.length })).sort((x, y) => y.z - x.z);
        for (const { fc } of sorted) {
          const q = fc.pts.map(P);
          if (q.some((x) => !x)) continue;
          Rp.poly(q, { fill: mix(fc.color, 'bg', fc.dim ? 0.45 : 0.15), color: alpha('ink', 0.5), width: 1 });
        }
        emojiAt(P(SUN()), '☀️', (0.5 * s.f * PPU) / (SUN()[0] - CAM[0]), flip);
        emojiAt(P(TREE()), '🌳', (1.2 * s.f * PPU) / (TREE()[0] - CAM[0]), flip);
        if (s.beat === 2) drawPixelGrid(k);
        ctx.restore();
      });
      Rp.rect(0, 0, IW, IH, { color: 'ink', width: 2 });
      if (flip) Rp.emoji('🙃', [IW - 14, IH - 16], 22);
      if (s.beat === 2) drawK();
    }
    function emojiAt(p, ch, size, flip) {
      if (!p) return;
      const sc = Rp.toScreen(p), ctx = Rp.ctx;
      ctx.save(); ctx.translate(sc[0], sc[1]); if (flip) ctx.rotate(Math.PI);
      ctx.font = `${Math.max(6, Math.min(80, size * Rp.k))}px system-ui, "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, 0, 0); ctx.restore();
    }
    function drawPixelGrid(k) {
      for (let u = 0; u <= IW; u += 20) Rp.line([u, 0], [u, IH], { color: alpha('muted', u % 80 ? 0.15 : 0.4), width: 1 });
      for (let vv = 0; vv <= IH; vv += 20) Rp.line([0, IH - vv], [IW, IH - vv], { color: alpha('muted', vv % 80 ? 0.15 : 0.4), width: 1 });
      // the roof tip, and where it lands: u = f·X/Z + cx
      const uv = project(k, toCam([s.d + 0.5, 0, 1.5]));
      if (uv) {
        Rp.line([s.cx, IH - s.cy], [uv[0], IH - s.cy], { color: 'orange', width: 2.5 });
        Rp.line([uv[0], IH - s.cy], pix(uv), { color: 'orange', width: 2.5, dash: [4, 3] });
        Rp.dot(pix(uv), 6, { color: 'coral', ring: 'bg' });
        Rp.text(`(${fmt(uv[0], 0)}, ${fmt(uv[1], 0)})`, [uv[0] + 4, IH - uv[1] + 16], { size: 13, color: 'teal', align: 'left' });
      }
      Rp.line([s.cx - 12, IH - s.cy], [s.cx + 12, IH - s.cy], { color: 'gold', width: 2.5 });
      Rp.line([s.cx, IH - s.cy - 12], [s.cx, IH - s.cy + 12], { color: 'gold', width: 2.5 });
      Rp.text('0', [-6, IH + 6], { size: 11, color: 'muted' });
      Rp.text(String(IW), [IW, IH + 8], { size: 11, color: 'muted' });
      Rp.text(String(IH), [-8, 0], { size: 11, color: 'muted', align: 'right' });
    }
    // where the K matrix card goes: under the picture, or (phones) in the 3D corner
    function kSpot() {
      if (tall) return { x: L.area.x + L.area.w - 3 * 46 - 34, y: L.area.y + 8, cw: 46, ch: 20, size: 12 };
      const a = Rp.toScreen([0, -8]);
      return { x: a[0] + (Rp.px(IW) - 222) / 2, y: a[1] + 4, cw: 66, ch: 26 };
    }
    function frameView() {
      // keep both the camera and the house in view
      const x0 = -s.f - 0.3, x1 = s.d + 1.3;
      v.target = [(x0 + x1) / 2, 0, 0.75];
      v.dist = tall ? (x1 - x0) + 1.0 : 0.72 * (x1 - x0) + 0.5;
    }
    function drawK() {
      const k = K();
      hudMatrix(stage.hud, [[k[0][0], 0, k[0][2]], [0, k[1][1], k[1][2]], [0, 0, 1]], {
        ...kSpot(), digits: 0,
        colorAt: (r, c) => (r === 2 || (r !== c && c !== 2) ? 'muted' : c === 2 ? 'gold' : 'orange'),
      });
    }

    // ------------------------------------------------------------------ calibration
    function boardWorld(R, t, pts) { return pts.map((p) => toWorld(vadd(mvec(R, p), t))); }
    function draw3DCalib() {
      v.begin();
      v.floor(4, 0.5);
      v.box([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [-0.25, 0, CAM[2]], [0.22, 0.22, 0.17], { color: 'slate' });
      v.cylinder([-0.03, 0, CAM[2]], [0.06, 0, CAM[2]], 0.1, { color: 'ink', sides: 10 });
      const k = s.animK ?? 1;
      VIEWS.forEach((w, i) => {
        const R = expSO3(w.r);
        for (const sq of SQUARES) v.poly(boardWorld(R, w.t, sq.pts), { color: sq.dark ? 'black' : 'white', alpha: 0.6, shade: false, stroke: alpha('ink', 0.2) });
        // where calibration currently THINKS the board is (blue outline, sliding in)
        const a = poseOf(s.prevP, i), b = poseOf(P, i);
        const Rk = mmul(a.R, expSO3(logRel(a.R, b.R).map((x) => x * k))), tk = a.t.map((x, j) => x + (b.t[j] - x) * k);
        const out = boardWorld(Rk, tk, [[-2.5 * SQ, -2 * SQ, 0], [2.5 * SQ, -2 * SQ, 0], [2.5 * SQ, 2 * SQ, 0], [-2.5 * SQ, 2 * SQ, 0]]);
        v.path(out, { color: 'blue', width: 2.5, close: true });
        // a few viewing rays
        const cw = boardWorld(R, w.t, [CORNERS[0], CORNERS[11]]);
        cw.forEach((p) => v.line(CAM, p, { color: alpha('teal', 0.35), width: 1 }));
      });
      v.flush();
      const area = L.area, w = Math.min(260, area.w - 24), h = tall ? 70 : 92;
      hudPlot(stage.hud, { x: area.x + 12, y: area.y + area.h - h - 10, w, h }, [{ vals: s.errs, color: 'coral', dots: true }], { icon: '📏', ymin: 0, n: Math.max(8, s.errs.length) });
    }
    function logRel(Ra, Rb) {
      // rotation vector of Raᵀ Rb (tiny helper so the blue boards turn smoothly)
      const M = mmul(T(Ra), Rb);
      const c = clamp((M[0][0] + M[1][1] + M[2][2] - 1) / 2, -1, 1), th = Math.acos(c);
      if (th < 1e-9) return [0, 0, 0];
      const k = th / (2 * Math.sin(th));
      return [(M[2][1] - M[1][2]) * k, (M[0][2] - M[2][0]) * k, (M[1][0] - M[0][1]) * k];
    }
    function drawImageCalib() {
      Rp.rect(0, 0, IW, IH, { fill: alpha('bg', 1), stroke: false });
      const kk = s.animK ?? 1;
      const Pm = s.prevP.map((x, i) => x + (P[i] - x) * kk);
      const pred = predict(Pm);
      Rp.clip(() => {
        // the real checkerboards, as the camera sees them
        const Kt = Kof([...Ktrue]);
        VIEWS.forEach((w) => {
          const R = expSO3(w.r);
          for (const sq of SQUARES) if (sq.dark) {
            const q = sq.pts.map((p) => project(Kt, vadd(mvec(R, p), w.t)));
            if (q.every(Boolean)) Rp.poly(q.map(pix), { fill: alpha('ink', 0.16), stroke: false });
          }
        });
        obs.forEach((vw, kv) => vw.forEach((o, i) => {
          const p = pred[kv][i];
          Rp.arrow(pix(p), pix(o), { color: 'coral', width: 2, head: 7 });
          Rp.dot(pix(o), 3.4, { color: 'teal' });
          Rp.dot(pix(p), 3, { color: 'blue' });
        }));
      });
      Rp.rect(0, 0, IW, IH, { color: 'ink', width: 2 });
      if (s.errs.at(-1) < 0.6 && kk >= 1) Rp.emoji('✅', [IW - 16, IH - 18], 24);
      hudMatrix(stage.hud, [[Pm[0], 0, Pm[2]], [0, Pm[1], Pm[3]], [0, 0, 1]], {
        ...kSpot(), digits: 0, title: 'K̂', titleColor: 'blue',
        colorAt: (r, c) => (r === 2 || (r !== c && c !== 2) ? 'muted' : c === 2 ? 'gold' : 'orange'),
      });
    }
  },
};
