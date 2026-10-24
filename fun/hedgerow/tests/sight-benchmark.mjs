// Run with: node fun/hedgerow/tests/sight-benchmark.mjs
// Compare boolean visibility with the equivalent full nearest-hit query on
// the shipped colliders and sampled terrain. Timings are informational;
// only agreement is asserted, so machine speed never makes this fail.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { L, world, height } from './level-world.mjs';
import { createWorld, SIGHT } from '../js/world.js';
const { createTerrain } = await import('../js/terrain.js');

// Loading normally yields to the browser. Use a Node turn without opening
// persistent MessagePorts while constructing the real heightfield here.
globalThis.scheduler ??= { yield: () => new Promise((resolve) => setImmediate(resolve)) };
const terrain = await createTerrain({ bounds: L.bounds, height, splat: L.splat }, {}, {});
const sight = createWorld({ ...L.bounds, cell: 8, terrain, water: L.water });
for (const col of world.colliders) sight.add({ ...col });

// Enemy eye positions looking at standing players along and beside the
// route, within 100 m: open ground, buildings, cover and rising terrain.
const queries = [];
for (const e of L.enemies) {
  const [x, z] = e.at;
  const y = terrain.height(x, z) + (e.stance === 'crouch' ? 1.05 : 1.6);
  for (let pz = 10; pz <= 560; pz += 10) for (const px of [-20, -10, 0, 10, 20]) {
    if (Math.hypot(px - x, pz - z) > 100) continue;
    for (const h of [1.2, 1.65]) queries.push([x, y, z, px, terrain.height(px, pz) + h, pz, SIGHT]);
  }
}
const options = { noWater: true };
function nearestClear(ax, ay, az, bx, by, bz, mask) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return !sight.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, mask, options);
}
let visible = 0;
for (const query of queries) {
  const result = sight.clear(...query);
  assert.equal(result, nearestClear(...query), 'boolean visibility agrees with the nearest-hit query');
  visible += result;
}

function measure(fn, repeats) {
  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < repeats; i++) for (const query of queries) checksum += fn(...query);
  return { ms: performance.now() - start, checksum };
}
for (let i = 0; i < 3; i++) { measure(nearestClear, 2); measure(sight.clear, 2); }
const runs = { nearest: [], boolean: [] }, checksum = {};
const fns = { nearest: nearestClear, boolean: sight.clear };
const batches = 9, repeats = 10;
for (let i = 0; i < batches; i++) {
  // Alternate order so warm-up and changing CPU speed do not favour one.
  for (const key of i % 2 ? ['boolean', 'nearest'] : ['nearest', 'boolean']) {
    const run = measure(fns[key], repeats);
    runs[key].push(run.ms);
    checksum[key] = run.checksum;
  }
}
const median = (a) => a.sort((a, b) => a - b)[Math.floor(a.length / 2)];
const nearestMs = median(runs.nearest), booleanMs = median(runs.boolean);
console.log(JSON.stringify({
  queries: queries.length, colliders: sight.colliders.length, visible,
  batches, repeatsPerBatch: repeats, checksum,
  medianMs: { nearest: nearestMs, boolean: booleanMs },
  speedup: nearestMs / booleanMs,
}, null, 2));
