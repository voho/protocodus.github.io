// Genuine period volumes, glazing, grounded foundations and exposed roof
// ends must remain bounded while the named gameplay passages stay clear.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const { pragueModels } = await import('../js/prague-models.js');
const { varyPragueFrontages, PRAGUE_FRONTAGE_VARIATION } = await import('../js/levels/prague-frontages.js');
const L = (await import('../js/levels/prague.js')).default;
const THREE = await import('three');
const baseModels = pragueModels();
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
// A ray through the previously visible downhill corner must meet a
// shallow vertical footing. The original masonry shell remains above it.
const footingMat = new THREE.MeshBasicMaterial();
for (const name of ['prague_ochre', 'prague_rose', 'prague_gray', 'prague_old_classical', 'prague_classical_sage', 'prague_interwar']) {
  const m = baseModels.get(name), footing = m.prims.filter(p => p.geometry.boundingBox.min.y < -0.1);
  assert.equal(m.extras.foundationDepth, 0.18);
  assert.equal(footing.length, 1);
  const p = footing[0], g = p.geometry, bounds = g.boundingBox;
  assert.equal(p.key, 'stone'); assert.equal(g.attributes.position.count / 3, 12);
  assert.ok(Math.abs(bounds.min.y + 0.18) < 1e-6 && Math.abs(bounds.max.y) < 1e-6);
  assert.deepEqual([bounds.min.x, bounds.max.x, bounds.min.z, bounds.max.z], [-7, 7, -5, 5], 'footing never projects into a pavement/passage');
  for (const a of Object.values(g.attributes)) assert.ok(a.array.every(Number.isFinite));
  for (const side of [-1, 1]) {
    const hit = new THREE.Raycaster(new THREE.Vector3(side * 6.95, -0.075, 5.2), new THREE.Vector3(0, 0, -1), 0, 0.4).intersectObject(new THREE.Mesh(g, footingMat))[0];
    assert.ok(hit && Math.abs(hit.point.z - 5) < 1e-6, 'both downhill frontage corners have actual masonry contact');
  }
  assert.ok(m.colliders.every(c => c.c[1] - c.h[1] >= -1e-6), 'visual footing adds no underground gameplay collider');
}
assert.equal(baseModels.get('prague_passage').extras.foundationDepth, undefined, 'named open vaults receive no foundation across their route');
footingMat.dispose();
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
for (const m of baseModels.values()) if (m.name !== 'prague_damaged') for (const p of m.prims) p.geometry.dispose();
console.log('prague-frontage-details-check: 3/4/6-storey actual glazing/volumes, sunk contact footings, finite normals, bounded geometry, closed party-roofs and protected authored routes pass');
