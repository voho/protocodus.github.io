// Replay the radio hold's six reserve soldiers through the actual Prague
// collision world and real AI, without WebGL. A* connectivity alone misses
// corridor jams and a counterattack that arrives after the hold has ended.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (process.env.HEDGEROW_LEVEL !== 'prague') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, HEDGEROW_LEVEL: 'prague' }, stdio: 'inherit' });
  assert.equal(r.status, 0, 'Prague counterattack replay failed'); process.exit(0);
}
const { L, world, terrain } = await import('./level-world.mjs');
const { aiFixture, advance } = await import('./ai-fixture.mjs');
const hold = L.objectives.find((o) => o.kind === 'hold');
const definitions = L.enemies.filter((e) => hold.counter.includes(e.group));
assert.equal(definitions.length, 6, 'the hold has a bounded six-man reserve');
const { G, enemies } = aiFixture({ world, terrain, level: L, definitions, player: [hold.x, hold.z] });
// Disable perception so contact/fire does not stop the navigation replay.
// The soldier remains at the actual hold point, within AI activation range.
G.player.alive = false;
const records = new Map(enemies.list.map((e) => [e, { group: e.group, min: Infinity, arrival: null, pathFails: 0 }]));
const send = () => hold.counter.forEach((g) => enemies.send(g, hold.x, hold.z));
send(); let sentAt = 0;
advance(G, enemies, hold.time, (t) => {
  // Match mission.js's periodic update of the counterattack destination.
  if (t - sentAt >= 20) { send(); sentAt = t; }
  for (const e of enemies.list) {
    const r = records.get(e), d = Math.hypot(e.pos.x - hold.x, e.pos.z - hold.z);
    r.min = Math.min(r.min, d); r.pathFails = Math.max(r.pathFails, e.pathFails);
    if (d < 15 && r.arrival === null) r.arrival = t;
  }
});
const result = [];
for (const [e, r] of records) {
  assert.ok(r.arrival !== null && r.arrival > 9 && r.arrival < 27, `${r.group}: reserve arrival ${r.arrival} leaves no usable defence phase`);
  assert.ok(r.min < 8, `${r.group}: soldier never enters the annex fighting area`);
  assert.ok(r.pathFails <= 2, `${r.group}: repeated blocked paths (${r.pathFails})`);
  assert.ok(Math.hypot(e.pos.x - hold.x, e.pos.z - hold.z) < 18, `${r.group}: reserve wanders out of the battle before the report finishes`);
  result.push({ group: r.group, arrivalSeconds: +r.arrival.toFixed(1), closestMetres: +r.min.toFixed(1), pathFails: r.pathFails });
}
assert.equal(new Set(result.map((r) => r.group)).size, 2, 'both route approaches are exercised');
console.log(`prague-encounter-check: all reserves enter the annex during the 45 s hold: ${JSON.stringify(result)}`);
