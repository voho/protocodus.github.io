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

  const cabinBodyMat = new THREE.MeshLambertMaterial({ color: 0xb31f1f });
  const cabinGlassMat = new THREE.MeshLambertMaterial({
    color: 0x1a3450, transparent: true, opacity: 0.85,
  });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x333842 });

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

  const pylonMat = new THREE.MeshLambertMaterial({ color: 0x5a6270 });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x22262c });
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

  /* --- the other people --------------------------------------------------- */

  /* THE OTHER PEOPLE, who used to be a cylinder with a ball on it.

     A skier was a tapered cylinder, a sphere and two flat boxes; a boarder
     was the same with one box instead of two, standing square to its own
     board — which is the one thing a snowboarder never does. At any distance
     where you could tell they were people at all, you could tell they were
     three primitives, and they were the only figures on a mountain whose own
     rider is a fully articulated rig.

     They are still cheap: about a dozen small meshes each, no skinning and no
     animation beyond the lean the run gives them. What they now have is a
     *silhouette* — bent knees, a forward hinge at the waist, arms carried out
     from the body and a helmet that is not the same sphere as the head. At
     forty metres that outline is the whole of what reads, and it is the
     difference between another skier and a traffic cone.

     They also take the shared alpine shading and cast into the depth map,
     neither of which they did before. That was not a stylistic gap: every
     other solid on this mountain dims into dusk and lays a shadow, so five
     figures lit by nothing and standing on nothing were five cut-outs. */
  const npcJacketColors = [0xb32626, 0x2f6fce, 0x2f9e53, 0xd98c1f,
    0x8a3fd1, 0x1fb3a8, 0xc23a68, 0x4a6b8a];
  const npcHelmetColors = [0x1b1f27, 0xe8edf4, 0x2b3444, 0xb8c2d0];
  const gear = (hex) => shading.apply(
    new THREE.MeshLambertMaterial({ color: hex, flatShading: false }),
  );
  const npcEquipmentMat = gear(0x181c24);   // skis, board, poles, boots
  const npcTrouserMat = gear(0x27303f);
  const npcGoggleMat = gear(0x6fd9e8);
  const npcHelmetMats = npcHelmetColors.map(gear);

  // Geometry is shared across every figure; only the jacket colour differs.
  const GEO = {
    torso: new THREE.CylinderGeometry(0.20, 0.26, 0.62, 10),
    hip: new THREE.CylinderGeometry(0.21, 0.19, 0.16, 10),
    thigh: new THREE.CylinderGeometry(0.095, 0.085, 0.42, 8),
    shin: new THREE.CylinderGeometry(0.080, 0.070, 0.40, 8),
    boot: new THREE.BoxGeometry(0.15, 0.14, 0.26),
    upperArm: new THREE.CylinderGeometry(0.062, 0.055, 0.34, 7),
    foreArm: new THREE.CylinderGeometry(0.052, 0.046, 0.32, 7),
    head: new THREE.SphereGeometry(0.105, 9, 7),
    helmet: new THREE.SphereGeometry(0.128, 10, 8),
    goggles: new THREE.BoxGeometry(0.215, 0.075, 0.10),
    ski: new THREE.BoxGeometry(0.10, 0.035, 1.62),
    skiTip: new THREE.BoxGeometry(0.10, 0.035, 0.22),
    board: new THREE.BoxGeometry(0.30, 0.045, 1.50),
    boardTip: new THREE.BoxGeometry(0.28, 0.045, 0.20),
    pole: new THREE.CylinderGeometry(0.014, 0.011, 1.15, 5),
    basket: new THREE.CylinderGeometry(0.055, 0.055, 0.015, 7),
  };

  const put = (group, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

  /* The body, shared by both disciplines. `open` is how far the feet are
     apart across the fall line — a skier rides them close, a boarder has
     them a board's length apart and turned across it — and `face` is the
     direction the shoulders are pointed, which is the only thing that
     really separates the two stances from behind. */
  function buildBody(group, jacketMat, helmetMat, open, face) {
    const lean = 0.20;                       // forward hinge, radians
    const s = Math.sin(face);
    const c = Math.cos(face);
    // legs: bent, and the knees drive forward over the toes
    for (const side of [-1, 1]) {
      const fx = side * open * c;
      const fz = -side * open * s;
      put(group, GEO.thigh, npcTrouserMat,
        fx * 0.55, 0.56, fz * 0.55 + 0.05, 0.55, face, 0);
      put(group, GEO.shin, npcTrouserMat,
        fx * 0.85, 0.26, fz * 0.85 - 0.02, -0.30, face, 0);
      put(group, GEO.boot, npcEquipmentMat,
        fx, 0.09, fz, 0, face, 0);
    }
    put(group, GEO.hip, npcTrouserMat, 0, 0.80, 0.02, lean * 0.5, face, 0);
    put(group, GEO.torso, jacketMat,
      0, 1.10, -0.09, lean, face, 0);
    // arms, carried out from the body for balance rather than hanging
    for (const side of [-1, 1]) {
      const ax = side * 0.235 * c;
      const az = -side * 0.235 * s;
      put(group, GEO.upperArm, jacketMat,
        ax, 1.16, az - 0.04, 0.25, face, side * 0.42);
      put(group, GEO.foreArm, jacketMat,
        ax * 1.5, 0.92, az * 1.5 + 0.12, 0.85, face, side * 0.30);
    }
    put(group, GEO.head, npcEquipmentMat, 0, 1.48, 0.06, 0, face, 0);
    const helmet = put(group, GEO.helmet, helmetMat, 0, 1.505, 0.05, 0, face, 0);
    helmet.scale.set(1, 0.86, 1.04);
    put(group, GEO.goggles, npcGoggleMat,
      0.0 + s * 0.09, 1.485, 0.09 * c, 0, face, 0);
  }

  function createSkierMesh(jacketColor, helmetMat) {
    const group = new THREE.Group();
    const jacketMat = gear(jacketColor);
    buildBody(group, jacketMat, helmetMat, 0.17, 0);
    for (const side of [-1, 1]) {
      const x = side * 0.17;
      put(group, GEO.ski, npcEquipmentMat, x, 0.018, 0);
      // an upturned tip, which is most of what says "ski" at distance
      put(group, GEO.skiTip, npcEquipmentMat, x, 0.055, -0.88, -0.38);
      // poles trail back and out, baskets just clear of the snow
      put(group, GEO.pole, npcEquipmentMat, side * 0.42, 0.62, 0.30, 0.42);
      put(group, GEO.basket, npcEquipmentMat, side * 0.42, 0.10, 0.53);
    }
    return group;
  }

  function createBoarderMesh(jacketColor, helmetMat) {
    const group = new THREE.Group();
    const jacketMat = gear(jacketColor);
    /* Sideways, which is the whole point. The board runs along z and the
       rider stands across it, so the shoulders are turned a bit under a
       right angle to the direction of travel — the stance angle a real
       binding is set to, and the reason a boarder reads as a boarder from
       behind while a skier reads as a skier. */
    buildBody(group, jacketMat, helmetMat, 0.30, Math.PI * 0.42);
    put(group, GEO.board, npcEquipmentMat, 0, 0.022, 0);
    put(group, GEO.boardTip, npcEquipmentMat, 0, 0.052, -0.82, -0.30);
    put(group, GEO.boardTip, npcEquipmentMat, 0, 0.052, 0.82, 0.30);
    return group;
  }

  const NUM_NPCS = 5;
  const npcs = [];
  for (let i = 0; i < NUM_NPCS; i++) {
    const isSkier = i % 2 === 0;
    const helmetMat = npcHelmetMats[(i * 3) % npcHelmetMats.length];
    const mesh = isSkier
      ? createSkierMesh(npcJacketColors[i % npcJacketColors.length], helmetMat)
      : createBoarderMesh(npcJacketColors[i % npcJacketColors.length], helmetMat);
    // Everything solid on this mountain casts, and these are the only figures
    // on it besides the rider. Without this they stood on their own shadowless
    // patch of snow, which reads as pasted on however good the model is.
    mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    root.add(mesh);
    npcs.push({
      mesh,
      x: 0,
      z: 100 + i * 40,   // parked uphill until the first respawn places them
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
          npc.vz *= Math.exp(-2.0 * dt);
          npc.z += npc.vz * dt;
          npc.x += npc.vx * dt;
          npc.mesh.rotation.z += 5.0 * dt;
          npc.mesh.rotation.x += 3.0 * dt;
          npc.y = heightAt(npc.x, npc.z);
          npc.mesh.position.set(npc.x, npc.y + 0.3, npc.z);
          if (npc.tumbleTimer <= 0) {
            npc.tumbled = false;
            npc.vz = -11.0;
            npc.mesh.rotation.set(0, 0, 0);
          }
          continue;
        }

        // Easy S-turns about the nearest branch line, so they stay on the
        // corduroy through forks instead of skiing the island.
        npc.sPhase += dt * 1.4;
        const sTurn = Math.sin(npc.sPhase) * 11.0;
        const targetX = nearestCenter(npc.x, npc.z) + sTurn;
        npc.vx = (targetX - npc.x) * 2.2;

        npc.x += npc.vx * dt;
        npc.z += npc.vz * dt;
        npc.y = heightAt(npc.x, npc.z);
        npc.mesh.position.set(npc.x, npc.y, npc.z);
        npc.mesh.rotation.set(0, Math.atan2(npc.vx, npc.vz) + Math.PI,
          Math.sin(npc.sPhase) * 0.12);

        // A little carve spray off their turns — as a rate per second, not
        // per frame, or a 120 Hz display threw twice the snow a 60 Hz one did.
        if (spray && Math.random() < 15 * dt) {
          spray.burst(npc.mesh.position, -npc.vx * 0.2, -npc.vz * 0.2, 3, 0.5);
        }

        const dx = rider.pos.x - npc.x;
        const dy = rider.pos.y - npc.y;
        const dz = rider.pos.z - npc.z;
        if (dx * dx + dz * dz < 2.5 && Math.abs(dy) < 2.2) {
          // Both go down. The rider's own 'fall' event carries the crash
          // sound, camera kick and powder curtain; only the NPC's half of
          // the collision is staged here. The grace window is the same one
          // every other hazard honours — the NPCs ski the guide line and a
          // checkpoint restart stands the rider on it, so without the
          // grace a respawn inside someone's skis felled the rider again
          // on the spot, repeatedly.
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
  };
}
