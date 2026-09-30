import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEntries, ENTRY_KEY, addEntry, assignEntry, editEntry, deleteEntry, taggedPlantIds, handNoteText } from '../src/entries.js';

function fakeKV(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
}

const empty = () => ({ updatedAt: 0, entries: [] });
const withOne = () => addEntry(empty(), { id: 'e1', date: '2026-08-07', text: 'watered everything' }, 10);

test('readEntries returns an empty doc when nothing stored', async () => {
  assert.deepEqual(await readEntries({ PHOTOS: fakeKV() }), { updatedAt: 0, entries: [] });
});

test('readEntries parses a stored doc', async () => {
  const stored = { updatedAt: 3, entries: [{ id: 'e1' }] };
  const env = { PHOTOS: fakeKV({ [ENTRY_KEY]: JSON.stringify(stored) }) };
  assert.deepEqual(await readEntries(env), stored);
});

test('a new entry starts pending, with its raw text kept', () => {
  const doc = withOne();
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.entries[0].text, 'watered everything');
  assert.equal(doc.entries[0].status, 'pending');
  assert.equal(doc.entries[0].createdAt, 10);
  assert.deepEqual(doc.entries[0].assigned, []);
  assert.equal(doc.updatedAt, 10);
});

test('a new entry gets an id when none is supplied', () => {
  const doc = addEntry(empty(), { date: '2026-08-07', text: 'x' }, 42);
  assert.ok(doc.entries[0].id);
});

test('a new entry remembers the photos attached to it', () => {
  const doc = addEntry(empty(), { date: '2026-08-07', text: 'x', photoIds: ['p1', 'p2'] }, 1);
  assert.deepEqual(doc.entries[0].photoIds, ['p1', 'p2']);
});

test('assigning plants to an entry marks it sorted', () => {
  const doc = assignEntry(withOne(), 'e1', { assigned: [{ plantId: 'tomato-1', noteId: 'n1' }] }, 20);
  assert.equal(doc.entries[0].status, 'sorted');
  assert.deepEqual(doc.entries[0].assigned, [{ plantId: 'tomato-1', noteId: 'n1' }]);
  assert.equal(doc.updatedAt, 20);
});

test('an entry the model could not place is unsorted, keeping its suggestions', () => {
  const doc = assignEntry(withOne(), 'e1', { assigned: [], suggestions: ['tomato-1', 'tomato-2'] }, 20);
  assert.equal(doc.entries[0].status, 'unsorted');
  assert.deepEqual(doc.entries[0].suggestions, ['tomato-1', 'tomato-2']);
});

test('a failed distillation leaves the entry unsorted with its error', () => {
  const doc = assignEntry(withOne(), 'e1', { error: 'no plan text in response' }, 20);
  assert.equal(doc.entries[0].status, 'unsorted');
  assert.equal(doc.entries[0].error, 'no plan text in response');
});

test('re-assigning clears a previous error', () => {
  let doc = assignEntry(withOne(), 'e1', { error: 'boom' }, 20);
  doc = assignEntry(doc, 'e1', { assigned: [{ plantId: 'a', noteId: 'n' }] }, 30);
  assert.equal(doc.entries[0].status, 'sorted');
  assert.equal(doc.entries[0].error, undefined);
});

test('editing the text sends the entry back for re-sorting', () => {
  let doc = assignEntry(withOne(), 'e1', { assigned: [{ plantId: 'a', noteId: 'n' }] }, 20);
  doc = editEntry(doc, 'e1', { text: 'watered the tomatoes only' }, 30);
  assert.equal(doc.entries[0].text, 'watered the tomatoes only');
  assert.equal(doc.entries[0].status, 'pending');
});

test('deleting removes the entry', () => {
  const doc = deleteEntry(withOne(), 'e1', 30);
  assert.equal(doc.entries.length, 0);
  assert.equal(doc.updatedAt, 30);
});

test('operations on an unknown entry throw', () => {
  assert.throws(() => assignEntry(empty(), 'nope', { assigned: [] }, 1), /unknown entry/);
  assert.throws(() => editEntry(empty(), 'nope', { text: 'x' }, 1), /unknown entry/);
  assert.throws(() => deleteEntry(empty(), 'nope', 1), /unknown entry/);
});

test('taggedPlantIds merges the old single plantId with the new list, no repeats', () => {
  assert.deepEqual(taggedPlantIds({ plantId: 'a' }), ['a']);
  assert.deepEqual(taggedPlantIds({ plantIds: ['a', 'b'], plantId: 'a' }), ['a', 'b']);
  assert.deepEqual(taggedPlantIds({ plantIds: ['b', '', null, 'b'] }), ['b']);
  assert.deepEqual(taggedPlantIds({}), []);
  assert.deepEqual(taggedPlantIds({ plantIds: 'a' }), []);
});

test('taggedPlantIds also reads the @mentions', () => {
  assert.deepEqual(taggedPlantIds({ plantId: 'a', mentions: [{ plantId: 'b', mention: '@B' }, { plantId: 'a' }] }), ['a', 'b']);
});

test('handNoteText drops the @ from each mention, keeps the name', () => {
  assert.equal(handNoteText('@Basil 1 and @Mint need water', [{ mention: '@Basil 1' }, { mention: '@Mint' }]),
    'Basil 1 and Mint need water');
  assert.equal(handNoteText('plain', []), 'plain');
});
