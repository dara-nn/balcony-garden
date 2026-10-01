import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPhotos, parseForecast, parsePlanResponse, mergeStatus, mergeCare, enoughPlants, failedCare,
  inventoryOf, replan, bytesToBase64, planContext, buildGeminiBody, citedStages } from '../src/planner.js';
import { KEYS } from '../src/garden.js';

// Both halves of one run, as the planner applies them.
const mergePlan = (status, ai, today, now) => ({
  status: mergeStatus(status, ai, today, now),
  care: mergeCare(null, ai, now, 500, new Set(Object.keys(status.plants))),
});

test('selectPhotos filters by plant+date and caps', () => {
  const list = [
    { id: '1', plant: 'a', date: '2026-07-26', created: 3 },
    { id: '2', plant: 'a', date: '2026-07-26', created: 5 },
    { id: '3', plant: 'b', date: '2026-07-26', created: 9 },
    { id: '4', plant: 'a', date: '2026-07-25', created: 9 },
  ];
  const out = selectPhotos(list, 'a', '2026-07-26', 3);
  assert.deepEqual(out.map((p) => p.id), ['2', '1']); // newest first, only a+that date
});

test('parseForecast maps daily arrays', () => {
  const json = { daily: { time: ['2026-07-26'], temperature_2m_max: [28], temperature_2m_min: [12],
    precipitation_probability_max: [10], relative_humidity_2m_mean: [55] } };
  assert.deepEqual(parseForecast(json).days['2026-07-26'], { tmax: 28, tmin: 12, pop: 10, rh: 55 });
});

test('parsePlanResponse extracts the plants array (skipping a thought-only part)', () => {
  const payload = { plants: [{ id: 'a', health: { overall: 'steady', issues: [] }, observations: 'ok', days: [] }] };
  const gemini = { candidates: [{ content: { parts: [
    { thoughtSignature: 'xxx' },                 // thinking model may prepend a text-less part
    { text: JSON.stringify(payload) },
  ] } }] };
  assert.deepEqual(parsePlanResponse(gemini), payload.plants);
});

test('parsePlanResponse returns [] when plants is absent', () => {
  const gemini = { candidates: [{ content: { parts: [{ text: '{}' }] } }] };
  assert.deepEqual(parsePlanResponse(gemini), []);
});



test('bytesToBase64 round-trips known small bytes', () => {
  const bytes = new Uint8Array([104, 105]); // "hi"
  assert.equal(bytesToBase64(bytes), 'aGk=');
});

test('bytesToBase64 encodes a large buffer without throwing', () => {
  const bytes = new Uint8Array(200000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  let out;
  assert.doesNotThrow(() => { out = bytesToBase64(bytes); });
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
});

test('a care run never writes the stage history; only the gardener does', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', notes: [{ id: 'n1', text: 'flowers' }], history: [] } } };
  const out = mergePlan(status, [{ id: 'a', stage: 'flowering', stageNoteId: 'n1', observations: '' }], '2026-09-29', 1000);
  assert.equal(out.status.plants.a.stage, 'flowering');
  assert.deepEqual(out.status.plants.a.history, []);
});

test('a stage word off the list is ignored', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', notes: [], history: [] } } };
  const out = mergePlan(status, [{ id: 'a', stage: 'ripening', observations: '' }], '2026-09-29', 1000);
  assert.equal(out.status.plants.a.stage, 'growing');
});

test('mergePlan turns guidance into the care doc', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', notes: [], history: [] } } };
  const ai = [{ id: 'a', guidance: 'Water every two days. Feed weekly.',
    health: { label: 'thirsty', tone: 'watch', issues: [] }, observations: 'dry soil' }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care, { generatedAt: 1000, basedOn: 500,
    plants: { a: { guidance: 'Water every two days. Feed weekly.', upcoming: [] } } });
  assert.equal(out.care.through, undefined);
});

test('mergePlan drops a plant the inventory no longer has', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [
    { id: 'a', guidance: 'Keep it steady.', health: { label: 'fine', tone: 'good', issues: [] }, observations: '' },
    { id: 'ghost', guidance: 'Water the plant that is not there.', health: { label: 'x', tone: 'good', issues: [] }, observations: '' },
  ];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(Object.keys(out.care.plants), ['a']);
  assert.deepEqual(Object.keys(out.status.plants), ['a']);
});

test('mergePlan skips a plant with no guidance rather than storing an empty string', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [{ id: 'a', health: { label: 'fine', tone: 'good', issues: [] }, observations: '' }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care.plants, {});
});

test('parsePlanResponse reads guidance out of a thinking response', () => {
  const body = { candidates: [{ content: { parts: [
    { thought: true },
    { text: JSON.stringify({ plants: [{ id: 'a', guidance: 'Water it.' }] }) },
  ] } }] };
  assert.deepEqual(parsePlanResponse(body), [{ id: 'a', guidance: 'Water it.' }]);
});

test('mergePlan carries the expected upcoming changes into the care doc', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'flowering', notes: [], history: [] } } };
  const ai = [{ id: 'a', guidance: 'Water it.', health: { label: 'fine', tone: 'good', issues: [] },
    observations: 'doing well', upcoming: [{ stage: 'fruiting', date: '2026-11-01' }] }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care.plants.a.upcoming, [{ stage: 'fruiting', date: '2026-11-01' }]);
});

test('a plant with no expected changes gets an empty list, not undefined', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [{ id: 'a', guidance: 'Water it.', health: { label: 'fine', tone: 'good', issues: [] }, observations: '' }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care.plants.a.upcoming, []);
});

test('an expected change with no date is dropped', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', notes: [], history: [] } } };
  const ai = [{ id: 'a', guidance: 'Water it.', health: { label: 'f', tone: 'good', issues: [] }, observations: '',
    upcoming: [{ stage: 'fruiting' }, { stage: 'harvesting', date: '2026-12-01' }] }];
  const out = mergePlan(status, ai, '2026-09-29', 1000);
  assert.deepEqual(out.care.plants.a.upcoming, [{ stage: 'harvesting', date: '2026-12-01' }]);
});

/* ---- what the model is given ---- */

const PLANT = { id: 'tomato-2', name: 'Noire', species: 'tomato', area: 'balcony', stage: 'flowering',
  lastWatered: '2026-09-30', history: [], updatedAt: 1, readNotes: ['n1', 'n2'],
  health: { label: 'cold stalled', tone: 'watch', issues: [] },
  observations: 'Flower clusters remain unopened.',
  notes: [
    { id: 'n1', date: '2026-08-11', text: 'Tied it up.', createdAt: 1 },
    { id: 'n2', date: '2026-09-30', text: 'Fruiting well, several harvests since late August.', createdAt: 2 },
  ] };

test('the gardener\'s notes go to the model newest first, with their dates', () => {
  const c = planContext({ 'tomato-2': PLANT });
  assert.deepEqual(c[0].notes, [
    { id: 'n2', date: '2026-09-30', text: 'Fruiting well, several harvests since late August.' },
    { id: 'n1', date: '2026-08-11', text: 'Tied it up.' },
  ]);
  assert.equal(c[0].readNotes, undefined);
});

test('the previous read is labelled as such, not passed off as the current state', () => {
  const c = planContext({ 'tomato-2': PLANT })[0];
  assert.equal(c.observations, undefined);
  assert.equal(c.health, undefined);
  assert.deepEqual(c.previousRead, { observations: 'Flower clusters remain unopened.' });
});

test('a plant never read before has no previous read', () => {
  const c = planContext({ a: { id: 'a', stage: 'growing', notes: [] } })[0];
  assert.equal(c.previousRead, undefined);
});

test('the prompt puts the notes above the previous read and lists the stage words', () => {
  const body = buildGeminiBody({ plants: { 'tomato-2': PLANT } }, { days: {} }, '2026-09-30', {});
  const sys = body.system_instruction.parts[0].text;
  assert.match(sys, /notes/i);
  assert.match(sys, /previousRead/);
  for (const w of ['seedling', 'growing', 'flowering', 'fruiting', 'harvesting']) assert.match(sys, new RegExp(w));
  const ctx = JSON.parse(body.contents[0].parts[0].text.replace(/^[^{]*/, ''));
  assert.equal(ctx.plants[0].previousRead.observations, 'Flower clusters remain unopened.');
});

/* ---- no health, and past stages from the notes ---- */

test('the model is no longer asked for a health verdict', () => {
  const body = buildGeminiBody({ plants: { 'tomato-2': PLANT } }, { days: {} }, '2026-09-30', {});
  const item = body.generationConfig.responseSchema.properties.plants.items;
  assert.equal(item.properties.health, undefined);
  assert.ok(!item.required.includes('health'));
  assert.doesNotMatch(body.system_instruction.parts[0].text, /health\./);
  assert.ok(item.properties.pastStages, 'pastStages is in the schema');
});

test('the stages the notes date are kept apart from the live history, and replaced each run', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', history: [],
    notes: [{ id: 'n1', text: 'flowers' }, { id: 'n2', text: 'fruit' }],
    noteStages: [{ date: '2026-06-01', stage: 'flowering' }] } } };
  const ai = [{ id: 'a', stage: 'fruiting', stageNoteId: 'n2', guidance: 'g', observations: '',
    pastStages: [{ stage: 'flowering', date: '2026-07-12', noteId: 'n1' }, { stage: 'fruiting', date: '2026-08-03', noteId: 'n2' }] }];
  const out = mergePlan(status, ai, '2026-09-30', 1000).status.plants.a;
  assert.deepEqual(out.noteStages, [{ date: '2026-07-12', stage: 'flowering', noteId: 'n1' },
    { date: '2026-08-03', stage: 'fruiting', noteId: 'n2' }]);
  assert.deepEqual(out.history, []);
});

test('a run that returns no pastStages keeps the note stages whose note still exists', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', history: [],
    notes: [{ id: 'n1', date: '2026-06-01', text: 'first flowers' }],
    noteStages: [{ date: '2026-06-01', stage: 'flowering', noteId: 'n1' }] } } };
  const out = mergePlan(status, [{ id: 'a', guidance: 'g', observations: '' }], '2026-09-30', 1000).status.plants.a;
  assert.deepEqual(out.noteStages, [{ date: '2026-06-01', stage: 'flowering', noteId: 'n1' }]);
});

test('the old health read is cleared, not left to go stale', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', notes: [], history: [],
    health: { label: 'thirsty', tone: 'watch', issues: [] } } } };
  const out = mergePlan(status, [{ id: 'a', guidance: 'g', observations: '' }], '2026-09-30', 1000).status.plants.a;
  assert.equal(out.health, undefined);
});

/* ---- the model's own last answers, and the starting stage ---- */

test('the model gets the starting stage, not its own last stage, and no history', () => {
  const c = planContext({ a: { id: 'a', stage: 'harvesting', baseStage: 'flowering', notes: [],
    history: [{ date: '2026-09-01', stage: 'harvesting' }] } })[0];
  assert.equal(c.stage, undefined);
  assert.equal(c.history, undefined);
  assert.equal(c.baseStage, 'flowering');
});

test('with no inventory stage the stored stage is the starting point', () => {
  assert.equal(planContext({ a: { id: 'a', stage: 'growing', notes: [] } })[0].baseStage, 'growing');
});

test('the last dated stages go back labelled as the model\'s own answer', () => {
  const ns = [{ date: '2026-07-12', stage: 'flowering', noteId: 'n1' }];
  const c = planContext({ a: { id: 'a', stage: 'flowering', notes: [{ id: 'n1', text: 'flowers' }], noteStages: ns } })[0];
  assert.equal(c.noteStages, undefined);
  assert.deepEqual(c.previousStages, [{ stage: 'flowering', date: '2026-07-12', noteId: 'n1' }]);
  assert.equal(planContext({ b: { id: 'b', notes: [] } })[0].previousStages, undefined);
});

test('the prompt asks for today\'s stage from notes or photos, else the starting stage', () => {
  const sys = buildGeminiBody({ plants: { 'tomato-2': PLANT } }, { days: {} }, '2026-09-30', {}).system_instruction.parts[0].text;
  assert.match(sys, /baseStage/);
  assert.match(sys, /previousStages/);
  assert.match(sys, /keep each of its dates unless a note now gives a different date or the note behind it is gone/);
  assert.match(sys, /must include the date the current stage began/);
  assert.doesNotMatch(sys, /else unchanged/);
  assert.doesNotMatch(sys, /stageSince/);
});

test('only the model\'s own fields are merged; everything else in the doc is kept', () => {
  const fresh = { updatedAt: 5, plants: { a: { id: 'a', stage: 'growing', lastWatered: '2026-09-30',
    notes: [{ id: 'n-new', text: 'added while the model was thinking' }], history: [{ date: '2026-06-01', stage: 'growing' }] } } };
  const out = mergeStatus(fresh, [{ id: 'a', stage: 'fruiting', stageNoteId: 'n-new', observations: 'Fruit set.',
    pastStages: [{ stage: 'fruiting', date: '2026-09-20', noteId: 'n-new' }], guidance: 'g' }], '2026-09-30', 9).plants.a;
  assert.deepEqual(out.notes, fresh.plants.a.notes);
  assert.equal(out.lastWatered, '2026-09-30');
  assert.deepEqual(out.history, fresh.plants.a.history);
  assert.equal(out.stage, 'fruiting');
  assert.equal(out.observations, 'Fruit set.');
  assert.deepEqual(out.noteStages, [{ date: '2026-09-20', stage: 'fruiting', noteId: 'n-new' }]);
});

test('a plant out of the inventory is not touched', () => {
  const doc = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing' }, old: { id: 'old', stage: 'growing' } } };
  const out = mergeStatus(doc, [{ id: 'old', stage: 'dormant' }], '2026-09-30', 1, new Set(['a']));
  assert.equal(out.plants.old.stage, 'growing');
});

/* ---- the care doc ---- */

test('care starts from the previous plants and replaces only those with new guidance', () => {
  const prev = { generatedAt: 1, basedOn: 1, lastError: { at: 2, code: 'model' },
    plants: { a: { guidance: 'old a', upcoming: [] }, b: { guidance: 'old b', upcoming: [] }, gone: { guidance: 'x' } } };
  const care = mergeCare(prev, [{ id: 'a', guidance: 'new a' }, { id: 'b', guidance: '  ' }], 10, 7, new Set(['a', 'b']));
  assert.deepEqual(care, { generatedAt: 10, basedOn: 7,
    plants: { a: { guidance: 'new a', upcoming: [] }, b: { guidance: 'old b', upcoming: [] } } });
});

test('fewer than half the plants back is not enough', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.equal(enoughPlants([{ id: 'a', guidance: 'g' }], ids), false);
  assert.equal(enoughPlants([{ id: 'a', guidance: 'g' }, { id: 'b', guidance: 'g' }], ids), true);
  assert.equal(enoughPlants([{ id: 'a', guidance: 'g' }, { id: 'x', guidance: 'g' }, { id: 'b', guidance: '' }], ids), false);
});

test('a failure keeps the previous care and only adds lastError', () => {
  const prev = { generatedAt: 1, basedOn: 1, plants: { a: { guidance: 'g' } } };
  assert.deepEqual(failedCare(prev, 'parse', 9), { ...prev, lastError: { at: 9, code: 'parse' } });
  assert.deepEqual(failedCare(null, 'model', 9), { plants: {}, lastError: { at: 9, code: 'model' } });
});

test('inventoryOf maps the seed by id, or gives null when there is none', () => {
  assert.equal(inventoryOf(null), null);
  assert.equal(inventoryOf({ plants: [{ id: 'a', stage: 'growing' }] }).get('a').stage, 'growing');
});

/* ---- a whole run against a fake store ---- */

function fakeEnv(stored, seedPlants) {
  const m = new Map(Object.entries(stored).map(([k, v]) => [k, JSON.stringify(v)]));
  const seed = 'export const S = JSON.parse(`' + JSON.stringify({ plants: seedPlants }) + '`);';
  return { m, GEMINI_API_KEY: 'k',
    PHOTOS: {
      get: async (k) => (m.has(k) ? m.get(k) : null),
      put: async (k, v) => void m.set(k, v),
      list: async () => ({ keys: [], list_complete: true }),
    },
    ASSETS: { fetch: async () => new Response(seed) } };
}
const reply = (obj) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }));
const forecastReply = () => new Response(JSON.stringify({ daily: { time: [] } }));
async function withFetch(fn, body) {
  const real = globalThis.fetch;
  globalThis.fetch = fn;
  try { return await body(); } finally { globalThis.fetch = real; }
}
const STATUS = { updatedAt: 0, plants: {
  a: { id: 'a', stage: 'harvesting', notes: [], history: [] },
  b: { id: 'b', stage: 'growing', notes: [], history: [] },
  gone: { id: 'gone', stage: 'growing', notes: [], history: [] } } };
const SEED = [{ id: 'a', stage: 'flowering', area: 'balcony' }, { id: 'b', stage: 'growing', area: 'indoor' }];

test('a run merges into the status as it is after the reply, and stamps basedOn', async () => {
  const env = fakeEnv({ [KEYS.status]: STATUS, [KEYS.care]: { generatedAt: 1, plants: {}, lastError: { at: 1, code: 'model' } } }, SEED);
  let sent;
  const before = Date.now();
  await withFetch(async (url, init) => {
    if (String(url).includes('open-meteo')) return forecastReply();
    sent = JSON.parse(init.body);
    // a note lands while the model is thinking
    const s = JSON.parse(env.m.get(KEYS.status));
    s.plants.b.notes.push({ id: 'late', text: 'late note' });
    env.m.set(KEYS.status, JSON.stringify(s));
    return reply({ plants: [{ id: 'a', stage: 'flowering', observations: 'o', guidance: 'ga', upcoming: [] },
      { id: 'b', observations: 'o', guidance: 'gb', upcoming: [] },
      { id: 'gone', stage: 'dormant', observations: 'o', guidance: 'gg', upcoming: [] }] });
  }, () => replan(env));
  const ctx = JSON.parse(sent.contents[0].parts[0].text.replace(/^[^{]*/, ''));
  assert.deepEqual(ctx.plants.map((p) => p.id), ['a', 'b']);           // dropped plant not sent
  assert.equal(ctx.plants[0].baseStage, 'flowering');                    // the inventory's stage
  const status = JSON.parse(env.m.get(KEYS.status));
  assert.equal(status.plants.b.notes[0].id, 'late');
  assert.equal(status.plants.a.stage, 'flowering');
  assert.equal(status.plants.gone.stage, 'growing');
  const care = JSON.parse(env.m.get(KEYS.care));
  assert.ok(care.basedOn >= before && care.basedOn <= care.generatedAt);
  assert.equal(care.lastError, undefined);
  assert.deepEqual(Object.keys(care.plants).sort(), ['a', 'b']);
});

for (const [name, fetcher, code] of [
  ['the forecast cannot be reached', async () => { throw new Error('down'); }, 'forecast'],
  ['the model errors', async (u) => (String(u).includes('open-meteo') ? forecastReply() : new Response('no', { status: 503 })), 'model'],
  ['the model replies with junk', async (u) => (String(u).includes('open-meteo') ? forecastReply()
    : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }))), 'parse'],
  ['too few plants come back', async (u) => (String(u).includes('open-meteo') ? forecastReply()
    : reply({ plants: [] })), 'partial'],
]) {
  test(`when ${name}, status is untouched and care records '${code}'`, async () => {
    const prevCare = { generatedAt: 3, basedOn: 3, plants: { a: { guidance: 'keep me' } } };
    const env = fakeEnv({ [KEYS.status]: STATUS, [KEYS.care]: prevCare }, SEED);
    const statusBefore = env.m.get(KEYS.status);
    await withFetch(fetcher, () => replan(env));
    assert.equal(env.m.get(KEYS.status), statusBefore);
    const care = JSON.parse(env.m.get(KEYS.care));
    assert.equal(care.lastError.code, code);
    assert.equal(care.generatedAt, 3);
    assert.equal(care.basedOn, 3);
    assert.equal(care.plants.a.guidance, 'keep me');
  });
}

/* ---- every stage cites the note it came from ---- */

const BASIL = { id: 'basil-2', stage: 'flowering', history: [],
  notes: [{ id: 'n1', date: '2026-07-01', text: 'Pinched it.' }],
  noteStages: [{ date: '2026-07-25', stage: 'flowering', noteId: 'gone' }],
  observations: 'Small white flowers at the tips.', readNotes: ['n1', 'gone'] };

test('the schema asks for stageNoteId and a noteId on every past stage', () => {
  const item = buildGeminiBody({ plants: {} }, { days: {} }, '2026-09-30', {}).generationConfig.responseSchema.properties.plants.items;
  assert.ok(item.properties.stageNoteId);
  assert.ok(item.required.includes('stageNoteId'));
  assert.deepEqual(item.properties.pastStages.items.required, ['stage', 'date', 'noteId']);
});

test('the prompt asks every stage to cite its note and never a note that does not say it', () => {
  const sys = buildGeminiBody({ plants: {} }, { days: {} }, '2026-09-30', {}).system_instruction.parts[0].text;
  assert.match(sys, /stageNoteId/);
  assert.match(sys, /"photo"/);
  assert.match(sys, /every pastStages item must cite, as noteId/);
  assert.match(sys, /Never cite a note that does not say it/);
});

test('a stage whose note is gone is not handed back, nor is a read that leaned on it', () => {
  const c = planContext({ 'basil-2': BASIL })[0];
  assert.equal(c.previousStages, undefined);
  assert.equal(c.previousRead, undefined);
  assert.equal(c.baseStage, 'flowering');
});

test('surviving past stages go back with their dates; a read whose notes all remain goes back', () => {
  const c = planContext({ a: { ...BASIL, readNotes: ['n1'],
    noteStages: [{ date: '2026-07-01', stage: 'growing', noteId: 'n1' }, { date: '2026-07-25', stage: 'flowering', noteId: 'gone' },
      { date: '2026-06-01', stage: 'seedling' }] } })[0];
  assert.deepEqual(c.previousStages, [{ stage: 'growing', date: '2026-07-01', noteId: 'n1' }]);
  assert.deepEqual(c.previousRead, { observations: 'Small white flowers at the tips.' });
});

test('a read with no record of the notes behind it is not handed back', () => {
  const { readNotes, ...old } = BASIL;
  assert.equal(planContext({ a: old })[0].previousRead, undefined);
});

test('citedStages keeps the starting stage and stages that cite a real note', () => {
  const plant = { notes: [{ id: 'n1' }] };
  assert.equal(citedStages({ stage: 'growing', stageNoteId: '' }, plant, 'growing', false).stage, 'growing');
  assert.equal(citedStages({ stage: 'flowering', stageNoteId: 'n1' }, plant, 'growing', false).stage, 'flowering');
});

test('citedStages sends an uncited or wrongly cited stage back to the starting stage', () => {
  const plant = { notes: [{ id: 'n1' }] };
  assert.equal(citedStages({ stage: 'flowering', stageNoteId: '' }, plant, 'growing', false).stage, 'growing');
  assert.equal(citedStages({ stage: 'flowering', stageNoteId: 'gone' }, plant, 'growing', false).stage, 'growing');
  assert.equal(citedStages({ stage: 'flowering' }, plant, 'growing', false).stage, 'growing');
  assert.equal(citedStages({ stage: 'ripening', stageNoteId: 'n1' }, plant, 'growing', false).stage, 'growing');
});

test('citedStages takes "photo" only on a run that sent photos of the plant', () => {
  const plant = { notes: [] };
  assert.equal(citedStages({ stage: 'flowering', stageNoteId: 'photo' }, plant, 'growing', true).stage, 'flowering');
  assert.equal(citedStages({ stage: 'flowering', stageNoteId: 'photo' }, plant, 'growing', false).stage, 'growing');
});

test('citedStages drops past stages that cite no current note', () => {
  const out = citedStages({ stage: 'growing', pastStages: [{ stage: 'flowering', date: '2026-07-25', noteId: 'gone' },
    { stage: 'growing', date: '2026-07-01', noteId: 'n1' }, { stage: 'seedling', date: '2026-05-01' }] },
  { notes: [{ id: 'n1' }] }, 'growing', false);
  assert.deepEqual(out.pastStages, [{ stage: 'growing', date: '2026-07-01', noteId: 'n1' }]);
  assert.equal(citedStages({ stage: 'growing' }, { notes: [] }, 'growing', false).pastStages, undefined);
});

test('a deleted note takes its stage with it, whatever the model remembers', () => {
  const doc = { updatedAt: 0, plants: { 'basil-2': BASIL } };
  const ai = [{ id: 'basil-2', stage: 'flowering', stageNoteId: 'gone', observations: 'Leafy.', guidance: 'g',
    pastStages: [{ stage: 'flowering', date: '2026-07-25', noteId: 'gone' }] }];
  const out = mergeStatus(doc, ai, '2026-09-30', 9, null, { baseStages: { 'basil-2': 'growing' },
    photoPlants: new Set(), readNotes: { 'basil-2': ['n1'] } }).plants['basil-2'];
  assert.equal(out.stage, 'growing');
  assert.deepEqual(out.noteStages, []);
  assert.deepEqual(out.readNotes, ['n1']);
});

test('the merge records which notes the run read, by default the plant\'s current ones', () => {
  const doc = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', notes: [{ id: 'n1' }, { id: 'n2' }] } } };
  assert.deepEqual(mergeStatus(doc, [{ id: 'a', stage: 'growing' }], '2026-09-30', 9).plants.a.readNotes, ['n1', 'n2']);
});

test('a run sends note ids and starting stages, and checks citations against both', async () => {
  const status = { updatedAt: 0, plants: {
    a: { id: 'a', stage: 'flowering', history: [], notes: [{ id: 'n1', date: '2026-07-25', text: 'Flowering.' }] },
    b: { id: 'b', stage: 'flowering', history: [], notes: [] } } };
  const env = fakeEnv({ [KEYS.status]: status }, [{ id: 'a', stage: 'growing' }, { id: 'b', stage: 'growing' }]);
  let sent;
  await withFetch(async (url, init) => {
    if (String(url).includes('open-meteo')) return forecastReply();
    sent = JSON.parse(init.body);
    return reply({ plants: [
      { id: 'a', stage: 'flowering', stageNoteId: 'n1', observations: 'o', guidance: 'g', upcoming: [],
        pastStages: [{ stage: 'flowering', date: '2026-07-25', noteId: 'n1' }] },
      { id: 'b', stage: 'flowering', stageNoteId: 'photo', observations: 'o', guidance: 'g', upcoming: [] }] });
  }, () => replan(env));
  const ctx = JSON.parse(sent.contents[0].parts[0].text.replace(/^[^{]*/, ''));
  assert.equal(ctx.plants[0].notes[0].id, 'n1');
  const out = JSON.parse(env.m.get(KEYS.status)).plants;
  assert.equal(out.a.stage, 'flowering');
  assert.deepEqual(out.a.noteStages, [{ date: '2026-07-25', stage: 'flowering', noteId: 'n1' }]);
  assert.deepEqual(out.a.readNotes, ['n1']);
  assert.equal(out.b.stage, 'growing');            // no photos went with this run
});

test('a run that omits pastStages drops kept stages whose note is gone', () => {
  const status = { updatedAt: 0, plants: { a: { id: 'a', stage: 'growing', history: [],
    notes: [{ id: 'n2', date: '2026-08-01', text: 'fruit set' }],
    noteStages: [{ date: '2026-07-25', stage: 'flowering', noteId: 'n1' },
      { date: '2026-08-01', stage: 'fruiting', noteId: 'n2' }] } } };
  const out = mergeStatus(status, [{ id: 'a', guidance: 'g', observations: '', stage: 'growing', stageNoteId: '' }],
    '2026-09-30', 1000, null, { baseStages: { a: 'growing' } }).plants.a;
  assert.deepEqual(out.noteStages, [{ date: '2026-08-01', stage: 'fruiting', noteId: 'n2' }]);
});
