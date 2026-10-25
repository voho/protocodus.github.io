// Run with: node fun/hedgerow/tests/hud-check.mjs
// The compass must not synchronously read layout, and an unchanged display
// must not replace text nodes or write styles each frame.
import assert from 'node:assert/strict';
import { createHud } from '../js/hud.js';

let writes = 0;
function element() {
  const style = new Proxy({ setProperty(k, v) { this[k] = v; } }, {
    set(target, key, value) { writes++; target[key] = value; return true; },
  });
  let content = '';
  return {
    style, parentElement: { classList: { toggle() {} } },
    classList: { add() {}, remove() {}, toggle() {} }, appendChild() {},
    get textContent() { return content; },
    set textContent(value) { writes++; content = value; },
    get clientWidth() { throw new Error('HUD frame read layout'); },
  };
}
globalThis.document = { createElement: element };
const elements = new Map();
const hud = createHud({ querySelector(selector) {
  if (!elements.has(selector)) elements.set(selector, element());
  return elements.get(selector);
} });
const marker = elements.get('[data-compass-mark]'), distance = elements.get('[data-compass-dist]');

hud.objectiveMarker(0.2, 102.1);
hud.compass(0.1);
assert.equal(marker.style.display, '');
assert.equal(distance.textContent, '102 m');
let before = writes;
for (let i = 0; i < 100; i++) {
  hud.objectiveMarker(0.20001, 102.2);
  hud.compass(0.10001);
}
assert.equal(writes, before, 'unchanged rounded bearings and distance do not mutate the DOM');

hud.objectiveMarker(0.2, 103.8);
hud.compass(0.1);
assert.equal(distance.textContent, '104 m', 'distance still changes at the next displayed metre');
hud.objectiveMarker(null, 0);
hud.compass(0.1);
assert.equal(marker.style.display, 'none', 'no objective hides its marker');
before = writes;
hud.compass(0.1);
assert.equal(writes, before, 'a hidden marker needs no repeated mutation');
hud.objectiveMarker(-2, 18);
hud.compass(-0.3);
assert.equal(marker.style.display, '', 'a new objective restores its marker');
assert.equal(distance.textContent, '18 m');
console.log('hud-check: compass updates without layout reads or unchanged DOM writes');
