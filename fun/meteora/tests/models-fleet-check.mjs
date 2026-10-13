/* Meteora — the fleet models (Mite, Talon, Warden, Halberd), checked from
   their glTF chunks and their generated js/anchors/<name>.js modules:
   triangle and file budgets, WebP textures within their sizes, length along
   the nose axis, every named anchor present as a node where the module says
   it is, nozzles exhausting to +Z, turret nodes with their gun children,
   collision spheres that hug the hull, and the small craft's RCS ports.
   Regenerate with tools/blender/build_fleet.py. */
import { test, run, assert } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { cross, dot, normalize, scale } from '../js/vec.js';
import mite from '../js/anchors/mite.js';
import talon from '../js/anchors/talon.js';
import warden from '../js/anchors/warden.js';
import halberd from '../js/anchors/halberd.js';

const MODELS = new URL('../assets/models/', import.meta.url);
const MB = 1024 * 1024;

function readGlb(file) {
  const buf = readFileSync(new URL(file, MODELS));
  assert.equal(buf.readUInt32LE(0), 0x46546c67, `${file}: glTF magic`);
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, `${file}: JSON chunk`);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binAt = 20 + jsonLen;
  assert.equal(buf.readUInt32LE(binAt + 4), 0x004e4942, `${file}: BIN chunk`);
  return { json, size: buf.length, bin: buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt)) };
}

function trianglesOf(json, meshIndex) {
  let tris = 0;
  for (const p of json.meshes[meshIndex].primitives) tris += json.accessors[p.indices ?? p.attributes.POSITION].count / 3;
  return tris;
}

// Column-major 4x4 matrices, as glTF stores them.
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
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
const apply = (m, p) => [0, 1, 2].map(r => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

/* Every node's world matrix and parent index. */
function worldOf(json) {
  const world = new Array(json.nodes.length), parent = new Array(json.nodes.length).fill(-1);
  json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => { parent[c] = i; }));
  const visit = (i, m) => { world[i] = mul(m, local(json.nodes[i])); (json.nodes[i].children ?? []).forEach(c => visit(c, world[i])); };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  (json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_, i) => i).filter(i => parent[i] < 0)).forEach(i => visit(i, I));
  return { world, parent };
}

/* World bounds of every drawn mesh node (accessor bounds, transformed). */
function boundsOf(json, world) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  json.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    for (const p of json.meshes[n.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
        const q = apply(world[i], [cx, cy, cz]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
      }
    }
  });
  return { lo, hi };
}

/* Width and height of an embedded WebP (VP8, VP8L or VP8X). */
function webpSize(b) {
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  assert.equal(kind, 'VP8 ', 'webp chunk');
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

const FLEET = [
  { key: 'mite', a: mite, size: 5, tris: 2500, mb: 0.4, tex: 1024, nozzle: 0.35, nozzles: ['nozzle_C'],
    muzzles: ['muzzle_C'], launchers: [], rcs: 8, turrets: 0 },
  { key: 'talon', a: talon, size: 13, tris: 10000, mb: 1.3, tex: 2048, nozzle: 0.6, nozzles: ['nozzle_L', 'nozzle_R'],
    muzzles: ['muzzle_L', 'muzzle_R'], launchers: ['launcher_0', 'launcher_1'], rcs: 16, turrets: 0 },
  { key: 'warden', a: warden, size: 140, tris: 24000, mb: 2.2, tex: 2048, nozzle: 6, nozzles: null, muzzles: [],
    launchers: [], rcs: 0, turrets: 4, subs: ['engine', 'bridge'] },
  { key: 'halberd', a: halberd, size: 160, tris: 26000, mb: 2.4, tex: 2048, nozzle: 7, nozzles: ['nozzle_0', 'nozzle_1'],
    muzzles: [], launchers: [], rcs: 0, turrets: 6, subs: ['engine', 'engine', 'bridge'] },
];
const LISTS = ['nozzles', 'muzzles', 'rcs', 'launchers', 'colliders', 'subsystems', 'turrets', 'bays', 'lights'];

for (const ship of FLEET) {
  const file = `${ship.key}.glb`;
  const a = ship.a;

  test(`${file}: exists, budgets, WebP textures, length`, () => {
    assert.ok(existsSync(new URL(file, MODELS)), 'exists');
    const { json, size, bin } = readGlb(file);
    assert.ok(size <= ship.mb * MB, `size ${size}`);
    // triangles as drawn: a mesh shared by several nodes counts once per node
    const tris = json.nodes.reduce((t, n) => t + (n.mesh === undefined ? 0 : trianglesOf(json, n.mesh)), 0);
    assert.ok(tris <= ship.tris && tris > ship.tris * 0.25, `tris ${tris}`);
    assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'EXT_texture_webp');
    assert.ok(json.images?.length >= 4, 'baked textures');
    for (const img of json.images) {
      assert.equal(img.mimeType, 'image/webp', `${img.name} is WebP`);
      const bv = json.bufferViews[img.bufferView];
      const [w, h] = webpSize(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
      assert.ok(w === h && w <= ship.tex && w >= 256, `${img.name} ${w}x${h}`);
    }
    for (const m of json.materials) {
      const pbr = m.pbrMetallicRoughness;
      assert.ok(pbr.baseColorTexture && m.normalTexture && pbr.metallicRoughnessTexture, `${m.name} textures`);
    }
    const { world } = worldOf(json);
    const { lo, hi } = boundsOf(json, world);
    const length = hi[2] - lo[2];
    assert.ok(Math.abs(length - ship.size) <= ship.size * 0.15, `length ${length}`);
    assert.ok(Math.abs(length - a.length) <= ship.size * 0.02, `module length ${a.length} vs ${length}`);
    const corner = Math.hypot(...[0, 1, 2].map(k => Math.max(-lo[k], hi[k])));
    assert.ok(a.radius >= length / 2 - 0.01 && a.radius <= corner + 0.01, `radius ${a.radius}`);
  });

  test(`${ship.key}: anchors module shape`, () => {
    for (const key of LISTS) assert.ok(Array.isArray(a[key]), `${key} is a list`);
    assert.ok(a.cockpit === null || (Array.isArray(a.cockpit) && a.cockpit.length === 3), 'cockpit');
    assert.ok(a.dock === null || (Array.isArray(a.dock) && a.dock.length === 3), 'dock');
    assert.ok(a.nodes && typeof a.nodes === 'object' && !Array.isArray(a.nodes), 'nodes');
    assert.ok(a.radius > 0 && a.length > 0, 'radius and length');
  });

  test(`${ship.key}: every anchor is a node of the GLB, where the module puts it`, () => {
    const { json } = readGlb(file);
    const { world, parent } = worldOf(json);
    const index = new Map(json.nodes.map((n, i) => [n.name, i]));
    const at = name => {
      assert.ok(index.has(name), `node ${name}`);
      const m = world[index.get(name)];
      return [m[12], m[13], m[14]];
    };
    const near = (p, q, label) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.02, `${label} ${p} vs ${q}`);
    for (const key of ['nozzles', 'muzzles', 'rcs', 'launchers', 'subsystems', 'turrets', 'bays', 'lights']) {
      for (const it of a[key]) near(at(it.name), it.pos, it.name);
    }
    for (const name of Object.values(a.nodes)) at(name);
    if (a.cockpit) near(at('cam_cockpit'), a.cockpit, 'cam_cockpit');
    // turrets: a mesh node with a mesh child `<name>_gun`, under 400 triangles each
    assert.equal(a.turrets.length, ship.turrets, 'turret count');
    for (const t of a.turrets) {
      const b = index.get(t.name), g = index.get(`${t.name}_gun`);
      assert.ok(g !== undefined, `${t.name}_gun`);
      assert.equal(parent[g], b, `${t.name}_gun is a child of ${t.name}`);
      for (const i of [b, g]) {
        assert.ok(json.nodes[i].mesh !== undefined, `${json.nodes[i].name} has a mesh`);
        assert.ok(trianglesOf(json, json.nodes[i].mesh) < 400, `${json.nodes[i].name} under 400 triangles`);
      }
      assert.ok(Math.abs(Math.hypot(...t.up) - 1) < 1e-3 && Math.abs(Math.hypot(...t.fwd) - 1) < 1e-3, `${t.name} unit axes`);
      assert.ok(Math.abs(dot(t.up, t.fwd)) < 0.01, `${t.name} up is square to fwd`);
      assert.ok(Math.abs(t.fwd[2]) > 0.9, `${t.name} rests along the ship's axis`);
      assert.ok(t.size > 0, `${t.name} size`);
    }
  });

  test(`${ship.key}: weapons, engines and subsystems`, () => {
    if (ship.nozzles) assert.deepEqual(a.nozzles.map(n => n.name), ship.nozzles);
    assert.ok(a.nozzles.length >= 1, 'nozzles');
    for (const n of a.nozzles) {
      assert.ok(n.dir[2] > 0.95, `${n.name} exhausts to +Z`);
      assert.ok(Math.abs(n.size - ship.nozzle) <= ship.nozzle * 0.25, `${n.name} size ${n.size}`);
      assert.ok(n.pos[2] > 0, `${n.name} aft of centre`);
    }
    assert.deepEqual(a.muzzles.map(m => m.name), ship.muzzles);
    for (const m of a.muzzles) assert.ok(m.pos[2] < 0, `${m.name} ahead of centre`);
    assert.deepEqual(a.launchers.map(l => l.name), ship.launchers);
    assert.ok(a.rcs.length >= ship.rcs, 'rcs ports');
    if (ship.rcs) assert.ok(a.cockpit && a.cockpit[2] < 0, 'cockpit eye ahead of centre');
    for (const kind of new Set(ship.subs ?? [])) {
      const want = ship.subs.filter(k => k === kind).length;
      assert.equal(a.subsystems.filter(s => s.kind === kind).length, want, `sub ${kind}`);
    }
    for (const s of a.subsystems) {
      assert.ok(s.r > 0, `${s.name} radius`);
      assert.ok(s.name.startsWith(`sub_${s.kind}`), `${s.name} kind ${s.kind}`);
    }
    for (const l of a.lights) {
      assert.ok(l.color.length === 3 && l.color.every(c => c >= 0 && c <= 1), `${l.name} colour`);
      assert.ok(l.blink >= 0, `${l.name} blink`);
    }
    for (const b of a.bays) assert.ok(Math.abs(Math.hypot(...b.dir) - 1) < 1e-3, `${b.name} dir`);
  });

  if (ship.turrets) {
    test(`${ship.key}: collision spheres hug the hull`, () => {
      const { json } = readGlb(file);
      const { world } = worldOf(json);
      const { lo, hi } = boundsOf(json, world);
      const cols = a.colliders;
      assert.ok(cols.length >= 12 && cols.length <= 80, `${cols.length} colliders`);
      const ulo = [Infinity, Infinity, Infinity], uhi = [-Infinity, -Infinity, -Infinity];
      for (const c of cols) {
        assert.ok(c.r > 0, 'radius');
        for (let k = 0; k < 3; k++) {
          assert.ok(c.pos[k] > lo[k] && c.pos[k] < hi[k], `centre ${c.pos} inside the hull's bounds`);
          ulo[k] = Math.min(ulo[k], c.pos[k] - c.r);
          uhi[k] = Math.max(uhi[k], c.pos[k] + c.r);
        }
      }
      for (let k = 0; k < 3; k++) {
        // never far outside the hull, and spanning most of it (thin tines,
        // spikes and antennae may stay uncovered)
        assert.ok(ulo[k] >= lo[k] - 2.5 && uhi[k] <= hi[k] + 2.5, `axis ${k}: spheres stand proud of the hull`);
        assert.ok(uhi[k] - ulo[k] >= (hi[k] - lo[k]) * 0.7, `axis ${k}: spheres span ${uhi[k] - ulo[k]} of ${hi[k] - lo[k]}`);
      }
      for (const s of a.subsystems) {
        const d = Math.min(...cols.map(c => Math.hypot(c.pos[0] - s.pos[0], c.pos[1] - s.pos[1], c.pos[2] - s.pos[2]) - c.r));
        assert.ok(d < s.r, `${s.name} sits on the colliders`);
      }
    });
  } else {
    test(`${ship.key}: RCS can push every axis and turn every way`, () => {
      const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (const axis of axes) {
        const linear = a.rcs.filter(p => dot(scale([0, 0, 0], p.dir, -1), axis) > 0.5).length;
        const turning = a.rcs.filter(p => {
          const t = normalize([0, 0, 0], cross([0, 0, 0], p.pos, scale([0, 0, 0], p.dir, -1)));
          return dot(t, axis) > 0.3;
        }).length;
        assert.ok(linear >= 2, `linear ${axis}: ${linear}`);
        assert.ok(turning >= 2, `turning ${axis}: ${turning}`);
      }
    });
  }
}

if (process.argv[1]?.endsWith('models-fleet-check.mjs')) await run();
