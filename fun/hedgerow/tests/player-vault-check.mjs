// A requested vault must immediately follow its arc, without an ordinary
// walking step followed by a backwards correction on the next update.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createPlayer } = await import(process.env.HEDGEROW_PLAYER_MODULE || new URL('../js/player.js', import.meta.url));
const { createWorld } = await import('../js/world.js');
const { createCameraRig } = await import('../js/camera.js');
const { PLAYER, DEFAULT_SETTINGS } = await import('../js/config.js');

function fixture({ obstacle = true, crouch = false } = {}) {
  const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  const world = createWorld({ ...bounds, terrain });
  if (obstacle) world.add({ type: 'box', x: 0, y: .4, z: 1, hx: 1, hy: .4, hz: .15, surface: 'wood' });
  const noop = () => {}, service = new Proxy({}, { get: () => noop });
  const G = {
    time: 0, level: { playBounds: bounds }, terrain, world,
    camera: new THREE.PerspectiveCamera(68, 1.6, .05, 100), scene: new THREE.Scene(),
    soldier: null, models: new Map(), matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: m => m },
    audio: service, hud: service, effects: service, lights: service, debris: service, casings: service,
    events: { emit: noop }, shared: { wet: { value: 1 } }, enemies: [],
    stats: { damageTaken: 0, shots: 0, grenades: 0 },
  };
  G.rig = createCameraRig(G.camera, world);
  const player = createPlayer(G); G.player = player;
  player.reset([0, .3, 0]);
  player.vel.z = PLAYER.walk;
  player.crouch = crouch; player.crouchT = crouch ? 1 : 0;
  const down = new Set(['KeyW']), edges = new Set();
  const input = {
    mouseL: false, mouseR: false, held: key => down.has(key), pressed: key => edges.has(key),
    fired: () => false, consumeMouse: () => [0, 0], consumeWheel: () => 0,
    space() { down.add('Space'); edges.add('Space'); },
  };
  function tick(dt) { G.time += dt; player.update(dt, input, DEFAULT_SETTINGS); edges.clear(); }
  return { G, player, input, tick, clear: () => player.char.dispose() };
}

const outcomes = [];
for (const fps of [20, 30, 60, 120]) for (const crouch of [false, true]) {
  const f = fixture({ crouch }), dt = 1 / fps, P = f.player;
  const start = P.pos.clone();
  f.input.space(); f.tick(dt);
  assert.ok(P.vault, 'the real obstacle requests a vault');
  assert.ok(P.vault.t > 0, 'the request frame advances the vault instead of ordinary walking');
  assert.ok(P.pos.y > start.y && P.pos.z > start.z, 'the first emitted frame rises and moves forward');
  const landing = P.vault.to.clone();
  const fixed = P.pos.clone(), age = P.vault.t;
  for (let i = 0; i < 8; i++) f.tick(0);
  assert.equal(P.vault.t, age, 'zero simulation time cannot consume the arc');
  assert.ok(P.pos.distanceTo(fixed) < 1e-10, 'zero-time updates retain the same position');
  function bodyCorrection() {
    const body = { x: P.pos.x, z: P.pos.z };
    f.G.world.pushOut(body, PLAYER.radius, P.pos.y, PLAYER.height, PLAYER.step);
    return Math.hypot(body.x - P.pos.x, body.z - P.pos.z);
  }
  let previous = P.pos.clone(), frames = 0, correction = bodyCorrection();
  while (P.vault && frames++ < fps * 2) {
    f.tick(dt);
    assert.ok(P.pos.z >= previous.z - 1e-10, 'the next frame cannot rewind to a pre-walk vault start');
    correction = Math.max(correction, bodyCorrection());
    previous.copy(P.pos);
  }
  assert.equal(P.vault, null, 'the vault completes in a bounded time');
  assert.ok(P.pos.z > 1.15, 'the body centre passes the far face of the obstacle');
  assert.ok(P.pos.distanceTo(landing) < 1e-8, 'the arc reaches its selected supported landing');
  assert.equal(P.pos.y, f.G.world.groundAt(P.pos.x, P.pos.z, .85, .1, .3), 'the landing retains real footprint support');
  assert.ok(correction < 1e-8, 'the checked approach remains clear throughout its arc');
  assert.ok(f.G.time < .55 + dt + 1e-8, 'the request update is part of the vault duration');
  outcomes.push({ fps, crouch, frames, seconds: f.G.time, correction });
  f.clear();
}
for (const fps of [20, 60, 120]) {
  const f = fixture({ obstacle: false }), dt = 1 / fps, P = f.player;
  f.input.space(); f.tick(dt);
  assert.equal(P.vault, null, 'clear ground retains the ordinary jump');
  assert.equal(P.grounded, false);
  let apex = P.pos.y, frames = 0;
  while (!P.grounded && frames++ < fps * 3) { f.tick(dt); apex = Math.max(apex, P.pos.y); }
  assert.ok(apex > .3 && apex < 2, 'the existing gravity-driven jump remains bounded');
  assert.equal(P.grounded, true); assert.ok(Math.abs(P.pos.y) < 1e-8);
  f.clear();
}
console.log(JSON.stringify(outcomes));
console.log('player-vault-check: real world/player vaults are immediate, monotonic, clear and bounded at20–120Hz; zero-time and ordinary jump controls pass');
