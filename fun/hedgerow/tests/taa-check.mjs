// Run with: node fun/hedgerow/tests/taa-check.mjs
// Temporal reprojection must land on the pixels actually drawn last frame,
// including the eye-space rifle, and camera cuts must not keep stale history.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createTAA } = await import('../js/taa.js');
const { createMaterialLibrary } = await import('../js/materials.js');

const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.05, 1700);
camera.position.set(2, 1.7, 5);
camera.updateMatrixWorld();
const unjittered = camera.projectionMatrix.clone();
const inverse = camera.projectionMatrixInverse.clone();
const depth = new THREE.DepthTexture(1280, 720);
const taa = createTAA(camera, () => depth);
taa.setSize(1280, 720);
let target;
const historyTargets = new Set();
const materials = new Set();
const renderer = {
  setRenderTarget(value) { target = value; },
  render(quad) {
    materials.add(quad.material);
    if (quad.material.uniforms.tHistory) historyTargets.add(target);
  },
};
const input = { texture: new THREE.Texture() }, output = new THREE.WebGLRenderTarget(1280, 720);
const close = (a, b, message) => assert.ok(a.distanceTo(b) < 1e-9, message);
const project = (point, matrix) => {
  const p = new THREE.Vector4(...point, 1).applyMatrix4(matrix);
  return new THREE.Vector3(p.x / p.w, p.y / p.w, p.z / p.w);
};

taa.jitter();
const firstProjection = camera.projectionMatrix.clone();
const firstWorldProjection = new THREE.Matrix4().multiplyMatrices(firstProjection, camera.matrixWorldInverse);
taa.render(renderer, output, input);
assert.equal(taa.uniforms.uReset.value, 1, 'first frame starts clean');
taa.restore();
assert.deepEqual(camera.projectionMatrix.elements, unjittered.elements, 'jitter does not leak into simulation projection');
assert.deepEqual(camera.projectionMatrixInverse.elements, inverse.elements, 'inverse projection is restored too');

camera.position.x += 0.03;
camera.rotation.y += 0.01;
camera.updateMatrixWorld();
taa.jitter();
assert.notDeepEqual(camera.projectionMatrix.elements, firstProjection.elements, 'consecutive frames sample different subpixels');
taa.render(renderer, output, input);
assert.equal(taa.uniforms.uReset.value, 0, 'normal movement accumulates stable detail');
close(project([4, 2, -12], taa.uniforms.uPrevViewProj.value), project([4, 2, -12], firstWorldProjection),
  'static world geometry reprojects to the exact previous jittered pixel');
close(project([0.12, -0.16, -0.6], taa.uniforms.uPrevProj.value), project([0.12, -0.16, -0.6], firstProjection),
  'eye-space rifle reprojects between jitter offsets without following world camera motion');
taa.restore();

for (const [reason, cut] of [
  ['teleport', () => { camera.position.x += 3; }],
  ['sudden camera turn', () => { camera.rotation.y += Math.PI / 2; }],
  ['field-of-view cut', () => { camera.fov = 35; camera.updateProjectionMatrix(); }],
  ['resize', () => taa.setSize(800, 600)],
  ['explicit reset', () => taa.reset()],
]) {
  cut(); taa.jitter(); taa.render(renderer, output, input);
  assert.equal(taa.uniforms.uReset.value, 1, `${reason} rejects old history`);
  taa.restore();
  taa.jitter(); taa.render(renderer, output, input);
  assert.equal(taa.uniforms.uReset.value, 0, `${reason} resumes accumulation after one frame`);
  taa.restore();
}

let disposedTargets = 0, disposedMaterials = 0;
for (const t of historyTargets) t.addEventListener('dispose', () => disposedTargets++);
for (const m of materials) m.addEventListener('dispose', () => disposedMaterials++);
taa.dispose();
assert.equal(disposedTargets, 2, 'both history buffers release their GPU memory');
assert.equal(disposedMaterials, 2, 'both shader programs are disposed');
output.dispose(); depth.dispose(); input.texture.dispose();

// Imported atlas textures must retain their sRGB/data encoding and source
// sampler settings while gaining anisotropic detail at grazing angles.
const maps = Object.fromEntries(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].map(name => {
  const t = new THREE.Texture();
  t.colorSpace = name === 'map' || name === 'emissiveMap' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  return [name, t];
}));
const src = new THREE.MeshStandardMaterial(maps);
const library = createMaterialLibrary({}, { wet: { value: 1 }, rain: { value: 1 }, time: { value: 0 } });
const result = library.resolve(src);
for (const [slot, texture] of Object.entries(maps)) {
  assert.equal(result[slot], texture, `${slot}: keep the original texture and atlas UVs`);
  assert.equal(texture.anisotropy, 8, `${slot}: preserve surface detail at oblique angles`);
  assert.equal(texture.colorSpace, slot === 'map' || slot === 'emissiveMap' ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    `${slot}: filtering never changes colour/data encoding`);
  assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping, `${slot}: don't bleed across atlas boundaries`);
}
console.log('taa-check: exact world/weapon reprojection, camera cuts, disposal and baked atlas filtering pass');
