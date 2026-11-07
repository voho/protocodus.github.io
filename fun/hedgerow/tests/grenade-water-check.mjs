// Real combat/world water contacts; no renderer or duplicated solver.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const THREE = await import('three');
const { createWorld } = await import('../js/world.js');
const { createExplosives } = await import('../js/combat.js');

function fixture(createExplosives, { wet = true, edge = Infinity, floor = -1.2 } = {}) {
  const sounds = [], visuals = [], events = [];
  const terrain = {
    height: () => floor, surfaceAt: () => 'mud', normal: () => [0, 1, 0],
    raycast: (_x, y, _z, _dx, dy, _dz, max) => {
      const t = (floor - y) / dy;
      return dy < 0 && t >= 0 && t < max ? t : Infinity;
    },
  };
  const water = wet ? { level: 0, contains: (x, z) => Math.abs(x) < edge && Math.abs(z) < 10 } : null;
  const world = createWorld({ minX: -30, maxX: 30, minZ: -20, maxZ: 20, terrain, water });
  const G = {
    models: new Map(), matlib: { resolve: value => value }, scene: new THREE.Scene(), terrain, world,
    effects: { explosion: (...args) => visuals.push({ kind: 'explosion', args }), splash: (...args) => visuals.push({ kind: 'splash', args }) },
    audio: Object.fromEntries(['explosion', 'grenadeBounce', 'impact'].map(kind => [kind, (...args) => sounds.push({ kind, args })])),
    lights: { flash() {} }, decals: { add() {} }, chunks: { burst() {} },
    events: { emit: (kind, value) => events.push({ kind, x: value?.x, z: value?.z, radius: value?.radius }) },
    camera: { position: new THREE.Vector3(100, 1.6, 100) }, rig: { yaw: 0, addShake() {} },
    player: { alive: false, pos: new THREE.Vector3(100, 0, 100) }, enemies: [],
    hud: { grenadeWarning() {}, notice() {} }, diff: { damage: 1 }, stats: { kills: 0 },
  };
  return { G, explosives: createExplosives(G), sounds, visuals, events };
}
function spawn(f, edge) {
  const grenade = f.explosives.throwGrenade('player', new THREE.Vector3(0, edge ? .1 : .6, 0), new THREE.Vector3(edge ? 20 : 1, edge ? -5 : -1, 0));
  grenade.fuse = 1.5;
  return grenade;
}
function state(grenade) {
  return { pos: grenade.pos.toArray(), vel: grenade.vel.toArray(), fuse: grenade.fuse, rest: grenade.rest, splashed: !!grenade.splashed };
}
const report = { trajectories: [], shore: null, lifecycle: null, classifications: [] };
// Real createExplosives endpoints measured on combat2db9e118 before the sound
// changes, with the same flat -1.2 m terrain. This preserves the solver's
// existing presentation-rate behavior; changing that solver is separate work.
const baseline = [
  {
    "wet": false,
    "hz": 20,
    "frames": 30,
    "position": [
      0.6474517517985845,
      -1.1114358824273791,
      0
    ],
    "bounces": 2
  },
  {
    "wet": false,
    "hz": 30,
    "frames": 45,
    "position": [
      0.6520713984923355,
      -1.1151505404836901,
      0
    ],
    "bounces": 2
  },
  {
    "wet": false,
    "hz": 60,
    "frames": 91,
    "position": [
      0.6579691651930168,
      -1.1123655413839904,
      0
    ],
    "bounces": 2
  },
  {
    "wet": false,
    "hz": 120,
    "frames": 181,
    "position": [
      0.6603011995680532,
      -1.1115337512605334,
      0
    ],
    "bounces": 2
  },
  {
    "wet": true,
    "hz": 20,
    "frames": 30,
    "position": [
      0.4050069681938974,
      -1.1101765615188322,
      0
    ],
    "bounces": 2
  },
  {
    "wet": true,
    "hz": 30,
    "frames": 45,
    "position": [
      0.4101060592365555,
      -1.1101964962775466,
      0
    ],
    "bounces": 2
  },
  {
    "wet": true,
    "hz": 60,
    "frames": 91,
    "position": [
      0.4085258607088188,
      -1.1101765615188322,
      0
    ],
    "bounces": 2
  },
  {
    "wet": true,
    "hz": 120,
    "frames": 181,
    "position": [
      0.4094055838375565,
      -1.1101765615188322,
      0
    ],
    "bounces": 2
  }
];
for (const reference of baseline) {
  const { wet, hz } = reference;
  const proposed = fixture(createExplosives, { wet });
  const grenade = spawn(proposed); let frames = 0;
  while (proposed.explosives.list.length && frames++ < hz * 3) proposed.explosives.update(1 / hz);
  assert.equal(proposed.explosives.list.length, 0);
  assert.equal(frames, reference.frames, 'water audio cannot move the fuse deadline');
  grenade.pos.toArray().forEach((value, i) => assert.ok(Math.abs(value - reference.position[i]) < 1e-9, 'pre-change grenade trajectory is retained'));
  const visual = proposed.visuals.find(v => v.kind === 'explosion');
  const sound = proposed.sounds.find(v => v.kind === 'explosion');
  assert.deepEqual(sound.args.slice(0, 4), visual.args.slice(0, 4), 'sound uses the actual blast point and scale');
  assert.equal(!!sound.args[4], wet); assert.equal(!!visual.args[4], wet);
  assert.equal(proposed.visuals.filter(v => v.kind === 'splash').length, wet ? 1 : 0);
  assert.equal(proposed.sounds.filter(s => s.kind === 'impact').length, wet ? 1 : 0);
  assert.equal(proposed.sounds.filter(s => s.kind === 'grenadeBounce').length, wet ? 0 : reference.bounces);
  assert.equal(proposed.events.filter(e => e.kind === 'grenadeBounce').length, reference.bounces, 'submerged audio suppression does not suppress gameplay bounce events');
  assert.equal(proposed.events.filter(e => e.kind === 'noise').length, 1);
  assert.equal(proposed.events.find(e => e.kind === 'noise').radius, 90, 'water does not change gameplay hearing radius');
  report.trajectories.push({ wet, hz, frames, position: grenade.pos.toArray(), bounces: reference.bounces });
}
const shore = fixture(createExplosives, { edge: 1.2 }), shoreGrenade = spawn(shore, true);
for (let i = 0; i < 120 && shore.explosives.list.length; i++) shore.explosives.update(1 / 60);
assert.ok(shoreGrenade.splashed, 'actual initial water entry happened');
assert.equal(shore.sounds.filter(s => s.kind === 'impact').length, 1);
const shoreBounces = shore.sounds.filter(s => s.kind === 'grenadeBounce');
assert.ok(shoreBounces.length > 0 && shoreBounces.every(s => Math.abs(s.args[0]) >= 1.2), 'old splash flag cannot mute later dry bank contacts');
report.shore = { sounds: shore.sounds, retainedDryContact: true };
const lifecycle = fixture(createExplosives), grenade = spawn(lifecycle);
const before = state(grenade);
for (let i = 0; i < 60; i++) lifecycle.explosives.update(0);
assert.deepEqual(state(grenade), before); assert.equal(lifecycle.sounds.length, 0);
while (!grenade.splashed) lifecycle.explosives.update(1 / 60);
assert.equal(lifecycle.sounds.filter(s => s.kind === 'impact').length, 1);
grenade.pos.set(0, .1, 0); grenade.vel.set(0, -3, 0);
for (let i = 0; i < 12; i++) lifecycle.explosives.update(1 / 60);
assert.equal(lifecycle.sounds.filter(s => s.kind === 'impact').length, 1, 'same grenade crossing again has no duplicate entry cue');
lifecycle.explosives.clear(); const cueCount = lifecycle.sounds.length;
for (let i = 0; i < 120; i++) lifecycle.explosives.update(1 / 60);
assert.equal(lifecycle.sounds.length, cueCount, 'cleared grenades retain no delayed callback');
const next = spawn(lifecycle);
while (!next.splashed) lifecycle.explosives.update(1 / 60);
assert.equal(lifecycle.sounds.filter(s => s.kind === 'impact').length, 2, 'new grenade resets its own one-entry guard');
report.lifecycle = { zeroDtFrozen: true, repeatedCrossingCues: 1, clearNoCallbacks: true, newGrenadeEntryCue: true };
for (const { floor, height, expected } of [
  { floor: -1.2, height: -.5, expected: true },
  { floor: -1.2, height: .25, expected: true },
  { floor: -1.2, height: .31, expected: false },
  { floor: .5, height: .55, expected: false },
]) {
  const f = fixture(createExplosives, { floor });
  f.explosives.placeCharge(new THREE.Vector3(0, height, 0), .001);
  f.explosives.update(1 / 60);
  const sound = f.sounds.find(v => v.kind === 'explosion'), visual = f.visuals.find(v => v.kind === 'explosion');
  assert.equal(!!sound.args[4], expected); assert.equal(!!visual.args[4], expected);
  assert.equal(sound.args[3], 1.8); assert.deepEqual(sound.args, visual.args);
  report.classifications.push({ floor, height, wet: expected });
}
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa'));
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'grenade-water-report.json'), JSON.stringify(report, null, 2));
console.log(`grenade-water-check: ${report.trajectories.length} pre-change trajectories, wet-to-dry bank contact, one entry, pause/clear/rethrow and existing blast/charge classification pass.`);
