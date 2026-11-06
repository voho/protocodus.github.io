// Incoming hits reveal direction, not an unseen source range or elevation.
import assert from 'node:assert/strict';
import { aiFixture, soldier, advance, forceCombat } from './ai-fixture.mjs';
const THREE = await import('three');
const { createExplosives } = await import('../js/combat.js');

const quiet = f => {
  f.G.player.visible = 0;
  for (const e of f.enemies.list) e.perceiveTimer = 1e6;
};
function hiddenHit(distance, height = 0) {
  const f = aiFixture({ player: [80, 100], boxes: [{ x: 4, y: 1.5, z: 0, hx: .2, hy: 1.5, hz: 4 }, { x: 0, y: 2, z: -30, hx: 20, hy: 2, hz: .3 }], definitions: [soldier(0, 0, { hold: true }), soldier(8, 0, { hold: true })] });
  quiet(f);
  const [wounded, mate] = f.enemies.list;
  assert.equal(f.G.world.clear(0, 1.5, 0, 0, 1.5, -distance), false, 'the isolated incoming-hit contract is tested without possible visual confirmation');
  f.G.events.emit('noise', { x: 0, z: -distance, radius: 75, kind: 'shot' });
  wounded.damage(25, { x: 0, y: height, z: -distance }, 'body', true);
  const known = { ...wounded.lastKnown };
  assert.equal(wounded.health, 75);
  assert.equal(wounded.state, 'combat', 'a survivor responds to incoming fire');
  assert.equal(wounded.lastSeen, -99, 'a hit cannot invent a personal sighting');
  assert.equal(wounded.contact, null, 'a hit cannot invent confirmed visual contact');
  assert.ok(known.uncertain, 'the response explicitly retains uncertainty');
  assert.ok(known.z < 0 && Math.abs(known.x) < .01, 'the incoming bearing is preserved');
  assert.ok(Math.abs(known.z) < 40, 'the search area is bounded near the guard');
  assert.equal(known.y, wounded.pos.y, 'a hit cannot reveal hidden shooter elevation');
  advance(f.G, f.enemies, 2);
  assert.equal(mate.state, 'idle', 'an uncertain hit cannot create a confirmed squad alarm through a wall');
  assert.equal(mate.contact, null);
  assert.equal(mate.lastKnown, null);
  return known;
}
assert.deepEqual(hiddenHit(120, 0), hiddenHit(200, 35), 'the same bearing must not encode source range or elevation');
console.log('ok    surviving unseen hits supply a bounded bearing without hidden range, elevation, live-player tracking or squad certainty');

{
  const f = aiFixture({ player: [0, 40], definitions: [soldier(0, 0, { hold: true })] });
  const e = f.enemies.list[0]; forceCombat(e, f.G); e.perceiveTimer = 0; advance(f.G, f.enemies, .05);
  const seen = { ...e.lastKnown }, seenAt = e.lastSeen;
  assert.ok(e.sees, 'positive control has a real personal sighting');
  quiet(f); f.G.player.pos.set(70, 0, 100);
  e.damage(1, { x: 0, y: 25, z: -120 }, 'body', true);
  assert.equal(e.lastKnown.x, seen.x); assert.equal(e.lastKnown.z, seen.z);
  assert.equal(e.lastSeen, seenAt, 'a hit neither replaces nor refreshes a genuine sighting');
  advance(f.G, f.enemies, 1);
  e.damage(1, { x: 0, y: 25, z: -120 }, 'body', true);
  assert.equal(e.lastKnown.z, seen.z, 'a recent real sighting remains useful');
  advance(f.G, f.enemies, .8);
  e.damage(1, { x: 0, y: 25, z: -120 }, 'body', true);
  assert.ok(e.lastKnown.uncertain && e.lastKnown.z < 0, 'repeated hits do not perpetually refresh old visual knowledge');
  assert.equal(e.lastSeen, seenAt);
}
console.log('ok    recent genuine visual knowledge survives a hidden hit and ages normally under repeated hits');

for (const z of [-20, -40]) {
  const f = aiFixture({ player: [0, z], definitions: [soldier(0, 0, { hold: true })] });
  quiet(f); const e = f.enemies.list[0];
  f.G.events.emit('noise', { x: 0, z, radius: 75, kind: 'shot' });
  e.damage(1, { x: 0, y: 0, z }, 'body', true);
  assert.equal(e.lastKnown.z, z, 'a real close or investigative gunshot retains its heard position');
  assert.ok(!e.lastKnown.uncertain);
  assert.equal(e.lastSeen, -99, 'hearing is not reclassified as seeing');
}
console.log('ok    actual near and farther gunshot hearing still guides a wounded guard');

{
  const f = aiFixture({ player: [0, 40], boxes: [{ x: 5, y: 1.5, z: 20, hx: .2, hy: 1.5, hz: 25 }], definitions: [soldier(0, 0, { hold: true }), soldier(10, 0, { hold: true, yaw: 180 })] });
  const [e, mate] = f.enemies.list; quiet(f);
  e.damage(1, { x: 0, y: 0, z: -120 }, 'body', true);
  assert.ok(e.lastKnown.uncertain);
  f.G.player.visible = 1; e.yaw = 0; e.perceiveTimer = 0;
  advance(f.G, f.enemies, 2);
  assert.ok(e.sees && e.lastSeen > 1, 'the wounded guard can acquire a real visible target normally');
  assert.equal(e.lastKnown.z, 40); assert.ok(!e.lastKnown.uncertain);
  assert.equal(mate.state, 'combat', 'a genuine subsequent visual report still reaches his comrade');
  assert.equal(mate.contact.z, 40); assert.equal(mate.lastSeen, -99);
}
console.log('ok    genuine subsequent visual acquisition replaces uncertainty and produces normal local reports');

{
  const f = aiFixture({ player: [0, 40], boxes: [{ x: 5, y: 1.5, z: 20, hx: .2, hy: 1.5, hz: 25 }], definitions: [soldier(0, 0, { hold: true }), soldier(10, 0, { hold: true, yaw: 180 })] });
  const [observer, listener] = f.enemies.list;
  forceCombat(observer, f.G); observer.perceiveTimer = 0; advance(f.G, f.enemies, .05);
  const due = listener.pendingContact.at; quiet(f);
  advance(f.G, f.enemies, due - f.G.time + .001);
  assert.ok(listener.contact, 'a real local visual report has arrived');
  const report = { ...listener.contact };
  listener.damage(1, { x: 10, y: 0, z: -120 }, 'body', true);
  assert.equal(listener.lastKnown.z, report.z, 'a fresh received observation survives unrelated unseen hit metadata');
  assert.ok(!listener.lastKnown.uncertain);
  assert.deepEqual(listener.contact, report, 'the delivered report is not replaced or refreshed');
  assert.equal(listener.lastSeen, -99, 'a received report stays distinct from personal vision');
}
console.log('ok    a fresh real report survives unseen hit metadata without becoming personal vision');

for (const state of ['idle', 'ambush', 'combat']) {
  const f = aiFixture({ player: [0, -120], definitions: [soldier(0, 0, { hold: true, tough: 3 })] });
  quiet(f); const e = f.enemies.list[0];
  e.state = state;
  f.G.enemies = f.enemies.list; f.G.hud.grenadeWarning = () => {};
  const explosive = createExplosives(f.G), blast = new THREE.Vector3(0, .05, -5);
  let beforeDamage = null;
  const damage = e.damage;
  e.damage = (...args) => { beforeDamage = { known: { ...e.lastKnown }, part: args[2], from: args[1].clone() }; return damage(...args); };
  const grenade = explosive.throwGrenade('player', blast, new THREE.Vector3());
  grenade.rest = true; grenade.fuse = .01;
  explosive.update(1 / 30);
  assert.ok(e.health < 300 && !e.dead, 'the actual grenade nonlethally damages the guard');
  assert.equal(beforeDamage.part, 'explosion');
  assert.equal(beforeDamage.known.z, blast.z, 'actual combat emits the audible detonation before applying its damage');
  assert.equal(e.lastKnown.z, blast.z, 'blast damage retains the physically heard detonation location');
  assert.ok(!e.lastKnown.uncertain, 'a nearby heard blast is not replaced by an arbitrary projected bullet bearing');
  assert.equal(e.lastSeen, -99, 'hearing a detonation cannot reveal its hidden thrower');
  assert.notEqual(e.lastKnown.z, f.G.player.pos.z);
}
console.log('ok    actual grenade event ordering retains its nearby blast location without revealing the distant thrower');

{
  const f = aiFixture({ player: [0, 40], definitions: [soldier(0, 0, { hold: true })] });
  const e = f.enemies.list[0]; forceCombat(e, f.G); e.perceiveTimer = 0; advance(f.G, f.enemies, .05);
  quiet(f); advance(f.G, f.enemies, 4);
  e.damage(1, { x: 0, y: 0, z: -120 }, 'body', true); e.grenadeCheck = 0;
  advance(f.G, f.enemies, 12);
  assert.ok(e.lastKnown.uncertain);
  assert.equal(f.thrown.length, 0, 'a bearing without source range cannot authorize a blind grenade');
  assert.equal(e.pendingThrow, null);
}
console.log('ok    an uncertain hit bearing cannot become a blind grenade target');
