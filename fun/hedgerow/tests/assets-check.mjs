// Run with: node fun/hedgerow/tests/assets-check.mjs
// Indexed imports must draw exactly the old triangles, including normals,
// texture seams and vertex colours. Check every shipped static model, mixed
// static batches, the flat-normal fallback and parachutes fitted to trees.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const THREE = await import('three');
const { GLTFLoader } = await import('../assets/vendor/GLTFLoader.js');
const { readSet, createStaticBatcher } = await import('../js/assets.js');
const { createChutes } = await import('../js/chutes.js');

// Decode the real geometry without loading browser-only texture images.
async function parse(name) {
  const b = readFileSync(new URL(`../assets/models/${name}.glb`, import.meta.url));
  const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl));
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials || []) {
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
  for (const k of ['extensionsUsed', 'extensionsRequired']) {
    j[k] = (j[k] || []).filter(e => e !== 'EXT_texture_webp');
    if (!j[k].length) delete j[k];
  }
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const bin = b.subarray(20 + jl), head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length + bin.length, 8);
  head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const glb = Buffer.concat([head, json, bin]);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length), '');
}

function expandedScene(scene) {
  const copy = scene.clone(true);
  copy.traverse(o => { if (o.isMesh) o.geometry = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); });
  return copy;
}
const expanded = g => g.index ? g.toNonIndexed() : g;
function sameTriangles(actual, expected, label) {
  const a = expanded(actual), e = expanded(expected);
  assert.deepEqual(Object.keys(a.attributes).sort(), Object.keys(e.attributes).sort(), label);
  for (const name of Object.keys(e.attributes)) assert.deepEqual(a.attributes[name].array, e.attributes[name].array, `${label}: ${name}`);
  if (a !== actual) a.dispose();
  if (e !== expected) e.dispose();
}
function bytes(g) { return Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, g.index?.array.byteLength || 0); }

let verticesBefore = 0, verticesAfter = 0, bytesBefore = 0, bytesAfter = 0, checked = 0;
let nature, oldNature;
for (const set of ['village', 'military', 'nature', 'weapons']) {
  const gltf = await parse(set), actual = new Map(), expected = new Map();
  readSet(gltf, set, actual);
  readSet({ scene: expandedScene(gltf.scene) }, set, expected);
  assert.equal(actual.size, expected.size);
  for (const [name, model] of actual) {
    const old = expected.get(name);
    assert.deepEqual(model.box, old.box, `${name}: bounds`);
    assert.deepEqual(model.colliders, old.colliders, `${name}: colliders`);
    assert.deepEqual(model.anchors, old.anchors, `${name}: anchors`);
    assert.equal(model.prims.length, old.prims.length);
    model.prims.forEach((p, i) => {
      const before = old.prims[i].geometry;
      sameTriangles(p.geometry, before, `${set}/${name}/${i}`);
      if (set === 'village') assert.equal(p.geometry.index, null, 'window extraction retains flat triangles');
      else assert.ok(p.geometry.index, 'authored indices are retained');
      verticesBefore += before.attributes.position.count; verticesAfter += p.geometry.attributes.position.count;
      bytesBefore += bytes(before); bytesAfter += bytes(p.geometry); checked++;
    });
  }
  if (set === 'nature') { nature = actual; oldNature = expected; }
}
assert.ok(verticesAfter < verticesBefore * 0.7, 'substantial vertex reuse across the shipped models');
assert.ok(bytesAfter < bytesBefore * 0.75, 'index buffers still leave a substantial memory saving');

// An indexed shape without normals must still get the old flat shading.
const flatRoot = new THREE.Group(), flatMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
flatMesh.geometry.deleteAttribute('normal'); flatMesh.name = 'flat'; flatRoot.add(flatMesh);
const flat = new Map(), oldFlat = new Map();
readSet({ scene: flatRoot }, 'military', flat);
readSet({ scene: expandedScene(flatRoot) }, 'military', oldFlat);
assert.equal(flat.get('flat').prims[0].geometry.index, null);
sameTriangles(flat.get('flat').prims[0].geometry, oldFlat.get('flat').prims[0].geometry, 'flat fallback');

// Palette materials may combine both layouts in either insertion order.
const mat = new THREE.MeshBasicMaterial(), matlib = { resolve: () => mat };
const indexed = new THREE.BoxGeometry(1, 2, 3), unindexed = new THREE.BoxGeometry(2, 1, 1).toNonIndexed();
const matrix = new THREE.Matrix4().makeRotationY(0.37).setPosition(2, 4, 6);
for (const geometries of [[indexed, unindexed], [unindexed, indexed], [unindexed, unindexed]]) {
  const batch = createStaticBatcher(matlib);
  for (const geometry of geometries) batch.add({ prims: [{ geometry, material: mat }] }, matrix);
  const meshes = batch.build().children;
  assert.equal(meshes.length, 1, 'mixed inputs remain one draw without losing a placement');
  const actual = expanded(meshes[0].geometry);
  for (const key of Object.keys(actual.attributes)) {
    const expected = geometries.map(g => expanded(g.clone().applyMatrix4(matrix)).attributes[key].array);
    assert.deepEqual(Array.from(actual.attributes[key].array), expected.flatMap(a => Array.from(a)), `mixed batch: ${key}`);
  }
}

// Crown quantiles used to count every triangle corner. Indexing must not
// change the selected trees or the resulting canopy/rigging geometry.
function chutes(models) {
  const model = models.get('oak_a');
  const items = [[8, 330], [-8, 395], [8, 460]].map(([x, z]) => ({ x, y: 0, z,
    m: new THREE.Matrix4().makeScale(0.7, 0.7, 0.7).setPosition(x, 0, z) }));
  const veg = { kinds: new Map([['oak_a', { name: 'oak_a', model, items }]]) };
  return createChutes(veg, { TRACK: [[0, 300], [0, 480]] }, { height: () => 0 }, { time: { value: 0 }, wet: { value: 1 } });
}
const nextChutes = chutes(nature), previousChutes = chutes(oldNature);
assert.ok(nextChutes?.count, 'fixture has hanging parachutes');
assert.deepEqual(nextChutes.at, previousChutes.at, 'same trees carry the parachutes');
nextChutes.group.children.forEach((m, i) => sameTriangles(m.geometry, previousChutes.group.children[i].geometry, m.name));

console.log(`assets-check: ${checked} shipped primitives retain exact triangle attributes; vertices ${verticesBefore} → ${verticesAfter}, geometry bytes ${bytesBefore} → ${bytesAfter}; mixed batches, flat normals and parachutes preserved`);
