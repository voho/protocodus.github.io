// Run with: node tests/input-check.mjs
// The DOM wiring for mouse-aim flight, against fake window/document/canvas.
// Pointer lock differs per browser: Chrome returns a promise that settles
// once locked, Safari returns nothing and locks a moment later, and a
// refused lock only fires `pointerlockerror`. The fakes reproduce each.
import { test, run, assert, near } from './harness.mjs';
import { createInput } from '../js/input.js';
import { createControlState, readInput } from '../js/controls.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const event = (type, props = {}) => {
  const e = Object.assign(new Event(type), props);
  e.prevented = false;
  e.preventDefault = () => { e.prevented = true; };
  return e;
};

function setup({ flying = true, request } = {}) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    hidden: false, pointerLockElement: null, exits: 0,
    exitPointerLock() { this.exits++; this.pointerLockElement = null; this.dispatchEvent(event('pointerlockchange')); },
  });
  const canvas = Object.assign(new EventTarget(), {
    requests: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
  });
  const grant = () => { doc.pointerLockElement = canvas; doc.dispatchEvent(event('pointerlockchange')); };
  const refuse = () => doc.dispatchEvent(event('pointerlockerror'));
  canvas.requestPointerLock = () => { canvas.requests++; return (request ?? (() => { setTimeout(grant); }))({ grant, refuse }); };
  const state = createControlState({ invertPitch: false, vibration: true });
  const pauses = [], resumes = [];
  const flags = { flying };
  const input = createInput(canvas, state, {
    isFlying: () => flags.flying,
    onPause: reason => pauses.push(reason),
    onResume: reason => resumes.push(reason),
  }, { window: win, document: doc });
  const press = (code, extra = {}) => { const e = event('keydown', { code, repeat: false, ...extra }); win.dispatchEvent(e); return e; };
  const read = () => readInput(state, 1 / 60);
  return { win, doc, canvas, state, input, pauses, resumes, flags, press, read };
}

test('game keys reach the controls only while flying', () => {
  const s = setup({ flying: false });
  s.press('KeyW'); assert.equal(s.read().throttleDelta, 0);
  s.flags.flying = true;
  s.press('KeyW'); assert.equal(s.read().throttleDelta, 1);
});
test('Escape pauses; Escape while paused resumes; one press never does both', () => {
  const s = setup();
  s.press('Escape');
  s.flags.flying = false;
  assert.deepEqual(s.pauses, ['escape']); assert.deepEqual(s.resumes, []);
  s.press('Escape');
  assert.deepEqual(s.resumes, ['escape']);
});
test('leaving the window pauses and drops held keys', () => {
  const s = setup();
  s.press('KeyW'); s.press('ShiftLeft');
  s.win.dispatchEvent(event('blur'));
  assert.deepEqual(s.pauses, ['blur']);
  const c = s.read(); assert.equal(c.throttleDelta, 0); assert.equal(c.boost, false);
});
test('a hidden tab pauses', () => {
  const s = setup();
  s.doc.hidden = true; s.doc.dispatchEvent(event('visibilitychange'));
  assert.deepEqual(s.pauses, ['hidden']);
});
test('Space and the game keys are kept from the browser while flying', () => {
  const s = setup();
  for (const code of ['Space', 'KeyW', 'KeyA', 'ShiftLeft']) assert.equal(s.press(code).prevented, true, code);
  s.flags.flying = false;
  assert.equal(s.press('Space').prevented, false, 'menus keep their keys');
});
test('a key released while paused does not stay held', () => {
  const s = setup();
  s.press('KeyD'); s.flags.flying = false;
  s.win.dispatchEvent(event('keyup', { code: 'KeyD' }));
  s.flags.flying = true;
  assert.equal(s.read().strafe, 0);
});
test('without a lock the aim cursor follows the pointer across the screen', () => {
  const s = setup({ request: () => undefined });
  s.doc.dispatchEvent(event('mousemove', { clientX: 1000, clientY: 400, movementX: 0, movementY: 0 }));
  assert.deepEqual(s.read().cursor, [1, 0]);
  s.doc.dispatchEvent(event('mousemove', { clientX: 250, clientY: 600, movementX: 0, movementY: 0 }));
  assert.deepEqual(s.read().cursor, [-0.5, 0.5]);
});
test('with a lock, mouse movement moves the aim cursor and it stays on screen', async () => {
  const s = setup();
  s.input.engage(); await tick(); await tick();
  assert.equal(s.input.mode, 'locked');
  s.doc.dispatchEvent(event('mousemove', { clientX: 0, clientY: 0, movementX: 250, movementY: -100 }));
  const c = s.read(); near(c.cursor[0], 0.5, 1e-9); near(c.cursor[1], -0.25, 1e-9);
  s.doc.dispatchEvent(event('mousemove', { clientX: 0, clientY: 0, movementX: 5000, movementY: 0 }));
  assert.equal(s.read().cursor[0], 1);
});
test('a lock that arrives after a request returning nothing does not pause (Safari)', async () => {
  const s = setup();
  s.input.engage(); await tick(); await tick();
  assert.deepEqual(s.pauses, []);
  assert.equal(s.input.mode, 'locked');
});
test('a refused lock keeps flying with the pointer as the aim', async () => {
  const s = setup({ request: ({ refuse }) => { setTimeout(refuse); return Promise.reject(new Error('denied')); } });
  s.input.engage(); await tick(); await tick();
  assert.deepEqual(s.pauses, []); assert.equal(s.input.mode, 'cursor');
});
test('losing a held lock pauses once and drops held input', async () => {
  const s = setup();
  s.input.engage(); await tick(); await tick();
  s.press('KeyW');
  s.doc.pointerLockElement = null; s.doc.dispatchEvent(event('pointerlockchange'));
  assert.deepEqual(s.pauses, ['lock']);
  assert.equal(s.read().throttleDelta, 0);
});
test('a click while flying fires and asks for the lock', () => {
  const s = setup({ request: () => undefined });
  s.canvas.dispatchEvent(event('mousedown', { button: 0 }));
  assert.equal(s.read().fire, true);
  assert.equal(s.canvas.requests, 1);
});
test('release gives the pointer back so the pause screen can be clicked', async () => {
  const s = setup();
  s.input.engage(); await tick(); await tick();
  s.input.release();
  assert.equal(s.doc.exits, 1); assert.equal(s.doc.pointerLockElement, null);
});
await run();
