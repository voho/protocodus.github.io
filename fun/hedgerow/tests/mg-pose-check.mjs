// Run with: node fun/hedgerow/tests/mg-pose-check.mjs
// Use the shipped soldier and mounted MG42. Both grips must remain in the
// hands through breathing, pose transitions and the full traverse, with no
// limb stretching or accumulated IK; death must release the gun.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const THREE = await import('three');
const { GLTFLoader } = await import('../assets/vendor/GLTFLoader.js');
const { createCharacter } = await import('../js/character.js');
const { readSet } = await import('../js/assets.js');

async function parse(name) {
  const b = readFileSync(new URL(`../assets/models/${name}.glb`, import.meta.url));
  const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString());
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials || []) {
    for (const k of ['baseColorTexture', 'metallicRoughnessTexture']) delete m.pbrMetallicRoughness?.[k];
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
  for (const k of ['extensionsUsed', 'extensionsRequired']) {
    j[k] = (j[k] || []).filter((e) => e !== 'EXT_texture_webp');
    if (!j[k].length) delete j[k];
  }
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const bin = b.subarray(20 + jl), head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length + bin.length, 8);
  head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, json, bin]);
  return new Promise((resolve, reject) => new GLTFLoader().parse(out.buffer.slice(out.byteOffset, out.byteOffset + out.length), '', resolve, reject));
}
const rig = await parse('soldier'), models = new Map();
readSet(await parse('weapons'), 'weapons', models);
const mg = models.get('mg42');
const matlib = { get: () => new THREE.MeshBasicMaterial(), resolve: (m) => m };
const xyz = new THREE.Vector3(), expected = new THREE.Vector3();
let worst = 0;

// Exact mount/gunner offsets from the nest and bunker model anchors, as
// resolved by levelBuild.js; translated and turned to exercise world space.
for (const [name, mount, gunner] of [
  ['nest', [0, 0.9232, 1.7596], [0, 0, 0.7596]],
  ['bunker', [-0.0059, 1.155, 2.2716], [-0.0059, 0.05, 1.5216]],
]) {
  const scene = new THREE.Scene(), gun = new THREE.Group();
  scene.add(gun); gun.position.fromArray(mount).add(new THREE.Vector3(8, 2, -4));
  const ch = createCharacter(rig, matlib, { outfit: 'axis', scene }); scene.add(ch.root);
  const offset = new THREE.Vector3().fromArray(gunner).sub(new THREE.Vector3().fromArray(mount));
  offset.x += 0.14; offset.z -= 0.08; // right shoulder seated behind the butt, as in ai.js
  ch.holdMountedWeapon(gun, mg.anchors);
  const ready = name === 'nest' ? 'mg_ready' : 'idle';
  ch.animate(ready, 'crouch_idle');
  for (let frame = 0; frame < 360; frame++) {
    const yaw = 1.2 + Math.sin(frame / 40) * 0.9;
    gun.rotation.y = yaw; gun.updateMatrixWorld(true);
    ch.root.position.copy(offset).applyMatrix4(gun.matrixWorld); ch.root.rotation.y = yaw;
    ch.update(1 / 60, 0);
    for (const [side, socket, anchor] of [['r', ch.socket, mg.anchors.grip], ['l', ch.socketL, mg.anchors.offhand]]) {
      const error = socket.getWorldPosition(xyz).distanceTo(gun.localToWorld(expected.fromArray(anchor)));
      worst = Math.max(worst, error);
      assert.ok(error < 0.002, `${name} ${side} hand misses its grip by ${(error * 100).toFixed(2)} cm at frame ${frame}`);
      const b = ch.bones;
      const upper = b['upperarm_' + side].getWorldPosition(new THREE.Vector3());
      const elbow = b['forearm_' + side].getWorldPosition(new THREE.Vector3());
      const wrist = b['hand_' + side].getWorldPosition(new THREE.Vector3());
      assert.ok(Math.abs(upper.distanceTo(elbow) - 0.29) < 1e-5, 'upper arm keeps its length');
      assert.ok(Math.abs(elbow.distanceTo(wrist) - 0.25) < 1e-5, 'forearm keeps its length');
      assert.ok(elbow.y < upper.y + 0.08, `${name} ${side} elbow ${(elbow.y - upper.y).toFixed(3)}m above shoulder frame ${frame}`);
    }
  }
  const standingHead = ch.headWorld().y;
  if (name === 'nest') assert.ok(standingHead - gun.position.y < 0.65, 'the sandbag gunner bends his knees to bring his eye down towards the stock');
  ch.mountedGrip = false;
  ch.animate('crouch_idle', 'crouch_idle');
  for (let i = 0; i < 60; i++) ch.update(1 / 60, 0);
  assert.ok(ch.headWorld().y < standingHead - 0.3, 'suppression can duck the gunner behind the mount');
  assert.ok(ch.socket.getWorldPosition(xyz).distanceTo(gun.localToWorld(expected.fromArray(mg.anchors.grip))) > 0.15, 'ducking releases the mounted grip');
  ch.mountedGrip = true;
  ch.animate(ready, 'crouch_idle');
  for (let i = 0; i < 60; i++) ch.update(1 / 60, 0);
  for (const [socket, anchor] of [[ch.socket, mg.anchors.grip], [ch.socketL, mg.anchors.offhand]]) {
    assert.ok(socket.getWorldPosition(xyz).distanceTo(gun.localToWorld(expected.fromArray(anchor))) < 0.002, 'standing back up regrips the gun');
  }
  ch.die('death_back');
  for (let i = 0; i < 120; i++) ch.update(1 / 60, 0);
  assert.ok(ch.socket.getWorldPosition(xyz).distanceTo(gun.localToWorld(expected.fromArray(mg.anchors.grip))) > 0.15, 'death releases the mounted gun');
}
console.log(`mg-pose-check: both hands hold the mounted MG42 through traverse; arm lengths fixed; death releases it (worst grip error ${(worst * 1000).toFixed(3)} mm)`);
