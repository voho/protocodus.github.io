/* Hedgerow — Mission 1: Saint-Clair, at dusk.

   The player comes up a sunken lane between hedgerows (south, z ≈ 0),
   takes the checkpoint at the edge of the village, fights up the main
   street to the square under the church tower, crosses the river (bridge,
   ford or fallen tree), breaks a trench line and a bunker in the forest and
   blows up the flak gun in the clearing before the rally point (z ≈ 548).

   World axes: +z is north (the way forward), +x is the player's left
   (west). Yaw 0 turns a model's front to +z, 180 to the south (towards
   the player), -90 to -x, 90 to +x.

   Everything here is data plus the analytic ground; levelBuild.js turns
   it into meshes, colliders, vegetation, enemies and triggers. */

import { fbm2, polylineDistance, smoothstep, smoothPolyline, rng, clamp, lerp } from '../util.js';

/* ---------- lines on the ground ---------- */

const LANE = smoothPolyline([[0, -30], [1.5, -5], [3, 18], [-1, 42], [1.5, 64], [0, 84]], 1.5);
const STREET = smoothPolyline([[0, 84], [0.5, 120], [0, 150], [0, 180], [-0.5, 215], [0, 246], [0, 258]], 2);
const TRACK = smoothPolyline([[0, 281], [-3, 300], [-9, 326], [-7, 350], [2, 374], [6, 398], [3, 424], [-4, 450], [-6, 472], [-2, 492], [0, 512], [0, 535], [0, 565]], 2);
const DITCH = smoothPolyline([[-9, 30], [-11, 55], [-12, 78], [-14, 92], [-20, 104]], 2);
const RIVER_Z = (x) => 270 + 3 * Math.sin(x / 23);
const TRENCH_W = smoothPolyline([[-40, 392], [-33, 386], [-27, 391], [-20, 385], [-13, 390], [-6, 386]], 1);
const TRENCH_E = smoothPolyline([[9, 386], [15, 391], [22, 385], [29, 390], [36, 386], [42, 391]], 1);
const TRENCH_C = smoothPolyline([[-20, 385], [-21, 395], [-17, 404]], 1);    // communication trench to the rear
const FOXHOLES = [[2, 340, 1.6], [9, 352, 1.6], [-16, 358, 1.6]];
const TRENCH_DEPTH = 1.25;
const trenchWallY = (x, z) => trackHeight(x, z) - TRENCH_DEPTH - 0.42;
const SQUARE = { x0: -14, x1: 14, z0: 148, z1: 182 };
const CLEARING = { x: 0, z: 508, r: 24 };
const BUNKER = { x: 9, z: 446 };

const tmpD = {};

// bounding boxes of the lines (grown by `pad`): distance tests only run near them
const bbox = (line, pad) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of line) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
};
const inBox = (b, x, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
const BOX = {
  LANE: bbox(LANE, 12), STREET: bbox(STREET, 12), TRACK: bbox(TRACK, 10), DITCH: bbox(DITCH, 6),
  TW: bbox(TRENCH_W, 7), TE: bbox(TRENCH_E, 7), TC: bbox(TRENCH_C, 7),
};
const TRENCHES = [[TRENCH_W, 'TW'], [TRENCH_E, 'TE'], [TRENCH_C, 'TC']];

/* ---------- small irregularities: mounds, clods, shell craters ---------- */

// Where the ground may be rough: away from roads, paths, trenches, the river
// and the squares (building pads are levelled later anyway).
function roughAllowed(x, z) {
  let k = 1;
  if (z < 262 && inBox(BOX.STREET, x, z)) { polylineDistance(STREET, x, z, tmpD); k = Math.min(k, smoothstep(6, 10, tmpD.d)); }
  if (z < 88 && inBox(BOX.LANE, x, z)) { polylineDistance(LANE, x, z, tmpD); k = Math.min(k, smoothstep(4.5, 7.5, tmpD.d)); }
  if (z > 276 && inBox(BOX.TRACK, x, z)) { polylineDistance(TRACK, x, z, tmpD); k = Math.min(k, smoothstep(3.5, 6.5, tmpD.d)); }
  for (const [T, b] of TRENCHES) if (inBox(BOX[b], x, z)) { polylineDistance(T, x, z, tmpD); k = Math.min(k, smoothstep(2.6, 5, tmpD.d)); }
  k = Math.min(k, smoothstep(9, 15, Math.abs(z - RIVER_Z(x))));
  k = Math.min(k, smoothstep(CLEARING.r - 4, CLEARING.r + 2, Math.hypot(x - CLEARING.x, z - CLEARING.z)));
  k = Math.min(k, smoothstep(10, 14, Math.hypot(x - BUNKER.x, z - BUNKER.z)));
  if (x > SQUARE.x0 - 3 && x < SQUARE.x1 + 3 && z > SQUARE.z0 - 3 && z < SQUARE.z1 + 3) k = 0;
  return k;
}

const BUMP_CELL = 10;
const bumpGrid = new Map();
const CRATERS = [];          // the shell craters, for the rainwater standing in them (ponds.js)
function addBump(b) {
  const r = b.r + 2;
  for (let i = Math.floor((b.x - r) / BUMP_CELL); i <= Math.floor((b.x + r) / BUMP_CELL); i++)
    for (let j = Math.floor((b.z - r) / BUMP_CELL); j <= Math.floor((b.z + r) / BUMP_CELL); j++) {
      const k = i + ',' + j;
      if (!bumpGrid.has(k)) bumpGrid.set(k, []);
      bumpGrid.get(k).push(b);
    }
}
{
  const RB = rng(1944071);
  // mounds and clods: fields, gardens, forest floor
  for (let n = 0; n < 900; n++) {
    const x = RB.range(-95, 95), z = RB.range(-40, 600);
    const r = RB.range(0.8, 2.8);
    if (roughAllowed(x, z) < 1) continue;
    addBump({ x, z, r, h: RB.range(0.12, 0.42) * (r / 2), crater: false });
  }
  // shell craters: the fields south of the village, the river banks, the forest
  for (let n = 0; n < 70; n++) {
    const x = RB.range(-60, 60), z = RB.pick([RB.range(10, 80), RB.range(285, 380), RB.range(400, 540)]);
    if (roughAllowed(x, z) < 1) continue;
    const r = RB.range(1.6, 3.6);
    const c = { x, z, r, h: RB.range(0.5, 1.0) * r * 0.35, crater: true };
    addBump(c);
    CRATERS.push(c);
  }
}

function bumps(x, z) {
  const list = bumpGrid.get(Math.floor(x / BUMP_CELL) + ',' + Math.floor(z / BUMP_CELL));
  if (!list) return 0;
  let h = 0;
  for (const b of list) {
    const d = Math.hypot(x - b.x, z - b.z) / b.r;
    if (d > 1.6) continue;
    if (b.crater) {
      // a bowl with a thrown-up rim
      h += -b.h * smoothstep(1.0, 0.0, d) * smoothstep(0.0, 0.2, 1 - d * 0.2) + b.h * 0.45 * smoothstep(0.75, 1.05, d) * smoothstep(1.6, 1.05, d);
    } else {
      const t = Math.max(0, 1 - d * d);
      h += b.h * t * t;
    }
  }
  return h;
}

/* Fine rolling unevenness everywhere it is allowed (a few dm over metres). */
function rough(x, z) {
  const k = roughAllowed(x, z);
  if (k <= 0) return 0;
  return k * (0.2 * fbm2(x / 5.3 + 11.7, z / 5.3 - 3.1, 3) + 0.08 * fbm2(x / 2.4 - 5.2, z / 2.4 + 8.4, 2) + bumps(x, z));
}

function riverProfile(x, z) {
  const dz = Math.abs(z - RIVER_Z(x));
  const ford = smoothstep(9, 3, Math.abs(x + 32));           // the ford, west of the bridge
  const bed = lerp(-1.6, -0.55, ford);
  const half = lerp(5, 3, ford), bank = lerp(10.5, 14, ford);
  if (dz > bank) return null;
  return bed + (2.0 - bed) * smoothstep(half, bank, dz);
}

/* The ground without building pads. */
function baseHeight(x, z) {
  const ax = Math.abs(x);
  let h = 2.0 + fbm2(x / 47 + 3.1, z / 47 - 1.7, 3) * 0.7;
  // fields to the south roll a little more
  h += fbm2(x / 23, z / 23, 2) * 0.35 * smoothstep(90, 60, z);
  // the forest climbs north of the river, with a dip where the bunker sits
  const fz = smoothstep(280, 296, z);
  h += fz * (7.5 * smoothstep(290, 384, z) - 1.2 * smoothstep(405, 440, z) + 1.8 * smoothstep(470, 505, z));
  h += fz * fbm2(x / 17 + 9, z / 17, 3) * 1.5;
  // hills closing the sides; the forest ones are steeper
  h += (6 + 10 * fz) * smoothstep(40, 72, ax) + 4 * smoothstep(60, 95, ax);
  // a little ridge path on the west side of the forest
  h += fz * 1.6 * smoothstep(14, 28, x) * smoothstep(42, 30, x) * smoothstep(300, 330, z) * smoothstep(470, 440, z);

  // small bulges and irregularities (kept off roads, paths and trenches)
  const rg = rough(x, z);
  h += rg;

  // village plateau: flat, a slight fall towards the river
  const village = smoothstep(80, 92, z) * smoothstep(262, 252, z) * smoothstep(52, 40, ax);
  h = lerp(h, 2.0 + 0.4 * smoothstep(250, 120, z) + fbm2(x / 30, z / 30, 2) * 0.12 + rg * 0.6, village);

  // the river
  const rv = riverProfile(x, z);
  if (rv !== null) h = Math.min(h, lerp(h, rv, smoothstep(14, 9, Math.abs(z - RIVER_Z(x)))));

  // sunken lane between the hedgebanks
  if (z < 88 && inBox(BOX.LANE, x, z)) polylineDistance(LANE, x, z, tmpD); else tmpD.d = Infinity;
  if (tmpD.d < 9 && z < 88) {
    const laneH = 2.0 - 1.15 * smoothstep(84, 70, z);
    const bankUp = 0.45 * smoothstep(4.2, 6.0, tmpD.d) * smoothstep(9, 7, tmpD.d);
    h = lerp(h, laneH, smoothstep(5.0, 2.8, tmpD.d)) + bankUp;
  }
  // the drainage ditch on the right of the lane
  if (inBox(BOX.DITCH, x, z)) {
    polylineDistance(DITCH, x, z, tmpD);
    if (tmpD.d < 3.5) h -= 1.0 * smoothstep(3.5, 1.0, tmpD.d);
  }

  // the street (flat, a little camber)
  if (inBox(BOX.STREET, x, z)) polylineDistance(STREET, x, z, tmpD); else tmpD.d = Infinity;
  if (tmpD.d < 8) h = lerp(h, 2.0 + 0.4 * smoothstep(250, 120, z) - tmpD.d * tmpD.d * 0.003, smoothstep(8, 5, tmpD.d));

  // the forest track
  if (z > 276 && inBox(BOX.TRACK, x, z)) {
    polylineDistance(TRACK, x, z, tmpD);
    if (tmpD.d < 6) {
      const ty = trackHeight(tmpD.px, tmpD.pz);
      h = lerp(h, ty - 0.1, smoothstep(6, 2.5, tmpD.d));
    }
  }
  // clearing: flatter
  const dc = Math.hypot(x - CLEARING.x, z - CLEARING.z);
  if (dc < CLEARING.r + 8) h = lerp(h, trackHeight(CLEARING.x, CLEARING.z), smoothstep(CLEARING.r + 8, CLEARING.r - 4, dc) * 0.85);

  // trenches: a flat floor TRENCH_DEPTH down (a man standing sees over
  // the parapet, crouching he is hidden), steep sides, a low earth parapet
  for (const [T, b] of TRENCHES) {
    if (!inBox(BOX[b], x, z)) continue;
    polylineDistance(T, x, z, tmpD);
    if (tmpD.d < 2.2) {
      const lip = trackHeight(tmpD.px, tmpD.pz);
      const floor = lip - TRENCH_DEPTH;
      h = lerp(Math.max(h, lip + 0.15 * smoothstep(2.2, 1.3, tmpD.d)), floor, smoothstep(1.15, 0.8, tmpD.d));
    }
  }
  // the trench ends and the communication trench have ramps
  for (const [rx, rz] of [[-40, 392], [42, 391], [-17, 404]]) {
    const d = Math.hypot(x - rx, z - rz);
    if (d < 4) h = lerp(h, trackHeight(rx, rz) - 0.2, smoothstep(4, 1.5, d) * 0.6);
  }
  for (const [fx, fz2, r] of FOXHOLES) {
    const d = Math.hypot(x - fx, z - fz2);
    if (d < r + 1) h = lerp(h, trackHeight(fx, fz2) - 1.0, smoothstep(r, r - 0.6, d)) + 0.2 * smoothstep(r + 1, r, d) * smoothstep(r - 0.6, r, d);
  }
  return h;
}

/* The undisturbed forest floor (no noise) — trenches, track and pads
   follow it so they stay level. */
function trackHeight(x, z) {
  const ax = Math.abs(x);
  const fz = smoothstep(280, 296, z);
  let h = 2.0 + fbm2(x / 47 + 3.1, z / 47 - 1.7, 3) * 0.7;
  h += fz * (7.5 * smoothstep(290, 384, z) - 1.2 * smoothstep(405, 440, z) + 1.8 * smoothstep(470, 505, z));
  h += (6 + 10 * fz) * smoothstep(40, 72, ax) * 0.4;
  return h;
}

/* ---------- ground textures ---------- */

function splat(x, z, h, slope) {
  // [mud, grass, forest floor, cobble]
  let mud = 0, grass = 1, forest = 0, cobble = 0;
  const fz = smoothstep(276, 290, z);
  forest = fz; grass = 1 - fz;
  const n = fbm2(x / 9, z / 9, 2);
  // muddy patches everywhere
  mud += smoothstep(0.15, 0.6, n) * 0.6;
  // village gardens: trodden, muddier
  const village = smoothstep(84, 92, z) * smoothstep(258, 250, z) * smoothstep(48, 36, Math.abs(x));
  mud += village * 0.35;
  // lane, ditch, track
  if (z < 88 && inBox(BOX.LANE, x, z)) { polylineDistance(LANE, x, z, tmpD); mud += smoothstep(4.0, 2.0, tmpD.d) * 2; }
  if (inBox(BOX.DITCH, x, z)) { polylineDistance(DITCH, x, z, tmpD); mud += smoothstep(3, 1, tmpD.d) * 1.5; }
  if (z > 276 && inBox(BOX.TRACK, x, z)) { polylineDistance(TRACK, x, z, tmpD); mud += smoothstep(3.2, 1.6, tmpD.d) * 2; }
  // street cobbles with a muddy edge
  if (inBox(BOX.STREET, x, z)) polylineDistance(STREET, x, z, tmpD); else tmpD.d = Infinity;
  cobble = smoothstep(5.2, 4.2, tmpD.d);
  if (x > SQUARE.x0 && x < SQUARE.x1 && z > SQUARE.z0 && z < SQUARE.z1) cobble = Math.max(cobble, smoothstep(0, 2, Math.min(x - SQUARE.x0, SQUARE.x1 - x, z - SQUARE.z0, SQUARE.z1 - z)));
  mud += smoothstep(6.5, 5.0, tmpD.d) * (1 - cobble) * 1.2;
  // river banks
  const dr = Math.abs(z - RIVER_Z(x));
  mud += smoothstep(11, 7, dr) * 1.6;
  // trenches
  for (const [T, bx] of TRENCHES) if (inBox(BOX[bx], x, z)) { polylineDistance(T, x, z, tmpD); mud += smoothstep(2.4, 1.0, tmpD.d) * 2; }
  // churned earth in and round the shell craters, fresh soil on the mounds
  const bm = bumps(x, z);
  mud += Math.min(1.5, Math.abs(bm) * 2.2);
  // clearing grass
  const dc = Math.hypot(x - CLEARING.x, z - CLEARING.z);
  const cl = smoothstep(CLEARING.r + 4, CLEARING.r - 6, dc);
  grass += cl * 0.8; forest *= 1 - cl * 0.7;
  const s = mud + grass + forest + cobble * 3;
  if (cobble > 0.5) return [mud * 0.2 / s, grass * 0.1 / s, 0, 1];
  return [mud / s, grass / s, forest / s, cobble * 3 / s];
}

/* ---------- props ---------- */

const props = [];
const P = (m, x, z, yaw = 0, o = {}) => { props.push({ m, x, z, yaw, ...o }); return props[props.length - 1]; };

function along(line, step, offset, fn, from = 0, to = Infinity) {
  // walk a polyline placing things every `step` metres at a lateral offset
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    for (let s = 0; s < L; s += 0.25) {
      acc += 0.25;
      if (acc >= step) {
        acc = 0;
        const x = ax + tx * s, z = az + tz * s;
        if (z < from || z > to) continue;
        // left normal (+x side when heading +z) is (tz, -tx)
        fn(x + tz * offset, z - tx * offset, Math.atan2(-tz, tx) * 180 / Math.PI, tx, tz);
      }
    }
  }
}

// --- the sunken lane: hedgerows on both banks with gaps into the fields ---
along(LANE, 4, 6.2, (x, z, yaw) => { if (Math.abs(z - 34) > 4 && z < 80) P('hedge', x, z, yaw + (Math.round(z) % 8 < 4 ? 0 : 180), { veg: true }); }, -26);
along(LANE, 4, -6.2, (x, z, yaw) => { if (Math.abs(z - 52) > 4 && z < 80) P('hedge', x, z, yaw + (Math.round(z) % 8 < 4 ? 0 : 180), { veg: true }); }, -26);
P('jeep_wreck', -1.5, 12, 160);
P('crate', 2.2, 14, 25);
P('signpost', 3.4, 70, -20);
P('pole', -4.6, 46, 0);
P('pole', -4.6, 76, 0);
// the orchard (left) and the field with the ditch (right)
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
  P('oak_b', 13 + i * 7 + (j % 2) * 2, 44 + j * 9, (i * 37 + j * 11) % 360, { veg: true, scale: 0.55 + ((i + j) % 3) * 0.05 });
}
P('haystack', 32, 70, 0);
P('haystack', 25, 77, 40);
P('cart', 17, 70, 70);
P('fence', 8, 80, 0); P('fence', 34, 80, 0);
P('wall_low', 12, 82, 0); P('wall_broken', 16, 82, 0); P('gate', 20.8, 82.6, 72); P('wall_low', 25, 82, 0); P('wall_low', 29, 82, 0); P('wall_low', 33, 82, 0); P('wall_low', 37, 82, 0);
P('hedge', 42, 82, 0, { veg: true }); P('hedge', 46, 82, 180, { veg: true });
P('hedge', -24, 84, 0, { veg: true }); P('hedge', -28, 84, 180, { veg: true }); P('hedge', -32, 84, 0, { veg: true }); P('hedge', -36, 84, 180, { veg: true }); P('hedge', -40, 84, 0, { veg: true }); P('hedge', -44, 84, 180, { veg: true });
P('bush_a', -16, 66, 0, { veg: true }); P('bush_b', -18, 80, 0, { veg: true }); P('bush_a', -8, 86, 30, { veg: true });
// field edges
for (let z = 6; z < 84; z += 4) { P('hedge', 46, z, 90 + (z % 8 ? 180 : 0), { veg: true }); P('hedge', -46, z, 90 + (z % 8 ? 0 : 180), { veg: true }); }

// --- the checkpoint at the edge of the village ---
P('barrier', 0, 86.5, 0);
P('sentry_box', 4.6, 88.5, 180);
const NEST_GATE = P('mg_nest', -6.5, 89.5, 180, { id: 'nest_gate' });
P('sandbags', 6.5, 91, 0); P('sandbags_low', -2.5, 94, 0);
P('crate', 3.5, 93, 15); P('crate_large', 4.8, 94.5, -10);
P('barrel', -8.5, 96, 0); P('barrel', -9.3, 96.6, 0);

// --- the village: two rows of houses along the street ---
// facades on a common line 5.8 m either side of the street; `wd` is the
// half depth of each model's walls (its front wall sits at local +wd)
const FRONT = 5.8;
const LEFT = (m, z, wd, o = {}) => P(m, FRONT + wd, z, -90, { pad: true, ...o });
const RIGHT = (m, z, wd, o = {}) => P(m, -FRONT - wd, z, 90, { pad: true, ...o });
LEFT('house_a', 101, 2.85); LEFT('house_b', 112.5, 3.8); LEFT('ruin', 124, 3.3, { id: 'ruin' }); LEFT('house_f', 137, 4.0);
RIGHT('house_d', 99, 2.2); RIGHT('house_c', 109.5, 3.1); RIGHT('ruin_b', 121.5, 3.5, {
  // burning through and through: flame all over the floor of the roofless shell (in its own frame:
  // x along the street, z towards it), seen in the door and the windows and licking up the walls
  // and up in the charred joists of the floor above at the back, over the walls' broken tops; its
  // own fire (and so its smoke, its column over the roofs and its glow on the clouds) a big one
  fire: true, fireSize: 1.6,
  blaze: [[-2.2, 0.3, 2.6, 1.6], [2.4, 0.3, 2.8, 1.4], [-2.0, 0.3, -1.6, 2.1], [1.4, 0.3, -1.4, 1.8],
    [-2.6, 4.3, -1.4, 1.7], [-0.4, 4.4, -0.6, 1.4]],
}); RIGHT('house_b', 133, 3.8);
// north of the square
LEFT('house_e', 189, 4.0); LEFT('house_d', 199.5, 2.2); LEFT('house_f', 210, 4.0); LEFT('barn', 225, 3.7);
RIGHT('house_c', 190, 3.1); RIGHT('house_a', 202, 2.85); RIGHT('house_d', 213, 2.2); RIGHT('house_b', 223.5, 3.8); RIGHT('house_e', 238, 4.0);
// the square: church on the right with its tower to the street, houses on the left
P('church', -26.5, 165, 90, { pad: true, id: 'church' });
P('house_g', 18.6, 157, -90, { pad: true, id: 'cafe' }); P('house_a', 18.3, 170, -90, { pad: true });
P('fountain', 3, 165, 0);
P('lamp_post', -9.5, 154, 90, { light: true }); P('lamp_post', 9.5, 177, -90, { light: true });
P('signpost', -11.2, 151.8, 90);
P('cross', -9, 181, 45);
P('sandbags', -6, 174, 0); P('sandbags_curve', 7, 172, 180); P('sandbags_low', -10, 157, 70);
P('crate_large', 9, 160, 20); P('crate', 10.2, 161.5, 70); P('barrel', -3, 180, 0);
P('cart', 11, 183, -30);
// the street between
P('truck_burnt', -1.2, 117, 168, { fire: true, debris: 4 });
P('sandbags', 2.2, 129, -8); P('crate', -2.5, 131, 30); P('crate_large', -3.3, 126, 80);
P('barrel', 3.8, 104, 0); P('jerrycan', 4.1, 105, 30);
P('pole', 4.8, 145, 0); P('pole', 4.8, 205, 0);
P('sandbags', -1.5, 203, 5); P('sandbags_low', 2.5, 217, -5); P('crate', -3.6, 232, 10); P('barrel', 3.9, 238, 0);
P('lamp_post', 4.7, 244, -90, { light: true });
P('signpost', -4.2, 247, 160);
// back gardens, west (left) — walls, fences, sheds: the way round
for (const z of [95, 117, 141]) { P('wall_low', 15.5, z, 90); }
P('fence', 22, 96, 0); P('fence', 25, 96, 0); P('shed', 24, 108, -90); P('wall_broken', 24, 120, 90); P('haystack', 30, 130, 0);
P('fence', 20, 146, 0); P('fence', 23, 146, 0); P('wall_low', 28, 146, 0);
P('shed', 23, 190, 180); P('wall_low', 16, 200, 90); P('wall_low', 16, 204, 90); P('fence', 21, 218, 0); P('haystack', 30, 206, 30); P('cart', 26, 235, 100);
for (let z = 92; z < 252; z += 4) P('hedge', 44, z, 90 + (z % 8 ? 180 : 0), { veg: true });
// back gardens, east (right)
for (const z of [104, 128]) P('wall_low', -15.5, z, 90);
P('fence', -20, 95, 0); P('shed', -25, 116, 90); P('wall_high', -22, 140, 0); P('wall_high', -18, 140, 0);
P('wall_low', -16, 196, 90); P('fence', -22, 206, 0); P('fence', -25, 206, 0); P('shed', -26, 220, 90); P('haystack', -30, 232, 0);
for (let z = 92; z < 252; z += 4) P('hedge', -44, z, 90 + (z % 8 ? 0 : 180), { veg: true });

// --- the river ---
P('bridge_stone', 0, 270, 0, { y: 2.0, id: 'bridge' });
P('log_bridge', 32, RIVER_Z(32), 0, { y: null, id: 'logbridge' });
const NEST_BRIDGE = P('mg_nest', 5, 287.5, 180, { id: 'nest_bridge' });
P('barbed_wire', -2.5, 284.5, 0); P('sandbags', -6, 289, 10); P('sandbags_low', 11, 288, -10);
P('crate', 8.5, 292, 0); P('hedgehog', 3, 281.5, 30);
P('barbed_wire', -27, 280, 15); P('barbed_wire', -36, 281, -10);

// --- the forest ---
const fox = (x, z) => { P('sandbags_low', x, z - 2.0, 0); };
for (const [fx, fz] of FOXHOLES) fox(fx, fz);
// trench walls, parapets and the gap where the track crosses
const trench = (line) => {
  // revetments face into the trench (offset + is the south side for these lines)
  along(line, 3.9, 0.86, (x, z, yaw) => P('trench_wall', x, z, yaw, { y: trenchWallY }));
  along(line, 3.9, -0.86, (x, z, yaw) => P('trench_wall', x, z, yaw + 180, { y: trenchWallY }));
  // sandbags here and there on the rear (north) lip, never in front of the firing line,
  // nor where a bend or the communication trench would put the 3 m row over a trench
  along(line, 9.0, -2.1, (x, z, yaw, tx, tz) => {
    const clear = [-1.5, 0, 1.5].every((k) => TRENCHES.every(([T]) => { polylineDistance(T, x + tx * k, z + tz * k, tmpD); return tmpD.d > 1.6; }));
    if (clear) P('sandbags_low', x, z, yaw);
  }, 0, 1e9);
};
trench(TRENCH_W); trench(TRENCH_E);
along(TRENCH_C, 3.9, 0.86, (x, z, yaw) => P('trench_wall', x, z, yaw, { y: trenchWallY }));
along(TRENCH_C, 3.9, -0.86, (x, z, yaw) => P('trench_wall', x, z, yaw + 180, { y: trenchWallY }));
const NEST_TRENCH = P('mg_nest', 2, 392, 180, { id: 'nest_trench' });
P('barbed_wire', -3, 383, 0); P('barbed_wire', 7, 382.5, 0); P('hedgehog', 2, 380, 15);
P('barbed_wire', -24, 380, 5); P('barbed_wire', 26, 380, -5); P('barbed_wire', -12, 381, 0); P('barbed_wire', 16, 381, 0);
// in front of the line what the shelling set alight still burns - beams of a blown-in dugout, a log -
// their light flickering over the wire and the parapet
P('beam_charred', -14, 371, 35, { burning: 0.7 }); P('beam_charred', 19, 368.5, -60, { burning: 0.55 });
P('log', 7.5, 361, 20, { burning: 0.6 });
P('crate', -22, 398, 20); P('crate_large', 10, 398, -15);
P('bunker', BUNKER.x, BUNKER.z, 180, { pad: true, id: 'bunker' });
P('sandbags', -1, 452, -20); P('sandbags_curve', 16, 449, 200); P('barbed_wire', 6, 438, 0); P('barbed_wire', 14, 437, 10);
P('crate', 4, 456, 0); P('barrel', 13, 455, 0);
// the clearing
P('flak38', 4, 511, 200, { pad: true, id: 'flak' });
P('sandbags_curve', 7.5, 508, 0); P('sandbags_curve', 0.5, 508, 90); P('sandbags', 4, 515.5, 180);
P('tent', -13, 514, 120, { pad: true }); P('radio_table', -10, 509, 90, { id: 'radio' });
P('truck', -6, 527, 95, { pad: true }); P('crate_large', -1, 523, 10); P('crate', 0.5, 524.5, 60); P('barrel', 9, 524, 0); P('barrel', 9.6, 524.8, 0); P('jerrycan', 10.2, 523.2, 40);
P('watchtower', 17, 496, 200, { id: 'tower', light: true });          // its lamp lit over the camp
P('sandbags_low', -15, 500, 30); P('sandbags_low', 13, 519, -60);
P('signpost', 3, 540, 180);
// rocks and logs along the forest way
P('outcrop', -20, 338, 70); P('outcrop', 25, 420, -40); P('outcrop', -27, 470, 15);
P('boulder_c', 10, 332, 20); P('boulder_b', -12, 372, 80); P('boulder_c', 18, 362, 110); P('boulder_b', -14, 418, 5);
P('boulder_c', 0, 466, 40); P('boulder_b', 15, 478, 140); P('boulder_a', -9, 436, 10);
P('log', 6, 320, 70); P('log', -16, 410, 20); P('log', 14, 462, -30); P('log', -10, 488, 80);
P('tree_dead', -4, 306, 0, { veg: true }); P('tree_dead', 11, 372, 40, { veg: true });

/* ---------- dressing: what makes the place lived in, and fought over ---------- */

const above = (h) => (x, z) => baseHeight(x, z) + h;
const ivy = (x, z, yaw) => P('ivy_patch', x, z, yaw, { y: above(0.0) });
// the street: rubble and beams from the shelled houses, a bicycle, lamps on the walls
P('rubble_pile', 6.2, 122, -80); P('rubble_small', 4.6, 127.5, 30); P('rubble_small', 3.8, 119, 140);
P('beam_charred', 4.4, 124.5, 75); P('rubble_pile', -6.4, 120.5, 95); P('beam_charred', -5.2, 118.2, 20);
P('rubble_small', -4.5, 124.5, 10); P('rubble_small', 3.6, 141, 60); P('rubble_small', -3.9, 186, 200);
P('bicycle', FRONT - 0.4, 111, 0); P('barrel_wood', 5.0, 104.6, 0); P('barrel_wood', 5.2, 103.6, 40);
// wall lamps beside the doors, on the bare stretch of wall between door and window
// (tests/route-check.mjs checks each one has a wall behind it)
P('wall_lamp', FRONT, 102.15, -90, { y: above(2.7), light: true });          // house_a
P('wall_lamp', FRONT, 188.1, -90, { y: above(2.7), light: true });           // house_e
P('wall_lamp', -FRONT, 203, 90, { y: above(2.7), light: true });             // house_a
P('poster_board', 11.5, 150.5, 0);
P('steps_stone', -8.7, 165, 90);
P('ivy_patch', FRONT, 97.8, -90, { y: above(0.0), scale: 0.8 });             // up to house_a's corner
P('ivy_patch', -7.3, 130.1, 180, { y: above(0.0) });                         // house_b's alley walls, clear of its lantern
P('ivy_patch', -7.3, 220.6, 180, { y: above(0.0) });
ivy(FRONT, 201.2, -90); ivy(FRONT, 220.5, -90);
// the square (the café has its own knocked-over terrace)
P('furniture_broken', 9.2, 151.5, 140); P('bench', -11.2, 175, 90); P('bench', 12.8, 175.5, -90);
P('barrel_wood', 13.4, 163.4, 0);
// churchyard behind the church
for (let i = 0; i < 9; i++) P(i % 3 ? 'grave_a' : 'grave_b', -33 + (i % 3) * 3.2, 176 + Math.floor(i / 3) * 2.6, 180 + (i * 37) % 20 - 10);
P('churchyard_wall', -38, 174, 90); P('churchyard_wall', -38, 178, 90); P('churchyard_wall', -38, 182, 90);
P('churchyard_wall', -35.8, 184.2, 0); P('churchyard_wall', -31.8, 184.2, 0); P('churchyard_wall', -27.8, 184.2, 0);
P('cross', -30, 186.5, 0);
// German vehicles and positions in the village
P('kubelwagen', -8.5, 146.5, 30); P('motorcycle_sidecar', 7.6, 95.6, -150);
P('ammo_stack', 7.8, 89.2, 0); P('sandbags_ruined', -1.8, 99.5, 15); P('jerrycan_stack', -9.5, 92.4, 0);
P('pak40', -2.5, 244.5, 180, { id: 'pak' }); P('ammo_stack', -4.8, 249.5, 30);
P('halftrack_wreck', 8.2, 253.5, 160, { fire: true, debris: 3 });
// gardens: a well, a trough, picket fences, nettles and brambles in the corners
P('well', 31, 120, 0); P('water_trough', 13.8, 229, -90); P('fence_picket', 18, 166, 90); P('fence_picket', 18, 179, 90);
P('fence_picket', -18, 104, 90); P('fence_picket', -18, 107, 90);
// the river: casualties of the first try at the bridge
P('stretcher', -4.2, 252.5, 70); P('dropped_helmet_us', -2.2, 255.4, 0); P('dropped_helmet_us', 3.6, 249.8, 120);
P('sandbags_ruined', 3.8, 292.5, 180); P('sign_minen', -14, 283.5, 200); P('sign_minen', 18, 284, 170);
// the forest positions
P('camo_net', 2, 392.5, 180); P('dugout_entrance', -24, 404.5, 180); P('ammo_stack', -18.5, 401.5, 20);
P('cable_reel', -13.5, 399.5, 50); P('field_telephone', -20.5, 396.6, 180); P('sign_minen', -30, 377, 190);
P('sign_minen', 30, 377.5, 170); P('sandbags_ruined', -10, 395, 0); P('dropped_helmet_de', 12, 401, 60);
P('mg42_tripod', 3.5, 454, 200); P('drum_stack', 14.5, 458.5, 0);
P('camo_net', 4, 511, 200); P('jerrycan_stack', 11.8, 525.6, 10); P('drum_stack', -16.5, 523.5, 40);
P('field_telephone', -9.2, 507.6, 90); P('cable_reel', -7.2, 503.6, 0); P('stretcher', -17.2, 509.5, 120);
P('kubelwagen', 14.5, 530.5, -70);

// the farms burning beyond the hedges (out of reach, seen through the trees)
P('ruin_b', -68, 152, 60); P('ruin_b', 64, 302, -110); P('barn', -61, 433, 20);

/* ---------- ground clutter (drawn near the camera, nothing to walk round) ---------- */
// small things on the ground: leaves and litter in the gutters, brick bits
// round the shelled houses, stones and fallen branches along the lane and the
// forest track, the leavings of the fighting behind the machine-gun nests.
// Its own seed, so the vegetation below keeps its places; levelBuild drops
// anything that would land inside something solid.

const RC = rng(19440711);
const clutter = [];
const C = (m, x, z, scale, yaw = RC() * 360) => { clutter.push({ m, x, z, yaw, scale }); };
/* walk a line in steps of `step` metres: fn(x, z, nx, nz) with (nx, nz) its normal */
function alongLine(line, step, fn) {
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    for (let t = carry; t < len; t += step) fn(ax + dx * t, az + dz * t, dz, -dx);
    carry = (carry - len) % step;
    if (carry < 0) carry += step;
  }
}
// the street: the foot of the walls either side (not across the square)
alongLine(STREET, 1.1, (x, z, nx, nz) => {
  if (z < 90 || z > 256 || (z > SQUARE.z0 - 2 && z < SQUARE.z1 + 2)) return;
  const shelled = Math.max(0, 1 - Math.abs(z - 123) / 11);      // the two shelled houses
  for (const side of [-1, 1]) {
    const off = (FRONT - 0.35 - RC() * 1.1) * side;
    const px = x + nx * off, pz = z + nz * off, r = RC();
    if (r < 0.3) C('leaf_litter', px, pz, RC.range(0.35, 0.6));
    else if (r < 0.36 + 0.45 * shelled) C('rubble_small', px, pz, RC.range(0.26, 0.48));
    else if (r < 0.44 + 0.45 * shelled) C('rocks_small', px, pz, RC.range(0.28, 0.45));
    else if (r < 0.455 + 0.45 * shelled) C(RC.pick(['ammo_box', 'jerrycan']), px, pz, 1);
  }
  // brick and plaster thrown out into the street by the shells
  if (shelled > 0.2 && RC() < shelled * 0.7) C('rubble_small', x + nx * RC.range(-4.4, 4.4), z + nz * RC.range(-4.4, 4.4), RC.range(0.2, 0.36));
});
// the sunken lane: stones, sticks and leaves along its banks
alongLine(LANE, 1.0, (x, z, nx, nz) => {
  if (z < -28 || z > 82) return;
  for (const side of [-1, 1]) {
    const off = RC.range(3.0, 4.5) * side, px = x + nx * off, pz = z + nz * off, r = RC();
    if (r < 0.14) C('rocks_small', px, pz, RC.range(0.35, 0.7));
    else if (r < 0.24) C('branches', px, pz, RC.range(0.6, 1.0));
    else if (r < 0.36) C('leaf_litter', px, pz, RC.range(0.4, 0.7));
  }
});
// the forest track: fallen branches, leaves, stones at its edges
alongLine(TRACK, 1.2, (x, z, nx, nz) => {
  if (z < 286 || z > 560) return;
  for (const side of [-1, 1]) {
    const off = RC.range(2.3, 3.8) * side, px = x + nx * off, pz = z + nz * off, r = RC();
    if (r < 0.18) C('branches', px, pz, RC.range(0.6, 1.0));
    else if (r < 0.32) C('leaf_litter', px, pz, RC.range(0.4, 0.7));
    else if (r < 0.4) C('rocks_small', px, pz, RC.range(0.3, 0.55));
  }
});
// behind the machine-gun nests (they face south): ammunition, a helmet, a can
for (const [nx0, nz0] of [[-6.5, 89.5], [5, 287.5], [2, 392]]) {
  for (let k = 0; k < 6; k++) {
    const a = RC.range(-1.2, 1.2), d = RC.range(2.4, 4.4);
    C(RC.pick(['ammo_box', 'ammo_box', 'jerrycan', 'dropped_helmet_de', 'rocks_small']), nx0 + Math.sin(a) * d, nz0 + Math.cos(a) * d, 1);
  }
}

/* ---------- vegetation scatter ---------- */

const R = rng(20250719);
const scatter = [];
function noTree(x, z) {
  polylineDistance(STREET, x, z, tmpD); if (tmpD.d < 9 && z < 262) return true;
  polylineDistance(LANE, x, z, tmpD); if (tmpD.d < 7.5 && z < 86) return true;
  if (z > 276) { polylineDistance(TRACK, x, z, tmpD); if (tmpD.d < 4.5) return true; }
  if (Math.abs(z - RIVER_Z(x)) < 12) return true;
  for (const T of [TRENCH_W, TRENCH_E, TRENCH_C]) { polylineDistance(T, x, z, tmpD); if (tmpD.d < 3.5) return true; }
  if (Math.hypot(x - CLEARING.x, z - CLEARING.z) < CLEARING.r) return true;
  if (Math.hypot(x - BUNKER.x, z - BUNKER.z) < 11) return true;
  for (const [fx, fz] of FOXHOLES) if (Math.hypot(x - fx, z - fz) < 3.5) return true;
  return false;
}
// forest
// mature specimens fall back to a scaled-up ordinary tree until their models exist
const BIG = { pine_big: ['pine_a', 1.45], fir_big: ['pine_b', 1.5], oak_big: ['oak_a', 1.5], beech_big: ['oak_b', 1.55] };
const tree = (m, x, z, scale, o = {}) => {
  const big = BIG[m];
  scatter.push({ m, x, z, yaw: R() * 360, scale, ...(big ? { alt: big[0], altScale: big[1] } : {}), ...o });
};
for (let i = 0; i < 5400; i++) {
  const x = R.range(-92, 92), z = R.range(279, 600);
  if (noTree(x, z)) continue;
  const r = R();
  const m = r < 0.22 ? R.pick(['pine_big', 'fir_big']) : r < 0.5 ? R.pick(['pine_a', 'pine_b', 'pine_c']) : r < 0.6 ? R.pick(['oak_big', 'beech_big'])
    : r < 0.74 ? R.pick(['oak_a', 'oak_b']) : r < 0.8 ? 'birch_a' : r < 0.83 ? 'tree_dead' : R.pick(['bush_a', 'bush_b', 'bramble']);
  tree(m, x, z, m.startsWith('bush') || m === 'bramble' ? 0.8 + R() * 0.5 : 0.95 + R() * 0.55);
}
for (let i = 0; i < 260; i++) {
  const x = R.range(-60, 60), z = R.range(285, 560);
  if (noTree(x, z)) continue;
  scatter.push({ m: R.pick(['boulder_a', 'boulder_b', 'rocks_small', 'stump', 'log', 'boulder_a']), x, z, yaw: R() * 360, scale: 0.8 + R() * 0.5, rock: true });
}
// trees around the village and the fields, the far bank to the south
for (let i = 0; i < 1300; i++) {
  const x = R.range(-98, 98), z = R.range(-44, 262);
  if (Math.abs(x) < 47 && z > -20) continue;
  const r = R();
  const m = r < 0.25 ? R.pick(['oak_big', 'beech_big']) : r < 0.6 ? R.pick(['oak_a', 'oak_b']) : r < 0.75 ? 'birch_a' : r < 0.85 ? 'pine_big' : R.pick(['pine_a', 'pine_b']);
  tree(m, x, z, 0.95 + R() * 0.5);
}
// garden trees and bushes
for (let i = 0; i < 70; i++) {
  const side = R.sign();
  const x = side * R.range(16, 42), z = R.range(92, 250);
  if (noTree(x, z)) continue;
  scatter.push({ m: R() < 0.35 ? R.pick(['oak_a', 'oak_b']) : R.pick(['bush_a', 'bush_b']), x, z, yaw: R() * 360, scale: R() < 0.35 ? 0.55 + R() * 0.2 : 0.8 + R() * 0.4 });
}
// river banks: reeds and bushes
for (let i = 0; i < 220; i++) {
  const x = R.range(-70, 70);
  const side = R.sign();
  const z = RIVER_Z(x) + side * R.range(6.5, 11);
  if (Math.abs(x) < 4) continue;
  scatter.push({ m: R() < 0.8 ? 'reeds' : 'bush_a', x, z, yaw: R() * 360, scale: 0.8 + R() * 0.5, cover: R() < 0.8 });
}

/* ---------- ground cover (instanced near the camera) ---------- */

const cover = [];
for (let i = 0; i < 42000; i++) {
  const x = R.range(-60, 60), z = R.range(-30, 570);
  polylineDistance(STREET, x, z, tmpD); if (tmpD.d < 5.5 && z < 258) continue;
  polylineDistance(LANE, x, z, tmpD); if (tmpD.d < 3.2 && z < 86) continue;
  if (z > 276) { polylineDistance(TRACK, x, z, tmpD); if (tmpD.d < 2.2) continue; }
  if (Math.abs(z - RIVER_Z(x)) < 7.5) continue;
  if (x > SQUARE.x0 && x < SQUARE.x1 && z > SQUARE.z0 && z < SQUARE.z1) continue;
  let m = 'grass_tuft';
  const q = R();
  if (z > 285) m = q < 0.3 ? 'fern' : q < 0.55 ? 'leaf_litter' : q < 0.62 ? 'branches' : q < 0.66 ? 'mushrooms' : q < 0.74 ? 'ivy_ground' : 'grass_tuft';
  else if (z < 88) m = q < 0.45 ? 'grass_tall' : q < 0.55 ? 'weeds' : 'grass_tuft';
  else m = q < 0.15 ? 'nettles' : q < 0.3 ? 'weeds' : q < 0.4 ? 'grass_tall' : 'grass_tuft';
  cover.push({ m, x, z, yaw: R() * 360, scale: 0.7 + R() * 0.6 });
}

/* ---------- enemies ---------- */

const E = (type, x, z, yaw, group, o = {}) => ({ type, at: [x, z], yaw, group, ...o });
const enemies = [
  // checkpoint
  E('mg', 0, 0, 180, 'gate', { nest: 'nest_gate', arc: 0.9 }),
  E('rifle', 3.2, 88.5, 180, 'gate'),
  E('rifle', -1, 93, 180, 'gate', { patrol: [[-1, 93], [4.5, 97], [1, 100]] }),
  E('rifle', 14, 86, 200, 'gate', { leash: 10 }),
  // main street
  E('smg', 1.5, 113, 180, 'street'),
  E('rifle', -3.5, 125, 190, 'street'),
  E('rifle', 3.2, 132, 170, 'street'),
  E('rifle', 9.5, 124, 210, 'street', { leash: 8 }),
  E('rifle', 21, 118, 180, 'street', { patrol: [[21, 103], [21, 135]] }),
  E('rifle', -21, 110, 180, 'street', { patrol: [[-21, 100], [-21, 130]] }),
  // the square
  E('sniper', 0, 0, 90, 'square', { anchorOf: ['church', 'sniper'] }),
  E('smg', 2, 170, 180, 'square'),
  E('rifle', -6, 176, 180, 'square'),
  E('rifle', 7.5, 175, 190, 'square'),
  E('rifle', -10, 160, 150, 'square', { patrol: [[-8, 152], [8, 152], [9, 178], [-8, 178]] }),
  E('smg', 11, 163, 220, 'square'),
  // north street
  E('rifle', -1.5, 206, 180, 'north'),
  E('rifle', 2.5, 220, 175, 'north', { patrol: [[2.5, 205], [2.5, 240]] }),
  E('smg', -3.5, 234, 185, 'north'),
  E('rifle', -19, 205, 160, 'north', { leash: 10 }),
  // the bridge
  E('mg', 0, 0, 180, 'bridge', { nest: 'nest_bridge', arc: 0.8 }),
  E('rifle', -6, 291, 180, 'bridge'),
  E('rifle', 11, 290.5, 170, 'bridge'),
  E('rifle', -1, 297, 180, 'bridge', { patrol: [[-12, 296], [12, 296]] }),
  E('rifle', -30, 286, 160, 'ford', { leash: 8 }),
  E('rifle', 30, 288, 200, 'logbridge', { leash: 8 }),
  // two men walking the forest track, one each way
  E('rifle', -4, 305, 0, 'track', { patrol: [[-4, 305], [-9, 326], [-7, 350], [1, 371]] }),
  E('rifle', 1, 371, 180, 'track', { patrol: [[1, 371], [-7, 350], [-9, 326], [-4, 305]] }),
  // foxholes
  E('rifle', 2, 340, 190, 'fox', { hold: true, stance: 'crouch' }),
  E('rifle', 9, 352, 190, 'fox', { hold: true, stance: 'crouch' }),
  E('smg', -16, 358, 170, 'fox', { hold: true, stance: 'crouch' }),
  // the trench line
  E('rifle', -33, 386.5, 180, 'trench', { hold: true, inTrench: true }),
  E('rifle', -21, 386, 180, 'trench', { hold: true, inTrench: true }),
  E('rifle', -9, 387.2, 175, 'trench', { hold: true, inTrench: true }),
  E('rifle', 13, 389, 185, 'trench', { hold: true, inTrench: true }),
  E('smg', 22, 386, 180, 'trench', { hold: true, inTrench: true }),
  E('rifle', 34, 387.5, 180, 'trench', { hold: true, inTrench: true }),
  E('mg', 0, 0, 180, 'trench', { nest: 'nest_trench', arc: 0.9 }),
  // the bunker
  E('mg', 0, 0, 180, 'bunker', { bunker: 'bunker', arc: 0.75 }),
  E('rifle', -1, 454.5, 160, 'bunker'),
  E('rifle', 16, 452, 200, 'bunker', { patrol: [[16, 452], [22, 440], [8, 432], [-2, 440]] }),
  // the clearing
  E('smg', -10, 506, 160, 'clearing', { tough: 1.5 }),
  E('rifle', 6, 503, 180, 'clearing'),
  E('rifle', -4, 519, 190, 'clearing'),
  E('rifle', 12, 521, 200, 'clearing'),
  E('rifle', 0, 0, 200, 'clearing', { anchorOf: ['tower', 'lookout'], leash: 0 }),
  E('rifle', -16, 502, 150, 'clearing', { patrol: [[-16, 502], [-18, 520], [-6, 531], [-4, 512]] }),
  E('smg', 2, 529, 180, 'clearing'),
];

/* ---------- pickups, checkpoints, objectives ---------- */

const pickups = [
  { type: 'medkit', x: 4.2, z: 58 }, { type: 'ammo', x: -2, z: 96 }, { type: 'medkit', x: -13, z: 141 },
  { type: 'grenades', x: 12, z: 166 }, { type: 'ammo', x: -4, z: 182 }, { type: 'medkit', x: 26, z: 150 },
  { type: 'medkit', x: 2, z: 249 }, { type: 'ammo', x: 8, z: 295 }, { type: 'medkit', x: -6, z: 303 },
  { type: 'grenades', x: -10, z: 362 }, { type: 'ammo', x: 0, z: 400 }, { type: 'medkit', x: 9, z: 404 },
  { type: 'grenades', x: -3, z: 432 }, { type: 'medkit', x: -7, z: 472 }, { type: 'ammo', x: 6, z: 458 },
  { type: 'medkit', x: -12, z: 519 },
];

const checkpoints = [
  { x: 0.5, z: -6, spawn: [0.5, -6, 0] },
  { x: 0, z: 96, r: 7, spawn: [0, 96, 0] },
  { x: 0, z: 150, r: 7, spawn: [0, 147, 0] },
  { x: 0, z: 248, r: 8, spawn: [0, 246, 0] },
  { x: -3, z: 300, r: 10, spawn: [-3, 300, 0] },
  { x: 5, z: 402, r: 12, spawn: [5, 402, 0] },
  { x: -5, z: 468, r: 9, spawn: [-5, 468, 0] },
];

const objectives = [
  { id: 'enter', text: 'Take the checkpoint at the edge of Saint-Clair', kind: 'reach', x: 0, z: 95, r: 8 },
  { id: 'square', text: 'Fight up the main street to the church square', kind: 'reach', x: 0, z: 158, r: 10 },
  { id: 'river', text: 'Cross the river — bridge, ford or fallen tree', kind: 'cross', z: 283, marker: [0, 282] },
  { id: 'trench', text: 'Break through the trench line', kind: 'cross', z: 400, marker: [2, 398] },
  { id: 'bunker', text: 'Get past the bunker covering the track', kind: 'cross', z: 462, marker: [-4, 462] },
  { id: 'flak', text: 'Destroy the flak gun in the clearing', kind: 'destroy', target: 'flak', x: 4, z: 511 },
  { id: 'rally', text: 'Reach the rally point on the forest road', kind: 'reach', x: 0, z: 549, r: 7 },
];

const hints = [
  { x: 0.5, z: -2, r: 6, text: 'WASD to move, mouse to look', sub: 'Hold the right button to aim, left to fire' },
  { x: 2, z: 20, r: 6, text: 'C to crouch', sub: 'Crouched, you are harder to see and to hit' },
  { x: -1, z: 42, r: 6, text: 'The lane leads straight into their machine gun', sub: 'Gaps in the hedges lead to the orchard (left) and the ditch (right)' },
  { x: 18, z: 76, r: 7, text: 'Space vaults over low walls' },
  { x: 0, z: 104, r: 7, text: 'G throws a grenade', sub: 'Hold G to cook it first' },
  { x: 0, z: 140, r: 8, text: 'Watch the church tower', sub: 'A glint means a sniper is lining up' },
  { x: 0, z: 255, r: 7, text: 'Their machine gun covers the bridge', sub: 'A ford lies downstream (left), a fallen tree upstream (right)' },
];

export default {
  id: 'saint-clair',
  title: 'Saint-Clair',
  when: 'Normandy, 11 July 1944 — dusk, rain',
  briefing: [
    'Second platoon is pinned south of the village. The road north runs through Saint-Clair, over the river and up through the Bois de Clair, where the enemy has dug in to cover the withdrawal of a flak battery.',
    'You go ahead alone along the sunken lane. Get into the village, clear a way to the bridge and push through the forest. Their 20 mm flak gun in the clearing is shooting up our spotter planes — put a charge on it.',
    'The light is going and the rain will cover you. Stay low, use the hedges and the walls. There is always another way round.',
  ],
  start: [0.5, -6, 0],
  bounds: { minX: -100, maxX: 100, minZ: -45, maxZ: 610 },
  playBounds: { minX: -46, maxX: 46, minZ: -24, maxZ: 556 },
  fine: [[-46, 376, 46, 410], [-20, 336, 20, 366]],
  water: { level: 0, contains: (x, z) => Math.abs(z - RIVER_Z(x)) < 13, riverZ: RIVER_Z, x0: -100, x1: 100 },
  baseHeight, splat, trackHeight,
  props, scatter, cover, clutter, enemies, pickups, checkpoints, objectives, hints,
  fog: { color: '#383e45', density: 0.0048 },
  // farms burning beyond the hedges: flames low, smoke high
  farFires: [[-68, 3, 150, 2.6], [64, 6, 300, 2.2], [-60, 14, 430, 2.0]],
  // beyond the level: the next village up the valley, farms on the slopes
  far: {
    treeRange: 640,
    buildings: [
      { m: 'church', x: -330, z: 585, yaw: 70 }, { m: 'house_a', x: -312, z: 560, yaw: 100 }, { m: 'house_c', x: -300, z: 574, yaw: 95 },
      { m: 'house_d', x: -318, z: 548, yaw: 80 }, { m: 'house_b', x: -305, z: 600, yaw: 110 }, { m: 'house_e', x: -345, z: 556, yaw: 60 },
      { m: 'barn', x: -290, z: 540, yaw: 30 }, { m: 'house_f', x: -352, z: 612, yaw: 140 }, { m: 'ruin_b', x: -296, z: 620, yaw: 120 },
      { m: 'barn', x: 255, z: 110, yaw: -20 }, { m: 'house_d', x: 268, z: 96, yaw: -110 }, { m: 'haystack', x: 246, z: 92 },
      { m: 'house_a', x: 310, z: 395, yaw: -80 }, { m: 'barn', x: 296, z: 410, yaw: -60 },
      { m: 'house_c', x: -240, z: 40, yaw: 40 }, { m: 'shed', x: -232, z: 52, yaw: 10 },
      { m: 'church', x: 380, z: 760, yaw: -100 }, { m: 'house_a', x: 362, z: 742, yaw: -90 }, { m: 'house_b', x: 372, z: 776, yaw: -80 },
    ],
  },
  // where low mist gathers: the river, the wet fields, hollows in the forest
  mist: (x, z) => {
    const river = smoothstep(30, 8, Math.abs(z - RIVER_Z(x)));
    const fields = smoothstep(90, 70, z) * 0.6;
    const forest = smoothstep(290, 320, z) * 0.55;
    const village = smoothstep(85, 95, z) * smoothstep(255, 245, z) * 0.25;
    return Math.min(1, river + fields + forest + village);
  },
  ambience: { rain: 1, wind: [1.6, 0.7] },
  lines: { LANE, STREET, TRACK, TRENCH_W, TRENCH_E, TRENCH_C },
  craters: CRATERS,
};
