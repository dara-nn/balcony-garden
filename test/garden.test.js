import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStatus, KEYS, upsertPlant, applyNoteOp, dropDerivedNotes, recordStage, readCare, writeCare } from '../src/garden.js';

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

test('upsertPlant creates a plant with defaults', () => {
  const doc = { updatedAt: 0, plants: {} };
  const out = upsertPlant(doc, 'tomato-1', { name: 'Tigerella', species: 'tomato', stage: 'flowering' }, 100);
  assert.equal(out.plants['tomato-1'].stage, 'flowering');
  assert.deepEqual(out.plants['tomato-1'].notes, []);
  assert.deepEqual(out.plants['tomato-1'].history, []);
  assert.equal(out.plants['tomato-1'].updatedAt, 100);
  assert.equal(out.updatedAt, 100);
});

test('upsertPlant merges without dropping existing keys', () => {
  const doc = { updatedAt: 1, plants: { a: { id: 'a', stage: 'growing', notes: [{ id: 'n' }] } } };
  const out = upsertPlant(doc, 'a', { stage: 'harvesting' }, 200);
  assert.equal(out.plants.a.stage, 'harvesting');
  assert.equal(out.plants.a.notes.length, 1);
});

const base = () => ({ updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } });

test('applyNoteOp add appends a note', () => {
  const out = applyNoteOp(base(), { plantId: 'a', op: 'add', id: 'n1', date: '2026-07-26', text: 'yellow leaves' }, 10);
  assert.equal(out.plants.a.notes.length, 1);
  assert.equal(out.plants.a.notes[0].text, 'yellow leaves');
  assert.equal(out.plants.a.notes[0].createdAt, 10);
});

test('applyNoteOp edit and delete', () => {
  let doc = applyNoteOp(base(), { plantId: 'a', op: 'add', id: 'n1', date: '2026-07-26', text: 'x' }, 1);
  doc = applyNoteOp(doc, { plantId: 'a', op: 'edit', id: 'n1', text: 'y' }, 2);
  assert.equal(doc.plants.a.notes[0].text, 'y');
  doc = applyNoteOp(doc, { plantId: 'a', op: 'delete', id: 'n1' }, 3);
  assert.equal(doc.plants.a.notes.length, 0);
});

test('editing an AI note makes it the gardener\'s own', () => {
  let doc = { updatedAt: 0, plants: { a: { id: 'a', notes: [
    { id: 'n1', date: '2026-08-07', text: 'First stripes showing.', ai: true, quote: 'tigerella has stripes' },
  ] } } };
  doc = applyNoteOp(doc, { plantId: 'a', op: 'edit', id: 'n1', text: 'First stripes, low down only' }, 5);
  assert.equal(doc.plants.a.notes[0].text, 'First stripes, low down only');
  assert.equal(doc.plants.a.notes[0].ai, false);
  assert.equal(doc.plants.a.notes[0].quote, 'tigerella has stripes');   // what you wrote is still yours
});

test('re-sorting an entry drops the notes it produced', () => {
  const doc = { updatedAt: 0, plants: { a: { id: 'a', notes: [
    { id: 'n1', text: 'from the model', ai: true },
    { id: 'keep', text: 'unrelated note' },
  ] } } };
  const out = dropDerivedNotes(doc, [{ plantId: 'a', noteId: 'n1' }], 9);
  assert.deepEqual(out.plants.a.notes.map((n) => n.id), ['keep']);
});

test('re-sorting keeps a note the gardener has reworded', () => {
  const doc = { updatedAt: 0, plants: { a: { id: 'a', notes: [
    { id: 'n1', text: 'my own words', ai: false },
  ] } } };
  const out = dropDerivedNotes(doc, [{ plantId: 'a', noteId: 'n1' }], 9);
  assert.deepEqual(out.plants.a.notes.map((n) => n.id), ['n1']);
});

test('dropDerivedNotes ignores plants that are gone', () => {
  const doc = { updatedAt: 0, plants: {} };
  assert.deepEqual(dropDerivedNotes(doc, [{ plantId: 'ghost', noteId: 'x' }], 9).plants, {});
});

test('applyNoteOp throws for unknown plant', () => {
  assert.throws(() => applyNoteOp(base(), { plantId: 'zzz', op: 'add', text: 'x' }, 1), /unknown plant/);
});

test('the stage a plant is introduced at is a baseline, not a transition', () => {
  // Seeding a plant records what it already is. Dating that as a change is the
  // artefact the season bar exists to avoid.
  assert.deepEqual(recordStage(undefined, 'flowering', '2026-09-29'), []);
  assert.deepEqual(recordStage({ history: [] }, 'flowering', '2026-09-29'), []);
  assert.deepEqual(recordStage({ stage: undefined, history: [] }, 'flowering', '2026-09-29'), []);
});

test('recordStage appends when the stage changes', () => {
  const prev = { stage: 'growing', history: [{ date: '2026-08-01', stage: 'growing' }] };
  assert.deepEqual(recordStage(prev, 'flowering', '2026-09-29'), [
    { date: '2026-08-01', stage: 'growing' },
    { date: '2026-09-29', stage: 'flowering' },
  ]);
});

test('recordStage does nothing when the stage is unchanged', () => {
  const prev = { stage: 'flowering', history: [{ date: '2026-08-01', stage: 'flowering' }] };
  assert.deepEqual(recordStage(prev, 'flowering', '2026-09-29'),
    [{ date: '2026-08-01', stage: 'flowering' }]);
});

test('recordStage leaves history alone when no stage is supplied', () => {
  const prev = { stage: 'flowering', history: [{ date: '2026-08-01', stage: 'flowering' }] };
  assert.deepEqual(recordStage(prev, undefined, '2026-09-29'),
    [{ date: '2026-08-01', stage: 'flowering' }]);
});

test('upsertPlant records a stage change', () => {
  const doc = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', notes: [], history: [] } } };
  const out = upsertPlant(doc, 'a', { stage: 'flowering' }, Date.parse('2026-09-29T10:00:00Z'));
  assert.deepEqual(out.plants.a.history, [{ date: '2026-09-29', stage: 'flowering' }]);
});

test('upsertPlant does not record a write that leaves the stage alone', () => {
  const doc = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', notes: [], history: [] } } };
  const out = upsertPlant(doc, 'a', { lastWatered: '2026-09-29' }, Date.parse('2026-09-29T10:00:00Z'));
  assert.deepEqual(out.plants.a.history, []);
});

test('readCare returns null when nothing is stored', async () => {
  const env = { PHOTOS: fakeKV() };
  assert.equal(await readCare(env), null);
});

test('readCare reads the care doc', async () => {
  const doc = { generatedAt: 5, plants: { a: { guidance: 'Water every two days.' } } };
  const env = { PHOTOS: fakeKV({ [KEYS.care]: JSON.stringify(doc) }) };
  assert.deepEqual(await readCare(env), doc);
});

test('readCare falls back to the old plan key once', async () => {
  const old = { generatedAt: 1, through: '2026-09-30', plants: { a: { '2026-09-29': [] } } };
  const env = { PHOTOS: fakeKV({ 'plan:garden': JSON.stringify(old) }) };
  assert.deepEqual(await readCare(env), old);
});

test('the care doc wins over the old plan key', async () => {
  const doc = { generatedAt: 9, plants: {} };
  const env = { PHOTOS: fakeKV({
    [KEYS.care]: JSON.stringify(doc),
    'plan:garden': JSON.stringify({ generatedAt: 1, plants: {} }),
  }) };
  assert.equal((await readCare(env)).generatedAt, 9);
});

test('writeCare stores under the care key', async () => {
  const kv = fakeKV();
  await writeCare({ PHOTOS: kv }, { generatedAt: 3, plants: {} });
  assert.equal(JSON.parse(await kv.get(KEYS.care)).generatedAt, 3);
});

test('seeding a brand new plant records no transition', () => {
  const doc = { updatedAt: 0, plants: {} };
  const out = upsertPlant(doc, 'chilli-3', { name: 'Chilli 3', stage: 'seedling', lastWatered: '2026-09-29' },
    Date.parse('2026-09-29T10:00:00Z'));
  assert.deepEqual(out.plants['chilli-3'].history, []);
  assert.equal(out.plants['chilli-3'].stage, 'seedling');
});

test('the first real move after seeding is recorded', () => {
  let doc = upsertPlant({ updatedAt: 0, plants: {} }, 'chilli-3', { stage: 'seedling' }, Date.parse('2026-09-01T00:00:00Z'));
  doc = upsertPlant(doc, 'chilli-3', { stage: 'flowering' }, Date.parse('2026-09-29T00:00:00Z'));
  assert.deepEqual(doc.plants['chilli-3'].history, [{ date: '2026-09-29', stage: 'flowering' }]);
});
