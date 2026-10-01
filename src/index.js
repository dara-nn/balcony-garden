// Balcony garden — Worker: serves the static site + a small shared-photo API backed by KV.
// Viewing photos is public; adding / editing / deleting requires the UPLOAD_PASS secret.

import { readStatus, writeStatus, KEYS, upsertPlant, applyNoteOp, readCare, dropDerivedNotes } from './garden.js';
import { readEntries, writeEntries, addEntry, assignEntry, editEntry, deleteEntry, taggedPlantIds, handNoteText } from './entries.js';
import { readSeed } from './seed.js';
import { replan } from './planner.js';
import { distill } from './distill.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB safety cap (photos are shrunk to ~1000px client-side)

// Writes (add / re-tag / delete / set cover) require the UPLOAD_PASS secret as a bearer token.
const isAuthed = (req, env) => {
  const h = req.headers.get('authorization') || '';
  return !!env.UPLOAD_PASS && h === 'Bearer ' + env.UPLOAD_PASS;
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // The 3D balcony lives at /3d and is served from public/scene.html.
    // Ask ASSETS for '/scene', not '/scene.html': the assets binding rewrites
    // .html paths to their extensionless form and would answer with a 307.
    if (url.pathname === '/3d' || url.pathname === '/3d/') {
      return env.ASSETS.fetch(new Request(new URL('/scene', url), req));
    }
    if (url.pathname === '/api/cover') {
      if (req.method === 'GET') {
        const id = await env.PHOTOS.get('meta:cover');
        return json({ id: id || '' });
      }
      if (req.method === 'PUT') {
        if (!isAuthed(req, env)) return new Response('Unauthorized', { status: 401 });
        const id = url.searchParams.get('id') || '';
        if (id) await env.PHOTOS.put('meta:cover', id);
        else await env.PHOTOS.delete('meta:cover'); // '' = green default
        return json({ id });
      }
      return new Response('Method not allowed', { status: 405 });
    }
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
      const doc = upsertPlant(await readStatus(env), plantId, fields, Date.now());
      await writeStatus(env, doc);
      if (url.searchParams.get('seed') !== '1') ctx.waitUntil(replan(env, { trigger: 'note' }));
      return new Response(JSON.stringify(doc.plants[plantId]), { headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/api/entries' || url.pathname.startsWith('/api/entries/')) {
      return handleEntries(req, env, ctx, url);
    }
    if (url.pathname === '/api/notes' && req.method === 'POST') {
      if (!isAuthed(req, env)) return new Response('Unauthorized', { status: 401 });
      let body;
      try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
      let doc;
      try { doc = applyNoteOp(await readStatus(env), body, Date.now()); }
      catch (e) { return new Response(e.message, { status: 400 }); }
      await writeStatus(env, doc);
      ctx.waitUntil(replan(env, { trigger: 'note' }));
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
    ctx.waitUntil(replan(env, { trigger: 'cron' }));
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

// Freestyle entries: saved raw and answered immediately, then sorted onto plants
// by the distiller in the background. Reads are public, writes need the passphrase.
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
    if (!body.date) return new Response('Missing date', { status: 400 });
    if (!body.text && !(body.photoIds || []).length) return new Response('Empty entry', { status: 400 });
    const doc = addEntry(await readEntries(env), body, Date.now());
    await writeEntries(env, doc);
    const entry = doc.entries[doc.entries.length - 1];
    // A tagged entry already knows its plants, so its words skip the model. With
    // several tags the photos still need sorting, but only among those plants.
    const tagged = taggedPlantIds(body);
    if (tagged.length) ctx.waitUntil((async () => {
      await assignByHand(env, entry, tagged, Array.isArray(body.mentions) ? body.mentions : []);
      if (tagged.length > 1 && entry.photoIds.length) {
        const pool = (await roster(env)).filter((p) => tagged.includes(p.id));
        await distill(env, entry.id, pool, { photosOnly: true });
      }
      await replan(env, { trigger: 'entry' });
    })());
    else ctx.waitUntil(distill(env, entry.id, await roster(env)));
    return json(entry, 201);
  }

  if (req.method === 'PATCH' && id) {
    let body;
    try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    const doc = await readEntries(env);
    const entry = doc.entries.find((e) => e.id === id);
    if (!entry) return new Response('Not found', { status: 404 });
    if (Array.isArray(body.plantIds) && body.text === undefined) {   // the gardener picked the plants themselves
      await unlinkNotes(env, entry);
      await assignByHand(env, entry, body.plantIds);
      ctx.waitUntil(replan(env, { trigger: 'entry' }));
      return json((await readEntries(env)).entries.find((e) => e.id === id));
    }
    await unlinkNotes(env, entry);
    const next = editEntry(doc, id, body, Date.now());
    await writeEntries(env, next);
    const tagged = taggedPlantIds({ mentions: body.mentions });
    if (tagged.length) {                       // reworded with @names: those plants, no guessing
      await assignByHand(env, next.entries.find((e) => e.id === id), tagged, body.mentions);
      ctx.waitUntil(replan(env, { trigger: 'entry' }));
      return json((await readEntries(env)).entries.find((e) => e.id === id));
    }
    ctx.waitUntil(distill(env, id, await roster(env)));
    return json(next.entries.find((e) => e.id === id));
  }

  if (req.method === 'DELETE' && id) {
    const doc = await readEntries(env);
    const entry = doc.entries.find((e) => e.id === id);
    if (!entry) return new Response('Not found', { status: 404 });
    await unlinkNotes(env, entry);
    await writeEntries(env, deleteEntry(doc, id, Date.now()));
    ctx.waitUntil(replan(env, { trigger: 'entry' }));
    return new Response(null, { status: 204 });
  }
  return new Response('Method not allowed', { status: 405 });
}

// The model needs to know what it is choosing between, place included.
// Identity and place come from the inventory file; condition comes from the store.
async function roster(env) {
  const status = await readStatus(env);
  const seed = await readSeed(env);
  const area = Object.fromEntries((seed?.plants || []).map((p) => [p.id, p.area || 'balcony']));
  return Object.values(status.plants).map((p) => ({
    id: p.id, name: p.name, species: p.species, area: area[p.id] || 'balcony', stage: p.stage,
  }));
}

// Drop the notes an entry previously produced, so re-sorting cannot leave duplicates behind.
async function unlinkNotes(env, entry) {
  if (!(entry.assigned || []).length) return;
  const status = await readStatus(env);
  await writeStatus(env, dropDerivedNotes(status, entry.assigned, Date.now()));
}

// Assignment without the model: the entry's own words go straight onto the chosen plants.
// Writes only — the caller schedules the replan, which must never block the response.
// mentions ({plantId, mention}) are the @names as typed, kept so the journal can tag them.
async function assignByHand(env, entry, plantIds, mentions = []) {
  const now = Date.now();
  const said = Object.fromEntries(mentions.filter((m) => m && typeof m.mention === 'string'
    && entry.text.includes(m.mention)).map((m) => [m.plantId, m.mention]));
  const text = handNoteText(entry.text, Object.values(said).map((mention) => ({ mention })));
  const status = await readStatus(env);
  const plants = { ...status.plants };
  const assigned = [];
  plantIds.filter((pid) => plants[pid]).forEach((pid, i) => {
    const tag = said[pid] ? { mention: said[pid] } : {};
    if (!entry.text) { assigned.push({ plantId: pid, noteId: null, ...tag }); return; }   // photo-only entry
    const noteId = `note-${now}-${i}`;
    plants[pid] = { ...plants[pid], updatedAt: now,
      notes: [...(plants[pid].notes || []), { id: noteId, date: entry.date, text, createdAt: now, entryId: entry.id }] };
    assigned.push({ plantId: pid, noteId, ...tag });
  });
  await writeStatus(env, { ...status, updatedAt: now, plants });
  await writeEntries(env, assignEntry(await readEntries(env), entry.id, { assigned }, now));
}

// Shared garden state (task list) so the user's devices stay in sync.
// One KV doc; reads public, writes need the passphrase. Whole-blob last-write-wins by updatedAt.
