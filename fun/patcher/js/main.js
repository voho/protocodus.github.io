/* Patcher — wiring: the puzzle, the board, the pointer and the chrome. */
import { createStage } from '../../shared/stage.js';
import { createBursts } from '../../shared/particles.js';
import { createSound } from '../../shared/sound.js';
import { createShell } from '../../shared/shell.js';
import { createThemeSwitch } from '../../shared/themes.js';
import { waitForFont } from '../../shared/slab.js';
import { randomSeed } from '../../shared/rng.js';
import { generate, cluesInside, rejectReason, isSolved, hint } from './puzzle.js';
import { createBoard } from './board.js';

const REASONS = {
  'no-clue': 'A patch needs a clue inside it.',
  'two-clues': 'Only one clue per patch.',
  overlap: 'That overlaps another patch.',
  number: 'Wrong size for that number.',
  shape: 'Wrong shape for that clue.',
};
const canvas = document.getElementById('stage');
const loading = document.querySelector('[data-loading]');
const status = document.querySelector('[data-status]');

// The theme is picked before the table is built; a later pick redresses it.
let retheme = null;
const themes = createThemeSwitch({ fallback: 'jungle', onChange: (theme) => retheme?.(theme) });
const stage = createStage(canvas, { theme: themes.current });
if (!stage) {
  loading.classList.add('failed');
  loading.querySelector('[data-loading-text]').textContent = 'Patcher needs WebGL 2, which this browser or device does not provide.';
} else {
  boot();
}

async function boot() {
  await waitForFont();
  const fx = { confetti: createBursts(stage.scene, { max: 400 }), dust: createBursts(stage.scene, { max: 300, additive: true }) };
  const sound = createSound('patcher');

  let puzzle = null;
  let board = null;
  let patches = [];
  let undo = [];
  let colours = new Map();
  let solved = false;
  let assisted = false;
  let drag = null;
  // Keyboard: a cursor cell, and the cell a patch is being grown from.
  let cursor = -1;
  let keyAnchor = -1;

  const inside = (patch, cell) => {
    const x = cell % puzzle.size, y = Math.floor(cell / puzzle.size);
    return x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h;
  };
  const rectBetween = (a, b) => {
    const n = puzzle.size;
    const ax = a % n, ay = Math.floor(a / n), bx = b % n, by = Math.floor(b / n);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx) + 1, h: Math.abs(ay - by) + 1 };
  };
  const colourFor = (clue) => {
    const palette = themes.current.palette;
    if (!colours.has(clue)) colours.set(clue, palette[colours.size % palette.length]);
    return colours.get(clue);
  };

  function announce() {
    status.textContent = solved ? 'Solved.' : `${patches.length} of ${puzzle.clues.length} patches placed.`;
  }

  function start(difficulty, seed) {
    try {
      puzzle = generate(difficulty, seed);
    } catch (error) {
      // Never happens in the checks, but a board that cannot be verified
      // must not reach the table: take another seed instead.
      console.error(error);
      setTimeout(() => shell.load(difficulty, randomSeed()), 0);
      return;
    }
    board?.dispose();
    board = createBoard(stage, puzzle, { theme: themes.current, fx });
    patches = [];
    undo = [];
    colours = new Map();
    solved = false;
    assisted = false;
    drag = null;
    cursor = -1;
    keyAnchor = -1;
    announce();
  }

  /* The same board and patches, dressed in the theme just picked. */
  function rebuild() {
    board.dispose();
    board = createBoard(stage, puzzle, { theme: themes.current, fx });
    colours = new Map();
    for (const patch of patches) board.place(patch, colourFor(patch.clue), null, true);
    keyAnchor = -1;
    if (cursor >= 0) board.hover(cursor);
  }

  function finish() {
    solved = true;
    const ms = shell.finish();
    sound.win();
    board.celebrate();
    stage.flash('#ffffff', 0.8);
    announce();
    const finished = puzzle;
    setTimeout(() => { if (puzzle === finished && solved) shell.showWin({ ms, assisted }); }, 1600);
  }

  function place(patch, record = true) {
    patches.push(patch);
    if (record) undo.push({ type: 'place', patch });
    board.place(patch, colourFor(patch.clue), () => { sound.place(); stage.flash(colourFor(patch.clue), 0.12); });
    shell.begin();
    announce();
    if (isSolved(puzzle, patches)) finish();
  }

  function lift(patch, record = true) {
    patches = patches.filter((p) => p !== patch);
    if (record) undo.push({ type: 'lift', patch });
    board.lift(patch.clue);
    sound.lift();
    announce();
  }

  const cellFromEvent = (event, clamp) => {
    const point = stage.pick(event.clientX, event.clientY, 0.14);
    return point ? board.cellAt(point, clamp) : -1;
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (!board || solved || event.button > 0) return;
    sound.unlock();
    canvas.focus({ preventScroll: true });
    const cell = cellFromEvent(event, false);
    if (cell < 0) return;
    canvas.setPointerCapture(event.pointerId);
    const covering = patches.find((p) => inside(p, cell));
    if (covering) { lift(covering); return; }
    const x = cell % puzzle.size, y = Math.floor(cell / puzzle.size);
    drag = { anchor: cell, cell, left: x, right: x, top: y, bottom: y, rect: rectBetween(cell, cell), moved: false };
    board.preview(drag.rect, rejectReason(puzzle, patches, drag.rect) === null);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!board) return;
    if (drag) {
      const cell = cellFromEvent(event, true);
      if (cell >= 0 && cell !== drag.cell) {
        drag.cell = cell;
        drag.moved = true;
        // The patch is painted: every cell the pointer has passed stays in
        // it, so going up and then down keeps the top cells and joins the
        // bottom ones, rather than stretching between the start and the
        // pointer alone.
        const x = cell % puzzle.size, y = Math.floor(cell / puzzle.size);
        drag.left = Math.min(drag.left, x); drag.right = Math.max(drag.right, x);
        drag.top = Math.min(drag.top, y); drag.bottom = Math.max(drag.bottom, y);
        drag.rect = { x: drag.left, y: drag.top, w: drag.right - drag.left + 1, h: drag.bottom - drag.top + 1 };
        board.preview(drag.rect, rejectReason(puzzle, patches, drag.rect) === null);
      }
    } else if (event.pointerType === 'mouse') {
      board.hover(cellFromEvent(event, false));
    }
  });
  /* A drawn rectangle is let go: it lands, or the reason it cannot shows. */
  function commit(rect, moved, anchor) {
    board.preview(null);
    if (solved) return;
    const reason = rejectReason(puzzle, patches, rect);
    if (!reason) { place({ clue: cluesInside(puzzle, rect)[0], ...rect }); return; }
    const isClue = puzzle.clues.some((clue) => clue.cell === anchor);
    if (!moved && !isClue) shell.toast('Drag from a clue to draw its patch.');
    else if (!moved && (reason === 'number' || reason === 'shape')) shell.toast('Drag to draw a bigger patch.');
    else { board.reject(); sound.buzz(); shell.toast(REASONS[reason]); }
  }
  const release = (event) => {
    if (!drag || !board) return;
    const { rect, moved, anchor } = drag;
    drag = null;
    if (event.type === 'pointercancel') { board.preview(null); return; }
    commit(rect, moved, anchor);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (!drag) board?.hover(-1); });
  canvas.addEventListener('blur', () => board?.hover(-1));

  canvas.addEventListener('keydown', (event) => {
    if (!board || solved) return;
    const n = puzzle.size;
    if (cursor < 0) cursor = 0;
    const c = cursor % n, r = Math.floor(cursor / n);
    const moves = { ArrowUp: [c, r - 1], ArrowDown: [c, r + 1], ArrowLeft: [c - 1, r], ArrowRight: [c + 1, r] };
    if (event.key in moves) {
      event.preventDefault();
      const [nc, nr] = moves[event.key];
      cursor = Math.max(0, Math.min(n - 1, nr)) * n + Math.max(0, Math.min(n - 1, nc));
      board.hover(cursor);
      if (keyAnchor >= 0) {
        const rect = rectBetween(keyAnchor, cursor);
        board.preview(rect, rejectReason(puzzle, patches, rect) === null);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      sound.unlock();
      if (keyAnchor >= 0) {
        const anchor = keyAnchor;
        keyAnchor = -1;
        commit(rectBetween(anchor, cursor), anchor !== cursor, anchor);
        return;
      }
      const covering = patches.find((p) => inside(p, cursor));
      if (covering) { lift(covering); return; }
      keyAnchor = cursor;
      board.hover(cursor);
      board.preview(rectBetween(cursor, cursor), rejectReason(puzzle, patches, rectBetween(cursor, cursor)) === null);
    } else if (event.key === 'Escape' && keyAnchor >= 0) {
      event.preventDefault();
      keyAnchor = -1;
      board.preview(null);
    } else if (event.key === 'x' || event.key === 'Delete' || event.key === 'Backspace') {
      const covering = patches.find((p) => inside(p, cursor));
      if (covering) { event.preventDefault(); lift(covering); }
    }
  });

  const shell = createShell({
    storageKey: 'patcher', sound,
    onNew: start,
    onReset() {
      if (!board) return;
      if (solved) solved = false;
      for (const patch of patches.slice()) board.lift(patch.clue);
      if (patches.length) sound.lift();
      patches = [];
      undo = [];
      shell.restart();
      announce();
    },
    onUndo() {
      if (!board || solved) return;
      const last = undo.pop();
      if (!last) return;
      if (last.type === 'place') lift(last.patch, false);
      else place(last.patch, false);
    },
    onHint() {
      if (!board || solved) return;
      const next = hint(puzzle, patches);
      assisted = true;
      if (next.type === 'lift') {
        board.show(next.patch, { mistake: true });
        shell.toast('The highlighted patch blocks the solution. Tap it to lift it, then try another shape.', 5000);
      } else if (next.type === 'show') {
        board.show(next.patch);
        shell.toast(`Try the highlighted ${next.patch.w} wide × ${next.patch.h} tall patch. Draw it yourself.`, 5000);
      }
      shell.countHint();
    },
  });

  retheme = (theme) => {
    stage.setTheme(theme);
    if (board) rebuild();
    shell.toast(theme.label);
  };
  stage.start();
  document.body.classList.add('ready');
  // For the browser check: where a cell is on the page.
  canvas.puzzleTest = { cellPoint: (cell) => stage.project(board.centre(cell)) };
}
