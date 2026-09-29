/* The balcony, as a soft clay diorama.
 *
 * Knows nothing about garden data. It builds the room, owns the camera and the
 * lights, and exposes: add/remove objects, pick an object under a pointer, set
 * the weather mood, and request a frame.
 *
 * Rendering is on demand. Nothing animates unless something asked it to, so the
 * page costs no battery while you read a panel.
 */

import * as THREE from '../vendor/three.module.min.js';
import { ROOM, SHELF } from './layout.js';

/* ---------- clay materials ---------- */
const clay = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

/* Rounded slab. Extruding a rounded rectangle with a bevel gives real rounded
   edges, which is what makes the whole thing read as clay rather than as boxes. */
function roundedSlab(w, h, d, r = 0.03) {
  const bevel = Math.min(r, d * 0.45);
  const shape = new THREE.Shape();
  const x = -w / 2 + r, y = -h / 2 + r, W = w - r * 2, H = h - r * 2;
  shape.moveTo(x, y - r);
  shape.lineTo(x + W, y - r);
  shape.quadraticCurveTo(x + W + r, y - r, x + W + r, y);
  shape.lineTo(x + W + r, y + H);
  shape.quadraticCurveTo(x + W + r, y + H + r, x + W, y + H + r);
  shape.lineTo(x, y + H + r);
  shape.quadraticCurveTo(x - r, y + H + r, x - r, y + H);
  shape.lineTo(x - r, y);
  shape.quadraticCurveTo(x - r, y - r, x, y - r);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 3, curveSegments: 6,
  });
  g.translate(0, 0, -(d - bevel * 2) / 2 - bevel);
  return g;
}

/* ---------- procedural textures ---------- */
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  /* Without this the canvas is read as linear data and every surface comes back
     muddy: the orange wall turns brown and the deck turns grey. */
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}

/* The deck is IKEA-style parquet tiles: squares of four slats, alternating grain. */
const deckTexture = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#7A4A2B'; g.fillRect(0, 0, w, h);
  const half = w / 2;
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const horiz = (tx + ty) % 2 === 0;
    for (let i = 0; i < 4; i++) {
      const shade = ['#8B5730', '#7E4C29', '#95603A', '#743F24'][i];
      g.fillStyle = shade;
      if (horiz) g.fillRect(tx * half + 2, ty * half + 2 + i * (half - 4) / 4, half - 4, (half - 4) / 4 - 1.5);
      else g.fillRect(tx * half + 2 + i * (half - 4) / 4, ty * half + 2, (half - 4) / 4 - 1.5, half - 4);
    }
  }
}, [13, 5]);   // real tiles are ~30 cm, so the deck reads at the right scale

/* Render: flat colour plus a fine speckle so it is not a dead fill. The house
   wall is white; the end wall keeps the orange of the photos. */
const renderTexture = (base, lightSpeck, darkSpeck) => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = Math.random() > 0.5 ? lightSpeck : darkSpeck;
    g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}, [6, 3]);
const whiteRender = () => renderTexture('#EDE9E1', 'rgba(255,255,255,.5)', 'rgba(120,112,100,.10)');
const stuccoTexture = () => renderTexture('#D4763C', 'rgba(255,232,200,.13)', 'rgba(110,52,20,.10)');

/* ---------- the world ---------- */
export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 60);

  /* Distance haze, so the backdrop sits behind the plants instead of competing. */
  scene.fog = new THREE.Fog(0xE8EDE6, 7, 22);

  /* --- lights --- */
  const hemi = new THREE.HemisphereLight(0xEDF5FF, 0xD3A277, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xFFF6E4, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -3.6; sun.shadow.camera.right = 3.6;
  sun.shadow.camera.top = 3.2; sun.shadow.camera.bottom = -1.2;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 16;
  sun.shadow.bias = -0.0012;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  /* Warm bounce off the orange wall, which is what ties the palette together. */
  const bounce = new THREE.DirectionalLight(0xE08A3C, 0.30);
  bounce.position.set(-2, 1.2, 3);
  scene.add(bounce);
  /* The wall lamp. Off in daylight, the key light after dark. */
  const lamp = new THREE.PointLight(0xFFD9A0, 0, 3.4, 2);
  lamp.position.set(ROOM.endX + 0.10, 1.94, SHELF.z);
  scene.add(lamp);

  /* --- room --- */
  const room = new THREE.Group();
  scene.add(room);

  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.length, ROOM.depth),
    clay(0xFFFFFF, { map: deckTexture() }));
  deck.rotation.x = -Math.PI / 2;
  deck.receiveShadow = true;
  room.add(deck);

  /* Walls are single-sided and face inward, so whichever one you orbit behind
     simply disappears. No clipping logic, no camera cage. */
  /* DoubleSide so a wall can still be drawn when you orbit behind it: with
     back-face culling the choice below would not be a choice. */
  const wallMat = clay(0xFFFFFF, { map: whiteRender(), side: THREE.DoubleSide });
  const endWallMat = clay(0xFFFFFF, { map: stuccoTexture(), side: THREE.FrontSide });

  /* --- the long orange house wall, on the left as you look in, with the flat's
     patio door cut into it. The wall is built as four pieces around the opening
     rather than one plane with a window laid over it: a pane floating in front
     of an unbroken wall reads as a separate panel standing beside it. --- */
  /* The glass stops just above the pot rims (pots are 0.26 tall), so the bottom
     rail sits behind the row rather than cutting across the plants, and there is
     rendered wall below it as on the real balcony. */
  /* Its length roughly matches the pot row: the outer pots sit at x -1.80 and
     0.60 with a 0.20 radius, so the jambs land just outside them. */
  const WIN = { x0: -2.02, x1: 0.82, y0: 0.52, y1: 2.24 };
  const houseWindow = new THREE.Group();

  /* The glass sits just behind the wall plane and is cut oversize, so its edges
     hide behind the surrounding wall rather than meeting it exactly.
     The frame must OVERLAP the wall plane, not stop at it. roundedSlab extrudes
     with a bevel and does not centre on z, so aiming for flush leaves a
     millimetre gap, and parallax turns that into a bright sliver of glass
     between frame and render when you sight along the wall. */
  const GZ = ROOM.wallZ + 0.085;   // glass set back, so the opening has depth
  const FRAME_D = 0.035;
  const WZ = ROOM.wallZ + 0.055;   // frame recessed with it
  const GLASS_BLEED = 0.03;
  /* The wall laps a little way into the opening, so wall and frame together
     cover the junction and no sliver of glass can show between them. Closing the
     gap this way keeps the frame slim, rather than deep enough to reach back. */
  const WALL_LAP = 0.02;

  /* The house wall is kept as its own list: it and its window hide together. */
  const shell = [];
  /* Solid slabs, not planes. A zero-thickness wall reads as paper at every edge,
     and gives the recessed window no reveal to sit in. */
  const WALL_T = 0.12;
  const wallPiece = (w, h, x, y) => {
    if (w <= 0.001 || h <= 0.001) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, WALL_T), wallMat);
    m.position.set(x, y, ROOM.wallZ + WALL_T / 2);   // inner face lands on wallZ
    m.receiveShadow = true;
    room.add(m);
    shell.push(m);
  };
  const ox0 = WIN.x0 + WALL_LAP, ox1 = WIN.x1 - WALL_LAP;
  const oy0 = WIN.y0 + WALL_LAP, oy1 = WIN.y1 - WALL_LAP;
  const leftW = ox0 + ROOM.halfL;                    // wall beside the opening, far end
  const rightW = ROOM.halfL - ox1;                   // wall beside the opening, door end
  wallPiece(leftW, ROOM.height, -ROOM.halfL + leftW / 2, ROOM.height / 2);
  wallPiece(rightW, ROOM.height, ROOM.halfL - rightW / 2, ROOM.height / 2);
  wallPiece(ox1 - ox0, ROOM.height - oy1, (ox0 + ox1) / 2, (oy1 + ROOM.height) / 2);
  wallPiece(ox1 - ox0, oy0, (ox0 + ox1) / 2, oy0 / 2);
  const winW = WIN.x1 - WIN.x0, winH = WIN.y1 - WIN.y0;
  const winCX = (WIN.x0 + WIN.x1) / 2, winCY = (WIN.y0 + WIN.y1) / 2;

  /* What sells a window is the reflection, not the tint. A flat gradient reads as
     a painted panel; this puts the balcony's own view back at you the way the
     photos show it: sky above, a smear of reflected treeline, and hard diagonal
     highlights raking across the glass. */
  const paneTex = canvasTex(256, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#CBDBE0');
    grad.addColorStop(0.40, '#AFC4C6');
    grad.addColorStop(0.70, '#6E7C73');
    grad.addColorStop(1, '#4C574F');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);

    // reflected treeline, low and soft. Kept faint: a reflection, not a stain.
    g.globalAlpha = 0.12;
    ['#7A8C62', '#6B7E58', '#8B9663'].forEach((c, i) => {
      g.fillStyle = c;
      for (let k = 0; k < 7; k++) {
        g.beginPath();
        g.arc(10 + k * 40 + i * 13, h * 0.60 + ((k * 19) % 20), 24 + ((k * 11) % 15), 0, Math.PI * 2);
        g.fill();
      }
    });

    // raking highlights: the giveaway that a surface is glass
    g.fillStyle = '#FFFFFF';
    g.globalAlpha = 0.10;
    g.beginPath(); g.moveTo(-50, h); g.lineTo(w * 0.42, 0); g.lineTo(w * 0.60, 0); g.lineTo(w * 0.10, h); g.closePath(); g.fill();
    g.globalAlpha = 0.055;
    g.beginPath(); g.moveTo(w * 0.56, h); g.lineTo(w * 0.94, 0); g.lineTo(w * 1.06, 0); g.lineTo(w * 0.70, h); g.closePath(); g.fill();
    g.globalAlpha = 1;
  });
  const winPanes = [];
  const paneMat = () => {
    /* Real glass: transparent, so you see through it from either side, with the
       reflection only tinting what is behind. DoubleSide because seen from inside
       the flat a single-sided pane is back-facing and culls to an empty hole.
       depthWrite off so the pane never hides the plants behind it. */
    const m = new THREE.MeshBasicMaterial({
      map: paneTex, side: THREE.DoubleSide,
      transparent: true, opacity: 0.30, depthWrite: false });
    winPanes.push(m);
    return m;
  };
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(winW + GLASS_BLEED, winH + GLASS_BLEED), paneMat());
  pane.position.set(winCX, winCY, GZ);
  pane.rotation.y = Math.PI;
  houseWindow.add(pane);

  const winFrame = clay(0x474D4F);
  const bar = (w, h, x, y, z) => {
    const m = new THREE.Mesh(roundedSlab(w, h, FRAME_D, 0.012), winFrame);
    m.position.set(x, y, z);
    houseWindow.add(m);
    return m;
  };
  // one clear pane: jambs, head and foot only, no mullions across the glass
  bar(0.055, winH, WIN.x0, winCY, WZ);             // left jamb
  bar(0.055, winH, WIN.x1, winCY, WZ);             // right jamb
  bar(winW, 0.055, winCX, WIN.y1, WZ);             // head
  bar(winW, 0.05, winCX, WIN.y0, WZ);              // foot

  room.add(houseWindow);

  /* The wall you face carries the shelf, the ivy and the lamp. Its right-hand
     part is glazed, continuing the glass round the corner, so it is built as
     two solid pieces with the pane dropped into the gap. */
  const gapW = ROOM.endGlassFrom - (-ROOM.halfD);          // width of the glazed part
  const solidW = ROOM.halfD - ROOM.endGlassFrom;           // width of the full-height part
  const endSolid = new THREE.Mesh(new THREE.PlaneGeometry(solidW, ROOM.height), endWallMat);
  endSolid.position.set(ROOM.endX, ROOM.height / 2, ROOM.endGlassFrom + solidW / 2);
  endSolid.rotation.y = Math.PI / 2;
  endSolid.receiveShadow = true;
  room.add(endSolid);

  const endParapet = new THREE.Mesh(new THREE.PlaneGeometry(gapW, ROOM.parapet), endWallMat);
  endParapet.position.set(ROOM.endX, ROOM.parapet / 2, -ROOM.halfD + gapW / 2);
  endParapet.rotation.y = Math.PI / 2;
  endParapet.receiveShadow = true;
  room.add(endParapet);
  const endWallPieces = [endSolid, endParapet];

  /* No roof: the balcony is open above in the model, which keeps every angle
     readable without a lid to duck under. */

  /* The whole glazed side: concrete parapet, sill, panes and frames, in one
     group so it can step aside together when see-through is on. */
  const glazing = new THREE.Group();

  const concrete = clay(0xC9C0AE);
  const parapet = new THREE.Mesh(roundedSlab(ROOM.length, ROOM.parapet, 0.13, 0.02), concrete);
  parapet.position.set(0, ROOM.parapet / 2, ROOM.glazingZ + 0.065);
  parapet.receiveShadow = true; parapet.castShadow = true;
  glazing.add(parapet);
  const sill = new THREE.Mesh(roundedSlab(ROOM.length, 0.04, 0.20, 0.015), concrete);
  sill.position.set(0, ROOM.parapet + 0.02, ROOM.glazingZ + 0.09);
  sill.castShadow = true;
  glazing.add(sill);
  const glassH = ROOM.height - ROOM.parapet;
  const glassMidY = ROOM.parapet + glassH / 2;
  const glassTex = canvasTex(8, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#BCD6DE');
    grad.addColorStop(0.55, '#DCE9EA');
    grad.addColorStop(1, '#EFF2EC');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  const glassMats = [];
  const glassMat = () => {
    const m = new THREE.MeshBasicMaterial({
      map: glassTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    glassMats.push(m);
    return m;
  };

  const glass = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.length, glassH), glassMat());
  glass.position.set(0, glassMidY, ROOM.glazingZ);
  glazing.add(glass);

  // the return across the right-hand part of the end wall
  const endGlass = new THREE.Mesh(new THREE.PlaneGeometry(gapW, glassH), glassMat());
  endGlass.position.set(ROOM.endX, glassMidY, -ROOM.halfD + gapW / 2);
  endGlass.rotation.y = Math.PI / 2;
  glazing.add(endGlass);

  const frameMat = clay(0x3A4042);
  const post = (x, z) => {
    const m = new THREE.Mesh(roundedSlab(0.04, glassH, 0.04, 0.01), frameMat);
    m.position.set(x, glassMidY, z);
    glazing.add(m);
  };
  for (let i = 0; i <= 4; i++) post(-ROOM.halfL + i * (ROOM.length / 4), ROOM.glazingZ);
  post(ROOM.endX, ROOM.endGlassFrom);
  [ROOM.parapet + 0.03, ROOM.height].forEach((y) => {
    const rail = new THREE.Mesh(roundedSlab(ROOM.length, 0.045, 0.045, 0.012), frameMat);
    rail.position.set(0, y, ROOM.glazingZ);
    glazing.add(rail);
    const endRail = new THREE.Mesh(roundedSlab(gapW, 0.045, 0.045, 0.012), frameMat);
    endRail.rotation.y = Math.PI / 2;
    endRail.position.set(ROOM.endX, y, -ROOM.halfD + gapW / 2);
    glazing.add(endRail);
  });
  room.add(glazing);

  /* --- the teal wire shelf, against the end wall, tiers running across z --- */
  const shelfGroup = new THREE.Group();
  const tealMat = clay(0x2E6E73);
  SHELF.tiers.forEach((y) => {
    const board = new THREE.Mesh(roundedSlab(SHELF.depth, 0.03, SHELF.width, 0.012), tealMat);
    board.position.set(0, y, 0);
    board.castShadow = true; board.receiveShadow = true;
    shelfGroup.add(board);
  });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.32, 8), tealMat);
    leg.position.set(sx * (SHELF.depth / 2 - 0.03), 0.66, sz * (SHELF.width / 2 - 0.03));
    leg.castShadow = true;
    shelfGroup.add(leg);
  });
  shelfGroup.position.set(SHELF.x, 0, SHELF.z);
  room.add(shelfGroup);

  /* --- wall lamp: hangs above the shelf, just behind the ivy --- */
  const lampGroup = new THREE.Group();
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshBasicMaterial({ color: 0xF6F1E2 }));
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.44, 6), clay(0xEFEFE8));
  cord.position.y = 0.25;
  lampGroup.add(bulb, cord);
  lampGroup.position.set(ROOM.endX + 0.10, 2.00, SHELF.z);
  room.add(lampGroup);

  /* --- bistro table and two chairs, along the house wall on the right --- */
  const furniture = new THREE.Group();
  const metal = clay(0x2A2E2C);
  const cushion = clay(0x33383B);
  const tableTop = clay(0x1F2426);
  /* Viewed from outside the glass the table and chairs stand between you and the
     plants, so they fade out rather than blocking the thing you came to look at. */
  const furnitureMats = [metal, cushion, tableTop];
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 24), tableTop);
  top.position.y = 0.7; top.castShadow = true;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 10), metal);
  stem.position.y = 0.35;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.025, 16), metal);
  foot.position.y = 0.012;
  furniture.add(top, stem, foot);
  /* the two chairs sit either side of the table, along the glass */
  [[-0.62, 0.06, 1.55], [0.62, 0.02, -1.55]].forEach(([cx, cz, rot]) => {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(roundedSlab(0.44, 0.09, 0.44, 0.045), cushion);
    seat.position.y = 0.45; seat.castShadow = true;
    const back = new THREE.Mesh(roundedSlab(0.44, 0.5, 0.09, 0.045), cushion);
    back.position.set(0, 0.72, -0.19); back.castShadow = true;
    chair.add(seat, back);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.45, 8), metal);
      leg.position.set(sx * 0.17, 0.225, sz * 0.17);
      chair.add(leg);
    });
    chair.position.set(cx, 0, cz);
    chair.rotation.y = rot;
    furniture.add(chair);
  });
  furniture.position.set(-0.15, 0, -0.52);
  room.add(furniture);

  /* --- watering can, by the shelf --- */
  const can = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.085, 0.19, 14), clay(0xF2EFE4));
  body.position.y = 0.095; body.castShadow = true;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.24, 8), clay(0xF2EFE4));
  spout.position.set(0.11, 0.15, 0); spout.rotation.z = -0.7;
  can.add(body, spout);
  can.position.set(-2.05, 0, -0.62);
  room.add(can);

  /* ---------- camera rig ---------- */
  /* Standing in the doorway: the pot row down the left, the table along the glass
     on the right, the shelf ahead. */
  const HOME = { a: -0.10, p: 1.19, r: 6.1, t: new THREE.Vector3(-0.60, 1.02, 0.05) };
  const cam = { a: HOME.a, p: HOME.p, r: HOME.r, t: HOME.t.clone() };
  /* Azimuth is deliberately unclamped: every wall culls itself from behind, so a
     full turn stays legible. Only height and distance are bounded, to keep the
     camera out of the floor and off the plants' faces. */
  const LIMIT = { p: [0.30, 1.50], r: [1.5, 8.0] };
  const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

  function applyCamera() {
    cam.p = clamp(cam.p, LIMIT.p); cam.r = clamp(cam.r, LIMIT.r);
    const sp = Math.sin(cam.p);
    camera.position.set(
      cam.t.x + cam.r * sp * Math.cos(cam.a),
      cam.t.y + cam.r * Math.cos(cam.p),
      cam.t.z + cam.r * sp * Math.sin(cam.a));
    camera.lookAt(cam.t);
    applyWallSides();
    /* Daylight comes in through the glazing, so the sun sits out beyond it. */
    sun.position.set(cam.t.x + 1.2, 5.4, -5.2);
    sun.target.position.copy(cam.t);
  }

  /* Camera easing. The only thing that runs a continuous loop, and it stops. */
  let glide = null;
  /* With azimuth free to wrap, always turn the short way round rather than
     spinning most of a circle to reach an angle that was just behind you. */
  function shortestTurn(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return from + d;
  }
  function flyTo(target, radius, azimuth, polar, ms = 620) {
    glide = {
      t0: performance.now(), ms,
      from: { a: cam.a, p: cam.p, r: cam.r, t: cam.t.clone() },
      to: {
        a: azimuth === undefined ? cam.a : shortestTurn(cam.a, azimuth),
        p: polar === undefined ? cam.p : clamp(polar, LIMIT.p),
        r: clamp(radius === undefined ? cam.r : radius, LIMIT.r),
        t: target.clone(),
      },
    };
    requestRender();
  }
  const home = () => flyTo(HOME.t, HOME.r, HOME.a, HOME.p);

  /* ---------- what walls do when you rotate ----------
     Off (the default): the room stays whole however you turn, so the view never
     rearranges itself under you. On: whichever surface you have moved behind
     steps aside so you can see in, and the window goes with the wall it is cut
     into. Nothing here changes the default view; it only decides what happens
     once you orbit past a surface. */
  let seeThrough = false;
  let ghosted = null;
  function applyWallSides() {
    const p = camera.position;
    const gone = (outside) => seeThrough && outside;

    const hideHouse = gone(p.z > ROOM.wallZ);
    shell.forEach((m) => { m.visible = !hideHouse; });
    houseWindow.visible = !hideHouse;

    const hideGlazing = gone(p.z < ROOM.glazingZ);
    glazing.visible = !hideGlazing;

    const hideEnd = gone(p.x < ROOM.endX);
    endWallPieces.forEach((m) => { m.visible = !hideEnd; });


    /* The table and chairs stand between the glass and the pot row, so they fade
       with the glass rather than replacing it as the thing in the way. */
    const op = hideGlazing ? 0.18 : 1;
    if (ghosted !== op) {
      ghosted = op;
      furnitureMats.forEach((m) => {
        m.opacity = op;
        m.transparent = op < 1;
        m.depthWrite = op >= 1;
        m.needsUpdate = true;
      });
      furniture.traverse((o) => { if (o.isMesh) o.castShadow = op >= 1; });
    }
  }
  function setSeeThrough(on) {
    seeThrough = !!on;
    applyWallSides();
    requestRender();
  }

  /* Bring a point into view without taking the user's angle away: the azimuth and
     height you set up are kept exactly, while the camera moves in to `radius` and
     the look-at slides sideways so the point ends up centred in the part of the
     screen the panel is not covering.
     `ndcX` is where it should sit across the viewport, -1 left to +1 right. */
  function panTo(point, radius, ndcX = 0.34) {   // sheet sits left, so bias right
    const r = clamp(radius === undefined ? cam.r : radius, LIMIT.r);
    // on a narrow screen the sheet covers almost everything, so just centre it
    const wanted = innerWidth >= 900 ? ndcX : 0;
    const tanHalfH = Math.tan((camera.fov / 2) * Math.PI / 180) * camera.aspect;
    // camera-right in world space, derived from the current azimuth
    const right = new THREE.Vector3(Math.sin(cam.a), 0, -Math.cos(cam.a));
    const sp = Math.sin(clamp(cam.p, LIMIT.p));
    const off = new THREE.Vector3(sp * Math.cos(cam.a), Math.cos(clamp(cam.p, LIMIT.p)), sp * Math.sin(cam.a));

    /* Sliding the look-at sideways slides the camera with it, and the balcony is
       only 2 m deep: at full offset the camera ends up inside a wall looking at
       render. Back the slide off until the camera is somewhere you could stand. */
    /* The room is only 2 m across, so the camera has very little room to slide
       before it is standing in a wall. Judge the candidate by where the CAMERA
       ends up, against the actual depth, not a generous guess. */
    const inside = (t) => {
      const c = t.clone().addScaledVector(off, r);
      return Math.abs(c.z) <= ROOM.halfD - 0.12 && c.x > ROOM.endX + 0.3;
    };
    let target = point.clone();
    for (let k = 1; k > 0.05; k /= 2) {
      const t = point.clone().addScaledVector(right, -wanted * k * r * tanHalfH);
      if (inside(t)) { target = t; break; }
    }
    flyTo(target, r, cam.a, cam.p, 520);
  }

  /* ---------- render on demand ---------- */
  let dirty = true, running = false;
  const spinners = new Set();          // things that need continuous frames
  const preRender = new Set();         // run on every drawn frame, before render
  function requestRender() {
    dirty = true;
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  const addSpinner = (fn) => { spinners.add(fn); requestRender(); };
  const removeSpinner = (fn) => { spinners.delete(fn); };
  const onPreRender = (fn) => { preRender.add(fn); };

  function frame(now) {
    running = false;
    if (glide) {
      const k = Math.min(1, (now - glide.t0) / glide.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // easeInOutCubic
      cam.a = glide.from.a + (glide.to.a - glide.from.a) * e;
      cam.p = glide.from.p + (glide.to.p - glide.from.p) * e;
      cam.r = glide.from.r + (glide.to.r - glide.from.r) * e;
      cam.t.lerpVectors(glide.from.t, glide.to.t, e);
      if (k >= 1) glide = null;
      dirty = true;
    }
    if (spinners.size) { spinners.forEach((fn) => fn(now)); dirty = true; }
    if (dirty) {
      applyCamera();
      preRender.forEach((fn) => fn(camera, now));
      renderer.render(scene, camera);
      dirty = false;
    }
    if (glide || spinners.size || dirty) { running = true; requestAnimationFrame(frame); }
  }

  /* ---------- resize ---------- */
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  new ResizeObserver(resize).observe(canvas);

  /* ---------- pointer: orbit, zoom, pick ---------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickables = [];
  let onPick = () => {};

  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pickId) o = o.parent;
      if (o) return o.userData.pickId;
    }
    return null;
  }

  let drag = null, moved = 0;
  const pointers = new Map();
  let pinchStart = 0, pinchR = 0;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { drag = { x: e.clientX, y: e.clientY }; moved = 0; }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      pinchR = cam.r;
      drag = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) { cam.r = clamp(pinchR * (pinchStart / d), LIMIT.r); glide = null; requestRender(); }
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    moved += Math.abs(dx) + Math.abs(dy);
    cam.a -= dx * 0.006;
    cam.p -= dy * 0.005;
    drag = { x: e.clientX, y: e.clientY };
    glide = null;
    requestRender();
  });
  function endPointer(e) {
    if (pointers.size === 1 && drag && moved < 6) {
      const id = pickAt(e.clientX, e.clientY);
      onPick(id);
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (!pointers.size) drag = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; pinchStart = 0; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.r = clamp(cam.r * (1 + Math.sign(e.deltaY) * 0.12), LIMIT.r);
    glide = null;
    requestRender();
  }, { passive: false });

  /* ---------- weather and theme mood ---------- */
  /* The sky is the forecast. Overcast flattens the light and greys the sky; a hot
     day goes warm and hard; a cold night goes blue. */
  function setMood({ wx, dark }) {
    const overcast = wx && wx.pop >= 50;
    const hot = wx && wx.tmax >= 27;
    const cold = wx && wx.tmin <= 4;

    if (dark) {
      /* Dusk, not pitch dark: the plants still have to be readable and tappable,
         so the ambient stays well above what a real night would give. */
      hemi.color.setHex(0x51637C); hemi.groundColor.setHex(0x4A382B); hemi.intensity = 0.85;
      sun.color.setHex(0x8FA6C8); sun.intensity = 0.45;
      bounce.intensity = 0.16;
      lamp.intensity = 2.4;
      // the glass cannot stay daylight-bright once the sun is down
      glassMats.forEach((m) => { m.color.setHex(0x40525C); m.opacity = 0.5; });
      // a lit flat behind the glass: the one warm thing on a dark balcony
      winPanes.forEach((m) => m.color.setHex(0xC98F4E));
      scene.fog.color.setHex(0x1B2420);
      renderer.setClearColor(0x1B2420, 1);
    } else {
      lamp.intensity = 0;
      glassMats.forEach((m) => { m.color.setHex(0xFFFFFF); m.opacity = 0.55; });
      if (overcast) {
        hemi.color.setHex(0xE4EDF2); hemi.groundColor.setHex(0xC6A588); hemi.intensity = 1.35;
        sun.color.setHex(0xF2F6F8); sun.intensity = 0.7;
      } else if (hot) {
        hemi.color.setHex(0xFFF4E2); hemi.groundColor.setHex(0xDCA872); hemi.intensity = 1.1;
        sun.color.setHex(0xFFEFCC); sun.intensity = 1.75;
      } else if (cold) {
        hemi.color.setHex(0xE4EFFC); hemi.groundColor.setHex(0xBBA894); hemi.intensity = 1.15;
        sun.color.setHex(0xF0F5FF); sun.intensity = 1.25;
      } else {
        hemi.color.setHex(0xEDF5FF); hemi.groundColor.setHex(0xD3A277); hemi.intensity = 1.15;
        sun.color.setHex(0xFFF6E4); sun.intensity = 1.5;
      }
      bounce.intensity = hot ? 0.42 : 0.3;
      scene.fog.color.setHex(0xE8EDE6);
      renderer.setClearColor(0xE8EDE6, 1);
    }
    requestRender();
  }

  resize();

  return {
    THREE, scene, camera, renderer, room,
    requestRender, addSpinner, removeSpinner, onPreRender,
    flyTo, panTo, home, setMood, resize, setSeeThrough,
    seeThrough: () => seeThrough,
    pickAtClient: pickAt,
    /* Where a world point lands on screen, for DOM labels pinned to a pot. */
    project(v3) {
      const p = v3.clone().project(camera);
      const rect = canvas.getBoundingClientRect();
      return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height, behind: p.z > 1 };
    },
    registerPickable: (obj) => pickables.push(obj),
    clearPickables: () => { pickables.length = 0; },
    setPickHandler: (fn) => { onPick = fn; },
    roundedSlab, clay,
    cameraState: cam,
  };
}
