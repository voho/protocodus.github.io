// In a served Alpen page:
// await (await import('./tests/shade-radius-browser-check.mjs')).runShadeRadiusCheck()
// Compare complete production snow shaders against unconditional horizon reads.
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createShading } from '../js/shading.js';
import { createWeather } from '../js/weather.js';
import { TERRAIN } from '../js/config.js';

export async function runShadeRadiusCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const SIZE = 128;
  const spacing = 2 * TERRAIN.shade.half / TERRAIN.shade.size;
  const radius = Math.min(TERRAIN.shade.half, 2 * TERRAIN.shade.tileSamples * spacing - 6);
  const renderer = new THREE.WebGLRenderer({
    canvas: new OffscreenCanvas(SIZE, SIZE), antialias: false,
  });
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: false });
  const geometry = new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2);
  const shading = createShading(THREE);
  const neutralTextures = new Set(Object.values(shading.uniforms).map(u => u.value).filter(v => v?.isTexture));
  const horizon = new THREE.DataTexture(new Float32Array([0.5, 0.2]), 1, 1, THREE.RGFormat, THREE.FloatType);
  const height = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
  const sky = new THREE.DataTexture(new Uint8Array([120, 160, 210, 255]), 1, 1);
  for (const texture of [horizon, height, sky]) {
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  }
  shading.uniforms.uShadeMap.value = horizon;
  shading.uniforms.uShadeHeightMap.value = height;
  shading.uniforms.uSkyProbe.value = sky;
  const production = shading.apply(new THREE.MeshLambertMaterial({ color: 0xc8d8e4 }), { sheen: 1, fog: false });
  const reference = shading.apply(new THREE.MeshLambertMaterial({ color: 0xc8d8e4 }), { sheen: 1, fog: false });
  const originalCompile = reference.onBeforeCompile;
  const originalKey = reference.customProgramCacheKey;
  reference.onBeforeCompile = (shader, renderer) => {
    originalCompile(shader, renderer);
    assert(shader.fragmentShader.includes('if (n64ShadeIn > 0.0)'), 'find the production horizon guard');
    shader.fragmentShader = shader.fragmentShader.replace('if (n64ShadeIn > 0.0)', 'if (true)');
  };
  reference.customProgramCacheKey = () => originalKey() + '|unconditional-horizon';
  const scene = new THREE.Scene(), receiver = new THREE.Mesh(geometry, production);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  const fill = new THREE.HemisphereLight(0x9fc4f5, 0xced8e4, 0.45);
  scene.add(receiver, sun, sun.target, fill);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
  camera.position.set(0, 100, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const weather = createWeather(THREE);
  weather.pin(0.45); weather.update(0);
  const w = weather.state;
  const draw = (material, distance, raised, slope, cloud, shadeLevel = 0.85) => {
    w.azimuth = 0.6;
    w.elevation = Math.atan(slope);
    shading.update(w, camera, 0);
    const uniforms = shading.uniforms;
    uniforms.uShadeLevel.value = shadeLevel;
    uniforms.uShadeSlice.value = 0.35;
    uniforms.uCloud.value = cloud;
    uniforms.uSunLevel.value = 1.2;
    // Keep the directional key aligned with the shared sun in the full shader.
    sun.position.copy(uniforms.uSunDir.value).multiplyScalar(100);
    receiver.position.set(distance, raised, 0);
    receiver.material = material;
    camera.left = distance - 10;
    camera.right = distance + 10;
    camera.updateProjectionMatrix();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    return pixels;
  };
  const differences = (a, b) => {
    let largest = 0, changed = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      largest = Math.max(largest, d);
      changed += d > 0;
    }
    return { largest, changed };
  };
  try {
    let cases = 0, largest = 0;
    for (const raised of [0, 7, 24]) {
      for (const slope of [0.15, 0.35, 0.9]) {
        for (const cloud of [0, 0.8]) {
          // The non-integer offset puts the radius crossing through 2x2
          // derivative groups; all cloud gradients must remain well-defined.
          for (const distance of [0, radius * 0.82, radius - 0.2, radius + 0.2, radius + 15, 600]) {
            const a = draw(reference, distance, raised, slope, cloud);
            const b = draw(production, distance, raised, slope, cloud);
            const delta = differences(a, b);
            largest = Math.max(largest, delta.largest);
            assert(delta.largest <= 1, `horizon guard changes full-shader output: ${JSON.stringify({ raised, slope, cloud, distance, delta })}`);
            cases++;
          }
        }
      }
    }
    const ground = draw(production, 30, 0, 0.35, 0);
    const groundUnshaded = draw(production, 30, 0, 0.35, 0, 0);
    const raised = draw(production, 30, 24, 0.35, 0);
    const horizonEffect = differences(ground, groundUnshaded);
    const raisedEffect = differences(ground, raised);
    assert(horizonEffect.largest > 10 && raisedEffect.largest > 10,
      'the full-shader fixture visibly exercises horizon shade and its raised layer');
    const farCloud = draw(production, 600, 0, 0.9, 0.8);
    const farClear = draw(production, 600, 0, 0.9, 0);
    const cloudEffect = differences(farCloud, farClear);
    assert(cloudEffect.largest > 1 && cloudEffect.changed > SIZE,
      'cloud shade still affects receivers outside the horizon radius');
    assert(renderer.getContext().getError() === renderer.getContext().NO_ERROR, 'no WebGL errors');
    return { cases, radius, largest, horizonEffect, raisedEffect, cloudEffect };
  } finally {
    production.dispose(); reference.dispose(); target.dispose(); geometry.dispose();
    for (const texture of [...neutralTextures, horizon, height, sky]) texture.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
}
