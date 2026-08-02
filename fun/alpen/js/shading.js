/* Shared material enhancements for the Alpine world.

   Three's own light loop remains authoritative. This module adds crystalline
   snow response and direction-aware atmospheric fog while sharing the sky,
   sun and weather uniforms across terrain, vegetation, structures and rider.
   Geometry stays at its exact projected position and diffuse lighting remains
   continuous; the former fixed-grid vertex snap and stepped light bands have
   intentionally been retired. */

import { RENDER, MIST } from './config.js';

/* Snow is a rough dielectric, not white paint. A GGX microfacet response
   carries the sun, Schlick Fresnel replaces the body colour with reflected sky
   at grazing angles, and a small wrapped term models light travelling through
   the upper centimetres of a ridge. The snowpack supplies a broad smoothness
   field: powder stays rough, while wind slab and compacted piste tighten the
   lobe. Falling snow and distance roughen it again before an undersampled
   highlight can shimmer. */
export const SHEEN = {
  /* Dielectric snow/ice microfacets. Fresh powder is very rough, while wind
     slab and compacted piste tighten the same GGX response without becoming a
     polished mirror. F0 is close to real ice at normal incidence; the gains
     account for a snow surface being a volume of many crystal interfaces. */
  f0: 0.018,
  roughFresh: 0.68,
  roughIce: 0.30,
  sunGain: 0.65,
  envFresh: 0.14,
  envIce: 0.48,
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

// Baking a JS constant into the shader source rather than sending it as a
// uniform: these never change at runtime, and a literal is one less uniform
// for every material in the world to carry
const asFloat = (n) => n.toFixed(4);

const VERT_PARS = `
varying vec3 vN64View;
varying float vN64Ice;
varying float vN64Sheen;`;

// Keep the view-space position for snow reflections and radial atmosphere.
// Projected geometry is left untouched so motion remains sub-pixel smooth.
// `vN64Sheen` lets a material carve the snow response out of parts of
// itself per vertex — a grown tree is snow loads over matte timber, and a
// luminance mask alone cannot tell pale dead larch from the drift on it.
const VERT_VIEW = `
  vN64View = mvPosition.xyz;
  vN64Ice = 0.0;
  vN64Sheen = 1.0;`;

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
varying float vN64Ice;
varying float vN64Sheen;
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
uniform float uMistFloor;
uniform float uMistLevel;
uniform float uSheen;
uniform float uSnowFresh;
uniform float uCloud;
uniform vec2 uCloudDrift;
uniform sampler2D uShadeMap;
uniform vec3 uShadeAt;
uniform float uShadeLevel;

${SKY_GLSL}

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
}

/* A rough snow reflection cannot resolve the cloud deck's cells, so sampling
   all three procedural cloud octaves a second time for every terrain pixel is
   both physically wrong and expensive. This is the same atmospheric dome and
   sun lobe, analytically prefiltered to its cloud-free low frequencies. */
vec3 n64SkyReflect(vec3 dir) {
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
  return c;
}`;

/* Both things that happen after the light loop share one opening, because
   both of them start from the same question — where is the sun, from here?

   `normal` is Three's own shading normal, in view space, and `uSunView` is the
   key light's direction pushed through the same view matrix on the CPU. The
   signed value is kept as well as the clamped one because the forward-scatter
   term exists precisely for surfaces where it is negative. */
const FRAG_SUN = `
  {
    float n64NL = dot(normal, uSunView);
    float n64Lit = clamp(n64NL, 0.0, 1.0);`;

/* Recovering the shadow here avoids a second PCF shadow-map lookup for every
   snow pixel.

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

   THE LOBE, which is the sun in a rough dielectric mirror. GGX supplies the
   crystal-facet distribution, Schlick-Smith the visibility and Schlick the
   Fresnel colour. It carries `n64Open`, so a cast shadow removes the reflected
   sun without removing the reflected sky.

   THE FORWARD SCATTER, which is the sun coming *through* the snow. Snow is
   translucent for a few centimetres, so the wrap lights the shoulder of a
   ridge the sun is behind — but only when you are looking towards the sun,
   which is what `n64Fwd` is for. Cubed, so it is a rim on the one ridge
   between you and the light rather than a wash over everything.

   THE SKY, strongest at grazing angles. Fresnel is the only one of the three that
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
    float n64Snow = smoothstep(${asFloat(SNOW_LO)}, ${asFloat(SNOW_HI)}, n64Alb)
      * uSheen * vN64Sheen;
    // Rock, and every material that never asked, leave before the expensive
    // half of this — which is the second sky evaluation, and that function is
    // two pow instructions. The snow/rock mask avoids that work on cliffs.
    // (No back-ticks in here: this comment is inside a template literal.)
    if (n64Snow > 0.002) {
      vec3 n64V = normalize(-vN64View);
      float n64NoV = max(dot(normal, n64V), 0.04);
      float n64NoL = n64Lit;
      vec3 n64HalfSum = uSunView + n64V;
      vec3 n64H = n64HalfSum * inversesqrt(max(dot(n64HalfSum, n64HalfSum), 1e-6));
      float n64NoH = max(dot(normal, n64H), 0.0);
      float n64VoH = max(dot(n64V, n64H), 0.0);

      // The snowpack field controls roughness, then weather and distance push
      // it back towards powder. This is the reflection LOD: no sharp lobe is
      // allowed to survive into a footprint too small to resolve it.
      float n64Smooth = clamp(vN64Ice, 0.0, 1.0);
      n64Smooth *= 1.0 - uSnowFresh * 0.72;
      n64Smooth *= 1.0 - smoothstep(90.0, 180.0, length(vN64View));
      float n64Rough = mix(${asFloat(SHEEN.roughFresh)},
        ${asFloat(SHEEN.roughIce)}, n64Smooth);

      // GGX/Trowbridge-Reitz distribution with Schlick-Smith visibility and
      // Schlick Fresnel. Continuous normals plus analytic filtering keep this
      // physically shaped highlight stable where stochastic glints would alias.
      float n64A = n64Rough * n64Rough;
      float n64A2 = n64A * n64A;
      float n64Den = n64NoH * n64NoH * (n64A2 - 1.0) + 1.0;
      float n64D = n64A2 / (PI * n64Den * n64Den + 1e-5);
      float n64K = n64Rough + 1.0;
      n64K = n64K * n64K * 0.125;
      float n64Gv = n64NoV / (n64NoV * (1.0 - n64K) + n64K);
      float n64Gl = n64NoL / (n64NoL * (1.0 - n64K) + n64K);
      vec3 n64Fs = mix(vec3(${asFloat(SHEEN.f0)}), vec3(1.0),
        pow(1.0 - n64VoH, 5.0));
      vec3 n64Add = n64Sun * n64Fs
        * (n64D * n64Gv * n64Gl / max(4.0 * n64NoV * max(n64NoL, 0.001), 1e-4))
        * n64NoL * n64Open * ${asFloat(SHEEN.sunGain)};
      float n64Back = clamp((n64NL + ${asFloat(SHEEN.wrap)})
        / ${asFloat(1 + SHEEN.wrap)}, 0.0, 1.0) - n64Lit;
      float n64Fwd = clamp(-dot(uSunView, n64V), 0.0, 1.0);
      n64Add += n64Sun * (RECIPROCAL_PI * ${asFloat(SHEEN.wrapGain)}
        * n64Back * n64Fwd * n64Fwd * n64Fwd);

      /* GLINTS — the sun caught in individual surface crystals.

         The GGX lobe above is the statistical answer, and statistics is why
         snow near the board still looked airbrushed: real snow resolves into
         discrete facets at this distance, a few of which happen to mirror
         the sun straight at you and outshine everything around them.

         Stochastic screen-space glints were rejected here once for aliasing,
         and that judgement stands — so these are not stochastic. The world
         is tiled into three-centimetre cells anchored to the ground, wrapped
         at 64 m to keep every hash operand honest on a mediump GPU. The
         wrap needs help: n64Hash re-wraps its input at 64 internally, which
         on cell indices would tile the crystal field every 64 cells — two
         metres, close enough to repeat visibly. Each two-metre tile
         therefore salts its cells with its own pseudo-random offset, which
         restores the full 64-metre period at the cost of two hashes, and a
         64-metre repeat is one sparkle genuinely has no structure to
         expose. A fixed few per
         cent of cells are crystals; each holds one fixed, randomly-canted
         facet, and lights up only while the half-vector sweeps across it —
         which is precisely the on/off twinkle a moving camera sees on real
         snow, produced by geometry rather than by a random number per frame.
         Distance fades them out well before a cell approaches the pixel
         grid, fresh storm snow buries them, and the recovered shadow term
         keeps them out of cast shade. */
      float n64GDist = length(vN64View);
      if (n64GDist < 42.0 && n64Lit > 0.02) {
        vec3 n64WDir = normalize(vN64View * mat3(viewMatrix));
        vec2 n64GPos = mod((cameraPosition + n64WDir * n64GDist).xz, 64.0);
        vec2 n64GCell = floor(n64GPos * 32.0);
        vec2 n64GTile = floor(n64GCell / 64.0);
        n64GCell += floor(vec2(n64Hash(n64GTile), n64Hash(n64GTile.yx + 3.0)) * 64.0);
        if (n64Hash(n64GCell) > 0.976) {
          vec3 n64GJit = vec3(n64Hash(n64GCell + 7.0) - 0.5,
            n64Hash(n64GCell + 13.0) - 0.5,
            n64Hash(n64GCell + 29.0) - 0.5);
          vec3 n64GN = normalize(normal + n64GJit * 0.55);
          float n64Spark = pow(max(dot(n64GN, n64H), 0.0), 64.0);
          float n64GFade = (1.0 - smoothstep(14.0, 42.0, n64GDist))
            * n64Open * (1.0 - uSnowFresh * 0.85);
          n64Add += n64Sun * (n64Spark * n64GFade * 2.6);
        }
      }

      float n64Fenv = ${asFloat(SHEEN.f0)}
        + (1.0 - ${asFloat(SHEEN.f0)}) * pow(1.0 - n64NoV, 5.0);
      vec3 n64R = normalize(reflect(-n64V, normal) * mat3(viewMatrix));
      vec3 n64Env = n64SkyReflect(n64R);
      // A rough reflection sees the average dome rather than a sharp patch.
      n64Env = mix(uSkyMid, n64Env, mix(0.42, 0.92, n64Smooth));
      vec3 n64Body = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
      n64Add += (n64Env - n64Body) * (n64Fenv
        * mix(${asFloat(SHEEN.envFresh)}, ${asFloat(SHEEN.envIce)}, n64Smooth));

      reflectedLight.directDiffuse += n64Add * n64Snow;
    }`;

const FRAG_SUN_END = `
  }`;

/* Recover the light-loop shadow before adding the snow response. */
function lightPatch(sheen) {
  return FRAG_SUN
    + (sheen ? FRAG_RECOVER : '')
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
    float n64Dist = length(vN64View);
    float n64Fog = smoothstep(uFogNear, uFogFar, n64Dist);
    /* Valley mist: the fog's height term. The radial curtain treats a hollow
       and a crest at the same range identically, which discards the one
       depth cue this terrain is actually made of. The mist is a bank with a
       floor: density falls exponentially with height above it, so gullies
       and the corridor's dish fill with haze while every knoll and ridge
       crest punches clear. The distance ramp is what keeps it out of the
       rider's own snow — mist two metres of path away is no mist at all. */
    vec3 n64Dir = vN64View * (1.0 / max(n64Dist, 1e-4)) * mat3(viewMatrix);
    if (uMistLevel > 0.002) {
      float n64H = max(cameraPosition.y + n64Dir.y * n64Dist - uMistFloor, 0.0);
      float n64Mist = uMistLevel * exp(n64H * -${asFloat(MIST.scale)})
        * smoothstep(30.0, 150.0, n64Dist);
      /* Mist is water, not sky: it blends towards the flat haze stop, never
         the directional gradient. Routed through the sun's amber lobe it
         painted every shaded mid-field slope mud-brown at golden hour. The
         (1 − fog) keeps the two curtains from double-counting where the
         radial one has already taken over. */
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uSkyHaze, n64Mist * (1.0 - n64Fog));
    }
    /* Most of the frame is snow well inside the curtain, and it was paying
       for the full sky evaluation — gradient, sun lobe and three octaves of
       cloud deck — to be multiplied by zero. Fog is monotonic in depth, so
       the branch is coherent across a warp and near fragments simply leave. */
    if (n64Fog > 0.003) {
      gl_FragColor.rgb = mix(gl_FragColor.rgb, n64Sky(n64Dir), n64Fog);
    }
  }`;

/* Camera collision can put the lens inside a conifer even after the boom has
   shortened as far as composition allows. Fade only the geometry inside a
   small sphere around the lens; AlphaHash turns fractional coverage into
   stable, depth-writing screen-door transparency without the sorting errors
   blended instanced trees would introduce. */
const FRAG_CAMERA_FADE = `#include <alphamap_fragment>
  diffuseColor.a *= smoothstep(2.2, 6.5, length(vN64View));`;

/* THE MOUNTAIN'S SHADOW, on everything that is standing in it.

   `terrain.js` marches the sun's horizon over the height field and keeps the
   answer; the ground reads it per vertex, where it is free. Nothing else has
   a vertex of the mountain to read it off, and until this existed nothing
   else was shadowed by the mountain at all — the depth map holds only the
   things that genuinely move through the light, so a tree at the foot of the
   containment wall stood in full sun inside the bar the wall was laying
   across the piste. Two things in the same picture disagreeing about whether
   the sun is out is a worse artifact than either of them being wrong alone.

   So the same field arrives here as a 128-square single-channel texture —
   sixteen kilobytes, one filtered fetch — placed in the world by `uShadeAt`:
   xy is the corner it starts at and z is one over its span. Outside it
   nothing is known and therefore nothing is shadowed, which is the same
   bargain the depth map struck by not reaching that far.

   It multiplies the direct light only. The sky fill still reaches a shaded
   hollow, which is what makes snow in shade blue rather than black, and it
   is the same split a real cast shadow makes. And it sits at
   `lights_fragment_maps` — between the direct accumulation and the indirect
   one — so the snow response's recovered shadow term downstream sees it and
   takes the reflected sun out of the same shade.

   The world position is rebuilt from the view varying rather than carried as
   a second one, for the reason given beside the fog: a view position has
   already been through instancing, batching and skinning and a world one has
   not. */
const FRAG_SHADE = `#include <lights_fragment_maps>
  if (uShadeLevel > 0.002) {
    float n64ShadeD = length(vN64View);
    vec3 n64ShadeW = cameraPosition
      + (vN64View * (1.0 / max(n64ShadeD, 1e-4)) * mat3(viewMatrix)) * n64ShadeD;
    vec2 n64ShadeUv = (n64ShadeW.xz - uShadeAt.xy) * uShadeAt.z;
    // Clamped rather than wrapped, and then thrown away outside the field —
    // the border texel is not an answer about the mountain a kilometre away.
    float n64ShadeIn = step(0.0, n64ShadeUv.x) * step(n64ShadeUv.x, 1.0)
      * step(0.0, n64ShadeUv.y) * step(n64ShadeUv.y, 1.0);
    float n64Shade = texture2D(uShadeMap, clamp(n64ShadeUv, 0.0, 1.0)).r;
    reflectedLight.directDiffuse *= 1.0
      - (1.0 - n64Shade) * n64ShadeIn * uShadeLevel;
  }`;

const SHADE_ANCHOR = '#include <lights_fragment_maps>';
const LIGHT_ANCHOR = '#include <lights_fragment_end>';
const FOG_ANCHOR = '#include <fog_fragment>';
const ALPHA_ANCHOR = '#include <alphamap_fragment>';

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
       red channel above two, which makes a dusk reflection turn scarlet.
       Capped
       at the brightest channel, the tint is a colour in the ordinary sense —
       nothing in it is over one, and it is safe anywhere. */
    uSunTint: { value: new THREE.Color('#ffffff') },
    uSunLevel: { value: 1 },
    uGlowStrength: { value: 1 },
    uFogNear: { value: RENDER.fogNear },
    uFogFar: { value: RENDER.fogFar },
    uMistFloor: { value: -1e5 },
    uMistLevel: { value: 0 },
    uSnowFresh: { value: 0 },
    // The deck. `sky.js` owns both numbers and writes them into the dome's own
    // copies at the same moment — see `SKY_GLSL`.
    uCloud: { value: 0 },
    uCloudDrift: { value: new THREE.Vector2() },
    /* The mountain's own shadow — see `FRAG_SHADE`. `terrain.js` owns all
       three: the field, where in the world it is standing, and how much of it
       this hour is worth. The map starts as a one-texel white so a material
       compiled before the first terrain build is simply unshadowed rather
       than sampling nothing. */
    uShadeMap: {
      value: (() => {
        const t = new THREE.DataTexture(
          new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType,
        );
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
        return t;
      })(),
    },
    uShadeAt: { value: new THREE.Vector3(0, 0, 0) },
    uShadeLevel: { value: 0 },
  };

  const viewInv = new THREE.Matrix4();
  const flashWhite = new THREE.Color(1, 1, 1);

  /* Patch one material.

     `opts.sheen` controls how much crystalline snow response this surface
     gets, `opts.fog` is false for additive surfaces, and `opts.cameraFade`
     reserves a clear bubble around the lens for instanced vegetation.

     `sheen` defaults to nothing, and that is the whole of the policy. Only
     the terrain asks for it. A spruce is not shiny, a hut wall is not shiny,
     and the rider is a matte jacket over a matte pair of trousers — turning
     it on globally would have been one line and would have put a highlight on
     every surface instead of describing the material it belongs to.

     Two things here are less obvious than they look.

     Any `onBeforeCompile` the material already had is called first and its
     edits are kept, which is what lets the terrain retain its generated macro
     albedo and smooth height-field normal before this shared light pass is
     installed.

     And `customProgramCacheKey` is not decoration. Three caches compiled
     programs across materials on a key that, by default, is the *text* of
     `onBeforeCompile` — and every material patched here shares one closure
     with identical text, so without a key of our own the terrain's shader and
     the trees' shader would collide and one of them would silently get the
     other's program. The key carries whatever made this material's source
     different: the patches asked for, and the text of whatever the material
     was already doing to itself. */
  function apply(material, opts = {}) {
    if (material.userData.alpenShading) return material;

    const sheen = opts.sheen === undefined ? 0 : opts.sheen;
    const wantFog = opts.fog !== false;
    const cameraFade = opts.cameraFade === true;
    // Only the ground opts out, because the ground already has this per
    // vertex. Everything else that has a light loop to patch gets it.
    const wantShade = opts.shade !== false;
    // Keep the snow response live-tunable without recompiling a material.
    const own = {
      uSheen: { value: sheen },
    };

    const prev = material.onBeforeCompile;
    const hadPrev = prev && prev !== THREE.Material.prototype.onBeforeCompile;

    material.onBeforeCompile = (shader, renderer) => {
      if (hadPrev) prev.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms, own);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${VERT_PARS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>${VERT_VIEW}`);

      let frag = shader.fragmentShader
        .replace('#include <common>', `#include <common>${FRAG_PARS}`);
      if (cameraFade && frag.indexOf(ALPHA_ANCHOR) !== -1) {
        frag = frag.replace(ALPHA_ANCHOR, FRAG_CAMERA_FADE);
      }
      // Unlit materials have no light loop to shade, and the two anchors
      // below are how that is detected rather than asserted.
      if (wantShade && frag.indexOf(SHADE_ANCHOR) !== -1) {
        frag = frag.replace(SHADE_ANCHOR, FRAG_SHADE);
      }
      // Only a lit material exposes the light-loop anchor used by the snow
      // response. The custom fog owns Three's fog slot on opaque surfaces.
      if (sheen > 0 && frag.indexOf(LIGHT_ANCHOR) !== -1) {
        frag = frag.replace(LIGHT_ANCHOR,
          `${LIGHT_ANCHOR}${lightPatch(true)}`);
      }
      if (wantFog && frag.indexOf(FOG_ANCHOR) !== -1) {
        frag = frag.replace(FOG_ANCHOR, FRAG_FOG);
      }
      shader.fragmentShader = frag;
    };

    const key = `alpen|${sheen > 0 ? 'p' : ''}|${wantFog ? 'f' : ''}`
      + `|${cameraFade ? 'c' : ''}|${wantShade ? 's' : ''}`
      + `|${hadPrev ? prev.toString() : ''}`;
    material.customProgramCacheKey = () => key;

    // Three contributes nothing to the fog now; the include it would have
    // filled is where ours goes instead, and the varying it would have added
    // is one this does not need
    material.fog = false;
    if (cameraFade) material.alphaHash = true;
    material.userData.alpenShading = own;
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

     `uSunView` is the only thing here that needs the camera. The snow response
     compares the sun against Three's own view-space normal, so it remains in
     agreement with each material's diffuse lighting and shadowing. */
  let mistFloor = Number.NaN;

  function update(w, camera, dt = 0, groundY = Number.NaN) {
    uniforms.uSkyZenith.value.copy(w.zenith);
    uniforms.uSkyMid.value.copy(w.mid);
    uniforms.uSkyHorizon.value.copy(w.horizon);
    uniforms.uSkyHaze.value.copy(w.haze);
    uniforms.uSkyGlow.value.copy(w.glow);
    /* A lightning flash lights the dome, and the world's fog dissolves into
       that dome — leave these two out and every fogged ridge holds its old
       colour against a white sky for the length of the strike. */
    if (w.flash > 0.003) {
      uniforms.uSkyHorizon.value.lerp(flashWhite, w.flash * 0.8);
      uniforms.uSkyHaze.value.lerp(flashWhite, w.flash * 0.8);
    }
    uniforms.uGlowStrength.value = 1 - w.storm * 0.8;
    uniforms.uFogNear.value = w.fogNear;
    uniforms.uFogFar.value = w.fogFar;
    uniforms.uSnowFresh.value = w.storm;
    uniforms.uCloud.value = w.cloud;
    uniforms.uCloudDrift.value.set(w.cloudX, w.cloudZ);

    /* The mist bank's floor rides a fixed drop under the ground at the
       rider, eased rather than pinned — pinned, it would leap up under a
       jump and drain every hollow the moment the camera rose. Eased, the
       bank keeps sinking with the run and a launch sails out over it. */
    if (Number.isFinite(groundY)) {
      const target = groundY - MIST.drop;
      mistFloor = Number.isNaN(mistFloor) ? target
        : mistFloor + (target - mistFloor) * (1 - Math.exp(-dt * MIST.floorRate));
      uniforms.uMistFloor.value = mistFloor;
    }
    uniforms.uMistLevel.value = (w.mist || 0) * MIST.max;

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
  }

  return { uniforms, apply, update };
}
