// The fallen-tree alternative must be a physical, dry span resting in both banks.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const { L, world, terrain, placed } = await import('./level-world.mjs');
assert.equal(L.id, 'saint-clair');
const { PLAYER, DEFAULT_SETTINGS } = await import('../js/config.js');
const log = placed.get('logbridge'); assert.ok(log);
const cs = log.model.colliders.filter(c => c.type === 'box');
const trunk = cs.filter(c => c.h[2] > 1 && c.h[0] < .6);
assert.ok(trunk.length >= 3, 'the trunk has real authored support geometry');
const c = Math.cos(log.yaw), s = Math.sin(log.yaw);
const point = (x, z) => [log.x + (x * c + z * s) * log.scale, log.z + (-x * s + z * c) * log.scale];
for (const col of trunk) {
  const [x, z] = point(col.c[0], col.c[2]), feet = world.groundAt(x, z, 1e4, .45);
  assert.ok(L.water.contains(x, z), 'the crossing retains the real water band beneath it');
  assert.ok(feet > L.water.level + .1, 'a player on the trunk stands above water');
  for (const height of [PLAYER.crouchHeight, PLAYER.height]) {
    const p = { x, z }; world.pushOut(p, PLAYER.radius, feet, height, PLAYER.step);
    assert.ok(Math.hypot(p.x - x, p.z - z) < .001, 'the supported trunk clears a standing or crouched body');
  }
  const authoredTop = log.y + (col.c[1] + col.h[1]) * log.scale;
  assert.ok(Math.abs(feet - authoredTop) < .01, 'support comes from the original log geometry rather than a replacement path');
}
const north = trunk.reduce((a, b) => a.c[2] > b.c[2] ? a : b);
const root = cs.reduce((a, b) => a.h[0] > b.h[0] ? a : b);
const rests = (col, from, to) => {
  const bottom = log.y + (col.c[1] - col.h[1]) * log.scale;
  const top = log.y + (col.c[1] + col.h[1]) * log.scale;
  for (let u = from; u <= to + .001; u += .05) {
    const [x, z] = point(col.c[0], col.c[2] + col.h[2] * u), h = terrain.height(x, z);
    if (h >= bottom - .02 && h <= top + .02) return true;
  }
  return false;
};
assert.ok(rests(north, .5, 1), 'the slender end rests into the far bank instead of floating');
assert.ok(rests(root, -1, 1), 'the root plate remains embedded in its bank');


// Real input/controller traversal catches the root-plate join that static
// samples cannot: a normal Space jump/vault must clear it in both directions.
const THREE = await import('three');
const { createPlayer } = await import('../js/player.js');
const { createCameraRig } = await import('../js/camera.js');
const { createInput } = await import('../js/input.js');
const previousWindow = globalThis.window, previousAdd = document.addEventListener, previousRemove = document.removeEventListener;
const windowEvents = new EventTarget(), documentEvents = new EventTarget();
globalThis.window = windowEvents;
document.addEventListener = documentEvents.addEventListener.bind(documentEvents);
document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents);
const key = (type, code) => { const event = new Event(type, { cancelable: true }); event.code = code; windowEvents.dispatchEvent(event); };
const input = createInput(new EventTarget()), noop = () => {}, services = new Proxy({}, { get: () => noop });
let jumps = 0;
const camera = new THREE.PerspectiveCamera(68, 1.6, .05, 1000), basic = new THREE.MeshBasicMaterial();
const G = {
  time: 0, level: L, world, terrain, camera, scene: new THREE.Scene(), soldier: null, models: new Map(),
  matlib: { get: () => basic, resolve: m => m }, rig: createCameraRig(camera, world),
  hud: services, effects: services, lights: services, debris: services,
  audio: new Proxy({ gear: name => { if (name === 'jump') jumps++; } }, { get: (o, k) => o[k] || noop }),
  events: { emit: noop }, shared: { wet: { value: 1 }, time: { value: 0 } }, enemies: [],
  stats: { damageTaken: 0, grenades: 0, shots: 0 },
};
const P = createPlayer(G); G.player = P;
const analytic = terrain.height, cache = new Map(), { minX, minZ } = L.bounds;
const h = (i, j) => { const key = i + ',' + j; if (!cache.has(key)) cache.set(key, Math.fround(analytic(minX + i * .5, minZ + j * .5))); return cache.get(key); };
terrain.height = (x, z) => {
  const gx = (x - minX) * 2, gz = (z - minZ) * 2, i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
};
const localZ = pos => (pos.x - log.x) * s + (pos.z - log.z) * c;
const movementResults = [];
try {
  for (const dt of [1 / 30, 1 / 60]) for (const [dir, gap] of [[1, 1.45], [1, .95], [1, .45], [-1, .65]]) {
    input.enable(false); input.enable(true); jumps = 0;
    // Entry/exit and action timing derive from the authored model bounds.
    const from = dir === 1 ? log.model.min[2] - 2.2 : log.model.max[2] + 2.2;
    const to = dir === 1 ? log.model.max[2] + 1.6 : log.model.min[2] - 1.6;
    const trigger = root.c[2] + (dir === 1 ? -root.h[2] - gap : root.h[2] + gap);
    const [sx, sz] = point(root.c[0], from); P.reset([sx, sz, log.yaw + (dir === 1 ? 0 : Math.PI)]);
    key('keydown', 'KeyW'); let fired = false, release = false, crossed = false, maximumWading = 0, maximumCorrection = 0;
    for (let n = 0; n < Math.ceil(24 / dt); n++) {
      if (release) { key('keyup', 'Space'); release = false; }
      if (!fired && dir * (localZ(P.pos) - trigger) >= 0) { key('keydown', 'Space'); fired = true; release = true; }
      const previousAlong = localZ(P.pos);
      G.time += dt; G.shared.time.value = G.time; P.update(dt, input, DEFAULT_SETTINGS); input.endFrame();
      assert.ok(dir * (localZ(P.pos) - previousAlong) >= -1e-8, 'ordinary movement and every new or established vault frame progress without a backstep');
      maximumWading = Math.max(maximumWading, P.wading);
      const q = { x: P.pos.x, z: P.pos.z }; world.pushOut(q, PLAYER.radius, P.pos.y, PLAYER.height, PLAYER.step);
      const correction = Math.hypot(q.x - P.pos.x, q.z - P.pos.z);
      maximumCorrection = Math.max(maximumCorrection, correction);
      assert.ok(correction < .001, 'every jump and vault frame clears the actual standing capsule');
      if (dir * (localZ(P.pos) - to) >= 0) { crossed = true; break; }
    }
    key('keyup', 'KeyW'); key('keyup', 'Space');
    assert.ok(crossed && fired && jumps === 1, 'real W+Space crosses the model in both directions at ordinary input timings');
    assert.ok(maximumWading < .001, 'the actual player remains above water throughout the tree crossing');
    movementResults.push({ dt, dir, gap, maximumWading, maximumCorrection });
  }
} finally {
  input.enable(false); terrain.height = analytic; P.char.dispose(); basic.dispose();
  globalThis.window = previousWindow; document.addEventListener = previousAdd; document.removeEventListener = previousRemove;
}
console.log('saint-river-check: dry authored span/bank contact and real W+Space crossing at 30/60 Hz, with clear supported bodies; maximum capsule correction ' + Math.max(...movementResults.map(r => r.maximumCorrection)).toFixed(4) + 'm');
