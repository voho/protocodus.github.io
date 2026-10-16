/* Mountain life — the cable car over the rocky band, and other people.

   The gondola line is the one piece of infrastructure that says "resort"
   from any distance, and it flies exactly where the terrain's zone model
   says the talus is: past the groomed corridor and the powder field, over
   the boulders no groomer visits. Pylons stand on a fixed 200-metre grid
   down the run, the ropes are drawn tower-top to tower-top with a touch of
   mid-span sag, and the cabins hang from them — not from the terrain,
   which is what makes a cable car read as suspended rather than floated.

   The NPC skiers and boarders ride the piste the same direction the player
   does (downhill is −z on this mountain), carving S-turns about the
   nearest branch line. Colliding with one puts both parties in the snow:
   the player through the rider's own 'fall' event — which already carries
   the crash sound, the camera kick and the powder curtain — and the NPC
   through a tumble staged here.

   EVERYTHING HERE IS BAKED, and that is the whole performance story of this
   file. A skier assembled from primitives as a Group of separate meshes is
   thirty-odd draw calls, doubled by the shadow pass; five of them plus the
   lift hardware came to 298 meshes and put frame peaks over 500 calls,
   which on real hardware is milliseconds of driver overhead for objects
   that occupy a few hundred pixels between them. So each figure is composed
   into exactly two rigid pieces — a deck that sits on the snow and a body
   hinged at the hip — with colour and snow response carried in vertex
   attributes, and every piece of hardware that repeats is an InstancedMesh.
   Eight riders and the entire lift now cost twenty-two meshes.

   The hip hinge is not only a draw-call trick. A single baked figure slides
   downhill as a statue; two rigid pieces let the upper body absorb through
   the turn, counter-rotate against the skis and stay upright while the deck
   banks — which is most of what reads as "riding" from thirty metres, and
   it costs one matrix per figure per frame. The arms are the other half of
   that read, and they ride the body piece as five bones rather than as
   meshes of their own — see `NPC_POLE`. */

import {
  heightAt, nearestCenter, centersAt, rockBandAt,
} from './terrain.js';
import { compose } from './geom.js';
import { RENDER } from './config.js';
import { sharedTexture } from './textures.js';
import { riderGeometry } from './riderAssets.js';
import { parseGlb } from './glb.js';
import { track } from './loading.js';
import { onHutGround } from './huts.js';

// Seconds a figure spends in the snow after a collision, and then takes to
// come back round to its riding pose.
const TUMBLE = 3.5;
const RECOVER = 0.5;

/* THE OTHER RIDERS' ARMS.

   The two-piece figure (see above) had its arms baked into the upper half,
   so a skier went the length of the piste with both poles held out behind
   him like a pair of tails, and a boarder's arms never moved at all. They
   are skinned now: the upper half is a SkinnedMesh with five bones — the
   body, each shoulder, and each hand, which is where a pole pivots — so the
   arms move without a draw call or a mesh more than the figure already had,
   and its shadow moves with them. Five bones and a handful of sines per
   figure per frame is the whole cost.

   A skier's poles keep the rhythm of his turns. Just before each edge change
   the pole on the inside of the turn that is coming swings forward, and its
   tip touches the snow beside the boot; the skier then runs past it, which
   at fifteen metres a second is a tap rather than a plant, and it trails
   back to rest while the other one starts its swing. `swing` and `lead` are
   radians of turn phase — how long before the edge change the swing starts
   and the tip lands — and `release` is how long after it the arm takes to
   come home. The tip is kept off the snow through the swing by carrying it
   out to the side, never through it. A boarder gets the player's arms in
   miniature: the leading one into a toeside turn and over the nose on a
   heelside one, the trailing one as the counterweight.

   `NPC_RIG` is the modelled figures' skeleton, the numbers
   `tools/blender/riders.py` posed them with (`npc_skier`, `npc_boarder`);
   the bones are put where it put the joints, and each vertex of the baked
   body is weighed to the bone it was modelled on. */
const NPC_RIG = {
  waist: 0.07, shoulderY: 0.40, shoulderZ: 0.20, neckY: 0.44, upper: 0.29, fore: 0.29,
  skierLean: -0.42, boarderLean: -0.20, boarderOpen: 0.45,
};
const NPC_POLE = {
  swing: 1.15,      // radians of turn phase before the edge change the swing starts…
  lead: 0.32,       // …and the tip touches down
  release: 0.55,    // and after it, the arm is home again
  reach: 0.30,      // radians the planting arm reaches forward
  wide: 0.10,       // and both arms are held out from the body
  clear: 0.03,      // metres the swinging tip keeps off the snow
  ahead: 0.42,      // radians in front of the hand the tip lands
};
// The other riders' S-turns: `sPhase` advances at TURN_RATE and the line
// is chased at TURN_GAIN, so a figure's own motion runs this far behind it.
const TURN_RATE = 1.35;
const TURN_GAIN = 2.2;
const TURN_LAG = Math.atan(TURN_RATE / TURN_GAIN);

const PYLON_SPACING = 200;
/* Eleven, so the span reaches 1400 m ahead — past the kilometre of the
   clear-day fog. (It was seven against a 560 m curtain.) A cabin recycles by jumping one full span from
   one end to the other, and with five pylons the ends sat ±400 m out,
   inside the curtain's visibility: the jump was watchable in clear
   weather. Two more towers are two instances on meshes that already
   exist, and they buy the handover happening behind the haze. */
const NUM_PYLONS = 11;
const SPAN = PYLON_SPACING * (NUM_PYLONS - 1);
const CABLE_SIDE = 1.8;   // the two ropes, either side of the arm's wheels
const SAG = 2.4;          // metres of droop at mid-span
/* Lengths each rope is drawn in per span. A straight rope tower to tower,
   under cabins that sag, left every cabin mid-span hanging its own grip
   2.4 m under a rope that was not there; eight chords follow the same
   parabola to within four centimetres. */
const ROPE_SEGMENTS = 8;
const CABIN_SPEED = 11;   // m/s along the line
/* Where things hang, in the frames the models are built in — and the
   numbers `lift.glb` must agree with before it is drawn (see `adoptLift`).
   A tower stands on its mid-height, the ropes cross it 21.5 m over the
   ground, and a cabin's origin is 1.7 m under the rope it hangs from. */
const TOWER_MID = 11;
const ROPE_TOP = 21.5;
const CABIN_HANG = 1.7;
/* Radians a second the modelled sheaves turn. Not the rope's own speed
   over a 0.4 m sheave, which is fifty: at sixty frames that is most of a
   turn between frames, and five lightening holes stepping that far read as
   a wheel turning slowly backwards. Seven reads as turning, and the right
   way, at any frame rate the game runs at. */
const SHEAVE_SPIN = 7;
const LIFT_GLB = new URL('../assets/models/resort/lift.glb', import.meta.url).href;

export function createMountainLife(THREE, scene, shading, spray, audio) {
  const root = new THREE.Group();
  scene.add(root);

  /* Scratch for every instance matrix written below. One set, reused — an
     instanced pool that allocates per frame has traded draw calls for
     garbage, which is the worse of the two. */
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _one = new THREE.Vector3(1, 1, 1);
  const _s = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _qTurn = new THREE.Quaternion();
  const _qStill = new THREE.Quaternion();
  // Turned yaw-then-pitch: a sheave train's heading along the line, then
  // the rope's slope over the tower; a cabin's side of the loop, then its swing.
  const _eLine = new THREE.Euler(0, 0, 0, 'YXZ');

  // Both plates are shared with the modules that also wear them — the
  // rider's weave and the boulders' slate — so each is decoded and uploaded
  // once for the whole mountain. See textures.js.
  const fabricTex = sharedTexture(THREE,
    new URL('../assets/textures/rider/rider-fabric.jpg', import.meta.url).href);
  const metalTex = sharedTexture(THREE,
    new URL('../assets/textures/rock/rock-slate.jpg', import.meta.url).href);

  /* --- the line: towers, ropes, cabins ---------------------------------- */

  /* Hardware shares one material per pass, with the paint in the vertex
     colours: a red cabin and its grey grip are one geometry and one draw.
     They also go through `shading.apply` now, which they did not before —
     an unfogged pylon at four hundred metres was the one object in the
     scene that stayed at full contrast while the mountain behind it went
     white, and it read as a bug because it was one. */
  /* The plate is a slate photograph standing in for weathered metal, and a
     photograph of slate is dark: its mean is about 0.06 in linear light, so
     multiplied straight into the paint it took every cabin, tower and snow
     gun to a sixteenth of its colour — near-black steel, oxblood cabins and
     a fan-gun housing the brown of an old barrel where the paint says
     yellow. So the plate is grain, not pigment: divided by its own mean and
     a third of its contrast kept, the paint is the colour it is written as
     and the plate still breaks it up. */
  const hardware = new THREE.MeshLambertMaterial({ vertexColors: true, map: metalTex });
  hardware.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec3 hardwareGrain = texture2D( map, vMapUv ).rgb / vec3( 0.057, 0.064, 0.073 );
        diffuseColor.rgb *= mix( vec3( 1.0 ), hardwareGrain, 0.35 );
      #endif`);
  };
  const hardwareMat = shading.apply(hardware, { sheen: 0.10 });

  const instanced = (geo, mat, count, cast = true) => {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    /* Three fills a new instance buffer with zeros, and a zero matrix puts
       every vertex on w = 0 — a degenerate triangle the rasteriser may
       stretch across the frame rather than drop. Nothing here is frustum
       culled, so the frames between construction and the first `update` were
       drawing exactly that. Draw nothing until the first update has written
       every slot. */
    mesh.count = 0;
    // Every pool here spans hundreds of metres of run while its geometry
    // measures a few, so three's per-object sphere would cull the lot the
    // moment the prototype left the frustum. One draw is cheaper than the
    // bookkeeping to do this properly.
    mesh.frustumCulled = false;
    mesh.castShadow = cast;
    mesh.receiveShadow = cast;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(mesh);
    pools.push(mesh);
    return mesh;
  };
  // Raised once the first update has written every matrix in every pool.
  const pools = [];
  let poolsLive = false;

  const cabinGeo = compose(THREE, [
    { geo: new THREE.CylinderGeometry(1, 0.87, 1, 8), color: 0xb73b2d,
      pos: [0, -1.78, 0], scale: [1.26, 0.76, 1.0] },
    { geo: new THREE.CylinderGeometry(0.94, 1.03, 1, 8), color: 0xdbe4e8,
      pos: [0, -0.36, 0], scale: [1.26, 0.20, 1.0] },
    { geo: new THREE.CylinderGeometry(0.89, 0.89, 1, 8), color: 0x26333c,
      pos: [0, -2.15, 0], scale: [1.26, 0.12, 1.0] },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), color: 0x333842, pos: [0, 0.5, 0] },
    { geo: new THREE.BoxGeometry(0.6, 0.3, 0.4), color: 0x333842, pos: [0, 1.6, 0] },
    ...[-1, 1].flatMap((x) => [-1, 1].map((z) => ({
      geo: new THREE.BoxGeometry(0.065, 1.10, 0.065), color: 0x28343d,
      pos: [x * 0.89, -0.94, z * 0.705],
    }))),
    { geo: new THREE.BoxGeometry(0.045, 1.0, 0.055), color: 0x28343d, pos: [0, -0.97, -1.012] },
    { geo: new THREE.BoxGeometry(0.55, 0.06, 0.055), color: 0xcbd6dc, pos: [0, -1.05, -1.03] },
  ], { uv: true });

  const glassGeo = new THREE.CylinderGeometry(1.0, 0.985, 1.05, 8);
  glassGeo.scale(1.245, 1, 0.99);
  glassGeo.translate(0, -0.97, 0);
  const cabinGlassMat = shading.apply(new THREE.MeshLambertMaterial({
    color: 0x1a3450,
    emissive: 0x000000,
  }), { sheen: 0.2 });
  const cabinWarmColor = new THREE.Color(0xffaa44);
  const cabinColdColor = new THREE.Color(0x000000);

  const NUM_GONDOLAS = 6;
  const cabinMesh = instanced(cabinGeo, hardwareMat, NUM_GONDOLAS);
  const glassMesh = instanced(glassGeo, cabinGlassMat, NUM_GONDOLAS, false);
  const gondolas = [];
  for (let i = 0; i < NUM_GONDOLAS; i++) {
    gondolas.push({
      // Spread along the span; alternate cabins ride the two ropes, which
      // is the two directions of travel.
      at: (i / NUM_GONDOLAS) * SPAN,
      dir: i % 2 === 0 ? -1 : 1,
      side: i % 2 === 0 ? -CABLE_SIDE : CABLE_SIDE,
    });
  }

  const pylonGeo = compose(THREE, [
    { geo: new THREE.CylinderGeometry(0.35, 0.7, 22.0, 12), color: 0x5a6270, pos: [0, 0, 0] },
    { geo: new THREE.BoxGeometry(7.0, 0.6, 0.6), color: 0x5a6270, pos: [0, 10.5, 0] },
    ...[-1, 1].map((s) => ({ geo: new THREE.BoxGeometry(0.16, 2.8, 0.20),
      color: 0x78858c, pos: [s * 1.0, 9.35, 0], rot: [0, 0, -s * 0.80] })),
    { geo: new THREE.CylinderGeometry(0.95, 1.1, 0.65, 8), color: 0x8b9499, pos: [0, -10.8, 0] },
    ...Array.from({ length: 12 }, (_, i) => ({
      geo: new THREE.BoxGeometry(0.48, 0.07, 0.13), color: 0x34434c,
      pos: [0, -7.8 + i * 1.4, 0.64 - i * 0.018],
    })),
  ], { uv: true });
  const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.2, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = shading.apply(
    new THREE.MeshLambertMaterial({ color: 0x22262c, map: metalTex }), { sheen: 0.08 },
  );

  const pylonMesh = instanced(pylonGeo, hardwareMat, NUM_PYLONS);
  const wheelMesh = instanced(wheelGeo, wheelMat, NUM_PYLONS * 2);
  let wheelSpin = 0;
  // Tower-top line points, refreshed every frame; x/y/z per pylon.
  const topX = new Float64Array(NUM_PYLONS);
  const topY = new Float64Array(NUM_PYLONS);
  const topZ = new Float64Array(NUM_PYLONS);
  // Where the cabin datum stood last frame — see the slide handover below.
  let lastBackZ = null;
  // And where it stood when the towers and ropes were last laid out.
  let lineBackZ = null;
  // A point on rope `off` of span `i`, `t` of the way along it: the chord
  // between the tower tops, dropped by the span's parabolic sag.
  const ropeAt = (i, off, t, out) => out.set(
    topX[i] + (topX[i + 1] - topX[i]) * t + off,
    topY[i] + (topY[i + 1] - topY[i]) * t - SAG * 4 * t * (1 - t),
    topZ[i] + (topZ[i + 1] - topZ[i]) * t,
  );

  const cableMat = shading.apply(
    new THREE.MeshBasicMaterial({ color: 0x22262c }), { sheen: 0 },
  );
  const cableGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
  const NUM_CABLES = (NUM_PYLONS - 1) * 2 * ROPE_SEGMENTS;
  const cableMesh = instanced(cableGeo, cableMat, NUM_CABLES, false);
  const UP = new THREE.Vector3(0, 1, 0);
  const cableDir = new THREE.Vector3();

  const band = {};
  // Where the line flies: over the middle of the rocky band, on the sunny
  // side of whichever branch is rightmost. One definition — the terrain's.
  const lineCentres = [0, 0];
  function cableXAt(z) {
    rockBandAt(z, band);
    centersAt(z, lineCentres);
    return lineCentres[1] + band.half + band.powder + band.rock * 0.55;
  }

  /* --- snow cannons (Schneekanonen) along the piste edge --- */
  const cannonGeo = compose(THREE, [
    { geo: new THREE.CylinderGeometry(0.12, 0.16, 4.4, 8), color: 0x6e7682, pos: [0, 2.2, 0] },
    {
      geo: new THREE.BoxGeometry(0.24, 0.24, 0.85),
      color: 0x6e7682,
      pos: [0, 4.2, 0.35],
      rot: [-0.28, 0, 0],
    },
    {
      geo: new THREE.CylinderGeometry(0.38, 0.32, 1.3, 16, 1, true),
      color: 0xdfa008,
      pos: [0, 4.4, 0.8],
      rot: [Math.PI / 2 - 0.32, 0, 0],
    },
    { geo: new THREE.CircleGeometry(0.32, 16), color: 0x1f2d38,
      pos: [0, 4.61, 1.43], rot: [-0.32, 0, 0] },
    { geo: new THREE.CylinderGeometry(0.085, 0.10, 0.09, 10), color: 0x9aabb2,
      pos: [0, 4.63, 1.49], rot: [Math.PI / 2 - 0.32, 0, 0] },
    { geo: new THREE.BoxGeometry(0.42, 0.52, 0.28), color: 0x34576b, pos: [0.24, 1.2, 0] },
    {
      geo: new THREE.TorusGeometry(0.34, 0.045, 6, 12),
      color: 0x1f5ab8,
      pos: [0, 4.6, 1.4],
      rot: [-0.32, 0, 0],
    },
  ], { uv: true });

  const NUM_CANNONS = 12;
  const CANNON_SPACING = 120;
  const cannonMesh = instanced(cannonGeo, hardwareMat, NUM_CANNONS);
  const cannons = [];
  let cannonsDirty = true;

  function placeCannon(c, cz) {
    c.z = cz;
    rockBandAt(cz, band);
    centersAt(cz, lineCentres);
    const center = c.side > 0 ? lineCentres[1] : lineCentres[0];
    c.x = center + c.side * (band.half + 3.2);
    c.y = heightAt(c.x, cz);
    c.yaw = c.side > 0 ? -Math.PI * 0.65 : Math.PI * 0.65;
    // A hut stands just past the groomed edge too, and a gun whose station
    // falls on its ground is simply not built there rather than through it.
    c.hidden = onHutGround(c.x, cz);
    cannonsDirty = true;
  }

  for (let i = 0; i < NUM_CANNONS; i++) {
    const c = {
      side: i % 2 === 0 ? 1 : -1, z: 0, x: 0, y: 0, yaw: 0, hidden: false,
    };
    placeCannon(c, 40 - i * CANNON_SPACING);
    cannons.push(c);
  }
  /* The spray leaves from the nozzle ring, in the gun's own frame (origin at
     its foot, barrel down +z), and goes where the barrel points. These are
     the procedural gun's; the modelled one brings its own in its extras. */
  const gunNozzle = new THREE.Vector3(0, 4.61, 1.45);
  const gunAim = new THREE.Vector3(0, Math.sin(0.32), Math.cos(0.32));

  /* --- the line and the guns as modelled ---------------------------------- */

  /* THE LIFT AS MODELLED. `tools/blender/lift.py` builds the line's hardware
     as `lift.glb`: an eight-seat detachable cabin with its grip and hanger,
     the cabin's glazing on its own, a tapered steel tower with its deck and
     ladder, one sheave train, and a fan gun on a tilting tower. Each goes
     into the InstancedMesh its procedural stand-in already draws from, so
     the resort keeps its draw calls and nothing below has to know which of
     the two it is placing — except in the two places where the model knows
     more than the primitives did, and says so: the sheave trains are pitched
     to the rope and turn each sheave about its own axle, and the cabins hang
     outboard-door-out on either rope and swing from their grips.

     The file's materials are roles, as the riders' are; this table is where
     a role becomes a colour, how much of the snow's sparkle it takes (snow
     lying on a roof is snow, a painted panel is not) and how much of the
     slate grain the hardware wears as weathering. Snow takes none of the
     grain: a photograph of slate laid over a drift reads as dirt. */
  const LIFT_LOOK = {
    // role:       [colour, snow response, slate grain]
    concrete: [0x9c9b95, 0.10, 1.0],
    liftSteel: [0x77818a, 0.10, 0.9],
    liftDark: [0x3a4249, 0.10, 0.7],
    liftGrating: [0x59626a, 0.10, 1.0],
    liftRail: [0x8d969c, 0.10, 0.8],
    liftSign: [0xe9edf0, 0.10, 0.25],
    trainFrame: [0x4d5861, 0.10, 0.8],
    sheaveWheel: [0xa9b2b8, 0.10, 0.6],
    sheaveHole: [0x6f7880, 0.10, 0.6],
    sheaveLiner: [0x17191c, 0.10, 0.4],
    cabinPaint: [0xb73b2d, 0.12, 0.35],
    cabinRoof: [0xb4bec5, 0.12, 0.35],
    cabinFloor: [0x26333c, 0.10, 0.6],
    cabinFrame: [0x1b2127, 0.10, 0.4],
    cabinTrim: [0xc4ced4, 0.10, 0.35],
    rubber: [0x1a1d22, 0.10, 0.4],
    hanger: [0x5b636b, 0.10, 0.7],
    grip: [0x8e979d, 0.10, 0.7],
    gripDark: [0x3b4148, 0.10, 0.6],
    gunHousing: [0xe3a90c, 0.10, 0.35],
    gunAccent: [0x1f5ab8, 0.10, 0.35],
    gunTrim: [0x2a3036, 0.10, 0.5],
    gunInterior: [0x15181c, 0.10, 0.3],
    gunHub: [0x8a949b, 0.10, 0.5],
    gunGrille: [0x3d444b, 0.10, 0.6],
    gunNozzle: [0x2a63c4, 0.10, 0.35],
    gunNozzleTip: [0xc2cbd0, 0.10, 0.4],
    gunCabinet: [0x34576b, 0.10, 0.45],
    gunScreen: [0x0e1a22, 0.10, 0.1],
    gunLamp: [0xff8a1f, 0.10, 0.1],
    gunLid: [0x4b5a4f, 0.10, 0.8],
    hose: [0x1c1f23, 0.10, 0.5],
    cable: [0x101214, 0.10, 0.3],
    snow: [0xf1f5f9, 0.85, 0.0],
  };
  // The slate grain's repeat, per metre, laid on by box projection: the
  // file carries no UVs, and weathering has no seams anyone follows.
  const LIFT_UV = 0.45;

  /* A node's primitives welded into one indexed geometry. With `look`, the
     hardware's attributes: colour, `aSheen` and `aGrain` per role, `uv`
     projected along each corner's dominant normal, and `aAxle` — the
     sheave a corner turns with, as (y, z, 1), or nothing. Without, only the
     shape, which is all the cabins' glass material reads. */
  function liftGeometry(node, look) {
    let verts = 0;
    let indices = 0;
    for (const p of node.prims) {
      verts += p.attributes.POSITION.length / 3;
      indices += p.index.length;
    }
    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const index = new (verts > 65535 ? Uint32Array : Uint16Array)(indices);
    const color = look && new Float32Array(verts * 3);
    const sheen = look && new Float32Array(verts);
    const grain = look && new Float32Array(verts);
    const axle = look && new Float32Array(verts * 3);
    const c = new THREE.Color();
    let v = 0;
    let k = 0;
    for (const p of node.prims) {
      const n = p.attributes.POSITION.length / 3;
      position.set(p.attributes.POSITION, v * 3);
      normal.set(p.attributes.NORMAL, v * 3);
      for (let i = 0; i < p.index.length; i++) index[k + i] = p.index[i] + v;
      if (look) {
        const said = look[p.role];
        if (!said) throw new Error(`lift.glb: no look for role ${p.role}`);
        c.setHex(said[0]);
        for (let i = 0; i < n; i++) {
          color[(v + i) * 3] = c.r;
          color[(v + i) * 3 + 1] = c.g;
          color[(v + i) * 3 + 2] = c.b;
          sheen[v + i] = said[1];
          grain[v + i] = said[2];
        }
        if (p.attributes._AXLE) axle.set(p.attributes._AXLE, v * 3);
      }
      v += n;
      k += p.index.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    if (look) {
      const uv = new Float32Array(verts * 2);
      for (let i = 0; i < verts; i++) {
        const ax = Math.abs(normal[i * 3]);
        const ay = Math.abs(normal[i * 3 + 1]);
        const az = Math.abs(normal[i * 3 + 2]);
        const x = position[i * 3];
        const y = position[i * 3 + 1];
        const z = position[i * 3 + 2];
        uv[i * 2] = (ay >= ax && ay >= az ? x : ax >= az ? z : x) * LIFT_UV;
        uv[i * 2 + 1] = (ay >= ax && ay >= az ? z : y) * LIFT_UV;
      }
      g.setAttribute('color', new THREE.BufferAttribute(color, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('aSheen', new THREE.BufferAttribute(sheen, 1));
      g.setAttribute('aGrain', new THREE.BufferAttribute(grain, 1));
      g.setAttribute('aAxle', new THREE.BufferAttribute(axle, 3));
    }
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    return g;
  }

  /* One material for every modelled piece of hardware, the procedural one's
     grain and all, and three things it did not do. `aSheen` hands the snow
     response back per corner exactly as the riders' figures do, so a drift
     on a cabin roof glints like the drift under it and the paint beside it
     does not; `aGrain` sets how much weathering each role wears. And a
     sheave turns: every corner whose `aAxle` says it belongs to one is
     turned about that sheave's own axle — local x, through (y, z) — by
     `uSheaveSpin`, before anything else is done to it. A train is a rigid
     thing that cannot spin as a whole the way the old single wheel did, and
     six instances per rope for six sheaves would have been six times the
     matrices to write for something a vertex shader does for nothing. The
     shadow pass draws them unturned, which no shadow of a sheave can show. */
  const sheaveSpin = { value: 0 };
  const liftMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: metalTex });
  liftMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSheaveSpin = sheaveSpin;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
      attribute float aSheen;
      attribute float aGrain;
      attribute vec3 aAxle;
      uniform float uSheaveSpin;
      varying float vLiftGrain;
      vec2 liftSpin( vec2 p ) {
        float c = cos( uSheaveSpin );
        float s = sin( uSheaveSpin );
        return vec2( c * p.x - s * p.y, s * p.x + c * p.y );
      }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      if ( aAxle.z > 0.5 ) objectNormal.yz = liftSpin( objectNormal.yz );`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      if ( aAxle.z > 0.5 ) transformed.yz = aAxle.xy + liftSpin( transformed.yz - aAxle.xy );`)
      // After shading.js's own `vN64Sheen = 1.0`, as the figures' is.
      .replace('#include <project_vertex>', `#include <project_vertex>
      vN64Sheen = aSheen;
      vLiftGrain = aGrain;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      varying float vLiftGrain;`)
      .replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec3 hardwareGrain = texture2D( map, vMapUv ).rgb / vec3( 0.057, 0.064, 0.073 );
        diffuseColor.rgb *= mix( vec3( 1.0 ), hardwareGrain, 0.35 * vLiftGrain );
      #endif`);
  };
  // The snow response is all per corner now, so the material's own is 1.
  const liftHardwareMat = shading.apply(liftMat, { sheen: 1 });
  let liftModelled = false;

  /* Swap the procedural lift and guns for the modelled ones. Everything is
     built before anything is swapped, and the file is checked against the
     frame this module hangs it in first — a tower built for another rope
     height would put every sheave train a metre off its rope — so a file
     that is wrong in any way leaves the procedural line standing whole. */
  function adoptLift(nodes) {
    const node = (name) => {
      if (!nodes[name]) throw new Error(`lift.glb: no ${name}`);
      return nodes[name];
    };
    const cabin = node('lift_cabin');
    const tower = node('lift_tower');
    const gun = node('snowgun');
    const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-3;
    if (!near(cabin.extras.ropeY, CABIN_HANG) || !near(tower.extras.ropeY, ROPE_TOP - TOWER_MID)
      || !near(tower.extras.groundY, -TOWER_MID) || !near(tower.extras.gauge, CABLE_SIDE)) {
      throw new Error('lift.glb: built for a different line');
    }
    const { nozzle, aim } = gun.extras;
    if (!(nozzle?.length === 3 && aim?.length === 3 && [...nozzle, ...aim].every(Number.isFinite))) {
      throw new Error('lift.glb: the snow gun has no nozzle');
    }
    const built = [
      [cabinMesh, liftGeometry(cabin, LIFT_LOOK)],
      [glassMesh, liftGeometry(node('lift_cabinGlass'), null)],
      [pylonMesh, liftGeometry(tower, LIFT_LOOK)],
      [wheelMesh, liftGeometry(node('lift_sheaves'), LIFT_LOOK)],
      [cannonMesh, liftGeometry(gun, LIFT_LOOK)],
    ];
    for (const [mesh, geometry] of built) {
      const old = mesh.geometry;
      mesh.geometry = geometry;
      old.dispose();
      if (mesh !== glassMesh) mesh.material = liftHardwareMat;
    }
    gunNozzle.fromArray(nozzle);
    gunAim.fromArray(aim).normalize();
    liftModelled = true;
    // The trains are laid along the rope on the next frame, slide or not
    lineBackZ = null;
  }

  /* Fetched here, like the forest's trees, and swapped in whenever it
     lands: the procedural line is drawing from the first frame, so this is
     never a wait, and if the file never comes the mountain keeps it. */
  const liftReady = track((typeof fetch === 'function'
    ? fetch(LIFT_GLB).then((res) => (res.ok ? res.arrayBuffer()
      : Promise.reject(new Error(`${LIFT_GLB} ${res.status}`))))
    : Promise.reject(new Error('no fetch')))
    .then((buffer) => {
      adoptLift(parseGlb(buffer));
      return true;
    })
    .catch((err) => {
      console.warn('Alpen: keeping the procedural lift —', err?.message ?? err);
      return false;
    }));

  /* --- the other people --------------------------------------------------- */

  /* THE OTHER PEOPLE — authentic skiers and snowboarders sharing the mountain.

     Both disciplines have distinct silhouettes, equipment, and stances:
     - Skier: Parallel skis with upturned tips and bindings, forward-flexed
       boots, athletic downhill tuck, and poles held in mittens trailing back.
     - Snowboarder: Twin-tip board with sidecut, angled bindings with highbacks,
       dynamic riding squat with hips opened ~35° and head facing downhill.

     Each figure is authored as a flat list of primitives in one coordinate
     frame and then split at the hip into two baked geometries. Everything
     below the hip — skis or board, bindings, boots, shins, thighs — belongs
     to the deck and stays welded to the snow. Everything above it hinges.

     All models face forward along -Z (downhill) and orient in real-time
     with Euler order 'YXZ' to match the terrain pitch, travel yaw, and carve
     bank; the body then works against that yaw and bank rather than with it,
     because a rider who banks their chest as hard as their edge is a rider
     about to fall over.

     These primitives are now the fallback. What the game normally draws is
     the modelled figure (`modelledFigure` below, from `npcs.glb`), split at
     the hip the same way and dressed from these same palettes. */

  const npcJacketColors = [
    0xe64a19, // Flame Orange
    0x1976d2, // Alpine Cobalt
    0x2e7d32, // Forest Pine
    0xf57c00, // Sunburst Amber
    0x7b1fa2, // Deep Violet
    0x0097a7, // Glacier Teal
    0xc2185b, // Berry Magenta
    0x37474f, // Stealth Slate
  ];
  // The second colour every piece of real ski wear has: a shoulder yoke and
  // matching cuffs. Two extra primitives, and the difference between a
  // figure in a coloured tube and a figure in a jacket.
  const npcAccentColors = [
    0xfff3e0, 0x0d47a1, 0xdcedc8, 0x212121,
    0xffd54f, 0x004d40, 0xf8bbd0, 0xff6f00,
  ];
  const npcTrouserColors = [
    0x162342, // Deep Navy
    0x20252e, // Charcoal
    0x28303d, // Graphite
    0x1a1e26, // Ink
  ];
  const npcGoggleColors = [
    0x00e1ff, // Cyan Ice
    0xff7700, // Solar Iridium
    0x33ff88, // Mint Glow
    0xff3388, // Rose Flare
  ];
  const npcHelmetColors = [0x1b1f27, 0xf0f4f8, 0x2b3444, 0x90a4ae];
  const npcSkinColors = [0xc98f6a, 0x8d5a3b, 0xecc19c, 0xa9714b];

  /* One material for every figure on the hill. Colour rides in the vertex
     attribute and the snow response rides in `aSheen`, which is the part
     that makes baking survivable: merging normally flattens a matte glove
     and a mirrored goggle lens into one `uSheen`, and an attribute hands
     the per-part value straight back to the varying the light patch reads. */
  const figureMat = new THREE.MeshLambertMaterial({
    vertexColors: true, map: fabricTex,
  });
  figureMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
      attribute float aSheen;`)
      // shading.js writes `vN64Sheen = 1.0` into this same slot and runs
      // this patch first, so the attribute lands after it and wins.
      .replace('#include <project_vertex>', `#include <project_vertex>
      vN64Sheen = aSheen;`);
  };
  shading.apply(figureMat, { sheen: 1 });

  /* The body is turned, not stacked. A cylinder is a rectangle in silhouette
     from every side, and a figure built of them read as a pile of crates at
     the distance one rider passes another. The torso, the yoke over it, the
     hips and every limb are lathes now: a jacket that swells at the chest and
     rounds over the shoulders, a pelvis rounded underneath, and limbs that
     taper and end in round joints. Each keeps the length and end radii of
     the cylinder it replaces, so every part still sits where the layouts
     below put it. About a thousand triangles a figure. */
  const lathe = (profile, seg) => new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)), seg,
  );
  // A tapered capsule inside the cylinder's own length: round ends of about
  // their own radius, so a knee or an elbow is two balls overlapping.
  const limb = (rTop, rBottom, h, seg = 8) => {
    const half = h / 2;
    const end = (r, sign) => [0, 0.5, 0.866].map((s, k) => [
      r * s, sign * (half - Math.min(r, half * 0.45) * (1 - [1, 0.866, 0.5][k])),
    ]);
    return lathe([...end(rBottom, -1), [rBottom, -half + Math.min(rBottom, half * 0.45)],
      [rTop, half - Math.min(rTop, half * 0.45)], ...end(rTop, 1).reverse()], seg);
  };
  // The jacket, hem to collar, against the 0.58 m cylinder it replaces.
  const TORSO = [[0, -0.29], [0.235, -0.285], [0.25, -0.24], [0.243, -0.12],
    [0.248, 0], [0.25, 0.10], [0.24, 0.18], [0.215, 0.235], [0.17, 0.272],
    [0.12, 0.29], [0, 0.29]];
  const torsoAt = (y) => {
    for (let i = 1; i < TORSO.length; i++) {
      const [r0, y0] = TORSO[i - 1];
      const [r1, y1] = TORSO[i];
      if (y <= y1 && y1 > y0) return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
    }
    return TORSO[TORSO.length - 1][0];
  };
  // The contrast yoke rides the shoulders 0.19 m up the torso, a few
  // millimetres proud of it, so it can follow them round instead of
  // standing off them as a flat-topped band.
  const YOKE = [0.09, 0.14, 0.18, 0.235, 0.272, 0.29]
    .map((y) => [torsoAt(y) + 0.008, y - 0.19]);

  // Reusable component geometries
  const GEO = {
    // Torso & Body
    torso: lathe(TORSO, 12),
    yoke: lathe(YOKE, 12),
    collar: new THREE.CylinderGeometry(0.14, 0.16, 0.10, 10),
    neck: new THREE.CylinderGeometry(0.062, 0.070, 0.11, 8),
    zipper: new THREE.BoxGeometry(0.025, 0.54, 0.04),
    hip: lathe([[0, -0.09], [0.13, -0.085], [0.18, -0.06], [0.195, -0.02],
      [0.205, 0.03], [0.21, 0.09]], 12),
    thigh: limb(0.095, 0.082, 0.40),
    shin: limb(0.080, 0.070, 0.38),
    boot: new THREE.BoxGeometry(0.13, 0.15, 0.26),
    bootCuff: new THREE.CylinderGeometry(0.076, 0.076, 0.12, 8),
    upperArm: limb(0.065, 0.055, 0.32, 7),
    foreArm: limb(0.055, 0.048, 0.30, 7),
    sleeveCuff: new THREE.CylinderGeometry(0.053, 0.059, 0.075, 7),
    mitten: new THREE.SphereGeometry(0.058, 8, 6),
    head: new THREE.SphereGeometry(0.105, 9, 7),
    helmet: new THREE.SphereGeometry(0.132, 10, 8),
    helmetBrim: new THREE.BoxGeometry(0.15, 0.025, 0.08),
    helmetVent: new THREE.BoxGeometry(0.09, 0.022, 0.15),
    beanie: new THREE.SphereGeometry(0.124, 10, 8),
    beanieBand: new THREE.CylinderGeometry(0.126, 0.126, 0.07, 10),
    beaniePom: new THREE.SphereGeometry(0.048, 7, 5),
    goggleFrame: new THREE.BoxGeometry(0.21, 0.078, 0.08),
    goggleLens: new THREE.BoxGeometry(0.19, 0.065, 0.02),
    goggleStrap: new THREE.CylinderGeometry(0.135, 0.135, 0.04, 10, 1, true),
    packBody: new THREE.SphereGeometry(0.5, 10, 8).scale(0.25, 0.34, 0.16),
    packStrap: new THREE.BoxGeometry(0.05, 0.27, 0.035),

    // Skis & Poles
    skiBody: new THREE.BoxGeometry(0.11, 0.03, 1.50),
    skiTip: new THREE.BoxGeometry(0.11, 0.028, 0.22),
    skiTail: new THREE.BoxGeometry(0.11, 0.028, 0.14),
    skiTopsheet: new THREE.BoxGeometry(0.085, 0.012, 1.10),
    skiBindingToe: new THREE.BoxGeometry(0.085, 0.05, 0.09),
    skiBindingHeel: new THREE.BoxGeometry(0.085, 0.065, 0.09),
    skiBindingPlate: new THREE.BoxGeometry(0.095, 0.02, 0.38),
    poleShaft: new THREE.CylinderGeometry(0.012, 0.009, 1.15, 6),
    poleGrip: new THREE.CylinderGeometry(0.022, 0.018, 0.14, 6),
    poleBasket: new THREE.CylinderGeometry(0.058, 0.058, 0.012, 8),

    // Snowboard & Bindings
    boardWaist: new THREE.BoxGeometry(0.27, 0.035, 0.90),
    boardNose: new THREE.BoxGeometry(0.295, 0.032, 0.36),
    boardTail: new THREE.BoxGeometry(0.295, 0.032, 0.36),
    boardTipCurved: new THREE.BoxGeometry(0.29, 0.030, 0.18),
    boardGraphic: new THREE.BoxGeometry(0.20, 0.012, 1.30),
    bindingBase: new THREE.BoxGeometry(0.18, 0.025, 0.28),
    bindingHighback: new THREE.BoxGeometry(0.15, 0.18, 0.025),
    bindingStrapAnkle: new THREE.BoxGeometry(0.16, 0.045, 0.14),
    bindingStrapToe: new THREE.BoxGeometry(0.15, 0.035, 0.09),
  };

  // The kit that never varies between riders, with the snow response each
  // surface had when every part carried its own material.
  const HARD = { color: 0x181c24, sheen: 0.40 }; // bindings, boots, hardware
  const DETAIL = { color: 0x101318, sheen: 0.20 }; // straps, zips, frames
  const PALE = { color: 0xeef2f7, sheen: 0.50 }; // pole shafts

  // `bone` is which of the body's five bones the part rides on (see
  // `NPC_RIG`): 0 the body, 1/2 the −X arm and its hand, 3/4 the +X ones.
  const put = (list, geo, kit, pos, rot, scale, bone = 0) => {
    list.push({
      geo, color: kit.color, sheen: kit.sheen, pos, rot, scale, bone,
    });
  };
  // The top and the bottom of a `limb` part as it was put: its two joints.
  const limbEnds = (pos, rot, h) => {
    _limbQ.setFromEuler(_limbE.set(rot[0], rot[1], rot[2]));
    return [
      new THREE.Vector3(0, h / 2, 0).applyQuaternion(_limbQ).add(_limbP.set(...pos)),
      new THREE.Vector3(0, -h / 2, 0).applyQuaternion(_limbQ).add(_limbP.set(...pos)),
    ];
  };
  const _limbQ = new THREE.Quaternion();
  const _limbE = new THREE.Euler();
  const _limbP = new THREE.Vector3();

  function buildSkier(v) {
    const deck = [];
    const body = [];
    const jacket = { color: v.jacket, sheen: 0.30 };
    const accent = { color: v.accent, sheen: 0.30 };
    const trouser = { color: v.trouser, sheen: 0.20 };
    const helmetKit = { color: v.helmet, sheen: 0.50 };
    const lens = { color: v.goggle, sheen: 0.90 };
    const skin = { color: v.skin, sheen: 0.15 };

    // --- Skis & Bindings ---
    for (const side of [-1, 1]) {
      const sx = side * 0.16;
      // Main ski runner
      put(deck, GEO.skiBody, HARD, [sx, 0.015, 0]);
      // A painted topsheet, because a ski seen from behind is a topsheet
      put(deck, GEO.skiTopsheet, accent, [sx, 0.032, -0.05]);
      // Upturned ski tip (pointing downhill -Z)
      put(deck, GEO.skiTip, HARD, [sx, 0.052, -0.82], [0.38, 0, 0]);
      // Slight ski tail kick (+Z)
      put(deck, GEO.skiTail, HARD, [sx, 0.030, 0.79], [-0.22, 0, 0]);
      // Bindings
      put(deck, GEO.skiBindingPlate, DETAIL, [sx, 0.035, 0]);
      put(deck, GEO.skiBindingToe, HARD, [sx, 0.065, -0.14]);
      put(deck, GEO.skiBindingHeel, HARD, [sx, 0.075, 0.14]);

      // Boots (pointing forward -Z)
      put(deck, GEO.boot, HARD, [sx, 0.09, 0]);
      put(deck, GEO.bootCuff, DETAIL, [sx, 0.17, -0.02], [-0.24, 0, 0]);

      // Shins & Thighs (flexed knees driving forward)
      put(deck, GEO.shin, trouser, [sx, 0.34, -0.06], [-0.32, 0, 0]);
      put(deck, GEO.thigh, trouser, [sx, 0.62, -0.04], [0.32, 0, 0]);
    }

    // --- Pelvis & Torso ---
    put(body, GEO.hip, trouser, [0, 0.80, 0.02], [-0.10, 0, 0]);
    // Torso hinged forward towards -Z (down the fall line)
    put(body, GEO.torso, jacket, [0, 1.10, -0.06], [-0.22, 0, 0]);
    // Contrast yoke across the shoulders
    put(body, GEO.yoke, accent, [0, 1.29, -0.10], [-0.22, 0, 0]);
    // Center zipper line down front (-Z)
    put(body, GEO.zipper, DETAIL, [0, 1.10, -0.18], [-0.22, 0, 0]);
    // Jacket collar
    put(body, GEO.collar, jacket, [0, 1.34, -0.10], [-0.22, 0, 0]);
    put(body, GEO.neck, skin, [0, 1.39, -0.10], [-0.22, 0, 0]);

    // --- Head, Helmet & Goggles (facing downhill -Z) ---
    put(body, GEO.head, skin, [0, 1.46, -0.10]);
    if (v.beanie) {
      put(body, GEO.beanie, helmetKit, [0, 1.485, -0.10], null, [1, 0.92, 1.02]);
      put(body, GEO.beanieBand, accent, [0, 1.435, -0.10]);
      put(body, GEO.beaniePom, accent, [0, 1.60, -0.09]);
    } else {
      put(body, GEO.helmet, helmetKit, [0, 1.485, -0.10], null, [1, 0.88, 1.05]);
      put(body, GEO.helmetVent, DETAIL, [0, 1.60, -0.10]);
      // Helmet brim over goggles
      put(body, GEO.helmetBrim, helmetKit, [0, 1.54, -0.18], [-0.12, 0, 0]);
    }
    // Goggles mounted on front face (-Z)
    put(body, GEO.goggleFrame, DETAIL, [0, 1.47, -0.20]);
    put(body, GEO.goggleLens, lens, [0, 1.47, -0.22]);
    // Goggle strap around back (+Z)
    put(body, GEO.goggleStrap, DETAIL, [0, 1.48, -0.10], null, [1, 1, 1.04]);

    // --- Arms, Mittens & Poles ---
    const arms = [];
    for (const side of [-1, 1]) {
      const ax = side * 0.26;
      const arm = side < 0 ? 1 : 3;
      // Upper arm angled forward and slightly out
      put(body, GEO.upperArm, jacket, [ax, 1.18, -0.14], [-0.35, 0, side * 0.32], null, arm);
      // Forearm reaching forward to grip pole
      put(body, GEO.foreArm, jacket, [ax * 1.05, 0.98, -0.28], [-0.55, 0, side * 0.18], null, arm);
      // Cuff where the sleeve ends
      put(body, GEO.sleeveCuff, accent, [side * 0.265, 0.865, -0.325], [-0.55, 0, side * 0.18], null, arm);
      // Mitten holding the pole grip
      put(body, GEO.mitten, HARD, [side * 0.26, 0.90, -0.34], null, null, arm);

      // Ski Pole held in hand, shaft angling down and back (+Z) — from the
      // grip to the basket, which it used to miss: tilted the other way, it
      // ran forwards from the hand and into the snow ahead of the boot.
      const px = side * 0.26;
      const py = 0.90;
      const pz = -0.34;
      const tip = new THREE.Vector3(px + side * 0.10, 0.10, pz + 0.68);
      const shaft = tip.clone().sub(_limbP.set(px, py, pz));
      const lean = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), shaft.clone().normalize()));
      const tilt = [lean.x, lean.y, lean.z];
      put(body, GEO.poleGrip, DETAIL, [px, py, pz], tilt, null, arm + 1);
      put(body, GEO.poleShaft, PALE, [px + shaft.x / 2, py + shaft.y / 2, pz + shaft.z / 2],
        tilt, [1, shaft.length() / 1.15, 1], arm + 1);
      put(body, GEO.poleBasket, DETAIL, [tip.x, tip.y, tip.z], tilt, null, arm + 1);
      const [shoulder, elbow] = limbEnds([ax, 1.18, -0.14], [-0.35, 0, side * 0.32], 0.32);
      arms.push({ shoulder, elbow, hand: new THREE.Vector3(px, py, pz), basket: tip });
    }

    if (v.pack) {
      put(body, GEO.packBody, accent, [0, 1.14, 0.20], [-0.22, 0, 0]);
      for (const side of [-1, 1]) {
        put(body, GEO.packStrap, DETAIL, [side * 0.13, 1.13, -0.16], [-0.22, 0, 0]);
      }
    }

    return { deck, body, hip: 0.80, arms };
  }

  function buildBoarder(v) {
    const deck = [];
    const body = [];
    const jacket = { color: v.jacket, sheen: 0.30 };
    const accent = { color: v.accent, sheen: 0.30 };
    const trouser = { color: v.trouser, sheen: 0.20 };
    const helmetKit = { color: v.helmet, sheen: 0.50 };
    const lens = { color: v.goggle, sheen: 0.90 };
    const skin = { color: v.skin, sheen: 0.15 };

    // --- Snowboard Deck ---
    // Waist (center)
    put(deck, GEO.boardWaist, HARD, [0, 0.018, 0]);
    // Nose section & curved upturned tip (-Z)
    put(deck, GEO.boardNose, HARD, [0, 0.022, -0.55]);
    put(deck, GEO.boardTipCurved, HARD, [0, 0.055, -0.78], [0.35, 0, 0]);
    // Tail section & kicktail (+Z)
    put(deck, GEO.boardTail, HARD, [0, 0.022, 0.55]);
    put(deck, GEO.boardTipCurved, HARD, [0, 0.055, 0.78], [-0.35, 0, 0]);
    // Topsheet graphic — the board is what the player sees most of
    put(deck, GEO.boardGraphic, accent, [0, 0.040, 0]);

    // --- Bindings (Front ~+18°, Rear ~-6°) ---
    const frontAngle = 0.31; // +18 deg
    const rearAngle = -0.10; // -6 deg

    // Front binding (-Z)
    put(deck, GEO.bindingBase, DETAIL, [0, 0.035, -0.26], [0, frontAngle, 0]);
    put(deck, GEO.bindingHighback, HARD, [-0.07, 0.12, -0.26], [0, frontAngle, -0.22]);
    put(deck, GEO.bindingStrapAnkle, HARD, [0, 0.08, -0.26], [0, frontAngle, 0]);
    put(deck, GEO.bindingStrapToe, HARD, [0.05, 0.06, -0.26], [0, frontAngle, 0]);

    // Rear binding (+Z)
    put(deck, GEO.bindingBase, DETAIL, [0, 0.035, 0.26], [0, rearAngle, 0]);
    put(deck, GEO.bindingHighback, HARD, [-0.07, 0.12, 0.26], [0, rearAngle, -0.22]);
    put(deck, GEO.bindingStrapAnkle, HARD, [0, 0.08, 0.26], [0, rearAngle, 0]);
    put(deck, GEO.bindingStrapToe, HARD, [0.05, 0.06, 0.26], [0, rearAngle, 0]);

    // --- Boots ---
    put(deck, GEO.boot, HARD, [0, 0.09, -0.26], [0, frontAngle, 0]);
    put(deck, GEO.bootCuff, DETAIL, [-0.02, 0.17, -0.26], [0, frontAngle, -0.22]);
    put(deck, GEO.boot, HARD, [0, 0.09, 0.26], [0, rearAngle, 0]);
    put(deck, GEO.bootCuff, DETAIL, [-0.02, 0.17, 0.26], [0, rearAngle, -0.22]);

    // --- Legs (Athletic Riding Squat) ---
    // Front leg: knee bent and driving towards the nose
    put(deck, GEO.shin, trouser, [0.02, 0.32, -0.22], [0.22, frontAngle, -0.15]);
    put(deck, GEO.thigh, trouser, [0.01, 0.58, -0.12], [-0.28, frontAngle, 0.18]);

    // Rear leg: knee flexed inward
    put(deck, GEO.shin, trouser, [0.02, 0.32, 0.22], [-0.22, rearAngle, -0.15]);
    put(deck, GEO.thigh, trouser, [0.01, 0.58, 0.12], [0.28, rearAngle, 0.18]);

    // --- Pelvis & Torso (Opened ~35° towards fall line) ---
    const stanceAngle = 0.58; // ~33 deg open
    put(body, GEO.hip, trouser, [0, 0.76, 0], [-0.08, stanceAngle, 0]);
    put(body, GEO.torso, jacket, [0, 1.05, 0], [-0.16, stanceAngle, 0]);
    put(body, GEO.yoke, accent, [0, 1.24, -0.03], [-0.16, stanceAngle, 0]);
    put(body, GEO.zipper, DETAIL,
      [0.12 * Math.sin(stanceAngle), 1.05, -0.12 * Math.cos(stanceAngle)],
      [-0.16, stanceAngle, 0]);
    put(body, GEO.collar, jacket, [0, 1.28, -0.02], [-0.16, stanceAngle, 0]);
    put(body, GEO.neck, skin, [0, 1.33, -0.03], [-0.16, stanceAngle, 0]);

    // --- Head, Helmet & Goggles (Looking downhill -Z) ---
    const headAngle = 0.22; // aligned with fall line
    const hx = 0.02;
    put(body, GEO.head, skin, [hx, 1.40, -0.05]);
    if (v.beanie) {
      put(body, GEO.beanie, helmetKit, [hx, 1.425, -0.05], [0, headAngle, 0], [1, 0.92, 1.02]);
      put(body, GEO.beanieBand, accent, [hx, 1.375, -0.05], [0, headAngle, 0]);
      put(body, GEO.beaniePom, accent, [hx, 1.54, -0.04]);
    } else {
      put(body, GEO.helmet, helmetKit, [hx, 1.425, -0.05], [0, headAngle, 0], [1, 0.88, 1.05]);
      put(body, GEO.helmetVent, DETAIL, [hx, 1.54, -0.05], [0, headAngle, 0]);
      put(body, GEO.helmetBrim, helmetKit,
        [hx + Math.sin(headAngle) * 0.08, 1.47, -0.05 - Math.cos(headAngle) * 0.08],
        [-0.12, headAngle, 0]);
    }
    // Goggles facing downhill (-Z)
    put(body, GEO.goggleFrame, DETAIL,
      [hx + Math.sin(headAngle) * 0.10, 1.41, -0.05 - Math.cos(headAngle) * 0.10],
      [0, headAngle, 0]);
    put(body, GEO.goggleLens, lens,
      [hx + Math.sin(headAngle) * 0.12, 1.41, -0.05 - Math.cos(headAngle) * 0.12],
      [0, headAngle, 0]);
    put(body, GEO.goggleStrap, DETAIL, [hx, 1.42, -0.05], [0, headAngle, 0], [1, 1, 1.04]);

    // --- Arms (Freeride Balance Posture) ---
    // Lead arm reaching forward/downward (-Z); on the arm bone that answers
    // the turns (1), the trailing one on the other (3)
    put(body, GEO.upperArm, jacket, [0.18, 1.12, -0.15], [-0.45, stanceAngle, 0.35], null, 1);
    put(body, GEO.foreArm, jacket, [0.26, 0.94, -0.28], [-0.65, stanceAngle, 0.20], null, 1);
    put(body, GEO.sleeveCuff, accent, [0.285, 0.865, -0.335], [-0.65, stanceAngle, 0.20], null, 1);
    put(body, GEO.mitten, HARD, [0.30, 0.85, -0.38], null, null, 1);

    // Trailing arm raised out/back for balance (+Z)
    put(body, GEO.upperArm, jacket, [-0.18, 1.14, 0.12], [0.35, stanceAngle, -0.45], null, 3);
    put(body, GEO.foreArm, jacket, [-0.28, 1.02, 0.25], [0.55, stanceAngle, -0.30], null, 3);
    put(body, GEO.sleeveCuff, accent, [-0.325, 0.965, 0.325], [0.55, stanceAngle, -0.30], null, 3);
    put(body, GEO.mitten, HARD, [-0.35, 0.98, 0.36], null, null, 3);
    const arms = [
      [[0.18, 1.12, -0.15], [-0.45, stanceAngle, 0.35], [0.30, 0.85, -0.38]],
      [[-0.18, 1.14, 0.12], [0.35, stanceAngle, -0.45], [-0.35, 0.98, 0.36]],
    ].map(([pos, rot, hand]) => {
      const [shoulder, elbow] = limbEnds(pos, rot, 0.32);
      return { shoulder, elbow, hand: new THREE.Vector3(...hand), basket: null };
    });

    if (v.pack) {
      put(body, GEO.packBody, accent,
        [-0.10 * Math.sin(stanceAngle), 1.09, 0.16 * Math.cos(stanceAngle)],
        [-0.16, stanceAngle, 0]);
    }

    return { deck, body, hip: 0.76, arms };
  }

  /* Split at the hip, bake each half, hang the upper one off the joint.
     The body list is authored in the same frame as the deck and shifted
     down by the pivot here rather than in the builders, so a part can be
     moved between the two lists without re-deriving its coordinates. */
  function makeFigure(spec) {
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';

    const deckMesh = new THREE.Mesh(
      compose(THREE, spec.deck, { uv: true, sheen: true }), figureMat,
    );
    const lifted = spec.body.map((p) => ({
      ...p, pos: [p.pos[0], p.pos[1] - spec.hip, p.pos[2]],
    }));
    const bodyGeo = skinByParts(compose(THREE, lifted, { uv: true, sheen: true }), lifted);
    const bodyMesh = new THREE.SkinnedMesh(bodyGeo, figureMat);
    bodyMesh.position.y = spec.hip;
    bodyMesh.rotation.order = 'YXZ';

    for (const m of [deckMesh, bodyMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    const arms = rigBody(bodyMesh, spec.arms, spec.hip);
    return { group, deck: deckMesh, body: bodyMesh, hip: spec.hip, arms };
  }

  /* The skin of a figure built from parts: every vertex rides its part's
     bone, rigidly — `compose` lays each part down as one contiguous run of
     its de-indexed corners, the same assumption the rider's cloth masks make. */
  function skinByParts(g, parts) {
    const n = g.attributes.position.count;
    const index = new Uint16Array(n * 4);
    const weight = new Float32Array(n * 4);
    let o = 0;
    for (const part of parts) {
      const span = part.geo.index ? part.geo.index.count : part.geo.attributes.position.count;
      for (let i = o; i < o + span; i++) {
        index[i * 4] = part.bone || 0;
        weight[i * 4] = 1;
      }
      o += span;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    return g;
  }

  /* The skin of a modelled figure, whose body arrives as one welded buffer
     with nothing in it to say which vertex is an arm: so each is weighed by
     where it is. Measured against the bones `riders.py` posed — the spine,
     each upper arm, each forearm run on past the hand to take in the mitt,
     and each pole — scaled by how thick that part is, the nearest wins. An
     upper arm blends into the body over its first decimetre, the way a
     shoulder does, so the sleeve bends at the seam rather than tearing; a
     pole is everything thin along its line, except the mitt round its grip,
     which stays with the hand. */
  const _sk = [0, 1, 2, 3].map(() => new THREE.Vector3());
  function segment(p, a, b) {
    _sk[0].subVectors(b, a);
    const len2 = Math.max(_sk[0].lengthSq(), 1e-9);
    const t = Math.min(1, Math.max(0, _sk[1].subVectors(p, a).dot(_sk[0]) / len2));
    return { d: _sk[2].copy(a).addScaledVector(_sk[0], t).distanceTo(p), t };
  }
  function skinByJoints(g, arms, spine) {
    const p = g.attributes.position;
    const index = new Uint16Array(p.count * 4);
    const weight = new Float32Array(p.count * 4);
    const v = new THREE.Vector3();
    const handEnd = arms.map((a) => a.hand.clone().add(_sk[3].subVectors(a.hand, a.elbow).setLength(0.075)));
    const gripStart = arms.map((a) => (a.basket
      ? a.hand.clone().add(_sk[3].subVectors(a.hand, a.basket).setLength(0.09)) : null));
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let best = segment(v, spine[0], spine[1]).d / 0.17;
      let bone = 0;
      let w = 1;
      arms.forEach((a, k) => {
        const upper = segment(v, a.shoulder, a.elbow);
        const fore = segment(v, a.elbow, handEnd[k]);
        const score = Math.min(upper.d, fore.d) / 0.085;
        if (score < best) {
          best = score;
          bone = 1 + k * 2;
          // the shoulder's seam: blended into the body over the first decimetre
          const along = upper.d <= fore.d ? upper.t * NPC_RIG.upper : 1;
          w = Math.min(1, Math.max(0, (along - 0.02) / 0.10));
        }
        if (a.basket) {
          const pole = segment(v, gripStart[k], a.basket);
          const nearHand = v.distanceTo(a.hand) < 0.065;
          if (pole.d < (nearHand ? 0.022 : 0.05) && pole.d / 0.03 < best + 0.5) {
            best = pole.d / 0.03;
            bone = 2 + k * 2;
            w = 1;
          }
        }
      });
      index[i * 4] = bone;
      weight[i * 4] = w;
      if (w < 1) {
        index[i * 4 + 1] = 0;
        weight[i * 4 + 1] = 1 - w;
      }
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    return g;
  }

  /* The bones, put where the joints are and bound in that rest pose: the
     body at the hip, each arm at its shoulder, each hand (where a pole
     pivots) at the hand. Called again when the modelled figures arrive,
     whose joints are elsewhere; the bones are kept and only moved. What the
     poses need to know about each arm — the pole's length and its angle at
     rest, how high the hand rides — comes back with them. */
  function rigBody(mesh, arms, hip) {
    let skeleton = mesh.skeleton;
    if (!skeleton) {
      const root = new THREE.Bone();
      const bones = [root];
      for (let k = 0; k < 2; k++) {
        const arm = new THREE.Bone();
        const grip = new THREE.Bone();
        arm.rotation.order = 'ZXY';
        grip.rotation.order = 'ZXY';
        arm.add(grip);
        root.add(arm);
        bones.push(arm, grip);
      }
      mesh.add(root);
      skeleton = new THREE.Skeleton(bones);
    }
    const [root, armA, gripA, armB, gripB] = skeleton.bones;
    root.position.set(0, 0, 0);
    const out = [[armA, gripA], [armB, gripB]].map(([arm, grip], k) => {
      const j = arms[k];
      arm.position.copy(j.shoulder);
      arm.position.y -= hip;
      grip.position.subVectors(j.hand, j.shoulder);
      arm.rotation.set(0, 0, 0);
      grip.rotation.set(0, 0, 0);
      const pole = j.basket ? j.basket.clone().sub(j.hand) : null;
      return {
        arm, grip, side: k ? 1 : -1,
        length: pole ? pole.length() : 0,
        rest: pole ? Math.atan2(pole.z, -pole.y) : 0,
        handY: j.hand.y,
        // the tip in the hand bone's own frame, and the pole's eased turn
        tip: pole, swing: 0, out: 0, plantW: 0,
      };
    });
    mesh.bind(skeleton);
    /* The arms reach past the rest pose's bounds — a planted pole a long way
       — so the culling sphere is the rest one with room for that, rather
       than whatever pose it happened to be measured in. */
    mesh.geometry.computeBoundingSphere();
    mesh.boundingSphere = mesh.geometry.boundingSphere.clone();
    mesh.boundingSphere.radius += 0.6;
    return out;
  }

  /* Where `riders.py` put the modelled figures' joints (`npc_skier`,
     `npc_boarder`): the same matrices, the same two-bone solve, in the
     file's frame. */
  function modelledJoints(kind, hip) {
    const R = NPC_RIG;
    const torso = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    if (kind === 'skier') {
      torso.makeTranslation(0, hip + R.waist, 0)
        .multiply(m.makeRotationY(Math.PI / 2)).multiply(m.makeRotationZ(R.skierLean));
    } else {
      torso.makeTranslation(0, hip, 0).multiply(m.makeRotationY(R.boarderOpen))
        .multiply(m.makeTranslation(0, R.waist, 0)).multiply(m.makeRotationZ(R.boarderLean));
    }
    const V = THREE.Vector3;
    const posed = kind === 'skier'
      ? [-1, 1].map((side) => [side, new V(side * 0.265, 0.905, -0.40),
        new V(side * 0.55, -0.35, 0.75), new V(side * 0.38, 0.10, 0.30)])
      : [[-1, new V(0.20, 0.98, -0.34), new V(-0.7, -0.3, -0.45), null],
        [1, new V(0.08, 0.96, 0.30), new V(-0.7, -0.3, 0.45), null]];
    const arms = posed.map(([side, hand, pole, basket]) => {
      const shoulder = new V(0, R.shoulderY, side * R.shoulderZ).applyMatrix4(torso);
      // the rig's own two-bone solve, as riders.py runs it
      const d = hand.clone().sub(shoulder);
      const f = d.clone().normalize();
      const reach = Math.min(Math.max(d.length(), Math.abs(R.upper - R.fore) + 0.05), (R.upper + R.fore) * 0.999);
      const u = pole.clone().addScaledVector(f, -pole.dot(f)).normalize();
      const c = Math.min(1, Math.max(-1,
        (R.upper * R.upper + reach * reach - R.fore * R.fore) / (2 * R.upper * reach)));
      const elbow = shoulder.clone().addScaledVector(f, R.upper * c)
        .addScaledVector(u, R.upper * Math.sqrt(1 - c * c));
      return { shoulder, elbow, hand, basket };
    });
    const spine = [new V(0, 0, 0).applyMatrix4(torso), new V(0, R.neckY, 0).applyMatrix4(torso)];
    return { arms, spine };
  }

  /* THE FIGURES AS MODELLED. Once `npcs.glb` has arrived (see `main.js`)
     each figure's two halves are rebaked from it: the same split at the hip,
     the same one material, now the player's own kit posed into a skier's or
     a boarder's stance in Blender (`tools/blender/riders.py`). The file's
     materials are roles; this is where a role becomes this figure's colour
     and the snow response every part used to carry. The hip the body hinges
     on travels with the file, since the modelled boarder stands taller than
     the one above. */
  const BASE = { color: 0x2b3444, sheen: 0.40 }; // ski and board bases
  const npcLook = (v) => {
    const role = {
      npcJacket: { color: v.jacket, sheen: 0.30 },
      npcAccent: { color: v.accent, sheen: 0.30 },
      npcTrouser: { color: v.trouser, sheen: 0.20 },
      npcHelmet: { color: v.helmet, sheen: 0.50 },
      npcBoot: { color: v.helmet, sheen: 0.45 },
      npcLens: { color: v.goggle, sheen: 0.90 },
      npcSkin: { color: v.skin, sheen: 0.15 },
      npcHard: HARD,
      npcDetail: DETAIL,
      npcPale: PALE,
      npcBase: BASE,
    };
    return (r) => role[r] && { color: role[r].color, aSheen: [role[r].sheen] };
  };
  /* The weave is laid on by a planar projection rather than unwrapped UVs:
     at the size these figures are drawn, a ripstop grid is a texture of the
     cloth, not a pattern anyone follows round a seam. */
  const weaveUv = (g) => {
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = (p.getX(i) + p.getZ(i)) * 3;
      uv[i * 2 + 1] = p.getY(i) * 3;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  };
  function modelledFigure(nodes, kind, v) {
    const pick = (piece) => {
      const node = nodes[`npc_${kind}_${piece}`];
      if (!node) throw new Error(`rider model: no npc_${kind}_${piece}`);
      return node;
    };
    const look = npcLook(v);
    const hip = pick('body').extras.hip;
    const deck = weaveUv(riderGeometry(THREE, [pick('deck')], look));
    const parts = [pick('body'), pick(v.beanie ? 'beanie' : 'helmet')];
    if (v.pack) parts.push(pick('pack'));
    const body = weaveUv(riderGeometry(THREE, parts, look).translate(0, -hip, 0));
    // weighed to its bones in the body's own frame, which hangs at the hip
    const joints = modelledJoints(kind, hip);
    const down = (p) => p && p.clone().setY(p.y - hip);
    skinByJoints(body, joints.arms.map((a) => ({
      shoulder: down(a.shoulder), elbow: down(a.elbow), hand: down(a.hand), basket: down(a.basket),
    })), joints.spine.map(down));
    return { deck, body, hip, arms: joints.arms };
  }

  /* Eight riders where there used to be five. The count went up because the
     cost per rider went down by an order of magnitude, and a resort with
     five people on it reads as an empty one. */
  const NUM_NPCS = 8;
  const npcs = [];
  const npcCentres = [0, 0];
  for (let i = 0; i < NUM_NPCS; i++) {
    const isSkier = i % 2 === 0;
    const v = {
      jacket: npcJacketColors[i % npcJacketColors.length],
      accent: npcAccentColors[(i * 5 + 2) % npcAccentColors.length],
      trouser: npcTrouserColors[i % npcTrouserColors.length],
      helmet: npcHelmetColors[(i * 3) % npcHelmetColors.length],
      goggle: npcGoggleColors[i % npcGoggleColors.length],
      skin: npcSkinColors[(i * 3 + 1) % npcSkinColors.length],
      beanie: i % 4 === 3,
      pack: i % 3 === 1,
    };
    const fig = makeFigure(isSkier ? buildSkier(v) : buildBoarder(v));
    const stature = 0.92 + (i % 4) * 0.045;
    fig.group.scale.set(stature * (0.96 + (i % 3) * 0.035), stature, stature);
    root.add(fig.group);
    npcs.push({
      mesh: fig.group,
      deck: fig.deck,
      body: fig.body,
      hip: fig.hip,
      kind: isSkier ? 'skier' : 'boarder',
      dress: v,
      // A skier's shoulders can hold the fall line far harder than a
      // boarder's, whose stance is already turned across the board.
      counter: isSkier ? 0.55 : 0.28,
      x: 0,
      z: 100 + i * 40,
      y: 0,
      vx: 0,
      vz: -(11 + (i % 4) * 3),
      tumbled: false,
      tumbleTimer: 0,
      // the getting-up blend: seconds left, and the attitude it starts from
      recover: 0,
      recoverFrom: new THREE.Quaternion(),
      bodyFrom: new THREE.Quaternion(),
      sPhase: Math.random() * Math.PI * 2,
      // which branch of a fork it is riding (−1, +1), 0 where there is none
      branch: 0,
      // the arms' bones and what they know (see `rigBody`), and the turn
      // they answer: the sideways acceleration, smoothed
      arms: fig.arms,
      ax: 0,
      vxLast: 0,
      flail: 0,
    });
  }

  /* …and whatever the turn, the slope across the line or the lean has done
     to the snow under it, a pole's tip never goes into it. The swing above
     is worked out in the body's own frame; here the tip is found where it
     really is, and a tip below the snow is swung about the hand — fore or
     aft, whichever is the smaller turn — exactly far enough to clear it,
     which is what a trailing pole does when the hill comes up to meet it.
     One matrix update and one height sample per pole. */
  const _gp = new THREE.Vector3();
  const _tip = new THREE.Vector3();
  const _ax = new THREE.Vector3();
  const _az = new THREE.Vector3();
  const _cr = new THREE.Vector3();
  const _tq = new THREE.Quaternion();
  const wrapPi = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  /* The smallest turn about the unit axis `k` that raises the end of `p` by
     `rise` (negative lowers it). Turned by Δ, the end's height is
     (p·y − w)·cos Δ + (k × p)·y·sin Δ + w, with w = k·y (k · p); out of
     reach, it is the turn that gets closest. */
  function turnFor(p, k, rise) {
    const w = k.y * k.dot(p);
    const A = p.y - w;
    const B = _cr.crossVectors(k, p).y;
    const R = Math.hypot(A, B);
    if (R < 1e-6) return 0;
    const phi = Math.atan2(B, A);
    const c = Math.acos(Math.min(1, Math.max(-1, (A + rise) / R)));
    const d1 = wrapPi(phi - c);
    const d2 = wrapPi(phi + c);
    return Math.abs(d1) < Math.abs(d2) ? d1 : d2;
  }
  function liftTips(npc) {
    npc.mesh.updateMatrixWorld(true);
    for (const a of npc.arms) {
      if (!a.tip) continue;
      _gp.setFromMatrixPosition(a.grip.matrixWorld);
      _tip.copy(a.tip).applyMatrix4(a.grip.matrixWorld).sub(_gp);
      const snow = heightAt(_gp.x + _tip.x, _gp.z + _tip.z) + NPC_POLE.clear;
      _ax.setFromMatrixColumn(a.grip.matrixWorld, 0).normalize();
      /* Planted, the tip goes *onto* the snow, not merely above it — by
         turning the pole in or out at the hand, so it lands where the swing
         put it along the travel. */
      if (a.plantW > 0.01) {
        _az.setFromMatrixColumn(a.arm.matrixWorld, 2).normalize();
        const dz = turnFor(_tip, _az, snow - _gp.y - _tip.y) * a.plantW;
        const out = Math.max(0.05, a.out + a.side * dz);
        const turned = (out - a.out) * a.side;
        a.out = out;
        _tq.setFromAxisAngle(_az, turned);
        _tip.applyQuaternion(_tq);
        _ax.applyQuaternion(_tq);
        // …and if the hand is riding too high for that (the figure leaning
        // the other way still), the tip comes back towards the boot instead
        const high = snow - _gp.y - _tip.y;
        if (high < -0.005) {
          const dx = turnFor(_tip, _ax, high) * a.plantW;
          a.swing += dx;
          _tq.setFromAxisAngle(_ax, dx);
          _tip.applyQuaternion(_tq);
        }
      }
      // Anywhere else, only ever lifted: fore or aft, the smaller turn.
      const deficit = snow - _gp.y - _tip.y;
      if (deficit > 0) a.swing += turnFor(_tip, _ax, deficit);
      a.grip.rotation.set(a.swing, 0, a.side * a.out);
    }
  }

  /* The arms, posed for one figure (see `NPC_POLE`). `turn` is the smoothed
     sideways acceleration over 15 m/s², positive turning towards +X, which
     is the figure's right and — for a boarder — the toe edge. Every target
     is a continuous function of the turn's phase or of a smoothed signal,
     and the bones ease towards it, so nothing here can snap. */
  const settle = (bone, x, z, rate, dt) => {
    const k = 1 - Math.exp(-rate * dt);
    bone.rotation.x += (x - bone.rotation.x) * k;
    bone.rotation.z += (z - bone.rotation.z) * k;
  };
  function poseArms(npc, dt, turn, hipY) {
    const flail = npc.flail;
    const t = npc.flailClock || 0;
    if (npc.kind === 'skier') {
      /* `d` is the turn's phase since its last edge change: the figure's own
         path runs TURN_LAG behind `sPhase`, and its edge changes as it
         crosses its line. The pole that plants is the one on the inside of
         the turn to come; the other is the one that planted last. */
      const psi = npc.sPhase - TURN_LAG;
      const d = ((psi % Math.PI) + Math.PI) % Math.PI;
      const next = Math.sin(psi) >= 0 ? 1 : -1;
      const speed = Math.max(4, Math.abs(npc.vz));
      for (const a of npc.arms) {
        let reach = 0;
        let swing = 0;
        const touch = a.rest + NPC_POLE.ahead;   // the swing that lands the tip ahead of the hand
        const planted = (since) => {
          // running past a tip on the snow, `since` seconds after it landed
          const h = Math.max(0.3, a.handY - (npc.hip - hipY));
          const lean = Math.atan(Math.tan(-NPC_POLE.ahead) + speed * since / h);
          return Math.max(0, Math.min(touch, a.rest - lean));
        };
        let plant = 0;
        if (a.side === next) {
          const f = (d - (Math.PI - NPC_POLE.swing)) / (NPC_POLE.swing - NPC_POLE.lead);
          reach = f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f);
          swing = d > Math.PI - NPC_POLE.lead
            ? planted((d - (Math.PI - NPC_POLE.lead)) / TURN_RATE)
            : touch * reach;
          // brought down onto the snow through the end of the swing, and on
          // it until the skier has run past it
          const down = Math.min(1, Math.max(0, (f - 0.55) / 0.35));
          plant = down * down * (3 - 2 * down) * (swing > 0.05 ? 1 : 0);
        } else {
          const f = Math.min(1, d / NPC_POLE.release);
          reach = 1 - f * f * (3 - 2 * f);
          swing = planted((d + NPC_POLE.lead) / TURN_RATE);
          plant = swing > 0.05 ? 1 : 0;
        }
        a.plantW += (plant * (1 - flail) - a.plantW) * (1 - Math.exp(-25 * dt));
        /* Out to the side as far as it takes to keep the tip off the snow:
           the pole is `length` long from a hand `handY` up, and turned
           `rest − swing` from straight down along the travel. */
        const along = Math.cos(a.rest - swing);
        const room = (a.handY - NPC_POLE.clear) / Math.max(1e-3, a.length * along);
        const out = along > 0 && room < 1 ? Math.acos(room) : 0;
        const armX = NPC_POLE.reach * reach + Math.sin(t * 6.3 + a.side) * 0.9 * flail;
        const armZ = a.side * (NPC_POLE.wide + 0.5 * flail);
        settle(a.arm, armX, armZ, 14, dt);
        // The pole's swing is measured from the body, so the arm's own reach
        // forward is taken back out of it at the hand.
        const k = 1 - Math.exp(-30 * dt);
        a.swing += (swing * (1 - flail) + Math.sin(t * 5.1 + a.side) * 0.8 * flail - a.arm.rotation.x - a.swing) * k;
        a.out += (out * (1 - flail) - a.out) * k;
        a.grip.rotation.set(a.swing, 0, a.side * a.out);
      }
      liftTips(npc);
      return;
    }
    /* A boarder: the leading arm (−X bone) into a toeside turn and over the
       nose on a heelside one; the trailing arm out the other way. */
    const toe = Math.max(0, turn);
    const heel = Math.max(0, -turn);
    const [lead, rear] = npc.arms;
    settle(lead.arm, 0.25 * toe + 0.35 * heel + Math.sin(t * 6.3) * 0.9 * flail,
      0.45 * toe + 0.12 * heel - 0.5 * flail, 6, dt);
    settle(rear.arm, -0.25 * toe - 0.20 * heel + Math.sin(t * 5.7 + 1) * 0.9 * flail,
      -0.40 * toe - 0.42 * heel + 0.5 * flail, 6, dt);
  }

  /* A tumbling figure turns about its hip, held a little over hip height,
     rather than about its boots — the group's origin — which drove head and
     shoulders into the hill for most of the cartwheel. `k` hands it back to
     the boots as it gets up. */
  function hipPivot(npc, k) {
    const hip = npc.hip * npc.mesh.scale.y;
    _a.set(0, hip, 0).applyQuaternion(npc.mesh.quaternion);
    npc.mesh.position.set(npc.x - _a.x * k, npc.y + (hip + 0.15 - _a.y) * k, npc.z - _a.z * k);
  }

  return {
    update(dt, rider, w = null, spareRider = false) {
      if (!rider) return;
      const rz = rider.pos.z;

      if (w) {
        const nightFactor = Math.max(0, Math.min(1, (w.night - 0.2) / 0.5));
        const stormFactor = Math.max(0, Math.min(1, (w.snow - 0.4) / 0.5)) * 0.4;
        const glow = Math.max(nightFactor, stormFactor);
        cabinGlassMat.emissive.copy(cabinColdColor).lerp(cabinWarmColor, glow * 0.85);
        cabinGlassMat.color.setHex(glow > 0.1 ? 0xffe4b8 : 0x1a3450);
      }

      /* Towers on a fixed grid so they never swim: the window simply slides
         one slot at a time as the rider descends past them. Ahead is −z. */
      const baseZ = Math.floor(rz / PYLON_SPACING) * PYLON_SPACING;
      const backZ = baseZ + 3 * PYLON_SPACING;   // three slots behind…
      /* The cabins measure `at` from `backZ`, so the towers' world-fixed
         grid was not enough on its own: every slide of the window moved the
         datum by a whole slot and all six cabins teleported 200 m in one
         frame, in view, on the rope. Shifting `at` by the same slide keeps
         each cabin's world position continuous; the wrap hands cabins over
         only at the window's far ends, out past the fog. */
      if (lastBackZ === null) lastBackZ = backZ;
      if (backZ !== lastBackZ) {
        const slide = backZ - lastBackZ;
        for (let i = 0; i < NUM_GONDOLAS; i++) {
          let at = gondolas[i].at + slide;
          at %= SPAN;
          if (at < 0) at += SPAN;
          gondolas[i].at = at;
        }
        lastBackZ = backZ;
      }
      wheelSpin += 3.0 * dt;
      /* The towers, the trains and the ropes are a function of the window
         alone, so they are rebuilt when it slides rather than every frame —
         eleven ground lookups and a hundred and sixty rope matrices that were
         redone for nothing. Only the procedural sheaves turn in between. */
      const lineMoved = backZ !== lineBackZ;
      lineBackZ = backZ;
      for (let i = 0; i < NUM_PYLONS; i++) {
        if (lineMoved) {
          const pz = backZ - i * PYLON_SPACING;    // …to three slots ahead
          const px = cableXAt(pz);
          const py = heightAt(px, pz);
          _m.makeTranslation(px, py + TOWER_MID, pz);
          pylonMesh.setMatrixAt(i, _m);
          topX[i] = px;
          topY[i] = py + ROPE_TOP;
          topZ[i] = pz;
        }
        if (liftModelled) continue;
        // The two sheaves counter-rotate, which is what a bull wheel does
        // and the only moving part on a tower you can read from the piste.
        for (let s = 0; s < 2; s++) {
          const off = s === 0 ? -CABLE_SIDE : CABLE_SIDE;
          _e.set(0, 0, s === 0 ? wheelSpin : -wheelSpin);
          _q.setFromEuler(_e);
          _p.set(topX[i] + off, topY[i], topZ[i]);
          _m.compose(_p, _q, _one);
          wheelMesh.setMatrixAt(i * 2 + s, _m);
        }
      }
      /* The modelled trains lie along the rope. The rope over a tower runs
         from the span behind into the span ahead; its mean direction there
         is the chord between the two neighbouring towers, the sag of the two
         spans cancelling — so each train takes that heading and that slope,
         nineteen degrees down the hill on a typical tower, and the shallow
         vee its sheaves are set in takes up the bend between the two spans.
         The towers at either end have only one span, and take its tangent.
         A train on the −x rope is the same train turned end for end, which
         puts its frame on the inboard side there too and, the rope running
         the other way, turns its sheaves the other way for free. */
      if (liftModelled) {
        sheaveSpin.value = (sheaveSpin.value - SHEAVE_SPIN * dt) % (Math.PI * 2);
        for (let i = 0; lineMoved && i < NUM_PYLONS; i++) {
          const a = Math.max(0, i - 1);
          const b = Math.min(NUM_PYLONS - 1, i + 1);
          const dx = topX[b] - topX[a];
          const dz = topZ[b] - topZ[a];
          const sag = i === 0 ? -4 * SAG : i === NUM_PYLONS - 1 ? 4 * SAG : 0;
          const pitch = Math.atan((topY[b] - topY[a] + sag) / Math.hypot(dx, dz));
          const heading = Math.atan2(-dx, -dz);
          for (let s = 0; s < 2; s++) {
            const side = s === 0 ? -1 : 1;
            _eLine.set(side * pitch, heading + (side > 0 ? 0 : Math.PI), 0);
            _q.setFromEuler(_eLine);
            _p.set(topX[i] + side * CABLE_SIDE, topY[i], topZ[i]);
            _m.compose(_p, _q, _one);
            wheelMesh.setMatrixAt(i * 2 + s, _m);
          }
        }
      }
      if (lineMoved) pylonMesh.instanceMatrix.needsUpdate = true;
      if (lineMoved || !liftModelled) wheelMesh.instanceMatrix.needsUpdate = true;

      // The ropes, tower-top to tower-top, sagging as the cabins on them do.
      for (let i = 0; lineMoved && i < NUM_PYLONS - 1; i++) {
        for (let s = 0; s < 2; s++) {
          const off = s === 0 ? -CABLE_SIDE : CABLE_SIDE;
          for (let k = 0; k < ROPE_SEGMENTS; k++) {
            ropeAt(i, off, k / ROPE_SEGMENTS, _a);
            ropeAt(i, off, (k + 1) / ROPE_SEGMENTS, _b);
            cableDir.subVectors(_b, _a);
            const len = cableDir.length();
            _p.addVectors(_a, _b).multiplyScalar(0.5);
            _q.setFromUnitVectors(UP, cableDir.normalize());
            _s.set(1, len, 1);
            _m.compose(_p, _q, _s);
            cableMesh.setMatrixAt((i * 2 + s) * ROPE_SEGMENTS + k, _m);
          }
        }
      }
      if (lineMoved) cableMesh.instanceMatrix.needsUpdate = true;

      /* Cabins ride the rope between towers: position interpolated along
         the span they are on, dropped by a touch of parabolic sag, hung by
         the grip. `at` is metres behind the backmost tower. */
      for (let i = 0; i < NUM_GONDOLAS; i++) {
        const g = gondolas[i];
        g.at += g.dir * CABIN_SPEED * dt;
        if (g.at < 0) g.at += SPAN;
        if (g.at >= SPAN) g.at -= SPAN;
        const seg = Math.min(NUM_PYLONS - 2, Math.floor(g.at / PYLON_SPACING));
        ropeAt(seg, g.side, g.at / PYLON_SPACING - seg, _p);
        // Phased by where the cabin is, never by `at`: the slide above moves
        // `at` a whole slot, and every cabin's swing used to jump with it.
        const sway = Math.sin(_p.z * 0.06) * 0.05;
        if (liftModelled) {
          /* The modelled cabin has a door side, and it faces outboard: the
             cabins coming back on the −x rope have been round the bull wheel
             and are turned end for end. They swing from the grip, which is
             where a cabin's pivot is — the hanger's, on the rope. */
          _eLine.set(0, g.side > 0 ? 0 : Math.PI, sway);
          _q.setFromEuler(_eLine);
          _p.add(_a.set(0, -CABIN_HANG, 0).applyQuaternion(_q));
        } else {
          _e.set(0, 0, sway);
          _q.setFromEuler(_e);
          _p.y -= CABIN_HANG;
        }
        _m.compose(_p, _q, _one);
        cabinMesh.setMatrixAt(i, _m);
        glassMesh.setMatrixAt(i, _m);
      }
      cabinMesh.instanceMatrix.needsUpdate = true;
      glassMesh.instanceMatrix.needsUpdate = true;

      /* --- snow cannons streaming and snowmaking spray --- */
      for (let i = 0; i < NUM_CANNONS; i++) {
        const c = cannons[i];
        // If cannon is behind the rider (> 80m uphill), wrap it far downstream
        if (c.z > rz + 80) {
          placeCannon(c, c.z - NUM_CANNONS * CANNON_SPACING);
        } else if (c.z < rz - NUM_CANNONS * CANNON_SPACING) {
          placeCannon(c, c.z + NUM_CANNONS * CANNON_SPACING);
        }

        /* Active snowmaking spray plumes, out of the nozzle ring and along
           the barrel: the gun's own nozzle and aim, turned by the yaw it was
           placed with. These used to be offsets written in world terms,
           which were right for exactly one gun on exactly one side. Only
           guns in front of the rider spray: the ring is shared with the
           rider's own snow, and plumes behind the camera were spending a
           fifth of the guns' share of it. */
        if (spray && !c.hidden && c.z < rz + 20 && c.z > rz - 200
          && Math.random() < 24 * dt) {
          const cy = Math.cos(c.yaw);
          const sy = Math.sin(c.yaw);
          const ax = gunAim.x * cy + gunAim.z * sy;
          const az = gunAim.z * cy - gunAim.x * sy;
          const reach = Math.hypot(ax, az) || 1;
          const speed = 10 + Math.random() * 4;
          const fan = (Math.random() - 0.5) * 3;
          spray.burst({
            x: c.x + gunNozzle.x * cy + gunNozzle.z * sy,
            y: c.y + gunNozzle.y,
            z: c.z + gunNozzle.z * cy - gunNozzle.x * sy,
          }, (ax * speed - az * fan) / reach, (az * speed + ax * fan) / reach, 8, 3.5);
        }
      }
      // A cannon is bolted to the hill: its matrix only changes on the frame
      // it wraps, so the upload only happens on that frame too.
      if (cannonsDirty) {
        for (let i = 0; i < NUM_CANNONS; i++) {
          const c = cannons[i];
          _e.set(0, c.yaw, 0);
          _q.setFromEuler(_e);
          _p.set(c.x, c.y, c.z);
          // Scaled to a point, not zeroed: w stays 1 (see `instanced`)
          _m.compose(_p, _q, c.hidden ? _s.set(0, 0, 0) : _one);
          cannonMesh.setMatrixAt(i, _m);
        }
        cannonMesh.instanceMatrix.needsUpdate = true;
        cannonsDirty = false;
      }

      /* Every pool now holds a real matrix in every slot, so they can start
         drawing. Until this line they stand at `count = 0` — see `instanced`,
         and the zero-matrix note there for why that is not just tidiness. */
      if (!poolsLive) {
        for (let k = 0; k < pools.length; k++) {
          pools[k].count = pools[k].instanceMatrix.count;
        }
        poolsLive = true;
      }

      /* --- the other people, and running into them ---------------------- */
      for (let i = 0; i < NUM_NPCS; i++) {
        const npc = npcs[i];

        /* Fallen far behind (uphill of the rider): return well ahead — and
           out of sight. They used to come back 180 to 260 metres down the
           hill, which on a clear day is well inside the 560 metres the fog
           lets you see: a skier simply appeared on the piste in front of
           you. Now they return past wherever the curtain is this frame,
           plus a margin, so they ride out of the haze the way everything
           else on the mountain arrives. In a storm the curtain is close and
           they come back close, which keeps the piste peopled in exactly the
           weather where it most needs to be. */
        if (npc.z > rz + 60) {
          const fogFar = w && Number.isFinite(w.fogFar) ? w.fogFar : RENDER.fogFar;
          npc.z = rz - Math.max(180, fogFar + 30) - Math.random() * 80;
          npc.x = nearestCenter(rider.pos.x, npc.z)
            + (Math.random() - 0.5) * 30.0;
          npc.tumbled = false;
          npc.tumbleTimer = 0;
          npc.recover = 0;
          npc.branch = 0;
          npc.vz = -(11 + (i % 4) * 3);
          npc.mesh.rotation.set(0, 0, 0);
        }

        if (npc.tumbled) {
          npc.tumbleTimer -= dt;
          npc.vz *= Math.exp(-2.2 * dt);
          npc.vx *= Math.exp(-1.5 * dt);
          npc.z += npc.vz * dt;
          npc.x += npc.vx * dt;
          npc.y = heightAt(npc.x, npc.z);
          npc.mesh.rotation.x += 4.5 * dt;
          npc.mesh.rotation.y += 3.2 * dt;
          npc.mesh.rotation.z += 5.0 * dt;
          // (eased onto the hip over the first quarter second, from the boots)
          hipPivot(npc, Math.min(1, (TUMBLE - npc.tumbleTimer) * 4));
          // Folded over the skis rather than riding above them.
          npc.body.position.y = npc.hip - 0.05;
          npc.body.rotation.set(0.55, 0, 0.30);
          // …and the arms (and the poles) going everywhere.
          npc.flail += (1 - npc.flail) * (1 - Math.exp(-8 * dt));
          npc.flailClock = (npc.flailClock || 0) + dt;
          poseArms(npc, dt, 0, npc.body.position.y);
          if (npc.tumbleTimer <= 0) {
            npc.tumbled = false;
            npc.vz = -(11 + (i % 4) * 3);
            npc.vx = 0;
            /* Getting up is not a cut. This used to write the rotation
               straight back to zero, so a figure three and a half seconds
               into a cartwheel — fifteen radians round on one axis and ten
               on another — was standing on its skis in the next frame. The
               attitude it is in is kept instead, and the riding branch
               below swings it round to the riding pose over `RECOVER`. */
            npc.recoverFrom.copy(npc.mesh.quaternion);
            npc.bodyFrom.copy(npc.body.quaternion);
            npc.recover = RECOVER;
          }
          continue;
        }

        // Easy S-turns about the nearest branch line, so they stay on the
        // corduroy through forks instead of skiing the island. Nearest where
        // the run split, and held until it joins again: asked afresh every
        // frame, a turn wider than the split crossed the midline, and the
        // rider snapped round and shot across to the other branch.
        npc.sPhase += dt * TURN_RATE;
        const edge = Math.sin(npc.sPhase);
        const sTurn = edge * 12.0;
        centersAt(npc.z, npcCentres);
        if (npcCentres[1] - npcCentres[0] < 1e-6) npc.branch = 0;
        else if (!npc.branch) {
          npc.branch = Math.abs(npc.x - npcCentres[0]) < Math.abs(npc.x - npcCentres[1]) ? -1 : 1;
        }
        const targetX = (npc.branch > 0 ? npcCentres[1] : npcCentres[0]) + sTurn;
        npc.vx = (targetX - npc.x) * TURN_GAIN;

        // How far back onto their feet they are: 0 the frame the tumble
        // ends, 1 once they are riding. Speed returns with it rather than
        // in one frame, since nobody stands up already doing forty km/h —
        // across the hill as well, where steering back to a line the tumble
        // threw them metres off was a sideways dart the frame they rose.
        let up = 1;
        let rising = false;
        if (npc.recover > 0) {
          rising = npc.recover === RECOVER;
          npc.recover = Math.max(0, npc.recover - dt);
          const t = 1 - npc.recover / RECOVER;
          up = t * t * (3 - 2 * t);
        }

        npc.x += npc.vx * dt * (0.25 + 0.75 * up);
        npc.z += npc.vz * dt * (0.25 + 0.75 * up);
        npc.y = heightAt(npc.x, npc.z);
        npc.mesh.position.set(npc.x, npc.y, npc.z);

        // Direction of travel (yaw) where 0 = straight downhill (-Z)
        const yaw = Math.atan2(npc.vx, -npc.vz);

        /* Slope pitch along heading. Ahead is −z, so the point 0.9 m ahead
           sits at x + hRatio·0.9 — the old negated offsets sampled the
           heights mirrored across the fall line, feeding the lateral
           gradient into the pitch with the wrong sign exactly at the apex
           of the S-turns, where vx is largest. */
        const zAhead = npc.z - 0.9;
        const zBehind = npc.z + 0.9;
        const hRatio = npc.vx / Math.max(1, Math.abs(npc.vz));
        const yAhead = heightAt(npc.x + hRatio * 0.9, zAhead);
        const yBehind = heightAt(npc.x - hRatio * 0.9, zBehind);
        const pitch = Math.atan2(yAhead - yBehind, 1.8);

        /* Bank angle: the lean into the carve, which is the turn's sideways
           acceleration. It used to be the sideways *speed*, which put the
           most lean where the path crosses its line — the straight bit
           between two turns, where a rider is changing edges and stands up —
           and none at the fall line, where the turn is tightest. The poles
           (`poseArms`) keep time with the edge changes, so the lean has to
           change at them too. Clamped and eased, because a figure handed
           back from beyond the fog arrives with a sideways speed to lose. */
        const ax = (npc.vx - npc.vxLast) / Math.max(dt, 1e-3);
        npc.vxLast = npc.vx;
        npc.ax += (Math.max(-30, Math.min(30, ax)) - npc.ax) * (1 - Math.exp(-6 * dt));
        const bank = Math.max(-0.35, Math.min(0.35, -npc.ax * 0.016));

        npc.mesh.rotation.set(pitch, -yaw, bank);

        /* And the half of the figure that argues with all of that. Real
           riders absorb at the apex of a turn, hold their shoulders down
           the fall line while the skis cross it, and angulate — the edge
           goes over, the chest does not. One matrix, and the difference
           between a rider and a decal. */
        const load = Math.abs(edge);
        const b = npc.body;
        b.position.y = npc.hip - 0.055 * load - 0.05 * (1 - up);
        b.rotation.set(0.055 * Math.cos(npc.sPhase * 2.0),
          yaw * npc.counter, -bank * 0.55);
        // The arms: poles in time with the turns, or a boarder's balance.
        npc.flail *= Math.exp(-3 * dt);
        npc.flailClock = (npc.flailClock || 0) + dt;
        poseArms(npc, dt, Math.max(-1, Math.min(1, npc.ax / 15)), b.position.y);

        /* …and while they are still getting up, both halves of the figure
           are swung from the attitude the tumble left them in towards the
           pose just written. On the first frame that attitude becomes a
           turn away from the riding pose, and it is the turn that unwinds,
           on top of whatever the riding pose does meanwhile. Slerping
           straight from the attitude to the live pose took the short way
           round, which is at most half a turn, but the pose keeps moving
           as they steer back to the line, and when it crossed the point
           half a turn from where they fell, the short way changed sides
           and the figure snapped round by up to three radians in a frame.
           A fixed turn has one short way for the whole recovery. */
        if (up < 1) {
          if (rising) {
            npc.recoverFrom.multiply(_qTurn.copy(npc.mesh.quaternion).invert());
            npc.bodyFrom.multiply(_qTurn.copy(b.quaternion).invert());
          }
          npc.mesh.quaternion.premultiply(_qTurn.copy(npc.recoverFrom).slerp(_qStill, up));
          b.quaternion.premultiply(_qTurn.copy(npc.bodyFrom).slerp(_qStill, up));
          // …and handed from the hip the tumble turned about back to the feet
          hipPivot(npc, 1 - up);
        }

        // A little carve spray off their turns, where it can be seen: the
        // ring it comes out of is the rider's own as well, and three in four
        // of these puffs used to be thrown more than 150 m off, or behind.
        if (spray && npc.z < rz + 20 && npc.z > rz - 150 && Math.random() < 15 * dt) {
          spray.burst(npc.mesh.position, -npc.vx * 0.2, -npc.vz * 0.2, 3, 0.5);
        }

        const dx = rider.pos.x - npc.x;
        const dy = rider.pos.y - npc.y;
        const dz = rider.pos.z - npc.z;
        if (dx * dx + dz * dz < 2.5 && Math.abs(dy) < 2.2) {
          // Both go down — bar the attract loop's demo rider, whom the props
          // spare as well.
          if (!spareRider && rider.state !== 'fall' && rider.grace <= 0) {
            rider.fall('npc', 15.0);
          }
          npc.tumbled = true;
          npc.tumbleTimer = TUMBLE;
          npc.vx = (Math.random() - 0.5) * 14.0;
          npc.vz *= 0.2;
          if (spray) {
            spray.burst({
              x: (rider.pos.x + npc.x) * 0.5,
              y: (rider.pos.y + npc.y) * 0.5 + 0.3,
              z: (rider.pos.z + npc.z) * 0.5,
            }, (Math.random() - 0.5) * 8.0, (Math.random() - 0.5) * 8.0, 24, 1.4);
          }
        }
      }
    },
    /* Swap every figure for its modelled self. The meshes, their material
       and their shadows stay; the hip the body hangs from moves to the one
       the file says, and the bones move to the joints it was modelled on and
       are bound there again. */
    adopt(nodes) {
      const built = npcs.map((npc) => modelledFigure(nodes, npc.kind, npc.dress));
      npcs.forEach((npc, i) => {
        const { deck, body, hip, arms } = built[i];
        npc.deck.geometry.dispose();
        npc.deck.geometry = deck;
        npc.body.geometry.dispose();
        npc.body.geometry = body;
        npc.body.position.y += hip - npc.hip;
        npc.hip = hip;
        npc.arms = rigBody(npc.body, arms, hip);
      });
    },
    /* The lift and the guns as modelled: `liftReady` settles true once
       `lift.glb` is drawn, false if the procedural line stays. `adoptLift`
       takes parsed nodes directly, which is how the checks feed it. */
    liftReady,
    adoptLift,
    reset(riderZ = 0) {
      // A checkpoint restart teleports the datum; take the fresh one rather
      // than treating the jump as a slide to compensate.
      lastBackZ = null;
      lineBackZ = null;
      for (let i = 0; i < NUM_CANNONS; i++) {
        const c = cannons[i];
        placeCannon(c, riderZ + 40 - i * CANNON_SPACING);
      }
      for (let i = 0; i < NUM_NPCS; i++) {
        const npc = npcs[i];
        npc.z = riderZ - 80 - i * 40 - Math.random() * 30;
        npc.x = nearestCenter(0, npc.z) + (Math.random() - 0.5) * 30.0;
        npc.y = heightAt(npc.x, npc.z);
        npc.mesh.position.set(npc.x, npc.y, npc.z);
        npc.tumbled = false;
        npc.tumbleTimer = 0;
        npc.recover = 0;
        npc.branch = 0;
        npc.vx = 0;
        npc.vz = -(11 + (i % 4) * 3);
        npc.mesh.rotation.set(0, 0, 0);
        npc.body.position.y = npc.hip;
        npc.body.rotation.set(0, 0, 0);
        npc.ax = 0;
        npc.vxLast = 0;
        npc.flail = 0;
      }
    },
  };
}
