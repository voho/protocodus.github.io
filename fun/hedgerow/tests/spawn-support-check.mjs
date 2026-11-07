// Unanchored soldiers must start on ground or a low step, with clear bodies.
// Highest-surface queries can otherwise hide overlaps by seating a soldier
// on a tree/parapet/roof cap. Named gunner/trench/platform anchors are explicit.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The normal gate covers the complete catalog. An explicit environment
// selection retains a fast, isolated single-level diagnostic mode.
if (!process.env.HEDGEROW_LEVEL) {
  const { MISSIONS } = await import('../js/missions.js');
  for (const { id } of MISSIONS) execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, HEDGEROW_LEVEL: id }, stdio: 'inherit',
  });
  console.log(`spawn-support-check: all ${MISSIONS.length} missions passed`);
  process.exit(0);
}
const { L, world, terrain, placed } = await import('./level-world.mjs');
const intentional = (d) => {
  if (d.nest || d.bunker) {
    assert.ok(placed.has(d.nest || d.bunker), 'a fixed weapon position names a real placed model');
    return true;
  }
  if (d.anchorOf) {
    const [id, name] = d.anchorOf;
    assert.ok(placed.get(id)?.model.anchors[name], 'a platform position names a real model anchor');
    return true;
  }
  if (d.inTrench) {
    assert.ok(Object.keys(L.lines).some(k => k.startsWith('TRENCH')), 'a trench position has an authored trench');
    return true;
  }
  if (d.anchor) {
    assert.ok(d.anchor.length >= 3 && d.anchor.slice(0, 3).every(Number.isFinite), 'an explicit fixed position is finite');
    return true;
  }
  return false;
};
const mobile = L.enemies.filter(d => !intentional(d));
assert.ok(mobile.length > 0);
const analytic = terrain.height, cache = new Map(), { minX, minZ } = L.bounds;
const sample = (i, j) => {
  const key = i + ',' + j;
  if (!cache.has(key)) cache.set(key, Math.fround(analytic(minX + i * .5, minZ + j * .5)));
  return cache.get(key);
};
const master = (x, z) => {
  const gx = (x - minX) * 2, gz = (z - minZ) * 2, i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
  const a = sample(i, j), b = sample(i + 1, j), c = sample(i, j + 1), d = sample(i + 1, j + 1);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
};
try {
  for (const height of [analytic, master]) {
    terrain.height = height;
    for (const d of mobile) {
      const [x, z] = d.at, ground = height(x, z), feet = world.groundAt(x, z, 1e4, .5);
      assert.ok(feet - ground <= .6, `${L.id} ${d.group} soldier must have ground/low-step support, rather than a cap`);
      for (const footing of [ground, feet]) for (const body of [1.2, 1.7]) {
        const p = { x, z }; world.pushOut(p, .34, footing, body, .45);
        assert.ok(Math.hypot(p.x - x, p.z - z) < .001, `${L.id} ${d.group} soldier must have a clear body at ground and spawn height`);
      }
    }
  }
} finally { terrain.height = analytic; }
console.log(`spawn-support-check: ${L.id} ${mobile.length} unanchored posts clear at standing/crouched ground/master support; ${L.enemies.length - mobile.length} fixed anchors classified`);
