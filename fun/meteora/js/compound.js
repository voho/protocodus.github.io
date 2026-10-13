/* Meteora — large ships as sets of spheres.

   A freighter, a station or a capital ship collides as the spheres its
   model's `col_*` empties describe, held in the ship's own frame and
   carried by its position and orientation. Every query works in that local
   frame: a swept bolt is turned into the ship's frame once and tested
   against each sphere, so a kilometre-long hull costs a few dozen
   segment–sphere tests, not a mesh.

   Subsystems are points with a hit radius, also local. A hit that lands
   within a subsystem's radius (plus a small margin, since the spheres hug
   the hull from outside) damages it. */

import { qRotate, qRotateInv } from './vec.js';

const a = [0, 0, 0], b = [0, 0, 0], d = [0, 0, 0], tmp = [0, 0, 0];

/* World position of a local point on an entity. */
export function toWorld(o, entity, local) {
  qRotate(o, entity.ship.q, local);
  o[0] += entity.ship.pos[0]; o[1] += entity.ship.pos[1]; o[2] += entity.ship.pos[2];
  return o;
}
/* Local position of a world point. */
export function toLocal(o, entity, world) {
  tmp[0] = world[0] - entity.ship.pos[0]; tmp[1] = world[1] - entity.ship.pos[1]; tmp[2] = world[2] - entity.ship.pos[2];
  return qRotateInv(o, entity.ship.q, tmp);
}

// Entry parameter of segment p0 + d·t (t in 0…1) into sphere (c, R); 0 if it
// starts inside, −1 for a miss.
function segmentSphere(p0, dd, A, c, R) {
  const mx = p0[0] - c[0], my = p0[1] - c[1], mz = p0[2] - c[2];
  const C = mx * mx + my * my + mz * mz - R * R;
  if (C <= 0) return 0;
  if (A < 1e-12) return -1;
  const B = 2 * (mx * dd[0] + my * dd[1] + mz * dd[2]);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : -1;
}

/* The first collider a world segment p0→p1, thickened by `r`, enters:
   { t, local (hit point, local), collider } or null. Cheap rejection by the
   entity's bounding sphere first. */
export function sweepCompound(entity, p0, p1, r = 0) {
  const R = entity.radius + r;
  const s = entity.ship.pos;
  // Bounding-sphere test in world space.
  d[0] = p1[0] - p0[0]; d[1] = p1[1] - p0[1]; d[2] = p1[2] - p0[2];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (segmentSphere(p0, d, A, s, R) < 0) return null;
  toLocal(a, entity, p0);
  toLocal(b, entity, p1);
  d[0] = b[0] - a[0]; d[1] = b[1] - a[1]; d[2] = b[2] - a[2];
  let best = Infinity, hit = null;
  for (const c of entity.colliders) {
    const t = segmentSphere(a, d, A, c.pos, c.r + r);
    if (t >= 0 && t < best) { best = t; hit = c; }
  }
  if (!hit) return null;
  return { t: best, local: [a[0] + d[0] * best, a[1] + d[1] * best, a[2] + d[2] * best], collider: hit };
}

/* Every collider a world sphere (centre, r) overlaps, deepest first:
   [{ n (world, out of the collider), depth, collider }]. */
export function overlapCompound(entity, centre, r, out = []) {
  out.length = 0;
  const s = entity.ship.pos;
  const dx = centre[0] - s[0], dy = centre[1] - s[1], dz = centre[2] - s[2];
  if (dx * dx + dy * dy + dz * dz > (entity.radius + r) ** 2) return out;
  toLocal(a, entity, centre);
  for (const c of entity.colliders) {
    const ex = a[0] - c.pos[0], ey = a[1] - c.pos[1], ez = a[2] - c.pos[2];
    const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const depth = c.r + r - dist;
    if (depth <= 0) continue;
    const n = dist > 1e-9 ? [ex / dist, ey / dist, ez / dist] : [0, 1, 0];
    out.push({ n: qRotate([0, 0, 0], entity.ship.q, n), depth, collider: c });
  }
  out.sort((p, q) => q.depth - p.depth);
  return out;
}

/* Distance from a world point to the nearest collider surface (negative
   inside), for blasts and the beam. */
export function surfaceDistance(entity, point) {
  toLocal(a, entity, point);
  let best = Infinity;
  for (const c of entity.colliders) {
    const dist = Math.hypot(a[0] - c.pos[0], a[1] - c.pos[1], a[2] - c.pos[2]) - c.r;
    if (dist < best) best = dist;
  }
  return best;
}

/* The live subsystem a local hit point falls on, nearest centre first. */
export function subsystemAt(entity, local, margin = 6) {
  let best = null, bestD = Infinity;
  for (const sub of entity.subsystems) {
    if (!sub.alive) continue;
    const dist = Math.hypot(local[0] - sub.pos[0], local[1] - sub.pos[1], local[2] - sub.pos[2]);
    if (dist <= sub.r + margin && dist < bestD) { best = sub; bestD = dist; }
  }
  return best;
}

export const subsystemWorld = (o, entity, sub) => toWorld(o, entity, sub.pos);
