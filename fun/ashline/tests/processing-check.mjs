import assert from 'node:assert/strict';
import { createGame, updateGame, issueOrder, stopUnits } from '../sim.js';

const advance = (s, seconds) => { for (let i = 0; i < Math.round(seconds * 20); i++) updateGame(s, .05); };
const own = (s, type, team = 0) => s.entities.filter(e => e.hp > 0 && e.team === team && e.type === type);
const quiet = seed => {
  const s = createGame(seed); s.ai.nextThink = Infinity; s.terrain.fill(0); s.minerals.fill(0); s.navVersion++;
  return s;
};
const dock = (s, type = 'refinery', team = 0, cargo = 200) => {
  if (type === 'core') for (const e of own(s, 'refinery', team)) e.hp = 0;
  const depot = own(s, type, team)[0], hauler = own(s, 'harvester', team)[0];
  Object.assign(hauler, { x: depot.x + depot.size + .5, y: depot.y + depot.size / 2, cargo, harvestPhase: 'return', order: { type: 'harvest' }, unload: 0, unloadDepotId: null, path: [], repath: 0 });
  return { depot, hauler };
};

const idle = quiet('empty-processors'); advance(idle, 30);
for (const e of idle.entities.filter(e => ['core', 'refinery'].includes(e.type))) assert.equal(e.processingAmount + e.processingTotal, 0, 'Empty depots never invent mineral processing');
assert(idle.entities.filter(e => e.type === 'harvester').every(e => e.unloadDepotId === null));
assert(idle.teams.every(t => t.credits === 1800));

for (const team of [0, 1]) for (const type of ['refinery', 'core']) {
  const s = quiet(`${type}-processing-${team}`), { depot, hauler } = dock(s, type, team), credits = s.teams[team].credits;
  advance(s, .2);
  assert.equal(hauler.unloadDepotId, depot.id, 'Transfer identifies the actual friendly receiving depot');
  assert(hauler.unload > 0 && hauler.unload < 1.2); assert.equal(hauler.cargo, 200);
  assert.equal(depot.processingAmount, 0, 'Processing starts after cargo is delivered');
  assert.equal(s.teams[team].credits, credits);
  advance(s, 1.1);
  assert.equal(hauler.unloadDepotId, null); assert.equal(hauler.unload, 0); assert.equal(hauler.cargo, 0);
  assert.equal(s.teams[team].credits, credits + (type === 'core' ? 120 : 200), 'Delivery keeps the existing credit rate');
  assert.equal(depot.processingTotal, 200, 'Processing measures raw shards even at the emergency core depot');
  assert(depot.processingAmount > 195 && depot.processingAmount <= 200);
  const remaining = depot.processingAmount;
  advance(s, 3); assert(Math.abs(depot.processingAmount - (remaining - 100)) < 1e-7, 'A full load is processed over six simulation seconds');
  advance(s, 3.2); assert.equal(depot.processingAmount, 0); assert.equal(depot.processingTotal, 0);
  assert.equal(s.teams[team].credits, credits + (type === 'core' ? 120 : 200), 'Processing does not grant credits twice');
}

// One finite field is really gathered, hauled, and deposited before the processor activates.
const field = quiet('real-shard-processing'), refinery = own(field,'refinery')[0],tile = refinery.y * field.width + refinery.x+5, collector = own(field, 'harvester')[0];
field.minerals[tile] = 200; collector.x = refinery.x+5.5; collector.y = refinery.y+.5;
advance(field, 12);
assert.equal(field.minerals[tile], 0); assert.equal(collector.cargo, 0); assert(Math.abs(field.teams[0].credits - 2000) < .001, 'Finite Float32 mineral storage retains the existing delivery value');
assert(own(field, 'refinery')[0].processingAmount > 0, 'Real mined cargo starts refinery machinery');

// Concurrent transfers and later arrivals accumulate in the active batch.
const shared = quiet('concurrent-processing'), { depot, hauler } = dock(shared, 'refinery', 0, 120);
const second = { ...structuredClone(hauler), id: shared.nextId++, cargo: 80, y: hauler.y + .85 }; shared.entities.push(second);
advance(shared, 1.3);
assert.equal(depot.processingTotal, 200); assert.equal(shared.teams[0].credits, 2000);
advance(shared, 2); const remaining = depot.processingAmount;
hauler.cargo = 50; hauler.harvestPhase = 'return'; advance(shared, 1.3);
assert.equal(depot.processingTotal, 250);
assert(Math.abs(depot.processingAmount - (remaining - 1.3 * 200 / 6 + 50)) < 1e-6, 'A later delivery adds to unfinished processing');
assert.equal(shared.teams[0].credits, 2050);
const frozen = structuredClone(shared); updateGame(shared, 0); assert.deepEqual(shared, frozen, 'No simulation time means no processing');
advance(shared, 10); assert.equal(depot.processingAmount + depot.processingTotal, 0); assert.equal(shared.teams[0].credits, 2050);

// A docking indicator must not remain on relocated, stopped, exploring, or empty haulers.
for (const order of ['move', 'explore', 'stop']) {
  const s = quiet(`dock-${order}`), { depot, hauler } = dock(s); advance(s, .25);
  assert.equal(hauler.unloadDepotId, depot.id);
  if (order === 'stop') stopUnits(s, [hauler.id]); else issueOrder(s, [hauler.id], { type: order, x: 28.5, y: 40.5 });
  assert.equal(hauler.unloadDepotId, null, `${order} immediately clears the transfer indicator`);
  if (order !== 'stop') { advance(s, .1); assert.equal(hauler.unloadDepotId, null); }
}
const interrupted = quiet('lost-depot'), unloading = dock(interrupted); advance(interrupted, .2);
unloading.depot.hp = 0; advance(interrupted, .05); assert.equal(unloading.hauler.unloadDepotId, null, 'A lost refinery cannot keep its docking indicator');
const empty = quiet('empty-transfer'), emptyDock = dock(empty, 'refinery', 0, 0); advance(empty, 1.3);
assert.equal(emptyDock.hauler.unloadDepotId, null); assert.equal(emptyDock.depot.processingAmount, 0);

// Removing only the visual ledger has no effect on economics, orders, movement, or RNG.
const tracked = quiet('visual-ledger-only'); dock(tracked); const untracked = structuredClone(tracked);
for (let i = 0; i < 400; i++) {
  updateGame(tracked, .05); updateGame(untracked, .05);
  for (const e of untracked.entities) if (e.processingAmount !== undefined) e.processingAmount = e.processingTotal = 0;
}
assert.deepEqual(tracked.teams, untracked.teams); assert.deepEqual(tracked.minerals, untracked.minerals); assert.equal(tracked.rng, untracked.rng);
const gameplay = s => s.entities.map(({ processingAmount, processingTotal, ...e }) => e);
assert.deepEqual(gameplay(tracked), gameplay(untracked));
console.log('Processing checks passed: actual deliveries, both factions and depot types, finite mining, concurrent batches, empty/idle state, docking visibility, deterministic timing, and unchanged economy.');
