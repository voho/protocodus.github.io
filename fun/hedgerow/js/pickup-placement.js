// A dead soldier's small supply box stays on his local, reachable floor.
import { MOVE, SHOT } from './world.js';
const STEP = .45, MAX_SUPPORT = 48;
const OFFSETS = [[.6, .3], [.3, .15], [0, 0], [-.3, -.15], [-.3, .15], [.3, -.15]];
const PHYSICAL = MOVE | SHOT;

// The real master terrain is linear per triangle. Its X/Z/diagonal events
// plus rectangle edges bound the entire footprint, including a short crest.
function support(world, left, near, right, far, reference, endpoint = true) {
  const points = [], keys = new Set();
  const add = (x, z) => {
    const key = `${x},${z}`;
    if (!keys.has(key)) { keys.add(key); points.push([x, z]); }
    return points.length <= MAX_SUPPORT;
  };
  const xs = [left, right], zs = [near, far], grid = world.terrain?.grid;
  if (grid?.res > 0) {
    for (const [values, low, high, origin] of [[xs, left, right, grid.minX], [zs, near, far, grid.minZ]]) {
      for (let k = Math.ceil((low - origin) / grid.res); k <= Math.floor((high - origin) / grid.res); k++) {
        values.push(origin + k * grid.res);
        if (values.length > MAX_SUPPORT) return null;
      }
    }
  }
  if (!add((left + right) / 2, (near + far) / 2)) return null;
  for (const x of xs) for (const z of zs) if (!add(x, z)) return null;
  if (grid?.res > 0) {
    const origin = grid.minX + grid.minZ;
    let crossed = 0;
    for (let k = Math.ceil((left + near - origin) / grid.res); k <= Math.floor((right + far - origin) / grid.res); k++) {
      if (++crossed > MAX_SUPPORT) return null;
      const sum = origin + k * grid.res;
      for (const x of [left, right]) { const z = sum - x; if (z >= near && z <= far && !add(x, z)) return null; }
      for (const z of [near, far]) { const x = sum - z; if (x >= left && x <= right && !add(x, z)) return null; }
    }
  }
  let low = Infinity, high = -Infinity;
  for (const [x, z] of points) {
    const y = world.groundAt(x, z, reference, STEP, 0);
    if (!Number.isFinite(y) || y > reference + STEP + .001 || (endpoint && y < reference - STEP - .001)) return null;
    low = Math.min(low, y); high = Math.max(high, y);
  }
  return { low, high };
}

// Conservative swept disc: expanded OBB corners may reject an uncertain
// offset, but a thin wall/corner can never disappear between sampled poses.
function crosses(col, ax, az, bx, bz, radius) {
  if (col.type === 'cyl') {
    const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
    const t = length2 ? Math.max(0, Math.min(1, ((col.x - ax) * dx + (col.z - az) * dz) / length2)) : 0;
    return (ax + dx * t - col.x) ** 2 + (az + dz * t - col.z) ** 2 <= (radius + col.r) ** 2;
  }
  const c = col.c, s = col.s, rx = ax - col.x, rz = az - col.z;
  const x = rx * c - rz * s, z = rx * s + rz * c;
  const dx = (bx - ax) * c - (bz - az) * s, dz = (bx - ax) * s + (bz - az) * c;
  let lo = 0, hi = 1;
  for (const [p, d, half] of [[x, dx, col.hx + radius], [z, dz, col.hz + radius]]) {
    if (Math.abs(d) < 1e-12) { if (Math.abs(p) > half) return false; continue; }
    let a = (-half - p) / d, b = (half - p) / d;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a); hi = Math.min(hi, b);
    if (lo > hi) return false;
  }
  return true;
}

export function deathDropPoint(world, death, box, scale = 1) {
  if (!world?.groundAt || !world?.pushOut || !world?.query || !box?.min || !box?.max) return null;
  const min = { x: box.min.x * scale, y: box.min.y * scale, z: box.min.z * scale };
  const max = { x: box.max.x * scale, y: box.max.y * scale, z: box.max.z * scale };
  if (![death.x, death.y, death.z, ...Object.values(min), ...Object.values(max)].every(Number.isFinite) || !(scale > 0)) return null;
  const cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;
  const radius = Math.hypot((max.x - min.x) / 2, (max.z - min.z) / 2), height = max.y - min.y;
  if (!(radius > 0 && radius <= .5 && height > 0 && height <= 1)) return null;
  for (const [dx, dz] of OFFSETS) {
    const x = death.x + dx, z = death.z + dz;
    const foot = support(world, x + min.x, z + min.z, x + max.x, z + max.z, death.y);
    if (!foot) continue;
    const point = { x: x + cx, z: z + cz };
    const overlap = world.pushOut(point, radius, foot.high, height, 0, PHYSICAL);
    if (overlap || Math.hypot(point.x - x - cx, point.z - z - cz) > 1e-6) continue;
    const left = Math.min(death.x, x) + min.x, right = Math.max(death.x, x) + max.x;
    const near = Math.min(death.z, z) + min.z, far = Math.max(death.z, z) + max.z;
    const floor = support(world, left, near, right, far, death.y, false);
    if (!floor) continue;
    const nearby = world.query(left - radius, near - radius, right + radius, far + radius);
    const lifted = Math.max(death.y, foot.high, floor.high);
    const blocked = nearby.some(col => (col.flags & PHYSICAL) && col.top > lifted && col.bottom < lifted + height &&
      crosses(col, death.x + cx, death.z + cz, x + cx, z + cz, radius));
    if (!blocked) return { x, y: foot.high - min.y, z };
  }
  return null;
}
