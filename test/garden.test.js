import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStatus, KEYS, upsertPlant } from '../src/garden.js';

// minimal in-memory KV stub matching the Workers KV surface we use
function fakeKV(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
}

test('readStatus returns an empty doc when nothing stored', async () => {
  const env = { PHOTOS: fakeKV() };
  const doc = await readStatus(env);
  assert.deepEqual(doc, { updatedAt: 0, plants: {} });
});

test('readStatus parses a stored doc', async () => {
  const stored = { updatedAt: 5, plants: { a: { id: 'a' } } };
  const env = { PHOTOS: fakeKV({ [KEYS.status]: JSON.stringify(stored) }) };
  assert.deepEqual(await readStatus(env), stored);
});

test('upsertPlant creates a plant with defaults', () => {
  const doc = { updatedAt: 0, plants: {} };
  const out = upsertPlant(doc, 'tomato-1', { name: 'Tigerella', species: 'tomato', stage: 'flowering' }, 100);
  assert.equal(out.plants['tomato-1'].stage, 'flowering');
  assert.deepEqual(out.plants['tomato-1'].notes, []);
  assert.deepEqual(out.plants['tomato-1'].history, []);
  assert.equal(out.plants['tomato-1'].updatedAt, 100);
  assert.equal(out.updatedAt, 100);
});

test('upsertPlant merges without dropping existing keys', () => {
  const doc = { updatedAt: 1, plants: { a: { id: 'a', stage: 'growing', notes: [{ id: 'n' }] } } };
  const out = upsertPlant(doc, 'a', { stage: 'harvesting' }, 200);
  assert.equal(out.plants.a.stage, 'harvesting');
  assert.equal(out.plants.a.notes.length, 1);
});
