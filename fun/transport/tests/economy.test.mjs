import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, build, buildPath, addRoute, removeRoute, tick, VEHICLE_COSTS } from '../model.js';
import { emptyGame, line, advance } from './helpers.mjs';

function freightFixture(mode = 'road') {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 10).ok, true);
  assert.equal(build(game, 'sawmill', 30, 10).ok, true);
  assert.equal(buildPath(game, mode, line(10, 30, 12)).ok, true);
  const stop = mode === 'road' ? 'bus-stop' : 'train-stop';
  assert.equal(build(game, stop, 10, 12).ok, true);
  assert.equal(build(game, stop, 30, 12).ok, true);
  const source = game.industries.find(industry => industry.kind === 'logging-camp');
  const destination = game.industries.find(industry => industry.kind === 'sawmill');
  source.inventory.timber = 200;
  return { game, source, destination, stops: game.stations.map(station => station.id) };
}

for (const mode of ['road', 'rail']) {
  test(`${mode} freight vehicles transfer cargo, fund the company and feed production`, () => {
    const { game, source, destination, stops } = freightFixture(mode);
    const before = game.money;
    const result = addRoute(game, { name: 'Forest supply', mode, stops, cargo: 'timber' });
    assert.equal(result.ok, true, result.message);
    assert.equal(game.money, before - VEHICLE_COSTS[mode], 'starting a route buys its vehicle');
    assert.equal(game.routes.length, 1);
    assert.equal(game.vehicles.length, 1);
    assert.equal(game.totalRevenue, 0, 'creating a route is not a paid delivery');
    tick(game, .01);
    assert.equal(game.totalRevenue, 0, 'a vehicle must reach its destination to earn money');
    advance(game, 90, tick);
    assert.ok(game.routes[0].delivered > 0, 'the route moves timber');
    assert.ok(game.totalRevenue > 0, 'delivered cargo earns income');
    assert.ok(source.shipped > 0);
    assert.ok(destination.received > 0, 'cargo enters the recipient inventory');
    assert.ok(destination.inventory.lumber > 0, 'the sawmill consumes delivered timber');
    assert.ok(destination.totalProduced > 0);
    assert.ok(source.capacity > 1 && destination.capacity > 1, 'sustained service expands industry capacity');
    assert.ok(Number.isFinite(game.money));
    const routeId = game.routes[0].id;
    assert.equal(removeRoute(game, routeId).ok, true);
    assert.equal(game.routes.length, 0);
    assert.equal(game.vehicles.length, 0);
    const afterSale = game.money;
    assert.equal(removeRoute(game, routeId).ok, false);
    assert.equal(game.money, afterSale, 'a vehicle cannot be sold twice');
    const delivered = game.totalDelivered, revenue = game.totalRevenue;
    advance(game, 30, tick);
    assert.equal(game.totalDelivered, delivered);
    assert.equal(game.totalRevenue, revenue, 'closed routes stop delivering');
  });
}

test('route validation blocks bad cargo, missing stops, mode mismatches and disconnected service', () => {
  const { game, stops } = freightFixture();
  const before = game.money;
  for (const overrides of [
    { cargo: 'passengers' }, { cargo: 'unobtainium' }, { stops: [stops[0], stops[0]] },
    { stops: [stops[0], 'missing-station'] }, { mode: 'rail' },
  ]) {
    const result = addRoute(game, { name: 'Invalid service', mode: 'road', stops, cargo: 'timber', ...overrides });
    assert.equal(result.ok, false, `reject ${JSON.stringify(overrides)}`);
    assert.equal(game.money, before);
    assert.equal(game.routes.length, 0);
    assert.equal(game.vehicles.length, 0);
  }
  assert.equal(build(game, 'bulldoze', 20, 12).ok, true);
  const afterDemolition = game.money;
  assert.equal(addRoute(game, { name: 'Broken line', mode: 'road', stops, cargo: 'timber' }).ok, false);
  assert.equal(game.money, afterDemolition);
});

test('an in-service line stops at a network break and resumes after repair', () => {
  const { game, stops } = freightFixture();
  assert.equal(addRoute(game, { name: 'Timber service', mode: 'road', stops, cargo: 'timber' }).ok, true);
  tick(game, 1);
  assert.equal(build(game, 'bulldoze', 20, 12).ok, true);
  const position = { x: game.vehicles[0].x, y: game.vehicles[0].y };
  const revenue = game.totalRevenue;
  advance(game, 30, tick);
  assert.equal(game.routes[0].active, false);
  assert.equal(game.totalRevenue, revenue, 'a disconnected line cannot manufacture income');
  assert.deepEqual({ x: game.vehicles[0].x, y: game.vehicles[0].y }, position);
  assert.equal(build(game, 'road', 20, 12).ok, true);
  advance(game, 30, tick);
  assert.equal(game.routes[0].active, true);
  assert.ok(game.totalRevenue > revenue, 'repair restores actual cargo delivery');
});

test('a valid route cannot be purchased without its full vehicle cost', () => {
  const { game, stops } = freightFixture();
  game.money = VEHICLE_COSTS.road - 1;
  assert.equal(addRoute(game, { name: 'Unfunded route', mode: 'road', stops, cargo: 'timber' }).ok, false);
  assert.equal(game.money, VEHICLE_COSTS.road - 1);
  assert.equal(game.routes.length, 0);
  assert.equal(game.vehicles.length, 0);
});

test('a full customer leaves cargo aboard and cannot pay for it repeatedly', () => {
  const { game, destination, stops } = freightFixture();
  Object.assign(destination.inventory, { timber: 900, lumber: 900 });
  assert.equal(addRoute(game, { name: 'Full warehouse', mode: 'road', stops, cargo: 'timber' }).ok, true);
  advance(game, 40, tick);
  assert.equal(game.totalDelivered, 0);
  assert.equal(game.totalRevenue, 0);
  assert.equal(game.vehicles[0].load, game.vehicles[0].capacity);
});

test('a complex recipe waits for every input and consumes the recipe proportions', () => {
  const game = emptyGame();
  assert.equal(build(game, 'steel-mill', 20, 20).ok, true);
  const mill = game.industries[0];
  Object.assign(mill.inventory, { iron: 30, coal: 0, steel: 0 });
  advance(game, 5, tick);
  assert.equal(mill.inventory.steel, 0, 'iron alone cannot make steel');
  assert.equal(mill.inventory.iron, 30, 'an incomplete recipe wastes no input');
  mill.inventory.coal = 20;
  advance(game, 4, tick);
  assert.ok(mill.inventory.steel > 0);
  const ironUsed = 30 - mill.inventory.iron, coalUsed = 20 - mill.inventory.coal;
  assert.ok(Math.abs(ironUsed / coalUsed - 3 / 2) < 1e-8, 'iron and coal use the 3:2 recipe');
  assert.ok(Math.abs(mill.inventory.steel - ironUsed) < 1e-8, 'each three iron become three steel');
});

test('passenger service increases city population and activity over an unserved world', () => {
  const served = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  const unserved = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  for (const route of [...unserved.routes]) assert.equal(removeRoute(unserved, route.id).ok, true);
  advance(served, 120, tick);
  advance(unserved, 120, tick);
  for (let index = 0; index < 2; index++) {
    assert.ok(served.cities[index].population > unserved.cities[index].population, 'service stimulates growth');
    assert.ok(served.cities[index].activity > unserved.cities[index].activity);
  }
});
