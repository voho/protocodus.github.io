import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, addRouteVehicle, build, buildPath, drainDeliveryEvents, fareFor, getVehiclePurchase, payTiles, scheduledDays, tick, transitPay, VEHICLE_COSTS } from '../model.js';
import { keepText } from '../payment-rates.js';
import { defaultRouteName, filterRoutes, forecastRoute, routeCargoList, routeCargoOptions, validateRoutePlan } from '../route-planner.js';
import { routesNeedingAttention } from '../gameplay-insights.js';
import { emptyGame, line, tileAt } from './helpers.mjs';

function fixture(mode = 'road') {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 10).ok, true);
  assert.equal(build(game, 'sawmill', 30, 10).ok, true);
  assert.equal(buildPath(game, mode, line(10, 30, 12)).ok, true);
  const tool = mode === 'rail' ? 'train-stop' : 'bus-stop';
  assert.equal(build(game, tool, 10, 12).ok, true);
  assert.equal(build(game, tool, 30, 12).ok, true);
  return { game, draft: { mode, cargo: 'timber', from: game.stations[0].id, to: game.stations[1].id } };
}

for (const mode of ['road', 'rail']) {
  test(`${mode} route preview checks complete bridge and tunnel connectivity without launching`, () => {
    const { game, draft } = fixture(mode), money = game.money;
    const water = tileAt(game, 18, 12), mountain = tileAt(game, 22, 12);
    Object.assign(water, { terrain: 'water', bridge: true });
    Object.assign(mountain, { terrain: 'mountain', tunnel: true });
    game.networkRevision++;
    let plan = validateRoutePlan(game, draft);
    assert.equal(plan.valid, true);
    assert.equal(plan.connected, true);
    assert.equal(plan.path.length, 21);
    assert.match(plan.message, /20 tiles/);
    assert.equal(game.money, money);
    assert.equal(game.routes.length, 0);
    assert.equal(game.vehicles.length, 0);
    water.bridge = false; game.networkRevision++;
    plan = validateRoutePlan(game, draft);
    assert.equal(plan.valid, false);
    assert.equal(plan.state, 'disconnected');
    assert.match(plan.message, /aren’t joined by (road|rail)\. Build the missing (road|track), or pick another stop\.$/);
    water.bridge = true; mountain.tunnel = false; game.networkRevision++;
    assert.equal(validateRoutePlan(game, draft).connected, false, 'uncovered mountain breaks the network');
    mountain.tunnel = true; game.networkRevision++;
    assert.equal(validateRoutePlan(game, draft).valid, true, 'repair invalidates the cached path result');
  });
}

test('route preview rejects missing, identical and wrong-mode stops, and wrong cargo coverage', () => {
  const { game, draft } = fixture();
  for (const changes of [{ from: '' }, { to: '' }, { to: draft.from }, { mode: 'rail' }, { cargo: 'not-cargo' }]) {
    assert.equal(validateRoutePlan(game, { ...draft, ...changes }).valid, false, JSON.stringify(changes));
  }
  const mismatch = validateRoutePlan(game, { ...draft, cargo: 'coal' });
  assert.equal(mismatch.connected, true, 'physical connection remains visible separately from cargo demand');
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.message, /coal supplier and a buyer/);
  game.money = VEHICLE_COSTS.road - 1;
  assert.equal(validateRoutePlan(game, draft).valid, false);
  assert.match(validateRoutePlan(game, draft).message, /^Connected\. Need \$[\d,]+ for the first truck\.$/);
  game.money++;
  assert.equal(validateRoutePlan(game, draft).valid, true);
});

test('preview identifies reverse freight loading and agrees with launch orientation', () => {
  const { game, draft } = fixture();
  const reversed = { ...draft, from: draft.to, to: draft.from };
  const plan = validateRoutePlan(game, reversed);
  assert.equal(plan.valid, true);
  assert.equal(plan.reversed, true);
  assert.match(plan.message, /Loads at the end stop\.$/);
  const result = addRoute(game, { ...reversed, stops: [reversed.from, reversed.to] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.route.stops, [draft.from, draft.to]);
});

test('a plan for stops a route already serves names that route instead of a new service', () => {
  const { game, draft } = fixture();
  assert.equal(validateRoutePlan(game, draft).existingRouteId, null);
  const route = addRoute(game, { ...draft, stops: [draft.from, draft.to] }).route;
  assert.equal(validateRoutePlan(game, draft).existingRouteId, route.id);
  assert.equal(validateRoutePlan(game, { ...draft, from: draft.to, to: draft.from }).existingRouteId, route.id, 'freight compares its loading order after reversal');
  game.money = 0;
  assert.equal(validateRoutePlan(game, draft).existingRouteId, route.id, 'short funds still point at the existing service');
  game.money = 1e6;
  game.cities = [{ id: 'town-a', x: 10, y: 10 }, { id: 'town-b', x: 30, y: 10 }];
  const passengers = { ...draft, cargo: 'passengers' };
  assert.equal(validateRoutePlan(game, passengers).existingRouteId, null, 'another cargo is another service');
  const bus = addRoute(game, { ...passengers, stops: [draft.to, draft.from] }).route;
  assert.equal(validateRoutePlan(game, passengers).existingRouteId, bus.id, 'passenger stops match in either order');
});

test('passenger planning requires two different towns and refuses adjacent stops', () => {
  const { game, draft } = fixture();
  const passengers = { ...draft, cargo: 'passengers' };
  game.cities = [{ id: 'town-a', x: 10, y: 10 }];
  assert.equal(validateRoutePlan(game, passengers).valid, false);
  game.cities.push({ id: 'town-b', x: 30, y: 10 });
  assert.equal(validateRoutePlan(game, passengers).valid, true);
  game.stations[1].x = 11; game.networkRevision++;
  const close = validateRoutePlan(game, passengers);
  assert.equal(close.valid, false);
  assert.match(close.message, /too close/);
});

function quarryFixture() {
  const game = emptyGame();
  assert.equal(build(game, 'quarry', 10, 9).ok, true);
  game.cities = [{ id: 'town-a', name: 'Alderbrook', x: 30, y: 10 }];
  assert.equal(buildPath(game, 'road', line(10, 30, 12)).ok, true);
  assert.equal(build(game, 'bus-stop', 10, 12).ok, true);
  assert.equal(build(game, 'bus-stop', 30, 12).ok, true);
  const [quarry, town] = game.stations.map(stop => stop.id);
  return { game, draft: { mode: 'road', cargo: 'passengers', from: quarry, to: town } };
}
const fitting = options => options.filter(option => option.valid).map(option => option.cargo);

test('cargo options follow the chosen stops: a quarry stop and a town stop carry stone only', () => {
  const { game, draft } = quarryFixture();
  const options = routeCargoOptions(game, draft);
  assert.deepEqual(options.map(option => option.cargo).sort(), routeCargoList(game).slice().sort(), 'every biome cargo gets a verdict');
  assert.deepEqual(fitting(options), ['stone']);
  assert.deepEqual(options[0], { cargo: 'stone', valid: true, reversed: false, message: 'Connected by road, 20 tiles.' });
  assert.match(options.find(option => option.cargo === 'passengers').message, /each stop needs a different town/);
  const reversed = routeCargoOptions(game, { ...draft, from: draft.to, to: draft.from });
  assert.deepEqual(fitting(reversed), ['stone']);
  assert.equal(reversed[0].reversed, true, 'loading at the end stop is still a fit');
  assert.equal(game.routes.length, 0);
});

test('a town-to-town pair fits passengers and mail, and cargo options ignore funds', () => {
  const { game, draft } = quarryFixture();
  game.cities.push({ id: 'town-b', name: 'Pinehaven', x: 10, y: 14 });
  const passengers = { ...draft, from: draft.to, to: draft.from };
  game.industries = [];
  assert.deepEqual(fitting(routeCargoOptions(game, passengers)), ['passengers', 'mail']);
  game.money = 0;
  assert.match(validateRoutePlan(game, passengers).message, /^Connected\. Need \$[\d,]+ for the first bus\.$/);
  assert.equal(validateRoutePlan(game, passengers).valid, false);
  assert.equal(validateRoutePlan(game, passengers, { ignoreFunds: true }).valid, true);
  assert.deepEqual(fitting(routeCargoOptions(game, passengers)), ['passengers', 'mail'], 'short funds never hide a fitting cargo');
  const plan = validateRoutePlan(game, passengers, { ignoreFunds: true });
  assert.equal(defaultRouteName(game, plan, 'passengers'), 'Alderbrook – Pinehaven');
  assert.equal(defaultRouteName(game, plan, 'mail'), 'Alderbrook – Pinehaven mail');
});

test('default route names describe the freight flow after reversal', () => {
  const { game, draft } = quarryFixture();
  const forward = validateRoutePlan(game, { ...draft, cargo: 'stone' });
  assert.equal(defaultRouteName(game, forward, 'stone'), 'Stone quarry to Alderbrook');
  const reversed = validateRoutePlan(game, { ...draft, cargo: 'stone', from: draft.to, to: draft.from });
  assert.equal(reversed.reversed, true);
  assert.equal(defaultRouteName(game, reversed, 'stone'), 'Stone quarry to Alderbrook');
  const [a, b] = forward.stations;
  assert.equal(defaultRouteName(game, forward, 'coal'), `${a.name} to Alderbrook`, 'an end without its site falls back to its town, then its stop');
  game.cities[0].name = 'Alderbrook-upon-the-Northern-Pines';
  const long = defaultRouteName(game, forward, 'stone');
  assert.ok(long.length <= 36, long);
  assert.equal(long, 'Stone quarry to Alderbrook-upon-the…');
  assert.equal(defaultRouteName(game, validateRoutePlan(game, { ...draft, to: '' }), 'stone'), '');
});

test('connected stops without a shared cargo name what each end handles', () => {
  const { game, draft } = quarryFixture();
  game.cities = [];
  assert.equal(build(game, 'sawmill', 29, 9).ok, true);
  const options = routeCargoOptions(game, draft);
  assert.deepEqual(fitting(options), []);
  const gap = 'No cargo fits both stops. The start loads stone, and the end accepts timber.';
  assert.ok(options.length > 0 && options.every(option => option.message === gap));
  assert.equal(validateRoutePlan(game, draft).message, gap);
  game.cities = [{ id: 'town-a', name: 'Alderbrook', x: 30, y: 10 }];
  assert.match(validateRoutePlan(game, { ...draft, cargo: 'coal' }).message, /coal supplier and a buyer/, 'a single wrong cargo keeps its own advice');
});

test('disconnected stops give no cargo options', () => {
  const { game, draft } = quarryFixture();
  tileAt(game, 20, 12).road = false; game.networkRevision++;
  assert.equal(validateRoutePlan(game, { ...draft, cargo: 'stone' }).state, 'disconnected');
  assert.deepEqual(routeCargoOptions(game, draft), []);
  assert.deepEqual(routeCargoOptions(game, { ...draft, to: '' }), []);
});

test('route search combines stop, route, resource and vehicle terms with independent filters', () => {
  const game = {
    stations: [{ id: 'a', name: 'North Quarry' }, { id: 'b', name: 'Harbor Terminal' }, { id: 'c', name: 'Old Town' }],
    routes: [
      { id: 'one', name: 'Foundry Express', mode: 'rail', cargo: 'coal', active: true, stops: ['a', 'b'] },
      { id: 'two', name: 'Market Supply', mode: 'road', cargo: 'food', active: false, stops: ['b', 'c'] },
      { id: 'three', name: 'Coastal Shuttle', mode: 'road', cargo: 'passengers', active: true, stops: ['a', 'c'] },
    ],
  };
  const ids = filters => filterRoutes(game, filters).map(route => route.id);
  assert.deepEqual(ids({ query: 'NORTH coal' }), ['one']);
  assert.deepEqual(ids({ query: 'harbor' }), ['one', 'two']);
  assert.deepEqual(ids({ query: 'train' }), ['one']);
  assert.deepEqual(ids({ query: 'truck', status: 'disconnected', cargo: 'food', mode: 'road' }), ['two']);
  assert.deepEqual(ids({ query: 'bus', status: 'running' }), ['three']);
  assert.deepEqual(ids({ mode: 'rail', status: 'disconnected' }), []);
  assert.deepEqual(ids({ query: '  ', mode: 'all', cargo: 'all', status: 'all' }), ['one', 'two', 'three']);
  assert.equal(game.routes.length, 3, 'filtering never changes saved routes');
});

test('the needs-attention filter lists exactly the routes the top bar counts', () => {
  const { game, draft } = fixture();
  const stops = [draft.from, draft.to];
  for (const name of ['Timber one', 'Timber two']) assert.equal(addRoute(game, { name, mode: 'road', stops, cargo: 'timber' }).ok, true);
  const ids = () => filterRoutes(game, { status: 'attention' }).map(route => route.name);
  assert.deepEqual(ids(), [], 'routes waiting for cargo work normally');
  assert.equal(build(game, 'bulldoze', 30, 10).ok, true);
  assert.deepEqual(ids(), ['Timber one', 'Timber two'], 'both lost their buyer');
  assert.deepEqual(filterRoutes(game, { status: 'attention', query: 'two' }).map(route => route.name), ['Timber two']);
  assert.equal(filterRoutes(game, { status: 'attention' }).length, routesNeedingAttention(game));
  assert.equal(build(game, 'sawmill', 30, 8).ok, true);
  assert.deepEqual(ids(), [], 'a new buyer in reach clears them');
});

// A quarry and a town `tiles` apart on flat ground, joined by road or rail.
function quarryLine(mode, tiles) {
  const game = emptyGame(), end = 10 + tiles, tool = mode === 'rail' ? 'train-stop' : 'bus-stop';
  assert.equal(build(game, 'quarry', 10, 9).ok, true);
  game.cities = [{ id: 'town-a', name: 'Alderbrook', x: end, y: 10, population: 400, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null }];
  assert.equal(buildPath(game, mode, line(10, end, 12)).ok, true);
  assert.equal(build(game, tool, 10, 12).ok, true);
  assert.equal(build(game, tool, end, 12).ok, true);
  return { game, draft: { mode, cargo: 'stone', from: game.stations[0].id, to: game.stations[1].id } };
}
const simulate = (game, days) => { for (let n = 0; n < days * 2; n++) tick(game, .5); };
// Days 90–180 with a fleet of `count`: does the quarry's stock stop growing (by under a tenth of its output)?
function fleetClearsQuarry(mode, tiles, count) {
  const { game, draft } = quarryLine(mode, tiles), route = addRoute(game, { ...draft, stops: [draft.from, draft.to] }).route;
  for (let n = 1; n < count; n++) assert.equal(addRouteVehicle(game, route.id).ok, true);
  const quarry = game.industries[0];
  simulate(game, 90);
  const stock = quarry.inventory.stone, produced = quarry.totalProduced;
  simulate(game, 90);
  return quarry.inventory.stone - stock < (quarry.totalProduced - produced) * .1;
}

for (const mode of ['road', 'rail']) for (const tiles of [10, 40]) {
  test(`${mode} forecast over ${tiles} tiles is within 30% of 180 simulated days and sizes the fleet`, () => {
    const { game, draft } = quarryLine(mode, tiles), money = game.money, revision = game.revision;
    const forecast = forecastRoute(game, draft);
    assert.equal(game.money, money); assert.equal(game.revision, revision); assert.equal(game.routes.length, 0, 'forecasting changes nothing');
    assert.ok(forecast.perVehicleDay > 0 && forecast.supplyDay > 0, JSON.stringify(forecast));
    assert.equal(forecast.movedDay, Math.min(forecast.perVehicleDay, forecast.supplyDay));
    const route = addRoute(game, { ...draft, stops: [draft.from, draft.to] }).route;
    simulate(game, 180);
    const month = (route.revenue - route.expenses) / 6;
    assert.ok(Math.abs(month / forecast.netMonth - 1) <= .3, `forecast ${Math.round(forecast.netMonth)} vs simulated ${Math.round(month)} a month`);
    assert.ok(Math.abs(forecast.paybackMonths - forecast.cost / forecast.netMonth) < 1e-9);
    let fleet = 1;
    while (fleet < 12 && !fleetClearsQuarry(mode, tiles, fleet)) fleet++;
    assert.ok(Math.abs(forecast.vehiclesToSaturate - fleet) <= 1, `forecast ${forecast.vehiclesToSaturate} vehicles, simulated ${fleet}`);
  });
}

test('fareFor is the revenue of a real delivery', () => {
  const { game, draft } = quarryLine('road', 20);
  game.industries[0].inventory.stone = 60;
  const route = addRoute(game, { ...draft, stops: [draft.from, draft.to] }).route, boarded = game.vehicles[0].loadedDay;
  for (let step = 0; step < 400 && !route.revenue; step++) tick(game, .25);
  const [delivery] = drainDeliveryEvents(game);
  assert.equal(delivery.amount, 24);
  assert.equal(route.revenue, fareFor(game, 'stone', payTiles(route.path) + 1, delivery.amount, delivery.day, Math.floor(delivery.day) - boarded));
  assert.equal(forecastRoute(game, draft).fullLoad, fareFor(game, 'stone', route.path.length, 24));
});

test('the forecast times a trip and prices one unit after its days on the way', () => {
  const game = emptyGame(), level = getVehiclePurchase(game, 'road').level;
  assert.equal(build(game, 'food-plant', 10, 8).ok, true);
  game.cities = [{ id: 'town-a', name: 'Alderbrook', x: 120, y: 10, population: 900, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null }];
  assert.equal(buildPath(game, 'road', line(10, 120, 12)).ok, true);
  for (const x of [10, 120]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  const draft = { mode: 'road', cargo: 'food', from: game.stations[0].id, to: game.stations[1].id }, plan = validateRoutePlan(game, draft), forecast = forecastRoute(game, draft);
  assert.equal(plan.valid, true, plan.message);
  assert.deepEqual([forecast.tiles, forecast.travel], [110, 110]);
  assert.equal(forecast.days, Math.round(scheduledDays('road', 110, level)));
  assert.equal(forecast.share, transitPay('food', forecast.days)); assert.ok(forecast.share < 1, 'a 110-tile truck is slow for food');
  assert.equal(forecast.perUnit, fareFor(game, 'food', payTiles(plan.path) + 1, 1, game.day, forecast.days));
});

test('a ship forecast uses the timetable of ships', () => {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 10).ok, true);
  assert.equal(build(game, 'sawmill', 30, 10).ok, true);
  for (const point of line(10, 30, 12)) Object.assign(tileAt(game, point.x, point.y), { terrain: 'water', detail: 'river', elevation: 0 });
  game.revision++; game.networkRevision++;
  for (const x of [10, 30]) assert.equal(build(game, 'port', x, 12).ok, true);
  const draft = { mode: 'water', cargo: 'timber', from: game.stations[0].id, to: game.stations[1].id }, ship = getVehiclePurchase(game, 'water'), forecast = forecastRoute(game, draft);
  assert.ok(Math.abs(forecast.perVehicleDay - ship.capacity / (2 * scheduledDays('water', 20, ship.level))) < 1e-9, `${forecast.perVehicleDay}`);
});

test('a slow bus plan learns that a train would keep the whole fare', () => {
  const plan = tiles => {
    const { game, draft } = quarryLine('road', tiles);
    game.industries = [];
    game.cities.push({ id: 'town-b', name: 'Pinehaven', x: 10, y: 10, population: 600, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null });
    const forecast = forecastRoute(game, { ...draft, cargo: 'passengers' });
    return { forecast, rail: forecast.otherModes.find(other => other.mode === 'rail') };
  };
  // 55 tiles take a bus 23 days and a train 14: the train keeps the whole fare.
  const near = plan(55);
  assert.ok(near.forecast.share < .9, `${near.forecast.share}`);
  assert.equal(near.rail.share, 1);
  assert.equal(keepText(near.rail.share, near.forecast.share), ' and keep 100% of the fare');
  const far = plan(80);
  assert.equal(keepText(far.rail.share, far.forecast.share), ' and keep 91% of the fare', 'at 80 tiles a train keeps 91%, a bus 72%');
});

test('the forecast waits for fitting stops and cargo, and is cached per day and fleet', () => {
  const { game, draft } = quarryLine('road', 20);
  assert.equal(forecastRoute(game, { ...draft, to: '' }), null);
  assert.equal(forecastRoute(game, { ...draft, cargo: 'coal' }), null);
  game.money = 0;
  const forecast = forecastRoute(game, draft);
  assert.ok(forecast.netMonth > 0, 'short funds still show the outlook');
  assert.equal(forecastRoute(game, draft), forecast, 'the same day reuses the forecast');
  assert.equal(forecastRoute(game, { ...draft, from: draft.to, to: draft.from }).supplyDay, forecast.supplyDay, 'loading at the end stop forecasts the same flow');
  assert.ok(forecast.otherModes.find(other => other.mode === 'rail').ratio > 4, 'a train carries several trucks’ worth');
  assert.equal(forecast.joining, false);
});

test('another vehicle on a served route shares what is left of the supply', () => {
  const { game, draft } = quarryLine('road', 10);
  const first = forecastRoute(game, draft);
  const route = addRoute(game, { ...draft, stops: [draft.from, draft.to] }).route;
  const second = forecastRoute(game, draft);
  assert.equal(second.joining, true);
  assert.ok(second.supplyDay < first.supplyDay && second.supplyDay > 0, `${second.supplyDay} of ${first.supplyDay}`);
  assert.equal(second.vehiclesToSaturate, first.vehiclesToSaturate - 1);
  while (game.vehicles.length < first.vehiclesToSaturate) assert.equal(addRouteVehicle(game, route.id).ok, true);
  const full = forecastRoute(game, draft);
  assert.equal(full.supplyDay, 0);
  assert.equal(full.vehiclesToSaturate, 0);
  assert.ok(full.netMonth < 0, 'a vehicle with nothing to carry costs its upkeep');
  assert.equal(full.paybackMonths, Infinity);
});

test('a bus forecast carries both towns’ passengers both ways', () => {
  const { game, draft } = quarryLine('road', 20);
  game.industries = [];
  game.cities.push({ id: 'town-b', name: 'Pinehaven', x: 10, y: 10, population: 600, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null });
  const freight = quarryLine('road', 20), bus = forecastRoute(game, { ...draft, cargo: 'passengers' }), truck = forecastRoute(freight.game, freight.draft);
  assert.ok(Math.abs(bus.perVehicleDay - truck.perVehicleDay * 2) < 1e-9, 'a bus loads at both ends');
  assert.ok(bus.supplyDay > 0 && bus.netMonth > 0, JSON.stringify(bus));
  assert.ok(bus.vehiclesToSaturate >= 1);
});
