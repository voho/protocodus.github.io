// Actual-rig casualty sensing, delayed local response and bounded recent work.
import assert from 'node:assert/strict';
import { aiFixture, soldier, advance } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { SIGHT } = await import('../js/world.js');
const rig = await parseUntexturedGLB('soldier');

function scenario({ distance = 10, yaw = 0, wall = false, lowWall = false, daylight = true, lightning = 0, hold = false, leash = 18 } = {}) {
  const f = aiFixture({ soldierModel: rig, player: [0, -120], boxes: wall ? [{ x: 0, y: 1.5, z: distance / 2, hx: 3, hy: 1.5, hz: .2 }] : lowWall ? [{ x: 0, y: .675, z: distance - 2, hx: 3, hy: .675, hz: .2 }] : [], definitions: [soldier(0, distance, { hold: true }), soldier(0, 0, { yaw, hold, leash })] });
  const { G, enemies } = f; G.daylight = daylight; G.lightning = lightning; G.player.visible = 0;
  for (const e of enemies.list) e.perceiveTimer = 1e6;
  advance(G, enemies, .3);
  const [victim, observer] = enemies.list; let rays = 0;
  const clear = G.world.clear;
  G.world.clear = (...args) => { if (args[6] === SIGHT) rays++; return clear(...args); };
  const kill = () => {
    G.events.emit('noise', { x: G.player.pos.x, z: G.player.pos.z, radius: 75, kind: 'shot' });
    victim.damage(1000, G.player.pos, 'body', true);
  };
  const dispose = () => { for (const e of enemies.list) e.char.dispose(); };
  return { ...f, victim, observer, kill, dispose, rays: () => rays };
}

{
  const f = scenario(), { G, enemies, observer, victim } = f;
  advance(G, enemies, .5); assert.equal(f.rays(), 0, 'steady unaware guards gain no additional sight traces');
  f.kill(); assert.ok(victim.char.ragdoll, 'the witness watches the real shipped falling body');
  assert.equal(observer.state, 'idle'); assert.equal(observer.lastKnown, null);
  advance(G, enemies, .35);
  assert.equal(observer.state, 'idle', 'recognizing a fall cannot skip the human reaction delay');
  assert.equal(observer.lastKnown, null, 'queued observation does not immediately aim at anything');
  advance(G, enemies, 1.2);
  assert.equal(observer.state, 'search'); assert.equal(observer.srch.reason, 'casualty');
  assert.ok(observer.lastKnown.uncertain);
  assert.ok(observer.lastKnown.z > 8 && observer.lastKnown.z < 12, 'the guard remembers the visible casualty, not the unseen shooter');
  assert.equal(observer.lastSeen, -99); assert.equal(observer.contact, null); assert.equal(observer.pendingContact, null);
  assert.equal(enemies.intel.size, 0, 'a visible casualty cannot become confirmed squad intel about its unseen shooter');
  assert.equal(f.thrown.length, 0, 'a casualty position cannot authorize a grenade at a fictional shooter');
  assert.ok(f.rays() <= 2, 'one visible witness uses only its bounded body/head check');
  const path = [];
  advance(G, enemies, 14, () => { path.push(observer.pos.toArray()); assert.ok(Math.hypot(observer.pos.x - observer.home.x, observer.pos.z - observer.home.z) <= observer.leash + .1, 'casualty investigation respects the authored leash'); });
  assert.ok(path.some(p => Math.hypot(p[0], p[2] - 10) < 3), 'the actual guard walks over and checks the visible body');
  f.dispose();
}
console.log('ok    a visible real fall causes a delayed body investigation, without shooter contact or extra idle traces');

for (const options of [{ wall: true }, { yaw: 180 }, { daylight: false, distance: 14 }]) {
  const f = scenario(options); f.kill(); advance(f.G, f.enemies, 3);
  assert.equal(f.observer.state, 'idle', 'occlusion, looking away and darkness range cannot invent a casualty sighting');
  assert.equal(f.observer.lastKnown, null); assert.equal(f.observer.casualtyReaction, null);
  f.dispose();
}
for (const options of [{ daylight: true, distance: 14 }, { daylight: false, distance: 6 }, { daylight: false, distance: 12, lightning: .8 }]) {
  const f = scenario(options); f.kill(); advance(f.G, f.enemies, 1.8);
  assert.equal(f.observer.srch?.reason, 'casualty', 'a genuinely visible daytime, close nighttime or lit fall remains noticeable');
  assert.equal(f.observer.contact, null); f.dispose();
}
console.log('ok    actual FOV, solid cover and daylight range gate recognition, while close night and lit falls still work');

{
  const f = scenario({ lowWall: true }); f.kill(); advance(f.G, f.enemies, 1.8);
  assert.equal(f.observer.srch?.reason, 'casualty', 'a genuinely exposed head remains a visible fall when low cover hides the chest');
  assert.equal(f.rays(), 2, 'head-only recognition uses the same bounded two-ray allowance');
  f.dispose();
}
console.log('ok    a real head-only fall remains visible above low cover');

for (const options of [{ hold: true }, { leash: 4 }]) {
  const f = scenario(options); f.kill(); advance(f.G, f.enemies, 5);
  assert.equal(f.observer.state, 'alert'); assert.equal(f.observer.srch, null);
  assert.ok(Math.hypot(f.observer.pos.x, f.observer.pos.z) < .03, 'a held or short-leash post cannot leave to inspect a casualty');
  assert.equal(f.observer.lastSeen, -99); assert.equal(f.observer.contact, null); f.dispose();
}
{
  const f = aiFixture({ soldierModel: rig, player: [0, -120], definitions: [soldier(0, 10, { hold: true }), soldier(-2, 0), soldier(0, 0), soldier(2, 0)] });
  f.G.daylight = true; f.G.player.visible = 0; advance(f.G, f.enemies, .3);
  f.enemies.list[0].damage(1000, f.G.player.pos, 'body', true); advance(f.G, f.enemies, 2);
  assert.equal(f.enemies.list.filter(e => e.srch?.reason === 'casualty').length, 1, 'only one nearby squad member investigates the same incident');
  assert.ok(f.enemies.list.slice(1).every(e => e.awareness > .5 && e.contact === null));
  for (const e of f.enemies.list) e.char.dispose();
}
console.log('ok    held posts and short leashes stay put, and local squad witnesses nominate one investigator');

for (const [wallHalfWidth, leash, shouldReach] of [[15, 12, false], [3, 18, true]]) {
  const f = aiFixture({ soldierModel: rig, player: [0, -120], boxes: [{ x: 0, y: .35, z: 5, hx: wallHalfWidth, hy: .35, hz: .4 }], definitions: [soldier(0, 10, { hold: true }), soldier(0, 0, { leash })] });
  f.G.daylight = true; f.G.player.visible = 0;
  for (const e of f.enemies.list) e.perceiveTimer = 1e6;
  advance(f.G, f.enemies, .3);
  const [victim, observer] = f.enemies.list;
  victim.damage(1000, f.G.player.pos, 'body', true);
  let furthest = 0, visitedBody = false;
  advance(f.G, f.enemies, 20, () => {
    furthest = Math.max(furthest, Math.hypot(observer.pos.x, observer.pos.z));
    visitedBody ||= Math.hypot(observer.pos.x, observer.pos.z - 10) < 3;
    const point = observer.pos.clone(); f.G.world.pushOut(point, .34, point.y, 1.7, .45);
    assert.ok(point.distanceTo(observer.pos) < .02, 'a bounded casualty detour cannot cross the wall');
  });
  assert.ok(observer.lastKnown?.uncertain && observer.lastKnown.z > 8, 'the low wall permits a genuine sighting of the fall');
  assert.ok(furthest <= observer.leash + .1, `a casualty alone cannot authorize an out-of-leash walking detour (${furthest.toFixed(2)} m)`);
  assert.equal(visitedBody, shouldReach, 'a physically clear in-leash detour still permits the guard to check the body');

  for (const e of f.enemies.list) e.char.dispose();
}
console.log('ok    a visible casualty cannot pull a guard beyond his leash through an obstacle detour');

for (const heardZ of [-20, -40]) {
  const f = scenario(); f.kill(); advance(f.G, f.enemies, .15);
  assert.ok(f.observer.casualtyReaction, 'the visible fall is awaiting its human response');
  f.G.player.pos.set(0, 0, heardZ); f.G.events.emit('noise', { x: 0, z: heardZ, radius: 75, kind: 'shot' });
  advance(f.G, f.enemies, 2);
  assert.equal(f.observer.lastKnown.z, heardZ, 'actual close/far gunshot knowledge takes priority over the body alarm');
  assert.ok(!f.observer.lastKnown.uncertain); assert.notEqual(f.observer.srch?.reason, 'casualty');
  assert.equal(f.observer.casualtyReaction, null); f.dispose();
}
{
  const f = scenario(); f.kill(); advance(f.G, f.enemies, .15);
  f.G.player.pos.set(0, 0, 40); f.G.player.visible = 1; f.observer.perceiveTimer = 0;
  advance(f.G, f.enemies, .2);
  assert.ok(f.observer.sees && f.observer.lastSeen > 0, 'a real visual acquisition takes priority before the delayed body response');
  assert.equal(f.observer.lastKnown.z, 40); assert.ok(!f.observer.lastKnown.uncertain);
  assert.equal(f.observer.casualtyReaction, null); f.dispose();
}
console.log('ok    real auditory and visual player contacts supersede a queued casualty response');

for (const sense of ['noise', 'vision', 'grenade']) {
  const f = scenario(); f.kill(); advance(f.G, f.enemies, 1.5);
  assert.equal(f.observer.srch?.reason, 'casualty');
  if (sense === 'noise') {
    f.G.player.pos.set(0, 0, -40); f.G.events.emit('noise', { x: 0, z: -40, radius: 75, kind: 'shot' });
    advance(f.G, f.enemies, .2);
    assert.equal(f.observer.lastKnown.z, -40); assert.ok(!f.observer.lastKnown.uncertain);
    assert.equal(f.observer.srch.z, -40, 'new real gunfire redirects the investigation to its heard location');
    assert.equal(f.observer.srch.reason, 'investigate', 'the new real sound restores ordinary sound investigation semantics');
  } else if (sense === 'vision') {
    f.G.player.pos.set(0, 0, 12); f.G.player.visible = 1; f.observer.perceiveTimer = 0;
    advance(f.G, f.enemies, 1);
    assert.equal(f.observer.state, 'combat'); assert.equal(f.observer.lastKnown.z, 12);
    assert.ok(f.observer.sees && !f.observer.lastKnown.uncertain);
  } else {
    const grenade = { kind: 'player', pos: new THREE.Vector3(0, .05, 3), fuse: 3, rest: true };
    f.G.explosives.list.push(grenade); f.observer.dangerTimer = 0;
    const before = f.observer.pos.clone(); advance(f.G, f.enemies, .9);
    assert.equal(f.observer.danger?.grenade, grenade, 'a visible nearby grenade takes priority over the body investigation');
    assert.ok(f.observer.pos.distanceTo(before) > .5, 'the guard actually evades the immediate danger');
    assert.equal(f.observer.lastSeen, -99, 'grenade recognition does not invent sight of its thrower');
  }
  assert.equal(f.observer.casualtyReaction, null); f.dispose();
}
console.log('ok    active casualty investigation yields to actual gunfire, player vision and nearby grenade danger');

{
  const f = scenario(); f.kill(); advance(f.G, f.enemies, .15);
  assert.ok(f.observer.casualtyReaction);
  const grenade = { kind: 'player', pos: new THREE.Vector3(0, .05, 3), fuse: 3, rest: true };
  f.G.explosives.list.push(grenade); f.observer.dangerTimer = 0;
  advance(f.G, f.enemies, .9);
  assert.equal(f.observer.casualtyReaction, null, 'known grenade danger cancels an unfinished casualty reaction');
  assert.equal(f.observer.danger?.grenade, grenade); assert.ok(f.observer.pos.length() > .5);
  assert.equal(f.observer.lastSeen, -99); assert.equal(f.observer.contact, null); f.dispose();
}
{
  const f = aiFixture({ soldierModel: rig, player: [0, -120], boxes: [{ x: 4, y: 2, z: 5, hx: 1, hy: 2, hz: 1 }], definitions: [soldier(0, 10, { hold: true }), soldier(0, 0), soldier(8, 0)] });
  f.G.daylight = true; f.G.player.visible = 0;
  for (const e of f.enemies.list) e.perceiveTimer = 1e6;
  advance(f.G, f.enemies, .3); f.enemies.list[0].damage(1000, f.G.player.pos, 'body', true);
  advance(f.G, f.enemies, 2);
  assert.equal(f.enemies.list[1].srch?.reason, 'casualty');
  assert.equal(f.enemies.list[2].state, 'idle', 'a same-squad guard behind solid cover cannot inherit a fictional visual casualty report');
  assert.equal(f.enemies.list[2].lastKnown, null); assert.equal(f.enemies.intel.size, 0);
  for (const e of f.enemies.list) e.char.dispose();
}
console.log('ok    grenade danger cancels pending recognition and occluded squadmates gain no casualty telepathy');

for (const pending of [false, true]) {
  const f = scenario(); f.kill(); if (pending) advance(f.G, f.enemies, .15);
  f.enemies.resetLiving(); advance(f.G, f.enemies, 2);
  assert.equal(f.observer.state, 'idle'); assert.equal(f.observer.lastKnown, null); assert.equal(f.observer.casualtyReaction, null);
  f.dispose();
}
{
  const f = scenario(); f.kill(); advance(f.G, f.enemies, .15);
  assert.ok(f.observer.casualtyReaction); f.observer.damage(1000, f.G.player.pos, 'body', true);
  advance(f.G, f.enemies, 2); assert.equal(f.observer.casualtyReaction, null); assert.equal(f.observer.state, 'dead'); f.dispose();
}
for (const pending of [false, true]) {
  const f = scenario(); f.kill(); if (pending) advance(f.G, f.enemies, .15);
  f.G.time += 3; f.enemies.update(1 / 30);
  assert.equal(f.observer.state, 'idle'); assert.equal(f.observer.lastKnown, null); assert.equal(f.observer.casualtyReaction, null); f.dispose();
}
{
  const f = scenario(); f.kill(); advance(f.G, f.enemies, .15);
  const at = f.G.time; await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(f.G.time, at); assert.equal(f.observer.state, 'idle', 'wall time during pause cannot complete the reaction');
  advance(f.G, f.enemies, 1.2); assert.equal(f.observer.srch?.reason, 'casualty'); f.dispose();
}
console.log('ok    retry, observer death and expired work cancel cleanly; pause freezes the human reaction');

for (const occluded of [false, true]) {
  const definitions = [];
  for (let group = 0; group < 5; group++) definitions.push(soldier((group - 2) * 20, 10, { hold: true }));
  for (let group = 0; group < 5; group++) for (let i = 0; i < 8; i++) definitions.push(soldier((group - 2) * 20 + i - 3.5, 0, { hold: true }));
  const f = aiFixture({ player: [0, -120], definitions, boxes: occluded ? [{ x: 0, y: 2, z: 5, hx: 60, hy: 2, hz: .2 }] : [] }); f.G.daylight = true; f.G.player.visible = 0;
  for (const e of f.enemies.list) e.perceiveTimer = 1e6;
  let rays = 0; const clear = f.G.world.clear;
  f.G.world.clear = (...args) => { if (args[6] === SIGHT) rays++; return clear(...args); };
  advance(f.G, f.enemies, 1); assert.equal(rays, 0);
  for (const e of f.enemies.list.slice(0, 5)) e.damage(1000, f.G.player.pos, 'body', true);
  assert.equal(rays, 0, 'casualty birth creates no sight traces');
  let maximumPerFrame = 0;
  for (let i = 0; i < 90; i++) {
    const before = rays; f.G.time += 1 / 30; f.enemies.update(1 / 30);
    maximumPerFrame = Math.max(maximumPerFrame, rays - before);
  }
  assert.equal(maximumPerFrame, occluded ? 4 : 2, 'a full queue exercises the per-frame visibility budget');
  assert.equal(rays, occluded ? 64 : 32, 'forty independently eligible witnesses cannot overflow the bounded thirty-two-pair queue');
  const done = rays; advance(f.G, f.enemies, 2); assert.equal(rays, done, 'expired recent-casualty work leaves zero steady idle traces');
  assert.ok(f.enemies.list.every(e => !e.casualtyReaction), 'all pending actor work has resolved or expired');
  for (const e of f.enemies.list) e.char.dispose();
}
console.log('ok    casualty births, queued pairs, per-frame rays and recent-work lifetime stay bounded');
