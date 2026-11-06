// The actual Prague colliders must expose an open courtyard, a roofed
// passage and a blocked masonry wing as three different acoustic places.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAcousticOcclusion } from '../js/audio-space.js';
import { SHOT } from '../js/world.js';

if (process.env.HEDGEROW_LEVEL !== 'prague') {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, HEDGEROW_LEVEL: 'prague' }, stdio: 'inherit' });
  assert.equal(result.status, 0, 'Prague acoustic geometry failed'); process.exit(0);
}
const { L, world, height } = await import('./level-world.mjs');
const acoustic = createAcousticOcclusion();
const probe = (lx, ly, lz, sx, sy, sz) => {
  const dx = sx - lx, dy = sy - ly, dz = sz - lz, d = Math.hypot(dx, dy, dz);
  return world.raycast(lx, ly, lz, dx / d, dy / d, dz / d, Math.max(0, d - .25), SHOT, { noWater: true });
};
const roofAt = (x, y, z) => world.raycast(x, y + .05, z, 0, 1, 0, 18, SHOT, { noTerrain: true, noWater: true });
for (const point of [[0, 0], [-43, 27], [-44, 88], [35, 38]]) {
  const [x, z] = point;
  assert.equal(roofAt(x, height(x, z) + 1.6, z), null, `street/courtyard ${point} remains open to the sky`);
}
let passages = 0;
for (const passage of L.props.filter(prop => prop.m === 'prague_passage')) {
  const yaw = passage.yaw * Math.PI / 180, dx = Math.sin(yaw), dz = Math.cos(yaw);
  const y = (typeof passage.y === 'number' ? passage.y : height(passage.x, passage.z)) + 1.4;
  assert.ok(roofAt(passage.x, y, passage.z), `${passage.id}: the vault provides real overhead shelter`);
  acoustic.setProbe(probe);
  acoustic.setListener(passage.x - dx * 6.2, y, passage.z - dz * 6.2);
  assert.equal(acoustic.sample(passage.x + dx * 6.2, y, passage.z + dz * 6.2, 0).blocked, false, `${passage.id}: sound travels through the usable opening`);
  const sx = Math.cos(yaw) * 3.2, sz = -Math.sin(yaw) * 3.2;
  acoustic.setProbe(probe);
  acoustic.setListener(passage.x + sx - dx * 6.2, y, passage.z + sz - dz * 6.2);
  assert.equal(acoustic.sample(passage.x + sx + dx * 6.2, y, passage.z + sz + dz * 6.2, 0).surface, 'masonry', `${passage.id}: the adjacent wing muffles a source`);
  passages++;
}
assert.ok(passages >= 3);
// A shooter stepping out from this wing moves only 50 cm while staying in
// the same coarse source cell. Reusing the old wall must not hide the opening.
const east = L.props.find(prop => prop.id === 'east-passage-24');
assert.ok(east);
const eastY = (typeof east.y === 'number' ? east.y : height(east.x, east.z)) + 1.4;
acoustic.setProbe(probe); acoustic.setListener(east.x - 6.2, eastY, east.z);
assert.equal(acoustic.sample(east.x + 7.5, eastY, east.z - 2.2, 1).blocked, true);
assert.equal(acoustic.sample(east.x + 8, eastY, east.z - 2.2, 1.05).blocked, false, 'stepping out of the passage wing invalidates a shared coarse source cell');
assert.equal(L.ambience.rain, 0, 'the Prague audio profile remains dry');
console.log(`audio-prague-check: ${passages} roofed/open/blocked passage comparisons and open city courtyards pass against ${world.colliders.length} actual colliders`);
