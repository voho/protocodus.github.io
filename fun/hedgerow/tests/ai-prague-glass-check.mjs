// Actual AI consumer proof. No AI implementation is copied here.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { aiFixture, soldier, forceCombat, advance } from './ai-fixture.mjs';
const THREE = await import('three');
const { pragueModels } = await import('../js/prague-models.js');
const { worldColliders } = await import('../js/assets.js');
const { createWorld, SHOT, SIGHT, MOVE } = await import('../js/world.js');
const { createPragueGlassFeedback } = await import('../js/prague-glass-feedback.js');
const models = pragueModels(), atlas = new THREE.Texture(), results = [];
const noop = () => {};
const stable = h => h && { fields: { ...h }, collider: Object.fromEntries(Object.entries(h.collider).filter(([key]) => key !== 'stamp')) };
for (const [label, { name = 'prague_old_classical', x = -5.3, registered = true, helper = true, house = true } = {}] of [
  ['older actual shop pane'], ['interwar actual shop pane', { name: 'prague_interwar' }], ['legacy actual shop pane', { name: 'prague_ochre' }],
  ['masonry fallback', { name: 'prague_gray', x: -6.5 }], ['unregistered fallback', { registered: false }], ['owner-absent fallback', { helper: false }],
  ['clear damage control', { house: false }],
]) {
  const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  const world = createWorld({ minX: -20, maxX: 20, minZ: -20, maxZ: 20, terrain });
  const p = { m: models.get(name), x: 0, y: 0, z: 0, yaw: 0, scale: 1 };
  if (house) for (const c of worldColliders(p.m, 0, 0, 0, 0, 1)) world.add(c);
  const f = aiFixture({ world, terrain, player: [x, -8], definitions: [soldier(x, 6.3, { yaw: 180, leash: 0 })] });
  const { G, enemies, shots, hits } = f, e = enemies.list[0];
  G.diff.accuracy = 100; // A clear control must hit; a real wall must still defeat the cached sighting.
  G.enemies = enemies.list;
  const calls = { muzzle: [], glass: [], audio: [], generic: [], decals: [], suppression: [], dispatch: [] };
  G.effects = new Proxy({ muzzle: (...a) => calls.muzzle.push(a), glass: (...a) => calls.glass.push(a), impact: (...a) => calls.generic.push(a) }, { get: (t, k) => t[k] || noop });
  const audio = G.audio;
  G.audio = new Proxy({ impact: (...a) => calls.audio.push(a) }, { get: (t, k) => t[k] || audio[k] });
  G.decals = { impact: (...a) => calls.decals.push(a) };
  G.player.suppress = (...a) => calls.suppression.push(a);
  let owner;
  if (helper) {
    owner = createPragueGlassFeedback(house && registered ? [p] : [], { map: atlas, effects: G.effects, audio: G.audio });
    G.pragueGlass = { impact(h, d) {
      const before = stable(h), direction = d.clone(), result = owner.impact(h, d);
      assert.deepEqual(stable(h), before);
      calls.dispatch.push({ h, direction, result }); return result;
    } };
  }
  const rawRaycast = world.raycast, rays = [];
  world.raycast = (...args) => {
    const h = rawRaycast(...args), before = stable(h);
    if (h) Object.freeze(h);
    rays.push({ args, h, before }); return h;
  };
  const masks = [MOVE, SHOT, SIGHT].map(mask => world.clear(x, 1.3, 6, x, 1.3, -8, mask));
  forceCombat(e, G); Object.assign(e, { sees: true, exposure: 1, aimTimer: 0, perceiveTimer: 1e6, target: { x: e.pos.x, z: e.pos.z }, grenadeCheck: 100 });
  const magazine = e.mag;
  advance(G, enemies, .1, () => shots.length ? false : undefined);
  assert.equal(shots.length, 1, label); assert.equal(e.mag, magazine - 1, label);
  assert.equal(calls.muzzle.length, 1, label);
  for (const r of rays) if (r.h) assert.deepEqual(stable(r.h), r.before, 'Actual physical world hit fields/collider remain intact');
  assert.deepEqual([MOVE, SHOT, SIGHT].map(mask => world.clear(x, 1.3, 6, x, 1.3, -8, mask)), masks);
  const expectGlass = house && registered && helper && x === -5.3;
  if (expectGlass) {
    assert.equal(calls.dispatch.length, 1); assert.ok(calls.dispatch[0].result, label);
    assert.equal(calls.glass.length, 1); assert.deepEqual(calls.glass[0][5], { glints: false });
    assert.deepEqual(calls.audio.map(a => a[3]), ['glass']); assert.equal(calls.generic.length, 0); assert.equal(calls.decals.length, 0);
    const ray = rays.find(r => r.h === calls.dispatch[0].h);
    assert.ok(ray, 'The feedback consumes the actual emitted SHOT world hit'); assert.equal(ray.args[7], SHOT); assert.equal(ray.args[6], 200);
    assert.ok(vector(calls.muzzle[0].slice(0, 3)).distanceTo(vector(ray.args.slice(0, 3))) < 1e-12);
    assert.ok(calls.dispatch[0].direction.distanceTo(vector(ray.args.slice(3, 6))) < 1e-12, 'Actual emitted shot direction reaches the resolver unchanged');
    assert.equal(calls.dispatch[0].h.surface, 'stone'); assert.equal(hits.length, 0); assert.deepEqual(masks, [false, false, false]);
  } else if (house) {
    assert.equal(calls.dispatch[0]?.result ?? null, null); assert.equal(calls.glass.length, 0);
    assert.equal(calls.generic.length, 1); assert.equal(calls.decals.length, 1); assert.deepEqual(calls.audio.map(a => a[3]), ['stone']);
    assert.equal(hits.length, 0); assert.deepEqual(masks, [false, false, false]);
  } else {
    assert.equal(hits.length, 1); assert.ok(hits[0][0] > 0); assert.equal(calls.dispatch.length, 0); assert.equal(calls.glass.length, 0);
    assert.deepEqual(masks, [true, true, true]);
  }
  results.push({ label, shots: shots.length, damageCalls: hits.length, glass: calls.glass.length, generic: calls.generic.length, audio: calls.audio.map(a => a[3]), colliderSurface: calls.dispatch[0]?.h.surface || null, actualMuzzle: calls.muzzle[0].slice(0, 3), actualRay: calls.dispatch[0]?.direction.toArray() || null, physicalMasksClear: masks });
  owner?.dispose(); e.char.dispose();
}
function vector(a) { return new THREE.Vector3().fromArray(a); }
atlas.dispose();
console.log('AI glass consumer: actual emitted muzzle/SHOT hit/direction, 3 house panes, single cosmetic response, unchanged physical hits, masonry/unregistered/absent fallbacks and blocked/clear damage controls PASS');
