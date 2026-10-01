import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByArea, daysSince, waterLabel, phaseOfStage, seasonSpans, withStart, chartWindow, monthTicks, tagEntryText, journalGroups, plantPhotos, findMentions, mentionQuery, mentionSegments } from '../public/garden-view.js';

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
  assert.equal(waterLabel('2026-10-05', '2026-09-29'), 'Last watered today');
});

test('the water label reads in English and gets the singular right', () => {
  assert.equal(waterLabel('2026-09-29', '2026-09-29'), 'Last watered today');
  assert.equal(waterLabel('2026-09-28', '2026-09-29'), 'Last watered 1 day ago');
  assert.equal(waterLabel('2026-09-27', '2026-09-29'), 'Last watered 2 days ago');
});

test('a plant that has never been watered says so', () => {
  assert.equal(waterLabel(undefined, '2026-09-29'), 'Not watered yet');
  assert.equal(waterLabel('', '2026-09-29'), 'Not watered yet');
});

const DEF = [
  ['grow', '2026-07-01', '2026-08-01'],
  ['flower', '2026-08-01', '2026-09-01'],
  ['harvest', '2026-09-01', '2026-10-01'],
];

test('every stage the care table uses maps to a phase', () => {
  assert.equal(phaseOfStage('seedling'), 'seed');
  assert.equal(phaseOfStage('sprouting'), 'seed');
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

/* ---- chart window ---- */

test('the window starts at the earliest thing known and ends 3 months out at least', () => {
  const w = chartWindow({
    spans: [[['grow', '2026-07-01', '2026-08-01']]],
    histories: [[{ date: '2026-06-10', stage: 'growing' }]],
    upcomings: [[]],
    today: '2026-09-29',
    monthsAhead: 3,
  });
  assert.equal(w.start, '2026-05-10');   // a month before the earliest thing known
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
  // Real case from an older inventory: the table had harvest 10 Aug to 15 Sep,
  // the planner expected harvesting to start 5 Oct. The bar must show harvest
  // ahead, not lose it.
  const table = [['grow', '2026-06-29', '2026-08-10'], ['harvest', '2026-08-10', '2026-09-15']];
  const out = seasonSpans(table, [], [{ stage: 'harvesting', date: '2026-10-05' }], '2026-12-29');
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

/* ---- the bar must agree with the stage the plant is actually in ---- */

test('the phase the plant is in covers today, even with nothing recorded', () => {
  // Tigerella: the table says harvest by now, the plant says flowering.
  const out = seasonSpans(DEF, [], [], '2026-12-29', { stage: 'flowering', date: '2026-09-29' });
  const flower = out.find((s) => s[0] === 'flower');
  assert.ok(flower[1] <= '2026-09-29' && flower[2] >= '2026-09-29',
    `flowering should cover today, got ${flower[1]} to ${flower[2]}`);
});

test('the phases after it slide along, keeping their lengths', () => {
  const out = seasonSpans(DEF, [], [], '2026-12-29', { stage: 'flowering', date: '2026-09-29' });
  const harvest = out.find((s) => s[0] === 'harvest');
  // spans meet at a boundary, so beginning exactly today is correct
  assert.ok(harvest[1] >= '2026-09-29', 'harvest must not still be in the past');
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  assert.equal(days(out[2][1], out[2][2]), days(DEF[2][1], DEF[2][2]));   // length preserved
});

test('a plant already on schedule is left alone', () => {
  const out = seasonSpans(DEF, [], [], '2026-12-29', { stage: 'harvesting', date: '2026-09-15' });
  assert.deepEqual(out, DEF);
});

test('a recorded transition still beats the current stage', () => {
  const out = seasonSpans(DEF, [{ date: '2026-08-20', stage: 'flowering' }], [], '2026-12-29',
    { stage: 'flowering', date: '2026-09-29' });
  assert.equal(out.find((s) => s[0] === 'flower')[1], '2026-08-20');
});

test('a stage with no colour leaves the bar alone', () => {
  assert.deepEqual(seasonSpans(DEF, [], [], '2026-12-29', { stage: 'dormant', date: '2026-09-29' }), DEF);
});

test('no current stage keeps the old behaviour', () => {
  assert.deepEqual(seasonSpans(DEF, [], [], '2026-12-29'), DEF);
  assert.deepEqual(seasonSpans(DEF, [], [], '2026-12-29', null), DEF);
});

test('sliding never inverts a span', () => {
  for (const stage of ['growing', 'flowering', 'fruiting', 'harvesting']) {
    for (const date of ['2026-06-01', '2026-08-15', '2026-09-29', '2026-12-01']) {
      const out = seasonSpans(DEF, [], [], '2027-03-01', { stage, date });
      for (const [, f, t] of out) assert.ok(f <= t, `${stage} ${date}: ${f} after ${t}`);
    }
  }
});

/* ---- a phase the plant is already in cannot still be waiting to start ---- */

test('the other stage words the planner uses map to a phase too', () => {
  assert.equal(phaseOfStage('vegetative'), 'grow');
  assert.equal(phaseOfStage('established'), 'grow');
  assert.equal(phaseOfStage('ready'), 'harvest');
});

test('a prediction that the plant will enter the phase it is already in is dropped', () => {
  // Monstera: the planner expected growing to start on 15 Oct, but the plant is
  // recorded as settling today, which is already the growing phase. Today must
  // land inside a band, not on bare track.
  const table = [['grow', '2026-06-29', '2026-10-05']];
  const out = seasonSpans(table, [], [{ stage: 'growing', date: '2026-10-15' }], '2026-12-30',
    { stage: 'settling', date: '2026-09-30' });
  assert.deepEqual(out, [['grow', '2026-06-29', '2026-10-05']]);
});

test('a prediction for the current phase that is already past still counts', () => {
  const table = [['grow', '2026-06-29', '2026-10-05']];
  const out = seasonSpans(table, [], [{ stage: 'growing', date: '2026-08-15' }], '2026-12-30',
    { stage: 'settling', date: '2026-09-30' });
  assert.equal(out[0][1], '2026-08-15');
});

test('a phase the table puts in the future still covers today when the plant is in it', () => {
  const out = seasonSpans(DEF, [], [], '2026-12-29', { stage: 'harvesting', date: '2026-07-15' });
  const harvest = out.find((s) => s[0] === 'harvest');
  assert.ok(harvest[1] <= '2026-07-15' && harvest[2] >= '2026-07-15',
    `harvest should cover today, got ${harvest[1]} to ${harvest[2]}`);
  assert.equal(out.length, DEF.length, 'no phase is dropped');
  for (const [, f, t] of out) assert.ok(f <= t, `${f} after ${t}`);
});

test('whatever the prediction says, the phase the plant is in covers today', () => {
  for (const at of ['2026-05-01', '2026-08-15', '2026-09-30', '2026-11-20']) {
    for (const [stage, phase] of [['growing', 'grow'], ['flowering', 'flower'], ['harvesting', 'harvest']]) {
      const out = seasonSpans(DEF, [], [{ stage, date: at }], '2027-01-31',
        { stage, date: '2026-09-30' });
      const hit = out.find((s) => s[0] === phase);
      assert.ok(hit[1] <= '2026-09-30' && hit[2] >= '2026-09-30',
        `${stage} predicted ${at}: ${hit[1]} to ${hit[2]} does not cover today`);
      for (const [, f, t] of out) assert.ok(f <= t, `${stage} ${at}: ${f} after ${t}`);
    }
  }
});

test('an expected change with no phase of its own still ends the last span', () => {
  // The planner expects the raspberry to go dormant on 25 Oct. Dormancy has no
  // band of its own, but the harvest band cannot run straight through it.
  const table = [['grow', '2026-06-29', '2026-08-10'], ['harvest', '2026-08-10', '2026-11-30']];
  const out = seasonSpans(table, [], [{ stage: 'dormant', date: '2026-10-25' }], '2026-12-29');
  assert.deepEqual(out[out.length - 1], ['harvest', '2026-08-10', '2026-10-25']);
});

test('an unphased change before the last span begins leaves it alone', () => {
  const table = [['grow', '2026-06-29', '2026-08-10'], ['harvest', '2026-08-10', '2026-11-30']];
  const out = seasonSpans(table, [], [{ stage: 'dormant', date: '2026-07-01' }], '2026-12-29');
  assert.deepEqual(out, table);
});

test('plantPhotos is one plant\'s photos, newest first', () => {
  const photos = [
    { id: 'a', plant: 't', date: '2026-08-01', created: 5 },
    { id: 'b', plant: 't', date: '2026-08-09', created: 1 },
    { id: 'c', plant: 'm', date: '2026-09-01', created: 9 },
    { id: 'd', plant: 't', date: '2026-08-09', created: 3 },
    { id: 'e', plant: '', date: '2026-09-02', created: 9 },
  ];
  assert.deepEqual(plantPhotos(photos, 't').map((p) => p.id), ['d', 'b', 'a']);
  assert.deepEqual(plantPhotos(photos, 'x'), []);
  assert.deepEqual(plantPhotos(null, 't'), []);
});

/* ---- where the plant's own season begins ---- */

test('no start date leaves the spans exactly as they were', () => {
  assert.deepEqual(withStart(DEF, undefined), DEF);
  assert.deepEqual(withStart(DEF, ''), DEF);
  assert.deepEqual(withStart([], '2026-04-12'), []);
});

test('a sown plant is a seedling for six weeks, then growing up to the table', () => {
  // Sown 12 Apr: seedling to 24 May, and the table's growing reaches back to meet it.
  const out = withStart(DEF, '2026-04-12', 'sown');
  assert.deepEqual(out, [
    ['seed', '2026-04-12', '2026-05-24'],
    ['grow', '2026-05-24', '2026-08-01'],
    ['flower', '2026-08-01', '2026-09-01'],
    ['harvest', '2026-09-01', '2026-10-01'],
  ]);
});

test('a start with no how given is treated as sown', () => {
  assert.deepEqual(withStart(DEF, '2026-04-12'), withStart(DEF, '2026-04-12', 'sown'));
});

test('a sown plant whose table opens on flowering still gets a growing phase between', () => {
  // The real tomato case: the table only starts at flowering, so without this
  // the seedling band ran for three months straight into flowers.
  const tomato = [['flower', '2026-06-29', '2026-09-30'], ['harvest', '2026-09-30', '2026-11-30']];
  assert.deepEqual(withStart(tomato, '2026-03-20', 'sown'), [
    ['seed', '2026-03-20', '2026-05-01'],
    ['grow', '2026-05-01', '2026-06-29'],
    ['flower', '2026-06-29', '2026-09-30'],
    ['harvest', '2026-09-30', '2026-11-30'],
  ]);
});

test('a seedling phase never runs past where the table begins', () => {
  // Sown three weeks before the table starts: seedling fills the gap, no growing band.
  const out = withStart(DEF, '2026-06-10', 'sown');
  assert.deepEqual(out[0], ['seed', '2026-06-10', '2026-07-01']);
  assert.deepEqual(out.slice(1), DEF);
});

test('a bought, planted or cutting plant skips seedling and starts growing', () => {
  for (const how of ['bought', 'planted', 'cutting']) {
    const out = withStart(DEF, '2026-04-12', how);
    assert.deepEqual(out[0], ['grow', '2026-04-12', '2026-08-01'], how);
    assert.equal(out.length, DEF.length, how);
  }
});

test('a bought plant whose table opens on flowering gets a growing band up to it', () => {
  const tomato = [['flower', '2026-06-29', '2026-09-30']];
  assert.deepEqual(withStart(tomato, '2026-05-01', 'bought'), [
    ['grow', '2026-05-01', '2026-06-29'],
    ['flower', '2026-06-29', '2026-09-30'],
  ]);
});

test('a start after the table begins cuts off what happened before the plant was here', () => {
  // Bought on 10 Aug: the July growing the table assumes never happened here.
  const out = withStart(DEF, '2026-08-10');
  assert.deepEqual(out, [
    ['flower', '2026-08-10', '2026-09-01'],
    ['harvest', '2026-09-01', '2026-10-01'],
  ]);
});

test('a start on the first phase day adds nothing and drops nothing', () => {
  assert.deepEqual(withStart(DEF, '2026-07-01'), DEF);
});

test('a start after the last phase ends keeps the last phase, starting there', () => {
  const out = withStart(DEF, '2026-10-15');
  assert.deepEqual(out, [['harvest', '2026-10-15', '2026-10-15']]);
});

test('withStart never changes the spans it was given', () => {
  const copy = DEF.map((s) => s.slice());
  withStart(DEF, '2026-08-10');
  withStart(DEF, '2026-04-12');
  assert.deepEqual(DEF, copy);
});

test('the chart window reaches back to a start date, with a month of room before it', () => {
  // So the start marker never sits on the bar's left edge.
  const w = chartWindow({ spans: [withStart(DEF, '2026-04-12')], today: '2026-09-30' });
  assert.equal(w.start, '2026-03-12');
});

const LABELS = [{ id: 't1', label: 'Takalan 1' }, { id: 't12', label: 'Takalan 12' }, { id: 'b', label: 'Basil' }];

test('findMentions picks up each @name once, case-insensitive, as written', () => {
  assert.deepEqual(findMentions('@basil and @takalan 12 look good, @Basil again', LABELS),
    [{ plantId: 't12', mention: '@takalan 12' }, { plantId: 'b', mention: '@basil' }]);
});
test('findMentions needs a word boundary after the name', () => {
  assert.deepEqual(findMentions('@Basilisk', LABELS), []);
  assert.deepEqual(findMentions('@Takalan 1.', LABELS), [{ plantId: 't1', mention: '@Takalan 1' }]);
  assert.deepEqual(findMentions('', LABELS), []);
});
test('mentionQuery reads the @word the caret is in', () => {
  assert.deepEqual(mentionQuery('hi @tak', 7), { start: 3, q: 'tak' });
  assert.deepEqual(mentionQuery('@', 1), { start: 0, q: '' });
  assert.equal(mentionQuery('mail a@b', 8), null);
  assert.equal(mentionQuery('@tak done', 9), null);
});

/* ---- the seedling phase ---- */

test('germinating and sprouting are seedling words; a bought plant settling in is growing', () => {
  for (const w of ['seedling', 'sprouting', 'germinating', 'sown']) assert.equal(phaseOfStage(w), 'seed', w);
  for (const w of ['settling', 'establishing', 'established']) assert.equal(phaseOfStage(w), 'grow', w);
});

test('a plant recorded as a seedling sits in a seedling band covering today', () => {
  // Lombardo chilli: the table says growing from 10 Jul, the plant is still a seedling.
  const table = [['grow', '2026-07-10', '2026-08-05'], ['flower', '2026-08-05', '2026-08-20']];
  const out = seasonSpans(table, [], [], '2026-12-30', { stage: 'seedling', date: '2026-09-30' });
  assert.equal(out[0][0], 'seed');
  assert.ok(out[0][1] <= '2026-09-30' && out[0][2] >= '2026-09-30', `seed ${out[0][1]} to ${out[0][2]}`);
  const grow = out.find((s) => s[0] === 'grow');
  assert.ok(grow[1] >= '2026-09-30', 'growing has not begun yet');
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  assert.equal(days(grow[1], grow[2]), days(table[0][1], table[0][2]), 'growing keeps its length');
});

test('a seedling ahead of the table starts its band today', () => {
  const out = seasonSpans(DEF, [], [], '2026-12-30', { stage: 'seedling', date: '2026-06-15' });
  assert.deepEqual(out[0], ['seed', '2026-06-15', '2026-07-01']);
  assert.deepEqual(out.slice(1), DEF);
});

test('a plant past the seedling stage gets no seedling band', () => {
  const out = seasonSpans(DEF, [], [], '2026-12-30', { stage: 'flowering', date: '2026-08-15' });
  assert.ok(!out.some((s) => s[0] === 'seed'));
});

test('a start date stretches an existing seedling band back rather than adding a second', () => {
  const spans = [['seed', '2026-07-01', '2026-09-30'], ['grow', '2026-09-30', '2026-10-26']];
  assert.deepEqual(withStart(spans, '2026-04-12'), [
    ['seed', '2026-04-12', '2026-09-30'], ['grow', '2026-09-30', '2026-10-26'],
  ]);
});

test('mentionSegments marks every @name, case-insensitive, and keeps the rest as text', () => {
  assert.deepEqual(mentionSegments('hi @basil and @Takalan 12, @BASIL!', LABELS), [
    { text: 'hi ' }, { text: '@basil', plantId: 'b' }, { text: ' and ' },
    { text: '@Takalan 12', plantId: 't12' }, { text: ', ' }, { text: '@BASIL', plantId: 'b' }, { text: '!' },
  ]);
  assert.deepEqual(mentionSegments('@Basilisk', LABELS), [{ text: '@Basilisk' }]);
  assert.deepEqual(mentionSegments('', LABELS), []);
});
