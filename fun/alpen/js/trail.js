/* The physical mark a snowboard leaves in the snow.

   This is deliberately geometry rather than a decal. Fifteen vertices cross
   every sample: packed bed, both edge cuts, the two berm shoulders, their
   peaks and their feathered feet. The old two-vertex strip could only paint
   those features onto one flat plane, which is why a brake looked like a blue
   ribbon. These lanes follow the terrain independently and the berms rise out
   of it, so real scene lights describe the displaced snow.

   The mesh is still a fixed ring. Samples are now spaced by distance rather
   than only by the render clock; unlimited W speed therefore adds enough
   intermediate sections to keep the trench attached to the terrain instead
   of stretching one huge triangle down the mountain. Gaps remain explicit for
   jumps, rails and airborne tumbles.

   No longitudinal texture or shader noise is used. Edge breakup comes from
   three low-pass random walks sampled into the geometry, and narrow cut
   accents are derivative-filtered. That keeps the extra detail from reviving
   the lower-screen moire the terrain work removed. */

import { TRAIL } from './config.js';
import { heightAt } from './terrain.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// The rendered board is 31 cm wide and 1.6 m long. During a skid its swept
// width is the projection of that rectangle across the direction of travel.
const BOARD_HALF = 0.155;
const BOARD_HALF_LENGTH = 0.800;
const EDGE_PIVOT = 0.12;

/* Lanes in carrier half-widths. The exact bed, cut, ridge and feather
   boundaries are vertices rather than shader-only coordinates. Twenty-five
   lanes are still a tiny carrier, but they give a loaded edge enough section
   curvature to read as a cut instead of a dark line. */
export const SECTION = Object.freeze([
  -1.000, -0.985, -0.940, -0.900, -0.860, -0.820,
  -0.770, -0.755, -0.735, -0.715, -0.640, -0.320,
  0,
  0.320, 0.640, 0.715, 0.735, 0.755, 0.770,
  0.820, 0.860, 0.900, 0.940, 0.985, 1.000,
]);

export const TRENCH = {
  berm: 1.36,
  bed: 0.64,
  groove: 0.735,
  ridge: 0.86,
  foot: 0.985,
  grooveHalfCarve: 0.020,
  grooveHalfSkid: 0.095,
  settle: 0.30,
};

/* Albedos, not baked lighting. MeshLambertMaterial and the shared alpine
   shading pass carry the sun, shadow, headlamp and helicopter light. */
const SNOW = {
  packed: '#c1d2df',
  groove: '#a8bed0',
  ridge: '#d1dfea',
  clod: '#c8d8e4',
};

const SLIDE_HOLD = 0.6;
const SLIDE_FULL = 5.5;
const FADE_START = 0.82;
const ANCHOR_STRIDE = 128;
const DISTANCE_FADE_NEAR = 92;
const DISTANCE_FADE_FAR = 145;
const CLOD_CLUSTER = 3;

const n = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

const TRACK_VERT_PARS = `
  attribute float aCross;
  attribute float aVariation;
  attribute vec3 aTrackBaseNormal;
  attribute vec4 aTrack;    // wash, edge bite, brake, loaded/push side
  attribute vec2 aLife;     // remaining weight, normalised age
  varying float vTrackCross;
  varying float vTrackVariation;
  varying vec4 vTrackState;
  varying vec2 vTrackLife;
  varying vec3 vTrackBaseNormal;
  varying float vTrackDepth;`;

const TRACK_VERT = `
  vTrackCross = aCross;
  vTrackVariation = aVariation;
  vTrackState = aTrack;
  vTrackLife = aLife;
  vTrackBaseNormal = normalize(normalMatrix * aTrackBaseNormal);
  vTrackDepth = -mvPosition.z;

  // The board compresses and polishes the floor while the deposited bank is
  // newly aerated powder. The shared snow response turns this broad field
  // into a restrained roughness change, with its own distance filtering.
  float n64TrackVertA = abs(aCross);
  float n64TrackVertBed = 1.0 - smoothstep(${n(TRENCH.bed)},
    ${n(TRENCH.groove)}, n64TrackVertA);
  float n64TrackVertBank = 1.0 - smoothstep(0.065, 0.12,
    abs(n64TrackVertA - ${n(TRENCH.ridge)}));
  float n64TrackVertPack = clamp(aTrack.x * 0.48 + aTrack.z * 0.34
    + aTrack.y * 0.30, 0.0, 1.0);
  vN64Ice = n64TrackVertBed * (0.48 + n64TrackVertPack * 0.44)
    * (1.0 - n64TrackVertBank);`;

const TRACK_FRAG_PARS = `
  uniform vec3 uTrackPacked;
  uniform vec3 uTrackGroove;
  uniform vec3 uTrackRidge;
  uniform float uTrackOpacity;
  varying float vTrackCross;
  varying float vTrackVariation;
  varying vec4 vTrackState;
  varying vec2 vTrackLife;
  varying vec3 vTrackBaseNormal;
  varying float vTrackDepth;`;

/* Colour remains a sub-pixel accent over the physical section. A clean carve
   strongly weights only the buried edge; a flat base leaves two faint cuts;
   a brake softens them into the bounds of a churned bed. */
const TRACK_COLOR = `
  float n64TrackA = abs(vTrackCross);
  float n64TrackWash = clamp(vTrackState.x, 0.0, 1.0);
  float n64TrackBite = clamp(vTrackState.y, 0.0, 1.0);
  float n64TrackBrake = clamp(vTrackState.z, 0.0, 1.0);
  float n64TrackSide = sign(vTrackCross);
  float n64TrackLoaded = clamp(
    0.5 + 0.5 * n64TrackSide * vTrackState.w, 0.0, 1.0);

  // Filter in screen space. The depth term gently broadens a cut before it
  // becomes smaller than a pixel, so it converges instead of flickering.
  float n64TrackAA = clamp(fwidth(n64TrackA) * 1.45
    + vTrackDepth * 0.00022, 0.006, 0.13);
  float n64TrackGrooveHalf = mix(${n(TRENCH.grooveHalfCarve)},
    ${n(TRENCH.grooveHalfSkid)}, n64TrackWash);
  float n64TrackBed = 1.0 - smoothstep(${n(TRENCH.bed)} - n64TrackAA,
    ${n(TRENCH.groove)} + n64TrackGrooveHalf + n64TrackAA * 1.8,
    n64TrackA);
  float n64TrackGroove = 1.0 - smoothstep(
    n64TrackGrooveHalf - n64TrackAA,
    n64TrackGrooveHalf + n64TrackAA,
    abs(n64TrackA - ${n(TRENCH.groove)}));
  // Conserve the apparent energy of a cut once it is narrower than a pixel.
  // Merely broadening it with fwidth keeps a full-strength dark rail alive to
  // the horizon; coverage scaling lets it converge into the bed instead.
  n64TrackGroove *= min(1.0,
    n64TrackGrooveHalf / max(n64TrackAA, 0.0001));
  float n64TrackRidge = 1.0 - smoothstep(0.085 - n64TrackAA,
    0.085 + n64TrackAA, abs(n64TrackA - ${n(TRENCH.ridge)}));
  float n64TrackFoot = 1.0 - smoothstep(${n(TRENCH.foot)}
    - n64TrackAA * 2.0, 1.0, n64TrackA);

  // A snowboard does not ink both steel edges into the hill. Flat running
  // leaves only a quiet base polish; once edged, one loaded cut owns the
  // mark and its unloaded partner nearly disappears.
  float n64CleanCut = mix(0.12,
    mix(0.02, 0.68, n64TrackLoaded), n64TrackBite);
  float n64CutStrength = mix(n64CleanCut,
    0.035 + n64TrackLoaded * 0.10
      + n64TrackBrake * (0.015 + n64TrackLoaded * 0.08),
    n64TrackWash);
  float n64Organic = clamp(1.0 + vTrackVariation
    * (0.10 + n64TrackWash * 0.25 + n64TrackBrake * 0.10), 0.65, 1.35);
  float n64Fresh = 1.0 - smoothstep(0.025, ${n(TRENCH.settle)},
    vTrackLife.y);
  float n64BrokenBerm = smoothstep(-0.45, 0.35, vTrackVariation);
  float n64Breakup = mix(1.0, n64BrokenBerm,
    clamp(n64TrackWash * 0.55 + n64TrackBrake * 0.55, 0.0, 1.0));
  float n64RidgeActivity = clamp(n64TrackBite + n64TrackWash
    + n64TrackBrake, 0.0, 1.0);
  float n64RidgeSide = mix(0.46, mix(0.06, 1.0, n64TrackLoaded),
    n64RidgeActivity);

  // The bed is intentionally quiet during a clean run. Most of that mark is
  // read from the single cut and the raised snow beside it, not from paint.
  float n64BedWeight = n64TrackBed * n64Organic
    * (0.065 + (1.0 - n64TrackBite) * 0.030
      + n64TrackWash * 0.205 + n64TrackBrake * 0.095);
  float n64GrooveWeight = n64TrackGroove * n64CutStrength;
  float n64RidgeWeight = n64TrackRidge * n64Organic
    * (0.08 + n64TrackBite * 0.30 + n64TrackWash * 0.52
      + n64TrackBrake * 0.20)
    * mix(0.48, 1.0, n64Fresh)
    * n64RidgeSide * mix(0.22, 1.0, n64Breakup);

  float n64TrackWeight = max(n64BedWeight,
    max(n64GrooveWeight, n64RidgeWeight)) * n64TrackFoot;
  vec3 n64TrackAlbedo = uTrackPacked;
  n64TrackAlbedo = mix(n64TrackAlbedo, uTrackGroove,
    clamp(n64GrooveWeight / max(n64TrackWeight, 0.001), 0.0, 1.0));
  n64TrackAlbedo = mix(n64TrackAlbedo, uTrackRidge,
    clamp(n64RidgeWeight / max(n64TrackWeight, 0.001), 0.0, 0.86));
  diffuseColor.rgb = n64TrackAlbedo;`;

const TRACK_ALPHA = `
  float n64TrackDistance = 1.0 - smoothstep(${n(DISTANCE_FADE_NEAR)},
    ${n(DISTANCE_FADE_FAR)}, vTrackDepth);
  diffuseColor.a *= n64TrackWeight * vTrackLife.x
    * uTrackOpacity * n64TrackDistance;`;

/* Three flips normals on the back face of DoubleSide materials. A trench is
   still top-lit when a switch landing reverses its strip winding, so undo
   that flip. Physical berm relief then converges to the smooth terrain normal
   before it becomes a sub-pixel zipper in the distance. */
const TRACK_NORMAL = `
  #ifdef DOUBLE_SIDED
    normal *= faceDirection;
  #endif
  float n64TrackReliefDetail = 1.0 - smoothstep(58.0, 112.0, vTrackDepth);
  normal = normalize(mix(vTrackBaseNormal, normal, n64TrackReliefDetail));
  nonPerturbedNormal = normal;`;

export function createTrail(THREE, shading) {
  const N = TRAIL.samples;
  const L = SECTION.length;
  const verts = N * L;
  const spacing = TRAIL.spacing;
  const maxCatchup = TRAIL.maxCatchup;
  const clodCapacity = N * CLOD_CLUSTER;

  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const groundNormal = new Float32Array(verts * 3);
  const cross = new Float32Array(verts);
  const variation = new Float32Array(verts);
  const track = new Float32Array(verts * 4);
  const life = new Float32Array(verts * 2);
  const born = new Float64Array(N);
  const opens = new Uint8Array(N);
  const edgeWalkL = new Float32Array(N);
  const edgeWalkR = new Float32Array(N);
  const pressureWalk = new Float32Array(N);
  const clodX = new Float32Array(clodCapacity);
  const clodY = new Float32Array(clodCapacity);
  const clodZ = new Float32Array(clodCapacity);
  const clodNX = new Float32Array(clodCapacity);
  const clodNY = new Float32Array(clodCapacity);
  const clodNZ = new Float32Array(clodCapacity);
  const clodSize = new Float32Array(clodCapacity);
  const clodRandA = new Float32Array(clodCapacity);
  const clodRandB = new Float32Array(clodCapacity);
  const clodRandC = new Float32Array(clodCapacity);
  const indexCount = (N - 1) * (L - 1) * 6;
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)(indexCount);

  for (let slot = 0; slot < N; slot++) {
    born[slot] = -1e9;
    for (let lane = 0; lane < L; lane++) cross[slot * L + lane] = SECTION[lane];
  }

  const dynamic = (array, size) => new THREE.BufferAttribute(array, size)
    .setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', dynamic(position, 3));
  geo.setAttribute('normal', dynamic(normal, 3));
  geo.setAttribute('aTrackBaseNormal', dynamic(groundNormal, 3));
  geo.setAttribute('aCross', new THREE.BufferAttribute(cross, 1));
  geo.setAttribute('aVariation', dynamic(variation, 1));
  geo.setAttribute('aTrack', dynamic(track, 4));
  geo.setAttribute('aLife', dynamic(life, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const trackUniforms = {
    uTrackPacked: { value: new THREE.Color(SNOW.packed) },
    uTrackGroove: { value: new THREE.Color(SNOW.groove) },
    uTrackRidge: { value: new THREE.Color(SNOW.ridge) },
    uTrackOpacity: { value: TRAIL.opacity },
  };

  /* Start from a normal lit surface, then add only the state-driven section
     masks. The shared shading patch remains authoritative for daylight,
     weather fog and snow reflections; Three's light loop supplies the
     headlamp, helicopter lamps and shadows automatically. */
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    alphaTest: 0.002,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, trackUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${TRACK_VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>${TRACK_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${TRACK_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>${TRACK_COLOR}`)
      .replace('#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>${TRACK_NORMAL}`)
      .replace('#include <alphamap_fragment>',
        `#include <alphamap_fragment>${TRACK_ALPHA}`);
  };
  shading.apply(material, { sheen: 0.58 });
  material.userData.trailUniforms = trackUniforms;

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  /* A skid does not leave a continuous pastry-piped ridge. Sparse clods sit
     on the pushed berm and shrink out before they become sub-pixel detail.
     They are one instanced draw call and use the same real lighting as the
     section underneath. */
  const clodGeo = new THREE.IcosahedronGeometry(1, 0);
  const clodMaterial = new THREE.MeshLambertMaterial({ color: SNOW.clod });
  shading.apply(clodMaterial, { sheen: 0.24 });
  const clods = new THREE.InstancedMesh(
    clodGeo, clodMaterial, clodCapacity,
  );
  clods.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  clods.frustumCulled = false;
  clods.castShadow = false;
  clods.receiveShadow = true;
  clods.renderOrder = 0;
  mesh.add(clods);

  const lat = new THREE.Vector3(1, 0, 0);
  const prevLat = new THREE.Vector3(1, 0, 0);
  const travel = new THREE.Vector3();
  const motionLat = new THREE.Vector3();
  const baseNormal = new THREE.Vector3(0, 1, 0);
  const sectionLat = new THREE.Vector3(1, 0, 0);
  const laneNormal = new THREE.Vector3();
  const clodDummy = new THREE.Object3D();
  const clodUp = new THREE.Vector3(0, 1, 0);
  const clodNormal = new THREE.Vector3(0, 1, 0);

  // Reused cross-section scratch: no allocations while the board is moving.
  const laneD = new Float64Array(L);
  const laneX = new Float64Array(L);
  const laneY = new Float64Array(L);
  const laneZ = new Float64Array(L);
  const laneSurfaceRelief = new Float64Array(L);
  const laneVariation = new Float64Array(L);

  const STATE_KEYS = [
    'latX', 'latY', 'latZ', 'normalX', 'normalY', 'normalZ',
    'travelX', 'travelY', 'travelZ', 'wash', 'bite', 'brake', 'bias',
    'contactShift', 'load', 'chatter', 'half',
  ];
  const makeState = () => ({
    latX: 1, latY: 0, latZ: 0,
    normalX: 0, normalY: 1, normalZ: 0,
    travelX: 0, travelY: 0, travelZ: -1,
    wash: 0, bite: 0, brake: 0, bias: 0,
    contactShift: 0, load: 0, chatter: 0, half: TRAIL.width,
  });
  const currentState = makeState();
  const committedState = makeState();
  const segmentStartState = makeState();
  const interpolatedState = makeState();

  function copyState(out, source) {
    for (let i = 0; i < STATE_KEYS.length; i++) {
      const key = STATE_KEYS[i];
      out[key] = source[key];
    }
    return out;
  }

  function mixState(out, from, to, t) {
    for (let i = 0; i < STATE_KEYS.length; i++) {
      const key = STATE_KEYS[i];
      out[key] = mix(from[key], to[key], t);
    }
    return out;
  }

  let now = 0;
  let head = -1;       // current live sample
  let count = 0;
  let open = false;
  let dirty = false;
  let chewL = 0;
  let chewR = 0;
  let variationWalk = 0;
  let liveHalf = TRAIL.width;
  let lastCommitX = 0;
  let lastCommitZ = 0;
  let anchorX = 0;
  let anchorY = 0;
  let anchorZ = 0;
  let visibleClods = 0;

  function hideAllClods() {
    clods.count = 0;
    visibleClods = 0;
  }
  hideAllClods();

  function rebase(x, y, z) {
    const ax = Math.round(x / ANCHOR_STRIDE) * ANCHOR_STRIDE;
    const ay = Math.round(y / ANCHOR_STRIDE) * ANCHOR_STRIDE;
    const az = Math.round(z / ANCHOR_STRIDE) * ANCHOR_STRIDE;
    if (ax === anchorX && ay === anchorY && az === anchorZ) return;
    const dx = anchorX - ax;
    const dy = anchorY - ay;
    const dz = anchorZ - az;
    for (let p = 0; p < position.length; p += 3) {
      position[p] += dx;
      position[p + 1] += dy;
      position[p + 2] += dz;
    }
    for (let i = 0; i < clodCapacity; i++) {
      clodX[i] += dx;
      clodY[i] += dy;
      clodZ[i] += dz;
    }
    anchorX = ax;
    anchorY = ay;
    anchorZ = az;
    mesh.position.set(ax, ay, az);
    geo.attributes.position.needsUpdate = true;
  }

  /* Open one ring slot and give it spatially correlated irregularity. The
     walk is drawn once per section and then frozen; a live section can be
     rewritten sixty times without boiling. */
  function take(starting) {
    head = head < 0 ? 0 : (head + 1) % N;
    if (count < N) count += 1;
    opens[head] = starting ? 1 : 0;
    born[head] = now;
    chewL = clamp(chewL * 0.82 + (Math.random() * 2 - 1) * 0.18, -1, 1);
    chewR = clamp(chewR * 0.82 + (Math.random() * 2 - 1) * 0.18, -1, 1);
    variationWalk = clamp(
      variationWalk * 0.88 + (Math.random() * 2 - 1) * 0.16, -1, 1,
    );
    edgeWalkL[head] = chewL;
    edgeWalkR[head] = chewR;
    pressureWalk[head] = variationWalk;
    const clodBase = head * CLOD_CLUSTER;
    for (let j = 0; j < CLOD_CLUSTER; j++) {
      const id = clodBase + j;
      clodRandA[id] = Math.random();
      clodRandB[id] = Math.random();
      clodRandC[id] = Math.random();
      clodSize[id] = 0;
    }
    dirty = true;
  }

  /* Height relative to the carrier's clearance plane. The profile spends
     most of that clearance to put the packed floor below untouched snow, and
     a loaded edge spends the last few millimetres on a narrow cut. Nothing
     reaches the terrain itself: the minimum remains three millimetres above
     the collision surface, avoiding z-fighting without flattening the mark. */
  function reliefAt(s, wash, bite, brake, bias, load, chatter, organic) {
    const a = Math.abs(s);
    const side = Math.sign(s);
    const loaded = clamp(0.5 + 0.5 * side * bias, 0, 1);
    const activity = clamp(Math.max(bite, wash * 0.88 + brake * 0.42), 0, 1);

    const bed = 1 - smoothstep(TRENCH.bed, TRENCH.groove + 0.010, a);
    const floorDepth = Math.min(0.010,
      0.006 + load * 0.0018 + wash * 0.0016 + brake * 0.0010);
    const grooveWidth = mix(0.026, 0.062, wash);
    const groove = 1 - smoothstep(0.012, grooveWidth,
      Math.abs(a - TRENCH.groove));
    const grooveSide = mix(0.26, mix(0.04, 1, loaded), activity);
    const grooveDepth = Math.min(0.008,
      0.003 + bite * 0.005 + wash * 0.0015 + brake * 0.0010)
      * grooveSide * (0.78 + load * 0.22);

    const rise = smoothstep(TRENCH.groove + 0.010, TRENCH.ridge, a);
    const fall = 1 - smoothstep(TRENCH.ridge, 1, a);
    const berm = rise * fall;
    // A railed board displaces snow almost entirely beyond its loaded edge.
    // The flat-board value is deliberately tiny; it is not a pair of rails.
    const sideWeight = mix(0.18, mix(0.05, 1.78, loaded), activity);
    const loadScale = 0.72 + load * 0.38;
    const breakupActivity = clamp(bite * 0.20 + wash * 0.78
      + brake * 0.56 + chatter * 0.55, 0, 1);
    const packet = smoothstep(-0.42, 0.38, organic);
    const breakup = mix(1, 0.18 + packet * 0.82, breakupActivity);
    const bermHeight = Math.min(0.105,
      (0.004 + bite * 0.024 + wash * 0.040 + brake * 0.018)
      * loadScale * sideWeight * breakup);

    // Braking leaves irregular compression mounds inside the deposited wall.
    // They inherit the frozen low-pass walk, so they never boil or form ribs.
    const churnBand = smoothstep(0.12, 0.46, a)
      * (1 - smoothstep(0.58, TRENCH.groove, a));
    const churnSide = mix(0.62, 0.20 + loaded * 0.80, activity);
    const churn = (wash * 0.003 + brake * 0.006 + chatter * 0.004)
      * churnBand * churnSide
      * (0.24 + 0.76 * clamp(organic * 0.5 + 0.5, 0, 1));

    const profile = -bed * floorDepth - groove * grooveDepth
      + berm * bermHeight + churn;
    return clamp(profile, -TRAIL.lift + 0.003, 0.105);
  }

  /* Write all twenty-five terrain-conforming lanes of one sample. `contactShift`
     moves the board centre away from the buried-edge pivot during a carve,
     putting the dominant groove exactly on rider.pos. */
  function write(slot, x, y, z, half, state) {
    const carrierHalf = half * TRENCH.berm;
    sectionLat.set(state.latX, state.latY, state.latZ).normalize();
    const cx = x + sectionLat.x * state.contactShift;
    const cy = y + sectionLat.y * state.contactShift;
    const cz = z + sectionLat.z * state.contactShift;
    baseNormal.set(state.normalX, state.normalY, state.normalZ).normalize();

    const leftWalk = edgeWalkL[slot];
    const rightWalk = edgeWalkR[slot];
    const pressure = pressureWalk[slot];

    for (let lane = 0; lane < L; lane++) {
      const s = SECTION[lane];
      const a = Math.abs(s);
      const sideWalk = s < 0 ? leftWalk : s > 0 ? rightWalk : pressure;
      const edgeBlend = smoothstep(0.52, 1, a);
      const wander = clamp(sideWalk
        * (0.010 + state.wash * 0.026 + state.brake * 0.010
          + state.chatter * 0.012), -0.038, 0.038);
      const d = s * carrierHalf
        + Math.sign(s) * carrierHalf * wander * edgeBlend;
      const px = cx + sectionLat.x * d;
      const planeY = cy + sectionLat.y * d;
      const pz = cz + sectionLat.z * d;
      const groundY = heightAt(px, pz);
      const surfaceY = Math.max(planeY, groundY);
      const organic = clamp(pressure * (1 - a * 0.32) + sideWalk * a, -1, 1);
      const relief = reliefAt(s, state.wash, state.bite, state.brake,
        state.bias, state.load, state.chatter, organic);
      const lift = TRAIL.lift + relief;

      laneD[lane] = d;
      laneX[lane] = px + baseNormal.x * lift;
      laneY[lane] = surfaceY + baseNormal.y * lift;
      laneZ[lane] = pz + baseNormal.z * lift;
      laneSurfaceRelief[lane] = Math.max(0, groundY - planeY) + relief;
      laneVariation[lane] = organic;
    }

    for (let lane = 0; lane < L; lane++) {
      const vi = slot * L + lane;
      const p = vi * 3;
      position[p] = laneX[lane] - anchorX;
      position[p + 1] = laneY[lane] - anchorY;
      position[p + 2] = laneZ[lane] - anchorZ;

      const lo = Math.max(0, lane - 1);
      const hi = Math.min(L - 1, lane + 1);
      const run = laneD[hi] - laneD[lo] || 1;
      const reliefSlope = (laneSurfaceRelief[hi] - laneSurfaceRelief[lo]) / run;
      // For a tangent t = lateral + normal*slope, n - lateral*slope is the
      // corresponding section normal. The direct analytic form is stable on
      // the almost-flat packed bed and independent of inactive ring slots.
      laneNormal.copy(baseNormal)
        .addScaledVector(sectionLat, -reliefSlope).normalize();
      normal[p] = laneNormal.x;
      normal[p + 1] = laneNormal.y;
      normal[p + 2] = laneNormal.z;
      groundNormal[p] = baseNormal.x;
      groundNormal[p + 1] = baseNormal.y;
      groundNormal[p + 2] = baseNormal.z;

      variation[vi] = laneVariation[lane];
      const t = vi * 4;
      track[t] = state.wash;
      track[t + 1] = state.bite;
      track[t + 2] = state.brake;
      track[t + 3] = state.bias;
    }

    const clodStrength = clamp(
      state.wash * 0.72 + state.brake * 0.62 + state.chatter * 0.28, 0, 1,
    );
    const clodBase = slot * CLOD_CLUSTER;
    // Heavy pressure produces occasional fracture packets, not one bright
    // pebble every spatial sample. Keeping the gate low makes the three
    // members read as a single broken slab before the next quiet stretch.
    const clodGate = 0.02 + clodStrength * 0.13;
    const hasCluster = clodStrength > 0.18
      && clodRandA[clodBase] < clodGate;
    const travelLen = Math.hypot(
      state.travelX, state.travelY, state.travelZ,
    ) || 1;
    const tx = state.travelX / travelLen;
    const ty = state.travelY / travelLen;
    const tz = state.travelZ / travelLen;
    const clusterAlong = (clodRandB[clodBase] - 0.5) * spacing * 0.65;
    for (let j = 0; j < CLOD_CLUSTER; j++) {
      const id = clodBase + j;
      const member = hasCluster && (j === 0
        || clodRandA[id] < 0.28 + clodStrength * 0.56);
      if (!member) {
        clodSize[id] = 0;
        continue;
      }
      const side = Math.abs(state.bias) > 0.08
        ? Math.sign(state.bias) : clodRandB[clodBase] < 0.5 ? -1 : 1;
      const ridgeLane = side < 0 ? 4 : L - 5;
      const along = clusterAlong + (clodRandB[id] - 0.5)
        * spacing * (0.20 + j * 0.12);
      const outward = side * (0.008 + clodRandC[id]
        * (0.035 + clodStrength * 0.075));
      const up = 0.001 + clodStrength * (0.001 + clodRandA[id] * 0.003);
      clodX[id] = laneX[ridgeLane] - anchorX + tx * along
        + sectionLat.x * outward + baseNormal.x * up;
      clodY[id] = laneY[ridgeLane] - anchorY + ty * along
        + sectionLat.y * outward + baseNormal.y * up;
      clodZ[id] = laneZ[ridgeLane] - anchorZ + tz * along
        + sectionLat.z * outward + baseNormal.z * up;
      clodNX[id] = baseNormal.x;
      clodNY[id] = baseNormal.y;
      clodNZ[id] = baseNormal.z;
      const memberScale = j === 0 ? 1 : 0.55 + clodRandB[id] * 0.35;
      // Fractured slabs need enough footprint to read at chase distance, but
      // remain very thin and partially embedded so they never become pearls.
      clodSize[id] = (0.007 + clodStrength * 0.042)
        * (0.62 + clodRandC[id] * 0.50) * memberScale;
    }
  }

  function prune() {
    while (count > 0) {
      const tail = (head - count + 1 + N) % N;
      if (now - born[tail] < TRAIL.life) break;
      count -= 1;
      dirty = true;
    }
  }

  function stitch() {
    let t = 0;
    for (let k = 1; k < count; k++) {
      const cur = (head - count + 1 + k + N) % N;
      if (opens[cur]) continue;
      const prev = (cur + N - 1) % N;
      for (let lane = 0; lane < L - 1; lane++) {
        const a = prev * L + lane;
        const b = a + 1;
        const c = cur * L + lane;
        const d = c + 1;
        index[t++] = a; index[t++] = b; index[t++] = c;
        index[t++] = b; index[t++] = d; index[t++] = c;
      }
    }
    geo.index.needsUpdate = true;
    geo.setDrawRange(0, t);
  }

  /* The section derivative alone makes a varying bank look extruded along
     the run. Rebuild active normals from both tangents after the live section
     has moved: pressure packets, broken walls and clod-sized undulations then
     catch the sun longitudinally as well as across the board. Ring openings
     are hard boundaries, so a jump never lends its tangent to the next mark. */
  function recomputeNormals() {
    if (!count) return;
    const tail = (head - count + 1 + N) % N;
    for (let k = 0; k < count; k++) {
      const slot = (tail + k) % N;
      let before = slot;
      let after = slot;
      if (k > 0 && !opens[slot]) before = (slot + N - 1) % N;
      if (k < count - 1) {
        const next = (slot + 1) % N;
        if (!opens[next]) after = next;
      }

      for (let lane = 0; lane < L; lane++) {
        const p = (slot * L + lane) * 3;
        const pb = (before * L + lane) * 3;
        const pa = (after * L + lane) * 3;
        const lo = Math.max(0, lane - 1);
        const hi = Math.min(L - 1, lane + 1);
        const pl = (slot * L + lo) * 3;
        const ph = (slot * L + hi) * 3;

        const tx = position[pa] - position[pb];
        const ty = position[pa + 1] - position[pb + 1];
        const tz = position[pa + 2] - position[pb + 2];
        const sx = position[ph] - position[pl];
        const sy = position[ph + 1] - position[pl + 1];
        const sz = position[ph + 2] - position[pl + 2];

        // transverse x longitudinal points up for the SECTION/travel winding.
        let nx = sy * tz - sz * ty;
        let ny = sz * tx - sx * tz;
        let nz = sx * ty - sy * tx;
        let lengthSq = nx * nx + ny * ny + nz * nz;
        const gx = groundNormal[p];
        const gy = groundNormal[p + 1];
        const gz = groundNormal[p + 2];
        if (lengthSq < 1e-12) {
          nx = gx; ny = gy; nz = gz;
          lengthSq = nx * nx + ny * ny + nz * nz;
        } else if (nx * gx + ny * gy + nz * gz < 0) {
          nx = -nx; ny = -ny; nz = -nz;
        }
        const inv = 1 / Math.sqrt(Math.max(lengthSq, 1e-12));
        normal[p] = nx * inv;
        normal[p + 1] = ny * inv;
        normal[p + 2] = nz * inv;
      }
    }
  }

  function fade() {
    if (!count) return;
    for (let k = 0; k < count; k++) {
      const slot = (head - k + N) % N;
      const age = (now - born[slot]) / TRAIL.life;
      const ft = clamp((age - FADE_START) / (1 - FADE_START), 0, 1);
      const organicT = clamp(
        ft + pressureWalk[slot] * 0.16 * ft * (1 - ft), 0, 1,
      );
      const smooth = organicT * organicT * (3 - 2 * organicT);
      const weight = age >= 1 ? 0 : 1 - smooth;
      for (let lane = 0; lane < L; lane++) {
        const p = (slot * L + lane) * 2;
        life[p] = weight;
        life[p + 1] = age;
      }
    }
    geo.attributes.aLife.needsUpdate = true;
  }

  function updateClods(riderPos) {
    visibleClods = 0;
    for (let id = 0; id < clodCapacity; id++) {
      let scale = clodSize[id];
      const slot = Math.floor(id / CLOD_CLUSTER);
      if (scale > 0) {
        const age = (now - born[slot]) / Math.min(TRAIL.life, 4.5);
        const wx = clodX[id] + anchorX;
        const wz = clodZ[id] + anchorZ;
        const distance = Math.hypot(wx - riderPos.x, wz - riderPos.z);
        scale *= (1 - smoothstep(0.42, 1, age))
          * (1 - smoothstep(28, 48, distance));
      }
      if (scale <= 0.001) continue;

      clodDummy.position.set(clodX[id], clodY[id], clodZ[id]);
      clodNormal.set(clodNX[id], clodNY[id], clodNZ[id]).normalize();
      clodDummy.quaternion.setFromUnitVectors(clodUp, clodNormal);
      clodDummy.rotateY(clodRandB[id] * Math.PI * 2);
      clodDummy.rotateX((clodRandA[id] - 0.5) * 0.24);
      clodDummy.rotateZ((clodRandC[id] - 0.5) * 0.20);
      clodDummy.scale.set(
        scale * (0.72 + clodRandB[id] * 0.48),
        scale * (0.12 + clodRandA[id] * 0.14),
        scale * (0.92 + clodRandC[id] * 0.62),
      );
      clodDummy.updateMatrix();
      clods.setMatrixAt(visibleClods, clodDummy.matrix);
      visibleClods += 1;
    }
    clods.count = visibleClods;
    clods.instanceMatrix.needsUpdate = true;
  }

  function startStroke(x, y, z, state) {
    open = true;
    liveHalf = state.half;
    take(true);
    write(head, x, y, z, state.half, state);
    // Keep the first point while a second, initially degenerate point follows
    // the board. Without this pair the beginning of every carve is erased by
    // the live-sample update before the first spatial interval is reached.
    take(false);
    write(head, x, y, z, state.half, state);
    lastCommitX = x;
    lastCommitZ = z;
    copyState(committedState, state);
  }

  function update(rider, dt, onSection) {
    now += dt;

    const riding = rider.state === 'ride' && rider.grounded;
    const bodySliding = rider.state === 'fall' && !rider.airborne;
    const recovering = rider.state === 'rise';
    const snowContact = riding || bodySliding || recovering;
    if (!snowContact) {
      open = false;
      prune();
      if (dirty) { stitch(); dirty = false; }
      fade();
      updateClods(rider.pos);
      return;
    }

    const pos = rider.pos;
    const down = bodySliding || recovering;
    rebase(pos.x, pos.y, pos.z);

    travel.copy(rider.vel)
      .addScaledVector(rider.normal, -rider.vel.dot(rider.normal));
    const travelSpeed = travel.length();
    if (down) {
      if (travelSpeed > 0.25) {
        lat.copy(travel).multiplyScalar(1 / travelSpeed)
          .cross(rider.normal).normalize();
      } else {
        lat.copy(prevLat);
      }
    } else {
      lat.copy(rider.right);
      if (travelSpeed > 0.25) {
        motionLat.copy(travel).multiplyScalar(1 / travelSpeed)
          .cross(rider.normal).normalize();
        if (motionLat.dot(lat) < 0) motionLat.negate();
      } else {
        motionLat.copy(lat);
      }
    }

    const lateralNow = down ? 0 : rider.vel.dot(rider.right);
    const forwardNow = down ? travelSpeed : Math.abs(rider.boardForward);
    const slipAngle = down ? Math.PI * 0.5
      : Math.atan2(Math.abs(lateralNow), Math.max(0.1, forwardNow));
    const axisMix = smoothstep(Math.PI / 30, Math.PI / 6, slipAngle);
    if (!down) lat.lerp(motionLat, axisMix).normalize();
    if (lat.lengthSq() < 0.5) lat.set(1, 0, 0);

    if (open) {
      if (lat.dot(prevLat) < 0) lat.negate();
      const response = 7 + clamp(rider.speed / 18, 0, 1) * 13;
      lat.lerp(prevLat, Math.exp(-dt * response)).normalize();
    }

    const rawWash = down ? 1 : clamp(rider.slide / SLIDE_FULL, 0, 1);
    const scuff = down ? 1 : Math.max(
      clamp((rider.slide - SLIDE_HOLD) / (SLIDE_FULL - SLIDE_HOLD), 0, 1),
      rider.brake * 0.82,
    );
    const edgeBite = down ? 0 : clamp(
      Math.abs(Math.sin(rider.edge)) * rider.carveLoad / 0.5, 0, 1,
    );
    const sweptHalf = down ? TRAIL.slideWidth
      : BOARD_HALF * Math.abs(Math.cos(slipAngle))
        + BOARD_HALF_LENGTH * Math.abs(Math.sin(slipAngle));
    const targetHalf = down ? TRAIL.slideWidth
      : clamp(sweptHalf + mix(0, 0.15, rawWash)
        + rider.brake * 0.025, TRAIL.width, TRAIL.slideWidth);
    if (!open) liveHalf = targetHalf;
    else {
      const widthResponse = targetHalf > liveHalf ? 7 : 10;
      liveHalf += (targetHalf - liveHalf)
        * (1 - Math.exp(-dt * widthResponse));
    }

    const latToRight = down || lat.dot(rider.right) >= 0 ? 1 : -1;
    const loadedSide = down ? 0 : (Math.sign(rider.edge) || 0) * latToRight;
    const pushRaw = down ? 0
      : Math.abs(lateralNow) > 0.2 ? Math.sign(lateralNow) : rider.brakeSide;
    const pushSide = (pushRaw || loadedSide || 1) * latToRight;
    const bias = down ? 0 : clamp(
      loadedSide * edgeBite * (1 - scuff)
        + pushSide * (scuff * 0.72 + rider.brake * 0.28), -1, 1,
    );
    const contact = down ? 0 : clamp(rider.edge / EDGE_PIVOT, -1, 1)
      * latToRight * smoothstep(0.02, 0.22, edgeBite);
    // `TRENCH.groove` is where the buried cut really lies inside the carrier.
    // Shift by that exact live offset, not by a nominal board measurement, so
    // the dominant groove remains on rider.pos through width transitions.
    const grooveOffset = liveHalf * TRENCH.berm * TRENCH.groove;
    const contactShift = -contact * grooveOffset
      * (1 - axisMix) * (1 - rawWash);
    const load = down ? 0.9 : clamp((rider.gLoad - 0.45) / 1.75, 0, 1.25);
    const chatter = down ? 0.7
      : clamp((1 - rider.balance) * rider.carveLoad, 0, 1);
    currentState.latX = lat.x;
    currentState.latY = lat.y;
    currentState.latZ = lat.z;
    currentState.normalX = rider.normal.x;
    currentState.normalY = rider.normal.y;
    currentState.normalZ = rider.normal.z;
    currentState.travelX = travel.x;
    currentState.travelY = travel.y;
    currentState.travelZ = travel.z;
    currentState.wash = scuff;
    currentState.bite = edgeBite;
    currentState.brake = down ? 0.55 : rider.brake;
    currentState.bias = bias;
    currentState.contactShift = contactShift;
    currentState.load = load;
    currentState.chatter = chatter;
    currentState.half = liveHalf;

    if (!open) {
      startStroke(pos.x, pos.y, pos.z, currentState);
    } else {
      let dx = pos.x - lastCommitX;
      let dz = pos.z - lastCommitZ;
      let remaining = Math.hypot(dx, dz);

      /* No finite mesh can preserve kilometres of history per frame under
         unlimited acceleration. When one update outruns the fixed budget,
         retain a fully sampled near-board tail and break only the unseen gap
         behind it. The mark therefore never degenerates or disappears. */
      if (remaining > spacing * maxCatchup) {
        const keep = spacing * (maxCatchup - 1);
        const tail = keep / remaining;
        const sx = pos.x - dx * tail;
        const sz = pos.z - dz * tail;
        const sy = heightAt(sx, sz);
        open = false;
        startStroke(sx, sy, sz, currentState);
        dx = pos.x - lastCommitX;
        dz = pos.z - lastCommitZ;
        remaining = Math.hypot(dx, dz);
      }

      copyState(segmentStartState, committedState);
      const segmentLength = remaining;
      let inserted = 0;
      let travelled = 0;
      while (remaining >= spacing && inserted < maxCatchup) {
        const t = spacing / remaining;
        const sx = lastCommitX + dx * t;
        const sz = lastCommitZ + dz * t;
        const sy = heightAt(sx, sz);
        travelled += spacing;
        const stateT = segmentLength > 1e-5
          ? clamp(travelled / segmentLength, 0, 1) : 1;
        mixState(interpolatedState, segmentStartState, currentState, stateT);
        write(head, sx, sy, sz, interpolatedState.half, interpolatedState);
        if (onSection) onSection(sx, sy, sz, interpolatedState, rider);
        born[head] = now;
        lastCommitX = sx;
        lastCommitZ = sz;
        copyState(committedState, interpolatedState);
        take(false);
        inserted += 1;
        dx = pos.x - lastCommitX;
        dz = pos.z - lastCommitZ;
        remaining = Math.hypot(dx, dz);
      }
      write(head, pos.x, pos.y, pos.z, currentState.half, currentState);
      born[head] = now;
    }

    prevLat.copy(lat);
    recomputeNormals();
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.aTrackBaseNormal.needsUpdate = true;
    geo.attributes.aVariation.needsUpdate = true;
    geo.attributes.aTrack.needsUpdate = true;

    prune();
    if (dirty) { stitch(); dirty = false; }
    fade();
    updateClods(rider.pos);
  }

  function clear() {
    head = -1;
    count = 0;
    open = false;
    dirty = false;
    chewL = 0;
    chewR = 0;
    variationWalk = 0;
    liveHalf = TRAIL.width;
    for (let i = 0; i < N; i++) born[i] = -1e9;
    life.fill(0);
    clodSize.fill(0);
    geo.attributes.aLife.needsUpdate = true;
    geo.setDrawRange(0, 0);
    hideAllClods();
  }

  function debug() {
    return {
      lanes: L,
      samples: count,
      vertices: verts,
      triangles: geo.drawRange.count / 3,
      spacing,
      halfWidth: liveHalf,
      drawCount: geo.drawRange.count,
      clods: visibleClods,
    };
  }

  return { mesh, points: mesh, update, clear, debug };
}
