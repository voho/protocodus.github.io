// Run with: node fun/hedgerow/tests/modes-check.mjs
// Mode keys are edges, day/night reuses the scene, and exposure never applies
// a light reading captured before the mode changed (the eye stays on the GPU).
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createInput } = await import('../js/input.js');
const { createLighting } = await import('../js/lights.js');
const { createSky, DAY_FOG_COLOR } = await import('../js/sky.js');
const { createAdaptation } = await import('../js/adapt.js');
const { createGrade } = await import('../js/post.js');

{
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  const canvas = new EventTarget();
  const input = createInput(canvas);
  const key = (type, code, repeat = false) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { code, repeat });
    window.dispatchEvent(e);
  };
  for (const code of ['KeyI', 'KeyO']) {
    key('keydown', code);
    assert.equal(input.pressed(code), false, 'menu keys do not become gameplay presses');
    key('keyup', code);
    input.endFrame();
    input.enable(true);
    key('keydown', code);
    assert.equal(input.pressed(code), true, 'the first keydown is an edge');
    input.endFrame();
    for (let frame = 0; frame < 20; frame++) {
      key('keydown', code, true);
      assert.equal(input.held(code), true);
      assert.equal(input.pressed(code), false, 'holding a toggle key does not toggle every frame');
      input.endFrame();
    }
    key('keyup', code);
    key('keydown', code);
    assert.equal(input.pressed(code), true, 'release and press creates the next edge');
    key('keyup', code);
    input.endFrame();
    input.enable(false);
  }
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
}

{
  const scene = new THREE.Scene();
  const lights = createLighting(scene, { pool: 8, shadows: true, second: true });
  const camera = new THREE.Vector3(12, 2, 24);
  lights.addStatic({ x: 12, y: 3, z: 26, intensity: 8, range: 10, shadow: true });
  const update = () => lights.update(0, 10, camera, 0);
  const state = () => [lights.hemi, lights.key, lights.rim].map((light) => ({
    color: light.color.toArray(), ground: light.groundColor?.toArray(),
    intensity: light.intensity, position: light.position.toArray(),
  }));
  const brightness = (light) => light.intensity *
    (light.color.r * 0.2126 + light.color.g * 0.7152 + light.color.b * 0.0722);
  update();
  const night = state(), nightBrightness = brightness(lights.hemi);
  const objects = scene.children.slice(), shadows = objects.map((object) => object.castShadow);
  for (let i = 0; i < 20; i++) {
    lights.setDaylight(true);
    update();
    assert.ok(brightness(lights.hemi) > nightBrightness, 'daylight lifts diffuse illumination');
    assert.ok(lights.key.position.y > night[1].position[1], 'daylight comes from higher in the sky');
    lights.setDaylight(false);
    update();
    assert.deepEqual(state(), night, 'returning to night restores its lighting exactly');
  }
  assert.deepEqual(scene.children, objects, 'toggles reuse all existing scene objects');
  assert.deepEqual(scene.children.map((object) => object.castShadow), shadows,
    'toggles keep the same light and shadow configuration');
}

{
  const sky = createSky({ zenith: '#152535', horizon: '#465666', glow: '#876543', fog: '#334455' });
  const { mesh, uniforms } = sky;
  const geometry = mesh.geometry, material = mesh.material, version = material.version;
  const palette = () => ['uZenith', 'uHorizon', 'uGlow', 'uFog'].map((key) => uniforms[key].value.toArray());
  const night = palette(), front = uniforms.uFront.value, glow = uniforms.uNightGlow.value;
  for (let i = 0; i < 20; i++) {
    sky.setDaylight(true);
    assert.equal(uniforms.uFog.value.getHexString(), new THREE.Color(DAY_FOG_COLOR).getHexString());
    assert.equal(uniforms.uFront.value, 0, 'searchlights are hidden in daylight');
    assert.ok(uniforms.uNightGlow.value < glow, 'fire-lit clouds recede in daylight');
    sky.setDaylight(false);
    assert.deepEqual(palette(), night, 'custom night colors survive a day/night roundtrip');
    assert.equal(uniforms.uFront.value, front);
    assert.equal(uniforms.uNightGlow.value, glow);
  }
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, material);
  assert.equal(material.version, version, 'a mode change does not request shader recompilation');
  geometry.dispose(); material.dispose();
}

{
  const adapt = createAdaptation(), grade = createGrade();
  grade.adaptation = adapt;
  adapt.metering = true;
  const open = adapt.texture, draws = [];
  const renderer = {
    toneMappingExposure: 1.7,
    setRenderTarget() {},
    render(object) {
      draws.push(Object.fromEntries(Object.entries(object.material.uniforms).map(([name, u]) => [name, u.value])));
    },
    readRenderTargetPixels() { throw new Error('gameplay exposure must stay on the GPU'); },
    readRenderTargetPixelsAsync() { throw new Error('gameplay exposure must stay on the GPU'); },
  };
  const render = () => adapt.render(renderer, null, { texture: null });
  for (let frame = 0; frame < 6; frame++) { adapt.update(1 / 60, renderer); render(); }
  assert.notEqual(adapt.texture, open, 'after metering, the grade reads the GPU eye state');
  adapt.factor = 0.4;
  adapt.update(0.1, renderer, 1); // reset must also clear this old mode's lightning hold
  render();

  for (const [base, ref] of [[1.15, -1.5], [1.7, -5]]) {
    adapt.reset({ base, ref });
    assert.equal(adapt.texture, open, 'a switch immediately disconnects the old mode texture');
    assert.equal(adapt.factor, 1);
    assert.ok(Number.isNaN(adapt.metered), 'old diagnostic luminance is discarded');
    grade.render(renderer, null, { texture: null });
    assert.equal(draws.at(-1).tAdapt, open, 'the grade uses the reset eye before the next sample');
    assert.equal(grade.uniforms.uGrain, undefined, 'GPU exposure does not restore film grain');
    adapt.update(1 / 60, renderer);
    render();
    const first = draws.at(-1);
    assert.equal(first.tPrev, open, 'the new GPU state starts from the open eye');
    assert.equal(first.uReset, 2, 'factor, target, and metering history are all reset');
    assert.equal(first.uResetFactor, 1, 'a previous forced factor does not survive the switch');
    assert.equal(first.uRef, ref, 'the GPU receives the chosen mode reference');
    assert.equal(first.uRetarget, 1, 'an old lightning hold does not survive the switch');
    assert.equal(first.uFresh, 0, 'the metering cadence restarts');
    for (let frame = 1; frame < 6; frame++) { adapt.update(1 / 60, renderer); render(); }
    assert.equal(draws.at(-1).uFresh, 1, 'fresh mode metering resumes on the sixth frame');
    assert.equal(adapt.params.base, base);
  }
  assert.equal(renderer.toneMappingExposure, 1.7, 'GPU adaptation does not overwrite the renderer base');

  // Only explicit diagnostics read pixels, and report the active mode's base exposure.
  adapt.reset({ base: 1.15, ref: -1.5 });
  render();
  renderer.readRenderTargetPixels = (target, x, y, width, height, out) => {
    if (width === 1) out.set([0.5, 0.5, -2, 1]);
    else for (let i = 0; i < out.length; i += 4) out.set([-2, 0, 0, 1], i);
  };
  const measured = await adapt.read();
  assert.equal(measured.exposure, 1.15 * 0.5, 'diagnostics use the changed mode base');
}

console.log('modes-check: keys trigger once per press; day/night reuses and restores lights and sky; GPU exposure resets mode history without readback');
