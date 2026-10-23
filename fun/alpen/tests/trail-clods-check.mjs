// Run with: node tests/trail-clods-check.mjs
// Compare live production instance buffers with the original quaternion path.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { TRAIL } from '../js/config.js';
import { heightAt, normalFrom } from '../js/terrain.js';
import { setWorldSeed } from '../js/noise.js';

// Keep the diagnostic state out of the shipped module's API. Capture the old
// Float32 normals at the same point they were previously stored, independently
// of the baked rotation columns being checked.
const url = new URL('../js/trail.js', import.meta.url);
let source = await readFile(url, 'utf8');
const replace = (from, to) => {
  assert.ok(source.includes(from), `diagnostic hook exists: ${from}`);
  source = source.replace(from, to);
};
replace('  const clodBasis = ',
  '  let testBakes = 0; const testNormals = new Float32Array(clodCapacity * 3);\n  const clodBasis = ');
replace('  function bakeClodBasis(id) {', `  function bakeClodBasis(id) {
    testBakes++;
    testNormals.set([baseNormal.x, baseNormal.y, baseNormal.z], id * 3);`);
replace('return { mesh, points: mesh, update, clear, debug };', `return {
  mesh, points: mesh, update, clear, debug,
  testState: () => ({ now, born, clodSize, clodX, clodY, clodZ,
    clodRandA, clodRandB, clodRandC, testNormals, testBakes,
    anchorX, anchorZ }),
  refreshClods: (pos) => { clodsDue = true; updateClods(pos); },
};`);
source = source.replace(/from '(\.\/[^']+)'/g,
  (_, path) => `from '${new URL(path, url).href}'`);
const { createTrail } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const dummy = new THREE.Object3D();
const normal = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const expected = new Float32Array(TRAIL.samples * 3 * 16);

// The former production algorithm: rebuild orientation while packing every
// visible clod, including distance fade, age fade and anisotropic scaling.
function reference(s, pos, output) {
  let visible = 0;
  const lifeScale = 1 / Math.min(TRAIL.life, 4.5);
  for (let slot = 0; slot < TRAIL.samples; slot++) {
    const base = slot * 3;
    if (!(s.clodSize[base] > 0 || s.clodSize[base + 1] > 0 || s.clodSize[base + 2] > 0)) continue;
    const age = (s.now - s.born[slot]) * lifeScale;
    if (age >= 1) continue;
    const ageFade = 1 - smoothstep(0.42, 1, age);
    for (let j = 0; j < 3; j++) {
      const id = base + j;
      let scale = s.clodSize[id];
      if (scale <= 0) continue;
      const distance = Math.hypot(s.clodX[id] + s.anchorX - pos.x,
        s.clodZ[id] + s.anchorZ - pos.z);
      scale *= ageFade * (1 - smoothstep(28, 48, distance));
      if (scale <= 0.001) continue;
      dummy.position.set(s.clodX[id], s.clodY[id], s.clodZ[id]);
      normal.fromArray(s.testNormals, id * 3).normalize();
      dummy.quaternion.setFromUnitVectors(up, normal);
      dummy.rotateY(s.clodRandB[id] * Math.PI * 2);
      dummy.rotateX((s.clodRandA[id] - 0.5) * 0.24);
      dummy.rotateZ((s.clodRandC[id] - 0.5) * 0.20);
      dummy.scale.set(scale * (0.72 + s.clodRandB[id] * 0.48),
        scale * (0.12 + s.clodRandA[id] * 0.14),
        scale * (0.92 + s.clodRandC[id] * 0.62));
      dummy.updateMatrix();
      dummy.matrix.toArray(output, visible++ * 16);
    }
  }
  return visible;
}

let randomState = 0x51a7;
const oldRandom = Math.random;
Math.random = () => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
};
setWorldSeed(721);
const trail = createTrail(THREE, { apply: m => m });
const clods = trail.mesh.children.find(o => o.isInstancedMesh);
const rider = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(8, -6, -20),
  normal: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0),
  state: 'ride', grounded: true, airborne: false, speed: 22,
  boardForward: 20, slide: 6, brake: 1, brakeSide: 1,
  edge: 0.5, carveLoad: 1, balance: 0.4, gLoad: 1.7,
};
let comparisons = 0, previousComposes = 0, maxVisible = 0;
let refreshed = 0;
const check = () => {
  trail.refreshClods(rider.pos);
  const s = trail.testState();
  const n = reference(s, rider.pos, expected);
  assert.equal(clods.count, n);
  assert.deepEqual(clods.instanceMatrix.array.subarray(0, n * 16), expected.subarray(0, n * 16),
    'baked and original quaternion paths produce identical Float32 matrices');
  maxVisible = Math.max(maxVisible, n);
  previousComposes += n;
  comparisons++;
};
try {
  // More than two complete ring wraps, crossing several 128 m anchor rebases;
  // live normals and skid direction change throughout the ride.
  for (let frame = 0; frame < 1100; frame++) {
    const z = -frame * 0.4;
    const x = Math.sin(frame / 90) * 8;
    rider.pos.set(x, heightAt(x, z), z);
    normalFrom(heightAt, x, z, rider.normal);
    rider.right.set(1, 0, 0).addScaledVector(rider.normal, -rider.normal.x).normalize();
    rider.brakeSide = frame % 180 < 90 ? 1 : -1;
    trail.update(rider, 1 / 60);
    check();
    refreshed = trail.testState().testBakes;
  }
  assert.ok(maxVisible > 15, 'exercise multiple fracture clusters');
  assert.ok(previousComposes > refreshed * 2,
    `bake fewer orientations than rebuilding visible clods (${refreshed} vs ${previousComposes})`);

  // A fixed frame isolates the matrix packing cost from terrain generation.
  const snapshot = trail.testState();
  const measure = fn => {
    const samples = [];
    for (let pass = 0; pass < 7; pass++) {
      const start = performance.now();
      for (let i = 0; i < 3000; i++) fn();
      samples.push(performance.now() - start);
    }
    return samples.sort((a, b) => a - b)[3] / 3000;
  };
  const oldMs = measure(() => reference(snapshot, rider.pos, expected));
  const newMs = measure(() => trail.refreshClods(rider.pos));

  rider.state = 'air'; rider.grounded = false;
  for (let frame = 0; frame < 280; frame++) {
    trail.update(rider, 1 / 60);
    check();
  }
  assert.equal(clods.count, 0, 'all clods finish fading');
  trail.clear(); check();
  rider.state = 'ride'; rider.grounded = true;
  for (let frame = 0; frame < 100; frame++) {
    rider.pos.z -= 0.4; rider.pos.y = heightAt(rider.pos.x, rider.pos.z);
    trail.update(rider, 1 / 60); check();
  }
  assert.ok(clods.count > 0, 'cleared slots gain fresh bases when reused');
  console.log(`Trail clods: ${comparisons} identical instance buffers, ${maxVisible} visible peak; `
    + `equivalence diagnostic orientations ${previousComposes} reference / `
    + `${trail.testState().testBakes} baked (forced refresh each frame); fixed-frame packing `
    + `${oldMs.toFixed(4)} → ${newMs.toFixed(4)} ms (local CPU microbenchmark).`);
} finally {
  Math.random = oldRandom;
}
