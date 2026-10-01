import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleReplan, WANT_KEY } from '../src/schedule.js';

function fakeKV({ throttle = false } = {}) {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { if (throttle && m.has(k)) throw new Error('429'); m.set(k, v); } };
}

test('a lone request runs once', async () => {
  let runs = 0;
  const env = { PHOTOS: fakeKV() };
  assert.equal(await scheduleReplan(env, { run: async () => { runs++; }, wait: 5 }), true);
  assert.equal(runs, 1);
});

test('a burst of requests runs once, and it is the newest that runs', async () => {
  const ran = [];
  const env = { PHOTOS: fakeKV() };
  const p1 = scheduleReplan(env, { run: async () => ran.push(1), wait: 30 });
  await new Promise((r) => setTimeout(r, 5));
  const p2 = scheduleReplan(env, { run: async () => ran.push(2), wait: 30 });
  assert.deepEqual(await Promise.all([p1, p2]), [false, true]);
  assert.deepEqual(ran, [2]);
});

test('a request KV refused to record leans on a pending run that starts after it', async () => {
  const ran = [];
  const env = { PHOTOS: fakeKV({ throttle: true }) };
  const p1 = scheduleReplan(env, { run: async () => ran.push(1), wait: 30 });
  await new Promise((r) => setTimeout(r, 5));
  const p2 = scheduleReplan(env, { run: async () => ran.push(2), wait: 30 });   // put throws
  await Promise.all([p1, p2]);
  assert.deepEqual(ran, [1]);
});

test('a request KV refused to record, with nothing pending, runs itself', async () => {
  let runs = 0;
  const env = { PHOTOS: fakeKV({ throttle: true }) };
  env.PHOTOS.m.set(WANT_KEY, `${Date.now() - 60000}:old`);
  assert.equal(await scheduleReplan(env, { run: async () => { runs++; }, wait: 5 }), true);
  assert.equal(runs, 1);
});
