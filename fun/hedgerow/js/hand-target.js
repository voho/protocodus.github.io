/* Fit a hand socket to a carried prop without stretching either arm bone.
   Character restores the animation's original arm pose before each frame;
   this solver is only the temporary layer applied after the shoulders move. */
import * as THREE from 'three';

export function createHandTarget(root, bones, socket, side = 'l') {
  const upper = bones['upperarm_' + side], fore = bones['forearm_' + side], hand = bones['hand_' + side];
  if (!upper || !fore || !hand || !socket) return null;
  const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3(), wrist = new THREE.Vector3();
  const from = new THREE.Vector3(), direction = new THREE.Vector3(), bend = new THREE.Vector3(), wantedElbow = new THREE.Vector3();
  const joint = new THREE.Vector3(), to = new THREE.Vector3(), delta = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion(), targetQ = new THREE.Quaternion(), currentQ = new THREE.Quaternion();
  const matrix = new THREE.Matrix4(), inverseSocket = new THREE.Matrix4(), scale = new THREE.Vector3();
  function turn(bone, child, target) {
    bone.getWorldPosition(joint); child.getWorldPosition(to).sub(joint).normalize();
    from.copy(target).sub(joint).normalize(); delta.setFromUnitVectors(to, from);
    bone.getWorldQuaternion(rotation).premultiply(delta);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(parentQ).invert().multiply(rotation)); bone.updateMatrixWorld(true);
  }
  return {
    update(object, weight) {
      if (!object || !(weight > 0)) return;
      weight = Math.min(1, weight);
      root.updateMatrixWorld(true); object.updateWorldMatrix(true, false); socket.updateMatrix();
      inverseSocket.copy(socket.matrix).invert(); matrix.multiplyMatrices(object.matrixWorld, inverseSocket);
      matrix.decompose(wrist, targetQ, scale);
      hand.getWorldPosition(from); wrist.lerpVectors(from, wrist, weight);
      hand.getWorldQuaternion(currentQ); currentQ.slerp(targetQ, weight); targetQ.copy(currentQ);
      upper.getWorldPosition(shoulder); fore.getWorldPosition(elbow); hand.getWorldPosition(from);
      const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(from);
      direction.copy(wrist).sub(shoulder);
      const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + 1e-5, a + b - 1e-5);
      direction.normalize(); wrist.copy(shoulder).addScaledVector(direction, distance);
      bend.set(side === 'l' ? 1 : -1, -.8, -.35).applyQuaternion(root.quaternion);
      bend.addScaledVector(direction, -bend.dot(direction)).normalize();
      if (bend.lengthSq() < 1e-6) bend.crossVectors(direction, THREE.Object3D.DEFAULT_UP).normalize();
      const along = (a * a - b * b + distance * distance) / (2 * distance);
      wantedElbow.copy(shoulder).addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
      turn(upper, fore, wantedElbow); turn(fore, hand, wrist);
      hand.quaternion.copy(hand.parent.getWorldQuaternion(parentQ).invert().multiply(targetQ)); hand.updateMatrixWorld(true);
    },
  };
}
