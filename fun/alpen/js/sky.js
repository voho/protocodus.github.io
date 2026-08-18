/* Sky, sun, horizon and light — all of it driven by the weather.

   Everything here is at infinity: the whole group is moved to the rider each
   frame and never rotated, so it has parallax with nothing and reads as
   distance. Nothing is baked, because the sky changes all day; every colour
   is a uniform the weather writes each frame, which is also why a full day
   cycle costs no geometry work at all.

   Eight pieces, in the order the eye finds them.

   The dome is a three-stop gradient with a warm lobe around whatever is
   currently lighting the sky. That lobe is the cheapest atmosphere in
   graphics: one dot product, and it is most of the difference between a
   painted gradient and a sky with a sun somewhere in it.

   The gradient's *shape* is the one thing in this file that cannot be
   touched, and it is worth saying why here rather than leaving it to be
   discovered. `shading.js` carries a transcription of `DOME_FRAG` so that a
   fogged ridge dissolves into the same sky it is standing in front of, and
   that file is not this one's to edit. So all the variation a day is asked
   for has to arrive through the stops themselves, which are uniforms both
   ends share and cannot disagree about. That turns out to be no constraint
   at all: nine moments of colour say far more than a fourth stop would have.

   The counterglow is the second thing on the dome and it exists for about
   two of the fifteen minutes a day takes. When the sun is within a few
   degrees of the horizon, the *opposite* horizon carries the shadow of the
   Earth — a band of dull blue standing on the far skyline — with a rose
   fringe above it where the air is still catching a sun the ground has
   already lost. After the alpenglow it is the most recognisable thing about
   an alpine dusk, and this run faces within a few degrees of the direction
   it happens in for half the day.

   It is a full ring rather than an arc, which is the cheap part: which way
   it faces is one dot product against the sun's own horizontal direction, so
   the band tracks the sun through the whole evening without a rotation, a
   matrix or a rebuild, and the three quarters of the ring that are not
   opposite the sun are discarded in the first four instructions. It is also
   alpha-blended rather than added, and for once that is a physical decision
   rather than a budgetary one: the Earth's shadow is *darker* than the sky
   it is standing in, and there is no quantity of light you can add to a sky
   to make it dimmer.

   The stars sit just inside the dome and fade in with the night. They are
   the one thing a storm can take away completely.

   The aurora sits between them, and on three nights in four it is not there
   at all. `weather.aurora` decides when — see the gates on it there — and
   this end decides only what it looks like: a wide band of curtains across
   the north, three octaves of noise scrolling upward through a vertical
   ramp, green at the foot and a violet fringe at the top. It is drawn
   additively, which in a graded picture means it has to be kept quiet: a hot
   band of green over the sky clips, and
   clipped additive light is the one thing in the frame that cannot be graded
   back. So the gain is low, the folds are sparse — the noise is cut high, so
   most of the band is nothing and the folds are what is left — and the whole
   thing dies out before the horizon, where the haze would have had it.

   The mist is the newest piece and the only one here that is not at
   infinity.

   Mountain air is layered. It is not a fog that thickens smoothly with
   distance — that is already here, it is the curtain, and it is the same in
   every direction the eye turns. What a mountain actually has is cloud lying
   at an altitude: a valley filled to a level the way a bath fills, a bank
   snagged on a ridge, and clear air above and below both. A run that
   descends several hundred metres therefore gets the one thing no distance
   fog can ever give it, which is the experience of going *through*
   something.

   So it is a lattice of horizontal sheets, one every `MIST.spacing` metres
   of altitude, going on forever in both directions and pinned to the world
   rather than to the rider. Three are alive at a time — the level the rider
   is nearest, and its neighbours above and below — and which three that is
   comes out of a rounded division every frame. Nothing is accumulated and
   nothing drifts, exactly as with the ranges below: reset the game and the
   layers are where they were, ride for an hour and the only thing that has
   grown is the altitude, which is a double. The set is keyed on the
   *nearest* level rather than on the one underneath, and that is not a
   detail — keyed on the one underneath, the sheet that drops out of the set
   drops out from directly overhead, in full view. Keyed on the nearest, a
   sheet can only ever enter or leave at a level and a half away, where its
   own altitude fade has already taken it to nothing.

   Each sheet stands in for a slab of air and the alpha is the honest
   integral through it. An eye looking straight down through a layer sees one
   depth of it; an eye looking along the layer sees that depth divided by the
   sine of the angle, which runs away to infinity as the angle closes. That
   single division is the whole effect: it is why a bank at eye height fills
   the frame, why the same bank under your board is a floor you can see the
   ground through, and why descending into one is a horizon that quietly
   closes rather than a fog that switches on.

   It is also why the sheets do not have to be volumes. Alpha compositing
   multiplies transmittances, so `1 − e^(−τ)` laid over `1 − e^(−τ)` is
   exactly the medium the two slabs would have been together — and because
   every sheet resolves towards the same colour, the result does not depend
   in the slightest on what order they are drawn in. There is no sorting
   here and none is wanted.

   Two things about it are lies, and both are lies the game already tells
   elsewhere. It fades out along the fog's own ramp, because past the curtain
   everything is already precisely the haze colour and a layer out there
   costs fill rate to show nothing. And it fades *in* over the first ninety
   metres, which is the fog's near distance wearing a different hat: without
   it, riding into a bank puts a wall of milk between the rider and the tree
   they are about to hit, and a whiteout nobody can steer through is a bug
   rather than weather.

   What makes it read as layered rather than as one uniform soup is that
   every level of the lattice has a density of its own, taken from a noise
   field indexed by the level number. Most levels are nothing whatsoever. The
   ones that are not are banks, sometimes two or three levels deep where the
   field runs high — and a lattice that is empty above and full below is
   exactly the picture of a valley that has filled up to a line.

   The haze cone is the quiet one and the most important. Past the fog
   distance the hill is gone, but its mesh has to stop somewhere, and a
   frustum wide enough to hide that edge at the horizon would cost more
   vertices than the rest of the game put together. So a cone of exactly the
   fog's colour, at the hill's own pitch, is drawn under everything. Inside
   the fog it is hidden by real ground; outside it, it *is* the ground, and
   the seam cannot be seen because both are the same number.

   That cone used to hang off `TERRAIN.grade`, back when the grade was one
   number. It is a function of z now — the run has chapters, and it ranges
   from a seventh to nearly a half — so there is no constant left to hang
   anything on. A cone pitched at the mean would surface through the ground
   about ninety metres in front of a rider on a steep chapter and cover the
   whole hill with a flat pale wedge. So the pitch is *measured*: two probes
   into `heightAt`, at the fog's edge and at the mesh's, and the steeper of
   the two wins, so the curtain can never rise through the hill it is meant
   to be hiding behind. Where the hill flattens out beyond the probes and the
   curtain falls short of the horizon, the ranges cover the difference, which
   is what they were always for.

   The ranges are four bands of silhouette, each fading to the haze colour at
   its base, so mountains rise out of the curtain instead of standing in
   front of it. They are drawn without fog, because they are already painted
   as though they had it. They also used to be sampled at about a third of
   their own detail — seventy-six points around a ring whose finest octave
   had a feature every third of a point — which at 288 lines was a jagged
   edge nobody could resolve and at native resolution was a row of cardboard
   sawteeth. The profile is coarser and the sampling three times finer, the
   ring is no longer quite a circle, and each facet takes a little light
   according to which way its own skyline is falling. A silhouette has no
   form to light; that inference is the cheapest way to give it one.

   And they used to be hills.

   That is the honest description of what three summed octaves under a soft
   knee draw: a row of rounded humps standing on a plateau, sixty-two per
   cent of full height at their very lowest, which is a moor. Everything that
   makes an alpine horizon recognisable was missing from it, and every one of
   those things turns out to be structural rather than decorative.

   A real range is not a sawtooth of equal teeth. It is massifs — clusters of
   high summits — with long cols between them where the whole range drops by
   half. The Bernese Oberland puts five four-thousanders within a few miles
   of each other and then hands back two kilometres of height at the Grimsel.
   So there is a fourth scale under the other three now, five features around
   a whole ring, and it is *multiplied* into the summits rather than added to
   them. Added, a horn standing in a col comes out as a peak with a slightly
   lower peak beside it and the range is a sawtooth with a wave through it.
   Multiplied, the col has nothing in it, which is what a col is.

   A real summit is a corner. The ridged octave — the fold of an absolute
   value, which has a crease where a sine has a curve — was already in the
   sum and was doing almost nothing, because it was one third of a sum with
   two smooth octaves and then a knee was run over the top of it. It is the
   whole of the profile now: one ridged octave raised to a power, which
   narrows the ridge without touching the crease at the top of it, multiplied
   by a second and finer one. Two ridges summed are two blurred ridges; two
   ridges multiplied are one sharp ridge with the other's knife edges cut
   into its flanks. The knee has gone with the sum it was there to rescue,
   and nothing clamps, because a product of things in nought-to-one cannot
   leave nought-to-one.

   And a real range has a snow line. That is the single most recognisable
   thing about the view and it is the thing a silhouette looks least like: a
   level, the same one the whole way along the range, above which the
   mountain is white and below which it is not. It costs nothing whatsoever
   here, because the band was already carrying the number. `aMix` was built
   as the height fade for the haze, and height over the band's own ceiling is
   exactly an altitude — so the snow line is a threshold on a varying that
   was already being interpolated, and all that was needed was to stop using
   it for only one thing.

   With an altitude and a position around the ring, a band has a complete
   two-dimensional parameterisation of itself, and it always did; only one
   axis of it was ever used, for a vertical gradient. The other arrives as an
   attribute, and the rest is three fetches into the same field the aurora
   and the mist already share:

     — rock, and it lies *above* the snow line rather than below it, which is
       the part that surprises. What makes a range read as high is not bare
       ground at the bottom — every hill has that — it is dark rock standing
       in the snow at the top, on the faces too steep to hold any. So it goes
       where the skyline is falling fastest and near the crest of its own
       column, and it is ribbed vertically, because a face is buttresses and
       gullies rather than a wall.

     — glaciers, which are what makes a range read as high rather than as
       far, and which are drawn by moving the snow line rather than by
       painting anything on top of it. A tongue is a place where the snow
       comes a long way further down than it does on either side; that is not
       a metaphor for a glacier, it is the definition of one. They are cut
       high out of a field read faster around the range than up it, so most
       of the range has none and the ones it has are strips rather than
       blobs.

     — and no rock on the ice, which is the whole picture in one line: a
       bright tongue running down between two dark ribs.

   How much of any of that survives is the band's own air, which is what
   stops four bands reading as one band drawn four times. The far band keeps
   a tenth of the contrast and is very nearly a flat blue shape with a jagged
   top edge; the near band keeps nearly all of it. Its relief goes the same
   way, and that one is not taste either: a far band with the near band's
   cols cut into it would show sky through them, and the entire point of a
   far band is that it is the thing seen *through* the near band's cols.

   What makes them a range rather than wallpaper is that each band moves by a
   different fraction of the camera's own translation. They used to be three
   rings pinned to the rider, and a ring pinned to the rider has parallax
   with nothing — three of them have parallax with each other, which is to
   say none, and the whole horizon read as a painted backdrop bolted to the
   front of the lens. So every band is now given an apparent distance instead
   of a look: the nearest reads at six kilometres, the furthest at forty-two.
   The fraction falls straight out of that and is not a tuning knob — a ring
   drawn at radius R that has to read as being D away must move by exactly
   R/D of whatever the camera just did. The near band gets a fifth of the
   rider's movement, the far band about a twentieth, and the two slide
   against each other the whole way down the hill.

   That debt is paid out around the ring rather than across it, and it is the
   one liberty in this file. The honest motion of a distant range is a
   translation: ride past it and both flanks slide backwards while the peaks
   dead ahead only grow. But the run is endless — z passes twenty kilometres
   and keeps going — and a rigid closed ring cannot be translated forever. It
   would have to wrap, and a ring that wraps jumps. So the k·Δ metres a band
   owes the camera are carried along its own circumference: the same distance
   at the same rate, which comes back to where it started after a whole turn
   and so never accumulates a number big enough to lose precision in. One
   flank then scrolls the way it should and the other scrolls the way it
   should not, and against a skyline nobody has seen before, nobody can say
   which is which. Only the lateral half of the camera's movement is paid
   honestly, as a real sideways shift, and it can be — the piste wanders
   rather than wandering off, so that number is bounded by construction.

   One number decides everything else about a band: how much air is in front
   of it. Extinction is exponential in distance, so `1 − e^(−D/H)` is the
   fraction of a band's own colour the air has already eaten, and that single
   value sets how far it is pulled towards the sky, how much of its form
   light survives, and how completely a storm takes it. The far band is
   nearly sky; the near one is still mostly rock.

   And the light is two lamps: a key from wherever the sun or moon is, and a
   sky-to-snow hemisphere that fills the shadows. Snow is one colour over the
   entire screen; that fill is what stops it reading as a blank page.

   Last, and it draws nothing: this file knows where the sun is, so it is
   also the file that says where the sun is *on screen*. The crepuscular pass
   downstream marches towards a point in the frame and needs both that point
   and one number for how much light is reaching it — behind the camera,
   under the horizon or smothered by a storm all mean nothing to march. That
   is `project(camera)` and `sun`, and it is deliberately not folded into
   `update`, because the answer depends on where the chase camera ended up
   this frame and `update` runs before the chase camera has decided. */

import { snoise2, noise2, hash2 } from './noise.js';
import { heightAt, nearestCenter } from './terrain.js';
import { TERRAIN, RENDER } from './config.js';
import { SKY_GLSL } from './shading.js';

const RADIUS = 2900;
const CONE_R = RADIUS * 0.95;

/* The shadow cascade, in one place because the four numbers are chosen
   against each other and moving one alone breaks the set.

   `REACH` is the half-width of the box the shadow covers, in metres, and
   `MAP` is how many texels are spread across it — so a texel is REACH·2/MAP
   metres, currently about nine centimetres, which is fine enough to resolve
   a branch and a board. `DIST` is how far up the sun vector the lamp is
   parked and `DEPTH` is how far either side of it the orthographic camera
   looks; together they have to bracket everything that can cast into the box,
   which on this mountain means the tallest tree plus the deepest hollow plus
   however high a rider can be thrown. */
/* Density, because everything else about a shadow follows from it.

   A snowboard is 1.5 m long and about 25 cm across. At the old 2048 over
   `SHADOW_REACH` metres — nine centimetres a texel — the board's own shadow
   was three texels wide, which is less than the tap pattern that then blurs
   it, so the one shadow a rider looks at all the time was the one the map
   could not draw. Doubling to 4096 halves the texel to four and a half
   centimetres and the board becomes six texels: still small, but now it
   survives the filter and arrives under the board instead of as a grey haze
   somewhere near it.

   Doubling costs a four-times-larger depth map and four times the shadow-pass
   fill, which a phone should not be asked for. `shadowMapFor` picks the size
   from what the device actually reports; everything below is derived from
   whichever it got, so the two paths cannot drift apart. */
const SHADOW_REACH = 92;
const SHADOW_MAP_NEAR = 4096;
const SHADOW_MAP_FAR = 2048;

/* And the bias in texels rather than in metres, which is the unit it is
   actually in.

   Acne is a depth slope sampled across one texel, so the offset a map needs
   to stay clean is proportional to how much world one texel covers — and the
   offset it can afford before a shadow detaches from its caster is a fixed
   number of centimetres. Those two facts pull in opposite directions and the
   old 0.25 m was the truce at nine centimetres a texel: about 2.8 texels,
   and about a board's width, which is why the board's contact never landed.

   Written as texels the truce survives a change of resolution. Measured on a
   frozen frame at both sizes: below about two texels the trees break out in
   self-shadow acne, and at 2.2 they are clean at either resolution — but at
   4096 those same 2.2 texels are ten centimetres instead of twenty-five, and
   ten centimetres is under a boot rather than over a board. */
const SHADOW_BIAS_TEXELS = 2.2;
/* A phone is not asked for the dense map. `hover: none` is the same test the
   touch pad uses in main.js, so the two agree about what kind of device this
   is rather than each guessing separately. Decided once, here, because the
   texel size is read both by the light's setup and by the per-frame snap that
   keeps the shadow box on whole texels — and those two disagreeing about how
   big a texel is would put a crawl back into every edge. */
const SHADOW_MAP = typeof window !== 'undefined'
  && window.matchMedia?.('(hover: none)').matches
  ? SHADOW_MAP_FAR : SHADOW_MAP_NEAR;
// Metres of world per texel — the unit the two offsets below are really in.
const SHADOW_TEXEL = (2 * SHADOW_REACH) / SHADOW_MAP;
/* The sun is half a degree wide, so nothing it casts has a hard edge, and
   this is the cheap stand-in: it widens the PCF taps by a constant, which is
   a constant penumbra rather than one that grows with distance from the
   caster. In texels for the same reason as the bias — and deliberately a
   little tighter in world terms than the old 2.6 taps of nine centimetres,
   because a constant 23 cm penumbra is far too soft where it matters most.
   The true penumbra a metre under the board is about a centimetre. */
const SHADOW_RADIUS_TEXELS = 2.6;
// Dynamic caster shadows cannot be baked, but their contribution can still
// have temporal inertia. A one-second fade prevents horizon/storm thresholds
// from ever publishing a whole new lighting state in one frame.
const SHADOW_FADE_RATE = 5;
const SHADOW_DIST = 190;
const SHADOW_DEPTH = 150;
// The orthographic map ends at a real line in world space. Without a receiver
// fade, a long tree shadow is present on one side of that line and absent on
// the other. Fourteen metres is wide enough that the hand-over reads as light
// falloff, while leaving the detailed central 156 m of the map untouched.
const SHADOW_EDGE_FADE = 14;

/* Three's mapped-light helper deliberately returns fully lit the instant a
   receiver leaves the orthographic projection. DirectionalLightShadow has no
   public per-receiver fade, so install the fade at the one shared point that
   has the receiver's projected coordinate. This changes no matrices, no
   update cadence and, importantly, none of the texel-stabilised light motion
   below. It is installed before the first render compiles any material.

   Keep the transform defensive. If a future Three revision changes the
   helper, an unmodified hard edge is preferable to corrupting every lit
   shader. The current chunk has exactly three non-point variants (PCF, VSM
   and basic); point shadows begin after the split and are left alone. */
function installShadowCoverageFade(THREE) {
  const chunks = THREE.ShaderChunk;
  const source = chunks?.shadowmap_pars_fragment;
  const marker = 'alpenShadowCoverage';
  if (typeof source !== 'string' || source.includes(marker)) return;

  // The chunk has an earlier point-light *declaration* block. The final
  // occurrence starts the point sampling functions and is the intended cut.
  const pointStart = source.lastIndexOf('#if NUM_POINT_LIGHT_SHADOWS > 0');
  if (pointStart < 0) return;
  const mappedLights = source.slice(0, pointStart);
  const pointLights = source.slice(pointStart);
  const shadowReturn = 'return mix( 1.0, shadow, shadowIntensity );';
  const variants = mappedLights.split(shadowReturn).length - 1;
  if (variants !== 3) return;

  const edgeUv = (SHADOW_EDGE_FADE / (2 * SHADOW_REACH)).toFixed(6);
  const fadedReturn = [
    'float alpenShadowEdge = min(',
    '\t\t\t\tmin( shadowCoord.x, 1.0 - shadowCoord.x ),',
    '\t\t\t\tmin( shadowCoord.y, 1.0 - shadowCoord.y )',
    '\t\t\t);',
    `\t\t\tfloat alpenShadowCoverage = smoothstep( 0.0, ${edgeUv}, alpenShadowEdge );`,
    '\t\t\treturn mix( 1.0, shadow, shadowIntensity * alpenShadowCoverage );',
  ].join('\n');
  chunks.shadowmap_pars_fragment = mappedLights.replaceAll(shadowReturn, fadedReturn)
    + pointLights;
}

/* How far under the rider the curtain's apex hangs. It has to clear the
   deepest hollow the hill can dig — four octaves of noise and a cliff on top
   of them is a little over twenty metres — and then clear the rider as well,
   who spends a good part of the run in the air above it. Every metre of it
   is also a metre the curtain's far rim drops below the horizon, so this is
   as small as it is allowed to be and no smaller. */
const APEX = 34;

/* And how much steeper than the curtain the ranges' feet are pitched. They
   have to stand *below* the far edge of the terrain mesh or a gap of sky
   opens under them; this is the margin that guarantees it at every radius,
   and it is why the feet are never actually seen. */
const FOOT = 0.06;

// Where the curtain's pitch is measured: the edge of the fog, and the edge
// of the mesh. Between them they bracket everything that is ever visible.
const PROBES = [RENDER.fogFar, TERRAIN.ahead];
const PITCH_EASE = 0.5;      // per second, so a change of chapter is a drift

/* And the band it is allowed to come back in, taken from the hill's own
   definition rather than picked: the grade cannot leave `base` by more than
   the sum of its waves, and the probes can add to that only what the noise
   riding on top is worth over the shorter of them. */
const SWING = TERRAIN.grade.waves.reduce((a, w) => a + w.amp, 0);
const PITCH_MIN = Math.max(0.04, TERRAIN.grade.base - SWING - 0.06);
const PITCH_MAX = TERRAIN.grade.base + SWING + 0.12;

/* The aurora's band: where it is hung, and how bright it is allowed to get.

   Both numbers that matter here come from the chase camera rather than from
   anything about auroras. It looks seven degrees below the horizon — that
   pitch is fixed, because the camera and its look point are both anchored to
   the rider's own height and neither knows how steep the hill is — and it
   opens between sixty-two and eighty-six degrees vertically. So the sky the
   player is ever shown runs from about four degrees below the horizontal,
   where the mountain tops are, to about twenty-four above it. This band was
   first hung between fourteen and sixty-two degrees, which is where an
   aurora belongs and which put nearly all of it above the top edge of the
   frame. It now sits between two and forty-three, brightest at eleven, and
   fades out over the last of what can be seen.

   The arc is wide for the same reason. The frame is ninety-four degrees
   across at sixteen by nine, and a rider mid-carve is pointing thirty off
   the fall line; anything narrower than this and the display's own edge
   turns up in shot. */
const AURORA = {
  azimuth: 0,       // radians off the run's own heading, which points north
  arc: 2.9,
  foot: 0.035,      // radians of elevation, bottom and top of the band
  head: 0.75,
  /* The ceiling on an additive layer in a graded picture. It sat at 0.30 for
     a long while, which against a night sky that had since been pushed down
     towards black was a display you had to be told about: the folds are
     sparse by construction, so the ceiling is only ever paid on a fraction
     of the band and the head-line worry — clipped additive green — never
     actually arrives at it. Half again is a curtain you notice from the
     piste and still a long way from a green wash. */
  gain: 0.55,
};

/* The counterglow, in three numbers.

   The band is hung between half a degree and twenty, which sounds low for
   something people photograph looking up at and is where it belongs: the
   Earth's shadow rises out of the *horizon*, and the chase camera's own
   framing — see the note on the aurora above — gives the player about four
   degrees of sky below the horizontal and twenty-four above it. A band
   hung any higher would be a band nobody is ever shown.

   `gain` is the ceiling on it. Alpha-blended rather than added, so unlike
   the aurora it cannot clip anything and does not have to be kept quiet for
   the grade's sake; what it can do instead is paint a bruise across a
   quarter of the sky, which is what the ceiling is for. It sat at a half
   while the band was being aimed and went up once it was clear how much of
   it the skyline eats: the bottom two thirds of this thing is behind a
   mountain most of the time. */
const BELT = {
  foot: 0.010,
  head: 0.34,
  gain: 0.62,
};

/* The mist lattice, in metres and a handful of ratios.

   `spacing` is chosen against the hill rather than against the weather. The
   run falls about three metres in every ten it travels and the curtain is
   four hundred metres out, so the lowest layer that can still be seen ahead
   of the rider is roughly a hundred and twenty metres below them — anything
   under that meets the ground beyond the fog and is invisible from the first
   frame to the last. Ninety-six therefore keeps one or two sheets inside
   that window at all times and hands the rider a new one to descend through
   about every ten seconds at speed. It was three hundred to begin with,
   which is a beautiful number for one cloud deck and means most of a run
   sees no mist at all.

   `depth` is the optical depth straight down through one sheet — not a
   thickness in metres, because the metres cancel: what the fragment shader
   actually wants is depth over the sine of the view angle, so the thickness
   and the density only ever appear multiplied together and there is no point
   carrying them separately.

   `cap` is the most any single sheet may take out of the picture, and it is
   the one number here that is about playability rather than about air.

   `aniso` is why the banks read as banners. The field is sampled three times
   more coarsely across the run than along it, so a bank is drawn out into
   something lying across the valley rather than a round blob — which is what
   wind does to cloud and what the eye reads as a ridge having caught one. At
   `field` the tile is four hundred metres down the run and twelve hundred
   across it, which puts a fold of cloud every fifty metres and a whole bank
   every few hundred: cloud scale rather than fog scale, and the difference
   between the two is the entire reason this reads as weather. */
const MIST = {
  spacing: 96,
  depth: 0.74,
  live: 3,
  fade: [80, 144],    // metres of altitude over which a level is given up
  reach: 1.06,        // sheet radius, as a multiple of the fog distance
  cap: 0.70,
  field: 0.0024,      // tiles of noise per metre along the run
  aniso: 0.34,        // and across it
  cut: 0.36,          // where the noise stops being air and starts being cloud
  drift: 0.12,        // how much of the wind's speed a bank actually carries
  segments: 40,
};

/* The four bands.

   `radius` is where the ring is actually drawn and `far` is what it is meant
   to read as — they are two different questions and conflating them is what
   made the old rings wallpaper. Everything about the parallax comes out of
   their ratio.

   The heights are not free either. What sets a band's place on the skyline is
   `height / radius` and nothing else, because the foot is pinned at
   −radius·(pitch + FOOT), so the peak sits at radius·(height/radius − pitch −
   FOOT) and the radius divides straight back out. That ratio therefore has to
   *rise* with distance or the near bands stand in front of the far ones and
   the stack collapses into a single ridge — which is what the old three did:
   the middle ring was the tallest thing on the horizon and the furthest ring
   was hidden behind both the others.

   That spread has been opened up. It ran 0.315 down to 0.276 — a little over
   two degrees between the top band and the bottom one, which is enough for
   every band to peek over the one in front of it and not enough for any of
   them to have a *shape* of its own against the next. It now runs 0.330 down
   to 0.272, which is three and a bit degrees, and the difference on screen is
   out of all proportion to the number: at two degrees the four bands are one
   ridge drawn four times, and at three they are a range with distance in it.

   The colours are the palette's job and they are the largest area of it in
   the frame after the snow itself: blue-biased neutrals from a pale
   near-haze at the back to something with real weight at the front. None of
   them is white and none of them is grey. The amber arrives at run time and
   only where a low sun is actually landing.

   These are further apart than they were too, and in both directions at
   once. The far band went paler and cooler, the near band went darker and a
   step towards violet — which is what rock at six kilometres actually looks
   like under a blue sky, and which gives the stack somewhere to travel
   between. Four tints inside a fifth of the value range is a gradient; these
   cover half of it.

   The heights are unchanged through all of the work below, and that is worth
   a line because it very nearly was not. What decides how tall a range
   *looks* is the mean of its skyline rather than the ceiling that skyline is
   measured against, so a profile with real cols cut into it draws a lower
   horizon than one with a plateau under it — the first draft of the new one
   came out a quarter shorter and these four numbers all went up by a fifth
   to pay for it. That was the wrong end to fix it at. The relief is bounded
   below now instead, so the mean comes back to where it always was and the
   heights are once again what they say they are: how far the tallest summit
   on the ring stands above the curtain. */
export const RANGES = [
  { radius: 2380, height: 1220, far: 42000, seed: 21, segments: 720, tint: '#d5dce7' },
  { radius: 2010, height: 980, far: 21000, seed: 33, segments: 660, tint: '#aeb9cc' },
  { radius: 1640, height: 750, far: 11500, seed: 47, segments: 600, tint: '#7c899f' },
  { radius: 1280, height: 560, far: 6200, seed: 59, segments: 540, tint: '#53596a' },
];

/* What the horizon is made of, in the units a photograph would give you.

   The three scales are written as features around a whole ring rather than
   as noise frequencies, because the only thing that matters about any of
   them is how many the player can see at once — and the frame is about a
   quarter of the ring, so divide by four for what is actually on screen.

   Five massifs is therefore one filling the frame with the shoulder of the
   next coming in at its edge, which is what a range looks like from a valley
   floor: a cluster of high summits, a long col, another cluster. Eighteen
   summits is four or five across the frame, near enough to count and far
   enough apart to have shapes of their own. Forty-eight knife edges is the
   detail on their flanks, and it is also the sampling limit — at the 720
   segments of the far band that is fifteen points a feature. The profile can
   now curve through a knife edge instead of exposing the sampling polygon.

   `sharp` narrows the ridge. `floor` is what is left of a massif in the
   middle of a col, and it is not zero on purpose: at zero the massifs are
   islands with nothing between them, and a range has shoulders.

   `fill` is what is left to choose about the profile and it is the one
   number in this block that is a taste rather than a measurement — how much
   of the range stands up rather than down. Under a half it is spires in a
   basin, over three quarters it is a plateau with valleys cut into it. Real
   ranges are nearer the second than instinct says, which is most of why the
   old horizon read as hills: it was drawn as spires and then floored at
   nearly two thirds to stop it looking like teeth.

   `relief` is how much of its own height a band's skyline is allowed to
   swing through, and it is bounded well short of all of it. That bound is
   what keeps the mean skyline where the old plateau had it, and it is also
   honest — a real range seen from a valley swings between its cols and its
   summits, which on the Bernese Oberland is about a third of the way from
   the valley floor to the tops, not the whole distance. `flatten` is how
   much of that swing the air takes off a far band. `detail` is the floor
   under how much of the contrast survives, and `bias` bends it: taken
   straight, contrast falls off so much faster than linearly with air that
   the two middle bands come out with nothing in them at all.

   The last three are the snow line. `above` is how much of the range stands
   over it, and asking for it that way round is the whole trick — see the
   note where it is used. `wobble` is what a south face buys itself over the
   north face beside it. `glacier` is how far a tongue drags the line down,
   and it is deliberately more than twice the wobble: a glacier that reaches
   no further than the noise already on the line is not a glacier, it is a
   blotch. */
export const HORIZON = {
  massif: 5,
  horn: 18,
  knife: 48,
  sharp: 1.6,
  floor: 0.24,
  fill: 0.62,
  relief: 0.66,
  flatten: 0.50,
  detail: 0.05,
  bias: 0.50,
  above: 0.85,
  wobble: 0.12,
  glacier: 0.30,
  // Tiles of the shared noise field around a whole ring. An integer, because
  // the field repeats at one and the ring has to close on itself.
  tiles: 4,
};

/* The mid-distance mountain is actual geometry rather than another picture.

   It is a closed annular heightfield, generated once at startup, pitched onto
   the same haze curtain as the procedural ranges and kept well inside the far
   plane. The panorama remains visible through its cols and through the lower
   down-run sector; everywhere else this shell supplies the facets, overlap and
   real depth a 1774-pixel equirectangular plate cannot invent. */
const RELIEF = {
  inner: 620,
  crest: 1020,
  outer: 1420,
  height: 400,
  apparentFar: 4600,
  segments: 768,
  radialSegments: 18,
  seed: 83,
  crestAt: 0.62,
  profilePower: 0.72,
  corridorFrom: 0.72,
  corridorTo: 0.92,
  corridorCut: 0.35,
  snowLine: 0.38,
  snowFade: 0.10,
};

/* One source of truth for the plate's maximum contribution. The range
   crossfade consumes the same value, so changing the image/model balance can
   never leave the fallback ribbons stuck half-visible. */
const PANO_MAX = 0.74;

/* The scale height of the air, in metres — the distance over which it eats
   1/e of whatever is behind it. Twelve kilometres is thick for real alpine
   air and deliberately so: the point of the number is not meteorology, it is
   that one exponential decides how far each band is pulled towards the sky,
   how much of its form light it keeps and how fast a storm takes it, so the
   four bands cannot drift out of agreement with each other. */
const EXTINCTION = 12000;
const airAt = (far) => 1 - Math.exp(-far / EXTINCTION);

/* How far a band is pulled towards the sky's own mid stop, at full air —
   which is the whole reason a dusk range is a dusk colour.

   Raising this looks like it should flatten the stack, since every band is
   being pulled towards the same place, and it does the opposite: the pull is
   scaled by the band's own air, and the four airs run from 0.40 to 0.97. So
   what this number really sets is the *spread* of the bleed, and at 0.62 the
   far band gives up three fifths of its colour to the sky while the near one
   gives up a quarter. At 0.52 it was half and a fifth, and the two nearest
   bands were doing almost the same thing as each other. */
const SKY_BLEED = 0.62;

/* How far the piste is allowed to have wandered before the lateral parallax
   stops believing it. The route is a sum of sines and the corridor holds the
   rider inside it, so this is never reached — it exists so that a rider who
   has somehow ended up on the containment wall cannot drag the horizon with
   them. */
const LATERAL_MAX = 140;

const TAU = Math.PI * 2;

const smooth01 = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const ramp = (v, a, b) => smooth01(clamp01((v - a) / (b - a)));
// Into the first tile of a field that repeats at one, which for a tiling
// texture is not an approximation of anything — it is the same sample
const frac = (v) => v - Math.floor(v);

const DOME_VERT = `
  uniform float uPanoYaw;
  varying highp vec3 vDir;
  varying highp float vPanoU;
  void main() {
    vDir = normalize(position);
    /* The panorama's horizontal coordinate, taken from the sphere's own uv
       rather than re-derived from atan per fragment. The two are the same
       number — the sphere's u *is* the azimuth over two pi — but the atan
       has a jump at the back of the ring, and the fract on top of it another,
       and at each jump the screen-space derivative the mip selector reads is
       enormous: one column of fragments samples the smallest mip and draws a
       blurred seam down the sky. The geometry already solved this — the
       sphere duplicates its seam column with u at nought on one side and one
       on the other — so the varying is continuous across every quad, the
       wrap is left to the sampler's own RepeatWrapping, and no fract is
       needed anywhere. */
    vPanoU = 1.0 + uPanoYaw - uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOME_FRAG = `
  precision highp float;
  uniform vec3 uZenith, uMid, uHorizon, uHaze, uGlow, uSunDir;
  uniform float uGlowStrength;
  uniform float uCloud;
  uniform vec2 uCloudDrift;
  uniform sampler2D uPanoClear, uPanoStorm;
  uniform float uPanoStrength, uPanoStormMix;
  uniform vec2 uSunAz;
  uniform vec3 uSunlit;
  varying highp vec3 vDir;
  varying highp float vPanoU;

  ${SKY_GLSL}

  void main() {
    // Re-normalised per fragment: the interpolation across a facet of the
    // dome is a chord, and at 288 lines the 1% it was out by was nothing.
    // At native resolution the seventh power below turns it into a visible
    // ripple of facets through the middle of the sun's lobe.
    vec3 dir = normalize(vDir);
    float up = dir.y;
    /* The two stops are pulled a long way down the dome.

       Spread over the top two thirds of the sky, as they were, the pale
       horizon stop occupies almost the entire frame — the camera looks
       slightly down at a rider, so a dome that only turns blue above 0.3 is
       a dome that is never blue in the picture. Real alpine air runs out
       fast: at altitude the sky is properly deep barely twenty degrees off
       the horizon, which is exactly what these ranges now say. */
    vec3 c = mix(
      mix(uHorizon, uMid, smoothstep(-0.05, 0.14, up)),
      uZenith,
      smoothstep(0.10, 0.52, up)
    );
    /* Generated Swiss ranges, relit rather than pasted in.

       The panorama contributes structure and a restrained amount of material
       colour; the procedural gradient above still owns the hour of day. That
       is why a clear-morning source can survive dawn, dusk and moonlight
       without becoming a rectangular photograph behind the weather.

       The whole block is behind a uniform branch — the same style the storm
       plate already uses one level down — because at night and in a whiteout
       the plate's strength falls to nothing and two texture fetches over the
       most expensive shader on screen would be buying nothing at all. The
       condition is uniform, so the derivatives the mip selector needs are
       still well defined inside it. */
    if (uPanoStrength > 0.005) {
      vec2 panoUv = vec2(
        vPanoU,
        /* The source was generated from a high Alpine viewpoint, so almost
           all of its mountain mass lies below its own geometric horizon.
           Sampling that horizon at world 0 degrees hid the plate behind the
           terrain and haze cone. Aim 3.5% lower into the source: its
           photographed skyline then stands about 6.3 degrees above the game
           horizon, with its base still disappearing naturally behind the
           real valley. */
        clamp(asin(clamp(dir.y, -1.0, 1.0)) * 0.3183098862 + 0.515, 0.0, 1.0)
      );
      vec3 pano = texture2D(uPanoClear, panoUv).rgb;
      // Clear weather is the common case, so it pays for one sky lookup. The
      // second plate is sampled only while a front is actually crossfading in.
      if (uPanoStormMix > 0.001) {
        pano = mix(pano, texture2D(uPanoStorm, panoUv).rgb, uPanoStormMix);
      }
      float panoLum = dot(pano, vec3(0.2126, 0.7152, 0.0722));
      vec3 panoChroma = clamp(pano / max(0.035, panoLum), vec3(0.48), vec3(1.8));
      /* Relight relative source luminance around the plate's own mid-grey.
         Snow, sky and dark rock all sat near the bright end of the previous
         smoothstep, which erased the very folds that identify the photograph.
         This centred exposure keeps a bounded 0.42–1.42 range while inheriting
         the procedural hour-of-day colour from c. */
      float panoForm = clamp(1.0 + (panoLum - 0.45) * 1.20, 0.58, 1.30);
      vec3 relitPano = c * panoForm * mix(vec3(1.0), panoChroma, 0.12);
      /* Alpenglow on the plate. The procedural ranges already catch the one
         amber in the palette on the flanks facing a low sun; the plate never
         did, so at golden hour the hero range sat cold behind foothills that
         were on fire. The term is the same borrowed colour they use —
         uSunlit, already zero at noon, at night and in a storm — landed on
         the bright pano pixels near the sun's own azimuth. Gated on the
         plate's relit form rather than a snow line, because bright in this
         source *is* snow, and added rather than mixed for the reason the
         ranges' note gives: alpenglow is light arriving on snow, and a lerp
         towards orange turns the range to cardboard. */
      float az = max(0.0, dot(dir.xz, uSunAz) / max(length(dir.xz), 0.001));
      relitPano += uSunlit * (pow(az, 6.0)
        * smoothstep(0.60, 1.15, panoForm) * 0.30);
      // The plate is the distant range, not the entire atmosphere. Let it own
      // the lower sky and hand the zenith back to the procedural gradient/deck.
      float panoBand = 1.0 - smoothstep(0.30, 0.54, up);
      c = mix(c, relitPano, uPanoStrength * panoBand);
    }
    // One dot product of atmosphere: the sky is brighter and warmer near
    // whatever is lighting it, and the effect is strongest at the horizon
    float lobe = max(0.0, dot(dir, uSunDir));
    c += uGlow * (pow(lobe, 7.0) * 0.85 + pow(lobe, 2.0) * 0.14)
       * uGlowStrength * (1.0 - smoothstep(0.1, 0.75, up) * 0.55);
    // The deck, from the same string shading.js's fog term includes, so the
    // sky a ridge dissolves into and the sky above it are the same sky.
    vec2 deck = n64Deck(dir, uCloudDrift, uCloud);
    c = mix(c, n64DeckShade(deck.y, lobe, uHaze, uHorizon, uGlow), deck.x);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const STAR_VERT = `
  attribute float aSize;
  attribute float aTwinkle;
  attribute vec3 aTint;
  varying float vFade;
  varying vec3 vTint;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uScale;
  void main() {
    /* Horizon extinction: the air a star's light crosses grows without bound
       as it approaches the skyline, so real stars dim and go out over the
       last dozen degrees — and the panorama's ridges live in exactly those
       degrees, so without this a star could twinkle in front of a mountain.
       The fade is on the direction's own y, which for a point pinned to the
       dome is its elevation's sine; gone by the horizon, full a little over
       twelve degrees up. */
    float extinct = smoothstep(0.06, 0.21, normalize(position).y);
    vFade = uAlpha * extinct * (0.55 + 0.45 * sin(uTime * 1.7 + aTwinkle * 40.0));
    vTint = aTint;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale;
  }
`;

const STAR_FRAG = `
  precision mediump float;
  varying float vFade;
  varying vec3 vTint;
  void main() {
    if (vFade <= 0.01) discard;
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;
    gl_FragColor = vec4(vTint, vFade);
  }
`;

const AURORA_VERT = `
  varying vec2 vUv;
  varying vec3 vDir;
  void main() {
    vUv = uv;
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AURORA_FRAG = `
  /* The one shader here that asks for full precision, and it has to. Every
     other one in this file works on numbers between zero and one; this one
     scrolls a texture coordinate by a clock that only goes up, and the
     finest octave multiplies that clock by six. Half an hour into a run
     that is a number in the thousands being sampled against a texel of one
     part in a hundred and twenty-eight, which in half precision is not a
     shimmer, it is a stutter and then a freeze. */
  precision highp float;
  uniform sampler2D uNoise;
  uniform vec3 uLow, uHigh;
  uniform float uTime, uStrength, uFoot, uHead;
  varying vec2 vUv;
  varying vec3 vDir;
  void main() {
    /* The mesh gets one zero-strength warm-up draw before its first aurora so
       the program is not compiled in the middle of a rare night. Leave before
       the four texture reads; the warm-up costs only a coherent discard. */
    if (uStrength <= 0.002) discard;
    vec3 dir = normalize(vDir);
    // Height in the band, taken from the direction rather than from the
    // mesh's own v, so the ramp does not care how the band was built and the
    // horizon fade below is measured against the real sky
    float t = clamp((dir.y - uFoot) / (uHead - uFoot), 0.0, 1.0);

    /* Three octaves of the same tiling field, fetched rather than hashed.
       The whole coordinate streams upward and drifts sideways six times
       slower, and each finer octave inherits both movements multiplied by
       its own scale — which is where the shimmer comes from and why it costs
       nothing but the fetch. The vertical scale is a quarter of the
       horizontal one, because that ratio is the whole difference between a
       curtain and a cloud. */
    vec2 q = vec2(vUv.x * 1.3 + uTime * 0.0035, t * 0.34 - uTime * 0.021);
    float n = texture2D(uNoise, q).r * 0.55
      + texture2D(uNoise, q * 2.7 + vec2(0.31, 0.17)).g * 0.30
      + texture2D(uNoise, q * 6.3 + vec2(0.63, 0.11)).b * 0.15;

    // The folds are what is left once the flat middle of the noise is thrown
    // away. Cutting high is what keeps the display sparse and stops the band
    // reading as a green wash over the whole north.
    float fold = smoothstep(0.40, 0.86, n);
    /* The rays. A curtain is not a cloud: it is field-aligned, which on a
       screen means vertical striations running the height of the band. One
       more fetch buys them — the same field read fast across the sky and
       almost not at all up it, so a bright column at the foot is the same
       bright column at the head. Multiplied into the folds rather than added
       beside them, because rays are structure *in* the curtain, and centred
       on one so the band's overall energy is untouched. They dissolve
       towards the head, where a real display frays into haze — which is also
       what roots them visually at the foot. */
    float ray = texture2D(uNoise, vec2(vUv.x * 5.0 + uTime * 0.006, 0.71 + t * 0.05)).g;
    fold *= mix(0.40 + 1.20 * smoothstep(0.30, 0.80, ray), 1.0,
      smoothstep(0.55, 0.95, t));
    // Brightest a quarter of the way up and gone by the top; faded off both
    // ends of the arc so the curtain has no cut edge; and faded out towards
    // the horizon, where the haze would have had it
    float shape = smoothstep(0.0, 0.24, t) * (1.0 - smoothstep(0.26, 1.0, t))
      * smoothstep(0.0, 0.13, vUv.x) * (1.0 - smoothstep(0.87, 1.0, vUv.x))
      * smoothstep(0.045, 0.19, dir.y);

    float a = fold * shape * uStrength;
    if (a <= 0.002) discard;
    // Green at the foot, violet at the fringe, and the noise moved into the
    // mix so the colour breaks along the folds rather than in flat bands
    vec3 c = mix(uLow, uHigh, smoothstep(0.18, 0.85, t + n * 0.25 - 0.12));
    gl_FragColor = vec4(c, a);
  }
`;

const BELT_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BELT_FRAG = `
  precision mediump float;
  uniform vec3 uShade, uRose;
  uniform vec2 uSun;
  uniform float uStrength, uFoot, uHead;
  varying vec3 vDir;
  void main() {
    // Kept render-visible at zero so twilight never incurs a first-use compile.
    if (uStrength <= 0.003) discard;
    vec3 dir = normalize(vDir);
    /* Opposite the sun and nowhere else. The square is what keeps the band
       inside the quarter of the sky it belongs to instead of smearing it
       round to the flanks, where the sky is neither in shadow nor lit and
       where a dull blue wash over the horizon looks like a bug in the fog.
       The horizontal part of the direction is never near zero here: the band spans half a degree to
       twenty, so there is no straight-up case to guard against. */
    float anti = max(0.0, -dot(normalize(dir.xz), uSun));
    anti *= anti;
    // Height in the band, from the direction rather than from the mesh, so
    // the profile does not care how the band happens to have been built
    float t = clamp((dir.y - uFoot) / (uHead - uFoot), 0.0, 1.0);
    /* Weighted to the bottom, and hard. What is being drawn is a shadow
       cast on the air by a planet, so it is deepest where the air is
       thickest and there is simply nothing left of it two thirds of the way
       up. The foot is faded as well, because the bottom rim of this band
       stands behind the ranges and a hard edge appearing between two peaks
       is worse than no band at all. */
    float a = uStrength * anti
      * smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.28, 1.0, t));
    if (a <= 0.003) discard;
    // Dull blue at the foot, rose at the fringe — the shadow and the last of
    // the light standing directly on top of each other, which is the whole
    // reason anybody looks the wrong way at sunset
    gl_FragColor = vec4(mix(uShade, uRose, smoothstep(0.14, 0.66, t)), a);
  }
`;

/* The disc, which is the sun by day and the moon by night, and the reason it
   is a shader now rather than a radial gradient on a canvas: a gradient can
   only draw a full circle, and a full circle is the one thing the moon never
   quite is. Two signed circles do the whole job — the body, and an offset
   circle laid over one limb whose overlap is taken back out of the alpha, so
   the missing sliver shows the sky through it exactly as the real one does.
   The phase is fixed at a waxing gibbous, which is the moon of every night
   photograph and asks for no orbital bookkeeping, and the bite is scaled by
   how much moon the weather says the disc currently is: by day it closes and
   the sun is the same clean circle it always was.

   The vertex shader is the sprite's own billboard math written out by hand —
   centre from the model-view translation, corners spread in view space by
   the model matrix's scale — because three's built-in sprite shader belongs
   to SpriteMaterial and does not take a custom fragment stage. The mesh
   stays a THREE.Sprite; nothing about how it is placed or scaled changes. */
const DISC_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * scale;
    gl_Position = projectionMatrix * mv;
  }
`;

const DISC_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity, uMoon;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p);
    // The body, softened over the same tenth of the sprite the old canvas
    // gradient used, so the edge stays clean at any output resolution
    float disk = 1.0 - smoothstep(0.36, 0.46, r);
    if (disk < 0.004) discard;
    /* The terminator: a second circle whose centre sits outside the body, so
       its arc curves the correct way — concave towards the dark limb, which
       is what says gibbous rather than eclipse. Softened wider than the rim,
       because the terminator is a shadow crossing a sphere and not an edge. */
    float bite = 1.0 - smoothstep(0.26, 0.38, length(p - vec2(0.52, 0.18)));
    /* And mild limb darkening, moon only: the full face of a sunlit sphere
       falls off towards its rim. The sun's disc is left alone — it is an
       emitter, and the analytic soft rim above is already doing the work its
       gradient used to. */
    float limb = 1.0 - 0.28 * uMoon * smoothstep(0.10, 0.44, r);
    float a = uOpacity * disk * (1.0 - 0.94 * uMoon * bite);
    gl_FragColor = vec4(uColor * limb, a);
  }
`;

/* The mist, in two shaders that between them are about thirty instructions.

   Everything expensive about a volumetric is avoided by the sheets being
   flat: there is no march, no depth buffer read and no second pass. What is
   left is one length, one divide and two texture fetches.

   Precision is the one thing that needs care, and the fix is on the CPU. The
   noise field is anchored to the world so a bank does not swim with the
   rider, and world coordinates on this run reach twenty kilometres — a
   number that a mediump fragment varying resolves to about sixteen metres.
   So the vertex shader is handed the field's origin already reduced to its
   fractional cell, and everything it interpolates is small: the sheet's own
   radius either side of zero for the coordinate, and the camera-relative
   position for the view vector. The wrap is safe because the field tiles at
   one and the second octave is an integer multiple of the first, so a whole
   number of cells taken off the origin is a shift of a whole number of
   tiles, which is no shift at all. */
const MIST_VERT = `
  uniform float uRadius;
  uniform vec2 uOrigin, uCell;
  varying vec2 vQ;
  varying vec3 vRel;
  void main() {
    // The disc is built at unit radius and grown here rather than scaled on
    // the mesh, so that p is honest metres from the rider and the noise
    // coordinate below does not have to undo a scale to find them
    vec3 p = vec3(position.x * uRadius, position.y, position.z * uRadius);
    vQ = p.xz * uCell + uOrigin;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vRel = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const MIST_FRAG = `
  precision mediump float;
  uniform sampler2D uNoise;
  uniform vec3 uCool, uWarm, uSunDir;
  uniform float uDensity, uCut, uCap, uNear, uFar, uSun;
  varying vec2 vQ;
  varying vec3 vRel;
  void main() {
    /* As with the aurora, a zero-density warm-up draw is deliberately allowed
       through object visibility, but it must leave before two field samples. */
    if (uDensity <= 0.004) discard;
    float dist = length(vRel);
    /* How far along this sheet the eye is looking, which is the entire
       effect. A horizontal layer seen from straight above is one depth of
       air; the same layer seen along its own plane is unbounded. The floor
       under it is what stops the exponent below from being an infinity right
       on the horizon line, and it is set where a sheet is already opaque, so
       nothing is lost by clamping there. */
    float rawGraze = abs(vRel.y) / max(dist, 1e-4);
    float graze = max(rawGraze, 0.075);
    float n = texture2D(uNoise, vQ).r * 0.62
      + texture2D(uNoise, vQ * 3.0 + vec2(0.37, 0.61)).b * 0.38;
    // The banks are what is left when the flat middle of the noise is thrown
    // away — the same cut the aurora uses, and for the same reason: a field
    // taken straight is a uniform haze, which is the thing this is not
    float fold = smoothstep(uCut, 1.0, n);
    float a = (1.0 - exp(-uDensity * fold / graze)) * uCap;
    /* An infinitesimally thin sheet becomes a ruler-straight opaque line when
       seen exactly edge-on. Real mist has thickness, so that line does not
       exist; dissolve the last degree into the shared haze instead. Adjacent
       sheets and the distance fog retain the bank while its carrier geometry
       becomes impossible to identify. */
    a *= smoothstep(0.018, 0.120, rawGraze);
    // Clear in front of the lens, and already the haze past the curtain.
    // Both ends of that are the fog's own two numbers wearing a hat.
    a *= smoothstep(uNear * 0.28, uNear * 0.92, dist);
    a *= 1.0 - smoothstep(uNear, uFar, dist);
    if (a < 0.004) discard;
    // A cloud is the one surface in the frame that is lit from inside as
    // much as from outside, so this is not a diffuse term — it is how much
    // of the sun is coming *through* the sheet towards the eye
    float lobe = max(0.0, dot(vRel / dist, uSunDir));
    gl_FragColor = vec4(mix(uCool, uWarm, lobe * lobe * uSun), a);
  }
`;

/* The volumetric horizon shell.

   Unlike the range ribbons below, this carries a real radial surface and
   normals. Pitch is applied analytically in the vertex shader instead of by
   rebuilding its 14,611 vertices whenever the route changes chapter. The
   matching radial shear on the normal keeps the precomputed facets correctly
   lit while the whole shell settles with the haze curtain. */
const RELIEF_VERT = `
  attribute float aRadius;
  attribute float aAltitude;
  attribute vec3 aGeology;
  uniform float uPitch;
  varying highp vec3 vWorld;
  varying highp vec3 vLocal;
  varying vec3 vNormal;
  varying float vAltitude;
  varying vec3 vGeology;
  void main() {
    float pitch = uPitch + ${FOOT.toFixed(4)};
    vec3 p = position;
    p.y -= aRadius * pitch;
    vec3 n = normal;
    vec2 radial = normalize(position.xz);
    n.xz += radial * (pitch * n.y);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vLocal = position;
    vNormal = normalize(mat3(modelMatrix) * n);
    vAltitude = aAltitude;
    vGeology = aGeology;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const RELIEF_FRAG = `
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uHaze, uSnow, uRockCool, uRockWarm, uIce, uAlpenglow;
  uniform float uStorm, uAir;
  varying highp vec3 vWorld;
  varying highp vec3 vLocal;
  varying vec3 vNormal;
  varying float vAltitude;
  varying vec3 vGeology;
  void main() {
    /* Preserve the welded normal, but let the physical folds still catch the
       moving light. The denser carrier keeps this as geology instead of
       exposing the triangulation as a low-poly art style. */
    vec3 n = normalize(vNormal);
    vec3 faceNormal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (dot(faceNormal, n) < 0.0) faceNormal = -faceNormal;
    n = normalize(mix(n, faceNormal, 0.30));
    float steep = smoothstep(0.16, 0.58, 1.0 - abs(n.y));

    /* Drainage has already been generated with the geometry. It lowers the
       snow line in a few coherent gullies, which creates glacier tongues
       rather than a texture full of unrelated pale streaks. */
    float line = ${RELIEF.snowLine.toFixed(4)} - vGeology.x * 0.16;
    float snow = smoothstep(line - ${RELIEF.snowFade.toFixed(4)},
      line + ${RELIEF.snowFade.toFixed(4)}, vAltitude);
    float summitRock = steep * smoothstep(0.48, 0.84, vAltitude)
      * (1.0 - vGeology.x * 0.58);
    float ridgeRock = smoothstep(0.54, 0.90, vGeology.z)
      * smoothstep(line - 0.03, 0.90, vAltitude) * 0.88;
    float rock = clamp(max(1.0 - snow, max(summitRock, ridgeRock)), 0.0, 1.0);
    float glacier = vGeology.x * snow
      * smoothstep(line - 0.06, line + 0.10, vAltitude)
      * (1.0 - smoothstep(0.78, 0.96, vAltitude));

    vec3 rockColor = mix(uRockCool, uRockWarm, vGeology.y);
    vec3 body = mix(uSnow, rockColor, rock);
    body = mix(body, uIce, glacier * 0.82);

    /* Stone still has structure beyond the geometry's facets. Slate carries
       fine tilted bedding; iron rock uses broader benches and cross joints.
       Every carrier fades by screen footprint before its period aliases. */
    float slateC = vLocal.y + vLocal.x * 0.20 + vLocal.z * 0.09;
    float ironC = vLocal.y * 0.60 - vLocal.x * 0.13 + vLocal.z * 0.17;
    float jointC = vLocal.x * 0.34 - vLocal.z * 0.25;
    float slateWave = sin(mod(slateC, 64.0) * 1.276272)
      * (1.0 - smoothstep(1.2, 3.8, fwidth(slateC)));
    float ironWave = sin(mod(ironC, 64.0) * 0.785398)
      * (1.0 - smoothstep(1.6, 4.5, fwidth(ironC)));
    float jointWave = abs(sin(mod(jointC, 64.0) * 0.589049));
    float slateInk = smoothstep(0.12, 0.90, slateWave) * 0.12;
    float ironInk = smoothstep(-0.25, 0.78, ironWave) * 0.07
      + (1.0 - smoothstep(0.03, 0.25, jointWave))
        * (1.0 - smoothstep(0.35, 1.20, fwidth(jointC))) * 0.10;
    body *= 1.0 - mix(slateInk, ironInk, vGeology.y) * rock;

    /* The broad response belongs to the actual facets. A restrained ice lobe
       is the only sharp term, and it vanishes into weather before a whiteout. */
    float direct = max(0.0, dot(n, uSunDir));
    float skylight = 0.64 + max(n.y, 0.0) * 0.16;
    body *= skylight + direct * 0.38;
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 halfDir = normalize(viewDir + uSunDir);
    float iceSpec = pow(max(0.0, dot(n, halfDir)), 36.0)
      * glacier * (1.0 - uStorm) * 0.24;
    body += uIce * iceSpec;
    body += uAlpenglow * direct * snow * (0.20 + 0.80 * vAltitude);

    /* The model is an atmospheric layer over the distant photographic range,
       not an opaque cardboard replacement for it. Its base disappears over
       real altitude, air removes contrast continuously, and a storm removes
       opacity rather than leaving the last few peaks as floating islands. */
    float foot = smoothstep(0.04, 0.34, vAltitude);
    float extinction = clamp(uAir * (0.92 - vAltitude * 0.30), 0.0, 0.64);
    vec3 c = mix(body, uHaze, extinction);
    float stormFade = 1.0 - smoothstep(0.18, 0.78, uStorm);
    float alpha = foot * (1.0 - uAir * 0.25) * stormFade * 0.78;
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(c, alpha);
  }
`;

const RANGE_VERT = `
  attribute float aMix;
  attribute float aFace;
  attribute float aAng;
  attribute float aTop;
  attribute float aU;
  uniform vec2 uSun;
  uniform float uLight;
  varying float vMix;
  varying float vShade;
  varying float vTop;
  varying float vSteep;
  varying float vU;
  void main() {
    vMix = aMix;
    // This column's own summit, so a fragment can ask how near the crest it
    // is without the shader having to know anything about the ring
    vTop = aTop;
    /* And the only steepness a silhouette has: how fast its own skyline is
       falling. It is the very same number the light below is inferred from,
       taken without its sign — a face is a face whichever way it leans, and
       the light cares which way that is while the rock on it does not. */
    vSteep = abs(aFace);
    vU = aU;
    /* A silhouette has no form to light, so the light is inferred from the
       only thing a silhouette knows about itself: which way its own skyline
       is falling. A ridge that drops away towards the sun catches it; the
       one dropping away from it goes dark. It is faded out with the same
       ramp as the colour, because a foot that has already given up its
       colour to the haze cannot still be catching light. */
    vShade = aFace * dot(vec2(-sin(aAng), cos(aAng)), uSun) * uLight * aMix;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RANGE_FRAG = `
  precision mediump float;
  uniform sampler2D uNoise;
  uniform vec3 uHaze, uPeak, uSnow, uRock, uIce, uSunlit;
  uniform float uRise, uLine, uWobble, uGlacier, uDetail, uAlpha;
  varying float vMix;
  varying float vShade;
  varying float vTop;
  varying float vSteep;
  varying float vU;
  void main() {
    /* Altitude, and it costs nothing: height over the band's own ceiling was
       already being interpolated for the haze fade below, and height over a
       ceiling is what an altitude is. Everything that follows is a question
       about a level rather than about a shape, which is the whole reason
       this can be done to a silhouette at all. */
    float alt = vMix;

    /* The glaciers come first, because they are not painted on top of the
       snow line — they *are* the snow line, moved. A tongue is a place where
       the snow reaches a long way further down than it does on either side.

       Read faster around the range than up it, so a feature comes out as a
       strip rather than a blob, and cut high so that most of the range has
       none: a horizon with a glacier every few degrees is not a high range,
       it is a marbled one. */
    float tongue = smoothstep(0.62, 0.86,
      texture2D(uNoise, vec2(vU * 3.2 + 0.31, alt * 0.22 + 0.07)).b);

    // The line itself: a level, wobbled by whatever the aspect of the slope
    // is worth, and dragged down wherever a tongue is running
    float line = uLine
      + (texture2D(uNoise, vec2(vU * 0.9, 0.17)).g - 0.5) * uWobble
      - tongue * uGlacier;
    float snow = smoothstep(line - 0.05, line + 0.07, alt);

    /* And the rock, which stands *in* the snow rather than under it. Every
       hill has bare ground at the bottom; what says four thousand metres is
       dark rock at the top, on the faces too steep to hold any.

       Three terms and they are all the mountain's own: how far up its column
       this is, how fast that column's skyline is falling, and a field read
       four times faster around the range than up it, so the rock arrives as
       vertical ribs. A face is buttresses and gullies, not a wall. */
    float rib = texture2D(uNoise, vec2(vU * 4.6, alt * 0.55 + 0.41)).r;
    float crest = alt / max(vTop, 0.06);
    /* The steepness has to be stretched before it is any use. Most of a ring
       is shoulder: the median column's skyline falls at about a fifth and
       only the top tenth gets past two thirds, so the raw number fed in
       straight put rock on nothing at all. This is that distribution pulled
       out over its own useful range and it is the only place in the file
       where a curve was fitted to a histogram rather than to a photograph. */
    float steep = smoothstep(0.06, 0.38, vSteep);
    float rock = smoothstep(0.40, 0.82,
      rib * 0.46 + steep * 0.50 + crest * 0.26 - 0.12);

    /* Now put them together, and the important part is that the snow above
       the line is *lighter* than the band's own colour and not equal to it.

       That was the whole of why the first three attempts at this could not be
       seen. A band is drawn dark at the top and pale at its foot, because its
       foot is dissolving into a curtain far lighter than any of the four
       tints — so climbing through the picture, the haze is already making
       everything darker as it goes. A snow line that only darkens what is
       below it is therefore pushing in the direction the gradient is already
       going, and the two do not add up to an edge, they add up to a slightly
       different slope. Reversing it locally is what makes a line: crossing
       upward has to make the picture brighter, against the gradient, and it
       can only do that if there is somewhere brighter than uPeak to go.

       So the band's tint is the *mean* of this rather than the top of it —
       roughly three fifths bright snow and two fifths dark rock, which is
       about the split a snow line at this height actually gives. The palette
       keeps its four-step ladder because the average of each band is where it
       always was; what has been added is contrast inside each step. */
    vec3 body = mix(uRock, uSnow, snow);
    /* The ice is the tongue and not the snowfield it comes out of. Painted
       all the way up, it lays a pale stripe over the summit above it and the
       peak stops being a peak; a glacier belongs at and just below the line
       it has dragged down, which is the only place it is doing any work. */
    float ice = tongue * snow
      * (1.0 - smoothstep(uLine + 0.04, uLine + 0.28, alt));
    body = mix(body, uIce, ice * 0.9);
    // and the rock last, so it lies over the snow and never over the ice —
    // which is the entire picture in one multiply: a bright tongue running
    // down between two dark ribs
    body = mix(body, uRock, rock * snow * (1.0 - tongue) * 0.9);

    /* And uDetail, which is the band's own air wearing its third hat, applied
       in one place at the end: it slides the whole of that structure back
       towards the flat tint the band would have had without any of it. The
       far band keeps a fifth and is very nearly the blue shape it always was;
       the near band keeps four fifths. At nought this file draws exactly what
       it drew before any of this, which is a property worth having. */
    body = mix(uPeak, body, uDetail);

    /* The air is not the same all the way up a mountain.

       vMix is height up the band and the colour used to ride it straight,
       which says that a range dissolves into the haze at a rate that has
       nothing to do with how much haze there is. Real air is densest at the
       bottom and thins out with height, so a band standing behind a lot of it
       is eaten a long way up its own flanks and one standing close is eaten
       only at its feet. uRise is that exponent and it comes straight off
       the band's own air, so the four of them separate on the way up as well
       as in overall colour — which is most of what stops a stack of
       silhouettes reading as one silhouette with contour lines on it. */
    vec3 c = mix(uHaze, body, pow(vMix, uRise)) * (1.0 + vShade);
    /* And the one warm thing on the horizon.

       The palette has exactly one amber in it and this is where a third of
       it lives: the ridges whose skyline falls towards a low sun, and only
       those. It is added rather than mixed, because alpenglow is light
       arriving on snow and not a different snow — a lerp towards orange
       desaturates the band and turns the whole range to cardboard, which is
       what the first version of this did. uSunlit is already zero at noon,
       at night and in a storm, so there is no gate wanted here.

       It does now know what it is landing on, though. Alpenglow is a colour
       that happens to snow: it is the last of the light scattered off ice
       crystals, and the rock beside it goes the plum-grey the photographs
       always show it going rather than pink. So most of the amber is held
       back until above the snow line and half of the rest is taken off the
       rock, which costs two multiplies and is the difference between a range
       lit at dusk and a range with a wash over it. */
    float glow = max(0.0, vShade)
      * (0.30 + 0.70 * snow) * (1.0 - 0.5 * rock * uDetail);
    gl_FragColor = vec4(c + uSunlit * glow, uAlpha);
  }
`;

export function createSky(THREE) {
  installShadowCoverageFade(THREE);
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3(0, 0.4, -1).normalize();
  // The sun flattened onto the ground plane, in world axes. Each band turns
  // its own copy of this into its own spun frame; nothing reads it directly.
  const sunXZ = new THREE.Vector2(0, -1);

  /* Generated 360-degree Alpine plates. A one-pixel neutral surface means
     the procedural dome is still a complete fallback; the reveal begins only
     after at least one real panorama has decoded. Clear and storm share the
     same equirectangular composition, so the weather can crossfade them
     without peaks ghosting sideways. */
  const panoFallback = new THREE.DataTexture(
    new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat,
  );
  panoFallback.colorSpace = THREE.SRGBColorSpace;
  panoFallback.needsUpdate = true;
  const panoClear = { value: panoFallback };
  const panoStorm = { value: panoFallback };
  const panoStrength = { value: 0 };
  let clearPlate = null;
  let stormPlate = null;
  let clearSettled = false;
  let stormSettled = false;
  let panoReady = 0;
  let panoTarget = 0;
  // 1 while the bound plate is the one the hour wants; 0 while the reveal is
  // being walked down so the sampler can be exchanged out of sight.
  let panoWish = 1;
  // 0 waits for both requests, 1 gives their replacements one invisible
  // binding/upload frame, and 2 starts the continuous reveal on the next.
  let panoStage = 0;
  // Which hour plate the dome is currently showing — the anchor the
  // hysteresis in `update` measures its margins from.
  let plateChoice = 'clear';

  // --- dome ----------------------------------------------------------------
  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color('#123a7a') },
      uMid: { value: new THREE.Color('#74a3de') },
      uHorizon: { value: new THREE.Color('#eaf0f8') },
      uHaze: { value: new THREE.Color('#e3ecf6') },
      uGlow: { value: new THREE.Color('#ffeccc') },
      uSunDir: { value: sunDir },
      uGlowStrength: { value: 1 },
      uCloud: { value: 0 },
      uCloudDrift: { value: new THREE.Vector2() },
      uPanoClear: panoClear,
      uPanoStorm: panoStorm,
      uPanoStrength: panoStrength,
      uPanoStormMix: { value: 0 },
      // Source centre looks down-run; its joined edge sits safely uphill.
      uPanoYaw: { value: 0.25 },
      // The plate's alpenglow: the ranges' own borrowed amber, and the sun's
      // heading flattened onto the ground. Both are written every frame.
      uSunAz: { value: sunXZ },
      uSunlit: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  // The panorama is evaluated per fragment, but its direction starts as a
  // vertex interpolation. A 96×64 carrier keeps that interpolation spherical
  // enough for the generated Alpine plate and the sun lobe at native output.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 96, 64), domeMat);
  /* After the opaque world rather than before it. Drawn first, the most
     expensive shader on screen ran for every pixel of the frame and the
     terrain then painted over most of its work; drawn last among the
     opaques, the depth buffer is already full of mountain and the early-z
     test throws those fragments away before the shader runs. The dome sits
     at 2900 m inside the 3600 m far plane, its depthTest was always on and
     it has never written depth, so the *picture* is bit-identical — only the
     order changed. Every transparent sky layer (belt, stars, aurora, glow,
     disc, ranges, mist) lives in the transparent list, which draws after all
     opaques whatever their renderOrder says, so their own ordering among
     themselves is untouched by this. */
  dome.renderOrder = 1;
  group.add(dome);

  const preparePlate = (texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    return texture;
  };
  let sunrisePlate = null;
  let nightPlate = null;
  let platesBound = false;
  const settlePlates = () => {
    /* Never reveal one weather plate while the other request is outstanding.
       If, say, clear arrived first, both samplers used to point at it and the
       later storm callback replaced one of them under whatever storm mix was
       live that frame — an asynchronous, full-strength picture cut. Waiting
       for both load/error callbacks makes the sampler replacement atomic. A
       single survivor remains a complete fallback for the missing plate.

       And it binds exactly once. The two hour plates are far heavier files
       than the weather pair and land seconds later on a cold cache — their
       callbacks also arrive here, and re-running the assignment below would
       yank a live sampler back to the clear plate at full strength: the same
       asynchronous picture cut this function exists to prevent, arriving by
       the other door. A late hour plate only fills its variable; the wish
       logic in `update` swaps it in through the ordinary out-of-sight dip. */
    if (platesBound) return;
    if (!clearSettled || !stormSettled) return;
    const any = clearPlate || stormPlate || sunrisePlate || nightPlate;
    if (!any) return;
    panoClear.value = clearPlate || sunrisePlate || stormPlate || any;
    panoStorm.value = stormPlate || clearPlate || any;
    panoStage = 1;
    platesBound = true;
  };
  const plateLoader = new THREE.TextureLoader();
  plateLoader.load(
    new URL('../assets/textures/sky/alps-clear.jpg', import.meta.url).href,
    (texture) => {
      clearPlate = preparePlate(texture);
      clearSettled = true;
      settlePlates();
    },
    undefined,
    () => { clearSettled = true; settlePlates(); },
  );
  plateLoader.load(
    new URL('../assets/textures/sky/alps-storm.jpg', import.meta.url).href,
    (texture) => {
      stormPlate = preparePlate(texture);
      stormSettled = true;
      settlePlates();
    },
    undefined,
    () => { stormSettled = true; settlePlates(); },
  );
  plateLoader.load(
    new URL('../assets/textures/sky/alps-sunrise.jpg', import.meta.url).href,
    (texture) => {
      sunrisePlate = preparePlate(texture);
      settlePlates();
    },
  );
  plateLoader.load(
    new URL('../assets/textures/sky/alps-aurora-night.jpg', import.meta.url).href,
    (texture) => {
      nightPlate = preparePlate(texture);
      settlePlates();
    },
  );

  // --- the counterglow -----------------------------------------------------
  // A full ring, because which part of it is drawn is decided per fragment
  // against the sun rather than by where the mesh is pointing. Twenty rows
  // over the narrow arc keep its spherical carrier smooth at native output;
  // the colour profile itself remains a fragment-shader smoothstep.
  const beltMat = new THREE.ShaderMaterial({
    uniforms: {
      uShade: { value: new THREE.Color('#3d4f80') },
      uRose: { value: new THREE.Color('#d59b9b') },
      uSun: { value: sunXZ },
      uStrength: { value: 0 },
      uFoot: { value: Math.sin(BELT.foot) },
      uHead: { value: Math.sin(BELT.head) },
    },
    vertexShader: BELT_VERT,
    fragmentShader: BELT_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const belt = new THREE.Mesh(new THREE.SphereGeometry(
    RADIUS * 0.99, 96, 20, 0, TAU,
    Math.PI / 2 - BELT.head, BELT.head - BELT.foot,
  ), beltMat);
  belt.renderOrder = -19.5;
  // One cheap uniform discard at zero is preferable to compiling this program
  // on the exact frame the first twilight band becomes perceptible.
  belt.visible = true;
  group.add(belt);

  // --- stars ---------------------------------------------------------------
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  /* The three colour temperatures a naked eye actually reports, and no more
     of them: most stars read blue-white to white, and a handful — Betelgeuse,
     Arcturus, Aldebaran — are unmistakably warm. Chosen per star below with
     the warm ones kept rare, because a sky salted evenly with amber reads as
     noise rather than as astronomy. */
  const STAR_TEMPS = [
    [0.76, 0.85, 1.00],
    [1.00, 0.97, 0.92],
    [1.00, 0.84, 0.64],
  ];
  const stars = (() => {
    const n = 420;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const twinkle = new Float32Array(n);
    const tint = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Upper hemisphere only, weighted away from the horizon where the
      // haze would have eaten them anyway
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const y = Math.abs(u) * 0.92 + 0.06;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      pos[i * 3] = Math.cos(a) * r * RADIUS * 0.97;
      pos[i * 3 + 1] = y * RADIUS * 0.97;
      pos[i * 3 + 2] = Math.sin(a) * r * RADIUS * 0.97;
      /* Magnitude follows a power law rather than a uniform draw, which is
         what a real sky does: each step down in brightness has several times
         the members of the one above it. A uniform field has no bright stars
         at all in the sense that matters — nothing to be brighter *than* —
         and it was the single thing making this read as speckle rather than
         as night. The magnitude sets the point size and most of the light
         together, so the handful at the top are unmistakably stars and the
         rest are the dust they stand in front of. */
      const mag = Math.pow(Math.random(), 2.4);
      size[i] = 1 + mag * 2.8;
      twinkle[i] = Math.random();
      const roll = Math.random();
      const temp = STAR_TEMPS[roll < 0.56 ? 0 : roll < 0.87 ? 1 : 2];
      const bright = 0.45 + 0.55 * mag;
      tint[i * 3] = temp[0] * bright;
      tint[i * 3 + 1] = temp[1] * bright;
      tint[i * 3 + 2] = temp[2] * bright;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    const p = new THREE.Points(g, starMat);
    p.renderOrder = -19;
    p.frustumCulled = false;
    return p;
  })();
  group.add(stars);

  // --- the aurora ----------------------------------------------------------

  /* A tiling field of smooth value noise, built once on a canvas exactly as
     the sun's glow is, with three independent fields in the three channels
     so the octaves above cannot land on each other and beat. The lattice is
     wrapped, which `noise2` is not — a straight sample of it would put a
     seam down the sky every time the texture repeated. Three fetches with
     bilinear filtering is a good deal less work than three hashed octaves in
     the fragment shader, and it does not need the precision they do.

     The mist reads the same texture at a completely different scale, which
     is free and is why this is not called the aurora's. Two effects sharing
     one field can only correlate if they sample it the same way, and one of
     them is measured in radians of sky while the other is measured in
     hundreds of metres of valley. */
  const fieldTex = (() => {
    const s = 128;
    const cells = 8;
    const step = s / cells;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    const img = g.createImageData(s, s);
    const at = (ix, iy, seed) => hash2(
      ((ix % cells) + cells) % cells, ((iy % cells) + cells) % cells, seed,
    );
    for (let y = 0; y < s; y++) {
      const fy = y / step;
      const iy = Math.floor(fy);
      const uy = smooth01(fy - iy);
      for (let x = 0; x < s; x++) {
        const fx = x / step;
        const ix = Math.floor(fx);
        const ux = smooth01(fx - ix);
        const o = (y * s + x) * 4;
        for (let c = 0; c < 3; c++) {
          const seed = 51 + c;
          const top = at(ix, iy, seed)
            + (at(ix + 1, iy, seed) - at(ix, iy, seed)) * ux;
          const bot = at(ix, iy + 1, seed)
            + (at(ix + 1, iy + 1, seed) - at(ix, iy + 1, seed)) * ux;
          img.data[o + c] = (top + (bot - top) * uy) * 255;
        }
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    // Deliberately not sRGB: these are numbers, not a colour
    return tex;
  })();

  const auroraMat = new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: fieldTex },
      uLow: { value: new THREE.Color('#4dffa6') },
      uHigh: { value: new THREE.Color('#a05cff') },
      uTime: { value: 0 },
      uStrength: { value: 0 },
      uFoot: { value: Math.sin(AURORA.foot) },
      uHead: { value: Math.sin(AURORA.head) },
    },
    vertexShader: AURORA_VERT,
    fragmentShader: AURORA_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    fog: false,
  });

  const aurora = (() => {
    // A band of the sphere rather than a cylinder: a cylinder tall enough to
    // reach sixty degrees of elevation puts its top corners five kilometres
    // out, which is past the far plane and gets clipped into a straight cut
    // across the sky.
    const phiLength = AURORA.arc;
    const phiStart = -(Math.PI / 2 + AURORA.azimuth) - phiLength / 2;
    const geo = new THREE.SphereGeometry(
      RADIUS * 0.985, 112, 28,
      phiStart, phiLength,
      Math.PI / 2 - AURORA.head, AURORA.head - AURORA.foot,
    );
    const mesh = new THREE.Mesh(geo, auroraMat);
    // Inside the dome, outside the stars, and under the sun's own glow. The
    // half is not an accident: the order between them was already full.
    mesh.renderOrder = -18.5;
    mesh.visible = true;
    return mesh;
  })();
  group.add(aurora);

  /* --- the mist ------------------------------------------------------------

     One disc, shared by all three sheets, and one block of uniforms shared
     with it — the same arrangement `shading.js` uses on the world's
     materials and for the same reason: everything about a sheet except its
     density and its two colours is a fact about the weather rather than
     about the sheet, so there is no sense in three copies of it.

     The disc is a fan and deliberately has no rings in it. Both varyings are
     linear functions of the vertex position, so interpolating them across
     one enormous triangle gives exactly the same answer as across forty small
     ones; the shading is all in the fragment shader and the geometry is only
     there to make it run. Forty segments is what it costs to have a circular
     rim rather than a polygon, and the rim is beyond the fog anyway. */
  const mistShared = {
    uNoise: { value: fieldTex },
    uSunDir: { value: sunDir },
    uOrigin: { value: new THREE.Vector2() },
    uCell: { value: new THREE.Vector2(MIST.field * MIST.aniso, MIST.field) },
    uRadius: { value: RENDER.fogFar * MIST.reach },
    uCut: { value: MIST.cut },
    uCap: { value: MIST.cap },
    uNear: { value: RENDER.fogNear },
    uFar: { value: RENDER.fogFar },
    uSun: { value: 0 },
  };

  // Two of those are written every frame and are worth a name of their own
  const mistOrigin = mistShared.uOrigin.value;
  const mistCell = mistShared.uCell.value;

  const mistGeo = new THREE.CircleGeometry(1, MIST.segments);
  mistGeo.rotateX(-Math.PI / 2);

  const sheets = [];
  for (let i = 0; i < MIST.live; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...mistShared,
        uDensity: { value: 0 },
        uCool: { value: new THREE.Color('#dfe8f4') },
        uWarm: { value: new THREE.Color('#ffe6c6') },
      },
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      transparent: true,
      depthWrite: false,
      // Seen from above as a floor and from below as a ceiling, and the run
      // spends its whole life crossing from one to the other
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(mistGeo, mat);
    /* Before the trail and the particles, so that snow falling between the
       rider and a bank is drawn in front of it rather than behind. Order
       among the sheets themselves is genuinely irrelevant — see the head of
       the file — which is the only reason three transparent planes stacked
       over each other need no sorting at all. */
    mesh.renderOrder = -2;
    // The disc is grown in the vertex shader, so its bounding sphere says
    // one metre and three's own culling would throw the whole sky away
    mesh.frustumCulled = false;
    mesh.visible = true;
    sheets.push({ mesh, mat });
    group.add(mesh);
  }

  // --- the light in the sky ------------------------------------------------
  const glowTex = (() => {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.66)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  }));
  glow.renderOrder = -18;
  group.add(glow);

  // See DISC_VERT/DISC_FRAG: the same billboard, drawn analytically, with a
  // gibbous bite the moon opens and the sun closes. Normal alpha blending as
  // before — the disc is a body with a sky behind it, not a light added to
  // one; the glow above is the additive half of the pair.
  const discMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: 0 },
      uMoon: { value: 0 },
    },
    vertexShader: DISC_VERT,
    fragmentShader: DISC_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const disc = new THREE.Sprite(discMat);
  disc.renderOrder = -17;
  group.add(disc);

  // --- the haze the hill dissolves into ------------------------------------
  // Built at the mean pitch and scaled to the measured one every frame, so
  // there is one cone and no geometry work in the loop. One hundred and
  // ninety-two segments make its rim effectively circular at native output;
  // this is the horizon, so even a small polygonal sag can reveal the mesh.
  const coneH = CONE_R * TERRAIN.grade.base;
  const hazeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false });
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(CONE_R, coneH, 192, 1, true), hazeMat,
  );
  // After the dome, for the same reason the dome now goes after the terrain:
  // most of the cone is behind real ground, and drawing it once the depth
  // buffer knows that costs only the fragments that are actually the horizon.
  // It still writes depth, exactly as it always did, and it still lands
  // before every transparent layer because all the opaques do.
  cone.renderOrder = 2;
  group.add(cone);

  // --- the ranges ----------------------------------------------------------
  const ranges = [];

  /* A real mid-distance massif, generated and uploaded before the first
     frame. Eighteen radial rows provide depth and self-occlusion; 768 angular
     columns keep the skyline below an eight-pixel sampling interval at native
     output. All geology masks are vertex facts and never rebuild; day, storm
     and pitch are uniform-only changes. */
  const relief = (() => {
    const cols = RELIEF.segments + 1;
    const rows = RELIEF.radialSegments + 1;
    const count = cols * rows;
    const positions = new Float32Array(count * 3);
    const altitude = new Float32Array(count);
    const radii = new Float32Array(count);
    const geology = new Float32Array(count * 3);
    const indices = new (count > 65535 ? Uint32Array : Uint16Array)(
      RELIEF.segments * RELIEF.radialSegments * 6,
    );
    const circleNoise = (angle, frequency, seed) => snoise2(
      Math.cos(angle) * frequency,
      Math.sin(angle) * frequency,
      seed,
    );

    let p = 0;
    let q = 0;
    for (let r = 0; r <= RELIEF.radialSegments; r++) {
      const t = r / RELIEF.radialSegments;
      const beforeCrest = t <= RELIEF.crestAt;
      const rt = beforeCrest
        ? t / RELIEF.crestAt
        : (t - RELIEF.crestAt) / (1 - RELIEF.crestAt);
      const radius = beforeCrest
        ? RELIEF.inner + (RELIEF.crest - RELIEF.inner) * rt
        : RELIEF.crest + (RELIEF.outer - RELIEF.crest) * rt;
      const rise = smooth01(clamp01(t / RELIEF.crestAt));
      const fall = smooth01(clamp01((1 - t) / (1 - RELIEF.crestAt)));
      const radialProfile = Math.pow(rise * fall, RELIEF.profilePower);

      for (let i = 0; i <= RELIEF.segments; i++) {
        // Reuse exactly zero for the duplicate seam column rather than rely on
        // sin(2pi) rounding to nearly zero; every generated attribute then
        // closes bit-for-bit and the normal average cannot expose a hairline.
        const angle = i === RELIEF.segments ? 0 : (i / RELIEF.segments) * TAU;
        const massif = 0.5 + 0.5 * circleNoise(angle, 1.25, RELIEF.seed);
        const horn = 1 - Math.abs(circleNoise(angle, 3.7, RELIEF.seed + 1));
        const knife = 1 - Math.abs(circleNoise(angle, 8.4, RELIEF.seed + 2));
        const skyline = 0.30 + 0.70 * clamp01(
          massif * 0.22 + Math.pow(horn, 2.65) * 0.53
            + Math.pow(knife, 1.90) * 0.25,
        );
        // Down-run remains the panorama's deep view; true shoulders frame it.
        const ahead = Math.max(0, -Math.sin(angle));
        const corridor = 1 - RELIEF.corridorCut
          * ramp(ahead, RELIEF.corridorFrom, RELIEF.corridorTo);

        /* Long gullies are coherent from the crest to the foot. Their small
           radial drift prevents each one being a ruler-straight spoke, while
           sampling on a circle guarantees the seam closes bit-for-bit. */
        const drainField = 0.5 + 0.5 * snoise2(
          Math.cos(angle) * 5.1 + t * 0.72,
          Math.sin(angle) * 5.1 - t * 0.53,
          RELIEF.seed + 5,
        );
        const drainage = ramp(drainField, 0.58, 0.84);
        const facet = 0.5 + 0.5 * snoise2(
          Math.cos(angle) * 7.3 + t * 1.35,
          Math.sin(angle) * 7.3 - t * 0.91,
          RELIEF.seed + 7,
        );
        const buttressField = 1 - Math.abs(snoise2(
          Math.cos(angle) * 9.6 + t * 2.25,
          Math.sin(angle) * 9.6 - t * 1.70,
          RELIEF.seed + 9,
        ));
        const buttress = Math.pow(buttressField, 1.7);
        const stone = 0.5 + 0.5 * circleNoise(angle, 1.8, RELIEF.seed + 11);
        const ridgeShift = circleNoise(angle, 3.2, RELIEF.seed + 13)
          * 54 * radialProfile;
        const y = RELIEF.height * skyline * corridor * radialProfile
          * (0.72 + facet * 0.14 + buttress * 0.25
            - drainage * (1 - t) * 0.10);

        positions[p] = Math.cos(angle) * (radius + ridgeShift);
        positions[p + 1] = y;
        positions[p + 2] = Math.sin(angle) * (radius + ridgeShift);
        altitude[q] = clamp01(y / RELIEF.height);
        radii[q] = radius + ridgeShift;
        geology[q * 3] = drainage;
        geology[q * 3 + 1] = stone;
        geology[q * 3 + 2] = buttress;
        p += 3;
        q += 1;
      }
    }

    let k = 0;
    for (let r = 0; r < RELIEF.radialSegments; r++) {
      for (let i = 0; i < RELIEF.segments; i++) {
        const a = r * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        if ((r + i) & 1) {
          indices[k++] = a; indices[k++] = b; indices[k++] = d;
          indices[k++] = a; indices[k++] = d; indices[k++] = c;
        } else {
          indices[k++] = a; indices[k++] = b; indices[k++] = c;
          indices[k++] = b; indices[k++] = d; indices[k++] = c;
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geo.setAttribute('aAltitude', new THREE.BufferAttribute(altitude, 1));
    geo.setAttribute('aGeology', new THREE.BufferAttribute(geology, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    /* The duplicate angular seam has identical positions but distinct index
       neighbourhoods. Weld its two computed normals explicitly so the sun can
       never draw a vertical lighting seam through the closed shell. */
    const normals = geo.attributes.normal.array;
    for (let r = 0; r <= RELIEF.radialSegments; r++) {
      const first = r * cols * 3;
      const last = (r * cols + RELIEF.segments) * 3;
      const nx = normals[first] + normals[last];
      const ny = normals[first + 1] + normals[last + 1];
      const nz = normals[first + 2] + normals[last + 2];
      const inv = 1 / Math.hypot(nx, ny, nz);
      normals[first] = normals[last] = nx * inv;
      normals[first + 1] = normals[last + 1] = ny * inv;
      normals[first + 2] = normals[last + 2] = nz * inv;
    }
    geo.computeBoundingSphere();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPitch: { value: TERRAIN.grade.base },
        uSunDir: { value: sunDir },
        uHaze: { value: new THREE.Color('#d7e2ec') },
        uSnow: { value: new THREE.Color('#dce7f1') },
        uRockCool: { value: new THREE.Color('#46546a') },
        uRockWarm: { value: new THREE.Color('#685d59') },
        uIce: { value: new THREE.Color('#b9d2df') },
        uAlpenglow: { value: new THREE.Color(0, 0, 0) },
        uStorm: { value: 0 },
        uAir: { value: airAt(RELIEF.apparentFar) },
      },
      vertexShader: RELIEF_VERT,
      fragmentShader: RELIEF_FRAG,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      fog: false,
      extensions: { derivatives: true },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'mid-distance massifs';
    // Far ribbons and the sun sit behind it; local mist remains in front.
    mesh.renderOrder = -2.5;
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, mat };
  })();

  /* One ring of silhouette. The profile is sampled on a circle through the
     noise field so that it closes on itself, and the circle is small — about
     sixteen major peaks around a whole ring, which is two or three of them
     across the frame. It used to be six times that, which is not a mountain
     range, it is a saw, and the octaves on top of it were finer than the
     sampling could carry: every other vertex was an independent random
     number. Everything here is now sampled at five points per feature or
     better, which is what it costs to have a skyline instead of a zigzag.

     The sum of three octaves almost never reaches its own extremes, so it is
     put through a gain and a soft knee before it becomes a height. Straight,
     it drew a skyline that rose and fell over six degrees — a plateau with
     bumps on it. Multiplied and hard-clamped instead, a tenth of the ring
     came back pinned at exactly the maximum, which is a plateau again and a
     literal flat one. This asymptotes: it never quite arrives at either end
     and so it never flattens at either end. */
  const NOISE_R = 2.5;
  /* Features around a whole ring, turned into the radius of the circle the
     field is sampled on. Written this way round because a count of summits
     is something that can be held up against a photograph and a noise
     frequency is not. */
  const RATE = 1 / (2 * Math.PI * NOISE_R);

  function range(spec) {
    const { radius, height, tint, seed, segments, far } = spec;
    const air = airAt(far);
    const wrap = (i) => ((i % segments) + segments) % segments;
    const angle = (i) => (wrap(i) / segments) * Math.PI * 2;
    const octave = (i, n, s) => {
      const a = angle(i);
      const r = NOISE_R * n * RATE;
      return snoise2(Math.cos(a) * r, Math.sin(a) * r, seed + s);
    };

    const raw = new Float32Array(segments);
    const prof = new Float32Array(segments);
    const ring = new Float32Array(segments);
    for (let i = 0; i < segments; i++) {
      /* Massifs first, and multiplied into the summits rather than added to
         them. Added, a horn standing in a col comes out as a peak with a
         slightly lower peak beside it and the range is a sawtooth with a
         wave through it. Multiplied, the col has nothing in it, which is
         what a col is. The quarter left underneath is the shoulder that
         carries the range across from one massif to the next; at zero the
         massifs are islands with sky between them. */
      const massif = HORIZON.floor + (1 - HORIZON.floor) * smooth01(clamp01(
        octave(i, HORIZON.massif, 0) * 1.25 + 0.5,
      ));
      /* And the summits. Ridged, because the fold of an absolute value has a
         crease at its crest where a sine has a curve, and a crease is the
         entire difference between a horn and a hump. Raised to a power,
         which narrows the ridge without touching that crease. And the knife
         octave multiplies rather than adds: two ridges summed are two
         blurred ridges, two multiplied are one sharp ridge with the other's
         edges cut into its flanks. */
      const horn = 1 - Math.abs(octave(i, HORIZON.horn, 1));
      const knife = 1 - Math.abs(octave(i, HORIZON.knife, 2));
      raw[i] = Math.pow(horn, HORIZON.sharp) * (0.70 + 0.30 * knife) * massif;
      // and the ring is not a circle, so four of them do not read as four
      // circles. Five per cent is nothing to the colour and everything to
      // whether the peaks look like they are at one distance.
      ring[i] = radius * (1 + octave(i, 7, 3) * 0.05);
    }

    /* Then a second pass, because it needs the whole of the first one.

       That product lives in nought-to-one but it does not *use* it: three
       factors multiplied together spend nearly all of their time near the
       bottom and reach the top only when all three agree at once, which on a
       ring of three hundred samples happens approximately never. Left as it
       came out, a band never touches its own ceiling and the seed decides how
       tall the range is.

       So it is stretched over its own second and ninety-nine-and-a-half-th
       percentiles. Two hundredths are given up at the bottom, where a col is
       a col whether it is flat or very flat, and half of one at the top,
       where a single freak summit would otherwise set the scale for the
       whole ring and press everything else down under it. That is the end of
       the gain constant this used to carry, which was a stand-in for exactly
       this measurement and could only ever have been right for one seed: too
       small and no summit reached the ceiling, too large and a tenth of the
       ring sat clamped against it drawing a literal flat line across the sky.
       Both of those shipped, in that order. */
    const sortedRaw = Float32Array.from(raw).sort();
    const at = (q) => sortedRaw[Math.floor(q * (segments - 1))];
    const lo = at(0.02);
    const span = Math.max(1e-4, at(0.995) - lo);
    /* And how much of its own height this band's skyline is allowed to swing
       through. It is bounded well short of all of it, twice over. Once
       because a real range does that — from a valley floor the skyline lives
       between its cols and its summits, which is the top third of the way up
       and not the whole way. And once because a far band cut with the near
       band's cols would show sky through them, and the entire reason there
       is a far band is that it is what the near band's cols are full of. */
    const relief = HORIZON.relief * (1 - HORIZON.flatten * air);
    for (let i = 0; i < segments; i++) {
      const shape = Math.pow(clamp01((raw[i] - lo) / span), HORIZON.fill);
      prof[i] = height * (1 - relief * (1 - shape));
    }

    /* And the snow line, which is a quantile of the skyline that has just
       been built rather than a fraction of the band's own ceiling.

       Asked for as a fraction of the ceiling it cannot work, and the reason
       is worth keeping: the ceiling is what the tallest summit on the entire
       ring reaches, the typical column stands at two thirds of it, and the
       four bands do not even agree about that because the air has taken a
       different amount of relief off each of them. A line at two thirds of
       the ceiling is therefore a line above nearly the whole range, and the
       snow comes out as a rim drawn round the skyline rather than a level cut
       across it. That shipped too.

       Asked for as *how much of the range stands above it* — which is also
       how the question gets asked of a photograph — one number means the same
       thing on all four bands, whatever relief each of them ended up with. */
    const skyline = Float32Array.from(prof).sort();
    const line = skyline[Math.floor((1 - HORIZON.above) * (segments - 1))] / height;

    // Which way each column's skyline falls, normalised into [-1, 1] so the
    // shader can use it as a facing without knowing anything about metres
    const arc = (2 * Math.PI * radius) / segments;
    const face = new Float32Array(segments);
    for (let i = 0; i < segments; i++) {
      const s = (prof[wrap(i + 1)] - prof[wrap(i - 1)]) / (2 * arc);
      face[i] = -s / Math.sqrt(1 + s * s);
    }

    const pos = new Float32Array(segments * 6 * 3);
    const mix = new Float32Array(segments * 6);
    const facing = new Float32Array(segments * 6);
    const ang = new Float32Array(segments * 6);
    const top = new Float32Array(segments * 6);
    const along = new Float32Array(segments * 6);
    let p = 0;
    let m = 0;
    // Built with its foot on y = 0 and stood on the curtain by `update`,
    // which is the only part of this that moves
    const put = (i, y, k) => {
      const a = angle(i);
      const j = wrap(i);
      pos[p] = Math.cos(a) * ring[j];
      pos[p + 1] = y;
      pos[p + 2] = Math.sin(a) * ring[j];
      mix[m] = k;
      facing[m] = face[j];
      ang[m] = a;
      top[m] = prof[j] / height;
      /* The second axis of the band, and the one that was never used. It is
         the raw index rather than the wrapped one, so the last column runs
         to `tiles` instead of back to zero; `tiles` is an integer and the
         field repeats at one, so those are the same coordinate and the ring
         closes without a seam. Wrapping it here instead would draw the whole
         field backwards across the final quad. */
      along[m] = (i / segments) * HORIZON.tiles;
      p += 3;
      m += 1;
    };

    for (let i = 0; i < segments; i++) {
      const h0 = prof[i];
      const h1 = prof[wrap(i + 1)];
      // Every range melts into the curtain at its foot, so nothing ever
      // stands *in front of* the horizon. Snow sits on the tops, so the
      // mix is by height rather than by ring.
      const m0 = Math.min(1, h0 / height);
      const m1 = Math.min(1, h1 / height);
      put(i, 0, 0); put(i + 1, h1, m1); put(i + 1, 0, 0);
      put(i, 0, 0); put(i, h0, m0); put(i + 1, h1, m1);
    }

    /* Each band gets its own sun vector rather than sharing one, because
       each band is spun by its own amount and the shader wants the sun in
       the frame the vertices are actually in. Rotating one vec2 on the CPU
       per band per frame is a great deal cheaper than rotating every vertex's
       skyline normal on the GPU, which is the other way round to do it. */
    const sunLocal = new THREE.Vector2(0, -1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 1));
    geo.setAttribute('aFace', new THREE.BufferAttribute(facing, 1));
    geo.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
    geo.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    geo.setAttribute('aU', new THREE.BufferAttribute(along, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        // The same field the aurora and the mist read, at a third scale
        // again. Three effects can only correlate if they sample it the
        // same way, and one of these is measured in degrees of horizon.
        uNoise: { value: fieldTex },
        uHaze: { value: new THREE.Color('#e3ecf6') },
        uPeak: { value: new THREE.Color(tint) },
        uSnow: { value: new THREE.Color(tint) },
        uRock: { value: new THREE.Color(tint) },
        uIce: { value: new THREE.Color(tint) },
        uSunlit: { value: new THREE.Color(0, 0, 0) },
        uSun: { value: sunLocal },
        uLight: { value: 0.2 },
        uRise: { value: 1 },
        uLine: { value: line },
        uWobble: { value: HORIZON.wobble },
        uGlacier: { value: HORIZON.glacier },
        uDetail: { value: 0 },
        uAlpha: { value: 1 },
      },
      vertexShader: RANGE_VERT,
      fragmentShader: RANGE_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Explicit far-to-near ordering keeps the panorama crossfade stable even
    // though the rings all share the camera's origin.
    mesh.renderOrder = -15.4 + ranges.length * 0.1;
    mesh.frustumCulled = false;
    ranges.push({
      mesh, mat, sunLocal, radius,
      layer: ranges.length,
      tint: new THREE.Color(tint),
      // Metres of band per metre of camera — the whole of the parallax, and
      // a ratio rather than a taste
      parallax: radius / far,
      // Radians of spin per metre the run descends. Same thing, expressed at
      // this band's own radius, which is where the debt has to be paid.
      spin: 1 / far,
      air,
      /* And how much of its own snow line, rock and ice the air has left it,
         which is the same exponential a third time over. A floor under it
         rather than nothing, because a far band with literally no structure
         is a paper cut-out and the eye finds those instantly; a tenth is
         enough to say there is something up there without saying what. */
      detail: HORIZON.detail
        + (1 - HORIZON.detail) * Math.pow(1 - air, HORIZON.bias),
    });
    return mesh;
  }

  /* The two far ribbons remain as a no-asset/night fallback behind the relief
     shell. Their former near pair is deliberately omitted: actual radial
     geometry now owns that distance, and transparent skirts over it would
     flatten the facets while still costing two submissions. */
  for (const spec of RANGES.slice(0, 2)) group.add(range(spec));

  /* --- light ---------------------------------------------------------------

     Two lamps and, now, a shadow.

     Snow is the hardest subject in graphics because it is one colour filling
     the whole frame, and until this the only thing giving it shape was the
     angle of each facet. That is enough to read a slope and nothing else: a
     hillside of trees stood on the picture rather than in it, the rider was
     attached to the ground by a painted blob, and nothing anywhere told you
     that one part of the mountain was in the sun and another was not. A
     mountain with no shadows reads flat however good the lighting is,
     because half of what the eye uses to build depth outdoors is the shape
     other things throw across it.

     It is a single tight cascade rather than a proper cascaded set, and that
     is a deliberate trade. The interesting shadows are all local — the trees
     you are about to ride through, the kicker's lip, the rider's own — and
     they want resolution far more than they want range. `SHADOW_REACH`
     metres square at `SHADOW_MAP` texels is about eight centimetres a texel,
     which resolves a branch; the same map stretched over the whole draw
     distance would be two metres a texel and would not resolve a tree. Past
     the box three's own frustum test returns unshadowed, and the distance
     fog has taken over long before anyone can notice where that happened.

     The lamp is also brought in close. A directional light's *direction* is
     all that matters for shading, so the distance is free to be chosen for
     the shadow instead — and a near light means a shallow depth range for
     the orthographic camera, which is most of what shadow-map precision is. */
  const lights = new THREE.Group();
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  key.shadow.camera.left = -SHADOW_REACH;
  key.shadow.camera.right = SHADOW_REACH;
  key.shadow.camera.top = SHADOW_REACH;
  key.shadow.camera.bottom = -SHADOW_REACH;
  key.shadow.camera.near = SHADOW_DIST - SHADOW_DEPTH;
  key.shadow.camera.far = SHADOW_DIST + SHADOW_DEPTH;
  /* Bias, and the correction of a long-standing misunderstanding about it.

     This block used to say that `normalBias` was "the one that does the work
     here", that it was killing acne on the snow, and that 2.2 was the largest
     value the shadows would tolerate before detaching from their casters.
     Every clause of that was wrong, and they were wrong together for one
     reason: **normalBias does nothing at all to the mountain.**

     It is a receiver-side offset. Three pushes the shadow lookup along the
     *interpolated vertex normal*, and it compiles that push out entirely for
     any geometry with no built-in `normal` attribute — `HAS_NORMAL` in the
     shadow map chunk. The terrain has no such attribute and never has: its
     smooth lighting direction is a custom `aSmoothNormal` used only by the
     colour shader, so the depth/shadow shader still sees no receiver normal.
     For the surface this paragraph was written about, `normalBias` is
     therefore still multiplied by a zero vector.

     Verified rather than reasoned: toggling it between 2.2 and 0 on a frozen
     frame moves thirteen thousand pixels, and every one of them is on a tree.
     Not one is on the snow — not even across a terminator running over half
     the screen. Add a normal attribute to the terrain and the snow starts
     responding immediately, which is the same fact from the other side.

     Which leaves the question of what 2.2 metres *was* doing, and the answer
     is: quietly ruining the shadows of everything that does carry a normal.
     The rider is 1.75 m tall. A metre of offset along the normal is enough to
     push a limb's shadow lookup clean off the limb; two and a quarter is more
     than the whole body. That is why the rider had no self-shadow, why an arm
     never darkened the torso it was crossing, and why a tree's shadow sat
     visibly adrift of its trunk on flat ground.

     A quarter of a metre is about a board's width and roughly three texels of
     the map at nine centimetres each. The acne the old comment credits this
     line with preventing does not appear at zero either — I could not produce
     it on the snow at any sun angle — because the snow was never in this
     path; what actually holds the mountain together is the constant `bias`
     below, which is in the light camera's own depth units and does apply to
     everything. It is unchanged.

     …AND IT IS NOW WRITTEN AS A COUNT OF TEXELS, so the truce it represents
     travels with the resolution instead of being a metre figure that silently
     becomes the wrong one. See `SHADOW_BIAS_TEXELS`: at the dense map this is
     ten centimetres rather than twenty-five, which is the difference between
     a board that is standing on the snow and a board that is hovering a hand's
     width over its own shadow. A quarter of a metre was chosen when a texel
     was nine centimetres, and a snowboard was three texels wide — so the one
     shadow a player looks at continuously was the one the map could not
     resolve and the offset then pushed off the board entirely. */
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = SHADOW_BIAS_TEXELS * SHADOW_TEXEL;
  /* The sun is half a degree wide, so nothing it casts has a hard edge. This
     is the cheap stand-in for that: it widens the PCF tap pattern, which
     softens every shadow by a constant amount rather than by distance from
     the caster — not the real penumbra, but far closer to it than a hard
     edge, and it costs nothing. Kept modest, because at nine centimetres a
     texel a large radius starts eating the shadows of thin things like
     branches and slalom poles entirely. Counted in texels for the same reason
     as the bias, so the denser map buys a tighter penumbra rather than the
     same blur drawn at higher cost. */
  key.shadow.radius = SHADOW_RADIUS_TEXELS;
  lights.add(key, key.target);
  const hemi = new THREE.HemisphereLight('#74a3de', '#dfe8f4', 1.35);
  lights.add(hemi);

  const peakTmp = new THREE.Color();
  const footTmp = new THREE.Color();
  const snowTmp = new THREE.Color();
  const rockTmp = new THREE.Color();
  const iceTmp = new THREE.Color();
  const rangeTintTmp = new THREE.Color();
  const fill = new THREE.Color();
  const sunlit = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff);
  /* One frame-local atmosphere palette, shared by every procedural layer.
     Lightning used to whiten only the dome's bottom two stops and the haze
     cone, leaving the ranges and hemisphere fill in their pre-strike colours.
     The resulting seam looked like a background swap. These copies are the
     sole flashed colours; weather remains immutable and every procedural
     consumer sees the same continuous pulse. The actual celestial sprites
     and directional lamp stay unmodified because lightning is ambient
     illumination, not a second sun. */
  const atmosphere = {
    zenith: new THREE.Color(),
    mid: new THREE.Color(),
    horizon: new THREE.Color(),
    haze: new THREE.Color(),
    glow: new THREE.Color(),
    key: new THREE.Color(),
  };
  /* Where the mist's field is being read from, and it is the one quantity in
     this file that genuinely is integrated over time — a bank drifts on the
     wind, and the wind changes, so there is nothing to evaluate it from. It
     is kept honest by being wrapped into its own first tile every frame:
     the field repeats at one, so taking whole tiles off it is not an
     approximation, and what is left can never grow large enough to lose
     precision in however long the run goes on. */
  const mistDrift = new THREE.Vector2();
  // The light's own basis, rebuilt each frame because the sun moves all day,
  // and the snapped point the shadow box is centred on
  const UP = new THREE.Vector3(0, 1, 0);
  const shadowRight = new THREE.Vector3();
  const shadowUp = new THREE.Vector3();
  const shadowAt = new THREE.Vector3();
  let time = 0;
  let pitch = -1;
  /* The aurora and mist are too large to submit forever at zero, even with an
     early uniform discard. Keep them live through the first real render so
     their programs are compiled while the opening frame is already expected
     to warm up, then restore their ordinary density gates. The zero-length
     setup tick in main does not spend this frame. */
  let warmSkyLayers = true;

  /* Where the sun is on screen, for the crepuscular pass.
     `x` and `y` are in the same 0..1 space as a full-screen quad's own uv —
     origin bottom left — so the marching pass can walk straight from `vUv`
     towards this with no conversion in between. They are allowed outside
     0..1: a sun just off the left edge still throws rays across the frame,
     and clamping it to the border would nail those rays to the border with
     it. `visible` is everything the pass needs to know about whether there
     is any point marching at all. */
  const sun = { x: 0.5, y: 1.2, visible: 0, tint: new THREE.Color('#ffeccc') };
  const sunAt = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  // The half of `sun.visible` that the weather decides, kept from `update`
  // until a camera turns up to decide the other half
  let sunLight = 0;
  let shadowLevel = null;

  /* The pitch the curtain has to hang at, off the hill itself.

     Both probes are taken on a branch of the piste rather than at the
     rider's own x — a probe nine hundred metres down a run that has wandered
     thirty metres sideways lands on the containment wall, which is a hundred
     and thirty metres of hill that is not there, and reads as a mountain
     that has flattened out. */
  function measure(pos) {
    const h0 = heightAt(nearestCenter(pos.x, pos.z), pos.z);
    let want = PITCH_MIN;
    for (let i = 0; i < PROBES.length; i++) {
      const d = PROBES[i];
      const z = pos.z - d;
      const drop = h0 - heightAt(nearestCenter(pos.x, z), z);
      // A comparison rather than a max, so that a probe which lands on
      // ground the hill has no answer for loses the argument instead of
      // winning it and taking the horizon with it
      const p = (drop - APEX) / d;
      if (p > want) want = p;
    }
    return want < PITCH_MAX ? want : PITCH_MAX;
  }

  /* The whole sky follows the rider, unrotated, and everything in it is
     re-coloured from the weather. Twenty-odd uniform writes and three
     questions put to the mountain, a frame. */
  function update(pos, w, dt) {
    const warmingLayers = warmSkyLayers;
    time += dt;
    group.position.set(pos.x, pos.y, pos.z);
    lights.position.set(pos.x, pos.y, pos.z);

    sunDir.set(
      Math.sin(w.azimuth) * Math.cos(w.elevation),
      Math.sin(w.elevation),
      -Math.cos(w.azimuth) * Math.cos(w.elevation),
    ).normalize();
    sunXZ.set(sunDir.x, sunDir.z).normalize();

    const flash = w.flash;
    const flashMix = clamp01(flash) * 0.8;
    atmosphere.zenith.copy(w.zenith).lerp(WHITE, flashMix);
    atmosphere.mid.copy(w.mid).lerp(WHITE, flashMix);
    atmosphere.horizon.copy(w.horizon).lerp(WHITE, flashMix);
    atmosphere.haze.copy(w.haze).lerp(WHITE, flashMix);
    atmosphere.glow.copy(w.glow).lerp(WHITE, flashMix);
    atmosphere.key.copy(w.key).lerp(WHITE, flashMix);

    domeMat.uniforms.uZenith.value.copy(atmosphere.zenith);
    domeMat.uniforms.uMid.value.copy(atmosphere.mid);
    domeMat.uniforms.uHorizon.value.copy(atmosphere.horizon);
    domeMat.uniforms.uHaze.value.copy(atmosphere.haze);
    domeMat.uniforms.uGlow.value.copy(atmosphere.glow);
    domeMat.uniforms.uGlowStrength.value = 1 - w.storm * 0.8;
    domeMat.uniforms.uCloud.value = w.cloud;
    domeMat.uniforms.uCloudDrift.value.set(w.cloudX, w.cloudZ);
    /* Lightning. The weather owns the trigger — see the note there, it is a
       hash of its own clock, so a seed replays its storms strikes and all —
       and this end only says what a strike looks like: the whole atmosphere
       pulled towards white for a tenth of a second. `atmosphere` above is a
       copy rather than the weather's own palette, so downstream simulation
       never sees a flash it did not ask for. The fill light gets its energy
       share further down, which is what actually lights the near snow. */
    /* The first frame after both requests settle binds the new samplers while
       their contribution is still exactly zero. That lets the renderer upload
       both decoded plates invisibly; the following frame begins the existing
       exponential reveal. */
    if (panoStage === 1) {
      panoStage = 2;
    } else if (panoStage === 2) {
      panoStage = 0;
      panoTarget = 1;
    }
    /* Which plate the hour wants: the aurora night under real darkness, the
       alpenglow plate through dawn and dusk, the clear morning otherwise.
       The swap itself is never shown — when the wish changes, the reveal
       ramp is sent back to zero, the sampler is exchanged only once the
       plate's contribution has actually reached nothing, and the same ramp
       then brings the new picture up through the procedural sky. */
    if (panoStage === 0 && panoTarget > 0) {
      /* With hysteresis on both gates: the margin to *enter* a plate sits
         short of the margin to leave it, so an hour hovering exactly at a
         boundary — a pinned dusk, a night whose depth is still building —
         cannot strobe the three-second dip-and-return swap back and forth. */
      const sunPad = plateChoice === 'sunrise' ? 0.02 : 0;
      const nightAt = plateChoice === 'night' ? 0.34 : 0.46;
      const dawnDusk = (w.tod >= 0.05 - sunPad && w.tod <= 0.25 + sunPad)
        || (w.tod >= 0.65 - sunPad && w.tod <= 0.78 + sunPad);
      const choice = (w.night > nightAt && nightPlate) ? 'night'
        : (dawnDusk && sunrisePlate) ? 'sunrise' : 'clear';
      const want = choice === 'night' ? nightPlate
        : choice === 'sunrise' ? sunrisePlate
          : clearPlate || panoClear.value;
      if (want && panoClear.value !== want) {
        if (panoReady < 0.02) {
          panoClear.value = want;
          plateChoice = choice;
          panoWish = 1;
        } else panoWish = 0;
      } else {
        plateChoice = choice;
        panoWish = 1;
      }
    }
    panoReady += (panoTarget * panoWish - panoReady) * (1 - Math.exp(-2.8 * dt));
    domeMat.uniforms.uPanoStormMix.value = ramp(w.storm, 0.12, 0.78);
    // Night keeps a faint mountain plate under the stars; a whiteout gives it
    // up entirely because the fog curtain has already won by then.
    panoStrength.value = panoReady * PANO_MAX * (1 - 0.82 * w.night)
      * (1 - ramp(w.storm, 0.58, 0.88));

    // Four hundred and twenty zero-alpha points are cheap enough to remain in
    // the render list. That buys a compiled night-sky program before dusk;
    // their fragment shader discards them while the sky is bright.
    const starAlpha = w.star * (1 - w.storm) * 0.9;
    starMat.uniforms.uAlpha.value = starAlpha;
    starMat.uniforms.uTime.value = time;
    // A star is a fixed number of pixels, so it has to be told how many
    // pixels there now are. On a 2× panel the old constant drew a quarter
    // of the star it drew on the buffer it was chosen for.
    starMat.uniforms.uScale.value = Math.max(1, Math.min(3, RENDER.buffer.height / 800));

    // On three nights in four this is zero. It gets one zero-cost warm-up draw,
    // then returns to standing down so its large carrier spends no daytime fill.
    auroraMat.uniforms.uTime.value = time;
    auroraMat.uniforms.uStrength.value = w.aurora * AURORA.gain;
    aurora.visible = warmingLayers || w.aurora > 0.004;

    /* The counterglow, which is a couple of minutes out of the fifteen.

       The window is on the elevation alone: the band comes up as the sun
       drops under the horizon and is gone by the time it is six degrees over
       it. That excludes the night for nothing, because the elevation the
       weather carries after dark is the moon's and the moon spends the night
       a long way up — the small term on `moon` is only there for the minute
       in which it climbs through the same window on its way there. */
    const belted = ramp(w.elevation, -0.13, -0.02)
      * (1 - ramp(w.elevation, -0.01, 0.10))
      * (1 - w.storm) * (1 - 0.7 * w.moon) * BELT.gain;
    beltMat.uniforms.uStrength.value = belted;
    /* Both colours are taken off the weather rather than fixed, so the
       band is a dawn colour at dawn and a dusk one at dusk without knowing
       which it is. The shadow is the sky's own two blues met most of the
       way towards the zenith — it has to be darker than the horizon it
       stands on or it is not a shadow — and the rose is the sun's glow
       with most of the fire taken back out of it, because what is being
       seen is that light after crossing the entire width of the sky. */
    beltMat.uniforms.uShade.value.copy(atmosphere.mid).lerp(atmosphere.zenith, 0.45);
    beltMat.uniforms.uRose.value.copy(atmosphere.glow).lerp(atmosphere.mid, 0.42);

    /* Sun by day, moon by night: the same disc, smaller and cooler, and a
       glow that a storm can smother entirely.

       Both of them now set. They never used to, because no moment in the day
       table put the light under the horizon and the disc simply sat on the
       skyline all night; the two twilight moments do put it under, so there
       has to be something for it to go down behind. A fade rather than the
       old visibility test, because a disc that switches off is a disc
       somebody notices switching off. */
    const moon = w.moon;
    const risen = ramp(w.elevation, -0.028, 0.018);
    disc.position.copy(sunDir).multiplyScalar(RADIUS * 0.85);
    disc.scale.setScalar(RADIUS * (0.085 - moon * 0.032));
    discMat.uniforms.uColor.value.copy(w.key);
    discMat.uniforms.uMoon.value = moon;
    const discFade = (1 - w.storm) * (0.55 + 0.45 * (1 - moon)) * risen;
    discMat.uniforms.uOpacity.value = discFade;
    // The two-sprite light is cheap enough to stay submitted at zero opacity.
    // There is therefore no visibility threshold on the brightest object in
    // the sky and no deferred program when it next rises.

    // Small and faint. An additive sprite this far out covers a lot of sky
    // for very little scale, and a sun that blows out the middle of the
    // frame takes the mountain with it.
    glow.position.copy(sunDir).multiplyScalar(RADIUS * 0.84);
    glow.scale.setScalar(RADIUS * (0.20 - moon * 0.10));
    glow.material.color.copy(w.glow);
    glow.material.opacity = (1 - w.storm) * (0.5 - moon * 0.28) * risen;

    /* How much light is arriving from up there, as one number.

       It gates two things that never meet: the amber on the ridges below,
       and the crepuscular pass downstream. They are the same question asked
       twice, so they are answered once. The three terms are the same three
       the disc and the glow are already using, because a shaft of light out
       of a sun that is not drawn is a shaft of light out of nowhere — it has
       to be above the horizon, the air has to be clear enough to carry it,
       and the moon gets a quarter of a share. Moonlight genuinely does throw
       shafts; a moon that throws them as hard as the sun turns every clear
       night into a stage. */
    sunLight = ramp(w.elevation, -0.02, 0.10)
      * (1 - ramp(w.storm, 0.10, 0.78))
      * (1 - 0.74 * moon);
    sun.tint.copy(w.glow);

    /* And the colour that lands on a ridge facing it.

       It is a *low* sun that does this. At noon the light comes down onto
       the tops rather than across them and there is no glow on a horizon at
       all, so the whole thing is faded out as the sun climbs. The colour is
       borrowed from the key rather than being a constant of its own, which
       is what keeps it a hard amber at dusk, a pale gold at dawn, and
       nothing whatsoever in the middle of the day. */
    const low = 1 - ramp(w.elevation, 0.10, 0.44);
    sunlit.copy(w.key).multiplyScalar(1.6 * low * sunLight);
    // The panorama takes the same amber the ranges do — see DOME_FRAG. The
    // azimuth half of the pair is `sunXZ`, already shared by reference.
    domeMat.uniforms.uSunlit.value.copy(sunlit);

    // The curtain, and the ranges standing on it. Eased rather than taken
    // straight: the probes are asking a hill with twenty metres of noise on
    // it, and an un-eased horizon would breathe with the moguls.
    const want = measure(pos);
    pitch = pitch < 0 ? want : pitch + (want - pitch) * Math.min(1, dt * PITCH_EASE);
    cone.scale.y = pitch / TERRAIN.grade.base;
    cone.position.y = -APEX - (coneH * cone.scale.y) / 2;

    /* The parallax, in two numbers that are both pure functions of where the
       rider is standing.

       Nothing is accumulated and nothing is integrated, which is the whole
       of how this survives an endless run: reset the game and the horizon is
       exactly where it was on the first frame, ride for an hour and the only
       quantity that has grown is `-pos.z`, which is a double and is taken
       modulo a turn before anything downstream ever sees it. An offset that
       was added up frame by frame would have drifted, would have depended on
       the frame rate, and would eventually have been a float32 the size of
       the mountain.

       `travel` is how far down the hill the run has come, `lateral` is how
       far the piste has wandered off the fall line, and the two are spent
       differently — see the head of the file. The lateral half is a genuine
       translation and is small, a few metres against a ring of two
       kilometres; it is worth having anyway, because it is the one part of
       this that moves *with the carve*, and a horizon that answers the
       controls is worth more than its size on screen suggests. */
    const travel = -pos.z;
    const lateral = Math.max(-LATERAL_MAX, Math.min(LATERAL_MAX, pos.x));

    /* The mist: three sheets of it, and where they are is a rounded division.

       Everything shared goes in first, and most of it is the fog's, because
       a layer of cloud and a curtain of haze are the same air seen two ways
       and have no business disagreeing about how far it reaches. The drift
       is the wind, geared right down — cloud does not travel at the speed of
       the gust that is blowing snow off the moguls — and wrapped into its
       own first tile so that an hour of riding leaves it exactly as precise
       as it was on the first frame. */
    mistDrift.x = (mistDrift.x - w.windX * MIST.drift * mistCell.x * dt) % 1;
    mistDrift.y = (mistDrift.y - w.windZ * MIST.drift * mistCell.y * dt) % 1;
    mistOrigin.set(
      frac(pos.x * mistCell.x + mistDrift.x),
      frac(pos.z * mistCell.y + mistDrift.y),
    );
    mistShared.uRadius.value = w.fogFar * MIST.reach;
    mistShared.uNear.value = w.fogNear;
    mistShared.uFar.value = w.fogFar;
    mistShared.uSun.value = 0.6 * sunLight;

    const nearest = Math.round(pos.y / MIST.spacing);
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i];
      const level = nearest + i - ((MIST.live - 1) >> 1);
      const y = level * MIST.spacing;
      /* Each level has a density of its own, out of a field indexed by the
         level number rather than by its altitude — so the answer is the same
         every time the question is asked, and adjacent levels are correlated
         into banks two and three deep rather than alternating.

         The floor under it is not tidiness. Cut hard, two levels in five
         carry anything at all and — measured over six hundred of them —
         very nearly a quarter of the mountain has all three of its live
         levels empty at once, which is a weather report saying MIST over a
         sky with nothing whatsoever in it. A fifth of the density on every
         level keeps the air layered everywhere and lets the field decide
         which of those layers is a bank, which is both the honest picture
         and the one that never contradicts the HUD. */
      const bank = 0.18 + 0.82 * ramp(noise2(level * 0.37, 5.5, 173), 0.38, 0.74);
      // …and fades out with altitude, which is what buys the lattice its
      // silent hand-over: nothing can enter or leave the live set nearer
      // than a level and a half away, and by then this is already zero
      const held = 1 - ramp(Math.abs(y - pos.y), MIST.fade[0], MIST.fade[1]);
      const density = MIST.depth * w.mist * bank * held;
      s.mat.uniforms.uDensity.value = density;
      s.mesh.visible = warmingLayers || density > 0.004;
      if (!s.mesh.visible) continue;
      s.mesh.position.y = y - pos.y;
      /* A cloud top in a low sun is the warmest thing on the mountain and
         the underside of the same cloud is the coldest thing in the frame.
         The one number between them is which side of the sheet the rider is
         on, smoothed over the few seconds it takes to cross — and it is
         worth as much as the shape is, because a ceiling that is darker than
         the floor under it is the only cue that says the air has a top. */
      const above = smooth01(clamp01((pos.y - y) / 34 + 0.5));
      s.mat.uniforms.uWarm.value.copy(atmosphere.haze)
        .lerp(atmosphere.key, 0.08 + 0.28 * above);
      s.mat.uniforms.uCool.value.copy(atmosphere.haze)
        .lerp(atmosphere.mid, 0.26 - 0.14 * above);
    }

    // The cone is the fog curtain's opaque floor and therefore consumes the
    // exact haze stop already used by the dome, mist and distant ranges.
    hazeMat.color.copy(atmosphere.haze);

    /* The relief shell is always resident. Its apparent
       travel is a pure function of world position, while pitch and every
       material regime move through uniforms; there is no rebuild, threshold
       or async state to reveal during play. */
    const reliefSpin = (travel / RELIEF.apparentFar) % TAU;
    relief.mesh.rotation.y = reliefSpin;
    relief.mesh.position.set(
      -lateral * (RELIEF.crest / RELIEF.apparentFar), 0, 0,
    );
    relief.mat.uniforms.uPitch.value = pitch;
    relief.mat.uniforms.uHaze.value.copy(atmosphere.haze);
    snowTmp.copy(atmosphere.horizon).lerp(atmosphere.key, 0.10);
    relief.mat.uniforms.uSnow.value.copy(snowTmp);
    rockTmp.copy(atmosphere.mid).lerp(atmosphere.zenith, 0.46)
      .multiplyScalar(0.56);
    relief.mat.uniforms.uRockCool.value.copy(rockTmp);
    rockTmp.copy(atmosphere.mid).lerp(atmosphere.key, 0.14)
      .multiplyScalar(0.52);
    relief.mat.uniforms.uRockWarm.value.copy(rockTmp);
    iceTmp.copy(atmosphere.horizon).lerp(atmosphere.mid, 0.18);
    relief.mat.uniforms.uIce.value.copy(iceTmp);
    relief.mat.uniforms.uAlpenglow.value.copy(sunlit).multiplyScalar(0.46);
    relief.mat.uniforms.uStorm.value = w.storm;

    for (const r of ranges) {
      /* The generated equirectangular plate is the hero distant range. As it
         becomes visible, the two far procedural fallback rings yield to it.
         The relief shell remains in front and supplies the parallax and
         material depth their former near pair only suggested. At night or in
         a whiteout both the plate and its fallback dissolve into the same
         haze; returning a crisp silhouette inside ninety-metre visibility
         made the old rings look like floating islands. */
      const panoMix = smooth01(clamp01(panoStrength.value / PANO_MAX));
      const rangeAlpha = (1 - panoMix) * (1 - ramp(w.storm, 0.28, 0.82));
      r.mat.uniforms.uAlpha.value = rangeAlpha;
      r.mesh.visible = rangeAlpha > 0.002;
      const spin = (travel * r.spin) % TAU;
      r.mesh.rotation.y = spin;
      r.mesh.position.set(-lateral * r.parallax, -r.radius * (pitch + FOOT), 0);

      /* The sun, brought into the band's own frame rather than the world's.
         Three's rotation about y sends a local (x, z) to
         (x·cos + z·sin, −x·sin + z·cos), so the inverse — which is what
         turns a world direction into a local one — is the transpose. Getting
         this backwards is not subtle: the ridges catch the light on the wrong
         side and the whole range lights itself from the far horizon. */
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      r.sunLocal.set(cs * sunXZ.x - sn * sunXZ.y, sn * sunXZ.x + cs * sunXZ.y);

      /* Even the foot is not quite the curtain any more.

         It used to be exactly `w.haze` on all four bands, which is what
         guarantees a range melts into the horizon instead of standing in
         front of it — and which also means the bottom of the near band and
         the bottom of the far band are the identical colour, so the only
         thing separating them down there is that one is higher up the
         screen. A near range is behind less air than a far one, so it keeps
         a little of itself all the way down. It is a sixth at the front and
         almost nothing at the back, and the feet themselves are hidden
         behind the curtain regardless — what this actually colours is the
         first few degrees of band above it. */
      /* Apply the palette transform to the band's one local colour before it
         is mixed. Because lerps are affine, mixing flashed endpoints gives
         every derived surface exactly one — and only one — flash exposure. */
      rangeTintTmp.copy(r.tint).lerp(WHITE, flashMix);
      footTmp.copy(atmosphere.haze)
        .lerp(rangeTintTmp, (1 - r.air) * 0.17);
      r.mat.uniforms.uHaze.value.copy(footTmp);
      // The ranges are behind a lot of air, and a storm is more air. They
      // give up their colour long before the near hill does, and the far
      // band gives up more of it than the near one — which is the same
      // extinction figure that decides everything else about this band.
      peakTmp.copy(rangeTintTmp)
        .lerp(atmosphere.haze, w.storm * (0.62 + 0.33 * r.air));
      // and they take the sky's own tint, so a dusk range is a dusk colour
      peakTmp.lerp(atmosphere.mid, SKY_BLEED * r.air);
      r.mat.uniforms.uPeak.value.copy(peakTmp);

      /* Snow, rock and ice, and all three are derived from that one tint
         rather than being colours of their own — which is the only way three
         surfaces can go through nine times of day and a storm without ever
         once disagreeing about what light they are standing in.

         The snow is the band's tint opened up towards the palest stop the
         sky has. It has to be brighter than the tint and not equal to it —
         see the note in RANGE_FRAG, it is the whole reason any of this can
         be seen — and it goes towards the horizon stop rather than towards
         white because the palette has no white in it anywhere and the one
         rule about snow here is that it never becomes any. */
      snowTmp.copy(peakTmp).lerp(atmosphere.horizon, 0.26);
      r.mat.uniforms.uSnow.value.copy(snowTmp);
      /* Rock is the same tint with the light taken out of it and a push
         towards the top of the sky. Distant rock is not brown: at twenty
         kilometres the air in front of it has already made it a dark
         blue-grey, and the further band's rock is bluer than the near one's
         for exactly the reason its snow is. A fixed slate colour was tried
         first and looked like a hole cut in the horizon at dusk, when
         everything around it had gone amber and it had not. */
      rockTmp.copy(peakTmp).lerp(atmosphere.zenith, 0.20 + 0.22 * r.air)
        .multiplyScalar(0.40);
      r.mat.uniforms.uRock.value.copy(rockTmp);
      // And ice, which is the one thing on the horizon brighter than the snow
      // around it: the same journey the snow made, taken twice as far. An
      // Neither the highlight shoulder nor the atmospheric grade can bring
      // back a glacier that has clipped, so this is as far as it goes.
      iceTmp.copy(peakTmp).lerp(atmosphere.horizon, 0.52);
      r.mat.uniforms.uIce.value.copy(iceTmp);
      // How much of any of it survives the air in front of it, and a storm
      // takes the rest — a whiteout has no snow line in it because it has no
      // range in it
      r.mat.uniforms.uDetail.value = r.detail * (1 - w.storm);

      // How far up its own flanks the air has eaten this band. See the note
      // in RANGE_FRAG: one exponent, and it is the band's own extinction
      // rather than a number chosen to look right.
      r.mat.uniforms.uRise.value = 0.72 + r.air * 0.95;
      // Light enough to find the ridges, and gone in a storm along with
      // everything else that was making them legible. A band with more air in
      // front of it keeps less of its own form, for the same reason it keeps
      // less of its own colour.
      r.mat.uniforms.uLight.value = 0.24 * (1 - w.storm) * (1 - 0.38 * r.air);
      // Alpenglow, and it goes the other way: the far snow is the snow that
      // catches a low sun, so the band with the most air in front of it gets
      // the most of the one amber in the palette.
      r.mat.uniforms.uSunlit.value.copy(sunlit).multiplyScalar(0.8 + 0.4 * r.air);
    }

    /* The shadow box follows the rider, and it moves in whole texels.

       This is the one piece of shadow mapping that is not optional. A box
       that tracks a continuously-moving rider re-renders the depth map from a
       fractionally different place every frame, and every shadow edge in the
       picture crawls and sparkles against the pixel grid — the same sub-pixel
       instability that makes a distant skyline crawl, and far more visible
       because a shadow edge is a hard line.

       The fix is to decompose the rider's position in the light's own
       orthonormal basis, round the two axes that span the shadow map to whole
       texels, and leave the third — depth along the sun vector — alone. The
       box then advances in discrete steps of exactly one texel, so every
       texel lands on the same world position it did last frame and the edges
       are still. */
    const texel = SHADOW_TEXEL;
    shadowRight.crossVectors(UP, sunDir);
    if (shadowRight.lengthSq() < 1e-6) shadowRight.set(1, 0, 0);
    shadowRight.normalize();
    shadowUp.crossVectors(sunDir, shadowRight).normalize();
    shadowAt.copy(shadowRight)
      .multiplyScalar(Math.round(pos.dot(shadowRight) / texel) * texel)
      .addScaledVector(shadowUp, Math.round(pos.dot(shadowUp) / texel) * texel)
      .addScaledVector(sunDir, pos.dot(sunDir))
      .sub(pos);   // the lamp hangs off `lights`, which is already at the rider
    key.target.position.copy(shadowAt);
    key.position.copy(shadowAt).addScaledVector(sunDir, SHADOW_DIST);
    /* A sun on the horizon casts shadows the length of the mountain, which
       the box cannot hold and which read as black stripes across everything.
       So the shadow lets go as the sun goes down and as a storm closes in —
       which is also what the eye expects, because a moonlit slope has no
       hard shadows on it and neither does a whiteout.

       It used to let go by flipping `castShadow`, and that flip was two bugs
       wearing one line. Every lit material in three keys its program on
       whether shadows exist, so the flip recompiled the entire mountain's
       shaders in the middle of a run — a hitch long enough to eat a landing
       — and the shadows themselves arrived and left in a single frame,
       which on a slow dusk is a pop with nothing to blame for it. So the
       flag now never moves. The *strength* moves instead: `shadow.intensity`
       is a uniform, it fades the whole map's contribution smoothly through
       the same two thresholds the flip used to cross, and it costs no
       recompile because nothing about the program changes. And once it has
       faded all the way out, `shadow.autoUpdate` is dropped so the renderer
       skips the depth pass entirely — the night is not paying to render a
       map that is multiplied by zero. `needsUpdate` re-arms alongside it so
       the first shadowed frame after a long night is never a stale one. */
    /* …with one condition on dropping the pass, and it is the whole of a bug
       that could swallow the entire world on the frame the page opened.

       Skipping the depth pass does not merely skip the depth pass: it means
       the renderer never allocates the map. A run that opens in a blizzard —
       or at night, or in any weather where this level starts at zero — turned
       the pass off on its very first frame, before it had ever produced one,
       and `light.shadow.map` then stayed null for the entire run. Every
       material that samples it is compiled expecting a sampler that is never
       bound, so every one of those draws fails outright with an INVALID
       OPERATION and is dropped. The terrain, the forest, the huts and the
       rider all simply stopped being drawn; the sky dome does not receive
       shadows, so it carried on, and what was left was a white void with a
       painted skyline over it and no rider in it. Reported as "only white
       terrain, no trees and no player", and it fixed itself the moment the
       storm eased enough to turn the pass back on.

       So the pass is never given up before it has run once. One depth render
       at a cost of nothing — the casters are a handful of trees — and the map
       exists for the rest of the session, after which the level is free to
       take the pass away for as long as it likes. */
    const shadowTarget = ramp(w.elevation, 0.08, 0.14)
      * (1 - ramp(w.storm, 0.60, 0.78));
    if (shadowLevel === null) {
      // Resolve the opening frame beneath the cover; only later changes fade.
      shadowLevel = shadowTarget;
    } else {
      shadowLevel += (shadowTarget - shadowLevel)
        * (1 - Math.exp(-SHADOW_FADE_RATE * Math.max(0, dt)));
    }
    key.shadow.intensity = shadowLevel;
    const casting = shadowLevel > 0.001 || !key.shadow.map;
    if (casting !== key.shadow.autoUpdate) {
      key.shadow.autoUpdate = casting;
      key.shadow.needsUpdate = casting;
    }
    key.color.copy(w.key);
    key.intensity = w.keyI;
    // The fill takes the sky's hue but not its saturation. Snow bounce is
    // pale; lighting a whole mountain with undiluted #6f9ad6 turns every
    // surface the sun is not on into flat blue paper. Scale white mix by
    // daylight so night fill remains deep dark blue.
    const dayFill = 1 - (w.night || 0);
    fill.copy(atmosphere.mid).lerp(WHITE, 0.5 * dayFill);
    hemi.color.copy(fill);
    // On the night a display lands, the sky is the brightest lamp out and it
    // is green — so the fill takes a breath of the curtain's own colour and
    // the snow knows the sky is on fire. A sixth at full strength: enough to
    // read, and not enough to turn the mountain into a billiard table.
    if (w.aurora > 0.004) {
      hemi.color.lerp(auroraMat.uniforms.uLow.value, w.aurora * 0.15);
    }
    fill.copy(atmosphere.haze).lerp(WHITE, 0.35 * dayFill);
    hemi.groundColor.copy(fill);
    // And the strike, added rather than scaled: a flash lights the clouds
    // from inside, so it arrives through the fill and not through the key.
    hemi.intensity = w.hemiI + flash * 2.2;
    if (dt > 0) warmSkyLayers = false;
  }

  /* Where the sun lands in the frame, for the pass that marches towards it.

     Kept out of `update` deliberately. The chase camera settles *after* the
     sky has been coloured — it has to, because it asks the mountain questions
     of its own about where it is allowed to stand — so a projection done in
     `update` would be one frame stale. On a point that every ray in the
     picture is converging on, one frame of lag is the entire light source
     sliding across the screen once per frame, which is a shimmer nobody can
     look away from. Call this once the camera is where it is going to be,
     and before the frame is rendered.

     The camera's own inverse is rebuilt here rather than trusted: three only
     refreshes `matrixWorldInverse` inside `render`, so at this point in the
     frame it still describes where the camera was last time. The renderer
     overwrites it again a moment later, so borrowing it costs one invert and
     nothing at all downstream. */
  function project(camera) {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    camera.getWorldDirection(camFwd);
    const facing = camFwd.dot(sunDir);

    /* Behind the camera the perspective divide sends the answer through the
       origin and out the other side, so a sun over the rider's shoulder
       comes back as a point in front of them. The sign is put back by hand.
       `visible` is already zero there and the pass will not march; this only
       keeps the coordinate from being a lie, and the clamp keeps it from
       being an infinity at exactly ninety degrees off the axis. */
    sunAt.copy(sunDir).multiplyScalar(RADIUS * 0.85).add(group.position).project(camera);
    const flip = facing < 0 ? -1 : 1;
    sun.x = Math.max(-9, Math.min(9, sunAt.x * flip)) * 0.5 + 0.5;
    sun.y = Math.max(-9, Math.min(9, sunAt.y * flip)) * 0.5 + 0.5;

    /* Two gates the weather knows nothing about, and they overlap on purpose.

       The first is only a guard: at exactly ninety degrees off the axis the
       perspective divide is dividing by zero, so the projected point runs off
       to infinity right where the sign flips. A narrow ramp through it means
       the number is already worth nothing by the time it stops meaning
       anything.

       The second is the one that decides anything. Rays converge on a point,
       and the further outside the frame that point is the more nearly
       parallel they are — far enough out and it stops being a sunbeam and
       becomes a diagonal wipe. But it has to reach a long way past the edge
       before it starts taking anything, because a sun *just* out of shot,
       raking across a ridge, is the best this effect ever looks and cutting
       it at the border would be cutting exactly that. Half the width of the
       frame outside the frame is still worth marching. */
    const front = ramp(facing, 0, 0.12);
    const off = Math.max(Math.abs(sun.x - 0.5), Math.abs(sun.y - 0.5));
    sun.visible = sunLight * front * (1 - ramp(off, 0.8, 2.2));
    return sun;
  }

  /* How much shadow the light is worth this frame, published rather than
     kept private, because the mountain's own shadow of itself is no longer
     drawn into this lamp's depth map — it is precomputed in `terrain.js` —
     and the two have to fade out on the same dusk and in the same whiteout.
     One number, owned in one place, read by both. */
  return {
    group, lights, sunDir, sun, update, project,
    get shadowLevel() { return key.shadow.intensity; },
  };
}
