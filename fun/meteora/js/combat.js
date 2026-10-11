/* Meteora — the rules of the fight.

   Shields take damage before the hull and come back on their own after a
   few quiet seconds; the hull never does. Enemies arrive in waves that grow
   by one ship each time up to ten, spawned out of the player's view so the
   first sign of a wave is the radar, not a ship popping into existence.

   Collisions are momentum, not scripted bounces (see physics.js): ships and
   drifting fragments have mass, so ramming a pebble shoves it and a heavy
   fighter shoves a light interceptor; a scrape along a rock spins the ship
   through friction; 35 % of the closing speed comes back as bounce, and
   anything faster than a docking bump (8 m/s) costs hull. */

import { COMBAT } from './config.js';
import { dot, len, normalize, sub } from './vec.js';
import { STATIC, pointBody, resolveContact, shipBody } from './physics.js';
import { rockMass } from './field.js';

export function applyDamage(entity, amount, events = [], point = null, dir = null) {
  if (!entity.alive || !(amount > 0)) return { shield: 0, hull: 0, killed: false };
  entity.sinceHit = 0;
  const shield = Math.min(entity.shield, amount);
  entity.shield -= shield;
  const hull = Math.min(entity.hull, amount - shield);
  entity.hull -= hull;
  const killed = entity.hull <= 0;
  if (killed) entity.alive = false;
  events.push({
    type: 'shipHit', id: entity.id, team: entity.team, shield: shield > 0, hull: hull > 0,
    pos: point ?? (entity.ship ? [...entity.ship.pos] : null), dir,
  });
  return { shield, hull, killed };
}

export function stepShield(entity, dt) {
  entity.sinceHit += dt;
  const S = entity.stats;
  if (entity.alive && entity.sinceHit >= S.shieldDelay && entity.shield < entity.maxShield) {
    entity.shield = Math.min(entity.maxShield, entity.shield + S.shieldRegen * dt);
  }
}

export const waveSize = k => Math.min(COMBAT.wave.base + k, COMBAT.wave.cap);
export const scoreKill = wave => COMBAT.score.kill * wave;
export const scoreRock = type => COMBAT.score.rock[type] ?? 0;

/* A loose formation somewhere the player is not looking: one bearing at
   least 15° outside the view cone, each ship scattered a little around it. */
export function spawnPoints(rng, playerPos, playerFwd, n) {
  const cone = COMBAT.wave.viewCone;
  const angleTo = d => Math.acos(Math.max(-1, Math.min(1, dot(d, playerFwd))));
  const base = [0, 0, 0];
  do rng.unit(base); while (angleTo(base) < cone + 15 * Math.PI / 180);
  const points = [];
  while (points.length < n) {
    const d = rng.unit([0, 0, 0]);
    for (let k = 0; k < 3; k++) d[k] = base[k] + d[k] * 0.12;
    normalize(d, d);
    if (angleTo(d) <= cone) continue;
    const r = rng.range(COMBAT.wave.near, COMBAT.wave.far);
    points.push([playerPos[0] + d[0] * r, playerPos[1] + d[1] * r, playerPos[2] + d[2] * r]);
  }
  return points;
}

const BEST = 'meteora.best';
export function loadBest(storage) {
  try {
    const n = Number(storage?.getItem(BEST));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}
export function saveBest(storage, score) {
  try {
    if (storage && score > loadBest(storage)) storage.setItem(BEST, String(score));
  } catch { /* private mode or full storage: the best score just isn't kept */ }
}

// Hull damage from a contact, by the closing speed along the normal.
function collisionDamage(entity, approach, events, contact, normal) {
  const C = COMBAT.collision;
  if (approach <= 0) return;
  const damage = Math.max(0, approach - C.safe) * C.perMs;
  if (damage > 0) applyDamage(entity, damage, events, contact, normal);
  events.push({ type: 'collision', id: entity.id, team: entity.team, speed: approach, pos: contact });
}

export function resolveShipRock(entity, field, events) {
  const C = COMBAT.collision, ship = entity.ship;
  for (const h of field.queryRadius(ship.pos, entity.radius)) {
    const n = normalize([0, 0, 0], sub([0, 0, 0], ship.pos, h.pos));
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) n[1] = 1;
    const reach = h.radius + entity.radius;
    const rock = h.kind === 'dynamic' ? h.rock : null;
    if (rock) {
      // Share the overlap by inverse mass: a pebble gives way, a boulder doesn't.
      const im = 1 / ship.stats.mass, ir = 1 / rockMass(rock.radius);
      const depth = reach - Math.sqrt((ship.pos[0] - h.pos[0]) ** 2 + (ship.pos[1] - h.pos[1]) ** 2 + (ship.pos[2] - h.pos[2]) ** 2);
      for (let k = 0; k < 3; k++) { ship.pos[k] += n[k] * depth * im / (im + ir); rock.pos[k] -= n[k] * depth * ir / (im + ir); }
    } else {
      for (let k = 0; k < 3; k++) ship.pos[k] = h.pos[k] + n[k] * reach;
    }
    const arm = [-n[0] * entity.radius, -n[1] * entity.radius, -n[2] * entity.radius];
    const contact = [ship.pos[0] + arm[0], ship.pos[1] + arm[1], ship.pos[2] + arm[2]];
    const other = rock ? pointBody(rock.vel, rockMass(rock.radius)) : STATIC;
    collisionDamage(entity, resolveContact(shipBody(ship), other, n, arm, C.restitution, C.mu), events, contact, n);
  }
}

export function resolveShipShip(a, b, events) {
  const C = COMBAT.collision;
  const d = sub([0, 0, 0], a.ship.pos, b.ship.pos);
  const dist = len(d), reach = a.radius + b.radius;
  if (dist >= reach) return;
  const n = dist > 1e-9 ? normalize(d, d) : [0, 1, 0];
  const ia = 1 / a.ship.stats.mass, ib = 1 / b.ship.stats.mass;
  const depth = reach - dist;
  for (let k = 0; k < 3; k++) {
    a.ship.pos[k] += n[k] * depth * ia / (ia + ib);
    b.ship.pos[k] -= n[k] * depth * ib / (ia + ib);
  }
  const contact = b.ship.pos.map((c, k) => c + n[k] * b.radius);
  // Hulls meet at the rim of their spheres, so the normal impulse passes
  // through both centres; each ship is a point mass here.
  const approach = resolveContact(pointBody(a.ship.vel, a.ship.stats.mass), pointBody(b.ship.vel, b.ship.stats.mass),
    n, [0, 0, 0], C.restitution, C.mu);
  collisionDamage(a, approach, events, contact, n);
  collisionDamage(b, approach, events, contact, n.map(v => -v));
}
