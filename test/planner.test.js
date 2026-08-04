import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPhotos, parseForecast, parsePlanResponse, mergePlan } from '../src/planner.js';

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

test('parsePlanResponse extracts JSON from a Gemini response', () => {
  const payload = { plants: { a: { health: { overall: 'steady', issues: [] }, observations: 'ok', days: {} } } };
  const gemini = { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] };
  assert.deepEqual(parsePlanResponse(gemini), payload.plants);
});

test('mergePlan writes condition to status and tasks to plan with stable keys', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = { a: { health: { overall: 'struggling', issues: [{ type: 'pest', label: 'aphids', severity: 'mild' }] },
    observations: 'aphids seen', stage: 'fruiting',
    days: { '2026-07-26': [{ cat: 'care', ico: '🔍', what: 'Check aphids', why: 'note' }] } } };
  const { status: s2, plan } = mergePlan(status, ai, '2026-07-26', 100);
  assert.equal(s2.plants.a.stage, 'fruiting');
  assert.equal(s2.plants.a.health.overall, 'struggling');
  assert.equal(plan.plants.a['2026-07-26'][0].key, 'ai|a|2026-07-26|0');
  assert.equal(plan.through, '2026-08-08');
});
