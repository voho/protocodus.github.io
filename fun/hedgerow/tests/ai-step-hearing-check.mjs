// Real running-step producer, material paths, true source/ear height, fair budgets and casualty priority.
import assert from 'node:assert/strict';
import { aiFixture, soldier, advance } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { createTerrain } = await import('../js/terrain.js');
const { createWorld, SHOT } = await import('../js/world.js');
const { createPlayer } = await import('../js/player.js');
const { createCameraRig } = await import('../js/camera.js');
const { DEFAULT_SETTINGS } = await import('../js/config.js');
const { acousticProfile } = await import('../js/audio-space.js');
const rig = await parseUntexturedGLB('soldier');
const services = new Proxy({}, { get: () => () => {} });
const records = [], bounds = { minX: -16, maxX: 16, minZ: -8, maxZ: 24 };
const oldScheduler = globalThis.scheduler; globalThis.scheduler = { yield: async () => {} };
try {
  for (const [barrier, distance] of [['open', 9], ['stone', 9], ['wood', 9], ['earth', 9], ['wood', 7], ['stone', 4], ['foliage', 9], ['lowStone', 9]]) for (const pace of ['run', 'walk', 'crouch']) {
    const terrain = await createTerrain({ bounds, height: (_x, z) => barrier === 'earth' ? Math.max(0, 3 * (1 - Math.abs(z - distance / 2) / 1.5)) : 0, splat: () => [0, 1, 0, 0] }, {}, {});
    const world = createWorld({ ...bounds, terrain });
    if (barrier !== 'open' && barrier !== 'earth') world.add({ type: 'box', x: 0, y: barrier === 'lowStone' ? .5 : 1.5, z: distance / 2, hx: 15, hy: barrier === 'lowStone' ? .5 : 1.5, hz: barrier === 'wood' ? .04 : .4, surface: barrier === 'lowStone' ? 'stone' : barrier });
    const f = aiFixture({ world, terrain, soldierModel: rig, player: [-1, distance], definitions: [soldier(0, 0, { yaw: 180, hold: true })] });
    const { G, enemies } = f, e = enemies.list[0];
    G.level = { playBounds: bounds }; G.enemies = enemies.list; G.hud = services; G.effects = services; G.lights = services; G.audio = services; G.debris = services;
    G.rig = createCameraRig(G.camera, world); Object.assign(G.stats, { shots: 0, hits: 0, headHits: 0, damageTaken: 0 });
    const player = createPlayer(G); G.player = player; player.reset([-1, distance, Math.PI / 2]); player.crouch = pace === 'crouch'; e.perceiveTimer = 1e6;
    const noises = []; let eventProbes = 0, insideNoise = false;
    const raycast = world.raycast;
    world.raycast = (...args) => { if (insideNoise) eventProbes++; return raycast(...args); };
    const emit = G.events.emit;
    G.events.emit = (kind, event) => { insideNoise = kind === 'noise'; try { emit(kind, event); } finally { insideNoise = false; } };
    G.events.on('noise', event => noises.push({ event: { ...event }, actualFeet: player.pos.toArray(), time: G.time }));
    const input = { mouseL: false, mouseR: false, held: key => key === 'KeyW' || pace === 'run' && key === 'Shift', pressed: () => false, fired: () => false, consumeMouse: () => [0, 0], consumeWheel: () => 0 };
    for (let i = 0; i < 90; i++) { G.time += 1 / 60; player.update(1 / 60, input, DEFAULT_SETTINGS); enemies.update(1 / 60); }
    const source = noises[0]?.actualFeet, eye = e.char.boneWorld('head', new THREE.Vector3());
    let blocker = null, transmission = null;
    if (source) {
      const direction = new THREE.Vector3(source[0], source[1] + .05, source[2]).sub(eye), distance = direction.length(); direction.divideScalar(distance);
      const hit = world.raycast(...eye.toArray(), ...direction.toArray(), distance - .25, SHOT, { noWater: true });
      blocker = hit && { collider: hit.collider === 'terrain' ? 'terrain' : 'box', surface: hit.surface, point: [hit.x, hit.y, hit.z] };
      transmission = acousticProfile(hit).gain;
    }
    const record = { barrier, distance, pace, steps: player.steps, noises, eventProbes, eye: eye.toArray(), blocker, transmission, guard: { state: e.state, awareness: e.awareness, lastKnown: e.lastKnown, lastSeen: e.lastSeen, contact: e.contact } };
    records.push(record);
    assert.equal(G.stats.shots, 0, 'this actual-input encounter contains no gunfire');
    if (pace === 'run') {
      assert.ok(noises.length > 0);
      const audible = barrier === 'open' || barrier === 'foliage' || distance <= 7;
      assert.equal(e.state, audible ? 'alert' : 'idle', 'the material path distinguishes genuinely audible steps from blocked quiet movement');
      {
        assert.ok(noises.every(({ event, actualFeet }) => event.y === actualFeet[1] + .05), 'the real running event carries its explicit boot-contact source height');
        assert.equal(eventProbes, noises.length, 'one eligible guard uses one path probe per real running step');
      }
      if (!audible) assert.equal(e.lastKnown, null, 'an inaudible step cannot supply a hidden live player fix');
      assert.equal(e.lastSeen, -99); assert.equal(e.contact, null, 'audible running does not become confirmed visual contact');
      if (barrier === 'wood' && distance === 7) assert.ok(e.lastKnown.x < noises.at(-1).event.x, 'later inaudible steps do not track a runner beyond the transmitted range');
    }
    else { assert.equal(noises.length, 0); assert.equal(e.state, 'idle', 'ordinary walking and crouching do not become new noise events'); }
    player.char.dispose(); for (const actor of enemies.list) actor.char.dispose();
    terrain.group.traverse(o => { if (o.isMesh) { o.userData.fine?.dispose(); o.userData.coarse?.dispose(); } }); terrain.material.dispose();
  }
} finally { globalThis.scheduler = oldScheduler; }
console.log('ok    actual running events distinguish open/planks/nearby steps from masonry/earth/barricade paths');
console.log('ok    ordinary walking/crouching stay quiet and later inaudible steps do not track the runner');

{
const cue = Object.freeze({ ...records.find(r => r.barrier === 'open' && r.pace === 'run').noises[0].event });
function one({ crouched = false, elevated = false } = {}) {
  const boxes = [{ x: 0, y: elevated ? 1 : .325, z: 4.5, hx: 15, hy: elevated ? 1 : .325, hz: .3, surface: 'stone' }];
  if (elevated) boxes.push({ x: 0, y: 2, z: 0, hx: 2, hy: 2, hz: 1, surface: 'wood' });
  const f = aiFixture({ soldierModel: rig, player: [90, 90], boxes, definitions: [soldier(0, 0, { yaw: 180, hold: true, ...(elevated ? { anchor: [0, 4, 0, Math.PI] } : {}) })] });
  const e = f.enemies.list[0]; e.perceiveTimer = 1e6; advance(f.G, f.enemies, .3);
  if (crouched) { e.char.animate('crouch_idle', 'crouch_idle', 1); e.char.update(.4, e.pos.y); }
  const ear = e.char.boneWorld('head', new THREE.Vector3()), direction = new THREE.Vector3(cue.x, cue.y, cue.z).sub(ear), distance = direction.length(); direction.divideScalar(distance);
  const hit = f.G.world.raycast(...ear.toArray(), ...direction.toArray(), distance - .25, SHOT, { noWater: true });
  let probes = 0; const raycast = f.G.world.raycast; f.G.world.raycast = (...args) => { probes++; return raycast(...args); };
  // A delayed event cannot query the runner's current hidden position.
  const player = f.G.player; f.G.player = new Proxy(player, { get(_o, key) { if (key === 'pos') throw new Error('Hidden live player position read by hearing'); return player[key]; } });
  f.G.events.emit('noise', cue); f.G.player = player;
  assert.equal(probes, 1);
  assert.equal(e.state, crouched ? 'idle' : 'alert', 'the true ear height determines low-barrier hearing: ' + JSON.stringify({ crouched, elevated, ear: ear.toArray(), hit: hit && { t: hit.t, y: hit.y, surface: hit.surface }, distance }));
  if (crouched) { assert.ok(hit); assert.equal(e.lastKnown, null); assert.ok(ear.y < 1.1); }
  else { assert.equal(hit, null); assert.deepEqual(e.lastKnown, { x: cue.x, z: cue.z }); }
  for (const actor of f.enemies.list) actor.char.dispose();
}
one(); one({ crouched: true }); one({ elevated: true });
console.log('ok    actual crouched/elevated ears and explicit boot source height govern hearing without hidden player reads');

for (const occluded of [false, true]) {
  const definitions = [];
  for (let row = 0; row < 5; row++) for (let column = 0; column < 5; column++) definitions.push(soldier(cue.x + (column - 2) * 1.2, cue.z + 6.5 + row, { hold: true, yaw: 0 }));
  const f = aiFixture({ player: [-90, -90], definitions, boxes: occluded ? [{ x: cue.x, y: 1.5, z: cue.z + 3, hx: 20, hy: 1.5, hz: .4, surface: 'stone' }] : [] });
  for (const e of f.enemies.list) e.perceiveTimer = 1e6;
  let probes = 0; const raycast = f.G.world.raycast; f.G.world.raycast = (...args) => { probes++; return raycast(...args); };
  advance(f.G, f.enemies, 1); assert.equal(probes, 0, 'idle frames add no step-acoustic probes');
  for (let i = 0; i < 100; i++) f.G.events.emit('noise', cue);
  assert.equal(probes, 8, 'a hundred cues in one simulation frame cannot exceed eight path probes');
  assert.equal(f.enemies.list.filter(e => e.state === 'alert').length, occluded ? 0 : 8, 'saturated listeners are not assumed to hear through unknown cover');
  for (let beat = 0; beat < 3; beat++) {
    f.G.time += .3; const before = probes; f.G.events.emit('noise', cue);
    assert.equal(probes - before, 8, 'each real later beat retains the fixed listener budget');
  }
  assert.equal(f.enemies.list.filter(e => e.state === 'alert').length, occluded ? 0 : 25, 'round-robin selection eventually reaches every genuinely audible guard');
  assert.ok(f.enemies.list.every(e => e.lastSeen === -99 && !e.contact && !e.pendingContact), 'hearing cannot become visual contact or a confirmed squad call');
  const before = probes; advance(f.G, f.enemies, 2); assert.equal(probes, before, 'completed cues leave no acoustic queue or idle work');
  f.enemies.resetLiving(); f.G.events.emit('noise', cue);
  assert.equal(probes - before, 8, 'retry clears the per-frame acoustic budget and rotation state');
  for (const actor of f.enemies.list) actor.char.dispose();
}
console.log('ok    25 guards rotate fairly within eight queries per frame; blocked crowds never inherit hearing');

for (const invalid of [{ ...cue, y: undefined }, { ...cue, y: NaN }, { ...cue, y: 1000 }, { ...cue, radius: NaN }]) {
  const f = aiFixture({ player: [0, 9], definitions: [soldier(0, 0, { hold: true })] });
  let probes = 0; const raycast = f.G.world.raycast; f.G.world.raycast = (...args) => { probes++; return raycast(...args); };
  f.G.events.emit('noise', invalid);
  assert.equal(f.enemies.list[0].state, 'idle'); assert.equal(f.enemies.list[0].lastKnown, null);
  assert.equal(probes, 0, 'missing/invalid/out-of-range source heights do not guess a live player position');
  for (const actor of f.enemies.list) actor.char.dispose();
}
console.log('ok    malformed or vertically distant step cues cannot invent a source or spend path probes');
for (const active of [false, true]) for (const occluded of [false, true]) {
  const f = aiFixture({ soldierModel: rig, player: [0, -120], boxes: occluded ? [{ x: 4, y: 1.5, z: 0, hx: .4, hy: 1.5, hz: 30, surface: 'stone' }] : [], definitions: [soldier(0, 0, { hold: true }), soldier(0, -5)] });
  const { G, enemies } = f, [victim, observer] = enemies.list; G.daylight = true; G.player.visible = 0;
  for (const e of enemies.list) e.perceiveTimer = 1e6;
  advance(G, enemies, .3); observer.pos.z = -10; observer.char.root.position.copy(observer.pos); observer.state = 'return';
  victim.damage(1000, G.player.pos, 'body', true); advance(G, enemies, .15);
  assert.equal(observer.state, 'return'); assert.ok(observer.casualtyReaction, 'a real nearby visible fall awaits the returning guard human reaction');
  if (active) { advance(G, enemies, 1.3); assert.equal(observer.srch?.reason, 'casualty', 'the visible casualty response has genuinely begun'); }
  const event = { ...cue, x: 8, z: observer.pos.z };
  G.events.emit('noise', event); const immediate = { state: observer.state, lastKnown: observer.lastKnown && { ...observer.lastKnown } };
  advance(G, enemies, 1.2);
  if (!occluded) {
    assert.equal(observer.state, 'alert'); assert.deepEqual(observer.lastKnown, { x: event.x, z: event.z });
    assert.equal(observer.srch, null, 'quiet audible movement turns the head rather than retaining a stale body-search order');
    assert.equal(observer.casualtyReaction, null, 'a genuinely heard step cancels the pending body response before it can overwrite real auditory knowledge');
  } else {
    assert.equal(observer.srch?.reason, 'casualty'); assert.ok(Math.abs(observer.srch.x) < 1, 'the body-search order remains directed at the real casualty');
    assert.ok(observer.lastKnown.uncertain && Math.abs(observer.lastKnown.x) < 1, 'an actually inaudible step leaves the genuine body investigation intact');
  }
  assert.equal(observer.lastSeen, -99); assert.equal(observer.contact, null); assert.equal(observer.pendingContact, null);
  for (const e of enemies.list) e.char.dispose();
}
console.log('ok    audible steps supersede pending/active casualty responses with alert only; blocked steps preserve both');
}
