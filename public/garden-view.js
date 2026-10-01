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
  if (!iso) return 'Not watered yet';
  const n = daysSince(iso, todayISO);
  if (n === 0) return 'Last watered today';
  return `Last watered ${n} day${n === 1 ? '' : 's'} ago`;
}

/* The planner writes a fine-grained stage word; the season bar draws four
   broad phases and each stage word sits inside one of them. Dormancy is
   deliberately absent: it is a real stage with no band on this chart. */
/* Seedling is the phase before growing: seed in, first leaves. A plant bought
   or moved and settling in is past that, it is growing a root system in a new
   pot, so settling and establishing stay with growing. */
const PHASE_OF_STAGE = {
  sown: 'seed', germinating: 'seed', sprouting: 'seed', seedling: 'seed',
  settling: 'grow',
  establishing: 'grow', established: 'grow', vegetative: 'grow',
  growing: 'grow', bulbing: 'grow',
  flowering: 'flower', fruiting: 'fruit',
  harvesting: 'harvest', ready: 'harvest',
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

  /* No variety table lists a seedling phase, so a plant recorded as one gets a
     band of its own in front of the first phase, running up to it. The rules
     below then treat it like any other phase the plant is in now. */
  if ((nowPhase === 'seed' || realStart.has('seed')) && spans[0][0] !== 'seed') {
    spans.unshift(['seed', spans[0][1], spans[0][1]]);
  }

  /* A prediction that the plant is about to enter the phase it is already in
     has been overtaken: the plant says it started, so the date the planner is
     still waiting for is wrong and the table's own start stands. Without this
     the band walks off into the future and today lands on bare track. */
  const predStart = new Map();
  for (const u of preds) {
    const phase = phaseOfStage(u.stage);
    if (!phase || predStart.has(phase)) continue;
    if (phase === nowPhase && u.date > current.date) continue;
    predStart.set(phase, u.date);
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
     the label next to it. Running early is the same problem the other way up:
     a phase it is already in cannot still be waiting to start, so its start
     comes back to today, and so does anything ahead of it that the plant has
     evidently skipped. A phase the history already dates keeps its start, but
     it still runs on to today while the plant is in it: a recorded start is no
     reason to leave today bare. */
  if (nowPhase) {
    const at = spans.findIndex((x) => x[0] === nowPhase);
    if (at !== -1) {
      if (spans[at][2] < current.date) {
        const shift = dayDiff(spans[at][2], current.date);
        spans[at][2] = current.date;
        for (let i = at + 1; i < spans.length; i++) {
          spans[i][1] = addDaysISO(spans[i][1], shift);
          spans[i][2] = addDaysISO(spans[i][2], shift);
        }
      } else if (!realStart.has(nowPhase) && spans[at][1] > current.date) {
        for (let i = at; i >= 0 && spans[i][1] > current.date; i--) spans[i][1] = current.date;
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
  /* Dormancy has no band of its own, but the season still stops when it
     arrives, so an expected change with no phase cuts the last band short
     rather than letting it run straight through. */
  for (const u of preds) {
    if (phaseOfStage(u.stage)) continue;
    if (tail >= 0 && u.date > spans[tail][1] && u.date < spans[tail][2]) spans[tail][2] = u.date;
  }
  return spans;
}

/* Where this plant's own season begins: sown, planted, bought or rooted. The
   variety table knows nothing about that, so it is applied on top. A start
   before the table's first phase gets a seedling band up to it, or stretches
   the seedling band that is already there. A start
   after it means the plant was not here yet: phases that ended before it are
   dropped, since they never happened in this pot, and the first one left
   begins on the start date. */
/* How long a sown plant counts as a seedling before it is simply growing. A
   rough six weeks: long enough to cover germination and the first true leaves. */
const SEEDLING_DAYS = 42;

export function withStart(spans, started, how = 'sown') {
  const out = (spans || []).map((s) => s.slice());
  if (!started || !out.length) return out;
  if (started < out[0][1]) {
    const first = out[0][1];
    /* Only something grown from seed has a seedling phase. A bought plant or a
       rooted cutting is already a plant, so it starts out growing. */
    const sown = how === 'sown';
    const seedEnd = sown ? addDaysISO(started, SEEDLING_DAYS) : started;
    if (out[0][0] === 'seed') { out[0][1] = started; return out; }
    const lead = [];
    if (sown) lead.push(['seed', started, seedEnd < first ? seedEnd : first]);
    /* Whatever is left between the seedling and the table is growing. If the
       table already opens on growing, that band just reaches back to meet it,
       rather than two growing bands sitting side by side. */
    const growFrom = sown ? seedEnd : started;
    if (growFrom < first) {
      if (out[0][0] === 'grow') out[0][1] = growFrom;
      else lead.push(['grow', growFrom, first]);
    }
    return [...lead, ...out];
  }
  const keep = out.filter((s, i) => s[2] > started || i === out.length - 1);
  if (keep[0][1] < started) keep[0][1] = started;
  if (keep[0][2] < keep[0][1]) keep[0][2] = keep[0][1];
  return keep;
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
  /* A month of empty track before the earliest date, so whatever starts first
     (a sowing, a first record) has room in front of it instead of sitting on
     the chart's left edge. */
  return { start: earliest < today ? addMonthsISO(earliest, -1) : floor,
    end: latest > minEnd ? latest : minEnd };
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

/* One plant's photos, newest first: by the day it was taken, then by upload
   order within the day. The card shows the first, the plant page stacks them. */
export function plantPhotos(photos, plantId) {
  return (photos || []).filter((p) => p.plant === plantId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created || 0) - (a.created || 0));
}

/* The plants a note names with @, as {plantId, mention}. The mention is the
   first occurrence exactly as typed, so the journal can find it and turn it
   into a tag. A name must end at a word boundary: @Basilisk is not @Basil. */
export function findMentions(text, labels) {
  const low = (text || '').toLowerCase();
  const out = [];
  for (const { id, label } of labels || []) {
    const needle = '@' + label.toLowerCase();
    let i = low.indexOf(needle);
    while (i >= 0 && /[\p{L}\p{N}_]/u.test(low[i + needle.length] || '')) i = low.indexOf(needle, i + 1);
    if (i >= 0) out.push({ plantId: id, mention: text.slice(i, i + needle.length) });
  }
  return out;
}

/* The @word the caret sits at the end of, while it is still being typed:
   {start, q}, or null. The @ must open a word, so an email address is left alone. */
export function mentionQuery(text, caret) {
  const m = /(^|\s)@([^\s@]*)$/.exec((text || '').slice(0, caret));
  return m ? { start: m.index + m[1].length, q: m[2] } : null;
}

/* The note split into plain runs and @name runs, every occurrence, so the
   composer can draw each tag as a chip under the text. At each @ the longest
   name that fits wins, so @Takalan 12 is never read as @Takalan 1. */
export function mentionSegments(text, labels) {
  const src = text || '';
  const low = src.toLowerCase();
  const byLen = [...(labels || [])].sort((a, b) => b.label.length - a.label.length);
  const out = [];
  let plain = '', i = 0;
  while (i < src.length) {
    const hit = src[i] === '@' && byLen.find(({ label }) => {
      const needle = '@' + label.toLowerCase();
      return low.startsWith(needle, i) && !/[\p{L}\p{N}_]/u.test(low[i + needle.length] || '');
    });
    if (hit) {
      if (plain) { out.push({ text: plain }); plain = ''; }
      const n = hit.label.length + 1;
      out.push({ text: src.slice(i, i + n), plantId: hit.id });
      i += n;
    } else { plain += src[i]; i += 1; }
  }
  if (plain) out.push({ text: plain });
  return out;
}

/* The plant's stage record for the season bar: the changes noticed live, plus
   the ones the model dated from the notes. When both name the same stage within
   two months of each other they are one event, and it keeps the earlier date:
   a stage starts at its first sign, and anything later is only when it was
   noticed. So a run that dates a stage late can never pull the bar back. */
export function stageRecord(history, noteStages) {
  const ok = (e) => e && e.date && e.stage;
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 60 * 864e5;
  const out = [];
  for (const e of [...(noteStages || []), ...(history || [])].filter(ok)) {
    const i = out.findIndex((o) => o.stage === e.stage && near(o.date, e.date));
    if (i < 0) out.push({ date: e.date, stage: e.stage });
    else if (e.date < out[i].date) out[i] = { date: e.date, stage: e.stage };
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
