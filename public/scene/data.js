/* State, network and the task engine for the 3D page.
 *
 * No DOM and no Three.js: this module owns what is true about the garden, and
 * nothing about how it looks. The page injects `hooks` for the two things that
 * genuinely need UI (asking for the passphrase, showing a toast) and a redraw
 * callback for when server data lands.
 *
 * This is a port of the logic inside public/index.html. The two pages write the
 * same KV keys, so pushState/pullState below are copied verbatim from there,
 * including the stamp handling. Change them in one place only if you also change
 * the other, or done-checks stop agreeing across devices.
 */

import { effectiveInterval, weatherAlerts, normalizeHealth } from '../care-rules.js';

/* ================= basics ================= */
export const store = {
  get: (k) => JSON.parse(localStorage.getItem(k) || 'null'),
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const TAMPERE = { la: 61.4981, lo: 23.7610 };

export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => iso(new Date());
export const addDays = (s, n) => { const d = new Date(s); d.setDate(d.getDate() + n); return iso(d); };
export const dBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const KUUT = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const VKO = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const esc = (s) => (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const shortDate = (s) => { const d = new Date(s); return d.getDate() + '.' + (d.getMonth() + 1) + '.'; };
export const relTime = (ms) => {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
};

/* The page fills these in. */
export const hooks = {
  onChange: () => {},              // server data or local state moved
  askPass: async () => null,       // resolve to a passphrase string or null
  toast: () => {},
  onBusy: () => {},
};

/* ================= care knowledge ================= */
export const CARE = {
  basilmint: { care: {
    growing: { water: 2, why: 'Bed dries fast behind glass',
      weekly: [['care', 'Pinch basil tips', 'Above a leaf pair — bushy, no flowers. Trim mint back.'],
        ['care', 'Feed basil & mint', 'Liquid feed, every 2nd week is enough.']] },
    harvesting: { water: 2, why: 'Keep harvest coming',
      weekly: [['care', 'Harvest basil & mint', 'Basil from the top, mint outer stems. Pinch any flower buds.']] } } },
  chilli: { care: {
    seedling: { water: 3, why: 'Light water only — damping-off kills sprouts',
      weekly: [['care', 'Rotate pots', 'Stops leggy lean toward the glass. Pot up at 4–6 true leaves.']] },
    vegetative: { water: 2, why: 'Steady moisture while bulking up',
      weekly: [['care', 'Feed', 'Half-strength liquid feed weekly.']] },
    flowering: { water: 2, why: 'Even water so flowers hold',
      daily: [['pollen', 'Tap the flowers', 'Midday — no bees behind glass.']],
      weekly: [['care', 'Feed high-K', 'Tomato feed works.']] },
    fruiting: { water: 1, why: 'Dry spells make fruit drop',
      weekly: [['care', 'Feed', 'High-K weekly while fruiting.']] } } },
  tomato: { care: {
    seedling: { water: 2, why: 'Even moisture', weekly: [] },
    vegetative: { water: 2, why: 'Big leaves, big thirst',
      weekly: [['care', 'Side shoots + ties', 'Snap armpit shoots, tie main stem higher.']] },
    flowering: { water: 1, why: 'Uneven water now = blossom end rot later',
      daily: [['pollen', 'Shake the flower trusses', 'Midday. No bees, no wind behind glass — no shake, no fruit. Vent hard: pollen sterile over ~32°C.']],
      weekly: [['care', 'Feed high-K', 'Weekly from first flowers.'],
        ['care', 'Side shoots + ties', 'Keep the 1 m stem supported.']] },
    fruiting: { water: 1, why: 'Never bone-dry — fruit splits',
      weekly: [['care', 'Feed high-K', 'Weekly.'],
        ['care', 'Tidy lower leaves', 'Below lowest truss — airflow against mildew.']] } } },
  chives: { care: {
    growing: { water: 3, why: 'Easy — top 2 cm dry, then water', weekly: [] },
    harvesting: { water: 3, why: 'Cut & come again',
      weekly: [['care', 'Harvest', 'Cut whole leaves 2 cm above soil — regrows fast.']] } } },
  springonion: { care: {
    growing: { water: 2, why: 'Shallow roots, dry fast in glazed heat',
      weekly: [['care', 'Re-sow', 'A pinch every ~3 weeks keeps supply steady.']] },
    harvesting: { water: 2, why: 'Keep moist to the end',
      weekly: [['care', 'Pull the thickest', 'Or cut 3 cm above base to regrow.']] } } },
  parsley: { care: {
    growing: { water: 3, why: 'Even moisture; bolts in heat — shade on 30°C days', weekly: [] },
    harvesting: { water: 3, why: 'Outer stems only',
      weekly: [['care', 'Harvest outer stems', 'Cut at the base, centre keeps producing.']] } } },
  monstera: { care: {
    settling: { water: 7, why: 'Newly bought — let top 3–4 cm dry first; no feed or repot yet',
      weekly: [['care', 'Check the spot', 'Bright indirect light, away from draughts/radiators. Wipe dust off leaves.']] },
    established: { water: 7, why: 'Top 3–4 cm dry before watering',
      weekly: [['care', 'Feed', 'Balanced feed monthly in season; give the aerial roots something to climb.']] } } },
  hedera: { care: {
    settling: { water: 5, why: 'Steady (not heavy) water while roots establish; top 2–3 cm dry first',
      weekly: [['care', 'Check the leaves', 'Happy in the shady corner. Watch under leaves — spider mites love dry glazed air.']] },
    established: { water: 6, why: 'Let surface dry between waterings',
      weekly: [['care', 'Trim', 'Cut wandering vines to shape — regrows from any node. Hardy to −10°C.']] } } },
  raspberry: { care: {
    settling: { water: 2, why: 'New pot behind glass dries fast — keep evenly moist, top 2–3 cm dry, never waterlogged',
      weekly: [['care', 'Tie in the canes', 'Loosely tie new canes to a support so wind and glass heat do not snap them.'],
        ['care', 'Feed', 'Half-strength liquid feed weekly while establishing. Watch leaf undersides for spider mites.']] },
    fruiting: { water: 1, why: 'Even water while berries swell — dry spells shrink fruit',
      daily: [['pollen', 'Tap the flowers', 'Midday — few bees behind glass. Berries drop free when dead-ripe.']],
      weekly: [['care', 'Pick the berries', 'Every 2–3 days — ripe ones spoil fast. High-K feed weekly.']] },
    dormant: { water: 7, why: 'Barely water over winter — hardy, stays out on the balcony',
      weekly: [['care', 'Cut the fruited canes', "After fruiting, cut spent (2nd-year) canes to the ground; keep this year's new canes."]] } } },
  garlic: { care: {
    sprouting: { water: 5, why: 'Sparse — wet rots the clove', weekly: [] },
    bulbing: { water: 5, why: 'Too wet rots the bulb; keep it in the coolest corner',
      weekly: [['care', 'Check the leaves', 'Half the leaves yellow → stop watering, nearly ready.']] },
    ready: { water: 99, why: 'Done drinking',
      weekly: [['care', 'Lift the bulb?', 'Half+ leaves brown → lift, dry 2 weeks somewhere airy.']] } } },
};
export const careOf = (p) => (CARE[p.species]?.care[p.stage]) || { water: 3, why: '', weekly: [], daily: [] };
const baseInterval = (p) => p.intervalOverride || careOf(p).water;

/* ================= profiles, season ================= */
export const PROFILE = {
  basilmint: { t: 'Basil “Italiano Classico” & Mint', src: 'Biltema seeds · mint as plant', ids: ['basil-mint'],
    body: ['Classic Genovese basil. Pinch above a leaf pair weekly — bushy, no flowers. Hates cold: sulks under 12°C nights.',
      'Mint is invasive — divider in the shared bed, or trim its roots each month. Harvest mint outer stems, basil from the top.',
      'Feed the bed liquid fertilizer every 2 weeks.'] },
  chilli: { t: 'Chilli “Lombardo”', src: 'Biltema 14-2867', ids: ['chilli-1', 'chilli-2'],
    body: ['Mild Italian frying chilli — long fruit, green ripening to red. Early and productive.',
      "Seedlings: water lightly only when top 1 cm is dry (damping-off kills sprouts). Max light, rotate pots so they don't lean. Pot up at 4–6 true leaves.",
      'From flowering: tap flowers midday (no bees behind glass), feed high-K weekly.',
      'Pick green for mild crunch or red for sweeter warmth — picking often = more fruit.'] },
  tigerella: { t: 'Tomato “Tigerella”', src: 'Nelson Garden', ids: ['tomato-1'],
    body: ['Striped heirloom cordon — needs stake, pinch side shoots weekly.',
      'Shake flower trusses daily at midday to set fruit behind glass.',
      'Water deep and even — uneven water = split fruit + blossom end rot. High-K feed weekly.',
      'Ripe when the stripes turn orange-red. Handles cool Tampere summers well.'] },
  noire: { t: 'Tomato “Noire de Crimée”', src: 'Nelson Garden', ids: ['tomato-2'],
    body: ['Black beefsteak cordon — tall, hungry. Feed generously: high-K weekly from first flowers.',
      'Shake trusses daily at midday. Stake well — big fruit gets heavy.',
      "Ripe when SOFT, not by colour — it stays dark brown-red, darkest on top. Squeeze gently, don't wait for red.",
      'Early variety with a long harvest — expect fruit from mid-August.'] },
  chives: { t: 'Chives', src: 'Biltema 14-2818', ids: ['chives'],
    body: ['Perennial and frost-hardy — leave the bed on the balcony over winter, it returns early spring. Your one plant that outlives the season.',
      'Cut whole leaves 2 cm above soil — regrows in days. Harvesting often keeps it productive.',
      'Water when top 2 cm dry. Light feed monthly is plenty.'] },
  springonion: { t: 'Spring onion', src: 'Biltema 14-2807', ids: ['spring-onion'],
    body: ['Early, fast variety with long thick white stems.',
      'Keep evenly moist — shallow roots dry fast in glazed heat.',
      'Harvest whole at pencil thickness, thickest first. Re-sow a pinch every 3 weeks for steady supply into autumn.'] },
  parsley: { t: 'Curly parsley', src: 'Biltema 14-2820', ids: ['parsley'],
    body: ['Curly, dark green type. The marathon runner — germination up to 4 weeks is normal.',
      'Even moisture, deep soil. Bolts in heat: shade it on 30°C+ days.',
      'Harvest outer stems at the base only — the centre keeps producing to late autumn. Moves to a windowsill for winter.'] },
  monstera: { t: 'Monstera deliciosa', src: 'IKEA · indoors', ids: ['monstera'],
    body: ['Newly bought — let it settle a few weeks in a bright indirect spot, away from draughts and radiators. No feeding or repotting yet.',
      'Water only when the top 3–4 cm of soil is dry, roughly weekly. Overwatering is the one thing that kills it.',
      'Wipe the big leaves now and then — dust blocks light. Once settled, feed monthly in season and give the aerial roots a pole to climb.'] },
  hedera: { t: 'Ivy · Hedera helix', src: 'IKEA · balcony', ids: ['hedera'],
    body: ['The tough one — happy in the shady corner where nothing else grows, and frost-hardy to about −10°C. Stays out all winter with the chives.',
      'While it establishes: steady but light watering, top 2–3 cm dry between waterings. Never soggy.',
      'Check leaf undersides — spider mites love warm dry glazed air. Trim wandering vines anytime; it regrows from any node.'] },
  maurin: { t: 'Raspberry “Maurin Makea”', src: 'Finnish summer raspberry', ids: ['rasp-maurin'],
    body: ['A Finnish summer (floricane) raspberry prized for very sweet berries. Ahead of the other two — it has set green fruit already (Jul 2026), ripening red over the coming weeks.',
      'Now fruiting: keep the water even so berries swell without splitting — top 2–3 cm dry between waterings, never bone-dry or soggy. High-K feed weekly. Pick every 2–3 days once they colour up; dead-ripe berries pull free with a light tug.',
      "Tie the fruiting canes to a support so glass heat and wind don't snap them. Watch leaf undersides for spider mites in dry glazed air.",
      "Frost-hardy — leave it out on the balcony over winter with the chives and ivy. After the canes finish fruiting, cut those spent canes to the ground and keep this year's fresh canes for next summer."] },
  'takala-1': { t: 'Raspberry “Takalan Herkku” 1', src: 'New pot · Finnish summer raspberry', ids: ['rasp-takala-1'],
    body: ['A hardy Finnish summer (floricane) raspberry with large, sweet berries — a reliable home-garden favourite. Just potted: new canes grow this year, main crop next summer.',
      'Even moisture, top 2–3 cm dry between waterings — never waterlogged. New pot dries fast behind glass; steady water while establishing. Half-strength feed weekly.',
      'Tie the new canes to a support against wind and glass heat; check leaf undersides for spider mites.',
      "Very hardy — overwinters on the balcony. Cut spent (fruited) canes to the ground after they crop; keep this year's canes for next summer's berries."] },
  'takala-2': { t: 'Raspberry “Takalan Herkku” 2', src: 'New pot · Finnish summer raspberry', ids: ['rasp-takala-2'],
    body: ['The second Takalan Herkku pot — same hardy Finnish summer raspberry, large sweet berries. Just potted: new canes grow this year, main crop next summer.',
      'Even moisture, top 2–3 cm dry between waterings — never waterlogged. New pot dries fast behind glass; steady water while establishing. Half-strength feed weekly.',
      'Give it its own cane/support and room from pot 1 for airflow; check leaf undersides for spider mites.',
      "Very hardy — overwinters on the balcony. Cut spent (fruited) canes to the ground after they crop; keep this year's canes for next summer's berries."] },
  garlic: { t: 'Garlic pot', src: 'from cloves', ids: ['garlic'],
    body: ['Water sparingly — wet soil rots the bulb. Coolest corner of the balcony; glazed heat rushes it.',
      'When half the leaves yellow: stop watering. When half are brown: lift the bulb.',
      'Dry lifted bulbs 2 weeks somewhere airy before storing.'] },
};
export const KEY_BY_ID = {};
Object.entries(PROFILE).forEach(([key, pr]) => (pr.ids || []).forEach((id) => { KEY_BY_ID[id] = key; }));

export const SEASON = [
  { key: 'tigerella', lbl: 'Tigerella', ph: [['flower', '2026-06-29', '2026-08-01'], ['fruit', '2026-08-01', '2026-08-20'], ['harvest', '2026-08-20', '2026-10-01']] },
  { key: 'noire', lbl: 'Noire de Crimée', ph: [['flower', '2026-06-29', '2026-08-01'], ['fruit', '2026-08-01', '2026-08-15'], ['harvest', '2026-08-15', '2026-10-01']] },
  { key: 'maurin', lbl: 'Maurin Makea', ph: [['fruit', '2026-07-21', '2026-08-12'], ['harvest', '2026-08-12', '2026-09-10']] },
  { key: 'takala-1', lbl: 'Takalan Herkku 1', ph: [['grow', '2026-07-21', '2026-10-05']] },
  { key: 'takala-2', lbl: 'Takalan Herkku 2', ph: [['grow', '2026-07-21', '2026-10-05']] },
  { key: 'parsley', lbl: 'Parsley', ph: [['grow', '2026-06-29', '2026-08-25'], ['harvest', '2026-08-25', '2026-10-05']] },
  { key: 'chilli', lbl: 'Lombardo ×2', ph: [['grow', '2026-07-10', '2026-08-05'], ['flower', '2026-08-05', '2026-08-20'], ['fruit', '2026-08-20', '2026-09-05'], ['harvest', '2026-09-05', '2026-09-30']] },
  { key: 'basilmint', lbl: 'Basil & mint', ph: [['grow', '2026-06-29', '2026-08-05'], ['harvest', '2026-08-05', '2026-09-30']] },
  { key: 'chives', lbl: 'Chives', ph: [['grow', '2026-06-29', '2026-08-15'], ['harvest', '2026-08-15', '2026-10-05']] },
  { key: 'springonion', lbl: 'Spring onion', ph: [['grow', '2026-06-29', '2026-08-20'], ['harvest', '2026-08-20', '2026-10-05']] },
  { key: 'garlic', lbl: 'Garlic', ph: [['grow', '2026-06-29', '2026-08-10'], ['harvest', '2026-08-10', '2026-09-15']] },
  { key: 'monstera', lbl: 'Monstera', ph: [['grow', '2026-06-29', '2026-10-05']] },
  { key: 'hedera', lbl: 'Ivy', ph: [['grow', '2026-06-29', '2026-10-05']] },
];
export const S_START = new Date('2026-06-29'), S_END = new Date('2026-10-05');
export const spos = (d) => Math.max(0, Math.min(100, (new Date(d) - S_START) / (S_END - S_START) * 100));

export const REAL = {
  basilmint: ['https://upload.wikimedia.org/wikipedia/commons/9/97/Ocimum_basilicum_8zz.jpg', 'Genovese basil · Wikimedia'],
  chilli: ['https://upload.wikimedia.org/wikipedia/commons/4/46/Fefferoni.jpg', 'Italian frying peppers · Wikimedia'],
  tigerella: ['https://upload.wikimedia.org/wikipedia/commons/6/6c/Balkoncontent_Tomatensorte_Tigerella.jpg', 'Tigerella on the vine · Wikimedia'],
  noire: ['https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Black_krim_tomato.jpg/1280px-Black_krim_tomato.jpg', 'Noire de Crimée (Black Krim) · Wikimedia'],
  chives: ['https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Allium_schoenoprasum_-_Bombus_lapidarius_-_Tootsi.jpg/1280px-Allium_schoenoprasum_-_Bombus_lapidarius_-_Tootsi.jpg', 'Chives in flower · Wikimedia'],
  springonion: ['https://upload.wikimedia.org/wikipedia/commons/f/fc/2010-06-19-supermarkt-by-RalfR-32.jpg', 'Spring onions · Wikimedia'],
  parsley: ['https://upload.wikimedia.org/wikipedia/commons/b/bf/Parsley100.jpg', 'Curly parsley · Wikimedia'],
  garlic: ['https://upload.wikimedia.org/wikipedia/commons/4/49/Opened_garlic_bulb_with_garlic_clove.jpg', 'Garlic bulb · Wikimedia'],
  monstera: ['https://www.ikea.com/fi/en/images/products/monstera-deliciosa-potted-plant-swiss-cheese-plant__1177967_pe895590_s5.jpg?f=xl', 'Monstera deliciosa · IKEA'],
  hedera: ['https://www.ikea.com/fi/en/images/products/hedera-helix-potted-plant-ivy__0902464_pe594502_s5.jpg?f=xl', 'Hedera helix · IKEA'],
  maurin: ['https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Raspberry_%2852479964737%29.jpg/1280px-Raspberry_%2852479964737%29.jpg', 'Ripe raspberries · Wikimedia'],
  'takala-1': ['https://upload.wikimedia.org/wikipedia/commons/6/67/Raspberries_-_geograph.org.uk_-_506621.jpg', 'Raspberries on the cane · Wikimedia'],
  'takala-2': ['https://upload.wikimedia.org/wikipedia/commons/6/67/Raspberries_-_geograph.org.uk_-_506621.jpg', 'Raspberries on the cane · Wikimedia'],
};

/* ================= local state ================= */
export let state = store.get('garden2') || { seedVersion: 0, plants: [] };
export let doneLog = store.get('doneLog') || {};
let prevWater = store.get('prevWater') || {};
let _pushTimer = null, _stateStamp = store.get('stateStamp') || 0, _synced = false;

(function mergeSeed() {
  const seed = window.GARDEN_SEED; if (!seed) return;
  if (seed.version > state.seedVersion) {
    seed.plants.forEach((sp) => {
      const ex = state.plants.find((p) => p.id === sp.id);
      if (ex) {
        ex.name = sp.name; ex.species = sp.species; ex.area = sp.area; ex.note = sp.note || ex.note;
        if (sp.water) ex.last = sp.water;
        if (sp.stage && sp.stage !== ex.stage) { ex.stage = sp.stage; (ex.history = ex.history || []).push({ date: todayISO(), stage: sp.stage }); }
      } else {
        const { water, ...rest } = sp;
        state.plants.push({ ...rest, last: water || todayISO(), history: [{ date: todayISO(), stage: sp.stage }] });
      }
    });
    state.plants = state.plants.filter((p) => seed.plants.some((sp) => sp.id === p.id) || p.userAdded);
    state.seedVersion = seed.version; save();
  }
})();
(function resetTasks() {
  const seed = window.GARDEN_SEED; if (!seed || !seed.resetTasksOn) return;
  if (state.resetTasksOn !== seed.resetTasksOn) {
    const T = todayISO();
    state.plants.forEach((p) => { p.last = T; });
    state.resetTasksOn = seed.resetTasksOn;
    store.set('prevWater', {}); store.set('doneLog', {});
    prevWater = {}; doneLog = {};
    save();
  }
})();
export function save() { store.set('garden2', state); pushState(); }

/* ================= server docs ================= */
export let statusDoc = store.get('statusDoc') || { updatedAt: 0, plants: {} };
export let planDoc = store.get('planDoc') || null;
export let entriesDoc = store.get('entriesDoc') || { updatedAt: 0, entries: [] };

export async function loadStatus() {
  try { const r = await fetch('/api/status', { cache: 'no-store' });
    if (r.ok) { statusDoc = await r.json(); store.set('statusDoc', statusDoc); } } catch (e) {}
}
export async function loadPlan() {
  try { const r = await fetch('/api/plan', { cache: 'no-store' });
    if (r.ok) { const d = await r.json(); planDoc = (d && d.plants) ? d : null; store.set('planDoc', planDoc); } } catch (e) {}
}
export async function loadEntries() {
  try { const r = await fetch('/api/entries', { cache: 'no-store' });
    if (r.ok) { entriesDoc = await r.json(); store.set('entriesDoc', entriesDoc); } } catch (e) {}
}

/* Give the server a record for any plant it has never seen. */
export async function seedStatus() {
  const seed = window.GARDEN_SEED; if (!seed) return;
  if (store.get('statusSeedVersion') === seed.version) return;
  if (!store.get('uploadPass')) return;
  for (const sp of seed.plants) {
    await api('/api/status/' + encodeURIComponent(sp.id) + '?seed=1', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: sp.name, species: sp.species,
        ...(statusDoc.plants[sp.id]?.stage ? {} : { stage: sp.stage, lastWatered: sp.water || todayISO() }) }),
    });
  }
  store.set('statusSeedVersion', seed.version);
  await loadStatus();
}

/* ================= weather ================= */
export let forecast = store.get('forecastT3');
export async function loadWx() {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${TAMPERE.la}&longitude=${TAMPERE.lo}`
      + `&current=temperature_2m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,relative_humidity_2m_mean`
      + `&forecast_days=14&timezone=auto`;
    const d = await (await fetch(u)).json();
    forecast = { fetched: todayISO(), nowT: d.current.temperature_2m, rh: d.current.relative_humidity_2m,
      days: Object.fromEntries(d.daily.time.map((t, i) => [t, { tmax: d.daily.temperature_2m_max[i], tmin: d.daily.temperature_2m_min[i], pop: d.daily.precipitation_probability_max[i], rh: d.daily.relative_humidity_2m_mean?.[i] }])) };
    store.set('forecastT3', forecast);
  } catch (e) {}
  hooks.onChange();
}
export const wxOf = (date) => forecast?.days?.[date];
export const wxIcon = (w) => !w ? '' : w.pop >= 60 ? '🌧️' : w.pop >= 30 ? '🌦️' : w.tmax >= 27 ? '☀️' : w.tmax >= 18 ? '⛅' : '☁️';
const weeklyIco = (w) => /feed/i.test(w) ? '🍽️' : /re-sow|sow/i.test(w) ? '🌱' : /harvest|lift|pull|pick/i.test(w) ? '🧺'
  : /rotate/i.test(w) ? '🔄' : /check/i.test(w) ? '🔍' : /pinch|shoot|trim|tidy|prune|leaf|cane/i.test(w) ? '✂️' : '🌿';

/* ================= plants ================= */
export function plants() {
  const seed = window.GARDEN_SEED; if (!seed) return [];
  return seed.plants.map((sp) => {
    const s = statusDoc.plants[sp.id] || {};
    const p = { id: sp.id, name: sp.name, species: sp.species, area: sp.area || 'balcony',
      stage: s.stage || sp.stage, last: s.lastWatered || sp.water || todayISO(),
      intervalOverride: s.intervalOverride, health: normalizeHealth(s.health),
      observations: s.observations, notes: s.notes || [] };
    p.interval = baseInterval(p);
    return p;
  });
}
export const plantById = (id) => plants().find((p) => p.id === id);
export const AREA_LABEL = { balcony: 'On the balcony', indoor: 'Indoors' };

/* ================= task engine ================= */
export let tasks = {}, photoDates = new Set();
export function buildTasks(horizonISO) {
  const byDate = {}; const T = todayISO();
  const list = plants();
  const at = (d) => (byDate[d] = byDate[d] || { alerts: [], groups: [] });
  const add = (d, p, t) => {
    const day = at(d);
    let g = day.groups.find((x) => x.plant.id === p.id);
    if (!g) { g = { plant: p, tasks: [] }; day.groups.push(g); }
    g.tasks.push(t);
  };
  list.forEach((p) => {
    const planDays = (planDoc && planDoc.plants && planDoc.plants[p.id]) || null;
    const through = planDoc && planDoc.through;
    const covered = (d) => !!(planDays && through && d <= through && planDays[d]);
    let last = p.last;
    for (let d = T; d <= horizonISO; d = addDays(d, 1)) {
      if (covered(d)) { planDays[d].forEach((t) => add(d, p, t)); continue; }
      const eff = effectiveInterval(p, wxOf(d));
      if (dBetween(last, d) >= eff) {
        const over = d === T && dBetween(last, d) > eff;
        add(d, p, { cat: 'water', ico: '💧', what: 'Water' + (over ? ' (overdue)' : ''), why: careOf(p).why, key: 'w|' + p.id });
        last = d;
      }
    }
    if (T <= horizonISO && (doneLog[T] || []).includes('w|' + p.id)) {
      const g = (byDate[T] || { groups: [] }).groups.find((x) => x.plant.id === p.id);
      if (!g || !g.tasks.some((t) => t.key === 'w|' + p.id))
        add(T, p, { cat: 'water', ico: '💧', what: 'Water', why: careOf(p).why, key: 'w|' + p.id });
    }
    const c = careOf(p);
    (c.daily || []).forEach(([cat, what, why]) => {
      for (let d = T; d <= horizonISO; d = addDays(d, 1))
        if (!covered(d)) add(d, p, { cat, ico: cat === 'pollen' ? '✋' : '🌱', what, why, key: cat + '|' + p.id + '|' + what });
    });
    (c.weekly || []).forEach(([cat, what, why]) => {
      for (let d = T; d <= horizonISO; d = addDays(d, 1))
        if (!covered(d) && new Date(d).getDay() === 0) add(d, p, { cat, ico: weeklyIco(what), what, why, key: 'wk|' + p.id + '|' + what });
    });
  });
  for (const d in byDate) byDate[d].alerts = weatherAlerts(d, wxOf(d), list);
  return byDate;
}
export const dayOf = (date) => tasks[date] || { alerts: [], groups: [] };
export const flatTasks = (date) => dayOf(date).groups.flatMap((g) => g.tasks);
export const tasksForPlant = (date, pid) => (dayOf(date).groups.find((g) => g.plant.id === pid) || { tasks: [] }).tasks;
export function rebuildTasks(horizon) { tasks = buildTasks(horizon); return tasks; }

/* ================= done log ================= */
export function markDone(date, key) {
  const l = doneLog[date] = doneLog[date] || [];
  const isWater = key.startsWith('w|'), id = key.slice(2), stash = date + '|' + id;
  if (l.includes(key)) {
    doneLog[date] = l.filter((k) => k !== key);
    if (isWater) { const p = state.plants.find((x) => x.id === id);
      if (p && stash in prevWater) { p.last = prevWater[stash]; delete prevWater[stash]; store.set('prevWater', prevWater); save(); } }
  } else {
    l.push(key);
    if (isWater) { const p = state.plants.find((x) => x.id === id);
      if (p) { prevWater[stash] = p.last; store.set('prevWater', prevWater); p.last = date; save(); } }
  }
  store.set('doneLog', doneLog); pushState(); hooks.onChange();
}
export const isDone = (date, key) => (doneLog[date] || []).includes(key);

/* ================= auth ================= */
export async function apiWrite(method, path, body, ct) {
  let pass = store.get('uploadPass');
  if (!pass) { pass = await hooks.askPass(); if (!pass) return null; store.set('uploadPass', pass); hooks.onChange(); }
  const r = await fetch(path, { method, headers: { authorization: 'Bearer ' + pass, ...(ct ? { 'content-type': ct } : {}) }, body });
  if (r.status === 401) { store.set('uploadPass', null); hooks.onChange(); hooks.toast('Wrong passphrase. Try again.'); return null; }
  return r;
}
export async function api(path, opts = {}) {
  const pass = store.get('uploadPass');
  if (!pass) return null;
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), authorization: 'Bearer ' + pass } });
  if (r.status === 401) { store.set('uploadPass', null); hooks.onChange(); }
  return r;
}
export const isUnlocked = () => !!store.get('uploadPass');
export function lock() { store.set('uploadPass', null); hooks.onChange(); }

/* ================= state sync =================
   Copied verbatim from public/index.html. Both pages write the same
   progress:garden blob; if these two drift, done-checks stop agreeing between
   the phone and the laptop. */
export function pushState() {
  if (!_synced) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(async () => {
    const pass = store.get('uploadPass');
    if (!pass) return;                                  // a visitor's local ticks stay local
    _stateStamp = Date.now(); store.set('stateStamp', _stateStamp);
    try { const r = await fetch('/api/progress', { method: 'PUT',
      headers: { authorization: 'Bearer ' + pass, 'content-type': 'application/json' },
      body: JSON.stringify({ updatedAt: _stateStamp, garden2: state, doneLog }) });
      if (r && r.status === 401) { store.set('uploadPass', null); hooks.onChange(); }
    } catch (e) {}
  }, 800);
}
export async function pullState() {
  try {
    const r = await fetch('/api/progress', { cache: 'no-store' }); if (!r.ok) return;
    const doc = await r.json();
    const fresh = doc && typeof doc.updatedAt === 'number';
    if (fresh && doc.updatedAt > _stateStamp) {
      if (doc.garden2) { Object.keys(state).forEach((k) => delete state[k]);
        Object.assign(state, doc.garden2); store.set('garden2', state); }
      if (doc.doneLog) { doneLog = doc.doneLog; store.set('doneLog', doneLog); }
      _stateStamp = doc.updatedAt; store.set('stateStamp', _stateStamp);
      hooks.onChange();
    } else if (!fresh && store.get('uploadPass')) { _synced = true; pushState(); }
  } catch (e) {}
  finally { _synced = true; }
}

/* ================= photos ================= */
export let PHOTOS = [];
export const photoURL = (id) => '/api/photos/' + id;
export const _hidden = new Set();
export const shown = (list) => list.filter((x) => !_hidden.has(x.id));
export function photosFor(pid) {
  const key = KEY_BY_ID[pid];
  const ids = (PROFILE[key] && PROFILE[key].ids) || [];
  return shown(PHOTOS.filter((x) => x.plant === pid || (x.plant === key && ids.length <= 1)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created || 0) - (a.created || 0));
}
export function applyPhotos() {
  PHOTOS.forEach((p) => { if (p.plant === 'takala') p.plant = 'takala-1'; });
  photoDates = new Set(shown(PHOTOS).map((x) => x.date));
  hooks.onChange();
}
export async function loadPhotos() {
  try { const r = await fetch('/api/photos'); if (r.ok) PHOTOS = await r.json(); } catch (e) {}
  applyPhotos();
}
export async function uploadOne(blob, date, plant) {
  const r = await apiWrite('POST', '/api/photos?date=' + encodeURIComponent(date) + '&plant=' + encodeURIComponent(plant || ''), blob, blob.type || 'image/jpeg');
  if (r && r.ok) { const rec = await r.json(); PHOTOS.push(rec); photoDates = new Set(PHOTOS.map((x) => x.date)); return rec; }
  hooks.toast('Could not upload that photo.');
  return null;
}
export async function deletePhoto(id) {
  const r = await apiWrite('DELETE', '/api/photos/' + id);
  if (r && (r.ok || r.status === 204)) { PHOTOS = PHOTOS.filter((x) => x.id !== id); applyPhotos(); return true; }
  return false;
}
export async function tagPhoto(id, pid) {
  const r = await apiWrite('PATCH', '/api/photos/' + id + '?plant=' + encodeURIComponent(pid));
  if (r && r.ok) { const p = PHOTOS.find((x) => x.id === id); if (p) p.plant = pid; applyPhotos(); return true; }
  return false;
}

/* ---- cover ---- */
export let coverId = '';
export async function loadCover() {
  try { const r = await fetch('/api/cover'); if (r.ok) coverId = (await r.json()).id || ''; } catch (e) {}
  hooks.onChange();
}
export async function setCover(id) {
  const r = await apiWrite('PUT', '/api/cover?id=' + encodeURIComponent(id || ''));
  if (r && r.ok) { coverId = id; hooks.onChange(); return true; }
  return false;
}

/* ================= entries ================= */
export let lastEntryId = null;
export const dismissed = new Set();
export const setLastEntry = (id) => { lastEntryId = id; };
export const getLastEntry = () => lastEntryId;

export async function saveEntry({ date, text, photoIds, plantId }) {
  const r = await apiWrite('POST', '/api/entries',
    JSON.stringify({ date, text, photoIds, ...(plantId ? { plantId } : {}) }), 'application/json');
  if (!r || !r.ok) { hooks.toast('Could not save. Try again.'); return null; }
  const entry = await r.json();
  entriesDoc = { ...entriesDoc, entries: [...entriesDoc.entries, entry] };
  store.set('entriesDoc', entriesDoc);
  lastEntryId = entry.id;
  return entry;
}
export async function deleteEntry(id) {
  const r = await apiWrite('DELETE', '/api/entries/' + encodeURIComponent(id));
  if (r && (r.ok || r.status === 204)) { await loadEntries(); await loadStatus(); return true; }
  return false;
}
export async function deleteNote(pid, noteId) {
  const r = await apiWrite('POST', '/api/notes', JSON.stringify({ plantId: pid, op: 'delete', id: noteId }), 'application/json');
  if (r && r.ok) { await loadStatus(); return true; }
  return false;
}
export async function editNote(plantId, id, text) {
  const r = await apiWrite('POST', '/api/notes', JSON.stringify({ plantId, op: 'edit', id, text }), 'application/json');
  if (!r || !r.ok) { hooks.toast('Could not save. Try again.'); return false; }
  await Promise.all([loadStatus(), loadEntries()]);
  return true;
}
export async function editEntry(id, text) {
  const r = await apiWrite('PATCH', '/api/entries/' + encodeURIComponent(id), JSON.stringify({ text }), 'application/json');
  if (!r || !r.ok) { hooks.toast('Could not save. Try again.'); return false; }
  await Promise.all([loadStatus(), loadEntries()]);
  return true;
}
export async function assignEntry(id, plantIds) {
  const r = await apiWrite('PATCH', '/api/entries/' + encodeURIComponent(id), JSON.stringify({ plantIds }), 'application/json');
  if (!r || !r.ok) { hooks.toast('Could not save. Try again.'); return false; }
  await Promise.all([loadEntries(), loadStatus()]);
  return true;
}

/* The distiller then the planner: two model calls back to back. Watch for both,
   or the task list stops refreshing seconds before the new plan arrives. */
let _poll = null;
export function refreshSoon() {
  clearTimeout(_poll);
  const planBefore = planDoc && planDoc.generatedAt;
  let n = 0;
  hooks.onBusy('Reading your note…');
  const tick = async () => {
    const wasPending = entriesDoc.entries.filter((e) => e.status === 'pending').map((e) => e.id);
    await Promise.all([loadStatus(), loadPlan(), loadEntries()]);
    hooks.onChange();
    const pending = entriesDoc.entries.some((e) => e.status === 'pending');
    const planFresh = (planDoc && planDoc.generatedAt) !== planBefore;
    const stuck = entriesDoc.entries.some((e) => wasPending.includes(e.id) && e.status === 'unsorted');
    if ((!pending && planFresh) || stuck || ++n >= 20) { hooks.onBusy(''); return; }
    hooks.onBusy(pending ? 'Reading your note…' : 'Rebuilding the plan…');
    _poll = setTimeout(tick, 3000);
  };
  _poll = setTimeout(tick, 2500);
}

/* ================= history ================= */
export function plantHistory(p) {
  const ev = {};
  const at = (d) => (ev[d] = ev[d] || { stage: null, notes: [], photos: 0 });
  ((state.plants.find((x) => x.id === p.id) || {}).history || []).forEach((h) => { if (h.date && h.stage) at(h.date).stage = h.stage; });
  shown(p.notes).forEach((n) => at(n.date).notes.push(n.text));
  photosFor(p.id).forEach((x) => at(x.date).photos++);
  return Object.entries(ev).sort((a, b) => b[0].localeCompare(a[0]));
}
