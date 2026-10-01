/* Raw freestyle entries, exactly as they were typed.
   The distiller turns each one into per-plant notes; this store never rewrites the text.

   What the page can rely on, per entry:
     status    'pending' while it waits to be matched, then 'sorted' (on at least one
               plant) or 'unsorted' (on none). Nothing leaves an entry pending for good:
               every failure ends as 'unsorted' with an error.
     error     a short code when matching failed: 'ai' (the model could not be reached
               or replied badly; a retry is a PATCH with the same text), 'empty' (no
               plants to match against), 'internal' (anything else).
     byHand    true when the gardener picked the plants; a later reword with no @names
               keeps those plants instead of asking the model again.
     editedAt  when the text or date last changed; a match worked out for an older
               version is thrown away.
     filedAt   when the entry was last matched, or failed to be. */

import { dropDerivedNotes } from './garden.js';

export const ENTRY_KEY = 'entries:garden';

export async function readEntries(env) {
  const raw = await env.PHOTOS.get(ENTRY_KEY);
  return raw ? JSON.parse(raw) : { updatedAt: 0, entries: [] };
}
export async function writeEntries(env, doc) {
  await env.PHOTOS.put(ENTRY_KEY, JSON.stringify(doc));
}

const replace = (doc, id, fn, now) => {
  const i = doc.entries.findIndex((e) => e.id === id);
  if (i < 0) throw new Error('unknown entry');
  const entries = doc.entries.slice();
  entries[i] = fn(entries[i]);
  return { ...doc, updatedAt: now, entries };
};

export function addEntry(doc, { id, date, text, photoIds }, now) {
  const entry = {
    id: id || `entry-${now}-${Math.round(now % 1e6)}`,
    date, text: text || '', photoIds: photoIds || [],
    createdAt: now, status: 'pending', assigned: [],
  };
  return { ...doc, updatedAt: now, entries: [...doc.entries, entry] };
}

/* One result from the distiller, or from the user picking plants by hand. */
export function assignEntry(doc, id, { assigned, suggestions, error, byHand }, now) {
  return replace(doc, id, (e) => {
    const list = assigned || [];
    return {
      ...e,
      assigned: list,
      suggestions: suggestions || [],
      status: list.length ? 'sorted' : 'unsorted',
      error: error || undefined,
      byHand: byHand ? true : undefined,
      filedAt: now,
    };
  }, now);
}

/* assigned: the links that survive the edit (see unlinkEntry), so the entry never
   points at a note that is gone. */
export function editEntry(doc, id, { text, date, assigned }, now) {
  return replace(doc, id, (e) => ({
    ...e,
    ...(text !== undefined ? { text } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(assigned !== undefined ? { assigned } : {}),
    status: 'pending',   // the text changed, so the old assignments no longer describe it
    error: undefined,
    editedAt: now,
  }), now);
}

export function deleteEntry(doc, id, now) {
  if (!doc.entries.some((e) => e.id === id)) throw new Error('unknown entry');
  return { ...doc, updatedAt: now, entries: doc.entries.filter((e) => e.id !== id) };
}

/* The plants the gardener tagged: @-mentions in the text, plus the plant page's
   own plant. `plantId` and `plantIds` are the older forms, still read. */
export function taggedPlantIds(body) {
  const list = Array.isArray(body?.plantIds) ? body.plantIds : [];
  const named = Array.isArray(body?.mentions) ? body.mentions.map((m) => m?.plantId) : [];
  return [...new Set([...list, body?.plantId, ...named].filter((x) => typeof x === 'string' && x))];
}

/* The words as written, with the @ taken off each name so they read as plain text. */
export function handNoteText(text, mentions) {
  let out = text || '';
  for (const m of mentions || []) if (m?.mention) out = out.split(m.mention).join(m.mention.replace(/^@/, ''));
  return out;
}

/* The note one plant gets from an @-tagged entry. Its own @name is taken out
   only when the text starts with it (the note is already filed under it);
   anywhere else every @name, its own included, becomes the plain name, so the
   sentence still reads. Longer names go first, so "@Basil 1" is never
   half-eaten by "@Basil". A note that was nothing but the name keeps the name
   rather than going blank. */
export function plantNoteText(text, mentions, plantId) {
  const list = (mentions || []).filter((m) => m && typeof m.mention === 'string' && m.mention)
    .sort((a, b) => b.mention.length - a.mention.length);
  let out = text || '';
  const body = out.replace(/^[\s,]*/, '');
  const lead = list.find((m) => body.startsWith(m.mention));
  if (lead && lead.plantId === plantId) out = body.slice(lead.mention.length);
  for (const m of list) out = out.split(m.mention).join(m.mention.replace(/^@/, ''));
  const tidy = (s) => s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,.;:!?]+/, '').trim();
  return tidy(out) || tidy(handNoteText(text, list));
}

/* Deleting one plant's note from the plant page takes that plant off the
   entry the note came from. An entry left on no plant goes too when it has no
   photos; one with photos stays, as 'unsorted', so the photos are not lost.
   In memory, so the caller writes the entries once. */
export function unlinkNote(doc, entryId, plantId, now) {
  const entry = doc.entries.find((e) => e.id === entryId);
  if (!entry) return { entries: doc, changed: false };
  const assigned = (entry.assigned || []).filter((a) => a.plantId !== plantId);
  if (assigned.length === (entry.assigned || []).length) return { entries: doc, changed: false };
  if (!assigned.length && !(entry.photoIds || []).length) return { entries: deleteEntry(doc, entryId, now), changed: true };
  return { entries: replace(doc, entryId, (e) => ({ ...e, assigned,
    ...(assigned.length ? {} : { status: 'unsorted' }) }), now), changed: true };
}

/* Re-filing an entry first takes back the notes it produced. kept is the links
   whose note is still there (one the gardener reworded is theirs and stays). */
export function unlinkEntry(statusDoc, entry, now) {
  const assigned = entry.assigned || [];
  if (!assigned.length) return { status: statusDoc, kept: [], changed: false };
  const status = dropDerivedNotes(statusDoc, assigned, now);
  const kept = assigned.filter((a) => a.noteId
    && (status.plants[a.plantId]?.notes || []).some((n) => n.id === a.noteId));
  return { status, kept, changed: true };
}

/* Filing without the model: the entry's own words go straight onto the chosen
   plants, all in memory, so the caller writes each document once. mentions
   ({plantId, mention}) are the @names as typed, kept so the journal can tag them.
   A photo-only entry is placed with no note (noteId null). */
export function fileByHand(statusDoc, entriesDoc, entryId, plantIds, mentions, now, { byHand = false } = {}) {
  const entry = entriesDoc.entries.find((e) => e.id === entryId);
  if (!entry) throw new Error('unknown entry');
  const text = entry.text || '';
  const said = (mentions || []).filter((m) => m && typeof m.mention === 'string' && m.mention && text.includes(m.mention));
  const tagOf = Object.fromEntries(said.map((m) => [m.plantId, m.mention]));
  const plants = { ...statusDoc.plants };
  const assigned = [];
  [...new Set(plantIds || [])].filter((pid) => plants[pid]).forEach((pid, i) => {
    const tag = tagOf[pid] ? { mention: tagOf[pid] } : {};
    if (!text.trim()) { assigned.push({ plantId: pid, noteId: null, ...tag }); return; }
    const noteId = `note-${now}-${i}`;
    plants[pid] = { ...plants[pid], updatedAt: now,
      notes: [...(plants[pid].notes || []),
        { id: noteId, date: entry.date, text: plantNoteText(text, said, pid), createdAt: now, entryId }] };
    assigned.push({ plantId: pid, noteId, ...tag });
  });
  const wrote = assigned.some((a) => a.noteId);
  return {
    status: wrote ? { ...statusDoc, updatedAt: now, plants } : statusDoc,
    entries: assignEntry(entriesDoc, entryId, { assigned, byHand: byHand && assigned.length > 0 }, now),
    changed: wrote,
  };
}
