// Run with: node fun/hedgerow/tests/hay-detail-check.mjs
// Use the shipped haystack shell to catch detached fringe, unbounded detail
// growth, non-determinism, and accidental per-stalk draw calls.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const THREE = await import('three');
const { createHayDetail } = await import('../js/hay-detail.js');

// Decode only the original mesh attributes: images are unnecessary here.
const data = readFileSync(new URL('../assets/models/village.glb', import.meta.url));
const size = data.readUInt32LE(12), json = JSON.parse(data.subarray(20, 20 + size));
const bin = data.subarray(28 + size);
const node = json.nodes.find(n => n.name === 'haystack');
const read = (index) => {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView];
  const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
  assert.ok(C && !view.byteStride, 'fixture remains a packed supported glTF accessor');
  const n = a.count * ({ VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type]);
  return new C(bin.buffer, bin.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0), n).slice();
};
const model = { name: 'haystack', box: new THREE.Box3(), prims: [] };
for (const prim of json.meshes[node.mesh].primitives) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(read(prim.attributes.POSITION), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(read(prim.attributes.NORMAL), 3));
  if (prim.indices !== undefined) geometry.setIndex(new THREE.BufferAttribute(read(prim.indices), 1));
  geometry.computeBoundingBox(); model.box.union(geometry.boundingBox); model.prims.push({ geometry });
}
const original = model.prims[0].geometry.attributes.position.array.slice();
const material = new THREE.MeshStandardMaterial();
const matlib = { get: () => material };
const props = [{ m: model, x: 3, y: 1.2, z: 7, yaw: 0.6, scale: 1 }, { m: model, x: 9, y: 1.2, z: 11, yaw: -0.2, scale: 0.7 }];
const a = createHayDetail(props, matlib), b = createHayDetail(props, matlib);
assert.equal(a.stacks, 2); assert.equal(a.triangles, 4080); assert.equal(a.group.children.length, 1, 'nearby stacks share one static draw');
assert.equal(createHayDetail(props, matlib, { enabled: false }), null, 'low quality can omit all detail work');
assert.equal(createHayDetail([], matlib), null, 'missions without hay allocate nothing');
assert.deepEqual(a.group.children[0].geometry.attributes.position.array, b.group.children[0].geometry.attributes.position.array,
  'same placed haystacks always receive the same straw');
assert.deepEqual(model.prims[0].geometry.attributes.position.array, original, 'the original solid GLB silhouette is preserved');
for (const mesh of a.group.children) {
  assert.equal(mesh.castShadow, false, 'tiny stalks do not add six-face lamp shadow work');
  assert.equal(mesh.matrixAutoUpdate, false, 'static detail needs no matrix updates');
  assert.equal(mesh.material.transparent, false, 'opaque ribbons avoid alpha sorting and cutout overdraw');
  for (const attr of Object.values(mesh.geometry.attributes)) assert.ok(attr.array.every(Number.isFinite), 'all geometry attributes are finite');
  const n = mesh.geometry.attributes.normal;
  for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-5, 'straw lighting normals are unit length');
}
const single = createHayDetail([props[0]], matlib);
const box = single.group.children[0].geometry.boundingBox;
assert.ok(box.min.y >= props[0].y + model.box.min.y && box.max.y <= props[0].y + model.box.max.y,
  'fringe stays above the soil and below the retaining stake');
const dx = Math.max(Math.abs(box.min.x - props[0].x), Math.abs(box.max.x - props[0].x));
const dz = Math.max(Math.abs(box.min.z - props[0].z), Math.abs(box.max.z - props[0].z));
assert.ok(dx < 1.95 && dz < 1.95, 'loose straw stays within a few centimetres of the existing mass');
const bounded = createHayDetail(Array.from({ length: 40 }, (_, i) => ({ ...props[0], x: i * 60 })), matlib, { tufts: 10000, maxStacks: 10000 });
assert.equal(bounded.stacks, 24, 'scene-wide stack count is capped');
assert.ok(bounded.triangles <= 63360, 'oversized detail requests stay within the hard triangle budget');
a.dispose(); b.dispose(); single.dispose(); bounded.dispose();
assert.equal(a.group.children.length, 0, 'detail geometry can be released cleanly');
console.log('hay-detail-check: real GLB surface anchoring, deterministic straw, shared static draws, intact original mesh, finite normals and hard scene budget pass');
