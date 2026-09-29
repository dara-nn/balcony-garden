import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherAlerts, normalizeHealth } from '../public/care-rules.js';

const balcony = (interval) => ({ id: 'p', name: 'Tigerella', area: 'balcony', interval });
const indoor = (interval) => ({ id: 'm', name: 'Monstera', area: 'indoor', interval });






test('a hot day warns about venting and names the balcony plants', () => {
  const out = weatherAlerts('2026-08-07', { tmax: 28, tmin: 16 }, [balcony(2), indoor(7)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].cat, 'alert');
  assert.equal(out[0].key, 'heat|2026-08-07');
  assert.match(out[0].what, /28/);
  assert.deepEqual(out[0].plants, ['Tigerella']);
});

test('a cold night warns about the glazing', () => {
  const out = weatherAlerts('2026-08-07', { tmax: 18, tmin: 8 }, [balcony(2)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'cold|2026-08-07');
  assert.match(out[0].what, /8/);
});

test('a day that is both hot and cold warns twice, cold first', () => {
  const out = weatherAlerts('2026-08-07', { tmax: 30, tmin: 9 }, [balcony(2)]);
  assert.deepEqual(out.map((a) => a.key), ['cold|2026-08-07', 'heat|2026-08-07']);
});

test('an all-indoor garden gets no weather alerts', () => {
  assert.deepEqual(weatherAlerts('2026-08-07', { tmax: 30, tmin: 5 }, [indoor(7)]), []);
});

test('a mild day gets no weather alerts', () => {
  assert.deepEqual(weatherAlerts('2026-08-07', { tmax: 22, tmin: 14 }, [balcony(2)]), []);
});

test('a day with no forecast gets no weather alerts', () => {
  assert.deepEqual(weatherAlerts('2026-08-07', undefined, [balcony(2)]), []);
});

test('a health read keeps the words the model chose', () => {
  const h = normalizeHealth({ label: 'bouncing back', tone: 'good', issues: [] });
  assert.equal(h.label, 'bouncing back');
  assert.equal(h.tone, 'good');
});

test('an old fixed-list health read still renders', () => {
  assert.deepEqual(normalizeHealth({ overall: 'thriving', issues: [] }), { label: 'thriving', tone: 'good', issues: [] });
  assert.equal(normalizeHealth({ overall: 'steady' }).tone, 'watch');
  assert.equal(normalizeHealth({ overall: 'struggling' }).tone, 'bad');
});

test('an unknown tone falls back to the neutral one', () => {
  assert.equal(normalizeHealth({ label: 'odd', tone: 'sideways' }).tone, 'watch');
});

test('nothing to report reads as nothing', () => {
  assert.equal(normalizeHealth(null), null);
  assert.equal(normalizeHealth({}), null);
});
