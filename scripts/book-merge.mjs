// Assemble book/atlas/<id>.json from per-page fragments written while working:
//   book/atlas/_work/<id>/meta.json     → { id, title, pdfPages, sections, scenes }
//   book/atlas/_work/<id>/p<pdf>.json   → one page object (see book/SCHEMA.md)
//   node scripts/book-merge.mjs <id>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { writeManifest } from './book-manifest.mjs';

const id = process.argv[2];
if (!id) { console.error('usage: node scripts/book-merge.mjs <id>'); process.exit(1); }
const dir = new URL(`../book/atlas/_work/${id}/`, import.meta.url);
const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8'));
const pages = readdirSync(dir).filter((f) => /^p\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
  .sort((a, b) => a.pdf - b.pdf);
writeFileSync(new URL(`../book/atlas/${id}.json`, import.meta.url), JSON.stringify({ ...meta, pages }, null, 1) + '\n');
console.log(`${id}: ${pages.length} pages, ${pages.reduce((s, p) => s + p.atoms.length, 0)} atoms, ${meta.scenes.length} scenes`);
writeManifest();
