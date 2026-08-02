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

import { snoise2, noise2, hash2 } from './noise.js';
import { TERRAIN, RENDER } from './config.js';

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
  scour: [5, 26],
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
  ice: '#b5cada',
  shade: '#a7bcd1',
  slate: ['#2c3646', '#7d8ba3'],
  iron: ['#443a41', '#948579'],
};

const { wander, route, corridor, wall, cliffs, knolls,
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
   every weather the game has: `RENDER.fogFar` is 420 m on the clearest day and
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
function wanderAt(z) {
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
  return corridorHalfAt(z) + wall.lipWidth * vary;
}

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
    lipW: 1,
    lipH: 0,
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
  mogulDetail = 1) {
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
  h += snoise2(ridgeX * ridges.freq, ridgeZ * ridges.freq, ridges.seed)
    * ridges.amp * mix[CH_RIDGES];
  h += snoise2(rollX * rolls.freq, rollZ * rolls.freq, rolls.seed)
    * rolls.amp * rollVary * mix[CH_ROLLS];
  /* The moguls, and their own patch field with them. Both leave together
     because the second exists only to modulate the first, so a cell too wide
     to resolve a twenty-metre wavelength stops paying for either — two of the
     eight noise lookups in this function, over most of the graded field. */
  if (mogulDetail > 0.001) {
    const mogulVary = bulgeVary.floor + (1 - bulgeVary.floor) * noise2(
      (x * 0.526 + z * 0.851) * bulgeVary.freq,
      (-x * 0.851 + z * 0.526) * bulgeVary.freq,
      bulgeVary.seed + 17,
    );
    h += snoise2(mogulX * moguls.freq, mogulZ * moguls.freq, moguls.seed)
      * moguls.amp * mogulVary * mix[CH_MOGULS] * mogulDetail;
  }
  /* Wind slab and soft sastrugi at the scale the board can actually cross.

     The coordinates are deliberately anisotropic: most of the variation is
     across the piste, while the same feature stretches far down it. That is
     how wind-shaped snow behaves, but it also matters technically. A random
     metre-scale normal map becomes a screen-frequency carpet at grazing
     angles; this is up to forty centimetres of continuous geometry with long,
     irregular streamers and no repeating carrier to alias against the display.
     Broad patch modulation keeps it out of the old procedural-wallpaper trap. */
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
    /* The odd quadratic term fattens the windward/lee shoulders without a
       cusp or a new noise sample. At full strength the pillows remain under
       forty centimetres combined, enough for the board and side light to read. */
    h += (coarseN * wc.amp + coarseN * Math.abs(coarseN) * wc.bulge)
      * windPatch * chatterMix * coarseDetail;
    /* The fine octave leaves the LOD before the coarse one does, so on most
       of the graded grid this block is entered for the coarse term alone —
       and the fine sample was being evaluated anyway and multiplied by zero.
       The guard uses the same threshold as the block's own gate, so wherever
       the mask is meaningfully nonzero the height is bit-identical. */
    if (fineDetail > 0.001) {
      h += snoise2(rotatedAcross * wf.acrossFreq, rotatedAlong * wf.alongFreq, wf.seed)
        * wf.amp * windPatch * chatterMix * fineDetail;
    }
  }

  /* Outside the corridor: the quarterpipe, then the wall.

     The lip is a smoothstep, so it leaves the piste concave — a transition
     you can ride up — and arrives at the top with zero gradient, which is a
     genuine convex rollover and the reason a rider who commits speed to it
     gets thrown rather than handed their speed back. Past it the wall takes
     over from zero gradient too, so the two meet without a crease. */
  let d;
  if (ctx.split > 0) {
    const d0 = Math.abs(x - (ctx.mid - ctx.split));
    const d1 = Math.abs(x - (ctx.mid + ctx.split));
    d = Math.min(d0, d1);
    /* The two ways sit at different heights, blended by inverse-square
       proximity rather than switched at the midpoint. Switching would put a
       vertical step down the middle of the island; weighting means each
       branch reaches its own elevation, the island between settles at the
       mean, and the surface is smooth everywhere — which it has to be,
       because the rider's normals are central differences of this and a step
       would fling them sideways for a frame. */
    if (ctx.tilt !== 0) {
      const w0 = 1 / (d0 * d0 + 25);
      const w1 = 1 / (d1 * d1 + 25);
      h += ctx.tilt * (w1 - w0) / (w0 + w1);
    }
  } else {
    d = Math.abs(x - ctx.mid);
  }
  const over = d - ctx.half;
  // Inside the groomed part, a shallow dish that gathers a drifting rider
  // back towards the fall line. It never pushes — at the corridor's edge it
  // is a slope of about a fifteenth — and being entirely lateral it costs
  // nothing against the budget the octaves are fighting over.
  if (over <= 0) {
    const u = d / Math.max(1, ctx.half);
    h += corridor.bowl * u * u;
  }
  if (over > 0) {
    h += corridor.bowl;
    h += ctx.lipH * smooth01(Math.min(1, over / ctx.lipW));
    const w = over - ctx.lipW;
    if (w > 0) {
      const u = w / wall.scale;
      h += wall.height * (1 - Math.exp(-u * u)) + wall.creep * w;
    }
  }

  /* The knolls. A squared dome — (1 − r²)² — which is one at the crest,
     zero at the rim, and flat at both, so a knoll joins the hill without a
     crease and has no edge anywhere on it. Overlapping ones simply add. */
  for (let i = 0; i < ctx.nKnolls; i++) {
    const dx = (x - ctx.kx[i]) / ctx.krx[i];
    if (dx <= -1 || dx >= 1) continue;
    const dz = ctx.kdz[i];
    const r2 = dx * dx + dz * dz;
    if (r2 >= 1) continue;
    const f = 1 - r2;
    h += ctx.kh[i] * f * f;
  }

  for (let i = 0; i < ctx.nCliffs; i++) {
    const ax = Math.abs(x - ctx.cliffX[i]);
    if (ax >= cliffs.halfWidth + cliffs.shoulder) continue;
    h -= ctx.cliffA[i]
      * (1 - smoothstep(cliffs.halfWidth, cliffs.halfWidth + cliffs.shoulder, ax));
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
  /* Two numbers about the snow at this vertex, in one attribute because they
     travel together and the second is not worth a buffer of its own: x is how
     far the pack has gone from powder towards névé, which sets the sheen's
     roughness, and y is how much of the sun reaches here at all once the
     mountain's own shape has been taken into account. See `TERRAIN.shade`. */
  const surface = new Float32Array(count * 2);
  const targetPositions = new Float32Array(count * 3);
  const targetNormals = new Float32Array(count * 3);
  const targetColors = new Float32Array(count * 3);
  const targetSurface = new Float32Array(count * 2);
  const morphMask = new Float32Array(count);
  const coarseDetailMask = new Float32Array(count);
  const fineDetailMask = new Float32Array(count);
  const mogulDetailMask = new Float32Array(count);
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
     in the colours and ice never travelling during a morph at all, and the
     range is kept because it is free and would tighten by itself if the mask
     ever did. */
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
     THE SUN'S SHADOW, marched over the height grid

     Two pieces. An axis lookup, because the lattice is graded and a ray that
     has travelled eleven metres has to be turned back into a place in it; and
     a coarse grid of horizon tests, because the answer is smooth and marching
     every vertex would cost sixteen times what marching every fourth does.
     ------------------------------------------------------------------------ */

  /* Local metres to a fractional index on one axis of the lattice.

     The offsets are bucketed at the finest cell size once, at construction,
     and never again, so this is a table read rather than the eight steps of a
     binary search. Inside the uniform near field a bucket is exactly one cell
     and the table is exact; out in the graded rings a cell spans many buckets,
     which is the same read. The `while` is the boundary case and runs at most
     once. `zs` descends and `xs` ascends, so the axis carries its own
     direction rather than every caller carrying two versions of each line. */
  function makeAxis(offsets) {
    const n = offsets.length;
    const first = offsets[0];
    const sign = offsets[n - 1] < first ? -1 : 1;
    const span = (offsets[n - 1] - first) * sign;
    const buckets = Math.max(2, Math.ceil(span / spacing) + 2);
    const cell = new Uint16Array(buckets);
    let k = 0;
    for (let b = 0; b < buckets; b++) {
      const v = first + sign * b * spacing;
      while (k + 2 < n && (offsets[k + 1] - v) * sign <= 0) k += 1;
      cell[b] = k;
    }
    return { offsets, n, first, sign, span, cell, buckets };
  }

  function axisAt(axis, v) {
    const u = (v - axis.first) * axis.sign;
    if (u <= 0) return 0;
    if (u >= axis.span) return axis.n - 1.0001;
    let b = (u / spacing) | 0;
    if (b >= axis.buckets) b = axis.buckets - 1;
    let k = axis.cell[b];
    const o = axis.offsets;
    while (k + 2 < axis.n && (o[k + 1] - v) * axis.sign <= 0) k += 1;
    const width = (o[k + 1] - o[k]) * axis.sign;
    return k + (width > 1e-9 ? ((v - o[k]) * axis.sign) / width : 0);
  }

  const xAxis = makeAxis(xs);
  const zAxis = makeAxis(zs);

  function gridHeight(fc, fr) {
    const c0 = fc | 0;
    const r0 = fr | 0;
    const c1 = c0 + 1 < vertsX ? c0 + 1 : c0;
    const r1 = r0 + 1 < vertsZ ? r0 + 1 : r0;
    const tc = fc - c0;
    const tr = fr - r0;
    const a = r0 * vertsX;
    const b = r1 * vertsX;
    const lo = heights[a + c0] + (heights[a + c1] - heights[a + c0]) * tc;
    const hi = heights[b + c0] + (heights[b + c1] - heights[b + c0]) * tc;
    return lo + (hi - lo) * tr;
  }

  /* Which vertices are inside the window at all, resolved once as index
     bounds. Everything outside is fully lit and costs nothing — the same
     bargain the depth map struck by simply not reaching that far.
     `shadeStride` is spelt out because `stride` further down this file is the
     anchor's, and the two are unrelated numbers. */
  const shadeStride = SHADE.stride;
  let shadeC0 = vertsX - 1;
  let shadeC1 = 0;
  let shadeR0 = vertsZ - 1;
  let shadeR1 = 0;
  for (let c = 0; c < vertsX; c++) {
    if (Math.abs(xs[c]) > SHADE.window[0]) continue;
    if (c < shadeC0) shadeC0 = c;
    if (c > shadeC1) shadeC1 = c;
  }
  for (let r = 0; r < vertsZ; r++) {
    // zs is positive behind the rider and negative ahead of them
    if (zs[r] > SHADE.window[2] || zs[r] < -SHADE.window[1]) continue;
    if (r < shadeR0) shadeR0 = r;
    if (r > shadeR1) shadeR1 = r;
  }
  const shadeCols = Math.max(2, Math.ceil((shadeC1 - shadeC0) / shadeStride) + 1);
  const shadeRows = Math.max(2, Math.ceil((shadeR1 - shadeR0) / shadeStride) + 1);
  const shadeGrid = new Float32Array(shadeCols * shadeRows);
  shadeGrid.fill(1);

  // The ray's sample distances, geometric so the near field — where a lip or
  // a knoll rim actually cuts the light — is resolved finely and the far half
  // of the reach costs three samples rather than thirty.
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

  // Where the sun was when the live grid was marched, and where it is now.
  let sunX = 0.6;
  let sunY = 0.7;
  let sunZ = -0.4;
  let sunLevel = 1;
  let builtSunX = NaN;
  let builtSunY = NaN;
  let builtSunZ = NaN;
  let buildSunX = sunX;
  let buildSunY = sunY;
  let buildSunZ = sunZ;

  /* Where every ray's k-th sample lands, resolved once per build rather than
     once per sample. The march direction is the same everywhere, so the x of
     a sample depends only on which column it started from and the z only on
     which row — a separable pair of tables, sixteen hundred lookups instead
     of a hundred thousand, and the inner loop left with nothing in it but
     four array reads. */
  const shadeFc = new Float32Array(shadeCols * SHADE.steps);
  const shadeFr = new Float32Array(shadeRows * SHADE.steps);

  function buildShadeGrid() {
    builtSunX = buildSunX;
    builtSunY = buildSunY;
    builtSunZ = buildSunZ;
    const flat = Math.hypot(buildSunX, buildSunZ);
    // A sun straight overhead — and a sun under the horizon, which the level
    // has already faded out — throws nothing worth marching for.
    if (flat < 1e-3 || buildSunY <= 0.01) {
      shadeGrid.fill(1);
      return;
    }
    const steps = SHADE.steps;
    const dx = buildSunX / flat;
    const dz = buildSunZ / flat;
    const climb = buildSunY / flat;
    const invSoft = 1 / SHADE.soften;

    for (let ci = 0; ci < shadeCols; ci++) {
      const lx = xs[Math.min(shadeC1, shadeC0 + ci * shadeStride)];
      for (let k = 0; k < steps; k++) {
        shadeFc[ci * steps + k] = axisAt(xAxis, lx + dx * shadeStep[k]);
      }
    }
    for (let ri = 0; ri < shadeRows; ri++) {
      const lz = zs[Math.min(shadeR1, shadeR0 + ri * shadeStride)];
      for (let k = 0; k < steps; k++) {
        shadeFr[ri * steps + k] = axisAt(zAxis, lz + dz * shadeStep[k]);
      }
    }

    let g = 0;
    for (let ri = 0; ri < shadeRows; ri++) {
      const r = Math.min(shadeR1, shadeR0 + ri * shadeStride);
      const row = r * vertsX;
      const rBase = ri * steps;
      for (let ci = 0; ci < shadeCols; ci++, g++) {
        const c = Math.min(shadeC1, shadeC0 + ci * shadeStride);
        const h = heights[row + c];
        const cBase = ci * steps;
        let worst = 0;
        for (let k = 0; k < steps; k++) {
          const rise = gridHeight(shadeFc[cBase + k], shadeFr[rBase + k])
            - (h + climb * shadeStep[k]);
          if (rise > worst) worst = rise;
        }
        // Soft, because the sun is half a degree wide and because a hard edge
        // sampled every fourth vertex would show the sampling.
        const t = worst * invSoft;
        shadeGrid[g] = t <= 0 ? 1 : t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
      }
    }
  }

  /* Read the coarse grid back at a vertex. `shadeStride` is a whole number of
     lattice steps, so the bracket is arithmetic rather than a search. */
  function shadeAt(r, c) {
    if (r < shadeR0 || r > shadeR1 || c < shadeC0 || c > shadeC1) return 1;
    const uc = (c - shadeC0) / shadeStride;
    const ur = (r - shadeR0) / shadeStride;
    let ci = uc | 0;
    let ri = ur | 0;
    if (ci > shadeCols - 2) ci = shadeCols - 2;
    if (ri > shadeRows - 2) ri = shadeRows - 2;
    const tc = uc - ci;
    const tr = ur - ri;
    const a = ri * shadeCols + ci;
    const b = a + shadeCols;
    const lo = shadeGrid[a] + (shadeGrid[a + 1] - shadeGrid[a]) * tc;
    const hi = shadeGrid[b] + (shadeGrid[b + 1] - shadeGrid[b]) * tc;
    return lo + (hi - lo) * tr;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSmoothNormal',
    new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color',
    new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSurface',
    new THREE.BufferAttribute(surface, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // The corner of the grid, not its longest side. `ahead` alone was already
  // short of the far columns and is now short of the tail as well; the mesh is
  // never frustum-culled so nothing was reading it, but a bounding volume that
  // does not bound is a trap left for whoever turns culling back on.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(), Math.hypot(side, Math.max(ahead, behind)),
  );

  /* The generated powder plate, packed as data rather than as baked light.

     R is albedo variation centred at one half, G is height centred at one
     half and B is crystalline density. The terrain has no UVs by design, so
     it is sampled from stable world XZ below. A neutral one-pixel texture
     keeps the material identical to the procedural fallback while WebP is
     loading, or forever if an asset cannot be fetched. */
  const neutralSurface = new THREE.DataTexture(
    new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat,
  );
  neutralSurface.colorSpace = THREE.NoColorSpace;
  neutralSurface.needsUpdate = true;

  const powderSurface = { value: neutralSurface };
  const snowReady = { value: new THREE.Vector2() };
  const snowReadyTarget = new THREE.Vector2();
  // Only a deliberately low-passed macro version of the powder plate reaches
  // the albedo. Fine generated crystals and groomer ribs were fully resolved
  // near the camera but formed interference when the frame was displayed or
  // captured at another scale. The broad 24 m field (x) keeps irregular snow
  // tone without placing a screen-frequency carrier under the rider. The 4 m
  // tile (y) feeds only the low-bias height reads behind the fragment detail
  // normal below, which carries its own distance and derivative fades.
  const snowTile = { value: new THREE.Vector2(24.0, 4.0) };
  const snowAlbedo = { value: new THREE.Vector2(0.012, 0.0) };
  const snowHeight = { value: new THREE.Vector2(0.0, 0.0) };

  const prepareSurface = (texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
    // The piste is normally viewed at a very shallow angle. Use the full
    // hardware anisotropy budget so the generated snow maps collapse through
    // their mip chain along the fall line instead of forming distant bands.
    texture.anisotropy = maxAnisotropy;
    texture.generateMipmaps = true;
    return texture;
  };
  const surfaceLoader = new THREE.TextureLoader();
  surfaceLoader.load(
    new URL('../assets/textures/snow/powder-surface.webp', import.meta.url).href,
    (texture) => {
      powderSurface.value = prepareSurface(texture);
      snowReadyTarget.x = 1;
    },
  );

  /* Surface detail, in the fragment shader rather than in the mesh.

     A snowfield at these cell sizes is geometrically smooth and visually
     blank, and a blank ground is the one thing that will not sell speed: the
     eye reads velocity from texture passing underneath, and there was none.
     It cannot come from a repeated rib pattern: anything fine enough to read
     as groomer corduroy at the board aliases as the piste recedes.

     It is sampled in stable world coordinates so it remains welded to the
     ground, but four positive mip levels remove crystal-, rib- and texel-scale
     structure before it reaches the screen. A derivative gate then gives the
     remaining broad tone up before even that footprint becomes undersampled.
     Geometry, tracks, spray and the broad snow sheen carry the speed cues. */
  /* The graded grid has cells tens of metres wide at the fog curtain. A flat
     normal per triangle exposes that shipping topology as a row of enormous
     light and dark wedges. The colour shader therefore uses the continuous
     height-field normal below. `flatShading` deliberately stays enabled so
     three's separate depth/shadow shader keeps its old no-normal path: adding
     the built-in `normal` attribute would also move every terrain shadow
     lookup by the sun light's receiver normalBias. */
  /* How much of the precomputed terrain shadow is actually spent. It follows
     the depth map's own fade exactly — `sky.js` owns that number and hands it
     over — so the mountain's shadow of itself arrives and leaves on the same
     dusk and in the same whiteout as every shadow the map still draws, and
     the two can never disagree about whether it is dark enough for shadows. */
  const shadeLevel = { value: 1 };

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uSnowPowder: powderSurface,
      uSnowReady: snowReady,
      uSnowTile: snowTile,
      uSnowAlbedo: snowAlbedo,
      uShadeLevel: shadeLevel,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aSmoothNormal;
        attribute vec2 aSurface;
        varying vec3 vWorld;
        varying vec3 vSmoothNormal;
        varying float vDist;
        varying float vTerrainShade;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vSmoothNormal = normalize(normalMatrix * aSmoothNormal);
        vN64Ice = aSurface.x;
        vTerrainShade = aSurface.y;
        vDist = -mvPosition.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorld;
        varying vec3 vSmoothNormal;
        varying float vDist;
        varying float vTerrainShade;
        uniform sampler2D uSnowPowder;
        uniform vec2 uSnowReady;
        uniform vec2 uSnowTile;
        uniform vec2 uSnowAlbedo;
        uniform float uShadeLevel;`)
      /* The mountain's own shadow, spent between the direct accumulation and
         the indirect one — which is exactly what `lights_fragment_maps` sits
         between in the Lambert program. Only the sun is removed; the sky fill
         still reaches a shaded hollow, which is what makes snow in shade blue
         rather than black, and it is the same split a real cast shadow makes.

         It has to happen here rather than after `lights_fragment_end`,
         because the shared shading patch hangs off that anchor and recovers
         the shadow term by dividing the accumulated direct light back out.
         Attenuating first is therefore not merely tidier: it is what puts the
         snow's sheen, its glints and its reflected sun into the same shadow
         as its diffuse, without either side knowing the other exists. */
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        reflectedLight.directDiffuse *= mix(1.0, vTerrainShade, uShadeLevel);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n64SnowMask = smoothstep(0.42, 0.62,
          dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
        vec2 powderUv = mat2(0.9563, -0.2924, 0.2924, 0.9563)
          * (vWorld.xz / uSnowTile.x);
        float macroFootprint = max(fwidth(powderUv.x), fwidth(powderUv.y)) * 32.0;
        float macroResolve = 1.0 - smoothstep(0.35, 0.80, macroFootprint);
        float n64SurfaceFade = uSnowReady.x * macroResolve
          * (1.0 - smoothstep(80.0, 180.0, vDist)) * n64SnowMask;
        // The fetch is now inside its own fade rather than beside it. Past a
        // hundred and eighty metres — and on every rock face at any range —
        // the read was being multiplied by zero, and a texture fetch costs
        // the same whatever it is multiplied by. Distance is monotonic and
        // the snow/rock split is a broad vertex field, so the branch is
        // coherent across a warp instead of splitting one.
        if (n64SurfaceFade > 0.002) {
          // Explicit positive LOD bias keeps only the plate's macro structure.
          vec4 n64Surface = texture2D(uSnowPowder, powderUv, 4.0);
          diffuseColor.rgb *= 1.0 + (n64Surface.r - 0.5) * 2.0
            * uSnowAlbedo.x * n64SurfaceFade;
        }
        // Bedded strata where the snow has run out. The vertex pass already
        // decided which stone a cliff is made of; what it cannot say at one
        // sample per 75 cm is that rock is laid down in beds. Height plus a
        // slight horizontal shear gives the bedding plane, two sines give a
        // bed and its grain, and the coordinate wraps at 64 m with both
        // frequencies periodic across the wrap (2pi*13/64 and 2pi*40/64) —
        // the same trick n64Hash uses to keep operands mediump-honest.
        // …and most of the mountain is snow, so the whole block sits behind
        // the mask that was already scaling its result to nothing.
        if (n64SnowMask < 0.998) {
          float n64StrataC = vWorld.y + vWorld.x * 0.22 + vWorld.z * 0.11;
          float n64StrataFoot = fwidth(n64StrataC);
          float n64StrataW = mod(n64StrataC, 64.0);
          // Only faces steep enough to have shed their snow show their beds —
          // the up axis is the view matrix's second column, which is world up
          // in the space vSmoothNormal already lives in. Each frequency then
          // dissolves before its own period can approach the pixel: this game
          // has been burned by resampled near-pixel patterns before, so the
          // fades are the load-bearing part and not a nicety.
          float n64StrataUp = dot(normalize(vSmoothNormal), viewMatrix[1].xyz);
          float n64Beds = sin(n64StrataW * 1.276272)
              * (1.0 - smoothstep(1.4, 3.5, n64StrataFoot))
            + sin(n64StrataW * 3.926991) * 0.7
              * (1.0 - smoothstep(0.30, 0.90, n64StrataFoot));
          diffuseColor.rgb *= 1.0 - smoothstep(0.1, 0.9, n64Beds) * 0.11
            * (1.0 - n64SnowMask) * smoothstep(0.30, 0.72, 1.0 - n64StrataUp);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Hide the graded grid's triangle topology from lighting while leaving
        // its actual geometry, depth and shadow coordinates untouched.
        normal = normalize(vSmoothNormal);
        // The powder plate's height channel, spent as light rather than as
        // geometry. Two nine-centimetre world differences of G make a slope,
        // and the slope leans the smooth normal — sastrugi micro-shading at a
        // scale the 75 cm mesh cannot carry. These reads sit at a low mip
        // bias, unlike the +4 albedo read above, precisely so the real
        // crystal and dune structure survives to be differenced.
        vec2 n64DetailUv = mat2(0.9563, -0.2924, 0.2924, 0.9563)
          * (vWorld.xz / uSnowTile.y);
        float n64DetailStep = 0.09 / uSnowTile.y;
        // The macro fade above lets go at 80-180 m, far too late for detail
        // this fine. Distance takes it out across 55-90 m, and the derivative
        // gate takes it out sooner wherever a grazing angle stretches one
        // pixel's footprint towards the differencing step itself — past that
        // point the slope is sampling noise, and the retro pipeline would
        // resample it into shimmer. The gate is the anti-moire clause.
        float n64DetailFoot = max(fwidth(n64DetailUv.x), fwidth(n64DetailUv.y));
        float n64DetailFade = uSnowReady.x * n64SnowMask
          * (1.0 - smoothstep(55.0, 90.0, vDist))
          * (1.0 - smoothstep(0.5, 1.0, n64DetailFoot / n64DetailStep));
        // Three fetches, and they are the most expensive thing this material
        // does per pixel — so they now live inside the fade that was already
        // deciding whether their result counted. The gate closes at ninety
        // metres, which on a run looking down its own fall line is most of
        // the frame, and closes immediately on rock and at grazing angles.
        if (n64DetailFade > 0.002) {
          float n64DetailC = texture2D(uSnowPowder, n64DetailUv, 1.0).g;
          float n64DetailX = texture2D(uSnowPowder,
            n64DetailUv + vec2(0.9563, -0.2924) * n64DetailStep, 1.0).g;
          float n64DetailZ = texture2D(uSnowPowder,
            n64DetailUv + vec2(0.2924, 0.9563) * n64DetailStep, 1.0).g;
          // A heightfield's normal is (-dh/dx, 1, -dh/dz); the lean is built
          // in the world frame the offsets were taken in, then rotated through
          // the view matrix to join the view-space normal. The gain is
          // deliberately shy of embossing — the plate reads as shading, not
          // as relief.
          normal = normalize(normal + mat3(viewMatrix)
            * vec3(n64DetailC - n64DetailX, 0.0, n64DetailC - n64DetailZ)
            * (0.85 * n64DetailFade));
        }`);
  };
  /* Keep direction-aware atmospheric fog and continuous Lambert response,
     then add the analytic snow/ice microfacet reflection that nothing else on
     the mountain receives. */
  shading.apply(material, { sheen: 1 });
  material.userData.snowSurfaces = {
    powder: powderSurface,
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
     horizon march at the head of this function, one float per vertex, folded
     into the light loop above. The depth map now holds only the things that
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
          mogulDetailMask[i],
        );
      }
    }
  }

  function fillSurfaceRows(
    ax, az, ay, outPositions, outNormals, outColors, outSurface,
    rowFrom, rowTo,
  ) {
    let i = rowFrom * vertsX;
    let p = i * 3;
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
      // behind a curtain that closes at four hundred and twenty. Squared, so
      // the row's own share is one compare and no root.
      const lzSq = lz * lz;

      /* Vertices past `FOG_ROW_SKIP` are behind a closed curtain in every
         weather, so the snowpack's whole materials pass — two band octaves,
         the mottle, the aspect, the groom — would be deciding colours nobody
         can see. Heights stay exact because the skyline is the one thing fog
         leaves, and the central-difference normal is kept because it is a
         handful of arithmetic and it is what lights that skyline. The colour
         is the deep-snow stop and the ice is zero, which is also what the
         real pass converges to under a kilometre of altitude anyway. */
      if (lzSq >= FOG_SKIP_SQ) {
        for (let c = 0; c < vertsX; c++, i++, p += 3) {
          const h = heights[i];
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
          outColors[p] = cDeep[0];
          outColors[p + 1] = cDeep[1];
          outColors[p + 2] = cDeep[2];
          outSurface[i * 2] = 0;
          outSurface[i * 2 + 1] = 1;
        }
        continue;
      }

      rowContext(wz, ctx);
      const grade = gradeAt(wz);

      /* Altitude, and it is free. `ctx.base` is the grade's own integral,
         which is exactly how far below the top of the run this row lies, and
         the row context has already worked it out. Everything downhill of the
         snow line's lower stop reads one, so past about five kilometres of
         riding the altitude term has said all it has to say and the bands and
         the relief carry the mountain on their own. */
      const alt = smoothstep(P.snowLine[0], P.snowLine[1], -ctx.base);
      const rowCover = P.base + P.altitude * alt;
      const bandZ = wz * P.band.freq;

      for (let c = 0; c < vertsX; c++, i++, p += 3) {
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
          outColors[p] = cDeep[0];
          outColors[p + 1] = cDeep[1];
          outColors[p + 2] = cDeep[2];
          outSurface[i * 2] = 0;
          outSurface[i * 2 + 1] = 1;
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
        const groomed = 1 - smoothstep(ctx.half + 1, ctx.half + 4, toCentre);

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
          + P.groomed * groomed);

        /* Rock, which is not a separate decision from the snow — it is where
           the snow ran out. Two ways for that to happen: the ground got too
           steep to hold what little it had, and the ground had nothing to
           hold in the first place. The first threshold slides with the cover,
           because thin snow slides off slopes deep snow sits on quite
           happily, and that is one phenomenon and so it is one term. */
        const slip = P.slip[0] + P.hold * cover;
        const steepRock = smoothstep(slip, slip + (P.slip[1] - P.slip[0]), steep);
        const thinRock = smoothstep(P.thin[0], P.thin[1], cover);
        const rock = steepRock > thinRock ? steepRock : thinRock;

        /* Snow, along the axis of what it has been through rather than of how
           bright it is. Deep cover is soft and pale; thin cover is what the
           wind left, which is névé, which is ice, which is blue. Then a
           lift towards the shade stop for the broad wind-packed patches and
           for faces turned away from where the sun goes — snow lying in the
           mountain's own shadow is the bluest thing on it. */
        const icy = 1 - smoothstep(P.pack[0], P.pack[1], cover);
        const dim = noise2(wx * 0.02, wz * 0.02, 7) * 0.26
          + (face < 0 ? -face : 0) * 0.32;
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

        if (rock > 0.002) {
          /* Rock catches the light along its ridges and holds none of it in
             the clefts, which is most of what makes a cliff read as rock.

             And which rock is the band's decision, so a stretch of mountain
             is made of one stone all the way through instead of every cliff
             on the hill being the same grey. That was the complaint that is
             hardest to argue with: a single stone colour makes a hundred
             separate cliffs read as one repeated asset. */
          const mottle = noise2(wx * 0.16, wz * 0.16, 11);
          const kind = smoothstep(0.34, 0.72, band);
          const d0 = cSlate[0], d1 = cSlate[1], w0 = cIron[0], w1 = cIron[1];
          const lo0 = d0[0] + (w0[0] - d0[0]) * kind;
          const lo1 = d0[1] + (w0[1] - d0[1]) * kind;
          const lo2 = d0[2] + (w0[2] - d0[2]) * kind;
          const hi0 = d1[0] + (w1[0] - d1[0]) * kind;
          const hi1 = d1[1] + (w1[1] - d1[1]) * kind;
          const hi2 = d1[2] + (w1[2] - d1[2]) * kind;
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
        outSurface[i * 2] = clamp01(0.16 + icy * 0.78 + groomed * 0.16)
          * (1 - rock) * reliefReflect;
        // …and the sun the mountain's own shape has or has not left here,
        // read back off the coarse horizon grid marched before this pass.
        outSurface[i * 2 + 1] = shadeAt(r, c);

        outColors[p] = cr;
        outColors[p + 1] = cg;
        outColors[p + 2] = cb;
      }
    }
  }

  function fill(ax, az, ay, outPositions, outNormals, outColors, outSurface) {
    fillHeightRows(ax, az, 0, vertsZ);
    // The horizon march needs the whole height grid, so it sits between the
    // two passes rather than inside either — see `advanceBuild` for the same
    // ordering spread across frames.
    buildShadeGrid();
    fillSurfaceRows(
      ax, az, ay, outPositions, outNormals, outColors, outSurface,
      0, vertsZ,
    );
  }

  function publish() {
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aSmoothNormal.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.aSurface.needsUpdate = true;
  }

  /* The morphing frames' upload. Colours and the surface pair do not travel
     here at all —
     they snapped once at commit — and position and normal carry the covering
     range of the masked set. That range reaches both ends of the buffer today
     (the masked set is the outside of a disc), so its honest job is to keep
     this correct rather than to shrink the transfer; the transfer shrank by
     the two attributes that stopped being flagged. */
  function publishMorph() {
    const pos = geometry.attributes.position;
    const nrm = geometry.attributes.aSmoothNormal;
    pos.addUpdateRange(morphLo * 3, morphSpan * 3);
    nrm.addUpdateRange(morphLo * 3, morphSpan * 3);
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
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
      }
      /* Colour and ice snap on this same frame instead of gliding. Their
         crossfade lived 72–240 m out, behind a fog that starts at 105, and
         paid four floats of lerp per vertex per morphing frame plus two
         full-buffer uploads to hide a change the haze was already hiding.
         They must not snap at commit: commit's frame still renders the
         preserved old-world positions, and new colours on old geometry put
         a one-frame tint seam through the near disc every re-anchor. */
      colors.set(targetColors);
      surface.set(targetSurface);
      geometry.attributes.color.needsUpdate = true;
      geometry.attributes.aSurface.needsUpdate = true;
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
    }

    if (morphAge >= morphSettle) {
      positions.set(targetPositions);
      normals.set(targetNormals);
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
     every target receives the same three complete passes.

     The middle one — the sun's horizon march — cannot be split by row, because
     a ray leaving one row lands in another and needs the whole height grid to
     be finished. It does not have to be: it runs on every fourth vertex of a
     window a fraction of the mesh's size, which is a couple of milliseconds
     against the forty the other two spend between them. So it happens in one
     go, at the turn between the passes, inside the same frame budget. */
  const BUILD_BUDGET_MS = 4.0;
  const BUILD_BATCH_ROWS = 8;
  let build = null;
  const clockNow = () => (globalThis.performance?.now?.() ?? Date.now());

  function beginBuild(ax, az, ay) {
    // target arrays are the back buffer. Freeze any previous convergence at
    // its current live values before those arrays are reused row by row.
    morphing = false;
    // The sun is pinned for the whole of a build. Letting it move between the
    // march and the surface pass would light half the target from one moment
    // and half from the next, and the seam would run across the picture.
    buildSunX = sunX;
    buildSunY = sunY;
    buildSunZ = sunZ;
    build = { ax, az, ay, stage: 0, row: 0 };
  }

  function commitBuild(next) {
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
    publish();
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
          targetPositions, targetNormals, targetColors, targetSurface,
          build.row, rowTo,
        );
      }
      build.row = rowTo;

      if (build.row >= vertsZ) {
        if (build.stage === 0) {
          buildShadeGrid();
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
    const ax = Math.round(x / stride) * stride;
    const az = Math.round(z / stride) * stride;

    const ay = heightAt(ax, az);
    if (!Number.isFinite(anchorX)) {
      anchorX = ax;
      anchorZ = az;
      anchorY = ay;
      mesh.position.set(ax, ay, az);
      fill(ax, az, ay, positions, normals, colors, surface);
      publish();
      return;
    }

    if (build) {
      advanceBuild();
      return;
    }
    if (ax === anchorX && az === anchorZ) {
      /* The anchor has not moved, but the sun has. A run's day is three
         minutes long, so a rider who stops — at a hut, on a lip, waiting out
         a storm — would otherwise watch the mountain's shadow of itself
         freeze where it was while every other shadow in the frame carried on
         swinging. A build at the same anchor is free of visual risk: the
         positions it produces are the ones already on screen, so the morph
         that follows converges on to what it started from and only the shade
         and the colours actually change. */
      if (Number.isFinite(builtSunX)) {
        const moved = Math.abs(sunX - builtSunX) + Math.abs(sunY - builtSunY)
          + Math.abs(sunZ - builtSunZ);
        if (moved > SHADE.sunStep && sunLevel > 0.002) {
          beginBuild(ax, az, ay);
          advanceBuild();
        }
      }
      return;
    }

    beginBuild(ax, az, ay);
    advanceBuild();
  }

  /* Where the sun is, and how much of its shadow is being spent. `main.js`
     hands both over once a frame from the shared shading block and from the
     sky's own fade, so the mountain's precomputed shadow arrives and leaves
     on exactly the same dusk as the depth map's. */
  function setSun(dirX, dirY, dirZ, level) {
    sunX = dirX;
    sunY = dirY;
    sunZ = dirZ;
    sunLevel = level;
    shadeLevel.value = level;
  }

  return {
    mesh,
    setSun,
    update,
    vertexCount: count,
    debug: () => ({
      anchorX, anchorY, anchorZ, morphing, morphAge,
      shade: [shadeCols, shadeRows, +shadeLevel.value.toFixed(2)],
      building: build ? { stage: build.stage, row: build.row, rows: vertsZ } : null,
    }),
  };
}
