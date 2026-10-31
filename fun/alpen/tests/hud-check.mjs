// Run with: node tests/hud-check.mjs
// DOM stand-ins cover HUD state and input gating; appearance needs browser QA.
import assert from 'node:assert/strict';
import { createHud } from '../js/hud.js';
import { RIDER, SCORE } from '../js/config.js';
import { butterName } from '../js/rider.js';
let writes = 0, targetQueries = 0;
const tracked = value => new Proxy(value, {
  set(target, key, next) { target[key] = next; writes++; return true; },
  deleteProperty(target, key) { if (key in target) writes++; return Reflect.deleteProperty(target, key); },
});
class Node {
  constructor(hud = '') { this.dataset = tracked({ hud }); this._hidden = false; this._text = ''; this.listeners = {}; this.nodes = {}; this.style = tracked({ setProperty(k,v) { this[k] = v; } }); }
  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = value; writes++; }
  get textContent() { return this._text; }
  set textContent(s) { this._text = s; writes++; }
  setAttribute(k,v) { this[k] = v; }
  appendChild(n) { return n; }
  querySelector(s) { return this.nodes[s] || null; }
  querySelectorAll(s) { targetQueries++; return s === '[data-hud]' ? Object.values(this.fields) : (this.targets || []).filter(node => !node.href || s.includes('a[href]')); }
  insertAdjacentHTML(where,s) { this.fields = Object.fromEntries([...s.matchAll(/data-hud="([^"]+)"/g)].map(m => [m[1],new Node(m[1])])); }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  focus() { document.activeElement = this; }
  blur() { document.activeElement = null; }
  contains(n) { return this.targets?.includes(n) || n === this; }
  getClientRects() { return this.hidden || this.cssHidden ? [] : [{}]; }
  getBoundingClientRect() { return this.bounds?.() || { top: 0, bottom: 0 }; }
  scrollIntoView(options) { this.scrollOptions = options; this.onScroll?.(options); }
  click() { this.clicks = (this.clicks || 0) + 1; this.onClick?.(); }
}
const root = new Node(), curtain = new Node(), guide = new Node(), button = new Node(), summary = new Node(), exitLink = new Node(), menuScroller = new Node();
root.nodes['canvas'] = new Node();
root.nodes['[data-readout]'] = new Node();
root.nodes['[data-callout]'] = new Node();
curtain.nodes['.control-guide'] = guide;
curtain.nodes['.exit-link'] = exitLink;
curtain.nodes['.drop-in'] = button;
curtain.nodes['.curtain-inner'] = menuScroller;
exitLink.href = '/fun/';
for (const name of ['score','distance','drop']) curtain.nodes[`[data-menu-${name}]`] = new Node();
curtain.targets = [button, summary, exitLink];
guide.nodes.summary = summary;
const body = { dataset: new Proxy({ inputDevice: 'keyboard' }, {
  set(target, name, value) { target[name] = value; writes++; return true; },
}) };
globalThis.document = { body, activeElement: null, querySelector: () => curtain, createElement: () => new Node() };
globalThis.window = { devicePixelRatio: 2, innerHeight: 800 };
const hud = createHud(root), f = root.fields;
assert.equal(hud.menu('activate'), true, 'primary action works before the first HUD update');
assert.equal(button.clicks, 1);
assert.equal(document.activeElement, button);
// Simulate the bootstrap clearing focus again before the initial title draw.
document.activeElement = null;
const g = { mode: 'attract', score: 0, best: 100, bestAtStart: 100, combo: 1, flow: 0, gateRun: 0, pisteOffset: 0,
 weather: { phase: 'Dawn', conditions: 'Clear', storm: 0 }, rider: { grounded: true, speed: 10, distance: 100, drop: 20, pos: { z: -100 }, charging: false, charge: 0, airTime: 0 } };
hud.update(g, .1);
assert.equal(f.ride.hidden, true);
assert.equal(document.activeElement, curtain);
assert.equal(hud.canvas.width, 1);
hud.setSize(1800, 1600, 1, 0, 0, { top: 40, right: 0, left: 0, bottom: 0 });
assert.equal(root.style['--hud-inset-top'], '20px');
g.mode = 'playing';
hud.update(g, .1);
assert.equal(f.ride.hidden, false);
assert.equal(f.speed.textContent, '36');
assert.equal(f.descent.textContent, '0.10 km  /  20 m ↓');
assert.equal(f.charge.hidden, true);
assert.match(root.nodes['[data-readout]'].textContent, /36 kilometres per hour/);
g.rider.charging = true; g.rider.charge = .53;
hud.update(g, .1);
assert.equal(f.charge.hidden, false);
assert.equal(f['charge-fill'].style.transform, 'scaleX(0.53)');
g.rider.charge = 1;
hud.update(g, .1);
assert.equal(f['charge-label'].textContent, 'Release to fly');
hud.banner('FRONTSIDE 360', 250);
hud.update(g, .1);
assert.equal(f['event-name'].textContent, 'FRONTSIDE 360');
assert.equal(f['event-points'].textContent, '+250');
g.mode = 'paused';
hud.update(g, 20);
assert.equal(f.ride.hidden, true);
assert.equal(curtain.nodes['[data-menu-score]'].textContent, '0');
const beforePause = writes;
hud.update(g, 10);
assert.equal(writes, beforePause, 'a paused HUD never rewrites identical text');
g.mode = 'playing'; hud.update(g, .1);
assert.equal(f['event-name'].textContent, 'FRONTSIDE 360', 'pause preserves the landing banner');
hud.clearBanner(); g.rider.grounded = false; g.rider.airTime = .7; g.liveTrick = 'BACKFLIP'; hud.update(g, .1);
assert.equal(f['event-name'].textContent, 'BACKFLIP');
assert.equal(f['event-kicker'].textContent, '0.7 s airtime');
assert.equal(f['event-points'].hidden, true);
g.score = 250; g.best = 250; g.combo = 3; g.flow = .4; g.gateRun = 2; g.pisteOffset = -1.2; hud.update(g, .1);
assert.equal(f.combo.textContent, '×3');
assert.equal(f.combo.hidden, false);
assert.equal(f.flow.style.transform, 'scaleX(0.4)');
assert.equal(f.gates.textContent, '2 gates linked');
g.gateRun = 1; hud.update(g, .1);
assert.equal(f.gates.textContent, '1 gate linked');
g.gateRun = 2; hud.update(g, .1);
assert.equal(f.guide.textContent, 'Back to the piste →');
assert.match(f.best.textContent, /Personal best/);
hud.setMuted(true); assert.equal(f.muted.hidden, false);
hud.setMuted(false); assert.equal(f.muted.hidden, true);
g.rider.charging = false; g.rider.grounded = true; g.score = 0; g.gateRun = 0; g.combo = 1; g.flow = 0; g.pisteOffset = 0;
hud.resetScore(); hud.update(g, .1);
assert.equal(f.score.textContent, '0'); assert.equal(f.event.hidden, true); assert.equal(f.combo.hidden, true); assert.equal(f.gates.hidden, true);
for (let i=0; i<100;i++) hud.update(g,.1);
assert.equal(f.hint.hidden, true);
// A deliberate device handoff briefly reintroduces controls. Steady input
// must neither rewrite the DOM nor keep the hint alive for the whole run.
hud.setInputDevice('gamepad');
assert.equal(body.dataset.inputDevice, 'gamepad');
assert.equal(f.hint.hidden, false);
for (let i = 0; i < 100; i++) { hud.setInputDevice('gamepad'); hud.update(g, .1); }
assert.equal(f.hint.hidden, true, 'held controller activity cannot keep refreshing help');
const beforeDevice = writes;
for (let i = 0; i < 10; i++) hud.setInputDevice('gamepad');
hud.setInputDevice('unknown');
assert.equal(writes, beforeDevice, 'stable or invalid devices never write presentation state');
g.mode = 'paused'; hud.update(g, .1);
guide.open = true; summary.focus();
hud.setInputDevice('touch');
assert.equal(body.dataset.inputDevice, 'touch');
assert.equal(guide.open, true, 'switching prompts preserves the open control guide');
assert.equal(document.activeElement, summary, 'switching prompts preserves menu focus');
assert.equal(g.mode, 'paused', 'device selection cannot resume gameplay');
hud.resetScore();
assert.equal(body.dataset.inputDevice, 'touch', 'restart retains the chosen device');
hud.setInputDevice('keyboard');
g.mode = 'playing'; hud.update(g, .1);
assert.equal(f.hint.hidden, false);
// The charge bar says when the lip is coming and when releasing is the pop.
g.rider.charging = true; g.rider.charge = .6; g.rider.lipAhead = true; hud.update(g, .01);
assert.equal(f['charge-label'].textContent, 'Hold it — lip ahead');
assert.equal(f.charge.dataset.lip, 'ahead');
g.rider.lipAhead = false; g.rider.lipReady = true; hud.update(g, .01);
assert.equal(f['charge-label'].textContent, 'Pop now — on the lip');
assert.equal(f.charge.dataset.lip, 'ready');
g.rider.lipReady = false; hud.update(g, .01);
assert.equal(f.charge.dataset.lip, 'none');
assert.equal(f['charge-label'].textContent, 'Load the legs');
g.rider.charging = false;
// Awards in one step queue rather than overwrite; the kicker carries why.
hud.banner('GATE ×3', 360, 'near'); hud.banner('BACKSIDE 360', 900, '', { kicker: '×3 · Lip' });
hud.update(g, .05);
assert.equal(f['event-name'].textContent, 'GATE ×3', 'the first award is shown first');
for (let i = 0; i < 10; i++) hud.update(g, .1);
assert.equal(f['event-name'].textContent, 'BACKSIDE 360', '…and the second is not lost');
assert.equal(f['event-kicker'].textContent, '×3 · Lip');
assert.equal(f['event-points'].textContent, '+900');
// A mid-air callout rides the kicker and leaves the flight its read-out.
hud.clearBanner();
g.rider.grounded = false; g.rider.state = 'air'; g.rider.airTime = .4; g.liveTrick = 'BACKSIDE 180';
hud.banner('PERFECT POP', 0, 'near'); hud.update(g, .01);
assert.equal(f['event-name'].textContent, 'BACKSIDE 180');
assert.equal(f['event-kicker'].textContent, 'PERFECT POP · 0.4 s airtime');
// A held grab gets useful advice before contact, using the physics prediction.
g.rider.grabbing = true; g.rider.airTime = .8; g.rider.touchdownIn = .6;
hud.update(g, .1);
assert.equal(f['event-kicker'].textContent, 'Release grab to land · 0.8 s airtime');
assert.equal(f['event-name'].textContent, 'BACKSIDE 180', 'advice keeps the live trick visible');
assert.equal(f.event.dataset.tone, 'warn');
assert.equal(g.rider.grabbing, true, 'the HUD does not release the player\'s grab');
g.rider.grabbing = false; hud.update(g, .1);
assert.equal(f['event-kicker'].textContent, 'PERFECT POP · 0.8 s airtime', 'release clears advice');
g.rider.grabbing = true;
for (const prediction of [Infinity, NaN, undefined, -.1, .9]) {
  g.rider.touchdownIn = prediction; hud.update(g, .1);
  assert.doesNotMatch(f['event-kicker'].textContent, /Release grab/, 'no advice without a nearby future landing');
}
g.rider.touchdownIn = .2; g.rider.airTime = .1; hud.update(g, .1);
assert.doesNotMatch(f['event-kicker'].textContent, /Release grab/, 'tiny unjudged hops do not prompt');
g.rider.airTime = .8; g.rider.state = 'fall'; hud.update(g, .1);
assert.doesNotMatch(f['event-kicker'].textContent, /Release grab/, 'a tumble cannot request a grab release');
g.rider.grabbing = false;
// A wipeout says why.
g.rider.state = 'fall'; hud.banner('WIPEOUT', 0, 'bad', { kicker: 'UNDER-ROTATED' }); hud.update(g, .01);
assert.equal(f['event-name'].textContent, 'WIPEOUT');
assert.equal(f['event-kicker'].textContent, 'UNDER-ROTATED');
assert.match(root.nodes['[data-callout]'].textContent, /WIPEOUT, UNDER-ROTATED/);
g.rider.grounded = true; g.rider.state = 'ride'; g.rider.airTime = 0; g.liveTrick = '';
for (let i = 0; i < 30; i++) hud.update(g, .1);
assert.equal(f.event.hidden, true, 'every callout clears itself');
// main.liveTrickName owns qualification: a grounded press above .35 and
// abs(spin) >= RIDER.pressMinSpin publishes the real butter name. The HUD
// consumes that result; it must not turn a small press into an achievement.
hud.clearBanner();
g.rider.state = 'ride'; g.rider.grounded = true; g.rider.airTime = 0;
for (const [press, spin] of [[.35, Math.PI], [.8, RIDER.pressMinSpin - .01]]) {
  g.rider.press = press; g.rider.pressSpin = spin; g.liveTrick = '';
  hud.update(g, .1);
  assert.equal(f.event.hidden, true, 'an unqualified grounded press stays quiet');
}
g.rider.press = .8; g.rider.pressSpin = RIDER.pressMinSpin;
g.rider.pressTime = RIDER.pressMinTime + .2;
g.liveTrick = butterName(Math.abs(g.rider.pressSpin));
hud.update(g, .1);
assert.equal(f.event.hidden, false, 'a qualified grounded butter gets live feedback');
assert.equal(f['event-name'].textContent, 'BUTTER 180');
assert.equal(f['event-kicker'].textContent, 'Release grab to finish');
assert.equal(f['event-points'].hidden, true, 'an unfinished butter does not claim points');
assert.equal(g.rider.press, .8, 'feedback does not release the player press');
g.rider.pressSpin = 2 * Math.PI; g.liveTrick = butterName(g.rider.pressSpin);
hud.update(g, .1);
assert.equal(f['event-name'].textContent, 'BUTTER 360', 'continued ground rotation updates the live name');
// Let unrelated hint/readout clocks settle before measuring unchanged values.
for (let i = 0; i < 100; i++) hud.update(g, .1);
const beforeHeldButter = writes;
for (let i = 0; i < 20; i++) hud.update(g, .1);
assert.equal(writes, beforeHeldButter, 'a held butter with unchanged feedback causes no DOM writes');
hud.banner('GATE ×3', 360, 'near'); hud.update(g, .1);
assert.equal(f['event-name'].textContent, 'GATE ×3', 'a scored banner has priority over the live butter');
assert.equal(f['event-points'].textContent, '+360');
for (let i = 0; i < 30; i++) hud.update(g, .1);
assert.equal(f['event-name'].textContent, 'BUTTER 360', 'the live butter returns after the award');
assert.equal(f['event-kicker'].textContent, 'Release grab to finish');
assert.equal(f['event-points'].hidden, true, 'expired award points do not leak into live feedback');

// Releasing a qualified full turn gives main's normal butter award. The
// existing banner takes over with the earned points and no release advice.
const finishedButter = butterName(g.rider.pressSpin);
g.rider.press = 0; g.rider.pressSpin = 0; g.liveTrick = '';
hud.banner(finishedButter, SCORE.butterPerTurn); hud.update(g, .1);
assert.equal(f['event-name'].textContent, 'BUTTER 360');
assert.equal(f['event-kicker'].textContent, 'Run score');
assert.equal(f['event-points'].textContent, '+' + SCORE.butterPerTurn);
assert.equal(f['event-points'].hidden, false);
for (let i = 0; i < 30; i++) hud.update(g, .1);
assert.equal(f.event.hidden, true, 'the finished butter clears when its award expires');

// A previously published name must not keep advising a paused or fallen
// player. Resuming a still-qualified press can display its current name.
g.rider.press = .8; g.rider.pressSpin = Math.PI; g.liveTrick = butterName(Math.PI);
hud.update(g, .1);
g.mode = 'paused'; hud.update(g, .1);
assert.equal(f.ride.hidden, true);
assert.equal(f.event.hidden, true, 'pause hides live grounded guidance');
g.mode = 'playing'; hud.update(g, .1);
assert.equal(f.event.hidden, false, 'resume can show a still-qualified current butter');
for (const state of ['fall', 'rise']) {
  g.rider.state = state; hud.update(g, .1);
  assert.equal(f.event.hidden, true, state + ' clears stale grounded butter guidance');
}
g.rider.state = 'fall';
hud.banner('WIPEOUT', 0, 'bad', { kicker: 'COLLISION' }); hud.update(g, .1);
assert.equal(f['event-name'].textContent, 'WIPEOUT', 'a failure report keeps priority over a stale butter name');
assert.equal(f['event-kicker'].textContent, 'COLLISION');
hud.clearBanner(); g.rider.state = 'ride'; g.liveTrick = '';
g.rider.press = 0; g.rider.pressSpin = 0; g.rider.pressTime = 0;
hud.update(g, .1);
assert.equal(f.event.hidden, true, 'no current trick leaves no live guidance behind');

let stopped = false, prevented = false;
guide.listeners.click({ stopPropagation() { stopped = true; } });
assert.equal(stopped, true, 'help click cannot start the ride');
guide.open = true;
guide.listeners.keydown({ key: 'Escape', stopPropagation() {} });
assert.equal(guide.open, false); assert.equal(document.activeElement, summary);
curtain.listeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, true); assert.equal(document.activeElement, exitLink, 'Tab reaches the return link');
curtain.listeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() {}, stopPropagation() {} });
assert.equal(document.activeElement, button);
curtain.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() {}, stopPropagation() {} });
assert.equal(document.activeElement, exitLink, 'Shift+Tab wraps to the return link');
for (const [type, key] of [['click', undefined], ['keydown', 'Enter']]) {
  stopped = prevented = false;
  exitLink.listeners[type]({ key, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
  assert.equal(stopped, true, 'return navigation cannot start the ride');
  assert.equal(prevented, false, 'return navigation keeps the native link action');
}
for (const key of ['Tab', 'Escape']) {
  stopped = false;
  exitLink.listeners.keydown({ key, stopPropagation() { stopped = true; } });
  assert.equal(stopped, false, `${key} retains the menu behavior`);
}

// Controller menus reuse the same native targets and focus as keyboard and
// pointer navigation. Hidden ancestors, disabled buttons and loading must
// not route activation into another control by accident.
g.mode = 'paused'; hud.update(g, .1);
const restart = new Node(), disabled = new Node();
restart.cssHidden = true; disabled.disabled = true;
curtain.targets = [button, restart, disabled, summary, exitLink];
curtain.focus(); hud.setInputDevice('gamepad');
assert.equal(hud.menu('next'), true);
assert.equal(document.activeElement, button);
assert.equal(button.dataset.controllerFocus, 'true');
assert.equal(button.scrollOptions.block, 'nearest', 'navigation reveals its target');
assert.equal(hud.menu('next'), true);
assert.equal(document.activeElement, summary, 'hidden and disabled targets are skipped');
assert.equal(button.dataset.controllerFocus, undefined, 'only one target carries controller focus');
assert.equal(summary.dataset.controllerFocus, 'true');
assert.equal(hud.menu('previous'), true);
assert.equal(document.activeElement, button);
hud.menu('previous'); assert.equal(document.activeElement, exitLink, 'previous wraps');
hud.menu('next'); assert.equal(document.activeElement, button, 'next wraps');
restart.cssHidden = false;
hud.menu('next'); assert.equal(document.activeElement, restart, 'newly visible pause controls participate');
assert.equal(hud.menu('activate'), true);
assert.equal(restart.clicks, 1, 'activation invokes the native control once');
summary.focus(); // Keyboard/pointer focus is authoritative, not a private index.
hud.menu('next'); assert.equal(document.activeElement, exitLink);
hud.menu('activate'); assert.equal(exitLink.clicks, 1, 'native link activation is preserved');
curtain.focus(); hud.menu('activate');
assert.equal(button.clicks, 2, 'missing focus falls back to the primary action');
button.disabled = true; curtain.focus();
assert.equal(hud.menu('activate'), false, 'disabled primary never activates a different target');
button.disabled = false;
button.cssHidden = true;
assert.equal(hud.menu('activate'), false, 'a loading-hidden primary is not activated');
button.cssHidden = false;
assert.equal(hud.menu('unknown'), false);
const populatedTargets = curtain.targets;
curtain.targets = []; curtain.focus();
for (const action of ['next', 'previous', 'activate']) {
  assert.equal(hud.menu(action), false, 'an empty menu leaves no focus or activation destination');
}
assert.equal(document.activeElement, curtain);
curtain.targets = populatedTargets;

// An expanded guide must remain readable on short viewports. Directional
// input scrolls its complete content, then returns to native focus traversal.
menuScroller.clientHeight = 300; menuScroller.scrollHeight = 1000; menuScroller.scrollTop = 0;
menuScroller.bounds = () => ({ top: 0, bottom: 300 });
summary.bounds = () => ({ top: 200 - menuScroller.scrollTop, bottom: 240 - menuScroller.scrollTop });
guide.bounds = () => ({ top: 200 - menuScroller.scrollTop, bottom: 1000 - menuScroller.scrollTop });
summary.onClick = () => { guide.open = !guide.open; };
summary.onScroll = options => {
  if (options.block === 'start') menuScroller.scrollTop = 200;
  else if (menuScroller.scrollTop > 200) menuScroller.scrollTop = 200;
};
guide.open = false; summary.focus();
hud.menu('activate');
assert.equal(summary.clicks, 1, 'the native summary toggles exactly once');
assert.equal(guide.open, true);
assert.equal(document.activeElement, summary, 'opening help keeps its native close control focused');
assert.equal(menuScroller.scrollTop, 200, 'opening help reveals its first instructions');
for (const expected of [425, 650, 700]) {
  assert.equal(hud.menu('next'), true);
  assert.equal(menuScroller.scrollTop, expected, 'help scroll advances in bounded overlapping pages');
  assert.equal(document.activeElement, summary, 'scrolling does not abandon help');
}
assert.equal(menuScroller.scrollTop + menuScroller.clientHeight, 1000, 'the final mappings are reachable');
hud.menu('next'); assert.equal(document.activeElement, exitLink, 'next at the bottom resumes focus traversal');
summary.focus();
for (const expected of [475, 250, 200]) {
  hud.menu('previous'); assert.equal(menuScroller.scrollTop, expected);
  assert.equal(document.activeElement, summary);
}
hud.menu('previous'); assert.equal(document.activeElement, restart, 'previous at the help start returns to earlier controls');
summary.focus(); menuScroller.scrollTop = 700;
assert.equal(hud.menu('back'), true);
assert.equal(guide.open, false, 'Back closes help before returning control to the game');
assert.equal(document.activeElement, summary);
assert.equal(menuScroller.scrollTop, 200, 'Back reveals the collapsed control');
assert.equal(hud.menu('back'), false, 'a second Back can resume through the caller');

// Device handoffs clear only the controller styling, retaining native focus.
hud.setInputDevice('keyboard');
assert.equal(summary.dataset.controllerFocus, undefined);
assert.equal(document.activeElement, summary);
hud.menu('next');
hud.setInputDevice('keyboard');
assert.equal(exitLink.dataset.controllerFocus, undefined, 'same-device notification still clears a later controller mark');
hud.menu('previous');
curtain.listeners.pointerdown({});
assert.equal(summary.dataset.controllerFocus, undefined, 'pointer use clears the explicit ring');
assert.equal(document.activeElement, summary);
hud.menu('next');
curtain.listeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() {}, stopPropagation() {} });
assert.equal(exitLink.dataset.controllerFocus, undefined, 'Tab clears the explicit controller ring');
assert.equal(document.activeElement, button);
button.focus();
curtain.listeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() {}, stopPropagation() {} });
assert.equal(document.activeElement, restart, 'keyboard focus shares the visible enabled targets');
restart.focus();
curtain.listeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() {}, stopPropagation() {} });
assert.equal(document.activeElement, summary, 'Tab also skips disabled controls');

// A mode change and navigation can happen before the same frame's HUD draw.
g.mode = 'playing'; hud.update(g, .1);
assert.equal(hud.menu('activate'), false, 'menus never activate while riding');
g.mode = 'paused';
assert.equal(hud.menu('next'), true);
const selected = document.activeElement;
hud.update(g, .1);
assert.equal(document.activeElement, selected, 'first paused update preserves same-frame navigation');
assert.equal(selected.dataset.controllerFocus, 'true');
const pausedQueries = targetQueries;
for (let i = 0; i < 20; i++) hud.update(g, .1);
assert.equal(targetQueries, pausedQueries, 'idle menus never enumerate focus targets');
g.mode = 'playing'; hud.update(g, .1);
assert.equal(selected.dataset.controllerFocus, undefined, 'resuming clears controller styling');
assert.equal(document.activeElement, null, 'resuming clears native menu focus');
curtain.targets = [button, summary, exitLink];
const beforeStill = writes;
for (let i=0; i<9;i++) hud.update(g,.09);
assert.equal(writes, beforeStill, 'stable visible values do not write text, visibility, styling or datasets');
console.log('HUD checks passed: state transitions, charge, flow, live butters, banners, device prompts, accessibility, safe area, controls disclosure, keyboard/controller focus, bounded help scrolling, and idle DOM writes.');
