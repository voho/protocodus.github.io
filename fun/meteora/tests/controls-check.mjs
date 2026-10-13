// Run with: node tests/controls-check.mjs
// Mouse: aim, left click cannons, right click missile.
// Keys: W/S speed, Q/E roll, Tab afterburner, T targets, Z lock speed to the target's.
import { test, run, assert, near } from './harness.mjs';
import {
  createControlState, keyDown, keyUp, mouseDown, mouseUp, setCursor, moveCursor, dropAll, readInput, readPad,
} from '../js/controls.js';
import { DEFAULT_SETTINGS } from '../js/screens.js';
import { aimCommands, createShip } from '../js/flight.js';
import { PLAYER, RENDER } from '../js/config.js';

const S = (o = {}) => createControlState({ invertPitch: false, vibration: true, sensitivity: 1, steering: 'stick', ...o });
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
test('Tab burns the afterburner while held', () => {
  const s = S(); keyDown(s, 'Tab');
  assert.equal(readInput(s, DT).boost, true); assert.equal(readInput(s, DT).boost, true);
  keyUp(s, 'Tab'); assert.equal(readInput(s, DT).boost, false);
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
test('sensitivity scales locked mouse movement', () => {
  const s = S({ sensitivity: 2 }); moveCursor(s, 0.1, -0.05);
  assert.deepEqual(readInput(s, DT).cursor, [0.2, -0.1]);
});
test('out of the box the mouse is livelier than one to one: 1.6× the cursor travel', () => {
  // The original game moved the cursor exactly as far as the mouse; the
  // campaign ships with a 1.6× default (Settings offer 0.5–3×).
  assert.ok(DEFAULT_SETTINGS.sensitivity >= 1.5, `default sensitivity ${DEFAULT_SETTINGS.sensitivity}`);
  const s = createControlState({ ...DEFAULT_SETTINGS });
  moveCursor(s, 0.1, -0.05);
  near(s.cursor[0], 0.1 * DEFAULT_SETTINGS.sensitivity, 1e-12);
  near(s.cursor[1], -0.05 * DEFAULT_SETTINGS.sensitivity, 1e-12);
});
test('a full-rate turn takes under 100 px of mouse travel on a 1280 px screen (it took about 200)', () => {
  // Locked, the cursor moves by movementX / half-width × sensitivity; it maps
  // to an aim direction through the camera (vertical fov, 16:10 here); the
  // ship turns at full rate once that direction is far enough off the nose.
  const ship = createShip(PLAYER);
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (aimCommands(ship, [Math.sin(mid), 0, -Math.cos(mid)]).yaw >= 1 - 1e-9) hi = mid; else lo = mid;
  }
  const halfWidth = 640, tanHalf = Math.tan(RENDER.fov * Math.PI / 360) * 1.6;
  const px = sensitivity => Math.tan(hi) / tanHalf * halfWidth / sensitivity;
  const now = px(DEFAULT_SETTINGS.sensitivity);
  const original = Math.tan(1 / 3) / tanHalf * halfWidth;   // gain 3, one to one
  assert.ok(now < 100, `${now.toFixed(0)} px for a full-rate turn`);
  assert.ok(original / now > 2, `${(original / now).toFixed(2)}× less mouse travel than the original ${original.toFixed(0)} px`);
});
test('direct steering lets the aim drift home when the mouse rests; stick keeps it', () => {
  const direct = S({ steering: 'direct' }), stick = S({ steering: 'stick' });
  for (const s of [direct, stick]) moveCursor(s, 0.6, 0);
  for (let i = 0; i < 120; i++) { readInput(direct, DT); readInput(stick, DT); }
  assert.ok(readInput(direct, DT).cursor[0] < 0.1, 'direct centres');
  near(readInput(stick, DT).cursor[0], 0.6, 1e-12, 'stick holds');
});
test('without pointer lock the cursor stays where the pointer is, in either steering', () => {
  // The pointer does not drift back, so neither may the aim: a held turn
  // must not fade and then snap back on the next one-pixel nudge.
  const s = S({ steering: 'direct' });
  setCursor(s, 0.6, -0.2);
  for (let i = 0; i < 120; i++) readInput(s, DT);
  assert.deepEqual(readInput(s, DT).cursor, [0.6, -0.2]);
});
test('A and D strafe; the edge keys fire once per press', () => {
  const s = S(); keyDown(s, 'KeyD'); assert.equal(readInput(s, DT).strafe, 1);
  keyUp(s, 'KeyD'); keyDown(s, 'KeyA'); assert.equal(readInput(s, DT).strafe, -1);
  for (const [code, name] of [['KeyY', 'cycleFriendly'], ['KeyB', 'targetTorpedo'], ['KeyN', 'cycleNav'], ['KeyV', 'cycleSub'], ['KeyG', 'cycleBank'], ['KeyX', 'equalize'], ['KeyR', 'repair'], ['Digit1', 'wingAttack'], ['Digit2', 'wingCover'], ['Digit3', 'wingForm']]) {
    keyDown(s, code); assert.equal(readInput(s, DT)[name], true, code); assert.equal(readInput(s, DT)[name], false, `${code} once`);
  }
});
// A standard-mapping gamepad: 4 axes, 17 buttons.
const pad = ({ axes = [0, 0, 0, 0], press = [], rt = 0, lt = 0 } = {}) => ({
  axes, buttons: Array.from({ length: 17 }, (_, i) => {
    const value = i === 7 ? rt : i === 6 ? lt : press.includes(i) ? 1 : 0;
    return { pressed: value > 0.5, value };
  }),
});
test('gamepad: the left stick aims and lets go to the middle; a dead zone keeps it still', () => {
  const s = S();
  readPad(s, pad({ axes: [0.08, -0.1, 0, 0] }));
  assert.deepEqual(readInput(s, DT).cursor, [0, 0], 'dead zone');
  readPad(s, pad({ axes: [1, -0.6, 0, 0] }));
  const c = readInput(s, DT).cursor;
  near(c[0], 1, 1e-9); assert.ok(c[1] < -0.2 && c[1] > -0.6, `up is up, gently curved: ${c[1]}`);
  readPad(s, pad());
  assert.deepEqual(readInput(s, DT).cursor, [0, 0], 'back in the middle');
});
test('gamepad: the right stick rolls and sets the speed; RT fires, LT launches once', () => {
  const s = S();
  readPad(s, pad({ axes: [0, 0, 1, -1], rt: 1 }));
  let c = readInput(s, DT);
  near(c.roll, 1, 1e-9); near(c.throttleDelta, 1, 1e-9); assert.equal(c.fire, true);
  readPad(s, pad({ lt: 1 })); assert.equal(readInput(s, DT).missile, true);
  readPad(s, pad({ lt: 1 })); assert.equal(readInput(s, DT).missile, false, 'held, not repeated');
  readPad(s, pad()); c = readInput(s, DT);
  assert.equal(c.fire, false); assert.equal(c.roll, 0);
});
test('gamepad: A burns, the face buttons and d-pad act once per press, Menu pauses', () => {
  const s = S();
  readPad(s, pad({ press: [0] })); assert.equal(readInput(s, DT).boost, true);
  readPad(s, pad()); assert.equal(readInput(s, DT).boost, false);
  for (const [button, name] of [[2, 'cycleTarget'], [3, 'targetTorpedo'], [1, 'toggleSpeedLock'], [4, 'cycleBank'], [5, 'cycleSub'], [12, 'wingAttack'], [15, 'wingCover'], [13, 'wingForm'], [14, 'cycleNav'], [10, 'equalize'], [11, 'repair'], [8, 'toggleCamera']]) {
    readPad(s, pad({ press: [button] })); assert.equal(readInput(s, DT)[name], true, name);
    readPad(s, pad({ press: [button] })); assert.equal(readInput(s, DT)[name], false, `${name} once`);
    readPad(s, pad());
  }
  assert.equal(readPad(s, pad({ press: [9] })).pause, true);
  assert.equal(readPad(s, pad({ press: [9] })).pause, false);
});
test('gamepad: dropAll lets go of the pad too', () => {
  const s = S();
  readPad(s, pad({ axes: [0, 0, 1, 1], rt: 1 }));
  dropAll(s);
  const c = readInput(s, DT);
  assert.equal(c.fire, false); assert.equal(c.roll, 0); assert.equal(c.throttleDelta, 0);
});
await run();
