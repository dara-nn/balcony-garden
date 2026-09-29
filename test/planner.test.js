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

test('mergePlan turns guidance into the care doc', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', notes: [], history: [] } } };
  const ai = [{ id: 'a', guidance: 'Water every two days. Feed weekly.',
    health: { label: 'thirsty', tone: 'watch', issues: [] }, observations: 'dry soil' }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care, { generatedAt: 1000,
    plants: { a: { guidance: 'Water every two days. Feed weekly.', upcoming: [] } } });
  assert.equal(out.care.through, undefined);
});

test('mergePlan drops a plant the inventory no longer has', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [
    { id: 'a', guidance: 'Keep it steady.', health: { label: 'fine', tone: 'good', issues: [] }, observations: '' },
    { id: 'ghost', guidance: 'Water the plant that is not there.', health: { label: 'x', tone: 'good', issues: [] }, observations: '' },
  ];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(Object.keys(out.care.plants), ['a']);
  assert.deepEqual(Object.keys(out.status.plants), ['a']);
});

test('mergePlan skips a plant with no guidance rather than storing an empty string', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [{ id: 'a', health: { label: 'fine', tone: 'good', issues: [] }, observations: '' }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care.plants, {});
});

test('parsePlanResponse reads guidance out of a thinking response', () => {
  const body = { candidates: [{ content: { parts: [
    { thought: true },
    { text: JSON.stringify({ plants: [{ id: 'a', guidance: 'Water it.' }] }) },
  ] } }] };
  assert.deepEqual(parsePlanResponse(body), [{ id: 'a', guidance: 'Water it.' }]);
});

test('mergePlan carries the expected upcoming changes into the care doc', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'flowering', notes: [], history: [] } } };
  const ai = [{ id: 'a', guidance: 'Water it.', health: { label: 'fine', tone: 'good', issues: [] },
    observations: 'doing well', upcoming: [{ stage: 'fruiting', date: '2026-11-01' }] }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care.plants.a.upcoming, [{ stage: 'fruiting', date: '2026-11-01' }]);
});

test('a plant with no expected changes gets an empty list, not undefined', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [{ id: 'a', guidance: 'Water it.', health: { label: 'fine', tone: 'good', issues: [] }, observations: '' }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care.plants.a.upcoming, []);
});

test('an expected change with no date is dropped', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [{ id: 'a', guidance: 'Water it.', health: { label: 'f', tone: 'good', issues: [] }, observations: '',
    upcoming: [{ stage: 'fruiting' }, { stage: 'harvesting', date: '2026-12-01' }] }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care.plants.a.upcoming, [{ stage: 'harvesting', date: '2026-12-01' }]);
});
