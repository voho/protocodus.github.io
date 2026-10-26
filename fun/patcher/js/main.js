/* Patcher — wiring: the puzzle, the board, the pointer and the chrome. */
import { createStage } from '../../shared/stage.js';
import { createBursts } from '../../shared/particles.js';
import { createSound } from '../../shared/sound.js';
import { createShell } from '../../shared/shell.js';
import { waitForFont } from '../../shared/slab.js';
import { randomSeed } from '../../shared/rng.js';
import { createThemeSwitch } from '../../shared/themes.js';
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
const stage = createStage(canvas, { theme: themes.current, ambience: 'atelier' });
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
  let tapAnchor = -1;
  let shell = null;
  let winTimer = 0;
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
    if (!colours.has(clue)) {
      const palette = themes.current.palette;
      colours.set(clue, palette[colours.size % palette.length]);
    }
    return colours.get(clue);
  };

  function announce() {
    if (!puzzle) return;
    const covered = patches.reduce((sum, patch) => sum + patch.w * patch.h, 0);
    status.textContent = solved ? 'Solved.' : `${patches.length} of ${puzzle.clues.length} patches placed. ${covered} of ${puzzle.size * puzzle.size} cells covered.`;
    shell?.setProgress?.(covered, puzzle.size * puzzle.size, `${patches.length} / ${puzzle.clues.length} patches`);
    shell?.setUndoAvailable?.(!solved && undo.length > 0);
  }

  function start(difficulty, seed) {
    clearTimeout(winTimer);
    try {
      puzzle = generate(difficulty, seed);
    } catch (error) {
      // An unverified board must not reach the table. Retry next turn
      // with a fresh seed, including during initial startup.
      console.error(error);
      setTimeout(() => shell.load(difficulty, randomSeed()), 0);
      return;
    }
    cancelSelection();
    board?.dispose();
    const theme = themes.current;
    board = createBoard(stage, puzzle, { accent: theme.accent, fx, theme });
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
    cancelSelection();
    board.dispose();
    const theme = themes.current;
    board = createBoard(stage, puzzle, { accent: theme.accent, fx, theme });
    colours = new Map();
    for (const patch of patches) board.place(patch, colourFor(patch.clue), null, true);
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
    clearTimeout(winTimer);
    winTimer = setTimeout(() => { if (puzzle === finished && solved) shell.showWin({ ms, assisted }); }, 1600);
  }

  function place(patch, record = true) {
    patches.push(patch);
    if (record) undo.push({ type: 'place', patch });
    sound.place();
    board.place(patch, colourFor(patch.clue), () => { stage.flash(colourFor(patch.clue), 0.12); });
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
  function cancelSelection() {
    const pointerId = drag?.pointerId;
    drag = null;
    tapAnchor = -1;
    keyAnchor = -1;
    board?.preview(null);
    shell?.clearFeedback?.();
    if (pointerId !== undefined && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  function preview(rect) {
    const reason = rejectReason(puzzle, patches, rect);
    board.preview(rect, reason === null);
    const dimensions = `${rect.w} × ${rect.h} · ${rect.w * rect.h} cells`;
    shell?.setFeedback?.(`${dimensions} · ${reason ? REASONS[reason] : 'Ready to place'}`);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!board || solved || drag || event.button > 0 || event.isPrimary === false) return;
    sound.unlock();
    canvas.focus({ preventScroll: true });
    const cell = cellFromEvent(event, false);
    if (cell < 0) { cancelSelection(); return; }
    keyAnchor = -1;
    board.preview(null);
    shell?.clearFeedback?.();
    canvas.setPointerCapture(event.pointerId);
    if (tapAnchor === cell) { cancelSelection(); return; }
    const anchor = tapAnchor >= 0 ? tapAnchor : cell;
    const completingTap = tapAnchor >= 0;
    const covering = completingTap ? null : patches.find((p) => inside(p, cell));
    tapAnchor = -1;
    drag = { pointerId: event.pointerId, anchor, cell, rect: rectBetween(anchor, cell),
      moved: completingTap, completingTap, covering, startX: event.clientX, startY: event.clientY };
    if (!covering) preview(drag.rect);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!board) return;
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      if (drag.covering) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) drag.moved = true;
        return;
      }
      const cell = cellFromEvent(event, true);
      if (cell >= 0 && cell !== drag.cell) {
        drag.cell = cell;
        drag.moved = true;
        // The opposite corner follows the pointer in both directions, so
        // overshooting a small patch never forces the player to start over.
        drag.rect = rectBetween(drag.anchor, cell);
        preview(drag.rect);
      }
    } else if (event.pointerType === 'mouse') {
      const cell = cellFromEvent(event, false);
      board.hover(cell);
      if (tapAnchor >= 0 && cell >= 0) preview(rectBetween(tapAnchor, cell));
    }
  });
  /* A rectangle lands on release; feedback explains an invalid choice. */
  function commit(rect, moved, anchor) {
    board.preview(null);
    shell?.clearFeedback?.();
    if (solved) return;
    const reason = rejectReason(puzzle, patches, rect);
    if (!reason) { place({ clue: cluesInside(puzzle, rect)[0], ...rect }); return; }
    const isClue = puzzle.clues.some((clue) => clue.cell === anchor);
    if (!moved && !isClue) shell.toast('Drag between opposite corners, or tap both corners.');
    else if (!moved && (reason === 'number' || reason === 'shape')) shell.toast('Choose the opposite corner to make a bigger patch.');
    else { board.reject(rect); sound.buzz(); shell.toast(REASONS[reason]); }
  }
  const release = (event) => {
    if (!drag || !board || event.pointerId !== drag.pointerId) return;
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') { cancelSelection(); return; }
    const current = drag;
    drag = null;
    if (current.covering) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 8) current.moved = true;
      if (!current.moved) lift(current.covering);
      return;
    }
    // Some devices deliver a final position only on pointerup.
    const cell = cellFromEvent(event, true);
    if (cell >= 0 && cell !== current.cell) {
      current.rect = rectBetween(current.anchor, cell);
      current.moved = true;
    }
    if (!current.moved && rejectReason(puzzle, patches, current.rect)) {
      tapAnchor = current.anchor;
      preview(current.rect);
      shell?.setFeedback?.('Corner selected · tap the opposite corner, or tap here to cancel');
      return;
    }
    commit(current.rect, current.moved, current.anchor);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('pointerleave', () => { if (!drag) board?.hover(-1); });
  canvas.addEventListener('blur', () => { cancelSelection(); board?.hover(-1); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelSelection(); });

  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (drag || keyAnchor >= 0 || tapAnchor >= 0)) {
      event.preventDefault();
      cancelSelection();
      return;
    }
    if (!board || solved || drag) return;
    const n = puzzle.size;
    if (cursor < 0) cursor = 0;
    const c = cursor % n, r = Math.floor(cursor / n);
    const moves = { ArrowUp: [c, r - 1], ArrowDown: [c, r + 1], ArrowLeft: [c - 1, r], ArrowRight: [c + 1, r] };
    if (event.key in moves) {
      event.preventDefault();
      if (tapAnchor >= 0) { tapAnchor = -1; board.preview(null); shell?.clearFeedback?.(); }
      const [nc, nr] = moves[event.key];
      cursor = Math.max(0, Math.min(n - 1, nr)) * n + Math.max(0, Math.min(n - 1, nc));
      board.hover(cursor);
      if (keyAnchor >= 0) {
        const rect = rectBetween(keyAnchor, cursor);
        preview(rect);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      sound.unlock();
      tapAnchor = -1;
      if (keyAnchor >= 0) {
        const anchor = keyAnchor;
        keyAnchor = -1;
        commit(rectBetween(anchor, cursor), anchor !== cursor, anchor);
        return;
      }
      const covering = patches.find((p) => inside(p, cursor));
      if (covering) { cancelSelection(); lift(covering); return; }
      keyAnchor = cursor;
      board.hover(cursor);
      preview(rectBetween(cursor, cursor));
    } else if (event.key === 'x' || event.key === 'Delete' || event.key === 'Backspace') {
      const covering = patches.find((p) => inside(p, cursor));
      if (covering) { event.preventDefault(); cancelSelection(); lift(covering); }
    }
  });

  shell = createShell({
    storageKey: 'patcher', sound,
    onNew: start,
    onReset() {
      if (!board) return;
      clearTimeout(winTimer);
      cancelSelection();
      board.clearHint?.();
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
      cancelSelection();
      const last = undo.pop();
      if (!last) return;
      if (last.type === 'place') lift(last.patch, false);
      else place(last.patch, false);
    },
    onHint() {
      if (!board || solved) return;
      cancelSelection();
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

  announce();
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
