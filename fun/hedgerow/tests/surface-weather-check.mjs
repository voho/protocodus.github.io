// Run with: node fun/hedgerow/tests/surface-weather-check.mjs
// Rain must preserve the difference between fibrous cover, stone, timber
// and painted steel, including the materials used by real shipped GLBs.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const THREE = await import('three');
const { surfaceResponse, wetRoughness } = await import('../js/surface-weather.js');
const { createMaterialLibrary } = await import('../js/materials.js');

const shared = { wet: { value: 1 }, time: { value: 1 }, rain: { value: 1 } };
const textures = Object.fromEntries(['bark', 'fabric', 'metal', 'stone', 'plaster', 'concrete'].map(k => [k, new THREE.Texture()]));
const materials = createMaterialLibrary(textures, shared);
const compile = (material) => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
};
function baked(name) {
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  material.name = name;
  return compile(materials.resolve(material));
}
function names(set) {
  const data = readFileSync(new URL(`../assets/models/${set}.glb`, import.meta.url));
  return JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12))).materials.map(m => m.name);
}
for (const [set, expected] of [['village', ['haystack', 'house_a', 'fence']], ['military', ['sandbags', 'crate', 'truck']]]) {
  const shipped = names(set);
  for (const name of expected) assert.ok(shipped.includes(name), `${name} exists in the shipped atlas`);
}
const fibre = baked('sandbags'), timber = baked('crate'), steel = baked('truck');
assert.ok(fibre.uniforms.uWetFloor.value > timber.uniforms.uWetFloor.value, 'soaked hessian keeps a rougher finish than timber');
assert.ok(timber.uniforms.uWetFloor.value > steel.uniforms.uWetFloor.value, 'old timber keeps a rougher finish than painted steel');
assert.ok(fibre.uniforms.uWetSheen.value < steel.uniforms.uWetSheen.value, 'absorbed water adds less sheen than water on painted steel');
assert.ok(fibre.uniforms.uPorosity.value > steel.uniforms.uPorosity.value, 'fibrous cover absorbs more water than painted steel');
for (const name of names('village').concat(names('military'), names('weapons'), names('nature'), names('soldier'))) {
  const response = surfaceResponse(name);
  for (const key of ['sheen', 'floor', 'porosity']) assert.ok(Number.isFinite(response[key]) && response[key] >= 0 && response[key] <= 1, `${name}: bounded ${key}`);
}
for (const name of ['haystack', 'sandbags', 'tent', 'camo_net']) {
  const shader = baked(name);
  assert.ok(!shader.fragmentShader.includes('mRivX'), `${name}: absorbed rain does not draw glossy rivulets`);
  assert.ok(shader.uniforms.uWetFloor.value >= 0.7, `${name}: fibres retain a rough finish`);
}
for (const name of ['house_a', 'churchyard_wall', 'bunker']) {
  const shader = baked(name);
  assert.ok(shader.fragmentShader.includes('float mineral ='), `${name}: weathering is constrained to rough mineral surfaces`);
  assert.ok(shader.fragmentShader.includes('texture2D(metalnessMap, vMetalnessMapUv).b'), `${name}: metal parts are excluded`);
}
for (const name of ['crate', 'truck', 'm1_garand', 'allied']) {
  assert.ok(!baked(name).fragmentShader.includes('float mineral ='), `${name}: carried and non-masonry props do not grow lichen`);
}
const atlas = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture(), metalnessMap: new THREE.Texture() });
atlas.name = 'house_b';
materials.resolve(atlas);
for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) assert.ok(atlas[key].anisotropy >= 8, `${key}: baked atlas keeps detail at oblique angles`);
const masonry = baked('house_a');
assert.ok(masonry.fragmentShader.indexOf('float surfVariance =') < masonry.fragmentShader.indexOf('#include <lights_physical_fragment>'),
  'subpixel normal variance is folded into roughness before lighting');
assert.ok(compile(materials.get('canvas')).uniforms.uWetSheen.value < compile(materials.get('metal_gray')).uniforms.uWetSheen.value,
  'procedural palette materials use the same physical rain distinction');
console.log('surface-weather-check: shipped hessian/hay/timber/steel keep distinct wet finishes; masonry weathering excludes metal and carried kit; microdetail is filtered before lighting');
