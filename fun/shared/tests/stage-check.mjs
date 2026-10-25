// Run with: node fun/shared/tests/stage-check.mjs
// Exercise the real stage camera and scheduler without a GPU. A fake clock
// checks work scheduling rather than making machine-dependent CPU assertions.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { THEMES } from '../themes.js';

const source = (await readFile(new URL('../stage.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export function createStage', 'globalThis.createStage = function');

function harness({ reduced = false, mobile = false, width = 1280, height = 800, frameHz = 60 } = {}) {
  let now = 0, nextId = 0;
  const jobs = new Map(), documentListeners = new Map();
  const frames = [], callbacks = { raf: 0, timer: 0 };
  const environments = [];
  const schedule = (kind, callback, delay) => {
    const id = ++nextId;
    jobs.set(id, { kind, callback, due: now + delay });
    return id;
  };
  class Renderer {
    constructor() { this.shadowMap = {}; this.info = { render: {} }; }
    setPixelRatio(value) { this.pixelRatio = value; }
    setSize() {}
    setClearColor() {}
    setEffects() {}
    render(scene, camera) { scene.updateMatrixWorld(true); frames.push(now); }
  }
  class PMREMGenerator {
    fromScene() {
      const target = { texture: new THREE.Texture(), disposed: false, dispose() { this.disposed = true; this.texture.dispose(); } };
      environments.push(target);
      return target;
    }
    dispose() {}
  }
  const context2d = {
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  };
  const fakeCanvas = {
    clientWidth: width, clientHeight: height,
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  };
  const document = {
    hidden: false,
    createElement: () => ({ getContext: (kind) => kind === 'webgl2' ? { getExtension() { return null; } } : context2d }),
    querySelector: (selector) => ({ getBoundingClientRect: () => selector === '.hud-top'
      ? { top: 0, bottom: 96, height: 96 } : { top: height - 140, bottom: height, height: 140 } }),
    querySelectorAll: () => [],
    addEventListener: (name, callback) => documentListeners.set(name, callback),
  };
  const context = vm.createContext({
    THREE: { ...THREE, WebGLRenderer: Renderer, PMREMGenerator },
    canRenderHalfFloat: () => false,
    createBursts: () => ({ alive: false, update() {}, burst() {}, mesh: new THREE.Mesh() }),
    performance: { now: () => now }, document,
    window: { innerWidth: width, innerHeight: height, devicePixelRatio: mobile ? 3 : 2,
      matchMedia: (query) => ({ matches: query.includes('reduced-motion') ? reduced : mobile }),
      addEventListener() {},
    },
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: (callback) => schedule('raf', callback, 1000 / frameHz),
    cancelAnimationFrame: (id) => jobs.delete(id),
    setTimeout: (callback, delay = 0) => schedule('timer', callback, Math.max(0, delay)),
    clearTimeout: (id) => jobs.delete(id),
  });
  vm.runInContext(source, context, { filename: 'stage.js' });
  const stage = context.createStage(fakeCanvas, { theme: THEMES.ocean });
  function advance(ms) {
    const end = now + ms;
    let iterations = 0;
    while (true) {
      const next = [...jobs].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > end) break;
      assert.ok(++iterations < 10000, 'the scheduler cannot spin without advancing time');
      now = next[1].due;
      jobs.delete(next[0]);
      callbacks[next[1].kind]++;
      next[1].callback(now);
    }
    now = end;
  }
  return { stage, advance, frames, jobs, callbacks, document, documentListeners, environments, now: () => now };
}

for (const mobile of [false, true]) {
  const h = harness({ mobile });
  const { stage } = h;
  stage.frame(4.9, 4.9);
  stage.start();
  h.advance(8000);
  const angle = Math.atan2(stage.camera.position.z, stage.camera.position.y) * 180 / Math.PI;
  assert.ok(angle > 8 && angle < 16, `the view has a slight fixed tilt (${angle.toFixed(2)}°)`);
  assert.ok(Math.abs(stage.camera.position.x) < 1e-9, 'the camera stays aligned with the board columns');
  const direction = stage.camera.getWorldDirection(new THREE.Vector3());
  assert.ok(Math.abs(direction.x) < 1e-9, 'the camera never turns around the board');
  for (const x of [-4.9, 0, 4.9]) for (const z of [-4.9, 0, 4.9]) {
    const point = new THREE.Vector3(x, 0.35, z);
    const projected = stage.project(point);
    assert.ok(projected.x > 0 && projected.x < 1280, 'the whole tilted board fits horizontally');
    assert.ok(projected.y > 96 && projected.y < 660, 'the board fits between the controls');
    const picked = stage.pick(projected.x, projected.y, point.y);
    assert.ok(picked && picked.distanceTo(point) < 1e-7, 'tilted projection and pointer picking agree');
  }
  const weatherAttributes = [];
  stage.scene.traverse((object) => {
    if (object.isPoints) for (const attribute of Object.values(object.geometry.attributes)) {
      weatherAttributes.push({ attribute, version: attribute.version });
    }
  });
  assert.ok(weatherAttributes.length, 'the theme includes weather geometry');
  const camera = stage.camera.position.clone();
  const count = h.frames.length, rafCount = h.callbacks.raf, timerCount = h.callbacks.timer;
  h.advance(1000);
  assert.ok(stage.camera.position.distanceTo(camera) < 0.003, 'the settled view does not rotate or drift');
  for (const { attribute, version } of weatherAttributes) {
    assert.equal(attribute.version, version, 'ambient animation keeps GPU geometry buffers unchanged');
  }
  assert.ok(h.frames.length - count <= (mobile ? 11 : 13), 'idle rendering uses a low frame rate');
  assert.ok(h.callbacks.raf - rafCount <= (mobile ? 12 : 14), 'idle scheduling avoids display-rate rAF polling');
  assert.ok(h.callbacks.timer > timerCount, 'idle frames wait on a timer');
  assert.ok(h.jobs.size <= 1, 'idle scheduling keeps at most one pending callback');
  const beforeWake = h.frames.length;
  stage.wake(0.5);
  h.advance(40);
  assert.ok(h.frames.length > beforeWake, 'input wakes the renderer promptly');
  const beforeActive = h.frames.length;
  h.advance(300);
  assert.ok(h.frames.length - beforeActive >= 14, 'active interactions render smoothly');
  assert.equal(stage.renderer.shadowMap.autoUpdate, false, 'static shadows do not redraw every frame');
  stage.renderer.shadowMap.needsUpdate = false;
  stage.invalidateShadows();
  assert.equal(stage.renderer.shadowMap.needsUpdate, true, 'board changes explicitly invalidate shadows');
  stage.stop();
  assert.equal(h.jobs.size, 0, 'stopping cancels both timers and animation frames');
  stage.start();
  stage.start();
  assert.equal(h.jobs.size, 1, 'starting twice schedules only one loop');
  h.document.hidden = true;
  h.documentListeners.get('visibilitychange')();
  assert.equal(h.jobs.size, 0, 'background tabs stop all rendering work');
  stage.start();
  assert.equal(h.jobs.size, 0, 'starting while hidden keeps the stage suspended');
  const previousEnvironment = h.environments.at(-1);
  stage.setTheme(THEMES.jungle);
  assert.equal(previousEnvironment.disposed, true, 'switching themes releases the complete reflection render target');
  assert.equal(stage.scene.environment, h.environments.at(-1).texture, 'the new reflection texture belongs to the current target');
  assert.equal(h.jobs.size, 0, 'theme changes cannot restart a hidden stage');
}

for (const frameHz of [120, 144]) {
  const h = harness({ frameHz });
  h.stage.start();
  h.advance(8000);
  const count = h.frames.length;
  h.stage.wake(1.2);
  h.advance(1000);
  const rendered = h.frames.length - count;
  assert.ok(rendered >= 58 && rendered <= 61, `a ${frameHz} Hz display keeps active animation near 60 fps (${rendered})`);
  h.stage.stop();
}

{
  const h = harness({ reduced: true });
  const initialCamera = h.stage.camera.position.clone();
  h.stage.start();
  h.advance(10000);
  assert.ok(h.stage.camera.position.distanceTo(initialCamera) < 1e-9, 'reduced motion opens directly in the resting view');
  const count = h.frames.length;
  h.advance(3000);
  assert.equal(h.frames.length, count, 'reduced motion sleeps completely once settled');
  assert.equal(h.jobs.size, 0, 'reduced motion leaves no idle callback running');
  h.stage.wake(0.1);
  h.advance(100);
  assert.ok(h.frames.length > count, 'reduced motion still redraws after input');
}
console.log('Stage checks passed: fixed tilt, framing/picking, idle scheduling, active response, static weather buffers, shadow invalidation, reflection cleanup and tab suspension.');
