// Run with: node fun/patcher/tests/puzzle-check.mjs
import assert from 'node:assert/strict';
import { generate, solve, grade, isSolved, rejectReason, hint, fitsClue, shapeOf, DIFFICULTIES } from '../js/puzzle.js';

const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'];
const report = [];
for (const difficulty of Object.keys(DIFFICULTIES)) {
  const spec = DIFFICULTIES[difficulty];
  let total = 0, worst = 0, patches = 0, numbered = 0, levels = 0;
  for (const seed of seeds) {
    const started = performance.now();
    const puzzle = generate(difficulty, seed);
    const took = performance.now() - started;
    total += took; worst = Math.max(worst, took);
    patches += puzzle.solution.length; levels += puzzle.level;
    numbered += puzzle.clues.filter((c) => c.number).length;
    assert.equal(puzzle.size, spec.size);
    const n = puzzle.size;
    // The solution tiles the board, one clue per patch, every clue satisfied.
    const cover = new Int16Array(n * n).fill(-1);
    for (const patch of puzzle.solution) {
      for (let j = 0; j < patch.h; j++) for (let i = 0; i < patch.w; i++) {
        const cell = (patch.y + j) * n + patch.x + i;
        assert.equal(cover[cell], -1, 'patches overlap');
        cover[cell] = patch.clue;
      }
      const clue = puzzle.clues[patch.clue];
      assert.equal(cover[clue.cell], patch.clue, 'the clue sits in its patch');
      assert.ok(fitsClue(clue, patch.w, patch.h), 'the patch matches its clue');
    }
    assert.ok(cover.every((c) => c !== -1), 'the whole board is covered');
    assert.ok(isSolved(puzzle, puzzle.solution));
    assert.ok(puzzle.solution.filter((p) => p.w * p.h === 1).length <= spec.singles);
    const { solutions, exhausted } = solve(puzzle, { limit: 3 });
    assert.equal(exhausted, false, `${difficulty}/${seed}: solver ran out of budget`);
    assert.equal(solutions.length, 1, `${difficulty}/${seed}: exactly one cutting`);
    const level = grade(puzzle);
    assert.ok(level >= spec.level[0] && level <= spec.level[1], `${difficulty}/${seed}: level ${level}`);
    const again = generate(difficulty, seed);
    assert.deepEqual(again.clues, puzzle.clues);
    assert.deepEqual(again.solution, puzzle.solution);
    // Placing the solution patch by patch is always accepted.
    const down = [];
    for (const patch of puzzle.solution) {
      assert.equal(isSolved(puzzle, down), false);
      assert.equal(rejectReason(puzzle, down, patch), null);
      down.push(patch);
    }
    assert.ok(isSolved(puzzle, down));
    // Hints lift a wrong patch first, then show a patch; none once solved.
    const first = hint(puzzle, []);
    assert.equal(first.type, 'show');
    assert.equal(rejectReason(puzzle, [], first.patch), null);
    assert.equal(hint(puzzle, puzzle.solution).type, 'done');
  }
  report.push(`${difficulty}: ${spec.size}×${spec.size}, avg ${(total / seeds.length).toFixed(0)} ms (worst ${worst.toFixed(0)} ms), ` +
    `${(patches / seeds.length).toFixed(1)} patches, ${(100 * numbered / patches).toFixed(0)}% numbered, level ${(levels / seeds.length).toFixed(2)}`);
}
// Rejections: a rectangle with no clue, two clues, an overlap, a wrong count or shape.
const puzzle = generate('medium', 'alpha');
const [first, second] = puzzle.solution;
assert.equal(rejectReason(puzzle, [first], first), 'overlap');
const wide = puzzle.solution.find((p, k) => puzzle.clues[k].number && puzzle.clues[k].shape !== 'any' && p.w > 1);
if (wide) {
  const clue = puzzle.clues[wide.clue];
  assert.equal(rejectReason(puzzle, [], { ...wide, w: wide.w - 1 }), clue.number ? 'number' : 'shape');
}
const whole = { x: 0, y: 0, w: puzzle.size, h: puzzle.size };
assert.equal(rejectReason(puzzle, [], whole), 'two-clues');
const empty = (() => {
  const n = puzzle.size;
  const clueCells = new Set(puzzle.clues.map((c) => c.cell));
  for (let cell = 0; cell < n * n; cell++) if (!clueCells.has(cell)) return { x: cell % n, y: Math.floor(cell / n), w: 1, h: 1 };
})();
assert.equal(rejectReason(puzzle, [], empty), 'no-clue');
assert.deepEqual([shapeOf(2, 2), shapeOf(3, 1), shapeOf(1, 3)], ['square', 'wide', 'tall']);
assert.equal(fitsClue({ number: null, shape: 'any' }, 4, 1), true);
assert.equal(fitsClue({ number: 4, shape: 'wide' }, 2, 2), false);
console.log('Patcher checks passed: unique seeded cuttings, graded deduction, rejections, hints.\n' + report.join('\n'));
