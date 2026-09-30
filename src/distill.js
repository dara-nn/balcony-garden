/* Turn one freestyle entry into per-plant observations.
   The user writes whatever they noticed; the model works out which plants it
   concerns and writes a short line for each. The raw text is never rewritten. */

import { readStatus, writeStatus } from './garden.js';
import { readEntries, writeEntries, assignEntry } from './entries.js';
import { replan, bytesToBase64 } from './planner.js';

const ASSIGNMENT_SCHEMA = {
  type: 'object',
  properties: {
    plantId: { type: 'string' },
    text: { type: 'string' },
    quote: { type: 'string' },
    mention: { type: 'string' },
    watered: { type: 'boolean' },
  },
  required: ['plantId', 'text', 'quote', 'mention', 'watered'],
};
const PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    index: { type: 'integer' },
    plantId: { type: 'string' },
  },
  required: ['index', 'plantId'],
};
const DISTILL_SCHEMA = {
  type: 'object',
  properties: {
    assignments: { type: 'array', items: ASSIGNMENT_SCHEMA },
    photos: { type: 'array', items: PHOTO_SCHEMA },
    confident: { type: 'boolean' },
  },
  required: ['assignments', 'confident'],
};

export function buildDistillBody(entry, roster, photos) {
  const parts = [{ text: 'PLANTS (JSON):\n' + JSON.stringify(roster) },
    { text: `ENTRY (${entry.date}):\n${entry.text}` }];
  photos.forEach((p, i) => {
    parts.push({ text: `Photo index ${i}:` }, p.part);
  });
  return {
    system_instruction: {
      parts: [{ text:
        'You sort a gardener\'s freestyle note into per-plant observations. ' +
        'Read the entry and decide which of the listed plants it concerns. For each one, ' +
        'write a short observation in the same language the gardener used. Rewrite it as a ' +
        'log entry about that plant: drop the plant name (the note is already filed under it), ' +
        'drop "I", and keep only what happened to the plant. Never return the entry verbatim. ' +
        'Example, entry "tigerella snapped today, I put a new support and tape it back on" ' +
        'becomes "Main stem snapped. Re-staked and taped." ' +
        'Also give "quote": the exact words from the entry that this plant\'s observation ' +
        'came from, copied verbatim and nothing more. If the entry says something about ' +
        'every plant ("watered everything"), quote just that part. ' +
        'Also give "mention": the exact words in the entry that name this plant, copied ' +
        'character for character from the entry and nothing more, so they can be found in it. ' +
        'They are shown as a tag in place of the name. When one phrase names several plants ' +
        '("all raspberry", "the chillies", "everything"), give every one of those plants that ' +
        'same phrase. If the entry never names the plant, return an empty string. ' +
        'Set watered=true only when the entry says that plant was watered. ' +
        'A note about "everything" or "all of them" concerns every plant listed. ' +
        'For each supplied photo, say which plant it shows using its index; omit a photo ' +
        'you cannot identify. Set confident=false if you are guessing which plant is meant ' +
        'and the gardener should confirm. Use only plant ids from the list.' }],
    },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: DISTILL_SCHEMA },
  };
}

export function parseDistillResponse(geminiJson) {
  const parts = geminiJson?.candidates?.[0]?.content?.parts || [];
  const text = parts.find((p) => typeof p?.text === 'string')?.text;
  if (!text) throw new Error('no distillation text in response');
  return JSON.parse(text);
}

/* photoIds is the list handed to the model, in the order it was shown them. */
export function mergeDistill(statusDoc, entriesDoc, entry, result, now, photoIds = []) {
  const plants = { ...statusDoc.plants };
  const assigned = [];
  const known = (result.assignments || []).filter((a) => a && plants[a.plantId]);

  if (result.confident) {
    known.forEach((a, i) => {
      const prev = plants[a.plantId];
      const noteId = `note-${now}-${i}`;
      plants[a.plantId] = {
        ...prev,
        notes: [...(prev.notes || []), {
          id: noteId, date: entry.date, text: a.text, createdAt: now, entryId: entry.id, ai: true,
          ...(a.quote ? { quote: a.quote } : {}),
        }],
        ...(a.watered ? { lastWatered: entry.date } : {}),
        updatedAt: now,
      };
      assigned.push({ plantId: a.plantId, noteId, ...(a.mention ? { mention: a.mention } : {}) });
    });
  }

  const photoTags = (result.photos || [])
    .filter((p) => p && plants[p.plantId] && photoIds[p.index])
    .map((p) => ({ photoId: photoIds[p.index], plantId: p.plantId }));

  return {
    status: { ...statusDoc, updatedAt: now, plants },
    entries: assignEntry(entriesDoc, entry.id, {
      assigned,
      suggestions: assigned.length ? [] : known.map((a) => a.plantId),
    }, now),
    photoTags,
  };
}

const MODEL = 'gemini-flash-latest';

async function photoPart(env, id) {
  const obj = await env.PHOTOS.getWithMetadata('photo:' + id, { type: 'arrayBuffer' });
  if (!obj || !obj.value) return null;
  return { inline_data: { mime_type: (obj.metadata && obj.metadata.ct) || 'image/jpeg', data: bytesToBase64(obj.value) } };
}

async function tagPhoto(env, photoId, plantId) {
  const cur = await env.PHOTOS.getWithMetadata('photo:' + photoId, { type: 'arrayBuffer' });
  if (!cur || !cur.value) return;
  await env.PHOTOS.put('photo:' + photoId, cur.value, { metadata: { ...(cur.metadata || {}), plant: plantId } });
}

/* Runs in ctx.waitUntil after the entry is already saved, so it must never throw.
   photosOnly: the gardener already tagged the plants, so only the photos are
   sorted; the notes, the entry and the replan are left to the caller. */
export async function distill(env, entryId, roster, { photosOnly = false } = {}) {
  try {
    const entriesDoc = await readEntries(env);
    const entry = entriesDoc.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const status = await readStatus(env);
    if (!Object.keys(status.plants).length) return;

    // Only photos the gardener left untagged are put to the model; a hand-set tag wins.
    const untagged = [];
    for (const pid of entry.photoIds || []) {
      const meta = (await env.PHOTOS.getWithMetadata('photo:' + pid, { type: 'stream' }))?.metadata;
      if (meta && meta.plant) continue;
      const part = await photoPart(env, pid);
      if (part) untagged.push({ id: pid, part });
    }

    if (photosOnly && !untagged.length) return;
    const body = buildDistillBody(entry, roster, untagged);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    let res;
    try {
      res = await fetch(url, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(body) });
    } catch { return void (photosOnly || await markFailed(env, entryId, 'network')); }
    if (!res.ok) return void (photosOnly || await markFailed(env, entryId, 'model ' + res.status));

    let result;
    try { result = parseDistillResponse(await res.json()); }
    catch (e) { return void (photosOnly || await markFailed(env, entryId, e.message)); }

    const merged = mergeDistill(status, entriesDoc, entry, result, Date.now(), untagged.map((p) => p.id));
    if (photosOnly) {
      const pool = new Set(roster.map((p) => p.id));
      for (const t of merged.photoTags) if (pool.has(t.plantId)) await tagPhoto(env, t.photoId, t.plantId);
      return;
    }
    await writeStatus(env, merged.status);
    await writeEntries(env, merged.entries);
    for (const t of merged.photoTags) await tagPhoto(env, t.photoId, t.plantId);
    await replan(env, { trigger: 'entry' });
  } catch { /* the entry is saved and stays unsorted; nothing else to do */ }
}

async function markFailed(env, entryId, error) {
  try {
    const doc = await readEntries(env);
    await writeEntries(env, assignEntry(doc, entryId, { assigned: [], error }, Date.now()));
  } catch { /* give up quietly */ }
}
