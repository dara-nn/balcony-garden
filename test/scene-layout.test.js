import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSeed } from '../src/seed.js';
import { PLACEMENT, POT_SIZE, slotFor, slotsFor, markerFor, TONE_RING, inScene } from '../public/scene/layout.js';

const seed = parseSeed(await readFile(new URL('../public/garden-data.js', import.meta.url), 'utf8'));

test('every balcony plant in the inventory has a place on the balcony', () => {
  const missing = seed.plants.filter(inScene).filter((p) => !PLACEMENT[p.id]).map((p) => p.id);
  assert.deepEqual(missing, [], 'plants with no slot: ' + missing.join(', '));
});

test('no two plants stand in the same spot', () => {
  const seen = new Map();
  for (const [id, s] of Object.entries(PLACEMENT)) {
    const key = [s.x, s.y, s.z].join('|');
    assert.equal(seen.has(key), false, `${id} collides with ${seen.get(key)}`);
    seen.set(key, id);
  }
});

test('placement kinds all have a pot size', () => {
  for (const [id, s] of Object.entries(PLACEMENT))
    assert.ok(POT_SIZE[s.kind], `${id} uses unknown kind ${s.kind}`);
});

test('indoor plants are kept out of the balcony scene entirely', () => {
  const indoor = seed.plants.filter((p) => !inScene(p)).map((p) => p.id);
  assert.deepEqual(indoor, ['monstera'], 'the inventory should have exactly one indoor plant');
  for (const id of indoor)
    assert.equal(PLACEMENT[id], undefined, `${id} lives indoors and must not be placed on the balcony`);
});

test('inScene defaults a plant with no area to the balcony', () => {
  assert.equal(inScene({ id: 'x' }), true);
  assert.equal(inScene({ id: 'x', area: 'balcony' }), true);
  assert.equal(inScene({ id: 'x', area: 'indoor' }), false);
});

test('an unplaced plant falls back to the overflow row rather than vanishing', () => {
  const a = slotFor('mystery-basil', 0);
  const b = slotFor('mystery-dill', 1);
  assert.equal(a.overflow, true);
  assert.equal(b.overflow, true);
  assert.notEqual(a.x, b.x, 'overflow plants must not stack on one spot');
  assert.ok(POT_SIZE[a.kind]);
});

test('slotsFor numbers overflow plants independently of placed ones', () => {
  const slots = slotsFor([
    { id: 'tomato-1' }, { id: 'ghost-1' }, { id: 'parsley-1' }, { id: 'ghost-2' },
  ]);
  assert.equal(slots[0].overflow, false);
  assert.equal(slots[2].overflow, false);
  assert.notEqual(slots[1].x, slots[3].x);
});

/* ---------- markers ---------- */
const plant = (over) => ({ id: 'tomato-1', health: over ? { tone: 'bad' } : null });
const waterTask = (what) => ({ key: 'w|tomato-1', cat: 'water', what });

test('no watering task today means no droplet', () => {
  const m = markerFor(plant(), [{ key: 'pollen|tomato-1|x', what: 'Shake' }], []);
  assert.equal(m.water, 'none');
  assert.equal(m.droop, 0);
});

test('a watering task shows the droplet and a slight lean', () => {
  const m = markerFor(plant(), [waterTask('Water')], []);
  assert.equal(m.water, 'due');
  assert.ok(m.droop > 0 && m.droop < 1);
});

test('an overdue watering droops all the way', () => {
  const m = markerFor(plant(), [waterTask('Water (overdue)')], []);
  assert.equal(m.water, 'overdue');
  assert.equal(m.droop, 1);
});

test('ticking the task clears the droplet and stands the plant back up', () => {
  const m = markerFor(plant(), [waterTask('Water (overdue)')], ['w|tomato-1']);
  assert.equal(m.water, 'done');
  assert.equal(m.droop, 0);
});

test('the ground ring is only drawn once the model has read the plant', () => {
  assert.equal(markerFor(plant(false), [], []).tone, null);
  assert.equal(TONE_RING[markerFor(plant(true), [], []).tone], TONE_RING.bad);
});

test('pending counts only the tasks still outstanding', () => {
  const tasks = [waterTask('Water'), { key: 'wk|tomato-1|Feed', what: 'Feed' }];
  assert.equal(markerFor(plant(), tasks, []).pending, 2);
  assert.equal(markerFor(plant(), tasks, ['w|tomato-1']).pending, 1);
  assert.equal(markerFor(plant(), tasks, []).taskCount, 2);
});

test('a plant with no task list at all is handled', () => {
  const m = markerFor(plant(), null, null);
  assert.equal(m.water, 'none');
  assert.equal(m.pending, 0);
});
