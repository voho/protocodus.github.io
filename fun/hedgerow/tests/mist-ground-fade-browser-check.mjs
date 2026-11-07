// Actual mist shader over opaque ground: soften contact while preserving
// airborne wisps, the river fade, no-map defaults and recovery ownership.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa-mist-ground-fade'));
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/mist-ground.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/assets/vendor/three/three.module.min.js"}}</script>'); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) throw Error('path');
    res.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [], warnings = [];
let browser, result;
try {
  const executablePath = process.env.CHROMIUM_PATH || (await stat('/usr/bin/chromium').catch(() => null) ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warnings.push(m.text()); });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/mist-ground.html');
  result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createMist } = await import('/fun/hedgerow/js/atmosphere.js');
    const W = 320, H = 240, renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(W, H); renderer.toneMapping = THREE.NoToneMapping;
    document.body.append(renderer.domElement);
    const gl = renderer.getContext(), shaderErrors = [];
    renderer.debug.onShaderError = (gl, p, v, f) => shaderErrors.push({ program: gl.getProgramInfoLog(p), vertex: gl.getShaderInfoLog(v), fragment: gl.getShaderInfoLog(f) });
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0, 1, 0);
    const green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 1, 0), fog: false, toneMapped: false });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), green);
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(300, 30), green); scene.add(backdrop);
    const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true });
    const camera = new THREE.PerspectiveCamera(50, W / H, .05, 400), frames = [];
    const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    function mapAt(y) {
      const hTex = new THREE.DataTexture(new Float32Array(4).fill(y), 2, 2, THREE.RedFormat, THREE.FloatType);
      hTex.minFilter = hTex.magFilter = THREE.NearestFilter; hTex.needsUpdate = true;
      return { hTex, uniforms: { tHeight: { value: hTex }, uMapMin: { value: new THREE.Vector2(-200, -200) },
        uMapRes: { value: 400 }, uMapN: { value: new THREE.Vector2(2, 2) } } };
    }
    function render(factory, name, softness) {
      if (factory.uniforms.uGroundSoftness) factory.uniforms.uGroundSoftness.value = softness;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
      const program = renderer.properties.get(factory.mesh.material).currentProgram.program, samplers = [];
      for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
        const u = gl.getActiveUniform(program, i);
        if ([gl.SAMPLER_2D, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D].includes(u.type)) samplers.push(u.name);
      }
      frames.push({ name, pixels: Array.from(pixels), glError: gl.getError(), samplers,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
      return pixels;
    }
    const loss = (p, x, y) => { const i = (y * W + x) * 4; return p[i] + 255 - p[i + 1] + p[i + 2]; };
    const cases = [];
    for (const spec of [{ name: 'dry', terrain: 0, ground: 0, water: false },
      { name: 'airborne', terrain: 3, ground: 0, water: false }, { name: 'river', terrain: -1.6, ground: -1.6, water: true }]) {
      const map = mapAt(spec.ground), options = { count: 1, terrain: { height: () => spec.terrain }, density: () => 1, seed: 9 };
      const water = spec.water ? floor : null, mist = createMist({ ...options, water, groundMap: map });
      mist.update(0, new THREE.Vector3(0, 1, 0));
      const positions = mist.mesh.geometry.attributes.aMist.array;
      camera.position.set(positions[0], spec.name === 'airborne' ? 4.8 : 1.8, positions[2] + 8);
      camera.lookAt(positions[0], spec.name === 'airborne' ? 3.65 : .65, positions[2]);
      backdrop.position.set(positions[0], 5, positions[2] - 10); scene.add(mist.mesh);
      const zero = render(mist, spec.name + '-baseline', 0), fade = render(mist, spec.name + '-fade', .48);
      const restored = render(mist, spec.name + '-restored', 0);
      let lowBefore = 0, lowAfter = 0, lowPixels = 0, highChanged = 0, highPixels = 0, first = H, last = -1;
      for (let x = 48; x < W - 48; x++) for (let y = 0; y < H; y++) if (loss(zero, x, y) > 4) {
        first = Math.min(first, y); last = Math.max(last, y);
      }
      // Compare the first four visible pixels of the actual opaque-ground
      // silhouette; do not duplicate the shader's fade, height or noise math.
      for (let x = 48; x < W - 48; x++) {
        let bottom = -1;
        for (let y = 0; y < H; y++) if (loss(zero, x, y) > 4) { bottom = y; break; }
        if (bottom < 0) continue;
        for (let y = bottom; y < Math.min(H, bottom + 4); y++) {
          const l = loss(zero, x, y); if (l <= 4) continue;
          lowBefore += l; lowAfter += loss(fade, x, y); lowPixels++;
        }
      }
      for (let x = 48; x < W - 48; x++) for (let y = Math.ceil(first + (last - first) * .8); y <= last; y++) {
        if (loss(zero, x, y) <= 4) continue;
        highPixels++; const i = (y * W + x) * 4;
        if ([0, 1, 2, 3].some(c => zero[i + c] !== fade[i + c])) highChanged++;
      }
      const noMap = createMist({ ...options, water }); noMap.update(0, new THREE.Vector3(0, 1, 0));
      scene.remove(mist.mesh); scene.add(noMap.mesh);
      const noMapOutput = render(noMap, spec.name + '-no-map', 0); scene.remove(noMap.mesh);
      cases.push({ name: spec.name, restorationExact: equal(zero, restored), mappedZeroMatchesNoMap: equal(zero, noMapOutput),
        fadeEqualsZero: equal(zero, fade), lowBefore, lowAfter, lowPixels, highPixels, highChanged,
        placementExact: equal(Array.from(positions), Array.from(noMap.mesh.geometry.attributes.aMist.array)),
        borrowedUniformWrapper: mist.uniforms.tHeight === map.uniforms.tHeight });
      for (const factory of [mist, noMap]) { factory.mesh.geometry.dispose(); factory.mesh.material.dispose(); }
      map.hTex.dispose();
    }
    const map = mapAt(0), recovery = createMist({ count: 1, terrain: { height: () => 0 }, density: () => 1, seed: 9, groundMap: map });
    recovery.update(0, new THREE.Vector3(0, 1, 0)); scene.add(recovery.mesh);
    const a = recovery.mesh.geometry.attributes.aMist.array;
    camera.position.set(a[0], 1.8, a[2] + 8); camera.lookAt(a[0], .65, a[2]); backdrop.position.set(a[0], 5, a[2] - 10);
    const uniformRefs = { ...recovery.uniforms }, positionRef = a, textureRef = map.hTex;
    const beforeZero = render(recovery, 'context-before-baseline', 0), beforeFade = render(recovery, 'context-before-fade', .48);
    const memoryBefore = { ...renderer.info.memory }, extension = gl.getExtension('WEBGL_lose_context');
    if (!extension) throw Error('Context-loss extension required for ground-map uniform recovery');
    renderer.domElement.addEventListener('webglcontextlost', () => {
      // The fixture owns the map. Retire old-generation GPU listeners while
      // retaining the same CPU objects for reupload; createMist owns no map.
      renderer.setRenderTarget(null); target.dispose(); floor.geometry.dispose(); backdrop.geometry.dispose(); green.dispose();
      recovery.mesh.geometry.dispose(); recovery.mesh.material.dispose(); map.hTex.dispose();
    });
    const event = (name, action) => new Promise((done, fail) => {
      const timer = setTimeout(() => fail(Error(name + ' timeout')), 10000);
      renderer.domElement.addEventListener(name, e => { e.preventDefault(); clearTimeout(timer); done(); }, { once: true }); action();
    });
    await event('webglcontextlost', () => extension.loseContext());
    await new Promise(done => setTimeout(done, 50));
    await event('webglcontextrestored', () => extension.restoreContext());
    const afterZero = render(recovery, 'context-after-baseline', 0), afterFade = render(recovery, 'context-after-fade', .48);
    const recoveryCheck = { baselineExact: equal(beforeZero, afterZero), fadeExact: equal(beforeFade, afterFade),
      uniformWrappersRetained: Object.entries(uniformRefs).every(([k, v]) => recovery.uniforms[k] === v),
      positionArrayRetained: recovery.mesh.geometry.attributes.aMist.array === positionRef,
      borrowedTextureRetained: recovery.uniforms.tHeight.value === textureRef,
      memoryBefore, memoryAfter: { ...renderer.info.memory } };
    renderer.setRenderTarget(null); target.dispose(); floor.geometry.dispose(); backdrop.geometry.dispose(); green.dispose();
    recovery.mesh.geometry.dispose(); recovery.mesh.material.dispose(); map.hTex.dispose();
    const cleanupGLError = gl.getError(); renderer.dispose();
    return { size: [W, H], cases, frames, shaderErrors, recoveryCheck, cleanupGLError };
  });
  for (const frame of result.frames) {
    const bytes = Buffer.from(frame.pixels); delete frame.pixels;
    frame.sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(resolve(output, frame.name + '.rgba8'), bytes);
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ...result, errors, warnings }, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(result.shaderErrors, []); assert.equal(result.cleanupGLError, 0);
  const dry = result.cases.find(c => c.name === 'dry');
  assert.ok(dry.lowPixels > 100 && dry.lowBefore > 1000, 'the baseline visibly intersects opaque ground');
  assert.ok(dry.lowAfter < dry.lowBefore * .4, 'the actual shader softens ground contact');
  assert.ok(dry.highPixels > 100 && dry.highChanged === 0, 'higher airborne wisps retain their density');
  for (const c of result.cases) {
    assert.ok(c.restorationExact && c.mappedZeroMatchesNoMap && c.placementExact && c.borrowedUniformWrapper, `${c.name} restores and retains defaults/placement/borrowed map`);
    if (c.name !== 'dry') assert.equal(c.fadeEqualsZero, true, `${c.name} keeps prior airborne/river output`);
  }
  for (const frame of result.frames) {
    assert.equal(frame.glError, 0);
    assert.deepEqual(frame.samplers, frame.name.endsWith('-no-map') ? [] : ['tHeight'], 'only the borrowed map adds one active sampler');
  }
  const r = result.recoveryCheck;
  assert.ok(r.baselineExact && r.fadeExact && r.uniformWrappersRetained && r.positionArrayRetained && r.borrowedTextureRetained, 'context recovery preserves outputs and CPU ownership');
  assert.deepEqual(r.memoryBefore, r.memoryAfter, 'context recovery adds no resource allocation');
  assert.ok(warnings.every(message => message.includes('GPU stall due to ReadPixels') || message.includes('KHR_parallel_shader_compile')), `no stale-generation GL warnings: ${warnings}`);
  console.log('mist-ground-fade-browser-check: actual ground contact softens; airborne/river/defaults, one borrowed sampler, exact restoration and context recovery pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
