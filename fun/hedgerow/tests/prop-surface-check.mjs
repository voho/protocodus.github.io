// Physical prop surfaces come from real shipped collider metadata and the
// production classifier. Aggregate volumes use their principal body material;
// no new collision geometry or hit regions are introduced for small fittings.
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
const nodes = new Map();
for (const set of ['village', 'military']) {
  const bytes = readFileSync(new URL(`../assets/models/${set}.glb`, import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  for (const node of gltf.nodes) nodes.set(node.name, node);
}
const expected = new Map([
  ...['beam_charred', 'bench', 'furniture_broken', 'camo_net', 'sign_minen', 'barrel_wood'].map(name => [name, 'wood']),
  ...['bicycle', 'poster_board', 'cable_reel', 'drum_stack', 'halftrack_wreck', 'kubelwagen', 'mg42_tripod', 'motorcycle_sidecar'].map(name => [name, 'metal']),
]);
const uses = new Map();
for (const id of ['saint-clair', 'la-varenne', 'pont-tournant', 'prague']) {
  const { default: level } = await import(`../js/levels/${id}.js`);
  for (const prop of level.props) uses.set(prop.m, (uses.get(prop.m) || 0) + 1);
}
const bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
const withoutSurface = colliders => colliders.map(({ surface, ...collider }) => collider);
let hits = 0, overrideChecks = 0, placedProps = 0;
for (const [name, surface] of expected) {
  const node = nodes.get(name);
  assert.ok(node?.extras?.colliders, `${name}: a real shipped collision model exists`);
  const authored = JSON.parse(node.extras.colliders);
  assert.ok(authored.length && authored.every(collider => !collider.surface), `${name}: these catalog volumes need a default surface`);
  assert.ok(uses.get(name) > 0, `${name}: at least one actual mission prop uses the model`);
  placedProps += uses.get(name);
  const model = { colliders: authored };
  const before = worldColliders(model, 3, 2, 7, .37, 1.25, name === 'barrel_wood' ? 'metal' : 'stone');
  const after = worldColliders(model, 3, 2, 7, .37, 1.25, surfaceFor(name));
  assert.deepEqual(withoutSurface(after), withoutSurface(before), `${name}: shape, transform and kind remain unchanged`);
  for (let i = 0; i < after.length; i++) {
    // Isolate each authored volume, so an overlapping neighbour cannot hide
    // a wrong classification or a missing ray hit in a multi-part model.
    const oldWorld = createWorld(bounds), world = createWorld(bounds);
    oldWorld.add(before[i]); world.add(after[i]);
    assert.deepEqual(withoutSurface(world.colliders), withoutSurface(oldWorld.colliders), `${name}: collision flags remain unchanged`);
    const collider = after[i], top = collider.type === 'box' ? collider.y + collider.hy : collider.y + collider.h;
    const ray = [collider.x, top + 2, collider.z, 0, -1, 0, 20, SHOT];
    const oldHit = oldWorld.raycast(...ray), hit = world.raycast(...ray);
    assert.ok(oldHit && hit, `${name}[${i}]: shot hits the transformed authored volume`);
    assert.equal(hit.t, oldHit.t, `${name}[${i}]: the hit distance is unchanged`);
    assert.equal(hit.surface, surface, `${name}[${i}]: actual world hit supplies the material feedback surface`);
    hits++;
  }
  for (const explicitSurface of ['wood', 'metal', 'stone', 'fabric', 'sandbag']) {
    const explicit = { colliders: authored.map(collider => ({ ...collider, surface: explicitSurface })) };
    const placed = worldColliders(explicit, 3, 2, 7, .37, 1.25, surfaceFor(name));
    assert.ok(placed.every(collider => collider.surface === explicitSurface), `${name}: explicit ${explicitSurface} override remains authoritative`);
    overrideChecks++;
  }
}
// The oak cask's single cylinder represents its staves/head. Its thin iron
// hoops have no separate hit volumes; all other real barrel types stay metal.
const metalBarrels = [...nodes.values()].filter(node => /^barrel/.test(node.name) && node.name !== 'barrel_wood');
assert.ok(metalBarrels.length > 0, 'the negative controls include real steel barrel models');
for (const node of metalBarrels) {
  assert.equal(surfaceFor(node.name), 'metal', `${node.name}: steel barrels remain metal`);
  const colliders = worldColliders({ colliders: JSON.parse(node.extras?.colliders || '[]') }, 0, 0, 0, 0, 1, surfaceFor(node.name));
  assert.ok(colliders.length && colliders.every(collider => collider.surface === 'metal'), `${node.name}: steel barrel collider surfaces remain metal`);
}
for (const name of ['barrier', 'well', 'dugout_entrance', 'water_trough', 'grave_a', 'grave_b', 'rubble_pile', 'steps_stone']) {
  assert.equal(surfaceFor(name), 'stone', `${name}: mixed volumes and masonry are not broadly reclassified`);
}
for (const [name] of expected) {
  for (const suffix of ['_unrelated', 'wall', 'ish']) {
    const expectedSurface = name.startsWith('barrel') ? 'metal' : 'stone';
    assert.equal(surfaceFor(name + suffix), expectedSurface, `${name}${suffix}: exact names cannot capture unrelated extensions`);
  }
}
console.log(`prop-surface-check: ${expected.size} real models used by ${placedProps} mission props, ${hits} transformed collider hits, ${overrideChecks} overrides and ${metalBarrels.length} steel-barrel controls pass`);
