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
import { TERRAIN } from './config.js';

/* How much harder the snow glitters inside the specular lobe than outside it.

   Strictly it multiplies a glint's *brightness*, not how many there are —
   about one lattice cell in seventy is allowed to hold one and this does not
   change that. It reads as density anyway, and that is the point: a glint is
   already a hair above the threshold at which the eye finds it, so brighten
   the ones inside the lobe and dim ones elsewhere drop below the line and
   stop counting. Two and a half times, at the peak of the lobe.

   Zero would be the old behaviour — an even scatter over every lit surface,
   which is what made them read as dust on the lens rather than as something
   the ground is doing. It lives here rather than in `shading.js` because the
   lobe belongs to the light model and the glitter belongs to the mountain,
   and this is the one number that joins them. */
export const GLITTER_AIM = 1.5;

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
  scour: [7, 34],
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
  altitude: 0.40,
  bandWeight: 0.22,
  crestWeight: 0.17,
  scourWeight: 0.44,
  driftWeight: 0.16,
  aspectWeight: 0.24,
  shadeWeight: 0.10,
  groomed: 0.30,

  /* Where snow lets go of a slope. `slip` is the steepness it starts and
     finishes letting go at with no cover at all, and `hold` is how much
     steeper it can be before letting go when the cover is full — so thin snow
     slides off ground that deep snow sits on quite happily, which is one term
     rather than two because it is one phenomenon. `thin` is the other way in:
     ground with nearly no cover shows stone however flat it is lying. */
  slip: [0.30, 0.86],
  hold: 0.46,
  thin: [0.26, 0.02],

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
  deep: '#d0e0f4',
  ice: '#a7c9e2',
  shade: '#93b3d8',
  slate: ['#333d4f', '#6b7a92'],
  iron: ['#4b4249', '#877a79'],
};

const { wander, route, corridor, wall, cliffs, knolls,
  ridges, rolls, moguls, chatter, warp, bulgeVary } = TERRAIN;
const GRADE = TERRAIN.grade;

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
  };
}

function rowContext(z, ctx) {
  if (ctx.z === z) return ctx;
  ctx.z = z;

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
  const k0 = Math.floor(-z / knolls.period);
  for (let k = -3; k <= 3 && ctx.nKnolls < 4; k++) {
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
    const rise = knolls.rise[0] + (knolls.rise[1] - knolls.rise[0]) * hash2(b, 331, 85);
    const height = rise * rz;
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

function heightIn(ctx, x) {
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
  const chatterX = x * 0.906 + z * 0.423;
  const chatterZ = -x * 0.423 + z * 0.906;

  /* Rough and quiet snow now forms broad patches instead of full-width bands
     across the piste. Rolls and moguls use independent masks so a calm roller
     does not automatically erase every smaller feature around it. */
  const rollVary = bulgeVary.floor + (1 - bulgeVary.floor) * noise2(
    (x * 0.731 - z * 0.682) * bulgeVary.freq,
    (x * 0.682 + z * 0.731) * bulgeVary.freq,
    bulgeVary.seed,
  );
  const mogulVary = bulgeVary.floor + (1 - bulgeVary.floor) * noise2(
    (x * 0.526 + z * 0.851) * bulgeVary.freq,
    (-x * 0.851 + z * 0.526) * bulgeVary.freq,
    bulgeVary.seed + 17,
  );

  h += snoise2(ridgeX * ridges.freq, ridgeZ * ridges.freq, ridges.seed) * ridges.amp;
  h += snoise2(rollX * rolls.freq, rollZ * rolls.freq, rolls.seed) * rolls.amp * rollVary;
  h += snoise2(mogulX * moguls.freq, mogulZ * moguls.freq, moguls.seed) * moguls.amp * mogulVary;
  h += snoise2(chatterX * chatter.freq, chatterZ * chatter.freq, chatter.seed) * chatter.amp;

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

export function createTerrain(THREE, shading) {
  const {
    spacing, uniformNear, back, ahead, aheadGrowth, side, sideGrowth,
    morphNear, morphFar, morphRate, morphSettle,
  } = TERRAIN;

  // Columns: mirrored about the rider. Rows: a few uniform cells behind,
  // then the graded fan out in front.
  const half = graded(spacing, sideGrowth, side, uniformNear);
  const xs = [];
  for (let i = half.length - 1; i >= 1; i--) xs.push(-half[i]);
  for (let i = 0; i < half.length; i++) xs.push(half[i]);

  const zs = [];
  for (let d = back; d > 0; d -= spacing) zs.push(d);
  const fwd = graded(spacing, aheadGrowth, ahead, uniformNear);
  for (let i = 0; i < fwd.length; i++) zs.push(-fwd[i]);

  const vertsX = xs.length;
  const vertsZ = zs.length;
  const cols = vertsX - 1;
  const rows = vertsZ - 1;
  const count = vertsX * vertsZ;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const groom = new Float32Array(count);
  const targetPositions = new Float32Array(count * 3);
  const targetColors = new Float32Array(count * 3);
  const targetGroom = new Float32Array(count);
  const morphMask = new Float32Array(count);
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
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color',
    new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aGroom',
    new THREE.BufferAttribute(groom, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), ahead);

  /* Surface detail, in the fragment shader rather than in the mesh.

     A snowfield at these cell sizes is geometrically smooth and visually
     blank, and a blank ground is the one thing that will not sell speed: the
     eye reads velocity from texture passing underneath, and there was none.
     It cannot come from the grid — corduroy is a metre and a half apart and
     so are the vertices, so anything fine enough to work aliases before it
     is drawn.

     So it is painted per pixel, from world coordinates, which means it is
     welded to the ground and rushes at the rider at exactly the speed the
     rider is doing. Three layers: the groomer's ribs running across the fall
     line, broad wind packing along it, and a hash of grain to break up the
     flats.

     Each layer is faded out by how much ground a pixel is covering rather
     than by distance alone, and that is not a refinement — it is the whole
     reason the ground is legible. A rib every metre and a half seen down a
     slope at a grazing angle is compressed into almost nothing in screen
     space long before it is far away, and sampling it once per pixel with
     no mip chain beats against the pixel grid and throws broad moiré bands
     right across the hill. At 288 lines this was invisible because
     everything was; at native resolution it was the first thing you saw.
     `fwidth` says exactly how many metres a pixel spans here, so each layer
     can be taken out the moment its period approaches that. */
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aGroom;
        varying vec3 vWorld;
        varying float vDist;
        varying float vGroom;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vDist = -mvPosition.z;
        vGroom = aGroom;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorld;
        varying float vDist;
        varying float vGroom;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float detail = 1.0 - smoothstep(140.0, 320.0, vDist);
        if (detail > 0.002) {
          // Metres of ground this pixel covers, which on a slope seen at a
          // grazing angle is far larger than the distance alone implies
          float px = max(fwidth(vWorld.x), fwidth(vWorld.z));
          float ribFade = 1.0 - smoothstep(0.26, 0.72, px);      // period 1.53 m
          float grainFade = 1.0 - smoothstep(0.10, 0.26, px);    // cells of 0.43 m
          float rib = sin(vWorld.z * 4.1) * ribFade * smoothstep(0.08, 0.82, vGroom);
          float pack = sin(vWorld.x * 0.55 + vWorld.z * 0.07);   // metres wide, never aliases
          float grain = fract(sin(dot(floor(vWorld.xz * 2.3), vec2(12.9898, 78.233))) * 43758.545);
          float d = rib * 0.055 + pack * 0.035 + (grain - 0.5) * 0.07 * grainFade;
          diffuseColor.rgb *= 1.0 + d * detail;
        }`)
      /* Glitter.

         Snow is made of flat crystals lying at every angle, and a tiny
         fraction of them are, from where you happen to be standing, aimed
         exactly right — so a snowfield in sun is not white, it is white with
         a scatter of points brighter than anything else outdoors, and they
         come and go as you move because it is a different fraction of
         crystals every step. It is the single most recognisable thing about
         real snow and the thing every white-render-with-a-blue-tint misses.

         One in seventy lattice cells is allowed to hold one, and whether it
         is lit depends on the view direction, so they twinkle as the run
         goes past rather than sitting there like dirt. It is added after the
         lighting and before the fog, and scaled by how bright the pixel
         already was — snow in shadow has nothing to catch — so a glint is
         something the sun is doing rather than something the ground is.

         Two things about it changed when the snow got a specular response,
         and both are the same correction: a glint had been an effect of its
         own and is really the sharp end of the broad one.

         It is the sun's colour now, not a fixed cold white. A glint is the
         disc of the sun seen in a mirror a hundred microns across, so it can
         only ever be the colour the sun is — amber at golden hour and blue
         at dusk, and never the near-white it used to be, which was the one
         thing on this mountain quietly breaking the rule that snow is warm
         only where a low sun lands on it.

         And it clusters in the sheen. `n64Spec` is how hard this pixel sits
         in `shading.js`'s specular lobe, and the two effects are the same
         crystals at two scales — the sheen is the average over a great many
         faces aimed roughly at the sun, a glint is one face aimed exactly at
         it — so glints ought to be strongest where the sheen is, and they now
         are. See `GLITTER_AIM`. It is written as a multiplier over one rather
         than as a mask under it, so a material with no sheen compiled in
         reads the initialiser, gets 1.0, and glitters exactly as it did. */
      .replace('#include <fog_fragment>', `
        {
          float sparkPx = max(fwidth(vWorld.x), fwidth(vWorld.z));
          float sparkFade = (1.0 - smoothstep(0.02, 0.11, sparkPx))
            * (1.0 - smoothstep(30.0, 95.0, vDist));
          if (sparkFade > 0.004) {
            vec3 vd = normalize(cameraPosition - vWorld);
            vec2 cell = floor(vWorld.xz * 26.0);
            float pick = fract(sin(dot(cell, vec2(45.233, 91.777))) * 31871.37);
            float phase = fract(pick * 71.3 + dot(vd.xz, vec2(2.7, 3.1)) * 0.5);
            float twinkle = pow(abs(sin(phase * 6.28318)), 22.0);
            float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            gl_FragColor.rgb += smoothstep(0.986, 1.0, pick) * twinkle
              * sparkFade * smoothstep(0.45, 0.95, lum)
              * (1.0 + ${GLITTER_AIM.toFixed(2)} * n64Spec) * uSunTint;
          }
        }
        #include <fog_fragment>`);
  };
  /* Keep the console's vertex snap and sky-coloured fog, but let the snow's
     Lambert term remain continuous. Flat polygon normals already give the
     mountain its low-poly read; five hard light rungs made a moving sun and
     every LOD transition look like shadows switching on a timer. Props and
     the rider retain the stepped retro light.

     And take the sheen, which nothing else on the mountain does. The
     argument for it is the same one the glitter has always rested on: this
     surface is not paint, it is a heap of ice crystals, and the two things
     that say so are a scatter of glints and a broad highlight that slides
     across the slope as you ride past it. The hill had the first and not the
     second, which is why it read as paper between the sparkles. */
  shading.apply(material, { bands: 0, sheen: 1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

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

  function fill(ax, az, ay, outPositions, outColors, outGroom) {
    // Pass one: heights, a row at a time so everything that depends only on
    // z is computed once for the whole row rather than once per vertex
    let i = 0;
    for (let r = 0; r < vertsZ; r++) {
      rowContext(az + zs[r], ctx);
      for (let c = 0; c < vertsX; c++) heights[i++] = heightIn(ctx, ax + xs[c]);
    }

    // Pass two: positions and colours
    i = 0;
    let p = 0;
    for (let r = 0; r < vertsZ; r++) {
      const lz = zs[r];
      const wz = az + lz;
      rowContext(wz, ctx);
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(vertsZ - 1, r + 1);
      const dz2 = zs[rNext] - zs[rPrev] || 1;
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

        // Groomed, and measured to whichever branch of the run is nearer —
        // which is what puts corduroy down both sides of an island
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

        if (rock > 0.002) {
          /* Rock catches the light along its ridges and holds none of it in
             the clefts, which is most of what makes a cliff read as rock.

             And which rock is the band's decision, so a stretch of mountain
             is made of one stone all the way through instead of every cliff
             on the hill being the same grey. That was the complaint that is
             hardest to argue with: a single stone colour makes a hundred
             separate cliffs read as one repeated asset. */
          const mottle = noise2(wx * 0.4, wz * 0.4, 11);
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

        /* Corduroy is painted per pixel from this mask, and a groomer has
           never been over a rock band. There used to be a second set of
           corduroy lines written into the vertex colours here as well, at a
           period of 3.3 metres — barely two samples per cycle on a 1.5-metre
           grid, under Nyquist, so it did not draw corduroy at all. It drew
           the beat between its own period and the grid's, which crawled
           across the hill as the mesh re-anchored. The ribs the fragment
           shader paints are the same idea done where there are enough
           samples to do it. */
        outGroom[i] = groomed * (1 - rock);

        outColors[p] = cr;
        outColors[p + 1] = cg;
        outColors[p + 2] = cb;
      }
    }
  }

  function publish() {
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.aGroom.needsUpdate = true;
  }

  function settleMorph(dt) {
    if (!morphing) return;
    morphAge += dt;
    const frameAlpha = 1 - Math.exp(-morphRate * dt);

    for (let i = 0, p = 0; i < count; i++, p += 3) {
      // mask=0 is the exact collision surface around the rider. mask=1 is a
      // distant vertex that converges exponentially instead of popping.
      const alpha = 1 - morphMask[i] * (1 - frameAlpha);
      positions[p] += (targetPositions[p] - positions[p]) * alpha;
      positions[p + 1] += (targetPositions[p + 1] - positions[p + 1]) * alpha;
      positions[p + 2] += (targetPositions[p + 2] - positions[p + 2]) * alpha;
      colors[p] += (targetColors[p] - colors[p]) * alpha;
      colors[p + 1] += (targetColors[p + 1] - colors[p + 1]) * alpha;
      colors[p + 2] += (targetColors[p + 2] - colors[p + 2]) * alpha;
      groom[i] += (targetGroom[i] - groom[i]) * alpha;
    }

    if (morphAge >= morphSettle) {
      positions.set(targetPositions);
      colors.set(targetColors);
      groom.set(targetGroom);
      morphing = false;
    }
    publish();
  }

  /* Re-anchor after two fine cells. The uniform near field swaps to the same
     world lattice, so nothing around the board moves. Distant graded cells
     cannot make that guarantee; their live world positions are preserved
     below, then positions, albedo and groom mask converge continuously on the
     new samples. This is the difference between a terrain LOD transition and
     an apparent shadow switch every three metres. */
  const stride = spacing * 2;

  function update(x, z, dt = 1 / 60) {
    const ax = Math.round(x / stride) * stride;
    const az = Math.round(z / stride) * stride;
    if (ax === anchorX && az === anchorZ) {
      settleMorph(dt);
      return;
    }

    const ay = heightAt(ax, az);
    if (!Number.isFinite(anchorX)) {
      anchorX = ax;
      anchorZ = az;
      anchorY = ay;
      mesh.position.set(ax, ay, az);
      fill(ax, az, ay, positions, colors, groom);
      publish();
      return;
    }

    /* Changing the mesh transform must not move the surface. Convert every
       live local coordinate back to the same world position under the new
       anchor first; the far field can then glide to its new LOD samples. */
    const shiftX = anchorX - ax;
    const shiftY = anchorY - ay;
    const shiftZ = anchorZ - az;
    for (let p = 0; p < positions.length; p += 3) {
      positions[p] += shiftX;
      positions[p + 1] += shiftY;
      positions[p + 2] += shiftZ;
    }

    anchorX = ax;
    anchorZ = az;
    anchorY = ay;
    mesh.position.set(ax, ay, az);
    fill(ax, az, ay, targetPositions, targetColors, targetGroom);
    morphAge = 0;
    morphing = true;
    settleMorph(dt);
  }

  return {
    mesh,
    update,
    vertexCount: count,
    debug: () => ({ anchorX, anchorY, anchorZ, morphing, morphAge }),
  };
}
