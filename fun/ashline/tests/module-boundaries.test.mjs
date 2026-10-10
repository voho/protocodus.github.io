// Pins the module-split invariants: the simulation, AI, mission and ability modules form an import cycle
// that must work from any entry point, terrain generation stays standalone and never consumes the shared
// random stream, and the typed events that the interface and audio route on keep their kinds and subjects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {promisify} from 'node:util';
import * as sim from '../sim.js';
import * as terrain from '../terrain.js';

const {BUILDINGS, RESEARCH, BUILDING_UPGRADES, UNITS, createGame, updateGame, canPlace, placeBuilding, getEntity, productionRate, issueOrder,
  sellBuilding, startResearch, startBuildingUpgrade, addEntity, deploymentStatus, deployNexus, entityRole, raceUnit, raceBuilding} = sim;
const moduleUrl = file => new URL(`../${file}`, import.meta.url).href;
const run = promisify(execFile);

// Each run starts a fresh process, so `entry` really is the first module evaluated. The scenario exercises
// AI thinking, an ability, a mission and a save round trip, then digests both games.
const scenario = entry => `
  await import(${JSON.stringify(moduleUrl(entry))});
  const sim = await import(${JSON.stringify(moduleUrl('sim.js'))}), {encodeGame} = await import(${JSON.stringify(moduleUrl('save.js'))});
  const {useAbility} = await import(${JSON.stringify(moduleUrl('abilities.js'))}), {MISSIONS} = await import(${JSON.stringify(moduleUrl('campaign.js'))});
  const {createHash} = await import('node:crypto');
  const digest = s => createHash('sha256').update(JSON.stringify(JSON.parse(encodeGame(s)).game)).digest('hex');
  const skirmish = sim.createGame('MODULE-ORDER', 'hard', {width: 72, height: 56, races: ['organics', 'aiUnity'], aiTeams: [0, 1]});
  const rifles = skirmish.entities.filter(e => e.team === 0 && sim.entityRole(e) === 'rifle').map(e => e.id);
  const ability = useAbility(skirmish, 0, rifles).ok;
  for (let i = 0; i < 240; i++) sim.updateGame(skirmish, .25);
  const missionId = Object.keys(MISSIONS)[0], mission = sim.createGame('MODULE-ORDER', 'normal', {mission: missionId});
  for (let i = 0; i < 80; i++) sim.updateGame(mission, .25);
  console.log(JSON.stringify({time: skirmish.time, ability, aiPlaced: [0, 1].map(team => skirmish.events.some(e => e.kind === 'placed' && e.team === team)),
    missionId: mission.mission?.id, skirmish: digest(skirmish), mission: digest(mission)}));`;
async function importFirst(entry) {
  const {stdout} = await run(process.execPath, ['--input-type=module', '-e', scenario(entry)], {timeout: 180000, maxBuffer: 1 << 20});
  return JSON.parse(stdout);
}
let reference;
const referenceRun = () => reference ??= importFirst('sim.js');

test('a game created after importing sim.js first steps its AI, abilities and missions', async () => {
  const result = await referenceRun();
  assert(Math.abs(result.time - 60) < 1e-6, 'The skirmish advanced a full minute');
  assert.equal(result.ability, true, 'Rifles used their ability');
  assert.deepEqual(result.aiPlaced, [true, true], 'Both AI commanders thought and built');
  assert.equal(typeof result.missionId, 'string', 'The mission engine created its state');
});

for (const entry of ['ai.js', 'mission.js', 'abilities.js', 'terrain.js', 'campaign.js']) {
  test(`importing ${entry} before sim.js gives the identical game`, async () => {
    // A top-level read of a binding from the other side of the cycle would throw here, or diverge.
    assert.deepEqual(await importFirst(entry), await referenceRun());
  });
}

// Static import closure: relative module specifiers, followed transitively.
function importClosure(url, closure = new Set()) {
  if (closure.has(url)) return closure;
  closure.add(url);
  const source = readFileSync(new URL(url), 'utf8');
  const pattern = /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier.startsWith('.')) importClosure(new URL(specifier, url).href, closure);
  }
  return closure;
}

test('terrain.js stands alone: no import path reaches the simulation core', () => {
  const aiClosure = importClosure(moduleUrl('ai.js'));
  assert(aiClosure.has(moduleUrl('sim.js')) && aiClosure.has(moduleUrl('terrain.js')), 'The import scan follows real imports');
  const closure = importClosure(moduleUrl('terrain.js'));
  for (const file of ['sim.js', 'ai.js', 'mission.js', 'abilities.js', 'save.js']) assert(!closure.has(moduleUrl(file)), `terrain.js must not import ${file}`);
});

test('sim.js re-exports the terrain module’s map tables and layout unchanged', () => {
  assert.equal(sim.MAP_SIZES, terrain.MAP_SIZES);
  assert.equal(sim.MAP_PROFILES, terrain.MAP_PROFILES);
  assert.equal(sim.mapLayout, terrain.mapLayout);
});

test('generateMap draws only on local streams and never touches the shared random stream', () => {
  // Named map sites are the one documented field generation may add to a game.
  const outputs = ['sites'];
  const sizes = [...Object.keys(terrain.MAP_PROFILES).map(profile => [profile, terrain.MAP_SIZES.standard]), ['rift', {width: 72, height: 56}]];
  for (const [profile, {width, height}] of sizes) {
    const plain = rng => ({width, height, seed: 'BOUNDARY-TERRAIN', mapProfile: profile, rng,
      terrain: new Uint8Array(width * height), minerals: new Float32Array(width * height), mineralTypes: new Uint8Array(width * height)});
    const s = plain(0x2545f491), keys = Object.keys(s), touched = new Set();
    const watch = handler => (target, key, ...rest) => { touched.add(key); return Reflect[handler](target, key, ...rest); };
    terrain.generateMap(new Proxy(s, {get: watch('get'), set: watch('set'), has: watch('has'), deleteProperty: watch('deleteProperty'),
      defineProperty: watch('defineProperty'), getOwnPropertyDescriptor: watch('getOwnPropertyDescriptor')}));
    const label = `${profile} ${width}×${height}`;
    assert(!touched.has('rng'), `${label}: generation never reads or writes s.rng`);
    assert.equal(s.rng, 0x2545f491);
    assert.deepEqual(Object.keys(s).filter(key => !outputs.includes(key)), keys, `${label}: generation adds no simulation state`);
    assert(s.terrain.some(tile => tile !== 0) && s.minerals.some(amount => amount > 0), `${label}: generation wrote the grids`);
    // A different shared-stream value cannot change the map.
    const other = plain(7); terrain.generateMap(other);
    for (const key of ['terrain', 'minerals', 'mineralTypes']) assert.deepEqual(other[key], s[key], `${label}: ${key} ignores s.rng`);
  }
});

const advance = (s, seconds) => { for (let i = 0; i < Math.round(seconds / .05); i++) updateGame(s, .05); };
function quiet(seed) {
  const s = createGame(seed, 'normal', {width: 72, height: 56, aiTeams: []});
  s.terrain.fill(0); s.navVersion++; s.visible.forEach(v => v.fill(1)); s.explored.forEach(v => v.fill(1)); s.fogClock = Infinity;
  s.teams.forEach(t => { t.credits = 20000; }); return s;
}
function construct(s, role, team = 0) {
  const type = raceBuilding(s, team, role);
  for (let y = 1; y < s.height - 4; y++) for (let x = 1; x < s.width - 4; x++) if (canPlace(s, team, type, x, y).ok) {
    const e = getEntity(s, placeBuilding(s, team, type, x, y).id);
    advance(s, BUILDINGS[type].buildTime / productionRate(s, team) + .5); assert.equal(e.progress, 1, `${type} completes`); return e;
  }
  throw Error(`No valid ${type} site`);
}
const last = (s, kind) => s.events.findLast(e => e.kind === kind);
const located = e => e.kind === 'building' ? {x: e.x + e.size / 2, y: e.y + e.size / 2} : {x: e.x, y: e.y};
function assertSubject(event, entity, role, label) {
  assert(event, `${label} event emitted`);
  assert.deepEqual({team: event.team, entityId: event.entityId, role: event.role, x: event.x, y: event.y},
    {team: entity.team, entityId: entity.id, role, ...located(entity)}, `${label} names its own entity`);
}
// Team-wide notices carry no position, so they cannot point at anything.
const assertUnlocated = (event, label) => assert(event && event.x === undefined && event.y === undefined && event.entityId === undefined, `${label} carries no position`);

test('exploring every reachable tile emits an explored event at the unit', () => {
  const s = quiet('typed-explored'), scout = s.entities.find(e => e.team === 0 && entityRole(e) === 'scout');
  issueOrder(s, [scout.id], {type: 'explore'}); advance(s, 1);
  const event = last(s, 'explored');
  assertSubject(event, scout, 'scout', 'explored');
  assert.equal(event.text, `${UNITS[scout.type].name}: reachable territory explored`);
  assert.equal(scout.order.type, 'idle', 'The scout stops once nothing is left to explore');
});

test('power shortages and recovery emit team-wide power events with their status', () => {
  const s = quiet('typed-power');
  construct(s, 'barracks'); construct(s, 'factory');
  for (const reactor of s.entities.filter(e => e.team === 0 && entityRole(e) === 'reactor')) assert(sellBuilding(s, reactor.id).ok);
  advance(s, 1);
  const shortage = last(s, 'power');
  assert.deepEqual([shortage.team, shortage.status], [0, 'brownout']); assertUnlocated(shortage, 'brownout');
  const reactor = construct(s, 'reactor'); construct(s, 'reactor'); advance(s, 1);
  assert(reactor.progress === 1 && s.teams[0].powerStatus === 'stable');
  const restored = last(s, 'power');
  assert.deepEqual([restored.team, restored.status, restored.text], [0, 'stable', 'Power grid restored.']); assertUnlocated(restored, 'restored');
});

test('research and structure upgrades emit started and complete events at their building', () => {
  const s = quiet('typed-upgrades');
  construct(s, 'barracks'); const lab = construct(s, 'lab'), factory = construct(s, 'factory');
  assert(startResearch(s, 0, 'infantryWeapons', lab.id).ok);
  assertSubject(last(s, 'researchStarted'), lab, 'lab', 'researchStarted');
  advance(s, RESEARCH.infantryWeapons.time / productionRate(s, 0) + .5);
  assertSubject(last(s, 'researchComplete'), lab, 'lab', 'researchComplete');
  const upgrade = Object.keys(BUILDING_UPGRADES).find(id => BUILDING_UPGRADES[id].types.includes('factory') && BUILDING_UPGRADES[id].requires.every(role => role === 'lab'));
  assert(upgrade, 'A factory upgrade needing only the lab exists');
  assert(startBuildingUpgrade(s, 0, factory.id, upgrade).ok);
  assertSubject(last(s, 'upgradeStarted'), factory, 'factory', 'upgradeStarted');
  advance(s, BUILDING_UPGRADES[upgrade].time / productionRate(s, 0) + .5);
  assert(factory.upgrades?.[upgrade], 'The upgrade installs');
  assertSubject(last(s, 'upgradeComplete'), factory, 'factory', 'upgradeComplete');
});

test('deploying a construction vehicle emits a deployed event at the new nexus', () => {
  const s = quiet('typed-deployed'), core = s.entities.find(e => e.team === 0 && entityRole(e) === 'core');
  const vehicle = addEntity(s, 0, 'unit', raceUnit(s, 0, 'constructor'), core.x + 14.5, core.y + 1.5);
  let result;
  for (let y = Math.floor(vehicle.y) - 4; y <= vehicle.y + 4 && !result?.ok; y++) for (let x = Math.floor(vehicle.x) - 4; x <= vehicle.x + 4 && !result?.ok; x++) {
    if (deploymentStatus(s, 0, vehicle.id, x, y).ok) result = deployNexus(s, 0, vehicle.id, x, y);
  }
  assert(result?.ok, 'The vehicle found a deployment site');
  const nexus = getEntity(s, result.id);
  assertSubject(last(s, 'deployed'), nexus, 'core', 'deployed');
  assert(!getEntity(s, vehicle.id), 'Deployment consumes the vehicle');
});

// Hostile tanks beside each target, with the target at 1 hp, settle a fight within a few ticks.
function ambush(s, targets, team) {
  for (const target of targets) {
    target.hp = 1;
    const c = located(target), tank = addEntity(s, team, 'unit', raceUnit(s, team, 'tank'), c.x + (target.kind === 'building' ? target.size / 2 + 1 : 1), c.y);
    tank.cooldown = 0; issueOrder(s, [tank.id], {type: 'attack', targetId: target.id});
  }
}

test('losing the last hauler emits haulersLost at that hauler', () => {
  const s = quiet('typed-haulers'), haulers = s.entities.filter(e => e.team === 0 && entityRole(e) === 'harvester');
  assert(haulers.length > 0 && !s.entities.some(e => e.team === 0 && e.haulerPending), 'The opening haulers have arrived');
  ambush(s, haulers, 1);
  for (let tick = 0; tick < 200 && !last(s, 'haulersLost'); tick++) updateGame(s, .05);
  const event = last(s, 'haulersLost'), dead = haulers.find(h => h.id === event?.entityId);
  assert(dead && !getEntity(s, dead.id), 'The event names a destroyed hauler');
  assert(haulers.every(h => !getEntity(s, h.id)), 'Every hauler is gone when the notice arrives');
  assert.deepEqual([event.team, event.role, event.text], [0, 'harvester', 'All haulers lost. Train a new one at the refinery.']);
  assert.equal(s.events.filter(e => e.kind === 'haulersLost').length, 1, 'The notice fires once');
});

for (const [outcome, loser] of [['victory', 1], ['defeat', 0]]) {
  test(`destroying the ${loser ? 'hostile' : 'friendly'} nexus emits a team-wide ${outcome} event`, () => {
    const s = quiet(`typed-${outcome}`), core = s.entities.find(e => e.team === loser && entityRole(e) === 'core');
    assert(!s.entities.some(e => e.team === loser && entityRole(e) === 'constructor'), 'No construction vehicle keeps the claim alive');
    ambush(s, [core], 1 - loser);
    for (let tick = 0; tick < 200 && s.status === 'playing'; tick++) updateGame(s, .05);
    assert.equal(s.status, outcome);
    const event = last(s, outcome);
    assert.equal(event.team, 0, 'Outcome notices address the player'); assertUnlocated(event, outcome);
    assert.equal(event.text, outcome === 'victory' ? 'All hostile nexuses and construction vehicles destroyed. Sector secured.' : 'All nexuses and construction vehicles lost. Operation failed.');
    assert.equal(s.events.filter(e => e.kind === 'victory' || e.kind === 'defeat').length, 1, 'The outcome is announced once');
  });
}
