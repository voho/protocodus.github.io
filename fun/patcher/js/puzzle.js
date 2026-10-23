/* Patcher — the puzzle, with no screen attached.

   A board is a square grid with clue cells. The board is cut into
   rectangles ("patches") so that every patch holds exactly one clue and
   matches it: a number is the patch's cell count, and the icon its shape —
   square, wide (wider than tall), tall, or the dashed one that takes any.

   A puzzle starts as a random tiling of the grid, each patch given a clue
   cell and a clue. The solver then looks for a second cutting; while one
   exists, a clue that differs between the two is strengthened (a number
   added, a shape named, the clue cell moved) until only the intended one
   fits. A deduction pass grades what it takes to solve, so each difficulty
   plays as it says. */
import { createRng } from '../../shared/rng.js';

/* `kinds`: how clues are written. full: number and shape; number: number
   with the any-shape icon; shape: shape without a number; any: the
   any-shape icon alone, which other clues have to pin down. `level` is the
   deduction a board may need: 1 means some clue always has one patch
   left, 2 that some cell can be covered one way only, 3 that it takes
   looking ahead. */
export const DIFFICULTIES = {
  easy: { size: 5, maxArea: 6, singles: 0, kinds: { full: 0.7, number: 0.3, shape: 0, any: 0 }, level: [1, 1] },
  medium: { size: 7, maxArea: 8, singles: 1, kinds: { full: 0.35, number: 0.35, shape: 0.25, any: 0.05 }, level: [1, 2] },
  hard: { size: 9, maxArea: 10, singles: 1, kinds: { full: 0.2, number: 0.35, shape: 0.35, any: 0.1 }, level: [2, 3] },
};

export const shapeOf = (w, h) => (w === h ? 'square' : w > h ? 'wide' : 'tall');

/* Whether a w×h patch of this clue's number and shape is allowed. */
export function fitsClue(clue, w, h) {
  if (clue.number && clue.number !== w * h) return false;
  return clue.shape === 'any' || clue.shape === shapeOf(w, h);
}

/* A random cutting of the grid into rectangles: the first free cell (in
   reading order) gets a patch whose size is drawn from what fits there.
   Single cells are nearly never chosen, only forced. */
function tiling(n, maxArea, rng) {
  const grid = new Int16Array(n * n).fill(-1);
  const rects = [];
  const free = (x, y) => x < n && y < n && grid[y * n + x] === -1;
  const weight = (w, h) => {
    const area = w * h;
    let weight = area === 1 ? 0.02 : area <= 2 ? 1 : area <= 4 ? 1.3 : area <= 6 ? 1 : area <= 8 ? 0.55 : 0.3;
    if (Math.max(w, h) >= 5) weight *= 0.5; // long strips look odd and solve the same
    return weight;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y * n + x] !== -1) continue;
      const options = [];
      for (let w = 1; x + w - 1 < n && free(x + w - 1, y); w++) {
        for (let h = 1; w * h <= maxArea; h++) {
          let open = true;
          for (let i = 0; i < w && open; i++) open = free(x + i, y + h - 1);
          if (!open) break;
          options.push({ w, h, weight: weight(w, h) });
        }
      }
      let pick = options[0];
      let roll = rng.next() * options.reduce((sum, o) => sum + o.weight, 0);
      for (const option of options) { roll -= option.weight; if (roll <= 0) { pick = option; break; } }
      const id = rects.length;
      rects.push({ x, y, w: pick.w, h: pick.h });
      for (let j = 0; j < pick.h; j++) for (let i = 0; i < pick.w; i++) grid[(y + j) * n + x + i] = id;
    }
  }
  return rects;
}

/* Every patch a clue could be, given the board alone. */
function candidatesFor(n, clues, k) {
  const clue = clues[k];
  const cx = clue.cell % n, cy = Math.floor(clue.cell / n);
  const clueAt = new Int8Array(n * n);
  clues.forEach((c, i) => { clueAt[c.cell] = i === k ? 0 : 1; });
  const list = [];
  for (let w = 1; w <= n; w++) {
    for (let h = 1; h <= n; h++) {
      if (!fitsClue(clue, w, h)) continue;
      for (let x = Math.max(0, cx - w + 1); x <= cx && x + w <= n; x++) {
        for (let y = Math.max(0, cy - h + 1); y <= cy && y + h <= n; y++) {
          let clean = true;
          const cells = [];
          for (let j = 0; j < h && clean; j++) for (let i = 0; i < w; i++) {
            const cell = (y + j) * n + x + i;
            if (clueAt[cell]) { clean = false; break; }
            cells.push(cell);
          }
          if (clean) list.push({ clue: k, x, y, w, h, cells });
        }
      }
    }
  }
  return list;
}

export function allCandidates(puzzle) {
  return puzzle.clues.map((_, k) => candidatesFor(puzzle.size, puzzle.clues, k));
}

/* Every way to finish the board from `placed` (patches already down, each
   `{ clue, x, y, w, h }`), up to `limit` of them. */
export function solve(puzzle, { limit = 2, placed = [], candidates = allCandidates(puzzle), budget = 2e5 } = {}) {
  const n = puzzle.size;
  const cover = new Int16Array(n * n).fill(-1);
  const used = new Uint8Array(puzzle.clues.length);
  const chosen = new Array(puzzle.clues.length).fill(null);
  for (const patch of placed) {
    used[patch.clue] = 1;
    chosen[patch.clue] = patch;
    for (let j = 0; j < patch.h; j++) for (let i = 0; i < patch.w; i++) cover[(patch.y + j) * n + patch.x + i] = patch.clue;
  }
  const solutions = [];
  let nodes = 0;
  let exhausted = false;
  const open = (candidate) => {
    for (const cell of candidate.cells) if (cover[cell] !== -1) return false;
    return true;
  };
  const step = () => {
    if (exhausted || solutions.length >= limit) return;
    if (++nodes > budget) { exhausted = true; return; }
    // The free cell with the fewest patches that could still cover it.
    let bestCell = -1, bestList = null;
    for (let cell = 0; cell < n * n; cell++) {
      if (cover[cell] !== -1) continue;
      const list = [];
      for (let k = 0; k < candidates.length; k++) {
        if (used[k]) continue;
        for (const candidate of candidates[k]) if (candidate.cells.includes(cell) && open(candidate)) list.push(candidate);
      }
      if (bestList === null || list.length < bestList.length) { bestCell = cell; bestList = list; }
      if (list.length === 0) break;
    }
    if (bestCell === -1) { solutions.push(chosen.map((patch) => ({ clue: patch.clue, x: patch.x, y: patch.y, w: patch.w, h: patch.h }))); return; }
    for (const candidate of bestList) {
      used[candidate.clue] = 1;
      chosen[candidate.clue] = candidate;
      for (const cell of candidate.cells) cover[cell] = candidate.clue;
      step();
      for (const cell of candidate.cells) cover[cell] = -1;
      chosen[candidate.clue] = null;
      used[candidate.clue] = 0;
      if (exhausted || solutions.length >= limit) return;
    }
  };
  step();
  return { solutions, exhausted };
}

/* Solve by deduction alone and report the strongest step it took: 1 when
   a clue had a single patch left, 2 when a cell had a single patch that
   could cover it, 3 when neither moved it on. */
export function grade(puzzle, candidates = allCandidates(puzzle)) {
  const n = puzzle.size;
  const cover = new Int16Array(n * n).fill(-1);
  const used = new Uint8Array(puzzle.clues.length);
  let placedCount = 0;
  let level = 1;
  const open = (candidate) => candidate.cells.every((cell) => cover[cell] === -1);
  const place = (candidate) => {
    used[candidate.clue] = 1;
    for (const cell of candidate.cells) cover[cell] = candidate.clue;
    placedCount++;
  };
  while (placedCount < puzzle.clues.length) {
    const live = candidates.map((list, k) => (used[k] ? [] : list.filter(open)));
    const forced = live.find((list, k) => !used[k] && list.length === 1);
    if (forced) { place(forced[0]); continue; }
    let single = null;
    for (let cell = 0; cell < n * n && !single; cell++) {
      if (cover[cell] !== -1) continue;
      let only = null, count = 0;
      for (const list of live) for (const candidate of list) if (candidate.cells.includes(cell)) { only = candidate; if (++count > 1) break; }
      if (count === 1) single = only;
    }
    if (single) { level = Math.max(level, 2); place(single); continue; }
    return 3;
  }
  return level;
}

function clueFor(rect, kind, rng) {
  const cells = [];
  for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) cells.push((rect.y + j) * rect.n + rect.x + i);
  return {
    cell: rng.pick(cells),
    number: kind === 'full' || kind === 'number' ? rect.w * rect.h : null,
    shape: kind === 'full' || kind === 'shape' ? shapeOf(rect.w, rect.h) : 'any',
  };
}

function pickKind(kinds, rng) {
  let roll = rng.next();
  for (const [kind, p] of Object.entries(kinds)) { roll -= p; if (roll <= 0) return kind; }
  return 'full';
}

/* Make the clue that differs between the two cuttings say more. */
function strengthen(puzzle, other, rng) {
  const n = puzzle.size;
  const differing = puzzle.solution
    .map((rect, k) => ({ k, rect, alt: other.find((p) => p.clue === k) }))
    .filter(({ rect, alt }) => alt.x !== rect.x || alt.y !== rect.y || alt.w !== rect.w || alt.h !== rect.h);
  rng.shuffle(differing);
  for (const { k, rect, alt } of differing) {
    const clue = puzzle.clues[k];
    if (!clue.number) { clue.number = rect.w * rect.h; return true; }
    if (clue.shape === 'any') { clue.shape = shapeOf(rect.w, rect.h); return true; }
    // Same size and shape, another place: move the clue off the other patch.
    const inside = (p, cell) => { const x = cell % n, y = Math.floor(cell / n); return x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h; };
    const moves = [];
    for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) {
      const cell = (rect.y + j) * n + rect.x + i;
      if (!inside(alt, cell)) moves.push(cell);
    }
    if (moves.length) { clue.cell = rng.pick(moves); return true; }
  }
  return false;
}

function attempt(difficulty, seed, spec, rng) {
  const n = spec.size;
  const rects = tiling(n, spec.maxArea, rng);
  if (rects.filter((r) => r.w * r.h === 1).length > spec.singles) return null;
  const clues = rects.map((rect) => clueFor({ ...rect, n }, pickKind(spec.kinds, rng), rng));
  const puzzle = {
    difficulty, seed, size: n, clues,
    solution: rects.map((rect, k) => ({ clue: k, x: rect.x, y: rect.y, w: rect.w, h: rect.h })),
  };
  for (let round = 0; round < 40; round++) {
    const candidates = allCandidates(puzzle);
    const { solutions, exhausted } = solve(puzzle, { limit: 2, candidates });
    if (exhausted) return null;
    if (solutions.length === 1) {
      const level = grade(puzzle, candidates);
      if (level < spec.level[0] || level > spec.level[1]) return null;
      puzzle.level = level;
      return puzzle;
    }
    const other = solutions.find((s) => s.some((p) => { const r = puzzle.solution[p.clue]; return p.x !== r.x || p.y !== r.y || p.w !== r.w || p.h !== r.h; }));
    if (!strengthen(puzzle, other, rng)) return null;
  }
  return null;
}

/* A puzzle of the difficulty for the seed. The same two always give the
   same board. */
export function generate(difficulty, seed) {
  const spec = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  const rng = createRng(`patcher:${difficulty}:${seed}`);
  for (let tries = 0; tries < 400; tries++) {
    const puzzle = attempt(difficulty, seed, spec, rng);
    if (puzzle) return puzzle;
  }
  throw new Error(`Patcher: no puzzle for ${difficulty}/${seed}`);
}

/* ---------- play ---------- */

/* The clues inside a rectangle. */
export function cluesInside(puzzle, rect) {
  const n = puzzle.size;
  const list = [];
  puzzle.clues.forEach((clue, k) => {
    const x = clue.cell % n, y = Math.floor(clue.cell / n);
    if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) list.push(k);
  });
  return list;
}

/* Why a drawn rectangle cannot go down, or null when it can. `patches`
   are the ones already on the board. */
export function rejectReason(puzzle, patches, rect) {
  const inside = cluesInside(puzzle, rect);
  if (inside.length === 0) return 'no-clue';
  if (inside.length > 1) return 'two-clues';
  for (const patch of patches) {
    if (rect.x < patch.x + patch.w && patch.x < rect.x + rect.w && rect.y < patch.y + patch.h && patch.y < rect.y + rect.h) return 'overlap';
  }
  const clue = puzzle.clues[inside[0]];
  if (clue.number && clue.number !== rect.w * rect.h) return 'number';
  if (clue.shape !== 'any' && clue.shape !== shapeOf(rect.w, rect.h)) return 'shape';
  return null;
}

export function isSolved(puzzle, patches) {
  let covered = 0;
  for (const patch of patches) covered += patch.w * patch.h;
  return covered === puzzle.size * puzzle.size;
}

/* What to do for a hint: lift a patch that is not in the solution, or show
   the patch of a clue that can be worked out now. */
export function hint(puzzle, patches) {
  const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  const wrong = patches.find((patch) => !same(patch, puzzle.solution[patch.clue]));
  if (wrong) return { type: 'lift', patch: wrong };
  if (patches.length === puzzle.clues.length) return { type: 'done' };
  const placed = new Set(patches.map((p) => p.clue));
  const candidates = allCandidates(puzzle);
  const n = puzzle.size;
  const cover = new Int16Array(n * n).fill(-1);
  for (const patch of patches) for (let j = 0; j < patch.h; j++) for (let i = 0; i < patch.w; i++) cover[(patch.y + j) * n + patch.x + i] = patch.clue;
  const live = candidates.map((list, k) => (placed.has(k) ? [] : list.filter((c) => c.cells.every((cell) => cover[cell] === -1))));
  const forced = live.findIndex((list) => list.length === 1);
  const k = forced >= 0 ? forced : puzzle.clues.findIndex((_, i) => !placed.has(i));
  return { type: 'show', patch: puzzle.solution[k] };
}
