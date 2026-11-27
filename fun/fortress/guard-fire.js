// A sentry has time for one countershot per volley. Cover, range and a short
// aiming pause leave room for low shots, high arcs and fast follow-up stones.
import Matter from './vendor/matter.min.js';
const { Bodies, Body, Vertices } = Matter;

export function splitShot(sim, shot) {
  const { body, radius: r } = shot;
  const v = Body.getVelocity(body);
  sim.remove(shot);
  for (const side of [-1, 1]) {
    const shape = [{ x: -r * 0.8, y: 0 }, { x: -r * 0.48, y: side * r * 0.8 },
      { x: r * 0.36, y: side * r * 0.94 }, { x: r * 0.91, y: 0 }];
    const center = Vertices.centre(shape);
    const vertices = shape.map((p) => ({ x: p.x - center.x, y: p.y - center.y }));
    const x = body.position.x + center.x, y = body.position.y + center.y + side;
    const piece = Bodies.fromVertices(x, y, [vertices], { frictionAir: 0, restitution: 0.12 });
    Body.setMass(piece, body.mass / 2);
    const chip = sim.add('projectile', 'stone', x, y, r * 1.72, r, 'split-shot', { radius: r * 0.85 }, piece);
    chip.vertices = vertices;
    chip.contacts = new Set();
    chip.countered = true;
    sim.projectiles.add(chip);
    Body.setVelocity(piece, { x: v.x * 0.89 + side * 0.45, y: v.y * 0.92 + side * 1.75 });
    Body.setAngularVelocity(piece, side * 0.13);
  }
}

export function createGuardDefense(sim, blocksRay) {
  let aiming = null, nextLook = 0;
  let randomState = (sim.seed ^ 0xb83c62a9) >>> 0;
  function random() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }

  function clearShot(start, end) {
    for (const hill of sim.hills) if (blocksRay(hill, start, end)) return false;
    for (const e of sim.entities.values()) {
      if ((e.kind === 'block' || e.kind === 'fragment') && blocksRay(e.body, start, end)) return false;
    }
    return true;
  }

  function sight(guard, shot) {
    if (!sim.entities.has(guard.id) || guard.body.speed > 1.6 || Math.abs(guard.body.angle) > 0.55) return;
    const target = shot.body.position, pos = guard.body.position;
    const muzzle = { x: pos.x + (target.x < pos.x ? -10 : 10), y: pos.y - 2 };
    const dx = target.x - muzzle.x, dy = target.y - muzzle.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 22 || distance > 310 || !clearShot(muzzle, target)) return;
    return { muzzle, distance, angle: Math.atan2(dy, dx) };
  }

  return function defend() {
    if (sim.ticks % 6 || sim.time < nextLook || !sim.projectiles.size || !sim.orcsRemaining) return;
    if (!aiming) {
      nextLook = sim.time + 0.1;
      for (const shot of sim.projectiles) {
        if (shot.countered || shot.contacts.size || shot.lastImpact >= 0 || shot.body.speed < 2 ||
            sim.time - shot.born < 0.18 || (sim.difficulty === 'small' && sim.shots % 3 !== 0)) continue;
        for (const guard of sim.guards) {
          const line = sight(guard, shot);
          if (!line) continue;
          shot.countered = true;
          guard.gunAngle = line.angle;
          guard.aimingUntil = sim.time + 0.12;
          aiming = { guard, shot };
          nextLook = guard.aimingUntil;
          return;
        }
      }
      return;
    }
    const { guard, shot } = aiming;
    aiming = null;
    nextLook = sim.time + 2.6;
    if (!sim.entities.has(shot.id) || shot.contacts.size || shot.lastImpact >= 0) return;
    const line = sight(guard, shot);
    if (!line) return;
    const error = (random() - 0.5) * 0.19;
    const angle = line.angle + error;
    const hit = Math.abs(Math.sin(error)) * line.distance <= shot.radius;
    const range = line.distance - (hit ? shot.radius * 0.55 : 0);
    guard.gunAngle = angle;
    guard.firedAt = sim.time;
    const event = sim.emit('guard-shot', guard, 0.62, line.muzzle);
    event.endX = line.muzzle.x + range * Math.cos(angle);
    event.endY = line.muzzle.y + range * Math.sin(angle);
    if (!hit) return;
    if (shot.blast || shot.flameRadius) {
      sim.explode(shot);
      return;
    }
    sim.emit('impact', shot, 0.43).material = shot.implosionRadius ? 'steel' : 'stone';
    if (!shot.implosionRadius && random() < 0.46) splitShot(sim, shot);
    else {
      const v = Body.getVelocity(shot.body);
      const turn = (random() < 0.5 ? -1 : 1) * (0.13 + random() * 0.15);
      Body.setVelocity(shot.body, {
        x: (v.x * Math.cos(turn) - v.y * Math.sin(turn)) * 0.94,
        y: (v.x * Math.sin(turn) + v.y * Math.cos(turn)) * 0.94,
      });
      shot.flightPath = null;
    }
  };
}
