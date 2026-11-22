// App shell: hash router, the concept map, and the scene runner.
import { C, setTheme, themeName, col, alpha } from './viz/palette.js';
import { Stage } from './viz/stage.js';
import { UI } from './viz/ui.js';
import { CONCEPTS, ISLANDS, BY_ID, dependents } from './graph/concepts.js';
import { drawMap, layoutMap } from './graph/map.js';

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
function renderMap() {
  teardown();
  document.title = 'Crucible';
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/" aria-label="home">⚗️ <b>Crucible</b></a>
      <div class="spacer"></div>
      <button class="ui-btn" id="legend-btn" title="color language" aria-label="color language">🎨</button>
      <button class="ui-btn" id="theme-btn" title="light / dark" aria-label="light / dark">◐</button>
    </header>
    <div class="legend-pop" hidden>${legendHTML()}</div>
    <section class="map-wrap"><div class="map-stage"></div></section>
    <section class="shelves">${Object.entries(ISLANDS).map(([k, isl]) => `
      <div class="shelf" style="--tint:${col(isl.color)}">
        <h2><span>${isl.icon}</span>${isl.name}</h2>
        <div class="cards">${CONCEPTS.filter((c) => c.island === k).map((c) => `
          <a class="card" href="#/s/${c.id}" data-id="${c.id}"><span class="ic">${c.icon}</span><span class="nm">${c.name}</span></a>`).join('')}
        </div>
      </div>`).join('')}
    </section>`;
  $('#theme-btn').onclick = toggleTheme;
  $('#legend-btn').onclick = () => { const p = $('.legend-pop'); p.hidden = !p.hidden; };

  const stage = new Stage($('.map-stage'));
  const st = { hover: null, focus: null, t: 0 };
  let layout = layoutMap(stage);
  stage.ro.disconnect();
  stage.ro = new ResizeObserver(() => { stage._resize(); layout = layoutMap(stage); });
  stage.ro.observe($('.map-stage'));
  const pick = (sx, sy) => {
    let best = null, bd = Infinity;
    for (const n of layout.nodes) {
      const d = Math.hypot(n.x - sx, n.y - sy);
      if (d < n.r + 6 && d < bd) { bd = d; best = n; }
    }
    return best;
  };
  stage.on('move', (e) => { st.hover = pick(e.sx, e.sy); stage.canvas.style.cursor = st.hover ? 'pointer' : 'default'; });
  stage.on('up', (e) => { const n = pick(e.sx, e.sy); if (n) location.hash = `#/s/${n.id}`; });
  stage.canvas.addEventListener('pointerleave', () => (st.hover = null));
  stage.run((dt) => { st.t += dt; }, () => drawMap(stage, layout, st));
  document.querySelectorAll('.card').forEach((a) => {
    a.addEventListener('mouseenter', () => (st.hover = layout.nodes.find((n) => n.id === a.dataset.id)));
    a.addEventListener('mouseleave', () => (st.hover = null));
  });
  current = { stage, repaint: () => renderMap() };
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

async function renderScene(id) {
  teardown();
  const c = BY_ID[id];
  if (!c) { location.hash = '#/'; return; }
  document.title = `${c.name} · Crucible`;
  const isl = ISLANDS[c.island];
  const same = CONCEPTS.filter((x) => x.island === c.island);
  const idx = same.indexOf(c);
  const prev = same[(idx - 1 + same.length) % same.length], next = same[(idx + 1) % same.length];
  const uses = c.uses.map((u) => BY_ID[u]).filter(Boolean);
  const feeds = dependents(id);

  app.innerHTML = `
    <header class="topbar scene-top" style="--tint:${col(isl.color)}">
      <a class="ui-btn" href="#/" title="map" aria-label="map">🗺️</a>
      <a class="ui-btn" href="#/s/${prev.id}" title="${prev.name}" aria-label="previous">◀</a>
      <h1><span class="ic">${c.icon}</span><span class="nm">${c.name}</span></h1>
      <a class="ui-btn" href="#/s/${next.id}" title="${next.name}" aria-label="next">▶</a>
      <div class="spacer"></div>
      <button class="ui-btn" id="eq-btn" title="grown-up math" aria-label="grown-up math">∑</button>
      <button class="ui-btn" id="legend-btn" title="color language" aria-label="color language">🎨</button>
      <button class="ui-btn" id="theme-btn" title="light / dark" aria-label="light / dark">◐</button>
    </header>
    <div class="legend-pop" hidden>${legendHTML()}</div>
    <nav class="links">
      ${uses.length ? `<div class="link-row"><span class="arrow" title="made of">🧱⬅</span>${uses.map((u) => chip(u)).join('')}</div>` : ''}
      ${feeds.length ? `<div class="link-row"><span class="arrow" title="builds into">➡🏗️</span>${feeds.map((u) => chip(u)).join('')}</div>` : ''}
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
  if (location.hash !== `#/s/${id}`) return; // navigated away while loading
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
}

// ---------------------------------------------------------------- router
function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/s\/([\w-]+)/);
  if (m) renderScene(m[1]); else renderMap();
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
