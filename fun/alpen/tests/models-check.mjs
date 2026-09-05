import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';

// Run with: node tests/models-check.mjs
const base = new URL('../', import.meta.url);
// Geometry builders stay private in production; expose them only in this smoke check.
async function load(file, exports = []) {
  const url = new URL('js/' + file, base);
  let source = await readFile(url, 'utf8');
  source = source.replace(/^import \{ GLTFLoader \}.*$/m, '')
    .replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
      (_, quote, path) => `from ${quote}${new URL(path, url).href}${quote}`)
    .replaceAll('import.meta.url', JSON.stringify(url.href));
  if (exports.length) source += '\nexport { ' + exports.join(', ') + ' };';
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

function valid(name, geo) {
  assert.ok(geo.attributes.position.count > 0, name);
  for (const [key, attribute] of Object.entries(geo.attributes)) {
    assert.equal(attribute.count, geo.attributes.position.count, name + ': aligned ' + key);
    assert.ok(attribute.array.every(Number.isFinite), name + ': finite ' + key);
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  assert.ok(Number.isFinite(geo.boundingSphere.radius) && geo.boundingSphere.radius > 0, name);
  if (geo.index) assert.ok(geo.index.array.every(i => i < geo.attributes.position.count), name);
  return (geo.index?.count ?? geo.attributes.position.count) / 3;
}

const wildlifeNames = ['rabbitGeometry', 'deerBodyGeometry', 'deerHeadGeometry', 'wolfGeometry'];
const wildlife = await load('wildlife.js', wildlifeNames);
const triangleBudgets = [4500, 2000, 1200, 3200];
for (const key of wildlifeNames) {
  const triangles = valid(key, wildlife[key](THREE, true));
  assert.ok(triangles <= triangleBudgets[wildlifeNames.indexOf(key)], key + ': triangle budget');
}

const huts = await load('huts.js', ['hutGeometry', 'paneGeometry']);
for (const key of ['hutGeometry', 'paneGeometry']) valid(key, huts[key](THREE));
const rider = await load('riderModel.js', ['buildGeometries']);
for (const [key, geo] of Object.entries(rider.buildGeometries(THREE))) {
  if (geo?.isBufferGeometry) valid('rider.' + key, geo);
}

const { growCardSpruce } = await load('spruce.js');
const spec = { whorls: [7, 10], perWhorl: [4, 6], bareTo: 0.12,
  reach: 0.21, liftLow: -0.1, liftHigh: 0.5, droop: 0.3, snow: 0.65, spire: 1.5, flag: 0.25 };
for (let i = 0; i < 20; i++) {
  const tree = growCardSpruce(THREE, i * 7121, spec, 8 + i);
  const count = valid('tree.' + i, tree);
  assert.ok(count < 1000, 'bounded tree complexity');
  assert.ok(tree.boundingBox.max.x - tree.boundingBox.min.x < (8 + i) * 0.8,
    'conifer crowns leave a readable downhill corridor');
  const again = growCardSpruce(THREE, i * 7121, spec, 8 + i);
  assert.deepEqual(tree.attributes.position.array, again.attributes.position.array, 'seeded model stability');
}

const { bakeTexturedGeometry } = await load('importedModels.js');
const scene = new THREE.Group();
for (let i = 0; i < 2; i++) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshBasicMaterial());
  mesh.position.set(i * 4, i, -i);
  mesh.scale.set(1 + i, 0.5, 1);
  scene.add(mesh);
}
const baked = bakeTexturedGeometry(THREE, scene);
assert.equal(valid('indexed scan', baked), 24);
assert.equal(baked.attributes.position.count, 48);
assert.equal(baked.index.count, 72);
assert.equal(baked.boundingBox.max.x, 5);

const namespace = { ...THREE, TextureLoader: class {
  load() { return new THREE.Texture(); }
} };
const mountainLife = await load('mountainLife.js');
const resort = new THREE.Scene();
const life = mountainLife.createMountainLife(namespace, resort, { apply: m => m });
const player = { pos: new THREE.Vector3(0, 0, -300), distance: 300, state: 'ride', grace: 10 };
life.update(1 / 60, player, { night: 0, snow: 0 });
let meshes = 0;
resort.traverse(node => {
  if (!node.isMesh) return;
  meshes++;
  valid('resort.' + meshes, node.geometry);
  assert.ok(node.matrix.elements.every(Number.isFinite));
  if (node.isInstancedMesh) assert.ok(node.instanceMatrix.array.every(Number.isFinite));
});
assert.ok(meshes <= 24, 'resort draw-call budget');
console.log('All model geometry checks passed.');
