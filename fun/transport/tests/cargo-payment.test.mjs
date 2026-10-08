import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, build, buildPath, addRoute, editRoute, removeRoute, tick, fareFor, priceFor, distancePay, transitPay, scheduledDays, payTiles, travelTiles, recentTransitDays, drainDeliveryEvents, validateGame, restoreGame, refreshRouteConnections, CARGO } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { TRANSIT_CLASSES, TRANSIT_PAY_FLOOR } from '../data.js';
import { emptyGame, line, completeFixtureConstruction } from './helpers.mjs';

// A producer at x=10 and a buyer (a sawmill, or a town for food) `L` tiles east along one road.
function freight(L = 20, cargo = 'timber', mode = 'road') {
  const game = emptyGame(), pairs = { timber: ['logging-camp', 'sawmill'], food: ['food-plant', null] };
  const [source, buyer] = pairs[cargo];
  assert.equal(build(game, source, 10, 7).ok, true);
  if (buyer) assert.equal(build(game, buyer, 10 + L - 1, 7).ok, true);
  else { game.cities.push({ id: 'town', name: 'Town', x: 10 + L, y: 9, population: 900, activity: 0, passengers: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null }); game.revision++; }
  completeFixtureConstruction(game, ...game.industries);
  assert.equal(buildPath(game, mode, line(10, 10 + L, 12)).ok, true);
  for (const x of [10, 10 + L]) assert.equal(build(game, mode === 'road' ? 'bus-stop' : 'train-stop', x, 12).ok, true);
  game.industries[0].inventory[cargo] = 500;
  const launched = addRoute(game, { mode, cargo, stops: game.stations.map(stop => stop.id) });
  assert.equal(launched.ok, true, launched.message);
  return { game, route: launched.route, vehicle: game.vehicles[0] };
}
const arriveAt = (vehicle, route, day, game) => { game.day = day; vehicle.progress = route.path.length - 1.1; vehicle.x = route.path.at(-1).x - .1; };

test('every cargo has a transit class; pay is flat, then falls, never below the floor', () => {
  for (const [key, cargo] of Object.entries(CARGO)) assert.ok(TRANSIT_CLASSES[cargo.transit], `${key} has a class`);
  const members = cls => Object.keys(CARGO).filter(key => CARGO[key].transit === cls).sort();
  assert.deepEqual(members('express'), ['mail', 'passengers']);
  assert.deepEqual(members('perishable'), ['fish', 'food', 'goods', 'milk', 'produce']);
  assert.deepEqual(members('standard'), ['cement', 'fuel', 'furniture', 'glass', 'grain', 'livestock', 'lumber', 'machinery', 'steel', 'wire']);
  assert.deepEqual(members('bulk'), ['coal', 'copper', 'iron', 'oil', 'sand', 'stone', 'timber']);
  for (const [days, pay] of [[undefined, 1], [NaN, 1], [0, 1], [14, 1], [15, .985], [24, .85], [48, .5], [400, .5]]) assert.ok(Math.abs(transitPay('passengers', days) - pay) < 1e-12, `${days} days pay ${transitPay('passengers', days)}`);
  assert.equal(transitPay('coal', 45), 1); assert.ok(Math.abs(transitPay('coal', 70) - .9) < 1e-12);
  for (const key of Object.keys(CARGO)) for (let d = 1; d <= 400; d++) assert.ok(transitPay(key, d) <= transitPay(key, d - 1) && transitPay(key, d) >= TRANSIT_PAY_FLOOR, `${key} on day ${d}`);
  assert.ok(Math.abs(distancePay(24) - 4) < 1e-12); assert.ok(Math.abs(distancePay(0) - 4 / 3) < 1e-12);
  assert.ok(distancePay(40) / distancePay(10) > 2.3 && distancePay(80) / distancePay(10) > 4.1, 'fares grow in a straight line with distance');
});

test('fareFor is the distance fare times the transit share', () => {
  const game = emptyGame();
  assert.equal(fareFor(game, 'timber', 21, 10), priceFor(game, 10 * 22 * distancePay(20)));
  assert.equal(fareFor(game, 'timber', 21, 10, game.day, 45), fareFor(game, 'timber', 21, 10), 'bulk keeps full pay for 45 days');
  assert.equal(fareFor(game, 'food', 21, 10, game.day, 26), priceFor(game, 10 * 54 * distancePay(20) * transitPay('food', 26)));
});

test('a delivery is paid by its calendar days since boarding', () => {
  const { game, route, vehicle } = freight(20, 'food');
  assert.equal(vehicle.loadedDay, 0, 'the first load boards on day 0');
  arriveAt(vehicle, route, 40, game);
  const units = vehicle.load; tick(game, .25);
  assert.equal(route.delivered, units);
  assert.equal(route.revenue, fareFor(game, 'food', 21, units, game.day, 40));
  assert.ok(Math.abs(transitPay('food', 40) - .712) < 1e-9);
  assert.equal(recentTransitDays(game, route.id), 40);
});

test('legacy cargo without a boarding day is paid by distance only', () => {
  const { game, route, vehicle } = freight(20, 'food');
  delete vehicle.loadedDay; arriveAt(vehicle, route, 200, game);
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(restored); assert.equal(Object.hasOwn(restored.vehicles[0], 'loadedDay'), false, 'restoring adds no boarding day');
  const units = restored.vehicles[0].load; tick(restored, .25);
  assert.equal(restored.routes[0].revenue, fareFor(restored, 'food', 21, units, restored.day));
  assert.equal(restored.vehicles[0].loadedDay, undefined, 'an empty truck keeps no clock until it loads');
});

test('freight nobody at the end takes stays aboard and restarts its clock, so it is paid like a fresh load; a full buyer still takes it', () => {
  const { game, vehicle, route } = freight(20);
  game.industries = game.industries.slice(0, 1); game.revision++;
  arriveAt(vehicle, route, 10, game);
  tick(game, .25);
  assert.ok(vehicle.load > 0); assert.equal(route.delivered, 0); assert.equal(vehicle.loadedDay, 10);
  const full = freight(20);
  full.game.industries[1].inventory.timber = 1e9;
  arriveAt(full.vehicle, full.route, 10, full.game);
  const units = full.vehicle.load; tick(full.game, .25);
  assert.equal(full.route.delivered, units, 'a buyer with full stores takes and pays for the load');
  assert.equal(full.route.revenue, fareFor(full.game, 'timber', 21, units, full.game.day, 10));
});

test('cargo on a broken connection restarts its clock when the route runs again', () => {
  const { game, vehicle } = freight(20);
  tick(game, 2); const boarded = vehicle.loadedDay;
  assert.ok(vehicle.load > 0);
  assert.equal(build(game, 'bulldoze', 20, 12).ok, true); refreshRouteConnections(game);
  assert.equal(game.routes[0].active, false);
  tick(game, 30); assert.equal(vehicle.loadedDay, boarded, 'a stopped route keeps the clock');
  assert.equal(build(game, 'road', 20, 12).ok, true); tick(game, .25);
  assert.equal(game.routes[0].active, true); assert.equal(vehicle.loadedDay, 32, 'the repaired route dispatches its cargo afresh');
});

test('newer vehicles keep more of the fare on a long time-sensitive route', () => {
  const pay = level => {
    const { game, route, vehicle } = freight(110, 'food'); vehicle.level = level;
    for (let d = 0; d < 200; d++) { game.industries[0].inventory.food = 500; tick(game, 1); }
    return route.revenue / route.delivered;
  };
  const gen1 = pay(0), gen7 = pay(6);
  assert.ok(gen7 > gen1 * 1.05, `gen 1 ${gen1.toFixed(1)}, gen 7 ${gen7.toFixed(1)} a unit`);
});

test('the starter bus is paid the full new fare for its real days on the way', () => {
  const game = createGame({ size: 'regional', seed: 1847 }), route = game.routes[0], trips = [];
  drainDeliveryEvents(game);
  for (let step = 0; step < 365 * 4; step++) {
    const boarded = game.vehicles.find(vehicle => vehicle.routeId === route.id).loadedDay;
    tick(game, .25);
    for (const event of drainDeliveryEvents(game)) if (event.routeId === route.id) {
      const days = Math.floor(event.day) - boarded;
      trips.push(days);
      assert.equal(event.revenue, fareFor(game, 'passengers', payTiles(route.path) + 1, event.amount, event.day, days), `delivery on day ${event.day}`);
    }
  }
  assert.ok(trips.length > 30, `${trips.length} deliveries`);
  assert.ok(trips.every(days => days >= 8 && days <= 12), JSON.stringify(trips));
  assert.ok(trips.every(days => transitPay('passengers', days) === 1), 'the starter bus always keeps the full fare');
});

test('frame partitions give the same boarding days and money', () => {
  const { game } = freight(70, 'food');
  const quarter = structuredClone(game), odd = structuredClone(game);
  tick(game, 90);
  for (let i = 0; i < 360; i++) tick(quarter, .25);
  for (let i = 0; i < 60; i++) for (const step of [.125, .375, .0625, .9375]) tick(odd, step);
  assert.ok(game.routes[0].delivered > 0);
  for (const other of [quarter, odd]) {
    assert.equal(other.money, game.money); assert.equal(other.routes[0].revenue, game.routes[0].revenue);
    assert.equal(other.vehicles[0].loadedDay, game.vehicles[0].loadedDay);
  }
});

test('boarding days save, restore and validate', () => {
  const { game } = freight(20); tick(game, 30);
  for (let i = 1; i < 80; i++) game.vehicles.push({ ...game.vehicles[0], id: `v-${i}`, loadedDay: i % 3 ? 12 : 12.5 });
  game.revision++;
  const encoded = JSON.parse(JSON.stringify(encodeGame(game)));
  assert.ok(Object.hasOwn(encoded.state, 'vehicleSchemas'), 'the fleet is packed');
  const restored = restoreGame(encoded);
  assert.ok(restored); assert.deepEqual(restored.vehicles.map(v => v.loadedDay), game.vehicles.map(v => v.loadedDay));
  for (const bad of [-1, NaN, game.day + 1, '3']) { const copy = structuredClone(game); copy.vehicles[0].loadedDay = bad; assert.equal(validateGame(copy), false, String(bad)); }
  assert.equal(validateGame(game), true);
});

test('the timetable estimate reads the shared base speeds', () => {
  assert.equal(scheduledDays('road', 40, 0), 40 / (2.8 * .88) + .2);
  assert.ok(scheduledDays('rail', 40, 0) < scheduledDays('road', 40, 0));
  assert.ok(scheduledDays('road', 40, 5) < scheduledDays('road', 40, 0));
  assert.equal(scheduledDays('road', 0, 0), 0); assert.equal(scheduledDays('balloon', 10, 0), 0);
  assert.equal(travelTiles('road', line(0, 5, 0)), 5); assert.equal(travelTiles('air', [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]), 5);
});

test('a detour pays at most twice the grid distance between the stops', () => {
  const game = emptyGame();
  assert.equal(build(game, 'coal-mine', 16, 7).ok, true);
  assert.equal(build(game, 'steel-mill', 33, 7).ok, true);
  completeFixtureConstruction(game, ...game.industries);
  const U = [...Array.from({ length: 71 }, (_, i) => ({ x: 20, y: 12 + i })), ...line(21, 32, 82), ...Array.from({ length: 70 }, (_, i) => ({ x: 32, y: 81 - i }))];
  assert.equal(buildPath(game, 'rail', U).ok, true);
  for (const x of [20, 32]) assert.equal(build(game, 'train-stop', x, 12).ok, true);
  game.industries[0].inventory.coal = 500;
  const launched = addRoute(game, { mode: 'rail', cargo: 'coal', stops: game.stations.map(stop => stop.id) });
  assert.equal(launched.ok, true, launched.message);
  assert.equal(launched.route.path.length - 1, 152);
  assert.equal(payTiles(launched.route.path), 24);
  assert.equal(payTiles([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), 2);
  drainDeliveryEvents(game);
  for (let d = 0; d < 80 && !launched.route.delivered; d++) tick(game, 1);
  const [delivery] = drainDeliveryEvents(game);
  assert.ok(delivery, 'the train delivers along the U');
  assert.equal(delivery.revenue, fareFor(game, 'coal', 25, delivery.amount, delivery.day, Math.floor(delivery.day)));
});

test('an edit dispatches cargo aboard afresh and forgets the old trips', () => {
  const { game, route, vehicle } = freight(20);
  assert.equal(buildPath(game, 'road', line(30, 32, 12)).ok, true);
  assert.equal(build(game, 'bus-stop', 32, 12).ok, true);
  for (let d = 0; d < 60 && !(route.delivered > 0 && vehicle.load > 0); d++) tick(game, 1);
  assert.ok(route.delivered > 0 && vehicle.load > 0, 'a loaded truck after a delivery');
  assert.notEqual(recentTransitDays(game, route.id), null);
  tick(game, .5);
  const edited = editRoute(game, route.id, { stops: [route.stops[0], game.stations[2].id], cargo: 'timber' });
  assert.equal(edited.ok, true, edited.message);
  assert.equal(vehicle.loadedDay, Math.floor(game.day)); assert.equal(recentTransitDays(game, route.id), null);
});

test('retiring a route forgets its trips', () => {
  const { game, route } = freight(20);
  for (let d = 0; d < 30 && !route.delivered; d++) tick(game, 1);
  assert.notEqual(recentTransitDays(game, route.id), null);
  assert.equal(removeRoute(game, route.id).ok, true);
  assert.equal(recentTransitDays(game, route.id), null);
});
