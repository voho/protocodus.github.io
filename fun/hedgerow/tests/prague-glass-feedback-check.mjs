// Authored Prague glazing changes cosmetic impact feedback only.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const THREE = await import('three');
const { pragueModels } = await import('../js/prague-models.js');
const { createPragueGlassFeedback } = await import('../js/prague-glass-feedback.js');
const { createWorld, SHOT } = await import('../js/world.js');
const { worldColliders } = await import('../js/assets.js');
const models = pragueModels(), atlas = new THREE.Texture();
const geometryHash = () => {
  const hash = createHash('sha256');
  for (const model of models.values()) for (const p of model.prims) {
    for (const attr of Object.values(p.geometry.attributes)) hash.update(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength));
    if (p.geometry.index) hash.update(Buffer.from(p.geometry.index.array.buffer));
  }
  return hash.digest('hex');
};
const sourceHash = geometryHash();
const cases = [
  ['old open', 'prague_old_classical', [-4.10, 5.50, 5.1725], true],
  ['old mullion', 'prague_old_classical', [-4.45, 5.50, 5.1725], false],
  ['sage open', 'prague_classical_sage', [-4.90, 5.50, 5.1725], true],
  ['sage rail', 'prague_classical_sage', [-4.90, 5.3688, 5.1725], false],
  ['interwar open', 'prague_interwar', [-5.55, 5.60, 5.1725], true],
  ['interwar mullion', 'prague_interwar', [-4.60 + 3.34 / 6, 5.60, 5.1725], false],
  ['legacy pane', 'prague_ochre', [-5.55, 4.97, 5.2175], true],
  ['rose unboarded pane', 'prague_rose', [-5.55, 4.97, 5.2175], true],
  ['gray pane', 'prague_gray', [-5.55, 4.97, 5.2175], true],
  ['glass behind linen', 'prague_ochre', [-5.73, 5.85, 5.2175], true],
  ['legacy frame gap', 'prague_ochre', [-5.20, 4.97, 5.2175], false],
  ['boarded window', 'prague_rose', [-2.60, 5.45, 5.2175], false],
  ['blank wall', 'prague_gray', [-6.50, 5.45, 5.2175], false],
  ['older shop', 'prague_old_classical', [-4.00, 1.90, 5.1975], true],
  ['legacy shop', 'prague_ochre', [-4.00, 1.90, 5.225], true],
  ['legacy door', 'prague_ochre', [-.46, 2.15, 5.3775], true],
  ['open passage', 'prague_passage', [0, 1.50, 5], false],
  ['passage upper', 'prague_passage', [-5.55, 4.97, 5.2175], true],
  ['damaged frontage', 'prague_damaged', [-5.55, 4.97, 5.2175], true],
  ['rear older pane', 'prague_old_classical', [-4.10, 5.50, -5.1725], true, -1],
];
const props = cases.map(([, name], i) => ({ m: models.get(name), x: i * 35 - 300, y: 1.23, z: i % 2 ? 50 : 0, yaw: i % 3 * Math.PI / 2, scale: i % 4 === 0 ? .9 : 1 }));
const world = createWorld({ minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 });
for (const p of props) for (const c of worldColliders(p.m, p.x, p.y, p.z, p.yaw, p.scale)) world.add(c);
const effectsCalls = [], audioCalls = [];
const owner = createPragueGlassFeedback(props, { map: atlas, effects: { glass: (...args) => effectsCalls.push(args) }, audio: { impact: (...args) => audioCalls.push(args) }, random: () => .5 });
let mapDisposals = 0; atlas.addEventListener('dispose', () => mapDisposals++);
let ownedMeshDisposals = 0, ownedGeometryDisposals = 0, ownedMaterialDisposals = 0, sourceDisposals = 0;
owner.mesh.addEventListener('dispose', () => ownedMeshDisposals++);
owner.mesh.geometry.addEventListener('dispose', () => ownedGeometryDisposals++);
owner.mesh.material.addEventListener('dispose', () => ownedMaterialDisposals++);
const sourceResources = new Set([...models.values()].flatMap(m => m.prims.flatMap(p => [p.geometry, p.material])));
for (const resource of sourceResources) if (typeof resource?.addEventListener === 'function') resource.addEventListener('dispose', () => sourceDisposals++);
let firstHit, firstDirection;
assert.equal(owner.mesh.visible, false); assert.equal(owner.mesh.count, 0);
for (let i = 0; i < cases.length; i++) {
  const [name, , coordinates, expected, facing = 1] = cases[i], p = props[i];
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(p.scale, p.scale, p.scale));
  const target = new THREE.Vector3().fromArray(coordinates).applyMatrix4(matrix);
  const origin = new THREE.Vector3(coordinates[0], coordinates[1], coordinates[2] + 6 * facing).applyMatrix4(matrix);
  const direction = target.clone().sub(origin).normalize();
  const hit = world.raycast(origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, 15, SHOT, { noWater: true });
  const before = hit && { x: hit.x, y: hit.y, z: hit.z, t: hit.t, surface: hit.surface, collider: hit.collider };
  if (hit) Object.freeze(hit);
  const oldCalls = audioCalls.length, result = owner.impact(hit, direction);
  assert.equal(!!result, expected, name);
  assert.equal(audioCalls.length - oldCalls, expected ? 1 : 0, 'Exactly one sound only for actual glass');
  assert.equal(effectsCalls.length, audioCalls.length, 'Shards and sound dispatch together');
  if (hit) assert.deepEqual({ x: hit.x, y: hit.y, z: hit.z, t: hit.t, surface: hit.surface, collider: hit.collider }, before, 'Ballistics/cover fields remain untouched');
  if (result) {
    assert.ok(new THREE.Vector3(result.x, result.y, result.z).distanceTo(target) < 1e-5, 'Feedback lies on the actual pane');
    assert.equal(audioCalls.at(-1)[3], 'glass');
    assert.deepEqual(effectsCalls.at(-1)[5], { glints: false }, 'Dark panes cannot spawn the warm additive lamp glints');
    assert.equal(result.lit, false);
  }
  if (i === 0) {
    firstHit = hit; firstDirection = direction;
    const obliqueOrigin = new THREE.Vector3(coordinates[0] + 3.1, coordinates[1] + .1, coordinates[2] + 6).applyMatrix4(matrix), obliqueDir = target.clone().sub(obliqueOrigin).normalize();
    const obliqueHit = world.raycast(obliqueOrigin.x, obliqueOrigin.y, obliqueOrigin.z, obliqueDir.x, obliqueDir.y, obliqueDir.z, 15, SHOT);
    const oblique = owner.impact(obliqueHit, obliqueDir);
    assert.ok(oblique); assert.ok(new THREE.Vector3(oblique.x, oblique.y, oblique.z).distanceTo(target) < 1e-5);
    assert.equal(owner.impact({ ...hit, collider: { ...hit.collider, x: hit.collider.x + .001 } }, direction), null);
  }
}
// Crack size/variant choices are cosmetic and must not advance the global
// random stream used by subsequent bullet spread and gameplay. Independent
// fresh owners reproduce their own default stream without sharing state.
const defaults = [0, 1].map(() => createPragueGlassFeedback([props[0]], { map: atlas, effects: { glass() {} }, audio: { impact() {} } }));
let globalRandomDraws = 0;
const globalRandom = Math.random;
try {
  Math.random = () => { globalRandomDraws++; return .5; };
  for (const feedback of defaults) for (let i = 0; i < 3; i++) assert.ok(feedback.impact(firstHit, firstDirection));
} finally { Math.random = globalRandom; }
assert.equal(globalRandomDraws, 0, 'Default cosmetic impacts never consume gameplay Math.random');
assert.deepEqual(defaults[0].mesh.instanceMatrix.array, defaults[1].mesh.instanceMatrix.array, 'Fresh feedback owners have independent deterministic cosmetic streams');
assert.deepEqual(defaults[0].mesh.geometry.attributes.aCell.array, defaults[1].mesh.geometry.attributes.aCell.array);
for (const feedback of defaults) feedback.dispose();
for (let i = 0; i < 100; i++) owner.impact(firstHit, firstDirection);
assert.equal(owner.mesh.count, 48, 'The fracture ring has a fixed hard capacity');
assert.equal(owner.mesh.material.map, atlas);
assert.equal(owner.mesh.material.emissive.getHex(), 0);
assert.equal(owner.mesh.material.depthWrite, false); assert.equal(owner.mesh.material.depthTest, true);
assert.equal(owner.mesh.castShadow, false);
assert.equal(owner.stats().fractures.geometryBytes, 4364);
assert.equal(owner.stats().fractures.newTextureMaps, 0);
assert.equal(owner.stats().fractures.viewDepthPull, 0);
assert.equal(owner.stats().fractures.normalOffset, .003);
assert.equal(geometryHash(), sourceHash, 'All original positions/normals/UVs/colors/indices remain exact');
owner.clear(); assert.equal(owner.mesh.count, 0); assert.equal(owner.mesh.visible, false);
owner.impact(firstHit, firstDirection); const retainedMatrix = Array.from(owner.mesh.instanceMatrix.array);
owner.releaseGraphicsResources(); assert.deepEqual(Array.from(owner.mesh.instanceMatrix.array), retainedMatrix, 'Lost-context retirement retains active damage and CPU transforms');
assert.equal(owner.mesh.count, 1); assert.equal(mapDisposals, 0);
assert.equal(ownedMeshDisposals, 1, 'Lost retirement releases the InstancedMesh-owned matrix buffer/listener');
assert.equal(ownedGeometryDisposals, 1); assert.equal(ownedMaterialDisposals, 1);
owner.dispose(); owner.dispose(); assert.equal(mapDisposals, 0, 'Borrowed atlas is never disposed by the fracture owner');
assert.equal(ownedMeshDisposals, 2, 'Terminal cleanup retires the restored instance buffer once');
assert.equal(ownedGeometryDisposals, 2); assert.equal(ownedMaterialDisposals, 2, 'Terminal disposal is idempotent');
assert.equal(sourceDisposals, 0, 'Borrowed source meshes and materials are never retired by the feedback owner');
assert.equal(owner.impact(firstHit, firstDirection), null);
atlas.dispose();
const geometries = new Set([...models.values()].flatMap(m => m.prims.map(p => p.geometry)));
for (const g of geometries) g.dispose();
// Exercise the actual particle owner, not a callback mock: default and
// explicit lit-room calls pack identical shards + ten warm glints. Dark
// calls retain the same lit shards while omitting that additive burst.
// Canvas rasterization is stubbed for this CPU packing/ownership check.
const createElement = document.createElement;
document.createElement = (...args) => {
  const canvas = createElement(...args), context = canvas.getContext('2d');
  const proxy = new Proxy(context, { get(target, key) {
    if (key === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    return target[key] ?? (() => {});
  } });
  canvas.getContext = () => proxy;
  return canvas;
};
const { createEffects } = await import('../js/effects.js');
const particleOwners = [];
try {
  for (const mode of ['default', 'lit', 'dark']) {
    const fx = createEffects({ camera: new THREE.PerspectiveCamera(), fog: { color: { value: new THREE.Color('#383e45') }, density: { value: .008 } }, seed: 21 });
    particleOwners.push(fx);
    if (mode === 'default') fx.glass(1, 2, 3, 0, 1);
    else fx.glass(1, 2, 3, 0, 1, { glints: mode === 'lit' });
    fx.update(0, { x: 0, z: 0 }, new THREE.Vector3());
  }
  const [original, explicit, dark] = particleOwners;
  const alpha = original.group.children[0], add = original.group.children[1];
  assert.ok(alpha.geometry.instanceCount >= 10 && alpha.geometry.instanceCount <= 16);
  assert.equal(add.geometry.instanceCount, 10);
  assert.equal(dark.group.children[1].geometry.instanceCount, 0);
  assert.equal(alpha.material.uniforms.uLit.value, 1, 'The retained shard system receives ordinary scene lighting');
  for (let mesh = 0; mesh < 3; mesh++) {
    const a = original.group.children[mesh].geometry, b = explicit.group.children[mesh].geometry;
    assert.equal(a.instanceCount, b.instanceCount);
    for (const key of ['aPos', 'aColor', 'aMisc', 'aStretch']) assert.deepEqual(a.attributes[key].array, b.attributes[key].array, 'Default old lit-room particles stay exact');
  }
  const a = alpha.geometry, b = dark.group.children[0].geometry;
  assert.equal(a.instanceCount, b.instanceCount);
  for (const key of ['aPos', 'aColor', 'aMisc', 'aStretch']) assert.deepEqual(a.attributes[key].array, b.attributes[key].array, 'Dark feedback keeps the exact same physical shards');
} finally {
  document.createElement = createElement;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  for (const fx of particleOwners) fx.group.traverse(o => { if (!o.isMesh) return; geometries.add(o.geometry); materials.add(o.material); textures.add(o.material.uniforms.tAtlas.value); });
  for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
}
console.log('prague-glass-feedback-check: all eight authored houses, real frame/board/passage rejection, oblique physical panes, one cosmetic dispatch, exact ballistics/source arrays and bounded owned-resource lifecycle pass');
