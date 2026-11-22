// App shell: hash router, the concept map, and the scene runner.
import { C, setTheme, themeName, col, alpha } from './viz/palette.js';
import { Stage } from './viz/stage.js';
import { UI } from './viz/ui.js';
import { CONCEPTS, ISLANDS, BY_ID, dependents, bridge, ancestry } from './graph/concepts.js';
import { drawMap, layoutMap } from './graph/map.js';
import { renderBookHome, renderBookDay, renderBookPage, bookSceneMeta } from './book/book.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');

let current = null; // { stage, ui, dispose }

try { setTheme(localStorage.getItem('crucible-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')); }
catch { setTheme('dark'); }

function toggleTheme() {
  setTheme(themeName === 'dark' ? 'light' : 'dark');
  try { localStorage.setItem('crucible-theme', themeName); } catch { /* private mode */ }
  current?.stage?.wake();
  current?.repaint?.();
}

function teardown() {
  if (!current) return;
  try { current.dispose?.(); } catch (e) { console.error(e); }
  current.stage?.dispose();
  current = null;
}

// ---------------------------------------------------------------- legend
const LEGEND = [
  ['orange', '🦴'], ['pink', '✋'], ['gold', '🎯'], ['teal', '📡'], ['blue', '🧠'],
  ['purple', '🌫️'], ['lime', '✅'], ['coral', '💥'], ['slate', '🧱'],
  ['red', 'x'], ['green', 'y'], ['blue', 'z'],
];
function legendHTML() {
  return `<div class="legend" role="list">${LEGEND.map(([c, i]) =>
    `<span class="sw" role="listitem" style="--c:${col(c)}"><i></i>${i}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- map page
function topbar(extra = '') {
  return `
    <header class="topbar">
      <a class="brand" href="#/" aria-label="home">⚗️ <b>Crucible</b></a>
      <div class="spacer"></div>
      ${extra}
      <button class="ui-btn" id="legend-btn" title="color language" aria-label="color language">🎨</button>
      <button class="ui-btn" id="theme-btn" title="light / dark" aria-label="light / dark">🌓</button>
    </header>
    <div class="legend-pop" hidden>${legendHTML()}</div>`;
}
function wireTopbar() {
  $('#theme-btn').onclick = toggleTheme;
  $('#legend-btn').onclick = () => { const p = $('.legend-pop'); p.hidden = !p.hidden; };
}

function renderMap(preset = null) {
  teardown();
  document.title = 'Crucible';
  app.innerHTML = `
    ${topbar(`
      <button class="ui-btn" id="bridge-btn" title="connect two ideas" aria-label="connect two ideas" style="--tint:${col('gold')}">🔗</button>
      <a class="ui-btn" href="#/web" title="math × algorithm grid" aria-label="math × algorithm grid">▦</a>
      <a class="ui-btn" href="#/book" title="the textbook" aria-label="the textbook">📕</a>`)}
    <section class="map-wrap"><div class="map-stage"></div></section>
    <nav class="bridge-strip" hidden></nav>
    <section class="shelves">${Object.entries(ISLANDS).map(([k, isl]) => `
      <div class="shelf" style="--tint:${col(isl.color)}">
        <h2><span>${isl.icon}</span>${isl.name}</h2>
        <div class="cards">${CONCEPTS.filter((c) => c.island === k).map((c) => `
          <a class="card" href="#/s/${c.id}" data-id="${c.id}"><span class="ic">${c.icon}</span><span class="nm">${c.name}</span></a>`).join('')}
        </div>
      </div>`).join('')}
    </section>`;
  wireTopbar();

  const stage = new Stage($('.map-stage'));
  const st = { hover: null, t: 0, bridgeMode: false, a: null, b: null, path: null };
  let layout = layoutMap(stage);
  stage.ro.disconnect();
  stage.ro = new ResizeObserver(() => { stage._resize(); layout = layoutMap(stage); });
  stage.ro.observe($('.map-stage'));
  const strip = $('.bridge-strip');
  const bridgeBtn = $('#bridge-btn');
  const setBridge = (on) => {
    st.bridgeMode = on; bridgeBtn.classList.toggle('on', on);
    if (!on) { st.a = st.b = st.path = null; }
    renderStrip();
  };
  const renderStrip = () => {
    strip.hidden = !st.bridgeMode;
    if (!st.bridgeMode) return;
    const slot = (id) => (id ? chip(BY_ID[id]) : '<span class="chip ghost"><span>❔</span></span>');
    if (st.path) strip.innerHTML = st.path.map((id) => chip(BY_ID[id])).join('<span class="link-arrow">➜</span>');
    else strip.innerHTML = `${slot(st.a)}<span class="link-arrow">⋯</span>${slot(st.b)}`;
  };
  bridgeBtn.onclick = () => setBridge(!st.bridgeMode);
  const pick = (sx, sy) => {
    let best = null, bd = Infinity;
    for (const n of layout.nodes) {
      const d = Math.hypot(n.x - sx, n.y - sy);
      if (d < n.r + 6 && d < bd) { bd = d; best = n; }
    }
    return best;
  };
  const choose = (id) => {
    if (!st.a || st.b) { st.a = id; st.b = null; st.path = null; }
    else { st.b = id; st.path = bridge(st.a, st.b); history.replaceState(null, '', `#/bridge/${st.a}/${st.b}`); }
    renderStrip();
  };
  stage.on('move', (e) => { st.hover = pick(e.sx, e.sy); stage.canvas.style.cursor = st.hover ? 'pointer' : 'default'; });
  stage.on('up', (e) => {
    const n = pick(e.sx, e.sy);
    if (!n) return;
    if (st.bridgeMode) choose(n.id); else location.hash = `#/s/${n.id}`;
  });
  stage.canvas.addEventListener('pointerleave', () => (st.hover = null));
  stage.run((dt) => { st.t += dt; }, () => drawMap(stage, layout, st));
  document.querySelectorAll('.card').forEach((a) => {
    a.addEventListener('mouseenter', () => (st.hover = layout.nodes.find((n) => n.id === a.dataset.id)));
    a.addEventListener('mouseleave', () => (st.hover = null));
    a.addEventListener('click', (e) => { if (st.bridgeMode) { e.preventDefault(); choose(a.dataset.id); } });
  });
  if (preset) { setBridge(true); choose(preset[0]); choose(preset[1]); }
  current = { stage, repaint: () => route() };
}

// ---------------------------------------------------------------- math × algorithm grid
function renderWeb() {
  teardown();
  document.title = 'Grid · Crucible';
  const math = CONCEPTS.filter((c) => c.island === 'math');
  const algos = CONCEPTS.filter((c) => c.island !== 'math');
  app.innerHTML = `${topbar('<a class="ui-btn" href="#/" title="map" aria-label="map">🌌</a>')}
    <section class="web-wrap"><div class="web">
      <div class="corner">🧮 × 🤖</div>
      ${algos.map((a, j) => `<a class="colh" href="#/s/${a.id}" style="--tint:${col(ISLANDS[a.island].color)};grid-column:${j + 2}" title="${a.name}" data-c="${j}">${a.icon}</a>`).join('')}
      ${math.map((m, i) => {
        const anc = (a) => ancestry(a.id);
        return `<a class="rowh" href="#/s/${m.id}" style="grid-row:${i + 2}" title="${m.name}" data-r="${i}"><span>${m.icon}</span><em>${m.name}</em></a>` +
          algos.map((a, j) => {
            const direct = a.uses.includes(m.id), deep = !direct && anc(a).has(m.id);
            return `<a class="cell ${direct ? 'd' : deep ? 't' : ''}" href="#/s/${a.id}" style="--tint:${col(ISLANDS[a.island].color)};grid-row:${i + 2};grid-column:${j + 2}" data-r="${i}" data-c="${j}" title="${m.name} → ${a.name}"></a>`;
          }).join('');
      }).join('')}
    </div></section>
    <div class="web-key"><span><i class="cell d"></i>⬅ 1</span><span><i class="cell t"></i>⬅ ⋯</span></div>`;
  wireTopbar();
  const web = $('.web');
  web.style.gridTemplateColumns = `minmax(120px, auto) repeat(${algos.length}, 26px)`;
  web.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-r],[data-c]');
    web.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
    if (!t) return;
    const { r, c } = t.dataset;
    if (r !== undefined) web.querySelectorAll(`[data-r="${r}"]`).forEach((x) => x.classList.add('hl'));
    if (c !== undefined) web.querySelectorAll(`[data-c="${c}"]`).forEach((x) => x.classList.add('hl'));
  });
  current = { repaint: () => renderWeb() };
}

// ---------------------------------------------------------------- scene page
const chip = (c, cls = '') => `<a class="chip ${cls}" href="#/s/${c.id}" style="--tint:${col(ISLANDS[c.island].color)}" title="${c.name}"><span>${c.icon}</span><em>${c.name}</em></a>`;

function formulaHTML(eq) {
  if (!eq) return '';
  // eq = array of LINES; each line = array of tokens; token = 'plain text' | ['text', colorKey]
  return eq.map((line) => `<div class="eq-line">${line.map((tok) => {
    if (typeof tok === 'string') return `<span>${esc(tok)}</span>`;
    const [t, c] = tok;
    return `<span class="tok" style="--c:${col(c)}">${esc(t)}</span>`;
  }).join('')}</div>`).join('');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

async function renderScene(id, beat = null) {
  teardown();
  let c = BY_ID[id], prev, next, uses, feeds, isl, pageRow = '';
  if (c) {
    isl = ISLANDS[c.island];
    const same = CONCEPTS.filter((x) => x.island === c.island);
    const idx = same.indexOf(c);
    prev = same[(idx - 1 + same.length) % same.length]; next = same[(idx + 1) % same.length];
    uses = c.uses.map((u) => BY_ID[u]).filter(Boolean);
    feeds = dependents(id);
  } else if (id.startsWith('mls-')) {
    // A textbook scene: metadata comes from the atlas.
    const meta = await bookSceneMeta(id).catch(() => null);
    if (!meta) { location.hash = '#/book'; return; }
    c = { id, name: meta.title, icon: meta.icon };
    isl = { color: 'gold' };
    prev = { id: meta.prev, name: meta.neighborTitle(meta.prev) };
    next = { id: meta.next, name: meta.neighborTitle(meta.next) };
    uses = (meta.uses ?? []).map((u) => BY_ID[u]).filter(Boolean);
    if (meta.exists && BY_ID[meta.exists] && !uses.includes(BY_ID[meta.exists])) uses.unshift(BY_ID[meta.exists]);
    feeds = [];
    pageRow = `<div class="link-row"><span class="arrow" title="book pages">📕</span>${meta.pageLinks.map((p) => `<a class="chip" href="#/book/p/${p.pdf}" style="--tint:${col('gold')}"><span>📄</span><em>${p.label}</em></a>`).join('')}</div>`;
  } else { location.hash = '#/'; return; }
  document.title = `${c.name} · Crucible`;

  app.innerHTML = `
    <header class="topbar scene-top" style="--tint:${col(isl.color)}">
      <a class="ui-btn" href="#/" title="map" aria-label="map">🗺️</a>
      <a class="ui-btn" href="#/s/${prev.id}" title="${prev.name}" aria-label="previous">◀</a>
      <h1><span class="ic">${c.icon}</span><span class="nm">${c.name}</span></h1>
      <a class="ui-btn" href="#/s/${next.id}" title="${next.name}" aria-label="next">▶</a>
      <div class="spacer"></div>
      <button class="ui-btn" id="eq-btn" title="grown-up math" aria-label="grown-up math">∑</button>
      <button class="ui-btn" id="legend-btn" title="color language" aria-label="color language">🎨</button>
      <button class="ui-btn" id="theme-btn" title="light / dark" aria-label="light / dark">🌓</button>
    </header>
    <div class="legend-pop" hidden>${legendHTML()}</div>
    <nav class="links">
      ${uses.length ? `<div class="link-row"><span class="arrow" title="made of">🧱⬅</span>${uses.map((u) => chip(u)).join('')}</div>` : ''}
      ${feeds.length ? `<div class="link-row"><span class="arrow" title="builds into">➡🏗️</span>${feeds.map((u) => chip(u)).join('')}</div>` : ''}
      ${pageRow}
    </nav>
    <main class="scene-main">
      <div class="stage-wrap"></div>
      <aside class="formula" hidden></aside>
      <div class="scene-msg" hidden></div>
    </main>
    <div class="story"></div>
    <footer class="dock"><div class="ui-group sys"></div><div class="scene-ctl"></div></footer>`;

  $('#theme-btn').onclick = toggleTheme;
  $('#legend-btn').onclick = () => { const p = $('.legend-pop'); p.hidden = !p.hidden; };

  let mod = null;
  try { mod = await import(`./scenes/${id}.js`); } catch (e) { console.warn('scene missing', id, e); }
  if (!location.hash.startsWith(`#/s/${id}`)) return; // navigated away while loading
  const msg = $('.scene-msg');
  if (!mod?.default?.setup) {
    msg.hidden = false; msg.innerHTML = '<span class="big">🚧</span>';
    return;
  }
  const def = mod.default;
  const formula = $('.formula');
  formula.innerHTML = formulaHTML(def.eq);
  const eqBtn = $('#eq-btn');
  if (!def.eq) eqBtn.hidden = true;
  eqBtn.onclick = () => { formula.hidden = !formula.hidden; eqBtn.classList.toggle('on', !formula.hidden); };

  const stage = new Stage($('.stage-wrap'));
  const ui = new UI($('.scene-ctl'), $('.story'));
  stage.onError = () => { msg.hidden = false; msg.innerHTML = '<span class="big">💥</span>'; };

  // System controls: pause, step, reset, speed.
  const sys = $('.dock .sys');
  const sysUI = new UI(sys);
  const playBtn = sysUI.button({ icon: '⏸', title: 'pause / play', into: sys, onClick: () => setPaused(!stage.paused) });
  const setPaused = (p) => { stage.paused = p; playBtn.textContent = p ? '▶' : '⏸'; };
  sysUI.button({ icon: '⏭', title: 'one step', into: sys, onClick: () => { setPaused(true); stage.advance(1 / 15); } });
  sysUI.button({ icon: '↺', title: 'start over', into: sys, onClick: () => renderScene(id) });
  sysUI.choice({ into: sys, value: 1, color: 'teal', options: [
    { icon: '🐢', value: 0.25, title: 'slow' }, { icon: '🚶', value: 1, title: 'normal' }, { icon: '🐇', value: 3, title: 'fast' },
  ], onChange: (v) => (stage.speed = v) });

  let inst;
  try {
    inst = def.setup({ stage, ui, C }) || {};
  } catch (e) {
    console.error(e);
    msg.hidden = false; msg.innerHTML = '<span class="big">💥</span>';
    return;
  }
  stage.run((dt, t) => inst.update?.(dt, t), () => { inst.draw?.(); ui.refresh(); });
  current = { stage, ui, dispose: () => inst.dispose?.(), id, inst };
  window.__scene = current; // handy for tests / debugging
  if (beat !== null) document.querySelectorAll('.story .ui-beat')[beat]?.click(); // deep link: #/s/<id>?beat=k
}

// ---------------------------------------------------------------- the textbook
async function renderBook(kind, n) {
  teardown();
  document.title = 'Book · Crucible';
  app.innerHTML = `${topbar('<a class="ui-btn" href="#/" title="map" aria-label="map">🌌</a>')}<div class="book"></div>`;
  wireTopbar();
  const el = $('.book');
  current = { repaint: () => route() };
  try {
    if (kind === 'day') await renderBookDay(el, n);
    else if (kind === 'page') await renderBookPage(el, n);
    else await renderBookHome(el);
  } catch (e) {
    console.error(e);
    el.innerHTML = '<div class="scene-msg" style="position:relative;min-height:300px"><span class="big">🧩</span></div>';
  }
}

// ---------------------------------------------------------------- router
function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/s\/([\w-]+)(?:\?beat=(\d+))?/);
  const b = h.match(/^#\/bridge\/([\w-]+)\/([\w-]+)/);
  const bk = h.match(/^#\/book(?:\/(day|p)\/(\d+))?/);
  if (m) renderScene(m[1], m[2] !== undefined ? Number(m[2]) : null);
  else if (bk) renderBook(bk[1] === 'p' ? 'page' : bk[1], Number(bk[2]));
  else if (h.startsWith('#/web')) renderWeb();
  else if (b && BY_ID[b[1]] && BY_ID[b[2]]) renderMap([b[1], b[2]]);
  else renderMap();
}
addEventListener('hashchange', route);
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const sceneId = current?.id;
  if (e.key === 'Escape') location.hash = '#/';
  if (!sceneId) return;
  if (e.key === ' ') { e.preventDefault(); document.querySelector('.dock .sys .ui-btn')?.click(); }
  if (e.key === 'r') document.querySelector('.dock .sys button[title="start over"]')?.click();
  if (e.key === 'ArrowRight') document.querySelector('.scene-top a[aria-label="next"]')?.click();
  if (e.key === 'ArrowLeft') document.querySelector('.scene-top a[aria-label="previous"]')?.click();
});
route();
export { alpha };
