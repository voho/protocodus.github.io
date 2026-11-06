// A fired round moves the shipped weapon and shoulders briefly. Inspect
// actual world-space geometry, rather than the recoil accumulator's math.
import assert from 'node:assert/strict';
import { aiFixture, soldier, forceCombat, advance } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { readSet } = await import('../js/assets.js');
const rig = await parseUntexturedGLB('soldier'), models = new Map();
readSet(await parseUntexturedGLB('weapons'), 'weapons', models);

for (const type of ['rifle', 'smg']) {
  const { G, enemies, shots } = aiFixture({ soldierModel: rig, models, definitions: [soldier(0, 0, { type, leash: 0 })] });
  const e = enemies.list[0];
  forceCombat(e, G); e.sees = true; e.exposure = 1; e.perceiveTimer = 1e6; e.target = { x: 0, z: 0 };
  const forward = new THREE.Vector3();
  const pitch = () => {
    forward.set(0, 0, 1).transformDirection(e.char.weapon.matrixWorld);
    return Math.atan2(forward.y, Math.hypot(forward.x, forward.z));
  };
  let previous = 0, before = null, after = null;
  advance(G, enemies, 1.2, () => {
    const current = pitch();
    if (shots.length) { before = previous; after = current; e.fireTimer = 100; return false; }
    previous = current;
  });
  assert.equal(shots.length, 1, `${type}: the observed pulse follows one actual fired round`);
  assert.ok(after - before > .006 && after - before < .07, `${type}: a bounded upward weapon response is visible (${after - before}rad)`);
  advance(G, enemies, .4);
  assert.ok(Math.abs(pitch() - before) < .009, `${type}: the weapon settles back onto its aim after the shot`);
  assert.equal(e.mag, e.wdef.mag - 1, `${type}: the visual response cannot spend extra rounds`);
  console.log(`ok    ${type}: the actual weapon recoils briefly and settles without extra shots`);
  for (const enemy of enemies.list) enemy.char.dispose();
}
console.log('ai-recoil-check: bounded shot response on the shipped soldier and weapons');
