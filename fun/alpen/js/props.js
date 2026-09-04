/* Everything standing on the mountain: trees, shrubs, rocks and slalom gates.

   The hill is filled a band at a time — forty metres of it — and every band
   is generated from its own index, so the same stretch of mountain always
   grows the same forest. Bands behind the rider are dropped and their
   instances handed to bands ahead. Nothing is stored between visits because
   nothing needs to be: the seed is the coordinate.

   NOTHING ON THIS MOUNTAIN IS BUILT ANY MORE, and the going of it is worth a
   paragraph because each piece took a whole mechanism with it.

   A kicker used to be a shape added to the height function — `liftAt` — so
   that the rider rode it for the same reason they rode the hill, and its mesh
   was built by sampling the same sum so the two could never disagree. That
   was a good design for a thing that should not have existed. A built ramp is
   a games idea: it is the same wedge every time, it announces itself in amber,
   and the moment there are two of them on a hillside the mountain reads as a
   venue somebody dressed rather than as a mountain. Worse, it made the
   interesting question — *where do I get air* — into a question with a
   printed answer.

   What replaced them is not a substitute prop. It is `TERRAIN.character`:
   the hill now rides in chapters, and a chapter of short bumps throws a rider
   further, more often and in more different ways than a row of identical
   wedges ever did, because curvature is what launches and the mountain has
   four octaves of it to spend. See the long note in `config.js`.

   The visible saving is that `world.height` is now `heightAt` and nothing
   else. That function is called about twenty-five times per physics step at
   120 Hz, and every one of those calls used to walk a list of ramps first.

   THE PARK AND ITS RAILS WENT THE SAME WAY, later and for the same reason.
   What survived the kickers was a hundred and fifty metres of hill with three
   steel bars laid down it, announced by a gate pair — which is still a venue
   somebody dressed rather than a mountain. And it was expensive in a way a
   prop is not: a rail is a line the rider gets locked onto, so it needed a
   catch test in the air step, a whole `grind` state in the physics, a friction
   constant, a scoring event, two queries on the world adapter, two instanced
   pools, and a stretch of hill that had to be *told* it was special. All of
   that is gone. What is left — the solids list, the gates, the ecology — is
   made entirely of facts about positions, with no place anywhere that has
   rules attached to it.

   The forest used to be one tree. A cylinder, a cone and a smaller cone,
   scaled to three sizes and tinted four greens — and a hillside of that
   reads as wallpaper, because every silhouette is the same silhouette and
   the eye finds the repeat immediately. These are grown instead: a trunk,
   whorls of branches that shorten as they climb it, needles carried out
   along those branches, and snow loaded on top of them. Twelve of them are
   grown once at load from fixed seeds and then instanced, so a forest of
   three hundred trees costs twelve draw calls and no two neighbours are the
   same tree.

   What differs between two of those twelve is now their shape and nothing
   else, because colour has moved out of the geometry and onto the instance.
   A conifer's needles are baked as three *values* — a dark interior, a mid,
   a lit tip — and the per-instance colour is the needle colour itself rather
   than a wash over one, so twelve shapes and twelve draw calls can carry a
   blue-green spruce standing next to a yellow-green pine next to the
   near-black of a wet fir, with the odd rust-brown one that is dying on its
   feet. The twelve tints it replaced ran from #ffffff to #eef0f4, which is
   four ways of saying "leave it alone", and a hillside of them was twelve
   trees repeated forty times each.

   That is only safe because of one float per vertex. An instance colour
   multiplies *everything* in the mesh, and the one rule this palette has is
   that snow is glacier and never white — so the first attempt, which simply
   widened the tints, was a forest wearing cream and khaki snow, and it was
   the snow that gave it away long before the needles did. `surfaceOwn` says how
   much of a surface is its tree's own colour to choose: all of it for
   needles, none of it for snow, and a third for a needled trunk, which
   should drift with its tree without ceasing to be bark. The vertex shader
   walks the instance colour back out again by whatever is left. Every tree
   on this mountain therefore wears exactly #d6e3f4 — not because the tints
   were chosen carefully, but because there is no tint that could move it.

   The rocks and the shrubs are grown the same way and for the same reason.
   Both of them used to be a single stock polyhedron, which was survivable
   while nothing on this mountain cast a shadow onto anything else.

   And the stone now comes in three jobs rather than one. A *hazard* is the
   single readable boulder standing on the verge that a rider who has left the
   line has to deal with. A *stone* is scenery further out, and it now runs
   from a cobble to a glacial erratic twenty times its volume — one family, one
   growth, a squared draw over a factor of twenty, and every one of them bedded
   against the lowest ground its own footprint covers rather than the height
   under its middle. A *crag* is the flanks' geology: a stack of tipped slabs
   standing out of the containment bank, which is the first thing on this
   mountain to put a hard edge on that skyline. Every visible scenery prop is
   solid again; only course gates and Swiss waymarks remain pass-through.

   NOTHING STANDS ON THE GROOMED SNOW. Not a tree, not a rock, nothing but the
   gates — and that is a rule about what a piste *is* rather than a difficulty
   setting. A groomer drives the full width of the corridor; anything it would
   have driven over is not there. Two things used to break it and both are
   gone: a few trees planted inside the corridor once the run had warmed up,
   and the boulder hazard, which was authored between the centre line and the
   piste lip. The forest now starts `PROPS.verge` past the groomed edge and the
   boulder stands in the powder shoulder just beyond it, which is where a blown
   turn actually puts a rider — so nothing has stopped being dangerous, it has
   only stopped being in the middle of the run. */

import {
  heightAt, nearestCenter, corridorHalfAt, centersAt, normalFrom, SNOWPACK,
  chapterTreesAt,
} from './terrain.js';
import { createModelUpgrader } from './importedModels.js';
import { growCardSpruce, createTwigAtlas } from './spruce.js';
import { stream, hash2, noise2, snoise2 } from './noise.js';
import { compose } from './geom.js';
import { PROPS } from './config.js';

const {
  band, ahead, behind, biomes: BIOMES,
} = PROPS;

const TAU = Math.PI * 2;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* Kinds, as the collision list reports them */
export const HARD = 0;   // puts a rider down
export const SOFT = 1;   // costs speed and throws powder
export const JUMPABLE = 2; // hard, but low enough to clear

/* Snow on anything standing on the mountain.

   Painted in the same glacier as the ground rather than the near-white it
   used to be. Snow on a branch is snow that fell out of the same sky as the
   snow underneath it, and a tree wearing a whiter one than the hill is a tree
   that has been cut out and pasted on. */
const SNOW = '#d6e3f4';

/* A shrub's bare wood: cold, and about half the way to the drift it is
   standing in rather than the tree bark it used to be painted with. That is
   the whole of the black-sticks fix and the reasoning is in `growShrub`,
   beside the geometry that had to move with it. */
const THICKET = '#7d8496';

/* The colour of a stand, which is a range and not a list.

   Every one of these is the *final* colour of a tree's needles at its lit
   tip, because that is what the instance colour has become. The two greens
   are the ends of the axis a healthy conifer sits on; a stand is a scatter
   along it rather than six species with six fixed greens.

   `deep` and `lit` are the two ends of the value range, and they are chosen
   in the space the eye reads and squared into the space the multiply happens
   in. Picking a level straight off a linear multiplier is what puts nine
   trees out of ten at the same brightness — half the light is a long way
   from half as bright.

   Nothing here is allowed near the rider's high-vis orange. The rust is a
   dark, unsaturated brown and it is capped below full brightness on purpose:
   one warm thing in the frame is a rider, two is a mess. */
export const STAND = {
  cold: '#1f483b',       // deep alpine spruce needle green
  warm: '#2f5b28',       // sunlit mountain pine green
  rust: '#5a422d',       // the odd one dying on its feet
  ghost: '#50564b',      // and the odd one that has finished
  timberCold: '#807e78', // a dead larch, weathered grey
  timberWarm: '#857866', // and one that still has some sap in the memory
  deep: 0.42,            // how dark the back of a wet stand goes
  lit: 1.15,             // and how light a tree catching the low sun does
  odds: 0.05,            // how often a conifer is rust, and how often a ghost
  cap: 0.92,             // the brightest either of those two is allowed
  wood: 0.35,            // how much of its tree's cast a needled trunk takes
};

/* Needles and bare timber, baked as values rather than colours.

   Three stops, and the ratios between them are the ratios the hand-written
   palettes had — a spruce's `#1e4f37` was 0.34 of the light of its `#3c7d5b`
   in linear terms, which is what `#9c9c9c` is of white. Getting that from the
   old numbers rather than choosing it fresh is the only reason the trees
   still read as the same trees under the new scheme. */
const NEEDLE_STOPS = ['#9c9c9c', '#d6d6d6', '#ffffff'];
const BARE_STOP = '#ffffff';

/* How much of a surface belongs to its tree rather than to the mountain.
   See the head of the file: this is the number the vertex shader mixes on. */
const OWN_SNOW = 0;
const OWN_ALL = 1;

/* HOW MUCH SOONER A PROP GOES INTO THE WEATHER THAN THE HILL DOES.

   Everything standing on this mountain is darker than the snow it stands in,
   and that is a problem the fog cannot solve on its own. One extinction curve
   applied to both takes the ground out of the picture at about half the
   distance it takes a conifer out, so beyond a couple of hundred metres the
   hill has dissolved and the forest on it has not — which reads, unmistakably
   and wrongly, as trees hanging in the air with nothing under them.

   It is worth saying that this was measured rather than assumed. Every live
   tree instance was raycast down onto the drawn terrain, binned by range: the
   mean gap is *negative* half a metre at three hundred metres and the worst
   positive gap anywhere is one metre, against a fifteen-metre tree. Nothing is
   floating. The ground had simply gone.

   So the knob lives in the curtain and not in the placement. See `uFogPull`
   in shading.js: the number is how much further away the surface pretends to
   be when it asks how faded it should be.

   All three sit at neutral now, on purpose. The first cut (2.45 on trees)
   overshot the other way — at that strength a conifer three hundred metres
   out was already a pure white cutout against ground that still had detail,
   which is the same mismatch mirrored. Until someone re-tunes these against
   the current fog distances, neutral is the better-looking of the two
   failure modes; these constants remain the live knobs for that pass. */
const FOG_PULL_TREE = 1.0;
const FOG_PULL_STONE = 1.0;
const FOG_PULL_FLORA = 1.0;

/* WHERE THE TREES ARE, which is a different question from what they look
   like and had never been asked.

   Twelve grown variants solved the wallpaper problem one tree at a time: no
   two neighbours are the same tree. What was left was the wallpaper problem
   one *hillside* at a time — twenty-two trees scattered uniformly through
   every forty-metre band, at the top of the mountain and a mile below it,
   with a `pow(rnd, 0.6)` biasing them towards the piste and nothing else
   deciding anything. Which produced a forest of perfectly even density, and
   even density is the one property no forest anywhere has.

   Three fields fix it, and all three are things you can see out of a cable
   car window.

   STANDS. Trees grow where other trees grew, so a treeline is clumps and
   clearings at a scale of a couple of hundred metres — dense stands, thin
   scrub between them, and the odd bare shoulder where the wind or an
   avalanche path has taken everything. A slow 2D field decides how much cover
   this patch is allowed, and a candidate tree that draws above it is simply
   not planted. `clearing` is the floor, because a genuinely empty piste edge
   reads as unfinished rather than as open.

   THE TREELINE. The run descends about 0.28 metres for every metre of z, so
   two and a half kilometres of riding is seven hundred metres of altitude —
   which in the Alps is the whole distance from stunted krummholz at the top
   to closed forest at the bottom. So the cover and the size of a tree both
   ramp with how far down the mountain it is standing. It costs one
   smoothstep and it is the strongest single cue that the run is *going
   somewhere*: the forest thickens and grows as the rider descends into it.

   SIZE. And within a stand, the sizes are not uniform either — a forest is
   mostly small trees with a few emergents standing over them, which is what
   the exponent on the draw is for. */
const FOREST = {
  /* THE STAND FIELD, and why it is not round.

     It used to be one isotropic noise at ~220 m. Two consequences, and both
     of them are the reason the run reads as a tunnel. A 220 m wavelength
     barely changes across the sixty-odd metres between the left verge and
     the right one, so the two sides of the piste were handed almost the
     same density and the forest arrived as a matched pair of hedges. And
     the floor under it was a third, so even the thinnest stretch still grew
     a third of a forest — there were no clearings anywhere on the mountain.

     Anisotropic now: short across the hill, long down it. Eighty metres of
     lateral wavelength decorrelates the two verges completely — thick trees
     on the left against an open shoulder on the right is now an ordinary
     thing to ride past — while three hundred metres along z keeps a stand a
     stand rather than a stripe. And the floor is small enough that a genuine
     clearing is a place the run goes through. */
  standFreqX: 0.0125,     // ≈80 m across the hill: the two sides disagree
  standFreqZ: 0.0034,     // ≈294 m down it: stands stay long
  standBand: [0.30, 0.66],
  standSeed: 137,
  clearing: 0.05,
  /* Metres of descent over which the treeline closes, and what it closes
     from and to. */
  line: [80, 1600],
  /* THE OPENING IS THE ONE EVERY PLAYER SEES. Cover climbing from a third
     off to full over a kilometre and a half sounds like a difficulty curve
     and is not one: trees are held off the corduroy by `PROPS.verge` and
     never stand on it, so what this dial moves is scenery rather than
     hazard — while the sparsest forest on the mountain was being handed to
     a rider in their first two hundred metres, which is where they decide
     what this mountain looks like. It still opens out; it now opens out
     from a treeline rather than from a scatter. */
  lineCover: [0.88, 1.0],
  lineScale: [0.88, 1.18],
  /* How much of the ground's own normal a trunk takes. */
  lean: 0.16,
  wobble: 0.08,           // …and a little more, so no two agree
  /* A wider spread than a nursery. The old range was half a stop either
     side of one size, so a stand was thirty copies of the same tree at
     thirty slightly different scales; this reaches from genuine saplings to
     trees half again the nominal height, and the heavier bias keeps most of
     them small so the big ones read as big. */
  size: [0.58, 1.48],
  sizeBias: 1.40,
  veteran: {
    chance: 0.10,
    from: 16,
    height: [26, 38],
  },
};

/* Ecology is deliberately a set of overlapping weights, not a biome label.
   A hard label would still reveal the forty-metre stream bands eventually;
   these slow fields instead let a stony shoulder dissolve into heath and a
   moist clearing thicken into understory over hundreds of metres. Placement
   remains a pure function of world position and the run seed. */
const ECOLOGY = {
  moisture: { x: 0.0022, z: 0.00125, seed: 211 },
  exposure: { x: 0.0014, z: 0.0020, seed: 223 },
};

function ecologyAt(x, z, out) {
  const travelled = Math.max(0, -z);
  const down = smoothstep(FOREST.line[0], FOREST.line[1], travelled);
  const moisture = smoothstep(0.28, 0.72, noise2(
    x * ECOLOGY.moisture.x, z * ECOLOGY.moisture.z, ECOLOGY.moisture.seed,
  ));
  const exposure = smoothstep(0.30, 0.70, noise2(
    x * ECOLOGY.exposure.x, z * ECOLOGY.exposure.z, ECOLOGY.exposure.seed,
  ));
  const stand = FOREST.clearing + (1 - FOREST.clearing) * smoothstep(
    FOREST.standBand[0], FOREST.standBand[1],
    noise2(x * FOREST.standFreqX, z * FOREST.standFreqZ, FOREST.standSeed),
  );

  out.moisture = moisture;
  out.exposure = exposure;
  out.stand = stand;
  out.alpine = (1 - down) * lerp(0.55, 1, exposure);
  out.heath = smoothstep(0.10, 0.42, down)
    * (1 - smoothstep(0.72, 1, down)) * lerp(0.35, 1, moisture);
  out.understory = smoothstep(0.48, 0.95, down) * stand * lerp(0.30, 1, moisture);
  out.avalanche = smoothstep(0.25, 0.80, down)
    * (1 - stand) * lerp(0.40, 1, exposure);
  out.talus = lerp(0.25, 1, exposure) * (1 - 0.55 * stand);
  return out;
}

/* Two pieces of mountain furniture that belong outside the piste rather than
   on it.

   Both are deliberately sparse. The fence is large enough to read as a snow
   bridge from the middle of the run, but one cluster every few hundred metres
   is infrastructure; one in every band would be wallpaper. The waymark is a
   much smaller red-and-white point at the groomed edge and rarer again, so it
   says Switzerland without turning the valley into a run of flags.

   These numbers stay here rather than in config because nothing outside this
   module tunes either prop. Their placement uses dedicated
   `hash2` channels below, not the band's `rnd` stream, so adding them cannot
   reshuffle a tree or a gate. */
const ALPINE = {
  fence: {
    from: 320,          // leave the opening stretch visually quiet
    chance: 0.18,       // per 40 m band: a cluster about every 220 m
    margin: [30, 46],   // beyond the OUTER edge of every fork branch
    sections: [2, 3],   // six-metre sections in one short contour line
    step: 6.15,
    scale: [0.90, 1.12],
  },
  waymark: {
    from: 180,
    chance: 0.11,       // roughly one every 360 m
    margin: [5.5, 9.0],
    scale: [0.92, 1.08],
  },
};

/* One line of shader, and the whole scheme rests on it.

   `<color_vertex>` leaves `vColor.rgb` holding the baked colour times the
   instance's; this walks it back towards the baked one by however much of the
   surface was never the tree's to paint. Both defines are checked because a
   material that has one and not the other has no product to undo, and an
   unguarded reference to `color` in a shader three did not compile with is a
   black screen on one driver and not on the next.

   `shading.apply` calls whatever `onBeforeCompile` the material already had
   before its own and folds that function's text into the program cache key,
   so this gets its own compiled program rather than quietly inheriting the
   terrain's. That contract is documented in shading.js and this is the second
   thing in the game to lean on it. */
const OWN_DECL = '\nattribute float surfaceOwn;';
const OWN_MIX = `#include <color_vertex>
#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
  vColor.rgb = mix( color, vColor.rgb, surfaceOwn );
#endif`;

/* Wind, as the vertex shader sees it.

   The forest and the piste-stake beacons share these two uniform records,
   and `setAir` writes them once per frame — the same one-write-moves-
   everything arrangement the shared shading uses for the sky. The lamps
   take only the clock out of it; the wind is the forest's. The time wraps at 200π
   rather than growing forever because a float's precision does not: every
   frequency used below is a multiple of 0.01 Hz-ish, so `f * 200π` is a whole
   number of turns and the wrap is invisible.

   The sway itself runs in the tree's OWN space, before the instance matrix,
   because that is where `transformed` lives and moving it later would mean
   replacing three's `project_vertex` — the very anchor the shared shading
   appends its view varying to. So the world-space wind is carried into local
   space instead: `vec4 * instanceMatrix` is the transpose multiply, which for
   a yaw-and-scale instance is exactly the inverse rotation. The phase comes
   from a hash of the instance's world position, so a stand of one variant is
   thirty trees lashing out of step rather than one tree stamped thirty times.

   Height squared keeps the trunk planted and spends the whole travel on the
   crown, which is how a conifer actually moves — the stem is a spring loaded
   from the top. The shadow does not sway: the depth pass uses three's own
   depth material, which never sees this patch, and a static shadow under a
   lashing crown is invisible next to the cost of a custom depth material for
   every variant. */
const AIR_DECL = `
uniform float uAirTime;
uniform vec2 uAirWind;
uniform float uSwayHeight;`;

const SWAY = `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 n64Gust = (vec4(uAirWind.x, 0.0, uAirWind.y, 0.0) * instanceMatrix).xyz;
  float n64Up = clamp(transformed.y / uSwayHeight, 0.0, 1.0);
  n64Up *= n64Up;
  float n64Ph = fract(dot(instanceMatrix[3].xz, vec2(0.0913, 0.0527))) * 6.2832;
  float n64Wave = sin(uAirTime * 1.9 + n64Ph)
    + 0.5 * sin(uAirTime * 3.7 + n64Ph * 1.7);
  transformed.xz += n64Gust.xz * (0.02 * n64Wave * n64Up);
}
#endif`;

/* THE GATE LAMP, and why a checkpoint is a light rather than a cloth.

   A flag says where a gate is only while there is daylight on it and no
   weather in the way, which on this mountain is a minority of the run: the
   day cycles into dusk and aurora, and a storm takes the far distance long
   before it takes the near. A lamp is the opposite — it is brightest exactly
   when the snow has gone flat and grey, which is when a rider most needs to
   know where the next gate is. So the pair of them are two lit masts, and the
   course reads as a line of lights down the hill.

   The mast is lit along its length rather than only at its head, and that is
   a fix and not a flourish. A single lens on a two-and-a-half-metre pole is
   under a pixel by the time it is far enough away to be useful, and there is
   nothing else to see: in flat light the dark mast has already dissolved into
   the snow behind it. Three bands up the pole and the lens above them are a
   vertical dashed line, and a dashed line survives being two pixels wide,
   because what reads at that size is not the shape but that something on that
   bearing is brighter than the snow and blinking. The mast under the bands
   also flies the panel colour now, so a gate says which way it wants to be
   taken in daylight, when the beacon is the least of what is visible.

   The flash is a function of the clock and nothing else, so it costs one
   shader instruction and no per-frame work at all. Its phase comes from the
   instance's world z, which has two consequences and both are wanted: the two
   lamps of one gate sit at the same z and therefore flash *together*, so a
   gate reads as one signal rather than two unrelated lights; and consecutive
   gates are a hundred and fifty metres apart, so they land far enough apart in
   phase that the run ahead ripples instead of strobing as one.

   Sharpened with a power rather than left as a sine, because a beacon is
   mostly dark with a snap in it — a sine reads as something slowly breathing.
   The floor keeps the lens visible between flashes: an unlit gate that is
   invisible for two thirds of a second is worse than no gate at all.

   AND ONE OF THEM IS THE NEXT ONE, which the line of lights could not say.
   Eight beacons rippling down the hill in the same colour at the same rate is
   a course; it is not an instruction, and the gate a rider has to commit to
   *now* was indistinguishable from the four behind it. `uNextGate` is that
   gate's z, written once a frame by `setNextGate` — one float for the whole
   field, because both masts of a pair stand at the same z and are therefore
   promoted together, whole. What it buys the leader is a faster clock, its
   own phase rather than a place in the downhill wave, and about twice the
   output: it steps out of the ripple instead of riding it. */
const LAMP_DECL = `
uniform float uAirTime;
uniform float uNextGate;`;

/* Airfield runway guiding light shader: smooth pulsating wave flowing down the mountain */
const PISTE_BEACON = `#include <color_vertex>
{
  float n64Ph = 0.0;
  float n64Lead = 0.0;
  #ifdef USE_INSTANCING
    n64Ph = fract(instanceMatrix[3].z * 0.018) * 6.2832;
    /* Promotion for the upcoming active waypoint gate pair */
    n64Lead = 1.0 - smoothstep(1.0, 5.0, abs(instanceMatrix[3].z - uNextGate));
  #endif
  /* Airfield runway guiding wave: smooth progressive pulse running down the mountain */
  float n64Rate = mix(3.2, 5.6, n64Lead);
  float n64Wave = sin(uAirTime * n64Rate - instanceMatrix[3].z * 0.045 + n64Ph * 0.4);
  float n64Norm = 0.5 + 0.5 * n64Wave;
  float n64Flash = n64Norm * n64Norm * (3.0 - 2.0 * n64Norm);
  #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
    // Warm airfield amber output with bright promotion on active leader
    vColor.rgb *= (1.40 + 3.60 * n64Flash) * (1.0 + 1.20 * n64Lead);
  #endif
}`;

/* The mask itself, built from the same array `compose` is about to eat.

   `compose` concatenates its parts in order and keeps every corner of every
   face, so the vertices a part owns are one contiguous run whose length is
   that part's stock geometry de-indexed. That is the single assumption here,
   and it is why the mask is walked out of `parts` rather than recovered from
   the geometry afterwards — the colours are jittered per part, so there is
   nothing left in the buffer to sort them by. */
const spanOf = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count);

function ownership(THREE, parts) {
  let total = 0;
  for (const part of parts) total += spanOf(part.geo);
  const a = new Float32Array(total);
  let o = 0;
  for (const part of parts) {
    const n = spanOf(part.geo);
    a.fill(part.own === undefined ? OWN_ALL : part.own, o, o + n);
    o += n;
  }
  return new THREE.BufferAttribute(a, 1);
}

/* One tree's colour, from one number.

   Three decorrelated draws are folded out of a single uniform because the
   placement stream is not this function's to lengthen: `place` walks one
   `stream` through the whole band, so a second call here would move every
   tree, shrub, rock and gate downstream of it and reshuffle the mountain.
   Multiplying by an odd constant and taking the fraction is the cheapest
   decorrelation there is and at these counts it is indistinguishable from
   three real draws. The variant index goes in too, so the same instance slot
   in two different pools does not come out the same colour. */
function makeCasts(THREE) {
  const cold = new THREE.Color(STAND.cold);
  const warm = new THREE.Color(STAND.warm);
  const rust = new THREE.Color(STAND.rust);
  const ghost = new THREE.Color(STAND.ghost);
  const timberCold = new THREE.Color(STAND.timberCold);
  const timberWarm = new THREE.Color(STAND.timberWarm);
  const frac = (x) => x - Math.floor(x);

  return function cast(bare, v, u, out) {
    const level = frac(u);
    const hue = frac(u * 7.13 + v * 0.3719);
    const odd = frac(u * 31.7 + v * 0.1137);
    let shade = STAND.deep + Math.pow(level, 0.75) * (STAND.lit - STAND.deep);

    if (bare) {
      // A dead larch is coloured by its wood, so its wood is what varies
      out.lerpColors(timberCold, timberWarm, hue);
    } else if (odd < STAND.odds) {
      out.copy(rust);
      shade = Math.min(shade, STAND.cap);
    } else if (odd > 1 - STAND.odds) {
      out.copy(ghost);
      shade = Math.min(shade, STAND.cap);
    } else {
      out.lerpColors(cold, warm, hue);
    }
    return out.multiplyScalar(shade * shade);
  };
}

/* ==========================================================================
   Growing a tree

   The recursion is the oldest one in graphics and it is still the cheapest
   way to get a hundred trees that are recognisably one species and none of
   them the same tree. A conifer is not really a fractal, though — it is a
   leader with whorls of laterals hung off it, each whorl shorter than the
   one below — so that is what this builds, and the branching recursion is
   kept for the one species that genuinely wants it, the dead larch with no
   needles left to hide its structure.

   The first version of this hung ONE flattened cone of needles per whorl,
   centred on the trunk, and drew the laterals as straight cylinders radiating
   out of it. Two things were wrong with that, and both of them only became
   visible when the game stopped rendering into a 288-line buffer and started
   throwing real shadows.

   The branches came out through the needles. A cone centred on the trunk has
   exactly one radius at any height and a branch has its own length, so the
   moment a branch outran the cone — which was most of them, because the cone
   was sized to the whorl's average — the last half metre of bare brown
   cylinder emerged into the green. Close up a spruce was a cone with black
   spikes radiating from it, and the shadow it threw was a cone with black
   spikes radiating from it, so there was nowhere left to hide it.

   And a stack of cones is a stack of cones. Six of them threaded on a pole
   reads as traffic cones, because each is a closed convex silhouette with a
   hard rim and nothing ever crosses between them.

   So the needles are carried ON the branches now. A lateral is two lengths of
   wood with a joint in the middle and the outer one falling away, and its
   foliage is three sleeves that follow exactly those two directions: one that
   swells away from the trunk, one that narrows, and a point that finishes
   slightly beyond the wood. A branch therefore cannot protrude through its
   own foliage, because its foliage *is* its shape — the failure is not fixed,
   it is unrepresentable. The canopy is the union of thirty of those at thirty
   azimuths and eight heights, which has depth, gaps you can see the trunk
   through, and a silhouette made of arms rather than of arcs.

   Every sleeve's cross-section is squashed vertically, and that one number
   carries most of the difference between the species: a spruce's foliage is
   nearly round and its branches fall away hard, a fir's is a flat plate held
   level, and the layering that produces is the whole of a fir.

   Snow is loaded on the branches rather than sitting as a second cone on the
   needles — one wedge per branch, thickest at the trunk and thinning outward,
   wide and shallow in section, because that is the shape of a load of snow on
   a bough. It is also why the dead larch is worth having at all: with no
   needles, what you read at fifty metres is entirely what has settled on it.

   Everything is emitted in `compose`'s part format and baked into a single
   geometry per variant, so a tree is one draw call however many branches it
   turned out to have.
   ========================================================================== */

/* The species table.

   `foliage`       how much of the light this species' needles keep — a fir is
                   a dark plate held level, a pine is open and pale — or null
                   for a species with none, which is then coloured by its wood
   `reach`         how far a lateral gets from the trunk, per metre of height
   `bushy`         the needle sleeve's radius, as a fraction of that lateral
   `squash`        how much shallower than wide the sleeve is — a fir is a plate
   `liftLow/High`  the angle a lateral leaves the trunk at, at the foot of the
                   tree and at the crown. Conifers hold their bottom branches
                   level or below and their top ones up, and that alone is a
                   surprising amount of what makes a silhouette read as alive
   `droop`         how much further the outer length falls past the joint
   `joint`         where along a lateral the two lengths of wood meet
   `tuftFrom`      how far out along a lateral the needles start; a pine is
                   bare for half of its branch and that is the whole species
   `fringe`        chance of a curtain of needles hanging under the joint
   `flag`          how much shorter the windward side is, for a tree that has
                   had a bad time of it
   `broken`        the leader stops short and there is no crown, only splinters
   `branchy`       spend the recursion on twigs instead of hanging needles */
const SPECIES = [
  {
    name: 'swissHighPine',     // Swiss Stone Pine / Zirbelkiefer — majestic, tall, tufted crown
    bark: '#644e3b',
    foliage: 1.15,
    height: [18, 28], whorls: [7, 11], perWhorl: [5, 8],
    reach: 0.40, bushy: 0.65, squash: 0.85, joint: 0.48,
    liftLow: 0.12, liftHigh: 0.46, droop: 0.22,
    spire: 1.2, snow: 0.75, lean: 0.05, bareTo: 0.36, tuftFrom: 0.40,
  },
  {
    name: 'toweringAlpineSpruce', // Tall needle spire, dense tiered horizontal boughs
    bark: '#544230',
    foliage: 0.96,
    height: [20, 32], whorls: [12, 16], perWhorl: [4, 6],
    reach: 0.34, bushy: 0.52, squash: 0.68, joint: 0.42,
    liftLow: -0.15, liftHigh: 0.44, droop: 0.62,
    spire: 1.7, snow: 0.85, lean: 0.04, fringe: 0.65, bareTo: 0.22, tuftFrom: 0.15,
  },
  {
    name: 'monarchCathedralPine', // Emergent giant pine with soaring trunk and broad crown
    bark: '#5c4533',
    foliage: 1.08,
    height: [24, 36], whorls: [9, 13], perWhorl: [6, 9],
    reach: 0.42, bushy: 0.68, squash: 0.80, joint: 0.46,
    liftLow: 0.10, liftHigh: 0.48, droop: 0.28,
    spire: 1.3, snow: 0.80, lean: 0.04, bareTo: 0.38, tuftFrom: 0.38,
  },
  {
    name: 'glacierWhitePine',  // High-altitude frosted pine with thick snow pillows
    bark: '#584638',
    foliage: 1.10,
    height: [17, 27], whorls: [8, 12], perWhorl: [5, 7],
    reach: 0.38, bushy: 0.60, squash: 0.75, joint: 0.45,
    liftLow: 0.05, liftHigh: 0.42, droop: 0.35,
    spire: 1.4, snow: 0.90, lean: 0.05, bareTo: 0.30, tuftFrom: 0.30,
  },
  {
    name: 'montaneSilverFir',  // Grand silver fir with layered snowy boughs
    bark: '#604c3a',
    foliage: 0.92,
    height: [19, 29], whorls: [10, 14], perWhorl: [5, 6],
    reach: 0.36, bushy: 0.55, squash: 0.62, joint: 0.48,
    liftLow: 0.02, liftHigh: 0.36, droop: 0.28,
    spire: 1.5, snow: 0.82, lean: 0.03, fringe: 0.45, bareTo: 0.25, tuftFrom: 0.20,
  },
  {
    name: 'highAlpineLarch',   // Weathered alpine larch with golden-amber branches
    bark: '#8c8275',
    foliage: null,
    height: [18, 26], whorls: [7, 11], perWhorl: [4, 6],
    reach: 0.44, bushy: 0, squash: 1, joint: 0.46,
    liftLow: -0.05, liftHigh: 0.38, droop: 0.30,
    spire: 0, snow: 0.65, lean: 0.08, branchy: true, bareTo: 0.32,
  },
  {
    name: 'weepingHighSpruce', // Cascading alpine weeping spruce
    bark: '#4e3d2e',
    foliage: 0.90,
    height: [22, 34], whorls: [13, 18], perWhorl: [4, 6],
    reach: 0.38, bushy: 0.58, squash: 0.65, joint: 0.38,
    liftLow: -0.35, liftHigh: 0.40, droop: 0.85,
    spire: 1.9, snow: 0.92, lean: 0.03, fringe: 0.85, bareTo: 0.20,
  },
  {
    name: 'crestedRidgePine',  // Sturdy high-elevation ridge pine
    bark: '#6a523e',
    foliage: 1.12,
    height: [16, 25], whorls: [6, 9], perWhorl: [5, 8],
    reach: 0.42, bushy: 0.70, squash: 0.90, joint: 0.50,
    liftLow: 0.15, liftHigh: 0.45, droop: 0.25,
    spire: 1.1, snow: 0.70, lean: 0.06, bareTo: 0.42, tuftFrom: 0.45,
  },
  {
    name: 'stormHighPine',     // Weather-flagged high pine with fractured crown
    bark: '#524032',
    foliage: 0.88,
    height: [17, 26], whorls: [8, 12], perWhorl: [4, 6],
    reach: 0.32, bushy: 0.50, squash: 0.68, joint: 0.40,
    liftLow: -0.25, liftHigh: 0.32, droop: 0.72,
    spire: 0, snow: 0.75, lean: 0.08, broken: true, flag: 0.65, bareTo: 0.34,
  },
  {
    name: 'frostHighPine',     // Crystalline frosted high pine
    bark: '#564436',
    foliage: 1.05,
    height: [18, 28], whorls: [8, 11], perWhorl: [5, 7],
    reach: 0.39, bushy: 0.62, squash: 0.78, joint: 0.46,
    liftLow: 0.08, liftHigh: 0.44, droop: 0.32,
    spire: 1.4, snow: 0.88, lean: 0.04, bareTo: 0.32, tuftFrom: 0.35,
  },
  {
    name: 'nobleHighSpruce',   // Lofty high-altitude spruce
    bark: '#503e2f',
    foliage: 0.94,
    height: [21, 31], whorls: [11, 15], perWhorl: [4, 6],
    reach: 0.35, bushy: 0.54, squash: 0.64, joint: 0.44,
    liftLow: -0.08, liftHigh: 0.40, droop: 0.52,
    spire: 1.6, snow: 0.85, lean: 0.03, bareTo: 0.24, tuftFrom: 0.22,
  },
  {
    name: 'alpineTimberPine',  // Stately timber pine with soaring clear trunk
    bark: '#66503c',
    foliage: 1.14,
    height: [19, 29], whorls: [7, 10], perWhorl: [5, 8],
    reach: 0.41, bushy: 0.66, squash: 0.88, joint: 0.50,
    liftLow: 0.14, liftHigh: 0.42, droop: 0.26,
    spire: 1.2, snow: 0.78, lean: 0.05, bareTo: 0.40, tuftFrom: 0.40,
  },
];

/* Turning a direction into the euler `compose` will accept. A unit cylinder
   stands on +Y, so this is the pair of angles that take (0,1,0) to `d`:
   pitch away from vertical, then yaw around it. The order matters and it is
   not the default one, which is why the array carries it.

   Leaving the third angle at zero is not laziness, it is the reason the
   flattened sleeves work. Under YXZ the local X axis of a piece comes out
   horizontal and its local Z comes out very nearly vertical for anything
   pointing sideways — so scaling a sleeve `[wide, length, shallow]` gives a
   plate lying flat, every time, without anyone having to build a frame. Put a
   roll in the third slot and it stops being true, because in this order the
   roll is applied to the vector first and takes the axis with it. */
function aim(dx, dy, dz) {
  const pitch = Math.acos(Math.max(-1, Math.min(1, dy)));
  const yaw = Math.atan2(dx, dz);
  return [pitch, yaw, 0, 'YXZ'];
}

/* A unit direction from an azimuth and a pitch above the horizon. Branches
   are specified this way rather than as vectors because every trait that
   shapes one is an angle: the lift where it leaves the trunk, the sag beyond
   the joint, the quarter of the compass the wind has stripped. */
function dirOf(a, pitch) {
  const c = Math.cos(pitch);
  return [Math.cos(a) * c, Math.sin(pitch), Math.sin(a) * c];
}

function growTree(THREE, seed, spec, geos) {
  const rnd = stream(seed);
  const parts = [];
  /* A shade of a colour. Small albedo variation survives the smooth light
     response and stops an entire crown cut from one hex value reading as a
     single painted surface. */
  const tone = (c, k) => new THREE.Color(c).multiplyScalar(k);
  const near = (c) => tone(c, 0.93 + rnd() * 0.14);
  // The same jitter for snow, but tighter on the upper side, because glacier
  // is already near the top of the range. One load of snow on a bough lit a
  // stop brighter than the one above it is a real thing; a white one is not.
  const snowy = () => tone(SNOW, 0.93 + rnd() * 0.1);

  const height = lerp(spec.height[0], spec.height[1], rnd());
  const whorls = Math.round(lerp(spec.whorls[0], spec.whorls[1], rnd()));
  const trunkR = height * 0.024 + 0.065;
  /* Whichever surface gives this species its colour is baked as a value and
     painted per instance; everything else keeps its own. A conifer is its
     needles, so its needles come out neutral and its trunk stays bark. A dead
     larch is nothing but wood, so its wood is what comes out neutral — and
     what it is then painted is a timber and not a green. */
  const bare = !spec.foliage;
  const palette = bare ? null
    : NEEDLE_STOPS.map((g) => new THREE.Color(g).multiplyScalar(spec.foliage));
  const woodOwn = bare ? OWN_ALL : STAND.wood;
  const wood = (k) => (bare ? tone(BARE_STOP, k) : tone(spec.bark, k));
  const bark = () => wood(0.93 + rnd() * 0.14);
  const bareTo = spec.bareTo || 0.13;
  const joint = spec.joint;
  const squash = spec.squash;
  const tuftFrom = spec.tuftFrom || 0;
  const wind = rnd() * TAU;
  // A topped tree stops early and grows no crown. Everything below is then
  // measured against the leader it actually has rather than the one it wanted.
  const standing = height * (spec.broken ? lerp(0.54, 0.72, rnd()) : 1);

  const SEGS = 4;
  const spine = [[0, 0, 0]];
  let lean = 0;
  let sway = rnd() * TAU;
  for (let k = 0; k < SEGS; k++) {
    const p = spine[k];
    const len = standing / SEGS;
    lean += (0.3 + rnd() * 0.7) * spec.lean;
    sway += (rnd() - 0.5) * 1.6;
    const s = Math.sin(lean);
    const d = [Math.cos(sway) * s, Math.cos(lean), Math.sin(sway) * s];
    const r = trunkR * Math.pow(0.78, k);
    parts.push({
      geo: geos.bole, color: bark(), own: woodOwn,
      pos: p, rot: aim(d[0], d[1], d[2]), scale: [r, len, r],
    });
    spine.push([p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len]);
  }

  // A root flare, which is a metre of shape for sixteen triangles and is
  // exactly the sort of thing a shadow at nine centimetres per texel finds.
  parts.push({
    geo: geos.flare, color: wood(0.84), own: woodOwn,
    pos: [0, 0, 0], rot: [0, rnd() * TAU, 0],
    scale: [trunkR * 2.2, trunkR * 3.1, trunkR * 2.2],
  });

  /* And the drift the whole tree is standing in. A bark cylinder meeting the
     snow along a clean circle is the one place a grown tree still admitted to
     being furniture: real snow banks against a trunk, and the well of it is
     the first thing the eye checks at the foot of a conifer. One steep-ish
     cone in the ground's own glacier — OWN_SNOW, so no instance tint can ever
     paint it. The proportions are set by the steepest hill a tree stands on:
     across a 5·r footprint a 22° bank drops the ground about 2·r, so the rim
     is sunk 1.6·r and the cone keeps 2.6·r of height to stay a mound on the
     uphill side. Wider and shallower looked better on paper and floated a
     hand's width above every steep bank. Verts per VARIANT, not per tree. */
  parts.push({
    geo: geos.drift, color: snowy(), own: OWN_SNOW,
    pos: [0, -trunkR * 1.6, 0], rot: [0, rnd() * TAU, 0],
    scale: [trunkR * 5, trunkR * 2.6, trunkR * 5],
  });

  /* Where the leader is, `u` of the way up it. */
  function spineAt(u) {
    const f = Math.max(0, Math.min(1, u)) * SEGS;
    const i = Math.min(SEGS - 1, f | 0);
    const k = f - i;
    const a = spine[i];
    const b = spine[i + 1];
    return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  }

  /* A load of snow, lying on top of whatever `bed` metres of branch is under
     it. Aimed along the branch, so it is wide across the bough and shallow
     over it rather than being a ball stuck to the side, and offset straight
     up in world rather than along a computed surface normal — the branches
     that carry any real weight are the near-horizontal ones, and for those
     the two are the same answer. */
  function load(p, d, len, bed) {
    parts.push({
      geo: geos.loaf, color: snowy(), own: OWN_SNOW,
      pos: [p[0], p[1] + bed * 0.92, p[2]], rot: aim(d[0], d[1], d[2]),
      scale: [bed * (0.72 + rnd() * 0.3), len, bed * 0.5],
    });
  }

  /* The larch's fine structure, which is the one place the old fractal is
     still the right tool: with no needles to hang, what the eye reads is the
     branching itself, so it has to actually branch. */
  function twigs(p, d, len, rad, depth) {
    if (depth <= 0 || len < PROPS.trees.minLength) return;
    for (let i = 0; i < 2; i++) {
      const a = rnd() * TAU;
      const spread = 0.4 + rnd() * 0.55;
      // Push the child off its parent's direction by `spread`, around a
      // random azimuth. Cheap, and at twenty metres indistinguishable from
      // doing it properly with a frame.
      const nx = d[0] + Math.cos(a) * spread;
      const ny = d[1] + 0.2 + rnd() * 0.3;
      const nz = d[2] + Math.sin(a) * spread;
      const m = Math.hypot(nx, ny, nz) || 1;
      const nd = [nx / m, ny / m, nz / m];
      const nl = len * (0.56 + rnd() * 0.2);
      parts.push({
        geo: geos.twig, color: bark(), own: woodOwn,
        pos: p, rot: aim(nd[0], nd[1], nd[2]), scale: [rad, nl, rad],
      });
      if (depth > 1 && rnd() < spec.snow) load(p, nd, nl * 0.7, rad * 2.2);
      twigs([p[0] + nd[0] * nl, p[1] + nd[1] * nl, p[2] + nd[2] * nl],
        nd, nl, rad * 0.6, depth - 1);
    }
  }

  /* One lateral: two lengths of wood with a joint in the middle, and the
     needles that ride on them.

     `s` below is a parameter along the whole branch, zero at the trunk and
     one at the tip, and `along` turns it into a point by following whichever
     of the two segments it falls in. Every sleeve of foliage is placed as a
     span in `s` and aimed along that same segment's direction, which is the
     entire trick: the needles are described in the branch's own coordinates,
     so there is no arrangement of lift, sag and length in which the wood can
     get outside them. The last sleeve runs slightly past one, so even the
     final centimetre of twig is inside a needle. */
  function lateral(base, a, len, rad, u) {
    const lift = lerp(spec.liftLow, spec.liftHigh, u);
    const sag = spec.droop * (1 - u * 0.55);
    const d1 = dirOf(a, lift);
    const d2 = dirOf(a + (rnd() - 0.5) * 0.3, lift - sag);
    const L1 = len * joint;
    const L2 = len * (1 - joint);
    const knee = [base[0] + d1[0] * L1, base[1] + d1[1] * L1, base[2] + d1[2] * L1];
    const along = (s) => (s <= joint
      ? [base[0] + d1[0] * s * len, base[1] + d1[1] * s * len, base[2] + d1[2] * s * len]
      : [knee[0] + d2[0] * (s - joint) * len,
        knee[1] + d2[1] * (s - joint) * len,
        knee[2] + d2[2] * (s - joint) * len]);

    parts.push({
      geo: geos.limb, color: bark(), own: woodOwn,
      pos: base, rot: aim(d1[0], d1[1], d1[2]), scale: [rad, L1, rad],
    });
    parts.push({
      geo: geos.limb, color: bark(), own: woodOwn,
      pos: knee, rot: aim(d2[0], d2[1], d2[2]), scale: [rad * 0.5, L2, rad * 0.5],
    });

    const bed = palette ? len * spec.bushy : rad * 2.4;

    if (palette) {
      const R = bed;
      const end = 1.06;
      /* Three spans, and where they fall depends on whether the needles start
         before the joint. A spruce's do, so the first sleeve gets the whole
         of the inner segment; a pine's start well past it, so all three share
         the outer one and the tree is left with the bare leg that is the only
         reason anybody can tell a pine from a fir at a hundred metres. */
      let spans;
      if (tuftFrom < joint - 0.06) {
        const rest = end - joint;
        spans = [
          [tuftFrom, joint, d1],
          [joint, joint + rest * 0.7, d2],
          [joint + rest * 0.7, end, d2],
        ];
      } else {
        const s0 = Math.max(tuftFrom, joint);
        const w = end - s0;
        spans = [
          [s0, s0 + w * 0.34, d2],
          [s0 + w * 0.34, s0 + w * 0.78, d2],
          [s0 + w * 0.78, end, d2],
        ];
      }
      /* The stock ratios are chosen so the three meet without a step: `swell`
         arrives at R, `frond` leaves at R and arrives at half of it, and the
         cone starts at exactly that half. The radius of a sleeve is therefore
         never written down twice.

         `swell` widens by half rather than by the 1.85 it started at. That
         ratio put a sleeve at barely half its width where it met the trunk,
         which left a collar of bare bole showing through the middle of every
         whorl — the interior of a conifer is dark and full, not hollow, and
         the fix costs nothing because it is a number in a stock geometry. */
      const stock = [geos.swell, geos.frond, geos.sprig];
      const girth = [R * 0.67, R, R * 0.5];
      for (let i = 0; i < 3; i++) {
        const [s0, s1, d] = spans[i];
        if (s1 - s0 < 0.02) continue;
        const g = girth[i];
        parts.push({
          geo: stock[i], color: near(palette[i]), own: OWN_ALL,
          pos: along(s0), rot: aim(d[0], d[1], d[2]),
          scale: [g, (s1 - s0) * len, g * squash],
        });
      }

      /* Two side sprays, thrown off in azimuth rather than hung underneath.

         Without them a lateral is one smooth taper from trunk to point — one
         long blade — and a whorl of blades is a shuriken, which is what the
         first attempt at this looked like from anywhere above it. The chase
         camera spends the whole game looking down the hill at the tops of
         these things, so it is the *plan* of a bough that has to be broken
         up, and that wants a horizontal spread rather than a vertical one. */
      for (let i = 0; i < 2; i++) {
        const s = 0.34 + i * 0.28 + rnd() * 0.12;
        if (s < tuftFrom) continue;
        const held = s <= joint ? lift : lift - sag;
        const sd = dirOf(a + (i ? 1 : -1) * (0.5 + rnd() * 0.5), held - 0.2 - rnd() * 0.2);
        const g = R * (0.44 - i * 0.1);
        parts.push({
          geo: geos.sprig, color: near(palette[2]), own: OWN_ALL,
          pos: along(s), rot: aim(sd[0], sd[1], sd[2]),
          scale: [g, len * (0.30 + rnd() * 0.18), g * squash],
        });
      }

      // A curtain hanging under the joint. It is the one thing that stops a
      // spruce's skirt reading as a solid shell, because it is the only part
      // of the canopy with air on both sides of it.
      if (spec.fringe && rnd() < spec.fringe) {
        const fd = dirOf(a + (rnd() - 0.5) * 0.9, -1.0 - rnd() * 0.4);
        parts.push({
          geo: geos.sprig, color: near(palette[0]), own: OWN_ALL,
          pos: along(0.5 + rnd() * 0.22), rot: aim(fd[0], fd[1], fd[2]),
          scale: [R * 0.4, R * (1.1 + rnd() * 1.0), R * 0.4],
        });
      }
    }

    /* Snow, on the inner half where a bough is level enough to hold it — but
       not quite at the trunk. A load starting at the bole is buried under the
       whorl above it and does not exist as far as the picture is concerned;
       started a fifth of the way out it clears the shorter whorl overhead and
       is the first thing you see of the tree. It still thins outward, so it is
       still heaviest at the inside, which is where the physics wanted it. */
    if (rnd() < spec.snow) load(along(0.16), d1, len * (0.30 + rnd() * 0.28), bed);

    if (spec.branchy) {
      const tip = along(1);
      twigs(knee, d2, L2 * 0.95, rad * 0.46, PROPS.trees.depth - 2);
      twigs(tip, d2, L2 * 0.7, rad * 0.34, PROPS.trees.depth - 3);
    }
  }

  // A topped tree stops branching well below its break, so that the splinters
  // left standing above the last whorl are the thing you actually read.
  const whorlTop = spec.broken ? 0.84 : 0.97;
  for (let w = 0; w < whorls; w++) {
    const u = bareTo + (whorlTop - bareTo) * (whorls === 1 ? 0.5 : w / (whorls - 1));
    const at = spineAt(u);
    // Laterals shorten as they climb, which is the whole silhouette
    const len = standing * spec.reach * Math.pow(1 - u, 0.7) + 0.3;
    /* One extra lateral in the bottom half. The lowest whorl is the longest
       one, so three sleeves of needles at a hundred and twenty degrees to each
       other merge into a saucer down there and into nothing at all higher up;
       the branch a whorl needs in order to stop being a disc is only needed
       where the disc would be big enough to notice.

       Not for the larch, which has no sleeves to merge and where one extra
       lateral is eight more twigs of recursion behind it. */
    const count = Math.round(lerp(spec.perWhorl[0], spec.perWhorl[1], rnd()))
      + (u < 0.45 && !spec.branchy ? 1 : 0);
    const base = rnd() * TAU;
    const rad = trunkR * 0.32 * (1 - u * 0.5) + 0.022;

    for (let i = 0; i < count; i++) {
      const a = base + (i / count) * TAU + (rnd() - 0.5) * 0.5;
      let l = len * (0.62 + rnd() * 0.7);
      // A flagged tree has been sandblasted from one quarter for a century
      // and has almost nothing left on that side. It is a silhouette you can
      // read at three hundred metres and it costs one cosine.
      if (spec.flag) l *= 1 - spec.flag * 0.5 * (1 + Math.cos(a - wind));
      if (l < PROPS.trees.minLength) continue;
      lateral(at, a, l, rad, u);
    }
  }

  const top = spine[SEGS];
  if (palette && spec.spire > 0.2) {
    // The spire. A conifer without one reads as a bush that got tall.
    const h = standing * 0.15 * spec.spire;
    const r = standing * 0.030 * spec.spire + 0.12;
    parts.push({
      geo: geos.crown, color: palette[2], own: OWN_ALL,
      pos: [top[0], top[1] - h * 0.3, top[2]], rot: [0, rnd() * TAU, 0],
      scale: [r, h, r],
    });
    parts.push({
      geo: geos.drift, color: snowy(), own: OWN_SNOW,
      pos: [top[0], top[1] + h * 0.12, top[2]], rot: [0, rnd() * TAU, 0],
      scale: [r * 0.62, h * 0.5, r * 0.62],
    });
  } else if (spec.broken) {
    // A topped tree is read entirely by the break, so the break gets made:
    // three splinters left standing where the leader snapped, and snow caught
    // in them. They have to clear the last whorl to say anything, which is
    // what `whorlTop` above is for.
    for (let i = 0; i < 3; i++) {
      const d = dirOf(rnd() * TAU, 1.05 + rnd() * 0.4);
      const l = standing * (0.08 + rnd() * 0.09);
      parts.push({
        geo: geos.twig, color: wood(1.14), own: woodOwn,
        pos: top, rot: aim(d[0], d[1], d[2]),
        scale: [trunkR * 0.3, l, trunkR * 0.3],
      });
    }
    parts.push({
      geo: geos.drift, color: snowy(), own: OWN_SNOW,
      pos: [top[0], top[1] - trunkR * 0.4, top[2]], rot: [0, rnd() * TAU, 0],
      scale: [trunkR * 1.3, trunkR * 2.4, trunkR * 1.3],
    });
  }

  /* The mask goes on beside the colours, out of the same array and in the
     same order, and it is the reason a tree can be painted anything at all
     without its snow following the paint. */
  const geometry = compose(THREE, parts);
  geometry.setAttribute('surfaceOwn', ownership(THREE, parts));
  return { geometry, height: standing };
}

/* ==========================================================================
   Weathering, and the two things that needed it

   `compose` can move, turn and scale a stock shape but it cannot deform one,
   so anything built out of stock polyhedra is a crystal: every face flat,
   every edge the same length, every silhouette the same silhouette turned.
   This is the one place that reaches into a geometry and moves the vertices,
   and it does so before `compose` ever sees the result.

   The awkward part is that these geometries are non-indexed — three keeps a
   separate copy of every corner for every face that touches it — so moving a
   corner means finding its three or five duplicates and moving all of them by
   exactly the same amount. They are matched on their position rounded to a
   millimetre, which is safe here because the duplicates were written by the
   same arithmetic and are bit-identical. Miss one and the solid comes apart
   along a seam, which is a very memorable bug to look at.
   ========================================================================== */

function weather(THREE, geo, rnd, amount) {
  const g = geo.clone();
  const p = g.attributes.position;
  const moved = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
    let o = moved.get(key);
    if (!o) {
      // A radial squeeze plus a small shove: the first makes faces of unequal
      // size, the second makes edges of unequal length. Either alone still
      // looks manufactured.
      o = [1 + (rnd() - 0.5) * amount,
        (rnd() - 0.5) * amount * 0.45,
        (rnd() - 0.5) * amount * 0.45,
        (rnd() - 0.5) * amount * 0.45];
      moved.set(key, o);
    }
    p.setXYZ(i, v.x * o[0] + o[1], v.y * o[0] + o[2], v.z * o[0] + o[3]);
  }
  g.computeVertexNormals();
  return g;
}

/* A glacial erratic, grown once and then turned and stretched by instances.
   The geometry returns its own bounds: collision therefore follows the rock
   that was actually made instead of a guessed height that can drift away as
   the silhouette changes. Slate and iron variants use the terrain palette. */
function growBoulder(THREE, seed, geos, palette) {
  const rnd = stream(seed);
  const parts = [];
  const spent = [];
  const dark = new THREE.Color(palette[0]);
  const light = new THREE.Color(palette[1]);
  const stone = (lo = 0.18, hi = 0.72) => new THREE.Color()
    .lerpColors(dark, light, lerp(lo, hi, rnd()));
  const block = (amount) => {
    const g = weather(THREE, geos.stone, rnd, amount);
    spent.push(g);
    return g;
  };

  parts.push({
    geo: block(0.58), color: stone(), own: OWN_ALL,
    pos: [0.02, 0.66, -0.03],
    rot: [(rnd() - 0.5) * 0.36, rnd() * TAU, (rnd() - 0.5) * 0.34],
    scale: [1.08 + rnd() * 0.20, 0.92 + rnd() * 0.24, 0.88 + rnd() * 0.20],
  });

  // A cleft shoulder and a few pieces of scree break both profile and shadow.
  const shoulder = rnd() < 0.5 ? -1 : 1;
  parts.push({
    geo: block(0.64), color: stone(0.12, 0.58), own: OWN_ALL,
    pos: [shoulder * (0.62 + rnd() * 0.12), 0.24, (rnd() - 0.5) * 0.32],
    rot: [(rnd() - 0.5) * 0.75, rnd() * TAU, (rnd() - 0.5) * 0.75],
    scale: [0.48 + rnd() * 0.16, 0.46 + rnd() * 0.16, 0.55 + rnd() * 0.18],
  });
  for (let i = 0; i < 2; i++) {
    const a = rnd() * TAU;
    const off = 0.78 + rnd() * 0.34;
    const s = 0.20 + rnd() * 0.16;
    parts.push({
      geo: block(0.72), color: stone(0.12, 0.52), own: OWN_ALL,
      pos: [Math.cos(a) * off, -0.08 + rnd() * 0.18, Math.sin(a) * off],
      rot: [(rnd() - 0.5) * 1.2, rnd() * TAU, (rnd() - 0.5) * 1.2],
      scale: [s, s * (0.66 + rnd() * 0.25), s * (0.82 + rnd() * 0.30)],
    });
  }

  // A shallow shelf has an edge; a white hemisphere would read as icing.
  parts.push({
    geo: block(0.42), color: SNOW, own: OWN_SNOW,
    pos: [(rnd() - 0.5) * 0.14, 1.34, (rnd() - 0.5) * 0.13],
    rot: [(rnd() - 0.5) * 0.10, rnd() * TAU, (rnd() - 0.5) * 0.10],
    scale: [0.88 + rnd() * 0.10, 0.18 + rnd() * 0.07, 0.70 + rnd() * 0.12],
  });

  const geometry = compose(THREE, parts);
  geometry.setAttribute('surfaceOwn', ownership(THREE, parts));
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const radius = Math.max(
    Math.abs(bounds.min.x), Math.abs(bounds.max.x),
    Math.abs(bounds.min.z), Math.abs(bounds.max.z),
  );
  spent.forEach((g) => g.dispose());
  return {
    geometry, radius, bottom: bounds.min.y, top: bounds.max.y,
  };
}

/* A crag: the flanks' own geology, standing up out of the containment wall.

   The mountain already paints rock on anything steep enough — see `vRock` in
   the terrain shader — and that was doing the whole job, which is why the
   walls read as smooth white banks with brown stains on them. A cliff is not
   a colour. It is a *silhouette*: an edge that interrupts the skyline, throws
   a shadow across the snow below it and tells you which way the strata run.

   So this is a boulder built the other way up. A boulder is a lump that got
   rounder; a crag is a stack of slabs that got broken, so the primitive is
   the same weathered polyhedron squashed flat and piled with each course set
   back and tilted a degree or two further than the one below. The set-back is
   what does it — a vertical pile is a chimney, and a pile that leans reads as
   bedding planes that have been tipped, which is what an alpine face is.

   Snow only lands on the ledges, never on the faces, and that is the second
   half of the read: a white wall with horizontal white lines on a grey ground
   is a cliff even at two hundred metres, and it is the only thing out on
   those banks with a hard edge anywhere on it. */
function growCrag(THREE, seed, geos, palette) {
  const rnd = stream(seed);
  const parts = [];
  const spent = [];
  const dark = new THREE.Color(palette[0]);
  const light = new THREE.Color(palette[1]);
  const stone = (lo = 0.10, hi = 0.62) => new THREE.Color()
    .lerpColors(dark, light, lerp(lo, hi, rnd()));
  const block = (amount) => {
    const g = weather(THREE, geos.stone, rnd, amount);
    spent.push(g);
    return g;
  };

  // Which way the beds dip, and how hard. One decision for the whole crag —
  // strata that disagree with each other are rubble, not a cliff.
  const dip = (rnd() - 0.5) * 0.30;
  const lean = (rnd() < 0.5 ? -1 : 1) * (0.06 + rnd() * 0.10);
  const courses = 4 + Math.floor(rnd() * 3);
  let y = 0;
  for (let i = 0; i < courses; i++) {
    const t = i / (courses - 1);
    // Each course is thinner and narrower than the one under it, so the
    // stack tapers into a summit instead of ending in a flat table
    const thick = lerp(0.42, 0.20, t) * (0.8 + rnd() * 0.45);
    const width = lerp(1.0, 0.40, t) * (0.86 + rnd() * 0.28);
    const setBack = lean * i * 1.15;
    parts.push({
      geo: block(0.30 + rnd() * 0.22), color: stone(), own: OWN_ALL,
      pos: [setBack + (rnd() - 0.5) * 0.10, y + thick, (rnd() - 0.5) * 0.16],
      rot: [dip + (rnd() - 0.5) * 0.10, rnd() * TAU, lean * 1.6 + (rnd() - 0.5) * 0.08],
      scale: [width, thick, width * (0.72 + rnd() * 0.40)],
    });
    /* The ledge each course leaves, and the snow lying on it. Skipping the
       top one matters: a summit cap of snow turns the whole thing back into
       a boulder with a hat. */
    if (i < courses - 1 && rnd() < 0.82) {
      parts.push({
        geo: block(0.55), color: SNOW, own: OWN_SNOW,
        pos: [setBack + lean * 0.5, y + thick * 2 + 0.02, (rnd() - 0.5) * 0.14],
        rot: [dip, rnd() * TAU, lean * 1.6],
        scale: [width * (0.72 + rnd() * 0.26), 0.055 + rnd() * 0.04,
          width * (0.60 + rnd() * 0.28)],
      });
    }
    y += thick * 2 * (0.86 + rnd() * 0.18);
  }
  // Fallen blocks at the foot, which is where the courses above went
  for (let i = 0; i < 3; i++) {
    const a = rnd() * TAU;
    const off = 0.9 + rnd() * 0.7;
    const s = 0.16 + rnd() * 0.24;
    parts.push({
      geo: block(0.68), color: stone(0.08, 0.48), own: OWN_ALL,
      pos: [Math.cos(a) * off, -0.02 + rnd() * 0.16, Math.sin(a) * off],
      rot: [(rnd() - 0.5) * 1.4, rnd() * TAU, (rnd() - 0.5) * 1.4],
      scale: [s, s * (0.5 + rnd() * 0.4), s * (0.8 + rnd() * 0.4)],
    });
  }

  const geometry = compose(THREE, parts);
  geometry.setAttribute('surfaceOwn', ownership(THREE, parts));
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const radius = Math.max(
    Math.abs(bounds.min.x), Math.abs(bounds.max.x),
    Math.abs(bounds.min.z), Math.abs(bounds.max.z),
  );
  spent.forEach((g) => g.dispose());
  return {
    geometry, radius, bottom: bounds.min.y, top: bounds.max.y,
  };
}

/* A winter shrub keeps its dark mass below the snow instead of becoming a
   white scrap. One variant carries exaggerated bilberry/lingonberry clusters:
   the fruit is still small, but large enough to survive motion and haze. */
function growShrub(THREE, seed, geos, berries) {
  const rnd = stream(seed);
  const parts = [];
  const spent = [];
  const foliage = berries ? '#40554a' : '#506057';
  const fruit = berries ? ['#30364d', '#642f3f'] : [];

  const twigCount = 7 + ((rnd() * 3) | 0);
  const stem = rnd() * TAU;
  for (let i = 0; i < twigCount; i++) {
    const a = stem + (i / twigCount) * TAU + (rnd() - 0.5) * 0.75;
    const d = dirOf(a, 0.88 + rnd() * 0.48);
    const len = 0.48 + rnd() * 0.42;
    parts.push({
      geo: geos.twig, color: THICKET, own: OWN_ALL,
      pos: [Math.cos(a) * 0.10, 0.05 + rnd() * 0.10, Math.sin(a) * 0.10],
      rot: aim(d[0], d[1], d[2]), scale: [0.036, len, 0.036],
    });
  }

  const lobeCount = 4;
  const base = rnd() * TAU;
  for (let i = 0; i < lobeCount; i++) {
    const a = base + (i / lobeCount) * TAU + (rnd() - 0.5) * 0.65;
    const r = 0.27 + rnd() * 0.13;
    const off = 0.12 + rnd() * 0.25;
    const y = 0.25 + rnd() * 0.28;
    const g = weather(THREE, geos.stone, rnd, 0.48);
    spent.push(g);
    parts.push({
      geo: g, color: new THREE.Color(foliage).multiplyScalar(0.82 + rnd() * 0.22),
      own: OWN_ALL,
      pos: [Math.cos(a) * off, y, Math.sin(a) * off],
      rot: [(rnd() - 0.5) * 0.42, rnd() * TAU, (rnd() - 0.5) * 0.42],
      scale: [r, r * (0.66 + rnd() * 0.14), r * (0.82 + rnd() * 0.16)],
    });
    if (i !== 1 || rnd() < 0.55) {
      parts.push({
        geo: g, color: SNOW, own: OWN_SNOW,
        pos: [Math.cos(a) * off - 0.025, y + r * 0.54, Math.sin(a) * off],
        rot: [0, rnd() * TAU, 0],
        scale: [r * 0.84, r * 0.18, r * 0.76],
      });
    }
  }

  if (berries) {
    const count = 8 + ((rnd() * 4) | 0);
    for (let i = 0; i < count; i++) {
      const a = rnd() * TAU;
      const r = 0.18 + rnd() * 0.32;
      parts.push({
        geo: geos.berry, color: fruit[i % fruit.length], own: OWN_ALL,
        pos: [Math.cos(a) * r, 0.38 + rnd() * 0.38, Math.sin(a) * r],
        scale: [0.052, 0.052, 0.052],
      });
    }
  }

  const geometry = compose(THREE, parts);
  geometry.setAttribute('surfaceOwn', ownership(THREE, parts));
  spent.forEach((g) => g.dispose());
  return geometry;
}

/* One instance is a whole alpine ground patch: cushions, dry blades and seed
   heads. Opaque wedges stay stable under motion where alpha grass cards would
   shimmer against the snow. */
function growPlantPatch(THREE, seed, geos) {
  const rnd = stream(seed);
  const parts = [];
  const spent = [];
  const green = ['#566555', '#68705a'];
  const dry = ['#7a715b', '#918467'];

  for (let i = 0; i < 4; i++) {
    const a = rnd() * TAU;
    const off = 0.18 + rnd() * 0.52;
    const r = 0.15 + rnd() * 0.12;
    const g = weather(THREE, geos.stone, rnd, 0.42);
    spent.push(g);
    const x = Math.cos(a) * off;
    const z = Math.sin(a) * off;
    parts.push({
      geo: g, color: green[i % green.length], own: OWN_ALL,
      pos: [x, 0.10 + rnd() * 0.08, z], rot: [0, rnd() * TAU, 0],
      scale: [r, r * 0.44, r * 0.86],
    });
    if (i < 2) parts.push({
      geo: g, color: SNOW, own: OWN_SNOW,
      pos: [x, 0.21 + rnd() * 0.04, z], rot: [0, rnd() * TAU, 0],
      scale: [r * 0.82, r * 0.12, r * 0.70],
    });
  }

  for (let i = 0; i < 11; i++) {
    const a = rnd() * TAU;
    const off = 0.16 + rnd() * 0.58;
    const d = dirOf(a, 1.04 + rnd() * 0.36);
    const len = 0.25 + rnd() * 0.50;
    const x = Math.cos(a) * off;
    const z = Math.sin(a) * off;
    parts.push({
      geo: geos.blade, color: dry[i % dry.length], own: OWN_ALL,
      pos: [x, 0.02, z], rot: aim(d[0], d[1], d[2]),
      scale: [0.025 + rnd() * 0.016, len, 0.020 + rnd() * 0.012],
    });
    if (i % 4 === 0) parts.push({
      geo: geos.berry, color: '#b7a46f', own: OWN_ALL,
      pos: [x + d[0] * len, 0.02 + d[1] * len, z + d[2] * len],
      scale: [0.045, 0.065, 0.045],
    });
  }

  const geometry = compose(THREE, parts);
  geometry.setAttribute('surfaceOwn', ownership(THREE, parts));
  spent.forEach((g) => g.dispose());
  return geometry;
}

/* Low, sprawling Alpine Mugo Pine / Krummholz dwarf pine conifer shrub */
function growDwarfPine(THREE, seed, geos) {
  const rnd = stream(seed);
  const parts = [];
  const spent = [];
  const pineNeedles = ['#294033', '#334c3e', '#1f3529'];

  const armCount = 5 + ((rnd() * 3) | 0);
  const base = rnd() * TAU;
  for (let i = 0; i < armCount; i++) {
    const a = base + (i / armCount) * TAU + (rnd() - 0.5) * 0.55;
    const len = 0.55 + rnd() * 0.45;
    const d = dirOf(a, 0.45 + rnd() * 0.35);
    parts.push({
      geo: geos.twig, color: THICKET, own: OWN_ALL,
      pos: [Math.cos(a) * 0.08, 0.04 + rnd() * 0.06, Math.sin(a) * 0.08],
      rot: aim(d[0], d[1], d[2]), scale: [0.045, len, 0.045],
    });
    const boughCount = 3;
    for (let j = 0; j < boughCount; j++) {
      const frac = (j + 1) / boughCount;
      const bx = Math.cos(a) * (0.15 + len * frac * 0.75);
      const bz = Math.sin(a) * (0.15 + len * frac * 0.75);
      const by = 0.12 + len * frac * 0.35;
      const br = 0.22 + rnd() * 0.14;
      const g = weather(THREE, geos.stone, rnd, 0.52);
      spent.push(g);
      parts.push({
        geo: g, color: new THREE.Color(pineNeedles[(i + j) % pineNeedles.length]).multiplyScalar(0.85 + rnd() * 0.25),
        own: OWN_ALL,
        pos: [bx, by, bz],
        rot: [(rnd() - 0.5) * 0.35, rnd() * TAU, (rnd() - 0.5) * 0.35],
        scale: [br * 1.25, br * 0.45, br * 0.85],
      });
      if (rnd() < 0.75) {
        parts.push({
          geo: g, color: SNOW, own: OWN_SNOW,
          pos: [bx, by + br * 0.28, bz],
          rot: [0, rnd() * TAU, 0],
          scale: [br * 1.05, br * 0.16, br * 0.75],
        });
      }
    }
  }
  const geometry = compose(THREE, parts);
  geometry.setAttribute('surfaceOwn', ownership(THREE, parts));
  spent.forEach((g) => g.dispose());
  return geometry;
}

/* Alpine Winter Heath with rust/burgundy blossoms */
function growAlpineHeath(THREE, seed, geos) {
  const rnd = stream(seed);
  const parts = [];
  const spent = [];
  const heathTone = ['#5a464c', '#6d4847', '#4b5444'];
  const bloomTone = ['#8b4859', '#a25562', '#7c3848'];

  const lobeCount = 4 + ((rnd() * 2) | 0);
  const base = rnd() * TAU;
  for (let i = 0; i < lobeCount; i++) {
    const a = base + (i / lobeCount) * TAU + (rnd() - 0.5) * 0.6;
    const r = 0.22 + rnd() * 0.12;
    const off = 0.10 + rnd() * 0.22;
    const y = 0.14 + rnd() * 0.18;
    const g = weather(THREE, geos.stone, rnd, 0.45);
    spent.push(g);
    parts.push({
      geo: g, color: new THREE.Color(heathTone[i % heathTone.length]).multiplyScalar(0.9 + rnd() * 0.2),
      own: OWN_ALL,
      pos: [Math.cos(a) * off, y, Math.sin(a) * off],
      rot: [(rnd() - 0.5) * 0.35, rnd() * TAU, (rnd() - 0.5) * 0.35],
      scale: [r, r * 0.52, r * 0.9],
    });
    const bloomCount = 3 + ((rnd() * 3) | 0);
    for (let k = 0; k < bloomCount; k++) {
      const ba = rnd() * TAU;
      const boff = r * (0.4 + rnd() * 0.5);
      parts.push({
        geo: geos.berry, color: bloomTone[k % bloomTone.length], own: OWN_ALL,
        pos: [Math.cos(a) * off + Math.cos(ba) * boff, y + r * 0.35 + rnd() * 0.08, Math.sin(a) * off + Math.sin(ba) * boff],
        scale: [0.048, 0.058, 0.048],
      });
    }
    if (rnd() < 0.6) {
      parts.push({
        geo: g, color: SNOW, own: OWN_SNOW,
        pos: [Math.cos(a) * off, y + r * 0.32, Math.sin(a) * off],
        rot: [0, rnd() * TAU, 0],
        scale: [r * 0.75, r * 0.14, r * 0.70],
      });
    }
  }
  const geometry = compose(THREE, parts);
  geometry.setAttribute('surfaceOwn', ownership(THREE, parts));
  spent.forEach((g) => g.dispose());
  return geometry;
}

/* Frosty mountain willow and deciduous scrub with bare twigs */
function growWinterBramble(THREE, seed, geos) {
  const rnd = stream(seed);
  const parts = [];
  const spent = [];
  const stemTones = ['#382d27', '#4b3c33', '#524339'];

  const mainStems = 8 + ((rnd() * 5) | 0);
  const stem = rnd() * TAU;
  for (let i = 0; i < mainStems; i++) {
    const a = stem + (i / mainStems) * TAU + (rnd() - 0.5) * 0.65;
    const tilt = 0.75 + rnd() * 0.55;
    const d = dirOf(a, tilt);
    const len = 0.52 + rnd() * 0.48;
    parts.push({
      geo: geos.twig, color: stemTones[i % stemTones.length], own: OWN_ALL,
      pos: [Math.cos(a) * 0.06, 0.02 + rnd() * 0.05, Math.sin(a) * 0.06],
      rot: aim(d[0], d[1], d[2]), scale: [0.032, len, 0.032],
    });
    if (rnd() < 0.7) {
      const subA = a + (rnd() - 0.5) * 0.9;
      const subD = dirOf(subA, tilt + 0.3);
      const subLen = len * 0.55;
      parts.push({
        geo: geos.twig, color: stemTones[(i + 1) % stemTones.length], own: OWN_ALL,
        pos: [Math.cos(a) * 0.06 + d[0] * len * 0.5, 0.02 + d[1] * len * 0.5, Math.sin(a) * 0.06 + d[2] * len * 0.5],
        rot: aim(subD[0], subD[1], subD[2]), scale: [0.022, subLen, 0.022],
      });
    }
  }
  for (let i = 0; i < 3; i++) {
    const r = 0.12 + rnd() * 0.08;
    const g = weather(THREE, geos.stone, rnd, 0.35);
    spent.push(g);
    parts.push({
      geo: g, color: SNOW, own: OWN_SNOW,
      pos: [(rnd() - 0.5) * 0.18, 0.08 + rnd() * 0.12, (rnd() - 0.5) * 0.18],
      scale: [r, r * 0.4, r],
    });
  }
  const geometry = compose(THREE, parts);
  geometry.setAttribute('surfaceOwn', ownership(THREE, parts));
  spent.forEach((g) => g.dispose());
  return geometry;
}

/* Alpine tussock grass and cushion moss patch */
function growTussockPatch(THREE, seed, geos) {
  const rnd = stream(seed);
  const parts = [];
  const spent = [];
  const tussockColors = ['#697159', '#7e765d', '#535b48'];

  for (let i = 0; i < 5; i++) {
    const a = rnd() * TAU;
    const off = 0.12 + rnd() * 0.45;
    const r = 0.18 + rnd() * 0.14;
    const g = weather(THREE, geos.stone, rnd, 0.45);
    spent.push(g);
    const x = Math.cos(a) * off;
    const z = Math.sin(a) * off;
    parts.push({
      geo: g, color: tussockColors[i % tussockColors.length], own: OWN_ALL,
      pos: [x, 0.08 + rnd() * 0.06, z], rot: [0, rnd() * TAU, 0],
      scale: [r * 1.1, r * 0.38, r * 0.9],
    });
    if (i < 3) {
      parts.push({
        geo: g, color: SNOW, own: OWN_SNOW,
        pos: [x, 0.16 + rnd() * 0.03, z], rot: [0, rnd() * TAU, 0],
        scale: [r * 0.85, r * 0.10, r * 0.75],
      });
    }
  }
  for (let i = 0; i < 16; i++) {
    const a = rnd() * TAU;
    const off = 0.10 + rnd() * 0.55;
    const d = dirOf(a, 0.95 + rnd() * 0.45);
    const len = 0.30 + rnd() * 0.40;
    parts.push({
      geo: geos.blade, color: tussockColors[i % tussockColors.length], own: OWN_ALL,
      pos: [Math.cos(a) * off, 0.02, Math.sin(a) * off],
      rot: aim(d[0], d[1], d[2]),
      scale: [0.028 + rnd() * 0.015, len, 0.022 + rnd() * 0.012],
    });
  }
  const geometry = compose(THREE, parts);
  geometry.setAttribute('surfaceOwn', ownership(THREE, parts));
  spent.forEach((g) => g.dispose());
  return geometry;
}

/* ==========================================================================
   Alpine infrastructure

   The two geometries here are intentionally all silhouette. At a hundred
   metres a fence is five dark horizontal strokes held off the snow, and a
   waymark is a red square on a tall post; fasteners, lettering and timber
   grain would be sub-pixel decoration paid for twice through the shadow map.

   A snow bridge is one six-metre section. Several instances are joined into a
   short contour line by the placement code rather than baked together, which
   lets each section take the normal of the ground under its own feet. The
   caps are real thin solids rather than a texture, so their white line reads
   from both sides and casts the small broken shadow that separates one slat
   from the next. */
function avalancheFenceGeometry(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const steel = '#454b57';
  const timber = '#6b5844';
  const parts = [];

  // The frame leans into the upper side of the slope, with two rear braces
  // making the triangular profile that distinguishes a snow bridge from a
  // garden fence when it is seen end-on.
  for (const x of [-2.72, 2.72]) {
    parts.push({
      geo: box, color: steel, pos: [x, 1.43, 0], rot: [0.16, 0, 0],
      scale: [0.18, 2.92, 0.18],
    });
    parts.push({
      geo: box, color: steel, pos: [x, 1.18, -0.48], rot: [0.50, 0, 0],
      scale: [0.15, 2.72, 0.15],
    });
  }

  // Five broad retaining slats, each with the snow that has settled on its
  // upper edge. Their slight stagger follows the frame's lean.
  for (let i = 0; i < 5; i++) {
    const y = 0.54 + i * 0.47;
    const z = (y - 1.48) * 0.16;
    parts.push({
      geo: box, color: timber, pos: [0, y, z],
      scale: [5.82, 0.21, 0.17],
    });
    parts.push({
      geo: box, color: SNOW, pos: [0, y + 0.135, z + 0.025],
      scale: [5.94, 0.075, 0.26],
    });
  }

  const geometry = compose(THREE, parts);
  box.dispose();
  return geometry;
}

/* The marker faces uphill in its local +Z direction, which is where the rider
   always approaches from. A box is used instead of a one-sided plane because
   the marker stays in the pool briefly after it has been passed, and the red
   back still reads as a deliberate object rather than a vanished polygon.
   The cross is a small piece of geometry, not a texture dependency. */
function waymarkGeometry(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const geometry = compose(THREE, [
    { geo: box, color: '#424852', pos: [0, 1.50, 0], scale: [0.14, 3.0, 0.14] },
    { geo: box, color: '#d52b1e', pos: [0, 2.56, 0], scale: [1.42, 0.86, 0.17] },
    // Swiss cross, proud of the face so it survives the material's flat light
    { geo: box, color: '#f4f7fb', pos: [0, 2.56, 0.115], scale: [0.76, 0.16, 0.065] },
    { geo: box, color: '#f4f7fb', pos: [0, 2.56, 0.115], scale: [0.16, 0.58, 0.065] },
    // A cap thick enough to remain a pale dash at 150 metres
    { geo: box, color: SNOW, pos: [0, 3.045, 0], scale: [1.50, 0.11, 0.28] },
  ]);
  box.dispose();
  return geometry;
}

/* Piste boundary stakes — slender fluorescent trail poles with iconic European
   round run marker discs placed along the groomed corridor margins. */
function pisteStakeGeometry(THREE) {
  const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8);
  pole.translate(0, 1.15, 0);
  const ring1 = new THREE.CylinderGeometry(0.05, 0.05, 0.20, 8);
  ring1.translate(0, 2.10, 0);
  const ring2 = new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8);
  ring2.translate(0, 1.65, 0);
  const housing = new THREE.CylinderGeometry(0.065, 0.065, 0.12, 8);
  housing.translate(0, 2.25, 0);

  // Iconic round circular European alpine piste marker disc
  const disc = new THREE.CylinderGeometry(0.25, 0.25, 0.035, 16);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, 1.85, 0.04);
  const discRim = new THREE.TorusGeometry(0.25, 0.022, 6, 16);
  discRim.translate(0, 1.85, 0.04);
  const discEmblem = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 12);
  discEmblem.rotateX(Math.PI / 2);
  discEmblem.translate(0, 1.85, 0.045);

  const geometry = compose(THREE, [
    { geo: pole, color: '#e66000' },     // Fluorescent boundary pole
    { geo: ring1, color: '#1c2026' },
    { geo: ring2, color: '#1c2026' },
    { geo: housing, color: '#14181e' },
    { geo: disc, color: '#d02020' },     // Red European piste run marker
    { geo: discRim, color: '#ffffff' },  // White circular border
    { geo: discEmblem, color: '#ffffff' }, // Piste run number badge
  ]);
  pole.dispose();
  ring1.dispose();
  ring2.dispose();
  housing.dispose();
  disc.dispose();
  discRim.dispose();
  discEmblem.dispose();
  return geometry;
}

/* Luminous airfield runway beacon for piste stakes.

   One globe, not three. This used to compose a 0.14 lens and a 0.26 inner
   corona inside the 0.44 outer shell — language borrowed from an additive
   halo that was never implemented: the pool draws an opaque MeshBasic, so
   the outer icosahedron is the entire silhouette and the two shells inside
   it were four hundred triangles per instance that no camera could ever
   see. The soft halo itself is the post stack's job (the lamp is
   `toneMapped: false`, so a lit beacon clears the bloom threshold). */
function pisteStakeLampGeometry(THREE) {
  const globe = new THREE.IcosahedronGeometry(0.44, 1);
  const band1 = new THREE.CylinderGeometry(0.052, 0.052, 0.18, 8);
  const band2 = new THREE.CylinderGeometry(0.052, 0.052, 0.14, 8);

  const geometry = compose(THREE, [
    { geo: globe, pos: [0, 2.12, 0], color: '#ffffff' },
    // Reflective luminous bands along the mast
    { geo: band1, pos: [0, 1.80, 0], color: '#ffffff' },
    { geo: band2, pos: [0, 1.40, 0], color: '#ffffff' },
  ]);
  globe.dispose();
  band1.dispose();
  band2.dispose();
  return geometry;
}

/* ==========================================================================
   Instanced pools
   ========================================================================== */

class Pool {
  constructor(THREE, geometry, material, capacity, tinted = false) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    /* THREE STARTS AN InstancedMesh AT count = capacity WITH EVERY MATRIX
       ZERO, and a zero matrix is not an invisible object: it collapses every
       vertex onto w = 0, which the rasteriser is free to turn into a triangle
       stretched across the frame. These pools opt out of frustum culling, so
       any frame drawn between construction and the first `end()` — the boot
       precompile, and every `NEW MOUNTAIN` reload — was submitting six and a
       half thousand degenerate instances. Draw nothing until there is
       something to draw; `end()` raises this to what was actually written. */
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.capacity = capacity;
    this.n = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.turn = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.tinted = tinted;
    /* Tree pools fill this with the end of every nearest-first band ring.
       The shadow pass can then choose a conservative prefix from the light's
       actual frustum without rebuilding or sorting an instance buffer. */
    this.shadowEnds = null;
    this.full = 0;
    this.lastN = 0;
    /* And the opposite trade for the sparse furniture: a pool marked cullable
       gets a real bounding sphere from its written instances in `end()` and
       is handed back to three's frustum test, because a fence line
       is usually entirely off screen and the trees never are. */
    this.cullable = false;
    if (tinted) this.mesh.setColorAt(0, new THREE.Color(0xffffff));
  }

  begin() {
    this.n = 0;
  }

  add(x, y, z, rotY, sx, sy, sz, color) {
    if (this.n >= this.capacity) return false;
    this.e.set(0, rotY, 0);
    this.q.setFromEuler(this.e);
    return this.write(x, y, z, sx, sy, sz, color);
  }

  /* The snow bridges stand normal to the bank under them rather than upright
     in the world. Yaw is applied in the prop's own frame first and that frame
     is then carried onto the surface normal, so local +Y still lands exactly
     on `normal` at any course heading. Ordinary props keep the cheaper `add`
     path above. */
  addOnSlope(x, y, z, rotY, sx, sy, sz, normal, color) {
    if (this.n >= this.capacity) return false;
    this.q.setFromUnitVectors(this.up, normal);
    this.turn.setFromAxisAngle(this.up, rotY);
    this.q.multiply(this.turn);
    return this.write(x, y, z, sx, sy, sz, color);
  }

  write(x, y, z, sx, sy, sz, color) {
    this.v.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(this.n, this.m);
    if (this.tinted && color) this.mesh.setColorAt(this.n, color);
    this.n += 1;
    return true;
  }

  end() {
    this.mesh.count = this.n;
    if (this.n > 0 || this.lastN > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.tinted && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    this.lastN = this.n;
    if (this.cullable && this.n > 0) {
      /* `InstancedMesh.computeBoundingSphere` walks the live instances against
         the geometry's own sphere, so the result hugs exactly what was
         written. It runs once per band crossing, not per frame, and
         `Frustum.intersectsObject` prefers the mesh sphere over the
         geometry's whenever one exists. */
      this.mesh.computeBoundingSphere();
      this.mesh.frustumCulled = true;
    }
  }
}

/* ==========================================================================
   The field
   ========================================================================== */

export function createProps(THREE, shading) {
  const group = new THREE.Group();
  const bands = ahead + behind + 1;
  const streamSpan = Math.max(ahead, behind);

  // Every material the field makes goes through the shared shading, which is
  // the only reason a tree and the snow it is standing in are lit by the same
  // five bands and dissolve into the same sky. There is no unpatched path out
  // of these builders on purpose — a prop that forgot is a prop that stops
  // belonging to the mountain the moment the light moves. (The flat `lit`
  // helper that used to sit here went with its last caller: the gate mast was
  // the only surface left on the hill wearing a colour of its own rather than
  // one carried on the instance.)
  /* The wind's two uniforms, shared by every material that listens to it.
     `setAir` below is the one writer; the integrator calls it once a frame
     with the weather's own wind, and a frame that forgets simply leaves the
     forest becalmed rather than broken. */
  const air = {
    uAirTime: { value: 0 },
    uAirWind: { value: new THREE.Vector2() },
  };

  /* The beacons' own record: the forest's clock, shared by reference, plus
     the one thing only they read. Far enough from any gate that nothing is
     promoted until `setNextGate` has actually found one. */
  const beacon = {
    uAirTime: air.uAirTime,
    uNextGate: { value: -1e9 },
  };

  /* The same, plus the one thing a tree needs that nothing else on the
     mountain does: a say in how far its instance colour is allowed to reach.
     The patch goes on before `shading.apply`, which calls it first and folds
     its text into the program cache key — so the trees compile their own
     program and the shrubs and rocks go on sharing the plain one.

     `height` is the grown leader's length, which is what normalises the sway
     so a sapling and a seventeen-metre spruce both pivot from the ground up
     rather than sharing one absolute travel. Every closure here has the same
     text, so all twelve variants still share one compiled program and differ
     only in the uniform's value.

     `sheen: 1` puts the ground's own crystalline response on the snow the
     branches are carrying — the loaves and drifts are painted in the same
     glacier as the hill. The luminance mask alone is not enough to keep it
     off the wood: dead larch timber is nearly as pale as the drifts, and a
     glossy dead tree is a plastic one. `surfaceOwn` already knows which
     vertices are snow (0) and which belong to the tree itself (1), so it is
     routed into the shading's per-vertex sheen carve-out — written after
     the shared default because shading.apply injects its own line directly
     behind the `project_vertex` include this replacement preserves. */
  const neutralTreeTex = new THREE.DataTexture(
    new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat,
  );
  neutralTreeTex.needsUpdate = true;

  const texLoader = new THREE.TextureLoader();
  /* Photographs, so sRGB, and the loader has to be told: read as linear
     (which is what an unlabelled texture is) a photograph arrives with its
     gamma curve baked into its contrast — mid-tones twice as bright as they
     are, and every crevice and grain crushed towards one flat grey. That is
     what the bark and the stone looked like, and the gains beside each
     fetch below were tuned to compensate. They now put the mean back where
     the old decode had it, so the only thing that changes is the contrast:
     bark that is bark, stone that is stone. Anisotropy because every one of
     these is seen at a grazing angle up a trunk or across a face. */
  const photoPlate = (target) => (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    target.value = t;
  };
  const barkTex = { value: neutralTreeTex };
  texLoader.load(
    new URL('../assets/textures/tree/weathered-tree-bark.jpg', import.meta.url).href,
    photoPlate(barkTex),
  );
  const rockTex = { value: neutralTreeTex };
  texLoader.load(
    new URL('../assets/textures/rock/rock-slate.jpg', import.meta.url).href,
    photoPlate(rockTex),
  );
  const woodPlanksTex = { value: neutralTreeTex };
  texLoader.load(
    new URL('../assets/textures/huts/alpine-wood-planks.jpg', import.meta.url).href,
    photoPlate(woodPlanksTex),
  );

  const treeMat = (height) => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, air, {
        uSwayHeight: { value: height },
        uBarkTex: barkTex,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${OWN_DECL}${AIR_DECL}
        varying vec3 vTreeWorldPos;
        varying vec3 vTreeNormal;`)
        .replace('#include <color_vertex>', OWN_MIX)
        .replace('#include <begin_vertex>', SWAY)
        .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vTreeWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vTreeNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
        #else
          vTreeWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTreeNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        #endif
        vN64Sheen = 1.0 - surfaceOwn;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        varying vec3 vTreeWorldPos;
        varying vec3 vTreeNormal;
        uniform sampler2D uBarkTex;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        /* Triplanar bark over the tree's own timber. The gain is the plate's
           linear mean inverted, so the texture shapes the colour without
           moving its level — see the loader note. */
        float treeOwn = 1.0 - vN64Sheen;
        if (treeOwn > 0.05) {
          vec3 nAbs = abs(vTreeNormal);
          vec4 barkX = texture2D(uBarkTex, vTreeWorldPos.yz * 0.35);
          vec4 barkY = texture2D(uBarkTex, vTreeWorldPos.xz * 0.35);
          vec4 barkZ = texture2D(uBarkTex, vTreeWorldPos.xy * 0.35);
          vec3 barkColor = (barkX.rgb * nAbs.x + barkY.rgb * nAbs.y + barkZ.rgb * nAbs.z) / max(0.001, nAbs.x + nAbs.y + nAbs.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * barkColor * 4.75, 0.75 * treeOwn);
        }`);
    };
    return shading.apply(m, { cameraFade: true, sheen: 1, fogPull: FOG_PULL_TREE });
  };

  /* Low vegetation shares one wind program and organic botanical textures */
  const floraMat = () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, air, {
        uSwayHeight: { value: 1.2 },
        uBarkTex: barkTex,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${OWN_DECL}${AIR_DECL}
        varying vec3 vFloraWorldPos;
        varying vec3 vFloraNormal;`)
        .replace('#include <color_vertex>', OWN_MIX)
        .replace('#include <begin_vertex>', SWAY)
        .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vFloraWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vFloraNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
        #else
          vFloraWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vFloraNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        #endif
        vN64Sheen = 1.0 - surfaceOwn;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        varying vec3 vFloraWorldPos;
        varying vec3 vFloraNormal;
        uniform sampler2D uBarkTex;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        float floraOwn = 1.0 - vN64Sheen;
        if (floraOwn > 0.05) {
          vec3 twigSample = texture2D(uBarkTex, vFloraWorldPos.xy * 0.75).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * twigSample * 5.0, 0.72 * floraOwn);
        }`);
    };
    return shading.apply(m, { cameraFade: true, sheen: 1, fogPull: FOG_PULL_FLORA });
  };

  /* Photoscanned props wear their own scan. The baseColor map (diffuse with
     the scan's ambient occlusion pre-multiplied) carries all the colour, so
     this material's whole job is snow: a per-vertex mask from how much of
     the world's up a face sees, settled a little harder where the scan is
     open and pale, painted in the same prop snow as everything else and
     routed into the sheen carve-out so the dusting sparkles like the ground
     while the stone under it stays matte. */
  const photoMat = (map, snowAmount) => {
    const m = new THREE.MeshLambertMaterial({ map });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uSnowAmount: { value: snowAmount } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
        uniform float uSnowAmount;
        varying float vSnowT;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 n64WN = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
          #else
            vec3 n64WN = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          #endif
          vSnowT = uSnowAmount * smoothstep(0.38, 0.82, n64WN.y);
        }
        vN64Sheen = vSnowT;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        varying float vSnowT;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float n64Lum = dot(diffuseColor.rgb, vec3(0.30, 0.55, 0.15));
          float n64Settle = vSnowT * (0.55 + 0.85 * smoothstep(0.06, 0.42, n64Lum));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.839, 0.890, 0.957),
            clamp(n64Settle, 0.0, 0.96));
        }`);
    };
    return shading.apply(m, { cameraFade: true, sheen: 1, fogPull: FOG_PULL_STONE });
  };

  /* Boulder snow uses the same mask without wind. A separate static program
     keeps the rock faceting still and maps authentic slate/granite textures. */
  const rockMat = () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uRockTex: rockTex });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${OWN_DECL}
        varying vec3 vRockWorldPos;
        varying vec3 vRockNormal;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vRockWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vRockNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
        #else
          vRockWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vRockNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        #endif
        vN64Sheen = 1.0 - surfaceOwn;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        varying vec3 vRockWorldPos;
        varying vec3 vRockNormal;
        uniform sampler2D uRockTex;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        float rockOwn = 1.0 - vN64Sheen;
        if (rockOwn > 0.05) {
          vec3 nAbs = abs(vRockNormal);
          vec4 rockX = texture2D(uRockTex, vRockWorldPos.yz * 0.25);
          vec4 rockY = texture2D(uRockTex, vRockWorldPos.xz * 0.25);
          vec4 rockZ = texture2D(uRockTex, vRockWorldPos.xy * 0.25);
          vec3 rockColor = (rockX.rgb * nAbs.x + rockY.rgb * nAbs.y + rockZ.rgb * nAbs.z) / max(0.001, nAbs.x + nAbs.y + nAbs.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * rockColor * 7.2, 0.75 * rockOwn);
        }`);
    };
    return shading.apply(m, { cameraFade: true, sheen: 1, fogPull: FOG_PULL_STONE });
  };

  /* The beacon lens material, flashed by the shared clock. Deliberately
     unlit — a lamp that took the key light would go out at dusk, which is
     the one hour it exists for — so this is the one material on the mountain
     whose colour is its own output. It keeps three's fog, so a beacon still
     dissolves into a storm at the same distance everything else does; one
     burning at full strength through a whiteout would be the one object in
     the scene claiming the weather does not apply to it. */
  const pisteStakeLampMat = () => {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    m.toneMapped = false;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, beacon);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${LAMP_DECL}`)
        .replace('#include <color_vertex>', PISTE_BEACON);
    };
    return m;
  };

  const castOf = makeCasts(THREE);

  // --- the trees ------------------------------------------------------------
  /* Unit stock.

     Everything the growth emits is one of these, moved, turned and scaled by
     `compose` — which means the *taper* of a piece cannot be chosen where it
     is used, only its length and its girth, because a scale does not change a
     ratio. That is why there is a family of them rather than one cylinder: a
     limb narrowing towards its tip and a sleeve of needles swelling away from
     the trunk are the same primitive at two ratios, and the ratio has to be
     baked in at construction.

     All of them stand on the origin pointing at +Y with a bottom radius of
     one — so a scale of `[r, len, r]` is read directly as a radius and a
     length — and all are open-ended, because nothing on a tree or a rock is
     ever seen from inside.

     Instancing makes denser stock particularly valuable here: each smoother
     leader, branch and snow load is stored once per grown variant and reused
     across the whole forest. Fine twigs stay lighter than foreground trunks,
     but even they now have enough sides to remain round in a moving shadow. */
  const sides = PROPS.trees.sides;
  const radial = Math.max(12, sides * 2);
  const hull = (ratio, n) => {
    const g = new THREE.CylinderGeometry(ratio, 1, 1, n, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  };
  const spike = (n) => {
    const g = new THREE.ConeGeometry(1, 1, n, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  };
  const geos = {
    bole: hull(0.74, radial + 4),       // a length of leader
    flare: hull(0.45, radial + 6),      // where it meets the ground
    limb: hull(0.5, radial - 2),        // a length of branch
    twig: hull(0.55, Math.max(8, sides + 2)),
    swell: hull(1.5, radial - 2),       // needles widening away from the trunk
    frond: hull(0.5, radial - 2),       // needles narrowing towards the tip
    sprig: spike(radial - 2),           // and the point they finish in
    crown: spike(radial + 4),           // the spire
    drift: spike(radial + 2),           // snow that has settled to a point
    loaf: hull(0.42, radial),           // and snow lying along a bough
    stone: new THREE.IcosahedronGeometry(1, 1),
    berry: new THREE.OctahedronGeometry(1, 0),
    blade: spike(3),
  };

  const treePools = [];
  const shadowPools = [];
  const treeHeights = [];
  // Which variants have no needles, because those are coloured as timber
  // rather than as foliage and the cast has to be told which it is drawing
  const treeBare = [];
  for (let i = 0; i < PROPS.trees.variants; i++) {
    const spec = SPECIES[i % SPECIES.length];
    const grown = growTree(THREE, 0x51ed27 + i * 7919, spec, geos);
    treeHeights.push(grown.height);
    treeBare.push(!spec.foliage);
    // Capacity is generous: variants are chosen per tree by hash and the
    // draw is short-circuited by `count`, so an unused pool costs nothing
    const pool = new Pool(THREE, grown.geometry, treeMat(grown.height),
      Math.ceil((bands * PROPS.treesPerBand + 60) / PROPS.trees.variants) * 3, true);
    /* One integer per streamed ring is the complete shadow-membership
       acceleration structure. It is rebuilt alongside the matrices, when
       those counts are already in hand, and costs no per-tree shadow test. */
    pool.shadowEnds = new Uint16Array(streamSpan + 1);
    treePools.push(pool);
    shadowPools.push(pool);
    group.add(pool.mesh);
  }

  /* The photoscan upgrader — the rocks and the stump take it below. The
     trees no longer do: every species is a card tree now. */
  const upgrader = createModelUpgrader(THREE);

  /* THE CARD MATERIAL, for the needled species and the bare ones alike.
     A sibling of `treeMat` — same wind, same instance-cast tinting through
     `surfaceOwn`, same shared shading — plus the atlas itself and a cutout,
     so the depth pass needs its own material or every card would cast a
     rectangle. Four things on top of that, all of them about a card being
     a picture of foliage rather than foliage:

     THE BACK OF A CARD IS NOT THE BACK OF A TREE. Three flips a double-sided
     material's normal on its back faces, so a card seen from behind was lit
     by a normal pointing into the ground and went black — half of every
     tree, from most angles. The baked normals point out of the canopy and
     are right from either side, so the flip is undone.

     NEEDLES LEAK LIGHT. A sprig is a few millimetres of green, and the sun
     comes through it: a wrap that carries the terminator a little past
     ninety degrees, and a lobe for the sun seen through the card from
     behind, which is the rim glow a conifer wears against a low sun. Both
     pay the real shadow test — the shared shading's recovered shadow is
     not in scope here, and a term that lit shaded needles would put a glow
     in every tree's own shade — but only on needle fragments, and only
     while the sun is where either term can do anything.

     THE WEATHER LOADS THE BRANCHES. The frost cards are baked; this is the
     storm's own snow settling on every up-facing needle by the dial the
     ground already answers to, so a whiteout leaves the forest white.

     AND THE FOOT OF THE TREE IS SOLID SNOW. The well `spruce.js` builds is
     owned by nobody — below zero, which the shared mix clamps and this
     material reads as "opaque, and the vertex colour is the whole answer",
     because the atlas has no opaque white texel to give it.

     `opts.frost` is the bare larch's snow: drawn a shade bluer than grey
     into an atlas that is otherwise luminance, and turned back into the
     prop snow colour per texel here. */
  const spruceMat = (height, atlas, opts = {}) => {
    const m = new THREE.MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
      alphaTest: opts.alphaTest === undefined ? 0.36 : opts.alphaTest,
      side: THREE.DoubleSide,
    });
    m.alphaToCoverage = true;
    const frost = opts.frost === true;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, air, { uSwayHeight: { value: height } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${OWN_DECL}${AIR_DECL}
        varying float vCardSolid;`)
        .replace('#include <color_vertex>', `#include <color_vertex>
        #if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
          vColor.rgb = mix( color, vColor.rgb, clamp( surfaceOwn, 0.0, 1.0 ) );
        #endif`)
        .replace('#include <begin_vertex>', SWAY)
        .replace('#include <project_vertex>', `#include <project_vertex>
        vN64Sheen = 1.0 - clamp( surfaceOwn, 0.0, 1.0 );
        vCardSolid = surfaceOwn < -0.5 ? 1.0 : 0.0;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        varying float vCardSolid;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        float n64FrostTexel = ${frost
    ? 'smoothstep(1.06, 1.16, diffuseColor.b / max(diffuseColor.r, 0.02))'
    : '0.0'};`)
        .replace('#include <alphamap_fragment>', `
        if (vCardSolid > 0.5) diffuseColor = vec4(vColor.rgb, 1.0);
        /* The sprig cells store needle luminance, not colour: the cast on
           the instance is the colour. Lift them back to needle brightness;
           frost (sheen 1) and bark (sheen ~0.65) keep the map's own level.
           Written as 1 − smoothstep(lo, hi, x): smoothstep with its edges
           reversed is undefined by the GLSL spec — most drivers guess the
           intent, the ones that don't draw garbage. */
        float n64Needle = 1.0 - smoothstep(0.05, 0.5, vN64Sheen);
        diffuseColor.rgb *= mix(1.0, 1.85, n64Needle);
        {
          float n64NeedleUp = dot(normalize(vNormal), viewMatrix[1].xyz);
          float n64Load = smoothstep(0.15, 0.75, n64NeedleUp) * uSnowFresh * n64Needle;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.839, 0.890, 0.957), n64Load * 0.55);
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.839, 0.890, 0.957) * 1.15, n64FrostTexel);
        #include <alphamap_fragment>`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize( vNormal );
        nonPerturbedNormal = normal;`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (n64Needle > 0.01 && uSunLevel > 0.02) {
          vec3 n64V = normalize(-vN64View);
          float n64NL = dot(normal, uSunView);
          float n64Wrap = clamp((n64NL + 0.55) / 1.55, 0.0, 1.0) - clamp(n64NL, 0.0, 1.0);
          float n64Through = clamp(-dot(uSunView, n64V), 0.0, 1.0);
          n64Through *= n64Through;
          n64Through *= n64Through;
          float n64Leak = n64Wrap * 0.35 + n64Through * 0.55;
          if (n64Leak > 0.01) {
            float n64Lit = 1.0;
            #if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
              n64Lit = getShadow( directionalShadowMap[ 0 ],
                directionalLightShadows[ 0 ].shadowMapSize,
                directionalLightShadows[ 0 ].shadowIntensity,
                directionalLightShadows[ 0 ].shadowBias,
                directionalLightShadows[ 0 ].shadowRadius,
                vDirectionalShadowCoord[ 0 ] );
            #endif
            reflectedLight.directDiffuse += diffuseColor.rgb * uSunTint
              * (uSunLevel * n64Lit * n64Leak * n64Needle * RECIPROCAL_PI);
          }
        }`);
    };
    return shading.apply(m, { cameraFade: true, sheen: 1, fogPull: FOG_PULL_TREE });
  };

  /* The bare species, first: card larches off a drawn atlas — see
     `createTwigAtlas` — built now, because a canvas has nothing to wait for.
     The two pools that wore the low-poly dead hardwoods keep every instance,
     cast, sway and shadow exactly where it was. */
  {
    const twig = createTwigAtlas(THREE);
    for (let i = 0; i < treePools.length; i++) {
      if (!treeBare[i]) continue;
      const spec = SPECIES[i % SPECIES.length];
      const g = growCardSpruce(THREE, 0x5be77a + i * 4211, spec, treeHeights[i], twig.layout);
      const old = treePools[i].mesh.geometry;
      treePools[i].mesh.geometry = g;
      old.dispose();
      treePools[i].mesh.material = spruceMat(treeHeights[i], twig.texture,
        { frost: true, alphaTest: 0.22 });
      treePools[i].mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: twig.texture,
        alphaTest: 0.22,
      });
    }
  }

  /* The needled species become photo-textured card conifers the moment
     their atlas lands: real fir sprigs on a few dozen instanced cards per
     tree (see spruce.js). Until the file arrives (or if it never does) the
     grown trees simply keep standing. */
  texLoader.load(
    new URL('../assets/textures/tree/spruce-card-atlas.webp', import.meta.url).href,
    (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 8;
      for (let i = 0; i < treePools.length; i++) {
        if (treeBare[i]) continue;
        const spec = SPECIES[i % SPECIES.length];
        const g = growCardSpruce(THREE, 0x3ac1f7 + i * 6367, spec, treeHeights[i]);
        const old = treePools[i].mesh.geometry;
        treePools[i].mesh.geometry = g;
        old.dispose();
        treePools[i].mesh.material = spruceMat(treeHeights[i], t);
        treePools[i].mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          map: t,
          alphaTest: 0.36,
        });
      }
    },
  );

  /* The shadow pass draws only the prefix that can reach its own camera.

     This used to be a fixed three-band prefix. Every forty-metre stream step
     therefore replaced one whole row of casters while some of their long,
     low-sun shadows could still land inside the map. The depth texture was
     rebuilt correctly in the background; the visible result was still a row
     of shadows switching on at once.

     The shadow camera already owns the exact volume that can contribute. Its
     eight world-space corners give a conservative z interval, and `rebuild`
     has precalculated the prefix end for every nearest-first band ring. One
     extra ring is retained around the interval. Thus a ring can enter or
     leave the submitted prefix only while every tree in it is at least forty
     metres outside the shadow volume: membership remains discrete and cheap,
     but its change is provably invisible. The interval is cached once per
     rendered shadow camera, not recomputed for all twelve tree variants. */
  const shadowCorner = new THREE.Vector3();
  let shadowFrame = -1;
  let shadowCameraId = -1;
  let shadowBands = streamSpan;

  function casterBands(renderer, shadowCamera) {
    if (!shadowCamera || !Number.isFinite(currentBand)) return streamSpan;
    const frame = renderer.info.render.frame;
    if (frame === shadowFrame && shadowCamera.id === shadowCameraId) return shadowBands;

    shadowFrame = frame;
    shadowCameraId = shadowCamera.id;
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          shadowCorner.set(
            x ? shadowCamera.right : shadowCamera.left,
            y ? shadowCamera.top : shadowCamera.bottom,
            z ? -shadowCamera.far : -shadowCamera.near,
          ).applyMatrix4(shadowCamera.matrixWorld);
          lo = Math.min(lo, shadowCorner.z);
          hi = Math.max(hi, shadowCorner.z);
        }
      }
    }

    /* Expand by two whole streamed bands, substantially more than the reach of
       the largest grown crown. A band endpoint may then cross this range
       without a branch touching the light frustum on the crossing frame. */
    const first = Math.floor(lo / band) - 2;
    const last = Math.floor(hi / band) + 2;
    shadowBands = Math.min(streamSpan, Math.max(
      0,
      Math.abs(first - currentBand),
      Math.abs(last - currentBand),
    ));
    return shadowBands;
  }

  function bindShadowPrefix(pool) {
    const mesh = pool.mesh;
    mesh.onBeforeShadow = (renderer, object, camera, shadowCamera) => {
      pool.full = mesh.count;
      const ring = casterBands(renderer, shadowCamera);
      const near = pool.shadowEnds[ring];
      if (near < mesh.count) mesh.count = near;
    };
    mesh.onAfterShadow = () => {
      mesh.count = pool.full;
    };
  }
  for (const pool of treePools) bindShadowPrefix(pool);

  // --- everything else ------------------------------------------------------
  /* THE MAST, which now flies the gate's own colour.

     It was a single dark grey for both panels, which meant the one thing on
     the course carrying a left/right decision said nothing about it until the
     lens above it happened to be mid-flash. The colour arrives per instance,
     so the geometry only has to be a white mast for the instance to tint —
     hence `compose` over a bare cylinder, which is here purely to give the
     vertex colour attribute the tinted material needs. */
  /* The old slalom-gate pole and beacon pools stood here. The stake-gate
     rework replaced them — gates are pairs of piste stakes now, lit by
     `pisteStakeLamps` — but the pools, their geometry and their compiled
     BEACON material survived it, empty: nothing ever called `.add` on
     either again. They spent a compiled program, two instance buffers and
     a slot in every band snapshot to draw nothing, so they are gone. */

  /* Five instanced calls make the ecology: one whole plant patch, two winter
     shrubs and two stone families. Shapes, snow masks and colours are baked
     now, before renderer.compile warms them; streaming later rewrites only
     matrices. Small vegetation receives light but does not cast a flickering
     sub-pixel shadow. Boulder shadows use the same conservative band prefix
     as trees, so distant instances never enter the depth pass. */
  const floraMaterial = floraMat();
  const stoneMaterial = rockMat();

  const plantVariants = [
    growPlantPatch(THREE, 0x63a91d, geos),
    growTussockPatch(THREE, 0x63a91d + 3317, geos),
  ];
  const plantPools = plantVariants.map((grownGeo, i) => new Pool(
    THREE, grownGeo, floraMaterial,
    Math.ceil((bands * BIOMES.plantCandidates + 32) / plantVariants.length),
  ));

  const shrubVariants = [
    growShrub(THREE, 0x2b7f41, geos, false),
    growShrub(THREE, 0x2b7f41 + 5827, geos, true),
    growDwarfPine(THREE, 0x2b7f41 + 9913, geos),
    growAlpineHeath(THREE, 0x2b7f41 + 14421, geos),
    growWinterBramble(THREE, 0x2b7f41 + 19937, geos),
  ];
  const shrubPools = shrubVariants.map((grownGeo, i) => new Pool(
    THREE, grownGeo, floraMaterial,
    Math.ceil((bands * BIOMES.shrubCandidates + 48) / shrubVariants.length),
  ));

  const boulderVariants = [
    growBoulder(THREE, 0x9d2b1f, geos, SNOWPACK.slate),
    growBoulder(THREE, 0x9d2b1f + 6151, geos, SNOWPACK.iron),
  ];
  const rockPools = boulderVariants.map((grown) => new Pool(
    THREE, grown.geometry, stoneMaterial,
    bands * (BIOMES.sideRockCandidates + 1) + 16,
  ));
  /* Natural rock buttresses along the mountain flanks */
  const cragVariants = [
    growCrag(THREE, 0x51c433, geos, SNOWPACK.slate),
    growCrag(THREE, 0x51c433 + 4877, geos, SNOWPACK.iron),
    growCrag(THREE, 0x51c433 + 9743, geos, SNOWPACK.slate),
  ];
  const cragPools = cragVariants.map((grown) => new Pool(
    THREE, grown.geometry, stoneMaterial, bands * 2 + 16,
  ));

  for (const p of plantPools) {
    p.mesh.name = 'alpine-plant-patches';
    p.mesh.userData.noShadow = true;
  }
  for (const p of shrubPools) {
    p.mesh.name = 'alpine-shrubs';
    p.mesh.userData.noShadow = true;
  }
  rockPools[0].mesh.name = 'slate-boulders';
  rockPools[1].mesh.name = 'iron-boulders';

  /* Real boulders — photoscanned ones now. Each pool trades its grown stone
     for a Poly Haven scan at the same height, wearing the scan's own
     texture with a snow dusting on every up-facing surface, sunk a little
     below grade so its downhill edge never stands on air. */
  const heightOfGrown = (grownGeo) => {
    grownGeo.computeBoundingBox();
    return grownGeo.boundingBox.max.y - grownGeo.boundingBox.min.y;
  };
  {
    const scans = ['rock_07.glb', 'rock_09.glb'];
    for (let i = 0; i < rockPools.length; i++) {
      upgrader.upgradeTextured(rockPools[i], scans[i],
        heightOfGrown(boulderVariants[i].geometry),
        (map) => photoMat(map, 0.62), 0.16);
    }
  }

  cragPools.forEach((p, i) => { p.mesh.name = `flank-crag-${i}`; });

  /* The flank buttresses go the same way: cliff-face photoscans, less snow
     — a near-vertical face holds a dusting at most. */
  {
    const scans = ['rock_face_01.glb', 'mountainside.glb', 'boulder_01.glb'];
    for (let i = 0; i < cragPools.length; i++) {
      upgrader.upgradeTextured(cragPools[i], scans[i],
        heightOfGrown(cragVariants[i].geometry),
        (map) => photoMat(map, 0.42), 0.20);
    }
  }

  /* One of the five shrub slots becomes a photoscanned stump: forest floor
     furniture where the bramble used to be, same streaming, same bands. It
     keeps the shrubs' no-shadow trade, and being under a metre it never
     needed the wind. */
  upgrader.upgradeTextured(shrubPools[4], 'tree_stump_01.glb',
    heightOfGrown(shrubVariants[4]), (map) => photoMat(map, 0.55), 0.06);
  for (const p of rockPools.concat(cragPools)) {
    p.shadowEnds = new Uint16Array(streamSpan + 1);
    shadowPools.push(p);
    bindShadowPrefix(p);
  }

  const alpineMat = (() => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uWoodTex: woodPlanksTex });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
        varying vec3 vAlpineWorldPos;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vAlpineWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vAlpineWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        varying vec3 vAlpineWorldPos;
        uniform sampler2D uWoodTex;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 woodSample = texture2D(uWoodTex, vAlpineWorldPos.xy * 0.45 + vAlpineWorldPos.yz * 0.45).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * woodSample * 5.9, 0.65);`);
    };
    return shading.apply(m);
  })();
  const avalancheFences = new Pool(
    THREE, avalancheFenceGeometry(THREE), alpineMat, bands * ALPINE.fence.sections[1],
  );
  const waymarks = new Pool(
    THREE, waymarkGeometry(THREE), alpineMat, bands,
  );
  const pisteStakes = new Pool(
    THREE, pisteStakeGeometry(THREE), alpineMat, bands * 4 + 32,
  );
  const pisteStakeLamps = new Pool(
    THREE, pisteStakeLampGeometry(THREE), pisteStakeLampMat(), pisteStakes.capacity, true,
  );
  pisteStakeLamps.mesh.userData.noShadow = true;
  pisteStakeLamps.mesh.name = 'piste-stake-lamps';
  avalancheFences.mesh.name = 'avalanche-fences';
  waymarks.mesh.name = 'swiss-waymarks';
  pisteStakes.mesh.name = 'piste-stakes';

  for (const p of [avalancheFences, waymarks, pisteStakes, pisteStakeLamps]) p.cullable = true;

  const sphereHull = (pool) => {
    const geometry = pool.mesh.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    return {
      center: geometry.boundingSphere.center.clone(),
      radius: geometry.boundingSphere.radius,
    };
  };
  const plantHulls = plantPools.map(sphereHull);
  const shrubHulls = shrubPools.map(sphereHull);
  const hullUp = new THREE.Vector3(0, 1, 0);
  const hullScale = new THREE.Vector3();
  const hullOffset = new THREE.Vector3();
  const hullCorner = new THREE.Vector3();
  const hullQ = new THREE.Quaternion();
  const hullTurn = new THREE.Quaternion();

  function hullRotation(yaw, normal) {
    if (normal) hullQ.setFromUnitVectors(hullUp, normal);
    else hullQ.identity();
    hullTurn.setFromAxisAngle(hullUp, yaw);
    return hullQ.multiply(hullTurn);
  }

  function placedSphereHull(hull, x, y, z, yaw, sx, sy, sz, normal) {
    hullScale.set(sx, sy, sz);
    hullOffset.copy(hull.center).multiply(hullScale)
      .applyQuaternion(hullRotation(yaw, normal));
    const r = hull.radius * Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz));
    return { x: x + hullOffset.x, z: z + hullOffset.z, r, top: y + hullOffset.y + r };
  }

  const fenceGeometry = avalancheFences.mesh.geometry;
  if (!fenceGeometry.boundingBox) fenceGeometry.computeBoundingBox();
  const fenceBox = fenceGeometry.boundingBox;
  const fenceCells = 5;
  const fenceCellWidth = (fenceBox.max.x - fenceBox.min.x) / fenceCells;
  const fenceCenterY = (fenceBox.min.y + fenceBox.max.y) * 0.5;
  const fenceCenterZ = (fenceBox.min.z + fenceBox.max.z) * 0.5;

  const pools = [
    ...plantPools, ...shrubPools, ...rockPools, ...cragPools,
    avalancheFences, waymarks, pisteStakes, pisteStakeLamps,
  ];
  pools.forEach((p) => group.add(p.mesh));
  const allPools = pools.concat(treePools);

  // --- collision -----------------------------------------------------------
  // Flat array of {x, z, r, kind, top}, rebuilt whenever the bands change.
  // A few hundred entries, scanned by z-window in the rider's step.
  const solids = [];
  // Slalom gates, remembered rather than merely drawn, so a run can be scored
  // for taking the line the poles are describing. Rebuilt with the bands.
  const gates = [];

  // --- band generation -----------------------------------------------------
  const tint = new THREE.Color();
  /* The four tree tints that used to sit here are gone. They were multipliers
     over vertex colours that were already bark and needle, so they had to
     stay near one — and four multipliers near one is not a colour scheme, it
     is a forest painted once. What replaced them is `castOf`, which is not a
     tint at all: it is the needle colour, and it can go anywhere a conifer
     goes because the tree's snow is no longer listening. See the head of the
     file. The shrub tints that sat beside them went with the shrubs. */
  const centres = [0, 0];
  const courseAbove = [0, 0];
  const courseBelow = [0, 0];
  const bankNormal = new THREE.Vector3();
  const floraNormal = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const treeNormal = new THREE.Vector3();

  /* Which way a trunk stands. A conifer grows towards the light rather than
     square to the hill, so this is the ground's own slope leaned most of the
     way back to vertical — plus a little scatter, because a stand where every
     tree agrees about the wind is a stand that was placed by a loop. The
     scatter is drawn from the band's stream, so it is as deterministic as
     everything else the coordinate decides.

     Two samples rather than `normalFrom`'s four, and forward differences
     rather than central ones, because the height under the trunk is already
     in hand. The step is a metre and a bit instead of thirty-five
     centimetres, which is not a compromise: a tree stands on metres of hill
     and should lean with the bank it is on, not with whatever wind ripple
     happens to be under its roots. */
  function treeLean(x, z, y, rnd) {
    const e = 1.25;
    const gx = (heightAt(x + e, z) - y) / e;
    const gz = (heightAt(x, z + e) - y) / e;
    return treeNormal
      .set(
        -gx * FOREST.lean + (rnd() - 0.5) * FOREST.wobble,
        1,
        -gz * FOREST.lean + (rnd() - 0.5) * FOREST.wobble,
      )
      .normalize();
  }

  /* The outside of the whole route, not merely the nearest branch. At a fork
     `centersAt` is ordered left to right, so choosing the extreme centre and
     then moving another half-width out puts a prop beyond both groomed ways
     and never on their island. */
  function outerEdgeAt(z, side) {
    centersAt(z, centres);
    return (side < 0 ? centres[0] : centres[1]) + side * corridorHalfAt(z);
  }

  /* Heading of the outer branch at a point, expressed as the Y rotation that
     makes a prop's local -Z point downhill. Markers use it directly, because
     their cross faces local +Z and therefore the approaching rider. Snow
     bridges add a quarter turn so their long X axis follows the contour of
     the side slope rather than pointing straight down it. */
  function courseYawAt(z, side) {
    const reach = 6;
    centersAt(z + reach, courseAbove);
    centersAt(z - reach, courseBelow);
    const upX = side < 0 ? courseAbove[0] : courseAbove[1];
    const downX = side < 0 ? courseBelow[0] : courseBelow[1];
    return Math.atan2(-(downX - upX), reach * 2);
  }


  /* A fork island is useful habitat for low vegetation. Decorative stone
     stays beyond the outer lips so it never blocks either branch. */
  function vergeXAt(z, side, distance, islandDraw, spreadDraw) {
    centersAt(z, centres);
    const half = corridorHalfAt(z);
    if (centres[0] !== centres[1] && islandDraw < 0.30) {
      const gap = (centres[1] - centres[0]) * 0.5 - half;
      if (gap > 2.2) {
        return (centres[0] + centres[1]) * 0.5
          + (spreadDraw * 2 - 1) * (gap - 1.2);
      }
    }
    const c = side < 0 ? centres[0] : centres[1];
    return c + side * (half + distance);
  }

  function setFloraNormal(x, z) {
    normalFrom(heightAt, x, z, floraNormal);
    return floraNormal.lerp(worldUp, 0.58).normalize();
  }

  function stoneTransform(grown, groundY, sx, sy, sz) {
    const y = groundY - grown.bottom * sy - 0.04;
    return {
      y,
      r: grown.radius * Math.max(sx, sz) * 0.88,
      top: y + grown.top * sy,
    };
  }
  function boulderTransform(v, groundY, sx, sy, sz) {
    return stoneTransform(boulderVariants[v], groundY, sx, sy, sz);
  }

  /* WHERE A STONE ACTUALLY SITS, which is not what one terrain sample says.

     A rock was bedded by taking the height under its centre and dropping the
     mesh four centimetres. That is exact for a rock on level ground and wrong
     for every other rock on the mountain: this hill has four octaves of
     relief on it, so the ground under a stone's uphill edge and the ground
     under its downhill edge are routinely a third of a metre apart, and a
     centre sample splits the difference — half the stone buried, the other
     half standing on air. At the sizes below it stops being subtle. A
     seven-metre erratic bedded off its centre floats a metre clear of the
     snow on its downhill side.

     The fix is to bed against the LOWEST ground the footprint covers rather
     than the average, plus a sink that scales with the stone. Sampling the
     minimum is the whole of it: a stone whose base is at or below every point
     of ground it overlaps cannot show daylight underneath, whatever the
     surface is doing. It is four extra height samples, paid once when a band
     is rebuilt and never during play.

     Sinking by a share of the radius rather than a constant is the other
     half. Four centimetres is a lot of a pebble and nothing at all of an
     erratic, and a big rock that is merely *resting on* the snow reads as
     dropped in — real ones are half buried, because the snow drifted up
     around them. */
  function beddedGroundY(x, z, r, sink) {
    let lowest = heightAt(x, z);
    const reach = Math.max(0.35, r * 0.82);
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + 0.6;
      const h = heightAt(x + Math.cos(a) * reach, z + Math.sin(a) * reach);
      if (h < lowest) lowest = h;
    }
    return lowest - sink;
  }

  /* Three terrain samples along a 42 m uphill sightline keep a boulder from
     becoming a blind crest ambush. This is paid only for the sparse accepted
     candidate while its band is rebuilt, never during play. */
  function visibleFromApproach(x, z, top) {
    const reach = 42;
    const eyeY = heightAt(x, z + reach) + 1.55;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const sampleZ = z + reach * (1 - t);
      const sightY = lerp(eyeY, top, t);
      if (heightAt(x, sampleZ) > sightY - 0.08) return false;
    }
    return true;
  }

  function clearOfBandHazards(x, z, r, hazards, margin = 1.5) {
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      const reach = r + h.r + margin;
      const dx = x - h.x;
      const dz = z - h.z;
      if (dx * dx + dz * dz < reach * reach) return false;
    }
    return true;
  }

  function place(b, spacing = 1) {
    const rnd = stream(b * 2654435761);
    const z0 = b * band;
    const travelled = Math.max(0, -z0);
    // Candidate thinning changes average distance without moving the
    // surviving props. A factor of five therefore keeps one in five.
    const density = 1 / Math.max(1, spacing);

    // Every offset below is measured from the middle of the piste at that
    // point, never from the world's x = 0. The route wanders, and it forks,
    // so an absolute placement plants a forest across the run.

    /* How far down the mountain this band is, as the treeline sees it: nearly
       nothing at the top of the run, everything a couple of kilometres below.
       One value for the whole band, because a band is forty metres and the
       treeline moves over hundreds. */
    const down = smoothstep(FOREST.line[0], FOREST.line[1], travelled);
    /* The chapter owns the second factor: the treeline used to close over
       the first 1.6 km and then hold for ever; now a glacier shelf or a
       wind crest thins the stand back to scattered survivors and a forest
       vale doubles down, for as long as the run goes. z-keyed like every
       other placement fact, so bands re-stream identically. */
    const lineCover = lerp(FOREST.lineCover[0], FOREST.lineCover[1], down)
      * chapterTreesAt(z0 + band * 0.5);
    const lineScale = lerp(FOREST.lineScale[0], FOREST.lineScale[1], down);

    /* --- readable rock hazard -------------------------------------------

       At most one band in any adjacent pair may own a boulder, its silhouette
       is visible from the uphill approach, and its finite top lets an airborne
       rider clear it. The candidate is authored before trees so their existing
       random stream can stay byte-for-byte unchanged while placements too
       close to the rock are simply refused.

       IT STANDS ON THE VERGE NOW, not on the corduroy. It used to be placed
       inside the corridor — a lane clear of the centre line, but on the
       groomed snow — and a groomed piste with a boulder parked on it is not a
       piste, it is a slalom course somebody left a rock on. Out here it is the
       thing it always was for a rider who has drifted off the line: the
       shoulder is exactly where a blown turn puts you, so a rock on it still
       has to be read and still has to be avoided, and the run down the middle
       is now genuinely clean. */
    const bandHazards = [];
    const hazardRoll = hash2(b, 3400, 227);
    const previousRoll = hash2(b - 1, 3400, 227);
    if (travelled >= BIOMES.hazardFrom
      && hazardRoll < BIOMES.hazardChance
      && previousRoll >= BIOMES.hazardChance
      && hash2(b, 3411, 227) < density) {
      const padding = BIOMES.hazardPadding;
      const z = z0 + padding + hash2(b, 3401, 227) * (band - padding * 2);
      {
        centersAt(z, centres);
        const leftBranch = hash2(b, 3402, 227) < 0.5;
        const branch = leftBranch ? centres[0] : centres[1];
        // At a fork, use the outside shoulder of the chosen branch. An
        // inward rock can be safely off one centre line yet sit squarely on
        // the other; the two outer shoulders preserve both routes at once.
        const side = centres[0] !== centres[1]
          ? (leftBranch ? -1 : 1)
          : (hash2(b, 3403, 227) < 0.5 ? -1 : 1);
        const v = hash2(b, 3404, 227) < 0.52 ? 0 : 1;
        const s = lerp(1.28, 2.15, hash2(b, 3405, 227));
        const sx = s * lerp(0.90, 1.10, hash2(b, 3406, 227));
        const sy = s * lerp(0.84, 1.08, hash2(b, 3407, 227));
        const sz = s * lerp(0.88, 1.12, hash2(b, 3408, 227));
        const half = corridorHalfAt(z);
        const rough = boulderTransform(v, 0, sx, sy, sz);
        /* Clear of the corduroy by its own radius plus the margin, and no
           further out than the powder band the rider can still reach — past
           that the deep snow has already turned them round and the rock would
           only ever be scenery with a collider on it. */
        const minOff = half + BIOMES.hazardEdge + rough.r;
        const maxOff = half + BIOMES.hazardOut - rough.r;

        if (maxOff >= minOff) {
          const off = lerp(minOff, maxOff, hash2(b, 3409, 227));
          const x = branch + side * off;
          /* Bedded against the lowest ground its own footprint covers, exactly
             like the scenic stones — which it did not need while it stood on
             the corduroy, because a groomer leaves a surface flat enough that
             the height under a boulder's middle is the height under all of it.
             The shoulder is not that surface: it carries the full mogul and
             chatter relief, and a two-metre rock bedded off its centre there
             stands half a metre clear of the snow on its downhill side. */
          const groundY = beddedGroundY(x, z, rough.r, 0.05 + rough.r * 0.16);
          const shape = boulderTransform(v, groundY, sx, sy, sz);
          if (visibleFromApproach(x, z, shape.top)
            && rockPools[v].add(
              x, shape.y, z, hash2(b, 3410, 227) * TAU, sx, sy, sz,
            )) {
            const solid = {
              key: `boulder:${b}`,
              type: 'boulder', x, z, r: shape.r,
              kind: HARD, groundY, top: shape.top, cameraPad: 0.55, volume: true,
            };
            solids.push(solid);
            bandHazards.push(solid);
          }
        }
      }
    }

    // --- forest, strictly on lower verges beside the corridor --------------
    for (let i = 0; i < PROPS.treesPerBand; i++) {
      const z = z0 + rnd() * band;
      const half = corridorHalfAt(z);
      centersAt(z, centres);
      // Outside whichever branch is on that side, and — when the run has
      // forked — sometimes on the island between the two, which is what
      // makes an island read as a place rather than a gap
      const side = rnd() < 0.5 ? -1 : 1;
      const island = centres[0] !== centres[1] && rnd() < 0.25;
      let x;
      if (island) {
        const gap = (centres[1] - centres[0]) / 2 - half;
        if (gap < 5.0) continue;
        x = (centres[0] + centres[1]) / 2 + (rnd() * 2 - 1) * (gap - 2.2);
      } else {
        const c = side < 0 ? centres[0] : centres[1];
        /* Strictly confined to the lower valley floor near the verge.
           Trees NEVER grow on the steep mountain slopes, flanks, or peaks.

           HOW DEEP the band goes is a field rather than a constant, and
           that is the other half of the tunnel fix. Sixteen metres on both
           sides for the whole run is a hedge of fixed thickness however
           the density inside it varies: the eye reads the OUTLINE, and the
           outline never moved. This one runs from a nine-metre fringe to a
           thirty-five-metre wood, keyed on z and on the side — the two
           verges are sampled a long way apart in the field's own space, so
           a deep wood on the left against a thin fringe on the right is an
           ordinary thing to ride past rather than a coincidence. */
        const depth = 9 + 34 * smoothstep(0.32, 0.74,
          noise2(z * 0.0026, side * 37.3, 421));
        x = c + side * (half + PROPS.verge + Math.pow(rnd(), 1.35) * depth);
      }
      const c = side < 0 ? centres[0] : centres[1];
      // Raised in step with the deepest the band above can reach; the old
      // twenty was the real ceiling on forest depth whatever asked for more.
      if (!island && Math.abs(x - c) > half + 50.0) continue;

      /* Whether anything grows here at all. The stand field is sampled at
         the tree's own position, so a clearing has an edge that runs across
         the hill wherever the field puts it instead of starting and stopping
         at a band boundary — without it the treeline is a uniform hedge. */
      const stand = FOREST.clearing + (1 - FOREST.clearing) * smoothstep(
        FOREST.standBand[0], FOREST.standBand[1],
        noise2(x * FOREST.standFreqX, z * FOREST.standFreqZ, FOREST.standSeed),
      );
      if (rnd() > stand * lineCover) continue;
      // Mostly small, with the odd one standing over them.
      const v = (rnd() * treePools.length) | 0;
      let s = lerp(FOREST.size[0], FOREST.size[1],
        Math.pow(rnd(), FOREST.sizeBias)) * lineScale;
      // …and once in a while a tree that got away with it. See `FOREST.veteran`.
      const vet = treeHeights[v] >= FOREST.veteran.from
        && rnd() < FOREST.veteran.chance;
      if (vet) {
        s = (lerp(FOREST.veteran.height[0], FOREST.veteran.height[1], rnd())
          / treeHeights[v]) * lineScale;
      }
      const radius = 0.5 + s * 0.45;
      /* THE VERGE IS MEASURED TO THE HULL, not to the trunk, and it has to be
         because the two are metres apart on the trees that matter. `verge` is
         a trunk's own girth of clearance, which is the whole answer for the
         stand — a full-size spruce carries a metre of collision circle — and
         no answer at all for a veteran: twenty-six metres of tree is a hull
         nearly two metres across, so a draw that put its trunk at the near end
         of the range hung the circle over the corduroy. A rider clipping
         nothing, on groomed snow, is exactly the promise this file makes.

         Pushed out rather than refused, because refusing thins the treeline at
         precisely the distance the eye reads it from. The push is away from the
         nearest centre line, which on an island means towards its middle — and
         if the island is too narrow to hold the hull from both branches at
         once, then there is no room and the tree does not grow there.

         The stand field above is still sampled at the drawn position and not
         at this one. It decides whether a tree grows in this part of the hill
         at all, over a wavelength of tens of metres; moving the trunk a metre
         inside that answer changes nothing about it, and re-sampling would
         cost a noise fetch on every tree to relocate a handful. */
      {
        // `centres` is already this row's pair; the nearer of the two is the
        // line the hull has to clear.
        const near = Math.abs(x - centres[0]) < Math.abs(x - centres[1])
          ? centres[0] : centres[1];
        const clear = half + PROPS.verge + radius + 0.4;
        if (Math.abs(x - near) < clear) {
          if (island && (centres[1] - centres[0]) * 0.5 < clear + 1.2) continue;
          x = near + (Math.sign(x - near) || side) * clear;
        }
      }
      const y = heightAt(x, z);
      const yaw = rnd() * TAU;
      const sy = s * (0.85 + rnd() * 0.35);
      const normal = treeLean(x, z, y, rnd);
      // Trees never grow on steep mountain slopes
      if (normal.y < 0.88) continue;
      const colour = castOf(treeBare[v], v, rnd(), tint);
      if (hash2(b, 3800 + i, 239) > density) continue;
      if (!clearOfBandHazards(x, z, radius, bandHazards, 2.0)) continue;
      if (!treePools[v].addOnSlope(x, y, z, yaw, s, sy, s, normal, colour)) continue;
      solids.push({ x, z, r: radius, kind: HARD, top: 99 });
    }

    /* --- continuous vegetation biomes -----------------------------------

       Dedicated hash channels make these loops independent of the forest,
       gates. A fixed candidate budget is filtered by smooth ecology
       weights, so density changes continuously even though instances are
       rewritten only at an invisible streamed boundary. */
    const eco = {};
    for (let i = 0; i < BIOMES.plantCandidates; i++) {
      const z = z0 + hash2(b, 3200 + i, 211) * band;
      const side = hash2(b, 3220 + i, 211) < 0.5 ? -1 : 1;
      const distance = lerp(1.2, 75, Math.pow(hash2(b, 3240 + i, 211), 1.25));
      const x = vergeXAt(
        z, side, distance,
        hash2(b, 3260 + i, 211), hash2(b, 3280 + i, 211),
      );
      ecologyAt(x, z, eco);

      /* Multi-scale procedural density: alternating groves, tight clumps & clearings */
      const groveNoise = noise2(x * 0.022, z * 0.016, 733);
      const clumpNoise = Math.pow(0.5 + 0.5 * snoise2(x * 0.075, z * 0.075, 419), 2.2);
      const sideAsymmetry = 0.5 + 0.5 * snoise2(z * 0.009, side * 12.0, 911);
      const dynamicDensity = clamp01(
        (0.12 + 0.55 * groveNoise + 0.48 * clumpNoise) * (0.45 + 0.55 * sideAsymmetry) * density
      );

      const cover = clamp01(0.15 + 0.70 * Math.max(
        eco.alpine, eco.heath * 0.78, eco.exposure * 0.65,
      ));
      if (hash2(b, 3300 + i, 211) > cover * dynamicDensity) continue;
      const pv = Math.floor(hash2(b, 3210 + i, 211) * plantPools.length);
      const y = heightAt(x, z) - 0.02;
      const s = lerp(0.60, 1.65, hash2(b, 3320 + i, 211)) * (0.85 + 0.35 * clumpNoise);
      const sy = s * lerp(0.78, 1.22, hash2(b, 3360 + i, 211));
      const yaw = hash2(b, 3340 + i, 211) * TAU;
      const normal = setFloraNormal(x, z);
      if (!plantPools[pv].addOnSlope(x, y, z, yaw, s, sy, s, normal)) continue;
      solids.push({
        ...placedSphereHull(plantHulls[pv], x, y, z, yaw, s, sy, s, normal),
        type: 'plant', kind: SOFT, drag: PROPS.shrubDrag * 0.5,
      });
    }

    for (let i = 0; i < BIOMES.shrubCandidates; i++) {
      const z = z0 + hash2(b, 3000 + i, 223) * band;
      const side = hash2(b, 3020 + i, 223) < 0.5 ? -1 : 1;
      const distance = lerp(1.8, 85, Math.pow(hash2(b, 3040 + i, 223), 1.2));
      const x = vergeXAt(
        z, side, distance,
        hash2(b, 3060 + i, 223), hash2(b, 3080 + i, 223),
      );
      ecologyAt(x, z, eco);

      /* Multi-scale procedural density: dense alpine thickets vs open snowy basins */
      const groveNoise = noise2(x * 0.020, z * 0.015, 617);
      const thicketNoise = Math.pow(0.5 + 0.5 * snoise2(x * 0.065, z * 0.065, 827), 2.0);
      const sideAsymmetry = 0.5 + 0.5 * snoise2(z * 0.008, side * 10.0, 353);
      const dynamicDensity = clamp01(
        (0.10 + 0.58 * groveNoise + 0.50 * thicketNoise) * (0.40 + 0.60 * sideAsymmetry) * density
      );

      const shrubCover = clamp01(0.15 + 0.72 * Math.max(
        eco.heath, eco.understory, eco.avalanche * 0.45, eco.alpine * 0.35,
      ));
      if (hash2(b, 3100 + i, 223) > shrubCover * dynamicDensity) continue;
      const v = Math.floor(hash2(b, 3120 + i, 223) * shrubPools.length);
      const y = heightAt(x, z) - 0.05;
      const s = lerp(0.70, 1.85, hash2(b, 3140 + i, 223)) * (0.85 + 0.35 * thicketNoise);
      const sy = s * lerp(0.80, 1.30, hash2(b, 3180 + i, 223));
      const yaw = hash2(b, 3160 + i, 223) * TAU;
      const normal = setFloraNormal(x, z);
      if (!shrubPools[v].addOnSlope(x, y, z, yaw, s, sy, s, normal)) continue;
      solids.push({
        ...placedSphereHull(shrubHulls[v], x, y, z, yaw, s, sy, s, normal),
        type: 'shrub', kind: SOFT,
      });
    }

    /* Occasional natural glacial erratics along the mountain verge */
    for (let i = 0; i < BIOMES.sideRockCandidates; i++) {
      const z = z0 + hash2(b, 3500 + i, 229) * band;
      const side = hash2(b, 3520 + i, 229) < 0.5 ? -1 : 1;
      const grade = hash2(b, 3600 + i, 229);
      const s = lerp(BIOMES.stoneSize[0], BIOMES.stoneSize[1], grade);
      const distance = lerp(12.0, 60, Math.pow(hash2(b, 3540 + i, 229), 1.3))
        + s * 1.5;
      const x = outerEdgeAt(z, side) + side * distance;
      ecologyAt(x, z, eco);
      const rockCover = clamp01(0.12 + 0.50 * Math.max(eco.talus, eco.exposure));
      if (hash2(b, 3560 + i, 229) > rockCover) continue;
      const v = hash2(b, 3580 + i, 229) < eco.exposure ? 0 : 1;
      const sx = s * lerp(0.85, 1.15, hash2(b, 3620 + i, 229));
      const sy = s * lerp(0.75, 1.08, hash2(b, 3640 + i, 229));
      const sz = s * lerp(0.85, 1.15, hash2(b, 3660 + i, 229));
      const rough = boulderTransform(v, 0, sx, sy, sz);
      const groundY = beddedGroundY(x, z, rough.r, 0.05 + rough.r * 0.16);
      const shape = boulderTransform(v, groundY, sx, sy, sz);
      if (hash2(b, 3690 + i, 229) > density) continue;
      if (!clearOfBandHazards(x, z, shape.r, bandHazards, 1.0)) continue;
      if (!rockPools[v].add(
        x, shape.y, z, hash2(b, 3680 + i, 229) * TAU, sx, sy, sz,
      )) continue;
      solids.push({
        type: 'rock', x, z, r: shape.r,
        kind: JUMPABLE, top: shape.top, cameraPad: 0.55, volume: true,
      });
    }

    /* Natural rock buttresses along the mountain flanks */
    if (travelled >= BIOMES.cragFrom
      && hash2(b, 3700, 233) < BIOMES.cragChance * density) {
      const z = z0 + 5 + hash2(b, 3701, 233) * (band - 10);
      const side = hash2(b, 3702, 233) < 0.5 ? -1 : 1;
      const distance = lerp(BIOMES.cragOut[0], BIOMES.cragOut[1], hash2(b, 3703, 233));
      const x = outerEdgeAt(z, side) + side * distance;
      ecologyAt(x, z, eco);
      const v = Math.floor(hash2(b, 3705, 233) * cragPools.length);
      const s = lerp(BIOMES.cragSize[0], BIOMES.cragSize[1], hash2(b, 3706, 233));
      const sx = s * lerp(0.88, 1.22, hash2(b, 3707, 233));
      const sy = s * lerp(0.90, 1.35, hash2(b, 3708, 233));
      const sz = s * lerp(0.88, 1.22, hash2(b, 3709, 233));
      const grown = cragVariants[v];
      const rough = stoneTransform(grown, 0, sx, sy, sz);
      const groundY = beddedGroundY(x, z, rough.r, 0.4 + rough.r * 0.22);
      const shape = stoneTransform(grown, groundY, sx, sy, sz);
      const yaw = (side < 0 ? Math.PI / 2 : -Math.PI / 2)
        + (hash2(b, 3710, 233) - 0.5) * 0.9;
      if (cragPools[v].add(x, shape.y, z, yaw, sx, sy, sz)) {
        solids.push({
          type: 'rock', x, z, r: shape.r,
          kind: HARD, top: shape.top, cameraPad: 0.55, volume: true,
        });
      }
    }

    // --- alpine infrastructure --------------------------------------------

    /* Avalanche fences live high on the OUTER bank, never between forked
       branches. A cluster is two or three adjacent six-metre sections along
       the contour, each planted and tilted from its own terrain sample. All
       choices come from hash channels reserved for this feature, so this does
       not consume `rnd` and cannot move gameplay-bearing props downstream. */
    let fenceSide = 0;
    if (travelled >= ALPINE.fence.from
      && hash2(b, 2001, 141) < ALPINE.fence.chance * density) {
      fenceSide = hash2(b, 2002, 141) < 0.5 ? -1 : 1;
      const sections = ALPINE.fence.sections[0]
        + (hash2(b, 2003, 141) < 0.38 ? 1 : 0);
      // Keep even a three-section cluster inside the band that owns it, so
      // recycling a far band cannot pop the near end of a contour line.
      const padding = 10;
      const centreZ = z0 + padding + hash2(b, 2004, 141) * (band - padding * 2);
      const margin = lerp(ALPINE.fence.margin[0], ALPINE.fence.margin[1],
        hash2(b, 2005, 141));
      const scale = lerp(ALPINE.fence.scale[0], ALPINE.fence.scale[1],
        hash2(b, 2006, 141));

      for (let i = 0; i < sections; i++) {
        const z = centreZ + (i - (sections - 1) * 0.5) * ALPINE.fence.step;
        const stagger = (hash2(b, 2010 + i, 141) - 0.5) * 1.4;
        const x = outerEdgeAt(z, fenceSide) + fenceSide * (margin + stagger);
        const y = heightAt(x, z) + 0.06;
        normalFrom(heightAt, x, z, bankNormal);
        const yaw = courseYawAt(z, fenceSide) + Math.PI / 2
          + (hash2(b, 2020 + i, 141) - 0.5) * 0.10;
        const sy = scale * (0.94 + hash2(b, 2030 + i, 141) * 0.12);
        if (avalancheFences.addOnSlope(
          x, y, z, yaw, scale, sy, scale, bankNormal,
        )) {
          const contact = { hit: false };
          const rotation = hullRotation(yaw, bankNormal);
          for (let cell = 0; cell < fenceCells; cell++) {
            const localX = fenceBox.min.x + fenceCellWidth * (cell + 0.5);
            hullOffset.set(localX * scale, fenceCenterY * sy, fenceCenterZ * scale)
              .applyQuaternion(rotation);
            let radius = 0;
            let top = -Infinity;
            for (const edgeX of [localX - fenceCellWidth * 0.5,
              localX + fenceCellWidth * 0.5]) {
              for (const edgeY of [fenceBox.min.y, fenceBox.max.y]) {
                for (const edgeZ of [fenceBox.min.z, fenceBox.max.z]) {
                  hullCorner.set(edgeX * scale, edgeY * sy, edgeZ * scale)
                    .applyQuaternion(rotation);
                  radius = Math.max(radius, Math.hypot(
                    hullCorner.x - hullOffset.x,
                    hullCorner.z - hullOffset.z,
                  ));
                  top = Math.max(top, y + hullCorner.y);
                }
              }
            }
            solids.push({
              x: x + hullOffset.x, z: z + hullOffset.z,
              r: radius + 0.03, type: 'fence', kind: HARD, top,
              cameraPad: 0.55, volume: true, contact,
            });
          }
        }
      }
    }

    /* A piste marker sits just beyond the outer groomed edge. At a fork this
       means left of the left branch or right of the right one — never on the
       island and never over either line. If a fence happens to occupy the
       same band, the marker normally takes the opposite side so the two rare
       accents do not collapse into one clump. */
    if (travelled >= ALPINE.waymark.from
      && hash2(b, 2101, 151) < ALPINE.waymark.chance) {
      let side = hash2(b, 2102, 151) < 0.5 ? -1 : 1;
      if (fenceSide && hash2(b, 2103, 151) < 0.75) side = -fenceSide;
      const padding = 6;
      const z = z0 + padding + hash2(b, 2104, 151) * (band - padding * 2);
      const margin = lerp(ALPINE.waymark.margin[0], ALPINE.waymark.margin[1],
        hash2(b, 2105, 151));
      const x = outerEdgeAt(z, side) + side * margin;
      const y = heightAt(x, z) + 0.03;
      const yaw = courseYawAt(z, side)
        + (hash2(b, 2106, 151) - 0.5) * 0.08;
      const scale = lerp(ALPINE.waymark.scale[0], ALPINE.waymark.scale[1],
        hash2(b, 2107, 151));
      waymarks.add(x, y, z, yaw, scale, scale, scale);
    }

    // --- piste boundary guide stakes & airfield waypoints ------------------
    // Slender airfield guiding poles placed rhythmically along the outer
    // left and right boundaries of the groomed corduroy. They frame the course
    // down the mountain with warm airfield amber lights.
    // Selected pairs along the runway act as the waypoint gates so we do not
    // have duplicate poles or clutter the groomed track.
    const stakeStep = 18;
    const numStakes = Math.floor(band / stakeStep);
    const stakeAirfield = new THREE.Color('#ff7800');
    const stakeWaypoint = new THREE.Color('#ffa818');

    for (let k = 0; k < numStakes; k++) {
      const z = z0 + k * stakeStep + 9;
      // Designate every 8th stake pair (~144m) as a scoring waypoint gate
      const isWaypoint = (Math.round(-z / stakeStep) % 8 === 0);
      const activeColor = isWaypoint ? stakeWaypoint : stakeAirfield;
      const xLeft = outerEdgeAt(z, -1) - 0.35;
      const xRight = outerEdgeAt(z, 1) + 0.35;
      const yLeft = heightAt(xLeft, z);
      const yRight = heightAt(xRight, z);
      const yawLeft = courseYawAt(z, -1);
      const yawRight = courseYawAt(z, 1);

      pisteStakes.add(xLeft, yLeft, z, yawLeft, 1, 1, 1);
      pisteStakeLamps.add(xLeft, yLeft, z, yawLeft, 1, 1, 1, tint.copy(activeColor));

      pisteStakes.add(xRight, yRight, z, yawRight, 1, 1, 1);
      pisteStakeLamps.add(xRight, yRight, z, yawRight, 1, 1, 1, tint.copy(activeColor));

      if (isWaypoint) {
        const midX = (xLeft + xRight) * 0.5;
        const half = (xRight - xLeft) * 0.5;
        gates.push({
          x: midX,
          z: z,
          half: half,
          taken: takenGates.has(z),
          warm: true,
        });
      }
    }
  }

  /* Which gates the run has already crossed, by their slot z — deterministic
     per seed, so the same gate gets the same key on every rebuild. Without
     this a rebuild re-pushed every gate with `taken: false`, and since a
     rebuild happens every band, about a third of the gates just passed
     re-lit from their dimmed ember to full brightness behind the rider. */
  const takenGates = new Set();
  /* A band's density is fixed when it first enters the streamed window.
     Keeping it thereafter means a change of speed only affects newly created
     scenery instead of making nearby trees pop in and out. */
  const spacingByBand = new Map();

  /* One placed band's complete contribution, captured straight out of the
     pools it just wrote into — no instrumentation on the write path, just a
     slice of each instance buffer between the marks taken either side of
     `place`. See the long note in `rebuild`. */
  const bandCache = new Map();

  function snapshotBand(spacing, startN, solidFrom, gateFrom) {
    const poolData = [];
    for (let i = 0; i < allPools.length; i++) {
      const pool = allPools[i];
      const from = startN[i];
      const count = pool.n - from;
      if (count <= 0) { poolData.push(null); continue; }
      const colors = pool.tinted && pool.mesh.instanceColor
        ? pool.mesh.instanceColor.array.slice(from * 3, pool.n * 3)
        : null;
      poolData.push({
        m: pool.mesh.instanceMatrix.array.slice(from * 16, pool.n * 16),
        c: colors,
      });
    }
    return {
      spacing,
      pools: poolData,
      solids: solids.slice(solidFrom),
      gates: gates.slice(gateFrom),
    };
  }

  // One reused map for the contact re-sharing below; never escapes a replay.
  const contactRemap = new Map();

  function replayBand(rec) {
    for (let i = 0; i < allPools.length; i++) {
      const data = rec.pools[i];
      if (!data) continue;
      const pool = allPools[i];
      const want = data.m.length / 16;
      // The order differs from the order it was captured in, so a pool can
      // run out here where it did not before. Dropping the tail is the same
      // thing a full rebuild does, and for the same reason: the far ones go.
      const room = pool.capacity - pool.n;
      const count = want < room ? want : room;
      if (count <= 0) continue;
      const src = count === want ? data.m : data.m.subarray(0, count * 16);
      pool.mesh.instanceMatrix.array.set(src, pool.n * 16);
      if (data.c && pool.mesh.instanceColor) {
        const cs = count === want ? data.c : data.c.subarray(0, count * 3);
        pool.mesh.instanceColor.array.set(cs, pool.n * 3);
      }
      pool.n += count;
    }
    /* Fresh objects: `collide` writes `hit` onto these, and a shared one
       would carry that into every later rebuild. The spread alone was not
       enough for that, twice over. The snapshot's records ARE the live
       objects of the band that was on screen when it was captured — `slice`
       copies the array, not its entries — so a shrub brushed or a trunk
       grazed after the capture wrote `hit: true` straight into the cache,
       and every replay of that band restored the prop pre-struck: silent to
       ride through, permanently inert. And a fence's cells share one
       `contact` record so a strike counts once per fence — spread copies the
       *reference*, which stitched every replay of the band (and the cached
       original) into one contact whose `hit` never reset. Both transients
       are cleared here, and shared contacts are re-shared per replay. */
    contactRemap.clear();
    for (let i = 0; i < rec.solids.length; i++) {
      const s = { ...rec.solids[i], hit: false, grazed: false };
      if (s.contact) {
        let fresh = contactRemap.get(s.contact);
        if (!fresh) {
          fresh = { hit: false };
          contactRemap.set(s.contact, fresh);
        }
        s.contact = fresh;
      }
      solids.push(s);
    }
    for (let i = 0; i < rec.gates.length; i++) {
      const g = rec.gates[i];
      gates.push({ ...g, taken: takenGates.has(g.z) });
    }
  }

  function rebuild(riderZ, currentSpacing) {
    allPools.forEach((p) => p.begin());
    solids.length = 0;
    for (let i = 0; i < gates.length; i++) {
      if (gates[i].taken) takenGates.add(gates[i].z);
    }
    // Passed gates scroll uphill and out of the stream; their keys must not
    // accumulate for the length of an endless run.
    if (takenGates.size > 256) {
      const horizon = riderZ + (behind + 2) * band;
      for (const zKey of takenGates) if (zKey > horizon) takenGates.delete(zKey);
    }
    gates.length = 0;

    /* Nearest band first, spiralling outward, rather than a straight sweep
       from behind to ahead. Every band is generated from its own seed, so the
       order changes nothing about the mountain — but it means the instances
       standing near the rider occupy the low indices of every pool, and the
       shadow pass can draw the smallest safe prefix selected from the
       pre-recorded ring ends. It also means that if a pool ever runs out of
       capacity, the trees dropped are the far ones, which is the right way
       round. */
    const bi = Math.floor(riderZ / band);
    /* THE SAME BAND, PLACED ONCE.

       This used to run `place` for all eighteen streamed bands on every
       forty-metre crossing, and `place` is the expensive half of this file:
       a couple of thousand candidates, each costing terrain height samples
       and several noise fields. Profiled, that was a 5.6-21.8 ms stall
       roughly every 1.7 seconds of riding - the one clean, recurring,
       self-inflicted hitch in the frame clock.

       Almost none of that work was new. Crossing one boundary retires one
       band and admits one; the other seventeen are the same ground, and a
       band is a pure function of its index and the world seed, so what they
       produce cannot have changed. What DOES change is where each lands in
       the pools, because the fill order is nearest-first so the shadow pass
       can draw a prefix - and re-ordering is all it ever needed.

       So a placed band keeps a snapshot of exactly what it wrote: the slice
       of each pool's instance matrices and colours, and the descriptors of
       the solids and gates it contributed. Replaying is then a typed-array
       copy into whatever offset the new order gives it, at no noise cost.
       Only a genuinely new band pays for `place`.

       Two details keep the semantics identical to a full rebuild. Solids are
       CLONED on replay rather than shared, because `collide` marks them with
       `hit` and a shared object would carry that mark into the next rebuild
       - a tree struck once would never be struck again. And a gate's `taken`
       is recomputed from `takenGates` rather than restored, which is exactly
       what `place` does, so passing and re-opening gates behave as before. */
    const placeRemembered = (b) => {
      let spacing = spacingByBand.get(b);
      if (spacing === undefined) {
        spacing = currentSpacing;
        spacingByBand.set(b, spacing);
      }
      const cached = bandCache.get(b);
      if (cached && cached.spacing === spacing) {
        replayBand(cached);
        return;
      }
      const startN = [];
      for (let i = 0; i < allPools.length; i++) startN.push(allPools[i].n);
      const solidFrom = solids.length;
      const gateFrom = gates.length;
      place(b, spacing);
      bandCache.set(b, snapshotBand(spacing, startN, solidFrom, gateFrom));
    };
    placeRemembered(bi);
    for (let i = 0; i < shadowPools.length; i++) {
      shadowPools[i].shadowEnds[0] = shadowPools[i].n;
    }
    for (let k = 1; k <= streamSpan; k++) {
      if (k <= behind) placeRemembered(bi + k);
      if (k <= ahead) placeRemembered(bi - k);
      for (let i = 0; i < shadowPools.length; i++) {
        shadowPools[i].shadowEnds[k] = shadowPools[i].n;
      }
    }

    allPools.forEach((p) => p.end());

    const first = bi - ahead;
    const last = bi + behind;
    for (const b of spacingByBand.keys()) {
      if (b < first || b > last) spacingByBand.delete(b);
    }
    // The cache is bounded by the same window, plus a little slack so a
    // rider drifting back and forth over one boundary does not keep paying
    // to re-place the band they just left.
    for (const b of bandCache.keys()) {
      if (b < first - 2 || b > last + 2) bandCache.delete(b);
    }
  }

  let currentBand = NaN;
  /* Bands still carrying a stale density after a `reset`, retargeted one per
     frame rather than all eighteen at once. See `reset`. */
  let staleBands = null;

  function update(riderZ, spacing = 1) {
    const bi = Math.floor(riderZ / band);
    /* Drain one retarget per frame, whatever else this frame is doing. A
       reset asks every band to come back to full density, and doing that in
       one go is the same eighteen-band stall this file just stopped paying
       at band crossings — landed on the frame after a wipeout, which is the
       worst possible moment for it. One band is retired here and the other
       seventeen replay from cache, so the forest thickens over about a third
       of a second instead of stalling the frame it was asked on.

       Deliberately NOT gated on standing still in one band: a rider crossing
       boundaries steadily would otherwise never drain the queue, and the far
       field would keep the density it was given at speed indefinitely. At
       most one rebuild happens per frame either way — the crossing below
       does it if it fires, and the flag makes this do it if it does not. */
    let drained = false;
    if (staleBands && staleBands.size) {
      const b = staleBands.values().next().value;
      staleBands.delete(b);
      spacingByBand.delete(b);
      bandCache.delete(b);
      if (!staleBands.size) staleBands = null;
      drained = true;
    }
    if (bi === currentBand) {
      if (drained) rebuild(riderZ, Math.max(1, spacing));
      return;
    }
    /* Two metres of dead band on the boundary just crossed. A full rebuild
       regenerates all eighteen streamed bands in one frame, which is fine
       forty metres apart and pathological when a tumble bounces back and
       forth across one exact boundary — that was a rebuild per frame for as
       long as the bouncing lasted. The band the content actually needs is
       streamed eleven ahead, so arriving two metres late costs nothing. */
    if (!Number.isNaN(currentBand)) {
      const edge = (bi > currentBand ? currentBand + 1 : currentBand) * band;
      if (Math.abs(riderZ - edge) < 2) {
        if (drained) rebuild(riderZ, Math.max(1, spacing));
        return;
      }
    }
    currentBand = bi;
    rebuild(riderZ, Math.max(1, spacing));
  }

  /* A reset restores full prop density — the streaming thins candidates with
     speed, and a rider who has just stopped should not be looking at the
     forest they had at forty metres a second.

     It does NOT clear the snapshot cache. A band is a pure function of its
     index and the world seed, and the seed cannot change inside a session:
     `setWorldSeed` is called exactly once per page, and a new mountain is a
     full page reload rather than a reseed. Clearing it only guaranteed that
     every band missed and paid `place` again.

     What does have to change is the frozen per-band spacing, and that is
     retargeted lazily: the bands the rider can actually reach are re-placed
     now, and the rest are queued for `update` to drain one per frame. */
  function reset(riderZ, spacing = 1) {
    const want = Math.max(1, spacing);
    currentBand = Math.floor(riderZ / band);
    staleBands = new Set();
    for (const b of spacingByBand.keys()) {
      if (Math.abs(b - currentBand) <= 1) {
        spacingByBand.delete(b);
        bandCache.delete(b);
      } else if (spacingByBand.get(b) !== want) {
        staleBands.add(b);
      }
    }
    if (!staleBands.size) staleBands = null;
    rebuild(riderZ, want);
  }

  /* The frame's wind, handed over once by the caller. The time wraps at 200π
     — see the note beside `SWAY` — and everything reading these uniforms
     shares the same two records, so this is the whole cost of animating the
     forest and every flag on it. */
  function setAir(dt, windX, windZ) {
    air.uAirTime.value = (air.uAirTime.value + dt) % 628.3185307;
    air.uAirWind.value.set(windX, windZ);
  }

  /* Which pair the run is pointed at, handed to the beacons as a single z.

     Downhill is negative, so the gate to take is the *largest* z still below
     the rider among the ones that are neither crossed nor missed — both of
     which `main.js` marks `taken`, because a gate you rode past is finished
     whichever side of the poles you were on.

     It is a scan and not a cached index because the list is rebuilt at every
     band boundary and the rider can be put back onto the hill at a checkpoint
     between two of them. The list is the streamed window, gates are a hundred
     and fifty metres apart, and the window is under a kilometre: this walks
     about five entries. */
  function setNextGate(riderZ) {
    let lead = -1e9;
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      if (g.taken || g.z > riderZ || g.z <= lead) continue;
      lead = g.z;
    }
    beacon.uNextGate.value = lead;
  }

  /* Everything downhill of a point is an unridden course again.

     A restart resumes from the last gate taken, which is uphill of every gate
     the rider had reached by the time they asked for it — and those gates
     carry a `taken` that outlives the reset, because the key set exists
     precisely so a band rebuild cannot forget one. Left standing, the replay
     would ride past its own first few gates scoring nothing while both lead
     indicators pointed at a gate two hundred metres further on. Downhill is
     negative, so "below" is a smaller z; the gate the checkpoint *is* sits
     above the resume point and keeps its state. */
  function reopenGatesBelow(z) {
    for (const key of takenGates) if (key < z) takenGates.delete(key);
    for (let i = 0; i < gates.length; i++) {
      if (gates[i].z < z) gates[i].taken = false;
    }
  }

  function debugBiomes() {
    const hazards = [];
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (s.type !== 'boulder') continue;
      hazards.push({
        key: s.key,
        x: +s.x.toFixed(2), z: +s.z.toFixed(2),
        r: +s.r.toFixed(2), top: +s.top.toFixed(2),
      });
    }
    return {
      band: currentBand,
      spacing: +(spacingByBand.get(currentBand) || 1).toFixed(2),
      plants: plantPools.reduce((sum, p) => sum + p.n, 0),
      shrubs: shrubPools.reduce((sum, p) => sum + p.n, 0),
      scenicRocks: rockPools[0].n + rockPools[1].n - hazards.length,
      hazards,
    };
  }

  return {
    group, update, reset, setAir, setNextGate, reopenGatesBelow,
    solids, gates, debugBiomes,
  };
}
