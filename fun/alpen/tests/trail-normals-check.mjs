// Run: node tests/trail-normals-check.mjs /path/to/baseline-trail.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { heightAt, normalFrom } from '../js/terrain.js';
import { setWorldSeed } from '../js/noise.js';
import { TRAIL } from '../js/config.js';

assert.ok(process.argv[2], 'pass the actual baseline trail.js path as argument 2');
const production = new URL('../js/trail.js', import.meta.url);
async function loadTrail(path, tag) {
  let source = await readFile(path, 'utf8');
  const groundImport = "import { heightAt, drawnHeightAt } from './terrain.js';";
  assert.ok(source.includes(groundImport), 'ground diagnostic hook exists');
  source = source.replace(groundImport, [
    "import { heightAt as realHeightAt, drawnHeightAt as realDrawnHeightAt } from './terrain.js';",
    'let heightAt = realHeightAt, drawnHeightAt = realDrawnHeightAt;',
  ].join('\n'));
  const api = 'return { mesh, points: mesh, update, clear, debug };';
  assert.ok(source.includes(api), 'trail diagnostic hook exists');
  source = source.replace(api, [
    'return { mesh, update, clear, debug,',
    'benchmarkGround: () => {',
    '  heightAt = (x, z) => x * -0.12 + z * 0.3;',
    '  drawnHeightAt = heightAt;',
    '},',
    'benchmarkRewrite: () => {',
    '  write(head, lastCommitX, heightAt(lastCommitX, lastCommitZ),',
    '    lastCommitZ, currentState.half, currentState);',
    '  recomputeNormals(Math.min(count, 2));',
    '}, };',
  ].join('\n'));
  source = source.replace(/from '(\.\/[^']+)'/g,
    (_, path) => "from '" + new URL(path, production).href + "'");
  const module = await import('data:text/javascript;base64,'
    + Buffer.from(source + '\n// ' + tag).toString('base64'));
  return module.createTrail(THREE, { apply: material => material });
}

let randomState = 0x51a7;
const savedRandom = Math.random;
Math.random = () => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
};
try {
  setWorldSeed('1EE9566');
  const startState = randomState;
  const before = await loadTrail(resolve(process.argv[2]), 'baseline');
  const afterCreate = randomState;
  randomState = startState;
  const after = await loadTrail(production, 'candidate');
  assert.equal(randomState, afterCreate, 'construction preserves random calls');
  const rider = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(8, -6, -20),
    normal: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0),
    state: 'ride', grounded: true, airborne: false, speed: 22,
    boardForward: 20, slide: 6, brake: 1, brakeSide: 1,
    edge: 0.5, carveLoad: 1, balance: 0.4, gLoad: 1.7,
  };
  const beforeGeo = before.mesh.geometry, afterGeo = after.mesh.geometry;
  const oldClods = before.mesh.children.find(o => o.isInstancedMesh);
  const newClods = after.mesh.children.find(o => o.isInstancedMesh);
  let comparisons = 0, maxSamples = 0;
  const check = full => {
    for (const name of Object.keys(beforeGeo.attributes)) {
      if (full || name === 'normal') {
        assert.deepEqual(afterGeo.attributes[name].array, beforeGeo.attributes[name].array,
          name + ' buffer matches actual baseline');
        comparisons++;
      }
    }
    if (full) {
      assert.deepEqual(afterGeo.index.array, beforeGeo.index.array);
      assert.deepEqual(newClods.instanceMatrix.array, oldClods.instanceMatrix.array);
      comparisons += 2;
    }
    assert.deepEqual(after.debug(), before.debug());
    comparisons++;
  };
  for (let frame = 0; frame < 1600; frame++) {
    const z = -frame * 0.4 - (frame >= 900 ? 20 : 0) - (frame >= 1000 ? 180 : 0);
    const x = Math.sin(frame / 90) * 8;
    rider.pos.set(x, heightAt(x, z), z);
    normalFrom(heightAt, x, z, rider.normal);
    rider.right.set(1, 0, 0).addScaledVector(rider.normal, -rider.normal.x).normalize();
    rider.brakeSide = frame % 180 < 90 ? 1 : -1;
    rider.state = frame >= 700 && frame < 720 ? 'air'
      : frame >= 770 && frame < 790 ? 'fall'
        : frame >= 790 && frame < 810 ? 'rise' : 'ride';
    rider.grounded = rider.state === 'ride';
    rider.airborne = rider.state === 'air';
    rider.slide = frame % 300 < 200 ? 6 : 0.3;
    rider.brake = frame % 200 < 120 ? 1 : 0;
    if (frame === 1200) { before.clear(); after.clear(); }
    const frameState = randomState;
    before.update(rider, 1 / 60);
    const endState = randomState;
    randomState = frameState;
    after.update(rider, 1 / 60);
    assert.equal(randomState, endState, 'writing preserves random calls');
    check(frame % 30 === 0 || (frame >= 1199 && frame <= 1202));
    maxSamples = Math.max(maxSamples, after.debug().samples);
  }
  assert.equal(maxSamples, TRAIL.samples, 'exercise full ring and slot recycling');
  check(true);
  // Isolate writing CPU cost from terrain noise; finish with the real final
  // normal pass. This does not measure GPU, uploads or device frame rate.
  before.benchmarkGround(); after.benchmarkGround();
  const measure = trail => {
    const begin = performance.now();
    for (let i = 0; i < 4000; i++) trail.benchmarkRewrite();
    return (performance.now() - begin) / 4000;
  };
  for (let i = 0; i < 3; i++) { measure(before); measure(after); }
  const oldTimes = [], newTimes = [];
  for (let pass = 0; pass < 9; pass++) {
    if (pass % 2) { newTimes.push(measure(after)); oldTimes.push(measure(before)); }
    else { oldTimes.push(measure(before)); newTimes.push(measure(after)); }
  }
  const median = values => values.sort((a, b) => a - b)[4];
  const oldMs = median(oldTimes), newMs = median(newTimes);
  check(true);
  console.log('Trail normals: ' + comparisons + ' identical buffer/state checks across '
    + '1,600 frames (wrap, rebase, airborne, fall, rise, teleport, clear/reuse); '
    + 'fixed-ground CPU rewrite median ' + oldMs.toFixed(4) + ' -> '
    + newMs.toFixed(4) + ' ms. Timing is diagnostic, not a pass threshold.');
} finally { Math.random = savedRandom; }
