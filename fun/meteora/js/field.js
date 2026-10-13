/* Meteora — the asteroid belt.

   A seeded slab about 8 × 2 × 8 km holding some twenty-one thousand rocks
   of five sizes plus six kilometre-scale landmarks. Where they sit comes
   from one density field: fBm noise makes clumps, lanes and voids, and the
   slab thins out toward its faces. The same field drives the dust
   buffeting in the ship's vibration, so a rough ride and a crowded sky
   always go together.

   Rocks never translate. They tumble in place (the renderer does that in
   the vertex shader from `axis`, `spin` and `phase`, on the field's own
   clock), so the sphere that bounds a rock is fixed for the whole game.
   That is what lets the belt and its spatial hash be built once per seed
   and shared read-only by every field made from it: destroying a rock only
   flips a per-field `alive` flag, and `reset` flips it back.

   What a ship or a shot meets is the rock itself, not its sphere: the
   bounding sphere only finds the candidates, and each is then tested
   against its model's measured shape (rock-shapes.js), turned as far as
   the rock has tumbled — so nothing flies into a rock it can see, and
   nothing bounces off a rock that is not there.

   The three smallest sizes can be shot apart. A broken rock leaves the
   static belt and its pieces become dynamic rocks, which drift with the
   momentum the shot gave them; there are never more than `maxDynamic` of
   those, and when the cap is reached the oldest crumbles to dust. */

import { FIELD } from './config.js';
import { fbm3, makeRng, noise3 } from './rng.js';
import { normalize, qIntegrate, qRotate, qRotateInv } from './vec.js';
import { SHAPES } from './rock-shapes.js';
import { shapeRadius } from './rock-shapes-core.js';

// Mass of a rock of bounding radius r: porous rubble filling its sphere.
export const rockMass = (r, density = FIELD.density) => density * (4 / 3) * Math.PI * r * r * r;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* Where rocks may lie: the clumps and voids, thinning toward the slab's
   faces — and, for a mission at the belt's edge, toward that edge
   (`cfg.edge`: rock only on the side the normal points to, fading over
   `soft` metres either side of the plane). */
function shapeAt(x, y, z, seed, cfg) {
  const ax = Math.abs(x) / cfg.half[0], ay = Math.abs(y) / cfg.half[1], az = Math.abs(z) / cfg.half[2];
  if (ax >= 1 || ay >= 1 || az >= 1) return 0;
  let cut = 1;
  if (cfg.edge) {
    const { normal: n, at, soft } = cfg.edge;
    cut = smoothstep(-soft, soft, x * n[0] + y * n[1] + z * n[2] - at);
    if (cut <= 0) return 0;
  }
  const clumps = smoothstep(0.3, 0.7, 0.5 + 0.5 * fbm3(x / 1800, y / 900, z / 1800, seed, 4));
  const thickness = 0.8 + 0.2 * noise3(x / 2500, 0, z / 2500, seed + 7);
  const vertical = 1 - smoothstep(0.55, 1, ay / thickness);
  const edge = 1 - smoothstep(0.8, 1, Math.max(ax, az));
  return Math.min(1, Math.max(0, clumps * vertical * edge * cut));
}

/* How crowded the rock is here, as a pilot feels it: the shape, scaled by
   how much rock the mission's belt holds (`cfg.fill`; 0 in open space). */
export function densityAt(x, y, z, seed, cfg = FIELD) {
  const fill = cfg.fill ?? 1;
  return fill > 0 ? Math.min(1, shapeAt(x, y, z, seed, cfg) * fill) : 0;
}

/* ---------- spatial hash ---------- */

const OFFSET = 32768, SPAN = 65536;
const keyOf = (ix, iy, iz) => ((ix + OFFSET) * SPAN + (iy + OFFSET)) * SPAN + (iz + OFFSET);

function createHash(cell) {
  const cells = new Map();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  return {
    cell, cells, lo, hi,
    insert(id, x, y, z, r) {
      const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
      const y0 = Math.floor((y - r) / cell), y1 = Math.floor((y + r) / cell);
      const z0 = Math.floor((z - r) / cell), z1 = Math.floor((z + r) / cell);
      lo[0] = Math.min(lo[0], x0); lo[1] = Math.min(lo[1], y0); lo[2] = Math.min(lo[2], z0);
      hi[0] = Math.max(hi[0], x1); hi[1] = Math.max(hi[1], y1); hi[2] = Math.max(hi[2], z1);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) for (let k = z0; k <= z1; k++) {
        const key = keyOf(i, j, k);
        let list = cells.get(key);
        if (!list) cells.set(key, list = []);
        list.push(id);
      }
    },
    // Calls visit(id) for every entry in the cells the box touches; may repeat ids.
    visitBox(minX, minY, minZ, maxX, maxY, maxZ, visit) {
      const x0 = Math.floor(minX / cell), x1 = Math.floor(maxX / cell);
      const y0 = Math.floor(minY / cell), y1 = Math.floor(maxY / cell);
      const z0 = Math.floor(minZ / cell), z1 = Math.floor(maxZ / cell);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) for (let k = z0; k <= z1; k++) {
        const list = cells.get(keyOf(i, j, k));
        if (list) for (let n = 0; n < list.length; n++) visit(list[n]);
      }
    },
  };
}

/* Once the belt is placed it never changes, so the hash is frozen into a
   flat grid: the rock ids of every cell laid end to end in one Int32Array,
   and each cell's start in another. A query is then plain index arithmetic
   over typed arrays — no Map lookups on 48-bit keys, no callback per rock —
   which matters because the enemy pilots sweep the belt hundreds of times a
   second looking for rocks to dodge. */
function freezeHash(hash) {
  const { cell, lo, hi } = hash;
  if (lo[0] > hi[0]) return { cell, x0: 0, y0: 0, z0: 0, nx: 0, ny: 0, nz: 0, start: new Int32Array(1), items: new Int32Array(0) };
  const nx = hi[0] - lo[0] + 1, ny = hi[1] - lo[1] + 1, nz = hi[2] - lo[2] + 1;
  const start = new Int32Array(nx * ny * nz + 1);
  const index = key => {
    const k = key % SPAN, rest = (key - k) / SPAN, j = rest % SPAN, i = (rest - j) / SPAN;
    return ((i - OFFSET - lo[0]) * ny + (j - OFFSET - lo[1])) * nz + (k - OFFSET - lo[2]);
  };
  for (const [key, list] of hash.cells) start[index(key) + 1] = list.length;
  for (let c = 0; c < nx * ny * nz; c++) start[c + 1] += start[c];
  const items = new Int32Array(start[nx * ny * nz]);
  for (const [key, list] of hash.cells) items.set(list, start[index(key)]);
  return { cell, x0: lo[0], y0: lo[1], z0: lo[2], nx, ny, nz, start, items };
}

/* ---------- generation ---------- */

export function generateBelt(seed, cfg = FIELD) {
  const types = cfg.types;
  const landmarkCount = cfg.landmarks.count;
  const count = types.reduce((n, t) => n + t.count, 0) + landmarkCount;
  const belt = {
    count,
    type: new Uint8Array(count), landmark: new Uint8Array(count),
    pos: new Float32Array(3 * count), scale: new Float32Array(count),
    radius: new Float32Array(count), collide: new Float32Array(count),
    axis: new Float32Array(3 * count), spin: new Float32Array(count), phase: new Float32Array(count),
    hp: new Float32Array(count),
  };
  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0);
  const hash = createHash(cfg.hashCell);
  const large = [];          // landmarks and the largest type, checked by brute force
  const big = [];            // runtime: collide radius above cfg.bigRadius
  const maxHashed = Math.max(...types.slice(0, types.length - 1).map(t => t.radius)) * cfg.scale[1];
  const largeType = types.length - 1;
  const [hx, hy, hz] = cfg.half;
  let n = 0;

  // Missions keep spheres and lanes clear of rock: around capital ships and
  // stations, and along convoy routes.
  const clearings = cfg.clear ?? [], lanes = cfg.lanes ?? [];
  const inClearing = (x, y, z, R) => {
    for (const c of clearings) {
      if (Math.hypot(x - c.pos[0], y - c.pos[1], z - c.pos[2]) - R < c.r) return true;
    }
    for (const l of lanes) {
      const ax = l.a[0], ay = l.a[1], az = l.a[2];
      const dx = l.b[0] - ax, dy = l.b[1] - ay, dz = l.b[2] - az;
      const L2 = dx * dx + dy * dy + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2)) : 0;
      if (Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t) - R < l.r) return true;
    }
    return false;
  };
  const fits = (x, y, z, R, isLarge) => {
    const sx = x - cfg.spawn[0], sy = y - cfg.spawn[1], sz = z - cfg.spawn[2];
    if (Math.sqrt(sx * sx + sy * sy + sz * sz) - R < cfg.spawnClear) return false;
    if ((clearings.length || lanes.length) && inClearing(x, y, z, R)) return false;
    const clear = j => {
      const dx = x - belt.pos[3 * j], dy = y - belt.pos[3 * j + 1], dz = z - belt.pos[3 * j + 2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) >= (R + belt.radius[j]) * cfg.gap;
    };
    for (const j of large) if (!clear(j)) return false;
    if (isLarge) {
      // A large rock can overlap any hashed rock already placed; large rocks
      // go first, so in practice the hash is still empty here.
      for (let j = 0; j < n; j++) if (!large.includes(j) && !clear(j)) return false;
      return true;
    }
    const reach = R + maxHashed;
    let ok = true;
    hash.visitBox(x - reach, y - reach, z - reach, x + reach, y + reach, z + reach, j => {
      if (ok && !clear(j)) ok = false;
    });
    return ok;
  };

  const place = (type, x, y, z, s, isLandmark) => {
    const R = Math.fround(types[type].radius * s);
    belt.type[n] = type; belt.landmark[n] = isLandmark ? 1 : 0;
    belt.pos[3 * n] = x; belt.pos[3 * n + 1] = y; belt.pos[3 * n + 2] = z;
    belt.scale[n] = s; belt.radius[n] = R; belt.collide[n] = Math.fround(R * SHAPES[type].max);
    const axis = rng.unit([0, 0, 0]);
    belt.axis[3 * n] = axis[0]; belt.axis[3 * n + 1] = axis[1]; belt.axis[3 * n + 2] = axis[2];
    // Small rocks spin faster; a landmark turns once in many minutes.
    belt.spin[n] = rng.range(0.02, 0.25) / Math.sqrt(R);
    belt.phase[n] = rng.range(0, Math.PI * 2);
    belt.hp[n] = type < cfg.destructible && !isLandmark ? 5 * Math.pow(R, 1.5) : Infinity;
    if (belt.collide[n] > cfg.bigRadius) big.push(n);
    else hash.insert(n, x, y, z, belt.collide[n]);
    if (isLandmark || type === largeType) large.push(n);
    n++;
  };

  // Landmarks: fixed seeded spots on a ring around the spawn, density ignored.
  for (let k = 0, tries = 0; k < landmarkCount; tries++) {
    if (tries > 400 * landmarkCount) throw new Error('belt: could not place landmarks');
    const s = Math.fround(types[largeType].radius === 0 ? 1 : rng.range(cfg.landmarks.scale[0], cfg.landmarks.scale[1]));
    const R = Math.fround(types[largeType].radius * s);
    const angle = rng.range(0, Math.PI * 2), d = rng.range(2000, 3500);
    const x = Math.fround(cfg.spawn[0] + Math.cos(angle) * d);
    const y = Math.fround(cfg.spawn[1] + rng.range(-300, 300));
    const z = Math.fround(cfg.spawn[2] + Math.sin(angle) * d);
    if (Math.hypot(x - cfg.spawn[0], y - cfg.spawn[1], z - cfg.spawn[2]) - R < 900 && R > 0) continue;
    if (cfg.edge && x * cfg.edge.normal[0] + y * cfg.edge.normal[1] + z * cfg.edge.normal[2] - R < cfg.edge.at) continue;
    if (!fits(x, y, z, R, true)) continue;
    place(largeType, x, y, z, s, true);
    k++;
  }

  for (let type = types.length - 1; type >= 0; type--) {
    const want = types[type].count;
    for (let k = 0, tries = 0; k < want; tries++) {
      if (tries > 400 * want) throw new Error(`belt: could not place type ${type}`);
      const x = Math.fround(rng.range(-hx, hx));
      const y = Math.fround(rng.range(-hy, hy));
      const z = Math.fround(rng.range(-hz, hz));
      if (rng.next() >= Math.pow(shapeAt(x, y, z, seed, cfg), 1.5)) continue;
      const s = Math.fround(rng.range(cfg.scale[0], cfg.scale[1]));
      const R = Math.fround(types[type].radius * s);
      if (!fits(x, y, z, R, type === largeType)) continue;
      place(type, x, y, z, s, false);
      k++;
    }
  }
  belt.grid = freezeHash(hash);
  belt.big = big;
  return belt;
}

// One generated belt per (seed, cfg); its arrays and hash are never mutated.
const beltCache = new Map();
function sharedBelt(seed, cfg) {
  let bySeed = beltCache.get(cfg);
  if (!bySeed) beltCache.set(cfg, bySeed = new Map());
  let belt = bySeed.get(seed);
  if (!belt) bySeed.set(seed, belt = generateBelt(seed, cfg));
  return belt;
}

/* ---------- the live field ---------- */

export function createField(seed, cfg = FIELD) {
  const belt = sharedBelt(seed, cfg);
  const rng = makeRng((seed * 7919 + 17) >>> 0);
  const stamp = new Uint32Array(belt.count);
  let stampId = 0;
  const candidates = [];

  const field = {
    seed, cfg, belt,
    alive: new Uint8Array(belt.count).fill(1),
    hp: belt.hp.slice(),
    dynamic: [],
    nextId: 0,
    // The belt's clock: how far every rock has tumbled. The renderer turns
    // them by the same clock, so what you see is what you hit.
    time: 0,
  };

  const grid = belt.grid, start = grid.start, items = grid.items;
  const collectBox = (minX, minY, minZ, maxX, maxY, maxZ) => {
    const i0 = Math.max(Math.floor(minX / grid.cell) - grid.x0, 0), i1 = Math.min(Math.floor(maxX / grid.cell) - grid.x0, grid.nx - 1);
    const j0 = Math.max(Math.floor(minY / grid.cell) - grid.y0, 0), j1 = Math.min(Math.floor(maxY / grid.cell) - grid.y0, grid.ny - 1);
    const k0 = Math.max(Math.floor(minZ / grid.cell) - grid.z0, 0), k1 = Math.min(Math.floor(maxZ / grid.cell) - grid.z0, grid.nz - 1);
    if (i0 > i1 || j0 > j1 || k0 > k1) return;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const row = (i * grid.ny + j) * grid.nz;
        for (let s = start[row + k0], e = start[row + k1 + 1]; s < e; s++) {
          const id = items[s];
          if (stamp[id] !== stampId) { stamp[id] = stampId; candidates.push(id); }
        }
      }
    }
  };
  const nextStamp = () => {
    candidates.length = 0;
    stampId = (stampId + 1) >>> 0;
    if (stampId === 0) { stamp.fill(0); stampId = 1; }
  };
  const posOf = i => [belt.pos[3 * i], belt.pos[3 * i + 1], belt.pos[3 * i + 2]];

  field.queryRadius = (p, r, out = []) => {
    nextStamp();
    collectBox(p[0] - r, p[1] - r, p[2] - r, p[0] + r, p[1] + r, p[2] + r);
    for (const i of belt.big) if (stamp[i] !== stampId) { stamp[i] = stampId; candidates.push(i); }
    candidates.sort((a, b) => a - b);
    for (const i of candidates) {
      if (!field.alive[i]) continue;
      const dx = belt.pos[3 * i] - p[0], dy = belt.pos[3 * i + 1] - p[1], dz = belt.pos[3 * i + 2] - p[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < r + belt.collide[i]) {
        out.push({ kind: 'static', index: i, pos: posOf(i), radius: belt.collide[i] });
      }
    }
    for (const rock of field.dynamic) {
      const dx = rock.pos[0] - p[0], dy = rock.pos[1] - p[1], dz = rock.pos[2] - p[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < r + rock.collide) {
        out.push({ kind: 'dynamic', index: rock.id, rock, pos: rock.pos, radius: rock.collide });
      }
    }
    return out;
  };

  /* ---------- the rocks' shapes ---------- */

  // The rock being tested, turned to this moment: a belt rock by its spin
  // on the field's clock (axis k, angle a, as the renderer's tumble), a
  // fragment by its own orientation.
  const frame = { q: null, kx: 0, ky: 1, kz: 0, c: 1, s: 0 };
  const staticFrame = i => {
    const a = belt.spin[i] * field.time + belt.phase[i];
    frame.q = null;
    frame.kx = belt.axis[3 * i]; frame.ky = belt.axis[3 * i + 1]; frame.kz = belt.axis[3 * i + 2];
    frame.c = Math.cos(a); frame.s = Math.sin(a);
  };
  const dynamicFrame = rock => { frame.q = rock.q; };
  const V = [0, 0, 0];
  // A world-space offset into the rock's frame (sign −1), or back (+1).
  const turn = (out, x, y, z, sign) => {
    if (frame.q) {
      V[0] = x; V[1] = y; V[2] = z;
      return sign > 0 ? qRotate(out, frame.q, V) : qRotateInv(out, frame.q, V);
    }
    const { kx, ky, kz, c } = frame, s = frame.s * sign;
    const kd = (kx * x + ky * y + kz * z) * (1 - c);
    const cx = ky * z - kz * y, cy = kz * x - kx * z, cz = kx * y - ky * x;
    out[0] = x * c + cx * s + kx * kd;
    out[1] = y * c + cy * s + ky * kd;
    out[2] = z * c + cz * s + kz * kd;
    return out;
  };

  /* How far the point (lx, ly, lz) in a rock's frame lies outside the
     rock's skin (negative: inside), measured along the skin's normal there,
     which is left in NL. `R` is the rock's nominal radius times its scale.
     The skin is read where the line from the centre through the point
     crosses it, and its slope from two neighbouring readings. */
  const NL = [0, 0, 0], EPS = 0.08;
  const skin = (map, R, lx, ly, lz) => {
    let d = Math.hypot(lx, ly, lz);
    if (d < 1e-9) { lx = 0; ly = 1e-9; lz = 0; d = 1e-9; }
    const ux = lx / d, uy = ly / d, uz = lz / d;
    const s0 = R * shapeRadius(map, ux, uy, uz);
    const bx = Math.abs(uy) < 0.9 ? 0 : 1, by = Math.abs(uy) < 0.9 ? 1 : 0;
    let e1x = by * uz, e1y = -bx * uz, e1z = bx * uy - by * ux;
    const l1 = Math.hypot(e1x, e1y, e1z);
    e1x /= l1; e1y /= l1; e1z /= l1;
    const e2x = uy * e1z - uz * e1y, e2y = uz * e1x - ux * e1z, e2z = ux * e1y - uy * e1x;
    let ax = ux + EPS * e1x, ay = uy + EPS * e1y, az = uz + EPS * e1z;
    let k = Math.hypot(ax, ay, az); ax /= k; ay /= k; az /= k;
    const s1 = R * shapeRadius(map, ax, ay, az);
    let cx = ux + EPS * e2x, cy = uy + EPS * e2y, cz = uz + EPS * e2z;
    k = Math.hypot(cx, cy, cz); cx /= k; cy /= k; cz /= k;
    const s2 = R * shapeRadius(map, cx, cy, cz);
    const p1x = ax * s1 - ux * s0, p1y = ay * s1 - uy * s0, p1z = az * s1 - uz * s0;
    const p2x = cx * s2 - ux * s0, p2y = cy * s2 - uy * s0, p2z = cz * s2 - uz * s0;
    let nx = p1y * p2z - p1z * p2y, ny = p1z * p2x - p1x * p2z, nz = p1x * p2y - p1y * p2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (nx * ux + ny * uy + nz * uz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    NL[0] = nx; NL[1] = ny; NL[2] = nz;
    return (lx - ux * s0) * nx + (ly - uy * s0) * ny + (lz - uz * s0) * nz;
  };
  const L = [0, 0, 0];
  // The point's distance outside the rock centred at (cx, cy, cz), in the
  // frame set last; NL holds the normal, in the rock's frame.
  const outside = (map, R, cx, cy, cz, x, y, z) => {
    turn(L, x - cx, y - cy, z - cz, -1);
    return skin(map, R, L[0], L[1], L[2]);
  };

  /* How far point p lies outside the skin of the rock `ref` names (as the
     queries return them; negative: inside), and the skin's normal there. */
  field.skin = (ref, p) => {
    const rock = ref.kind === 'dynamic' ? ref.rock : null;
    const map = SHAPES[rock ? rock.type : belt.type[ref.index]], R = rock ? rock.radius : belt.radius[ref.index];
    const c = rock ? rock.pos : posOf(ref.index);
    if (rock) dynamicFrame(rock); else staticFrame(ref.index);
    const distance = outside(map, R, c[0], c[1], c[2], p[0], p[1], p[2]);
    return { distance, normal: normalize([0, 0, 0], turn([0, 0, 0], NL[0], NL[1], NL[2], 1)) };
  };

  /* Every rock a ball (p, r) is touching, with how deep and the world-space
     normal to push it out along. */
  field.contacts = (p, r, out = []) => {
    nextStamp();
    collectBox(p[0] - r, p[1] - r, p[2] - r, p[0] + r, p[1] + r, p[2] + r);
    for (const i of belt.big) if (stamp[i] !== stampId) { stamp[i] = stampId; candidates.push(i); }
    candidates.sort((a, b) => a - b);
    for (const i of candidates) {
      if (!field.alive[i]) continue;
      const cx = belt.pos[3 * i], cy = belt.pos[3 * i + 1], cz = belt.pos[3 * i + 2];
      if (Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) >= r + belt.collide[i]) continue;
      staticFrame(i);
      const h = outside(SHAPES[belt.type[i]], belt.radius[i], cx, cy, cz, p[0], p[1], p[2]);
      if (h >= r) continue;
      out.push({ kind: 'static', index: i, pos: posOf(i), radius: belt.radius[i], depth: r - h, normal: normalize([0, 0, 0], turn([0, 0, 0], NL[0], NL[1], NL[2], 1)) });
    }
    for (const rock of field.dynamic) {
      if (Math.hypot(p[0] - rock.pos[0], p[1] - rock.pos[1], p[2] - rock.pos[2]) >= r + rock.collide) continue;
      dynamicFrame(rock);
      const h = outside(SHAPES[rock.type], rock.radius, rock.pos[0], rock.pos[1], rock.pos[2], p[0], p[1], p[2]);
      if (h >= r) continue;
      out.push({ kind: 'dynamic', index: rock.id, rock, pos: rock.pos, radius: rock.radius, depth: r - h, normal: normalize([0, 0, 0], turn([0, 0, 0], NL[0], NL[1], NL[2], 1)) });
    }
    return out;
  };

  // Segment p0→p0+d against a sphere (c, R): where it enters and leaves, as
  // parameters in [0, 1] (entry 0 when it starts inside), or false.
  const span = [0, 0];
  const segmentSphere = (p0, d, A, cx, cy, cz, R) => {
    const mx = p0[0] - cx, my = p0[1] - cy, mz = p0[2] - cz;
    const C = mx * mx + my * my + mz * mz - R * R;
    if (A < 1e-12) { if (C > 0) return false; span[0] = 0; span[1] = 1; return true; }
    const B = 2 * (mx * d[0] + my * d[1] + mz * d[2]);
    const disc = B * B - 4 * A * C;
    if (disc < 0) return false;
    const q = Math.sqrt(disc);
    const t0 = (-B - q) / (2 * A), t1 = (-B + q) / (2 * A);
    if (t1 < 0 || t0 > 1) return false;
    span[0] = Math.max(0, t0); span[1] = Math.min(1, t1);
    return true;
  };
  /* The first touch of a ball of radius r swept along p0 → p0+d with a
     rock's skin, between parameters a and b: walked in steps finer than
     the shape's features, then narrowed down. −1 for none; NL holds the
     normal there. */
  const march = (map, R, cx, cy, cz, p0, d, length, a, b, r) => {
    const step = Math.max(0.25, Math.min(R * 0.06, 40));
    const n = Math.max(1, Math.ceil((b - a) * length / step));
    let before = a;
    for (let k = 0; k <= n; k++) {
      const t = a + (b - a) * k / n;
      if (outside(map, R, cx, cy, cz, p0[0] + d[0] * t, p0[1] + d[1] * t, p0[2] + d[2] * t) > r) { before = t; continue; }
      if (k === 0) return t;
      let lo = before, hi = t;
      for (let it = 0; it < 6; it++) {
        const mid = (lo + hi) / 2;
        if (outside(map, R, cx, cy, cz, p0[0] + d[0] * mid, p0[1] + d[1] * mid, p0[2] + d[2] * mid) > r) lo = mid; else hi = mid;
      }
      outside(map, R, cx, cy, cz, p0[0] + d[0] * hi, p0[1] + d[1] * hi, p0[2] + d[2] * hi);
      return hi;
    }
    return -1;
  };

  const sweepDir = [0, 0, 0], hitNormal = [0, 0, 0];
  field.sweepSphere = (p0, p1, r) => {
    const d = sweepDir;
    d[0] = p1[0] - p0[0]; d[1] = p1[1] - p0[1]; d[2] = p1[2] - p0[2];
    const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const length = Math.sqrt(A);
    // Long segments are walked in hash-cell-sized chunks so the cell count
    // grows with the length, not with the cube of its bounding box.
    const chunks = Math.max(1, Math.ceil(length / grid.cell));
    nextStamp();
    for (let c = 0; c < chunks; c++) {
      const t0 = c / chunks, t1 = (c + 1) / chunks;
      const ax = p0[0] + d[0] * t0, ay = p0[1] + d[1] * t0, az = p0[2] + d[2] * t0;
      const bx = p0[0] + d[0] * t1, by = p0[1] + d[1] * t1, bz = p0[2] + d[2] * t1;
      collectBox(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r,
        Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r);
    }
    for (const i of belt.big) if (stamp[i] !== stampId) { stamp[i] = stampId; candidates.push(i); }
    let best = Infinity, ref = null, centre = null;
    for (const i of candidates) {
      if (!field.alive[i]) continue;
      const cx = belt.pos[3 * i], cy = belt.pos[3 * i + 1], cz = belt.pos[3 * i + 2];
      if (!segmentSphere(p0, d, A, cx, cy, cz, belt.collide[i] + r) || span[0] > best) continue;
      let t;
      // A pebble against a wide sweep: its shape is lost in the sweep's own size.
      if (belt.collide[i] < 0.25 * r) { t = span[0]; NL[0] = NaN; }
      else { staticFrame(i); t = march(SHAPES[belt.type[i]], belt.radius[i], cx, cy, cz, p0, d, length, span[0], Math.min(span[1], best), r); }
      if (t >= 0 && (t < best || (t === best && ref && ref.kind === 'static' && i < ref.index))) {
        best = t; centre = [cx, cy, cz];
        ref = { kind: 'static', index: i, pos: centre, radius: belt.radius[i] };
        if (Number.isNaN(NL[0])) hitNormal[0] = NaN; else turn(hitNormal, NL[0], NL[1], NL[2], 1);
      }
    }
    for (const rock of field.dynamic) {
      if (!segmentSphere(p0, d, A, rock.pos[0], rock.pos[1], rock.pos[2], rock.collide + r) || span[0] > best) continue;
      dynamicFrame(rock);
      const t = march(SHAPES[rock.type], rock.radius, rock.pos[0], rock.pos[1], rock.pos[2], p0, d, length, span[0], Math.min(span[1], best), r);
      if (t >= 0 && t < best) {
        best = t; centre = rock.pos;
        ref = { kind: 'dynamic', index: rock.id, rock, pos: rock.pos, radius: rock.radius };
        turn(hitNormal, NL[0], NL[1], NL[2], 1);
      }
    }
    if (!ref) return null;
    const point = [p0[0] + d[0] * best, p0[1] + d[1] * best, p0[2] + d[2] * best];
    const normal = Number.isNaN(hitNormal[0])
      ? normalize([0, 0, 0], [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]])
      : normalize([0, 0, 0], hitNormal);
    return { t: best, ref, point, normal };
  };

  field.addDynamicRock = (type, pos, vel, scale = 1, events = null) => {
    const radius = cfg.types[type].radius * scale;
    const rock = {
      id: field.nextId++, type, pos: [...pos], vel: [...vel],
      q: [0, 0, 0, 1], w: rng.unit([0, 0, 0]).map(v => v * rng.range(0.1, 1.2)),
      radius, collide: radius * SHAPES[type].max, core: radius * SHAPES[type].mean, hp: 5 * Math.pow(radius, 1.5),
    };
    field.dynamic.push(rock);
    while (field.dynamic.length > cfg.maxDynamic) {
      const old = field.dynamic.shift();
      if (events) {
        events.push({ type: 'rockBreak', rockType: old.type, pos: [...old.pos], radius: old.radius, vel: [...old.vel], crumble: true });
        events.push({ type: 'dynamicRockRemoved', id: old.id });
      }
    }
    return rock;
  };

  const split = (type, centre, radius, baseVel, events) => {
    if (type === 0) return;
    const childType = type - 1;
    const n = childType === 1 ? rng.int(2, 3) : rng.int(2, 4);
    const children = [];
    for (let k = 0; k < n; k++) {
      const dir = rng.unit([0, 0, 0]);
      const offset = rng.range(0.1, 0.5) * radius;
      const pos = [centre[0] + dir[0] * offset, centre[1] + dir[1] * offset, centre[2] + dir[2] * offset];
      const speed = rng.range(2, 8);
      const scale = Math.min(rng.range(cfg.scale[0], cfg.scale[1]), 0.6 * radius / cfg.types[childType].radius);
      children.push({ pos, u: dir.map(v => v * speed), scale });
    }
    // Remove the mass-weighted mean of the outward kicks, so the pieces'
    // centre of mass carries exactly the momentum the shot gave the rock.
    let m = 0; const mu = [0, 0, 0];
    for (const c of children) {
      const w = (cfg.types[childType].radius * c.scale) ** 3;
      m += w; for (let i = 0; i < 3; i++) mu[i] += w * c.u[i];
    }
    for (const c of children) {
      const vel = [0, 1, 2].map(i => baseVel[i] + c.u[i] - mu[i] / m);
      field.addDynamicRock(childType, c.pos, vel, c.scale, events);
    }
  };

  field.damageRock = (ref, amount, point, impulse, events) => {
    if (ref.kind === 'static') {
      const i = ref.index;
      if (!field.alive[i]) return 'immune';
      if (!(belt.hp[i] < Infinity)) {
        const c = posOf(i);
        events.push({ type: 'rockImpact', pos: [...point], normal: normalize([0, 0, 0], [point[0] - c[0], point[1] - c[1], point[2] - c[2]]) });
        return 'immune';
      }
      field.hp[i] -= amount;
      if (field.hp[i] > 0) return 'damaged';
      field.alive[i] = 0;
      const c = posOf(i), R = belt.radius[i], M = R ** 3;
      const vel = [impulse[0] / M, impulse[1] / M, impulse[2] / M];
      events.push({ type: 'staticRockRemoved', index: i });
      events.push({ type: 'rockBreak', rockType: belt.type[i], pos: c, radius: R, vel });
      split(belt.type[i], c, R, vel, events);
      return 'destroyed';
    }
    const rock = ref.rock ?? field.dynamic.find(r => r.id === ref.index);
    if (!rock || !field.dynamic.includes(rock)) return 'immune';
    rock.hp -= amount;
    if (rock.hp > 0) return 'damaged';
    field.dynamic.splice(field.dynamic.indexOf(rock), 1);
    const M = rock.radius ** 3;
    const vel = [0, 1, 2].map(k => rock.vel[k] + impulse[k] / M);
    events.push({ type: 'dynamicRockRemoved', id: rock.id });
    events.push({ type: 'rockBreak', rockType: rock.type, pos: [...rock.pos], radius: rock.radius, vel });
    split(rock.type, rock.pos, rock.radius, vel, events);
    return 'destroyed';
  };

  const hits = [];
  field.step = (dt, events) => {
    field.time += dt;
    for (const rock of field.dynamic) {
      for (let k = 0; k < 3; k++) rock.pos[k] += rock.vel[k] * dt;
      qIntegrate(rock.q, rock.w, dt);
      // A fragment against the belt: a ball of its bulk against the rock.
      hits.length = 0;
      field.contacts(rock.pos, rock.core, hits);
      for (const h of hits) {
        if (h.kind !== 'static') continue;
        const n = h.normal;
        for (let k = 0; k < 3; k++) rock.pos[k] += n[k] * h.depth;
        const vn = rock.vel[0] * n[0] + rock.vel[1] * n[1] + rock.vel[2] * n[2];
        if (vn < 0) for (let k = 0; k < 3; k++) rock.vel[k] -= (1 + cfg.restitution) * vn * n[k];
      }
    }
    // Fragments knock each other aside: equal and opposite impulses, shared
    // by inverse mass, so the pair's momentum is exactly what it was.
    const dyn = field.dynamic;
    for (let i = 0; i < dyn.length; i++) {
      const a = dyn[i];
      for (let j = i + 1; j < dyn.length; j++) {
        const b = dyn[j];
        const dx = a.pos[0] - b.pos[0], dy = a.pos[1] - b.pos[1], dz = a.pos[2] - b.pos[2];
        const reach = a.core + b.core;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-9 ? dx / d : 0, ny = d > 1e-9 ? dy / d : 1, nz = d > 1e-9 ? dz / d : 0;
        const ia = 1 / rockMass(a.radius, cfg.density), ib = 1 / rockMass(b.radius, cfg.density);
        const share = (reach - d) / (ia + ib);
        a.pos[0] += nx * share * ia; a.pos[1] += ny * share * ia; a.pos[2] += nz * share * ia;
        b.pos[0] -= nx * share * ib; b.pos[1] -= ny * share * ib; b.pos[2] -= nz * share * ib;
        const vn = (a.vel[0] - b.vel[0]) * nx + (a.vel[1] - b.vel[1]) * ny + (a.vel[2] - b.vel[2]) * nz;
        if (vn >= 0) continue;
        const jn = -(1 + cfg.restitution) * vn / (ia + ib);
        a.vel[0] += nx * jn * ia; a.vel[1] += ny * jn * ia; a.vel[2] += nz * jn * ia;
        b.vel[0] -= nx * jn * ib; b.vel[1] -= ny * jn * ib; b.vel[2] -= nz * jn * ib;
      }
    }
  };

  field.reset = () => {
    field.time = 0;
    field.alive.fill(1);
    field.hp.set(belt.hp);
    field.dynamic.length = 0;
    field.nextId = 0;
  };

  return field;
}
