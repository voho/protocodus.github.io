import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, addRoute, tick, passengerEndpoints, refreshRouteConnections, restoreGame, validateGame, createGame } from '../model.js';
import { calendarMonth } from '../economy-pricing.js';
import { validateRoutePlan } from '../route-planner.js';
import { stepSettlements, housingCapacity } from '../settlements.js';
import { emptyGame, line, tileAt } from './helpers.mjs';

const town = (id, x, y) => ({ id, name: id, x, y, population: 300, passengers: 100, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} versus ${expected}`);

function passengerFixture(two = false) {
  const game = emptyGame(); game.cities = [town('west', 10, 10), town('east', 30, 10)];
  buildPath(game, 'road', line(10, 30, 12)); build(game, 'bus-stop', 10, 12); build(game, 'bus-stop', 30, 12);
  const stops = game.stations.map(stop => stop.id);
  assert.equal(addRoute(game, { mode: 'road', cargo: 'passengers', stops }).ok, true);
  if (two) assert.equal(addRoute(game, { mode: 'road', cargo: 'passengers', stops }).ok, true);
  return game;
}

test('demolishing housing removes its represented residents and prevents build-clear population farming', () => {
  const game = emptyGame(); build(game, 'city', 20, 20);
  const city = game.cities[0], original = city.population;
  for (let n = 0; n < 5; n++) {
    assert.equal(build(game, 'house-cheap-1', 21, 20).ok, true); assert.equal(city.population, original + 12);
    assert.equal(build(game, 'bulldoze', 21, 20).ok, true); assert.equal(city.population, original);
  }
  tileAt(game, 21, 20).building = { kind: 'house-normal-2', level: 3 }; city.population += 66; city.passengers = city.population * .9;
  assert.equal(build(game, 'bulldoze', 21, 20).ok, true); assert.equal(city.population, original); assert.equal(city.passengers, original * .9);
  build(game, 'school', 22, 20); build(game, 'bulldoze', 22, 20); assert.equal(city.population, original, 'civic demolition does not remove residents');
  assert.equal(build(game, 'bulldoze', 20, 20).ok, false, 'the town center stays protected');
});

test('overlapping legacy stop catchments transport passengers to a different actual town', () => {
  const game = emptyGame(); game.cities = [town('A', 10, 10), town('B', 18, 10)];
  buildPath(game, 'road', line(13, 15, 10)); build(game, 'bus-stop', 13, 10); build(game, 'bus-stop', 15, 10);
  const stops = game.stations.map(stop => stop.id);
  assert.deepEqual(passengerEndpoints(game, ...game.stations).map(city => city.id), ['A', 'B']);
  assert.equal(validateRoutePlan(game, { mode: 'road', cargo: 'passengers', from: stops[0], to: stops[1] }).valid, true);
  assert.equal(addRoute(game, { mode: 'road', cargo: 'passengers', stops }).ok, true);
  assert.equal(game.cities[0].passengers, 76); assert.equal(game.cities[1].passengers, 100);
  Object.assign(game.vehicles[0], { progress: 1.99, x: 14.99, y: 10 }); tick(game, .02);
  assert.equal(game.cities[0].delivered, 0); assert.equal(game.cities[1].delivered, 24, 'the origin cannot count its own departures as delivered passengers');
  assert.equal(game.cities[1].passengers, 76, 'the return trip loads the other town');
});

test('founding a closer town cannot steal existing housing or charge countryside residents to it', () => {
  const game = emptyGame(); build(game, 'city', 10, 10); const original = game.cities[0];
  build(game, 'house-cheap-1', 18, 10); delete tileAt(game, 18, 10).building.populationCityId; // Legacy house.
  build(game, 'city', 21, 10); const newer = game.cities[1];
  assert.equal(tileAt(game, 18, 10).building.populationCityId, original.id);
  build(game, 'bulldoze', 18, 10); assert.equal(original.population, 80); assert.equal(newer.population, 80);
  build(game, 'house-cheap-1', 50, 30); assert.equal(tileAt(game, 50, 30).building.populationCityId, null);
  build(game, 'city', 52, 30); const ruralTown = game.cities[2];
  assert.equal(tileAt(game, 50, 30).building.populationCityId, null);
  build(game, 'bulldoze', 50, 30); assert.equal(ruralTown.population, 80, 'a countryside home never credited to the new town cannot remove its founder population');
});

test('residential zone upgrades retain the town originally credited for their residents', () => {
  const game = emptyGame(); build(game, 'city', 10, 10); const original = game.cities[0];
  build(game, 'residential', 18, 10); const plot = tileAt(game, 18, 10);
  plot.building = { kind: 'house-cheap-1', level: 1, populationCityId: original.id }; plot.variant = 0; original.population += 12; game.zones[0].progress = 1.99;
  build(game, 'city', 21, 10); const newer = game.cities[1];
  buildPath(game, 'road', line(10, 21, 11)); build(game, 'bus-stop', 10, 11); build(game, 'bus-stop', 21, 11);
  assert.equal(addRoute(game, { mode: 'road', cargo: 'passengers', stops: game.stations.map(stop => stop.id) }).ok, true);
  for (let day = 1; day <= 30 && plot.building.level === 1; day++) {
    game.day = day; for (const city of game.cities) { city.activity = 0; city.lastServiceDay = day; } stepSettlements(game);
  }
  assert.equal(plot.building.level, 2); assert.equal(plot.building.populationCityId, original.id);
  assert.equal(original.population, 80 + housingCapacity(plot.building)); assert.equal(newer.population, 80);
  build(game, 'bulldoze', 18, 10); assert.equal(original.population, 80); assert.equal(newer.population, 80);
});

test('input-starved factories do not expand from receiving cargo alone and retain every stored unit', () => {
  const game = emptyGame(); build(game, 'steel-mill', 30, 10);
  const mill = game.industries[0]; mill.inventory.coal = 700; mill.activity = 200; mill.nextProductionDay = 1; mill.nextReviewDay = 1;
  tick(game, 100);
  assert.equal(mill.totalProduced, 0); assert.equal(mill.inventory.coal, 700); assert.ok(mill.capacity <= 1);
  assert.ok(mill.capacity * 900 >= 700, 'capacity reviews retain enough storage for conserved cargo');
  const previous = mill.capacity; mill.inventory.iron = 900; mill.activity = 200; mill.nextProductionDay = 101; mill.nextReviewDay = 101;
  tick(game, 2); assert.ok(mill.totalProduced > 0); assert.ok(mill.capacity > previous, 'supplying the complete recipe unlocks productive expansion');
});

test('company accounts close at Gregorian month ends and separate construction from running costs', () => {
  const game = emptyGame(); build(game, 'road', 10, 10); build(game, 'bus-stop', 10, 10);
  const capital = game.monthlyExpenses;
  tick(game, 30); assert.equal(game.history.length, 0, 'January still has a final day');
  assert.ok(game.monthlyOperatingExpenses > 0); assert.equal(game.monthlyExpenses, capital + game.monthlyOperatingExpenses);
  tick(game, 1); assert.equal(game.lastMonth, 1); assert.equal(game.history[0].day, 31);
  assert.equal(game.lastMonthlyProfit, game.lastMonthlyOperatingProfit - capital);
  assert.equal(game.history[0].operatingProfit, -game.history[0].operatingExpenses);
  assert.equal(game.monthlyOperatingExpenses, 0); assert.equal(game.monthlyExpenses, 0);
  tick(game, 27); assert.equal(game.history.length, 1); tick(game, 1); assert.equal(game.history[1].day, 59, 'February1950 has28 days');
  const leap = emptyGame(); leap.day = 730; leap.lastMonth = calendarMonth(leap);
  tick(leap, 31); tick(leap, 28); assert.equal(leap.history.length, 1, 'February1952 has a leap day remaining');
  tick(leap, 1); assert.equal(leap.history[1].day, 790); assert.equal(leap.lastMonth, 26);
});

test('route expenses allocate shared upkeep once and exclude capital purchases', () => {
  const game = passengerFixture(true), before = game.money;
  assert.ok(game.routes.every(route => route.expenses === 0)); assert.equal(game.totalOperatingExpenses, 0);
  tick(game, 1);
  const routeExpenses = game.routes.reduce((sum, route) => sum + route.expenses, 0);
  assert.ok(game.routes.every(route => route.expenses > 20));
  assert.ok(routeExpenses <= game.totalOperatingExpenses && routeExpenses >= game.totalOperatingExpenses - game.routes.length, 'shared tracks and stops belong to a single company charge, with only rounding left over');
  assert.equal(before - game.money, game.totalOperatingExpenses, 'there has been no delivery yet');
  buildPath(game, 'rail', line(50, 80, 30)); build(game, 'train-stop', 50, 30);
  const previousOperating = game.totalOperatingExpenses, previousRoutes = routeExpenses;
  tick(game, 1);
  assert.ok(game.totalOperatingExpenses - previousOperating > game.routes.reduce((sum, route) => sum + route.expenses, 0) - previousRoutes + 5, 'unused infrastructure stays visible in company costs');
});

test('legacy accounting starts from a stated revenue baseline and saves its exact new future', () => {
  const old = passengerFixture(); tick(old, 100);
  const income = old.monthlyIncome, revenue = old.routes[0].revenue;
  for (const key of ['monthlyOperatingExpenses', 'totalOperatingExpenses', 'monthlyIncomeAtAccountingStart', 'lastMonthlyOperatingProfit', 'accountingStartDay']) delete old[key];
  for (const key of ['expenses', 'accountingStartDay', 'revenueAtAccountingStart']) delete old.routes[0][key];
  old.lastMonth = Math.floor(old.day / 30);
  const loaded = restoreGame(structuredClone(old)); assert.ok(loaded); assert.equal(loaded.lastMonth, calendarMonth(loaded));
  assert.equal(loaded.accountingStartDay, 100); assert.equal(loaded.monthlyIncomeAtAccountingStart, income);
  assert.equal(loaded.routes[0].revenueAtAccountingStart, revenue); assert.equal(loaded.routes[0].accountingStartDay, 100); assert.equal(loaded.routes[0].expenses, 0);
  tick(loaded, 10); const restored = restoreGame(structuredClone(loaded)); assert.ok(restored);
  tick(loaded, 15); tick(restored, 15);
  assert.equal(restored.money, loaded.money); assert.equal(restored.lastMonthlyOperatingProfit, loaded.lastMonthlyOperatingProfit); assert.equal(restored.routes[0].expenses, loaded.routes[0].expenses);
  assert.equal(restored.monthlyIncomeAtAccountingStart, 0, 'a new full month needs no legacy baseline');
  const invalid = structuredClone(loaded); invalid.routes[0].expenses = -1; assert.equal(validateGame(invalid), false);
  for (const [field, value] of [['operatingExpenses', -1], ['operatingExpenses', NaN], ['operatingProfit', Infinity]]) {
    const invalidHistory = structuredClone(loaded); invalidHistory.history[0][field] = value; assert.equal(validateGame(invalidHistory), false);
  }
});

test('route connectivity can refresh while paused without moving vehicles or charging money', () => {
  const game = passengerFixture(), position = { ...game.vehicles[0] }, day = game.day;
  build(game, 'bulldoze', 20, 12); const money = game.money;
  refreshRouteConnections(game); assert.equal(game.routes[0].active, false); assert.equal(game.routes[0].status, 'Disconnected');
  assert.deepEqual(game.vehicles[0], position); assert.equal(game.day, day); assert.equal(game.money, money);
  build(game, 'road', 20, 12); refreshRouteConnections(game); assert.equal(game.routes[0].active, true); assert.equal(game.routes[0].status, 'Running');
});

test('a complete affordable food chain conserves cargo and earns positive operating profit', () => {
  const game = emptyGame(); game.money = 400000;
  build(game, 'farm', 10, 10); build(game, 'food-plant', 30, 10); build(game, 'city', 50, 10); buildPath(game, 'road', line(10, 50, 12));
  for (const x of [10, 30, 50]) build(game, 'bus-stop', x, 12);
  assert.equal(addRoute(game, { mode: 'road', cargo: 'grain', stops: game.stations.slice(0, 2).map(stop => stop.id) }).ok, true);
  assert.equal(addRoute(game, { mode: 'road', cargo: 'food', stops: game.stations.slice(1, 3).map(stop => stop.id) }).ok, true);
  assert.ok(game.money > 200000, 'an introductory full chain leaves a useful building budget');
  const start = game.money; tick(game, 365);
  const [farm, plant] = game.industries, [grainRoute, foodRoute] = game.routes;
  assert.ok(foodRoute.delivered > 100); assert.ok(game.money > start); assert.ok(foodRoute.revenue > foodRoute.expenses);
  close(farm.totalProduced, farm.inventory.grain + game.vehicles[0].load + plant.inventory.grain + plant.totalProduced * 4 / 3);
  close(plant.totalProduced, plant.inventory.food + game.vehicles[1].load + foodRoute.delivered);
  close(grainRoute.delivered, plant.inventory.grain + plant.totalProduced * 4 / 3);
  assert.equal(validateGame(game), true);
});

for (const biome of ['taiga', 'tundra', 'desert']) test(`${biome} starter company stays viable through five years of inflation`, () => {
  const game = createGame({ biome, size: 'regional', seed: 1847 }), money = game.money;
  tick(game, 365 * 5);
  assert.ok(game.money > money + 100000); assert.ok(game.routes[0].revenue > game.routes[0].expenses);
  assert.equal(game.history.length, 36); assert.equal(validateGame(game), true);
});
