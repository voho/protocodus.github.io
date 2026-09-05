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
  send(target, touch ? 'pointerdown' : 'keydown', { code: 'Space', pointerId: 1 });
  input.calm();
  assert.equal(input.state.anyPressed, false, 'pause consumes a pending input edge rather than immediately resuming');
  send(target, touch ? 'pointerup' : 'keyup', { code: 'Space', pointerId: 1 });
  input.update(dt);
  assert.equal(input.state.jump, false, 'a release during pause does not become a fresh buffered tap');
  input.dispose();
}
pads = [{ axes: [0.8], buttons: [] }];
const gamepad = createInput(new Target());
gamepad.update(0.2);
assert.ok(gamepad.state.turn > 0.3, 'a previously connected pad works without another connection event');
gamepad.clear(); gamepad.update(0.2);
assert.equal(gamepad.state.turn, 0, 'blur suppresses held controller input until neutral');
gamepad.dispose();

// A release is player intent even while the ground steering ramp is still
// unwinding. Feed the actual input state into a nearly completed 360: the
// old double smoothing kept spinning through the remaining landing window.
pads = [];
const releaseTarget = new Target();
const released = createInput(releaseTarget);
send(releaseTarget, 'keydown', { code: 'KeyD' });
released.update(dt);
assert.ok(released.state.turn > 0 && released.state.turn < 0.1, 'ground steering still eases in');
assert.equal(released.state.turnIntent, 1);
for (let i = 0; i < 120; i++) released.update(dt);
send(releaseTarget, 'keyup', { code: 'KeyD' });
released.update(dt);
assert.ok(released.state.turn > 0.8, 'ground steering still eases out');
assert.equal(released.state.turnIntent, 0, 'air rotation sees release immediately');
const finishing = rider();
const remaining = 0.28;
finishing.pos.y = 3 * remaining + 0.5 * RIDER.gravity * remaining ** 2;
finishing.vel.set(0, -3, -15);
finishing.state = 'air'; finishing.grounded = false; finishing.airTime = 1.5;
finishing.yaw = finishing.spinAccum = 6.5;
finishing.spinVel = 5;
for (let i = 0; i < 80 && finishing.state === 'air'; i++) {
  released.update(dt);
  finishing.step(dt, released.state);
  released.stepped();
}
assert.equal(finishing.landing?.verdict, CLEAN, 'releasing before touchdown completes a clean landing');
assert.equal(finishing.landing?.halfTurns, 2, 'the intended 360 remains a 360');
released.dispose();
const committed = rider();
committed.pos.y = 0.4; committed.vel.set(0, -5, -15);
committed.state = 'air'; committed.grounded = false; committed.airTime = 1;
committed.yaw = 0.8;
committed.step(dt, { ...neutral, turnIntent: 0.5 });
close(committed.yaw, 0.8 + committed.spinVel * dt, 'landing help never fights a held stick');

// Menu edges and focus-loss suppression must work without any physics steps.
// The main-loop pause/resume integration is also exercised in the browser.
let menuEdges = 0;
const menuPad = { axes: [0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
pads = [menuPad];
const menuInput = createInput(new Target(), { key: e => {
  assert.equal(e.code, 'Escape');
  menuEdges++;
  if (menuEdges % 2 === 1) menuInput.calm(); // The production pause callback.
} });
menuPad.buttons[0].pressed = menuPad.buttons[9].pressed = true;
for (let i = 0; i < 60; i++) menuInput.update(dt);
assert.equal(menuEdges, 1, 'holding Start pauses only once');
assert.equal(menuInput.state.anyPressed, false, 'Start wins over simultaneous A without resuming immediately');
menuPad.buttons[0].pressed = menuPad.buttons[9].pressed = false;
menuInput.update(dt);
assert.equal(menuInput.state.jump, false, 'releasing A after a menu pause cannot queue a surprise jump');
menuPad.buttons[9].pressed = true;
for (let i = 0; i < 60; i++) menuInput.update(dt);
assert.equal(menuEdges, 2, 'a fresh Start press resumes only once');
menuPad.buttons[0].pressed = true;
menuInput.clear();
for (let i = 0; i < 60; i++) menuInput.update(dt);
assert.equal(menuEdges, 2, 'focus loss suppresses a held Start until neutral');
assert.equal(menuInput.state.jump, false, 'focus loss still suppresses a held jump');
assert.equal(menuInput.state.anyPressed, false);
menuPad.buttons[0].pressed = menuPad.buttons[9].pressed = false;
menuInput.update(dt);
menuPad.buttons[0].pressed = true;
menuInput.update(dt);
assert.equal(menuInput.state.anyPressed, true, 'a fresh A press can resume after neutral');
menuInput.state.anyPressed = false;
for (let i = 0; i < 20; i++) menuInput.update(dt);
assert.equal(menuInput.state.anyPressed, false, 'held A does not repeat the resume edge');
menuPad.buttons[0].pressed = false;
menuPad.axes[0] = 0.1;
menuInput.update(dt);
assert.equal(menuInput.state.turnIntent, 0, 'stick intent keeps the existing dead zone');
menuPad.axes[0] = 0.8;
menuInput.update(dt);
assert.ok(menuInput.state.turnIntent > 0 && menuInput.state.turnIntent < 0.8,
  'stick intent remains analog after dead-zone rescaling');
menuInput.dispose();

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
console.log('Riding checks passed: charged/late/buffered pops, ballistic air, landing assist, input taps/pads, release intent, controller menus and camera.');
