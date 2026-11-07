import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createMist } = await import('../js/atmosphere.js');

// A real, transformed flat water mesh. Its known world rectangle is
// x1..7, z−4..18 at y.75; no renderer or copied shader calculation is used.
const waterGeometry = new THREE.BufferGeometry();
waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
  -11, 0, -3, -11, 0, 3, 11, 0, -3, 11, 0, 3,
], 3));
waterGeometry.setIndex([0, 1, 2, 2, 1, 3]);
const waterMaterial = new THREE.MeshStandardMaterial();
const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.position.set(4, .75, 7);
water.rotation.y = Math.PI / 2;
const waterPositions = waterGeometry.attributes.position.array.slice();
const waterIndices = waterGeometry.index.array.slice();
let waterGeometryDisposals = 0, waterMaterialDisposals = 0;
waterGeometry.addEventListener('dispose', () => waterGeometryDisposals++);
waterMaterial.addEventListener('dispose', () => waterMaterialDisposals++);

const terrainCalls = [[], []];
const terrain = index => ({ height(x, z) {
  terrainCalls[index].push([x, z]);
  return .2 * Math.sin(x / 11) + .3 * Math.cos(z / 9);
} });
const density = (x, z) => (Math.floor(Math.abs(x) / 19) + Math.floor(Math.abs(z) / 23)) % 3 === 0 ? .15 : .9;
const dry = createMist({ terrain: terrain(0), density });
const river = createMist({ terrain: terrain(1), density, water });
const both = [dry, river];

for (const mist of both) {
  assert.equal(mist.mesh.geometry.instanceCount, 70, 'Default mist capacity is preserved');
  assert.equal(mist.mesh.geometry.index.count, 6, 'The same instanced quad is retained');
  assert.equal(mist.mesh.geometry.attributes.position.count, 4);
  assert.equal(mist.mesh.material.transparent, true);
  assert.equal(mist.mesh.material.blending, THREE.NormalBlending);
  assert.equal(mist.mesh.material.depthWrite, false);
  assert.equal(mist.mesh.material.depthTest, true);
  assert.equal(mist.mesh.material.fog, false);
  assert.equal(mist.mesh.renderOrder, 4);
  assert.equal(mist.mesh.frustumCulled, false);
  assert.equal(mist.uniforms.uOpacity.value, .16);
  assert.ok(mist.uniforms.uWaterBounds.value.toArray().every(Number.isFinite));
  assert.ok(Number.isFinite(mist.uniforms.uWaterLevel.value));
}
assert.equal(dry.uniforms.uWaterSoftness.value, 0, 'Omitting water keeps the new behavior inert');
const absent = dry.uniforms.uWaterBounds.value;
assert.ok(absent.x > absent.z && absent.y > absent.w, 'No-water bounds contain no point');
const bounds = river.uniforms.uWaterBounds.value.toArray();
for (let i = 0; i < 4; i++) assert.ok(Math.abs(bounds[i] - [1, -4, 7, 18][i]) < 1e-10, 'Water bounds come from the transformed geometry');
assert.equal(river.uniforms.uWaterLevel.value, .75);
assert.equal(river.uniforms.uWaterSoftness.value, .48);

const route = [
  [0, [0, 2, 0], 0],
  [1 / 60, [7, 3, -4], 0],
  [.33, [130, 5, 95], .6],
  [0, [-130, 5, 80], .6],
  [.08, [-128, 5, 82], .2],
  [.5, [0, 2, 0], 0],
];
let clock = 0, relocations = 0, previous = null;
for (const [dt, position, flash] of route) {
  clock += dt;
  for (const mist of both) mist.update(dt, new THREE.Vector3(...position), 9123, flash);
  for (const attribute of ['aMist', 'aSize', 'position', 'uv']) {
    assert.deepEqual(river.mesh.geometry.attributes[attribute].array, dry.mesh.geometry.attributes[attribute].array,
      'Adding water cannot change mist placement, seed, size or quad data');
    assert.ok(river.mesh.geometry.attributes[attribute].array.every(Number.isFinite));
  }
  assert.deepEqual(terrainCalls[1], terrainCalls[0], 'Water bounds add no terrain samples or RNG-dependent placement changes');
  assert.equal(river.uniforms.uTime.value, clock, 'Noise/drift time uses the same update clock');
  assert.equal(dry.uniforms.uTime.value, clock);
  assert.equal(river.uniforms.uFlash.value, flash);
  assert.deepEqual(river.uniforms.uColor.value, dry.uniforms.uColor.value);
  const current = river.mesh.geometry.attributes.aMist.array;
  if (previous && current.some((value, i) => value !== previous[i])) relocations++;
  previous = current.slice();
}
assert.ok(relocations >= 3 && terrainCalls[0].length > 70, 'The paired test exercises repeated relocation rather than only initial zero arrays');
assert.deepEqual(waterGeometry.attributes.position.array, waterPositions);
assert.deepEqual(waterGeometry.index.array, waterIndices);

const custom = createMist({ count: 11, terrain: terrain(0), water: null });
assert.equal(custom.mesh.geometry.instanceCount, 11);
assert.equal(custom.uniforms.uWaterSoftness.value, 0, 'Explicit null water also remains inert');
for (const mist of [...both, custom]) {
  assert.notEqual(mist.mesh.geometry, waterGeometry);
  assert.notEqual(mist.mesh.material, waterMaterial);
  // This factory exposes its own mesh, not a water owner. Consumer cleanup
  // disposes only those owned mesh resources, as for the original factory.
  mist.mesh.geometry.dispose();
  mist.mesh.material.dispose();
}
assert.equal(waterGeometryDisposals, 0, 'Mist cleanup never disposes the borrowed water geometry');
assert.equal(waterMaterialDisposals, 0, 'Mist cleanup never disposes the borrowed water material');
waterGeometry.dispose(); waterMaterial.dispose();
assert.equal(waterGeometryDisposals, 1); assert.equal(waterMaterialDisposals, 1);
console.log(`mist-water-fade-check: paired ${route.length} updates / ${relocations} relocations preserve placement, seeds, sizes and clock; transformed bounds and borrowed water ownership pass`);
