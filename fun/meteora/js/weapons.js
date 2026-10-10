/* Meteora — plasma cannons and guided missiles.

   A bolt leaves the muzzle at the gun's speed plus the ship's own velocity:
   in vacuum nothing takes that momentum away, so a fighter strafing at
   60 m/s throws its fire 60 m/s sideways too. That is why the HUD's lead
   pip solves the intercept in the shooter's frame. At 1 000 m/s a bolt
   crosses eight metres per step, more than the smallest rock is wide, so
   every hit test sweeps the segment the bolt travelled, never its point.

   Missiles steer by the zero-effort-miss form of proportional navigation:
   predict where the target will be if nobody manoeuvres, and push sideways
   in proportion to how far that miss would be. It hits a target pulling
   3 g from head-on, crossing and tail-chase geometries. The proximity fuse
   is checked over the whole step for the same reason the bolts are swept:
   closing at 800 m/s, two samples can straddle the target. */

import { MISSILE } from './config.js';
import { addScaled, cross, dot, len, normalize, qRotate, scale, sub } from './vec.js';

export function createWeapons() { return { bolts: [], missiles: [], nextId: 1 }; }

export function createGun(params) {
  return { params, heat: 0, overheated: false, cooldown: 0, muzzle: 0 };
}

// Returns the number of shots fired this step (0 or 1) and alternates muzzles.
export function triggerGun(gun, firing, dt) {
  const P = gun.params;
  gun.heat = Math.max(0, gun.heat - P.cool * dt);
  // The lock is decided before the trigger, so the shot that crosses the
  // line still leaves and the next one is the first refused.
  if (gun.heat >= P.lockAt) gun.overheated = true;
  else if (gun.overheated && gun.heat <= P.releaseAt) gun.overheated = false;
  gun.cooldown -= dt;
  if (firing && !gun.overheated && gun.cooldown <= 0) {
    gun.cooldown += 1 / P.rate;
    if (gun.cooldown < 0) gun.cooldown = 0;
    gun.heat += P.heat;
    gun.muzzle ^= 1;
    return 1;
  }
  if (!firing) gun.cooldown = Math.max(gun.cooldown, 0);
  return 0;
}

const tmp = [0, 0, 0];

/* Gimballed guns: the barrels swing toward `aim` but never more than
   `params.gimbal` off the nose. Outside the cone the shot leaves along the
   cone's edge, on the side of the aim. */
export function gimbal(fwd, aim, limit) {
  if (!aim || !(limit > 0)) return fwd;
  const a = normalize([0, 0, 0], aim);
  const cos = dot(a, fwd);
  if (cos >= Math.cos(limit)) return a;
  let side = addScaled([0, 0, 0], a, fwd, -cos);
  // Aim exactly behind: any direction off the nose is as good as another.
  if (len(side) < 1e-9) side = cross(side, fwd, Math.abs(fwd[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  normalize(side, side);
  return addScaled([0, 0, 0], scale([0, 0, 0], fwd, Math.cos(limit)), side, Math.sin(limit));
}

export function fireBolt(weapons, shooter, muzzleLocal, params, aim = null) {
  const s = shooter.ship;
  const pos = addScaled([0, 0, 0], s.pos, qRotate(tmp, s.q, muzzleLocal), 1);
  const fwd = qRotate([0, 0, 0], s.q, [0, 0, -1]);
  const dir = gimbal(fwd, aim, params.gimbal);
  const bolt = {
    id: weapons.nextId++, team: shooter.team, ownerId: shooter.id,
    pos, prev: [...pos], vel: addScaled([0, 0, 0], s.vel, dir, params.speed),
    life: params.life, damage: params.damage, radius: params.radius,
  };
  weapons.bolts.push(bolt);
  return bolt;
}

export function createLock() { return { targetId: null, progress: 0, locked: false }; }

export function updateLock(lock, ship, target, dt) {
  if (!target || !target.alive) {
    lock.targetId = null; lock.progress = 0; lock.locked = false;
    return lock;
  }
  if (lock.targetId !== target.id) { lock.targetId = target.id; lock.progress = 0; lock.locked = false; }
  const to = sub([0, 0, 0], target.ship.pos, ship.pos);
  const range = len(to);
  const fwd = qRotate([0, 0, 0], ship.q, [0, 0, -1]);
  const angle = range > 1e-6 ? Math.acos(Math.min(1, Math.max(-1, dot(to, fwd) / range))) : 0;
  if (range <= MISSILE.lockRange && angle <= MISSILE.lockCone) {
    lock.progress = Math.min(1, lock.progress + dt / MISSILE.lockTime);
  } else {
    lock.progress = 0;
  }
  lock.locked = lock.progress >= 1 - 1e-9;
  return lock;
}

export function launchMissile(weapons, shooter, launcherLocal, targetId) {
  const s = shooter.ship;
  const fwd = qRotate([0, 0, 0], s.q, [0, 0, -1]);
  const pos = addScaled([0, 0, 0], s.pos, qRotate(tmp, s.q, launcherLocal), 1);
  const missile = {
    id: weapons.nextId++, team: shooter.team, ownerId: shooter.id, targetId: targetId ?? null,
    pos, prev: [...pos], vel: addScaled([0, 0, 0], s.vel, fwd, MISSILE.launchKick),
    frameVel: [...s.vel], heading: fwd, age: 0, motor: false,
  };
  weapons.missiles.push(missile);
  return missile;
}

export const blastDamage = d => Math.max(0, MISSILE.damage * (1 - d / MISSILE.blast));

/* Intercept point for a shot that inherits the shooter's velocity: the
   smallest t > 0 with |r + vr·t| = speed·t, in the shooter's frame. */
export function leadPoint(o, shooterPos, shooterVel, targetPos, targetVel, speed) {
  const rx = targetPos[0] - shooterPos[0], ry = targetPos[1] - shooterPos[1], rz = targetPos[2] - shooterPos[2];
  const vx = targetVel[0] - shooterVel[0], vy = targetVel[1] - shooterVel[1], vz = targetVel[2] - shooterVel[2];
  const a = vx * vx + vy * vy + vz * vz - speed * speed;
  const b = 2 * (rx * vx + ry * vy + rz * vz);
  const c = rx * rx + ry * ry + rz * rz;
  let t;
  if (Math.abs(a) < 1e-9) {
    if (b >= 0) return null;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
    if (!Number.isFinite(t)) return null;
  }
  o[0] = shooterPos[0] + rx + vx * t;
  o[1] = shooterPos[1] + ry + vy * t;
  o[2] = shooterPos[2] + rz + vz * t;
  return o;
}

/* ZEM guidance: the sideways push that cancels the predicted miss by the
   time of closest approach. Opening or crawling geometry falls back to pure
   pursuit, which swings the heading onto the line of sight at full turn. */
export function guidanceAccel(o, mPos, mVel, tPos, tVel, N, maxA, heading) {
  const r = sub([0, 0, 0], tPos, mPos);
  const range = len(r);
  if (range < 1e-6) return scale(o, o, 0);
  const rHat = scale([0, 0, 0], r, 1 / range);
  const vr = sub([0, 0, 0], tVel, mVel);
  const closing = -dot(r, vr) / range;
  if (closing <= 1) {
    addScaled(o, rHat, heading, -dot(rHat, heading));
    normalize(o, o);
    return scale(o, o, maxA);
  }
  const tgo = range / closing;
  const zem = addScaled([0, 0, 0], r, vr, tgo);
  addScaled(o, zem, rHat, -dot(zem, rHat));
  scale(o, o, N / (tgo * tgo));
  const mag = len(o);
  if (mag > maxA) scale(o, o, maxA / mag);
  return o;
}

// Closest approach between a point moving p0→p1 and a fixed centre c.
function closest(p0, p1, c) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const A = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (A > 1e-12) {
    t = ((c[0] - p0[0]) * dx + (c[1] - p0[1]) * dy + (c[2] - p0[2]) * dz) / A;
    t = Math.min(1, Math.max(0, t));
  }
  const x = p0[0] + dx * t - c[0], y = p0[1] + dy * t - c[1], z = p0[2] + dz * t - c[2];
  return { t, d: Math.sqrt(x * x + y * y + z * z) };
}

function segmentSphereT(p0, p1, c, R) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const mx = p0[0] - c[0], my = p0[1] - c[1], mz = p0[2] - c[2];
  const C = mx * mx + my * my + mz * mz - R * R;
  if (C <= 0) return 0;
  const A = dx * dx + dy * dy + dz * dz;
  if (A < 1e-12) return -1;
  const B = 2 * (mx * dx + my * dy + mz * dz);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : -1;
}

// Rock events carry the shooter's team so only the player's breaks score.
function damageRockTagged(ctx, ref, amount, point, impulse, team) {
  const out = [];
  const result = ctx.field.damageRock(ref, amount, point, impulse, out);
  for (const e of out) { e.team = team; ctx.events.push(e); }
  return result;
}

function explode(ctx, m, point, targetId, kind) {
  ctx.events.push({ type: kind, pos: [...point], targetId: targetId ?? null, team: m.team });
  for (const e of ctx.entities) {
    if (!e.alive) continue;
    const toward = sub([0, 0, 0], e.ship.pos, point);
    const amount = blastDamage(len(toward));
    if (amount > 0) ctx.damage(e, amount, [...point], normalize(toward, toward));
  }
  for (const h of ctx.field.queryRadius(point, MISSILE.blast)) {
    const toward = sub([0, 0, 0], h.pos, point);
    const amount = blastDamage(Math.max(0, len(toward) - h.radius));
    if (amount > 0) {
      normalize(toward, toward);
      damageRockTagged(ctx, h, amount, point, scale(toward, toward, amount * 60), m.team);
    }
  }
}

const hitPoint = [0, 0, 0], aGuide = [0, 0, 0], rel = [0, 0, 0];

export function stepWeapons(weapons, ctx, dt) {
  const { field, entities } = ctx;

  for (let i = weapons.bolts.length - 1; i >= 0; i--) {
    const b = weapons.bolts[i];
    b.prev[0] = b.pos[0]; b.prev[1] = b.pos[1]; b.prev[2] = b.pos[2];
    addScaled(b.pos, b.pos, b.vel, dt);
    b.life -= dt;
    let bestT = Infinity, hit = null;
    const rock = field.sweepSphere(b.prev, b.pos, b.radius);
    if (rock) { bestT = rock.t; hit = { kind: 'rock', rock }; }
    for (const e of entities) {
      if (!e.alive || e.team === b.team) continue;
      const t = segmentSphereT(b.prev, b.pos, e.ship.pos, e.radius + b.radius);
      if (t >= 0 && t < bestT) { bestT = t; hit = { kind: 'ship', entity: e }; }
    }
    if (hit) {
      addScaled(hitPoint, b.prev, sub(tmp, b.pos, b.prev), bestT);
      const point = [...hitPoint];
      const dir = normalize([0, 0, 0], b.vel);
      if (hit.kind === 'rock') {
        damageRockTagged(ctx, hit.rock.ref, b.damage, point, scale([0, 0, 0], dir, b.damage * 20), b.team);
        ctx.events.push({ type: 'boltHit', pos: point, normal: hit.rock.normal, kind: 'rock', team: b.team });
      } else {
        const normal = normalize([0, 0, 0], sub([0, 0, 0], point, hit.entity.ship.pos));
        const shielded = (hit.entity.shield ?? 0) > 0;
        ctx.damage(hit.entity, b.damage, point, dir);
        ctx.events.push({
          type: 'boltHit', pos: point, normal, kind: 'ship', shielded, team: b.team, targetId: hit.entity.id,
        });
      }
      weapons.bolts.splice(i, 1);
    } else if (b.life <= 0) {
      weapons.bolts.splice(i, 1);
    }
  }

  for (let i = weapons.missiles.length - 1; i >= 0; i--) {
    const m = weapons.missiles[i];
    m.age += dt;
    let target = null;
    if (m.targetId != null) {
      target = entities.find(e => e.id === m.targetId && e.alive) ?? null;
      if (!target) m.targetId = null;
    }
    sub(rel, m.vel, m.frameVel);
    m.motor = m.age > MISSILE.ignition;
    if (m.motor && len(rel) < MISSILE.maxSpeed) addScaled(m.vel, m.vel, m.heading, MISSILE.accel * dt);
    if (m.motor && target) {
      guidanceAccel(aGuide, m.pos, m.vel, target.ship.pos, target.ship.vel,
        MISSILE.navGain, MISSILE.maxLateral, m.heading);
      addScaled(aGuide, aGuide, m.heading, -dot(aGuide, m.heading));
      addScaled(m.vel, m.vel, aGuide, dt);
    }
    sub(rel, m.vel, m.frameVel);
    if (len(rel) > 1e-6) normalize(m.heading, rel);
    m.prev[0] = m.pos[0]; m.prev[1] = m.pos[1]; m.prev[2] = m.pos[2];
    addScaled(m.pos, m.pos, m.vel, dt);

    let fused = null;
    for (const e of entities) {
      if (!e.alive || e.team === m.team) continue;
      const c = closest(m.prev, m.pos, e.ship.pos);
      if (c.d <= MISSILE.fuse && (!fused || c.t < fused.t)) fused = { e, t: c.t };
    }
    const rock = field.sweepSphere(m.prev, m.pos, MISSILE.radius);
    if (rock && (!fused || rock.t < fused.t)) {
      explode(ctx, m, rock.point, null, 'missileExplode');
      weapons.missiles.splice(i, 1);
    } else if (fused) {
      const point = addScaled([0, 0, 0], m.prev, sub(tmp, m.pos, m.prev), fused.t);
      explode(ctx, m, point, fused.e.id, 'missileExplode');
      weapons.missiles.splice(i, 1);
    } else if (m.age >= MISSILE.life) {
      explode(ctx, m, m.pos, null, 'missileExpire');
      weapons.missiles.splice(i, 1);
    }
  }
}
