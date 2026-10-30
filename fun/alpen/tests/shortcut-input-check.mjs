// Run with: node tests/shortcut-input-check.mjs
// Execute production input, main's key hook and its frame-input latch.
// Navigation, audio and menu actions are recorded instead of affecting a page.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createInput } from '../js/input.js';

const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert(start >= 0 && end > start, 'locate production input logic: ' + from);
  return source.slice(start, end);
}
const handler = new vm.Script(section('function onKey(e) {', '\nfunction onMenuAction('));
const frame = new vm.Script(section('  // Controllers have no key events:', '  const running ='));
const clicks = new vm.Script(section("curtain.addEventListener('click', (e) => {",
  "\ndocument.addEventListener('visibilitychange'"));
const dt = 1 / 120;
const previousWindow = globalThis.window;
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const send = (target, type, values) => {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  target.dispatchEvent(event);
  return event;
};
class Button extends EventTarget {
  dataset = { key: 'jump' };
  classList = { toggle() {}, remove() {} };
  setPointerCapture() {}
}
function fixture(mode = 'paused', usePad = false) {
  globalThis.window = new EventTarget();
  const timers = new Map(); let nextTimer = 0;
  window.setTimeout = fn => { timers.set(++nextTimer, fn); return nextTimer; };
  window.clearTimeout = id => timers.delete(id);
  const target = new EventTarget(), button = new Button();
  const pad = { id: 'shortcut check', index: 0, axes: [0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true,
    value: { getGamepads: () => usePad ? [pad] : [] } });
  const game = { mode, manualWeather: 0 }, actions = [], hooks = [];
  const curtain = new EventTarget(), restart = new EventTarget();
  const touchPause = new EventTarget(), touchMute = new EventTarget();
  curtain.querySelector = () => restart;
  let cancellations = 0;
  let input;
  const context = vm.createContext({
    game, dt, document: { hidden: false }, curtain, touchPause, touchMute,
    curtainPointers: new Map(), curtainClickReady: false, curtainClickDevice: null,
    begin() { actions.push('begin'); game.mode = 'playing'; },
    pause() { actions.push('pause'); game.mode = 'paused'; input.calm(); },
    restartRun() { actions.push('restart'); game.mode = 'playing'; },
    newMountain() { actions.push('new mountain'); },
    audio: { toggleMute() { actions.push('mute'); return true; } }, showMuted() {},
    weather: { pin() { actions.push('weather'); }, release() { actions.push('weather'); } },
  });
  handler.runInContext(context);
  input = createInput(target, {
    key: event => { hooks.push(event.code); context.onKey(event); },
    cancelJump: () => cancellations++,
  });
  context.input = input;
  clicks.runInContext(context);
  input.setDevice('gamepad');
  const key = (code, modifiers = {}) => ({
    code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code === 'NumpadEnter' ? 'Enter' : code,
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, ...modifiers,
  });
  return { input, game, actions, hooks, pad, button, curtain, restart, touchPause, touchMute, timers,
    get cancellations() { return cancellations; },
    down: (code, modifiers) => send(target, 'keydown', key(code, modifiers)).defaultPrevented,
    up: (code, modifiers) => send(target, 'keyup', key(code, modifiers)).defaultPrevented,
    keyAt: (el, type, code, modifiers) => send(target, type, { ...key(code, modifiers), target: el }),
    click: (el, values = {}) => send(el, 'click', { detail: 0, ...values }),
    pointerOrigin: (el, id) => { context.curtainPointers.set(id, 'touch'); },
    flushTimers() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    direct: (code, modifiers) => context.onKey(key(code, modifiers)),
    poll: () => frame.runInContext(context),
    touch: pressed => send(button, pressed ? 'pointerdown' : 'pointerup',
      { pointerId: 1, pointerType: 'touch', button: 0 }),
    dispose: () => input.dispose(),
  };
}
function check(mode, run, usePad = false) {
  const f = fixture(mode, usePad);
  try { run(f); } finally { f.dispose(); }
}
function neutral(f, label) {
  const s = f.input.state;
  assert.deepEqual([s.turnIntent, s.tuck, s.brake, s.jump, s.trickGrab, s.trickFlip],
    [0, false, false, false, false, false], label);
  assert.equal(s.anyPressed, false, label + ': no deferred start/resume edge');
}
try {
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
    const modifiers = { [modifier]: true };
    for (const mode of ['attract', 'paused', 'playing']) {
      check(mode, f => {
        for (const code of ['Space', 'ArrowLeft', 'ArrowDown', 'KeyW', 'KeyS', 'KeyQ', 'KeyE',
          'KeyR', 'KeyN', 'KeyM', 'KeyT', 'Escape', 'Enter', 'NumpadEnter']) {
          assert.equal(f.down(code, modifiers), false, 'system keydown keeps its browser default');
          assert.equal(f.input.state.anyPressed, false, 'system keydown never sets a game edge');
          f.poll(); neutral(f, modifier + '+' + code);
          assert.equal(f.up(code, modifiers), false, 'an unowned keyup keeps its browser default');
          f.poll(); f.input.stepped(); f.poll(); neutral(f, 'a system-key release cannot replay a tap');
        }
        assert.deepEqual(f.hooks, [], 'ignored keyboard chords never reach action hooks');
        assert.deepEqual(f.actions, [], 'ignored keyboard chords never run game actions');
        assert.equal(f.game.mode, mode, 'the real frame latch cannot resume from a system chord');
        assert.equal(f.game.manualWeather, 0);
        assert.equal(f.input.state.device, 'gamepad', 'ignored chords preserve the active prompts');
      });
      check(mode, f => {
        for (const code of ['KeyR', 'KeyN', 'KeyM', 'KeyT', 'Escape']) f.direct(code, modifiers);
        f.poll();
        assert.deepEqual(f.actions, [], 'main also guards modifiers before every shortcut');
        assert.equal(f.game.mode, mode); assert.equal(f.game.manualWeather, 0);
      });
    }
    for (const code of ['KeyS', 'Space']) check('playing', f => {
      assert.equal(f.down(code), true); f.poll(); f.input.stepped();
      assert(f.input.state[code === 'Space' ? 'jump' : 'brake']);
      assert.equal(f.up(code, modifiers), true, 'an owned key releases with a modifier held');
      f.poll(); neutral(f, 'modified keyup releases its owned control');
    });
    check('playing', f => {
      f.down('Space'); f.up('Space', modifiers); // Accepted tap, not yet sampled by physics.
      f.poll(); assert.equal(f.input.state.jump, true, 'a real tap keeps its existing pulse semantics');
      f.input.stepped(); assert.equal(f.input.state.jump, false);
      f.input.stepped(); f.poll(); neutral(f, 'the accepted tap plays exactly once');
      assert.equal(f.down('Space', modifiers), false);
      assert.equal(f.up('Space'), false, 'releasing modifiers first cannot create ownership');
      f.poll(); f.input.stepped(); f.poll(); neutral(f, 'an ignored tap never enters the pulse queue');
    });
    check('playing', f => {
      assert.equal(f.down('ArrowLeft', { ...modifiers, repeat: true }), false,
        'modified auto-repeat is rejected before default prevention');
      f.poll(); neutral(f, 'modified repeat stays inert');
      assert.equal(f.down('ArrowLeft'), true); f.poll();
      assert.equal(f.down('ArrowLeft', { repeat: true }), true, 'ordinary held arrows still prevent scrolling');
      f.poll(); assert.equal(f.input.state.turnIntent, -1);
      assert.deepEqual(f.hooks, ['ArrowLeft'], 'ordinary repeat forwards no new action');
      f.up('ArrowLeft', modifiers); f.poll(); neutral(f, 'modified release ends the owned arrow');
    });
  }
  for (const [code, field, value] of [
    ['KeyW', 'tuck', true], ['KeyA', 'turnIntent', -1], ['KeyS', 'brake', true],
    ['KeyQ', 'trickGrab', true], ['KeyE', 'trickFlip', true], ['Space', 'jump', true],
  ]) check('playing', f => {
    assert.equal(f.down(code, { shiftKey: true }), true, 'Shift retains riding controls');
    f.poll(); assert.equal(f.input.state[field], value);
    assert.equal(f.input.state.device, 'keyboard');
    f.input.stepped(); f.up(code, { shiftKey: true }); f.poll(); neutral(f, 'Shift release stays ordinary');
  });
  for (const modifiers of [{}, { shiftKey: true }]) {
    for (const [code, action] of [['KeyR', 'restart'], ['KeyN', 'new mountain'],
      ['KeyM', 'mute'], ['KeyT', 'weather'], ['Escape', 'begin']]) check('paused', f => {
      f.down(code, modifiers); f.poll();
      assert.deepEqual(f.actions, [action], 'ordinary and Shift shortcuts retain their action');
    });
    check('paused', f => { f.down('KeyW', modifiers); f.poll();
      assert.deepEqual(f.actions, ['begin']); assert.equal(f.input.state.tuck, true); });
  }
  check('playing', f => {
    f.down('KeyS'); f.down('ArrowDown'); f.poll();
    f.up('KeyS', { ctrlKey: true }); f.poll();
    assert.equal(f.input.state.brake, true, 'releasing one key preserves the other brake binding');
    f.up('ArrowDown', { metaKey: true }); f.poll(); neutral(f, 'both brake keys released');
    assert.equal(f.up('Space'), false, 'an unowned ordinary keyup is also ignored');
  });
  for (const owner of ['touch', 'gamepad']) check('playing', f => {
    if (owner === 'touch') { f.input.bindTouch({ querySelectorAll: () => [f.button] }); f.touch(true); }
    else f.pad.buttons[0].pressed = true;
    f.poll(); f.input.stepped(); assert.equal(f.input.state.jump, true);
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
      assert.equal(f.down('Space', { [modifier]: true }), false);
      assert.equal(f.up('Space', { [modifier]: true }), false);
      f.poll(); f.input.stepped();
      assert.equal(f.input.state.jump, true, 'a browser chord cannot release ' + owner + ' charge');
      assert.equal(f.input.state.device, owner);
      assert.equal(f.cancellations, 0, 'ignored chords cannot cancel another source’s charge');
    }
    f.down('Space'); f.poll(); f.input.stepped();
    f.up('Space', { metaKey: true }); f.poll(); f.input.stepped();
    assert.equal(f.input.state.jump, true, 'an owned keyboard release preserves ' + owner + ' charge');
    assert.equal(f.cancellations, 0, 'an owned keyboard release cannot cancel another source’s charge');
    if (owner === 'touch') f.touch(false); else f.pad.buttons[0].pressed = false;
    f.poll(); neutral(f, 'the final physical source releases normally');
  }, owner === 'gamepad');
  // The browser can turn modified Space into a trusted click on keyup.
  // Execute the actual main listeners and touch binding, including the order
  // where the modifier is already released and therefore absent on the click.
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
    for (const route of ['button', 'curtain', 'touchPause', 'touchMute']) {
      for (const releaseModifierFirst of [false, true]) check('paused', f => {
        f.input.bindTouch({ querySelectorAll: () => [f.button] });
        const el = f[route], modifiers = { [modifier]: true };
        const down = f.keyAt(el, 'keydown', 'Space', modifiers);
        assert.equal(down.defaultPrevented, false, 'shortcut activation retains its native key default');
        const release = releaseModifierFirst ? {} : modifiers;
        const up = f.keyAt(el, 'keyup', 'Space', release);
        assert.equal(up.defaultPrevented, false);
        const click = f.click(el, { ...release, isTrusted: true });
        assert.equal(click.defaultPrevented, false, 'ignoring activation does not cancel native link defaults');
        f.poll(); neutral(f, 'native shortcut click stays inert: ' + route);
        assert.deepEqual(f.actions, []); assert.equal(f.game.mode, 'paused');
        assert.equal(f.input.state.device, 'gamepad'); assert.equal(f.cancellations, 0);
        f.flushTimers();
        assert.equal(f.timers.size, 0, 'native activation provenance expires without a pulse timer');
        // A later assistive/controller .click() has no rejected gesture.
        const next = f.click(el); f.poll();
        if (route === 'button') {
          assert.equal(next.defaultPrevented, true); assert.equal(f.input.state.jump, true);
        } else {
          assert.deepEqual(f.actions, [route === 'curtain' ? 'begin' : route === 'touchPause' ? 'pause' : 'mute']);
        }
      });
    }
    for (const code of ['Space', 'Enter', 'NumpadEnter']) check('playing', f => {
      f.input.bindTouch({ querySelectorAll: () => [f.button] });
      f.keyAt(f.button, 'keydown', code, { [modifier]: true });
      // Repeats after modifier release still belong to that ignored gesture.
      assert.equal(f.keyAt(f.button, 'keydown', code, { repeat: true }).defaultPrevented, false,
        'ignored activation repeats keep their native default after modifier release');
      if (code !== 'Space') {
        f.click(f.button, { isTrusted: true }); f.poll(); neutral(f, 'Enter repeat click cannot activate');
      }
      f.keyAt(f.button, 'keyup', code);
      f.click(f.button, { isTrusted: true }); f.poll(); neutral(f, 'released-modifier repeat cannot activate');
      // A new real Enter gesture replaces stale Space click provenance.
      f.keyAt(f.button, 'keydown', 'Enter');
      f.click(f.button, { isTrusted: true }); f.poll();
      assert.equal(f.input.state.jump, true, 'fresh ordinary activation works after the rejected gesture');
    });
    check('paused', f => {
      f.keyAt(f.curtain, 'keydown', 'Space', { [modifier]: true });
      f.click(f.curtain); // HUD controller navigation uses native .click().
      assert.deepEqual(f.actions, ['begin'], 'an unrelated controller activation remains available');
    });
    check('paused', f => {
      f.pointerOrigin(f.curtain, 9);
      const click = f.click(f.curtain, { detail: 1, pointerId: 9, [modifier]: true });
      assert.equal(click.defaultPrevented, false, 'modified pointer activation retains browser defaults');
      assert.deepEqual(f.actions, []); assert.equal(f.input.state.device, 'gamepad');
    });
  }
  for (const shiftKey of [false, true]) check('playing', f => {
    f.input.bindTouch({ querySelectorAll: () => [f.button] });
    f.click(f.button, { shiftKey }); f.poll(); assert.equal(f.input.state.jump, true);
    f.input.stepped(); f.flushTimers(); f.poll(); neutral(f, 'ordinary accessibility click releases');
  });
  for (const reset of ['pointer', 'blur', 'dispose']) check('paused', f => {
    f.keyAt(f.curtain, 'keydown', 'Space', { ctrlKey: true });
    f.keyAt(f.curtain, 'keyup', 'Space');
    if (reset === 'pointer') f.keyAt(f.curtain, 'pointerdown', '');
    else if (reset === 'blur') window.dispatchEvent(new Event('blur'));
    else f.input.dispose();
    assert.equal(f.timers.size, 0, reset + ' cleans pending native activation work');
    assert.equal(f.input.isShortcutClick({ detail: 0, isTrusted: true, target: f.curtain }), false);
  });
  check('paused', f => {
    f.keyAt(f.curtain, 'keydown', 'Space', { ctrlKey: true });
    f.keyAt(f.curtain, 'keyup', 'Space'); f.flushTimers();
    f.click(f.curtain, { isTrusted: true });
    assert.deepEqual(f.actions, ['begin'], 'a shortcut with no native click leaves no stale suppression');
  });
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
  else delete globalThis.navigator;
}
console.log('Shortcut input checks passed: browser-owned chords, main shortcuts/frame latch, keyup ownership, tap pulses, Shift/repeat, mixed ownership and native shortcut-click routes.');
