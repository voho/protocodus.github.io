// Run with: node tests/graphics-check.mjs
// Real geometry, materials and targets; stand-ins cover only canvas, image IO
// and renderer submissions. Shader compilation and appearance need browser QA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createSky } from '../js/sky.js';
import { createRetro } from '../js/retro.js';
import { createSnowfall, createSpray, createStreaks } from '../js/particles.js';
import { RENDER, GRADE, SNOW, STREAKS } from '../js/config.js';

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
  for (const name of ['position', 'normal', 'aGeology']) {
    const attribute = relief.geometry.attributes[name];
    for (let axis = 0; axis < 3; axis++) {
      close(attribute.array[start * attribute.itemSize + axis],
        attribute.array[(start + columns - 1) * attribute.itemSize + axis],
        `${name} closes without a seam`);
    }
  }
}
assert.equal(relief.geometry.index.count / 3, 35840, 'scenery polish keeps its triangle budget');
const geology = relief.geometry.attributes.aGeology;
for (let start = 0; start < radius.length; start += columns) {
  const turns = geology.getW(start + columns - 1) - geology.getW(start);
  assert.ok(Number.isInteger(turns), 'material field closes on a whole texture repeat');
}
const rangeNoise = sky.group.getObjectByName('far-range').material.uniforms.uNoise.value;
assert.equal(relief.material.uniforms.uNoise.value, rangeNoise, 'mountain detail reuses the sky texture');
assert.ok(rangeNoise.generateMipmaps, 'distant material detail remains filtered');

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

// Pin both weather axes inside the test module so every band is checked with
// its complete derived palette, fog, wind and snowfall. Production stays free
// of test overrides, and the existing graphics scene exercises each result.
const weatherURL = new URL('../js/weather.js', import.meta.url);
let weatherSource = await readFile(weatherURL, 'utf8');
weatherSource = weatherSource.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
  (_, quote, path) => `from ${quote}${new URL(path, weatherURL).href}${quote}`)
  .replace('  let dayClock = 0;', '  let testStorm;\n  let dayClock = 0;')
  .replace('    const s = state.storm;', '    state.storm = testStorm ?? state.storm;\n    const s = state.storm;')
  .replace('return { state, update, pin, release, triggerStorm };', `return {
    check(tod, storm) { testStorm = storm; frozen = tod; pinnedTod = tod;
      fogSettled = false; return update(0); }
  };`);
const modeWeather = (await import('data:text/javascript;base64,'
  + Buffer.from(weatherSource).toString('base64'))).createWeather(THREE);
const skyPosition = new THREE.Vector3(0, -2800, -8000);
const luma = c => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const hemisphere = sky.lights.children.find(light => light.isHemisphereLight);
const farRange = sky.group.getObjectByName('far-range');
const bands = new Set();
let weatherCases = 0;
for (const tod of [0, 0.09, 0.17, 0.30, 0.48, 0.66, 0.79, 0.86, 0.95]) {
  let previousFar = Infinity, previousKey = Infinity;
  for (const storm of [0, 0.1, 0.26, 0.48, 0.72, 1]) {
    const mode = modeWeather.check(tod, storm);
    bands.add(mode.conditions.split(' · ')[0]);
    for (const value of Object.values(mode)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
      if (value?.isColor) assert.ok(value.toArray().every(Number.isFinite));
    }
    assert.ok(mode.fogFar <= previousFar && mode.keyI <= previousKey);
    assert.ok(mode.fogFar >= 68 && mode.fogNear >= 10 && mode.fogNear < mode.fogFar);
    assert.equal(mode.snow, storm * 1.06, 'atmospheric tuning keeps every authored flake');
    previousFar = mode.fogFar; previousKey = mode.keyI;
    sky.update(skyPosition, mode, 1 / 60);
    if (tod === 0 && storm === 1) {
      assert.ok(luma(hemisphere.color) * hemisphere.intensity > 0.045,
        'a night storm retains diffuse light for the immediate riding line');
    }
    weatherCases++;
  }
}
assert.equal(bands.size, 6, 'all six snowfall bands are exercised');
sky.update(skyPosition, modeWeather.check(0.48, 0), 0);
const dayRange = luma(farRange.material.uniforms.uPeak.value);
const nightMode = modeWeather.check(0, 0);
sky.update(skyPosition, nightMode, 0);
assert.ok(luma(farRange.material.uniforms.uPeak.value) < dayRange * 0.25,
  'night fallback mountains cannot retain their daytime exposure');
const star = sky.group.children.find(object => object.isPoints);
sky.update(skyPosition, { ...nightMode, cloud: 0 }, 0);
const clearStars = star.material.uniforms.uAlpha.value;
sky.update(skyPosition, { ...nightMode, cloud: 0.8 }, 0);
assert.ok(star.material.uniforms.uAlpha.value < clearStars * 0.4,
  'cloud veils the star field even without falling snow');

// Loaded plates must hide a sun behind their ridge, including an outgoing
// photograph during crossfade. Synthetic images have an unambiguous skyline.
const createCanvas = document.createElement;
document.createElement = () => {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  let skylineY = 51;
  context.drawImage = image => { skylineY = image.skylineY; };
  context.getImageData = (x, y, width, height) => ({ data: Uint8ClampedArray.from(
    { length: width * height * 4 }, (_, i) => Math.floor(i / 4 / width) < skylineY ? 20 : 220) });
  canvas.getContext = () => context;
  return canvas;
};
const plateSky = createSky({ ...THREE, TextureLoader: class {
  load(url, ready) {
    const texture = new THREE.Texture();
    texture.image = { skylineY: url.includes('sunset') ? 63 : 51 };
    ready?.(texture); return texture;
  }
} });
document.createElement = createCanvas;
const disc = plateSky.group.children.find(object => object.material?.uniforms?.uMoon);
const daylight = { ...modeWeather.check(0.48, 0), cloud: 0, elevation: 0.15 };
for (let i = 0; i < 4; i++) plateSky.update(skyPosition, daylight, 1);
assert.equal(disc.material.uniforms.uOpacity.value, 0, 'a photographed ridge occludes the disc');
plateSky.update(skyPosition, { ...daylight, elevation: 0.6 }, 0);
assert.ok(disc.material.uniforms.uOpacity.value > 0.9, 'the sun above the ridge remains visible');
const sunset = { ...daylight, tod: 0.66 };
plateSky.update(skyPosition, sunset, 0.5);
assert.equal(disc.material.uniforms.uOpacity.value, 0, 'an outgoing high ridge still hides the sun');
for (let i = 0; i < 40; i++) plateSky.update(skyPosition, sunset, 1 / 6);
assert.ok(disc.material.uniforms.uOpacity.value > 0.9, 'the sun clears the incoming lower ridge');
for (const tod of [0, 0.09, 0.86, 0.95]) {
  const mode = modeWeather.check(tod, 0);
  plateSky.update(skyPosition, mode, 1 / 60);
  sky.update(skyPosition, mode, 1 / 60);
  assert.ok(plateSky.group.children.filter(object => object.name === 'far-range')
    .every(object => !object.visible), 'dim night photos must not revive fallback ribbons');
  assert.ok(sky.group.children.filter(object => object.name === 'far-range')
    .every(object => object.visible), 'missing photos retain the procedural skyline');
}

// Count actual render submissions and reject texture/attachment feedback.
let target = null, submissions = 0, lastComposite = null, canvasSizes = 0, clears = 0;
const postGeometries = new Set();
let blurShader = '';
const renderer = {
  autoClear: true,
  info: { reset() { submissions = 0; clears = 0; } },
  capabilities: { isWebGL2: false },
  getContext: () => ({}),
  setPixelRatio() {},
  setSize() { canvasSizes++; },
  setRenderTarget(value) { target = value; },
  clear() { clears++; },
  render(scene) {
    if (this.autoClear) this.clear();
    submissions++;
    scene.traverse(object => {
      const uniforms = object.material?.uniforms;
      if (!uniforms) return;
      postGeometries.add(object.geometry);
      if (uniforms.uDir) blurShader = object.material.fragmentShader;
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
assert.equal(clears, 1, 'clear world once; fullscreen passes overwrite their targets');
assert.equal(renderer.autoClear, true, 'post stack restores renderer clearing policy');
assert.equal(renderer.info.autoReset, false, 'renderer statistics cover the full frame');
assert.equal(lastComposite.uRays.value, 0, 'inactive rays contribute exactly zero without a texture fetch');

// One triangle covers the same viewport and reconstructs the original UVs.
assert.equal(postGeometries.size, 1, 'all post passes share one fullscreen geometry');
const fullscreen = [...postGeometries][0];
assert.equal(fullscreen.attributes.position.count, 3);
const p = fullscreen.attributes.position;
const uv = fullscreen.attributes.uv;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const area = cross(p.getX(1) - p.getX(0), p.getY(1) - p.getY(0),
  p.getX(2) - p.getX(0), p.getY(2) - p.getY(0));
for (const x of [-1, -0.43, 0, 0.28, 1]) {
  for (const y of [-1, -0.72, 0, 0.61, 1]) {
    const a = cross(p.getX(1) - x, p.getY(1) - y, p.getX(2) - x, p.getY(2) - y) / area;
    const b = cross(p.getX(2) - x, p.getY(2) - y, p.getX(0) - x, p.getY(0) - y) / area;
    const c = 1 - a - b;
    assert.ok(Math.min(a, b, c) > -1e-12, 'viewport lies inside the covering triangle');
    close(a * uv.getX(0) + b * uv.getX(1) + c * uv.getX(2), (x + 1) / 2, 'unchanged full-screen U');
    close(a * uv.getY(0) + b * uv.getY(1) + c * uv.getY(2), (y + 1) / 2, 'unchanged full-screen V');
  }
}

// Read the actual shader coefficients. Impulses span all possible source
// rows, proving the four bilinear fetches preserve the old filter, including
// its clamped borders and tiny render targets.
const coefficient = name => Number(blurShader.match(new RegExp(`const float ${name} = ([0-9.]+);`))[1]);
const innerWeight = coefficient('innerWeight'), outerWeight = coefficient('outerWeight');
const innerOffset = coefficient('innerOffset'), outerOffset = coefficient('outerOffset');
assert.equal([...blurShader.matchAll(/texture2D\(/g)].length, 4, 'blur submits four texture fetches');
function sample(row, x) {
  const left = Math.floor(x), t = x - left;
  const at = i => row[Math.min(row.length - 1, Math.max(0, i))];
  return at(left) * (1 - t) + at(left + 1) * t;
}
for (const size of [1, 2, 3, 5, 9, 32]) {
  for (let impulse = 0; impulse < size; impulse++) {
    const row = Array.from({ length: size }, (_, i) => i === impulse ? 4 : 0);
    for (let x = 0; x < size; x++) {
      const original = sample(row, x) * 0.382
        + (sample(row, x - 1.2) + sample(row, x + 1.2)) * 0.242
        + (sample(row, x - 3) + sample(row, x + 3)) * 0.067;
      const optimized = (sample(row, x - innerOffset) + sample(row, x + innerOffset)) * innerWeight
        + (sample(row, x - outerOffset) + sample(row, x + outerOffset)) * outerWeight;
      close(optimized, original, 'same HDR blur kernel at every texel and border');
    }
  }
}
retro.updatePerformance(0.6);
assert.equal(retro.scale, RENDER.maxScale, 'an isolated stall does not reduce resolution');
for (let i = 0; i < 120; i++) retro.updatePerformance(1 / 50);
assert.ok(retro.scale < RENDER.maxScale, 'persistent 50 FPS pressure targets smoother 60 Hz riding');
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
retro.setSun(0.5, 0.8, 1);
retro.render(scene, camera);
assert.equal(submissions, fullPasses + 1);
assert.equal(clears, 1);
assert.equal(lastComposite.uRays.value, GRADE.rays, 'visible rays retain their authored strength');
retro.setSun(0.5, 0.8, 0);
retro.render(scene, camera);
assert.equal(clears, 2, 'sunset clears the former ray image once');
assert.equal(lastComposite.uRays.value, 0, 'ray sampling stops on the same frame as the light pass');
retro.render(scene, camera);
assert.equal(clears, 1, 'settled darkness stops clearing the unused ray target');
retro.fade(0.6);
for (let i = 0; i < 120; i++) retro.updateEffects(1 / 60, false);
assert.equal(retro.animating, false, 'paused fade settles so rendering can sleep');
retro.fade(1);
for (let i = 0; i < 120; i++) retro.updateEffects(1 / 60);
assert.equal(retro.animating, false, 'resume fade settles normally');

// Timer results are optional and read only after the driver reports ready.
let available = false, disjoint = false, timerActive = false, queries = 0;
let contextLost = false, generation = 0;
const timer = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
renderer.capabilities.isWebGL2 = true;
renderer.extensions = { has: name => name === 'EXT_disjoint_timer_query_webgl2', get: () => timer };
renderer.domElement = new EventTarget();
renderer.getContext = () => ({
  QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4,
  getInternalformatParameter: () => [4, 2],
  isContextLost: () => contextLost,
  createQuery: () => ({ generation }),
  deleteQuery() {},
  getQuery: () => timerActive,
  beginQuery(type, query) {
    assert.equal(query.generation, generation, 'query belongs to current context');
    assert.equal(timerActive, false); timerActive = true; queries++;
  },
  endQuery() { assert.equal(timerActive, true); timerActive = false; },
  getParameter: () => disjoint,
  getQueryParameter(query, field) {
    assert.equal(query.generation, generation, 'never query a lost context resource');
    if (field === 3) return available;
    assert.equal(available, true, 'never block waiting for GPU timing');
    return 11000000;
  },
});
const timed = createRetro(THREE, renderer);
for (let i = 0; i < 26; i++) timed.render(scene, camera);
assert.equal(queries, 1, 'one pending sample bounds query work');
assert.equal(timed.gpuMs, null);
available = true;
for (let i = 0; i < 13; i++) timed.render(scene, camera, true);
assert.equal(timed.gpuMs, 11);
assert.equal(timed.gpuReusedShadowMs, 11);
disjoint = true;
for (let i = 0; i < 13; i++) timed.render(scene, camera, true);
assert.equal(timed.gpuMs, null, 'discard invalid GPU samples');
assert.equal(timed.gpuReusedShadowMs, null);
disjoint = false;
for (let i = 0; i < 13; i++) timed.render(scene, camera);
assert.equal(timed.gpuFreshShadowMs, 11, 'shadow refresh timing follows the sampled frame');
contextLost = true;
renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
assert.equal(timed.gpuMs, null, 'context loss clears stale GPU diagnostics');
contextLost = false;
generation++;
renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
for (let i = 0; i < 25; i++) timed.render(scene, camera);
const submit = renderer.render;
renderer.render = () => { throw new Error('test submission failure'); };
assert.throws(() => timed.render(scene, camera), /test submission failure/);
assert.equal(renderer.autoClear, true, 'submission failure restores clearing policy');
assert.equal(target, null, 'submission failure restores the visible render target');
assert.equal(timerActive, false, 'submission failure closes the active timer query');
renderer.render = submit;
timed.render(scene, camera);

// Pool capacity must not become submitted work when only a few grains live.
const wind = new THREE.Vector3();
const spray = createSpray(THREE);
const sprayGeo = spray.points.geometry;
assert.equal(spray.points.visible, false);
spray.burst(new THREE.Vector3(), 1, 0, 12, 0.6);
spray.update(1 / 60, camera, wind);
assert.equal(sprayGeo.drawRange.count, 12, 'a small burst submits only its live particles');
assert.equal(spray.points.visible, true);
for (let i = 0; i < SNOW.sprayCount + 20; i++) {
  if (i % 10 === 0) spray.burst(new THREE.Vector3(), 1, 0, 13, 0.6);
  spray.update(1 / 60, camera, wind);
}
const submitted = sprayGeo.index.array.subarray(0, sprayGeo.drawRange.count);
assert.equal(new Set(submitted).size, submitted.length, 'recycled ring slots submit once');
for (const i of submitted) assert.ok(i < SNOW.sprayCount && sprayGeo.attributes.aAlpha.array[i] >= 0);
for (let i = 0; i < 300; i++) spray.update(1 / 60, camera, wind);
assert.equal(spray.points.visible, false, 'expired spray stops drawing');
assert.equal(sprayGeo.drawRange.count, 0);
spray.burst(new THREE.Vector3(), 0, 1, 3, 0.2);
spray.update(1 / 60, camera, wind);
assert.equal(sprayGeo.drawRange.count, 3, 'empty pool wakes on emission');
spray.clear();
assert.equal(sprayGeo.drawRange.count, 0, 'restart clears submissions immediately');
const snowfall = createSnowfall(THREE);
snowfall.setIntensity(0);
snowfall.update(1 / 60, camera, wind);
assert.ok(snowfall.points.geometry.drawRange.count < SNOW.count / 2, 'flurries skip unused storm capacity');
snowfall.setIntensity(1);
snowfall.update(1 / 60, camera, wind);
assert.equal(snowfall.points.geometry.drawRange.count, snowfall.points.geometry.attributes.position.count,
  'full weather retains every authored flake and drift grain');
const streaks = createStreaks(THREE);
streaks.update(1 / 60, camera, wind, 0, wind);
assert.equal(streaks.lines.visible, false, 'slow riding draws no invisible speed ribbons');
streaks.update(1 / 60, camera, new THREE.Vector3(0, 0, -STREAKS.full), STREAKS.full, wind);
assert.equal(streaks.lines.geometry.drawRange.count, STREAKS.count * 6);
assert.equal(streaks.lines.visible, true);
console.log(`Graphics checks passed: ${geometries.size} geometries, ${weatherCases} weather cases; shadows ${shadowRates.join(', ')}; stable backdrop and ${fullPasses} → ${fullPasses - 3} → ${fullPasses} post passes.`);
