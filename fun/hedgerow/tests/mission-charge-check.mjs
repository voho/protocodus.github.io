// Run with: node fun/hedgerow/tests/mission-charge-check.mjs
// Actual mission/input/explosives against solid geometry and shipped equipment.
// Target refs use the same world.add provenance retained by buildLevel.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createWorld, SIGHT, SHOT } = await import('../js/world.js');
const { createMission } = await import('../js/mission.js');
const { createInput } = await import('../js/input.js');
const { createEvents } = await import('../js/events.js');
const { createExplosives } = await import('../js/combat.js');

const dt = 1 / 30;
class KeyboardEvent extends Event {
  constructor(type, code) { super(type, { cancelable: true }); this.code = code; }
}
const noop = () => {};

function fixture(spec) {
  const windowEvents = new EventTarget(), documentEvents = new EventTarget();
  globalThis.window = windowEvents;
  document.addEventListener = documentEvents.addEventListener.bind(documentEvents);
  document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents);
  document.pointerLockElement = null;
  const canvas = new EventTarget(), input = createInput(canvas);
  input.enable(true);
  const terrain = {
    height: () => 0, normal: () => [0, 1, 0], surfaceAt: () => 'stone',
    raycast(ox, oy, oz, dx, dy, dz, limit) {
      if (dy >= -1e-10) return Infinity;
      const t = -oy / dy;
      return t >= 0 && t <= limit ? t : Infinity;
    },
  };
  const world = createWorld({ minX: -12, maxX: 12, minZ: -12, maxZ: 12, terrain });
  if (spec.blocker === 'wall') world.add({ type: 'box', kind: 'solid', x: 0, y: 1.5, z: spec.distance / 2, hx: 2, hy: 1.5, hz: .15, surface: 'concrete' });
  if (spec.blocker === 'floor') world.add({ type: 'box', kind: 'solid', x: 0, y: 2.9, z: 0, hx: 4, hy: .1, hz: 4, surface: 'concrete' });
  const prompts = [], notices = [], events = [];
  const player = {
    pos: new THREE.Vector3(...(spec.player || [0, spec.feet ?? 0, 0])), health: 100, alive: true,
    inventory: () => ({ ammo: {}, grenades: 0 }),
    damage(amount) { this.health = Math.max(0, this.health - amount); if (!this.health) this.alive = false; },
  };
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(player.pos).y += 1.62;
  const G = {
    world, terrain, player, camera, scene: new THREE.Scene(), models: new Map(), time: 0,
    events: createEvents(), enemies: [], rig: { yaw: 0, addShake: noop }, diff: { damage: 1 },
    stats: { objectives: 0 }, level: {},
    hud: { prompt: value => prompts.push(value), notice: (...args) => notices.push(args), objective: noop, objectiveMarker: noop, grenadeWarning: noop },
    audio: { ui: noop, explosion: noop },
    effects: { explosion: noop, addFire: noop }, lights: { flash: noop, addStatic: noop },
  };
  G.explosives = createExplosives(G);
  G.events.on('missionAction', detail => events.push({ event: 'missionAction', time: G.time, ...detail }));
  G.events.on('missionComplete', () => events.push({ event: 'missionComplete', time: G.time }));
  const objective = { id: 'equipment', kind: spec.kind, text: 'Operate test equipment', target: 'equipment', x: spec.marker?.[0] ?? 0, z: spec.marker?.[1] ?? spec.distance,
    action: 'operate', time: 1.5, ...(spec.radius !== undefined ? { r: spec.radius } : {}) };
  const target = spec.target || { x: 0, y: 0, z: spec.distance, yaw: 0, scale: 1,
    model: { anchors: { interact: [0, 1.2, 0], charge: [0, 1, 0] } }, object: null };
  target.colliders = new Set();
  for (const c of spec.ownColliders || []) target.colliders.add(world.add({ ...c }));
  const L = { objectives: [objective], pickups: [], checkpoints: [{ spawn: [0, 0, 0] }], hints: [] };
  const M = createMission(G, L, { placed: new Map([['equipment', target]]) });
  G.mission = M;
  M.start();
  const key = down => windowEvents.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', 'KeyF'));
  function tick() {
    G.time += dt;
    G.explosives.update(dt);
    M.update(dt, input);
    input.endFrame();
  }
  const aim = new THREE.Vector3(0, 1.2, spec.distance);
  const chargePoint = new THREE.Vector3(0, 1, spec.distance);
  return { G, M, input, key, tick, prompts, notices, events, target,
    geometry: {
      eye: camera.position.toArray(), feet: player.pos.toArray(), aim: aim.toArray(), chargePoint: chargePoint.toArray(),
      horizontalDistance: spec.distance, feetHeightDifference: player.pos.y,
      supportingGround: world.groundAt(player.pos.x, player.pos.z, player.pos.y, .45),
      interactionSightClear: world.clear(...camera.position.toArray(), ...aim.toArray(), SIGHT),
      chargeSightClear: world.clear(...camera.position.toArray(), ...chargePoint.toArray(), SIGHT),
      chargeShotClear: world.clear(...camera.position.toArray(), ...chargePoint.toArray(), SHOT),
      colliders: world.colliders.map(c => ({ type: c.type, kind: c.kind, x: c.x, y: c.y, z: c.z, hx: c.hx, hy: c.hy, hz: c.hz })),
    } };
}


const results = [];
for (const spec of [
  { name: 'open charge', kind: 'destroy', distance: 2, expected: true },
  { name: 'solid wall', kind: 'destroy', distance: 2, blocker: 'wall', expected: false },
  { name: 'supported upper slab', kind: 'destroy', distance: 2, blocker: 'floor', feet: 3, expected: false },
  { name: 'isolated height boundary below', kind: 'destroy', distance: 1, feet: 2.199, expected: true },
  { name: 'isolated height boundary', kind: 'destroy', distance: 1, feet: 2.2, expected: false },
  { name: 'default range below', kind: 'destroy', distance: 3.199, expected: true },
  { name: 'default range boundary', kind: 'destroy', distance: 3.2, expected: false },
  { name: 'configured short radius', kind: 'destroy', distance: 2, radius: .5, expected: false },
]) {
  const s = fixture(spec); s.tick(); const prompt = s.prompts.at(-1);
  s.key(true); s.key(false); s.tick();
  const count = s.G.explosives.list.filter(e => e.kind === 'charge').length;
  const expected = spec.expected;
  assert.equal(count, expected ? 1 : 0, spec.name);
  if (!spec.expected) assert.ok(!prompt || !prompt.includes('set a demolition'), 'ineligible equipment cannot show an arming prompt');
  if (spec.blocker === 'floor') assert.equal(s.geometry.supportingGround, 3);
  if (spec.blocker) {
    for (let i = 0; i < 190; i++) s.tick();
    assert.equal(s.M.done, false); assert.equal(s.G.stats.objectives, 0, 'no invalid charge can finish behind the obstruction');
  }
  if (spec.name === 'open charge') {
    s.G.player.pos.set(30, 0, -30);
    for (let i = 0; i < 190; i++) s.tick();
    assert.equal(s.M.done, true); assert.equal(s.G.stats.objectives, 1, 'a valid charge continues to completion after the soldier retreats');
  }
  results.push({ name: spec.name, chargeCount: count, prompt, geometry: s.geometry });
  s.G.explosives.clear(); s.input.enable(false);
}
for (const spec of [
  { name: 'outside charge range does not trace', kind: 'destroy', distance: 6, expectedQueries: 0 },
  { name: 'different floor does not trace', kind: 'destroy', distance: 2, blocker: 'floor', feet: 3, expectedQueries: 0 },
  { name: 'near equipment uses one short ray', kind: 'destroy', distance: 2, expectedQueries: 1 },
]) {
  const s = fixture(spec), raycast = s.G.world.raycast; let queries = 0;
  s.G.world.raycast = (...args) => { queries++; return raycast(...args); };
  for (let i = 0; i < 30; i++) s.tick();
  assert.equal(queries, spec.expectedQueries * 30, spec.name);
  results.push({ name: spec.name, queries, updates: 30 });
  s.G.explosives.clear(); s.input.enable(false);
}
const { parseUntexturedGLB } = await import('./rig-fixture.mjs');
const { readSet, worldColliders, worldAnchor } = await import('../js/assets.js');
const models = new Map(); readSet(await parseUntexturedGLB('military'), 'military', models);
for (const [name, marker, yaw, kind, scale = 1] of [
  ['flak38', [0, 0], 200 * Math.PI / 180, 'destroy'],
  ['pak40', [0, -3.1], 0, 'destroy'],
  ['ammo_stack', [-1, -2.6], Math.PI / 6, 'destroy'],
  ['radio_table', [0, -2.8], Math.PI, 'destroy'],
  ['radio_table', [0, -1], Math.PI, 'interact'],
  ['flak38', [0, 0], Math.PI / 5, 'destroy', 1.35],
]) {
  const model = models.get(name), target = { model, x: 0, y: 0, z: 0, yaw, scale, object: null }, ownColliders = worldColliders(model, 0, 0, 0, yaw, scale);
  let positives = 0, selfBlockedPositives = 0, unrelatedBlockerChecked = false;
  for (const radius of [1.2, 1.9, 2.7, 3.1]) for (let i = 0; i < 20; i++) {
    if (kind === 'interact' && radius >= 2.2) continue;
    const angle = i * Math.PI / 10, x = marker[0] + Math.sin(angle) * radius, z = marker[1] + Math.cos(angle) * radius;
    const spec = { kind, distance: 0, marker, target, ownColliders, player: [x, 0, z] }, s = fixture(spec);
    const feet = s.G.world.groundAt(x, z, 0, .45), point = { x, z }; s.G.world.pushOut(point, .34, feet, 1.78, .45);
    if (Math.hypot(point.x - x, point.z - z) > .02) { s.input.enable(false); continue; }
    s.G.player.pos.y = feet; s.G.camera.position.set(x, feet + 1.62, z);
    const a = model.anchors.charge ? worldAnchor(model, 'charge', 0, 0, 0, yaw, scale) : [0, 1, 0];
    const selfBlocked = !s.G.world.clear(...s.G.camera.position.toArray(), ...a.slice(0, 3), SIGHT);
    s.tick(); const prompt = s.prompts.at(-1); s.key(true); if (kind === 'destroy') s.key(false); s.tick();
    if (kind === 'interact') for (let n = 0; n < 46; n++) s.tick();
    const success = kind === 'destroy' ? !!s.M.charge : s.M.done;
    if (success) {
      positives++; if (selfBlocked) selfBlockedPositives++;
      if (kind === 'destroy') assert.ok(s.M.charge.pos.distanceTo(new THREE.Vector3(...a.slice(0, 3))) < 1e-5);
      if (!unrelatedBlockerChecked) {
        const direction = new THREE.Vector3(...a.slice(0, 3)).sub(s.G.camera.position), distance = direction.length(); direction.divideScalar(distance);
        const first = s.G.world.raycast(...s.G.camera.position.toArray(), ...direction.toArray(), distance - .05, SIGHT);
        const at = Math.min(distance * .45, (first?.t ?? distance) * .7), horizontal = Math.hypot(direction.x * at, direction.z * at);
        if (horizontal > .6) {
          const blocked = fixture(spec); blocked.G.player.pos.y = feet; blocked.G.camera.position.set(x, feet + 1.62, z);
          const wall = blocked.G.world.add({ type: 'box', x: x + direction.x * at, y: feet + 1.5, z: z + direction.z * at, hx: 2, hy: 1.5, hz: .1, yaw: Math.atan2(direction.x, direction.z), surface: 'concrete' });
          const nearest = blocked.G.world.raycast(...blocked.G.camera.position.toArray(), ...direction.toArray(), distance - .05, SIGHT);
          assert.equal(nearest?.collider, wall, 'an unrelated actual wall lies before the equipment surface');
          const body = { x, z }; blocked.G.world.pushOut(body, .34, feet, 1.78, .45);
          assert.ok(Math.hypot(body.x - x, body.z - z) < .02, 'the obstruction negative still has a valid standing body');
          blocked.tick(); blocked.key(true); if (kind === 'destroy') blocked.key(false); blocked.tick();
          if (kind === 'interact') for (let n = 0; n < 46; n++) blocked.tick();
          assert.equal(kind === 'destroy' ? !!blocked.M.charge : blocked.M.done, false, 'target self-contact cannot permit interaction through an unrelated wall');
          blocked.key(false); blocked.G.explosives.clear(); blocked.input.enable(false); unrelatedBlockerChecked = true;
        }
      }
    }
    s.key(false); s.G.explosives.clear(); s.input.enable(false);
  }
  assert.ok(positives > 0, name + ': at least one actual standing approach can use this authored equipment');
  assert.ok(unrelatedBlockerChecked, name + ': an actual unrelated-wall negative is exercised beside the target collider');
  if (name === 'flak38') assert.ok(selfBlockedPositives > 0, 'real Flak self-collision cannot make the hands-on charge inaccessible');
  results.push({ name, kind, scale, actualModel: true, authoredScale: scale === 1, positives, selfBlockedPositives, unrelatedBlockerChecked });
}
{
  const model = models.get('flak38'), target = { model, x: 0, y: 0, z: 0, yaw: 0, scale: 1, object: null };
  const spec = { kind: 'destroy', distance: 0, marker: [0, 0], target, ownColliders: worldColliders(model, 0, 0, 0, 0), player: [-2, 0, -.3339] };
  const s = fixture(spec); s.tick();
  assert.ok(s.prompts.at(-1)?.includes('set a demolition'), 'the legal target is initially reachable before the foreign obstacle is added');
  const wall = s.G.world.add({ type: 'box', x: .6, y: 1.5, z: -.3339, hx: .1, hy: 1.5, hz: 2, surface: 'concrete' });
  const a = new THREE.Vector3(...worldAnchor(model, 'charge', 0, 0, 0, 0).slice(0, 3)), direction = a.clone().sub(s.G.camera.position), distance = direction.length(); direction.divideScalar(distance);
  const first = s.G.world.raycast(...s.G.camera.position.toArray(), ...direction.toArray(), distance - .05, SIGHT);
  assert.notEqual(first?.collider, wall, 'the gun itself is the first collider before the unrelated wall');
  assert.equal(s.G.world.raycast(...s.G.camera.position.toArray(), ...direction.toArray(), distance - .05, SIGHT, { ignore: first.collider })?.collider, wall, 'the unrelated wall still obstructs the fixed charge anchor behind that self collider');
  const body = s.G.player.pos.clone(); s.G.world.pushOut(body, .34, body.y, 1.78, .45); assert.ok(body.distanceTo(s.G.player.pos) < .02, 'the actor is physically clear and supported on the ground');
  s.tick(); s.key(true); s.key(false); s.tick();
  const permitted = !!s.M.charge;
  assert.equal(permitted, false, 'self-first wall regression is explicitly classified');
  results.push({ name: 'unrelated wall behind target self collider', permitted, player: s.G.player.pos.toArray(), chargeAnchor: a.toArray() });
  s.G.explosives.clear(); s.input.enable(false);
}
{
  const model = models.get('flak38'), target = { model, x: 0, y: 0, z: 0, yaw: 0, scale: 1, object: null };
  const s = fixture({ kind: 'destroy', distance: 0, marker: [0, 0], target, ownColliders: worldColliders(model, 0, 0, 0, 0), player: [-2, 0, -.3339] });
  delete target.colliders;
  s.tick(); s.key(true); s.key(false); s.tick();
  assert.equal(!!s.M.charge, false, 'missing provenance cannot fall back to ignoring geometrically similar objects');
  results.push({ name: 'missing target collider provenance', blocked: !s.M.charge });
  s.G.explosives.clear(); s.input.enable(false);
}
// A distinct solid object may have coincident geometry. Provenance, not shape
// or material equivalence, determines which target colliders may be excluded.
for (const warm of [false, true]) for (const surface of ['concrete', 'stone']) {
  const model = models.get('flak38'), target = { model, x: 0, y: 0, z: 0, yaw: 0, scale: 1, object: null };
  const s = fixture({ kind: 'destroy', distance: 0, marker: [0, 0], target, ownColliders: worldColliders(model, 0, 0, 0, 0), player: [-2, 0, -.3339] });
  if (warm) { s.tick(); assert.ok(s.prompts.at(-1)?.includes('set a demolition')); }
  const a = new THREE.Vector3(...worldAnchor(model, 'charge', 0, 0, 0, 0).slice(0, 3)), direction = a.clone().sub(s.G.camera.position), distance = direction.length(); direction.divideScalar(distance);
  const original = s.G.world.raycast(...s.G.camera.position.toArray(), ...direction.toArray(), distance - .05, SIGHT).collider;
  assert.ok(target.colliders.has(original));
  const foreign = s.G.world.add({ ...original, surface });
  assert.notEqual(foreign, original); assert.equal(target.colliders.has(foreign), false);
  const onlyForeign = s.G.world.raycast(...s.G.camera.position.toArray(), ...direction.toArray(), distance - .05, SIGHT, { ignore: target.colliders });
  assert.equal(onlyForeign.collider, foreign, 'a coincident distinct object remains a physical obstacle');
  s.tick(); s.key(true); s.key(false); s.tick();
  assert.equal(!!s.M.charge, false, 'coincident foreign geometry cannot be mistaken for the target');
  results.push({ name: 'coincident foreign target geometry', warm, blocked: !s.M.charge, ownSurface: original.surface, foreignSurface: foreign.surface });
  s.G.explosives.clear(); s.input.enable(false);
}
console.log('ok    actual F charges respect range/floor/solid access, preserve six-second fuse and equipment self-contact, and never ignore foreign geometry');
