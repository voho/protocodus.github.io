// Additive printing on the shipped radio; source mesh and interaction stay exact.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { GLTFLoader } = await import('../assets/vendor/GLTFLoader.js');
const { readSet, loadModels, worldColliders, worldAnchor, createStaticBatcher } = await import('../js/assets.js');
const { addRadioNumericScales } = await import('../js/radio-detail.js');
const { createMaterialLibrary } = await import('../js/materials.js');
const { createWorld } = await import('../js/world.js');
const { MISSIONS } = await import('../js/missions.js');
const gltf = await parseUntexturedGLB('military');
const node = gltf.scene.children.find(o => o.name === 'radio_table');
assert.ok(node, 'The real military GLB contains the source radio');
const scene = new THREE.Group(); scene.add(node);
const catalog = new Map(); readSet({ scene }, 'military', catalog);
const original = catalog.get('radio_table');
const triangles = m => m.prims.reduce((sum, p) => sum + (p.geometry.index?.count || p.geometry.attributes.position.count) / 3, 0);
const fingerprint = m => {
  const h = createHash('sha256');
  for (const p of m.prims) {
    for (const a of Object.values(p.geometry.attributes)) h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    if (p.geometry.index) h.update(Buffer.from(p.geometry.index.array.buffer));
  }
  return h.digest('hex');
};
const before = fingerprint(original), bounds = original.box.clone();
assert.equal(triangles(original), 1944);
const borrowed = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
let borrowedDisposals = 0; borrowed.addEventListener('dispose', () => borrowedDisposals++);
const detail = addRadioNumericScales(original, { texture: borrowed }), addition = detail.prims.at(-1);
assert.equal(detail.prims.length, original.prims.length + 1);
assert.equal(triangles(detail) - triangles(original), 46);
for (let i = 0; i < original.prims.length; i++) assert.equal(detail.prims[i], original.prims[i]);
assert.equal(detail.colliders, original.colliders); assert.equal(detail.anchors, original.anchors); assert.equal(detail.extras, original.extras);
assert.deepEqual(detail.box, bounds); assert.deepEqual(original.box, bounds); assert.equal(fingerprint(original), before);
assert.ok(bounds.containsBox(addition.geometry.boundingBox));
for (const attr of Object.values(addition.geometry.attributes)) for (const n of attr.array) assert.ok(Number.isFinite(n));
for (const n of addition.geometry.attributes.uv.array) assert.ok(n >= 0 && n <= 1);
assert.equal(addition.material.map, borrowed); assert.equal(addition.material.emissive.getHex(), 0);
assert.equal(addition.material.emissiveMap, null); assert.equal(addition.material.transparent, false); assert.equal(addition.material.alphaTest, 0);
assert.equal(addRadioNumericScales(detail), detail, 'Decoration is idempotent and cannot duplicate printing/texture resources');
assert.throws(() => addRadioNumericScales({ ...original, name: 'crate' }), /radio_table/);

// Printing lies less than 2 mm in front of the existing physical faces.
const sourceMeshes = original.prims.map(p => new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial()));
for (const [x, y] of [[-.01, 1.0268], [.15, 1.054]]) {
  const hit = new THREE.Raycaster(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1), 0, 3).intersectObjects(sourceMeshes)[0];
  assert.ok(hit); assert.ok(-.1174 > hit.point.z && -.1174 - hit.point.z < .002);
}

// Default atlas is lazy, shared between catalog models/loads, and keeps
// its canvas pixels available for ordinary context recreation.
const createElement = document.createElement;
let canvases = 0;
document.createElement = (...args) => {
  const canvas = createElement(...args); canvases++;
  const context = canvas.getContext('2d'); context.strokeRect = () => {}; context.fillText = () => {};
  canvas.getContext = () => context;
  return canvas;
};
let a, b, loaded;
const oldLoad = GLTFLoader.prototype.loadAsync, oldScheduler = globalThis.scheduler;
try {
  a = addRadioNumericScales(original); b = addRadioNumericScales(original);
  assert.equal(canvases, 1); assert.equal(a.prims.at(-1).material.map, b.prims.at(-1).material.map);
  const map = a.prims.at(-1).material.map;
  assert.equal(map.image.width, 512); assert.equal(map.image.height, 256);
  assert.equal(map.colorSpace, THREE.SRGBColorSpace); assert.equal(map.generateMipmaps, true);
  assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter); assert.equal(map.anisotropy, 8);
  // Only transport/yield are adapted: loadModels executes the actual
  // production parse + postprocess using the source GLB's real node.
  GLTFLoader.prototype.loadAsync = async () => ({ scene });
  globalThis.scheduler = { yield: async () => {} };
  loaded = (await loadModels('/cpu-transport', ['military'])).models.get('radio_table');
  assert.equal(triangles(loaded), 1990); assert.equal(loaded.prims.at(-1).material.map, map); assert.equal(canvases, 1);
  assert.equal(fingerprint({ prims: loaded.prims.slice(0, -1) }), before);
  const raw = new Map(); readSet({ scene }, 'military', raw);
  assert.equal(triangles(raw.get('radio_table')), 1944, 'The generic readSet parser stays undecorated');
  assert.equal((await loadModels('/cpu-transport', [])).models.size, 0, 'Loads without the military radio need no decoration');
} finally {
  document.createElement = createElement; GLTFLoader.prototype.loadAsync = oldLoad;
  if (oldScheduler === undefined) delete globalThis.scheduler; else globalThis.scheduler = oldScheduler;
}

const expectedRadioPlacements = {
  'saint-clair': [{ id: 'radio', x: -10, z: 509, yaw: 90, scale: 1 }],
  'la-varenne': [{ id: null, x: -4, z: 202, yaw: 160, scale: 1 }],
  'pont-tournant': [],
};
assert.deepEqual(MISSIONS.map(mission => mission.id), Object.keys(expectedRadioPlacements), 'The authored placement audit covers exactly the three Normandy levels');
let placements = 0;
for (const mission of MISSIONS) {
  const level = (await mission.load()).default;
  const radios = level.props.filter(p => p.m === 'radio_table');
  assert.deepEqual(radios.map(p => ({ id: p.id ?? null, x: p.x, z: p.z, yaw: p.yaw || 0, scale: p.scale || 1 })),
    expectedRadioPlacements[mission.id], `${mission.id}: the actual radio addresses, orientation and scale remain authored`);
  for (const p of radios) {
    placements++;
    const yaw = (p.yaw || 0) * Math.PI / 180, scale = p.scale || 1;
    const oldColliders = worldColliders(original, p.x, 0, p.z, yaw, scale), newColliders = worldColliders(detail, p.x, 0, p.z, yaw, scale);
    assert.deepEqual(newColliders, oldColliders);
    for (const name of ['radio', 'operator']) assert.deepEqual(worldAnchor(detail, name, p.x, 0, p.z, yaw, scale), worldAnchor(original, name, p.x, 0, p.z, yaw, scale));
    const operator = worldAnchor(detail, 'operator', p.x, 0, p.z, yaw, scale);
    const terrain = { height: () => .04, raycast: () => Infinity };
    const world = createWorld({ minX: p.x - 4, maxX: p.x + 4, minZ: p.z - 4, maxZ: p.z + 4, terrain });
    for (const c of newColliders) world.add(c);
    for (const height of [1.2, 1.78]) {
      const q = { x: operator[0], z: operator[2] }; world.pushOut(q, .34, .04, height, .45);
      assert.ok(Math.hypot(q.x - operator[0], q.z - operator[2]) < 1e-10, 'Printing cannot obstruct the authored radio operator in either stance');
    }
  }
}
assert.equal(placements, 2, 'The two retained radio placements receive the full geometry and interaction audit');
const library = createMaterialLibrary({ metal: null }, { wet: { value: .28 }, rain: { value: 0 }, time: { value: 0 } });
const groups = [];
for (const model of [original, detail]) {
  const batch = createStaticBatcher(library, 48);
  batch.add(model, new THREE.Matrix4().makeTranslation(0, 0, 0));
  batch.add(model, new THREE.Matrix4().makeTranslation(2, 0, 0));
  groups.push(batch.build());
}
assert.equal(groups[1].children.length - groups[0].children.length, 1, 'Two radios in one chunk share a single added print-material bucket');
assert.equal(groups[1].children.reduce((n, m) => n + m.geometry.index.count / 3, 0) - groups[0].children.reduce((n, m) => n + m.geometry.index.count / 3, 0), 92);
const print = groups[1].children.find(m => m.material.name === 'radio_numeric_scales');
assert.ok(print); assert.equal(print.material.map, borrowed); assert.equal(print.material.emissive.getHex(), 0);
assert.equal(library.resolve(addition.material), print.material, 'Actual factory resolution retains the shared print material/map');
for (const group of groups) group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
addition.material.dispose(); assert.equal(borrowedDisposals, 0, 'Shared atlas pixels are not owned by batched geometry or a material instance');
assert.equal(fingerprint(original), before);
const geometries = new Set(), materials = new Set(), maps = new Set([borrowed]);
for (const model of [original, detail, a, b, loaded]) for (const p of model.prims) {
  geometries.add(p.geometry); materials.add(p.material); if (p.material.map) maps.add(p.material.map);
}
for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of maps) t.dispose();
for (const mesh of sourceMeshes) mesh.material.dispose();
assert.equal(borrowedDisposals, 1, 'The explicit catalog/texture owner performs the single final atlas disposal');
console.log('radio-detail-check: real GLB/parser/load hook, exact source/contact/anchors,46 additive triangles, shared lazy atlas, two authored Normandy placements, original operator clearance and one extra material bucket pass');
