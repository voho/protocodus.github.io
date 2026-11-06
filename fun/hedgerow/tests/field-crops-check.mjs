import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createFieldCrops, cropPlotsFor, CROP_WIND_ENVELOPE } = await import('../js/field-crops.js');
const matlib = { get: () => new THREE.MeshStandardMaterial() };
const height = (x, z) => 2 + x * 0.02 + z * 0.01;
const exclusion = { x0: -1.5, x1: 1.5, z0: -12, z1: 12 };
const level = { id: 'authored-field', crops: [{ x0: -9, x1: 9, z0: -12, z1: 12, rowYaw: 11,
  headland: 1.2, height: 0.9, exclusions: [exclusion], seed: 1944 }] };
const shared = { time: { value: 12.5 } };
const a = createFieldCrops(level, height, matlib, { shared, wind: [1.3, 0.6] }), b = createFieldCrops(level, height, matlib);
assert.ok(a.plants > 1000 && a.plants < 4096, 'small authored plot is densely planted within the scene budget');
assert.deepEqual(a.roots, b.roots, 'row positions, crop heights and gaps are deterministic');
for (const root of a.roots) {
  assert.equal(root.y, height(root.x, root.z), 'each crop root follows the actual ground');
  assert.ok(root.x >= -7.8 && root.x <= 7.8 && root.z >= -10.8 && root.z <= 10.8, 'headlands remain outside the planted rows');
  assert.ok(root.x < exclusion.x0 || root.x > exclusion.x1, 'explicit route exclusion stays clear');
  assert.ok(root.height >= 0.72 && root.height <= 0.9, 'green June cereal remains below the crouching eye line');
}
let instanceCount = 0;
for (const mesh of a.group.children) {
  instanceCount += mesh.count;
  assert.equal(mesh.matrixAutoUpdate, false, 'static plots require no matrix updates');
  assert.equal(mesh.instanceMatrix.usage, THREE.StaticDrawUsage);
  assert.equal(mesh.castShadow, false, 'individual stems do not multiply local lamp shadow passes');
  assert.equal(mesh.material.transparent, false, 'cereal uses opaque geometry rather than sorted alpha cards');
  assert.ok(mesh.boundingSphere.radius > 0 && Number.isFinite(mesh.boundingSphere.radius), 'each worldcell has a finite culling bound');
  const expanded = mesh.boundingSphere.radius; mesh.computeBoundingSphere();
  const maximumMotion = Math.hypot(0.033, 0.012) * 1.16 + 0.008; // scaled crop wave plus conservative inherited foliage sway
  assert.ok(maximumMotion <= CROP_WIND_ENVELOPE && expanded - mesh.boundingSphere.radius >= maximumMotion,
    'static culling bounds include the entire bounded wind envelope');
  mesh.boundingSphere.radius = expanded;
  for (const attr of Object.values(mesh.geometry.attributes)) assert.ok(attr.array.every(Number.isFinite), 'all geometry attributes are finite');
  const normals = mesh.geometry.attributes.normal;
  for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 1e-5, 'lighting normals have unit length');
}
const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>' };
a.group.children[0].material.onBeforeCompile(shader);
assert.equal(shader.uniforms.uCropTime, shared.time, 'wind reads the existing shared simulation time without CPU frame updates');
assert.ok(Math.abs(shader.uniforms.uCropWind.value.length() - 1) < 1e-6 && shader.uniforms.uCropWind.value.toArray().every(Number.isFinite),
  'the wind direction is finite and normalized');
assert.ok(shader.vertexShader.includes('cropWeight *= cropWeight') && shader.vertexShader.includes('position.y, 0.0, 1.0'),
  'wind weighting leaves ground roots fixed and bends the stem towards its tip');
assert.equal(instanceCount, a.plants);
assert.ok(a.group.children.length <= 4, 'nearby cereal stalks share static cell draws');
assert.ok(a.triangles <= 147456, 'the full scene has a hard triangle cap');
assert.equal(createFieldCrops(level, height, matlib, { enabled: false }), null, 'low quality can omit crop geometry entirely');
assert.equal(createFieldCrops({ id: 'prague' }, height, matlib), null, 'urban missions receive no default agricultural dressing');
assert.equal(createFieldCrops({ id: 'saint-clair', crops: [] }, height, matlib), null, 'explicit empty authored plots override defaults');
assert.equal(createFieldCrops({ crops: [{ x0: -1e20, x1: 1e20, z0: -1e20, z1: 1e20 }] }, height, matlib), null,
  'unreasonable extents cannot produce an unbounded candidate loop');
assert.equal(createFieldCrops(level, () => NaN, matlib), null, 'invalid terrain height produces no detached geometry');
const capped = createFieldCrops({ crops: Array.from({ length: 40 }, (_, i) => ({ x0: i * 70, x1: i * 70 + 60, z0: 0, z1: 60, height: 100 })) }, height, matlib, { maxPlants: 1e9 });
assert.equal(capped.plants, 4096); assert.ok(capped.roots.every(r => r.height <= 1.05));
assert.ok(capped.triangles <= 147456);
for (const id of ['saint-clair', 'la-varenne']) {
  const { default: L } = await import(`../js/levels/${id}.js`);
  assert.ok(cropPlotsFor(L).length);
  const real = createFieldCrops(L, L.baseHeight, matlib);
  assert.ok(real.plants > 1000 && real.triangles < 55000 && real.group.children.length <= 2, `${id} stays within its small per-mission field budget`);
  real.dispose();
}
a.dispose(); b.dispose(); capped.dispose();
assert.equal(a.group.children.length, 0, 'shared crop geometry can be released cleanly');
console.log('field-crops-check: ground contact, authored rows/headlands/routes, deterministic density, finite geometry, opaque static batching and hard scene/candidate budgets pass');
