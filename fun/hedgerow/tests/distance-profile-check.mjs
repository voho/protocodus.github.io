// Explicit horizon profiles control vegetation and ground independently of
// the mission catalog; zero tree range remains valid on a Normandy level.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
import { readFileSync } from 'node:fs';
const { buildDistance } = await import('../js/distance.js');
import L from '../js/levels/saint-clair.js';
const custom = {...L, id:'distance-profile-fixture', far:{urban:true,radius:380,treeRange:0,treelines:false,height:()=>0}};
const b = readFileSync(new URL('../assets/models/nature.glb', import.meta.url));
const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
const material = new THREE.MeshBasicMaterial();
const models = new Map(j.nodes.filter((n) => /_lod$|^treeline|^hill_trees/.test(n.name)).map((n) => [n.name, {
  name: n.name, prims: [{ geometry: new THREE.BufferGeometry(), material }],
}]));
const args = { models, matlib: { resolve: (m) => m }, material };
const urban = buildDistance({}, custom, args);
assert.equal(urban.farTrees, 0); assert.equal(urban.treelines, 0);
assert.ok(!urban.group.children.some((m) => m.isInstancedMesh), 'urban preset adds no rural foliage');
const splat = urban.group.getObjectByName('far_ground').geometry.attributes.splat;
for (let i = 0; i < splat.count; i++) {
  assert.equal(splat.getY(i), 0, 'urban background has no pasture');
  assert.equal(splat.getZ(i), 0, 'urban background has no forest floor');
  assert.ok(splat.getW(i) > 0.9, 'urban background is paved');
}
// Explicit options still work independently of the urban preset.
const noTrees = buildDistance({}, { ...L, far: { radius: 380, treeRange: 0, treelines: false } }, args);
assert.equal(noTrees.farTrees, 0); assert.equal(noTrees.treelines, 0);
const rural = buildDistance({}, { ...L, far: { radius: 380 } }, args);
assert.ok(rural.farTrees > 500, 'default rural vegetation remains enabled');
assert.ok(rural.treelines > 100, 'default rural horizon remains enabled');
console.log(`distance-profile-check: explicit paved horizon omits countryside; explicit zero range respected; rural control retains ${rural.farTrees} trees/${rural.treelines} treelines`);
