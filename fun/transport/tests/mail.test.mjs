import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, build, buildPath, addRoute, editRoute, addRouteVehicle, tick, fareFor, transitPay, getVehiclePurchase, getRouteFleet, validateGame, restoreGame, drainDeliveryEvents, CARGO } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { TOWN_TRAFFIC, isTownTraffic } from '../data.js';
import { stepSettlements, mailRate, MAIL_RATE, MAIL_POOL_SHARE } from '../settlements.js';
import { routeCargoList, routeCargoOptions, validateRoutePlan, forecastRoute, defaultRouteName, filterRoutes } from '../route-planner.js';
import { routeHealth, nextProject, industryService } from '../gameplay-insights.js';
import { routeCapacity } from '../gameplay-insights.js';
import { MILESTONES } from '../milestones.js';
import { cargoIcon } from '../cargo-icons.js';
import { headlineNoun, arrivalRoute, headlineWatch, detectHeadlines } from '../headlines.js';
import { planTrip } from '../payment-rates.js';
import { captureUndo, finishUndo, undoConstruction } from '../construction-undo.js';
import { buildPlan } from '../construction-plan.js';
import { emptyGame, line, tileAt, equivalent } from './helpers.mjs';

const town = (id, name, x, y, extra = {}) => ({ id, name, x, y, population: 1000, passengers: 0, mail: 0, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null, ...extra });
// Alderbrook and Pinehaven `L` tiles apart along one road, a stop two tiles below each centre.
function towns(L = 20, extra = {}) {
  const game = emptyGame();
  game.cities = [town('west', 'Alderbrook', 10, 10, extra), town('east', 'Pinehaven', 10 + L, 10, extra)]; game.revision++;
  assert.equal(buildPath(game, 'road', line(10, 10 + L, 12)).ok, true);
  for (const x of [10, 10 + L]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  return { game, stops: game.stations.map(stop => stop.id), west: game.cities[0], east: game.cities[1] };
}
function mailRoute(L = 20, mail = 60) {
  const fixture = towns(L, { mail }), money = fixture.game.money, quote = getVehiclePurchase(fixture.game, 'road').cost;
  const launched = addRoute(fixture.game, { mode: 'road', cargo: 'mail', stops: fixture.stops });
  assert.equal(launched.ok, true, launched.message);
  return { ...fixture, route: launched.route, vehicle: fixture.game.vehicles[0], spent: money - fixture.game.money, quote };
}
// Put the vehicle just short of its next stop, then arrive there within the same day.
const arrive = (game, route, vehicle) => { const end = vehicle.direction === 1 ? route.path.length - 1 : 0; vehicle.progress = end - .01 * vehicle.direction; vehicle.dwellRemaining = 0; tick(game, .02); };
const strip = game => JSON.parse(JSON.stringify(game, (key, value) => key === 'mail' ? undefined : value));

test('mail is the second town cargo: express, 26 a bag, a pictogram of its own', () => {
  assert.deepEqual(CARGO.mail, { name: 'Mail', color: '#d9a47e', price: 26, transit: 'express' });
  assert.deepEqual(Object.keys(CARGO).slice(0, 2), ['passengers', 'mail']);
  for (const biome of ['taiga', 'tundra', 'desert']) { const list = routeCargoList(createGame({ biome, size: 'regional', seed: 1847 })); assert.equal(list[list.indexOf('passengers') + 1], 'mail', biome); }
  assert.deepEqual(TOWN_TRAFFIC, ['passengers', 'mail']);
  assert.deepEqual(Object.keys(CARGO).filter(isTownTraffic), ['passengers', 'mail']);
  assert.equal(isTownTraffic(undefined), false);
  const svg = cargoIcon('mail');
  assert.match(svg, /aria-label="Mail"/);
  assert.notEqual(svg.replace(/data-cargo-icon="mail"|Mail/g, ''), cargoIcon('goods').replace(/data-cargo-icon="goods"|Goods/g, ''), 'not the goods fallback');
  for (const [days, pay] of [[14, 1], [15, .985], [24, .85], [48, .5], [400, .5]]) assert.ok(Math.abs(transitPay('mail', days) - pay) < 1e-12, `${days} days`);
  assert.equal(transitPay('mail', undefined), 1);
});

test('towns write letters in proportion to residents, with services, and keep at most one bag per 12.5 residents', () => {
  const { game, west } = towns();
  stepSettlements(game);
  assert.ok(west.mail >= 1000 * MAIL_RATE * .7 - 1e-12 && west.mail <= 1000 * MAIL_RATE * 1.3 + 1e-12, `${west.mail}`);
  for (let day = 1; day < 60; day++) { game.day = day; stepSettlements(game); }
  assert.ok(Math.abs(west.mail - 1000 * MAIL_POOL_SHARE) < 1e-9, `capped at 80, got ${west.mail}`);
  const twin = towns(); for (let day = 0; day < 60; day++) { twin.game.day = day; stepSettlements(twin.game); }
  assert.deepEqual(twin.game.cities.map(city => city.mail), game.cities.map(city => city.mail), 'the same seed writes the same letters');
  assert.ok(Math.abs(mailRate(west, { services: 2 }) - 1.3 * mailRate(west, { services: 0 })) < 1e-12);
  assert.equal(mailRate(west, { services: 9 }), mailRate(west, { services: 4 }), 'at most four services count');
  assert.equal(mailRate({ population: -5 }, { services: 0 }), 0);
  assert.ok(createGame({ biome: 'desert', size: 'regional', seed: 42 }).cities.every(city => city.mail === 0), 'a new world starts with no letters waiting');
});

test('a mail truck loads at both ends, pays like passengers by distance and days, and serves the town', () => {
  const { game, route, vehicle, west, east, spent, quote } = mailRoute();
  assert.equal(spent, quote, 'the launch charges the purchase quote');
  assert.equal(route.name, 'Alderbrook – Pinehaven — mail');
  assert.equal(vehicle.load, 24); assert.equal(west.mail, 36); assert.equal(west.passengers, 0);
  const bus = towns().game; addRoute(bus, { mode: 'road', cargo: 'passengers', stops: bus.stations.map(stop => stop.id) });
  assert.deepEqual(Object.keys(vehicle).sort(), Object.keys(bus.vehicles[0]).sort(), 'no new vehicle fields');
  drainDeliveryEvents(game); arrive(game, route, vehicle);
  const [delivery] = drainDeliveryEvents(game);
  assert.equal(east.delivered, 24); assert.equal(east.lastServiceDay, delivery.day);
  assert.equal(delivery.cargo, 'mail'); assert.equal(delivery.revenue, fareFor(game, 'mail', 21, 24, delivery.day), 'a quick trip keeps the full fare');
  assert.equal(route.revenue, delivery.revenue);
  assert.ok(fareFor(game, 'mail', 21, 1) / fareFor(game, 'passengers', 21, 1) > 1.4, 'a bag pays about 45% more than a passenger');
  assert.equal(vehicle.load, 24, 'the return trip loads Pinehaven’s mail'); assert.equal(east.mail, 36);
  assert.deepEqual([west.passengers, east.passengers], [0, 0], 'passenger pools are untouched');
  vehicle.loadedDay = 0; game.day = 40.5; arrive(game, route, vehicle);
  const [late] = drainDeliveryEvents(game);
  assert.equal(late.revenue, fareFor(game, 'mail', 21, 24, late.day, 40), 'a slow trip keeps less, from the day it boarded');
  assert.ok(Math.abs(transitPay('mail', 40) - .61) < 1e-12);
});

test('on 80 tiles a first-generation mail truck keeps about 70% of its fare', () => {
  const { game, route } = mailRoute(80, 80);
  let full = 0, paid = 0;
  for (let day = 0; day < 240; day++) { tick(game, 1); for (const event of drainDeliveryEvents(game)) { paid += event.revenue; full += fareFor(game, 'mail', 81, event.amount, event.day); } }
  assert.ok(route.delivered > 0 && full > 0);
  assert.ok(paid / full > .62 && paid / full < .82, `share ${paid / full}`);
});

test('mail needs two different towns, and a freight pair never fits it', () => {
  const game = emptyGame(); game.cities = [town('solo', 'Alderbrook', 20, 10)]; game.revision++;
  assert.equal(buildPath(game, 'road', line(18, 22, 12)).ok, true);
  for (const x of [18, 22]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  const stops = game.stations.map(stop => stop.id);
  assert.deepEqual(addRoute(game, { mode: 'road', cargo: 'mail', stops }), { ok: false, message: 'Mail stops must serve two different towns within their stop ranges.' });
  assert.equal(addRoute(game, { mode: 'road', cargo: 'passengers', stops }).message, 'Passenger stops must serve two different towns within their stop ranges.');
  assert.equal(validateRoutePlan(game, { mode: 'road', cargo: 'mail', from: stops[0], to: stops[1] }).valid, false);
  const freight = emptyGame(); freight.cities = [town('solo', 'Alderbrook', 30, 10)]; freight.revision++;
  assert.equal(build(freight, 'quarry', 9, 7).ok, true); assert.equal(buildPath(freight, 'road', line(10, 30, 12)).ok, true);
  for (const x of [10, 30]) assert.equal(build(freight, 'bus-stop', x, 12).ok, true);
  const plan = validateRoutePlan(freight, { mode: 'road', cargo: 'mail', from: freight.stations[0].id, to: freight.stations[1].id });
  assert.equal(plan.valid, false); assert.match(plan.message, /different town/);
  assert.deepEqual(routeCargoOptions(freight, { mode: 'road', from: freight.stations[0].id, to: freight.stations[1].id }).filter(option => option.valid).map(option => option.cargo), ['stone']);
});

test('two town stops still pick passengers first, and mail fits right after', () => {
  const { game, stops } = towns();
  const draft = { mode: 'road', from: stops[0], to: stops[1] };
  assert.deepEqual(routeCargoOptions(game, draft).filter(option => option.valid).map(option => option.cargo), ['passengers', 'mail']);
  const plan = validateRoutePlan(game, { ...draft, cargo: 'mail' });
  assert.equal(defaultRouteName(game, plan, 'mail'), 'Alderbrook – Pinehaven — mail');
  assert.equal(defaultRouteName(game, plan, 'passengers'), 'Alderbrook – Pinehaven — passengers');
  const { game: served, route, stops: pair } = mailRoute();
  assert.equal(validateRoutePlan(served, { mode: 'road', cargo: 'mail', from: pair[1], to: pair[0] }).existingRouteId, route.id, 'a reversed pair finds the mail route');
  assert.equal(validateRoutePlan(served, { mode: 'road', cargo: 'passengers', from: pair[0], to: pair[1] }).existingRouteId, null, 'passengers are a route of their own');
});

test('the mail forecast counts both towns and pays what a delivery will', () => {
  const { game, stops, west, east } = towns(20);
  const draft = { mode: 'road', from: stops[0], to: stops[1], cargo: 'mail' }, forecast = forecastRoute(game, draft), bus = forecastRoute(game, { ...draft, cargo: 'passengers' });
  assert.ok(Math.abs(forecast.perVehicleDay - bus.perVehicleDay) < 1e-12, 'both directions carry mail, as for passengers');
  const env = { services: 0 };
  assert.ok(Math.abs(forecast.madeDay - (mailRate(west, env) + mailRate(east, env))) < 1e-9, `${forecast.madeDay}`);
  const plan = validateRoutePlan(game, draft), trip = planTrip(game, 'road', 'mail', plan.path, getVehiclePurchase(game, 'road').level);
  assert.equal(forecast.perUnit, trip.perUnit); assert.equal(forecast.share, 1);
  const far = towns(80), slow = forecastRoute(far.game, { mode: 'road', from: far.stops[0], to: far.stops[1], cargo: 'mail' });
  assert.ok(slow.share < 1 && slow.share > .6, `${slow.share}`);
  assert.equal(slow.perUnit, fareFor(far.game, 'mail', 81, 1, far.game.day, slow.days));
});

test('mail saves, restores and keeps its time, and legacy towns start with none', () => {
  const { game } = mailRoute();
  for (let n = 0; n < 2; n++) addRouteVehicle(game, game.routes[0].id);
  const frames = structuredClone(game);
  tick(game, 200); for (let n = 0; n < 800; n++) tick(frames, .25);
  equivalent(frames, game);
  assert.equal(validateGame(game), true);
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  tick(game, 100); tick(restored, 100);
  assert.equal(restored.money, game.money); assert.deepEqual(restored.cities.map(city => city.mail), game.cities.map(city => city.mail));
  const legacy = JSON.parse(JSON.stringify(encodeGame(createGame({ biome: 'taiga', size: 'regional', seed: 1847 }))));
  for (const city of legacy.state.cities) delete city.mail;
  const old = restoreGame(legacy);
  assert.ok(old); assert.ok(old.cities.every(city => city.mail === 0)); assert.equal(validateGame(old), true);
  for (const bad of [-1, NaN, Infinity, '3']) { const copy = structuredClone(old); copy.cities[0].mail = bad; assert.equal(validateGame(copy), false, String(bad)); }
});

test('unused mail waits quietly: capped, never a notice, and nothing else reads it', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 }), twin = structuredClone(game), nextId = game.nextId;
  tick(game, 90);
  for (const city of twin.cities) city.mail = 1e6;
  tick(twin, 90);
  assert.ok(game.cities.some(city => city.mail > 0));
  assert.ok(game.cities.every(city => city.mail <= city.population * MAIL_POOL_SHARE + 1e-9));
  assert.deepEqual(strip(twin), strip(game), 'without a mail route, waiting mail changes nothing else');
  assert.equal(twin.nextId, game.nextId); assert.ok(game.nextId >= nextId);
});

test('demolishing homes and undoing a home keep mail within the town’s cap', () => {
  const game = emptyGame(); build(game, 'city', 20, 20); const city = game.cities[0];
  assert.equal(city.mail, 0, 'a founded town starts with no letters');
  tileAt(game, 21, 20).building = { kind: 'house-normal-2', level: 3, populationCityId: city.id }; city.population += 66; city.mail = city.population * MAIL_POOL_SHARE;
  assert.equal(build(game, 'bulldoze', 21, 20).ok, true);
  assert.equal(city.mail, city.population * MAIL_POOL_SHARE);
  const entry = captureUndo(game, 'house-cheap-1', [{ x: 22, y: 20 }]), result = buildPlan(game, 'house-cheap-1', [{ x: 22, y: 20 }]);
  assert.equal(result.ok, true, result.message);
  city.mail = city.population * MAIL_POOL_SHARE;
  assert.equal(undoConstruction(game, finishUndo(entry, game, result)).ok, true);
  assert.equal(city.mail, city.population * MAIL_POOL_SHARE, 'undoing the home lowers the cap with it');
});

test('route health speaks of mail, and mail never counts as freight', () => {
  const { game, route, west, east } = mailRoute();
  assert.equal(routeHealth(game, route, getRouteFleet(game, route.id)).word, 'First trip');
  route.delivered = 24;
  Object.assign(west, { mail: 30 }); Object.assign(east, { mail: 30 });
  const running = routeHealth(game, route, getRouteFleet(game, route.id));
  assert.deepEqual([running.state, running.word, running.detail], ['running', 'Running', 'Mail travels both ways.']);
  Object.assign(west, { mail: 60 }); Object.assign(east, { mail: 60 });
  const plenty = routeHealth(game, route, getRouteFleet(game, route.id));
  assert.deepEqual([plenty.state, plenty.word, plenty.waiting, plenty.fix], ['running', 'Running', 60, undefined], 'spare mail is never a state');
  Object.assign(west, { mail: 100 }); Object.assign(east, { mail: 100 }); route.accountingStartDay = game.day - 30;
  assert.equal(routeCapacity(game, route, getRouteFleet(game, route.id)).room, true, 'four truckloads in each town leave room for another mail truck');
  Object.assign(east, { mail: 30 });
  assert.equal(routeCapacity(game, route, getRouteFleet(game, route.id)).room, false, 'the emptier town sets what waits');
  const lone = emptyGame(); lone.cities = [town('solo', 'Alderbrook', 20, 10)]; lone.revision++;
  buildPath(lone, 'road', line(18, 22, 12)); build(lone, 'bus-stop', 18, 12); build(lone, 'bus-stop', 22, 12);
  const orphan = { ...route, stops: lone.stations.map(stop => stop.id), path: line(18, 22, 12) };
  assert.equal(routeHealth(lone, orphan).word, 'No mail');
  // A company with only town traffic has not started freight.
  const company = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  company.routes[0].delivered = 10000;
  const launched = addRoute(company, { mode: 'road', cargo: 'mail', stops: company.routes[0].stops });
  assert.equal(launched.ok, true, launched.message); launched.route.delivered = 10000;
  tick(company, 2);
  assert.equal(nextProject(company).title, 'Your first cargo route');
  assert.equal(company.milestones['freight-100'], undefined);
  assert.equal(MILESTONES.find(m => m.id === 'freight-100').progress(company).value, 0);
  assert.equal(company.contracts, undefined, 'mail starts no contract offers');
});

test('a mail stop never marks an industry, and losing a nearby industry warns no mail route', () => {
  const game = emptyGame();assert.equal(build(game, 'quarry', 12, 13).ok, true);
  // A pre-existing compact town and quarry can share a stop without sharing mail.
  game.cities = [town('west', 'Alderbrook', 10, 10), town('east', 'Pinehaven', 30, 10)]; game.revision++;
  assert.equal(buildPath(game, 'road', line(10, 30, 12)).ok, true);
  for (const x of [10, 30]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  assert.equal(addRoute(game, { mode: 'road', cargo: 'mail', stops: game.stations.map(stop => stop.id) }).ok, true);
  assert.deepEqual(industryService(game), new Map());
  const notices = game.notifications.length;
  assert.equal(build(game, 'bulldoze', 12, 13).ok, true);
  assert.equal(game.notifications.length, notices, 'no route-supply warning');
});

test('mail keeps its own route in an edit, and its bags stay aboard a stop change', () => {
  const { game, route, vehicle } = mailRoute();
  const bus = towns(); const passengers = addRoute(bus.game, { mode: 'road', cargo: 'passengers', stops: bus.stops }).route;
  const refusal = 'Mail needs its own route. Launch a new one instead.';
  assert.deepEqual(editRoute(bus.game, passengers.id, { stops: bus.stops, cargo: 'mail' }), { ok: false, message: refusal });
  assert.deepEqual(editRoute(game, route.id, { stops: route.stops, cargo: 'stone' }), { ok: false, message: refusal });
  assert.deepEqual(editRoute(game, route.id, { stops: route.stops, cargo: 'passengers' }), { ok: false, message: refusal });
  assert.equal(buildPath(game, 'road', line(30, 33, 12)).ok, true); assert.equal(build(game, 'bus-stop', 33, 12).ok, true);
  const moved = editRoute(game, route.id, { stops: [route.stops[0], game.stations.at(-1).id], cargo: 'mail' });
  assert.equal(moved.ok, true, moved.message);
  assert.equal(vehicle.load, 24, 'the bags stay aboard');
});

test('headlines, search and the start of town service treat mail as town traffic', () => {
  assert.deepEqual([['road', 'mail'], ['rail', 'mail'], ['water', 'mail']].map(([mode, cargo]) => headlineNoun(mode, cargo)), ['mail truck', 'mail train', 'mail ship']);
  const { game, route, east } = mailRoute(), watch = headlineWatch(game);
  watch.towns.delete(east.id);
  arrive(game, route, game.vehicles[0]);
  assert.equal(arrivalRoute(game, east)?.id, route.id);
  const [entry] = detectHeadlines(game, watch);
  assert.equal(entry.title, 'Citizens celebrate as the first mail truck arrives in Pinehaven');
  assert.equal(entry.art, 'truck'); assert.match(entry.detail, /linked by Alderbrook – Pinehaven — mail\.$/);
  assert.deepEqual(filterRoutes(game, { query: 'mail truck' }).map(item => item.id), [route.id]);
  assert.deepEqual(filterRoutes(game, { query: 'bus' }), []);
});
