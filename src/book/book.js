// The Book: loads the page-by-page atlas (book/atlas/*.json) and renders the
// study views — 7-day plan, page tiles, and per-page atoms that link into scenes.
import { col } from '../viz/palette.js';
import { BY_ID, ISLANDS } from '../graph/concepts.js';

const base = new URL('../../book/', import.meta.url);
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
  cache = { files, pages, scenes, order, days, lines: lines.lines, offset: lines.offset, built: new Map(order.map((id) => [id, built.includes(id)])) };
  return cache;
}

// Which scenes exist is recorded in book/atlas.json by scripts/book-manifest.mjs.
export async function checkBuilt() {}

export const KIND = {
  heading: ['🏷️', 'slate'], prose: ['💬', 'blue'], definition: ['📘', 'gold'], proposition: ['💎', 'pink'],
  lemma: ['💎', 'pink'], theorem: ['💎', 'pink'], corollary: ['💎', 'pink'], proof: ['🪜', 'purple'],
  equation: ['🧮', 'orange'], example: ['🧪', 'teal'], figure: ['🖼️', 'lime'], table: ['📊', 'teal'],
  remark: ['💡', 'gold'], algorithm: ['⚙️', 'orange'], exercise: ['🏋️', 'coral'], summary: ['🧾', 'blue'],
  references: ['📚', 'slate'], index: ['🔎', 'slate'], front: ['📕', 'slate'], caption: ['🏷', 'lime'],
  footnote: ['👣', 'slate'], 'page-number': ['#', 'faint'],
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayOf = (book, pdf) => book.days.find((d) => pdf >= d.pdf[0] && pdf <= d.pdf[1]);
const pageLabel = (p) => (p.book ? `p${p.book}` : `pdf ${p.pdf}`);

// Status of a page: 0 not in atlas · 1 atlas only · 2 some scenes built · 3 all scenes built
function pageStatus(book, pdf) {
  const p = book.pages.get(pdf);
  if (!p) return 0;
  const ids = [...new Set(p.atoms.map((a) => a.scene).filter(Boolean))];
  if (!ids.length) return 3;
  const b = ids.filter((id) => book.built.get(id) || BY_ID[id]).length;
  return b === ids.length ? 3 : b ? 2 : 1;
}

export async function renderBookHome(el) {
  const book = await loadBook();
  await checkBuilt(book, book.order);
  const dayCard = (d) => {
    let n = 0, ok = 0, atl = 0;
    for (let p = d.pdf[0]; p <= d.pdf[1]; p++) { n++; const s = pageStatus(book, p); if (s) atl++; if (s === 3) ok++; }
    return `<a class="day-card" href="#/book/day/${d.day}" style="--tint:${col('gold')}">
      <span class="dn">${d.icon}<b>${d.day}</b></span>
      <span class="dbar"><i style="width:${(100 * atl) / n}%" class="atl"></i><i style="width:${(100 * ok) / n}%" class="ok"></i></span>
      <span class="dt">${esc(d.theme)}</span><span class="dp">${esc(d.parts)}</span></a>`;
  };
  const partRow = (f) => {
    const tiles = [];
    for (let p = f.pdfPages[0]; p <= f.pdfPages[1]; p++) {
      const pg = book.pages.get(p);
      tiles.push(`<a class="ptile s${pageStatus(book, p)}" href="#/book/p/${p}" title="${pg ? pageLabel(pg) : 'pdf ' + p}"><span>${pg?.book ?? ''}</span></a>`);
    }
    return `<div class="part"><h3>${esc(f.title)} <em>${f.scenes?.length ?? 0} 🎬 · ${f.pages.reduce((s, p) => s + p.atoms.length, 0)} 🧩</em></h3><div class="ptiles">${tiles.join('')}</div></div>`;
  };
  const totalAtoms = [...book.pages.values()].reduce((s, p) => s + p.atoms.length, 0);
  const lines = [...book.pages.keys()].reduce((s, p) => s + book.lines[p - 1], 0);
  el.innerHTML = `
    <section class="book-head">
      <div class="book-stats"><span>📄 <b>${book.pages.size}</b>/474</span><span>〰️ <b>${lines}</b>/${book.lines.reduce((a, b) => a + b, 0)}</span><span>🧩 <b>${totalAtoms}</b></span><span>🎬 <b>${[...book.built.values()].filter(Boolean).length}</b>/${book.scenes.size}</span></div>
      <div class="days">${book.days.map(dayCard).join('')}</div>
      <div class="tile-key"><span><i class="ptile s0"></i>⬜</span><span><i class="ptile s1"></i>🧩</span><span><i class="ptile s2"></i>🧱…</span><span><i class="ptile s3"></i>✅</span></div>
    </section>
    <section class="parts">${book.files.map(partRow).join('') || '<div class="scene-msg"><span class="big">🧩</span></div>'}</section>`;
}

export async function renderBookDay(el, n) {
  const book = await loadBook();
  const d = book.days.find((x) => x.day === n);
  if (!d) { el.innerHTML = ''; return; }
  const sceneIds = new Set();
  for (let p = d.pdf[0]; p <= d.pdf[1]; p++) for (const a of book.pages.get(p)?.atoms ?? []) if (a.scene) sceneIds.add(a.scene);
  await checkBuilt(book, [...sceneIds]);
  const cards = [...sceneIds].map((id) => sceneChip(book, id)).join('');
  const pages = [];
  for (let p = d.pdf[0]; p <= d.pdf[1]; p++) {
    const pg = book.pages.get(p);
    pages.push(`<a class="day-page s${pageStatus(book, p)}" href="#/book/p/${p}"><b>${pg ? pageLabel(pg) : 'pdf ' + p}</b><span>${esc(pg?.summary ?? '')}</span></a>`);
  }
  el.innerHTML = `
    <section class="book-head"><h2 class="day-title">${d.icon} ${d.day} · ${esc(d.theme)}</h2>
      <div class="day-nav">${n > 1 ? `<a class="ui-btn" href="#/book/day/${n - 1}">◀</a>` : ''}<a class="ui-btn" href="#/book">📕</a>${n < 7 ? `<a class="ui-btn" href="#/book/day/${n + 1}">▶</a>` : ''}</div>
      <div class="chips">${cards}</div></section>
    <section class="day-pages">${pages.join('')}</section>`;
}

function sceneChip(book, id) {
  const s = book.scenes.get(id) ?? (BY_ID[id] && { title: BY_ID[id].name, icon: BY_ID[id].icon });
  if (!s) return '';
  const ok = book.built.get(id) || BY_ID[id];
  return `<a class="chip ${ok ? '' : 'todo'}" href="#/s/${id}" style="--tint:${col(ok ? 'lime' : 'faint')}"><span>${s.icon}</span><em>${esc(s.title)}</em></a>`;
}

export async function renderBookPage(el, pdf) {
  const book = await loadBook();
  const p = book.pages.get(pdf);
  const d = dayOf(book, pdf);
  const nav = `<div class="day-nav">${pdf > 1 ? `<a class="ui-btn" href="#/book/p/${pdf - 1}">◀</a>` : ''}<a class="ui-btn" href="#/book/day/${d?.day ?? 1}">${d?.icon ?? '📕'}</a>${pdf < 474 ? `<a class="ui-btn" href="#/book/p/${pdf + 1}">▶</a>` : ''}</div>`;
  if (!p) { el.innerHTML = `<section class="book-head"><h2 class="day-title">pdf ${pdf}</h2>${nav}</section><div class="scene-msg" style="position:relative;min-height:300px"><span class="big">🧩</span></div>`; return; }
  await checkBuilt(book, [...new Set(p.atoms.map((a) => a.scene).filter(Boolean))]);
  // A silhouette of the page: one bar per line, colored by the atom that owns it.
  const sil = p.atoms.map((a, i) => {
    const [ic, c] = KIND[a.kind] ?? ['•', 'muted'];
    const n = a.lines[1] - a.lines[0] + 1;
    return `<div class="sil-atom" data-i="${i}" style="--c:${col(c)};flex:${n}" title="L${a.lines.join('–')} ${a.kind}">${Array.from({ length: n }, () => '<i></i>').join('')}</div>`;
    void ic;
  }).join('');
  const atoms = p.atoms.map((a, i) => {
    const [ic, c] = KIND[a.kind] ?? ['•', 'muted'];
    const s = a.scene ? book.scenes.get(a.scene) : null;
    const beatIdx = s ? s.beats.indexOf(a.beat) : -1;
    const ok = a.scene && (book.built.get(a.scene) || BY_ID[a.scene]);
    const go = a.scene ? `<a class="go ${ok ? '' : 'todo'}" href="#/s/${a.scene}${beatIdx >= 0 ? `?beat=${beatIdx}` : ''}">${s?.icon ?? BY_ID[a.scene]?.icon ?? '🎬'} ${esc(a.beat ?? '')}</a>` : '';
    const math = (a.math ?? []).map((m) => BY_ID[m] && `<a class="mini" href="#/s/${m}" title="${esc(BY_ID[m].name)}" style="--tint:${col(ISLANDS[BY_ID[m].island].color)}">${BY_ID[m].icon}</a>`).join('');
    return `<article class="atom" data-i="${i}" style="--c:${col(c)}">
      <header><span class="k">${ic}</span><span class="ln">L${a.lines.join('–')}</span>${a.label ? `<span class="lb">${esc(a.label)}</span>` : ''}<span class="d">${'●'.repeat(a.difficulty ?? 0)}</span>${math}</header>
      ${a.feynman ? `<p class="fey">${esc(a.feynman)}</p>` : ''}
      <p class="idea">${esc(a.idea)}</p>
      ${a.visual ? `<details><summary>🎨</summary><p>${esc(a.visual)}</p></details>` : ''}
      ${go}</article>`;
  }).join('');
  el.innerHTML = `
    <section class="book-head"><h2 class="day-title">${p.book ? `📄 ${p.book}` : `📕 pdf ${pdf}`} <em>§${esc(p.section ?? '–')}</em></h2>${nav}
      <p class="page-sum">${esc(p.summary ?? '')}</p></section>
    <section class="page-view"><div class="sil">${sil || '<div class="sil-blank"></div>'}</div><div class="atoms">${atoms}</div></section>`;
  const hl = (i, on) => el.querySelectorAll(`[data-i="${i}"]`).forEach((x) => x.classList.toggle('hl', on));
  el.querySelectorAll('[data-i]').forEach((x) => {
    x.addEventListener('mouseenter', () => hl(x.dataset.i, true));
    x.addEventListener('mouseleave', () => hl(x.dataset.i, false));
    if (x.classList.contains('sil-atom')) x.addEventListener('click', () => el.querySelector(`.atom[data-i="${x.dataset.i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  });
}

// Scene-page metadata for mls-* scenes (header chips, neighbours, page links).
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
