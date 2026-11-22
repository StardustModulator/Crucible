// Tiny 3D on a 2D canvas: orbit camera, perspective projection, depth-sorted drawing.
// World convention: z is UP. Drag empty space on the pen to orbit.
import { C, col, alpha } from './palette.js';

export class View3D {
  constructor(pen, { yaw = -0.6, pitch = 0.45, dist = 9, fov = 1.0, target = [0, 0, 0.6], orbit = true, autoSpin = 0 } = {}) {
    Object.assign(this, { pen, yaw, pitch, dist, fov, target, autoSpin });
    this.queue = [];
    if (orbit) this._bindOrbit();
  }
  _bindOrbit() {
    const st = this.pen.stage;
    let last = null;
    st.on('down', (e) => { if (e.pen === this.pen) last = [e.sx, e.sy]; });
    st.on('move', (e) => {
      if (!last || !st.pointer.down) { last = null; return; }
      this.yaw -= (e.sx - last[0]) * 0.008;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + (e.sy - last[1]) * 0.008));
      last = [e.sx, e.sy];
    });
    st.on('up', () => (last = null));
    st.on('wheel', (e) => { if (e.pen === this.pen) this.dist = Math.max(2, Math.min(40, this.dist * (1 + e.delta * 0.001))); });
  }
  tick(dt) { this.yaw += this.autoSpin * dt; }

  // Camera basis.
  _basis() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd = [-cp * cy, -cp * sy, -sp];               // from eye toward target
    const right = [-sy, cy, 0];
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    const eye = [this.target[0] - fwd[0] * this.dist, this.target[1] - fwd[1] * this.dist, this.target[2] - fwd[2] * this.dist];
    return { fwd, right, up, eye };
  }

  // Project world point → { s: [sx, sy], depth, scale }.
  project(p) {
    const b = this._b ?? this._basis();
    const d = [p[0] - b.eye[0], p[1] - b.eye[1], p[2] - b.eye[2]];
    const z = d[0] * b.fwd[0] + d[1] * b.fwd[1] + d[2] * b.fwd[2];
    const x = d[0] * b.right[0] + d[1] * b.right[1] + d[2] * b.right[2];
    const y = d[0] * b.up[0] + d[1] * b.up[1] + d[2] * b.up[2];
    const r = this.pen.area;
    const f = (Math.min(r.w, r.h) / 2) / Math.tan(this.fov / 2);
    const zz = Math.max(z, 0.05);
    return { s: [r.x + r.w / 2 + (f * x) / zz, r.y + r.h / 2 - (f * y) / zz], depth: z, scale: f / zz };
  }

  begin() { this._b = this._basis(); this.queue = []; return this; }
  // Flush queued primitives back-to-front.
  flush() {
    const ctx = this.pen.ctx;
    this.queue.sort((a, b) => b.depth - a.depth);
    this.pen.clip(() => { for (const q of this.queue) q.draw(ctx); });
    this.queue = [];
    this._b = null;
  }

  line(a, b, o = {}) {
    const A = this.project(a), B = this.project(b);
    this.queue.push({ depth: (A.depth + B.depth) / 2 + (o.bias ?? 0), draw: (ctx) => {
      ctx.save(); ctx.strokeStyle = col(o.color ?? 'ink'); ctx.lineWidth = o.width ?? 2; ctx.lineCap = 'round';
      ctx.globalAlpha = o.alpha ?? 1; ctx.setLineDash(o.dash ?? []);
      ctx.beginPath(); ctx.moveTo(...A.s); ctx.lineTo(...B.s); ctx.stroke(); ctx.restore();
    } });
  }
  path(pts, o = {}) { for (let i = 1; i < pts.length; i++) this.line(pts[i - 1], pts[i], o); if (o.close && pts.length > 2) this.line(pts.at(-1), pts[0], o); }

  arrow(a, b, o = {}) {
    const A = this.project(a), B = this.project(b);
    this.queue.push({ depth: Math.min(A.depth, B.depth) + (o.bias ?? -0.01), draw: (ctx) => {
      const dx = B.s[0] - A.s[0], dy = B.s[1] - A.s[1], L = Math.hypot(dx, dy);
      if (L < 1) return;
      const ux = dx / L, uy = dy / L, head = Math.min(o.head ?? 12, L * 0.5);
      const c = col(o.color ?? 'ink');
      ctx.save(); ctx.globalAlpha = o.alpha ?? 1;
      ctx.strokeStyle = c; ctx.lineWidth = o.width ?? 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(...A.s); ctx.lineTo(B.s[0] - ux * head * 0.8, B.s[1] - uy * head * 0.8); ctx.stroke();
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(...B.s);
      ctx.lineTo(B.s[0] - ux * head - uy * head * 0.45, B.s[1] - uy * head + ux * head * 0.45);
      ctx.lineTo(B.s[0] - ux * head + uy * head * 0.45, B.s[1] - uy * head - ux * head * 0.45);
      ctx.closePath(); ctx.fill(); ctx.restore();
    } });
  }

  point(p, rpx = 5, o = {}) {
    const P = this.project(p);
    this.queue.push({ depth: P.depth + (o.bias ?? -0.02), draw: (ctx) => {
      ctx.save(); ctx.globalAlpha = o.alpha ?? 1;
      ctx.beginPath(); ctx.arc(P.s[0], P.s[1], rpx * (o.perspective ? P.scale / 60 : 1), 0, Math.PI * 2);
      ctx.fillStyle = col(o.color ?? 'ink'); ctx.fill();
      if (o.ring) { ctx.strokeStyle = col(o.ring); ctx.lineWidth = 2; ctx.stroke(); }
      ctx.restore();
    } });
  }

  // Shaded ball with world radius.
  sphere(c, r, o = {}) {
    const P = this.project(c);
    this.queue.push({ depth: P.depth + (o.bias ?? 0), draw: (ctx) => {
      const R = r * P.scale;
      const g = ctx.createRadialGradient(P.s[0] - R * 0.35, P.s[1] - R * 0.35, R * 0.1, P.s[0], P.s[1], R);
      g.addColorStop(0, alpha('white', 0.9)); g.addColorStop(0.25, col(o.color ?? 'blue')); g.addColorStop(1, alpha(o.color ?? 'blue', 0.55));
      ctx.save(); ctx.globalAlpha = o.alpha ?? 1; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(P.s[0], P.s[1], Math.max(R, 1), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    } });
  }

  // Filled polygon with simple Lambert shading from its normal.
  poly(pts, o = {}) {
    const P = pts.map((p) => this.project(p));
    const depth = P.reduce((s, q) => s + q.depth, 0) / P.length + (o.bias ?? 0);
    let shade = 1;
    if (pts.length >= 3 && o.shade !== false) {
      const u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
      const v = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const L = Math.hypot(...n) || 1, light = [0.3, 0.4, 0.85];
      shade = 0.55 + 0.45 * Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / L);
    }
    this.queue.push({ depth, draw: (ctx) => {
      ctx.save(); ctx.globalAlpha = o.alpha ?? 1;
      ctx.beginPath(); P.forEach((q, i) => (i ? ctx.lineTo(...q.s) : ctx.moveTo(...q.s))); ctx.closePath();
      ctx.fillStyle = col(o.color ?? 'blue');
      ctx.fill();
      if (shade < 1) { ctx.fillStyle = `rgba(0,0,0,${(1 - shade) * 0.9})`; ctx.fill(); }
      if (o.stroke) { ctx.strokeStyle = col(o.stroke); ctx.lineWidth = o.strokeWidth ?? 1; ctx.stroke(); }
      ctx.restore();
    } });
  }

  // Box with pose (R 3×3, p) and half-sizes.
  box(R, p, half, o = {}) {
    const corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const l = [sx * half[0], sy * half[1], sz * half[2]];
      corners.push([0, 1, 2].map((i) => p[i] + R[i][0] * l[0] + R[i][1] * l[1] + R[i][2] * l[2]));
    }
    const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const f of faces) this.poly(f.map((i) => corners[i]), { stroke: o.stroke ?? alpha('black', 0.25), ...o });
  }

  // Cylinder (link) between a and b with radius r.
  cylinder(a, b, r, o = {}) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(...d) || 1e-9;
    const z = d.map((x) => x / L);
    const tmp = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let x = [tmp[1] * z[2] - tmp[2] * z[1], tmp[2] * z[0] - tmp[0] * z[2], tmp[0] * z[1] - tmp[1] * z[0]];
    const xl = Math.hypot(...x); x = x.map((v) => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const n = o.sides ?? 10;
    const ring = (c) => Array.from({ length: n }, (_, i) => {
      const t = (2 * Math.PI * i) / n;
      return [0, 1, 2].map((k) => c[k] + r * (Math.cos(t) * x[k] + Math.sin(t) * y[k]));
    });
    const A = ring(a), B = ring(b);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.poly([A[i], A[j], B[j], B[i]], { color: o.color ?? 'blue', alpha: o.alpha });
    }
    if (o.caps !== false) { this.poly(A, { color: o.color ?? 'blue', alpha: o.alpha }); this.poly(B, { color: o.color ?? 'blue', alpha: o.alpha }); }
  }

  // RGB frame from rotation R (3×3, columns = axes) and origin p.
  frame(R, p, len = 1, o = {}) {
    const cols = [o.x ?? 'red', o.y ?? 'green', o.z ?? 'blue'];
    for (let j = 0; j < 3; j++)
      this.arrow(p, [p[0] + R[0][j] * len, p[1] + R[1][j] * len, p[2] + R[2][j] * len], { color: cols[j], width: o.width ?? 3, alpha: o.alpha, head: o.head });
    this.point(p, o.dot ?? 4, { color: o.color ?? 'ink' });
  }
  // Same from a 4×4 homogeneous transform.
  frameT(Tm, len = 1, o = {}) {
    this.frame(Tm.slice(0, 3).map((r) => r.slice(0, 3)), [Tm[0][3], Tm[1][3], Tm[2][3]], len, o);
  }

  // Floor grid in the z=0 plane.
  floor(size = 3, step = 0.5, o = {}) {
    for (let v = -size; v <= size + 1e-9; v += step) {
      const main = Math.abs(v) < 1e-9;
      this.line([v, -size, 0], [v, size, 0], { color: main ? alpha('muted', 0.6) : (o.color ?? 'grid'), width: 1, bias: 1000 });
      this.line([-size, v, 0], [size, v, 0], { color: main ? alpha('muted', 0.6) : (o.color ?? 'grid'), width: 1, bias: 1000 });
    }
  }

  // Wire circle (e.g. rotation path) around axis through center.
  circle(center, normal, r, o = {}) {
    const L = Math.hypot(...normal) || 1, z = normal.map((v) => v / L);
    const tmp = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let x = [tmp[1] * z[2] - tmp[2] * z[1], tmp[2] * z[0] - tmp[0] * z[2], tmp[0] * z[1] - tmp[1] * z[0]];
    const xl = Math.hypot(...x); x = x.map((v) => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const n = o.segments ?? 48, a0 = o.from ?? 0, a1 = o.to ?? Math.PI * 2;
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const t = a0 + ((a1 - a0) * i) / n;
      return [0, 1, 2].map((k) => center[k] + r * (Math.cos(t) * x[k] + Math.sin(t) * y[k]));
    });
    this.path(pts, o);
    return pts;
  }

  // Text label at a 3D point.
  text(str, p, o = {}) {
    const P = this.project(p);
    this.queue.push({ depth: P.depth - 100, draw: (ctx) => {
      ctx.save();
      ctx.font = `${o.weight ?? 700} ${o.size ?? 14}px ui-rounded, system-ui, "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (o.halo !== false) { ctx.lineWidth = 4; ctx.strokeStyle = alpha('bg', 0.85); ctx.strokeText(str, ...P.s); }
      ctx.fillStyle = col(o.color ?? 'ink'); ctx.fillText(str, ...P.s); ctx.restore();
    } });
  }
}
export { C };
