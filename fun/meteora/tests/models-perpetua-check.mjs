/* Meteora — perpetua.glb, the group `perpetua` of the models brief, checked
   from the GLB's JSON and binary chunks: the triangle and size budgets, WebP
   textures (two sets at most, none over 2048²), the length along the nose
   axis (1400 m ± 15 %), every anchor named in js/anchors/perpetua.js as a
   node, nozzles exhausting to +Z, the ten turrets (a yaw node with a pitch
   child each), the spinning `ring` node on the ship's axis, the nav lights,
   the bay, and the compound colliders: 50–90 spheres that cover every ring
   vertex at any spin angle and nearly every hull vertex. Rebuild the model
   with tools/blender/build_perpetua.py. */
import { test, run, assert } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import A from '../js/anchors/perpetua.js';

const FILE = new URL('../assets/models/perpetua.glb', import.meta.url);
const BUDGET = { tris: 65000, bytes: 4 * 1024 * 1024, length: 1400 };

function readGlb() {
  const buf = readFileSync(FILE);
  assert.equal(buf.readUInt32LE(0), 0x46546c67, 'glTF magic');
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, 'JSON chunk');
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binAt = 20 + jsonLen;
  assert.equal(buf.readUInt32LE(binAt + 4), 0x004e4942, 'BIN chunk');
  const bin = buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt));
  return { json, bin, size: buf.length };
}

function trianglesOf(json, meshIndex) {
  let tris = 0;
  for (const p of json.meshes[meshIndex].primitives) tris += json.accessors[p.indices ?? p.attributes.POSITION].count / 3;
  return tris;
}

function positions(json, bin, meshIndex) {
  const out = [];
  for (const p of json.meshes[meshIndex].primitives) {
    const acc = json.accessors[p.attributes.POSITION];
    const view = json.bufferViews[acc.bufferView];
    const stride = view.byteStride ?? 12;
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
    }
  }
  return out;
}

// column-major 4x4 matrices
const mul = (a, b) => {
  const m = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) m[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return m;
};
function local(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function worlds(json) {
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent.set(c, i)));
  const memo = new Map();
  const world = i => {
    if (!memo.has(i)) memo.set(i, parent.has(i) ? mul(world(parent.get(i)), local(json.nodes[i])) : local(json.nodes[i]));
    return memo.get(i);
  };
  return json.nodes.map((_, i) => world(i));
}
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const covered = (p, cols, tol) => cols.some(c => dist(p, c.pos) <= c.r + tol);

const exists = existsSync(FILE);
const glb = exists ? readGlb() : null;
const index = name => glb.json.nodes.findIndex(n => n.name === name);
const W = exists ? worlds(glb.json) : [];
const meshWorld = name => {
  const i = index(name);
  return positions(glb.json, glb.bin, glb.json.nodes[i].mesh).map(p => apply(W[i], p));
};

test('perpetua.glb: exists, within its size and triangle budgets', () => {
  assert.ok(exists, 'assets/models/perpetua.glb exists');
  assert.ok(glb.size <= BUDGET.bytes, `size ${glb.size} > ${BUDGET.bytes}`);
  const tris = glb.json.meshes.reduce((t, _, i) => t + trianglesOf(glb.json, i), 0);
  assert.ok(tris <= BUDGET.tris && tris > BUDGET.tris * 0.3, `tris ${tris}`);
});

test('perpetua.glb: WebP textures, at most two 2048² sets', () => {
  const { json, bin } = glb;
  assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'EXT_texture_webp used');
  assert.ok(json.images.length > 0 && json.images.every(i => i.mimeType === 'image/webp'), 'every image is WebP');
  for (const img of json.images) {
    const view = json.bufferViews[img.bufferView];
    const b = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    assert.equal(b.toString('ascii', 0, 4) + b.toString('ascii', 8, 12), 'RIFFWEBP', `${img.name}: RIFF/WEBP`);
    const kind = b.toString('ascii', 12, 16);
    let w, h;
    if (kind === 'VP8 ') { w = b.readUInt16LE(26) & 0x3fff; h = b.readUInt16LE(28) & 0x3fff; }
    else if (kind === 'VP8L') { const v = b.readUInt32LE(21); w = (v & 0x3fff) + 1; h = ((v >> 14) & 0x3fff) + 1; }
    else { w = b.readUIntLE(24, 3) + 1; h = b.readUIntLE(27, 3) + 1; }
    assert.ok(w <= 2048 && h <= 2048 && w >= 128, `${img.name}: ${w}x${h}`);
  }
  const textured = json.materials.filter(m => m.pbrMetallicRoughness?.baseColorTexture);
  assert.ok(textured.length >= 1 && textured.length <= 2, `${textured.length} textured materials`);
  for (const m of textured) assert.ok(m.normalTexture && m.pbrMetallicRoughness.metallicRoughnessTexture, `${m.name} maps`);
});

test('perpetua.glb: length along Z matches the brief (±15 %), radius and length in the anchors', () => {
  let zmin = Infinity, zmax = -Infinity, rmax = 0;
  for (const name of ['hull', 'ring']) for (const p of meshWorld(name)) {
    zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]); rmax = Math.max(rmax, Math.hypot(...p));
  }
  const length = zmax - zmin;
  assert.ok(Math.abs(length - BUDGET.length) <= BUDGET.length * 0.15, `length ${length}`);
  assert.ok(Math.abs(A.length - length) < 2, `anchors length ${A.length} vs ${length}`);
  assert.ok(A.radius >= rmax - 0.5, `anchors radius ${A.radius} < ${rmax}`);
});

test('perpetua: every anchor in js/anchors/perpetua.js exists as a node', () => {
  const named = [...A.nozzles, ...A.muzzles, ...A.rcs, ...A.launchers, ...A.subsystems, ...A.turrets, ...A.bays,
    ...A.lights];
  for (const a of named) {
    const i = index(a.name);
    assert.ok(i >= 0, `node ${a.name}`);
    if (a.pos) assert.ok(dist(apply(W[i], [0, 0, 0]), a.pos) < 0.05, `${a.name} position`);
  }
  for (const name of Object.values(A.nodes)) assert.ok(index(name) >= 0, `animated node ${name}`);
  const cols = glb.json.nodes.map((n, i) => [n, i]).filter(([n]) => /^col_\d+$/.test(n.name));
  assert.equal(cols.length, A.colliders.length, 'one col_* node per collider');
  for (const c of A.colliders) {
    const hit = cols.some(([n, i]) => dist(apply(W[i], [0, 0, 0]), c.pos) < 0.05 && Math.abs((n.scale?.[0] ?? 1) - c.r) < 0.05);
    assert.ok(hit, `col node at ${c.pos} r ${c.r}`);
  }
  for (const s of ['sub_bridge', 'sub_hangar', 'sub_engine_0', 'sub_engine_1', 'sub_engine_2'])
    assert.ok(A.subsystems.some(x => x.name === s && x.r > 0), s);
  assert.deepEqual([A.muzzles, A.rcs, A.launchers, A.cockpit, A.dock], [[], [], [], null, null]);
});

test('perpetua: three nozzles exhaust toward +Z, exit radius about 35 m', () => {
  assert.deepEqual(A.nozzles.map(n => n.name), ['nozzle_0', 'nozzle_1', 'nozzle_2']);
  for (const n of A.nozzles) {
    assert.ok(n.dir[2] > 0.95, `${n.name} exhausts to +Z`);
    assert.ok(Math.abs(n.size - 35) <= 5, `${n.name} size ${n.size}`);
    assert.ok(n.pos[2] > 600, `${n.name} at the stern`);
  }
});

test('perpetua: ten turrets, each a yaw node with a pitch child, under 400 triangles', () => {
  assert.equal(A.turrets.length, 10);
  for (let k = 0; k < 10; k++) {
    const name = `turret_${String(k).padStart(2, '0')}`;
    const t = A.turrets.find(x => x.name === name);
    assert.ok(t, name);
    const node = glb.json.nodes[index(name)];
    assert.ok(node.mesh !== undefined, `${name} mesh`);
    const gun = (node.children ?? []).map(c => glb.json.nodes[c]).find(n => n.name === `${name}_gun`);
    assert.ok(gun && gun.mesh !== undefined, `${name}_gun child`);
    const tris = trianglesOf(glb.json, node.mesh) + trianglesOf(glb.json, gun.mesh);
    assert.ok(tris < 400, `${name}: ${tris} tris`);
    assert.ok(Math.abs(Math.hypot(...t.up) - 1) < 1e-3 && Math.abs(Math.hypot(...t.fwd) - 1) < 1e-3, `${name} unit axes`);
    assert.ok(Math.abs(dot(t.up, t.fwd)) < 1e-3, `${name} up and fwd orthogonal`);
    const m = W[index(name)];
    assert.ok(dot([m[4], m[5], m[6]], t.up) > 0.999, `${name} up is the node's local +Y`);
    assert.ok(dot([-m[8], -m[9], -m[10]], t.fwd) > 0.999, `${name} fwd is the node's local -Z`);
    assert.ok(t.size > 5 && t.size < 30, `${name} size ${t.size}`);
  }
});

test('perpetua: the ring is its own node, origin on the ship axis, no rotation', () => {
  assert.equal(A.nodes.ring, 'ring');
  const node = glb.json.nodes[index('ring')];
  assert.ok(node.mesh !== undefined, 'ring mesh');
  const [x, y] = node.translation ?? [0, 0, 0];
  assert.ok(Math.abs(x) < 1e-3 && Math.abs(y) < 1e-3, `ring origin ${node.translation}`);
  assert.ok(!node.rotation || Math.abs(node.rotation[3]) > 0.99999, 'ring unrotated');
  assert.ok(glb.json.scenes[0].nodes.includes(index('ring')), 'ring is a scene root');
});

test('perpetua: 50–90 colliders cover the ring at any spin angle and nearly all the hull', () => {
  const cols = A.colliders;
  assert.ok(cols.length >= 50 && cols.length <= 90, `${cols.length} colliders`);
  assert.ok(cols.every(c => c.r > 0 && c.pos.every(Number.isFinite)), 'finite spheres');
  const ringNode = glb.json.nodes[index('ring')];
  const centre = ringNode.translation ?? [0, 0, 0];
  const ring = positions(glb.json, glb.bin, ringNode.mesh);
  for (const deg of [0, 7, 19, 33, 45, 71]) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const missed = ring.filter(([x, y, z]) => !covered([x * c - y * s + centre[0], x * s + y * c + centre[1], z + centre[2]], cols, 4));
    assert.equal(missed.length, 0, `ring at ${deg}°: ${missed.length} vertices outside the colliders`);
  }
  const hull = meshWorld('hull');
  const share = hull.filter(p => covered(p, cols, 4)).length / hull.length;
  assert.ok(share >= 0.97, `hull vertices covered ${(share * 100).toFixed(2)} %`);
  for (const b of A.bays) assert.ok(!cols.some(c => dist(b.pos, c.pos) < c.r), `${b.name} clear of the colliders`);
});

test('perpetua: bay launches downward, lights red to port, green to starboard, white strobes blink', () => {
  assert.equal(A.bays.length, 1);
  assert.ok(A.bays[0].name === 'bay_0' && A.bays[0].dir[1] < -0.8, 'bay_0 launches down');
  const isRed = l => l.color[0] > 0.8 && l.color[1] < 0.3;
  const isGreen = l => l.color[1] > 0.8 && l.color[0] < 0.3;
  assert.ok(A.lights.some(isRed) && A.lights.some(isGreen), 'red and green lights');
  for (const l of A.lights) {
    if (isRed(l)) assert.ok(l.pos[0] < 0, `${l.name} red to port`);
    else if (isGreen(l)) assert.ok(l.pos[0] > 0, `${l.name} green to starboard`);
    else assert.ok(l.blink > 0, `${l.name} white strobe blinks`);
  }
});

if (process.argv[1]?.endsWith('models-perpetua-check.mjs')) await run();
