import { readStatus, writeStatus, readCare, writeCare, cleanNoteStages } from './garden.js';
import { readSeed } from './seed.js';

// The stage words the season bar knows. A word outside this list gets no band.
export const STAGES = ['seedling', 'settling', 'growing', 'flowering', 'fruiting', 'harvesting', 'dormant'];
const STAGES_HINT = `stage, pastStages[].stage and upcoming[].stage use only these words: ${STAGES.join(', ')}.`;

export function selectPhotos(list, plantId, date, cap = 3) {
  return list
    .filter((p) => p.plant === plantId && p.date === date)
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .slice(0, cap);
}

export function parseForecast(json) {
  const d = json.daily || {};
  const days = {};
  (d.time || []).forEach((t, i) => {
    days[t] = { tmax: d.temperature_2m_max?.[i], tmin: d.temperature_2m_min?.[i],
      pop: d.precipitation_probability_max?.[i], rh: d.relative_humidity_2m_mean?.[i] };
  });
  return { days };
}

// Gemini structured output cannot emit dynamic object keys (a map keyed by plant
// id comes back empty), so the reply is an ARRAY of plant objects each carrying
// its own `id`. mergeStatus and mergeCare normalise it back to the id-keyed map the page wants.
const CARE_SCHEMA = {
  type: 'object',
  properties: {
    plants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          observations: { type: 'string' },
          stage: { type: 'string' },
          stageNoteId: { type: 'string' },
          pastStages: {
            type: 'array',
            items: {
              type: 'object',
              properties: { stage: { type: 'string' }, date: { type: 'string' }, noteId: { type: 'string' } },
              required: ['stage', 'date', 'noteId'],
            },
          },
          guidance: { type: 'string' },
          upcoming: {
            type: 'array',
            items: {
              type: 'object',
              properties: { stage: { type: 'string' }, date: { type: 'string' } },
              required: ['stage', 'date'],
            },
          },
        },
        required: ['id', 'observations', 'stage', 'stageNoteId', 'guidance', 'upcoming'],
      },
    },
  },
  required: ['plants'],
};

/* What the model gets per plant. The gardener's notes are the facts, newest first.
   Everything the model itself wrote last time is handed back labelled as its own
   last answer (previousRead, previousStages), to check against the notes, never
   as the current state to copy. The stored stage is left out for the same reason:
   the model starts from baseStage, the inventory's starting stage, so deleting
   the note that moved a stage moves it back. history is left out too, since older
   runs wrote their own guesses into it.
   Each note goes with its id, so every stage the model gives can name the note
   it came from. A last answer that leans on a deleted note is not handed back:
   previousStages keeps only the stages whose note is still there, and
   previousRead is left out once any note the last run read (readNotes) is gone,
   or when the last run did not record what it read. */
export function planContext(plants) {
  return Object.values(plants || {}).map((p) => {
    const { notes, observations, health, noteStages, stage, history, updatedAt, baseStage, readNotes, ...rest } = p;
    const ids = noteIds(p);
    const out = { ...rest, baseStage: baseStage || stage,
      notes: [...(notes || [])]
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0))
        .map((n) => ({ id: n.id, date: n.date, text: n.text })) };
    if (observations && Array.isArray(readNotes) && readNotes.every((id) => ids.has(id))) out.previousRead = { observations };
    const stages = (noteStages || []).filter((s) => s && ids.has(s.noteId))
      .map((s) => ({ stage: s.stage, date: s.date, noteId: s.noteId }));
    if (stages.length) out.previousStages = stages;
    return out;
  });
}

const noteIds = (plant) => new Set((plant?.notes || []).map((n) => n && n.id).filter(Boolean));

/* What the model may claim about one plant's stage, checked against the notes
   it really has now. A past stage stands only when it names one of those
   notes. Today's stage stands when it is the starting stage, or names one of
   those notes, or says 'photo' on a run that sent photos of the plant;
   anything else falls back to the starting stage. So a deleted note takes its
   stage with it, whatever the model remembers. */
export function citedStages(r, plant, baseStage, hadPhotos) {
  const ids = noteIds(plant);
  const pastStages = Array.isArray(r?.pastStages)
    ? r.pastStages.filter((p) => p && typeof p.noteId === 'string' && ids.has(p.noteId)) : undefined;
  const cite = r?.stageNoteId;
  const ok = STAGES.includes(r?.stage) && (r.stage === baseStage
    || (typeof cite === 'string' && ids.has(cite)) || (cite === 'photo' && hadPhotos));
  return { stage: ok ? r.stage : baseStage, pastStages };
}

export function buildGeminiBody(statusDoc, forecast, today, photoPartsByPlant) {
  const context = { today, plants: planContext(statusDoc.plants), forecast: forecast.days };
  const parts = [{ text: 'GARDEN CONTEXT (JSON):\n' + JSON.stringify(context) }];
  for (const [plantId, imgParts] of Object.entries(photoPartsByPlant)) {
    if (imgParts.length) parts.push({ text: `Photos for plant ${plantId} (taken today):` }, ...imgParts);
  }
  return {
    system_instruction: {
      parts: [{ text:
        'You are a garden care adviser for a household in Tampere, Finland. ' +
        'Given each plant\'s status, recent notes, same-day photos, and the 14-day forecast, ' +
        'write current care guidance for every plant. EVERY plant in the context MUST appear as ' +
        'an entry in plants[] (with its exact id), even if healthy. ' +
        'notes are the gardener\'s own first-hand reports, newest first, and they are the most ' +
        'reliable thing you have. previousRead is what you wrote last time; it may be out of date. ' +
        'When a note is newer than what previousRead describes, the note wins: if it says the plant ' +
        'is fruiting or being harvested, observations and stage must say so too. Never ' +
        'carry a detail over from previousRead that a newer note contradicts. ' +
        'stage is the stage the plant is in today: from the newest note or photo that shows it; ' +
        'if no note or photo supports a later stage, the plant\'s baseStage (its starting stage ' +
        'from the plant list). Each note has an id. stageNoteId cites where stage comes from: ' +
        'the id of the note that shows it, or "photo" when today\'s photos of that plant show it, ' +
        'or "" when stage is the baseStage. A stage that differs from baseStage must cite a note ' +
        'or photo; every pastStages item must cite, as noteId, the id of the note it comes from. ' +
        'Never cite a note that does not say it; a stage with nothing to cite is not given. ' +
        'pastStages is every stage change the notes show, each with the date it began, and it ' +
        'must include the date the current stage began ("harvesting since late August" means a ' +
        'date in late August). previousStages is your own last answer for pastStages: keep each ' +
        'of its dates unless a note now gives a different date or the note behind it is gone. ' +
        'When a ' +
        'note says when, in any words, turn that into a date: "on 12 July" is that day, "early" ' +
        'a month is the 5th, "mid" the 15th, "end of" or "late" the 25th, "since August" the 1st. ' +
        'Only when a note gives no time at all, use the date of the earliest note that reports ' +
        'it. Only changes a note supports; never invent one, and never a future date. ' +
        'observations is one or two sentences saying what the plant is doing right now, in plain ' +
        'words, as the status line under its chart. Describe what you can see, not what to do. ' +
        'upcoming is the stage changes you expect over the next three months, each with the date ' +
        'you expect it, earliest first. Give an empty array when ' +
        'you expect no change, and never repeat a stage the plant is already in. ' +
        'guidance is two to four short sentences of plain advice for right now: how often to ' +
        'water it at the moment, what to feed it, what to watch for. Never give a date, a day ' +
        'of the week or a deadline, and never write it as a checklist. The guidance is shown ' +
        'under the plant it belongs to, so never repeat the plant name in it. ' +
        'Each plant has an "area". area="balcony" means a glazed balcony: the forecast drives its ' +
        'watering, it bakes on hot days and chills on cold nights. area="indoor" means a heated room: ' +
        'the forecast does NOT apply to it, never mention heat, frost or venting for an indoor ' +
        'plant, and keep its watering on a steady rhythm. ' +
        STAGES_HINT + ' Return JSON matching the schema.' }],
    },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: CARE_SCHEMA },
  };
}

export function parsePlanResponse(geminiJson) {
  // Thinking models can prepend a thought part with no `.text`; take the first text part.
  const parts = geminiJson?.candidates?.[0]?.content?.parts || [];
  const text = parts.find((p) => typeof p?.text === 'string')?.text;
  if (!text) throw new Error('no plan text in response');
  return JSON.parse(text).plants || [];
}

/* The model owns three things per plant: observations, stage and noteStages.
   Only those are written, into whatever status doc is passed in (the caller
   passes one read AFTER the model replied, so nothing written meanwhile is lost).
   history is the gardener's own stage edits and is never touched here.
   aiPlants is an ARRAY of {id, observations, stage, stageNoteId, pastStages?, guidance, upcoming}.
   allowed: the inventory ids; a plant the inventory has dropped is ignored.
   run says what this run sent: baseStages {id: starting stage} (else the
   stored stage), photoPlants (ids whose photos went with it) and readNotes
   {id: [note ids]}, kept on the plant so the next run knows what this read
   leaned on. Stages are checked by citedStages against the notes as they are
   now, so a note deleted while the model was thinking cites nothing. */
export function mergeStatus(statusDoc, aiPlants, today, now, allowed = null, run = {}) {
  const plants = { ...statusDoc.plants };
  for (const r of aiPlants || []) {
    const id = r && r.id; if (!id) continue;
    const prev = plants[id]; if (!prev || (allowed && !allowed.has(id))) continue;
    const { health, ...kept } = prev;               // health is no longer read, so an old one is dropped
    const base = run.baseStages?.[id] || prev.stage;
    const { stage, pastStages } = citedStages(r, prev, base, !!run.photoPlants?.has(id));
    const read = run.readNotes?.[id] || [...noteIds(prev)];
    plants[id] = { ...kept,
      observations: r.observations ?? prev.observations,
      stage,
      // A run that omits pastStages keeps the ones it had, but only those whose
      // note still exists: a deleted note's stage must not outlive it.
      noteStages: pastStages ? cleanNoteStages(pastStages, today, STAGES)
        : (prev.noteStages || []).filter((s) => s && s.noteId && noteIds(prev).has(s.noteId)),
      readNotes: read,
      updatedAt: now };
  }
  return { ...statusDoc, updatedAt: now, plants };
}

/* The care doc. Contract with the page:
     basedOn    the time taken right before this run read the status. Every note
                filed before that is in the guidance, so the page treats guidance
                as fresh for an entry once care.basedOn >= the entry's filedAt
                (or createdAt).
     generatedAt when the guidance was written.
     lastError  {at, code} when the latest run failed; code is 'forecast', 'model',
                'parse', 'partial' or 'internal'. A good run clears it. A failed
                run keeps the previous plants, generatedAt and basedOn.
   A run starts from the previous plants and overwrites only those the model
   gave real guidance for, so a plant it skipped keeps its last advice. */
export function mergeCare(prevCare, aiPlants, now, basedOn, allowed = null) {
  const keep = Object.entries(prevCare?.plants || {}).filter(([id]) => !allowed || allowed.has(id));
  const plants = Object.fromEntries(keep);
  for (const r of aiPlants || []) {
    const id = r && r.id;
    if (!id || (allowed && !allowed.has(id)) || typeof r.guidance !== 'string' || !r.guidance.trim()) continue;
    const upcoming = (r.upcoming || [])
      .filter((u) => u && u.stage && u.date)
      .map((u) => ({ stage: u.stage, date: u.date }))
      .sort((a, b) => a.date.localeCompare(b.date));
    plants[id] = { guidance: r.guidance, upcoming };
  }
  return { generatedAt: now, basedOn, plants };
}

/* How many inventory plants came back with guidance. Fewer than half is
   treated as a failed run rather than a garden of stale advice. */
export function enoughPlants(aiPlants, ids) {
  const got = new Set((aiPlants || []).filter((r) => r && ids.includes(r.id) && typeof r.guidance === 'string' && r.guidance.trim()).map((r) => r.id));
  return got.size * 2 >= ids.length;
}

/* A failed run leaves the status alone and the care doc as it was, plus a note
   of what went wrong, so the page can say so instead of waiting forever. */
export function failedCare(prevCare, code, now) {
  return { ...(prevCare || { plants: {} }), lastError: { at: now, code } };
}

const FORECAST_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=61.4978&longitude=23.7610' +
  '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,relative_humidity_2m_mean' +
  '&forecast_days=14&timezone=auto';
const MODEL = 'gemini-flash-latest';

async function listPhotos(env) {
  const out = []; let cursor;
  do {
    const page = await env.PHOTOS.list({ prefix: 'photo:', cursor });
    for (const k of page.keys) out.push({ id: k.name.slice('photo:'.length), ...(k.metadata || {}) });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

export function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000; // 32KB, safely under the arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function photoPart(env, id) {
  const obj = await env.PHOTOS.getWithMetadata('photo:' + id, { type: 'arrayBuffer' });
  if (!obj || !obj.value) return null;
  const b64 = bytesToBase64(obj.value);
  return { inline_data: { mime_type: (obj.metadata && obj.metadata.ct) || 'image/jpeg', data: b64 } };
}

/* The garden's own date, Tampere time, so a note written just after midnight is
   not a day in the future to a server running on UTC. */
function todayISO() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date()); }

const FORECAST_TIMEOUT_MS = 15000;
const MODEL_TIMEOUT_MS = 50000;

/* The plants a run is about: those still in the inventory file. If the file
   cannot be read, every stored plant, rather than none. */
export function inventoryOf(seed) {
  const list = seed?.plants || [];
  return list.length ? new Map(list.map((p) => [p.id, p])) : null;
}

async function noteFailure(env, code) {
  try { await writeCare(env, failedCare(await readCare(env), code, Date.now())); } catch { /* nothing more to do */ }
}

/* One full care run. Callers on a write path go through scheduleReplan
   (schedule.js) so a burst of edits runs this once; the nightly cron calls it
   directly. It never throws (it runs in ctx.waitUntil). */
export async function replan(env) {
  try {
    const basedOn = Date.now();
    const status = await readStatus(env);
    const inventory = inventoryOf(await readSeed(env));
    const ids = Object.keys(status.plants).filter((id) => !inventory || inventory.has(id));
    if (!ids.length) return;
    const allowed = new Set(ids);
    const today = todayISO();
    let forecast;
    try {
      forecast = parseForecast(await (await fetch(FORECAST_URL, { signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS) })).json());
    } catch { return noteFailure(env, 'forecast'); }

    // Same-day photos help but are not essential: if they cannot be gathered, go without.
    let photoPartsByPlant = {};
    try {
      const photos = await listPhotos(env);
      for (const id of ids) {
        const parts = [];
        for (const p of selectPhotos(photos, id, today)) { const part = await photoPart(env, p.id); if (part) parts.push(part); }
        photoPartsByPlant[id] = parts;
      }
    } catch { photoPartsByPlant = {}; }

    // Place and starting stage come from the inventory each run, and are only
    // handed to the model, never written back.
    const context = { ...status, plants: Object.fromEntries(ids.map((id) => {
      const p = status.plants[id]; const s = inventory?.get(id);
      return [id, { ...p, area: s?.area || 'balcony', baseStage: s?.stage || p.stage }];
    })) };

    const body = buildGeminiBody(context, forecast, today, photoPartsByPlant);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    let res;
    try {
      res = await fetch(url, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(body), signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
    } catch { return noteFailure(env, 'model'); }
    if (!res.ok) return noteFailure(env, 'model');
    let aiPlants;
    try { aiPlants = parsePlanResponse(await res.json()); } catch { return noteFailure(env, 'parse'); }
    if (!enoughPlants(aiPlants, ids)) return noteFailure(env, 'partial');

    // The model took a while: merge into the status as it is NOW, not the copy read above.
    const now = Date.now();
    const run = {
      baseStages: Object.fromEntries(ids.map((id) => [id, context.plants[id].baseStage])),
      photoPlants: new Set(ids.filter((id) => (photoPartsByPlant[id] || []).length)),
      readNotes: Object.fromEntries(ids.map((id) => [id, [...noteIds(context.plants[id])]])),
    };
    await writeStatus(env, mergeStatus(await readStatus(env), aiPlants, today, now, allowed, run));
    await writeCare(env, mergeCare(await readCare(env), aiPlants, now, basedOn, allowed));
  } catch { return noteFailure(env, 'internal'); } // safety net: no throw may escape
}
