/* Zipper — the puzzle, with no screen attached.

   A board is a square grid. A path starts on cell 1, ends on the highest
   number, passes the numbers in order, visits every cell exactly once and
   moves only between side-by-side cells that no wall separates.

   A puzzle is made the way the daily ones are: first a random path that
   covers the grid (a serpentine shaken by many "backbite" moves), then the
   numbers and walls are drawn from that path, and the solver is asked
   whether any other path fits. While one does, a number or a wall is added
   where the two paths part, until only the intended path is left. */
import { createRng } from '../../shared/rng.js';

export const DIFFICULTIES = {
  easy: { size: 5, numbers: [4, 5], maxNumbers: 7, decorWalls: [0, 0], maxWalls: 0, fixWithWalls: 0 },
  medium: { size: 6, numbers: [5, 6], maxNumbers: 9, decorWalls: [1, 3], maxWalls: 7, fixWithWalls: 0.6 },
  hard: { size: 7, numbers: [5, 7], maxNumbers: 10, decorWalls: [3, 6], maxWalls: 12, fixWithWalls: 0.8 },
};

export const edgeKey = (a, b) => (a < b ? a * 1024 + b : b * 1024 + a);

/* The four grid neighbours of a cell, walls ignored. */
function gridNeighbours(n, cell) {
  const c = cell % n;
  const list = [];
  if (cell >= n) list.push(cell - n);
  if (cell + n < n * n) list.push(cell + n);
  if (c > 0) list.push(cell - 1);
  if (c < n - 1) list.push(cell + 1);
  return list;
}

/* Neighbours with the walls taken out, for every cell. */
export function neighbourTable(n, walls) {
  const blocked = new Set(walls.map(([a, b]) => edgeKey(a, b)));
  return Array.from({ length: n * n }, (_, cell) =>
    gridNeighbours(n, cell).filter((other) => !blocked.has(edgeKey(cell, other))));
}

/* A random path through every cell. Starts from a serpentine and applies
   backbite moves: take one end of the path, step to a grid neighbour that
   is already on the path, and reverse everything beyond it. Repeated a few
   hundred times this walks the space of covering paths well. */
function coveringPath(n, rng) {
  const path = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) path.push(r * n + (r % 2 ? n - 1 - c : c));
  const at = new Int32Array(n * n);
  const steps = n * n * 14;
  for (let s = 0; s < steps; s++) {
    if (rng.chance(0.5)) path.reverse();
    for (let i = 0; i < path.length; i++) at[path[i]] = i;
    const last = path.length - 1;
    const head = path[last];
    const options = gridNeighbours(n, head).filter((cell) => cell !== path[last - 1]);
    if (!options.length) continue;
    const pivot = at[rng.pick(options)];
    for (let i = pivot + 1, j = last; i < j; i++, j--) [path[i], path[j]] = [path[j], path[i]];
  }
  return path;
}

/* Every path that fits the board, up to `limit` of them. `exhausted` means
   the search ran out of budget first, so nothing is known. */
export function solve(puzzle, limit = 2, budget = 1.5e6) {
  const { size: n, numbers, waypoints } = puzzle;
  const N = n * n;
  const neighbours = puzzle.neighbours || neighbourTable(n, puzzle.walls);
  const endCell = waypoints[waypoints.length - 1];
  const visited = new Uint8Array(N);
  const path = new Int32Array(N);
  const stack = new Int32Array(N);
  const mark = new Int32Array(N);
  let stamp = 0;
  let nodes = 0;
  const solutions = [];
  let exhausted = false;

  /* The cells still free must all be reachable from the head, and none of
     them may be a dead end except the finishing cell. */
  const feasible = (head, remaining) => {
    stamp++;
    let top = 0;
    let reached = 0;
    stack[top++] = head;
    mark[head] = stamp;
    while (top) {
      const cell = stack[--top];
      const list = neighbours[cell];
      for (let i = 0; i < list.length; i++) {
        const next = list[i];
        if (visited[next] || mark[next] === stamp) continue;
        mark[next] = stamp;
        reached++;
        stack[top++] = next;
        let degree = 0;
        const around = neighbours[next];
        for (let k = 0; k < around.length; k++) if (!visited[around[k]] || around[k] === head) degree++;
        if (degree === 0) return false;
        if (degree === 1) {
          if (next !== endCell) return false;
          // Reachable only through the head: it must be entered next, and last.
          if (remaining > 1 && around.length && around.every((c) => visited[c] || c === head)) return false;
        }
      }
    }
    return reached === remaining;
  };

  const step = (head, depth, nextNumber) => {
    if (exhausted || solutions.length >= limit) return;
    if (++nodes > budget) { exhausted = true; return; }
    if (depth === N) {
      if (head === endCell) solutions.push(Array.from(path));
      return;
    }
    const list = neighbours[head];
    for (let i = 0; i < list.length; i++) {
      const cell = list[i];
      if (visited[cell]) continue;
      const number = numbers[cell];
      if (number && number !== nextNumber) continue;
      if (cell === endCell && depth + 1 !== N) continue;
      visited[cell] = 1;
      path[depth] = cell;
      if (depth + 1 === N || feasible(cell, N - depth - 1)) step(cell, depth + 1, number ? nextNumber + 1 : nextNumber);
      visited[cell] = 0;
      if (exhausted || solutions.length >= limit) return;
    }
  };

  const start = waypoints[0];
  visited[start] = 1;
  path[0] = start;
  step(start, 1, 2);
  return { solutions, exhausted };
}

/* Positions along the path for `count` numbers: the two ends, and the rest
   spread evenly with some give, never two next to each other. */
function spreadNumbers(length, count, rng) {
  const gap = (length - 1) / (count - 1);
  const positions = [0];
  for (let k = 1; k < count - 1; k++) {
    const jitter = (rng.next() - 0.5) * gap * 0.6;
    const p = Math.round(k * gap + jitter);
    positions.push(Math.max(positions[k - 1] + 2, Math.min(length - 2 - 2 * (count - 2 - k), p)));
  }
  positions.push(length - 1);
  return positions;
}

function build(difficulty, seed, n, path, positions, walls) {
  const numbers = new Array(n * n).fill(0);
  const waypoints = positions.map((p) => path[p]);
  waypoints.forEach((cell, i) => { numbers[cell] = i + 1; });
  return {
    difficulty, seed, size: n, numbers, waypoints,
    walls: walls.map(([a, b]) => [a, b]),
    neighbours: neighbourTable(n, walls),
    solution: path.slice(),
  };
}

/* Another path that fits: a number added so that it breaks the other path's
   order, or a wall across an edge only the other path uses. Returns the new
   puzzle, or null when the limits of the difficulty are reached. */
function disambiguate(puzzle, other, spec, rng, positions, walls, path) {
  const n = puzzle.size;
  const N = n * n;
  const at = new Int32Array(N);
  other.forEach((cell, i) => { at[cell] = i; });
  let divergence = 0;
  while (divergence < N && other[divergence] === path[divergence]) divergence++;

  const wallFix = () => {
    if (walls.length >= spec.maxWalls) return false;
    const onPath = new Set();
    for (let i = 1; i < N; i++) onPath.add(edgeKey(path[i - 1], path[i]));
    const candidates = [];
    for (let i = 1; i < N; i++) {
      if (!onPath.has(edgeKey(other[i - 1], other[i]))) candidates.push({ edge: [other[i - 1], other[i]], distance: Math.abs(i - divergence) });
    }
    if (!candidates.length) return false;
    candidates.sort((a, b) => a.distance - b.distance);
    const chosen = candidates[Math.min(candidates.length - 1, rng.int(Math.min(3, candidates.length)))];
    walls.push(chosen.edge);
    return true;
  };

  const numberFix = () => {
    if (positions.length >= spec.maxNumbers) return false;
    const candidates = [];
    for (let k = 1; k < positions.length; k++) {
      const a = at[path[positions[k - 1]]];
      const b = at[path[positions[k]]];
      for (let p = positions[k - 1] + 2; p <= positions[k] - 2; p++) {
        const q = at[path[p]];
        // The other path must visit this cell outside its window between the two numbers.
        if (q > a && q < b) continue;
        candidates.push({ p, distance: Math.abs(p - divergence) });
      }
    }
    if (!candidates.length) return false;
    candidates.sort((a, b) => a.distance - b.distance);
    const chosen = candidates[Math.min(candidates.length - 1, rng.int(Math.min(3, candidates.length)))];
    positions.push(chosen.p);
    positions.sort((a, b) => a - b);
    return true;
  };

  const wallsFirst = rng.chance(spec.fixWithWalls);
  const done = wallsFirst ? (wallFix() || numberFix()) : (numberFix() || wallFix());
  if (!done) return null;
  return build(puzzle.difficulty, puzzle.seed, n, path, positions, walls);
}

function attempt(difficulty, seed, spec, rng) {
  const n = spec.size;
  const N = n * n;
  const path = coveringPath(n, rng);
  const positions = spreadNumbers(N, rng.range(spec.numbers[0], spec.numbers[1]), rng);
  const walls = [];
  const onPath = new Set();
  for (let i = 1; i < N; i++) onPath.add(edgeKey(path[i - 1], path[i]));
  const decor = rng.range(spec.decorWalls[0], spec.decorWalls[1]);
  if (decor) {
    const free = [];
    for (let cell = 0; cell < N; cell++) {
      for (const other of gridNeighbours(n, cell)) if (other > cell && !onPath.has(edgeKey(cell, other))) free.push([cell, other]);
    }
    rng.shuffle(free);
    walls.push(...free.slice(0, decor));
  }
  let puzzle = build(difficulty, seed, n, path, positions, walls);
  for (let round = 0; round < 24; round++) {
    const { solutions, exhausted } = solve(puzzle, 2);
    if (exhausted) return null;
    if (solutions.length === 1) return puzzle;
    const other = solutions.find((s) => s.some((cell, i) => cell !== path[i]));
    puzzle = disambiguate(puzzle, other, spec, rng, positions, walls, path);
    if (!puzzle) return null;
  }
  return null;
}

/* A puzzle of the difficulty for the seed. The same two always give the
   same board. */
export function generate(difficulty, seed) {
  const spec = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  const rng = createRng(`zipper:${difficulty}:${seed}`);
  for (let tries = 0; tries < 60; tries++) {
    const puzzle = attempt(difficulty, seed, spec, rng);
    if (puzzle) return puzzle;
  }
  throw new Error(`Zipper: no puzzle for ${difficulty}/${seed}`);
}

/* ---------- play ---------- */

/* Whether the path may step from its head onto `cell`. */
export function canStep(puzzle, path, cell) {
  const head = path[path.length - 1];
  if (!puzzle.neighbours[head].includes(cell)) return false;
  if (path.includes(cell)) return false;
  const number = puzzle.numbers[cell];
  if (number) {
    let seen = 0;
    for (const c of path) if (puzzle.numbers[c]) seen++;
    if (number !== seen + 1) return false;
  }
  const last = puzzle.waypoints[puzzle.waypoints.length - 1];
  if (cell === last && path.length + 1 !== puzzle.size * puzzle.size) return false;
  return true;
}

export function isSolved(puzzle, path) {
  const N = puzzle.size * puzzle.size;
  if (path.length !== N) return false;
  if (path[path.length - 1] !== puzzle.waypoints[puzzle.waypoints.length - 1]) return false;
  let expected = 1;
  for (const cell of path) {
    const number = puzzle.numbers[cell];
    if (number) {
      if (number !== expected) return false;
      expected++;
    }
  }
  return new Set(path).size === N;
}

/* The cells from `from` to `to` in a straight line, `from` excluded, or
   null when they do not share a row or column. Fast drags skip cells. */
export function straightLine(n, from, to) {
  const fr = Math.floor(from / n), fc = from % n, tr = Math.floor(to / n), tc = to % n;
  if (fr !== tr && fc !== tc) return null;
  const cells = [];
  const dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
  let r = fr, c = fc;
  while (r !== tr || c !== tc) {
    r += dr; c += dc;
    cells.push(r * n + c);
  }
  return cells;
}

/* Guidance for a hint: identify the part to retrace after a wrong turn,
   or the way to the next number. The caller only highlights these cells. */
export function hint(puzzle, path) {
  const { solution } = puzzle;
  let good = 0;
  while (good < path.length && path[good] === solution[good]) good++;
  if (good < path.length) return { type: 'cut', keep: good };
  if (good === solution.length) return { type: 'done' };
  const cells = [];
  for (let i = good; i < solution.length; i++) {
    cells.push(solution[i]);
    if (puzzle.numbers[solution[i]]) break;
  }
  return { type: 'extend', cells };
}
