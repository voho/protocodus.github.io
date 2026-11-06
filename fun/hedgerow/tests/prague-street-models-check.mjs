// Actual geometry, resource limits and collision openings for the authored
// Three.js Prague tram, domestic barricade and overhead contact span.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { pragueStreetModels } = await import('../js/prague-street-models.js');
const { createBuilder } = await import('../js/street-model-kit.js');
const { worldColliders } = await import('../js/assets.js');
const { createWorld, SHOT, SIGHT } = await import('../js/world.js');

const models = pragueStreetModels(), repeat = pragueStreetModels();
const terrain = { height: () => 0, normal: () => [0, 1, 0], surfaceAt: () => 'cobble', raycast: () => Infinity };
const worlds = new Map();
for (const [name, model] of models) {
  assert.ok(model.box.min.toArray().every(Number.isFinite) && model.box.max.toArray().every(Number.isFinite));
  assert.ok(model.prims.length <= 10, `${name} is merged into a bounded number of material batches`);
  const triangles = model.prims.reduce((n, p) => n + p.geometry.attributes.position.count / 3, 0);
  assert.ok(triangles <= 5000, `${name} stays below 5000 triangles`);
  for (let k = 0; k < model.prims.length; k++) {
    const geometry = model.prims[k].geometry;
    assert.deepEqual(geometry.attributes.position.array, repeat.get(name).prims[k].geometry.attributes.position.array, `${name} is deterministic`);
    for (const attr of Object.values(geometry.attributes)) assert.ok(attr.array.every(Number.isFinite), `${name} has finite attributes`);
    const normals = geometry.attributes.normal;
    for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 1e-5, `${name} has unit lighting normals`);
    for (const attr of ['position', 'normal', 'uv', 'color']) assert.ok(geometry.attributes[attr], `${name} has ${attr} data`);
  }
  const world = createWorld({ minX: -30, maxX: 30, minZ: -30, maxZ: 30, terrain });
  for (const collider of worldColliders(model, 0, 0, 0, 0)) world.add(collider);
  worlds.set(name, world);
}

const tram = models.get('tram_barricade'), tw = worlds.get('tram_barricade');
assert.ok(tram.box.min.y >= -1e-6 && tram.box.min.y <= 1e-6, 'tram rests on its wheels at the ground origin');
assert.ok(tram.box.max.x - tram.box.min.x <= 2.36 && tram.box.max.z - tram.box.min.z <= 8.12, 'tram has credible pre-war two-axle proportions');
assert.ok(tram.box.max.y < 3.62, 'folded roof bow stays below the contact wire');
const roofMaterial = new THREE.MeshBasicMaterial();
const roofMesh = new THREE.Mesh(tram.prims.find(p => p.key === 'burnt').geometry, roofMaterial);
const roofHit = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)).intersectObject(roofMesh)[0];
assert.ok(roofHit && Math.abs(roofHit.point.y - 3.10) < 1e-5 && roofHit.face.normal.y > 0.9,
  'the real roof geometry faces outwards and is visible from above');
roofMaterial.dispose();
assert.ok(tw.clear(3, 2.1, 0.6, -3, 2.1, 0.6, SIGHT), 'missing side panes reveal the saloon and allow visibility');
assert.ok(tw.clear(0, 2.1, 6, 0, 2.1, -6, SIGHT), 'the centre front and rear windscreen openings are real');
assert.ok(!tw.clear(3, 1.25, 0.6, -3, 1.25, 0.6, SIGHT), 'solid lower body remains usable cover');
assert.ok(!tw.clear(3, 2.1, 0, -3, 2.1, 0, SIGHT), 'window mullions stop shots where their timber is visible');
assert.ok(tw.raycast(0, 4, 0, 0, -1, 0, 5, SHOT), 'arched roof is solid to downward fire');
assert.ok(tw.clear(1.12, 2.90, -6, 1.12, 2.90, 6, SIGHT), 'shots above the low outside edge of the arch do not hit an invisible rectangular roof');
assert.ok(tw.raycast(0, 1, 0, 0, -1, 0, 2, SHOT), 'wooden saloon floor is solid');
assert.ok(tw.clear(3, 1.9, 3.05, -3, 1.9, 3.05, SIGHT), 'open boarding vestibule has no invisible wall');
assert.ok(tw.groundAt(1.14, 3.05, 0, 0.45) > 0.39, 'outer boarding step can be reached from the street');
assert.ok(tw.groundAt(1.06, 3.05, 0.40, 0.45) > 0.58, 'inner boarding step connects to the higher wooden floor');
assert.ok(tw.groundAt(0.95, 3.05, 0.59, 0.45) > 0.86, 'the second step reaches the solid vestibule floor');

const barricade = models.get('prague_barricade'), bw = worlds.get('prague_barricade');
assert.ok(barricade.box.min.y >= -0.03 && barricade.box.max.y <= 1.33, 'street setts are sunk into the street and the bedheads remain human scale');
assert.ok(!bw.clear(0, 0.85, -3, 0, 0.85, 3, SIGHT), 'overlapping sandbags form usable central cover');
assert.ok(bw.clear(2.4, 0.85, -3, 2.4, 0.85, 3, SIGHT), 'low end does not receive an invisible chest-high blocker');
assert.ok(bw.clear(-1.65, 1.24, -3, -1.65, 1.24, 3, SIGHT), 'bedhead bars leave real openings above the bags');
assert.equal(models.get('prague_tram_span').colliders.length, 0, 'high suspension wires do not add gameplay blockers');
const contact = models.get('prague_contact_wire');
assert.equal(contact.colliders.length, 0, 'the continuous contact wire adds no gameplay blocker');
assert.ok(Math.abs(contact.anchors.south[1] - (contact.anchors.north[1] - 14 * 0.019)) < 1e-6,
  'neighbouring contact-wire modules meet along the graded street');

// Builder must preserve mapped sign UVs and accept per-geometry colour
// without changing the caller's geometry or material.
const source = new THREE.PlaneGeometry(2, 1); source.userData.keepUV = true;
const before = source.attributes.position.array.slice(), beforeUV = source.attributes.uv.array.slice();
const sign = new THREE.MeshStandardMaterial({ name: 'test-sign' });
const kit = createBuilder('kit-test'); kit.material('lettering', sign);
kit.add('lettering', source, [0, 2, 0], [0, 0, 0], [1, 1, 1], '#f0c0b0');
const built = kit.done();
assert.equal(built.prims[0].material, sign);
assert.deepEqual(source.attributes.position.array, before, 'builder leaves reusable source geometry intact');
const expanded = source.toNonIndexed();
assert.deepEqual(built.prims[0].geometry.attributes.uv.array, expanded.attributes.uv.array, 'mapped lettering keeps normalized UVs');
assert.deepEqual(source.attributes.uv.array, beforeUV);
assert.ok(built.prims[0].geometry.attributes.color.array.some(v => v < 0.9), 'authored per-piece colour survives batching');
for (const collection of [models, repeat]) for (const model of collection.values()) for (const p of model.prims) p.geometry.dispose();
source.dispose(); expanded.dispose(); built.prims[0].geometry.dispose(); sign.dispose();
console.log('prague-street-models-check: period scale, deterministic geometry, material/resource limits, real window/bedframe openings, solid cover, roof/floor and boarding contacts pass');
