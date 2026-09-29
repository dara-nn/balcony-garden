import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByArea, daysSince, waterLabel, historyStream, phaseOfStage, seasonSpans, photosInView } from '../public/garden-view.js';

const p = (id, area) => ({ id, name: id, area });

test('balcony comes before indoor', () => {
  const out = groupByArea([p('m', 'indoor'), p('t', 'balcony')]);
  assert.deepEqual(out.map((g) => g.area), ['balcony', 'indoor']);
  assert.deepEqual(out[0].plants.map((x) => x.id), ['t']);
});

test('a group with no plants is left out', () => {
  const out = groupByArea([p('t', 'balcony')]);
  assert.deepEqual(out.map((g) => g.area), ['balcony']);
});

test('a plant with no area recorded is on the balcony', () => {
  const out = groupByArea([{ id: 'x', name: 'x' }]);
  assert.deepEqual(out[0].area, 'balcony');
  assert.deepEqual(out[0].plants.map((x) => x.id), ['x']);
});

test('an unknown area is treated as balcony rather than dropped', () => {
  const out = groupByArea([p('x', 'greenhouse')]);
  assert.deepEqual(out.map((g) => g.area), ['balcony']);
  assert.deepEqual(out[0].plants.map((x) => x.id), ['x']);
});

test('groups carry an English label', () => {
  const out = groupByArea([p('t', 'balcony'), p('m', 'indoor')]);
  assert.deepEqual(out.map((g) => g.label), ['Balcony', 'Indoor']);
});

test('days since counts whole days', () => {
  assert.equal(daysSince('2026-09-29', '2026-09-29'), 0);
  assert.equal(daysSince('2026-09-28', '2026-09-29'), 1);
  assert.equal(daysSince('2026-09-01', '2026-09-29'), 28);
});

test('a watering date in the future reads as today, not as a negative', () => {
  assert.equal(daysSince('2026-10-05', '2026-09-29'), 0);
  assert.equal(waterLabel('2026-10-05', '2026-09-29'), 'watered today');
});

test('the water label reads in English and gets the singular right', () => {
  assert.equal(waterLabel('2026-09-29', '2026-09-29'), 'watered today');
  assert.equal(waterLabel('2026-09-28', '2026-09-29'), 'watered 1 day ago');
  assert.equal(waterLabel('2026-09-27', '2026-09-29'), 'watered 2 days ago');
});

test('a plant that has never been watered says so', () => {
  assert.equal(waterLabel(undefined, '2026-09-29'), 'never watered');
  assert.equal(waterLabel('', '2026-09-29'), 'never watered');
});

test('a note and its same-day photo are one entry', () => {
  const out = historyStream(
    [{ id: 'n1', date: '2026-09-28', text: 'snapped a branch', plantId: 'a' }],
    [{ id: 'ph1', date: '2026-09-28', plant: 'a' }],
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].notes.map((n) => n.id), ['n1']);
  assert.deepEqual(out[0].photoIds, ['ph1']);
});

test('newest first', () => {
  const out = historyStream([
    { id: 'old', date: '2026-09-01', text: 'x', plantId: 'a' },
    { id: 'new', date: '2026-09-28', text: 'y', plantId: 'a' },
  ], []);
  assert.deepEqual(out.map((e) => e.notes[0].id), ['new', 'old']);
});

test('the same day on two plants stays two entries', () => {
  const out = historyStream([
    { id: 'n1', date: '2026-09-28', text: 'x', plantId: 'a' },
    { id: 'n2', date: '2026-09-28', text: 'y', plantId: 'b' },
  ], []);
  assert.equal(out.length, 2);
});

test('a photo with no note still shows up', () => {
  const out = historyStream([], [{ id: 'ph1', date: '2026-09-28', plant: 'a' }]);
  assert.deepEqual(out, [{ date: '2026-09-28', plantId: 'a', notes: [], photoIds: ['ph1'] }]);
});

test('an untagged photo is its own entry and does not join a plant note', () => {
  const out = historyStream(
    [{ id: 'n1', date: '2026-09-28', text: 'x', plantId: 'a' }],
    [{ id: 'loose', date: '2026-09-28' }],
  );
  assert.equal(out.length, 2);
  const loose = out.find((e) => e.plantId === null);
  assert.deepEqual(loose.photoIds, ['loose']);
  assert.deepEqual(out.find((e) => e.plantId === 'a').photoIds, []);
});

test('an entry with no date is dropped rather than sorted to the top', () => {
  const out = historyStream([{ id: 'n1', text: 'x', plantId: 'a' }], []);
  assert.deepEqual(out, []);
});

const DEF = [
  ['grow', '2026-07-01', '2026-08-01'],
  ['flower', '2026-08-01', '2026-09-01'],
  ['harvest', '2026-09-01', '2026-10-01'],
];

test('every stage the care table uses maps to a phase', () => {
  assert.equal(phaseOfStage('seedling'), 'grow');
  assert.equal(phaseOfStage('sprouting'), 'grow');
  assert.equal(phaseOfStage('settling'), 'grow');
  assert.equal(phaseOfStage('establishing'), 'grow');
  assert.equal(phaseOfStage('growing'), 'grow');
  assert.equal(phaseOfStage('bulbing'), 'grow');
  assert.equal(phaseOfStage('flowering'), 'flower');
  assert.equal(phaseOfStage('fruiting'), 'fruit');
  assert.equal(phaseOfStage('harvesting'), 'harvest');
  assert.equal(phaseOfStage('dormant'), null);
  assert.equal(phaseOfStage(undefined), null);
});

test('no history leaves the species defaults alone', () => {
  assert.deepEqual(seasonSpans(DEF, []), DEF);
  assert.deepEqual(seasonSpans(DEF, undefined), DEF);
});

test('a real transition moves the boundary', () => {
  const out = seasonSpans(DEF, [{ date: '2026-08-20', stage: 'flowering' }]);
  assert.deepEqual(out, [
    ['grow', '2026-07-01', '2026-08-20'],
    ['flower', '2026-08-20', '2026-09-01'],
    ['harvest', '2026-09-01', '2026-10-01'],
  ]);
});

test('a transition later than the span that follows it does not invert the bar', () => {
  const out = seasonSpans(DEF, [{ date: '2026-09-20', stage: 'flowering' }]);
  for (const [, from, to] of out) assert.ok(from <= to, `${from} is after ${to}`);
  assert.deepEqual(out[1], ['flower', '2026-09-20', '2026-09-20']);
});

test('two transitions on the same day do not produce a negative span', () => {
  const out = seasonSpans(DEF, [
    { date: '2026-08-15', stage: 'flowering' },
    { date: '2026-08-15', stage: 'harvesting' },
  ]);
  for (const [, from, to] of out) assert.ok(from <= to, `${from} is after ${to}`);
});

test('history out of order is read in date order', () => {
  const a = seasonSpans(DEF, [
    { date: '2026-09-10', stage: 'harvesting' },
    { date: '2026-08-20', stage: 'flowering' },
  ]);
  const b = seasonSpans(DEF, [
    { date: '2026-08-20', stage: 'flowering' },
    { date: '2026-09-10', stage: 'harvesting' },
  ]);
  assert.deepEqual(a, b);
});

test('a recorded stage the species bar does not have is ignored', () => {
  assert.deepEqual(seasonSpans(DEF, [{ date: '2026-08-10', stage: 'fruiting' }]), DEF);
});

test('a plant with no species bar comes back empty', () => {
  assert.deepEqual(seasonSpans([], [{ date: '2026-08-10', stage: 'flowering' }]), []);
});

test('the all-plants view shows untagged photos', () => {
  const photos = [{ id: 'a', plant: 'tomato-1' }, { id: 'loose' }, { id: 'x', plant: 'gone' }];
  assert.deepEqual(photosInView(photos, ['tomato-1'], true).map((p) => p.id), ['a', 'loose']);
});

test('a plant page shows only that plant, never an untagged photo', () => {
  const photos = [{ id: 'a', plant: 'tomato-1' }, { id: 'loose' }, { id: 'b', plant: 'monstera' }];
  assert.deepEqual(photosInView(photos, ['monstera'], false).map((p) => p.id), ['b']);
});

test('a photo tagged to a plant that is gone is dropped from both views', () => {
  const photos = [{ id: 'x', plant: 'deleted-plant' }];
  assert.deepEqual(photosInView(photos, ['tomato-1'], true), []);
  assert.deepEqual(photosInView(photos, ['tomato-1'], false), []);
});
