import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, build, buildPath, addRoute, tick, priceFor, inflationInfo, constructionCost, getVehiclePurchase, hasClearableDecoration, BUILD_COSTS, VEHICLE_COSTS, CARGO } from '../model.js';
import { emptyGame, tileAt, line } from './helpers.mjs';

const yearDay = year => (Date.UTC(year, 0, 1) - Date.UTC(1950, 0, 1)) / 86400000;

test('inflation is seeded, compounds annually, and retains all base-year prices', () => {
  const game = { seed: 1847, day: 0 }, repeat = { ...game }, other = { seed: 94672, day: 0 };
  assert.deepEqual(inflationInfo(game), { year: 1950, yearIndex: 0, rate: 0, index: 1 });
  for (const price of [...Object.values(BUILD_COSTS), ...Object.values(VEHICLE_COSTS)]) assert.equal(priceFor(game, price), price);
  let index = 1; const rates = [], alternatives = [];
  for (let year = 1951; year <= 1960; year++) {
    game.day = repeat.day = other.day = yearDay(year);
    const info = inflationInfo(game); index *= 1 + info.rate;
    assert.ok(info.rate >= .01 && info.rate <= .05); assert.equal(info.index, index);
    assert.deepEqual(inflationInfo(repeat), info); assert.equal(priceFor(game, 18000), Math.round(18000 * index));
    rates.push(info.rate); alternatives.push(inflationInfo(other).rate);
  }
  assert.notDeepEqual(rates, alternatives);
  game.day = 0; assert.equal(inflationInfo(game).index, 1, 'loading an earlier year does not keep a later cached index');
  game.day = 100_000_000;
  assert.ok(Number.isFinite(inflationInfo(game).index)); assert.ok(priceFor(game, 1e12) <= 1e12, 'far-future quotes stay financially bounded');
});

test('all construction types and clearing surcharges use current inflation', () => {
  const game = emptyGame(); game.day = yearDay(1955);
  const check = (tool, x, y, base = BUILD_COSTS[tool]) => {
    assert.equal(constructionCost(game, tool, x, y), priceFor(game, base), `${tool} preview`);
    const before = game.money, result = build(game, tool, x, y);
    assert.equal(result.ok, true, `${tool}: ${result.message}`);
    assert.equal(result.cost, priceFor(game, base), tool); assert.equal(game.money, before - result.cost);
  };
  check('road', 10, 10); check('bus-stop', 10, 10);
  check('rail', 20, 10); check('train-stop', 20, 10);
  Object.assign(tileAt(game, 30, 10), { terrain: 'water', detail: 'river' }); check('bridge', 30, 10);
  Object.assign(tileAt(game, 40, 10), { terrain: 'water', detail: 'river' }); check('port', 40, 10);
  Object.assign(tileAt(game, 50, 10), { terrain: 'mountain' }); check('railtunnel', 50, 10);
  check('logging-camp', 60, 10); check('residential', 70, 10); check('city', 80, 10);
  Object.assign(tileAt(game, 90, 10), { terrain: 'forest', detail: 'pine' }); check('road', 90, 10, BUILD_COSTS.road + 80);
  Object.assign(tileAt(game, 91, 10), { terrain: 'rock', detail: 'glacial' }); check('road', 91, 10, BUILD_COSTS.road + 100);
  Object.assign(tileAt(game, 92, 10), { terrain: 'rock', detail: 'glacial' }); check('tunnel', 92, 10);
  for (const [tool, x] of [['road', 91], ['bridge', 30], ['railtunnel', 50], ['tunnel', 92]]) {
    assert.equal(constructionCost(game, tool, x, 10), 0, 'an existing connection previews no charge');
    assert.equal(build(game, tool, x, 10).cost, 0);
  }
  check('bulldoze', 90, 10);
  const pathGame = emptyGame(); pathGame.day = yearDay(1955);
  const tileCost = priceFor(pathGame, BUILD_COSTS.road); pathGame.money = tileCost * 2 - 1;
  const path = buildPath(pathGame, 'road', line(10, 12, 20));
  assert.equal(path.built, 1); assert.equal(path.cost, tileCost); assert.equal(pathGame.money, tileCost - 1);
});

test('delivery fares crossing New Year use the arrival year and keep pace with prices', () => {
  const game = emptyGame();
  build(game, 'logging-camp', 10, 10); build(game, 'sawmill', 30, 10);
  buildPath(game, 'road', line(10, 30, 12));
  build(game, 'bus-stop', 10, 12); build(game, 'bus-stop', 30, 12);
  game.industries[0].inventory.timber = 100;
  const { route } = addRoute(game, { mode: 'road', cargo: 'timber', stops: game.stations.map(stop => stop.id) });
  game.day = 364.99;
  const vehicle = game.vehicles[0]; vehicle.progress = 19.9; vehicle.x = 29.9; vehicle.y = 12;
  const amount = vehicle.load, baseFare = amount * CARGO.timber.price * (1 + Math.sqrt(20) * .55);
  tick(game, .25);
  assert.equal(route.delivered, amount);
  assert.equal(route.revenue, priceFor(game, baseFare));
  assert.ok(route.revenue > Math.round(baseFare), 'the fare changes after January 1, alongside costs');
});

test('daily upkeep scales with inflation rather than staying at original nominal prices', () => {
  const base = createGame({ size: 'regional', seed: 1847 }), later = structuredClone(base);
  later.day = yearDay(2050);
  const oldExpenses = base.totalExpenses, newExpenses = later.totalExpenses;
  tick(base, 1); tick(later, 1);
  const index = inflationInfo(later).index, early = base.totalExpenses - oldExpenses, late = later.totalExpenses - newExpenses;
  assert.ok(index > 10);
  assert.ok(late > early * index * .5 && late < early * index * 2, 'weather may vary, but nominal upkeep follows the price index');
  assert.ok(getVehiclePurchase(later, 'road').cost > VEHICLE_COSTS.road * index, 'newer generations also affect vehicle purchase prices');
});

test('bulldozer clears decorative plants on land while retaining rivers, mountains and protected structures', () => {
  const game = emptyGame(); game.day = 730;
  for (const [index, [terrain, detail]] of [['grass', 'wildflowers'], ['grass', 'shrubs'], ['snow', 'reeds'], ['sand', 'cactus'], ['forest', 'pine'], ['rock', 'glacial']].entries()) {
    const x = 10 + index, tile = tileAt(game, x, 10); Object.assign(tile, { terrain, detail });
    assert.equal(hasClearableDecoration(tile), true);
    const before = game.money, cleared = build(game, 'bulldoze', x, 10);
    assert.equal(cleared.ok, true); assert.equal(tile.detail, ''); assert.equal(cleared.cost, priceFor(game, 100));
    assert.equal(game.money, before - cleared.cost);
    assert.equal(build(game, 'bulldoze', x, 10).ok, false, 'an empty parcel cannot be charged again');
  }
  Object.assign(tileAt(game, 20, 10), { terrain: 'water', detail: 'river' });
  Object.assign(tileAt(game, 21, 10), { terrain: 'mountain', detail: 'glacial' });
  assert.equal(hasClearableDecoration(tileAt(game, 20, 10)), false);
  assert.equal(build(game, 'bulldoze', 20, 10).ok, false); assert.equal(build(game, 'bulldoze', 21, 10).ok, false);
  assert.equal(build(game, 'bridge', 20, 10).ok, true); assert.equal(build(game, 'bulldoze', 20, 10).ok, true);
  assert.equal(tileAt(game, 20, 10).detail, 'river'); assert.equal(tileAt(game, 21, 10).terrain, 'mountain');
  assert.equal(build(game, 'city', 40, 10).ok, true); assert.equal(build(game, 'bulldoze', 40, 10).ok, false);
});
