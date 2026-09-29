import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, addRoute, addRouteVehicle, editRoute, tick, validateGame, restoreGame, upgradeRouteVehicle, upgradeFleet, getVehicleUpgrade, getRouteFleet } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { calendarMonth } from '../economy-pricing.js';
import { emptyGame, line } from './helpers.mjs';

const yearDay = year => (Date.UTC(year, 0, 1) - Date.UTC(1950, 0, 1)) / 86400000;
function passengerRoute(mode = 'road', game = emptyGame(), y = 10) {
  game.cities.push({ id: `city-a${y}`, name: `Ayle${y}`, x: 10, y, population: 900, activity: 0, growth: 0, passengers: 400, delivered: 0, supplies: 0, lastServiceDay: null },
    { id: `city-b${y}`, name: `Bree${y}`, x: 40, y, population: 900, activity: 0, growth: 0, passengers: 400, delivered: 0, supplies: 0, lastServiceDay: null });
  assert.equal(buildPath(game, mode, line(10, 40, y)).ok, true);
  const tool = mode === 'rail' ? 'train-stop' : 'bus-stop', stops = [10, 40].map(x => build(game, tool, x, y).station.id);
  const launched = addRoute(game, { name: `Line ${y}`, mode, cargo: 'passengers', stops }); assert.equal(launched.ok, true, launched.message);
  return game;
}

test('quotes carry every level and the messages name the model', () => {
  const game = passengerRoute(); game.day = yearDay(1970); game.lastMonth = calendarMonth(game); game.money = 1e9;
  const q = getVehicleUpgrade(game, game.routes[0].id); assert.deepEqual(q.levels, [0]); assert.equal(q.maxLevel, 0); assert.equal(q.level, 0);
  assert.match(upgradeRouteVehicle(game, game.routes[0].id).message, /^Buses on Line 10 upgraded to the Pendle Mk 10\. \$[\d,]+ spent\.$/);
  const g2 = passengerRoute(); g2.day = 730; assert.match(upgradeFleet(g2).message, /^1 vehicle upgraded to the 1952 models\. \$[\d,]+ spent\.$/);
  // A mixed fleet lists its levels in fleet order, through one helper for quotes and the fleet summary.
  const g3 = passengerRoute(); g3.day = 730; assert.equal(addRouteVehicle(g3, g3.routes[0].id).ok, true);
  const mixed = getVehicleUpgrade(g3, g3.routes[0].id), fleet = getRouteFleet(g3, g3.routes[0].id);
  assert.deepEqual([mixed.levels, mixed.level, mixed.maxLevel], [[0, 2], 0, 2]);
  assert.deepEqual([fleet.levels, fleet.minLevel, fleet.maxLevel], [[0, 2], 0, 2]);
  assert.deepEqual(getVehicleUpgrade(g3, 'no-such-route').levels, []);
});

test('route profit this year rolls into last year at the December close', () => {
  const game = passengerRoute('rail'); const route = game.routes[0];
  assert.equal(route.profitThisYear, 0, 'a new route starts the year at zero');
  tick(game, 365);
  assert.ok(route.revenue > 0 && route.expenses > 0);
  assert.equal(route.profitThisYear, 0); assert.equal(route.profitLastYear, route.revenue - route.expenses);
  const revenue = route.revenue, expenses = route.expenses;
  tick(game, 200);
  assert.equal(route.profitThisYear, (route.revenue - revenue) - (route.expenses - expenses));
  tick(game, 165); assert.equal(game.day, 730);
  assert.equal(route.profitLastYear, (route.revenue - revenue) - (route.expenses - expenses)); assert.equal(route.profitThisYear, 0);
  assert.equal(game.annual.at(-1).bestRouteId, route.id);
});

test('the year review picks the route that earned most this year, not since launch', () => {
  const game = passengerRoute('road', passengerRoute('road', emptyGame(), 10), 30), [a, b] = game.routes;
  game.day = yearDay(1951) - 1; game.lastMonth = calendarMonth(game);
  a.revenue += 1e9; a.profitThisYear = 10; b.profitThisYear = 1e6;
  tick(game, 1);
  assert.equal(game.annual.at(-1).bestRouteId, b.id);
  assert.ok(a.profitLastYear < b.profitLastYear); assert.deepEqual([a.profitThisYear, b.profitThisYear], [0, 0]);
  const quiet = passengerRoute(); quiet.day = yearDay(1951) - 1; quiet.lastMonth = calendarMonth(quiet); quiet.routes[0].profitThisYear = -500;
  tick(quiet, 1); assert.equal(quiet.annual.at(-1).bestRouteId, null, 'a year without an earning route has no best route');
});

test('yearly profit is frame-rate independent across January', () => {
  const a = passengerRoute(); a.day = yearDay(1966) - 40; a.lastMonth = calendarMonth(a);
  const b = structuredClone(a);
  tick(a, 80); for (let n = 0; n < 320; n++) tick(b, .25);
  const books = game => ({ money: game.money, expenses: game.totalOperatingExpenses, routes: game.routes.map(r => [r.revenue, r.expenses, r.profitThisYear, r.profitLastYear]) });
  assert.deepEqual(books(a), books(b)); assert.equal(typeof a.routes[0].profitLastYear, 'number');
});

test('an edit keeps the year; only the since-launch accounts restart', () => {
  const game = passengerRoute(); const route = game.routes[0];
  tick(game, 400);
  const year = [route.profitThisYear, route.profitLastYear];
  assert.equal(editRoute(game, route.id, { stops: [...route.stops].reverse(), cargo: 'passengers' }).ok, true);
  assert.deepEqual([route.profitThisYear, route.profitLastYear], year);
  assert.equal(route.expenses, 0);
});

test('yearly route profit is optional, validated and saved', () => {
  const game = passengerRoute(); tick(game, 400);
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.equal(restored.routes[0].profitThisYear, game.routes[0].profitThisYear); assert.equal(restored.routes[0].profitLastYear, game.routes[0].profitLastYear);
  const legacy = structuredClone(game); delete legacy.routes[0].profitThisYear; delete legacy.routes[0].profitLastYear;
  const loaded = restoreGame(structuredClone(legacy)); assert.ok(loaded); assert.equal(loaded.routes[0].profitThisYear, undefined); assert.equal(loaded.routes[0].profitLastYear, undefined);
  const before = loaded.routes[0].revenue - loaded.routes[0].expenses; tick(loaded, 10);
  assert.equal(loaded.routes[0].profitThisYear, loaded.routes[0].revenue - loaded.routes[0].expenses - before);
  for (const value of [NaN, Infinity, 2e15, '5', null]) { const invalid = structuredClone(game); invalid.routes[0].profitThisYear = value; assert.equal(validateGame(invalid), false, String(value)); }
  const invalid = structuredClone(game); invalid.routes[0].profitLastYear = -2e15; assert.equal(validateGame(invalid), false);
  const loss = structuredClone(game); loss.routes[0].profitThisYear = -5000; loss.routes[0].profitLastYear = -12; assert.equal(validateGame(loss), true, 'a year can close at a loss');
  assert.equal(validateGame(game), true);
});
