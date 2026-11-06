// Fair combat information: actual enemy updates, not helper-only assertions.
import assert from 'node:assert/strict';
import { aiFixture, soldier, advance, forceCombat } from './ai-fixture.mjs';
const { SHOT } = await import('../js/world.js');
const THREE = await import('three');
const { createExplosives } = await import('../js/combat.js');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`ok    ${name}`); }
  catch (error) { failures++; console.error(`FAIL  ${name}: ${error.message}`); }
}

check('an alerted soldier cannot see a silent player directly behind his head', () => {
  const { G, enemies } = aiFixture({ player: [0, -20], definitions: [soldier(0, 0, { hold: true })] });
  const e = enemies.list[0];
  forceCombat(e, G, { memory: { x: 0, y: 0, z: 20 } });
  e.perceiveTimer = 0;
  advance(G, enemies, 0.1);
  assert.equal(e.sees, false, 'breaking sight and circling behind should conceal the player until the soldier turns');
  G.events.emit('noise', { x: 0, z: -20, radius: 70, kind: 'shot' });
  advance(G, enemies, 1.2);
  assert.equal(e.sees, true, 'an audible shot gives him a reason to turn and reacquire');
});

check('a rifleman turns his weapon onto the target before firing', () => {
  const { G, enemies, shots } = aiFixture({ player: [20, 10], definitions: [soldier(0, 0, { leash: 0 })] });
  const e = enemies.list[0];
  forceCombat(e, G); e.aimTimer = 0;
  advance(G, enemies, 1 / 30);
  assert.equal(shots.length, 0, 'a fresh contact at the edge of vision must not be shot while the rifle faces away');
  advance(G, enemies, 1.5);
  assert.ok(shots.length > 0, 'the firing delay ends once the soldier faces and aims at the contact');
});

for (const group of ['squad', 'none']) check(`remote ${group} contact cannot freeze a stale search or redirect it`, () => {
  const { G, enemies } = aiFixture({ player: [0, 100], definitions: [soldier(0, 0, { group }), soldier(0, 75, { group })] });
  const [remote, observer] = enemies.list;
  forceCombat(observer, G); observer.perceiveTimer = 0;
  advance(G, enemies, 0.1);
  forceCombat(remote, G, { memory: { x: 0, y: 0, z: 20 } });
  remote.lastSeen = G.time - 12; remote.patience = 1; remote.perceiveTimer = 0;
  advance(G, enemies, 0.5);
  assert.equal(remote.state, 'search', 'a distant observer cannot refresh a contact this soldier did not receive');
  assert.ok(Math.abs(remote.srch.z - 20) < 0.01, 'he searches the place he knew, not a remote observer\'s current target');
});

check('a nearby confirmed report reaches a searching teammate after a human delay', () => {
  const { G, enemies } = aiFixture({ player: [0, 90], definitions: [soldier(0, 0), soldier(0, 35)] });
  const [listener, observer] = enemies.list;
  // A sound sends the listener on a search; the observer then spots the
  // player, beyond the listener's direct vision, and calls the contact.
  G.player.visible = 0;
  G.events.emit('noise', { x: -20, z: 10, radius: 60, kind: 'shot' });
  assert.equal(listener.state, 'search');
  G.player.visible = 1; forceCombat(observer, G); observer.perceiveTimer = 0;
  advance(G, enemies, 0.1);
  assert.equal(listener.state, 'search', 'the call is not instantaneous');
  advance(G, enemies, 2);
  assert.equal(listener.state, 'combat', 'the search order yields to a nearby confirmed contact');
  assert.ok(listener.lastKnown.z > 80, 'the call contains the observed position');
  assert.equal(listener.lastSeen < 0, true, 'a report does not masquerade as personal visual contact');
});

check('a mobile rifleman clears a persistently blocked firing lane on safe footing', () => {
  const { G, enemies, shots } = aiFixture({ player: [0, 30], definitions: [soldier(0, 0), soldier(0, 8, { hold: true, group: 'other-post' })] });
  const [rear, front] = enemies.list;
  forceCombat(rear, G); rear.perceiveTimer = 0;
  front.perceiveTimer = 1e6;
  advance(G, enemies, 0.8);
  assert.equal(shots.length, 0, 'he first waits for the comrade to pass');
  advance(G, enemies, 3);
  assert.ok(Math.abs(rear.pos.x) > .8, 'if the comrade stays put, he steps to a clear lane');
  assert.ok(shots.length > 0, 'and resumes firing after the physical move');
  assert.ok(front.pos.distanceTo(rear.pos) > .7, 'the solution does not push through the comrade');
});

check('a blocked man cannot clear a firing lane by stepping through walls', () => {
  const { G, enemies, shots } = aiFixture({ player: [0, 30], boxes: [{ x: -1, y: 1, z: 0, hx: .3, hy: 1, hz: 2 }, { x: 1, y: 1, z: 0, hx: .3, hy: 1, hz: 2 }], definitions: [soldier(0, 0), soldier(0, 8, { hold: true, group: 'other-post' })] });
  const [rear, front] = enemies.list;
  forceCombat(rear, G); rear.perceiveTimer = 0;
  front.perceiveTimer = 1e6;
  advance(G, enemies, 5);
  assert.ok(Math.abs(rear.pos.x) < .37, 'the narrow corridor prevents a lateral step');
  assert.equal(shots.length, 0, 'he continues to hold fire instead of shooting through the comrade');
});

check('an explicit counterattack order mobilizes soldiers with stale combat contacts', () => {
  const { G, enemies } = aiFixture({ player: [0, 60], definitions: [soldier(0, 0, { group: 'counter', leash: 40 })] });
  G.player.visible = 0;
  const e = enemies.list[0];
  forceCombat(e, G, { memory: { x: -20, y: 0, z: 0 } }); e.lastSeen = -15; e.perceiveTimer = 1e6;
  enemies.send('counter', 0, 45);
  assert.equal(e.state, 'search', 'having fought earlier cannot exempt a reserve from the counterattack');
  let closest = Infinity;
  advance(G, enemies, 30, () => { closest = Math.min(closest, Math.hypot(e.pos.x, e.pos.z - 45)); });
  assert.ok(closest < 8, `the soldier physically approaches the ordered position (closest ${closest.toFixed(1)}m)`);
});

check('a counterattack order preserves a live engagement and a dug-in post', () => {
  const { G, enemies } = aiFixture({ player: [0, 30], definitions: [soldier(0, 0, { group: 'counter' }), soldier(10, 0, { group: 'counter', hold: true })] });
  const [fighter, dugIn] = enemies.list;
  forceCombat(fighter, G); fighter.sees = true; fighter.reloadT = 2; fighter.mag = 2;
  enemies.send('counter', 0, 40);
  assert.equal(fighter.state, 'combat', 'the order does not erase a current visual engagement');
  assert.equal(fighter.reloadT, 2, 'a reload in progress is preserved');
  assert.equal(dugIn.state, 'idle', 'an immobile assigned post is not turned into an assault soldier');
  advance(G, enemies, 1);
  assert.ok(dugIn.pos.distanceTo({ x: 10, y: 0, z: 0 }) < .01, 'the dug-in man stays at his post');
});

check('ordered reserves advance in bounds while engaged, and wait when pinned', () => {
  for (const pinned of [false, true]) {
    const { G, enemies } = aiFixture({ player: [0, 65], definitions: [soldier(0, 0, { group: 'counter', leash: 40 })] });
    const e = enemies.list[0];
    forceCombat(e, G); e.sees = true; e.perceiveTimer = 0;
    enemies.send('counter', 0, 60);
    let farthest = 0;
    advance(G, enemies, pinned ? 4 : 20, () => {
      farthest = Math.max(farthest, e.pos.z);
      if (pinned) e.suppressed = 1;
    });
    if (pinned) assert.ok(farthest < 1, 'an assault order does not override ongoing suppression');
    else assert.ok(farthest > 25, `a distant visible target cannot keep an ordered reserve standing at home (${farthest.toFixed(1)}m advanced)`);
  }
});

check('an ordered reserve advances beyond its first useful cover position', () => {
  const { G, enemies } = aiFixture({ player: [0, 65], boxes: [{ x: 0, y: .6, z: 15, hx: 4, hy: .6, hz: .3 }, { x: 0, y: .6, z: 35, hx: 4, hy: .6, hz: .3 }], definitions: [soldier(0, 0, { group: 'counter', leash: 40 })] });
  const e = enemies.list[0];
  forceCombat(e, G); e.sees = true; e.perceiveTimer = 0;
  enemies.send('counter', 0, 60);
  let sheltered = false, farthest = 0;
  advance(G, enemies, 28, () => {
    farthest = Math.max(farthest, e.pos.z);
    if (e.cover && e.phase === 'hide' && e.pos.z < 20) sheltered = true;
  });
  assert.ok(sheltered, 'the first wall is used as real shelter on the way');
  assert.ok(farthest > 28, `an assault order does not finish at the first distant wall (${farthest.toFixed(1)}m advanced)`);
});

check('both ends of a tall wall provide the same usable corner shelter', () => {
  for (const side of [-1, 1]) {
    const at = [side * 2.7, 14.1];
    const { G, enemies } = aiFixture({ player: [side * 10, 30], boxes: [{ x: 0, y: 1.5, z: 15, hx: 3, hy: 1.5, hz: .3 }], definitions: [soldier(...at)] });
    G.player.visible = 0;
    const e = enemies.list[0];
    forceCombat(e, G, { phase: 'move' }); e.perceiveTimer = 1e6;
    advance(G, enemies, .2);
    assert.ok(e.cover && e.phase === 'hide', `the man at corner ${side} recognizes his existing shelter`);
    assert.ok(Math.hypot(e.pos.x - at[0], e.pos.z - at[1]) < .3, 'a missing sample cannot send him running out of useful shelter');
    assert.equal(G.world.clear(e.pos.x, e.pos.y + 1.05, e.pos.z, G.player.pos.x, G.player.pos.y + 1.2, G.player.pos.z, SHOT), false, 'the actual crouched position is protected');
    e.pos.x = side * 3.2; e.pos.z = 13.9; e.vel.set(0, 0, 0); e.phase = 'hide'; e.phaseTimer = 2;
    advance(G, enemies, .7);
    assert.equal(G.world.clear(e.pos.x, e.pos.y + 1.05, e.pos.z, G.player.pos.x, G.player.pos.y + 1.2, G.player.pos.z, SHOT), false, 'returning from a peek reaches actual shelter, even against an oblique threat');
  }
});

check('a silent rear grenade needs a reason to be noticed', () => {
  const { G, enemies } = aiFixture({ player: [0, 100], definitions: [soldier(0, 0)] });
  G.player.visible = 0;
  const e = enemies.list[0], grenade = { kind: 'player', pos: new THREE.Vector3(0, .05, -4), fuse: 3, rest: true };
  G.explosives.list.push(grenade); e.perceiveTimer = 1e6;
  advance(G, enemies, .2);
  assert.equal(e.danger, null, 'an unseen stationary object behind his head is not a warning');
  assert.ok(e.pos.length() < .01);
  e.yaw = e.home.yaw = Math.PI;
  advance(G, enemies, .2);
  assert.ok(e.danger, 'looking at the same grenade permits ordinary visual recognition');
  assert.ok(e.pos.length() < .01, 'recognition still includes the human reaction delay');
});

check('an actual nearby grenade impact warns a man behind his back', () => {
  const { G, enemies } = aiFixture({ player: [0, 100], boxes: [{ x: 0, y: -.15, z: -4, hx: 8, hy: .15, hz: 8 }], definitions: [soldier(0, 0)] });
  G.player.visible = 0; G.enemies = enemies.list;
  G.hud.grenadeWarning = () => {}; G.hud.notice = () => {};
  G.explosives = createExplosives(G);
  const e = enemies.list[0]; e.perceiveTimer = 1e6;
  const grenade = G.explosives.throwGrenade('player', new THREE.Vector3(0, 1, -3), new THREE.Vector3(0, -4, 0));
  let impactAt = null, impactYaw = null, recognizedAt = null;
  G.events.on('grenadeBounce', () => { impactAt ??= G.time; impactYaw ??= e.yaw; });
  for (let i = 0; i < 40; i++) {
    G.time += 1 / 30; enemies.update(1 / 30); G.explosives.update(1 / 30);
    if (impactAt == null) assert.equal(e.danger, null, 'the silent rear flight is not a telepathic warning');
    if (e.danger && recognizedAt == null) recognizedAt = G.time;
  }
  assert.ok(impactAt != null, 'the actual grenade physics produces a hard audible impact');
  assert.ok(recognizedAt >= impactAt && recognizedAt < impactAt + .22, 'the nearby impact is recognized at the next ordinary sensing update');
  assert.ok(Math.abs(impactYaw) < 1, 'the actual impact comes from behind his facing direction; hearing may then turn him');
  assert.equal(e.danger.grenade, grenade);
  assert.ok(e.danger.reactAt >= impactAt + .29, 'hearing does not remove the human reaction delay');
  assert.ok(e.pos.length() > .3, 'he actually starts to evade after that delay');
  assert.ok(e.lastSeen < 0, 'hearing a grenade cannot become visual contact with its hidden thrower');
});

assert.equal(failures, 0, `${failures} fair-senses scenario(s) failed`);
console.log('ai-senses-check: peripheral vision, weapon alignment, local contact reports and search interruption');
