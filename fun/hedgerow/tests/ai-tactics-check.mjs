// Deterministic tactical scenarios on the actual collision world and nav grid.
// Run: node fun/hedgerow/tests/ai-tactics-check.mjs
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createEnemies, buildCoverPoints } = await import('../js/ai.js');
const { createWorld } = await import('../js/world.js');
const { createNav } = await import('../js/nav.js');

const noop = new Proxy({}, { get: () => () => {} });
const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 70 };
function scenario(defs = [{ at: [0, 0], group: 'squad', leash: 30 }], obstacles = []) {
  const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  const world = createWorld({ ...bounds, terrain });
  obstacles.forEach(o => world.add({ type: 'box', kind: 'solid', ...o }));
  const handlers = {};
  const shots = [], throws = [], damage = [];
  const G = {
    time: 0, lightning: 0, world, terrain, level: { playBounds: bounds },
    nav: createNav(world, bounds), cover: buildCoverPoints(world, terrain),
    scene: new THREE.Scene(), soldier: null, models: new Map(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: m => m },
    camera: new THREE.PerspectiveCamera(70, 1.6, 0.1, 200),
    player: { pos: new THREE.Vector3(0, 0, 30), vel: new THREE.Vector3(), alive: true,
      crouch: false, visible: 0, movingSpeed: 0, damage: (...args) => damage.push(args) },
    events: { on: (k, f) => (handlers[k] ||= []).push(f), emit: (k, d) => (handlers[k] || []).forEach(f => f(d)) },
    diff: { aware: 1, accuracy: 100, damage: 1 },
    effects: noop, lights: noop, audio: new Proxy({ gunshot: (...args) => shots.push(args) }, { get: (o, k) => o[k] || (() => {}) }),
    decals: null, debris: null, shared: { wet: { value: 0 } },
    explosives: { list: [], throwGrenade: (...args) => throws.push(args) },
    rig: { yaw: 0, addShake() {} }, hud: { awareness() {} }, stats: { kills: 0, headshots: 0 },
  };
  const en = createEnemies(G, defs);
  for (const e of en.list) {
    e.char.muzzleWorld = out => out.set(e.pos.x, e.pos.y + 1.4, e.pos.z);
    e.char.boneWorld = (_, out) => out.set(e.pos.x, e.pos.y + 1.4, e.pos.z);
  }
  const step = (seconds = 1 / 30) => { G.time += seconds; en.update(seconds); };
  const run = seconds => { for (let t = 0; t < seconds; t += 1 / 30) step(); };
  return { G, en, step, run, shots, throws, damage };
}
function ready(e, G) {
  Object.assign(e, { state: 'combat', phase: 'peek', phaseTimer: 20, aimTimer: 0, fireTimer: 0,
    sees: true, exposure: 1, perceiveTimer: 999, tacticTimer: 999, lastSeen: G.time,
    lastKnown: { x: G.player.pos.x, y: G.player.pos.y, z: G.player.pos.z } });
}

{
  const s = scenario([{ at: [0, 0], group: 'a' }, { at: [0, 10], group: 'b' }]);
  const e = s.en.list[0], buddy = s.en.list[1];
  ready(e, s.G);
  const ammunition = e.mag;
  s.step();
  assert.equal(s.shots.length, 0, 'hold fire when a soldier from another squad crosses the sights');
  assert.equal(e.mag, ammunition, 'holding fire does not spend a round');
  buddy.pos.x = 5;
  e.fireTimer = 0;
  s.step();
  assert.equal(s.shots.length, 1, 'resume fire once the crossing soldier clears the lane');
  assert.equal(s.damage.length, 1, 'the clear shot can hit');
  console.log('ok    fire discipline: hold for crossing comrades, then resume without losing ammunition');
}

{
  const s = scenario();
  const e = s.en.list[0];
  ready(e, s.G);
  s.G.world.add({ type: 'box', x: 0, y: 2, z: 15, hx: 4, hy: 2, hz: 0.5 });
  s.step();
  assert.equal(s.damage.length, 0, 'a new obstruction stops a shot even while cached sight says visible');
  assert.equal(s.shots.length, 1, 'a stale sighting may fire but the bullet hits the intervening world');
  console.log('ok    cached perception cannot shoot a player through a new obstruction');
}

{
  const s = scenario(undefined, [{ x: 0, y: 0.72, z: 28, hx: 4, hy: 0.72, hz: 0.5 }]);
  const e = s.en.list[0]; ready(e, s.G); e.exposure = 0.45;
  s.step();
  assert.equal(s.damage.length, 1, 'a head visible above cover remains hittable');
  e.exposure = 1; e.fireTimer = 0;
  s.step();
  assert.equal(s.damage.length, 2, 'a fresh head check recovers from stale full-body exposure');
  const lean = scenario(undefined, [{ x: 0, y: 2, z: 28, hx: 0.3, hy: 2, hz: 0.4 }]);
  const le = lean.en.list[0]; ready(le, lean.G); le.exposure = 0.45;
  lean.G.player.leanX = 0.7;
  lean.step();
  assert.equal(lean.damage.length, 1, 'a head leaning past a wall is targeted at its visible position');
  console.log('ok    head-only and leaning exposure remain hittable above or beside cover');
}

{
  const s = scenario();
  s.G.player.pos.set(40, 0, 40);
  const e = s.en.list[0], grenade = { kind: 'player', pos: new THREE.Vector3(0, 0.1, 3), fuse: 3.4 };
  s.G.explosives.list.push(grenade);
  s.run(0.2);
  assert.equal(e.evasion, null, 'a visible grenade does not cause an instant reaction');
  s.run(2.5);
  assert.ok(e.pos.distanceTo(grenade.pos) > 9.5, `the soldier gets clear of the visible grenade (${e.pos.toArray()}, ${JSON.stringify(e.evasion)})`);
  assert.ok(s.G.nav.walkable(e.pos.x, e.pos.z), 'the escape stays on the walk grid');
  s.run(1);
  assert.ok(e.pos.distanceTo(grenade.pos) > 9.5, 'he waits clear instead of returning to his post before the blast');
  s.G.explosives.list.length = 0;
  s.step();
  assert.equal(e.evasion, null, 'the escape order ends when the threat disappears');
  console.log('ok    visible grenades trigger a delayed, walkable escape beyond the blast radius');
}

{
  const s = scenario(undefined, [{ x: 0, y: 1.5, z: 2, hx: 4, hy: 1.5, hz: 0.4 }]);
  s.G.player.pos.set(40, 0, 40);
  s.G.explosives.list.push({ kind: 'player', pos: new THREE.Vector3(0, 0.1, 4), fuse: 3.4 });
  s.run(1.2);
  assert.equal(s.en.list[0].evasion, null, 'a grenade behind an opaque wall is not magically spotted');
  console.log('ok    soldiers do not see grenades through walls');
}

{
  const s = scenario();
  s.G.player.pos.set(40, 0, 40);
  const e = s.en.list[0];
  e.state = 'ambush';
  e.cover = { x: 0, y: 0, z: 0, low: true, taken: e };
  e.amb = { x: 0, z: 20, phase: 'wait', timer: 30, peek: 10 };
  s.G.explosives.list.push({ kind: 'player', pos: new THREE.Vector3(0, 0.1, 3), fuse: 3.4 });
  s.run(1);
  assert.ok(e.evasion, 'the ambusher also leaves cover for a nearby grenade');
  assert.equal(e.cover, null, 'abandoned ambush cover is released');
  s.G.explosives.list.length = 0;
  s.step();
  assert.equal(e.state, 'search', 'the interrupted ambush resumes as a search, without stale cover');
  console.log('ok    grenade evasion safely interrupts and releases an ambush');
}

{
  const s = scenario([{ at: [0, 0], hold: true }]);
  const e = s.en.list[0], grenade = { kind: 'player', pos: new THREE.Vector3(0, 0.1, 3), fuse: 3.4 };
  s.G.explosives.list.push(grenade);
  e.grenadeNotice = { grenade, at: 0 };
  e.pendingThrow = { x: 0, z: 18, delay: 0.2 };
  s.step();
  assert.equal(e.pendingThrow, null, 'a fixed defender cancels his own throw when ducking from a grenade');
  s.G.explosives.list.length = 0;
  s.run(1);
  assert.equal(s.throws.length, 0, 'the cancelled throw cannot release late after the threat disappears');
  console.log('ok    fixed defenders cancel unfinished throws when reacting to grenades');
}

{
  const s = scenario([{ at: [0, 0], group: 's', leash: 30 }, { at: [-4, 0], group: 's', leash: 30 },
    { at: [2, 0], group: 's', leash: 30 }], [{ x: 10, y: 0.6, z: 7, hx: 3, hy: 0.6, hz: 0.5 }]);
  for (const e of s.en.list) { ready(e, s.G); e.tacticTimer = 0; e.phase = 'hide'; e.phaseTimer = 20; }
  s.en.list[1].phase = 'peek'; s.en.list[1].tacticTimer = 999;
  s.en.intel.set('s', { x: 0, y: 0, z: 30, vx: 0, vz: 0, t: 0 });
  s.step();
  const flankers = s.en.list.filter(e => e.flankUntil > s.G.time && e.phase === 'move');
  assert.equal(flankers.length, 1, 'one soldier moves while the others support');
  assert.ok(Math.abs(flankers[0].cover.x - flankers[0].pos.x) >= 5, 'the new cover creates a lateral angle');
  assert.equal(flankers[0].cover.taken, flankers[0], 'the flank destination is reserved');
  assert.ok(flankers[0].path?.length, 'a walkable route is planned before committing');
  console.log('ok    one supported soldier reserves reachable flank cover while squadmates hold');
}

{
  const s = scenario([{ at: [0, 0], group: 's', leash: 30 }], [{ x: 10, y: 0.6, z: 7, hx: 3, hy: 0.6, hz: 0.5 }]);
  const e = s.en.list[0]; ready(e, s.G); e.tacticTimer = 0;
  s.en.intel.set('s', { x: 0, y: 0, z: 30, vx: 0, vz: 0, t: 0 });
  s.step();
  assert.equal(e.flankUntil, -1, 'a lone soldier does not make an unsupported flanking run');
  console.log('ok    no unsupported flanks');
}

{
  const s = scenario();
  const e = s.en.list[0];
  e.pendingThrow = { x: 0, z: 18, delay: 0.42 };
  s.run(0.2);
  assert.equal(s.throws.length, 0, 'throw waits for its animation delay on the simulation clock');
  s.run(0.3);
  assert.equal(s.throws.length, 1, 'the unobstructed throw releases after its simulation delay');
  const [owner, start, velocity] = s.throws[0];
  assert.equal(owner, 'enemy');
  const flight = 18 / velocity.z;
  assert.ok(Math.abs(start.y + velocity.y * flight - 4.9 * flight ** 2) < 0.01, 'ballistic arc lands at the intended ground height');
  e.pendingThrow = { x: 0, z: 18, delay: 0.42 };
  s.en.resetLiving();
  s.run(0.5);
  assert.equal(s.throws.length, 1, 'respawning cancels an unfinished throw');
  console.log('ok    grenade throws follow simulation time, land ballistically, and cancel on reset');
}

{
  const s = scenario([{ at: [0, 0] }, { at: [0, 18] }]);
  s.en.list[0].pendingThrow = { x: 0, z: 18, delay: 0.01 };
  s.step();
  assert.equal(s.throws.length, 0, 'a comrade entering the blast area cancels the throw');
  const blocked = scenario(undefined, [{ x: 0, y: 5, z: 8, hx: 4, hy: 5, hz: 0.5 }]);
  blocked.en.list[0].pendingThrow = { x: 0, z: 18, delay: 0.01 };
  blocked.step();
  assert.equal(blocked.throws.length, 0, 'a wall across the ballistic arc cancels the throw');
  console.log('ok    grenades are withheld from comrades and obstructed arcs');
}

{
  const s = scenario();
  const e = s.en.list[0]; ready(e, s.G); e.sees = false;
  e.lastKnown = { x: 0, y: 0, z: 30 };
  s.en.intel.set('squad', { x: 7, y: 2, z: 29, t: 0.01, vx: 0, vz: 0 });
  s.G.player.pos.set(40, 20, 40);
  s.step();
  assert.deepEqual(e.lastKnown, { x: 7, y: 2, z: 29 }, 'unseen movement uses the last squad report, including its elevation');
  console.log('ok    unseen targets use reported positions rather than live player coordinates');
}

console.log('ai-tactics-check: fire discipline, bounded flanks, grenade awareness and throw safety passed');
