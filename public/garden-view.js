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
