// Run with: node tests/input-device-check.mjs
// Device hints observe intent without becoming an input-ownership switch.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createInput } from '../js/input.js';
import { Rider } from '../js/rider.js';
import { RIDER, SCORE } from '../js/config.js';

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
// Recording APIs exercise ownership and native promise ordering; they make
// no claim about a physical controller or phone motor.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const oldPerformance = globalThis.performance;
let hapticTime = 0;
globalThis.performance = { now: () => hapticTime };
function hapticFixture(phone = false) {
  hapticTime = 0;
  const f = { browser: new EventTarget(), plays: [], resets: [], buzzes: [], queries: 0,
    playMode: 'pending', resetMode: 'pending', buzzAccepted: true };
  const result = (mode, calls, fields) => {
    const request = { ...deferred(), ...fields }; calls.push(request);
    if (mode === 'throw') throw new Error('unsupported');
    if (mode === 'reject') request.reject(new Error('denied'));
    return mode === 'void' ? undefined : request.promise;
  };
  f.actuator = {
    playEffect: (kind, effect) => result(f.playMode, f.plays, { kind, ...effect }),
    reset: () => result(f.resetMode, f.resets, {}),
  };
  f.pad = { ...makePad('haptic pad'), vibrationActuator: f.actuator };
  f.pads = phone ? [] : [f.pad];
  globalThis.window = f.browser;
  f.browser.setTimeout = () => assert.fail('haptic ownership needs no wall timer');
  f.browser.clearTimeout = () => {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    getGamepads: () => { f.queries++; return f.pads; },
    userActivation: { hasBeenActive: true },
    vibrate: duration => {
      f.buzzes.push(duration);
      if (f.buzzAccepted === 'throw') throw new Error('blocked');
      return f.buzzAccepted;
    },
  } });
  f.input = createInput(f.browser, { key: event => f.onKey?.(event), cancelJump: () => f.cancelJump?.() });
  if (phone) f.input.bindTouch({ querySelectorAll: () => [] });
  f.rumble = (duration = 380) => f.input.rumble(1, 1, duration);
  f.zeroes = () => f.plays.filter(p => p.weakMagnitude === 0 && p.strongMagnitude === 0);
  return f;
}
async function haptics(phone, run) {
  const f = hapticFixture(phone);
  try { await run(f); } finally { f.input.dispose(); await flush(); }
}

try {
  // Use the real crash and interruption handlers, not a substitute pause.
  const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
  const section = (from, to) => {
    const start = source.indexOf(from), end = source.indexOf(to, start);
    assert(start >= 0 && end > start, 'locate production interruption handler');
    return source.slice(start, end);
  };
  const handlers = new vm.Script([
    section('function cancelJump() {', '\nconst input = createInput'),
    section('function pause() {', '\nlet lastPassedGate'),
    section('function restartRun() {', '\n/* Any key starts'),
    section('function onKey(e) {', '\nfunction onMenuAction('),
    section("touchPause?.addEventListener('click'", "touchMute?.addEventListener('click'"),
    section("canvas.addEventListener('webglcontextlost'", "\ncanvas.addEventListener('webglcontextrestored'"),
    section("rider.on('fall',", "\nrider.on('impact',"),
  ].join('\n'));
  for (const [phone, cause] of [[false, 'Escape'], [false, 'Start'], [true, 'touch'],
    [false, 'context loss'], [true, 'context loss'], [false, 'KeyR'], [true, 'KeyR'], [false, 'Back']]) await haptics(phone, async f => {
    const rider = new Rider(THREE, { height: () => 0, canStall: () => false });
    rider.vel.set(0, 0, -20);
    const game = { mode: 'playing', flow: .5, flowHold: 0, combo: 1 };
    const canvas = new EventTarget(), touchPause = new EventTarget();
    let quiets = 0;
    const context = vm.createContext({ rider, game, canvas, touchPause, input: f.input, RIDER, SCORE,
      curtainPointers: new Map(), curtainClickReady: false, curtainClickDevice: null,
      pausedRendered: false, pausedWorldReady: false, contextLost: false, rearmProps: false,
      runStarted: true, bootReady: true, controllerNotice: { hidden: true },
      restart() { rider.reset(-1000, 0); }, showMuted() {}, trackRunStart() {},
      curtain: { dataset: {}, classList: { add() {}, remove() {} }, querySelector: () => null },
      audio: { crash() {}, quiet() { quiets++; }, start() {} }, retro: { crash() {}, fade() {} }, chase: { kick() {} },
      spray: { burst() {} }, hud: { clearBanner() {}, banner() {} }, persistBest() {}, syncCombo() {},
    });
    handlers.runInContext(context); f.onKey = context.onKey; f.cancelJump = context.cancelJump;
    send(f.browser, 'keydown', { code: 'KeyW', key: 'w' }); f.input.update(1 / 60);
    assert.equal(rider.strike(0, 1, 1), 'fall');
    if (phone) assert.deepEqual(f.buzzes, [187]); else assert.equal(f.plays[0].duration, 380);
    hapticTime = 20;
    if (cause === 'Escape') send(f.browser, 'keydown', { code: 'Escape', key: 'Escape' });
    else if (cause === 'Start') { f.pad.buttons[9].pressed = true; f.input.update(1 / 60); }
    else if (cause === 'KeyR') send(f.browser, 'keydown', { code: 'KeyR', key: 'r' });
    else if (cause === 'Back') { f.pad.buttons[8].pressed = true; f.input.update(1 / 60); }
    else if (cause === 'touch') send(touchPause, 'click', { detail: 1 });
    else send(canvas, 'webglcontextlost');
    const restarted = cause === 'KeyR' || cause === 'Back';
    assert.equal(game.mode, restarted ? 'playing' : 'paused');
    assert.equal(quiets, 1, cause + ': interruption retires old audio');
    if (phone) assert.deepEqual(f.buzzes, [187, 0], 'interruption cancels the owned phone cue');
    else assert.equal(f.resets.length, 1, 'interruption resets the owned controller cue');
    f.input.update(1 / 60, !restarted);
    assert.equal(f.input.state.tuck, true, 'stopping feedback preserves a physically held key');
    if (restarted) {
      assert.equal(rider.state, 'ride'); assert.equal(rider.pos.z, -1000);
      f.rumble(70);
      if (phone) assert.deepEqual(f.buzzes, [187, 0, 70], 'the fresh run can buzz immediately');
      else assert.equal(f.plays.length, 2, 'the fresh run can rumble immediately');
    }
  });

  for (const method of ['calm', 'clear', 'dispose', 'orientationchange']) {
    for (const phone of [false, true]) await haptics(phone, async f => {
      f.rumble(); const queries = f.queries;
      if (method === 'orientationchange') send(f.browser, method); else f.input[method]();
      assert.equal(f.queries, queries, 'cleanup never polls or resets unrelated controllers');
      if (phone) assert.deepEqual(f.buzzes, [200, 0]); else assert.equal(f.resets.length, 1);
    });
  }
  await haptics(false, async f => {
    f.input.calm(); assert.equal(f.resets.length, 0, 'idle cleanup never stops an external effect');
    f.rumble(300); const older = f.plays[0];
    hapticTime = 10; f.rumble(300); older.resolve('preempted'); await flush();
    f.input.calm(); f.input.calm();
    assert.equal(f.resets.length, 1, 'old completion cannot forget a newer effect or duplicate a pending reset');
    hapticTime = 20; f.rumble(300);
    f.resets[0].reject(new Error('reset denied')); await flush();
    assert.equal(f.zeroes().length, 0, 'late reset rejection cannot cancel a new resumed cue');
    f.input.calm(); assert.equal(f.resets.length, 2, 'the new cue retains independent cancellation ownership');
  });
  for (const mode of ['absent', 'throw', 'reject']) await haptics(false, async f => {
    if (mode === 'absent') delete f.actuator.reset; else f.resetMode = mode;
    f.rumble(); f.input.calm(); await flush();
    assert.equal(f.zeroes().length, 1, mode + ': reset falls back to one zero-strength effect');
    f.zeroes()[0].resolve('complete'); await flush(); f.input.calm();
    assert.equal(f.zeroes().length, 1, 'a completed stop releases ownership');
  });
  for (const failure of ['throw', 'reject']) await haptics(false, async f => {
    f.rumble(); f.playMode = failure; hapticTime = 10; f.rumble(); await flush();
    f.input.calm(); assert.equal(f.resets.length, 1, 'a rejected replacement preserves the old live effect');
  });
  await haptics(false, async f => {
    f.rumble(); f.input.calm();
    hapticTime = 10; f.rumble();
    f.resets[0].reject(new Error('reset denied')); await flush();
    assert.equal(f.zeroes().length, 0);
    f.plays[1].reject(new Error('replacement denied')); await flush();
    assert.equal(f.zeroes().length, 1, 'if the replacement also fails, cancellation still reaches the old cue');
  });
  for (const pendingReset of [false, true]) await haptics(false, async f => {
    f.rumble();
    if (pendingReset) { hapticTime = 20; f.input.calm(); }
    // Chromium can create a new actuator wrapper for a reused pad slot,
    // while calls through the old wrapper still address that same slot.
    const replacement = { ...f.actuator };
    f.pads = [{ ...makePad('replacement in slot zero'), vibrationActuator: replacement }];
    hapticTime = 30; f.rumble(300);
    if (pendingReset) {
      hapticTime = 40; f.resets[0].reject(new Error('old controller disconnected')); await flush();
      assert.equal(f.zeroes().length, 0, 'old actuator fallback cannot zero the replacement controller');
    }
    f.input.calm();
    assert.equal(f.resets.length, pendingReset ? 2 : 1,
      'cleanup owns only the newly used actuator in the reused slot');
  });
  for (const ended of ['complete', 'expired', 'shorter replacement', 'failed first']) await haptics(false, async f => {
    f.rumble(300);
    if (ended === 'complete') f.plays[0].resolve('complete');
    else if (ended === 'failed first') f.plays[0].reject(new Error('denied'));
    else if (ended === 'shorter replacement') { hapticTime = 10; f.rumble(20); hapticTime = 31; }
    else hapticTime = 301;
    await flush(); f.input.calm();
    assert.equal(f.resets.length, 0, ended + ': cleanup cannot stop an unowned effect');
  });
  await haptics(false, async f => {
    f.rumble(30); f.input.calm(); hapticTime = 31;
    f.resets[0].reject(new Error('late reset failure')); await flush();
    assert.equal(f.zeroes().length, 0, 'expired cancellation cannot replace an external effect');
  });
  await haptics(false, async f => {
    f.playMode = 'void'; f.rumble(100); hapticTime = 20; f.input.calm();
    assert.equal(f.resets.length, 1, 'hosts without completion promises retain ownership until the deadline');
  });
  for (const failure of [false, 'throw']) await haptics(true, async f => {
    f.rumble(); f.buzzAccepted = failure; hapticTime = 20; f.rumble(30);
    f.buzzAccepted = true; f.input.calm(); f.input.calm();
    assert.deepEqual(f.buzzes, [200, 30, 0], 'failed phone requests preserve the prior accepted buzz, stopped once');
  });
  for (const state of ['idle', 'expired', 'denied']) await haptics(true, async f => {
    if (state !== 'idle') { f.buzzAccepted = state !== 'denied'; f.rumble(); }
    if (state === 'expired') hapticTime = 201;
    f.input.calm(); assert(!f.buzzes.includes(0), state + ': cleanup leaves unrelated phone vibration alone');
  });
} finally {
  globalThis.performance = oldPerformance;
  globalThis.window = browser;
}
console.log('Input-device checks passed: fresh activity, mixed ownership, menu provenance, touch capability, and owned haptic cancellation across interruptions and promise races.');
