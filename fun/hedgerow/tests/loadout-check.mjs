// Mission equipment, real player switching/reloading, and checkpoint restore.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { missionLoadout, loadoutInventory } = await import('../js/loadout.js');
const { createPlayer } = await import('../js/player.js');
const { createWorld } = await import('../js/world.js');
const { createCameraRig } = await import('../js/camera.js');
const { DEFAULT_SETTINGS, WEAPONS } = await import('../js/config.js');
const { attachResistanceIdentity } = await import('../js/resistance-kit.js');

assert.deepEqual(missionLoadout(), ['garand', 'thompson']);
assert.deepEqual(missionLoadout(null), ['garand', 'thompson']);
assert.deepEqual(missionLoadout({ loadout: ['mp40', 'unknown', 'mp40', null, 'kar98k', 'garand'] }), ['mp40', 'kar98k']);
assert.deepEqual(missionLoadout({ loadout: [] }), ['garand', 'thompson']);
assert.ok(Object.isFrozen(missionLoadout()));
const carried = missionLoadout({ loadout: ['kar98k', 'mp40'] });
const source = { ammo: { kar98k: { mag: 99, reserve: 999 }, mp40: { mag: -2, reserve: NaN }, garand: { mag: 8, reserve: 72 } }, weapon: 'garand', grenades: 99 };
const restored = loadoutInventory(carried, source);
assert.deepEqual(restored.ammo, { kar98k: { mag: 5, reserve: 67 }, mp40: { mag: 0, reserve: 160 } });
assert.equal(restored.weapon, 'kar98k'); assert.equal(restored.grenades, 6);
assert.equal(source.ammo.kar98k.mag, 99, 'restore must not mutate the checkpoint');

const noop = () => {};
const services = new Proxy({}, { get: () => noop });
function game(loadout) {
  const bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
  const terrain = { height: () => 0, surfaceAt: () => 'cobble', raycast: () => Infinity };
  const world = createWorld({ ...bounds, terrain });
  const camera = new THREE.PerspectiveCamera(68, 1.6, .05, 300);
  const labels = [], audioCalls = [], effectCalls = [];
  const audio = new Proxy({}, { get: (_, name) => (...args) => audioCalls.push({ name, args, time: G.time }) });
  const effects = new Proxy({}, { get: (_, name) => (...args) => effectCalls.push({ name, args, time: G.time }) });
  const G = { level: { playBounds: bounds, loadout }, time: 0, world, terrain, camera,
    scene: new THREE.Scene(), soldier: null, models: new Map(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: m => m },
    rig: createCameraRig(camera, world), audio, effects, lights: services, debris: services,
    hud: new Proxy({ weapon: (name, ammo) => labels.push({ name, ...ammo }) }, { get: (o, k) => o[k] || noop }),
    events: { emit: noop }, shared: { wet: { value: 1 } }, enemies: [],
    stats: { shots: 0, hits: 0, damageTaken: 0, grenades: 0 }, explosives: services };
  const P = createPlayer(G); G.player = P; P.reset([0, 0, 0]);
  const keys = new Set(), held = new Set(); let trigger = false, wheel = 0;
  const input = { held: key => held.has(key), pressed: k => keys.has(k), fired: () => trigger,
    mouseR: false, mouseL: false, consumeMouse: () => [0, 0], consumeWheel: () => { const w = wheel; wheel = 0; return w; } };
  function tick(key = null, seconds = 1 / 60) {
    if (key) keys.add(key);
    G.time += seconds; P.update(seconds, input, DEFAULT_SETTINGS); keys.clear(); trigger = false;
  }
  function run(seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) tick(); }
  return { G, P, labels, audioCalls, effectCalls, input, tick, run,
    hold(key, on = true) { if (on) held.add(key); else held.delete(key); },
    fire() { trigger = true; tick(); }, wheel(value) { wheel = value; tick(); } };
}

for (const loadout of [['garand', 'thompson'], ['kar98k', 'mp40']]) {
  const { P, labels, tick, run, fire, wheel } = game(loadout);
  assert.equal(P.weapon, loadout[0]);
  assert.deepEqual(Object.keys(P.ammo), loadout, 'only mission equipment is supplied');
  assert.equal(labels.at(-1).name, WEAPONS[loadout[0]].name, 'spawn HUD names the carried weapon');
  fire(); assert.equal(P.ammo[loadout[0]].mag, WEAPONS[loadout[0]].mag - 1);
  tick('KeyR'); run(WEAPONS[loadout[0]].reload + .1);
  assert.equal(P.ammo[loadout[0]].mag, WEAPONS[loadout[0]].mag);
  assert.equal(P.ammo[loadout[0]].reserve, WEAPONS[loadout[0]].reserve - 1);
  tick('Digit2'); run(.6); assert.equal(P.weapon, loadout[1]);
  assert.equal(labels.at(-1).name, WEAPONS[loadout[1]].name);
  wheel(-1); run(.6); assert.equal(P.weapon, loadout[0]);
  for (let i = 0; i < 10; i++) P.addAmmo(1);
  for (const id of loadout) assert.equal(P.ammo[id].reserve, Math.floor(WEAPONS[id].reserve * 1.5));
  const saved = P.inventory(); saved.ammo[loadout[0]].mag = 2; saved.weapon = loadout[1]; saved.grenades = 1;
  P.reset([2, 3, .5], saved);
  assert.equal(P.weapon, loadout[1]); assert.equal(P.ammo[loadout[0]].mag, 2); assert.equal(P.grenades, 1);
  assert.equal(labels.at(-1).name, WEAPONS[loadout[1]].name, 'retry HUD matches restored equipment');
}

// The last round schedules an automatic reload in simulation time. Wall
// time while the game is paused must not advance it, and changing weapons,
// dying or retrying must not carry the old action into the next state.
{
  const { G, P, fire, tick, run } = game(['kar98k', 'mp40']);
  P.ammo.kar98k.mag = 1;
  fire();
  assert.equal(P.reloading, 0);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(P.reloading, 0, 'a paused last-round reload cannot start from wall time');
  run(.2);
  assert.equal(P.reloading, 0, 'the full simulation delay must elapse');
  run(.06);
  assert.ok(P.reloading > 0, 'the empty rifle reloads after 250 ms of simulation');

  P.reset([0, 0, 0]); P.ammo.kar98k.mag = 1;
  fire(); tick('Digit2'); run(.6);
  assert.equal(P.weapon, 'mp40'); assert.equal(P.reloading, 0, 'switching cancels the old empty-rifle action');

  P.reset([0, 0, 0]); P.ammo.kar98k.mag = 1;
  fire();
  const restored = P.inventory(); restored.ammo.kar98k.mag = 0;
  P.reset([1, 1, 0], restored); run(.5);
  assert.equal(P.reloading, 0, 'retry cancels a queued reload even when the restored rifle is empty');
  fire();
  assert.ok(P.reloading > 0, 'pulling an empty trigger after retry can still reload');

  P.reset([0, 0, 0]); P.ammo.kar98k.mag = 1;
  fire(); P.damage(1000); run(.5);
  assert.equal(P.alive, false); assert.equal(P.reloading, 0, 'a dead player cannot start a queued reload');
  P.reset([0, 0, 0]); P.ammo.kar98k.mag = 2;
  tick('KeyR'); assert.ok(P.reloading > 0); P.damage(1000);
  assert.equal(P.reloading, 0); assert.equal(P.reloadRun, null, 'death releases the interrupted reload props');
  assert.ok(G.stats.shots >= 4);
}

{
  const { P, G, fire, tick, run, hold, audioCalls, effectCalls } = game(['kar98k', 'mp40']);
  P.reset([0, 0, 0]); P.ammo.kar98k.mag = 1;
  fire(); hold('KeyG'); tick('KeyG'); run(.4);
  tick('KeyR'); assert.equal(P.reloading, 0, 'manual and queued reloads cannot overlap a cooked grenade');
  hold('KeyG', false); tick(); run(.6);
  assert.equal(P.reloading, 0, 'the rifle also waits for the throwing hand');
  run(.5); assert.ok(P.reloading > 0, 'the queued reload resumes after the grenade is released');
  assert.equal(G.stats.grenades, 1);
}

const char = { bones: { upperarm_l: new THREE.Bone() } };
const kit = attachResistanceIdentity(char, { get: () => new THREE.MeshBasicMaterial() }, 'czech-resistance');
assert.ok(kit && kit.group.parent === char.bones.upperarm_l);
assert.equal(kit.group.children.length, 2);
assert.ok(kit.group.children.every(mesh => !mesh.material.transparent));
assert.ok(new THREE.Box3().setFromObject(kit.group).getSize(new THREE.Vector3()).length() < .25, 'identification is sized as an armband');
kit.dispose(); kit.dispose(); assert.equal(char.bones.upperarm_l.children.length, 0);
assert.equal(attachResistanceIdentity(char, {}, null), null);
console.log('loadout-check: mission arms, ammo bounds, switching/reloading, paused and cancelled empty-magazine actions, pickup caps, checkpoint/HUD restore and resistance identification pass');
