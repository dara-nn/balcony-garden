/* Garden data as objects in the balcony.
 *
 * Owns pots, billboards, health rings and the mapping from a
 * click to a plant id. Talks to world.js through its public surface only, and
 * gets everything it draws from layout.js and art.js.
 */

import { PLACEMENT, POT_SIZE, TONE_RING, slotsFor, markerFor, inScene } from './layout.js';
import { billboardFor, svgDataURI } from './art.js';

const POT_CLAY = { floor: 0x24282A, shelf: 0x2C3033, wall: 0x8C6A52 };
const SOIL = 0x3B2E24;

/* Most plants stand on the soil. Trailing ones (ivy) hang from the rim, so their
   drawing is anchored at its top edge instead of its bottom. */
const planeY = (soilY, art, scale = 1) =>
  art.anchor === 'top' ? soilY - (art.h * scale) / 2 + 0.02 : soilY + (art.h * scale) / 2 - 0.01;

/* Two tomatoes from one drawing would be identical twins. A stable hash of the
   plant id gives each pot its own height and its own way round, so the row reads
   as five plants rather than one plant copied five times. */
function variantOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return { scale: 0.90 + ((h >>> 3) % 21) / 100, flip: (h & 1) ? -1 : 1 };
}

/* A tapered pot with a rolled rim and a disc of soil, in the chunky proportions
   the clay direction asks for. */
function makePot(THREE, clay, kind) {
  const { r, h } = POT_SIZE[kind];
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.74, h, 20), clay(POT_CLAY[kind]));
  body.position.y = h / 2;
  body.castShadow = true; body.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, r * 0.075, 6, 20), clay(POT_CLAY[kind]));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h - r * 0.03;
  rim.castShadow = true;
  const soil = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 20), clay(SOIL));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = h - r * 0.05;
  g.add(body, rim, soil);
  g.userData.soilY = h - r * 0.05;
  return g;
}

export function createPlants(world) {
  const { THREE, room, clay, requestRender } = world;
  const loader = new THREE.TextureLoader();
  const group = new THREE.Group();
  room.add(group);

  const nodes = new Map();     // plant id -> { root, pot, plane, ring, slot, art, v }
  const billboards = [];

  /* Billboards turn to face the camera on the Y axis only, so they stay standing
     in their pots instead of tipping over as you orbit. Done in preRender, which
     only runs on frames that are actually drawn. */
  world.onPreRender((camera) => {
    for (const b of billboards) {
      const dx = camera.position.x - b.parent.position.x - b.position.x;
      const dz = camera.position.z - b.parent.position.z - b.position.z;
      b.rotation.y = Math.atan2(dx, dz);
    }
  });

  function build(all) {
    // wipe and rebuild: the plant list only changes on a seed bump, so this is rare
    for (const n of nodes.values()) group.remove(n.root);
    nodes.clear(); billboards.length = 0;
    world.clearPickables();

    const plants = all.filter(inScene);
    const slots = slotsFor(plants);
    plants.forEach((p, i) => {
      const slot = slots[i];
      const root = new THREE.Group();
      root.position.set(slot.x, slot.y, slot.z);
      root.userData.pickId = p.id;

      const pot = makePot(THREE, clay, slot.kind);
      root.add(pot);

      /* Wall pots hang off a bracket rather than floating. */
      if (slot.kind === 'wall') {
        const bracket = new THREE.Mesh(world.roundedSlab(0.14, 0.02, 0.16, 0.008), clay(0x2E6E73));
        bracket.position.set(0, -0.012, 0.02);
        root.add(bracket);
      }

      const art = billboardFor(p.species, p.stage);
      const v = variantOf(p.id);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(art.w * v.scale, art.h * v.scale),
        new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: true }));
      plane.scale.x = v.flip;
      plane.position.y = planeY(pot.userData.soilY, art, v.scale);
      plane.castShadow = true;
      loader.load(svgDataURI(art.svg), (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        plane.material.map = tex;
        plane.material.needsUpdate = true;
        requestRender();
      });
      root.add(plane);
      billboards.push(plane);

      /* Health ring on the ground. Hidden until the model has read the plant. */
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(POT_SIZE[slot.kind].r * 1.15, POT_SIZE[slot.kind].r * 1.45, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.004;
      ring.visible = false;
      root.add(ring);

      world.registerPickable(root);
      group.add(root);
      nodes.set(p.id, { root, pot, plane, ring, slot, art, v });
    });
    requestRender();
  }

  /* Re-reads state without rebuilding geometry: rings, droop, and the billboard
     when a plant has changed stage. */
  function update(plants, tasksForPlant, doneKeys) {
    plants.forEach((p) => {
      const n = nodes.get(p.id);
      if (!n) return;
      const m = markerFor(p, tasksForPlant(p.id), doneKeys);

      const wantArt = billboardFor(p.species, p.stage);
      if (wantArt !== n.art) {
        n.art = wantArt;
        n.plane.geometry.dispose();
        n.plane.geometry = new THREE.PlaneGeometry(wantArt.w * n.v.scale, wantArt.h * n.v.scale);
        n.plane.position.y = planeY(n.pot.userData.soilY, wantArt, n.v.scale);
        loader.load(svgDataURI(wantArt.svg), (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          n.plane.material.map = tex;
          n.plane.material.needsUpdate = true;
          requestRender();
        });
      }

      /* Droop: a thirsty plant leans. Tilt about the base, not the centre, or it
         sinks into the pot. */
      const lean = m.droop * 0.18;
      n.plane.rotation.z = lean;
      n.plane.position.x = Math.sin(lean) * n.art.h * 0.22;

      const ringColor = TONE_RING[m.tone];
      n.toneColor = ringColor || null;
      if (p.id !== selected) {
        n.ring.visible = !!ringColor;
        if (ringColor) n.ring.material.color.set(ringColor);
      }
    });

    requestRender();
  }

  /* Lift the selected pot slightly and glow its ring, so the scene shows what the
     open panel is about. */
  let selected = null;
  function select(plantId) {
    if (selected && nodes.has(selected)) {
      const prev = nodes.get(selected);
      prev.root.position.y = prev.slot.y;
      prev.ring.material.opacity = 0.75;
      /* put the health ring back, or hide it again if there was never one */
      prev.ring.visible = !!prev.toneColor;
      if (prev.toneColor) prev.ring.material.color.set(prev.toneColor);
    }
    selected = plantId;
    if (!plantId || !nodes.has(plantId)) { requestRender(); return; }
    const n = nodes.get(plantId);
    n.root.position.y = n.slot.y + 0.02;
    /* Always ring the selected pot, health read or not, so the scene says which
       plant the open panel belongs to. */
    n.ring.visible = true;
    n.ring.material.opacity = 1;
    n.ring.material.color.set(n.toneColor || 0xF6F7F3);
    requestRender();
  }

  /* Show the selected plant without hijacking the view: the angle you set up is
     kept exactly, and the camera zooms in and slides sideways so the plant sits
     centred in the space beside the panel. Distance scales with the plant, so a
     chilli seedling is not framed from as far back as a two-metre tomato. */
  function focus(plantId) {
    const n = nodes.get(plantId);
    if (!n) return;
    const h = n.art.h * n.v.scale;
    const small = n.slot.kind === 'shelf' || n.slot.kind === 'wall';
    const dist = small ? 1.25 : Math.max(2.3, h * 1.5);
    world.panTo(new THREE.Vector3(n.slot.x, n.slot.y + h * 0.45 + 0.12, n.slot.z), dist);
  }

  const has = (id) => nodes.has(id);
  const anchorOf = (id) => {
    const n = nodes.get(id);
    if (!n) return null;
    return new THREE.Vector3(n.slot.x, n.slot.y + n.pot.userData.soilY + n.art.h * n.v.scale + 0.06, n.slot.z);
  };

  return { build, update, select, focus, has, anchorOf, placed: PLACEMENT };
}
