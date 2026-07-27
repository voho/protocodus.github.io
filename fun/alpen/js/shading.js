/* The console, as three patches on every material in the world.

   Three effects, and between them they are most of why the picture reads as
   1996 rather than as a modern engine with the saturation turned up. All of
   them are grafted onto three's own materials with `onBeforeCompile` rather
   than replacing them, and that decision is worth defending: a hand-written
   `ShaderMaterial` would have to reimplement the light loop, vertex colours,
   instancing and flat shading before it drew a single facet, and every one of
   those is already correct. What is wanted here is not a different renderer.
   It is three specific lies told inside the one there is.

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

/* `n64Sky` is `sky.js`'s DOME_FRAG, and it has to stay that way — if you
   change the dome's gradient, change this one. The only difference is the
   bottom stop, which is the haze rather than the horizon, because below the
   skyline the backdrop a fogged ridge is dissolving into is the curtain and
   not the sky. */
const FRAG_PARS = `
varying vec3 vN64View;
uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyHaze;
uniform vec3 uSkyGlow;
uniform vec3 uSunDir;
uniform vec3 uSunView;
uniform float uGlowStrength;
uniform float uFogNear;
uniform float uFogFar;
uniform float uBands;

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
  return c;
}`;

/* Five rungs instead of a falloff, arrived at after the fact.

   `normal` is three's own shading normal, in view space, and `uSunView` is the
   key light's direction pushed through the same view matrix on the CPU — so
   `lit` is the `dotNL` the light loop has just finished using, recovered
   rather than intercepted. Divide it back out, multiply the rung in, and what
   is left is what a stepped light loop would have accumulated.

   The `max` is only there for the terminator. Where `lit` is nothing the rung
   is nothing too, and 0/0 is the one number that would put a hole in the
   hill. */
const FRAG_BANDS = `
  {
    float lit = clamp(dot(normal, uSunView), 0.0, 1.0);
    float t = lit * uBands;
    float rung = floor(t);
    rung += smoothstep(${asFloat(1 - BAND_EDGE)}, 1.0, t - rung);
    float banded = min(rung, uBands - 1.0) / (uBands - 1.0);
    reflectedLight.directDiffuse *= banded / max(lit, 1e-3);
  }`;

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
    uGlowStrength: { value: 1 },
    uFogNear: { value: RENDER.fogNear },
    uFogFar: { value: RENDER.fogFar },
    uSnapGrid: { value: new THREE.Vector2(BASE_WIDTH, BASE_HEIGHT) },
  };

  const viewInv = new THREE.Matrix4();

  /* Patch one material.

     `opts.snap` is the per-material strength, `opts.bands` the number of
     light levels (0 for anything unlit — a window pane has no diffuse term to
     step), and `opts.fog` false for anything additive, which cannot be fogged
     because mixing towards the haze and adding to the picture are opposite
     operations.

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
    const wantFog = opts.fog !== false;
    // The two per-material uniforms, hung on the material itself as well as
    // handed to the shader — partly so a second `apply` can see it has
    // already been here, and partly because it makes the whole look tunable
    // from the console: `terrain.mesh.material.userData.n64.uBands.value = 2`
    // is the fastest way to find out whether five bands is the right number.
    const own = {
      uSnap: { value: snap },
      uBands: { value: bands },
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
      // has neither, and asking for them is how a silent no-op happens
      if (bands >= 2 && frag.indexOf(LIGHT_ANCHOR) !== -1) {
        frag = frag.replace(LIGHT_ANCHOR, `${LIGHT_ANCHOR}${FRAG_BANDS}`);
      }
      if (wantFog && frag.indexOf(FOG_ANCHOR) !== -1) {
        frag = frag.replace(FOG_ANCHOR, FRAG_FOG);
      }
      shader.fragmentShader = frag;
    };

    const key = `n64|${snap > 0 ? 's' : ''}|${bands >= 2 ? 'b' : ''}|${wantFog ? 'f' : ''}`
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
