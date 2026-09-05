// Run with: node tests/background-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');

function page(reduced = false) {
  const frames = [], idle = [], observers = [], canvases = [];
  let paints = 0;
  class ResizeObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
  }
  const window = Object.assign(new EventTarget(), {
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 3,
    ResizeObserver, requestIdleCallback: (callback) => idle.push(callback),
    matchMedia: (query) => ({ matches: query.includes('reduced-motion') && reduced }),
  });
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    documentElement: { classList: { add() {} } },
    body: { clientWidth: 1440, clientHeight: 20000, prepend: (canvas) => canvases.unshift(canvas) },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const attributes = new Map();
      const context = {
        scale() {}, translate() {}, strokeRect() {}, fillRect() {}, setTransform() {},
        save() {}, drawImage() {}, restore() {}, clearRect() { paints++; },
      };
      return {
        width: 300, height: 150,
        get clientWidth() { return window.innerWidth; },
        get clientHeight() { return window.innerHeight; },
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: (name) => attributes.get(name),
        getContext: () => context,
      };
    },
  });
  runInNewContext(source, {
    window, document, ResizeObserver,
    requestIdleCallback: window.requestIdleCallback,
    requestAnimationFrame: (callback) => frames.push(callback),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  });
  return {
    window, document, frames, idle, observers, canvases,
    get paints() { return paints; },
    tick(now) { frames.splice(0).forEach((callback) => callback(now)); },
    visibility(hidden) {
      document.hidden = hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

const normal = page();
assert.equal(normal.canvases.length, 0, 'Background waits until idle');
normal.tick(0); // Entrance transition has its own one-off frame.
assert.equal(normal.idle.length, 1);
normal.idle.shift()();
assert.equal(normal.canvases.length, 1, 'One shared canvas, even without a hero');
const canvas = normal.canvases[0];
assert.equal(canvas.className, 'life');
assert.equal(canvas.getAttribute('aria-hidden'), 'true');
assert.equal(normal.observers.length, 1);
assert.equal(normal.observers[0].target, canvas);
assert.deepEqual([canvas.width, canvas.height], [2880, 1800], 'Viewport size with DPR capped at two');
normal.tick(1000);
assert.equal(normal.paints, 1);
assert.equal(normal.frames.length, 1, 'Exactly one animation loop');

normal.visibility(true);
normal.tick(1016);
assert.equal(normal.paints, 1, 'Hidden tab does not paint');
assert.equal(normal.frames.length, 0, 'Hidden tab stops scheduling frames');
normal.visibility(true);
assert.equal(normal.frames.length, 0);
normal.visibility(false);
normal.visibility(false);
assert.equal(normal.frames.length, 1, 'Repeated wake events do not duplicate the loop');
normal.tick(1050);
assert.equal(normal.paints, 2, 'Animation resumes when tab becomes visible');

Object.assign(normal.window, { innerWidth: 390, innerHeight: 844 });
normal.observers[0].callback();
assert.deepEqual([canvas.width, canvas.height], [780, 1688], 'Resize follows viewport, not document height');
normal.tick(1800);
assert.equal(normal.frames.length, 1);
assert.equal(normal.canvases.length, 1, 'Resize reuses the shared canvas');

const reduced = page(true);
reduced.tick(0);
assert.equal(reduced.idle.length, 0, 'Reduced motion never schedules animation startup');
assert.equal(reduced.canvases.length, 0);
console.log('Background checks passed: shared viewport canvas, resize, hidden-tab lifecycle, and reduced motion.');
