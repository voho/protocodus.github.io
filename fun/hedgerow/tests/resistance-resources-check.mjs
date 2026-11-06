// Device recovery retires only the armband's owned GPU resources while
// retaining the geometry/canvas needed to redraw and later retry.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { attachResistanceIdentity } = await import('../js/resistance-kit.js');
const arm = new THREE.Bone(), cloth = new THREE.MeshStandardMaterial();
const character = { bones: { upperarm_l: arm } };
assert.equal(attachResistanceIdentity(character, {}, 'allied'), null);
assert.equal(attachResistanceIdentity({ bones: {} }, {}, 'czech-resistance'), null);
const kit = attachResistanceIdentity(character, { get: () => cloth }, 'czech-resistance');
const [band, flag] = kit.group.children, map = flag.material.map, image = map.image;
const owned = [band.geometry, flag.geometry, flag.material, map];
const counts = new Map(owned.map(resource => [resource, 0]));
for (const resource of owned) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
let sharedClothDisposes = 0;
cloth.addEventListener('dispose', () => sharedClothDisposes++);
const attributes = [band.geometry, flag.geometry].flatMap(geometry =>
  [...Object.values(geometry.attributes), geometry.index].filter(Boolean).map(attribute => ({
    attribute, array: attribute.array, values: Array.from(attribute.array),
  })));
for (let cycle = 1; cycle <= 2; cycle++) {
  kit.releaseGraphicsResources();
  assert.equal(kit.group.parent, arm, 'GPU retirement keeps the kit mounted');
  assert.equal(flag.material.map, map, 'the flag texture object remains reusable');
  assert.equal(map.image, image, 'the original flag canvas remains available for reupload');
  assert.equal(band.material, cloth, 'the library cloth material remains shared');
  assert.equal(sharedClothDisposes, 0, 'the kit never disposes a shared material');
  for (const resource of owned) assert.equal(counts.get(resource), cycle, 'each generation retires every owned resource');
  for (const { attribute, array, values } of attributes) {
    assert.equal(attribute.array, array, 'retirement retains original typed arrays');
    assert.deepEqual(Array.from(array), values, 'retirement leaves geometry bytes unchanged');
  }
}
kit.dispose();
assert.equal(kit.group.parent, null, 'final disposal removes the kit');
for (const resource of owned) assert.equal(counts.get(resource), 3, 'final disposal retires the current generation');
kit.dispose(); kit.releaseGraphicsResources();
for (const resource of owned) assert.equal(counts.get(resource), 3, 'final disposal is idempotent');
assert.equal(sharedClothDisposes, 0);
console.log('resistance-resources-check: two GPU retirements retain mounted CPU geometry/canvas, shared cloth ownership and final disposal pass');
