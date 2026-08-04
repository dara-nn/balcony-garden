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
