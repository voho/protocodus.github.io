import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, addRouteVehicle, build, buildPath, drainDeliveryEvents, fareFor, getVehiclePurchase, payTiles, refreshRouteConnections, scheduledDays, tick, transitPay, VEHICLE_COSTS } from '../model.js';
import { freightFits, stationCoverage, stationServes } from '../model.js';
import { keepText } from '../payment-rates.js';
import { defaultRouteName, filterRoutes, forecastRoute, routeAvailableCargo, routeCargoList, routeCargoOptions, validateRoutePlan } from '../route-planner.js';
import { routesNeedingAttention } from '../gameplay-insights.js';
import { emptyGame, line, tileAt, completeFixtureConstruction } from './helpers.mjs';
import { FULL_LOAD_MAX_WAIT } from '../model.js';
import { fullFareText } from '../route-planner.js';
import { money } from '../copy.js';

function fixture(mode = 'road') {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 8).ok, true);
  assert.equal(build(game, 'sawmill', 30, 8).ok, true);
  completeFixtureConstruction(game, ...game.industries);
  assert.equal(buildPath(game, mode, line(10, 30, 13)).ok, true);
  const tool = mode === 'rail' ? 'train-stop' : 'bus-stop';
  assert.equal(build(game, tool, 10, 13).ok, true);
  assert.equal(build(game, tool, 30, 13).ok, true);
  return { game, draft: { mode, cargo: 'timber', from: game.stations[0].id, to: game.stations[1].id } };
}

for (const mode of ['road', 'rail']) {
  test(`${mode} route preview checks complete bridge and tunnel connectivity without launching`, () => {
    const { game, draft } = fixture(mode), money = game.money;
    const water = tileAt(game, 18, 13), mountain = tileAt(game, 22, 13);
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

test('passengers and mail between stops serving the same town explain the different-town requirement', () => {
  const game = emptyGame();
  game.cities = [{ id: 'town-shared', name: 'Alderbrook', x: 14, y: 13 }];
  assert.equal(buildPath(game, 'road', line(10, 18, 13)).ok, true);
  for (const x of [10, 18]) assert.equal(build(game, 'bus-stop', x, 13).ok, true);
  const [from, to] = game.stations;
  for (const stop of [from, to]) {
    const coverage = stationCoverage(game, stop);
    assert.deepEqual(coverage.cities.map(city => city.id), ['town-shared']);
    for (const cargo of ['passengers', 'mail']) {
      assert.ok(coverage.produces.includes(cargo));
      assert.ok(coverage.accepts.includes(cargo));
    }
  }
  const before = JSON.stringify({ money: game.money, revision: game.revision, cities: game.cities, stations: game.stations, routes: game.routes, vehicles: game.vehicles });
  const draft = { mode: 'road', from: from.id, to: to.id }, options = routeCargoOptions(game, draft);
  for (const cargo of ['passengers', 'mail']) {
    const plan = validateRoutePlan(game, { ...draft, cargo });
    assert.equal(plan.connected, true);
    assert.equal(plan.valid, false);
    assert.equal(plan.message, 'Connected. Each stop must serve a different town within 4 tiles.');
    assert.equal(options.find(option => option.cargo === cargo).message, plan.message);
  }
  assert.equal(JSON.stringify({ money: game.money, revision: game.revision, cities: game.cities, stations: game.stations, routes: game.routes, vehicles: game.vehicles }), before, 'clarifying the verdict changes no world state');
});

test('route advice and coverage use each endpoint’s new or legacy reach', () => {
  const {game,draft}=fixture(),[from,to]=game.stations;
  game.cities=[{id:'a',name:'Alderbrook',x:from.x,y:from.y+5},{id:'b',name:'Brookby',x:to.x,y:to.y+4}];game.revision++;
  const passengers={...draft,cargo:'passengers'};
  assert.equal(validateRoutePlan(game,passengers).valid,false,'a new stop cannot reach a town five tiles away');
  from.catchmentRadius=5;
  assert.equal(validateRoutePlan(game,passengers).valid,true,'the restored start retains its town while the new end reaches four tiles');
  game.cities[1].y++;
  assert.equal(validateRoutePlan(game,passengers).message,'Connected. The start needs a town within 5 tiles and the end needs a different town within 4 tiles.');
  assert.equal(validateRoutePlan(game,{...draft,cargo:'coal'}).message,'Connected. Add a coal supplier within 5 tiles of the start and a buyer within 4 tiles of the end.');
  to.catchmentRadius=5;
  assert.equal(validateRoutePlan(game,passengers).valid,true,'both legacy endpoints keep their original reach');
  game.cities=[];game.revision++;
  assert.equal(validateRoutePlan(game,passengers).message,'Connected. Each stop must serve a different town within 5 tiles.');
});

function quarryFixture() {
  const game = emptyGame();
  assert.equal(build(game, 'quarry', 10, 7).ok, true);
  completeFixtureConstruction(game, game.industries[0]);
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
  assert.deepEqual(options.map(option => option.cargo).sort(), ['mail', 'passengers', 'stone'], 'only cargo supplied at either selected stop gets a verdict');
  assert.deepEqual(fitting(options), ['stone']);
  assert.deepEqual(options[0], { cargo: 'stone', valid: true, reversed: false, message: 'Connected by road, 20 tiles.' });
  assert.match(options.find(option => option.cargo === 'passengers').message, /Each stop must serve a different town/);
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
  assert.equal(defaultRouteName(game, plan, 'passengers'), 'Alderbrook – Pinehaven — passengers');
  assert.equal(defaultRouteName(game, plan, 'mail'), 'Alderbrook – Pinehaven — mail');
});

test('default route names describe the freight flow after reversal', () => {
  const { game, draft } = quarryFixture();
  const forward = validateRoutePlan(game, { ...draft, cargo: 'stone' });
  assert.equal(defaultRouteName(game, forward, 'stone'), 'Stone quarry to Alderbrook — stone');
  const reversed = validateRoutePlan(game, { ...draft, cargo: 'stone', from: draft.to, to: draft.from });
  assert.equal(reversed.reversed, true);
  assert.equal(defaultRouteName(game, reversed, 'stone'), 'Stone quarry to Alderbrook — stone');
  const [a, b] = forward.stations;
  assert.equal(defaultRouteName(game, forward, 'coal'), 'Stone quarry S… to Alderbrook — coal', 'an end without its site falls back to its town, then its stop');
  game.cities[0].name = 'Alderbrook-upon-the-Northern-Pines';
  const long = defaultRouteName(game, forward, 'stone');
  assert.ok(long.length <= 36, long);
  assert.equal(long, 'Stone quarry to Alderbrook-… — stone');
  assert.equal(defaultRouteName(game, validateRoutePlan(game, { ...draft, to: '' }), 'stone'), '');
});

test('freight auto names use a supplier stop’s town and preserve that town order after reverse loading', () => {
  const { game, draft } = quarryFixture();
  game.cities.push({ id: 'town-source', name: 'Alpha', x: 8, y: 12 }); game.revision++;
  const cargo = 'stone', forward = validateRoutePlan(game, { ...draft, cargo }), reverse = validateRoutePlan(game, { ...draft, cargo, from: draft.to, to: draft.from });
  assert.equal(forward.valid, true); assert.equal(reverse.reversed, true);
  assert.equal(defaultRouteName(game, forward, cargo), 'Alpha to Alderbrook — stone');
  assert.equal(defaultRouteName(game, reverse, cargo), 'Alpha to Alderbrook — stone');
});

test('connected stops without a shared cargo name what each end handles', () => {
  const { game, draft } = quarryFixture();
  game.cities = [];
  assert.equal(build(game, 'sawmill', 29, 7).ok, true);
  const options = routeCargoOptions(game, draft);
  assert.deepEqual(fitting(options), []);
  const gap = 'No cargo fits both stops. The start loads stone, and the end accepts timber.';
  assert.ok(options.length > 0 && options.every(option => option.message === gap));
  assert.equal(validateRoutePlan(game, { ...draft, cargo: 'stone' }).message, gap, 'shared freight gaps still explain what each end handles');
  game.cities = [{ id: 'town-a', name: 'Alderbrook', x: 30, y: 10 }];
  assert.match(validateRoutePlan(game, { ...draft, cargo: 'coal' }).message, /coal supplier and a buyer/, 'a single wrong cargo keeps its own advice');
});

test('disconnected stops keep their cargo choices and explain the missing connection', () => {
  const { game, draft } = quarryFixture();
  tileAt(game, 20, 12).road = false; game.networkRevision++;
  assert.equal(validateRoutePlan(game, { ...draft, cargo: 'stone' }).state, 'disconnected');
  const options = routeCargoOptions(game, draft);
  assert.deepEqual(options.map(option => option.cargo).sort(), ['mail', 'passengers', 'stone']);
  assert.ok(options.every(option => !option.valid && /aren’t joined by road/.test(option.message)));
  assert.deepEqual(routeCargoOptions(game, { ...draft, to: '' }), []);
});

test('available cargo follows suppliers at either endpoint and excludes buyers and distant suppliers', () => {
  const { game, draft } = fixture();
  assert.deepEqual(routeAvailableCargo(game, draft), ['timber', 'lumber'], 'the sawmill supplies lumber even though this pair has no lumber buyer');
  assert.equal(build(game, 'quarry', 50, 20).ok, true);
  assert.deepEqual(routeAvailableCargo(game, draft), ['timber', 'lumber'], 'a producer elsewhere cannot add a choice');
  game.industries[0].inventory.timber = 0;
  assert.ok(routeAvailableCargo(game, draft).includes('timber'), 'an active supplier can replenish an empty inventory');
  assert.deepEqual(routeAvailableCargo(game, { ...draft, to: '' }), []);
  assert.deepEqual(routeAvailableCargo(game, { ...draft, to: draft.from }), []);
  assert.deepEqual(routeAvailableCargo(game, { ...draft, mode: 'rail' }), []);
});

test('two empty stops still expose their connected preview before cargo is chosen', () => {
  const { game, draft } = fixture();
  game.industries = []; game.revision++;
  const plan = validateRoutePlan(game, { ...draft, cargo: '' });
  assert.equal(plan.valid, false); assert.equal(plan.connected, true); assert.equal(plan.path.length, 21);
  assert.equal(plan.message, 'Choose cargo available at these stops.');
  assert.deepEqual(routeCargoOptions(game, { ...draft, cargo: '' }), []);
  assert.match(validateRoutePlan(game, { ...draft, from: '', cargo: '' }).message, /Select a start stop/);
});

test('the route quote checks the entire vehicle order while cargo choices and forecasts remain visible', () => {
  const { game, draft } = quarryLine('road', 20), cost = getVehiclePurchase(game, 'road').cost * 3;
  game.money = cost - 1;
  const plan = validateRoutePlan(game, { ...draft, vehicleCount: 3 });
  assert.equal(plan.valid, false); assert.equal(plan.vehicleCount, 3); assert.equal(plan.cost, cost);
  assert.match(plan.message, /Need \$54,000 for 3 trucks/);
  assert.ok(forecastRoute(game, { ...draft, vehicleCount: 3 }).revenueMonth >= 0);
  assert.ok(routeCargoOptions(game, { ...draft, vehicleCount: 3 }).some(option => option.cargo === 'stone' && option.valid));
  game.money = cost;
  assert.equal(validateRoutePlan(game, { ...draft, vehicleCount: 3 }).valid, true);
  for (const vehicleCount of [0, 2.5, '3', NaN]) {
    assert.equal(validateRoutePlan(game, { ...draft, vehicleCount }).valid, false);
    assert.equal(forecastRoute(game, { ...draft, vehicleCount }), null);
  }
  while (game.vehicles.length < 9998) game.vehicles.push({ id: `vehicle-other-${game.vehicles.length}`, routeId: 'other' });
  game.revision++;
  assert.match(validateRoutePlan(game, { ...draft, vehicleCount: 3 }).message, /Only 2 more vehicles/);
  assert.equal(validateRoutePlan(game, { ...draft, vehicleCount: 3 }, { ignoreFleet: true }).valid, true);
  assert.ok(forecastRoute(game, { ...draft, vehicleCount: 3 }));
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
  assert.equal(build(game, 'quarry', 10, 7).ok, true);
  completeFixtureConstruction(game, game.industries[0]);
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
  assert.equal(forecastRoute(game, draft).fullFare, fareFor(game, 'stone', route.path.length, 24));
});

test('with full load, a train the quarry cannot fill stands at the idle rate, and the forecast counts its wait', () => {
  const { game, draft } = quarryLine('rail', 40), off = forecastRoute(game, draft), on = forecastRoute(game, { ...draft, fullLoad: true }), purchase = getVehiclePurchase(game, 'rail');
  assert.ok(off.supplyDay < off.perVehicleDay, `the quarry makes ${off.supplyDay} a day, a train carries ${off.perVehicleDay}`);
  assert.ok(on.netMonth > off.netMonth, `${Math.round(on.netMonth)} with full load, ${Math.round(off.netMonth)} without`);
  assert.equal(on.wait, Math.min(FULL_LOAD_MAX_WAIT, purchase.capacity / on.supplyDay) / 2);
  assert.equal(on.days, Math.round(scheduledDays('rail', 40, purchase.level) + on.wait));
  assert.equal(off.wait, 0);
  const route = addRoute(game, { ...draft, stops: [draft.from, draft.to], fullLoad: true }).route;
  simulate(game, 180);
  const month = (route.revenue - route.expenses) / 6;
  assert.ok(Math.abs(month / on.netMonth - 1) <= .3, `forecast ${Math.round(on.netMonth)} vs simulated ${Math.round(month)} a month`);
  const near = quarryLine('road', 10), plain = forecastRoute(near.game, near.draft), full = forecastRoute(near.game, { ...near.draft, fullLoad: true });
  assert.ok(plain.supplyDay >= plain.perVehicleDay, 'a short road line has more stone than a truck carries');
  assert.deepEqual([full.netMonth, full.days, full.wait], [plain.netMonth, plain.days, 0], 'a truck that never waits is forecast as before');
  assert.equal(fullFareText('rail', 'stone', on.fullFare), `A full train pays ≈ ${money(on.fullFare)}`);
});

test('the forecast times a trip and prices one unit after its days on the way', () => {
  const game = emptyGame(), level = getVehiclePurchase(game, 'road').level;
  assert.equal(build(game, 'food-plant', 10, 7).ok, true);
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
  assert.equal(build(game, 'logging-camp', 10, 8).ok, true);
  assert.equal(build(game, 'sawmill', 30, 8).ok, true);
  for (const point of line(10, 30, 13)) Object.assign(tileAt(game, point.x, point.y), { terrain: 'water', detail: 'river', elevation: 0 });
  game.revision++; game.networkRevision++;
  for (const x of [10, 30]) assert.equal(build(game, 'port', x, 13).ok, true);
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

test('a paused repaired service claims its retained fleet’s supply on the live path without changing the game', () => {
  const { game, draft } = quarryLine('road', 20), first = forecastRoute(game, draft);
  const route = addRoute(game, { ...draft, stops: [draft.from, draft.to], vehicleCount: first.vehiclesToSaturate }).route;
  assert.equal(build(game, 'bulldoze', 20, 12).ok, true); tick(game, .25);
  assert.equal(route.active, false);
  assert.equal(build(game, 'road', 20, 12).ok, true);
  const before = structuredClone(game), paused = forecastRoute(game, draft);
  assert.equal(paused.joining, true); assert.equal(paused.supplyDay, 0); assert.equal(paused.revenueMonth, 0);
  assert.deepEqual(game, before, 'forecasting never publishes the repair or resets the retained vehicles');
  const refreshed = structuredClone(game); refreshRouteConnections(refreshed);
  const after = forecastRoute(refreshed, draft);
  assert.deepEqual([paused.supplyDay, paused.movedDay, paused.revenueMonth, paused.upkeepMonth], [after.supplyDay, after.movedDay, after.revenueMonth, after.upkeepMonth]);
  assert.equal(refreshed.routes[0].active, true);
});

test('a stale service’s incremental revenue estimate uses the repaired detour rather than its cached path', () => {
  const { game, draft } = quarryLine('road', 20);
  const route = addRoute(game, { ...draft, stops: [draft.from, draft.to] }).route;
  assert.equal(build(game, 'bulldoze', 20, 12).ok, true); tick(game, .25);
  assert.equal(buildPath(game, 'road', [{ x: 18, y: 12 }, ...line(18, 22, 13), { x: 22, y: 12 }]).ok, true);
  const before = structuredClone(game), paused = forecastRoute(game, draft);
  assert.ok(paused.travel > route.path.length - 1, 'the preview uses the new detour');
  assert.deepEqual(game, before);
  const refreshed = structuredClone(game); refreshRouteConnections(refreshed);
  const after = forecastRoute(refreshed, draft);
  assert.deepEqual([paused.supplyDay, paused.movedDay, paused.revenueMonth, paused.upkeepMonth], [after.supplyDay, after.movedDay, after.revenueMonth, after.upkeepMonth]);
});

test('a fleet forecast caps revenue at the available supply and charges every requested vehicle', () => {
  const { game, draft } = quarryLine('road', 10), one = forecastRoute(game, draft), quantity = one.vehiclesToSaturate + 4;
  const fleet = forecastRoute(game, { ...draft, vehicleCount: quantity });
  assert.equal(fleet.vehicleCount, quantity); assert.equal(fleet.cost, one.cost * quantity);
  assert.equal(fleet.capacityDay, one.perVehicleDay * quantity);
  assert.equal(fleet.movedDay, fleet.supplyDay, 'extra trucks cannot multiply the quarry’s output');
  assert.ok(fleet.revenueMonth < one.revenueMonth * quantity);
  assert.ok(fleet.upkeepMonth > one.upkeepMonth);
  assert.equal(fleet.netMonth, fleet.revenueMonth - fleet.upkeepMonth);
  assert.equal(fleet.paybackMonths, fleet.netMonth > 0 ? fleet.cost / fleet.netMonth : Infinity);
  assert.equal(forecastRoute(game, { ...draft, vehicleCount: quantity }), fleet);
  assert.notEqual(forecastRoute(game, draft), fleet, 'quantity is part of the forecast cache');
  const route = addRoute(game, { ...draft, stops: [draft.from, draft.to], vehicleCount: one.vehiclesToSaturate }).route;
  assert.ok(route);
  const excess = forecastRoute(game, { ...draft, vehicleCount: 3 });
  assert.equal(excess.revenueMonth, 0); assert.ok(excess.upkeepMonth > 0 && excess.netMonth < 0);
});

test('editing a service forecasts its retained fleet and excludes its own claim on supply', () => {
  const { game, draft } = quarryLine('road', 20), quantity = 3;
  const fresh = forecastRoute(game, { ...draft, vehicleCount: quantity });
  const route = addRoute(game, { ...draft, stops: [draft.from, draft.to], vehicleCount: quantity }).route;
  const editing = forecastRoute(game, { ...draft, editing: route.id, vehicleCount: quantity });
  assert.equal(editing.editing, true); assert.equal(editing.joining, false);
  assert.equal(editing.cost, 0); assert.equal(editing.supplyDay, fresh.supplyDay);
  assert.equal(editing.revenueMonth, fresh.revenueMonth); assert.equal(editing.upkeepMonth, fresh.upkeepMonth);
  assert.equal(editing.capacityDay, fresh.capacityDay);
  const another = forecastRoute(game, { ...draft, vehicleCount: quantity });
  assert.equal(another.joining, true); assert.ok(another.supplyDay < editing.supplyDay);
  assert.equal(forecastRoute(game, { ...draft, editing: route.id, vehicleCount: 1 }), null, 'an edit uses all retained vehicles');
});

test('an edited passenger route forecasts both towns again with its actual older-generation fleet', () => {
  const { game, draft } = quarryLine('road', 20);
  game.industries = [];
  game.cities.push({ id: 'town-b', name: 'Pinehaven', x: 10, y: 10, population: 600, passengers: 100, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null });
  const service = { ...draft, cargo: 'passengers', vehicleCount: 2 }, fresh = forecastRoute(game, service);
  const route = addRoute(game, { ...service, stops: [draft.from, draft.to] }).route;
  game.day = 365; game.revision++;
  const edited = forecastRoute(game, { ...service, editing: route.id });
  assert.equal(edited.vehicleCount, 2); assert.equal(edited.cost, 0);
  assert.equal(edited.perVehicleDay, fresh.perVehicleDay, 'a newer model arriving does not replace the edited route’s retained fleet');
  assert.ok(edited.supplyDay > 0 && edited.revenueMonth > 0);
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

// Alderbrook buys lumber for its workshop and sells what it makes to Brookby; the fourth stop is a second one in Alderbrook.
function workshopTowns() {
  const game = emptyGame(), place = (id, name, x) => ({ id, name, x, y: 10, population: 400, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null });
  assert.equal(build(game, 'sawmill', 10, 7).ok, true);
  game.cities.push(place('town-a', 'Alderbrook', 30), place('town-b', 'Brookby', 50)); game.revision++;
  assert.equal(buildPath(game, 'road', line(10, 50, 12)).ok, true);
  for (const x of [10, 30, 50, 27]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  assert.equal(build(game, 'workshop', 32, 7).ok, true);
  completeFixtureConstruction(game, ...game.industries, tileAt(game, 32, 7).building);
  return game;
}

test('default route names use connected towns for their workshop freight', () => {
  const game = workshopTowns(), [mill, a, b] = game.stations, plan = (from, to, cargo) => validateRoutePlan(game, { mode: 'road', from: from.id, to: to.id, cargo });
  assert.equal(defaultRouteName(game, plan(mill, a, 'lumber'), 'lumber'), 'Sawmill to Alderbrook — lumber');
  assert.equal(defaultRouteName(game, plan(a, b, 'furniture'), 'furniture'), 'Alderbrook to Brookby — furniture');
  const back = plan(b, a, 'furniture');
  assert.equal(back.reversed, true);
  assert.equal(defaultRouteName(game, back, 'furniture'), 'Alderbrook to Brookby — furniture');
  assert.equal(defaultRouteName(game, plan(a, b, 'passengers'), 'passengers'), 'Alderbrook – Brookby — passengers');
});

test('the route form’s verdict for every cargo is the launch rule’s, workshops included', () => {
  const game = workshopTowns(), [mill, a, b, twin] = game.stations;
  for (const [from, to] of [[mill, a], [a, b], [mill, b], [twin, a]]) for (const cargo of routeCargoList(game).filter(key => key !== 'passengers' && key !== 'mail')) {
    const plan = validateRoutePlan(game, { mode: 'road', from: from.id, to: to.id, cargo }, { ignoreFunds: true }), [ahead, back] = [[from, to], [to, from]].map(([x, y]) => freightFits(game, stationCoverage(game, x), stationCoverage(game, y), cargo));
    assert.equal(plan.valid, ahead || back, `${cargo} from ${from.name} to ${to.name}`);
    if (plan.valid) assert.equal(plan.reversed, !ahead);
  }
  assert.equal(validateRoutePlan(game, { mode: 'road', from: twin.id, to: a.id, cargo: 'furniture' }).message, 'Furniture from Alderbrook workshops must go to another town. Pick an end stop that doesn’t reach Alderbrook.');
});

// Flights: two airports at least 16 tiles apart, passengers and mail only, no network needed.
test('air plans: two airports, passengers and mail, 16 tiles apart, with a straight forecast', () => {
  const game = emptyGame(); game.day = game.lastDailyDay = 730; game.lastMonth = 24;
  const town = (id, x, y) => ({ id, name: id, x, y, population: 1500, activity: 0, growth: 0, passengers: 400, mail: 40, delivered: 0, supplies: 0, lastServiceDay: null });
  game.cities = [town('Ash', 13, 16), town('Birch', 83, 56), town('Cove', 13, 36)];
  const a = build(game, 'airport-x', 10, 20).station, b = build(game, 'airport-y', 80, 50).station, c = build(game, 'airport-x', 10, 30).station;
  assert.equal(build(game, 'bus-stop', 20, 20).automaticRoad, true, 'a road stop supplies its own paid road');
  buildPath(game, 'road', line(20, 22, 10)); const bus = build(game, 'bus-stop', 20, 10).station;
  const draft = { mode: 'air', cargo: 'passengers', from: a.id, to: b.id };
  assert.equal(validateRoutePlan(game, { ...draft, to: bus.id }).message, 'Choose two airports.');
  assert.equal(validateRoutePlan(game, { ...draft, cargo: 'timber' }).message, 'Planes carry passengers and mail.');
  assert.equal(validateRoutePlan(game, { ...draft, to: c.id }).message, 'Airports must be at least 16 tiles apart for a flight.');
  game.cities[1].x = 13; game.cities[1].y = 26; game.revision++;
  assert.equal(validateRoutePlan(game, draft).message, 'Connected. Each airport must serve a different town within 7 tiles.');
  game.cities[1].x = 83; game.cities[1].y = 56; game.revision++;
  const plan = validateRoutePlan(game, draft);
  assert.equal(plan.valid, true); assert.equal(plan.message, 'Flight, 100 tiles.'); assert.equal(plan.path.length, 101);
  assert.deepEqual(routeCargoOptions(game, draft).filter(option => option.valid).map(option => option.cargo).sort(), ['mail', 'passengers']);
  assert.equal(defaultRouteName(game, plan, 'passengers'), 'Ash – Birch — passengers');
  const level = getVehiclePurchase(game, 'air').level, forecast = forecastRoute(game, draft, plan), travel = Math.hypot(70, 30);
  assert.equal(forecast.travel, travel); assert.equal(forecast.tiles, 100);
  const roundTrip = 2 * travel / (12 * (1 + .1 * level) * .97) + 3.2;
  assert.ok(Math.abs(forecast.perVehicleDay - getVehiclePurchase(game, 'air').capacity / roundTrip * 2) < 1e-9);
  assert.equal(addRoute(game, { mode: 'air', stops: [a.id, b.id], cargo: 'passengers' }).ok, true);
  assert.deepEqual(filterRoutes(game, { query: 'plane' }).map(route => route.mode), ['air']);
  assert.deepEqual(filterRoutes(game, { query: 'flight' }).map(route => route.mode), ['air']);
});

for (const cargo of ['passengers', 'mail']) test(`an airport fleet claims ${cargo} supply across the airport footprint, while an edit retains its own supply`, () => {
  const game = emptyGame(); game.day = game.lastDailyDay = 730; game.lastMonth = 24; game.money = 10_000_000;
  const town = (id, x) => ({ id, name: id, x, y: 20, population: 1500, activity: 0, growth: 0, passengers: 400, mail: 40, delivered: 0, supplies: 0, lastServiceDay: null });
  game.cities = [town('Alpha', 21), town('Beta', 91)];
  const from = build(game, 'airport-x', 10, 20).station, to = build(game, 'airport-x', 80, 20).station;
  for (const [stop, city] of [[from, game.cities[0]], [to, game.cities[1]]]) {
    assert.ok(Math.hypot(stop.x - city.x, stop.y - city.y) > 5);
    assert.equal(stationServes(stop, city), true, 'the airport footprint serves a town its anchor alone would miss');
  }
  const draft = { mode: 'air', cargo, from: from.id, to: to.id }, first = forecastRoute(game, draft), vehicleCount = first.vehiclesToSaturate;
  assert.ok(vehicleCount >= 1);
  const launched = addRoute(game, { ...draft, stops: [from.id, to.id], vehicleCount });
  assert.equal(launched.ok, true, launched.message);
  const extra = forecastRoute(game, draft);
  assert.equal(extra.joining, true); assert.equal(extra.supplyDay, 0); assert.equal(extra.movedDay, 0); assert.equal(extra.revenueMonth, 0);
  assert.ok(extra.netMonth < 0, 'an extra plane with no spare supply still costs upkeep');
  const editing = forecastRoute(game, { ...draft, editing: launched.route.id, vehicleCount });
  assert.equal(editing.cost, 0); assert.equal(editing.supplyDay, first.supplyDay); assert.ok(editing.revenueMonth > 0);
});
