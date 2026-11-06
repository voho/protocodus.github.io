// Authored additions must stay supported, bounded and gameplay-neutral;
// they share the source facade instead of cloning its large mesh buffers.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const { pragueModels } = await import('../js/prague-models.js');
const { pragueFrontageVariants } = await import('../js/prague-frontage-details.js');
const { varyPragueFrontages, PRAGUE_FRONTAGE_VARIATION } = await import('../js/levels/prague-frontages.js');
const L = (await import('../js/levels/prague.js')).default;
const THREE = await import('three');
const baseModels = pragueModels(), variants = pragueFrontageVariants(baseModels), repeat = pragueFrontageVariants(baseModels);
assert.equal(variants.size, 3);
const metrics = [];
for (const [name, model] of variants) {
  const base = baseModels.get(model.extras.frontageBase), added = model.prims.slice(base.prims.length);
  assert.ok(base && !/passage|damaged/.test(base.name));
  assert.deepEqual(model.colliders, base.colliders, `${name}: all passage/sidewalk routes retain their exact collision`);
  assert.deepEqual(model.anchors, base.anchors);
  for (let i = 0; i < base.prims.length; i++) assert.equal(model.prims[i], base.prims[i], 'large original geometry/material buffers are shared');
  assert.ok(added.length <= 7, 'details enter the existing palette batching, with only one possible mapped sign material');
  assert.ok(model.extras.detailTriangles <= 800, `${name}: detail is bounded to 800 triangles`);
  const bounds = { minY: Infinity, maxZ: -Infinity, maxX: -Infinity };
  for (let k = 0; k < added.length; k++) {
    const g = added[k].geometry, p = g.attributes.position, normals = g.attributes.normal;
    assert.deepEqual(p.array, repeat.get(name).prims[base.prims.length + k].geometry.attributes.position.array, 'details are deterministic');
    for (const attr of Object.values(g.attributes)) assert.ok(attr.array.every(Number.isFinite));
    for (let i = 0; i < p.count; i++) {
      assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 1e-5);
      bounds.minY = Math.min(bounds.minY, p.getY(i)); bounds.maxZ = Math.max(bounds.maxZ, p.getZ(i)); bounds.maxX = Math.max(bounds.maxX, Math.abs(p.getX(i)));
    }
    assert.ok(g.boundingSphere && Number.isFinite(g.boundingSphere.radius));
  }
  assert.ok(bounds.minY >= 2.35, 'all additions leave full standing headroom below');
  assert.ok(bounds.maxX < 6.2 && bounds.maxZ < 6.41, 'detail stays within this frontage and a shallow, supported canopy projection');
  assert.ok(model.box.min.equals(base.box.min), 'street contact remains the exact original facade footprint');
  metrics.push({ name, triangles: model.extras.detailTriangles, materialGroups: added.length, minY: bounds.minY, maxZ: bounds.maxZ });
}
assert.throws(() => pragueFrontageVariants(new Map()), /Missing prague_ochre/);
// Real floor counts and roof forms must differ, not just tint/add adornment
// to the same five-storey volume. Cast against actual glazing at each bay.
const frontages = [
  ['prague_old_classical', 3, 11.45, [-4.45, 0, 4.45], [5.20, 8.60], 'red-pitched'],
  ['prague_classical_sage', 4, 13.85, [-5.25, -1.75, 1.75, 5.25], [5.20, 8.35, 11.50], 'slate-pitched'],
  ['prague_interwar', 6, 19.40, [-4.60, 0, 4.60], [5.40, 8.40, 11.40, 14.40, 17.40], 'flat-parapet'],
];
const glassMat = new THREE.MeshBasicMaterial();
for (const [name, floors, wallHeight, bays, rows, roofStyle] of frontages) {
  const m = baseModels.get(name), body = m.colliders[0];
  assert.equal(m.extras.floors, floors); assert.equal(m.extras.roofStyle, roofStyle);
  assert.deepEqual(body.c, [0, wallHeight / 2, 0]); assert.deepEqual(body.h, [7, wallHeight / 2, 5]);
  assert.ok(m.box.min.x < -7 && m.box.min.x > -7.3 && m.box.max.x < 7.3);
  const triangles = m.prims.reduce((n, p) => n + p.geometry.attributes.position.count / 3, 0);
  assert.ok(triangles < 4000, `${name}: new architecture adds fewer triangles than one original frontage`);
  const mesh = new THREE.Mesh(m.prims.find(p => p.key === 'glass').geometry, glassMat);
  for (const y of rows) for (const x of bays) {
    assert.ok(new THREE.Raycaster(new THREE.Vector3(x + 0.12, y + 0.22, 6), new THREE.Vector3(0, 0, -1), 0, 1).intersectObject(mesh).length,
      `${name}: visible actual glazing exists at the authored floor and bay`);
  }
  assert.equal(new THREE.Raycaster(new THREE.Vector3(bays[0] + 0.12, rows.at(-1) + 3.2, 6), new THREE.Vector3(0, 0, -1), 0, 1).intersectObject(mesh).length, 0,
    `${name}: no extra repeated window row above this building's actual last floor`);
  for (const p of m.prims) {
    for (const attr of Object.values(p.geometry.attributes)) assert.ok(attr.array.every(Number.isFinite));
    const n = p.geometry.attributes.normal;
    for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-5);
  }
}
glassMat.dispose();
const replacements = new Map(PRAGUE_FRONTAGE_VARIATION.map(([x, z, m]) => [`${x}:${z}`, m]));
// Work with both the original and integrated level: reconstruct only the
// ordinary-name input when the authored choices are already applied.
const originalProps = L.props.map(p => ({ ...p, m: replacements.get(`${p.x}:${p.z}`) === p.m ? 'prague_ochre' : p.m }));
const props = originalProps.map(p => ({ ...p })), fixed = props.filter(p => /passage|damaged/.test(p.m)).map(p => ({ ...p }));
varyPragueFrontages(props);
assert.equal(props.filter((p, i) => p.m !== originalProps[i].m).length, PRAGUE_FRONTAGE_VARIATION.length, 'each authored ordinary address gets exactly one intended replacement');
assert.deepEqual(props.filter(p => /passage|damaged/.test(p.m)), fixed, 'all named arcades and damage addresses remain byte-for-byte unchanged');
for (let i = 0; i < props.length; i++) {
  const { m, ...rest } = props[i], { m: oldName, ...original } = L.props[i];
  assert.deepEqual(rest, original, 'placement, datum, yaw, IDs and other props never change');
}
const once = props.map(p => ({ ...p })); varyPragueFrontages(props); assert.deepEqual(props, once, 'the authored application is idempotent');
// Real height variation exposes both old and new attic ends. A ray above
// the solid wall must hit the outward-facing gable, not pass into a void.
const capMat = new THREE.MeshBasicMaterial();
for (const [name, height] of [['prague_ochre', 17.2], ['prague_rose', 18.3], ['prague_gray', 16.6],
  ['prague_passage', 17.2], ['prague_old_classical', 11.45], ['prague_classical_sage', 13.85]]) {
  const m = baseModels.get(name), cap = new THREE.Mesh(m.prims.find(p => p.key === 'plaster').geometry, capMat);
  for (const side of [-1, 1]) {
    const hit = new THREE.Raycaster(new THREE.Vector3(side * 8, height + 0.80, 0), new THREE.Vector3(-side, 0, 0), 0, 1.1).intersectObject(cap)[0];
    assert.ok(hit && Math.abs(hit.point.x - side * 7) < 1e-5, `${name}: both exposed party-roof gables are closed and face out`);
  }
}
capMat.dispose();
for (const map of [variants, repeat]) for (const m of map.values()) {
  const base = baseModels.get(m.extras.frontageBase);
  for (const p of m.prims.slice(base.prims.length)) p.geometry.dispose();
}
for (const m of baseModels.values()) if (m.name !== 'prague_damaged') for (const p of m.prims) p.geometry.dispose();
console.log('prague-frontage-details-check:', JSON.stringify(metrics), '3/4/6-storey actual glazing/volumes, finite normals, shared buffers, bounded geometry, protected arcades/damage and idempotent authored addresses pass');
