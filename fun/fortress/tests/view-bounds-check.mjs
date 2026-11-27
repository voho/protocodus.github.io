import assert from 'node:assert/strict';
import { createView } from '../view.js';
import { generateLevel } from '../simulation.js';

// Drive the same controls and pointer handlers as the page. No scene pixels
// are needed to read the world coordinates under the visible HUD edges.
const context = {
  setTransform() {}, drawImage() {}, fillRect() {},
  createLinearGradient() { return { addColorStop() {} }; },
};
class Element extends EventTarget {
  dataset = {};
  style = { setProperty() {} };
  clientWidth = 1440;
  clientHeight = 480;
  getContext() { return context; }
  getBoundingClientRect() {
    return { top: 0, bottom: this.clientHeight, left: 0, width: this.clientWidth, height: this.clientHeight };
  }
  setPointerCapture() {}
  toggleAttribute() {}
}
const controls = new Map();
globalThis.document = {
  createElement: () => new Element(),
  getElementById(id) {
    if (!controls.has(id)) controls.set(id, new Element());
    return controls.get(id);
  },
};
globalThis.devicePixelRatio = 1;
globalThis.matchMedia = () => ({ matches: true });
let resized;
globalThis.ResizeObserver = class {
  constructor(notify) { resized = notify; }
  observe() {}
};

const field = new Element(), panorama = new Element(), scenery = new Element(), hud = new Element();
hud.clientHeight = 64;
const camera = createView(field, panorama, scenery, hud);
const click = (id) => controls.get(id).dispatchEvent(new Event('click'));
const move = (type, x, y) => field.dispatchEvent(Object.assign(new Event(type), {
  pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y,
}));
function drag(dx, dy) {
  move('pointerdown', 500, 240);
  move('pointermove', 500 + dx, 240 + dy);
  move('pointerup', 500 + dx, 240 + dy);
}

for (const size of ['small', 'large']) {
  const level = generateLevel(size, 6, 3);
  const sim = { level, time: 0, side: 'left', projectiles: new Set() };
  const ward = level.sections[0];
  const crest = ward.base - Math.max(...ward.heights) * ward.storey;
  const update = () => camera.update(sim, [], 1 / 60, true);
  function visible() {
    update();
    const from = camera.target(0, hud.clientHeight + 8), to = camera.target(field.clientWidth, field.clientHeight - 6);
    return { left: from.x, top: from.y, right: to.x, bottom: to.y };
  }
  function assertFortressInFrame(message) {
    const area = visible();
    let x = ward.left;
    const intersects = ward.spans.some((width, i) => {
      const left = x;
      x += width;
      const roof = ward.base - ward.heights[i] * ward.storey;
      return x > area.left && left < area.right && area.bottom > roof && area.top < ward.base;
    });
    assert.ok(intersects, size + ' ' + message + ' keeps part of a tower visible');
    return area;
  }
  field.clientWidth = 1440;
  field.clientHeight = 480;
  resized();
  camera.frame('day', 6, scenery, level.sections);
  const overview = update();
  for (let i = 0; i < 3; i++) click('zoom-in');
  assert.equal(controls.get('zoom-fit').textContent, '250%');
  const close = update();
  assert.ok(close.width < overview.width / 2);
  drag(10000, 0);
  const left = assertFortressInFrame('far-left drag');
  drag(-20000, 0);
  const right = assertFortressInFrame('far-right drag');
  assert.ok(right.left > left.left, 'There is room to inspect both flanks');
  drag(0, 12000);
  const sky = assertFortressInFrame('skyward drag');
  assert.ok(sky.top >= crest - 46, size + ' upward drag stops at the actual fortress skyline');
  assert.ok(sky.top < crest, size + ' upper view reveals the crest');

  field.clientWidth = 1200;
  field.clientHeight = 430;
  resized();
  assertFortressInFrame('resize while panned');
  click('zoom-out');
  assertFortressInFrame('zoom out while panned');
  click('zoom-in');
  drag(-10000, 10000);
  assertFortressInFrame('diagonal drag after zoom and resize');

  camera.selectCrew(level.catapults.left.x);
  const crew = visible();
  assert.ok(crew.left <= level.catapults.left.x && crew.right >= level.catapults.left.x,
    'Selecting a crew can bring its launcher back into view');
  click('zoom-fit');
  const fitted = update();
  assert.equal(controls.get('zoom-fit').textContent, '100%');
  camera.frame('day', 6, scenery, level.sections);
  assert.deepEqual(fitted, update(), size + ' Fit clears all manual offsets');
}
console.log('Fortress manual camera bounds passed pan, skyline, resize, zoom, crew selection and Fit.');
