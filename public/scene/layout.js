/* Where everything stands on the balcony, and what floats above it.
 *
 * Pure module: no DOM, no Three.js, no fetch. Everything here is a function of
 * garden data, so it can be unit tested.
 *
 * Looking in from the open door end, the composition is:
 *   left   the orange house wall, with the tomato and raspberry pots along it
 *   right  the glazing, with the bistro table and its two chairs along it
 *   ahead  the end wall, carrying the shelf of herbs, the ivy and the lamp
 *
 * The glazing is only the top two thirds. Below it runs a solid concrete
 * parapet, and the glass carries on round the corner across the right-hand part
 * of the end wall.
 *
 * Coordinates, in metres:
 *   x  along the balcony. -2.6 is the end wall you face, +2.6 is the open door.
 *   y  up from the deck. 0 is the floor.
 *   z  across the balcony. +1.0 is the house wall (screen left), -1.0 is the
 *      glazing (screen right).
 */

export const ROOM = {
  length: 5.2,      // x
  depth: 2.0,       // z
  height: 2.45,     // y
  halfL: 2.6,
  halfD: 1.0,
  glazingZ: -0.98,
  wallZ: 0.98,
  endX: -2.6,
  parapet: 0.62,    // concrete below, glass above
  endGlassFrom: -0.30,  // the end wall is glazed from here across to the right
};

/* The teal wire shelf stands against the end wall, facing back down the balcony.
   Its tiers run across z, so plants on it are spread left to right on screen. */
export const SHELF = {
  x: -2.28,
  z: 0.08,          // along the end wall, toward the glazed corner
  width: 1.12,      // across z
  depth: 0.34,      // along x
  tiers: [0.30, 0.72, 1.14],
};

/* Big floor pots in a row against the house wall, on the left. Nearest the door
   are the two new Takalan Herkku raspberries, then Maurin, then the two tomatoes
   deepest in, which is the order they stand in on the balcony. */
const POT_ROW_Z = 0.62;

/* plant id -> where it lives. `kind` drives which pot mesh is used and how big
   the billboard is allowed to be. */
export const PLACEMENT = {
  'rasp-takala-2': { kind: 'floor', x: 0.60,  y: 0, z: POT_ROW_Z },
  'rasp-takala-1': { kind: 'floor', x: 0.00,  y: 0, z: POT_ROW_Z },
  'rasp-maurin':   { kind: 'floor', x: -0.60, y: 0, z: POT_ROW_Z },
  'tomato-2':      { kind: 'floor', x: -1.20, y: 0, z: POT_ROW_Z },
  'tomato-1':      { kind: 'floor', x: -1.80, y: 0, z: POT_ROW_Z },

  'parsley-1':     { kind: 'shelf', x: SHELF.x, y: SHELF.tiers[0], z: SHELF.z - 0.36 },
  'parsley-2':     { kind: 'shelf', x: SHELF.x, y: SHELF.tiers[0], z: SHELF.z },
  'basil-1':       { kind: 'shelf', x: SHELF.x, y: SHELF.tiers[1], z: SHELF.z - 0.36 },
  'basil-2':       { kind: 'shelf', x: SHELF.x, y: SHELF.tiers[1], z: SHELF.z },
  'mint':          { kind: 'shelf', x: SHELF.x, y: SHELF.tiers[1], z: SHELF.z + 0.36 },
  'chilli-1':      { kind: 'shelf', x: SHELF.x, y: SHELF.tiers[2], z: SHELF.z - 0.24 },
  'chilli-2':      { kind: 'shelf', x: SHELF.x, y: SHELF.tiers[2], z: SHELF.z + 0.14 },

  /* The ivy used to hang on the end wall above the shelf. It came indoors for
     the winter, so the balcony wall is empty now. */
};

/* Indoor plants are not on the balcony, so they are not in the balcony. Putting
   the monstera behind a door pane sounded good on paper and looked like a ghost
   standing between the camera and the garden. It is reached from the Kasvit
   sheet instead, which is also the keyboard route to every other plant. */
export const inScene = (plant) => (plant.area || 'balcony') !== 'indoor';

/* Anything in garden-data.js that nobody placed still has to be reachable, so it
   goes in a row on the deck by the door rather than vanishing. */
const OVERFLOW = { kind: 'floor', y: 0, z: 0.15, x0: 2.05, step: -0.5 };

export function slotFor(plantId, overflowIndex = 0) {
  const fixed = PLACEMENT[plantId];
  if (fixed) return { ...fixed, id: plantId, overflow: false };
  return {
    id: plantId,
    kind: OVERFLOW.kind,
    x: OVERFLOW.x0 + overflowIndex * OVERFLOW.step,
    y: OVERFLOW.y,
    z: OVERFLOW.z,
    overflow: true,
  };
}

/* Slots for a whole plant list, assigning overflow positions in list order. */
export function slotsFor(plants) {
  let n = 0;
  return plants.map((p) => slotFor(p.id, PLACEMENT[p.id] ? 0 : n++));
}

/* Pot radius by slot kind, in metres. Also the click target radius. */
export const POT_SIZE = {
  floor: { r: 0.20, h: 0.26 },
  shelf: { r: 0.075, h: 0.10 },
  wall: { r: 0.09, h: 0.11 },
};

/* ---------- what floats above the pot ---------- */

/* Derives the scene's read of one plant from the same data the calendar uses.
 *
 * `plantTasks` is today's task list for THIS plant, the `tasks` array of its
 * group in buildTasks output. `doneKeys` is doneLog[today].
 *
 *   water: 'none'    nothing due today
 *          'due'     a watering task today, not ticked
 *          'overdue' due today and the interval has already been missed
 *          'done'    ticked today
 *   tone:  the AI health tone, or null when the model has not read this plant
 *   droop: how far the billboard leans, 0 upright to 1 wilting
 */
export function markerFor(plant, plantTasks, doneKeys) {
  const list = plantTasks || [];
  const key = 'w|' + plant.id;
  const task = list.find((t) => t.key === key);
  const done = (doneKeys || []).includes(key);
  const tone = plant.health ? plant.health.tone : null;

  let water = 'none';
  if (done) water = 'done';
  else if (task) water = /overdue/i.test(task.what || '') ? 'overdue' : 'due';

  const droop = water === 'overdue' ? 1 : water === 'due' ? 0.35 : 0;
  const pending = list.filter((t) => !(doneKeys || []).includes(t.key)).length;
  return { water, tone, droop, taskCount: list.length, pending };
}

/* The colour of the ring on the deck under a pot. Null means draw no ring:
   an unread plant should not look like a healthy one. */
export const TONE_RING = { good: '#5E9B6B', watch: '#DE9E2E', bad: '#D9472B' };
