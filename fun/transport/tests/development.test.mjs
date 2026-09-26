import test from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRIES, createGame, build, tick } from '../model.js';
import { RESIDENTIAL_KINDS, SHOP_KINDS, SERVICE_KINDS } from '../buildings.js';
import { emptyGame, tileAt, advance } from './helpers.mjs';

test('every environment-specific industry can be built on its supported terrain', () => {
  for (const biome of ['taiga', 'tundra', 'desert']) {
    for (const [kind, definition] of Object.entries(INDUSTRIES)) {
      const game = emptyGame(biome);
      const tile = tileAt(game, 20, 20);
      if (definition.terrain) tile.terrain = definition.terrain[0];
      if (definition.coastal) tileAt(game, 22, 20).terrain = 'water';
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
    advance(game, 180, tick);
    const developed = tileAt(game, x, y).building;
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
