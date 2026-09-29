export const KEYS = {
  status: 'status:garden',
  plan: 'plan:garden',
  progress: 'progress:garden',
};

export async function readStatus(env) {
  const raw = await env.PHOTOS.get(KEYS.status);
  return raw ? JSON.parse(raw) : { updatedAt: 0, plants: {} };
}
export async function writeStatus(env, doc) {
  await env.PHOTOS.put(KEYS.status, JSON.stringify(doc));
}
export async function readPlan(env) {
  const raw = await env.PHOTOS.get(KEYS.plan);
  return raw ? JSON.parse(raw) : null;
}
export async function writePlan(env, doc) {
  await env.PHOTOS.put(KEYS.plan, JSON.stringify(doc));
}

/* The bar wants to know when a plant actually changed, not when the seed file
   was last edited. Every write that moves the stage leaves a dated mark here. */
export function recordStage(prev, stage, date) {
  const history = (prev && prev.history) || [];
  if (!stage || (prev && prev.stage === stage)) return history;
  return [...history, { date, stage }];
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
