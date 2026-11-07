/* Hedgerow — Mission 2: La Varenne, the morning of 6 June 1944.

   An original scenario inspired by the D-Day morning assaults on German gun
   batteries behind the beaches, when small groups of scattered paratroopers
   took guns dug in along a hedgerow, working along the trench that joined
   them, one gun at a time.

   The player lands in the valley bottom (z ≈ -10) with the supply
   canisters, gets through the first hedgerow, climbs the long meadow and
   takes the three guns along the battery hedgerow on the crest (z ≈ 143,
   ten metres up; their barrels point north, at the causeway behind the
   beach; the infantry's trench runs below the hedge on its south side, an
   MG nest at each end), then goes down to the farmyard of La Varenne
   (z ≈ 210), blows the ammunition there and reaches the road beyond it.

   Ways round: the sunken lane winding up the fold on the west (under the
   west MG), the track round the spur through the orchard on the east (under
   the east MG), or the meadow between them by the drain, the knoll and from
   crater to crater; the trench can be entered at either end, through the
   three gaps bombed in its wire, or jumped into from the hedge gaps. Cover
   is laid in steps up the slope (fallen tree and cart in the lane, the old
   boundary's low hedge across the meadow, the calvary on the knoll, the
   orchard's rows), so each approach reads as a run between safe places.

   World axes as Saint-Clair: +z north (the way forward), +x west (the
   player's left), yaw 0 turns a model's front to +z, 180 to the south. */

import { fbm2, smoothstep, smoothPolyline, rng, lerp, polylineDistance } from '../util.js';
import { bbox, near, along, hedgeBanks, gaps, curve, offset, atZ, roughGround, cutTrench } from './kit.js';
import { naturalDrain } from './landform-banks.js';
import { fieldwork } from './fieldwork.js';

/* ---------- lines on the ground ---------- */

/* Laid out like the batteries behind the beaches on the old maps: the ground rising from a wet
   valley bottom to a low crest the guns are dug along, the hedgerows bending with the contours,
   a sunken lane winding up a fold on one side and a farm track round a spur on the other, the
   farm in the dip beyond the crest with its road curving away north. */
const LANE = smoothPolyline([[30, -28], [36, -6], [46, 20], [40, 48], [48, 78], [40, 108], [46, 132], [38, 160], [24, 184], [12, 198]], 2);
const TRACK = smoothPolyline([[-12, -26], [-26, 6], [-40, 34], [-34, 64], [-44, 96], [-38, 124], [-44, 152], [-32, 178], [-16, 200]], 2);
const ROAD = smoothPolyline([[-2, 198], [-10, 214], [-20, 228], [-18, 244], [-8, 258], [-10, 272]], 2);
// The old field drain offers a low approach through the middle of the meadow.
// It bends around the knoll and stops short of the battery's wire: useful
// cover while crouched, with an exposed final dash into the trench.
const DRAIN = naturalDrain(smoothPolyline([[14, 70], [22, 80], [14, 96], [18, 114], [26, 129]], 2), { depth: 0.95, half: 3.0 });
// the hedgerows' lines across the fields: the first one, the battery's along the crest, the farm's
const firstZ = (x) => 58 + 6 * Math.sin((x + 10) / 14);
const crestZ = (x) => 143 + 5 * Math.sin((x - 4) / 18);
const northZ = (x) => 190 + 4 * Math.sin(x / 12);
const trenchZ = (x) => crestZ(x) - 6.5;
const TRENCH_A = smoothPolyline(curve((x) => trenchZ(x) + 1.4 * Math.sin(x / 5), 34, -38, 6), 1);
const TRENCH_DEPTH = 1.25;
const YARD = { x0: -18, x1: 18, z0: 198, z1: 224 };
const GUNS = [24, -2, -28].map((x) => [x, crestZ(x) + 5.5]);
const FIELDS = fieldwork([
  { x: -9, z: 21, width: 25, length: 39, yaw: -9, soil: 2.1 },
  { x: -7, z: 177, width: 32, length: 18, yaw: 5, soil: 1.2, relief: 0.045 },
]);

// An old field boundary, grubbed out but for its bank and a few stretches of low hedge: the one
// line of cover across the middle of the meadow, broken where the drain and the patrols go
// through and where the knoll's calvary stands in for it.
const REMNANT_Z = (x) => 104 + 3 * Math.sin(x / 11);
const REMNANT = hedgeBanks([[26, 21], [12, 2], [-19, -27]].map(([a, b]) => curve(REMNANT_Z, a, b, 1.5)), { height: 0.5, half: 1.8, natural: true });
// The heavy bombers' sticks from the night before: wide, older craters than the shell holes,
// rainwater standing in them, lying across the battery's approach and into the field behind it.
const BOMBS = [[-14, 121, 4.2], [9, 116, 3.6], [31, 121, 3.3], [-31, 117, 3.8], [16, 165, 3.6], [-20, 158, 3.2], [-2, 88, 3.4]]
  .map(([x, z, r]) => ({ x, z, r, h: r * 0.3, crater: true }));
const bombHeight = (x, z) => {
  let h = 0;
  for (const b of BOMBS) {
    const d = Math.hypot(x - b.x, z - b.z) / b.r;
    if (d < 1.6) h += -b.h * smoothstep(1.0, 0.0, d) * smoothstep(0.0, 0.2, 1 - d * 0.2) + b.h * 0.45 * smoothstep(0.75, 1.05, d) * smoothstep(1.6, 1.05, d);
  }
  return h;
};

const BOX = { LANE: bbox(LANE, 10), TRACK: bbox(TRACK, 10), ROAD: bbox(ROAD, 10), TA: bbox(TRENCH_A, 6) };

/* the hedgerows on their banks, cut where the lane, the track, the road and the gates go through */
const onWay = (x, z, w = 5) => near(LANE, BOX.LANE, x, z) < w || near(TRACK, BOX.TRACK, x, z) < w || near(ROAD, BOX.ROAD, x, z) < w;
// the hedges across the fields end at the lane's (the west edge), not in stubs out past it
const inFields = (x, z) => x < atZ(LANE, z).x && !onWay(x, z);
const HEDGES = hedgeBanks([
  // the lane's own hedges either side, with gaps into the fields
  ...gaps(offset(LANE, 6), (x, z) => z < 180 && !((z > 26 && z < 34) || (z > 96 && z < 106) || (z > 150 && z < 158))),
  ...gaps(offset(LANE, -6), (x, z) => z < 176 && !((z > 30 && z < 38) || (z > 62 && z < 72) || (z > 118 && z < 126))),
  // the field edge east, bending (on the west the lane's hedge is the edge)
  ...gaps(curve((z) => -54 + 3 * Math.sin(z / 26), -26, 250, 3).map(([z, x]) => [x, z]), (x, z) => !onWay(x, z)),
  // the first hedgerow: a gate in the middle, gaps where the lane and the track go through
  ...gaps(curve(firstZ, 52, -56, 2), (x, z) => Math.abs(x - 4) > 3 && Math.abs(x + 20) > 2.5 && inFields(x, z)),
  // the battery's along the crest, cut for the three guns' fields of fire
  ...gaps(curve(crestZ, 52, -56, 2), (x, z) => GUNS.every(([gx]) => Math.abs(x - gx) > 6) && Math.abs(x - 11) > 2.5 && inFields(x, z)),
  // between the north field and the farm, a gate under the manor's windows
  ...gaps(curve(northZ, 40, -56, 2), (x, z) => Math.abs(x - 16) > 5 && inFields(x, z) && !(x > -14 && x < 8)),
], { natural: true });

const TMP = {};
/* the heading (yaw, degrees) of a line z = f(x) at x, and the trench's own line */
const yawOf = (f, x) => -Math.atan(f(x + 0.5) - f(x - 0.5)) * 180 / Math.PI;
const inTrenchZ = (x) => trenchZ(x) + 1.4 * Math.sin(x / 5);

/* the undisturbed ground: what trenches, lanes and pads follow so they stay level. Rising from the
   valley in the south to the crest, falling a little to the farm; the lane's fold, the track's
   spur, a knoll in the meadow with a copse on it, the hills closing the fields in. */
function lipHeight(x, z) {
  let h = 1.0 + 9.5 * smoothstep(-20, 150, z) - 3.5 * smoothstep(150, 215, z);
  h += fbm2(x / 45 + 3.1, z / 45 - 1.7, 3) * 1.6;
  h -= 2.4 * Math.exp(-((x - 44) ** 2) / 260) * smoothstep(0, 40, z) * smoothstep(175, 120, z);
  h += 2.6 * Math.exp(-((x + 47) ** 2) / 390) * smoothstep(20, 80, z);
  h += 3.4 * Math.exp(-((x + 8) ** 2 + (z - 96) ** 2) / 420);
  return h + 9 * smoothstep(58, 95, Math.abs(x)) + 6 * smoothstep(-20, -45, z);
}

/* ---------- small irregularities ---------- */

function roughAllowed(x, z) {
  let k = 1;
  k = Math.min(k, smoothstep(3.5, 6.5, near(LANE, BOX.LANE, x, z)));
  k = Math.min(k, smoothstep(3.0, 5.5, near(TRACK, BOX.TRACK, x, z)));
  k = Math.min(k, smoothstep(3.0, 5.5, near(ROAD, BOX.ROAD, x, z)));
  k = Math.min(k, smoothstep(2.6, 5, near(TRENCH_A, BOX.TA, x, z)));
  k = Math.min(k, smoothstep(2.4, 4.5, HEDGES.dist(x, z)));
  k = Math.min(k, smoothstep(2.0, 4.0, DRAIN.dist(x, z)));
  k = Math.min(k, smoothstep(1.8, 3.6, REMNANT.dist(x, z)));
  for (const b of BOMBS) k = Math.min(k, smoothstep(b.r * 1.2, b.r * 1.7, Math.hypot(x - b.x, z - b.z)));
  for (const [gx, gz] of GUNS) k = Math.min(k, smoothstep(5, 8, Math.hypot(x - gx, z - gz)));
  if (x > YARD.x0 - 12 && x < YARD.x1 + 12 && z > YARD.z0 - 4 && z < YARD.z1 + 22) k = 0;
  return k;
}
const ROUGH = roughGround(rng(1944060), {
  mounds: 700, craters: 46, area: { x0: -60, x1: 60, z0: -30, z1: 260 }, craterArea: { x0: -40, x1: 34, z0: 0, z1: 190 }, allowed: roughAllowed,
});

/* ---------- the ground ---------- */

function baseHeight(x, z) {
  let h = lipHeight(x, z) + fbm2(x / 19, z / 19, 2) * 0.25 + FIELDS.height(x, z);
  const k = roughAllowed(x, z);
  if (k > 0) h += k * (0.16 * fbm2(x / 5.3 + 11.7, z / 5.3 - 3.1, 3) + ROUGH.height(x, z));
  // The low ridges left by generations of cultivation are subtle at eye
  // level, but keep the meadow from reading as a uniformly noisy plane.
  const field = smoothstep(62, 72, z) * smoothstep(128, 116, z) * smoothstep(-25, -16, x) * smoothstep(34, 26, x);
  h += Math.sin((x + z * 0.12) * 1.05) * 0.075 * field * k;
  h = DRAIN.cut(h, x, z);
  h += REMNANT.rise(x, z) + bombHeight(x, z);
  // the farm stands on a level patch
  const yard = smoothstep(14, 4, Math.max(YARD.x0 - x, x - YARD.x1, YARD.z0 - z, z - YARD.z1 - 12, 0));
  h = lerp(h, lipHeight(0, 212), yard);
  // the banks under the hedges
  h += HEDGES.rise(x, z);
  // the sunken lane, worn a metre and more down into the fold it climbs
  const dl = near(LANE, BOX.LANE, x, z);
  if (dl < 6) {
    polylineDistance(LANE, x, z, TMP);
    const laneH = lipHeight(TMP.px, TMP.pz) - 1.2 * smoothstep(-20, 10, TMP.pz) * smoothstep(196, 176, TMP.pz);
    h = lerp(h, laneH, smoothstep(4.2, 2.4, dl));
  }
  // the farm track and the road out of the yard: flat, a little camber
  for (const [line, box] of [[TRACK, BOX.TRACK], [ROAD, BOX.ROAD]]) {
    const d = near(line, box, x, z);
    if (d < 5) { polylineDistance(line, x, z, TMP); h = lerp(h, lipHeight(TMP.px, TMP.pz) - 0.05 - d * d * 0.004, smoothstep(5, 2.2, d)); }
  }
  // the infantry's trench below the battery hedge, ramps at its ends
  h = cutTrench(TRENCH_A, BOX.TA, lipHeight, TRENCH_DEPTH, h, x, z);
  for (const [rx, rz] of [TRENCH_A[0], TRENCH_A[TRENCH_A.length - 1]]) {
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
  let mud = FIELDS.mud(x, z), grass = 1, forest = 0, cobble = 0;
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
  // Bare earth at the bottom of the drain, leaf mould on its damp margins.
  const drain = DRAIN.strength(x, z);
  // The narrow thalweg stays damp while the rounded upper shoulders keep
  // grass, rather than painting the entire six-metre swale as a mud chute.
  mud += DRAIN.wet(x, z) * 2.4 + drain * drain * 0.9;
  forest += smoothstep(4.0, 2.2, DRAIN.dist(x, z)) * (1 - drain) * 0.18;
  // the farmyard: setts under the mud, trodden to mud at the edges
  const inYard = x > YARD.x0 && x < YARD.x1 && z > YARD.z0 && z < YARD.z1;
  if (inYard) { cobble = smoothstep(0, 3, Math.min(x - YARD.x0, YARD.x1 - x, z - YARD.z0, YARD.z1 - z)) * (0.6 + 0.4 * smoothstep(-0.3, 0.3, n)); mud += 0.8; }
  // the orchard by the track, the old boundary's bank, the bomb craters' bare spoil
  if (x < -28 && z > 66 && z < 132) { forest += 0.35; }
  forest += smoothstep(2.0, 0.8, REMNANT.dist(x, z)) * 0.6;
  mud += Math.min(1.6, Math.abs(bombHeight(x, z)) * 1.8);
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
P('gate', 4, firstZ(4) - 0.5, yawOf(firstZ, 4)); P('signpost', 10, firstZ(10) - 4, -20);
// the meadow: a burnt-out staff car in the gate's lee, haystacks, a trough
P('kubelwagen', -6, 82, 150, { fire: true, fireSize: 0.7, debris: 2 });
P('haystack', 20, 96, 0); P('haystack', -20, 108, 0); P('haystack', 26, 72, 0);
P('water_trough', -14, 70, 20);
P('supply_canister', -24, 92, 140);
P('field_harrow', -21, 4, -12);
P('field_harrow', -21, 184, 90);
// Farm boundaries explain the orchard route; the broken sections leave wide
// ways through and can be vaulted. A discarded barrel marks the drain.
along(TRACK, 8.5, 5.2, (x, z, yaw) => P('fence_field', x, z, yaw), 72, 122);
P('barrel_wood', 26, 78, 0);

const RV = rng(6061944);   // the later additions draw their own dice, leaving the older layout where it was
const laneAt = (z, side = 0) => { const a = atZ(LANE, z); return [a.x + a.tz * side, z - a.tx * side, Math.atan2(a.tx, a.tz) * 180 / Math.PI]; };

// The sunken lane: a tree brought down across it by the shelling, and a farm cart abandoned
// further up where the machine gun looks down the lane, the one solid thing to get behind.
{
  const [x, z, yaw] = laneAt(86, 0.6);
  P('log', x, z, yaw + 68, { scale: 1.15 }); P('log', x - 1.6, z + 0.7, yaw + 52, { scale: 0.7 });
  P('bush_a', x + 2.4, z - 1.2, 30, { veg: true, scale: 1.2 });
  const [cx, cz, cyaw] = laneAt(118, 1.5);
  P('cart', cx, cz, cyaw + 8);
  const [bx, bz] = laneAt(121, -1.6); P('barrel_wood', bx, bz, 0);
}

// The knoll between the lane and the drain: a wayside calvary in a ring of old wall under a lone
// oak, the meadow's landmark, with a sandbagged observation post in its lee looking downhill.
P('cross', -8, 96, 170);
P('wall_broken', -5.2, 93.2, 160); P('wall_broken', -11.6, 94.1, 205); P('wall_low', -9.4, 99.6, 10);
P('sandbags_low', -5, 100.8, 175); P('sandbags_curve', -12.2, 99.4, 150);
P('boulder_b', -15.6, 92, 40); P('boulder_a', -2.4, 97.5, 110); P('rocks_small', -10, 90.5, 0);
P('field_telephone', -6.6, 101.4, 200); P('cable_reel', -2.2, 104.2, 20);

// The old boundary's low hedge, in stretches with a few pollarded oaks standing out of it.
REMNANT.plant((m, x, z, yaw, o) => P('hedge_low', x, z, yaw, o), above(-0.12), 4.2);

// The orchard round the track: apple trees in rows, a few lost to the shelling, a ladder and the
// last autumn's barrels left among them. Trunks every few metres: cover from tree to tree.
const ORCHARD = [];
for (let row = 0; row < 12; row++) for (let col = 0; col < 5; col++) {
  const x = -27.5 - col * 5.6 + row * 0.55 + RV.range(-0.5, 0.5), z = 66 + row * 6 + col * 0.8 + RV.range(-0.5, 0.5);
  if (x < -52 || REMNANT.dist(x, z) < 2.5 || near(TRACK, BOX.TRACK, x, z) < 4 || Math.abs(near(TRACK, BOX.TRACK, x, z) - 8.5) < 1.4) continue;
  const fate = RV();
  if (fate < 0.12) continue;
  ORCHARD.push([x, z, fate < 0.2 ? 'stump' : fate < 0.26 ? 'tree_dead' : 'tree']);
}
P('orchard_ladder', -46, 85, 25); P('crate', -44.5, 84, -12);
P('barrel_wood', -31.5, 98, 0); P('barrel_wood', -32.2, 98.8, 0); P('crate', -30.8, 99.6, 40);
P('log', -48, 112, 80);

// --- the battery: three guns in revetted pits cut through the hedge, the infantry's trench behind ---
GUNS.forEach(([gx, gz], i) => {
  P('pak40', gx, gz, 0, { pad: true, y: lipHeight(gx, gz) - 0.35, id: `gun${i + 1}` });
  P('gun_revetment', gx, gz, 0, { y: lipHeight(gx, gz) - 0.35 });
  P('ammo_stack', gx + 2.6, gz - 1.4, 15 + i * 30);
  P('camo_net', gx, gz + 0.5, 0);
});
// trench walls and the sandbags on its lip (south: the side they fire from)
along(TRENCH_A, 3.9, 0.86, (x, z, yaw) => P('trench_wall', x, z, yaw, { y: trenchWallY }));
along(TRENCH_A, 3.9, -0.86, (x, z, yaw) => P('trench_wall', x, z, yaw + 180, { y: trenchWallY }));
along(TRENCH_A, 8.5, -2.1, (x, z, yaw) => P('sandbags_low', x, z, yaw + 180));
P('mg_nest', 38, crestZ(38) + 7, 200, { id: 'nest_w' });
P('mg_nest', -42, crestZ(-42) + 8, 160, { id: 'nest_e' });
P('sandbags_ruined', 31, trenchZ(31) + 2.6, yawOf(trenchZ, 31)); P('sandbags_ruined', -34, trenchZ(-34) + 2.4, yawOf(trenchZ, -34) + 180);
P('dugout_entrance', 8, trenchZ(8) - 5, yawOf(trenchZ, 8)); P('field_telephone', 6.5, trenchZ(6.5) - 3.6, 30); P('cable_reel', 15, trenchZ(15) - 6, 20);
// The wire belt in front of the trench, continuous but for the gaps the bombs blew in it: at the
// drain's head, in front of the dugout and by the orchard. Elsewhere it has to be climbed in the open.
const WIRE_GAPS = [[22, 28], [1, 7], [-24, -18]];
for (let x = 34; x > -38; x -= 3.9) if (!WIRE_GAPS.some(([a, b]) => x > a - 2 && x < b + 2)) P('barbed_wire', x, trenchZ(x) - 9, yawOf(trenchZ, x));
P('sign_minen', 30, trenchZ(30) - 10, 180); P('sign_minen', -30, trenchZ(-30) - 9, 190); P('sign_minen', 11, trenchZ(11) - 10.5, 170);
// trees on the crest broken by the bombing
for (const [x, z, yaw] of [[16, 141, 30], [-14, 140.5, 200], [-36, 135, 110], [33, 154, 300]]) P('tree_dead', x, z, yaw, { veg: true });

// The battery's horse lines behind the crest: two ammunition limbers, their crates half unloaded.
P('cart', 14, 160.5, 100); P('cart', 19.5, 163.5, 75);
P('crate_large', 16.4, 158.4, 10); P('crate_large', 11.6, 163, 95); P('crate', 13.4, 157.2, 60);
P('haystack', 22.5, 168.5, 0); P('water_trough', 9, 160, 80);

// Field edges: stumps of felled trees, a sawn log, a field stone, along the banks' field side.
for (let i = 0, n = 0; i < 3000 && n < 34; i++) {
  const x = RV.range(-50, 36), z = RV.range(-12, 190), d = HEDGES.dist(x, z), m = RV.pick(['stump', 'stump', 'log', 'boulder_a', 'rocks_small']);
  if (d < 2.6 || d > 3.6 || FIELDS.mask(x, z) > 0.1 || x > atZ(LANE, z).x - 7 || REMNANT.dist(x, z) < 3) continue;
  if (near(TRACK, BOX.TRACK, x, z) < 4 || near(TRENCH_A, BOX.TA, x, z) < 5 || DRAIN.dist(x, z) < 4 || GUNS.some(([gx, gz]) => Math.hypot(x - gx, z - gz) < 9)) continue;
  P(m, x, z, RV() * 360, { scale: 0.8 + RV() * 0.35 }); n++;
}

// --- the farm of La Varenne round its yard ---
P('house_e', 0, 232, 180, { pad: true });                      // the manor, its front on the yard
P('barn', -26, 213, 90, { pad: true });
P('house_c', 25, 215, -90, { pad: true });
P('shed', -10, 238, 0, { pad: true });
P('wall_high', 20, 196, 0); P('wall_high', 24, 196, 0); P('wall_high', -13, 196, 0);   // the lane comes in between
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
  || DRAIN.dist(x, z) < 3.8 || REMNANT.dist(x, z) < 2.5 || BOMBS.some((b) => Math.hypot(x - b.x, z - b.z) < b.r * 1.3)
  || (x < -24 && x > -50 && z > 62 && z < 136)
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
// the orchard along the track: low, spreading crowns on short trunks, as the cider apples grow
for (const [x, z, kind] of ORCHARD) {
  if (kind === 'stump') props.push({ m: 'stump', x, z, yaw: RV() * 360, scale: 0.75 });
  else if (kind === 'tree_dead') props.push({ m: 'tree_dead', x, z, yaw: RV() * 360, scale: 0.55, veg: true });
  else scatter.push({ m: RV() < 0.75 ? 'oak_a' : 'oak_b', x, z, yaw: RV() * 360, scale: 0.42 + RV() * 0.14 });
}
// the lone oak over the calvary, and pollards standing out of the old boundary's stretches
scatter.push({ m: 'oak_big', x: -13.5, z: 97.5, yaw: 70, scale: 1.05, alt: 'oak_a', altScale: 1.5 });
for (const x of [24, 6, -24]) scatter.push({ m: 'oak_a', x, z: REMNANT_Z(x) + 0.4, yaw: RV() * 360, scale: 0.7 + RV() * 0.2 });
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
  if (DRAIN.strength(x, z) > 0.4) continue;
  if (BOMBS.some((b) => Math.hypot(x - b.x, z - b.z) < b.r * 0.85)) continue;
  if (x > YARD.x0 && x < YARD.x1 && z > YARD.z0 && z < YARD.z1) continue;
  const q = R(), hd = HEDGES.dist(x, z);
  const m = hd < 2.6 || REMNANT.dist(x, z) < 2.2 ? (q < 0.3 ? 'nettles' : q < 0.55 ? 'fern' : q < 0.7 ? 'weeds' : 'grass_tall')
    : q < 0.45 ? 'grass_tall' : q < 0.55 ? 'weeds' : 'grass_tuft';
  cover.push({ m, x, z, yaw: R() * 360, scale: 0.7 + R() * 0.6 });
}

// Filter after sampling so unrelated deterministic vegetation stays put.
for (let i = cover.length - 1; i >= 0; i--) if (FIELDS.mask(cover[i].x, cover[i].z) > 0.3) cover.splice(i, 1);
for (let i = scatter.length - 1; i >= 0; i--) if (FIELDS.mask(scatter[i].x, scatter[i].z) > 0.3) scatter.splice(i, 1);

/* ---------- enemies ---------- */

const E = (type, x, z, yaw, group, o = {}) => ({ type, at: [x, z], yaw, group, ...o });
const enemies = [
  // the meadow
  E('rifle', 14, 92, 190, 'meadow', { patrol: [[14, 92], [0, 84], [-17, 88], [-16, 124], [16, 124]] }),
  E('rifle', 30, 110, 160, 'meadow', { patrol: [[30, 110], [30, 80], [20, 66]] }),
  // the observation post on the knoll, looking down the meadow from behind the calvary's wall
  E('rifle', -5.4, 102.2, 185, 'knoll', { stance: 'crouch', leash: 7 }),
  E('rifle', -10.4, 102.6, 160, 'knoll', { leash: 7 }),
  // the orchard: a pair working through the trees, and a man at the lane's cart
  E('rifle', -38, 104, 170, 'orchard', { patrol: [[-38, 104], [-48, 92], [-46, 76], [-32, 88]] }),
  E('smg', -36, 116, 190, 'orchard', { leash: 10 }),
  E('rifle', ...laneAt(124, -1).slice(0, 2), 190, 'lane', { leash: 8 }),
  // the trench line along the battery hedge
  ...[['rifle', 28], ['rifle', 17], ['smg', 6], ['rifle', -6], ['rifle', -12], ['rifle', -22], ['smg', -33]]
    .map(([t, x], i) => E(t, x, inTrenchZ(x), 180 + ((i * 7) % 15) - 7, 'trench', { hold: true, inTrench: true })),
  E('mg', 0, 0, 200, 'trench', { nest: 'nest_w', arc: 0.9 }),
  E('mg', 0, 0, 160, 'trench', { nest: 'nest_e', arc: 0.9 }),
  // the guns' crews
  E('rifle', GUNS[0][0] + 2.6, GUNS[0][1] + 1.2, 190, 'guns', { stance: 'crouch', leash: 8 }),
  E('rifle', GUNS[1][0] + 2.6, GUNS[1][1] + 1.6, 170, 'guns', { stance: 'crouch', leash: 8 }),
  E('smg', GUNS[2][0] + 2.6, GUNS[2][1] + 1.2, 185, 'guns', { stance: 'crouch', leash: 8 }),
  E('rifle', GUNS[2][0] - 2.6, GUNS[2][1] + 1.0, 200, 'guns', { leash: 8 }),
  // the north field, between the guns and the farm
  E('rifle', 10, 170, 180, 'north', { patrol: [[10, 170], [-30, 170], [-30, 180], [10, 180]] }),
  E('rifle', -16, 165, 160, 'north', { leash: 14 }),
  E('rifle', 9.5, 167.5, 200, 'north', { stance: 'crouch', leash: 9 }),
  E('smg', 21, 160.5, 170, 'north', { leash: 9 }),
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
  { type: 'medkit', x: 4, z: 69 }, { type: 'ammo', x: -16, z: 74 }, { type: 'medkit', x: 40, z: 100 },
  { type: 'grenades', x: -40, z: 110 }, { type: 'ammo', x: 2, z: 128 }, { type: 'medkit', x: 33, z: 127 },
  { type: 'ammo', x: -7.5, z: 101.6 }, { type: 'medkit', x: -34, z: 92 }, { type: 'grenades', x: 16, z: 106.5 },
  { type: 'medkit', x: -2, z: 158 }, { type: 'ammo', x: -36, z: 150 }, { type: 'grenades', x: 18, z: 160 },
  { type: 'medkit', x: 20, z: 188 }, { type: 'ammo', x: -30, z: 180 }, { type: 'medkit', x: -14, z: 240 },
];

const checkpoints = [
  { x: 20, z: -12, spawn: [20, -12, 0] },
  { x: 5, z: 70, r: 9, spawn: [5, 70, 0] },
  { x: 4, z: 130, r: 10, spawn: [4, 126, 0] },
  { x: -6, z: 166, r: 10, spawn: [-6, 164, 0] },
  { x: 16, z: 190, r: 8, spawn: [16, 186, 0] },
];

const objectives = [
  { id: 'hedge', text: 'Get through the first hedgerow', kind: 'cross', z: 66, marker: [4, firstZ(4) - 3] },
  ...['west', 'middle', 'east'].map((side, i) => ({ id: `gun${i + 1}`, text: `Destroy the ${side} gun`, kind: 'destroy', orderGroup: 'battery', groupText: 'Destroy the battery guns', target: `gun${i + 1}`, x: GUNS[i][0], z: GUNS[i][1] - 3.1 })),
  { id: 'dump', text: 'Blow the ammunition dump in the farmyard', kind: 'destroy', target: 'dump', x: 5, z: 203.4 },
  { id: 'rally', text: 'Reach the road north of La Varenne', kind: 'reach', x: -12, z: 252, r: 7 },
];

const hints = [
  { x: 20, z: -6, r: 6, text: 'The guns are firing on the causeway', sub: 'Follow the compass marker; hold the right button to aim' },
  { x: 5, z: 50, r: 7, text: 'Three ways up the hill', sub: 'The sunken lane (left), the drain past the knoll (centre) or the orchard (right)' },
  { x: 4, z: 96, r: 7, text: 'The old hedge line is the last cover', sub: 'Crouch behind it; the observation post on the knoll overlooks the meadow' },
  { x: 0, z: 118, r: 8, text: 'The wire in front of the trench is broken in three places', sub: 'At the drain\'s head, by the dugout, near the orchard; grenades (G) clear the trench' },
  { x: 20, z: 78, r: 6, text: 'The field drain leads towards the battery', sub: 'Crouch to keep below its banks; the last stretch to the trench is open' },
  { x: -30, z: 132, r: 8, text: 'Take the guns in any order', sub: 'The compass marks the nearest remaining gun; press F beside it to set a charge' },
  { x: GUNS[0][0], z: GUNS[0][1] - 5, r: 6, text: 'Press F at a gun to set a charge', sub: 'Six seconds: get clear' },
];

export default {
  id: 'la-varenne',
  title: 'La Varenne',
  completeTitle: 'The guns at La Varenne are silent',
  when: 'Normandy, 6 June 1944 — 08:30, drizzle',
  briefing: [
    'You came down miles from the drop zone in the night. At first light a dozen of us have found each other in the fields west of the beach — and found a battery of guns at the farm of La Varenne, dug in along a hedgerow and shelling the causeway the seaborne troops must come up.',
    'The guns face north, at the beach. Their infantry hold a trench along the south side of the hedge, between a machine gun at each end. Work along it and put a charge on each gun, then blow the shells they have stacked in the farmyard.',
    'The ground rises all the way to their hedge, and they look down on you. Take the guns in whichever order your approach allows. There is the sunken lane winding up the fold on the left, the orchard track round the spur on the right, and an old field drain winding past the knoll through the meadow. The bombers have blown gaps in their wire; find one, then cross the last open stretch into the trench.',
  ],
  daylight: true,
  weather: { rain: 0.45 },
  start: [20, -12, 0],
  menuView: { from: [30, lipHeight(30, 110) + 4, 110], to: [0, lipHeight(0, 148) + 1.5, 148] },
  bounds: { minX: -110, maxX: 110, minZ: -50, maxZ: 300 },
  playBounds: { minX: -52, maxX: 52, minZ: -22, maxZ: 262 },
  fine: [[-44, 126, 40, 158], [10, 64, 30, 130], ...FIELDS.fine],
  water: null,
  baseHeight, splat, trackHeight: lipHeight,
  fields: FIELDS.definitions,
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
  lines: { LANE, TRACK, ROAD, TRENCH_A, DRAIN: DRAIN.line },
  craters: [...ROUGH.craters, ...BOMBS],
};
