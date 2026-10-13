/* Meteora — the campaign's small craft (tools/blender/build_craft.py), checked
   from the GLBs and their generated anchor modules: budgets (triangles, file
   size), WebP textures of the briefed sizes, the length along the nose axis,
   every anchor in js/anchors/<name>.js present as a node at the same place,
   nozzles exhausting to +Z, RCS coverage, the turret and arm nodes, and
   collision spheres that wrap the hull. Self-contained: importing
   models-check.mjs would register its own cases with the shared harness. */
import { test, run, assert } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { cross, dot, normalize, scale } from '../js/vec.js';

const MODELS = new URL('../assets/models/', import.meta.url);

function readGlb(file) {
  const buf = readFileSync(new URL(file, MODELS));
  assert.equal(buf.readUInt32LE(0), 0x46546c67, `${file}: glTF magic`);
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, `${file}: JSON chunk`);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binAt = 20 + jsonLen;
  assert.equal(buf.readUInt32LE(binAt + 4), 0x004e4942, `${file}: BIN chunk`);
  const bin = buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt));
  return { json, bin, size: buf.length };
}
const trianglesOf = (json, mesh) => json.meshes[mesh].primitives
  .reduce((t, p) => t + json.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0);

// Column-major 4x4 matrices, as glTF stores them.
function trs(node) {
  if (node.matrix) return node.matrix.slice();
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
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14]];
function worldMatrices(json) {
  const parent = {};
  json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => { parent[c] = i; }));
  const memo = {};
  const world = i => memo[i] ??= parent[i] === undefined ? trs(json.nodes[i]) : mul(world(parent[i]), trs(json.nodes[i]));
  return json.nodes.map((_, i) => world(i));
}
function vertices(json, bin, world) {
  const out = [];
  json.nodes.forEach((node, i) => {
    if (node.mesh === undefined) return;
    for (const p of json.meshes[node.mesh].primitives) {
      const acc = json.accessors[p.attributes.POSITION];
      const view = json.bufferViews[acc.bufferView];
      const stride = view.byteStride ?? 12;
      const at = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let v = 0; v < acc.count; v++) {
        const o = at + v * stride;
        out.push(apply(world[i], [bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]));
      }
    }
  });
  return out;
}
function webpSize(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', 'webp RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', 'webp WEBP');
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') {
    const b = bytes.readUInt32LE(21);
    return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
  }
  if (kind === 'VP8X') return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
  throw new Error(`unknown webp chunk ${kind}`);
}
const imageBytes = (json, bin, tex) => {
  const img = json.images[json.textures[tex.index].extensions?.EXT_texture_webp?.source ?? json.textures[tex.index].source];
  assert.equal(img.mimeType, 'image/webp', `${img.name} is webp`);
  const view = json.bufferViews[img.bufferView];
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
};
const near = (a, b, eps) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

// The brief: size along the nose axis, triangles, file size (KB), texture
// sizes (base and normal, MR and emissive), nozzle exit radii, colliders'
// tolerance; plus what each craft must carry.
const CRAFT = [
  { name: 'swift', length: 10, tris: 9000, kb: 1300, tex: [2048, 1024], tol: 0.12,
    nozzles: { nozzle_C: 0.55 }, muzzles: 2, launchers: 1, rcs: [16, 16], cockpit: true, dock: true, glass: true },
  { name: 'anvil', length: 19, tris: 14000, kb: 1700, tex: [2048, 1024], tol: 0.2,
    nozzles: { nozzle_L: 0.8, nozzle_R: 0.8 }, muzzles: 2, launchers: 2, rcs: [16, 16], cockpit: true, dock: true,
    glass: true, turrets: ['turret_rear'] },
  { name: 'drone', length: 3.5, tris: 3000, kb: 450, tex: [1024, 1024], tol: 0.06,
    nozzles: { nozzle_0: null, nozzle_1: null, nozzle_2: null, nozzle_3: null }, muzzles: 0, launchers: 0, rcs: [0, 0],
    cockpit: false, dock: true, nodes: ['arm_L', 'arm_R'] },
  { name: 'torpedo', length: 4.5, tris: 1200, kb: 250, tex: [512, 512], tol: 0.05,
    nozzles: { nozzle_C: 0.2 }, muzzles: 0, launchers: 0, rcs: [0, 0], cockpit: false, dock: false },
  { name: 'shuttle', length: 28, tris: 8000, kb: 1000, tex: [1024, 1024], tol: 0.2,
    nozzles: { nozzle_L: 1.2, nozzle_R: 1.2 }, muzzles: 0, launchers: 0, rcs: [8, 16], cockpit: true, dock: true },
];
const LISTS = ['nozzles', 'muzzles', 'rcs', 'launchers', 'colliders', 'subsystems', 'turrets', 'bays', 'lights'];

for (const craft of CRAFT) {
  const file = `${craft.name}.glb`;
  const load = async () => {
    const glb = readGlb(file);
    const world = worldMatrices(glb.json);
    const a = (await import(`../js/anchors/${craft.name}.js`)).default;
    return { ...glb, world, a, byName: name => glb.json.nodes.findIndex(n => n.name === name) };
  };

  test(`${file}: exists, file size, triangles, WebP textures`, async () => {
    assert.ok(existsSync(new URL(file, MODELS)), 'exists');
    const { json, bin, size } = await load();
    assert.ok(size <= craft.kb * 1024, `size ${size} > ${craft.kb} KB`);
    const tris = json.meshes.reduce((t, _, i) => t + trianglesOf(json, i), 0);
    assert.ok(tris <= craft.tris && tris > craft.tris * 0.5, `tris ${tris}`);
    assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'EXT_texture_webp');
    const textured = json.materials.filter(m => m.pbrMetallicRoughness?.baseColorTexture);
    assert.equal(textured.length, 1, 'one baked material');
    for (const m of textured) {
      const pbr = m.pbrMetallicRoughness;
      assert.ok(m.normalTexture && pbr.metallicRoughnessTexture && m.emissiveTexture, `${m.name}: four maps`);
      for (const [tex, side] of [[pbr.baseColorTexture, craft.tex[0]], [m.normalTexture, craft.tex[0]],
        [pbr.metallicRoughnessTexture, craft.tex[1]], [m.emissiveTexture, craft.tex[1]]]) {
        const [w, h] = webpSize(imageBytes(json, bin, tex));
        assert.ok(w === side && h === side, `${m.name}: texture ${w}x${h}, expected ${side}`);
      }
    }
  });

  test(`${file}: length, radius and the anchors module agree with the mesh`, async () => {
    const { json, bin, world, a } = await load();
    for (const key of LISTS) assert.ok(Array.isArray(a[key]), `${key} list`);
    assert.ok(a.nodes && typeof a.nodes === 'object', 'nodes');
    const pts = vertices(json, bin, world);
    const zs = pts.map(p => p[2]);
    const length = Math.max(...zs) - Math.min(...zs);
    const radius = Math.max(...pts.map(p => Math.hypot(...p)));
    assert.ok(Math.abs(length - craft.length) <= craft.length * 0.15, `length ${length} vs ${craft.length}`);
    assert.ok(Math.abs(a.length - length) < 0.02, `module length ${a.length} vs ${length}`);
    assert.ok(Math.abs(a.radius - radius) < 0.02, `module radius ${a.radius} vs ${radius}`);
    // Nose along -Z: the front half of the length lies at negative z.
    const centreZ = (Math.max(...zs) + Math.min(...zs)) / 2;
    assert.ok(Math.abs(centreZ) < craft.length * 0.1, `centred along z (${centreZ})`);
  });

  test(`${file}: every anchor is a node in the GLB, where the module says`, async () => {
    const { json, world, a, byName } = await load();
    const named = [...a.nozzles, ...a.muzzles, ...a.rcs, ...a.launchers, ...a.subsystems, ...a.bays, ...a.lights];
    for (const anchor of named) {
      const i = byName(anchor.name);
      assert.ok(i >= 0, `node ${anchor.name}`);
      assert.ok(near(apply(world[i], [0, 0, 0]), anchor.pos, 0.002), `${anchor.name} at ${anchor.pos}`);
    }
    for (const [key, node] of [['cockpit', 'cam_cockpit'], ['dock', 'dock']]) {
      assert.equal(a[key] !== null, craft[key], `${key} present: ${craft[key]}`);
      if (a[key]) assert.ok(near(apply(world[byName(node)], [0, 0, 0]), a[key], 0.002), `${node} matches ${key}`);
    }
    assert.deepEqual(a.nozzles.map(n => n.name).sort(), Object.keys(craft.nozzles).sort(), 'nozzle names');
    for (const n of a.nozzles) {
      assert.ok(n.dir[2] > 0.95, `${n.name} exhausts to +Z`);
      assert.ok(n.pos[2] > 0, `${n.name} aft of centre`);
      if (craft.nozzles[n.name]) assert.ok(Math.abs(n.size - craft.nozzles[n.name]) < 0.05, `${n.name} size ${n.size}`);
      else assert.ok(n.size > 0, `${n.name} size`);
    }
    assert.equal(a.muzzles.length, craft.muzzles, 'muzzles');
    for (const m of a.muzzles) assert.ok(m.pos[2] < 0, `${m.name} ahead of centre`);
    assert.equal(a.launchers.length, craft.launchers, 'launchers');
    assert.ok(a.rcs.length >= craft.rcs[0] && a.rcs.length <= craft.rcs[1], `rcs ${a.rcs.length}`);
    for (const p of a.rcs) assert.ok(Math.abs(Math.hypot(...p.dir) - 1) < 1e-3, `${p.name} unit dir`);
    for (const l of a.lights) {
      assert.ok(l.color.length === 3 && l.color.every(c => c >= 0 && c <= 1), `${l.name} colour`);
      assert.ok(l.blink >= 0, `${l.name} blink`);
    }
    if (craft.glass) {
      const g = json.nodes.find(n => n.name === 'glass');
      assert.ok(g && g.mesh !== undefined, 'glass node');
    }
  });

  if (craft.dock) {
    test(`${file}: the dock is clear`, async () => {
      const { json, bin, world, a } = await load();
      const pts = vertices(json, bin, world);
      if (craft.name === 'drone') {
        // the attach plate underneath is the drone's lowest point
        const low = Math.min(...pts.map(p => p[1]));
        assert.ok(Math.abs(low - a.dock[1]) < 0.01, `dock ${a.dock[1]} vs lowest ${low}`);
      } else {
        // on top of the hull, with nothing higher than its locating pins within a metre
        assert.ok(a.dock[1] > 0, 'dock on the top side');
        const near = pts.filter(p => Math.hypot(p[0] - a.dock[0], p[2] - a.dock[2]) < 1.0);
        const high = Math.max(...near.map(p => p[1]));
        assert.ok(high <= a.dock[1] + 0.06, `something ${high - a.dock[1]} m above the dock`);
      }
    });
  }

  test(`${file}: animated nodes and turrets`, async () => {
    const { json, world, a, byName } = await load();
    for (const name of Object.values(a.nodes)) {
      const i = byName(name);
      assert.ok(i >= 0 && json.nodes[i].mesh !== undefined, `animated node ${name}`);
    }
    assert.deepEqual(Object.values(a.nodes).sort(), (craft.nodes ?? []).slice().sort(), 'animated nodes');
    assert.deepEqual(a.turrets.map(t => t.name), craft.turrets ?? [], 'turrets');
    for (const t of a.turrets) {
      const i = byName(t.name);
      assert.ok(i >= 0 && json.nodes[i].mesh !== undefined, `${t.name} mesh node`);
      const gun = byName(`${t.name}_gun`);
      assert.ok(gun >= 0 && json.nodes[gun].mesh !== undefined, `${t.name}_gun mesh node`);
      assert.ok((json.nodes[i].children ?? []).includes(gun), `${t.name}_gun is a child of ${t.name}`);
      assert.ok(trianglesOf(json, json.nodes[i].mesh) <= 400 && trianglesOf(json, json.nodes[gun].mesh) <= 400,
        'turret parts under 400 triangles');
      assert.ok(near(apply(world[i], [0, 0, 0]), t.pos, 0.002), `${t.name} pivot`);
      const up = normalize([0, 0, 0], apply(world[i], [0, 1, 0]).map((v, k) => v - world[i][12 + k]));
      assert.ok(near(up, t.up, 0.01), `${t.name} up`);
      assert.ok(Math.abs(Math.hypot(...t.fwd) - 1) < 1e-3 && Math.abs(dot(t.up, t.fwd)) < 1e-3, `${t.name} frame`);
      assert.ok(t.size > 0, `${t.name} size`);
    }
    if (craft.name === 'anvil') {
      const t = a.turrets[0];
      assert.ok(t.pos[1] > 0.5 && t.pos[2] > 4, 'rear turret on the dorsal tail');
      assert.ok(t.fwd[2] > 0.95, 'barrels aft at rest');
    }
  });

  test(`${file}: collision spheres wrap the hull`, async () => {
    const { json, bin, world, a } = await load();
    assert.ok(a.colliders.length >= 4, `colliders ${a.colliders.length}`);
    for (const c of a.colliders) {
      assert.ok(c.r > 0 && c.r < craft.length * 0.25, `collider radius ${c.r}`);
      assert.ok(Math.hypot(...c.pos) + c.r <= a.radius * 1.2 + 0.5, 'collider near the hull');
    }
    const pts = vertices(json, bin, world).filter((_, i) => i % 3 === 0);
    let outside = 0;
    for (const p of pts) {
      const gap = Math.min(...a.colliders.map(c => Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1], p[2] - c.pos[2]) - c.r));
      if (gap > craft.tol) outside++;
    }
    assert.ok(outside / pts.length < 0.005, `${outside} of ${pts.length} sampled vertices outside the colliders`);
  });

  if (craft.rcs[0] > 0) {
    test(`${craft.name}: RCS can push every axis and turn every way`, async () => {
      const { a } = await load();
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

test('drone: green status light, white work lights, thrusters aft', async () => {
  const a = (await import('../js/anchors/drone.js')).default;
  const green = a.lights.filter(l => l.color[1] > 0.8 && l.color[0] < 0.5 && l.color[2] < 0.6);
  const white = a.lights.filter(l => l.color.every(c => c > 0.8));
  assert.ok(green.length >= 1 && white.length >= 2, 'status and work lights');
  assert.ok(a.dock[1] < 0, 'attach plate underneath');
  assert.equal(a.nozzles.length, 4, 'four thruster pods');
});

if (process.argv[1]?.endsWith('models-craft-check.mjs')) await run();
