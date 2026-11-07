// The actual mounted receiver, rather than a crouching hand, emits its reload cues.
import assert from 'node:assert/strict';
import { aiFixture, soldier, advance, forceCombat } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { readSet } = await import('../js/assets.js');
const rig = await parseUntexturedGLB('soldier'), originalModels = new Map();
readSet(await parseUntexturedGLB('weapons'), 'weapons', originalModels);
const fallback = [0, .300, -.552], weapon = originalModels.get('mg42');
const triangle = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), closest = new THREE.Vector3(), center = new THREE.Vector3(...fallback);
let nearest = Infinity;
for (const prim of weapon.prims) {
  const positions = prim.geometry.attributes.position, indices = prim.geometry.index, count = indices?.count || positions.count;
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(positions, indices ? indices.getX(i) : i); b.fromBufferAttribute(positions, indices ? indices.getX(i + 1) : i + 1); c.fromBufferAttribute(positions, indices ? indices.getX(i + 2) : i + 2);
    triangle.set(a, b, c); if (triangle.getArea() < 1e-10) continue;
    triangle.closestPointToPoint(center, closest); nearest = Math.min(nearest, closest.distanceTo(center));
  }
}
assert.ok(weapon.box.containsPoint(center) && nearest < .04, 'the fallback receiver source belongs to the actual shipped weapon geometry');

for (const [anchor, ending] of [[null, 'finish'], [[.02, .31, -.55], 'finish'], [null, 'death'], [null, 'reset']]) {
  const models = new Map(originalModels);
  if (anchor) models.set('mg42', { ...weapon, anchors: { ...weapon.anchors, receiver: anchor } });
  const local = new THREE.Vector3(...(anchor || fallback)), baseYaw = .4;
  const f = aiFixture({ soldierModel: rig, models, player: [2 + 20 * Math.sin(baseYaw), 3 + 20 * Math.cos(baseYaw)], definitions: [soldier(2, 3, { type: 'mg', yaw: baseYaw * 180 / Math.PI, gun: [2, 1.1, 3, baseYaw], arc: 1 })] });
  const { G, enemies } = f, e = enemies.list[0], samples = [];
  let source = null, profile = null, pointIdentity = null, cancelled = 0, finished = 0;
  G.audio.reloadActor = (_kind, getter, options) => {
    source = getter; profile = options;
    return {
      advance() {
        const point = source(); pointIdentity ??= point;
        assert.equal(point, pointIdentity, 'mounted reloads reuse one source vector');
        e.mg.mesh.updateMatrixWorld(true);
        const expected = local.clone().applyMatrix4(e.mg.mesh.matrixWorld);
        assert.ok(point.distanceTo(expected) < 1e-6, 'the source follows the actual receiver mesh during traverse');
        const hand = e.char.boneWorld('hand_r', new THREE.Vector3());
        samples.push({ point: point.clone(), hand, stance: e.stance, yaw: e.mg.mesh.rotation.y });
      }, cancel() { cancelled++; }, finish() { finished++; },
    };
  };
  advance(G, enemies, .3); forceCombat(e, G); e.sees = true; e.exposure = 1; e.perceiveTimer = 1e6; e.mag = 1; e.aimTimer = 0; e.fireTimer = 0;
  advance(G, enemies, .1); e.fireTimer = 1e6;
  assert.ok(source && e.mg, 'emptying the real mounted weapon starts its actor-owned reload');
  assert.equal(profile.heightOffset, 0); assert.equal(profile.duration, e.reloadTotal);
  advance(G, enemies, 1);
  G.player.pos.set(2 + 20 * Math.sin(baseYaw + .35), 0, 3 + 20 * Math.cos(baseYaw + .35)); e.perceiveTimer = 0; advance(G, enemies, .8);
  G.player.pos.set(2 + 20 * Math.sin(baseYaw - .35), 0, 3 + 20 * Math.cos(baseYaw - .35)); e.perceiveTimer = 0; advance(G, enemies, .8);
  assert.ok(samples.some(s => s.stance === 'crouch' && s.point.y - s.hand.y > .2), 'the receiver stays raised while the real operator ducks below it');
  assert.ok(Math.max(...samples.map(s => s.yaw)) - Math.min(...samples.map(s => s.yaw)) > .3, 'the fixture actually traverses the mount');
  assert.ok(samples.some(s => s.point.distanceTo(samples[0].point) > .12), 'the receiver source moves with that real traverse');
  if (ending === 'finish') {
    advance(G, enemies, e.reloadT + .1);
    assert.equal(finished, 1); assert.equal(cancelled, 0); assert.equal(e.mag, e.wdef.mag); assert.equal(e.reloadAudio, null);
  } else {
    const calls = samples.length;
    G.player.visible = 0; e.perceiveTimer = 1e6;
    if (ending === 'death') {
      e.damage(1000, G.player.pos, 'body', true);
      const mount = e.mg; Object.defineProperty(e, 'mg', { configurable: true, get() { throw new Error('Dead mounted reload read geometry'); } });
      assert.equal(source(), null, 'death short-circuits mounted source work'); Object.defineProperty(e, 'mg', { configurable: true, writable: true, value: mount });
    } else enemies.resetLiving();
    assert.equal(cancelled, 1); advance(G, enemies, 6);
    assert.equal(samples.length, calls); assert.equal(finished, 0); assert.equal(e.reloadAudio, null);
  }
  for (const actor of enemies.list) actor.char.dispose();
}
console.log('ok    actual mounted MG receiver/future anchors follow traverse while the operator crouches');
console.log('ok    mounted reload finish/death/retry retain the existing actor lifecycle and dead short-circuit');
