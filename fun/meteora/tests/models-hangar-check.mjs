// Run with: node tests/models-hangar-check.mjs
// The hangar bay behind the hangar screen (tools/blender/build_hangar.py):
// its two nodes, a small budget, one-sided surfaces seen from the right
// side, tiling WebP textures and lamps that glow.
import { test, run, assert } from './harness.mjs';
import { readGlb, trianglesOf } from './models-check.mjs';

test('hangar.glb: the bay and its turntable, within budget', () => {
  const { json, size } = readGlb('hangar.glb');
  const names = json.nodes.map(n => n.name);
  for (const name of ['bay', 'turntable']) assert.ok(names.includes(name), name);
  const tris = json.meshes.reduce((n, _, i) => n + trianglesOf(json, i), 0);
  assert.ok(tris < 8000, `${tris} triangles`);
  assert.ok(size < 1024 * 1024, `${Math.round(size / 1024)} KB`);
});

test('hangar.glb: one-sided, tiling WebP textures, glowing lamps', () => {
  const { json } = readGlb('hangar.glb');
  for (const m of json.materials) assert.ok(!m.doubleSided, `${m.name} is double-sided`);
  assert.ok(json.extensionsRequired?.includes('EXT_texture_webp'));
  for (const s of json.samplers ?? []) {
    assert.ok((s.wrapS ?? 10497) === 10497 && (s.wrapT ?? 10497) === 10497, 'textures repeat');
  }
  const lamps = json.materials.filter(m => m.extensions?.KHR_materials_emissive_strength);
  assert.ok(lamps.length >= 3, 'light panels, strips and guide lamps');
});
await run();
