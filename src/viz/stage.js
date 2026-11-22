// Stage = one HiDPI canvas + animation loop + pointer handling + draggable handles.
// Pen  = a drawing surface mapped onto a rectangle of the stage with its own
//        world coordinates (y points UP, like math). A stage can hold several pens
//        (side-by-side panels), and stage.hud is a pen in raw pixels (y down).
import { C, col, alpha, cmap } from './palette.js';

export class Stage {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.width = 300; this.height = 150; this.dpr = 1;
    this.pens = [];
    this.handles = [];
    this.listeners = { down: [], move: [], up: [], wheel: [] };
    this.pointer = { sx: 0, sy: 0, down: false, inside: false };
    this.drag = null;
    this.hover = null;
    this.running = false;
    this.paused = false;
    this.speed = 1;
    this.t = 0;
    this.hud = new Pen(this, () => ({ x: 0, y: 0, w: this.width, h: this.height }), null);
    this.g = this.pen({ x: 0, y: 0, w: 1, h: 1 }, [-1, -1, 1, 1]);
    this._resize = this._resize.bind(this);
    this.ro = new ResizeObserver(this._resize);
    this.ro.observe(container);
    this._resize();
    this._bindPointer();
  }

  // Add a panel. rect is in 0..1 fractions of the stage, or a function (W, H) => rect.
  // bounds = [x0, y0, x1, y1] world box that must stay fully visible (aspect preserved).
  pen(rect, bounds, opts = {}) {
    const p = new Pen(this, typeof rect === 'function' ? rect : () => rect, bounds, opts);
    this.pens.push(p);
    return p;
  }

  // n panels laid out side-by-side on wide screens and stacked on tall ones.
  // weights optionally give relative sizes, e.g. [2, 1].
  split(boundsList, weights = null) {
    const n = boundsList.length;
    const w = weights ?? new Array(n).fill(1);
    const tot = w.reduce((a, b) => a + b, 0);
    if (this.pens[0] === this.g && this.pens.length === 1) { this.pens = []; }
    return boundsList.map((b, i) => {
      const before = w.slice(0, i).reduce((a, c) => a + c, 0) / tot, frac = w[i] / tot;
      const pen = this.pen((W, H) => (W >= H * 1.05
        ? { x: before, y: 0, w: frac, h: 1 }
        : { x: 0, y: before, w: 1, h: frac }), b, { frame: true });
      if (i === 0) this.g = pen;
      return pen;
    });
  }

  get portrait() { return this.height > this.width * 0.95; }

  _resize() {
    const r = this.container.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = Math.max(50, r.width);
    this.height = Math.max(50, r.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    for (const p of this.pens) p.layout();
    this.hud.layout();
    if (!this.running && this.drawFn) this._frame(performance.now(), true);
  }

  // ---------- handles ----------
  // A handle is a draggable dot. opts: { pen, get(): [x,y] world, set([x,y]), r (px),
  // color, icon (emoji drawn inside), kind: 'dot'|'ring'|'square', visible(), onStart, onEnd, label? }
  handle(opts) {
    const h = { pen: this.g, r: 11, color: 'gold', kind: 'dot', visible: () => true, ...opts };
    this.handles.push(h);
    return h;
  }
  removeHandle(h) { this.handles = this.handles.filter((x) => x !== h); }

  on(type, fn) { this.listeners[type].push(fn); return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== fn)); }

  _hit(sx, sy) {
    for (let i = this.handles.length - 1; i >= 0; i--) {
      const h = this.handles[i];
      if (!h.visible()) continue;
      const [hx, hy] = h.pen.toScreen(h.get());
      if (Math.hypot(sx - hx, sy - hy) <= h.r + 10) return h;
    }
    return null;
  }

  penAt(sx, sy) {
    for (let i = this.pens.length - 1; i >= 0; i--) if (this.pens[i].contains(sx, sy)) return this.pens[i];
    return this.g;
  }

  _evt(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const pen = this.penAt(sx, sy);
    return { sx, sy, pen, p: pen.toWorld([sx, sy]), shift: e.shiftKey, button: e.button, raw: e };
  }

  _bindPointer() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => {
      const ev = this._evt(e);
      this.pointer = { ...this.pointer, sx: ev.sx, sy: ev.sy, down: true };
      const h = this._hit(ev.sx, ev.sy);
      c.setPointerCapture(e.pointerId);
      if (h) {
        const [hx, hy] = h.pen.toScreen(h.get());
        this.drag = { h, ox: hx - ev.sx, oy: hy - ev.sy };
        h.onStart?.();
      } else {
        for (const f of this.listeners.down) f(ev);
      }
      this.wake();
    });
    c.addEventListener('pointermove', (e) => {
      const ev = this._evt(e);
      this.pointer = { ...this.pointer, sx: ev.sx, sy: ev.sy, inside: true };
      if (this.drag) {
        const { h, ox, oy } = this.drag;
        h.set(h.pen.toWorld([ev.sx + ox, ev.sy + oy]));
      } else {
        this.hover = this._hit(ev.sx, ev.sy);
        c.style.cursor = this.hover ? 'grab' : (this.listeners.down.length ? 'crosshair' : 'default');
        for (const f of this.listeners.move) f(ev);
      }
      this.wake();
    });
    const up = (e) => {
      const ev = this._evt(e);
      this.pointer.down = false;
      if (this.drag) { this.drag.h.onEnd?.(); this.drag = null; }
      else for (const f of this.listeners.up) f(ev);
      this.wake();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.pointer.inside = false; this.hover = null; this.wake(); });
    c.addEventListener('wheel', (e) => {
      if (!this.listeners.wheel.length) return;
      e.preventDefault();
      const ev = this._evt(e); ev.delta = e.deltaY;
      for (const f of this.listeners.wheel) f(ev);
      this.wake();
    }, { passive: false });
  }

  // ---------- loop ----------
  run(update, draw) {
    this.updateFn = update; this.drawFn = draw;
    this.running = true;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      this._frame(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  wake() { if (!this.running && this.drawFn) this._frame(performance.now(), true); }

  // Advance the simulation by exactly n fixed steps (used by tests and the ⏭ button).
  advance(seconds, h = 1 / 60) {
    for (let t = 0; t < seconds; t += h) { this.t += h; this.updateFn?.(h, this.t); }
    this._frame(performance.now(), true);
  }

  _frame(now, drawOnly = false) {
    let dt = Math.max(0, Math.min(0.05, (now - (this.last ?? now)) / 1000)); // rAF time can precede `last`
    this.last = now;
    if (!drawOnly && !this.paused && this.updateFn) {
      dt *= this.speed;
      this.t += dt;
      try { this.updateFn(dt, this.t); } catch (err) { this._fail(err); }
    }
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    try { this.drawFn?.(); } catch (err) { this._fail(err); }
    for (const p of this.pens) if (p.opts.frame && this.pens.length > 1) p.drawFrame();
    this._drawHandles();
  }

  _fail(err) {
    if (this.failed) return;
    this.failed = err;
    console.error(err);
    this.onError?.(err);
  }

  _drawHandles() {
    const ctx = this.ctx;
    for (const h of this.handles) {
      if (!h.visible()) continue;
      const [x, y] = h.pen.toScreen(h.get());
      const active = this.drag?.h === h, hov = this.hover === h;
      const r = h.r * (active ? 1.25 : hov ? 1.12 : 1);
      ctx.save();
      // soft halo says "you can grab me"
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 380);
      ctx.beginPath();
      ctx.arc(x, y, r + 5 + (active ? 3 : pulse * 3), 0, Math.PI * 2);
      ctx.fillStyle = alpha(h.color, active ? 0.35 : 0.16);
      ctx.fill();
      ctx.beginPath();
      if (h.kind === 'square') ctx.rect(x - r, y - r, 2 * r, 2 * r);
      else ctx.arc(x, y, r, 0, Math.PI * 2);
      if (h.kind === 'ring') {
        ctx.lineWidth = 3; ctx.strokeStyle = col(h.color); ctx.stroke();
      } else {
        ctx.fillStyle = col(h.color); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = C.bg; ctx.stroke();
      }
      if (h.icon) {
        ctx.font = `${Math.round(r * 1.2)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(h.icon, x, y + 1);
      }
      ctx.restore();
    }
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.remove();
  }
}

// ------------------------------------------------------------------------------------
export class Pen {
  constructor(stage, rectFn, bounds, opts = {}) {
    this.stage = stage;
    this.rectFn = rectFn;
    this.bounds = bounds; // null → pixel space
    this.opts = { pad: 14, ...opts };
    this.layout();
  }
  get ctx() { return this.stage.ctx; }

  setBounds(b) { this.bounds = b; this.layout(); return this; }

  layout() {
    const W = this.stage.width, H = this.stage.height;
    let r = this.rectFn(W, H);
    if (this.bounds === null) { this.area = { x: 0, y: 0, w: W, h: H }; this.k = 1; this.ox = 0; this.oy = 0; this.flip = 1; return; }
    if (r.w <= 1.0001 && r.h <= 1.0001) r = { x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H };
    this.area = r;
    const [x0, y0, x1, y1] = this.bounds;
    const pad = this.opts.pad;
    const k = Math.min((r.w - 2 * pad) / (x1 - x0), (r.h - 2 * pad) / (y1 - y0));
    this.k = Math.max(k, 1e-6);
    this.ox = r.x + r.w / 2 - ((x0 + x1) / 2) * this.k;
    this.oy = r.y + r.h / 2 + ((y0 + y1) / 2) * this.k;
    this.flip = -1;
  }

  // Visible world rectangle (may be larger than bounds because of aspect ratio).
  get view() {
    const r = this.area;
    const a = this.toWorld([r.x, r.y + r.h]), b = this.toWorld([r.x + r.w, r.y]);
    return [a[0], a[1], b[0], b[1]];
  }

  toScreen(p) { return [this.ox + p[0] * this.k, this.oy + this.flip * p[1] * this.k]; }
  toWorld(s) { return [(s[0] - this.ox) / this.k, (s[1] - this.oy) / (this.flip * this.k)]; }
  px(worldLen) { return worldLen * this.k; }           // world length → pixels
  world(pxLen) { return pxLen / this.k; }               // pixels → world length
  contains(sx, sy) { const r = this.area; return sx >= r.x && sy >= r.y && sx <= r.x + r.w && sy <= r.y + r.h; }

  clip(fn) {
    const ctx = this.ctx, r = this.area;
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    try { fn(); } finally { ctx.restore(); }
  }
  drawFrame() {
    const ctx = this.ctx, r = this.area;
    ctx.save(); ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); ctx.restore();
  }
  fillBg(color = 'panel') {
    const r = this.area; this.ctx.fillStyle = col(color); this.ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // ---------- style helper ----------
  _style(o = {}) {
    const ctx = this.ctx;
    ctx.lineWidth = o.width ?? 2;
    ctx.strokeStyle = col(o.color ?? 'ink');
    ctx.fillStyle = col(o.fill ?? o.color ?? 'ink');
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.setLineDash(o.dash ?? []);
    ctx.lineCap = o.cap ?? 'round';
    ctx.lineJoin = 'round';
  }
  _done(o, fill, stroke) {
    const ctx = this.ctx;
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    void o;
  }

  // ---------- primitives (all coordinates in this pen's world units) ----------
  line(a, b, o = {}) {
    const ctx = this.ctx; this._style(o);
    const A = this.toScreen(a), B = this.toScreen(b);
    ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); this._done(o, false, true);
  }
  path(pts, o = {}) {
    if (!pts || pts.length < 2) return;
    const ctx = this.ctx; this._style(o);
    ctx.beginPath();
    pts.forEach((p, i) => { const s = this.toScreen(p); i ? ctx.lineTo(...s) : ctx.moveTo(...s); });
    if (o.close) ctx.closePath();
    this._done(o, !!o.fill, o.stroke !== false);
  }
  poly(pts, o = {}) { this.path(pts, { close: true, fill: o.fill ?? o.color, ...o }); }
  // Gradient-colored path: colorFn(i, t) → css
  pathGradient(pts, colorFn, o = {}) {
    for (let i = 1; i < pts.length; i++) this.line(pts[i - 1], pts[i], { ...o, color: colorFn(i, i / (pts.length - 1)) });
  }

  // Arrow from a to b. o.head in px.
  arrow(a, b, o = {}) {
    const ctx = this.ctx; this._style(o);
    const A = this.toScreen(a), B = this.toScreen(b);
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    if (L < 0.5) return;
    const head = Math.min(o.head ?? 9 + (o.width ?? 2.5) * 1.6, L * 0.6);
    const ux = dx / L, uy = dy / L;
    const tip = B, base = [B[0] - ux * head, B[1] - uy * head];
    ctx.lineWidth = o.width ?? 2.5;
    ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(base[0] + ux * 1, base[1] + uy * 1); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(...tip);
    ctx.lineTo(base[0] - uy * head * 0.5, base[1] + ux * head * 0.5);
    ctx.lineTo(base[0] + uy * head * 0.5, base[1] - ux * head * 0.5);
    ctx.closePath(); ctx.fillStyle = col(o.color ?? 'ink'); ctx.fill();
    this._done(o, false, false);
  }
  // Arrow given origin and vector.
  vec(origin, v, o = {}) { this.arrow(origin, [origin[0] + v[0], origin[1] + v[1]], o); }

  // Circle with world radius.
  circle(c, r, o = {}) {
    const ctx = this.ctx; this._style(o);
    const s = this.toScreen(c);
    ctx.beginPath(); ctx.arc(s[0], s[1], Math.max(0, r * this.k), 0, Math.PI * 2);
    this._done(o, o.fill !== undefined, o.stroke !== false && o.fill === undefined ? true : !!o.stroke);
  }
  // Dot with pixel radius (filled).
  dot(c, rpx = 4, o = {}) {
    const ctx = this.ctx; this._style(o);
    const s = this.toScreen(c);
    ctx.beginPath(); ctx.arc(s[0], s[1], rpx, 0, Math.PI * 2);
    ctx.fillStyle = col(o.color ?? 'ink'); ctx.fill();
    if (o.ring) { ctx.lineWidth = o.ringWidth ?? 2; ctx.strokeStyle = col(o.ring); ctx.stroke(); }
    this._done(o, false, false);
  }
  // Ellipse with world radii and rotation angle (radians, CCW in world).
  ellipse(c, rx, ry, angle = 0, o = {}) {
    const ctx = this.ctx; this._style(o);
    const s = this.toScreen(c);
    ctx.beginPath();
    ctx.ellipse(s[0], s[1], Math.max(0, rx * this.k), Math.max(0, ry * this.k), this.flip * angle, 0, Math.PI * 2);
    this._done(o, o.fill !== undefined, o.stroke !== false);
  }
  // Covariance ellipse: k-sigma contour of N(mu, S) for 2×2 S.
  cov(mu, S, k = 1, o = {}) {
    const a = S[0][0], b = S[0][1], d = S[1][1];
    const tr = (a + d) / 2, disc = Math.sqrt(Math.max(((a - d) / 2) ** 2 + b * b, 0));
    const l1 = tr + disc, l2 = Math.max(tr - disc, 0);
    const ang = Math.abs(b) < 1e-12 ? (a >= d ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b);
    this.ellipse(mu, k * Math.sqrt(Math.max(l1, 0)), k * Math.sqrt(l2), ang, o);
  }
  // Soft Gaussian glow (fuzzy blob) — a picture of "maybe it's around here".
  blob(c, sigma, o = {}) {
    const ctx = this.ctx, s = this.toScreen(c), r = Math.max(2, sigma * this.k * 2.5);
    const g = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], r);
    const colr = o.color ?? 'purple';
    g.addColorStop(0, alpha(colr, o.alpha ?? 0.75));
    g.addColorStop(0.45, alpha(colr, (o.alpha ?? 0.75) * 0.35));
    g.addColorStop(1, alpha(colr, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, Math.PI * 2); ctx.fill();
  }
  rect(x, y, w, h, o = {}) {
    this.path([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { close: true, ...o, fill: o.fill, stroke: o.stroke ?? o.fill === undefined });
  }
  // Rounded rect in world coordinates (r in px).
  rrect(x, y, w, h, rpx = 8, o = {}) {
    const ctx = this.ctx; this._style(o);
    const [sx, sy] = this.toScreen([x, y + h]);
    ctx.beginPath(); ctx.roundRect(sx, sy, w * this.k, h * this.k, rpx);
    this._done(o, o.fill !== undefined, o.stroke !== false && o.fill === undefined ? true : !!o.stroke);
  }
  arc(c, r, a0, a1, o = {}) {
    const ctx = this.ctx; this._style(o);
    const s = this.toScreen(c);
    ctx.beginPath();
    ctx.arc(s[0], s[1], r * this.k, this.flip * a0, this.flip * a1, this.flip * (a1 - a0) < 0);
    this._done(o, false, true);
  }
  // Angle wedge (pie slice) to show "how much it turned".
  wedge(c, r, a0, a1, o = {}) {
    const ctx = this.ctx; this._style(o);
    const s = this.toScreen(c);
    ctx.beginPath(); ctx.moveTo(...s);
    ctx.arc(s[0], s[1], r * this.k, this.flip * a0, this.flip * a1, this.flip * (a1 - a0) < 0);
    ctx.closePath();
    ctx.fillStyle = alpha(o.color ?? 'orange', o.alpha ?? 0.25); ctx.globalAlpha = 1; ctx.fill();
    ctx.setLineDash([]);
  }

  // Text (keep it to symbols, numbers, emoji). size in px.
  text(str, p, o = {}) {
    const ctx = this.ctx;
    const s = this.toScreen(p);
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.font = `${o.weight ?? 600} ${o.size ?? 14}px ${o.font ?? 'ui-rounded, "SF Pro Rounded", system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'}`;
    ctx.textAlign = o.align ?? 'center';
    ctx.textBaseline = o.baseline ?? 'middle';
    if (o.halo !== false) { ctx.lineWidth = 4; ctx.strokeStyle = alpha(o.haloColor ?? 'bg', 0.85); ctx.strokeText(str, s[0] + (o.dx ?? 0), s[1] + (o.dy ?? 0)); }
    ctx.fillStyle = col(o.color ?? 'ink');
    ctx.fillText(str, s[0] + (o.dx ?? 0), s[1] + (o.dy ?? 0));
    ctx.restore();
  }
  emoji(ch, p, size = 24, o = {}) { this.text(ch, p, { size, halo: false, weight: 400, ...o }); }

  // Background grid with optional axes.
  grid(o = {}) {
    const [x0, y0, x1, y1] = this.view;
    const step = o.step ?? niceStep((x1 - x0) / 10);
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      ctx.strokeStyle = Math.abs(x) < step / 2 && o.axes !== false ? alpha('muted', 0.55) : col(o.color ?? 'grid');
      const a = this.toScreen([x, y0]), b = this.toScreen([x, y1]);
      ctx.beginPath(); ctx.moveTo(Math.round(a[0]) + 0.5, a[1]); ctx.lineTo(Math.round(b[0]) + 0.5, b[1]); ctx.stroke();
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      ctx.strokeStyle = Math.abs(y) < step / 2 && o.axes !== false ? alpha('muted', 0.55) : col(o.color ?? 'grid');
      const a = this.toScreen([x0, y]), b = this.toScreen([x1, y]);
      ctx.beginPath(); ctx.moveTo(a[0], Math.round(a[1]) + 0.5); ctx.lineTo(b[0], Math.round(b[1]) + 0.5); ctx.stroke();
    }
    ctx.restore();
  }

  // A grid of lines pushed through any map f: R² → R² (shows what a transform DOES to space).
  warpedGrid(f, o = {}) {
    const [x0, y0, x1, y1] = o.range ?? this.bounds;
    const step = o.step ?? 1, n = o.samples ?? 24;
    const colr = o.color ?? 'faint';
    for (let x = Math.ceil(x0 / step) * step; x <= x1 + 1e-9; x += step) {
      const pts = []; for (let i = 0; i <= n; i++) pts.push(f([x, y0 + ((y1 - y0) * i) / n]));
      this.path(pts, { color: Math.abs(x) < 1e-9 ? (o.axisColorY ?? colr) : colr, width: o.width ?? 1.2, alpha: o.alpha ?? 1 });
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1 + 1e-9; y += step) {
      const pts = []; for (let i = 0; i <= n; i++) pts.push(f([x0 + ((x1 - x0) * i) / n, y]));
      this.path(pts, { color: Math.abs(y) < 1e-9 ? (o.axisColorX ?? colr) : colr, width: o.width ?? 1.2, alpha: o.alpha ?? 1 });
    }
  }

  // 2D coordinate frame: red x-arrow, green y-arrow.
  frame(origin, angle = 0, len = 1, o = {}) {
    const c = Math.cos(angle), s = Math.sin(angle);
    this.arrow(origin, [origin[0] + c * len, origin[1] + s * len], { color: o.xColor ?? 'red', width: o.width ?? 3 });
    this.arrow(origin, [origin[0] - s * len, origin[1] + c * len], { color: o.yColor ?? 'green', width: o.width ?? 3 });
    this.dot(origin, o.dot ?? 4, { color: o.color ?? 'ink' });
  }

  // Zig-zag spring between a and b.
  spring(a, b, o = {}) {
    const coils = o.coils ?? 8, w = o.amp ?? this.world(7);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const pts = [a];
    const lead = Math.min(L * 0.15, this.world(10));
    pts.push([a[0] + ux * lead, a[1] + uy * lead]);
    for (let i = 1; i < coils * 2; i++) {
      const t = lead + ((L - 2 * lead) * i) / (coils * 2), side = i % 2 ? 1 : -1;
      pts.push([a[0] + ux * t + nx * w * side, a[1] + uy * t + ny * w * side]);
    }
    pts.push([b[0] - ux * lead, b[1] - uy * lead], b);
    this.path(pts, { color: o.color ?? 'teal', width: o.width ?? 2 });
  }
  // Damper (dashpot) between a and b.
  damper(a, b, o = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, w = this.world(8);
    const m = [a[0] + ux * L * 0.45, a[1] + uy * L * 0.45], m2 = [a[0] + ux * L * 0.6, a[1] + uy * L * 0.6];
    const colr = o.color ?? 'purple';
    this.line(a, m2, { color: colr, width: 2 });
    this.path([[m[0] + nx * w + ux * L * 0.25, m[1] + ny * w + uy * L * 0.25], [m[0] + nx * w, m[1] + ny * w], [m[0] - nx * w, m[1] - ny * w], [m[0] - nx * w + ux * L * 0.25, m[1] - ny * w + uy * L * 0.25]], { color: colr, width: 2 });
    this.line([m2[0] + nx * w * 0.7, m2[1] + ny * w * 0.7], [m2[0] - nx * w * 0.7, m2[1] - ny * w * 0.7], { color: colr, width: 3 });
    this.line([m[0] + ux * L * 0.3, m[1] + uy * L * 0.3], b, { color: colr, width: 2 });
  }

  // A friendly robot arm: points = [base, j1, ..., tip].
  arm(points, o = {}) {
    const ctx = this.ctx;
    const w = o.width ?? 16;
    const colors = o.colors ?? null;
    if (o.base !== false) {
      const b = this.toScreen(points[0]);
      ctx.save();
      ctx.fillStyle = col(o.baseColor ?? 'slate');
      ctx.beginPath(); ctx.moveTo(b[0] - w * 1.4, b[1] + w * 1.1); ctx.lineTo(b[0] + w * 1.4, b[1] + w * 1.1);
      ctx.lineTo(b[0] + w * 0.6, b[1]); ctx.lineTo(b[0] - w * 0.6, b[1]); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < points.length - 1; i++) {
      const A = this.toScreen(points[i]), B = this.toScreen(points[i + 1]);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = o.alpha ?? 1;
      ctx.strokeStyle = C.shadow; ctx.lineWidth = w + 4;
      ctx.beginPath(); ctx.moveTo(A[0] + 2, A[1] + 3); ctx.lineTo(B[0] + 2, B[1] + 3); ctx.stroke();
      ctx.strokeStyle = col(colors ? colors[i] : (o.color ?? 'blue')); ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.stroke();
      ctx.strokeStyle = alpha('white', 0.22); ctx.lineWidth = w * 0.3;
      ctx.beginPath(); ctx.moveTo(A[0], A[1] - w * 0.18); ctx.lineTo(B[0], B[1] - w * 0.18); ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < points.length - 1; i++) {
      const s = this.toScreen(points[i]);
      ctx.save(); ctx.globalAlpha = o.alpha ?? 1;
      ctx.beginPath(); ctx.arc(s[0], s[1], w * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = col(o.jointColor ?? 'orange'); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.bg; ctx.stroke();
      ctx.beginPath(); ctx.arc(s[0], s[1], w * 0.18, 0, Math.PI * 2); ctx.fillStyle = C.bg; ctx.fill();
      ctx.restore();
    }
    if (o.hand !== false) {
      const t = this.toScreen(points[points.length - 1]);
      ctx.save(); ctx.globalAlpha = o.alpha ?? 1;
      ctx.beginPath(); ctx.arc(t[0], t[1], w * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = col(o.handColor ?? 'pink'); ctx.fill();
      ctx.restore();
    }
  }

  // Heat image of a scalar field f(x, y) over the visible area (or o.range).
  // Normalized by o.min/o.max or auto. Cached by a key to avoid recomputing each frame.
  heat(f, o = {}) {
    const [x0, y0, x1, y1] = o.range ?? this.view;
    const res = o.res ?? 90;
    const key = o.cacheKey;
    if (!key || this._heatKey !== key || !this._heatCanvas) {
      const aspect = (y1 - y0) / (x1 - x0);
      const nx = res, ny = Math.max(2, Math.round(res * aspect));
      const vals = new Float64Array(nx * ny);
      let mn = Infinity, mx = -Infinity;
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const v = f(x0 + ((i + 0.5) / nx) * (x1 - x0), y1 - ((j + 0.5) / ny) * (y1 - y0));
          vals[j * nx + i] = v;
          if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
        }
      mn = o.min ?? mn; mx = o.max ?? mx;
      const cv = this._heatCanvas ?? document.createElement('canvas');
      cv.width = nx; cv.height = ny;
      const cx = cv.getContext('2d');
      const img = cx.createImageData(nx, ny);
      for (let k = 0; k < nx * ny; k++) {
        let t = (vals[k] - mn) / (mx - mn || 1);
        if (o.transform) t = o.transform(t);
        const [r, g, b] = cmap(t, o.cmap ?? 'heat');
        img.data[4 * k] = r; img.data[4 * k + 1] = g; img.data[4 * k + 2] = b;
        img.data[4 * k + 3] = Math.round(255 * (o.alphaFn ? o.alphaFn(t) : (o.alpha ?? 1)));
      }
      cx.putImageData(img, 0, 0);
      this._heatCanvas = cv; this._heatKey = key;
    }
    const a = this.toScreen([x0, y1]), b = this.toScreen([x1, y0]);
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = o.smooth !== false;
    ctx.drawImage(this._heatCanvas, a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.restore();
  }

  // Draw a matrix of cells (images, kernels, attention maps). cells[r][c] → value.
  // Placed with top-left at world point tl, each cell `size` world units.
  cells(M, tl, size, o = {}) {
    const vals = M.flat();
    const mn = o.min ?? Math.min(...vals), mx = o.max ?? Math.max(...vals);
    M.forEach((row, r) => row.forEach((v, c) => {
      const t = (v - mn) / (mx - mn || 1);
      const fill = o.colorFn ? o.colorFn(v, t, r, c) : `rgb(${cmap(t, o.cmap ?? 'mono').join(',')})`;
      this.rect(tl[0] + c * size, tl[1] - (r + 1) * size, size, size, { fill, stroke: false });
      if (o.gridColor !== null) this.rect(tl[0] + c * size, tl[1] - (r + 1) * size, size, size, { color: o.gridColor ?? 'bg', width: 1 });
      if (o.values) this.text(o.format ? o.format(v) : String(Math.round(v * 10) / 10), [tl[0] + (c + 0.5) * size, tl[1] - (r + 0.5) * size], { size: o.fontSize ?? 11, color: t > 0.6 ? 'black' : 'white', halo: false });
    }));
  }

  // Plot y = f(x) or an array of [x,y].
  plot(fOrPts, o = {}) {
    let pts = fOrPts;
    if (typeof fOrPts === 'function') {
      const [x0, , x1] = o.range ?? this.view;
      const n = o.samples ?? 200;
      pts = [];
      for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; const y = fOrPts(x); if (Number.isFinite(y)) pts.push([x, y]); }
    }
    if (o.fillTo !== undefined) this.poly([[pts[0][0], o.fillTo], ...pts, [pts[pts.length - 1][0], o.fillTo]], { fill: alpha(o.color ?? 'blue', o.fillAlpha ?? 0.2), stroke: false });
    this.path(pts, { color: o.color ?? 'blue', width: o.width ?? 2.5, dash: o.dash, alpha: o.alpha });
  }
  // A band between lo(x) and hi(x) (uncertainty).
  band(xs, lo, hi, o = {}) {
    const pts = xs.map((x, i) => [x, hi[i]]).concat(xs.map((x, i) => [x, lo[i]]).reverse());
    this.poly(pts, { fill: alpha(o.color ?? 'purple', o.alpha ?? 0.22), stroke: false });
  }
  // Vertical bar (meters: energy, loss, probability). value in world units of height.
  bar(x, y, w, h, o = {}) { this.rrect(x, Math.min(y, y + h), w, Math.abs(h), o.r ?? 4, { fill: col(o.color ?? 'blue'), stroke: false, alpha: o.alpha }); }

  // Little "meter" in pixel space anchored in this pen's rect: icon + fill bar.
  meter(icon, value, max, o = {}) {
    const ctx = this.ctx, r = this.area;
    const i = o.slot ?? 0;
    const x = r.x + 12, y = r.y + 12 + i * 26, W = o.width ?? 110;
    ctx.save();
    ctx.font = '16px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = C.ink;
    ctx.fillText(icon, x, y + 8);
    ctx.fillStyle = alpha('faint', 0.6);
    ctx.beginPath(); ctx.roundRect(x + 26, y + 2, W, 12, 6); ctx.fill();
    const t = Math.max(0, Math.min(1, value / (max || 1)));
    ctx.fillStyle = col(o.color ?? 'teal');
    ctx.beginPath(); ctx.roundRect(x + 26, y + 2, Math.max(W * t, 2), 12, 6); ctx.fill();
    ctx.restore();
  }
}

export function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
