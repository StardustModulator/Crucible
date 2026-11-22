// Regenerate book/lines.json: the canonical line count of every PDF page (numbers only).
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pageLines, PDF } from './book-text.mjs';

const n = Number(execFileSync('pdfinfo', [PDF], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)[1]);
const counts = [];
for (let p = 1; p <= n; p++) counts.push(pageLines(p).length);
writeFileSync(new URL('../book/lines.json', import.meta.url), JSON.stringify({ pdfPages: n, offset: 18, lines: counts }) + '\n');
console.log(`${n} pages · ${counts.reduce((a, b) => a + b, 0)} lines`);
