// Run with: node tests/sky-check.mjs
// three.js reverses its sorted render lists when the camera uses a reversed
// depth buffer, so the sky cannot rely on draw order to stay behind the
// world. Instead its layers are depth-tested and placed beyond everything:
// the rocks, the planet and the planet's rings — and inside the far plane.
import { test, run, assert } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { RENDER, SKY, FIELD } from '../js/config.js';

test('the sky layers sit beyond the planet and its rings', () => {
  const farthestPlanet = SKY.planet.distance + SKY.planet.radius * SKY.planet.ringOuter;
  assert.ok(SKY.layerRadius > farthestPlanet * 1.05, `${SKY.layerRadius} vs ${farthestPlanet}`);
});
test('the sun sits in front of the sky layers', () => {
  assert.ok(SKY.sunDistance < SKY.layerRadius * 0.9);
});
test('everything in the sky is inside the far plane', () => {
  assert.ok(SKY.layerRadius < RENDER.far * 0.95);
});
test('the belt is far nearer than any of it', () => {
  const beltReach = Math.hypot(...FIELD.half) + FIELD.types.at(-1).radius * FIELD.landmarks.scale[1];
  assert.ok(SKY.planet.distance - SKY.planet.radius * SKY.planet.ringOuter > beltReach);
});
test('no sky layer opts out of the depth test', () => {
  const source = readFileSync(new URL('../js/sky.js', import.meta.url), 'utf8');
  assert.ok(!/depthTest:\s*false/.test(source.replace(/function bake[\s\S]*?\n}\n/g, '')),
    'sky.js turns the depth test off outside the one-time bakes');
});
await run();
