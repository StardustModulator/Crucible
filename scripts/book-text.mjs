// Print the canonical numbered lines of book pages (needs the local PDF; output is NOT committed).
//   node scripts/book-text.mjs 27          → book page 27
//   node scripts/book-text.mjs 27 30       → book pages 27–30
//   node scripts/book-text.mjs --pdf 5 9   → PDF pages 5–9 (front matter)
// A "line" = a non-empty line of `pdftotext -layout` for that single page. Atoms in the
// atlas must tile lines 1..N of every page, so this numbering is the coverage contract.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const PDF = new URL('../book/source/mls.pdf', import.meta.url).pathname;
export const OFFSET = 18; // book page p lives on PDF page p + 18

export function pageLines(pdfPage) {
  const out = execFileSync('pdftotext', ['-layout', '-f', String(pdfPage), '-l', String(pdfPage), PDF, '-'], { encoding: 'utf8' });
  return out.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (!existsSync(PDF)) { console.error(`Missing ${PDF} — put the textbook PDF there (it is gitignored).`); process.exit(1); }
  const args = process.argv.slice(2);
  const pdfMode = args[0] === '--pdf';
  const nums = args.filter((a) => !a.startsWith('--')).map(Number);
  const [a, b = nums[0]] = nums;
  for (let p = a; p <= b; p++) {
    const pdf = pdfMode ? p : p + OFFSET;
    const lines = pageLines(pdf);
    console.log(`\n════ ${pdfMode ? '' : `book ${p} · `}pdf ${pdf} · ${lines.length} lines ════`);
    lines.forEach((l, i) => console.log(String(i + 1).padStart(3), '│', l));
  }
}
