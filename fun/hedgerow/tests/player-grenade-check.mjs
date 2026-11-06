// Run with: node fun/hedgerow/tests/player-grenade-check.mjs
// The real player update with a stand-in render adapter: grenade release
// must follow simulation time, the current hand pose and checkpoint life.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createPlayer } = await import('../js/player.js');
const { createWorld } = await import('../js/world.js');
const { createCameraRig } = await import('../js/camera.js');
const { GRENADE, DEFAULT_SETTINGS } = await import('../js/config.js');

const noop = () => {};
const services = new Proxy({}, { get: () => noop });
function game() {
  const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  const world = createWorld({ ...bounds, terrain });
  const camera = new THREE.PerspectiveCamera(68, 1.6, 0.05, 1000);
  const thrown = [], clips = [];
  const G = {
    time: 0, level: { playBounds: bounds }, world, terrain, camera,
    scene: new THREE.Scene(), soldier: null, models: new Map(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: m => m },
    rig: createCameraRig(camera, world),
    hud: services, audio: services, effects: services, lights: services, debris: services,
    events: { emit: noop }, shared: { wet: { value: 1 } }, enemies: [],
    stats: { damageTaken: 0, grenades: 0, shots: 0 },
    explosives: { throwGrenade: (owner, start, velocity, cooked) => thrown.push({ owner, start: start.clone(), velocity: velocity.clone(), cooked, at: G.time }) },
  };
  const P = createPlayer(G);
  // The body is a render adapter. Tests use a fixed hand offset on its
  // current root transform, while movement, cooking and life state use
  // the unmodified player implementation.
  P.char.dispose();
  const root = new THREE.Group();
  P.char = {
    root, bones: {}, weapon: null, dead: false,
    setWeapon: noop, holdLeft: noop, hideHead: noop, animate: noop,
    oneShot: (...args) => clips.push(args), die: noop,
    update() { root.updateMatrixWorld(true); },
    headWorld: out => root.localToWorld(out.set(0, 1.6, 0)),
    boneWorld: (_name, out) => root.localToWorld(out.set(0.2, 1.35, 0.3)),
  };
  G.scene.add(root);
  G.player = P;
  P.reset([0, 0, 0]);
  const down = new Set(), edges = new Set();
  const input = {
    mouseL: false, mouseR: false,
    held: k => down.has(k), pressed: k => edges.has(k), fired: () => false,
    consumeMouse: () => [0, 0], consumeWheel: () => 0,
    press(k) { down.add(k); edges.add(k); }, release(k) { down.delete(k); },
  };
  function tick(dt = 1 / 60) {
    G.time += dt;
    P.update(dt, input, DEFAULT_SETTINGS);
    edges.clear();
  }
  function run(seconds) {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) tick();
  }
  function windUp(cook = 0) {
    input.press('KeyG'); tick();
    const pinAt = G.time;
    run(cook);
    input.release('KeyG'); tick();
    assert.equal(P.cooking, -1, 'releasing G starts the throwing clip');
    assert.equal(clips.at(-1)?.[0], 'throw');
    return G.time - pinAt;
  }
  return { G, P, thrown, input, tick, run, windUp };
}

{
  const { G, P, thrown, tick, run, windUp } = game();
  const before = P.grenades;
  const cooked = windUp(0.5);
  assert.equal(P.grenades, before - 1, 'the grenade is reserved once when the throw starts');
  run(0.1);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(thrown.length, 0, 'wall time during pause cannot release the grenade');
  assert.equal(G.stats.grenades, 0, 'an unreleased grenade is not counted as a throw');
  run(0.1833333333);
  assert.equal(thrown.length, 0, 'the full 300 ms hand lead-in remains after pause');
  tick();
  assert.equal(thrown.length, 1, 'the next simulation frame crosses the release beat');
  assert.equal(thrown[0].owner, 'player');
  assert.ok(Math.abs(thrown[0].cooked - (cooked + 0.3)) < 1e-9, 'the original cooking time and hand delay shorten the fuse');
  run(2);
  assert.equal(thrown.length, 1, 'a throw releases only once');
  assert.equal(G.stats.grenades, 1);
}
console.log('ok    pause freezes the hand beat and cooked fuse; resuming releases exactly one grenade');

{
  const { G, P, thrown, input, tick, run, windUp } = game();
  windUp();
  input.press('KeyW');
  G.rig.yaw = Math.PI / 3;
  run(0.2833333333);
  assert.equal(thrown.length, 0);
  tick();
  const hand = P.char.boneWorld('hand_r', new THREE.Vector3());
  assert.ok(thrown[0].start.distanceTo(hand) < 1e-9, 'release uses the newly posed hand after this frame\'s movement');
  assert.ok(P.pos.length() > 0.2 && thrown[0].velocity.x > 5, 'the throw follows the current aim and moving soldier');
}
console.log('ok    release uses the current hand, aim and movement on the release frame');

{
  const { G, P, thrown, run, windUp } = game();
  const checkpoint = P.inventory();
  windUp(); run(0.1);
  P.damage(1000, { x: 0, y: 0, z: 4 });
  assert.equal(P.alive, false);
  run(1);
  assert.equal(thrown.length, 0, 'death cancels a grenade still in the throwing hand');
  assert.equal(G.stats.grenades, 0);
  P.reset([10, 10, 0], checkpoint);
  run(1);
  assert.equal(thrown.length, 0, 'respawn cannot resurrect the old release');
  assert.equal(P.grenades, checkpoint.grenades, 'checkpoint inventory is restored without an extra refund');
}
{
  const { G, P, thrown, run, windUp } = game();
  const checkpoint = P.inventory();
  checkpoint.grenades = 2;
  windUp(); run(0.1);
  P.reset([5, 5, 0], checkpoint);
  run(1);
  assert.equal(thrown.length, 0, 'retrying while alive cancels the pending release');
  assert.equal(P.grenades, 2, 'an explicit saved inventory remains authoritative');
  windUp();
  P.reset([0, 0, 0]); run(1);
  assert.equal(thrown.length, 0, 'starting fresh also clears the queued release');
  assert.equal(P.grenades, GRENADE.carry, 'a fresh start restores the configured grenade carry');
  assert.equal(G.stats.grenades, 0);
}
console.log('ok    death, checkpoint retry and fresh reset cancel wind-ups and preserve inventory semantics');

{
  const { G, P, thrown, tick, run, windUp } = game();
  windUp(); tick(0.5); run(1);
  assert.equal(thrown.length, 1, 'a long frame crossing the release beat still releases once');
  assert.equal(G.stats.grenades, 1);
  const before = P.grenades;
  windUp(); run(0.3);
  assert.equal(thrown.length, 2, 'a later deliberate throw has its own release');
  assert.equal(P.grenades, before - 1);
}
console.log('ok    long frames and subsequent throws preserve single-release behavior');
console.log('player-grenade-check: simulation-clock throws, cooked fuse, hand timing, cancellation and inventory');
