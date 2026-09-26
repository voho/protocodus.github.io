import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, addRoute, removeRoute, findPath, tick, stationCoverage, validateGame, restoreGame, VEHICLE_COSTS, BUILD_COSTS } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { filterRoutes, validateRoutePlan } from '../route-planner.js';
import { emptyGame, tileAt, line } from './helpers.mjs';

function water(game, points) {
  for (const point of points) Object.assign(tileAt(game, point.x, point.y), { terrain: 'water', detail: 'river', elevation: 0, road: false, rail: false, bridge: false, tunnel: false });
  game.revision++; game.networkRevision++;
}

function freightFixture() {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 10).ok, true);
  assert.equal(build(game, 'sawmill', 30, 10).ok, true);
  water(game, line(10, 30, 12));
  assert.equal(build(game, 'port', 10, 12).ok, true);
  assert.equal(build(game, 'port', 30, 12).ok, true);
  game.industries[0].inventory.timber = 300;
  const draft = { name: 'River timber', mode: 'water', cargo: 'timber', from: game.stations[0].id, to: game.stations[1].id };
  return { game, draft, stops: [draft.from, draft.to] };
}

function clean(game) {
  const state = structuredClone(game);
  delete state.maintenanceRevision;
  for (const route of state.routes) delete route.pathRevision;
  return state;
}

function approximatelyEqual(actual, expected, path = 'state') {
  if (typeof actual === 'number' && typeof expected === 'number') return assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10, `${path}: ${actual} vs ${expected}`);
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    for (const key of Object.keys(actual)) approximatelyEqual(actual[key], expected[key], `${path}.${key}`);
  } else assert.equal(actual, expected, path);
}

test('ports occupy coastal water, reject deep water and infrastructure, and charge only on success', () => {
  const game = emptyGame(), money = game.money;
  assert.equal(BUILD_COSTS.port, 18000); assert.equal(VEHICLE_COSTS.water, 64000);
  assert.equal(build(game, 'port', 8, 10).ok, false, 'a port is placed in water, not on land');
  water(game, Array.from({ length: 5 }, (_, row) => line(8, 12, row + 8)).flat());
  assert.equal(build(game, 'port', 10, 10).ok, false, 'deep water lacks a shoreline');
  for (const blocked of [{ road: true }, { rail: true }, { bridge: true }, { tunnel: true }, { zone: 'industrial' }, { building: { kind: 'house', level: 1 } }]) {
    const tile = tileAt(game, 10, 8), original = structuredClone(tile);
    Object.assign(tile, blocked);
    assert.equal(build(game, 'port', 10, 8).ok, false, JSON.stringify(blocked));
    Object.assign(tile, original);
  }
  assert.equal(game.money, money);
  const opened = build(game, 'port', 8, 10);
  assert.equal(opened.ok, true); assert.equal(opened.station.mode, 'water');
  assert.equal(game.money, money - 18000); assert.match(opened.station.name, /Port/);
  assert.equal(tileAt(game, 8, 10).terrain, 'water');
  assert.equal(build(game, 'port', 8, 10).ok, false, 'ports cannot stack');
  assert.equal(build(game, 'bridge', 8, 10).ok, false, 'road bridges cannot replace a port');
  assert.equal(build(game, 'railbridge', 8, 10).ok, false, 'rail bridges cannot replace a port');
  game.money = 17999;
  assert.equal(build(game, 'port', 12, 10).ok, false);
  assert.equal(game.money, 17999);
});

test('ships follow connected cardinal water, pass bridges, and cannot cross land or diagonal gaps', () => {
  const { game, draft } = freightFixture();
  assert.equal(build(game, 'bridge', 20, 12).ok, true);
  assert.equal(build(game, 'railbridge', 21, 12).ok, true);
  const path = findPath(game, game.stations[0], game.stations[1], 'water');
  assert.equal(path.length, 21);
  assert.ok(path.every(point => tileAt(game, point.x, point.y).terrain === 'water'));
  assert.ok(path.some(point => point.x === 20) && path.some(point => point.x === 21));
  assert.equal(validateRoutePlan(game, draft).valid, true);
  tileAt(game, 23, 12).terrain = 'grass'; game.revision++; game.networkRevision++;
  assert.equal(findPath(game, game.stations[0], game.stations[1], 'water'), null);
  const disconnected = validateRoutePlan(game, draft);
  assert.equal(disconnected.valid, false); assert.match(disconnected.message, /same river, lake or sea/);
  assert.equal(addRoute(game, { ...draft, stops: [draft.from, draft.to] }).ok, false);
  const diagonal = emptyGame();
  water(diagonal, [{ x: 10, y: 10 }, { x: 11, y: 11 }]);
  assert.equal(findPath(diagonal, { x: 10, y: 10 }, { x: 11, y: 11 }, 'water'), null);
});

test('freight ships load 140 units, deliver to factories, pay upkeep, and sell for the correct refund', () => {
  const { game, draft, stops } = freightFixture();
  const before = game.money;
  const launched = addRoute(game, { ...draft, stops });
  assert.equal(launched.ok, true, launched.message);
  assert.equal(game.money, before - 64000);
  assert.equal(game.vehicles[0].capacity, 140); assert.equal(game.vehicles[0].load, 140);
  assert.equal(game.industries[0].inventory.timber, 160);
  assert.deepEqual(stationCoverage(game, game.stations[0]).produces, ['timber']);
  assert.equal(build(game, 'bulldoze', 10, 12).ok, false, 'retire a service before removing its port');
  const expenses = game.totalExpenses;
  tick(game, 60);
  assert.ok(game.totalExpenses > expenses + 3000, 'ships and ports have ongoing operating costs');
  assert.ok(launched.route.delivered >= 140); assert.ok(launched.route.revenue > 0);
  assert.ok(game.industries[1].received >= 140); assert.ok(game.industries[1].totalProduced > 0);
  assert.equal(validateGame(game), true);
  const retired = removeRoute(game, launched.route.id);
  assert.equal(retired.ok, true); assert.equal(retired.refund, 28800); assert.equal(game.vehicles.length, 0);
  assert.equal(build(game, 'bulldoze', 10, 12).ok, true);
  assert.equal(tileAt(game, 10, 12).terrain, 'water', 'removing a port does not remove the river');
  assert.equal(tileAt(game, 10, 12).detail, 'river', 'river identity survives demolition');
});

test('ships can carry passengers between towns and reject mismatched station types and insufficient funds', () => {
  const game = emptyGame();
  assert.equal(build(game, 'city', 10, 10).ok, true);
  assert.equal(build(game, 'city', 30, 10).ok, true);
  water(game, line(10, 30, 12));
  for (const x of [10, 30]) assert.equal(build(game, 'port', x, 12).ok, true);
  for (const city of game.cities) city.passengers = 180;
  const stops = game.stations.map(station => station.id);
  assert.equal(addRoute(game, { mode: 'road', stops, cargo: 'passengers' }).ok, false);
  game.money = 63999;
  assert.equal(addRoute(game, { mode: 'water', stops, cargo: 'passengers' }).ok, false);
  game.money = 100000;
  const launched = addRoute(game, { name: 'River ferry', mode: 'water', stops, cargo: 'passengers' });
  assert.equal(launched.ok, true); assert.equal(game.vehicles[0].load, 140);
  tick(game, 60);
  assert.ok(game.cities.every(city => city.delivered > 0), 'passengers travel in both directions');
  assert.equal(filterRoutes(game, { mode: 'water', query: 'ferry' }).length, 1);
  assert.equal(filterRoutes(game, { query: 'ship port' }).length, 1);
  assert.equal(filterRoutes(game, { mode: 'rail' }).length, 0);
});

test('ship routes stop at a severed waterway and resume when the connection returns', () => {
  const { game, draft, stops } = freightFixture();
  const { route } = addRoute(game, { ...draft, stops });
  tick(game, 1);
  tileAt(game, 20, 12).terrain = 'grass'; game.revision++; game.networkRevision++;
  const progress = game.vehicles[0].progress;
  tick(game, 2);
  assert.equal(route.active, false); assert.equal(route.status, 'Disconnected');
  assert.equal(game.vehicles[0].progress, progress);
  water(game, [{ x: 20, y: 12 }]); tick(game, .5);
  assert.equal(route.active, true); assert.ok(game.vehicles[0].progress > progress);
});

test('channel width and port traffic influence shipping speed deterministically', () => {
  const { game, draft, stops } = freightFixture();
  assert.equal(addRoute(game, { ...draft, stops }).ok, true);
  const wide = structuredClone(game), crowded = structuredClone(game);
  water(wide, [...line(10, 30, 11), ...line(10, 30, 13)]);
  assert.equal(addRoute(crowded, { ...draft, name: 'Second freighter', stops }).ok, true);
  tick(game, 1); tick(wide, 1); tick(crowded, 1);
  assert.ok(wide.vehicles[0].progress > game.vehicles[0].progress, 'open water is faster than narrow river channels');
  assert.ok(crowded.vehicles[0].progress < game.vehicles[0].progress, 'shared ports slow approaches');
});

test('shipping has the same future across frame partitions and survives compact save restoration', () => {
  const { game, draft, stops } = freightFixture();
  assert.equal(addRoute(game, { ...draft, stops }).ok, true);
  const partitioned = structuredClone(game);
  const oldRandom = Math.random;
  Math.random = () => { throw new Error('Shipping must use the saved seed'); };
  try { tick(game, 75); for (let i = 0; i < 300; i++) tick(partitioned, .25); }
  finally { Math.random = oldRandom; }
  approximatelyEqual(clean(partitioned), clean(game));
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(restored); assert.equal(validateGame(restored), true);
  assert.equal(restored.stations[0].mode, 'water'); assert.equal(restored.routes[0].mode, 'water');
  assert.equal(restored.vehicles[0].capacity, 140);
  assert.deepEqual(clean(restored), clean(game));
  tick(game, 11.375); tick(restored, 11.375);
  assert.deepEqual(clean(restored), clean(game), 'save/resume preserves exact shipping clocks, cargo and money');
});
