import { readStatus, writeStatus, writeCare, recordStage } from './garden.js';
import { readSeed } from './seed.js';

// The stage words the season bar knows. A word outside this list gets no band.
const STAGES = ['seedling', 'settling', 'growing', 'flowering', 'fruiting', 'harvesting', 'dormant'];
const STAGES_HINT = `stage and upcoming[].stage use only these words: ${STAGES.join(', ')}.`;

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
// its own `id`. mergePlan normalises it back to the id-keyed map the page wants.
const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['pest', 'disease', 'nutrient', 'water', 'stress', 'damage'] },
    label: { type: 'string' },
    severity: { type: 'string', enum: ['mild', 'moderate', 'severe'] },
  },
  required: ['type', 'label', 'severity'],
};
const CARE_SCHEMA = {
  type: 'object',
  properties: {
    plants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          health: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              tone: { type: 'string', enum: ['good', 'watch', 'bad'] },
              issues: { type: 'array', items: ISSUE_SCHEMA },
            },
            required: ['label', 'tone', 'issues'],
          },
          observations: { type: 'string' },
          stage: { type: 'string' },
          stageSince: { type: 'string' },
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
        required: ['id', 'health', 'observations', 'guidance', 'upcoming'],
      },
    },
  },
  required: ['plants'],
};

/* What the model gets per plant. The gardener's notes are the facts, newest first.
   The model's own last description is handed back labelled as exactly that, so it
   reads as something to check against the notes, not as the current state to copy. */
export function planContext(plants) {
  return Object.values(plants || {}).map((p) => {
    const { notes, observations, health, updatedAt, ...rest } = p;
    const out = { ...rest,
      notes: [...(notes || [])]
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0))
        .map((n) => ({ date: n.date, text: n.text })) };
    if (observations || health?.label) out.previousRead = { observations: observations || '', health: health?.label || '' };
    return out;
  });
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
        'is fruiting or being harvested, observations, health and stage must say so too. Never ' +
        'carry a detail over from previousRead that a newer note contradicts. ' +
        'stage is the stage the plant is in today, taken from the newest note that says, else ' +
        'from what you see, else unchanged. ' +
        'stageSince is the date (YYYY-MM-DD) that stage began, read from the notes ("harvesting ' +
        'since late August" means a date in late August); give today when the notes do not say. ' +
        'observations is one or two sentences saying what the plant is doing right now, in plain ' +
        'words, as the status line under its chart. Describe what you can see, not what to do. ' +
        'upcoming is the stage changes you expect over the next three months, each with the date ' +
        'you expect it, earliest first. Give an empty array when ' +
        'you expect no change, and never repeat a stage the plant is already in. ' +
        'guidance is two to four short sentences of plain advice for right now: how often to ' +
        'water it at the moment, what to feed it, what to watch for. Never give a date, a day ' +
        'of the week or a deadline, and never write it as a checklist. The guidance is shown ' +
        'under the plant it belongs to, so never repeat the plant name in it. ' +
        'health.label is your own one-or-two-word verdict on that plant right now, say what you ' +
        'actually see ("thirsty", "in full swing", "bouncing back", "leggy", "nearly done"), not a ' +
        'word from a fixed list, and never repeat the stage. health.tone is only the colour it ' +
        'should carry: good, watch, or bad. ' +
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

// When the notes say a stage began earlier ("harvesting since late August"), the
// bar should start it there. Anything that is not a plain past date means today.
const sinceDate = (d, today) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && d <= today ? d : today);

// aiPlants is an ARRAY of {id, health, observations, stage?, guidance}.
export function mergePlan(statusDoc, aiPlants, today, now) {
  const plants = { ...statusDoc.plants };
  const carePlants = {};
  for (const r of aiPlants || []) {
    const id = r && r.id; if (!id) continue;
    const prev = plants[id]; if (!prev) continue;   // a plant the inventory has dropped
    plants[id] = { ...prev,
      health: r.health ?? prev.health,
      observations: r.observations ?? prev.observations,
      stage: r.stage ?? prev.stage,
      history: recordStage(prev, r.stage, sinceDate(r.stageSince, today)),
      updatedAt: now };
    if (r.guidance) {
      const upcoming = (r.upcoming || [])
        .filter((u) => u && u.stage && u.date)
        .map((u) => ({ stage: u.stage, date: u.date }))
        .sort((a, b) => a.date.localeCompare(b.date));
      carePlants[id] = { guidance: r.guidance, upcoming };
    }
  }
  return {
    status: { ...statusDoc, updatedAt: now, plants },
    care: { generatedAt: now, plants: carePlants },
  };
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

function todayISO() { return new Date().toISOString().slice(0, 10); }

export async function replan(env, { trigger } = {}) {
  try {
    const status = await readStatus(env);
    if (!Object.keys(status.plants).length) return;
    const today = todayISO();
    let forecast;
    try {
      forecast = parseForecast(await (await fetch(FORECAST_URL)).json());
    } catch { return; } // network failure: leave stores intact

    let photoPartsByPlant;
    try {
      const photos = await listPhotos(env);
      photoPartsByPlant = {};
      for (const id of Object.keys(status.plants)) {
        const picks = selectPhotos(photos, id, today);
        const parts = [];
        for (const p of picks) { const part = await photoPart(env, p.id); if (part) parts.push(part); }
        photoPartsByPlant[id] = parts;
      }
    } catch { return; } // photo-gathering failure (KV or encoding): leave stores intact

    // Place is not stored with the condition: it is read from the inventory each run,
    // and only handed to the model, never written back.
    const seed = await readSeed(env);
    const areas = Object.fromEntries((seed?.plants || []).map((p) => [p.id, p.area || 'balcony']));
    const withArea = { ...status, plants: Object.fromEntries(
      Object.entries(status.plants).map(([id, p]) => [id, { ...p, area: areas[id] || 'balcony' }])) };

    const body = buildGeminiBody(withArea, forecast, today, photoPartsByPlant);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    let res;
    try {
      res = await fetch(url, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(body) });
    } catch { return; } // network failure: leave stores intact
    if (!res.ok) return;
    let aiPlants;
    try { aiPlants = parsePlanResponse(await res.json()); } catch { return; }

    const now = Date.now();
    const merged = mergePlan(status, aiPlants, today, now);
    await writeStatus(env, merged.status);
    await writeCare(env, merged.care);
  } catch { return; } // safety net: replan runs in ctx.waitUntil, no throw may escape
}
