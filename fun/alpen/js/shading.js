/* The console, as four patches on every material in the world.

   Four effects, and between them they are most of why the picture reads as
   1996 rather than as a modern engine with the saturation turned up. All of
   them are grafted onto three's own materials with `onBeforeCompile` rather
   than replacing them, and that decision is worth defending: a hand-written
   `ShaderMaterial` would have to reimplement the light loop, vertex colours,
   instancing and flat shading before it drew a single facet, and every one of
   those is already correct. What is wanted here is not a different renderer.
   It is four specific lies told inside the one there is.

   VERTEX SNAPPING. The console transformed vertices into a fixed-point screen
   space and had no fractional pixels left over to put them between, so
   everything on screen moved in whole pixels and geometry seen edge-on
   visibly swam. It is the single most imitated thing about the era and the
   single most often got wrong, in two ways that were both tried here first.
   Rounding the vertex in world space snaps it to a grid of metres, which is
   invisible at four hundred metres and shakes a model apart at four. Rounding
   `gl_Position.xy` where it stands, without the perspective divide, is worse
   and more tempting, because it looks right on anything near the camera: a
   grid of g in clip space is a grid of g/w in NDC, so the further away a
   vertex is the *finer* it snaps, and the wobble quietly disappears from
   exactly the geometry the effect exists for.

   The real thing is done after the projection, in NDC, and scaled back out by
   w — so a vertex snaps to the pixel grid it will actually be rasterised on.
   A facet four hundred metres away then swims by whole metres and the same
   facet at ten metres swims by centimetres, which is not an approximation of
   what the hardware did, it is what the hardware did.

   X and Y only. Snapping Z quantises the depth buffer as well, and two
   coplanar facets that land on the same rung z-fight against each other for
   the rest of the frame — the hill flickers, and it flickers worst where the
   ground is flattest.

   And nothing very close to the lens is snapped at all. This is the one place
   the imitation has to be cheated, because the amplitude of the wobble is
   fixed in *pixels* and the rider's own model is two hundred pixels tall: a
   one-pixel step is invisible on a ridge and is a limb changing length on a
   body. Hence a per-material strength — the rider gets a third of it and the
   scenery gets all of it — and a global fade over the first few metres, so a
   tree you are about to hit does not start vibrating as it fills the frame.

   QUANTISED DIFFUSE. Gouraud-era hardware interpolated a handful of light
   levels rather than evaluating a falloff, and the banding that came out of
   it is more of the era's signature than the polygon count is. Five bands,
   the top one reaching full and the bottom one reaching nothing, so the fill
   light is the only thing holding the dark side of anything.

   Imposing that turned out to be the awkward part. The obvious move is to
   rewrite `lights_lambert_pars_fragment` and step `dotNL` at source, and it
   was written that way first — but `onBeforeCompile` is handed the shader
   with its `#include`s still unresolved, so the only text there is to match
   on is the include line itself, and replacing a whole chunk of three's
   lighting means owning a copy of it that goes stale the next time three
   renames a parameter. What is here instead does not touch the light loop at
   all: it waits until the loop has finished, works out what `dotNL` must have
   been from the same normal and the same sun the loop used, and rescales the
   accumulated direct diffuse by the ratio of the banded value to the smooth
   one. There is exactly one directional light on this mountain, so that
   rescale is not an approximation — it is the same number the loop would have
   produced had it been stepped, arrived at from the other end.

   SNOW IS NOT MATTE. Every lit material here is Lambert, which is to say
   pure diffuse, which is to say the hill reflected light equally in every
   direction and read as paper. Snow does not do that. It is a mass of ice
   crystals with real faces on them, so it has a genuine specular response:
   a broad sheen that slides across the slope as you ride, a glow where the
   sun is behind a ridge and comes through the top few centimetres of it, and
   a grazing-angle brightening that on a mountain seen down its own fall line
   covers most of the picture. Three terms, opted into per material through
   `opts.sheen`, because snow is the only surface here with any business
   being shiny — the trees and the huts are still paper and should be.

   Two decisions inside it are the interesting ones.

   The specular is deliberately not banded, and it sits in the same block as
   the banding rather than in front of it. Five rungs of diffuse with a smooth
   highlight laid over them is the combination the era arrived at the moment
   it had a highlight at all, and it is also the only arrangement that works
   here: quantise a specular and every contour of the lobe becomes a hard ring
   sliding across the hill. The banding is the art direction. The sheen is the
   thing that says the surface is crystalline, and what it says it with is
   motion.

   And it is gated by a shadow term recovered rather than resampled. A sheen
   that ignores shadows puts a highlight inside every tree's shadow and the
   shadow stops reading as one. The honest fix is a second `getShadow` call,
   which is a second soft PCF tap pattern per pixel over most of the screen,
   and it was rejected on cost alone. What is here instead divides what the
   light loop actually delivered by what it would have delivered unshadowed —
   both in luminance, both already known — and what falls out is the shadow
   factor the loop used, for two dots and a divide. Its failure mode is
   graceful in the only direction that matters: get the sun's own radiance
   wrong and the ratio clamps at one, which is a highlight that has stopped
   noticing shadows rather than a hill with holes punched in it.

   SKY-COLOURED FOG. Three's fog resolves towards one colour, and one colour
   is a grey wall: a ridge to the west and a ridge to the east dissolve into
   the same paint, at the exact hour when the west is on fire and the east is
   already blue. This one resolves towards what the backdrop actually shows in
   the fragment's own view direction, which means the shading has to know the
   sky's own gradient — so `n64Sky` below is `sky.js`'s dome shader,
   transcribed. That duplication is deliberate and it is the reason the block
   of uniforms exists: both ends read the same numbers out of the weather every
   frame, so the only way they can disagree is if somebody edits one function
   and not the other, and the comment in both places says so.

   One stop is deliberately not the dome's. Below the skyline what the eye is
   given is not sky at all, it is the haze curtain and the ranges standing on
   it — both painted in `weather.haze` — so the bottom stop here is the haze
   and it lifts to the dome's own horizon over the first few degrees of sky.
   Get that wrong and there is a hard horizontal seam across the picture where
   the terrain mesh runs out and the curtain takes over.

   The depth is radial rather than along the view axis, which three's is. At
   sixty-two degrees of field that is a two per cent difference and nobody
   would ever have noticed; the frame opens to eighty-six at speed, and at
   eighty-six the corners of the screen are a third further from the camera
   than the plane depth claims, so the curtain visibly bulged towards the
   middle of the frame every time the rider tucked. */

import { RENDER, BASE_WIDTH, BASE_HEIGHT } from './config.js';

/* The snap, in the four numbers that decide what it looks like.

   `cell` is how many framebuffer pixels wide a grid cell is, and it is one
   for the same reason the buffer is 640×360: the grid the console snapped to
   was the grid it drew on. Two was tried, on the theory that the wobble
   wanted to be louder, and it is — it is louder than the geometry, and a hill
   whose facets are visibly swimming faster than the rider is moving reads as
   a bug rather than as hardware.

   `near` and `full` are the metres over which snapping comes on. Below `near`
   nothing is snapped; the division by w in there is also why — a vertex on
   the near plane has a w near zero and an NDC in the thousands, and flooring
   that is arithmetic nobody wants in a vertex shader. */
export const SNAP = {
  cell: 1,
  near: 1.5,
  full: 5.0,
  /* …and where it goes away again. Half a pixel of error is centimetres at
     five metres and metres at three hundred, so past `fade` the snap is worth
     less than the flicker it costs, and by `gone` there is none of it left.
     See the note in VERT_SNAP. */
  fade: 45.0,
  gone: 120.0,
  scenery: 1.0,
  rider: 0.3,
};

/* Five, which is about the most a snowfield will take. Snow is one colour
   over most of the screen, so every band is a contour line drawn right across
   the picture: at eight the hill reads as a topographic map, and at three it
   reads as a mistake. The bands run 0, ¼, ½, ¾, 1 — the bottom one is
   genuinely black in direct light, and everything visible on the dark side of
   a tree is the hemisphere fill doing its job. */
export const BANDS = 5;

/* Snow as a material, in the five numbers that shape its highlight.

   `gloss` is the Blinn exponent and it is low on purpose. A tight lobe is
   what a wet or polished surface has; a snowfield's crystals lie at every
   angle, so the mirror direction is smeared over tens of degrees and what
   comes out is the glare path you actually see walking towards a low sun over
   snow — a broad wedge of light lying on the ground and pointing at the sun,
   not a spot. There is a second reason to keep it wide, and it is the flat
   shading: the normal is constant across a facet, so a tight lobe means
   neighbouring facets take wildly different values and the hill breaks into a
   mosaic that flickers as the sun moves.

   Thirteen and eight were both measured, on a frozen frame with the sheen
   toggled, and they put light in very nearly the same places — which is worth
   recording, because it says the exponent is not what is shaping this. The
   geometry is. A rider on a piste is looking almost along the ground, so the
   half-vector sits far off the normal nearly everywhere and the lobe only
   opens up on facets tilted towards the mirror direction; that is why the
   sheen arrives as a path across the middle distance rather than as a wash,
   and why it is worth having at all. Eight, because between two numbers that
   measure the same it should be the one that matches the material.

   `strength` is the reflectance at normal incidence, and it is the number the
   whole thing lives or dies by. This is a five-bit picture with a highlight
   shoulder and a bloom threshold at 0.78, so a specular that reaches the top
   of the scale does not clip gracefully — it quantises into rings and blooms
   them. Lit snow already sits at about 0.84 in linear light before any of
   this; a sixth of the sun on top of that lands inside the shoulder's roll-
   off, which is exactly where it should be arriving.

   `fresnel` is the grazing term, and it is a separate number rather than a
   Schlick ramp on `strength` because it is a different thing being seen. The
   lobe is the sun; this is the sky, and it is tinted with the sky because
   that is what a grazing surface is showing you. It is also why the snow goes
   blue at the far end of the slope rather than white — the dome up there is
   navy, and the rule on this mountain is that the only thing allowed to make
   snow warm is a low sun.

   `wrap` and `wrapGain` are the forward scatter: how far round the terminator
   light bleeds, and how much of it arrives. Snow is deep and translucent for
   a few centimetres, so a ridge with the sun behind it is lit through rather
   than merely silhouetted. Gated on looking towards the sun, which is what
   makes it a rim on the ridge in front of you and not a general lift on
   everything facing away. */
export const SHEEN = {
  gloss: 8,
  strength: 0.16,
  fresnel: 0.11,
  wrap: 0.5,
  wrapGain: 0.1,
};

/* Rec. 709, and it is used for three different jobs below — how bright the
   albedo is, how much light arrived, and how bright the lamp is. All three
   are ratios against each other, so the only thing that matters is that they
   are all measured with the same ruler. */
const LUMA = 'vec3(0.2126, 0.7152, 0.0722)';

/* Where a material stops being snow. The two stops are luminances of the
   albedo, and they sit either side of the gap between this mountain's rock
   and its snow: glacial shade is about 0.48 in linear light, sunlit rock
   about 0.21. Using brightness as the test for "is this snow" looks like a
   hack and is not quite one — the terrain has exactly two materials in it,
   they are separated by a factor of four, and they are already blended into
   each other per vertex, so the sheen fades out across the same gradient the
   rock fades in on instead of stopping at an edge that does not exist. */
const SNOW_LO = 0.22;
const SNOW_HI = 0.42;

/* How much of the top of each band rolls smoothly into the next, as a
   fraction of the band. It wants to be nearly nothing — the whole point is a
   hard step — but not actually nothing: flat shading takes its normal from
   screen-space derivatives, so exactly on the boundary between two facets the
   normal is a blend of both, and with an infinitely hard step that one-pixel
   seam sparkles as a line of the wrong band. */
const BAND_EDGE = 0.06;

// Baking a JS constant into the shader source rather than sending it as a
// uniform: these never change at runtime, and a literal is one less uniform
// for every material in the world to carry
const asFloat = (n) => n.toFixed(4);

const VERT_PARS = `
varying vec3 vN64View;
uniform vec2 uSnapGrid;
uniform float uSnap;`;

const VERT_SNAP = `
  vN64View = mvPosition.xyz;
  {
    // gl_Position.w is the distance along the view axis, so this is a fade in
    // metres and a guard against dividing by a w of nothing, in one number
    /* Snapping has a far edge as well as a near one, and it is the far one
       that matters most.

       The wobble is a *near-field* effect. A vertex snapped to the pixel grid
       moves by up to half a pixel, and half a pixel of a surface three metres
       away is a couple of centimetres — which is the intended judder. Half a
       pixel of a ridge three hundred metres away is several metres of
       mountain, and since the snap is recomputed every frame from a camera
       that is moving, every distant facet flips between two positions
       continuously. That is not the console's wobble; on the console the far
       field was a handful of pixels tall and the same error was invisible.
       Here it is a shimmer across the whole horizon — terrain that flickers
       rather than terrain that emerges from the haze.

       So it fades back out with distance and the far field is left alone
       entirely. What is left is exactly the band where the effect is legible
       as an effect: the ground under and just ahead of the rider. */
    float n64Snap = uSnap
      * smoothstep(${asFloat(SNAP.near)}, ${asFloat(SNAP.full)}, gl_Position.w)
      * (1.0 - smoothstep(${asFloat(SNAP.fade)}, ${asFloat(SNAP.gone)}, gl_Position.w));
    if (n64Snap > 0.0) {
      vec2 ndc = gl_Position.xy / gl_Position.w;
      // Into pixels, onto the nearest pixel corner, and back out again. The
      // multiply by w at the end is what puts the vertex back into clip
      // space, and it is the whole reason the wobble scales with distance.
      vec2 cell = floor((ndc * 0.5 + 0.5) * uSnapGrid + 0.5) / uSnapGrid * 2.0 - 1.0;
      gl_Position.xy = mix(ndc, cell, n64Snap) * gl_Position.w;
    }
  }`;

/* THE CLOUD DECK, and the reason it lives in this file rather than in the one
   that draws the sky.

   The dome was a vertical gradient and one dot product of sun. That is a
   defensible sky at dawn, when the gradient itself is the event, and it is an
   empty one at noon: the chase framing puts roughly thirty degrees of sky
   across the top of the frame, and in daylight every pixel of it was a smooth
   ramp from one blue to another. Nothing up there had a scale, so nothing up
   there gave the mountain one either.

   What fixes that is not a texture on the dome. A texture on a sphere is
   painted at a constant angular size, so it has no perspective: the "clouds"
   at the zenith and the ones near the horizon are the same size, which is
   precisely the tell that a skybox is a box. A real deck is a *layer at a
   height*, and everything convincing about it comes from that one fact —
   overhead you look through it almost perpendicularly and see individual
   cells; towards the horizon the same line of sight crosses tens of times as
   much of it, so the cells crowd together, foreshorten, and finally merge into
   the haze. So this intersects the view ray with a plane, which is four
   instructions, and reads its noise field at the hit point.

   IT IS DEFINED HERE BECAUSE THERE ARE TWO SKIES. The dome draws one of them;
   `n64Sky` below draws the other, in every material's fog term, so that a
   ridge dissolving into the distance dissolves into the backdrop that is
   actually behind it. The old arrangement kept those two in step by writing
   the same gradient twice and leaving a comment in both places asking the next
   person to be careful. Adding a second, much longer thing to keep in step
   that way was not defensible, so the shared part is now shared: one string,
   included by both, and the drift is impossible rather than merely discouraged.

   The noise is procedural rather than the tiling texture `sky.js` already
   owns, and that is what pays for the sharing — a sampler can be handed to one
   dome material easily and to every lit material in the game only with a great
   deal of plumbing. It is written to keep every operand small enough that
   `mediump` is honest, because half the devices that will run this declare
   exactly that. */
export const SKY_GLSL = `
float n64Hash(vec2 p) {
  // The field wraps at 64 cells, which is both a tiling that nobody will find
  // in a sky and the thing that keeps every operand below in single or double
  // digits — see the note on mediump above.
  vec3 q = fract(vec3(mod(p, 64.0).xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float n64Noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(n64Hash(i), n64Hash(i + vec2(1.0, 0.0)), f.x),
    mix(n64Hash(i + vec2(0.0, 1.0)), n64Hash(i + vec2(1.0, 1.0)), f.x),
    f.y);
}

/* Coverage and thickness of the deck along this view direction.

   x is how much of the sky this pixel's cloud hides, y is how deep into it the
   ray went — which is what decides whether it is lit top or shaded base.

   The floor under dir.y is doing two jobs. It stops the intersection running
   away to infinity at the horizon, and it is where the deck stops being
   resolvable: past it the cells are smaller than a pixel and any honest
   evaluation is aliasing, so the coverage is faded out over the last few
   degrees and the haze takes over. That fade is also what lets n64Sky carry
   this term at all without opening a seam — a fogged ridge sits in exactly the
   band where the deck has already gone. */
vec2 n64Deck(vec3 dir, vec2 drift, float amount) {
  if (amount <= 0.002 || dir.y <= 0.04) return vec2(0.0);
  vec2 p = dir.xz * (0.62 / max(dir.y, 0.075)) + drift;
  float n = n64Noise(p) * 0.58
          + n64Noise(p * 2.3 + 7.7) * 0.28
          + n64Noise(p * 5.1 + 19.3) * 0.14;
  // A cut that opens with the amount, so a clear day has a few isolated cells
  // and an overcast one has a lid with holes in it rather than more of the
  // same cloud.
  float cover = smoothstep(0.62 - amount * 0.34, 0.80 - amount * 0.18, n);
  cover *= smoothstep(0.04, 0.19, dir.y);
  return vec2(cover * amount, smoothstep(0.5, 0.95, n));
}

/* What the deck is made of. Cloud is not white — it is the brightest thing in
   the sky and the least saturated, which is the same rule the snow is under —
   so the base is the haze the whole world dissolves into and the top is that
   opened towards the horizon stop with the sun's own glow laid over it. A deck
   lit from a low sun is orange on top and blue underneath, and neither of
   those is a colour anybody has to choose here: both fall out of the stops the
   weather is already handing over. */
vec3 n64DeckShade(float thick, float lobe, vec3 haze, vec3 horizon, vec3 glow) {
  vec3 c = mix(haze * 0.86, horizon, thick * 0.85 + 0.15);
  return c + glow * (pow(lobe, 3.0) * 0.34 + 0.05) * thick;
}
`;

/* `n64Sky` is `sky.js`'s DOME_FRAG, and it has to stay that way — if you
   change the dome's gradient, change this one. The only difference is the
   bottom stop, which is the haze rather than the horizon, because below the
   skyline the backdrop a fogged ridge is dissolving into is the curtain and
   not the sky.

   The cloud deck is no longer transcribed at all: it is `SKY_GLSL` above,
   included by this file and by `sky.js`, and there is exactly one copy of it. */
const FRAG_PARS = `
varying vec3 vN64View;
uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyHaze;
uniform vec3 uSkyGlow;
uniform vec3 uSunDir;
uniform vec3 uSunView;
uniform vec3 uSunTint;
uniform float uSunLevel;
uniform float uGlowStrength;
uniform float uFogNear;
uniform float uFogFar;
uniform float uBands;
uniform float uSheen;
uniform float uCloud;
uniform vec2 uCloudDrift;

${SKY_GLSL}

/* How hard this pixel is sitting in the specular lobe, left where anything
   downstream can read it. The terrain's glitter is the only thing that does,
   and it wants it because the two effects are the same crystals at two
   scales: the broad sheen is the average of a great many facets aimed
   roughly at the sun, and a glint is one facet aimed exactly at it, so the
   glints belong in the band where the sheen is and not scattered evenly over
   the hill. It is initialised rather than merely declared because a material
   that did not ask for a sheen never assigns it, and a reader that gets an
   undefined float back is a shader bug that only shows up on one driver. */
float n64Spec = 0.0;

vec3 n64Sky(vec3 dir) {
  float up = dir.y;
  vec3 low = mix(uSkyHaze, uSkyHorizon, smoothstep(0.0, 0.10, up));
  vec3 c = mix(
    mix(low, uSkyMid, smoothstep(-0.05, 0.14, up)),
    uSkyZenith,
    smoothstep(0.10, 0.52, up)
  );
  float lobe = max(0.0, dot(dir, uSunDir));
  c += uSkyGlow * (pow(lobe, 7.0) * 0.85 + pow(lobe, 2.0) * 0.14)
     * uGlowStrength * (1.0 - smoothstep(0.1, 0.75, up) * 0.55);
  // …and the deck over the top of it, because a cloud is in front of the air
  vec2 deck = n64Deck(dir, uCloudDrift, uCloud);
  c = mix(c, n64DeckShade(deck.y, lobe, uSkyHaze, uSkyHorizon, uSkyGlow), deck.x);
  return c;
}`;

/* Both things that happen after the light loop share one opening, because
   both of them start from the same question — where is the sun, from here?

   `normal` is three's own shading normal, in view space, and `uSunView` is the
   key light's direction pushed through the same view matrix on the CPU — so
   `n64NL` is the `dotNL` the light loop has just finished using, recovered
   rather than intercepted. The signed value is kept as well as the clamped
   one: the banding only ever wants the clamp, and the forward-scatter term
   below exists precisely for the surfaces where it is negative. */
const FRAG_SUN = `
  {
    float n64NL = dot(normal, uSunView);
    float n64Lit = clamp(n64NL, 0.0, 1.0);`;

/* Recovering the shadow, and the reason it is done here rather than in the
   sheen block below: the banding rescales `directDiffuse`, so this has to
   read it first or it would be measuring the rungs instead of the shadow.

   One directional light means `directDiffuse` is exactly
   `albedo · dotNL · sunRadiance · shadow / π`, and every term in that but the
   shadow is either in scope or in a uniform. So divide it out. The luminances
   are three separate dots against the same weights, which is the only thing
   that makes the ratio meaningful — it is a brightness measured against a
   brightness, not a colour against a colour, so a blue albedo under an amber
   sun does not read as half in shadow. */
const FRAG_RECOVER = `
    vec3 n64Sun = uSunTint * uSunLevel;
    float n64Alb = max(dot(diffuseColor.rgb, ${LUMA}), 1e-3);
    float n64Open = clamp(
      dot(reflectedLight.directDiffuse, ${LUMA})
        / max(n64Alb * n64Lit * dot(n64Sun, ${LUMA}) * RECIPROCAL_PI, 1e-5),
      0.0, 1.0);`;

/* Five rungs instead of a falloff, arrived at after the fact.

   Divide the smooth `dotNL` back out, multiply the rung in, and what is left
   is what a stepped light loop would have accumulated.

   The `max` is only there for the terminator. Where `n64Lit` is nothing the
   rung is nothing too, and 0/0 is the one number that would put a hole in the
   hill. */
const FRAG_BANDS = `
    {
      float t = n64Lit * uBands;
      float rung = floor(t);
      rung += smoothstep(${asFloat(1 - BAND_EDGE)}, 1.0, t - rung);
      float banded = min(rung, uBands - 1.0) / (uBands - 1.0);
      reflectedLight.directDiffuse *= banded / max(n64Lit, 1e-3);
    }`;

/* The snow's three specular terms, all of them added to the direct diffuse
   for the plainest of reasons: `MeshLambertMaterial`'s outgoing light in
   three r185 is `directDiffuse + indirectDiffuse + emissive` and nothing
   else, so anything written into `reflectedLight.directSpecular` — which is
   the slot that ought to have it, and where this was put first — is summed by
   nobody and thrown away. Adding is adding. The slot is a label.

   `n64V` is the direction back to the eye, built from this file's own view
   varying rather than from three's `geometryViewDir`, which is in scope right
   here and would be free. That is not an oversight. `geometryViewDir` was
   `geometry.viewDir` until r165 and is an internal name in a chunk this file
   is deliberately not editing; `vN64View` is ours and cannot be renamed out
   from under us.

   The three terms, in the order the eye notices them:

   THE LOBE, which is the sun in a very rough mirror. It carries `n64Open`, so
   it is absent inside a shadow, and it carries a Fresnel boost, because the
   same crystal faces reflect harder the more edge-on you catch them. The
   boost is bounded at double and needs no clamp beyond that: a strong lobe
   needs the half-vector near the normal and grazing needs the view far from
   it, and the two cannot both be true.

   THE FORWARD SCATTER, which is the sun coming *through* the snow. Snow is
   translucent for a few centimetres, so the wrap lights the shoulder of a
   ridge the sun is behind — but only when you are looking towards the sun,
   which is what `n64Fwd` is for. Cubed, so it is a rim on the one ridge
   between you and the light rather than a wash over everything.

   THE SKY, at grazing angles. Fresnel is the only one of the three that
   ignores the sun entirely, and it should: a grazing surface is showing you a
   reflection of the dome, so it is `n64Sky` in the mirror direction and it
   stays in palette by construction — navy where the dome is navy, amber only
   where the sun already is. It is also the only term that survives into
   shadow, which is right. Snow in shade does go bright at the edge.

   It is a mix and not an addition, and that is the correction that mattered
   most. Written as `+= sky · F` it was a flat lift over the whole picture,
   because a mountain seen down its own fall line is grazing nearly
   everywhere, and at midday — when the snow is already at the top of the
   scale and the dome is at its brightest — it did nothing but push another
   six per cent of the frame past the point where there is any shape left.
   What a mirror does is show you the sky *instead of* the ground, so the
   two are interpolated: `body + (sky − body)·F`. It cannot exceed the
   brighter of the two, so it cannot blow anything out; and where the sky is
   the darker one, at dusk, grazing snow now goes *down* towards it, which is
   both what a real reflection does and a nice thing to be able to say about
   this mountain — the ground starts turning into sky slightly before the fog
   gets round to it.

   `n64Body` has to include the indirect term for that to be true, and it can:
   `lights_fragment_end` is where three calls `RE_IndirectDiffuse`, so by the
   time this runs the hemisphere fill is already in the accumulator.

   And `n64Snow` takes all three away again on anything that is not snow, so
   a cliff face keeps the matte read that makes it look like rock. */
const FRAG_SHEEN = `
    float n64Snow = smoothstep(${asFloat(SNOW_LO)}, ${asFloat(SNOW_HI)}, n64Alb) * uSheen;
    // Rock, and every material that never asked, leave before the expensive
    // half of this — which is the second sky evaluation, and that function is
    // two pow instructions. The same guard the terrain's own detail and
    // glitter blocks use, for the same reason.
    // (No back-ticks in here: this comment is inside a template literal.)
    if (n64Snow > 0.002) {
      vec3 n64V = normalize(-vN64View);
      float n64F = pow(1.0 - clamp(dot(normal, n64V), 0.0, 1.0), 5.0);

      vec3 n64H = normalize(uSunView + n64V);
      n64Spec = pow(max(dot(normal, n64H), 0.0), ${asFloat(SHEEN.gloss)}) * n64Open;
      vec3 n64Add = n64Sun * (RECIPROCAL_PI * ${asFloat(SHEEN.strength)}
        * n64Spec * (1.0 + n64F));

      float n64Back = clamp((n64NL + ${asFloat(SHEEN.wrap)})
        / ${asFloat(1 + SHEEN.wrap)}, 0.0, 1.0) - n64Lit;
      float n64Fwd = clamp(-dot(uSunView, n64V), 0.0, 1.0);
      n64Add += n64Sun * (RECIPROCAL_PI * ${asFloat(SHEEN.wrapGain)}
        * n64Back * n64Fwd * n64Fwd * n64Fwd);

      vec3 n64Body = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
      n64Add += (n64Sky(normalize(reflect(-n64V, normal) * mat3(viewMatrix))) - n64Body)
        * (n64F * ${asFloat(SHEEN.fresnel)});

      reflectedLight.directDiffuse += n64Add * n64Snow;
    }`;

const FRAG_SUN_END = `
  }`;

/* Whatever this material asked for, in the one order that is correct: the
   shadow read before the banding rewrites what it is read from, and the
   specular added after the banding so the banding cannot step it. */
function lightPatch(bands, sheen) {
  return FRAG_SUN
    + (sheen ? FRAG_RECOVER : '')
    + (bands ? FRAG_BANDS : '')
    + (sheen ? FRAG_SHEEN : '')
    + FRAG_SUN_END;
}

/* The view-space position multiplied on the *right* by the view rotation,
   which is the transpose and therefore the inverse — the world direction the
   camera is looking along to reach this fragment. Done this way rather than
   by carrying a world position because a world position has to know about
   instancing, batching and skinning, and a view position does not: three has
   already applied all three by the time `mvPosition` exists. */
const FRAG_FOG = `
  {
    vec3 n64Dir = normalize(vN64View * mat3(viewMatrix));
    float n64Fog = smoothstep(uFogNear, uFogFar, length(vN64View));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, n64Sky(n64Dir), n64Fog);
  }`;

const LIGHT_ANCHOR = '#include <lights_fragment_end>';
const FOG_ANCHOR = '#include <fog_fragment>';

export function createShading(THREE) {
  /* The shared block. Every patched material is handed *these* objects rather
     than copies of them, so one write per frame in `update` moves the fog, the
     sky and the sun on the whole mountain at once — terrain, trees, animals,
     huts, the helicopter and the rider, in six modules that know nothing about
     each other. It is the only reason a day/night cycle over this many
     materials costs nothing. */
  const sunDir = new THREE.Vector3(0, 0.4, -1).normalize();
  const uniforms = {
    uSkyZenith: { value: new THREE.Color('#07297a') },
    uSkyMid: { value: new THREE.Color('#2f79d6') },
    uSkyHorizon: { value: new THREE.Color('#e4eefb') },
    uSkyHaze: { value: new THREE.Color('#e3ecf6') },
    uSkyGlow: { value: new THREE.Color('#ffeccc') },
    uSunDir: { value: sunDir },
    uSunView: { value: new THREE.Vector3(0, 0.4, -1).normalize() },
    /* The key light, split into a hue and a level, with the split made at the
       *brightest channel* rather than at the luminance. Multiplied back
       together they are exactly what three hands its own light loop —
       `key.color · key.intensity` — so the sheen is lit by the same lamp the
       diffuse is. Splitting at the luminance would have been the obvious
       move and is a trap: an amber key normalised that way comes out with a
       red channel above two, and the terrain's glitter multiplies by this
       tint directly, so every glint at dusk would have gone scarlet. Capped
       at the brightest channel, the tint is a colour in the ordinary sense —
       nothing in it is over one, and it is safe anywhere. */
    uSunTint: { value: new THREE.Color('#ffffff') },
    uSunLevel: { value: 1 },
    uGlowStrength: { value: 1 },
    uFogNear: { value: RENDER.fogNear },
    uFogFar: { value: RENDER.fogFar },
    uSnapGrid: { value: new THREE.Vector2(BASE_WIDTH, BASE_HEIGHT) },
    // The deck. `sky.js` owns both numbers and writes them into the dome's own
    // copies at the same moment — see `SKY_GLSL`.
    uCloud: { value: 0 },
    uCloudDrift: { value: new THREE.Vector2() },
  };

  const viewInv = new THREE.Matrix4();

  /* Patch one material.

     `opts.snap` is the per-material strength, `opts.bands` the number of
     light levels (0 for anything unlit — a window pane has no diffuse term to
     step), `opts.sheen` how much of the snow specular this surface gets, and
     `opts.fog` false for anything additive, which cannot be fogged because
     mixing towards the haze and adding to the picture are opposite
     operations.

     `sheen` defaults to nothing, and that is the whole of the policy. Only
     the terrain asks for it. A spruce is not shiny, a hut wall is not shiny,
     and the rider is a matte jacket over a matte pair of trousers — turning
     it on globally would have been one line and would have put a highlight on
     everything on the mountain, which is precisely the modern look the rest
     of this file is spent avoiding.

     Two things here are less obvious than they look.

     Any `onBeforeCompile` the material already had is called first and its
     edits are kept, which is what lets the terrain keep its corduroy and its
     glitter — both of which anchor on the same fog include this replaces, and
     both of which are written to leave that include in place behind them.

     And `customProgramCacheKey` is not decoration. Three caches compiled
     programs across materials on a key that, by default, is the *text* of
     `onBeforeCompile` — and every material patched here shares one closure
     with identical text, so without a key of our own the terrain's shader and
     the trees' shader would collide and one of them would silently get the
     other's program. The key carries whatever made this material's source
     different: the patches asked for, and the text of whatever the material
     was already doing to itself. */
  function apply(material, opts = {}) {
    if (material.userData.n64) return material;

    const snap = opts.snap === undefined ? SNAP.scenery : opts.snap;
    const bands = opts.bands === undefined ? BANDS : opts.bands;
    const sheen = opts.sheen === undefined ? 0 : opts.sheen;
    const wantFog = opts.fog !== false;
    // The three per-material uniforms, hung on the material itself as well as
    // handed to the shader — partly so a second `apply` can see it has
    // already been here, and partly because it makes the whole look tunable
    // from the console: `terrain.mesh.material.userData.n64.uBands.value = 2`
    // is the fastest way to find out whether five bands is the right number,
    // and `uSheen.value = 0` is the fastest way to see what the snow looked
    // like before it had a highlight on it.
    const own = {
      uSnap: { value: snap },
      uBands: { value: bands },
      uSheen: { value: sheen },
    };

    const prev = material.onBeforeCompile;
    const hadPrev = prev && prev !== THREE.Material.prototype.onBeforeCompile;

    material.onBeforeCompile = (shader, renderer) => {
      if (hadPrev) prev.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms, own);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${VERT_PARS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>${VERT_SNAP}`);

      let frag = shader.fragmentShader
        .replace('#include <common>', `#include <common>${FRAG_PARS}`);
      // Only a lit material has a light loop to step, and only three's own
      // fog slot is a safe place to put ours — an unlit or additive material
      // has neither, and asking for them is how a silent no-op happens.
      // Both light-loop patches go in as one string for one anchor: two
      // successive replaces on the same include would have put the second
      // one *above* the first, and above is the wrong side of the banding
      const wantBands = bands >= 2;
      if ((wantBands || sheen > 0) && frag.indexOf(LIGHT_ANCHOR) !== -1) {
        frag = frag.replace(LIGHT_ANCHOR,
          `${LIGHT_ANCHOR}${lightPatch(wantBands, sheen > 0)}`);
      }
      if (wantFog && frag.indexOf(FOG_ANCHOR) !== -1) {
        frag = frag.replace(FOG_ANCHOR, FRAG_FOG);
      }
      shader.fragmentShader = frag;
    };

    const key = `n64|${snap > 0 ? 's' : ''}|${bands >= 2 ? 'b' : ''}`
      + `|${sheen > 0 ? 'p' : ''}|${wantFog ? 'f' : ''}`
      + `|${hadPrev ? prev.toString() : ''}`;
    material.customProgramCacheKey = () => key;

    // Three contributes nothing to the fog now; the include it would have
    // filled is where ours goes instead, and the varying it would have added
    // is one this does not need
    material.fog = false;
    material.userData.n64 = own;
    material.needsUpdate = true;
    return material;
  }

  /* Once a frame, after the camera has been moved and before anything is
     drawn with it.

     The sun is rebuilt from the weather's two angles rather than borrowed
     from `sky.js`, which looks like duplication and is not: both are pure
     functions of `azimuth` and `elevation`, so there is nothing for them to
     drift apart on. Borrowing would have meant this module holding a
     reference to the sky, and the sky is the one thing on the mountain that
     is drawn without any of this.

     `uSunView` is the only thing here that needs the camera. The banded
     diffuse compares the sun against three's own view-space normal, and the
     alternative — carrying the world normal into the fragment shader — is a
     varying that flat shading would immediately contradict, because a flat
     normal comes from screen derivatives and not from the vertices. */
  function update(w, camera) {
    uniforms.uSkyZenith.value.copy(w.zenith);
    uniforms.uSkyMid.value.copy(w.mid);
    uniforms.uSkyHorizon.value.copy(w.horizon);
    uniforms.uSkyHaze.value.copy(w.haze);
    uniforms.uSkyGlow.value.copy(w.glow);
    uniforms.uGlowStrength.value = 1 - w.storm * 0.8;
    uniforms.uFogNear.value = w.fogNear;
    uniforms.uFogFar.value = w.fogFar;
    uniforms.uCloud.value = w.cloud;
    uniforms.uCloudDrift.value.set(w.cloudX, w.cloudZ);

    /* The lamp, taken apart. `sky.js` sets `key.color` to `w.key` and
       `key.intensity` to `w.keyI` and three multiplies them into one uniform,
       so reading the same two numbers here is not a second opinion about the
       light — it is the same light, arrived at without this module having to
       hold a reference to the sky. The storm is already inside `keyI`, so a
       blizzard takes the sheen down with everything else and no line here has
       to know that a blizzard exists. */
    const peak = Math.max(w.key.r, w.key.g, w.key.b, 1e-4);
    uniforms.uSunTint.value.copy(w.key).multiplyScalar(1 / peak);
    uniforms.uSunLevel.value = w.keyI * peak;

    sunDir.set(
      Math.sin(w.azimuth) * Math.cos(w.elevation),
      Math.sin(w.elevation),
      -Math.cos(w.azimuth) * Math.cos(w.elevation),
    ).normalize();

    // The renderer will do this itself in a moment, but only in a moment, and
    // a sun a frame behind the camera is a whole mountain lit for where the
    // rider used to be
    camera.updateMatrixWorld();
    viewInv.copy(camera.matrixWorld).invert();
    uniforms.uSunView.value.copy(sunDir).transformDirection(viewInv);

    /* The grid is the framebuffer, not a constant — the buffer grows past
       640×360 on a window that is not sixteen by nine, and the wobble has to
       grow with it or a 21:9 monitor gets a finer one than a laptop does.

       Read defensively, and asked every frame rather than once, because it is
       `retro.setSize` that owns this number and it can write a new one at any
       point: a laptop moved to an external display changes the pixel ratio,
       which changes the buffer, which changes the grid the whole mountain
       snaps to. Reading it at construction would have pinned the wobble to
       whatever window the page happened to open in. */
    const buffer = RENDER.buffer || {};
    uniforms.uSnapGrid.value.set(
      Math.max(1, Math.round((buffer.width || BASE_WIDTH) / SNAP.cell)),
      Math.max(1, Math.round((buffer.height || BASE_HEIGHT) / SNAP.cell)),
    );
  }

  return { uniforms, apply, update };
}
