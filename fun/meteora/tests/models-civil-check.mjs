/* Meteora — the civil models (Mule freighter, Varlaam station, Long Mercy
   ark) checked against the models brief and their generated anchors
   modules: size and triangle budgets, WebP textures and their sizes, the
   length along the nose axis, every anchor present as a node, nozzles
   exhausting to +Z, turrets (base + gun, local frames, triangle budget),
   colliders (the station's bay lane and the ark's drive-ring opening kept
   clear) and the animated nodes. Rebuild with tools/blender/build_civil.py. */
import { test, run, assert } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { dot, len, sub } from '../js/vec.js';
import freighter from '../js/anchors/freighter.js';
import station from '../js/anchors/station.js';
import colony from '../js/anchors/colony.js';

const MODELS = new URL('../assets/models/', import.meta.url);
const MB = 1024 * 1024;

function readGlb(name) {
  const buf = readFileSync(new URL(name, MODELS));
  assert.equal(buf.readUInt32LE(0), 0x46546c67, `${name}: glTF magic`);
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, `${name}: JSON chunk`);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  return { json, size: buf.length, bin: buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen)) };
}
function trianglesOf(json, meshIndex) {
  let tris = 0;
  for (const p of json.meshes[meshIndex].primitives) tris += json.accessors[p.indices ?? p.attributes.POSITION].count / 3;
  return tris;
}
// WebP canvas size from the RIFF header (lossy VP8, lossless VP8L or extended VP8X).
function webpSize(b) {
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (kind === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  throw new Error(`unknown WebP chunk ${kind}`);
}

// Column-major 4x4 matrices for the node hierarchy.
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
const apply = (m, p) => [0, 1, 2].map(r => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
function worldMatrices(json) {
  const out = new Map();
  const visit = (i, parent) => {
    const m = mul(parent, trs(json.nodes[i]));
    out.set(i, m);
    for (const c of json.nodes[i].children ?? []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const i of json.scenes[json.scene ?? 0].nodes) visit(i, I);
  return out;
}
// World-space bounds of every mesh node (accessor min/max corners through the node matrix).
function bounds(json) {
  const W = worldMatrices(json);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let far = 0;
  json.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    for (const p of json.meshes[n.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let c = 0; c < 8; c++) {
        const q = apply(W.get(i), [0, 1, 2].map(k => (c >> k) & 1 ? a.max[k] : a.min[k]));
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
        far = Math.max(far, len(q));
      }
    }
  });
  return { lo, hi, far };
}
const near = (a, b, eps) => a.every((v, k) => Math.abs(v - b[k]) <= eps);

const MODELS_BRIEF = [
  { file: 'freighter.glb', anchors: freighter, length: 110, tris: 14000, mb: 1.5, maxTex: 2048, sets: 1,
    nozzles: { nozzle_C: 3.2, nozzle_L: 2.4, nozzle_R: 2.4 }, turrets: 0, bays: 0, dock: true,
    subsystems: ['sub_bridge', 'sub_engine_0'], nodes: {} },
  { file: 'station.glb', anchors: station, length: 450, tris: 45000, mb: 3.5, maxTex: 2048, sets: 2,
    nozzles: {}, turrets: 6, bays: 1, dock: false,
    subsystems: ['sub_dock', 'sub_comms', 'sub_reactor'], nodes: {} },
  { file: 'colony.glb', anchors: colony, length: 900, tris: 45000, mb: 3.5, maxTex: 2048, sets: 2,
    nozzles: { nozzle_0: 30, nozzle_1: 30 }, turrets: 4, bays: 0, dock: false,
    subsystems: ['sub_drive', 'sub_engine_0', 'sub_engine_1'], nodes: { drive: 'drive' } },
];
const KEYS = ['radius', 'length', 'nozzles', 'muzzles', 'rcs', 'launchers', 'cockpit', 'dock', 'colliders',
  'subsystems', 'turrets', 'bays', 'lights', 'nodes'];

for (const m of MODELS_BRIEF) {
  const a = m.anchors;
  test(`${m.file}: exists, size and triangle budgets, WebP textures`, () => {
    assert.ok(existsSync(new URL(m.file, MODELS)), 'exists');
    const { json, size, bin } = readGlb(m.file);
    assert.ok(size <= m.mb * MB, `size ${(size / MB).toFixed(2)} MB > ${m.mb} MB`);
    const tris = json.meshes.reduce((t, _, i) => t + trianglesOf(json, i), 0);
    assert.ok(tris <= m.tris && tris > m.tris * 0.3, `tris ${tris}`);
    assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'EXT_texture_webp used');
    assert.ok(!json.extensionsUsed?.includes('KHR_draco_mesh_compression'), 'no Draco');
    let big = 0;
    for (const img of json.images) {
      assert.equal(img.mimeType, 'image/webp', `${img.name} is WebP`);
      const v = json.bufferViews[img.bufferView];
      const [w, h] = webpSize(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
      assert.ok(w <= m.maxTex && h <= m.maxTex, `${img.name} ${w}x${h}`);
      if (w === 2048 && /_base$/.test(img.name)) big++;
    }
    assert.ok(big <= m.sets, `${big} 2048² texture sets`);
    for (const mat of json.materials) {
      const pbr = mat.pbrMetallicRoughness ?? {};
      if (!pbr.baseColorTexture) continue;
      if (/windows/.test(mat.name)) assert.ok(mat.emissiveTexture, `${mat.name}: emissive windows`);
      else assert.ok(mat.normalTexture && pbr.metallicRoughnessTexture, `${mat.name}: normal and MR maps`);
    }
  });

  test(`${m.file}: length, radius, anchors module shape`, () => {
    const { json } = readGlb(m.file);
    for (const k of KEYS) assert.ok(k in a, `anchors.${k}`);
    const { lo, hi, far } = bounds(json);
    const zlen = hi[2] - lo[2];
    assert.ok(Math.abs(zlen - m.length) <= m.length * 0.15, `length ${zlen.toFixed(1)} vs ${m.length}`);
    assert.ok(Math.abs(a.length - zlen) <= 1, `anchors.length ${a.length} vs ${zlen.toFixed(1)}`);
    const maxAbs = Math.max(...lo.map(Math.abs), ...hi.map(Math.abs));
    assert.ok(a.radius >= maxAbs - 0.1 && a.radius <= far + 0.1, `radius ${a.radius} in [${maxAbs}, ${far}]`);
    assert.equal(a.dock !== null, m.dock, 'dock');
    if (m.dock) assert.ok(a.dock[1] > 0, 'dock on top');
  });

  test(`${m.file}: every anchor is a node; nozzles, subsystems, lights`, () => {
    const { json } = readGlb(m.file);
    const W = worldMatrices(json);
    const byName = new Map(json.nodes.map((n, i) => [n.name, i]));
    const named = [...a.nozzles, ...a.muzzles, ...a.rcs, ...a.launchers, ...a.subsystems, ...a.turrets, ...a.bays,
      ...a.lights];
    for (const x of named) {
      assert.ok(byName.has(x.name), `node ${x.name}`);
      const p = apply(W.get(byName.get(x.name)), [0, 0, 0]);
      assert.ok(near(p, x.pos, 0.02), `${x.name} at ${x.pos}, node at ${p.map(v => v.toFixed(2))}`);
    }
    assert.deepEqual(a.nozzles.map(n => n.name).sort(), Object.keys(m.nozzles).sort(), 'nozzle names');
    for (const n of a.nozzles) {
      assert.ok(n.dir[2] > 0.95, `${n.name} exhausts to +Z`);
      assert.ok(Math.abs(n.size - m.nozzles[n.name]) <= m.nozzles[n.name] * 0.1, `${n.name} size ${n.size}`);
      assert.ok(n.pos[2] > 0, `${n.name} aft of centre`);
    }
    assert.deepEqual(a.subsystems.map(s => s.name).sort(), m.subsystems.slice().sort(), 'subsystems');
    for (const s of a.subsystems) {
      assert.equal(s.kind, s.name.split('_')[1], `${s.name} kind`);
      assert.ok(s.r > 0, `${s.name} radius`);
      assert.ok(len(s.pos) <= a.radius, `${s.name} inside the model`);
    }
    assert.ok(a.lights.length >= 4, 'nav lights');
    for (const l of a.lights) {
      assert.ok(l.color.length === 3 && l.color.every(c => c >= 0 && c <= 1), `${l.name} colour`);
      assert.ok(l.blink >= 0, `${l.name} blink`);
    }
    const reds = a.lights.filter(l => l.color[0] > 0.9 && l.color[1] < 0.2), greens = a.lights.filter(l => l.color[1] > 0.9 && l.color[0] < 0.2);
    assert.ok(reds.some(l => l.pos[0] < 0) && greens.some(l => l.pos[0] > 0), 'red to port, green to starboard');
    assert.equal(a.bays.length, m.bays, 'bays');
    for (const b of a.bays) assert.ok(Math.abs(len(b.dir) - 1) < 1e-3, `${b.name} dir`);
    for (const [key, name] of Object.entries(m.nodes)) {
      assert.equal(a.nodes[key], name, `nodes.${key}`);
      assert.ok(byName.has(name) && json.nodes[byName.get(name)].mesh !== undefined, `animated node ${name} is a mesh`);
    }
  });

  test(`${m.file}: turrets are a base with a gun child, framed and within budget`, () => {
    const { json } = readGlb(m.file);
    assert.equal(a.turrets.length, m.turrets, 'turret count');
    a.turrets.forEach((t, i) => {
      assert.equal(t.name, `turret_${String(i).padStart(2, '0')}`);
      const base = json.nodes.find(n => n.name === t.name);
      assert.ok(base && base.mesh !== undefined, `${t.name} mesh`);
      const gun = (base.children ?? []).map(c => json.nodes[c]).find(n => n.name === `${t.name}_gun`);
      assert.ok(gun && gun.mesh !== undefined, `${t.name}_gun child mesh`);
      assert.ok(trianglesOf(json, base.mesh) <= 400 && trianglesOf(json, gun.mesh) <= 400, `${t.name} tris`);
      assert.ok(Math.abs(len(t.up) - 1) < 1e-3 && Math.abs(len(t.fwd) - 1) < 1e-3, `${t.name} unit axes`);
      assert.ok(Math.abs(dot(t.up, t.fwd)) < 1e-3, `${t.name} up ⟂ fwd`);
      assert.ok(t.size > 0, `${t.name} size`);
      for (const node of [base, gun]) for (const p of json.meshes[node.mesh].primitives) {
        const pbr = json.materials[p.material].pbrMetallicRoughness;
        assert.ok(pbr && !pbr.baseColorTexture, `${node.name}: plain factors`);
      }
    });
  });

  test(`${m.file}: colliders cover the hull`, () => {
    const { json } = readGlb(m.file);
    const cols = a.colliders;
    assert.ok(cols.length >= 10 && cols.length <= 120, `${cols.length} colliders`);
    assert.equal(json.nodes.filter(n => /^col_\d+$/.test(n.name)).length, cols.length, 'col_* nodes');
    for (const c of cols) {
      assert.ok(c.r > 0, 'radius');
      assert.ok(len(c.pos) + c.r <= a.radius * 1.25, 'collider near the model');
    }
    // the colliders together cover the subsystems' centres and the model's extent
    const inside = p => cols.some(c => len(sub([0, 0, 0], p, c.pos)) <= c.r);
    for (const s of a.subsystems) if (s.kind !== 'drive' && s.kind !== 'dock') assert.ok(inside(s.pos), `${s.name} covered`);
    const { lo, hi } = bounds(json);
    const reach = [0, 1, 2].map(k => [Math.min(...cols.map(c => c.pos[k] - c.r)), Math.max(...cols.map(c => c.pos[k] + c.r))]);
    for (let k = 0; k < 3; k++) {
      const span = hi[k] - lo[k];
      assert.ok(reach[k][0] <= lo[k] + span * 0.08 && reach[k][1] >= hi[k] - span * 0.08, `extent axis ${k}`);
    }
  });
}

test('station: the bay launches forward and its lane is clear of colliders', () => {
  const [bay] = station.bays;
  assert.equal(bay.name, 'bay_0');
  assert.ok(bay.dir[2] < -0.95, 'launches forward (-Z)');
  const dock = station.subsystems.find(s => s.name === 'sub_dock');
  assert.ok(dock.pos[2] < -150, 'dock at the front');
  for (let t = 0; t <= 150; t += 2) {
    const p = [0, 1, 2].map(k => bay.pos[k] + bay.dir[k] * t);
    for (const c of station.colliders) assert.ok(len(sub([0, 0, 0], p, c.pos)) > c.r, `collider at ${c.pos} blocks the lane at ${t} m`);
  }
});

test('colony: the drive ring is its own node at the ring centre, its opening clear', () => {
  const { json } = readGlb('colony.glb');
  const drive = json.nodes.find(n => n.name === 'drive');
  const W = worldMatrices(json);
  const centre = apply(W.get(json.nodes.indexOf(drive)), [0, 0, 0]);
  const sd = colony.subsystems.find(s => s.name === 'sub_drive');
  assert.ok(near(centre, sd.pos, 0.05), `drive origin ${centre} vs sub_drive ${sd.pos}`);
  assert.ok(sd.pos[2] < -300, 'drive at the bow');
  assert.ok(Math.abs(sd.r - 120) <= 18, `sub_drive r ${sd.r} ≈ the ring's inner radius`);
  const mat = json.materials[json.meshes[drive.mesh].primitives[0].material];
  assert.ok(mat.emissiveTexture, 'drive coils are emissive');
  const acc = json.accessors[json.meshes[drive.mesh].primitives[0].attributes.POSITION];
  const rx = Math.max(Math.abs(acc.min[0]), acc.max[0]);
  assert.ok(rx > sd.r, 'the ring is wider than its opening');
  // ships fly through: nothing within 0.85 inner radii of the axis near the ring plane
  for (const c of colony.colliders) {
    const d = sub([0, 0, 0], c.pos, sd.pos);
    if (Math.abs(d[2]) > c.r + 40) continue;
    assert.ok(Math.hypot(d[0], d[1]) - c.r >= sd.r * 0.85, `collider at ${c.pos} r ${c.r} intrudes into the ring`);
  }
});

test('freighter: dock on top of the cab, bridge forward, engines aft', () => {
  const bridge = freighter.subsystems.find(s => s.name === 'sub_bridge');
  const engine = freighter.subsystems.find(s => s.name === 'sub_engine_0');
  assert.ok(bridge.pos[2] < -35 && engine.pos[2] > 35, 'bridge forward, engines aft');
  assert.ok(Math.abs(freighter.dock[2] - bridge.pos[2]) < 10 && freighter.dock[1] > bridge.pos[1], 'dock above the bridge');
  const c = freighter.nozzles.find(n => n.name === 'nozzle_C');
  assert.ok(freighter.nozzles.every(n => n.pos[2] <= c.pos[2] + 0.01), 'centre engine the longest');
});

if (process.argv[1]?.endsWith('models-civil-check.mjs')) await run();
