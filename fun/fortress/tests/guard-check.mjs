import assert from 'node:assert/strict';
import Matter from '../vendor/matter.min.js';
import { addGuardRig, wakeGuardRig } from '../guard-rig.js';
import { FortressSimulation } from '../simulation.js';

const sim = new FortressSimulation('small', 1);
for (const e of sim.bodies) sim.remove(e);
sim.fire('small-stone', 42, 50);
sim.remove([...sim.projectiles][0]);
const platform = sim.add('block', 'stone', 300, 300, 100, 10, 'test platform', { isStatic: true });
const guard = addGuardRig(sim, 300, platform.body.bounds.min.y);
const step = (frames) => { for (let i = 0; i < frames; i++) sim.update(1 / 60); };
step(150);
assert.ok(guard.rig.resting && guard.rig.grounded);
for (const { body } of guard.rig.legs) {
  assert.ok(Math.abs(body.bounds.max.y - platform.body.bounds.min.y) < 0.5, 'Both boots stand on the platform');
}

wakeGuardRig(sim, guard);
Matter.Body.setAngle(guard.body, 0.12);
step(120);
assert.ok(!guard.fainted && Math.abs(guard.body.angle) < 0.05, 'A grounded guard recovers its upright stance');
const standingY = guard.y;
sim.remove(platform);
step(1);
Matter.Body.setAngularVelocity(guard.body, 0.14);
step(12);
assert.ok(!guard.rig.grounded && guard.y > standingY + 10, 'An unsupported guard falls under gravity');
assert.ok(guard.rig.legs.every(({ body }) => Math.abs(body.angle - guard.body.angle) > 0.25),
  'The hip joints let the legs swing relative to the torso in flight');
sim.faint(guard);
assert.ok(!sim.guards.has(guard) && !sim.entities.has(guard.id));
assert.ok(guard.rig.legs.every(({ hip, body }) => !sim.engine.world.constraints.includes(hip) &&
  !sim.engine.world.bodies.includes(body)), 'Both joints and boots disappear when the guard faints');
