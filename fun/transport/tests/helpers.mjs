import assert from 'node:assert/strict';
import { createGame, build, addRoute, addRouteVehicle } from '../model.js';
import { placeBuildingSite, buildingAt } from '../building-sites.js';
import { residentialKind, commercialKind } from '../buildings.js';
import { housingCapacity } from '../settlements.js';

export function emptyGame(biome = 'taiga') {
  const game = createGame({ biome, size: 'regional', seed: 1847 });
  for (const tile of game.tiles) Object.assign(tile, {
    terrain: biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass',
    detail: '', elevation: .25, publicRoad: false,
    road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null,
  });
  for (const tile of game.tiles) delete tile.terrainObject;
  for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) game[key] = [];
  game.money = 1_000_000;
  game.revision++;
  if (game.networkRevision !== undefined) game.networkRevision++;
  return game;
}

export const tileAt = (game, x, y) => game.tiles[y * game.width + x];
export const line = (x1, x2, y) => Array.from({ length: x2 - x1 + 1 }, (_, index) => ({ x: x1 + index, y }));
export const advance = (game, days, tick) => { for (let n = 0; n < days * 4; n++) tick(game, .25); };

// Frame partitions must match a whole tick to floating-point precision.
export function equivalent(actual, expected, path = 'game') {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-9, `${path}: ${actual} != ${expected}`); return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual), Object.keys(expected), path);
    for (const key of Object.keys(actual)) equivalent(actual[key], expected[key], `${path}.${key}`);
    return;
  }
  assert.equal(actual, expected, path);
}

// Two grass towns 40 tiles apart on a public street grid out to radius 9: homes on 70% of the plots
// within radius 5 (a fixed hash picks level 1 or 2, and one in nine is a level-1 shop), a main road
// between them, a stop beside each centre and one bus. Used by the town market tests.
export function twoTownFixture({ buses = 1, dist = 40 } = {}) {
  const game = emptyGame('taiga');
  const street = points => { for (const p of points) Object.assign(tileAt(game, p.x, p.y), { road: true, publicRoad: true }); };
  const town = (id, name, cx, cy, seed) => {
    const city = { id, name, x: cx, y: cy, population: 0, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null };
    game.cities.push(city);
    for (let d = -9; d <= 9; d += 3) { street(line(cx - 9, cx + 9, cy + d)); street(Array.from({ length: 19 }, (_, i) => ({ x: cx + d, y: cy - 9 + i }))); }
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = cx + dx, y = cy + dy, tile = tileAt(game, x, y), r = ((x * 73856093) ^ (y * 19349663) ^ seed) >>> 0;
      if (tile.road || buildingAt(game, x, y) || (!dx && !dy) || r % 10 < 3) continue;
      const shop = (r >>> 8) % 9 === 0, level = shop ? 1 : 1 + (r >>> 4) % 2, kind = shop ? commercialKind(tile.variant, 1) : residentialKind(tile.variant, level), building = { kind, level };
      if (!shop) building.populationCityId = id;
      if (placeBuildingSite(game, kind, x, y, { size: 1, building }) && !shop) city.population += housingCapacity(building);
    }
    city.passengers = city.population * .1;
    return city;
  };
  const A = town('city-a', 'Ashford', 24, 48, 1), B = town('city-b', 'Brookby', 24 + dist, 48, 2);
  street(line(A.x, B.x, 48));
  game.networkRevision++; game.revision++;
  const sa = build(game, 'bus-stop', A.x + 1, A.y).station, sb = build(game, 'bus-stop', B.x - 1, B.y).station;
  const route = addRoute(game, { mode: 'road', stops: [sa.id, sb.id], cargo: 'passengers' }).route;
  for (let n = 1; n < buses; n++) addRouteVehicle(game, route.id);
  game.money = 1_000_000;
  return { game, A, B, sa, sb, route };
}
