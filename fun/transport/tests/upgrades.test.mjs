import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, addRoute, removeRoute, tick, validateGame, restoreGame, getVehiclePurchase, getVehicleUpgrade, getFleetUpgrade, upgradeRouteVehicle, upgradeFleet, inflationInfo, priceFor, VEHICLE_COSTS } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { VEHICLE_CAPACITIES } from '../data.js';
import { validateRoutePlan } from '../route-planner.js';
import { emptyGame, tileAt, line } from './helpers.mjs';

const yearDay = year => (Date.UTC(year, 0, 1) - Date.UTC(1950, 0, 1)) / 86400000;
const movement = vehicle => Object.fromEntries(['load', 'x', 'y', 'progress', 'direction', 'dwellRemaining', 'totalDistance', 'tripSerial', 'angle'].map(key => [key, vehicle[key]]));

function fleetFixture(modes = ['road']) {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 10).ok, true);
  assert.equal(build(game, 'sawmill', 30, 10).ok, true);
  game.industries[0].inventory.timber = 900;
  for (const [index, mode] of modes.entries()) {
    const y = 12 + index;
    if (mode === 'water') {
      for (const point of line(10, 30, y)) Object.assign(tileAt(game, point.x, point.y), { terrain: 'water', detail: 'river', elevation: 0 });
      game.revision++; game.networkRevision++;
    } else assert.equal(buildPath(game, mode, line(10, 30, y)).ok, true);
    const tool = { road: 'bus-stop', rail: 'train-stop', water: 'port' }[mode];
    const stops = [];
    for (const x of [10, 30]) { const built = build(game, tool, x, y); assert.equal(built.ok, true, built.message); stops.push(built.station.id); }
    const launched = addRoute(game, { name: `${mode} freight`, mode, cargo: 'timber', stops });
    assert.equal(launched.ok, true, launched.message);
  }
  return game;
}

test('vehicle generations unlock on Gregorian January 1, including leap years', () => {
  const game = fleetFixture();
  for (const [day, level, year] of [[0, 0, 1950], [364.999, 0, 1950], [365, 1, 1951], [729.999, 1, 1951], [730, 2, 1952], [1095.999, 2, 1952], [1096, 3, 1953]]) {
    game.day = day;
    assert.equal(getVehiclePurchase(game, 'road').level, level);
    assert.equal(getVehicleUpgrade(game, game.routes[0].id).targetLevel, level);
    assert.equal(inflationInfo(game).year, year);
  }
});

for (const mode of ['road', 'rail', 'water']) {
  test(`${mode} upgrades preserve an in-flight vehicle and improve real capacity and speed`, () => {
    const game = fleetFixture([mode]); tick(game, .75); game.day = 365;
    const route = game.routes[0], vehicle = game.vehicles[0], before = movement(vehicle), money = game.money;
    const quote = getVehicleUpgrade(game, route.id), original = structuredClone(game);
    assert.equal(quote.available, true); assert.equal(quote.level, 0); assert.equal(quote.targetLevel, 1);
    assert.equal(quote.cost, priceFor(game, VEHICLE_COSTS[mode] * .4));
    assert.equal(quote.nextCapacity, Math.round(VEHICLE_CAPACITIES[mode] * 1.2));
    assert.equal(quote.nextSpeedMultiplier, 1.1);
    assert.equal(upgradeRouteVehicle(game, route.id).ok, true);
    assert.deepEqual(movement(vehicle), before, 'cargo, position, trip direction and loading wait stay intact');
    assert.equal(game.money, money - quote.cost); assert.equal(vehicle.capacity, quote.nextCapacity); assert.equal(vehicle.level, 1);
    assert.equal(vehicle.paidPrice, VEHICLE_COSTS[mode] + quote.cost);
    const paid = game.money;
    assert.equal(upgradeRouteVehicle(game, route.id).ok, false); assert.equal(game.money, paid, 'cannot rebuy the same generation');
    // Keep both vehicles within one segment; neighboring tiles can have a
    // different grade, climate, bridge speed or water-channel width.
    tick(game, .001); tick(original, .001);
    const boosted = vehicle.progress - before.progress, ordinary = original.vehicles[0].progress - before.progress;
    assert.ok(Math.abs(boosted / ordinary - 1.1) < 1e-9, `the displayed speed gain changes simulation movement: ${before.progress}, ${boosted}, ${ordinary}, ratio ${boosted / ordinary}`);
  });
}

test('bulk fleet upgrades preflight the entire cost and update every mode atomically', () => {
  const game = fleetFixture(['road', 'rail', 'water']); game.day = 730;
  const quote = getFleetUpgrade(game);
  assert.equal(quote.count, 3); assert.equal(quote.routeCount, 3); assert.equal(quote.targetLevel, 2);
  assert.equal(quote.cost, quote.routes.reduce((sum, route) => sum + route.cost, 0));
  game.money = quote.cost - 1;
  const before = structuredClone(game);
  assert.equal(upgradeFleet(game).ok, false); assert.deepEqual(game, before, 'an unaffordable bulk action makes no partial upgrade');
  assert.equal(getFleetUpgrade(game).affordable, false);
  game.money++;
  assert.equal(upgradeFleet(game).ok, true); assert.equal(game.money, 0);
  for (const vehicle of game.vehicles) {
    const route = game.routes.find(route => route.id === vehicle.routeId);
    assert.equal(vehicle.level, 2); assert.equal(vehicle.capacity, Math.round(VEHICLE_CAPACITIES[route.mode] * 1.4));
  }
  assert.equal(getFleetUpgrade(game).available, false); assert.equal(upgradeFleet(game).ok, false);
});

test('new routes buy the latest model at the same quote used by route planning', () => {
  const game = fleetFixture(['water']); game.day = 730;
  const oldRoute = game.routes[0], quote = getVehiclePurchase(game, 'water');
  const draft = { mode: 'water', cargo: 'timber', from: oldRoute.stops[0], to: oldRoute.stops[1] };
  game.money = quote.cost - 1;
  assert.equal(validateRoutePlan(game, draft).valid, false);
  assert.equal(addRoute(game, { ...draft, stops: oldRoute.stops }).ok, false);
  game.money++;
  assert.equal(validateRoutePlan(game, draft).valid, true);
  const launched = addRoute(game, { ...draft, stops: oldRoute.stops });
  assert.equal(launched.ok, true); assert.equal(game.money, 0);
  const vehicle = game.vehicles.find(vehicle => vehicle.routeId === launched.route.id);
  assert.equal(vehicle.capacity, 196); assert.equal(vehicle.level, 2); assert.equal(vehicle.paidPrice, quote.cost);
  assert.equal(getVehicleUpgrade(game, launched.route.id).available, false);
});

test('upgrades persist through saves, migrate old vehicles, and support ships above 1000 capacity', () => {
  const game = fleetFixture(['water']); game.day = yearDay(1985); game.money = 10_000_000;
  assert.equal(upgradeFleet(game).ok, true); assert.equal(game.vehicles[0].level, 35); assert.equal(game.vehicles[0].capacity, 1120);
  assert.equal(validateGame(game), true);
  const loaded = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(loaded); assert.equal(loaded.vehicles[0].level, 35); assert.equal(loaded.vehicles[0].paidPrice, game.vehicles[0].paidPrice);
  assert.deepEqual(getVehicleUpgrade(loaded, loaded.routes[0].id), getVehicleUpgrade(game, game.routes[0].id));
  const legacy = fleetFixture(['rail']);
  delete legacy.vehicles[0].level; delete legacy.vehicles[0].paidPrice;
  const migrated = restoreGame(structuredClone(legacy));
  assert.equal(migrated.vehicles[0].level, 0); assert.equal(migrated.vehicles[0].paidPrice, VEHICLE_COSTS.rail);
  assert.equal(migrated.vehicles[0].capacity, 90);
  for (const change of [{ level: -1 }, { level: 36 }, { level: 1.5 }, { paidPrice: NaN }]) {
    const invalid = structuredClone(game); Object.assign(invalid.vehicles[0], change); assert.equal(validateGame(invalid), false);
  }
});

test('retirement refunds the paid vehicle and upgrades without creating profit from inflation', () => {
  const game = fleetFixture(['rail']); game.day = 365;
  assert.equal(upgradeFleet(game).ok, true);
  const paid = game.vehicles[0].paidPrice;
  game.day = yearDay(1960);
  assert.equal(removeRoute(game, game.routes[0].id).refund, Math.round(paid * .45));
  const legacy = fleetFixture(['road']); delete legacy.vehicles[0].paidPrice;
  legacy.day = yearDay(1960);
  assert.equal(removeRoute(legacy, legacy.routes[0].id).refund, 8100);
});
