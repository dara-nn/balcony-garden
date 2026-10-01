/* Turn one freestyle entry into per-plant observations.
   The user writes whatever they noticed; the model works out which plants it
   concerns and writes a short line for each. The raw text is never rewritten. */

import { readStatus, writeStatus } from './garden.js';
import { readEntries, writeEntries, assignEntry } from './entries.js';
import { bytesToBase64 } from './planner.js';

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

/* photoIds is the list handed to the model, in the order it was shown them.
   allowed: the plant ids the model was offered; anything else it names is ignored. */
export function mergeDistill(statusDoc, entriesDoc, entry, result, now, photoIds = [], allowed = null) {
  const plants = { ...statusDoc.plants };
  const ok = (id) => !!plants[id] && (!allowed || allowed.has(id));
  const assigned = [];
  const known = (result.assignments || []).filter((a) => a && ok(a.plantId));

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
        // An older note saying "watered" must not pull the last watering back.
        ...(a.watered && entry.date > (prev.lastWatered || '') ? { lastWatered: entry.date } : {}),
        updatedAt: now,
      };
      assigned.push({ plantId: a.plantId, noteId, ...(a.mention ? { mention: a.mention } : {}) });
    });
  }

  const photoTags = (result.photos || [])
    .filter((p) => p && ok(p.plantId) && photoIds[p.index])
    .map((p) => ({ photoId: photoIds[p.index], plantId: p.plantId }));

  // A photo-only entry has no words to file, so the plants its photos show are where it went.
  if (!(entry.text || '').trim() && !assigned.length) {
    for (const pid of new Set(photoTags.map((t) => t.plantId))) assigned.push({ plantId: pid, noteId: null });
  }

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
const TIMEOUT_MS = 20000;   // the page waits on this one; past this it says the AI could not be reached

async function photoPart(env, id) {
  const obj = await env.PHOTOS.getWithMetadata('photo:' + id, { type: 'arrayBuffer' });
  if (!obj || !obj.value) return null;
  return { inline_data: { mime_type: (obj.metadata && obj.metadata.ct) || 'image/jpeg', data: bytesToBase64(obj.value) } };
}

export async function tagPhoto(env, photoId, plantId) {
  const cur = await env.PHOTOS.getWithMetadata('photo:' + photoId, { type: 'arrayBuffer' });
  if (!cur || !cur.value) return;
  await env.PHOTOS.put('photo:' + photoId, cur.value, { metadata: { ...(cur.metadata || {}), plant: plantId } });
}

/* The same version of the entry the model was shown: an edit or a retry while the
   model was thinking makes this answer stale, and the newer run decides instead. */
const sameVersion = (a, b) => !!a && !!b && a.text === b.text && a.date === b.date && a.editedAt === b.editedAt;

/* Runs in ctx.waitUntil after the entry is already saved, so it must never throw.
   roster is the plants the model may choose from (inventory plants only).

   The model call is slow, so nothing read before it is written back after it:
   the result is merged into fresh copies of the entries and the status, read
   just before writing, and dropped if the entry has gone, changed, or been
   filed some other way meanwhile. A failure always ends the entry as unsorted
   with an error code, never pending for good.

   Returns true when the entry landed on a plant, so the caller knows a care
   run is worth scheduling. It never runs one itself.

   photosOnly: the gardener already tagged the plants, so only the photos are
   sorted; the notes and the entry are left alone. */
export async function distill(env, entryId, roster, { photosOnly = false } = {}) {
  let shown = null;
  const fail = async (code) => { if (!photosOnly) await markFailed(env, entryId, code, shown); return false; };
  try {
    shown = (await readEntries(env)).entries.find((e) => e.id === entryId);
    if (!shown) return false;
    if (!photosOnly && shown.status !== 'pending') return false;
    if (!(roster || []).length) return fail('empty');

    // Only photos the gardener left untagged are put to the model; a hand-set tag wins.
    const untagged = [];
    for (const pid of shown.photoIds || []) {
      const meta = (await env.PHOTOS.getWithMetadata('photo:' + pid, { type: 'stream' }))?.metadata;
      if (meta && meta.plant) continue;
      const part = await photoPart(env, pid);
      if (part) untagged.push({ id: pid, part });
    }

    if (photosOnly && !untagged.length) return false;
    const body = buildDistillBody(shown, roster, untagged);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    let res;
    try {
      res = await fetch(url, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch { return fail('ai'); }
    if (!res.ok) return fail('ai');

    let result;
    try { result = parseDistillResponse(await res.json()); } catch { return fail('ai'); }

    const entriesDoc = await readEntries(env);
    const entry = entriesDoc.entries.find((e) => e.id === entryId);
    if (!sameVersion(entry, shown) || (!photosOnly && entry.status !== 'pending')) return false;
    const status = await readStatus(env);
    const allowed = new Set(roster.map((p) => p.id));
    const merged = mergeDistill(status, entriesDoc, entry, result, Date.now(), untagged.map((p) => p.id), allowed);
    if (photosOnly) {
      for (const t of merged.photoTags) await tagPhoto(env, t.photoId, t.plantId);
      return merged.photoTags.length > 0;
    }
    const filed = merged.entries.entries.find((e) => e.id === entryId);
    if (filed.assigned.some((a) => a.noteId)) await writeStatus(env, merged.status);
    await writeEntries(env, merged.entries);
    for (const t of merged.photoTags) await tagPhoto(env, t.photoId, t.plantId);
    return filed.status === 'sorted';
  } catch {
    return fail('internal');
  }
}

/* Ends a pending entry as unsorted with a short error code, unless something
   newer has already dealt with it. */
export async function markFailed(env, entryId, error, shown = null) {
  try {
    const doc = await readEntries(env);
    const entry = doc.entries.find((e) => e.id === entryId);
    if (!entry || entry.status !== 'pending' || (shown && !sameVersion(entry, shown))) return;
    await writeEntries(env, assignEntry(doc, entryId, { assigned: [], error }, Date.now()));
  } catch { /* give up quietly */ }
}
