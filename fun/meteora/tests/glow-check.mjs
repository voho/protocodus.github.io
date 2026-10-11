// Run with: node tests/glow-check.mjs
// The player's own engine plume reaches back toward the chase camera. A glow
// sprite that touches the camera would cover the whole screen, many times
// over with additive blending; sprites fade out as they near the camera and
// are dropped before they reach it.
import { registerHooks } from 'node:module';
import { test, run, assert, near } from './harness.mjs';

const three = new URL('../../../assets/vendor/three/three.module.min.js', import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (s === 'three' ? { url: three, shortCircuit: true } : next(s, c)) });
const THREE = await import('three');
const { createGlowBatch } = await import('../js/glow.js');

const batch = () => {
  const g = createGlowBatch(new THREE.Scene(), 64);
  g.setCamera(0, 0, 0);
  g.begin();
  return g;
};
const intensityOf = (g, i) => g.mesh.geometry.getAttribute('iColor').array[i * 4 + 3];

test('a sprite well away from the camera keeps its full intensity', () => {
  const g = batch();
  g.add(0, 0, -100, 2, 1, 1, 1, 5);
  g.end();
  assert.equal(g.count, 1); near(intensityOf(g, 0), 5, 1e-9);
});
test('a sprite whose glow reaches the camera is dropped', () => {
  const g = batch();
  g.add(0, 0, -1.5, 2, 1, 1, 1, 5);
  g.end();
  assert.equal(g.count, 0);
});
test('a sprite near the camera fades smoothly', () => {
  const g = batch();
  g.add(0, 0, -5, 2, 1, 1, 1, 5);
  g.end();
  assert.equal(g.count, 1);
  const k = intensityOf(g, 0);
  assert.ok(k > 0 && k < 5, `faded to ${k}`);
});
test('a streak passing beside the camera is judged by its nearest point', () => {
  const g = batch();
  // centred 50 m away, but its far end passes 1 m from the camera
  g.add(0, 1, -50, 0.5, 1, 1, 1, 5, 0, 0, 1, 100);
  g.end();
  assert.equal(g.count, 0);
});
test('without a camera set, sprites are left alone (no NaN from a streak)', () => {
  const g = createGlowBatch(new THREE.Scene(), 8);
  g.begin();
  g.add(0, 0, -5, 2, 1, 1, 1, 5, 0, 0, 1, 10);
  g.end();
  assert.equal(g.count, 1); near(intensityOf(g, 0), 5, 1e-9);
});
await run();
