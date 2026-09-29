import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPhotos, parseForecast, parsePlanResponse, mergePlan, bytesToBase64 } from '../src/planner.js';

test('selectPhotos filters by plant+date and caps', () => {
  const list = [
    { id: '1', plant: 'a', date: '2026-07-26', created: 3 },
    { id: '2', plant: 'a', date: '2026-07-26', created: 5 },
    { id: '3', plant: 'b', date: '2026-07-26', created: 9 },
    { id: '4', plant: 'a', date: '2026-07-25', created: 9 },
  ];
  const out = selectPhotos(list, 'a', '2026-07-26', 3);
  assert.deepEqual(out.map((p) => p.id), ['2', '1']); // newest first, only a+that date
});

test('parseForecast maps daily arrays', () => {
  const json = { daily: { time: ['2026-07-26'], temperature_2m_max: [28], temperature_2m_min: [12],
    precipitation_probability_max: [10], relative_humidity_2m_mean: [55] } };
  assert.deepEqual(parseForecast(json).days['2026-07-26'], { tmax: 28, tmin: 12, pop: 10, rh: 55 });
});

test('parsePlanResponse extracts the plants array (skipping a thought-only part)', () => {
  const payload = { plants: [{ id: 'a', health: { overall: 'steady', issues: [] }, observations: 'ok', days: [] }] };
  const gemini = { candidates: [{ content: { parts: [
    { thoughtSignature: 'xxx' },                 // thinking model may prepend a text-less part
    { text: JSON.stringify(payload) },
  ] } }] };
  assert.deepEqual(parsePlanResponse(gemini), payload.plants);
});

test('parsePlanResponse returns [] when plants is absent', () => {
  const gemini = { candidates: [{ content: { parts: [{ text: '{}' }] } }] };
  assert.deepEqual(parsePlanResponse(gemini), []);
});

test('mergePlan (array input) writes condition + derives icon from cat with stable keys', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [{ id: 'a',
    health: { overall: 'struggling', issues: [{ type: 'pest', label: 'aphids', severity: 'mild' }] },
    observations: 'aphids seen', stage: 'fruiting',
    days: [{ date: '2026-07-26', tasks: [{ cat: 'water', what: 'Water deeply', why: 'hot' }] }] }];
  const { status: s2, plan } = mergePlan(status, ai, '2026-07-26', 100);
  assert.equal(s2.plants.a.stage, 'fruiting');
  assert.equal(s2.plants.a.health.overall, 'struggling');
  const task = plan.plants.a['2026-07-26'][0];
  assert.equal(task.key, 'ai|a|2026-07-26|0');
  assert.equal(task.ico, '💧');            // derived from cat, not from model
  assert.equal(task.what, 'Water deeply');
  assert.equal(plan.through, '2026-08-08');
});

test('mergePlan skips ai entries with unknown or missing id', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [{ id: 'zzz', health: { overall: 'steady', issues: [] }, days: [] }, { days: [] }];
  const { plan } = mergePlan(status, ai, '2026-07-26', 1);
  assert.deepEqual(Object.keys(plan.plants), []);
});

test('bytesToBase64 round-trips known small bytes', () => {
  const bytes = new Uint8Array([104, 105]); // "hi"
  assert.equal(bytesToBase64(bytes), 'aGk=');
});

test('bytesToBase64 encodes a large buffer without throwing', () => {
  const bytes = new Uint8Array(200000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  let out;
  assert.doesNotThrow(() => { out = bytesToBase64(bytes); });
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
});

test('the planner records a stage change it decides on', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', notes: [], history: [] } } };
  const ai = [{ id: 'a', stage: 'flowering', health: { label: 'in full swing', tone: 'good', issues: [] },
    observations: '', days: [] }];
  const out = mergePlan(status, ai, '2026-09-29', Date.parse('2026-09-29T10:00:00Z'));
  assert.deepEqual(out.status.plants.a.history, [{ date: '2026-09-29', stage: 'flowering' }]);
});

test('the planner repeating the same stage records nothing', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'flowering', notes: [], history: [] } } };
  const ai = [{ id: 'a', stage: 'flowering', health: { label: 'steady', tone: 'good', issues: [] },
    observations: '', days: [] }];
  const out = mergePlan(status, ai, '2026-09-29', Date.parse('2026-09-29T10:00:00Z'));
  assert.deepEqual(out.status.plants.a.history, []);
});
