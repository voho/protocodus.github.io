/* Meteora — turrets and beams on large ships.

   A turret is a subsystem with a gun. A few times a second it picks a
   target — an incoming torpedo first if it is a flak gun, then the nearest
   hostile fighter in range, then a hostile large ship — and every step it
   leads that target and fires when the shot is inside its arc (it cannot
   shoot through its own hull: the target must be above the plane the
   turret stands on). Turrets on the Harrow's side aim with the
   difficulty's error, so a Recruit can fly through flak that would shred
   an Ace. Flak shells are fused for the range of the intercept and burst
   there.

   A turret is not a sniper. It traverses at its own slew rate, and it
   leads with the velocity it saw at its last look, a few times a second:
   a fighter that flies straight is hit, one that jinks and crosses fast
   and close outruns the gun.

   The Mother's beam is a turret of another kind: it charges for three
   seconds, glowing, then cuts a line three and a half kilometres long for
   two and a half; it stops at the first hull or rock in its way and burns
   whatever it touches. Missions aim it; on its own it goes for the largest
   hostile in range. */

import { leadPoint, fireBolt } from './weapons.js';
import { toWorld, sweepCompound, subsystemAt } from './compound.js';
import { GUNS } from './loadout.js';
import { addScaled, clamp, cross, dot, len, normalize, qRotate, qRotateInv, sub } from './vec.js';

const tmp = [0, 0, 0], from = [0, 0, 0], up = [0, 0, 0], lead = [0, 0, 0], dir = [0, 0, 0], want = [0, 0, 0], axis = [0, 0, 0];
const ON_TARGET = 0.05;   // radians: close enough to fire

/* Turn unit vector `v` toward unit vector `to` by at most `step` radians;
   returns the angle left. */
function slewToward(v, to, step) {
  const c = clamp(dot(v, to), -1, 1);
  const angle = Math.acos(c);
  if (angle <= step || angle < 1e-6) { v[0] = to[0]; v[1] = to[1]; v[2] = to[2]; return 0; }
  cross(axis, v, to);
  const n = len(axis);
  if (n < 1e-9) { axis[0] = 0; axis[1] = 1; axis[2] = 0; } else { axis[0] /= n; axis[1] /= n; axis[2] /= n; }
  // Rodrigues: v cos θ + (k × v) sin θ (k ⟂ v here).
  const cs = Math.cos(step), sn = Math.sin(step);
  cross(tmp, axis, v);
  v[0] = v[0] * cs + tmp[0] * sn; v[1] = v[1] * cs + tmp[1] * sn; v[2] = v[2] * cs + tmp[2] * sn;
  normalize(v, v);
  return angle - step;
}

export function createTurret(sub, hp, weaponKey, rng) {
  sub.turret = {
    up: hp.up ?? [0, 1, 0], fwd: hp.fwd ?? [0, 0, -1], size: hp.size ?? 3,
    w: GUNS[weaponKey], weaponKey, cool: rng.range(0, 2), think: rng.range(0, 0.4), target: null,
    aim: [...(hp.fwd ?? [0, 0, -1])],   // local aim direction, for drawing
  };
  return sub;
}

/* Point-defence guns (flak) go for incoming torpedoes first; the main guns
   traverse too slowly to track one and stay on ships, so stopping bombers
   and their torpedoes is the fighters' job. */
function pick(world, owner, t, origin, range) {
  if (t.w.pd) {
    let torpedo = null, torpedoD = range;
    for (const m of world.weapons.missiles) {
      if (m.hp <= 0 || m.team === owner.team) continue;
      const d = Math.hypot(m.pos[0] - origin[0], m.pos[1] - origin[1], m.pos[2] - origin[2]);
      if (d < torpedoD) { torpedoD = d; torpedo = m; }
    }
    if (torpedo) return { missile: torpedo };
  }
  let best = null, bestScore = Infinity;
  for (const e of world.active) {
    if (e.team === owner.team || e.team < 0 || e.hidden || e.untargetable || e.noAutoTarget || e.role === 'prop') continue;
    let d = Math.hypot(e.ship.pos[0] - origin[0], e.ship.pos[1] - origin[1], e.ship.pos[2] - origin[2]);
    if (e.big) d -= e.radius * 0.6;
    if (d > range) continue;
    // Above the turret's own deck.
    sub(tmp, e.ship.pos, origin);
    if (dot(tmp, up) < -0.15 * len(tmp)) continue;
    const score = d + (e.big ? 1500 : 0) + (t.w.flak && e.big ? 4000 : 0) - (e === world.player ? 150 : 0);
    if (score < bestScore) { bestScore = score; best = { entity: e }; }
  }
  return best;
}

export function stepTurrets(world, owner, dt) {
  if (!owner.turrets.length || owner.frozen || owner.folding || owner.disabled) return;
  const harrow = owner.team === 1;
  const aimError = harrow ? world.diff.enemyAim : 0.6;
  const rateScale = harrow ? world.diff.enemyFireRate : 1;
  for (const s of owner.turrets) {
    const t = s.turret;
    if (!s.alive || !t.w) continue;
    t.cool -= dt;
    t.think -= dt;
    toWorld(from, owner, s.pos);
    qRotate(up, owner.ship.q, t.up);
    addScaled(from, from, up, t.size * 0.6);
    const range = t.w.range ?? 1500;
    let look = false;
    if (t.think <= 0) {
      t.think = 0.3 + world.rng.next() * 0.2;
      t.target = pick(world, owner, t, from, range);
      look = true;
    }
    const tgt = t.target;
    if (!tgt) continue;
    let pos, vel;
    if (tgt.missile) {
      if (tgt.missile.hp <= 0 || !world.weapons.missiles.includes(tgt.missile)) { t.target = null; continue; }
      pos = tgt.missile.pos; vel = tgt.missile.vel;
    } else {
      const e = tgt.entity;
      if (!e.alive || e.folding) { t.target = null; continue; }
      pos = e.ship.pos; vel = e.ship.vel;
    }
    // The velocity it leads with is the one it saw at its last look.
    if (look || !t.seen || t.seenOf !== tgt) { t.seen = [...vel]; t.seenOf = tgt; }
    const at = leadPoint(lead, from, owner.ship.vel, pos, t.seen, t.w.speed) ?? pos;
    sub(dir, at, from);
    const distance = len(dir);
    if (distance < 1e-6) continue;
    normalize(dir, dir);
    qRotateInv(want, owner.ship.q, dir);
    const off = slewToward(t.aim, want, (t.w.slew ?? 1.2) * dt);
    if (distance > range || dot(dir, up) < -0.2 || t.cool > 0 || off > ON_TARGET) continue;
    t.cool = 1 / (t.w.rate * rateScale);
    const spread = 0.028 * aimError * (tgt.missile ? 0.5 : 1);
    const muzzle = addScaled([0, 0, 0], from, dir, t.size * 0.8);
    fireBolt(world.weapons, owner, null, t.w, null, {
      from: muzzle, dir, spread, rng: world.rng,
      fuse: t.w.flak ? distance + world.rng.range(-45, 45) : Infinity,
    });
    world.events.push({ type: 'fire', team: owner.team, shipId: owner.id, pos: muzzle, vel: [...owner.ship.vel], turret: true, weapon: t.weaponKey, size: owner.radius });
  }
}

/* ---------- beams ---------- */

export function createBeam(sub) {
  return { sub, w: GUNS.furrow, state: 'idle', t: 0, cool: 6, targetId: null, dir: [0, 0, -1], from: [0, 0, 0], to: [0, 0, 0], auto: false };
}

/* Aim the beam at an entity; it charges at once if it is ready. */
export function fireBeam(world, owner, target) {
  const b = owner.beam;
  if (!b || !b.sub.alive || b.state === 'charge' || b.state === 'fire') return false;
  b.targetId = target.id; b.state = 'charge'; b.t = 0;
  world.events.push({ type: 'beamCharge', id: owner.id, pos: toWorld([0, 0, 0], owner, b.sub.pos) });
  return true;
}

export function stepBeam(world, owner, dt) {
  const b = owner.beam;
  if (!b) return;
  if (!b.sub.alive || !owner.alive) { b.state = 'idle'; return; }
  toWorld(b.from, owner, b.sub.pos);
  const target = b.targetId != null ? world.byId.get(b.targetId) : null;
  const w = b.w;
  if (b.state === 'idle' || b.state === 'cool') {
    b.cool -= dt;
    if (b.cool <= 0) b.state = 'idle';
    if (b.state === 'idle' && b.auto && !owner.frozen) {
      let best = null, bestD = Infinity;
      for (const e of world.active) {
        if (!e.big || e.team === owner.team || e.team < 0 || e.role === 'prop') continue;
        const d = Math.hypot(e.ship.pos[0] - b.from[0], e.ship.pos[1] - b.from[1], e.ship.pos[2] - b.from[2]) - e.radius;
        if (d < w.range && d < bestD) { bestD = d; best = e; }
      }
      if (best) fireBeam(world, owner, best);
    }
    return;
  }
  if (owner.frozen) return;
  const want = target?.alive ? normalize([0, 0, 0], sub([0, 0, 0], target.ship.pos, b.from)) : b.dir;
  b.t += dt;
  if (b.state === 'charge') {
    // Aimed during the charge; once it fires it holds that line and turns
    // only slowly, so three seconds of warning are enough to get clear.
    b.dir = want;
    if (b.t >= w.charge) {
      b.state = 'fire'; b.t = 0;
      world.events.push({ type: 'beamFire', id: owner.id, pos: [...b.from] });
    }
  } else if (b.state === 'fire') {
    // The beam follows its target slowly: a ship that moves gets out from
    // under it; a capital ship cannot.
    const k = clamp((w.track ?? 0.02) * dt * 3, 0, 1);
    for (let i = 0; i < 3; i++) b.dir[i] += (want[i] - b.dir[i]) * k;
    normalize(b.dir, b.dir);
    const end = addScaled([0, 0, 0], b.from, b.dir, w.range);
    let t = 1, hitLarge = null, local = null;
    const rock = world.field.sweepSphere(b.from, end, w.radius * 0.5);
    if (rock) t = rock.t;
    for (const e of world.active) {
      if (!e.big || e === owner || e.team === owner.team) continue;
      const h = sweepCompound(e, b.from, end, w.radius * 0.5);
      if (h && h.t < t) { t = h.t; hitLarge = e; local = h.local; }
    }
    addScaled(b.to, b.from, b.dir, w.range * t);
    if (hitLarge) {
      const s2 = subsystemAt(hitLarge, local, 20);
      world.damage(hitLarge, w.dps * dt, [...b.to], b.dir, { sourceTeam: owner.team, sourceId: owner.id, sub: s2, weapon: { pierce: 0.6, shieldMul: 1, hullMul: 1 } });
    }
    if (rock && !hitLarge && rock.ref) world.damageRock?.(rock.ref, w.dps * dt, rock.point);
    // Fighters caught in it.
    for (const e of world.active) {
      if (e.big || e.team === owner.team || e.team < 0) continue;
      sub(tmp, e.ship.pos, b.from);
      const along = dot(tmp, b.dir);
      if (along < 0 || along > w.range * t) continue;
      const off = Math.sqrt(Math.max(0, dot(tmp, tmp) - along * along));
      if (off < w.radius + e.radius) world.damage(e, w.smallDps * dt, [...e.ship.pos], b.dir, { sourceTeam: owner.team, sourceId: owner.id });
    }
    if (b.t >= w.fire) {
      b.state = 'cool'; b.t = 0; b.cool = world.rng.range(w.cooldown[0], w.cooldown[1]);
      world.events.push({ type: 'beamEnd', id: owner.id });
    }
  }
}
