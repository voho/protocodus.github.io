/* Meteora — the Blender exports, checked from their glTF JSON chunk alone.
   Budgets (triangles, file size), the asteroid LOD nodes and radii, the
   embedded WebP textures, and for the ships every anchor the game reads
   from js/anchors.js. Regenerate the models with tools/blender/build_all.py. */
import { test, run, assert } from './harness.mjs';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { ANCHORS } from '../js/anchors.js';
import { cross, dot, normalize, scale } from '../js/vec.js';

const MODELS = new URL('../assets/models/', import.meta.url);
export function readGlb(name) {
  const buf = readFileSync(new URL(name, MODELS));
  assert.equal(buf.readUInt32LE(0), 0x46546c67, `${name}: glTF magic`);
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, `${name}: JSON chunk`);
  return { json: JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')), size: buf.length };
}
export function trianglesOf(json, meshIndex) {
  let tris = 0;
  for (const p of json.meshes[meshIndex].primitives) {
    const acc = json.accessors[p.indices ?? p.attributes.POSITION];
    tris += acc.count / 3;
  }
  return tris;
}
function nodeByName(json, name) { return json.nodes.find(n => n.name === name); }
function radiusOf(json, meshIndex) {
  const acc = json.accessors[json.meshes[meshIndex].primitives[0].attributes.POSITION];
  return Math.max(...acc.max.map(Math.abs), ...acc.min.map(Math.abs));
}

const ROCKS = [
  { file: 'asteroid_1.glb', radius: 1.5, lod0: 300, lod1: 80, kb: 700 },
  { file: 'asteroid_2.glb', radius: 4, lod0: 600, lod1: 160, kb: 900 },
  { file: 'asteroid_3.glb', radius: 12, lod0: 1200, lod1: 300, kb: 1500 },
  { file: 'asteroid_4.glb', radius: 40, lod0: 2500, lod1: 600, kb: 1600 },
  { file: 'asteroid_5.glb', radius: 125, lod0: 4000, lod1: 1000, kb: 1800 },
];
for (const rock of ROCKS) {
  test(`${rock.file}: lods, budgets, textures, size`, () => {
    assert.ok(existsSync(new URL(rock.file, MODELS)), 'exists');
    const { json, size } = readGlb(rock.file);
    assert.ok(size <= rock.kb * 1024, `size ${size}`);
    for (const [lod, budget] of [['lod0', rock.lod0], ['lod1', rock.lod1]]) {
      const node = nodeByName(json, lod);
      assert.ok(node && node.mesh !== undefined, `${lod} node`);
      const tris = trianglesOf(json, node.mesh);
      assert.ok(tris > budget * 0.3 && tris <= budget, `${lod} tris ${tris}`);
    }
    const r = radiusOf(json, nodeByName(json, 'lod0').mesh);
    assert.ok(Math.abs(r - rock.radius) <= rock.radius * 0.1, `radius ${r}`);
    const mat = json.materials[0].pbrMetallicRoughness;
    assert.ok(mat.baseColorTexture && json.materials[0].normalTexture && mat.metallicRoughnessTexture, 'textures');
    assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'webp');
  });
}
const SHIPS = [
  { file: 'fighter.glb', key: 'fighter', tris: 12000, kb: 3500, length: [12.5, 15.5], nozzles: 2, muzzles: 2, rcs: 12 },
  { file: 'interceptor.glb', key: 'interceptor', tris: 8000, kb: 2200, length: [9.5, 12.5], nozzles: 1, muzzles: 2, rcs: 8 },
];
for (const ship of SHIPS) {
  test(`${ship.file}: budget, size, length, anchors match the GLB`, () => {
    const { json, size } = readGlb(ship.file);
    assert.ok(size <= ship.kb * 1024, `size ${size}`);
    const tris = json.meshes.reduce((t, _, i) => t + trianglesOf(json, i), 0);
    assert.ok(tris <= ship.tris && tris > ship.tris * 0.3, `tris ${tris}`);
    let minZ = Infinity, maxZ = -Infinity;
    for (const m of json.meshes) for (const p of m.primitives) {
      const a = json.accessors[p.attributes.POSITION]; minZ = Math.min(minZ, a.min[2]); maxZ = Math.max(maxZ, a.max[2]);
    }
    assert.ok(maxZ - minZ >= ship.length[0] && maxZ - minZ <= ship.length[1], `length ${maxZ - minZ}`);
    const a = ANCHORS[ship.key];
    assert.equal(a.nozzles.length, ship.nozzles); assert.equal(a.muzzles.length, ship.muzzles);
    assert.ok(a.rcs.length >= ship.rcs, 'rcs ports');
    for (const anchor of [...a.nozzles, ...a.muzzles, ...a.rcs]) {
      const node = json.nodes.find(n => n.name === anchor.name);
      assert.ok(node, `node ${anchor.name}`);
    }
    for (const n of a.nozzles) assert.ok(n.dir[2] > 0.95, 'nozzles exhaust to +Z');
    for (const m of a.muzzles) assert.ok(m.pos[2] < 0, 'muzzles ahead of centre');
  });
  test(`${ship.key}: RCS can push every axis and turn every way`, () => {
    const ports = ANCHORS[ship.key].rcs;
    const axes = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (const axis of axes) {
      const linear = ports.filter(p => dot(scale([0,0,0], p.dir, -1), axis) > 0.5).length;
      const turning = ports.filter(p => {
        const t = normalize([0,0,0], cross([0,0,0], p.pos, scale([0,0,0], p.dir, -1)));
        return dot(t, axis) > 0.3;
      }).length;
      assert.ok(linear >= 2, `linear ${axis}: ${linear}`);
      assert.ok(turning >= 2, `turning ${axis}: ${turning}`);
    }
  });
}
if (process.argv[1]?.endsWith('models-check.mjs')) await run();
