/* Hedgerow — Mission 2: La Varenne, the morning of 6 June 1944.

   An original scenario inspired by the D-Day morning assaults on German gun
   batteries behind the beaches, when small groups of scattered paratroopers
   took guns dug in along a hedgerow, working along the trench that joined
   them, one gun at a time.

   The player lands in the south field (z ≈ -10) with the supply canisters,
   gets through the first hedgerow, crosses the long meadow and takes the
   three guns along the battery hedgerow (z ≈ 142; their barrels point north,
   at the causeway behind the beach; the infantry's trench runs along the
   hedge's south side, an MG nest at each end), then blows the ammunition in
   the farmyard of La Varenne (z ≈ 210) and reaches the road beyond it.

   Ways round: the sunken lane up the west side (under the west MG), the
   track through the orchard on the east (under the east MG), or the meadow
   between them from crater to crater; the trench can be entered at either
   end or jumped into from the hedge gaps.

   World axes as Saint-Clair: +z north (the way forward), +x west (the
   player's left), yaw 0 turns a model's front to +z, 180 to the south. */

import { fbm2, smoothstep, smoothPolyline, rng, lerp, polylineDistance } from '../util.js';
import { bbox, inBox, near, along, hedgeBanks, roughGround, cutTrench } from './kit.js';

/* ---------- lines on the ground ---------- */

const LANE = smoothPolyline([[44, -28], [45, 10], [43, 50], [45, 95], [44, 140], [42, 172], [34, 194], [22, 205]], 2);
const TRACK = smoothPolyline([[-36, -24], [-38, 20], [-40, 58], [-42, 100], [-44, 142], [-42, 170], [-30, 194], [-16, 204]], 2);
const ROAD = smoothPolyline([[-2, 198], [-7, 214], [-11, 230], [-12, 248], [-12, 270]], 2);
const TRENCH_A = smoothPolyline([[34, 135.5], [24, 137.8], [12, 134.6], [-2, 137.8], [-16, 134.6], [-28, 137.8], [-38, 135.2]], 1);
const TRENCH_DEPTH = 1.25;
const YARD = { x0: -18, x1: 18, z0: 198, z1: 224 };
const GUNS = [[24, 147.5], [-2, 147.5], [-28, 147.5]];

const BOX = { LANE: bbox(LANE, 10), TRACK: bbox(TRACK, 10), ROAD: bbox(ROAD, 10), TA: bbox(TRENCH_A, 6) };

/* the hedgerows on their banks: straight runs; a gap is where none runs */
const HEDGES = hedgeBanks([
  // the lane's own hedges, either side of it, with gaps into the fields
  [50, -26, 50, 96], [50, 104, 51, 176],
  [38, -26, 38, 26], [38, 34, 38, 98], [38, 106, 38, 150], [38, 158, 36, 172],
  // the field edges west and east
  [-54, -26, -54, 250], [56, 176, 40, 250],
  // the first hedgerow (gaps: the gate in the middle, the track's on the east)
  [36, 58, 8, 58], [2, 58, -34, 58], [-48, 58, -54, 58],
  // the battery's hedgerow, cut for the three guns' fields of fire and for the track
  [36, 142, 30, 142], [18, 142, 4, 142], [-8, 142, -22, 142], [-34, 142, -38, 142], [-50, 142, -54, 142],
  // between the north field and the farm (a gate under the manor's windows)
  [36, 192, 26, 192], [6, 192, -12, 192], [-22, 192, -54, 192],
]);

const TMP = {};

/* the undisturbed ground: what trenches, lanes and pads follow so they stay level */
function lipHeight(x, z) {
  return 2.0 + fbm2(x / 52 + 3.1, z / 52 - 1.7, 3) * 0.8 + 6 * smoothstep(58, 90, Math.abs(x));
}

/* ---------- small irregularities ---------- */

function roughAllowed(x, z) {
  let k = 1;
  k = Math.min(k, smoothstep(3.5, 6.5, near(LANE, BOX.LANE, x, z)));
  k = Math.min(k, smoothstep(3.0, 5.5, near(TRACK, BOX.TRACK, x, z)));
  k = Math.min(k, smoothstep(3.0, 5.5, near(ROAD, BOX.ROAD, x, z)));
  k = Math.min(k, smoothstep(2.6, 5, near(TRENCH_A, BOX.TA, x, z)));
  k = Math.min(k, smoothstep(2.4, 4.5, HEDGES.dist(x, z)));
  for (const [gx, gz] of GUNS) k = Math.min(k, smoothstep(5, 8, Math.hypot(x - gx, z - gz)));
  if (x > YARD.x0 - 12 && x < YARD.x1 + 12 && z > YARD.z0 - 4 && z < YARD.z1 + 22) k = 0;
  return k;
}
const ROUGH = roughGround(rng(1944060), {
  mounds: 700, craters: 46, area: { x0: -60, x1: 60, z0: -30, z1: 260 }, craterArea: { x0: -40, x1: 34, z0: 0, z1: 190 }, allowed: roughAllowed,
});

/* ---------- the ground ---------- */

function baseHeight(x, z) {
  let h = lipHeight(x, z) + fbm2(x / 19, z / 19, 2) * 0.25;
  const k = roughAllowed(x, z);
  if (k > 0) h += k * (0.16 * fbm2(x / 5.3 + 11.7, z / 5.3 - 3.1, 3) + ROUGH.height(x, z));
  // the farm stands on a level patch
  const yard = smoothstep(14, 4, Math.max(YARD.x0 - x, x - YARD.x1, YARD.z0 - z, z - YARD.z1 - 12, 0));
  h = lerp(h, lipHeight(0, 212), yard);
  // the banks under the hedges
  h += HEDGES.rise(x, z);
  // the sunken lane, a metre down between its banks
  const dl = near(LANE, BOX.LANE, x, z);
  if (dl < 6) {
    polylineDistance(LANE, x, z, TMP);
    const laneH = lipHeight(TMP.px, TMP.pz) - 0.9 * smoothstep(196, 180, z);
    h = lerp(h, laneH, smoothstep(4.2, 2.4, dl));
  }
  // the farm track and the road out of the yard: flat, a little camber
  for (const [line, box] of [[TRACK, BOX.TRACK], [ROAD, BOX.ROAD]]) {
    const d = near(line, box, x, z);
    if (d < 5) { polylineDistance(line, x, z, TMP); h = lerp(h, lipHeight(TMP.px, TMP.pz) - 0.05 - d * d * 0.004, smoothstep(5, 2.2, d)); }
  }
  // the infantry's trench along the battery hedge, ramps at its ends
  h = cutTrench(TRENCH_A, BOX.TA, lipHeight, TRENCH_DEPTH, h, x, z);
  for (const [rx, rz] of [[34, 135.5], [-38, 135.2]]) {
    const d = Math.hypot(x - rx, z - rz);
    if (d < 4) h = lerp(h, lipHeight(rx, rz) - 0.2, smoothstep(4, 1.5, d) * 0.6);
  }
  // the guns' pits: dug in a little, a spoil bank in front
  for (const [gx, gz] of GUNS) {
    const d = Math.hypot(x - gx, z - gz);
    if (d < 7) h = lerp(h, lipHeight(gx, gz) - 0.35, smoothstep(5.2, 4.0, d)) + 0.5 * smoothstep(7, 5.6, d) * smoothstep(4.4, 5.6, d) * smoothstep(gz - 2, gz + 3, z);
  }
  return h;
}

/* ---------- ground textures: [mud, grass, forest floor, cobble] ---------- */

function splat(x, z) {
  let mud = 0, grass = 1, forest = 0, cobble = 0;
  const n = fbm2(x / 9, z / 9, 2);
  mud += smoothstep(0.2, 0.65, n) * 0.5;
  const dl = near(LANE, BOX.LANE, x, z), dt = near(TRACK, BOX.TRACK, x, z), dr = near(ROAD, BOX.ROAD, x, z);
  mud += smoothstep(3.6, 1.8, dl) * 2 + smoothstep(3.0, 1.5, dt) * 2 + smoothstep(3.0, 1.5, dr) * 1.6;
  mud += smoothstep(2.4, 1.0, near(TRENCH_A, BOX.TA, x, z)) * 2;
  // the banks: dark earth and leaf litter under the hedges
  const hd = HEDGES.dist(x, z);
  forest += smoothstep(2.6, 1.2, hd) * 0.8;
  for (const [gx, gz] of GUNS) mud += smoothstep(6, 3, Math.hypot(x - gx, z - gz)) * 1.5;
  mud += Math.min(1.5, Math.abs(ROUGH.height(x, z)) * 2.2);
  // the farmyard: setts under the mud, trodden to mud at the edges
  const inYard = x > YARD.x0 && x < YARD.x1 && z > YARD.z0 && z < YARD.z1;
  if (inYard) { cobble = smoothstep(0, 3, Math.min(x - YARD.x0, YARD.x1 - x, z - YARD.z0, YARD.z1 - z)) * (0.6 + 0.4 * smoothstep(-0.3, 0.3, n)); mud += 0.8; }
  // the orchard by the track
  if (x < -28 && z > 66 && z < 132) { forest += 0.35; }
  const s = mud + grass + forest + cobble * 3;
  if (cobble > 0.5) return [mud * 0.3 / s, grass * 0.05 / s, 0, 1];
  return [mud / s, grass / s, forest / s, cobble * 3 / s];
}

/* ---------- props ---------- */

const props = [];
const P = (m, x, z, yaw = 0, o = {}) => { props.push({ m, x, z, yaw, ...o }); return props[props.length - 1]; };
const above = (h) => (x, z) => baseHeight(x, z) + h;
const trenchWallY = (x, z) => lipHeight(x, z) - TRENCH_DEPTH - 0.42;

HEDGES.plant(P, above(-0.15));

// the drop zone: canisters, a helmet, a stretcher where the stick came down
P('supply_canister', 22, -4, 30); P('supply_canister', 14, 6, -60); P('supply_canister', 31, 12, 110);
P('crate', 16.5, 5, 20); P('stretcher', 24, 3, 75); P('pole', 8, 30, 0); P('pole', 8, 74, 0);
// the first hedgerow's gate
P('gate', 5, 57.5, 0); P('signpost', 10, 54, -20);
// the meadow: a burnt-out staff car in the gate's lee, haystacks, a cart
P('kubelwagen', -6, 82, 150, { fire: true, fireSize: 0.7, debris: 2 });
P('haystack', 20, 96, 0); P('haystack', -20, 108, 0); P('cart', 12, 118, 70); P('haystack', 26, 72, 0);
P('water_trough', -14, 70, 20);
P('supply_canister', -24, 92, 140);

// --- the battery: three guns in pits cut through the hedge, the infantry's trench behind ---
GUNS.forEach(([gx, gz], i) => {
  P('pak40', gx, gz, 0, { pad: true, y: lipHeight(gx, gz) - 0.35, id: `gun${i + 1}` });
  P('sandbags_curve', gx - 2.2, gz + 3.2, 20); P('sandbags_curve', gx + 2.2, gz + 3.2, -20);
  P('ammo_stack', gx + 3.6, gz - 0.5, 15 + i * 30);
  P('camo_net', gx, gz + 0.5, 0);
});
// trench walls and the sandbags on its lip (south: the side they fire from)
along(TRENCH_A, 3.9, 0.86, (x, z, yaw) => P('trench_wall', x, z, yaw, { y: trenchWallY }));
along(TRENCH_A, 3.9, -0.86, (x, z, yaw) => P('trench_wall', x, z, yaw + 180, { y: trenchWallY }));
along(TRENCH_A, 8.5, -2.1, (x, z, yaw) => P('sandbags_low', x, z, yaw + 180));
P('mg_nest', 38, 150, 200, { id: 'nest_w' });
P('mg_nest', -42, 151, 160, { id: 'nest_e' });
P('dugout_entrance', 8, 131, 0); P('field_telephone', 6.5, 132.4, 30); P('cable_reel', 15, 130, 20);
P('barbed_wire', 26, 127, 0); P('barbed_wire', 18, 127.5, 5); P('barbed_wire', -10, 127.5, -5); P('barbed_wire', -20, 127, 0);
P('sign_minen', 30, 126, 180); P('sign_minen', -30, 127, 190);

// --- the farm of La Varenne round its yard ---
P('house_e', 0, 232, 180, { pad: true });                      // the manor, its front on the yard
P('barn', -26, 213, 90, { pad: true });
P('house_c', 25, 215, -90, { pad: true });
P('shed', -10, 238, 0, { pad: true });
P('wall_high', 12, 196, 0); P('wall_high', 16, 196, 0); P('wall_high', -13, 196, 0);
P('ammo_stack', 6, 206, 30, { id: 'dump', separate: true });
P('ammo_stack', 8.8, 208.4, 75); P('jerrycan_stack', 3.4, 208.6, 10); P('drum_stack', 10.5, 204.2, 60);
P('camo_net', 7, 207, 30);
P('kubelwagen', -8, 213, 200); P('motorcycle_sidecar', 14, 222, 150);
P('well', 9, 220, 0); P('cart', -16, 222, 20); P('water_trough', -18, 207, 90);
P('haystack', -36, 228, 0); P('haystack', -40, 236, 0); P('barrel_wood', 19, 209, 0); P('barrel_wood', 19.6, 210.2, 0);
P('bench', -4, 225.6, 0); P('bicycle', 4.2, 226, 80);
P('radio_table', -4, 202, 160);
P('sandbags', -6, 197, 0); P('sandbags_low', 4, 197.5, 0);
P('signpost', -8, 246, 30);

/* ---------- ground clutter ---------- */

const RC = rng(19440606);
const clutter = [];
const C = (m, x, z, scale, yaw = RC() * 360) => { clutter.push({ m, x, z, yaw, scale }); };
along(LANE, 1.2, 0, (x, z) => {
  for (const side of [-1, 1]) {
    const px = x + side * RC.range(2.4, 3.6), pz = z + RC.range(-0.5, 0.5), r = RC();
    if (r < 0.14) C('rocks_small', px, pz, RC.range(0.35, 0.65));
    else if (r < 0.26) C('branches', px, pz, RC.range(0.6, 1.0));
    else if (r < 0.36) C('leaf_litter', px, pz, RC.range(0.4, 0.7));
  }
});
along(TRACK, 1.3, 0, (x, z) => {
  for (const side of [-1, 1]) {
    const px = x + side * RC.range(2.0, 3.2), pz = z, r = RC();
    if (r < 0.2) C('leaf_litter', px, pz, RC.range(0.4, 0.7));
    else if (r < 0.3) C('branches', px, pz, RC.range(0.6, 1.0));
  }
});
for (const [gx, gz] of GUNS) for (let k = 0; k < 7; k++) {
  const a = RC.range(0, Math.PI * 2), d = RC.range(2.5, 4.5);
  C(RC.pick(['ammo_box', 'ammo_box', 'jerrycan', 'dropped_helmet_de', 'rocks_small']), gx + Math.sin(a) * d, gz + Math.cos(a) * d, 1);
}
for (let k = 0; k < 18; k++) C(RC.pick(['dropped_helmet_us', 'ammo_box', 'branches']), RC.range(8, 34), RC.range(-14, 20), 1);

/* ---------- vegetation ---------- */

const R = rng(20250606);
const scatter = [];
const noTree = (x, z) => near(LANE, BOX.LANE, x, z) < 5 || near(TRACK, BOX.TRACK, x, z) < 4 || near(ROAD, BOX.ROAD, x, z) < 4
  || near(TRENCH_A, BOX.TA, x, z) < 4 || GUNS.some(([gx, gz]) => Math.hypot(x - gx, z - gz) < 9)
  || (x > YARD.x0 - 14 && x < YARD.x1 + 14 && z > YARD.z0 - 4 && z < YARD.z1 + 22);
const BIG = { oak_big: ['oak_a', 1.5], beech_big: ['oak_b', 1.55], pine_big: ['pine_a', 1.45] };
const tree = (m, x, z, scale, o = {}) => scatter.push({ m, x, z, yaw: R() * 360, scale, ...(BIG[m] ? { alt: BIG[m][0], altScale: BIG[m][1] } : {}), ...o });
// big trees standing out of the hedgerows, as in the bocage
for (let i = 0; i < 900; i++) {
  const x = R.range(-56, 56), z = R.range(-26, 250);
  const d = HEDGES.dist(x, z);
  if (d > 1.2 || noTree(x, z) || R() > 0.35) continue;
  const r = R();
  tree(r < 0.35 ? 'oak_big' : r < 0.6 ? R.pick(['oak_a', 'oak_b']) : r < 0.75 ? 'beech_big' : r < 0.85 ? 'birch_a' : R.pick(['bush_a', 'bramble']), x, z, 0.9 + R() * 0.45);
}
// the orchard along the track
for (let i = 0; i < 70; i++) {
  const x = R.range(-50, -28), z = R.range(66, 132);
  if (noTree(x, z)) continue;
  tree(R.pick(['oak_a', 'oak_b', 'oak_a', 'birch_a']), x, z, 0.55 + R() * 0.25);
}
// the woods beyond the fields
for (let i = 0; i < 1500; i++) {
  const x = R.range(-105, 105), z = R.range(-48, 298);
  if (Math.abs(x) < 60 && z < 262) continue;
  const r = R();
  tree(r < 0.3 ? R.pick(['oak_big', 'beech_big']) : r < 0.6 ? R.pick(['oak_a', 'oak_b']) : r < 0.72 ? 'birch_a' : r < 0.85 ? 'pine_big' : R.pick(['pine_a', 'pine_b', 'bush_a']), x, z, 0.95 + R() * 0.5);
}
// a few bushes and brambles out in the meadows
for (let i = 0; i < 90; i++) {
  const x = R.range(-48, 34), z = R.range(-20, 190);
  if (noTree(x, z) || HEDGES.dist(x, z) < 3) continue;
  scatter.push({ m: R.pick(['bush_a', 'bush_b', 'bramble']), x, z, yaw: R() * 360, scale: 0.7 + R() * 0.4 });
}

const cover = [];
for (let i = 0; i < 30000; i++) {
  const x = R.range(-56, 56), z = R.range(-26, 262);
  if (near(LANE, BOX.LANE, x, z) < 2.6 || near(TRACK, BOX.TRACK, x, z) < 2.2 || near(ROAD, BOX.ROAD, x, z) < 2.4) continue;
  if (x > YARD.x0 && x < YARD.x1 && z > YARD.z0 && z < YARD.z1) continue;
  const q = R(), hd = HEDGES.dist(x, z);
  const m = hd < 2.6 ? (q < 0.3 ? 'nettles' : q < 0.55 ? 'fern' : q < 0.7 ? 'weeds' : 'grass_tall')
    : q < 0.45 ? 'grass_tall' : q < 0.55 ? 'weeds' : 'grass_tuft';
  cover.push({ m, x, z, yaw: R() * 360, scale: 0.7 + R() * 0.6 });
}

/* ---------- enemies ---------- */

const E = (type, x, z, yaw, group, o = {}) => ({ type, at: [x, z], yaw, group, ...o });
const enemies = [
  // the meadow
  E('rifle', 14, 92, 190, 'meadow', { patrol: [[14, 92], [-12, 100], [-18, 124], [16, 124]] }),
  E('rifle', -8, 70, 200, 'meadow', { leash: 12 }),
  E('rifle', 30, 110, 160, 'meadow', { patrol: [[30, 110], [30, 80], [20, 66]] }),
  // the trench line along the battery hedge
  E('rifle', 28, 136.8, 180, 'trench', { hold: true, inTrench: true }),
  E('rifle', 17, 135.6, 185, 'trench', { hold: true, inTrench: true }),
  E('smg', 6, 136.3, 175, 'trench', { hold: true, inTrench: true }),
  E('rifle', -6, 136.8, 180, 'trench', { hold: true, inTrench: true }),
  E('rifle', -12, 135.3, 190, 'trench', { hold: true, inTrench: true }),
  E('rifle', -22, 136.4, 175, 'trench', { hold: true, inTrench: true }),
  E('smg', -33, 136.4, 180, 'trench', { hold: true, inTrench: true }),
  E('mg', 0, 0, 200, 'trench', { nest: 'nest_w', arc: 0.9 }),
  E('mg', 0, 0, 160, 'trench', { nest: 'nest_e', arc: 0.9 }),
  // the guns' crews
  E('rifle', 27, 150.5, 190, 'guns', { stance: 'crouch', leash: 8 }),
  E('rifle', 1, 151, 170, 'guns', { stance: 'crouch', leash: 8 }),
  E('smg', -25, 150.5, 185, 'guns', { stance: 'crouch', leash: 8 }),
  E('rifle', -31, 152, 200, 'guns', { leash: 8 }),
  // the north field, between the guns and the farm
  E('rifle', 10, 172, 180, 'north', { patrol: [[10, 172], [-30, 172], [-30, 186], [10, 186]] }),
  E('rifle', -16, 165, 160, 'north', { leash: 14 }),
  // the farm
  E('smg', 2, 200, 180, 'farm'),
  E('rifle', -12, 199, 190, 'farm'),
  E('rifle', 14, 199, 170, 'farm'),
  E('rifle', 6, 212, 180, 'farm', { patrol: [[6, 212], [-10, 218], [-12, 204], [12, 202]] }),
  E('smg', -20, 205, 200, 'farm', { leash: 10 }),
  E('rifle', 20, 207, 160, 'farm', { leash: 10 }),
  E('rifle', -6, 226, 180, 'farm', { tough: 1.5 }),
  E('rifle', -2, 240, 170, 'farm', { leash: 10 }),
];

/* ---------- pickups, checkpoints, objectives ---------- */

const pickups = [
  { type: 'medkit', x: 18, z: 4 }, { type: 'ammo', x: 24, z: 8 }, { type: 'grenades', x: 16, z: 10 },
  { type: 'medkit', x: 4, z: 62 }, { type: 'ammo', x: -16, z: 74 }, { type: 'medkit', x: 40, z: 100 },
  { type: 'grenades', x: -40, z: 110 }, { type: 'ammo', x: 2, z: 128 }, { type: 'medkit', x: 34, z: 132 },
  { type: 'medkit', x: -2, z: 158 }, { type: 'ammo', x: -36, z: 150 }, { type: 'grenades', x: 18, z: 160 },
  { type: 'medkit', x: 20, z: 188 }, { type: 'ammo', x: -30, z: 186 }, { type: 'medkit', x: -14, z: 240 },
];

const checkpoints = [
  { x: 20, z: -12, spawn: [20, -12, 0] },
  { x: 5, z: 64, r: 9, spawn: [5, 64, 0] },
  { x: 4, z: 130, r: 10, spawn: [4, 126, 0] },
  { x: -6, z: 166, r: 10, spawn: [-6, 164, 0] },
  { x: 16, z: 190, r: 8, spawn: [16, 186, 0] },
];

const objectives = [
  { id: 'hedge', text: 'Get through the first hedgerow', kind: 'cross', z: 62, marker: [5, 58] },
  { id: 'gun1', text: 'Destroy the west gun', kind: 'destroy', target: 'gun1', x: 24, z: 144.4 },
  { id: 'gun2', text: 'Destroy the middle gun', kind: 'destroy', target: 'gun2', x: -2, z: 144.4 },
  { id: 'gun3', text: 'Destroy the east gun', kind: 'destroy', target: 'gun3', x: -28, z: 144.4 },
  { id: 'dump', text: 'Blow the ammunition dump in the farmyard', kind: 'destroy', target: 'dump', x: 5, z: 203.4 },
  { id: 'rally', text: 'Reach the road north of La Varenne', kind: 'reach', x: -12, z: 252, r: 7 },
];

const hints = [
  { x: 20, z: -6, r: 6, text: 'The guns are firing on the causeway', sub: 'Follow the compass marker; hold the right button to aim' },
  { x: 5, z: 50, r: 7, text: 'The meadow is open ground', sub: 'The sunken lane (left) and the orchard track (right) are covered by machine guns' },
  { x: 0, z: 118, r: 8, text: 'The trench runs the length of the hedge', sub: 'Get into it at either end, or bomb it with grenades (G)' },
  { x: 20, z: 140, r: 6, text: 'Press E at a gun to set a charge', sub: 'Six seconds: get clear' },
];

export default {
  id: 'la-varenne',
  title: 'La Varenne',
  completeTitle: 'The guns at La Varenne are silent',
  when: 'Normandy, 6 June 1944 — 08:30, drizzle',
  briefing: [
    'You came down miles from the drop zone in the night. At first light a dozen of us have found each other in the fields west of the beach — and found a battery of guns at the farm of La Varenne, dug in along a hedgerow and shelling the causeway the seaborne troops must come up.',
    'The guns face north, at the beach. Their infantry hold a trench along the south side of the hedge, between a machine gun at each end. Work along it and put a charge on each gun, then blow the shells they have stacked in the farmyard.',
    'The hedgerows are your cover and theirs. There is the sunken lane on the left and the orchard track on the right, and craters across the meadow. Keep moving.',
  ],
  daylight: true,
  weather: { rain: 0.45 },
  start: [20, -12, 0],
  menuView: { from: [30, 5.5, 110], to: [0, 2.0, 148] },
  bounds: { minX: -110, maxX: 110, minZ: -50, maxZ: 300 },
  playBounds: { minX: -52, maxX: 52, minZ: -22, maxZ: 262 },
  fine: [[-44, 126, 40, 156]],
  water: null,
  baseHeight, splat, trackHeight: lipHeight,
  props, scatter, cover, clutter, enemies, pickups, checkpoints, objectives, hints,
  fog: { color: '#4a5058', density: 0.0062 },
  farFires: [[-80, 6, 240, 2.0], [90, 4, 60, 1.6]],
  far: {
    treeRange: 600,
    buildings: [
      { m: 'church', x: 240, z: 330, yaw: -120 }, { m: 'house_a', x: 222, z: 312, yaw: -100 }, { m: 'house_d', x: 256, z: 300, yaw: -80 },
      { m: 'barn', x: -220, z: 140, yaw: 60 }, { m: 'house_c', x: -232, z: 126, yaw: 80 },
      { m: 'house_b', x: 180, z: -60, yaw: 20 }, { m: 'haystack', x: 170, z: -50 },
    ],
  },
  mist: (x, z) => 0.45 + 0.35 * smoothstep(60, 20, Math.abs(x)) * smoothstep(-20, 40, z) * smoothstep(200, 140, z),
  ambience: { rain: 0.45, wind: [1.3, 0.6], birds: true },
  lines: { LANE, TRACK, ROAD, TRENCH_A },
  craters: ROUGH.craters,
};
