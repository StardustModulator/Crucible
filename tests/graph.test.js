import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CONCEPTS, BY_ID, ancestry, bridge, ISLANDS } from '../src/graph/concepts.js';

test('concept graph is well-formed', () => {
  const ids = new Set();
  for (const c of CONCEPTS) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(ISLANDS[c.island], `bad island ${c.island}`);
    for (const u of [...c.uses, ...c.next]) assert.ok(BY_ID[u], `${c.id} → unknown ${u}`);
    assert.ok(!c.uses.includes(c.id), `${c.id} uses itself`);
  }
});

test('every algorithm rests on the Math Core', () => {
  for (const c of CONCEPTS) {
    if (c.island === 'math') continue;
    const anc = [...ancestry(c.id)].map((id) => BY_ID[id]);
    assert.ok(anc.some((a) => a.island === 'math'), `${c.id} has no math underneath`);
  }
});

test('every concept is reachable from every other (one connected web)', () => {
  for (const c of CONCEPTS) assert.ok(bridge('vectors', c.id), `no bridge to ${c.id}`);
  assert.deepEqual(bridge('svd', 'svd'), ['svd']);
});

test('every concept has a scene', () => {
  const missing = CONCEPTS.filter((c) => !existsSync(new URL(`../src/scenes/${c.id}.js`, import.meta.url)));
  assert.deepEqual(missing.map((c) => c.id), []);
});
