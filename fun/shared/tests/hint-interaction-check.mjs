// Run with: node fun/shared/tests/hint-interaction-check.mjs
// Exercise the actual Hint handlers with the renderer and page chrome stubbed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as zipper from '../../zipper/js/puzzle.js';
import * as patcher from '../../patcher/js/puzzle.js';

async function gameHarness(game, puzzle, logic) {
  const listeners = new Map();
  const status = { textContent: '' };
  const state = { mutations: [], highlights: [], inputs: [], begins: 0, finishes: 0, hints: 0, toasts: [] };
  const canvas = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    focus() {}, setPointerCapture() {},
  };
  const board = {
    cellAt: (point) => point.x,
    setPath: (path) => state.mutations.push(['path', structuredClone(path)]),
    place: (patch) => state.mutations.push(['place', structuredClone(patch)]),
    lift: (clue) => state.mutations.push(['lift', clue]),
    showHint: (cells, options) => state.highlights.push({ cells: structuredClone(cells), ...options }),
    show: (patch, options) => state.highlights.push({ patch: structuredClone(patch), ...options }),
    preview() {}, hover() {}, bump() {}, flare() {}, celebrate() {}, dispose() {}, centre() {},
  };
  const context = vm.createContext({
    ...logic,
    hint(p, input) { state.inputs.push(structuredClone(input)); return logic.hint(p, input); },
    generate: () => puzzle,
    createStage: () => ({ start() {}, flash() {}, setTheme() {}, pick: (x) => ({ x }), project() {} }),
    createBoard: () => board,
    createBursts: () => ({}),
    createSound: () => new Proxy({}, { get: () => () => {} }),
    createShell(options) {
      state.actions = options;
      options.onNew('easy', 'test');
      return {
        begin: () => state.begins++, finish: () => { state.finishes++; return 0; },
        countHint: () => state.hints++, toast: (text) => state.toasts.push(text),
        restart() {}, showWin() {},
      };
    },
    waitForFont: () => Promise.resolve(),
    createThemeSwitch: () => ({ current: { label: 'Test', accent: '#87d7be', palette: ['#87d7be'] } }),
    document: {
      getElementById: () => canvas,
      querySelector: (selector) => selector === '[data-status]' ? status : {},
      body: { classList: { add() {} } },
    },
    setTimeout() {}, console,
  });
  const source = (await readFile(new URL(`../../${game}/js/main.js`, import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('  boot();', '  globalThis.booted = boot();');
  vm.runInContext(source, context, { filename: `${game}/js/main.js` });
  await context.booted;
  state.key = (key) => listeners.get('keydown')({ key, preventDefault() {} });
  state.checkHint = () => {
    const before = { mutations: structuredClone(state.mutations), begins: state.begins, finishes: state.finishes, status: status.textContent };
    state.actions.onHint();
    const input = state.inputs.at(-1);
    // A second click must see exactly the same player state as the first.
    state.actions.onHint();
    assert.deepEqual(state.inputs.at(-1), input, `${game}: Hint changed player state`);
    assert.deepEqual(state.mutations, before.mutations, `${game}: Hint changed rendered moves`);
    assert.equal(state.begins, before.begins, `${game}: Hint started the clock`);
    assert.equal(state.finishes, before.finishes, `${game}: Hint finished the puzzle`);
    assert.equal(status.textContent, before.status, `${game}: Hint changed move count`);
    assert.ok(state.highlights.length && state.toasts.length, `${game}: Hint must show guidance`);
    return state.highlights.at(-1);
  };
  return state;
}

const zipPuzzle = {
  size: 3, waypoints: [0, 8], numbers: [1, 0, 0, 0, 0, 0, 0, 0, 2], walls: [],
  solution: [0, 1, 2, 5, 4, 3, 6, 7, 8], neighbours: zipper.neighbourTable(3, []),
};
const zip = await gameHarness('zipper', zipPuzzle, zipper);
assert.deepEqual(zip.checkHint().cells, zipPuzzle.solution.slice(1), 'Zipper: show a route without drawing it');
zip.key('ArrowDown');
assert.deepEqual(zip.mutations.at(-1), ['path', [0, 3]], 'Zipper: the player can still draw');
assert.deepEqual(zip.checkHint(), { cells: [3], mistake: true }, 'Zipper: identify a wrong turn without retracing it');
zip.key('Backspace');
assert.deepEqual(zip.mutations.at(-1), ['path', [0]], 'Zipper: only the player retraces the wrong turn');
for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) zip.key(key);
assert.deepEqual(zip.checkHint().cells, [8], 'Zipper: the last move remains for the player');
assert.equal(zip.finishes, 0);
zip.key('ArrowRight');
assert.equal(zip.finishes, 1, 'Zipper: the player completes the board');

const patchPuzzle = {
  size: 3,
  clues: [{ cell: 1, number: 3, shape: 'wide' }, { cell: 3, number: 2, shape: 'tall' }, { cell: 8, number: 4, shape: 'square' }],
  solution: [{ clue: 0, x: 0, y: 0, w: 3, h: 1 }, { clue: 1, x: 0, y: 1, w: 1, h: 2 }, { clue: 2, x: 1, y: 1, w: 2, h: 2 }],
};
const patch = await gameHarness('patcher', patchPuzzle, patcher);
assert.deepEqual(patch.checkHint().patch, patchPuzzle.solution[0], 'Patcher: suggest without placing');
// A tall 1×2 from the top-left corner: the right shape and count for the
// second clue, in the wrong place.
patch.key('Enter'); patch.key('ArrowDown'); patch.key('Enter');
const wrong = { clue: 1, x: 0, y: 0, w: 1, h: 2 };
assert.deepEqual(patch.mutations.at(-1), ['place', wrong]);
assert.deepEqual(patch.checkHint(), { patch: wrong, mistake: true }, 'Patcher: highlight a mistake without lifting it');
patch.actions.onUndo();
assert.deepEqual(patch.mutations.at(-1), ['lift', 1], 'Patcher: Hint must preserve undo history');
patch.checkHint();
assert.deepEqual(patch.inputs.at(-1), [], 'Patcher: player undo removed the patch');

console.log('Hint interaction checks passed: guidance leaves moves, clock, solved state and undo history unchanged.');
