// Balcony garden — Worker: serves the static site + a small shared-photo API backed by KV.
// Viewing photos is public; adding / editing / deleting requires the UPLOAD_PASS secret.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB safety cap (photos are shrunk to ~1000px client-side)

// Writes (add / re-tag / delete / set cover) require the UPLOAD_PASS secret as a bearer token.
const isAuthed = (req, env) => {
  const h = req.headers.get('authorization') || '';
  return !!env.UPLOAD_PASS && h === 'Bearer ' + env.UPLOAD_PASS;
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
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
    if (url.pathname === '/api/state') {
      return handleState(req, env);
    }
    return env.ASSETS.fetch(req); // everything else = the static site
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

// Shared garden state (task list) so the user's devices stay in sync.
// One KV doc; reads public, writes need the passphrase. Whole-blob last-write-wins by updatedAt.
async function handleState(req, env) {
  if (req.method === 'GET') {
    const doc = await env.PHOTOS.get('state:garden');
    return new Response(doc || '{}', { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  if (req.method === 'PUT') {
    if (!isAuthed(req, env)) return new Response('Unauthorized', { status: 401 });
    const body = await req.text();
    if (!body) return new Response('Empty body', { status: 400 });
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
    await env.PHOTOS.put('state:garden', JSON.stringify(parsed));
    return json(parsed);
  }
  return new Response('Method not allowed', { status: 405 });
}
