// Run with: node tests/riding-check.mjs
import assert from 'node:assert/strict';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { Rider, CLEAN, BAIL } from '../js/rider.js';
import { RIDER } from '../js/config.js';
import { createInput } from '../js/input.js';
import { createChaseCamera } from '../js/camera.js';

const dt = 1 / 120;
const neutral = { turn: 0, tuck: false, brake: false, jump: false, trickGrab: false, trickFlip: false };
const flat = { height: () => 0, canStall: () => false };
const rider = (world = flat) => new Rider(THREE, world);
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} / ${b}`);

// A charged jump receives its configured impulse exactly, not another fixed
// impulse from the visual suspension reset. Taps retain a gentler launch.
for (const ticks of [1, 60]) {
  const r = rider();
  for (let i = 0; i < ticks; i++) r.step(dt, { ...neutral, jump: true });
  const expected = RIDER.popMin + (RIDER.popMax - RIDER.popMin) * r.charge;
  r.step(dt, neutral);
  assert.equal(r.state, 'air');
  close(r.vel.y, expected, 'charge determines pop');
}

// A held charge survives an automatic lip and can be released slightly late.
const late = rider();
late.charging = true;
late.charge = 0.6;
late.takeOff(0, late.UP);
let perfectPops = 0;
late.on('perfectPop', () => perfectPops++);
late.step(dt, neutral);
close(late.vel.y, (RIDER.popMin + (RIDER.popMax - RIDER.popMin) * 0.6)
  * RIDER.lipBonus - RIDER.gravity * dt, 'late pop impulse');
late.step(dt, { ...neutral, jump: true });
const beforeRepeat = late.vel.y;
late.step(dt, neutral);
close(late.vel.y, beforeRepeat - RIDER.gravity * dt, 'no double jump');
assert.equal(perfectPops, 1);

// Tucking preserves more momentum but cannot accelerate a rider in midair;
// vertical position remains the exact constant-gravity trajectory.
for (const tuck of [false, true]) {
  const r = rider();
  r.pos.y = 100;
  r.vel.set(0, 10, -20);
  r.state = 'air'; r.grounded = false;
  for (let i = 0; i < 60; i++) r.step(dt, { ...neutral, tuck });
  close(r.pos.y, 100 + 10 * 0.5 - 0.5 * RIDER.gravity * 0.25, 'ballistic position');
  close(r.vel.y, 10 - RIDER.gravity * 0.5, 'constant gravity');
  assert.ok(Math.abs(r.vel.z) < 20, 'air input cannot add propulsion');
}

const buffered = rider();
buffered.pos.y = 0.05; buffered.vel.set(0, -5, -10);
buffered.state = 'air'; buffered.grounded = false; buffered.airTime = 0.6;
buffered.charging = true; buffered.charge = 0.8;
let launches = 0;
buffered.on('launch', () => launches++);
for (let i = 0; i < 5; i++) buffered.step(dt, neutral);
assert.equal(launches, 1, 'release immediately before landing buffers one pop');
assert.equal(buffered.state, 'air');

const stale = rider();
stale.pos.y = 10; stale.vel.set(0, -2, -10);
stale.state = 'air'; stale.grounded = false; stale.airTime = 0.6;
stale.charging = true; stale.charge = 0.8;
let staleLaunches = 0;
stale.on('launch', () => staleLaunches++);
for (let i = 0; i < 180; i++) stale.step(dt, neutral);
assert.equal(staleLaunches, 0, 'old airborne release expires before touchdown');

for (const [flip, expected] of [[5.2, CLEAN], [Math.PI, BAIL]]) {
  const r = rider();
  r.pos.y = 0.7; r.vel.set(0, -3, -10);
  r.state = 'air'; r.grounded = false; r.airTime = 0.7;
  r.flip = flip; r.flipAccum = flip;
  for (let i = 0; i < 120 && r.state === 'air'; i++) r.step(dt, neutral);
  assert.equal(expected === BAIL ? r.state : r.landing?.verdict,
    expected === BAIL ? 'fall' : CLEAN, 'assist finishes only an almost-complete flip');
}
const slope = rider({ height: (x, z) => z * 0.8 });
slope.pos.y += 1; slope.vel.set(0, -6, -20);
slope.state = 'air'; slope.grounded = false; slope.airTime = 0.8; slope.yaw = 0.4;
slope.step(dt, neutral);
close(slope.yaw, 0.4, 'no early landing assist while the downhill surface recedes');

// Exercise browser input with native EventTarget; no DOM or test framework.
class Target extends EventTarget {
  dataset = { key: 'jump' };
  classList = { toggle() {}, remove() {} };
  setPointerCapture() {}
  querySelectorAll() { return [this]; }
}
const windowTarget = new Target();
globalThis.window = windowTarget;
let pads = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
function send(target, type, values = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, values);
  target.dispatchEvent(event);
}
for (const touch of [false, true]) {
  const target = new Target();
  const input = createInput(target);
  if (touch) input.bindTouch(target);
  send(target, touch ? 'pointerdown' : 'keydown', { code: 'Space', pointerId: 1 });
  input.update(1 / 240); // A rendered frame that did not step physics.
  send(target, touch ? 'pointerup' : 'keyup', { code: 'Space', pointerId: 1 });
  input.update(1 / 240);
  assert.equal(input.state.jump, true, 'quick tap survives zero-step render frames');
  input.stepped();
  assert.equal(input.state.jump, false, 'next physics tick sees release, even in the same frame');
  input.stepped(); input.update(1 / 240);
  assert.equal(input.state.jump, false, 'tap does not replay');
  input.dispose();
}
pads = [{ axes: [0.8], buttons: [] }];
const gamepad = createInput(new Target());
gamepad.update(0.2);
assert.ok(gamepad.state.turn > 0.3, 'a previously connected pad works without another connection event');
gamepad.clear(); gamepad.update(0.2);
assert.equal(gamepad.state.turn, 0, 'blur suppresses held controller input until neutral');
gamepad.dispose();

// Spinning the board must not orbit the chase view away from its landing.
const flying = rider();
flying.pos.y = 20; flying.vel.set(0, 0, -20);
flying.state = 'air'; flying.grounded = false; flying.airTime = 2;
const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 2000);
const chase = createChaseCamera(THREE, camera);
for (let i = 0; i < 240; i++) chase.update(flying, 1 / 60, flat);
const original = camera.position.clone();
flying.yaw = Math.PI / 2;
for (let i = 0; i < 60; i++) chase.update(flying, 1 / 60, flat);
assert.ok(camera.position.distanceTo(original) < 0.02, 'camera tracks flight instead of board rotation');
assert.ok(camera.position.y >= flat.height(camera.position.x, camera.position.z) + 1.5);
console.log('Riding checks passed: charged/late/buffered pops, ballistic air, landing assist, input taps/pads and camera.');
