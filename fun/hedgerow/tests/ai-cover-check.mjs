// Real crouched cover must survive full target visibility; actual flanks still dislodge it.
import assert from 'node:assert/strict';
import { aiFixture, soldier, advance, forceCombat } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { SHOT } = await import('../js/world.js');
const { readSet } = await import('../js/assets.js');
const rig = await parseUntexturedGLB('soldier'), models = new Map(), results = [];
readSet(await parseUntexturedGLB('weapons'), 'weapons', models);
for (const type of ['rifle', 'smg']) for (const height of [1, 1.4, 3]) {
  const f = aiFixture({ soldierModel: rig, models, player: [0, 30], boxes: [{ x: 0, y: height / 2, z: 5, hx: height === 3 ? 50 : 3, hy: height / 2, hz: .3, surface: 'stone' }], definitions: [soldier(0, 0, { type })] });
  const { G, enemies, hits } = f, e = enemies.list[0], shots = [];
  let reuses = 0, protectedFrames = 0;
  const clear = (muzzle, y) => G.world.clear(muzzle.x, muzzle.y, muzzle.z, G.player.pos.x, G.player.pos.y + y, G.player.pos.z, SHOT);
  G.audio.gunshot = (_kind, x, y, z) => {
    const muzzle = new THREE.Vector3(x, y, z);
    shots.push({ chestClear: clear(muzzle, 1.25), headClear: clear(muzzle, 1.65) });
  };
  const damage = G.player.damage;
  G.player.damage = (...args) => {
    const shot = shots.at(-1);
    assert.ok(shot?.chestClear || shot?.headClear, 'every actual damaging round retains a clear physical muzzle line');
    damage(...args);
  };
  advance(G, enemies, .3); forceCombat(e, G, { phase: 'move' }); e.perceiveTimer = 0; e.grenadeCheck = 1e6;
  let previous = { phase: e.phase, cover: e.cover }, lastAbandoned = null;
  advance(G, enemies, 20, () => {
    if (previous.phase === 'hide' && previous.cover && e.phase === 'move' && !e.cover) {
      lastAbandoned = previous.cover;
    }
    if (!previous.cover && e.cover && e.cover === lastAbandoned) reuses++;
    if (e.cover?.low && e.phase === 'hide' && e.stance === 'crouch' && e.sees && e.exposure === 1) {
      const chest = e.char.boneWorld('chest', new THREE.Vector3());
      if (!G.world.clear(G.player.pos.x, G.player.pos.y + 1.65, G.player.pos.z, chest.x, chest.y, chest.z, SHOT)) protectedFrames++;
    }
    previous = { phase: e.phase, cover: e.cover };
  });
  results.push({ type, height, shots: shots.length, hits: hits.length, reuses, protectedFrames });
  for (const enemy of enemies.list) enemy.char.dispose();
}
assert.ok(results.some(r => r.height === 1 && r.protectedFrames > 10), 'actual crouched torso protection coexists with full target visibility');
assert.ok(results.filter(r => r.height === 1).every(r => r.reuses === 0 && r.shots > 0 && r.hits > 0), 'useful low cover permits normal firing instead of the abandonment loop');
assert.ok(results.some(r => r.height === 1.4 && r.hits > 0), 'higher cover permits ordinary actual fire');
assert.ok(results.filter(r => r.height === 3).every(r => r.hits === 0 && r.reuses === 0), 'a real tall stone obstruction cannot be treated as target exposure or shot through');
console.log('ok    rifle/SMG actual rigs retain useful low cover and fire without immediate abandonment/reuse loops');
console.log('ok    higher cover still permits fire and full-height stone still blocks every damaging shot');

{
  const f = aiFixture({ soldierModel: rig, models, player: [0, 30], boxes: [{ x: 0, y: .5, z: 5, hx: 3, hy: .5, hz: .3 }], definitions: [soldier(0, 0)] });
  const { G, enemies } = f, e = enemies.list[0], chest = new THREE.Vector3();
  advance(G, enemies, .3); forceCombat(e, G, { phase: 'move' }); e.perceiveTimer = 0; e.grenadeCheck = 1e6;
  let sheltered = null;
  advance(G, enemies, 8, () => {
    e.char.boneWorld('chest', chest);
    if (e.cover && e.phase === 'hide' && e.stance === 'crouch' && chest.y < .85) { sheltered = { at: G.time, point: chest.toArray(), position: e.pos.toArray() }; return false; }
  });
  assert.ok(sheltered, 'the actual guard first reaches and crouches in real low cover');
  const original = e.cover;
  assert.equal(G.world.clear(G.player.pos.x, 1.65, G.player.pos.z, ...chest.toArray(), SHOT), false, 'the original frontal threat cannot see the crouched torso');
  G.player.pos.set(12, 0, e.pos.z); e.perceiveTimer = 0;
  assert.equal(G.world.clear(G.player.pos.x, 1.65, G.player.pos.z, ...chest.toArray(), SHOT), true, 'the actual flank physically exposes that same crouched torso');
  let releasedAt = null, returns = 0, previous = original, lastKnown = null;
  advance(G, enemies, 8, () => {
    if (previous === original && e.cover !== original) { releasedAt ??= G.time; lastKnown = { ...e.lastKnown }; }
    if (releasedAt && previous !== original && e.cover === original) returns++;
    previous = e.cover;
    const point = e.pos.clone(); G.world.pushOut(point, .34, point.y, 1.7, .45);
    assert.ok(point.distanceTo(e.pos) < .02, 'the response uses physically valid movement');
  });
  assert.ok(releasedAt !== null, 'a genuine visible flank still causes the guard to give up compromised shelter');
  assert.equal(lastKnown.x, 12, 'the response uses actual acquired target position');
  assert.equal(returns, 0, 'the guard does not retake the shelter while the flank still exposes it');
  for (const actor of enemies.list) actor.char.dispose();
}
console.log('ok    an actual visible flank exposes the crouched torso and causes a physically valid shelter change');
