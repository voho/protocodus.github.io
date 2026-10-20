// Run with: node fun/hedgerow/tests/route-check.mjs
// The mission's routes, walked against the real collision world: the level
// data placed with the colliders authored in the GLBs (as levelBuild.js does),
// the analytic ground with its building pads, the river. Each route must be
// walkable end to end by a soldier who can step 0.45 m and vault 1.35 m;
// a stuck point fails the check and is printed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld } from '../js/world.js';
import { rectDistance, smoothstep, lerp } from '../js/util.js';
import L from '../js/levels/saint-clair.js';

const DEG = Math.PI / 180;
const here = new URL('..', import.meta.url).pathname;

/* ---------- models: colliders, anchors, bounds from the GLB JSON ---------- */
const models = new Map();
for (const set of ['village', 'military', 'nature']) {
  const b = readFileSync(`${here}assets/models/${set}.glb`);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  for (const n of j.nodes) {
    if (n.mesh == null) continue;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a.min[k]); mx[k] = Math.max(mx[k], a.max[k]); }
    }
    const ex = n.extras || {};
    models.set(n.name, {
      name: n.name, min: mn, max: mx,
      colliders: ex.colliders ? JSON.parse(ex.colliders) : [],
      anchors: ex.anchors ? JSON.parse(ex.anchors) : {},
    });
  }
}

function worldColliders(m, x, y, z, yaw, scale = 1) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return m.colliders.map((col) => {
    const [lx, ly, lz] = col.c;
    const w = { x: x + (lx * c + lz * s) * scale, y: y + ly * scale, z: z + (-lx * s + lz * c) * scale, kind: col.kind };
    if (col.type === 'box') return { ...w, type: 'box', hx: col.h[0] * scale, hy: col.h[1] * scale, hz: col.h[2] * scale, yaw: (col.ry || 0) + yaw };
    return { ...w, type: 'cyl', r: col.r * scale, h: col.hgt * scale };
  });
}

/* ---------- ground with building pads (as levelBuild.js) ---------- */
const pads = [];
const missing = new Set();
for (const p of L.props) {
  const m = models.get(p.m);
  if (!m) { missing.add(p.m); continue; }
  if (!p.pad) continue;
  const yaw = p.yaw * DEG, c = Math.cos(yaw), s = Math.sin(yaw);
  const cxl = (m.min[0] + m.max[0]) / 2, czl = (m.min[2] + m.max[2]) / 2;
  const cx = p.x + cxl * c + czl * s, cz = p.z - cxl * s + czl * c;
  const h = typeof p.y === 'number' ? p.y : L.baseHeight(cx, cz);
  pads.push({ cx, cz, hx: (m.max[0] - m.min[0]) / 2 + 0.6, hz: (m.max[2] - m.min[2]) / 2 + 0.6, yaw, h, margin: 3.5 });
  p._padH = h;
}
const height = (x, z) => {
  let h = L.baseHeight(x, z);
  for (const pd of pads) {
    const dx = x - pd.cx, dz = z - pd.cz, reach = Math.max(pd.hx, pd.hz) + pd.margin;
    if (dx * dx + dz * dz > reach * reach * 2) continue;
    const d = rectDistance(x, z, pd.cx, pd.cz, pd.hx, pd.hz, pd.yaw);
    if (d < pd.margin) h = lerp(h, pd.h, smoothstep(pd.margin, 0, d));
  }
  return h;
};
const terrain = { height, normal: () => [0, 1, 0], surfaceAt: () => 'mud', raycast: () => Infinity };
const world = createWorld({ ...L.bounds, cell: 8, terrain, water: L.water });

for (const p of L.props) {
  const m = models.get(p.m);
  if (!m) continue;
  const yaw = (p.yaw || 0) * DEG;
  let y;
  if (typeof p.y === 'number') y = p.y;
  else if (typeof p.y === 'function') y = p.y(p.x, p.z);
  else if (p._padH !== undefined) y = p._padH - 0.04;
  else {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const sx = Math.min(Math.abs(m.min[0]), Math.abs(m.max[0])) * (p.scale || 1) * 0.8;
    const sz = Math.min(Math.abs(m.min[2]), Math.abs(m.max[2])) * (p.scale || 1) * 0.8;
    y = height(p.x, p.z);
    for (const [lx, lz] of [[sx, sz], [-sx, sz], [sx, -sz], [-sx, -sz]]) y = Math.min(y, height(p.x + lx * c + lz * s, p.z - lx * s + lz * c));
    y -= 0.04;
  }
  for (const col of worldColliders(m, p.x, y, p.z, yaw, p.scale || 1)) world.add(col);
}
for (const s0 of L.scatter) {
  const s = models.has(s0.m) || !s0.alt ? s0 : { ...s0, m: s0.alt, scale: s0.scale * (s0.altScale || 1) };
  const m = models.get(s.m);
  if (!m || s.cover) continue;
  const y = height(s.x, s.z) - (s.rock ? 0.05 : 0.15);
  if (world.query(s.x - 1.2, s.z - 1.2, s.x + 1.2, s.z + 1.2).length) continue;
  for (const col of worldColliders(m, s.x, y, s.z, s.yaw * DEG, s.scale)) world.add(col);
}

/* ---------- wall-mounted props: a wall behind both edges ---------- */
const MOUNTED = { wall_lamp: 0, ivy_patch: 1.2 };       // probe height above the prop's origin
function wallBehind(x, y, z) {
  for (const col of world.query(x - 0.05, z - 0.05, x + 0.05, z + 0.05)) {
    if (col.type !== 'box' || col.hy < 1 || Math.abs(y - col.y) > col.hy) continue;
    const c = Math.cos(col.yaw), s = Math.sin(col.yaw), dx = x - col.x, dz = z - col.z;
    if (Math.abs(dx * c - dz * s) <= col.hx && Math.abs(dx * s + dz * c) <= col.hz) return true;
  }
  return false;
}
function mounted(p) {
  const m = models.get(p.m), sc = p.scale || 1, yaw = (p.yaw || 0) * DEG, c = Math.cos(yaw), s = Math.sin(yaw);
  const y = (typeof p.y === 'function' ? p.y(p.x, p.z) : p.y) + MOUNTED[p.m] * sc;
  const lz = m.min[2] * sc - 0.25;                       // a hand's breadth behind the back plate
  return [m.min[0] * sc + 0.05, m.max[0] * sc - 0.05].every((lx) => wallBehind(p.x + lx * c + lz * s, y, p.z - lx * s + lz * c));
}
const floating = L.props.filter((p) => p.m in MOUNTED && models.has(p.m) && !mounted(p));
assert.ok(!mounted({ m: 'wall_lamp', x: 5.8, z: 106, yaw: -90, y: () => L.baseHeight(5.8, 106) + 2.7 }),
  'negative control: a lamp in the alley beside house_a was taken as mounted');
for (const p of floating) console.log(`  ${p.m} at (${p.x}, ${p.z}) has no wall behind it`);
assert.equal(floating.length, 0, `${floating.length} wall-mounted prop(s) off the wall`);
console.log(`ok    ${L.props.filter((p) => p.m in MOUNTED).length} wall lamps and ivy patches are on walls`);

/* ---------- a soldier walking ---------- */
function walk(name, pts) {
  const pos = { x: pts[0][0], y: 0, z: pts[0][1] };
  pos.y = world.groundAt(pos.x, pos.z, 1e4, 0.5);
  const dt = 1 / 30, speed = 4.5, B = L.playBounds;
  const stuck = [];
  for (const [tx, tz] of pts.slice(1)) {
    let best = Infinity, since = 0, t = 0;
    for (;;) {
      const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
      if (d < 1.2) break;
      if (d < best - 0.05) { best = d; since = 0; } else since += dt;
      t += dt;
      const nx = dx / d, nz = dz / d;
      const p = { x: pos.x + nx * speed * dt, z: pos.z + nz * speed * dt };
      world.pushOut(p, 0.34, pos.y, 1.78, 0.45);
      if (world.tooDeep(p.x, p.z, 1.25, pos.y)) {
        if (!world.tooDeep(p.x, pos.z, 1.25, pos.y)) p.z = pos.z;
        else if (!world.tooDeep(pos.x, p.z, 1.25, pos.y)) p.x = pos.x;
        else { p.x = pos.x; p.z = pos.z; }
      }
      p.x = Math.min(B.maxX, Math.max(B.minX, p.x));
      p.z = Math.min(B.maxZ, Math.max(B.minZ, p.z));
      pos.x = p.x; pos.z = p.z;
      pos.y = world.groundAt(pos.x, pos.z, pos.y, 0.45);
      // blocked for a moment: vault what is in front if it is low enough
      if (since > 0.5) {
        const ob = world.obstacleAhead(pos.x, pos.z, nx, nz, pos.y, 0.7);
        if (ob && ob.top - pos.y <= 1.35) {
          for (let k = 1.0; k <= 2.6; k += 0.3) {
            const lx = pos.x + nx * k, lz = pos.z + nz * k;
            const gy = world.groundAt(lx, lz, ob.top + 0.05, 0.1, 0.3);
            const q = { x: lx, z: lz };
            if (!world.pushOut(q, 0.34, gy, 1.78, 0.45) && !world.tooDeep(lx, lz, 1.25, gy)) { pos.x = lx; pos.z = lz; pos.y = gy; since = 0; break; }
          }
        }
      }
      if (since > 3 || t > 120) {
        stuck.push(`${name}: stuck at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}) heading for (${tx}, ${tz})`);
        pos.x = tx; pos.z = tz; pos.y = world.groundAt(tx, tz, 1e4, 0.5);
        break;
      }
    }
  }
  return stuck;
}

const ROUTES = {
  'main road': [[0.5, -6], [0.5, 30], [0, 80], [-3.4, 86.5], [-3, 93], [2.5, 112], [2.5, 122], [-0.6, 129], [0, 145], [0, 160],
    [-1, 175], [1.5, 195], [2, 203], [-1, 217], [1.5, 240], [1.5, 252], [0, 258], [0, 270], [1.2, 283], [1, 292], [-3, 300],
    [-9, 326], [-7, 350], [2, 374], [0, 378], [0, 384], [-3, 390], [-3, 396], [6, 398], [3, 424], [-4, 450], [-6, 472],
    [-2, 492], [-3, 503], [-2, 520], [0, 549]],
  'orchard flank': [[1, 30], [6.5, 34], [14, 40], [16, 78], [16, 84], [22, 95], [28, 112], [28, 140], [10, 146]],
  'ditch flank': [[0, 52], [-8, 55], [-11, 60], [-12, 78], [-14, 92], [-20, 104], [-25, 128], [-12, 148]],
  'west gardens': [[0, 146], [22, 148], [28, 165], [26, 185], [30, 215], [16, 247], [2, 252]],
  'ford': [[-20, 250], [-30, 258], [-32, 262], [-32, 270], [-32, 278], [-28, 286], [-10, 292]],
  'fallen tree': [[25, 252], [30, 262], [32, 266], [32, 273], [32, 280], [30, 288], [10, 292]],
  'trench west end': [[-10, 360], [-38, 380], [-42, 392], [-40, 398], [-20, 404], [0, 410]],
  'trench east end': [[10, 360], [38, 378], [44, 390], [40, 398], [10, 406]],
  'bunker west flank': [[0, 425], [-14, 438], [-12, 460], [-4, 470]],
  'bunker east flank': [[6, 424], [22, 432], [24, 452], [16, 462], [-4, 470]],
};

// the check must see walls: straight into house_a, through the church, off the bridge into the river
for (const [name, pts] of Object.entries({
  'into a house': [[0, 101], [14, 101]],
  'through the church': [[-10, 165], [-40, 165]],
  'into the deep river': [[0, 258], [0, 265], [-10, 270]],
})) assert.ok(walk(name, pts).length > 0, `negative control "${name}" walked through`);
console.log('ok    negative controls (walls and deep water stop him)');

const failures = [];
for (const [name, pts] of Object.entries(ROUTES)) {
  const s = walk(name, pts);
  failures.push(...s);
  console.log(`${s.length ? 'STUCK' : 'ok   '} ${name}`);
}
if (missing.size) console.log('models not in the GLBs (skipped):', [...missing].join(', '));
for (const f of failures) console.log('  ' + f);
assert.equal(failures.length, 0, `${failures.length} stuck point(s)`);
console.log('route-check: all routes walkable');
