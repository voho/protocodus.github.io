/* Hedgerow — Mission 3: Pont-Tournant, the first hour of 6 June 1944.

   An original scenario inspired by the glider-borne coups de main on the
   canal and river bridges in the first minutes of D-Day: the gliders cast
   off over the coast and landed in the dark a stone's throw from their
   bridges, and the men came out of them straight into the assault, to take
   the bridges before the demolition charges could be fired, then held them
   against the counter-attacks until relieved.

   The player's glider has come down hard in the marsh south of the canal
   (z ≈ 15). North up the road through the wire belt (z ≈ 72), the pillbox
   and the machine-gun nest on the south bank (z ≈ 95) cover the steel
   bridge (z 103..137) over the canal (z = 120). Over it, the café and the
   houses of the hamlet on the north bank, then a counter-attack down the
   road from the north to hold off at the bridge's north end.

   World axes as Saint-Clair: +z north, +x west (the player's left). */

import { fbm2, smoothstep, smoothPolyline, rng, lerp, polylineDistance } from '../util.js';
import { bbox, near, along, roughGround, cutTrench } from './kit.js';
import { CANAL_BRIDGE } from '../procedural.js';

const CANAL_Z = 120;
const HALF = CANAL_BRIDGE.length / 2;
const DECK_Y = 2.15;
const LANE = smoothPolyline([[3, -26], [2, 20], [1, 60], [0, 90], [0, CANAL_Z - HALF + 1]], 2);
const STREET = smoothPolyline([[0, CANAL_Z + HALF - 1], [0, 160], [0.5, 200], [0, 236], [-2, 262]], 2);
const TRENCH_W = smoothPolyline([[-34, 92.5], [-26, 90.5], [-18, 93]], 1);
const TRENCH_E = smoothPolyline([[7, 91.5], [16, 93.6], [26, 90.8], [35, 93]], 1);
const TRENCH_DEPTH = 1.2;
const BOX = { LANE: bbox(LANE, 10), STREET: bbox(STREET, 12), TW: bbox(TRENCH_W, 6), TE: bbox(TRENCH_E, 6) };
const TRENCHES = [[TRENCH_W, BOX.TW], [TRENCH_E, BOX.TE]];
const TMP = {};

/* the flat marsh (no noise): roads, the quays and the trenches follow it */
const lipHeight = (x, z) => 2.0 + fbm2(x / 60 + 2.3, z / 60 + 0.7, 2) * 0.25 * smoothstep(8, 30, Math.abs(z - CANAL_Z))
  + 5 * smoothstep(60, 95, Math.abs(x));

function roughAllowed(x, z) {
  let k = 1;
  k = Math.min(k, smoothstep(3.5, 6, near(LANE, BOX.LANE, x, z)));
  k = Math.min(k, smoothstep(6, 9, near(STREET, BOX.STREET, x, z)));
  for (const [T, b] of TRENCHES) k = Math.min(k, smoothstep(2.6, 5, near(T, b, x, z)));
  k = Math.min(k, smoothstep(16, 22, Math.abs(z - CANAL_Z)));
  if (z > CANAL_Z + 12 && Math.abs(x) < 30) k = 0;
  k = Math.min(k, smoothstep(9, 13, Math.hypot(x + 9, z - 96)));
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
  // the canal: stone-faced, its bed 2.6 m under the water
  const dz = Math.abs(z - CANAL_Z);
  if (dz < 13) h = lerp(h, -2.6, smoothstep(12.6, 11.2, dz));
  // the road up to the bridge and the street beyond: level with its deck at the ends
  for (const [line, box, w] of [[LANE, BOX.LANE, 5], [STREET, BOX.STREET, 7]]) {
    const d = near(line, box, x, z);
    if (d < w && dz > 11.5) {
      polylineDistance(line, x, z, TMP);
      const ends = smoothstep(26, 16, Math.abs(TMP.pz - CANAL_Z));
      const ty = lerp(lipHeight(TMP.px, TMP.pz), DECK_Y - 0.03, ends) - d * d * 0.004;
      h = lerp(h, ty, smoothstep(w, w * 0.5, d));
    }
  }
  for (const [T, b] of TRENCHES) h = cutTrench(T, b, lipHeight, TRENCH_DEPTH, h, x, z);
  for (const [rx, rz] of [[-34, 92.5], [-18, 93], [7, 91.5], [35, 93]]) {
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
  mud += smoothstep(3.4, 1.6, near(LANE, BOX.LANE, x, z)) * 2;
  for (const [T, b] of TRENCHES) mud += smoothstep(2.4, 1.0, near(T, b, x, z)) * 2;
  mud += smoothstep(14, 11.5, Math.abs(z - CANAL_Z)) * 1.5;
  mud += Math.min(1.5, Math.abs(ROUGH.height(x, z)) * 2.2);
  const ds = near(STREET, BOX.STREET, x, z);
  cobble = smoothstep(5.0, 4.0, ds) * smoothstep(CANAL_Z + 12, CANAL_Z + 14, z);
  mud += smoothstep(6.5, 5.0, ds) * (1 - cobble);
  if (z > CANAL_Z + 14 && Math.abs(x) < 40) mud += 0.3;
  const s = mud + grass + forest + cobble * 3;
  if (cobble > 0.5) return [mud * 0.2 / s, grass * 0.1 / s, 0, 1];
  return [mud / s, grass / s, forest / s, cobble * 3 / s];
}

/* ---------- props ---------- */

const props = [];
const P = (m, x, z, yaw = 0, o = {}) => { props.push({ m, x, z, yaw, ...o }); return props[props.length - 1]; };
const above = (h) => (x, z) => baseHeight(x, z) + h;
const trenchWallY = (x, z) => lipHeight(x, z) - TRENCH_DEPTH - 0.42;

// the gliders: his own, nose in the marsh short of the wire; the second burning; the third further off
P('glider', 12, 16, 8, { id: 'glider' });
P('glider', -27, 44, -24, { fire: true, fireSize: 1.3, debris: 4 });
P('glider', 40, 58, 32);
P('stretcher', 6, 10, 80); P('crate', 7.5, 6, 15); P('dropped_helmet_us', 10, 4, 0); P('supply_canister', 18, 2, 40);

// the wire belt across the marsh, gaps where the patrols come through; the road barred at it
for (let x = -46; x <= 46; x += 4) {
  if (Math.abs(x) < 4 || Math.abs(x - 22) < 3 || Math.abs(x + 18) < 3) continue;
  P('barbed_wire', x, 73 + Math.sin(x * 0.7) * 0.8, Math.sin(x) * 6);
}
P('barrier', 0, 72, 0); P('hedgehog', -5, 76, 20); P('hedgehog', 5.5, 75, -15); P('sign_minen', 12, 70, 180); P('sign_minen', -30, 70, 180);

// the south bank: the pillbox and the machine gun covering the bridge, the trenches either side
P('bunker', -9, 96, 180, { pad: true, id: 'pillbox' });
P('mg_nest', 11, 99, 185, { id: 'nest_s' });
P('sentry_box', -4.6, 101.5, 90); P('lamp_post', 4.2, 101.5, -90, { light: true });
const trench = (line) => {
  along(line, 3.9, 0.86, (x, z, yaw) => P('trench_wall', x, z, yaw, { y: trenchWallY }));
  along(line, 3.9, -0.86, (x, z, yaw) => P('trench_wall', x, z, yaw + 180, { y: trenchWallY }));
  along(line, 8, 2.1, (x, z, yaw) => P('sandbags_low', x, z, yaw));
};
trench(TRENCH_W); trench(TRENCH_E);
P('ammo_stack', -20, 99, 20); P('crate_large', 18, 101, 10); P('jerrycan_stack', 22, 99.5, 70);

// the canal: its bridge, a low wall along each quay but at the bridge
P('canal_bridge', 0, CANAL_Z, 0, { y: DECK_Y, id: 'bridge', light: true });
for (let x = -48; x <= 48; x += 4) {
  if (Math.abs(x) < 7) continue;
  P('wall_low', x, CANAL_Z - 12.9, 0, { y: lipHeight(x, CANAL_Z - 12.9) - 0.05 });
  P('wall_low', x, CANAL_Z + 12.9, 0, { y: lipHeight(x, CANAL_Z + 12.9) - 0.05 });
}
P('cable_reel', 4.6, CANAL_Z + 15.5, 30); P('crate', -4.5, CANAL_Z + 15, 0);

// --- the hamlet on the north bank: the café at the bridge, houses up the street ---
const FRONT = 6.4;
const LEFT = (m, z, wd, o = {}) => P(m, FRONT + wd, z, -90, { pad: true, ...o });
const RIGHT = (m, z, wd, o = {}) => P(m, -FRONT - wd, z, 90, { pad: true, ...o });
P('house_g', -(FRONT + 1.8 + 3.7), 152, 90, { pad: true });     // the café, set back for its terrace on the corner by the bridge
LEFT('house_b', 150, 3.8); LEFT('house_a', 165, 2.85); RIGHT('house_d', 168, 2.2);
LEFT('house_f', 180, 4.0); RIGHT('house_c', 182, 3.1); LEFT('ruin', 196, 3.3); RIGHT('house_e', 199, 4.0);
LEFT('house_d', 211, 2.2); RIGHT('barn', 216, 3.7);
P('lamp_post', -5.3, 141, 90, { light: true }); P('lamp_post', 5.3, 174, -90, { light: true }); P('lamp_post', -5.3, 206, 90, { light: true });
P('wall_lamp', FRONT, 165.6, -90, { y: above(2.7), light: true });
P('cart', 4.6, 188, 10); P('bicycle', -6, 160, 95); P('barrel_wood', 5.2, 158, 0); P('bench', -9.6, 176, 90);
P('sandbags', -2, 143, 0); P('sandbags_curve', 3.5, 145, 200);
P('kubelwagen', -3, 226, 190); P('motorcycle_sidecar', 3, 232, 170); P('truck', 1, 246, 180);
P('rubble_pile', 8, 194, 30); P('beam_charred', 9.2, 199, 60, { burning: 0.5 });
// gardens behind the houses
for (const z of [158, 186, 204]) { P('wall_low', 18, z, 90); P('wall_low', -18, z, 90); }
P('fence_picket', 16, 172, 90); P('fence_picket', -16, 174, 90); P('well', 22, 176, 0); P('haystack', -24, 214, 0);

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
for (const [nx, nz] of [[11, 99], [-9, 100]]) for (let k = 0; k < 6; k++) {
  const a = RC.range(-1.2, 1.2), d = RC.range(2.6, 4.4);
  C(RC.pick(['ammo_box', 'ammo_box', 'jerrycan', 'dropped_helmet_de']), nx + Math.sin(a) * d, nz + Math.cos(a) * d, 1);
}

/* ---------- vegetation ---------- */

const R = rng(20250605);
const scatter = [];
const noTree = (x, z) => near(LANE, BOX.LANE, x, z) < 5 || near(STREET, BOX.STREET, x, z) < 8 || Math.abs(z - CANAL_Z) < 15
  || TRENCHES.some(([T, b]) => near(T, b, x, z) < 4) || Math.hypot(x + 9, z - 96) < 11 || Math.abs(z - 73) < 3
  || (z > CANAL_Z + 12 && z < 222 && Math.abs(x) < 22);
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
  if (Math.abs(x) < 6 || near(LANE, BOX.LANE, x, z) < 4) continue;
  scatter.push({ m: 'reeds', x, z, yaw: R() * 360, scale: 0.8 + R() * 0.5, cover: true });
}

const cover = [];
for (let i = 0; i < 26000; i++) {
  const x = R.range(-54, 54), z = R.range(-24, 252);
  if (near(LANE, BOX.LANE, x, z) < 2.8 || near(STREET, BOX.STREET, x, z) < 5.5 || Math.abs(z - CANAL_Z) < 13.5) continue;
  const q = R();
  const m = z < CANAL_Z ? (q < 0.45 ? 'grass_tall' : q < 0.6 ? 'reeds' : q < 0.7 ? 'weeds' : 'grass_tuft')
    : (q < 0.15 ? 'nettles' : q < 0.3 ? 'weeds' : q < 0.45 ? 'grass_tall' : 'grass_tuft');
  cover.push({ m, x, z, yaw: R() * 360, scale: 0.7 + R() * 0.6 });
}

/* ---------- enemies ---------- */

const E = (type, x, z, yaw, group, o = {}) => ({ type, at: [x, z], yaw, group, ...o });
const enemies = [
  // a patrol along the inside of the wire
  E('rifle', -20, 80, 90, 'wire', { patrol: [[-30, 80], [26, 80]] }),
  E('rifle', 24, 82, 270, 'wire', { patrol: [[30, 82], [-24, 82]] }),
  // the south bank: pillbox, MG nest, the trenches, the sentries at the bridge
  E('mg', 0, 0, 180, 'pillbox', { bunker: 'pillbox', arc: 0.8 }),
  E('mg', 0, 0, 185, 'pillbox', { nest: 'nest_s', arc: 0.9 }),
  E('rifle', -30, 91.4, 180, 'pillbox', { hold: true, inTrench: true }),
  E('rifle', -22, 91.6, 175, 'pillbox', { hold: true, inTrench: true }),
  E('rifle', 12, 92.8, 180, 'pillbox', { hold: true, inTrench: true }),
  E('smg', 21, 92.2, 185, 'pillbox', { hold: true, inTrench: true }),
  E('rifle', 31, 91.8, 180, 'pillbox', { hold: true, inTrench: true }),
  E('rifle', -3.4, 102.5, 180, 'pillbox', { leash: 6 }),
  E('rifle', 2.5, 105, 170, 'pillbox', { patrol: [[2, 104], [2, 134], [-2, 134], [-2, 104]] }),
  // the far bank: the café, the street
  E('smg', -6, 146, 180, 'farbank'),
  E('rifle', 3.5, 144, 180, 'farbank'),
  E('rifle', -7, 146, 160, 'farbank', { leash: 8 }),
  E('rifle', 9, 153, 200, 'farbank', { leash: 8 }),
  E('rifle', -2, 170, 180, 'farbank', { patrol: [[-2, 158], [-2, 190]] }),
  E('smg', 4, 182, 185, 'farbank'),
  E('rifle', -9, 186, 170, 'farbank', { leash: 10 }),
  E('rifle', 22, 168, 200, 'farbank', { patrol: [[22, 160], [22, 196]] }),
  // the counter-attack, waiting up the road for the order
  E('smg', -2, 228, 180, 'counter', { leash: 40 }),
  E('rifle', 4, 230, 180, 'counter', { leash: 40 }),
  E('rifle', -8, 232, 180, 'counter', { leash: 40 }),
  E('rifle', 8, 238, 190, 'counter', { leash: 40 }),
  E('smg', -4, 240, 180, 'counter', { leash: 40, tough: 1.4 }),
  E('rifle', 14, 222, 200, 'counter', { leash: 40 }),
  E('rifle', -14, 224, 160, 'counter', { leash: 40 }),
  E('rifle', 2, 246, 180, 'counter', { leash: 40 }),
];

/* ---------- pickups, checkpoints, objectives ---------- */

const pickups = [
  { type: 'ammo', x: 7, z: 8 }, { type: 'grenades', x: 4, z: 7 }, { type: 'medkit', x: 2, z: 30 },
  { type: 'medkit', x: -20, z: 60 }, { type: 'ammo', x: 20, z: 64 }, { type: 'medkit', x: 3, z: 84 },
  { type: 'grenades', x: -14, z: 86 }, { type: 'ammo', x: -18, z: 101 }, { type: 'medkit', x: 16, z: 103 },
  { type: 'medkit', x: 3, z: 141 }, { type: 'ammo', x: -9, z: 141 }, { type: 'grenades', x: 2, z: 162 },
  { type: 'medkit', x: -4, z: 176 }, { type: 'ammo', x: 3, z: 150 }, { type: 'medkit', x: -8, z: 156 },
];

const checkpoints = [
  { x: 4, z: 4, spawn: [4, 4, 0] },
  { x: 0, z: 84, r: 8, spawn: [0, 82, 0] },
  { x: 0, z: 104, r: 6, spawn: [0, 103, 0] },
  { x: 0, z: 142, r: 6, spawn: [0, 141, 0] },
  { x: 0, z: 168, r: 9, spawn: [0, 160, 0] },
];

const objectives = [
  { id: 'wire', text: 'Get through the wire belt', kind: 'cross', z: 77, marker: [0, 74] },
  { id: 'pillbox', text: 'Silence the pillbox and the bridge guards', kind: 'clear', groups: ['pillbox'] },
  { id: 'bridge', text: 'Rush the bridge before it can be blown', kind: 'cross', z: CANAL_Z + HALF + 2, marker: [0, CANAL_Z + HALF] },
  { id: 'cafe', text: 'Clear the café and the houses on the far bank', kind: 'clear', groups: ['farbank'] },
  { id: 'hold', text: 'Hold the north end of the bridge', kind: 'hold', x: 0, z: 150, r: 24, time: 90, counter: ['counter'], warning: 'They are coming down the road — hold the bridge' },
];

const hints = [
  { x: 4, z: 8, r: 6, text: 'The bridge is wired for demolition', sub: 'Get across before they can fire the charges' },
  { x: 0, z: 62, r: 8, text: 'The wire has gaps', sub: 'Left of the road and right of it; the road itself is barred' },
  { x: 0, z: 90, r: 7, text: 'Their pillbox looks down the road', sub: 'Work round it through the trenches, grenades through the slit' },
  { x: 0, z: 140, r: 6, text: 'The café is their command post', sub: 'Clear the street, then hold here' },
];

export default {
  id: 'pont-tournant',
  title: 'Pont-Tournant',
  completeTitle: 'Pont-Tournant is held',
  when: 'Normandy, 6 June 1944 — 00:20, wind and rain',
  briefing: [
    'Your glider cast off over the coast and came down in the marsh south of the canal, short of the bridge at Pont-Tournant. The landing broke it open; the others are coming out of the wrecks behind you.',
    'The bridge is the only road from the beaches to the east. It is wired for demolition. Get through the wire, put the pillbox and the machine gun out of action, rush the bridge and clear the café and the houses on the far bank before they can fire the charges.',
    'Then hold the north end. They will counter-attack down the road from the village. The paratroopers are on their way.',
  ],
  daylight: false,
  weather: { rain: 0.65 },
  start: [4, 4, 0],
  menuView: { from: [-14, 4.6, 84], to: [0, 4.2, 126] },
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
  lines: { LANE, STREET, TRENCH_W, TRENCH_E },
  craters: ROUGH.craters,
};
