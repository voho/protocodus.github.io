import test from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRIES, createGame, build, buildPath, addRoute, tick, validateGame, restoreGame, settlementSuitability } from '../model.js';
import { BUILDINGS, RESIDENTIAL_KINDS, SHOP_KINDS, SERVICE_KINDS, residentialKind } from '../buildings.js';
import { stepSettlements, townNeeds } from '../settlements.js';
import { constructionDuration, stepBuildingConstruction } from '../building-construction.js';
import { encodeGame } from '../save-codec.js';
import { emptyGame, tileAt, advance, line, completeFixtureConstruction } from './helpers.mjs';

test('every environment-specific industry can be built on its supported terrain', () => {
  for (const biome of ['taiga', 'tundra', 'desert']) {
    for (const [kind, definition] of Object.entries(INDUSTRIES)) {
      const game = emptyGame(biome);
      const tile = tileAt(game, 20, 20);
      if (definition.terrain) tile.terrain = definition.terrain[0];
      if (definition.coastal) tileAt(game, 25, 20).terrain = 'water';
      const before = game.money;
      const result = build(game, kind, 20, 20);
      if (definition.biomes.includes(biome)) {
        assert.equal(result.ok, true, `${biome} ${kind}: ${result.message}`);
        assert.equal(game.industries.length, 1);
        assert.equal(game.industries[0].kind, kind);
        assert.equal(game.money, before - definition.cost);
      } else {
        assert.equal(result.ok, false, `${kind} is unavailable in ${biome}`);
        assert.equal(game.money, before);
        assert.equal(game.industries.length, 0);
      }
    }
  }
});

test('founding a town creates a named population center and spends construction funds', () => {
  const game = emptyGame();
  const before = game.money;
  const result = build(game, 'city', 25, 25);
  assert.equal(result.ok, true, result.message);
  assert.equal(game.cities.length, 1);
  assert.ok(game.cities[0].name);
  assert.ok(game.cities[0].population > 0);
  assert.equal(game.cities[0].x, 25);
  assert.equal(game.cities[0].y, 25);
  assert.ok(game.money < before);
  assert.equal(build(game, 'city', 25, 25).ok, false, 'towns cannot be founded on each other');
});

for (const [zone, buildingKind] of [['residential', RESIDENTIAL_KINDS], ['commercial', [...SHOP_KINDS, ...SERVICE_KINDS]], ['industrial', ['factory']]]) {
  test(`${zone} zoning develops alongside a served town`, () => {
    const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
    const x = game.cities[0].x + 1, y = game.cities[0].y + 1;
    Object.assign(tileAt(game, x, y), { terrain: 'grass', road: false, rail: false, building: null, zone: null });
    const result = build(game, zone, x, y);
    assert.equal(result.ok, true, result.message);
    assert.equal(tileAt(game, x, y).zone, zone);
    assert.equal(tileAt(game, x, y).building, null, 'zoning leaves development to the simulation');
    // Workshops consolidate a real 2 × 2 industrial parcel as they develop.
    const lots = zone === 'industrial' ? [[0,0],[1,0],[0,1],[1,1]] : [[0,0]];
    for (const [dx, dy] of lots.slice(1)) {
      Object.assign(tileAt(game, x + dx, y + dy), { terrain: 'grass', road: false, rail: false, building: null, zone: null });
      assert.equal(build(game, zone, x + dx, y + dy).ok, true);
    }
    advance(game, 180, tick);
    const developed = lots.map(([dx,dy]) => tileAt(game, x + dx, y + dy).building).find(building => buildingKind.includes(building?.kind));
    assert.ok(developed, 'active transport and nearby road access attract development');
    assert.ok(buildingKind.includes(developed.kind), `${zone} creates its matching building type`);
  });
}

test('a remote zone without road access remains undeveloped', () => {
  const game = emptyGame();
  assert.equal(build(game, 'residential', 25, 25).ok, true);
  advance(game, 180, tick);
  assert.equal(tileAt(game, 25, 25).building, null);
});

test('buying a route does not grow towns before its first delivery', () => {
  const game = createGame({ size: 'regional' });
  const populations = game.cities.map(city => city.population);
  advance(game, 1, tick);
  assert.equal(game.totalDelivered, 0);
  assert.deepEqual(game.cities.map(city => city.population), populations);
});

test('old town activity cannot develop neighborhoods without recent deliveries', () => {
  const game = createGame({ size: 'regional' });
  game.day = 60;
  game.lastDailyDay = 60;
  game.lastMonth = 2;
  for (const city of game.cities) Object.assign(city, { activity: 1000, delivered: 100, lastServiceDay: 0 });
  const populations = game.cities.map(city => city.population);
  const x=game.cities[0].x+1,y=game.cities[0].y+1;
  Object.assign(tileAt(game, x, y), { terrain: 'grass', road: false, rail: false, building: null, zone: null });
  assert.equal(build(game, 'residential', x, y).ok, true);
  advance(game, 5, tick);
  assert.equal(game.totalDelivered, 0, 'the first bus has not yet reached a town');
  assert.deepEqual(game.cities.map(city => city.population), populations);
  assert.equal(game.zones[0].progress, 0, 'stale activity cannot fill a zone');
});

// Ten zoned plots beside a flat town whose bus keeps arriving; only the delivered cargo differs.
// The plots sit beyond organic infill, so every 2 × 2 prestige plot stays clear.
function neighborhood(biome = 'taiga') {
  const game = emptyGame(biome);
  game.cities = [{ id: 'town', name: 'Town', x: 20, y: 20, population: 200, activity: 40, passengers: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: 0 }];
  game.stations = [{ id: 'stop', name: 'Stop', x: 20, y: 20, mode: 'road' }];
  game.routes = [{ active: true, stops: ['stop', 'stop'] }];
  for (let x = 15; x <= 25; x++) tileAt(game, x, 11).road = tileAt(game, x, 26).road = true;
  for (let n = 0; n < 10; n++) {
    const x = 16 + n % 5 * 2, y = n < 5 ? 12 : 27;
    Object.assign(tileAt(game, x, y), { zone: 'residential', variant: n % 3 });
    game.zones.push({ x, y, kind: 'residential', progress: 0 });
  }
  return game;
}
function develop(game, days, cargo = []) {
  const city = game.cities[0];
  for (let n = 0; n < days; n++) {
    game.day++; city.lastServiceDay = game.day; city.activity += 3;
    for (const key of cargo) (city.lastSupply ??= {})[key] = game.day;
    stepBuildingConstruction(game);
    stepSettlements(game);
  }
}
const lowest = game => Math.min(...game.zones.map(zone => zone.progress));
const highest = game => Math.max(...game.zones.map(zone => zone.progress));
const tiers = game => game.zones.map(zone => BUILDINGS[tileAt(game, zone.x, zone.y).building?.kind]?.tier);

test('passenger service alone still lifts zoned homes through every tier, only more slowly', () => {
  const game = neighborhood();
  develop(game, 180);
  assert.ok(lowest(game) >= 1, 'affordable homes need nothing but service');
  assert.ok(highest(game) < 2, `comfortable homes wait for food at first: ${highest(game).toFixed(2)}`);
  assert.ok(settlementSuitability(game, game.zones[0]).notes.includes('Faster with food deliveries'));
  assert.ok(!settlementSuitability(game, game.zones[0]).negative.some(text => /food/i.test(text)), 'a missing cargo is never a concern');
  develop(game, 185);
  const year = game.zones.map(zone => zone.progress);
  develop(game, 365);
  assert.ok(lowest(game) >= 2, `every plot reaches comfortable homes within two years: ${lowest(game).toFixed(2)}`);
  assert.ok(game.zones.every((zone, n) => zone.progress >= year[n]) && highest(game) > 2.2, 'and keeps rising toward prestige homes');
});

test('fresh food lifts homes to comfortable within a year; finished goods complete prestige after its building stages', () => {
  const food = neighborhood();
  develop(food, 365, ['food']);
  assert.ok(lowest(food) >= 2, `food: ${lowest(food).toFixed(2)}`);
  assert.ok(tiers(food).every(tier => tier === 'Comfortable' || tier === 'Prestige'), tiers(food).join());
  assert.ok(settlementSuitability(food, food.zones[0]).notes.every(text => !/food/.test(text)));
  for (const [biome, finished] of [['desert', 'goods'], ['taiga', 'furniture']]) {
    const game = neighborhood(biome);
    // Development still needs its supply history; each successive home also
    // spends its real construction time before the next tier can progress.
    const constructionDays = Math.max(...game.zones.map(zone => [1, 2, 3].reduce((days, level) => days + constructionDuration(residentialKind(tileAt(game, zone.x, zone.y).variant, level)), 0)));
    develop(game, 365 + constructionDays, ['food', finished]);
    assert.equal(lowest(game), 3, `${biome} food + ${finished}: ${lowest(game).toFixed(2)}`);
    assert.ok(tiers(game).every(tier => tier === 'Prestige'), `${biome}: ${tiers(game).join()}`);
    assert.ok(game.zones.every(zone => !tileAt(game, zone.x, zone.y).building.construction), 'every prestige home has completed its real building stages');
  }
});

test('stone or cement speeds construction, and a lapse only slows the next tier again', () => {
  const plain = neighborhood(), stone = neighborhood();
  develop(plain, 60); develop(stone, 60, ['stone']);
  assert.ok(stone.zones.reduce((sum, zone) => sum + zone.progress, 0) > plain.zones.reduce((sum, zone) => sum + zone.progress, 0) * 1.2);
  const lapsed = neighborhood();
  develop(lapsed, 100, ['food']);
  const before = lapsed.zones.map(zone => zone.progress);
  develop(lapsed, 200);
  assert.ok(lapsed.zones.every((zone, n) => zone.progress >= before[n]), 'progress is never taken away');
});

test('a legacy zone saved between tiers keeps its progress and still upgrades', () => {
  const game = neighborhood();
  for (const zone of game.zones.slice(1)) tileAt(game, zone.x, zone.y).zone = null;
  game.zones = [{ ...game.zones[0], progress: 2.5 }];
  tileAt(game, 16, 12).building = { kind: 'house-cheap-1', footprint: 1, level: 1, populationCityId: 'town' };
  develop(game, 60);
  assert.ok(game.zones[0].progress >= 2.5);
  assert.equal(tileAt(game, 16, 12).building.level, 2, 'the saved tier is honoured without any delivery history');
  assert.equal(BUILDINGS[tileAt(game, 16, 12).building.kind].tier, 'Comfortable');
});

test('town needs list what each biome can make, and a delivery records its day', () => {
  for (const biome of ['taiga', 'tundra', 'desert']) {
    const needs = townNeeds({ biome, day: 0 }, {});
    assert.deepEqual(needs.map(need => [need.kind, need.tier]), [['residential', 2], ['residential', 3], ['commercial', 2], ['construction', null]]);
    for (const need of needs) {
      assert.ok(need.cargo.length, `${biome} ${need.label} can be met`);
      for (const cargo of need.cargo) assert.ok(Object.values(INDUSTRIES).some(site => site.biomes.includes(biome) && site.outputs[cargo]), `${biome} makes ${cargo}`);
      assert.equal(need.met, false);
    }
  }
  assert.deepEqual(townNeeds({ biome: 'taiga', day: 0 }, {}).map(need => need.cargo), [['food'], ['furniture', 'machinery'], ['fuel'], ['stone']]);
  assert.deepEqual(townNeeds({ biome: 'desert', day: 200 }, { lastSupply: { goods: 80 } }).map(need => need.met), [false, true, true, false]);
  assert.deepEqual(townNeeds({ biome: 'desert', day: 200 }, { lastSupply: { goods: 79.5 } }).map(need => need.met), [false, false, false, false]);

  const game = emptyGame(); game.money = 400000;
  build(game, 'food-plant', 30, 8); build(game, 'city', 50, 10); buildPath(game, 'road', line(30, 50, 13));
  completeFixtureConstruction(game, game.industries[0]);
  for (const x of [30, 50]) build(game, 'bus-stop', x, 13);
  assert.equal(addRoute(game, { mode: 'road', cargo: 'food', stops: game.stations.map(stop => stop.id) }).ok, true);
  game.industries[0].inventory.food = 60;
  const city = game.cities[0], route = game.routes[0];
  assert.equal(city.lastSupply, undefined, 'a new town has no delivery history');
  for (let day = 0; day < 60 && !route.delivered; day++) tick(game, 1);
  assert.ok(route.delivered > 0);
  assert.ok(city.lastSupply.food > 0 && city.lastSupply.food <= game.day);
  assert.deepEqual(Object.keys(city.lastSupply), ['food']);
  assert.equal(townNeeds(game, city)[0].met, true);
  assert.equal(validateGame(game), true);
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(encodeGame(game)))).cities[0].lastSupply, city.lastSupply);
});

test('validation rejects a malformed delivery history', () => {
  const game = createGame({ size: 'regional' });
  game.day = 40;
  for (const lastSupply of [undefined, {}, { food: 0 }, { food: 40, stone: 12.5 }]) { game.cities[0].lastSupply = lastSupply; assert.equal(validateGame(game), true, JSON.stringify(lastSupply)); }
  for (const lastSupply of [null, [], 'food', { food: 41 }, { food: -1 }, { food: NaN }, { food: '12' }, { passengers: 3 }, { grain: 3 }]) {
    game.cities[0].lastSupply = lastSupply;
    assert.equal(validateGame(game), false, JSON.stringify(lastSupply));
  }
});
