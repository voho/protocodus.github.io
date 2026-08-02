/* Everything standing on the mountain: trees, shrubs, rocks, slalom gates,
   the rails and the park.

   The hill is filled a band at a time — forty metres of it — and every band
   is generated from its own index, so the same stretch of mountain always
   grows the same forest. Bands behind the rider are dropped and their
   instances handed to bands ahead. Nothing is stored between visits because
   nothing needs to be: the seed is the coordinate.

   THERE ARE NO KICKERS ANY MORE, and their going is worth a paragraph
   because they took a whole mechanism with them.

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
   while nothing on this mountain cast a shadow onto anything else. */

import {
  heightAt, nearestCenter, corridorHalfAt, centersAt, normalFrom,
} from './terrain.js';
import { stream, hash2, noise2 } from './noise.js';
import { compose } from './geom.js';
import { PROPS } from './config.js';

const { band, ahead, behind, park: PARK, rail: RAIL } = PROPS;

const TAU = Math.PI * 2;

const lerp = (a, b, t) => a + (b - a) * t;
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
  cold: '#2f7a68',       // a spruce with the sky in it
  warm: '#5f8a46',       // a pine that has had some sun
  rust: '#684832',       // the odd one dying on its feet
  ghost: '#6d7365',      // and the odd one that has finished
  timberCold: '#918f88', // a dead larch, weathered grey
  timberWarm: '#94836f', // and one that still has some sap in the memory
  deep: 0.52,            // how dark the back of a wet stand goes
  lit: 1.14,             // and how light a tree catching the low sun does
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
  standFreq: 0.0046,      // ≈220 m from a stand to the clearing beside it
  standBand: [0.28, 0.72],
  standSeed: 137,
  clearing: 0.34,
  /* Metres of descent over which the treeline closes, and what it closes
     from and to. Both ends are deliberately gentle: the top of the run is
     thinner and its trees are smaller, and it is still unmistakably a piste
     through a forest rather than a bare bowl. A treeline you can *see* is
     worth having; one that empties the first kilometre is not. */
  line: [80, 1600],
  lineCover: [0.82, 1.0],
  lineScale: [0.74, 1.08],
  /* How much of the ground's own normal a trunk takes. Conifers grow towards
     the light rather than square to the slope, so this is a lean and not a
     right angle — but it is not zero either, and a hillside of perfectly
     plumb trees is the tell that they were placed by a loop. */
  lean: 0.26,
  wobble: 0.09,           // …and a little more, so no two agree
  size: [0.46, 1.22],
  sizeBias: 1.45,         // >1 puts most of the stand at the small end
};

/* Two pieces of mountain furniture that belong outside the piste rather than
   on it.

   Both are deliberately sparse. The fence is large enough to read as a snow
   bridge from the middle of the run, but one cluster every few hundred metres
   is infrastructure; one in every band would be wallpaper. The waymark is a
   much smaller red-and-white point at the groomed edge and rarer again, so it
   says Switzerland without turning the valley into a run of flags.

   These numbers stay here rather than in config because nothing outside this
   module can tune or collide with either prop. Their placement uses dedicated
   `hash2` channels below, not the band's `rnd` stream, so adding them cannot
   reshuffle a tree, gate or rail. */
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

   Both the forest and the gate flags share these two uniform records, and
   `setAir` writes them once per frame — the same one-write-moves-everything
   arrangement the shared shading uses for the sky. The time wraps at 200π
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

/* The flag's ripple travels along the cloth — a phase that advances with x —
   and its amplitude grows from nothing at the pole edge, because the hoist is
   sewn to the pole and the fly is the end that snaps. A small constant term
   keeps a becalmed flag from ironing itself flat; the wind term on top is what
   makes a storm read at the gates before it reads anywhere else. */
const FLAG_DECL = `
uniform float uAirTime;
uniform vec2 uAirWind;`;

const FLUTTER = `#include <begin_vertex>
{
  float n64Ph = 0.0;
  #ifdef USE_INSTANCING
    n64Ph = fract(dot(instanceMatrix[3].xz, vec2(0.31, 0.17))) * 6.2832;
  #endif
  float n64Fly = clamp(transformed.x / 0.72, 0.0, 1.0);
  float n64Amp = 0.035 + min(0.085, length(uAirWind) * 0.005);
  transformed.z += sin(uAirTime * 8.0 + transformed.x * 6.0 + n64Ph)
    * n64Amp * n64Fly;
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
    name: 'spruce',            // tall, narrow, holds a spire, skirts hang
    bark: '#54422f',
    foliage: 0.95,
    height: [9, 16], whorls: [9, 12], perWhorl: [3, 4],
    reach: 0.30, bushy: 0.46, squash: 0.72, joint: 0.42,
    liftLow: -0.20, liftHigh: 0.46, droop: 0.66,
    spire: 1.5, snow: 0.5, lean: 0.05, fringe: 0.5,
  },
  {
    name: 'fir',               // broad, layered, the classic christmas card
    bark: '#5e4833',
    foliage: 0.88,
    height: [7, 12], whorls: [7, 9], perWhorl: [4, 5],
    reach: 0.42, bushy: 0.52, squash: 0.55, joint: 0.52,
    liftLow: 0.02, liftHigh: 0.30, droop: 0.20,
    spire: 1.1, snow: 0.72, lean: 0.07, fringe: 0.15,
  },
  {
    name: 'pine',              // leggy, bare below, tufted at the ends
    bark: '#77593d',
    foliage: 1.08,
    height: [10, 17], whorls: [4, 6], perWhorl: [5, 7],
    reach: 0.36, bushy: 0.58, squash: 1.0, joint: 0.50,
    liftLow: 0.18, liftHigh: 0.34, droop: 0.34,
    spire: 0.7, snow: 0.4, lean: 0.10, bareTo: 0.62, tuftFrom: 0.50,
  },
  {
    name: 'larch',             // dead, bare, all structure and no needles
    bark: '#8c8579',
    foliage: null,
    height: [5, 9], whorls: [4, 6], perWhorl: [3, 5],
    reach: 0.42, bushy: 0, squash: 1, joint: 0.46,
    liftLow: -0.05, liftHigh: 0.34, droop: 0.30,
    spire: 0, snow: 0.6, lean: 0.16, branchy: true,
  },
  {
    name: 'storm',             // topped by weather, flagged away from the wind
    bark: '#503e2e',
    foliage: 0.85,
    height: [7, 13], whorls: [7, 10], perWhorl: [3, 4],
    reach: 0.28, bushy: 0.44, squash: 0.66, joint: 0.40,
    liftLow: -0.30, liftHigh: 0.30, droop: 0.78,
    spire: 0, snow: 0.66, lean: 0.13, fringe: 0.7,
    flag: 0.7, broken: true,
  },
  {
    name: 'young',             // dense, low, and buried — the treeline's floor
    bark: '#594533',
    foliage: 1.0,
    height: [4, 7], whorls: [6, 8], perWhorl: [4, 5],
    reach: 0.46, bushy: 0.52, squash: 0.60, joint: 0.46,
    liftLow: 0.06, liftHigh: 0.38, droop: 0.30,
    spire: 1.2, snow: 0.86, lean: 0.08, fringe: 0.2,
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
  const trunkR = height * 0.019 + 0.05;
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

  /* The leader, walked rather than drawn.

     It used to be one tapered cylinder with a fixed lean, which under a
     shadow is a ruler — and nothing in a forest is a ruler. Three frusta
     stacked end to end, each tilted a little further and swung to a new
     quarter, give a trunk that sways; the taper is then real rather than
     cosmetic, because each segment starts where the last one finished and
     the stock's own ratio does the narrowing. `spine` keeps the joints so
     that the whorls can be hung off the trunk's actual centreline. Attaching
     them to x = 0 was fine while the trunk was straight and put the top
     whorl a metre off the tree the moment it was not. */
  const SEGS = 3;
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
    const r = trunkR * Math.pow(0.74, k);
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

/* The boulders were grown here, out of the same weathering the shrubs used —
   a block with its vertices pushed about, shards at its foot, snow caught on
   the upper faces. They are gone with the shrubs and for the same reason: a
   rock sitting on a piste is furniture standing on the mountain rather than
   part of it. Anything that slows a rider or throws them into the air should
   be the shape of the ground doing it. */

/* The shrub is gone. It was a bush with a winter on it — three weathered
   lumps and a scatter of bare twigs — and it was the one prop on the mountain
   that never earned its place: knee-high, painted in the same glacier blue as
   the ground it sat on, and mechanically nothing but a bite of speed taken
   off a rider who could not have seen it coming. What it actually read as, at
   any distance, was scraps of paper blown across the snow. The growth code it
   used lives on in `growRock`, which was written from it. */

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

/* ==========================================================================
   Instanced pools
   ========================================================================== */

class Pool {
  constructor(THREE, geometry, material, capacity, tinted = false) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
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
    /* Shadow-pass bound: instances below this index are near enough to cast
       into the ±92 m shadow box. `rebuild` fills near bands first and records
       where they end; the depth pass then draws that prefix and nothing else.
       Defaults to everything, so a pool nobody trims behaves as before. */
    this.near = capacity;
    this.full = 0;
    /* And the opposite trade for the sparse furniture: a pool marked cullable
       gets a real bounding sphere from its written instances in `end()` and
       is handed back to three's frustum test, because a rail or a fence line
       is usually entirely off screen and the trees never are. */
    this.cullable = false;
    if (tinted) this.mesh.setColorAt(0, new THREE.Color(0xffffff));
  }

  begin() {
    this.n = 0;
  }

  add(x, y, z, rotY, sx, sy, sz, color) {
    if (this.n >= this.capacity) return;
    this.e.set(0, rotY, 0);
    this.q.setFromEuler(this.e);
    this.write(x, y, z, sx, sy, sz, color);
  }

  /* The snow bridges stand normal to the bank under them rather than upright
     in the world. Yaw is applied in the prop's own frame first and that frame
     is then carried onto the surface normal, so local +Y still lands exactly
     on `normal` at any course heading. Ordinary props keep the cheaper `add`
     path above. */
  addOnSlope(x, y, z, rotY, sx, sy, sz, normal, color) {
    if (this.n >= this.capacity) return;
    this.q.setFromUnitVectors(this.up, normal);
    this.turn.setFromAxisAngle(this.up, rotY);
    this.q.multiply(this.turn);
    this.write(x, y, z, sx, sy, sz, color);
  }

  write(x, y, z, sx, sy, sz, color) {
    this.v.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(this.n, this.m);
    if (this.tinted && color) this.mesh.setColorAt(this.n, color);
    this.n += 1;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.tinted && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.cullable) {
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

  // Every material the field makes goes through the shared shading, which is
  // the only reason a tree and the snow it is standing in are lit by the same
  // five bands and dissolve into the same sky. There is no unpatched path out
  // of these three functions on purpose — a prop that forgot is a prop that
  // stops belonging to the mountain the moment the light moves.
  const lit = (color) => shading.apply(
    new THREE.MeshLambertMaterial({ color, flatShading: false }),
  );
  /* The wind's two uniforms, shared by every material that listens to it.
     `setAir` below is the one writer; the integrator calls it once a frame
     with the weather's own wind, and a frame that forgets simply leaves the
     forest becalmed rather than broken. */
  const air = {
    uAirTime: { value: 0 },
    uAirWind: { value: new THREE.Vector2() },
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
  const treeMat = (height) => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, air, { uSwayHeight: { value: height } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${OWN_DECL}${AIR_DECL}`)
        .replace('#include <color_vertex>', OWN_MIX)
        .replace('#include <begin_vertex>', SWAY)
        .replace('#include <project_vertex>', `#include <project_vertex>
        vN64Sheen = 1.0 - surfaceOwn;`);
    };
    return shading.apply(m, { cameraFade: true, sheen: 1 });
  };

  /* The flag's cloth, rippled by the same clock. Its own factory for the same
     reason the trees have one: the patch has to go on before `shading.apply`
     folds its text into the cache key. */
  const flagMat = () => {
    const m = new THREE.MeshLambertMaterial({ flatShading: false, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, air);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${FLAG_DECL}`)
        .replace('#include <begin_vertex>', FLUTTER);
    };
    return shading.apply(m);
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
  };

  const treePools = [];
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
    treePools.push(pool);
    group.add(pool.mesh);
  }

  /* The shadow pass draws only the near prefix of each tree pool. The map
     covers ±92 m around the rider, yet every instance in a six-hundred-metre
     window used to be pushed through the depth pass to fill it; `rebuild`
     orders the bands nearest-first and records where the near ones end, and
     these two hooks — which three calls around exactly the depth draw and
     nothing else — pinch `count` down to that prefix and put it back. */
  for (const pool of treePools) {
    const mesh = pool.mesh;
    mesh.onBeforeShadow = () => {
      pool.full = mesh.count;
      if (pool.near < mesh.count) mesh.count = pool.near;
    };
    mesh.onAfterShadow = () => {
      mesh.count = pool.full;
    };
  }

  // --- everything else ------------------------------------------------------
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 12);
  poleGeo.translate(0, 1.15, 0);
  // Segmented so the flutter has joints to bend at — a two-triangle quad can
  // only shear, and a shearing flag reads as a sign swinging on a hinge
  const flagGeo = new THREE.PlaneGeometry(0.72, 0.46, 6, 3);
  flagGeo.translate(0.36, 1.95, 0);
  // Laid down the fall line at construction rather than rotated per instance,
  // so a rail is placed with the same plain scale-and-translate every other
  // pool uses and its length is simply its z scale
  const railGeo = new THREE.CylinderGeometry(RAIL.radius, RAIL.radius, 1, 16);
  railGeo.rotateX(Math.PI / 2);
  const railPostGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
  railPostGeo.translate(0, 0.5, 0);

  /* Rocks come in threes, for the same reason the trees come in twelve: they
     are grown, so a second variant is a draw call rather than a per-instance
     cost, and one silhouette repeated forty times down a hillside is the
     thing the eye picks out first.

     The shrubs are gone entirely. They were the one prop that never earned
     its place: knee-high lumps painted in the same glacier blue as the ground
     they sat on, which at any distance read as scraps of paper blown across
     the snow rather than as vegetation, and which existed mechanically only
     to take a bite of speed off a rider who could not have seen them coming.
     A mountain is better without them than with a hundred of them a minute. */
  const poles = new Pool(THREE, poleGeo, lit('#2a2f38'), bands * 2 + 16);
  const flags = new Pool(THREE, flagGeo, flagMat(), poles.capacity, true);
  const railBars = new Pool(THREE, railGeo, lit('#aab6c8'), 8);
  const railPosts = new Pool(THREE, railPostGeo, lit('#2a2f38'), 32);

  /* Two calls for all of the Swiss-specific infrastructure in the active
     window: one fence geometry and one marker geometry, sharing one material
     and carrying their colours in the vertices. Capacities are hard maxima —
     at most three fence sections and one marker can be authored by a band —
     while the hashes below normally fill only a small fraction of them. */
  const alpineMat = shading.apply(
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false }),
  );
  const avalancheFences = new Pool(
    THREE, avalancheFenceGeometry(THREE), alpineMat, bands * ALPINE.fence.sections[1],
  );
  const waymarks = new Pool(
    THREE, waymarkGeometry(THREE), alpineMat, bands,
  );
  avalancheFences.mesh.name = 'avalanche-fences';
  waymarks.mesh.name = 'swiss-waymarks';

  /* The sparse furniture is worth culling: a whole rail park, or a fence line
     on one bank, is a compact cluster that spends most of every orbit of the
     camera entirely off screen. The trees stay unculled — they surround the
     camera at all times and a sphere over three hundred metres of forest
     would never say no. */
  for (const p of [railBars, railPosts, avalancheFences, waymarks]) p.cullable = true;

  const pools = [poles, flags, railBars, railPosts, avalancheFences, waymarks];
  pools.forEach((p) => group.add(p.mesh));
  const allPools = pools.concat(treePools);

  // --- rails ---------------------------------------------------------------
  // A rail is not part of the height field — it is a metre-wide line in the
  // air, and putting it in `heightAt` would mean the whole mountain paid for
  // it on every sample. So it is its own short list, and the rider asks
  // about it separately, only while falling towards one.
  const rails = [];

  /* The rail the rider is close enough to catch, or null. `y` is where the
     board is: a rider passing under a rail is not grinding it. */
  function railAt(x, z, y) {
    for (let i = 0; i < rails.length; i++) {
      const r = rails[i];
      if (z > r.z0 + 0.6 || z < r.z1 - 0.6) continue;
      const t = (r.z0 - z) / (r.z0 - r.z1);
      const lineX = r.x0 + (r.x1 - r.x0) * t;
      if (Math.abs(x - lineX) > RAIL.catchWidth) continue;
      const top = r.y0 + (r.y1 - r.y0) * t + RAIL.height;
      if (Math.abs(y - top) > RAIL.catchHeight) continue;
      return r;
    }
    return null;
  }

  /* Where a rail's line sits at a point down it, for the rider to be held
     against while it is riding one. */
  function railPoint(r, z, out) {
    const t = Math.max(0, Math.min(1, (r.z0 - z) / (r.z0 - r.z1)));
    out.x = r.x0 + (r.x1 - r.x0) * t;
    out.y = r.y0 + (r.y1 - r.y0) * t + RAIL.height;
    out.z = z;
    out.t = t;
    return out;
  }

  // --- collision -----------------------------------------------------------
  // Flat array of {x, z, r, kind, top}, rebuilt whenever the bands change.
  // A few hundred entries, scanned by z-window in the rider's step.
  const solids = [];
  // Slalom gates, remembered rather than merely drawn, so a run can be scored
  // for taking the line the poles are describing. Rebuilt with the bands.
  const gates = [];

  // --- band generation -----------------------------------------------------
  const tint = new THREE.Color();
  const gateA = new THREE.Color('#00ffc3');
  const gateB = new THREE.Color('#ffc400');
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

  /* Is this stretch of hill a built park, and how far into it are we? The
     park sits inside its own period so that it is a place you arrive at
     rather than something that happens continuously. */
  function parkAt(z) {
    const b = Math.floor(-z / PARK.period);
    if (b < 1) return null;
    if (hash2(b, 3313, 71) > PARK.chance) return null;
    const top = -(b * PARK.period) - (PARK.period - PARK.length) * hash2(b, 617, 72);
    const t = (top - z) / PARK.length;
    if (t <= 0 || t >= 1) return null;
    return { b, top, t };
  }

  function place(b) {
    const rnd = stream(b * 2654435761);
    const z0 = b * band;
    const travelled = Math.max(0, -z0);

    // Every offset below is measured from the middle of the piste at that
    // point, never from the world's x = 0. The route wanders, and it forks,
    // so an absolute placement plants a forest across the run.

    /* How far down the mountain this band is, as the treeline sees it: nearly
       nothing at the top of the run, everything a couple of kilometres below.
       One value for the whole band, because a band is forty metres and the
       treeline moves over hundreds. */
    const down = smoothstep(FOREST.line[0], FOREST.line[1], travelled);
    const lineCover = lerp(FOREST.lineCover[0], FOREST.lineCover[1], down);
    const lineScale = lerp(FOREST.lineScale[0], FOREST.lineScale[1], down);

    // --- forest, either side of the corridor -------------------------------
    for (let i = 0; i < PROPS.treesPerBand; i++) {
      const z = z0 + rnd() * band;
      const half = corridorHalfAt(z);
      centersAt(z, centres);
      // Outside whichever branch is on that side, and — when the run has
      // forked — sometimes on the island between the two, which is what
      // makes an island read as a place rather than a gap
      const side = rnd() < 0.5 ? -1 : 1;
      const island = centres[0] !== centres[1] && rnd() < 0.35;
      let x;
      if (island) {
        const gap = (centres[1] - centres[0]) / 2 - half;
        if (gap < 3) continue;
        x = (centres[0] + centres[1]) / 2 + (rnd() * 2 - 1) * (gap - 1.5);
      } else {
        const c = side < 0 ? centres[0] : centres[1];
        // pow biases the crowd towards the treeline rather than the far edge
        x = c + side * (half - 2.5 + Math.pow(rnd(), 0.6) * 78);
      }
      /* And whether anything grows here at all. The stand field is sampled at
         the tree's own position rather than the band's, so a clearing has an
         edge that runs across the hill wherever the field puts it instead of
         starting and stopping at a band boundary. The draw is taken either
         way, so refusing a tree cannot shift the ones behind it in the
         stream — a mountain that reshuffles when a clearing opens is a
         mountain that reshuffles for no reason. */
      const stand = FOREST.clearing + (1 - FOREST.clearing) * smoothstep(
        FOREST.standBand[0], FOREST.standBand[1],
        noise2(x * FOREST.standFreq, z * FOREST.standFreq, FOREST.standSeed),
      );
      if (rnd() > stand * lineCover) continue;
      const y = heightAt(x, z);
      // Mostly small, with the odd one standing over them.
      const s = lerp(FOREST.size[0], FOREST.size[1],
        Math.pow(rnd(), FOREST.sizeBias)) * lineScale;
      const v = (rnd() * treePools.length) | 0;
      treePools[v].addOnSlope(x, y, z, rnd() * TAU,
        s, s * (0.85 + rnd() * 0.35), s,
        treeLean(x, z, y, rnd), castOf(treeBare[v], v, rnd(), tint));
      solids.push({ x, z, r: 0.5 + s * 0.45, kind: HARD, top: 99 });
    }

    // --- trees on the piste, once the run has warmed up --------------------
    const innerCount = Math.min(
      PROPS.innerTreesMax,
      Math.floor((travelled - PROPS.innerTreesAt) / 700) + 1,
    );
    for (let i = 0; i < innerCount; i++) {
      if (rnd() > 0.72) continue;
      const z = z0 + rnd() * band;
      const half = corridorHalfAt(z);
      const side = rnd() < 0.5 ? -1 : 1;
      const off = PROPS.clearLane + rnd() * Math.max(1, half - PROPS.clearLane - 2);
      const x = nearestCenter(0, z) + side * off;
      const y = heightAt(x, z);
      const s = (0.6 + rnd() * 0.4) * lineScale;
      const v = (rnd() * treePools.length) | 0;
      treePools[v].addOnSlope(x, y, z, rnd() * TAU, s, s, s,
        treeLean(x, z, y, rnd), castOf(treeBare[v], v, rnd(), tint));
      solids.push({ x, z, r: 0.5 + s * 0.45, kind: HARD, top: 99 });
    }

    /* The shrubs used to be drawn here. Their stream draws are gone with them
       rather than being left spinning to preserve the sequence — the seed is
       the coordinate, so the mountain reshuffles, and a mountain that
       reshuffles once when a prop is removed is a fair price for not carrying
       a dead loop around to protect a layout nobody has memorised. */

    /* The rocks were drawn here, and they are gone for the same reason the
       shrubs went before them. A boulder sitting on a piste is a games idea:
       it is an obstacle placed on the ground rather than a feature of it, it
       has to be dodged rather than ridden, and the mountain already has a
       vocabulary for making a rider work — knolls, drops, banks, the shape of
       the corridor. Anything that slows a rider down or throws them into the
       air should be the hill doing it, not furniture standing on the hill. */

    // --- alpine infrastructure --------------------------------------------

    /* Avalanche fences live high on the OUTER bank, never between forked
       branches. A cluster is two or three adjacent six-metre sections along
       the contour, each planted and tilted from its own terrain sample. All
       choices come from hash channels reserved for this feature, so this does
       not consume `rnd` and cannot move gameplay-bearing props downstream.

       Nothing is added to `solids`: these are distant identity and scale
       cues, deliberately not a new class of invisible collision on the
       containment wall. */
    let fenceSide = 0;
    if (travelled >= ALPINE.fence.from
      && hash2(b, 2001, 141) < ALPINE.fence.chance) {
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
        avalancheFences.addOnSlope(x, y, z, yaw, scale, sy, scale, bankNormal);
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

    // A band runs from z0 up to z0 + band, so this is what "inside it" means
    // for anything the park lays out at a fixed point down the mountain
    const inBand = (z) => z >= z0 && z < z0 + band;
    const parked = parkAt(z0 + band / 2);

    // --- slalom gates ------------------------------------------------------
    // Out on the piste they are a line to take; at the head of a park they
    // are the sign that says one is coming, which is the difference between
    // a park and an ambush.
    if (parked) {
      const z = parked.top - 6;
      if (inBand(z)) {
        const cx = nearestCenter(0, z);
        for (const side of [-1, 1]) {
          const x = cx + side * 5.5;
          const y = heightAt(x, z);
          poles.add(x, y, z, 0, 1, 1, 1);
          flags.add(x, y, z, side < 0 ? 0 : Math.PI, 1, 1, 1, tint.copy(gateA));
        }
      }
    } else if (rnd() < PROPS.gateChance) {
      const z = z0 + rnd() * band;
      const cx = nearestCenter(0, z) + (rnd() * 2 - 1) * 12;
      const colour = rnd() < 0.5 ? gateA : gateB;
      for (const side of [-1, 1]) {
        const x = cx + side * PROPS.gateHalf;
        const y = heightAt(x, z);
        poles.add(x, y, z, 0, 1, 1, 1);
        flags.add(x, y, z, side < 0 ? 0 : Math.PI, 1, 1, 1, tint.copy(colour));
      }
      /* And the gate is remembered, which it never used to be.

         Slalom gates were pure scenery — two poles and a flag, drawn and
         forgotten, "a line to take" that the game had no way of knowing you
         had taken. Recording the pair gives the run the one thing it was
         missing: something to aim at that is neither a jump nor an obstacle.
         `half` travels with it because the caller has to know how wide the
         gate was to decide whether the rider went through it, and a gate that
         is scored against the wrong width is worse than one that is not
         scored at all. */
      gates.push({ x: cx, z, half: PROPS.gateHalf, taken: false });
    }

    /* --- rails ------------------------------------------------------------

       All that is left of the park, and it is enough for one. A park was a
       graded line of kickers with a rail beside it; without the kickers it is
       a stretch of hill with steel on it, announced by its gate pair, and that
       is a perfectly good thing for a park to be. The jumping it used to
       supply is now the mountain's job everywhere rather than this stretch's
       job in particular, which is the whole point of the change.

       Several of them, though, where there used to be one. A single rail in a
       hundred and fifty metres of announced ground was thin even when there
       were three kickers keeping it company. */
    if (parked) {
      const step = PARK.length / (PARK.rails + 1);
      for (let i = 0; i < PARK.rails; i++) {
        const z = parked.top - step * (i + 1);
        if (!inBand(z)) continue;
        if (hash2(parked.b * 31 + i, 887, 73) > PARK.railChance) continue;
        // Alternated either side of the line, so riding the park is a slalom
        // between them rather than a single straight to hold
        const off = (i % 2 === 0 ? -1 : 1) * (5 + hash2(parked.b + i, 41, 74) * 5);
        const cx = nearestCenter(0, z) + off;
        rails.push({
          x0: cx, z0: z + RAIL.length / 2,
          x1: cx, z1: z - RAIL.length / 2,
          y0: heightAt(cx, z + RAIL.length / 2),
          y1: heightAt(cx, z - RAIL.length / 2),
          key: `${parked.b}:${i}`,
        });
      }
    }
  }

  function rebuild(riderZ) {
    allPools.forEach((p) => p.begin());
    solids.length = 0;
    rails.length = 0;
    gates.length = 0;

    /* Nearest band first, spiralling outward, rather than a straight sweep
       from behind to ahead. Every band is generated from its own seed, so the
       order changes nothing about the mountain — but it means the instances
       standing near the rider occupy the low indices of every pool, and the
       shadow pass can draw a prefix instead of the whole forest. Three bands
       either side is at least 120 m in the worst case, comfortably past both
       the 92 m shadow box and a low sun's reach into it. It also means that
       if a pool ever runs out of capacity, the trees dropped are the far
       ones, which is the right way round. */
    const bi = Math.floor(riderZ / band);
    const NEAR_BANDS = 3;
    const span = Math.max(ahead, behind);
    place(bi);
    for (let k = 1; k <= span; k++) {
      if (k <= behind) place(bi + k);
      if (k <= ahead) place(bi - k);
      if (k === Math.min(NEAR_BANDS, span)) {
        for (let i = 0; i < treePools.length; i++) treePools[i].near = treePools[i].n;
      }
    }

    // Nearest first, because the pool is what it is and a rail behind the
    // rider is not worth a bar that one in front of them could have had
    rails.sort((a, b) => Math.abs(a.z0 - riderZ) - Math.abs(b.z0 - riderZ));
    rails.length = Math.min(rails.length, railBars.capacity);

    for (let i = 0; i < rails.length; i++) {
      const r = rails[i];
      const mz = (r.z0 + r.z1) / 2;
      const mx = (r.x0 + r.x1) / 2;
      const my = (r.y0 + r.y1) / 2 + RAIL.height;
      railBars.add(mx, my, mz, 0, 1, 1, RAIL.length);
      for (const e of [-1, 1]) {
        const pz = mz + (e * RAIL.length) / 2.4;
        const py = heightAt(mx, pz);
        railPosts.add(mx, py, pz, 0, 1, Math.max(0.2, my - py), 1);
      }
    }

    allPools.forEach((p) => p.end());
  }

  let currentBand = NaN;

  function update(riderZ) {
    const bi = Math.floor(riderZ / band);
    if (bi === currentBand) return;
    currentBand = bi;
    rebuild(riderZ);
  }

  /* The frame's wind, handed over once by the caller. The time wraps at 200π
     — see the note beside `SWAY` — and everything reading these uniforms
     shares the same two records, so this is the whole cost of animating the
     forest and every flag on it. */
  function setAir(dt, windX, windZ) {
    air.uAirTime.value = (air.uAirTime.value + dt) % 628.3185307;
    air.uAirWind.value.set(windX, windZ);
  }

  return { group, update, setAir, railAt, railPoint, solids, rails, gates };
}
