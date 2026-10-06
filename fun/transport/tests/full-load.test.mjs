import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, addRoute, addRouteVehicle, setRouteFullLoad, waitingForFullLoad, FULL_LOAD_MAX_WAIT, createGame, tick, validateGame, restoreGame } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { routeHealth } from '../gameplay-insights.js';
import { emptyGame, line, advance, equivalent } from './helpers.mjs';

const town = (id, x, y) => ({ id, name: id, x, y, population: 300, passengers: 100, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null });
const own = (object, key) => Object.hasOwn(object, key);
const waiting = game => game.vehicles.filter(waitingForFullLoad);
// The whole saved company, less the caches a restore rebuilds.
const content = game => { const { tiles, maintenanceRevision, ...state } = game; return { ...state, routes: state.routes.map(({ pathRevision, ...route }) => route) }; };

// A logging camp 20 road tiles from a sawmill with an empty timber store, and a stop beside each.
function timberFixture({ fullLoad, trucks = 1 } = {}) {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 9).ok, true);
  assert.equal(build(game, 'sawmill', 30, 9).ok, true);
  assert.equal(buildPath(game, 'road', line(10, 30, 12)).ok, true);
  for (const x of [10, 30]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  const camp = game.industries[0]; camp.inventory.timber = 0;
  const launched = addRoute(game, { mode: 'road', cargo: 'timber', stops: game.stations.map(stop => stop.id), ...fullLoad === undefined ? {} : { fullLoad } });
  assert.equal(launched.ok, true, launched.message);
  for (let n = 1; n < trucks; n++) assert.equal(addRouteVehicle(game, launched.route.id).ok, true);
  return { game, route: launched.route, camp };
}

test('full load is off by default: routes and vehicles never gain its fields, and saves never mention it', () => {
  const { game, route } = timberFixture(), freight = addRoute(game, { mode: 'road', cargo: 'timber', stops: route.stops, fullLoad: false }).route;
  assert.equal(own(route, 'fullLoad'), false); assert.equal(own(freight, 'fullLoad'), false, 'an explicit false keeps the default shape');
  advance(game, 90, tick);
  assert.ok(route.delivered > 0);
  assert.equal(game.vehicles.some(vehicle => own(vehicle, 'fullLoadSince')), false);
  assert.equal(JSON.stringify(encodeGame(game)).includes('fullLoad'), false);
  const world = createGame({ size: 'regional', seed: 1847 });
  for (let day = 0; day < 365; day++) tick(world, 1);
  assert.equal(world.vehicles.some(vehicle => own(vehicle, 'fullLoadSince')) || world.routes.some(item => own(item, 'fullLoad')), false);
  assert.equal(JSON.stringify(encodeGame(world)).includes('fullLoad'), false, 'a year of a generated company saves as before');
});

test('a truck launched with full load at an empty store waits at the start, and every delivery is a full load', () => {
  const { game, route } = timberFixture({ fullLoad: true }), truck = game.vehicles[0];
  assert.equal(route.fullLoad, true);
  assert.deepEqual([truck.fullLoadSince, truck.progress, truck.load, truck.capacity], [game.day, 0, 0, 24]);
  const dwell = truck.dwellRemaining;
  tick(game, .9);
  assert.equal(truck.progress, 0, 'the truck holds at the loading stop');
  assert.equal(truck.dwellRemaining, dwell, 'its dwell is kept for after the wait');
  const deliveries = [];let delivered = route.delivered;
  for (let step = 0; step < 120 * 4; step++) { tick(game, .25); if (route.delivered !== delivered) { deliveries.push(route.delivered - delivered); delivered = route.delivered; } }
  assert.ok(deliveries.length >= 2, `deliveries: ${deliveries}`);
  assert.ok(deliveries.every(amount => amount === 24), `every delivery is a full load: ${deliveries}`);
});

test('trucks wait in arrival order: only the earliest waiting truck holds cargo', () => {
  const { game } = timberFixture({ fullLoad: true, trucks: 3 });
  let lines = 0;
  for (let day = 0; day < 200; day++) {
    tick(game, 1);
    const queue = waiting(game).sort((a, b) => a.fullLoadSince - b.fullLoadSince);
    for (const truck of queue.slice(1)) assert.equal(truck.load, 0, `day ${game.day}: ${truck.id} waits behind ${queue[0].id}`);
    if (queue.length > 1) lines++;
  }
  assert.ok(lines > 0, 'trucks did form a line');
});

test('a truck waits a month at most, and a sawmill short of timber still reads Needs timber while it waits', () => {
  const game = emptyGame();
  assert.equal(build(game, 'sawmill', 10, 9).ok, true);
  assert.equal(build(game, 'furniture-factory', 30, 8).ok, true);
  assert.equal(buildPath(game, 'road', line(10, 30, 12)).ok, true);
  for (const x of [10, 30]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  const sawmill = game.industries[0]; sawmill.inventory.lumber = 5; sawmill.inventory.timber = 0;
  const launched = addRoute(game, { mode: 'road', cargo: 'lumber', stops: game.stations.map(stop => stop.id), fullLoad: true }), route = launched.route, truck = game.vehicles[0];
  assert.equal(launched.ok, true, launched.message); assert.equal(game.day, 0);
  assert.deepEqual([truck.load, truck.progress, truck.fullLoadSince], [5, 0, 0], 'it loads what there is and holds');
  tick(game, 3);
  assert.equal(truck.progress, 0);
  assert.equal(routeHealth(game, route).label, 'Needs timber', 'a missing input still says what would help');
  while (game.day < FULL_LOAD_MAX_WAIT - .25) { tick(game, .25); assert.equal(truck.fullLoadSince, 0, `still waiting on day ${game.day}`); }
  tick(game, .25);
  assert.equal(game.day, 30);
  assert.equal(truck.fullLoadSince, null, 'the daily step of day 30 lets it go');
  assert.equal(truck.load, 5);
  tick(game, 1);
  assert.ok(truck.progress > 0, 'it leaves with what it has');
});

test('bulldozing the only supplier lets a waiting truck go at the next day', () => {
  const { game, camp } = timberFixture({ fullLoad: true }), truck = game.vehicles[0];
  tick(game, 2.5);
  assert.equal(waitingForFullLoad(truck), true);
  assert.equal(build(game, 'bulldoze', camp.x, camp.y).ok, true);
  tick(game, .25);
  assert.equal(waitingForFullLoad(truck), true, 'the wait holds until the daily retry');
  tick(game, .25);
  assert.equal(game.day, 3);
  assert.equal(truck.fullLoadSince, null, 'the retry finds no supplier');
});

test('full load is for freight: vehicles wait only at the loading stop, and passenger and mail routes refuse it', () => {
  const { game } = timberFixture({ fullLoad: true, trucks: 3 });
  let waits = 0;
  for (let day = 0; day < 200; day++) { tick(game, 1); for (const truck of waiting(game)) { waits++; assert.deepEqual([truck.progress, truck.direction], [0, 1], `day ${game.day}`); } }
  assert.ok(waits > 0);
  const towns = emptyGame();
  towns.cities = [town('west', 10, 10), town('east', 40, 10)];
  assert.equal(buildPath(towns, 'road', line(10, 40, 12)).ok, true);
  for (const x of [10, 40]) assert.equal(build(towns, 'bus-stop', x, 12).ok, true);
  const stops = towns.stations.map(stop => stop.id), money = towns.money;
  for (const cargo of ['passengers', 'mail']) {
    const refused = addRoute(towns, { mode: 'road', cargo, stops, fullLoad: true });
    assert.deepEqual([refused.ok, refused.message], [false, 'Full load is for freight routes.']);
  }
  assert.deepEqual([towns.money, towns.routes.length], [money, 0], 'a refused launch spends nothing');
  const bus = addRoute(towns, { mode: 'road', cargo: 'passengers', stops }).route, mail = addRoute(towns, { mode: 'road', cargo: 'mail', stops }).route;
  for (const route of [bus, mail]) assert.equal(setRouteFullLoad(towns, route.id, true).message, 'Full load is for freight routes.');
  assert.equal(own(bus, 'fullLoad'), false);
  towns.vehicles[0].fullLoadSince = towns.day;
  tick(towns, 1);
  assert.equal(towns.vehicles[0].fullLoadSince, null, 'a bus never keeps a wait');
});

test('the order turns on and off only as asked, and turning it off lets the line leave', () => {
  const { game, route } = timberFixture({ trucks: 3 }), stop = game.stations[0].name;
  assert.deepEqual([setRouteFullLoad(game, route.id, 'yes').message, setRouteFullLoad(game, 'route-missing', true).message, setRouteFullLoad(game, route.id, false).message], ['Choose on or off.', 'Route not found.', 'Nothing to change.']);
  const revision = game.revision, money = game.money, on = setRouteFullLoad(game, route.id, true);
  assert.equal(on.ok, true);
  assert.equal(on.message, `Trucks on ${route.name} wait at ${stop} for a full load, for a month at most.`);
  assert.deepEqual([route.fullLoad, game.revision, game.money], [true, revision + 1, money]);
  assert.equal(setRouteFullLoad(game, route.id, true).message, 'Nothing to change.');
  for (let day = 0; day < 120 && waiting(game).length < 2; day++) tick(game, 1);
  const line = waiting(game);
  assert.ok(line.length >= 2, 'the trucks start waiting at their next arrival');
  const off = setRouteFullLoad(game, route.id, false);
  assert.deepEqual([off.ok, off.message], [true, `Trucks on ${route.name} leave as soon as they have loaded.`]);
  assert.equal(route.fullLoad, false); assert.equal(waiting(game).length, 0);
  assert.ok(line.every(truck => truck.fullLoadSince === null && own(truck, 'fullLoadSince')), 'a finished wait is null, never deleted');
  tick(game, 1);
  assert.ok(line.every(truck => truck.progress > 0), 'the line leaves');
  const spent = game.money, routes = game.routes.length, refused = addRoute(game, { mode: 'road', cargo: 'timber', stops: route.stops, fullLoad: 'yes' });
  assert.deepEqual([refused.ok, refused.message, game.money, game.routes.length], [false, 'Choose on or off.', spent, routes]);
});

test('a waiting truck costs the idle 45%, like one on a broken route; standing without the order costs in full', () => {
  const [held, standing, broken] = ['held', 'standing', 'broken'].map(variant => {
    const { game, route } = timberFixture({ fullLoad: true }), truck = game.vehicles[0];
    tick(game, 2.5);
    assert.equal(waitingForFullLoad(truck), true);
    if (variant === 'standing') { truck.fullLoadSince = null; truck.dwellRemaining = 3; }
    if (variant === 'broken') { truck.fullLoadSince = null; route.active = false; }
    const before = route.expenses;
    tick(game, .5);
    return route.expenses - before;
  });
  assert.equal(held, broken);
  assert.ok(standing > held, `${held} ${standing} ${broken}`);
});

test('whole days, quarter days and sevenths of a day give the same queue', () => {
  const run = (step, count) => { const { game } = timberFixture({ fullLoad: true, trucks: 4 }); for (let n = 0; n < count; n++) tick(game, step); return game; };
  const whole = run(40, 1), quarters = run(.25, 160), sevenths = run(1 / 7, 280);
  assert.ok(whole.routes[0].delivered > 0);
  equivalent(content(quarters), content(whole));
  equivalent(content(sevenths), content(whole));
});

test('a company saved mid-wait resumes the same line', () => {
  const { game, route } = timberFixture({ fullLoad: true });
  game.money = 1e7;
  while (game.vehicles.length < 70) assert.equal(addRouteVehicle(game, route.id).ok, true);
  tick(game, 50);
  const encoded = encodeGame(game), restored = restoreGame(JSON.parse(JSON.stringify(encoded))), line = g => g.vehicles.filter(waitingForFullLoad).map(vehicle => [vehicle.id, vehicle.fullLoadSince]);
  assert.ok(encoded.state.vehicleSchemas, 'the fleet is packed');
  assert.ok(restored); assert.equal(validateGame(restored), true);
  assert.ok(line(game).length > 1);
  assert.deepEqual(line(restored), line(game));
  assert.equal(restored.routes[0].fullLoad, true);
  tick(game, 60); tick(restored, 60);
  equivalent(content(restored), content(game));
});

test('waiting spends no ids and sends no notices', () => {
  const { game } = timberFixture({ fullLoad: true, trucks: 2 }), nextId = game.nextId, notices = game.notifications.length;
  for (let n = 0; n < 40; n++) { tick(game, .25); assert.ok(waiting(game).length, `day ${game.day}`); }
  assert.deepEqual([game.nextId, game.notifications.length], [nextId, notices]);
});

test('a truck added at the loading stop of a full-load route joins the line at once', () => {
  const { game, route } = timberFixture({ fullLoad: true }), first = game.vehicles[0], L = route.path.length - 1;
  tick(game, 2.5);
  Object.assign(first, { progress: L, direction: -1, fullLoadSince: null }); game.revision++;
  const added = addRouteVehicle(game, route.id).vehicle;
  assert.deepEqual([added.progress, added.direction, added.fullLoadSince], [0, 1, 2.5]);
  const other = addRouteVehicle(game, route.id).vehicle;
  assert.equal(own(other, 'fullLoadSince'), false, 'a truck started on the way does not wait');
});
