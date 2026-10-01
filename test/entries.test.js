import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEntries, ENTRY_KEY, addEntry, assignEntry, editEntry, deleteEntry, taggedPlantIds, handNoteText,
  plantNoteText, fileByHand, unlinkEntry, unlinkNote } from '../src/entries.js';

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

/* ---- per-plant note text ---- */

const TWO = [{ plantId: 'tig', mention: '@Tigerella' }, { plantId: 'noire', mention: '@Noire' }];

test('a plant\'s own @name goes only when the text starts with it; every other @name reads plain', () => {
  const text = '@Tigerella fruit splitting after rain, same on @Noire';
  assert.equal(plantNoteText(text, TWO, 'tig'), 'fruit splitting after rain, same on Noire');
  assert.equal(plantNoteText(text, TWO, 'noire'), 'Tigerella fruit splitting after rain, same on Noire');
});

test('an own @name in the middle of the sentence stays, as the plain name', () => {
  const m = [{ plantId: 'c1', mention: '@Chilli 1' }, { plantId: 'c2', mention: '@Chilli 2' }];
  const text = 'Pinched the tips of @Chilli 1 and @Chilli 2, both look sturdy';
  assert.equal(plantNoteText(text, m, 'c1'), 'Pinched the tips of Chilli 1 and Chilli 2, both look sturdy');
  assert.equal(plantNoteText(text, m, 'c2'), 'Pinched the tips of Chilli 1 and Chilli 2, both look sturdy');
});

test('a leading comma or space before the own @name is dropped with it', () => {
  assert.equal(plantNoteText(' , @Mint  needs   water', [{ plantId: 'm', mention: '@Mint' }], 'm'), 'needs water');
});

test('a longer name is never half-eaten by a shorter one', () => {
  const m = [{ plantId: 'b', mention: '@Basil' }, { plantId: 'b1', mention: '@Basil 1' }];
  assert.equal(plantNoteText('@Basil 1 and @Basil need water', m, 'b'), 'Basil 1 and Basil need water');
  assert.equal(plantNoteText('@Basil 1 and @Basil need water', m, 'b1'), 'and Basil need water');
});

test('the name left at the start does not leave a stray comma, and a bare name is kept', () => {
  assert.equal(plantNoteText('@Mint, watered', [{ plantId: 'm', mention: '@Mint' }], 'm'), 'watered');
  assert.equal(plantNoteText('@Mint', [{ plantId: 'm', mention: '@Mint' }], 'm'), 'Mint');
  assert.equal(plantNoteText('  plain   words ', [], 'm'), 'plain words');
});

/* ---- filing by hand, in memory ---- */

const garden = () => ({ updatedAt: 0, plants: {
  tig: { id: 'tig', notes: [] }, noire: { id: 'noire', notes: [] } } });

test('filing by hand writes each plant its own note and links them on the entry', () => {
  const doc = addEntry(empty(), { id: 'e1', date: '2026-08-07', text: '@Tigerella  fruit splitting, @Noire too' }, 10);
  const out = fileByHand(garden(), doc, 'e1', ['tig', 'noire'], TWO, 50);
  assert.equal(out.status.plants.tig.notes[0].text, 'fruit splitting, Noire too');
  assert.equal(out.status.plants.noire.notes[0].text, 'Tigerella fruit splitting, Noire too');
  const e = out.entries.entries[0];
  assert.equal(e.status, 'sorted');
  assert.equal(e.byHand, undefined);
  assert.deepEqual(e.assigned.map((a) => a.mention), ['@Tigerella', '@Noire']);
  assert.equal(out.changed, true);
});

test('plants picked by hand mark the entry byHand; an unknown plant is skipped', () => {
  const out = fileByHand(garden(), withOne(), 'e1', ['tig', 'ghost'], [], 50, { byHand: true });
  assert.equal(out.entries.entries[0].byHand, true);
  assert.deepEqual(out.entries.entries[0].assigned.map((a) => a.plantId), ['tig']);
});

test('picking no plants by hand is not byHand: the entry is simply unsorted', () => {
  const out = fileByHand(garden(), withOne(), 'e1', [], [], 50, { byHand: true });
  assert.equal(out.entries.entries[0].status, 'unsorted');
  assert.equal(out.entries.entries[0].byHand, undefined);
  assert.equal(out.changed, false);
});

test('a photo-only entry filed by hand is placed with no note', () => {
  const doc = addEntry(empty(), { id: 'e1', date: '2026-08-07', text: '', photoIds: ['p1'] }, 10);
  const out = fileByHand(garden(), doc, 'e1', ['tig'], [], 50);
  assert.deepEqual(out.entries.entries[0].assigned, [{ plantId: 'tig', noteId: null }]);
  assert.equal(out.status.plants.tig.notes.length, 0);
});

test('a later model result clears byHand', () => {
  let doc = assignEntry(withOne(), 'e1', { assigned: [{ plantId: 'a', noteId: 'n' }], byHand: true }, 20);
  assert.equal(doc.entries[0].byHand, true);
  assert.equal(doc.entries[0].filedAt, 20);
  doc = assignEntry(doc, 'e1', { assigned: [{ plantId: 'a', noteId: 'n2' }] }, 30);
  assert.equal(doc.entries[0].byHand, undefined);
});

/* ---- unlinking ---- */

test('unlinking drops the entry\'s notes and keeps only links whose note survived', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [
    { id: 'n1', text: 'model', ai: true }, { id: 'n2', text: 'reworded', ai: false }] } } };
  const entry = { assigned: [{ plantId: 'a', noteId: 'n1' }, { plantId: 'a', noteId: 'n2' }, { plantId: 'a', noteId: null }] };
  const out = unlinkEntry(status, entry, 5);
  assert.deepEqual(out.status.plants.a.notes.map((n) => n.id), ['n2']);
  assert.deepEqual(out.kept, [{ plantId: 'a', noteId: 'n2' }]);
  assert.equal(out.changed, true);
  assert.equal(unlinkEntry(status, { assigned: [] }, 5).changed, false);
});

test('an edit stamps editedAt, clears an old error and takes the surviving links', () => {
  let doc = assignEntry(withOne(), 'e1', { assigned: [{ plantId: 'a', noteId: 'n' }], error: 'ai' }, 20);
  doc = editEntry(doc, 'e1', { text: 'new words', assigned: [] }, 30);
  assert.equal(doc.entries[0].editedAt, 30);
  assert.equal(doc.entries[0].error, undefined);
  assert.deepEqual(doc.entries[0].assigned, []);
});

/* ---- deleting one plant's note ---- */

const linked = (extra = {}) => ({ updatedAt: 0, entries: [{ id: 'e1', date: '2026-08-07', text: 'x', photoIds: [],
  status: 'sorted', assigned: [{ plantId: 'tig', noteId: 'n1' }, { plantId: 'noire', noteId: 'n2' }], ...extra }] });

test('unlinkNote takes only that plant off the entry', () => {
  const out = unlinkNote(linked(), 'e1', 'tig', 9);
  assert.equal(out.changed, true);
  assert.deepEqual(out.entries.entries[0].assigned, [{ plantId: 'noire', noteId: 'n2' }]);
  assert.equal(out.entries.entries[0].status, 'sorted');
});

test('unlinkNote deletes an entry left on no plant when it has no photos', () => {
  const doc = linked({ assigned: [{ plantId: 'tig', noteId: 'n1' }] });
  const out = unlinkNote(doc, 'e1', 'tig', 9);
  assert.deepEqual(out.entries.entries, []);
});

test('unlinkNote keeps an entry with photos, as unsorted', () => {
  const doc = linked({ photoIds: ['p1'], assigned: [{ plantId: 'tig', noteId: 'n1' }] });
  const e = unlinkNote(doc, 'e1', 'tig', 9).entries.entries[0];
  assert.equal(e.status, 'unsorted');
  assert.deepEqual(e.assigned, []);
  assert.deepEqual(e.photoIds, ['p1']);
});

test('unlinkNote changes nothing for an unknown entry or an unlinked plant', () => {
  const doc = linked();
  assert.equal(unlinkNote(doc, 'nope', 'tig', 9).changed, false);
  assert.equal(unlinkNote(doc, 'e1', 'basil', 9).entries, doc);
});
