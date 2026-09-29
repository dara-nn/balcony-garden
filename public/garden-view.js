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
