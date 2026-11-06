// Actual player death/update/reset, using the shipped soldier and camera.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { createPlayer } = await import('../js/player.js');
const { createWorld } = await import('../js/world.js');
const { createCameraRig } = await import('../js/camera.js');
const { DEFAULT_SETTINGS } = await import('../js/config.js');
const soldier = await parseUntexturedGLB('soldier'), noop = () => {};
const services = new Proxy({}, { get: () => noop });
function game(realRig = true) {
  const bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
  const terrain = { height: () => 0, surfaceAt: () => 'wood', raycast: () => Infinity };
  const world = createWorld({ ...bounds, terrain }), camera = new THREE.PerspectiveCamera(68, 1.6, .05, 300);
  const calls = [], audio = new Proxy({}, { get: (_, name) => (...args) => calls.push({ name, args, time: G.time }) });
  const G = { level: { playBounds: bounds, loadout: ['kar98k', 'mp40'] }, time: 0, world, terrain, camera,
    scene: new THREE.Scene(), soldier: realRig ? soldier : null, models: new Map(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: value => value },
    rig: createCameraRig(camera, world), audio, effects: services, lights: services, debris: services,
    hud: services, events: { emit: noop }, shared: { wet: { value: 1 } }, enemies: [],
    stats: { shots: 0, hits: 0, damageTaken: 0, grenades: 0 }, explosives: services };
  const P = createPlayer(G); G.player = P; P.reset([0, 0, 0]);
  const input = { held: () => false, pressed: () => false, fired: () => false, consumeMouse: () => [0, 0], consumeWheel: () => 0, mouseR: false, mouseL: false };
  const step = dt => { G.time += dt; P.update(dt, input, DEFAULT_SETTINGS); };
  step(1 / 60); calls.length = 0;
  return { G, P, calls, step };
}
for (const fps of [20, 60, 120]) {
  const { G, P, calls, step } = game();
  P.damage(10000, new THREE.Vector3(0, 1.6, -8));
  assert.equal(P.alive, false); assert.ok(P.char.ragdoll);
  assert.equal(calls.filter(call => call.name === 'bodyFall' || call.name === 'bodyImpact').length, 0, 'death schedules no estimated landing sound');
  for (let i = 0; i < 40; i++) step(0);
  assert.equal(calls.filter(call => call.name === 'bodyImpact').length, 0, 'paused death physics cannot sound');
  for (let i = 0; i < fps * 6; i++) step(1 / fps);
  const contacts = calls.filter(call => call.name === 'bodyImpact');
  assert.equal(contacts.length, 1); assert.equal(calls.filter(call => call.name === 'bodyFall').length, 0);
  assert.equal(contacts[0].args[3], 'wood'); assert.ok(contacts[0].args[4] > .45); assert.equal(contacts[0].args[5], true);
  assert.ok(contacts[0].time > .15 && contacts[0].time < .8);
  assert.equal(contacts[0].args[1], 0, 'player thud follows its actual floor');
  assert.ok(contacts[0].args[2] > .2, 'the impact follows the falling torso away from the old feet');
  const before = calls.length; P.reset([3, 4, 0]); step(.05);
  assert.equal(calls.slice(before).filter(call => call.name === 'bodyImpact').length, 0);
  assert.ok(P.alive); P.char.dispose();
}
{
  const { P, calls, step } = game(); P.damage(10000, new THREE.Vector3(0, 1.6, -8));
  const old = P.char; step(.05); P.reset([0, 0, 0]);
  for (let i = 0; i < 600; i++) old.update(1 / 120, 0);
  assert.equal(calls.filter(call => call.name === 'bodyImpact').length, 0, 'retry disposal removes the old physical callback');
  P.char.dispose();
}
{
  const { P, calls, step } = game(false); P.damage(10000, null);
  assert.equal(P.char.ragdoll, undefined);
  const fallback = calls.filter(call => call.name === 'bodyFall');
  assert.equal(fallback.length, 1); assert.equal(fallback[0].args[4], .45); assert.equal(fallback[0].args[5], true);
  for (let i = 0; i < 120; i++) step(1 / 60);
  assert.equal(calls.filter(call => call.name === 'bodyImpact').length, 0);
  P.char.dispose();
}
console.log('body-consumer-check: actual player death/update at20/60/120Hz waits for one moving torso contact; pause, material/speed/player flag, retry disposal and no-rig fallback pass');
