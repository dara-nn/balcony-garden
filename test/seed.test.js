import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeed, readSeed } from '../src/seed.js';

const FILE = `/* a comment above */
window.GARDEN_SEED = JSON.parse(\`{
  "version": 8,
  "plants": [
    { "id": "tomato-1", "name": "Tigerella", "area": "balcony" },
    { "id": "monstera", "name": "Monstera", "area": "indoor" }
  ]
}\`);
`;

test('the inventory is read straight out of the served asset', () => {
  const seed = parseSeed(FILE);
  assert.equal(seed.version, 8);
  assert.deepEqual(seed.plants.map((p) => p.area), ['balcony', 'indoor']);
});

test('a file that is not the inventory yields nothing', () => {
  assert.equal(parseSeed('console.log("hi")'), null);
  assert.equal(parseSeed(''), null);
});

test('malformed JSON yields nothing rather than throwing', () => {
  assert.equal(parseSeed('window.GARDEN_SEED = JSON.parse(`{ nope }`);'), null);
});

test('readSeed fetches the asset and parses it', async () => {
  const env = { ASSETS: { fetch: async () => new Response(FILE) } };
  const seed = await readSeed(env);
  assert.equal(seed.plants.length, 2);
});

test('readSeed survives an asset that cannot be fetched', async () => {
  const env = { ASSETS: { fetch: async () => { throw new Error('nope'); } } };
  assert.equal(await readSeed(env), null);
});

/* A bad hand-edit to the inventory makes readSeed return null, and every plant
   silently falls back to "balcony" — the exact bug the area work exists to fix.
   Nothing at runtime can shout about it, so this test does. */
test('the real inventory file parses, and every plant has an id and an area', async () => {
  const fs = await import('node:fs/promises');
  const seed = parseSeed(await fs.readFile(new URL('../public/garden-data.js', import.meta.url), 'utf8'));
  assert.ok(seed, 'public/garden-data.js did not parse');
  assert.ok(seed.plants.length > 0);
  for (const p of seed.plants) {
    assert.ok(p.id, 'a plant has no id');
    assert.ok(['balcony', 'indoor'].includes(p.area), `${p.id} has a bad area: ${p.area}`);
  }
});
