// In an isolated page served from /fun/alpen/:
// await (await import('./tests/forest-clip-browser-check.mjs')).runForestClipCheck()
// Real tree geometry, atlases and material patches, rendered without the game loop.
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createProps } from '../js/props.js';
import { createShading } from '../js/shading.js';
import { allTracked } from '../js/loading.js';
import { getWorldSeed, setWorldSeed } from '../js/noise.js';

const SIZE = 256;
const CLIP = 'if (vLodFar >= 220.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);';

export async function runForestClipCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const shading = createShading(THREE);
  const props = createProps(THREE, shading);
  await allTracked();
  const savedSeed = getWorldSeed();
  try {
    setWorldSeed('forest-perf');
    props.reset(0);
    props.update(0, 1);
  } finally {
    setWorldSeed(savedSeed);
  }
  const sources = [];
  for (const mesh of props.group.children) {
    if (!mesh.material) continue;
    const shader = {
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader, uniforms: {},
    };
    mesh.material.onBeforeCompile(shader);
    if (shader.vertexShader.includes(CLIP)) sources.push(mesh);
  }
  assert(sources.length > 0, 'the real forest must load with its near-tree LOD material');
  const source = sources[0];
  const farSource = props.group.children.find(mesh => mesh.name === 'far-forest');
  assert(farSource, 'the matching far-forest impostor must load');
  const renderer = new THREE.WebGLRenderer({
    canvas: new OffscreenCanvas(SIZE, SIZE), antialias: false,
  });
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE);
  renderer.setRenderTarget(target);
  renderer.setClearColor('#3a7cb0', 1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x778899, 3));
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(10, 30, 20);
  scene.add(sun);
  source.geometry.computeBoundingBox();
  const height = source.geometry.boundingBox.max.y;
  const camera = new THREE.OrthographicCamera(
    -height * 0.55, height * 0.55, height * 0.55, -height * 0.55, 0.1, 1000,
  );
  // Keep every production material patch, removing only the new early clip.
  const legacy = source.material.clone();
  legacy.onBeforeCompile = (shader, ...rest) => {
    source.material.onBeforeCompile(shader, ...rest);
    assert(shader.vertexShader.includes(CLIP), 'find the early clip in the production shader');
    shader.vertexShader = shader.vertexShader.replace(CLIP, '');
  };
  legacy.customProgramCacheKey = () => source.material.customProgramCacheKey() + '|unclipped';
  const instance = (mesh) => {
    const result = new THREE.InstancedMesh(mesh.geometry, mesh.material, 1);
    result.setMatrixAt(0, new THREE.Matrix4());
    result.setColorAt(0, new THREE.Color(0xffffff));
    result.frustumCulled = false;
    scene.add(result);
    return result;
  };
  const tree = instance(source), card = instance(farSource);
  const draw = () => {
    renderer.clear();
    renderer.render(scene, camera);
    const bytes = new Uint8Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, bytes);
    return bytes;
  };
  try {
    tree.visible = card.visible = false;
    const empty = draw();
    tree.visible = card.visible = true;
    const records = [];
    for (const distance of [100, 170, 200, 219.999, 220, 220.001, 300]) {
      for (const bearing of [0, 1.1]) {
        camera.position.set(Math.sin(bearing) * distance, height / 2,
          Math.cos(bearing) * distance);
        camera.lookAt(0, height / 2, 0);
        camera.updateMatrixWorld();
        tree.material = legacy;
        const before = draw();
        tree.material = source.material;
        const after = draw();
        let changed = 0, coverage = 0;
        for (let i = 0; i < before.length; i++) {
          if (before[i] !== after[i]) changed++;
          if (before[i] !== empty[i]) coverage++;
        }
        assert(coverage > 100, `visible forest fixture at ${distance} m / ${bearing}`);
        assert(changed === 0, `early clipping changes no pixels at ${distance} m / ${bearing}`);
        records.push({ distance, bearing, changed, coverage });
      }
    }
    // The sun's depth pass must still see trees beyond the colour LOD cutoff.
    card.visible = false;
    tree.material = source.customDepthMaterial;
    const shadow = draw();
    assert(shadow.some((byte, i) => byte !== empty[i]),
      'distant detailed trees retain their shadow silhouette');
    let total = 0, clipped = 0;
    for (const mesh of sources) for (let i = 0; i < mesh.count; i++) {
      const matrix = mesh.instanceMatrix.array;
      total++;
      if (Math.hypot(matrix[i * 16 + 12], matrix[i * 16 + 14]) >= 220) clipped++;
    }
    assert(clipped > 0, 'the streamed forest contains fully faded detailed trees');
    assert(renderer.getContext().getError() === renderer.getContext().NO_ERROR,
      'tree and depth shaders compile and render without WebGL errors');
    return { cases: records, nearInstances: total, fullyFadedInstances: clipped };
  } finally {
    legacy.dispose();
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
