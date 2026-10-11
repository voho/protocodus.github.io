/* Meteora — enemy pilots.

   An interceptor flies the same physics as the player, through the same
   flight-assist controller, with only its stats changed. The brain never
   moves the ship; it only produces the stick, throttle and trigger a
   human pilot would, so anything an enemy does the player could do too.

   Four states, chosen at 20 Hz:
     approach  close on the player, burning the afterburner when far
     attack    fly the lead point, fire in bursts when the shot would land
     breakoff  overshoot, pull out sideways and extend for another run
     evade     jink when hit, locked or chased by a missile

   Underneath every state runs rock avoidance, which outranks all of them:
   a fan of "whiskers" is swept through the belt and the clear direction
   nearest the wanted one is flown instead. When a rock is less than about
   a second away the pilot also brakes and slides sideways, because at
   200 m/s turning the nose alone takes too long to move the velocity.

   The trigger is tested every step against the true lead point, not the
   noisy one the pilot steers by, so an enemy never wastes a burst it could
   not have landed — the aim error only decides how close it gets. */

import { NEUTRAL_CONTROLS, forward } from './flight.js';
import { leadPoint } from './weapons.js';
import { densityAt } from './field.js';
import { ENEMY_CANNON } from './config.js';
import { makeRng } from './rng.js';
import {
  addScaled, clamp, cross, dot, len, normalize, qRotate, qRotateInv, scale, sub,
} from './vec.js';

const THINK = 1 / 20;
const ATTACK_RANGE = 1200, BREAK_RANGE = 150, ATTACK_TIME = 6;
const FIRE_CONE = 4 * Math.PI / 180;

export function createBrain(seed) {
  const rng = makeRng(seed);
  return {
    // Each pilot's first decision lands at a random point in the 1/20 s
    // cycle, so a wave of ten does not all think on the same step.
    state: 'approach', timer: 0, rng, think: rng.range(0, THINK),
    burstOn: false, burstTimer: 0, aim: [0, 0, 0], aimTimer: 0,
    breakDir: [0, 1, 0], extend: 700, jink: { strafe: 0, lift: 0, roll: 0, pitch: 0 }, jinkTimer: 0,
    wasLocked: false, lastControls: { ...NEUTRAL_CONTROLS, fire: false },
  };
}

const tmpA = [0, 0, 0], tmpB = [0, 0, 0];

/* Stick inputs that turn the nose toward a world direction, banking into
   large turns the way a pilot rolls the target onto the lift vector. */
function steer(c, ship, dir) {
  if (len(dir) < 1e-9) { c.pitch = 0; c.yaw = 0; c.roll = 0; return; }
  const d = qRotateInv(tmpA, ship.q, dir);
  const off = Math.acos(clamp(-d[2], -1, 1));
  c.pitch = clamp(Math.atan2(d[1], -d[2]) * 2.5, -1, 1);
  c.yaw = clamp(Math.atan2(d[0], -d[2]) * 2.5, -1, 1);
  c.roll = off > 20 * Math.PI / 180 ? clamp(Math.atan2(d[0], d[1]) * 1.5, -1, 1) : 0;
}

/* Rock avoidance. Returns the direction to fly and fills strafe, lift and
   throttle overrides when the danger is close. */
function avoid(me, field, want, c) {
  const ship = me.ship;
  const speed = len(ship.vel);
  const horizon = clamp(speed / 50, 1.6, 3.2);
  const reach = Math.max(120, speed * horizon) + 40;
  const R = me.radius + 14;
  const p0 = ship.pos;
  const vHat = speed > 3 ? scale([0, 0, 0], ship.vel, 1 / speed) : forward([0, 0, 0], ship);
  const clearance = dir => {
    const hit = field.sweepSphere(p0, addScaled(tmpB, p0, dir, reach), R);
    return hit ? hit.t : 1;
  };
  const tVel = clearance(vHat);
  const tWant = clearance(want);
  let chosen = want;
  if (tVel < 1 || tWant < 1) {
    // Whiskers: the wanted direction and the current velocity, each bent
    // 25°, 50° and 80° four ways in the ship's frame.
    const up = qRotate([0, 0, 0], ship.q, [0, 1, 0]);
    const right = qRotate([0, 0, 0], ship.q, [1, 0, 0]);
    let best = -Infinity;
    for (const base of [want, vHat]) {
      for (const angle of [0, 25, 50, 80]) {
        const a = angle * Math.PI / 180;
        const axes = angle === 0 ? [up] : [up, right, scale([0, 0, 0], up, -1), scale([0, 0, 0], right, -1)];
        for (const axis of axes) {
          const dir = normalize([0, 0, 0], addScaled([0, 0, 0], scale([0, 0, 0], base, Math.cos(a)), axis, Math.sin(a)));
          const t = clearance(dir);
          const score = t * 3 + dot(dir, want) * 0.6 + dot(dir, vHat) * 0.9;
          if (score > best) { best = score; chosen = dir; }
        }
      }
    }
    const impact = tVel * reach / Math.max(speed, 1);
    if (impact < 1.4) {
      // Close: brake and slide toward the clear side with the lateral thrusters.
      const local = qRotateInv([0, 0, 0], ship.q, chosen);
      c.strafe = clamp(local[0] * 3, -1, 1);
      c.lift = clamp(local[1] * 3, -1, 1);
      c.throttleSet = impact < 0.8 ? -0.35 : 0.15;
      c.boost = false;
    }
  }
  // Anything already alongside: push straight away from it.
  const near = field.queryRadius(p0, me.radius + 30);
  for (const h of near) {
    const away = sub([0, 0, 0], p0, h.pos);
    const local = qRotateInv([0, 0, 0], ship.q, normalize(away, away));
    c.strafe = clamp(c.strafe + local[0] * 2, -1, 1);
    c.lift = clamp(c.lift + local[1] * 2, -1, 1);
    if (local[2] > 0.3) c.throttleSet = Math.min(c.throttleSet ?? 1, -0.35);
  }
  return chosen;
}

function think(brain, me, ctx) {
  const rng = brain.rng, ship = me.ship, player = ctx.player;
  const c = { ...NEUTRAL_CONTROLS, fire: false };
  const toPlayer = sub([0, 0, 0], player.ship.pos, ship.pos);
  const range = len(toPlayer);
  const threat = ctx.threat ?? {};

  const newlyLocked = threat.locked && !brain.wasLocked;
  brain.wasLocked = !!threat.locked;
  if (brain.state !== 'evade' && (threat.missileInbound || ctx.wasHit || newlyLocked)) {
    brain.state = 'evade'; brain.timer = rng.range(1.5, 3); brain.jinkTimer = 0;
  }

  let want = normalize([0, 0, 0], toPlayer);
  switch (brain.state) {
    case 'approach':
      c.throttleSet = 1;
      c.boost = range > 2000;
      if (range < ATTACK_RANGE) { brain.state = 'attack'; brain.timer = 0; }
      break;
    case 'attack': {
      brain.timer += THINK;
      brain.aimTimer -= THINK;
      if (brain.aimTimer <= 0) {
        brain.aimTimer = 0.5;
        rng.unit(brain.aim);
        scale(brain.aim, brain.aim, range * 0.004 * rng.gauss());
      }
      const lead = leadPoint([0, 0, 0], ship.pos, ship.vel, player.ship.pos, player.ship.vel, ENEMY_CANNON.speed);
      if (lead) want = normalize(want, sub(tmpA, addScaled(tmpA, lead, brain.aim, 1), ship.pos));
      c.throttleSet = clamp(range / 900, 0.35, 0.9);
      if (range < BREAK_RANGE || brain.timer > ATTACK_TIME) {
        brain.state = 'breakoff';
        const side = cross([0, 0, 0], toPlayer, rng.unit([0, 0, 0]));
        if (len(side) < 1e-6) rng.unit(side);
        normalize(brain.breakDir, side);
        brain.extend = rng.range(600, 900);
      }
      break;
    }
    case 'breakoff': {
      const away = scale([0, 0, 0], normalize([0, 0, 0], toPlayer), -0.6);
      want = normalize(want, addScaled(away, away, brain.breakDir, 1));
      if (len(want) < 1e-9) want = [...brain.breakDir];
      c.throttleSet = 1;
      if (range > brain.extend) brain.state = 'approach';
      break;
    }
    case 'evade': {
      brain.timer -= THINK;
      brain.jinkTimer -= THINK;
      if (brain.jinkTimer <= 0) {
        brain.jinkTimer = rng.range(0.3, 0.5);
        brain.jink = {
          strafe: rng.pick([-1, 1]), lift: rng.pick([-1, 1]),
          roll: rng.range(-1, 1), pitch: rng.range(-0.6, 0.6),
        };
      }
      const side = cross([0, 0, 0], toPlayer, qRotate(tmpB, ship.q, [0, 1, 0]));
      want = normalize(want, len(side) > 1e-6 ? side : forward([0, 0, 0], ship));
      c.throttleSet = 1;
      c.boost = !!threat.missileInbound;
      c.strafe = brain.jink.strafe;
      c.lift = brain.jink.lift;
      if (brain.timer <= 0 && !threat.missileInbound) brain.state = range < ATTACK_RANGE ? 'attack' : 'approach';
      break;
    }
  }

  // Slower through crowded rock, whatever the state wants.
  const density = densityAt(ship.pos[0], ship.pos[1], ship.pos[2], ctx.field.seed, ctx.field.cfg);
  const cap = 1 - 0.5 * density;
  if (c.throttleSet != null && c.throttleSet > cap) c.throttleSet = cap;
  if (density > 0.35) c.boost = false;

  const fly = avoid(me, ctx.field, want, c);
  steer(c, ship, fly);
  if (brain.state === 'evade' && fly === want) { c.roll = brain.jink.roll; c.pitch = clamp(c.pitch + brain.jink.pitch, -1, 1); }
  return c;
}

function fireGate(brain, me, ctx) {
  if (brain.state !== 'attack') return false;
  const ship = me.ship, player = ctx.player;
  const range = len(sub(tmpA, player.ship.pos, ship.pos));
  if (range > ATTACK_RANGE) return false;
  const lead = leadPoint([0, 0, 0], ship.pos, ship.vel, player.ship.pos, player.ship.vel, ENEMY_CANNON.speed);
  if (!lead) return false;
  const to = normalize(lead, sub(lead, lead, ship.pos));
  return Math.acos(clamp(dot(to, forward(tmpB, ship)), -1, 1)) <= FIRE_CONE;
}

export function thinkEnemy(brain, me, ctx, dt) {
  brain.think -= dt;
  if (brain.think <= 0) {
    brain.think += THINK;
    if (brain.think <= 0) brain.think = THINK;
    brain.lastControls = think(brain, me, ctx);
  }
  // Bursts and the trigger run every step.
  brain.burstTimer -= dt;
  if (brain.burstTimer <= 0) {
    brain.burstOn = !brain.burstOn;
    const span = brain.burstOn ? ENEMY_CANNON.burst : ENEMY_CANNON.pause;
    brain.burstTimer = brain.rng.range(span[0], span[1]);
  }
  const c = brain.lastControls;
  c.fire = brain.burstOn && fireGate(brain, me, ctx);
  return c;
}
