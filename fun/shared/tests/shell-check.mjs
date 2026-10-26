// Run with: node fun/shared/tests/shell-check.mjs
// Exercise the actual shared shell with a deterministic clock and DOM.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { dailySeed } from '../themes.js';

function element() {
  const listeners = new Map();
  const children = new Map();
  return {
    textContent: '', open: false, disabled: false, attributes: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, callback) { listeners.set(type, callback); },
    emit(type, event = {}) { listeners.get(type)?.(event); },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, element()); return children.get(selector); },
    replaceChildren() { this.textContent = ''; },
    showModal() { this.open = true; },
    close() { this.open = false; this.emit('close'); },
    focus() {},
  };
}

const nodes = new Map();
const $ = (selector) => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
const markup = await readFile(new URL('../../zipper/index.html', import.meta.url), 'utf8');
const selectors = new Set([...markup.matchAll(/\b(data-[\w-]+)(?:="([^"]*)")?/g)].flatMap(([, name, value]) =>
  value === undefined ? [`[${name}]`] : [`[${name}]`, `[${name}="${value}"]`]));
selectors.add('#stage');
const radios = ['easy', 'medium', 'hard'].map((value) => Object.assign(element(), { value, checked: value === 'medium' }));
const storage = new Map([['zipper-seen', '1']]);
const document = Object.assign(element(), {
  hidden: false, body: { dataset: {} }, documentElement: { style: { setProperty() {} } },
  querySelector: (selector) => selectors.has(selector) ? $(selector) : null, querySelectorAll: () => radios,
});
const window = element();
const analyticsEvents = [];
window.protocodusAnalytics = { track: (event, parameters) => analyticsEvents.push({ event, parameters }) };
const location = { hash: '#medium-alpha', href: 'https://example.test/zipper/#medium-alpha' };
let clock = 0, tick;
const context = vm.createContext({
  document, window, location, dailySeed, randomSeed: () => 'newseed',
  history: { replaceState(_state, _title, hash) { location.hash = hash; } },
  localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  performance: { now: () => clock }, setInterval(callback) { tick = callback; },
  setTimeout() {}, clearTimeout() {},
});
const source = (await readFile(new URL('../shell.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace('export function createShell', 'function createShell');
vm.runInContext(source, context, { filename: 'shared/shell.js' });
const actions = { new: [], reset: 0, hints: 0, undo: 0 };
const sound = { enabled: true, toggle() { this.enabled = !this.enabled; } };
const shell = context.createShell({
  storageKey: 'zipper', sound,
  onNew: (...args) => actions.new.push(args), onReset: () => actions.reset++,
  onHint: () => actions.hints++, onUndo: () => actions.undo++,
});

assert.equal(shell.difficulty, 'medium');
assert.equal(shell.seed, 'alpha');
assert.equal(actions.new.length, 1, 'Initial shared link loads once');
assert.equal(analyticsEvents.length, 0, 'Loading a puzzle is not a play start');
clock = 3000; tick();
assert.equal($('[data-timer]').textContent, '0:00', 'Looking at a board does not start the timer');
shell.begin();
shell.begin();
assert.equal(analyticsEvents.length, 1, 'Repeated play inputs emit one start per attempt');
assert.equal(analyticsEvents[0].event, 'game_start');
assert.equal(analyticsEvents[0].parameters.game_name, 'zipper');
assert.equal(analyticsEvents[0].parameters.difficulty, 'medium');
assert.equal(analyticsEvents[0].parameters.game_mode, 'puzzle');
assert.equal('seed' in analyticsEvents[0].parameters, false, 'Puzzle seeds are not sent');
clock += 2200; tick();
assert.equal($('[data-timer]').textContent, '0:02');
$('[data-action="help"]').emit('click');
clock += 15000; tick();
$('[data-dialog="help"]').close();
clock += 800; tick();
assert.equal($('[data-timer]').textContent, '0:03', 'Reading the rules does not add play time');
document.hidden = true; document.emit('visibilitychange');
clock += 60000;
document.hidden = false; document.emit('visibilitychange');
clock += 1000;
assert.equal(shell.finish(), 4000, 'Background tabs do not add play time');
document.hidden = true; document.emit('visibilitychange');
clock += 2000;
document.hidden = false; document.emit('visibilitychange');
clock += 1000;
assert.equal(shell.finish(), 4000, 'Finishing prevents the clock from resuming');
assert.equal(analyticsEvents.length, 2, 'Repeated finish calls emit one end per attempt');
assert.equal(analyticsEvents[1].event, 'game_end');
assert.equal(analyticsEvents[1].parameters.result, 'win');
assert.equal(analyticsEvents[1].parameters.duration_seconds, 4, 'Analytics uses active play time');
assert.equal($('[data-action="hint"]').disabled, true, 'Solved boards disable hints');
shell.restart();
assert.equal($('[data-timer]').textContent, '0:00');
assert.equal($('[data-action="hint"]').disabled, false, 'Reset permits hints again');

shell.setProgress(8, 25, 'Next: 3');
assert.equal($('[data-progress]').value, 8);
assert.equal($('[data-progress]').max, 25);
assert.match($('[data-progress]').attributes['aria-valuetext'], /8 of 25.*Next: 3/);
shell.setUndoAvailable(true);
assert.equal($('[data-action="undo"]').disabled, false);
$('[data-action="daily"]').emit('click');
assert.equal(shell.seed, dailySeed(), 'Daily button opens today’s deterministic board');
assert.equal($('[data-action="daily"]').attributes['aria-pressed'], 'true');
shell.begin();
assert.equal(analyticsEvents.at(-1).parameters.game_mode, 'daily');
assert.equal(analyticsEvents.filter(({ event }) => event === 'game_start').length, 2, 'A new board starts a new attempt');
shell.fresh('hard');
assert.equal(location.hash, '#hard-newseed', 'New puzzles retain a shareable difficulty and seed');
assert.equal($('[data-action="daily"]').attributes['aria-pressed'], 'false');

const key = (value, target = { tagName: 'CANVAS' }, extra = {}) => document.emit('keydown', { key: value, target, preventDefault() {}, ...extra });
key('h'); assert.equal(actions.hints, 1, 'Hint shortcut works from the board');
key('h', { tagName: 'INPUT' });
key('h', { tagName: 'DIV', isContentEditable: true });
key('h', { tagName: 'CANVAS' }, { ctrlKey: true });
assert.equal(actions.hints, 1, 'Editing fields and modified shortcuts keep their normal behavior');
key('?');
key('h');
assert.equal(actions.hints, 1, 'Open modal dialogs suppress game shortcuts');
delete window.protocodusAnalytics;
assert.doesNotThrow(() => { shell.begin(); shell.finish(); }, 'Games remain playable when analytics is unavailable');
console.log('Shell checks passed: active play time, help/background pauses, finish/reset, daily links, accessible progress, keyboard focus and deduplicated optional analytics.');
