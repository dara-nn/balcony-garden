import { readStatus, writeStatus, writePlan } from './garden.js';

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

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plants: {
      type: 'object',
      // per-plant objects are validated by prompt; Gemini responseSchema supports
      // nested object/array/string/enum. Keep the schema permissive on the map keys.
    },
  },
};

export function buildGeminiBody(statusDoc, forecast, today, photoPartsByPlant) {
  const context = { today, plants: statusDoc.plants, forecast: forecast.days };
  const parts = [{ text: 'GARDEN CONTEXT (JSON):\n' + JSON.stringify(context) }];
  for (const [plantId, imgParts] of Object.entries(photoPartsByPlant)) {
    if (imgParts.length) parts.push({ text: `Photos for plant ${plantId} (taken today):` }, ...imgParts);
  }
  return {
    system_instruction: {
      parts: [{ text:
        'You are a balcony-garden care planner for a glazed balcony in Tampere, Finland. ' +
        'Given each plant\'s status, recent notes, same-day photos, and the 14-day forecast, ' +
        'produce the per-plant task list for the next 14 days. Task categories: water, pollen, care, alert. ' +
        'Each open health issue must get a matching task (pest->treat, nutrient->feed, water->adjust). ' +
        STAGES_HINT + ' Return JSON matching the schema. Keep "why" short.' }],
    },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: PLAN_SCHEMA },
  };
}

export function parsePlanResponse(geminiJson) {
  const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('no plan text in response');
  return JSON.parse(text).plants;
}

export function mergePlan(statusDoc, aiPlants, today, now) {
  const plants = { ...statusDoc.plants };
  const planPlants = {};
  for (const [id, r] of Object.entries(aiPlants || {})) {
    const prev = plants[id]; if (!prev) continue;
    plants[id] = { ...prev,
      health: r.health ?? prev.health,
      observations: r.observations ?? prev.observations,
      stage: r.stage ?? prev.stage,
      updatedAt: now };
    const days = {};
    for (const [date, tasks] of Object.entries(r.days || {})) {
      days[date] = (tasks || []).map((t, i) => ({ ...t, key: `ai|${id}|${date}|${i}` }));
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
const MODEL = 'gemini-2.5-flash';

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

    const body = buildGeminiBody(status, forecast, today, photoPartsByPlant);
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
