import assert from 'node:assert/strict';
import { BUILDINGS, UNITS, createGame, updateGame, canPlace, placeBuilding, getEntity, trainUnit, setRallyPoint, powerStats } from '../sim.js';

const advance = (s, seconds) => { for (let i = 0; i < Math.ceil(seconds * 10); i++) updateGame(s, .1); };
const own = (s, type, team = 0) => s.entities.filter(e => e.hp > 0 && e.team === team && e.type === type);
const quiet = seed => {
  const s = createGame(seed); s.ai.nextThink = Infinity; s.fogClock = Infinity;
  s.terrain.fill(0); s.minerals.fill(0); s.navVersion++;
  s.visible.forEach(v => v.fill(1)); s.explored.forEach(v => v.fill(1));
  s.teams.forEach(t => { t.credits = 100000; }); return s;
};
function construct(s, type, team = 0, finish = true) {
  for (let y = 1; y < s.height - 4; y++) for (let x = 1; x < s.width - 4; x++) if (canPlace(s, team, type, x, y).ok) {
    const result = placeBuilding(s, team, type, x, y), e = getEntity(s, result.id);
    assert(result.ok);
    if (finish) { advance(s, BUILDINGS[type].buildTime / Math.max(.2, powerStats(s, team).ratio) + 1); assert.equal(e.progress, 1); }
    return e;
  }
  throw Error(`No valid ${type} site`);
}

// Each producer owns an independent active item, even when several build the same class.
const s = quiet('parallel-production');
construct(s, 'reactor');
const a = construct(s, 'barracks'), b = construct(s, 'barracks');
const f = construct(s, 'factory'), g = construct(s, 'factory');
const r = own(s, 'refinery')[0], r2 = construct(s, 'refinery');
const jobs = [[a, 'rifle'], [b, 'rifle'], [f, 'tank'], [g, 'artillery'], [r, 'harvester'], [r2, 'harvester']];
const before = Object.fromEntries(Object.keys(UNITS).map(type => [type, own(s, type).length]));
const credits = s.teams[0].credits;
for (const [producer, type] of jobs) assert(trainUnit(s, 0, type, producer.id).ok);
assert.equal(s.teams[0].credits, credits - jobs.reduce((n, [, type]) => n + UNITS[type].cost, 0));
advance(s, 2);
for (const [producer, type] of jobs) assert(Math.abs(producer.queue[0].progress - 2 / UNITS[type].trainTime) < 1e-6, `${type} progresses at its own producer`);
advance(s, 3.2);
assert.equal(own(s, 'rifle').length, before.rifle + 2, 'Both barracks complete infantry concurrently');
assert(f.queue[0].progress > .35 && g.queue[0].progress > .25 && r.queue[0].progress > .35);
advance(s, 14);
for (const type of ['tank', 'artillery', 'harvester']) assert.equal(own(s, type).length, before[type] + (type === 'harvester' ? 2 : 1));
assert(jobs.every(([producer]) => producer.queue.length === 0));

// Automatic routing uses remaining seconds and ignores full queues. Explicit routing stays local.
assert(trainUnit(s, 0, 'rifle', a.id).ok); assert(trainUnit(s, 0, 'rifle', a.id).ok);
a.queue[0].progress = .95; assert(trainUnit(s, 0, 'scout', b.id).ok);
assert(trainUnit(s, 0, 'rifle').ok); assert.equal(a.queue.length, 3, 'Near-finished shorter work wins over fewer queued items');
while (a.queue.length < 6) assert(trainUnit(s, 0, 'rifle', a.id).ok);
while (b.queue.length < 5) assert(trainUnit(s, 0, 'scout', b.id).ok);
assert(trainUnit(s, 0, 'rifle').ok); assert.equal(b.queue.length, 6, 'A full shorter producer does not block another producer');
const creditsBeforeInvalid = s.teams[0].credits;
assert.equal(trainUnit(s, 0, 'rifle', a.id).ok, false);
assert.equal(trainUnit(s, 0, 'tank', b.id).ok, false);
assert.equal(trainUnit(s, 0, 'harvester', own(s, 'refinery', 1)[0].id).ok, false);
assert.equal(trainUnit(s, 0, 'rifle', -1).ok, false);
assert.equal(s.teams[0].credits, creditsBeforeInvalid, 'Invalid routing must not charge credits');
const survivingQueue = b.queue.length; a.hp = 0; advance(s, 1);
assert.equal(b.queue.length, survivingQueue, 'Losing a producer preserves independent queues');
assert(b.queue[0].progress > 0); assert(b.queue.slice(1).every(q => q.progress === 0), 'One producer works on one unit at a time');
assert.equal(trainUnit(s, 0, 'rifle', a.id).ok, false);

// Rally orders work for every producing building and for both factions, including the free hauler.
for (const team of [0, 1]) {
  const match = quiet(`rallies-${team}`); construct(match, 'reactor', team);
  const barracks = construct(match, 'barracks', team), factory = construct(match, 'factory', team);
  const refinery = construct(match, 'refinery', team, false);
  const core=own(match,'core',team)[0],point = team ? { x: core.x-16.5, y: core.y+5.5 } : { x: core.x+13.5, y: core.y+2.5 };
  const producers = [barracks, factory, refinery];
  assert(setRallyPoint(match, team, producers.map(e => e.id), point).ok);
  point.x += 1; assert.notEqual(barracks.rally.x, point.x, 'Rally destinations are copied');
  const freeBefore = new Set(own(match, 'harvester', team).map(e => e.id));
  advance(match, BUILDINGS.refinery.buildTime + .1);
  const free = own(match, 'harvester', team).find(e => !freeBefore.has(e.id));
  assert(free && free.order.type === 'move', 'Included hauler follows the refinery rally');
  assert.equal(free.order.x, refinery.rally.x);
  assert.equal(free.order.y, refinery.rally.y, 'The first free rally spot preserves the exact click');
  const arrivals = [{unit: free, goal: {...free.order}}];
  for (const [producer, type] of [[barracks, 'rifle'], [factory, 'tank'], [refinery, 'harvester']]) {
    const ids = new Set(own(match, type, team).map(e => e.id));
    assert(trainUnit(match, team, type, producer.id).ok);
    advance(match, UNITS[type].trainTime + .1);
    const trained = own(match, type, team).find(e => !ids.has(e.id));
    assert(trained); assert.equal(trained.order.type, type === 'harvester' ? 'move' : 'attackMove');
    assert(Math.hypot(trained.order.x - producer.rally.x, trained.order.y - producer.rally.y) < 3, 'Later units reserve a nearby free rally spot');
    arrivals.push({unit: trained, goal: {...trained.order}});
  }
  advance(match, 35);
  assert(own(match, 'harvester', team).every(e => e.order.type === 'harvest'), 'Rallied haulers resume automatic harvesting');
  assert.equal(new Set(arrivals.map(({goal}) => `${goal.x},${goal.y}`)).size, arrivals.length, 'Independent producers share the rally area without sharing a destination');
  for (const {unit, goal} of arrivals) assert(Math.hypot(unit.x - goal.x, unit.y - goal.y) <= .081, 'Rallied units settle at their reserved spot');
  const previous = { ...barracks.rally }, enemyRefinery = own(match, 'refinery', 1 - team)[0];
  for (const ids of [[], [barracks.id, enemyRefinery.id], [barracks.id, own(match, 'core', team)[0].id], [-1]]) {
    assert.equal(setRallyPoint(match, team, ids, { x: 30, y: 30 }).ok, false);
    assert.deepEqual(barracks.rally, previous, 'Invalid selections do not partially apply a rally');
  }
  for (const point of [{ x: NaN, y: 4 }, { x: match.width, y: 4 }, { x: 4, y: match.height }, { x: -1, y: 4 }, null]) assert.equal(setRallyPoint(match, team, [barracks.id], point).ok, false);
  barracks.hp = 0; assert.equal(setRallyPoint(match, team, [barracks.id], { x: 3, y: 3 }).ok, false);
  match.status = 'victory'; assert.equal(setRallyPoint(match, team, [factory.id], { x: 3, y: 3 }).ok, false);
}

console.log('Ashline production checks passed: simultaneous production, remaining-time routing, full queues, explicit producers, destruction, rally validation, and automatic hauler rallies.');
