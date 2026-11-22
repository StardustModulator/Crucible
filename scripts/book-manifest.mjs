// Write book/atlas.json: the ordered list of atlas part files the browser should load.
import { readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const ORDER = ['front', 'ch01', 'ch02', 'ch03a', 'ch03b', 'ch04', 'ch05', 'ch06', 'ch07', 'ch08', 'ch09', 'appA', 'appB', 'bib', 'index'];
export function writeManifest() {
  const have = readdirSync(new URL('../book/atlas/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const parts = [...ORDER.filter((id) => have.includes(id)), ...have.filter((id) => !ORDER.includes(id)).sort()];
  // Which atlas scenes already have a scene file (the browser can't list directories).
  const ids = parts.flatMap((id) => JSON.parse(readFileSync(new URL(`../book/atlas/${id}.json`, import.meta.url), 'utf8')).scenes ?? []).map((s) => s.id);
  const built = ids.filter((id) => existsSync(new URL(`../src/scenes/${id}.js`, import.meta.url))).sort();
  writeFileSync(new URL('../book/atlas.json', import.meta.url), JSON.stringify({ parts, built }, null, 1) + '\n');
  return parts;
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(writeManifest().join(' '));
