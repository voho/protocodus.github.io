/* Meteora — the asteroid belt.

   A seeded slab about 8 × 2 × 8 km holding some twenty-one thousand rocks
   of five sizes plus six kilometre-scale landmarks. Where they sit comes
   from one density field: fBm noise makes clumps, lanes and voids, and the
   slab thins out toward its faces. The same field drives the dust
   buffeting in the ship's vibration, so a rough ride and a crowded sky
   always go together.

   Rocks never translate. They tumble in place (the renderer does that in
   the vertex shader from `axis`, `spin` and `phase`), so a rock's
   collision sphere — 0.85 of its bounding radius, a fair fit for an
   irregular body — is fixed for the whole game. That is what lets the
   belt and its spatial hash be built once per seed and shared read-only
   by every field made from it: destroying a rock only flips a per-field
   `alive` flag, and `reset` flips it back.

   The three smallest sizes can be shot apart. A broken rock leaves the
   static belt and its pieces become dynamic rocks, which drift with the
   momentum the shot gave them; there are never more than `maxDynamic` of
   those, and when the cap is reached the oldest crumbles to dust. */

import { FIELD } from './config.js';
import { fbm3, makeRng, noise3 } from './rng.js';
import { normalize, qIntegrate } from './vec.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function densityAt(x, y, z, seed, cfg = FIELD) {
  const ax = Math.abs(x) / cfg.half[0], ay = Math.abs(y) / cfg.half[1], az = Math.abs(z) / cfg.half[2];
  if (ax >= 1 || ay >= 1 || az >= 1) return 0;
  const clumps = smoothstep(0.3, 0.7, 0.5 + 0.5 * fbm3(x / 1800, y / 900, z / 1800, seed, 4));
  const thickness = 0.8 + 0.2 * noise3(x / 2500, 0, z / 2500, seed + 7);
  const vertical = 1 - smoothstep(0.55, 1, ay / thickness);
  const edge = 1 - smoothstep(0.8, 1, Math.max(ax, az));
  return Math.min(1, Math.max(0, clumps * vertical * edge));
}

/* ---------- spatial hash ---------- */

const OFFSET = 32768, SPAN = 65536;
const keyOf = (ix, iy, iz) => ((ix + OFFSET) * SPAN + (iy + OFFSET)) * SPAN + (iz + OFFSET);

function createHash(cell) {
  const cells = new Map();
  return {
    cell, cells,
    insert(id, x, y, z, r) {
      const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
      const y0 = Math.floor((y - r) / cell), y1 = Math.floor((y + r) / cell);
      const z0 = Math.floor((z - r) / cell), z1 = Math.floor((z + r) / cell);
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

  const fits = (x, y, z, R, isLarge) => {
    const sx = x - cfg.spawn[0], sy = y - cfg.spawn[1], sz = z - cfg.spawn[2];
    if (Math.sqrt(sx * sx + sy * sy + sz * sz) - R < cfg.spawnClear) return false;
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
    belt.scale[n] = s; belt.radius[n] = R; belt.collide[n] = Math.fround(R * cfg.collide);
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
      if (rng.next() >= Math.pow(densityAt(x, y, z, seed, cfg), 1.5)) continue;
      const s = Math.fround(rng.range(cfg.scale[0], cfg.scale[1]));
      const R = Math.fround(types[type].radius * s);
      if (!fits(x, y, z, R, type === largeType)) continue;
      place(type, x, y, z, s, false);
      k++;
    }
  }
  belt.hash = hash;
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
  };

  const collectBox = (minX, minY, minZ, maxX, maxY, maxZ) => {
    belt.hash.visitBox(minX, minY, minZ, maxX, maxY, maxZ, id => {
      if (stamp[id] !== stampId) { stamp[id] = stampId; candidates.push(id); }
    });
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

  // Segment p0→p1 against a sphere (c, R): the entry parameter in [0, 1],
  // 0 when the segment starts inside, or −1 for a miss.
  const segmentSphere = (p0, d, A, cx, cy, cz, R) => {
    const mx = p0[0] - cx, my = p0[1] - cy, mz = p0[2] - cz;
    const C = mx * mx + my * my + mz * mz - R * R;
    if (C <= 0) return 0;
    if (A < 1e-12) return -1;
    const B = 2 * (mx * d[0] + my * d[1] + mz * d[2]);
    const disc = B * B - 4 * A * C;
    if (disc < 0) return -1;
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    return t >= 0 && t <= 1 ? t : -1;
  };

  field.sweepSphere = (p0, p1, r) => {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const length = Math.sqrt(A);
    // Long segments are walked in hash-cell-sized chunks so the cell count
    // grows with the length, not with the cube of its bounding box.
    const chunks = Math.max(1, Math.ceil(length / belt.hash.cell));
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
      const t = segmentSphere(p0, d, A, cx, cy, cz, belt.collide[i] + r);
      if (t >= 0 && (t < best || (t === best && ref && ref.kind === 'static' && i < ref.index))) {
        best = t; centre = [cx, cy, cz];
        ref = { kind: 'static', index: i, pos: centre, radius: belt.collide[i] };
      }
    }
    for (const rock of field.dynamic) {
      const t = segmentSphere(p0, d, A, rock.pos[0], rock.pos[1], rock.pos[2], rock.collide + r);
      if (t >= 0 && t < best) {
        best = t; centre = rock.pos;
        ref = { kind: 'dynamic', index: rock.id, rock, pos: rock.pos, radius: rock.collide };
      }
    }
    if (!ref) return null;
    const point = [p0[0] + d[0] * best, p0[1] + d[1] * best, p0[2] + d[2] * best];
    const normal = normalize([0, 0, 0], [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]]);
    return { t: best, ref, point, normal };
  };

  field.addDynamicRock = (type, pos, vel, scale = 1, events = null) => {
    const radius = cfg.types[type].radius * scale;
    const rock = {
      id: field.nextId++, type, pos: [...pos], vel: [...vel],
      q: [0, 0, 0, 1], w: rng.unit([0, 0, 0]).map(v => v * rng.range(0.1, 1.2)),
      radius, collide: radius * cfg.collide, hp: 5 * Math.pow(radius, 1.5),
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
    for (const rock of field.dynamic) {
      for (let k = 0; k < 3; k++) rock.pos[k] += rock.vel[k] * dt;
      qIntegrate(rock.q, rock.w, dt);
      hits.length = 0;
      field.queryRadius(rock.pos, rock.collide, hits);
      for (const h of hits) {
        if (h.kind !== 'static') continue;
        const n = normalize([0, 0, 0], [rock.pos[0] - h.pos[0], rock.pos[1] - h.pos[1], rock.pos[2] - h.pos[2]]);
        if (n[0] === 0 && n[1] === 0 && n[2] === 0) n[1] = 1;
        const reach = h.radius + rock.collide;
        for (let k = 0; k < 3; k++) rock.pos[k] = h.pos[k] + n[k] * reach;
        const vn = rock.vel[0] * n[0] + rock.vel[1] * n[1] + rock.vel[2] * n[2];
        if (vn < 0) for (let k = 0; k < 3; k++) rock.vel[k] -= 1.5 * vn * n[k];
      }
    }
  };

  field.reset = () => {
    field.alive.fill(1);
    field.hp.set(belt.hp);
    field.dynamic.length = 0;
    field.nextId = 0;
  };

  return field;
}
