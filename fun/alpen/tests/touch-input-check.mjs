// Pointer lifecycle checks run without a browser; layout is checked separately.
import assert from 'node:assert/strict';
import { createInput } from '../js/input.js';

const timers = new Map();
let timerId = 0;
const browser = new EventTarget();
browser.setTimeout = (fn) => { timers.set(++timerId, fn); return timerId; };
browser.clearTimeout = (id) => timers.delete(id);
globalThis.window = browser;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, value: { getGamepads: () => [] },
});
function send(target, type, values = {}) {
  if (type === 'pointercancel' || type === 'lostpointercapture') target.pointers?.delete(values.pointerId);
  const event = new Event(type, { cancelable: true });
  Object.assign(event, values);
  target.dispatchEvent(event);
  return event;
}
let underThumb;
class Button extends EventTarget {
  constructor(key) {
    super();
    this.dataset = { key };
    this.pointers = new Set();
    this.classes = new Set();
    this.classList = {
      toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name),
      remove: (name) => this.classes.delete(name),
    };
    this.ownerDocument = { elementFromPoint: () => underThumb };
  }
  setPointerCapture(id) { this.pointers.add(id); }
  hasPointerCapture(id) { return this.pointers.has(id); }
  releasePointerCapture(id) {
    this.pointers.delete(id);
    send(this, 'lostpointercapture', { pointerId: id });
  }
}
const buttons = Object.fromEntries(
  ['left', 'right', 'brake', 'tuck', 'jump', 'grab', 'flip'].map((name) => [name, new Button(name)]),
);
const target = new EventTarget();
const pad = { querySelectorAll: () => Object.values(buttons) };
let cancelled = 0;
const input = createInput(target, { cancelJump: () => cancelled++ });
input.bindTouch(pad);
const step = () => input.update(1 / 60);
const press = (name, pointerId) => send(buttons[name], 'pointerdown', { pointerId, button: 0 });
const release = (name, pointerId) => send(buttons[name], 'pointerup', { pointerId });

// Both thumbs act together, and sliding the steering thumb changes edges
// without releasing the jump charge or needing a fresh touch.
press('left', 1);
press('jump', 2);
step(); input.stepped();
assert.equal(input.state.turnIntent, -1);
assert.equal(input.state.jump, true);
underThumb = buttons.right;
send(buttons.left, 'pointermove', { pointerId: 1, clientX: 80, clientY: 20 });
step();
assert.equal(input.state.turnIntent, 1);
assert.equal(input.state.jump, true);
assert.equal(buttons.left.classes.has('on'), false);
assert.equal(buttons.right.classes.has('on'), true);
release('left', 1); // Pointer capture still belongs to the original arrow.
step();
assert.equal(input.state.turnIntent, 0);
release('jump', 2);
step();
assert.equal(input.state.jump, false);
assert.equal(cancelled, 0, 'normal release does not cancel a charged jump');

press('jump', 3);
press('jump', 4);
release('jump', 3);
step(); input.stepped();
assert.equal(input.state.jump, true, 'one finger releasing cannot clear another');
release('jump', 4);
step();
assert.equal(input.state.jump, false);

for (const type of ['pointercancel', 'lostpointercapture']) {
  press('jump', 5);
  send(buttons.jump, type, { pointerId: 5 });
  step();
  assert.equal(input.state.jump, false, `${type} never synthesizes a quick jump`);
}
assert.equal(cancelled, 2, 'aborted gestures cancel the rider charge');

// A real quick tap still survives a rendering frame with no physics step.
press('jump', 6);
release('jump', 6);
step();
assert.equal(input.state.jump, true);
input.stepped();
assert.equal(input.state.jump, false);
input.stepped(); step();
assert.equal(input.state.jump, false);

press('left', 7);
press('jump', 8);
send(target, 'keydown', { code: 'KeyW' });
step(); input.stepped();
input.calm();
assert.equal(buttons.left.pointers.size, 0, 'pause releases capture');
assert.equal(buttons.jump.pointers.size, 0);
release('left', 7);
release('jump', 8);
step();
assert.equal(input.state.turnIntent, 0);
assert.equal(input.state.jump, false, 'late release after pause is ignored');
assert.equal(input.state.tuck, true, 'pause preserves a physically held key');
send(target, 'keyup', { code: 'KeyW' });

press('right', 9);
press('jump', 10);
send(browser, 'orientationchange');
step();
assert.equal(input.state.turnIntent, 0, 'rotation retires old touch geometry');
assert.equal(input.state.jump, false);

press('jump', 11);
send(browser, 'blur');
step();
assert.equal(input.state.jump, false);
assert.equal(buttons.jump.pointers.size, 0);

// Accessibility clicks pulse controls, but must not release a thumb or fire
// a stale timer after the curtain has opened.
send(buttons.brake, 'click', { detail: 0 });
press('brake', 12);
for (const fn of timers.values()) fn();
timers.clear();
step();
assert.equal(input.state.brake, true, 'click timer cannot release a pointer');
release('brake', 12);
step();
assert.equal(input.state.brake, false);
send(buttons.jump, 'click', { detail: 0 });
assert.equal(timers.size, 1);
input.calm();
assert.equal(timers.size, 0, 'pause cancels accessibility timers');
step();
assert.equal(input.state.jump, false);

send(buttons.jump, 'pointerdown', { pointerId: 13, button: 2 });
step();
assert.equal(input.state.jump, false, 'a secondary mouse button is not a ride command');

// Binding a second layout for the same action must preserve other fingers.
const otherBrake = new Button('brake');
input.bindTouch({ querySelectorAll: () => [otherBrake] });
press('brake', 14);
send(otherBrake, 'pointerdown', { pointerId: 15, button: 0 });
release('brake', 14);
step();
assert.equal(input.state.brake, true);
send(otherBrake, 'pointerup', { pointerId: 15 });
step();
assert.equal(input.state.brake, false);

input.dispose();
press('jump', 16);
send(buttons.jump, 'click', { detail: 0 });
step();
assert.equal(input.state.jump, false, 'disposed controls no longer accept touches');
assert.equal(timers.size, 0);
console.log('Touch input checks passed: simultaneous thumbs, steering slides, cancellation, rotation, pause, capture cleanup and accessible activations.');
