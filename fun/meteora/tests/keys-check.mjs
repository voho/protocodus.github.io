// Run with: node tests/keys-check.mjs
// The on-screen key guide, the actions the controls know and their default
// keys come from different modules; this keeps them describing the same
// keyboard, and checks that a rebound key prints as itself.
import { test, run, assert } from './harness.mjs';
import { KEY_GUIDE, PAD_GUIDE, capOf, capsFor } from '../js/keys.js';
import { ACTIONS, DEFAULT_KEYS, createControlState, keyDown, readInput, rebind } from '../js/controls.js';

const guided = KEY_GUIDE.flatMap(group => group.items.flatMap(item => item.actions ?? []));

test('every action is in the guide, once', () => {
  for (const [action] of ACTIONS) assert.equal(guided.filter(a => a === action).length, 1, action);
  for (const action of guided) assert.ok(ACTIONS.some(([a]) => a === action), `${action} is not an action`);
});
test('every action has a default key, and no key does two things', () => {
  for (const [action] of ACTIONS) assert.ok(DEFAULT_KEYS[action], action);
  const codes = Object.values(DEFAULT_KEYS);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(!codes.includes('Escape'), 'Esc stays the pause key');
});
test('caps print the key as it is on the keyboard, rebound or not', () => {
  assert.deepEqual(capsFor({ actions: ['faster', 'slower'] }), ['W', 'S']);
  assert.deepEqual(capsFor({ actions: ['wingAttack', 'wingCover', 'wingForm'] }), ['1', '2', '3']);
  assert.deepEqual(capsFor({ actions: ['faster'] }, { ...DEFAULT_KEYS, faster: 'ArrowUp' }), ['↑']);
  for (const [code, cap] of [['Tab', 'Tab'], ['ShiftLeft', 'L Shift'], ['Space', 'Space'], ['Numpad4', 'Num 4'], ['Semicolon', ';'], ['F7', 'F7']]) assert.equal(capOf(code), cap);
});
test('a rebound key flies the ship; the old one no longer does', () => {
  const settings = { keys: { faster: 'ArrowUp' } };
  const s = createControlState(settings);
  keyDown(s, 'KeyW');
  assert.equal(readInput(s, 1 / 60).throttleDelta, 0);
  keyDown(s, 'ArrowUp');
  assert.equal(readInput(s, 1 / 60).throttleDelta, 1);
  settings.keys = { faster: 'KeyI' };
  rebind(s);
  keyDown(s, 'KeyI');
  assert.equal(readInput(s, 1 / 60).throttleDelta, 1);
});
test('every entry has a label and a printable cap per key', () => {
  for (const group of [...KEY_GUIDE, PAD_GUIDE]) {
    assert.ok(group.title);
    for (const item of group.items) {
      const caps = capsFor(item);
      assert.ok(item.label && caps.length > 0 && caps.every(c => c && c !== '—'), JSON.stringify(item));
    }
  }
});
test('the guide explains the mouse: aim, cannons and missiles', () => {
  const mouse = KEY_GUIDE.flatMap(group => group.items).filter(item => item.mouse).map(item => item.mouse);
  assert.deepEqual(mouse.sort(), ['aim', 'left', 'right']);
});
await run();
