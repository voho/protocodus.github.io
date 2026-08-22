/* Mountain life — the cable car over the rocky band, and other people.

   The gondola line is the one piece of infrastructure that says "resort"
   from any distance, and it flies exactly where the terrain's zone model
   says the talus is: past the groomed corridor and the powder field, over
   the boulders no groomer visits. Pylons stand on a fixed 200-metre grid
   down the run, the cables are drawn tower-top to tower-top, and the
   cabins hang from the cable with a touch of mid-span sag — not from the
   terrain, which is what makes a cable car read as suspended rather than
   floated.

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
   it costs one matrix per figure per frame. */

import {
  heightAt, nearestCenter, centersAt, rockBandAt,
} from './terrain.js';
import { compose } from './geom.js';

const PYLON_SPACING = 200;
/* Seven, so the span's ends stand ±600 m from the rider — past the 560 m
   clear-day fog distance. A cabin recycles by jumping one full span from
   one end to the other, and with five pylons the ends sat ±400 m out,
   inside the curtain's visibility: the jump was watchable in clear
   weather. Two more towers are two instances on meshes that already
   exist, and they buy the handover happening behind the haze. */
const NUM_PYLONS = 7;
const SPAN = PYLON_SPACING * (NUM_PYLONS - 1);
const CABLE_SIDE = 1.8;   // the two ropes, either side of the arm's wheels
const SAG = 2.4;          // metres of droop at mid-span
const CABIN_SPEED = 11;   // m/s along the line

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

  const texLoader = new THREE.TextureLoader();
  const fabricTex = texLoader.load(
    new URL('../assets/textures/rider/rider-fabric.jpg', import.meta.url).href,
    (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; },
  );
  fabricTex.colorSpace = THREE.SRGBColorSpace;
  const metalTex = texLoader.load(
    new URL('../assets/textures/rock/rock-slate.jpg', import.meta.url).href,
    (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; },
  );
  metalTex.colorSpace = THREE.SRGBColorSpace;

  /* --- the line: towers, ropes, cabins ---------------------------------- */

  /* Hardware shares one material per pass, with the paint in the vertex
     colours: a red cabin and its grey grip are one geometry and one draw.
     They also go through `shading.apply` now, which they did not before —
     an unfogged pylon at four hundred metres was the one object in the
     scene that stayed at full contrast while the mountain behind it went
     white, and it read as a bug because it was one. */
  const hardwareMat = shading.apply(
    new THREE.MeshLambertMaterial({ vertexColors: true, map: metalTex }),
    { sheen: 0.10 },
  );

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
    { geo: new THREE.BoxGeometry(2.4, 2.2, 1.8), color: 0xb31f1f, pos: [0, -1.1, 0] },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), color: 0x333842, pos: [0, 0.5, 0] },
    { geo: new THREE.BoxGeometry(0.6, 0.3, 0.4), color: 0x333842, pos: [0, 1.6, 0] },
  ], { uv: true });

  const glassGeo = new THREE.BoxGeometry(2.45, 0.9, 1.85);
  glassGeo.translate(0, -0.9, 0);
  const cabinGlassMat = shading.apply(new THREE.MeshLambertMaterial({
    color: 0x1a3450,
    emissive: 0x000000,
    transparent: true,
    opacity: 0.85,
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
    { geo: new THREE.CylinderGeometry(0.35, 0.7, 22.0, 8), color: 0x5a6270, pos: [0, 0, 0] },
    { geo: new THREE.BoxGeometry(7.0, 0.6, 0.6), color: 0x5a6270, pos: [0, 10.5, 0] },
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

  const cableMat = shading.apply(
    new THREE.MeshBasicMaterial({ color: 0x22262c }), { sheen: 0 },
  );
  const cableGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
  const NUM_CABLES = (NUM_PYLONS - 1) * 2;
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
      geo: new THREE.CylinderGeometry(0.38, 0.32, 1.3, 12),
      color: 0xdfa008,
      pos: [0, 4.4, 0.8],
      rot: [Math.PI / 2 - 0.32, 0, 0],
    },
    {
      geo: new THREE.TorusGeometry(0.34, 0.045, 6, 12),
      color: 0x1f5ab8,
      pos: [0, 4.6, 1.4],
      rot: [Math.PI / 2 - 0.32, 0, 0],
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
    cannonsDirty = true;
  }

  for (let i = 0; i < NUM_CANNONS; i++) {
    const c = {
      side: i % 2 === 0 ? 1 : -1, z: 0, x: 0, y: 0, yaw: 0,
    };
    placeCannon(c, 40 - i * CANNON_SPACING);
    cannons.push(c);
  }

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
     about to fall over. */

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

  // Reusable component geometries
  const GEO = {
    // Torso & Body
    torso: new THREE.CylinderGeometry(0.20, 0.25, 0.58, 10),
    yoke: new THREE.CylinderGeometry(0.207, 0.221, 0.20, 10),
    collar: new THREE.CylinderGeometry(0.14, 0.16, 0.10, 10),
    neck: new THREE.CylinderGeometry(0.062, 0.070, 0.11, 8),
    zipper: new THREE.BoxGeometry(0.025, 0.54, 0.04),
    hip: new THREE.CylinderGeometry(0.21, 0.19, 0.18, 10),
    thigh: new THREE.CylinderGeometry(0.095, 0.082, 0.40, 8),
    shin: new THREE.CylinderGeometry(0.080, 0.070, 0.38, 8),
    boot: new THREE.BoxGeometry(0.13, 0.15, 0.26),
    bootCuff: new THREE.CylinderGeometry(0.076, 0.076, 0.12, 8),
    upperArm: new THREE.CylinderGeometry(0.065, 0.055, 0.32, 7),
    foreArm: new THREE.CylinderGeometry(0.055, 0.048, 0.30, 7),
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
    packBody: new THREE.BoxGeometry(0.235, 0.30, 0.13),
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

  const put = (list, geo, kit, pos, rot, scale) => {
    list.push({
      geo, color: kit.color, sheen: kit.sheen, pos, rot, scale,
    });
  };

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
    for (const side of [-1, 1]) {
      const ax = side * 0.26;
      // Upper arm angled forward and slightly out
      put(body, GEO.upperArm, jacket, [ax, 1.18, -0.14], [-0.35, 0, side * 0.32]);
      // Forearm reaching forward to grip pole
      put(body, GEO.foreArm, jacket, [ax * 1.05, 0.98, -0.28], [-0.55, 0, side * 0.18]);
      // Cuff where the sleeve ends
      put(body, GEO.sleeveCuff, accent, [side * 0.265, 0.865, -0.325], [-0.55, 0, side * 0.18]);
      // Mitten holding the pole grip
      put(body, GEO.mitten, HARD, [side * 0.26, 0.90, -0.34]);

      // Ski Pole held in hand, shaft angling down and back (+Z)
      const px = side * 0.26;
      const py = 0.90;
      const pz = -0.34;
      put(body, GEO.poleGrip, DETAIL, [px, py, pz], [0.38, 0, side * 0.12]);
      put(body, GEO.poleShaft, PALE, [px + side * 0.05, py - 0.44, pz + 0.32],
        [0.38, 0, side * 0.12]);
      put(body, GEO.poleBasket, DETAIL, [px + side * 0.10, 0.10, pz + 0.68],
        [0.38, 0, side * 0.12]);
    }

    if (v.pack) {
      put(body, GEO.packBody, accent, [0, 1.14, 0.20], [-0.22, 0, 0]);
      for (const side of [-1, 1]) {
        put(body, GEO.packStrap, DETAIL, [side * 0.13, 1.13, -0.16], [-0.22, 0, 0]);
      }
    }

    return { deck, body, hip: 0.80 };
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
    // Lead arm reaching forward/downward (-Z)
    put(body, GEO.upperArm, jacket, [0.18, 1.12, -0.15], [-0.45, stanceAngle, 0.35]);
    put(body, GEO.foreArm, jacket, [0.26, 0.94, -0.28], [-0.65, stanceAngle, 0.20]);
    put(body, GEO.sleeveCuff, accent, [0.285, 0.865, -0.335], [-0.65, stanceAngle, 0.20]);
    put(body, GEO.mitten, HARD, [0.30, 0.85, -0.38]);

    // Trailing arm raised out/back for balance (+Z)
    put(body, GEO.upperArm, jacket, [-0.18, 1.14, 0.12], [0.35, stanceAngle, -0.45]);
    put(body, GEO.foreArm, jacket, [-0.28, 1.02, 0.25], [0.55, stanceAngle, -0.30]);
    put(body, GEO.sleeveCuff, accent, [-0.325, 0.965, 0.325], [0.55, stanceAngle, -0.30]);
    put(body, GEO.mitten, HARD, [-0.35, 0.98, 0.36]);

    if (v.pack) {
      put(body, GEO.packBody, accent,
        [-0.10 * Math.sin(stanceAngle), 1.09, 0.16 * Math.cos(stanceAngle)],
        [-0.16, stanceAngle, 0]);
    }

    return { deck, body, hip: 0.76 };
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
    const bodyMesh = new THREE.Mesh(
      compose(THREE, lifted, { uv: true, sheen: true }), figureMat,
    );
    bodyMesh.position.y = spec.hip;
    bodyMesh.rotation.order = 'YXZ';

    for (const m of [deckMesh, bodyMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    return { group, body: bodyMesh, hip: spec.hip };
  }

  /* Eight riders where there used to be five. The count went up because the
     cost per rider went down by an order of magnitude, and a resort with
     five people on it reads as an empty one. */
  const NUM_NPCS = 8;
  const npcs = [];
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
    root.add(fig.group);
    npcs.push({
      mesh: fig.group,
      body: fig.body,
      hip: fig.hip,
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
      sPhase: Math.random() * Math.PI * 2,
    });
  }

  return {
    update(dt, rider, w = null) {
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
      for (let i = 0; i < NUM_PYLONS; i++) {
        const pz = backZ - i * PYLON_SPACING;    // …to three slots ahead
        const px = cableXAt(pz);
        const py = heightAt(px, pz);
        _m.makeTranslation(px, py + 11.0, pz);
        pylonMesh.setMatrixAt(i, _m);
        topX[i] = px;
        topY[i] = py + 21.5;
        topZ[i] = pz;
        // The two sheaves counter-rotate, which is what a bull wheel does
        // and the only moving part on a tower you can read from the piste.
        for (let s = 0; s < 2; s++) {
          const off = s === 0 ? -CABLE_SIDE : CABLE_SIDE;
          _e.set(0, 0, s === 0 ? wheelSpin : -wheelSpin);
          _q.setFromEuler(_e);
          _p.set(px + off, py + 21.5, pz);
          _m.compose(_p, _q, _one);
          wheelMesh.setMatrixAt(i * 2 + s, _m);
        }
      }
      pylonMesh.instanceMatrix.needsUpdate = true;
      wheelMesh.instanceMatrix.needsUpdate = true;

      // The ropes, tower-top to tower-top.
      for (let i = 0; i < NUM_PYLONS - 1; i++) {
        for (let s = 0; s < 2; s++) {
          const off = s === 0 ? -CABLE_SIDE : CABLE_SIDE;
          const x0 = topX[i] + off;
          const x1 = topX[i + 1] + off;
          cableDir.set(x1 - x0, topY[i + 1] - topY[i], topZ[i + 1] - topZ[i]);
          const len = cableDir.length();
          _p.set((x0 + x1) / 2, (topY[i] + topY[i + 1]) / 2,
            (topZ[i] + topZ[i + 1]) / 2);
          _q.setFromUnitVectors(UP, cableDir.normalize());
          _s.set(1, len, 1);
          _m.compose(_p, _q, _s);
          cableMesh.setMatrixAt(i * 2 + s, _m);
        }
      }
      cableMesh.instanceMatrix.needsUpdate = true;

      /* Cabins ride the rope between towers: position interpolated along
         the span they are on, dropped by a touch of parabolic sag, hung by
         the grip. `at` is metres behind the backmost tower. */
      for (let i = 0; i < NUM_GONDOLAS; i++) {
        const g = gondolas[i];
        g.at += g.dir * CABIN_SPEED * dt;
        if (g.at < 0) g.at += SPAN;
        if (g.at >= SPAN) g.at -= SPAN;
        const seg = Math.min(NUM_PYLONS - 2, Math.floor(g.at / PYLON_SPACING));
        const t = g.at / PYLON_SPACING - seg;
        const cx = topX[seg] + (topX[seg + 1] - topX[seg]) * t + g.side;
        const cz = topZ[seg] + (topZ[seg + 1] - topZ[seg]) * t;
        const cy = topY[seg] + (topY[seg + 1] - topY[seg]) * t
          - SAG * 4 * t * (1 - t);
        _e.set(0, 0, Math.sin(cz * 0.08 + g.at * 0.02) * 0.05);
        _q.setFromEuler(_e);
        _p.set(cx, cy - 1.7, cz);
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

        // Active snowmaking spray plumes
        if (spray && Math.abs(c.z - rz) < 240 && Math.random() < 24 * dt) {
          const nozzleX = c.x + (c.side > 0 ? -1.2 : 1.2);
          const nozzleY = c.y + 4.5;
          const nozzleZ = c.z - 0.8;
          const sprayVx = c.side > 0 ? -(8.0 + Math.random() * 4.0) : (8.0 + Math.random() * 4.0);
          const sprayVz = -(4.0 + Math.random() * 3.0);
          spray.burst({ x: nozzleX, y: nozzleY, z: nozzleZ }, sprayVx, sprayVz, 8, 3.5);
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
          _m.compose(_p, _q, _one);
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

        // Fallen far behind (uphill of the rider): return well ahead.
        if (npc.z > rz + 60) {
          npc.z = rz - 180 - Math.random() * 80;
          npc.x = nearestCenter(rider.pos.x, npc.z)
            + (Math.random() - 0.5) * 30.0;
          npc.tumbled = false;
          npc.tumbleTimer = 0;
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
          npc.mesh.position.set(npc.x, npc.y + 0.25, npc.z);
          npc.mesh.rotation.x += 4.5 * dt;
          npc.mesh.rotation.y += 3.2 * dt;
          npc.mesh.rotation.z += 5.0 * dt;
          // Folded over the skis rather than riding above them.
          npc.body.position.y = npc.hip - 0.05;
          npc.body.rotation.set(0.55, 0, 0.30);
          if (npc.tumbleTimer <= 0) {
            npc.tumbled = false;
            npc.vz = -(11 + (i % 4) * 3);
            npc.vx = 0;
            npc.mesh.rotation.set(0, 0, 0);
          }
          continue;
        }

        // Easy S-turns about the nearest branch line, so they stay on the
        // corduroy through forks instead of skiing the island.
        npc.sPhase += dt * 1.35;
        const edge = Math.sin(npc.sPhase);
        const sTurn = edge * 12.0;
        const targetX = nearestCenter(npc.x, npc.z) + sTurn;
        npc.vx = (targetX - npc.x) * 2.2;

        npc.x += npc.vx * dt;
        npc.z += npc.vz * dt;
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

        // Bank angle (lean into the carve)
        const bank = Math.max(-0.35, Math.min(0.35, -npc.vx * 0.045));

        npc.mesh.rotation.set(pitch, yaw, bank);

        /* And the half of the figure that argues with all of that. Real
           riders absorb at the apex of a turn, hold their shoulders down
           the fall line while the skis cross it, and angulate — the edge
           goes over, the chest does not. One matrix, and the difference
           between a rider and a decal. */
        const load = Math.abs(edge);
        const b = npc.body;
        b.position.y = npc.hip - 0.055 * load;
        b.rotation.set(0.055 * Math.cos(npc.sPhase * 2.0),
          -yaw * npc.counter, -bank * 0.55);

        // A little carve spray off their turns
        if (spray && Math.random() < 15 * dt) {
          spray.burst(npc.mesh.position, -npc.vx * 0.2, -npc.vz * 0.2, 3, 0.5);
        }

        const dx = rider.pos.x - npc.x;
        const dy = rider.pos.y - npc.y;
        const dz = rider.pos.z - npc.z;
        if (dx * dx + dz * dz < 2.5 && Math.abs(dy) < 2.2) {
          // Both go down.
          if (rider.state !== 'fall' && rider.grace <= 0) {
            rider.fall('npc', 15.0);
          }
          npc.tumbled = true;
          npc.tumbleTimer = 3.5;
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
    reset(riderZ = 0) {
      // A checkpoint restart teleports the datum; take the fresh one rather
      // than treating the jump as a slide to compensate.
      lastBackZ = null;
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
        npc.vx = 0;
        npc.vz = -(11 + (i % 4) * 3);
        npc.mesh.rotation.set(0, 0, 0);
        npc.body.position.y = npc.hip;
        npc.body.rotation.set(0, 0, 0);
      }
    },
  };
}
