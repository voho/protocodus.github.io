import assert from 'node:assert/strict';
import { createInput } from '../js/input.js';

// Only browser event surfaces are faked: every assertion exercises the actual
// production input adapter and its retained key, pointer, and controller state.
class FakeTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  emit(type, properties = {}) {
    const event = { type, target: this, repeat: false, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}
class FakeElement extends FakeTarget {
  constructor(tag = 'div', { action, editable = false, parent = null } = {}) {
    super();
    this.tag = tag;
    this.editable = editable;
    this.parent = parent;
    this.dataset = action ? { action } : {};
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
    this.capturedPointers = new Set();
  }
  closest(selector) {
    const selectors = selector.split(',').map(part => part.trim());
    for (let element = this; element; element = element.parent) {
      if (selectors.includes(element.tag) || (selectors.includes('[contenteditable]') && element.editable)) return element;
    }
    return null;
  }
  setPointerCapture(id) { this.capturedPointers.add(id); }
}

const fakeWindow = new FakeTarget();
const fakeDocument = new FakeTarget();
fakeDocument.body = new FakeElement('body');
fakeDocument.body.dataset.mode = 'race';
fakeDocument.hidden = false;
const buttons = Object.fromEntries(['left', 'right', 'throttle', 'brake', 'drift'].map(action => [action, new FakeElement('button', { action })]));
fakeDocument.querySelectorAll = selector => {
  if (selector === '[data-action]') return Object.values(buttons);
  if (selector === '.pressed') return Object.values(buttons).filter(button => button.classList.contains('pressed'));
  throw new Error(`Unexpected DOM query: ${selector}`);
};
let pads = [];
const globals = { window: fakeWindow, document: fakeDocument, Element: FakeElement, navigator: { getGamepads: () => pads } };
const previousGlobals = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

try {
  const actions = [];
  let input;
  input = createInput(action => {
    actions.push(action);
    // Pausing clears driving state synchronously in main.js. It must not turn a
    // held controller Start button into another rising edge on the next frame.
    if (action === 'pause' || action === 'gamepadMenu') input.clear();
  });
  const neutral = { throttle: 0, brake: 0, steer: 0, drift: false };
  const down = (code, target = fakeDocument.body, properties = {}) => fakeWindow.emit('keydown', { code, target, ...properties });
  const up = code => fakeWindow.emit('keyup', { code });
  const assertNeutral = message => assert.deepEqual(input.read(), neutral, message);
  assertNeutral('new controls start at rest');

  assert.ok(down('KeyW').defaultPrevented, 'driving keys prevent page scrolling during races');
  down('KeyD');
  assert.deepEqual(input.read(), { throttle: 1, brake: 0, steer: -1, drift: false });
  assert.equal(input.read().throttle, 1, 'held throttle persists across frames');
  up('KeyW');
  assert.deepEqual(input.read(), { throttle: 0, brake: 0, steer: -1, drift: false }, 'releasing throttle preserves held steering');
  up('KeyD');
  assertNeutral('released steering returns to center');

  for (const [key, expected] of [['KeyA', 1], ['ArrowLeft', 1], ['KeyD', -1], ['ArrowRight', -1]]) {
    down(key);
    assert.equal(input.read().steer, expected, `${key} turns toward the matching side from behind the car`);
    up(key);
  }

  down('ArrowLeft'); down('KeyD'); down('ArrowUp'); down('KeyS'); down('Space');
  assert.deepEqual(input.read(), { throttle: 1, brake: 1, steer: 0, drift: true }, 'opposing steering cancels while pedals remain independent');
  up('KeyD');
  assert.equal(input.read().steer, 1, 'releasing one opposing key restores the other');
  fakeWindow.emit('blur');
  assertNeutral('window blur clears all held keys');
  down('ArrowRight');
  fakeDocument.hidden = true;
  fakeDocument.emit('visibilitychange');
  assertNeutral('hidden documents cannot retain throttle or steering');
  fakeDocument.hidden = false;

  for (const target of [new FakeElement('input'), new FakeElement('textarea'), new FakeElement('select'),
    new FakeElement('div', { editable: true }), new FakeElement('span', { parent: new FakeElement('div', { editable: true }) })]) {
    const count = actions.length;
    assert.equal(down('KeyW', target).defaultPrevented, false, 'typing in editable fields keeps native behavior');
    assert.equal(down('KeyR', target).defaultPrevented, false, 'typing R does not recover the car');
    assert.equal(actions.length, count);
    assertNeutral('typing does not leak into driving');
  }
  const nativeButton = new FakeElement('button');
  const beforeEnter = actions.length;
  assert.equal(down('Enter', new FakeElement('span', { parent: nativeButton })).defaultPrevented, false);
  assert.equal(actions.length, beforeEnter, 'Enter on a focused button remains native activation');
  down('Enter'); down('Enter', fakeDocument.body, { repeat: true });
  assert.deepEqual(actions.slice(beforeEnter), ['start'], 'action keys ignore autorepeat');

  const gasDown = buttons.throttle.emit('pointerdown', { pointerId: 101 });
  buttons.left.emit('pointerdown', { pointerId: 102 });
  assert.ok(gasDown.defaultPrevented && buttons.throttle.capturedPointers.has(101));
  assert.ok(buttons.throttle.classList.contains('pressed'));
  assert.deepEqual(input.read(), { throttle: 1, brake: 0, steer: 1, drift: false }, 'independent fingers combine steering and throttle');
  buttons.left.emit('pointercancel', { pointerId: 102 });
  assert.deepEqual(input.read(), { throttle: 1, brake: 0, steer: 0, drift: false }, 'cancelling one pointer leaves the other active');
  assert.equal(buttons.left.classList.contains('pressed'), false);
  buttons.throttle.emit('lostpointercapture', { pointerId: 101 });
  assertNeutral('lost pointer capture cannot leave the accelerator stuck');
  buttons.right.emit('pointerdown', { pointerId: 105 });
  assert.equal(input.read().steer, -1, 'right touch control turns right from the chase camera');
  buttons.right.emit('pointerup', { pointerId: 105 });
  buttons.brake.emit('pointerdown', { pointerId: 103 });
  buttons.brake.emit('pointerup', { pointerId: 103 });
  assertNeutral('pointer release clears braking');
  buttons.drift.emit('pointerdown', { pointerId: 104 });
  fakeWindow.emit('blur');
  assertNeutral('blur clears touch input too');
  assert.equal(buttons.drift.classList.contains('pressed'), false, 'blur clears pressed styling');

  const pad = { connected: true, axes: [0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
  pads = [null, pad];
  down('KeyD'); pad.axes[0] = 0.08;
  assert.equal(input.read().steer, -1, 'controller deadzone preserves keyboard steering');
  pad.axes[0] = -0.65; pad.buttons[7].value = 0.72; pad.buttons[6].value = 0.35; pad.buttons[2].pressed = true;
  assert.deepEqual(input.read(), { throttle: 0.72, brake: 0.35, steer: 0.65, drift: true }, 'controller analog pedals and left steering retain their range');
  pad.axes[0] = 0.43;
  assert.equal(input.read().steer, -0.43, 'right gamepad input turns right from the chase camera');
  up('KeyD'); pad.axes[0] = 0; pad.buttons[7].value = 0; pad.buttons[6].value = 0; pad.buttons[2].pressed = false;
  const pausesBefore = actions.filter(action => action === 'gamepadMenu').length;
  pad.buttons[9].pressed = true;
  input.read();
  assert.equal(actions.filter(action => action === 'gamepadMenu').length, pausesBefore + 1, 'Start emits one menu action edge');
  input.clear();
  for (let frame = 0; frame < 8; frame++) input.read();
  assert.equal(actions.filter(action => action === 'gamepadMenu').length, pausesBefore + 1, 'clear while Start is held cannot create a pause/resume loop');
  pad.buttons[9].pressed = false; input.read();
  pad.buttons[9].pressed = true; input.read();
  assert.equal(actions.filter(action => action === 'gamepadMenu').length, pausesBefore + 2, 'releasing and pressing Start produces the next action');
  pad.buttons[9].pressed = false; input.read();
  pad.buttons[3].pressed = true; input.read(); input.read();
  assert.equal(actions.at(-1), 'recover');
  assert.equal(actions.filter(action => action === 'recover').length, 1, 'controller recovery is edge-triggered');
  pads = []; input.clear();
  assertNeutral('disconnected controllers leave no analog input');

  console.log('Input checks passed: keyboard hold/release, editable focus, blur/visibility reset, multi-touch cancellation, analog gamepad controls, and pause edge retention.');
} finally {
  for (const [key, descriptor] of Object.entries(previousGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
