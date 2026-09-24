import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';

// Run with: node tests/models-check.mjs
const base = new URL('../', import.meta.url);
// Geometry builders stay private in production; expose them only in this smoke check.
// The glTF loader imports the bare specifier 'three', which node cannot
// resolve; nothing here loads a file, so a module that imports it gets a stub.
const upgraderStub = 'data:text/javascript;base64,' + Buffer.from(
  'export function createModelUpgrader() { const none = () => {}; '
  + 'return { upgrade: none, upgradeTextured: none, upgradeTexturedSet: none }; }',
).toString('base64');
async function load(file, exports = []) {
  const url = new URL('js/' + file, base);
  let source = await readFile(url, 'utf8');
  source = source.replace(/^import \{ GLTFLoader \}.*$/m, '')
    .replace(/from\s+(['"])\.\/importedModels\.js\1/g, `from '${upgraderStub}'`)
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

const { growCardSpruce, SPRUCE_LAYOUT } = await load('spruce.js');
const spec = { whorls: [7, 10], perWhorl: [4, 6], bareTo: 0.12,
  reach: 0.21, liftLow: -0.1, liftHigh: 0.5, droop: 0.3, snow: 0.65, spire: 1.5, flag: 0.25 };
let treeTriangles = 0;
for (let i = 0; i < 20; i++) {
  const tree = growCardSpruce(THREE, i * 7121, spec, 8 + i);
  const count = valid('tree.' + i, tree);
  treeTriangles += count;
  assert.ok(count < 1000, 'bounded tree complexity');
  assert.ok(tree.boundingBox.max.x - tree.boundingBox.min.x < (8 + i) * 0.8,
    'conifer crowns leave a readable downhill corridor');
  const again = growCardSpruce(THREE, i * 7121, spec, 8 + i);
  assert.deepEqual(tree.attributes.position.array, again.attributes.position.array, 'seeded model stability');
}
assert.ok(treeTriangles <= 7354, 'crossing needle curtains stay within the original tree budget');

// Snow replaces the photographed bough surface instead of adding a floating
// copy. A heavier snow load must not double stems, polygons, or card seams.
const greenTree = growCardSpruce(THREE, 98237, { ...spec, snow: 0, spire: 0 }, 14);
const snowyTree = growCardSpruce(THREE, 98237, { ...spec, snow: 1, spire: 0 }, 14);
assert.deepEqual(snowyTree.attributes.position.array, greenTree.attributes.position.array,
  'snow load preserves one branch surface and the geometry budget');
const branchStart = Array.from(greenTree.attributes.surfaceOwn.array).indexOf(1);
assert.ok(branchStart >= 0);
const snowOwn = snowyTree.attributes.surfaceOwn.array;
const branchPos = snowyTree.attributes.position;
const greenUV = greenTree.attributes.uv;
const snowUV = snowyTree.attributes.uv;
let loadedBranches = 0;
let curtains = 0;
for (let first = branchStart; first < branchPos.count;) {
  const snowy = snowOwn[first] === 0;
  if (snowy) loadedBranches++;
  for (let axis = 0; axis < 3; axis++) {
    assert.equal(branchPos.array[first * 3 + axis], branchPos.array[(first + 6) * 3 + axis],
      'the two half-cells meet at one branch stem');
    assert.equal(branchPos.array[(first + 5) * 3 + axis], branchPos.array[(first + 10) * 3 + axis],
      'the folded bough shares one tip');
  }
  for (let i = first; i < first + 12; i++) {
    assert.equal(snowUV.getX(i), greenUV.getX(i), 'frost keeps its half-cell instead of repeating a whole sprig');
    const expectedV = greenUV.getY(i) - (snowy ? SPRUCE_LAYOUT.frostDrop : 0);
    assert.ok(Math.abs(snowUV.getY(i) - expectedV) < 1e-6, 'green and frost share stem-to-tip atlas mapping');
  }
  first += 12;
  // Full-width cells mark the optional underside sprig; the two folded
  // halves above each start at the atlas cell's middle instead.
  const curtain = first < branchPos.count && SPRUCE_LAYOUT.cells.some(cell =>
    Math.min(Math.abs(greenUV.getX(first) - cell.u0), Math.abs(greenUV.getX(first) - cell.u1)) < 1e-6);
  if (curtain) {
    curtains++;
    for (let i = first; i < first + 6; i++) {
      assert.equal(snowOwn[i], 1, 'underside needles remain sheltered beneath the snow load');
      assert.equal(snowUV.getY(i), greenUV.getY(i), 'curtain never duplicates the snow surface');
    }
    first += 6;
  }
}
assert.ok(loadedBranches > 3, 'exercise multiple snow-loaded boughs');
assert.ok(curtains > 3, 'selected boughs carry actual crossing volume');

const { bakeTexturedGeometry } = await load('importedModels.js');
const scene = new THREE.Group();
for (let i = 0; i < 2; i++) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshBasicMaterial());
  mesh.position.set(i * 4, i, -i);
  mesh.scale.set(1 + i, 0.5, 1);
  mesh.name = `part_${i}`;
  scene.add(mesh);
}
const baked = bakeTexturedGeometry(THREE, scene);
assert.equal(valid('indexed scan', baked), 24);
assert.equal(baked.attributes.position.count, 48);
assert.equal(baked.index.count, 72);
assert.equal(baked.boundingBox.max.x, 5);
// A set file feeds one pool per named node.
const one = bakeTexturedGeometry(THREE, scene, 'part_1');
assert.equal(valid('one node of a set', one), 12);
assert.equal(one.boundingBox.min.x, 3, 'only the named node is baked');

/* The race gate and the sapling impostors. The gate's fabric must be the only
   thing that flutters, and pinned at both poles; each sapling is three cards
   of eight triangles whose texture rectangles sit inside the atlas and keep
   the aspect ratio of the frame the tree was drawn in (1024 × 2048). */
const props = await load('props.js', ['raceGatePanelGeometry', 'saplingCardGeometry', 'SAPLINGS', 'GATE_PANEL']);
const panel = props.raceGatePanelGeometry(THREE);
assert.ok(valid('race gate panel', panel) <= 400, 'race gate triangle budget');
const flutter = panel.attributes.aFlutter;
const panelPos = panel.attributes.position;
let moving = 0;
for (let i = 0; i < flutter.count; i++) {
  const x = panelPos.getX(i);
  if (flutter.getX(i) > 0) moving++;
  if (Math.abs(x) < 0.03 || Math.abs(x - props.GATE_PANEL.width) < 0.03) {
    assert.equal(flutter.getX(i), 0, 'poles and collars never flutter');
  }
}
assert.ok(moving > 20, 'the fabric ripples');
for (const spec of props.SAPLINGS) {
  const cards = props.saplingCardGeometry(THREE, spec);
  assert.equal(valid('sapling ' + spec.name, cards), 24, 'three cards, eight triangles each');
  assert.ok(Math.abs(cards.boundingBox.max.y - spec.H) < 1e-6, spec.name + ': drawn to its height');
  for (const [u0, v0, u1, v1] of spec.views) {
    assert.ok(u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1 && u1 > u0 && v1 > v0, spec.name + ': rect in atlas');
    const texelAspect = ((u1 - u0) * 1024) / ((v1 - v0) * 2048);
    assert.ok(Math.abs(texelAspect / ((2 * spec.R) / spec.H) - 1) < 0.02, spec.name + ': view keeps its aspect');
  }
}

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
