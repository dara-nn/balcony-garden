import { readStatus, writeStatus, writePlan } from './garden.js';
import { readSeed } from './seed.js';

const STAGES_HINT = 'Use only the plant\'s allowed stages.';

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

function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Gemini structured output cannot emit dynamic object keys (a map keyed by plant
// id comes back empty), so the plan is an ARRAY of plant objects each carrying its
// own `id`. mergePlan normalises it back to the id-keyed map the client expects.
const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['pest', 'disease', 'nutrient', 'water', 'stress', 'damage'] },
    label: { type: 'string' },
    severity: { type: 'string', enum: ['mild', 'moderate', 'severe'] },
  },
  required: ['type', 'label', 'severity'],
};
const TASK_SCHEMA = {
  type: 'object',
  properties: {
    cat: { type: 'string', enum: ['water', 'pollen', 'care', 'alert'] },
    what: { type: 'string' },
    why: { type: 'string' },
  },
  required: ['cat', 'what', 'why'],
};
const PLAN_SCHEMA = {
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
          days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string' },
                tasks: { type: 'array', items: TASK_SCHEMA },
              },
              required: ['date', 'tasks'],
            },
          },
        },
        required: ['id', 'health', 'observations', 'days'],
      },
    },
  },
  required: ['plants'],
};

// Task icon is derived from the category, never taken from model output.
const CAT_ICON = { water: '💧', pollen: '✋', care: '🌿', alert: '⚠️' };

export function buildGeminiBody(statusDoc, forecast, today, photoPartsByPlant) {
  const context = { today, plants: statusDoc.plants, forecast: forecast.days };
  const parts = [{ text: 'GARDEN CONTEXT (JSON):\n' + JSON.stringify(context) }];
  for (const [plantId, imgParts] of Object.entries(photoPartsByPlant)) {
    if (imgParts.length) parts.push({ text: `Photos for plant ${plantId} (taken today):` }, ...imgParts);
  }
  return {
    system_instruction: {
      parts: [{ text:
        'You are a garden care planner for a household in Tampere, Finland. ' +
        'Given each plant\'s status, recent notes, same-day photos, and the 14-day forecast, ' +
        'produce a task list for the next 14 days. EVERY plant in the context MUST appear as an ' +
        'entry in plants[] (with its exact id), even if healthy — assess its health and give it ' +
        'at least the appropriate watering days. Task categories: water, pollen, care, alert. ' +
        'Each open health issue must get a matching task (pest->treat, nutrient->feed, water->adjust). ' +
        'health.label is your own one-or-two-word verdict on that plant right now — say what you ' +
        'actually see ("thirsty", "in full swing", "bouncing back", "leggy", "nearly done"), not a ' +
        'word from a fixed list, and never repeat the stage. health.tone is only the colour it ' +
        'should carry: good, watch, or bad. ' +
        'Each plant has an "area". area="balcony" means a glazed balcony: the forecast drives its ' +
        'watering, it bakes on hot days and chills on cold nights. area="indoor" means a heated room: ' +
        'the forecast does NOT apply to it — never give an indoor plant a heat, frost or venting task, ' +
        'and keep its watering on a steady rhythm. ' +
        'Tasks are shown grouped under the plant they belong to, so never repeat the plant name in ' +
        '"what" — write "Water", not "Water Tigerella". ' +
        STAGES_HINT + ' Return JSON matching the schema. Keep "why" short.' }],
    },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: PLAN_SCHEMA },
  };
}

export function parsePlanResponse(geminiJson) {
  // Thinking models can prepend a thought part with no `.text`; take the first text part.
  const parts = geminiJson?.candidates?.[0]?.content?.parts || [];
  const text = parts.find((p) => typeof p?.text === 'string')?.text;
  if (!text) throw new Error('no plan text in response');
  return JSON.parse(text).plants || [];
}

// aiPlants is an ARRAY of {id, health, observations, stage?, days:[{date, tasks:[{cat,what,why}]}]}.
export function mergePlan(statusDoc, aiPlants, today, now) {
  const plants = { ...statusDoc.plants };
  const planPlants = {};
  for (const r of aiPlants || []) {
    const id = r && r.id; if (!id) continue;
    const prev = plants[id]; if (!prev) continue;
    plants[id] = { ...prev,
      health: r.health ?? prev.health,
      observations: r.observations ?? prev.observations,
      stage: r.stage ?? prev.stage,
      updatedAt: now };
    const days = {};
    for (const day of r.days || []) {
      if (!day || !day.date) continue;
      days[day.date] = (day.tasks || []).map((t, i) => ({
        cat: t.cat,
        ico: CAT_ICON[t.cat] || '🌿',   // derived from category, never from model output
        what: t.what,
        why: t.why,
        key: `ai|${id}|${day.date}|${i}`,
      }));
    }
    planPlants[id] = days;
  }
  return {
    status: { ...statusDoc, updatedAt: now, plants },
    plan: { generatedAt: now, through: addDaysISO(today, 13), plants: planPlants },
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

    // Place is not stored with the condition — it is read from the inventory each run,
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
    await writePlan(env, merged.plan);
  } catch { return; } // safety net: replan runs in ctx.waitUntil — no throw may escape
}
