// Real player near-misses retain uncertainty unless the source was heard or seen.
import assert from 'node:assert/strict';
import { nearMiss } from './ai-near-miss-fixture.mjs';
import { aiFixture, soldier } from './ai-fixture.mjs';
const THREE = await import('three');
const { createExplosives } = await import('../js/combat.js');

let searchRange = null;
for (const distance of [120, 180]) {
  const { record } = nearMiss({ distance }), [guard, mate] = record.beforeDelivery;
  assert.equal(record.ammoAfter, record.ammoBefore - 1, 'the actual player shot spends one round');
  assert.equal(record.shots, 1); assert.equal(record.hits, 0);
  assert.ok(record.impacts.length && record.suppression.length === 1, 'the actual stone impact calls real near-miss suppression once');
  assert.equal(guard.health, 100); assert.equal(mate.health, 100);
  assert.equal(guard.suppressed, 1.2); assert.equal(guard.state, 'combat');
  assert.equal(guard.lastSeen, -99); assert.equal(guard.contact, null);
  assert.ok(guard.lastKnown.uncertain, 'an unseen near-miss supplies no confirmed source position');
  const dx = guard.lastKnown.x - 1.5, dz = guard.lastKnown.z;
  assert.ok(dz < 0 && Math.hypot(dx, dz) < 40, 'the guard reacts in a bounded incoming direction');
  assert.ok(Math.abs(dx / dz - 1.5 / distance) < 1e-5, 'the real incoming horizontal bearing is retained');
  const estimated = Math.hypot(dx, dz);
  if (searchRange == null) searchRange = estimated;
  else assert.ok(Math.abs(estimated - searchRange) < 1e-6, 'changing hidden shooter range cannot change the guard\'s estimated range');
  assert.equal(mate.pendingContact, null, 'an uncertain near-miss cannot begin an exact shooter call');
  assert.equal(record.afterDelivery[1].state, 'idle');
  assert.equal(record.afterDelivery[1].contact, null);
}
console.log('ok    actual distant player near-misses suppress the survivor without revealing shooter range or alerting his unseen comrade');

{
  const { record } = nearMiss({ distance: 40 }); const guard = record.beforeDelivery[0];
  assert.equal(record.ammoAfter, record.ammoBefore - 1, 'the actual player shot spends one round');
  assert.equal(record.shots, 1); assert.equal(record.hits, 0);
  assert.equal(guard.lastKnown.z, -40, 'the real audible gunshot location survives its near-miss');
  assert.ok(!guard.lastKnown.uncertain); assert.equal(guard.lastSeen, -99);
}
console.log('ok    a real nearby gunshot still supplies its audible source before the impact');

{
  const { record } = nearMiss({ observed: true }); const guard = record.beforeDelivery[0];
  assert.equal(record.ammoAfter, record.ammoBefore - 1, 'the actual player shot spends one round');
  assert.equal(record.shots, 1); assert.equal(record.hits, 0);
  assert.ok(guard.lastSeen > 0);
  assert.equal(guard.lastKnown.z, record.realContact.z, 'suppression preserves a genuine current visual contact');
  assert.ok(!guard.lastKnown.uncertain);
}
console.log('ok    a real prior visual contact is not overwritten by hidden near-miss metadata');

{
  const f = aiFixture({ player: [0, -120], definitions: [soldier(0, 0, { hold: true })] });
  const { G, enemies } = f, e = enemies.list[0];
  G.enemies = enemies.list; G.hud.grenadeWarning = () => {};
  const explosive = createExplosives(G), blast = new THREE.Vector3(0, .05, -10);
  const grenade = explosive.throwGrenade('player', blast, new THREE.Vector3()); grenade.rest = true; grenade.fuse = .01;
  explosive.update(1 / 30);
  assert.equal(e.health, 100, 'the guard is outside the blast damage radius');
  assert.equal(e.suppressed, 2, 'the actual detonation still suppresses nearby survivors');
  assert.equal(e.lastKnown.z, blast.z); assert.ok(!e.lastKnown.uncertain);
  assert.equal(e.lastSeen, -99, 'blast suppression does not reveal the distant thrower');
}
console.log('ok    actual blast suppression retains its heard local detonation without inventing thrower contact');
