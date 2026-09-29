/* Pure view logic, shared by the page and the tests.
   An ES module so both can load it without a build step. */

const AREAS = [
  { area: 'balcony', label: 'Balcony' },
  { area: 'indoor', label: 'Indoor' },
];

/* Anything that is not explicitly indoor is on the balcony, including a plant
   whose area was never set and one whose area is a word we do not know. */
const areaOf = (p) => (p && p.area === 'indoor' ? 'indoor' : 'balcony');

export function groupByArea(plants) {
  return AREAS
    .map(({ area, label }) => ({ area, label, plants: (plants || []).filter((p) => areaOf(p) === area) }))
    .filter((g) => g.plants.length);
}

const DAY = 86400000;

export function daysSince(iso, todayISO) {
  if (!iso) return 0;
  const n = Math.round((Date.parse(todayISO + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / DAY);
  return Number.isFinite(n) && n > 0 ? n : 0;   // a future date reads as today
}

export function waterLabel(iso, todayISO) {
  if (!iso) return 'never watered';
  const n = daysSince(iso, todayISO);
  if (n === 0) return 'watered today';
  return `watered ${n} day${n === 1 ? '' : 's'} ago`;
}

/* Notes and photos are one record, not two lists. A note and the photos taken
   the same day on the same plant are one entry. A photo nobody tagged gets an
   entry of its own rather than attaching itself to an unrelated note. */
export function historyStream(notes, photos) {
  const byKey = new Map();
  const at = (date, plantId) => {
    const key = `${date}|${plantId ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, { date, plantId: plantId ?? null, notes: [], photoIds: [] });
    return byKey.get(key);
  };
  for (const n of notes || []) { if (n && n.date) at(n.date, n.plantId).notes.push(n); }
  for (const p of photos || []) { if (p && p.date) at(p.date, p.plant).photoIds.push(p.id); }
  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/* The care table names ten stages. The season bar draws four phases. */
const PHASE_OF_STAGE = {
  seedling: 'grow', sprouting: 'grow', settling: 'grow',
  establishing: 'grow', growing: 'grow', bulbing: 'grow',
  flowering: 'flower', fruiting: 'fruit', harvesting: 'harvest',
};
export function phaseOfStage(stage) {
  return PHASE_OF_STAGE[stage] || null;
}

/* The species table is the expectation. Where the plant is recorded as having
   actually changed, that date wins and the bar redraws around it. Where the
   planner expects a change that has not happened yet, that date is used too,
   but a recorded change always beats a predicted one for the same phase. */
export function seasonSpans(defaults, history, upcoming, windowEnd, current) {
  const spans = (defaults || []).map((s) => s.slice());
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '');

  const realStart = new Map();
  for (const h of [...(history || [])].sort(byDate)) {
    const phase = phaseOfStage(h && h.stage);
    if (phase && h.date) realStart.set(phase, h.date);   // a later record wins
  }
  const preds = [...(upcoming || [])].filter((u) => u && u.date).sort(byDate);
  const nowPhase = current && phaseOfStage(current.stage) && current.date
    ? phaseOfStage(current.stage) : null;
  if (!spans.length) return spans;
  if (!realStart.size && !preds.length && !nowPhase) return spans;

  const predStart = new Map();
  for (const u of preds) {
    const phase = phaseOfStage(u.stage);
    if (phase && !predStart.has(phase)) predStart.set(phase, u.date);
  }

  for (let i = 0; i < spans.length; i++) {
    const at = realStart.get(spans[i][0]) ?? predStart.get(spans[i][0]);
    if (!at) continue;
    spans[i][1] = at;
    if (i > 0) spans[i - 1][2] = at;
  }

  /* A phase the species table never lists, predicted for later in the year, is
     appended. It runs until the next expected change, or to the end of the
     chart when nothing follows it. An expected change whose stage has no colour
     still ends the span before it. */
  const known = new Set(spans.map((s) => s[0]));
  for (let k = 0; k < preds.length; k++) {
    const phase = phaseOfStage(preds[k].stage);
    if (!phase || known.has(phase)) continue;
    const next = preds[k + 1] ? preds[k + 1].date : (windowEnd || preds[k].date);
    spans.push([phase, preds[k].date, next]);
    known.add(phase);
  }

  /* The plant's own stage is a fact about today, not a guess: whatever phase it
     says it is in has to be the one covering today. When the plant is running
     behind the table, the phases after it slide by the same amount and keep
     their lengths, so the bar shows how late it is rather than contradicting
     the label next to it. A phase the history already dates is left alone. */
  if (nowPhase) {
    const at = spans.findIndex((x) => x[0] === nowPhase);
    if (at !== -1 && !realStart.has(nowPhase) && spans[at][2] < current.date) {
      const shift = dayDiff(spans[at][2], current.date);
      spans[at][2] = current.date;
      for (let i = at + 1; i < spans.length; i++) {
        spans[i][1] = addDaysISO(spans[i][1], shift);
        spans[i][2] = addDaysISO(spans[i][2], shift);
      }
    }
  }

  /* A phase runs until the next one begins, so once a start moves every end
     before it follows. Starts are made monotone first, otherwise a change
     recorded out of sequence would run a span backwards. */
  const tail = spans.length - 1;
  for (let i = 1; i <= tail; i++) {
    if (spans[i][1] < spans[i - 1][1]) spans[i][1] = spans[i - 1][1];
  }
  for (let i = 0; i < tail; i++) spans[i][2] = spans[i + 1][1];
  /* The last phase has nothing after it to end it. If it is now expected to
     begin after its own table end, it runs to the edge of the chart instead of
     collapsing to nothing. */
  if (tail >= 0 && spans[tail][2] < spans[tail][1]) {
    spans[tail][2] = windowEnd && windowEnd > spans[tail][1] ? windowEnd : spans[tail][1];
  }
  return spans;
}

const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const addDaysISO = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addMonthsISO(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/* One window for the whole chart, so every plant's bar lines up with the month
   scale above it. It reaches back to the earliest thing known about the garden
   and forward at least `monthsAhead`, further if something is expected later. */
export function chartWindow({ spans, histories, upcomings, today, monthsAhead = 3 }) {
  const dates = [];
  for (const list of spans || []) for (const row of list || []) { if (row[1]) dates.push(row[1]); if (row[2]) dates.push(row[2]); }
  for (const h of histories || []) for (const e of h || []) { if (e && e.date) dates.push(e.date); }
  for (const u of upcomings || []) for (const e of u || []) { if (e && e.date) dates.push(e.date); }

  const floor = addMonthsISO(today, -1);
  const minEnd = addMonthsISO(today, monthsAhead);
  if (!dates.length) return { start: floor, end: minEnd };
  const earliest = dates.reduce((a, b) => (a < b ? a : b));
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  return { start: earliest < today ? earliest : floor, end: latest > minEnd ? latest : minEnd };
}

/* The first of every month inside the window, for the scale above the bars. */
export function monthTicks(start, end) {
  const out = [];
  let d = new Date(start + 'T00:00:00Z');
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.toISOString().slice(0, 10) <= end) {
    out.push({ date: d.toISOString().slice(0, 10), label: MONTH_ABBR[d.getUTCMonth()] });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}


/* Which photos belong in a history view. An untagged photo has no plant to sit
   under, so it belongs to the whole garden and nowhere else: showing it on one
   plant's page would claim it is a photo of that plant. */
export function photosInView(photos, plantIds, allPlants) {
  const ids = new Set(plantIds || []);
  return (photos || []).filter((p) => (p.plant ? ids.has(p.plant) : !!allPlants));
}

/* The garden journal shows what was actually written, with every plant the
   distiller recognised turned into a tag in place of its name. One phrase can
   name several plants ("all raspberry"), so a span carries a list. A mention
   the text does not contain is dropped: better no tag than a tag on the wrong
   words. */
export function tagEntryText(text, mentions) {
  if (!text) return [];
  const byPhrase = new Map();
  for (const m of mentions || []) {
    if (!m || !m.mention || !m.plantId) continue;
    const key = m.mention.toLowerCase();
    if (!byPhrase.has(key)) byPhrase.set(key, { phrase: m.mention, plants: [] });
    byPhrase.get(key).plants.push({ plantId: m.plantId, label: m.label });
  }
  // Longest phrase first, so "chilli seedlings" is not eaten by "chilli".
  const phrases = [...byPhrase.values()].sort((a, b) => b.phrase.length - a.phrase.length);

  const hay = text.toLowerCase();
  const hits = [];
  const taken = (from, to) => hits.some((h) => from < h.to && to > h.from);
  for (const p of phrases) {
    const needle = p.phrase.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) {
      if (!taken(i, i + needle.length)) hits.push({ from: i, to: i + needle.length, plants: p.plants });
      i = hay.indexOf(needle, i + needle.length);
    }
  }
  hits.sort((a, b) => a.from - b.from);

  const out = [];
  let at = 0;
  for (const h of hits) {
    if (h.from > at) out.push({ type: 'text', text: text.slice(at, h.from) });
    out.push({ type: 'tags', plants: h.plants });
    at = h.to;
  }
  if (at < text.length) out.push({ type: 'text', text: text.slice(at) });
  return out;
}

const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* In a garden journal the silences are information: nothing written for two
   months is itself a record of the season going quiet. */
function gapLabel(laterISO, earlierISO) {
  const days = Math.round((Date.parse(laterISO + 'T00:00:00Z') - Date.parse(earlierISO + 'T00:00:00Z')) / 86400000);
  if (!Number.isFinite(days) || days < 21) return null;
  if (days < 60) return `${Math.round(days / 7)} weeks earlier`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} earlier`;
}

/* The journal reads newest first, broken by month, with the quiet stretches
   called out between entries. */
export function journalGroups(entries) {
  const sorted = [...(entries || [])].filter((e) => e && e.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  const groups = [];
  sorted.forEach((e, i) => {
    const next = sorted[i + 1];
    const d = new Date(e.date + 'T00:00:00Z');
    const label = `${MONTH_FULL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, entries: [] });
    groups[groups.length - 1].entries.push({ ...e, gapAfter: next ? gapLabel(e.date, next.date) : null });
  });
  return groups;
}
