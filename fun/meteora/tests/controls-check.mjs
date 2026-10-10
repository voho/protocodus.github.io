// Run with: node tests/controls-check.mjs
// Mouse aims; W/S speed, A/D slide, Q/E roll, R/F up and down; left mouse
// (or Space) fires the cannons, right mouse a missile.
import { test, run, assert, near } from './harness.mjs';
import {
  createControlState, keyDown, keyUp, mouseDown, mouseUp, setCursor, moveCursor, dropAll, readInput,
} from '../js/controls.js';

const S = (o = {}) => createControlState({ invertPitch: false, vibration: true, ...o });
const DT = 1 / 60;
const hold = (s, seconds) => { let c; for (let t = 0; t < seconds; t += DT) c = readInput(s, DT); return c; };

test('W/S raise and lower the speed, X stops, Shift boosts', () => {
  const s = S(); keyDown(s, 'KeyW'); keyDown(s, 'ShiftLeft');
  let c = readInput(s, DT); assert.equal(c.throttleDelta, 1); assert.equal(c.boost, true);
  keyUp(s, 'KeyW'); keyDown(s, 'KeyS'); assert.equal(readInput(s, DT).throttleDelta, -1);
  keyDown(s, 'KeyX'); assert.equal(readInput(s, DT).throttleZero, true);
});
test('A/D slide sideways, R/F thrust up and down, Q/E roll', () => {
  const s = S(); keyDown(s, 'KeyD'); keyDown(s, 'KeyR'); keyDown(s, 'KeyE');
  let c = readInput(s, DT); assert.equal(c.strafe, 1); assert.equal(c.lift, 1); assert.ok(c.roll > 0);
  keyDown(s, 'KeyA'); assert.equal(readInput(s, DT).strafe, 0, 'both cancel');
  keyUp(s, 'KeyD'); assert.equal(readInput(s, DT).strafe, -1);
  keyUp(s, 'KeyR'); keyDown(s, 'KeyF'); assert.equal(readInput(s, DT).lift, -1);
  keyUp(s, 'KeyE'); keyDown(s, 'KeyQ'); assert.ok(readInput(s, DT).roll < 0);
});
test('a tapped roll is gentle and a held one ramps to full', () => {
  const s = S(); keyDown(s, 'KeyE');
  const first = readInput(s, DT).roll;
  assert.ok(first > 0.2 && first < 0.45, `tap ${first}`);
  near(hold(s, 0.7).roll, 1, 1e-9);
});
test('the left mouse button fires the cannons while held; Space does too', () => {
  const s = S(); mouseDown(s, 0);
  assert.equal(readInput(s, DT).fire, true); assert.equal(readInput(s, DT).fire, true);
  mouseUp(s, 0); assert.equal(readInput(s, DT).fire, false);
  keyDown(s, 'Space'); assert.equal(readInput(s, DT).fire, true);
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
test('Z toggles flight assist once per press, ignoring key repeat', () => {
  const s = S(); keyDown(s, 'KeyZ', false);
  assert.equal(readInput(s, DT).toggleFA, true); assert.equal(readInput(s, DT).toggleFA, false);
  keyDown(s, 'KeyZ', true); assert.equal(readInput(s, DT).toggleFA, false);
});
test('blur drops held keys and buttons and centres the aim', () => {
  const s = S(); for (const k of ['KeyW', 'KeyD', 'KeyQ', 'ShiftLeft', 'Space']) keyDown(s, k);
  mouseDown(s, 0); setCursor(s, 0.7, -0.3);
  hold(s, 0.5);
  dropAll(s);
  const c = readInput(s, DT);
  for (const k of ['roll', 'strafe', 'throttleDelta']) assert.equal(c[k], 0, k);
  assert.equal(c.boost, false); assert.equal(c.fire, false);
  assert.deepEqual(c.cursor, [0, 0]);
});
await run();
