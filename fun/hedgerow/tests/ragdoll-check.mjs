// Run with: node fun/hedgerow/tests/ragdoll-check.mjs
// A soldier shot standing falls under his own weight: the ragdoll comes to
// rest on the ground, lies there (pelvis low, nothing under the ground, no
// NaN), keeps its limbs their length, goes to sleep, and the push of the
// shot moves him the way it came from.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createRagdoll } = await import('../js/ragdoll.js');
const { createCharacter } = await import('../js/character.js');

// a standing rig, bones pointing along +Y (as the game's rig does)
const bones = {};
function bone(name, parent, x, y, z, pointDown = false) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  if (pointDown) b.rotation.z = Math.PI;      // +Y of arm and leg bones points down
  (parent ? bones[parent] : rootObj).add(b);
  bones[name] = b;
  return b;
}
const rootObj = new THREE.Group();
bone('root', null, 0, 0, 0);
bone('hips', 'root', 0, 1.0, 0);
bone('spine', 'hips', 0, 0.12, 0);
bone('chest', 'spine', 0, 0.2, 0);
bone('neck', 'chest', 0, 0.25, 0);
bone('head', 'neck', 0, 0.1, 0);
for (const [s, x] of [['l', 0.2], ['r', -0.2]]) {
  bone(`upperarm_${s}`, 'chest', x, 0.18, 0, true);
  bone(`forearm_${s}`, `upperarm_${s}`, 0, 0.3, 0);
  bone(`hand_${s}`, `forearm_${s}`, 0, 0.27, 0);
  bone(`thigh_${s}`, 'hips', x * 0.5, -0.05, 0, true);
  bone(`shin_${s}`, `thigh_${s}`, 0, 0.45, 0);
  bone(`foot_${s}`, `shin_${s}`, 0, 0.45, 0);
}
rootObj.updateMatrixWorld(true);
const standingRig = rootObj.clone();

const world = { groundAt: () => 0, pushOut: () => false };
const shotFrom = new THREE.Vector3(0, 0, -10);          // shot from behind (-z): falls towards +z
const rd = createRagdoll(bones, world, { root: rootObj, impulses: [{ part: 'body', vel: new THREE.Vector3(0, 0.4, 3.4) }] });
assert.ok(rd, 'a ragdoll is built from the rig');

const lengths = (ps) => [['shoulder_l', 'elbow_l'], ['hip_r', 'knee_r'], ['knee_r', 'ankle_r'], ['pelvis', 'spine']];
const start = rd.positions.map((p) => p.clone());
let t = 0;
while (t < 6 && !rd.asleep) { rd.step(1 / 60); rd.pose(); t += 1 / 60; }

for (const p of rd.positions) {
  assert.ok(Number.isFinite(p.x + p.y + p.z), 'no NaN');
  assert.ok(p.y > -0.01, `a particle is under the ground: y = ${p.y.toFixed(3)}`);
}
assert.ok(rd.pelvis.y < 0.4, `the body lies on the ground (pelvis at ${rd.pelvis.y.toFixed(2)} m)`);
assert.ok(rd.pelvis.z > start[0].z + 0.2, `the shot pushed him away from it (pelvis moved ${(rd.pelvis.z - start[0].z).toFixed(2)} m along +z)`);
assert.ok(rd.asleep, `the body comes to rest (still moving after ${t.toFixed(1)} s)`);
// limbs keep their length (rigid sticks)
const d = (i, j) => rd.positions[i].distanceTo(rd.positions[j]);
const d0 = (i, j) => start[i].distanceTo(start[j]);
for (const [i, j] of [[6, 7], [7, 8], [14, 15], [15, 16], [0, 1]]) {
  assert.ok(Math.abs(d(i, j) - d0(i, j)) < d0(i, j) * 0.06, `segment ${i}-${j} stretched: ${d0(i, j).toFixed(3)} -> ${d(i, j).toFixed(3)}`);
}
// the bones follow the particles: the head bone ends near the head particle
const hp = bones.head.getWorldPosition(new THREE.Vector3());
assert.ok(hp.distanceTo(rd.positions[3]) < 0.2, `the head bone follows the ragdoll (${hp.distanceTo(rd.positions[3]).toFixed(2)} m off)`);

// Through the character update, the first fall and final settling frame
// must both reach the bones. Sleeping bodies keep their pose without
// rebuilding every bone matrix; their contact shadow still follows state.
{
  const ch = createCharacter({ scene: standingRig, animations: [] }, {
    get: () => new THREE.MeshBasicMaterial(), resolve: (m) => m,
  }, { scene: new THREE.Scene() });
  ch.die('death_fwd', { world, impulses: [{ part: 'body', vel: new THREE.Vector3(0, 0.4, 3.4) }] });
  const r = ch.ragdoll;
  const pose = r.pose;
  let poses = 0, finalPose = false;
  r.pose = () => { poses++; finalPose = r.asleep; pose(); };
  ch.update(1 / 60, 0);
  assert.equal(poses, 1, 'the initial falling frame is posed');
  for (let i = 0; i < 600 && !r.asleep; i++) ch.update(1 / 60, 0);
  assert.ok(r.asleep && finalPose, 'the frame that puts the body to sleep is posed');
  const before = poses;
  const snapshot = () => Object.values(ch.bones).flatMap(b => [...b.position.toArray(), ...b.quaternion.toArray()]);
  const resting = snapshot();
  for (let i = 0; i < 60; i++) {
    ch.root.visible = i % 2 === 0;
    ch.update(1 / 60, 0.5);
    assert.equal(ch.shadow.visible, ch.root.visible, 'the sleeping contact shadow follows visibility');
    assert.equal(ch.shadow.position.y, 0.53, 'the contact shadow still follows the supplied ground');
  }
  assert.equal(poses, before, 'a sleeping body does not rebuild its unchanged bone pose');
  assert.deepEqual(snapshot(), resting, 'the complete resting pose remains unchanged');
}
console.log(`ragdoll-check: falls and lies still after ${t.toFixed(1)} s, pelvis ${rd.pelvis.y.toFixed(2)} m, pushed ${(rd.pelvis.z - start[0].z).toFixed(2)} m`);
