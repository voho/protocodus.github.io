// Run with: node tests/trail-clods-check.mjs
// Compare live production instance buffers with the original quaternion path.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { TRAIL } from '../js/config.js';
import { heightAt, normalFrom, guideAt, getTerrainMaterialAt } from '../js/terrain.js';
import { setWorldSeed, getWorldSeed } from '../js/noise.js';
import { Rider, CLEAN } from '../js/rider.js';
import { createSpray } from '../js/particles.js';

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

// A real 180 changes the board frame, not the direction a turn loads the snow.
// Follow the committed trail sections and the public particle positions, so
// the visual consequence is checked independently of the sign conversions.
{
  const previousSeed = getWorldSeed(), savedWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  const neutral = { turn: 0, turnIntent: 0, tuck: false, brake: false,
    jump: false, trickGrab: false, trickFlip: false };
  const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('      const yawStep = trueYaw + rider.yawGlide - stepFromYaw;');
  const end = main.indexOf('      const flipStep', start);
  assert(start >= 0 && end > start, 'use the actual displayed yaw interpolation');
  const interpolate = new Function('rider', 'trueYaw', 'stepFromYaw', 'stepAlpha', 'TAU', main.slice(start, end));
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, .1, 1000), wind = new THREE.Vector3();
  const plume = createSpray(THREE), geometry = plume.points.geometry;
  const plumeSide = (state, rider, right) => {
    plume.clear();
    // Repeated normal sections reduce the emitter's random fan variance;
    // the actual real section supplies every shape, pressure and direction.
    for (let i = 0; i < 40; i++) plume.edgeSample(rider.pos.x, rider.pos.y, rider.pos.z, state, rider);
    const before = geometry.attributes.position.array.slice(), anchor = plume.points.position.clone();
    camera.position.copy(rider.pos).add(new THREE.Vector3(0, 3, 6));
    plume.update(1 / 120, camera, wind);
    let total = 0;
    for (let j = 0; j < geometry.drawRange.count; j++) {
      const i = geometry.index.array[j] * 3;
      const delta = new THREE.Vector3(
        geometry.attributes.position.array[i] + plume.points.position.x - before[i] - anchor.x,
        geometry.attributes.position.array[i + 1] + plume.points.position.y - before[i + 1] - anchor.y,
        geometry.attributes.position.array[i + 2] + plume.points.position.z - before[i + 2] - anchor.z,
      );
      total += delta.dot(right) * 120;
    }
    assert(geometry.drawRange.count > 30, 'sample a live plume, not an empty pool');
    return total / geometry.drawRange.count;
  };
  try {
    setWorldSeed('ALPEN01');
    for (const switchRide of [false, true]) {
      randomState = 0x5148;
      Math.random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState / 0x100000000;
      };
      const world = { height: heightAt, surfaceAt: getTerrainMaterialAt, canStall: () => false };
      const r = new Rider(THREE, world); r.reset(-250, guideAt(-250));
      const tracks = createTrail(THREE, { apply: m => m });
      const stepFrom = r.pos.clone(), truePos = r.pos.clone();
      let landing, desiredSide = 0, settled = false, checked = 0, lastSection;
      r.on('land', value => { landing = value; });
      const frame = control => {
        let fromYaw;
        for (let k = 0; k < 2; k++) {
          stepFrom.copy(r.pos); fromYaw = r.yaw + r.yawGlide;
          r.step(1 / 120, control);
        }
        const trueYaw = r.yaw; truePos.copy(r.pos);
        r.pos.copy(stepFrom); interpolate(r, trueYaw, fromYaw, 0, Math.PI * 2);
        tracks.update(r, 1 / 60, (x, y, z, state) => {
          if (!settled) return;
          const right = new THREE.Vector3(state.travelX, state.travelY, state.travelZ)
            .normalize().cross(new THREE.Vector3(state.normalX, state.normalY, state.normalZ)).normalize();
          const axis = new THREE.Vector3(state.latX, state.latY, state.latZ).dot(right);
          assert(state.bite > .1, 'the checked carve really loads an edge');
          assert(state.bias * axis * desiredSide > 0,
            `the dominant groove follows the actual turn: switch=${switchRide}, turn=${desiredSide}, bias=${state.bias}, axis=${axis}`);
          assert(state.contactShift * axis * desiredSide < -.05, 'the carrier offsets behind its loaded groove');
          lastSection = { state: { ...state }, right }; checked++;
        });
        r.pos.copy(truePos); r.yaw = trueYaw;
      };
      for (let i = 0; i < 120; i++) frame(neutral);
      for (let i = 0; i < 30; i++) frame({ ...neutral, jump: true });
      frame(neutral);
      for (let i = 0; i < 240 && r.state === 'air'; i++) {
        const turn = switchRide && r.airTime < .55 ? 1 : 0;
        frame({ ...neutral, turn, turnIntent: turn });
      }
      assert.equal(landing?.verdict, CLEAN); assert.equal(landing.halfTurns, switchRide ? 1 : 0);
      assert.equal(r.switchStance, switchRide);
      for (let i = 0; i < 48; i++) frame(neutral);
      for (const side of [1, -1]) {
        desiredSide = side; checked = 0;
        for (let i = 0; i < (side > 0 ? 45 : 60); i++) {
          settled = i >= 30;
          frame({ ...neutral, turn: side, turnIntent: side });
        }
        assert(checked > 15, 'verify a sustained carve across spatial trail commits');
        assert(plumeSide(lastSection.state, r, lastSection.right) * side > .5,
          'the emitted plume travels towards the same loaded side');
      }
    }

    // If a stroke retains its old lateral axis while the board turns round,
    // the loaded-edge fallback is still converted exactly once. Zero brake
    // side deliberately reaches that fallback; real lateral slip wins first.
    for (const lateral of [0, -3]) {
      const tracks = createTrail(THREE, { apply: m => m });
      const r = { pos: new THREE.Vector3(), vel: new THREE.Vector3(lateral, 0, -20),
        normal: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(-1, 0, 0),
        state: 'ride', grounded: true, speed: 20, boardForward: 20,
        switchStance: true, slide: 6, brake: .5, brakeSide: 0,
        edge: .3, carveLoad: 1, balance: 1, gLoad: 1.5 };
      tracks.update(r, 1 / 60);
      r.right.x = 1; r.switchStance = false;
      let state;
      for (let i = 0; i < 5; i++) {
        r.pos.z -= .7;
        tracks.update(r, 1 / 60, (x, y, z, value) => { state = { ...value }; });
      }
      assert(state.latX < -.8, 'the stroke retains its original axis');
      assert(state.bias * state.latX * (lateral ? -1 : 1) > .1,
        'true board slip wins, otherwise the loaded edge is converted once');
    }

    // A retained trail axis can point either way after a landing. When an
    // interpolated bias is zero, edge/brake are travel-signed but real slip
    // is board-signed; reversing the carrier must not reverse the plume.
    for (const switched of [false, true]) for (const axis of [-1, 1]) {
      const boardRight = switched ? -1 : 1;
      const r = { pos: new THREE.Vector3(), heading: new THREE.Vector3(0, 0, switched ? 1 : -1),
        right: new THREE.Vector3(boardRight, 0, 0), switchStance: switched, boardForward: 20 };
      const state = { latX: axis, latY: 0, latZ: 0, normalX: 0, normalY: 1, normalZ: 0,
        travelX: 0, travelY: 0, travelZ: -20, bite: .6, wash: .2, brake: .2,
        load: 1, chatter: 0, half: .155, contactShift: 0, bias: 0 };
      for (const [edge, lateral, brakeSide, expected] of [
        [.3, 0, 0, 1], [0, 2, -1, boardRight], [0, 0, -1, -1],
      ]) {
        Object.assign(r, { edge, lateral, brakeSide });
        assert(plumeSide(state, r, new THREE.Vector3(1, 0, 0)) * expected > .5,
          'zero-bias fallback preserves the frame of its chosen signal');
      }
    }
    console.log('Trail/spray direction: real clean 180, regular/switch carves both ways, contact offsets and zero-bias edge/slip/brake fallbacks passed.');
  } finally {
    Math.random = oldRandom; globalThis.window = savedWindow; setWorldSeed(previousSeed);
  }
}
