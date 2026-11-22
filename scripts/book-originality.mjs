// Originality guard: flag atlas text that shares a long word run with the book itself.
//   node scripts/book-originality.mjs [n=8]
// Needs the local PDF (book/source/mls.pdf). Math letter-soup and section titles are ignored;
// anything else that matches n consecutive book words must be rewritten in our own words.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadAtlas } from './book-check.mjs';
import { PDF } from './book-text.mjs';

const N = Number(process.argv[2] ?? 8);
if (!existsSync(PDF)) { console.log('⏭  no local PDF — originality scan skipped'); process.exit(0); }
const tok = (s) => (String(s ?? '').toLowerCase().match(/[a-z]+/g) ?? []);
const book = tok(execFileSync('pdftotext', ['-layout', PDF, '-'], { encoding: 'utf8', maxBuffer: 64e6 }));
const grams = new Set();
for (let i = 0; i + N <= book.length; i++) grams.add(book.slice(i, i + N).join(' '));
const files = loadAtlas();
const titles = files.flatMap(({ data }) => (data.sections ?? []).map((s) => tok(s.title).join(' ')));
let hits = 0;
for (const { file, data } of files) for (const p of data.pages) for (const a of p.atoms) for (const k of ['idea', 'feynman', 'visual']) {
  const t = tok(a[k]);
  for (let i = 0; i + N <= t.length; i++) {
    const run = t.slice(i, i + N);
    const g = run.join(' ');
    if (!grams.has(g)) continue;
    if (run.filter((w) => w.length >= 3).length < N - 2) continue; // equations / symbols
    if (titles.some((ti) => ti.includes(g))) continue;            // section titles are fine
    console.log(`❌ ${file} ${a.id} ${k}: “…${g}…”`);
    hits++;
    break;
  }
}
console.log(hits ? `\n${hits} field(s) echo the book — rewrite them in your own words.` : `✅ no ${N}-word runs copied from the book`);
process.exit(hits ? 1 : 0);
