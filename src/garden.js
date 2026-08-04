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

export function upsertPlant(doc, plantId, fields, now) {
  const prev = doc.plants[plantId] || { id: plantId, notes: [], history: [] };
  const plant = { notes: [], history: [], ...prev, ...fields, id: plantId, updatedAt: now };
  return { ...doc, updatedAt: now, plants: { ...doc.plants, [plantId]: plant } };
}

export function applyNoteOp(doc, { plantId, op, id, date, text }, now) {
  const plant = doc.plants[plantId];
  if (!plant) throw new Error('unknown plant');
  let notes = plant.notes || [];
  if (op === 'add') {
    notes = [...notes, { id: id || `note-${now}`, date, text, createdAt: now }];
  } else if (op === 'edit') {
    notes = notes.map((n) => (n.id === id ? { ...n, text, ...(date ? { date } : {}) } : n));
  } else if (op === 'delete') {
    notes = notes.filter((n) => n.id !== id);
  } else {
    throw new Error('unknown op');
  }
  const updated = { ...plant, notes, updatedAt: now };
  return { ...doc, updatedAt: now, plants: { ...doc.plants, [plantId]: updated } };
}
