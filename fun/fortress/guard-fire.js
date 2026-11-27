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
    chip.side = shot.side;
    chip.vertices = vertices;
    chip.contacts = new Set();
    chip.countered = true;
    sim.projectiles.add(chip);
    Body.setVelocity(piece, { x: v.x * 0.89 + side * 0.45, y: v.y * 0.92 + side * 1.75 });
    Body.setAngularVelocity(piece, side * 0.13);
  }
}

export function createGuardDefense(sim, blocksRay) {
  const bolts = sim.guardBolts = [];
  const boltSpeed = 1120;
  const recovery = 2.6;
  // Each approach to the new layouts has a watch. Older sieges share one
  // firing cycle across the garrison to preserve their recorded shots.
  const watches = (sim.level.version >= 3 ? ['left', 'right'] : [null])
    .map(side => ({ side, aiming: null, nextLook: 0 }));
  let randomState = (sim.seed ^ 0xb83c62a9) >>> 0;
  const nextRandomState = () => (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  function random() {
    randomState = nextRandomState();
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

  function strike(shot) {
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
  }

  function leadAngle(guard, shot, muzzle, drawTime = 0) {
    const pos = shot.body.position, v = Body.getVelocity(shot.body);
    const vx = v.x * 60, vy = v.y * 60;
    const dx = pos.x - muzzle.x, dy = pos.y - muzzle.y;
    const distanceAt = t => Math.hypot(dx + vx * t, dy + vy * t + 340 * t ** 2);
    let t = drawTime + Math.min(0.24, distanceAt(drawTime) / boltSpeed);
    // Stones often pass above a field post during the draw. Recheck their
    // distance at the projected meeting point before applying the usual scatter.
    if (guard.exterior) t = drawTime + Math.min(0.3, distanceAt(t) / boltSpeed);
    return Math.atan2(dy + vy * t + 340 * t * t, dx + vx * t);
  }

  // Intersect the two paths in the shot's moving frame. A fast rock and bolt
  // can cross without overlapping at either end of a physics step.
  function contactTime(bolt, dx, dy, shot) {
    const { body, radius } = shot, prev = body.positionPrev;
    const sx = bolt.x - prev.x, sy = bolt.y - prev.y;
    const vx = dx - (body.position.x - prev.x), vy = dy - (body.position.y - prev.y);
    const speed2 = vx * vx + vy * vy, radius2 = (radius + 1) ** 2;
    if (sx * sx + sy * sy <= radius2) return 0;
    if (!speed2) return Infinity;
    const closest = -(sx * vx + sy * vy) / speed2;
    const chord2 = radius2 - (sx + vx * closest) ** 2 - (sy + vy * closest) ** 2;
    if (closest < 0 || chord2 < 0) return Infinity;
    return closest - Math.sqrt(chord2 / speed2);
  }

  function advanceBolts(dt) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const bolt = bolts[i], step = Math.min(bolt.remaining, bolt.speed * dt);
      const dx = bolt.dirX * step, dy = bolt.dirY * step;
      let first = 1, target;
      if (!bolt.replay) {
        for (const shot of sim.projectiles) {
          const entry = contactTime(bolt, dx, dy, shot);
          if (entry <= first) { first = entry; target = shot; }
        }
      }
      const end = { x: bolt.x + dx * first, y: bolt.y + dy * first };
      const clear = clearShot(bolt, end);
      if (clear && target) strike(target);
      bolt.remaining -= step;
      if (target || !clear || bolt.remaining <= 0) bolts.splice(i, 1);
      else { bolt.x = end.x; bolt.y = end.y; }
    }
  }

  function launch(guard, muzzle, angle, range, speed, replay = false) {
    guard.drawingBolt = false;
    const dirX = Math.cos(angle), dirY = Math.sin(angle);
    guard.gunAngle = angle;
    guard.firedAt = sim.time;
    if (bolts.length >= 8) bolts.shift();
    bolts.push({ ...muzzle, dirX, dirY, guardId: guard.id, born: sim.time, remaining: range, speed, replay });
    Object.assign(sim.emit('guard-shot', guard, 0.62, muzzle), { projectile: true, dirX, dirY });
  }

  function updateWatch(watch, dt) {
    const { aiming } = watch;
    if (aiming && (!sim.projectiles.has(aiming.shot) || !sim.entities.has(aiming.guard.id))) {
      aiming.guard.drawingBolt = false;
      if (watch.side) {
        watch.aiming = null;
        watch.nextLook = sim.time + 0.1;
        return;
      }
    }
    // Original keep links record their interception on the third 50 ms guard
    // tick. Release the visible bolt during the draw so it reaches that beat.
    if (sim.level.version === 1 && aiming && !aiming.launched && sim.time >= aiming.guard.drawStartedAt + 0.045) {
      const { guard, shot } = aiming;
      aiming.launched = true;
      const line = sim.entities.has(shot.id) && sight(guard, shot);
      if (line) {
        const flight = Math.max(dt, guard.drawStartedAt + 0.15 - sim.time);
        const v = Body.getVelocity(shot.body);
        const dx = shot.body.position.x + v.x * 60 * flight - line.muzzle.x;
        const dy = shot.body.position.y + v.y * 60 * flight + 340 * flight * flight - line.muzzle.y;
        const range = Math.hypot(dx, dy);
        const nextRandom = nextRandomState() / 4294967296;
        const angle = Math.atan2(dy, dx) + (nextRandom - 0.5) * 0.19;
        launch(guard, line.muzzle, angle, range, range / flight, true);
      }
    }
    if (sim.ticks % 6 || sim.time < watch.nextLook || !sim.projectiles.size || !sim.orcsRemaining) return;
    if (!aiming) {
      watch.nextLook = sim.time + 0.1;
      for (const shot of sim.projectiles) {
        if ((watch.side && shot.side !== watch.side) ||
            shot.countered || shot.contacts.size || shot.lastImpact >= 0 || shot.body.speed < 2 ||
            sim.time - shot.born < 0.18 || (sim.difficulty === 'small' && sim.shots % 3 !== 0)) continue;
        for (const guard of sim.guards) {
          if (watch.side && (guard.drawingBolt || sim.time - (guard.firedAt ?? -Infinity) < recovery)) continue;
          const line = sight(guard, shot);
          if (!line) continue;
          shot.countered = true;
          guard.gunAngle = leadAngle(guard, shot, line.muzzle, 0.15);
          guard.drawStartedAt = sim.time;
          guard.drawingBolt = true;
          guard.aimingUntil = sim.time + 0.12;
          watch.aiming = { guard, shot };
          watch.nextLook = guard.aimingUntil;
          return;
        }
      }
      return;
    }
    const { guard, shot } = aiming;
    watch.aiming = null;
    guard.drawingBolt = false;
    watch.nextLook = sim.time + recovery;
    if (!sim.entities.has(shot.id) || shot.contacts.size || shot.lastImpact >= 0) return;
    const line = sight(guard, shot);
    if (!line) return;
    const error = (random() - 0.5) * 0.19;
    if (sim.level.version === 1) {
      if (Math.abs(Math.sin(error)) * line.distance <= shot.radius) strike(shot);
      return;
    }
    const angle = leadAngle(guard, shot, line.muzzle) + error;
    launch(guard, line.muzzle, angle, 380, boltSpeed);
  }

  return function defend(dt = 1 / 120) {
    if (bolts.length) advanceBolts(dt);
    for (const watch of watches) updateWatch(watch, dt);
  };
}
