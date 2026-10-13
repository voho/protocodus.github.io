/* Meteora — bolts, flak, missiles and torpedoes.

   A bolt leaves the muzzle at the gun's speed plus the ship's own velocity:
   in vacuum nothing takes that momentum away, so a fighter strafing at
   60 m/s throws its fire 60 m/s sideways too. That is why the HUD's lead
   pip solves the intercept in the shooter's frame. At 1 000 m/s a bolt
   crosses eight metres per step, more than the smallest rock is wide, so
   every hit test sweeps the segment the bolt travelled, never its point:
   against rocks, against small craft (one sphere), against large ships (a
   set of spheres in their own frame, see compound.js) and against enemy
   torpedoes, which can be shot down. A flak shell is a bolt with a fuse:
   it bursts at the range it was set for, or as soon as a hostile fighter
   comes within its burst radius.

   Missiles steer by the zero-effort-miss form of proportional navigation:
   predict where the target will be if nobody manoeuvres, and push sideways
   in proportion to how far that miss would be. It hits a target pulling
   3 g from head-on, crossing and tail-chase geometries. The proximity fuse
   is checked over the whole step for the same reason the bolts are swept:
   closing at 800 m/s, two samples can straddle the target. Torpedoes have
   no proximity fuse: they home on a large target (or one of its
   subsystems) and burst on contact. */

import { MISSILE } from './config.js';
import { rockMass } from './field.js';
import { addScaled, cross, dot, len, normalize, qRotate, scale, sub } from './vec.js';
import { subsystemAt, subsystemWorld, surfaceDistance, sweepCompound, toLocal } from './compound.js';

export function createWeapons() { return { bolts: [], missiles: [], nextId: 1 }; }

export function createGun(params) {
  return { params, heat: 0, overheated: false, cooldown: 0, muzzle: 0 };
}

// Returns the number of shots fired this step (0 or 1) and alternates muzzles.
// `rateScale` slows or quickens the gun (difficulty).
export function triggerGun(gun, firing, dt, rateScale = 1) {
  const P = gun.params;
  gun.heat = Math.max(0, gun.heat - P.cool * dt);
  // The lock is decided before the trigger, so the shot that crosses the
  // line still leaves and the next one is the first refused.
  if (gun.heat >= P.lockAt) gun.overheated = true;
  else if (gun.overheated && gun.heat <= P.releaseAt) gun.overheated = false;
  gun.cooldown -= dt;
  if (firing && !gun.overheated && gun.cooldown <= 0) {
    gun.cooldown += 1 / (P.rate * rateScale);
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

/* `aim` is a world direction the gimbal swings toward. `dirOverride` fires
   along a given world direction from a world position instead (turrets). */
export function fireBolt(weapons, shooter, muzzleLocal, params, aim = null, { from = null, dir: dirOverride = null, fuse = Infinity, spread = 0, rng = null } = {}) {
  const s = shooter.ship;
  const pos = from ? [...from] : addScaled([0, 0, 0], s.pos, qRotate(tmp, s.q, muzzleLocal), 1);
  let dir;
  if (dirOverride) dir = normalize([0, 0, 0], dirOverride);
  else {
    const fwd = qRotate([0, 0, 0], s.q, [0, 0, -1]);
    dir = gimbal(fwd, aim, params.gimbal);
  }
  if (spread > 0 && rng) {
    const j = rng.unit([0, 0, 0]);
    addScaled(dir, dir, j, spread * rng.gauss());
    normalize(dir, dir);
  }
  const bolt = {
    id: weapons.nextId++, team: shooter.team, ownerId: shooter.id,
    pos, prev: [...pos], vel: addScaled([0, 0, 0], s.vel, dir, params.speed),
    life: params.life, damage: params.damage, radius: params.radius, w: params,
    travelled: 0, fuse,
  };
  weapons.bolts.push(bolt);
  return bolt;
}

/* ---------- missile lock ---------- */

export function createLock() { return { targetId: null, subName: null, progress: 0, locked: false, valid: true, weapon: null }; }

const canLockOn = (params, target, sub) => params.lockOn !== 'large' || !!sub || !!target.big;

/* Builds while the target (or the subsystem) sits inside the weapon's cone
   and range; anything else resets it. A torpedo will only lock on large
   targets and subsystems. */
export function updateLock(lock, ship, target, dt, params = MISSILE, sub = null) {
  if (!target || !target.alive || target.folding) {
    lock.targetId = null; lock.subName = null; lock.progress = 0; lock.locked = false; lock.valid = true;
    return lock;
  }
  const subName = sub?.name ?? null;
  if (lock.targetId !== target.id || lock.subName !== subName || lock.weapon !== params) {
    lock.targetId = target.id; lock.subName = subName; lock.weapon = params; lock.progress = 0; lock.locked = false;
  }
  lock.valid = canLockOn(params, target, sub);
  const at = sub ? subsystemWorld([0, 0, 0], target, sub) : target.ship.pos;
  const to = sub_(at, ship.pos);
  const range = len(to);
  const fwd = qRotate([0, 0, 0], ship.q, [0, 0, -1]);
  const angle = range > 1e-6 ? Math.acos(Math.min(1, Math.max(-1, dot(to, fwd) / range))) : 0;
  // A large target fills more of the cone: lock on anywhere on it.
  const slack = target.big && !sub ? Math.atan2(target.radius * 0.6, Math.max(range, 1)) : 0;
  if (lock.valid && range <= params.lockRange + (target.big ? target.radius : 0) && angle <= params.lockCone + slack) {
    lock.progress = Math.min(1, lock.progress + dt / params.lockTime);
  } else {
    lock.progress = 0;
  }
  lock.locked = lock.progress >= 1 - 1e-9;
  return lock;
}
const sub_ = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/* ---------- missiles ---------- */

export function launchMissile(weapons, shooter, launcherLocal, targetId, params = MISSILE, { subName = null, dir = null, kind = null } = {}) {
  const s = shooter.ship;
  const fwd = dir ? normalize([0, 0, 0], dir) : qRotate([0, 0, 0], s.q, [0, 0, -1]);
  const pos = addScaled([0, 0, 0], s.pos, qRotate(tmp, s.q, launcherLocal), 1);
  const missile = {
    id: weapons.nextId++, team: shooter.team, ownerId: shooter.id, targetId: targetId ?? null, subName,
    kind: kind ?? (params.torpedo ? (params.harrow ? 'spike' : 'lance') : params.salvo ? 'swarm' : 'hornet'),
    p: params, hp: params.hp ?? 0, radius: params.radius ?? MISSILE.radius,
    pos, prev: [...pos], vel: addScaled([0, 0, 0], s.vel, fwd, params.launchKick),
    frameVel: [...s.vel], heading: fwd, age: 0, motor: false,
  };
  weapons.missiles.push(missile);
  return missile;
}

export const blastDamage = (d, p = MISSILE) => Math.max(0, p.damage * (1 - d / p.blast));
export const blastPush = (d, p = MISSILE) => Math.max(0, p.push * (1 - d / p.blast));

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

// Neutral things (team −1: boulders, wrecks) can be hit by anyone.
const hostile = (e, team) => e.alive && !e.folding && e.team !== team;
const larges = ctx => ctx.larges ?? ctx.entities.filter(e => e.big);
const smalls = ctx => ctx.smalls ?? ctx.entities.filter(e => !e.big);
const opts = (src, w, sub = null) => ({ weapon: w, sourceTeam: src.team, sourceId: src.ownerId, sub });

/* A blast: damage and push falling off with distance, to ships (from their
   centre, or a large ship's nearest surface), torpedoes and rocks. `hitId`
   already took the direct hit and is skipped. */
function blast(ctx, src, p, point, hitId) {
  for (const e of ctx.entities) {
    if (!e.alive || e.folding || e.id === hitId) continue;
    if (e.team === src.team && !p.friendlyBlast) continue;
    let d;
    if (e.big) d = Math.max(0, surfaceDistance(e, point));
    else {
      const toward = sub([0, 0, 0], e.ship.pos, point);
      d = len(toward);
      const push = blastPush(d, p);
      if (push > 0 && d > 1e-6 && !e.fixed) addScaled(e.ship.vel, e.ship.vel, toward, push / d / e.ship.stats.mass);
    }
    const amount = blastDamage(d, p);
    if (amount > 0) {
      const dir = normalize([0, 0, 0], sub([0, 0, 0], e.ship.pos, point));
      ctx.damage(e, amount, [...point], dir, opts(src, p));
    }
  }
  // Torpedoes caught in a blast are torn apart.
  if (ctx.missiles) {
    for (const m of ctx.missiles) {
      if (m.hp <= 0 || m === src || m.team === src.team) continue;
      const d = Math.hypot(m.pos[0] - point[0], m.pos[1] - point[1], m.pos[2] - point[2]);
      const amount = blastDamage(d, p);
      if (amount > 0) m.hp -= amount;
    }
  }
  for (const h of ctx.field.queryRadius(point, p.blast)) {
    const toward = sub([0, 0, 0], h.pos, point);
    const reach = Math.max(0, len(toward) - h.radius);
    const amount = blastDamage(reach, p);
    if (amount > 0) {
      normalize(toward, toward);
      if (h.kind === 'dynamic') addScaled(h.rock.vel, h.rock.vel, toward, blastPush(reach, p) / rockMass(h.rock.radius));
      damageRockTagged(ctx, h, amount * (p.rockMul ?? 1), point, scale(toward, toward, blastPush(reach, p)), src.team);
    }
  }
}

// `vel` is the velocity of what the missile hit (or its own, if it hit
// nothing), which the renderer's fireball carries on with.
function explode(ctx, m, point, kind, vel, direct = null) {
  const p = m.p;
  ctx.events.push({
    type: kind, pos: [...point], targetId: direct?.entity.id ?? null, team: m.team, vel: [...vel],
    weapon: m.kind, torpedo: !!p.torpedo,
  });
  if (direct) {
    // A torpedo's warhead goes off against the plating: the full charge to
    // the hull, or to the subsystem it struck.
    const dir = normalize([0, 0, 0], m.vel);
    ctx.damage(direct.entity, p.damage, [...point], dir, opts(m, p, direct.sub));
    blast(ctx, m, p, point, direct.entity.id);
  } else {
    blast(ctx, m, p, point, null);
  }
}

/* A flak shell bursts: area damage to hostile fighters and torpedoes. */
function burst(ctx, b) {
  const w = b.w, r = w.flak;
  ctx.events.push({ type: 'flak', pos: [...b.pos], team: b.team, vel: [0, 0, 0] });
  for (const e of smalls(ctx)) {
    if (!hostile(e, b.team)) continue;
    const d = Math.hypot(e.ship.pos[0] - b.pos[0], e.ship.pos[1] - b.pos[1], e.ship.pos[2] - b.pos[2]) - e.radius;
    if (d < r) ctx.damage(e, w.damage * (1 - Math.max(0, d) / r), [...b.pos], null, opts(b, w));
  }
  for (const m of ctx.missiles ?? []) {
    if (m.hp <= 0 || m.team === b.team) continue;
    const d = Math.hypot(m.pos[0] - b.pos[0], m.pos[1] - b.pos[1], m.pos[2] - b.pos[2]);
    if (d < r) m.hp -= w.damage * (1 - d / r);
  }
}

const hitPoint = [0, 0, 0], aGuide = [0, 0, 0], rel = [0, 0, 0], aimAt = [0, 0, 0];

export function stepWeapons(weapons, ctx, dt) {
  const { field } = ctx;
  ctx.missiles = weapons.missiles;
  const S = smalls(ctx), L = larges(ctx);

  for (let i = weapons.bolts.length - 1; i >= 0; i--) {
    const b = weapons.bolts[i];
    b.prev[0] = b.pos[0]; b.prev[1] = b.pos[1]; b.prev[2] = b.pos[2];
    addScaled(b.pos, b.pos, b.vel, dt);
    b.life -= dt;
    const step = len(b.vel) * dt;
    b.travelled += step;
    let bestT = Infinity, hit = null;
    const rock = field.sweepSphere(b.prev, b.pos, b.radius);
    if (rock) { bestT = rock.t; hit = { kind: 'rock', rock }; }
    for (const e of S) {
      if (!hostile(e, b.team)) continue;
      const t = segmentSphereT(b.prev, b.pos, e.ship.pos, e.radius + b.radius);
      if (t >= 0 && t < bestT) { bestT = t; hit = { kind: 'ship', entity: e }; }
    }
    for (const e of L) {
      if (!hostile(e, b.team)) continue;
      const h = sweepCompound(e, b.prev, b.pos, b.radius);
      if (h && h.t < bestT) { bestT = h.t; hit = { kind: 'large', entity: e, local: h.local }; }
    }
    for (const m of weapons.missiles) {
      if (m.hp <= 0 || m.team === b.team) continue;
      const t = segmentSphereT(b.prev, b.pos, m.pos, (m.p.hitRadius ?? m.radius) + b.radius);
      if (t >= 0 && t < bestT) { bestT = t; hit = { kind: 'missile', missile: m }; }
    }
    if (b.w.flak) {
      // Burst at the set range, or on a hostile fighter inside the radius.
      let near = b.travelled >= b.fuse;
      if (!near) {
        for (const e of S) {
          if (!hostile(e, b.team)) continue;
          const c = closest(b.prev, b.pos, e.ship.pos);
          if (c.d < b.w.flak * 0.5 + e.radius) { near = true; break; }
        }
      }
      if (near && (!hit || hit.kind === 'missile' || hit.kind === 'ship')) {
        burst(ctx, b);
        weapons.bolts.splice(i, 1);
        continue;
      }
    }
    if (hit) {
      addScaled(hitPoint, b.prev, sub(tmp, b.pos, b.prev), bestT);
      const point = [...hitPoint];
      const dir = normalize([0, 0, 0], b.vel);
      // Hits carry the velocity of what was hit, so their sparks move with it.
      if (hit.kind === 'rock') {
        damageRockTagged(ctx, hit.rock.ref, b.damage * (b.w.rockMul ?? 1), point, scale([0, 0, 0], dir, b.damage * 20), b.team);
        const vel = hit.rock.ref.rock ? [...hit.rock.ref.rock.vel] : [0, 0, 0];
        ctx.events.push({ type: 'boltHit', pos: point, normal: hit.rock.normal, kind: 'rock', team: b.team, vel, ownerId: b.ownerId });
      } else if (hit.kind === 'missile') {
        hit.missile.hp -= b.damage;
        ctx.events.push({ type: 'boltHit', pos: point, normal: scale([0, 0, 0], dir, -1), kind: 'hull', team: b.team, vel: [...hit.missile.vel], ownerId: b.ownerId });
      } else {
        const e = hit.entity;
        const sub2 = hit.kind === 'large' ? subsystemAt(e, hit.local) : null;
        const shielded = (e.shield ?? 0) > 0 && !(sub2 && sub2.exposed);
        const normal = normalize([0, 0, 0], sub([0, 0, 0], point, e.ship.pos));
        if (b.w.flak) burst(ctx, b);
        else ctx.damage(e, b.damage, point, dir, opts(b, b.w, sub2));
        ctx.events.push({
          type: 'boltHit', pos: point, normal, kind: 'ship', shielded, team: b.team, targetId: e.id,
          vel: [...e.ship.vel], ownerId: b.ownerId, big: !!e.big,
        });
      }
      weapons.bolts.splice(i, 1);
    } else if (b.life <= 0) {
      if (b.w.flak) burst(ctx, b);
      weapons.bolts.splice(i, 1);
    }
  }

  for (let i = weapons.missiles.length - 1; i >= 0; i--) {
    const m = weapons.missiles[i];
    const p = m.p;
    if (m.p.hp > 0 && m.hp <= 0) {
      ctx.events.push({ type: 'missileDestroyed', pos: [...m.pos], vel: [...m.vel], team: m.team, weapon: m.kind });
      weapons.missiles.splice(i, 1);
      continue;
    }
    m.age += dt;
    let target = null, tsub = null;
    if (m.targetId != null) {
      target = ctx.entities.find(e => e.id === m.targetId && e.alive && !e.folding) ?? null;
      if (!target) m.targetId = null;
      else if (m.subName) tsub = target.subsystems?.find(s => s.name === m.subName && s.alive) ?? null;
    }
    sub(rel, m.vel, m.frameVel);
    m.motor = m.age > p.ignition;
    if (m.motor && len(rel) < p.maxSpeed) addScaled(m.vel, m.vel, m.heading, p.accel * dt);
    if (m.motor && target) {
      const at = tsub ? subsystemWorld(aimAt, target, tsub) : target.ship.pos;
      guidanceAccel(aGuide, m.pos, m.vel, at, target.ship.vel, p.navGain, p.maxLateral, m.heading);
      addScaled(aGuide, aGuide, m.heading, -dot(aGuide, m.heading));
      addScaled(m.vel, m.vel, aGuide, dt);
    }
    sub(rel, m.vel, m.frameVel);
    if (len(rel) > 1e-6) normalize(m.heading, rel);
    m.prev[0] = m.pos[0]; m.prev[1] = m.pos[1]; m.prev[2] = m.pos[2];
    addScaled(m.pos, m.pos, m.vel, dt);

    let fused = null;
    if (p.fuse > 0) {
      for (const e of S) {
        if (!hostile(e, m.team)) continue;
        const c = closest(m.prev, m.pos, e.ship.pos);
        if (c.d <= p.fuse && (!fused || c.t < fused.t)) fused = { e, t: c.t };
      }
    }
    let impact = null;
    for (const e of L) {
      if (!e.alive || e.folding || e.team === m.team) continue;
      const h = sweepCompound(e, m.prev, m.pos, m.radius);
      if (h && (!impact || h.t < impact.t)) impact = { e, t: h.t, local: h.local };
    }
    if (tsub && target) {
      // The subsystem itself: torpedoes dive into it.
      const at = subsystemWorld(aimAt, target, tsub);
      const t = segmentSphereT(m.prev, m.pos, at, tsub.r);
      if (t >= 0 && (!impact || t <= impact.t)) impact = { e: target, t, local: toLocal([0, 0, 0], target, at), sub: tsub };
    }
    const rock = field.sweepSphere(m.prev, m.pos, m.radius);
    const first = [rock && { kind: 'rock', t: rock.t }, fused && { kind: 'fuse', t: fused.t }, impact && { kind: 'impact', t: impact.t }]
      .filter(Boolean).sort((a, b) => a.t - b.t)[0];
    if (!first) {
      if (m.age >= p.life) {
        explode(ctx, m, m.pos, 'missileExpire', m.vel);
        weapons.missiles.splice(i, 1);
      }
      continue;
    }
    const point = addScaled([0, 0, 0], m.prev, sub(tmp, m.pos, m.prev), first.t);
    if (first.kind === 'rock') {
      const vel = rock.ref.rock?.vel ?? [0, 0, 0];
      // A torpedo that strikes a seeded or hauled rock is a hit on the rock
      // entity, not on the belt: those are large entities, handled above.
      explode(ctx, m, rock.point, 'missileExplode', vel);
    } else if (first.kind === 'fuse') {
      ctx.events.push({ type: 'missileExplode', pos: [...point], targetId: fused.e.id, team: m.team, vel: [...fused.e.ship.vel], weapon: m.kind, torpedo: !!p.torpedo });
      blast(ctx, m, p, point, null);
    } else {
      // A warhead reaches what lies under the plating: the subsystem it was
      // sent for if the blast reaches it, else whatever the blast reaches first.
      const reach = Math.max(12, p.blast ?? 0);
      let sub2 = impact.sub ?? null;
      if (!sub2 && tsub && target === impact.e) {
        const dd = Math.hypot(impact.local[0] - tsub.pos[0], impact.local[1] - tsub.pos[1], impact.local[2] - tsub.pos[2]);
        if (dd <= tsub.r + reach) sub2 = tsub;
      }
      sub2 ??= subsystemAt(impact.e, impact.local, reach);
      explode(ctx, m, point, 'missileExplode', impact.e.ship.vel, { entity: impact.e, sub: sub2 });
    }
    weapons.missiles.splice(i, 1);
  }
}
