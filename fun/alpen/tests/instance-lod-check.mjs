// Run with: node tests/instance-lod-check.mjs
import assert from 'node:assert/strict';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { distancePrefix, bindDistancePrefix } from '../js/instance-lod.js';

const identity = new THREE.Matrix4();
const transform = new THREE.Matrix4().compose(new THREE.Vector3(40, 12, -80),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.6, -0.2)),
  new THREE.Vector3(0.8, 1.2, 1.4));
const matrices = new Float32Array(64 * 16);
const matrix = new THREE.Matrix4(), foot = new THREE.Vector3();
let state = 714;
const random = () => ((state = Math.imul(state, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32;
for (let run = 0; run < 200; run++) {
  for (let i = 0; i < 64; i++) {
    matrix.makeTranslation((random() - 0.5) * 900, random() * 100, (random() - 0.5) * 900);
    matrix.toArray(matrices, i * 16);
  }
  for (const model of [identity, transform]) for (const count of [0, 1, 16, 64]) {
    const x = (random() - 0.5) * 600, z = (random() - 0.5) * 600;
    const prefix = distancePrefix(matrices, count, model.elements, x, z, 220);
    let expected = 0;
    for (let i = 0; i < count; i++) {
      foot.set(matrices[i * 16 + 12], matrices[i * 16 + 13], matrices[i * 16 + 14])
        .applyMatrix4(model);
      if (Math.hypot(foot.x - x, foot.z - z) < 220) expected = i + 1;
    }
    assert.equal(prefix, expected, 'retain every instance whose foot can survive the production LOD');
  }
}

const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 5);
for (const [i, x] of [0, 100, 219.5, 220, 220.03].entries()) mesh.setMatrixAt(i, matrix.makeTranslation(x, 0, 0));
const snapshot = mesh.instanceMatrix.array.slice();
const version = mesh.instanceMatrix.version;
const camera = new THREE.PerspectiveCamera();
camera.updateMatrixWorld();
let before = 0, after = 0;
mesh.onBeforeRender = function () { assert.equal(this.count, 5); before++; };
mesh.onAfterRender = function () { assert.equal(this.count, 5); after++; };
const shadow = mesh.onBeforeShadow;
bindDistancePrefix(mesh, 220);
for (const [x, expected] of [[0, 4], [350, 5], [-400, 0], [0, 4]]) {
  camera.position.x = x;
  camera.updateMatrixWorld();
  mesh.onBeforeRender(null, null, camera);
  assert.equal(mesh.count, expected, 'draw the conservative prefix for each camera');
  mesh.onAfterRender();
  assert.equal(mesh.count, 5, 'restore the full pool for streaming and the next camera');
}
mesh.position.z = camera.position.z = -80000;
mesh.updateMatrixWorld(); camera.updateMatrixWorld();
mesh.onBeforeRender(null, null, camera);
assert.equal(mesh.count, 5, 'retain an extra precision guard on a long descent');
mesh.onAfterRender();
assert.equal(mesh.onBeforeShadow, shadow, 'leave shadow selection intact');
assert.equal(before, 5); assert.equal(after, 5);
assert.equal(mesh.instanceMatrix.version, version, 'no GPU upload');
assert.deepEqual(mesh.instanceMatrix.array, snapshot, 'no matrix rewrites');
mesh.geometry.dispose(); mesh.material.dispose();
console.log('Instance LOD: 1600 layouts, transformed parents, cutoff, cameras, shadows and zero uploads passed');
