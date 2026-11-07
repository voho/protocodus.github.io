// Actual player trigger, traceShot, muzzle obstruction and impact dispatch.
// The tiny CPU world uses the real authored Prague meshes/colliders; only
// the animated body's eye/muzzle pose is a render adapter. No mission/nav/GPU.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createPlayer } = await import('../js/player.js');
const { createCameraRig } = await import('../js/camera.js');
const { createWorld, MOVE, SHOT, SIGHT } = await import('../js/world.js');
const { worldColliders } = await import('../js/assets.js');
const { pragueModels } = await import('../js/prague-models.js');
const { createPragueGlassFeedback } = await import('../js/prague-glass-feedback.js');
const { DEFAULT_SETTINGS } = await import('../js/config.js');

const models = pragueModels(), noop = () => {};
const services = new Proxy({}, { get: () => noop });
const atlas = new THREE.Texture();
const basic = new THREE.MeshBasicMaterial();
const vector = a => new THREE.Vector3().fromArray(a);
const stableCollider = c => Object.fromEntries(Object.entries(c).filter(([key]) => key !== 'stamp'));
function snapshot(hit) {
  return hit && { fields: { ...hit }, collider: stableCollider(hit.collider) };
}

function fixture({ name = 'prague_old_classical', eye = [-4.1, 5.5, 11], muzzle = [-3.95, 5.5, 10.5], register = true, helper = true, house = true, corner = false } = {}) {
  const bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };
  const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  const world = createWorld({ ...bounds, terrain });
  const prop = { m: models.get(name), x: 0, y: 0, z: 0, yaw: 0, scale: 1 };
  if (house) for (const c of worldColliders(prop.m, 0, 0, 0, 0, 1)) world.add(c);
  if (corner) world.add({ type: 'box', x: eye[0], y: eye[1], z: -15, hx: .4, hy: 1, hz: .1, surface: 'stone' });
  const traces = [], rawRaycast = world.raycast;
  world.raycast = (...args) => {
    const hit = rawRaycast(...args), before = snapshot(hit);
    if (hit) Object.freeze(hit);
    traces.push({ args, hit, before });
    return hit;
  };
  const calls = { audio: [], generic: [], decals: [], shards: [], damage: [], suppression: [] };
  const audio = new Proxy({ impact: (...args) => calls.audio.push(args) }, { get: (target, key) => target[key] || noop });
  const effects = new Proxy({ impact: (...args) => calls.generic.push(args), glass: (...args) => calls.shards.push(args) }, { get: (target, key) => target[key] || noop });
  // A target behind the front wall is hittable in the no-house control.
  const enemy = {
    dead: false, pos: new THREE.Vector3(eye[0], eye[1] - 1.1, 3.6),
    char: { boneWorld(name, out) { return out.set(eye[0], eye[1] + ({ head: -.07, neck: -.25, hips: -.85, shin_l: -1.4, shin_r: -1.4 }[name] || 0), 3.6); } },
    damage: (...args) => { calls.damage.push(args); return false; },
    suppress: (...args) => calls.suppression.push(args),
  };
  const G = {
    time: 0, level: { playBounds: bounds }, world, terrain,
    camera: new THREE.PerspectiveCamera(68, 1.6, .05, 100), scene: new THREE.Scene(), soldier: null, models: new Map(),
    matlib: { get: () => basic, resolve: m => m },
    hud: services, audio, effects, lights: services, debris: services, casings: services,
    decals: { impact: (...args) => calls.decals.push(args) },
    events: { emit: noop }, shared: { wet: { value: .28 } }, enemies: corner ? [] : [enemy],
    stats: { damageTaken: 0, shots: 0, hits: 0, headHits: 0, grenades: 0 },
  };
  G.rig = createCameraRig(G.camera, world);
  G.rig.cameraMotion = 0;
  const P = createPlayer(G);
  P.char.dispose();
  const root = new THREE.Group();
  // Explicit poses isolate the two shot origins without copying any of
  // the player firing/trace/dispatch implementation into this check.
  P.char = {
    root, bones: {}, weapon: null, dead: false,
    setWeapon: noop, holdLeft: noop, hideHead: noop, animate: noop, oneShot: noop, die: noop,
    update: () => root.updateMatrixWorld(true),
    headWorld: out => out.fromArray(eye),
    muzzleWorld: out => out.fromArray(muzzle),
  };
  G.scene.add(root); G.player = P;
  P.reset([eye[0], eye[2], Math.PI]);
  G.camera.position.fromArray(eye); G.rig.pitch = 0;
  const dispatch = [];
  let owner;
  if (helper) {
    owner = createPragueGlassFeedback(house && register ? [prop] : [], { map: atlas, audio, effects, random: () => .5 });
    G.pragueGlass = { impact(hit, direction) {
      const before = snapshot(hit), d = direction.clone(), result = owner.impact(hit, direction);
      dispatch.push({ hit, before, direction: d, result });
      return result;
    } };
  }
  const masksBefore = [MOVE, SHOT, SIGHT].map(mask => world.clear(eye[0], eye[1], 11, eye[0], eye[1], 3.6, mask));
  // Deterministic zero cone radius; the production weapon, ammunition,
  // trigger conditions and full P.update remain in control of the shot.
  const random = Math.random;
  try {
    Math.random = () => 0;
    G.time += 1 / 60;
    P.update(1 / 60, {
      mouseL: false, mouseR: false, held: () => false, pressed: () => false,
      fired: () => true, consumeMouse: () => [0, 0], consumeWheel: () => 0,
    }, DEFAULT_SETTINGS);
  } finally { Math.random = random; }
  assert.equal(G.stats.shots, 1, 'The actual player trigger fires once');
  for (const trace of traces) if (trace.hit) {
    assert.deepEqual(snapshot(trace.hit), trace.before, 'The original hit fields and physical collider remain intact');
  }
  const masksAfter = [MOVE, SHOT, SIGHT].map(mask => world.clear(eye[0], eye[1], 11, eye[0], eye[1], 3.6, mask));
  assert.deepEqual(masksAfter, masksBefore, 'Cosmetic feedback cannot alter movement, bullets or sight/cover');
  return { G, calls, traces, dispatch, owner, masksBefore, dispose() { owner?.dispose(); root.removeFromParent(); } };
}

{
  const f = fixture();
  assert.equal(f.dispatch.length, 1);
  assert.ok(f.dispatch[0].result);
  assert.equal(f.dispatch[0].hit, f.traces[0].hit, 'Ordinary pane uses the camera trace hit');
  assert.ok(f.dispatch[0].direction.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-12);
  assert.equal(f.calls.shards.length, 1); assert.deepEqual(f.calls.shards[0][5], { glints: false });
  assert.deepEqual(f.calls.audio.map(c => c[3]), ['glass']);
  assert.equal(f.calls.generic.length, 0); assert.equal(f.calls.decals.length, 0);
  assert.equal(f.calls.damage.length, 0, 'The enemy behind the opaque wall takes no damage');
  assert.equal(f.calls.suppression.length, 1, 'The same physical wall strike still suppresses a nearby enemy');
  assert.deepEqual(f.masksBefore, [false, false, false]);
  assert.equal(f.dispatch[0].hit.surface, 'stone');
  f.dispose();
}

{
  // Deliberately separated eye/muzzle snapshot at an interwar building
  // corner: the eye clears the -7m side while the muzzle crosses its real
  // outer window. This is a dispatch regression, not an avatar-pose claim.
  const f = fixture({ name: 'prague_interwar', eye: [-7.02, 5.6, 6.3], muzzle: [-6.1, 5.6, 5.8], corner: true });
  assert.equal(f.dispatch.length, 1); assert.ok(f.dispatch[0].result, 'The real muzzle obstruction is an authored glass pane');
  assert.equal(f.dispatch[0].hit, f.traces[1].hit, 'Muzzle obstruction replaces the farther camera target');
  assert.notEqual(f.traces[0].hit.collider, f.dispatch[0].hit.collider);
  assert.ok(f.traces[0].hit.z < -14 && f.dispatch[0].hit.z === 5);
  const ray = new THREE.Vector3(...f.traces[1].args.slice(3, 6));
  assert.ok(f.dispatch[0].direction.distanceTo(ray) < 1e-12, 'Feedback receives the actual muzzle ray, not the eye direction');
  assert.ok(Math.abs(ray.x) > .04);
  assert.deepEqual(f.calls.audio.map(c => c[3]), ['glass']);
  assert.equal(f.calls.shards.length, 1); assert.equal(f.calls.generic.length, 0); assert.equal(f.calls.decals.length, 0);
  assert.equal(f.dispatch[0].hit.surface, 'stone');
  f.dispose();
}

for (const [label, options] of [
  ['actual mullion', { eye: [-4.45, 5.5, 11], muzzle: [-4.3, 5.5, 10.5] }],
  ['blank masonry', { name: 'prague_gray', eye: [-6.5, 5.45, 11], muzzle: [-6.35, 5.45, 10.5] }],
  ['boarded window', { name: 'prague_rose', eye: [-2.6, 5.45, 11], muzzle: [-2.45, 5.45, 10.5] }],
  ['unregistered frontage', { register: false }],
  ['owner absent', { helper: false }],
]) {
  const f = fixture(options);
  assert.equal(f.dispatch[0]?.result ?? null, null, label);
  assert.equal(f.calls.shards.length, 0, label);
  assert.equal(f.calls.generic.length, 1, label);
  assert.equal(f.calls.decals.length, 1, label);
  assert.deepEqual(f.calls.audio.map(c => c[3]), ['stone'], label);
  assert.equal(f.calls.damage.length, 0, label);
  assert.equal(f.calls.suppression.length, 1, label);
  assert.deepEqual(f.masksBefore, [false, false, false], label);
  f.dispose();
}

{
  const f = fixture({ house: false });
  assert.equal(f.calls.damage.length, 1, 'The same real enemy hit volumes take damage when the wall is absent');
  assert.ok(f.calls.damage[0][0] > 0);
  assert.deepEqual(f.calls.audio.map(c => c[3]), ['flesh']);
  assert.equal(f.dispatch.length, 0); assert.equal(f.calls.shards.length, 0);
  assert.deepEqual(f.masksBefore, [true, true, true]);
  f.dispose();
}
atlas.dispose(); basic.dispose();
const geometries = new Set(), materials = new Set(), textures = new Set();
for (const m of models.values()) for (const p of m.prims) {
  geometries.add(p.geometry);
  if (p.material?.isMaterial) { materials.add(p.material); if (p.material.map) textures.add(p.material.map); }
}
for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
console.log('player-prague-glass-check: actual P.update camera/muzzle traces, real authored panes/frame/boards, one cosmetic dispatch, opaque ballistics/cover and legacy fallbacks pass');
