// Run with: node tests/controls-check.mjs
// Keyboard-only flight: W/S pitch, A/D yaw, Q/E roll, P/L throttle,
// Space fires the selected weapon, Alt switches weapons.
import { test, run, assert, near } from './harness.mjs';
import { createControlState, keyDown, keyUp, dropAll, readInput } from '../js/controls.js';

const S = (o = {}) => createControlState({ invertPitch: false, vibration: true, ...o });
const DT = 1 / 60;
const hold = (s, seconds) => { let c; for (let t = 0; t < seconds; t += DT) c = readInput(s, DT); return c; };

test('W/S pitch the nose up and down, A/D yaw left and right', () => {
  const s = S();
  keyDown(s, 'KeyW'); assert.ok(readInput(s, DT).pitch > 0); keyUp(s, 'KeyW');
  keyDown(s, 'KeyS'); assert.ok(readInput(s, DT).pitch < 0); keyUp(s, 'KeyS');
  keyDown(s, 'KeyA'); assert.ok(readInput(s, DT).yaw < 0); keyUp(s, 'KeyA');
  keyDown(s, 'KeyD'); assert.ok(readInput(s, DT).yaw > 0); keyUp(s, 'KeyD');
  assert.equal(readInput(s, DT).pitch, 0); assert.equal(readInput(s, DT).yaw, 0);
});
test('a tap steers gently and a held key ramps to the full rate', () => {
  const s = S(); keyDown(s, 'KeyD');
  const first = readInput(s, DT).yaw;
  assert.ok(first > 0.2 && first < 0.45, `tap ${first}`);
  near(hold(s, 0.7).yaw, 1, 1e-9, 'held');
  keyUp(s, 'KeyD'); keyDown(s, 'KeyD');
  assert.ok(readInput(s, DT).yaw < 0.45, 'a new press starts gentle again');
});
test('invert pitch swaps W and S', () => {
  const s = S({ invertPitch: true }); keyDown(s, 'KeyW');
  assert.ok(readInput(s, DT).pitch < 0);
});
test('Q/E roll left and right', () => {
  const s = S(); keyDown(s, 'KeyE'); assert.ok(readInput(s, DT).roll > 0);
  keyUp(s, 'KeyE'); keyDown(s, 'KeyQ'); assert.ok(readInput(s, DT).roll < 0);
});
test('P/L raise and lower the throttle, X zeroes it, Shift boosts', () => {
  const s = S(); keyDown(s, 'KeyP'); keyDown(s, 'ShiftLeft');
  let c = readInput(s, DT); assert.equal(c.throttleDelta, 1); assert.equal(c.boost, true);
  keyUp(s, 'KeyP'); keyDown(s, 'KeyL'); assert.equal(readInput(s, DT).throttleDelta, -1);
  keyDown(s, 'KeyX'); assert.equal(readInput(s, DT).throttleZero, true);
});
test('Space fires the cannons while held', () => {
  const s = S(); keyDown(s, 'Space');
  let c = readInput(s, DT); assert.equal(c.fire, true); assert.equal(c.missile, false); assert.equal(c.weapon, 'cannon');
  c = readInput(s, DT); assert.equal(c.fire, true, 'still held');
  keyUp(s, 'Space'); assert.equal(readInput(s, DT).fire, false);
});
test('Alt switches to missiles; Space then launches one per press', () => {
  const s = S();
  keyDown(s, 'AltLeft');
  let c = readInput(s, DT); assert.equal(c.weapon, 'missile'); assert.equal(c.switchedWeapon, true);
  assert.equal(readInput(s, DT).switchedWeapon, false, 'switching is once per press');
  keyDown(s, 'Space');
  c = readInput(s, DT); assert.equal(c.missile, true); assert.equal(c.fire, false);
  assert.equal(readInput(s, DT).missile, false, 'holding Space does not ripple-fire');
  keyUp(s, 'Space'); keyDown(s, 'Space');
  assert.equal(readInput(s, DT).missile, true);
  keyUp(s, 'AltLeft'); keyDown(s, 'AltRight');
  assert.equal(readInput(s, DT).weapon, 'cannon', 'Alt again goes back to cannons');
});
test('Z toggles flight assist once per press, ignoring key repeat', () => {
  const s = S(); keyDown(s, 'KeyZ', false);
  assert.equal(readInput(s, DT).toggleFA, true); assert.equal(readInput(s, DT).toggleFA, false);
  keyDown(s, 'KeyZ', true); assert.equal(readInput(s, DT).toggleFA, false);
});
test('arrow keys strafe and lift', () => {
  const s = S(); keyDown(s, 'ArrowRight'); keyDown(s, 'ArrowUp');
  let c = readInput(s, DT); assert.equal(c.strafe, 1); assert.equal(c.lift, 1);
  keyDown(s, 'ArrowLeft'); assert.equal(readInput(s, DT).strafe, 0, 'both cancel');
  keyUp(s, 'ArrowUp'); keyDown(s, 'ArrowDown'); assert.equal(readInput(s, DT).lift, -1);
});
test('blur drops every held input', () => {
  const s = S(); for (const k of ['KeyW', 'KeyD', 'KeyQ', 'KeyP', 'ShiftLeft', 'Space']) keyDown(s, k);
  hold(s, 0.5);
  dropAll(s);
  const c = readInput(s, DT);
  for (const k of ['pitch', 'yaw', 'roll', 'throttleDelta']) assert.equal(c[k], 0, k);
  assert.equal(c.boost, false); assert.equal(c.fire, false);
});
await run();
