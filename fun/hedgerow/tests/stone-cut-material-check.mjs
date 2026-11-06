// Modeled ashlar supplies the mortar joints; its face grain reuses the
// existing shared texture without replacing stone on other props.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createMaterialLibrary, GRAIN_UNIFORMS } = await import('../js/materials.js');
const shared = { wet: { value: .85 }, rain: { value: .7 }, time: { value: 1 } };
const stoneTexture = new THREE.Texture();
const textures = Object.freeze({ stone: stoneTexture });
const library = createMaterialLibrary(textures, shared);
const grain = GRAIN_UNIFORMS.tGrain.value, pixels = grain.image.data;
assert.ok(grain.isDataTexture && pixels.length === 512 * 512 * 4, 'existing RGBA grain is available');
const before = new THREE.Texture();
const cut = library.get('stone_cut'), dark = library.get('stone_cut_dark');
const secondLibrary = createMaterialLibrary(textures, shared);
const secondCut = secondLibrary.get('stone_cut');
const after = new THREE.Texture();
assert.equal(after.id, before.id + 1, 'material creation allocates no additional texture objects');
assert.equal(GRAIN_UNIFORMS.tGrain.value, grain, 'shared grain object is retained');
assert.equal(grain.image.data, pixels, 'shared grain pixels are retained');
assert.equal(library.get('stone_cut'), cut, 'light ashlar material is cached');
assert.equal(library.get('stone_cut_dark'), dark, 'dark ashlar material is cached');
assert.notEqual(cut, dark, 'palette colours use independent cached materials');
assert.notEqual(secondCut, cut, 'material libraries retain their own material cache');
for (const material of [cut, dark, secondCut]) {
  assert.equal(material.normalMap, grain, 'ashlar binds the exact shared normal texture');
  assert.deepEqual(material.normalScale.toArray(), [.4, .4], 'relief stays restrained');
}
function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
}
for (const [material, key] of [[cut, 'stone'], [dark, 'stone_dark']]) {
  const original = library.get(key), shader = compile(material), oldShader = compile(original);
  assert.equal(original.normalMap, stoneTexture, `${key}: existing props retain their loaded stone texture`);
  assert.deepEqual(original.normalScale.toArray(), [1, 1], `${key}: existing relief is unchanged`);
  assert.equal(oldShader.uniforms.tDetail.value, stoneTexture, `${key}: existing detail remains unchanged`);
  assert.equal(oldShader.uniforms.uTile.value, 1 / 2.2, `${key}: existing metre scale is unchanged`);
  assert.ok(material.color.equals(original.color), 'ashlar keeps its corresponding stone palette colour');
  assert.equal(shader.uniforms.tDetail.value, grain, 'normal and alpha detail share one texture');
  assert.equal(shader.uniforms.uTile.value, 1, 'metre-projected UVs sample a one-metre tile');
  assert.equal(shader.uniforms.uPorosity.value, .9, 'stone absorbs rain');
  assert.equal(shader.uniforms.uWet, shared.wet, 'weather remains live');
  assert.equal(shader.uniforms.uWetSheen.value, .72, 'damp masonry sheen remains active');
  assert.equal(shader.uniforms.uWetFloor.value, .49, 'damp masonry retains its roughness floor');
  assert.equal(shader.vertexShader, oldShader.vertexShader, 'existing detailed-masonry vertex program is reused');
  assert.equal(shader.fragmentShader, oldShader.fragmentShader, 'existing detailed-masonry fragment program is reused');
  assert.equal(material.customProgramCacheKey(), original.customProgramCacheKey(), 'identical shader source shares a cache entry');
  assert.ok(shader.fragmentShader.includes('float mineral ='), 'masonry weathering remains active');
  assert.ok(shader.fragmentShader.includes('texture2D(tDetail, vDetailUv).a'), 'packed alpha detail remains active');
}
console.log('stone-cut-material-check: shared texture/pixels, zero extra texture objects, cache reuse, original stone and wet masonry shader contract pass');
