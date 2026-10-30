// In a served Alpen page:
// await (await import('./tests/smoke-projection-browser-check.mjs')).runSmokeProjectionCheck()
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { RENDER } from '../js/config.js';

export function runSmokeProjectionCheck(huts = globalThis.__alpen?.huts) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const source = huts?.smoke?.material;
  assert(source?.vertexShader && RENDER.buffer.height > 0, 'use the live production smoke material');
  // Transfer the actual CPU uniform to a small fixture framebuffer. Do not
  // replace its scale with the expected answer: the old fixed-FOV uniform
  // must be tested together with the old vertex shader in paired runs.
  const scalePerPixel = source.uniforms.uScale.value / RENDER.buffer.height;
  assert(Number.isFinite(scalePerPixel) && scalePerPixel > 0, 'production smoke scale is finite and positive');
  const renderer = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(384, 384), antialias: false });
  const gl = renderer.getContext();
  const target = new THREE.WebGLRenderTarget(384, 384, { depthBuffer: false });
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  for (const [name, value] of [['aSize', 1], ['aAlpha', 1], ['aTurn', 0], ['aShape', 0]]) {
    pointGeometry.setAttribute(name, new THREE.Float32BufferAttribute([value], 1));
  }
  const nativeCap = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
  // Projection is independent of the live overdraw cap (which can be small
  // in a tiny game viewport). Keep both diagnostic shapes below the driver's
  // limit; exercise the shader's own cap separately below.
  const worldSize = Math.min(1, nativeCap / 64);
  pointGeometry.getAttribute('aSize').setX(0, worldSize);
  const pointMaterial = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 0 }, uMaxSize: { value: nativeCap } },
    vertexShader: source.vertexShader,
    // Opaque coverage isolates sizing from the smoke atlas, lighting and fog.
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    depthTest: false, depthWrite: false,
  });
  const planeGeometry = new THREE.PlaneGeometry(worldSize, worldSize);
  const planeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false });
  try {
    assert(nativeCap >= 16, 'projection fixture requires at least 16-pixel point support; driver reports ' + nativeCap);
    renderer.setPixelRatio(1);
    renderer.setSize(384, 384, false);
    renderer.setClearColor(0x000000, 1);
    const scene = new THREE.Scene();
    const point = new THREE.Points(pointGeometry, pointMaterial);
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    point.position.z = plane.position.z = -8;
    point.frustumCulled = plane.frustumCulled = false;
    scene.add(point, plane);
    const camera = new THREE.PerspectiveCamera(65, 1, .01, 100);
    const records = [];
    const draw = (object, size) => {
      point.visible = object === point;
      plane.visible = object === plane;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      let minX = size, minY = size, maxX = -1, maxY = -1;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (pixels[(y * size + x) * 4] < 128) continue;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      return { width: Math.max(0, maxX - minX + 1), height: Math.max(0, maxY - minY + 1) };
    };
    for (const size of [256, 384]) {
      target.setSize(size, size);
      pointMaterial.uniforms.uScale.value = scalePerPixel * size;
      for (const fov of [65, 72, 75, 82]) {
        camera.fov = fov; camera.updateProjectionMatrix();
        const sprite = draw(point, size), mesh = draw(plane, size);
        assert(mesh.width > 2 && mesh.height > 2 && mesh.width < nativeCap && mesh.height < nativeCap,
          'the reference mesh occupies measurable pixels below the native point cap');
        records.push({ size, fov, sprite, mesh });
      }
    }
    const sizeAttribute = pointGeometry.getAttribute('aSize');
    sizeAttribute.setX(0, .0001); sizeAttribute.needsUpdate = true;
    const minimum = draw(point, 384);
    assert(minimum.width === 1 && minimum.height === 1, 'subpixel smoke retains its one-pixel floor');
    const cap = Math.min(31, Math.floor(nativeCap / 2));
    assert(cap > 1, 'fixture can exercise a meaningful smoke size cap');
    pointMaterial.uniforms.uMaxSize.value = cap;
    sizeAttribute.setX(0, 100); sizeAttribute.needsUpdate = true;
    const capped = draw(point, 384);
    assert(capped.width === cap && capped.height === cap, 'large smoke obeys the uniform cap before hardware clamping');
    assert(gl.getError() === gl.NO_ERROR, 'smoke projection compiles and renders without WebGL errors');
    // Point and triangle rasterization can round opposite edges differently.
    // One pixel covers that quantization, while the old fixed lens misses by
    // several pixels at wider lens settings on both buffers.
    assert(records.every(({ sprite, mesh }) => Math.abs(sprite.width - mesh.width) <= 1
      && Math.abs(sprite.height - mesh.height) <= 1),
    'production smoke matches an equal world-sized mesh across live camera FOVs: ' + JSON.stringify(records));
    return { scalePerPixel, worldSize, nativeCap, records, minimum, cap, capped };
  } finally {
    pointGeometry.dispose(); pointMaterial.dispose(); planeGeometry.dispose(); planeMaterial.dispose();
    target.dispose(); renderer.dispose(); renderer.forceContextLoss();
  }
}
