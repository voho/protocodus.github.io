// Run with: node tests/controller-menu-check.mjs
// Poll the production input layer; callbacks exercise its synchronous menu,
// restart and pause reentrancy. Browser QA covers native focus and activation.
import assert from 'node:assert/strict';
import { createInput } from '../js/input.js';

const makePad = id => ({ id, axes: [0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
const send = (target, type, fields = {}) => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
};

function fixture(options = {}) {
  const browser = new EventTarget();
  globalThis.window = browser;
  const target = new EventTarget();
  const f = { pads: [makePad('first'), ...(options.two ? [makePad('second')] : [])],
    menu: true, actions: [], cancels: 0, losses: 0, device: [] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true,
    value: { getGamepads: () => f.pads } });
  f.input = createInput(target, {
    device: value => f.device.push(value),
    menu: action => { f.actions.push(action); options.menu?.(f, action); },
    key: event => { f.actions.push(event.code); options.key?.(f, event); },
    cancelJump: () => f.cancels++,
    disconnect: () => { f.losses++; options.disconnect?.(f); },
  });
  f.poll = (dt = 1 / 120) => f.input.update(dt, f.menu);
  f.button = (index, pressed, slot = 0) => {
    Object.assign(f.pads[slot].buttons[index], { pressed, value: pressed ? 1 : 0 });
  };
  f.key = (code, pressed = true) => send(target, pressed ? 'keydown' : 'keyup', { code });
  f.remove = slot => {
    const gamepad = f.pads[slot];
    f.pads[slot] = null;
    send(browser, 'gamepaddisconnected', { gamepad });
  };
  f.connect = (slot, pad) => {
    f.pads[slot] = pad;
    send(browser, 'gamepadconnected', { gamepad: pad });
  };
  f.dispose = () => f.input.dispose();
  f.poll();
  return f;
}

// Activate runs only once and owns that A until release, even when the
// callback immediately resumes or clears all input for a restart.
for (const clear of [false, true]) {
  const f = fixture({ menu: (f, action) => {
    if (action === 'activate') { f.menu = false; if (clear) f.input.clear(); }
  } });
  f.button(0, true); f.poll(1 / 240);
  assert.deepEqual(f.actions, ['activate']);
  assert.equal(f.input.state.anyPressed, false);
  for (let i = 0; i < 80; i++) {
    f.poll(1 / 240);
    assert.equal(f.input.state.jump, false, 'menu activation cannot load a gameplay jump');
  }
  f.button(0, false); f.poll(1 / 240);
  assert.equal(f.input.state.jump, false, 'the menu release cannot become a buffered pop');
  f.button(0, true); f.poll(1 / 240);
  assert.equal(f.input.state.jump, true, 'a new gameplay A press works normally');
  f.dispose();
}

// A loading-screen press is consumed rather than queued until the menu
// callback becomes able to begin. Existing held A also cannot accept a menu.
{
  const f = fixture();
  f.button(0, true); f.poll();
  for (let i = 0; i < 60; i++) f.poll();
  assert.deepEqual(f.actions, ['activate']);
  assert.equal(f.input.state.anyPressed, false);
  f.button(0, false); f.poll();
  f.menu = false;
  f.button(0, true); f.poll(); f.input.stepped();
  const before = f.actions.length;
  f.menu = true; f.poll();
  assert.equal(f.actions.length, before, 'held riding A must be released before menu acceptance');
  assert.equal(f.input.state.jump, false);
  assert.equal(f.cancels, 1, 'menu takeover cancels a controller-only charge');
  f.button(0, false); f.poll(); f.button(0, true); f.poll();
  assert.equal(f.actions.at(-1), 'activate');
  f.dispose();
}

// Menu ownership only masks that physical pad. Other sources still own the
// same command, including an A on another pad after the menu has closed.
{
  const f = fixture({ two: true, menu: (f, action) => {
    if (action === 'activate') f.menu = false;
  } });
  f.key('Space'); f.poll(); f.input.stepped();
  f.button(0, true); f.poll();
  assert.equal(f.input.state.jump, true, 'keyboard Space survives a menu A');
  assert.equal(f.cancels, 0);
  f.key('Space', false); f.poll();
  assert.equal(f.input.state.jump, false, 'menu-owned A cannot prolong the keyboard charge');
  f.button(0, true, 1); f.poll();
  assert.equal(f.input.state.jump, true, 'another pad can take gameplay ownership');
  f.button(0, false); f.poll();
  assert.equal(f.input.state.jump, true, 'menu pad release does not release another pad');
  f.dispose();
}

for (const [buttons, expected] of [
  [[0, 1, 8, 9, 13], 'Escape'], [[0, 1, 8, 13], 'KeyR'],
  [[0, 1, 13], 'back'], [[0, 13], 'activate'],
]) {
  const f = fixture({ key: f => { f.input.calm(); f.menu = false; } });
  for (const button of buttons) f.button(button, true);
  f.poll();
  assert.deepEqual(f.actions, [expected], 'one shortcut/action wins a simultaneous poll');
  assert.equal(f.input.state.anyPressed, false);
  for (let i = 0; i < 10; i++) f.poll();
  assert.deepEqual(f.actions, [expected], 'held actions never repeat activation');
  assert.equal(f.input.state.jump, false);
  assert.equal(f.input.state.brake, false, 'menu D-pad never leaks brake after the callback');
  f.dispose();
}

// Navigation repeats by elapsed time, stays quiet around its dead zone, and
// requires neutral when a riding direction was already held before pause.
const repeatCounts = [];
for (const fps of [30, 60, 240]) {
  const f = fixture();
  f.pads[0].axes[1] = 0.8;
  f.poll(1 / fps);
  for (let frame = 0; frame < fps; frame++) f.poll(1 / fps);
  repeatCounts.push(f.actions.length);
  assert(f.actions.every(action => action === 'next'));
  f.pads[0].axes[1] = -0.8; f.poll(1 / fps);
  assert.equal(f.actions.at(-1), 'previous', 'direction reversal responds immediately');
  f.pads[0].axes[1] = 0; f.poll();
  const before = f.actions.length;
  for (const value of [0.3, 0.5, -0.4, 0.2]) { f.pads[0].axes[1] = value; f.poll(); }
  assert.equal(f.actions.length, before, 'subthreshold stick motion cannot move focus');
  f.menu = false; f.pads[0].axes[1] = 0.8; f.poll();
  f.menu = true;
  for (let frame = 0; frame < fps; frame++) f.poll(1 / fps);
  assert.equal(f.actions.length, before, 'an already held riding axis cannot become menu navigation');
  f.pads[0].axes[1] = 0; f.poll(); f.pads[0].axes[1] = 0.8; f.poll();
  assert.equal(f.actions.length, before + 1);
  f.dispose();
}
assert.deepEqual(repeatCounts, [6, 6, 6], 'repeat rate is independent of display frequency');

{
  const f = fixture({ key: f => { f.menu = false; } });
  f.button(12, true); f.poll();
  assert.deepEqual(f.actions, ['previous']);
  f.key('KeyW');
  f.button(9, true); f.poll();
  assert.equal(f.input.state.tuck, true, 'keyboard boost is still independent');
  f.key('KeyW', false); f.poll();
  assert.equal(f.input.state.tuck, false, 'menu D-pad cannot prolong keyboard boost');
  f.button(12, false); f.poll(); f.button(12, true); f.poll();
  assert.equal(f.input.state.tuck, true, 'fresh gameplay D-pad boost remains available');
  f.dispose();
}

// Focus suppression includes the previously unused vertical stick and B.
for (const control of ['vertical', 'cancel']) {
  const f = fixture();
  f.input.clear();
  if (control === 'vertical') f.pads[0].axes[1] = 0.8;
  else f.button(1, true);
  f.button(0, true); f.poll();
  for (let i = 0; i < 20; i++) f.poll();
  assert.deepEqual(f.actions, [], 'focus-suppressed menu input cannot escape');
  f.button(0, false); f.button(1, false); f.pads[0].axes[1] = 0; f.poll();
  f.button(0, true); f.poll();
  assert.deepEqual(f.actions, ['activate']);
  f.dispose();
}

// An A-holder disappearing with an idle pad still connected cancels rather
// than synthesizing a short tap, whether physics consumed that press or not.
for (const stepped of [false, true]) {
  const f = fixture({ two: true, disconnect: f => { f.menu = true; f.input.calm(); } });
  f.menu = false; f.button(0, true); f.poll(1 / 240);
  if (stepped) f.input.stepped();
  f.remove(0); f.poll(1 / 240);
  assert.equal(f.cancels, 1);
  assert.equal(f.losses, 1);
  assert.equal(f.input.state.jump, false);
  assert.equal(f.input.state.anyPressed, false);
  f.poll(); assert.equal(f.losses, 1, 'disconnect is delivered once');
  f.dispose();
}

{
  const f = fixture({ two: true });
  f.menu = false; f.button(0, true); f.poll(); f.input.stepped();
  f.remove(1); f.poll();
  assert.equal(f.losses, 0, 'losing an unrelated idle pad does not pause');
  assert.equal(f.input.state.jump, true);
  assert.equal(f.cancels, 0);
  f.key('Space'); f.poll();
  f.remove(0); f.poll();
  assert.equal(f.losses, 0, 'an intentional keyboard handoff prevents controller-loss auto-pause');
  assert.equal(f.input.state.jump, true, 'keyboard retains a shared charge');
  assert.equal(f.cancels, 0);
  f.dispose();
}

{
  const f = fixture({ two: true });
  f.menu = false;
  f.button(0, true); f.poll(); f.input.stepped();
  f.button(0, true, 1); f.poll();
  f.remove(1); f.poll();
  assert.equal(f.losses, 1, 'the last meaningfully used pad can disappear while another remains');
  assert.equal(f.input.state.jump, true, 'remaining pad retains the combined charge');
  assert.equal(f.cancels, 0);
  f.dispose();
}

{
  const f = fixture({ two: true });
  const touchJump = new EventTarget();
  touchJump.dataset = { key: 'jump' };
  touchJump.classList = { toggle() {}, remove() {} };
  touchJump.setPointerCapture = () => {};
  f.input.bindTouch({ querySelectorAll: () => [touchJump] });
  f.menu = false;
  send(touchJump, 'pointerdown', { pointerId: 1, button: 0 });
  f.poll(); f.input.stepped();
  f.button(0, true); f.poll();
  f.remove(0); f.poll();
  assert.equal(f.losses, 1);
  assert.equal(f.input.state.jump, true, 'touch retains ownership when the active pad disappears');
  assert.equal(f.cancels, 0, 'input loss alone cannot cancel another physical source');
  f.dispose();
}

// The poll also reconciles missing slots if a browser omits or delays the
// disconnect event. Losing an active slot is independent of array length.
{
  const f = fixture({ two: true });
  f.menu = false; f.button(0, true); f.poll(1 / 240);
  f.pads[0] = null;
  f.poll(1 / 240);
  assert.equal(f.losses, 1);
  assert.equal(f.cancels, 1);
  assert.equal(f.input.state.jump, false);
  f.dispose();
}

// Loss wins over every same-poll action. A replacement controller with A or
// Start held must become neutral before it can explicitly resume the menu.
{
  const f = fixture({ two: true, disconnect: f => { f.menu = true; f.input.calm(); } });
  f.menu = false; f.pads[0].axes[0] = 0.8; f.poll();
  f.remove(0);
  f.button(0, true, 1); f.button(9, true, 1);
  f.poll();
  assert.equal(f.losses, 1);
  assert.deepEqual(f.actions, []);
  assert.equal(f.input.state.anyPressed, false);
  const replacement = makePad('replacement');
  replacement.buttons[0].pressed = replacement.buttons[9].pressed = true;
  f.connect(0, replacement);
  for (let i = 0; i < 40; i++) f.poll();
  assert.deepEqual(f.actions, [], 'reconnection with held buttons never resumes');
  f.button(0, false); f.button(9, false); f.poll();
  f.button(0, true); f.poll();
  assert.deepEqual(f.actions, ['activate'], 'neutral then fresh A can resume normally');
  f.dispose();
}

// A known idle controller reconnecting during a keyboard-operated pause
// still needs a new press. First exposure remains usable on browsers that
// reveal a genuinely new controller only after its first button gesture.
{
  const f = fixture();
  f.input.setDevice('keyboard');
  const returning = f.pads[0];
  f.remove(0); f.poll();
  returning.buttons[0].pressed = true;
  f.connect(0, returning);
  for (let i = 0; i < 20; i++) f.poll();
  assert.equal(f.losses, 0);
  assert.deepEqual(f.actions, [], 'known idle reconnect cannot dismiss a keyboard pause');
  f.button(0, false); f.poll(); f.button(0, true); f.poll();
  assert.deepEqual(f.actions, ['activate']);
  f.dispose();
}
{
  const f = fixture();
  const firstSeen = makePad('newly discovered');
  firstSeen.buttons[0].pressed = true;
  f.connect(1, firstSeen); f.poll();
  assert.deepEqual(f.actions, ['activate'], 'new controller discovery can use its actual first A press');
  f.dispose();
}

console.log('Controller-menu checks passed: native action routing, shortcut priority, menu ownership, repeat timing, focus suppression, mixed-source charge, active-pad loss and deliberate reconnect.');
