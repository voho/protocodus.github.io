// Run with: node fun/zipper/tests/puzzle-check.mjs
import assert from 'node:assert/strict';
import { generate, solve, isSolved, canStep, hint, straightLine, DIFFICULTIES, edgeKey } from '../js/puzzle.js';

const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'];
const report = [];
for (const difficulty of Object.keys(DIFFICULTIES)) {
  const spec = DIFFICULTIES[difficulty];
  let total = 0, worst = 0, numbers = 0, walls = 0;
  for (const seed of seeds) {
    const started = performance.now();
    const puzzle = generate(difficulty, seed);
    const took = performance.now() - started;
    total += took; worst = Math.max(worst, took);
    numbers += puzzle.waypoints.length; walls += puzzle.walls.length;
    assert.equal(puzzle.size, spec.size);
    assert.ok(puzzle.waypoints.length <= spec.maxNumbers, `${difficulty}/${seed}: too many numbers`);
    assert.ok(puzzle.walls.length <= spec.maxWalls, `${difficulty}/${seed}: too many walls`);
    assert.ok(isSolved(puzzle, puzzle.solution), `${difficulty}/${seed}: the stored solution must solve the board`);
    // The solution never crosses a wall.
    const blocked = new Set(puzzle.walls.map(([a, b]) => edgeKey(a, b)));
    for (let i = 1; i < puzzle.solution.length; i++) {
      assert.ok(!blocked.has(edgeKey(puzzle.solution[i - 1], puzzle.solution[i])), 'solution crosses a wall');
    }
    const { solutions, exhausted } = solve(puzzle, 3);
    assert.equal(exhausted, false, `${difficulty}/${seed}: solver ran out of budget`);
    assert.equal(solutions.length, 1, `${difficulty}/${seed}: the puzzle must have exactly one solution`);
    assert.deepEqual(solutions[0], puzzle.solution);
    // Determinism: the same seed gives the same board.
    const again = generate(difficulty, seed);
    assert.deepEqual(again.solution, puzzle.solution);
    assert.deepEqual(again.walls, puzzle.walls);
    // Playing the solution step by step is always allowed, and only then solved.
    const path = [puzzle.solution[0]];
    for (let i = 1; i < puzzle.solution.length; i++) {
      assert.equal(isSolved(puzzle, path), false);
      assert.ok(canStep(puzzle, path, puzzle.solution[i]), `${difficulty}/${seed}: step ${i} refused`);
      path.push(puzzle.solution[i]);
    }
    assert.ok(isSolved(puzzle, path));
    // Hints: the way to the next number from the start, and a cut after a wrong turn.
    const first = hint(puzzle, [puzzle.solution[0]]);
    assert.equal(first.type, 'extend');
    assert.ok(puzzle.numbers[first.cells.at(-1)] === 2);
    const wrong = [puzzle.solution[0], puzzle.neighbours[puzzle.solution[0]].find((c) => c !== puzzle.solution[1]) ?? puzzle.solution[1]];
    if (wrong[1] !== puzzle.solution[1]) assert.deepEqual(hint(puzzle, wrong), { type: 'cut', keep: 1 });
    assert.equal(hint(puzzle, puzzle.solution).type, 'done');
  }
  report.push(`${difficulty}: ${spec.size}×${spec.size}, avg ${(total / seeds.length).toFixed(0)} ms (worst ${worst.toFixed(0)} ms), ` +
    `${(numbers / seeds.length).toFixed(1)} numbers, ${(walls / seeds.length).toFixed(1)} walls`);
}
// Entering a number out of order, the last number early, or crossing a wall is refused.
const puzzle = generate('medium', 'alpha');
const n = puzzle.size;
const start = puzzle.waypoints[0];
const two = puzzle.waypoints[1];
for (const cell of puzzle.neighbours[start]) {
  if (puzzle.numbers[cell] > 2) assert.equal(canStep(puzzle, [start], cell), false);
}
assert.equal(canStep(puzzle, [start], two), puzzle.neighbours[start].includes(two) && puzzle.waypoints.length === 2);
assert.deepEqual(straightLine(n, 0, 3), [1, 2, 3]);
assert.deepEqual(straightLine(n, 2 * n, 0), [n, 0]);
assert.equal(straightLine(n, 0, n + 1), null);
console.log('Zipper checks passed: unique seeded boards, legal stepping, hints.\n' + report.join('\n'));
