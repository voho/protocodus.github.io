/* Hedgerow — ragdolls.

   When a soldier dies the animation lets go and his body falls under its
   own weight. The skeleton becomes 22 Verlet particles on the joints (plus
   the head top, hand and toe tips) held together by rigid sticks, braced
   across the torso, with range limits that stop elbows, knees and the neck
   folding through themselves. Particles collide with the ground (terrain
   and the tops of colliders) with friction, and with walls. The killing
   shot pushes the particles it hit; an explosion throws the whole body.

   Every frame the bones are turned to follow the particles: each bone takes
   the rotation that carries its segment (and, for the torso, the line
   across the shoulders or hips) from where it was at the moment of death
   to where the particles are now, so the skinned mesh falls with them. */

import * as THREE from 'three';

const P_DEF = [
  // name, bone, offset along the bone's +Y, radius
  ['pelvis', 'hips', 0, 0.15], ['spine', 'spine', 0, 0.15], ['chest', 'chest', 0, 0.16], ['neck', 'neck', 0, 0.08],
  ['head', 'head', 0.08, 0.12], ['headTop', 'head', 0.24, 0.1],
  ['shoulder_l', 'upperarm_l', 0, 0.07], ['elbow_l', 'forearm_l', 0, 0.06], ['wrist_l', 'hand_l', 0, 0.05], ['hand_l', 'hand_l', 0.12, 0.05],
  ['shoulder_r', 'upperarm_r', 0, 0.07], ['elbow_r', 'forearm_r', 0, 0.06], ['wrist_r', 'hand_r', 0, 0.05], ['hand_r', 'hand_r', 0.12, 0.05],
  ['hip_l', 'thigh_l', 0, 0.08], ['knee_l', 'shin_l', 0, 0.07], ['ankle_l', 'foot_l', 0, 0.06], ['toe_l', 'foot_l', 0.15, 0.05],
  ['hip_r', 'thigh_r', 0, 0.08], ['knee_r', 'shin_r', 0, 0.07], ['ankle_r', 'foot_r', 0, 0.06], ['toe_r', 'foot_r', 0.15, 0.05],
];

// rigid sticks
const STICKS = [
  ['pelvis', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', 'headTop'],
  ['chest', 'shoulder_l'], ['chest', 'shoulder_r'], ['shoulder_l', 'elbow_l'], ['elbow_l', 'wrist_l'], ['wrist_l', 'hand_l'],
  ['shoulder_r', 'elbow_r'], ['elbow_r', 'wrist_r'], ['wrist_r', 'hand_r'],
  ['pelvis', 'hip_l'], ['pelvis', 'hip_r'], ['hip_l', 'knee_l'], ['knee_l', 'ankle_l'], ['ankle_l', 'toe_l'],
  ['hip_r', 'knee_r'], ['knee_r', 'ankle_r'], ['ankle_r', 'toe_r'],
  // the torso is a box: braces
  ['shoulder_l', 'shoulder_r'], ['hip_l', 'hip_r'], ['shoulder_l', 'hip_l'], ['shoulder_r', 'hip_r'],
  ['shoulder_l', 'hip_r'], ['shoulder_r', 'hip_l'], ['neck', 'shoulder_l'], ['neck', 'shoulder_r'],
  ['pelvis', 'chest'], ['spine', 'shoulder_l'], ['spine', 'shoulder_r'],
];
// [a, b, min fraction, max fraction] of the rest distance: joint limits
const RANGES = [
  ['headTop', 'chest', 0.85, 1.04], ['head', 'shoulder_l', 0.8, 1.15], ['head', 'shoulder_r', 0.8, 1.15],
  ['shoulder_l', 'wrist_l', 0.42, 1.0], ['shoulder_r', 'wrist_r', 0.42, 1.0],
  ['hip_l', 'ankle_l', 0.5, 1.0], ['hip_r', 'ankle_r', 0.5, 1.0],
  ['knee_l', 'toe_l', 0.75, 1.15], ['knee_r', 'toe_r', 0.75, 1.15],
  ['knee_l', 'knee_r', 0.25, 3.0], ['ankle_l', 'ankle_r', 0.2, 4.0],
  ['pelvis', 'knee_l', 0.6, 1.05], ['pelvis', 'knee_r', 0.6, 1.05],
];
// bones driven: bone, from particle, to particle, optional [side a, side b] for twist
const DRIVE = [
  ['hips', 'pelvis', 'spine', ['hip_l', 'hip_r']],
  ['spine', 'spine', 'chest', ['shoulder_l', 'shoulder_r']],
  ['chest', 'chest', 'neck', ['shoulder_l', 'shoulder_r']],
  ['neck', 'neck', 'head', ['shoulder_l', 'shoulder_r']],
  ['head', 'head', 'headTop', ['shoulder_l', 'shoulder_r']],
  ['upperarm_l', 'shoulder_l', 'elbow_l'], ['forearm_l', 'elbow_l', 'wrist_l'], ['hand_l', 'wrist_l', 'hand_l'],
  ['upperarm_r', 'shoulder_r', 'elbow_r'], ['forearm_r', 'elbow_r', 'wrist_r'], ['hand_r', 'wrist_r', 'hand_r'],
  ['thigh_l', 'hip_l', 'knee_l', ['hip_l', 'hip_r']], ['shin_l', 'knee_l', 'ankle_l', ['hip_l', 'hip_r']], ['foot_l', 'ankle_l', 'toe_l', ['hip_l', 'hip_r']],
  ['thigh_r', 'hip_r', 'knee_r', ['hip_l', 'hip_r']], ['shin_r', 'knee_r', 'ankle_r', ['hip_l', 'hip_r']], ['foot_r', 'ankle_r', 'toe_r', ['hip_l', 'hip_r']],
];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

function basis(d, side, out) {
  // orthonormal frame: y along the segment, x along the side line made square to it
  const y = _a.copy(d).normalize();
  const x = _b.copy(side).addScaledVector(y, -side.dot(y));
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0).addScaledVector(y, -y.x);
  x.normalize();
  const z = _c.crossVectors(x, y);
  return out.makeBasis(x, y, z);
}

/* Build a ragdoll from a character's bones as they are now.
   world: { groundAt(x, z, y, step, r), pushOut(p, r, feet, height, step) }
   velocity: Vector3 of the body when it died; impulses: [{part, vel: Vector3}] */
export function createRagdoll(bones, world, { velocity = new THREE.Vector3(), impulses = [], root = null } = {}) {
  for (const [, b] of P_DEF) if (!bones[b]) return null;
  root?.updateMatrixWorld(true);
  const n = P_DEF.length;
  const index = new Map(P_DEF.map(([name], i) => [name, i]));
  const pos = [], prev = [], rad = new Float32Array(n);
  const dt0 = 1 / 60;
  const wq = new THREE.Quaternion();
  P_DEF.forEach(([name, bone, off, r], i) => {
    const b = bones[bone];
    const p = b.getWorldPosition(new THREE.Vector3());
    if (off) {
      b.getWorldQuaternion(wq);
      p.add(new THREE.Vector3(0, off, 0).applyQuaternion(wq));
    }
    pos.push(p);
    prev.push(p.clone().addScaledVector(velocity, -dt0));
    rad[i] = r;
  });
  // the killing blow
  for (const im of impulses) {
    const hit = im.part === 'head' ? ['head', 'headTop', 'neck'] : im.part === 'legs' ? ['knee_l', 'knee_r', 'hip_l', 'hip_r'] : im.part === 'all' ? P_DEF.map(p => p[0]) : ['chest', 'spine', 'shoulder_l', 'shoulder_r'];
    for (const name of hit) prev[index.get(name)].addScaledVector(im.vel, -dt0);
    // the rest of the body follows a little
    if (im.part !== 'all') for (let i = 0; i < n; i++) prev[i].addScaledVector(im.vel, -dt0 * 0.25);
  }
  // legs give way
  for (const name of ['knee_l', 'knee_r', 'pelvis']) prev[index.get(name)].y += 0.6 * dt0;

  const sticks = STICKS.map(([a, b]) => { const i = index.get(a), j = index.get(b); return [i, j, pos[i].distanceTo(pos[j])]; });
  const ranges = RANGES.map(([a, b, lo, hi]) => { const i = index.get(a), j = index.get(b); const d = pos[i].distanceTo(pos[j]); return [i, j, d * lo, d * hi]; });

  // the pose at death, for driving the bones
  const drive = DRIVE.filter(([b]) => bones[b]).map(([bone, a, c, side]) => {
    const i = index.get(a), j = index.get(c);
    const q0 = bones[bone].getWorldQuaternion(new THREE.Quaternion());
    const d0 = new THREE.Vector3().subVectors(pos[j], pos[i]);
    const s = side ? [index.get(side[0]), index.get(side[1])] : null;
    const B0 = new THREE.Matrix4();
    if (s) basis(d0, new THREE.Vector3().subVectors(pos[s[1]], pos[s[0]]), B0);
    return { bone: bones[bone], i, j, q0, d0: d0.normalize(), s, B0inv: s ? B0.clone().invert() : null };
  });

  let asleep = false, still = 0;
  const tmp = new THREE.Vector3(), push = { x: 0, z: 0 };

  function satisfy() {
    for (const [i, j, L] of sticks) {
      const a = pos[i], b = pos[j];
      _a.subVectors(b, a);
      const d = _a.length() || 1e-6;
      const k = (d - L) / d * 0.5;
      a.addScaledVector(_a, k); b.addScaledVector(_a, -k);
    }
    for (const [i, j, lo, hi] of ranges) {
      const a = pos[i], b = pos[j];
      _a.subVectors(b, a);
      const d = _a.length() || 1e-6;
      const t = d < lo ? lo : d > hi ? hi : d;
      if (t === d) continue;
      const k = (d - t) / d * 0.5;
      a.addScaledVector(_a, k); b.addScaledVector(_a, -k);
    }
  }

  function collide() {
    for (let i = 0; i < n; i++) {
      const p = pos[i], r = rad[i];
      // walls and solid things
      push.x = p.x; push.z = p.z;
      if (world.pushOut(push, r, p.y - r, r * 2, 0.02)) { p.x = push.x; p.z = push.z; }
      const g = world.groundAt(p.x, p.z, p.y + 0.3, 0.45, r * 0.6) + r;
      if (p.y < g) {
        p.y = g;
        // friction: lose most of the sliding
        const q = prev[i];
        q.x = p.x - (p.x - q.x) * 0.45;
        q.z = p.z - (p.z - q.z) * 0.45;
        if (q.y < p.y) q.y = p.y - (p.y - q.y) * 0.2;
      }
    }
  }

  function step(dt) {
    if (asleep) return;
    const sub = 2, h = Math.min(dt, 1 / 30) / sub;
    let moved = 0;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) {
        const p = pos[i], q = prev[i];
        tmp.copy(p);
        p.x += (p.x - q.x) * 0.995;
        p.y += (p.y - q.y) * 0.995 - 9.8 * h * h;
        p.z += (p.z - q.z) * 0.995;
        q.copy(tmp);
      }
      for (let it = 0; it < 6; it++) { satisfy(); collide(); }
    }
    for (let i = 0; i < n; i++) moved = Math.max(moved, pos[i].distanceToSquared(prev[i]));
    still = moved < 1e-7 ? still + dt : 0;
    if (still > 1.2) asleep = true;
  }

  /* Turn the bones to follow the particles. */
  function pose() {
    // hips: position from the pelvis particle
    const hips = bones.hips;
    hips.parent.updateWorldMatrix(true, false);
    hips.position.copy(hips.parent.worldToLocal(_c.copy(pos[index.get('pelvis')])));
    for (const d of drive) {
      const dir = _a.subVectors(pos[d.j], pos[d.i]);
      if (d.s) {
        const side = new THREE.Vector3().subVectors(pos[d.s[1]], pos[d.s[0]]);
        basis(dir, side, _m);
        _m2.multiplyMatrices(_m, d.B0inv);
        _q.setFromRotationMatrix(_m2);
      } else {
        _q.setFromUnitVectors(d.d0, dir.normalize());
      }
      _q.multiply(d.q0);                                // the bone's world rotation now
      d.bone.parent.updateWorldMatrix(true, false);
      d.bone.parent.getWorldQuaternion(_q2);
      d.bone.quaternion.copy(_q2.invert().multiply(_q));
      d.bone.updateMatrixWorld(true);
    }
  }

  return {
    step, pose,
    get asleep() { return asleep; },
    get pelvis() { return pos[index.get('pelvis')]; },
    positions: pos,
  };
}
