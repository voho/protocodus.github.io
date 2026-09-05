import assert from 'node:assert/strict';
import {BUILDINGS, UNITS, createGame, updateGame, canPlace, placeBuilding, trainUnit, issueOrder, getEntity, powerStats, unitRank, unitStats} from '../sim.js';
import {SAVE_KEY, saveGame, loadGame, getSaveInfo, encodeGame, decodeGame} from '../save.js';

const memory = new Map();
const storage = {getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)};
const advance = (game, seconds) => { for (let i = 0; i < Math.round(seconds / .05); i++) updateGame(game, .05); };
const stateJSON = game => JSON.parse(encodeGame(game)).game;
const game = createGame('save-roundtrip', 'hard');
const build = type => {
  const core = game.entities.find(e => e.team === 0 && e.type === 'core');
  for (let y = core.y - 15; y < core.y + 14; y++) for (let x = core.x - 9; x < core.x + 20; x++) {
    if (canPlace(game, 0, type, x, y).ok) return getEntity(game, placeBuilding(game, 0, type, x, y).id);
  }
  throw new Error(`No site for ${type}`);
};

assert.equal(getSaveInfo(storage).ok, false);
const barracks = build('barracks'); advance(game, 16);
const factory = build('factory');
barracks.rally = {x: 26.5, y: 32.5};
assert(trainUnit(game, 0, 'rifle').ok); assert(trainUnit(game, 0, 'scout').ok);
assert(trainUnit(game, 0, 'harvester').ok);
const scout = game.entities.find(e => e.team === 0 && e.type === 'scout');
issueOrder(game, [scout.id], {type: 'explore'});
advance(game, 2.35);
assert(factory.progress > 0 && factory.progress < 1);
assert(barracks.queue[0].progress > 0 && barracks.queue.length === 2);
assert(game.entities.some(e => e.type === 'harvester' && e.cargo > 0));
assert(scout.order.type === 'explore' && scout.path.length > 0);

// A real operation resumes with its exact RNG, navigation cache, economy, queues and fog.
const memoryBuilding = structuredClone(game.entities.find(e => e.team === 1 && e.type === 'refinery'));
memoryBuilding.queue = []; memoryBuilding.rememberedAt = game.time;
const knownOre = new Float32Array(game.width * game.height); knownOre[5] = 321.25;
const camera = {x: 30.25, y: 22.75, zoom: 28, selected: new Set([scout.id]), rememberedBuildings: [memoryBuilding], knownOre};
game.renderer = {canvas: {neverSave: true}};
const saved = saveGame(game, camera, storage); assert(saved.ok, saved.reason);
assert(!memory.get(SAVE_KEY).includes('neverSave'));
const loaded = loadGame(storage); assert(loaded.ok, loaded.reason);
assert.deepEqual(loaded.view, {x: camera.x, y: camera.y, zoom: camera.zoom});
assert.deepEqual(loaded.rememberedBuildings, JSON.parse(JSON.stringify([memoryBuilding])));
assert.deepEqual(loaded.knownOre, knownOre);
assert.deepEqual(stateJSON(loaded.game), stateJSON(game));
assert(loaded.game.terrain instanceof Uint8Array);
assert(loaded.game.minerals instanceof Float32Array);
assert(loaded.game.regions instanceof Uint16Array);
assert(loaded.game.visible.every(grid => grid instanceof Uint8Array));
assert(loaded.game.explored.every(grid => grid instanceof Uint8Array));
assert.deepEqual(getSaveInfo(storage), {ok: true, reason: '', seed: game.seed, difficulty: game.difficulty, time: game.time, savedAt: loaded.savedAt});
for (let i = 0; i < 15; i++) {
  advance(game, 10); advance(loaded.game, 10);
  assert.deepEqual(stateJSON(loaded.game), stateJSON(game), `Restored simulation diverged at ${game.time.toFixed(2)} seconds`);
}
assert(game.ai.raid > 0, 'Continuation must exercise the adversary, not just idle state');
const enemyFactory = game.entities.find(e => e.team === 1 && e.type === 'factory');
assert(enemyFactory, 'The adversary reaches vehicle production');
const rememberedFactory = {...structuredClone(enemyFactory), rememberedAt: game.time, queue: [{type: 'tank', progress: .45}, {type: 'artillery', progress: 0}]};
const memorySave = decodeGame(encodeGame(game, {rememberedBuildings: [rememberedFactory]}));
assert.deepEqual(memorySave.rememberedBuildings[0].queue, rememberedFactory.queue, 'Last-seen assembly type and progress survive saving');
rememberedFactory.queue[0].progress = .95;
assert.equal(memorySave.rememberedBuildings[0].queue[0].progress, .45, 'Loaded memory owns its queue snapshot');

// A save made between construction and the next navigation rebuild preserves that boundary.
const dirty = createGame('dirty-nav'); dirty.navVersion++;
const dirtyLoaded = decodeGame(encodeGame(dirty)).game;
advance(dirty, 1); advance(dirtyLoaded, 1);
assert.deepEqual(stateJSON(dirtyLoaded), stateJSON(dirty));

const lava = createGame('save-lava'), lavaCell = 25 * lava.width + 35;
lava.terrain[lavaCell] = 3; lava.minerals[lavaCell] = 0; lava.navVersion++;
const lavaLoaded = decodeGame(encodeGame(lava)).game;
assert.deepEqual(lavaLoaded.terrain, lava.terrain, 'Lava terrain round-trips exactly with a pending navigation rebuild');
advance(lava, 3); advance(lavaLoaded, 3);
assert.equal(lavaLoaded.blocked[lavaCell], 1, 'Loaded lava remains impassable');
assert.deepEqual(stateJSON(lavaLoaded), stateJSON(lava), 'Lava maps continue deterministically');

// Both map sizes can load and advance in one session without sharing coordinate/grid bounds.
const large = createGame('expanded-save'), small = createGame('legacy-size-save', 'hard', {width: 72, height: 56});
assert.deepEqual([large.width, large.height], [144, 112]);
assert.deepEqual([small.width, small.height], [72, 56]);
large.ai.nextThink = 1e12; large.terrain.fill(0); large.minerals.fill(0); large.navVersion++;
const farScout = large.entities.find(e => e.team === 0 && e.type === 'scout');
farScout.x = 120.5; farScout.y = 90.5; issueOrder(large, [farScout.id], {type: 'move', x: 133.5, y: 103.5});
const farHauler = large.entities.find(e => e.team === 0 && e.type === 'harvester');
farHauler.x = 124.5; farHauler.y = 99.5;
large.minerals[105 * large.width + 136] = 325.25;
large.explored[0][105 * large.width + 136] = 1;
issueOrder(small, [small.entities.find(e => e.team === 0 && e.type === 'scout').id], {type: 'explore'});
advance(large, .1); advance(small, 13);
assert(farScout.path.some(p => p.x > 72 && p.y > 56) && farHauler.mineralTile > 72 * 56);
const distantMemory = {...structuredClone(large.entities.find(e => e.team === 1 && e.type === 'refinery')), x: 130, y: 90, rally: {x: 138.5, y: 104.5}, rememberedAt: large.time};
large.ai.known[farScout.id] = {id: farScout.id, kind: 'unit', type: 'scout', x: farScout.x, y: farScout.y, hp: farScout.hp, seenAt: large.time};
const distantOre = new Float32Array(large.width * large.height); distantOre[105 * large.width + 136] = 325.25;
const largeView = {x: 132.25, y: 99.75, zoom: 38, rememberedBuildings: [distantMemory], knownOre: distantOre};
const largeRaw = encodeGame(large, largeView), smallRaw = encodeGame(small, {x: 61, y: 46, zoom: 28});
const largeRestored = decodeGame(largeRaw), smallRestored = decodeGame(smallRaw);
assert.deepEqual(largeRestored.view, {x: largeView.x, y: largeView.y, zoom: largeView.zoom});
assert.deepEqual(largeRestored.knownOre, distantOre); assert.deepEqual(largeRestored.rememberedBuildings, [distantMemory]);
assert.equal(smallRestored.knownOre.length, 72 * 56); assert.equal(largeRestored.knownOre.length, 144 * 112);
for (let i = 0; i < 10; i++) {
  for (const match of [large, small, largeRestored.game, smallRestored.game]) advance(match, 1);
  assert.deepEqual(stateJSON(largeRestored.game), stateJSON(large), 'Expanded maps continue exactly alongside an old operation');
  assert.deepEqual(stateJSON(smallRestored.game), stateJSON(small), 'Old maps retain exact navigation, fog, AI and economy alongside an expanded operation');
}
const sizesStorage = {value: null, getItem() { return this.value; }, setItem(key, value) { this.value = value; }};
for (const match of [large, small, large, small]) {
  assert(saveGame(match, {}, sizesStorage).ok); const restored = loadGame(sizesStorage); assert(restored.ok);
  assert.deepEqual(stateJSON(restored.game), stateJSON(match), 'The same browser slot can alternate map sizes');
}
for (const raw of [largeRaw, smallRaw]) for (const corrupt of [
  data => { data.game.width = data.game.width === 72 ? 144 : 72; },
  data => { data.game.height = '112'; }, data => { data.game.width = 143.5; },
  data => { data.game.entities.find(e => e.kind === 'unit').x = data.game.width; },
  data => { data.game.entities.find(e => e.kind === 'building').y = data.game.height - 1; },
  data => { data.game.entities.find(e => e.kind === 'unit').path = [{x: 1, y: data.game.height + .1}]; },
  data => { data.game.entities.find(e => e.type === 'harvester').mineralTile = data.game.width * data.game.height; },
  data => { data.game.entities.find(e => e.type === 'harvester').harvestTargetX = data.game.width + 1; },
  data => { data.view.y = data.game.height + 1; }, data => { data.knownOre.pop(); },
]) { const broken = JSON.parse(raw); corrupt(broken); assert.throws(() => decodeGame(JSON.stringify(broken)), 'Bounds follow each saved map size'); }
const smallWithoutOre = JSON.parse(smallRaw); delete smallWithoutOre.knownOre;
assert.equal(decodeGame(JSON.stringify(smallWithoutOre)).knownOre.length, 72 * 56, 'Older knowledge caches default to the saved size');
const badMemory = JSON.parse(largeRaw); badMemory.rememberedBuildings[0].x = large.width - 1;
assert.throws(() => decodeGame(JSON.stringify(badMemory)), 'Remembered footprints obey the expanded bounds');

// Ranked units retain derived health, damage, speed and active paths on both map sizes.
for (const dimensions of [{width: 144, height: 112}, {width: 72, height: 56}]) {
  const veterans = createGame('saved-veterans', 'normal', dimensions); veterans.ai.nextThink = 1e12;
  veterans.terrain.fill(0); veterans.minerals.fill(0); veterans.navVersion++;
  const types = Object.keys(UNITS), templates = veterans.entities.filter(e => e.team === 0 && e.kind === 'unit');
  veterans.entities = veterans.entities.filter(e => e.kind === 'building');
  const units = [0, 4, 5, 9, 10, 14, 15, 25].map((kills, i) => {
    const type = types[i % types.length], d = UNITS[type];
    const unit = {...structuredClone(templates.find(e => e.type === type) || templates.find(e => e.type === 'rifle')), id: veterans.nextId++, type, kills, size: d.size, x: veterans.width - 34 + i * 2, y: veterans.height - 26, path: []};
    unit.maxHp = unitStats(unit).hp; unit.hp = unit.maxHp - 7; veterans.entities.push(unit);
    issueOrder(veterans, [unit.id], {type: 'move', x: unit.x + 8, y: unit.y + 3}); return unit;
  });
  advance(veterans, .05); assert(units.every(e => e.path.length > 0));
  const rankedRaw = encodeGame(veterans), restored = decodeGame(rankedRaw).game;
  for (const unit of units) {
    const copy = getEntity(restored, unit.id), rank = Math.min(3, Math.floor(unit.kills / 5)), multiplier = 1 + .2 * rank;
    assert.equal(unitRank(copy), rank); assert.equal(copy.hp, copy.maxHp - 7);
    assert.deepEqual(unitStats(copy), {rank, hp: UNITS[unit.type].hp * multiplier, damage: UNITS[unit.type].damage * multiplier, speed: UNITS[unit.type].speed * multiplier});
  }
  for (let i = 0; i < 8; i++) { advance(veterans, .5); advance(restored, .5); assert.deepEqual(stateJSON(restored), stateJSON(veterans), 'Ranked movement continues identically after loading'); }
  for (const corrupt of [
    e => { e.kills = -1; }, e => { e.kills = 1.5; }, e => { e.kills = null; }, e => { e.kills = '15'; },
    e => { e.kills = 1e12 + 1; }, e => { delete e.kills; }, e => { e.rank = 3; },
    e => { e.maxHp = UNITS[e.type].hp; }, e => { e.maxHp *= 1.01; }, e => { e.hp = e.maxHp + .1; },
  ]) {
    const broken = JSON.parse(rankedRaw); corrupt(broken.game.entities.find(e => e.kind === 'unit' && e.kills === 15));
    assert.throws(() => decodeGame(JSON.stringify(broken)), 'Kill counts and health must describe the same derived rank');
  }
  const recruits = createGame('pre-veterancy-save', 'normal', dimensions);
  for (const unit of recruits.entities.filter(e => e.kind === 'unit')) delete unit.kills;
  const legacyRecruits = decodeGame(encodeGame(recruits)).game;
  assert(legacyRecruits.entities.filter(e => e.kind === 'unit').every(e => e.kills === undefined && unitRank(e) === 0));
  advance(recruits, 2); advance(legacyRecruits, 2); assert.deepEqual(stateJSON(legacyRecruits), stateJSON(recruits), 'Legacy recruits retain their base stats and exact continuation');
}

// Preserve a pending yield and an active passing window without changing the next movement step.
const traffic = createGame('save-friendly-traffic'); traffic.ai.nextThink = 1e12; traffic.time = 10;
traffic.terrain.fill(0); traffic.minerals.fill(0); traffic.navVersion++;
const movers = ['rifle', 'scout'].map(type => traffic.entities.find(e => e.team === 0 && e.type === type));
traffic.entities = traffic.entities.filter(e => e.kind === 'building' || movers.includes(e));
for (let x = 18; x <= 36; x++) for (const y of [24, 26]) traffic.terrain[y * traffic.width + x] = 1;
for (const [i, mover] of movers.entries()) {
  mover.x = i ? 28.5 : 22.5; mover.y = 25.5;
  issueOrder(traffic, [mover.id], {type: 'move', x: i ? 22.5 : 28.5, y: 25.5});
}
advance(traffic, .05);
movers[0].trafficWait = .4; movers[0].passUntil = traffic.time + 1;
movers[1].trafficWait = .8; movers[1].passUntil = traffic.time - 1;
const trafficLoaded = decodeGame(encodeGame(traffic)).game;
assert.equal(getEntity(trafficLoaded, movers[0].id).trafficWait, .4);
assert.equal(getEntity(trafficLoaded, movers[0].id).passUntil, traffic.time + 1);
assert.equal(getEntity(trafficLoaded, movers[1].id).passUntil, traffic.time - 1, 'Expired passing windows remain valid');
const trafficFrozen = stateJSON(trafficLoaded); updateGame(trafficLoaded, 0);
assert.deepEqual(stateJSON(trafficLoaded), trafficFrozen, 'Pausing preserves pending traffic recovery');
for (let i = 0; i < 48; i++) {
  advance(traffic, .25); advance(trafficLoaded, .25);
  assert.deepEqual(stateJSON(trafficLoaded), stateJSON(traffic), 'Friendly traffic continues identically through active and expired passing windows');
}

// Both new rocket weapons survive a save while their delayed projectiles are in flight.
const rockets = createGame('save-active-rockets'); rockets.ai.nextThink = 1e12;
rockets.terrain.fill(0); rockets.minerals.fill(0); rockets.navVersion++;
rockets.teams.forEach(team => { team.credits = 50000; });
const rocketBuild = (team, type) => {
  for (let y = 1; y < rockets.height - 3; y++) for (let x = 1; x < rockets.width - 3; x++) if (canPlace(rockets, team, type, x, y).ok) {
    const e = getEntity(rockets, placeBuilding(rockets, team, type, x, y).id);
    advance(rockets, BUILDINGS[type].buildTime / Math.max(.2, powerStats(rockets, team).ratio) + .2);
    assert.equal(e.progress, 1); return e;
  }
  throw new Error(`No rocket test site for ${type}`);
};
const rocketBarracks = rocketBuild(0, 'barracks'), rocketTower = rocketBuild(0, 'rocketTower');
const enemyRocketBarracks = rocketBuild(1, 'barracks'), enemyRocketTower = rocketBuild(1, 'rocketTower');
assert(trainUnit(rockets, 0, 'rocket', rocketBarracks.id).ok); advance(rockets, UNITS.rocket.trainTime + .1);
assert(trainUnit(rockets, 0, 'rocket', rocketBarracks.id).ok); assert(trainUnit(rockets, 1, 'rocket', enemyRocketBarracks.id).ok);
const launcher = rockets.entities.find(e => e.team === 0 && e.type === 'rocket'), target = rockets.entities.find(e => e.team === 1 && e.type === 'rifle');
launcher.kills = 14; launcher.maxHp = unitStats(launcher).hp; launcher.hp = launcher.maxHp - 12;
const rocketX = rockets.width - 72, rocketY = rockets.height - 56;
rocketTower.x = 28 + rocketX; rocketTower.y = 28 + rocketY; rocketTower.cooldown = 0;
launcher.x = 31 + rocketX; launcher.y = 30.5 + rocketY; launcher.cooldown = 0;
target.x = 33 + rocketX; target.y = 30.5 + rocketY; target.cooldown = 100; target.hp = 1;
rockets.navVersion++; rockets.fogClock = 0; updateGame(rockets, .05);
assert.deepEqual(new Set(rockets.effects.filter(e => e.type === 'rocket').map(e => e.weapon)), new Set(['rocket', 'rocketTower']));
const rocketRaw = encodeGame(rockets, {rememberedBuildings: [enemyRocketTower, enemyRocketBarracks].map(e => ({...structuredClone(e), rememberedAt: rockets.time}))});
const rocketLoaded = decodeGame(rocketRaw);
assert.equal(rocketLoaded.game.effects.find(e => e.weapon === 'rocket').damage, UNITS.rocket.damage * 1.4, 'The saved missile retains its rank-two launch damage');
assert(rocketLoaded.rememberedBuildings.some(e => e.type === 'rocketTower'));
assert(rocketLoaded.rememberedBuildings.some(e => e.queue[0]?.type === 'rocket'));
assert.deepEqual(stateJSON(rocketLoaded.game), stateJSON(rockets));
for (let i = 0; i < 30; i++) { advance(rockets, .5); advance(rocketLoaded.game, .5); assert.deepEqual(stateJSON(rocketLoaded.game), stateJSON(rockets), 'Rocket impact, explosion, queued infantry and fog knowledge continue identically'); }
assert.equal(launcher.kills, 15); assert.equal(unitRank(launcher), 3); assert.equal(launcher.hp, unitStats(launcher).hp - 12, 'Loading an in-flight killing shot preserves promotion and missing health');
for (const corrupt of [
  e => { e.weapon = 'rifle'; }, e => { e.attackerId = 0; }, e => { e.targetId = 1e12; },
  e => { e.tx = null; }, e => { e.maxLife = 99; }, e => { e.life = 0; }, e => { e.life = e.maxLife + 1; },
  e => { e.damage = null; }, e => { e.damage = -1; }, e => { e.damage = 97; }, e => { e.damage = 61; },
]) {
  const invalidRocket = JSON.parse(rocketRaw); corrupt(invalidRocket.game.effects.find(e => e.type === 'rocket'));
  assert.throws(() => decodeGame(JSON.stringify(invalidRocket)), 'Malformed rocket effect is rejected');
}
const orphanRocket = JSON.parse(rocketRaw), projectile = orphanRocket.game.effects.find(e => e.type === 'rocket');
orphanRocket.game.entities = orphanRocket.game.entities.filter(e => e.id !== projectile.attackerId && e.id !== projectile.targetId);
assert(decodeGame(JSON.stringify(orphanRocket)).game.effects.some(e => e.type === 'rocket'), 'Projectiles may outlive their shooter and target');
const legacyRocket = JSON.parse(rocketRaw);
legacyRocket.game.effects.forEach(e => { delete e.damage; }); legacyRocket.game.entities.find(e => e.id === target.id).hp = 50;
const legacyFlight = decodeGame(JSON.stringify(legacyRocket)).game; advance(legacyFlight, .2);
assert.equal(getEntity(legacyFlight, target.id).hp, 32, 'Legacy missiles without launch damage use the base weapon damage');
const promotedInFlight = JSON.parse(rocketRaw), promotedLauncher = promotedInFlight.game.entities.find(e => e.id === launcher.id);
promotedLauncher.kills = 15; promotedLauncher.maxHp = unitStats(promotedLauncher).hp;
assert.equal(decodeGame(JSON.stringify(promotedInFlight)).game.effects.find(e => e.weapon === 'rocket').damage, 84, 'A later promotion cannot rewrite saved launch damage');
const rankedTower = JSON.parse(rocketRaw); rankedTower.game.effects.find(e => e.weapon === 'rocketTower').damage *= 1.2;
assert.throws(() => decodeGame(JSON.stringify(rankedTower)), 'Building rockets cannot gain veteran damage');

// In-flight unloading and a partly processed delivery resume at the same simulation instant.
for (const depotType of ['refinery', 'core']) {
  const flow = createGame(`save-processing-${depotType}`); flow.ai.nextThink = 1e12;
  if (depotType === 'core') { flow.entities.find(e => e.team === 0 && e.type === 'refinery').hp = 0; flow.navVersion++; }
  const hauler = flow.entities.find(e => e.team === 0 && e.type === 'harvester');
  for (let tick = 0; tick < 2000 && !(hauler.unloadDepotId && hauler.unload >= .25); tick++) updateGame(flow, .05);
  const depot = getEntity(flow, hauler.unloadDepotId);
  assert.equal(depot?.type, depotType, 'Save fixture reaches a real unloading depot');
  assert(hauler.unload > 0 && hauler.unload < 1.2 && hauler.cargo > 0);
  const unloadSave = decodeGame(encodeGame(flow)).game;
  assert.equal(getEntity(unloadSave, hauler.id).unloadDepotId, depot.id);
  assert.equal(getEntity(unloadSave, hauler.id).unload, hauler.unload);
  const frozen = stateJSON(unloadSave);
  await new Promise(resolve => setTimeout(resolve, 20)); updateGame(unloadSave, 0);
  assert.deepEqual(stateJSON(unloadSave), frozen, 'Paused unloading has no wall-clock progress');
  advance(flow, 1.2); advance(unloadSave, 1.2);
  assert.deepEqual(stateJSON(unloadSave), stateJSON(flow));
  assert(depot.processingAmount > 0 && depot.processingAmount < depot.processingTotal);
  const processingSave = decodeGame(encodeGame(flow)).game;
  assert.equal(getEntity(processingSave, depot.id).processingAmount, depot.processingAmount);
  assert.equal(getEntity(processingSave, depot.id).processingTotal, depot.processingTotal);
  const processingFrozen = stateJSON(processingSave);
  await new Promise(resolve => setTimeout(resolve, 20)); updateGame(processingSave, 0);
  assert.deepEqual(stateJSON(processingSave), processingFrozen, 'Paused mineral processing has no wall-clock progress');
  advance(flow, 8); advance(processingSave, 8);
  assert.deepEqual(stateJSON(processingSave), stateJSON(flow), 'Processing continuation preserves credits, cargo and the remaining batch');
}

// Failed writes or corrupt state leave the last usable save intact.
const before = memory.get(SAVE_KEY), invalid = structuredClone(game); invalid.rng = NaN;
assert.equal(saveGame(invalid, {}, storage).ok, false); assert.equal(memory.get(SAVE_KEY), before);
invalid.rng = 1; invalid.entities[0].path.push(invalid);
assert.equal(saveGame(invalid, {}, storage).ok, false); assert.equal(memory.get(SAVE_KEY), before);
const denied = {getItem() { throw new DOMException('denied', 'SecurityError'); }, setItem() { throw new DOMException('full', 'QuotaExceededError'); }};
assert.equal(saveGame(game, {}, denied).ok, false);
assert.equal(loadGame(denied).ok, false); assert.equal(getSaveInfo(denied).ok, false);
Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new DOMException('denied', 'SecurityError'); }});
assert.equal(saveGame(game).ok, false); assert.equal(loadGame().ok, false);
delete globalThis.localStorage;

const corruptions = [
  data => { data.version = 999; },
  data => { data.game.width = 999999; },
  data => { data.game.terrain.pop(); },
  data => { data.game.terrain[0] = 4; },
  data => { data.game.minerals[0] = -1; },
  data => { data.game.entities[0].size = 100000; },
  data => { data.game.entities.find(e => e.kind === 'building').kills = 0; },
  data => { data.game.entities.find(e => e.kind === 'building').maxHp *= 1.2; },
  data => { data.rememberedBuildings[0].kills = 15; },
  data => { data.game.entities[0].type = '__proto__'; },
  data => { data.game.entities[0].queue.push({type: 'bogus', progress: .2}); },
  data => { data.game.entities[1].id = data.game.entities[0].id; },
  data => { data.game.entities[0].order = {type: 'move', x: 999999, y: 1}; },
  data => { data.game.entities.find(e => e.kind === 'unit').queue = {}; },
  ...['trafficWait', 'passUntil'].flatMap(key => [
    data => { data.game.entities.find(e => e.kind === 'building')[key] = 0; },
    ...[null, -1, '0', {}].map(value => data => { data.game.entities.find(e => e.kind === 'unit')[key] = value; }),
    data => { data.game.entities.find(e => e.kind === 'unit')[key] = key === 'trafficWait' ? .81 : data.game.time + 1.51; },
  ]),
  data => { const e = data.game.entities.find(e => e.type === 'refinery'); e.processingAmount = -1; e.processingTotal = 200; },
  data => { const e = data.game.entities.find(e => e.type === 'refinery'); e.processingAmount = 201; e.processingTotal = 200; },
  data => { const e = data.game.entities.find(e => e.type === 'refinery'); e.processingAmount = 20; delete e.processingTotal; },
  data => { const e = data.game.entities.find(e => e.type === 'rifle'); e.processingAmount = 20; e.processingTotal = 200; },
  data => { data.game.entities.find(e => e.type === 'harvester').unloadDepotId = data.game.entities.find(e => e.type === 'rifle').id; },
  data => { data.game.entities.find(e => e.type === 'harvester' && e.team === 0).unloadDepotId = data.game.entities.find(e => e.type === 'refinery' && e.team === 1).id; },
  data => { data.game.entities.find(e => e.type === 'harvester').unloadDepotId = 'refinery'; },
  data => { data.game.entities.find(e => e.type === 'harvester').unload = 2; },
  data => { data.game.entities.find(e => e.type === 'rifle').unloadDepotId = null; },
  data => { data.game.ai.known = {malformed: {x: 1, y: 2}}; },
  data => { data.view.zoom = 1e12; },
  data => { data.rememberedBuildings[0].kind = 'unit'; },
  data => { data.rememberedBuildings[0].size = 10000; },
  data => { data.rememberedBuildings.push(data.rememberedBuildings[0]); },
  data => { data.rememberedBuildings[0].queue = [{type: 'tank', progress: .5}]; },
  data => { data.knownOre = [1]; },
];
for (const change of corruptions) {
  const broken = JSON.parse(before); change(broken); memory.set(SAVE_KEY, JSON.stringify(broken));
  assert.equal(loadGame(storage).ok, false);
}
for (const text of ['{bad JSON', 'null', '[]', 'x'.repeat(2_000_001)]) {
  memory.set(SAVE_KEY, text); assert.equal(loadGame(storage).ok, false);
}
memory.set(SAVE_KEY, before); assert(loadGame(storage).ok);
const legacy = JSON.parse(before); delete legacy.rememberedBuildings; delete legacy.knownOre;
legacy.game.terrain = legacy.game.terrain.map(value => value === 3 ? 0 : value); legacy.game.navVersion++;
for (const entity of legacy.game.entities) { delete entity.processingAmount; delete entity.processingTotal; delete entity.unloadDepotId; delete entity.trafficWait; delete entity.passUntil; delete entity.kills; }
const legacyLoaded = decodeGame(JSON.stringify(legacy));
assert.deepEqual(legacyLoaded.rememberedBuildings, []);
assert.equal(legacyLoaded.knownOre.length, game.width * game.height);
assert(legacyLoaded.game.terrain.every(value => value <= 2), 'Legacy maps without lava remain compatible');
assert(legacyLoaded.game.entities.every(e => (e.processingAmount ?? 0) === 0 && (e.processingTotal ?? 0) === 0));
advance(legacyLoaded.game, .1);
assert(legacyLoaded.game.entities.every(e => Number.isFinite(e.hp + e.x + e.y)), 'Old saves run without new processing or traffic fields');
console.log('Ashline save checks passed: deterministic active-match/rocket-flight/traffic/veterancy continuation, camera, typed maps/fog, remembered buildings/ore, queues/rallies, unloading/processing/pause, cargo/AI, pending navigation, old/invalid saves and unavailable/full storage.');
