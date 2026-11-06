// Rain profiles govern every layer, including dry zero-capacity loads.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createWeather } = await import('../js/weather.js');
const terrain = { height: () => 0 };
const camera = { position: new THREE.Vector3(0, 1.6, 0) };
const thunder = [];
const dry = createWeather({ count: 0, capacity: 0, terrain, lightning: false, onThunder: e => thunder.push(e) });
for (let i = 0; i < 1200; i++) assert.equal(dry.update(.1, i * .1, camera, 0), 0);
assert.equal(thunder.length, 0, 'a dry dawn must not schedule storm thunder');
assert.equal(dry.intensity, 0, 'roof runoff and volumetric callers see the mission intensity');
for (const mesh of dry.group.children) {
  if (mesh.geometry?.instanceCount !== undefined) assert.ok(Number.isFinite(mesh.geometry.instanceCount));
  const data = mesh.geometry?.attributes.aSplash?.array;
  if (data) for (let i = 3; i < data.length; i += 4) assert.ok(data[i] < 0, 'dry scenes never emit rings or crowns');
}
dry.setCount(NaN); dry.setCount(-5);
for (const mesh of dry.group.children) if (mesh.geometry?.instanceCount !== undefined) assert.ok(Number.isFinite(mesh.geometry.instanceCount));

const rain = createWeather({ count: 3, capacity: 12, terrain, lightning: false, wind: [.6, .3] });
const streaks = rain.group.children.find(m => m.geometry?.attributes.aDrop);
assert.equal(streaks.geometry.instanceCount, 3);
rain.setCount(10); assert.equal(streaks.geometry.instanceCount, 10, 'higher quality uses reserved capacity');
rain.setCount(999); assert.equal(streaks.geometry.instanceCount, 12);
rain.setCount(0); assert.equal(streaks.geometry.instanceCount, 0);
rain.update(.25, 1, camera, .3);
assert.equal(rain.intensity, .3);
assert.ok(Math.abs(streaks.material.uniforms.uOpacity.value - .06) < 1e-10);
assert.deepEqual(streaks.material.uniforms.uVel.value.toArray(), [.6, -11.5, .3]);

const stormEvents = [];
const storm = createWeather({ count: 1, terrain, onThunder: e => stormEvents.push(e) });
for (let i = 0; i < 400; i++) storm.update(.1, i * .1, camera, 1);
assert.ok(stormEvents.length > 0, 'the original wet missions retain their storm');
console.log('weather-profile-check: dry storms/splashes off, valid zero counts, rain/wind profiles, quality capacity and storm fallback pass');
