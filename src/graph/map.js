// The constellation map: Math Core in the middle, four islands around it,
// glowing threads from every algorithm back to the math it is made of.
import { CONCEPTS, ISLANDS, BY_ID, ancestry, dependents } from './concepts.js';
import { C, col, alpha } from '../viz/palette.js';

export function layoutMap(stage) {
  const W = stage.width, H = stage.height;
  const cx = W / 2, cy = H / 2;
  const m = Math.min(W, H);
  const nodeR = Math.max(11, Math.min(21, m * 0.028));
  const nodes = [];
  const math = CONCEPTS.filter((c) => c.island === 'math');
  const ringR = Math.min(W * 0.2, H * 0.24, m * 0.27);
  // Math core: two concentric rings so 23 nodes don't crowd.
  const inner = math.slice(0, 9), outer = math.slice(9);
  inner.forEach((c, i) => nodes.push({ ...c, x: cx + Math.cos((i / inner.length) * 2 * Math.PI - Math.PI / 2) * ringR * 0.48, y: cy + Math.sin((i / inner.length) * 2 * Math.PI - Math.PI / 2) * ringR * 0.48, r: nodeR }));
  outer.forEach((c, i) => nodes.push({ ...c, x: cx + Math.cos((i / outer.length) * 2 * Math.PI - Math.PI / 2 + 0.1) * ringR, y: cy + Math.sin((i / outer.length) * 2 * Math.PI - Math.PI / 2 + 0.1) * ringR, r: nodeR }));
  const islands = {};
  for (const [k, isl] of Object.entries(ISLANDS)) {
    if (k === 'math') { islands[k] = { x: cx, y: cy, R: ringR + nodeR * 1.8 }; continue; }
    const members = CONCEPTS.filter((c) => c.island === k);
    const ix = cx + Math.cos(isl.angle) * W * 0.335, iy = cy + Math.sin(isl.angle) * H * 0.33;
    // Sunflower packing around the island center.
    const spacing = nodeR * 2.35;
    let maxR = 0;
    members.forEach((c, i) => {
      const a = i * 2.39996, rr = spacing * Math.sqrt(i + 0.6) * 0.82;
      const x = ix + Math.cos(a) * rr * (W > H ? 1.15 : 0.95), y = iy + Math.sin(a) * rr * (W > H ? 0.88 : 1.05);
      maxR = Math.max(maxR, Math.hypot(x - ix, y - iy));
      nodes.push({ ...c, x, y, r: nodeR });
    });
    islands[k] = { x: ix, y: iy, R: maxR + nodeR * 1.6 };
  }
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const n of nodes) {
    for (const u of n.uses) if (byId[u]) edges.push({ a: byId[u], b: n, kind: 'uses' });
    for (const v of n.next) if (byId[v]) edges.push({ a: n, b: byId[v], kind: 'next' });
  }
  return { nodes, edges, islands, byId, W, H, cx, cy, nodeR };
}

function curve(ctx, a, b, cx, cy, bend = 0.25) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const qx = mx + (cx - mx) * bend, qy = my + (cy - my) * bend;
  ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(qx, qy, b.x, b.y);
  return [qx, qy];
}
const qpt = (a, q, b, t) => [(1 - t) ** 2 * a.x + 2 * (1 - t) * t * q[0] + t * t * b.x, (1 - t) ** 2 * a.y + 2 * (1 - t) * t * q[1] + t * t * b.y];

export function drawMap(stage, L, st) {
  const ctx = stage.ctx;
  const focus = st.hover;
  let lit = null;
  if (focus) {
    lit = new Set([focus.id, ...ancestry(focus.id), ...dependents(focus.id).map((d) => d.id)]);
  }
  // island halos
  for (const [k, isl] of Object.entries(ISLANDS)) {
    const I = L.islands[k];
    const g = ctx.createRadialGradient(I.x, I.y, I.R * 0.2, I.x, I.y, I.R * 1.15);
    g.addColorStop(0, alpha(isl.color, 0.13)); g.addColorStop(1, alpha(isl.color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(I.x, I.y, I.R * 1.15, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.font = `700 ${Math.round(L.nodeR * 0.95)}px ui-rounded, system-ui, "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = alpha(isl.color, 0.95);
    const ly = k === 'math' ? I.y : (I.y < L.cy ? I.y - I.R - 4 : I.y + I.R + 6);
    if (k === 'math') {
      ctx.font = `${Math.round(L.nodeR * 1.7)}px system-ui, "Apple Color Emoji", sans-serif`;
      ctx.fillText(isl.icon, I.x, ly);
    } else {
      ctx.fillText(`${isl.icon} ${isl.name}`, I.x, Math.max(14, Math.min(L.H - 12, ly)));
    }
    ctx.restore();
  }
  // threads
  ctx.save();
  for (const e of L.edges) {
    // Lit = the focused concept's whole family tree: all math beneath it + what it feeds.
    const on = lit && lit.has(e.a.id) && lit.has(e.b.id);
    const colr = ISLANDS[e.b.island].color;
    ctx.beginPath();
    const q = curve(ctx, e.a, e.b, L.cx, L.cy, e.kind === 'next' ? -0.15 : 0.3);
    ctx.lineWidth = on ? 2.4 : 1;
    ctx.strokeStyle = on ? alpha(colr, 0.95) : alpha(colr, lit ? 0.04 : 0.13);
    ctx.setLineDash(e.kind === 'next' ? [4, 5] : []);
    ctx.stroke();
    if (on) {
      // sparks flow from the math (a) into the algorithm (b)
      for (let k = 0; k < 3; k++) {
        const t = ((st.t * 0.45 + k / 3) % 1);
        const [x, y] = qpt(e.a, q, e.b, t);
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fillStyle = col(colr); ctx.fill();
      }
    }
  }
  ctx.restore();
  // nodes
  const showNames = L.W > 980 && L.H > 560;
  for (const n of L.nodes) {
    const isl = ISLANDS[n.island];
    const dim = lit && !lit.has(n.id);
    const hov = focus && focus.id === n.id;
    const r = n.r * (hov ? 1.3 : 1) * (1 + (hov ? 0.04 * Math.sin(st.t * 5) : 0));
    ctx.save();
    ctx.globalAlpha = dim ? 0.22 : 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = C.panel; ctx.fill();
    ctx.lineWidth = hov ? 3.5 : 2; ctx.strokeStyle = col(isl.color); ctx.stroke();
    ctx.font = `${Math.round(r * 1.05)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n.icon, n.x, n.y + 1);
    if (showNames || hov || (lit && lit.has(n.id))) {
      ctx.font = `600 ${hov ? 14 : 11}px ui-rounded, system-ui, sans-serif`;
      ctx.lineWidth = 3.5; ctx.strokeStyle = alpha('bg', 0.9);
      ctx.strokeText(n.name, n.x, n.y + r + 10);
      ctx.fillStyle = hov ? col(isl.color) : C.muted;
      ctx.fillText(n.name, n.x, n.y + r + 10);
    }
    ctx.restore();
  }
}

export { BY_ID };
