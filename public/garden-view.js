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
   actually changed, that date wins and the bar redraws around it, so the left
   of the bar is what happened and the right is still the guess. */
export function seasonSpans(defaults, history) {
  const spans = (defaults || []).map((s) => s.slice());
  if (!spans.length) return spans;

  const realStart = new Map();
  for (const h of [...(history || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const phase = phaseOfStage(h && h.stage);
    if (phase && h.date) realStart.set(phase, h.date);   // a later record wins
  }
  if (!realStart.size) return spans;

  for (let i = 0; i < spans.length; i++) {
    const at = realStart.get(spans[i][0]);
    if (!at) continue;
    spans[i][1] = at;
    if (i > 0) spans[i - 1][2] = at;
  }
  // A late transition can push a start past its own end, or past an earlier
  // span's start. Sweep once forward and once back so nothing is inverted.
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][1] < spans[i - 1][1]) spans[i][1] = spans[i - 1][1];
  }
  for (const s of spans) { if (s[2] < s[1]) s[2] = s[1]; }
  for (let i = 0; i < spans.length - 1; i++) {
    if (spans[i][2] > spans[i + 1][1]) spans[i][2] = spans[i + 1][1];
  }
  for (const s of spans) { if (s[2] < s[1]) s[2] = s[1]; }
  return spans;
}

/* Which photos belong in a history view. An untagged photo has no plant to sit
   under, so it belongs to the whole garden and nowhere else: showing it on one
   plant's page would claim it is a photo of that plant. */
export function photosInView(photos, plantIds, allPlants) {
  const ids = new Set(plantIds || []);
  return (photos || []).filter((p) => (p.plant ? ids.has(p.plant) : !!allPlants));
}
