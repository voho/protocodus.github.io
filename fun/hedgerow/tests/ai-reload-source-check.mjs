// Actual reload foley sources follow the moving hands below low cover.
import assert from 'node:assert/strict';
import { aiFixture, soldier, advance, forceCombat } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { readSet } = await import('../js/assets.js');
const { SHOT } = await import('../js/world.js');
const rig = await parseUntexturedGLB('soldier'), models = new Map();
readSet(await parseUntexturedGLB('weapons'), 'weapons', models);

for (const type of ['rifle', 'smg']) {
  const f = aiFixture({ soldierModel: rig, models, boxes: [{ x: 0, y: .5, z: 5, hx: 3, hy: .5, hz: .3, surface: 'stone' }], definitions: [soldier(0, 0, { type })] });
  const { G, enemies } = f, e = enemies.list[0], samples = [];
  G.camera.position.y = 1.6;
  let source = null, profile = null, firstPoint = null;
  function blocked(point) {
    const direction = point.clone().sub(G.camera.position), distance = direction.length();
    direction.divideScalar(distance);
    return G.world.raycast(...G.camera.position.toArray(), ...direction.toArray(), Math.max(0, distance - .25), SHOT, { noWater: true });
  }
  G.audio.reloadActor = (_kind, getPosition, options) => {
    source = getPosition; profile = options;
    return {
      advance() {
        const point = source();
        firstPoint ??= point;
        assert.equal(point, firstPoint, 'one reusable world point serves the reload without per-beat vector allocation');
        const hand = e.char.boneWorld('hand_r', new THREE.Vector3());
        assert.ok(point.distanceTo(hand) < 1e-6, 'the actual rig hand supplies the mechanical source');
        const oldPoint = e.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
        samples.push({ source: point.clone(), feet: e.pos.clone(), stance: e.stance, path: blocked(point), oldPath: blocked(oldPoint) });
      },
      cancel() {}, finish() {},
    };
  };
  advance(G, enemies, .25);
  forceCombat(e, G); e.sees = true; e.exposure = 1; e.perceiveTimer = 1e6; e.mag = 1; e.aimTimer = 0; e.fireTimer = 0; e.target = { x: 0, z: 0 };
  advance(G, enemies, .1); e.fireTimer = 1e6;
  assert.ok(source, 'emptying the actual weapon starts its actor reload');
  assert.equal(profile.heightOffset, 0, 'an exact world source is not raised by the audio feet offset');
  advance(G, enemies, e.reloadTotal + .2);
  assert.ok(samples.some(s => s.feet.z > 2), 'the real reload moves to cover');
  assert.ok(samples.some(s => s.stance === 'crouch' && s.source.y < 1), 'the hand source lowers with the actual crouched reload pose');
  assert.ok(samples.some(s => s.stance === 'crouch' && s.path?.surface === 'stone' && !s.oldPath), 'low stone cover blocks the real hand source while the old fixed-height source incorrectly clears it');
  assert.ok(samples.at(-1).source.distanceTo(samples[0].source) > 1, 'later mechanical beats follow the moving actor');
  let calls = 0; const boneWorld = e.char.boneWorld;
  e.char.boneWorld = (...args) => { calls++; return boneWorld(...args); };
  e.damage(1000, G.player.pos, 'body', true); calls = 0;
  assert.equal(source(), null, 'the dead actor cannot supply a live reload source');
  assert.equal(calls, 0, 'death short-circuits bone queries');
  for (const actor of enemies.list) actor.char.dispose();
  console.log(`ok    ${type}: moving and crouched actual-rig reload cues use the covered hand source`);
}

{
  const f = aiFixture({ soldierModel: rig, models, definitions: [soldier(0, 0, { type: 'mg', gun: [0, 1.1, 0, 0] })] });
  const { G, enemies } = f, e = enemies.list[0];
  assert.ok(e.mg, 'the unchanged control uses the actual mounted gun');
  let source = null, profile = null;
  G.audio.reloadActor = (_kind, getter, options) => { source = getter; profile = options; return { advance() {}, cancel() {}, finish() {} }; };
  advance(G, enemies, .3); forceCombat(e, G); e.sees = true; e.perceiveTimer = 1e6; e.mag = 1; e.aimTimer = 0; e.fireTimer = 0;
  advance(G, enemies, .1);
  assert.ok(source, 'the mounted control starts a real reload');
  assert.equal(source(), e.pos, 'mounted MG retains its existing feet source');
  assert.equal(profile.heightOffset, undefined, 'mounted MG retains the default audio height');
  for (const actor of enemies.list) actor.char.dispose();
}
console.log('ok    mounted MG source behavior remains unchanged');
