/* Meteora — the Harrow models (maul, sentry, seed, anchor), checked from
   their glTF JSON chunk and their generated js/anchors/<name>.js modules:
   size and triangle budgets, WebP textures, the length (or radius) the
   brief asks for, every anchor present as a node, nozzles exhausting
   toward +Z, the animated nodes, and the conventions the game relies on.
   Regenerate the models with tools/blender/build_harrow.py. */
import { test, run, assert } from './harness.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { cross, dot, normalize, scale } from '../js/vec.js';
import maul from '../js/anchors/maul.js';
import sentry from '../js/anchors/sentry.js';
import seed from '../js/anchors/seed.js';
import anchor from '../js/anchors/anchor.js';

const MODELS = new URL('../assets/models/', import.meta.url);

// As in models-check.mjs (not imported from there: that would register
// and run its cases too), plus the binary chunk for the image headers.
function readGlb(name) {
  const buf = readFileSync(new URL(name, MODELS));
  assert.equal(buf.readUInt32LE(0), 0x46546c67, `${name}: glTF magic`);
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, `${name}: JSON chunk`);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return { json, size: buf.length, bin: buf.subarray(20 + jsonLen + 8) };
}
function trianglesOf(json, meshIndex) {
  let tris = 0;
  for (const p of json.meshes[meshIndex].primitives) tris += json.accessors[p.indices ?? p.attributes.POSITION].count / 3;
  return tris;
}
const KEYS = ['radius', 'length', 'nozzles', 'muzzles', 'rcs', 'launchers', 'cockpit', 'dock', 'colliders',
  'subsystems', 'turrets', 'bays', 'lights', 'nodes'];
const KB = 1024;

// size: [how, metres] from the brief — 'nose' is the extent along glTF Z,
// 'height' along glTF Y, 'across' the larger of the X and Y extents,
// 'radius' half the largest extent. tex: [base and normal, MR and emissive].
const SPECS = [
  { name: 'maul', a: maul, tris: 10000, kb: 1300, size: ['nose', 17], nozzles: 2, muzzles: 2, rcs: 16,
    launchers: 1, nodes: {}, tex: [2048, 1024] },
  { name: 'sentry', a: sentry, tris: 3000, kb: 450, size: ['across', 8], nozzles: 0, muzzles: 0, rcs: 0,
    launchers: 0, nodes: { eye: 'eye' }, tex: [1024, 1024] },
  { name: 'seed', a: seed, tris: 6000, kb: 900, size: ['radius', 20], nozzles: 3, muzzles: 0, rcs: 0,
    launchers: 0, nodes: { rock: 'rock' }, tex: [1024, 1024] },
  { name: 'anchor', a: anchor, tris: 6000, kb: 800, size: ['height', 64], nozzles: 0, muzzles: 0, rcs: 0,
    launchers: 0, nodes: { emitter: 'emitter' }, tex: [1024, 1024] },
];

/* World-space bounds of every mesh, through the node hierarchy (a child
   node's translation is added to its accessor bounds; no node here is
   rotated or scaled). */
function meshBounds(json) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const visit = (index, offset) => {
    const node = json.nodes[index];
    if (node.mesh === undefined && !node.children?.length) return;          // an anchor empty
    assert.ok(!node.rotation && !node.scale, `${node.name}: unexpected rotation or scale`);
    const t = node.translation ?? [0, 0, 0];
    const at = offset.map((v, i) => v + t[i]);
    if (node.mesh !== undefined) {
      for (const p of json.meshes[node.mesh].primitives) {
        const acc = json.accessors[p.attributes.POSITION];
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], acc.min[i] + at[i]);
          hi[i] = Math.max(hi[i], acc.max[i] + at[i]);
        }
      }
    }
    for (const c of node.children ?? []) visit(c, at);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, [0, 0, 0]);
  return { lo, hi, span: hi.map((h, i) => h - lo[i]) };
}

function imageSize(bin, json, image) {
  const view = json.bufferViews[image.bufferView];
  const b = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF', `${image.name}: RIFF`);
  assert.equal(b.toString('ascii', 8, 12), 'WEBP', `${image.name}: WEBP`);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const bits = b.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]; }
  return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
}

/* Every vertex position in the scene (float32 VEC3 accessors, offset by
   the node translations; mesh nodes carry no rotation or scale). */
function vertices(json, bin) {
  const out = [];
  const visit = (index, offset) => {
    const node = json.nodes[index];
    const at = offset.map((v, i) => v + (node.translation ?? [0, 0, 0])[i]);
    if (node.mesh !== undefined) {
      for (const p of json.meshes[node.mesh].primitives) {
        const acc = json.accessors[p.attributes.POSITION];
        const view = json.bufferViews[acc.bufferView];
        assert.equal(acc.componentType, 5126, 'float positions');
        const stride = view.byteStride ?? 12;
        const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        for (let i = 0; i < acc.count; i++) {
          const o = base + i * stride;
          out.push([0, 1, 2].map(k => bin.readFloatLE(o + 4 * k) + at[k]));
        }
      }
    }
    for (const c of node.children ?? []) visit(c, at);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, [0, 0, 0]);
  return out;
}

/* Share of the vertices within `slack` metres of the collider compound. */
function covered(points, colliders, slack) {
  let n = 0;
  for (const p of points) {
    if (colliders.some(c => Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1], p[2] - c.pos[2]) <= c.r + slack)) n++;
  }
  return n / points.length;
}

const allAnchors = a => [...a.nozzles, ...a.muzzles, ...a.rcs, ...a.launchers, ...a.subsystems, ...a.bays,
  ...a.lights];
const near = (p, q, eps) => p.every((v, i) => Math.abs(v - q[i]) <= eps);

for (const spec of SPECS) {
  const file = `${spec.name}.glb`;
  test(`${file}: exists, size, triangles, WebP textures`, () => {
    assert.ok(existsSync(new URL(file, MODELS)), 'exists');
    const { json, size } = readGlb(file);
    assert.ok(size <= spec.kb * KB, `size ${(size / KB).toFixed(0)} KB > ${spec.kb} KB`);
    const tris = json.meshes.reduce((t, _, i) => t + trianglesOf(json, i), 0);
    assert.ok(tris <= spec.tris && tris > spec.tris * 0.3, `tris ${tris}`);
    assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'webp used');
    assert.ok(json.extensionsRequired?.includes('EXT_texture_webp'), 'webp required');
    assert.ok(!json.extensionsUsed?.includes('KHR_draco_mesh_compression'), 'no Draco');
    assert.ok(json.images.length >= 4, 'images');
    for (const img of json.images) assert.equal(img.mimeType, 'image/webp', `${img.name} mime`);
    for (const m of json.materials) {
      const pbr = m.pbrMetallicRoughness;
      assert.ok(pbr.baseColorTexture && m.normalTexture && pbr.metallicRoughnessTexture && m.emissiveTexture,
        `${m.name}: base, normal, MR and emissive maps`);
    }
  });

  test(`${file}: texture sizes and length match the brief`, () => {
    const { json, bin } = readGlb(file);
    const [big, small] = spec.tex;
    const tex = idx => {
      const t = json.textures[idx];
      return json.images[t.source ?? t.extensions?.EXT_texture_webp?.source];
    };
    for (const m of json.materials) {
      const pbr = m.pbrMetallicRoughness;
      const sizes = {
        base: imageSize(bin, json, tex(pbr.baseColorTexture.index)),
        normal: imageSize(bin, json, tex(m.normalTexture.index)),
        mr: imageSize(bin, json, tex(pbr.metallicRoughnessTexture.index)),
        emissive: imageSize(bin, json, tex(m.emissiveTexture.index)),
      };
      for (const [k, [w, h]] of Object.entries(sizes)) {
        const want = k === 'base' || k === 'normal' ? big : small;
        assert.ok(w === want && h === want, `${m.name} ${k} ${w}x${h}, want ${want}`);
      }
    }
    const { span } = meshBounds(json);
    const [axis, metres] = spec.size;
    const measured = axis === 'nose' ? span[2] : axis === 'height' ? span[1]
      : axis === 'across' ? Math.max(span[0], span[1]) : Math.max(...span) / 2;
    assert.ok(Math.abs(measured - metres) <= metres * 0.15, `${axis} ${measured.toFixed(2)} m, want ${metres} ± 15 %`);
    if (axis === 'nose') assert.ok(Math.abs(spec.a.length - span[2]) < 0.05, `anchors length ${spec.a.length}`);
    if (axis === 'height') assert.ok(Math.abs(spec.a.length - span[1]) < 0.05, `anchors length ${spec.a.length}`);
  });

  test(`${spec.name}: anchors module shape and nodes`, () => {
    const a = spec.a;
    assert.deepEqual(Object.keys(a), KEYS, 'keys in order');
    for (const k of KEYS.slice(2)) if (!['cockpit', 'dock', 'nodes'].includes(k)) assert.ok(Array.isArray(a[k]), k);
    const { json } = readGlb(`${spec.name}.glb`);
    const names = new Set(json.nodes.map(n => n.name));
    for (const anchor of allAnchors(a)) assert.ok(names.has(anchor.name), `node ${anchor.name}`);
    for (const [key, node] of Object.entries(spec.nodes)) {
      assert.equal(a.nodes[key], node, `nodes.${key}`);
      const n = json.nodes.find(x => x.name === node);
      assert.ok(n && n.mesh !== undefined, `animated mesh node ${node}`);
    }
    assert.deepEqual(Object.keys(a.nodes).sort(), Object.keys(spec.nodes).sort(), 'animated nodes');
    assert.equal(a.nozzles.length, spec.nozzles, 'nozzles');
    assert.equal(a.muzzles.length, spec.muzzles, 'muzzles');
    assert.equal(a.rcs.length, spec.rcs, 'rcs');
    assert.equal(a.launchers.length, spec.launchers, 'launchers');
    for (const n of a.nozzles) {
      assert.ok(n.dir[2] > 0.95, `${n.name} exhausts toward +Z: ${n.dir}`);
      assert.ok(n.size > 0, `${n.name} size`);
    }
    for (const c of a.colliders) assert.ok(c.r > 0 && c.pos.length === 3, 'collider');
    for (const s of a.subsystems) {
      assert.ok(s.r > 0, `${s.name} radius`);
      assert.ok(s.name === `sub_${s.kind}` || s.name.startsWith(`sub_${s.kind}_`), `${s.name} kind ${s.kind}`);
    }
    for (const l of a.lights) assert.ok(l.color.length === 3 && l.blink >= 0, `${l.name}`);
    for (const p of allAnchors(a)) {
      const d = Math.hypot(...p.pos);
      assert.ok(d <= a.radius + 0.5, `${p.name} at ${d.toFixed(2)} m, outside radius ${a.radius}`);
    }
  });
}

const COVER = { maul: [0.9, 1.0], sentry: [0.9, 0.6], seed: [0.93, 1.5], anchor: [0.9, 1.5] };
for (const spec of SPECS) {
  test(`${spec.name}: colliders hug the hull`, () => {
    const { json, bin } = readGlb(`${spec.name}.glb`);
    const [share, slack] = COVER[spec.name];
    const pts = vertices(json, bin);
    const got = covered(pts, spec.a.colliders, slack);
    assert.ok(got >= share, `${(got * 100).toFixed(1)} % of the vertices within ${slack} m of a collider`);
    const { lo, hi } = meshBounds(json);
    for (const c of spec.a.colliders) {
      assert.ok(c.pos.every((v, i) => v >= lo[i] && v <= hi[i]), `collider at ${c.pos} inside the bounds`);
      assert.ok(c.r <= Math.max(...hi.map((h, i) => h - lo[i])) / 2, `collider r ${c.r}`);
    }
    const far = Math.max(...pts.map(p => Math.hypot(...p)));
    assert.ok(Math.abs(far - spec.a.radius) < 0.02, `radius ${spec.a.radius} vs farthest vertex ${far.toFixed(2)}`);
  });
}

test('maul: guns forward, spine launcher under the keel, eye camera, RCS covers every axis', () => {
  const a = maul;
  for (const m of a.muzzles) assert.ok(m.pos[2] < -6.5, `${m.name} ahead`);
  assert.ok(a.muzzles[0].pos[0] * a.muzzles[1].pos[0] < 0, 'one gun each side');
  assert.ok(a.launchers[0].pos[1] < -1.5 && a.launchers[0].pos[2] < -4, 'launcher under and forward');
  assert.ok(a.cockpit && a.cockpit[2] < -6, 'cockpit at the eye, forward');
  assert.ok(a.dock && a.dock[1] > 1, 'dock on top');
  for (const n of a.nozzles) assert.ok(Math.abs(n.size - 0.75) < 0.01 && n.pos[2] > 8, `${n.name}`);
  assert.ok(a.colliders.length >= 8, 'colliders');
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

test('sentry: the eye node sits on sub_eye, at the front', () => {
  const { json } = readGlb('sentry.glb');
  const eye = json.nodes.find(n => n.name === 'eye');
  const sub = sentry.subsystems.find(s => s.name === 'sub_eye');
  assert.ok(sub, 'sub_eye');
  assert.ok(near(eye.translation, sub.pos, 0.01), `eye ${eye.translation} vs sub_eye ${sub.pos}`);
  assert.ok(eye.translation[2] < -0.5, 'eye forward of the centre');
  const acc = json.accessors[json.meshes[eye.mesh].primitives[0].attributes.POSITION];
  assert.ok(acc.min[2] < -1, 'lens bulges forward (local -Z) of the eye origin');
  assert.ok(Math.abs(acc.max[0] + acc.min[0]) < 0.05 && Math.abs(acc.max[1] + acc.min[1]) < 0.05, 'eye centred on its origin');
  assert.ok(sentry.colliders.length >= 1, 'colliders');
});

test('seed: one rock node, three rocket clusters on the rear face', () => {
  const { json } = readGlb('seed.glb');
  const rock = json.nodes.find(n => n.name === 'rock');
  assert.ok(rock && rock.mesh !== undefined, 'rock mesh node');
  assert.equal(json.nodes.filter(n => n.mesh !== undefined).length, 1, 'one mesh node');
  const { hi } = meshBounds(json);
  for (const n of seed.nozzles) {
    assert.ok(Math.abs(n.size - 1.6) < 0.01, `${n.name} size`);
    assert.ok(n.pos[2] > hi[2] - 1.0, `${n.name} at the rear (+Z) end`);
  }
  const spread = Math.hypot(seed.nozzles[0].pos[0] - seed.nozzles[1].pos[0], seed.nozzles[0].pos[1] - seed.nozzles[1].pos[1]);
  assert.ok(spread > 4 * 1.6, 'clusters apart');
  assert.ok(seed.colliders.length >= 5, 'colliders');
});

test('anchor: tall pylon, emitter at the top on sub_emitter, colliders along the mast', () => {
  const { json } = readGlb('anchor.glb');
  const emitter = json.nodes.find(n => n.name === 'emitter');
  const sub = anchor.subsystems.find(s => s.name === 'sub_emitter');
  assert.ok(sub, 'sub_emitter');
  assert.ok(near(emitter.translation, sub.pos, 0.01), 'emitter node on sub_emitter');
  const { hi } = meshBounds(json);
  assert.ok(emitter.translation[1] > hi[1] - 8, 'emitter at the top');
  assert.ok(Math.abs(emitter.translation[0]) < 0.01 && Math.abs(emitter.translation[2]) < 0.01, 'emitter on the mast axis');
  const mast = anchor.colliders.filter(c => Math.hypot(c.pos[0], c.pos[2]) < 0.5).map(c => c.pos[1]).sort((p, q) => p - q);
  assert.ok(mast.length >= 6, 'mast colliders');
  for (let i = 1; i < mast.length; i++) assert.ok(mast[i] - mast[i - 1] < 8, 'no gaps along the mast');
});

if (process.argv[1]?.endsWith('models-harrow-check.mjs')) await run();
