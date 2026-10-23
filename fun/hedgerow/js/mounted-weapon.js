/* A mounted gun stays on its bipod. Fit the gunner's arms to its firing
   grip and stock after the animation, rather than playing a rifle hold
   with empty hands. Rotations alone keep the sleeves and forearms whole. */
import * as THREE from 'three';

export function createMountedWeaponPose(root, bones, socket, socketL, gun, anchors) {
  if (!socket || !socketL || !anchors.grip || !anchors.offhand) return null;
  const arms = ['r', 'l'].map((side) => ({
    side, upper: bones['upperarm_' + side], fore: bones['forearm_' + side], hand: bones['hand_' + side],
    socket: side === 'r' ? socket : socketL,
    point: new THREE.Vector3().fromArray(side === 'r' ? anchors.grip : anchors.offhand),
  }));
  if (arms.some((a) => !a.upper || !a.fore || !a.hand)) return null;
  // The shared rifle socket pitches the gripped bar towards the muzzle.
  // The MG's pistol grip is upright. Recover the right hand's grip axis
  // from its palm offset and turn that axis upright about the grip centre.
  const palm = socket.position.clone().setY(0).normalize();
  const gripAxis = new THREE.Vector3(0, 1, 0).cross(palm).normalize().applyQuaternion(socket.quaternion.clone().invert());
  const pistolFrame = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(gripAxis, new THREE.Vector3(0, 1, 0)));
  const saved = arms.flatMap((a) => [a.upper, a.fore, a.hand].map((b) => [b, b.quaternion.clone()]));
  let posed = false;
  const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3(), wrist = new THREE.Vector3();
  const direction = new THREE.Vector3(), bend = new THREE.Vector3(), wantedElbow = new THREE.Vector3();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), joint = new THREE.Vector3();
  const delta = new THREE.Quaternion(), rotation = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  const handMatrix = new THREE.Matrix4(), targetMatrix = new THREE.Matrix4(), invSocket = new THREE.Matrix4();
  const targetRotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function turn(bone, child, target) {
    bone.getWorldPosition(joint);
    child.getWorldPosition(to).sub(joint).normalize();
    from.copy(target).sub(joint).normalize();
    delta.setFromUnitVectors(to, from);
    bone.getWorldQuaternion(rotation).premultiply(delta);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(parentQ).invert().multiply(rotation));
    bone.updateMatrixWorld(true);
  }

  return {
    // AnimationMixer can skip an unchanged key. Restore its unmodified pose
    // before each update so this frame's IK never accumulates on the last.
    restore() {
      if (!posed) return;
      for (const [bone, q] of saved) bone.quaternion.copy(q);
      posed = false;
    },
    update() {
      for (const [bone, q] of saved) q.copy(bone.quaternion);
      root.updateMatrixWorld(true);
      gun.updateWorldMatrix(true, false);
      for (const a of arms) {
        a.socket.updateMatrix();
        invSocket.copy(a.socket.matrix).invert();
        targetMatrix.makeTranslation(a.point.x, a.point.y, a.point.z);
        if (a.side === 'r') targetMatrix.multiply(pistolFrame);
        targetMatrix.premultiply(gun.matrixWorld);
        handMatrix.multiplyMatrices(targetMatrix, invSocket);
        handMatrix.decompose(wrist, targetRotation, scale);
        a.upper.getWorldPosition(shoulder);
        a.fore.getWorldPosition(elbow);
        const upperLength = shoulder.distanceTo(elbow);
        const foreLength = elbow.distanceTo(a.hand.getWorldPosition(from));
        direction.copy(wrist).sub(shoulder);
        const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(upperLength - foreLength) + 1e-5, upperLength + foreLength - 1e-5);
        direction.normalize();
        // Elbows below and outside the torso, with a stable pole while the
        // weapon traverses. The bend follows the gun, not the camera.
        gun.getWorldQuaternion(rotation);
        bend.set(a.side === 'l' ? 1 : -1, -0.8, -0.35).applyQuaternion(rotation);
        bend.addScaledVector(direction, -bend.dot(direction)).normalize();
        if (bend.lengthSq() < 1e-6) bend.crossVectors(direction, up).normalize();
        const along = (upperLength * upperLength - foreLength * foreLength + distance * distance) / (2 * distance);
        const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
        wantedElbow.copy(shoulder).addScaledVector(direction, along).addScaledVector(bend, height);
        turn(a.upper, a.fore, wantedElbow);
        turn(a.fore, a.hand, wrist);
        a.hand.quaternion.copy(a.hand.parent.getWorldQuaternion(parentQ).invert().multiply(targetRotation));
        a.hand.updateMatrixWorld(true);
      }
      posed = true;
    },
  };
}
