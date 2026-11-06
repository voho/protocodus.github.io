// The three selected period façades keep their physical geometry and routes;
// only a bounded subset of existing front-window UVs carries room metadata.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const THREE = await import('three');
const { praguePeriodFrontages } = await import('../js/prague-frontage-details.js');
const { addPragueWindowInteriors } = await import('../js/prague-window-interiors.js');
const { createMaterialLibrary } = await import('../js/materials.js');
const { createStaticBatcher } = await import('../js/assets.js');
const { pragueModels } = await import('../js/prague-models.js');
const hash = a => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const expected = new Map([
  ['prague_old_classical', { mapped: 4, dark: 2, style: 1 }],
  ['prague_classical_sage', { mapped: 8, dark: 4, style: 1 }],
  ['prague_interwar', { mapped: 10, dark: 5, style: 2 }],
]);
const raw = praguePeriodFrontages();
const sentinel = { name: 'unrelated', prims: [], colliders: [] };
const catalog = new Map([...raw.map(m => [m.name, m]), [sentinel.name, sentinel]]);
const snapshots = new Map(raw.map(m => [m.name, m.prims.map(p => Object.fromEntries(
  Object.entries(p.geometry.attributes).map(([key, a]) => [key, hash(a.array)]),
))]));
assert.equal(addPragueWindowInteriors(catalog), catalog);
assert.equal(catalog.get('unrelated'), sentinel);
let material, rewritten = 0;
for (const source of raw) {
  const prepared = catalog.get(source.name), contract = expected.get(source.name);
  assert.notEqual(prepared, source);
  for (const key of ['box', 'colliders', 'anchors', 'extras']) assert.equal(prepared[key], source[key], source.name + ' preserves ' + key);
  assert.equal(prepared.prims.length, source.prims.length);
  let mapped = 0, dark = 0;
  for (let n = 0; n < source.prims.length; n++) {
    const before = source.prims[n], after = prepared.prims[n];
    if (before.key !== 'glass') { assert.equal(after, before); continue; }
    material ??= after.material;
    assert.equal(after.material, material, 'All three selected types share one marked source material');
    assert.notEqual(after.geometry, before.geometry);
    assert.deepEqual(Object.keys(after.geometry.attributes), Object.keys(before.geometry.attributes));
    assert.equal(after.geometry.index, before.geometry.index);
    assert.deepEqual(after.geometry.boundingBox, before.geometry.boundingBox);
    assert.deepEqual(after.geometry.boundingSphere, before.geometry.boundingSphere);
    const a = before.geometry.attributes, b = after.geometry.attributes;
    for (const [key, attr] of Object.entries(a)) {
      assert.equal(hash(attr.array), snapshots.get(source.name)[n][key], 'Source geometry remains unmutated');
      assert.equal(b[key].count, attr.count);
      if (key !== 'uv') assert.equal(hash(b[key].array), hash(attr.array), 'Only existing UVs can change');
    }
    for (let first = 0; first < a.position.count; first += 36) {
      let encoded = 0;
      const centre = [0, 0, 0];
      for (let i = first; i < first + 36; i++) {
        for (let c = 0; c < 3; c++) centre[c] += a.position.array[i * 3 + c] / 36;
        const changed = a.uv.getX(i) !== b.uv.getX(i) || a.uv.getY(i) !== b.uv.getY(i);
        assert.equal(changed, b.uv.getY(i) < -32, 'Unmarked shop/back/side UVs remain byte-identical');
        if (!changed) continue;
        rewritten++; encoded++;
        assert.ok(a.normal.getZ(i) > .9, 'Only outward-facing front triangles carry metadata');
        const u = b.uv.getX(i), v = b.uv.getY(i) + 64;
        assert.equal(Math.floor(v / 2), contract.style);
        assert.ok(Math.floor(u / 2) >= 0 && Math.floor(u / 2) < 6);
      }
      if (encoded) { assert.equal(encoded, 6); mapped++; }
      else if (centre[2] > 5 && centre[1] > 3.8) dark++;
    }
  }
  assert.deepEqual({ mapped, dark }, { mapped: contract.mapped, dark: contract.dark });
}
assert.equal(rewritten, 132);
assert.ok(material.isMeshStandardMaterial);
assert.equal(material.userData.pragueAmbientWindows, true);
assert.equal(material.map, null); assert.equal(material.emissiveMap, null);
assert.equal(material.emissive.getHex(), 0); assert.equal(material.transparent, false);
assert.equal(material.vertexColors, true); assert.equal(material.roughness, .05);
assert.equal(material.metalness, 0); assert.equal(material.envMapIntensity, 1.6);
const preparedEntries = [...catalog];
assert.equal(addPragueWindowInteriors(catalog), catalog);
assert.deepEqual([...catalog], preparedEntries, 'A second call neither clones geometry nor creates material');
const partial = new Map(raw.map(m => [m.name, m]));
partial.set(raw[0].name, catalog.get(raw[0].name));
assert.throws(() => addPragueWindowInteriors(partial), /partially prepared/);
const missing = new Map(raw.slice(0, 2).map(m => [m.name, m]));
const missingBefore = [...missing];
assert.throws(() => addPragueWindowInteriors(missing), /Missing genuine Prague frontage/);
assert.deepEqual([...missing], missingBefore, 'A failed catalog preparation cannot replace earlier entries');
const textures = Object.fromEntries(['stone', 'plaster', 'brick', 'tile', 'slate', 'bark', 'planks', 'metal', 'concrete', 'fabric', 'foliage'].map(key => [key, new THREE.Texture()]));
const library = createMaterialLibrary(textures, { wet: { value: 0 }, rain: { value: 0 }, time: { value: 10 } });
for (let i = 0; i < 3; i++) assert.equal(library.resolve(material), material, 'The real material factory preserves the marked shader');
const control = new THREE.MeshStandardMaterial({ name: 'glass' });
assert.equal(library.resolve(control), library.get('glass'), 'Ordinary unmarked glass keeps the palette path');
const shaders = [];
for (let i = 0; i < 3; i++) {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('windowAmbient'));
  assert.ok(!shader.fragmentShader.includes('emissiveColor.rgb=windowAmbient'));
  shaders.push(shader.vertexShader + shader.fragmentShader);
}
assert.equal(new Set(shaders).size, 1, 'Recompilation after context recreation produces the same shader');
const batch = createStaticBatcher(library, 48), expectedUVs = [];
for (const [i, source] of raw.entries()) {
  const model = catalog.get(source.name);
  batch.add(model, new THREE.Matrix4().compose(new THREE.Vector3(i * 14.3, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * Math.PI / 2), new THREE.Vector3(1, 1, 1)));
  expectedUVs.push(...model.prims.find(p => p.key === 'glass').geometry.attributes.uv.array);
}
const group = batch.build(), windows = group.children.filter(m => m.material === material);
assert.equal(windows.length, 1);
assert.deepEqual(Array.from(windows[0].geometry.attributes.uv.array), expectedUVs, 'Real static batching preserves metadata through world transforms');
assert.deepEqual(Object.keys(windows[0].geometry.attributes).sort(), ['color', 'normal', 'position', 'uv']);
const integrated = pragueModels();
for (const [name, model] of integrated) {
  const marked = model.prims.filter(p => p.material?.userData?.pragueAmbientWindows === true);
  assert.equal(marked.length, expected.has(name) ? 1 : 0, 'The actual factory scopes the hook to the three genuine period types');
}
for (const p of group.children) { for (const attr of Object.values(p.geometry.attributes)) assert.ok(attr.array.every(Number.isFinite)); p.geometry.dispose(); }
const geometries = new Set([...raw, ...catalog.values(), ...integrated.values()].flatMap(m => m.prims.map(p => p.geometry)));
for (const geometry of geometries) geometry.dispose();
const integratedMaterials = new Set([...integrated.values()].flatMap(m => m.prims.map(p => p.material)).filter(m => m?.userData?.pragueAmbientWindows));
for (const m of integratedMaterials) m.dispose();
material.dispose(); control.dispose(); for (const texture of Object.values(textures)) texture.dispose();
console.log('prague-window-interiors-check: 22 varied upper openings, 11 original dark openings, 132 UV vertices; exact geometry/routes, transactional/idempotent catalog, real material and static batching pass');
