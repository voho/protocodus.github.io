import test from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRIES, createGame, build, buildPath, addRoute, tick, validateGame } from '../model.js';
import { localEnvironment, stepEcology, weatherAt } from '../environment.js';
import { settlementSuitability } from '../settlements.js';
import { emptyGame, tileAt, line } from './helpers.mjs';

function state(game) {
  const copy = structuredClone(game);
  delete copy.maintenanceRevision;
  for (const route of copy.routes) delete route.pathRevision;
  return copy;
}

function approximatelyEqual(actual, expected, path = 'state') {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10,
      `${path}: ${actual} differs from ${expected}`);
    return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path} keys`);
    for (const key of Object.keys(actual)) approximatelyEqual(actual[key], expected[key], `${path}.${key}`);
    return;
  }
  assert.equal(actual, expected, path);
}

test('a seeded simulation has the same future regardless of frame partitioning', () => {
  const whole = createGame({ size: 'regional', seed: 27619 });
  const quarters = structuredClone(whole), irregular = structuredClone(whole);
  tick(whole, 90);
  for (let n = 0; n < 360; n++) tick(quarters, .25);
  for (let n = 0; n < 60; n++) for (const step of [.125, .375, .0625, .9375]) tick(irregular, step);
  approximatelyEqual(state(quarters), state(whole));
  approximatelyEqual(state(irregular), state(whole));
});

test('vehicles competing for scarce cargo arrive in the same order at every simulation speed', () => {
  const whole = emptyGame();
  for (const [kind, x, y] of [['logging-camp', 10, 10], ['sawmill', 20, 10], ['sawmill', 30, 10]]) assert.equal(build(whole, kind, x, y).ok, true);
  assert.equal(buildPath(whole, 'road', line(10, 30, 12)).ok, true);
  for (const x of [10, 20, 30]) assert.equal(build(whole, 'bus-stop', x, 12).ok, true);
  whole.industries[0].inventory.timber = 60;
  for (const [index, destination] of [1, 2, 1].entries()) {
    assert.equal(addRoute(whole, { name: `Shared supply ${index}`, mode: 'road', stops: [whole.stations[0].id, whole.stations[destination].id], cargo: 'timber' }).ok, true);
  }
  const quarters = structuredClone(whole), irregular = structuredClone(whole);
  tick(whole, 120);
  for (let n = 0; n < 480; n++) tick(quarters, .25);
  for (let n = 0; n < 80; n++) for (const step of [.125, .375, .0625, .9375]) tick(irregular, step);
  approximatelyEqual(state(quarters), state(whole));
  approximatelyEqual(state(irregular), state(whole));
  assert.ok(whole.routes.every(route => route.delivered > 0), 'all three services actually share the finite supply');
});

test('simulation randomness is reproducible, seed-sensitive and independent of Math.random', () => {
  const first = createGame({ size: 'regional', seed: 27619 });
  const repeat = structuredClone(first), otherSeed = structuredClone(first);
  otherSeed.seed = 91377;
  const original = Math.random;
  Math.random = () => { throw new Error('Simulation must use saved, seeded randomness'); };
  try {
    tick(first, 120); tick(repeat, 120); tick(otherSeed, 120);
  } finally { Math.random = original; }
  assert.deepEqual(state(repeat), state(first));
  assert.notDeepEqual(otherSeed.industries.map(industry => industry.totalProduced), first.industries.map(industry => industry.totalProduced),
    'an identical world with a different seed must have different production history');
  assert.notDeepEqual(otherSeed.cities.map(city => city.passengers), first.cities.map(city => city.passengers),
    'daily passenger arrivals have seeded variation too');
});

test('randomized complex production preserves every recipe ratio and waits for missing inputs', () => {
  const recipes = Object.entries(INDUSTRIES).filter(([, definition]) => Object.keys(definition.inputs).length > 1);
  for (const [kind, definition] of recipes) {
    const game = emptyGame(definition.biomes[0]);
    assert.equal(build(game, kind, 20, 20).ok, true);
    const industry = game.industries[0];
    const inputs = Object.entries(definition.inputs), outputs = Object.entries(definition.outputs);
    const missing = inputs.at(-1)[0];
    for (const [cargo, amount] of inputs) industry.inventory[cargo] = cargo === missing ? 0 : 50 * amount;
    const before = { ...industry.inventory };
    tick(game, 20);
    assert.deepEqual(industry.inventory, before, `${kind} waits without wasting ingredients`);
    industry.inventory[missing] = definition.inputs[missing] * 50;
    tick(game, 100);
    const batches = industry.inventory[outputs[0][0]] / outputs[0][1];
    assert.ok(batches > 0, `${kind} eventually works with a complete recipe`);
    for (const [cargo, amount] of inputs) {
      assert.ok(Math.abs(50 * amount - industry.inventory[cargo] - batches * amount) < 1e-7, `${kind} conserves ${cargo}`);
    }
    for (const [cargo, amount] of outputs) {
      assert.ok(Math.abs(industry.inventory[cargo] - batches * amount) < 1e-7, `${kind} produces the ${cargo} recipe quantity`);
    }
    for (const quantity of Object.values(industry.inventory)) assert.ok(Number.isFinite(quantity) && quantity >= 0);
    assert.equal(validateGame(game), true, `${kind} leaves a valid save`);
  }
});

test('a year on a huge map keeps inventories, vehicles and simulation work bounded', () => {
  const game = createGame({ size: 'huge', seed: 91377 });
  const started = performance.now();
  tick(game, 365);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 12_000, `365 simulation days took ${Math.round(elapsed)}ms`);
  assert.equal(game.day, 365);
  assert.equal(validateGame(game), true);
  for (const industry of game.industries) {
    for (const quantity of Object.values(industry.inventory)) assert.ok(quantity >= 0 && quantity <= 2700 + 1e-8);
    assert.ok(industry.capacity >= .5 && industry.capacity <= 3);
  }
  for (const vehicle of game.vehicles) {
    assert.ok(vehicle.load >= 0 && vehicle.load <= vehicle.capacity);
    assert.ok(Number.isFinite(vehicle.x) && Number.isFinite(vehicle.y));
  }
});

test('forests increase a logging camp’s actual output in otherwise identical worlds', () => {
  const open = emptyGame();
  assert.equal(build(open, 'logging-camp', 20, 20).ok, true);
  const forest = structuredClone(open);
  for (let y = 17; y <= 23; y++) for (let x = 17; x <= 23; x++) {
    if (x !== 20 || y !== 20) Object.assign(tileAt(forest, x, y), { terrain: 'forest', detail: 'pine' });
  }
  forest.revision++;
  tick(open, 120); tick(forest, 120);
  assert.ok(forest.industries[0].totalProduced > open.industries[0].totalProduced * 1.1,
    'nearby resources materially change production rather than only changing an inspector score');
});

test('local road access, community services, greenery and industry affect residential suitability', () => {
  const game = emptyGame(), point = { x: 22, y: 20 };
  assert.equal(build(game, 'city', 20, 20).ok, true);
  const baseline = settlementSuitability(game, point).score;
  tileAt(game, 22, 21).road = true; game.revision++;
  const access = settlementSuitability(game, point).score;
  assert.ok(access > baseline, 'adjacent roads improve an isolated plot');
  tileAt(game, 21, 20).building = { kind: 'school', level: 1 };
  tileAt(game, 23, 20).building = { kind: 'hospital', level: 1 }; game.revision++;
  const civic = settlementSuitability(game, point).score;
  assert.ok(civic > access, 'community structures improve their neighbors');
  for (let y = 18; y <= 22; y++) for (let x = 20; x <= 24; x++) {
    const tile = tileAt(game, x, y);
    if (!tile.building && !tile.road) tile.terrain = 'forest';
  }
  game.revision++;
  const green = settlementSuitability(game, point).score;
  assert.ok(green > civic, 'trees improve the local living environment');
  game.industries.push({ id: 'polluter', kind: 'steel-mill', x: 23, y: 19 }); game.revision++;
  assert.ok(settlementSuitability(game, point).score < green, 'nearby heavy industry discourages housing');
  const e = localEnvironment(game, point.x, point.y);
  assert.ok(e.roadAccess && e.school === 1 && e.hospital === 1 && e.forest > 0 && e.pollution > 0);
});

function ecologyFixture(biome) {
  const game = { seed: 1847, biome, width: 64, height: 48, day: 0, revision: 0, networkRevision: 7,
    cities: [], industries: [], stations: [], routes: [], zones: [], tiles: [] };
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
    const terrain = x >= 31 && x <= 36 && y >= 15 && y <= 29 ? 'forest' : x >= 25 && x <= 29 && y >= 15 && y <= 29 ? 'water' : biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass';
    game.tiles.push({ terrain, detail: terrain === 'forest' ? 'pine' : '', elevation: .2, variant: (x + y) % 7,
      road: false, rail: false, bridge: false, tunnel: false, publicRoad: false, building: null, zone: null });
  }
  return game;
}

for (const biome of ['taiga', 'tundra', 'desert']) test(`${biome} ecology spreads locally in slow, buffered steps and protects occupied terrain`, () => {
  const game = ecologyFixture(biome), protectedIndexes = [];
  const protect = (x, changes) => {
    const index = 20 * game.width + x;
    Object.assign(game.tiles[index], changes, { detail: 'protected' }); protectedIndexes.push(index);
  };
  protect(30, { road: true }); protect(31, { rail: true }); protect(32, { bridge: true }); protect(33, { tunnel: true });
  protect(34, { publicRoad: true }); protect(35, { building: { kind: 'house-cheap-1', level: 1 } }); protect(36, { zone: 'residential' });
  for (const [index, kind] of ['industries', 'stations', 'cities', 'zones'].entries()) {
    const x = 30 + index;
    game[kind].push({ id: `${kind}-protected`, x, y: 21 });
    protectedIndexes.push(21 * game.width + x);
  }
  protect(37, { terrain: 'mountain' }); protect(38, { terrain: 'rock' }); protect(39, { terrain: 'water' });
  const protectedState = protectedIndexes.map(index => structuredClone(game.tiles[index]));
  let changes = 0, spread = 0;
  for (let day = 1; day <= 360; day++) {
    const previous = game.tiles.map(tile => tile.terrain), revision = game.revision;
    game.day = day;
    const count = stepEcology(game);
    assert.ok(count <= Math.ceil(game.tiles.length / 128), 'one sparse sample per day bounds work and change');
    assert.equal(game.revision, revision + Number(count > 0));
    assert.equal(game.networkRevision, 7, 'visual succession does not invalidate transport infrastructure');
    changes += count;
    for (let index = 0; index < previous.length; index++) {
      if (previous[index] === 'forest' || game.tiles[index].terrain !== 'forest') continue;
      const x = index % game.width, y = Math.floor(index / game.width);
      assert.ok([-1, 0, 1].some(dy => [-1, 0, 1].some(dx =>
        (dx || dy) && x + dx >= 0 && x + dx < game.width && y + dy >= 0 && y + dy < game.height && previous[(y + dy) * game.width + x + dx] === 'forest')),
      'new trees require a pre-existing neighbor, so a whole forest cannot cascade during one update');
      spread++;
    }
  }
  assert.ok(changes > 0 && spread > 0, 'the living landscape eventually changes and spreads');
  assert.deepEqual(protectedIndexes.map(index => game.tiles[index]), protectedState);
});

test('weather varies slowly over place and time, and visual growth preserves route and upkeep caches', () => {
  const game = createGame({ size: 'regional', seed: 8314 });
  const first = weatherAt(game, 20, 20, 0), nearby = weatherAt(game, 21, 20, 0), nextDay = weatherAt(game, 20, 20, 1);
  assert.notDeepEqual(first, weatherAt(game, 20, 20, 50));
  for (const key of ['wetness', 'cold', 'heat', 'growth', 'travel']) {
    assert.ok(Math.abs(first[key] - nearby[key]) < .2);
    assert.ok(Math.abs(first[key] - nextDay[key]) < .2);
  }
  tick(game, 1);
  const path = game.routes[0].path, networkRevision = game.networkRevision, maintenanceRevision = game.maintenanceRevision, revision = game.revision;
  tick(game, 60);
  assert.ok(game.revision > revision, 'terrain or settlement appearances change during the interval');
  assert.equal(game.networkRevision, networkRevision);
  assert.equal(game.maintenanceRevision, maintenanceRevision, 'nature does not trigger a full-map infrastructure recount');
  assert.equal(game.routes[0].path, path, 'unchanged networks retain their existing path instead of rerunning pathfinding');
});
