// Run with: node fun/hedgerow/tests/modes-check.mjs
// Mode keys are edges, day/night reuses the scene, and exposure never applies
// a light reading captured before the mode changed.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createInput } = await import('../js/input.js');
const { createLighting } = await import('../js/lights.js');
const { createSky, DAY_FOG_COLOR } = await import('../js/sky.js');
const { createAdaptation } = await import('../js/adapt.js');

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
  const adapt = createAdaptation();
  adapt.metering = true;
  const requests = [];
  const renderer = {
    toneMappingExposure: 1.7,
    setRenderTarget() {}, render() {},
    readRenderTargetPixelsAsync(target, x, y, width, height, buffer) {
      return new Promise((resolve) => requests.push({ buffer, resolve }));
    },
  };
  const render = () => adapt.render(renderer, null, { texture: null });
  const request = () => { for (let i = 0; i < 6; i++) render(); };
  const finish = async (logLuminance) => {
    const { buffer, resolve } = requests.shift();
    const encoded = (logLuminance + 16) / 24 * 255;
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = Math.floor(encoded);
      buffer[i + 1] = Math.round((encoded % 1) * 255);
    }
    resolve();
    await Promise.resolve();
  };
  request();
  await finish(-3);
  assert.ok(Math.abs(adapt.metered + 3) < 0.001);
  adapt.update(1, renderer);
  assert.ok(adapt.factor < 1, 'a bright night scene lowers exposure');

  request();
  assert.equal(requests.length, 1);
  adapt.reset({ base: 1.15, ref: -1.5 });
  assert.equal(adapt.factor, 1);
  assert.equal(adapt.metered, null);
  request();
  assert.equal(requests.length, 1, 'reset does not overlap a pending readback');
  await finish(4);
  assert.equal(adapt.metered, null, 'a late night-mode reading cannot alter daylight exposure');
  adapt.update(1, renderer);
  assert.equal(renderer.toneMappingExposure, 1.15);

  request();
  await finish(-2);
  assert.ok(Math.abs(adapt.metered + 2) < 0.001, 'fresh daylight samples still arrive');
  adapt.update(1, renderer);
  assert.equal(adapt.factor, 1, 'daylight uses its brighter metering reference');
  adapt.reset({ base: 1.7, ref: -5 });
  adapt.update(1, renderer);
  assert.equal(renderer.toneMappingExposure, 1.7, 'returning to night restores its base exposure');
  assert.equal(adapt.metered, null);
  assert.equal(adapt.params.ref, -5);
}

console.log('modes-check: keys trigger once per press; day/night reuses and restores lights and sky; exposure rejects stale mode readings');
