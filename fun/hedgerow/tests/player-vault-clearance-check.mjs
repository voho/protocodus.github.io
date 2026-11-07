// Actual player/input/world regressions for intermediate vault headroom.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const THREE = await import('three');
const { createPlayer } = await import('../js/player.js');
const { createWorld } = await import('../js/world.js');
const { worldColliders } = await import('../js/assets.js');
const { createCameraRig } = await import('../js/camera.js');
const { createInput } = await import('../js/input.js');
const { PLAYER, DEFAULT_SETTINGS } = await import('../js/config.js');

const previousWindow = globalThis.window;
const previousAdd = document.addEventListener, previousRemove = document.removeEventListener;
const windowEvents = new EventTarget(), documentEvents = new EventTarget();
globalThis.window = windowEvents;
document.addEventListener = documentEvents.addEventListener.bind(documentEvents);
document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents);
const input = createInput(new EventTarget());
const key = (type, code) => {
  const event = new Event(type, { cancelable: true }); event.code = code;
  windowEvents.dispatchEvent(event);
};
const noop = () => {}, services = new Proxy({}, { get: () => noop });
const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
function makeWorld() {
  return createWorld({ ...bounds, terrain: { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity } });
}
function lowCover(roofBottom = null, alternate = false) {
  const world = makeWorld();
  world.add({ type: 'box', x: 0, y: .4, z: 1, hx: 1, hy: .4, hz: .15, surface: 'wood' });
  if (roofBottom !== null) world.add({ type: 'box', x: 0, y: roofBottom + .05, z: 1, hx: 1, hy: .05, hz: .3, surface: 'stone' });
  // The first landing itself is above this bracket. A later, lower landing
  // gives a higher intermediate arc and clears it without moving the bracket.
  if (alternate) world.add({ type: 'box', x: .32, y: 1.15, z: .85, hx: .01, hy: .05, hz: .01, surface: 'stone' });
  return world;
}
function occupancy(world, pos) {
  const q = { x: pos[0], z: pos[2] };
  const blocked = world.pushOut(q, PLAYER.radius, pos[1], PLAYER.height, PLAYER.step);
  return { blocked, correction: Math.hypot(q.x - pos[0], q.z - pos[2]) };
}
function simulate(world, fps, spawn = [0, .3, 0]) {
  const camera = new THREE.PerspectiveCamera(68, 1.6, .05, 100);
  const G = {
    time: 0, level: { playBounds: bounds }, terrain: world.terrain, world, camera,
    scene: new THREE.Scene(), soldier: null, models: new Map(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: m => m },
    audio: services, hud: services, effects: services, lights: services,
    debris: services, casings: services, events: { emit: noop },
    shared: { wet: { value: 1 } }, enemies: [], stats: { damageTaken: 0, shots: 0, grenades: 0 },
  };
  G.rig = createCameraRig(camera, world);
  const P = createPlayer(G); G.player = P;
  input.enable(false); input.enable(true); P.reset(spawn);
  const start = P.pos.toArray(), initial = occupancy(world, start), frames = [];
  assert.equal(initial.blocked, false, 'fixture starts with a clear standing body');
  key('keydown', 'KeyW'); key('keydown', 'Space');
  let began = false, firstArc = null;
  try {
    for (let frame = 0; frame < fps; frame++) {
      G.time += 1 / fps; P.update(1 / fps, input, DEFAULT_SETTINGS); input.endFrame();
      if (!frame) {
        began = !!P.vault;
        if (P.vault) firstArc = { from: P.vault.from.toArray(), to: P.vault.to.toArray(), arc: P.vault.arc };
        key('keyup', 'Space');
        const held = P.pos.toArray(), phase = P.vault?.t;
        P.update(0, input, DEFAULT_SETTINGS);
        assert.deepEqual(P.pos.toArray(), held, 'an established arc does not move during a zero-time update');
        assert.equal(P.vault?.t, phase);
      }
      const pos = P.pos.toArray(); frames.push({ pos, vault: !!P.vault, ...occupancy(world, pos) });
      if (!P.vault && frame > 0) break;
    }
  } finally {
    key('keyup', 'KeyW'); key('keyup', 'Space'); input.enable(false); P.char.dispose();
  }
  return { fps, start, began, firstArc, frames };
}
function assertClear(result) {
  assert.ok(result.frames.every(frame => !frame.blocked && frame.correction < 1e-8),
    'every emitted standing body clears actual MOVE geometry under the existing step policy');
}

let cases = 0;
try {
  for (const fps of [20, 30, 60, 120]) {
    for (const bottom of [null, 1.95, 2.6, 3.5]) {
      const result = simulate(lowCover(bottom), fps);
      assert.equal(result.began, bottom === null || bottom === 3.5,
        'clear endpoints cannot authorize an arc through an unrelated low ceiling');
      assertClear(result); cases++;
    }
    const later = simulate(lowCover(null, true), fps);
    assert.equal(later.began, true, 'an obstructed first arc must not discard a later safe landing');
    assert.ok(Math.abs(later.firstArc.to[2] - 1.9) < 1e-8 && Math.abs(later.firstArc.to[1]) < 1e-8,
      'the real controller selects the later ground landing');
    assertClear(later); cases++;
  }

  const bytes = await readFile(new URL('../assets/models/military.glb', import.meta.url));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const bunker = json.nodes.find(node => node.name === 'bunker');
  assert.ok(bunker?.extras?.colliders, 'the actual authored bunker supplies its compound concrete geometry');
  const model = { colliders: JSON.parse(bunker.extras.colliders) };
  for (const fps of [30, 60]) for (const x of [0, -.2, .2, -1.4, 1.4]) {
    const world = makeWorld();
    for (const collider of worldColliders(model, 0, 0, 0, 0, 1, 'stone')) world.add(collider);
    const result = simulate(world, fps, [x, 3.8, Math.PI]);
    assert.equal(result.began, false, 'a front bunker landing does not permit crossing the stacked embrasure and roof');
    assertClear(result); cases++;
  }

  // Put a 2 mm slab at the exact continuous head peak, between emitted
  // 20 Hz frames. Checking only the eventual animation frames misses it.
  const control = simulate(lowCover(), 20); assert.ok(control.firstArc);
  const arc = control.firstArc, dy = arc.to[1] - arc.from[1];
  const peakT = Math.acos(-dy / (Math.PI * arc.arc)) / Math.PI;
  assert.ok(peakT > 0 && peakT < 1);
  const peak = arc.from.map((v, axis) => v + (arc.to[axis] - v) * peakT);
  peak[1] += Math.sin(Math.PI * peakT) * arc.arc;
  const slabBottom = peak[1] + PLAYER.height - .00005;
  assert.ok(control.frames.every(frame => frame.pos[1] + PLAYER.height < slabBottom),
    'the thin ceiling lies above every emitted 20 Hz control body');
  const world = lowCover();
  world.add({ type: 'box', x: 0, y: slabBottom + .001, z: peak[2], hx: 1, hy: .001, hz: .5, surface: 'stone' });
  assert.equal(occupancy(world, arc.from).blocked, false);
  assert.equal(occupancy(world, arc.to).blocked, false);
  assert.equal(occupancy(world, peak).blocked, true, 'the actual continuous peak collides despite clear endpoints/frames');
  const guarded = simulate(world, 20);
  assert.ok(!guarded.began || Math.abs(guarded.firstArc.to[2] - arc.to[2]) > 1e-6,
    'the controller rejects the unsafe between-frame arc before committing to it');
  assertClear(guarded); cases++;
} finally {
  input.enable(false); globalThis.window = previousWindow;
  document.addEventListener = previousAdd; document.removeEventListener = previousRemove;
}
console.log(`player-vault-clearance-check: ${cases} actual input/world headroom, authored bunker, later landing and between-frame slab controls pass`);
