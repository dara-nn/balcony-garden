/* Billboard artwork for the 3D scene.
 *
 * These are NOT the avatar tiles in index.html. Those are 80x80 squares with an
 * opaque background, drawn as icons (the tomato one is a single tomato). Standing
 * one up in a pot looks wrong. These are side elevations on a transparent ground,
 * drawn from the balcony photos, sized in real metres so a chilli seedling is
 * actually smaller than a two-metre tomato.
 *
 * Each entry: { w, h, svg } where w/h are metres of the plane the SVG is drawn on.
 * The SVG's own coordinate space puts the soil line at the bottom edge.
 *
 * Pure module: no DOM, no Three.js. Imported by tests.
 */

const G = {
  dark: '#14402F',
  deep: '#1E4D3B',
  mid: '#2E7D52',
  light: '#6FA97F',
  pale: '#93BFA3',
  stem: '#3F7D4E',
  tomato: '#D9472B',
  orange: '#E08A3C',
  berry: '#B23A5B',
  berryLight: '#C9557A',
  bloom: '#E8C34A',
  white: '#F4F1E8',
  bamboo: '#C9A86A',
  string: '#CFC9BA',
  bulb: '#EFE7D6',
  onion: '#F2F4EE',
};

/* ---------- drawing helpers ---------- */

/* A leaf blade: pointed almond outline with a midrib. Drawn from its base at the
   origin pointing along +x, then rotated into place. Ellipses were what made the
   old drawings read as lollipops on sticks. */
const bladePath = (len, wid) =>
  `M0 0C${len * 0.22} ${-wid} ${len * 0.68} ${-wid * 0.92} ${len} 0`
  + `C${len * 0.68} ${wid * 0.92} ${len * 0.22} ${wid} 0 0Z`;

function leaf(x, y, len, wid, deg, fill, vein) {
  return `<g transform="translate(${x} ${y}) rotate(${deg})">`
    + `<path d="${bladePath(len, wid)}" fill="${fill}"/>`
    + (vein ? `<path d="M${len * 0.06} 0H${len * 0.88}" stroke="${vein}" stroke-width="${Math.max(0.7, wid * 0.13)}" opacity=".38" fill="none" stroke-linecap="round"/>` : '')
    + '</g>';
}

/* A tapering stem: thick at the soil, thin at the growing tip. */
const stalk = (x0, y0, x1, y1, w0, w1, fill) => {
  const dx = x1 - x0, dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;   // unit normal, to give the stem width
  const cx = (x0 + x1) / 2 + nx * L * 0.04, cy = (y0 + y1) / 2 + ny * L * 0.04;
  return `<path d="M${x0 + nx * w0} ${y0 + ny * w0}`
    + `Q${cx + nx * w1} ${cy + ny * w1} ${x1 + nx * w1} ${y1 + ny * w1}`
    + `L${x1 - nx * w1} ${y1 - ny * w1}`
    + `Q${cx - nx * w1} ${cy - ny * w1} ${x0 - nx * w0} ${y0 - ny * w0}Z" fill="${fill}"/>`;
};

/* Tomato leaf: a compound leaf, leaflets in opposed pairs down a drooping rachis
   with a bigger one at the tip. dir -1 points left, +1 right. */
function tomatoLeaf(x, y, len, dir, scale, dark, mid) {
  const tipX = x + len * dir, tipY = y + len * 0.20;   // tomato foliage droops
  let out = `<path d="M${x} ${y}Q${x + len * 0.55 * dir} ${y + len * 0.02} ${tipX} ${tipY}"
    stroke="${G.stem}" stroke-width="${2.1 * scale}" fill="none" stroke-linecap="round"/>`;
  const n = 3;
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 0.65);
    const px = x + (tipX - x) * t;
    const py = y + (tipY - y) * t * t;
    const ll = (23 - i * 3.4) * scale, lw = (8.2 - i * 1.1) * scale;
    out += leaf(px, py, ll, lw, dir > 0 ? -52 : -128, i % 2 ? mid : dark, G.light);
    out += leaf(px, py, ll * 0.92, lw * 0.92, dir > 0 ? 46 : 134, i % 2 ? dark : mid, G.light);
  }
  out += leaf(tipX, tipY, 22 * scale, 8 * scale, dir > 0 ? -8 : 188, dark, G.light);
  return out;
}

/* Raspberry leaf: three broad serrated leaflets off one point. */
function raspLeaf(x, y, size, dir, dark, mid) {
  const a = dir > 0 ? 0 : 180;
  const s = (deg, k, fill) => leaf(x, y, size * k, size * k * 0.52, a + (dir > 0 ? deg : -deg), fill, G.light);
  return `<path d="M${x} ${y}h${6 * dir}" stroke="${G.stem}" stroke-width="1.8" stroke-linecap="round"/>`
    + s(-42, 0.82, dark) + s(4, 1, mid) + s(46, 0.82, dark);
}

/* A blade of grass: chives, spring onion, garlic, young onions. */
const blade = (x, y, h, lean, w, fill) =>
  `<path d="M${x} ${y}q${lean * 0.3} ${-h * 0.55} ${lean} ${-h}" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;

/* An opposed pair of herb leaves on a stem, used for basil and chilli. */
const leafPair = (x, y, r, fill) =>
  leaf(x, y, r * 1.55, r * 0.68, -22, fill, G.light)
  + leaf(x, y, r * 1.55, r * 0.68, 202, fill, G.light);

/* Curly parsley: a cauliflower of small circles. */
function curlyHead(x, y, r, dark, light) {
  let out = '';
  const pts = [[0, 0, 1], [-0.8, 0.25, 0.82], [0.8, 0.25, 0.82], [-0.45, -0.5, 0.74], [0.45, -0.5, 0.74], [0, -0.85, 0.62]];
  pts.forEach(([dx, dy, s], i) => {
    out += `<circle cx="${x + dx * r}" cy="${y + dy * r}" r="${r * s * 0.62}" fill="${i % 2 ? light : dark}"/>`;
  });
  return out;
}

const soilMound = (w, h) =>
  `<ellipse cx="${w / 2}" cy="${h}" rx="${w * 0.3}" ry="${h * 0.035}" fill="#3A2E26" opacity=".55"/>`;

const wrap = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

/* ---------- tomato ---------- */
/* Indeterminate cordon trained up a string to the ceiling, as on the real balcony. */
function tomatoArt({ fruit = 0, flowers = 0, height = 260, ripe = '#D9472B' }) {
  const W = 200, H = 300;
  const base = H - 6;
  const top = H - height;
  let s = soilMound(W, H - 2);
  // the support string running up out of frame
  s += `<path d="M100 ${base} L104 0" stroke="${G.string}" stroke-width="2" fill="none" opacity=".65"/>`;
  // main stem: thick at the soil, thin at the tip
  s += stalk(100, base, 100, top, 4.2, 1.6, G.stem);
  const rungs = 6;
  for (let i = 0; i < rungs; i++) {
    const y = base - 24 - i * ((base - top - 26) / rungs);
    const dir = i % 2 ? 1 : -1;
    const scale = 1.08 - i * 0.08;
    s += tomatoLeaf(100, y, 54 * scale, dir, scale, G.deep, G.mid);
  }
  for (let i = 0; i < flowers; i++) {
    const y = base - 74 - i * 54;
    const dir = i % 2 ? -1 : 1;
    s += `<path d="M100 ${y}q${13 * dir} 2 ${25 * dir} 9" stroke="${G.stem}" stroke-width="2.1" fill="none"/>`;
    for (let k = 0; k < 3; k++) {
      const fx = 100 + (12 + k * 7) * dir, fy = y + 4 + k * 4;
      s += `<circle cx="${fx}" cy="${fy}" r="4.4" fill="${G.bloom}"/>`;
      s += `<circle cx="${fx}" cy="${fy}" r="1.6" fill="${G.orange}"/>`;
    }
  }
  for (let i = 0; i < fruit; i++) {
    const y = base - 62 - i * 56;
    const dir = i % 2 ? 1 : -1;
    s += `<path d="M100 ${y}q${14 * dir} 1 ${26 * dir} 6" stroke="${G.stem}" stroke-width="2.2" fill="none"/>`;
    // a small truss: two fruit, not one giant ball
    [[26, 8, 11], [40, 18, 9]].forEach(([ox, oy, r]) => {
      const fx = 100 + ox * dir, fy = y + oy;
      s += `<circle cx="${fx}" cy="${fy + r * 0.7}" r="${r}" fill="${ripe}"/>`;
      s += `<path d="M${fx - r * 0.7} ${fy} q${r * 0.7} -${r * 0.45} ${r * 1.4} 0" stroke="${G.deep}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    });
  }
  /* Indeterminate cordons trained to the ceiling: these are the tall ones, and
     they should read as roughly twice the height of a raspberry pot. */
  return { w: 1.00, h: 1.95, svg: wrap(W, H, s) };
}

/* ---------- raspberry ---------- */
/* Canes tied to bamboo, which is exactly how they stand in the photos. */
function raspberryArt({ berries = 0, canes = 3, height = 210 }) {
  const W = 210, H = 260;
  const base = H - 6;
  let s = soilMound(W, H - 2);
  for (let c = 0; c < canes; c++) {
    const x = 105 + (c - (canes - 1) / 2) * 34;
    const lean = (c - (canes - 1) / 2) * 9;
    const topY = base - height * (0.82 + 0.18 * ((c + 1) % 2));
    // bamboo stake, deliberately a touch taller than the cane
    s += `<path d="M${x + 8} ${base} L${x + 8 + lean * 0.5} ${topY - 22}" stroke="${G.bamboo}" stroke-width="4" stroke-linecap="round"/>`;
    s += stalk(x, base, x + lean * 1.4, topY, 3.4, 1.5, G.stem);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.7) / (n + 0.4);
      const ly = base - (base - topY) * t;
      const lx = x + lean * 1.4 * t * t;
      const dir = i % 2 ? 1 : -1;
      const sc = 30 - i * 3;
      s += raspLeaf(lx, ly, sc, dir, G.deep, G.mid);
    }
    // tie points, the bit of string round cane and bamboo
    s += `<path d="M${x + 2} ${base - 70}h9M${x + 3} ${base - 130}h9" stroke="${G.string}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  for (let i = 0; i < berries; i++) {
    const bx = 60 + (i % 3) * 44 + (i % 2) * 10;
    const by = base - 90 - Math.floor(i / 3) * 40;
    s += `<path d="M${bx} ${by - 12}v-8" stroke="${G.stem}" stroke-width="2"/>`;
    s += `<circle cx="${bx}" cy="${by}" r="9" fill="${G.berry}"/>`;
    [[-4, -3], [4, -3], [0, -6], [-5, 3], [5, 3], [0, 4]].forEach(([dx, dy]) =>
      (s += `<circle cx="${bx + dx}" cy="${by + dy}" r="3.4" fill="${G.berryLight}"/>`));
  }
  return { w: 0.86, h: 0.98, svg: wrap(W, H, s) };
}

/* ---------- chilli ---------- */
function chilliArt({ pods = 0, flowers = 0, height = 120, podColor = '#D9472B' }) {
  const W = 150, H = 190;
  const base = H - 6;
  const top = base - height;
  let s = soilMound(W, H - 2);
  s += stalk(75, base, 75, top + 10, 3.6, 1.5, G.stem);
  const tiers = Math.max(2, Math.round(height / 34));
  for (let i = 0; i < tiers; i++) {
    const y = base - 18 - i * ((height - 20) / tiers);
    const r = 17 - i * 1.8;
    s += leafPair(75, y - 2, r, i % 2 ? G.mid : G.deep);
  }
  for (let i = 0; i < flowers; i++) {
    const x = 75 + (i % 2 ? 22 : -22), y = base - 40 - i * 26;
    s += `<circle cx="${x}" cy="${y}" r="6" fill="${G.white}"/>`;
    s += `<circle cx="${x}" cy="${y}" r="2" fill="${G.bloom}"/>`;
  }
  for (let i = 0; i < pods; i++) {
    const x = 75 + (i % 2 ? 20 : -20), y = base - 46 - i * 24;
    s += `<path d="M${x} ${y}q4 16 -2 26" stroke="${podColor}" stroke-width="7" stroke-linecap="round" fill="none"/>`;
    s += `<path d="M${x - 3} ${y - 3}h7" stroke="${G.deep}" stroke-width="3" stroke-linecap="round"/>`;
  }
  return { w: 0.42, h: 0.53, svg: wrap(W, H, s) };
}

/* ---------- herbs and roots ---------- */
function basilMintArt({ tall = false }) {
  const W = 170, H = 140;
  const base = H - 6;
  let s = soilMound(W, H - 2);
  // basil on the left, mint on the right, sharing the bed
  [[52, 1], [118, 0.88]].forEach(([x, k], idx) => {
    const h = (tall ? 96 : 76) * k;
    s += stalk(x, base, x, base - h, 3.4, 1.4, G.stem);
    const n = tall ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const y = base - 16 - i * (h / (n + 0.3));
      const r = (idx ? 13 : 16) - i * 1.4;
      s += leafPair(x, y, r, i % 2 ? G.mid : G.deep);
    }
    s += leaf(x, base - h - 2, 15, 6.5, -90, G.light, null);
  });
  return { w: 0.5, h: 0.41, svg: wrap(W, H, s) };
}

function parsleyArt({ big = false }) {
  const W = 150, H = 130;
  const base = H - 6;
  let s = soilMound(W, H - 2);
  const stalks = big ? 6 : 4;
  for (let i = 0; i < stalks; i++) {
    const lean = (i - (stalks - 1) / 2) * (big ? 20 : 16);
    const h = (big ? 88 : 68) - Math.abs(i - (stalks - 1) / 2) * 8;
    const tx = 75 + lean, ty = base - h;
    s += `<path d="M75 ${base}q${lean * 0.4} ${-h * 0.6} ${lean} ${-h}" stroke="${G.mid}" stroke-width="3.4" stroke-linecap="round" fill="none"/>`;
    s += curlyHead(tx, ty, big ? 20 : 17, G.deep, G.light);
  }
  return { w: 0.4, h: 0.35, svg: wrap(W, H, s) };
}

function chivesArt({ flowering = false }) {
  const W = 140, H = 130;
  const base = H - 6;
  let s = soilMound(W, H - 2);
  const n = 11;
  for (let i = 0; i < n; i++) {
    const x = 42 + i * 5.6;
    const lean = (i - n / 2) * 4.2;
    const h = 74 - Math.abs(i - n / 2) * 4;
    s += blade(x, base, h, lean, 4, i % 2 ? G.mid : G.deep);
  }
  if (flowering) {
    [[58, 60], [86, 74]].forEach(([x, h]) => {
      s += blade(x, base, h + 14, 4, 3.4, G.mid);
      s += `<circle cx="${x + 5}" cy="${base - h - 16}" r="9" fill="#D793A8"/>`;
    });
  }
  return { w: 0.34, h: 0.32, svg: wrap(W, H, s) };
}

function springOnionArt({ big = false }) {
  const W = 140, H = 130;
  const base = H - 6;
  let s = soilMound(W, H - 2);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x = 50 + i * 12;
    const white = big ? 30 : 22;
    s += `<path d="M${x} ${base}v${-white}" stroke="${G.onion}" stroke-width="9" stroke-linecap="round"/>`;
    const lean = (i - (n - 1) / 2) * 9;
    s += blade(x, base - white, big ? 62 : 46, lean, 6, i % 2 ? G.deep : G.mid);
    s += blade(x, base - white, big ? 50 : 38, lean * -0.6, 5.4, G.mid);
  }
  return { w: 0.36, h: 0.33, svg: wrap(W, H, s) };
}

function garlicArt({ yellowing = false, bulb = false }) {
  const W = 130, H = 140;
  const base = H - 6;
  let s = soilMound(W, H - 2);
  if (bulb) s += `<ellipse cx="65" cy="${base - 6}" rx="20" ry="15" fill="${G.bulb}" stroke="${G.deep}" stroke-width="2"/>`;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const lean = (i - (n - 1) / 2) * 17;
    const h = 84 - Math.abs(i - (n - 1) / 2) * 11;
    const col = yellowing && i % 2 ? '#B9AE55' : i % 2 ? G.mid : G.deep;
    s += blade(65, base - (bulb ? 12 : 0), h, lean, 7, col);
  }
  return { w: 0.32, h: 0.35, svg: wrap(W, H, s) };
}

function hederaArt() {
  const W = 200, H = 150;
  let s = '';
  // a wall pot's worth of ivy, trailing down and to the side
  const vines = [[0, 30], [-14, 62], [10, 96]];
  vines.forEach(([off, drop], vi) => {
    const x0 = 100 + off;
    s += `<path d="M${x0} 8 q${28 + vi * 10} ${drop * 0.5} ${18 + vi * 24} ${drop}" stroke="${G.mid}" stroke-width="2.6" fill="none"/>`;
    for (let i = 1; i <= 4; i++) {
      const t = i / 4.4;
      const lx = x0 + (18 + vi * 24) * t + 10 * t * (1 - t) * 4;
      const ly = 8 + drop * t;
      const r = 11 - i * 0.8;
      // ivy leaf: a three-lobed wedge
      s += `<path d="M${lx} ${ly - r}l${r} ${r * 0.7}l${-r * 0.45} ${r * 0.4}l${r * 0.5} ${r * 0.5}l${-r} ${r * 0.4}l${-r} ${-r * 0.4}l${r * 0.5} ${-r * 0.5}l${-r * 0.45} ${-r * 0.4}z" fill="${i % 2 ? G.deep : G.mid}"/>`;
    }
  });
  /* Ivy trails, so this one hangs from the pot rim instead of standing on it. */
  return { w: 0.62, h: 0.46, anchor: 'top', svg: wrap(W, H, s) };
}

function monsteraArt() {
  const W = 190, H = 220;
  const base = H - 6;
  let defs = '';
  let s = soilMound(W, H - 2);
  const leaves = [[-1, 96, 46, -18], [1, 118, 52, 16], [-1, 150, 44, -8], [1, 172, 38, 10]];
  leaves.forEach(([dir, y, r, rot], idx) => {
    const x = 95 + dir * 22;
    const cy = base - y;
    const id = 'm' + idx;
    /* The fenestrations have to be holes, not overdraw: the billboard sits on a
       transparent plane, so anything painted "background colour" would be a
       visible smear. A mask cuts them properly. */
    let cuts = '';
    for (let i = -2; i <= 2; i++) {
      if (!i) continue;
      const yy = cy + i * r * 0.28;
      const len = r * (0.78 - Math.abs(i) * 0.12);
      cuts += `<rect x="${i > 0 ? x + 2 : x - 2 - len}" y="${yy - 2.6}" width="${len}" height="5.2" rx="2.6" fill="#000"/>`;
    }
    defs += `<mask id="${id}"><ellipse cx="${x}" cy="${cy}" rx="${r}" ry="${r * 0.86}" fill="#fff"/>${cuts}</mask>`;
    s += `<path d="M95 ${base}Q95 ${base - 40} ${x} ${base - y + r * 0.6}" stroke="${G.stem}" stroke-width="4" fill="none"/>`;
    s += `<g transform="rotate(${rot} ${x} ${cy})">`;
    s += `<ellipse cx="${x}" cy="${cy}" rx="${r}" ry="${r * 0.86}" fill="${idx % 2 ? G.deep : G.dark}" mask="url(#${id})"/>`;
    s += `</g>`;
  });
  return { w: 0.66, h: 0.76, svg: wrap(W, H, `<defs>${defs}</defs>${s}`) };
}

/* A last-resort tuft, so a species with no drawing is still visible and clickable. */
function tuftArt() {
  const W = 120, H = 110;
  const base = H - 6;
  let s = soilMound(W, H - 2);
  for (let i = 0; i < 7; i++) s += blade(38 + i * 8, base, 62 - Math.abs(i - 3) * 7, (i - 3) * 7, 5, i % 2 ? G.mid : G.deep);
  return { w: 0.3, h: 0.28, svg: wrap(W, H, s) };
}

/* ---------- the table ----------
 * Keyed species -> stage. Stage names are the ones that appear in garden-data.js
 * and in the CARE table: seedling, settling, growing, vegetative, flowering,
 * fruiting, harvesting, bulbing, sprouting, ready, established, dormant.
 */
export const BILLBOARDS = {
  tomato: {
    seedling: tomatoArt({ height: 90 }),
    settling: tomatoArt({ height: 130 }),
    vegetative: tomatoArt({ height: 200 }),
    growing: tomatoArt({ height: 200 }),
    flowering: tomatoArt({ height: 260, flowers: 3 }),
    fruiting: tomatoArt({ height: 270, flowers: 1, fruit: 3 }),
    harvesting: tomatoArt({ height: 270, fruit: 4, ripe: '#C4341F' }),
  },
  raspberry: {
    settling: raspberryArt({ height: 150, canes: 3 }),
    growing: raspberryArt({ height: 190, canes: 3 }),
    flowering: raspberryArt({ height: 210, canes: 3 }),
    fruiting: raspberryArt({ height: 215, canes: 3, berries: 5 }),
    harvesting: raspberryArt({ height: 215, canes: 3, berries: 3 }),
    dormant: raspberryArt({ height: 130, canes: 3 }),
  },
  chilli: {
    seedling: chilliArt({ height: 46 }),
    vegetative: chilliArt({ height: 96 }),
    growing: chilliArt({ height: 96 }),
    flowering: chilliArt({ height: 118, flowers: 3 }),
    fruiting: chilliArt({ height: 126, pods: 3, podColor: '#5E9B45' }),
    harvesting: chilliArt({ height: 126, pods: 3 }),
  },
  basilmint: {
    seedling: basilMintArt({}),
    growing: basilMintArt({}),
    harvesting: basilMintArt({ tall: true }),
  },
  parsley: {
    seedling: parsleyArt({}),
    growing: parsleyArt({}),
    harvesting: parsleyArt({ big: true }),
  },
  chives: {
    growing: chivesArt({}),
    harvesting: chivesArt({ flowering: true }),
  },
  springonion: {
    growing: springOnionArt({}),
    harvesting: springOnionArt({ big: true }),
  },
  garlic: {
    sprouting: garlicArt({}),
    growing: garlicArt({}),
    bulbing: garlicArt({ bulb: true }),
    ready: garlicArt({ bulb: true, yellowing: true }),
  },
  monstera: {
    settling: monsteraArt(),
    established: monsteraArt(),
    growing: monsteraArt(),
  },
  hedera: {
    settling: hederaArt(),
    established: hederaArt(),
    growing: hederaArt(),
  },
};

export const FALLBACK = tuftArt();

/* Stage order, used to fall back to the nearest earlier stage a species has art
   for. A fruiting plant with no fruiting drawing looks better as a flowering one
   than as a seedling. */
const STAGE_ORDER = ['seedling', 'sprouting', 'settling', 'growing', 'vegetative',
  'established', 'flowering', 'bulbing', 'fruiting', 'harvesting', 'ready', 'dormant'];

/* species + stage -> { w, h, svg }. Never returns null: an unknown species gets
   the generic tuft so the plant is still drawn and still clickable. */
export function billboardFor(species, stage) {
  const set = BILLBOARDS[species];
  if (!set) return FALLBACK;
  if (stage && set[stage]) return set[stage];
  const want = STAGE_ORDER.indexOf(stage);
  if (want > 0) {
    for (let i = want - 1; i >= 0; i--) {
      const s = STAGE_ORDER[i];
      if (set[s]) return set[s];
    }
  }
  const first = Object.keys(set)[0];
  return first ? set[first] : FALLBACK;
}

/* A data: URI, ready for a Three.js texture loader. encodeURIComponent rather than
   base64: the SVGs are small and this keeps them readable in devtools. */
export const svgDataURI = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
