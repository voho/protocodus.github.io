import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, addRoute, removeRoute, addRouteVehicle, addRouteVehicles, sellRouteVehicle, getRouteFleet, getRetirementRefund, getVehiclePurchase, getVehicleUpgrade, vehicleNoun, tick, validateGame, restoreGame, VEHICLE_COSTS, MAX_VEHICLES, validVehicleCount } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { emptyGame, line, advance, equivalent, completeFixtureConstruction } from './helpers.mjs';

const town = (id, x, y) => ({ id, name: id, x, y, population: 300, passengers: 100, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null });
const phase = (route, vehicle) => { const L = route.path.length - 1; return (vehicle.direction === 1 ? vehicle.progress : 2 * L - vehicle.progress) % (2 * L); };

// A stone quarry with a deep stockpile, 20 road tiles from a town that buys stone.
function quarryFixture(stock = 2000) {
  const game = emptyGame(); game.cities = [town('Stoneford', 30, 9)];
  assert.equal(build(game, 'quarry', 9, 7).ok, true);
  completeFixtureConstruction(game, game.industries[0]);
  assert.equal(buildPath(game, 'road', line(10, 30, 12)).ok, true);
  for (const x of [10, 30]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  const quarry = game.industries[0]; quarry.inventory.stone = stock;
  const launched = addRoute(game, { name: 'Stone run', mode: 'road', cargo: 'stone', stops: game.stations.map(stop => stop.id) });
  assert.equal(launched.ok, true, launched.message);
  return { game, route: launched.route, quarry };
}
const fleet = (game, route) => game.vehicles.filter(vehicle => vehicle.routeId === route.id);

test('adding a vehicle charges exactly the purchase quote and refuses broken, unaffordable or unknown routes', () => {
  const { game, route } = quarryFixture(), quote = getVehiclePurchase(game, 'road'), money = game.money, expenses = game.monthlyExpenses;
  const added = addRouteVehicle(game, route.id);
  assert.equal(added.ok, true, added.message);
  assert.equal(game.money, money - quote.cost);
  assert.equal(game.monthlyExpenses, expenses + quote.cost, 'a purchase is a monthly expense like a launch');
  assert.equal(added.vehicle.capacity, quote.capacity); assert.equal(added.vehicle.level, quote.level); assert.equal(added.vehicle.paidPrice, quote.cost);
  assert.equal(fleet(game, route).length, 2);
  assert.match(added.message, /truck/i);
  assert.equal(vehicleNoun('road', 'stone'), 'truck'); assert.equal(vehicleNoun('road', 'passengers'), 'bus'); assert.equal(vehicleNoun('rail', 'coal'), 'train'); assert.equal(vehicleNoun('water', 'passengers'), 'ship');
  game.money = quote.cost - 1;
  const poor = addRouteVehicle(game, route.id);
  assert.equal(poor.ok, false); assert.match(poor.message, /Need \$18,000 to add a truck\./); assert.equal(game.money, quote.cost - 1);
  game.money = 1e6; assert.equal(build(game, 'bulldoze', 20, 12).ok, true); route.active = false;
  assert.match(addRouteVehicle(game, route.id).message, /These stops aren’t joined by road/);
  assert.equal(addRouteVehicle(game, 'route-missing').ok, false);
  assert.equal(fleet(game, route).length, 2);
});

test('each added vehicle takes the middle of the widest gap in the round trip, so a fleet never runs as a convoy', () => {
  const { game, route } = quarryFixture(), L = route.path.length - 1;
  assert.equal(phase(route, fleet(game, route)[0]), 0);
  const second = addRouteVehicle(game, route.id).vehicle;
  assert.ok(Math.abs(phase(route, second) - L) <= .5, `second at ${phase(route, second)} of ${2 * L}`);
  assert.equal(second.progress, L, 'a vehicle within half a tile of a stop starts at that stop');
  assert.equal(second.direction, -1, 'and departs from it instead of arriving again');
  const third = addRouteVehicle(game, route.id).vehicle, fourth = addRouteVehicle(game, route.id).vehicle;
  assert.ok(Math.abs(phase(route, third) - L / 2) <= .5, `third at ${phase(route, third)}`);
  assert.ok(Math.abs(phase(route, fourth) - 3 * L / 2) <= .5, `fourth at ${phase(route, fourth)}`);
  for (const vehicle of [third, fourth]) {
    const index = Math.min(Math.floor(vehicle.progress), L - 1), a = route.path[index], b = route.path[index + 1];
    assert.equal(vehicle.x, a.x + (b.x - a.x) * (vehicle.progress - index)); assert.equal(vehicle.y, a.y + (b.y - a.y) * (vehicle.progress - index));
    assert.equal(vehicle.angle, Math.atan2((b.y - a.y) * vehicle.direction, (b.x - a.x) * vehicle.direction));
  }
});

test('launching a vehicle order buys the complete fleet, with unit prices and the same spacing as successive purchases', () => {
  const { game, route } = quarryFixture();
  removeRoute(game, route.id);
  const separate = structuredClone(game), quote = getVehiclePurchase(game, 'road'), money = game.money, expenses = game.monthlyExpenses;
  const order = { mode: 'road', cargo: 'stone', stops: game.stations.map(stop => stop.id) };
  const launched = addRoute(game, { ...order, vehicleCount: 7 });
  assert.equal(launched.ok, true, launched.message);
  assert.equal(launched.vehicleCount, 7); assert.equal(launched.vehicles.length, 7);
  assert.equal(launched.cost, quote.cost * 7);
  assert.equal(game.money, money - launched.cost); assert.equal(game.monthlyExpenses, expenses + launched.cost);
  assert.ok(launched.vehicles.every(vehicle => vehicle.paidPrice === quote.cost && vehicle.capacity === quote.capacity && vehicle.level === quote.level));
  const first = addRoute(separate, order);
  for (let n = 1; n < 7; n++) assert.equal(addRouteVehicle(separate, first.route.id).ok, true);
  assert.deepEqual(game.vehicles, separate.vehicles, 'a batch retains loading, physical positions and exact phase spacing');
  assert.deepEqual(game.industries, separate.industries, 'the order takes no extra stock');
  assert.equal(game.money, separate.money);
  assert.equal(validateGame(game), true);
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(restored); assert.equal(getRouteFleet(restored, launched.route.id).count, 7);
});

test('orders added to an existing route buy exactly the requested vehicles and preserve the established service', () => {
  const { game, route } = quarryFixture(), separate = structuredClone(game), quote = getVehiclePurchase(game, 'road'), money = game.money;
  const bought = addRouteVehicles(game, route.id, 12);
  assert.equal(bought.ok, true, bought.message); assert.equal(bought.vehicles.length, 12); assert.equal(bought.cost, quote.cost * 12);
  assert.equal(game.money, money - bought.cost); assert.equal(game.routes.length, 1); assert.equal(getRouteFleet(game, route.id).count, 13);
  for (let n = 0; n < 12; n++) assert.equal(addRouteVehicle(separate, route.id).ok, true);
  assert.deepEqual(game.vehicles, separate.vehicles);
  assert.deepEqual(game.industries, separate.industries);
});

test('batch spacing matches successive purchases on a moving fleet across the return leg and stop snaps', () => {
  const { game, route } = quarryFixture();
  addRouteVehicle(game, route.id); tick(game, 2.75); game.money = 10_000_000;
  const separate = structuredClone(game), bought = addRouteVehicles(game, route.id, 100);
  assert.equal(bought.ok, true, bought.message);
  for (let n = 0; n < 100; n++) assert.equal(addRouteVehicle(separate, route.id).ok, true);
  assert.deepEqual(game.vehicles, separate.vehicles);
  assert.deepEqual(game.industries, separate.industries);
  assert.equal(game.money, separate.money);
});

test('invalid quantities and unaffordable fleet orders refuse the whole transaction without spending, stock loading or consuming IDs', () => {
  const { game, route } = quarryFixture(), order = { mode: 'road', cargo: 'stone', stops: game.stations.map(stop => stop.id) };
  for (const vehicleCount of [0, -1, 1.5, NaN, Infinity, '3', null, MAX_VEHICLES + 1]) {
    assert.equal(validVehicleCount(vehicleCount), false);
    const before = structuredClone(game);
    assert.equal(addRoute(game, { ...order, vehicleCount }).ok, false, String(vehicleCount));
    assert.equal(addRouteVehicles(game, route.id, vehicleCount).ok, false, String(vehicleCount));
    assert.deepEqual(game, before);
  }
  game.money = 3 * getVehiclePurchase(game, 'road').cost - 1;
  const before = structuredClone(game);
  assert.equal(addRoute(game, { ...order, vehicleCount: 3 }).ok, false);
  assert.equal(addRouteVehicles(game, route.id, 3).ok, false);
  assert.deepEqual(game, before, 'sufficient money for two vehicles cannot partially buy an order of three');
});

test('fleet orders cannot exceed the remaining slots, and an order filling the last slots succeeds', () => {
  const { game, route } = quarryFixture(), template = game.vehicles[0], order = { mode: 'road', cargo: 'stone', stops: route.stops };
  while (game.vehicles.length < MAX_VEHICLES - 2) game.vehicles.push({ ...template, id: `vehicle-cap-${game.vehicles.length}` });
  game.revision++;
  const before = structuredClone(game);
  assert.match(addRoute(game, { ...order, vehicleCount: 3 }).message, /Only 2 more vehicles/);
  assert.match(addRouteVehicles(game, route.id, 3).message, /Only 2 more vehicles/);
  assert.deepEqual(game, before);
  assert.equal(addRouteVehicles(game, route.id, 2).ok, true);
  assert.equal(game.vehicles.length, MAX_VEHICLES);
});

test('a paused repaired route can buy vehicles using its current connection before the next world tick', () => {
  const { game, route } = quarryFixture();
  assert.equal(build(game, 'bulldoze', 20, 12).ok, true); tick(game, .25);
  assert.equal(route.active, false); assert.equal(route.status, 'Disconnected');
  assert.equal(build(game, 'road', 20, 12).ok, true);
  assert.equal(route.active, false, 'the repair has not yet reached the simulation’s cached route state');
  const day = game.day, cost = getVehiclePurchase(game, 'road').cost * 3, money = game.money;
  const bought = addRouteVehicles(game, route.id, 3);
  assert.equal(bought.ok, true, bought.message); assert.equal(bought.cost, cost);
  assert.equal(game.day, day); assert.equal(game.money, money - cost);
  assert.equal(route.active, true); assert.equal(route.status, 'Running'); assert.equal(route.pathRevision, game.networkRevision);
  assert.equal(getRouteFleet(game, route.id).count, 4); assert.equal(validateGame(game), true);
});

test('refused purchases leave a disconnected or stale repaired route and all economy state unchanged', () => {
  const { game, route } = quarryFixture();
  assert.equal(build(game, 'bulldoze', 20, 12).ok, true); tick(game, .25);
  let before = structuredClone(game);
  assert.equal(addRouteVehicles(game, route.id, 3).ok, false);
  assert.deepEqual(game, before, 'a genuinely disconnected route is not modified by preflight');
  assert.equal(build(game, 'road', 20, 12).ok, true);
  game.money = getVehiclePurchase(game, 'road').cost * 3 - 1;
  before = structuredClone(game);
  assert.equal(addRouteVehicles(game, route.id, 3).ok, false);
  assert.deepEqual(game, before, 'an unaffordable order does not publish the repaired path, reset clocks or buy partially');
  assert.equal(addRouteVehicles(game, route.id, 1.5).ok, false);
  assert.deepEqual(game, before, 'a malformed order cannot publish the repaired connection');
});

test('a vehicle added at the loading stop loads there at once, like a launch', () => {
  const { game, route, quarry } = quarryFixture();
  const first = fleet(game, route)[0];
  first.progress = route.path.length - 1; first.direction = -1; game.revision++;
  const stock = quarry.inventory.stone, added = addRouteVehicle(game, route.id).vehicle;
  assert.equal(added.progress, 0); assert.equal(added.direction, 1);
  assert.equal(added.load, added.capacity); assert.equal(quarry.inventory.stone, stock - added.capacity);
});

test('on a deep stockpile, deliveries grow with the number of trucks', () => {
  const delivered = [1, 2, 4].map(count => {
    const { game, route } = quarryFixture();
    for (let n = 1; n < count; n++) assert.equal(addRouteVehicle(game, route.id).ok, true);
    advance(game, 60, tick);
    return route.delivered;
  });
  assert.ok(delivered[0] > 0);
  assert.ok(delivered[1] >= delivered[0] * 1.6 && delivered[1] <= delivered[0] * 2.4, `two trucks: ${delivered}`);
  assert.ok(delivered[2] >= delivered[0] * 3.2 && delivered[2] <= delivered[0] * 4.8, `four trucks: ${delivered}`);
});

test('selling refunds 45% of the vehicle price and keeps the last vehicle for retirement', () => {
  const { game, route } = quarryFixture();
  assert.match(sellRouteVehicle(game, route.id).message, /A route keeps at least one truck\. Retire the route to sell its last one\./);
  assert.equal(fleet(game, route).length, 1);
  addRouteVehicle(game, route.id); addRouteVehicle(game, route.id);
  const vehicles = fleet(game, route); vehicles[1].level = 1; vehicles[1].paidPrice = 25200; game.revision++;
  const summary = getRouteFleet(game, route.id);
  assert.deepEqual({ count: summary.count, capacity: summary.capacity, minLevel: summary.minLevel, maxLevel: summary.maxLevel }, { count: 3, capacity: 72, minLevel: 0, maxLevel: 1 });
  assert.equal(summary.load, vehicles.reduce((sum, vehicle) => sum + vehicle.load, 0));
  assert.equal(summary.sellRefund, Math.round(VEHICLE_COSTS.road * .45), 'the oldest, emptiest vehicle is sold first');
  const money = game.money, sold = sellRouteVehicle(game, route.id);
  assert.equal(sold.ok, true); assert.equal(sold.refund, 8100); assert.equal(game.money, money + 8100); assert.match(sold.message, /^Truck sold from .+\. \$8,100 refunded\.$/);
  assert.equal(fleet(game, route).includes(vehicles[2]), false, 'the empty older truck goes first');
  assert.equal(fleet(game, route).includes(vehicles[0]), true, 'a loaded truck of the same generation stays');
  assert.equal(fleet(game, route).includes(vehicles[1]), true, 'the newer generation stays');
  assert.equal(getRetirementRefund(game, route.id), Math.round(25200 * .45) + 8100);
});

test('a four-vehicle route gives the same world for one long tick and many short frames', () => {
  const { game, route } = quarryFixture();
  for (let n = 0; n < 3; n++) addRouteVehicle(game, route.id);
  const frames = structuredClone(game);
  tick(game, 40);
  for (let n = 0; n < 160; n++) tick(frames, .25);
  equivalent(frames, game);
  assert.ok(route.delivered > 0);
});

test('a multi-vehicle route survives a save round trip', () => {
  const { game, route } = quarryFixture();
  for (let n = 0; n < 3; n++) addRouteVehicle(game, route.id);
  tick(game, 3.3);
  assert.equal(validateGame(game), true);
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(restored);
  assert.equal(restored.vehicles.filter(vehicle => vehicle.routeId === route.id).length, 4);
  assert.equal(validateGame(restored), true);
  assert.deepEqual(restored.vehicles.map(vehicle => vehicle.progress), game.vehicles.map(vehicle => vehicle.progress));
});

test('a fleet of 10,000 vehicles refuses more instead of producing an invalid save', () => {
  const { game, route } = quarryFixture(), template = game.vehicles[0];
  while (game.vehicles.length < 10000) game.vehicles.push({ ...template, id: `vehicle-cap-${game.vehicles.length}` });
  game.revision++;
  const money = game.money, stops = game.stations.map(stop => stop.id);
  assert.match(addRouteVehicle(game, route.id).message, /reached 10,000 vehicles/);
  assert.match(addRoute(game, { mode: 'road', cargo: 'stone', stops }).message, /reached 10,000 vehicles/);
  assert.equal(game.vehicles.length, 10000); assert.equal(game.money, money);
});

test('upgrades and retirement cover every vehicle on the route', () => {
  const { game, route } = quarryFixture();
  addRouteVehicle(game, route.id); addRouteVehicle(game, route.id);
  game.day = 365;
  const quote = getVehicleUpgrade(game, route.id);
  assert.equal(quote.vehicleCount, 3); assert.equal(quote.capacity, 72);
  assert.equal(quote.cost, 3 * getVehicleUpgrade({ ...game, vehicles: [game.vehicles[0]] }, route.id).cost);
  const refund = getRetirementRefund(game, route.id), money = game.money;
  assert.equal(refund, 3 * Math.round(VEHICLE_COSTS.road * .45));
  const retired = removeRoute(game, route.id);
  assert.equal(retired.refund, refund); assert.equal(game.money, money + refund); assert.equal(game.vehicles.length, 0);
});
