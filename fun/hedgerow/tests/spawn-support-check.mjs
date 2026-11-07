// Soldiers must start with clear bodies. Ground posts need terrain/low-step
// support; named gunner/trench/platform anchors retain their authored heights.
// Highest-surface queries can otherwise hide tree/parapet/roof cap overlaps.
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
const { worldAnchor } = await import('../js/assets.js');
const { polylineDistance } = await import('../js/util.js');
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
const fixed = L.enemies.filter(d => intentional(d));
assert.ok(mobile.length > 0);
// Preserve the authored fixed support contract, then test its actual body.
// An intentional anchor must not exempt an NPC from its revetment/wall.
function fixedFeet(d) {
  if (d.inTrench) {
    let best;
    for (const key of Object.keys(L.lines).filter(k => k.startsWith('TRENCH'))) {
      const p = polylineDistance(L.lines[key], ...d.at, {});
      if (!best || p.d < best.d) best = p;
    }
    // Runtime captures its analytic trench anchor before creating sampled terrain.
    return [best.px, analytic(best.px, best.pz), best.pz];
  }
  if (d.nest) {
    const p = placed.get(d.nest);
    return worldAnchor(p.model, 'gunner', p.x, p.y, p.z, p.yaw) || [p.x, p.y, p.z + .8];
  }
  if (d.bunker) {
    const p = placed.get(d.bunker), a = worldAnchor(p.model, 'gunner', p.x, p.y, p.z, p.yaw);
    assert.ok(a, 'the bunker uses its real runtime gunner anchor'); return a;
  }
  if (d.anchorOf) {
    const [id, name] = d.anchorOf, p = placed.get(id);
    return worldAnchor(p.model, name, p.x, p.y, p.z, p.yaw);
  }
  return d.anchor.slice(0, 3);
}
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
    for (const d of fixed) {
      const [x, feet, z] = fixedFeet(d);
      for (const body of [1.2, 1.7]) {
        const p = { x, z }; world.pushOut(p, .34, feet, body, .45);
        assert.ok(Math.hypot(p.x - x, p.z - z) < .001, `${L.id} ${d.group} authored anchor must clear a standing and crouched NPC capsule`);
      }
    }
    if (L.id === 'saint-clair') {
      const role = fixed.find(d => d.group === 'trench' && d.type === 'rifle' && d.yaw === 185);
      assert.ok(role, 'the historical revetment control retains its trench role');
      const [x, feet, z] = fixedFeet({ ...role, at: [13, 389] }), old = { x, z };
      world.pushOut(old, .34, feet, 1.7, .45);
      assert.ok(Math.hypot(old.x - x, old.z - z) > .3, 'negative control exposes the former held rifleman inside a revetment');
    }
  }
} finally { terrain.height = analytic; }
console.log(`spawn-support-check: ${L.id} ${mobile.length} ground posts and ${fixed.length} fixed anchors clear at standing/crouched analytic/master support`);
