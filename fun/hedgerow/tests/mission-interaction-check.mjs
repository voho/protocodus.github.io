// Run with: node fun/hedgerow/tests/mission-interaction-check.mjs
// Interaction objectives require uninterrupted use at visible equipment.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createMission } = await import('../js/mission.js');
const noop = () => {};

function scenario({ target = true } = {}) {
  let held = false, pressed = false, visible = true;
  const prompts = [], notices = [];
  const G = {
    models: new Map(), scene: new THREE.Scene(), time: 0, stats: { objectives: 0 },
    player: { alive: true, health: 100, pos: new THREE.Vector3(0, 0, 1), inventory: () => ({}) },
    hud: { objective: noop, objectiveMarker: noop, notice: (...n) => notices.push(n), prompt: (p) => prompts.push(p) },
    world: { clear: () => visible }, rig: { yaw: 0 }, audio: { ui: noop }, events: { on: noop, emit: noop },
  };
  const L = {
    pickups: [], hints: [], checkpoints: [{ spawn: [0, 0, 0] }],
    objectives: [
      { id: 'circuit', text: 'Disconnect the circuit', kind: 'interact', target: 'switch', x: 0, z: 0, duration: 2, action: 'disconnect the cable' },
      { id: 'rally', text: 'Rally', kind: 'reach', x: 100, z: 100, r: 2 },
    ],
  };
  const placed = new Map();
  if (target) placed.set('switch', { x: 0, y: 0, z: 0, yaw: 0, model: { anchors: { interact: [0, 1, 0.5] } } });
  const M = createMission(G, L, { placed }); M.start();
  return {
    G, M, L, prompts, notices,
    hold: (v) => { held = v; }, press: (v) => { pressed = v; }, visible: (v) => { visible = v; },
    tick(seconds) { for (let t = 0; t < seconds - 1e-6; t += 0.05) { G.time += 0.05; M.update(0.05, { held: () => held, pressed: () => pressed }); } },
  };
}

{
  const s = scenario(); s.tick(3);
  assert.equal(s.M.index, 0, 'being near the equipment is not enough');
  s.hold(true); s.tick(1); s.hold(false); s.tick(0.1);
  assert.equal(s.M.interaction, null, 'release cancels partial work');
  s.hold(true); s.tick(1.1);
  assert.equal(s.M.index, 0, 'repeated taps cannot accumulate progress');
  s.tick(1);
  assert.equal(s.M.index, 1); assert.equal(s.G.stats.objectives, 1);
  s.tick(3); assert.equal(s.G.stats.objectives, 1, 'completion scores once');
  assert.equal(s.prompts.at(-1), null, 'the completed prompt clears');
}

for (const cause of ['damage', 'range', 'wall', 'death', 'checkpoint']) {
  const s = scenario(); s.hold(true); s.tick(1.8);
  if (cause === 'damage') s.G.player.health = 80;
  if (cause === 'range') s.G.player.pos.z = 10;
  if (cause === 'wall') s.visible(false);
  if (cause === 'death') s.G.player.alive = false;
  if (cause === 'checkpoint') s.M.restoreCheckpoint();
  s.tick(0.2);
  assert.equal(s.M.index, 0, `${cause} interrupts before completion`);
  assert.ok((s.M.interaction?.elapsed || 0) < 0.3, `${cause} cancels the held progress`);
  if (cause === 'damage') {
    s.tick(3); assert.equal(s.M.index, 0, 'damage requires releasing use before retry');
    assert.match(s.prompts.at(-1), /Interrupted/);
  }
  s.hold(false); s.G.player.alive = true; s.G.player.pos.z = 1; s.visible(true); s.tick(0.05);
  s.hold(true); s.tick(2.1);
  assert.equal(s.M.index, 1, `${cause}: a fresh uninterrupted attempt succeeds`);
}

{
  const s = scenario({ target: false }); s.hold(true); s.tick(4);
  assert.equal(s.M.index, 0, 'missing equipment cannot silently complete');
  assert.equal(s.prompts.at(-1), null);
}
{
  const s = scenario(); s.hold(true); s.tick(1.95);
  s.G.player.heal = (amount) => { s.G.player.health = Math.min(100, s.G.player.health + amount); };
  s.M.pickups.push({ type: 'medkit', x: 0, y: 0, z: 1, taken: false, object: new THREE.Object3D() });
  s.G.player.health = 60; s.tick(0.1);
  assert.equal(s.G.player.health, 100, 'the nearby dressing heals the hit');
  assert.equal(s.M.index, 0, 'healing in the same frame cannot conceal an interruption');
  assert.equal(s.M.interaction, null);
}
{
  const s = scenario();
  s.L.objectives[0] = { id: 'gun', kind: 'destroy', target: 'switch', x: 0, z: 0 };
  let charges = 0;
  s.G.explosives = { placeCharge: () => ({ id: ++charges }) };
  s.press(true); s.tick(0.05);
  assert.equal(charges, 1); assert.ok(s.M.charge);
  s.M.wrecked.add('previously-destroyed-gun');
  // The main loop clears pending explosives before restoring after a death.
  s.M.restoreCheckpoint();
  assert.equal(s.M.charge, null, 'a cleared fuse does not permanently lock demolition');
  s.tick(0.05);
  assert.equal(charges, 2, 'the surviving target can be charged again after retry');
  assert.ok(s.M.wrecked.has('previously-destroyed-gun'), 'completed destruction is retained');
}
console.log('mission-interaction-check: uninterrupted use, interruptions, sight/range, retry, cancelled fuses and single completion pass');
