// Run with: node fun/hedgerow/tests/ai-tactics-check.mjs
// Real enemy updates on a small collision world: firing discipline, bounded
// squad movement, grenade survival, reload timing and information limits.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createWorld } = await import('../js/world.js');
const { createEnemies, buildCoverPoints } = await import('../js/ai.js');
const { friendlyInFireLane } = await import('../js/ai-tactics.js');

const noop = new Proxy({}, { get: () => () => {} });
const D = (x, z, extra = {}) => ({ type: 'rifle', at: [x, z], yaw: 0, group: 'squad', leash: 18, ...extra });
function game({ player = [0, 30], boxes = [] } = {}) {
  const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  const world = createWorld({ minX: -80, maxX: 80, minZ: -80, maxZ: 140, terrain });
  for (const box of boxes) world.add({ type: 'box', yaw: 0, ...box });
  const handlers = {}, shots = [], hits = [], thrown = [], impacts = [];
  const G = {
    world, terrain, cover: buildCoverPoints(world, terrain), time: 0, lightning: 0,
    scene: new THREE.Scene(), soldier: null, models: new Map(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: m => m },
    camera: new THREE.PerspectiveCamera(70, 1.6, 0.1, 1000),
    player: { pos: new THREE.Vector3(player[0], 0, player[1]), vel: new THREE.Vector3(), alive: true, visible: 1, movingSpeed: 0, damage: (...args) => hits.push(args) },
    events: { on: (k, f) => (handlers[k] ||= []).push(f), emit: (k, a) => (handlers[k] || []).forEach(f => f(a)) },
    effects: new Proxy({ impact: (...args) => impacts.push(args) }, { get: (o, k) => o[k] || (() => {}) }), lights: noop, audio: new Proxy({ gunshot: (...args) => shots.push(args) }, { get: (o, k) => o[k] || (() => {}) }),
    rig: { yaw: 0, addShake() {} }, hud: { awareness() {} },
    shared: { wet: { value: 1 }, time: { value: 0 }, rain: { value: 1 } },
    explosives: { list: [], throwGrenade: (...args) => thrown.push(args) },
    diff: { aware: 1, accuracy: 100, damage: 1 }, stats: { kills: 0, headshots: 0 },
  };
  G.camera.position.set(player[0], 2, player[1]);
  return { G, shots, hits, thrown, impacts };
}
function create(G, defs) {
  const en = createEnemies(G, defs);
  // Geometry-independent muzzle/hand positions keep the stand-in rig from
  // making the tactical tests depend on the fallback model's silhouette.
  for (const e of en.list) {
    e.char.muzzleWorld = out => out.set(e.pos.x, e.pos.y + 1.35, e.pos.z + 0.5);
    e.char.boneWorld = (_name, out) => out.set(e.pos.x, e.pos.y + 1.4, e.pos.z);
  }
  return en;
}
function run(G, en, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) { G.time += 1 / 60; en.update(1 / 60); }
}
function combat(e, G, phase = 'open') {
  Object.assign(e, { state: 'combat', phase, phaseTimer: 100, awareness: 1, sees: true, exposure: 1, lastSeen: G.time, lastKnown: { x: G.player.pos.x, y: 0, z: G.player.pos.z }, perceiveTimer: 1e6, tacticTimer: 100, aimTimer: 0, fireTimer: 0 });
}

// The corridor respects stance, height, range and bodies already dead.
{
  const shooter = { pos: { x: 0, y: 0, z: 0 } };
  const ally = { pos: { x: 0, y: 0, z: 5 }, stance: 'stand', dead: false };
  const muzzle = { x: 0, y: 1.6, z: 0 }, target = { x: 0, y: 1.6, z: 20 };
  assert.equal(friendlyInFireLane(shooter, muzzle, target, [shooter, ally]), ally);
  ally.stance = 'crouch';
  assert.equal(friendlyInFireLane(shooter, muzzle, target, [ally]), null, 'a shot over a crouched comrade is clear');
  ally.stance = 'stand'; ally.pos.x = 1;
  assert.equal(friendlyInFireLane(shooter, muzzle, target, [ally]), null);
  ally.pos.x = 0; ally.dead = true;
  assert.equal(friendlyInFireLane(shooter, muzzle, target, [ally]), null);
}
{
  const { G, shots } = game();
  const en = create(G, [D(0, 0, { leash: 0 }), D(0, 8, { hold: true })]);
  const [e, ally] = en.list;
  combat(e, G); ally.perceiveTimer = 1e6;
  run(G, en, 0.8);
  assert.equal(shots.length, 0, 'the rear man holds fire through a comrade');
  assert.equal(e.mag, e.wdef.mag, 'holding fire does not spend ammunition');
  assert.ok(e.fireLaneBlocked);
  ally.pos.x = 5; ally.home.x = 5;
  run(G, en, 1);
  assert.ok(shots.length > 0, 'he resumes firing when his comrade clears the lane');
}
console.log('ok    soldiers hold fire through living comrades and resume when the lane clears');

{
  const { G, shots, hits, impacts } = game({ boxes: [{ x: 0, y: 1.5, z: 10, hx: 3, hy: 1.5, hz: .3 }] });
  const en = create(G, [D(0, 0, { leash: 0 })]);
  combat(en.list[0], G);
  en.list[0].target = { x: 0, z: 0 };
  run(G, en, 3);
  assert.ok(shots.length > 0);
  assert.equal(hits.length, 0, 'stale sight cannot produce a hit through newly blocking cover');
  assert.ok(impacts.length > 0 && impacts.every(p => Math.abs(p[2] - 9.7) < .01), 'the actual projectiles strike the near face of the stone wall');
}
console.log('ok    every damaging shot rechecks the actual muzzle-to-target line');

for (const anchored of [false, true]) {
  const { G } = game({ player: [0, 100] });
  G.player.visible = 0;
  const en = create(G, [D(0, 0, { hold: anchored })]);
  const e = en.list[0];
  const grenade = { kind: 'player', pos: new THREE.Vector3(1, 0.05, 0), vel: new THREE.Vector3(), fuse: 3, rest: true };
  G.explosives.list.push(grenade);
  run(G, en, 0.2);
  assert.ok(e.danger, 'a nearby visible grenade is noticed');
  assert.ok(e.pos.length() < 0.01, 'noticing a grenade does not cause an instantaneous move');
  run(G, en, 2.2);
  if (anchored) {
    assert.ok(e.pos.length() < 0.01, 'a dug-in man keeps his assigned position');
    assert.equal(e.stance, 'crouch', 'and gets his head down');
  } else assert.ok(e.pos.distanceTo(grenade.pos) > 7, `a mobile soldier runs outside the blast (at ${e.pos.toArray()})`);
  G.explosives.list.length = 0;
  run(G, en, 1);
  assert.equal(e.danger, null, 'survival behavior ends after the danger passes');
}
{
  const { G } = game({ player: [0, 100], boxes: [{ x: 1.5, y: 1, z: 0, hx: 0.2, hy: 1, hz: 3 }] });
  G.player.visible = 0;
  const en = create(G, [D(0, 0)]);
  G.explosives.list.push({ kind: 'player', pos: new THREE.Vector3(3, 0.05, 0), fuse: 3 });
  run(G, en, 1);
  assert.equal(en.list[0].danger, null, 'a grenade behind solid cover is not magically seen');
}
console.log('ok    grenade reactions have a delay, respect cover and expire; mobile men flee, dug-in men duck');

for (const support of [true, false]) {
  const { G } = game({ boxes: [{ x: -8, y: 0.6, z: 15, hx: 3, hy: 0.6, hz: 0.3 }] });
  const en = create(G, [D(0, 0), D(2, 0), D(5, 0, { hold: true })]);
  const [e, other, watcher] = en.list;
  combat(e, G, 'hide'); combat(other, G, 'hide'); combat(watcher, G, 'peek');
  watcher.phaseTimer = 0.1;
  e.tacticTimer = other.tacticTimer = 0;
  if (!support) watcher.reloadT = 3;
  run(G, en, 1 / 60);
  assert.equal(e.tacticalRole === 'flank', support, 'bounding requires a stationary teammate with eyes on the threat and ammunition');
  assert.equal(other.tacticalRole, null, 'a squad sends only one man on a bounding move');
  if (support) {
    assert.ok(e.cover && e.cover.taken === e);
    assert.equal(watcher.covering, e, 'the watching man receives the covering order');
    const c = e.cover;
    run(G, en, 0.5);
    assert.equal(watcher.phase, 'peek', 'the covering man keeps watching while his teammate moves');
    run(G, en, 6);
    assert.ok(Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < 1.2, 'the flank uses the real walk grid and reaches its cover');
  }
}
console.log('ok    one soldier flanks to reachable cover while an armed teammate watches; no support means no rush');

{
  const { G, shots } = game({ boxes: [{ x: 0, y: 1.5, z: 15, hx: 3, hy: 1.5, hz: 0.3 }] });
  const en = create(G, [D(-2.7, 14.1)]);
  const e = en.list[0];
  const c = G.cover.find(c => Math.abs(c.x + 2.7) < 0.01 && Math.abs(c.z - 14.1) < 0.01);
  assert.ok(c && !c.low);
  combat(e, G, 'hide'); e.sees = false; e.cover = c; c.taken = e; e.phaseTimer = 0;
  run(G, en, 0.3);
  assert.ok(e.peekSpot, 'tall cover finds an actual clear corner position');
  assert.equal(shots.length, 0, 'the soldier does not fire while stepping into position');
  run(G, en, 0.8);
  assert.ok(Math.hypot(e.pos.x - e.peekSpot.x, e.pos.z - e.peekSpot.z) < 0.2, `he physically steps past the corner: ${JSON.stringify({pos:e.pos.toArray(),peek:e.peekSpot,phase:e.phase,time:e.phaseTimer})}`);
  assert.ok(shots.length > 0, 'and fires from the exposed position');
  e.phase = 'hide'; e.phaseTimer = 2;
  run(G, en, 1);
  assert.ok(Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < 0.3, 'he steps back behind the wall to hide');
}
console.log('ok    tall cover uses real step-out firing and step-back shelter');

{
  const { G } = game({ player: [0, 100] });
  G.player.visible = 0;
  const en = create(G, [D(0, 0, { hold: true })]);
  const e = en.list[0];
  combat(e, G, 'hide'); e.sees = false; e.lastSeen = -3; e.mag = 1; e.phaseTimer = 0;
  run(G, en, 0.1);
  assert.ok(e.reloadT > 0 && e.phase === 'hide', 'a nearly empty magazine is topped off during a protected lull');
  run(G, en, 1);
  assert.equal(e.phase, 'hide', 'he does not stand up while reloading');
}
{
  const { G, thrown } = game({ player: [0, 100] });
  G.player.visible = 0;
  const en = create(G, [D(0, 0)]);
  const e = en.list[0];
  e.pendingThrow = { x: 12, z: 0, delay: 0.42 };
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(thrown.length, 0, 'wall time cannot release a grenade while the simulation is paused');
  run(G, en, 0.5);
  assert.equal(thrown.length, 1, 'the throw releases on the animation beat in simulation time');
  e.pendingThrow = { x: 12, z: 0, delay: 0.42 };
  en.resetLiving(); run(G, en, 0.5);
  assert.equal(thrown.length, 1, 'checkpoint reset cancels a queued throw');
  e.pendingThrow = { x: 12, z: 0, delay: 0.42 };
  e.damage(1000, { x: 0, y: 0, z: 10 }, 'body', true);
  assert.equal(e.pendingThrow, null, 'death cancels a throw and cannot block the squad\'s future grenades');
}
console.log('ok    reloads stay protected; grenade release follows simulation time and checkpoint resets');

{
  const { G } = game({ player: [0, 100] });
  G.player.visible = 0;
  const en = create(G, [D(0, 0), D(0, 70)]);
  const [near, far] = en.list;
  near.perceiveTimer = far.perceiveTimer = 1e6;
  near.damage(1, { x: -10, y: 4, z: 0 }, 'body', true);
  assert.deepEqual(near.lastKnown, { x: -10, y: 4, z: 0 }, 'a hit remembers its origin, not the hidden player position');
  run(G, en, 2);
  assert.equal(far.state, 'idle', 'a remote post does not receive a shouted contact across the map');
}
console.log('ok    hits retain their source and distant sentries do not share contact telepathically');
// Preserve the independent exposure and throw/ambush cases added on main.
{
  const { G, hits } = game({ boxes: [{ x: 0, y: .72, z: 28, hx: 4, hy: .72, hz: .5 }] });
  const en = create(G, [D(0, 0, { leash: 0 })]), e = en.list[0];
  combat(e, G); e.exposure = .45; e.target = { x: 0, z: 0 };
  run(G, en, 1 / 60);
  assert.equal(hits.length, 1, 'a head visible above low cover remains hittable');
  e.exposure = 1; e.fireTimer = 0;
  run(G, en, 1 / 60);
  assert.equal(hits.length, 2, 'stale body exposure rechecks a genuinely visible head');
  const lean = game({ boxes: [{ x: 0, y: 2, z: 28, hx: .3, hy: 2, hz: .4 }] });
  const leaning = create(lean.G, [D(0, 0, { leash: 0 })]), le = leaning.list[0];
  combat(le, lean.G); le.exposure = .45; le.target = { x: 0, z: 0 }; lean.G.player.leanX = .7;
  run(lean.G, leaning, 1 / 60);
  assert.equal(lean.hits.length, 1, 'a leaning head is targeted at its visible position beside a wall');
}
console.log('ok    head-only and leaning targets remain hittable after cover changes between sight samples');

{
  const { G, shots } = game(), en = create(G, [D(0, 0, { leash: 0 })]), e = en.list[0];
  combat(e, G); e.target = { x: 0, z: 0 }; e.pendingThrow = { x: 0, z: 18, delay: .42 };
  const ammunition = e.mag;
  run(G, en, .2);
  assert.equal(shots.length, 0, 'preparing a grenade leaves no hand available to shoot');
  assert.equal(e.mag, ammunition, 'an unfinished throw cannot spend rifle ammunition');
}

{
  const { G } = game({ player: [0, 100] }); G.player.visible = 0;
  const en = create(G, [D(0, 0)]), e = en.list[0];
  const cover = { x: 0, y: 0, z: 0, low: true, taken: e };
  e.state = 'ambush'; e.cover = cover; e.amb = { x: 0, z: 20, phase: 'wait', timer: 30, peek: 10 };
  G.explosives.list.push({ kind: 'player', pos: new THREE.Vector3(0, .1, 3), fuse: 3.4 });
  run(G, en, 1);
  assert.ok(e.danger, 'the ambusher reacts to a visible grenade');
  assert.equal(e.amb, null, 'evasion ends the stale ambush order');
  assert.equal(e.cover, null, 'evasion releases abandoned ambush cover');
  assert.equal(cover.taken, null, 'another soldier can use the abandoned cover');
  G.explosives.list.length = 0;
  run(G, en, 1);
  assert.equal(e.state, 'search', 'after danger, the former ambusher resumes a safe search');
}

{
  const { G, thrown } = game({ player: [0, 100] }); G.player.visible = 0;
  const en = create(G, [D(0, 0, { hold: true })]), e = en.list[0], inventory = e.grenades;
  e.pendingThrow = { x: 0, z: 18, delay: .8 };
  G.explosives.list.push({ kind: 'player', pos: new THREE.Vector3(0, .1, 3), fuse: 3.4 });
  run(G, en, .7);
  assert.equal(e.pendingThrow, null, 'a fixed defender cancels his throw as he ducks from danger');
  assert.equal(e.grenades, inventory, 'a cancelled throw retains its unspent grenade');
  G.explosives.list.length = 0;
  run(G, en, 1);
  assert.equal(thrown.length, 0, 'the cancelled throw cannot release after the threat passes');
}
console.log('ok    grenades interrupt ambushes safely and cancel unfinished throws, including fixed posts');

{
  const { G, thrown } = game({ player: [0, 100] }); G.player.visible = 0;
  const en = create(G, [D(0, 0)]), e = en.list[0], inventory = e.grenades;
  e.pendingThrow = { x: 0, z: 18, delay: .42 };
  run(G, en, .2);
  assert.equal(e.grenades, inventory, 'the grenade stays in inventory until release');
  run(G, en, .3);
  assert.equal(thrown.length, 1, 'an unobstructed queued grenade actually releases');
  assert.equal(e.grenades, inventory - 1, 'release spends exactly one grenade');
  const [, start, velocity] = thrown[0], flight = 18 / velocity.z;
  assert.ok(Math.abs(start.y + velocity.y * flight - 4.9 * flight ** 2) < .01, 'the actual launch lands at the intended ground height');
  const buddy = game({ player: [0, 100] }), friends = create(buddy.G, [D(0, 0), D(0, 18, { hold: true })]);
  friends.list[0].pendingThrow = { x: 0, z: 18, delay: .01 };
  run(buddy.G, friends, 1 / 60);
  assert.equal(buddy.thrown.length, 0, 'a comrade in the blast area cancels the throw');
  assert.equal(friends.list[0].grenades, 1, 'withholding a grenade from comrades does not spend it');
  const blocked = game({ player: [0, 100], boxes: [{ x: 0, y: 5, z: 8, hx: 4, hy: 5, hz: .5 }] });
  const wall = create(blocked.G, [D(0, 0)]);
  wall.list[0].pendingThrow = { x: 0, z: 18, delay: .01 };
  run(blocked.G, wall, 1 / 60);
  assert.equal(blocked.thrown.length, 0, 'a wall crossing the actual ballistic arc cancels release');
  assert.equal(wall.list[0].grenades, 1, 'an obstructed arc does not spend inventory');
}
console.log('ok    grenade inventory is spent on release, with ballistic landing, comrade and obstruction checks');
console.log('ai-tactics-check: firing lanes, cover-safe damage, grenade survival, squad bounds, reloads and fair memory');
