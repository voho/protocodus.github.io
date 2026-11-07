// Shipped tree collider metadata must produce wooden impact/acoustic hits.
// Use the production surface classifier and real placement/world code,
// without building terrain/render resources or a full mission.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const { worldColliders } = await import('../js/assets.js');
const { createWorld, SHOT } = await import('../js/world.js');
const source = readFileSync(new URL('../js/levelBuild.js', import.meta.url), 'utf8');
const start = source.indexOf('const SURFACE = '), end = source.indexOf('\n};', start);
assert.ok(start >= 0 && end > start, 'production model classifier is present');
const surfaceFor = runInNewContext(source.slice(start, end + 3) + '\nSURFACE;');
assert.ok(source.includes('const surface = SURFACE(p.m);'), 'authored props use the classifier');
assert.ok(source.includes('s.scale, SURFACE(s.m))'), 'scattered models use the same classifier');
function catalog(set) {
  const bytes = readFileSync(new URL(`../assets/models/${set}.glb`, import.meta.url));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12))).nodes;
}
const nature = catalog('nature'), village = catalog('village');
const trees = nature.filter(node => /^(beech|birch|fir|pine|oak|tree_dead|stump|log)(?:_|$)/.test(node.name));
for (const name of ['beech_big', 'birch_a', 'fir_big', 'oak_a', 'pine_a', 'tree_dead']) {
  assert.ok(trees.some(node => node.name === name), `${name}: real shipped tree exists`);
}
let physicalTrees = 0;
for (const node of trees) {
  assert.equal(surfaceFor(node.name), 'wood', `${node.name}: tree and distance variants are wooden`);
  const authored = JSON.parse(node.extras?.colliders || '[]');
  if (!authored.length) continue;
  const placed = worldColliders({ colliders: authored }, 3, 2, 7, .37, 1.25, surfaceFor(node.name));
  assert.ok(placed.every(collider => collider.surface === 'wood'), `${node.name}: placed collider receives wood`);
  const world = createWorld({ minX: -40, maxX: 40, minZ: -40, maxZ: 40,
    terrain: { height: () => 0, raycast: () => Infinity } });
  for (const collider of placed) world.add(collider);
  const collider = placed[0], height = collider.type === 'cyl' ? collider.y + collider.h / 2 : collider.y;
  const reach = collider.type === 'cyl' ? collider.r + 2 : Math.hypot(collider.hx, collider.hz) + 2;
  const hit = world.raycast(collider.x - reach, height, collider.z, 1, 0, 0, reach * 2, SHOT);
  assert.ok(hit, `${node.name}: a real ray hits the transformed authored trunk/log collider`);
  assert.equal(hit.surface, 'wood', `${node.name}: impact/acoustic consumers receive wood from the actual world hit`);
  physicalTrees++;
}
for (const name of ['house_a', 'church', 'bridge_stone']) {
  const node = village.find(node => node.name === name);
  assert.ok(node?.extras?.colliders, `${name}: real masonry collider exists`);
  const colliders = worldColliders({ colliders: JSON.parse(node.extras.colliders) }, 0, 0, 0, .4, 1, surfaceFor(name));
  assert.ok(colliders.length && colliders.every(collider => collider.surface === 'stone'), `${name}: masonry is not reclassified`);
}
for (const name of ['fireplace', 'fire_station', 'firmasonry', 'birchwell']) {
  assert.equal(surfaceFor(name), 'stone', `${name}: a partial species prefix cannot capture a non-tree name`);
}
const birch = nature.find(node => node.name === 'birch_a');
const explicit = JSON.parse(birch.extras.colliders).map(collider => ({ ...collider, surface: 'metal' }));
assert.equal(worldColliders({ colliders: explicit }, 0, 0, 0, 0, 1, surfaceFor('birch_a'))[0].surface, 'metal',
  'an explicitly authored collider surface remains authoritative');
console.log(`tree-surface-check: ${trees.length} actual catalog tree variants, ${physicalTrees} transformed world hits, masonry/prefix negatives and explicit surface override pass`);
