// Preserve the shipped 60 Hz fall exactly while presentation dt changes.
// These use the actual soldier, collision world, bone pose and death camera.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { RAGDOLL_CASES, ragdollFixture } from './ragdoll-fixture.mjs';
const THREE = await import('three');
const { createCameraRig } = await import('../js/camera.js');
const reference = JSON.parse(await readFile(new URL('./fixtures/ragdoll-reference.json', import.meta.url), 'utf8'));

const state = fixture => fixture.rd.positions.map(position => position.toArray());
function hashFrame(hash, fixture) {
  const buffer = Buffer.alloc(fixture.rd.positions.length * 24 + 1); let offset = 0;
  for (const position of fixture.rd.positions) for (const value of position.toArray()) { buffer.writeDoubleLE(value, offset); offset += 8; }
  buffer[offset] = fixture.rd.asleep ? 1 : 0; hash.update(buffer);
}
function sane(fixture, name) {
  for (const position of fixture.rd.positions) {
    assert.ok(position.toArray().every(Number.isFinite), `${name}: finite particle positions`);
    assert.ok(position.y >= fixture.terrain.height(position.x, position.z) - .001, `${name}: nothing falls below the terrain`);
    const corrected = position.clone();
    fixture.world.pushOut(corrected, .02, position.y - .02, .04, .02);
    assert.ok(corrected.distanceToSquared(position) < 1e-10, `${name}: no particle centre remains inside a solid collider`);
  }
  for (const [a, b] of [[6, 7], [7, 8], [14, 15], [15, 16]]) {
    const initial = fixture.start[a].distanceTo(fixture.start[b]), current = fixture.rd.positions[a].distanceTo(fixture.rd.positions[b]);
    assert.ok(Math.abs(initial - current) < initial * .12, `${name}: limbs retain their length after collision`);
  }
}

for (const name of RAGDOLL_CASES) {
  const fixture = ragdollFixture(name), hash = createHash('sha256'), samples = new Map();
  let sleepFrame = null;
  for (let frame = 1; frame <= 360; frame++) {
    fixture.char.update(1 / 60, 0); hashFrame(hash, fixture);
    if (frame % 60 === 0) samples.set(frame / 60, state(fixture));
    if (sleepFrame === null && fixture.rd.asleep) sleepFrame = frame;
    if (frame % 30 === 0) sane(fixture, name);
  }
  assert.equal(hash.digest('hex'), reference.cases[name].trajectorySha256, `${name}: all 360 reference frames, including the exact sleep frame, remain bit-identical`);
  assert.equal(sleepFrame, reference.cases[name].sleepFrame);
  const referenceQueries = fixture.queries;
  for (const cadence of [20, 30, 120, 240, 'mixed']) {
    const variant = ragdollFixture(name); let time = 0, frame = 0;
    for (let second = 1; second <= 6; second++) {
      while (time < second - 1e-9) {
        const requested = cadence === 'mixed' ? [.011, .019, .034, .007, .043][frame++ % 5] : 1 / cadence;
        const dt = Math.min(requested, second - time); variant.char.update(dt, 0); time += dt;
      }
      assert.deepEqual(state(variant), samples.get(second), `${name}: ${cadence} presentation keeps the same physical state at ${second}s`);
    }
    assert.equal(variant.rd.asleep, true); assert.equal(variant.queries, referenceQueries, `${name}: sleep/collision solve count is independent of presentation cadence`);
    sane(variant, `${name}/${cadence}`);
  }
}

// Invalid/paused updates do not even consume a partial accumulated tick.
{
  const fixture = ragdollFixture('standing'), expected = ragdollFixture('standing');
  fixture.rd.step(1 / 240); const before = state(fixture), queries = fixture.queries;
  for (let i = 0; i < 10; i++) for (const dt of [0, -1, NaN, Infinity, -Infinity]) fixture.rd.step(dt);
  assert.deepEqual(state(fixture), before); assert.equal(fixture.queries, queries);
  fixture.rd.step(1 / 240); expected.rd.step(1 / 120);
  assert.deepEqual(state(fixture), state(expected), 'pause preserves the partial tick for the next valid update');
}

// A caller outside main's .05 cap cannot force an unbounded catchup loop.
{
  const hitch = ragdollFixture('standing'), expected = ragdollFixture('standing');
  hitch.rd.step(10);
  assert.equal(hitch.queries, 12 * 22 * 6, 'one extreme hitch performs at most twelve existing collision solves');
  for (let i = 0; i < 6; i++) expected.rd.step(1 / 60);
  assert.deepEqual(state(hitch), state(expected));
  hitch.rd.step(0); assert.deepEqual(state(hitch), state(expected), 'discarded hitch time creates no backlog after a pause');
}

// The actual head bones continue to drive a safe first-person fall, then a
// collision-aware chase toward the killer. Pause/reset keep their contracts.
for (const name of ['standing', 'wall', 'slope', 'platform-blast']) for (const killer of [null, new THREE.Vector3(4, 1.65, 12)]) {
  const fixture = ragdollFixture(name), camera = new THREE.PerspectiveCamera(70, 16 / 9, .06, 500);
  const eye = { pos: fixture.char.headWorld(), quat: fixture.char.bones.head.getWorldQuaternion(new THREE.Quaternion()) };
  camera.position.copy(eye.pos).add(new THREE.Vector3(0, .05, -.1)); camera.lookAt(eye.pos.clone().add(new THREE.Vector3(0, 0, 1)));
  const rig = createCameraRig(camera, fixture.world);
  for (let frame = 0; frame < 180; frame++) {
    fixture.char.update(1 / 30, 0); fixture.char.bones.head.getWorldPosition(eye.pos); fixture.char.bones.head.getWorldQuaternion(eye.quat);
    rig.deathCam(1 / 30, fixture.rd.pelvis, killer, eye);
    assert.ok([...camera.position.toArray(), ...camera.quaternion.toArray(), camera.fov].every(Number.isFinite));
    assert.ok(camera.position.y >= fixture.terrain.height(camera.position.x, camera.position.z) + .119, `${name}: falling eye/chase stays above terrain`);
    assert.ok(camera.fov >= 16 && camera.fov <= 70);
  }
  const before = { position: camera.position.toArray(), rotation: camera.quaternion.toArray(), time: rig.deathTime(), body: state(fixture) };
  fixture.char.update(0, 0); rig.deathCam(0, fixture.rd.pelvis, killer, eye);
  assert.deepEqual(state(fixture), before.body); assert.deepEqual(camera.position.toArray(), before.position);
  assert.deepEqual(camera.quaternion.toArray(), before.rotation); assert.equal(rig.deathTime(), before.time);
  rig.resetDeathCam(); assert.equal(rig.deathTime(), 0);
}
console.log('ragdoll-time-check: seven real-rig/collider falls preserve all360 published60Hz frames; 20–240Hz/mixed dt, invariant sleep, zero/invalid dt, 12-step hitch cap and real death-camera fall/chase pass');
