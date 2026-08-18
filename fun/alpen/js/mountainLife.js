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
   through a tumble staged here. */

import {
  heightAt, nearestCenter, centersAt, rockBandAt,
} from './terrain.js';

const PYLON_SPACING = 200;
const NUM_PYLONS = 5;
const SPAN = PYLON_SPACING * (NUM_PYLONS - 1);
const CABLE_SIDE = 1.8;   // the two ropes, either side of the arm's wheels
const SAG = 2.4;          // metres of droop at mid-span
const CABIN_SPEED = 11;   // m/s along the line

export function createMountainLife(THREE, scene, shading, spray, audio) {
  const root = new THREE.Group();
  scene.add(root);

  /* --- the line: towers, ropes, cabins ---------------------------------- */

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

  const cabinBodyMat = new THREE.MeshLambertMaterial({ color: 0xb31f1f, map: metalTex });
  const cabinGlassMat = new THREE.MeshLambertMaterial({
    color: 0x1a3450, transparent: true, opacity: 0.85,
  });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x333842, map: metalTex });

  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 1.8), cabinBodyMat);
  bodyMesh.position.y = -1.1;
  const glassMesh = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.9, 1.85), cabinGlassMat);
  glassMesh.position.y = -0.9;
  const hangerMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), metalMat);
  hangerMesh.position.y = 0.5;
  const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.4), metalMat);
  gripMesh.position.y = 1.6;

  const gondolaProto = new THREE.Group();
  gondolaProto.add(bodyMesh, glassMesh, hangerMesh, gripMesh);
  gondolaProto.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  const NUM_GONDOLAS = 6;
  const gondolas = [];
  for (let i = 0; i < NUM_GONDOLAS; i++) {
    const mesh = gondolaProto.clone();
    root.add(mesh);
    gondolas.push({
      mesh,
      // Spread along the span; alternate cabins ride the two ropes, which
      // is the two directions of travel.
      at: (i / NUM_GONDOLAS) * SPAN,
      dir: i % 2 === 0 ? -1 : 1,
      side: i % 2 === 0 ? -CABLE_SIDE : CABLE_SIDE,
    });
  }

  const pylonMat = new THREE.MeshLambertMaterial({ color: 0x5a6270, map: metalTex });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x22262c, map: metalTex });
  const pylonGeo = new THREE.CylinderGeometry(0.35, 0.7, 22.0, 8);
  const armGeo = new THREE.BoxGeometry(7.0, 0.6, 0.6);
  const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.2, 12);
  wheelGeo.rotateX(Math.PI / 2);

  const pylons = [];
  for (let i = 0; i < NUM_PYLONS; i++) {
    const tower = new THREE.Mesh(pylonGeo, pylonMat);
    const arm = new THREE.Mesh(armGeo, pylonMat);
    arm.position.y = 10.5;
    const wheelL = new THREE.Mesh(wheelGeo, wheelMat);
    wheelL.position.set(-CABLE_SIDE, 10.5, 0);
    const wheelR = new THREE.Mesh(wheelGeo, wheelMat);
    wheelR.position.set(CABLE_SIDE, 10.5, 0);
    tower.add(arm, wheelL, wheelR);
    tower.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    root.add(tower);
    pylons.push({ tower, wheelL, wheelR });
  }
  // Tower-top line points, refreshed every frame; x/y/z per pylon.
  const topX = new Float64Array(NUM_PYLONS);
  const topY = new Float64Array(NUM_PYLONS);
  const topZ = new Float64Array(NUM_PYLONS);

  const cableMat = new THREE.MeshBasicMaterial({ color: 0x22262c });
  const cableGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
  const cables = [];
  for (let i = 0; i < (NUM_PYLONS - 1) * 2; i++) {
    const mesh = new THREE.Mesh(cableGeo, cableMat);
    root.add(mesh);
    cables.push(mesh);
  }
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
  const cannonBarrelMat = new THREE.MeshLambertMaterial({ color: 0xdfa008, map: metalTex });
  const cannonRingMat = new THREE.MeshLambertMaterial({ color: 0x1f5ab8, map: metalTex });
  const cannonTowerMat = new THREE.MeshLambertMaterial({ color: 0x6e7682, map: metalTex });

  const cannonProto = new THREE.Group();
  const cTower = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.4, 8), cannonTowerMat);
  cTower.position.y = 2.2;
  const cArm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.85), cannonTowerMat);
  cArm.position.set(0, 4.2, 0.35);
  cArm.rotation.x = -0.28;
  const cBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 1.3, 12), cannonBarrelMat);
  cBarrel.position.set(0, 4.4, 0.8);
  cBarrel.rotation.x = Math.PI / 2 - 0.32;
  const cNozzle = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 6, 12), cannonRingMat);
  cNozzle.position.set(0, 4.6, 1.4);
  cNozzle.rotation.x = Math.PI / 2 - 0.32;
  cannonProto.add(cTower, cArm, cBarrel, cNozzle);
  cannonProto.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  const NUM_CANNONS = 12;
  const CANNON_SPACING = 120;
  const cannons = [];

  function placeCannon(c, cz) {
    c.z = cz;
    rockBandAt(cz, band);
    centersAt(cz, lineCentres);
    const center = c.side > 0 ? lineCentres[1] : lineCentres[0];
    c.x = center + c.side * (band.half + 3.2);
    c.y = heightAt(c.x, cz);
    c.mesh.position.set(c.x, c.y, cz);
    c.mesh.rotation.y = c.side > 0 ? -Math.PI * 0.65 : Math.PI * 0.65;
  }

  for (let i = 0; i < NUM_CANNONS; i++) {
    const mesh = cannonProto.clone();
    root.add(mesh);
    const c = { mesh, side: i % 2 === 0 ? 1 : -1, z: 0, x: 0, y: 0 };
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

     All models face forward along -Z (downhill) and orient in real-time
     with Euler order 'YXZ' to match the terrain pitch, travel yaw, and carve bank. */

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

  const gear = (hex, sheen = 0.25) => shading.apply(
    new THREE.MeshLambertMaterial({ color: hex, flatShading: false, map: fabricTex }),
    { sheen },
  );

  const npcEquipmentMat = gear(0x181c24, 0.4); // dark hardware, bindings, boots
  const npcDarkDetailMat = gear(0x101318, 0.2);
  const npcWhiteMat = gear(0xeef2f7, 0.5);
  const npcSkinMat = gear(0xc98f6a, 0.15);

  // Reusable component geometries
  const GEO = {
    // Torso & Body
    torso: new THREE.CylinderGeometry(0.20, 0.25, 0.58, 10),
    collar: new THREE.CylinderGeometry(0.14, 0.16, 0.10, 10),
    zipper: new THREE.BoxGeometry(0.025, 0.54, 0.04),
    hip: new THREE.CylinderGeometry(0.21, 0.19, 0.18, 10),
    thigh: new THREE.CylinderGeometry(0.095, 0.082, 0.40, 8),
    shin: new THREE.CylinderGeometry(0.080, 0.070, 0.38, 8),
    boot: new THREE.BoxGeometry(0.13, 0.15, 0.26),
    bootCuff: new THREE.CylinderGeometry(0.076, 0.076, 0.12, 8),
    upperArm: new THREE.CylinderGeometry(0.065, 0.055, 0.32, 7),
    foreArm: new THREE.CylinderGeometry(0.055, 0.048, 0.30, 7),
    mitten: new THREE.SphereGeometry(0.058, 8, 6),
    head: new THREE.SphereGeometry(0.105, 9, 7),
    helmet: new THREE.SphereGeometry(0.132, 10, 8),
    helmetBrim: new THREE.BoxGeometry(0.15, 0.025, 0.08),
    goggleFrame: new THREE.BoxGeometry(0.21, 0.078, 0.08),
    goggleLens: new THREE.BoxGeometry(0.19, 0.065, 0.02),
    goggleStrap: new THREE.CylinderGeometry(0.135, 0.135, 0.04, 10, 1, true),

    // Skis & Poles
    skiBody: new THREE.BoxGeometry(0.11, 0.03, 1.50),
    skiTip: new THREE.BoxGeometry(0.11, 0.028, 0.22),
    skiTail: new THREE.BoxGeometry(0.11, 0.028, 0.14),
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
    bindingBase: new THREE.BoxGeometry(0.18, 0.025, 0.28),
    bindingHighback: new THREE.BoxGeometry(0.15, 0.18, 0.025),
    bindingStrapAnkle: new THREE.BoxGeometry(0.16, 0.045, 0.14),
    bindingStrapToe: new THREE.BoxGeometry(0.15, 0.035, 0.09),
  };

  const put = (group, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

  function createSkierMesh(jacketColor, trouserColor, helmetColor, goggleColor) {
    const group = new THREE.Group();
    const jacketMat = gear(jacketColor, 0.3);
    const trouserMat = gear(trouserColor, 0.2);
    const helmetMat = gear(helmetColor, 0.5);
    const goggleLensMat = gear(goggleColor, 0.9);

    // --- Skis & Bindings ---
    for (const side of [-1, 1]) {
      const sx = side * 0.16;
      // Main ski runner
      put(group, GEO.skiBody, npcEquipmentMat, sx, 0.015, 0);
      // Upturned ski tip (pointing downhill -Z)
      put(group, GEO.skiTip, npcEquipmentMat, sx, 0.052, -0.82, 0.38);
      // Slight ski tail kick (+Z)
      put(group, GEO.skiTail, npcEquipmentMat, sx, 0.030, 0.79, -0.22);
      // Bindings
      put(group, GEO.skiBindingPlate, npcDarkDetailMat, sx, 0.035, 0);
      put(group, GEO.skiBindingToe, npcEquipmentMat, sx, 0.065, -0.14);
      put(group, GEO.skiBindingHeel, npcEquipmentMat, sx, 0.075, 0.14);

      // Boots (pointing forward -Z)
      put(group, GEO.boot, npcEquipmentMat, sx, 0.09, 0);
      put(group, GEO.bootCuff, npcDarkDetailMat, sx, 0.17, -0.02, -0.24);

      // Shins & Thighs (flexed knees driving forward)
      put(group, GEO.shin, trouserMat, sx, 0.34, -0.06, -0.32);
      put(group, GEO.thigh, trouserMat, sx, 0.62, -0.04, 0.32);
    }

    // --- Pelvis & Torso ---
    put(group, GEO.hip, trouserMat, 0, 0.80, 0.02, -0.10);
    // Torso hinged forward towards -Z (down the fall line)
    put(group, GEO.torso, jacketMat, 0, 1.10, -0.06, -0.22);
    // Center zipper line down front (-Z)
    put(group, GEO.zipper, npcDarkDetailMat, 0, 1.10, -0.18, -0.22);
    // Jacket collar
    put(group, GEO.collar, jacketMat, 0, 1.34, -0.10, -0.22);

    // --- Head, Helmet & Goggles (facing downhill -Z) ---
    put(group, GEO.head, npcSkinMat, 0, 1.46, -0.10);
    const helmet = put(group, GEO.helmet, helmetMat, 0, 1.485, -0.10);
    helmet.scale.set(1, 0.88, 1.05);
    // Helmet brim over goggles
    put(group, GEO.helmetBrim, helmetMat, 0, 1.54, -0.18, -0.12);
    // Goggles mounted on front face (-Z)
    put(group, GEO.goggleFrame, npcDarkDetailMat, 0, 1.47, -0.20);
    put(group, GEO.goggleLens, goggleLensMat, 0, 1.47, -0.22);
    // Goggle strap around back (+Z)
    const strap = put(group, GEO.goggleStrap, npcDarkDetailMat, 0, 1.48, -0.10);
    strap.scale.set(1, 1, 1.04);

    // --- Arms, Mittens & Poles ---
    for (const side of [-1, 1]) {
      const ax = side * 0.26;
      // Upper arm angled forward and slightly out
      put(group, GEO.upperArm, jacketMat, ax, 1.18, -0.14, -0.35, 0, side * 0.32);
      // Forearm reaching forward to grip pole
      put(group, GEO.foreArm, jacketMat, ax * 1.05, 0.98, -0.28, -0.55, 0, side * 0.18);
      // Mitten holding the pole grip
      put(group, GEO.mitten, npcEquipmentMat, side * 0.26, 0.90, -0.34);

      // Ski Pole held in hand, shaft angling down and back (+Z)
      const px = side * 0.26;
      const py = 0.90;
      const pz = -0.34;
      put(group, GEO.poleGrip, npcDarkDetailMat, px, py, pz, 0.38, 0, side * 0.12);
      put(group, GEO.poleShaft, npcWhiteMat, px + side * 0.05, py - 0.44, pz + 0.32, 0.38, 0, side * 0.12);
      put(group, GEO.poleBasket, npcDarkDetailMat, px + side * 0.10, 0.10, pz + 0.68, 0.38, 0, side * 0.12);
    }

    return group;
  }

  function createBoarderMesh(jacketColor, trouserColor, helmetColor, goggleColor) {
    const group = new THREE.Group();
    const jacketMat = gear(jacketColor, 0.3);
    const trouserMat = gear(trouserColor, 0.2);
    const helmetMat = gear(helmetColor, 0.5);
    const goggleLensMat = gear(goggleColor, 0.9);

    // --- Snowboard Deck ---
    // Waist (center)
    put(group, GEO.boardWaist, npcEquipmentMat, 0, 0.018, 0);
    // Nose section & curved upturned tip (-Z)
    put(group, GEO.boardNose, npcEquipmentMat, 0, 0.022, -0.55);
    put(group, GEO.boardTipCurved, npcEquipmentMat, 0, 0.055, -0.78, 0.35);
    // Tail section & kicktail (+Z)
    put(group, GEO.boardTail, npcEquipmentMat, 0, 0.022, 0.55);
    put(group, GEO.boardTipCurved, npcEquipmentMat, 0, 0.055, 0.78, -0.35);

    // --- Bindings (Front ~+18°, Rear ~-6°) ---
    const frontAngle = 0.31; // +18 deg
    const rearAngle = -0.10; // -6 deg

    // Front binding (-Z)
    put(group, GEO.bindingBase, npcDarkDetailMat, 0, 0.035, -0.26, 0, frontAngle, 0);
    put(group, GEO.bindingHighback, npcEquipmentMat, -0.07, 0.12, -0.26, 0, frontAngle, -0.22);
    put(group, GEO.bindingStrapAnkle, npcEquipmentMat, 0, 0.08, -0.26, 0, frontAngle, 0);
    put(group, GEO.bindingStrapToe, npcEquipmentMat, 0.05, 0.06, -0.26, 0, frontAngle, 0);

    // Rear binding (+Z)
    put(group, GEO.bindingBase, npcDarkDetailMat, 0, 0.035, 0.26, 0, rearAngle, 0);
    put(group, GEO.bindingHighback, npcEquipmentMat, -0.07, 0.12, 0.26, 0, rearAngle, -0.22);
    put(group, GEO.bindingStrapAnkle, npcEquipmentMat, 0, 0.08, 0.26, 0, rearAngle, 0);
    put(group, GEO.bindingStrapToe, npcEquipmentMat, 0.05, 0.06, 0.26, 0, rearAngle, 0);

    // --- Boots ---
    put(group, GEO.boot, npcEquipmentMat, 0, 0.09, -0.26, 0, frontAngle, 0);
    put(group, GEO.bootCuff, npcDarkDetailMat, -0.02, 0.17, -0.26, 0, frontAngle, -0.22);
    put(group, GEO.boot, npcEquipmentMat, 0, 0.09, 0.26, 0, rearAngle, 0);
    put(group, GEO.bootCuff, npcDarkDetailMat, -0.02, 0.17, 0.26, 0, rearAngle, -0.22);

    // --- Legs (Athletic Riding Squat) ---
    // Front leg: knee bent and driving towards the nose
    put(group, GEO.shin, trouserMat, 0.02, 0.32, -0.22, 0.22, frontAngle, -0.15);
    put(group, GEO.thigh, trouserMat, 0.01, 0.58, -0.12, -0.28, frontAngle, 0.18);

    // Rear leg: knee flexed inward
    put(group, GEO.shin, trouserMat, 0.02, 0.32, 0.22, -0.22, rearAngle, -0.15);
    put(group, GEO.thigh, trouserMat, 0.01, 0.58, 0.12, 0.28, rearAngle, 0.18);

    // --- Pelvis & Torso (Opened ~35° towards fall line) ---
    const stanceAngle = 0.58; // ~33 deg open
    put(group, GEO.hip, trouserMat, 0, 0.76, 0, -0.08, stanceAngle, 0);
    put(group, GEO.torso, jacketMat, 0, 1.05, 0, -0.16, stanceAngle, 0);
    put(group, GEO.zipper, npcDarkDetailMat, 0.12 * Math.sin(stanceAngle), 1.05, -0.12 * Math.cos(stanceAngle), -0.16, stanceAngle, 0);
    put(group, GEO.collar, jacketMat, 0, 1.28, -0.02, -0.16, stanceAngle, 0);

    // --- Head, Helmet & Goggles (Looking downhill -Z) ---
    const headAngle = 0.22; // aligned with fall line
    put(group, GEO.head, npcSkinMat, 0.02, 1.40, -0.05);
    const helmet = put(group, GEO.helmet, helmetMat, 0.02, 1.425, -0.05, 0, headAngle, 0);
    helmet.scale.set(1, 0.88, 1.05);
    put(group, GEO.helmetBrim, helmetMat, 0.02 + Math.sin(headAngle) * 0.08, 1.47, -0.05 - Math.cos(headAngle) * 0.08, -0.12, headAngle, 0);
    // Goggles facing downhill (-Z)
    put(group, GEO.goggleFrame, npcDarkDetailMat, 0.02 + Math.sin(headAngle) * 0.10, 1.41, -0.05 - Math.cos(headAngle) * 0.10, 0, headAngle, 0);
    put(group, GEO.goggleLens, goggleLensMat, 0.02 + Math.sin(headAngle) * 0.12, 1.41, -0.05 - Math.cos(headAngle) * 0.12, 0, headAngle, 0);

    // --- Arms (Freeride Balance Posture) ---
    // Lead arm reaching forward/downward (-Z)
    put(group, GEO.upperArm, jacketMat, 0.18, 1.12, -0.15, -0.45, stanceAngle, 0.35);
    put(group, GEO.foreArm, jacketMat, 0.26, 0.94, -0.28, -0.65, stanceAngle, 0.20);
    put(group, GEO.mitten, npcEquipmentMat, 0.30, 0.85, -0.38);

    // Trailing arm raised out/back for balance (+Z)
    put(group, GEO.upperArm, jacketMat, -0.18, 1.14, 0.12, 0.35, stanceAngle, -0.45);
    put(group, GEO.foreArm, jacketMat, -0.28, 1.02, 0.25, 0.55, stanceAngle, -0.30);
    put(group, GEO.mitten, npcEquipmentMat, -0.35, 0.98, 0.36);

    return group;
  }

  const NUM_NPCS = 5;
  const npcs = [];
  for (let i = 0; i < NUM_NPCS; i++) {
    const isSkier = i % 2 === 0;
    const jacketColor = npcJacketColors[i % npcJacketColors.length];
    const trouserColor = npcTrouserColors[i % npcTrouserColors.length];
    const helmetColor = npcHelmetColors[(i * 3) % npcHelmetColors.length];
    const goggleColor = npcGoggleColors[i % npcGoggleColors.length];
    const mesh = isSkier
      ? createSkierMesh(jacketColor, trouserColor, helmetColor, goggleColor)
      : createBoarderMesh(jacketColor, trouserColor, helmetColor, goggleColor);

    mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    root.add(mesh);
    npcs.push({
      mesh,
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
    update(dt, rider) {
      if (!rider) return;
      const rz = rider.pos.z;

      /* Towers on a fixed grid so they never swim: the window simply slides
         one slot at a time as the rider descends past them. Ahead is −z. */
      const baseZ = Math.floor(rz / PYLON_SPACING) * PYLON_SPACING;
      const backZ = baseZ + 2 * PYLON_SPACING;   // two slots behind…
      for (let i = 0; i < NUM_PYLONS; i++) {
        const pz = backZ - i * PYLON_SPACING;    // …to two slots ahead
        const px = cableXAt(pz);
        const py = heightAt(px, pz);
        pylons[i].tower.position.set(px, py + 11.0, pz);
        pylons[i].wheelL.rotation.z += 3.0 * dt;
        pylons[i].wheelR.rotation.z -= 3.0 * dt;
        topX[i] = px;
        topY[i] = py + 21.5;
        topZ[i] = pz;
      }

      // The ropes, tower-top to tower-top.
      for (let i = 0; i < NUM_PYLONS - 1; i++) {
        for (let s = 0; s < 2; s++) {
          const mesh = cables[i * 2 + s];
          const off = s === 0 ? -CABLE_SIDE : CABLE_SIDE;
          const x0 = topX[i] + off;
          const x1 = topX[i + 1] + off;
          cableDir.set(x1 - x0, topY[i + 1] - topY[i], topZ[i + 1] - topZ[i]);
          const len = cableDir.length();
          mesh.position.set((x0 + x1) / 2, (topY[i] + topY[i + 1]) / 2,
            (topZ[i] + topZ[i + 1]) / 2);
          mesh.scale.set(1, len, 1);
          mesh.quaternion.setFromUnitVectors(UP, cableDir.normalize());
        }
      }

      /* Cabins ride the rope between towers: position interpolated along
         the span they are on, dropped by a touch of parabolic sag, hung by
         the grip. `at` is metres behind the backmost tower. */
      for (const g of gondolas) {
        g.at += g.dir * CABIN_SPEED * dt;
        if (g.at < 0) g.at += SPAN;
        if (g.at >= SPAN) g.at -= SPAN;
        const seg = Math.min(NUM_PYLONS - 2, Math.floor(g.at / PYLON_SPACING));
        const t = g.at / PYLON_SPACING - seg;
        const cx = topX[seg] + (topX[seg + 1] - topX[seg]) * t + g.side;
        const cz = topZ[seg] + (topZ[seg + 1] - topZ[seg]) * t;
        const cy = topY[seg] + (topY[seg + 1] - topY[seg]) * t
          - SAG * 4 * t * (1 - t);
        g.mesh.position.set(cx, cy - 1.7, cz);
        g.mesh.rotation.z = Math.sin(cz * 0.08 + g.at * 0.02) * 0.05;
      }

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
        const sTurn = Math.sin(npc.sPhase) * 12.0;
        const targetX = nearestCenter(npc.x, npc.z) + sTurn;
        npc.vx = (targetX - npc.x) * 2.2;

        npc.x += npc.vx * dt;
        npc.z += npc.vz * dt;
        npc.y = heightAt(npc.x, npc.z);
        npc.mesh.position.set(npc.x, npc.y, npc.z);

        // Direction of travel (yaw) where 0 = straight downhill (-Z)
        const yaw = Math.atan2(npc.vx, -npc.vz);

        // Slope pitch along heading
        const zAhead = npc.z - 0.9;
        const zBehind = npc.z + 0.9;
        const hRatio = npc.vx / Math.max(1, Math.abs(npc.vz));
        const yAhead = heightAt(npc.x + hRatio * -0.9, zAhead);
        const yBehind = heightAt(npc.x - hRatio * -0.9, zBehind);
        const pitch = Math.atan2(yAhead - yBehind, 1.8);

        // Bank angle (lean into the carve)
        const bank = Math.max(-0.35, Math.min(0.35, -npc.vx * 0.045));

        npc.mesh.rotation.order = 'YXZ';
        npc.mesh.rotation.set(pitch, yaw, bank);

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
        npc.mesh.rotation.order = 'YXZ';
        npc.mesh.rotation.set(0, 0, 0);
      }
    },
  };
}
