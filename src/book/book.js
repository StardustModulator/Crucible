// 📕 The Book: the page-by-page atlas as a study game.
//   #/book          world map of the 7 days (stars, streak, every page as a tile)
//   #/book/day/N    the day's scenes and pages
//   #/book/p/<pdf>  the ORIGINAL page (rendered from your own copy of the PDF) beside its atoms;
//                   hovering an atom highlights its exact lines on the page.
// The PDF is never shipped: locally it is read from book/source/mls.pdf (gitignored);
// anywhere else you load your own copy (kept in this browser's IndexedDB) or open the
// authors' free official edition.
import { col } from '../viz/palette.js';
import { BY_ID, ISLANDS } from '../graph/concepts.js';

const base = new URL('../../book/', import.meta.url);
const OFFICIAL = 'http://www.cds.caltech.edu/~murray/mlswiki';
let cache = null;

export async function loadBook() {
  if (cache) return cache;
  const get = async (p) => (await fetch(new URL(p, base))).json();
  const [{ parts, built = [] }, { days }, lines] = await Promise.all([get('atlas.json'), get('days.json'), get('lines.json')]);
  const files = await Promise.all(parts.map((id) => get(`atlas/${id}.json`)));
  const pages = new Map(), scenes = new Map(), order = [];
  for (const f of files) {
    for (const s of f.scenes ?? []) { scenes.set(s.id, { ...s, part: f.id, atoms: [] }); order.push(s.id); }
    for (const p of f.pages ?? []) pages.set(p.pdf, { ...p, part: f.id });
  }
  for (const p of pages.values()) for (const a of p.atoms) scenes.get(a.scene)?.atoms.push({ ...a, pdf: p.pdf, book: p.book });
  cache = { files, pages, scenes, order, days, lines: lines.lines, offset: lines.offset, built: new Set(built) };
  return cache;
}
export async function checkBuilt() {} // built list comes from book/atlas.json

// ---------------------------------------------------------------- your progress (this browser only)
const STORE = 'crucible-book-v1';
function progress() {
  try { return JSON.parse(localStorage.getItem(STORE)) ?? { stamps: {} }; } catch { return { stamps: {} }; }
}
function saveProgress(p) { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* private mode */ } }
const today = () => new Date().toISOString().slice(0, 10);
export function streak() {
  const days = new Set(Object.values(progress().stamps));
  let n = 0;
  const d = new Date();
  if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1); // yesterday still counts
  while (days.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export const stampCount = () => Object.keys(progress().stamps).length;

// ---------------------------------------------------------------- helpers
export const KIND = {
  heading: ['🏷️', 'slate'], prose: ['💬', 'blue'], definition: ['📘', 'gold'], proposition: ['💎', 'pink'],
  lemma: ['💎', 'pink'], theorem: ['💎', 'pink'], corollary: ['💎', 'pink'], proof: ['🪜', 'purple'],
  equation: ['🧮', 'orange'], example: ['🧪', 'teal'], figure: ['🖼️', 'lime'], table: ['📊', 'teal'],
  remark: ['💡', 'gold'], algorithm: ['⚙️', 'orange'], exercise: ['🏋️', 'coral'], summary: ['🧾', 'blue'],
  references: ['📚', 'slate'], index: ['🔎', 'slate'], front: ['📕', 'slate'], caption: ['🏷', 'lime'],
  footnote: ['👣', 'slate'], 'page-number': ['#', 'muted'],
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayOf = (book, pdf) => book.days.find((d) => pdf >= d.pdf[0] && pdf <= d.pdf[1]);
const pageLabel = (p) => (p.book ? `p${p.book}` : `pdf ${p.pdf}`);
const DAY_TINT = ['purple', 'teal', 'orange', 'pink', 'gold', 'blue', 'lime'];

// 0 not in atlas · 1 atoms only · 2 some scenes built · 3 every scene built
function pageStatus(book, pdf) {
  const p = book.pages.get(pdf);
  if (!p) return 0;
  const ids = [...new Set(p.atoms.map((a) => a.scene).filter(Boolean))];
  if (!ids.length) return 3;
  const b = ids.filter((id) => book.built.has(id) || BY_ID[id]).length;
  return b === ids.length ? 3 : b ? 2 : 1;
}
function dayStats(book, d) {
  const st = progress().stamps;
  let n = 0, atl = 0, ok = 0, stamped = 0;
  for (let p = d.pdf[0]; p <= d.pdf[1]; p++) { n++; const s = pageStatus(book, p); if (s) atl++; if (s === 3) ok++; if (st[p]) stamped++; }
  // ⭐ atlas complete · ⭐⭐ every scene built · ⭐⭐⭐ you stamped every page
  const stars = (atl === n) + (ok === n) + (stamped === n);
  return { n, atl, ok, stamped, stars };
}

function hud(book) {
  const lines = [...book.pages.keys()].reduce((s, p) => s + book.lines[p - 1], 0);
  return `<div class="hud">
    <span title="pages broken down">📄 <b>${book.pages.size}</b>/474</span>
    <span title="lines covered">〰️ <b>${lines}</b></span>
    <span title="scenes built">🎬 <b>${book.built.size}</b>/${book.scenes.size}</span>
    <span title="pages you can explain">💡 <b>${stampCount()}</b></span>
    <span title="day streak">🔥 <b>${streak()}</b></span></div>`;
}

// ---------------------------------------------------------------- world map
export async function renderBookHome(el) {
  const book = await loadBook();
  const st = progress().stamps;
  const levels = book.days.map((d, i) => {
    const s = dayStats(book, d);
    const stars = [0, 1, 2].map((k) => `<span class="${k < s.stars ? '' : 'off'}">⭐</span>`).join('');
    return `<a class="level ${s.stars === 3 ? 'done' : ''}" href="#/book/day/${d.day}" style="--tint:${col(DAY_TINT[i])}">
      <span class="orb">${d.icon}<span class="num">${d.day}</span></span>
      <span class="stars">${stars}</span>
      <span class="meter" title="pages fully built"><i style="width:${(100 * s.ok) / s.n}%"></i></span>
      <span class="lt">${esc(d.theme)}</span><span class="lp">${esc(d.parts)}</span></a>`;
  }).join('');
  const partRow = (f) => {
    const tiles = [];
    for (let p = f.pdfPages[0]; p <= f.pdfPages[1]; p++) {
      const pg = book.pages.get(p);
      tiles.push(`<a class="ptile s${pageStatus(book, p)} ${st[p] ? 'stamped' : ''}" href="#/book/p/${p}" title="${pg ? pageLabel(pg) : 'pdf ' + p}">${pg?.book ?? ''}</a>`);
    }
    return `<div class="part"><h3><span>${esc(f.title)}</span><em>🎬 ${f.scenes?.length ?? 0} · 🧩 ${f.pages.reduce((s, p) => s + p.atoms.length, 0)}</em></h3><div class="ptiles">${tiles.join('')}</div></div>`;
  };
  el.innerHTML = `
    <section class="book-hero">
      <h2><span class="cover">📕</span><span>The Book<small>A Mathematical Introduction to Robotic Manipulation · 7 days · every line</small></span></h2>
      ${hud(book)}
    </section>
    <section class="world">
      <svg class="trail" preserveAspectRatio="none" viewBox="0 0 700 300"><path d="M50 200 C 110 80, 150 80, 150 120 S 200 230, 250 200 S 320 70, 350 120 S 410 230, 450 200 S 520 70, 550 120 S 610 230, 650 200"
        fill="none" stroke="${col('gold')}" stroke-opacity=".55" stroke-width="5" stroke-dasharray="2 14" stroke-linecap="round"/></svg>
      <div class="levels">${levels}</div>
    </section>
    <div class="tile-key"><span><i class="ptile s0"></i>⬜</span><span><i class="ptile s1"></i>🧩</span><span><i class="ptile s2"></i>🧱</span><span><i class="ptile s3"></i>✅</span><span><i class="ptile s3 stamped"></i>💡</span></div>
    <section class="parts">${book.files.map(partRow).join('')}</section>`;
}

// ---------------------------------------------------------------- one day
export async function renderBookDay(el, n) {
  const book = await loadBook();
  const d = book.days.find((x) => x.day === n);
  if (!d) { el.innerHTML = ''; return; }
  const st = progress().stamps;
  const sceneIds = new Set();
  for (let p = d.pdf[0]; p <= d.pdf[1]; p++) for (const a of book.pages.get(p)?.atoms ?? []) if (a.scene) sceneIds.add(a.scene);
  const s = dayStats(book, d);
  const pages = [];
  for (let p = d.pdf[0]; p <= d.pdf[1]; p++) {
    const pg = book.pages.get(p);
    pages.push(`<a class="day-page s${pageStatus(book, p)}" href="#/book/p/${p}"><b><span>${pg ? pageLabel(pg) : 'pdf ' + p}</span><span>${st[p] ? '💡' : ''}</span></b><span>${esc(pg?.summary ?? '')}</span></a>`);
  }
  el.innerHTML = `
    <section class="day-head">
      <h2 class="day-title"><span class="badge" style="background:${col(DAY_TINT[n - 1])}">${d.icon}</span><span>${d.day} · ${esc(d.theme)}<br><em>${esc(d.parts)} · ${'⭐'.repeat(s.stars)}${'☆'.repeat(3 - s.stars)} · 💡 ${s.stamped}/${s.n}</em></span></h2>
      <div class="day-nav">${n > 1 ? `<a class="ui-btn" href="#/book/day/${n - 1}" aria-label="previous day">◀</a>` : ''}<a class="ui-btn" href="#/book" aria-label="world map">🗺️</a>${n < 7 ? `<a class="ui-btn" href="#/book/day/${n + 1}" aria-label="next day">▶</a>` : ''}
      <a class="ui-btn cta" href="#/book/p/${d.pdf[0]}">▶ 📄</a></div>
    </section>
    <div class="chips">${[...sceneIds].map((id) => sceneChip(book, id)).join('')}</div>
    <section class="day-pages">${pages.join('')}</section>`;
}

function sceneChip(book, id) {
  const s = book.scenes.get(id) ?? (BY_ID[id] && { title: BY_ID[id].name, icon: BY_ID[id].icon });
  if (!s) return '';
  const ok = book.built.has(id) || BY_ID[id];
  return `<a class="chip ${ok ? '' : 'todo'}" href="#/s/${id}" style="--tint:${col(ok ? 'lime' : 'faint')}"><span>${s.icon}</span><em>${esc(s.title)}</em></a>`;
}

// ---------------------------------------------------------------- one page
export async function renderBookPage(el, pdf) {
  const book = await loadBook();
  const p = book.pages.get(pdf);
  const d = dayOf(book, pdf);
  const st = progress().stamps;
  const nav = `<div class="day-nav">${pdf > 1 ? `<a class="ui-btn" href="#/book/p/${pdf - 1}" aria-label="previous page">◀</a>` : ''}<a class="ui-btn" href="#/book/day/${d?.day ?? 1}" aria-label="day">${d?.icon ?? '📕'}</a>${pdf < 474 ? `<a class="ui-btn" href="#/book/p/${pdf + 1}" aria-label="next page">▶</a>` : ''}
    <button class="ui-btn stamp-btn ${st[pdf] ? 'on' : ''}" title="I can explain this page" aria-label="I can explain this page" style="--tint:${col('gold')}">💡 ${st[pdf] ? '✔' : ''}</button></div>`;
  const title = p ? (p.book ? `📄 ${p.book}` : `📕 pdf ${pdf}`) : `📄 pdf ${pdf}`;
  const atoms = (p?.atoms ?? []).map((a, i) => {
    const [ic, c] = KIND[a.kind] ?? ['•', 'muted'];
    const s = a.scene ? book.scenes.get(a.scene) : null;
    const beatIdx = s ? s.beats.indexOf(a.beat) : -1;
    const ok = a.scene && (book.built.has(a.scene) || BY_ID[a.scene]);
    const go = a.scene ? `<a class="go ${ok ? '' : 'todo'}" href="#/s/${a.scene}${beatIdx >= 0 ? `?beat=${beatIdx}` : ''}">${ok ? '▶' : '🚧'} ${s?.icon ?? BY_ID[a.scene]?.icon ?? '🎬'} ${esc(a.beat ?? '')}</a>` : '';
    const math = (a.math ?? []).map((m) => BY_ID[m] && `<a class="mini" href="#/s/${m}" title="${esc(BY_ID[m].name)}" style="--tint:${col(ISLANDS[BY_ID[m].island].color)}">${BY_ID[m].icon}</a>`).join('');
    return `<article class="atom" data-i="${i}" style="--c:${col(c)}">
      <header><span class="k">${ic}</span><span class="ln">L${a.lines.join('–')}</span>${a.label ? `<span class="lb">${esc(a.label)}</span>` : ''}<span class="d">${'●'.repeat(a.difficulty ?? 0)}</span>${math}</header>
      ${a.feynman ? `<p class="fey">${esc(a.feynman)}</p>` : ''}
      <p class="idea">${esc(a.idea)}</p>
      ${a.visual ? `<details><summary>🎨 ⋯</summary><p>${esc(a.visual)}</p></details>` : ''}
      ${go}</article>`;
  }).join('');
  el.innerHTML = `
    <section class="day-head"><h2 class="day-title"><span>${title} <em>${p ? `§${esc(p.section ?? '–')} · ${p.lines} 〰️` : '🧩'}</em></span></h2>${nav}</section>
    ${p?.summary ? `<p class="page-sum">${esc(p.summary)}</p>` : ''}
    <section class="page-view">
      <div class="original">
        <div class="bar">
          <button class="ui-btn" id="pdf-load" title="load your copy of the book" aria-label="load your copy of the book">📥</button>
          <a class="ui-btn" href="${OFFICIAL}" target="_blank" rel="noopener" title="the authors' free official edition" aria-label="official edition">🔗</a>
          <input type="file" accept="application/pdf" id="pdf-file" hidden>
        </div>
        <div class="paper"><div class="ghost"><span class="big">📖</span></div><div class="band"></div></div>
        ${p?.atoms?.length ? `<div class="sil">${p.atoms.map((a, i) => `<div class="sil-atom" data-i="${i}" style="--c:${col((KIND[a.kind] ?? [0, 'muted'])[1])}">${Array.from({ length: a.lines[1] - a.lines[0] + 1 }, () => '<i></i>').join('')}</div>`).join('')}</div>` : ''}
      </div>
      <div class="atoms">${atoms || '<div class="scene-msg" style="position:relative;min-height:240px"><span class="big">🧩</span></div>'}</div>
    </section>`;

  // 🧠 stamp: "I can explain this page" (the Feynman self-test)
  el.querySelector('.stamp-btn').onclick = (e) => {
    const pr = progress();
    if (pr.stamps[pdf]) delete pr.stamps[pdf]; else pr.stamps[pdf] = today();
    saveProgress(pr);
    const on = !!pr.stamps[pdf];
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.innerHTML = `💡 ${on ? '✔' : ''}`;
    if (on) { const s = document.createElement('div'); s.className = 'stamp go'; s.textContent = '💡 GOT IT!'; document.body.appendChild(s); setTimeout(() => s.remove(), 1200); }
  };

  // The original page + line highlighting.
  const paper = el.querySelector('.paper'), band = el.querySelector('.band');
  let lineBoxes = null; // [{top, bottom}] in % of page height, one per detected text line
  const showBand = (i) => {
    const a = p?.atoms?.[i];
    if (!a || !lineBoxes?.length) { band.classList.remove('on'); return; }
    const n = p.lines, m = lineBoxes.length;
    const map = (k) => Math.min(m - 1, Math.max(0, Math.round(((k - 1) * (m - 1)) / Math.max(n - 1, 1))));
    const t = lineBoxes[map(a.lines[0])].top, b = lineBoxes[map(a.lines[1])].bottom;
    band.style.top = `${t - 0.6}%`; band.style.height = `${b - t + 1.2}%`;
    band.style.setProperty('--c', col((KIND[a.kind] ?? [0, 'gold'])[1]));
    band.classList.add('on');
  };
  const hl = (i, on) => {
    el.querySelectorAll(`[data-i="${i}"]`).forEach((x) => x.classList.toggle('hl', on));
    if (on) showBand(i); else band.classList.remove('on');
  };
  el.querySelectorAll('[data-i]').forEach((x) => {
    x.addEventListener('mouseenter', () => hl(x.dataset.i, true));
    x.addEventListener('mouseleave', () => hl(x.dataset.i, false));
    x.addEventListener('click', () => { if (x.classList.contains('sil-atom')) el.querySelector(`.atom[data-i="${x.dataset.i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  });
  const fileInput = el.querySelector('#pdf-file');
  el.querySelector('#pdf-load').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    await idbPut(buf.slice(0));
    pdfDoc = null;
    lineBoxes = await drawOriginal(paper, pdf, buf);
  };
  lineBoxes = await drawOriginal(paper, pdf);
}

// ---------------------------------------------------------------- PDF rendering (your own copy)
let pdfDoc = null;
async function pdfjs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/pdfjs/pdf.min.js', import.meta.url).href; // vendored: works offline
    s.onload = ok; s.onerror = bad; document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
  return window.pdfjsLib;
}
async function openDoc(buf = null) {
  if (pdfDoc && !buf) return pdfDoc;
  const lib = await pdfjs();
  let data = buf ?? await idbGet();
  if (!data && ['localhost', '127.0.0.1', ''].includes(location.hostname)) {
    try { const r = await fetch(new URL('source/mls.pdf', base)); if (r.ok) data = await r.arrayBuffer(); } catch { /* no local copy */ }
  }
  if (!data) return null;
  pdfDoc = await lib.getDocument({ data: new Uint8Array(data) }).promise;
  return pdfDoc;
}
async function drawOriginal(paper, pdf, buf = null) {
  let doc;
  try { doc = await openDoc(buf); } catch (e) { console.warn('pdf', e); doc = null; }
  if (!doc) return null; // ghost stays: 📥 load your copy · 🔗 official edition
  const page = await doc.getPage(pdf);
  const w = paper.clientWidth || 500;
  const vp1 = page.getViewport({ scale: 1 });
  const scale = (w / vp1.width) * Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  paper.querySelector('.ghost')?.remove();
  paper.querySelector('canvas')?.remove();
  paper.prepend(canvas);
  // Detect text lines (cluster glyph runs by baseline) to place highlight bands.
  const tc = await page.getTextContent();
  const rows = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 8;
    const row = rows.find((r) => Math.abs(r.y - y) < 2.2);
    if (row) { row.top = Math.max(row.top, y + h); row.bot = Math.min(row.bot, y); } else rows.push({ y, top: y + h, bot: y });
  }
  rows.sort((a, b) => b.y - a.y);
  const H = vp1.height;
  return rows.map((r) => ({ top: (100 * (H - r.top)) / H, bottom: (100 * (H - r.bot)) / H }));
}

// tiny IndexedDB wrapper for the user's own PDF copy
function idb() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open('crucible', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  });
}
async function idbGet() {
  try { const db = await idb(); return await new Promise((ok) => { const q = db.transaction('files').objectStore('files').get('mls.pdf'); q.onsuccess = () => ok(q.result ?? null); q.onerror = () => ok(null); }); }
  catch { return null; }
}
async function idbPut(buf) {
  try { const db = await idb(); await new Promise((ok) => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').put(buf, 'mls.pdf'); t.oncomplete = ok; t.onerror = ok; }); }
  catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------- scene headers for mls-* scenes
export async function bookSceneMeta(id) {
  const book = await loadBook();
  const s = book.scenes.get(id);
  if (!s) return null;
  const i = book.order.indexOf(id);
  const pages = [...new Set(s.atoms.map((a) => a.pdf))].sort((a, b) => a - b);
  return {
    ...s, prev: book.order[(i - 1 + book.order.length) % book.order.length], next: book.order[(i + 1) % book.order.length],
    pageLinks: pages.map((pdf) => ({ pdf, label: book.pages.get(pdf)?.book ?? `pdf ${pdf}` })),
    neighborTitle: (x) => book.scenes.get(x)?.title ?? x,
  };
}
