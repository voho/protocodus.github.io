// Run from fun/alpen: node tests/mobile-render-check.mjs
// Each profile boots in a separate process: terrain and prop windows are
// captured when their modules load, before the game's resize handler runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const devices = {
  desktop: { width: 1440, height: 900, coarse: false, hover: true },
  portrait: { width: 390, height: 844, coarse: true, hover: false },
  landscape: { width: 844, height: 390, coarse: true, hover: false },
  narrow: { width: 390, height: 844, coarse: false, hover: true },
  hybrid: { width: 844, height: 390, coarse: false, hover: true, touch: true },
};

async function snapshot(device) {
  globalThis.window = {
    innerWidth: device.width, innerHeight: device.height, devicePixelRatio: 3,
    matchMedia: query => ({ matches: {
      '(pointer: coarse)': device.coarse,
      '(hover: none)': !device.hover,
      '(any-pointer: coarse)': device.coarse || !!device.touch,
    }[query] ?? false }),
  };
  if (device.touch) window.ontouchstart = null;
  globalThis.document = { createElement: () => ({ getContext: () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  }) }) };
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  console.warn = () => {};
  const THREE = await import('../../../assets/vendor/three/three.module.min.js');
  const TestTHREE = { ...THREE, TextureLoader: class {
    load(url, ready, progress, fail) { fail?.(); return new THREE.Texture(); }
  } };
  const { MOBILE_RENDER, RENDER, TERRAIN, PROPS, RIDER } = await import('../js/config.js');
  const { createTerrain, heightAt, drawnHeightAt, guideAt } = await import('../js/terrain.js');
  const { setWorldSeed } = await import('../js/noise.js');
  const { createRetro } = await import('../js/retro.js');
  const { createSky } = await import('../js/sky.js');
  const { createWeather } = await import('../js/weather.js');
  const terrain = createTerrain(TestTHREE, { apply: m => m, uniforms: {} });
  await terrain.surfacesReady;
  const gl = {
    isContextLost: () => false,
    getInternalformatParameter: () => [4, 2, 1],
  };
  let submissions = 0;
  const renderer = {
    info: {}, capabilities: { isWebGL2: true },
    extensions: { has: () => false }, getContext: () => gl,
    setPixelRatio() {}, setSize() {}, setRenderTarget() {},
    getRenderTarget: () => null, clear() {}, render() { submissions++; },
  };
  const retro = createRetro(THREE, renderer);
  const portrait = retro.setSize(390, 844);
  const landscape = retro.setSize(844, 390);
  const large = retro.setSize(1440, 900);
  // Low-density touch screens must not accidentally request desktop MSAA.
  window.devicePixelRatio = 1;
  const samples = createRetro(THREE, renderer).samples;
  const sky = createSky(TestTHREE);
  await sky.backdropReady;
  const weather = createWeather(THREE);
  weather.pin(0.45); weather.update(0);
  const pos = new THREE.Vector3();
  sky.update(pos, weather.state, 1 / 120);
  sky.renderProbe(renderer);
  submissions = 0;
  for (let frame = 0; frame < 120; frame++) {
    sky.update(pos, weather.state, 1 / 120);
    sky.renderProbe(renderer);
  }
  const regularProbes = submissions;
  sky.refreshProbe();
  sky.renderProbe(renderer);
  assert.equal(submissions, regularProbes + 1, 'forced sky refresh remains immediate');
  const samplesAt = [];
  for (const seed of ['mobile-render', 'powder', 73291]) {
    setWorldSeed(seed);
    for (const z of [-12.35, -317.4, -901.22, -2511.6, -5310.37]) {
      const center = guideAt(z);
      for (const offset of [-21.3, -2.24, 0.11, 19.6]) {
        const x = center + offset;
        samplesAt.push([heightAt(x, z), drawnHeightAt(x, z)]);
      }
    }
  }
  const { ahead, side, behind, aheadGrowth, sideGrowth, behindGrowth,
    ...ridingTerrain } = TERRAIN;
  const { ahead: propAhead, behind: propBehind, ...obstacles } = PROPS;
  return {
    mobile: MOBILE_RENDER,
    fog: [RENDER.fogNear, RENDER.fogFar],
    reach: [ahead, side, behind],
    bands: propAhead + propBehind + 1,
    vertices: terrain.vertexCount,
    triangles: terrain.mesh.geometry.index.count / 3,
    sizes: { portrait, landscape, large }, samples,
    shadowMap: sky.lights.children.find(o => o.isDirectionalLight).shadow.mapSize.toArray(),
    skyProbe: [sky.probe.image.width, sky.probe.image.height],
    regularProbes,
    gameplay: { ridingTerrain, obstacles, rider: RIDER, samplesAt },
  };
}

if (process.argv[2]) {
  process.stdout.write(JSON.stringify(await snapshot(devices[process.argv[2]])));
} else {
  const results = {};
  for (const name of Object.keys(devices)) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name],
      { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, `${name}: ${child.stderr || child.error || child.stdout}`);
    results[name] = JSON.parse(child.stdout);
  }
  const desktop = results.desktop, mobile = results.portrait;
  assert.equal(desktop.mobile, false);
  assert.equal(mobile.mobile, true);
  assert.deepEqual(results.landscape, mobile, 'rotation keeps the same rendering profile');
  for (const name of ['narrow', 'hybrid']) {
    assert.deepEqual(results[name], desktop, `${name} retains desktop quality`);
  }
  const { samplesAt, ...mobileRules } = mobile.gameplay;
  const { samplesAt: desktopSamples, ...desktopRules } = desktop.gameplay;
  assert.deepEqual(mobileRules, desktopRules, 'shorter visibility preserves riding and obstacle rules');
  samplesAt.forEach((sample, i) => assert.deepEqual(sample, desktopSamples[i],
    `height and near-ground triangle sample ${i} stay identical across profiles`));
  assert.deepEqual(desktop.fog, [220, 1000]);
  assert.deepEqual(mobile.fog, [110, 450]);
  assert.ok(mobile.reach.every(distance => distance > mobile.fog[1]),
    'the terrain extends beyond the mobile fog curtain in every direction');
  assert.ok(mobile.vertices < desktop.vertices * 0.75,
    'mobile allocates a materially smaller terrain mesh');
  assert.ok(mobile.triangles < desktop.triangles * 0.75);
  assert.ok(mobile.bands < desktop.bands * 0.7, 'fewer scenery bands are generated and submitted');
  for (const orientation of ['portrait', 'landscape', 'large']) {
    const light = mobile.sizes[orientation], full = desktop.sizes[orientation];
    assert.equal(light.displayWidth, full.displayWidth, 'HUD keeps its display resolution');
    assert.equal(light.displayHeight, full.displayHeight);
    assert.ok(light.width * light.height < full.width * full.height * 0.45);
    assert.ok(light.width * light.height <= 1280 * 720 + 1500, 'world pixel budget allows rounding');
  }
  assert.equal(mobile.samples, 2);
  assert.equal(desktop.samples, 4);
  assert.deepEqual(mobile.shadowMap, [1024, 1024]);
  assert.deepEqual(desktop.shadowMap, [4096, 4096]);
  assert.deepEqual(mobile.skyProbe, [256, 128]);
  assert.deepEqual(desktop.skyProbe, [1024, 512]);
  assert.ok(mobile.regularProbes <= desktop.regularProbes * 0.6);
  console.log(`Mobile rendering checks passed: terrain ${desktop.vertices} → ${mobile.vertices} vertices, `
    + `${desktop.triangles} → ${mobile.triangles} triangles; scenery ${desktop.bands} → ${mobile.bands} bands; `
    + 'portrait/landscape, desktop detection, gameplay, HUD and rendering budgets.');
}
