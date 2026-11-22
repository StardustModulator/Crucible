// Headless smoke test: opens every scene (or the ids given), exercises it, and
// reports runtime errors. Screenshots go to --shots <dir> if provided.
//   node scripts/smoke.mjs                 → all scenes
//   node scripts/smoke.mjs svd eigen --shots /tmp/shots
import { serve } from './serve.mjs';
import { CONCEPTS } from '../src/graph/concepts.js';
import { mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const shotIdx = args.indexOf('--shots');
const shots = shotIdx >= 0 ? args[shotIdx + 1] : null;
const portrait = args.includes('--portrait');
const ids = args.filter((a, i) => !a.startsWith('--') && (shotIdx < 0 || i !== shotIdx + 1));
const list = ids.length ? ids : CONCEPTS.map((c) => c.id);

import { createRequire } from 'node:module';
// Playwright may be installed globally (CommonJS + NODE_PATH); fall back to ESM import.
let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { ({ chromium } = await import('playwright')); }
const port = 5300 + Math.floor(Math.random() * 500);
const server = await serve(port);
const browser = await chromium.launch();
if (shots) await mkdir(shots, { recursive: true });

const results = [];
for (const id of list) {
  const page = await browser.newPage({ viewport: portrait ? { width: 400, height: 820 } : { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/#/s/${id}`);
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => ({
    missing: !!document.querySelector('.scene-msg:not([hidden]) .big')?.textContent.includes('🚧'),
    crashed: !!document.querySelector('.scene-msg:not([hidden]) .big')?.textContent.includes('💥'),
    handles: window.__scene?.stage?.handles?.length ?? 0,
  }));
  if (!state.missing) {
    // Drag every handle a bit, click every beat and scene button, then let it run.
    const hs = await page.evaluate(() => (window.__scene?.stage?.handles ?? []).filter((h) => h.visible()).map((h) => {
      const r = window.__scene.stage.canvas.getBoundingClientRect();
      const [x, y] = h.pen.toScreen(h.get());
      return [r.left + x, r.top + y];
    }));
    for (const [x, y] of hs.slice(0, 6)) {
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + 40, y - 30, { steps: 5 }); await page.mouse.up();
    }
    const beats = await page.$$('.ui-beat');
    for (const b of beats) { await b.click(); await page.waitForTimeout(250); }
    const btns = await page.$$('.scene-ctl .ui-btn');
    for (const b of btns.slice(0, 8)) { await b.click().catch(() => {}); await page.waitForTimeout(120); }
    if (beats.length) { await beats[0].click(); }
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__scene?.stage?.advance(4));
    if (shots) await page.screenshot({ path: `${shots}/${id}.png` });
    const crashed2 = await page.evaluate(() => !!document.querySelector('.scene-msg:not([hidden]) .big')?.textContent.includes('💥'));
    state.crashed ||= crashed2;
  }
  const status = state.missing ? 'missing' : (errors.length || state.crashed) ? 'ERROR' : 'ok';
  results.push({ id, status, errors: errors.slice(0, 3) });
  console.log(`${status === 'ok' ? '✅' : status === 'missing' ? '⬜' : '❌'} ${id}${errors.length ? '\n    ' + errors.slice(0, 3).join('\n    ') : ''}`);
  await page.close();
}
// Map page too.
if (!ids.length || ids.includes('map')) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/#/`);
  await page.waitForTimeout(800);
  await page.mouse.move(640, 400);
  await page.waitForTimeout(300);
  if (shots) await page.screenshot({ path: `${shots}/_map.png` });
  console.log(`${errors.length ? '❌' : '✅'} map ${errors.join(' ')}`);
  if (errors.length) results.push({ id: 'map', status: 'ERROR', errors });
  await page.close();
}
await browser.close();
server.close();
const bad = results.filter((r) => r.status === 'ERROR');
const missing = results.filter((r) => r.status === 'missing');
console.log(`\n${results.length - bad.length - missing.length} ok · ${missing.length} missing · ${bad.length} errors`);
process.exit(bad.length ? 1 : 0);
