/* Hedgerow — Mission 3: Pont-Tournant, the first hour of 6 June 1944.

   An original scenario inspired by the glider-borne coups de main on the
   canal and river bridges in the first minutes of D-Day: the gliders cast
   off over the coast and landed in the dark a stone's throw from their
   bridges, and the men came out of them straight into the assault, to take
   the bridges before the demolition charges could be fired, then held them
   against the counter-attacks until relieved.

   The player's glider has come down hard in the marsh south of the canal
   (z ≈ 15), the road curving in from the right on its causeway to the
   bridge. Through the wire belt (z ≈ 73), past the pond, the pillbox and
   the machine-gun nest on the south bank (z ≈ 95) cover the steel bridge
   (z 103..137) over the canal (z = 120). Over it, the café and the houses of
   the village climbing the north bank, a side street off to the left, then
   a counter-attack down the street from where it bends at the top, to hold
   off at the bridge's north end.

   World axes as Saint-Clair: +z north, +x west (the player's left). */

import { fbm2, smoothstep, smoothPolyline, rng, lerp, polylineDistance } from '../util.js';
import { bbox, near, along, roughGround, cutTrench, atZ } from './kit.js';
import { CANAL_BRIDGE } from '../procedural.js';

/* Laid out after the canal bridges on the old maps: on the near bank the road comes over the
   marsh on a low causeway and swings round onto the bridge, a pond in the angle between it and
   the canal, a lane branching off south past the landing field; on the far bank the street runs
   on up a gentle rise into the village, a side street off it, and bends away at the top. */
const CANAL_Z = 120;
const HALF = CANAL_BRIDGE.length / 2;
const DECK_Y = 2.15;
const LANE = smoothPolyline([[0, CANAL_Z - HALF + 1], [-0.5, 94], [-4, 82], [-12, 70], [-24, 58], [-38, 46], [-52, 36], [-66, 28]], 2);
const SIDE = smoothPolyline([[-30, 52], [-26, 30], [-21, 8], [-24, -14], [-30, -30]], 2);
const STREET = smoothPolyline([[0, CANAL_Z + HALF - 1], [1, 156], [5, 180], [5, 200], [-4, 216], [-18, 230], [-26, 246], [-28, 262]], 2);
const CROSS = smoothPolyline([[4.5, 176], [18, 178], [32, 175], [48, 178]], 2);
// A maintenance footpath through the reeds joins the left-hand gap in the
// wire. It is slower and more sheltered than the road, and the duckboards
// give the marsh a recognisable route instead of an undifferentiated field.
const MARSH_PATH = smoothPolyline([[18, 26], [24, 40], [24, 56], [22, 70]], 2);
const POND = { x: -20, z: 89, r: 7.5, h: 1.0, crater: true };
const TRENCH_W = smoothPolyline([[-30, 100], [-38, 98.2], [-46, 100.4]], 1);
const TRENCH_E = smoothPolyline([[17, 91.5], [25, 93.6], [31, 90.8], [38, 93]], 1);
const TRENCH_DEPTH = 1.2;
const BOX = { LANE: bbox(LANE, 10), SIDE: bbox(SIDE, 10), STREET: bbox(STREET, 12), CROSS: bbox(CROSS, 10), MARSH: bbox(MARSH_PATH, 5), TW: bbox(TRENCH_W, 6), TE: bbox(TRENCH_E, 6) };
const TRENCHES = [[TRENCH_W, BOX.TW], [TRENCH_E, BOX.TE]];
const TMP = {};
/* the street's x at z, and a point `off` metres to its side there (+ its left) */
const sx = (z) => atZ(STREET, z).x;

/* the undisturbed ground (roads, the quays and the trenches follow it): the marsh flat along the
   canal, rising gently to the south where the gliders came in and more to the north, where the
   village climbs the slope; low swells across the fields, the hills closing them in */
const lipHeight = (x, z) => 2.0 + fbm2(x / 50 + 2.3, z / 50 + 0.7, 2) * 1.1 * smoothstep(14, 40, Math.abs(z - CANAL_Z))
  + 3 * smoothstep(60, -20, z) + 8 * smoothstep(CANAL_Z + 22, CANAL_Z + 115, z)
  + 6 * smoothstep(58, 95, Math.abs(x));

function roughAllowed(x, z) {
  let k = 1;
  for (const [line, box] of [[LANE, BOX.LANE], [SIDE, BOX.SIDE]]) k = Math.min(k, smoothstep(4.5, 7, near(line, box, x, z)));
  k = Math.min(k, smoothstep(6, 9, near(STREET, BOX.STREET, x, z)));
  for (const [T, b] of TRENCHES) k = Math.min(k, smoothstep(2.6, 5, near(T, b, x, z)));
  k = Math.min(k, smoothstep(16, 22, Math.abs(z - CANAL_Z)));
  if (z > CANAL_Z + 12 && Math.abs(x - sx(z)) < 30) k = 0;
  k = Math.min(k, smoothstep(9, 13, Math.hypot(x - 10, z - 95)));
  k = Math.min(k, smoothstep(POND.r + 2, POND.r + 5, Math.hypot(x - POND.x, z - POND.z)));
  k = Math.min(k, smoothstep(1.4, 3.5, near(MARSH_PATH, BOX.MARSH, x, z)));
  return k;
}
const ROUGH = roughGround(rng(1944066), {
  mounds: 500, craters: 26, area: { x0: -55, x1: 55, z0: -30, z1: 100 }, craterArea: { x0: -40, x1: 40, z0: 30, z1: 98 }, allowed: roughAllowed,
});

function baseHeight(x, z) {
  let h = lipHeight(x, z) + fbm2(x / 13, z / 13, 2) * 0.12;
  const k = roughAllowed(x, z);
  if (k > 0) h += k * (0.12 * fbm2(x / 5.3 + 11.7, z / 5.3 - 3.1, 3) + ROUGH.height(x, z));
  // the marsh south of the canal: wet hollows between tussocky rises
  if (z < CANAL_Z - 18) h -= 0.35 * smoothstep(0.1, 0.5, fbm2(x / 21 + 5, z / 21 - 2, 2)) * k;
  const foot = near(MARSH_PATH, BOX.MARSH, x, z);
  if (foot < 3) {
    polylineDistance(MARSH_PATH, x, z, TMP);
    h = lerp(h, lipHeight(TMP.px, TMP.pz) - 0.06, smoothstep(2.8, 0.9, foot));
  }
  // the pond in the angle of the road and the canal, its water a metre down (ponds.js fills it)
  const dp = Math.hypot(x - POND.x, (z - POND.z) * 1.15);
  if (dp < POND.r + 2) h = lerp(h, lipHeight(POND.x, POND.z) - POND.h, smoothstep(POND.r + 0.5, POND.r * 0.3, dp));
  // the canal: stone-faced, its bed 2.6 m under the water
  const dz = Math.abs(z - CANAL_Z);
  if (dz < 13) h = lerp(h, -2.6, smoothstep(12.6, 11.2, dz));
  // the road over the marsh on its low causeway, ditches either side; the lane and the street
  // follow the ground; all of them level with the bridge's deck at its ends
  for (const [line, box, w, raise] of [[LANE, BOX.LANE, 7, 0.6], [SIDE, BOX.SIDE, 5, 0.2], [STREET, BOX.STREET, 7, 0], [CROSS, BOX.CROSS, 5, 0]]) {
    const d = near(line, box, x, z);
    if (d < w && dz > 11.5) {
      polylineDistance(line, x, z, TMP);
      const ends = smoothstep(26, 16, Math.abs(TMP.pz - CANAL_Z)) * (line === LANE || line === STREET ? 1 : 0);
      const top = lipHeight(TMP.px, TMP.pz) + raise * smoothstep(CANAL_Z - 20, CANAL_Z - 40, TMP.pz);
      const ty = lerp(top, DECK_Y - 0.03, ends) - d * d * 0.004;
      if (raise > 0.3) h -= 0.5 * smoothstep(3.6, 4.8, d) * smoothstep(w, 5.4, d) * (1 - ends);
      h = lerp(h, ty, smoothstep(line === STREET ? w : 4.2, line === STREET ? w * 0.5 : 3.0, d));
    }
  }
  for (const [T, b] of TRENCHES) h = cutTrench(T, b, lipHeight, TRENCH_DEPTH, h, x, z);
  for (const T of [TRENCH_W, TRENCH_E]) for (const [rx, rz] of [T[0], T[T.length - 1]]) {
    const d = Math.hypot(x - rx, z - rz);
    if (d < 4) h = lerp(h, lipHeight(rx, rz) - 0.2, smoothstep(4, 1.5, d) * 0.6);
  }
  return h;
}

function splat(x, z) {
  let mud = 0, grass = 1, forest = 0, cobble = 0;
  const n = fbm2(x / 8, z / 8, 2);
  mud += smoothstep(0.1, 0.55, n) * 0.6;
  // the marsh: wetter, muddier towards the canal
  if (z < CANAL_Z) mud += smoothstep(0.0, 0.5, fbm2(x / 21 + 5, z / 21 - 2, 2)) * 0.9;
  mud += smoothstep(3.4, 1.6, near(LANE, BOX.LANE, x, z)) * 2 + smoothstep(3.0, 1.4, near(SIDE, BOX.SIDE, x, z)) * 2;
  mud += smoothstep(2.0, 0.7, near(MARSH_PATH, BOX.MARSH, x, z)) * 2.5;
  for (const [T, b] of TRENCHES) mud += smoothstep(2.4, 1.0, near(T, b, x, z)) * 2;
  mud += smoothstep(14, 11.5, Math.abs(z - CANAL_Z)) * 1.5;
  mud += Math.min(1.5, Math.abs(ROUGH.height(x, z)) * 2.2);
  const ds = Math.min(near(STREET, BOX.STREET, x, z), near(CROSS, BOX.CROSS, x, z) + 1);
  cobble = smoothstep(5.0, 4.0, ds) * smoothstep(CANAL_Z + 12, CANAL_Z + 14, z);
  mud += smoothstep(6.5, 5.0, ds) * (1 - cobble);
  if (z > CANAL_Z + 14 && Math.abs(x - sx(z)) < 40) mud += 0.3;
  mud += smoothstep(POND.r + 2.5, POND.r, Math.hypot(x - POND.x, (z - POND.z) * 1.15)) * 1.5;
  const s = mud + grass + forest + cobble * 3;
  if (cobble > 0.5) return [mud * 0.2 / s, grass * 0.1 / s, 0, 1];
  return [mud / s, grass / s, forest / s, cobble * 3 / s];
}

/* ---------- props ---------- */

const props = [];
const P = (m, x, z, yaw = 0, o = {}) => { props.push({ m, x, z, yaw, ...o }); return props[props.length - 1]; };
const above = (h) => (x, z) => baseHeight(x, z) + h;
const trenchWallY = (x, z) => lipHeight(x, z) - TRENCH_DEPTH - 0.42;

/* a place `d` metres to the side of a line at z (+ its left), and the yaw that faces the line from
   there; a line's own heading at z */
const beside = (line, z, side, d) => {
  const { x, tx, tz } = atZ(line, z);
  return [x + tz * side * d, z - tx * side * d, Math.atan2(-side * tz, side * tx) * 180 / Math.PI];
};
const heading = (line, z) => { const { tx, tz } = atZ(line, z); return Math.atan2(tx, tz) * 180 / Math.PI; };
// on the far bank, x across the street from where it runs
const X = (x, z) => x + sx(z);

// the gliders: his own, nose in the marsh short of the wire; the second burning; the third further off
P('glider', 12, 16, 8, { id: 'glider' });
P('glider', -8, 48, -24, { fire: true, fireSize: 1.3, debris: 4 });
P('glider', 40, 58, 32);
P('stretcher', 6, 10, 80); P('crate', 7.5, 6, 15); P('dropped_helmet_us', 10, 4, 0); P('supply_canister', 18, 2, 40);
for (const z of [37, 41, 45, 49, 53, 57, 61, 65]) {
  const { x, tx, tz } = atZ(MARSH_PATH, z);
  P('duckboard_walk', x, z, Math.atan2(tx, tz) * 180 / Math.PI, { y: above(-0.015) });
}
P('fence_field', 27, 29, 10); P('fence_field', 18, 68, 0);

// the wire belt across the marsh, gaps where the patrols come through; the road barred at it
const wireZ = (x) => 73 + 2.5 * Math.sin(x / 9);
const ROAD_AT_WIRE = atZ(LANE, 73).x;
for (let x = -46; x <= 46; x += 4) {
  const z = wireZ(x);
  if (Math.abs(x - ROAD_AT_WIRE) < 5 || Math.abs(x - 22) < 3 || Math.abs(x - 2) < 3) continue;
  P('barbed_wire', x, z + Math.sin(x * 0.7) * 0.6, -Math.atan(wireZ(x + 0.5) - wireZ(x - 0.5)) * 180 / Math.PI + Math.sin(x) * 6);
}
P('barrier', ROAD_AT_WIRE, 72, heading(LANE, 72)); P('hedgehog', atZ(LANE, 77).x - 5, 77, 20); P('hedgehog', atZ(LANE, 76).x + 5.5, 76, -15);
P('sign_minen', 12, 69, 180); P('sign_minen', -30, 69, 180);

// the south bank: the pillbox and the machine gun covering the bridge, the trenches either side
P('bunker', 10, 95, 180, { pad: true, id: 'pillbox' });
P('mg_nest', -7, 99.5, 185, { id: 'nest_s' });
P('sentry_box', 4.6, 103, -90); P('lamp_post', -4.2, 103.5, 90, { light: true });
const trench = (line) => {
  along(line, 3.9, 0.86, (x, z, yaw) => P('trench_wall', x, z, yaw, { y: trenchWallY }));
  along(line, 3.9, -0.86, (x, z, yaw) => P('trench_wall', x, z, yaw + 180, { y: trenchWallY }));
  along(line, 8, 2.1, (x, z, yaw) => P('sandbags_low', x, z, yaw));
};
trench(TRENCH_W); trench(TRENCH_E);
P('ammo_stack', -24, 101.5, 20); P('crate_large', 18, 101, 10); P('jerrycan_stack', 22, 99.5, 70);
// a cart left by the pond
P('cart', POND.x + 9.5, POND.z - 3, 60);

// the canal: its bridge, a low wall along each quay but at the bridge
P('canal_bridge', 0, CANAL_Z, 0, { y: DECK_Y, id: 'bridge', light: true });
for (let x = -48; x <= 48; x += 4) {
  if (Math.abs(x) < 7) continue;
  P('wall_low', x, CANAL_Z - 12.9, 0, { y: lipHeight(x, CANAL_Z - 12.9) - 0.05 });
  P('wall_low', x, CANAL_Z + 12.9, 0, { y: lipHeight(x, CANAL_Z + 12.9) - 0.05 });
}
P('cable_reel', 4.6, CANAL_Z + 15.5, 30); P('crate', -4.5, CANAL_Z + 15, 0);
// The firing point is reachable from the north quay, outside the cabin.
P('demolition_switch', 4.2, CANAL_Z + HALF + 3.4, 180, { id: 'demolition', separate: true });
for (const x of [-36, -20, 20, 36]) for (const side of [-1, 1]) {
  P('mooring_bollard', x, CANAL_Z + side * 14.4, side * 12, { y: lipHeight(x, CANAL_Z + side * 14.4) - 0.04 });
}

// --- the village on the north bank: the café at the bridge, houses up the street, a side street ---
const FRONT = 6.4;
const HOUSE = (m, z, side, wd, o = {}) => { const [x, hz, yaw] = beside(STREET, z, side, FRONT + wd); return P(m, x, hz, yaw, { pad: true, ...o }); };
HOUSE('house_g', 152, -1, 1.8 + 3.7);     // the café, set back for its terrace on the corner by the bridge
HOUSE('house_b', 150, 1, 3.8); HOUSE('house_a', 163, 1, 2.85); HOUSE('house_d', 168, -1, 2.2);
HOUSE('house_c', 182, -1, 3.1); HOUSE('ruin', 193, 1, 3.3); HOUSE('house_e', 199, -1, 4.0);
HOUSE('house_d', 208, 1, 2.2); HOUSE('barn', 216, -1, 3.7);
// along the side street
P('house_b', 24, 187, 180, { pad: true }); P('house_a', 40, 186, 180, { pad: true }); P('barn', 38, 166, 0, { pad: true });
for (const [z, side] of [[141, -1], [174, 1], [206, -1]]) { const [x, lz, yaw] = beside(STREET, z, side, 5.3); P('lamp_post', x, lz, yaw, { light: true }); }
{ const [x, z, yaw] = beside(STREET, 165.6, 1, FRONT); P('wall_lamp', x, z, yaw, { y: above(2.7), light: true }); }
P('cart', X(4.6, 188), 188, 10); P('bicycle', X(-6, 160), 160, 95); P('barrel_wood', X(5.2, 158), 158, 0); P('bench', X(-9.6, 176), 176, 90);
P('sandbags', X(-2, 143), 143, 0); P('sandbags_curve', X(3.5, 145), 145, 200);
for (const [z, k] of [[226, 0], [234, 1], [246, 2]]) P(['kubelwagen', 'motorcycle_sidecar', 'truck'][k], X(k === 1 ? 3 : -2, z), z, heading(STREET, z) + 180);
P('rubble_pile', X(8, 196), 196, 30); P('beam_charred', X(9.2, 200), 200, 60, { burning: 0.5 });
// gardens behind the houses
for (const z of [158, 204]) { P('wall_low', X(18, z), z, 90); P('wall_low', X(-18, z), z, 90); }
P('wall_low', X(-18, 186), 186, 90);
P('fence_picket', X(16, 160), 160, 90); P('fence_picket', X(-16, 174), 174, 90); P('well', 24, 162, 0); P('haystack', X(-24, 214), 214, 0);

/* ---------- clutter ---------- */

const RC = rng(19440605);
const clutter = [];
const C = (m, x, z, scale, yaw = RC() * 360) => { clutter.push({ m, x, z, yaw, scale }); };
along(STREET, 1.1, 0, (x, z) => {
  if (z < CANAL_Z + 16) return;
  for (const side of [-1, 1]) {
    const px = x + side * RC.range(4.4, 5.6), r = RC();
    if (r < 0.3) C('leaf_litter', px, z, RC.range(0.35, 0.6));
    else if (r < 0.38) C('rubble_small', px, z, RC.range(0.26, 0.4));
  }
});
along(LANE, 1.2, 0, (x, z) => {
  for (const side of [-1, 1]) {
    const px = x + side * RC.range(2.6, 3.6), r = RC();
    if (r < 0.14) C('rocks_small', px, z, RC.range(0.35, 0.6));
    else if (r < 0.24) C('branches', px, z, RC.range(0.6, 1.0));
  }
});
for (const [nx, nz] of [[10, 95], [-7, 99.5]]) for (let k = 0; k < 6; k++) {
  const a = RC.range(-1.2, 1.2), d = RC.range(2.6, 4.4);
  C(RC.pick(['ammo_box', 'ammo_box', 'jerrycan', 'dropped_helmet_de']), nx + Math.sin(a) * d, nz + Math.cos(a) * d, 1);
}

/* ---------- vegetation ---------- */

const R = rng(20250605);
const scatter = [];
const noTree = (x, z) => near(LANE, BOX.LANE, x, z) < 5 || near(SIDE, BOX.SIDE, x, z) < 4.5 || near(STREET, BOX.STREET, x, z) < 8
  || near(MARSH_PATH, BOX.MARSH, x, z) < 1.8
  || near(CROSS, BOX.CROSS, x, z) < 6 || Math.abs(z - CANAL_Z) < 15
  || TRENCHES.some(([T, b]) => near(T, b, x, z) < 4) || Math.hypot(x - 10, z - 95) < 11 || Math.abs(z - wireZ(x)) < 3
  || Math.hypot(x - POND.x, z - POND.z) < POND.r + 1.5
  || (z > CANAL_Z + 12 && z < 222 && Math.abs(x - sx(z)) < 22) || (x > 14 && x < 48 && z > 160 && z < 194);
// poplars along the towpaths, willows and alders in the marsh
for (let x = -100; x <= 100; x += 7) {
  for (const z of [CANAL_Z - 16.5, CANAL_Z + 16.5]) if (!noTree(x, z + (z < CANAL_Z ? -0.1 : 0.1)) && Math.abs(x) > 9) scatter.push({ m: R() < 0.7 ? 'birch_a' : 'pine_c', x: x + R.range(-1, 1), z: z + (z < CANAL_Z ? -1 : 1) * R.range(0, 1.5), yaw: R() * 360, scale: 1.2 + R() * 0.3 });
}
for (let i = 0; i < 260; i++) {
  const x = R.range(-56, 56), z = R.range(-24, 104);
  if (noTree(x, z)) continue;
  const r = R();
  scatter.push({ m: r < 0.35 ? R.pick(['bush_a', 'bush_b']) : r < 0.6 ? 'reeds' : r < 0.8 ? R.pick(['oak_a', 'oak_b']) : 'birch_a', x, z, yaw: R() * 360, scale: r < 0.6 ? 0.8 + R() * 0.5 : 0.6 + R() * 0.35, cover: r >= 0.35 && r < 0.6 });
}
// the woods and orchards beyond
for (let i = 0; i < 1400; i++) {
  const x = R.range(-108, 108), z = R.range(-48, 298);
  if ((Math.abs(x) < 54 && z < 252) || Math.abs(z - CANAL_Z) < 16) continue;
  const r = R();
  scatter.push({ m: r < 0.25 ? 'oak_big' : r < 0.55 ? R.pick(['oak_a', 'oak_b']) : r < 0.7 ? 'birch_a' : r < 0.85 ? R.pick(['pine_a', 'pine_b']) : 'bush_a', x, z, yaw: R() * 360, scale: 0.95 + R() * 0.5, ...(r < 0.25 ? { alt: 'oak_a', altScale: 1.5 } : {}) });
}
for (let i = 0; i < 60; i++) {
  const side = R.sign();
  const x = side * R.range(18, 46), z = R.range(CANAL_Z + 20, 240);
  if (noTree(x, z)) continue;
  scatter.push({ m: R() < 0.4 ? R.pick(['oak_a', 'oak_b']) : R.pick(['bush_a', 'bush_b']), x, z, yaw: R() * 360, scale: 0.6 + R() * 0.3 });
}
// reed beds along the south quay and in the marsh hollows
for (let i = 0; i < 260; i++) {
  const x = R.range(-60, 60), z = R.pick([R.range(CANAL_Z - 17, CANAL_Z - 14), R.range(-10, 70)]);
  if (Math.abs(x) < 6 || near(LANE, BOX.LANE, x, z) < 4 || noTree(x, z)) continue;
  scatter.push({ m: 'reeds', x, z, yaw: R() * 360, scale: 0.8 + R() * 0.5, cover: true });
}
// and round the pond's edge
for (let i = 0; i < 46; i++) {
  const a = R() * Math.PI * 2, d = POND.r * R.range(0.95, 1.25);
  scatter.push({ m: 'reeds', x: POND.x + Math.cos(a) * d, z: POND.z + Math.sin(a) * d / 1.15, yaw: R() * 360, scale: 0.8 + R() * 0.5, cover: true });
}

const cover = [];
for (let i = 0; i < 26000; i++) {
  const x = R.range(-54, 54), z = R.range(-24, 252);
  if (near(LANE, BOX.LANE, x, z) < 3.4 || near(SIDE, BOX.SIDE, x, z) < 2.6 || near(STREET, BOX.STREET, x, z) < 5.5 || near(CROSS, BOX.CROSS, x, z) < 3.5 || near(MARSH_PATH, BOX.MARSH, x, z) < 1.1
    || Math.abs(z - CANAL_Z) < 13.5 || Math.hypot(x - POND.x, (z - POND.z) * 1.15) < POND.r) continue;
  const q = R();
  const m = z < CANAL_Z ? (q < 0.45 ? 'grass_tall' : q < 0.6 ? 'reeds' : q < 0.7 ? 'weeds' : 'grass_tuft')
    : (q < 0.15 ? 'nettles' : q < 0.3 ? 'weeds' : q < 0.45 ? 'grass_tall' : 'grass_tuft');
  cover.push({ m, x, z, yaw: R() * 360, scale: 0.7 + R() * 0.6 });
}

/* ---------- enemies ---------- */

const E = (type, x, z, yaw, group, o = {}) => ({ type, at: [x, z], yaw, group, ...o });
const enemies = [
  // a patrol along the inside of the wire
  E('rifle', -30, 78, 90, 'wire', { patrol: [[-34, 78], [26, 80]] }),
  E('rifle', 24, 82, 270, 'wire', { patrol: [[30, 82], [-4, 79]] }),
  // the south bank: pillbox, MG nest, the trenches, the sentries at the bridge
  E('mg', 0, 0, 180, 'pillbox', { bunker: 'pillbox', arc: 0.8 }),
  E('mg', 0, 0, 185, 'pillbox', { nest: 'nest_s', arc: 0.9 }),
  E('rifle', -34, 99, 180, 'pillbox', { hold: true, inTrench: true }),
  E('rifle', -42, 98.8, 175, 'pillbox', { hold: true, inTrench: true }),
  E('rifle', 20, 92.4, 180, 'pillbox', { hold: true, inTrench: true }),
  E('smg', 27, 92.8, 185, 'pillbox', { hold: true, inTrench: true }),
  E('rifle', 34, 91.9, 180, 'pillbox', { hold: true, inTrench: true }),
  E('rifle', 3.6, 101.5, 180, 'pillbox', { leash: 6 }),
  E('rifle', 2.5, 105, 170, 'pillbox', { patrol: [[2, 104], [2, 134], [-2, 134], [-2, 104]] }),
  // the far bank: the café, the street
  E('smg', X(-6, 146), 146, 180, 'farbank'),
  E('rifle', X(3.5, 144), 144, 180, 'farbank'),
  E('rifle', X(-7, 146), 146, 160, 'farbank', { leash: 8 }),
  E('rifle', X(9, 153), 153, 200, 'farbank', { leash: 8 }),
  E('rifle', X(-2, 170), 170, 180, 'farbank', { patrol: [[X(-2, 158), 158], [X(-2, 190), 190]] }),
  E('smg', X(4, 182), 182, 185, 'farbank'),
  E('rifle', X(-9, 186), 186, 170, 'farbank', { leash: 10 }),
  E('rifle', 22, 177, 200, 'farbank', { patrol: [[16, 177], [44, 177]] }),
  // the counter-attack, waiting up the road for the order
  ...[['smg', 2, 228], ['rifle', 7, 230], ['rifle', -6, 232], ['rifle', 8, 238], ['smg', -4, 240, 1.4], ['rifle', 12, 222], ['rifle', -12, 224], ['rifle', 3, 246]]
    .map(([t, dx, z, tough]) => E(t, X(dx, z), z, heading(STREET, z) + 180, 'counter', { leash: 40, ...(tough ? { tough } : {}) })),
];

/* ---------- pickups, checkpoints, objectives ---------- */

const pickups = [
  { type: 'ammo', x: 7, z: 8 }, { type: 'grenades', x: 4, z: 7 }, { type: 'medkit', x: 2, z: 30 },
  { type: 'medkit', x: -20, z: 60 }, { type: 'ammo', x: 20, z: 64 }, { type: 'medkit', x: 3, z: 84 },
  { type: 'grenades', x: -2, z: 70 }, { type: 'ammo', x: -18, z: 101 }, { type: 'medkit', x: 16, z: 103 },
  ...[['medkit', 3, 141], ['ammo', -9, 141], ['grenades', 2, 162], ['medkit', -4, 176], ['ammo', 3, 150], ['medkit', -8, 156]]
    .map(([type, x, z]) => ({ type, x: X(x, z), z })),
];

const checkpoints = [
  { x: 4, z: 4, spawn: [4, 4, 0] },
  { x: 0, z: 84, r: 8, spawn: [0, 82, 0] },
  { x: 0, z: 104, r: 6, spawn: [0, 103, 0] },
  { x: 0, z: 142, r: 6, spawn: [0, 141, 0] },
  { x: X(0, 168), z: 168, r: 9, spawn: [X(0, 160), 160, 0] },
];

const objectives = [
  { id: 'wire', text: 'Get through the wire belt', kind: 'cross', z: 77, marker: [0, 74] },
  { id: 'pillbox', text: 'Silence the pillbox and the bridge guards', kind: 'clear', groups: ['pillbox'] },
  { id: 'bridge', text: 'Rush the bridge before it can be blown', kind: 'cross', z: CANAL_Z + HALF + 2, marker: [0, CANAL_Z + HALF] },
  { id: 'demolition', text: 'Disconnect the bridge demolition circuit', kind: 'interact', target: 'demolition', x: 4.2, z: CANAL_Z + HALF + 2.8, r: 2.5, duration: 4, action: 'disconnect', prompt: 'disconnect the demolition cable', progressText: 'Disconnecting the cable' },
  { id: 'cafe', text: 'Clear the café and the houses on the far bank', kind: 'clear', groups: ['farbank'] },
  { id: 'hold', text: 'Hold the north end of the bridge', kind: 'hold', x: 0, z: 150, r: 24, time: 90, counter: ['counter'], warning: 'They are coming down the road — hold the bridge', earlyRelief: { minimum: 30, confirmation: 6, message: 'Bridge secured' } },
];

const hints = [
  { x: 4, z: 8, r: 6, text: 'The bridge is wired for demolition', sub: 'Get across before they can fire the charges' },
  { x: -12, z: 62, r: 8, text: 'The wire has gaps', sub: 'Out in the field on the left; the road itself is barred' },
  { x: 23, z: 36, r: 6, text: 'The duckboards lead through the marsh', sub: 'Follow them to the gap in the wire; the reeds conceal a crouched approach' },
  { x: -3, z: 88, r: 7, text: 'Their pillbox looks down the road', sub: 'Work round it through the trenches, grenades through the slit' },
  { x: 0, z: 140, r: 6, text: 'The demolition switch is beside the bridge cabin', sub: 'Hold F at the wooden box to disconnect the cable; then clear the café' },
];

export default {
  id: 'pont-tournant',
  title: 'Pont-Tournant',
  completeTitle: 'Pont-Tournant is held',
  when: 'Normandy, 6 June 1944 — 00:20, wind and rain',
  briefing: [
    'Your glider cast off over the coast and came down in the marsh south of the canal, short of the bridge at Pont-Tournant. The landing broke it open; the others are coming out of the wrecks behind you.',
    'The bridge is the only road from the beaches to the east. It is wired for demolition. Get through the wire, put the pillbox and the machine gun out of action, rush the bridge and disconnect the firing cable at the wooden switch beside its north cabin. Then clear the café and the houses on the far bank.',
    'The road is exposed. A duckboard maintenance path through the reeds on your left leads to a gap in the wire; the trenches on either bank give another way around the pillbox. Then hold the north end. They will counter-attack down the road from the village. The paratroopers are on their way.',
  ],
  daylight: false,
  weather: { rain: 0.65 },
  start: [4, 4, 0],
  menuView: { from: [-4, 4.6, 92], to: [0, 3.4, 124] },
  bounds: { minX: -110, maxX: 110, minZ: -50, maxZ: 300 },
  playBounds: { minX: -50, maxX: 50, minZ: -22, maxZ: 252 },
  fine: [[-40, 84, 40, 104]],
  water: { level: 0, contains: (x, z) => Math.abs(z - CANAL_Z) < 13, riverZ: () => CANAL_Z, x0: -110, x1: 110 },
  baseHeight, splat, trackHeight: lipHeight,
  props, scatter, cover, clutter, enemies, pickups, checkpoints, objectives, hints,
  fog: { color: '#30363e', density: 0.0052 },
  farFires: [[-86, 4, 250, 2.4], [80, 4, -30, 1.8], [-70, 8, 30, 1.6]],
  far: {
    treeRange: 600,
    buildings: [
      { m: 'church', x: 10, z: 360, yaw: 180 }, { m: 'house_a', x: -20, z: 340, yaw: 170 }, { m: 'house_c', x: 30, z: 336, yaw: 190 },
      { m: 'house_b', x: -40, z: 350, yaw: 160 }, { m: 'barn', x: 60, z: 330, yaw: 200 },
      { m: 'house_d', x: 210, z: 120, yaw: -90 }, { m: 'barn', x: -220, z: 90, yaw: 80 },
    ],
  },
  mist: (x, z) => Math.min(1, smoothstep(40, 10, Math.abs(z - CANAL_Z)) + 0.6 * smoothstep(100, 60, z)),
  ambience: { rain: 0.65, wind: [1.8, 0.8], aircraft: true, frogs: CANAL_Z },
  lines: { LANE, SIDE, STREET, CROSS, TRENCH_W, TRENCH_E, MARSH_PATH },
  craters: [...ROUGH.craters, POND],
};
