// Run with: node fun/hedgerow/tests/clutter-check.mjs
// The ground clutter of the level (leaves, brick bits, stones, branches,
// ammunition boxes): every piece is a model the sets have; few have to be
// dropped for landing inside something solid (houses, walls, sandbags — the
// rules put them beside things, not in them); none lies in the river, and
// the middle of the village street stays clear but for the brick bits the
// shells threw there.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { L, world, terrain, models } from './level-world.mjs';
import { polylineDistance } from '../js/util.js';
const { insideSolid } = await import('../js/levelBuild.js');

const kinds = {};
let dropped = 0, wet = 0, inStreet = 0;
const tmp = { d: 0 };
for (const c of L.clutter) {
  assert.ok(models.has(c.m), `clutter ${c.m} is not a model in the sets`);
  if (insideSolid(world, terrain, c.x, c.z)) { dropped++; continue; }
  kinds[c.m] = (kinds[c.m] || 0) + 1;
  if (L.water.contains(c.x, c.z) && terrain.height(c.x, c.z) < L.water.level + 0.1) wet++;
  // the village street's middle (the square aside)
  if (c.z > 90 && c.z < 256 && !(c.z > 146 && c.z < 184) && c.m !== 'rubble_small') {
    if (Math.abs(c.x) < 2.6) inStreet++;
  }
}
const kept = L.clutter.length - dropped;
console.log(`clutter: ${kept} pieces (${dropped} dropped inside something solid): ` + Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', '));
assert.ok(kept > 250, 'there should be a good deal of clutter');
assert.ok(dropped / L.clutter.length < 0.2, `too much clutter lands inside things (${dropped} of ${L.clutter.length}): the rules are off`);
assert.equal(wet, 0, 'no clutter in the river');
assert.equal(inStreet, 0, 'the middle of the street stays clear (but for brick bits)');
console.log('clutter-check: the pieces exist, lie beside things rather than in them, out of the river and the middle of the street');
