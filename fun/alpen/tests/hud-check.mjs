// Run with: node tests/hud-check.mjs
// DOM stand-ins cover HUD state and input gating; appearance needs browser QA.
import assert from 'node:assert/strict';
import { createHud } from '../js/hud.js';
let writes = 0;
class Node {
  constructor(hud = '') { this.dataset = { hud }; this.hidden = false; this._text = ''; this.listeners = {}; this.nodes = {}; this.style = { setProperty(k,v) { this[k] = v; } }; }
  get textContent() { return this._text; }
  set textContent(s) { this._text = s; writes++; }
  setAttribute(k,v) { this[k] = v; }
  appendChild(n) { return n; }
  querySelector(s) { return this.nodes[s] || null; }
  querySelectorAll(s) { return s === '[data-hud]' ? Object.values(this.fields) : this.targets || []; }
  insertAdjacentHTML(where,s) { this.fields = Object.fromEntries([...s.matchAll(/data-hud="([^"]+)"/g)].map(m => [m[1],new Node(m[1])])); }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  focus() { document.activeElement = this; }
  blur() { document.activeElement = null; }
  contains(n) { return this.targets?.includes(n) || n === this; }
  getClientRects() { return [{}]; }
}
const root = new Node(), curtain = new Node(), guide = new Node(), button = new Node(), summary = new Node();
root.nodes['canvas'] = new Node();
root.nodes['[data-readout]'] = new Node();
root.nodes['[data-callout]'] = new Node();
curtain.nodes['.control-guide'] = guide;
for (const name of ['score','distance','drop']) curtain.nodes[`[data-menu-${name}]`] = new Node();
curtain.targets = [button, summary];
guide.nodes.summary = summary;
globalThis.document = { activeElement: null, querySelector: () => curtain, createElement: () => new Node() };
globalThis.window = { devicePixelRatio: 2, innerHeight: 800 };
const hud = createHud(root), f = root.fields;
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
assert.equal(f.guide.textContent, 'Back to the piste →');
assert.match(f.best.textContent, /Personal best/);
hud.setMuted(true); assert.equal(f.muted.hidden, false);
hud.setMuted(false); assert.equal(f.muted.hidden, true);
g.rider.charging = false; g.rider.grounded = true; g.score = 0; g.gateRun = 0; g.combo = 1; g.flow = 0; g.pisteOffset = 0;
hud.resetScore(); hud.update(g, .1);
assert.equal(f.score.textContent, '0'); assert.equal(f.event.hidden, true); assert.equal(f.combo.hidden, true); assert.equal(f.gates.hidden, true);
for (let i=0; i<100;i++) hud.update(g,.1);
assert.equal(f.hint.hidden, true);
let stopped = false, prevented = false;
guide.listeners.click({ stopPropagation() { stopped = true; } });
assert.equal(stopped, true, 'help click cannot start the ride');
guide.open = true;
guide.listeners.keydown({ key: 'Escape', stopPropagation() {} });
assert.equal(guide.open, false); assert.equal(document.activeElement, summary);
curtain.listeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, true); assert.equal(document.activeElement, button);
curtain.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() {}, stopPropagation() {} });
assert.equal(document.activeElement, summary);
const beforeStill = writes;
for (let i=0; i<9;i++) hud.update(g,.09);
assert.equal(writes, beforeStill, 'stable visible values do not touch DOM text');
console.log('HUD checks passed: state transitions, loading compatibility, charge, flow, banner pause/reset, accessibility, safe area, controls disclosure, modal focus, and idle DOM writes.');
