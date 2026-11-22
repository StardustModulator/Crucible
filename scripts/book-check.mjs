// Validate the textbook atlas (book/atlas/*.json) against the coverage contract.
//   node scripts/book-check.mjs                 → validate whatever atlas files exist
//   node scripts/book-check.mjs ch02            → validate one file (plus global rules)
//   node scripts/book-check.mjs --all           → also require every PDF page to be covered
//   node scripts/book-check.mjs --built         → also report which scenes exist in src/scenes
// Exit code 1 on any error. See book/SCHEMA.md.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { CONCEPTS } from '../src/graph/concepts.js';

const root = new URL('../book/', import.meta.url);
const { lines: LINES, offset: OFFSET } = JSON.parse(readFileSync(new URL('lines.json', root), 'utf8'));

export const KINDS = ['heading', 'prose', 'definition', 'proposition', 'lemma', 'theorem', 'corollary', 'proof',
  'equation', 'example', 'figure', 'table', 'remark', 'algorithm', 'exercise', 'summary', 'references',
  'index', 'front', 'caption', 'footnote', 'page-number'];
const CONCEPT_IDS = new Set(CONCEPTS.map((c) => c.id));
const SCENE_RE = /^mls-[a-z0-9]+(-[a-z0-9]+)*$/;

export function loadAtlas(only = null) {
  const dir = new URL('atlas/', root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json') && (!only || f === `${only}.json`))
    .sort().map((f) => ({ file: f, data: JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }));
}

export function check({ only = null, all = false } = {}) {
  const errors = [], warns = [];
  const files = loadAtlas();
  const err = (f, m) => errors.push(`${f}: ${m}`);
  const seenPdf = new Map(), atomIds = new Set(), scenes = new Map();
  // pass 1: scenes declared anywhere
  for (const { file, data } of files) for (const s of data.scenes ?? []) {
    if (!SCENE_RE.test(s.id)) err(file, `scene id "${s.id}" must look like mls-some-name`);
    if (scenes.has(s.id)) err(file, `scene ${s.id} declared twice (also in ${scenes.get(s.id).file})`);
    scenes.set(s.id, { ...s, file, atoms: [] });
    for (const k of ['title', 'icon', 'brief']) if (!s[k]) err(file, `scene ${s.id} missing ${k}`);
    if (!Array.isArray(s.beats) || s.beats.length < 2) err(file, `scene ${s.id} needs ≥2 beats`);
    for (const u of s.uses ?? []) if (!CONCEPT_IDS.has(u)) err(file, `scene ${s.id} uses unknown concept "${u}"`);
    if (s.exists && !CONCEPT_IDS.has(s.exists)) err(file, `scene ${s.id} exists→ unknown concept "${s.exists}"`);
  }
  // pass 2: pages & atoms
  for (const { file, data } of files) {
    const strict = !only || file === `${only}.json`;
    const E = strict ? err : () => {};
    for (const k of ['id', 'title', 'pdfPages', 'pages']) if (data[k] === undefined) E(file, `missing top-level "${k}"`);
    const [p0, p1] = data.pdfPages ?? [0, -1];
    const got = (data.pages ?? []).map((p) => p.pdf);
    for (let p = p0; p <= p1; p++) if (!got.includes(p)) E(file, `pdf page ${p} missing`);
    for (const pg of data.pages ?? []) {
      const where = `${file} pdf ${pg.pdf}`;
      if (seenPdf.has(pg.pdf)) E(file, `pdf page ${pg.pdf} also in ${seenPdf.get(pg.pdf)}`);
      seenPdf.set(pg.pdf, file);
      const want = LINES[pg.pdf - 1];
      if (want === undefined) { E(where, 'no such PDF page'); continue; }
      if (pg.book !== null && pg.book !== undefined && pg.book !== pg.pdf - OFFSET) E(where, `book page should be ${pg.pdf - OFFSET}`);
      if (pg.lines !== want) E(where, `lines=${pg.lines} but the page has ${want} canonical lines`);
      if (want > 0 && !pg.summary) E(where, 'missing page summary');
      // atoms must tile 1..want exactly
      let next = 1;
      for (const a of pg.atoms ?? []) {
        const at = `${where} atom ${a.id}`;
        if (!a.id || atomIds.has(a.id)) E(at, 'missing or duplicate atom id');
        atomIds.add(a.id);
        if (!Array.isArray(a.lines) || a.lines.length !== 2) { E(at, 'lines must be [from, to]'); continue; }
        if (a.lines[0] !== next) E(at, `starts at line ${a.lines[0]}, expected ${next} (gap or overlap)`);
        if (a.lines[1] < a.lines[0]) E(at, 'lines reversed');
        next = a.lines[1] + 1;
        if (!KINDS.includes(a.kind)) E(at, `kind "${a.kind}" not in ${KINDS.join('|')}`);
        const trivial = ['page-number', 'references', 'index', 'front', 'heading'].includes(a.kind);
        for (const k of trivial ? ['idea'] : ['idea', 'feynman', 'visual']) if (!a[k] || String(a[k]).length < 8) E(at, `missing "${k}"`);
        if (!trivial) {
          if (!a.scene) E(at, 'missing scene');
          else if (!scenes.has(a.scene) && !CONCEPT_IDS.has(a.scene)) E(at, `scene "${a.scene}" is not declared in any atlas file and is not a Crucible concept`);
          else scenes.get(a.scene)?.atoms.push(a.id);
          if (!a.beat) E(at, 'missing beat');
          if (!Number.isInteger(a.difficulty) || a.difficulty < 1 || a.difficulty > 5) E(at, 'difficulty must be 1..5');
        }
        for (const m of a.math ?? []) if (!CONCEPT_IDS.has(m)) E(at, `math "${m}" is not a Crucible concept id`);
        for (const k of ['idea', 'feynman', 'visual']) if (a[k] && a[k].length > 900) warns.push(`${at}: "${k}" is very long — keep it original and tight`);
      }
      if (next - 1 !== want) E(where, `atoms cover lines 1..${next - 1} but the page has ${want}`);
    }
  }
  for (const [id, s] of scenes) if (!s.atoms.length) warns.push(`${s.file}: scene ${id} has no atoms pointing at it`);
  if (all) for (let p = 1; p <= LINES.length; p++) if (!seenPdf.has(p)) errors.push(`pdf page ${p} is not in any atlas file`);
  const covered = [...seenPdf.keys()].reduce((s, p) => s + LINES[p - 1], 0);
  const total = LINES.reduce((a, b) => a + b, 0);
  return { errors, warns, stats: { files: files.length, pages: seenPdf.size, atoms: atomIds.size, scenes: scenes.size, covered, total } };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const only = args.find((a) => !a.startsWith('--')) ?? null;
  const { errors, warns, stats } = check({ only, all: args.includes('--all') });
  for (const w of warns.slice(0, 30)) console.log('⚠️ ', w);
  for (const e of errors.slice(0, 80)) console.log('❌', e);
  if (errors.length > 80) console.log(`… ${errors.length - 80} more errors`);
  console.log(`\n📕 ${stats.files} files · ${stats.pages}/474 pages · ${stats.covered}/${stats.total} lines · ${stats.atoms} atoms · ${stats.scenes} scenes · ${errors.length} errors`);
  if (args.includes('--built')) {
    const all = loadAtlas().flatMap(({ data }) => data.scenes ?? []);
    const built = all.filter((s) => existsSync(new URL(`../src/scenes/${s.id}.js`, import.meta.url)));
    console.log(`🧱 scenes built: ${built.length}/${all.length}`);
  }
  process.exit(errors.length ? 1 : 0);
}
