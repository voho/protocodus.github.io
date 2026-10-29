import assert from 'node:assert/strict';
import { createTouchControls } from '../touch-input.js';

// Exercise the actual adapter without a browser; capture loss is synchronous
// here to catch reset/release reentrancy rather than just checking booleans.
class Target {
  constructor(size = 84) {
    this.size = size; this.listeners = new Map(); this.captures = new Set();
    this.dataset = {}; this.properties = new Map(); this.failCapture = false;
    this.style = { setProperty: (key, value) => this.properties.set(key, value) };
  }
  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || []; callbacks.push(callback); this.listeners.set(name, callbacks);
  }
  getBoundingClientRect() { return { width: this.size, height: this.size }; }
  setPointerCapture(id) { if (this.failCapture) throw Error('No active pointer'); this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { if (this.captures.delete(id)) this.emit('lostpointercapture', id); }
  emit(type, id, extra = {}) {
    const event = { pointerId: id, pointerType: 'touch', clientX: 100, clientY: 100,
      preventDefault() { this.consumed = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    for (const callback of this.listeners.get(type) || []) callback(event);
    return event;
  }
}
function setup(size) {
  const root = new Target(), stick = new Target(size), buttons = { fire: new Target(), secondary: new Target(), bomb: new Target() };
  let playing = true, gestures = 0;
  const input = createTouchControls({ stick, buttons, clickRoot: root, isPlaying: () => playing, onGesture: () => gestures++ });
  return { root, stick, buttons, input, setPlaying: value => playing = value, gestures: () => gestures };
}
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} ~= ${expected}`);

// Every action stays independent with multiple simultaneous fingers.
{
  const { stick, buttons, input, gestures } = setup();
  stick.emit('pointerdown', 1); stick.emit('pointermove', 1, { clientX: 130 });
  buttons.fire.emit('pointerdown', 2); buttons.secondary.emit('pointerdown', 3); buttons.bomb.emit('pointerdown', 4);
  assert.equal(input.x, 1); assert(input.fire && input.secondary && input.bomb); assert.equal(gestures(), 4);
  buttons.fire.emit('pointerup', 99); buttons.fire.emit('pointerdown', 5); buttons.fire.emit('pointercancel', 5);
  assert(input.fire, 'an unowned second finger cannot release the first');
  buttons.secondary.emit('pointercancel', 3);
  assert(input.fire && input.bomb && !input.secondary);
  buttons.fire.emit('pointerup', 2);
  assert(!input.fire && input.bomb && input.pointer === 1);
  buttons.bomb.releasePointerCapture(4);
  assert(!input.bomb, 'capture loss releases its owner');
  stick.emit('pointerup', 99); assert.equal(input.x, 1);
  stick.emit('pointerup', 1); assert.equal(input.x, 0); assert.equal(input.pointer, null);
}

// Reset releases every capture after clearing ownership, even with synchronous
// lostpointercapture callbacks; old events cannot cancel a new gesture.
{
  const { stick, buttons, input } = setup();
  stick.emit('pointerdown', 1); buttons.fire.emit('pointerdown', 2);
  buttons.secondary.emit('pointerdown', 3); buttons.bomb.emit('pointerdown', 4);
  input.reset();
  assert.equal(input.pointer, null); assert.equal(input.x, 0); assert.equal(input.y, 0);
  for (const target of [stick, ...Object.values(buttons)]) assert.equal(target.captures.size, 0);
  assert(!input.fire && !input.secondary && !input.bomb);
  assert.equal(buttons.fire.dataset.held, 'false'); assert.equal(stick.properties.get('--stick-x'), '0px');
  buttons.fire.emit('pointerdown', 7); buttons.fire.emit('lostpointercapture', 2);
  assert(input.fire); buttons.fire.emit('pointerup', 7); assert(!input.fire);
  stick.emit('pointermove', 1, { clientX: 300 }); assert.equal(input.x, 0);
  input.reset(); input.reset();
}

// Assist needs an owned stick, including a neutral stick; it never fires
// Plasma/Nova or overrides a manual primary gesture. It starts off.
{
  const { stick, buttons, input, gestures } = setup();
  assert(!input.assist); stick.emit('pointerdown', 1); assert(!input.fire);
  input.setAssist(true);
  assert(input.fire && !input.secondary && !input.bomb); assert.equal(gestures(), 1);
  assert.equal(buttons.fire.dataset.held, 'true');
  buttons.secondary.emit('pointerdown', 2); assert(input.secondary && input.fire);
  buttons.secondary.emit('pointerup', 2);
  input.setAssist(false); assert(!input.fire && input.pointer === 1);
  buttons.fire.emit('pointerdown', 3); input.setAssist(true); stick.emit('pointercancel', 1);
  assert(input.fire, 'manual primary survives steering cancellation');
  buttons.fire.emit('pointerup', 3); assert(!input.fire);
  stick.emit('pointerdown', 4); assert(input.fire);
  stick.releasePointerCapture(4); assert(!input.fire);
  stick.emit('pointerdown', 5); input.reset(); assert(!input.fire && input.assist);
}

// Dead zone rejects resting-thumb drift, diagonals have the same maximum
// speed as axes, and the smaller landscape stick reaches full speed.
{
  const { stick, input } = setup();
  stick.emit('pointerdown', 1);
  stick.emit('pointermove', 9, { clientX: 300 }); assert.equal(input.x, 0);
  stick.emit('pointermove', 1, { clientX: 102 }); assert.equal(input.x, 0);
  stick.emit('pointermove', 1, { clientX: 116.5 }); close(input.x, .5);
  stick.emit('pointermove', 1, { clientX: 160, clientY: 160 });
  close(Math.hypot(input.x, input.y), 1); close(input.x, input.y);
  const small = setup(70);
  small.stick.emit('pointerdown', 2); small.stick.emit('pointermove', 2, { clientX: 124 });
  close(small.input.x, 1);
}

// Mouse and inactive scenes cannot drive touch input. Failed capture cannot
// strand a held action. Pen uses the same ownership rules as touch.
{
  const { stick, buttons, input, setPlaying, gestures } = setup();
  stick.emit('pointerdown', 1, { pointerType: 'mouse' });
  buttons.fire.emit('pointerdown', 2, { pointerType: 'mouse' });
  assert.equal(input.pointer, null); assert(!input.fire); assert.equal(gestures(), 0);
  setPlaying(false); stick.emit('pointerdown', 3); buttons.bomb.emit('pointerdown', 4);
  assert.equal(input.pointer, null); assert(!input.bomb);
  setPlaying(true); buttons.fire.failCapture = true; buttons.fire.emit('pointerdown', 5);
  assert(!input.fire); buttons.fire.failCapture = false;
  stick.emit('pointerdown', 6, { pointerType: 'pen' });
  buttons.fire.emit('pointerdown', 7, { pointerType: 'pen' });
  assert.equal(input.pointer, 6); assert(input.fire); assert.equal(gestures(), 2);
  setPlaying(false); input.reset(); assert(!input.fire); assert.equal(input.pointer, null);
}
// Touch releases cannot activate a pause control revealed under the finger.
// A fresh gesture (including reused IDs) and keyboard activation remain usable.
{
  const { root, stick, buttons, input } = setup();
  stick.emit('pointerdown', 1); input.reset();
  const old = root.emit('click', 1);
  assert(old.consumed && old.stopped, 'a click from the old flight gesture is blocked at capture');
  buttons.fire.emit('pointerdown', 2); buttons.fire.emit('pointerup', 2);
  assert(root.emit('click', 2).consumed, 'pointer-driven weapon buttons do not need compatibility clicks');
  stick.emit('pointerdown', 3); input.reset();
  root.emit('pointerdown', 3);
  assert(!root.emit('click', 3).consumed, 'a fresh menu gesture may reuse a cancelled pointer ID');
  stick.emit('pointerdown', 4);
  assert(!root.emit('click', 99).consumed, 'another pointer remains independent');
  assert(!root.emit('click', -1).consumed, 'keyboard activation remains independent');
  assert(!root.emit('click', undefined).consumed, 'programmatic activation remains independent');
  input.reset();
  stick.emit('pointerdown', 5, { pointerType: 'mouse' });
  assert(!root.emit('click', 5).consumed, 'mouse control gestures are not captured');
  for (let id = 10; id < 50; id++) { stick.emit('pointerdown', id); stick.emit('pointercancel', id); }
  assert(!root.emit('click', 10).consumed, 'abandoned click ownership is bounded');
  assert(root.emit('click', 49).consumed, 'the newest cancelled control gesture remains protected');
}
console.log('Touch input: ownership, cancellation, reset, assist, dead zone, capture and pause-click checks passed.');
