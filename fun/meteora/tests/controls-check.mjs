// tests/controls-check.mjs
import { test, run, assert, near } from './harness.mjs';
import { createControlState, keyDown, keyUp, mouseDown, mouseMove, dropAll, readInput } from '../js/controls.js';

const S = () => createControlState({ sensitivity: 1, invertPitch: false, vibration: true });
test('W/S ramp the throttle, X zeroes it, Shift boosts', () => {
  const s = S(); keyDown(s, 'KeyW'); keyDown(s, 'ShiftLeft');
  let c = readInput(s); assert.equal(c.throttleDelta, 1); assert.equal(c.boost, true);
  keyUp(s, 'KeyW'); keyDown(s, 'KeyS'); assert.equal(readInput(s).throttleDelta, -1);
  keyDown(s, 'KeyX'); assert.equal(readInput(s).throttleZero, true);
});
test('blur drops every held input', () => {
  const s = S(); keyDown(s, 'KeyW'); keyDown(s, 'ShiftLeft'); keyDown(s, 'KeyQ'); mouseDown(s, 0); mouseMove(s, 300, -200);
  dropAll(s);
  const c = readInput(s);
  assert.equal(c.throttleDelta, 0); assert.equal(c.boost, false); assert.equal(c.roll, 0); assert.equal(c.fire, false);
  assert.equal(c.pitch, 0); assert.equal(c.yaw, 0);
});
test('the virtual stick clamps to the ring and has a deadzone', () => {
  const s = S(); mouseMove(s, 10, 0);
  assert.equal(readInput(s).yaw, 0, 'inside the deadzone');
  mouseMove(s, 100000, 0); const c = readInput(s);
  near(c.yaw, 1, 1e-9); assert.ok(Math.hypot(...s.cursor) <= 1 + 1e-9);
});
test('mouse up is nose down unless pitch is inverted', () => {
  const s = S(); mouseMove(s, 0, -300); assert.ok(readInput(s).pitch > 0, 'mouse up (dy<0) pitches the nose up');
  const inv = createControlState({ sensitivity: 1, invertPitch: true, vibration: true });
  mouseMove(inv, 0, -300); assert.ok(readInput(inv).pitch < 0);
});
test('Z toggles flight assist once per press, ignoring key repeat', () => {
  const s = S(); keyDown(s, 'KeyZ', false);
  assert.equal(readInput(s).toggleFA, true); assert.equal(readInput(s).toggleFA, false);
  keyDown(s, 'KeyZ', true); assert.equal(readInput(s).toggleFA, false);
});
test('strafe, lift and roll map to the documented keys', () => {
  const s = S(); keyDown(s, 'KeyD'); keyDown(s, 'KeyR'); keyDown(s, 'KeyE');
  const c = readInput(s); assert.equal(c.strafe, 1); assert.equal(c.lift, 1); assert.equal(c.roll, 1);
  keyDown(s, 'KeyA'); assert.equal(readInput(s).strafe, 0, 'both cancel');
  keyUp(s, 'KeyR'); keyDown(s, 'KeyC'); assert.equal(readInput(s).lift, -1);
});
await run();
