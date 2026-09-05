import assert from 'node:assert/strict';
import {BUILDINGS, UNITS, createGame, updateGame, canPlace, placeBuilding, trainUnit, getEntity, powerStats, toggleRepair, sellBuilding, salvageValue} from '../sim.js';

const advance = (s, seconds) => { for (let i = 0; i < Math.round(seconds * 20); i++) updateGame(s, .05); };
const own = (s, type, team = 0) => s.entities.find(e => e.type === type && e.team === team && e.hp > 0);
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} vs ${expected}`);
const quiet = seed => {
  const s = createGame(seed); s.ai.nextThink = 1e12; s.minerals.fill(0); s.terrain.fill(0); s.navVersion++;
  return s;
};
const build = (s, type) => {
  s.visible[0].fill(1); const core = own(s, 'core');
  for (let y = core.y - 8; y < core.y + 10; y++) for (let x = core.x - 8; x < core.x + 10; x++) if (canPlace(s, 0, type, x, y).ok) return getEntity(s, placeBuilding(s, 0, type, x, y).id);
  throw new Error(`No construction site for ${type}`);
};

for (const team of [0, 1]) for (const type of ['core', 'reactor', 'refinery']) {
  const s = quiet(`repair-${type}-${team}`), e = own(s, type, team), initial = s.teams[team].credits;
  e.hp = e.maxHp * .5; assert(toggleRepair(s, e.id, team).ok);
  advance(s, 10);
  near(e.hp, e.maxHp * .7, 'Repair restores 2% maximum integrity per simulation second');
  near(s.teams[team].credits, initial - BUILDINGS[type].cost * .1, 'Only restored HP is charged at half-price per full health bar');
  const frozen = structuredClone(s); updateGame(s, 0); assert.deepEqual(s, frozen, 'Paused repair never advances or charges');
  assert(toggleRepair(s, e.id, team).ok); const hp = e.hp, money = s.teams[team].credits; advance(s, 1);
  assert.equal(e.hp, hp); assert.equal(s.teams[team].credits, money, 'Stopping repair immediately stops spending');
  e.hp = e.maxHp - .3; assert(toggleRepair(s, e.id, team).ok); advance(s, .1);
  assert.equal(e.hp, e.maxHp); assert.equal(e.repairing, false, 'Full integrity stops repair automatically');
  near(s.teams[team].credits, money - .3 * BUILDINGS[type].cost * .5 / e.maxHp, 'The last partial tick charges only its actual healing');
  advance(s, 1); assert.equal(e.repairing, false); assert(!toggleRepair(s, e.id, team).ok);
}

const scarce = quiet('repair-no-credits'), damaged = own(scarce, 'reactor'); damaged.hp = 100;
scarce.teams[0].credits = .1; assert(toggleRepair(scarce, damaged.id).ok); advance(scarce, 1);
near(damaged.hp, 100 + .1 * damaged.maxHp / (BUILDINGS.reactor.cost * .5), 'Fractional available credits buy only affordable HP');
assert.equal(scarce.teams[0].credits, 0); assert(damaged.repairing);
const waitingHp = damaged.hp; advance(scarce, 2); assert.equal(damaged.hp, waitingHp);
scarce.teams[0].credits = 10; advance(scarce, 1); near(damaged.hp, waitingHp + 14, 'Repair resumes after income without another toggle');
near(scarce.teams[0].credits, 7.6, 'Resumed spending follows the original repair price');

const unauthorized = quiet('repair-ownership'), enemy = own(unauthorized, 'reactor', 1), friendly = own(unauthorized, 'reactor');
enemy.hp = 100; friendly.hp = 100;
for (const action of [toggleRepair, sellBuilding]) {
  for (const [id, team] of [[enemy.id, 0], [friendly.id, 1], [friendly.id, 2], [own(unauthorized, 'rifle').id, 0], [-1, 0]]) {
    const frozen = structuredClone(unauthorized); assert(!action(unauthorized, id, team).ok); assert.deepEqual(unauthorized, frozen, 'Invalid ownership/type/id has no side effects');
  }
  const dead = {...friendly, id: unauthorized.nextId++, hp: 0}; unauthorized.entities.push(dead);
  assert(!action(unauthorized, dead.id).ok, 'Dead structures cannot be repaired or sold');
  unauthorized.status = 'defeat'; const frozen = structuredClone(unauthorized);
  assert(!action(unauthorized, friendly.id).ok); assert.deepEqual(unauthorized, frozen); unauthorized.status = 'playing';
}
const nexus = own(unauthorized, 'core'), nexusCredits = unauthorized.teams[0].credits;
assert.equal(salvageValue(nexus), 0); assert(!sellBuilding(unauthorized, nexus.id).ok);
assert(getEntity(unauthorized, nexus.id)); assert.equal(unauthorized.status, 'playing'); assert.equal(unauthorized.teams[0].credits, nexusCredits);

// Sale releases power and static collision immediately, with no kill/defeat credit.
const sold = quiet('sell-reactor'), reactor = own(sold, 'reactor'); updateGame(sold, .05);
reactor.hp = reactor.maxHp * .6; assert(toggleRepair(sold, reactor.id).ok);
const tile = reactor.y * sold.width + reactor.x, credits = sold.teams[0].credits, version = sold.navVersion, kills = sold.teams.map(t => t.kills);
assert.equal(sold.blocked[tile], 1); const result = sellBuilding(sold, reactor.id);
assert.equal(result.refund, 72); assert.equal(sold.teams[0].credits, credits + 72); assert.equal(sold.navVersion, version + 1);
assert.equal(powerStats(sold, 0).supply, BUILDINGS.core.power); assert(!getEntity(sold, reactor.id));
updateGame(sold, .05); assert.equal(sold.blocked[tile], 0, 'Sold footprint becomes walkable after the normal navigation rebuild');
assert.deepEqual(sold.teams.map(t => t.kills), kills); assert.equal(sold.status, 'playing');
assert(!sellBuilding(sold, reactor.id).ok, 'The same structure cannot refund twice');

const construction = quiet('sell-construction'), unfinished = build(construction, 'reactor');
assert(!toggleRepair(construction, unfinished.id).ok, 'Repair cannot speed up or finance unfinished construction');
assert.equal(salvageValue(unfinished), 24, 'Initial 20% built integrity returns 20% of half the structure price');
advance(construction, 3); const expected = Math.floor(BUILDINGS.reactor.cost * .5 * unfinished.hp / unfinished.maxHp);
assert.equal(sellBuilding(construction, unfinished.id).refund, expected, 'Unfinished salvage scales once with built and surviving integrity');

// Fully refund both the active paid unit and waiting units; the included hauler is independent.
const refineryGame = quiet('sell-queue-cargo'), refinery = own(refineryGame, 'refinery'), hauler = own(refineryGame, 'harvester');
assert(trainUnit(refineryGame, 0, 'harvester', refinery.id).ok); assert(trainUnit(refineryGame, 0, 'harvester', refinery.id).ok);
refinery.queue[0].progress = .6;
Object.assign(hauler, {x: refinery.x + refinery.size + .5, y: refinery.y + refinery.size / 2, cargo: 200, harvestPhase: 'return', unload: .7, unloadDepotId: refinery.id});
const haulerCount = refineryGame.entities.filter(e => e.team === 0 && e.type === 'harvester').length, before = refineryGame.teams[0].credits;
assert.equal(salvageValue(refinery), 100 + 600); assert.equal(sellBuilding(refineryGame, refinery.id).refund, 700);
assert.equal(refineryGame.teams[0].credits, before + 700); assert.equal(hauler.unload, 0); assert.equal(hauler.unloadDepotId, null); assert.equal(hauler.cargo, 200);
assert.equal(refineryGame.entities.filter(e => e.team === 0 && e.type === 'harvester').length, haulerCount);
advance(refineryGame, 20); assert.equal(hauler.cargo, 0); near(refineryGame.teams[0].credits, before + 700 + 120, 'Retained hauler delivers intact cargo to the emergency nexus');
assert.equal(refineryGame.entities.filter(e => e.team === 0 && e.type === 'harvester').length, haulerCount, 'Sold queues cannot spawn units later');
const newRefinery = build(refineryGame, 'refinery'); advance(refineryGame, 22);
assert.equal(newRefinery.haulerPending, false); assert.equal(salvageValue(newRefinery), 100);
assert(BUILDINGS.refinery.cost - salvageValue(newRefinery) >= UNITS.harvester.cost, 'Construct/sell cannot obtain a cheaper included hauler than training');
const pendingGame = quiet('sell-pending-hauler'), pending = build(pendingGame, 'refinery');
pending.progress = 1; pending.hp = pending.maxHp; assert(pending.haulerPending); assert.equal(salvageValue(pending), 250, 'An undelivered included hauler has no retained value to deduct');
const count = pendingGame.entities.filter(e => e.type === 'harvester').length;
assert(sellBuilding(pendingGame, pending.id).ok); advance(pendingGame, 1); assert.equal(pendingGame.entities.filter(e => e.type === 'harvester').length, count);
console.log('Building action checks passed: repair timing/cost/credit wait/full stop/pause, ownership/death/end-state, proportional sale and queue refunds, core protection, navigation/power, retained cargo and refinery resale economics.');
