// Exercise the entrypoint's actual listener snapshot and reset helpers.
// Real collider rooms supply materials; no renderer or extra sweep is needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import './three-hooks.mjs';
import { acousticReflection } from '../js/audio-space.js';
import { createWorld, SHOT } from '../js/world.js';
const THREE = await import('three');
const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const start = source.indexOf('const ECHO_RAYS = '), end = source.indexOf('\n/* the title', start);
assert.ok(start >= 0 && end > start, 'the actual listener helper block exists');
const helpers = source.slice(start, end);
assert.ok(helpers.includes('function resetAcoustics()') && helpers.includes('function listenRound(dt)'));

function room(surface = 'stone', roof = null) {
  const world = createWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 120 });
  if (surface) for (const [x, z, hx, hz] of [[8, 0, .2, 8], [0, 8, 8, .2], [-8, 0, .2, 8], [0, -8, 8, .2]]) {
    world.add({ type: 'box', x, y: 1.6, z, hx, hy: 1.6, hz, surface });
  }
  if (roof) world.add({ type: 'box', x: 0, y: 3.4, z: 0, hx: 8, hy: .1, hz: 8, surface: roof });
  return world;
}
function fixture(world) {
  const queries = [], spaces = [], shelters = [], materials = [], camera = { position: new THREE.Vector3(0, 1.6, 0) };
  const raycast = world.raycast.bind(world);
  world.raycast = (...args) => { queries.push(args); return raycast(...args); };
  const context = createContext({ THREE, Float32Array, Math, camera, G: { world }, SHOT,
    acousticReflection(hit) { materials.push(hit); return acousticReflection(hit); },
    audio: { setSpace: (...args) => spaces.push(args), setShelter: value => shelters.push(value) } });
  runInContext(helpers, context);
  const snapshot = () => JSON.parse(JSON.stringify(runInContext('({ hits: Array.from(echoHits), reflections: Array.from(echoReflections), ray: echoRay, timer: echoTimer })', context)));
  const advance = frames => { for (let i = 0; i < frames; i++) context.listenRound(1 / 64); };
  return { context, camera, queries, spaces, shelters, materials, snapshot, advance };
}
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);
const expectedDistance = (7.8 + 7.8 * Math.SQRT2) / 2;
const summaries = {};
for (const [surface, reflection] of [['stone', 1], ['metal', .9], ['wood', .65], ['mud', .25], ['foliage', .12]]) {
  const f = fixture(room(surface)); f.context.resetAcoustics();
  assert.equal(f.queries.length, 0, 'reset performs no initial sweep');
  assert.deepEqual(f.spaces, [[0, 30, 1]]);
  f.advance(65);
  const radial = f.queries.filter(query => query[4] === 0), roof = f.queries.filter(query => query[4] === 1);
  assert.equal(radial.length, 65, 'one radial query per actual frame');
  assert.equal(roof.length, 3, 'only the existing half-second roof query');
  assert.equal(f.materials.length, radial.length, 'each radial hit supplies its own material once');
  assert.equal(f.spaces.length, 4, 'reset plus the three timed snapshots');
  for (const query of radial) {
    assert.equal(query[6], 30); assert.equal(query[7], SHOT); assert.deepEqual({ ...query[8] }, { noWater: true });
    close(Math.hypot(query[3], query[4], query[5]), 1, 'radial direction is normalized');
  }
  for (const query of roof) {
    assert.equal(query[6], 18); assert.equal(query[7], SHOT);
    assert.deepEqual({ ...query[8] }, { noTerrain: true, noWater: true });
  }
  const final = f.spaces.at(-1);
  close(final[0], 1 - expectedDistance / 45, 'geometric enclosure');
  close(final[1], expectedDistance, 'mean room distance');
  close(final[2], reflection, 'material-weighted reflection');
  assert.ok(f.shelters.every(value => value === 0));
  assert.equal(f.snapshot().ray, 1, 'the radial cursor wraps without an additional sample');
  summaries[surface] = final;
}
// The cold first snapshot contains one sampled direction and seven open ones.
{
  const f = fixture(room()); f.context.resetAcoustics(); f.advance(1);
  assert.equal(f.queries.length, 2, 'the first frame does not perform an eight-ray sweep');
  close(f.spaces.at(-1)[0], (1 - 7.8 / 45) / 8, 'partial cold enclosure');
  close(f.spaces.at(-1)[1], (7 * 30 + 7.8) / 8, 'partial cold distance');
}
// A near hard wall must count more than a distant soft screen.
{
  const world = room(null);
  world.add({ type: 'box', x: 0, y: 1.6, z: 4, hx: 10, hy: 1.6, hz: .2, surface: 'stone' });
  world.add({ type: 'box', x: 12, y: 1.6, z: 0, hx: .2, hy: 1.6, hz: 20, surface: 'wood' });
  world.add({ type: 'box', x: 0, y: 1.6, z: -8, hx: 10, hy: 1.6, hz: .2, surface: 'foliage' });
  const distances = [3.8, 3.8 * Math.SQRT2, 11.8, 7.8 * Math.SQRT2, 7.8, 7.8 * Math.SQRT2, 30, 3.8 * Math.SQRT2];
  const reflections = [1, 1, .65, .12, .12, .12, 0, 1];
  let weightSum = 0, reflected = 0;
  for (let i = 0; i < 8; i++) {
    const weight = distances[i] < 30 ? 1 - distances[i] / 45 : 0;
    weightSum += weight; reflected += weight * reflections[i];
  }
  const f = fixture(world); f.context.resetAcoustics(); f.advance(65);
  const result = f.spaces.at(-1);
  close(result[0], weightSum / 8, 'mixed geometric enclosure');
  close(result[1], distances.reduce((sum, value) => sum + value, 0) / 8, 'mixed distance');
  close(result[2], reflected / weightSum, 'mixed weighted material');
  assert.ok(result[2] > (3 + .65 + .36) / 7 + .01, 'a simple unweighted hit average would be wrong');
  summaries.mixed = result;
}
for (const [roof, expected] of [[null, 0], ['wood', 1], ['foliage', .35]]) {
  const f = fixture(room('stone', roof)); f.advance(65);
  assert.equal(f.shelters.at(-1), expected, 'overhead weather shelter stays independent of wall materials');
}
// A checkpoint teleport clears both the range and material history immediately.
{
  const f = fixture(room('wood', 'wood')); f.advance(65);
  assert.ok(f.snapshot().hits.some(value => value < 30)); assert.equal(f.shelters.at(-1), 1);
  f.camera.position.set(70, 1.6, 0);
  const beforeQueries = f.queries.length;
  f.context.resetAcoustics();
  assert.equal(f.queries.length, beforeQueries, 'teleport reset adds no world trace');
  assert.deepEqual(f.snapshot(), { hits: Array(8).fill(30), reflections: Array(8).fill(0), ray: 0, timer: 0 });
  assert.deepEqual(f.spaces.at(-1), [0, 30, 1]);
  f.advance(1);
  assert.deepEqual(f.spaces.at(-1), [0, 30, 1]); assert.equal(f.shelters.at(-1), 0);
  assert.equal(f.queries.length, beforeQueries + 2, 'the next frame uses the ordinary radial and roof probes');
  f.advance(64); assert.deepEqual(f.spaces.at(-1), [0, 30, 1]);
  f.context.resetAcoustics(); f.context.resetAcoustics();
  assert.deepEqual(f.snapshot(), { hits: Array(8).fill(30), reflections: Array(8).fill(0), ray: 0, timer: 0 });
}
{
  const f = fixture(room()); f.context.listenRound(30);
  assert.equal(f.queries.length, 2, 'a long frame does not repay time with extra radial sweeps');
}
for (const name of ['startMission', 'retryCheckpoint']) {
  const a = source.indexOf(`function ${name}(`), b = source.indexOf('\n}', a), body = source.slice(a, b);
  const resetPlayer = body.indexOf('player.reset('), resetAudio = body.indexOf('resetAcoustics()'), resume = body.indexOf('resume()');
  assert.ok(resetPlayer >= 0 && resetAudio > resetPlayer && resume > resetAudio, `${name} resets the listener after teleport and before play resumes`);
}
console.log('main-acoustics-check: actual listener helpers, eight-direction cadence/material weighting, exact radial/roof budgets, cold/open controls, shelter and start/retry teleport reset pass');
