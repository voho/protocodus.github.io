// Run with: node tests/hud-check.mjs
// DOM stand-ins cover HUD state and input gating; appearance needs browser QA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createHud } from '../js/hud.js';
import { RIDER, SCORE, PROPS, SOFT } from '../js/config.js';
import { butterName, Rider, trickName, CLEAN, SKETCHY, BAIL } from '../js/rider.js';
import { comboFor, scoreTrick, repeatShare, firstGrabShare, flowFromPoints, feedFlow, stepFlowMeter, GRAB_DISCOVERY_BONUS } from '../js/flow.js';
import { createChaseCamera } from '../js/camera.js';
import { heightAt, guideAt, getTerrainMaterialAt, nearestCenter, corridorHalfAt,
  beyondLipAt, chapterNameAt, gateSlotsIn } from '../js/terrain.js';
import { getWorldSeed, setWorldSeed } from '../js/noise.js';
import { createWeather } from '../js/weather.js';
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
// Menu-local listeners run before the window input handler. Browser chords
// must preserve focus, help and controller styling here too, including when
// Shift accompanies the command modifier; ordinary Shift+Tab is checked above.
guide.open = true;
for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
  for (const shiftKey of [false, true]) {
    for (const node of [curtain, guide, exitLink]) {
      for (const key of ['Tab', 'Escape', 'Enter']) {
        let prevented = false, stopped = false;
        const before = writes, queries = targetQueries;
        node.listeners.keydown({ key, [modifier]: true, shiftKey,
          preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
        assert.equal(prevented, false, 'modified menu keys retain browser defaults');
        assert.equal(stopped, false, 'modified menu keys can reach browser handling');
        assert.equal(document.activeElement, button, 'a browser chord does not move menu focus');
        assert.equal(guide.open, true, 'modified Escape does not close help');
        assert.equal(button.dataset.controllerFocus, 'true', 'a browser chord preserves controller styling');
        assert.equal(writes, before, 'a browser chord does not rewrite the HUD');
        assert.equal(targetQueries, queries, 'a browser chord never enumerates menu targets');
      }
    }
  }
}
guide.open = false;
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
// Exercise main's real award/fall/encounter callbacks with physics and this
// HUD. A crash must explain itself now, even when a landing/gate/flow payout
// filled the ordinary award queue one step earlier.
const mainSource = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
// Execute the real frame's HUD invocation, so the delayed explanation also
// proves that main forwards audio status without adding playback operations.
{
  const invocation = mainSource.match(/^\s*hud\.update\(game, dt[^\n]*$/m)?.[0];
  assert.ok(invocation, 'locate the production HUD update');
  const frame = new vm.Script(invocation);
  let pending = false;
  const context = vm.createContext({ hud, game: g, dt: 0,
    audio: { get needsGesture() { return pending; } },
  });
  const update = dt => { context.dt = dt; frame.runInContext(context); };
  update(0);
  assert.equal(f['audio-unlock'].hidden, true);
  pending = true;
  update(0.7);
  assert.equal(f['audio-unlock'].hidden, true, 'ordinary resume latency gets a grace period');
  update(0.05);
  assert.equal(f['audio-unlock'].hidden, false, 'an unresolved wait gets a quiet actionable hint');
  const waitingWrites = writes;
  for (let i = 0; i < 20; i++) update(0.05);
  assert.equal(writes, waitingWrites, 'a steady unlock hint rewrites no DOM');
  pending = false; update(0);
  assert.equal(f['audio-unlock'].hidden, true, 'mute or successful unlock clears without waiting for a draw');
  pending = true; update(0.7);
  assert.equal(f['audio-unlock'].hidden, true, 'a new wait starts a fresh grace period');
  update(0.05);
  assert.equal(f['audio-unlock'].hidden, false);
  g.mode = 'paused'; update(0);
  assert.equal(f['audio-unlock'].hidden, true, 'pause immediately clears the hint');
  update(2);
  g.mode = 'attract'; update(2);
  assert.equal(f['audio-unlock'].hidden, true, 'menus never accumulate an unlock invitation');
  g.mode = 'playing'; update(0.7);
  assert.equal(f['audio-unlock'].hidden, true, 'resuming starts the grace from zero');
  update(0.05);
  assert.equal(f['audio-unlock'].hidden, false);
  hud.update(g, 0);
  assert.equal(f['audio-unlock'].hidden, true, 'callers without optional audio status remain quiet');
  const clearedWrites = writes;
  for (let i = 0; i < 10; i++) hud.update(g, 0);
  assert.equal(writes, clearedWrites, 'a cleared hint is also idle');
}
function mainSection(from, to) {
  const start = mainSource.indexOf(from), end = mainSource.indexOf(to, start);
  assert(start >= 0 && end > start, 'locate production feedback handler: ' + from);
  return mainSource.slice(start, end);
}
const feedbackHandlers = new vm.Script(
  mainSection('function award(', "\nrider.on('launch',")
  + mainSection('function syncCombo()', '\nfunction stepFlow(')
  + mainSection("rider.on('fall',", "\nrider.on('impact',")
  + mainSection('function nearMiss(', '\n/* Threading a gate.')
  + mainSection('const onWildlifeNear =', '\nconst onCocoa =')
  + mainSection('const liveTrickQuery =', '\n/* The per-frame callbacks,')
  + '\nglobalThis.onNear = onWildlifeNear;',
);
const neutral = { turn: 0, tuck: false, brake: false, jump: false, trickGrab: false, trickFlip: false };
function feedbackFixture(record = 0) {
  const rider = new Rider(THREE, { height: () => 0, canStall: () => false });
  rider.pos.z = -100; rider.vel.set(0, 0, -20);
  const game = { ...g, rider, mode: 'playing', score: 0, best: record, bestAtStart: record,
    liveTrick: '', flow: .5, flowHold: 3, combo: comboFor(.5), gateRun: 0,
    recentTricks: [], discoveredGrabs: new Set(), pendingMilestones: [] };
  const sounds = [], pulses = [];
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, .1, 2000);
  const context = vm.createContext({ rider, camera, game, RIDER, SCORE, comboFor, hud,
    CLEAN, SKETCHY, BAIL, trickName, butterName, TAU: Math.PI * 2,
    scoreTrick, repeatShare, firstGrabShare, flowFromPoints, feedFlow, GRAB_DISCOVERY_BONUS,
    rearmProps: false, bestDirty: false, persistBest() {},
    audio: new Proxy({}, { get: (_, name) => (...args) => sounds.push({ name, args }) }),
    input: { rumble: (...args) => pulses.push(args) },
    chase: { kick() {}, land() {} }, retro: { crash() {} }, spray: { burst() {}, radialBurst() {} },
  });
  feedbackHandlers.runInContext(context);
  hud.resetScore(); hud.update(game, .1);
  return { rider, camera, game, sounds, pulses, context, award: context.award, near: context.onNear,
    update(dt) { game.liveTrick = context.liveTrickName(); hud.update(game, dt); } };
}
// Short, incomplete attempts still need their landing reason even when they
// earn no trick payout. Drive the actual jump and landing rather than handing
// a fabricated summary to the score callback.
{
  const seed = getWorldSeed(), dt = 1 / 120;
  const ledger = game => ({ score: game.score, best: game.best, flow: game.flow,
    hold: game.flowHold, combo: game.combo, recent: [...game.recentTricks],
    grabs: [...game.discoveredGrabs] });
  const hop = (ticks, control, terrain = false) => {
    const fixture = feedbackFixture(1000), { rider, game, update } = fixture;
    if (terrain) {
      rider.world = { height: heightAt, surfaceAt: getTerrainMaterialAt, canStall: () => false };
      const z = ticks ? -250 : 0;
      rider.reset(z, guideAt(z));
    }
    rider.vel.set(0, 0, -1).projectOnPlane(rider.normal).setLength(ticks ? 20 : 8);
    game.score = 125; game.recentTricks.push('BACKFLIP'); game.discoveredGrabs.add(2);
    const before = ledger(game);
    let landing;
    rider.on('land', value => { landing = value; });
    const step = input => { rider.step(dt, input); update(dt); };
    if (ticks) {
      for (let i = 0; i < ticks; i++) step({ ...neutral, jump: true });
      step(neutral);
    } else {
      for (let i = 0; i < 1200 && rider.grounded; i++) step(neutral);
    }
    assert.equal(rider.state, 'air', 'the ordinary charge or terrain roller leaves the snow');
    for (let i = 0; i < 240 && !landing; i++) step({ ...neutral, ...control });
    assert(landing, 'the real flight reaches touchdown');
    update(.1); // Include the next ordinary 12 Hz HUD draw.
    return { ...fixture, landing, before };
  };
  try {
    setWorldSeed('alpen-check');
    for (const [ticks, control, terrain, reason, named] of [
      [12, { turn: 1 }, true, 'OVER-ROTATED', false],
      [8, { trickGrab: true }, false, 'GRAB HELD', true],
    ]) {
      const { game, landing, sounds, before } = hop(ticks, control, terrain);
      assert.equal(landing.judged, true); assert.equal(landing.verdict, SKETCHY);
      assert.equal(landing.reason, reason);
      assert.equal(!!trickName(landing, SKETCHY), named);
      assert(scoreTrick(landing).points < SCORE.minTrickScore);
      assert.equal(f.event.hidden, false, 'an unpaid sketchy landing still explains its penalty');
      assert.equal(f['event-name'].textContent, 'SKETCHY LANDING');
      assert.equal(f['event-kicker'].textContent, reason);
      assert.equal(f.event.dataset.tone, 'warn');
      assert.equal(f['event-points'].hidden, true);
      assert.equal(root.nodes['[data-callout]'].textContent, `SKETCHY LANDING, ${reason}`);
      assert.deepEqual(sounds.map(s => s.name), ['thud', 'land'], 'one warning supplements the ordinary impact');
      assert.deepEqual(ledger(game), before, 'feedback does not bank points, feed flow, or record a trick');
    }
    for (const [ticks, control, terrain, judged] of [
      [12, {}, true, true], [0, {}, true, false], [1, { trickGrab: true }, false, false],
    ]) {
      const { game, landing, sounds, before } = hop(ticks, control, terrain);
      assert.equal(landing.judged, judged); assert.equal(landing.verdict, CLEAN);
      assert.equal(f.event.hidden, true, 'clean hops and unjudged rollers keep the band quiet');
      assert.equal(root.nodes['[data-callout]'].textContent, '');
      assert.deepEqual(sounds.map(s => s.name), ['land']);
      assert.deepEqual(ledger(game), before);
    }
    const { game, landing, sounds, before } = hop(12, { trickGrab: true });
    const earned = scoreTrick(landing).points;
    assert(earned >= SCORE.minTrickScore);
    assert.equal(game.score, before.score + earned * before.combo);
    assert(game.flow > before.flow, 'the paid named trick still feeds flow');
    assert.deepEqual(game.recentTricks, ['BACKFLIP', 'INDY']);
    assert.equal(f['event-name'].textContent, 'INDY (SKETCHY)');
    assert.match(f['event-kicker'].textContent, /^GRAB HELD/);
    assert.equal(f['event-points'].hidden, false);
    assert.equal(sounds.filter(s => s.name === 'thud').length, 1, 'a paid sketchy trick gets no duplicate warning');
    assert.equal(sounds.filter(s => s.name === 'land').length, 1);
  } finally { setWorldSeed(seed); }
}

// A real failed flip near 1,000 m earns distance while the body tumbles.
// Keep its crossing-time points, but let the crash explain itself before the
// celebration. These are actual main handlers and the real HUD; this CPU
// route includes seeded terrain/weather/gates, not streamed obstacle meshes.
const milestoneFrame = new vm.Script(mainSection(
  '    wildlife.update(dt, rider, onWildlifeNear);', '\n    huts.update',
).replace('    wildlife.update(dt, rider, onWildlifeNear);', ''));
const milestoneHandlers = new vm.Script([
  mainSection("rider.on('launch',", "\nrider.on('fall',"),
  mainSection('function stepFlow()', '\n/* Near miss encounters'),
  mainSection('function checkGates()', '\n/* ==========================================================================\n   Collisions'),
  mainSection('function cancelJump() {', '\nconst input = createInput'),
  mainSection('function begin()', '\nlet lastPassedGate'),
  mainSection('function restart(fullReset', '\nfunction newMountain('),
].join('\n'));
function milestoneFixture() {
  const fixture = feedbackFixture(), { rider, game, context } = fixture;
  Object.assign(game, { flow: 0, flowHold: 0, combo: 1, maxSpeedAnnounced: 0,
    maxDistanceAnnounced: 0, chapter: chapterNameAt(rider.pos.z) });
  const noop = () => {}, resettable = { reset: noop, clear: noop };
  Object.assign(context, { world: rider.world, STEP: 1 / 120, stepFlowMeter,
    prev: rider.pos.clone(), dt: 1 / 60, chapterCheck: 0, lastPassedGate: null,
    guideAt, nearestCenter, corridorHalfAt, chapterNameAt, readBest: () => game.best,
    curtainPointers: new Map(), curtain: { dataset: {}, classList: { add: noop, remove: noop } },
    curtainClickReady: false, curtainClickDevice: null, pausedRendered: false, pausedWorldReady: false,
    bootReady: true, contextLost: false, runStarted: true, controllerNotice: { hidden: true },
    showMuted: noop, trackRunStart: noop, hadStep: false,
    props: { ...resettable, gates: [], reopenGatesBelow: noop }, terrain: resettable,
    trail: resettable, wildlife: resettable, huts: resettable, mountainLife: resettable,
    model: resettable, shading: resettable,
  });
  context.input.calm = noop; context.chase.reset = noop; context.spray.clear = noop;
  context.retro.fade = context.retro.clearCrash = noop;
  milestoneHandlers.runInContext(context);
  fixture.frame = (dt = 1 / 60) => {
    context.dt = dt; milestoneFrame.runInContext(context); fixture.update(dt);
  };
  return fixture;
}
function guidedCrashFixture(chargeBelow, gateEnd) {
  setWorldSeed('ALPEN01');
  const fixture = milestoneFixture(), { rider, game, context } = fixture;
  const world = { height: heightAt, surfaceAt: getTerrainMaterialAt,
    canStall: (x, z) => Math.abs(x - nearestCenter(x, z)) > corridorHalfAt(z),
    beyond: beyondLipAt, grip: 1, surfaceDrag: 1 };
  rider.world = context.world = world; rider.reset(0, guideAt(0));
  const weather = createWeather(THREE); game.weather = weather.state;
  game.chapter = chapterNameAt(0);
  context.props.gates = gateSlotsIn(gateEnd, 0).map(gate => ({ ...gate, half: PROPS.gateHalf, taken: false }));
  let frame = 0, turn = 0, chargeAt = -1, fallAt = -1, crossingPoints = 0;
  rider.on('fall', () => { fallAt = frame / 60; });
  const step = () => {
    if (chargeAt < 0 && rider.pos.z < chargeBelow && rider.grounded) chargeAt = frame;
    const error = guideAt(rider.pos.z - 26) - rider.pos.x;
    const want = Math.atan2(error, 30) - Math.atan2(rider.vel.x, -rider.vel.z);
    turn += (Math.max(-1, Math.min(1, want * 2.4)) - turn) / 12;
    const control = { ...neutral, turn: rider.state === 'ride' ? turn : 0, turnIntent: turn,
      jump: chargeAt >= 0 && frame - chargeAt < 24,
      trickFlip: chargeAt >= 0 && frame - chargeAt >= 24 };
    for (let i = 0; i < 2; i++) {
      context.prev.copy(rider.pos); rider.step(1 / 120, control);
      context.checkGates(); context.stepFlow();
    }
    const w = weather.update(1 / 60);
    world.grip = 1 - w.storm * (1 - RIDER.stormGrip);
    world.surfaceDrag = 1 + w.storm * (RIDER.stormFriction - 1);
    world.windX = w.windX; world.windZ = w.windZ;
    const before = game.score, flag = game.maxDistanceAnnounced;
    fixture.frame();
    if (!flag && game.maxDistanceAnnounced) crossingPoints = game.score - before;
    frame++;
  };
  return { ...fixture, step, age: () => frame / 60 - fallAt, crossingPoints: () => crossingPoints };
}
function rideToTumblingMilestone() {
  const fixture = guidedCrashFixture(-970, -1500), { rider, game, step } = fixture;
  for (let i = 0; i < 3600 && !game.maxDistanceAnnounced; i++) step();
  assert.equal(rider.state, 'fall'); assert.equal(rider.fallReason, 'UPSIDE DOWN');
  assert(rider.pos.z < -1000 && fixture.age() < .3);
  assert.equal(fixture.crossingPoints(), 500, 'crossing pays the actual ×2 multiplier immediately');
  return fixture;
}
{
  const seed = getWorldSeed();
  try {
    const run = rideToTumblingMilestone(), { game, rider, sounds, pulses, context } = run;
    const celebrations = () => sounds.filter(s => s.name === 'descentMilestone');
    assert.equal(celebrations().length, 0, 'the tumble banks distance without playing its celebration');
    assert.equal(pulses.filter(p => p[2] === 250).length, 0, 'the milestone cannot preempt the crash pulse');
    assert.equal(f.event.hidden, false);
    assert.equal(f['event-name'].textContent, 'WIPEOUT');
    assert.equal(f['event-kicker'].textContent, 'UPSIDE DOWN');
    assert.equal(game.pendingMilestones.length, 1);
    const banked = game.score, record = game.best;
    context.pause(); run.frame(2);
    assert.equal(game.pendingMilestones.length, 1, 'pause retains the earned notice');
    assert.equal(celebrations().length, 0);
    context.begin(); run.frame(0);
    let sawRise = false;
    for (let i = 0; i < 720 && rider.state !== 'ride'; i++) {
      run.step(); sawRise ||= rider.state === 'rise';
      if (run.age() < 2.1) {
        assert.equal(f.event.hidden, false, 'the crash hold remains visible');
        assert.equal(f['event-name'].textContent, 'WIPEOUT', 'the normal crash hold is retained');
      }
      if (rider.state !== 'ride') {
        assert.equal(celebrations().length, 0, 'both tumble and getting up remain free of milestone cues');
        assert.equal(pulses.filter(p => p[2] === 250).length, 0);
      }
    }
    assert(sawRise); assert.equal(rider.state, 'ride'); assert.equal(game.combo, 1);
    assert.deepEqual(celebrations().map(s => s.args), [[1000]]);
    assert.equal(f['event-name'].textContent, '1,000M DESCENT!');
    assert.equal(f['event-points'].textContent, '+500', 'recovery displays the captured points, not the current ×1 payout');
    assert.equal(game.score, banked); assert.equal(game.best, record);
    assert.equal(game.pendingMilestones.length, 0);
    for (let i = 0; i < 30; i++) run.frame(1 / 60);
    assert.equal(celebrations().length, 1); assert.equal(game.score, banked, 'presentation cannot pay again');
    assert.equal(sounds.filter(s => s.name === 'speedClub').length, 1, 'the earlier ordinary speed award remains immediate');

    const restarted = rideToTumblingMilestone();
    restarted.context.restart(); restarted.frame();
    assert.equal(restarted.rider.state, 'ride'); assert(restarted.rider.pos.z > -1000);
    assert.equal(restarted.game.score, 0); assert.equal(restarted.game.maxDistanceAnnounced, 0);
    assert.equal(restarted.game.pendingMilestones.length, 0, 'checkpoint restart discards the old run\'s queued notice');
    assert.equal(restarted.sounds.filter(s => s.name === 'descentMilestone').length, 0);
    // A checkpoint already below both thresholds seeds them as old news.
    restarted.context.lastPassedGate = { x: 0, z: -5003 };
    restarted.context.restart(); restarted.frame();
    assert.equal(restarted.game.maxDistanceAnnounced, 5000);
    assert.equal(restarted.game.score, 0);
    assert.equal(restarted.sounds.filter(s => s.name === 'descentMilestone').length, 0);
  } finally { setWorldSeed(seed); }
}
for (const [level, airborne] of [[1000, false], [5000, true]]) {
  const run = milestoneFixture(), { rider, game, sounds, pulses } = run;
  rider.reset(-level + 2, 0); rider.vel.set(0, 0, -20);
  game.maxDistanceAnnounced = level === 5000 ? 1000 : 0;
  if (airborne) {
    for (let i = 0; i < 2; i++) rider.step(1 / 120, { ...neutral, jump: true });
    rider.step(1 / 120, neutral);
  }
  for (let i = 0; i < 60 && !sounds.some(s => s.name === 'descentMilestone'); i++) {
    rider.step(1 / 120, neutral); run.frame(1 / 120);
  }
  assert.equal(rider.state, airborne ? 'air' : 'ride');
  assert.deepEqual(sounds.filter(s => s.name === 'descentMilestone').map(s => s.args), [[level]]);
  assert.equal(pulses.filter(p => p[2] === (level === 1000 ? 250 : 350)).length, 1);
  assert.equal(game.score, level === 1000 ? 250 : 500);
  assert.equal(game.pendingMilestones.length, 0, 'ordinary controlled crossings celebrate immediately');
}
{
  // Controlled mature approach on flat ground. The real swept hard-circle
  // collision and body physics carry the rider back above 1,000 m before
  // recovery; no state/position/velocity is assigned after the initial setup.
  const run = milestoneFixture(), { rider, game, context, sounds } = run;
  rider.reset(-999.8, 0); rider.vel.set(0, 0, -50); rider.grace = 0;
  const solid = { x: 0, z: -1001.8, r: .7, top: 99, volume: true, kind: 0 };
  Object.assign(context, { PROPS, SOFT });
  context.props.querySolids = (lo, hi, out) => { out.length = 0; out.push(solid); };
  context.huts = { solids: [] };
  new vm.Script(mainSection('const sweepHit =', '\nconst demoControl =')).runInContext(context);
  let crossed = false, banked = 0, recovered = false;
  for (let tick = 0; tick < 600; tick++) {
    context.prev.copy(rider.pos); rider.step(1 / 120, neutral); context.collide();
    if (tick % 2 === 0) continue;
    run.frame();
    if (!crossed && game.maxDistanceAnnounced) {
      crossed = true; banked = game.score;
      assert.equal(rider.state, 'fall'); assert(rider.pos.z < -1000);
      assert.equal(sounds.filter(s => s.name === 'descentMilestone').length, 0);
    }
    if (crossed && rider.state === 'ride') {
      recovered = true; assert(rider.pos.z > -1000, 'the actual rebound recovered uphill of the crossing');
      assert.deepEqual(sounds.filter(s => s.name === 'descentMilestone').map(s => s.args), [[1000]],
        'an earned notice stays eligible even after rebounding above its threshold');
      assert.equal(game.score, banked); break;
    }
  }
  assert(crossed && recovered);
  assert.equal(game.pendingMilestones.length, 0);
  for (let i = 0; i < 240 && rider.pos.z > -1000; i++) { rider.step(1 / 120, neutral); run.frame(1 / 120); }
  assert(rider.pos.z <= -1000);
  assert.equal(sounds.filter(s => s.name === 'descentMilestone').length, 1);
  assert.equal(game.score, banked, 'recrossing after a rebound cannot pay twice');
}
// A later failed flip crosses a real terrain chapter while tumbling. The
// location is still news after recovery, but cannot shorten the crash reason
// or spend its own hold while the player has no control.
{
  const seed = getWorldSeed();
  const observeChapters = run => {
    const notices = [];
    run.context.hud = { ...hud, banner(...args) {
      if (args[3]?.kicker === 'Entering') notices.push({ name: args[0], state: run.rider.state });
      hud.banner(...args);
    } };
    return notices;
  };
  const crossWhileFalling = () => {
    const run = guidedCrashFixture(-1550, -2200), notices = observeChapters(run);
    const previousChapter = run.game.chapter;
    for (let i = 0; i < 4800 && run.rider.pos.z > -1590; i++) run.step();
    assert.equal(run.rider.state, 'fall'); assert.equal(run.rider.fallReason, 'UPSIDE DOWN');
    assert(run.age() > .3 && run.age() < 1, 'the real chapter crossing occurs during the crash hold');
    assert.notEqual(chapterNameAt(run.rider.pos.z), previousChapter);
    return { ...run, notices, previousChapter };
  };
  try {
    const run = crossWhileFalling(), { rider, game, context, notices, previousChapter } = run;
    const banked = game.score, record = game.best;
    assert.equal(f.event.hidden, false); assert.equal(f['event-name'].textContent, 'WIPEOUT');
    context.pause(); run.frame(2);
    assert.equal(notices.length, 0, 'pause cannot announce the chapter crossed during the fall');
    assert.equal(game.chapter, previousChapter);
    context.begin(); run.frame(0);
    let sawRise = false, lastWipeoutAge = 0, announcedDuringRecovery = false, changedDuringRecovery = false;
    for (let i = 0; i < 720 && rider.state !== 'ride'; i++) {
      run.step(); sawRise ||= rider.state === 'rise';
      if (!f.event.hidden && f['event-name'].textContent === 'WIPEOUT') lastWipeoutAge = run.age();
      if (run.age() < 2.18) {
        assert.equal(f.event.hidden, false, 'the chapter cannot hide the crash reason before its full hold');
        assert.equal(f['event-name'].textContent, 'WIPEOUT', 'the chapter cannot replace the crash reason early');
        assert.equal(f['event-kicker'].textContent, 'UPSIDE DOWN');
      }
      if (rider.state !== 'ride') {
        announcedDuringRecovery ||= notices.length > 0;
        changedDuringRecovery ||= game.chapter !== previousChapter;
      }
    }
    assert(sawRise); assert.equal(rider.state, 'ride');
    assert.equal(announcedDuringRecovery, false, 'fall and rise do not consume an entering notice');
    assert.equal(changedDuringRecovery, false, 'the last announced chapter stays unchanged during recovery');
    assert(lastWipeoutAge >= 2.18, 'WIPEOUT retains its authored 2.2-second hold');
    const current = chapterNameAt(rider.pos.z);
    assert.deepEqual(notices, [{ name: current.toUpperCase(), state: 'ride' }]);
    assert.equal(game.chapter, current, 'recovery announces the rider\'s current chapter');
    assert.equal(f.event.hidden, false); assert.equal(f['event-name'].textContent, current.toUpperCase());
    assert.equal(f['event-kicker'].textContent, 'Entering'); assert.equal(f['event-points'].hidden, true);
    assert.equal(game.score, banked); assert.equal(game.best, record, 'chapter timing does not change banked rewards');
    for (let i = 0; i < 138; i++) run.frame();
    assert.equal(f.event.hidden, false, 'the chapter retains its own 2.4-second hold after recovery');
    for (let i = 0; i < 12; i++) run.frame();
    assert.equal(f.event.hidden, true); assert.equal(notices.length, 1, 'ordinary repeated checks do not replay the notice');

    const restarted = crossWhileFalling();
    restarted.context.restart(); restarted.frame();
    assert.equal(restarted.rider.state, 'ride'); assert(restarted.rider.pos.z > -1590);
    assert.equal(restarted.game.chapter, chapterNameAt(restarted.rider.pos.z));
    assert.equal(restarted.notices.length, 0, 'checkpoint restart discards the interrupted chapter crossing');
    restarted.context.lastPassedGate = { x: guideAt(-1605), z: -1605 };
    restarted.context.restart(); restarted.frame();
    assert.equal(restarted.game.chapter, chapterNameAt(-1605));
    assert.equal(restarted.notices.length, 0, 'a checkpoint inside the next chapter seeds it without a stale notice');
    assert.equal(f.event.hidden, true);

    // Unlike earned distance, entering an area is no longer news if the
    // actual collision carries the rider back out before control returns.
    const rebound = milestoneFixture();
    rebound.rider.reset(-1589.8, 0); rebound.rider.vel.set(0, 0, -50); rebound.rider.grace = 0;
    rebound.game.chapter = chapterNameAt(rebound.rider.pos.z);
    rebound.game.maxDistanceAnnounced = 1000; rebound.game.maxSpeedAnnounced = 100;
    const reboundNotices = observeChapters(rebound), initialChapter = rebound.game.chapter;
    const solid = { x: 0, z: -1591.8, r: .7, top: 99, volume: true, kind: 0 };
    Object.assign(rebound.context, { PROPS, SOFT });
    rebound.context.props.querySolids = (lo, hi, out) => { out.length = 0; out.push(solid); };
    rebound.context.huts = { solids: [] };
    new vm.Script(mainSection('const sweepHit =', '\nconst demoControl =')).runInContext(rebound.context);
    let crossed = false, recovered = false;
    for (let tick = 0; tick < 600; tick++) {
      rebound.context.prev.copy(rebound.rider.pos);
      rebound.rider.step(1 / 120, neutral); rebound.context.collide();
      if (tick % 2 === 0) continue;
      rebound.frame();
      if (chapterNameAt(rebound.rider.pos.z) !== initialChapter) {
        crossed = true; assert.equal(rebound.rider.state, 'fall');
      }
      if (crossed && rebound.rider.state === 'ride') { recovered = true; break; }
    }
    assert(crossed && recovered, 'the real swept collision crosses the chapter and recovers');
    assert(rebound.rider.pos.z > -1590, 'the real rebound returns to the earlier chapter');
    assert.equal(rebound.game.chapter, initialChapter);
    assert.equal(reboundNotices.length, 0, 'recovery does not replay an area already left behind');

    for (const airborne of [false, true]) {
      const controlled = milestoneFixture(), { rider, game, context } = controlled;
      rider.world = context.world = { height: heightAt, surfaceAt: getTerrainMaterialAt, canStall: () => false };
      const start = airborne ? -1580 : -1589;
      rider.reset(start, guideAt(start)); rider.vel.set(0, 0, -20).projectOnPlane(rider.normal).setLength(20);
      game.chapter = chapterNameAt(start); game.maxDistanceAnnounced = 1000;
      const entries = observeChapters(controlled);
      if (airborne) {
        for (let i = 0; i < 48; i++) rider.step(1 / 120, { ...neutral, jump: true });
        rider.step(1 / 120, neutral);
        assert.equal(rider.state, 'air', 'the controlled chapter case uses a real charged jump');
      }
      let checks = 0;
      context.chapterNameAt = z => { checks++; return chapterNameAt(z); };
      for (let i = 0; i < 120 && !entries.length; i++) {
        rider.step(1 / 120, neutral); controlled.frame(1 / 120);
      }
      assert.equal(rider.state, airborne ? 'air' : 'ride');
      assert.equal(checks, 2, 'controlled chapter checks retain their half-second cadence');
      assert.deepEqual(entries, [{ name: chapterNameAt(rider.pos.z).toUpperCase(), state: rider.state }],
        'controlled ride and air announce their crossing immediately when the check is due');
      assert.equal(game.score, 0);
    }
  } finally { setWorldSeed(seed); }
}
// The actual award callback updates the record before the HUD sees it.
// The visible target changes only on a strict improvement, including the
// first score of a first-ever run, without replacing the award announcement.
for (const [record, points, expected] of [
  [0, 0, 'Best 0'], [0, 120, 'Personal best · 120'],
  [120, 120, 'Best 120'], [120, 121, 'Personal best · 121'],
]) {
  const { game, award } = feedbackFixture(record);
  if (points) award(points, 'GATE', 'near');
  hud.update(game, .1);
  assert.equal(game.best, Math.max(record, points));
  assert.equal(f.best.textContent, expected, 'record feedback distinguishes first score, tie and improvement');
  assert.equal(f.best.dataset.passed, String(points > record));
  assert.equal(root.nodes['[data-callout]'].textContent, points ? `GATE, plus ${points}` : '',
    'record feedback preserves the active scoring callout');
}
{
  const { rider, game, award } = feedbackFixture(120);
  rider.takeOff(4, rider.UP); rider.airTime = .5; hud.update(game, .1);
  award(121, 'GATE', 'near'); hud.update(game, .1);
  assert.equal(f.best.textContent, 'Personal best · 121');
  assert.match(f['event-kicker'].textContent, /GATE \+121/);
  assert.equal(root.nodes['[data-callout]'].textContent, 'GATE, plus 121',
    'a record cannot replace an airborne flash announcement');
}
{
  const { game, award } = feedbackFixture(120);
  award(121); // No active event: the record itself can be announced.
  hud.update(game, .1);
  assert.equal(root.nodes['[data-callout]'].textContent, 'New personal best.');
  // Settle the ordinary score interpolation and hint timeout, then verify
  // that a steady record neither re-announces nor writes to the DOM.
  for (let i = 0; i < 100; i++) hud.update(game, .1);
  const recordWrites = writes;
  for (let i = 0; i < 20; i++) hud.update(game, .1);
  assert.equal(writes, recordWrites, 'an idle personal best is announced once and causes no repeated DOM work');
  award(1); hud.update(game, .1);
  assert.equal(f.best.textContent, 'Personal best · 122', 'the new record remains current as the run continues');
  // The same reset used by restart restores the saved target and clears the
  // previous run's announcement; matching it again is still not a new best.
  game.bestAtStart = game.best; game.score = 0;
  hud.resetScore(); hud.update(game, .1);
  assert.equal(f.best.textContent, 'Best 122');
  assert.equal(f.best.dataset.passed, 'false');
  assert.equal(root.nodes['[data-callout]'].textContent, '');
  award(122); hud.update(game, .1);
  assert.equal(f.best.textContent, 'Best 122');
  assert.equal(root.nodes['[data-callout]'].textContent, '');
  award(1); hud.update(game, .1);
  assert.equal(f.best.textContent, 'Personal best · 123');
  assert.equal(root.nodes['[data-callout]'].textContent, 'New personal best.');
}

// Two pages share storage, but each attempt keeps the record it started with.
// Execute the actual load, save, pause and checkpoint paths: a copied storage
// helper would miss both the stale-tab overwrite and a restart that forgot to
// import the newly saved target. The stable boot boundary also runs pre-fix
// main.js, so the old-source proof fails on the lost record, not a missing API.
const recordHandlers = new vm.Script([
  mainSection('bootGameRef = game;', '\n// An interrupted charge'),
  mainSection('function cancelJump() {', '\nconst input = createInput'),
  mainSection('function pause() {', '\nlet lastPassedGate'),
  mainSection('function restart(fullReset', '\nfunction newMountain('),
  mainSection('let bestDirty = false;', '\nfunction scoreLanding('),
].join('\n'));
function recordFixture(storage, options = {}) {
  const world = { height: () => 0, canStall: () => false };
  const rider = new Rider(THREE, world);
  const game = { ...g, rider, mode: 'playing', score: 0, best: 0, bestAtStart: 0,
    recentTricks: [], discoveredGrabs: new Set(), pendingMilestones: [] };
  const io = { reads: 0, writes: 0 }, events = new Map();
  const faults = { read: !!options.readFailure, write: !!options.writeFailure };
  let now = options.now ?? 10000;
  const noop = () => {}, resettable = { reset: noop, clear: noop };
  const context = vm.createContext({
    game, rider, world, hud, bootGameRef: null, BEST_KEY: 'alpen.best',
    performance: { now: () => now },
    localStorage: {
      getItem(key) {
        io.reads++;
        if (faults.read) throw new Error('storage unavailable');
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        io.writes++;
        if (faults.write) throw new Error('storage full');
        storage.set(key, value);
      },
    },
    window: { addEventListener: (name, callback) => events.set(name, callback) },
    curtainPointers: new Set(), curtainClickReady: false, curtainClickDevice: null,
    pausedRendered: false, pausedWorldReady: false,
    curtain: { classList: { add: noop }, dataset: {} },
    retro: { fade: noop, clearCrash: noop }, audio: { quiet: noop }, input: { calm: noop },
    lastPassedGate: { x: 4, z: -153 }, hadStep: true, rearmProps: false, chapterCheck: 0,
    guideAt: () => 0, nearestCenter: () => 0, corridorHalfAt: () => 24, chapterNameAt: () => 'Piste',
    chase: resettable, spray: resettable, trail: resettable, wildlife: resettable,
    huts: resettable, mountainLife: resettable, model: resettable, shading: resettable,
    props: { ...resettable, reopenGatesBelow: noop }, terrain: resettable,
  });
  recordHandlers.runInContext(context);
  hud.resetScore(); hud.update(game, .1);
  return {
    game, rider, io, faults,
    time(value) { now = value; },
    award: context.award,
    persist: context.persistBest,
    pause: context.pause,
    pagehide() { events.get('pagehide')(); },
    restart(full = false) { context.restart(full); hud.update(game, .1); },
    draw() { hud.update(game, .1); },
  };
}
{
  const storage = new Map([['alpen.best', '100']]);
  const first = recordFixture(storage), stale = recordFixture(storage);
  first.award(1000); first.pause();
  assert.equal(storage.get('alpen.best'), '1000');
  // These writes are sequential. This deliberately makes no claim that a
  // read/max/write can be atomic across truly simultaneous browser processes.
  stale.award(300); stale.draw();
  assert.equal(storage.get('alpen.best'), '1000', 'a stale tab cannot replace an already saved higher record');
  assert.deepEqual([stale.game.score, stale.game.best, stale.game.bestAtStart], [300, 300, 100],
    'saving another tab\'s larger record does not import it into the active attempt');
  assert.equal(f.best.textContent, 'Personal best · 300', 'the HUD credits only this attempt\'s actual score');
  stale.restart();
  assert.equal(stale.rider.pos.z, -153, 'the real checkpoint restart still returns to the last gate');
  assert.deepEqual([stale.game.score, stale.game.best, stale.game.bestAtStart], [0, 1000, 1000]);
  assert.equal(f.best.textContent, 'Best 1,000', 'the next attempt imports the newer target');
  assert.equal(f.best.dataset.passed, 'false');
  stale.award(1000); stale.draw();
  assert.equal(f.best.textContent, 'Best 1,000', 'matching the imported record is still a tie');
  stale.award(1); stale.draw();
  assert.equal(f.best.textContent, 'Personal best · 1,001');
  stale.pause();
  assert.equal(storage.get('alpen.best'), '1001', 'a later genuine improvement can still replace the saved record');
  const reopened = recordFixture(storage);
  assert.deepEqual([reopened.game.best, reopened.game.bestAtStart], [1001, 1001], 'a new page reads the retained record');
}
{
  const storage = new Map([['alpen.best', '100']]);
  const run = recordFixture(storage);
  run.award(300);
  storage.set('alpen.best', '1000');
  run.restart(true);
  assert.equal(run.rider.pos.z, 0, 'the first full drop-in remains at the summit');
  assert.deepEqual([run.game.best, run.game.bestAtStart], [1000, 1000], 'full drop-in also imports the latest saved record');
  storage.set('alpen.best', '200');
  run.restart();
  assert.deepEqual([run.game.best, run.game.bestAtStart], [1000, 1000], 'a lower external record cannot lower the local target');
}
{
  const storage = new Map([['alpen.best', '100']]);
  const run = recordFixture(storage, { now: 1000 });
  assert.deepEqual(run.io, { reads: 1, writes: 0 });
  run.award(200);
  for (let i = 1; i <= 240; i++) {
    run.time(1000 + i * 10); run.award(1); run.draw();
  }
  assert.deepEqual(run.io, { reads: 1, writes: 0 }, 'frequent awards inside the save interval add no synchronous storage I/O');
  run.time(3999); run.award(1);
  assert.deepEqual(run.io, { reads: 1, writes: 0 });
  run.time(4000); run.award(1);
  assert.equal(storage.get('alpen.best'), '442', 'the next eligible award saves the latest score');
  assert.deepEqual(run.io, { reads: 2, writes: 1 }, 'merging adds only one read to an eligible write');
  for (let i = 0; i < 600; i++) { run.draw(); run.persist(); }
  assert.deepEqual(run.io, { reads: 2, writes: 1 }, 'idle frames and clean save attempts perform no storage I/O');
}
for (const flush of ['pause', 'pagehide']) {
  const storage = new Map([['alpen.best', '100']]);
  const run = recordFixture(storage, { now: 1000 });
  run.award(300);
  storage.set('alpen.best', '1000');
  run[flush]();
  assert.equal(storage.get('alpen.best'), '1000', flush + ' flush merges the higher saved record before the ordinary deadline');
  assert.deepEqual([run.game.best, run.game.bestAtStart], [300, 100], flush + ' preserves the active attempt\'s record');
  assert.deepEqual(run.io, { reads: 2, writes: 1 });
  run.persist(true); run.pagehide();
  assert.deepEqual(run.io, { reads: 2, writes: 1 }, 'a completed flush is not written again');
}
for (const saved of [null, '', 'not a score', 'NaN', 'Infinity', '-Infinity', '-25']) {
  const storage = new Map(saved === null ? [] : [['alpen.best', saved]]);
  const run = recordFixture(storage);
  assert.deepEqual([run.game.best, run.game.bestAtStart], [0, 0], 'missing or invalid saved values cannot poison the first target: ' + saved);
  run.award(120);
  assert.equal(storage.get('alpen.best'), '120', 'valid local progress can replace an invalid stored value');
  if (saved === null) storage.delete('alpen.best');
  else storage.set('alpen.best', saved);
  run.restart();
  assert.deepEqual([run.game.best, run.game.bestAtStart], [120, 120], 'an invalid external value cannot replace a local record at restart');
}
{
  const run = recordFixture(new Map([['alpen.best', '250.5']]));
  assert.deepEqual([run.game.best, run.game.bestAtStart], [250.5, 250.5], 'finite nonnegative records retain their existing numeric precision');
}
{
  const storage = new Map([['alpen.best', '100']]);
  const stale = recordFixture(storage);
  storage.set('alpen.best', '250.4');
  stale.award(200.6);
  assert.equal(storage.get('alpen.best'), '250.4', 'merging a stale tab must not round down a higher valid saved record');
  assert.deepEqual([stale.game.best, stale.game.bestAtStart], [200.6, 100], 'the saved fractional record stays separate from the active attempt');
}
{
  const storage = new Map([['alpen.best', '1000']]);
  const run = recordFixture(storage, { readFailure: true });
  assert.deepEqual([run.game.best, run.game.bestAtStart], [0, 0], 'restricted storage still allows an initial run');
  run.award(300); run.draw();
  assert.deepEqual([run.game.score, run.game.best], [300, 300], 'a failed read cannot interrupt local scoring');
  assert.equal(f.best.textContent, 'Personal best · 300');
  assert.deepEqual(run.io, { reads: 2, writes: 0 }, 'unknown saved progress must not be overwritten after a failed read');
  run.faults.read = false;
  run.time(10001); run.award(1); run.persist();
  assert.deepEqual(run.io, { reads: 2, writes: 0 }, 'failed saves retain the existing retry interval');
  run.pagehide();
  assert.equal(storage.get('alpen.best'), '1000', 'a later forced flush retries the pending record and preserves the previously unread best');
  assert.deepEqual(run.io, { reads: 3, writes: 1 });
  assert.deepEqual([run.game.best, run.game.bestAtStart], [301, 0]);
  run.faults.read = true; run.restart();
  assert.deepEqual([run.game.best, run.game.bestAtStart], [301, 301], 'a failed restart read retains the local record');
  run.faults.read = false; run.restart();
  assert.deepEqual([run.game.best, run.game.bestAtStart], [1000, 1000], 'a later restart can import the recovered saved target');
}
{
  const storage = new Map([['alpen.best', '100']]);
  const run = recordFixture(storage, { writeFailure: true });
  run.award(300); run.draw();
  assert.equal(storage.get('alpen.best'), '100');
  assert.equal(f.best.textContent, 'Personal best · 300', 'a failed disk write leaves local record feedback usable');
  assert.deepEqual(run.io, { reads: 2, writes: 1 });
  run.faults.write = false;
  run.time(10001); run.persist();
  assert.deepEqual(run.io, { reads: 2, writes: 1 }, 'a failed write does not create an unthrottled retry loop');
  run.pause();
  assert.equal(storage.get('alpen.best'), '300', 'pause retries a failed pending write without requiring another award');
  assert.deepEqual(run.io, { reads: 3, writes: 2 });
  run.pagehide();
  assert.deepEqual(run.io, { reads: 3, writes: 2 }, 'a successful retry clears the pending write');
}
{
  const { rider, game, award } = feedbackFixture();
  award(900, 'BACKSIDE 360', '', { kicker: '×3 · Lip' });
  award(360, 'GATE ×3', 'near');
  award(6000, 'MAX FLOW', 'near');
  const banked = game.score, record = game.best;
  assert.equal(record, banked, 'the queued awards have already established a new record');
  assert.equal(rider.strike(0, 1, 1), 'fall');
  hud.update(game, 1 / 120);
  assert.equal(f['event-name'].textContent, 'WIPEOUT', 'a queued celebration cannot delay the crash reason');
  assert.equal(f['event-kicker'].textContent, 'CAUGHT AN OBSTACLE');
  assert.equal(f['event-points'].hidden, true);
  assert.equal(root.nodes['[data-callout]'].textContent, 'WIPEOUT, CAUGHT AN OBSTACLE',
    'a same-frame first record cannot replace the urgent crash reason');
  hud.update(game, .1);
  assert.equal(f.best.textContent, 'Personal best · 7,260');
  assert.equal(game.score, banked, 'retiring stale banners preserves already earned points');
  assert.equal(game.best, record);
  assert.equal(game.flow, .5 * (1 - SCORE.flowBail), 'the existing crash flow penalty is unchanged');
  assert.equal(game.combo, comboFor(game.flow)); assert.equal(game.flowHold, 0);
  for (let i = 0; i < 720; i++) {
    rider.step(1 / 120, neutral); hud.update(game, 1 / 120);
    if (!f.event.hidden) assert.equal(f['event-name'].textContent, 'WIPEOUT', 'stale awards never replay through recovery');
  }
  assert.equal(rider.state, 'ride'); assert.equal(f.event.hidden, true);
  assert.equal(game.score, banked);
  award(40, 'HARE DODGED', 'near'); hud.update(game, .1);
  assert.equal(f['event-name'].textContent, 'HARE DODGED', 'new earned feedback still works after recovery');
}
{
  const { rider, game } = feedbackFixture();
  rider.takeOff(4, rider.UP); hud.update(game, .1);
  hud.banner('PERFECT POP', 0, 'near');
  rider.strike(0, 1, 1); hud.update(game, 1 / 120);
  assert.equal(f['event-name'].textContent, 'WIPEOUT', 'a crash also supersedes an airborne callout');
  assert.equal(f['event-kicker'].textContent, 'CAUGHT AN OBSTACLE');
}
{
  const { rider, game, near, sounds, pulses } = feedbackFixture();
  const encounter = allowed => {
    const before = { score: game.score, sounds: sounds.length, pulses: pulses.length };
    near(rider.pos.x + 1.5, rider.pos.z, 'rabbit');
    assert.equal(game.score - before.score, allowed ? SCORE.nearMiss * game.combo : 0,
      'hare reward follows controlled ride/air state: ' + rider.state + '/' + game.mode);
    assert.equal(sounds.length - before.sounds, allowed ? 1 : 0, 'rejected encounters stay silent');
    assert.equal(pulses.length - before.pulses, allowed ? 1 : 0, 'rejected encounters do not rumble');
    if (allowed) assert.equal(sounds.at(-1).name, 'whoosh');
  };
  encounter(true);
  rider.takeOff(4, rider.UP); assert.equal(rider.state, 'air'); encounter(true);
  assert.equal(rider.strike(0, 1, 1), 'fall'); encounter(false);
  for (let i = 0; rider.state === 'fall' && i < 1200; i++) rider.step(1 / 120, neutral);
  assert.equal(rider.state, 'rise'); encounter(false);
  for (let i = 0; rider.state === 'rise' && i < 240; i++) rider.step(1 / 120, neutral);
  assert.equal(rider.state, 'ride'); encounter(true);
  game.mode = 'attract'; encounter(false);
  game.mode = 'paused'; encounter(false);
}
// A normal carve can put a world-right hare on the left of the displayed
// rider. Use real terrain, physics and the last drawn chase view, then check
// the callback against projected positions rather than repeating its pan math.
{
  const seed = getWorldSeed();
  try {
    setWorldSeed('alpen-side-audit');
    const { rider, camera, game, near, sounds, pulses } = feedbackFixture();
    const world = { height: heightAt, canStall: () => false };
    rider.world = world; rider.reset(-1000, guideAt(-1000));
    rider.vel.copy(rider.heading).multiplyScalar(20);
    const chase = createChaseCamera(THREE, camera), turn = { ...neutral, turn: 1, turnIntent: 1 };
    chase.update(rider, 1 / 60, world); camera.updateMatrixWorld();
    let bearing = 0;
    for (let frame = 0; frame < 180; frame++) {
      rider.step(1 / 120, turn); rider.step(1 / 120, turn);
      const view = camera.matrixWorld.elements;
      bearing = Math.atan2(-view[8], view[10]) * 180 / Math.PI;
      if (rider.grounded && rider.state === 'ride' && bearing >= 55) break;
      chase.update(rider, 1 / 60, world); camera.updateMatrixWorld();
    }
    assert.equal(rider.state, 'ride'); assert.equal(rider.grounded, true);
    assert(bearing >= 55 && bearing < 70, 'the real carve produces a diagonal chase view');
    const encounter = (dx, dz, expected) => {
      const hare = new THREE.Vector3(rider.pos.x + dx, 0, rider.pos.z + dz);
      hare.y = heightAt(hare.x, hare.z);
      assert(hare.distanceTo(rider.pos) < 2.6 && Math.abs(dz) < 2,
        'the encounter fits the existing three-dimensional near-miss bounds');
      if (dx || dz) {
        const screenSide = hare.clone().project(camera).x - rider.pos.clone().project(camera).x;
        assert.equal(Math.sign(screenSide), Math.sign(expected), 'the expected cue follows the visible side');
      }
      const before = { score: game.score, sounds: sounds.length, pulses: pulses.length };
      near(hare.x, hare.z, 'rabbit');
      assert.equal(sounds.length - before.sounds, 1); assert.equal(sounds.at(-1).name, 'whoosh');
      assert.equal(sounds.at(-1).args[0], expected, 'the whoosh matches the last drawn view');
      assert.equal(game.score - before.score, SCORE.nearMiss * game.combo);
      assert.equal(pulses.length - before.pulses, 1);
    };
    encounter(.3, -1.8, -.7);
    encounter(-.3, 1.8, .7);
    encounter(0, 0, 0);
    rider.takeOff(4, rider.UP); assert.equal(rider.state, 'air');
    rider.yaw += Math.PI; rider.heading.negate();
    encounter(.3, -1.8, -.7); // Board facing changes independently of the drawn view.
  } finally { setWorldSeed(seed); }
}
console.log('HUD checks passed: state transitions, charge, flow, live butters, truthful personal records, cross-tab record persistence and storage recovery, immediate crash feedback, controlled encounter rewards and view-relative sound, banners, device prompts, accessibility, safe area, controls disclosure, keyboard/controller focus, bounded help scrolling, and idle DOM writes.');
