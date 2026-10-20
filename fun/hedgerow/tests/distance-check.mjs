// Run with: node fun/hedgerow/tests/distance-check.mjs
// The land beyond the level (js/distance.js), built with stand-in meshes for
// the nature set's far models: the treeline tiles must face the level, half
// of them mirrored, their bases below the far ground, and none may stand
// between the level and the far buildings (the next village must show).
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const THREE = await import('three');
const { buildDistance } = await import('../js/distance.js');
const { default: L } = await import('../js/levels/saint-clair.js');

// the far models the nature GLB really has (geometry is not needed here)
const b = readFileSync(new URL('../assets/models/nature.glb', import.meta.url));
const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
const mat = new THREE.MeshBasicMaterial();
const models = new Map(j.nodes.filter((n) => /_lod$|^treeline|^hill_trees/.test(n.name))
  .map((n) => [n.name, { name: n.name, prims: [{ geometry: new THREE.BufferGeometry(), material: mat }] }]));
for (const name of ['treeline_far', 'treeline_far_b', 'hill_trees_lod']) assert.ok(models.has(name), `nature.glb has no ${name}`);

const far = buildDistance({}, L, { models, matlib: { resolve: (m) => m }, material: mat });
const B = L.bounds;
const toBounds = (x, z) => [Math.min(B.maxX, Math.max(B.minX, x)), Math.min(B.maxZ, Math.max(B.minZ, z))];
const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
const tiles = [];
for (const mesh of far.group.children) {
  if (!mesh.isInstancedMesh || !/treeline/.test(mesh.name)) continue;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m4);
    m4.decompose(p, q, sc);
    tiles.push({ x: p.x, y: p.y, z: p.z, fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(q), mirrored: m4.determinant() < 0 });
  }
}
assert.ok(tiles.length > 100, `only ${tiles.length} treeline tiles`);
assert.ok(far.group.children.some((m) => m.name === 'far:hill_trees_lod' && m.count > 50), 'no copses on the far hills');

for (const t of tiles) {
  const [bx, bz] = toBounds(t.x, t.z);
  const to = new THREE.Vector3(bx - t.x, 0, bz - t.z).normalize();
  assert.ok(t.fwd.dot(to) > 0.98, `a tile at (${t.x.toFixed(0)}, ${t.z.toFixed(0)}) does not face the level`);
  assert.ok(t.y < far.height(t.x, t.z), `a tile at (${t.x.toFixed(0)}, ${t.z.toFixed(0)}) floats above the ground`);
}
const mirrored = tiles.filter((t) => t.mirrored).length;
assert.ok(Math.abs(mirrored / tiles.length - 0.5) < 0.1, `${mirrored} of ${tiles.length} tiles mirrored`);

for (const bd of L.far.buildings) {
  const [ax, az] = toBounds(bd.x, bd.z);
  const dx = bd.x - ax, dz = bd.z - az;
  for (const t of tiles) {
    const k = Math.max(0, Math.min(1, ((t.x - ax) * dx + (t.z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(t.x - ax - dx * k, t.z - az - dz * k);
    assert.ok(d >= 75, `a treeline tile at (${t.x.toFixed(0)}, ${t.z.toFixed(0)}) hides the far ${bd.m} at (${bd.x}, ${bd.z})`);
  }
}
console.log(`distance-check: ${tiles.length} treeline tiles face the level (${mirrored} mirrored), sunk in the ground, clear of ${L.far.buildings.length} far buildings; ${far.farTrees} far trees`);
