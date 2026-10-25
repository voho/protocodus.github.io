// Run real game event handlers without requiring WebGL or a browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export async function gameHarness(game, puzzle, logic, { failGenerations = 0 } = {}) {
  const listeners = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const timers = new Map();
  let timerId = 0;
  const status = { textContent: '' };
  const captures = new Set();
  const state = {
    mutations: [], highlights: [], inputs: [], previews: [], progress: [], feedback: [],
    begins: 0, finishes: 0, wins: 0, hints: 0, toasts: [], undoAvailable: false, starts: 0, errors: [], ready: false,
  };
  const canvas = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    focus() {},
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
  };
  const board = {
    cellAt(point, clamp = false) {
      let x = Math.round(point.x), y = Math.round(point.z);
      const n = puzzle.size;
      if (clamp) { x = Math.max(0, Math.min(n - 1, x)); y = Math.max(0, Math.min(n - 1, y)); }
      return x < 0 || x >= n || y < 0 || y >= n ? -1 : y * n + x;
    },
    setPath: (path) => state.mutations.push(['path', structuredClone(path)]),
    place: (patch) => state.mutations.push(['place', structuredClone(patch)]),
    lift: (clue) => state.mutations.push(['lift', clue]),
    showHint: (cells, options) => state.highlights.push({ cells: structuredClone(cells), ...options }),
    show: (patch, options) => state.highlights.push({ patch: structuredClone(patch), ...options }),
    preview: (rect, valid) => state.previews.push({ rect: rect ? structuredClone(rect) : null, valid }),
    hover() {}, bump() {}, flare() {}, celebrate() {}, dispose() {}, centre() {}, clearHint() {},
  };
  const context = vm.createContext({
    ...logic,
    hint(p, input) { state.inputs.push(structuredClone(input)); return logic.hint(p, input); },
    generate: () => {
      if (failGenerations-- > 0) throw new Error('Simulated generation failure');
      return structuredClone(puzzle);
    },
    randomSeed: () => 'retryseed',
    createThemeSwitch: () => ({ current: { label: 'Test', accent: '#87d7be', palette: ['#87d7be'] } }),
    createStage: () => ({
      start() { state.starts++; }, flash() {}, setTheme() {},
      pick: (x, y) => ({ x: x / 100, z: y / 100 }), project() {},
    }),
    createBoard: () => board,
    createBursts: () => ({}),
    createSound: () => new Proxy({}, { get: () => () => {} }),
    createShell(options) {
      state.actions = options;
      options.onNew('easy', 'test');
      return {
        load: (difficulty, seed) => options.onNew(difficulty, seed),
        begin: () => state.begins++, finish: () => { state.finishes++; return 0; },
        countHint: () => state.hints++, toast: (text) => state.toasts.push(text),
        setProgress: (...args) => state.progress.push(args),
        setFeedback: (text) => state.feedback.push(text), clearFeedback: () => state.feedback.push(''),
        setUndoAvailable: (available) => { state.undoAvailable = available; },
        restart() {}, showWin: () => state.wins++,
      };
    },
    waitForFont: () => Promise.resolve(),
    document: {
      addEventListener: (name, listener) => documentListeners.set(name, listener),
      getElementById: () => canvas,
      querySelector: (selector) => selector === '[data-status]' ? status : {},
      body: { classList: { add(name) { if (name === 'ready') state.ready = true; } } },
    },
    window: { addEventListener: (name, listener) => windowListeners.set(name, listener) },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }, console: { ...console, error: (error) => state.errors.push(error.message) },
  });
  const source = (await readFile(new URL(`../../${game}/js/main.js`, import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('  boot();', '  globalThis.booted = boot();');
  vm.runInContext(source, context, { filename: `${game}/js/main.js` });
  await context.booted;
  state.key = (key) => listeners.get('keydown')({ key, preventDefault() {} });
  state.pointer = (type, cell, pointerId = 1, overrides = {}) => {
    const event = {
      type, pointerId, pointerType: 'touch', button: 0, isPrimary: pointerId === 1,
      clientX: (cell % puzzle.size) * 100, clientY: Math.floor(cell / puzzle.size) * 100,
      preventDefault() {}, ...overrides,
    };
    listeners.get(type)?.(event);
  };
  state.blur = () => { listeners.get('blur')?.(); windowListeners.get('blur')?.(); };
  state.hide = () => { context.document.hidden = true; documentListeners.get('visibilitychange')?.(); };
  state.runTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const callback of pending) callback();
  };
  state.path = () => state.mutations.filter(([type]) => type === 'path').at(-1)?.[1];
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
