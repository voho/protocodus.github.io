// A held trench rifleman must begin clear of the revetment and retain the
// same firing lane. Check both analytic and actual Float32 master footing.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const { L, world, terrain } = await import('./level-world.mjs');
assert.equal(L.id, 'saint-clair');
const index = L.enemies.findIndex((e) => e.group === 'trench' && e.type === 'rifle' && e.at[0] === 34 && e.at[1] === 387.2);
assert.equal(index, 35, 'the same authored enemy slot keeps its identity'); assert.equal(L.enemies.length, 48);   // 47 authored + the field-gate sentry appended last
const post = L.enemies[index]; assert.equal(post.yaw, 180); assert.equal(post.hold, true); assert.equal(post.inTrench, true);
const analytic = terrain.height, cache = new Map(), res = 0.5, { minX, minZ } = L.bounds;
const h = (i, j) => { const key = i + ',' + j; if (!cache.has(key)) cache.set(key, Math.fround(analytic(minX + i * res, minZ + j * res))); return cache.get(key); };
const master = (x, z) => {
  const gx = (x - minX) / res, gz = (z - minZ) / res, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
};
try {
  for (const height of [analytic, master]) {
    terrain.height = height;
    const oldY = world.groundAt(34, 387.5, height(34, 387.5), 0.45), old = { x: 34, z: 387.5 };
    world.pushOut(old, 0.34, oldY, 1.7, 0.45);
    assert.ok(Math.hypot(old.x - 34, old.z - 387.5) > 0.08, 'negative control reproduces the old revetment overlap');
    const y = world.groundAt(34, 387.2, height(34, 387.2), 0.45);
    for (const radius of [0.34, 0.42]) for (const body of [1.1, 1.7]) {
      const p = { x: 34, z: 387.2 }; world.pushOut(p, radius, y, body, 0.45);
      assert.ok(Math.hypot(p.x - 34, p.z - 387.2) < 0.001, 'new post has standing/crouching body margin');
    }
    assert.ok(Math.abs(y - oldY) < 0.01, 'the rifleman remains on the same trench floor');
    for (const eye of [1, 1.5]) assert.equal(world.clear(34, y + eye, 387.2, 34, height(34, 378) + 1.5, 378), true, 'standing/crouching firing lane is retained');
    // Highest-surface spawning can hide a body overlap by seating a man
    // on a tree cap. Check both the chosen support and the body at ground.
    const ford = L.enemies.find(e => e.group === 'ford' && e.type === 'rifle');
    assert.ok(ford && !ford.anchor && !ford.nest && !ford.inTrench);
    const [fx, fz] = ford.at, ground = height(fx, fz), feet = world.groundAt(fx, fz, 1e4, 0.5);
    assert.ok(Math.abs(feet - ground) < 0.02, 'the ford guard stands on the bank, not a nearby collider cap');
    for (const body of [1.2, 1.7]) for (const footing of [ground, feet]) {
      const p = { x: fx, z: fz }; world.pushOut(p, 0.34, footing, body, 0.45);
      assert.ok(Math.hypot(p.x - fx, p.z - fz) < 0.001, 'the ford guard has a clear full body at actual bank height');
    }
    assert.equal(world.clear(fx, ground + 1.4, fz, -32, height(-32, 275) + 1.4, 275), true, 'the grounded guard retains his ford sight line');
    const oldFord = { x: -30, z: 286 }, oldGround = height(oldFord.x, oldFord.z);
    assert.ok(world.groundAt(oldFord.x, oldFord.z, 1e4, 0.5) - oldGround > 5, 'negative control reproduces the former tree-cap spawn');
    world.pushOut(oldFord, 0.34, oldGround, 1.7, 0.45);
    assert.ok(Math.hypot(oldFord.x + 30, oldFord.z - 286) > 0.25, 'negative control exposes the body overlap hidden by cap seating');

  }
} finally { terrain.height = analytic; }
console.log('saint-post-check: old contact reproduced, trench and ford guards clear at both stances/master footings, old cap/contact controls reproduced, firing lanes retained');
