// Run with: node fun/hedgerow/tests/objective-order-check.mjs
// The three battery guns are a single tactical phase: every order works,
// the next phase stays locked, one charge may burn at a time, and retries
// keep the guns already destroyed. Exercise the actual mission controller.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const { createMission } = await import('../js/mission.js');
const { default: level } = await import('../js/levels/la-varenne.js');

function scenario() {
  const charges = [], emitted = [], display = {};
  const placed = new Map(level.objectives.filter((o) => o.kind === 'destroy').map((o) => [o.target, {
    x: o.x, y: 0, z: o.z, yaw: 0, model: { anchors: {} }, object: null,
  }]));
  const G = {
    player: { alive: true, health: 100, pos: { x: 0, z: 0 }, inventory: () => ({ rounds: 8 }) },
    models: new Map(), enemies: [], stats: { objectives: 0 }, rig: { yaw: 0 }, time: 0,
    scene: { add() {}, remove() {} },
    events: { on() {}, emit(name) { emitted.push(name); } },
    hud: {
      objective(text) { display.objective = text; }, notice() {}, prompt(text) { display.prompt = text; },
      objectiveMarker(angle, distance) { display.marker = [angle, distance]; },
    },
    audio: { ui() {} }, effects: { addFire() {}, explosion() {} }, lights: { addStatic() {} },
    explosives: { placeCharge(pos, fuse, detonate) { const charge = { pos, fuse, detonate }; charges.push(charge); return charge; } },
  };
  const M = createMission(G, { ...level, pickups: [], hints: [] }, { placed });
  M.start();
  const move = (x, z, use = false) => {
    G.player.pos.x = x; G.player.pos.z = z; G.time += 1 / 60;
    M.update(1 / 60, { pressed: (key) => use && key === 'KeyF' });
  };
  const at = (id, use = false) => { const o = level.objectives.find((item) => item.id === id); move(o.x, o.z, use); };
  return { G, M, charges, emitted, display, move, at };
}

const orders = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
for (const order of orders) {
  const { G, M, charges, emitted, display, move, at } = scenario();
  // Demolition is not available before the approach objective is complete.
  at('gun3', true);
  assert.equal(charges.length, 0, 'entering the battery cannot skip the approach phase');
  assert.equal(M.isComplete('hedge'), true);
  assert.ok([1, 2, 3].every((i) => M.isActive(`gun${i}`)));
  assert.match(display.objective, /0\/3 destroyed/);
  at('dump', true);
  assert.equal(charges.length, 0, 'the ammunition dump stays locked until all guns are destroyed');
  // Save a checkpoint before fighting along the battery.
  move(4, 130);
  const checkpoint = M.checkpoint;
  for (let i = 0; i < order.length; i++) {
    const id = `gun${order[i]}`;
    at(id, true);
    assert.equal(charges.length, i + 1, `${order}: nearest eligible gun accepts a charge`);
    assert.equal(display.marker[1], 0, 'the compass and interaction choose the same target');
    assert.equal(charges[i].fuse, 6);
    at(`gun${order[(i + 1) % order.length]}`, true);
    assert.equal(charges.length, i + 1, 'a second demolition charge cannot bypass the active fuse');
    charges[i].detonate();
    assert.equal(M.isComplete(id), true);
    assert.equal(M.isActive(id), false);
    assert.equal(G.stats.objectives, i + 2, 'each individual gun scores one objective');
    assert.equal(M.done, false, 'destroying a gun never finishes the whole mission');
    if (i < 2) assert.equal(M.isActive('dump'), false);
    assert.deepEqual(M.restoreCheckpoint().spawn, level.checkpoints[checkpoint].spawn);
    assert.equal(M.isComplete(id), true, 'retrying a checkpoint preserves demolition progress');
  }
  assert.equal(M.isActive('dump'), true);
  at('dump', true);
  charges.at(-1).detonate();
  assert.equal(M.isActive('rally'), true);
  at('rally');
  assert.equal(M.done, true);
  assert.equal(M.index, level.objectives.length);
  assert.equal(M.completed.size, level.objectives.length);
  assert.equal(G.stats.objectives, level.objectives.length);
  assert.deepEqual(emitted, ['missionComplete']);
  at('rally');
  assert.deepEqual(emitted, ['missionComplete'], 'completion emits exactly once');
}

// A death during the six-second fuse cancels the live explosive in main.js.
// The mission must release its placement lock while preserving prior kills.
{
  const { M, G, at, charges } = scenario();
  at('gun3');
  at('gun3', true);
  charges[0].detonate();
  at('gun2', true);
  assert.ok(M.charge);
  M.restoreCheckpoint();
  assert.equal(M.charge, null, 'a cancelled fuse cannot lock future demolition interactions');
  assert.equal(M.isComplete('gun3'), true);
  assert.equal(M.isComplete('gun2'), false);
  at('gun2', true);
  assert.equal(charges.length, 3, 'the unfinished gun can be charged again after a checkpoint retry');
  charges[2].detonate();
  assert.equal(M.isComplete('gun2'), true);
  assert.equal(G.stats.objectives, 3, 'the cancelled charge never counts as a completed objective');
}

console.log('objective-order-check: all six battery orders, phase gates, fuses and checkpoint persistence pass');
