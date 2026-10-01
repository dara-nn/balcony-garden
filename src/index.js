// Balcony garden — Worker: serves the static site + a small shared-photo API backed by KV.
// Viewing photos is public; adding / editing / deleting requires the UPLOAD_PASS secret.

import { readStatus, writeStatus, upsertPlant, applyNoteOp, readCare, isRealDate } from './garden.js';
import { readEntries, writeEntries, addEntry, editEntry, deleteEntry, taggedPlantIds,
  fileByHand, unlinkEntry, unlinkNote } from './entries.js';
import { readSeed } from './seed.js';
import { replan, inventoryOf, STAGES } from './planner.js';
import { distill, markFailed, tagPhoto } from './distill.js';
import { scheduleReplan } from './schedule.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB safety cap (photos are shrunk to ~1000px client-side)

// Writes (add / re-tag / delete) require the UPLOAD_PASS secret as a bearer token.
const isAuthed = (req, env) => {
  const h = req.headers.get('authorization') || '';
  return !!env.UPLOAD_PASS && h === 'Bearer ' + env.UPLOAD_PASS;
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/api/photos' || url.pathname.startsWith('/api/photos/')) {
      return handlePhotos(req, env, url);
    }
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const doc = await readStatus(env);
      return new Response(JSON.stringify(doc), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    if (url.pathname === '/api/care' && req.method === 'GET') {
      const doc = await readCare(env);
      return new Response(JSON.stringify(doc || {}), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    if (url.pathname.startsWith('/api/status/') && req.method === 'PUT') {
      if (!isAuthed(req, env)) return new Response('Unauthorized', { status: 401 });
      const plantId = decodeURIComponent(url.pathname.slice('/api/status/'.length));
      if (!plantId) return new Response('Missing plant id', { status: 400 });
      let fields;
      try { fields = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
      const seeding = url.searchParams.get('seed') === '1';
      const bad = statusFieldsError(fields, seeding);
      if (bad) return new Response(bad, { status: 400 });
      const current = await readStatus(env);
      if (!seeding && !current.plants[plantId]) return new Response('Not found', { status: 404 });
      const doc = upsertPlant(current, plantId, fields, Date.now());
      await writeStatus(env, doc);
      if (!seeding) ctx.waitUntil(scheduleReplan(env));
      return new Response(JSON.stringify(doc.plants[plantId]), { headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/api/entries' || url.pathname.startsWith('/api/entries/')) {
      return handleEntries(req, env, ctx, url);
    }
    if (url.pathname === '/api/notes' && req.method === 'POST') {
      if (!isAuthed(req, env)) return new Response('Unauthorized', { status: 401 });
      let body;
      try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
      const now = Date.now();
      const before = await readStatus(env);
      let doc;
      try { doc = applyNoteOp(before, body, now); }
      catch (e) { return new Response(e.message, { status: 400 }); }
      // A deleted note also comes off its journal entry (see unlinkNote).
      const gone = body.op === 'delete' && (before.plants[body.plantId].notes || []).find((n) => n.id === body.id);
      const unlinked = gone && gone.entryId ? unlinkNote(await readEntries(env), gone.entryId, body.plantId, now) : null;
      await writeStatus(env, doc);
      if (unlinked && unlinked.changed) await writeEntries(env, unlinked.entries);
      ctx.waitUntil(scheduleReplan(env));
      return new Response(JSON.stringify(doc.plants[body.plantId]), { headers: { 'content-type': 'application/json' } });
    }
    // Every plant is its own address. The site is one document, so any '/p/'
    // path is answered with it and the page reads the plant id out of the URL.
    if (url.pathname === '/p' || url.pathname.startsWith('/p/')) {
      return env.ASSETS.fetch(new Request(new URL('/', url), req));
    }
    return env.ASSETS.fetch(req); // everything else = the static site
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(replan(env));   // the nightly run needs no coalescing
  },
};

async function handlePhotos(req, env, url) {
  const method = req.method;
  const id = url.pathname.startsWith('/api/photos/') ? decodeURIComponent(url.pathname.slice('/api/photos/'.length)) : '';
  const authed = () => isAuthed(req, env);

  // list metadata for every photo
  if (method === 'GET' && !id) {
    const out = [];
    let cursor;
    do {
      const page = await env.PHOTOS.list({ prefix: 'photo:', cursor });
      for (const k of page.keys) out.push({ id: k.name.slice('photo:'.length), ...(k.metadata || {}) });
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return json(out);
  }

  // stream one image
  if (method === 'GET' && id) {
    const obj = await env.PHOTOS.getWithMetadata('photo:' + id, { type: 'arrayBuffer' });
    if (!obj || !obj.value) return new Response('Not found', { status: 404 });
    return new Response(obj.value, {
      headers: {
        'content-type': (obj.metadata && obj.metadata.ct) || 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // add a photo (auth)
  if (method === 'POST' && !id) {
    if (!authed()) return new Response('Unauthorized', { status: 401 });
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return new Response('Empty body', { status: 400 });
    if (buf.byteLength > MAX_BYTES) return new Response('Too large', { status: 413 });
    const nid = crypto.randomUUID();
    const meta = {
      date: url.searchParams.get('date') || '',
      plant: url.searchParams.get('plant') || '',
      ct: req.headers.get('content-type') || 'image/jpeg',
      created: Date.now(),
    };
    await env.PHOTOS.put('photo:' + nid, buf, { metadata: meta });
    return json({ id: nid, ...meta }, 201);
  }

  // re-tag a photo to a different plant (auth) — rewrites metadata, keeps the bytes
  if (method === 'PATCH' && id) {
    if (!authed()) return new Response('Unauthorized', { status: 401 });
    const cur = await env.PHOTOS.getWithMetadata('photo:' + id, { type: 'arrayBuffer' });
    if (!cur || !cur.value) return new Response('Not found', { status: 404 });
    const meta = { ...(cur.metadata || {}), plant: url.searchParams.get('plant') || '' };
    await env.PHOTOS.put('photo:' + id, cur.value, { metadata: meta });
    return json({ id, ...meta });
  }

  // delete (auth)
  if (method === 'DELETE' && id) {
    if (!authed()) return new Response('Unauthorized', { status: 401 });
    await env.PHOTOS.delete('photo:' + id);
    return new Response(null, { status: 204 });
  }

  return new Response('Method not allowed', { status: 405 });
}

// A note's date: a real YYYY-MM-DD (no 31 February), not absurdly old, not in the future.
// A day of slack, since the page counts days in Tampere and this Worker in UTC.
export function validNoteDate(d) {
  if (!isRealDate(d) || d < '2000-01-01') return false;
  return d <= new Date(Date.now() + 864e5).toISOString().slice(0, 10);
}

/* What PUT /api/status/:id may set. The page sets lastWatered (the water
   button); stage is a known stage word. Seeding (?seed=1) also sends the
   plant's name and species. Anything else, or a bad value, is refused, and the
   reason is returned; null means the fields are fine. */
export function statusFieldsError(fields, seeding = false) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'Bad fields';
  const allowed = seeding ? ['stage', 'lastWatered', 'name', 'species'] : ['stage', 'lastWatered'];
  for (const k of Object.keys(fields)) if (!allowed.includes(k)) return 'Unknown field: ' + k;
  if ('stage' in fields && !STAGES.includes(fields.stage)) return 'Bad stage';
  if ('lastWatered' in fields && !validNoteDate(fields.lastWatered)) return 'Bad date';
  for (const k of ['name', 'species']) if (k in fields && typeof fields[k] !== 'string') return 'Bad ' + k;
  return null;
}

// photoIds, when sent, is a list of photo ids: never a single string to walk through.
const badPhotoIds = (v) => v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === 'string'));

// Text that is only whitespace counts as no text at all.
const cleanText = (t) => (typeof t === 'string' && t.trim() ? t : '');

// Freestyle entries: saved raw and answered immediately, then sorted onto plants
// by the distiller in the background. Reads are public, writes need the passphrase.
//
// Each request writes each KV document at most once: filing by hand, unlinking
// old notes and the entry change are all worked out in memory first. A care run
// is asked for (scheduleReplan) only when the plants' notes actually changed.
async function handleEntries(req, env, ctx, url) {
  const id = url.pathname.startsWith('/api/entries/')
    ? decodeURIComponent(url.pathname.slice('/api/entries/'.length)) : '';

  if (req.method === 'GET' && !id) {
    const doc = await readEntries(env);
    return new Response(JSON.stringify(doc), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  if (!isAuthed(req, env)) return new Response('Unauthorized', { status: 401 });

  if (req.method === 'POST' && !id) {
    let body;
    try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    if (!validNoteDate(body.date)) return new Response('Bad date', { status: 400 });
    if (badPhotoIds(body.photoIds)) return new Response('Bad photoIds', { status: 400 });
    const text = cleanText(body.text);
    if (!text && !(body.photoIds || []).length) return new Response('Empty entry', { status: 400 });
    const now = Date.now();
    let doc = addEntry(await readEntries(env), { ...body, text }, now);
    const entryId = doc.entries[doc.entries.length - 1].id;
    // A tagged entry already knows its plants, so its words skip the model and it
    // is filed before answering. With several tags the photos still need sorting,
    // but only among those plants.
    const tagged = taggedPlantIds(body);
    if (tagged.length) {
      const filed = fileByHand(await readStatus(env), doc, entryId, tagged,
        Array.isArray(body.mentions) ? body.mentions : [], now);
      if (filed.changed) await writeStatus(env, filed.status);
      await writeEntries(env, doc = filed.entries);
      const entry = doc.entries.find((e) => e.id === entryId);
      ctx.waitUntil((async () => {
        try {
          if (tagged.length > 1 && entry.photoIds.length) {
            const pool = (await roster(env)).filter((p) => tagged.includes(p.id));
            await distill(env, entryId, pool, { photosOnly: true });
          }
          if (entry.status === 'sorted') await scheduleReplan(env);
        } catch { await markFailed(env, entryId, 'internal'); }
      })());
      return json(entry, 201);
    }
    await writeEntries(env, doc);
    ctx.waitUntil(distillThenPlan(env, entryId, false));
    return json(doc.entries.find((e) => e.id === entryId), 201);
  }

  if (req.method === 'PATCH' && id) {
    let body;
    try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    const doc = await readEntries(env);
    const entry = doc.entries.find((e) => e.id === id);
    if (!entry) return new Response('Not found', { status: 404 });
    if (body.date !== undefined && !validNoteDate(body.date)) return new Response('Bad date', { status: 400 });
    if (badPhotoIds(body.photoIds)) return new Response('Bad photoIds', { status: 400 });
    const now = Date.now();
    const unlinked = unlinkEntry(await readStatus(env), entry, now);

    if (Array.isArray(body.plantIds) && body.text === undefined) {   // the gardener picked the plants themselves
      const filed = fileByHand(unlinked.status, doc, id, body.plantIds, [], now, { byHand: true });
      if (unlinked.changed || filed.changed) await writeStatus(env, filed.status);
      await writeEntries(env, filed.entries);
      // One plant picked: the entry's untagged photos are of it too.
      const plantIds = [...new Set(body.plantIds)];
      if (plantIds.length === 1 && filed.status.plants[plantIds[0]]) await tagUntagged(env, entry.photoIds, plantIds[0]);
      ctx.waitUntil(scheduleReplan(env));
      return json(filed.entries.entries.find((e) => e.id === id));
    }

    const text = body.text === undefined ? undefined : cleanText(body.text);
    if (text === '' && !(entry.photoIds || []).length) return new Response('Empty entry', { status: 400 });
    const next = editEntry(doc, id, { text, date: body.date, assigned: unlinked.kept }, now);
    const mentions = Array.isArray(body.mentions) ? body.mentions : [];
    const tagged = taggedPlantIds({ mentions });
    // Reworded with @names: those plants, no guessing. Reworded with none on an
    // entry the gardener filed by hand: the same plants again, with the new words.
    const handPlants = !tagged.length && entry.byHand
      ? [...new Set((entry.assigned || []).map((a) => a.plantId))] : [];
    if (tagged.length || handPlants.length) {
      const filed = tagged.length
        ? fileByHand(unlinked.status, next, id, tagged, mentions, now)
        : fileByHand(unlinked.status, next, id, handPlants, [], now, { byHand: true });
      if (unlinked.changed || filed.changed) await writeStatus(env, filed.status);
      await writeEntries(env, filed.entries);
      ctx.waitUntil(scheduleReplan(env));
      return json(filed.entries.entries.find((e) => e.id === id));
    }
    if (unlinked.changed) await writeStatus(env, unlinked.status);
    await writeEntries(env, next);
    // Old notes were taken off: guidance needs redoing even if the new words land nowhere.
    ctx.waitUntil(distillThenPlan(env, id, unlinked.changed));
    return json(next.entries.find((e) => e.id === id));
  }

  if (req.method === 'DELETE' && id) {
    const doc = await readEntries(env);
    const entry = doc.entries.find((e) => e.id === id);
    if (!entry) return new Response('Not found', { status: 404 });
    const now = Date.now();
    const unlinked = unlinkEntry(await readStatus(env), entry, now);
    if (unlinked.changed) await writeStatus(env, unlinked.status);
    await writeEntries(env, deleteEntry(doc, id, now));
    for (const pid of entry.photoIds || []) await env.PHOTOS.delete('photo:' + pid);
    ctx.waitUntil(scheduleReplan(env));
    return new Response(null, { status: 204 });
  }
  return new Response('Method not allowed', { status: 405 });
}

/* Matching runs first; a care run is asked for only when the entry landed on a
   plant (or old notes were taken off), never for one that failed or found nothing. */
async function distillThenPlan(env, entryId, notesChanged) {
  const placed = await distill(env, entryId, await roster(env));
  if (placed || notesChanged) await scheduleReplan(env);
}

async function tagUntagged(env, photoIds, plantId) {
  for (const pid of photoIds || []) {
    const meta = (await env.PHOTOS.getWithMetadata('photo:' + pid, { type: 'stream' }))?.metadata;
    if (meta && !meta.plant) await tagPhoto(env, pid, plantId);
  }
}

// The model needs to know what it is choosing between, place included. Only
// plants still in the inventory file are offered; one dropped from it is ignored.
// Identity and place come from the inventory file; condition comes from the store.
async function roster(env) {
  const status = await readStatus(env);
  const inventory = inventoryOf(await readSeed(env));
  return Object.values(status.plants).filter((p) => !inventory || inventory.has(p.id)).map((p) => ({
    id: p.id, name: p.name, species: p.species, area: inventory?.get(p.id)?.area || 'balcony', stage: p.stage,
  }));
}
