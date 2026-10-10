// Run with: node tests/input-check.mjs
// The DOM wiring for keyboard-only flight, against fake window/document.
import { test, run, assert } from './harness.mjs';
import { createInput } from '../js/input.js';
import { createControlState, keyDown, readInput } from '../js/controls.js';

const event = (type, props = {}) => {
  const e = Object.assign(new Event(type), props);
  e.prevented = false;
  e.preventDefault = () => { e.prevented = true; };
  return e;
};

function setup({ flying = true } = {}) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const state = createControlState({ invertPitch: false, vibration: true });
  const pauses = [];
  const flags = { flying };
  createInput(state, { isFlying: () => flags.flying, onPause: reason => pauses.push(reason) }, { window: win, document: doc });
  const press = (code, extra = {}) => { const e = event('keydown', { code, repeat: false, ...extra }); win.dispatchEvent(e); return e; };
  return { win, doc, state, pauses, flags, press };
}

test('game keys reach the controls only while flying', () => {
  const s = setup({ flying: false });
  s.press('KeyW');
  assert.equal(readInput(s.state, 1 / 60).pitch, 0);
  s.flags.flying = true;
  s.press('KeyW');
  assert.ok(readInput(s.state, 1 / 60).pitch > 0);
});
test('Escape pauses', () => {
  const s = setup();
  s.press('Escape');
  assert.deepEqual(s.pauses, ['escape']);
});
test('leaving the window pauses and drops held keys', () => {
  const s = setup();
  s.press('KeyP'); s.press('ShiftLeft');
  s.win.dispatchEvent(event('blur'));
  assert.deepEqual(s.pauses, ['blur']);
  const c = readInput(s.state, 1 / 60);
  assert.equal(c.throttleDelta, 0); assert.equal(c.boost, false);
});
test('a hidden tab pauses', () => {
  const s = setup();
  s.doc.hidden = true;
  s.doc.dispatchEvent(event('visibilitychange'));
  assert.deepEqual(s.pauses, ['hidden']);
});
test('Space, Alt and the arrows are kept from the browser while flying', () => {
  const s = setup();
  for (const code of ['Space', 'AltLeft', 'ArrowUp', 'KeyW']) assert.equal(s.press(code).prevented, true, code);
  s.flags.flying = false;
  assert.equal(s.press('Space').prevented, false, 'menus keep their keys');
});
test('a key released while paused does not stay held', () => {
  const s = setup();
  s.press('KeyD');
  s.flags.flying = false;
  s.win.dispatchEvent(event('keyup', { code: 'KeyD' }));
  s.flags.flying = true;
  assert.equal(readInput(s.state, 1 / 60).yaw, 0);
});
await run();
