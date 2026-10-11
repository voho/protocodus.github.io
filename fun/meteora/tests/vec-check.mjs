// Run with: node tests/vec-check.mjs
import { test, run, assert, near, finite } from './harness.mjs';
import * as V from '../js/vec.js';
import { makeRng, fbm3, noise3 } from '../js/rng.js';

test('normalize of a zero vector is zero, not NaN', () => {
  assert.deepEqual(V.normalize([0, 0, 0], [0, 0, 0]), [0, 0, 0]);
});
test('qRotate and qRotateInv are inverses', () => {
  const q = V.qFromAxisAngle([0, 0, 0, 1], V.normalize([0, 0, 0], [1, 2, 3]), 1.1);
  const v = V.qRotateInv([0, 0, 0], q, V.qRotate([0, 0, 0], q, [4, -5, 6]));
  near(v[0], 4, 1e-9); near(v[1], -5, 1e-9); near(v[2], 6, 1e-9);
});
test('qIntegrate with a body pitch rate raises the nose', () => {
  const q = V.qIdentity();
  for (let i = 0; i < 120; i++) V.qIntegrate(q, [Math.PI / 2, 0, 0], 1 / 120);
  const nose = V.qRotate([0, 0, 0], q, [0, 0, -1]);
  near(nose[1], 1, 1e-3, 'nose up after 90°');
  near(Math.hypot(...q), 1, 1e-12);
});
test('qLookRotation points local -Z at the forward vector', () => {
  const q = V.qLookRotation([0, 0, 0, 1], V.normalize([0, 0, 0], [1, 0, -1]), [0, 1, 0]);
  const nose = V.qRotate([0, 0, 0], q, [0, 0, -1]);
  near(nose[0], Math.SQRT1_2, 1e-9); near(nose[2], -Math.SQRT1_2, 1e-9);
});
test('the rng is deterministic per seed', () => {
  const a = makeRng(7), b = makeRng(7), c = makeRng(8);
  const sa = [a.next(), a.next(), a.next()];
  assert.deepEqual(sa, [b.next(), b.next(), b.next()]);
  assert.notDeepEqual(sa, [c.next(), c.next(), c.next()]);
});
test('rng.unit is on the unit sphere and noise stays in range', () => {
  const r = makeRng(3);
  for (let i = 0; i < 1000; i++) near(V.len(r.unit([0, 0, 0])), 1, 1e-9);
  for (let i = 0; i < 1000; i++) {
    const x = r.range(-500, 500), y = r.range(-500, 500), z = r.range(-500, 500);
    const n = noise3(x, y, z, 1), f = fbm3(x, y, z, 1);
    finite([n, f]);
    assert.ok(n >= -1 && n <= 1 && f >= -1.01 && f <= 1.01);
  }
});
await run();
