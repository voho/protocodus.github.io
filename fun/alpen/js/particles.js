/* Three particle systems, two shaders, and the weather all of them answer to.

   Falling snow, the spray off the edge, and the streaks that appear once the
   run is genuinely quick. The first two are points with a per-particle size
   and alpha, so one small ShaderMaterial covers both — soft-edged, fog
   applied by hand because a custom shader does not get three's for free.

   The spray is the one that matters. It is the only thing on screen whose
   quantity is a direct read of how hard the board is working: a clean carve
   throws a little, a slide throws a wall of it, and a landing throws all of
   it at once. Take it away and the same physics stops feeling like anything.

   Everything in here was rewritten when the resolution was, and for the same
   reason: it all used to be sized against a fixed 288-line framebuffer.

   The point size is the sharp edge of that. `RENDER.height` no longer exists,
   because there is no longer one height — the buffer is whatever the window
   and the resolution governor between them decide, and it changes on every
   resize and every time the governor moves. So the metres-to-pixels
   conversion is read at the moment it is used rather than captured at module
   load, which is the difference between a snowflake that is the right size
   everywhere and one that is right on exactly one monitor.

   ── THE BUBBLE, and why a particle now has two sizes ──────────────────────

   Reading the conversion at the right moment was not enough, because there
   was nothing on the other end of it. A point sprite is authored in metres
   and drawn in pixels, and metres over metres is unbounded: anything thrown
   off the board that then drifts back towards the lens grows without limit.
   The clamp that was supposed to stop that sat at ninety-six pixels — a
   seventh of the height of a 720-line frame — so what a rider actually saw
   at close range was a handful of large, soft, evenly-lit white discs with a
   defined rim. Soap bubbles. Not powder.

   Two things were wrong and they needed separate fixes.

   The cap was in pixels. A cap in pixels is a different physical size on
   every panel: fifty-six pixels is eight per cent of a 720-line frame and
   two and a half of a 2160-line one, so the same scene showed bubbles on one
   machine and specks on another. The caps are shares of the buffer's height
   now, which is the only unit in which "too big to be a snow grain" means
   anything.

   And a cap alone cannot work, because a cap is a lie: it draws a particle
   at a size it is not. So the cap is paired with a fade — the fraction by
   which a particle is being clipped is squared and multiplied into its
   alpha, so a grain grows to the limit and then dissolves rather than
   sitting there as a disc. The rule that falls out of it is the honest one:
   a puff of powder that fills the lens is not a puff, it is fog, and fog is
   the thing this game already draws with the fog.

   Crucially the cap is on the particle's *width*, not its length. A streak
   drawn past the camera is long and thin and is not a bubble; what makes a
   bubble is area. Splitting the two is what lets driven snow smear right
   across the frame while a lump of crust cannot become a saucer.

   ── FROM CLEAR AIR TO A WHITEOUT ─────────────────────────────────────────

   `setIntensity` used to move one integer: the draw range. Clear weather and
   a blizzard were the same particle in different quantities, and a blizzard
   is not more of a flurry, it is a different thing happening. Six things
   move with the dial now, and every one of them is something you can point
   at out of a window:

     size and variety — light snow is fine dry crystals, all much of a
       muchness. Heavy snow is fat wet aggregates falling among the fines, so
       the *spread* of the size distribution opens up as well as its mean.

     how hard it is driven — the wind vector was already being passed in and
       already reaches sixteen metres a second at the top of the dial, so a
       storm is near-horizontal for free. What did not come for free is the
       flutter: a big loose flake wanders on the way down, and a flake being
       driven at sixteen metres a second has no time to wander. Flutter is
       taken out as the wind comes in.

     streaking — this is the one that turns snow into weather. Fast snow past
       a camera is a short line, not a dot, and the length of that line is
       the *apparent* velocity: the flake's own motion minus the camera's.
       Which means riding fast through snow streaks it, and that is now true
       without anyone being told about the rider, because the camera's
       velocity is measured from where it was last frame.

     stratification — snow does not arrive uniformly, it arrives in gusts.
       A slow band pattern travelling with the wind modulates every flake's
       alpha, so the field surges and lulls rather than falling like rain in
       a shop window.

     density — and this is the lever that does the most work. Sixteen hundred
       flakes spread through a forty-eight metre cube is a light flurry
       whatever you do to them; the same flakes packed into a twenty-seven
       metre cube fill the near field, which is where a particle covers the
       most pixels. So the box breathes with the dial. It contracts as the
       storm closes in, which is also what a storm looks like from inside.

     spindrift — and the snow that is already on the ground. Above about a
       third of the dial the wind starts lifting the surface, and a sheet of
       grains bounces and streams downwind at knee height. It is the single
       most recognisable thing about a real alpine storm and the mountain had
       nothing of it. It lives in the same buffer and the same draw call as
       the falling snow, at the far end of the pool, which is why none of it
       needed a line of `main.js`.

   At the top of the dial the weather module has already pulled the fog in to
   sixty-eight metres and drained the key light. This is written to work with
   that rather than beside it: the box is smaller than the fog distance, so
   everything the snow is doing happens in front of the curtain and nothing
   is wasted behind it.

   ── STREAKS ──────────────────────────────────────────────────────────────

   And the speed streaks stopped being lines. A one-pixel LineSegment at 288
   lines was a chunky white dash; the same primitive at native resolution on
   a retina panel is a hairline, and a screen full of hairlines does not read
   as speed, it reads as a scratched lens. They are camera-facing ribbons
   now, held at a constant handful of pixels wide however far away they are,
   soft across their width and fading out along their length.

   ── AND THE ONE RULE ─────────────────────────────────────────────────────

   Snow is never white. Every particle in this file used to be `#ffffff`,
   which on a mountain whose entire palette is built on the opposite claim
   was the loudest exception left in the game. A flake in the air is not lit
   by anything of its own — it is a suspension taking the colour of the sky
   around it — so the colour is now read back out of the haze that `main.js`
   writes into these materials every frame, lifted a little and biased blue,
   and held under a ceiling that is a pale glacier rather than paper. It
   costs nothing, it is right at all nine times of day without a table, and
   at night it does the thing a fixed white could never do: it goes dark. */

import { SNOW, STREAKS, SKY, RENDER } from './config.js';
import { heightAt, gradeAt } from './terrain.js';

/* ==========================================================================
   The numbers this file owns

   `config.js` belongs to the assembly and holds the two counts — SNOW.count
   and SNOW.sprayCount — and the reference size of the falling-snow box. Both
   are still the anchor: everything below is a multiplier on them, so moving
   a count or a box in config still moves the whole system. What is here is
   the shape of the weather curve, which is nobody else's business.
   ========================================================================== */

export const WEATHER = {
  /* What `main.js` actually hands to `setIntensity`.

     It passes `weather.snow`, and `weather.snow` is now the storm dial
     itself, honestly reaching zero. It used to carry a floor — `0.12 +
     storm · 0.88` — because the run was never without falling snow, and
     this constant existed to take that floor back off. Weather has an
     airmass now (see AIRMASS there): a settled high over the range is
     genuinely clear, and flakes drifting past a cloudless sun were the one
     thing left contradicting it. So nothing is subtracted, and a zero dial
     means zero snow. The particle tables' own calm end still keeps the
     lightest fall subtle rather than sparse — a flurry is a few flakes
     close by, not a thin sheet of them everywhere. */
  clearFloor: 0,

  /* Pool sizes, as multiples of SNOW.count.

     The pool is larger than the count and that is not a request for more
     work: the update loop now runs over the flakes that are *in the air*
     rather than over the whole array, and in clear weather that is fifty of
     them. What this buys is a top end — a whiteout gets half again as many
     flakes as the old field ever had, and clear air costs a twentieth of
     what it used to. */
  pool: 2.0,
  drift: 0.30,          // and the spindrift's share, at the far end of it

  /* How far the dial has to move before the per-flake tables are rebuilt.
     The storm clock is slow, so this is a rebuild about twice a second at
     the fastest, against a pass over two thousand flakes. */
  step: 0.006,

  // Share of the pool aloft, and the curve on to it. Nine per cent is the
  // permanent fine-snow layer: enough flakes to avoid empty clear-weather
  // frames, but still less than a tenth of a whiteout. The exponent is what
  // keeps light snow light: a dial at a half should be a snowfall, not most
  // of a blizzard.
  density: [0.09, 1.0],
  densityCurve: 1.05,
  // …and the band of ranks over which the marginal flakes fade in rather
  // than appearing. Without it the field pops one flake at a time.
  edge: 0.10,

  /* The travelling box, as a multiple of SNOW.box. Calm snow used to occupy
     a 62-metre cube: technically present, but so dilute that a still frame
     commonly contained no readable flakes. A 44-metre calm volume keeps a
     handful in the view while remaining open and airy. It contracts further
     with the storm, which is most of what makes a whiteout hard to see
     through: the same flakes packed into the near field cover more pixels. */
  box: [0.92, 0.38],

  // The mean flake, as a multiple of SNOW.size, and how far the fine and the
  // fat sit either side of it. Both open up with the dial: heavy snow is
  // bigger *and* more varied, and the variety is what stops a blizzard
  // reading as one repeated sprite.
  size: [0.52, 1.18],
  spread: [0.24, 1.45],
  alpha: [0.28, 0.70],

  // Lateral wander, in metres a second, from a fine crystal to a fat
  // aggregate — and the share of it that survives being driven.
  flutter: [0.14, 0.62],
  flutterInWind: 0.28,

  /* Smear. `exposure` is how many seconds of a flake's apparent travel it is
     drawn across, and `streak` is the share of that a fine grain and a fat
     flake respectively take: a small dense crystal is moving fastest and
     shows it, a wet aggregate is slower and rounder. */
  exposure: 0.018,
  streak: [1.0, 0.45],

  // Gusting: how much the density bands are allowed to move a flake's alpha,
  // how far apart they are, and how much of the pattern is stacked vertically
  // rather than along the wind.
  gust: [0.06, 0.80],
  gustScale: 0.055,
  gustRise: 0.30,

  /* The caps, as shares of the buffer's height. A flake wider than four per
     cent of the frame is not a flake, and one longer than a sixth of it has
     stopped being weather and started being a scratch. */
  wide: 0.042,
  long: 0.17,
  // …and where a flake between the lens and this has dissolved entirely.
  fade: [0.30, 1.15],
};

/* Spindrift: the snow that is already lying, picked up and driven.

   It is a saltation model in four lines and it is worth writing down why,
   because the obvious model is wrong. Blowing snow is not a cloud drifting
   along above the surface — the grains are too heavy for that. They are
   thrown up a foot or two, driven downwind while they are up, and land
   again, and the impact knocks the next lot loose. So a grain here has a
   height above the snow and a vertical speed, gravity pulls it back, and
   when it arrives it is simply relaunched. What that produces, for nothing,
   is the thing that makes real spindrift recognisable: a dense fast-moving
   layer right at the surface with a thinner haze above it, because the
   grains spend most of their time near the bottom of the hop.

   The ground under a grain is sampled from `heightAt` when it is placed and
   then carried along by the base grade, with a round-robin correction back
   to the true surface. A tenth of the grains are corrected per frame, so the
   whole sheet is right to within a few centimetres for about six height
   samples a frame. Sampling every grain every frame was the first version
   and it cost a third of a millisecond to fix an error nobody could see. */
export const SPINDRIFT = {
  from: 0.34,           // dial below which the surface stays put
  full: 0.95,
  ahead: 30,            // metres of it kept in front of the camera
  behind: 9,
  width: 34,            // and either side
  /* The hop, and it is the one place these numbers have to be read together.
     A grain thrown up at v reaches v²/2g, so the loft range and the settle
     between them are the *depth of the sheet* — two and a half metres at the
     top of the range, a few centimetres at the bottom. Get them wrong the
     first way and the drift is a fog bank at head height; get them wrong the
     other way, which is how this started, and every grain hugs the snow so
     closely that the terrain in front occludes the lot and the effect is
     invisible from the one place anybody looks at it from. */
  loft: [1.6, 5.2],     // m/s a grain is thrown up at
  settle: 5.5,          // m/s² pulling it back down
  shear: 0.5,           // share of the wind a grain at the surface feels
  height: 2.6,          // metres at which it feels all of it
  size: 0.62,           // × the falling flake's mean — grains, not flakes
  alpha: 0.85,
  streak: 1.7,
  resample: 10,         // frames between true ground samples, per grain
  fadeIn: 0.22,
};

/* The spray's own share of the same machinery. Powder is finer than snowfall
   and much closer to the lens, so both caps come in and the growth comes
   down: a puff that trebles in size on its way out is the exact shape that
   arrives at the camera as a disc. */
export const SPRAY = {
  wide: 0.028,
  long: 0.095,
  fade: [0.35, 1.45],
  exposure: 0.010,
  streak: 0.65,
  born: 0.9,            // × SNOW.spraySize
  fineSmall: 0.35,      // how much smaller dust starts than a thrown lump
  grow: [0.30, 1.05],   // and how much of itself each gains by the end
};

/* What the particles currently believe the sky is doing.

   `main.js` writes the live haze into every material that fogs itself by
   hand, once a frame, before any of these update. The falling snow and the
   spray get it directly. The speed streaks have no fog term of their own —
   they are held inside thirty metres where there is nothing to fog against —
   but they still have to agree with everything else about what colour the
   air is, so they read the last value that came past here. It starts at the
   config's haze so a streak drawn before the first weather tick is not
   black. */
const AIR = { r: 0.78, g: 0.83, b: 0.90 };

/* Snow is never white — not even falling snow, and not even powder off an
   edge. A flake is a suspension: it is the colour of the sky it is hanging
   in, a little brighter because it is scattering rather than absorbing, and
   a little bluer because that is what ice does. The ceiling is where "a
   little brighter" stops: a pale glacier, well short of paper, in the linear
   light these colours live in. */
const LIFT = [1.16, 1.22, 1.32];
const CEIL = [0.70, 0.79, 0.94];

function readAir(uniforms) {
  const f = uniforms.uFog.value;
  AIR.r = f.r;
  AIR.g = f.g;
  AIR.b = f.b;
  const c = uniforms.uColor.value;
  c.setRGB(
    Math.min(CEIL[0], f.r * LIFT[0]),
    Math.min(CEIL[1], f.g * LIFT[1]),
    Math.min(CEIL[2], f.b * LIFT[2]),
  );
}

/* ==========================================================================
   The point shader

   One material serves the snow, the spindrift and the spray, because the
   three of them differ in what they are told rather than in what they are.
   ========================================================================== */

/* The vertex stage does the work that used to be done on the CPU, and it is
   the reason the smear can be right.

   A single screen-space direction is enough for a parallel field — snow
   driven by wind all moves the same way — and it is exactly wrong for the
   other half of what makes snow streak, which is the camera moving through
   it. Motion along the view axis projects to nothing at the centre of the
   frame and to a great deal at its corners, so the direction a flake smears
   in is a function of where on the screen it is. That is a per-particle
   answer, and rather than compute two thousand of them on the CPU and upload
   them, the projection is simply done twice here: once for where the
   particle is, once for where the air around it was an exposure ago. The
   difference between the two, in pixels, is the smear.

   It also fixes something that was quietly wrong. `gl_PointCoord` runs down
   the sprite while clip space runs up it, and the old axis was handed
   straight from one to the other — so every streak in the game leaned along
   the mirror image of the direction the snow was actually travelling. */
const VERT = `
  precision highp float;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aStreak;
  attribute float aSeed;
  attribute float aTint;
  varying float vAlpha;
  varying float vDepth;
  varying float vStretch;
  varying float vClip;
  varying float vSoft;
  varying float vScatter;
  varying float vGlint;
  varying float vTint;
  varying vec2 vAxis;
  uniform float uScale;
  uniform float uWide;
  uniform float uLong;
  uniform float uExposure;
  uniform vec3 uFlow;
  uniform vec2 uHalfRes;
  uniform vec3 uGust;      // amount, spacing, phase
  uniform vec3 uGustDir;
  uniform vec3 uSunView;
  uniform vec3 uSunDir;
  uniform float uSunLevel;
  uniform float uSnowFresh;
  uniform float uGlint;
  uniform float uTime;
  void main() {
    vScatter = 0.0;
    vGlint = 0.0;
    vTint = aTint;
    /* Gusting. Two sine bands at incommensurate spacings, travelling with
       the wind, so the field surges and lulls instead of falling evenly. It
       is written to preserve its own mean — the lulls take out as much as
       the gusts put back — because otherwise turning the weather up would
       dim the snow. */
    float g = 1.0;
    if (uGust.x > 0.001) {
      float s = dot(position, uGustDir) * uGust.y + uGust.z;
      float band = (sin(s) * 0.5 + 0.5) * (sin(s * 0.41 + 1.7) * 0.5 + 0.5);
      g = max(0.0, 1.0 + uGust.x * (band * 2.6 - 0.65));
    }
    vAlpha = aAlpha * g;

    /* An idle particle leaves through the top of the clip volume rather than
       being drawn transparent.

       This is not a micro-optimisation, it is the reason the pool is allowed
       to be bigger than the field. A point whose centre is clipped is never
       rasterised; a point that reaches the fragment stage and discards there
       has already cost every pixel it covered. Clear weather keeps two
       thousand flakes on the shelf, and at the size cap each of them would
       otherwise be paying a thousand discarded fragments a frame for the
       privilege of being invisible. */
    if (vAlpha <= 0.002) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    vec4 clip = projectionMatrix * mv;
    gl_Position = clip;

    /* Forward scatter. A flake between the eye and a low sun is backlit, and
       backlit ice is brighter than frontlit ice — most of the light goes
       straight through and out the near side. One dot of the view direction
       against the sun, raised to the fourth so it is a lobe around the sun
       rather than a wash over the sky, gated to a low sun because at noon the
       same physics is happening but nobody can see it against the glare, and
       scaled by the sun's level so a night sky does not backlight anything.
       The uniforms are the shading module's own objects, shared by reference,
       so this costs no copying and can never disagree with the terrain about
       where the sun is. */
    float sd = max(dot(normalize(mv.xyz), uSunView), 0.0);
    sd *= sd;
    float low = 1.0 - smoothstep(0.08, 0.42, uSunDir.y);
    vScatter = sd * sd * low * min(uSunLevel, 1.3);

    vec3 flowView = (viewMatrix * vec4(uFlow, 0.0)).xyz;
    vec4 was = projectionMatrix * (mv + vec4(flowView * uExposure, 0.0));
    // A particle level with the eye divides by nothing. It is also outside
    // the frustum, so the number it gets is only required to be finite.
    vec2 a = clip.xy / max(clip.w, 0.02);
    vec2 b = was.xy / max(was.w, 0.02);
    vec2 d = (b - a) * uHalfRes;

    // The two sizes: how wide this is on screen, and how far the smear
    // reaches. Only the first is capped for being a blob.
    float wide = aSize * uScale / max(vDepth, 0.01);
    float reach = wide + length(d) * aStreak;
    float w = min(wide, uWide);
    /* min-after-max rather than clamp: GLSL's clamp is undefined when its
       bounds cross, and on the one driver where the caps ever meet that
       undefined result is exactly the oversize point this is preventing. */
    float l = min(max(reach, w), uLong);
    gl_PointSize = max(l, 1.0);
    vStretch = l / max(w, 0.01);
    /* Fade against BOTH caps, which is the whole of the white-square fix.

       The width cap was faded and the length cap was not, and the length
       cap is the one that sets gl_PointSize. A sprite can therefore be
       narrow enough to pass the width fade untouched while its smear runs
       far past uLong — which is exactly what a grain of spray does when the
       board is carrying speed. It was then drawn at FULL alpha at whatever
       size the hardware was willing to rasterise, and a driver that crops
       rather than scales hands back the documented square window cut out of
       the flake's opaque middle: a hard white block at the bottom of the
       frame, right where the spray is thrown. Fading on the length ratio
       too means anything the cap is truncating dissolves instead. The 1.4
       is slack, so ordinary clipping still draws its shortened smear at
       full strength and only genuine over-run disappears. */
    vClip = min(
      min(1.0, uWide / max(wide, 0.01)),
      min(1.0, (uLong * 1.4) / max(reach, 0.01)));
    // Small sprites need every pixel they have and want a nearly flat top;
    // a big one is a puff of air and must not have an edge anywhere on it.
    vSoft = mix(0.75, 2.4, smoothstep(3.0, 24.0, l));
    vAxis = normalize(vec2(d.x, -d.y) + vec2(1e-5, 0.0));

    /* Ice glitter, spray only. A hard grain of thrown crust is a crystal, and
       a crystal facet catching the sun is a flash, not a glow. Each particle
       carries a random seed set when it was emitted, and a moving window over
       fract(seed + time) lets a few per cent of the grains flash per second,
       each at its own moment and its own rate. It is confined to the small
       hard sprites — a big soft puff has no facets — and to the near field,
       and a storm takes it away entirely: under a whiteout the sun that would
       have made the flash is already gone. */
    if (uGlint > 0.5) {
      float tw = fract(aSeed * 63.0 + uTime * (0.5 + aSeed * 0.4));
      vGlint = (smoothstep(0.955, 0.975, tw) - smoothstep(0.975, 0.995, tw))
        * (1.0 - smoothstep(3.5, 9.0, l))
        * (1.0 - smoothstep(6.0, 16.0, vDepth))
        * (1.0 - uSnowFresh) * min(uSunLevel, 1.0);
    }
  }
`;

const FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform vec3 uSunTint;
  uniform vec3 uSkyGlow;
  uniform float uNear;
  uniform float uFar;
  uniform vec2 uDepthFade;
  varying float vAlpha;
  varying float vDepth;
  varying float vStretch;
  varying float vClip;
  varying float vSoft;
  varying float vScatter;
  varying float vGlint;
  varying float vTint;
  varying vec2 vAxis;
  void main() {
    if (vAlpha <= 0.002) discard;
    vec2 d = gl_PointCoord - 0.5;
    vec2 across = vec2(-vAxis.y, vAxis.x);
    vec2 q = vec2(dot(d, vAxis), dot(d, across) * vStretch);
    float r = dot(q, q);
    if (r > 0.25) discard;
    // One smooth peak rather than a disc with a rim. The rim is what read as
    // a bubble; a falling exponent is what reads as powder.
    float k = max(1.0 - r * 4.0, 0.0001);
    float a = vAlpha * pow(k, vSoft);
    // A field of identical flakes reads as a pattern; each one leaning its
    // own fixed step towards the haze reads as depth the field does not have.
    // Below zero the tint runs towards the overdrive ember instead — the
    // same lerp continued, not a branch, so the whole field pays nothing for
    // a feature only the max-combo sparks use, and an ember still takes the
    // fog, scatter and glint treatment every other grain takes.
    vec3 col = mix(
      mix(uColor, uFog, max(vTint, 0.0) * 0.35),
      vec3(1.0, 0.62, 0.16),
      clamp(-vTint, 0.0, 1.0));
    // The backlit lift: the sun's own hue folded into the flake, and a modest
    // raise in coverage, strongest looking straight down the light. The mix
    // is capped so a flake never becomes a lamp, only a lit flake.
    col = mix(col, mix(uSunTint, uSkyGlow, 0.35), min(vScatter * 0.7, 0.7));
    a *= 1.0 + vScatter * 0.35;
    // …and the glint, which is the one legal exception to "snow is never
    // white": a facet flashing the sun back is a specular event, not a body
    // colour, and it is brief, rare, near, and gone in a storm.
    col = mix(col, vec3(1.0), vGlint * 0.85);
    a = min(a * (1.0 + vGlint * 1.6), 1.0);
    // Anything the width cap is clipping is on its way to being a sheet
    // across the lens, and dissolves at the rate it would have grown
    a *= vClip * vClip;
    // …and anything inside arm's reach of it has gone regardless
    a *= smoothstep(uDepthFade.x, uDepthFade.y, vDepth);
    float f = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, uFog, f * 0.8), a * (1.0 - f));
  }
`;

function pointMaterial(THREE, shading) {
  /* The sun arrives by reference, not by copy. The shading module owns one
     set of uniform objects and every lit material on the mountain is handed
     those same objects, which is the whole reason the day/night cycle costs
     one write a frame. The particles now join that arrangement rather than
     imitating it: the material below holds the *same* `{ value }` objects,
     so when `shading.update` moves the sun, the snow in the air moves with
     it and nobody copies anything. The fallback exists so this module can
     still be constructed without a shading instance — the level defaults to
     zero, so the scatter and the glint simply stay off. */
  const sun = shading ? shading.uniforms : {
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunTint: { value: new THREE.Color('#ffffff') },
    uSunLevel: { value: 0 },
    uSkyGlow: { value: new THREE.Color(SKY.haze) },
    uSnowFresh: { value: 0 },
  };
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(SKY.haze) },
      uFog: { value: new THREE.Color(SKY.haze) },
      uNear: { value: RENDER.fogNear },
      uFar: { value: RENDER.fogFar },
      uScale: { value: 300 },
      uWide: { value: 24 },
      uLong: { value: 96 },
      uExposure: { value: 0 },
      uFlow: { value: new THREE.Vector3() },
      uHalfRes: { value: new THREE.Vector2(320, 180) },
      uDepthFade: { value: new THREE.Vector2(0.3, 1.2) },
      uGust: { value: new THREE.Vector3() },
      uGustDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunView: sun.uSunView,
      uSunDir: sun.uSunDir,
      uSunTint: sun.uSunTint,
      uSunLevel: sun.uSunLevel,
      uSkyGlow: sun.uSkyGlow,
      uSnowFresh: sun.uSnowFresh,
      uGlint: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
}

function pointCloud(THREE, count, shading) {
  const geo = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  const streak = new Float32Array(count);
  const seed = new Float32Array(count);
  const tint = new Float32Array(count);
  // Everything here is rewritten while the game runs — position and alpha
  // every frame, size and streak on every weather rebuild or emit, and the
  // tint whenever the spray recycles a slot into or out of an ember — so
  // the driver is told so up front rather than left to discover it.
  const dyn = (attr) => attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', dyn(new THREE.BufferAttribute(position, 3)));
  geo.setAttribute('aSize', dyn(new THREE.BufferAttribute(size, 1)));
  geo.setAttribute('aAlpha', dyn(new THREE.BufferAttribute(alpha, 1)));
  geo.setAttribute('aStreak', dyn(new THREE.BufferAttribute(streak, 1)));
  geo.setAttribute('aSeed', dyn(new THREE.BufferAttribute(seed, 1)));
  geo.setAttribute('aTint', dyn(new THREE.BufferAttribute(tint, 1)));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const points = new THREE.Points(geo, pointMaterial(THREE, shading));
  points.frustumCulled = false;
  return { points, geo, position, size, alpha, streak, seed, tint };
}

/* Pixels per metre, for something one metre from the lens.

   Point size is authored in metres and `gl_PointSize` is in framebuffer
   pixels, so this is the conversion, and it depends on two things that both
   move at runtime: the field of view, which the camera opens with speed, and
   the height of the buffer, which the resolution governor rewrites whenever
   the frame clock asks it to. The default reads `RENDER.buffer.height` at
   call time for exactly that reason — this used to take a constant, and a
   constant is wrong on every machine but one. */
export function pointScale(camera, height = RENDER.buffer.height) {
  return height / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

/* What the hardware will actually rasterise.

   `gl_PointSize` has a driver limit — `ALIASED_POINT_SIZE_RANGE` — and it is
   not a large number everywhere: plenty of mobile GPUs stop at 64 or 255
   while a desktop part offers 1024. A point past the limit is not scaled
   down, it is *cropped*: the sprite keeps claiming the size the shader
   asked for, `gl_PointCoord` keeps running over that claimed size, and what
   is drawn is a square window cut out of the middle of the flake. The limit
   cannot be queried from inside a shader, so it is held here and folded into
   the two caps below — every size the shader computes is already bounded by
   `uLong`, so bounding `uLong` and `uWide` on the CPU bounds `gl_PointSize`
   itself, and the stretch and clip-fade maths downstream of them stay
   consistent without a second clamp in the shader. The default is a
   conservative floor that every WebGL implementation must meet or beat;
   `setPointSizeCap` lets the assembly raise it to the real queried limit. */
let pointCap = 128;

export function setPointSizeCap(px) {
  if (Number.isFinite(px) && px > 0) pointCap = Math.max(16, Math.min(1024, px));
}

/* For the other point systems (hut smoke) whose ceilings are authored as
   shares of the buffer height: those shares must still lose to the driver,
   or a puff drifting past the lens comes back as the cropped square this
   cap exists to prevent. */
export function getPointSizeCap() {
  return pointCap;
}

/* The size caps, likewise, are shares of that same height and are read at
   the moment they are used. This is the whole of the bubble fix's units. */
function applyLimits(uniforms, camera, wide, long) {
  const h = RENDER.buffer.height;
  uniforms.uScale.value = pointScale(camera, h);
  uniforms.uHalfRes.value.set(RENDER.buffer.width * 0.5, h * 0.5);
  /* Never ask for the driver's stated maximum, only most of it. A limit
     reported through ALIASED_POINT_SIZE_RANGE is a promise about what will
     rasterise, not about what will rasterise *correctly*, and the drivers
     that crop instead of scaling tend to do it at the boundary. The
     absolute ceiling comes down to 128 for the same reason: a smear longer
     than that is not carrying any more information, and 128 is inside every
     limit this game is likely to meet. */
  const safe = pointCap * 0.85;
  uniforms.uWide.value = Math.max(3, Math.min(96, h * wide, safe));
  uniforms.uLong.value = Math.max(4, Math.min(128, h * long, safe));
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* Camera-anchored coordinates, because the run is endless and Float32 is not.

   Every system in this file used to write absolute world positions into its
   Float32 attributes on an object standing at the origin. Kilometres down
   the mountain that subtraction — vertex minus camera, performed in 32 bits
   inside the GPU's modelView transform — loses its low bits to catastrophic
   cancellation: at |z| ≈ 30 km the quantum is ~4 mm, which on a snowflake
   two metres from the lens is over a pixel of frame-to-frame jitter, and it
   only grows from there. The terrain and trail already rebase; this brings
   the particles onto the same discipline.

   The mechanism: each system parents its cloud at an anchor snapped to a
   coarse grid of the camera position and stores every coordinate relative
   to that anchor. The anchor is applied through `object.position`, so the
   world transform carries it in the CPU's own float64 and the attribute
   values stay small forever. A step of the anchor is rare — once per grid
   cell of descent — and costs one subtraction pass over the pool. */
const REBASE_GRID = 256;

function snapAnchor(anchor, c) {
  const ax = Math.round(c.x / REBASE_GRID) * REBASE_GRID;
  const ay = Math.round(c.y / REBASE_GRID) * REBASE_GRID;
  const az = Math.round(c.z / REBASE_GRID) * REBASE_GRID;
  if (ax === anchor.x && ay === anchor.y && az === anchor.z) return false;
  anchor.set(ax, ay, az);
  return true;
}

/* How fast the camera is going through the world.

   Nobody tells this file about the rider, and it does not need telling: the
   camera's position last frame and this frame is the whole answer, and it is
   the right answer even when the rider is tumbling and the camera is doing
   something of its own. It is smoothed because the chase camera shakes, and
   an unsmoothed shake is a snowfield that flickers between two smear
   directions sixty times a second. And it is clamped, because a respawn
   moves the camera a kilometre in one step and that is not a speed. */
function cameraTracker(THREE) {
  const vel = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const step = new THREE.Vector3();
  let seen = false;
  return function track(camera, dt) {
    if (seen && dt > 0.0001) {
      step.subVectors(camera.position, prev).divideScalar(dt);
      if (step.lengthSq() > 4900) step.setLength(70);
      vel.lerp(step, 1 - Math.exp(-dt * 14));
    }
    prev.copy(camera.position);
    seen = true;
    return vel;
  };
}

/* ==========================================================================
   Falling snow — a cube of it that travels with the camera, and a sheet of
   spindrift streaming along the ground underneath
   ========================================================================== */

export function createSnowfall(THREE, shading) {
  const fallCount = Math.max(1, Math.round(SNOW.count * WEATHER.pool));
  const driftCount = Math.max(1, Math.round(SNOW.count * WEATHER.drift));
  const n = fallCount + driftCount;

  const cloud = pointCloud(THREE, n, shading);
  const { position, size, alpha, streak, tint, geo } = cloud;
  const uniforms = cloud.points.material.uniforms;

  /* Where each flake sits on the one scale that everything about it is a
     blend on: 0 is a fine dry crystal, 1 is a fat wet aggregate. Size, fall
     rate, how much it wanders and how hard it smears are all read off this,
     which is why there is one population and not two systems. It is fixed
     per index for the life of the run, so the subset that happens to be in
     the air at any density is a fair sample of the whole distribution. */
  const grade = new Float32Array(fallCount);
  const fall = new Float32Array(fallCount);
  const swing = new Float32Array(fallCount);
  const phase = new Float32Array(fallCount);
  const drift = new Float32Array(fallCount * 2);

  // The spindrift's own state, indexed from the start of its slice
  const dGround = new Float32Array(driftCount);   // snow surface under it
  const dLift = new Float32Array(driftCount);     // and how far above it is
  const dRise = new Float32Array(driftCount);     // m/s, up
  const dAge = new Float32Array(driftCount);
  const dSize = new Float32Array(driftCount);     // its share of the mean grain

  for (let i = 0; i < fallCount; i++) {
    grade[i] = Math.random();
    phase[i] = Math.random() * Math.PI * 2;
    drift[i * 2] = (Math.random() - 0.5) * 1.6;
    drift[i * 2 + 1] = (Math.random() - 0.5) * 1.6;
  }
  // Fixed once. Re-rolling these on every rebuild would resize every grain
  // in the sheet twice a second, which reads as static rather than as snow.
  for (let k = 0; k < driftCount; k++) dSize[k] = 0.55 + Math.random() * 0.9;
  // Also fixed once: how far each flake leans towards the haze. Written at
  // build, uploaded with the geometry's first draw, and never touched again.
  for (let i = 0; i < n; i++) tint[i] = Math.random();

  const track = cameraTracker(THREE);
  const flow = new THREE.Vector3();
  const gustDir = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3();
  const rgt = new THREE.Vector3();
  // The rebase frame — see `snapAnchor`. Every stored coordinate below is
  // anchor-relative; only the heightAt/gradeAt probes translate back.
  const anchor = new THREE.Vector3(0, 0, 0);
  const cl = new THREE.Vector3();

  let clock = 0;
  let gustPhase = 0;
  let seeded = false;
  let dial = -1;
  let active = 0;
  let driftActive = 0;
  let driftAlpha = 0;
  let box = SNOW.box;
  let lastBox = box;
  let meanFall = SNOW.fall;
  let resamplePhase = 0;
  // Upload bookkeeping: whether the whole alpha table changed this frame
  // (a weather rebuild) rather than just the spindrift slice, and whether
  // the whole position table did (the first seeding).
  let alphaFull = false;
  let uploadAll = true;

  /* Weather, in one pass over the tables.

     Nothing here is per-frame work. The storm clock moves slowly enough that
     rebuilding on every hundredth of the dial is a couple of passes a second
     over two thousand flakes, and in exchange every per-flake constant —
     size, alpha, fall rate, flutter, smear — can be a function of the
     weather rather than of nothing. */
  function rebuild(s) {
    const density = lerp(WEATHER.density[0], WEATHER.density[1],
      Math.pow(s, WEATHER.densityCurve));
    const mean = SNOW.size * lerp(WEATHER.size[0], WEATHER.size[1], s);
    const spread = lerp(WEATHER.spread[0], WEATHER.spread[1], s);
    const base = lerp(WEATHER.alpha[0], WEATHER.alpha[1], s);
    const calm = lerp(1, WEATHER.flutterInWind, s);
    // The fade band cannot be wider than the field it is fading: at the
    // clear end the whole population is inside a tenth of the pool, and a
    // fixed band would hold every flake in the sky at half strength.
    const edge = Math.max(0.004, Math.min(WEATHER.edge, density * 0.6));

    box = SNOW.box * lerp(WEATHER.box[0], WEATHER.box[1], s);
    active = Math.min(fallCount, Math.ceil(fallCount * density));
    // The mean of the per-flake rate below, which is what the smear wants:
    // one direction for the whole field, taken from the middle of it.
    meanFall = SNOW.fall * 1.07;

    for (let i = 0; i < fallCount; i++) {
      const g = grade[i];
      // Mean, plus or minus the spread. A fat flake is the far end of one
      // distribution rather than a second kind of object.
      const m = mean * (1 + spread * (g - 0.5));
      size[i] = m;
      // A big loose aggregate is mostly air: it falls slowly and wanders on
      // the way down. A small one is nearer to a pellet and drops straight.
      fall[i] = SNOW.fall * (1.32 - g * 0.5);
      swing[i] = lerp(WEATHER.flutter[0], WEATHER.flutter[1], g) * calm;
      streak[i] = lerp(WEATHER.streak[0], WEATHER.streak[1], g);
      // The marginal flakes of the field fade in over a band of ranks rather
      // than switching on, so weather arriving is weather thickening
      const vis = clamp01((density - i / fallCount) / edge);
      // Fat flakes carry a little more light than fine ones, and everything
      // is dimmer when the air is thin enough to see through
      alpha[i] = vis * base * (0.78 + g * 0.34);
    }

    // Spindrift, above the dial at which the wind starts lifting the surface
    const lift = clamp01((s - SPINDRIFT.from) / (SPINDRIFT.full - SPINDRIFT.from));
    driftActive = Math.round(driftCount * lift);
    driftAlpha = SPINDRIFT.alpha * lift;
    for (let k = 0; k < driftCount; k++) {
      const i = fallCount + k;
      size[i] = mean * SPINDRIFT.size * dSize[k];
      streak[i] = SPINDRIFT.streak;
      if (k >= driftActive) alpha[i] = 0;
    }
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aStreak.needsUpdate = true;
    // The alpha upload is deferred to `update`, which knows whether this
    // frame's changes cover the whole table or only the spindrift slice.
    alphaFull = true;
  }

  /* `main.js` hands over `weather.snow`, which IS the dial. `clearFloor` is
     zero now and this stays a mapping rather than a pass-through only so a
     future floor can be reintroduced in one place. */
  function setIntensity(t) {
    const s = clamp01((t - WEATHER.clearFloor) / (1 - WEATHER.clearFloor));
    if (Math.abs(s - dial) < WEATHER.step) return;
    dial = s;
    rebuild(s);
  }

  const wrap = (v, c, w) => {
    let d = v - c;
    d -= Math.floor(d / w + 0.5) * w;
    return c + d;
  };

  function seed(c) {
    for (let i = 0; i < fallCount; i++) {
      position[i * 3] = c.x + (Math.random() - 0.5) * box;
      position[i * 3 + 1] = c.y + (Math.random() - 0.5) * box;
      position[i * 3 + 2] = c.z + (Math.random() - 0.5) * box;
    }
  }

  /* A grain is placed in front of the camera rather than around it, because
     the camera is travelling at up to fifty metres a second and anything
     placed level with it is behind it within the second. It fades in over a
     fifth of a second and fades out again as it reaches the back of the
     window, so nothing is ever seen to appear or to vanish. */
  function place(k, c) {
    const i = fallCount + k;
    const j = i * 3;
    const ahead = -SPINDRIFT.behind + Math.random() * (SPINDRIFT.ahead + SPINDRIFT.behind);
    const across = (Math.random() - 0.5) * SPINDRIFT.width;
    const x = c.x + fwd.x * ahead + rgt.x * across;
    const z = c.z + fwd.z * ahead + rgt.z * across;
    position[j] = x;
    position[j + 2] = z;
    // The probe asks the mountain in world coordinates; the answer is
    // stored back in the anchor's frame like everything else here.
    dGround[k] = heightAt(x + anchor.x, z + anchor.z) - anchor.y;
    dLift[k] = Math.random() * SPINDRIFT.height * 0.6;
    dRise[k] = lerp(SPINDRIFT.loft[0], SPINDRIFT.loft[1], Math.random()) * Math.random();
    dAge[k] = 0;
    position[j + 1] = dGround[k] + dLift[k];
  }

  function updateDrift(dt, c, wx, wz) {
    resamplePhase = (resamplePhase + 1) % SPINDRIFT.resample;
    const span = SPINDRIFT.ahead + SPINDRIFT.behind;
    for (let k = 0; k < driftActive; k++) {
      const i = fallCount + k;
      const j = i * 3;
      dAge[k] += dt;

      /* Wind shear. The air is stopped by the surface it is running over, so
         a grain at the snow feels half of it and one at head height feels
         all of it — which is why blowing snow leans forward as it rises and
         is not simply a slab of moving air. */
      const v = SPINDRIFT.shear
        + (1 - SPINDRIFT.shear) * Math.min(1, dLift[k] / SPINDRIFT.height);
      const mx = wx * v * dt;
      const mz = wz * v * dt;
      position[j] += mx;
      position[j + 2] += mz;

      // Saltation: up, over, down, and straight back up again on arrival
      dRise[k] -= SPINDRIFT.settle * dt;
      dLift[k] += dRise[k] * dt;
      if (dLift[k] <= 0) {
        dLift[k] = 0.01;
        dRise[k] = lerp(SPINDRIFT.loft[0], SPINDRIFT.loft[1], Math.random());
      }

      /* The ground the grain is standing over, carried by the base grade and
         corrected back to the real surface once every `resample` frames. The
         grade term is exact for the hill's own pitch and wrong only by the
         noise octaves, which over a couple of metres of travel is a few
         centimetres — so the correction is eased rather than applied, and
         nothing is ever seen to step. */
      dGround[k] += gradeAt(position[j + 2] + anchor.z) * mz;
      if (k % SPINDRIFT.resample === resamplePhase) {
        dGround[k] += (heightAt(position[j] + anchor.x, position[j + 2] + anchor.z)
          - anchor.y - dGround[k]) * 0.5;
      }
      position[j + 1] = dGround[k] + dLift[k];

      // Where it sits in the window in front of the camera, which decides
      // both whether it is still wanted and how strongly it is drawn
      const rx = position[j] - c.x;
      const rz = position[j + 2] - c.z;
      const along = rx * fwd.x + rz * fwd.z;
      const side = rx * rgt.x + rz * rgt.z;
      if (along < -SPINDRIFT.behind || along > SPINDRIFT.ahead
        || side < -SPINDRIFT.width || side > SPINDRIFT.width) {
        place(k, c);
        alpha[i] = 0;
        continue;
      }
      const edge = Math.min(1,
        (along + SPINDRIFT.behind) / (span * 0.22),
        (SPINDRIFT.ahead - along) / (span * 0.3),
        (SPINDRIFT.width - Math.abs(side)) / (SPINDRIFT.width * 0.4));
      // Thinning upwards is what the hop already does with its own timing;
      // this is only the veil above it giving way
      const high = 1 - 0.45 * Math.min(1, dLift[k] / SPINDRIFT.height);
      alpha[i] = driftAlpha * edge * high
        * Math.min(1, dAge[k] / SPINDRIFT.fadeIn);
    }
  }

  function update(dt, camera, wind) {
    /* The anchor step. Everything below works in the anchor's frame, so a
       step is one subtraction pass and a full re-upload; between steps the
       code is exactly what it was when it worked in world coordinates. */
    const oax = anchor.x;
    const oay = anchor.y;
    const oaz = anchor.z;
    if (snapAnchor(anchor, camera.position)) {
      cloud.points.position.copy(anchor);
      if (seeded) {
        const dx = anchor.x - oax;
        const dy = anchor.y - oay;
        const dz = anchor.z - oaz;
        for (let i = 0; i < n; i++) {
          const j = i * 3;
          position[j] -= dx;
          position[j + 1] -= dy;
          position[j + 2] -= dz;
        }
        for (let k = 0; k < driftCount; k++) dGround[k] -= dy;
        uploadAll = true;
      }
    }
    cl.copy(camera.position).sub(anchor);
    const c = cl;
    const wx = wind ? wind.x : 0;
    const wz = wind ? wind.z : 0;
    const windSpeed = Math.sqrt(wx * wx + wz * wz);
    const camVel = track(camera, dt);
    clock += dt;

    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    rgt.set(-fwd.z, 0, fwd.x);

    if (!seeded) {
      seeded = true;
      if (dial < 0) setIntensity(WEATHER.clearFloor);
      seed(c);
      for (let k = 0; k < driftCount; k++) place(k, c);
      lastBox = box;
    }

    /* The box breathes with the storm, and the field is carried with it.

       Left to the wrap alone this would be ugly in one direction and broken
       in the other: contracting, every flake outside the new box would jump
       to the far face at once; expanding, nothing would ever leave, so the
       field would stay knotted around the camera and take a minute to spread
       into the room it had just been given. Scaling every offset by the same
       ratio the box moved by is exact, continuous, and costs one multiply on
       a loop that is already running. */
    const ratio = lastBox > 0 ? box / lastBox : 1;
    lastBox = box;
    const rescale = Math.abs(ratio - 1) > 1e-6;

    for (let i = 0; i < active; i++) {
      const j = i * 3;
      if (rescale) {
        position[j] = c.x + (position[j] - c.x) * ratio;
        position[j + 1] = c.y + (position[j + 1] - c.y) * ratio;
        position[j + 2] = c.z + (position[j + 2] - c.z) * ratio;
      }
      const a = clock * (1.4 + swing[i] * 1.8) + phase[i];
      position[j] += (drift[i * 2] + wx + Math.cos(a) * swing[i]) * dt;
      position[j + 1] -= fall[i] * dt;
      position[j + 2] += (drift[i * 2 + 1] + wz + Math.sin(a * 0.7) * swing[i] * 0.7) * dt;
      // The box is a torus around the camera: anything that leaves one face
      // arrives at the opposite one, so the field is endless and finite
      position[j] = wrap(position[j], c.x, box);
      position[j + 1] = wrap(position[j + 1], c.y, box);
      position[j + 2] = wrap(position[j + 2], c.z, box);
    }

    if (driftActive > 0) updateDrift(dt, c, wx, wz);

    /* Upload what moved and nothing else. The pool is deliberately larger
       than the field, so in clear weather the flakes that changed are a small
       contiguous slice at the front of the buffer and another at the start of
       the spindrift's — exactly the shape `addUpdateRange` exists for. The
       first frame ships the whole table once, because the seeding above wrote
       every flake including the ones no range would cover. And the alpha
       attribute only travels at all when something wrote it: a weather
       rebuild rewrites the whole table, the spindrift rewrites its slice
       every frame, and a calm night with no drift uploads nothing. */
    const pos = geo.attributes.position;
    pos.clearUpdateRanges();
    if (uploadAll) {
      uploadAll = false;
      pos.needsUpdate = true;
    } else if (active > 0 || driftActive > 0) {
      if (active > 0) pos.addUpdateRange(0, active * 3);
      if (driftActive > 0) pos.addUpdateRange(fallCount * 3, driftActive * 3);
      pos.needsUpdate = true;
    }
    const alphaAttr = geo.attributes.aAlpha;
    alphaAttr.clearUpdateRanges();
    if (alphaFull) {
      alphaFull = false;
      alphaAttr.needsUpdate = true;
    } else if (driftActive > 0) {
      alphaAttr.addUpdateRange(fallCount, driftActive);
      alphaAttr.needsUpdate = true;
    }

    readAir(uniforms);
    applyLimits(uniforms, camera, WEATHER.wide, WEATHER.long);
    uniforms.uDepthFade.value.set(WEATHER.fade[0], WEATHER.fade[1]);
    uniforms.uExposure.value = WEATHER.exposure;
    // What the air is doing relative to the lens, which is what a smear is
    // a picture of. The camera's own motion is most of it above about sixty
    // km/h, and it is why riding hard through snow now looks like it.
    flow.set(wx - camVel.x, -meanFall - camVel.y, wz - camVel.z);
    uniforms.uFlow.value.copy(flow);

    /* Gust bands travel with the wind — a denser parcel of air is carried
       along with the rest of it — so the phase is wound back at the wind's
       own speed and the pattern sweeps past the camera rather than past the
       snow. A little under, so the bands also evolve slowly through the
       field instead of being frozen into it. */
    gustPhase -= windSpeed * WEATHER.gustScale * 0.85 * dt;
    if (windSpeed > 0.35) {
      gustDir.set(wx / windSpeed, WEATHER.gustRise, wz / windSpeed).normalize();
    } else {
      gustDir.set(0, 1, 0);
    }
    uniforms.uGustDir.value.copy(gustDir);
    /* The gust field is a world-space sine and the shader now reads
       anchor-relative positions, so the anchor's share of the phase rides
       in with the clock's — without it every anchor step would reshuffle
       the gust bands in one frame. */
    const anchorPhase = (anchor.x * gustDir.x + anchor.y * gustDir.y
      + anchor.z * gustDir.z) * WEATHER.gustScale;
    uniforms.uGust.value.set(
      lerp(WEATHER.gust[0], WEATHER.gust[1], dial < 0 ? 0 : dial),
      WEATHER.gustScale, gustPhase + anchorPhase);
  }

  return { points: cloud.points, update, setIntensity };
}

/* ==========================================================================
   Spray — thrown off the edge, and everywhere on a landing
   ========================================================================== */

export function createSpray(THREE, shading) {
  const n = SNOW.sprayCount;
  const cloud = pointCloud(THREE, n, shading);
  const { position, size, alpha, streak, seed, tint, geo } = cloud;
  const uniforms = cloud.points.material.uniforms;
  // Spray is the one cloud that glints: it is made of thrown crust rather
  // than falling aggregate, and it is the only one close enough to resolve
  // a flash. The clock below wraps well before float precision frays it.
  uniforms.uGlint.value = 1;
  let sprayTime = 0;
  const vel = new Float32Array(n * 3);
  const life = new Float32Array(n);
  const maxLife = new Float32Array(n);
  // What kind of snow this particle is: 0 is a thrown chunk, 1 is airborne
  // dust. Everything that differs between the two — weight, drag, how long
  // it lasts, how far it swells, how hard the wind gets hold of it — is a
  // blend on this one number, which is why there is one update loop and not
  // two systems.
  const fine = new Float32Array(n);
  const born = new Float32Array(n);   // birth size, in metres
  const grow = new Float32Array(n);   // and how much of itself it gains by the end
  /* Peak opacity is independent of `fine` for edge snow.

     An impact burst can infer its opacity from the coarse/fine blend: a lump
     is solid and dust is translucent. The continuous edge plume cannot. Its
     finest component is a low powder mist, while the grains in the cutting
     sheet are small but comparatively hard. Keeping the peak explicitly lets
     those two overlap without turning the mist into the same opaque dots as
     the sheet. Event bursts below retain their exact old relationship. */
  const peak = new Float32Array(n);
  const tumble = new Float32Array(n); // lateral wander, m/s²
  const spin = new Float32Array(n);   // and how fast that wander swings round
  const phase = new Float32Array(n);
  let head = 0;
  let streakDirty = false;

  /* `edgeSample` arrives at fixed-distance sections, never render frames. A
     Poisson count at each section preserves that spatial density without the
     repeating cadence of a fractional accumulator: pressure changes the
     average mass, but no grain is promised at the next 28 cm boundary. */
  let edgeWander = 0;

  const track = cameraTracker(THREE);
  const flow = new THREE.Vector3();
  // The rebase frame — see `snapAnchor`. Emitters receive world positions
  // and subtract this on the way into the attribute.
  const anchor = new THREE.Vector3(0, 0, 0);

  // Usage is already dynamic — `pointCloud` marks every rewritten attribute —
  // and the geometry's first draw uploads this initial table by itself.
  for (let i = 0; i < n; i++) streak[i] = SPRAY.streak;

  /* `power` is how hard: it scales the cone, the size and how long the
     powder hangs. `dir` is where the board is throwing it. */
  function burst(pos, dirX, dirZ, count, power) {
    const p = Math.min(1, power);
    for (let k = 0; k < count; k++) {
      const i = head;
      head = (head + 1) % n;
      const j = i * 3;
      const spread = 0.4 + power * 0.5;
      // A gentle carve lifts dust; a landing breaks the crust and throws
      // lumps of it, so weight is biased in with power
      const f = Math.random() * (1 - 0.45 * p);
      fine[i] = f;
      // This ring slot may previously have held an elongated cutting-sheet
      // particle — or an overdrive ember, which is why the tint is written
      // back to snow here: a poisoned slot otherwise stayed orange for the
      // rest of the run. Event bursts keep their compact landing/fall smear.
      streak[i] = SPRAY.streak;
      seed[i] = Math.random();
      tint[i] = 0;
      streakDirty = true;
      position[j] = pos.x - anchor.x + (Math.random() - 0.5) * 0.7;
      position[j + 1] = pos.y - anchor.y + 0.1 + Math.random() * 0.25;
      position[j + 2] = pos.z - anchor.z + (Math.random() - 0.5) * 0.7;
      vel[j] = dirX * power * (0.5 + Math.random()) + (Math.random() - 0.5) * spread * 4;
      vel[j + 1] = (0.9 + Math.random() * 1.5) * (1.4 + power * 1.7) * (1 - 0.3 * f);
      vel[j + 2] = dirZ * power * (0.5 + Math.random()) + (Math.random() - 0.5) * spread * 4;
      maxLife[i] = SNOW.sprayLife * (0.45 + Math.random() * 0.75) * (1 + f * 0.85);
      life[i] = maxLife[i];
      /* Dust starts small and disperses; a lump of crust starts big and
         barely changes. That relation used to run the other way round by
         omission — birth size ignored the fine/coarse blend entirely, so the
         longest-lived, fastest-swelling particles were also allowed to be
         born the largest, and what arrived at the camera three quarters of a
         second later was the biggest, slowest, most opaque thing in the
         frame. Which is the bubble, stated as a birth rate. */
      born[i] = SNOW.spraySize * SPRAY.born * (0.4 + Math.random() * 1.1)
        * (0.7 + power * 0.4) * (1 - SPRAY.fineSmall * f);
      grow[i] = lerp(SPRAY.grow[0], SPRAY.grow[1], f);
      peak[i] = 0.92 - f * 0.3;
      tumble[i] = (0.7 + Math.random() * 2.4) * (0.35 + f);
      spin[i] = (2 + Math.random() * 5) * (Math.random() < 0.5 ? -1 : 1);
      phase[i] = Math.random() * Math.PI * 2;
      size[i] = born[i];
      alpha[i] = 0;
    }
  }

  function poisson(rate, cap) {
    if (rate <= 0) return 0;
    const stop = Math.exp(-rate);
    let product = 1;
    let count = 0;
    while (product > stop && count <= cap) {
      product *= Math.random();
      count += 1;
    }
    return Math.min(cap, count - 1);
  }

  /* One particle from the board's continuous edge plume.

     `kind` is deliberately local to this function: 0 is the narrow granular
     cutting sheet, 1 a sparse piece of broken crust, 2 the fine mist that
     remains after the heavier snow has dropped, and 3 the rooster tail. They
     share a pool and update loop, but they do not share birth size, life,
     opacity or launch cone.

     THE ROOSTER TAIL is the one this file was missing, and its absence was
     the single least convincing thing about riding this mountain. Everything
     above is snow leaving the *edge*: a low granular sheet, some broken
     crust, and the mist those two leave behind — all of it correct, all of it
     within a board's width of the ground, and none of it the thing anybody
     has ever photographed a snowboard doing. What a carved turn actually
     throws is a curtain: the buried edge is a metre and a half of plough
     working through soft snow at thirty metres a second, and the snow it
     lifts comes off the *tail* of the board, goes up, and hangs there behind
     the rider in an arc that is taller than they are.

     Two things make it that rather than more of the sheet. It is launched
     with real upward speed instead of the sheet's eight centimetres of lift
     — and that speed is scaled by how fast the board is going, because the
     height of a rooster is a direct read of the energy going into the snow,
     which is why a slow turn barely raises dust and a committed one throws a
     wall. And it lives three times as long, so what is drawn is a continuous
     ribbon of snow behind the board rather than a puff at the contact point:
     at forty metres a second, half a second of life is twenty metres of
     tail.

     Every vector arrives as scalars. This is a hot path at speed and allocating
     temporary Vector3s here would turn a visually cheap point cloud into a
     source of garbage-collector hitches. */
  function edgeParticle(kind, x, y, z,
    bx, by, bz, tx, ty, tz, lx, ly, lz, nx, ny, nz,
    side, carve, skid, brake, chatter, speed) {
    const i = head;
    head = (head + 1) % n;
    const j = i * 3;
    const r0 = Math.random();
    const r1 = Math.random();
    const r2 = Math.random();
    const r3 = Math.random();
    const r4 = Math.random();

    /* A clean carve releases snow from the rear half of one buried edge. A
       transverse speed check works most of the board, so its source opens from
       a tail-biased 55 cm strip towards the full effective edge. */
    const alongSpan = lerp(0.55, 1.30, skid);
    const alongCentre = lerp(-0.43, -0.05, skid);
    // The rooster leaves from the last third of the buried edge, which is
    // where the plough has the most snow in front of it and nowhere left to
    // put it. The other three sample the whole working length.
    const along = kind === 3
      ? -0.62 + r0 * 0.42
      : alongCentre + (r0 - 0.5) * alongSpan;
    const across = (r1 - 0.5) * lerp(0.060, 0.15, skid);
    const bornLift = kind === 2
      ? 0.035 + r2 * 0.045
      : kind === 3 ? 0.05 + r2 * 0.10
        : 0.016 + r2 * 0.028;
    position[j] = x + bx * along + lx * across + nx * bornLift;
    position[j + 1] = y + by * along + ly * across + ny * bornLift;
    position[j + 2] = z + bz * along + lz * across + nz * bornLift;

    /* Snow retains only a small share of the board's travel. The rider then
       overtakes it, which is the physical source of the tail, while the edge
       impulse sends it outward and the terrain normal lifts it. A carve stays
       a coherent low sheet; wash and braking open that sheet into a broad,
       still-low rooster fan. */
    const carry = Math.min(3.0, speed * lerp(0.055, 0.025, skid));
    const fan = (r3 - 0.5) * lerp(0.45, 2.4, skid);
    // How hard the board is working the snow, which is what sets the height
    // of a rooster and nothing else here. It arrives late and saturates: no
    // tail worth the name below walking pace, all of it by seventy km/h.
    const drive = clamp01((speed - 6) / 15);
    let out;
    let lift;
    if (kind === 1) {
      out = 1.25 + carve * 1.0 + skid * 3.5 + r4 * (0.7 + skid * 1.2);
      lift = 0.48 + carve * 0.45 + skid * 1.2 + r2 * 0.70;
    } else if (kind === 2) {
      out = 0.38 + carve * 0.48 + skid * 1.15 + r4 * 0.50;
      lift = 0.32 + carve * 0.30 + skid * 0.62 + r2 * 0.36;
    } else if (kind === 3) {
      // Up first and out second: the curtain stands behind the rider rather
      // than being thrown sideways past them.
      out = (0.9 + carve * 1.5 + skid * 2.2 + r4 * 1.0) * (0.45 + drive * 0.75);
      lift = (3.0 + carve * 3.4 + skid * 2.4 + r2 * 2.0) * (0.35 + drive * 0.95);
    } else {
      out = 0.70 + carve * 1.65 + skid * 2.65 + r4 * (0.35 + skid * 0.75);
      lift = 0.20 + carve * 0.58 + skid * 0.82 + r2 * 0.38;
    }
    const outX = lx * side;
    const outY = ly * side;
    const outZ = lz * side;
    vel[j] = tx * carry + outX * out + bx * fan + nx * lift;
    vel[j + 1] = ty * carry + outY * out + by * fan + ny * lift;
    vel[j + 2] = tz * carry + outZ * out + bz * fan + nz * lift;

    if (kind === 1) {
      // Broken crust: small, heavy and short lived. Keeping it under 6 cm is
      // what prevents a close pass becoming the old soft white bubble.
      fine[i] = 0.02 + r1 * 0.13;
      maxLife[i] = 0.24 + r0 * 0.25 + skid * 0.15;
      born[i] = 0.028 + r2 * 0.031 + skid * 0.010;
      grow[i] = 0.04 + r3 * 0.10;
      peak[i] = 0.74 + r4 * 0.19;
      streak[i] = 0.42;
    } else if (kind === 2) {
      // Mist is the long, faint tail of the same displaced snow, not a second
      // snowfall. It starts tiny, hangs in the wind and never becomes opaque.
      fine[i] = 0.82 + r1 * 0.17;
      maxLife[i] = 0.52 + r0 * 0.43 + skid * 0.22;
      born[i] = 0.016 + r2 * 0.020 + skid * 0.005;
      grow[i] = 0.48 + r3 * 0.48;
      peak[i] = 0.09 + r4 * 0.09;
      streak[i] = 0.55 + skid * 0.45;
    } else if (kind === 3) {
      /* The curtain. Halfway between the sheet's hard grains and the mist's
         suspension, because that is what it is made of: snow lifted whole and
         breaking up on the way. It has to be light enough to hang — hence the
         high `fine`, which is what the update loop reads as weight — and
         opaque enough to read against a snowfield, which is the one number
         here that is a judgement rather than an observation. It swells a long
         way, so a dozen of them are a plume rather than a dozen dots. */
      fine[i] = 0.55 + r1 * 0.30;
      maxLife[i] = (0.44 + r0 * 0.40 + skid * 0.16) * (0.7 + drive * 0.5);
      born[i] = 0.038 + r2 * 0.046 + drive * 0.028;
      grow[i] = 0.70 + r3 * 0.85;
      peak[i] = 0.30 + r4 * 0.24 + drive * 0.14;
      streak[i] = 0.50 + skid * 0.30;
    } else {
      // The cutting sheet is granular snow: firmer than powder mist and much
      // smaller than a landing puff, with just enough life to draw the edge.
      fine[i] = 0.20 + r1 * 0.30;
      maxLife[i] = 0.18 + r0 * 0.18 + skid * 0.11;
      born[i] = 0.018 + r2 * 0.027 + skid * 0.008;
      grow[i] = 0.08 + r3 * 0.20;
      peak[i] = 0.38 + r4 * 0.20;
      streak[i] = 0.65 + skid * 0.35;
    }
    seed[i] = Math.random();
    tint[i] = 0;             // reclaim the slot from any earlier ember
    streakDirty = true;
    life[i] = maxLife[i];
    tumble[i] = (kind === 2 ? 1.1 : kind === 3 ? 0.9 : 0.45)
      + r2 * (kind === 2 ? 1.8 : kind === 3 ? 1.4 : 1.0) + chatter * 0.8;
    spin[i] = (2.4 + r3 * 4.0) * (r4 < 0.5 ? -1 : 1);
    phase[i] = r0 * Math.PI * 2;
    size[i] = born[i];
    alpha[i] = 0;
  }

  /* Continuous edge spray, sampled by the trail's fixed-distance commits.

     Signature is intentionally callback-shaped: `trail.update` can hand this
     function x/y/z and its already-interpolated section state directly. The
     state owns the true swept width, loaded/pushed side and slope basis, so the
     airborne snow and the mark underneath cannot disagree during a carve-to-
     brake transition. `rider` is used only to orient the physical board axis;
     travel remains authoritative for the plume's momentum. */
  function edgeSample(x, y, z, state, rider) {
    if (!state) return;

    const bite = clamp01(state.bite || 0);
    const wash = clamp01(state.wash || 0);
    const brake = clamp01(state.brake || 0);
    const load = clamp01((state.load || 0) / 1.15);
    const chatter = clamp01(state.chatter || 0);
    const carve = clamp01(bite * (0.38 + load * 0.62) * (1 - wash * 0.52));
    const skid = clamp01(Math.max(wash, brake * 0.92) * (0.58 + load * 0.42));
    const activity = Math.max(carve, skid, chatter * Math.max(carve, skid));
    if (activity < 0.025) {
      // Straight base glide should be almost clean.
      return;
    }

    let lx = state.latX || 0;
    let ly = state.latY || 0;
    let lz = state.latZ || 0;
    let len = Math.hypot(lx, ly, lz) || 1;
    lx /= len; ly /= len; lz /= len;
    let nx = state.normalX || 0;
    let ny = state.normalY || 1;
    let nz = state.normalZ || 0;
    len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let tx = state.travelX || 0;
    let ty = state.travelY || 0;
    let tz = state.travelZ || 0;
    const speed = Math.hypot(tx, ty, tz);
    len = speed || 1;
    tx /= len; ty /= len; tz /= len;

    /* Point the board axis towards its actually-leading end. `boardForward`
       changes sign for switch travel; the final dot check also covers a brief
       skid where the board and velocity disagree around an edge transition. */
    let bx = rider?.heading?.x ?? tx;
    let by = rider?.heading?.y ?? ty;
    let bz = rider?.heading?.z ?? tz;
    // Rider heading is primarily an x/z gameplay direction. Project it onto
    // the actual snow plane before walking back towards the tail; otherwise
    // a tail point placed uphill keeps the centre's y and vanishes under a
    // steep slope before the first particle frame is drawn.
    const boardIntoSurface = bx * nx + by * ny + bz * nz;
    bx -= nx * boardIntoSurface;
    by -= ny * boardIntoSurface;
    bz -= nz * boardIntoSurface;
    const stance = Number.isFinite(rider?.boardForward) && rider.boardForward < 0 ? -1 : 1;
    bx *= stance; by *= stance; bz *= stance;
    len = Math.hypot(bx, by, bz) || 1;
    bx /= len; by /= len; bz /= len;
    if (bx * tx + by * ty + bz * tz < 0) {
      bx = -bx; by = -by; bz = -bz;
    }

    let side = Math.sign(state.bias || 0);
    if (!side && rider) side = Math.sign(rider.edge || rider.lateral || rider.brakeSide || 0);
    if (!side) side = edgeWander < 0 ? -1 : 1;

    /* In the trail section, `contactShift` moves the carrier so its buried
       groove lies on rider.pos. The groove radius is half·1.36·.735, within
       four ten-thousandths of half, so this exact board/swept-half expression
       reaches the same edge without importing trail.js and creating a cycle. */
    const edgeOffset = (state.contactShift || 0) + side * (state.half || 0.155);
    edgeWander = Math.max(-1, Math.min(1,
      edgeWander * 0.80 + (Math.random() * 2 - 1) * 0.17));
    const sourceWander = edgeWander * (0.008 + skid * 0.040);
    // Into the anchor's frame here, once, so `edgeParticle` stays a pure
    // scalar hot path that never needs to know the anchor exists.
    const sx = x - anchor.x + lx * (edgeOffset + sourceWander) + nx * 0.012;
    const sy = y - anchor.y + ly * (edgeOffset + sourceWander) + ny * 0.012;
    const sz = z - anchor.z + lz * (edgeOffset + sourceWander) + nz * 0.012;

    /* Counts per committed section. Poisson sampling keeps the expected mass
       constant per metre while removing the breadcrumb rhythm that a rounded
       carry can reveal in a long, steady carve. */
    const grains = poisson(
      carve * 0.05 + skid * 3.25 + chatter * activity * 0.60, 8,
    );
    const mists = poisson(
      carve * 3.00 + skid * (0.90 + brake * 0.72)
        + chatter * activity * 0.16, 4,
    );
    const chunks = poisson(
      skid * (0.035 + brake * 0.16 + chatter * 0.10)
        + carve * chatter * 0.035, 2,
    );
    /* And the curtain, which is the only one of the four whose *rate* is a
       function of speed rather than only its shape. Every other count here is
       per committed section, and sections arrive at a fixed spatial interval
       — so a fast rider already gets proportionally more of everything for
       free. A rooster is not proportional: a board at sixty km/h moves several
       times as much snow per metre as the same board at fifteen, because what
       it is doing to the snow goes as the energy and not as the distance. So
       the drive term rides on top of the spatial rate rather than replacing
       it, and the plume grows with the run rather than merely lengthening. */
    const drive = clamp01((speed - 6) / 15);
    const tails = poisson(
      drive * (carve * 3.7 + skid * 2.3 + chatter * activity * 0.45), 9,
    );

    for (let k = 0; k < grains; k++) {
      edgeParticle(0, sx, sy, sz, bx, by, bz, tx, ty, tz,
        lx, ly, lz, nx, ny, nz, side, carve, skid, brake, chatter, speed);
    }
    for (let k = 0; k < chunks; k++) {
      edgeParticle(1, sx, sy, sz, bx, by, bz, tx, ty, tz,
        lx, ly, lz, nx, ny, nz, side, carve, skid, brake, chatter, speed);
    }
    for (let k = 0; k < mists; k++) {
      edgeParticle(2, sx, sy, sz, bx, by, bz, tx, ty, tz,
        lx, ly, lz, nx, ny, nz, side, carve, skid, brake, chatter, speed);
    }
    for (let k = 0; k < tails; k++) {
      edgeParticle(3, sx, sy, sz, bx, by, bz, tx, ty, tz,
        lx, ly, lz, nx, ny, nz, side, carve, skid, brake, chatter, speed);
    }
  }

  function update(dt, camera, wind) {
    // The anchor step — see `snapAnchor`. Dead slots are shifted too, so a
    // recycled slot never carries a stale frame's coordinates.
    const oax = anchor.x;
    const oay = anchor.y;
    const oaz = anchor.z;
    if (snapAnchor(anchor, camera.position)) {
      cloud.points.position.copy(anchor);
      const dx = anchor.x - oax;
      const dy = anchor.y - oay;
      const dz = anchor.z - oaz;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        position[j] -= dx;
        position[j + 1] -= dy;
        position[j + 2] -= dz;
      }
      geo.attributes.position.needsUpdate = true;
    }
    const wx = wind ? wind.x : 0;
    const wz = wind ? wind.z : 0;
    const camVel = track(camera, dt);
    // The pool is usually mostly, and often entirely, dead — a rider gliding
    // flat on a clear day throws nothing for minutes at a time. Counting the
    // living as we pass lets the upload at the bottom stay home when nothing
    // in the buffer changed, instead of shipping nine hundred stationary
    // corpses to the GPU every frame.
    let live = 0;
    let snuffed = false;
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) {
        if (alpha[i] !== 0) { alpha[i] = 0; snuffed = true; }
        continue;
      }
      live += 1;
      const j = i * 3;
      life[i] -= dt;
      const f = fine[i];
      const age = maxLife[i] - life[i];

      // Weight. Dust is mostly air and barely falls; a chunk of crust falls
      // at very nearly the rate the rider does.
      vel[j + 1] -= (3.4 + (1 - f) * 9.6) * dt;

      // Lateral tumble: a slow swing that turns as the particle ages, so a
      // rooster tail frays outwards instead of staying a clean cone
      const a = phase[i] + age * spin[i];
      vel[j] += Math.cos(a) * tumble[i] * dt;
      vel[j + 2] += Math.sin(a) * tumble[i] * dt;

      /* Drag, and the one line that changed the whole look of this.

         Powder is mostly air: it slows fast, which is what makes it read as
         snow rather than as gravel. It used to slow towards *nothing*, which
         quietly claimed the air was still — so a plume hung exactly where it
         was thrown, in a game with a wind vector that is already blowing the
         snowfall sideways. Now the horizontal velocity decays towards the
         wind instead, and the plume drifts off down the mountain with
         everything else in the sky. */
      const k = Math.exp(-(1.7 + f * 2.3) * dt);
      vel[j] = wx + (vel[j] - wx) * k;
      vel[j + 1] *= k;
      vel[j + 2] = wz + (vel[j + 2] - wz) * k;

      position[j] += vel[j] * dt;
      position[j + 1] += vel[j + 1] * dt;
      position[j + 2] += vel[j + 2] * dt;

      // A puff disperses: it swells as it fades, which is the whole reason
      // half a dozen particles read as a cloud rather than as half a dozen
      // particles
      const t = Math.max(0, life[i]) / maxLife[i];
      size[i] = born[i] * (1 + grow[i] * (1 - t));
      // Fading in over the first breath of its life stops a burst arriving
      // as a wall of hard dots on the frame it was fired
      const rise = Math.min(1, age * 14);
      alpha[i] = rise * t * t * peak[i];
    }
    if (live > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
    }
    // A particle's dying frame writes one last zero into the alpha table
    // after its life has gone, so the alpha travels once more than the rest.
    if (live > 0 || snuffed) geo.attributes.aAlpha.needsUpdate = true;
    if (streakDirty) {
      geo.attributes.aStreak.needsUpdate = true;
      geo.attributes.aSeed.needsUpdate = true;
      // The tint changes exactly when a slot is recycled, which is exactly
      // when the streak does — one dirty flag serves all three.
      geo.attributes.aTint.needsUpdate = true;
      streakDirty = false;
    }

    sprayTime = (sprayTime + dt) % 512;
    uniforms.uTime.value = sprayTime;
    readAir(uniforms);
    applyLimits(uniforms, camera, SPRAY.wide, SPRAY.long);
    uniforms.uDepthFade.value.set(SPRAY.fade[0], SPRAY.fade[1]);
    uniforms.uExposure.value = SPRAY.exposure;
    /* Powder is left in the world and the rider is not, so what smears it is
       almost entirely the camera going past. A particle's own velocity is
       not in here — it would be another buffer uploaded every frame to say
       something the drag has already taken out of it inside a third of a
       second — and the wind is, because that is what the drag leaves. */
    flow.set(wx - camVel.x, -camVel.y, wz - camVel.z);
    uniforms.uFlow.value.copy(flow);
  }

  function clear() {
    for (let i = 0; i < n; i++) { life[i] = 0; alpha[i] = 0; }
    edgeWander = 0;
    geo.attributes.aAlpha.needsUpdate = true;
  }

  /* The stomp ring: crust thrown outwards in a circle from a landing heavy
     enough to have properly broken the surface. Every per-particle field the
     update loop reads is written here — this emitter used to leave `born`,
     `grow`, `peak`, `tumble`, `spin`, `phase` and `alpha` to whatever the
     slot's previous occupant left behind, so a stomp inherited mist's near-
     invisible opacity or a spark's blowout at random, and the recycled dot
     kept its old alpha for one frame at the new position — a visible
     teleport. (Its size also read `SPRAY.lumpScale`, a config field that
     does not exist.) */
  function radialBurst(pos, count) {
    for (let k = 0; k < count; k++) {
      const i = head;
      head = (head + 1) % n;
      const j = i * 3;
      const f = Math.random() * 0.6; // mostly chunky
      fine[i] = f;
      streak[i] = SPRAY.streak;
      seed[i] = Math.random();
      tint[i] = 0;
      streakDirty = true;

      const angle = Math.random() * Math.PI * 2;
      const r = 0.5 + Math.random() * 1.5;
      const vx = Math.cos(angle);
      const vz = Math.sin(angle);

      position[j] = pos.x - anchor.x + vx * r;
      position[j + 1] = pos.y - anchor.y + 0.1 + Math.random() * 0.3;
      position[j + 2] = pos.z - anchor.z + vz * r;

      const power = 2.0 + Math.random() * 2.5;
      vel[j] = vx * power;
      vel[j + 1] = 2.0 + Math.random() * 3.0; // shoot up
      vel[j + 2] = vz * power;

      maxLife[i] = SNOW.sprayLife * (0.5 + Math.random() * 0.6) * (1 + f * 0.5);
      life[i] = maxLife[i];
      born[i] = SNOW.spraySize * SPRAY.born * (0.5 + Math.random() * 0.9)
        * (1 - SPRAY.fineSmall * f);
      grow[i] = lerp(SPRAY.grow[0], SPRAY.grow[1], f);
      peak[i] = 0.92 - f * 0.3;
      tumble[i] = (0.7 + Math.random() * 2.4) * (0.35 + f);
      spin[i] = (2 + Math.random() * 5) * (Math.random() < 0.5 ? -1 : 1);
      phase[i] = Math.random() * Math.PI * 2;
      size[i] = born[i];
      alpha[i] = 0;
    }
  }

  /* The overdrive embers at max combo — the one emitter allowed off the
     snow palette, via the negative tint the fragment shader folds towards
     its ember colour. Peak stays at one: brightness above that flattened
     the falloff into an opaque disc with a hard rim, which is the exact
     soap-bubble artefact the header of this file exists to forbid. */
  function sparks(pos, dirX, dirZ, count) {
    for (let k = 0; k < count; k++) {
      const i = head;
      head = (head + 1) % n;
      const j = i * 3;
      fine[i] = 1.0;
      streak[i] = 1.0;
      seed[i] = Math.random();
      tint[i] = -1.0;
      streakDirty = true;

      const angle = Math.random() * Math.PI * 2;
      const vx = dirX + Math.cos(angle) * 1.5;
      const vz = dirZ + Math.sin(angle) * 1.5;

      position[j] = pos.x - anchor.x + Math.random() - 0.5;
      position[j + 1] = pos.y - anchor.y + 0.1;
      position[j + 2] = pos.z - anchor.z + Math.random() - 0.5;

      vel[j] = vx * 4.0;
      vel[j + 1] = 4.0 + Math.random() * 4.0;
      vel[j + 2] = vz * 4.0;

      maxLife[i] = 0.5 + Math.random() * 0.5;
      life[i] = maxLife[i];
      born[i] = SNOW.spraySize * SPRAY.born * 0.55;
      grow[i] = 0.5;
      peak[i] = 1.0;
      tumble[i] = 0.6 + Math.random() * 1.2;
      spin[i] = (2 + Math.random() * 4) * (Math.random() < 0.5 ? -1 : 1);
      phase[i] = Math.random() * Math.PI * 2;
      size[i] = born[i];
      alpha[i] = 0;
    }
  }

  return { points: cloud.points, burst, radialBurst, sparks, edgeSample, update, clear };
}

/* ==========================================================================
   Streaks — the air itself, once there is enough of it going past
   ========================================================================== */

/* Every streak is the same shape pointing the same way — back along the
   direction of travel, by a length set by the speed — so the direction and
   the length are a uniform and not an attribute, and the only things that
   move per frame are the anchor points and their alphas.

   The width is held in pixels rather than metres. A ribbon whose thickness
   is fixed in the world is a dash near the lens and a hairline twenty metres
   out, and the far ones are most of the field; a constant few pixels is what
   the chunky low-resolution line was giving for free, and it is what the eye
   reads as motion blur rather than as damage to the screen. The conversion
   is `pointScale` run backwards, so the ribbons and the powder agree about
   what a pixel is worth at a given distance. */
const S_VERT = `
  attribute float aEnd;
  attribute float aSide;
  attribute float aAlpha;
  uniform vec3 uDir;
  uniform float uWidth;
  uniform float uScale;
  varying float vAlpha;
  varying float vDepth;
  varying float vSide;
  varying float vEnd;
  void main() {
    vAlpha = aAlpha;
    vSide = aSide;
    vEnd = aEnd;
    vec4 mv = modelViewMatrix * vec4(position + uDir * aEnd, 1.0);
    vDepth = -mv.z;
    vec3 axis = (modelViewMatrix * vec4(uDir, 0.0)).xyz;
    vec3 side = cross(axis, mv.xyz);
    float l = length(side);
    // A streak aimed straight at the eye has no side to speak of; it also
    // has no length on screen, so which way it is widened cannot matter
    side = l > 1e-5 ? side / l : vec3(1.0, 0.0, 0.0);
    // Tapered towards the tail: a smear of air is widest where the air is
    // and thins to where it has been, and a constant-width bar reads as a
    // scratch on the lens rather than as motion.
    mv.xyz += side * (aSide * 0.5 * uWidth * (1.0 - aEnd * 0.55)
      * vDepth / max(uScale, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const S_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vDepth;
  varying float vSide;
  varying float vEnd;
  void main() {
    if (vAlpha <= 0.002) discard;
    // Soft across the width and fading along the length: the head of a
    // streak is where the air is, the tail is where it has already been
    float across = 1.0 - vSide * vSide;
    float along = 1.0 - vEnd * vEnd;
    float near = smoothstep(1.4, 5.5, vDepth);
    float far = 1.0 - smoothstep(28.0, 72.0, vDepth);
    gl_FragColor = vec4(uColor, vAlpha * across * along * near * far);
  }
`;

export function createStreaks(THREE) {
  const n = STREAKS.count;
  const geo = new THREE.BufferGeometry();
  const position = new Float32Array(n * 12);   // four corners a streak
  const alpha = new Float32Array(n * 4);
  const end = new Float32Array(n * 4);
  const side = new Float32Array(n * 4);
  const index = new Uint16Array(n * 6);
  const home = new Float32Array(n * 3);
  const age = new Float32Array(n);
  const radial = new Float32Array(n);   // where in the disc it sits, 0 at the axis
  const jitter = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const v = i * 4;
    end[v] = 0; end[v + 1] = 0; end[v + 2] = 1; end[v + 3] = 1;
    side[v] = -1; side[v + 1] = 1; side[v + 2] = 1; side[v + 3] = -1;
    const q = i * 6;
    index[q] = v; index[q + 1] = v + 1; index[q + 2] = v + 2;
    index[q + 3] = v; index[q + 4] = v + 2; index[q + 5] = v + 3;
    jitter[i] = 0.55 + Math.random() * 0.7;
  }

  // The corners move only when a streak is re-homed; the alphas move every
  // frame the field is alive. The ends, sides and index never move at all.
  geo.setAttribute('position',
    new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha',
    new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(SKY.haze) },
      uDir: { value: new THREE.Vector3(0, 0, 1) },
      uWidth: { value: 2 },
      uScale: { value: 300 },
    },
    vertexShader: S_VERT,
    fragmentShader: S_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  /* Kept under the name it had. It is a Mesh now rather than LineSegments,
     but it is still the one thing `main.js` adds to the scene and renaming
     it would buy nothing but a broken import. */
  const lines = new THREE.Mesh(geo, material);
  lines.frustumCulled = false;

  const fwd = new THREE.Vector3();
  const rgt = new THREE.Vector3();
  const up = new THREE.Vector3();
  // The rebase frame — see `snapAnchor`. `home` and the corner positions
  // are anchor-relative; `cl` is the camera brought into the same frame.
  const anchor = new THREE.Vector3(0, 0, 0);
  const cl = new THREE.Vector3();
  let placed = false;
  let posDirty = false;
  let idle = false;

  /* A streak is a fixed point in the world with a ribbon drawn back along the
     direction of travel. It does not move — the rider passes it — which is
     exactly why it reads as speed rather than as weather. And because it does
     not move, its four corners are written here, once, when it is homed:
     between respawns the vertex buffer has nothing new to say and the
     per-frame loop below no longer repeats it. */
  function respawn(i) {
    const a = Math.random() * Math.PI * 2;
    const f = Math.sqrt(0.05 + Math.random() * 0.95);
    const r = STREAKS.radius * f;
    const d = 4 + Math.random() * STREAKS.ahead;
    const j = i * 3;
    home[j] = cl.x + fwd.x * d + rgt.x * Math.cos(a) * r + up.x * Math.sin(a) * r;
    home[j + 1] = cl.y + fwd.y * d + rgt.y * Math.cos(a) * r + up.y * Math.sin(a) * r;
    home[j + 2] = cl.z + fwd.z * d + rgt.z * Math.cos(a) * r + up.z * Math.sin(a) * r;
    for (let c = 0; c < 4; c++) {
      const k = (i * 4 + c) * 3;
      position[k] = home[j];
      position[k + 1] = home[j + 1];
      position[k + 2] = home[j + 2];
    }
    posDirty = true;
    radial[i] = f;
    age[i] = 0;
  }

  // Blanked streaks are also aged back to nothing, so a field that thins out
  // and thickens again fades its streaks in rather than snapping them on
  const blank = (i) => {
    const v = i * 4;
    alpha[v] = 0; alpha[v + 1] = 0; alpha[v + 2] = 0; alpha[v + 3] = 0;
    age[i] = 0;
  };

  function update(dt, camera, velocity, speed, wind) {
    // The anchor step — see `snapAnchor`.
    const oax = anchor.x;
    const oay = anchor.y;
    const oaz = anchor.z;
    if (snapAnchor(anchor, camera.position)) {
      lines.position.copy(anchor);
      const dx = anchor.x - oax;
      const dy = anchor.y - oay;
      const dz = anchor.z - oaz;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        home[j] -= dx;
        home[j + 1] -= dy;
        home[j + 2] -= dz;
      }
      for (let k = 0; k < n * 12; k += 3) {
        position[k] -= dx;
        position[k + 1] -= dy;
        position[k + 2] -= dz;
      }
      posDirty = true;
    }
    cl.copy(camera.position).sub(anchor);
    camera.getWorldDirection(fwd);
    up.set(0, 1, 0);
    rgt.crossVectors(fwd, up).normalize();
    up.crossVectors(rgt, fwd).normalize();

    const t = Math.min(1, Math.max(0, (speed - STREAKS.from) / (STREAKS.full - STREAKS.from)));
    const active = Math.round(n * t * t);
    // Density reaches full strength at `STREAKS.full`; line length may keep
    // communicating more speed, but it cannot grow all the way to the W cap
    // forever or each streak eventually becomes a screen-filling white bar.
    const len = Math.min(STREAKS.maxLength, speed * STREAKS.length);

    /* The streak is a picture of the air going past, and the air is not
       still: the same wind that leans the snowfall sideways leans these. A
       fifth of the wind folded into the apparent travel is enough for the
       two systems to agree about which way the weather is blowing without
       letting a gale bend a streak further than the rider's own speed
       justifies. */
    let rx = velocity.x - (wind ? wind.x * 0.2 : 0);
    let ry = velocity.y - (wind ? wind.y * 0.2 : 0);
    let rz = velocity.z - (wind ? wind.z * 0.2 : 0);
    const inv = 1 / (Math.sqrt(rx * rx + ry * ry + rz * rz) || 1);
    rx *= inv; ry *= inv; rz *= inv;
    material.uniforms.uDir.value.set(-rx * len, -ry * len, -rz * len);
    // Thin when the field first appears, and never more than about three
    // pixels — past that they stop being air and start being bars. The three
    // pixels are of the 288-line buffer this was authored on, scaled to the
    // buffer actually in use: held at a literal count, the ribbons were a
    // third of the intended width on a 4K frame — the same sub-pixel
    // hairline failure `WEATHER.wide` was already converted away from.
    material.uniforms.uWidth.value = (1.4 + t * 1.9)
      * Math.max(1, RENDER.buffer.height / 288);
    material.uniforms.uScale.value = pointScale(camera);
    /* And they are the colour of the air rather than white.

       These are not snow — they are the suggestion of air going past — but
       they are drawn over a snowfield in whatever light the hour is giving,
       and a fixed white put a sheet of noon across a dusk. They have no fog
       term of their own, so the haze arrives second-hand, from whichever of
       the point clouds last read it out of the uniform `main.js` writes. */
    material.uniforms.uColor.value.setRGB(
      Math.min(0.86, AIR.r * 1.3),
      Math.min(0.90, AIR.g * 1.3),
      Math.min(1.0, AIR.b * 1.3),
    );

    if (!placed) {
      placed = true;
      for (let i = 0; i < n; i++) respawn(i);
    }

    /* Below streaking speed there is nothing to age, nothing to fade and
       nothing to re-home — one blanking pass zeroes the alphas, and after
       that the field is asleep until the speed comes back. Most of a run is
       spent below the threshold, so most frames skip the loop and both
       uploads entirely. */
    if (active === 0 && idle) {
      if (posDirty) {
        geo.attributes.position.needsUpdate = true;
        posDirty = false;
      }
      return;
    }
    idle = active === 0;

    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (i >= active) {
        blank(i);
        continue;
      }
      // Behind the camera, or too far off to one side: put it back in front
      const dx = home[j] - cl.x;
      const dy = home[j + 1] - cl.y;
      const dz = home[j + 2] - cl.z;
      const along = dx * fwd.x + dy * fwd.y + dz * fwd.z;
      if (along < -2 || along > STREAKS.ahead + 30 || (dx * dx + dy * dy + dz * dz) > 4900) {
        respawn(i);
        blank(i);
        continue;
      }
      age[i] += dt;
      /* Three things hold the field back from being a white cage.

         It fades in over a tenth of a second, because a streak that appears
         at full strength four metres in front of the lens is a flash.

         It is dimmer near the axis of travel than at the edge of the disc,
         which is what real motion blur does — nothing moves at the vanishing
         point — and it is what keeps the middle of the frame, the part the
         player is actually reading, clear.

         And every streak has its own brightness, so the field has depth in
         it rather than being one flat sheet of identical marks. */
      const a = 0.30 * t * jitter[i]
        * (0.3 + 0.7 * radial[i])
        * Math.min(1, age[i] * 9);
      const v = i * 4;
      alpha[v] = a; alpha[v + 1] = a; alpha[v + 2] = a; alpha[v + 3] = a;
    }

    if (posDirty) {
      geo.attributes.position.needsUpdate = true;
      posDirty = false;
    }
    geo.attributes.aAlpha.needsUpdate = true;
  }

  return { lines, update };
}
