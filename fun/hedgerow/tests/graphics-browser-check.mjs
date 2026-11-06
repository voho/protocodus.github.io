// Run with: node fun/hedgerow/tests/graphics-browser-check.mjs
// Real WebGL regression: a moving foreground must reveal the current
// background immediately, and representative enhanced materials must compile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa-graphics'));
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/graphics-harness.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><title>Hedgerow graphics regression</title><script type="importmap">{"imports":{"three":"/assets/vendor/three/three.module.min.js"}}</script></head><body style="margin:0"></body></html>');
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(root + sep)) throw new Error('path');
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, result;
const errors = [];
try {
  const executablePath = process.env.CHROMIUM_PATH || (await stat('/usr/bin/chromium').catch(() => null) ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/graphics-harness.html');
  result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createTAA } = await import('/fun/hedgerow/js/taa.js');
    const { createGrade } = await import('/fun/hedgerow/js/post.js');
    const { createMaterialLibrary } = await import('/fun/hedgerow/js/materials.js');
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    document.body.append(renderer.domElement);
    renderer.setSize(128, 128);
    renderer.toneMapping = THREE.NoToneMapping;
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 50), scene = new THREE.Scene();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0x0000ff }));
    back.position.z = -10;
    scene.add(back);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    front.position.z = -2;
    scene.add(front);
    const source = new THREE.WebGLRenderTarget(128, 128, { type: THREE.HalfFloatType });
    source.depthTexture = new THREE.DepthTexture(128, 128);
    const output = new THREE.WebGLRenderTarget(128, 128, { type: THREE.UnsignedByteType, depthBuffer: false });
    const taa = createTAA(camera, () => source.depthTexture);
    taa.setSize(128, 128);
    const targets = [], originalSetTarget = renderer.setRenderTarget.bind(renderer);
    renderer.setRenderTarget = target => { targets.push(target); originalSetTarget(target); };
    function frame() {
      taa.jitter();
      renderer.setRenderTarget(source);
      renderer.render(scene, camera);
      taa.render(renderer, output, source);
      taa.restore();
    }
    frame();
    const first = new Uint8Array(4);
    renderer.readRenderTargetPixels(output, 50, 64, 1, 1, first);
    // Move the red panel 14 pixels. Sample beside its new edge: the current
    // neighbourhood contains both colours, so colour clamping alone retains
    // the old red silhouette. Depth rejection must select the blue wall.
    front.position.x = 14 * (4 * Math.tan(Math.PI / 6)) / 128;
    frame();
    const exposed = new Uint8Array(4);
    renderer.readRenderTargetPixels(output, 50, 64, 1, 1, exposed);
    const history = targets.at(-2), depthPixel = new Uint16Array(4);
    renderer.readRenderTargetPixels(history, 50, 64, 1, 1, depthPixel);
    const storedDepth = THREE.DataUtils.fromHalfFloat(depthPixel[3]);
    renderer.setRenderTarget = originalSetTarget;
    const grade = createGrade();
    grade.setSize(128, 128);
    grade.render(renderer, output, source);

    // Exercise shader variants affected by surface filtering, including
    // bark, cloth/skin, close-up weapon detail and cutout foliage.
    const map = new THREE.DataTexture(new Uint8Array([120, 130, 110, 255]), 1, 1);
    map.needsUpdate = true;
    const normal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 128]), 1, 1);
    normal.needsUpdate = true;
    const shared = { wet: { value: 1 }, rain: { value: 0.6 }, time: { value: 1 } };
    const textures = Object.fromEntries(['fabric', 'bark', 'planks', 'metal', 'stone', 'foliage', 'concrete'].map(key => [key, normal]));
    const library = createMaterialLibrary(textures, shared);
    const samples = new THREE.Scene();
    samples.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2));
    samples.add(new THREE.DirectionalLight(0xffffff, 2));
    const variants = ['oak', 'allied', 'm1_garand', 'village', 'nat_ground'].map(name => {
      const material = new THREE.MeshStandardMaterial({ map, normalMap: normal });
      material.name = name;
      if (name === 'nat_ground') material.alphaTest = 0.5;
      return library.resolve(material);
    });
    variants.push(library.get('metal_gray'), library.get('wood'));
    variants.forEach((material, i) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 12), material);
      mesh.position.set((i % 4 - 1.5), i < 4 ? 0.6 : -0.6, -3);
      samples.add(mesh);
    });
    renderer.setSize(600, 400);
    camera.aspect = 1.5;
    camera.updateProjectionMatrix();
    renderer.setRenderTarget(null);
    renderer.render(samples, camera);
    return { first: [...first], exposed: [...exposed], storedDepth, compiledMaterials: variants.length, programs: renderer.info.programs.length };
  });
  await page.screenshot({ path: resolve(output, 'materials.png') });
  result.terrain = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createTerrain } = await import('/fun/hedgerow/js/terrain.js');
    const { loadTextures } = await import('/fun/hedgerow/js/materials.js');
    const { createGrade } = await import('/fun/hedgerow/js/post.js');
    const textures = await loadTextures('/fun/hedgerow/assets/textures');
    const shared = { wet: { value: 1 }, rain: { value: 0.7 }, time: { value: 8 }, relief: { value: 1 } };
    // The bank rises four metres over two metres: its >55-degree slope
    // executes the triplanar rock branch. Four ground bands also exercise
    // mud/puddles, grass, leaf litter and cobbles on the flatter approaches.
    const terrain = await createTerrain({
      bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
      height: (x, z) => Math.min(4, Math.max(0, (x + 1) * 2)) + Math.sin(z * 0.6) * 0.12,
      splat: (x, z) => z < -5 ? [1, 0, 0, 0]
        : z < -1 ? [0, 1, 0, 0] : z < 3 ? [0, 0, 1, 0] : [0, 0, 0, 1],
      fine: [[-8, -8, 8, 8]],
    }, textures, shared);
    const renderer = new THREE.WebGLRenderer({ antialias: true, outputBufferType: THREE.HalfFloatType });
    document.body.replaceChildren(renderer.domElement);
    renderer.setSize(600, 400);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Ground alpha encodes reflectivity. As in the game, the final opaque
    // grade consumes that intermediate image before the canvas is presented.
    renderer.setEffects([createGrade()]);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#c0ccd0');
    scene.add(terrain.group);
    scene.add(new THREE.HemisphereLight(0xe1ecff, 0x4c4638, 2.5));
    const sun = new THREE.DirectionalLight(0xfff3dd, 3);
    sun.position.set(-7, 12, 4);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(52, 1.5, 0.1, 100);
    camera.position.set(-14, 10, 16);
    camera.lookAt(0, 1.8, 0);
    // Both relief settings use the same shader; run each to cover the
    // close-surface material path as well as the lightweight fallback.
    shared.relief.value = 0;
    renderer.render(scene, camera);
    shared.relief.value = 1;
    renderer.render(scene, camera);
    return { chunks: terrain.group.children.length, triangles: renderer.info.render.triangles,
      bankSlope: 1 - terrain.normal(0, 0)[1], glError: renderer.getContext().getError() };
  });
  await page.screenshot({ path: resolve(output, 'terrain.png') });
  assert.ok(result.first[0] > 240, 'test setup: foreground covers sample in the first frame');
  assert.ok(result.exposed[2] > 240 && result.exposed[0] < 15, `no red temporal trail on newly exposed blue wall: ${result.exposed}`);
  assert.ok(Math.abs(result.storedDepth - 10) < 0.1, 'history retains linear eye depth in metres');
  assert.ok(result.terrain.triangles > 0 && result.terrain.bankSlope > 0.42, 'real terrain mesh exercises steep triplanar rock shading');
  assert.equal(result.terrain.glError, 0, 'terrain renders with no WebGL errors');
  assert.deepEqual(errors, [], 'material and post shaders compile and render without errors');
  console.log(`graphics-browser-check: depth rejection, TAA/grade, ${result.compiledMaterials} material variants and triplanar terrain pass`);
} catch (error) {
  errors.push(error.stack || error.message);
  throw error;
} finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ result, errors }, null, 2));
  await browser?.close();
  await new Promise(done => server.close(done));
}
