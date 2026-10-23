// Run with: node fun/hedgerow/tests/rain-surfaces-check.mjs
// Wet solids keep their relief; water rings stay on exposed ground and water,
// never on the horizontal collider cap above a curved haystack.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createMaterialLibrary, createWaterMaterial } = await import('../js/materials.js');
const { createWeather } = await import('../js/weather.js');
const { createWorld } = await import('../js/world.js');

const shared = { wet: { value: 1 }, time: { value: 1 }, rain: { value: 1 } };
const textures = { bark: new THREE.Texture(), fabric: new THREE.Texture(), metal: new THREE.Texture() };
const materials = createMaterialLibrary(textures, shared);
function shaderOf(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  return shader.fragmentShader;
}
const bakedHay = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
bakedHay.name = 'haystack';
for (const material of [materials.get('hay'), materials.resolve(bakedHay), materials.get('metal_gray')]) {
  const shader = shaderOf(material);
  assert.ok(!shader.includes('rainRipples(vWPosM'), `${material.name}: no water ripple normals on solid props`);
  assert.ok(!shader.includes('mWetUp'), `${material.name}: no standing-water film on curved solid surfaces`);
  assert.ok(shader.includes('diffuseColor.rgb *= mix(1.0, 0.62, uWet * uPorosity)'), `${material.name}: wet darkening remains`);
  assert.ok(shader.includes('roughnessFactor * 0.5 + 0.06'), `${material.name}: wet sheen remains`);
}
assert.ok(shaderOf(createWaterMaterial(textures, shared)).includes('rainRipples(p * 1.5'),
  'river and crater-pond water keep their ripple normals');

const terrain = { height: () => 0 };
const world = createWorld({ minX: -64, maxX: 64, minZ: -64, maxZ: 64, terrain });
world.add({ type: 'cyl', x: 0, y: 0, z: 0, r: 5, h: 3, surface: 'hay' });
const camera = { position: new THREE.Vector3(0, 1.7, 0) };
function splashSamples(weather) {
  weather.update(0.25, 1, camera);
  const meshes = weather.group.children.filter((m) => m.geometry?.attributes.aSplash);
  const samples = (m) => {
    const data = m.geometry.attributes.aSplash.array, result = [];
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 0) result.push([...data.slice(i, i + 4)]);
    return result;
  };
  return { rings: samples(meshes.find((m) => m.material.vertexShader.includes('vLife'))),
    crowns: samples(meshes.find((m) => m.material.vertexShader.includes('vAge'))) };
}
const dry = splashSamples(createWeather({ count: 1, terrain, world }));
assert.ok(dry.rings.length > 50, 'rain rings remain on exposed ground');
assert.ok(dry.rings.every(([x, y, z]) => y === 0 && Math.hypot(x, z) >= 5),
  'no horizontal ring is emitted on the haystack or sheltered ground beneath it');
assert.ok(dry.crowns.some(([x, y, z]) => y === 3 && Math.hypot(x, z) < 5),
  'solid props still catch rain droplets at their top surface');
const water = { level: 1, contains: () => true };
const wet = splashSamples(createWeather({ count: 1, terrain, world, water }));
assert.ok(wet.rings.length > 50 && wet.rings.every(([x, y, z]) => y === 1 && Math.hypot(x, z) >= 5),
  'rings remain on the water surface without floating on props above it');
console.log('rain-surfaces-check: solid props stay wet without water rings; exposed ground, river and ponds retain rain effects');
