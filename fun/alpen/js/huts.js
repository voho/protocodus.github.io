/* The hut with the light on, and the only reason on this mountain to stop.

   Everything else standing on the hill is something to miss or something to
   hit, and every one of them rewards the same thing: speed. A hut rewards
   the opposite. It pays for arriving slowly, which on a slope that is
   permanently, deliberately downhill is the hardest thing the game asks for
   — and that difficulty is the whole joke. Coming to a stop beside a hut is
   a trick in exactly the sense a 540 is a trick: a thing you have to mean.

   Four decisions carry the rest of this file.

   A hut is rare. The first version placed them the way `props.js` places
   everything, a chance per forty-metre band, and the run turned into a high
   street — a thing you pass every four seconds is scenery, and scenery is
   the one thing this must not be. It is now one chance per five hundred
   metres, taken about half the time, which is a hut every twenty to forty
   seconds of riding and often a good deal longer.

   A hut finds its own shelf. It cannot be placed at a fixed distance off the
   piste, because the ground outside the corridor is a quarterpipe whose
   width varies along the run, and a building pitched across a transition
   looks like a building falling over. So the site walks outward from the
   groomed edge, sampling the hill under its own footprint, and stops at the
   first place where the ground stops falling away sideways. On this mountain
   that is reliably somewhere on the upper half of the lip, because the lip
   is a smoothstep and a smoothstep arrives flat — so the huts end up where
   real ones are: up on the bank, a few metres above the piste, looking down
   at it. Where the bank is mellow they sit close; where it is a wall they
   are pushed out into the trees. Neither was designed. Both fall out of
   asking the hill rather than telling it.

   A hut faces the rider. Square on to the piste it presents a gable to
   somebody who only ever arrives from above, so the front is aimed twenty
   metres up the run instead: the windows, the door, the terrace and the pool
   of light are all pointed at the person they are for.

   And the light is faked twice over. There is no lamp — a real light per hut
   would be a fourth and fifth shadowless point light in a scene that lights
   a whole mountain with two — so the windows are an unlit material whose
   opacity is the night, and the warmth they throw on the snow is one quad
   with a radial gradient painted into it, the same trick `sky.js` uses for
   the sun. That pool started as a Sprite, which was wrong for a reason worth
   recording: a sprite faces the camera, and light lying on snow does not, so
   from anywhere but head-on the hut stood in a glowing paper lantern. It is
   a quad on the ground now, tilted to the hill's own normal.

   The hut itself is one baked geometry through `compose`, so all of it —
   walls, roof, chimney, woodpile, bench, terrace — is one draw call, and the
   three or four standing at once are one InstancedMesh. The roof is the part
   worth pointing at: it is a three-sided cylinder lying on its side, which
   is a complete gable, two pitches and both ends closed, out of a single
   primitive. */

import { compose } from './geom.js';
import {
  heightAt, normalFrom, nearestCenter, corridorHalfAt, gradeAt, pisteCenter,
} from './terrain.js';
import { hash2, stream } from './noise.js';
import { RENDER, SKY } from './config.js';

/* ==========================================================================
   Every number the huts lean on
   ========================================================================== */

export const HUTS = {
  /* How often the mountain is allowed one.

     A chance every five hundred metres, taken a little over half the time,
     and refused again by the ground about a third of the time after that —
     which comes out at a hut every kilometre or so, or every twenty-five
     seconds at a hundred and thirty an hour. Both numbers are about rhythm
     rather than density: the gaps where the dice go the other way are what
     make finding one feel like finding something. */
  period: 520,
  chance: 0.58,
  /* Sites tried inside a block before the mountain is allowed to refuse.
     Every one of them is drawn from the block's own index, so a stretch of
     hill that grew a hut yesterday grows the same hut in the same place
     today, and a stretch with nowhere to put one never will. */
  tries: 6,
  spread: 300,        // metres of the block a site may be drawn from

  /* How much hill carries huts at once. `ahead` is comfortably past the
     thickest fog the weather can produce — a hut should come out of the
     curtain rather than appear in clear air — and the list is rebuilt every
     `step` metres, so the window is widened by that much again to keep the
     far edge from popping between rebuilds. */
  ahead: 560,
  behind: 120,
  step: 130,
  live: 3,

  /* Finding the shelf.

     The search starts just past the groomed edge and walks out in even
     strides, and takes the first offset whose ground is level enough under
     the building's own footprint. `maxDrop` is measured *against the grade*:
     the whole mountain is tilted by a fifth of its own length, so the useful
     question is not how much the ground falls across the footprint but how
     much more than the fall line it falls. A metre and a half over a
     five-metre building is a cross slope the plinth can absorb; past that
     the site is refused and the search moves on. */
  reach: [3, 25],     // metres past the corridor edge that are worth trying
  strides: 8,
  footprint: 2.8,     // half the building, in metres
  maxDrop: 1.5,
  /* And the steepest fall line worth building on at all. The grade runs from
     7° to 26°; this refuses the top third of that, which is both where a hut
     would look absurd and where nobody wants to stop anyway. */
  maxGrade: 0.42,
  facing: 20,         // metres up the run the front is aimed at

  /* The glow.

     `night` is the dial, `storm` is allowed a share of it because a blizzard
     at noon is dark enough to want the lights on, and the gamma is under one
     so the windows come up early in the evening rather than snapping on at
     the last moment. `floor` is what the glass shows at midday: not nothing,
     because a window with no light behind it at all reads as a painted-on
     rectangle, but close. */
  glow: { storm: 0.45, gamma: 0.75, floor: 0.16, warm: '#ffbe6e' },

  /* The pool of warm light on the snow. Its opacity is the square of the
     night, because a light that is half on at dusk should read as much less
     than half. Its size never changes: a light that grows is a light that is
     coming towards you. */
  pool: { radius: 9, forward: 7, lift: 0.3, opacity: 0.62, colour: '#ffa445' },

  /* Chimney smoke.

     A slow plume that is buoyant for the first second and then belongs to
     the wind, which is what makes the weather visible from a standstill. The
     puffs grow as they cool and rise, which is the whole of why a column of
     them reads as smoke rather than as a queue of dots. `range` keeps the
     particles for huts near enough to be seen; anything further is spending
     them into fog. */
  smoke: {
    count: 180,
    rate: 9,          // puffs per second, per hut
    life: 5.4,
    rise: 2.1,        // m/s of buoyancy at the chimney
    drag: 0.9,        // how fast a puff gives itself up to the wind
    coupling: 0.85,   // and how much of the wind it takes when it does
    jitter: 0.16,
    size: 0.5,        // metres across, at the chimney
    growth: 3.2,      // and how many times that by the end of its life
    alpha: 0.34,
    range: 300,
    stoke: 16,        // extra puffs when somebody comes in for a cocoa
  },

  /* The cocoa stop.

     Generous about what counts as stopped and strict about only paying once.
     Thirteen metres is most of the terrace and the snow in front of it; 3.6
     m/s is a slow skate, well above the rider's own minimum-speed push, so
     the hill can be doing its best to move you along and this still counts.
     The dwell is short but it is not zero — without it a bail that happened
     to slow through the radius bought a hot chocolate. */
  cocoa: { speed: 3.6, radius: 13, dwell: 0.3 },
};

/* Where the chimney comes out, in the hut's own coordinates. The geometry
   and the smoke both read it, because a plume that starts anywhere else is
   the kind of bug nobody spots for a week. */
const CHIMNEY = { x: 1.75, y: 6.6, z: 0.9 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ==========================================================================
   The building
   ========================================================================== */

/* Local coordinates: y = 0 is the highest corner of the ground the hut is
   standing on — see the planting rule below, and the plinth that pays for it
   — +y is up, and the front, meaning the door, the windows, the terrace and
   the whole of the reason to stop, faces -z. */
function hutGeometry(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const post = new THREE.CylinderGeometry(0.5, 0.5, 1, 18);
  const log = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  /* Three radial segments is a triangular prism with both ends capped, and a
     triangular prism lying on its side is a gable roof. Rotated -90° about x
     it has a flat face underneath, an apex on top and its length running
     front to back, so the triangle is what a rider coming down the hill
     sees. */
  const prism = new THREE.CylinderGeometry(1, 1, 1, 3).toNonIndexed();
  // The rest of the hut can use smooth lighting for its round timber. Keep
  // the two roof pitches architectural by baking a separate normal per face.
  prism.computeVertexNormals();

  const stone = '#4a4d55';
  const stoneDark = '#383b43';
  const timber = '#6d4a30';
  const beam = '#4a3221';
  const dark = '#2c1e14';
  const snow = '#f4f8ff';
  const drift = '#e7effb';
  const split = '#8a6440';
  const sign = '#ffab00';

  // The roof, worked out once: half-width across, length along the ridge,
  // the height of the walls it sits on, and the rise from eave to ridge.
  const RW = 3.3;
  const RL = 5.6;
  const EAVE = 3.05;
  const RISE = 2.9;
  // A unit prism is 0.866 wide, 1.5 tall from its flat face to its apex, and
  // centred on neither, so all three scales and the height are derived.
  const rx = RW / 0.866;
  const rz = RISE / 1.5;
  const ry = EAVE + rz * 0.5;

  return compose(THREE, [
    /* --- the ground it stands on -------------------------------------------

       Four metres of stone under a floor that is only two and a half metres
       of timber, nearly all of it underground. A five-metre building on a
       seventeen-degree slope has two and a half metres of fall beneath it and
       there is no site on this mountain that does not, so the hut is planted
       at its highest corner and this carries everything below: buried on the
       uphill side, and on the downhill side exactly the stone base every real
       one of these is built on. Levelling the building against the mean
       instead — which is what this did first — buried the uphill windows to
       the sill about a third of the time. */
    { geo: box, color: stone, pos: [0, -2.02, 0], scale: [5.5, 5.15, 4.7] },
    { geo: box, color: drift, pos: [0, 0.63, 0], scale: [5.9, 0.66, 5.05] },

    // --- walls --------------------------------------------------------------
    { geo: box, color: timber, pos: [0, 1.8, 0], scale: [5.1, 2.5, 4.3] },
    // Three courses wrapped right round the building. Proud of the walls by
    // three centimetres, which is all it takes to break a flat plane into
    // stacked timber at any distance the hut is legible from at all.
    { geo: box, color: beam, pos: [0, 1.0, 0], scale: [5.16, 0.16, 4.36] },
    { geo: box, color: beam, pos: [0, 1.8, 0], scale: [5.16, 0.16, 4.36] },
    { geo: box, color: beam, pos: [0, 2.6, 0], scale: [5.16, 0.16, 4.36] },
    { geo: post, color: beam, pos: [-2.5, 1.85, -2.1], scale: [0.3, 2.6, 0.3] },
    { geo: post, color: beam, pos: [2.5, 1.85, -2.1], scale: [0.3, 2.6, 0.3] },
    { geo: post, color: beam, pos: [-2.5, 1.85, 2.1], scale: [0.3, 2.6, 0.3] },
    { geo: post, color: beam, pos: [2.5, 1.85, 2.1], scale: [0.3, 2.6, 0.3] },

    // --- roof ---------------------------------------------------------------
    { geo: prism, color: dark, pos: [0, ry, 0], rot: [-Math.PI / 2, 0, 0], scale: [rx, RL, rz] },
    // and the snow lying on it: slightly narrower, slightly shorter and
    // lifted, so a strip of dark timber shows at every eave and the ridge
    // stands proud in white
    {
      geo: prism, color: snow, pos: [0, ry + 0.16, 0],
      rot: [-Math.PI / 2, 0, 0], scale: [rx * 0.955, RL * 0.97, rz * 0.97],
    },

    // --- chimney ------------------------------------------------------------
    { geo: box, color: stone, pos: [CHIMNEY.x, 4.85, CHIMNEY.z], scale: [0.65, 2.9, 0.65] },
    { geo: box, color: stoneDark, pos: [CHIMNEY.x, 6.15, CHIMNEY.z], scale: [0.75, 0.2, 0.75] },
    { geo: box, color: snow, pos: [CHIMNEY.x, 6.4, CHIMNEY.z], scale: [0.82, 0.18, 0.82] },

    // --- the front ----------------------------------------------------------
    { geo: box, color: dark, pos: [-1.3, 1.62, -2.21], scale: [0.95, 2.05, 0.14] },
    { geo: box, color: beam, pos: [-1.3, 0.58, -2.45], scale: [1.3, 0.14, 0.5] },
    // The sign over the door is the same yellow as a kicker's lip, because it
    // is the same promise: this is a thing you are meant to ride at.
    { geo: box, color: sign, pos: [-1.3, 2.86, -2.24], scale: [1.5, 0.34, 0.1] },
    // Window frames. The glass itself is a separate geometry and a separate
    // material — see `paneGeometry` — because it is the one part of the hut
    // that must not be lit by the mountain's own light.
    { geo: box, color: beam, pos: [0.35, 1.75, -2.19], scale: [1.24, 1.06, 0.12] },
    { geo: box, color: beam, pos: [1.85, 1.75, -2.19], scale: [1.24, 1.06, 0.12] },
    { geo: box, color: beam, pos: [2.59, 1.75, 0.3], scale: [0.12, 1.06, 1.24] },

    // --- terrace ------------------------------------------------------------
    // On posts, because it hangs out over ground that is falling away towards
    // the piste, which is exactly why it is the side you sit on
    { geo: box, color: timber, pos: [0, 0.43, -3.3], scale: [5.3, 0.24, 2.2] },
    // and long ones, because the ground in front of a hut on a bank is three
    // metres lower than the ground behind it. A terrace on stilts over the
    // piste is not a compromise, it is what these places look like.
    { geo: post, color: beam, pos: [-2.3, -2.0, -4.15], scale: [0.26, 4.8, 0.26] },
    { geo: post, color: beam, pos: [2.3, -2.0, -4.15], scale: [0.26, 4.8, 0.26] },
    { geo: box, color: beam, pos: [0, 1.35, -4.35], scale: [5.3, 0.12, 0.14] },
    { geo: box, color: beam, pos: [-2.4, 0.93, -4.35], scale: [0.12, 0.85, 0.12] },
    { geo: box, color: beam, pos: [0, 0.93, -4.35], scale: [0.12, 0.85, 0.12] },
    { geo: box, color: beam, pos: [2.4, 0.93, -4.35], scale: [0.12, 0.85, 0.12] },
    { geo: box, color: timber, pos: [1.5, 1.0, -3.0], scale: [1.7, 0.14, 0.5] },
    { geo: box, color: timber, pos: [1.5, 1.26, -3.22], scale: [1.7, 0.42, 0.12] },
    { geo: box, color: beam, pos: [0.8, 0.78, -3.0], scale: [0.14, 0.45, 0.45] },
    { geo: box, color: beam, pos: [2.2, 0.78, -3.0], scale: [0.14, 0.45, 0.45] },

    // --- firewood -----------------------------------------------------------
    // The one part of the hut that says somebody is coming back to it
    { geo: box, color: stoneDark, pos: [-3.15, -1.95, 0.5], scale: [1.15, 4.5, 2.2] },
    { geo: log, color: split, pos: [-3.45, 0.42, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: '#7a5636', pos: [-3.15, 0.42, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: split, pos: [-2.85, 0.42, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: '#7a5636', pos: [-3.3, 0.7, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: split, pos: [-3.0, 0.7, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: '#7a5636', pos: [-3.15, 0.98, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: box, color: snow, pos: [-3.15, 1.15, 0.5], scale: [1.0, 0.16, 2.0] },
  ]);
}

/* The glass, alone.

   Separate from the hut for one reason: `MeshLambertMaterial` is lit by the
   mountain's light, and at night the mountain's light is a moon. A window is
   supposed to be the brightest thing on the hill at exactly the moment the
   hill is darkest, so the panes are an unlit material and the vertex colours
   here are only the difference between one room and another — a hut where
   every window is the same temperature is a hut nobody lives in. */
function paneGeometry(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  return compose(THREE, [
    { geo: box, color: '#fff3da', pos: [0.35, 1.75, -2.25], scale: [0.98, 0.86, 0.1] },
    { geo: box, color: '#ffdfab', pos: [1.85, 1.75, -2.25], scale: [0.98, 0.86, 0.1] },
    { geo: box, color: '#ffdba0', pos: [2.65, 1.75, 0.3], scale: [0.1, 0.86, 0.98] },
    { geo: box, color: '#ffe9bd', pos: [-1.3, 2.35, -2.29], scale: [0.72, 0.3, 0.1] },
    // and a lantern on the terrace rail, which is the bit you see first
    { geo: box, color: '#ffd28a', pos: [2.3, 1.55, -4.35], scale: [0.22, 0.3, 0.22] },
  ]);
}

/* The pool of light: a radial gradient painted into a canvas, exactly as the
   sun's glow is built in `sky.js`. Warmer in the middle than at the edge is
   not physical, it is just what a lit window looks like on snow. */
function poolTexture(THREE) {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.22, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ==========================================================================
   Smoke

   The same shape of point cloud as everything in `particles.js`: a size and
   an alpha per particle, one small ShaderMaterial, and the fog folded in by
   hand because a custom shader does not inherit three's. The only difference
   is the falloff, which is much softer — a snowflake has an edge and a puff
   of woodsmoke does not.
   ========================================================================== */

const SMOKE_VERT = `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  varying float vDepth;
  varying vec3 vView;
  uniform float uScale;
  uniform float uMaxSize;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    // Normalised here, in the vertex shader's highp, because the raw view
    // vector squares past what a true-mediump fragment unit can hold. A point
    // sprite's varyings are flat across the sprite anyway, so nothing is lost.
    vView = normalize(mv.xyz);
    // Our own ceiling rather than the hardware's: the GL point-size clamp
    // varies by driver and a puff drifting past the lens used to grow smoothly
    // and then snap flat against it. Capped by uniform, it just stops growing.
    gl_PointSize = min(uMaxSize, max(1.0, aSize * uScale / max(0.001, vDepth)));
    gl_Position = projectionMatrix * mv;
  }
`;

/* The colour picks up the weather's glow when the fragment is looking towards
   a low sun — woodsmoke is a fine aerosol and forward-scatters hard, so a
   plume between the rider and a sunset goes amber while the same plume seen
   down-sun stays ash. `uSunV` and `uGlow` are the shared shading's own uniform
   records, handed over by reference, and `uWarm` is the one number computed
   here: how low and how present the sun is this frame. */
const SMOKE_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform vec3 uGlow;
  uniform vec3 uSunV;
  uniform float uWarm;
  uniform float uNear;
  uniform float uFar;
  varying float vAlpha;
  varying float vDepth;
  varying vec3 vView;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25 || vAlpha <= 0.001) discard;
    float a = vAlpha * (1.0 - smoothstep(0.0, 0.25, r));
    float fwd = max(0.0, dot(vView, uSunV));
    vec3 c = mix(uColor, uGlow, fwd * fwd * uWarm);
    float f = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(c, uFog, f * 0.85), a * (1.0 - f));
  }
`;

/* ==========================================================================
   The huts
   ========================================================================== */

export function createHuts(THREE, shading) {
  const group = new THREE.Group();
  const S = HUTS.smoke;

  // `sheen: 1` because the roof is carrying half a metre of the same snow the
  // ground is made of, and a roof that refuses the low sun the hill is
  // catching is what gives a model village away. The mask keeps the timber,
  // stone and beams matte — every one of them sits well under its lower stop.
  const shell = new THREE.InstancedMesh(
    hutGeometry(THREE),
    shading.apply(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false }),
      { sheen: 1 },
    ),
    HUTS.live,
  );

  // The panes take the snap and the fog and refuse the bands: an unlit
  // material has no diffuse term to step, and the whole reason the glass is
  // unlit is that a window is meant to be the brightest thing on the hill at
  // the moment the hill is darkest. They do want the fog, though — a lit
  // window a quarter of a mile off through falling snow is a smudge, and a
  // window that stays sharp out there is the thing that gives the distance
  // away.
  const paneMat = shading.apply(new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: HUTS.glow.floor,
  }), { bands: 0 });
  const panes = new THREE.InstancedMesh(paneGeometry(THREE), paneMat, HUTS.live);
  // The shell already casts the window openings' silhouette. Sending the
  // transparent, self-lit glass through a depth-only shadow material would
  // turn every pane back into an opaque square.
  panes.userData.noShadow = true;

  /* The pool is additive, and additive surfaces cannot be fogged: three's fog
     mixes towards the haze colour, and adding the haze to the picture is the
     opposite of disappearing into it. So it is drawn unfogged and faded by
     hand, per instance, against the same two distances the fog is using. */
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTexture(THREE),
    color: new THREE.Color(HUTS.pool.colour),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, HUTS.live);
  pools.setColorAt(0, new THREE.Color(0xffffff));
  // An additive pool is light painted on the snow, not geometry standing in
  // front of the sun. Without this opt-out the generic scene traversal makes
  // each 18-metre quad cast a solid square into the shadow map.
  pools.userData.noShadow = true;

  for (const mesh of [shell, panes, pools]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    group.add(mesh);
  }

  // --- smoke ---------------------------------------------------------------
  const smokeGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(S.count * 3);
  const sSize = new Float32Array(S.count);
  const sAlpha = new Float32Array(S.count);
  const sVel = new Float32Array(S.count * 3);
  const sBase = new Float32Array(S.count);
  const sLife = new Float32Array(S.count);
  const sMax = new Float32Array(S.count);
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sAlpha, 1));
  smokeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const smokeMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#cfd2d6') },
      uFog: { value: new THREE.Color(SKY.haze) },
      // The shared shading's own records, not copies: the view-space sun and
      // the sky glow arrive here already moved by its one write per frame.
      uSunV: shading.uniforms.uSunView,
      uGlow: shading.uniforms.uSkyGlow,
      uWarm: { value: 0 },
      uNear: { value: RENDER.fogNear },
      uFar: { value: RENDER.fogFar },
      uScale: { value: 300 },
      uMaxSize: { value: 120 },
    },
    vertexShader: SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.frustumCulled = false;
  group.add(smoke);
  let head = 0;
  // How many puffs are currently alive. The ring buffer never shrinks, so
  // without this the step walked and re-uploaded 180 particles every frame of
  // every run for ever, including the runs that never came within three
  // hundred metres of a chimney.
  let live = 0;

  // --- scratch -------------------------------------------------------------
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qFlat = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const warm = new THREE.Color(HUTS.glow.warm);
  const tint = new THREE.Color();
  const smokeDay = new THREE.Color('#cfd2d6');
  const smokeNight = new THREE.Color('#f0e6d6');

  const huts = [];
  const claimed = new Set();
  let block = NaN;

  /* ==========================================================================
     Placement
     ========================================================================== */

  /* How level the hill is under a building planted here, and how far the
     highest corner of it stands above the middle.

     The first is measured against the grade rather than against flat — the
     mountain is tilted everywhere, and a hut is not on a slope for being on a
     mountain — and it is what decides whether this is a site at all. The
     second is measured raw, because it is what the building is planted at:
     the ground under a hut here falls two and a half metres from corner to
     corner and it has to be the *top* corner, or the uphill wall is buried to
     the windowsill. Both come out of the same four samples. */
  const probe = { drop: 0, rise: 0 };

  function shelf(x, z, grade) {
    const f = HUTS.footprint;
    const h0 = heightAt(x, z);
    let lo = 0;
    let hi = 0;
    let crest = 0;
    for (let i = 0; i < 4; i++) {
      const dx = i < 2 ? -f : f;
      const dz = i % 2 === 0 ? -f : f;
      const d = heightAt(x + dx, z + dz) - h0;
      if (d > crest) crest = d;
      const r = d - grade * dz;
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    probe.drop = hi - lo;
    probe.rise = crest;
  }

  /* One block of hill, one hut or none. Everything here is a pure function of
     the block index, so the same stretch of mountain always grows the same
     hut in the same place — and a block the mountain refused stays refused. */
  function siteFor(b) {
    if (b < 1) return null;    // the first half-kilometre is left to itself
    if (hash2(b, 4441, 71) > HUTS.chance) return null;

    const rnd = stream(b * 2654435761 + 7717);
    const top = -(b * HUTS.period) - (HUTS.period - HUTS.spread) * rnd();

    for (let k = 0; k < HUTS.tries; k++) {
      const z = top - rnd() * HUTS.spread;
      const grade = gradeAt(z);
      if (grade > HUTS.maxGrade) continue;

      const side = rnd() < 0.5 ? -1 : 1;
      /* Probed far out to one side, because after the fork there are two
         centre lines and `nearestCenter` has to be asked which one this hut
         is standing beside. Asking about the hut's own x would answer with
         whichever branch it drifted nearest to, which is how the first
         version put a hut in the middle of an island. */
      const branch = nearestCenter(pisteCenter(z) + side * 400, z);
      const edge = corridorHalfAt(z);

      // Walk outward until the ground stops falling away sideways
      const [near, far] = HUTS.reach;
      for (let i = 0; i < HUTS.strides; i++) {
        const off = edge + near + ((far - near) * i) / (HUTS.strides - 1);
        const x = branch + side * off;
        shelf(x, z, grade);
        if (probe.drop > HUTS.maxDrop) continue;

        // Aimed up the run rather than across it: a rider only ever arrives
        // from above, and the windows should be pointed at them
        const ax = nearestCenter(branch, z + HUTS.facing) - x;
        const az = HUTS.facing;
        const len = Math.hypot(ax, az) || 1;
        const yaw = Math.atan2(-ax / len, -az / len);

        // Planted at its highest corner, with a hand's breadth over for the
        // true corners the four axis-aligned samples cannot see
        const y = heightAt(x, z) + probe.rise + 0.15;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        return {
          key: b,
          x, y, z, yaw,
          // The chimney, and the pool of light in front of the terrace, both
          // carried through the same rotation the building took
          cx: x + CHIMNEY.x * cos + CHIMNEY.z * sin,
          cy: y + CHIMNEY.y,
          cz: z - CHIMNEY.x * sin + CHIMNEY.z * cos,
          px: x - sin * HUTS.pool.forward,
          pz: z - cos * HUTS.pool.forward,
          off,
          emit: hash2(b, 13, 3),
          dwell: 0,
        };
      }
    }
    return null;
  }

  function writeInstances() {
    for (let i = 0; i < huts.length; i++) {
      const h = huts[i];
      e.set(0, h.yaw, 0);
      q.setFromEuler(e);
      v.set(h.x, h.y, h.z);
      s3.set(1, 1, 1);
      m.compose(v, q, s3);
      shell.setMatrixAt(i, m);
      panes.setMatrixAt(i, m);

      // The pool lies on the snow rather than facing the camera, so it takes
      // the hill's own normal
      normalFrom(heightAt, h.px, h.pz, normal);
      qFlat.setFromUnitVectors(up, normal);
      v.set(h.px, heightAt(h.px, h.pz) + HUTS.pool.lift, h.pz);
      s3.setScalar(HUTS.pool.radius * 2);
      m.compose(v, qFlat, s3);
      pools.setMatrixAt(i, m);
    }
    shell.count = huts.length;
    panes.count = huts.length;
    pools.count = huts.length;
    shell.instanceMatrix.needsUpdate = true;
    panes.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
  }

  function rebuild(riderZ) {
    huts.length = 0;
    const first = Math.floor(-(riderZ + HUTS.behind) / HUTS.period);
    const last = Math.floor(-(riderZ - HUTS.ahead - HUTS.step) / HUTS.period);
    for (let b = Math.max(1, first); b <= last && huts.length < HUTS.live; b++) {
      const site = siteFor(b);
      if (site) huts.push(site);
    }
    writeInstances();
  }

  /* ==========================================================================
     Smoke
     ========================================================================== */

  function puff(h) {
    const i = head;
    head = (head + 1) % S.count;
    // Recycling a slot that is still burning does not change the census
    if (sLife[i] <= 0) live += 1;
    const j = i * 3;
    sPos[j] = h.cx + (Math.random() - 0.5) * S.jitter;
    sPos[j + 1] = h.cy + Math.random() * 0.1;
    sPos[j + 2] = h.cz + (Math.random() - 0.5) * S.jitter;
    sVel[j] = (Math.random() - 0.5) * 0.4;
    sVel[j + 1] = S.rise * (0.7 + Math.random() * 0.6);
    sVel[j + 2] = (Math.random() - 0.5) * 0.4;
    sMax[i] = S.life * (0.7 + Math.random() * 0.6);
    sLife[i] = sMax[i];
    sBase[i] = S.size * (0.7 + Math.random() * 0.7);
  }

  function stepSmoke(dt, windX, windZ) {
    /* The whole system sleeps once the last puff has died. Emission happens
       before this in `update`, so a hut coming into range wakes it on the same
       frame its first puff exists — and the frame the last one dies is the
       frame that uploads its zeroed alpha, so nothing stale is left showing
       when this early-out starts firing. */
    if (live === 0) return;
    const k = 1 - Math.exp(-S.drag * dt);
    for (let i = 0; i < S.count; i++) {
      if (sLife[i] <= 0) {
        if (sAlpha[i] !== 0) sAlpha[i] = 0;
        continue;
      }
      const j = i * 3;
      sLife[i] -= dt;
      if (sLife[i] <= 0) {
        sAlpha[i] = 0;
        live -= 1;
        continue;
      }
      const u = clamp(1 - sLife[i] / sMax[i], 0, 1);
      // Buoyant while it is still hot, and the wind's after that
      sVel[j] += (windX * S.coupling - sVel[j]) * k;
      sVel[j + 1] += (S.rise * (1 - u) - sVel[j + 1]) * k;
      sVel[j + 2] += (windZ * S.coupling - sVel[j + 2]) * k;
      sPos[j] += sVel[j] * dt;
      sPos[j + 1] += sVel[j + 1] * dt;
      sPos[j + 2] += sVel[j + 2] * dt;
      // Puffs grow as they cool, which is the whole of why a column of them
      // reads as smoke rather than as a queue of dots
      sSize[i] = sBase[i] * (1 + u * S.growth);
      const fade = (1 - u) * (1 - u);
      sAlpha[i] = S.alpha * Math.min(1, u * 6) * fade;
    }
    smokeGeo.attributes.position.needsUpdate = true;
    smokeGeo.attributes.aSize.needsUpdate = true;
    smokeGeo.attributes.aAlpha.needsUpdate = true;
  }

  /* ==========================================================================
     The frame
     ========================================================================== */

  /* `onCocoa(x, z)` fires exactly once per hut, the first time the rider is
     stopped beside it, and never again for that hut however many times the
     run passes back through — the claim is kept against the block index, not
     against the instance, so unloading the hut and rebuilding it does not
     hand out a second cocoa. */
  function update(dt, rider, weather, onCocoa) {
    // main.js holds the weather module under one name and its state under
    // another; either is accepted, because getting it wrong is a hut with no
    // light in it and nothing to say why
    const w = weather && weather.state ? weather.state : weather;

    const bi = Math.floor(rider.pos.z / HUTS.step);
    if (bi !== block) {
      block = bi;
      rebuild(rider.pos.z);
    }

    // --- how dark is it out -------------------------------------------------
    const dark = clamp(w.night + w.storm * HUTS.glow.storm, 0, 1);
    const lit = Math.pow(dark, HUTS.glow.gamma);

    // Glass takes the sky's colour by day — it is a mirror until there is
    // something behind it — and the fire's by night
    tint.copy(w.haze).lerp(warm, lit);
    paneMat.color.copy(tint);
    paneMat.opacity = HUTS.glow.floor + (1 - HUTS.glow.floor) * lit;
    poolMat.opacity = HUTS.pool.opacity * lit * lit;

    smokeMat.uniforms.uColor.value.copy(smokeDay).lerp(smokeNight, lit);
    smokeMat.uniforms.uFog.value.copy(w.haze);
    smokeMat.uniforms.uNear.value = w.fogNear;
    smokeMat.uniforms.uFar.value = w.fogFar;
    /* Point size is in metres and has to become pixels, which needs the
       camera's field of view — and this module is handed the rider and the
       weather and nothing else. So it is computed from the nominal FOV and
       the live framebuffer. The error is real and bounded: at full speed the
       frame opens to 86° and the puffs are drawn about half again too large,
       which is the one moment in the run nobody is looking at a chimney. */
    smokeMat.uniforms.uScale.value = RENDER.buffer.height
      / (2 * Math.tan((RENDER.fov * Math.PI) / 360));
    // A third of the frame is as big as a puff is ever allowed to draw — see
    // the note beside gl_PointSize in the vertex shader
    smokeMat.uniforms.uMaxSize.value = RENDER.buffer.height * 0.34;
    /* How much of the weather's glow the smoke may borrow. The first clamp is
       "the sun is low", gone by fifteen degrees up; the second is "the sun has
       not left", gone shortly under the horizon; and the night and storm terms
       are the same dimmers everything else on the hill is already under. At
       noon and at midnight this is zero and the mix in the shader is inert. */
    const sinE = Math.sin(w.elevation);
    smokeMat.uniforms.uWarm.value = 0.6
      * clamp(1 - sinE * 4, 0, 1)
      * clamp(sinE * 8 + 1, 0, 1)
      * (1 - lit) * (1 - w.storm * 0.8);

    // --- per hut ------------------------------------------------------------
    const stopped = rider.speed < HUTS.cocoa.speed
      && rider.grounded && rider.state !== 'fall' && rider.state !== 'rise';
    const r2 = HUTS.cocoa.radius * HUTS.cocoa.radius;

    for (let i = 0; i < huts.length; i++) {
      const h = huts[i];
      const dx = rider.pos.x - h.x;
      const dz = rider.pos.z - h.z;
      const d2 = dx * dx + dz * dz;

      // Smoke, for the huts near enough for it to be seen
      if (d2 < S.range * S.range) {
        h.emit += dt * S.rate;
        let n = 0;
        while (h.emit >= 1 && n < 4) {
          h.emit -= 1;
          puff(h);
          n += 1;
        }
        if (h.emit >= 1) h.emit = 0;
      }

      // The pool of light, faded by hand against the fog it cannot use
      const dist = Math.sqrt(d2);
      const f = clamp((dist - w.fogNear) / (w.fogFar - w.fogNear), 0, 1);
      tint.setScalar(1 - f);
      pools.setColorAt(i, tint);

      // The cocoa. Generous about stopping — the hill is doing its best to
      // stop you stopping — and paid exactly once.
      if (claimed.has(h.key)) continue;
      const near = d2 < r2;
      if (near && stopped) {
        h.dwell += dt;
        if (h.dwell >= HUTS.cocoa.dwell) {
          claimed.add(h.key);
          // Somebody has come in, so the fire gets stoked
          for (let p = 0; p < S.stoke; p++) puff(h);
          if (onCocoa) onCocoa(h.x, h.z);
        }
      } else if (near) {
        // Wobbling about outside the door still counts; leaving does not
        h.dwell = Math.max(0, h.dwell - dt * 2);
      } else {
        h.dwell = 0;
      }
    }
    if (pools.instanceColor) pools.instanceColor.needsUpdate = true;

    stepSmoke(dt, w.windX, w.windZ);
  }

  function reset() {
    claimed.clear();
    block = NaN;
    live = 0;
    for (let i = 0; i < S.count; i++) {
      sLife[i] = 0;
      sAlpha[i] = 0;
    }
    smokeGeo.attributes.aAlpha.needsUpdate = true;
  }

  // The huts themselves are on the returned object, the way the animals are:
  // it is the whole debugger, and it is also the only way anything else could
  // ever be told where a building is standing.
  return { group, update, reset, huts, smoke };
}
