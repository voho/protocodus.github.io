// Species detail must follow the same UV basis for colour and relief.
// Birch keeps its authored atlas while its fine lenticels run across the trunk.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createMaterialLibrary } = await import('../js/materials.js');
const shared = { wet: { value: .8 }, rain: { value: .7 }, time: { value: 1 } };
const materials = createMaterialLibrary({ bark: new THREE.Texture(), fabric: new THREE.Texture() }, shared);

function compile(name) {
  const map = new THREE.Texture(), normalMap = new THREE.Texture(), roughnessMap = new THREE.Texture();
  const source = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, color: '#c4c0b4' });
  source.name = name;
  const colour = source.color.clone(), material = materials.resolve(source);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal(material.map, map, `${name}: authored colour texture retained`);
  assert.equal(material.normalMap, normalMap, `${name}: authored relief retained`);
  assert.equal(material.roughnessMap, roughnessMap, `${name}: authored finish retained`);
  assert.ok(material.color.equals(colour), `${name}: atlas tint retained`);
  const projections = [...shader.fragmentShader.matchAll(/texture2D\(tBark,\s*(vBarkP\.[a-z]{2})\)/g)].map(match => match[1]);
  const frames = [...shader.fragmentShader.matchAll(/cotangentFrame\(normal, -vViewPosition,\s*(vBarkP\.[a-z]{2})\)/g)].map(match => match[1]);
  assert.deepEqual(frames, projections, `${name}: normal frames match sampled detail orientation`);
  return { material, shader, projections };
}
const birch = compile('birch_a'), oak = compile('oak_big'), beech = compile('beech_big'), pine = compile('pine_a');
assert.deepEqual(birch.projections, ['vBarkP.yx', 'vBarkP.yz'], 'birch detail runs horizontally across its papery bark');
assert.equal(birch.shader.uniforms.uBark.value, .25, 'fine birch relief stays restrained');
assert.equal(birch.shader.uniforms.uMoss.value, .15, 'existing moss coverage is retained');
for (const sample of [oak, beech, pine]) {
  assert.deepEqual(sample.projections, ['vBarkP.xy', 'vBarkP.zy'], 'other species keep their existing vertical furrows');
  assert.notEqual(sample.material.customProgramCacheKey(), birch.material.customProgramCacheKey(), 'papery projection has a distinct compiled program');
}
assert.equal(oak.shader.uniforms.uBark.value, 1);
assert.equal(beech.shader.uniforms.uBark.value, .35);
assert.equal(pine.shader.uniforms.uBark.value, .9);
console.log('bark-material-check: birch projection/normal basis, cache isolation and authored atlases pass; other species retained');
