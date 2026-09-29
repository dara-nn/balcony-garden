import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDistillBody, parseDistillResponse, mergeDistill } from '../src/distill.js';
import { addEntry } from '../src/entries.js';

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
