export const KEYS = {
  status: 'status:garden',
  care: 'care:garden',
};

/* care:garden used to be plan:garden, a dated task list. The old key is read
   once so an existing garden is not blank on the first load after the change. */
const OLD_PLAN_KEY = 'plan:garden';

export async function readStatus(env) {
  const raw = await env.PHOTOS.get(KEYS.status);
  return raw ? JSON.parse(raw) : { updatedAt: 0, plants: {} };
}
export async function writeStatus(env, doc) {
  await env.PHOTOS.put(KEYS.status, JSON.stringify(doc));
}
export async function readCare(env) {
  const raw = (await env.PHOTOS.get(KEYS.care)) || (await env.PHOTOS.get(OLD_PLAN_KEY));
  return raw ? JSON.parse(raw) : null;
}
export async function writeCare(env, doc) {
  await env.PHOTOS.put(KEYS.care, JSON.stringify(doc));
}

/* The bar wants to know when a plant actually changed, not when the seed file
   was last edited. Every write that MOVES the stage leaves a dated mark here.

   Introducing a plant is not a move: the first stage it is given is simply what
   it already was when it was added, and dating that as a transition is the very
   artefact this history replaces. Such a plant keeps the species defaults until
   it actually changes. */
export function recordStage(prev, stage, date) {
  const history = (prev && prev.history) || [];
  const had = prev && prev.stage;
  if (!stage || !had || had === stage) return history;
  return [...history, { date, stage }];
}

/* A real calendar day written YYYY-MM-DD: no 31 February, no month 13.
   The date must survive a round trip through Date unchanged. */
export function isRealDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/* The stage changes the model read out of the gardener's notes, each dated
   from a note and carrying the id of that note (noteId) when it has one. They
   are worked out afresh on every run and replace the last list, so deleting
   or rewording a note corrects them, and a plant that goes back to a stage
   (growing again after dormancy) keeps both. Only known stage words and real
   dates up to today; exact repeats once; in date order. */
export function cleanNoteStages(past, today, stages) {
  const seen = new Set();
  return (past || [])
    .filter((p) => p && stages.includes(p.stage) && isRealDate(p.date) && p.date <= today)
    .map((p) => ({ date: p.date, stage: p.stage, ...(typeof p.noteId === 'string' && p.noteId ? { noteId: p.noteId } : {}) }))
    .filter((p) => !seen.has(p.date + p.stage) && seen.add(p.date + p.stage))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function upsertPlant(doc, plantId, fields, now) {
  const prev = doc.plants[plantId] || { id: plantId, notes: [], history: [] };
  const history = recordStage(prev, fields.stage, new Date(now).toISOString().slice(0, 10));
  const plant = { notes: [], ...prev, ...fields, history, id: plantId, updatedAt: now };
  return { ...doc, updatedAt: now, plants: { ...doc.plants, [plantId]: plant } };
}

/* Re-sorting an entry rewrites the notes it produced. A note the gardener has
   reworded is no longer the model's to overwrite, so it survives. */
export function dropDerivedNotes(doc, assigned, now) {
  const plants = { ...doc.plants };
  for (const { plantId, noteId } of assigned || []) {
    const p = plants[plantId];
    if (!p) continue;
    plants[plantId] = { ...p, notes: (p.notes || []).filter((n) => n.id !== noteId || n.ai === false) };
  }
  return { ...doc, updatedAt: now, plants };
}

export function applyNoteOp(doc, { plantId, op, id, date, text }, now) {
  const plant = doc.plants[plantId];
  if (!plant) throw new Error('unknown plant');
  let notes = plant.notes || [];
  if (op === 'add') {
    notes = [...notes, { id: id || `note-${now}`, date, text, createdAt: now }];
  } else if (op === 'edit') {
    // once the gardener rewords it, it is no longer the model's sentence
    notes = notes.map((n) => (n.id === id ? { ...n, text, ai: false, ...(date ? { date } : {}) } : n));
  } else if (op === 'delete') {
    notes = notes.filter((n) => n.id !== id);
  } else {
    throw new Error('unknown op');
  }
  const updated = { ...plant, notes, updatedAt: now };
  return { ...doc, updatedAt: now, plants: { ...doc.plants, [plantId]: updated } };
}
