// Run with: node tests/graphics-check.mjs
// Real geometry, materials and targets; stand-ins cover only canvas, image IO
// and renderer submissions. Shader compilation and appearance need browser QA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createSky } from '../js/sky.js';
import { createRetro } from '../js/retro.js';
import { createSnowfall, createSpray, createStreaks, getPointSizeCap, setPointSizeCap } from '../js/particles.js';
import { RENDER, GRADE, SNOW, STREAKS } from '../js/config.js';

const motionPreference = { matches: false };
globalThis.window = { devicePixelRatio: 1, matchMedia: () => motionPreference };
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

// Live OS comfort changes affect an existing storm, including a strike that
// is already lit. These are real ambient weather and seeded flash updates;
// no storm, clock or flash state is overridden to manufacture the event.
{
  const { getWorldSeed, setWorldSeed } = await import('../js/noise.js');
  const previousSeed = getWorldSeed(), previousMatchMedia = window.matchMedia;
  const normalPreference = { matches: false };
  const livePreference = { matches: false };
  const initialCalmPreference = { matches: true };
  let queries = 0;
  const create = preference => {
    window.matchMedia = query => {
      assert.equal(query, '(prefers-reduced-motion: reduce)');
      queries++;
      return preference;
    };
    return createWeather(THREE);
  };
  const nonFlash = state => Object.fromEntries(Object.entries(state)
    .filter(([key]) => key !== 'flash')
    .map(([key, value]) => [key, value?.isColor ? value.toArray() : value]));
  try {
    setWorldSeed(3);
    const normal = create(normalPreference);
    const live = create(livePreference);
    const initialCalm = create(initialCalmPreference);
    assert.equal(normal.state.lightningCell, -1, 'weather starts without a stale strike identity');
    assert.equal(normal.state.lightningStrength, 0, 'no strike has zero thunder strength');
    window.matchMedia = () => { assert.fail('weather updates reuse their retained media query'); };
    const dt = 1 / 60;
    let strikeTime = 0;
    for (let frame = 0; frame < 600 * 60; frame++) {
      normal.update(dt); live.update(dt); initialCalm.update(dt);
      if (normal.state.flash > 0.5) { strikeTime = (frame + 1) * dt; break; }
    }
    assert.ok(strikeTime > 0, 'the bounded ambient schedule supplies a visible natural strike');
    assert.equal(live.state.flash, normal.state.flash, 'ordinary weather keeps the seeded flash');
    const strikeCell = normal.state.lightningCell;
    assert.ok(Number.isInteger(strikeCell) && strikeCell >= 0, 'a natural strike exposes its seeded cell');
    assert.ok(normal.state.lightningStrength >= normal.state.flash
      && normal.state.lightningStrength <= 1, 'thunder strength is bounded and independent of flash decay');
    assert.equal(initialCalm.state.lightningCell, strikeCell, 'reduced motion retains the natural strike identity');
    assert.equal(initialCalm.state.lightningStrength, normal.state.lightningStrength,
      'reduced motion retains the undecayed storm strength');
    const heldStrike = nonFlash(normal.state), heldFlash = normal.state.flash;
    normal.update(0);
    assert.deepEqual(nonFlash(normal.state), heldStrike, 'zero-time updates preserve the cell and strength');
    assert.equal(normal.state.flash, heldFlash, 'publishing a strike does not change its visual envelope');
    livePreference.matches = true;
    live.update(0);
    assert.equal(live.state.flash, 0, 'enabling reduced motion clears an active strike at zero dt');
    assert.deepEqual(nonFlash(live.state), nonFlash(normal.state),
      'comfort changes leave the palette, fog, wind and cloud clocks untouched');
    assert.equal(initialCalm.state.flash, 0, 'an initially reduced-motion storm stays quiet');
    initialCalmPreference.matches = false;
    initialCalm.update(0);
    assert.equal(initialCalm.state.flash, normal.state.flash,
      'disabling reduced motion immediately rejoins the same seeded strike');
    livePreference.matches = false;
    live.update(0);
    assert.equal(live.state.flash, normal.state.flash, 'a round trip preserves the exact strike clock');
    livePreference.matches = true;
    let naturalFlashFrames = 0;
    let firstCellFrames = 0, laterCells = 0, inactiveFrames = 0;
    let lastStrikeCell = strikeCell;
    for (let frame = 0; frame < 30 * 60; frame++) {
      normal.update(dt); live.update(dt); initialCalm.update(dt);
      if (normal.state.flash > 0) naturalFlashFrames++;
      if (normal.state.lightningCell === strikeCell) {
        firstCellFrames++;
        assert.ok(normal.state.lightningStrength > normal.state.flash,
          'the cell strength does not follow the visual decay envelope');
      }
      assert.equal(normal.state.lightningCell >= 0, normal.state.flash > 0,
        'ordinary visuals and strike metadata identify the same active cells');
      if (normal.state.lightningCell < 0) {
        inactiveFrames++;
        assert.equal(normal.state.lightningCell, -1, 'inactive cells have no retained strike identity');
        assert.equal(normal.state.lightningStrength, 0, 'inactive cells retire thunder strength');
      } else if (normal.state.lightningCell !== lastStrikeCell) {
        assert.ok(normal.state.lightningCell > lastStrikeCell, 'later strikes receive distinct increasing cell identities');
        lastStrikeCell = normal.state.lightningCell;
        laterCells++;
      }
      assert.equal(live.state.flash, 0, 'reduced motion keeps later natural strikes quiet');
      assert.equal(initialCalm.state.flash, normal.state.flash, 'restored motion keeps the original flash schedule');
      assert.deepEqual(nonFlash(live.state), nonFlash(normal.state), 'comfort preserves evolving weather');
      assert.deepEqual(nonFlash(initialCalm.state), nonFlash(normal.state), 'restoring motion preserves evolving weather');
    }
    assert.ok(naturalFlashFrames > 0, 'the follow-up window exercises actual lightning');
    assert.ok(firstCellFrames > 1, 'a strike retains its identity over multiple visual decay frames');
    assert.ok(inactiveFrames > 0 && laterCells > 0, 'the schedule retires a cell before a later natural strike');
    assert.equal(queries, 3, 'each weather retains one query without creating more during updates');

    // Older hosts without the preference API retain ordinary weather.
    delete window.matchMedia;
    const fallback = createWeather(THREE);
    window.matchMedia = () => normalPreference;
    const reference = createWeather(THREE);
    fallback.update(strikeTime); reference.update(strikeTime);
    assert.ok(reference.state.flash > 0.5, 'fallback comparison lands on a natural strike');
    assert.equal(fallback.state.flash, reference.state.flash, 'missing matchMedia preserves lightning');
    assert.deepEqual(nonFlash(fallback.state), nonFlash(reference.state), 'missing matchMedia preserves weather');
  } finally {
    window.matchMedia = previousMatchMedia;
    setWorldSeed(previousSeed);
  }
}

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

// Once a camera heading exists, the shadow box is centred half a box ahead of
// the rider along it — on the forest in view rather than the slope behind the
// lens — and on the ground there rather than at the rider's height.
{
  const { heightAt } = await import('../js/terrain.js');
  const leadSky = createSky(TestTHREE);
  const key = leadSky.lights.children.find(object => object.isDirectionalLight);
  const lens = new THREE.PerspectiveCamera(RENDER.fov, 16 / 9, RENDER.near, RENDER.far);
  const at = new THREE.Vector3(0, heightAt(0, -600) + 1, -600);
  lens.position.set(at.x, at.y + 3, at.z + 6);
  lens.lookAt(at.x, at.y - 8, at.z - 60);
  leadSky.update(at, w, 1 / 60);
  leadSky.project(lens);
  leadSky.update(at, w, 1 / 60);
  leadSky.lights.updateMatrixWorld(true);
  const target = key.target.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(target.x - at.x) < 0.5 && Math.abs(target.z - (at.z - 90)) < 0.5,
    `the shadow box leads the camera heading: ${target.toArray()}`);
  const fall = heightAt(at.x, at.z - 90) - heightAt(at.x, at.z);
  assert.ok(Math.abs(target.y - (at.y + fall)) < 0.5, 'the led box sits on the slope it covers');
}

// The glint grid is addressed from a camera wrapped on the CPU, so the shader
// never forms a 26 km coordinate (see FRAG_SHEEN_GRADIENTS in shading.js).
{
  const { createShading } = await import('../js/shading.js');
  const shading = createShading(THREE);
  const lens = new THREE.PerspectiveCamera();
  lens.position.set(-12.25, 50, -26031.5);
  shading.update(w, lens, 0);
  close(shading.uniforms.uCamWrap.value.x, 51.75, 'camera x wraps into the glint period');
  close(shading.uniforms.uCamWrap.value.y, 16.5, 'camera z wraps into the glint period');

  /* The rider's own shadow box: built relative to the camera, so a point
     handed over as its offset from the lens lands where the world point
     would. The chest is the box's centre; ground further down the sun's ray
     is deeper, and so shadowed; the pass leaves the sun's map alone. */
  {
    const { createRiderShadow } = await import('../js/riderShadow.js');
    const calls = [];
    const stub = {
      shadowMap: { autoUpdate: true, needsUpdate: true },
      autoClear: true,
      getRenderTarget: () => null,
      setRenderTarget: (t) => calls.push(['target', t]),
      clear: () => calls.push(['clear']),
      render: () => calls.push(['render', stub.shadowMap.autoUpdate, stub.shadowMap.needsUpdate]),
    };
    const pass = createRiderShadow(THREE, stub, shading);
    lens.updateMatrixWorld();
    const root = new THREE.Object3D();
    const feet = new THREE.Vector3(-30, -9000, -26000);
    root.position.copy(feet);
    pass.update(new THREE.Scene(), root, lens, 0.8);
    const toBox = (world) => world.clone().sub(lens.position).applyMatrix4(shading.uniforms.uRiderShadowMatrix.value);
    const chest = toBox(new THREE.Vector3(feet.x, feet.y + 0.9, feet.z));
    assert.ok(Math.abs(chest.x - 0.5) < 1e-3 && Math.abs(chest.y - 0.5) < 1e-3, 'the chest is the box centre');
    const sun = shading.uniforms.uSunDir.value;
    const ground = toBox(new THREE.Vector3(feet.x, feet.y + 0.9, feet.z).addScaledVector(sun, -4));
    assert.ok(Math.abs(ground.x - 0.5) < 1e-3 && ground.z > chest.z, 'down the ray is behind the rider');
    assert.equal(shading.uniforms.uRiderShadowLevel.value, 0.8);
    const drawn = calls.find((c) => c[0] === 'render');
    assert.ok(drawn && drawn[1] === false && drawn[2] === false, 'the pass never spends the sun map');
    assert.ok(stub.shadowMap.autoUpdate === true && stub.shadowMap.needsUpdate === true, 'and hands its flags back');
    // Upside down in a flip, the chest is under the board, and so is the box
    root.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    pass.update(new THREE.Scene(), root, lens, 0.8);
    const flipped = toBox(new THREE.Vector3(feet.x, feet.y - 0.9, feet.z));
    assert.ok(Math.abs(flipped.x - 0.5) < 1e-3 && Math.abs(flipped.y - 0.5) < 1e-3,
      'an inverted chest is still the box centre');
    calls.length = 0;
    pass.update(new THREE.Scene(), root, lens, 0);
    assert.equal(calls.length, 0, 'no pass when the sun casts nothing');
  }

  /* Streamed props dissolve into the backdrop before the window's far edge;
     only materials that ask for it carry the term, it reads the view
     direction after it is declared, and it has its own program key. */
  const streamed = shading.apply(new THREE.MeshLambertMaterial(), { streamFade: true });
  const plain = shading.apply(new THREE.MeshLambertMaterial());
  const compiled = (material) => {
    const shader = { ...THREE.ShaderLib.lambert, uniforms: {} };
    material.onBeforeCompile(shader);
    return shader.fragmentShader;
  };
  const streamedFrag = compiled(streamed);
  assert.ok(streamedFrag.includes('uStreamEdge.x'), 'streamed props fade before the edge');
  assert.ok(streamedFrag.indexOf('vec3 n64Dir') < streamedFrag.indexOf('n64StreamZ'),
    'the stream fade reads the view direction after it is declared');
  assert.ok(!compiled(plain).includes('n64StreamZ'), 'ground and figures do not fade at the edge');
  assert.notEqual(streamed.customProgramCacheKey(), plain.customProgramCacheKey());

  /* The huts' lamps are added after everything that divides the sun's
     shadow back out of the direct light: the snow response, and a
     material's own patch at the end of the light loop, which is how the
     rider's rig light reads whether it stands in shade. */
  const rigged = new THREE.MeshLambertMaterial();
  rigged.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n  // the rig light');
  };
  const riggedFrag = compiled(shading.apply(rigged, { sheen: 1, hutLight: true }));
  const lamp = riggedFrag.indexOf('n64HutLight(vN64View');
  assert.ok(lamp > riggedFrag.indexOf('// the rig light'),
    "the huts' light lands after a material's own light-loop patch");
  assert.ok(lamp > riggedFrag.indexOf('float n64Open'),
    'and after the snow response that recovers the sun shadow');
  assert.match(riggedFrag, /\n\s*#include <aomap_fragment>/,
    'and the include it is spliced ahead of still starts its own line');

  /* The headlamp lights only what it can see. Over a lip that drops 3 m at
     8 m out, the middle column of the pool is dark where the lip hides the
     snow from a lamp 1.9 m up, and lit again once the snow is far enough
     out to be seen past it. */
  {
    const { createHeadlamp, HEADLAMP } = await import('../js/headlamp.js');
    // The rider wears no lamp (HEADLAMP.fitted); its optics are still kept
    // working, so they are checked fitted.
    HEADLAMP.fitted = true;
    const plain = document.createElement;
    document.createElement = () => ({ getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
    }) });
    const head = new THREE.Object3D();
    head.position.set(0, 1.7, 0);
    const headlamp = createHeadlamp(THREE, shading, head);
    document.createElement = plain;
    head.updateMatrixWorld(true);
    const rider = {
      vel: new THREE.Vector3(0, 0, -10), heading: new THREE.Vector3(0, 0, -1),
      normal: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0),
      world: { height: (x, z) => (z > -8 ? 0 : -3) },
    };
    headlamp.update({ night: 1, snow: 0 }, 1, rider, lens);
    const geo = headlamp.pool.children[0].geometry;
    for (let k = 4; k < geo.attributes.position.count; k += 9) {
      const d = -geo.attributes.position.getZ(k);
      const lit = geo.attributes.aLit.getX(k);
      if (d < 7 || d > 17) assert.ok(lit > 0.99, `snow the lamp sees at ${d.toFixed(1)} m is lit: ${lit}`);
      else assert.ok(lit < 0.05, `snow behind the lip at ${d.toFixed(1)} m is dark: ${lit}`);
    }
    /* And the beam stops at ground between its last grown stride and its
       reach: a rise from 50 m out fell between the 47 m sample and the
       63 m one, which was already past the end, so the beam ran through. */
    const rise = { ...rider, world: { height: (x, z) => (z > -50 ? -100 : 10) } };
    headlamp.update({ night: 1, snow: 0 }, 1, rise, lens);
    const beam = headlamp.debug();
    assert.ok(beam.hit && Math.abs(beam.distance - 50) < 1 && beam.distance < HEADLAMP.reach,
      `the beam stops at a rise past 47 m: ${beam.distance}`);
    HEADLAMP.fitted = false;
  }

  /* The canopy field: deepest at a trunk, gone past the crown's reach, a
     thicket darker than one tree but never black, direct light taken only as
     the sun's shadows fade, and every texel a fact about the world — a
     redraw from a moved window stores the same value at the same place. */
  const { createCanopy, CANOPY } = await import('../js/canopy.js');
  const canopy = createCanopy(THREE, shading);
  assert.equal(shading.uniforms.uCanopyMap.value, canopy.texture, 'ground reads the drawn field');
  const trees = [
    { x: 10.3, z: -40.6, canopy: 3 },
    { x: -20, z: -60, canopy: 3 }, { x: -18.5, z: -60, canopy: 3 },
    { x: 30, z: -50, canopy: 3, canopyDensity: 0.35 },
    { x: 0, z: -48, r: 1 },   // a rock: no crown, no occlusion
    { x: -40, z: -80, r: 1.76, ao: 2 },   // a boulder, 2 m tall, 2 m to its edge
  ];
  const ahead = new THREE.Vector3(0, 0, -1);
  canopy.update(trees, new THREE.Vector3(0, 0, 0), ahead, 1);
  const trunk = canopy.sample(10.3, -40.6);
  assert.ok(Math.abs(trunk - CANOPY.DEPTH) < 0.03, `a crown hides about half the sky at its trunk: ${trunk}`);
  assert.equal(canopy.sample(10.3 + 3 * CANOPY.REACH + 1, -40.6), 0, 'nothing past the crown reach');
  const pair = canopy.sample(-19.25, -60);
  assert.ok(pair > trunk && pair < 0.9, `two crowns are darker than one and never black: ${pair}`);
  assert.ok(canopy.sample(30, -50) < trunk * 0.5, 'a bare snag hides much less sky');
  assert.equal(canopy.sample(0, -48), 0, 'solids without a crown do not occlude');
  assert.ok(canopy.sample(-37.6, -80) > 0.2, 'a boulder takes the sky from the snow at its foot');
  assert.equal(canopy.sample(-35, -80), 0, 'and from nothing past about its own height out');
  assert.equal(shading.uniforms.uCanopyWin.value.w, 0, 'full sun shadows keep the direct light');
  canopy.update(trees, new THREE.Vector3(0, 0, 0), ahead, 0.25);
  close(shading.uniforms.uCanopyWin.value.w, 0.75, 'faded sun shadows hand the crown the direct light');
  const before = canopy.origin.slice();
  canopy.update(trees, new THREE.Vector3(0, 0, -5), ahead, 1);
  assert.deepEqual(canopy.origin, before, 'a short move reuses the drawn field');
  canopy.update(trees, new THREE.Vector3(3.4, 0, -37.2), ahead, 1);
  assert.notDeepEqual(canopy.origin, before, 'a long move redraws the window');
  assert.ok(Number.isInteger(canopy.origin[0]) && Number.isInteger(canopy.origin[1]),
    'the window sits on the world metre lattice');
  close(canopy.sample(10.3, -40.6), trunk, 'a redraw stores the same value at the same place');
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

/* The modelled range (backdrop.js), read from the real file: once it is in
   it retires the relief shell and the far ribbons at every hour, it hides
   the sun behind its own peaks — the horn stands about eight degrees over
   the horizon seventeen degrees left of the fall line — and it lets a sun
   above them show. Without it (every sky above, whose fetch of a file: URL
   fails) the procedural horizon stands. */
const glb = await readFile(new URL('../assets/models/backdrop/alps.glb', import.meta.url));
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  arrayBuffer: async () => glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
});
const rangeSky = createSky({ ...THREE, TextureLoader: class {
  load(url, ready) { const texture = new THREE.Texture(); ready?.(texture); return texture; }
} });
assert.equal(await rangeSky.backdropReady, true, 'the modelled range loads');
globalThis.fetch = realFetch;
const sectors = [];
rangeSky.group.traverse(object => { if (object.name === 'backdrop-range') sectors.push(object); });
assert.equal(sectors.length, 24, 'the range arrives as its sectors');
for (const mesh of sectors) {
  assert.equal(mesh.material.fog, false);
  assert.ok(mesh.renderOrder > 0 && mesh.renderOrder < 0.7, 'drawn after the ground, before the cone');
}
rangeSky.snapBackdrop();
const disc = rangeSky.group.children.find(object => object.material?.uniforms?.uMoon);
const daylight = { ...modeWeather.check(0.48, 0), cloud: 0 };
const horn = -17 * Math.PI / 180;
for (let i = 0; i < 4; i++) rangeSky.update(skyPosition, { ...daylight, azimuth: horn, elevation: 0.06 }, 1);
assert.equal(disc.material.uniforms.uOpacity.value, 0, 'the horn hides a low sun');
rangeSky.update(skyPosition, { ...daylight, azimuth: horn, elevation: 0.45 }, 0);
assert.ok(disc.material.uniforms.uOpacity.value > 0.9, 'the sun above the peaks remains visible');
const weights = sectors[0].material.uniforms;
const total = [...weights.uSunA.value.toArray(), ...weights.uSunB.value.toArray()].reduce((a, b) => a + b, 0);
assert.ok(Math.abs(total - 1) < 1e-5, 'the sun reads its horizon between two bearings');
for (const tod of [0, 0.09, 0.48, 0.86, 0.95]) {
  const mode = modeWeather.check(tod, 0);
  rangeSky.update(skyPosition, mode, 1 / 60);
  sky.update(skyPosition, mode, 1 / 60);
  assert.ok(rangeSky.group.children.filter(object => object.name === 'far-range')
    .every(object => !object.visible), 'the modelled range retires the fallback ribbons at every hour');
  assert.ok(sky.group.children.filter(object => object.name === 'far-range')
    .every(object => object.visible), 'without the model the procedural skyline stands');
  assert.equal(rangeSky.group.getObjectByName('mid-distance massifs').visible, false,
    'the modelled range retires the relief shell');
  assert.equal(sky.group.getObjectByName('mid-distance massifs').visible, true,
    'without the model the relief shell stands');
  assert.equal(rangeSky.group.getObjectByName('backdrop').visible, true, 'the range stands at every hour');
}
// A storm takes it into the same white as everything else.
rangeSky.update(skyPosition, modeWeather.check(0.48, 1), 1 / 60);
assert.equal(sectors[0].material.uniforms.uWhiteout.value, 1, 'a whiteout takes the range');
// Long travel moves nothing of it: the parallax is a bounded uniform.
for (const distance of [0, 12000, 1000000]) {
  rangeSky.update(new THREE.Vector3(100, -distance * 0.3, -distance), daylight, 1 / 60);
  assert.ok(Math.abs(sectors[0].material.uniforms.uLateral.value) <= 140, 'the wander is bounded');
  assert.ok(sectors[0].position.equals(new THREE.Vector3()), 'the range is never moved');
}

// Count actual render submissions and reject texture/attachment feedback.
let target = null, submissions = 0, lastComposite = null, canvasSizes = 0, clears = 0;
let worldTarget = null;
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
    if (target?.depthBuffer) worldTarget = target;
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
// main.js starts the frame's statistics before the probe and rider-shadow
// passes, then hands the world to retro.
const renderFrame = () => {
  renderer.info.reset();
  retro.render(scene, camera);
};
renderFrame();
const fullPasses = submissions;
const fullWidth = retro.width;
assert.equal(fullPasses, 8, 'world, tight bloom, wide bloom and composite');
assert.equal(worldTarget.depthBuffer, true, 'world rendering retains depth testing');
assert.equal(worldTarget.resolveDepthBuffer, false, 'postprocessing does not resolve unused world depth');
assert.equal(worldTarget.depthTexture, null, 'no downstream pass samples world depth');
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
// A GPU too slow even at the floor: the frame shrinks with the pixel count
// but never gets back under the 55 Hz line.
for (let i = 0; i < 600; i++) {
  const dt = 0.012 + 0.03 * retro.scale * retro.scale;
  retro.updatePerformance(dt);
  retro.updateEffects(dt);
}
assert.equal(retro.scale, RENDER.minScale, 'sustained pressure reaches the quality floor');
assert.ok(retro.width < fullWidth);
assert.equal(retro.displayWidth, 1280, 'final output remains native size');
assert.equal(canvasSizes, 1, 'governor does not reallocate the visible canvas');
for (let i = 0; i < 120; i++) retro.updateEffects(1 / 60);
renderFrame();
assert.equal(submissions, fullPasses - 3, 'settled low quality removes exactly the three halo passes');
assert.ok(lastComposite.uBloomWide.value < 0.001, 'halo fades before its passes stop');
for (let i = 0; i < 90 * 80; i++) { retro.updatePerformance(1 / 90); retro.updateEffects(1 / 90); }
assert.equal(retro.scale, RENDER.maxScale, 'sustained headroom recovers full resolution');
renderFrame();
assert.equal(submissions, fullPasses, 'wide halo returns with recovered quality');
assert.equal(retro.width, fullWidth);
assert.equal(canvasSizes, 1);
retro.setSun(0.5, 0.8, 1);
renderFrame();
assert.equal(submissions, fullPasses + 1);
assert.equal(clears, 1);
assert.equal(lastComposite.uRays.value, GRADE.rays, 'visible rays retain their authored strength');
retro.setSun(0.5, 0.8, 0);
renderFrame();
assert.equal(clears, 2, 'sunset clears the former ray image once');
assert.equal(lastComposite.uRays.value, 0, 'ray sampling stops on the same frame as the light pass');
renderFrame();
assert.equal(clears, 1, 'settled darkness stops clearing the unused ray target');
retro.fade(0.6);
for (let i = 0; i < 120; i++) retro.updateEffects(1 / 60, false);
assert.equal(retro.animating, false, 'paused fade settles so rendering can sleep');
retro.fade(1);
for (let i = 0; i < 120; i++) retro.updateEffects(1 / 60);
assert.equal(retro.animating, false, 'resume fade settles normally');

// Preference changes affect an already constructed post stack. Comfort keeps
// the image sharp at speed and still gives a brief, bounded crash indication.
retro.setSpeed(96);
const normalBlur = retro.blur, normalSplit = retro.aberration;
assert.ok(normalBlur > 0 && normalSplit > 0, 'normal riding retains its speed effects');
retro.crash(1);
assert.equal(retro.fallEffect, 1, 'normal impacts retain their authored strength');
motionPreference.matches = true;
retro.setSpeed(96); retro.updateEffects(1 / 60);
assert.equal(retro.blur, 0, 'comfort removes radial motion blur');
assert.equal(retro.aberration, 0, 'comfort removes the moving color split');
assert.ok(retro.fallEffect > 0 && retro.fallEffect <= 0.62, 'a live preference change restrains a pending crash');
for (let i = 0; i < 240; i++) retro.updateEffects(1 / 60, false);
assert.equal(retro.fallEffect, 0, 'comfort crash indication clears even while paused');
retro.crash(1);
close(retro.fallEffect, 0.62, 'new comfort impacts remain legible and restrained');
motionPreference.matches = false;
retro.setSpeed(96);
close(retro.blur, normalBlur, 'normal blur returns without rebuilding the post stack');
close(retro.aberration, normalSplit, 'normal color split returns without rebuilding');
retro.setSpeed(0);
for (let i = 0; i < 240; i++) retro.updateEffects(1 / 60, false);

// The shared restart path must clear a real impact along with its rider.
// Execute the shipped handler and restart with the actual physics/post stack;
// unrelated streamed world systems only need their reset hooks here.
{
  const { default: vm } = await import('node:vm');
  const { Rider } = await import('../js/rider.js');
  const { RIDER, SCORE } = await import('../js/config.js');
  const mainSource = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
  const section = (from, to) => {
    const start = mainSource.indexOf(from), end = mainSource.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `production restart fixture contains ${from}`);
    return mainSource.slice(start, end);
  };
  const handlers = new vm.Script(section('function restart(fullReset', '\nfunction newMountain(')
    + section("rider.on('fall',", "\nrider.on('impact',"));
  const fixture = post => {
    const noop = () => {};
    const resettable = { reset: noop, clear: noop };
    const world = { height: () => 0, canStall: () => false };
    const rider = new Rider(THREE, world);
    const game = { mode: 'playing', score: 900, best: 900, combo: 6, flow: 0.5,
      flowHold: 3, recentTricks: [], discoveredGrabs: new Set() };
    const context = vm.createContext({ rider, game, world, retro: post, RIDER, SCORE,
      lastPassedGate: { x: 4, z: -153 }, hadStep: true, rearmProps: false, chapterCheck: 0,
      guideAt: () => 0, nearestCenter: () => 0, corridorHalfAt: () => 24, chapterNameAt: () => 'Piste',
      chase: { ...resettable, kick: noop }, spray: { ...resettable, burst: noop },
      trail: resettable, wildlife: resettable, huts: resettable, mountainLife: resettable,
      model: resettable, shading: resettable, terrain: resettable,
      props: { ...resettable, reopenGatesBelow: noop },
      hud: { resetScore: noop, clearBanner: noop, banner: noop },
      audio: { crash: noop }, input: { rumble: noop }, syncCombo: noop,
    });
    handlers.runInContext(context);
    return { rider, game, restart: () => context.restart() };
  };
  const previousBuffer = { ...RENDER.buffer };
  const quality = post => [post.width, post.height, post.scale, post.samples, post.frameMs];
  try {
    for (const reduced of [false, true]) for (const elapsed of [0, 0.15]) {
      motionPreference.matches = reduced;
      const post = createRetro(THREE, renderer);
      post.setSize(640, 360);
      for (let i = 0; i < 120; i++) post.updatePerformance(1 / 50);
      assert.ok(post.scale < RENDER.maxScale, 'restart preserves an already adapted quality level');
      post.fade(0.42); post.updateEffects(0.02, false);
      const run = fixture(post);
      run.rider.pos.set(17, 0, -300); run.rider.vel.set(0, 0, -40); run.rider.grace = 0;
      assert.equal(run.rider.strike(0, 1, 1), 'fall', 'a real heavy contact creates the pre-restart crash');
      for (let i = 0; i < elapsed * 60; i++) post.updateEffects(1 / 60, false);
      assert.ok(post.fallEffect > 0.5, 'the checkpoint is requested while its old crash is still conspicuous');
      post.render(scene, camera);
      const fadeBefore = lastComposite.uFade.value, qualityBefore = quality(post), sizesBefore = canvasSizes;
      run.restart();
      assert.equal(run.rider.state, 'ride', 'the actual restart stands the rider back up');
      assert.deepEqual(run.rider.pos.toArray(), [4, 0, -153], 'the fresh rider returns to its checkpoint');
      assert.equal(run.game.score, 0, 'the same call starts the fresh attempt');
      assert.equal(post.fallEffect, 0, 'the first fresh-spawn frame has no old crash overlay, even at zero dt');
      post.render(scene, camera);
      assert.equal(lastComposite.uFall.value, 0, 'the drawn composite sees the clear lens immediately');
      assert.equal(lastComposite.uFade.value, fadeBefore, 'restart does not reset the in-flight pause fade');
      assert.deepEqual(quality(post), qualityBefore, 'restart preserves resolution, samples and governor history');
      assert.equal(canvasSizes, sizesBefore, 'clearing the impact does not resize the output');
      run.restart();
      assert.equal(post.fallEffect, 0, 'an immediate repeated restart stays clear');

      // A softer subsequent fall must match a pristine post stack, including
      // its shorter hold; a forgotten old hold would delay this new decay.
      const freshPost = createRetro(THREE, renderer), fresh = fixture(freshPost);
      run.rider.fall('land', RIDER.softImpact);
      fresh.rider.fall('land', RIDER.softImpact);
      for (const dt of [0, 0.08, 0.01]) {
        post.updateEffects(dt, false); freshPost.updateEffects(dt, false);
        assert.ok(post.fallEffect > 0, 'a new fall still produces feedback after restarting');
        assert.equal(post.fallEffect, freshPost.fallEffect, 'the next crash has no inherited strength or hold');
      }
      run.restart();
      for (let i = 0; i < 120; i++) post.updateEffects(1 / 60, false);
      post.render(scene, camera);
      assert.equal(lastComposite.uFade.value, 0.42, 'the original pause fade still reaches its target');
      assert.equal(post.fallEffect, 0, 'old crash feedback never returns on later frames');
      assert.equal(post.animating, false, 'the cleared, settled pause can sleep');
      post.fade(1); post.updateEffects(0.1); post.render(scene, camera);
      assert.ok(lastComposite.uFade.value > 0.42 && lastComposite.uFade.value < 1,
        'the normal resume fade still advances after restarting');
    }
  } finally {
    motionPreference.matches = false;
    Object.assign(RENDER.buffer, previousBuffer);
  }
}

// A capped frame rate is not a slow GPU. Walking down buys nothing, so the
// walk is undone at the floor and not retried while the cap holds.
{
  const capped = createRetro(THREE, renderer);
  capped.setSize(1280, 720);
  for (let i = 0; i < 30 * 30; i++) capped.updatePerformance(1 / 30);
  assert.equal(capped.scale, RENDER.maxScale, 'a 30 fps cap ends at full resolution');
  // …and when the cap lifts onto a GPU that cannot hold 57 Hz at full scale,
  // the walk down is taken after all.
  for (let i = 0; i < 60 * 20; i++) {
    capped.updatePerformance(Math.max(1 / 60, (4 + 16 * capped.scale * capped.scale) / 1000));
  }
  assert.ok(capped.scale < RENDER.maxScale, 'a cap lifting onto a slow GPU walks down again');
  // Near the budget, a scale that fails again waits longer before its next
  // try instead of costing a second of dropped frames every few seconds.
  const edge = createRetro(THREE, renderer);
  edge.setSize(1280, 720);
  let resizes = 0;
  for (let t = 0; t < 600;) {
    const dt = Math.max(1 / 60, (3 + 15.2 * edge.scale * edge.scale) / 1000);
    t += dt;
    if (edge.updatePerformance(dt)) resizes++;
  }
  assert.ok(resizes < 40, `near the budget the scale settles (${resizes} resizes in ten minutes)`);
}

// Complete-frame timer ownership and recovery: gpu-timing-check.mjs.

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
{
  const { getWorldSeed, setWorldSeed } = await import('../js/noise.js');
  const previousSeed = getWorldSeed();
  try {
    setWorldSeed('ALPEN01');
    const clearWeather = createWeather(THREE);
    const snowfall = createSnowfall(THREE), snowCamera = camera.clone();
    const geo = snowfall.points.geometry, attrs = geo.attributes;
    const snowWind = new THREE.Vector3();
    const apply = (intensity, dt = 1 / 60) => {
      snowfall.setIntensity(intensity);
      snowfall.update(dt, snowCamera, snowWind);
    };
    const clear = () => {
      assert.equal(geo.drawRange.count, 0, 'clear air submits no snow or spindrift');
      assert.equal(snowfall.points.visible, false, 'clear air skips the particle draw');
      assert.ok(attrs.aAlpha.array.every(value => value === 0), 'clear air retires every old grain');
    };
    const versions = () => Object.values(attrs).map(attr => attr.version);
    assert.equal(clearWeather.state.snow, 0, 'the actual seeded mountain starts without snowfall');
    apply(clearWeather.state.snow);
    clear();
    const settledVersions = versions();
    for (let frame = 0; frame < 60; frame++) {
      const natural = clearWeather.update(1 / 60);
      assert.equal(natural.snow, 0);
      snowWind.set(natural.windX, 0, natural.windZ);
      apply(natural.snow);
    }
    assert.deepEqual(versions(), settledVersions, 'stable clear air rewrites no particle attributes');
    apply(0.003);
    clear();
    assert.deepEqual(versions(), settledVersions, 'sub-step weather noise does not wake a clear sky');

    apply(0.007);
    assert.ok(geo.drawRange.count > 0 && geo.drawRange.count < SNOW.count / 20,
      'the first arriving flurry introduces only a few grains');
    assert.equal(snowfall.points.visible, true);
    const firstAlpha = Math.max(...attrs.aAlpha.array);
    assert.ok(firstAlpha > 0 && firstAlpha < 0.02, 'the first grains fade in without an opaque pop');
    apply(0.0005); // Accepted from 0.007, but less than one rebuild step from zero.
    assert.ok(geo.drawRange.count > 0 && attrs.aAlpha.array.some(value => value > 0));
    apply(0, 0);
    clear();

    apply(1);
    assert.equal(geo.drawRange.count, attrs.position.count,
      'full weather retains every authored flake and drift grain');
    apply(0, 0);
    clear();
    // Travel while hidden, then wake without advancing time: the old storm
    // must not leak its alpha table or leave the flakes at the old camera.
    snowCamera.position.set(1250, -2000, -10500);
    snowfall.update(0, snowCamera, snowWind);
    apply(0.1, 0);
    assert.equal(snowfall.points.visible, true, 'a cleared pool wakes on fresh snowfall');
    assert.ok(geo.drawRange.count > 0 && geo.drawRange.count < SNOW.count / 2,
      'a real flurry skips unused storm capacity');
    assert.ok(attrs.aAlpha.array.some(value => value > 0));
    assert.ok(attrs.aAlpha.array.subarray(geo.drawRange.count).every(value => value === 0),
      'returning flurries retain no storm or spindrift alpha');
    for (let i = 0; i < geo.drawRange.count; i++) for (let axis = 0; axis < 3; axis++) {
      const world = attrs.position.array[i * 3 + axis] + snowfall.points.position.getComponent(axis);
      assert.ok(Math.abs(world - snowCamera.position.getComponent(axis)) <= SNOW.box / 2,
        'returning snow surrounds the current camera after a hidden rebase');
    }
  } finally {
    setWorldSeed(previousSeed);
  }
}
const streaks = createStreaks(THREE);
streaks.update(1 / 60, camera, wind, 0, wind);
assert.equal(streaks.lines.visible, false, 'slow riding draws no invisible speed ribbons');
streaks.update(1 / 60, camera, new THREE.Vector3(0, 0, -STREAKS.full), STREAKS.full, wind);
assert.equal(streaks.lines.geometry.drawRange.count, STREAKS.count * 6);
assert.equal(streaks.lines.visible, true);

// Smoke owns a world-space size, so its CPU scale is half the live world
// framebuffer height. The render camera supplies the remaining projection
// factor in the actual vertex shader (covered by the native browser check).
{
  const { createHuts, HUTS } = await import('../js/huts.js');
  const { createShading } = await import('../js/shading.js');
  const { getWorldSeed, setWorldSeed } = await import('../js/noise.js');
  const { allTracked } = await import('../js/loading.js');
  await allTracked();
  const hutURL = new URL('../assets/models/huts/mountain-hut.glb', import.meta.url);
  const hutBytes = await readFile(hutURL);
  const previousFetch = globalThis.fetch, previousDpr = window.devicePixelRatio;
  const previousBuffer = { ...RENDER.buffer }, previousCap = getPointSizeCap();
  const previousFov = RENDER.fov;
  const previousSeed = getWorldSeed();
  const smokePost = createRetro(THREE, renderer);
  try {
    globalThis.fetch = async url => url === hutURL.href ? {
      ok: true,
      arrayBuffer: async () => hutBytes.buffer.slice(hutBytes.byteOffset,
        hutBytes.byteOffset + hutBytes.byteLength),
    } : previousFetch(url);
    window.devicePixelRatio = 1;
    smokePost.setSize(640, 360);
    setWorldSeed('1EE9566');
    const hutShading = createShading(THREE);
    const huts = createHuts(TestTHREE, hutShading);
    await allTracked();
    const uniforms = huts.smoke.material.uniforms;
    assert.ok(huts.smoke.isPoints && huts.group.children.includes(huts.smoke));
    assert.equal(huts.smoke.visible, false, 'an empty smoke pool starts without a draw');
    close(uniforms.uScale.value, 180, 'smoke starts with half its actual target height');
    const rider = { pos: new THREE.Vector3(0, 0, -600), state: 'ride', speed: 12, grounded: true };
    const update = () => huts.update(0, rider, w);
    setPointSizeCap(1024);
    update();
    close(uniforms.uScale.value, 180, 'smoke updates keep projection in the render camera');
    close(uniforms.uMaxSize.value, 122.4, 'ordinary smoke overdraw stays within 34% of the target height');

    window.devicePixelRatio = 4;
    const dense = smokePost.setSize(640, 360);
    assert.equal(dense.dpr, RENDER.maxPixelRatio, 'the real post stack caps device pixels');
    assert.equal(dense.height, 720);
    update();
    close(uniforms.uScale.value, 360, 'smoke follows capped framebuffer pixels without a second DPR factor');
    smokePost.setSize(1000, 360);
    update();
    close(uniforms.uScale.value, 360, 'a wider target does not enlarge a smoke puff');

    setPointSizeCap(64);
    update();
    close(uniforms.uMaxSize.value, 64, 'the native point limit wins on a tall target');
    smokePost.setSize(320, 80);
    update();
    close(uniforms.uScale.value, 80, 'smoke responds immediately to a shorter live target');
    close(uniforms.uMaxSize.value, 54.4, 'the framebuffer overdraw limit wins on a short target');

    RENDER.fov = 43;
    update();
    close(uniforms.uScale.value, 80, 'CPU smoke scale does not bake in the configured chase lens');

    // Exercise the real emitter and lifetime census beside a generated hut.
    // Empty pools sleep through captures; a live plume keeps its final fade.
    assert.equal(huts.smoke.visible, false, 'zero-time updates do not wake empty smoke');
    for (let z = 0; z > -5000 && !huts.huts.length; z -= HUTS.step) {
      rider.pos.z = z;
      update();
    }
    assert.ok(huts.huts.length, 'the seeded mountain contains an actual hut');
    const hut = huts.huts[0];
    const chimney = new THREE.Vector3(hut.x, hut.y, hut.z);
    rider.pos.copy(chimney);
    update();
    const alpha = huts.smoke.geometry.attributes.aAlpha.array;
    const positions = huts.smoke.geometry.attributes.position.array;
    const emit = () => {
      for (let frame = 0; frame < 4 && !alpha.some(value => value > 0); frame++) {
        huts.update(0.05, rider, w);
      }
      assert.ok(alpha.some(value => value > 0), 'the real chimney emits visible puffs');
      assert.equal(huts.smoke.visible, true, 'the first emission draws on its own frame');
    };
    emit();
    // Follow main's actual order: huts update first, shading resolves the
    // current sky afterward, and only then is smoke drawn. A private haze
    // copy stayed dark for the whole strike despite the surrounding fog.
    const smokeWeather = createWeather(THREE);
    const smokeCamera = new THREE.PerspectiveCamera(72, 16 / 9, 0.1, 1500);
    const sourceSnapshot = state => Object.fromEntries(Object.entries(state)
      .map(([key, value]) => [key, value?.isColor ? value.toArray() : value]));
    const smokeGeometry = huts.smoke.geometry;
    const smokeMaterial = huts.smoke.material;
    const smokeCounts = Object.fromEntries(Object.entries(smokeGeometry.attributes)
      .map(([key, value]) => [key, value.count]));
    for (const tod of [0.45, 0.79, 0.02]) {
      smokeWeather.pin(tod);
      smokeWeather.update(12);
      const palette = smokeWeather.state;
      for (const flash of [0, 0.85, 0]) {
        palette.flash = flash;
        const before = sourceSnapshot(palette);
        const previousHaze = hutShading.uniforms.uSkyHaze.value.clone();
        huts.update(0, rider, palette);
        assert.ok(hutShading.uniforms.uSkyHaze.value.equals(previousHaze),
          'hut updates leave the shared atmosphere for shading to resolve');
        hutShading.update(palette, smokeCamera, 0);
        const drawnHaze = uniforms.uFog.value;
        assert.ok(drawnHaze.equals(hutShading.uniforms.uSkyHaze.value),
          'smoke follows the final atmosphere on the same draw frame');
        if (flash) {
          assert.ok(luma(drawnHaze) > luma(palette.haze) + 0.05,
            'a live strike lights smoke fog alongside the surrounding world');
        } else {
          assert.ok(drawnHaze.equals(palette.haze),
            'no-flash frames, including the frame after a strike, restore the source haze');
        }
        assert.deepEqual(sourceSnapshot(palette), before, 'smoke and shading never whiten source weather');
        assert.equal(huts.smoke.visible, true, 'palette updates keep the emitted plume visible');
        assert.equal(huts.smoke.geometry, smokeGeometry, 'palette changes reuse smoke geometry');
        assert.equal(huts.smoke.material, smokeMaterial, 'palette changes reuse the existing smoke pass');
        assert.deepEqual(Object.fromEntries(Object.entries(smokeGeometry.attributes)
          .map(([key, value]) => [key, value.count])), smokeCounts, 'the smoke pool budget is unchanged');
      }
    }
    assert.equal(uniforms.uFog, hutShading.uniforms.uSkyHaze, 'smoke reuses the shared resolved haze uniform');
    const heldPosition = positions.slice(), heldAlpha = alpha.slice();
    update();
    assert.equal(huts.smoke.visible, true, 'a zero-time capture keeps live smoke visible');
    assert.deepEqual(positions, heldPosition, 'a capture does not move the plume');
    assert.deepEqual(alpha, heldAlpha, 'a capture does not advance its fade');
    rider.pos.x += HUTS.smoke.range * 4;
    for (let frame = 0; frame < Math.ceil(HUTS.smoke.life * 1.3 / 0.05) + 1; frame++) {
      huts.update(0.05, rider, w);
      assert.equal(huts.smoke.visible, alpha.some(value => value > 0),
        'smoke draws through its fade and hides on the final expiration frame');
      if (!huts.smoke.visible) break;
    }
    assert.equal(huts.smoke.visible, false, 'the expired plume stops submitting');
    update();
    assert.equal(huts.smoke.visible, false, 'an idle capture leaves expired smoke asleep');
    rider.pos.copy(chimney);
    emit();
    huts.reset();
    assert.equal(huts.smoke.visible, false, 'reset hides a live plume immediately');
    assert.ok(alpha.every(value => value === 0), 'reset clears every old puff');
    update();
    emit();
  } finally {
    await allTracked();
    globalThis.fetch = previousFetch;
    window.devicePixelRatio = previousDpr;
    Object.assign(RENDER.buffer, previousBuffer);
    RENDER.fov = previousFov;
    setWorldSeed(previousSeed);
    setPointSizeCap(previousCap);
  }
}

{
  const oldExtensions = renderer.extensions, oldElement = renderer.domElement;
  renderer.extensions = { has: () => false, get: () => null };
  renderer.domElement = new EventTarget();
  try {
    const paused = createRetro(THREE, renderer); paused.setSize(320, 180);
    renderer.info.reset(); assert.equal(paused.renderComposite(), false); assert.equal(submissions, 0);
    paused.render(scene, camera);
    paused.fade(.42); paused.crash(.6); paused.updateEffects(.1, false);
    renderer.info.reset(); assert.equal(paused.renderComposite(), true);
    assert.equal(submissions, 1, 'paused fade only submits final composite'); assert.equal(clears, 0);
    assert.equal(target, null); assert.equal(renderer.autoClear, true);
    assert(lastComposite.uFade.value < 1 && lastComposite.uFade.value > .42);
    assert(lastComposite.uFall.value > 0);
    renderer.autoClear = false; renderer.info.reset(); assert(paused.renderComposite());
    assert.equal(renderer.autoClear, false); renderer.autoClear = true;
    paused.setSize(321, 180); renderer.info.reset();
    assert.equal(paused.renderComposite(), false); assert.equal(submissions, 0);
    paused.render(scene, camera); paused.setSun(.4, .6, .7); renderer.info.reset();
    assert.equal(paused.renderComposite(), false); assert.equal(submissions, 0);
    paused.render(scene, camera);
    const draw = renderer.render;
    try {
      renderer.render = () => { throw Error('cached post failure'); };
      assert.throws(() => paused.renderComposite(), /cached post failure/);
      assert.equal(target, null); assert.equal(renderer.autoClear, true);
    } finally { renderer.render = draw; }
    renderer.info.reset();
    assert.equal(paused.renderComposite(), false, 'failed cached draw invalidates'); assert.equal(submissions, 0);
    paused.render(scene, camera);
    renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    renderer.info.reset();
    assert.equal(paused.renderComposite(), false, 'context restoration invalidates'); assert.equal(submissions, 0);
    const drive = (done, dt) => {
      for (let i = 0; i < 20000 && !done(); i++) paused.updatePerformance(typeof dt === 'function' ? dt() : dt);
      assert(done());
    };
    drive(() => paused.scale <= .7, () => .012 + .03 * paused.scale * paused.scale);
    paused.updateEffects(2, false); paused.render(scene, camera);
    drive(() => paused.scale > .75, 1 / 90); paused.render(scene, camera);
    paused.updateEffects(.05, false); renderer.info.reset();
    assert.equal(paused.renderComposite(), false, 'new halo needs its current wide image'); assert.equal(submissions, 0);
    paused.render(scene, camera); renderer.info.reset(); assert(paused.renderComposite()); assert.equal(submissions, 1);
  } finally { renderer.autoClear = true; renderer.extensions = oldExtensions; renderer.domElement = oldElement; }
}

console.log(`Graphics checks passed: ${geometries.size} geometries, ${weatherCases} weather cases; shadows ${shadowRates.join(', ')}; stable backdrop and ${fullPasses} → ${fullPasses - 3} → ${fullPasses} post passes.`);
