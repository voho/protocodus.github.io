/* Meteora — the Harrow Mother (mother.glb), checked from its glTF JSON
   chunk against the models brief and against js/anchors/mother.js: the
   size and triangle budgets, WebP textures (two 2048² sets at most), the
   length, every named anchor as a node at the position the module gives,
   the collision spheres, the subsystems, the turrets with their guns, the
   bays, the beacons and the animated nodes. Regenerate the model and the
   module with tools/blender/build_mother.py. */
import { test, run, assert } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import A from '../js/anchors/mother.js';

const FILE = new URL('../assets/models/mother.glb', import.meta.url);
const BUDGET = { bytes: 4 * 1024 * 1024, tris: 60000, length: 800, turretTris: 400, textureSize: 2048, textureSets: 2 };

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
const trianglesOf = (json, mesh) => json.meshes[mesh].primitives
  .reduce((t, p) => t + json.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0);

// Column-major 4x4 matrices, enough to place every node in model space.
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const point = (m, p) => [0, 1, 2].map(r => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
const vector = (m, v) => [0, 1, 2].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
const length = v => Math.hypot(...v);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function scene(json) {
  const world = new Map(), parent = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent.set(c, i)));
  const get = i => {
    if (!world.has(i)) world.set(i, parent.has(i) ? mul(get(parent.get(i)), trs(json.nodes[i])) : trs(json.nodes[i]));
    return world.get(i);
  };
  const byName = new Map(json.nodes.map((n, i) => [n.name, i]));
  return {
    has: name => byName.has(name),
    node: name => json.nodes[byName.get(name)],
    matrix: name => get(byName.get(name)),
    pos: name => point(get(byName.get(name)), [0, 0, 0]),
    children: name => (json.nodes[byName.get(name)].children ?? []).map(c => json.nodes[c].name),
    meshNodes: () => json.nodes.map((n, i) => [n, i]).filter(([n]) => n.mesh !== undefined),
    get,
  };
}

// Width and height of an embedded WebP (lossy, lossless or extended).
function webpSize(b) {
  assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  if (kind === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  throw new Error(`unknown WebP chunk ${kind}`);
}

const glb = existsSync(FILE) ? readGlb() : null;
const close = (a, b, eps, label) => assert.ok(dist(a, b) <= eps, `${label}: ${a} vs ${b}`);

test('mother.glb exists and fits 4 MB', () => {
  assert.ok(glb, 'assets/models/mother.glb');
  assert.ok(glb.size <= BUDGET.bytes, `size ${glb.size}`);
});

test('triangles: within 60k counting every mesh node, turrets under 400 each', () => {
  const { json } = glb, s = scene(json);
  const tris = s.meshNodes().reduce((t, [n]) => t + trianglesOf(json, n.mesh), 0);
  assert.ok(tris <= BUDGET.tris && tris > BUDGET.tris * 0.3, `tris ${tris}`);
  for (const t of A.turrets) {
    const total = trianglesOf(json, s.node(t.name).mesh) + trianglesOf(json, s.node(`${t.name}_gun`).mesh);
    assert.ok(total <= BUDGET.turretTris, `${t.name}: ${total} tris`);
  }
});

test('textures: WebP, at most two 2048² sets', () => {
  const { json, bin } = glb;
  assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'EXT_texture_webp used');
  assert.ok(json.extensionsRequired?.includes('EXT_texture_webp'), 'EXT_texture_webp required');
  assert.ok(json.images?.length > 0, 'images');
  for (const im of json.images) {
    assert.equal(im.mimeType, 'image/webp', im.name);
    const view = json.bufferViews[im.bufferView];
    const [w, h] = webpSize(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
    assert.ok(w <= BUDGET.textureSize && h <= BUDGET.textureSize, `${im.name} ${w}x${h}`);
  }
  for (const t of json.textures) assert.ok(t.extensions?.EXT_texture_webp, 'texture sources are WebP');
  const textured = json.materials.filter(m => m.pbrMetallicRoughness?.baseColorTexture);
  const source = t => json.textures[t.index].extensions?.EXT_texture_webp?.source ?? json.textures[t.index].source;
  const sets = new Set(textured.map(m => source(m.pbrMetallicRoughness.baseColorTexture)));
  assert.ok(sets.size >= 1 && sets.size <= BUDGET.textureSets, `${sets.size} texture sets`);
  for (const m of textured) {
    assert.ok(m.normalTexture && m.pbrMetallicRoughness.metallicRoughnessTexture && m.emissiveTexture, `${m.name} maps`);
  }
});

test('length: about 800 m along Z, as the module says', () => {
  const { json } = glb, s = scene(json);
  let lo = Infinity, hi = -Infinity, far = 0;
  for (const [n, i] of s.meshNodes()) {
    const m = s.get(i);
    for (const p of json.meshes[n.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (const x of [a.min[0], a.max[0]]) for (const y of [a.min[1], a.max[1]]) for (const z of [a.min[2], a.max[2]]) {
        const q = point(m, [x, y, z]);
        lo = Math.min(lo, q[2]); hi = Math.max(hi, q[2]); far = Math.max(far, length(q));
      }
    }
  }
  const L = hi - lo;
  assert.ok(Math.abs(L - BUDGET.length) <= BUDGET.length * 0.15, `length ${L}`);
  assert.ok(Math.abs(L - A.length) <= 2, `module length ${A.length} vs ${L}`);
  assert.ok(lo < 0 && hi > 0 && Math.abs(lo + hi) < 60, `centred on the origin: ${lo}..${hi}`);
  assert.ok(A.radius > 0.5 * L && A.radius <= far * 1.05 + 1, `radius ${A.radius} (bounds ${far})`);
});

test('every named anchor is a node at the position the module gives', () => {
  const s = scene(glb.json);
  const named = [...A.nozzles, ...A.muzzles, ...A.rcs, ...A.launchers, ...A.subsystems, ...A.turrets, ...A.bays, ...A.lights];
  assert.ok(named.length > 30, 'anchors');
  for (const a of named) {
    assert.ok(s.has(a.name), `node ${a.name}`);
    close(s.pos(a.name), a.pos, 0.05, a.name);
  }
  for (const key of ['nozzles', 'muzzles', 'rcs', 'launchers', 'colliders', 'subsystems', 'turrets', 'bays', 'lights']) {
    assert.ok(Array.isArray(A[key]), `${key} list`);
  }
  assert.equal(A.cockpit, null); assert.equal(A.dock, null);
});

test('colliders: 40–80 col_* spheres, as in the module, enclosing the subsystems', () => {
  const { json } = glb, s = scene(json);
  const cols = json.nodes.filter(n => /^col_\d+$/.test(n.name));
  assert.ok(A.colliders.length >= 40 && A.colliders.length <= 80, `${A.colliders.length} colliders`);
  assert.equal(cols.length, A.colliders.length, 'one node per collider');
  const nodes = cols.map(n => ({ pos: s.pos(n.name), r: length(vector(s.matrix(n.name), [1, 0, 0])) }));
  for (const c of A.colliders) {
    assert.ok(nodes.some(n => dist(n.pos, c.pos) < 0.05 && Math.abs(n.r - c.r) < 0.06), `collider ${c.pos} r ${c.r}`);
    assert.ok(c.r > 0 && length(c.pos) + c.r <= A.radius + 0.5, `collider ${c.pos} inside radius`);
  }
  for (const sub of A.subsystems) {
    assert.ok(A.colliders.some(c => dist(c.pos, sub.pos) < c.r), `${sub.name} inside the colliders`);
  }
});

test('colliders: the hull plating lies inside the spheres everywhere (no gaps into the hull)', () => {
  const { json, bin } = glb, s = scene(json);
  const hull = s.node('hull');
  const plating = json.meshes[hull.mesh].primitives.find(p => json.materials[p.material].name === 'mother_hull');
  assert.ok(plating, 'mother_hull primitive');
  const view = acc => {
    const a = json.accessors[acc], v = json.bufferViews[a.bufferView];
    const T = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : Uint16Array;
    const n = { SCALAR: 1, VEC3: 3 }[a.type];
    return new T(bin.buffer.slice(bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
      bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + a.count * n * T.BYTES_PER_ELEMENT));
  };
  const P = view(plating.attributes.POSITION), I = view(plating.indices), m = s.matrix('hull');
  const outside = q => {
    let out = Infinity;
    for (const c of A.colliders) out = Math.min(out, dist(q, c.pos) - c.r);
    return out;
  };
  // every triangle sampled on a barycentric grid about 1.5 m apart
  let worst = -Infinity, at = null, samples = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map(i => point(m, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]));
    const k = Math.max(1, Math.ceil(Math.max(dist(a, b), dist(a, c), dist(b, c)) / 1.5));
    for (let i = 0; i <= k; i++) for (let j = 0; i + j <= k; j++) {
      const q = [0, 1, 2].map(r => a[r] + (b[r] - a[r]) * i / k + (c[r] - a[r]) * j / k);
      const o = outside(q);
      samples++;
      if (o > worst) { worst = o; at = q.map(v => v.toFixed(1)); }
    }
  }
  assert.ok(samples > 100000, `${samples} samples`);
  assert.ok(worst <= 0.25, `plating point ${at} lies ${worst.toFixed(2)} m outside the colliders`);
});

test('nozzles: two clusters exhausting toward +Z, exit radius 25–30', () => {
  assert.ok(A.nozzles.length >= 4, `${A.nozzles.length} nozzles`);
  for (const n of A.nozzles) {
    assert.ok(n.dir[2] > 0.95, `${n.name} exhausts to +Z`);
    assert.ok(n.size >= 25 && n.size <= 30, `${n.name} size ${n.size}`);
    assert.ok(n.pos[2] > 300, `${n.name} aft`);
  }
  assert.ok(A.nozzles.some(n => n.pos[0] < 0) && A.nozzles.some(n => n.pos[0] > 0), 'port and starboard clusters');
});

test('subsystems: reactor, two shields, two bays, two engines, the beam', () => {
  const want = { sub_reactor: 'reactor', sub_shield_0: 'shield', sub_shield_1: 'shield', sub_bay_0: 'bay',
    sub_bay_1: 'bay', sub_engine_0: 'engine', sub_engine_1: 'engine', sub_beam: 'beam' };
  const s = scene(glb.json);
  for (const [name, kind] of Object.entries(want)) {
    const sub = A.subsystems.find(x => x.name === name);
    assert.ok(sub, name);
    assert.equal(sub.kind, kind, `${name} kind`);
    assert.ok(sub.r > 0, `${name} r`);
    const r = length(vector(s.matrix(name), [1, 0, 0]));
    assert.ok(Math.abs(r - sub.r) < 0.06, `${name}: node scale ${r} is the hit radius ${sub.r}`);
  }
  const reactor = A.subsystems.find(x => x.name === 'sub_reactor');
  close(s.pos('reactor'), reactor.pos, 0.05, 'the reactor node sits at sub_reactor');
  const beam = A.subsystems.find(x => x.name === 'sub_beam');
  assert.ok(beam.pos[2] < -300, 'the beam is in the prow');
  assert.ok(A.muzzles.some(m => m.name === 'muzzle_beam' && m.pos[2] < beam.pos[2]), 'beam muzzle ahead of sub_beam');
});

test('turrets: eight bases with a gun child each, up and fwd as the node frames', () => {
  const s = scene(glb.json);
  assert.equal(A.turrets.length, 8);
  A.turrets.forEach((t, i) => {
    assert.equal(t.name, `turret_0${i}`);
    assert.ok(s.node(t.name).mesh !== undefined, `${t.name} mesh`);
    assert.ok(s.children(t.name).includes(`${t.name}_gun`), `${t.name}_gun is a child`);
    assert.ok(s.node(`${t.name}_gun`).mesh !== undefined, `${t.name}_gun mesh`);
    const m = s.matrix(t.name);
    const up = vector(m, [0, 1, 0]), fwd = vector(m, [0, 0, -1]);
    close(up, t.up, 0.01, `${t.name} up`);
    close(fwd, t.fwd, 0.01, `${t.name} fwd`);
    assert.ok(Math.abs(length(t.up) - 1) < 0.01 && Math.abs(t.up[0] * t.fwd[0] + t.up[1] * t.fwd[1] + t.up[2] * t.fwd[2]) < 0.01,
      `${t.name} frame`);
    assert.ok(t.size > 0, `${t.name} size`);
  });
  const ups = A.turrets.map(t => t.up);
  assert.ok(ups.some(u => u[1] > 0.7) && ups.some(u => u[1] < -0.7), 'turrets above and below the hull');
});

test('bays: two, launching down and forward, each with its subsystem', () => {
  assert.equal(A.bays.length, 2);
  A.bays.forEach((b, i) => {
    assert.equal(b.name, `bay_${i}`);
    assert.ok(b.dir[1] < -0.3 && b.dir[2] < 0, `${b.name} dir ${b.dir}`);
    assert.ok(Math.abs(length(b.dir) - 1) < 0.01, `${b.name} unit dir`);
    assert.ok(A.subsystems.some(s => s.name === `sub_bay_${i}`), `sub_bay_${i}`);
    assert.ok(b.pos[2] < 0, `${b.name} under the forward hull`);
  });
});

test('lights and animated nodes', () => {
  const s = scene(glb.json);
  assert.ok(A.lights.length >= 8, `${A.lights.length} lights`);
  for (const l of A.lights) {
    assert.ok(l.color.length === 3 && l.color.every(c => c >= 0 && c <= 1), `${l.name} colour`);
    assert.ok(l.blink >= 0, `${l.name} blink`);
  }
  for (const key of ['reactor', 'eye']) assert.ok(A.nodes[key], `nodes.${key}`);
  for (const [key, name] of Object.entries(A.nodes)) {
    assert.ok(s.has(name) && s.node(name).mesh !== undefined, `${key}: mesh node ${name}`);
  }
  assert.ok(s.pos('eye')[2] < -250, 'the eye is in the prow');
});

if (process.argv[1]?.endsWith('models-mother-check.mjs')) await run();
