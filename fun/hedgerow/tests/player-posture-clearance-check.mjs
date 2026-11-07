// Standing and sprinting must respect the headroom of genuine authored overhangs.
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
const noop = () => {}, services = new Proxy({}, { get: () => noop });
const specs = [
  { family: 'military', model: 'bunker', overhead: 1, spawn: [0, 4.5, Math.PI], direction: -1, target: 3.4 },
  { family: 'nature', model: 'outcrop', overhead: 3, spawn: [3, -3.5, 0], direction: 1, target: -1.5 },
];
for (const spec of specs) {
  const bytes = await readFile(new URL(`../assets/models/${spec.family}.glb`, import.meta.url));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  spec.colliders = JSON.parse(json.nodes.find(node => node.name === spec.model).extras.colliders);
  const overhead = spec.colliders[spec.overhead], underside = overhead.c[1] - overhead.h[1];
  assert.ok(underside > PLAYER.crouchHeight && underside < PLAYER.height,
    'the actual authored overhang admits a crouching body but blocks a standing body');
}

function fixture(spec, fps, overhead = true) {
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  const world = createWorld({ ...bounds, terrain });
  const model = { colliders: spec.colliders.filter((_, index) => overhead || index !== spec.overhead) };
  for (const collider of worldColliders(model, 0, 0, 0, 0, 1, 'stone')) world.add(collider);
  const gear = [], camera = new THREE.PerspectiveCamera(68, 1.6, .05, 100);
  const audio = new Proxy({ gear: name => gear.push(name) }, { get: (target, key) => target[key] || noop });
  const G = { time: 0, level: { playBounds: bounds }, world, terrain, camera,
    scene: new THREE.Scene(), soldier: null, models: new Map(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: material => material },
    audio, hud: services, effects: services, lights: services, debris: services, casings: services,
    events: { emit: noop }, shared: { wet: { value: 1 } }, enemies: [],
    stats: { damageTaken: 0, shots: 0, grenades: 0 } };
  G.rig = createCameraRig(camera, world);
  const P = createPlayer(G); G.player = P;
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const win = new EventTarget(), doc = new EventTarget();
  globalThis.window = win; globalThis.document = doc;
  const input = createInput(new EventTarget()); input.enable(true); P.reset(spec.spawn);
  function key(code, down = true) {
    const event = new Event(down ? 'keydown' : 'keyup', { cancelable: true });
    event.code = code; win.dispatchEvent(event);
  }
  function body(height = P.crouch ? PLAYER.crouchHeight : PLAYER.height) {
    const probe = { x: P.pos.x, z: P.pos.z };
    const blocked = world.pushOut(probe, PLAYER.radius, P.pos.y, height, PLAYER.step);
    return { blocked, push: Math.hypot(probe.x - P.pos.x, probe.z - P.pos.z) };
  }
  function tick(dt = 1 / fps) {
    const before = P.pos.toArray(); G.time += dt;
    P.update(dt, input, DEFAULT_SETTINGS); input.endFrame();
    const check = body();
    assert.ok(!check.blocked && check.push < 1e-6 && !P.vault,
      'every emitted body stays clear without a vault or lateral ejection');
    return { pos: P.pos.toArray(), crouch: P.crouch, sprint: P.sprint,
      displacement: Math.hypot(P.pos.x - before[0], P.pos.z - before[2]) };
  }
  function tap(code, dt = 1 / fps) { key(code); const result = tick(dt); key(code, false); return result; }
  function enter() {
    tap('KeyC'); key('KeyW');
    for (let n = 0; n < fps * 4 && spec.direction * (P.pos.z - spec.target) < 0; n++) tick();
    key('KeyW', false); for (let n = 0; n < fps / 2; n++) tick();
    assert.ok(spec.direction * (P.pos.z - spec.target) >= 0 && P.pos.y === 0 && P.grounded && P.crouch,
      'actual crouched W from outside reaches the grounded authored overhang');
    assert.equal(body().blocked, false); assert.equal(body(PLAYER.height).blocked, overhead);
    return P.pos.toArray();
  }
  return { P, gear, key, tick, tap, body, enter,
    close() { input.enable(false); P.char.dispose(); globalThis.window = oldWindow; globalThis.document = oldDocument; } };
}

const rows = [];
for (const spec of specs) for (const fps of [30, 60, 120]) for (const action of ['stand', 'sprint']) {
  const entries = [];
  for (const overhead of [true, false]) {
    const f = fixture(spec, fps, overhead);
    try {
      entries.push(f.enter()); const beforeGear = f.gear.length;
      if (action === 'stand') f.key('KeyC'); else { f.key('KeyW'); f.key('ShiftLeft'); }
      const frames = [];
      for (let n = 0; n < fps / 2; n++) {
        frames.push(f.tick());
        if (n === 0) { f.key('KeyC', false); f.key('KeyW', false); f.key('ShiftLeft', false); }
      }
      assert.equal(frames[0].crouch, overhead, 'a blocked posture request retains crouch');
      assert.equal(frames[0].sprint, !overhead && action === 'sprint');
      assert.ok(Math.max(...frames.map(frame => frame.displacement)) < .041,
        'neither posture request ejects the player sideways');
      if (overhead) assert.equal(f.gear.length, beforeGear, 'failed standing emits no stand gear');
      else if (action === 'stand') assert.equal(f.gear.at(-1), 'stand');
      rows.push({ model: spec.model, fps, action, overhead });
    } finally { f.close(); }
  }
  assert.deepEqual(entries[0], entries[1], 'removing only the overhead preserves the actual crouched entry');
}

for (const spec of specs) for (const fps of [30, 60, 120]) {
  const f = fixture(spec, fps);
  try {
    f.enter(); const beforeGear = f.gear.length;
    f.tap('ControlLeft'); assert.ok(f.P.crouch);
    f.key('KeyW'); f.key('ShiftLeft'); f.tap('KeyC');
    assert.ok(f.P.crouch && !f.P.sprint); assert.equal(f.gear.length, beforeGear);
    f.key('KeyW', false); f.key('ShiftLeft', false);
    const blockedZero = f.P.pos.toArray(); f.tap('KeyC', 0);
    assert.ok(f.P.crouch); assert.deepEqual(f.P.pos.toArray(), blockedZero);
    assert.equal(f.gear.length, beforeGear);
    for (let n = 0; n < fps; n++) f.tick();
    f.key('KeyS'); for (let n = 0; n < fps; n++) f.tick(); f.key('KeyS', false);
    for (let n = 0; n < fps / 2; n++) f.tick();
    assert.ok(f.P.grounded && f.P.crouch && !f.body(PLAYER.height).blocked,
      'ordinary backwards movement leaves the overhang');
    f.tap('KeyC'); assert.equal(f.P.crouch, false); assert.equal(f.gear.at(-1), 'stand');
    f.tap('KeyC'); const clearZero = f.P.pos.toArray(); f.tap('KeyC', 0);
    assert.equal(f.P.crouch, false); assert.deepEqual(f.P.pos.toArray(), clearZero);
    f.P.reset(spec.spawn); assert.ok(!f.P.crouch && !f.P.sprint);
    f.tap('KeyC'); f.key('KeyW'); f.key('ShiftLeft'); f.tick();
    assert.ok(!f.P.crouch && f.P.sprint, 'reset leaves a fresh clear sprint transition');
  } finally { f.close(); }
}
console.log(JSON.stringify({ passed: true, authoredPostureCases: rows.length, lifecycleCases: 6,
  controls: 'actual crouched W entry, C/Control/Shift, overhead-only removal, exit/stand, zero-time and reset' }));
