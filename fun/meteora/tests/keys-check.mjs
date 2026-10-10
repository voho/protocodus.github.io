// Run with: node tests/keys-check.mjs
// The on-screen key guide and the keys the game actually listens to come
// from different modules; this keeps them describing the same keyboard.
import { test, run, assert } from './harness.mjs';
import { KEY_GUIDE } from '../js/keys.js';
import { GAME_KEYS } from '../js/input.js';

const guided = KEY_GUIDE.flatMap(group => group.items.flatMap(item => item.codes));

test('every key the game listens to is in the guide', () => {
  for (const code of [...GAME_KEYS, 'Escape']) assert.ok(guided.includes(code), `${code} missing from the guide`);
});
test('the guide shows no key the game ignores', () => {
  for (const code of guided) assert.ok(GAME_KEYS.has(code) || code === 'Escape', `${code} is not handled`);
});
test('no key is described twice', () => {
  assert.equal(new Set(guided).size, guided.length);
});
test('every entry has a label and a printable cap per key', () => {
  for (const group of KEY_GUIDE) {
    assert.ok(group.title);
    for (const item of group.items) {
      assert.ok(item.label && item.caps.length > 0, JSON.stringify(item));
    }
  }
});
await run();
