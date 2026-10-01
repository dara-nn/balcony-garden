import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { validNoteDate } from '../src/index.js';
import { timing } from '../src/schedule.js';
import { ENTRY_KEY } from '../src/entries.js';
import { KEYS } from '../src/garden.js';

/* The entry endpoints against an in-memory store. KV writes are counted per
   key, the model is faked, and care runs are counted rather than made. */

const SEED = [{ id: 'tig', stage: 'flowering', area: 'balcony' }, { id: 'noire', stage: 'flowering', area: 'balcony' }];
const plant = (id) => ({ id, name: id, species: 'tomato', stage: 'flowering', notes: [], history: [] });

function makeEnv({ entries = [], photos = {} } = {}) {
  const m = new Map([[KEYS.status, JSON.stringify({ updatedAt: 0, plants: { tig: plant('tig'), noire: plant('noire'), old: plant('old') } })],
    [ENTRY_KEY, JSON.stringify({ updatedAt: 0, entries })]]);
  const meta = new Map();
  for (const [id, md] of Object.entries(photos)) { m.set('photo:' + id, new ArrayBuffer(4)); meta.set('photo:' + id, md); }
  const puts = {};
  const seed = 'export const S = JSON.parse(`' + JSON.stringify({ plants: SEED }) + '`);';
  return { m, meta, puts, UPLOAD_PASS: 'pw', GEMINI_API_KEY: 'k',
    PHOTOS: {
      get: async (k) => (m.has(k) ? m.get(k) : null),
      put: async (k, v, o) => { puts[k] = (puts[k] || 0) + 1; m.set(k, v); if (o?.metadata) meta.set(k, o.metadata); },
      delete: async (k) => { m.delete(k); meta.delete(k); },
      getWithMetadata: async (k) => (m.has(k) ? { value: m.get(k), metadata: meta.get(k) || null } : null),
      list: async ({ prefix }) => ({ list_complete: true,
        keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })) }),
    },
    ASSETS: { fetch: async () => new Response(seed) } };
}

let calls;   // what went out: 'distill', 'forecast', 'plan'
let distillReply;
const realFetch = globalThis.fetch;
beforeEach(() => {
  timing.wait = 0;
  calls = [];
  distillReply = { assignments: [{ plantId: 'tig', text: 'Stripes.', quote: '', mention: '', watered: false }], confident: true };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('open-meteo')) { calls.push('forecast'); throw new Error('offline'); }
    const body = JSON.parse(init.body);
    const kind = JSON.stringify(body).includes('sort a gardener') ? 'distill' : 'plan';
    calls.push(kind);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(distillReply) }] } }] }));
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function call(env, method, path, body) {
  const waits = [];
  const res = await worker.fetch(new Request('https://g.local' + path, { method,
    headers: { authorization: 'Bearer pw', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}
const entries = (env) => JSON.parse(env.m.get(ENTRY_KEY)).entries;
const status = (env) => JSON.parse(env.m.get(KEYS.status));
const carePlanned = () => calls.includes('forecast');
const today = new Date().toISOString().slice(0, 10);

test('impossible dates are refused', () => {
  assert.equal(validNoteDate('2026-02-31'), false);
  assert.equal(validNoteDate('2026-13-01'), false);
  assert.equal(validNoteDate('1999-12-31'), false);
  assert.equal(validNoteDate('2026-02-28'), true);
});

test('whitespace-only text with no photos is an empty entry', async () => {
  const res = await call(makeEnv(), 'POST', '/api/entries', { date: today, text: '   \n ' });
  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'Empty entry');
});

test('an untagged note is matched, then one care run follows', async () => {
  const env = makeEnv();
  const res = await call(env, 'POST', '/api/entries', { date: today, text: 'tigerella has stripes' });
  assert.equal(res.status, 201);
  assert.equal(entries(env)[0].status, 'sorted');
  assert.deepEqual(calls, ['distill', 'forecast']);
});

test('the model is only offered plants still in the inventory', async () => {
  const env = makeEnv();
  let roster;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('open-meteo')) throw new Error('offline');
    const parts = JSON.parse(init.body).contents[0].parts;
    roster = JSON.parse(parts[0].text.slice(parts[0].text.indexOf('\n') + 1));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(distillReply) }] } }] }));
  };
  await call(env, 'POST', '/api/entries', { date: today, text: 'x' });
  assert.deepEqual(roster.map((p) => p.id), ['tig', 'noire']);
});

test('a note the model cannot place does not trigger a care run', async () => {
  const env = makeEnv();
  distillReply = { assignments: [], confident: true };
  await call(env, 'POST', '/api/entries', { date: today, text: 'something vague' });
  assert.equal(entries(env)[0].status, 'unsorted');
  assert.equal(carePlanned(), false);
});

test('a note whose matching fails is marked failed and plans nothing', async () => {
  const env = makeEnv();
  globalThis.fetch = async () => { throw new Error('down'); };
  await call(env, 'POST', '/api/entries', { date: today, text: 'x' });
  assert.equal(entries(env)[0].status, 'unsorted');
  assert.equal(entries(env)[0].error, 'ai');
});

test('a tagged note is filed before the answer, writing each document once', async () => {
  const env = makeEnv();
  const res = await call(env, 'POST', '/api/entries', { date: today, text: '@Tigerella  fruit splitting, @Noire too',
    mentions: [{ plantId: 'tig', mention: '@Tigerella' }, { plantId: 'noire', mention: '@Noire' }] });
  const body = await res.json();
  assert.equal(body.status, 'sorted');
  assert.equal(env.puts[ENTRY_KEY], 1);
  assert.equal(env.puts[KEYS.status], 1);
  assert.equal(status(env).plants.tig.notes[0].text, 'fruit splitting, Noire too');
  assert.equal(status(env).plants.noire.notes[0].text, 'Tigerella fruit splitting, Noire too');
  assert.ok(carePlanned());
  assert.ok(!calls.includes('distill'));
});

const sortedEntry = (extra = {}) => ({ id: 'e1', date: today, text: 'old words', photoIds: [], createdAt: 1,
  status: 'sorted', assigned: [{ plantId: 'tig', noteId: 'n1' }], ...extra });
const withNote = (env) => {
  const s = status(env);
  s.plants.tig.notes = [{ id: 'n1', text: 'old words', entryId: 'e1' }];
  env.m.set(KEYS.status, JSON.stringify(s));
  return env;
};

test('picking plants by hand writes each document once, marks byHand and tags the untagged photos', async () => {
  const env = withNote(makeEnv({ entries: [sortedEntry({ photoIds: ['p1', 'p2'] })],
    photos: { p1: { plant: '' }, p2: { plant: 'tig' } } }));
  const res = await call(env, 'PATCH', '/api/entries/e1', { plantIds: ['noire'] });
  const e = await res.json();
  assert.equal(e.byHand, true);
  assert.deepEqual(e.assigned.map((a) => a.plantId), ['noire']);
  assert.equal(env.puts[ENTRY_KEY], 1);
  assert.equal(env.puts[KEYS.status], 1);
  assert.equal(status(env).plants.tig.notes.length, 0);
  assert.equal(env.meta.get('photo:p1').plant, 'noire');
  assert.equal(env.meta.get('photo:p2').plant, 'tig');          // a photo already tagged keeps its tag
});

test('rewording a hand-filed entry with no @names keeps its plants and skips the model', async () => {
  const env = withNote(makeEnv({ entries: [sortedEntry({ byHand: true })] }));
  const res = await call(env, 'PATCH', '/api/entries/e1', { text: 'new words' });
  const e = await res.json();
  assert.equal(e.status, 'sorted');
  assert.equal(e.byHand, true);
  assert.deepEqual(e.assigned.map((a) => a.plantId), ['tig']);
  assert.deepEqual(status(env).plants.tig.notes.map((n) => n.text), ['new words']);
  assert.ok(!calls.includes('distill'));
  assert.equal(env.puts[KEYS.status], 1);
});

test('rewording sends the entry back to the model and never points at deleted notes', async () => {
  const env = withNote(makeEnv({ entries: [sortedEntry()] }));
  globalThis.fetch = async () => { throw new Error('down'); };   // matching fails this time
  const res = await call(env, 'PATCH', '/api/entries/e1', { text: 'new words' });
  const e = await res.json();
  assert.equal(e.status, 'pending');
  assert.deepEqual(e.assigned, []);
  assert.deepEqual(entries(env)[0].assigned, []);
  assert.equal(entries(env)[0].error, 'ai');
  assert.equal(status(env).plants.tig.notes.length, 0);
});

test('a retry with the same text matches again and clears the error', async () => {
  const env = makeEnv({ entries: [{ ...sortedEntry(), status: 'unsorted', assigned: [], error: 'ai' }] });
  await call(env, 'PATCH', '/api/entries/e1', { text: 'old words' });
  assert.equal(entries(env)[0].status, 'sorted');
  assert.equal(entries(env)[0].error, undefined);
});

test('a PATCH to whitespace on an entry with no photos is refused', async () => {
  const env = makeEnv({ entries: [sortedEntry()] });
  assert.equal((await call(env, 'PATCH', '/api/entries/e1', { text: '  ' })).status, 400);
});

test('deleting an entry takes its notes and photos with it, and plans again', async () => {
  const env = withNote(makeEnv({ entries: [sortedEntry({ photoIds: ['p1'] })], photos: { p1: { plant: 'tig' } } }));
  const res = await call(env, 'DELETE', '/api/entries/e1');
  assert.equal(res.status, 204);
  assert.equal(entries(env).length, 0);
  assert.equal(env.m.has('photo:p1'), false);
  assert.equal(status(env).plants.tig.notes.length, 0);
  assert.ok(carePlanned());
});

test('a burst of edits costs one care run', async () => {
  timing.wait = 30;
  const env = makeEnv({ entries: [sortedEntry({ byHand: true }), { ...sortedEntry({ byHand: true }), id: 'e2' }] });
  await Promise.all([call(env, 'PATCH', '/api/entries/e1', { text: 'a' }),
    (async () => { await new Promise((r) => setTimeout(r, 5)); await call(env, 'PATCH', '/api/entries/e2', { text: 'b' }); })()]);
  assert.equal(calls.filter((c) => c === 'forecast').length, 1);
});

/* ---- deleting one plant's note ---- */

const twoPlantEntry = (extra = {}) => sortedEntry({ assigned: [{ plantId: 'tig', noteId: 'n1' }, { plantId: 'noire', noteId: 'n2' }], ...extra });
const withNotes = (env) => {
  const s = status(env);
  s.plants.tig.notes = [{ id: 'n1', text: 'a', entryId: 'e1' }];
  s.plants.noire.notes = [{ id: 'n2', text: 'b', entryId: 'e1' }];
  env.m.set(KEYS.status, JSON.stringify(s));
  return env;
};

test('deleting a plant\'s note takes that plant off its entry, writing each document once', async () => {
  const env = withNotes(makeEnv({ entries: [twoPlantEntry()] }));
  const res = await call(env, 'POST', '/api/notes', { plantId: 'tig', op: 'delete', id: 'n1' });
  assert.equal(res.status, 200);
  assert.deepEqual(entries(env)[0].assigned, [{ plantId: 'noire', noteId: 'n2' }]);
  assert.equal(status(env).plants.tig.notes.length, 0);
  assert.equal(env.puts[KEYS.status], 1);
  assert.equal(env.puts[ENTRY_KEY], 1);
  assert.ok(carePlanned());
});

test('deleting the last note of an entry with no photos deletes the entry', async () => {
  const env = withNote(makeEnv({ entries: [sortedEntry()] }));
  await call(env, 'POST', '/api/notes', { plantId: 'tig', op: 'delete', id: 'n1' });
  assert.deepEqual(entries(env), []);
});

test('deleting the last note of an entry with photos keeps it, unsorted, with its photos', async () => {
  const env = withNote(makeEnv({ entries: [sortedEntry({ photoIds: ['p1'] })], photos: { p1: { plant: 'tig' } } }));
  await call(env, 'POST', '/api/notes', { plantId: 'tig', op: 'delete', id: 'n1' });
  assert.equal(entries(env)[0].status, 'unsorted');
  assert.deepEqual(entries(env)[0].assigned, []);
  assert.ok(env.m.has('photo:p1'));
});

test('editing a note leaves its entry alone', async () => {
  const env = withNote(makeEnv({ entries: [sortedEntry()] }));
  await call(env, 'POST', '/api/notes', { plantId: 'tig', op: 'edit', id: 'n1', text: 'new' });
  assert.equal(status(env).plants.tig.notes[0].text, 'new');
  assert.deepEqual(entries(env)[0].assigned, [{ plantId: 'tig', noteId: 'n1' }]);
  assert.equal(env.puts[ENTRY_KEY], undefined);
});

/* ---- PUT /api/status/:id ---- */

test('the water button and a known stage are accepted', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'PUT', '/api/status/tig', { lastWatered: today })).status, 200);
  assert.equal(status(env).plants.tig.lastWatered, today);
  assert.equal((await call(env, 'PUT', '/api/status/tig', { stage: 'fruiting' })).status, 200);
  assert.equal(status(env).plants.tig.stage, 'fruiting');
});

test('unknown fields and bad values are refused', async () => {
  const env = makeEnv();
  for (const body of [{ notes: [] }, { name: 'x' }, { stage: 'ripening' }, { lastWatered: '2026-02-31' },
    { lastWatered: '2999-01-01' }, [], null]) {
    assert.equal((await call(env, 'PUT', '/api/status/tig', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(env.puts[KEYS.status], undefined);
});

test('an unknown plant is not found, unless it is being seeded', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'PUT', '/api/status/ghost', { lastWatered: today })).status, 404);
  const res = await call(env, 'PUT', '/api/status/ghost?seed=1',
    { name: 'Ghost', species: 'tomato', stage: 'seedling', lastWatered: today });
  assert.equal(res.status, 200);
  assert.equal(status(env).plants.ghost.name, 'Ghost');
  assert.equal(carePlanned(), false);
  assert.equal((await call(env, 'PUT', '/api/status/tig?seed=1', { name: 'Tigerella', species: 'tomato' })).status, 200);
  assert.equal((await call(env, 'PUT', '/api/status/tig?seed=1', { name: 3 })).status, 400);
  assert.equal((await call(env, 'PUT', '/api/status/tig?seed=1', { notes: [] })).status, 400);
});

/* ---- photoIds ---- */

test('photoIds must be a list of strings', async () => {
  const env = makeEnv({ entries: [sortedEntry()] });
  assert.equal((await call(env, 'POST', '/api/entries', { date: today, text: 'x', photoIds: 'abc' })).status, 400);
  assert.equal((await call(env, 'POST', '/api/entries', { date: today, text: 'x', photoIds: [1] })).status, 400);
  assert.equal((await call(env, 'PATCH', '/api/entries/e1', { text: 'y', photoIds: 'abc' })).status, 400);
  assert.equal(entries(env).length, 1);
});
