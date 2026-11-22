import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { check, loadAtlas } from '../scripts/book-check.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('line counts cover the whole book', () => {
  const { pdfPages, lines } = read('../book/lines.json');
  assert.equal(pdfPages, 474);
  assert.equal(lines.length, 474);
});

test('the 7 days tile every PDF page exactly once', () => {
  const { days } = read('../book/days.json');
  assert.equal(days.length, 7);
  let next = 1;
  for (const d of days) { assert.equal(d.pdf[0], next, `day ${d.day} starts at ${d.pdf[0]}`); next = d.pdf[1] + 1; }
  assert.equal(next, 475);
});

test('atlas: every atom tiles its page lines and points at a real scene', () => {
  const { errors } = check();
  assert.deepEqual(errors, []);
});

test('atlas manifest lists every part file', () => {
  const { parts } = read('../book/atlas.json');
  assert.deepEqual([...parts].sort(), loadAtlas().map((f) => f.file.slice(0, -5)).sort());
});
