/* Rabbits and bears.

   Two animals with opposite jobs. The rabbits exist to react: they sit in
   the snow twitching until a rider gets inside fifteen metres and then bolt,
   which costs nothing, endangers nothing, and is most of what makes the
   mountain feel inhabited rather than decorated. Threading one is worth a
   few points, so there is a reason to aim at them.

   The bears exist to be the only thing on the hill that is genuinely
   dangerous. They are rare, they appear only once the run has got going,
   they are slow, and they do not move out of the way. A bear rears up when
   the rider gets close, which is both a real thing a bear does and the
   clearest possible telegraph that this one is not a shrub.

   Both are single instanced meshes with their parts baked in, so seventeen
   animals cost two draw calls. Neither has a skeleton: a hop is a squash and
   a rear is a rotation about the shoulder, and at this resolution that is
   all either of them needs. */

import { compose } from './geom.js';
import { WILDLIFE, TERRAIN } from './config.js';
import { heightAt, pisteCenter } from './terrain.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function rabbitGeometry(THREE) {
  const ball = new THREE.SphereGeometry(0.5, 6, 5);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const fur = '#eef3fb';
  const shade = '#c9d6e6';
  return compose(THREE, [
    { geo: ball, color: fur, pos: [0, 0.24, 0.03], scale: [0.42, 0.36, 0.58] },
    { geo: ball, color: fur, pos: [0, 0.36, -0.24], scale: [0.28, 0.28, 0.28] },
    { geo: box, color: shade, pos: [-0.07, 0.55, -0.22], rot: [-0.2, 0, -0.12], scale: [0.05, 0.26, 0.03] },
    { geo: box, color: shade, pos: [0.07, 0.55, -0.22], rot: [-0.2, 0, 0.12], scale: [0.05, 0.26, 0.03] },
    { geo: ball, color: '#ffffff', pos: [0, 0.26, 0.3], scale: [0.13, 0.13, 0.13] },
    { geo: box, color: '#1b1f27', pos: [-0.09, 0.38, -0.36], scale: [0.045, 0.045, 0.03] },
    { geo: box, color: '#1b1f27', pos: [0.09, 0.38, -0.36], scale: [0.045, 0.045, 0.03] },
  ]);
}

function bearGeometry(THREE) {
  const ball = new THREE.SphereGeometry(0.5, 7, 6);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  const coat = '#4a3628';
  const dark = '#33241a';
  const muzzle = '#7c5f45';
  return compose(THREE, [
    { geo: cyl, color: dark, pos: [-0.42, 0.45, -0.55], scale: [0.34, 0.9, 0.34] },
    { geo: cyl, color: dark, pos: [0.42, 0.45, -0.55], scale: [0.34, 0.9, 0.34] },
    { geo: cyl, color: dark, pos: [-0.42, 0.45, 0.6], scale: [0.36, 0.9, 0.36] },
    { geo: cyl, color: dark, pos: [0.42, 0.45, 0.6], scale: [0.36, 0.9, 0.36] },
    { geo: ball, color: coat, pos: [0, 1.05, 0], scale: [1.5, 1.35, 2.5] },
    { geo: ball, color: coat, pos: [0, 1.28, -1.0], scale: [0.62, 0.58, 0.62] },
    { geo: box, color: muzzle, pos: [0, 1.16, -1.32], scale: [0.3, 0.24, 0.34] },
    { geo: ball, color: dark, pos: [-0.28, 1.56, -0.92], scale: [0.2, 0.2, 0.12] },
    { geo: ball, color: dark, pos: [0.28, 1.56, -0.92], scale: [0.2, 0.2, 0.12] },
    { geo: box, color: '#12100e', pos: [0, 1.2, -1.5], scale: [0.13, 0.1, 0.06] },
  ]);
}

export function createWildlife(THREE) {
  const group = new THREE.Group();

  const flat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const rabbits = new THREE.InstancedMesh(rabbitGeometry(THREE), flat(), WILDLIFE.rabbits);
  const bears = new THREE.InstancedMesh(bearGeometry(THREE), flat(), WILDLIFE.bears);
  rabbits.frustumCulled = false;
  bears.frustumCulled = false;
  rabbits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bears.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(rabbits, bears);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();

  const hares = [];
  for (let i = 0; i < WILDLIFE.rabbits; i++) {
    hares.push({ x: 0, z: 1, yaw: 0, vx: 0, vz: 0, flee: 0, hop: Math.random() * 10, alive: false, seen: false });
  }
  const beasts = [];
  for (let i = 0; i < WILDLIFE.bears; i++) {
    beasts.push({ x: 0, z: 1, yaw: 0, dir: 1, rear: 0, alive: false, hit: false, near: false, walk: Math.random() * 6 });
  }

  function placeRabbit(r, rider) {
    const [lo, hi] = WILDLIFE.rabbitSpawnRange;
    const z = rider.pos.z - (lo + Math.random() * (hi - lo));
    r.z = z;
    r.x = pisteCenter(z) + (Math.random() * 2 - 1) * (TERRAIN.corridorHalf + 12);
    r.yaw = Math.random() * Math.PI * 2;
    r.vx = 0;
    r.vz = 0;
    r.flee = 0;
    r.alive = true;
    r.seen = false;
  }

  function placeBear(b, rider) {
    const [lo, hi] = WILDLIFE.bearSpawnRange;
    const z = rider.pos.z - (lo + Math.random() * (hi - lo));
    b.z = z;
    b.x = pisteCenter(z) + (Math.random() * 2 - 1) * (TERRAIN.corridorHalf - 3);
    b.dir = Math.random() < 0.5 ? -1 : 1;
    b.yaw = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    b.rear = 0;
    b.alive = true;
    b.hit = false;
    b.near = false;
  }

  let time = 0;

  /* `onNear` is called when the rider threads an animal without hitting it;
     `onHit` when a bear is not so lucky. */
  function update(dt, rider, onNear, onHit) {
    time += dt;
    const rx = rider.pos.x;
    const rz = rider.pos.z;

    // --- rabbits -----------------------------------------------------------
    let n = 0;
    for (const r of hares) {
      if (!r.alive || r.z > rz + 26) placeRabbit(r, rider);

      const dx = r.x - rx;
      const dz = r.z - rz;
      const dist = Math.hypot(dx, dz);

      if (dist < WILDLIFE.rabbitFlee && r.flee <= 0) {
        // Away from the rider and across the hill, because straight down the
        // fall line from a snowboarder is not an escape
        r.flee = 2.6;
        const away = Math.atan2(dx, dz);
        r.yaw = away + (Math.random() - 0.5) * 1.2;
      }
      if (r.flee > 0) {
        r.flee -= dt;
        const sp = WILDLIFE.rabbitSpeed * clamp(r.flee / 2.0, 0.25, 1);
        r.vx = Math.sin(r.yaw) * sp;
        r.vz = Math.cos(r.yaw) * sp;
        r.hop += dt * WILDLIFE.rabbitHop;
      } else {
        r.vx *= 0.9;
        r.vz *= 0.9;
        r.hop += dt * 0.9;
      }
      r.x += r.vx * dt;
      r.z += r.vz * dt;

      if (!r.seen && dist < 2.6 && Math.abs(dz) < 2.0) {
        r.seen = true;
        onNear(r.x, r.z, 'rabbit');
      }

      // A hop is a bounce and a squash, on the same phase
      const bounce = r.flee > 0 ? Math.abs(Math.sin(r.hop)) : 0;
      const squash = r.flee > 0 ? 1 + Math.cos(r.hop * 2) * 0.12 : 1 + Math.sin(r.hop * 2.4) * 0.03;
      v.set(r.x, heightAt(r.x, r.z) + bounce * 0.55, r.z);
      e.set(0, r.yaw + Math.PI, 0);
      q.setFromEuler(e);
      s.set(1 / squash, squash, 1 / squash);
      m.compose(v, q, s);
      rabbits.setMatrixAt(n++, m);
    }
    rabbits.count = n;
    rabbits.instanceMatrix.needsUpdate = true;

    // --- bears -------------------------------------------------------------
    let bn = 0;
    const bearsAllowed = rider.distance > WILDLIFE.bearFrom;
    for (const b of beasts) {
      if (!bearsAllowed) { b.alive = false; continue; }
      if (!b.alive || b.z > rz + 30) placeBear(b, rider);

      const dx = b.x - rx;
      const dz = b.z - rz;
      const dist = Math.hypot(dx, dz);

      // A bear notices you long before you reach it, and stands up about it
      const near = clamp(1 - (dist - 8) / 22, 0, 1);
      b.rear += (near - b.rear) * (1 - Math.exp(-3 * dt));
      const walk = 1 - b.rear;
      b.walk += dt * 2.4 * walk;
      b.x += b.dir * WILDLIFE.bearSpeed * walk * dt;
      // Turn around at the treeline rather than wandering into the forest
      const centre = pisteCenter(b.z);
      if (Math.abs(b.x - centre) > TERRAIN.corridorHalf) b.dir *= -1;
      b.yaw = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2;

      // A hit and a near miss are tracked separately, and the near miss is
      // only awarded once the bear is behind. Sharing one flag meant every
      // head-on approach crossed the 2.4–3.4 m band first, claimed BEAR
      // DODGED, and then suppressed the collision — so the one genuinely
      // dangerous thing on the mountain was harmless in the common case.
      const level = Math.abs(rider.pos.y - heightAt(b.x, b.z)) < 2.4;
      if (!b.hit && level && dist < WILDLIFE.bearRadius + 0.9) {
        b.hit = true;
        onHit(b.x, b.z);
      } else if (!b.hit && !b.near && dz > 0.5 && dist < 3.4) {
        b.near = true;
        onNear(b.x, b.z, 'bear');
      }

      v.set(b.x, heightAt(b.x, b.z), b.z);
      e.set(-b.rear * 0.55, b.yaw, 0, 'YXZ');
      q.setFromEuler(e);
      const lumber = 1 + Math.sin(b.walk) * 0.04 * walk;
      s.set(1, lumber, 1);
      m.compose(v, q, s);
      bears.setMatrixAt(bn++, m);
    }
    bears.count = bn;
    bears.instanceMatrix.needsUpdate = true;
  }

  function reset() {
    for (const r of hares) r.alive = false;
    for (const b of beasts) b.alive = false;
  }

  // The animals themselves are on the returned object so the debug hatch
  // can place one exactly where a test needs it
  return { group, update, reset, hares, beasts };
}
