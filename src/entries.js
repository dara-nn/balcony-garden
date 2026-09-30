/* Raw freestyle entries, exactly as they were typed.
   The distiller turns each one into per-plant notes; this store never rewrites the text. */

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

/* One result from the distiller — or from the user picking plants by hand. */
export function assignEntry(doc, id, { assigned, suggestions, error }, now) {
  return replace(doc, id, (e) => {
    const list = assigned || [];
    return {
      ...e,
      assigned: list,
      suggestions: suggestions || [],
      status: list.length ? 'sorted' : 'unsorted',
      ...(error ? { error } : { error: undefined }),
    };
  }, now);
}

export function editEntry(doc, id, { text, date }, now) {
  return replace(doc, id, (e) => ({
    ...e,
    ...(text !== undefined ? { text } : {}),
    ...(date !== undefined ? { date } : {}),
    status: 'pending',   // the text changed, so the old assignments no longer describe it
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

/* What lands on each plant from an @-tagged note: the words as written, with
   the @ taken off each name so the note reads as plain text on the plant page. */
export function handNoteText(text, mentions) {
  let out = text || '';
  for (const m of mentions || []) if (m?.mention) out = out.split(m.mention).join(m.mention.replace(/^@/, ''));
  return out;
}
