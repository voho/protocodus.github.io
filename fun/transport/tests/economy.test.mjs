import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, build, buildPath, addRoute, removeRoute, tick, drainDeliveryEvents, saveGame, SAVE_KEY, VEHICLE_COSTS } from '../model.js';
import { outputFill } from '../industry-simulation.js';
import { emptyGame, line, advance, equivalent } from './helpers.mjs';
import { borrow, repay, loanTerms, validateGame } from '../model.js';

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

test('industries grow only while their output is carried away', () => {
  const capacityAfterTwoYears = trucks => {
    const game = emptyGame();
    game.cities = [{ id: 'town', name: 'Town', x: 35, y: 41, population: 400, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null }];
    assert.equal(build(game, 'quarry', 10, 40).ok, true);
    assert.equal(buildPath(game, 'road', line(12, 32, 41)).ok, true);
    assert.equal(build(game, 'bus-stop', 12, 41).ok, true);
    assert.equal(build(game, 'bus-stop', 32, 41).ok, true);
    const stops = game.stations.map(station => station.id);
    for (let n = 0; n < trucks; n++) assert.equal(addRoute(game, { name: `Stone ${n + 1}`, mode: 'road', stops, cargo: 'stone' }).ok, true);
    advance(game, 730, tick);
    const quarry = game.industries[0];
    return { capacity: quarry.capacity, fill: outputFill(quarry), notices: game.notifications.filter(notice => /expanded/.test(notice.message)) };
  };
  const one = capacityAfterTwoYears(1), eight = capacityAfterTwoYears(8);
  assert.ok(one.capacity < 1.8, `one truck leaves stone piling up: ${one.capacity.toFixed(2)}`);
  assert.ok(one.fill >= .5, 'the quarry stays at least half full');
  assert.ok(eight.capacity >= 2.9, `a fleet that clears the stock lets it grow: ${eight.capacity.toFixed(2)}`);
  assert.ok(eight.fill < .5);
  assert.match(one.notices[0].message, /^Stone quarry expanded to \d+% capacity\.$/);
});

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

test('bulldozing a route’s only producer or buyer warns once, naming the route', () => {
  for (const [site, end, pattern] of [[[10, 10], 0, /^Forest supply lost its timber producer\. Add one within 5 tiles of (.+) or retire the service\.$/], [[30, 10], 1, /^Forest supply lost its buyer\. Add a buyer within 5 tiles of (.+)\.$/]]) {
    const { game, stops } = freightFixture();
    assert.equal(addRoute(game, { name: 'Forest supply', mode: 'road', stops, cargo: 'timber' }).ok, true);
    const route = game.routes[0], last = game.notifications[0];
    assert.equal(build(game, 'bulldoze', ...site).ok, true);
    const fresh = game.notifications.slice(0, game.notifications.indexOf(last));
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0].message.match(pattern)?.[1], game.stations.find(stop => stop.id === stops[end]).name, 'the warning names the stop to build near');
    assert.deepEqual([fresh[0].type, fresh[0].topic, fresh[0].target], ['warning', 'route-supply', { kind: 'route', id: route.id }]);
  }
});

test('bulldozing an unrelated or duplicated industry leaves route warnings quiet', () => {
  const { game, stops } = freightFixture();
  assert.equal(addRoute(game, { name: 'Forest supply', mode: 'road', stops, cargo: 'timber' }).ok, true);
  assert.equal(build(game, 'quarry', 50, 40).ok, true);
  assert.equal(build(game, 'logging-camp', 6, 13).ok, true);
  const notices = game.notifications.slice();
  assert.equal(build(game, 'bulldoze', 50, 40).ok, true);
  assert.deepEqual(game.notifications, notices, 'a site no route uses is cleared silently');
  assert.equal(build(game, 'bulldoze', 10, 10).ok, true);
  assert.deepEqual(game.notifications, notices, 'a second covered logging camp keeps the route supplied');
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

test('a delivery reports its income once for the map at the receiving stop', () => {
  const { game, stops } = freightFixture();
  assert.equal(addRoute(game, { name: 'Timber service', mode: 'road', stops, cargo: 'timber' }).ok, true);
  const route = game.routes[0], destination = game.stations[1], revenue = route.revenue, delivered = route.delivered;
  for (let step = 0; step < 4000 && route.revenue === revenue; step++) { assert.deepEqual(drainDeliveryEvents(game), [], 'nothing is reported before cargo arrives'); tick(game, .05); }
  assert.ok(route.revenue > revenue, 'the truck delivers timber');
  const events = drainDeliveryEvents(game);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { x: destination.x, y: destination.y, revenue: route.revenue - revenue, cargo: 'timber', amount: route.delivered - delivered, routeId: route.id, day: events[0].day });
  assert.ok(events[0].day > 0 && events[0].day <= game.day);
  assert.deepEqual(drainDeliveryEvents(game), [], 'a drained delivery is not reported twice');
});

test('reading deliveries never changes the simulation or its save', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)), removeItem: key => entries.delete(key) } });
  try {
    const drained = createGame({ biome: 'taiga', size: 'regional', seed: 1847 }), kept = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
    let events = 0;
    for (let n = 0; n < 60 * 4; n++) { tick(drained, .25); tick(kept, .25); events += drainDeliveryEvents(drained).length; }
    assert.ok(events > 0, 'the starting routes deliver');
    const saved = game => { assert.equal(saveGame(game).ok, true); return entries.get(SAVE_KEY); };
    assert.equal(saved(drained), saved(kept));
    assert.equal(drainDeliveryEvents(kept).length, Math.min(64, events), 'an unread log keeps at most 64 deliveries');
  } finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; }
});

test('each December closes into a yearly summary built from its months', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  tick(game, 761);
  assert.equal(game.history.length, 25, 'twenty-five months have closed');
  assert.equal(game.annual.length, 2);
  for (const [index, summary] of game.annual.entries()) {
    const months = game.history.filter(entry => Math.floor(entry.month / 12) === index), before = game.history[index * 12 - 1];
    assert.equal(months.length, 12);
    assert.equal(summary.year, 1950 + index);
    assert.equal(summary.revenue, months.reduce((sum, entry) => sum + entry.income, 0));
    assert.equal(summary.operatingProfit, months.reduce((sum, entry) => sum + entry.operatingProfit, 0));
    assert.equal(summary.delivered, months.at(-1).delivered - (before?.delivered ?? 0));
    assert.equal(summary.population, months.at(-1).population);
    assert.equal(summary.routes, game.routes.length);
    assert.equal(summary.bestRouteId, game.routes[0].id, 'the earning starter service is the best route');
  }
  assert.equal(validateGame(game), true);
  for (const broken of [{ revenue: NaN }, { year: '1950' }, { bestRouteId: 7 }, { delivered: undefined }]) assert.equal(validateGame({ ...game, annual: [{ ...game.annual[0], ...broken }] }), false);
  assert.equal(validateGame({ ...game, annual: Array.from({ length: 201 }, () => game.annual[0]) }), false, 'at most 200 years are kept');
  assert.equal(validateGame({ ...game, annual: [{ ...game.annual[0], bestRouteId: null }] }), true, 'a year without an earning route has no best route');
});

test('starting funds offer three tiers, and a lean company can still launch its first road route', () => {
  for (const funds of [100000, 200000, 400000]) {
    const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847, startingFunds: funds });
    assert.equal(game.money, funds);
    assert.equal(game.startingFunds, funds === 400000 ? undefined : funds, 'only a non-default choice is stored');
    assert.equal(validateGame(game), true);
  }
  const odd = createGame({ biome: 'taiga', size: 'regional', seed: 1847, startingFunds: 123 });
  assert.equal(odd.money, 400000, 'an unknown amount falls back to the relaxed default');
  assert.equal(odd.startingFunds, undefined);
  assert.equal(validateGame({ ...odd, startingFunds: 300000 }), false);
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 10).ok, true);
  assert.equal(build(game, 'sawmill', 34, 10).ok, true);
  game.money = 100000;
  assert.equal(buildPath(game, 'road', line(10, 34, 12)).ok, true);
  assert.equal(build(game, 'bus-stop', 10, 12).ok, true);
  assert.equal(build(game, 'bus-stop', 34, 12).ok, true);
  const launched = addRoute(game, { name: 'First timber', mode: 'road', stops: game.stations.map(station => station.id), cargo: 'timber' });
  assert.equal(launched.ok, true, launched.message);
  assert.ok(game.money > 50000, 'a 25-tile first route leaves more than half of a lean start');
});

test('a credit line lends in steps up to its limit and is repaid in steps', () => {
  const game = emptyGame(), money = game.money;
  assert.deepEqual(loanTerms(game), { loan: 0, step: 50000, limit: 250000, rate: .005, monthlyInterest: 0, borrow: 50000, borrowInterest: 250, repay: 0 });
  for (let n = 1; n <= 5; n++) {
    const result = borrow(game);
    assert.equal(result.ok, true, result.message);
    assert.equal(game.loan, n * 50000);
    assert.equal(game.money, money + n * 50000);
  }
  assert.equal(borrow(game).message, 'Your credit line is fully used.');
  assert.equal(game.loan, 250000, 'the limit is reached after five loans');
  assert.equal(game.money, money + 250000);
  assert.equal(loanTerms(game).monthlyInterest, 1250);
  assert.equal(loanTerms(game).borrow, 0);
  assert.equal(game.monthlyIncome, 0, 'borrowing is not income');
  game.money = 49999;
  assert.equal(repay(game).message, 'Need $50,000 to repay.');
  assert.equal(game.loan, 250000);
  game.money = 1000000;
  for (let n = 4; n >= 0; n--) { assert.equal(repay(game).ok, true); assert.equal(game.loan, n ? n * 50000 : undefined); }
  assert.equal(game.money, 750000);
  assert.equal(game.monthlyExpenses, 0, 'repaying is not an expense');
  assert.equal(repay(game).message, 'No loan to repay.');
  assert.equal(validateGame(game), true);
  for (const loan of [-1, NaN, Infinity, 2e12, '50000']) assert.equal(validateGame({ ...game, loan }), false);
});

test('interest is a company cost booked once a month, whatever the frame size', () => {
  const company = () => { const { game, stops } = freightFixture(); assert.equal(addRoute(game, { name: 'Forest supply', mode: 'road', stops, cargo: 'timber' }).ok, true); tick(game, 20); return game; };
  const whole = company(), framed = company(), debtFree = company();
  for (const game of [whole, framed]) { borrow(game); borrow(game); }
  tick(whole, 30); tick(debtFree, 30);
  for (let n = 0; n < 120; n++) tick(framed, .25);
  assert.equal(whole.history.length, 1, 'one month closed');
  assert.equal(whole.history[0].operatingExpenses - debtFree.history[0].operatingExpenses, 500, '0.5% of $100,000 a month');
  assert.equal(whole.totalOperatingExpenses - debtFree.totalOperatingExpenses, 500);
  assert.equal(whole.money, debtFree.money + 100000 - 500);
  assert.equal(whole.routes[0].expenses, debtFree.routes[0].expenses, 'interest never reaches route accounts');
  equivalent(framed.history, whole.history, 'history');
  equivalent(framed.money, whole.money, 'money');
  tick(whole, 8); tick(debtFree, 8);
  assert.equal(whole.totalOperatingExpenses - debtFree.totalOperatingExpenses, 500, 'nothing more is charged until the next month closes');
  tick(whole, 1); tick(debtFree, 1);
  assert.equal(whole.totalOperatingExpenses - debtFree.totalOperatingExpenses, 1000, 'March 1 charges February');
});

test('a loan never grows obligations: no automatic borrowing or repayment, and a flat rate', () => {
  const broke = emptyGame(), lender = emptyGame();
  broke.money = -20000;
  lender.money = 5_000_000;
  borrow(lender); borrow(lender);
  const interest = [];
  for (let month = 0; month < 14; month++) {
    const before = lender.totalOperatingExpenses;
    tick(broke, 31); tick(lender, 31);
    interest.push(lender.totalOperatingExpenses - before);
  }
  assert.equal(broke.loan, undefined, 'a company below zero is never lent money it did not ask for');
  assert.equal(lender.loan, 100000, 'a rich company is never made to repay');
  assert.ok(interest.every(amount => amount === 500), `the rate never escalates: ${interest}`);
  assert.ok(broke.money < 0 && validateGame(broke), 'a company may stay below zero; there is no bankruptcy');
});

test('below zero the monthly warning points to the loan, and borrowing ends a softlock', () => {
  const { game, stops } = freightFixture();
  game.money = 12000;
  assert.equal(addRoute(game, { name: 'Forest supply', mode: 'road', stops, cargo: 'timber' }).message, 'Need $18,000 to buy this truck.');
  assert.equal(borrow(game).ok, true);
  const launched = addRoute(game, { name: 'Forest supply', mode: 'road', stops, cargo: 'timber' });
  assert.equal(launched.ok, true, launched.message);
  game.money = -5000;
  tick(game, 32);
  const warning = game.notifications.find(notice => notice.topic === 'credit');
  assert.ok(warning, 'a month closed below zero warns');
  assert.equal(warning.message, 'Your balance is below zero. Borrow in Company → Loan, or retire a service that earns less than its upkeep.');
  assert.equal(warning.type, 'warning');
});
