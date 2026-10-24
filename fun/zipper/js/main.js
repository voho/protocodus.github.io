/* Zipper — wiring: the puzzle, the board, the pointer and the chrome. */
import { createStage } from '../../shared/stage.js';
import { createBursts } from '../../shared/particles.js';
import { createSound } from '../../shared/sound.js';
import { createShell } from '../../shared/shell.js';
import { waitForFont } from '../../shared/slab.js';
import { randomSeed } from '../../shared/rng.js';
import { themeFor } from '../../shared/themes.js';
import { generate, canStep, isSolved, hint, straightLine } from './puzzle.js';
import { createBoard } from './board.js';

const ACCENT = '#87d7be';
const canvas = document.getElementById('stage');
const loading = document.querySelector('[data-loading]');
const status = document.querySelector('[data-status]');

const stage = createStage(canvas, {
  accent: ACCENT, secondary: '#8f7cff', elevation: 1.0,
  backdrop: { top: '#0e2432', bottom: '#030609', glow: ACCENT, glowStrength: 0.13, blobA: '#2fd9c0', blobB: '#7a5cff', blobStrength: 0.08 },
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
  stage.bokeh({ colours: [ACCENT, '#7a5cff', '#ffffff', '#f6d155'] });
  const sound = createSound('zipper');

  let puzzle = null;
  let board = null;
  let path = [];
  let solved = false;
  let assisted = false;
  let activePointer = null;
  let lastPoint = null;
  let lastCell = -1;
  let shell;
  let winTimer = 0;

  const N = () => puzzle.size * puzzle.size;
  const head = () => path[path.length - 1];

  function announce() {
    let next = 1;
    for (const cell of path) if (puzzle.numbers[cell]) next = puzzle.numbers[cell] + 1;
    next = Math.min(next, puzzle.waypoints.length);
    status.textContent = solved ? 'Solved.' : `${path.length} of ${N()} cells. Next number ${next}.`;
    shell?.setProgress?.(path.length, N(), solved ? 'Every cell connected' : `Next: ${next} of ${puzzle.waypoints.length}`);
    shell?.setUndoAvailable?.(!solved && path.length > 1);
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
    releasePointer();
    clearTimeout(winTimer);
    board?.dispose();
    const theme = themeFor(seed, 'zipper');
    stage.setTheme?.(theme);
    board = createBoard(stage, puzzle, { accent: theme.accent, theme, fx });
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
    winTimer = setTimeout(() => { if (puzzle === finished && solved) shell.showWin({ ms, assisted }); }, 1500);
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
    index = Math.max(0, index);
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

  // Sample the pointer's actual route through the table. A quick swipe can
  // skip several cells between browser events, including around a corner;
  // interpolating table coordinates keeps the line under the finger.
  function followPointer(event) {
    const point = stage.pick(event.clientX, event.clientY, 0.16);
    if (!point) { lastPoint = null; return; }
    const next = { x: point.x, z: point.z };
    const previous = lastPoint || next;
    const distance = Math.hypot(next.x - previous.x, next.z - previous.z);
    const samples = Math.min(160, Math.max(1, Math.ceil(distance / 0.22)));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const cell = board.cellAt({ x: previous.x + (next.x - previous.x) * t, z: previous.z + (next.z - previous.z) * t });
      if (cell >= 0 && cell !== lastCell) {
        lastCell = cell;
        moveTo(cell, true);
      }
    }
    lastPoint = next;
  }

  function releasePointer() {
    const pointer = activePointer;
    activePointer = null;
    lastPoint = null;
    lastCell = -1;
    if (pointer !== null && canvas.hasPointerCapture?.(pointer)) canvas.releasePointerCapture(pointer);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!board || solved || event.button > 0 || activePointer !== null) return;
    const point = stage.pick(event.clientX, event.clientY, 0.16);
    const cell = point ? board.cellAt(point) : -1;
    if (cell < 0) return;
    sound.unlock();
    canvas.focus({ preventScroll: true });
    activePointer = event.pointerId;
    lastPoint = { x: point.x, z: point.z };
    lastCell = cell;
    canvas.setPointerCapture(event.pointerId);
    moveTo(cell, false);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!board) return;
    if (activePointer !== null) {
      if (event.pointerId !== activePointer) return;
      const samples = event.getCoalescedEvents?.() || [];
      for (const sample of samples) followPointer(sample);
      followPointer(event);
    } else if (event.pointerType === 'mouse') {
      const point = stage.pick(event.clientX, event.clientY, 0.16);
      board.hover(point ? board.cellAt(point) : -1);
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== activePointer) return;
    followPointer(event);
    releasePointer();
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (event.pointerId === activePointer) releasePointer();
  });
  canvas.addEventListener('lostpointercapture', (event) => {
    if (event.pointerId === activePointer) releasePointer();
  });
  canvas.addEventListener('pointerleave', () => { if (activePointer === null) board?.hover(-1); });
  canvas.addEventListener('blur', () => { releasePointer(); board?.hover(-1); });

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

  shell = createShell({
    storageKey: 'zipper', sound,
    onNew: start,
    onReset() {
      if (!board) return;
      releasePointer();
      clearTimeout(winTimer);
      if (solved) solved = false;
      cutTo(0);
      shell.restart();
      announce();
    },
    onUndo() {
      if (!board || solved) return;
      releasePointer();
      cutTo(path.length - 2);
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

  announce();
  stage.start();
  document.body.classList.add('ready');
  // For the browser check: where a cell is on the page.
  canvas.puzzleTest = { cellPoint: (cell) => stage.project(board.centre(cell)) };
}
