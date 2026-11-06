// Real WebGL recovery: generated skies must rebake, GPU exposure/history
// must restart, and a later resize must not delete an older context's RTs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa-environment-maps'));
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/environment-harness.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/assets/vendor/three/three.module.min.js"}}</script><body style="margin:0">');
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(root + sep)) throw new Error('path');
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    res.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream');
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, result;
const errors = [], warnings = [];
try {
  const executablePath = process.env.CHROMIUM_PATH || (await stat('/usr/bin/chromium').catch(() => null) ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 128, height: 128 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
    else if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/environment-harness.html');
  result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createEnvironmentMaps } = await import('/fun/hedgerow/js/environment-maps.js');
    const { createTAA } = await import('/fun/hedgerow/js/taa.js');
    const { createAdaptation } = await import('/fun/hedgerow/js/adapt.js');
    const { createGrade } = await import('/fun/hedgerow/js/post.js');
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, outputBufferType: THREE.HalfFloatType });
    renderer.setSize(128, 128);
    document.body.append(renderer.domElement);
    const gl = renderer.getContext(), shaderErrors = [];
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => shaderErrors.push({
      program: gl.getProgramInfoLog(program), vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment),
    });

    // Throw during the first sky face and during GGX filtering, when the
    // current target is scratch but the unreturned output also needs cleanup.
    const failures = [];
    for (const mode of ['first', 'filter']) {
      const caller = new THREE.WebGLRenderTarget(4, 4);
      renderer.setRenderTarget(caller);
      renderer.xr.enabled = true;
      renderer.autoClear = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const before = renderer.info.memory.textures;
      const maps = createEnvironmentMaps(renderer, { profile: 'prague-dawn' });
      const render = renderer.render;
      let calls = 0, failedAt = null, message = null;
      renderer.render = function (object, camera) {
        calls++;
        const name = object.material?.name || (object.isScene ? 'sky scene' : '');
        if (mode === 'first' || name === 'PMREMGGXConvolution') {
          failedAt = name;
          throw new Error('Injected environment capture failure');
        }
        return render.call(renderer, object, camera);
      };
      try { maps.bake(); } catch (error) { message = error.message; }
      finally { renderer.render = render; }
      const after = {
        textures: renderer.info.memory.textures, target: renderer.getRenderTarget() === caller,
        face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
        xr: renderer.xr.enabled, autoClear: renderer.autoClear, toneMapping: renderer.toneMapping,
        published: maps.targets !== null, glError: gl.getError(),
      };
      maps.dispose(); maps.dispose();
      const afterDispose = { textures: renderer.info.memory.textures, glError: gl.getError() };
      renderer.xr.enabled = false;
      renderer.setRenderTarget(null);
      caller.dispose();
      failures.push({ mode, calls, failedAt, message, before, after, afterDispose, finalError: gl.getError() });
    }

    const maps = createEnvironmentMaps(renderer, { fog: '#080e16', profile: 'prague-dawn' });
    let environments = maps.bake();
    maps.releaseTemporary();
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, .05, 50);
    camera.position.z = 3;
    scene.background = new THREE.Color(0);
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(.9, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: .25 })));
    scene.environment = environments.day.texture;
    renderer.toneMapping = THREE.NoToneMapping;
    let depth;
    const taa = createTAA(camera, () => depth), adapt = createAdaptation({ base: 1.7, ref: -5 }), grade = createGrade();
    adapt.metering = true;
    grade.adaptation = adapt;
    renderer.setEffects([{ enabled: true, needsSwap: false, setSize() {}, render(r, write, read) { depth = read.depthTexture; } }, taa, adapt, grade]);
    function frame() {
      taa.jitter(); adapt.update(1 / 60, renderer, 0);
      renderer.setRenderTarget(null); renderer.render(scene, camera); taa.restore();
      const pixels = new Uint8Array(128 * 128 * 4);
      gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
      return { mean: sum / (128 * 128 * 3), center: [...pixels.slice((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 4)], glError: gl.getError() };
    }
    for (let i = 0; i < 12; i++) frame();
    const before = { frame: frame(), adapt: await adapt.read() };
    const cycles = [];
    let restoreError = null;
    renderer.domElement.addEventListener('webglcontextlost', () => {
      maps.clear(); environments = null; scene.environment = null;
      // Retire old renderer-generation listeners before Three recreates its
      // caches. The source attributes/shaders remain available for reupload.
      taa.dispose(); renderer.setRenderTarget(null); renderer.setSize(1, 1, false);
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      try {
        environments = maps.bake(); maps.releaseTemporary();
        scene.environment = environments.day.texture;
        taa.reset(); adapt.reset(); renderer.setSize(128, 128, false);
      } catch (error) { restoreError = error.message; }
    });
    const lose = gl.getExtension('WEBGL_lose_context');
    if (!lose) throw new Error('WEBGL_lose_context is required for this recovery regression');
    const contextEvent = (name, trigger) => new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`Timed out waiting for ${name}`)), 10000);
      renderer.domElement.addEventListener(name, () => { clearTimeout(timer); done(); }, { once: true });
      trigger();
    });
    for (let i = 0; i < 2; i++) {
      await contextEvent('webglcontextlost', () => lose.loseContext());
      await new Promise(done => setTimeout(done, 50));
      await contextEvent('webglcontextrestored', () => lose.restoreContext());
      const restored = { frame: frame(), adapt: await adapt.read() };
      renderer.setSize(96, 96, false); renderer.setSize(128, 128, false);
      const resized = frame();
      scene.environment = environments.night.texture;
      taa.reset(); adapt.reset(); const night = frame();
      scene.environment = environments.day.texture;
      taa.reset(); adapt.reset(); const day = frame();
      cycles.push({ restored, resized, night, day });
    }
    scene.environment = null;
    const texturesBeforeDispose = renderer.info.memory.textures;
    maps.dispose(); maps.dispose();
    const ownerTextureDelta = texturesBeforeDispose - renderer.info.memory.textures;
    taa.dispose();
    return { failures, before, cycles, restoreError, shaderErrors, disposed: {
      glError: gl.getError(), ownerTextureDelta,
    } };
  });
  for (const failure of result.failures) {
    assert.equal(failure.message, 'Injected environment capture failure');
    assert.equal(failure.after.textures, failure.before, `${failure.mode}: unreturned PMREM outputs released`);
    assert.equal(failure.after.target, true, 'caller render target preserved');
    assert.equal(failure.after.face, 0); assert.equal(failure.after.mip, 0);
    assert.equal(failure.after.xr, true); assert.equal(failure.after.autoClear, true);
    assert.equal(failure.after.toneMapping, 4, 'caller ACES tone mapping preserved');
    assert.equal(failure.after.published, false);
    assert.equal(failure.after.glError, 0); assert.equal(failure.afterDispose.glError, 0); assert.equal(failure.finalError, 0);
    assert.equal(failure.afterDispose.textures, failure.before);
  }
  assert.ok(result.failures[1].calls > 12, 'later failure occurs in filtering after all six sky faces');
  assert.equal(result.restoreError, null); assert.deepEqual(result.shaderErrors, []);
  assert.ok(result.before.frame.mean > 20, 'reflective test object has visible generated environment light');
  for (const cycle of result.cycles) {
    assert.ok(Math.abs(cycle.restored.frame.mean - result.before.frame.mean) < 2, 'sky reflections survive restoration');
    assert.ok(cycle.restored.adapt.factor >= .35, 'restored exposure is immediately usable');
    for (const frame of [cycle.restored.frame, cycle.resized, cycle.night, cycle.day]) assert.equal(frame.glError, 0);
    assert.ok(cycle.night.mean > 0 && cycle.day.mean > cycle.night.mean * 3, 'both authored maps rebake into their correct slots');
  }
  assert.equal(result.disposed.glError, 0);
  assert.equal(result.disposed.ownerTextureDelta, 2, 'both environment outputs are released before TAA disposal');
  assert.deepEqual(errors, []);
  assert.ok(warnings.every(message => message.includes('GPU stall due to ReadPixels')), `no stale-object GL warnings: ${warnings}`);
  console.log('environment-maps-browser-check: first/filter failure cleanup, two HDR reset/resize cycles, both skies, exposure and disposal pass');
} catch (error) {
  errors.push(error.stack || error.message);
  throw error;
} finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ result, errors, warnings }, null, 2));
  await browser?.close();
  await new Promise(done => server.close(done));
}
