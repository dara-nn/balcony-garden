/* Coalescing care runs. Every write path asks for a run; a burst of edits
   (file a note, fix a typo, delete another) should cost one model call, not
   three racing each other.

   How: each request records its own "wanted at" token under one KV key, waits
   a moment, then looks again. If its token is still the newest, it runs;
   if a newer request has recorded one since, that newer request will run
   (and, starting later, it sees this request's data too), so this one stops.

   KV allows one write per key per second, so recording can fail in a burst.
   Then this request did not get its token in, but someone else wrote one less
   than a second ago: if that token is younger than our own start minus the
   wait, its run starts after our data was written and covers us. Otherwise
   (nothing recent, or KV failing for some other reason) we run ourselves;
   an extra run costs a model call, a missing one leaves guidance stale.

   KV reads in the same place as the write see it at once; this garden has one
   writer, so that is where they all are. */

import { replan } from './planner.js';

export const WANT_KEY = 'replan:want';
export const timing = { wait: 3000 };   // tests set this to 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function scheduleReplan(env, { run = replan, wait = timing.wait } = {}) {
  const at = Date.now();
  const mine = `${at}:${Math.random().toString(36).slice(2)}`;
  let recorded = true;
  try { await env.PHOTOS.put(WANT_KEY, mine); } catch { recorded = false; }
  await sleep(wait);
  let latest = null;
  try { latest = await env.PHOTOS.get(WANT_KEY); } catch { /* treat as nothing recorded */ }
  if (recorded) {
    if (latest && latest !== mine) return false;          // a newer request runs instead
  } else {
    const theirs = Number(String(latest || '').split(':')[0]) || 0;
    if (theirs > at - wait) return false;                // a pending run starts after our write
  }
  await run(env);
  return true;
}
