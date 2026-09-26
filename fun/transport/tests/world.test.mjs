import test from 'node:test';
import assert from 'node:assert/strict';
import { BIOMES, INDUSTRIES, CARGO, createGame, findPath, tick } from '../model.js';

for (const biome of ['taiga', 'tundra', 'desert']) {
  test(`${biome} generates a complete, deterministic and playable world`, () => {
    assert.ok(BIOMES[biome]);
    const game = createGame({ biome, seed: 1847 });
    const repeat = createGame({ biome, seed: 1847 });
    assert.equal(game.biome, biome);
    assert.equal(game.tiles.length, game.width * game.height);
    assert.deepEqual(game.tiles, repeat.tiles);
    assert.deepEqual(game.cities, repeat.cities);
    assert.notDeepEqual(game.tiles, createGame({ biome, seed: 7193 }).tiles);
    assert.ok(game.cities.length >= 3);
    assert.ok(game.industries.length >= 3);
    assert.ok(game.money > 0 && Number.isFinite(game.money));
    const terrain = new Set(game.tiles.map(tile => tile.terrain));
    for (const kind of ['water', 'forest', 'mountain', 'rock']) {
      assert.ok(terrain.has(kind), `${biome} contains ${kind}`);
    }
    for (const industry of game.industries) {
      assert.ok(INDUSTRIES[industry.kind], `known industry ${industry.kind}`);
      assert.ok(INDUSTRIES[industry.kind].biomes.includes(biome));
      assert.ok(industry.x >= 0 && industry.x < game.width);
      assert.ok(industry.y >= 0 && industry.y < game.height);
    }
    for (const route of game.routes) {
      const [from, to] = route.stops.map(id => game.stations.find(station => station.id === id));
      assert.ok(from && to);
      const path = findPath(game, from, to, route.mode);
      assert.ok(path && path.length > 1, 'starter route uses connected infrastructure');
      assert.ok(game.vehicles.some(vehicle => vehicle.routeId === route.id));
    }
    assert.ok(game.routes.some(route => route.cargo === 'passengers'));
    assert.doesNotThrow(() => JSON.stringify(game));
  });

  test(`${biome} starter network delivers passengers and sustains its economy`, () => {
    const game = createGame({ biome, seed: 1847 });
    const start = { money: game.money, revenue: game.totalRevenue, delivered: game.totalDelivered };
    for (let quarter = 0; quarter < 480; quarter++) tick(game, .25);
    assert.ok(game.totalDelivered > start.delivered, 'vehicles deliver passengers');
    assert.ok(game.totalRevenue > start.revenue, 'deliveries earn revenue');
    assert.ok(game.money > start.money, 'starter service is profitable over 120 days');
    for (const vehicle of game.vehicles) {
      assert.ok(Number.isFinite(vehicle.x) && Number.isFinite(vehicle.y));
      assert.ok(vehicle.x >= 0 && vehicle.x < game.width);
      assert.ok(vehicle.y >= 0 && vehicle.y < game.height);
      assert.ok(vehicle.load >= 0 && vehicle.load <= vehicle.capacity);
    }
  });
}

test('every production recipe references supported cargo and has an available source', () => {
  for (const [kind, industry] of Object.entries(INDUSTRIES)) {
    assert.ok(industry.cost > 0, `${kind} has a construction price`);
    for (const [cargo, count] of Object.entries({ ...industry.inputs, ...industry.outputs })) {
      assert.ok(CARGO[cargo], `${kind} references registered ${cargo}`);
      assert.ok(count > 0, `${kind} has a positive ${cargo} quantity`);
    }
    for (const biome of industry.biomes) {
      for (const cargo of Object.keys(industry.inputs)) {
        assert.ok(Object.values(INDUSTRIES).some(source => source.biomes.includes(biome) && source.outputs[cargo] > 0),
          `${biome} can produce ${cargo} for ${kind}`);
      }
    }
  }
});
