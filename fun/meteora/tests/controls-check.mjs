// Run with: node tests/controls-check.mjs
// Mouse: aim, left click cannons, right click missile.
// Keys: W/S speed, Q/E roll, T targets, Z lock speed to the target's.
import { test, run, assert, near } from './harness.mjs';
import {
  createControlState, keyDown, keyUp, mouseDown, mouseUp, setCursor, moveCursor, dropAll, readInput,
} from '../js/controls.js';

const S = (o = {}) => createControlState({ invertPitch: false, vibration: true, ...o });
const DT = 1 / 60;
const hold = (s, seconds) => { let c; for (let t = 0; t < seconds; t += DT) c = readInput(s, DT); return c; };

test('W/S raise and lower the speed', () => {
  const s = S(); keyDown(s, 'KeyW');
  assert.equal(readInput(s, DT).throttleDelta, 1);
  keyUp(s, 'KeyW'); keyDown(s, 'KeyS'); assert.equal(readInput(s, DT).throttleDelta, -1);
  keyDown(s, 'KeyW'); assert.equal(readInput(s, DT).throttleDelta, 0, 'both cancel');
});
test('Q/E roll; a tap is gentle and a held key ramps to full', () => {
  const s = S(); keyDown(s, 'KeyE');
  const first = readInput(s, DT).roll;
  assert.ok(first > 0.2 && first < 0.45, `tap ${first}`);
  near(hold(s, 0.7).roll, 1, 1e-9);
  keyUp(s, 'KeyE'); keyDown(s, 'KeyQ'); assert.ok(readInput(s, DT).roll < 0);
});
test('T cycles targets and Z toggles the speed lock, once per press', () => {
  const s = S(); keyDown(s, 'KeyT'); keyDown(s, 'KeyZ');
  let c = readInput(s, DT); assert.equal(c.cycleTarget, true); assert.equal(c.toggleSpeedLock, true);
  c = readInput(s, DT); assert.equal(c.cycleTarget, false); assert.equal(c.toggleSpeedLock, false);
  keyDown(s, 'KeyZ', true); assert.equal(readInput(s, DT).toggleSpeedLock, false, 'key repeat ignored');
});
test('no other key flies the ship', () => {
  const s = S();
  for (const code of ['KeyA', 'KeyD', 'KeyR', 'KeyF', 'ShiftLeft', 'KeyX', 'Space', 'KeyV', 'ArrowUp']) keyDown(s, code);
  const c = readInput(s, DT);
  assert.equal(c.strafe, 0); assert.equal(c.lift, 0); assert.equal(c.boost, false);
  assert.equal(c.throttleZero, false); assert.equal(c.fire, false); assert.equal(c.toggleCamera, false);
  assert.equal(c.toggleFA, false);
});
test('the left mouse button fires the cannons while held', () => {
  const s = S(); mouseDown(s, 0);
  assert.equal(readInput(s, DT).fire, true); assert.equal(readInput(s, DT).fire, true);
  mouseUp(s, 0); assert.equal(readInput(s, DT).fire, false);
});
test('the right mouse button launches one missile per click', () => {
  const s = S(); mouseDown(s, 2);
  let c = readInput(s, DT); assert.equal(c.missile, true); assert.equal(c.fire, false);
  assert.equal(readInput(s, DT).missile, false, 'holding does not ripple-fire');
  mouseUp(s, 2); mouseDown(s, 2);
  assert.equal(readInput(s, DT).missile, true);
});
test('the aim cursor stays on screen', () => {
  const s = S();
  setCursor(s, 3, -2); assert.deepEqual(readInput(s, DT).cursor, [1, -1]);
  setCursor(s, 0, 0); moveCursor(s, 0.5, 0.25); assert.deepEqual(readInput(s, DT).cursor, [0.5, 0.25]);
  moveCursor(s, 2, 2); assert.deepEqual(readInput(s, DT).cursor, [1, 1]);
});
test('invert pitch flips the aim vertically', () => {
  const s = S({ invertPitch: true }); setCursor(s, 0.2, 0.4);
  assert.deepEqual(readInput(s, DT).cursor, [0.2, -0.4]);
});
test('blur drops held keys and buttons and centres the aim', () => {
  const s = S(); keyDown(s, 'KeyW'); keyDown(s, 'KeyQ');
  mouseDown(s, 0); setCursor(s, 0.7, -0.3);
  hold(s, 0.5);
  dropAll(s);
  const c = readInput(s, DT);
  assert.equal(c.roll, 0); assert.equal(c.throttleDelta, 0); assert.equal(c.fire, false);
  assert.deepEqual(c.cursor, [0, 0]);
});
await run();
