/* Zipper — wiring: the puzzle, the board, the pointer and the chrome. */
import { createStage } from '../../shared/stage.js';
import { createBursts } from '../../shared/particles.js';
import { createSound } from '../../shared/sound.js';
import { createShell } from '../../shared/shell.js';
import { waitForFont } from '../../shared/slab.js';
import { randomSeed } from '../../shared/rng.js';
import { generate, canStep, isSolved, hint, straightLine } from './puzzle.js';
import { createBoard } from './board.js';

const ACCENT = '#87d7be';
const canvas = document.getElementById('stage');
const loading = document.querySelector('[data-loading]');
const status = document.querySelector('[data-status]');

const stage = createStage(canvas, {
  accent: ACCENT, elevation: 1.0,
  backdrop: { top: '#0e2432', bottom: '#030609', glow: ACCENT, glowStrength: 0.13 },
});
if (!stage) {
  loading.classList.add('failed');
  loading.querySelector('[data-loading-text]').textContent = 'Zipper needs WebGL 2, which this browser or device does not provide.';
} else {
  boot();
}

async function boot() {
  await waitForFont();
  const fx = { confetti: createBursts(stage.scene, { max: 400 }), sparks: createBursts(stage.scene, { max: 300, additive: true }) };
  stage.dust({ colour: ACCENT, extent: 6 });
  const sound = createSound('zipper');

  let puzzle = null;
  let board = null;
  let path = [];
  let solved = false;
  let assisted = false;
  let dragging = false;
  let lastCell = -1;

  const N = () => puzzle.size * puzzle.size;
  const head = () => path[path.length - 1];

  function announce() {
    let next = 1;
    for (const cell of path) if (puzzle.numbers[cell]) next = puzzle.numbers[cell] + 1;
    status.textContent = solved ? 'Solved.' : `${path.length} of ${N()} cells. Next number ${Math.min(next, puzzle.waypoints.length)}.`;
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
    board = createBoard(stage, puzzle, { accent: ACCENT, fx });
    path = [puzzle.waypoints[0]];
    solved = false;
    assisted = false;
    board.setPath(path);
    announce();
  }

  function finish() {
    solved = true;
    const ms = shell.finish();
    sound.win();
    board.celebrate();
    stage.flash(ACCENT, 1);
    announce();
    const finished = puzzle;
    setTimeout(() => { if (puzzle === finished && solved) shell.showWin({ ms, assisted }); }, 1500);
  }

  function step(cell) {
    if (solved) return false;
    if (canStep(puzzle, path, cell)) {
      path.push(cell);
      board.setPath(path);
      shell.begin();
      sound.step(path.length / N());
      if (puzzle.numbers[cell]) sound.number();
      announce();
      if (isSolved(puzzle, path)) finish();
      return true;
    }
    if (!path.includes(cell)) {
      const c = cell % puzzle.size, r = Math.floor(cell / puzzle.size);
      const hc = head() % puzzle.size, hr = Math.floor(head() / puzzle.size);
      if (Math.abs(c - hc) + Math.abs(r - hr) === 1) { board.bump(head(), cell); sound.buzz(); }
    }
    return false;
  }

  function cutTo(index) {
    if (index >= path.length - 1) return;
    board.flare(path.slice(index + 1));
    path.length = index + 1;
    board.setPath(path);
    sound.back();
    announce();
  }

  /* The pointer has reached `cell`: on the line it cuts the line back,
     next to the head it steps, and a drag that skipped cells in a straight
     run fills them in. */
  function moveTo(cell, dragged) {
    if (solved) return;
    const index = path.indexOf(cell);
    if (index !== -1) { cutTo(index); return; }
    if (puzzle.neighbours[head()].includes(cell)) { step(cell); return; }
    const line = dragged ? straightLine(puzzle.size, head(), cell) : null;
    if (line) for (const c of line) if (!step(c)) break;
  }

  const cellFromEvent = (event) => {
    const point = stage.pick(event.clientX, event.clientY, 0.16);
    return point ? board.cellAt(point) : -1;
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (!board || event.button > 0) return;
    sound.unlock();
    canvas.focus({ preventScroll: true });
    const cell = cellFromEvent(event);
    if (cell < 0) return;
    canvas.setPointerCapture(event.pointerId);
    dragging = true;
    lastCell = cell;
    moveTo(cell, false);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!board) return;
    const cell = cellFromEvent(event);
    if (dragging) {
      if (cell >= 0 && cell !== lastCell) { lastCell = cell; moveTo(cell, true); }
    } else if (event.pointerType === 'mouse') {
      board.hover(cell);
    }
  });
  const release = () => { dragging = false; lastCell = -1; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (!dragging) board?.hover(-1); });
  canvas.addEventListener('blur', () => board?.hover(-1));

  canvas.addEventListener('keydown', (event) => {
    if (!board || solved) return;
    const n = puzzle.size;
    const h = head();
    const moves = { ArrowUp: h - n, ArrowDown: h + n, ArrowLeft: h % n > 0 ? h - 1 : -1, ArrowRight: h % n < n - 1 ? h + 1 : -1 };
    if (event.key in moves) {
      const cell = moves[event.key];
      event.preventDefault();
      if (cell < 0 || cell >= n * n) return;
      if (path.length > 1 && path[path.length - 2] === cell) cutTo(path.length - 2);
      else step(cell);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      cutTo(path.length - 2);
    }
  });

  const shell = createShell({
    storageKey: 'zipper', sound,
    onNew: start,
    onReset() {
      if (!board) return;
      if (solved) solved = false;
      cutTo(0);
      shell.restart();
      announce();
    },
    onHint() {
      if (!board || solved) return;
      const next = hint(puzzle, path);
      assisted = true;
      if (next.type === 'cut') {
        board.showHint(path.slice(next.keep), { mistake: true });
        shell.toast('The highlighted part takes a wrong turn. Retrace it to the last unmarked cell.', 5000);
      } else if (next.type === 'extend') {
        board.showHint(next.cells);
        const number = puzzle.numbers[next.cells.at(-1)];
        shell.toast(`Follow the highlighted cells to ${number}. Draw the line yourself.`, 5000);
      }
      shell.countHint();
    },
  });

  stage.start();
  document.body.classList.add('ready');
  // For the browser check: where a cell is on the page.
  canvas.puzzleTest = { cellPoint: (cell) => stage.project(board.centre(cell)) };
}
