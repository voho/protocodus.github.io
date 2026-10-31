// Run with: node tests/input-device-check.mjs
// Device hints observe intent without becoming an input-ownership switch.
import assert from 'node:assert/strict';
import { createInput } from '../js/input.js';

class Button extends EventTarget {
  constructor(key) { super(); this.dataset = { key }; }
  classList = { toggle() {}, remove() {} };
  setPointerCapture() {}
}
const browser = new EventTarget();
const timers = new Map();
let timerId = 0;
browser.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
browser.clearTimeout = id => timers.delete(id);
globalThis.window = browser;
let pads = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, value: { getGamepads: () => pads },
});
const send = (target, type, properties = {}) => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, properties);
  target.dispatchEvent(event);
};
const makePad = id => ({
  id, axes: [0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
});
const target = new EventTarget();
const jump = new Button('jump');
const changes = [], actions = [];
let cancelled = 0;
const input = createInput(target, {
  device: device => changes.push(device),
  key: event => actions.push({ code: event.code, device: input.state.device }),
  cancelJump: () => cancelled++,
});
const poll = () => input.update(1 / 120);
const key = code => send(target, 'keydown', { code });
const release = code => send(target, 'keyup', { code });

assert.equal(input.state.device, 'keyboard');
input.bindTouch({ querySelectorAll: () => [jump] });
assert.equal(input.state.touch, true, 'touch availability is unchanged');
assert.equal(input.state.device, 'keyboard', 'binding touch does not claim actual use');
input.setDevice('unsupported');
input.setDevice(null);
input.setDevice('keyboard');
assert.deepEqual(changes, [], 'invalid and unchanged devices do not notify');

const pad = makePad('first');
pads = [pad]; send(browser, 'gamepadconnected');
for (const value of [0, 0.12, 0.19, 0.23, 0.20, 0]) {
  pad.axes[0] = value;
  pad.buttons[6].value = 0.1;
  poll();
}
assert.equal(input.state.device, 'keyboard', 'connection and small drift cannot select a controller');
pad.buttons[6].value = 0;
pad.buttons[0].pressed = true;
poll(); input.stepped();
assert.equal(input.state.device, 'gamepad');
assert.equal(input.state.jump, true);
assert.equal(input.state.anyPressed, true, 'A retains the original start/resume edge');
assert.deepEqual(changes, ['gamepad']);

key('Space'); poll(); input.stepped();
assert.equal(input.state.device, 'keyboard');
assert.equal(input.state.jump, true, 'keyboard joins the same held charge');
for (let i = 0; i < 100; i++) poll();
assert.equal(input.state.device, 'keyboard', 'a held A cannot reclaim hints on later polls');
pad.buttons[0].pressed = false; poll();
assert.equal(input.state.device, 'keyboard', 'controller release does not claim a device');
assert.equal(input.state.jump, true, 'controller release leaves keyboard charge intact');
send(jump, 'pointerdown', { pointerId: 1, button: 0, pointerType: 'touch' });
assert.equal(input.state.device, 'touch');
release('Space'); poll(); input.stepped();
assert.equal(input.state.device, 'touch', 'keyboard release cannot replace touch hints');
assert.equal(input.state.jump, true, 'touch retains the combined charge');
pad.buttons[0].pressed = true; poll();
assert.equal(input.state.device, 'gamepad');
send(jump, 'pointerup', { pointerId: 1 }); poll();
assert.equal(input.state.device, 'gamepad', 'touch release cannot replace pad hints');
assert.equal(input.state.jump, true, 'controller retains the charge after the thumb releases');
pad.buttons[0].pressed = false; poll();
assert.equal(input.state.jump, false);
assert.equal(cancelled, 0);

send(target, 'keydown', { code: 'KeyD', repeat: true });
send(target, 'keydown', { code: 'KeyD', ctrlKey: true });
send(target, 'keydown', { code: 'ShiftLeft', key: 'Shift' });
release('KeyD');
assert.equal(input.state.device, 'gamepad', 'repeat, system shortcut and modifier cannot steal hints');
key('Enter');
assert.equal(actions.at(-1).device, 'keyboard', 'keyboard prompt changes before its action hook');
release('Enter');
pad.buttons[9].pressed = true; poll();
assert.deepEqual(actions.at(-1), { code: 'Escape', device: 'gamepad' },
  'Start already has controller prompts when its menu hook runs');
const afterStart = changes.length;
for (let i = 0; i < 20; i++) poll();
assert.equal(changes.length, afterStart, 'held menu button does not repeatedly notify');
key('KeyM');
pad.buttons[9].pressed = false; poll();
assert.equal(input.state.device, 'keyboard');
pad.buttons[8].pressed = true; poll();
assert.deepEqual(actions.at(-1), { code: 'KeyR', device: 'gamepad' },
  'Back retains controller provenance through its synthetic R action');
pad.buttons[8].pressed = false; poll();

// A fresh control on another pad counts even if that command is already held
// on the first. Aggregating button masks before edge detection would lose it.
pad.buttons[2].pressed = true; poll();
key('KeyW');
const second = makePad('second');
pads.push(second); send(browser, 'gamepadconnected'); poll();
assert.equal(input.state.device, 'keyboard', 'neutral second pad does not select');
second.buttons[2].pressed = true; poll();
assert.equal(input.state.device, 'gamepad', 'second pad has its own button edges');
pad.buttons[2].pressed = second.buttons[2].pressed = false; poll();
release('KeyW');

input.setDevice('keyboard');
input.state.anyPressed = false; // The production loop consumes this latch.
pad.axes[0] = 0.6; poll();
assert.equal(input.state.device, 'gamepad', 'deliberate axis movement selects a controller');
assert.equal(input.state.anyPressed, false, 'moving a stick does not invent a start or resume press');
key('KeyD');
for (let i = 0; i < 100; i++) {
  pad.axes[0] = 0.6 + Math.sin(i) * 0.025;
  poll();
}
assert.equal(input.state.device, 'keyboard', 'held-axis jitter cannot reclaim prompts');
for (const value of [0.5, 0.4, 0.3, 0.2, 0.1, 0]) { pad.axes[0] = value; poll(); }
assert.equal(input.state.device, 'keyboard', 'releasing an axis never chooses a device');
for (let value = 0; value <= 0.6; value += 0.01) { pad.axes[0] = value; poll(); }
assert.equal(input.state.device, 'gamepad', 'a slow intentional deflection still registers');
release('KeyD');
pad.axes[0] = 0; poll();
pad.axes[0] = 0.29; poll();
key('KeyD');
for (let i = 0; i < 100; i++) {
  pad.axes[0] = i % 2 ? 0.29 : 0.27;
  poll();
}
assert.equal(input.state.device, 'keyboard', 'jitter across the hint threshold needs a true neutral to re-arm');
release('KeyD');
pad.axes[0] = 0.8; poll();
key('KeyD');
for (let i = 0; i < 40; i++) {
  pad.axes[0] = i % 2 ? 0.29 : 0.27;
  poll();
}
assert.equal(input.state.device, 'keyboard', 'a large release into threshold jitter also stays with keyboard');
release('KeyD');
key('KeyA');
pad.axes[0] = -0.6; poll();
assert.equal(input.state.device, 'gamepad', 'deliberate direction reversal registers');
release('KeyA');
pad.axes[0] = 0; poll();
input.setDevice('keyboard');
for (let value = 0; value <= 0.7; value += 0.01) { pad.buttons[7].value = value; poll(); }
assert.equal(input.state.device, 'gamepad', 'analogue trigger squeeze selects without a pressed bit');
key('KeyS');
for (const value of [0.6, 0.4, 0.2, 0]) { pad.buttons[7].value = value; poll(); }
assert.equal(input.state.device, 'keyboard', 'trigger release cannot steal hints');
release('KeyS');

// Focus suppression is also respected by presentation, even if controls
// move while the player is away. A genuine neutral then fresh press re-arms it.
pad.buttons[0].pressed = true; poll();
input.clear();
input.setDevice('keyboard');
pad.axes[0] = 0.8;
for (let i = 0; i < 20; i++) poll();
assert.equal(input.state.device, 'keyboard');
assert.equal(input.state.jump, false);
pad.buttons[0].pressed = false; pad.axes[0] = 0; poll();
pad.buttons[0].pressed = true; poll();
assert.equal(input.state.device, 'gamepad', 'fresh activity after focus recovery selects normally');
pad.buttons[0].pressed = false; poll();

send(jump, 'click', { detail: 0 });
assert.equal(input.state.device, 'touch', 'accessible virtual-button activation uses its action labels');
input.calm();
assert.equal(input.state.device, 'touch', 'pause does not replace the selected presentation');
assert.equal(input.state.touch, true, 'handoffs never hide touch capability');
second.buttons[0].pressed = true; poll();
assert.equal(input.state.device, 'gamepad');
pads = [null, second]; send(browser, 'gamepaddisconnected'); poll();
assert.equal(input.state.device, 'gamepad', 'another connected controller retains its prompts');
pads = []; send(browser, 'gamepaddisconnected'); poll();
assert.equal(input.state.device, 'touch', 'last controller departure restores the last available vocabulary');
const beforeDispose = changes.length;
input.dispose();
send(jump, 'pointerdown', { pointerId: 2, button: 0 });
key('Enter');
assert.equal(changes.length, beforeDispose, 'disposed event handlers cannot update prompts');
console.log('Input-device checks passed: fresh activity, held-input stability, controller drift and release, mixed jump ownership, menu provenance, focus suppression, touch capability and disposal.');
