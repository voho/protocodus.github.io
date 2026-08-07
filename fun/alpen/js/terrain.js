/* The mountain.

   There is no terrain data. `heightAt` is a pure function of a coordinate and
   everything else in the game reads the hill through it: the rider stands on
   it, ramps are built on top of it, trees are planted on it, and the mesh
   below is only ever a picture of it.

   Four things have changed about what that function says, and they are the
   whole of the mountain's character.

   The pitch is no longer constant. It is two long sines over a base, and the
   height is their analytic integral — which matters more than it sounds,
   because the alternative is marching down the hill from the summit every
   time anything asks how high the ground is, five times per physics step. So
   the run has chapters: pitches that stand up and ask for a real carve, and
   runouts that hand the speed back slowly.

   The route forks. Every few hundred metres the single centre line has a
   chance of splitting in two, drifting apart around an island and closing
   again below. The corridor is measured to whichever branch is nearer, so
   the geometry does the rest by itself: the piste widens, an island of hill
   rises out of the middle of it, two lines run either side, and they rejoin.

   The corridor is roughly three times wider than it was, and it breathes —
   gullies where it draws in, bowls where it opens out.

   And you cannot leave it. Outside the groomed part the ground rises into a
   quarterpipe with a real lip you can launch off, and past that into a wall
   that climbs towards a hundred and thirty metres and then keeps creeping up
   forever. Crossing it would take 75 m/s of kinetic energy and the game
   tops out at 50. There is no barrier and no invisible wall — the ground
   outside the run is simply, monotonically, uphill everywhere, so gravity is
   always pointing home. That is the whole containment mechanism.

   The mesh is a single graded grid, re-anchored to the rider in whole cells
   and refilled from `heightAt`. Snapping to whole cells is what keeps the
   facets welded to the ground instead of crawling across it; grading the
   cells is what lets six thousand vertices cover most of a kilometre. */

import { snoise2, noise2, hash2, getWorldSeed } from './noise.js';
import { TERRAIN, RENDER } from './config.js';
import { buildShadowRegion } from './shadow-cache.js';

/* THE SNOWPACK — what the ground is made of, as against how it is lit.

   The hill's shape was already a function of where you are on it and its
   surface was not. Every flat was the same snow and every steep face was the
   same rock, which is a mountain built out of one material and then bent, and
   the eye reads that immediately even when it cannot say why: two kilometres
   of descent went past and nothing about the ground had changed.

   So the cover is now a small budget that four things spend, and rock is
   simply what is left where the budget runs out.

   ALTITUDE is the strongest of them and it is the one a real mountain wears
   most plainly. The run loses about 0.28 metres of height per metre of z, so
   a kilometre of riding is nearly three hundred metres of descent, and three
   hundred metres is the difference between ground the wind has scoured to ice
   and ground that has held everything that fell on it since November. It is
   `ctx.base` — the grade's own integral, which is metres below the summit and
   already computed once a row — and so it costs a subtraction.

   It saturates, and that is not a fudge. The run is endless: taken literally,
   an absolute snow line is crossed once in the first four kilometres and then
   the mountain is one material for ever, which is the bug this is meant to
   fix. What actually happens on a mountain is that below the scour zone the
   pack stops deepening with height and starts varying with everything else,
   and below the snow line proper there is no snow at all — which this run
   cannot have, because it is a snowboard game. So the altitude term does its
   work over the first kilometre and a half of descent and then hands over.

   RELIEF is what it hands over to, and it is permanent because it is local:
   `h - ctx.base` is how far this vertex stands above the plane the grade says
   the run should be on. Inside the corridor that is the ridge and roll
   octaves, so the broad swells get their crests scoured and their hollows
   filled — wind scour and lee drift, from a subtraction that was already
   free. Outside it, it is the lip and then the containment wall, which climb
   sixty metres and more, and which therefore become the scoured rock ribs of
   a valley rather than two white banks standing beside the piste. The run
   reads as a trough on a mountain, which is what it is.

   ASPECT. A slope that faces the sun keeps less snow than one that does not,
   and this is measured against a fixed bearing rather than against the live
   sun. That was the second attempt. The first read `shading.uniforms.uSunDir`
   at fill time, which is wrong twice over: snow depth is a season and not a
   moment, so a slope does not grow rock at noon and lose it at four; and the
   vertex colours are only rebuilt when the mesh re-anchors, so a rider who
   stopped would have watched the mountain change material underneath them one
   LOD ring at a time. The bearing here is the mean of the azimuth swing in
   `weather.js` — where the sun spends its day — and it is a constant.

   BANDS. A slow noise along the run, sheared so that its edges run diagonally
   across the hill instead of squarely across it, saying that this stretch is
   a rock band and that one is a snowfield. The grade already gives the run
   chapters; this gives the same stretches a material.

   And the corridor is exempted from most of it, because a piste is groomed.
   Machines put that snow there and keep it there, which is exactly why a real
   high alpine piste is a white ribbon laid over bare rock — and it is also
   what keeps the run legible when the mountain around it has gone to stone.

   THE COLOUR. Three snow stops, and the axis between them is not brightness,
   it is what the snow has been through. Deep soft cover is the palest and the
   least saturated, because fresh snow is a heap of air; scoured névé is
   darker and frankly cyan, because ice is blue and the more of it light has
   to travel through the bluer it comes back. So the top of the mountain is
   blue, the bottom is bright, and neither of them is white — which is the
   rule, and it is now a rule with a mechanism behind it rather than a colour
   picked to obey it.

   All three came down about a tenth in luminance from what was here, for a
   reason that is downstream of this file: `GRADE.shoulder` compresses the top
   of the range, snow is the brightest thing in the frame, and blue was the
   brightest channel in the snow — so the shoulder was squeezing the blue back
   towards the other two and handing back a neutral. Measured at midday, the
   ground averaged 215,222,221 with eight per cent of it over luma 240, which
   is white with a rounding error. Lower albedo and more chroma at this end is
   what lets the grade downstream do its job instead of clipping. */
export const SNOWPACK = {
  /* Metres of descent from the top of the run over which the pack goes from
     high-alpine scour to full winter cover. */
  snowLine: [70, 1500],

  /* The chapters. `shear` is how far a band leans across the hill per metre
     down it: at zero the mountain is drawn in horizontal stripes, which is
     visible the moment you look sideways, and at much over one the bands stop
     reading as strata at all. Two octaves, so a band has an edge and a grain
     rather than being one smooth swell. */
  band: { freq: 0.0016, shear: 0.62, seed: 37 },

  /* Relief, in metres above the run's own plane, over which each of the three
     things it decides comes on. `crest` is the corridor's own swells, `scour`
     is the lip and the wall, `drift` is the hollows — and note that drift runs
     downwards, because a hollow is negative relief. */
  crest: [1.6, 7.0],
  scour: [3, 17],
  drift: [-6, -0.8],

  /* The bearing the sun spends its day around: `weather.js` swings its
     azimuth 1.15 ± 0.8 radians, so this is sin and −cos of the middle of that
     swing. Not normalised beyond what those two already are. */
  sunX: 0.913,
  sunZ: -0.409,

  /* What each of them is worth against a cover of one. They are summed and
     then clamped, so the extremes genuinely reach bare rock and full cover
     rather than crowding towards the middle the way a product would. */
  base: 0.26,
  altitude: 0.46,
  bandWeight: 0.22,
  crestWeight: 0.17,
  scourWeight: 0.44,
  driftWeight: 0.16,
  aspectWeight: 0.24,
  shadeWeight: 0.10,
  groomed: 0.22,

  /* Where snow lets go of a slope. `slip` is the steepness it starts and
     finishes letting go at with no cover at all, and `hold` is how much
     steeper it can be before letting go when the cover is full — so thin snow
     slides off ground that deep snow sits on quite happily, which is one term
     rather than two because it is one phenomenon. `thin` is the other way in:
     ground with nearly no cover shows stone however flat it is lying. */
  slip: [0.30, 0.86],
  hold: 0.46,
  thin: [0.30, 0.04],

  /* Cover over which the snow goes from névé to deep cover. */
  pack: [0.22, 0.90],

  /* THE PALETTE. Snow first, coldest last.

     `deep` is soft winter cover: the brightest thing on the mountain and the
     least saturated, because a metre of new snow is mostly air and scatters
     out of the first millimetre of it.

     `ice` is what the wind leaves: névé, wind slab, the blue-white glaze on a
     scoured shoulder. Cyan rather than blue — ice absorbs the red end first
     and the green last, so the green channel sits nearer the blue than the
     red, and that is the difference between glacier and a grey with a hint.

     `shade` is snow lying in the mountain's own shadow, which is a deeper and
     slightly more violet blue than the ice is, because what is lighting it is
     the sky and the sky at this altitude is close to navy.

     Then two stones, and the point of there being two is that a single grey
     makes every cliff on the mountain the same cliff. `slate` is a cold
     blue-grey, `iron` a russet one — barely saturated, but enough that a rock
     band made of one does not look like a rock band made of the other. Both
     stay under the snow in value by a long way, because rock against snow is
     the strongest contrast on the hill and it does not need help. Each is a
     pair: the cleft and the ridge it catches the light on. */
  deep: '#d6e2f0',
  ice: '#adc4d6',
  shade: '#a7bcd1',
  slate: ['#2c3646', '#7d8ba3'],
  iron: ['#443a41', '#948579'],
};

const { wander, route, corridor, wall, cliffs, knolls, zones, guide,
  ridges, rolls, moguls, chatter, warp, bulgeVary, character } = TERRAIN;
const GRADE = TERRAIN.grade;
const SHADE = TERRAIN.shade;

/* Which octave each column of a character profile belongs to. The profiles in
   the config are written as bare arrays because five aligned numbers under a
   header row is the only layout in which three of them can be *compared*,
   which is the whole point of there being three. */
const CH_RIDGES = 0;
const CH_ROLLS = 1;
const CH_MOGULS = 2;
const CH_CHATTER = 3;
const CH_KNOLLS = 4;

const TAU = Math.PI * 2;

/* The peak of s(u) = 2u·e^(−u²), which is the shape of the containment wall's
   own outward gradient — the profile is `height·(1 − e^(−u²))` and this is its
   derivative up to the constant. Dividing by the peak turns it into a plain
   0…1 answer to "how steep is the flank here", which is what the runnels ride
   so that their depth can never out-climb the mountain they are cut into. */
const WALL_STEEP_PEAK = Math.SQRT2 * Math.exp(-0.5);

const smoothstep = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const smooth01 = (u) => u * u * (3 - 2 * u);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/* Value noise along a line. The band field is its only caller and it wants a
   field that varies down one axis, so `noise2` would be paying for four hashed
   lattice corners to interpolate between two — and this runs twice per vertex
   over sixteen thousand vertices every time the mesh re-anchors, which is
   several times a second. Half the hashes is worth a function. */
function noise1(u, seed) {
  const i = Math.floor(u);
  const f = u - i;
  const a = hash2(i, 0, seed);
  const b = hash2(i + 1, 0, seed);
  return a + (b - a) * smooth01(f);
}

const CLIFF_SPAN = cliffs.fall + cliffs.runout;

/* Past this row offset from the anchor the haze has closed completely, in
   every weather the game has: `RENDER.fogFar` is 560 m on the clearest day and
   a storm only ever pulls the curtain closer. The fifty-metre margin covers
   the camera trailing the anchor point. Rows out there keep their exact
   heights and their central-difference normals — the silhouette against the
   sky is the one thing fog does not hide — but every material decision made
   below is invisible by construction, so those rows do not pay for one. */
const FOG_ROW_SKIP = RENDER.fogFar + 50;
const FOG_SKIP_SQ = FOG_ROW_SKIP * FOG_ROW_SKIP;

/* ==========================================================================
   The route
   ========================================================================== */

/* The mid-line: where the run would be if it never split. */
export function wanderAt(z) {
  let x = 0;
  for (let i = 0; i < wander.length; i++) x += Math.sin(z * wander[i].freq) * wander[i].amp;
  return x;
}

/* Half the separation between the two branches, and zero wherever the run is
   whole. A fork gets one window per `period` metres of hill, takes it about
   two thirds of the time, and opens and closes over the first and last third
   of the window it occupies — so from inside, a fork is a piste that widens,
   grows an island, and closes again. */
function forkSplit(z) {
  const b = Math.floor(-z / route.period);
  if (b < 0) return 0;
  if (hash2(b, 7717, 41) > route.chance) return 0;
  const top = -(b * route.period) - (route.period - route.span) * hash2(b, 991, 42);
  const t = (top - z) / route.span;
  if (t <= 0 || t >= 1) return 0;
  const edge = 0.32;
  const k = t < edge ? t / edge : t > 1 - edge ? (1 - t) / edge : 1;
  return route.split * smooth01(k);
}

/* The groomed half-width, which breathes on a long sine. */
export function corridorHalfAt(z) {
  return corridor.half + corridor.vary * Math.sin(z * corridor.freq);
}

/* The two shoulder bands past the groomed edge — ungroomed snow, then the
   rocky ground — as row facts. One definition, used by the height field,
   the colour pass, the surface materials, the props and the cable car, so
   none of them can disagree about where the powder ends and the talus
   starts. */
export function bandWidthsAt(z, out = [0, 0]) {
  out[0] = zones.powder[0] + (zones.powder[1] - zones.powder[0])
    * (0.5 + 0.5 * snoise2(z * zones.freq, 5.1, 173));
  out[1] = zones.rock[0] + (zones.rock[1] - zones.rock[0])
    * (0.5 + 0.5 * snoise2(z * zones.freq, -3.7, 179));
  return out;
}

/* Everything the cable car needs to hang itself over the rocky band: the
   groomed edge, and where the band it flies above begins and ends. */
export function rockBandAt(z, out = {}) {
  const w = bandWidthsAt(z, rockBandScratch);
  out.half = corridorHalfAt(z);
  out.powder = w[0];
  out.rock = w[1];
  return out;
}
const rockBandScratch = [0, 0];

/* ==========================================================================
   The guide — the racing line, and the groomed ribbon that follows it.

   Gates stand on a fixed rhythm down the mountain: one per `guide.every`
   metres, jittered inside its own slot, everything about it hashed off the
   slot index alone so a gate stands in the same place however the terrain
   around it is rebuilt, restarted or re-entered. The guide line is the
   smooth curve through those gates — flat through each gate, swinging
   between them — and the groomer drives exactly that line: glass corduroy
   `guide.tol` metres to either side, regular snow across the rest of the
   corridor. Height field, colour pass, surface materials and the props all
   read the same slots, so the ribbon the rider sees is the line the gates
   score.
   ========================================================================== */

function gateSlotZ(k) {
  // 0.25..0.75 into the slot: adjacent gates can never stand closer than
  // half a slot — a cadence, not a cluster.
  return -(k + 0.25 + 0.50 * hash2(k, 61, 47)) * guide.every;
}

/* The course's own centre: the piste centre, taking whichever branch the
   fork window's hash chose — one decision per window, so the line never
   hops branches mid-fork. Continuous by construction, because the split
   itself opens and closes smoothly and the side holds while it does. */
function courseCentreAt(z) {
  const s = forkSplit(z);
  if (s <= 0) return wanderAt(z);
  const b = Math.floor(-z / route.period);
  return wanderAt(z) + (hash2(b, 5501, 53) < 0.5 ? -s : s);
}

function gateSlotOff(k) {
  const z = gateSlotZ(k);
  // Capped so consecutive gates never ask for more than a carveable swing.
  const drift = Math.min(16, Math.max(0, corridorHalfAt(z) - guide.margin));
  return (hash2(k, 397, 11) * 2 - 1) * drift;
}

function gateSlotX(k) {
  return courseCentreAt(gateSlotZ(k)) + gateSlotOff(k);
}

/* The line itself, at any z. The course centre is evaluated *here*, not at
   the bracketing gates — so through bends and forks the line sweeps with
   the same geometry the corridor does, and only the gate-to-gate offset is
   eased between slots: flat through every gate, swinging between them.
   Slot zero is a virtual gate on the centre line, which keeps the line
   defined from the start hut to the first panel. */
export function guideAt(z) {
  let k = Math.max(0, Math.floor(-z / guide.every));
  let zA = k === 0 ? -0.25 * guide.every : gateSlotZ(k);
  if (z > zA) {
    if (k === 0) return courseCentreAt(z);
    k -= 1;
    zA = k === 0 ? -0.25 * guide.every : gateSlotZ(k);
  }
  const zB = gateSlotZ(k + 1);
  const t = smooth01(clamp01((zA - z) / (zA - zB)));
  const offA = k === 0 ? 0 : gateSlotOff(k);
  return courseCentreAt(z) + offA + (gateSlotOff(k + 1) - offA) * t;
}

/* Every gate slot inside [zLo, zHi), for whoever plants the poles. */
export function gateSlotsIn(zLo, zHi, out = []) {
  out.length = 0;
  const kLo = Math.max(1, Math.floor(-zHi / guide.every));
  const kHi = Math.max(1, Math.floor(-zLo / guide.every) + 1);
  for (let k = kLo; k <= kHi; k++) {
    const z = gateSlotZ(k);
    if (z < zLo || z >= zHi) continue;
    out.push({ k, z, x: gateSlotX(k) });
  }
  return out;
}

/* Where the middle of the piste is. When the run has forked there are two of
   them, and this is the line between — which is the island, not the piste.
   Anything placing itself on rideable ground wants `nearestCenter`. */
export function pisteCenter(z) {
  return wanderAt(z);
}

export function centersAt(z, out = []) {
  const mid = wanderAt(z);
  const s = forkSplit(z);
  out[0] = mid - s;
  out[1] = mid + s;
  return out;
}

/* Where the groomed mountain stops.

   The quarterpipe transition is part of the run — it is the thing a rider
   commits speed to and gets thrown off — so the boundary is not the corridor's
   edge but the top of the lip, past which the containment wall begins. The lip
   is modulated along the hill by the same section noise `heightIn` uses, so
   this has to read it rather than assume the nominal width; otherwise the
   mellow-bank stretches would be judged out of bounds while a rider was still
   on ground the mesh is drawing as a ramp. */
export function lipEdgeAt(z) {
  const vary = 1 + wall.lipVary * snoise2(z * wall.lipFreq, 0, 23);
  const w = bandWidthsAt(z, lipEdgeScratch);
  return corridorHalfAt(z) + w[0] + w[1] + wall.lipWidth * vary;
}
const lipEdgeScratch = [0, 0];

/* How far past that a point is, in metres. Negative anywhere on the run. */
export function beyondLipAt(x, z) {
  return Math.abs(x - nearestCenter(x, z)) - lipEdgeAt(z);
}

export function nearestCenter(x, z) {
  const mid = wanderAt(z);
  const s = forkSplit(z);
  if (s <= 0) return mid;
  return Math.abs(x - (mid - s)) < Math.abs(x - (mid + s)) ? mid - s : mid + s;
}

/* What the board is standing on, as the four weights the physics and the
   audio mix by. Read straight off the zone model — the same row facts the
   height field and the colour pass use — so the ground that looks like
   talus is the ground that grinds, and the corduroy that looks groomed is
   the corduroy that grips. The groomed fade matches `heightIn`'s bump
   mask exactly: where the surface starts visibly roughening is where the
   board starts feeling it. */
const surfScratch = [0, 0];
export function getTerrainMaterialAt(x, z) {
  const half = corridorHalfAt(z);
  const d = Math.abs(x - nearestCenter(x, z));
  const w = bandWidthsAt(z, surfScratch);

  /* Full machine hardpack on the ribbon; the regular corridor snow rides
     as a blend — a bit under half groomed response, the rest soft. */
  const corridorF = 1 - smoothstep(half - 4, half + 10, d);
  const ribbonF = 1 - smoothstep(guide.tol - 3, guide.tol + 6,
    Math.abs(x - guideAt(z)));
  const groomed = corridorF * (0.45 + 0.55 * ribbonF);
  const past = Math.max(0, d - half);
  const rock = smoothstep(w[0], w[0] + 12, past)
    * (1 - 0.7 * smoothstep(w[0] + w[1], w[0] + w[1] + 90, past));
  // Scoured névé where the wall starts shedding its cover.
  const ice = smoothstep(w[0] + w[1], w[0] + w[1] + 50, past) * 0.6;
  const powder = Math.max(0, (1 - groomed) * (1 - rock) * (1 - ice));

  return { rock, groomed, ice, powder };
}

/* The coordinate frame a grooming machine would actually have driven.

   Before a fork has opened far enough to expose an island, it reads as one
   temporarily wide piste and keeps one origin. Once the middle is already
   outside the groomed mask, each side spends only the *new* separation beyond
   that threshold. A texture phase does not need the branch's accumulated
   lateral offset; it needs its derivative. Starting the excess at zero hides
   the left/right seam in ungroomed snow without swinging the origin by the
   branch's full 30–70 metres over a two-metre gate. */
function groomFrameOriginAt(z, side) {
  const mid = wanderAt(z);
  const split = forkSplit(z);
  if (split <= 0) return mid;
  const half = corridorHalfAt(z);
  const excess = Math.max(0, split - (half + 3.2));
  const branchPhase = excess * smoothstep(0, 2, excess);
  return mid + side * branchPhase;
}

/* ==========================================================================
   The height, as a row and a point on it

   Almost everything structural depends only on z: the grade's integral, the
   route, the corridor's width, the wall and which drops reach it. The mesh
   fills a row at a time, so all of that is computed once per row; only the
   genuinely 2D noise fields run per vertex. It is still much cheaper than
   asking `heightAt` for every one, and because `heightAt` itself uses these
   same two functions there is one definition of the mountain and no chance
   of the mesh and physics disagreeing about where the ground is.
   ========================================================================== */

function makeContext() {
  return {
    z: NaN,
    base: 0,
    mid: 0,
    split: 0,
    half: 0,
    powderW: 30,   // ungroomed snow band width — see TERRAIN.zones
    rockW: 50,     // rocky band width
    bandW: 80,     // the two together: where the wall's lip finally begins
    guideX: 0,     // where the racing line — and its corduroy — runs
    lipW: 1,
    lipH: 0,
    wallBroadLeft: 0.5,
    wallBroadRight: 0.5,
    wallDetailLeft: 0.5,
    wallDetailRight: 0.5,
    nCliffs: 0,
    cliffX: [0, 0],
    cliffA: [0, 0],
    nKnolls: 0,
    kx: [0, 0, 0, 0],
    krx: [0, 0, 0, 0],
    kdz: [0, 0, 0, 0],   // the along-axis distance, already leaned and scaled
    kh: [0, 0, 0, 0],
    // What this stretch of mountain is made of: one multiplier per octave,
    // mixed from the three characters. See `TERRAIN.character`.
    mix: [1, 1, 1, 1, 1],
    plain: 0,            // …and the mixture itself, for anything that wants
    bumps: 0,            // to know what kind of ground this is rather than
    swells: 0,           // merely how rough it is
  };
}

/* The mixture at a point down the run.

   `busy` is how much is going on and `fine` is how short its wavelength is,
   and the three characters fall out of the two of them: calm ground is a
   plain whichever way `fine` leans, busy ground is bumps or swells depending
   on which way it leans. The weights sum to one by construction, which is what
   keeps the slope budget linear — see the note in the config. */
function characterAt(z, ctx) {
  const band = character.band;
  const busy = smoothstep(band[0], band[1], noise1(z * character.busyFreq, character.seed));
  const fine = smoothstep(band[0], band[1], noise1(z * character.fineFreq, character.seed + 5));

  const plain = 1 - busy;
  const bumps = busy * fine;
  const swells = busy - bumps;
  ctx.plain = plain;
  ctx.bumps = bumps;
  ctx.swells = swells;

  const P = character.plain;
  const B = character.bumps;
  const S = character.swells;
  for (let i = 0; i < 5; i++) {
    ctx.mix[i] = P[i] * plain + B[i] * bumps + S[i] * swells;
  }
}

const ctxBandScratch = [0, 0];

function rowContext(z, ctx) {
  if (ctx.z === z) return ctx;
  ctx.z = z;
  characterAt(z, ctx);

  // The grade, integrated. d/dz of this is base + Σ amp·sin(freq·z + phase),
  // which is the pitch the rider actually feels underneath them.
  let base = GRADE.base * z;
  for (let i = 0; i < GRADE.waves.length; i++) {
    const w = GRADE.waves[i];
    base -= (w.amp / w.freq) * (Math.cos(w.freq * z + w.phase) - Math.cos(w.phase));
  }
  ctx.base = base;

  ctx.mid = wanderAt(z);
  ctx.split = forkSplit(z);
  ctx.half = corridorHalfAt(z);
  const zw = bandWidthsAt(z, ctxBandScratch);
  ctx.powderW = zw[0];
  ctx.rockW = zw[1];
  ctx.bandW = zw[0] + zw[1];
  ctx.guideX = guideAt(z);
  /* Which of the two branches is the high one, and by how much. Hashed off
     the fork's own block so a given crossroads always leans the same way,
     and faded in with the split so the offset arrives as the branches part
     and is gone again by the time they rejoin — otherwise the run would step
     vertically at the moment the fork opened. */
  ctx.tilt = 0;
  if (ctx.split > 0) {
    const b = Math.floor(-z / route.period);
    const side = hash2(b, 2287, 43) < 0.5 ? -1 : 1;
    ctx.tilt = side * route.drop * (ctx.split / route.split);
  }
  // Some stretches get a wall worth aiming at and some get a mellow bank
  const v = 1 + wall.lipVary * snoise2(z * wall.lipFreq, 0, 23);
  ctx.lipW = wall.lipWidth * v;
  ctx.lipH = wall.lipHeight * v;
  /* The flank fields are row facts. Precomputing both sides here avoids four
     identical noise samples for every lateral vertex in a generated row —
     and `heightAt`, which asks for only one point, still takes the exact same
     route through the same context. */
  const S = wall.structure;
  ctx.wallBroadLeft = 0.5
    + 0.5 * snoise2(z * S.broadFreq, -7.3, S.broadSeed);
  ctx.wallBroadRight = 0.5
    + 0.5 * snoise2(z * S.broadFreq, 7.3, S.broadSeed);
  ctx.wallDetailLeft = 0.5
    + 0.5 * snoise2(z * S.detailFreq, -11.9, S.detailSeed);
  ctx.wallDetailRight = 0.5
    + 0.5 * snoise2(z * S.detailFreq, 11.9, S.detailSeed);

  /* Any drop whose face or runout reaches this far down the hill. A drop
     spans about seventy metres against a period of two hundred and sixty, so
     only this block and the one above it can ever be in range. */
  ctx.nCliffs = 0;
  const b0 = Math.floor(-z / cliffs.period);
  for (let k = 0; k <= 1; k++) {
    const b = b0 - k;
    if (b < 1) continue;   // the first stretch of the run is left alone
    if (hash2(b, 5501, 61) > cliffs.chance) continue;
    // Placed anywhere in its block that leaves room for the whole feature —
    // the face and its runout — to finish before the next block starts
    const lip = -(b * cliffs.period) - (cliffs.period - CLIFF_SPAN) * hash2(b, 173, 62);
    const t = lip - z;
    if (t <= 0 || t >= CLIFF_SPAN) continue;

    const drop = cliffs.drop[0] + (cliffs.drop[1] - cliffs.drop[0]) * hash2(b, 907, 63);
    const amount = drop
      * smoothstep(0, cliffs.fall, t)
      * (1 - smoothstep(cliffs.fall, CLIFF_SPAN, t));
    if (amount < 0.01) continue;

    // Placed against a branch of the route at the lip, never against x = 0 —
    // the route wanders thirty metres and a drop pinned to the world would
    // spend most of its life in the trees
    const lipMid = wanderAt(lip);
    const lipSplit = forkSplit(lip);
    const side = hash2(b, 311, 64) < 0.5 ? -1 : 1;
    const branch = lipSplit > 0 ? lipMid + side * lipSplit : lipMid;
    const spread = (hash2(b, 613, 65) * 2 - 1) * corridorHalfAt(lip) * 0.55;

    ctx.cliffX[ctx.nCliffs] = branch + spread;
    ctx.cliffA[ctx.nCliffs] = amount;
    ctx.nCliffs += 1;
  }

  /* Knolls in range. Their blocks are short and their radii can be three
     times the block length, so several overlap at any point — which is the
     intention: two knolls that run into each other make a shape neither of
     them had on its own, and the hill stops looking like it was stamped. */
  ctx.nKnolls = 0;
  const knollMix = ctx.mix[CH_KNOLLS];
  const k0 = Math.floor(-z / knolls.period);
  // A plain is a plain. Below a fifth of a knoll there is nothing there worth
  // four samples of arithmetic per vertex to add up to almost zero.
  for (let k = -3; k <= 3 && ctx.nKnolls < 4 && knollMix > 0.05; k++) {
    const b = k0 + k;
    if (b < 2) continue;
    if (hash2(b, 4021, 81) > knolls.chance) continue;

    const cz = -(b * knolls.period) - knolls.period * hash2(b, 77, 82);
    const rz = knolls.radius[0] + (knolls.radius[1] - knolls.radius[0]) * hash2(b, 149, 83);
    const lee = knolls.lee[0] + (knolls.lee[1] - knolls.lee[0]) * hash2(b, 233, 84);

    // Downhill of the crest is z < cz, and that half is squashed so it falls
    // away far faster than it rose — which is what turns a bump into a lip
    let dz = (z - cz) / rz;
    if (dz < 0) dz /= lee;
    if (dz <= -1 || dz >= 1) continue;

    // Height comes out of the radius, never on its own — see the note on
    // `rise` in the config. A knoll's job is curvature, not altitude.
    /* …and scaled by what this stretch of mountain is made of. A knoll is the
       mountain's own kicker, so a bumps chapter keeps all of it, a swells
       chapter keeps most, and a plain keeps a fifth — which is what makes a
       plain read as somewhere you can finally put the board flat and go.

       Scaled rather than skipped, because a knoll that blinks out of existence
       at a chapter boundary is a step in the height field, and the rider's
       normals are central differences of that. */
    const rise = knolls.rise[0] + (knolls.rise[1] - knolls.rise[0]) * hash2(b, 331, 85);
    const height = rise * rz * knollMix;
    const rx = rz * (1 + (hash2(b, 419, 86) * 2 - 1) * knolls.eccentric);
    const half = corridorHalfAt(cz);
    const mid = wanderAt(cz);
    const sp = forkSplit(cz);
    const branch = sp > 0 ? mid + (hash2(b, 503, 87) < 0.5 ? -sp : sp) : mid;

    ctx.kx[ctx.nKnolls] = branch + (hash2(b, 601, 88) * 2 - 1) * half * knolls.spread;
    ctx.krx[ctx.nKnolls] = rx;
    ctx.kdz[ctx.nKnolls] = dz;
    ctx.kh[ctx.nKnolls] = height;
    ctx.nKnolls += 1;
  }
  return ctx;
}

function heightIn(ctx, x, coarseDetail = 1, fineDetail = coarseDetail,
  mogulDetail = 1, flankDetail = 1, bulkDetail = 1) {
  const z = ctx.z;
  let h = ctx.base;

  /* Two of the four octaves are sampled at coordinates that a long slow
     noise has pushed around. That warp is the whole difference between a
     mogul field and a grid of identical pimples: a bulge is stretched here
     and pinched there, and no two stretches of hill have the same lumps. */
  const wx = x + snoise2(x * warp.freq, z * warp.freq, warp.seed) * warp.amp;
  const wz = z + snoise2(x * warp.freq, z * warp.freq, warp.seed + 1) * warp.amp;

  /* Every octave has its own orientation. Sampling all of them on the same
     world axes leaves long procedural seams where unrelated features line up;
     rotations keep the frequency and slope budget unchanged while making the
     result read as geology rather than a height-map grid. */
  const ridgeX = x * 0.966 - z * 0.259;
  const ridgeZ = x * 0.259 + z * 0.966;
  const rollX = wx * 0.819 + wz * 0.574;
  const rollZ = -wx * 0.574 + wz * 0.819;
  const mogulX = wx * 0.643 - wz * 0.766;
  const mogulZ = wx * 0.766 + wz * 0.643;

  /* Rough and quiet snow now forms broad patches instead of full-width bands
     across the piste. Rolls and moguls use independent masks so a calm roller
     does not automatically erase every smaller feature around it. */
  const rollVary = bulgeVary.floor + (1 - bulgeVary.floor) * noise2(
    (x * 0.731 - z * 0.682) * bulgeVary.freq,
    (x * 0.682 + z * 0.731) * bulgeVary.freq,
    bulgeVary.seed,
  );

  /* Each octave, weighted by what this chapter of the run is made of. The
     mixture is a row property — it varies down the hill and not across it —
     so it has already been worked out once for the whole row and this is four
     multiplications, not four noise lookups. `bulgeVary` still rides on top of
     the two middle ones: the chapter says what kind of ground this stretch is,
     and the vary says which patches of it got the worst of it. */
  const mix = ctx.mix;

  /* Where the nearest rideable centre line is. Computed here rather than at
     the wall below because the groomed mask needs it first — and it must be
     the branch distance, not the raw mid: when the run forks the pistes ride
     at mid ± split, and a mask measured from the empty middle would groom
     the island and leave both actual routes rough. */
  let d;
  let branchCentre;
  if (ctx.split > 0) {
    const d0 = Math.abs(x - (ctx.mid - ctx.split));
    const d1 = Math.abs(x - (ctx.mid + ctx.split));
    if (d0 < d1) {
      d = d0;
      branchCentre = ctx.mid - ctx.split;
    } else {
      d = d1;
      branchCentre = ctx.mid + ctx.split;
    }
  } else {
    d = Math.abs(x - ctx.mid);
    branchCentre = ctx.mid;
  }

  /* Three surfaces, two masks. The groomer drives the guide line, so glass
     corduroy exists only within `guide.tol` of it; the rest of the corridor
     is regular skied-in snow — the same octaves at `guide.rough` strength —
     and past the corridor's edge the full spectrum fades in over the first
     metres of the powder band, the way a real piste edge roughens rather
     than snapping to moguls on a painted line. */
  const ribbonF = 1.0 - smoothstep(guide.tol - 3.0, guide.tol + 6.0,
    Math.abs(x - ctx.guideX));
  const corridorF = 1.0 - smoothstep(ctx.half - 4.0, ctx.half + 10.0, d);
  const offPisteFactor = (1.0 - corridorF)
    + corridorF * (1.0 - ribbonF) * guide.rough;

  h += snoise2(ridgeX * ridges.freq, ridgeZ * ridges.freq, ridges.seed)
    * ridges.amp * mix[CH_RIDGES] * offPisteFactor;
  h += snoise2(rollX * rolls.freq, rollZ * rolls.freq, rolls.seed)
    * rolls.amp * rollVary * mix[CH_ROLLS] * offPisteFactor;

  /* Moguls and micro-chatter are filtered OFF the groomed piste to keep the groomed
     track 100% smooth, reserved exclusively for off-piste snow. */
  if (mogulDetail > 0.001) {
    const mogulVary = bulgeVary.floor + (1 - bulgeVary.floor) * noise2(
      (x * 0.526 + z * 0.851) * bulgeVary.freq,
      (-x * 0.851 + z * 0.526) * bulgeVary.freq,
      bulgeVary.seed + 17,
    );
    h += snoise2(mogulX * moguls.freq, mogulZ * moguls.freq, moguls.seed)
      * moguls.amp * mogulVary * mix[CH_MOGULS] * mogulDetail * offPisteFactor;
  }

  if (coarseDetail > 0.001 || fineDetail > 0.001) {
    const windPatch = 0.55 + 0.45 * noise2(
      (x * 0.411 + z * 0.912) * chatter.patchFreq,
      (-x * 0.912 + z * 0.411) * chatter.patchFreq,
      chatter.coarse.seed + 13,
    );
    const wc = chatter.coarse;
    const wf = chatter.fine;
    const rotatedAcross = x * 0.985 - z * 0.174;
    const rotatedAlong = x * 0.174 + z * 0.985;
    const chatterMix = 0.82 + 0.18 * mix[CH_CHATTER];
    const coarseN = snoise2(
      rotatedAcross * wc.acrossFreq, rotatedAlong * wc.alongFreq, wc.seed,
    );
    h += (coarseN * wc.amp + coarseN * Math.abs(coarseN) * wc.bulge)
      * windPatch * chatterMix * coarseDetail * offPisteFactor;
    if (fineDetail > 0.001) {
      h += snoise2(rotatedAcross * wf.acrossFreq, rotatedAlong * wf.alongFreq, wf.seed)
        * wf.amp * windPatch * chatterMix * fineDetail * offPisteFactor;
    }
  }

  /* Outside the corridor: the quarterpipe, then the wall.

     The lip is a smoothstep, so it leaves the piste concave — a transition
     you can ride up — and arrives at the top with zero gradient, which is a
     genuine convex rollover and the reason a rider who commits speed to it
     gets thrown rather than handed their speed back. Past it the wall takes
     over from zero gradient too, so the two meet without a crease. */
  if (ctx.split > 0 && ctx.tilt !== 0) {
    /* The two ways sit at different heights, blended by inverse-square
       proximity rather than switched at the midpoint. Switching would put a
       vertical step down the middle of the island; weighting means each
       branch reaches its own elevation, the island between settles at the
       mean, and the surface is smooth everywhere — which it has to be,
       because the rider's normals are central differences of this and a step
       would fling them sideways for a frame. */
    const d0 = Math.abs(x - (ctx.mid - ctx.split));
    const d1 = Math.abs(x - (ctx.mid + ctx.split));
    const w0 = 1 / (d0 * d0 + 25);
    const w1 = 1 / (d1 * d1 + 25);
    h += ctx.tilt * (w1 - w0) / (w0 + w1);
  }
  const past = d - ctx.half;
  // Inside the groomed part, a shallow dish that gathers a drifting rider
  // back towards the fall line. It never pushes — at the corridor's edge it
  // is a slope of about a fifteenth — and being entirely lateral it costs
  // nothing against the budget the octaves are fighting over.
  if (past <= 0) {
    const u = d / Math.max(1, ctx.half);
    /* A PARABOLA, AND IT WAS WORTH FINDING OUT WHY.

       The obvious complaint about u² is that its gradient vanishes in the
       middle of the corridor, which is exactly where the rider is supposed to
       be held — so a hands-off rider feels nothing until they are most of the
       way to the edge. u^1.4 fixes that on paper and was measured: it changed
       the share of a hands-off run spent past the lip from 26-34% to 27-34%,
       which is nothing.

       The reason is that the drift is not a settling error, it is an
       OSCILLATION. There is almost no lateral damping on a board running
       straight, so a restoring gradient does not pull a rider to the middle
       and hold them there — it swings them through it. Raising the gradient
       raises the frequency and leaves the amplitude where it was, and the
       amplitude is what `beyondLip` measures. The only thing that moves it is
       taking away the forcing, which is the octaves' own lateral pull: see
       `wander` in config, where it has been. So this stays a parabola, and it
       stays a parabola specifically because the cheaper shape is the one that
       works — `heightAt` is called about twenty-five times a physics step at
       120 Hz and a `Math.pow` in it is not free. */
    h += corridor.bowl * u * u;
    /* And within the dish, a shallower one centred on the ribbon itself.
       The groomed line is the guide, so the ground agrees: half a metre of
       gather, pulling a drifting rider back to the corduroy by gravity
       rather than by a wall. It only has to stop arguing with the profile
       outside right at the join — fading it over the outer third of the
       corridor too, the first attempt, switched it off exactly where a
       drifting rider needs it most and measured as part of the runaway
       above `corridor.bowl` was fixed for. */
    const gd = Math.min(1, Math.abs(x - ctx.guideX) / 22);
    h += guide.gather * gd * gd
      * (1 - smoothstep(ctx.half - 2, ctx.half, d));
  } else {
    h += corridor.bowl;

    /* The shoulder: ungroomed snow first, then the rocky band, together
       `ctx.bandW` metres of ground a rider can actually use before the wall
       stands up. A gentle smooth01 rise across the whole of it — flat at
       both joins — keeps gravity pointing home without fencing the powder. */
    h += zones.rise * smooth01(Math.min(1, past / ctx.bandW));

    /* The boulder field. Two octaves that exist only where the rock zone
       does: swells the size of a van and lumps the size of a board. They
       fade in past the powder, and fade most of the way back out as the
       wall climbs — the wall has its own geology, and bounded noise on a
       62-metre exponential would be invisible anyway. */
    const rockZone = smoothstep(ctx.powderW, ctx.powderW + 12, past)
      * (1 - 0.7 * smooth01(Math.min(1, Math.max(0, past - ctx.bandW) / 90)));
    if (rockZone > 0.001 && coarseDetail > 0.001) {
      let bump = snoise2(x * 0.083, z * 0.083, 57) * zones.rockBump[0] * coarseDetail;
      if (fineDetail > 0.001) {
        bump += snoise2(x * 0.21, z * 0.21, 91) * zones.rockBump[1] * fineDetail;
      }
      h += bump * rockZone;
    }
  }
  const over = past - ctx.bandW;
  if (over > 0) {
    /* The launchable bank remains a smooth quarterpipe across its width, but
       its shoulder now follows the same slow left/right geology as the wall
       behind it. That creates broad folds down the valley without putting a
       metre-scale bump under a board or mirroring both mountain sides. */
    const bankDetail = x < branchCentre
      ? ctx.wallDetailLeft : ctx.wallDetailRight;
    const bankHeight = ctx.lipH * (0.82 + 0.30 * bankDetail);
    h += bankHeight * smooth01(Math.min(1, over / ctx.lipW));
    const w = over - ctx.lipW;
    if (w > 0) {
      /* The walls are mountain flanks now, not one extrusion copied to both
         sides. Two low-frequency, side-specific fields are sampled only once
         the rideable lip is behind us. The first varies the breadth of the
         whole flank; the other raises two long geological shoulders. Every
         added term is monotonic across the wall, and each joins with a flat
         derivative, so the original containment guarantee and the smooth
         collision normal both survive. Because this is real height rather
         than shader displacement, trees, tracks and the precomputed horizon
         cache agree with the structure automatically. */
      const S = wall.structure;
      const left = x < branchCentre;
      const broad = left ? ctx.wallBroadLeft : ctx.wallBroadRight;
      const detail = left ? ctx.wallDetailLeft : ctx.wallDetailRight;
      const localScale = wall.scale * (1 - S.scaleVary + 2 * S.scaleVary * broad);
      const u = w / localScale;
      /* Ease the permanent creep in with zero value and zero derivative. The
         lip and exponential wall both arrive flat, so introducing a 17-degree
         crease precisely at their join defeated the otherwise smooth profile. */
      const creepShape = w - wall.creepEase * (1 - Math.exp(-w / wall.creepEase));
      const eu = Math.exp(-u * u);
      h += wall.height * (1 - eu) + wall.creep * creepShape;

      /* THE FLUTING, and it is the only term on this whole profile that
         varies across the flank rather than along it.

         Everything else out here — the breadth, the two shoulders, the
         buttress — is a function of z, which is exactly why the walls still
         read as two poured ramps from a rider looking down the hill: a term
         that only changes over hundreds of metres of descent does not change
         at all in the frame. What covers a real flank above a piste runs the
         other way, straight down the fall line, cut by every sluff and point
         release that has come off it since November.

         `steep` is the flank's own outward gradient normalised to its peak,
         so the channels are exactly as deep as the wall is steep: nothing at
         the lip, nothing out on the plateau, deepest across the face in
         between. That is both what a slide actually does and what keeps the
         containment guarantee intact — the ratio between a channel's steepest
         wall and the mountain's is a constant chosen in the config rather
         than an amplitude that has to be re-checked whenever the flank lies
         back. `wall.scale / localScale` holds the same ratio against the
         breadth variation: a broader flank is a shallower one, and its
         channels shallow with it.

         The phase wanders on one slow noise per side, so the channels lean
         and braid down the hill instead of standing as a comb, and the two
         sides of the valley never mirror each other. */
      if (flankDetail > 0.001) {
        const steep = (2 * u * eu) / WALL_STEEP_PEAK;
        if (steep > 0.004) {
          const R = wall.runnels;
          const drift = R.meander * snoise2(
            z * R.meanderFreq, left ? -5.7 : 5.7, R.seed,
          );
          /* SQUARED, and that is the whole of the containment argument near
             the lip rather than a shaping choice.

             The ratio below bounds the *carrier's* slope against the wall's,
             and it is a complete argument only for a term whose amplitude is
             constant. It is not: the amplitude has to arrive from zero
             somewhere, and an arrival ramp contributes its own slope of about
             depth over its length — a constant — while the wall's own
             gradient near the lip is going to zero linearly. So there is
             always a band just past the lip where a linear arrival out-climbs
             the mountain, and it was measurable: an ordinary stretch of flank
             seven metres out went from +0.11 to −0.02, which is a pocket in
             ground that is supposed to be monotonically uphill everywhere.

             `steep` is already linear in w near the lip, so squaring it makes
             the amplitude quadratic and its derivative linear — the same
             order as the wall's, with a constant ratio between them, which is
             the property the rest of this block is built on. It costs nothing
             anybody will miss: the channels simply concentrate on the steepest
             third of the face, which is where a slide actually cuts them. */
          const amp = flankDetail * steep * steep * (wall.scale / localScale);
          const lambda = R.wave * (1 - R.waveVary + 2 * R.waveVary * broad);
          // Squared, so the channel floors are narrow and the ribs between
          // them broad — which is the section a slide leaves, and not the
          // symmetrical corrugation a bare cosine draws.
          const t = 0.5 - 0.5 * Math.cos((w + drift) * (TAU / lambda));
          h -= R.depth * amp * t * t;
          h -= R.fineDepth * amp
            * (0.5 - 0.5 * Math.cos((w + drift * 0.4) * (TAU / R.fineWave)));
        }
      }

      /* THE BULK — gullies and buttresses at the scale of the face itself,
         plus a broken surface over them, both proportional to how steep the
         flank is here. The reasoning is in `wall.bulk`; what matters at the
         call site is that it shares the runnels' `steep²` amplitude for the
         same containment reason, and that both terms are pure cuts: the
         noise is mapped into 0…1 and subtracted, so nothing here can build a
         bump with a downhill face on it.

         It has its own detail mask because it survives a far coarser mesh
         than the fluting does — which is the point of it. The far wall is
         several hundred metres of screen and the fluting has faded out of it
         long before the eye stops asking what shape the mountain is. */
      if (bulkDetail > 0.001) {
        const steepB = (2 * u * eu) / WALL_STEEP_PEAK;
        if (steepB > 0.004) {
          const B = wall.bulk;
          const ampB = bulkDetail * steepB * steepB * (wall.scale / localScale);
          h -= B.depth * ampB * (0.5 - 0.5 * snoise2(
            w / B.wave, z / B.waveZ, left ? B.seed : B.seed + 41,
          ));
          h -= B.grain * ampB * (0.5 - 0.5 * snoise2(
            w / B.grainWave, z / B.grainWave, left ? B.seed + 7 : B.seed + 53,
          ));
        }
      }

      const lowerStart = S.lowerStart[0]
        + (S.lowerStart[1] - S.lowerStart[0]) * broad;
      const lowerHeight = S.lowerHeight[0]
        + (S.lowerHeight[1] - S.lowerHeight[0]) * detail;
      const upperStart = S.upperStart[0]
        + (S.upperStart[1] - S.upperStart[0]) * detail;
      const upperHeight = S.upperHeight[0]
        + (S.upperHeight[1] - S.upperHeight[0]) * broad;
      h += lowerHeight * smoothstep(lowerStart, lowerStart + S.lowerWidth, w);
      h += upperHeight * smoothstep(upperStart, upperStart + S.upperWidth, w);
      /* Sharpen the high half of the already precomputed detail field into a
         buttress. The ramp is monotonic across the flank, preserving the
         containment guarantee, while variation down the run gives the side
         mountain real ridges and gullies instead of one triangular plane. */
      const rib = smoothstep(0.38, 0.78, detail);
      const ribStart = S.ribStart[0]
        + (S.ribStart[1] - S.ribStart[0]) * (1 - broad);
      h += S.ribHeight * rib
        * smoothstep(ribStart, ribStart + S.ribWidth, w);
    }
  }

  /* Knolls and cliffs live outside the corridor entirely — a rideable run
     with a hidden three-metre ledge on it is an ambush, not terrain. They
     fade in with the powder band and are at full strength by the talus. */
  const beyondF = 1 - corridorF;
  if (beyondF > 0.001) {
    for (let i = 0; i < ctx.nKnolls; i++) {
      const dx = (x - ctx.kx[i]) / ctx.krx[i];
      if (dx <= -1 || dx >= 1) continue;
      const dz = ctx.kdz[i];
      const r2 = dx * dx + dz * dz;
      if (r2 >= 1) continue;
      const f = 1 - r2;
      h += ctx.kh[i] * f * f * beyondF;
    }

    for (let i = 0; i < ctx.nCliffs; i++) {
      const ax = Math.abs(x - ctx.cliffX[i]);
      if (ax >= cliffs.halfWidth + cliffs.shoulder) continue;
      h -= ctx.cliffA[i]
        * (1 - smoothstep(cliffs.halfWidth, cliffs.halfWidth + cliffs.shoulder, ax))
        * beyondF;
    }
  }

  return h;
}

/* The pure form, for everyone who is asking about one point rather than a
   row of them. It is the row path with a row of one. */
const scratch = makeContext();

export function heightAt(x, z) {
  return heightIn(rowContext(z, scratch), x);
}

/* Surface normal by central difference. `fn` is passed in so the rider can
   ask about the hill *plus* whatever kickers are sitting on it, while the
   mesh asks about the bare hill. */
const EPS = 0.35;

export function normalFrom(fn, x, z, out) {
  const dx = (fn(x + EPS, z) - fn(x - EPS, z)) / (2 * EPS);
  const dz = (fn(x, z + EPS) - fn(x, z - EPS)) / (2 * EPS);
  return out.set(-dx, 1, -dz).normalize();
}

/* The pitch of the bare hill down the fall line, which is what the rider's
   climb scrub and the attract-mode steering both want to know. */
export function gradeAt(z) {
  let g = GRADE.base;
  for (let i = 0; i < GRADE.waves.length; i++) {
    const w = GRADE.waves[i];
    g += w.amp * Math.sin(w.freq * z + w.phase);
  }
  return g;
}

/* ==========================================================================
   The grid
   ========================================================================== */

/* Offsets that start at `step` and grow by `growth` each one, until they
   have covered `reach`. Returns the list of positions, not the steps. */
function graded(step, growth, reach, uniformReach = 0) {
  const out = [0];
  let d = 0;
  let s = step;
  while (d < reach) {
    d += s;
    out.push(d);
    if (d >= uniformReach) s *= growth;
  }
  return out;
}

export function createTerrain(THREE, shading, maxAnisotropy = 1) {
  const {
    spacing, uniformNear, behind, behindGrowth, ahead, aheadGrowth,
    side, sideGrowth, morphNear, morphFar, morphRate, morphSettle,
  } = TERRAIN;

  /* Columns mirrored about the rider, rows graded in both directions from
     them. All four fans share the same uniform near field, which is what lets
     the anchor snap: inside `uniformNear` every offset is a whole number of
     cells, so those vertices land on the same world lattice every time the
     mesh re-anchors and the facets under the board stay welded to the hill.
     Only past it do the rings widen, and only there does anything morph. */
  const half = graded(spacing, sideGrowth, side, uniformNear);
  const xs = [];
  for (let i = half.length - 1; i >= 1; i--) xs.push(-half[i]);
  for (let i = 0; i < half.length; i++) xs.push(half[i]);

  const zs = [];
  const bwd = graded(spacing, behindGrowth, behind, uniformNear);
  for (let i = bwd.length - 1; i >= 1; i--) zs.push(bwd[i]);
  const fwd = graded(spacing, aheadGrowth, ahead, uniformNear);
  for (let i = 0; i < fwd.length; i++) zs.push(-fwd[i]);

  const vertsX = xs.length;
  const vertsZ = zs.length;
  const cols = vertsX - 1;
  const rows = vertsZ - 1;
  const count = vertsX * vertsZ;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  /* Four broad material facts consumed by the surface shader.

     X is how far the pack has gone from powder towards névé, which sets the
     sheen's roughness. Y is the machine-groomed share of the snow. Z is the
     exact snow-to-rock transition and W is the stone family, from blue slate
     to warmer iron rock. Keeping the actual material decisions on the
     generated lattice avoids trying to recover geology from luminance after
     lighting and colour grading have already changed it. */
  const surface = new Float32Array(count * 4);
  /* The local lateral phase origin and its dx/dz tangent. This is separate
     from surface state because it has to morph with world position at every
     re-anchor; ice and groom coverage can still take the cheaper snap path. */
  const groomFrame = new Float32Array(count * 2);
  /* Triple buffering: live attributes, the target currently being eased
     towards, and a spare target filled in the background. Reusing the current
     target used to freeze every active skyline morph until the next build was
     complete. Swapping two references at commit lets motion continue while
     the spare is prepared and changes its destination without stopping. */
  let targetPositions = new Float32Array(count * 3);
  let targetNormals = new Float32Array(count * 3);
  let targetColors = new Float32Array(count * 3);
  let targetSurface = new Float32Array(count * 4);
  let targetGroomFrame = new Float32Array(count * 2);
  let buildPositions = new Float32Array(count * 3);
  let buildNormals = new Float32Array(count * 3);
  let buildColors = new Float32Array(count * 3);
  let buildSurface = new Float32Array(count * 4);
  let buildGroomFrame = new Float32Array(count * 2);
  const morphMask = new Float32Array(count);
  const coarseDetailMask = new Float32Array(count);
  const fineDetailMask = new Float32Array(count);
  const mogulDetailMask = new Float32Array(count);
  const flankDetailMask = new Float32Array(count);
  const bulkDetailMask = new Float32Array(count);
  const heights = new Float64Array(count);
  const indices = new (count > 65535 ? Uint32Array : Uint16Array)(rows * cols * 6);

  // Alternate the diagonal through successive quads. Repeating one diagonal
  // across the whole mountain creates long false creases in flat shading.
  let t = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Columns run left to right and rows run from behind the rider to in
      // front of them, so this is the winding that faces up
      const a = r * vertsX + c;
      if ((r + c) & 1) {
        indices[t++] = a; indices[t++] = a + 1; indices[t++] = a + vertsX + 1;
        indices[t++] = a; indices[t++] = a + vertsX + 1; indices[t++] = a + vertsX;
      } else {
        indices[t++] = a; indices[t++] = a + 1; indices[t++] = a + vertsX;
        indices[t++] = a + 1; indices[t++] = a + vertsX + 1; indices[t++] = a + vertsX;
      }
    }
  }

  let m = 0;
  for (let r = 0; r < vertsZ; r++) {
    for (let c = 0; c < vertsX; c++, m++) {
      morphMask[m] = smoothstep(morphNear, morphFar, Math.hypot(xs[c], zs[r]));
      const cellX = Math.max(
        c > 0 ? Math.abs(xs[c] - xs[c - 1]) : 0,
        c + 1 < vertsX ? Math.abs(xs[c + 1] - xs[c]) : 0,
      );
      const cellZ = Math.max(
        r > 0 ? Math.abs(zs[r] - zs[r - 1]) : 0,
        r + 1 < vertsZ ? Math.abs(zs[r + 1] - zs[r]) : 0,
      );
      /* Geometry LOD is also the anti-aliasing filter for the two finest
         height octaves. Fade them before a cell grows wide enough to sample
         them unreliably; the rider's collision query keeps full detail. */
      const cell = Math.max(cellX, cellZ);
      coarseDetailMask[m] = 1 - smoothstep(
        chatter.lod.coarse[0], chatter.lod.coarse[1], cell,
      );
      fineDetailMask[m] = 1 - smoothstep(
        chatter.lod.fine[0], chatter.lod.fine[1], cell,
      );
      mogulDetailMask[m] = 1 - smoothstep(
        moguls.lod[0], moguls.lod[1], cell,
      );
      // The flank fluting is much longer than the mogul octave and survives
      // much wider cells, so it keeps its own fade rather than borrowing one
      // that would delete it while the wall is still the whole left of frame.
      flankDetailMask[m] = 1 - smoothstep(
        wall.runnels.lod[0], wall.runnels.lod[1], cell,
      );
      // The bulk is an octave coarser again, and it is the term that has to
      // survive furthest: a seventy-metre gully is still the shape of the
      // valley at a range where the fluting inside it is long gone.
      bulkDetailMask[m] = 1 - smoothstep(
        wall.bulk.lod[0], wall.bulk.lod[1], cell,
      );
    }
  }

  /* The glide's working set, indexed once. `morphMask` never changes after
     this loop, so which vertices the LOD morph can actually move is a fact
     about the grid and not about any frame — yet `settleMorph` used to walk
     all of them, lerping the near disc with an alpha of exactly one, which is
     an assignment written as arithmetic. The split: `snapList` is the mask=0
     collision-exact disc, copied from the target once per anchor; `morphList`
     is everything the glide genuinely lerps. Note the masked set is the
     *outside* of a disc, so it touches both ends of the buffer and its one
     covering range is effectively the whole attribute — the upload win lives
     in the colours and surface state never travelling during a morph at all,
     and the range is kept because it is free and would tighten by itself if
     the mask ever did. */
  let nMorph = 0;
  for (let i = 0; i < count; i++) if (morphMask[i] > 0) nMorph += 1;
  const morphList = new Uint32Array(nMorph);
  const snapList = new Uint32Array(count - nMorph);
  {
    let mi = 0;
    let si = 0;
    for (let i = 0; i < count; i++) {
      if (morphMask[i] > 0) morphList[mi++] = i;
      else snapList[si++] = i;
    }
  }
  const morphLo = nMorph > 0 ? morphList[0] : 0;
  const morphSpan = nMorph > 0 ? morphList[nMorph - 1] - morphLo + 1 : 0;

  /* ------------------------------------------------------------------------
     THE SUN'S SHADOW, as a world-fixed horizon cache

     The render mesh is camera-centred and graded; lighting must be neither.
     A five-by-five torus of canonical 96 m tiles is sampled directly in world
     coordinates. Its 32 sun bearings are complete before the first frame.
     Later, a module worker prepares only the row or column beyond the visible
     156 m shadow radius and writes it into a slot whose previous world tile is
     already hundreds of metres away. A texel that can be seen never changes.
     ------------------------------------------------------------------------ */
  const shadeDirections = SHADE.directions;
  const shadeSpacing = (2 * SHADE.half) / SHADE.size;
  const shadeTileSamples = SHADE.tileSamples;
  const shadeTileGrid = SHADE.tileGrid;
  const shadeTileSpan = shadeTileSamples * shadeSpacing;
  const shadePageSamples = shadeTileSamples * shadeTileGrid;
  const shadePageSpan = shadePageSamples * shadeSpacing;
  const shadeLayerSamples = shadePageSamples + 2; // one wrapped gutter each side
  const shadeDirectionCols = SHADE.directionGrid[0];
  const shadeDirectionRows = SHADE.directionGrid[1];
  const shadeAtlasWidth = shadeLayerSamples * shadeDirectionCols;
  const shadeAtlasHeight = shadeLayerSamples * shadeDirectionRows;
  const shadeAtlasData = new Uint16Array(shadeAtlasWidth * shadeAtlasHeight * 2);
  const shadeHeightData = new Uint16Array(shadePageSamples * shadePageSamples);
  const shadeTexture = new THREE.DataTexture(
    shadeAtlasData, shadeAtlasWidth, shadeAtlasHeight,
    THREE.RGFormat, THREE.HalfFloatType,
  );
  shadeTexture.colorSpace = THREE.NoColorSpace;
  shadeTexture.minFilter = THREE.LinearFilter;
  shadeTexture.magFilter = THREE.LinearFilter;
  shadeTexture.wrapS = THREE.ClampToEdgeWrapping;
  shadeTexture.wrapT = THREE.ClampToEdgeWrapping;
  shadeTexture.generateMipmaps = false;
  const shadeHeightTexture = new THREE.DataTexture(
    shadeHeightData, shadePageSamples, shadePageSamples,
    THREE.RedFormat, THREE.HalfFloatType,
  );
  shadeHeightTexture.colorSpace = THREE.NoColorSpace;
  shadeHeightTexture.minFilter = THREE.LinearFilter;
  shadeHeightTexture.magFilter = THREE.LinearFilter;
  shadeHeightTexture.wrapS = THREE.RepeatWrapping;
  shadeHeightTexture.wrapT = THREE.RepeatWrapping;
  shadeHeightTexture.generateMipmaps = false;

  // Geometric distances preserve the old near detail and cover the same reach.
  const shadeStep = new Float64Array(SHADE.steps);
  {
    let total = 0;
    const growth = 1.34;
    let s = 1;
    for (let k = 0; k < SHADE.steps; k++) { total += s; s *= growth; }
    let d = 0;
    s = SHADE.reach / total;
    for (let k = 0; k < SHADE.steps; k++) {
      d += s;
      shadeStep[k] = d;
      s *= growth;
    }
  }
  const shadowSpec = {
    tileSamples: shadeTileSamples,
    spacing: shadeSpacing,
    directions: shadeDirections,
    azimuth: SHADE.azimuth,
    steps: Array.from(shadeStep),
    raise: SHADE.raise,
    gradeBase: GRADE.base,
    // Workers have a separate module realm and therefore a separate copy of
    // noise.js state. Carry the chosen mountain seed with every batch so an
    // off-screen tile is bit-identical to the canonical height field here.
    worldSeed: getWorldSeed(),
  };
  const mod = (v, n) => ((v % n) + n) % n;
  const EMPTY_TILE = -2147483648;
  const slotTileX = new Int32Array(shadeTileGrid * shadeTileGrid);
  const slotTileZ = new Int32Array(shadeTileGrid * shadeTileGrid);
  slotTileX.fill(EMPTY_TILE);
  slotTileZ.fill(EMPTY_TILE);
  const wantedSlot = new Array(shadeTileGrid * shadeTileGrid).fill('');
  const pendingShadeTiles = new Set();
  let shadeWorker = null;
  let shadeWorkerBatch = 0;
  let shadeWorkerHealthy = true;
  let shadeHealth = 1;
  let shadeReady = false;
  let shadeCenterX = NaN;
  let shadeCenterZ = NaN;
  let sunLevel = 1;

  const slotIndex = (tx, tz) => mod(tz, shadeTileGrid) * shadeTileGrid
    + mod(tx, shadeTileGrid);
  const tileKey = (tx, tz) => `${tx}:${tz}`;

  function copyRG(src, srcIndex, dst, dstIndex) {
    dst[dstIndex] = src[srcIndex];
    dst[dstIndex + 1] = src[srcIndex + 1];
  }

  /* Direction layers carry a one-texel wrapped gutter. Without it, bilinear
     filtering at the torus seam would blend the last spatial texel with the
     next sun bearing in the 2D atlas. */
  function refreshShadeGutters() {
    for (let direction = 0; direction < shadeDirections; direction++) {
      const ox = (direction % shadeDirectionCols) * shadeLayerSamples;
      const oy = Math.floor(direction / shadeDirectionCols) * shadeLayerSamples;
      for (let y = 1; y <= shadePageSamples; y++) {
        const left = ((oy + y) * shadeAtlasWidth + ox) * 2;
        const first = ((oy + y) * shadeAtlasWidth + ox + 1) * 2;
        const last = ((oy + y) * shadeAtlasWidth + ox + shadePageSamples) * 2;
        const right = ((oy + y) * shadeAtlasWidth + ox + shadePageSamples + 1) * 2;
        copyRG(shadeAtlasData, last, shadeAtlasData, left);
        copyRG(shadeAtlasData, first, shadeAtlasData, right);
      }
      const top = oy * shadeAtlasWidth + ox;
      const firstRow = (oy + 1) * shadeAtlasWidth + ox;
      const lastRow = (oy + shadePageSamples) * shadeAtlasWidth + ox;
      const bottom = (oy + shadePageSamples + 1) * shadeAtlasWidth + ox;
      for (let x = 0; x < shadeLayerSamples; x++) {
        copyRG(shadeAtlasData, (lastRow + x) * 2, shadeAtlasData, (top + x) * 2);
        copyRG(shadeAtlasData, (firstRow + x) * 2, shadeAtlasData, (bottom + x) * 2);
      }
    }
  }

  function installShadowRegion(result, publish = true) {
    const { originTileX, originTileZ, tilesX, tilesZ, width, height } = result;
    for (let y = 0; y < height; y++) {
      const worldCellZ = originTileZ * shadeTileSamples + y;
      const py = mod(worldCellZ, shadePageSamples);
      for (let x = 0; x < width; x++) {
        const worldCellX = originTileX * shadeTileSamples + x;
        const px = mod(worldCellX, shadePageSamples);
        shadeHeightData[py * shadePageSamples + px] = result.ground[y * width + x];
      }
    }
    for (let direction = 0; direction < shadeDirections; direction++) {
      const ox = (direction % shadeDirectionCols) * shadeLayerSamples + 1;
      const oy = Math.floor(direction / shadeDirectionCols) * shadeLayerSamples + 1;
      const srcBase = direction * width * height * 2;
      for (let y = 0; y < height; y++) {
        const py = mod(originTileZ * shadeTileSamples + y, shadePageSamples);
        for (let x = 0; x < width; x++) {
          const px = mod(originTileX * shadeTileSamples + x, shadePageSamples);
          const src = srcBase + (y * width + x) * 2;
          const dst = ((oy + py) * shadeAtlasWidth + ox + px) * 2;
          copyRG(result.horizon, src, shadeAtlasData, dst);
        }
      }
    }
    for (let z = 0; z < tilesZ; z++) {
      for (let x = 0; x < tilesX; x++) {
        const tx = originTileX + x;
        const tz = originTileZ + z;
        const slot = slotIndex(tx, tz);
        slotTileX[slot] = tx;
        slotTileZ[slot] = tz;
      }
    }
    if (publish) {
      refreshShadeGutters();
      shadeTexture.needsUpdate = true;
      shadeHeightTexture.needsUpdate = true;
    }
  }

  function publishShadowCache() {
    const u = shading.uniforms;
    u.uShadeMap.value = shadeTexture;
    u.uShadeHeightMap.value = shadeHeightTexture;
    shadeTexture.needsUpdate = true;
    shadeHeightTexture.needsUpdate = true;
  }

  function startShadeWorker() {
    if (shadeWorker) return;
    if (typeof Worker === 'undefined') {
      shadeWorkerHealthy = false;
      return;
    }
    try {
      shadeWorker = new Worker(
        new URL('./shadow-worker.js', import.meta.url), { type: 'module' },
      );
      shadeWorkerHealthy = true;
      shadeWorker.onmessage = (event) => {
        let installed = false;
        for (const result of event.data.results) {
          const { tile, horizon, ground } = result;
          const key = tileKey(tile.x, tile.z);
          pendingShadeTiles.delete(key);
          const slot = slotIndex(tile.x, tile.z);
          if (wantedSlot[slot] !== key) continue;
          installShadowRegion({
            originTileX: tile.x,
            originTileZ: tile.z,
            tilesX: 1,
            tilesZ: 1,
            width: shadeTileSamples,
            height: shadeTileSamples,
            horizon,
            ground,
          }, false);
          installed = true;
        }
        if (installed) {
          refreshShadeGutters();
          shadeTexture.needsUpdate = true;
          shadeHeightTexture.needsUpdate = true;
        }
      };
      shadeWorker.onerror = () => {
        shadeWorker?.terminate();
        shadeWorker = null;
        pendingShadeTiles.clear();
        /* Never let stale torus slots masquerade as another stretch of
           mountain. Module workers are expected on the WebGL2 target, but a
           CSP/import/runtime failure degrades by fading the optional terrain
           self-shadow; dynamic object shadows and all lighting remain live. */
        shadeWorkerHealthy = false;
      };
    } catch {
      shadeWorker = null;
      shadeWorkerHealthy = false;
    }
  }

  function queueShadowTiles(centerX, centerZ) {
    if (!shadeWorker) {
      shadeWorkerHealthy = false;
      return;
    }
    const tiles = [];
    const radius = (shadeTileGrid - 1) >> 1;
    for (let tz = centerZ - radius; tz <= centerZ + radius; tz++) {
      for (let tx = centerX - radius; tx <= centerX + radius; tx++) {
        const slot = slotIndex(tx, tz);
        const key = tileKey(tx, tz);
        wantedSlot[slot] = key;
        if (slotTileX[slot] === tx && slotTileZ[slot] === tz) continue;
        if (pendingShadeTiles.has(key)) continue;
        pendingShadeTiles.add(key);
        tiles.push({ x: tx, z: tz });
      }
    }
    if (!tiles.length) return;
    shadeWorker.postMessage({
      id: ++shadeWorkerBatch,
      tiles,
      spec: shadowSpec,
    });
  }

  function initializeShadowCache(x, z) {
    /* Residency is centred on the tile containing the rider. When that tile
       changes, the torus slot being replaced begins at least two complete
       tiles (192 m) away, outside the 156 m live radius; the incoming row is
       equally distant and gives its worker a 36 m lead before it can matter.
       Biasing the resident page downhill would queue earlier, but it would
       also overwrite an uphill tile while it was still visibly shadowed. */
    shadeCenterX = Math.floor(x / shadeTileSpan);
    shadeCenterZ = Math.floor(z / shadeTileSpan);
    const radius = (shadeTileGrid - 1) >> 1;
    const result = buildShadowRegion({
      ...shadowSpec,
      originTileX: shadeCenterX - radius,
      originTileZ: shadeCenterZ - radius,
      tilesX: shadeTileGrid,
      tilesZ: shadeTileGrid,
    }, heightAt);
    installShadowRegion(result);
    for (let tz = shadeCenterZ - radius; tz <= shadeCenterZ + radius; tz++) {
      for (let tx = shadeCenterX - radius; tx <= shadeCenterX + radius; tx++) {
        wantedSlot[slotIndex(tx, tz)] = tileKey(tx, tz);
      }
    }
    shadeReady = true;
    publishShadowCache();
    startShadeWorker();
  }

  function updateShadowCache(x, z) {
    if (!shadeReady) {
      initializeShadowCache(x, z);
      return;
    }
    const cx = Math.floor(x / shadeTileSpan);
    const cz = Math.floor(z / shadeTileSpan);
    if (cx === shadeCenterX && cz === shadeCenterZ) return;
    shadeCenterX = cx;
    shadeCenterZ = cz;
    queueShadowTiles(cx, cz);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSmoothNormal',
    new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color',
    new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSurface',
    new THREE.BufferAttribute(surface, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aGroomFrame',
    new THREE.BufferAttribute(groomFrame, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // The corner of the grid, not its longest side. `ahead` alone was already
  // short of the far columns and is now short of the tail as well; the mesh is
  // never frustum-culled so nothing was reading it, but a bounding volume that
  // does not bound is a trap left for whoever turns culling back on.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(), Math.hypot(side, Math.max(ahead, behind)),
  );

  /* The generated snow plates, packed as data rather than as baked light.

     R is albedo variation centred at one half, G is height centred at one
     half and B is crystalline density. The terrain has no UVs by design, so
     they are sampled from stable world XZ below. A shared neutral one-pixel
     texture keeps the material identical to the procedural fallback while a
     WebP is loading, or forever if an asset cannot be fetched. */
  const neutralSurface = new THREE.DataTexture(
    new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat,
  );
  neutralSurface.colorSpace = THREE.NoColorSpace;
  neutralSurface.needsUpdate = true;

  const powderSurface = { value: neutralSurface };
  const groomedSurface = { value: neutralSurface };
  const rockSurface = { value: neutralSurface };
  const sandstoneSurface = { value: neutralSurface };
  const snowReady = { value: new THREE.Vector2() };
  const snowReadyTarget = new THREE.Vector2();

  const snowTile = { value: new THREE.Vector2(24.0, 4.0) };
  const snowAlbedo = { value: new THREE.Vector2(0.012, 0.020) };
  const snowHeight = { value: new THREE.Vector2(0.85, 0.72) };

  /* THE LIT GATE, which is a light on the snow and not a light in the scene.

     A slalom gate is two poles and a flag, and at a hundred metres in falling
     snow that is two vertical lines about a pixel wide each. The thing the
     player actually has to see is not the poles, it is the GAP — the piece of
     hill they are supposed to ride through — and nothing was drawing that at
     all.

     Three ways to draw it were available and two of them are wrong here.

     A real light costs a light slot in every material's loop and lights the
     sky as readily as the ground. A decal — a quad laid on the snow — has to
     conform to a hill with four octaves of relief on it, and at the grazing
     angle a rider sees the ground from, a quad that is a hand's breadth out
     anywhere along its nine metres reads as a floating sheet of paper.

     So it goes in the ground's own fragment shader, where the geometry
     problem does not exist: the pixel already knows exactly where on the
     mountain it is, `vWorld` is already here for the corduroy, and the glow
     is a function of that. It conforms perfectly because it is not a surface,
     and it costs four distance tests on the one material that wants them.

     The shape is a lozenge rather than a disc, because a gate has a width:
     the distance is measured to the SEGMENT between the two poles, so the
     bright part is the mouth and the falloff is a soft margin all round it.

     `w` is the strength and zero means an unused slot, which is what keeps
     the loop branchless-ish and lets the writer simply stop early. */
  const GATE_SLOTS = 4;
  /* How far past the mouth the light reaches before it is gone. Six metres
     spills a little onto the snow either side of each pole, which is what
     makes the pair read as one gate rather than as two separate lamps. */
  const GATE_FALLOFF = 6.0;
  const gateGlow = {
    value: Array.from({ length: GATE_SLOTS }, () => new THREE.Vector4()),
  };
  const gateTint = {
    value: Array.from({ length: GATE_SLOTS }, () => new THREE.Color()),
  };

  const prepareSurface = (texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.generateMipmaps = true;
    return texture;
  };
  const surfaceLoader = new THREE.TextureLoader();
  /* …and one promise over the pair of them, so the page can tell a player
     that the snow is still arriving.

     It settles rather than resolving: a plate that fails to fetch leaves the
     neutral one-pixel texture in place and the ground keeps its procedural
     fallback, which is a complete and playable mountain. A progress read-out
     that waits forever on a 404 would be reporting a problem the game does
     not have. */
  const loadSurface = (name, apply) => new Promise((settle) => {
    surfaceLoader.load(
      new URL(`../assets/textures/snow/${name}`, import.meta.url).href,
      (texture) => {
        apply(prepareSurface(texture));
        settle();
      },
      undefined,
      settle,
    );
  });
  const surfacesReady = Promise.all([
    loadSurface('powder-surface.webp', (t) => {
      powderSurface.value = t;
      snowReadyTarget.x = 1;
    }),
    loadSurface('groomed-surface.webp', (t) => {
      groomedSurface.value = t;
      snowReadyTarget.y = 1;
    }),
  ]);
  // Rock and sandstone are supplementary detail textures rather than the
  // near-field snow the loading bar's "snow" step is actually waiting on,
  // so they stay outside `surfacesReady` and load without gating anything.
  surfaceLoader.load(
    new URL('../assets/textures/rock/rock-granite.jpg', import.meta.url).href,
    (texture) => {
      rockSurface.value = prepareSurface(texture);
    },
  );
  surfaceLoader.load(
    new URL('../assets/textures/rock/rock-sandstone.jpg', import.meta.url).href,
    (texture) => {
      sandstoneSurface.value = prepareSurface(texture);
    },
  );

  /* Surface detail, in the fragment shader rather than in the mesh.

     A snowfield at these cell sizes is geometrically smooth and visually
     blank, and a blank ground is the one thing that will not sell speed: the
     eye reads velocity from texture passing underneath, and there was none.
     Both plates are sampled in stable world coordinates so they remain welded
     to the ground. Four positive mip levels remove crystal-, rib- and texel-
     scale structure from albedo; the near-field height reads use a much lower
     bias, then explicit derivative and distance gates remove corduroy before
     it can collapse into moire. Geometry, tracks, spray and the broad snow
     sheen carry the speed cues after that point. */
  /* The graded grid has cells tens of metres wide at the fog curtain. A flat
     normal per triangle exposes that shipping topology as a row of enormous
     light and dark wedges. The colour shader therefore uses the continuous
     height-field normal below. `flatShading` deliberately stays enabled so
     three's separate depth/shadow shader keeps its old no-normal path: adding
     the built-in `normal` attribute would also move every terrain shadow
     lookup by the sun light's receiver normalBias. */
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uSnowPowder: powderSurface,
      uSnowGroomed: groomedSurface,
      uRockTex: rockSurface,
      uSandstoneTex: sandstoneSurface,
      uSnowReady: snowReady,
      uSnowTile: snowTile,
      uSnowAlbedo: snowAlbedo,
      uSnowHeight: snowHeight,
      uGateGlow: gateGlow,
      uGateTint: gateTint,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aSmoothNormal;
        attribute vec4 aSurface;
        attribute vec2 aGroomFrame;
        varying vec3 vWorld;
        varying vec3 vSmoothNormal;
        varying float vDist;
        varying float vGroomed;
        varying float vRock;
        varying float vRockKind;
        varying vec2 vGroomFrame;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vSmoothNormal = normalize(normalMatrix * aSmoothNormal);
        vN64Ice = aSurface.x;
        vN64Sheen = 1.0 - aSurface.z;
        vGroomed = aSurface.y;
        vRock = aSurface.z;
        vRockKind = aSurface.w;
        vGroomFrame = aGroomFrame;
        vDist = -mvPosition.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorld;
        varying vec3 vSmoothNormal;
        varying float vDist;
        varying float vGroomed;
        varying float vRock;
        varying float vRockKind;
        varying vec2 vGroomFrame;
        uniform vec4 uGateGlow[${GATE_SLOTS}];
        uniform vec3 uGateTint[${GATE_SLOTS}];
        uniform sampler2D uSnowPowder;
        uniform sampler2D uSnowGroomed;
        uniform sampler2D uRockTex;
        uniform sampler2D uSandstoneTex;
        uniform vec2 uSnowReady;
        uniform vec2 uSnowTile;
        uniform vec2 uSnowAlbedo;
        uniform vec2 uSnowHeight;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        /* Material identity is generated with the terrain. Recovering it from
           albedo luminance made blue shaded snow look like rock and let the
           palest rock sparkle like ice; the explicit continuous mask is both
           cheaper and correct through every time-of-day palette. */
        float n64SnowMask = 1.0 - clamp(vRock, 0.0, 1.0);

        /* Machine corduroy is a surface state, not a second ground material.
           A storm lays powder over it continuously, so the same weather dial
           that roughens the shared snow response also reveals the powder
           plate here. The broad vertex mask keeps the transition at the
           piste edge soft and agrees with the cover calculation exactly. */
        float n64FreshCover = smoothstep(0.10, 0.82, uSnowFresh);
        float n64GroomBlend = clamp(vGroomed * (1.0 - n64FreshCover), 0.0, 1.0);
        float n64GroomWeight = n64GroomBlend * uSnowReady.y;
        /* Until the groomed plate has decoded, powder remains the fallback on
           the piste. The reveal therefore cannot pass through a neutral,
           textureless patch if the two WebPs finish on different frames. */
        float n64PowderWeight = (1.0 - n64GroomWeight) * uSnowReady.x;
        vec2 powderUv = mat2(0.9563, -0.2924, 0.2924, 0.9563)
          * (vWorld.xz / uSnowTile.x);
        /* The groomer travelled down the fall line. U advances downhill; V
           is measured from the precomputed local phase origin, so equal-V
           ribs bend with the piste and choose their own separated fork. */
        vec2 groomedUv = vec2(vWorld.z, vWorld.x - vGroomFrame.x)
          / uSnowTile.x;
        /* The screen footprint, taken as gradients rather than as a width,
           because the fetch below needs the same two vectors and this is the
           only place in the shader where they can honestly be measured.

           Derivatives are only defined in *uniform* control flow: a quad
           whose fragments disagree about a branch has no obligation to give
           the ones inside it a meaningful rate of change. Both fetches below
           now sit behind a distance-and-material fade, which is exactly the
           kind of condition that splits a quad along a fade boundary — so
           the gradients are measured out here where every fragment still
           agrees, and handed to the fetch explicitly. A width is |ddx| plus
           |ddy| by definition, so the footprint is unchanged.
           (No back-ticks in here: this comment is inside a template literal.) */
        vec2 n64MacroDx = dFdx(powderUv);
        vec2 n64MacroDy = dFdy(powderUv);
        vec2 n64GroomMacroDx = dFdx(groomedUv);
        vec2 n64GroomMacroDy = dFdy(groomedUv);
        float n64PowderMacroFoot = max(
          abs(n64MacroDx.x) + abs(n64MacroDy.x),
          abs(n64MacroDx.y) + abs(n64MacroDy.y)) * 32.0;
        float n64GroomMacroFoot = max(
          abs(n64GroomMacroDx.x) + abs(n64GroomMacroDy.x),
          abs(n64GroomMacroDx.y) + abs(n64GroomMacroDy.y)) * 32.0;
        float n64PowderMacro = n64PowderWeight
          * (1.0 - smoothstep(0.35, 0.80, n64PowderMacroFoot));
        float n64GroomMacro = n64GroomWeight
          * (1.0 - smoothstep(0.35, 0.80, n64GroomMacroFoot));
        float n64SurfaceFade = (1.0 - smoothstep(80.0, 180.0, vDist))
          * n64SnowMask;
        // The fetch is inside its own fade rather than beside it. Past a
        // hundred and eighty metres — and on every rock face at any range —
        // the read was being multiplied by zero, and a texture fetch costs
        // the same whatever it is multiplied by. Distance is monotonic and
        // the snow/rock split is a broad vertex field, so the branch is
        // coherent across a warp instead of splitting one.
        if (n64SurfaceFade * max(n64PowderMacro, n64GroomMacro) > 0.002) {
          /* Only the plate's macro structure, four mip levels up. A LOD bias
             of B is a scale of 2^B on the gradients, so this is the old
             plus-four bias exactly, with the derivative taken somewhere it
             is actually defined. */
          float n64AlbedoDelta = 0.0;
          /* Clear piste and settled powder each read one plate. The softened
             piste edge and partially buried storm transition intentionally
             pay for both so neither boundary becomes a material cut. */
          if (n64PowderMacro > 0.002) {
            vec4 n64PowderSample = texture2DGradEXT(uSnowPowder, powderUv,
              n64MacroDx * 16.0, n64MacroDy * 16.0);
            n64AlbedoDelta += (n64PowderSample.r - 0.5) * 2.0
              * uSnowAlbedo.x * n64PowderMacro;
          }
          if (n64GroomMacro > 0.002) {
            vec4 n64GroomSample = texture2DGradEXT(uSnowGroomed, groomedUv,
              n64GroomMacroDx * 16.0, n64GroomMacroDy * 16.0);
            n64AlbedoDelta += (n64GroomSample.r - 0.5) * 2.0
              * uSnowAlbedo.y * n64GroomMacro;
          }
          diffuseColor.rgb *= 1.0 + n64AlbedoDelta * n64SurfaceFade;
        }
        /* The deliberately blurred macro pass above preserves large snow
           tone but erases the groomer's finest ribs. Restore just a trace of
           their height as value in the immediate riding space, then dissolve
           it before the stripe period approaches a pixel. This keeps the
           piste readable beside the board without exporting moire into the
           landscape or the retro resolution pass. */
        vec2 n64CordColorUv = vec2(vWorld.z, vWorld.x - vGroomFrame.x)
          / uSnowTile.y;
        vec2 n64CordColorDx = dFdx(n64CordColorUv);
        vec2 n64CordColorDy = dFdy(n64CordColorUv);
        float n64CordColorFoot = abs(n64CordColorDx.y)
          + abs(n64CordColorDy.y);
        float n64CordColorResolve = 1.0
          - smoothstep(0.20, 0.58, n64CordColorFoot / 0.021);
        float n64CordColor = n64GroomWeight * n64CordColorResolve
          * (1.0 - smoothstep(18.0, 38.0, vDist)) * n64SnowMask;
        if (n64CordColor > 0.002) {
          float n64CordHeight = texture2DGradEXT(uSnowGroomed,
            n64CordColorUv, n64CordColorDx, n64CordColorDy).g;
          diffuseColor.rgb *= 1.0 + (n64CordHeight - 0.5)
            * 0.11 * n64CordColor;
        }
        /* Two stones, with two structures. Blue slate is thin, tilted bedding;
           iron rock breaks into broader shelves crossed by dark vertical
           joints. Both coordinates wrap at 64 m with integer periods, and all
           carriers dissolve against their own screen footprint before they
           can turn into distant stripes. The material family is the generated
           W channel, so a geological band stays one stone from base to crest. */
        float n64SlateC = vWorld.y + vWorld.x * 0.22 + vWorld.z * 0.11;
        float n64SlateFoot = fwidth(n64SlateC);
        float n64IronC = vWorld.y * 0.62 - vWorld.x * 0.14 + vWorld.z * 0.18;
        float n64IronFoot = fwidth(n64IronC);
        float n64JointC = vWorld.x * 0.39 - vWorld.z * 0.27;
        float n64JointFoot = fwidth(n64JointC);
        if (n64SnowMask < 0.998) {
          float n64SlateW = mod(n64SlateC, 64.0);
          float n64IronW = mod(n64IronC, 64.0);
          float n64JointW = mod(n64JointC, 64.0);
          // Only faces steep enough to have shed their snow show their beds —
          // the up axis is the view matrix's second column, which is world up
          // in the space vSmoothNormal already lives in. Each frequency then
          // dissolves before its own period can approach the pixel: this game
          // has been burned by resampled near-pixel patterns before, so the
          // fades are the load-bearing part and not a nicety.
          float n64StrataUp = dot(normalize(vSmoothNormal), viewMatrix[1].xyz);
          float n64SlateBeds = sin(n64SlateW * 1.276272)
              * (1.0 - smoothstep(1.4, 3.5, n64SlateFoot))
            + sin(n64SlateW * 3.926991) * 0.7
              * (1.0 - smoothstep(0.30, 0.90, n64SlateFoot));
          float n64SlateInk = smoothstep(0.08, 0.92, n64SlateBeds) * 0.12;

          float n64IronBeds = sin(n64IronW * 0.785398)
            * (1.0 - smoothstep(1.6, 4.2, n64IronFoot));
          float n64IronShelf = smoothstep(-0.35, 0.72, n64IronBeds) * 0.075;
          float n64JointWave = abs(sin(n64JointW * 0.589049));
          float n64IronJoint = (1.0 - smoothstep(0.03, 0.24, n64JointWave))
            * (1.0 - smoothstep(0.35, 1.10, n64JointFoot)) * 0.11;
          float n64RockInk = mix(n64SlateInk, n64IronShelf + n64IronJoint,
            clamp(vRockKind, 0.0, 1.0));
          vec4 n64RockSample = texture2D(uRockTex, vWorld.xz * 0.08);
          diffuseColor.rgb *= mix(vec3(1.0), n64RockSample.rgb * 1.55, (1.0 - n64SnowMask) * 0.40);
          diffuseColor.rgb *= 1.0 - n64RockInk * (1.0 - n64SnowMask)
            * smoothstep(0.30, 0.72, 1.0 - n64StrataUp);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Hide the graded grid's triangle topology from lighting while leaving
        // its actual geometry, depth and shadow coordinates untouched.
        normal = normalize(vSmoothNormal);
        /* The same beds that break up rock albedo lean its normal a few
           degrees, so they catch and lose the moving sun instead of reading as
           stripes painted on a smooth wall. Slate leans across its thin beds;
           iron follows the broader shelf dip. Their derivative gates are the
           ones already measured above, and the entire response disappears on
           snow through the explicit material channel. */
        float n64SlateLean = cos(mod(n64SlateC, 64.0) * 1.276272)
          * (1.0 - smoothstep(0.45, 1.35, n64SlateFoot));
        float n64IronLean = cos(mod(n64IronC, 64.0) * 0.785398)
          * (1.0 - smoothstep(0.80, 2.40, n64IronFoot));
        vec3 n64SlateDir = normalize(vec3(-0.22, 0.0, -0.11));
        vec3 n64IronDir = normalize(vec3(0.14, 0.0, -0.18));
        vec3 n64RockLean = mix(n64SlateDir * n64SlateLean,
          n64IronDir * n64IronLean, clamp(vRockKind, 0.0, 1.0));
        normal = normalize(normal + mat3(viewMatrix) * n64RockLean
          * vRock * 0.12);
        /* The plates' height channels, spent as light rather than geometry.
           A short world difference of G makes a slope, and that slope leans
           the smooth normal — powder sastrugi off-piste and machine ribs on
           it, at a scale the 75 cm mesh cannot carry. Powder keeps its broad
           nine-centimetre probe; corduroy uses less than a quarter of one rib
           so the two samples cannot land on equivalent points and cancel. */
        vec2 n64DetailUv = mat2(0.9563, -0.2924, 0.2924, 0.9563)
          * (vWorld.xz / uSnowTile.y);
        vec2 n64GroomDetailUv = vec2(vWorld.z, vWorld.x - vGroomFrame.x)
          / uSnowTile.y;
        float n64DetailStep = 0.09 / uSnowTile.y;
        float n64GroomStep = 0.018 / uSnowTile.y;
        // The macro fade above lets go at 80-180 m, far too late for detail
        // this fine. Distance takes it out across 55-90 m, and the derivative
        // gate takes it out sooner wherever a grazing angle stretches one
        // pixel's footprint towards the differencing step itself — past that
        // point the slope is sampling noise, and the retro pipeline would
        // resample it into shimmer. The gate is the anti-moire clause.
        // Gradients rather than a width, taken before the gate below for the
        // same reason as the macro read: all three fetches are behind it,
        // and a quad split along a fade boundary owes them nothing. The two
        // offset reads are the centre footprint shifted by a local tangent;
        // the frame changes only over route-scale distances, so they share
        // its gradients to first order.
        vec2 n64DetailDx = dFdx(n64DetailUv);
        vec2 n64DetailDy = dFdy(n64DetailUv);
        vec2 n64GroomDetailDx = dFdx(n64GroomDetailUv);
        vec2 n64GroomDetailDy = dFdy(n64GroomDetailUv);
        float n64DetailFoot = max(
          abs(n64DetailDx.x) + abs(n64DetailDy.x),
          abs(n64DetailDx.y) + abs(n64DetailDy.y));
        float n64PowderResolve = 1.0
          - smoothstep(0.5, 1.0, n64DetailFoot / n64DetailStep);
        /* Corduroy is strongly directional and therefore less forgiving than
           powder grain. Its ribs repeat about every 0.021 source UV; measure
           the footprint across them specifically and dissolve the height
           response before one pixel spans a rib. Mip filtering then handles
           the colour without a screen-frequency carrier. */
        float n64CordFoot = abs(n64GroomDetailDx.y) + abs(n64GroomDetailDy.y);
        float n64GroomResolve = 1.0
          - smoothstep(0.32, 0.78, n64CordFoot / 0.021);
        float n64PowderDetail = n64PowderWeight * n64PowderResolve
          * (1.0 - smoothstep(55.0, 90.0, vDist));
        float n64GroomDetail = n64GroomWeight * n64GroomResolve
          * (1.0 - smoothstep(45.0, 78.0, vDist));
        float n64DetailLive = max(n64PowderDetail, n64GroomDetail) * n64SnowMask;
        // Three fetches, and they are the most expensive thing this material
        // does per pixel — so each plate lives behind its own coherent
        // surface gate. The piste boundary and fresh-snow crossfade pay for
        // both; ordinary clear or fully buried snow does not.
        if (n64DetailLive > 0.002) {
          float n64SlopeX = 0.0;
          float n64SlopeZ = 0.0;
          if (n64PowderDetail * n64SnowMask > 0.002) {
            // One mip up, as a gradient scale of two: the old plus-one bias.
            vec2 n64DetailGx = n64DetailDx * 2.0;
            vec2 n64DetailGy = n64DetailDy * 2.0;
            float n64DetailC = texture2DGradEXT(uSnowPowder, n64DetailUv,
              n64DetailGx, n64DetailGy).g;
            float n64DetailX = texture2DGradEXT(uSnowPowder,
              n64DetailUv + vec2(0.9563, -0.2924) * n64DetailStep,
              n64DetailGx, n64DetailGy).g;
            float n64DetailZ = texture2DGradEXT(uSnowPowder,
              n64DetailUv + vec2(0.2924, 0.9563) * n64DetailStep,
              n64DetailGx, n64DetailGy).g;
            n64SlopeX += (n64DetailC - n64DetailX)
              * uSnowHeight.x * n64PowderDetail;
            n64SlopeZ += (n64DetailC - n64DetailZ)
              * uSnowHeight.x * n64PowderDetail;
          }
          if (n64GroomDetail * n64SnowMask > 0.002) {
            vec2 n64GroomGx = n64GroomDetailDx * 2.0;
            vec2 n64GroomGy = n64GroomDetailDy * 2.0;
            float n64GroomC = texture2DGradEXT(uSnowGroomed, n64GroomDetailUv,
              n64GroomGx, n64GroomGy).g;
            /* +world X is +V. +world Z advances U while subtracting the local
               route slope from V; carrying that tangent into the offset is
               what makes the normal follow the bent ribs rather than merely
               rotating their colour. */
            float n64GroomX = texture2DGradEXT(uSnowGroomed,
              n64GroomDetailUv + vec2(0.0, n64GroomStep),
              n64GroomGx, n64GroomGy).g;
            float n64GroomZ = texture2DGradEXT(uSnowGroomed,
              n64GroomDetailUv
                + vec2(n64GroomStep, -vGroomFrame.y * n64GroomStep),
              n64GroomGx, n64GroomGy).g;
            n64SlopeX += (n64GroomC - n64GroomX)
              * uSnowHeight.y * n64GroomDetail;
            n64SlopeZ += (n64GroomC - n64GroomZ)
              * uSnowHeight.y * n64GroomDetail;
          }
          // A heightfield's normal is (-dh/dx, 1, -dh/dz); the lean is built
          // in the world frame the offsets were taken in, then rotated through
          // the view matrix to join the view-space normal. The gain is
          // deliberately shy of embossing — the plate reads as shading, not
          // as relief.
          normal = normalize(normal + mat3(viewMatrix)
            * vec3(n64SlopeX, 0.0, n64SlopeZ) * n64SnowMask);
        }
        /* THE SNOW BETWEEN THE PLATES AND THE CURTAIN.

           Every surface this mountain has has let go by a hundred and eighty
           metres: the corduroy at 38, the plate normals at 90, the plate
           albedo at 180, and the geometry's own wind octaves at whatever cell
           size the graded grid has reached by then. Past that the ground is a
           sheet of paper — and on a surface that fills two thirds of the
           frame, a sheet of paper is the single loudest thing in the picture
           saying this is a rendering of snow rather than snow. Every fade in
           this file is individually correct and together they leave four
           hundred metres of mountain with nothing on it at all.

           What is genuinely out there is the same wind relief the near field
           has, at the only scale still worth resolving at that range: drift
           lines about eight metres apart, stretched a hundred metres down the
           prevailing wind. So this is that field continued — analytically,
           because a sine has an exact derivative and this is spent entirely
           as a normal, and because the one thing that must not happen at this
           distance is a repeating carrier landing on the pixel grid. It rides
           the same anisotropic axes as the chatter octave in the config and
           arrives as that octave's LOD gives up, so the near ground and the
           far ground are one surface described twice rather than two surfaces
           meeting at a ring.
           (No back-ticks in here: this comment is inside a template literal.)

           Two things stop it becoming wallpaper. The ridge lines are bent by
           their own long axis, so they braid and lean instead of combing; and
           one slow noise field decides where the wind has actually worked, so
           the drifts come in fields with smooth snow between them.

           ON THE PISTE IT IS A DIFFERENT SURFACE, chosen by the same groom
           mask the plates use — because a piste is not wind-blown. What a
           groomed slope shows at two hundred metres is not corduroy; the ribs
           went at 38. It is the seams between the machine's own passes, about
           five metres apart, running down the fall line in the groomer's
           frame and therefore bending with the route and forking with it. */
        float n64FarLive = smoothstep(60.0, 125.0, vDist)
          * (1.0 - smoothstep(380.0, 520.0, vDist)) * n64SnowMask;
        /* THE THREE PHASES AND THEIR FOOTPRINTS, MEASURED OUT HERE, where
           every fragment in the quad still agrees that they are being
           measured. Derivatives are only defined in uniform control flow, and
           the gate below is not uniform: it varies with distance across the
           60-125 m and 380-520 m fades and with the snow mask at every rock
           boundary, so a quad split along any of those owes the fragments
           inside no meaningful rate of change. Taking fwidth in there would
           hand the anti-moire gate a driver-dependent number in exactly the
           places it exists to protect. The same argument, and the same
           remedy, as the plate fetches above.
           (No back-ticks in here: this comment is inside a template literal.) */
        float n64FarAcross = vWorld.x * 0.985 - vWorld.z * 0.174;
        float n64FarAlong = vWorld.x * 0.174 + vWorld.z * 0.985;
        // Drift lines: eight metres across, a hundred down the wind.
        float n64FarSwayA = n64FarAlong * 0.0628;
        float n64FarPhaseA = n64FarAcross * 0.816 + sin(n64FarSwayA) * 2.1;
        // Soft sastrugi over the top: three metres across, thirty along.
        float n64FarSwayB = n64FarAlong * 0.224 + 2.1;
        float n64FarPhaseB = n64FarAcross * 1.904 + sin(n64FarSwayB) * 1.3;
        // The machine's passes, in the groomer's own frame.
        float n64FarPhaseG = (vWorld.x - vGroomFrame.x) * 1.30;
        /* Each carrier dissolves against its own screen footprint, and this
           is the load-bearing part rather than a nicety: measured in radians
           of phase per pixel, past about one and a half there are fewer than
           four pixels to a cycle and what reaches the screen is not drift, it
           is the moire this file has been burned by before. The anisotropy is
           what keeps the gate open at all down a piste seen nearly edge-on —
           almost all of the variation is across the run, which is the axis a
           grazing view foreshortens least. */
        float n64FarFadeA = 1.0 - smoothstep(0.55, 1.55, fwidth(n64FarPhaseA));
        float n64FarFadeB = 1.0 - smoothstep(0.55, 1.55, fwidth(n64FarPhaseB));
        float n64FarFadeG = 1.0 - smoothstep(0.55, 1.55, fwidth(n64FarPhaseG));
        if (n64FarLive > 0.003) {
          float n64FarPatch = 0.26 + 0.74 * n64Noise(vWorld.xz * 0.0135);
          /* THE MATERIAL, NOT THE TEXTURE. Which of the two far fields this
             ground gets is a question about whether a machine drove over it,
             and the groom *blend* is that answer — the generated groom mask
             with the storm's burial of it. The groom *weight* is the same
             answer multiplied by whether a WebP has finished decoding, which
             is the right gate for a texture fetch and the wrong one for this:
             none of these three carriers reads a texture. Keyed to readiness,
             a plate that never arrives left the piste permanently wind-drifted
             and permanently without its groomer seams, in a fallback the
             loader explicitly supports.
             (No back-ticks in here: this comment is inside a template literal.) */
          float n64FarWindLevel = n64FarLive * n64FarPatch
            * (1.0 - n64GroomBlend);
          float n64FarA = 0.215 * n64FarWindLevel * n64FarFadeA;
          float n64FarB = 0.082 * n64FarWindLevel * n64FarFadeB;
          float n64FarG = 0.062 * n64FarLive * n64GroomBlend * n64FarFadeG;

          float n64FarCosA = cos(n64FarPhaseA) * n64FarA;
          float n64FarCosB = cos(n64FarPhaseB) * n64FarB;
          // The two field axes, then the same two rotated back into world XZ.
          float n64FarDAcross = n64FarCosA * 0.816 + n64FarCosB * 1.904;
          float n64FarDAlong = n64FarCosA * (2.1 * 0.0628 * cos(n64FarSwayA))
            + n64FarCosB * (1.3 * 0.224 * cos(n64FarSwayB));
          float n64FarSlopeX = n64FarDAcross * 0.985 + n64FarDAlong * 0.174;
          float n64FarSlopeZ = -n64FarDAcross * 0.174 + n64FarDAlong * 0.985;
          /* The groomer's V axis moves with x at unity and with z at minus the
             route tangent the vertex already carries, so a pass seam bends
             with the piste and chooses its own branch through a fork exactly
             as the corduroy does. */
          float n64FarCosG = cos(n64FarPhaseG) * n64FarG * 1.30;
          n64FarSlopeX += n64FarCosG;
          n64FarSlopeZ += n64FarCosG * -vGroomFrame.y;

          normal = normalize(normal + mat3(viewMatrix)
            * vec3(n64FarSlopeX, 0.0, n64FarSlopeZ));
        }`)
      /* The gate lights, added to the lit colour and before the fog — so a
         gate two hundred metres off glows through the storm exactly as much
         as the storm allows, which is what makes it read as a light on a
         mountain rather than a sticker on the screen.

         `opaque_fragment` is where `outgoingLight` becomes `gl_FragColor`,
         and after it is the last moment the colour is still linear. Adding
         before tone mapping is the difference between a light and a paint
         bucket: a bright gate on bright snow rolls off instead of clipping to
         a flat disc of pure hue.
         (No back-ticks in here: this comment is inside a template literal.) */
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        for (int n64Gi = 0; n64Gi < ${GATE_SLOTS}; n64Gi++) {
          vec4 n64Gate = uGateGlow[n64Gi];
          if (n64Gate.w <= 0.0) continue;
          // Distance to the SEGMENT between the poles, not to its middle
          vec2 n64GateP = vWorld.xz - n64Gate.xy;
          float n64GateAx = max(abs(n64GateP.x) - n64Gate.z, 0.0);
          float n64GateD = length(vec2(n64GateAx, n64GateP.y)) * ${(1 / GATE_FALLOFF).toFixed(5)};
          if (n64GateD >= 1.0) continue;
          float n64GateA = n64Gate.w * exp(-2.3 * n64GateD * n64GateD)
            * (1.0 - smoothstep(0.55, 1.0, n64GateD));
          /* MULTIPLY FIRST, THEN ADD, and the first attempt did only the
             second half — which is a light that works at night and does
             nothing at all in the day.

             Sunlit snow is already at the top of the range. Adding amber to
             it moves nothing a player can see: the channels clip and the
             pool is white on white. That is not a strength problem and
             turning it up ten times over did not fix it; it made a patch
             appear in the one shaded dip beside the gate and stay invisible
             between the poles, which is precisely backwards.

             A coloured light on snow does two things and only one of them is
             addition. It also *takes away* the parts of the daylight the
             lamp is not made of, because the snow under it is being lit by
             the lamp instead. So the ground is pushed towards the tint and
             then given a little glow on top, and the result reads on white
             snow at noon and in the dark at midnight for the same reason a
             real one does.
             (No back-ticks in here: this comment is inside a template literal.) */
          vec3 n64GateC = uGateTint[n64Gi];
          gl_FragColor.rgb = mix(gl_FragColor.rgb,
            gl_FragColor.rgb * n64GateC * 1.25 + n64GateC * 0.30,
            min(n64GateA, 1.0));
        }`);
  };
  /* Keep direction-aware atmospheric fog and continuous Lambert response,
     then add the analytic snow/ice microfacet reflection that nothing else on
     the mountain receives. */
  /* The ground reads the shadow field the same way everything else does.

     It used to carry its own copy per vertex, which was free and which was
     also wrong in a way that took a player about a minute to notice. The
     shade of a vertex is a fact about where that vertex *is*, and out in the
     graded field a vertex moves every time the mesh re-anchors — it glides to
     its new sampling position over a few frames while its shade snaps to the
     destination at once. Every six metres of travel, four times a second, a
     band of far terrain was shaded for somewhere it had not arrived yet. That
     was the regular flicker.

     Sampling per fragment cannot have that problem, because the field is
     indexed by where the pixel is rather than by which vertex it came from:
     wherever a vertex glides to, the ground under it is lit correctly on the
     way. It costs one cached fetch on the largest surface in the frame, and
     it deletes the entire second code path — one march, one consumer, one
     way for the mountain and everything standing on it to be shaded. */
  shading.apply(material, { sheen: 1 });
  material.userData.snowSurfaces = {
    powder: powderSurface,
    groomed: groomedSurface,
    ready: snowReady,
    tile: snowTile,
    albedo: snowAlbedo,
    height: snowHeight,
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  /* THE SHADOW PROXY IS GONE, and this is where it stood.

     It was already the second attempt at the same problem. The full graded
     grid used to be drawn into the sun's depth map — two hundred and
     seventeen thousand triangles rasterised into a window that can only ever
     see the middle of them — and the proxy cut that to a near-field index
     over the same live buffers, about a hundred and thirteen thousand. Better
     by a factor of two and still, every frame, redrawing a picture of
     something that had not moved.

     Because it never does. A cast shadow is a function of the caster, the
     receiver and the light, and for the mountain shadowing itself all three
     are either fixed or changing on the timescale of a three-minute day. That
     is precisely what a precomputation is for, and `TERRAIN.shade` is it: the
     horizon march at the head of this function, published as one small
     texture and folded into the light loop above — on the ground and on
     everything standing on it. The depth map now holds only the things that
     genuinely move through it — the trees, the huts, the animals and the
     rider — which is what it was worth having for. */

  /* The palette, unpacked into plain numbers.

     `THREE.Color` is what these are written as, because a hex string is the
     only form of a colour anybody can read — but its `lerp` is a method call
     on an object and the colour pass is the innermost loop in this file, so
     the values are pulled out into flat triples once and the loop does its
     own arithmetic. Six mixes per vertex that used to be six method calls.

     SNOW IS NEVER WHITE, and the numbers themselves are in `SNOWPACK`. */
  const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const P = SNOWPACK;
  const cDeep = rgb(P.deep);
  const cIce = rgb(P.ice);
  const cShade = rgb(P.shade);
  const cSlate = [rgb(P.slate[0]), rgb(P.slate[1])];
  const cIron = [rgb(P.iron[0]), rgb(P.iron[1])];

  const ctx = makeContext();

  let anchorX = NaN;
  let anchorZ = NaN;
  let anchorY = NaN;
  let morphing = false;
  let morphAge = 0;
  // The near disc's one-time copy from the target is still owed for this
  // anchor — see `settleMorph`.
  let morphSnap = false;

  function fillHeightRows(ax, az, rowFrom, rowTo) {
    // Heights are generated a row at a time so everything depending only on z
    // is computed once for the whole row rather than once per vertex.
    let i = rowFrom * vertsX;
    for (let r = rowFrom; r < rowTo; r++) {
      rowContext(az + zs[r], ctx);
      for (let c = 0; c < vertsX; c++, i++) {
        heights[i] = heightIn(
          ctx, ax + xs[c], coarseDetailMask[i], fineDetailMask[i],
          mogulDetailMask[i], flankDetailMask[i], bulkDetailMask[i],
        );
      }
    }
  }

  function fillSurfaceRows(
    ax, az, ay, outPositions, outNormals, outColors, outSurface, outGroomFrame,
    rowFrom, rowTo,
  ) {
    let i = rowFrom * vertsX;
    let p = i * 3;
    let q = i * 4;
    let g = i * 2;
    for (let r = rowFrom; r < rowTo; r++) {
      const lz = zs[r];
      const wz = az + lz;
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(vertsZ - 1, r + 1);
      const dz2 = zs[rNext] - zs[rPrev] || 1;
      // The haze is radial and this test used to be one-dimensional, so a
      // vertex four hundred metres down the hill *and* four hundred to the
      // side — a corner of the grid, and there are a great many of them — was
      // paying the full materials pass to decide a colour a kilometre away
      // behind a curtain that closes at five hundred and sixty. Squared, so
      // the row's own share is one compare and no root.
      const lzSq = lz * lz;
      /* Even rows whose full material pass is hidden by haze still need the
         row-level flank facts. They are four slow noise samples shared by the
         entire row, and keeping them lets the silhouette remain the same
         slate/iron mountain instead of turning back into deep snow as soon as
         the radial material shortcut begins. */
      rowContext(wz, ctx);
      const grade = gradeAt(wz);

      /* Vertices past `FOG_ROW_SKIP` are behind a closed curtain in every
         weather, so the snowpack's whole materials pass — two band octaves,
         the mottle, the aspect, the groom — would be deciding colours nobody
         can see. Heights stay exact because the skyline is the one thing fog
         leaves, and the central-difference normal is kept because it is a
         handful of arithmetic and it is what lights that skyline. The colour
         is the deep-snow stop and both surface fields are zero, which is also
         what the real pass converges to under a kilometre of altitude. */
      if (lzSq >= FOG_SKIP_SQ) {
        for (let c = 0; c < vertsX; c++, i++, p += 3, q += 4, g += 2) {
          const h = heights[i];
          const wx = ax + xs[c];
          outPositions[p] = xs[c];
          outPositions[p + 1] = h - ay;
          outPositions[p + 2] = lz;
          const cPrev = Math.max(0, c - 1);
          const cNext = Math.min(vertsX - 1, c + 1);
          const dx2 = xs[cNext] - xs[cPrev] || 1;
          const dx = (heights[r * vertsX + cNext] - heights[r * vertsX + cPrev]) / dx2;
          const dz = (heights[rNext * vertsX + c] - heights[rPrev * vertsX + c]) / dz2;
          const invNormal = 1 / Math.hypot(dx, 1, dz);
          outNormals[p] = -dx * invNormal;
          outNormals[p + 1] = invNormal;
          outNormals[p + 2] = -dz * invNormal;
          /* The full snowpack is invisible here, but the silhouette's slope is
             not. Classify obvious walls from the normal already being paid for
             so a distant side mountain cannot collapse into one featureless
             white sheet merely because its material noise was skipped. */
          const farToCentre = ctx.split > 0
            ? Math.min(Math.abs(wx - (ctx.mid - ctx.split)),
              Math.abs(wx - (ctx.mid + ctx.split)))
            : Math.abs(wx - ctx.mid);
          const farSide = wx < ctx.mid;
          const farBroad = farSide ? ctx.wallBroadLeft : ctx.wallBroadRight;
          const farDetail = farSide ? ctx.wallDetailLeft : ctx.wallDetailRight;
          const farFlank = smoothstep(ctx.half + ctx.lipW * 0.55,
            ctx.half + ctx.lipW + 70, farToCentre)
            * smoothstep(5, 34, h - ctx.base);
          const farRock = Math.max(
            smoothstep(0.48, 0.92, Math.hypot(-dx, grade - dz)),
            farFlank * (0.72 + 0.28 * farDetail),
          );
          const farKind = smoothstep(0.22, 0.78,
            farBroad * 0.62 + farDetail * 0.38);
          const farRockR = cSlate[1][0] + (cIron[1][0] - cSlate[1][0]) * farKind;
          const farRockG = cSlate[1][1] + (cIron[1][1] - cSlate[1][1]) * farKind;
          const farRockB = cSlate[1][2] + (cIron[1][2] - cSlate[1][2]) * farKind;
          const farStone = farRock * 0.86;
          outColors[p] = cDeep[0] + (farRockR - cDeep[0]) * farStone;
          outColors[p + 1] = cDeep[1] + (farRockG - cDeep[1]) * farStone;
          outColors[p + 2] = cDeep[2] + (farRockB - cDeep[2]) * farStone;
          outSurface[q] = 0;
          outSurface[q + 1] = 0;
          outSurface[q + 2] = farRock;
          outSurface[q + 3] = farKind;
          outGroomFrame[g] = 0;
          outGroomFrame[g + 1] = 0;
        }
        continue;
      }

      /* One-metre central differences are far below the route's hundred-
         metre wander wavelengths but broad enough to ignore float chatter.
         Both possible branch frames are row facts; choosing between them per
         vertex is then one compare and two array writes. */
      const frameLeft = groomFrameOriginAt(wz, -1);
      const frameRight = groomFrameOriginAt(wz, 1);
      const frameSlopeLeft = (groomFrameOriginAt(wz + 1, -1)
        - groomFrameOriginAt(wz - 1, -1)) * 0.5;
      const frameSlopeRight = (groomFrameOriginAt(wz + 1, 1)
        - groomFrameOriginAt(wz - 1, 1)) * 0.5;

      /* Altitude, and it is free. `ctx.base` is the grade's own integral,
         which is exactly how far below the top of the run this row lies, and
         the row context has already worked it out. Everything downhill of the
         snow line's lower stop reads one, so past about five kilometres of
         riding the altitude term has said all it has to say and the bands and
         the relief carry the mountain on their own. */
      const alt = smoothstep(P.snowLine[0], P.snowLine[1], -ctx.base);
      const rowCover = P.base + P.altitude * alt;
      const bandZ = wz * P.band.freq;

      for (let c = 0; c < vertsX; c++, i++, p += 3, q += 4, g += 2) {
        const lx = xs[c];
        const wx = ax + lx;
        const h = heights[i];

        outPositions[p] = lx;
        outPositions[p + 1] = h - ay;
        outPositions[p + 2] = lz;

        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(vertsX - 1, c + 1);
        const dx2 = xs[cNext] - xs[cPrev] || 1;
        const dx = (heights[r * vertsX + cNext] - heights[r * vertsX + cPrev]) / dx2;
        const dz = (heights[rNext * vertsX + c] - heights[rPrev * vertsX + c]) / dz2;

        // The other half of the radial skip: the far corners of the fan, which
        // the row test above cannot reach because their row is well inside it.
        if (lzSq + lx * lx >= FOG_SKIP_SQ) {
          const invFar = 1 / Math.hypot(dx, 1, dz);
          outNormals[p] = -dx * invFar;
          outNormals[p + 1] = invFar;
          outNormals[p + 2] = -dz * invFar;
          const farToCentre = ctx.split > 0
            ? Math.min(Math.abs(wx - (ctx.mid - ctx.split)),
              Math.abs(wx - (ctx.mid + ctx.split)))
            : Math.abs(wx - ctx.mid);
          const farSide = wx < ctx.mid;
          const farBroad = farSide ? ctx.wallBroadLeft : ctx.wallBroadRight;
          const farDetail = farSide ? ctx.wallDetailLeft : ctx.wallDetailRight;
          const farFlank = smoothstep(ctx.half + ctx.lipW * 0.55,
            ctx.half + ctx.lipW + 70, farToCentre)
            * smoothstep(5, 34, h - ctx.base);
          const farRock = Math.max(
            smoothstep(0.48, 0.92, Math.hypot(-dx, grade - dz)),
            farFlank * (0.72 + 0.28 * farDetail),
          );
          const farKind = smoothstep(0.22, 0.78,
            farBroad * 0.62 + farDetail * 0.38);
          const farRockR = cSlate[1][0] + (cIron[1][0] - cSlate[1][0]) * farKind;
          const farRockG = cSlate[1][1] + (cIron[1][1] - cSlate[1][1]) * farKind;
          const farRockB = cSlate[1][2] + (cIron[1][2] - cSlate[1][2]) * farKind;
          const farStone = farRock * 0.86;
          outColors[p] = cDeep[0] + (farRockR - cDeep[0]) * farStone;
          outColors[p + 1] = cDeep[1] + (farRockG - cDeep[1]) * farStone;
          outColors[p + 2] = cDeep[2] + (farRockB - cDeep[2]) * farStone;
          outSurface[q] = 0;
          outSurface[q + 1] = 0;
          outSurface[q + 2] = farRock;
          outSurface[q + 3] = farKind;
          outGroomFrame[g] = 0;
          outGroomFrame[g + 1] = 0;
          continue;
        }

        /* Object-space curvature replaces the broad screen-space occlusion
           that used to band the lower frame. Uneven-grid second differences
           find real bowls and crests in the sampled heightfield; a restrained
           colour response then preserves those folds when diffuse light is
           nearly frontal. Because it follows metres of world geometry and is
           filtered by the same LOD mask, it cannot form display-row moire. */
        let curvature = 0;
        if (c > 0 && c + 1 < vertsX) {
          const stepL = Math.abs(xs[c] - xs[cPrev]);
          const stepR = Math.abs(xs[cNext] - xs[c]);
          const slopeL = (h - heights[r * vertsX + cPrev]) / stepL;
          const slopeR = (heights[r * vertsX + cNext] - h) / stepR;
          curvature += 2 * (slopeR - slopeL) / (stepL + stepR);
        }
        if (r > 0 && r + 1 < vertsZ) {
          const stepB = Math.abs(zs[r] - zs[rPrev]);
          const stepF = Math.abs(zs[rNext] - zs[r]);
          const slopeB = (h - heights[rPrev * vertsX + c]) / stepB;
          const slopeF = (heights[rNext * vertsX + c] - h) / stepF;
          curvature += 2 * (slopeF - slopeB) / (stepB + stepF);
        }
        /* The new rider-scale pillows are deliberately low: geometry that
           stays believable under a board only moves a few pixels in profile.
           Let real object-space curvature carry more of their visual read.
           This remains tied to metres and the spectral LOD masks above, so it
           cannot reform the old screen-row bands or lower-frame moire. */
        const cavityShade = smoothstep(0.0006, 0.010, curvature) * 0.20;
        const crestLift = smoothstep(0.0008, 0.012, -curvature) * 0.070;

        /* Height-field normal at this sample. Using the finite differences
           already needed by the snow/rock palette makes this effectively free
           and, unlike averaging triangle faces, independent of which diagonal
           a graded cell happens to use. */
        const invNormal = 1 / Math.hypot(dx, 1, dz);
        outNormals[p] = -dx * invNormal;
        outNormals[p + 1] = invNormal;
        outNormals[p + 2] = -dz * invNormal;

        /* The horizontal part of the surface normal, taken against the grade
           rather than against flat — the whole hill is tilted, and a piste is
           not a cliff just for being a piste.

           That subtraction used to be an addition, and it was a real bug
           rather than a taste: the height rises with z and so does `gradeAt`,
           so `dz + grade` on perfectly groomed ground came to twice the
           grade — 0.64 at the top of the run and 0.47 in a mellow chapter —
           against a rock threshold that started at 0.5. Every steep chapter
           of the mountain therefore had a grey wash of stone mixed into its
           flattest snow, every mellow chapter had none, and nothing else on
           the hill could get a word in. It is also why aspect was never going
           to work until it was fixed: a bearing measured off a vector that is
           mostly the grade is a bearing that says "downhill" everywhere. */
        const sx = -dx;
        const sz = grade - dz;
        const steep = Math.sqrt(sx * sx + sz * sz);

        // Which way this face is turned, against the bearing the sun spends
        // its day around, and normalised so it is a direction and not a
        // steepness. The constant keeps flat ground — where there is no
        // meaningful aspect at all — from being handed a loud one.
        const face = (sx * P.sunX + sz * P.sunZ) / (steep + 0.22);

        // How far above the plane the grade says this row should be on. In
        // the corridor that is the ridge and roll octaves, so it reads as
        // crests and hollows; outside it, it is the lip and then the wall.
        const relief = h - ctx.base;

        // Which stretch of mountain this is. Sheared, so the strata run
        // across the hill on the diagonal rather than squarely, and two
        // octaves so a band has a grain as well as an edge.
        const bu = bandZ + wx * P.band.shear * P.band.freq;
        const band = noise1(bu, P.band.seed) * 0.68
          + noise1(bu * 3.1 + 11.3, P.band.seed + 4) * 0.32;

        // Machine-compacted snow, measured to whichever branch is nearer, so
        // both sides of a route island get the same hardpack response.
        const toCentre = ctx.split > 0
          ? Math.min(Math.abs(wx - (ctx.mid - ctx.split)), Math.abs(wx - (ctx.mid + ctx.split)))
          : Math.abs(wx - ctx.mid);
        /* Corduroy exists only on the ribbon the groomer actually drove —
           the guide line through the gates — while the corridor around it
           is regular skied-in snow: still compacted enough to keep most of
           its cover, but matte, and with no machine pattern on it. */
        const corridorMask = 1 - smoothstep(ctx.half - 4, ctx.half + 10, toCentre);
        const ribbon = 1 - smoothstep(guide.tol - 3, guide.tol + 6,
          Math.abs(wx - ctx.guideX));
        const groomed = ribbon * corridorMask;
        const pisteCover = corridorMask * (0.55 + 0.45 * ribbon);

        /* The budget. Everything above, summed and then clamped — summed
           rather than multiplied because a product crowds towards the middle
           and never reaches either end, and the ends are the whole point:
           ground that is genuinely bare and ground that is genuinely buried.

           The groomed term is last and it is the one that is not about
           weather. A piste is a machine's work: that snow was put there and
           is kept there, which is exactly why a real high-alpine run is a
           white ribbon laid across bare rock — and why the route stays
           legible here after the mountain around it has gone to stone. */
        const cover = clamp01(rowCover
          + P.bandWeight * (band * 2 - 1)
          - P.crestWeight * smoothstep(P.crest[0], P.crest[1], relief)
          - P.scourWeight * smoothstep(P.scour[0], P.scour[1], relief)
          + P.driftWeight * (1 - smoothstep(P.drift[0], P.drift[1], relief))
          - P.aspectWeight * (face > 0 ? face : 0)
          + P.shadeWeight * (face < 0 ? -face : 0)
          + P.groomed * pisteCover);

        /* Rock, which is not a separate decision from the snow — it is where
           the snow ran out. Two ways for that to happen: the ground got too
           steep to hold what little it had, and the ground had nothing to
           hold in the first place. The first threshold slides with the cover,
           because thin snow slides off slopes deep snow sits on quite
           happily, and that is one phenomenon and so it is one term. */
        const slip = P.slip[0] + P.hold * cover;
        const steepRock = smoothstep(slip, slip + (P.slip[1] - P.slip[0]), steep);
        const thinRock = smoothstep(P.thin[0], P.thin[1], cover);
        /* Broad flank outcrops. The containment wall eventually lies back to
           a modest grade, so steepness alone reburied its largest visible
           faces in a smooth white sheet. The same kilometre-scale material
           band and side-specific geology that shape the wall expose coherent
           ribs through that snow. Nothing is screen-space and nothing moves
           with the sun; this is a material fact that morphs with the terrain. */
        const sideDetail = wx < ctx.mid
          ? ctx.wallDetailLeft : ctx.wallDetailRight;
        const outcropBand = smoothstep(0.30, 0.70,
          band * 0.55 + sideDetail * 0.45);
        /* The rocky band is rock because of where it is, not how tall it
           stands: the same zone the height field fills with boulders is the
           one the colour pass strips. The outcrop field leaves wind-pocket
           snow between the stones, so the band reads as talus rather than
           tarmac — and the powder band before it is left entirely alone. */
        const zoneRock = smoothstep(ctx.half + ctx.powderW - 4,
          ctx.half + ctx.powderW + 10, toCentre)
          * (0.35 + 0.65 * outcropBand);
        /* The wall above holds snow on its first metres the way a real
           valley side does; only faces standing well over the run shed it. */
        const flank = smoothstep(ctx.half + ctx.bandW,
          ctx.half + ctx.bandW + ctx.lipW + 46, toCentre);
        const flankRock = flank * smoothstep(10, 34, relief)
          * (0.46 + 0.54 * outcropBand);
        /* No stone inside the corridor at all — the physics has no plate of
           rock under three centimetres of snow in its model, so the picture
           must not either. Outside it, all four reasons apply. */
        const rock = (1 - corridorMask)
          * Math.max(steepRock, thinRock, zoneRock, flankRock);

        /* Snow, along the axis of what it has been through rather than of how
           bright it is. Deep cover is soft and pale; thin cover is what the
           wind left, which is névé, which is ice, which is blue. Then a
           lift towards the shade stop for the broad wind-packed patches and
           for faces turned away from where the sun goes — snow lying in the
           mountain's own shadow is the bluest thing on it. */
        const icy = 1 - smoothstep(P.pack[0], P.pack[1], cover);
        /* Albedo describes snowpack, not a lamp. The old lee-face term baked a
           permanent cobalt shadow into the vertex colour and the live sun,
           hemisphere, terrain horizon and post grade all shaded it again.
           Broad wind crust keeps the material variation, but its direction is
           now free to respond honestly when the sun moves across the sky. */
        const packField = noise2(wx * 0.02, wz * 0.02, 7);
        const crust = (1 - groomed) * icy * (0.35 + 0.65 * packField);
        const dim = packField * 0.18 + crust * 0.14;
        let cr = cDeep[0] + (cIce[0] - cDeep[0]) * icy;
        let cg = cDeep[1] + (cIce[1] - cDeep[1]) * icy;
        let cb = cDeep[2] + (cIce[2] - cDeep[2]) * icy;
        cr += (cShade[0] - cr) * dim;
        cg += (cShade[1] - cg) * dim;
        cb += (cShade[2] - cb) * dim;
        cr += (cShade[0] - cr) * cavityShade;
        cg += (cShade[1] - cg) * cavityShade;
        cb += (cShade[2] - cb) * cavityShade;
        cr += (cDeep[0] - cr) * crestLift;
        cg += (cDeep[1] - cg) * crestLift;
        cb += (cDeep[2] - cb) * crestLift;
        const cavityValue = 1 - cavityShade * 0.70;
        cr *= cavityValue;
        cg *= cavityValue;
        cb *= cavityValue;

        const rockKind = smoothstep(0.34, 0.72, band);
        if (rock > 0.002) {
          /* Rock catches the light along its ridges and holds none of it in
             the clefts, which is most of what makes a cliff read as rock.

             And which rock is the band's decision, so a stretch of mountain
             is made of one stone all the way through instead of every cliff
             on the hill being the same grey. That was the complaint that is
             hardest to argue with: a single stone colour makes a hundred
             separate cliffs read as one repeated asset. */
          const mottle = noise2(wx * 0.16, wz * 0.16, 11);
          const d0 = cSlate[0], d1 = cSlate[1], w0 = cIron[0], w1 = cIron[1];
          const lo0 = d0[0] + (w0[0] - d0[0]) * rockKind;
          const lo1 = d0[1] + (w0[1] - d0[1]) * rockKind;
          const lo2 = d0[2] + (w0[2] - d0[2]) * rockKind;
          const hi0 = d1[0] + (w1[0] - d1[0]) * rockKind;
          const hi1 = d1[1] + (w1[1] - d1[1]) * rockKind;
          const hi2 = d1[2] + (w1[2] - d1[2]) * rockKind;
          cr += (lo0 + (hi0 - lo0) * mottle - cr) * rock;
          cg += (lo1 + (hi1 - lo1) * mottle - cg) * rock;
          cb += (lo2 + (hi2 - lo2) * mottle - cb) * rock;
        }

        /* Thin wind slab and machine-compacted piste carry the sharper ice
           reflection. Deep snow keeps a small value because its crystal
           facets still return the sun; exposed rock gets none. This stays a
           continuous vertex field, so the light travels in broad patches
           rather than sparkling at screen-pixel frequency. */
        const reliefReflect = clamp01(1 - cavityShade * 2.1 + crestLift * 1.4);
        outSurface[q] = clamp01(0.16 + icy * 0.78 + groomed * 0.16)
          * (1 - rock) * reliefReflect;
        // Corduroy belongs only to snow. Keeping rock out here makes the
        // fragment mask independent of the palette's luminance threshold.
        outSurface[q + 1] = groomed * (1 - rock);
        outSurface[q + 2] = rock;
        outSurface[q + 3] = rockKind;
        const frameRightSide = wx >= ctx.mid;
        outGroomFrame[g] = frameRightSide ? frameRight : frameLeft;
        outGroomFrame[g + 1] = frameRightSide ? frameSlopeRight : frameSlopeLeft;

        outColors[p] = cr;
        outColors[p + 1] = cg;
        outColors[p + 2] = cb;
      }
    }
  }

  function fill(
    ax, az, ay, outPositions, outNormals, outColors, outSurface, outGroomFrame,
  ) {
    fillHeightRows(ax, az, 0, vertsZ);
    fillSurfaceRows(
      ax, az, ay, outPositions, outNormals, outColors, outSurface, outGroomFrame,
      0, vertsZ,
    );
  }

  function publish() {
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aSmoothNormal.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.aSurface.needsUpdate = true;
    geometry.attributes.aGroomFrame.needsUpdate = true;
  }

  /* Every environment attribute travels with the geometry it describes.
     Their complete targets were already generated in the back buffer; these
     range uploads only reveal the same eased portion of position, normal,
     snow/rock colour, pack state and groomer phase each frame. */
  function publishMorph() {
    const pos = geometry.attributes.position;
    const nrm = geometry.attributes.aSmoothNormal;
    const col = geometry.attributes.color;
    const pack = geometry.attributes.aSurface;
    const frame = geometry.attributes.aGroomFrame;
    pos.addUpdateRange(morphLo * 3, morphSpan * 3);
    nrm.addUpdateRange(morphLo * 3, morphSpan * 3);
    col.addUpdateRange(morphLo * 3, morphSpan * 3);
    pack.addUpdateRange(morphLo * 4, morphSpan * 4);
    frame.addUpdateRange(morphLo * 2, morphSpan * 2);
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    col.needsUpdate = true;
    pack.needsUpdate = true;
    frame.needsUpdate = true;
  }

  function settleMorph(dt) {
    if (!morphing) return;
    morphAge += dt;
    const frameAlpha = 1 - Math.exp(-morphRate * dt);

    if (morphSnap) {
      /* mask=0 is the exact collision surface around the rider, and its
         alpha was exactly one — an assignment the old loop performed as a
         lerp, every vertex, every morphing frame. It happens here rather
         than at commit because commit's publish still shows the preserved
         old-world surface for one frame; snapping half the picture there
         would open a seam between the disc and the far field for that frame,
         and this way the whole surface moves together as it always did. */
      for (let k = 0; k < snapList.length; k++) {
        const i = snapList[k];
        const p = i * 3;
        positions[p] = targetPositions[p];
        positions[p + 1] = targetPositions[p + 1];
        positions[p + 2] = targetPositions[p + 2];
        normals[p] = targetNormals[p];
        normals[p + 1] = targetNormals[p + 1];
        normals[p + 2] = targetNormals[p + 2];
        colors[p] = targetColors[p];
        colors[p + 1] = targetColors[p + 1];
        colors[p + 2] = targetColors[p + 2];
        const s = i * 4;
        surface[s] = targetSurface[s];
        surface[s + 1] = targetSurface[s + 1];
        surface[s + 2] = targetSurface[s + 2];
        surface[s + 3] = targetSurface[s + 3];
        const g = i * 2;
        groomFrame[g] = targetGroomFrame[g];
        groomFrame[g + 1] = targetGroomFrame[g + 1];
      }
      morphSnap = false;
    }

    for (let k = 0; k < morphList.length; k++) {
      // mask=1 is a distant vertex that converges exponentially instead of
      // popping; everything on this list is somewhere on that slope.
      const i = morphList[k];
      const p = i * 3;
      const alpha = 1 - morphMask[i] * (1 - frameAlpha);
      positions[p] += (targetPositions[p] - positions[p]) * alpha;
      positions[p + 1] += (targetPositions[p + 1] - positions[p + 1]) * alpha;
      positions[p + 2] += (targetPositions[p + 2] - positions[p + 2]) * alpha;
      normals[p] += (targetNormals[p] - normals[p]) * alpha;
      normals[p + 1] += (targetNormals[p + 1] - normals[p + 1]) * alpha;
      normals[p + 2] += (targetNormals[p + 2] - normals[p + 2]) * alpha;
      colors[p] += (targetColors[p] - colors[p]) * alpha;
      colors[p + 1] += (targetColors[p + 1] - colors[p + 1]) * alpha;
      colors[p + 2] += (targetColors[p + 2] - colors[p + 2]) * alpha;
      const s = i * 4;
      surface[s] += (targetSurface[s] - surface[s]) * alpha;
      surface[s + 1] += (targetSurface[s + 1] - surface[s + 1]) * alpha;
      surface[s + 2] += (targetSurface[s + 2] - surface[s + 2]) * alpha;
      surface[s + 3] += (targetSurface[s + 3] - surface[s + 3]) * alpha;
      const g = i * 2;
      groomFrame[g] += (targetGroomFrame[g] - groomFrame[g]) * alpha;
      groomFrame[g + 1] += (targetGroomFrame[g + 1] - groomFrame[g + 1]) * alpha;
    }

    if (morphAge >= morphSettle) {
      positions.set(targetPositions);
      normals.set(targetNormals);
      colors.set(targetColors);
      surface.set(targetSurface);
      groomFrame.set(targetGroomFrame);
      morphing = false;
    }
    publishMorph();
  }

  /* Re-anchor after *eight* fine cells, not two.

     The uniform near field swaps to the same world lattice either way — the
     stride is a whole number of cells, which is the only property that
     guarantee needs — so nothing around the board moves and the facets stay
     welded to the hill exactly as before. What changes is how often everything
     further out is disturbed, and that turned out to be the whole of a visible
     artifact.

     The graded field cannot make the same guarantee: past `uniformNear` the
     sample points genuinely move when the anchor does, so those vertices are
     preserved in world space and then glide to their new samples. At a stride
     of two cells the anchor moves every three metres, which at riding speed is
     thirteen times a second against a glide whose time constant is a hundred
     and twenty-five milliseconds — so the far field never arrived anywhere. It
     was permanently in motion, chasing a target that moved again before it got
     there.

     Flat colour shading made that motion louder by changing an entire face's
     light at once; the custom height-field normals above have since removed
     that part. A moving vertex on a *silhouette* is still the worst geometric
     case there is, though: a few centimetres vertically moves the skyline
     across a pixel boundary, and the serrated edge appears to crawl. Measured
     against the sky, a single morph step moved twenty thousand pixels — over
     one per cent of the frame — almost all of it strung along the ridge lines.
     That was the "blinking triangles".

     Eight 75-centimetre cells preserve the established six-metre update
     cadence after the density increase. `morphRate` is high enough for the glide to
     converge between ordinary anchors, and avoiding a four-metre cadence also
     keeps the denser `fill` pass from running more often than the old mesh. */
  const stride = spacing * 8;

  /* A full 109k-vertex target fill is too large for one animation frame. The
     old synchronous rebuild could take roughly forty milliseconds, turning a
     six-metre anchor into a recurring camera hitch. Generate the next lattice
     in short row batches instead. The live mesh stays in world space while the
     target is prepared, then the existing LOD morph takes over exactly as it
     did before. This is temporal work scheduling, not a visual approximation:
     every target receives the same complete passes. Shadow preparation is no
     longer one of them: the world cache above is independent and its future
     off-screen tiles run in a worker. */
  const BUILD_BUDGET_MS = 4.0;
  const BUILD_BATCH_ROWS = 8;
  let build = null;
  const clockNow = () => (globalThis.performance?.now?.() ?? Date.now());

  function beginBuild(ax, az, ay) {
    // The spare arrays are independent of an in-flight visible convergence.
    build = { ax, az, ay, stage: 0, row: 0 };
  }

  function commitBuild(next) {
    [targetPositions, buildPositions] = [buildPositions, targetPositions];
    [targetNormals, buildNormals] = [buildNormals, targetNormals];
    [targetColors, buildColors] = [buildColors, targetColors];
    [targetSurface, buildSurface] = [buildSurface, targetSurface];
    [targetGroomFrame, buildGroomFrame] = [buildGroomFrame, targetGroomFrame];

    /* Changing the mesh transform must not move the live surface. Convert its
       local coordinates back to the same world positions under the new anchor
       before beginning convergence towards the finished back buffer. */
    const shiftX = anchorX - next.ax;
    const shiftY = anchorY - next.ay;
    const shiftZ = anchorZ - next.az;
    for (let p = 0; p < positions.length; p += 3) {
      positions[p] += shiftX;
      positions[p + 1] += shiftY;
      positions[p + 2] += shiftZ;
    }

    anchorX = next.ax;
    anchorZ = next.az;
    anchorY = next.ay;
    mesh.position.set(anchorX, anchorY, anchorZ);
    morphAge = 0;
    morphing = true;
    morphSnap = true;
    build = null;
    // Translation is the only live attribute changed on the commit frame.
    // The remaining four start their continuous trip on the next morph tick.
    geometry.attributes.position.needsUpdate = true;
  }

  function advanceBuild() {
    if (!build) return;
    const deadline = clockNow() + BUILD_BUDGET_MS;
    do {
      const rowTo = Math.min(vertsZ, build.row + BUILD_BATCH_ROWS);
      if (build.stage === 0) {
        fillHeightRows(build.ax, build.az, build.row, rowTo);
      } else {
        fillSurfaceRows(
          build.ax, build.az, build.ay,
          buildPositions, buildNormals, buildColors, buildSurface,
          buildGroomFrame,
          build.row, rowTo,
        );
      }
      build.row = rowTo;

      if (build.row >= vertsZ) {
        if (build.stage === 0) {
          build.stage = 1;
          build.row = 0;
        } else {
          commitBuild(build);
          return;
        }
      }
    } while (clockNow() < deadline);
  }

  function update(x, z, dt = 1 / 60) {
    const surfaceReveal = 1 - Math.exp(-3.2 * dt);
    snowReady.value.x += (snowReadyTarget.x - snowReady.value.x) * surfaceReveal;
    snowReady.value.y += (snowReadyTarget.y - snowReady.value.y) * surfaceReveal;
    settleMorph(dt);
    updateShadowCache(x, z);
    // Failure fallback is itself a lighting transition, never a state cut.
    const shadeHealthTarget = shadeWorkerHealthy ? 1 : 0;
    shadeHealth += (shadeHealthTarget - shadeHealth)
      * (1 - Math.exp(-3.5 * Math.max(0, dt)));
    shading.uniforms.uShadeLevel.value = sunLevel * shadeHealth;
    const ax = Math.round(x / stride) * stride;
    const az = Math.round(z / stride) * stride;

    const ay = heightAt(ax, az);
    if (!Number.isFinite(anchorX)) {
      anchorX = ax;
      anchorZ = az;
      anchorY = ay;
      mesh.position.set(ax, ay, az);
      fill(ax, az, ay, positions, normals, colors, surface, groomFrame);
      publish();
      return;
    }

    if (build) {
      advanceBuild();
      return;
    }
    if (ax === anchorX && az === anchorZ) return;

    beginBuild(ax, az, ay);
    advanceBuild();
  }

  /* Where the sun is, and how much of its shadow is being spent. `main.js`
     hands both over once a frame from the shared shading block and from the
     sky's own fade, so the mountain's precomputed shadow arrives and leaves
     on exactly the same dusk as the depth map's. */
  function setSun(dirX, dirY, dirZ, level) {
    sunLevel = level;
    let azimuth = Math.atan2(dirX, -dirZ);
    if (azimuth < SHADE.azimuth[0] - Math.PI) azimuth += Math.PI * 2;
    if (azimuth > SHADE.azimuth[1] + Math.PI) azimuth -= Math.PI * 2;
    const along = Math.max(0, Math.min(1,
      (azimuth - SHADE.azimuth[0]) / (SHADE.azimuth[1] - SHADE.azimuth[0])));
    shading.uniforms.uShadeSlice.value = along * (shadeDirections - 1);
    shading.uniforms.uShadeLevel.value = level * shadeHealth;
  }

  /* Which gates are lit, written once a frame by whoever owns the prop field.
     Everything ahead of the rider and inside the falloff's reach is a
     candidate; the four nearest win, because four is what the shader has and
     a gate behind you is not a thing you are aiming at.

     A taken gate keeps a low ember rather than going out. Snapping it off is
     the version that was tried first and it looks like a bug — the light
     vanishes at the exact moment the rider is between the poles and cannot
     see why. Fading it says *that one is done* while the pair is still in
     shot, which is the entire message. */
  const gateWarm = new THREE.Color('#ffb43c');
  const gateCool = new THREE.Color('#3cffd0');
  const gateOrder = [];
  function setGates(gates, riderZ) {
    gateOrder.length = 0;
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      // Ahead, and near enough that its glow would still reach the ground
      const ahead = riderZ - g.z;
      if (ahead < -12 || ahead > TERRAIN.gateGlowReach) continue;
      gateOrder.push(g);
    }
    gateOrder.sort((a, b) => (riderZ - a.z) - (riderZ - b.z));
    for (let i = 0; i < GATE_SLOTS; i++) {
      const g = gateOrder[i];
      const slot = gateGlow.value[i];
      if (!g) { slot.set(0, 0, 0, 0); continue; }
      /* The far end of the reach fades in rather than switching on, so a gate
         entering the fourth slot does not appear as a disc of light. */
      const near = 1 - Math.max(0, (riderZ - g.z) / TERRAIN.gateGlowReach);
      slot.set(g.x, g.z, g.half, TERRAIN.gateGlow
        * (g.taken ? 0.22 : 1) * (0.25 + 0.75 * near * near));
      gateTint.value[i].copy(g.warm ? gateWarm : gateCool);
    }
  }

  return {
    mesh,
    setSun,
    setGates,
    update,
    // Settles once both snow plates have finished arriving, one way or the
    // other. The loading read-out is its only consumer; nothing in the game
    // waits on it, because nothing in the game has to.
    surfacesReady,
    vertexCount: count,
    debug: () => ({
      anchorX, anchorY, anchorZ, morphing, morphAge,
      // What the four gate slots are lit with this frame — the only way to
      // tell a glow that is in the wrong place from one that is not there
      gates: gateGlow.value.map((g) => [
        +g.x.toFixed(1), +g.y.toFixed(1), +g.z.toFixed(1), +g.w.toFixed(2),
      ]),
      shade: {
        page: shadePageSamples,
        span: shadePageSpan,
        texel: +shadeSpacing.toFixed(2),
        directions: shadeDirections,
        slice: +shading.uniforms.uShadeSlice.value.toFixed(2),
        level: +sunLevel.toFixed(2),
        health: +shadeHealth.toFixed(2),
        center: [shadeCenterX, shadeCenterZ],
        pending: pendingShadeTiles.size,
      },
      building: build ? {
        stage: build.stage,
        row: build.row,
        rows: vertsZ,
      } : null,
    }),
  };
}
