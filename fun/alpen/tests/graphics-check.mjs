// Run with: node tests/graphics-check.mjs
// Real geometry, materials and targets; stand-ins cover only canvas, image IO
// and renderer submissions. Shader compilation and appearance need browser QA.
import assert from 'node:assert/strict';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createSky } from '../js/sky.js';
import { createRetro } from '../js/retro.js';
import { RENDER } from '../js/config.js';

globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
globalThis.document = {
  createElement: () => ({ getContext: () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  }) }),
};
const TestTHREE = { ...THREE, TextureLoader: class {
  load(url, ready, progress, fail) { fail?.(); return new THREE.Texture(); }
} };
const { createWeather } = await import('../js/weather.js');
const weather = createWeather(THREE);
weather.pin(0.45); weather.update(0);
const w = weather.state;
w.elevation = 0.6; w.storm = 0;
const close = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-8, `${why}: ${a} / ${b}`);

let sky = createSky(TestTHREE);
const geometries = new Set();
sky.group.traverse(object => {
  if (!object.geometry || geometries.has(object.geometry)) return;
  const geo = object.geometry;
  geometries.add(geo);
  for (const [name, attribute] of Object.entries(geo.attributes)) {
    assert.ok(attribute.array.every(Number.isFinite), `${object.name}: finite ${name}`);
  }
  if (geo.index) assert.ok(geo.index.array.every(i => i < geo.attributes.position.count));
});
assert.ok(geometries.size >= 8, 'check the full procedural backdrop');
const relief = sky.group.getObjectByName('mid-distance massifs');
assert.ok(relief, 'relief mesh exists');
const radius = relief.geometry.attributes.aRadius.array;
const columns = radius.findIndex(value => value !== radius[0]);
assert.ok(columns > 1 && radius.length % columns === 0, 'closed radial grid');
for (let start = 0; start < radius.length; start += columns) {
  for (const name of ['position', 'normal']) {
    const attribute = relief.geometry.attributes[name];
    for (let axis = 0; axis < 3; axis++) {
      close(attribute.array[start * 3 + axis], attribute.array[(start + columns - 1) * 3 + axis],
        `${name} closes without a seam`);
    }
  }
}
assert.ok(relief.geometry.index.count / 3 < 40000, 'bounded mountain complexity');

// Frozen shadow texture, anchor and sun must describe one world transform.
const shadowRates = [];
for (const fps of [30, 60, 144]) {
  if (fps !== 30) sky = createSky(TestTHREE);
  const key = sky.lights.children.find(object => object.isDirectionalLight);
  assert.ok(key);
  const pos = new THREE.Vector3(0, 100, 0);
  const lightWorld = new THREE.Vector3();
  const targetWorld = new THREE.Vector3();
  let previousLight, previousTarget, updates = 0, heldFrames = 0;
  for (let frame = 0; frame < fps * 4; frame++) {
    pos.z -= 12 / fps;
    pos.y -= 3 / fps;
    w.azimuth += 0.00005 / fps;
    sky.update(pos, w, 1 / fps);
    sky.lights.updateMatrixWorld(true);
    key.getWorldPosition(lightWorld);
    key.target.getWorldPosition(targetWorld);
    assert.ok(lightWorld.toArray().every(Number.isFinite));
    assert.equal(key.shadow.autoUpdate, false);
    if (key.shadow.needsUpdate) {
      updates++;
      // Emulate allocation/completion of the renderer's first depth pass.
      key.shadow.map ||= new THREE.WebGLRenderTarget(1, 1);
      key.shadow.needsUpdate = false;
    } else if (previousLight) {
      assert.ok(lightWorld.distanceTo(previousLight) < 1e-8, 'held shadow light stays in world space');
      assert.ok(targetWorld.distanceTo(previousTarget) < 1e-8, 'held shadow target stays in world space');
      heldFrames++;
    }
    previousLight = lightWorld.clone(); previousTarget = targetWorld.clone();
  }
  assert.ok(Math.abs(updates - 120) <= 3, `${fps} FPS produces about 30 shadow updates/second: ${updates}`);
  if (fps > 30) assert.ok(heldFrames > fps, 'faster displays reuse shadow frames');
  shadowRates.push(`${fps} FPS: ${updates / 4} Hz`);
  w.azimuth += 0.2;
  sky.update(pos, w, 0);
  assert.equal(key.shadow.needsUpdate, true, 'a large light change refreshes immediately');
}

const ranges = sky.group.children.filter(mesh => mesh.name === 'far-range' || mesh.name === 'mid-distance massifs');
assert.ok(ranges.length >= 3);
const rotations = ranges.map(mesh => mesh.quaternion.clone());
for (const distance of [0, 12000, 1000000]) {
  sky.update(new THREE.Vector3(100, -distance * 0.3, -distance), w, 1 / 60);
  for (let i = 0; i < ranges.length; i++) {
    assert.ok(ranges[i].quaternion.equals(rotations[i]), 'long travel preserves landmark bearings');
    assert.ok(ranges[i].position.toArray().every(Number.isFinite));
  }
  const massif = sky.group.getObjectByName('mid-distance massifs');
  assert.ok(Math.abs(massif.position.z) <= 120, 'forward backdrop parallax remains bounded');
}

// Count actual render submissions and reject texture/attachment feedback.
let target = null, submissions = 0, lastComposite = null, canvasSizes = 0;
const renderer = {
  info: { reset() { submissions = 0; } },
  capabilities: { isWebGL2: false },
  getContext: () => ({}),
  setPixelRatio() {},
  setSize() { canvasSizes++; },
  setRenderTarget(value) { target = value; },
  clear() {},
  render(scene) {
    submissions++;
    scene.traverse(object => {
      const uniforms = object.material?.uniforms;
      if (!uniforms) return;
      for (const uniform of Object.values(uniforms)) {
        if (target) assert.notEqual(uniform.value, target.texture, 'render target cannot sample itself');
      }
      if (!target) lastComposite = uniforms;
    });
  },
};
const retro = createRetro(THREE, renderer);
retro.setSize(1280, 720);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
retro.render(scene, camera);
const fullPasses = submissions;
const fullWidth = retro.width;
assert.equal(fullPasses, 8, 'world, tight bloom, wide bloom and composite');
assert.equal(renderer.info.autoReset, false, 'renderer statistics cover the full frame');
retro.updatePerformance(0.6);
assert.equal(retro.scale, RENDER.maxScale, 'an isolated stall does not reduce resolution');
for (let i = 0; i < 300; i++) { retro.updatePerformance(1 / 25); retro.updateEffects(1 / 25); }
assert.equal(retro.scale, RENDER.minScale, 'sustained pressure reaches the quality floor');
assert.ok(retro.width < fullWidth);
assert.equal(retro.displayWidth, 1280, 'final output remains native size');
assert.equal(canvasSizes, 1, 'governor does not reallocate the visible canvas');
for (let i = 0; i < 120; i++) retro.updateEffects(1 / 60);
retro.render(scene, camera);
assert.equal(submissions, fullPasses - 3, 'settled low quality removes exactly the three halo passes');
assert.ok(lastComposite.uBloomWide.value < 0.001, 'halo fades before its passes stop');
for (let i = 0; i < 90 * 80; i++) { retro.updatePerformance(1 / 90); retro.updateEffects(1 / 90); }
assert.equal(retro.scale, RENDER.maxScale, 'sustained headroom recovers full resolution');
retro.render(scene, camera);
assert.equal(submissions, fullPasses, 'wide halo returns with recovered quality');
assert.equal(retro.width, fullWidth);
assert.equal(canvasSizes, 1);
console.log(`Graphics checks passed: ${geometries.size} geometries, welded seams; shadows ${shadowRates.join(', ')}; stable backdrop and ${fullPasses} → ${fullPasses - 3} → ${fullPasses} post passes.`);
