// Actual combat/world contacts forward material and incoming normal speed.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const THREE = await import('three');
const { createWorld } = await import('../js/world.js');
const { createExplosives } = await import('../js/combat.js');

function launch({ surface = 'stone', height = .6, velocity = [1, -1, 0], wall = false } = {}) {
  const world = createWorld({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 });
  world.add({ type: 'box', x: 0, y: -.2, z: 0, hx: 8, hy: .2, hz: 8, surface });
  if (wall) world.add({ type: 'box', x: 1, y: 1.5, z: 0, hx: .1, hy: 1.5, hz: 3, surface: 'wood' });
  const cues = [], events = [], raycast = world.raycast;
  let grenade, lastContact = null, hadWarning = false;
  world.raycast = (...args) => {
    const hit = raycast(...args);
    lastContact = hit ? {
      surface: hit.surface, normal: [hit.nx, hit.ny, hit.nz], totalSpeed: grenade.vel.length(),
      normalSpeed: Math.abs(grenade.vel.x * hit.nx + grenade.vel.y * hit.ny + grenade.vel.z * hit.nz),
    } : null;
    return hit;
  };
  const noop = () => {};
  const G = {
    world, terrain: { height: () => -4, surfaceAt: () => 'mud' }, models: new Map(), matlib: { resolve: value => value }, scene: new THREE.Scene(),
    effects: { explosion: noop, splash: noop },
    audio: { explosion: noop, impact: noop, grenadeBounce: (...args) => cues.push({ args, contact: lastContact }) },
    lights: { flash: noop }, events: { emit: (name, value) => events.push({ name, radius: value?.radius }) },
    camera: { position: new THREE.Vector3(100, 2, 100) }, rig: { yaw: 0, addShake: noop },
    player: { alive: true, pos: new THREE.Vector3(0, 0, 7), damage: noop }, enemies: [],
    hud: { grenadeWarning: values => { hadWarning ||= values.some(value => Number.isFinite(value.angle) && value.dist < 9); }, notice: noop },
    diff: { damage: 1 }, stats: { kills: 0 },
  };
  const explosives = createExplosives(G);
  grenade = explosives.throwGrenade('player', new THREE.Vector3(0, height, 0), new THREE.Vector3(...velocity)); grenade.fuse = 1.5;
  for (let i = 0; i < 120 && explosives.list.length; i++) explosives.update(1 / 60);
  assert.equal(explosives.list.length, 0);
  for (const cue of cues) {
    assert.equal(cue.args.length, 5);
    assert.ok(cue.args.slice(0, 3).every(Number.isFinite));
    assert.equal(cue.args[3], cue.contact.surface);
    assert.equal(cue.args[4], cue.contact.normalSpeed, 'sound receives incoming normal speed before restitution/drag');
    assert.ok(cue.args[4] > 1.5, 'the existing hard-contact threshold is unchanged');
  }
  assert.equal(events.filter(event => event.name === 'grenadeBounce').length, cues.length, 'every qualifying dry contact retains its AI event');
  assert.deepEqual(events.filter(event => event.name === 'noise'), [{ name: 'noise', radius: 90 }], 'blast hearing radius remains unchanged');
  assert.ok(hadWarning, 'the actual existing HUD danger warning stays present at7 m');
  return { cues, events, hadWarning };
}
const report = { floors: [], speedControls: {}, wall: null };
for (const surface of ['stone', 'cobble', 'wood', 'metal', 'mud', 'grass', 'forest', 'sandbag']) {
  const result = launch({ surface });
  assert.equal(result.cues.length, 1); assert.equal(result.cues[0].args[3], surface);
  assert.ok(Math.abs(result.cues[0].args[4] - 3.45) < .001);
  report.floors.push({ surface, ...result });
}
report.speedControls.fast = launch({ velocity: [1, -8, 0] });
assert.ok(report.speedControls.fast.cues[0].args[4] > 8);
report.speedControls.softContact = launch({ height: .1, velocity: [.1, -.1, 0] });
assert.equal(report.speedControls.softContact.cues.length, 0, 'slow settled contacts do not gain a new cue or AI warning');
report.wall = launch({ height: .8, velocity: [6, 0, 0], wall: true });
const first = report.wall.cues[0];
assert.equal(first.args[3], 'wood'); assert.equal(first.contact.normal[1], 0);
assert.equal(first.args[4], 6); assert.ok(first.contact.totalSpeed > first.args[4], 'oblique wall contact uses normal speed rather than total flight speed');
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa'));
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'grenade-contact-report.json'), JSON.stringify(report, null, 2));
console.log('grenade-contact-check: eight real floor materials, incoming speed/threshold, oblique wall contact, unchanged AI/noise events and HUD warnings pass');
