import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { LIGHTING_PROFILES, lightingProfileFor, resolveLightingProfile } = await import('../js/lighting-profiles.js');
const { createSky, DAY_FOG_COLOR } = await import('../js/sky.js');
const { createLighting } = await import('../js/lights.js');

const legacy = resolveLightingProfile(), dawn = lightingProfileFor({ id: 'prague' });
assert.equal(legacy, LIGHTING_PROFILES.overcast);
assert.equal(legacy.fog, DAY_FOG_COLOR);
assert.equal(lightingProfileFor({ id: 'saint-clair' }), legacy);
assert.equal(lightingProfileFor({ id: 'la-varenne' }), legacy);
assert.equal(lightingProfileFor({ id: 'pont-tournant' }), legacy);
assert.equal(lightingProfileFor({ id: 'prague', lightingProfile: 'overcast' }), legacy, 'explicit mission choice overrides automatic dawn');
assert.equal(resolveLightingProfile('missing-profile'), legacy, 'unknown authored names fall back safely');
assert.equal(dawn.id, 'prague-dawn');
assert.ok(dawn.exposure >= 1 && dawn.exposure <= 1.4 && dawn.lights.key.intensity < legacy.lights.key.intensity,
  'first light uses restrained direct light and bounded exposure');
assert.ok(dawn.sky.cloudCover >= 0.5 && dawn.sky.cloudCover <= 1 && dawn.sky.glowAzimuth < 0,
  'a broken cloud deck and low eastern glow distinguish dawn');

const camera = new THREE.Vector3(10, 5, 20), scene = new THREE.Scene();
const lights = createLighting(scene, { pool: 8, shadows: true, second: true, profile: dawn });
const objects = scene.children.slice(), shadows = objects.map(o => o.castShadow);
const state = () => [lights.hemi, lights.key, lights.rim].map(o => ({
  color: o.color.toArray(), ground: o.groundColor?.toArray(), intensity: o.intensity, position: o.position.toArray(),
}));
lights.update(0, 0, camera, 0); const originalNight = state();
lights.setDaylight(true); lights.update(0, 0, camera, 0);
const direction = lights.key.position.clone().sub(lights.key.target.position).normalize();
assert.ok(direction.x < 0 && direction.z > 0 && direction.y > 0 && direction.y < 0.3, 'dawn key is low in the east-north-east');
const first = lights.key.position.clone(); camera.y += 8; camera.z += 100;
lights.update(0, 0, camera, 0);
assert.ok(direction.distanceTo(lights.key.position.clone().sub(lights.key.target.position).normalize()) < 1e-9,
  'low dawn angle stays constant while the camera climbs the street');
assert.ok(Math.abs(lights.key.position.y - first.y - 8) < 1e-9);
camera.set(10, 5, 20);
for (let i = 0; i < 12; i++) {
  lights.setDaylight(false); lights.update(0, i, camera, 0);
  assert.deepEqual(state(), originalNight, 'dawn-to-night restores the original global light exactly');
  lights.setDaylight(true); lights.update(0, i, camera, 0);
}
assert.deepEqual(scene.children, objects, 'profiles reuse the existing light pool and scene objects');
assert.deepEqual(scene.children.map(o => o.castShadow), shadows, 'profiles keep the same shadow configuration');

const sky = createSky({ fog: '#9b9d9b', glowAzimuth: 0.71, cloudCover: 0.94, profile: dawn });
const u = sky.uniforms, before = ['uZenith', 'uHorizon', 'uGlow', 'uFog', 'uGlowDir'].map(k => u[k].value.toArray());
const geometry = sky.mesh.geometry, material = sky.mesh.material, version = material.version;
for (let i = 0; i < 12; i++) {
  sky.setDaylight(true);
  assert.equal(u.uFog.value.getHexString(), new THREE.Color(dawn.fog).getHexString(), 'sky horizon uses the same dawn fog as the world');
  assert.equal(u.uCloudCover.value, dawn.sky.cloudCover);
  assert.equal(u.uFront.value, 0, 'night searchlights stay hidden at dawn');
  assert.ok(u.uGlowDir.value.x < 0 && u.uGlow.value.r > u.uGlow.value.b, 'glow comes from the same warm eastern side as the key');
  const bearing = lights.key.position.clone().sub(lights.key.target.position); bearing.y = 0; bearing.normalize();
  assert.ok(bearing.dot(u.uGlowDir.value) > 0.999, 'sky glow and warm key share the same solar bearing');
  sky.setDaylight(false);
  assert.deepEqual(['uZenith', 'uHorizon', 'uGlow', 'uFog', 'uGlowDir'].map(k => u[k].value.toArray()), before);
  assert.equal(u.uCloudCover.value, 0.94, 'custom night cloud cover survives the profile roundtrip');
}
assert.equal(sky.mesh.geometry, geometry); assert.equal(sky.mesh.material, material); assert.equal(material.version, version,
  'day/night profile toggles change uniforms without recompiling or rebuilding sky geometry');
for (const uniform of Object.values(u)) {
  if (typeof uniform.value === 'number') assert.ok(Number.isFinite(uniform.value), 'all scalar sky uniforms remain finite');
  else if (uniform.value?.toArray) assert.ok(uniform.value.toArray().every(Number.isFinite), 'all sky vector colours/directions remain finite');
}
geometry.dispose(); material.dispose();
console.log('lighting-profiles-check: unchanged Normandy defaults, dawn light direction, graded-street stability, shared fog, bounded exposure, cloud variation and exact night roundtrips without scene/material rebuilds pass');
