// Actual mist shader over opaque water: soften its intersection, preserve
// higher wisps/defaults, and retain uniforms/buffers after context recovery.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa-mist-water-fade'));
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/mist-harness.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/assets/vendor/three/three.module.min.js"}}</script><body style="margin:0">'); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) throw Error('path');
    res.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream');
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [], warnings = [];
let browser, result;
try {
  const executablePath = process.env.CHROMIUM_PATH || (await stat('/usr/bin/chromium').catch(() => null) ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warnings.push(m.text()); });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/mist-harness.html');
  result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createMist } = await import('/fun/hedgerow/js/atmosphere.js');
    const W = 320, H = 240, renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(W, H); renderer.toneMapping = THREE.NoToneMapping; document.body.append(renderer.domElement);
    const gl = renderer.getContext(), shaderErrors = [];
    renderer.debug.onShaderError = (gl, p, v, f) => shaderErrors.push({ program: gl.getProgramInfoLog(p), vertex: gl.getShaderInfoLog(v), fragment: gl.getShaderInfoLog(f) });
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0, 1, 0);
    const green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 1, 0), fog: false, toneMapped: false });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), green); water.rotation.x = -Math.PI / 2; scene.add(water);
    const options = { count: 1, terrain: { height: () => -1.6 }, density: () => 1, seed: 9 };
    const mist = createMist({ ...options, water });
    mist.update(0, new THREE.Vector3(0, 1, 0));
    const positions = Array.from(mist.mesh.geometry.attributes.aMist.array), sizes = Array.from(mist.mesh.geometry.attributes.aSize.array);
    const camera = new THREE.PerspectiveCamera(50, W / H, .05, 400);
    camera.position.set(positions[0], 1.8, positions[2] + 8); camera.lookAt(positions[0], .65, positions[2]);
    // A green backdrop leaves higher mist measurable without introducing
    // lighting/textures. The real opaque horizontal water clips its lower part.
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(300, 30), green);
    backdrop.position.set(positions[0], 5, positions[2] - 10); scene.add(backdrop); scene.add(mist.mesh);
    const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true });
    function render(factory, softness) {
      factory.uniforms.uWaterSoftness.value = softness;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
      return { pixels, glError: gl.getError(), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }
    const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const loss = (p, x, y) => { const i = (y * W + x) * 4; return p[i] + (255 - p[i + 1]) + p[i + 2]; };
    const baseline = render(mist, 0), fade = render(mist, .48), restored = render(mist, 0);
    let lowBefore = 0, lowAfter = 0, lowPixels = 0, highPixels = 0, highChanged = 0, coloured = 0;
    let first = H, last = -1;
    for (let x = 48; x < W - 48; x++) for (let y = 0; y < H; y++) if (loss(baseline.pixels, x, y) > 4) { first = Math.min(first, y); last = Math.max(last, y); coloured++; }
    // The rendered lower silhouette is the actual opaque-water intersection.
    // Compare its first four pixels; no copy of the shader's fade/noise formula.
    for (let x = 48; x < W - 48; x++) {
      let bottom = -1;
      for (let y = 0; y < H; y++) if (loss(baseline.pixels, x, y) > 4) { bottom = y; break; }
      if (bottom < 0) continue;
      for (let y = bottom; y < Math.min(H, bottom + 4); y++) {
        const a = loss(baseline.pixels, x, y); if (a <= 4) continue;
        lowBefore += a; lowAfter += loss(fade.pixels, x, y); lowPixels++;
      }
    }
    for (let x = 48; x < W - 48; x++) for (let y = Math.ceil(first + (last - first) * .8); y <= last; y++) {
      if (loss(baseline.pixels, x, y) <= 4) continue;
      highPixels++; const i = (y * W + x) * 4;
      if ([0, 1, 2, 3].some(c => baseline.pixels[i + c] !== fade.pixels[i + c])) highChanged++;
    }
    const noWater = createMist(options); noWater.update(0, new THREE.Vector3(0, 1, 0));
    scene.remove(mist.mesh); scene.add(noWater.mesh);
    const defaultSoftness = noWater.uniforms.uWaterSoftness.value;
    const noWaterZero = render(noWater, 0), noWaterPositive = render(noWater, .48);
    scene.remove(noWater.mesh); scene.add(mist.mesh);
    const beforeRecovery = render(mist, 0);
    const extension = gl.getExtension('WEBGL_lose_context');
    if (!extension) throw Error('Context-loss extension required for this tiny uniform/buffer regression');
    // Retire this fixture's owned old-generation listeners while that
    // context is lost; CPU attributes/uniforms stay on the same objects for
    // reupload. Unused no-water buffers must retire here too.
    renderer.domElement.addEventListener('webglcontextlost', () => {
      renderer.setRenderTarget(null); target.dispose();
      water.geometry.dispose(); backdrop.geometry.dispose(); green.dispose();
      for (const factory of [mist, noWater]) { factory.mesh.geometry.dispose(); factory.mesh.material.dispose(); }
    });
    const event = (name, action) => new Promise((done, fail) => {
      const timer = setTimeout(() => fail(Error('Timed out waiting for ' + name)), 10000);
      renderer.domElement.addEventListener(name, e => { e.preventDefault(); clearTimeout(timer); done(); }, { once: true }); action();
    });
    await event('webglcontextlost', () => extension.loseContext());
    await new Promise(done => setTimeout(done, 50));
    await event('webglcontextrestored', () => extension.restoreContext());
    const afterRecovery = render(mist, 0), fadeAfterRecovery = render(mist, .48);
    const bytes64 = p => { let s = ''; for (let i = 0; i < p.length; i += 8192) s += String.fromCharCode(...p.subarray(i, i + 8192)); return btoa(s); };
    const frames = { baseline, fade, restored, afterRecovery, fadeAfterRecovery };
    const packed = Object.fromEntries(Object.entries(frames).map(([name, f]) => [name, { bytes: bytes64(f.pixels), glError: f.glError, calls: f.calls, triangles: f.triangles }]));
    const result = {
      method: 'Actual createMist ShaderMaterial rendered into native RGBA8 target over opaque flat water and green backdrop. Pixel silhouette comparisons do not copy shader fade/noise math.',
      size: [W, H], positions, sizes, finite: [...positions, ...sizes, ...mist.uniforms.uWaterBounds.value.toArray(), mist.uniforms.uWaterLevel.value].every(Number.isFinite),
      coloured, lowPixels, lowBefore, lowAfter, lowRatio: lowAfter / lowBefore, highPixels, highChanged,
      restoredExact: equal(baseline.pixels, restored.pixels), noWaterDefaultSoftness: defaultSoftness,
      noWaterInert: equal(noWaterZero.pixels, noWaterPositive.pixels) && equal(baseline.pixels, noWaterZero.pixels),
      placementSame: equal(positions, Array.from(noWater.mesh.geometry.attributes.aMist.array)) && equal(sizes, Array.from(noWater.mesh.geometry.attributes.aSize.array)),
      recoveryBaselineExact: equal(beforeRecovery.pixels, afterRecovery.pixels), recoveryFadeExact: equal(fade.pixels, fadeAfterRecovery.pixels),
      noWaterErrors: [noWaterZero.glError, noWaterPositive.glError], shaderErrors, frames: packed,
    };
    renderer.setRenderTarget(null); target.dispose(); water.geometry.dispose(); backdrop.geometry.dispose(); green.dispose();
    for (const factory of [mist, noWater]) { factory.mesh.geometry.dispose(); factory.mesh.material.dispose(); }
    renderer.dispose(); result.cleanupGLError = gl.getError(); return result;
  });
  for (const [name, frame] of Object.entries(result.frames)) {
    const bytes = Buffer.from(frame.bytes, 'base64'); delete frame.bytes; frame.sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(resolve(output, name + '.rgba8'), bytes);
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ...result, errors, warnings }, null, 2));
  assert.equal(result.finite, true); assert.deepEqual(result.shaderErrors, []); assert.deepEqual(errors, []);
  assert.ok(result.coloured > 100 && result.lowPixels > 40, 'the legacy shader visibly intersects opaque water');
  assert.ok(result.lowRatio < .55, 'actual shader reduces mist immediately above its water intersection');
  assert.ok(result.highPixels > 20 && result.highChanged === 0, 'visible higher mist remains unchanged');
  assert.equal(result.restoredExact, true); assert.equal(result.noWaterDefaultSoftness, 0); assert.equal(result.noWaterInert, true); assert.equal(result.placementSame, true);
  assert.equal(result.recoveryBaselineExact, true); assert.equal(result.recoveryFadeExact, true);
  assert.deepEqual(result.noWaterErrors, [0, 0]); assert.equal(result.cleanupGLError, 0);
  for (const frame of Object.values(result.frames)) assert.equal(frame.glError, 0);
  assert.ok(warnings.every(message => message.includes('GPU stall due to ReadPixels') || message.includes('KHR_parallel_shader_compile')), `no stale-generation GL warnings: ${warnings}`);
  console.log('mist-water-fade-browser-check: actual opaque-water intersection softens, higher mist/defaults remain, exact restore/context recovery and GL0');
} finally {
  await browser?.close(); await new Promise(done => server.close(done));
}
