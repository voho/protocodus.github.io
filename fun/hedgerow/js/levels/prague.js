/* Hedgerow — Prague Rising, 7 May 1945.

   An original, fictional action in a Vinohrady side street during the
   Prague uprising. It draws on barricade construction, the defence of
   broadcasting, and the use of linked courtyards, rather than recreating
   a particular real street or claiming a documented operation.

   +z goes uphill/north; +x is west. A tram barricade shelters the start.
   Tall urban blocks make two distinct ways to the radio annex: the tram
   street itself, or a covered passage into linked eastern courtyards.
   The annex is held, a separate German command set is demolished, and
   the resistance fighter withdraws into a western courtyard. */
import { rng } from '../util.js';
import { pragueHeight, pragueSplat, streetDatum } from './prague-ground.js';
import { varyPragueFrontages } from './prague-frontages.js';

const props = [];
const P = (m, x, z, yaw = 0, opts = {}) => props.push({ m, x, z, yaw, ...opts });
const frontage = ['prague_ochre', 'prague_gray', 'prague_rose'];
const centres = [-46, -32, -18, -4, 10, 24, 38, 52, 66, 80, 94, 108, 122, 136];

// Continuous city blocks; the address plan below mixes building ages and
// actual storey counts while retaining every named passage and damage site.
centres.forEach((z, i) => {
  const eastPassage = z === 24 || z === 94;
  const westPassage = z === 38;
  P(eastPassage ? 'prague_passage' : z === 108 ? 'prague_damaged' : frontage[(i + 1) % 3], -19, z, 90, { y: streetDatum(-19, z), id: eastPassage ? `east-passage-${z}` : undefined });
  P(westPassage ? 'prague_passage' : z === 66 ? 'prague_damaged' : frontage[i % 3], 19, z, -90, { y: streetDatum(19, z), id: westPassage ? 'west-passage' : undefined });
});
// Cross wings close the skyline at both ends of the urban courts. Their
// doors are scenery; the named passages remain the usable connections.
for (const x of [-57, -43, -29]) {
  P('prague_gray', x, 2, 0, { y: streetDatum(x, 2) });
  P('prague_rose', x, 122, 180, { y: streetDatum(x, 122) });
}
for (const z of [31, 45]) P('prague_gray', 50, z, -90, { y: streetDatum(50, z) });
P('prague_ochre', 36, 14, 0, { y: streetDatum(36, 14) });
P('prague_rose', 36, 66, 180, { y: streetDatum(36, 66) });
// Rear tenement wall encloses the east courts. The opposite wing is a
// genuinely open vaulted passage, with a court on either side.
for (const [i, z] of [14, 28, 42, 56, 70, 84, 98, 112].entries()) P(frontage[(i + 2) % 3], -64, z, 90, { y: streetDatum(-64, z) });
P('prague_passage', -42, 56, 0, { y: streetDatum(-42, 56), id: 'court-passage' });
for (const x of [-59, -55, -51, -33, -29, -25]) P('wall_high', x, 56, 0);
for (const z of [10, 114]) for (const x of [-57, -53, -49, -45, -41, -37, -33, -29]) P('wall_high', x, z, 0);
// The western withdrawal yard is visible through the arcade but sheltered
// from the street. Its open interior remains useful during the last phase.
for (const z of [24, 28, 32, 36, 40, 44, 48, 52, 56]) P('wall_high', 45, z, 90);
for (const z of [22, 58]) for (const x of [27, 31, 35, 39, 43]) P('wall_high', x, z, 0);

// Tram infrastructure provides a strong urban centreline and period cue.
for (let z = -49; z <= 133; z += 14) P('prague_tram_rails', 0, z, 0, { y: pragueHeight(0, z) + 0.006, contact: false });
for (let z = -49; z <= 133; z += 14) {
  P('prague_pavement', 11.4, z, 0, { y: pragueHeight(11.4, z) + 0.017, contact: false });
  P('prague_pavement_e', -11.4, z, 0, { y: pragueHeight(-11.4, z) + 0.017, contact: false });
}
// The trolley line is continuous between supports, with one cut section
// directly above the wreck; the surviving ends stop short of its trolley.
for (let z = -49; z <= 133; z += 14) {
  if (z === -21) continue;
  P('prague_contact_wire', 0, z, 0, { y: streetDatum(0, z), contact: false });
}
for (const z of [-28, 28, 84, 126]) P('prague_tram_span', 0, z, 0, { y: streetDatum(0, z), contact: false });
P('tram_barricade', -0.8, -23, 76, { y: streetDatum(-0.8, -23), id: 'tram-start' });
P('prague_barricade', 8.4, -18, 10);
P('prague_barricade', -5.5, 48, -9);
P('prague_barricade', 5.7, 73, 9);
P('rubble_pile', 10.7, 68, -15, { scale: 0.7 });
P('rubble_pile', -10.7, 107, 30, { scale: 0.85 });
P('truck_burnt', -8.7, 117, 172, { fire: true, fireSize: 0.45, debris: 1 });
P('kubelwagen', 5.7, 108, 166);

// The German command set is separate from the friendly relay. The player
// reports from the latter, then crosses the street to destroy this one.
P('radio_table', 4.2, 101, 180, { id: 'command-radio', separate: true });
P('cable_reel', 7.1, 100.5, 20); P('ammo_stack', 7.8, 103.4, -15);
P('sandbags_low', 1.5, 96.8, 0); P('crate_large', 8.0, 97.0, 16);
P('field_telephone', 7.0, 103.4, 30);
P('mg_nest', 1.2, 82.2, 180, { id: 'street-mg' });
// The relay annex occupies an improvised protected corner of the north
// courtyard. Gaps beside the bags give guards usable exits and flank arcs.
P('radio_table', -48.5, 87.7, 80, { id: 'relay-radio', separate: true });
P('prague_relay_sign', -46.0, 84.8, 180);
P('cable_reel', -51.4, 87.5, 20); P('crate_large', -51.0, 90.5, -12);
P('sandbags_low', -43.3, 80.2, 0); P('sandbags', -36.0, 89.8, 90);
P('barrel_wood', -55.0, 77.0, 10); P('barrel_wood', -54.4, 78.0, -15);
P('bench', -55.4, 97, 90); P('stretcher', -50.5, 93.0, -20);
P('bicycle', -27.0, 96.0, 10);

// Recognisable, sparse street furniture instead of noisy scatter.
for (const [x, z, yaw] of [[11.8, -4, -90], [-11.8, 31, 90], [11.8, 59, -90], [-11.8, 101, 90]]) P('lamp_post', x, z, yaw);
P('bench', -54.5, 24, 90); P('cart', -53.0, 37, 20); P('barrel_wood', -29.3, 18, 5);
P('bicycle', 12.9, 19, -5); P('bench', 41.5, 45, -90); P('stretcher', 38, 49, 15);
P('crate', 39.2, 47, 0); P('barrel_wood', 41.8, 30, 10);
P('rubble_pile', -29.5, 45.5, 120, { scale: 0.55 });
P('rubble_pile', -53.8, 69.0, -10, { scale: 0.5 });

const R = rng(19450507), clutter = [];
for (const [x, z] of [[-10.0, -15], [8.4, 45], [-8, 51], [9, 72], [-10, 106], [-32, 44], [-53, 68]]) {
  for (let i = 0; i < 8; i++) clutter.push({ m: i % 3 ? 'rubble_small' : 'rocks_small', x: x + R.range(-2.4, 2.4), z: z + R.range(-2.5, 2.5), yaw: R() * 360, scale: R.range(0.22, 0.40) });
}
// Courtyard trees do not form rural hedges or block the authored passages.
const scatter = [
  { m: 'oak_a', x: -53, z: 103.5, yaw: 35, scale: 0.66 },
  { m: 'birch_a', x: -53.5, z: 17, yaw: 110, scale: 0.7 },
  { m: 'birch_a', x: 38.5, z: 52.5, yaw: 20, scale: 0.65 },
];
const cover = [];
const E = (type, x, z, yaw, group, opts = {}) => ({ type, at: [x, z], yaw, group, ...opts });
const enemies = [
  // Forward street picket, with short, believable routes between cover.
  E('rifle', 7.0, 27.0, 185, 'street', { patrol: [[7, 27], [8, 38], [5, 39]], leash: 12 }),
  E('rifle', -7.0, 39, 165, 'street', { stance: 'crouch', leash: 14 }),
  E('smg', 9.2, 58, 190, 'street', { leash: 16 }),
  E('mg', 0, 0, 180, 'street', { nest: 'street-mg', arc: 0.78 }),
  E('rifle', -7.0, 70.0, 160, 'street', { stance: 'crouch', leash: 12 }),
  // East passage and first court are a slower, close-range alternative.
  E('smg', -31.0, 28.0, 90, 'courts', { patrol: [[-31, 28], [-45, 27], [-45, 43]], leash: 16 }),
  E('rifle', -51.2, 45.8, 160, 'courts', { stance: 'crouch', leash: 14 }),
  E('rifle', -38.0, 39.0, 205, 'courts', { leash: 14 }),
  // Only the five annex defenders must be cleared, so a bypassed street
  // patrol never turns the objective into a whole-map enemy hunt.
  E('smg', -42.0, 72.0, 180, 'relay', { leash: 13 }),
  E('rifle', -48.0, 81.9, 170, 'relay', { stance: 'crouch', leash: 12 }),
  E('rifle', -32.0, 86.0, 100, 'relay', { stance: 'crouch', leash: 12 }),
  E('smg', -39.0, 98.0, 160, 'relay', { patrol: [[-39, 98], [-31, 98], [-31, 85]], leash: 12 }),
  E('rifle', -51.0, 101.0, 180, 'relay', { leash: 12 }),
  // Command post is another small fight during the withdrawal.
  E('smg', 7.0, 98.5, 190, 'command', { leash: 12 }),
  E('rifle', -5.0, 106.0, 180, 'command', { stance: 'crouch', leash: 14 }),
  E('rifle', 9.0, 115.0, 190, 'command', { patrol: [[9, 115], [7, 123], [-2, 123]], leash: 16 }),
  // Reserve troops approach the annex from opposite ends once the radio
  // report begins. The southern men may be encountered on the courtyard
  // flank before the report; any survivors reinforce the annex.
  E('smg', -43.0, 15.0, 0, 'court-reserve', { leash: 12 }),
  E('rifle', -35.0, 15.0, 0, 'court-reserve', { leash: 12 }),
  E('rifle', -48.0, 19.0, 0, 'court-reserve', { leash: 12 }),
  E('rifle', -7.0, 129.0, 180, 'street-reserve', { leash: 14 }),
  E('smg', 3.0, 132.0, 180, 'street-reserve', { leash: 14 }),
  E('rifle', 8.5, 126.0, 180, 'street-reserve', { leash: 14 }),
];
const pickups = [
  { type: 'ammo', x: 7.3, z: -33.0 }, { type: 'medkit', x: 9.0, z: -31.0 }, { type: 'grenades', x: 5.5, z: -35.0 },
  { type: 'ammo', x: -53.0, z: 26.0 }, { type: 'medkit', x: -51.0, z: 33.0 },
  { type: 'grenades', x: 10.6, z: 53.0 }, { type: 'ammo', x: -46.5, z: 92.0 },
  { type: 'medkit', x: -50.0, z: 95.0 }, { type: 'grenades', x: -52.5, z: 92.0 },
  { type: 'ammo', x: -10.2, z: 91.0 }, { type: 'medkit', x: 34, z: 46 },
];
const checkpoints = [
  { x: 5, z: -43, spawn: [5, -43, 0] },
  { x: -2, z: -6, r: 9, spawn: [-2, -7, 0] },
  { x: -42, z: 67.5, r: 8, spawn: [-42, 67.5, 0] },
  { x: -44, z: 88, r: 9, spawn: [-44, 88, Math.PI / 2] },
];
const objectives = [
  { id: 'barricade', text: 'Get through the tram barricade', kind: 'reach', x: -2, z: -6, r: 8 },
  { id: 'relay', text: 'Clear the defenders from the radio annex', kind: 'clear', groups: ['relay'] },
  { id: 'transmit', text: 'Tune the relay and start the report', kind: 'interact', target: 'relay-radio', action: 'transmit', x: -48.5, z: 87.7, r: 2.2, time: 1.5, prompt: 'tune the relay', progressText: 'Tuning the relay' },
  { id: 'report', text: 'Hold the annex while the report is sent', kind: 'hold', x: -44, z: 88, r: 12, time: 45, counter: ['court-reserve', 'street-reserve'], warning: 'Troops are coming through the courts and down the tram street' },
  { id: 'command', text: 'Destroy the German command radio in the street', kind: 'destroy', target: 'command-radio', x: 4.2, z: 98.2 },
  { id: 'rally', text: 'Withdraw to the western courtyard', kind: 'reach', x: 35.5, z: 38, r: 5 },
];
const hints = [
  { x: 5, z: -39, r: 8, text: 'Prague, 7 May 1945', sub: 'You are a Czech resistance fighter carrying captured German arms' },
  { x: 0, z: 6, r: 12, text: 'The annex lies behind the eastern block', sub: 'Follow the tram street, or use the covered passage on the right beneath the PRŮCHOD sign' },
  { x: -30, z: 24, r: 7, text: 'The courtyards link behind the street', sub: 'The arch ahead leads to the radio annex; keep clear of its sight line' },
  { x: -43, z: 75, r: 9, text: 'Keep the captured relay working', sub: 'Clear its defenders, hold F at the relay to tune it, then defend the annex' },
  { x: 1, z: 93, r: 9, text: 'The German command set is on the pavement', sub: 'Press F beside it to set a charge; withdraw before it explodes' },
  { x: 12, z: 38, r: 7, text: 'The western passage leads to the rally yard', sub: 'The rally point is in the yard behind the western block' },
];

varyPragueFrontages(props);

export default {
  id: 'prague', title: 'Prague Rising', completeTitle: 'The relay holds. The report is through.',
  when: 'Prague, 7 May 1945 — 05:10, first light',
  briefing: [
    'Prague is in revolt. Barricades have gone up across the tram streets, and German troops are still fighting for the city. You are a Czech resistance fighter with captured German arms. A small radio annex in a Vinohrady courtyard has fallen silent; restore the link before the next attack.',
    'Get past the tram barricade and clear the annex. The main street leads to the upper passage, but a machine gun covers it. A covered passage on the right opens into linked courtyards and a second route behind the block. Once the annex is secure, hold F beside the relay to tune it and start the report. Then defend the courtyard until the transmission is through.',
    'A German command set is operating from the pavement beyond the upper barricade. Destroy it after the report, then turn back and withdraw through the western passage into the rally yard. This is a fictional action inspired by the Prague uprising, not a reconstruction of a documented operation.',
  ],
  daylight: true, weather: { rain: 0, wetness: 0.28 }, ambience: { rain: 0.0, wind: [0.6, 0.3], birds: false },
  loadout: ['kar98k', 'mp40'], playerGrenade: 'grenade_de', playerOutfit: 'axis', playerIdentity: 'czech-resistance',
  start: [5, -43, 0], menuView: { from: [5.5, 4.9, -13], to: [-1.0, 5.4, 75] },
  bounds: { minX: -90, maxX: 75, minZ: -82, maxZ: 172 },
  playBounds: { minX: -59, maxX: 44, minZ: -56, maxZ: 138 },
  fine: [[-25, 16, -13, 31], [-25, 87, -13, 101], [13, 31, 25, 45], [-49, 49, -35, 63]],
  water: null, baseHeight: pragueHeight, trackHeight: streetDatum, splat: pragueSplat,
  props, scatter, clutter, cover, enemies, pickups, checkpoints, objectives, hints,
  // The debug day/night alternate needs a dark atmosphere; the dawn
  // profile supplies its own morning fog rather than this night colour.
  fog: { color: '#9b9d9b', nightColor: '#383e45', density: 0.0040 },
  farFires: [[-105, 6, 126, 1.0], [96, 7, 94, 0.8]],
  far: {
    urban: true, radius: 380, treeRange: 0, treelines: false, height: streetDatum,
    buildings: [
      { m: 'prague_rose', x: -7, z: 202, yaw: 180 }, { m: 'prague_gray', x: 7, z: 202, yaw: 180 },
      { m: 'prague_ochre', x: -7, z: -106, yaw: 0 }, { m: 'prague_gray', x: 7, z: -106, yaw: 0 },
    ],
  },
  mist: () => 0.08,
  lines: {
    STREET: [[0, -56], [0, 138]],
    COURT_ROUTE: [[0, -6], [-8, 15], [-8, 24], [-27, 24], [-42, 24], [-42, 56], [-42, 70], [-38, 75], [-38, 84], [-44, 88]],
    STREET_ROUTE: [[0, -6], [8, 30], [8, 63], [0, 67], [-7, 76], [-7, 94], [-27, 94], [-42, 94], [-44, 88]],
    WITHDRAWAL: [[4.2, 98.2], [-3, 100], [-8, 93], [-6, 58], [8, 38], [19, 38], [35.5, 38]],
  },
  craters: [],
};
