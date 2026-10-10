// Run with: node tests/input-check.mjs
// Pointer lock behaves differently per browser: Chrome returns a promise that
// settles once locked, Safari returns nothing and locks a moment later, and
// a refused lock only fires `pointerlockerror`. These fakes reproduce each.
import { test, run, assert, near } from './harness.mjs';
import { createInput } from '../js/input.js';
import { createControlState, keyDown, readInput } from '../js/controls.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const event = (type, props = {}) => Object.assign(new Event(type), props);

function setup({ request } = {}) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null, hidden: false,
    exits: 0,
    exitPointerLock() {
      this.exits++;
      this.pointerLockElement = null;
      this.dispatchEvent(event('pointerlockchange'));
    },
  });
  const canvas = Object.assign(new EventTarget(), {
    requests: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
  });
  const grant = () => { doc.pointerLockElement = canvas; doc.dispatchEvent(event('pointerlockchange')); };
  const refuse = () => doc.dispatchEvent(event('pointerlockerror'));
  canvas.requestPointerLock = (...args) => { canvas.requests++; return (request ?? (() => { setTimeout(grant); }))({ grant, refuse, args }); };
  const state = createControlState({ sensitivity: 1, invertPitch: false, vibration: true });
  const pauses = [];
  const input = createInput(canvas, state, { isFlying: () => true, onPause: reason => pauses.push(reason) },
    { window: win, document: doc });
  return { win, doc, canvas, state, input, pauses, grant };
}

test('a lock that arrives after a request returning nothing does not pause (Safari)', async () => {
  const s = setup();
  s.input.engage();
  await tick(); await tick();
  assert.deepEqual(s.pauses, []);
  assert.equal(s.input.mode, 'locked');
});
test('a lock granted through a promise does not pause (Chrome)', async () => {
  const s = setup({ request: ({ grant }) => new Promise(resolve => setTimeout(() => { grant(); resolve(); })) });
  s.input.engage();
  await tick(); await tick();
  assert.deepEqual(s.pauses, []);
  assert.equal(s.input.mode, 'locked');
});
test('a refused lock falls back to cursor steering instead of pausing', async () => {
  const s = setup({ request: ({ refuse }) => { setTimeout(refuse); return Promise.reject(new Error('denied')); } });
  s.input.engage();
  await tick(); await tick();
  assert.deepEqual(s.pauses, []);
  assert.equal(s.input.mode, 'cursor');
  s.doc.dispatchEvent(event('mousemove', { clientX: 1000, clientY: 400, movementX: 0, movementY: 0 }));
  near(readInput(s.state).yaw, 1, 1e-9, 'cursor at the right edge is full right yaw');
  s.doc.dispatchEvent(event('mousemove', { clientX: 500, clientY: 400, movementX: 0, movementY: 0 }));
  near(readInput(s.state).yaw, 0, 1e-9, 'centred cursor is no turn');
});
test('losing a held lock pauses once and drops held keys', async () => {
  const s = setup();
  s.input.engage();
  await tick(); await tick();
  keyDown(s.state, 'KeyW');
  s.doc.pointerLockElement = null;
  s.doc.dispatchEvent(event('pointerlockchange'));
  assert.deepEqual(s.pauses, ['lock']);
  assert.equal(readInput(s.state).throttleDelta, 0);
  assert.equal(s.input.mode, 'cursor');
});
test('Escape pauses when flying without a lock', () => {
  const s = setup();
  s.win.dispatchEvent(event('keydown', { code: 'Escape', repeat: false }));
  assert.deepEqual(s.pauses, ['escape']);
});
test('a click while flying without a lock fires and asks for the lock again', () => {
  const s = setup({ request: () => undefined });
  s.canvas.dispatchEvent(event('mousedown', { button: 0 }));
  assert.equal(readInput(s.state).fire, true);
  assert.equal(s.canvas.requests, 1);
});
test('release gives the pointer back so the pause screen can be clicked', async () => {
  const s = setup();
  s.input.engage();
  await tick(); await tick();
  s.input.release();
  assert.equal(s.doc.exits, 1);
  assert.equal(s.doc.pointerLockElement, null);
});
await run();
