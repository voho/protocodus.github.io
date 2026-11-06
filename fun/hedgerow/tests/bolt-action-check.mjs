import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { readSet, instantiate } = await import('../js/assets.js');
const { articulatedKar98kModel, createKar98kMechanism, BOLT_CYCLE_DURATION } = await import('../js/kar98k-action.js');
const { createCharacter } = await import('../js/character.js');

const models = new Map(); readSet(await parseUntexturedGLB('weapons'), 'weapons', models);
const original = models.get('kar98k');
const hash = model => createHash('sha256').update(model.prims.map(p =>
  Object.values(p.geometry.attributes).map(attribute => Buffer.from(attribute.array.buffer)).map(b => b.toString('base64')).join(':')).join('|')).digest('hex');
const before = hash(original), articulated = articulatedKar98kModel(original);
assert.notEqual(articulated, original, 'the four real authored bolt solids are found');
assert.equal(articulatedKar98kModel(original), articulated, 'the prepared geometry is shared on subsequent respawns');
assert.equal(articulatedKar98kModel(models.get('mp40')), models.get('mp40'));
assert.equal(hash(original), before, 'the original shared enemy rifle remains unchanged');

function triangles(model) {
  const result = [];
  for (const primitive of model.prims) {
    const { geometry } = primitive, count = geometry.index?.count ?? geometry.attributes.position.count;
    const attributes = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b));
    for (let t = 0; t < count; t += 3) {
      const triangle = [];
      for (let k = 0; k < 3; k++) {
        const i = geometry.index?.getX(t + k) ?? t + k;
        for (const [, attribute] of attributes) for (let c = 0; c < attribute.itemSize; c++) triangle.push(attribute.getComponent(i, c));
      }
      result.push(JSON.stringify(triangle));
    }
  }
  return result.sort();
}
assert.deepEqual(triangles(articulated), triangles(original), 'every original triangle, UV, normal and colour survives exactly once');
assert.equal(articulated.prims.length, 3, 'only the player adds a handle and shroud draw');
const material = new THREE.MeshBasicMaterial();
const gun = instantiate(articulated, { resolve: () => material });
const action = createKar98kMechanism(gun); assert.ok(action);
const closed = action.gripPoint(new THREE.Vector3());
action.set(.47);
const open = action.gripPoint(new THREE.Vector3());
assert.ok(open.y - closed.y > .08 && Math.abs(open.z - closed.z + .095) < 1e-6, 'the lifted bolt draws back 95 mm');
assert.ok(Math.abs(action.angle + Math.PI / 2) < 1e-6);
action.set(BOLT_CYCLE_DURATION);
assert.ok(action.gripPoint(new THREE.Vector3()).distanceTo(closed) < 1e-10); assert.equal(action.grip, 0);
action.set(1.3, true);
assert.ok(action.gripPoint(new THREE.Vector3()).distanceTo(open) < 1e-10, 'the action stays open while the stripper clip is loaded');
action.set(3.2, true);
assert.ok(action.gripPoint(new THREE.Vector3()).distanceTo(closed) < 1e-10);
action.set(NaN); assert.equal(action.grip, 0); assert.ok(Math.abs(action.angle) < 1e-10);
assert.equal(createKar98kMechanism(new THREE.Group()), null);

const soldier = await parseUntexturedGLB('soldier');
const matlib = { resolve: m => m || material, get: () => material };
const worldPoint = (object, point = new THREE.Vector3()) => object.getWorldPosition(point);
let mostGripError = 0, mostSupportError = 0;
for (const crouched of [false, true]) for (const pitch of [-.6, 0, .6]) {
  const options = { outfit: 'axis', weaponModel: original, scene: new THREE.Scene() };
  const ch = createCharacter(soldier, matlib, { ...options, weaponActions: true });
  const reference = createCharacter(soldier, matlib, options);
  for (const character of [ch, reference]) {
    character.steady = true; character.aimPitch = pitch;
    character.animate(crouched ? 'crouch_idle' : 'idle', crouched ? 'crouch_aim' : 'aim', 1);
    for (let i = 0; i < 30; i++) character.update(1 / 60, 0);
  }
  const lengths = ['upperarm_r', 'forearm_r'].map((bone, i) =>
    worldPoint(ch.bones[bone]).distanceTo(worldPoint(ch.bones[i ? 'hand_r' : 'forearm_r'])));
  // Hold the open action for many unchanged animation keys, then finish.
  for (let frame = 0; frame < 120; frame++) {
    ch.boltAge = .47; ch.update(1 / 60, 0); reference.update(1 / 60, 0);
    const knob = ch.weapon.getObjectByName('kar98k_bolt').localToWorld(new THREE.Vector3(-.054, .016, -.011).sub(new THREE.Vector3(0, .05, -.004)));
    mostGripError = Math.max(mostGripError, worldPoint(ch.socket).distanceTo(knob));
    mostSupportError = Math.max(mostSupportError, ch.muzzleWorld().distanceTo(reference.muzzleWorld()));
    assert.ok(Math.abs(worldPoint(ch.bones.upperarm_r).distanceTo(worldPoint(ch.bones.forearm_r)) - lengths[0]) < 1e-6);
    assert.ok(Math.abs(worldPoint(ch.bones.forearm_r).distanceTo(worldPoint(ch.bones.hand_r)) - lengths[1]) < 1e-6);
  }
  ch.boltAge = -1; ch.update(1 / 60, 0); reference.update(1 / 60, 0);
  assert.equal(ch.weapon.parent, ch.socket, 'the returned hand supports the closed rifle again');
  assert.ok(worldPoint(ch.bones.hand_r).distanceTo(worldPoint(reference.bones.hand_r)) < 1e-6, 'an unchanged animation pose restores without drift');
  ch.boltAge = .47; ch.update(1 / 60, 0);
  ch.cancelWeaponAction(); ch.oneShot('throw', 1.2); ch.update(1 / 60, 0);
  assert.equal(ch.weapon.parent, ch.socketL, 'a quick grenade tap takes the restored rifle into the supporting hand');
  for (let i = 0; i < 100; i++) ch.update(1 / 60, 0);
  assert.equal(ch.weapon.parent, ch.socket, 'the finished throw returns the rifle to its grip');
  ch.boltAge = .47; ch.update(1 / 60, 0);
  const oldGun = ch.weapon; ch.setWeapon(models.get('mp40'));
  assert.equal(oldGun.parent, null, 'switching removes the temporarily root-supported rifle');
  ch.dispose(); reference.dispose();
}
assert.ok(mostGripError < .002, `the real hand reaches the moving bolt (${mostGripError} m)`);
assert.ok(mostSupportError < 1e-6, `working the bolt does not move the rifle in the supporting hand (${mostSupportError} m)`);
console.log(`bolt-action-check: lossless real-model split, 90°/95 mm action, reload timing and real-rig arm lengths/restoration; grip error ${(mostGripError * 1000).toFixed(3)} mm`);
