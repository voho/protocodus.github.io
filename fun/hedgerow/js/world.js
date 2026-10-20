/* Hedgerow — the static collision world.

   Colliders are oriented boxes (yaw only) and vertical cylinders, put in a
   uniform XZ grid. The terrain is a heightfield (terrain.js). Everything the
   game asks of the world goes through here:

   * raycast(origin, dir, maxDist, mask)   — bullets, sight lines, camera
   * moveCircle(...)                        — characters walking about
   * groundAt(x, z, feet, step)             — the floor under a character

   Flags: MOVE (blocks walking), SHOT (stops bullets), SIGHT (blocks sight). */

import { clamp } from './util.js';

export const MOVE = 1, SHOT = 2, SIGHT = 4;
const KIND_FLAGS = { solid: MOVE | SHOT | SIGHT, wire: MOVE, soft: SIGHT, ghost: SHOT | SIGHT, walk: MOVE | SHOT | SIGHT };

export function createWorld({ minX, maxX, minZ, maxZ, cell = 8, terrain = null, water = null }) {
  const cols = Math.ceil((maxX - minX) / cell);
  const rows = Math.ceil((maxZ - minZ) / cell);
  const grid = Array.from({ length: cols * rows }, () => []);
  const colliders = [];
  let stamp = 1;

  const cellOf = (x, z) => {
    const cx = clamp(Math.floor((x - minX) / cell), 0, cols - 1);
    const cz = clamp(Math.floor((z - minZ) / cell), 0, rows - 1);
    return [cx, cz];
  };

  /* Add a collider in world space. Box: {type:'box', x,y,z (centre),
     hx,hy,hz, yaw}; cylinder: {type:'cyl', x, y (base), z, r, h}. */
  function add(col) {
    const flags = col.flags ?? KIND_FLAGS[col.kind || 'solid'] ?? KIND_FLAGS.solid;
    col.flags = flags;
    col.stamp = 0;
    col.surface = col.surface || 'stone';
    if (col.type === 'box') {
      col.c = Math.cos(col.yaw || 0);
      col.s = Math.sin(col.yaw || 0);
      const ex = Math.abs(col.c) * col.hx + Math.abs(col.s) * col.hz;
      const ez = Math.abs(col.s) * col.hx + Math.abs(col.c) * col.hz;
      col.minX = col.x - ex; col.maxX = col.x + ex;
      col.minZ = col.z - ez; col.maxZ = col.z + ez;
      col.bottom = col.y - col.hy; col.top = col.y + col.hy;
    } else {
      col.minX = col.x - col.r; col.maxX = col.x + col.r;
      col.minZ = col.z - col.r; col.maxZ = col.z + col.r;
      col.bottom = col.y; col.top = col.y + col.h;
    }
    const [x0, z0] = cellOf(col.minX, col.minZ);
    const [x1, z1] = cellOf(col.maxX, col.maxZ);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) grid[cz * cols + cx].push(col);
    colliders.push(col);
    return col;
  }

  function remove(col) {
    const [x0, z0] = cellOf(col.minX, col.minZ);
    const [x1, z1] = cellOf(col.maxX, col.maxZ);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const list = grid[cz * cols + cx];
      const i = list.indexOf(col);
      if (i >= 0) list.splice(i, 1);
    }
    const i = colliders.indexOf(col);
    if (i >= 0) colliders.splice(i, 1);
  }

  /* Colliders whose XZ bounds overlap a rectangle. */
  function query(x0, z0, x1, z1, out = []) {
    out.length = 0;
    stamp++;
    const [a, b] = cellOf(x0, z0);
    const [c, d] = cellOf(x1, z1);
    for (let cz = b; cz <= d; cz++) for (let cx = a; cx <= c; cx++) {
      for (const col of grid[cz * cols + cx]) {
        if (col.stamp === stamp) continue;
        col.stamp = stamp;
        if (col.maxX < x0 || col.minX > x1 || col.maxZ < z0 || col.minZ > z1) continue;
        out.push(col);
      }
    }
    return out;
  }

  /* ---------- ray tests ---------- */

  // Ray vs oriented box, returns t or Infinity; writes the normal to n.
  function rayBox(col, ox, oy, oz, dx, dy, dz, maxT, n) {
    const c = col.c, s = col.s;
    // world -> local (inverse of three's rotation.y)
    const rx = ox - col.x, rz = oz - col.z;
    const lox = rx * c - rz * s, loz = rx * s + rz * c, loy = oy - col.y;
    const ldx = dx * c - dz * s, ldz = dx * s + dz * c, ldy = dy;
    let tmin = 0, tmax = maxT, axis = -1, sign = 0;
    const slab = (o, d, h, ax) => {
      if (Math.abs(d) < 1e-9) return o >= -h && o <= h;
      let t1 = (-h - o) / d, t2 = (h - o) / d, sg = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = ax; sign = sg; }
      if (t2 < tmax) tmax = t2;
      return tmin <= tmax;
    };
    if (!slab(lox, ldx, col.hx, 0) || !slab(loy, ldy, col.hy, 1) || !slab(loz, ldz, col.hz, 2)) return Infinity;
    if (axis < 0) {
      // origin inside the box
      if (n) { n.x = -dx; n.y = -dy; n.z = -dz; }
      return 0;
    }
    if (n) {
      let lx = 0, ly = 0, lz = 0;
      if (axis === 0) lx = sign; else if (axis === 1) ly = sign; else lz = sign;
      // local -> world
      n.x = lx * c + lz * s; n.y = ly; n.z = -lx * s + lz * c;
    }
    return tmin;
  }

  function rayCyl(col, ox, oy, oz, dx, dy, dz, maxT, n) {
    const px = ox - col.x, pz = oz - col.z;
    const a = dx * dx + dz * dz;
    let t = Infinity, nx = 0, ny = 0, nz = 0;
    if (a > 1e-9) {
      const b = px * dx + pz * dz;
      const cc = px * px + pz * pz - col.r * col.r;
      const disc = b * b - a * cc;
      if (disc >= 0) {
        const tt = (-b - Math.sqrt(disc)) / a;
        if (tt >= 0 && tt <= maxT) {
          const y = oy + dy * tt;
          if (y >= col.bottom && y <= col.top) {
            t = tt; nx = (px + dx * tt) / col.r; nz = (pz + dz * tt) / col.r;
          }
        } else if (cc < 0) {
          // starts inside the circle: test the caps only
        }
      }
    }
    // top cap
    if (Math.abs(dy) > 1e-9) {
      const tt = (col.top - oy) / dy;
      if (tt >= 0 && tt < t && tt <= maxT) {
        const x = px + dx * tt, z = pz + dz * tt;
        if (x * x + z * z <= col.r * col.r) { t = tt; nx = 0; ny = 1; nz = 0; }
      }
    }
    if (n && t < Infinity) { n.x = nx; n.y = ny; n.z = nz; }
    return t;
  }

  const tmpN = { x: 0, y: 0, z: 0 };

  /* Nearest hit along a ray. Returns null or {t, x, y, z, nx, ny, nz,
     collider, surface}. `mask` selects collider flags; terrain is always
     tested unless noTerrain. */
  function raycast(ox, oy, oz, dx, dy, dz, maxT, mask = SHOT, opts = {}) {
    let best = maxT, hit = null, bnx = 0, bny = 1, bnz = 0;
    // walk the grid cells along the ray (2D DDA)
    stamp++;
    let gx = Math.floor((ox - minX) / cell), gz = Math.floor((oz - minZ) / cell);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-9 ? Math.abs(cell / dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-9 ? Math.abs(cell / dz) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-9 ? ((minX + (gx + (dx > 0 ? 1 : 0)) * cell) - ox) / dx : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-9 ? ((minZ + (gz + (dz > 0 ? 1 : 0)) * cell) - oz) / dz : Infinity;
    let tCell = 0;
    for (let guard = 0; guard < 400; guard++) {
      if (gx >= 0 && gx < cols && gz >= 0 && gz < rows) {
        for (const col of grid[gz * cols + gx]) {
          if (col.stamp === stamp) continue;
          col.stamp = stamp;
          if (!(col.flags & mask) || col === opts.ignore) continue;
          const t = col.type === 'box'
            ? rayBox(col, ox, oy, oz, dx, dy, dz, best, tmpN)
            : rayCyl(col, ox, oy, oz, dx, dy, dz, best, tmpN);
          if (t < best) { best = t; hit = col; bnx = tmpN.x; bny = tmpN.y; bnz = tmpN.z; }
        }
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (tNext > best || tNext > maxT) break;
      tCell = tNext;
      if (tMaxX < tMaxZ) { gx += stepX; tMaxX += tDeltaX; } else { gz += stepZ; tMaxZ += tDeltaZ; }
      if ((gx < 0 && stepX < 0) || (gx >= cols && stepX > 0) || (gz < 0 && stepZ < 0) || (gz >= rows && stepZ > 0)) break;
    }
    let surface = hit ? hit.surface : null;
    if (terrain && !opts.noTerrain) {
      const tt = terrain.raycast(ox, oy, oz, dx, dy, dz, best);
      if (tt < best) {
        best = tt; hit = 'terrain';
        const x = ox + dx * tt, z = oz + dz * tt;
        const nn = terrain.normal(x, z);
        bnx = nn[0]; bny = nn[1]; bnz = nn[2];
        surface = terrain.surfaceAt(x, z);
      }
    }
    if (water && !opts.noWater && mask & SHOT) {
      // the water surface stops bullets visually (a splash) only
      if (dy < -1e-4) {
        const tt = (water.level - oy) / dy;
        if (tt > 0 && tt < best && water.contains(ox + dx * tt, oz + dz * tt)) {
          const ground = terrain ? terrain.height(ox + dx * tt, oz + dz * tt) : -Infinity;
          if (ground < water.level) {
            best = tt; hit = 'water'; bnx = 0; bny = 1; bnz = 0; surface = 'water';
          }
        }
      }
    }
    if (!hit) return null;
    return {
      t: best, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best,
      nx: bnx, ny: bny, nz: bnz, collider: hit, surface,
    };
  }

  /* Is the segment between two points clear for this mask? */
  function clear(ax, ay, az, bx, by, bz, mask = SIGHT) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return true;
    return !raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.05, mask, { noWater: true });
  }

  /* ---------- character movement ---------- */

  const near = [];

  /* Highest standable surface under a circle: terrain or collider tops that
     are no higher than feet + step. */
  function groundAt(x, z, feet, step = 0.45, radius = 0.25) {
    let g = terrain ? terrain.height(x, z) : 0;
    query(x - radius, z - radius, x + radius, z + radius, near);
    for (const col of near) {
      if (!(col.flags & MOVE)) continue;
      if (col.top > feet + step + 1e-3) continue;
      if (col.top <= g) continue;
      if (overlapsCircle(col, x, z, radius * 0.6)) g = col.top;
    }
    return g;
  }

  function overlapsCircle(col, x, z, r) {
    if (col.type === 'cyl') {
      const dx = x - col.x, dz = z - col.z;
      return dx * dx + dz * dz <= (col.r + r) * (col.r + r);
    }
    const rx = x - col.x, rz = z - col.z;
    const lx = rx * col.c - rz * col.s, lz = rx * col.s + rz * col.c;
    const qx = Math.max(Math.abs(lx) - col.hx, 0), qz = Math.max(Math.abs(lz) - col.hz, 0);
    return qx * qx + qz * qz <= r * r;
  }

  /* Push a circle (x, z, r) at vertical span [feet + step, feet + height]
     out of blocking colliders. Returns the corrected position in `pos`
     and whether anything was hit. */
  function pushOut(pos, r, feet, height, step, mask = MOVE) {
    let hitAny = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      query(pos.x - r - 0.1, pos.z - r - 0.1, pos.x + r + 0.1, pos.z + r + 0.1, near);
      for (const col of near) {
        if (!(col.flags & mask)) continue;
        if (col.top <= feet + step || col.bottom >= feet + height) continue;
        if (col.type === 'cyl') {
          const dx = pos.x - col.x, dz = pos.z - col.z;
          const d = Math.hypot(dx, dz);
          const min = col.r + r;
          if (d < min) {
            const k = d > 1e-6 ? (min - d) / d : 0;
            pos.x += d > 1e-6 ? dx * k : min;
            pos.z += d > 1e-6 ? dz * k : 0;
            moved = hitAny = true;
          }
        } else {
          const rx = pos.x - col.x, rz = pos.z - col.z;
          let lx = rx * col.c - rz * col.s, lz = rx * col.s + rz * col.c;
          const cx = clamp(lx, -col.hx, col.hx), cz = clamp(lz, -col.hz, col.hz);
          let ddx = lx - cx, ddz = lz - cz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < r * r) {
            if (d2 > 1e-10) {
              const d = Math.sqrt(d2);
              lx = cx + (ddx / d) * r;
              lz = cz + (ddz / d) * r;
            } else {
              // centre inside: leave by the nearest face
              const px = col.hx - Math.abs(lx), pz = col.hz - Math.abs(lz);
              if (px < pz) lx = Math.sign(lx || 1) * (col.hx + r);
              else lz = Math.sign(lz || 1) * (col.hz + r);
            }
            pos.x = col.x + lx * col.c + lz * col.s;
            pos.z = col.z - lx * col.s + lz * col.c;
            moved = hitAny = true;
          }
        }
      }
      if (!moved) break;
    }
    return hitAny;
  }

  /* The top of the lowest obstacle in front of a character (for vaulting):
     probes a point `reach` ahead. Returns {top, col} or null. */
  function obstacleAhead(x, z, dirX, dirZ, feet, reach = 0.75, r = 0.3) {
    const px = x + dirX * reach, pz = z + dirZ * reach;
    query(px - r, pz - r, px + r, pz + r, near);
    let best = null;
    for (const col of near) {
      if (!(col.flags & MOVE)) continue;
      if (col.top <= feet + 0.3 || col.bottom > feet + 1.0) continue;
      if (!overlapsCircle(col, px, pz, r)) continue;
      if (!best || col.top > best.top) best = { top: col.top, col };
    }
    // terrain step
    if (terrain) {
      const h = terrain.height(px, pz);
      if (h > feet + 0.5 && (!best || h > best.top)) best = { top: h, col: null };
    }
    return best;
  }

  /* Deep water blocks walking — unless something to stand on (a bridge
     deck, a fallen tree) is under the feet. */
  function tooDeep(x, z, maxDepth, feet = water ? water.level : 0) {
    if (!water || !terrain) return false;
    if (!water.contains(x, z)) return false;
    if (water.level - terrain.height(x, z) <= maxDepth) return false;
    return groundAt(x, z, Math.max(feet, water.level), 0.5) < water.level - maxDepth;
  }

  function waterDepth(x, z, ground) {
    if (!water || !water.contains(x, z)) return 0;
    return Math.max(0, water.level - ground);
  }

  return {
    add, remove, query, raycast, clear, groundAt, pushOut, obstacleAhead, tooDeep, waterDepth,
    colliders, terrain, water, bounds: { minX, maxX, minZ, maxZ },
  };
}
