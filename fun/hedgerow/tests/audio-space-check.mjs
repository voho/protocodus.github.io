// Run: node fun/hedgerow/tests/audio-space-check.mjs
// Real world geometry, cache invalidation, and a hard event-trace budget.
import assert from 'node:assert/strict';
import { createAcousticOcclusion, acousticProfile } from '../js/audio-space.js';
import { createWorld, SHOT } from '../js/world.js';

const world = createWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50 });
const wall = world.add({ type: 'box', x: 0, y: 1.6, z: 8, hx: 3, hy: 1.6, hz: 0.25, surface: 'stone' });
world.add({ type: 'box', x: 12, y: 1.6, z: 8, hx: 3, hy: 1.6, hz: 0.04, surface: 'wood' });
let calls = 0;
const probe = (lx, ly, lz, sx, sy, sz) => {
  calls++;
  const dx = sx - lx, dy = sy - ly, dz = sz - lz, d = Math.hypot(dx, dy, dz);
  return world.raycast(lx, ly, lz, dx / d, dy / d, dz / d, Math.max(0, d - 0.25), SHOT, { noWater: true });
};
const acoustic = createAcousticOcclusion();
acoustic.setListener(0, 1.6, 0);
acoustic.setProbe(probe);
const masonry = acoustic.sample(0, 1.6, 16, 0);
assert.equal(masonry.blocked, true, 'a real masonry wall muffles the path');
assert.equal(masonry.surface, 'masonry');
assert.equal(acoustic.sample(.1, 1.6, 16.2, .05), masonry, 'nearby repeated fire reuses its acoustic path');
assert.equal(calls, 1);
world.remove(wall);
assert.equal(acoustic.sample(0, 1.6, 16, .2).blocked, true, 'the short cache avoids repeated world traces');
assert.equal(acoustic.sample(0, 1.6, 16, .33).blocked, false, 'a changed path is resampled after 320 ms');
acoustic.setListener(12, 1.6, 0);
const wood = acoustic.sample(12, 1.6, 16, .34);
assert.equal(wood.surface, 'wood', 'listener movement invalidates the old path');
assert.ok(wood.gain > masonry.gain && wood.cutoff > masonry.cutoff, 'a plank transmits more detail than masonry');
acoustic.setListener(20, 1.6, 0);
assert.equal(acoustic.sample(12, 1.6, 16, .35).blocked, false, 'moving around a wall invalidates the same cached source before its TTL');

// Boots and a rifle above a barricade share XZ, but not an acoustic path.
world.add({ type: 'box', x: 30, y: .65, z: 8, hx: 3, hy: .65, hz: .2, surface: 'stone' });
acoustic.setProbe(probe); acoustic.setListener(30, 1.6, 0);
assert.equal(acoustic.sample(30, .1, 16, .4).blocked, true, 'the barricade blocks an enemy footstep');
assert.equal(acoustic.sample(30, 1.4, 16, .41).blocked, false, 'its standing muzzle is heard over the same barricade');
acoustic.setListener(30, .9, 0);
assert.equal(acoustic.sample(30, 1.4, 16, .42).blocked, true, 'crouching behind cover invalidates the listener height even without horizontal movement');

// A saturating automatic-fire/impact burst never becomes an unbounded ray loop.
acoustic.setProbe(probe);
calls = 0;
for (let i = 0; i < 100; i++) acoustic.sample(-45 + i * 2, 1.6, 30, 1);
assert.equal(calls, 4);
assert.equal(acoustic.status.peakQueries, 4);
assert.ok(acoustic.status.budgetSkipped >= 96);
acoustic.sample(0, 1.6, 30, 1.101);
assert.equal(calls, 5, 'audio-clock progression replenishes the budget');
for (let i = 0; i < 200; i++) acoustic.sample(i * 3, 1.6, -20, 2 + i * .11);
assert.equal(acoustic.status.entries, 128, 'long play cannot grow the acoustic cache without bound');
acoustic.setProbe(() => { throw new Error('world disposed'); });
assert.equal(acoustic.sample(0, 1.6, 20, 30).blocked, false, 'a disposed/failed optional world probe retains an audible cue');
assert.equal(acoustic.status.errors, 1);
acoustic.setProbe(null);
assert.equal(acoustic.status.entries, 0, 'changing levels clears cached blockers');
assert.equal(acoustic.sample(0, 1.6, 20, 31).gain, 1);
assert.equal(acousticProfile({ collider: 'terrain', surface: 'rock' }).surface, 'earth', 'a terrain bank removes the direct high-frequency path');
assert.equal(acousticProfile({ collider: 'terrain', surface: 'grass' }).surface, 'earth', 'a grass-covered bank still contains sound-blocking earth');
assert.ok(acousticProfile({ surface: 'foliage' }).gain > wood.gain, 'foliage is a gentle obstruction');
console.log('audio-space-check: world wall/plank paths, movement/TTL invalidation, material transmission, 4 probes/100 ms and 128-entry limits pass');
