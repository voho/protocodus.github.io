import Matter from './vendor/matter.min.js';

const { Body, Bodies, Composite, Constraint, Sleeping } = Matter;
const wrap = (angle) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));

// The torso and the two independently colliding boots share a collision group.
// Each hip is pinned to its boot, but the joint can freely rotate during a fall.
export function addGuardRig(sim, x, floor) {
  const group = Body.nextGroup(true);
  const options = {
    collisionFilter: { group },
    friction: 0.86,
    frictionStatic: 1.2,
    frictionAir: 0.002,
    density: 0.00132,
    slop: 0.025,
    restitution: 0.025,
    sleepThreshold: 120,
  };
  const legLength = 11;
  const y = floor - 19.5;
  const torso = Bodies.rectangle(x, y, 23.5, 20.5, { ...options, chamfer: { radius: 3.7 } });
  const guard = sim.add('orc', 'orc', x, y, 24, 30, 'guard', {}, torso);
  const legs = [-1, 1].map((side) => {
    const offset = side * 6.2;
    const body = Bodies.rectangle(x + offset, floor - legLength / 2, 8.8, legLength, {
      ...options,
      chamfer: { radius: 1.3 },
    });
    body.plugin.fortress = guard;
    const hip = Constraint.create({
      bodyA: torso, pointA: { x: offset, y: 8.5 },
      bodyB: body, pointB: { x: 0, y: -legLength / 2 },
      length: 0, stiffness: 0.91, damping: 0.16,
    });
    Composite.add(sim.engine.world, [body, hip]);
    return { body, hip };
  });
  guard.rig = { legs, grounded: true, still: 0, resting: false, support: null };
  sim.guards.add(guard);
  return guard;
}

export function removeGuardRig(sim, guard) {
  for (const { body, hip } of guard.rig.legs) {
    body.plugin.fortress = null;
    Composite.remove(sim.engine.world, hip);
    Composite.remove(sim.engine.world, body);
  }
  sim.guards.delete(guard);
}

export function wakeGuardRig(sim, guard) {
  sim.resumePhysics();
  const rig = guard.rig;
  if (rig.resting) {
    for (const leg of rig.legs) Composite.add(sim.engine.world, leg.hip);
    rig.resting = false;
    rig.still = 0;
  }
  if (guard.body.isSleeping) Sleeping.set(guard.body, false);
  for (const leg of rig.legs) if (leg.body.isSleeping) Sleeping.set(leg.body, false);
}

function restBody(body) {
  // Matter carries the previous hip correction into its next constraint pass.
  body.constraintImpulse.x = body.constraintImpulse.y = body.constraintImpulse.angle = 0;
  Sleeping.set(body, true);
}

export function balanceGuards(sim) {
  const guards = sim.guards, pairs = sim.engine.pairs.list;
  let awake = false;
  for (const guard of guards) {
    const rig = guard.rig;
    if (rig.resting) {
      const hit = !guard.body.isSleeping || rig.legs.some((leg) => !leg.body.isSleeping);
      if (!hit && (!rig.support || rig.support.isStatic || rig.support.speed < 0.13)) continue;
      wakeGuardRig(sim, guard);
    }
    rig.grounded = false;
    rig.support = null;
    awake = true;
  }
  if (!awake) return;
  for (const pair of pairs) {
    if (!pair.isActive || pair.isSensor) continue;
    const { parentA, parentB, normal } = pair.collision;
    if (Math.abs(normal.y) < 0.55) continue;
    const upper = normal.y < 0 ? parentA : parentB;
    const rig = upper.plugin.fortress?.rig;
    if (rig && !rig.resting) {
      rig.grounded = true;
      rig.support = upper === parentA ? parentB : parentA;
    }
  }
  for (const guard of guards) {
    const torso = guard.body;
    const rig = guard.rig, { legs, grounded } = rig;
    if (rig.resting) continue;
    // At rest the solver no longer needs to iterate these two taut pins.
    // Restore them as soon as any part is struck or its support moves away.
    const stable = grounded && Math.abs(wrap(torso.angle)) < 0.17 && torso.speed < 0.14 &&
      rig.support.speed < 0.11 && legs.every(({body}) => body.speed < 0.14 && Math.abs(body.angularVelocity) < 0.025);
    rig.still = stable ? rig.still + 1 : 0;
    if (rig.still >= 24) {
      for (const leg of legs) {
        Composite.remove(sim.engine.world, leg.hip);
        restBody(leg.body);
      }
      restBody(torso);
      rig.resting = true;
      continue;
    }
    const spin = Body.getAngularVelocity(torso);
    if (grounded && !torso.isSleeping) {
      Body.setAngularVelocity(torso, spin * 0.76 - wrap(torso.angle) * 0.055);
    }
    for (const { body } of legs) {
      if (body.isSleeping) continue;
      const v = Body.getAngularVelocity(body);
      if (grounded) Body.setAngularVelocity(body, v * 0.72 - wrap(body.angle) * 0.072);
      else {
        // The hip only resists extreme bends in midair. Gravity and collisions
        // swing the legs independently of the spinning torso.
        const bend = wrap(body.angle - torso.angle);
        const limit = Math.max(-0.95, Math.min(0.95, bend));
        Body.setAngularVelocity(body, v - (v - spin) * 0.032 - (bend - limit) * 0.065);
      }
    }
  }
}
