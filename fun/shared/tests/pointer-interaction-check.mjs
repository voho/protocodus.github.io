// Run with: node fun/shared/tests/pointer-interaction-check.mjs
// Regression coverage for real event handlers, independent of the renderer.
import assert from 'node:assert/strict';
import * as zipper from '../../zipper/js/puzzle.js';
import * as patcher from '../../patcher/js/puzzle.js';
import { gameHarness } from './interaction-harness.mjs';

const zipPuzzle = {
  size: 3, waypoints: [0, 8], numbers: [1, 0, 0, 0, 0, 0, 0, 0, 2], walls: [],
  solution: [0, 1, 2, 5, 4, 3, 6, 7, 8], neighbours: zipper.neighbourTable(3, []),
};
const zip = await gameHarness('zipper', zipPuzzle, zipper);
for (let i = 0; i < 4; i++) zip.key('Backspace');
assert.deepEqual(zip.path(), [0], 'Zipper: Backspace must preserve the starting cell');
zip.pointer('pointerdown', 0);
zip.pointer('pointerdown', 3, 2);
zip.pointer('pointermove', 3, 2);
zip.pointer('pointerup', 3, 2);
assert.deepEqual(zip.path(), [0], 'Zipper: a second finger cannot change the path');
zip.pointer('pointermove', 2);
assert.deepEqual(zip.path(), [0, 1, 2], 'Zipper: fast straight drags fill skipped cells');
zip.pointer('pointermove', 3, 1, {
  getCoalescedEvents: () => [
    { clientX: 200, clientY: 100 }, { clientX: 100, clientY: 100 }, { clientX: 0, clientY: 100 },
  ],
});
assert.deepEqual(zip.path(), [0, 1, 2, 5, 4, 3], 'Zipper: coalesced samples retain corners during a fast drag');
zip.pointer('pointercancel', 3);
zip.pointer('pointermove', 6);
assert.deepEqual(zip.path(), [0, 1, 2, 5, 4, 3], 'Zipper: cancelled touches do not keep drawing');
zip.actions.onUndo();
assert.deepEqual(zip.path(), [0, 1, 2, 5, 4], 'Zipper: Undo removes one cell');
zip.pointer('pointerdown', 4);
zip.actions.onReset();
zip.pointer('pointermove', 3);
assert.deepEqual(zip.path(), [0], 'Zipper: reset cancels the previous drag');
zip.pointer('pointerdown', 0);
zip.pointer('lostpointercapture', 0);
zip.pointer('pointermove', 1);
assert.deepEqual(zip.path(), [0], 'Zipper: lost capture cancels drawing');
zip.pointer('pointerdown', 0);
zip.pointer('pointerup', 2);
assert.deepEqual(zip.path(), [0, 1, 2], 'Zipper: the release position is not lost');
zip.actions.onReset();
zip.pointer('pointerdown', 0);
zip.blur();
zip.pointer('pointermove', 2);
assert.deepEqual(zip.path(), [0], 'Zipper: losing focus cancels drawing');

const patchPuzzle = {
  size: 3,
  clues: [{ cell: 1, number: 3, shape: 'wide' }, { cell: 3, number: 2, shape: 'tall' }, { cell: 8, number: 4, shape: 'square' }],
  solution: [{ clue: 0, x: 0, y: 0, w: 3, h: 1 }, { clue: 1, x: 0, y: 1, w: 1, h: 2 }, { clue: 2, x: 1, y: 1, w: 2, h: 2 }],
};
const patch = await gameHarness('patcher', patchPuzzle, patcher);
patch.pointer('pointerdown', 0);
patch.pointer('pointermove', 8);
patch.pointer('pointermove', 2);
assert.deepEqual(patch.previews.at(-1), { rect: { x: 0, y: 0, w: 3, h: 1 }, valid: true }, 'Patcher: dragging back shrinks the rectangle');
patch.pointer('pointerdown', 8, 2);
patch.pointer('pointermove', 8, 2);
patch.pointer('pointerup', 8, 2);
assert.equal(patch.mutations.length, 0, 'Patcher: a second finger cannot place or cancel the rectangle');
patch.pointer('pointerup', 2);
assert.deepEqual(patch.mutations.at(-1), ['place', patchPuzzle.solution[0]], 'Patcher: the owner finger can still place');

// A tap lifts a placed patch; dragging across it must not erase it.
const before = patch.mutations.length;
patch.pointer('pointerdown', 0);
patch.pointer('pointermove', 1);
patch.pointer('pointerup', 1);
assert.equal(patch.mutations.length, before, 'Patcher: brushing a placed patch does not lift it');
patch.pointer('pointerdown', 1);
patch.pointer('pointerup', 1);
assert.deepEqual(patch.mutations.at(-1), ['lift', 0], 'Patcher: deliberate tap lifts a patch');

patch.actions.onReset();
patch.pointer('pointerdown', 0);
patch.pointer('pointerup', 0);
patch.pointer('pointerdown', 2);
patch.pointer('pointerup', 2);
assert.deepEqual(patch.mutations.at(-1), ['place', patchPuzzle.solution[0]], 'Patcher: tapping two corners places a patch without dragging');
patch.actions.onReset();
const afterReset = patch.mutations.length;
patch.pointer('pointerdown', 0);
patch.pointer('pointerup', 0);
patch.key('Escape');
patch.pointer('pointerdown', 2);
patch.pointer('pointerup', 2);
assert.equal(patch.mutations.length, afterReset, 'Patcher: Escape cancels a pending tap corner');
patch.actions.onReset();
patch.pointer('pointerdown', 0);
patch.pointer('pointermove', 2);
patch.pointer('pointercancel', 2);
assert.equal(patch.previews.at(-1).rect, null, 'Patcher: cancelled touch clears the preview');
patch.pointer('pointerup', 2);
assert.equal(patch.mutations.length, afterReset, 'Patcher: a cancelled drag cannot place on release');
patch.pointer('pointerdown', 0);
patch.pointer('pointermove', 2);
patch.actions.onReset();
patch.pointer('pointerup', 2);
assert.equal(patch.mutations.length, afterReset, 'Patcher: reset cancels the previous drag');
patch.pointer('pointerdown', 0);
patch.pointer('pointerup', 2);
assert.deepEqual(patch.mutations.at(-1), ['place', patchPuzzle.solution[0]], 'Patcher: the release position sets the final rectangle');

patch.actions.onReset();
const beforeHidden = patch.mutations.length;
patch.pointer('pointerdown', 0);
patch.pointer('pointermove', 2);
patch.hide();
patch.pointer('pointerup', 2);
assert.equal(patch.mutations.length, beforeHidden, 'Patcher: hiding the page cancels an unfinished rectangle');

// A quick replay must only show the latest result, even if the earlier
// celebration timeout has not fired yet.
const replayZip = await gameHarness('zipper', zipPuzzle, zipper);
const solveZip = () => {
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowRight']) replayZip.key(key);
};
solveZip(); replayZip.actions.onReset(); solveZip(); replayZip.runTimers();
assert.equal(replayZip.wins, 1, 'Zipper: replay cancels the previous celebration result');
const replayPatch = await gameHarness('patcher', patchPuzzle, patcher);
const solvePatch = () => {
  for (const [from, to] of [[0, 2], [3, 6], [4, 8]]) {
    replayPatch.pointer('pointerdown', from); replayPatch.pointer('pointerup', to);
  }
};
solvePatch(); replayPatch.actions.onReset(); solvePatch(); replayPatch.runTimers();
assert.equal(replayPatch.wins, 1, 'Patcher: replay cancels the previous celebration result');

for (const [game, puzzle, logic] of [['zipper', zipPuzzle, zipper], ['patcher', patchPuzzle, patcher]]) {
  const recovery = await gameHarness(game, puzzle, logic, { failGenerations: 1 });
  assert.equal(recovery.ready, true, `${game}: generation failure cannot abort initial boot`);
  assert.equal(recovery.starts, 1, `${game}: the renderer starts while waiting to retry`);
  assert.equal(recovery.errors.length, 1, `${game}: failed generation is reported`);
  recovery.runTimers();
  assert.equal(recovery.progress.at(-1)[0], game === 'zipper' ? 1 : 0, `${game}: retry loads a playable board`);
}

console.log('Pointer interaction checks passed: fast drawing, reversible rectangles, two-corner taps, pointer ownership, cancellation, undo and reset.');
