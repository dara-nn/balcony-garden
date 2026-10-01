import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDistillBody, parseDistillResponse, mergeDistill, distill } from '../src/distill.js';
import { addEntry, editEntry, ENTRY_KEY } from '../src/entries.js';
import { KEYS } from '../src/garden.js';

const ROSTER = [
  { id: 'tomato-1', name: 'Tigerella tomato', species: 'tomato', area: 'balcony', stage: 'flowering' },
  { id: 'monstera', name: 'Monstera', species: 'monstera', area: 'indoor', stage: 'settling' },
];
const ENTRY = { id: 'e1', date: '2026-08-07', text: 'watered everything, tigerella has stripes', photoIds: [] };

const statusDoc = () => ({
  updatedAt: 0,
  plants: {
    'tomato-1': { id: 'tomato-1', stage: 'flowering', lastWatered: '2026-08-01', notes: [] },
    monstera: { id: 'monstera', stage: 'settling', lastWatered: '2026-08-05', notes: [] },
  },
});
const entriesDoc = () => addEntry({ updatedAt: 0, entries: [] }, ENTRY, 10);
const reply = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

test('the request carries the entry text and the full plant roster', () => {
  const body = buildDistillBody(ENTRY, ROSTER, []);
  const sent = JSON.stringify(body);
  assert.match(sent, /tigerella has stripes/);
  assert.match(sent, /Tigerella tomato/);
  assert.match(sent, /Monstera/);
});

test('the request tells the model where each plant lives', () => {
  const parts = buildDistillBody(ENTRY, ROSTER, []).contents[0].parts;
  const rosterPart = parts.find((p) => p.text && p.text.startsWith('PLANTS'));
  const sent = JSON.parse(rosterPart.text.slice(rosterPart.text.indexOf('\n') + 1));
  assert.deepEqual(sent.map((p) => p.area), ['balcony', 'indoor']);
});

test('the request includes any photos to identify', () => {
  const part = { inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } };
  const body = buildDistillBody(ENTRY, ROSTER, [{ id: 'p1', part }]);
  const parts = body.contents[0].parts;
  assert.ok(parts.some((p) => p.inline_data && p.inline_data.data === 'AAAA'));
});

test('the response is parsed past a thought-only part', () => {
  const json = { candidates: [{ content: { parts: [{ thought: true }, { text: '{"assignments":[],"confident":true}' }] } }] };
  assert.deepEqual(parseDistillResponse(json), { assignments: [], confident: true });
});

test('a response with no text throws', () => {
  assert.throws(() => parseDistillResponse({ candidates: [] }), /no distillation/);
});

test('each assignment becomes an AI note linked back to the entry', () => {
  const out = mergeDistill(statusDoc(), entriesDoc(), ENTRY, {
    assignments: [{ plantId: 'tomato-1', text: 'First stripes showing. Watered.', watered: true }],
    confident: true,
  }, 100);
  const notes = out.status.plants['tomato-1'].notes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, 'First stripes showing. Watered.');
  assert.equal(notes[0].date, '2026-08-07');
  assert.equal(notes[0].entryId, 'e1');
  assert.equal(notes[0].ai, true);
});

test('a note keeps only the slice of the entry that is about its own plant', () => {
  const entry = { ...ENTRY, text: 'tigerella has stripes, monstera got a new leaf' };
  const out = mergeDistill(statusDoc(), entriesDoc(), entry, {
    assignments: [
      { plantId: 'tomato-1', text: 'First stripes showing.', quote: 'tigerella has stripes', watered: false },
      { plantId: 'monstera', text: 'New leaf.', quote: 'monstera got a new leaf', watered: false },
    ],
    confident: true,
  }, 100);
  assert.equal(out.status.plants['tomato-1'].notes[0].quote, 'tigerella has stripes');
  assert.equal(out.status.plants.monstera.notes[0].quote, 'monstera got a new leaf');
});

test('a note the model gave no quote for falls back to no quote at all', () => {
  const out = mergeDistill(statusDoc(), entriesDoc(), ENTRY, {
    assignments: [{ plantId: 'tomato-1', text: 'Watered.', watered: true }],
    confident: true,
  }, 100);
  assert.equal(out.status.plants['tomato-1'].notes[0].quote, undefined);
});

test('a watered plant has its last watering moved to the entry date', () => {
  const out = mergeDistill(statusDoc(), entriesDoc(), ENTRY, {
    assignments: [{ plantId: 'tomato-1', text: 'Watered.', watered: true }],
    confident: true,
  }, 100);
  assert.equal(out.status.plants['tomato-1'].lastWatered, '2026-08-07');
});

test('an observation that mentions no watering leaves the watering date alone', () => {
  const out = mergeDistill(statusDoc(), entriesDoc(), ENTRY, {
    assignments: [{ plantId: 'tomato-1', text: 'First stripes showing.', watered: false }],
    confident: true,
  }, 100);
  assert.equal(out.status.plants['tomato-1'].lastWatered, '2026-08-01');
});

test('an entry naming several plants writes a note on each', () => {
  const out = mergeDistill(statusDoc(), entriesDoc(), ENTRY, {
    assignments: [
      { plantId: 'tomato-1', text: 'Stripes showing. Watered.', watered: true },
      { plantId: 'monstera', text: 'Watered.', watered: true },
    ],
    confident: true,
  }, 100);
  assert.equal(out.status.plants['tomato-1'].notes.length, 1);
  assert.equal(out.status.plants.monstera.notes.length, 1);
  assert.equal(out.entries.entries[0].status, 'sorted');
  assert.equal(out.entries.entries[0].assigned.length, 2);
});

test('an assignment to a plant that does not exist is dropped', () => {
  const out = mergeDistill(statusDoc(), entriesDoc(), ENTRY, {
    assignments: [{ plantId: 'ghost', text: 'x', watered: true }],
    confident: true,
  }, 100);
  assert.equal(out.entries.entries[0].assigned.length, 0);
  assert.equal(out.entries.entries[0].status, 'unsorted');
});

test('a low-confidence result is left unsorted, with its guesses kept as suggestions', () => {
  const out = mergeDistill(statusDoc(), entriesDoc(), ENTRY, {
    assignments: [{ plantId: 'tomato-1', text: 'Leaves yellowing.', watered: false }],
    confident: false,
  }, 100);
  assert.equal(out.entries.entries[0].status, 'unsorted');
  assert.deepEqual(out.entries.entries[0].suggestions, ['tomato-1']);
  assert.equal(out.status.plants['tomato-1'].notes.length, 0);
});

test('photo identifications come back as tags to apply, by photo id', () => {
  const entry = { ...ENTRY, photoIds: ['p1', 'p2'] };
  const out = mergeDistill(statusDoc(), entriesDoc(), entry, {
    assignments: [{ plantId: 'tomato-1', text: 'x', watered: false }],
    photos: [{ index: 1, plantId: 'tomato-1' }],
    confident: true,
  }, 100, ['p1', 'p2']);
  assert.deepEqual(out.photoTags, [{ photoId: 'p2', plantId: 'tomato-1' }]);
});

test('a photo identification pointing nowhere is ignored', () => {
  const out = mergeDistill(statusDoc(), entriesDoc(), ENTRY, {
    assignments: [{ plantId: 'tomato-1', text: 'x', watered: false }],
    photos: [{ index: 9, plantId: 'tomato-1' }, { index: 0, plantId: 'ghost' }],
    confident: true,
  }, 100, ['p1']);
  assert.deepEqual(out.photoTags, []);
});

test('an older note saying watered never moves the last watering back', () => {
  const doc = statusDoc();
  doc.plants['tomato-1'].lastWatered = '2026-08-10';
  const out = mergeDistill(doc, entriesDoc(), ENTRY, {
    assignments: [{ plantId: 'tomato-1', text: 'Watered.', watered: true }], confident: true }, 100);
  assert.equal(out.status.plants['tomato-1'].lastWatered, '2026-08-10');
});

test('an untagged photo-only entry is placed on the plants its photos show', () => {
  const entry = { ...ENTRY, text: '', photoIds: ['p1', 'p2'] };
  const out = mergeDistill(statusDoc(), addEntry({ updatedAt: 0, entries: [] }, entry, 10), entry, {
    assignments: [], photos: [{ index: 0, plantId: 'monstera' }, { index: 1, plantId: 'monstera' }], confident: true,
  }, 100, ['p1', 'p2']);
  assert.deepEqual(out.entries.entries[0].assigned, [{ plantId: 'monstera', noteId: null }]);
  assert.equal(out.entries.entries[0].status, 'sorted');
});

test('a plant the model was not offered is ignored', () => {
  const out = mergeDistill(statusDoc(), entriesDoc(), ENTRY, {
    assignments: [{ plantId: 'monstera', text: 'x', watered: false }], confident: true,
  }, 100, [], new Set(['tomato-1']));
  assert.equal(out.entries.entries[0].status, 'unsorted');
});

/* ---- a whole run against a fake store ---- */

function fakeEnv(stored) {
  const m = new Map(Object.entries(stored).map(([k, v]) => [k, JSON.stringify(v)]));
  return { m, GEMINI_API_KEY: 'k', PHOTOS: {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => void m.set(k, v),
    getWithMetadata: async () => null,
  } };
}
const okReply = (obj) => new Response(JSON.stringify(reply(obj)));
async function withFetch(fn, body) {
  const real = globalThis.fetch;
  globalThis.fetch = fn;
  try { return await body(); } finally { globalThis.fetch = real; }
}
const entryOf = (env) => JSON.parse(env.m.get(ENTRY_KEY)).entries[0];
const MATCH = { assignments: [{ plantId: 'tomato-1', text: 'Stripes.', quote: '', mention: '', watered: false }], confident: true };

test('the result is merged into the docs as they are after the reply', async () => {
  const env = fakeEnv({ [ENTRY_KEY]: entriesDoc(), [KEYS.status]: statusDoc() });
  const placed = await withFetch(async (url, init) => {
    assert.ok(init.signal, 'the call has a timeout');
    const s = JSON.parse(env.m.get(KEYS.status));          // a hand note lands meanwhile
    s.plants.monstera.notes.push({ id: 'meanwhile' });
    env.m.set(KEYS.status, JSON.stringify(s));
    return okReply(MATCH);
  }, () => distill(env, 'e1', ROSTER));
  assert.equal(placed, true);
  const status = JSON.parse(env.m.get(KEYS.status));
  assert.equal(status.plants.monstera.notes[0].id, 'meanwhile');
  assert.equal(status.plants['tomato-1'].notes[0].text, 'Stripes.');
  assert.equal(entryOf(env).status, 'sorted');
});

test('a result for an entry edited meanwhile is dropped', async () => {
  const env = fakeEnv({ [ENTRY_KEY]: entriesDoc(), [KEYS.status]: statusDoc() });
  const placed = await withFetch(async () => {
    env.m.set(ENTRY_KEY, JSON.stringify(editEntry(JSON.parse(env.m.get(ENTRY_KEY)), 'e1', { text: 'other words' }, 50)));
    return okReply(MATCH);
  }, () => distill(env, 'e1', ROSTER));
  assert.equal(placed, false);
  assert.equal(entryOf(env).status, 'pending');
  assert.equal(JSON.parse(env.m.get(KEYS.status)).plants['tomato-1'].notes.length, 0);
});

test('a result for an entry deleted meanwhile is dropped', async () => {
  const env = fakeEnv({ [ENTRY_KEY]: entriesDoc(), [KEYS.status]: statusDoc() });
  const placed = await withFetch(async () => {
    env.m.set(ENTRY_KEY, JSON.stringify({ updatedAt: 1, entries: [] }));
    return okReply(MATCH);
  }, () => distill(env, 'e1', ROSTER));
  assert.equal(placed, false);
  assert.equal(JSON.parse(env.m.get(KEYS.status)).plants['tomato-1'].notes.length, 0);
});

for (const [name, fetcher] of [
  ['cannot be reached', async () => { throw new Error('timeout'); }],
  ['answers with an error', async () => new Response('no', { status: 500 })],
  ['answers with junk', async () => new Response('{"candidates":[]}')],
]) {
  test(`when the model ${name} the entry ends unsorted with error 'ai'`, async () => {
    const env = fakeEnv({ [ENTRY_KEY]: entriesDoc(), [KEYS.status]: statusDoc() });
    assert.equal(await withFetch(fetcher, () => distill(env, 'e1', ROSTER)), false);
    assert.equal(entryOf(env).status, 'unsorted');
    assert.equal(entryOf(env).error, 'ai');
  });
}

test('an empty garden ends the entry unsorted, not pending', async () => {
  const env = fakeEnv({ [ENTRY_KEY]: entriesDoc(), [KEYS.status]: statusDoc() });
  assert.equal(await distill(env, 'e1', []), false);
  assert.equal(entryOf(env).error, 'empty');
});

test('a crash inside still ends the entry unsorted', async () => {
  const env = fakeEnv({ [ENTRY_KEY]: entriesDoc(), [KEYS.status]: statusDoc() });
  env.PHOTOS.getWithMetadata = async () => { throw new Error('kv down'); };
  const e = entriesDoc(); e.entries[0].photoIds = ['p1'];
  env.m.set(ENTRY_KEY, JSON.stringify(e));
  await withFetch(async () => okReply(MATCH), () => distill(env, 'e1', ROSTER));
  assert.equal(entryOf(env).status, 'unsorted');
  assert.equal(entryOf(env).error, 'internal');
});

test('a low-confidence match reports nothing placed, so no care run follows', async () => {
  const env = fakeEnv({ [ENTRY_KEY]: entriesDoc(), [KEYS.status]: statusDoc() });
  const placed = await withFetch(async () => okReply({ ...MATCH, confident: false }), () => distill(env, 'e1', ROSTER));
  assert.equal(placed, false);
  assert.equal(entryOf(env).status, 'unsorted');
});
