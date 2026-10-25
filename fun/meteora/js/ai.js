/* Meteora — pilots.

   Every AI fighter flies the same physics as the player, through the same
   flight-assist controller, with only its stats changed. The brain never
   moves the ship; it only produces the stick, throttle and trigger a human
   pilot would, so anything an enemy (or a wingman) does the player could do
   too. Teams do not matter here: a Harrow Thorn and Lantern Two run the
   same code against different targets.

   Fighter states, chosen at 20 Hz (difficulty stretches or shortens that):
     approach  close on the target, burning the afterburner when far
     attack    fly the lead point, fire in bursts when the shot would land
     breakoff  overshoot, pull out sideways and extend for another run
     evade     jink when hit, locked or chased by a missile
     form      hold a slot on the leader (wingmen with nothing to fight)

   Bombers run torpedo passes instead: approach to stand-off range, line
   the nose up on the target (or one of its subsystems), hold it there
   while the torpedo locks, launch, break away, come round; with the racks
   empty they strafe like fighters.

   Underneath every state runs avoidance, which outranks all of them: a fan
   of "whiskers" is swept through the belt and around large ships' hulls,
   and the clear direction nearest the wanted one is flown instead. When
   something is less than about a second away the pilot also brakes and
   slides sideways, because at 200 m/s turning the nose alone takes too long
   to move the velocity.

   The trigger is tested every step against the true lead point, not the
   noisy one the pilot steers by, so a pilot never wastes a burst it could
   not have landed — the aim error only decides how close it gets. */

import { NEUTRAL_CONTROLS, forward } from './flight.js';
import { leadPoint } from './weapons.js';
import { densityAt } from './field.js';
import { ENEMY_CANNON } from './config.js';
import { makeRng } from './rng.js';
import { sweepCompound, subsystemWorld, toWorld } from './compound.js';
import {
  addScaled, clamp, cross, dot, hypot3, len, normalize, qRotate, qRotateInv, scale, sub,
} from './vec.js';

const THINK = 1 / 20;
const ATTACK_RANGE = 1200, BREAK_RANGE = 150, ATTACK_TIME = 6;
const FIRE_CONE = 4 * Math.PI / 180;
const deg = Math.PI / 180;

export function createBrain(seed, role = 'fighter') {
  const rng = makeRng(seed);
  return {
    role,
    // Each pilot's first decision lands at a random point in the 1/20 s
    // cycle, so a wave of ten does not all think on the same step.
    state: 'approach', timer: 0, rng, think: rng.range(0, THINK),
    burstOn: false, burstTimer: 0, aim: [0, 0, 0], aimTimer: 0,
    breakDir: [0, 1, 0], extend: 700, jink: { strafe: 0, lift: 0, roll: 0, pitch: 0 }, jinkTimer: 0,
    wasLocked: false, lastControls: { ...NEUTRAL_CONTROLS, fire: false },
    target: null, targetSub: null, retarget: 0, strafePoint: null, strafeTimer: 0,
    lockTimer: 0, missileCooldown: rng.range(3, 6), torpedoCooldown: 0,
    flank: rng.pick([-1, 1]), fireClear: true, sightTimer: 0, recoverCooldown: 0,
  };
}

const tmpA = [0, 0, 0], tmpB = [0, 0, 0], gateLead = [0, 0, 0], aimPt = [0, 0, 0];

/* Stick inputs that turn the nose toward a world direction, banking into
   large turns the way a pilot rolls the target onto the lift vector. */
function steer(c, ship, dir) {
  if (len(dir) < 1e-9) { c.pitch = 0; c.yaw = 0; c.roll = 0; return; }
  const d = qRotateInv(tmpA, ship.q, dir);
  const off = Math.acos(clamp(-d[2], -1, 1));
  c.pitch = clamp(Math.atan2(d[1], -d[2]) * 2.5, -1, 1);
  c.yaw = clamp(Math.atan2(d[0], -d[2]) * 2.5, -1, 1);
  c.roll = off > 20 * deg ? clamp(Math.atan2(d[0], d[1]) * 1.5, -1, 1) : 0;
}

/* How far along the sweep from p0, `reach` metres along dir, a ball of
   radius R first touches a rock or one of the `near` hulls (1: nothing). */
function clearance(field, near, p0, dir, reach, R) {
  addScaled(tmpB, p0, dir, reach);
  const hit = field.sweepSphere(p0, tmpB, R);
  let t = hit ? hit.t : 1;
  for (const e of near) {
    const h = sweepCompound(e, p0, tmpB, R);
    if (h && h.t < t) t = h.t;
  }
  return t;
}

// Every pilot avoids twenty times a second, and one in danger tries
// twenty-six whiskers: their directions are worked out in these rather
// than in new arrays.
const NONE = [], WHISKERS = [0, 25, 50, 80], Y_AXIS = [0, 1, 0], X_AXIS = [1, 0, 0];
const vHatS = [0, 0, 0], upS = [0, 0, 0], rightS = [0, 0, 0], downS = [0, 0, 0], leftS = [0, 0, 0];
const bentS = [0, 0, 0], dirS = [0, 0, 0], bestS = [0, 0, 0], localS = [0, 0, 0], awayS = [0, 0, 0];
const nearS = [], aroundS = [];

/* Avoidance. Returns the direction to fly and fills strafe, lift and
   throttle overrides when the danger is close. Large ships (ctx.larges)
   count as obstacles exactly as rocks do. */
function avoid(me, ctx, want, c) {
  const field = ctx.field, ship = me.ship;
  const speed = len(ship.vel);
  const horizon = clamp(speed / 50, 1.6, 3.2);
  const reach = Math.max(120, speed * horizon) + 40;
  const R = me.radius + 14;
  const p0 = ship.pos;
  const vHat = speed > 3 ? scale(vHatS, ship.vel, 1 / speed) : forward(vHatS, ship);
  const near = nearS;
  near.length = 0;
  for (const e of ctx.larges ?? NONE) {
    if (!e.alive || e === me || e.id === me.ignoreId) continue;
    const dd = hypot3(e.ship.pos[0] - p0[0], e.ship.pos[1] - p0[1], e.ship.pos[2] - p0[2]);
    if (dd < e.radius + reach + R) near.push(e);
  }
  const tVel = clearance(field, near, p0, vHat, reach, R);
  const tWant = clearance(field, near, p0, want, reach, R);
  let chosen = want;
  if (tVel < 1 || tWant < 1) {
    // Whiskers: the wanted direction and the current velocity, each bent
    // 25°, 50° and 80° four ways in the ship's frame.
    const up = qRotate(upS, ship.q, Y_AXIS);
    const right = qRotate(rightS, ship.q, X_AXIS);
    const down = scale(downS, up, -1), left = scale(leftS, right, -1);
    let best = -Infinity, found = false;
    for (let b = 0; b < 2; b++) {
      const base = b === 0 ? want : vHat;
      for (const angle of WHISKERS) {
        const a = angle * deg, cos = Math.cos(a), sin = Math.sin(a);
        for (let k = 0; k < (angle === 0 ? 1 : 4); k++) {
          const axis = k === 0 ? up : k === 1 ? right : k === 2 ? down : left;
          const dir = normalize(dirS, addScaled(bentS, scale(bentS, base, cos), axis, sin));
          const t = clearance(field, near, p0, dir, reach, R);
          const score = t * 3 + dot(dir, want) * 0.6 + dot(dir, vHat) * 0.9;
          if (score > best) { best = score; bestS[0] = dir[0]; bestS[1] = dir[1]; bestS[2] = dir[2]; found = true; }
        }
      }
    }
    if (found) chosen = [bestS[0], bestS[1], bestS[2]];
    const impact = tVel * reach / Math.max(speed, 1);
    if (impact < 1.4) {
      // Close: brake and slide toward the clear side with the lateral thrusters.
      const local = qRotateInv(localS, ship.q, chosen);
      c.strafe = clamp(local[0] * 3, -1, 1);
      c.lift = clamp(local[1] * 3, -1, 1);
      c.throttleSet = impact < 0.8 ? -0.35 : 0.15;
      c.boost = false;
    }
  }
  // Anything already alongside: push straight away from it.
  aroundS.length = 0;
  for (const h of field.queryRadius(p0, me.radius + 30, aroundS)) {
    const away = sub(awayS, p0, h.pos);
    const local = qRotateInv(localS, ship.q, normalize(away, away));
    c.strafe = clamp(c.strafe + local[0] * 2, -1, 1);
    c.lift = clamp(c.lift + local[1] * 2, -1, 1);
    if (local[2] > 0.3) c.throttleSet = Math.min(c.throttleSet ?? 1, -0.35);
  }
  aroundS.length = 0;
  // Give other fighters room with the lateral thrusters, so nearby
  // formation slots do not turn into repeated rams.
  for (const e of ctx.smalls ?? []) {
    if (e === me || !e.alive || e.folding || e.id === me.ignoreId) continue;
    const away = sub([0, 0, 0], p0, e.ship.pos), d = len(away);
    const room = me.radius + e.radius + 24;
    if (d < 0.01 || d > room * 2) continue;
    const local = qRotateInv([0, 0, 0], ship.q, scale(away, away, 1 / d));
    const push = clamp((room * 2 - d) / room, 0, 1);
    c.strafe = clamp(c.strafe + local[0] * push, -1, 1);
    c.lift = clamp(c.lift + local[1] * push, -1, 1);
    if (local[2] > 0.5 && d < room) { c.throttleSet = Math.min(c.throttleSet ?? 1, 0.2); c.speedSet = null; c.boost = false; }
  }
  return chosen;
}

/* Where to aim at a target: a small craft's centre, a subsystem, or for a
   big hull a point on it that is refreshed now and then, so strafing runs
   rake along the ship rather than all aiming at its middle. */
function aimPointOf(brain, me, target, o) {
  if (brain.targetSub?.alive) return subsystemWorld(o, target, brain.targetSub);
  if (!target.big || target.radius < 60) { o[0] = target.ship.pos[0]; o[1] = target.ship.pos[1]; o[2] = target.ship.pos[2]; return o; }
  if (!brain.strafePoint || brain.strafeTimer <= 0) {
    const pool = target.subsystems.filter(s => s.alive && s.exposed);
    const pick = pool.length && brain.rng.next() < 0.6 ? brain.rng.pick(pool).pos : brain.rng.pick(target.colliders).pos;
    brain.strafePoint = pick; brain.strafeTimer = brain.rng.range(4, 8);
  }
  return toWorld(o, target, brain.strafePoint);
}

function attackRange(target) { return ATTACK_RANGE + (target.big ? Math.min(target.radius, 400) : 0); }

function fighterThink(brain, me, ctx, c, target, range, toTarget, elapsed) {
  const rng = brain.rng, ship = me.ship;
  const gunSpeed = me.gun?.params.speed ?? ENEMY_CANNON.speed;
  let want = normalize([0, 0, 0], toTarget);
  const breakAt = target.big ? Math.min(target.radius, 300) * 0.6 + BREAK_RANGE + 60 : BREAK_RANGE;
  // A slow target in open space is worth staying on: no need to break off
  // and come round. In thick rock the pilot keeps its short runs.
  const slow = !target.big && Math.hypot(...target.ship.vel) < 70
    && densityAt(ship.pos[0], ship.pos[1], ship.pos[2], ctx.field.seed, ctx.field.cfg) < 0.25;
  const attackTime = slow ? ATTACK_TIME * 2.2 : ATTACK_TIME;
  switch (brain.state) {
    case 'approach':
      c.throttleSet = 1;
      c.boost = range > 2000;
      if (!target.big && range > 1000 && range < 2400 && ctx.tactics > 0) {
        const side = qRotate([0, 0, 0], target.ship.q, [brain.flank, 0.25, 0]);
        want = normalize(want, addScaled(want, toTarget, side, Math.min(650, range * 0.3) * ctx.tactics));
      }
      if (range < attackRange(target)) { brain.state = 'attack'; brain.timer = 0; }
      break;
    case 'attack': {
      brain.timer += elapsed;
      brain.aimTimer -= elapsed;
      if (brain.aimTimer <= 0) {
        brain.aimTimer = 0.5;
        rng.unit(brain.aim);
        scale(brain.aim, brain.aim, range * 0.004 * (ctx.aimError ?? 1) * rng.gauss());
      }
      const at = aimPointOf(brain, me, target, aimPt);
      const lead = leadPoint([0, 0, 0], ship.pos, ship.vel, at, target.ship.vel, gunSpeed);
      if (lead) want = normalize(want, sub(tmpA, addScaled(tmpA, lead, brain.aim, 1), ship.pos));
      c.throttleSet = clamp(range / 900, 0.35, 0.9);
      if (!target.big && range < 900 && ctx.tactics > 0) {
        c.strafe = brain.flank * 0.55 * ctx.tactics;
        c.lift = Math.sin(brain.timer * 1.7 + me.id) * 0.4 * ctx.tactics;
      }
      if (range < breakAt || brain.timer > attackTime) {
        brain.state = 'breakoff';
        const side = cross([0, 0, 0], toTarget, rng.unit([0, 0, 0]));
        if (len(side) < 1e-6) rng.unit(side);
        normalize(brain.breakDir, side);
        brain.extend = rng.range(600, 900) + (target.big ? Math.min(target.radius, 400) : 0);
      }
      break;
    }
    case 'breakoff': {
      const away = scale([0, 0, 0], normalize([0, 0, 0], toTarget), -0.6);
      want = normalize(want, addScaled(away, away, brain.breakDir, 1));
      if (len(want) < 1e-9) want = [...brain.breakDir];
      c.throttleSet = 1;
      if (range > brain.extend) brain.state = 'approach';
      break;
    }
  }
  return want;
}

/* A torpedo pass. The torpedo itself is launched by the world when
   `c.torpedo` is set; the brain only flies the run. */
function bomberThink(brain, me, ctx, c, target, range, toTarget, elapsed) {
  const ship = me.ship;
  const standoff = 1500 + Math.min(target.radius, 400);
  const at = aimPointOf(brain, me, target, aimPt);
  const toAim = sub([0, 0, 0], at, ship.pos);
  let want = normalize([0, 0, 0], toAim);
  switch (brain.state) {
    case 'approach':
    case 'attack':
      c.throttleSet = 1;
      c.boost = range > standoff + 1500;
      if (range < standoff + 300) { brain.state = 'lineup'; brain.timer = 0; brain.lockTimer = 0; }
      break;
    case 'lineup': {
      brain.timer += elapsed;
      c.throttleSet = 0.55;
      const off = Math.acos(clamp(dot(want, forward(tmpB, ship)), -1, 1));
      brain.lockTimer = off < 8 * deg ? brain.lockTimer + elapsed : 0;
      if (brain.lockTimer >= (me.torpedoLock ?? 1.5) && brain.torpedoCooldown <= 0 && me.torpedoes > 0) {
        c.torpedo = true;
        brain.torpedoCooldown = brain.rng.range(5, 8);
        brain.state = 'breakoff';
        const side = cross([0, 0, 0], toAim, [0, 1, 0]);
        normalize(brain.breakDir, len(side) > 1e-6 ? side : brain.rng.unit([0, 0, 0]));
        brain.extend = standoff + 600;
      } else if (brain.timer > 9 || range < Math.min(target.radius, 400) + 350) {
        brain.state = 'breakoff';
        normalize(brain.breakDir, cross([0, 0, 0], toAim, brain.rng.unit([0, 0, 0])));
        brain.extend = standoff + 400;
      }
      break;
    }
    case 'breakoff': {
      const away = scale([0, 0, 0], normalize([0, 0, 0], toTarget), -0.5);
      want = normalize(want, addScaled(away, away, brain.breakDir, 1));
      c.throttleSet = 1;
      if (range > brain.extend) brain.state = 'approach';
      break;
    }
  }
  return want;
}

/* Hold a formation slot on a leader. */
function formThink(brain, me, ctx, c) {
  const leader = ctx.leader, ship = me.ship;
  const slot = qRotate([0, 0, 0], leader.ship.q, me.slot ?? [30, 0, 25]);
  addScaled(slot, slot, leader.ship.pos, 1);
  const to = sub([0, 0, 0], slot, ship.pos);
  const gap = len(to);
  const lv = leader.ship.vel, lspeed = len(lv);
  let want;
  if (gap > 60) {
    want = normalize([0, 0, 0], addScaled([0, 0, 0], to, lv, 1.2));
    c.throttleSet = null;
    // A ship ahead of its slot must slow down; adding the gap to the
    // leader's speed in both directions made wingmen orbit and disappear.
    c.speedSet = clamp(dot(lv, want) + gap * 0.5, 0, ship.stats.fa.boostSpeed);
    c.boost = gap > 900;
  } else {
    want = lspeed > 5 ? normalize([0, 0, 0], lv) : forward([0, 0, 0], leader.ship);
    const local = qRotateInv([0, 0, 0], ship.q, to);
    c.strafe = clamp(local[0] / 20, -1, 1);
    c.lift = clamp(local[1] / 20, -1, 1);
    c.speedSet = Math.max(0, lspeed - local[2] * 0.5);
  }
  return want;
}

function think(brain, me, ctx, elapsed) {
  const rng = brain.rng, ship = me.ship;
  const c = { ...NEUTRAL_CONTROLS, fire: false, missile: false, torpedo: false };
  const threat = ctx.threat ?? {};
  const target = ctx.target;
  brain.recoverCooldown -= elapsed;
  if (target && brain.role !== 'bomber' && brain.state !== 'recover' && brain.recoverCooldown <= 0
    && me.maxHull > 0 && me.hull < me.maxHull * 0.4 && me.maxShield > 0 && me.shield < me.maxShield * 0.15
    && (me.team === 0 || ctx.tactics >= 0.7)) {
    brain.state = 'recover'; brain.timer = 5; brain.recoverCooldown = 18;
  }

  const newlyLocked = threat.locked && !brain.wasLocked;
  brain.wasLocked = !!threat.locked;
  if (brain.state !== 'evade' && brain.state !== 'form' && brain.state !== 'recover' && target
    && (threat.missileInbound || (ctx.wasHit && brain.role !== 'bomber') || newlyLocked)) {
    brain.state = 'evade'; brain.timer = rng.range(1.5, 3) * (me.evadeScale ?? 1); brain.jinkTimer = 0;
  }
  brain.torpedoCooldown -= elapsed;
  brain.missileCooldown -= elapsed;
  brain.strafeTimer -= elapsed;

  let want;
  if (!target) {
    if (me.orders?.type === 'jump' && ctx.home) {
      brain.state = 'idle';
      const to = sub([0, 0, 0], ctx.home, ship.pos), gap = len(to);
      want = gap > 1 ? normalize(to, to) : forward([0, 0, 0], ship);
      c.speedSet = Math.min(ship.stats.fa.boostSpeed, gap * 0.85);
      c.boost = gap > 800;
    } else if (ctx.leader) { brain.state = 'form'; want = formThink(brain, me, ctx, c); }
    else {
      // Nothing to fight: cruise on, or hold a patrol point.
      if (brain.state !== 'idle') brain.state = 'idle';
      const home = ctx.home;
      if (home) {
        const to = sub([0, 0, 0], home, ship.pos);
        want = len(to) > 200 ? normalize(to, to) : forward([0, 0, 0], ship);
        c.throttleSet = len(sub(tmpB, home, ship.pos)) > 400 ? 0.7 : 0.25;
      } else {
        want = forward([0, 0, 0], ship);
        c.throttleSet = 0.5;
      }
    }
  } else {
    if (brain.state === 'form' || brain.state === 'idle') brain.state = 'approach';
    const toTarget = sub([0, 0, 0], target.ship.pos, ship.pos);
    const range = len(toTarget);
    if (brain.state === 'recover') {
      brain.timer -= elapsed;
      const away = normalize([0, 0, 0], scale([0, 0, 0], toTarget, -1));
      const home = ctx.leader && len(sub(tmpA, ctx.leader.ship.pos, ship.pos)) > 600 ? normalize([0, 0, 0], tmpA) : away;
      want = normalize([0, 0, 0], addScaled(away, away, home, 0.7));
      c.throttleSet = 1; c.boost = true;
      c.strafe = brain.flank * 0.65;
      if (brain.timer <= 0 || me.shield > me.maxShield * 0.4) { brain.state = 'approach'; brain.timer = 0; }
    } else if (brain.state === 'evade') {
      brain.timer -= elapsed;
      brain.jinkTimer -= elapsed;
      if (brain.jinkTimer <= 0) {
        brain.jinkTimer = rng.range(0.3, 0.5);
        brain.jink = {
          strafe: rng.pick([-1, 1]), lift: rng.pick([-1, 1]),
          roll: rng.range(-1, 1), pitch: rng.range(-0.6, 0.6),
        };
      }
      const side = cross([0, 0, 0], toTarget, qRotate(tmpB, ship.q, [0, 1, 0]));
      want = normalize([0, 0, 0], len(side) > 1e-6 ? side : forward([0, 0, 0], ship));
      c.throttleSet = 1;
      c.boost = !!threat.missileInbound;
      c.strafe = brain.jink.strafe;
      c.lift = brain.jink.lift;
      if (brain.timer <= 0 && !threat.missileInbound) brain.state = range < attackRange(target) ? 'attack' : 'approach';
    } else if (brain.role === 'bomber' && target.big && (me.torpedoes ?? 0) > 0) {
      want = bomberThink(brain, me, ctx, c, target, range, toTarget, elapsed);
    } else {
      if (brain.state === 'lineup') brain.state = 'attack';
      want = fighterThink(brain, me, ctx, c, target, range, toTarget, elapsed);
    }
    // Missiles: hold a fighter inside a narrow cone for the lock time.
    if ((me.missiles ?? 0) > 0 && !target.big && range < 1600 && range > 250 && brain.missileCooldown <= 0) {
      const off = Math.acos(clamp(dot(normalize(tmpA, toTarget), forward(tmpB, ship)), -1, 1));
      brain.lockTimer = off < 12 * deg ? brain.lockTimer + elapsed : 0;
      if (brain.lockTimer >= (me.missileLock ?? 1.2)) {
        c.missile = true; brain.lockTimer = 0; brain.missileCooldown = rng.range(6, 10);
      }
    }
  }

  // Slower through crowded rock, whatever the state wants.
  const density = densityAt(ship.pos[0], ship.pos[1], ship.pos[2], ctx.field.seed, ctx.field.cfg);
  const cap = 1 - 0.5 * density;
  if (c.throttleSet != null && c.throttleSet > cap) c.throttleSet = cap;
  if (c.speedSet != null) c.speedSet = Math.min(c.speedSet, ship.stats.fa.boostSpeed * Math.max(0.5, cap));
  if (density > 0.35) c.boost = false;
  want = climb(me, ctx, want, c);

  const fly = avoid(me, ctx, want, c);
  steer(c, ship, fly);
  if (brain.state === 'evade' && fly === want) { c.roll = brain.jink.roll; c.pitch = clamp(c.pitch + brain.jink.pitch, -1, 1); }
  return c;
}

function fireGate(brain, me, ctx) {
  const target = ctx.target;
  if (!target || (brain.state !== 'attack' && brain.state !== 'lineup')) return false;
  const ship = me.ship;
  const gunSpeed = me.gun?.params.speed ?? ENEMY_CANNON.speed;
  const at = aimPointOf(brain, me, target, aimPt);
  const range = len(sub(tmpA, at, ship.pos));
  if (range > attackRange(target)) return false;
  const lead = leadPoint(gateLead, ship.pos, ship.vel, at, target.ship.vel, gunSpeed);
  if (!lead) return false;
  const to = normalize(lead, sub(lead, lead, ship.pos));
  // A big hull is a big target: the cone opens with its size, or with the
  // subsystem's when one is the target (a miss beside it hits the shield).
  const size = brain.targetSub?.alive ? brain.targetSub.r * 0.7 : Math.min(target.radius, 60) * 0.5;
  const cone = target.big ? Math.max(FIRE_CONE, Math.atan2(size, range)) : FIRE_CONE;
  if (Math.acos(clamp(dot(to, forward(tmpB, ship)), -1, 1)) > cone) return false;
  if (brain.sightTimer <= 0) {
    brain.sightTimer = 0.12;
    // Do not waste a firing pass on a rock, or through a friendly hull.
    const end = addScaled([0, 0, 0], ship.pos, to, range);
    brain.fireClear = !ctx.field.sweepSphere(ship.pos, end, 1);
    if (brain.fireClear) for (const e of ctx.larges ?? []) {
      if (e !== me && e !== target && e.alive && sweepCompound(e, ship.pos, end, 2)) { brain.fireClear = false; break; }
    }
    if (brain.fireClear) for (const e of ctx.smalls ?? []) {
      if (e === me || e === target || !e.alive || e.team !== me.team) continue;
      const offset = sub([0, 0, 0], e.ship.pos, ship.pos), along = dot(offset, to);
      if (along > 0 && along < range && dot(offset, offset) - along * along < (e.radius + 3) ** 2) { brain.fireClear = false; break; }
    }
  }
  return brain.fireClear;
}

/* One pilot's controls for this step. ctx: field, target (an entity or
   null), threat ({ locked, missileInbound }), wasHit, larges (obstacles),
   leader and home (for formation and patrol), aimError and thinkScale
   (difficulty), frozen (the pilot sits still). */
export function thinkPilot(brain, me, ctx, dt) {
  if (ctx.frozen) {
    const c = brain.lastControls = { ...NEUTRAL_CONTROLS, fire: false, missile: false, torpedo: false, throttleSet: 0 };
    return c;
  }
  brain.think -= dt;
  if (brain.think <= 0) {
    const period = THINK * (ctx.thinkScale ?? 1);
    brain.think += period;
    if (brain.think <= 0) brain.think = period;
    brain.lastControls = think(brain, me, ctx, period);
  } else {
    // One-shot orders belong to the step they were decided on.
    brain.lastControls.missile = false;
    brain.lastControls.torpedo = false;
  }
  // Bursts and the trigger run every step.
  brain.burstTimer -= dt;
  brain.sightTimer -= dt;
  if (brain.burstTimer <= 0) {
    brain.burstOn = !brain.burstOn;
    const params = me.gun?.params ?? ENEMY_CANNON;
    const span = brain.burstOn ? (params.burst ?? ENEMY_CANNON.burst) : (params.pause ?? ENEMY_CANNON.pause);
    brain.burstTimer = brain.rng.range(span[0], span[1]);
  }
  const c = brain.lastControls;
  c.fire = brain.burstOn && fireGate(brain, me, ctx);
  return c;
}

/* The original single-target form: the enemy hunts `ctx.player`. */
export function thinkEnemy(brain, me, ctx, dt) {
  if (ctx.target === undefined) ctx.target = ctx.player ?? null;
  return thinkPilot(brain, me, ctx, dt);
}

/* Near a black hole (ctx.well) no pilot goes deeper than twice its own
   point of no return: below that, it turns its nose outward — the deeper,
   the harder — and burns. */
const climbOut = [0, 0, 0];
export function climb(me, ctx, want, c) {
  const well = ctx.well;
  if (!well) return want;
  const ship = me.ship, r = well.distance(ship.pos);
  const floor = well.radiusFor(ship.stats.accel.forward) * 2;
  if (r >= floor * 1.25) return want;
  for (let k = 0; k < 3; k++) climbOut[k] = (ship.pos[k] - well.pos[k]) / r;
  const k = Math.min(1, (floor * 1.25 - r) / (floor * 0.5));
  const out = normalize([0, 0, 0], [0, 1, 2].map(i => want[i] * (1 - k) + climbOut[i] * k));
  if (r < floor) { c.throttleSet = 1; c.speedSet = null; c.boost = true; }
  return out;
}

/* Steer toward `want` (a world direction) clear of rocks and hulls: the
   pilots' avoidance, for anything else that flies itself. Fills c's pitch,
   yaw, roll and any braking it decides on. */
export function steerClear(me, ctx, want, c) {
  want = climb(me, ctx, want, c);
  const fly = avoid(me, ctx, want, c);
  steer(c, me.ship, fly);
  return c;
}

/* ---------- choosing targets ---------- */

/* The hostile a pilot should be fighting. Orders come first; otherwise a
   score of distance and angle, nudged by what matters to the mission:
   attackers of whatever this pilot protects, bombers, the player (as much
   as `playerBias` says), and anything carrying one of the pilot's
   `prefer` tags. Bombers want large targets. */
export function pickTarget(me, candidates, { player = null, protect = null, prefer = null, playerBias = 0, current = me.brain?.target ?? null, allies = [] } = {}) {
  const o = me.orders ?? {};
  if (o.type === 'attack' && o.target?.alive && !o.target.folding && !o.target.hidden) return o.target;
  const bomber = me.role === 'bomber' && (me.torpedoes ?? 0) > 0;
  let best = null, bestScore = Infinity;
  const fwd = forward([0, 0, 0], me.ship);
  for (const e of candidates) {
    if (!e.alive || e.folding || e.hidden || e.team === me.team || e.untargetable) continue;
    // Some targets are the player's call: pilots engage them only on an order.
    if (e.noAutoTarget) continue;
    if (e.team < 0 && !(prefer && e.tags?.has(prefer))) continue;
    if (bomber && !e.big) continue;
    if (!bomber && e.big && e.role !== 'freighter' && e.role !== 'shuttle' && e.role !== 'hauler' && !(prefer && e.tags?.has(prefer)) && o.type !== 'strike') continue;
    const to = sub([0, 0, 0], e.ship.pos, me.ship.pos);
    const d = Math.max(0, len(to) - (e.big ? e.radius * 0.5 : 0));
    const angle = Math.acos(clamp(dot(normalize(to, to), fwd), -1, 1));
    let score = d + 500 * angle / Math.PI;
    if (e === player) score -= playerBias;
    if (e.role === 'bomber' && me.team === 0) score -= 600;
    if (prefer && e.tags?.has(prefer)) score -= 1500;
    if (protect && e.brain?.target === protect) score -= 1200;
    // Split the screen across threats, while still finishing damaged
    // enemies and responding immediately to a bomber's attack run.
    if (!e.big) {
      const assigned = allies.filter(a => a !== me && a.alive && a.brain?.target === e).length;
      score += assigned * 360;
      if (e.hull / e.maxHull < 0.3) score -= 250;
      if (protect && e.role === 'bomber' && e.brain?.target === protect) score -= 800;
    }
    if (e.role === 'tender') score -= 300;
    // Finish what you started: the current target has to be clearly
    // beaten before a pilot switches.
    if (e === current) score -= 450;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}
