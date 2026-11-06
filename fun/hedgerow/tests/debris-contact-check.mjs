// A magazine/clip/rifle contacts its real floor once; grenade physics keeps
// its separate bounce cue. Use the shipped weapons for the transform check.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { createDebris, createExplosives } = await import('../js/combat.js');
const { readSet, instantiate } = await import('../js/assets.js');
const { createWorld } = await import('../js/world.js');
const models = new Map(); readSet(await parseUntexturedGLB('weapons'), 'weapons', models);
const material = new THREE.MeshBasicMaterial(), matlib = { get: () => material, resolve: () => material };
function fixture(surface = 'stone', max = 48) {
  let elapsed = 0, surfaceQueries = 0;
  const contacts = [], grenadeCues = [], terrain = { height: () => 0, surfaceAt: () => surface, raycast: () => Infinity };
  const world = createWorld({ minX: -20, maxX: 20, minZ: -20, maxZ: 20, terrain });
  const surfaceUnder = world.surfaceUnder;
  world.surfaceUnder = (...args) => { surfaceQueries++; return surfaceUnder(...args); };
  const G = { scene: new THREE.Scene(), world, audio: {
    debrisImpact: (...args) => contacts.push({ time: elapsed, args }), grenadeBounce: (...args) => grenadeCues.push(args),
  } };
  const debris = createDebris(G, { max });
  return { debris, world, terrain, G, contacts, grenadeCues, get surfaceQueries() { return surfaceQueries; },
    step(dt) { elapsed += dt; debris.update(dt); } };
}
const originalRandom = Math.random; Math.random = () => .5;
try {
  for (const radius of [.03, .04, .08]) for (const fps of [20, 60, 120]) for (const surface of ['stone', 'wood', 'mud', 'water']) {
    const fixture_ = fixture(surface);
    const object = radius === .08 ? instantiate(models.get('kar98k'), matlib) : new THREE.Mesh(new THREE.BoxGeometry(.04, .16, .06), material);
    fixture_.debris.spawn(object, new THREE.Vector3(2, 1.6, 1), new THREE.Vector3(.4, radius === .08 ? 1 : -.8, .2), { radius, spin: 5 });
    let firstVisible = null;
    for (let frame = 1; frame <= fps * 5; frame++) {
      fixture_.step(1 / fps);
      if (firstVisible === null && Math.abs(object.position.y - radius * .5) < 1e-9) firstVisible = frame / fps;
    }
    assert.equal(fixture_.contacts.length, 1, 'later bounces and rest do not repeat the contact');
    const contact = fixture_.contacts[0];
    assert.ok(Math.abs(contact.time - firstVisible) < 1e-10, 'sound belongs to the exact visible floor update');
    assert.equal(contact.args[1], 0); assert.equal(contact.args[3], surface);
    assert.ok(contact.args[4] > 1); assert.equal(contact.args[5], radius);
    assert.equal(fixture_.surfaceQueries, 1); assert.equal(fixture_.grenadeCues.length, 0);
    assert.ok(fixture_.debris.list[0].rest);
  }
  {
    const fixture_ = fixture('wood', 2), removed = new THREE.Object3D();
    for (const object of [removed, new THREE.Object3D(), new THREE.Object3D()]) fixture_.debris.spawn(object, new THREE.Vector3(0, 2, 0), new THREE.Vector3(), { radius: .04 });
    assert.equal(fixture_.debris.list.length, 2); assert.equal(removed.parent, null, 'eviction removes the old visual object');
    const before = fixture_.debris.list.map(body => [body.object.position.toArray(), body.life]);
    for (const dt of [0, -1, NaN, Infinity]) fixture_.debris.update(dt);
    assert.deepEqual(fixture_.debris.list.map(body => [body.object.position.toArray(), body.life]), before);
    assert.equal(fixture_.contacts.length, 0); assert.equal(fixture_.surfaceQueries, 0);
    fixture_.debris.clear(); for (let i = 0; i < 200; i++) fixture_.step(.05);
    assert.equal(fixture_.contacts.length, 0, 'clearing airborne objects cancels their future contact');
    fixture_.debris.spawn(new THREE.Object3D(), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -5, 0), { radius: .08 });
    fixture_.step(.05); assert.equal(fixture_.contacts.length, 0, 'initial penetration is corrected silently');
  }
  {
    const fixture_ = fixture(), parent = new THREE.Group();
    parent.position.set(2, 1.5, 3); parent.rotation.y = .4; fixture_.G.scene.add(parent);
    const rifle = instantiate(models.get('m1_garand'), matlib);
    rifle.position.set(.2, .2, .3); parent.add(rifle); parent.updateMatrixWorld(true);
    const at = rifle.getWorldPosition(new THREE.Vector3()), rotation = rifle.getWorldQuaternion(new THREE.Quaternion());
    fixture_.debris.drop(rifle, new THREE.Vector3(0, 1, 0), { radius: .08 });
    assert.ok(rifle.position.distanceTo(at) < 1e-10); assert.ok(rifle.quaternion.angleTo(rotation) < 1e-7);
    for (let i = 0; i < 200; i++) fixture_.step(.05);
    assert.equal(fixture_.contacts.length, 1);
    const [x, y, z, surface] = fixture_.contacts[0].args;
    assert.equal(y, fixture_.world.groundAt(x, z, y + .2, .25, .08));
    assert.equal(surface, fixture_.world.surfaceUnder(x, y, z));
  }
  {
    const fixture_ = fixture(); fixture_.terrain.height = () => -50;
    fixture_.world.add({ type: 'box', x: 2, y: 1, z: 1, hx: .2, hy: 1, hz: 2, yaw: 0 });
    fixture_.debris.spawn(new THREE.Object3D(), new THREE.Vector3(2, 1.6, 1), new THREE.Vector3(), { radius: .08 });
    for (let i = 0; i < 60; i++) fixture_.step(1 / 120);
    assert.equal(fixture_.contacts.length, 0, 'a horizontal wall push-out is not a floor impact');
  }
  {
    const fixture_ = fixture(); let remainingHit = true;
    Object.assign(fixture_.G, { models: new Map(), matlib, player: { alive: false }, rig: { yaw: 0 }, hud: { grenadeWarning() {} }, events: { emit() {} } });
    fixture_.world.raycast = () => {
      if (!remainingHit) return null;
      remainingHit = false; return { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, surface: 'stone' };
    };
    const explosives = createExplosives(fixture_.G);
    explosives.throwGrenade('player', new THREE.Vector3(0, .2, 0), new THREE.Vector3(0, -4, 0)); explosives.update(.05);
    assert.equal(fixture_.grenadeCues.length, 1, 'a genuine grenade retains its own bounce cue');
    assert.equal(fixture_.contacts.length, 0); explosives.clear();
  }
  // A top must not kick a body sideways or vanish below a fast fall.
  for (const radius of [.03, .04, .08]) for (const fps of [20, 60, 120]) for (const [y, vy] of [[1.6, 1], [10, -18]]) {
    const fixture_ = fixture();
    fixture_.world.add({ type: 'box', x: 0, y: .3, z: 0, hx: 2, hy: .3, hz: 2, yaw: 0, surface: 'wood' });
    const body = fixture_.debris.spawn(new THREE.Object3D(), new THREE.Vector3(0, y, 0), new THREE.Vector3(0, vy, 0), { radius, spin: 0 });
    for (let frame = 0; frame < fps * 5; frame++) fixture_.step(1 / fps);
    assert.ok(Math.abs(body.object.position.y - (.6 + radius * .5)) < 1e-9);
    assert.ok(Math.hypot(body.object.position.x, body.object.position.z) < .001);
    assert.equal(fixture_.contacts.length, 1); assert.equal(fixture_.contacts[0].args[3], 'wood');
    assert.ok(Math.abs(fixture_.contacts[0].args[1] - .6) < 1e-9); assert.ok(body.rest);
  }
  for (const fps of [20, 60, 120]) {
    const fixture_ = fixture();
    fixture_.world.add({ type: 'box', x: 0, y: .3, z: 0, hx: 2, hy: .3, hz: 2, yaw: 0, surface: 'wood' });
    const body = fixture_.debris.spawn(new THREE.Object3D(), new THREE.Vector3(-2.3, .25, 0), new THREE.Vector3(8, 0, 0), { radius: .08, spin: 0 });
    let closestX = body.object.position.x;
    for (let frame = 0; frame < fps * 3; frame++) { fixture_.step(1 / fps); closestX = Math.max(closestX, body.object.position.x); }
    assert.ok(closestX > -2.15, 'the fixture reaches the vertical wall');
    assert.ok(body.object.position.x <= -2.07, 'a real side approach stays blocked');
    assert.ok(Math.abs(body.object.position.y - .04) < 1e-9, 'a side approach cannot climb the platform');
    assert.ok(fixture_.contacts.every(contact => contact.args[3] === 'stone'));
  }
  for (const fps of [20, 60, 120]) {
    const fixture_ = fixture();
    fixture_.world.add({ type: 'box', x: 0, y: 1.2, z: 0, hx: 2, hy: .1, hz: 2, yaw: 0, surface: 'wood' });
    const body = fixture_.debris.spawn(new THREE.Object3D(), new THREE.Vector3(0, .6, 0), new THREE.Vector3(0, 8, 0), { radius: .08, spin: 0 });
    let redirected = false;
    for (let frame = 0; frame < fps * 3; frame++) {
      fixture_.step(1 / fps);
      const { x, y, z } = body.object.position;
      if (Math.abs(x) > 2 || Math.abs(z) > 2) redirected = true;
      if (!redirected) assert.ok(y < 1.34, 'an upward launch cannot tunnel through the overhang');
    }
    assert.ok(redirected, 'the existing horizontal collision response clears the underside');
    assert.ok(fixture_.contacts.every(contact => contact.args[3] === 'stone'), 'an underside is not a floor landing');
  }
  for (const fps of [20, 60, 120]) {
    const fixture_ = fixture();
    fixture_.world.add({ type: 'box', x: 0, y: .3, z: 0, hx: 2, hy: .3, hz: 2, yaw: 0, surface: 'wood' });
    fixture_.debris.spawn(new THREE.Object3D(), new THREE.Vector3(-2.4, 2, -2.4), new THREE.Vector3(20, -18, 20), { radius: .08, spin: 0 });
    for (let frame = 0; frame < fps; frame++) fixture_.step(1 / fps);
    assert.equal(fixture_.contacts.length, 1); const [x, y, z, surface] = fixture_.contacts[0].args;
    assert.ok(x > -2 && x < 2 && z > -2 && z < 2); assert.equal(surface, 'wood'); assert.ok(Math.abs(y - .6) < 1e-9);
  }
  {
    const fixture_ = fixture(), object = new THREE.Object3D();
    for (let round = 0; round < 2; round++) {
      fixture_.debris.spawn(object, new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(), { radius: .08, spin: 0 });
      const paused = object.position.toArray();
      for (let i = 0; i < 20; i++) fixture_.debris.update(0);
      assert.deepEqual(object.position.toArray(), paused);
      for (let i = 0; i < 120; i++) fixture_.step(1 / 60);
      assert.equal(fixture_.contacts.length, round + 1, 'reusing a cleared object creates a fresh contact'); fixture_.debris.clear();
    }
  }
} finally { Math.random = originalRandom; }
console.log('debris-contact-check:36 material drops,18 fast/slow top landings, exact contact, side walls, upward underside/diagonal edge, pause/reuse, real weapon transform and genuine grenade bounce pass');
