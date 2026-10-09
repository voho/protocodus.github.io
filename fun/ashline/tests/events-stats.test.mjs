import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDINGS, UNITS, RESEARCH, EVENT_KINDS, TEAM_STATS, createGame, updateGame, canPlace, placeBuilding, planWallLine, buildWallLine, sellBuilding, trainUnit, cancelTraining, startResearch, cancelResearch, getEntity, productionRate, raceUnit} from '../sim.js';

const advance = (s, seconds) => { for (let i = 0; i < Math.round(seconds / .05); i++) updateGame(s, .05); };
function quiet(seed) {
  const s = createGame(seed, 'normal', {width: 72, height: 56, aiTeams: []});
  s.terrain.fill(0); s.navVersion++; s.visible.forEach(v => v.fill(1)); s.explored.forEach(v => v.fill(1)); s.fogClock = Infinity;
  s.teams.forEach(t => { t.credits = 20000; }); return s;
}
function construct(s, type, team = 0) {
  for (let y = 1; y < s.height - 4; y++) for (let x = 1; x < s.width - 4; x++) if (canPlace(s, team, type, x, y).ok) {
    const e = getEntity(s, placeBuilding(s, team, type, x, y).id);
    advance(s, BUILDINGS[type].buildTime / productionRate(s, team) + .5); assert.equal(e.progress, 1); return e;
  }
  throw Error(`No valid ${type} site`);
}

test('every event has a known kind and only locates its own team’s entities', () => {
  const s = createGame('typed-events', 'hard', {width: 72, height: 56, races: ['organics', 'aiUnity'], aiTeams: [0, 1]}), owners = new Map();
  for (let tick = 0; tick < 3600 && s.status === 'playing'; tick++) {
    for (const e of s.entities) owners.set(e.id, e.team);
    updateGame(s, .05);
  }
  for (const e of s.entities) owners.set(e.id, e.team);
  const kinds = new Set(s.events.map(e => e.kind));
  for (const kind of ['opening', 'ready', 'placed', 'online', 'delivery', 'underAttack', 'unitLost']) assert(kinds.has(kind), `The duel produces ${kind} events`);
  for (const e of s.events) {
    assert(EVENT_KINDS.includes(e.kind), `${e.text} has a known kind`);
    if (e.x !== undefined || e.entityId !== undefined) {
      assert(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isInteger(e.entityId) && typeof e.role === 'string');
      assert.equal(owners.get(e.entityId), e.team, `${e.text} locates only its own team's entity`);
    }
  }
  for (const e of s.events.filter(e => e.kind === 'delivery')) assert(e.amount > 0 && [0, 1, 2, 3].includes(e.mineralType));
  for (const e of s.events.filter(e => e.kind === 'unitLost' || e.kind === 'promotion')) assert(Number.isInteger(e.rank) && e.rank >= 0 && e.rank <= 3);
  const [a, b] = s.teams.map(t => t.stats);
  assert.equal(a.damageDealt, b.damageTaken); assert.equal(b.damageDealt, a.damageTaken);
  assert.equal(a.unitKills, b.lost); assert.equal(a.structureKills, b.structuresLost);
  s.teams.forEach((t, team) => {
    assert.deepEqual(Object.keys(t.stats), TEAM_STATS);
    assert.equal(t.stats.unitKills + t.stats.structureKills, t.kills);
    assert.equal(t.stats.mined, s.events.filter(e => e.kind === 'delivery' && e.team === team).reduce((sum, e) => sum + e.amount, 0));
    assert.equal(t.stats.trained, s.events.filter(e => e.kind === 'ready' && e.team === team && e.time > 0).length, 'Opening haulers are not counted as trained');
    assert(Object.values(t.stats).every(value => Number.isFinite(value) && value >= 0));
  });
});

test('team statistics follow commands, spending, refunds and losses', () => {
  const s = quiet('team-stats'), stats = s.teams[0].stats;
  assert.deepEqual(stats, {...Object.fromEntries(TEAM_STATS.map(key => [key, 0])), peakArmy: 4}, 'Starting forces set the army peak only');
  construct(s, 'reactor'); const barracks = construct(s, 'barracks'), lab = construct(s, 'lab');
  const structureCost = ['reactor', 'barracks', 'lab'].reduce((sum, type) => sum + BUILDINGS[type].cost, 0);
  assert.equal(stats.built, 3); assert.equal(stats.spent, structureCost);
  assert(trainUnit(s, 0, 'rifle', barracks.id).ok); advance(s, UNITS.rifle.trainTime / productionRate(s, 0) + .5);
  assert.equal(stats.trained, 1); assert.equal(stats.peakArmy, 5); assert.equal(stats.spent, structureCost + UNITS.rifle.cost);
  assert(startResearch(s, 0, 'infantryWeapons', lab.id).ok); assert(cancelResearch(s, lab.id).ok);
  assert.equal(stats.spent, structureCost + UNITS.rifle.cost, 'Cancelled research returns its spend');
  assert(startResearch(s, 0, 'infantryWeapons', lab.id).ok); advance(s, RESEARCH.infantryWeapons.time / productionRate(s, 0) + .5);
  assert.equal(stats.researched, 1); assert.equal(stats.spent, structureCost + UNITS.rifle.cost + RESEARCH.infantryWeapons.cost);
  const core = s.entities.find(e => e.team === 0 && e.kind === 'building' && BUILDINGS[e.type].role === 'core');
  const row = [...Array(12).keys()].map(dy => core.y + core.size + 1 + dy).find(y => planWallLine(s, 0, core.x, y, core.x + 4, y).ok);
  const walls = buildWallLine(s, 0, core.x, row, core.x + 4, row); assert(walls.ok && walls.count === 5);
  assert.equal(stats.built, 3 + walls.count); const wallEvent = s.events.at(-1);
  assert.equal(wallEvent.kind, 'walls'); assert(walls.ids.includes(wallEvent.entityId));
  const spent = stats.spent, refund = sellBuilding(s, barracks.id).refund, sold = s.events.at(-1);
  assert.equal(sold.kind, 'sold'); assert.equal(sold.amount, refund); assert.equal(stats.spent, spent, 'Sales are salvage, not refunds of spending');
  // A visible enemy rifle dies to the starting squad; both ledgers record the same exchange.
  const rifle = s.entities.find(e => e.team === 0 && e.type === 'rifle');
  const enemy = {...structuredClone(rifle), id: s.nextId++, team: 1, type: raceUnit(s, 1, 'rifle'), x: rifle.x + 3, y: rifle.y, hp: 20, cooldown: 1000};
  s.entities.push(enemy); advance(s, 2);
  assert(!getEntity(s, enemy.id)); assert.equal(stats.unitKills, 1); assert.equal(s.teams[1].stats.lost, 1);
  assert(Math.abs(stats.damageDealt - 20) < 1e-9 && s.teams[1].stats.damageTaken === stats.damageDealt, 'Overkill is not counted as damage');
  const lost = s.events.find(e => e.kind === 'unitLost' && e.team === 1);
  assert.deepEqual([lost.entityId, lost.role, lost.rank], [enemy.id, 'rifle', 0]);
});

test('deliveries record mined credits and repairs record spending', () => {
  const s = createGame('stats-economy', 'normal', {width: 72, height: 56, aiTeams: []}), stats = s.teams[0].stats;
  const reactor = s.entities.find(e => e.team === 0 && e.type === 'reactor'); reactor.hp -= 20; reactor.repairing = true;
  let credits = s.teams[0].credits; advance(s, 4);
  assert(!reactor.repairing && stats.spent > 0 && Math.abs(stats.spent - (credits - s.teams[0].credits)) < 1e-9, 'Structure repairs spend credits');
  for (let i = 0; i < 400 && !stats.mined; i++) { credits = s.teams[0].credits; updateGame(s, .05); }
  const delivery = s.events.findLast(e => e.kind === 'delivery');
  assert.equal(delivery.team, 0); assert.equal(delivery.role, 'harvester'); assert.equal(delivery.mineralType, 1);
  assert.equal(stats.mined, delivery.amount); assert(Math.abs(s.teams[0].credits - credits - delivery.amount) < 1e-6);
});

test('cancelling training refunds the full price at any queue position', () => {
  const s = quiet('cancel-training'), stats = s.teams[0].stats, barracks = construct(s, 'barracks');
  const credits = s.teams[0].credits, spent = stats.spent;
  for (const type of ['rifle', 'rocket', 'scout']) assert(trainUnit(s, 0, type, barracks.id).ok);
  advance(s, 2); assert(barracks.queue[0].progress > 0);
  assert.deepEqual(cancelTraining(s, 1, barracks.id, 0), {ok: false, reason: 'Select your production building'});
  assert.equal(cancelTraining(s, 0, barracks.id, 3).reason, 'No unit at that queue position');
  assert.equal(cancelTraining(s, 0, barracks.id, 1.5).reason, 'No unit at that queue position');
  assert.equal(cancelTraining(s, 0, s.entities.find(e => e.team === 0 && e.kind === 'unit').id, 0).reason, 'Select your production building');
  const middle = cancelTraining(s, 0, barracks.id, 1);
  assert.deepEqual(middle, {ok: true, reason: '', refund: UNITS.rocket.cost, type: 'rocket'});
  const event = s.events.at(-1);
  assert.equal(event.kind, 'trainingCancelled'); assert.equal(event.text, 'Rocket infantry training cancelled: +160 credits');
  assert.equal(event.amount, UNITS.rocket.cost); assert.equal(event.entityId, barracks.id);
  assert.deepEqual(cancelTraining(s, 0, barracks.id, 0), {ok: true, reason: '', refund: UNITS.rifle.cost, type: 'rifle'}, 'Even the unit in training is refunded in full');
  assert.deepEqual(barracks.queue.map(q => [q.type, q.progress]), [['scout', 0]]);
  assert.equal(s.teams[0].credits, credits - UNITS.scout.cost); assert.equal(stats.spent, spent + UNITS.scout.cost, 'Refunds return their spending');
  advance(s, UNITS.scout.trainTime / productionRate(s, 0) + .5);
  assert.equal(stats.trained, 1); assert.equal(barracks.queue.length, 0);
  s.status = 'victory'; assert.equal(cancelTraining(s, 0, barracks.id, 0).reason, 'Operation has ended');
});
