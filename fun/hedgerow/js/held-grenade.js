/* A prepared grenade stays in view without stretching the arm. The
   authored grip supplies its orientation; IK only brings it into reach.
   Restore the temporary rotations before the next animation-mixer tick. */
import * as THREE from 'three';
import { createHandTarget } from './hand-target.js';
import { MOVE } from './world.js';

export const THROW_ANIMATION_LEAD = .18;

// The hand's bar grip follows socket (0, .5, .866), not socket +Z.
// Keep the original grenade dimensions and seat its actual grip in that
// aperture. The stick model's origin is by its head, above its wood grip.
export function seatHeldGrenade(object, name) {
  const stick = name === 'grenade_de';
  if (!stick && name !== 'grenade_us') return;
  object.rotation.set(stick ? -Math.PI / 6 : Math.PI / 3, 0, 0);
  object.position.set(0, stick ? 0 : -.005, stick ? -.1265 : 0).applyQuaternion(object.quaternion).negate();
}

export function createHeldGrenadePose(root, bones, socket) {
  const solver = createHandTarget(root, bones, socket, 'r');
  if (!solver) return null;
  const base = ['upperarm_r', 'forearm_r', 'hand_r'].map(name => [bones[name], new THREE.Quaternion()]);
  const target = new THREE.Object3D();
  const right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), forward = new THREE.Vector3();
  const basis = new THREE.Matrix4(), cameraRotation = new THREE.Quaternion();
  const socketCorrection = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 6);
  const eye = new THREE.Vector3(), reach = new THREE.Vector3();
  let saved = false, weight = 0;
  function restore() {
    if (!saved) return;
    for (const [bone, rotation] of base) bone.quaternion.copy(rotation);
    saved = false;
  }
  return {
    restore,
    update(dt, camera, holding, world) {
      if (dt > 0 && Number.isFinite(dt)) weight += ((holding ? 1 : 0) - weight) * (1 - Math.exp(-18 * dt));
      if (weight < 1e-5) { weight = 0; return; }
      root.updateMatrixWorld(true); camera.updateWorldMatrix(true, false);
      for (const [bone, rotation] of base) rotation.copy(bone.quaternion);
      saved = true;
      target.position.set(.18, -.22, -.45); camera.localToWorld(target.position);
      if (world?.raycast) {
        camera.getWorldPosition(eye); reach.subVectors(target.position, eye);
        const distance = reach.length(); reach.divideScalar(distance);
        const hit = world.raycast(eye.x, eye.y, eye.z, reach.x, reach.y, reach.z, distance, MOVE, { noWater: true });
        if (hit) {
          const safe = Math.max(0, hit.t - .12);
          target.position.copy(eye).addScaledVector(reach, safe);
          if (safe < .25) target.position.y -= .45 - safe;
        }
      }
      camera.getWorldQuaternion(cameraRotation);
      right.set(-1, 0, 0).applyQuaternion(cameraRotation); right.y = 0; right.normalize();
      forward.crossVectors(up, right).normalize();
      target.quaternion.setFromRotationMatrix(basis.makeBasis(right, forward, up)).multiply(socketCorrection);
      target.updateMatrixWorld(true);
      solver.update(target, weight);
    },
    reset(preservePose = false) {
      if (!preservePose) restore();
      saved = false; weight = 0;
    },
    get weight() { return weight; },
  };
}
