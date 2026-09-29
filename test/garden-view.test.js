import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByArea, daysSince, waterLabel, historyStream, phaseOfStage, seasonSpans, photosInView, chartWindow, monthTicks, tagEntryText, journalGroups } from '../public/garden-view.js';

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

/* ---- chart window ---- */

test('the window starts at the earliest thing known and ends 3 months out at least', () => {
  const w = chartWindow({
    spans: [[['grow', '2026-07-01', '2026-08-01']]],
    histories: [[{ date: '2026-06-10', stage: 'growing' }]],
    upcomings: [[]],
    today: '2026-09-29',
    monthsAhead: 3,
  });
  assert.equal(w.start, '2026-06-10');   // earlier than any span
  assert.equal(w.end, '2026-12-29');     // today + 3 months, past the last span
});

test('a predicted change beyond 3 months stretches the window to reach it', () => {
  const w = chartWindow({
    spans: [[['grow', '2026-07-01', '2026-08-01']]],
    histories: [[]],
    upcomings: [[{ stage: 'flowering', date: '2027-04-01' }]],
    today: '2026-09-29',
    monthsAhead: 3,
  });
  assert.equal(w.end, '2027-04-01');
});

test('a span running past 3 months is not cut off', () => {
  const w = chartWindow({
    spans: [[['harvest', '2026-07-01', '2027-06-01']]],
    histories: [[]], upcomings: [[]], today: '2026-09-29', monthsAhead: 3,
  });
  assert.equal(w.end, '2027-06-01');
});

test('a garden with nothing recorded still gets a usable window', () => {
  const w = chartWindow({ spans: [], histories: [], upcomings: [], today: '2026-09-29', monthsAhead: 3 });
  assert.ok(w.start <= '2026-09-29');
  assert.ok(w.end >= '2026-12-29');
});

test('month ticks cover the window, first of each month', () => {
  const ticks = monthTicks('2026-06-10', '2026-10-05');
  assert.deepEqual(ticks.map((t) => t.date), ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
  assert.deepEqual(ticks.map((t) => t.label), ['Jul', 'Aug', 'Sep', 'Oct']);
});

test('month ticks cross a year boundary', () => {
  const ticks = monthTicks('2026-11-15', '2027-02-02');
  assert.deepEqual(ticks.map((t) => t.label), ['Dec', 'Jan', 'Feb']);
});

/* ---- predicted future ---- */

test('a predicted change moves a future boundary', () => {
  const out = seasonSpans(DEF, [], [{ stage: 'harvesting', date: '2026-09-20' }], '2026-12-29');
  assert.deepEqual(out.find((s) => s[0] === 'harvest').slice(0, 2), ['harvest', '2026-09-20']);
});

test('a predicted stage the species table lacks is appended, running to the window end', () => {
  const out = seasonSpans(DEF, [], [{ stage: 'fruiting', date: '2026-11-01' }], '2026-12-29');
  const last = out[out.length - 1];
  assert.deepEqual(last, ['fruit', '2026-11-01', '2026-12-29']);
});

test('two predicted changes run one into the next', () => {
  const out = seasonSpans(DEF, [],
    [{ stage: 'fruiting', date: '2026-11-01' }, { stage: 'dormant', date: '2026-12-01' }], '2026-12-29');
  const fruit = out.find((s) => s[0] === 'fruit');
  assert.deepEqual(fruit, ['fruit', '2026-11-01', '2026-12-01']);
});

test('a recorded change always beats a prediction for the same phase', () => {
  const out = seasonSpans(DEF, [{ date: '2026-08-20', stage: 'flowering' }],
    [{ stage: 'flowering', date: '2026-09-15' }], '2026-12-29');
  assert.equal(out.find((s) => s[0] === 'flower')[1], '2026-08-20');
});

test('no predictions leaves the old two-argument behaviour intact', () => {
  assert.deepEqual(seasonSpans(DEF, [], [], '2026-12-29'), DEF);
  assert.deepEqual(seasonSpans(DEF, []), DEF);
});

test('predictions never invert a span', () => {
  const out = seasonSpans(DEF, [{ date: '2026-09-25', stage: 'harvesting' }],
    [{ stage: 'flowering', date: '2026-12-01' }], '2026-12-29');
  for (const [, from, to] of out) assert.ok(from <= to, `${from} is after ${to}`);
});

test('a prediction later than the span it names pushes that span out, it does not collapse it', () => {
  // Real case: garlic's table has harvest 10 Aug to 15 Sep, the planner expects
  // harvesting to start 5 Oct. The bar must show harvest ahead, not lose it.
  const garlic = [['grow', '2026-06-29', '2026-08-10'], ['harvest', '2026-08-10', '2026-09-15']];
  const out = seasonSpans(garlic, [], [{ stage: 'harvesting', date: '2026-10-05' }], '2026-12-29');
  assert.deepEqual(out, [
    ['grow', '2026-06-29', '2026-10-05'],
    ['harvest', '2026-10-05', '2026-12-29'],
  ]);
});

test('a span still ends where the next one begins', () => {
  const out = seasonSpans(DEF, [{ date: '2026-08-20', stage: 'flowering' }], [], '2026-12-29');
  assert.equal(out[0][2], out[1][1]);
  assert.equal(out[1][2], out[2][1]);
});

/* ---- plant mentions become tags ---- */

const M = (plantId, label, mention) => ({ plantId, label, mention });

test('a plant mentioned by name becomes a tag', () => {
  const out = tagEntryText('Tigerella snapped today.', [M('tomato-1', 'Tigerella', 'Tigerella')]);
  assert.deepEqual(out, [
    { type: 'tags', plants: [{ plantId: 'tomato-1', label: 'Tigerella' }] },
    { type: 'text', text: ' snapped today.' },
  ]);
});

test('one phrase covering several plants becomes several tags in its place', () => {
  const out = tagEntryText('spider mite on all raspberry', [
    M('rasp-takala-1', 'Takalan Herkku 1', 'all raspberry'),
    M('rasp-takala-2', 'Takalan Herkku 2', 'all raspberry'),
    M('rasp-maurin', 'Maurin Makea', 'all raspberry'),
  ]);
  assert.deepEqual(out, [
    { type: 'text', text: 'spider mite on ' },
    { type: 'tags', plants: [
      { plantId: 'rasp-takala-1', label: 'Takalan Herkku 1' },
      { plantId: 'rasp-takala-2', label: 'Takalan Herkku 2' },
      { plantId: 'rasp-maurin', label: 'Maurin Makea' },
    ] },
  ]);
});

test('the whole example entry', () => {
  const out = tagEntryText('Tigerella snapped today. I have spider mite on all raspberry', [
    M('tomato-1', 'Tigerella', 'Tigerella'),
    M('rasp-takala-1', 'Takalan Herkku 1', 'all raspberry'),
    M('rasp-maurin', 'Maurin Makea', 'all raspberry'),
  ]);
  assert.deepEqual(out.map((s) => s.type), ['tags', 'text', 'tags']);
  assert.equal(out[1].text, ' snapped today. I have spider mite on ');
  assert.deepEqual(out[2].plants.map((p) => p.plantId), ['rasp-takala-1', 'rasp-maurin']);
});

test('matching ignores case', () => {
  const out = tagEntryText('the tigerella is fine', [M('tomato-1', 'Tigerella', 'Tigerella')]);
  assert.deepEqual(out.map((s) => s.type), ['text', 'tags', 'text']);
  assert.equal(out[0].text, 'the ');
});

test('a mention that is not in the text is dropped rather than guessed at', () => {
  const out = tagEntryText('everything looks fine', [M('tomato-1', 'Tigerella', 'Tigerella')]);
  assert.deepEqual(out, [{ type: 'text', text: 'everything looks fine' }]);
});

test('the longer phrase wins when two mentions overlap', () => {
  const out = tagEntryText('the chilli seedlings are cold', [
    M('chilli-1', 'Lombardo 1', 'chilli'),
    M('chilli-2', 'Lombardo 2', 'chilli seedlings'),
  ]);
  assert.deepEqual(out.map((s) => s.type), ['text', 'tags', 'text']);
  assert.deepEqual(out[1].plants.map((p) => p.plantId), ['chilli-2']);
  assert.equal(out[2].text, ' are cold');
});

test('the same plant named twice is tagged twice', () => {
  const out = tagEntryText('Tigerella is fine, Tigerella is tall', [M('tomato-1', 'Tigerella', 'Tigerella')]);
  assert.equal(out.filter((s) => s.type === 'tags').length, 2);
});

test('no mentions leaves the text whole', () => {
  assert.deepEqual(tagEntryText('just a thought', []), [{ type: 'text', text: 'just a thought' }]);
  assert.deepEqual(tagEntryText('just a thought'), [{ type: 'text', text: 'just a thought' }]);
});

test('an empty entry yields nothing to render', () => {
  assert.deepEqual(tagEntryText('', [M('a', 'A', 'A')]), []);
});

/* ---- journal grouping ---- */

test('entries group under their month, newest month first', () => {
  const out = journalGroups([{ date: '2026-08-11' }, { date: '2026-07-27' }, { date: '2026-08-02' }]);
  assert.deepEqual(out.map((g) => g.label), ['August 2026', 'July 2026']);
  assert.deepEqual(out[0].entries.map((e) => e.date), ['2026-08-11', '2026-08-02']);
});

test('a long silence between entries is marked', () => {
  const out = journalGroups([{ date: '2026-09-29' }, { date: '2026-07-27' }]);   // 64 days
  const all = out.flatMap((g) => g.entries);
  assert.equal(all[0].gapAfter, '2 months earlier');
  assert.equal(all[1].gapAfter, null);   // nothing before it to be silent about
});

test('a gap of a few weeks reads in weeks', () => {
  const out = journalGroups([{ date: '2026-09-29' }, { date: '2026-09-01' }]);   // 28 days
  assert.equal(out[0].entries[0].gapAfter, '4 weeks earlier');
});

test('entries close together are not marked', () => {
  const out = journalGroups([{ date: '2026-08-11' }, { date: '2026-08-02' }]);
  assert.equal(out[0].entries[0].gapAfter, null);
});

test('a gap of a couple of months reads in months', () => {
  const out = journalGroups([{ date: '2026-09-29' }, { date: '2026-06-01' }]);
  assert.equal(out[0].entries[0].gapAfter, '4 months earlier');
});

test('an empty journal has no groups', () => {
  assert.deepEqual(journalGroups([]), []);
  assert.deepEqual(journalGroups(), []);
});
