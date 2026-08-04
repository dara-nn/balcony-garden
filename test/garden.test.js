import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStatus, KEYS } from '../src/garden.js';

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
