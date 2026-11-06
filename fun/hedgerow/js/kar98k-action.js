/* The captured rifle's original bolt parts, articulated without replacing
   their baked texture or altering the shared GLB. Only the player's rifle
   uses this split; distant soldiers keep the original single draw. */
import * as THREE from 'three';
import { KAR98K_ACTION_TIMING } from './weapon-action-timing.js';

const prepared = new WeakMap();
const PIVOT = new THREE.Vector3(0, .05, -.004);
const KNOB = new THREE.Vector3(-.054, .016, -.011);
const BOLT_AXIS = new THREE.Vector3(0, 0, 1);
const TRAVEL = .095;
export const BOLT_CYCLE_DURATION = .95;
const ease = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

// UV seams duplicate vertices in the shipped atlas. Join positions for
// connected-part discovery, but preserve every original vertex attribute
// when selecting faces. The handle, knob, shroud and safety are four
// separate authored solids; receiver, stock and sights stay stationary.
function parts(geometry) {
  const position = geometry.attributes.position, parent = Array.from({ length: position.count }, (_, i) => i);
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { parent[root(a)] = root(b); };
  const coordinates = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
    if (coordinates.has(key)) join(i, coordinates.get(key)); else coordinates.set(key, i);
  }
  const count = geometry.index?.count ?? position.count;
  const at = i => geometry.index ? geometry.index.getX(i) : i;
  for (let i = 0; i < count; i += 3) { join(at(i), at(i + 1)); join(at(i), at(i + 2)); }
  const bounds = new Map();
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const id = root(i);
    if (!bounds.has(id)) bounds.set(id, new THREE.Box3());
    bounds.get(id).expandByPoint(point.fromBufferAttribute(position, i));
  }
  const kinds = new Map(); let moving = 0;
  for (const [id, { min, max }] of bounds) {
    const handle = min.x < -.03 && min.x > -.066 && max.x < -.008
      && min.y > .003 && max.y < .058 && min.z > -.023 && max.z < .01;
    const shroud = min.x > -.013 && max.x < .013 && min.y > .036
      && max.y < .073 && min.z > -.080 && max.z < -.039;
    const kind = handle ? 'handle' : shroud ? 'shroud' : 'static';
    kinds.set(id, kind); if (kind !== 'static') moving++;
  }
  const faces = { static: [], handle: [], shroud: [] };
  for (let i = 0; i < count; i += 3) faces[kinds.get(root(at(i)))].push(at(i), at(i + 1), at(i + 2));
  return { faces, moving };
}

function select(geometry, indices) {
  const vertices = [...new Set(indices)], remap = new Map(vertices.map((v, i) => [v, i]));
  const out = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const array = new attribute.array.constructor(vertices.length * attribute.itemSize);
    for (const [i, original] of vertices.entries()) {
      for (let k = 0; k < attribute.itemSize; k++) array[i * attribute.itemSize + k] = attribute.getComponent(original, k);
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  out.setIndex(indices.map(i => remap.get(i)));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

export function articulatedKar98kModel(model) {
  if (model?.name !== 'kar98k') return model;
  if (prepared.has(model)) return prepared.get(model);
  const groups = model.prims.map(primitive => ({ primitive, ...parts(primitive.geometry) }));
  // Keep an unfamiliar replacement model intact. The asset check verifies
  // that the shipped rifle has exactly the four intended moving solids.
  if (groups.reduce((sum, group) => sum + group.moving, 0) !== 4) {
    prepared.set(model, model); return model;
  }
  const prims = [];
  for (const { primitive, faces } of groups) {
    for (const [kind, indices] of Object.entries(faces)) {
      if (indices.length) prims.push({ ...primitive, geometry: select(primitive.geometry, indices),
        node: kind === 'static' ? primitive.node : `kar98k_bolt_${kind}` });
    }
  }
  const result = { ...model, prims };
  prepared.set(model, result);
  return result;
}

export function createKar98kMechanism(gun) {
  const handles = [], shrouds = [];
  gun?.traverse(o => {
    if (o.name === 'kar98k_bolt_handle') handles.push(o);
    if (o.name === 'kar98k_bolt_shroud') shrouds.push(o);
  });
  if (!handles.length || !shrouds.length) return null;
  const handle = new THREE.Group(); handle.name = 'kar98k_bolt'; handle.position.copy(PIVOT); gun.add(handle);
  for (const mesh of handles) { handle.add(mesh); mesh.position.copy(PIVOT).negate(); }
  const point = new THREE.Vector3();
  let grip = 0, angle = 0;
  function set(time, reloading = false) {
    let unlock = 0, pull = 0;
    grip = 0;
    if (time >= 0 && Number.isFinite(time)) {
      if (reloading) {
        const p = KAR98K_ACTION_TIMING.reload;
        unlock = ease(.05, p.lift, time) * (1 - ease(p.push, p.lock, time));
        pull = ease(p.lift, p.pull, time) * (1 - ease(p.push - .18, p.push, time));
        grip = Math.max(ease(.01, .12, time) * (1 - ease(p.pull, .44, time)),
          ease(p.push - .25, p.push - .1, time) * (1 - ease(p.lock, p.lock + .18, time)));
      } else {
        const p = KAR98K_ACTION_TIMING.shot;
        unlock = ease(p.liftPull - .15, p.liftPull, time) * (1 - ease(p.push, p.lock, time));
        pull = ease(p.liftPull, p.liftPull + .13, time) * (1 - ease(p.push - .10, p.push, time));
        grip = ease(.10, .27, time) * (1 - ease(p.lock, BOLT_CYCLE_DURATION, time));
      }
    }
    angle = -Math.PI * .5 * unlock;
    handle.position.copy(PIVOT); handle.position.z -= pull * TRAVEL; handle.rotation.z = angle;
    for (const mesh of shrouds) mesh.position.z = -pull * TRAVEL;
    return grip;
  }
  return {
    set,
    get angle() { return angle; },
    get grip() { return grip; },
    gripPoint(out) {
      point.copy(KNOB).sub(PIVOT).applyAxisAngle(BOLT_AXIS, angle);
      return out.copy(point).add(handle.position);
    },
  };
}

/* The left hand continues to support the forend while the right hand
   leaves the grip and follows the bolt. Freeze the gun in the soldier's
   root space after his normal shouldered pose, then solve the right arm
   with rotations only. Restore before AnimationMixer's next held key. */
export function createKar98kActionPose(root, bones, socket, gun) {
  const mechanism = createKar98kMechanism(gun);
  if (!mechanism) return null;
  const upper = bones.upperarm_r, fore = bones.forearm_r, hand = bones.hand_r;
  const saved = [upper, fore, hand].filter(Boolean).map(bone => [bone, bone.quaternion.clone()]);
  const gunPosition = gun.position.clone(), gunQuaternion = gun.quaternion.clone(), gunScale = gun.scale.clone();
  const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3(), wrist = new THREE.Vector3();
  const direction = new THREE.Vector3(), bend = new THREE.Vector3(), wantedElbow = new THREE.Vector3();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), joint = new THREE.Vector3(), gripPoint = new THREE.Vector3();
  const delta = new THREE.Quaternion(), rotation = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  const targetRotation = new THREE.Quaternion(), currentRotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const handMatrix = new THREE.Matrix4(), targetMatrix = new THREE.Matrix4(), invSocket = new THREE.Matrix4();
  const gunMatrix = new THREE.Matrix4();
  let posed = false;

  function restore() {
    if (!posed) return;
    for (const [bone, quaternion] of saved) bone.quaternion.copy(quaternion);
    socket.add(gun); gun.position.copy(gunPosition); gun.quaternion.copy(gunQuaternion); gun.scale.copy(gunScale);
    posed = false;
  }
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
    mechanism, restore,
    reset() { restore(); mechanism.set(-1); },
    update(time, reloading = false) {
      const weight = mechanism.set(time, reloading);
      if (weight < 1e-5 || !upper || !fore || !hand || !socket) return;
      for (const [bone, quaternion] of saved) quaternion.copy(bone.quaternion);
      root.updateMatrixWorld(true); gun.updateWorldMatrix(true, true);
      // Reparent with its current world matrix: moving the bolt hand must
      // not pull the whole rifle through the supporting left hand.
      gunMatrix.copy(root.matrixWorld).invert().multiply(gun.matrixWorld);
      root.add(gun); gunMatrix.decompose(gun.position, gun.quaternion, gun.scale); gun.updateMatrixWorld(true);
      posed = true;
      socket.updateMatrix(); invSocket.copy(socket.matrix).invert();
      mechanism.gripPoint(gripPoint);
      targetMatrix.makeTranslation(gripPoint.x, gripPoint.y, gripPoint.z);
      // The rifle socket already aligns the palm's grip. Rotating that
      // whole frame through the bolt's quarter turn also rotates its long
      // palm offset, drawing the wrist/forearm back across the eye.
      targetMatrix.premultiply(gun.matrixWorld);
      handMatrix.multiplyMatrices(targetMatrix, invSocket);
      handMatrix.decompose(wrist, targetRotation, scale);
      hand.getWorldPosition(from); wrist.lerpVectors(from, wrist, weight);
      hand.getWorldQuaternion(currentRotation); currentRotation.slerp(targetRotation, weight); targetRotation.copy(currentRotation);
      upper.getWorldPosition(shoulder); fore.getWorldPosition(elbow); hand.getWorldPosition(from);
      const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(from);
      direction.copy(wrist).sub(shoulder);
      const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + 1e-5, a + b - 1e-5);
      direction.normalize(); wrist.copy(shoulder).addScaledVector(direction, distance);
      bend.set(-1, -.85, -.25).applyQuaternion(root.quaternion);
      bend.addScaledVector(direction, -bend.dot(direction)).normalize();
      if (bend.lengthSq() < 1e-6) bend.crossVectors(direction, BOLT_AXIS).normalize();
      const along = (a * a - b * b + distance * distance) / (2 * distance);
      const height = Math.sqrt(Math.max(0, a * a - along * along));
      wantedElbow.copy(shoulder).addScaledVector(direction, along).addScaledVector(bend, height);
      turn(upper, fore, wantedElbow); turn(fore, hand, wrist);
      hand.quaternion.copy(hand.parent.getWorldQuaternion(parentQ).invert().multiply(targetRotation)); hand.updateMatrixWorld(true);
    },
  };
}
