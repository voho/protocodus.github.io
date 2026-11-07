// Run with: node fun/hedgerow/tests/field-routes-check.mjs
// Walk the new field routes against the real model colliders, including the
// raised duckboards. Check the culvert's barrel remains open but its visible
// arch stops bullets; broad nav reachability alone would miss both defects.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.HEDGEROW_LEVEL) {
  for (const id of ['saint-clair', 'la-varenne', 'pont-tournant']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, HEDGEROW_LEVEL: id }, stdio: 'inherit',
    });
    assert.equal(result.status, 0, `${id}: field route checks failed`);
  }
  console.log('field-routes-check: field engineering colliders and both new approaches pass');
  process.exit(0);
}

const { L, world } = await import('./level-world.mjs');
const { fieldDrain } = await import('../js/levels/kit.js');

// The drain has a rounded profile and fades into its field at both ends.
const drain = fieldDrain([[0, 0], [0, 20]], { depth: 0.95, half: 3 });
assert.equal(drain.cut(5, 0, 10), 4.05);
assert.equal(drain.cut(5, 0, 0), 5);
assert.equal(drain.cut(5, 0, 20), 5);
assert.equal(drain.cut(5, 3.1, 10), 5);
assert.ok(drain.cut(5, 2, 10) > drain.cut(5, 1, 10));

function walk(line) {
  let y = world.groundAt(line[0][0], line[0][1], 1e4, 0.5);
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i];
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2);
    for (let k = 1; k <= steps; k++) {
      const x = ax + (bx - ax) * k / steps, z = az + (bz - az) * k / steps;
      const pos = { x, z };
      world.pushOut(pos, 0.34, y, 1.7, 0.45);
      assert.ok(Math.hypot(pos.x - x, pos.z - z) < 0.05, `${L.id}: blocked route at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      const nextY = world.groundAt(x, z, y, 0.45);
      assert.ok(Math.abs(nextY - y) < 0.45, `${L.id}: unwalkable step at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      assert.equal(world.tooDeep(x, z, 0.9, nextY), false);
      y = nextY;
    }
  }
}

if (L.id === 'saint-clair') {
  const culvert = L.props.find((p) => p.m === 'stone_culvert');
  const y = culvert.y(culvert.x, culvert.z);
  const yaw = (culvert.yaw || 0) * Math.PI / 180, dx = Math.sin(yaw), dz = Math.cos(yaw);
  const hit = world.raycast(culvert.x - dx * 3, y + 1.2, culvert.z - dz * 3, dx, 0, dz, 6);
  assert.ok(hit && hit.collider !== 'terrain' && hit.t < 1.7, 'the stone arch stops a shot before the barrel');
  const opening = world.raycast(culvert.x - dx * 2, y + 0.7, culvert.z - dz * 2, dx, 0, dz, 4);
  assert.ok(!opening || opening.collider === 'terrain', 'the culvert barrel is open below the arch');
} else if (L.id === 'la-varenne') {
  // Use the actual curved centerline, not a chord cutting across its banks.
  walk(L.lines.DRAIN.filter(([, z]) => z < 127));
  assert.ok(L.fine.some(([x0, z0, x1, z1]) => x0 <= 14 && x1 >= 26 && z0 <= 64 && z1 >= 129), 'the drain is sampled at fine mesh resolution');
} else {
  walk(L.lines.MARSH_PATH);
  assert.equal(L.props.filter((p) => p.m === 'duckboard_walk').length, 8);
  // The scuttled barge is a second way over the canal: quay, gangway, quay.
  walk(L.lines.BARGE);
  assert.ok(world.groundAt(-38, 120, 1e4, 0.5) > L.water.level + 1, 'the barge deck stands clear of the water');
  walk(L.lines.BACK);
}
console.log(`ok    ${L.id}: field routes and engineering geometry`);
