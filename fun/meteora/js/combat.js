/* Meteora — the rules of the fight.

   Shields take damage before the hull and come back on their own after a
   few quiet seconds; the hull never does. Enemies arrive in waves that grow
   by one ship each time up to ten, spawned out of the player's view so the
   first sign of a wave is the radar, not a ship popping into existence.

   Collisions are momentum, not scripted bounces: the ship is pushed out of
   the rock, keeps 35 % of the speed it hit with and 85 % of its slide, and
   anything faster than a docking bump (8 m/s) costs hull. */

import { COMBAT } from './config.js';
import { dot, len, normalize, sub } from './vec.js';

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

function bounce(entity, normal, otherVel, events, contact) {
  const C = COMBAT.collision, vel = entity.ship.vel;
  const rel = sub([0, 0, 0], vel, otherVel);
  const approach = -dot(rel, normal);
  if (approach <= 0) return 0;
  const along = dot(rel, normal);
  for (let k = 0; k < 3; k++) {
    const tangent = rel[k] - normal[k] * along;
    vel[k] = otherVel[k] + tangent * C.friction + normal[k] * approach * C.restitution;
  }
  const damage = Math.max(0, approach - C.safe) * C.perMs;
  if (damage > 0) applyDamage(entity, damage, events, contact, normal);
  events.push({ type: 'collision', id: entity.id, team: entity.team, speed: approach, pos: contact });
  return approach;
}

const still = [0, 0, 0];
export function resolveShipRock(entity, field, events) {
  const ship = entity.ship;
  for (const h of field.queryRadius(ship.pos, entity.radius)) {
    const n = normalize([0, 0, 0], sub([0, 0, 0], ship.pos, h.pos));
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) n[1] = 1;
    const reach = h.radius + entity.radius;
    for (let k = 0; k < 3; k++) ship.pos[k] = h.pos[k] + n[k] * reach;
    const contact = h.pos.map((c, k) => c + n[k] * h.radius);
    bounce(entity, n, h.kind === 'dynamic' ? h.rock.vel : still, events, contact);
  }
}

export function resolveShipShip(a, b, events) {
  const d = sub([0, 0, 0], a.ship.pos, b.ship.pos);
  const dist = len(d), reach = a.radius + b.radius;
  if (dist >= reach) return;
  const n = dist > 1e-9 ? normalize(d, d) : [0, 1, 0];
  const push = (reach - dist) / 2;
  for (let k = 0; k < 3; k++) { a.ship.pos[k] += n[k] * push; b.ship.pos[k] -= n[k] * push; }
  const contact = b.ship.pos.map((c, k) => c + n[k] * b.radius);
  const va = [...a.ship.vel], vb = [...b.ship.vel];
  // Equal masses: each bounces off the other's pre-impact velocity.
  bounce(a, n, vb, events, contact);
  bounce(b, n.map(v => -v), va, events, contact);
}
