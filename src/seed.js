/* The plant inventory lives in public/garden-data.js and is edited by hand.
   The Worker reads that same file so the planner and the distiller always know
   where each plant lives, without waiting for a browser to sync it up. */

export function parseSeed(text) {
  const open = (text || '').indexOf('JSON.parse(`');
  if (open < 0) return null;
  const start = open + 'JSON.parse(`'.length;
  const end = text.indexOf('`', start);
  if (end < 0) return null;
  try { return JSON.parse(text.slice(start, end)); } catch { return null; }
}

export async function readSeed(env) {
  try {
    const res = await env.ASSETS.fetch(new Request('https://garden.local/garden-data.js'));
    if (!res || !res.ok) return null;
    return parseSeed(await res.text());
  } catch { return null; }
}
