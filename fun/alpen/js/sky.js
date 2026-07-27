/* Sky, sun, horizon and light — all of it driven by the weather.

   Everything here is at infinity: the whole group is moved to the rider each
   frame and never rotated, so it has parallax with nothing and reads as
   distance. Nothing is baked, because the sky changes all day; every colour
   is a uniform the weather writes each frame, which is also why a full day
   cycle costs no geometry work at all.

   Six pieces, in the order the eye finds them.

   The dome is a three-stop gradient with a warm lobe around whatever is
   currently lighting the sky. That lobe is the cheapest atmosphere in
   graphics: one dot product, and it is most of the difference between a
   painted gradient and a sky with a sun somewhere in it.

   The stars sit just inside the dome and fade in with the night. They are
   the one thing a storm can take away completely.

   The aurora sits between them, and on three nights in four it is not there
   at all. `weather.aurora` decides when — see the gates on it there — and
   this end decides only what it looks like: a wide band of curtains across
   the north, three octaves of noise scrolling upward through a vertical
   ramp, green at the foot and a violet fringe at the top. It is drawn
   additively, which in a picture that is graded, dithered and quantised
   means it has to be kept quiet: a hot band of green over the sky clips, and
   clipped additive light is the one thing in the frame that cannot be graded
   back. So the gain is low, the folds are sparse — the noise is cut high, so
   most of the band is nothing and the folds are what is left — and the whole
   thing dies out before the horizon, where the haze would have had it.

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

import { snoise2, hash2 } from './noise.js';
import { heightAt, nearestCenter } from './terrain.js';
import { TERRAIN, RENDER } from './config.js';

const RADIUS = 2900;
const CONE_R = RADIUS * 0.95;

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
  gain: 0.30,       // the ceiling on an additive layer in a graded picture
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
   was hidden behind both the others. It now runs 0.315 down to 0.276, which
   is a little over two degrees of separation between the top band and the
   bottom one, and every band peeks over the one in front of it.

   The colours are the palette's job and they are the largest area of it in
   the frame after the snow itself: blue-biased neutrals from a pale
   near-haze at the back to something with real weight at the front. None of
   them is white and none of them is grey. The amber arrives at run time and
   only where a low sun is actually landing. */
export const RANGES = [
  { radius: 2380, height: 750, far: 42000, seed: 21, segments: 360, tint: '#c3cfe2' },
  { radius: 2010, height: 606, far: 21000, seed: 33, segments: 330, tint: '#9db2d1' },
  { radius: 1640, height: 474, far: 11500, seed: 47, segments: 300, tint: '#7590b9' },
  { radius: 1280, height: 353, far: 6200, seed: 59, segments: 270, tint: '#516d9c' },
];

/* The scale height of the air, in metres — the distance over which it eats
   1/e of whatever is behind it. Twelve kilometres is thick for real alpine
   air and deliberately so: the point of the number is not meteorology, it is
   that one exponential decides how far each band is pulled towards the sky,
   how much of its form light it keeps and how fast a storm takes it, so the
   four bands cannot drift out of agreement with each other. */
const EXTINCTION = 12000;
const airAt = (far) => 1 - Math.exp(-far / EXTINCTION);

// How far a band is pulled towards the sky's own mid stop, at full air. It
// works out at half the colour of the furthest band and a fifth of the
// nearest, which is the whole reason a dusk range is a dusk colour.
const SKY_BLEED = 0.52;

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

const DOME_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOME_FRAG = `
  precision mediump float;
  uniform vec3 uZenith, uMid, uHorizon, uGlow, uSunDir;
  uniform float uGlowStrength;
  varying vec3 vDir;
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
    // One dot product of atmosphere: the sky is brighter and warmer near
    // whatever is lighting it, and the effect is strongest at the horizon
    float lobe = max(0.0, dot(dir, uSunDir));
    c += uGlow * (pow(lobe, 7.0) * 0.85 + pow(lobe, 2.0) * 0.14)
       * uGlowStrength * (1.0 - smoothstep(0.1, 0.75, up) * 0.55);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const STAR_VERT = `
  attribute float aSize;
  attribute float aTwinkle;
  varying float vFade;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uScale;
  void main() {
    vFade = uAlpha * (0.55 + 0.45 * sin(uTime * 1.7 + aTwinkle * 40.0));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale;
  }
`;

const STAR_FRAG = `
  precision mediump float;
  varying float vFade;
  void main() {
    if (vFade <= 0.01) discard;
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, vFade);
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

const RANGE_VERT = `
  attribute float aMix;
  attribute float aFace;
  attribute float aAng;
  uniform vec2 uSun;
  uniform float uLight;
  varying float vMix;
  varying float vShade;
  void main() {
    vMix = aMix;
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
  uniform vec3 uHaze, uPeak, uSunlit;
  varying float vMix;
  varying float vShade;
  void main() {
    vec3 c = mix(uHaze, uPeak, vMix) * (1.0 + vShade);
    /* And the one warm thing on the horizon.

       The palette has exactly one amber in it and this is where a third of
       it lives: the ridges whose skyline falls towards a low sun, and only
       those. It is added rather than mixed, because alpenglow is light
       arriving on snow and not a different snow — a lerp towards orange
       desaturates the band and turns the whole range to cardboard, which is
       what the first version of this did. uSunlit is already zero at noon,
       at night and in a storm, so there is no gate wanted here. */
    gl_FragColor = vec4(c + uSunlit * max(0.0, vShade), 1.0);
  }
`;

export function createSky(THREE) {
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3(0, 0.4, -1).normalize();
  // The sun flattened onto the ground plane, in world axes. Each band turns
  // its own copy of this into its own spun frame; nothing reads it directly.
  const sunXZ = new THREE.Vector2(0, -1);

  // --- dome ----------------------------------------------------------------
  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color('#123a7a') },
      uMid: { value: new THREE.Color('#74a3de') },
      uHorizon: { value: new THREE.Color('#eaf0f8') },
      uGlow: { value: new THREE.Color('#ffeccc') },
      uSunDir: { value: sunDir },
      uGlowStrength: { value: 1 },
    },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 20), domeMat);
  dome.renderOrder = -20;
  group.add(dome);

  // --- stars ---------------------------------------------------------------
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const stars = (() => {
    const n = 420;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const twinkle = new Float32Array(n);
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
      size[i] = 1 + Math.random() * 2.2;
      twinkle[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1));
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
     the fragment shader, and it does not need the precision they do. */
  const auroraTex = (() => {
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
      uNoise: { value: auroraTex },
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
      RADIUS * 0.985, 56, 14,
      phiStart, phiLength,
      Math.PI / 2 - AURORA.head, AURORA.head - AURORA.foot,
    );
    const mesh = new THREE.Mesh(geo, auroraMat);
    // Inside the dome, outside the stars, and under the sun's own glow. The
    // half is not an accident: the order between them was already full.
    mesh.renderOrder = -18.5;
    mesh.visible = false;
    return mesh;
  })();
  group.add(aurora);

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

  const discTex = (() => {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    // Hard-edged, but not aliased: the quantise pass downstream is
    // unforgiving about a stair-stepped circle
    const grd = g.createRadialGradient(s / 2, s / 2, s * 0.36, s / 2, s / 2, s * 0.46);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();

  const disc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: discTex, transparent: true, depthWrite: false, fog: false,
  }));
  disc.renderOrder = -17;
  group.add(disc);

  // --- the haze the hill dissolves into ------------------------------------
  // Built at the mean pitch and scaled to the measured one every frame, so
  // there is one cone and no geometry work in the loop. Ninety-six segments
  // rather than forty-four, because the rim of this is the horizon: a
  // forty-four-sided horizon sags seven metres between corners, which was a
  // third of a pixel at 288 lines and is two and a half at native.
  const coneH = CONE_R * TERRAIN.grade.base;
  const hazeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false });
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(CONE_R, coneH, 96, 1, true), hazeMat,
  );
  cone.renderOrder = -16;
  group.add(cone);

  // --- the ranges ----------------------------------------------------------
  const ranges = [];

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
  const knee = (x) => x / Math.sqrt(1 + x * x);
  const GAIN = 1.8;

  function range(spec) {
    const { radius, height, tint, seed, segments, far } = spec;
    const wrap = (i) => ((i % segments) + segments) % segments;
    const angle = (i) => (wrap(i) / segments) * Math.PI * 2;
    const octave = (i, k, s) => {
      const a = angle(i);
      return snoise2(Math.cos(a) * NOISE_R * k, Math.sin(a) * NOISE_R * k, seed + s);
    };

    const prof = new Float32Array(segments);
    const ring = new Float32Array(segments);
    for (let i = 0; i < segments; i++) {
      // A rolling octave, a ridged one — the fold of an absolute value is
      // what a rock skyline actually looks like and a smooth sum never is —
      // and a small one for the shoulders
      const h = octave(i, 1, 0) * 0.52
        + (0.5 - Math.abs(octave(i, 2.2, 1))) * 0.62
        + octave(i, 4.6, 2) * 0.17;
      prof[i] = height * (0.62 + 0.38 * knee(h * GAIN));
      // and the ring is not a circle, so four of them do not read as four
      // circles. Five per cent is nothing to the colour and everything to
      // whether the peaks look like they are at one distance.
      ring[i] = radius * (1 + octave(i, 0.45, 3) * 0.05);
    }

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
    let p = 0;
    let m = 0;
    // Built with its foot on y = 0 and stood on the curtain by `update`,
    // which is the only part of this that moves
    const put = (i, y, k) => {
      const a = angle(i);
      pos[p] = Math.cos(a) * ring[wrap(i)];
      pos[p + 1] = y;
      pos[p + 2] = Math.sin(a) * ring[wrap(i)];
      mix[m] = k;
      facing[m] = face[wrap(i)];
      ang[m] = a;
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
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHaze: { value: new THREE.Color('#e3ecf6') },
        uPeak: { value: new THREE.Color(tint) },
        uSunlit: { value: new THREE.Color(0, 0, 0) },
        uSun: { value: sunLocal },
        uLight: { value: 0.2 },
      },
      vertexShader: RANGE_VERT,
      fragmentShader: RANGE_FRAG,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -15;
    mesh.frustumCulled = false;
    ranges.push({
      mesh, mat, sunLocal, radius,
      tint: new THREE.Color(tint),
      // Metres of band per metre of camera — the whole of the parallax, and
      // a ratio rather than a taste
      parallax: radius / far,
      // Radians of spin per metre the run descends. Same thing, expressed at
      // this band's own radius, which is where the debt has to be paid.
      spin: 1 / far,
      air: airAt(far),
    });
    return mesh;
  }

  // Two hundred and seventy to three hundred and sixty segments each, which
  // is seven and a half thousand vertices for the whole horizon and about a
  // degree of arc apiece — near enough that the skyline stops being a
  // polyline and starts being a ridge
  for (const spec of RANGES) group.add(range(spec));

  // --- light ---------------------------------------------------------------
  const lights = new THREE.Group();
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  lights.add(key, key.target);
  const hemi = new THREE.HemisphereLight('#74a3de', '#dfe8f4', 1.35);
  lights.add(hemi);

  const peakTmp = new THREE.Color();
  const fill = new THREE.Color();
  const sunlit = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff);
  let time = 0;
  let pitch = -1;

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
    time += dt;
    group.position.set(pos.x, pos.y, pos.z);
    lights.position.set(pos.x, pos.y, pos.z);

    sunDir.set(
      Math.sin(w.azimuth) * Math.cos(w.elevation),
      Math.sin(w.elevation),
      -Math.cos(w.azimuth) * Math.cos(w.elevation),
    ).normalize();
    sunXZ.set(sunDir.x, sunDir.z).normalize();

    domeMat.uniforms.uZenith.value.copy(w.zenith);
    domeMat.uniforms.uMid.value.copy(w.mid);
    domeMat.uniforms.uHorizon.value.copy(w.horizon);
    domeMat.uniforms.uGlow.value.copy(w.glow);
    domeMat.uniforms.uGlowStrength.value = 1 - w.storm * 0.8;

    starMat.uniforms.uAlpha.value = w.star * (1 - w.storm) * 0.9;
    starMat.uniforms.uTime.value = time;
    // A star is a fixed number of pixels, so it has to be told how many
    // pixels there now are. On a 2× panel the old constant drew a quarter
    // of the star it drew on the buffer it was chosen for.
    starMat.uniforms.uScale.value = Math.max(1, Math.min(3, RENDER.buffer.height / 800));

    // On three nights in four this is zero and the band is not drawn at all
    aurora.visible = w.aurora > 0.004;
    if (aurora.visible) {
      auroraMat.uniforms.uTime.value = time;
      auroraMat.uniforms.uStrength.value = w.aurora * AURORA.gain;
    }

    // Sun by day, moon by night: the same disc, smaller and cooler, and a
    // glow that a storm can smother entirely
    const moon = w.moon;
    disc.position.copy(sunDir).multiplyScalar(RADIUS * 0.85);
    disc.scale.setScalar(RADIUS * (0.085 - moon * 0.032));
    disc.material.color.copy(w.key);
    disc.material.opacity = (1 - w.storm) * (0.55 + 0.45 * (1 - moon));
    disc.visible = w.elevation > -0.02 && w.storm < 0.92;

    // Small and faint. An additive sprite this far out covers a lot of sky
    // for very little scale, and a sun that blows out the middle of the
    // frame takes the mountain with it.
    glow.position.copy(sunDir).multiplyScalar(RADIUS * 0.84);
    glow.scale.setScalar(RADIUS * (0.20 - moon * 0.10));
    glow.material.color.copy(w.glow);
    glow.material.opacity = (1 - w.storm) * (0.5 - moon * 0.28);
    glow.visible = glow.material.opacity > 0.02;

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

    hazeMat.color.copy(w.haze);
    for (const r of ranges) {
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

      r.mat.uniforms.uHaze.value.copy(w.haze);
      // The ranges are behind a lot of air, and a storm is more air. They
      // give up their colour long before the near hill does, and the far
      // band gives up more of it than the near one — which is the same
      // extinction figure that decides everything else about this band.
      peakTmp.copy(r.tint).lerp(w.haze, w.storm * (0.62 + 0.33 * r.air));
      // and they take the sky's own tint, so a dusk range is a dusk colour
      peakTmp.lerp(w.mid, SKY_BLEED * r.air);
      r.mat.uniforms.uPeak.value.copy(peakTmp);
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

    key.position.copy(sunDir).multiplyScalar(520);
    key.target.position.set(0, 0, 0);
    key.color.copy(w.key);
    key.intensity = w.keyI;
    // The fill takes the sky's hue but not its saturation. Snow bounce is
    // pale; lighting a whole mountain with undiluted #6f9ad6 turns every
    // surface the sun is not on into flat blue paper.
    fill.copy(w.mid).lerp(WHITE, 0.5);
    hemi.color.copy(fill);
    fill.copy(w.haze).lerp(WHITE, 0.35);
    hemi.groundColor.copy(fill);
    hemi.intensity = w.hemiI;
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

  return { group, lights, sunDir, sun, update, project };
}
