// Run with: node fun/zipper/tests/input-batching-check.mjs
import assert from 'node:assert/strict';
import * as logic from '../js/puzzle.js';
import { gameHarness } from '../../shared/tests/interaction-harness.mjs';

const puzzle = {
  size: 3, waypoints: [0, 8], numbers: [1, 0, 0, 0, 0, 0, 0, 0, 2], walls: [],
  solution: [0, 1, 2, 5, 4, 3, 6, 7, 8], neighbours: logic.neighbourTable(3, []),
};
const game = await gameHarness('zipper', puzzle, logic);
const updates = () => game.mutations.filter(([kind]) => kind === 'path').length;
game.pointer('pointerdown', 0);
let before = updates();
game.pointer('pointermove', 2);
assert.deepEqual(game.path(), [0, 1, 2]);
assert.equal(updates() - before, 1, 'a swipe uploads its completed line once, including skipped cells');

before = updates();
game.pointer('pointermove', 3, 1, {
  getCoalescedEvents: () => [
    { clientX: 200, clientY: 100 }, { clientX: 100, clientY: 100 }, { clientX: 0, clientY: 100 },
  ],
});
assert.deepEqual(game.path(), [0, 1, 2, 5, 4, 3]);
assert.equal(updates() - before, 1, 'coalesced corners retain every step with one geometry update');

before = updates();
game.pointer('pointermove', 5);
assert.deepEqual(game.path(), [0, 1, 2, 5]);
assert.equal(updates() - before, 1, 'a fast retrace publishes its final head once');

before = updates();
game.pointer('pointermove', 8, 1, {
  getCoalescedEvents: () => [
    { clientX: 100, clientY: 100 }, { clientX: 0, clientY: 100 },
    { clientX: 0, clientY: 200 }, { clientX: 100, clientY: 200 },
  ],
});
assert.deepEqual(game.path(), puzzle.solution, 'the solved path is published before celebration');
assert.equal(updates() - before, 1, 'a solve does not upload the final path twice');
assert.equal(game.finishes, 1);
assert.equal(game.progress.at(-1)[0], 9);
console.log('Zipper input batching checks passed: swipes, coalesced corners, retracing and solving publish once per event.');
