/* Meteora — the rules of the fight.

   Shields take damage before the hull and come back on their own after a
   few quiet seconds; the hull never does (only a Tender mends it). A ship's
   shield is four quadrants — front, rear, left, right — each a quarter of
   the whole: a hit drains the quadrant facing it, overflow goes through to
   the hull. Quadrants recharge together and slowly level out, and the pilot
   can level them at once. Capital ships' shields hang on their generator
   subsystems: lose every generator and the shield falls for good.

   Weapons carry multipliers against shields, hulls and rock and a
   `pierce`; armour takes `armour × (1 − pierce)` off the hull damage. A hit
   inside a subsystem damages the subsystem (with the subsystem's armour)
   and the hull at half weight. "Exposed" subsystems — turrets, generators,
   bays — sit outside the shield and take hits whatever the shield holds.

   Collisions are momentum, not scripted bounces (see physics.js): ships and
   drifting fragments have mass, so ramming a pebble shoves it and a heavy
   fighter shoves a light interceptor; a scrape along a rock spins the ship
   through friction; 35 % of the closing speed comes back as bounce, and
   anything faster than a docking bump (8 m/s) costs hull. Small craft
   bounce off large ships' collision spheres the same way. */

import { COMBAT } from './config.js';
import { dot, len, normalize, qRotateInv, sub } from './vec.js';
import { STATIC, pointBody, resolveContact, shipBody } from './physics.js';
import { rockMass } from './field.js';
import { overlapCompound } from './compound.js';

export const FRONT = 0, REAR = 1, LEFT = 2, RIGHT = 3;
const local = [0, 0, 0];

/* Which quadrant faces a world point (or, failing that, the reverse of
   the incoming direction). */
export function quadrantOf(entity, point, dir) {
  if (!entity.ship) return FRONT;
  if (point) {
    local[0] = point[0] - entity.ship.pos[0]; local[1] = point[1] - entity.ship.pos[1]; local[2] = point[2] - entity.ship.pos[2];
  } else if (dir) {
    local[0] = -dir[0]; local[1] = -dir[1]; local[2] = -dir[2];
  } else return FRONT;
  qRotateInv(local, entity.ship.q, local);
  if (Math.abs(local[2]) >= Math.abs(local[0])) return local[2] < 0 ? FRONT : REAR;
  return local[0] < 0 ? LEFT : RIGHT;
}

/* Give an entity quadrant shields of `total`. */
export function initShields(entity, total) {
  entity.maxShield = total;
  entity.quad = [total / 4, total / 4, total / 4, total / 4];
  entity.shield = total;
}
const sumQuad = e => e.quad[0] + e.quad[1] + e.quad[2] + e.quad[3];

/* Level the quadrants at once (the pilot's X). */
export function equalizeShields(entity) {
  if (!entity.quad) return;
  const each = sumQuad(entity) / 4;
  entity.quad.fill(each);
}

const generatorsDown = e => e.generators > 0 && !e.subsystems.some(s => s.kind === 'shield' && s.alive);

/* `o` (all optional): weapon (multipliers and pierce), sub (the subsystem
   hit), sourceTeam and sourceId (credit and difficulty), scale (a damage
   multiplier the caller already decided). */
export function applyDamage(entity, amount, events = [], point = null, dir = null, o = {}) {
  if (!entity.alive || !(amount > 0) || entity.invulnerable || entity.folding) return { shield: 0, hull: 0, killed: false };
  const w = o.weapon;
  if (o.scale) amount *= o.scale;
  // Ion scrambles the emitters: the shield waits longer before recharging.
  entity.sinceHit = w?.scramble ? Math.min(entity.sinceHit, -w.scramble) : 0;
  if (o.sourceId != null) { entity.lastHitBy = o.sourceId; entity.lastHitTeam = o.sourceTeam; }
  const exposed = o.sub && o.sub.exposed;
  const shieldMul = w?.shieldMul ?? 1;
  let rest = amount, shield = 0, quadrant = -1;
  if (!exposed && shieldMul > 0) {
    if (entity.quad) {
      quadrant = quadrantOf(entity, point, dir);
      const want = rest * shieldMul;
      const take = Math.min(entity.quad[quadrant], want);
      entity.quad[quadrant] -= take;
      entity.shield = sumQuad(entity);
      shield = take;
      rest = (want - take) / shieldMul;
    } else if (entity.shield > 0) {
      const want = rest * shieldMul;
      const take = Math.min(entity.shield, want);
      entity.shield -= take;
      shield = take;
      rest = (want - take) / shieldMul;
    }
  }
  let hull = 0, subDamage = 0, subKilled = false;
  if (rest > 1e-9) {
    const mul = entity.rock ? (w?.rockMul ?? 1) : (w?.hullMul ?? 1);
    const pierce = w?.pierce ?? 0;
    const target = o.sub && o.sub.alive ? o.sub : null;
    const armor = target ? (target.armor ?? entity.armor ?? 0) : (entity.armor ?? 0);
    const dealt = rest * mul * (1 - armor * (1 - pierce));
    if (target) {
      subDamage = Math.min(target.hull, dealt);
      target.hull -= subDamage;
      if (target.hull <= 1e-6) {
        target.hull = 0; target.alive = false; subKilled = true;
        events.push({ type: 'subsystemDestroyed', id: entity.id, team: entity.team, sub: target.name, kind: target.kind, pos: point, by: o.sourceTeam ?? null, byId: o.sourceId ?? null });
        if (target.kind === 'shield' && generatorsDown(entity)) {
          entity.quad?.fill(0); entity.shield = 0;
          events.push({ type: 'shieldsCollapse', id: entity.id, team: entity.team });
        }
      }
      hull = Math.min(entity.hull, dealt * 0.5);
    } else {
      hull = Math.min(entity.hull, dealt);
    }
    entity.hull -= hull;
  }
  const killed = entity.hull <= 1e-6 && !entity.unkillable;
  if (entity.unkillable && entity.hull < 1) entity.hull = 1;
  if (killed) { entity.hull = 0; entity.alive = false; }
  events.push({
    type: 'shipHit', id: entity.id, team: entity.team, shield: shield > 0, hull: hull > 0 || subDamage > 0,
    quadrant, sub: o.sub?.name ?? null, subKilled, amount: shield + hull + subDamage,
    pos: point ?? (entity.ship ? [...entity.ship.pos] : null), dir, by: o.sourceTeam ?? null, byId: o.sourceId ?? null,
  });
  return { shield, hull, sub: subDamage, killed };
}

/* Recharge after a quiet spell. Quadrant shields recharge evenly and level
   out by a tenth of their spread a second. */
export function stepShield(entity, dt) {
  entity.sinceHit += dt;
  if (!entity.alive) return;
  const S = entity.stats ?? {};
  const delay = entity.shieldDelay ?? S.shieldDelay ?? 3;
  const regen = entity.shieldRegen ?? S.shieldRegen ?? 0;
  if (entity.quad) {
    if (generatorsDown(entity)) return;
    const cap = entity.maxShield / 4;
    if (entity.sinceHit >= delay) {
      for (let k = 0; k < 4; k++) entity.quad[k] = Math.min(cap, entity.quad[k] + regen / 4 * dt);
    }
    const mean = sumQuad(entity) / 4;
    for (let k = 0; k < 4; k++) entity.quad[k] += (mean - entity.quad[k]) * Math.min(1, 0.1 * dt);
    entity.shield = sumQuad(entity);
    return;
  }
  if (entity.sinceHit >= delay && entity.shield < entity.maxShield) {
    entity.shield = Math.min(entity.maxShield, entity.shield + regen * dt);
  }
}

export const waveSize = k => Math.min(COMBAT.wave.base + k, COMBAT.wave.cap);
export const scoreKill = wave => COMBAT.score.kill * wave;
export const scoreRock = type => COMBAT.score.rock[type] ?? 0;

/* A loose formation somewhere the player is not looking: one bearing at
   least 15° outside the view cone, each ship scattered a little around it. */
export function spawnPoints(rng, playerPos, playerFwd, n, near = COMBAT.wave.near, far = COMBAT.wave.far) {
  const cone = COMBAT.wave.viewCone;
  const angleTo = dd => Math.acos(Math.max(-1, Math.min(1, dot(dd, playerFwd))));
  const base = [0, 0, 0];
  do rng.unit(base); while (angleTo(base) < cone + 15 * Math.PI / 180);
  const points = [];
  while (points.length < n) {
    const dd = rng.unit([0, 0, 0]);
    for (let k = 0; k < 3; k++) dd[k] = base[k] + dd[k] * 0.12;
    normalize(dd, dd);
    if (angleTo(dd) <= cone) continue;
    const r = rng.range(near, far);
    points.push([playerPos[0] + dd[0] * r, playerPos[1] + dd[1] * r, playerPos[2] + dd[2] * r]);
  }
  return points;
}

const BEST = 'meteora.best';
export function loadBest(storage, key = BEST) {
  try {
    const n = Number(storage?.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}
export function saveBest(storage, score, key = BEST) {
  try {
    if (storage && score > loadBest(storage, key)) storage.setItem(key, String(score));
  } catch { /* private mode or full storage: the best score just isn't kept */ }
}

// Hull damage from a contact, by the closing speed along the normal.
export function collisionDamage(entity, approach, events, contact, normal, scale = 1) {
  const C = COMBAT.collision;
  if (approach <= 0) return;
  let damage = Math.max(0, approach - C.safe) * C.perMs;
  if (!entity.big && entity.maxHull) damage = Math.min(damage, (entity.maxHull + (entity.maxShield ?? 0) / 4) * C.capShare);
  damage *= scale;
  if (damage > 0) applyDamage(entity, damage, events, contact, normal);
  events.push({ type: 'collision', id: entity.id, team: entity.team, speed: approach, pos: contact });
}

const contacts = [];
export function resolveShipRock(entity, field, events) {
  const C = COMBAT.collision, ship = entity.ship;
  contacts.length = 0;
  for (const h of field.queryRadius(ship.pos, entity.radius, contacts)) {
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
    // Pebbles scratch, boulders hurt: a rock under eight metres does less.
    const scale = Math.min(1, Math.max(C.pebble, h.radius / 8));
    collisionDamage(entity, resolveContact(shipBody(ship), other, n, arm, C.restitution, C.mu), events, contact, n, scale);
  }
}

export function resolveShipShip(a, b, events) {
  const C = COMBAT.collision;
  const dd = sub([0, 0, 0], a.ship.pos, b.ship.pos);
  const dist = len(dd), reach = a.radius + b.radius;
  if (dist >= reach) return;
  const n = dist > 1e-9 ? normalize(dd, dd) : [0, 1, 0];
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
  // Wingmates bumping is a scrape, not a crash: a quarter of the damage.
  const scale = a.team === b.team && a.team >= 0 ? C.friendlyScale : 1;
  collisionDamage(a, approach, events, contact, n, scale);
  collisionDamage(b, approach, events, contact, n.map(v => -v), scale);
}

/* A small craft against a large ship's collision spheres. The large ship
   is pushed by the impulse like anything else, but at its mass it barely
   notices; the small craft is moved out of the deepest overlap and
   bounces with friction and spin, exactly as off a rock. */
const overlaps = [];
export function resolveShipLarge(small, large, events) {
  const C = COMBAT.collision;
  overlapCompound(large, small.ship.pos, small.radius, overlaps);
  if (!overlaps.length) return false;
  const { n, depth } = overlaps[0];
  for (let k = 0; k < 3; k++) small.ship.pos[k] += n[k] * depth;
  const arm = [-n[0] * small.radius, -n[1] * small.radius, -n[2] * small.radius];
  const contact = [small.ship.pos[0] + arm[0], small.ship.pos[1] + arm[1], small.ship.pos[2] + arm[2]];
  const other = large.fixed ? STATIC : pointBody(large.ship.vel, large.ship.stats.mass);
  const approach = resolveContact(shipBody(small.ship), other, n, arm, C.restitution, C.mu);
  collisionDamage(small, approach, events, contact, n);
  // The big ship's plating takes a dent at most.
  if (approach > 25) collisionDamage(large, approach, events, contact, n.map(v => -v), 0.2);
  return true;
}

/* Drifting fragments bounce off large ships, which are far too heavy to
   notice. */
export function resolveRockLarge(rock, large, restitution = 0.5) {
  overlapCompound(large, rock.pos, rock.collide, overlaps);
  if (!overlaps.length) return;
  const { n, depth } = overlaps[0];
  for (let k = 0; k < 3; k++) rock.pos[k] += n[k] * depth;
  const lv = large.ship.vel;
  const vn = (rock.vel[0] - lv[0]) * n[0] + (rock.vel[1] - lv[1]) * n[1] + (rock.vel[2] - lv[2]) * n[2];
  if (vn < 0) for (let k = 0; k < 3; k++) rock.vel[k] -= (1 + restitution) * vn * n[k];
}
