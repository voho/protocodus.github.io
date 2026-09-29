import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, build, buildPath, addRoute, addRouteVehicle, removeRoute, tick, fareFor, payTiles, validateGame, restoreGame, drainDeliveryEvents } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { forecastRoute } from '../route-planner.js';
import { placeBuildingSite } from '../building-sites.js';
import { commercialKind } from '../buildings.js';
import { stepSettlements, settlementSuitability } from '../settlements.js';
import { TOWN_RADIUS as AUTHORITY_RADIUS } from '../town-authority.js';
import * as market from '../town-market.js';
import { TOWN_RADIUS, MARKET, FAMILIES, familyOf, familyCargo, townOf, townLedger, reviewMarket, ensureMarket, marketView, monthlyMarkets, recordTownSupply, validMarket, demandLabel, CLOSE_HOOKS } from '../town-market.js';
import { emptyGame, tileAt, line, advance, equivalent, twoTownFixture } from './helpers.mjs';

const zoneMap = game => new Map(game.zones.map(zone => [zone.y * game.width + zone.x, zone]));
const clone = game => restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
const town = (game, x, y, population, id = `town-${game.cities.length + 1}`) => { const city = { id, name: id, x, y, population, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null }; game.cities.push(city); game.revision++; return city; };
const place = (game, kind, x, y, level = 1) => assert.ok(placeBuildingSite(game, kind, x, y, { size: 1, building: { kind, level }, allowZone: true }), `${kind} at ${x},${y}`);
const zone = (game, kind, x, y, progress = 0) => { tileAt(game, x, y).zone = kind; game.zones.push({ x, y, kind, progress }); };
// A food plant 19 tiles west of Ashford's stop, and `trucks` trucks to it.
function foodLine(fixture, trucks = 1) {
  const { game, A, sa } = fixture;
  assert.ok(buildPath(game, 'road', line(A.x - 19, A.x - 9, 48)).ok);
  assert.ok(build(game, 'food-plant', A.x - 19, 49).ok);
  const plant = game.industries.at(-1), stop = build(game, 'bus-stop', A.x - 18, 48).station;
  plant.inventory.food = 900;
  const launched = addRoute(game, { mode: 'road', stops: [stop.id, sa.id], cargo: 'food' });
  assert.ok(launched.ok, launched.message);
  for (let n = 1; n < trucks; n++) assert.ok(addRouteVehicle(game, launched.route.id).ok);
  return { plant, stop, route: launched.route };
}
// A food plant beside a road east to a 900-resident town without shops, as in the cargo payment tests.
function foodRun() {
  const game = emptyGame();
  assert.ok(build(game, 'food-plant', 10, 8).ok);
  const city = town(game, 30, 9, 900, 'town');
  assert.ok(buildPath(game, 'road', line(10, 30, 12)).ok);
  for (const x of [10, 30]) assert.ok(build(game, 'bus-stop', x, 12).ok);
  game.industries[0].inventory.food = 500;
  const route = addRoute(game, { mode: 'road', cargo: 'food', stops: game.stations.map(stop => stop.id) }).route, vehicle = game.vehicles[0];
  return { game, city, route, vehicle };
}
// One delivery of `load` food: the truck arrives at the town stop within the next quarter day.
function deliver({ game, route, vehicle }, load = 24) {
  vehicle.load = load; delete vehicle.loadedDay; vehicle.direction = 1; vehicle.progress = route.path.length - 1.1; vehicle.x = route.path.at(-1).x - .1;
  drainDeliveryEvents(game); tick(game, .25);
  const [event] = drainDeliveryEvents(game);
  return { event, base: fareFor(game, 'food', payTiles(route.path) + 1, load, event.day) };
}

test('TOWN_RADIUS has one source, and townOf matches the old nearest-town loop', () => {
  assert.equal(TOWN_RADIUS, AUTHORITY_RADIUS); assert.equal(TOWN_RADIUS, 10);
  const game = createGame({ biome: 'taiga', seed: 1847, size: 'square512' });
  assert.ok(game.cities.length > 16, 'the spatial index is in use');
  const old = (x, y) => { let nearest = null, best = 10; for (const city of game.cities) { const d = Math.hypot(city.x - x, city.y - y); if (d < best) { nearest = city; best = d; } } return nearest; };
  let seed = 1847, found = 0;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let n = 0; n < 10000; n++) {
    // Half the points fall near a town, so most calls find one.
    const near = n % 2 ? game.cities[Math.floor(next() * game.cities.length)] : null, x = near ? near.x + Math.floor(next() * 25) - 12 : Math.floor(next() * game.width), y = near ? near.y + Math.floor(next() * 25) - 12 : Math.floor(next() * game.height);
    const expected = old(x, y); assert.equal(townOf(game, x, y), expected, `${x},${y}`); if (expected) found++;
  }
  assert.ok(found > 2000, `${found} points near a town`);
});

test('constants are frozen, and families name what towns buy', () => {
  for (const value of [MARKET, MARKET.perResident, market.OUTLET, market.HOUSEHOLD, market.HOUSEHOLD.taiga, FAMILIES, market.ZONE_SECTOR, market.MARKET_KEYS]) assert.ok(Object.isFrozen(value));
  const game = emptyGame();
  assert.deepEqual(['food', 'fuel', 'stone', 'cement', 'furniture', 'goods', 'machinery', 'passengers', 'mail', 'coal'].map(cargo => familyOf(game, cargo)), ['food', 'fuel', 'materials', 'materials', 'household', null, null, null, null, null]);
  assert.equal(familyOf(emptyGame('desert'), 'goods'), 'household'); assert.equal(familyOf(emptyGame('desert'), 'furniture'), null);
  assert.deepEqual(FAMILIES.map(family => familyCargo(game, family)), [['food'], ['furniture'], ['fuel'], ['stone', 'cement']]);
  assert.deepEqual([0, .24, .25, .59, .6, 1].map(demandLabel), ['Low', 'Low', 'Some', 'Some', 'Strong', 'Strong']);
});

test('shop wants follow residents, food outlets and their lineage', () => {
  const game = emptyGame(), city = town(game, 40, 30, 1000);
  place(game, 'shop-grocery', 42, 30); place(game, 'shop-bakery', 42, 32);
  monthlyMarkets(game);
  assert.equal(city.market.wants.food, Math.round(1000 * .1 * .6)); assert.equal(city.market.wants.food, 60);
  assert.equal(city.market.wants.household, 0, 'no hardware shop or florist'); assert.equal(city.market.shops, 2);
  place(game, 'shop-butcher', 44, 30); monthlyMarkets(game);
  assert.equal(city.market.wants.food, 90);
  // A zoned grocer that develops into a level-2 post office keeps selling food.
  const { game: served, A } = twoTownFixture();
  tick(served, 5);
  const x = A.x + 2, y = A.y + 7;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) Object.assign(tileAt(served, x + dx, y + dy), { building: null });
  const tile = tileAt(served, x, y); tile.variant = 5 * Math.floor(tile.variant / 5);
  assert.equal(commercialKind(tile.variant, 1), 'shop-grocery'); assert.equal(commercialKind(tile.variant, 2), 'service-post-office');
  assert.ok(build(served, 'commercial', x, y).ok);
  served.revision++;
  const outlets = () => townLedger(served, A, zoneMap(served)).outlets.food, before = outlets(), plot = served.zones.at(-1);
  const grow = level => { plot.progress = Math.max(plot.progress, level); for (let day = 0; day < 120 && (tile.building?.level || 0) < level; day++) { A.lastServiceDay = served.day; tick(served, 1); if ((tile.building?.level || 0) < level) plot.progress = Math.max(plot.progress, level); } assert.equal(tile.building?.level, level); };
  grow(1); assert.equal(tile.building.kind, 'shop-grocery'); assert.equal(outlets(), before + 1);
  grow(2); assert.equal(tile.building.kind, 'service-post-office'); assert.equal(outlets(), before + 2, 'the upgrade never loses the food outlet');
});

test('building materials are wanted only for zones that can develop, capped by town size', () => {
  const game = emptyGame(), city = town(game, 40, 36, 1000);
  assert.ok(buildPath(game, 'road', line(34, 46, 36)).ok);
  for (let x = 35; x < 45; x++) zone(game, 'residential', x, 37);
  monthlyMarkets(game);
  assert.equal(city.market.wants.materials, Math.min(60, Math.round(.1 * 1000) + 24));
  const far = emptyGame(), lonely = town(far, 40, 36, 1000);
  for (let x = 35; x < 45; x++) zone(far, 'residential', x, 40);
  monthlyMarkets(far);
  assert.equal(lonely.market.wants.materials, 0, 'zones with no road in their 3 × 3 never develop, so want nothing');
  const big = emptyGame(), small = town(big, 40, 36, 300);
  for (let y = 27; y <= 45; y += 3) assert.ok(buildPath(big, 'road', line(31, 49, y)).ok);
  for (let y = 27; y <= 45; y++) for (let x = 31; x <= 49; x++) if (!tileAt(big, x, y).road && Math.hypot(x - 40, y - 36) < 10) zone(big, 'residential', x, y);
  assert.ok(big.zones.length >= 200, `${big.zones.length} zones`);
  monthlyMarkets(big);
  assert.equal(small.market.wants.materials, 54, 'round(.1 × 300) + 24');
});

test('wanted food earns a 25% market bonus on the wanted units only, on top of the full fare', () => {
  const run = foodRun(), { game, city, route } = run;
  ensureMarket(game, city).wants.food = 30;
  const first = deliver(run);
  assert.equal(first.event.revenue, first.base + Math.round(.25 * first.base));
  const second = deliver(run);
  assert.equal(second.event.revenue, second.base + Math.round(.25 * second.base * 6 / 24));
  const third = deliver(run), bonus = route.marketBonus;
  assert.equal(third.event.revenue, third.base);
  assert.equal(route.marketBonus, bonus, 'a delivery past the wants adds nothing');
  assert.equal(route.marketBonus, Math.round(.25 * first.base) + Math.round(.25 * second.base * 6 / 24));
  assert.equal(game.monthlyMarketBonus, route.marketBonus); assert.equal(city.market.bonus, route.marketBonus);
  assert.equal(city.market.supplied.food, 72);
  assert.equal(route.revenue, first.event.revenue + second.event.revenue + third.event.revenue);
  // The month closes into history, and the next month starts afresh.
  const total = route.marketBonus;
  while (game.history.length === 0) tick(game, 1);
  assert.equal(game.history.at(-1).marketBonus, total); assert.equal(Object.hasOwn(game, 'monthlyMarketBonus'), false);
  assert.equal(city.market.bonusLast, total); assert.equal(city.market.bonus, 0); assert.equal(city.market.met.food, 1); assert.equal(city.market.supplied.food, 0);
  // A town that wants nothing pays the plain fare and writes no bonus fields.
  const plainRun = foodRun(), before = Object.keys(plainRun.route);
  const plainFare = deliver(plainRun);
  assert.equal(plainFare.event.revenue, plainFare.base);
  assert.deepEqual(Object.keys(plainRun.route), before); assert.equal(Object.hasOwn(plainRun.game, 'monthlyMarketBonus'), false);
  while (plainRun.game.history.length === 0) tick(plainRun.game, 1);
  assert.equal(Object.hasOwn(plainRun.game.history[0], 'marketBonus'), false);
});

test('passengers, mail and machinery never earn a market bonus', () => {
  const game = emptyGame(), city = town(game, 30, 30, 900);
  ensureMarket(game, city).wants.food = 50;
  for (const cargo of ['passengers', 'mail', 'machinery', 'coal']) assert.equal(recordTownSupply(game, city, cargo, 24), 0);
  assert.deepEqual(city.market.supplied, { food: 0, household: 0, fuel: 0, materials: 0 });
  const run = withMail => { const fixture = twoTownFixture(), { game: busy, A, B, sa, sb } = fixture; for (const city of [A, B]) { ensureMarket(busy, city).wants.food = 500; city.mail = 100; } const mail = withMail ? addRoute(busy, { mode: 'road', stops: [sa.id, sb.id], cargo: 'mail' }).route : null; tick(busy, 40); return { ...fixture, mail }; };
  const { A, route, mail } = run(true), plain = run(false);
  assert.ok(route.delivered > 0); assert.equal(route.marketBonus, undefined);
  assert.ok(mail.delivered > 0); assert.equal(mail.marketBonus, undefined);
  assert.ok(A.market.visitorsNow + A.market.visitors > 0, 'arriving passengers are counted as visitors');
  assert.equal(A.market.visitorsNow + A.market.visitors, plain.A.market.visitorsNow + plain.A.market.visitors, 'mail bags are not shoppers');
});

test('a contract extra is computed from the base fare, never from the market bonus', () => {
  const run = foodRun(), { game, city, route } = run, plant = game.industries[0];
  ensureMarket(game, city).wants.food = 100;
  game.contracts = [{ id: 'contract-0-0', cargo: 'food', sourceId: plant.id, target: { kind: 'city', id: city.id }, distance: 20, multiplier: 1.5, offeredDay: 0, expiresDay: 365 }];
  const { event, base } = deliver(run);
  assert.equal(game.contracts[0].routeId, route.id);
  assert.equal(game.contracts[0].earned, Math.round(base * 1.5));
  assert.equal(event.revenue, base + Math.round(.25 * base) + Math.round(base * 1.5));
});

test('a food truck earns a modest bonus, and more trucks meet the wants cap', () => {
  const one = twoTownFixture(), line1 = foodLine(one);
  for (let day = 0; day < 150; day++) { line1.plant.inventory.food = 900; tick(one.game, 1); }
  const base = line1.route.revenue - line1.route.marketBonus, share = line1.route.marketBonus / base;
  assert.ok(share >= .15 && share <= .251, `bonus is ${(share * 100).toFixed(1)}% of the base fare`);
  const four = twoTownFixture(), line4 = foodLine(four, 4), { A } = four, perUnit = fareFor(four.game, 'food', payTiles(line4.route.path) + 1, 1);
  let closes = 0, wants = A.market?.wants.food;
  for (let day = 0; day < 150; day++) {
    line4.plant.inventory.food = 900; const month = four.game.history.length; tick(four.game, 1);
    if (four.game.history.length > month && wants !== undefined) { closes++; assert.ok(A.market.bonusLast <= .25 * perUnit * wants + 8, `${A.market.bonusLast} for ${wants} wanted`); if (closes > 1) assert.equal(A.market.met.food, 1, 'four trucks fill the wants'); }
    wants = A.market?.wants.food;
  }
  assert.ok(closes >= 3);
});

test('the route forecast counts the market bonus on what the receiving town still wants', () => {
  const fixture = twoTownFixture(), { game, A, sa } = fixture;
  assert.ok(buildPath(game, 'road', line(A.x - 19, A.x - 9, 48)).ok);
  assert.ok(build(game, 'food-plant', A.x - 19, 49).ok);
  const stop = build(game, 'bus-stop', A.x - 18, 48).station, draft = { mode: 'road', cargo: 'food', from: stop.id, to: sa.id };
  Object.assign(game.industries.at(-1), { production: 3 });
  const wanted = forecastRoute(game, draft), view = marketView(game, A);
  assert.ok(wanted.marketBonus > 0);
  assert.ok(Math.abs(wanted.marketBonus - .25 * wanted.perUnit * Math.min(wanted.movedDay * 30, view.wants.food)) < 1e-9);
  assert.equal(A.market, undefined, 'the forecast only previews the market');
  ensureMarket(game, A).met.food = 1; game.revision++;
  const met = forecastRoute(game, draft);
  assert.equal(met.marketBonus, 0);
  assert.ok(Math.abs(wanted.netMonth - met.netMonth - wanted.marketBonus) < 1e-6, 'the one-line outlook includes it');
  const riders = forecastRoute(game, { mode: 'road', cargo: 'passengers', from: sa.id, to: fixture.sb.id });
  assert.equal(riders.marketBonus, 0, 'passengers earn no market bonus');
});

test('demand bars: service lifts homes, shops fill with shoppers, idle hands want workshops', () => {
  const { game, A, sb } = twoTownFixture();
  tick(game, 70);
  assert.ok(A.market.demand[0] >= .5, `homes served at one stop ${A.market.demand[0]}`);
  // Regular service at a second stop in town fills the service share.
  const second = build(game, 'bus-stop', A.x - 1, A.y).station;
  assert.ok(addRoute(game, { mode: 'road', stops: [second.id, sb.id], cargo: 'passengers' }).ok);
  monthlyMarkets(game);
  assert.ok(A.market.demand[0] >= .6, `homes served at two stops ${A.market.demand[0]}`);
  const quiet = clone(game), town = quiet.cities.find(c => c.id === A.id);
  for (const retired of [...quiet.routes]) assert.ok(removeRoute(quiet, retired.id).ok);
  const last = town.lastServiceDay;
  for (let months = quiet.history.length; !(quiet.history.length > months && Math.floor(quiet.day) - last > 60); ) { if (quiet.history.length > months) months = quiet.history.length; tick(quiet, 1); }
  assert.ok(town.market.demand[0] <= .3, `unserved homes ${town.market.demand[0]}`);
  // Shoppers and jobs from the same ledger the close uses.
  const L = townLedger(game, A, zoneMap(game)), P = A.population, jobs = Math.min(1, (L.shopUnits * 15 + L.works * 25) / (.25 * P));
  assert.ok(P >= 150 && L.works === 0);
  monthlyMarkets(game);
  assert.equal(A.market.demand[2], Math.round(.5 * (1 - jobs) * 100) / 100, 'workshops = .5 × (1 − jobs)');
  let placed = 0;
  for (let y = A.y - 9; y <= A.y + 9 && placed < 8; y++) for (let x = A.x - 9; x <= A.x + 9 && placed < 8; x++) {
    const tile = tileAt(game, x, y);
    if (tile.road || tile.building || tile.zone || Math.hypot(x - A.x, y - A.y) >= 9 || game.stations.some(s => s.x === x && s.y === y) || (x === A.x && y === A.y)) continue;
    zone(game, 'commercial', x, y, 1); place(game, commercialKind(tile.variant, 1), x, y); placed++;
  }
  assert.equal(placed, 8);
  monthlyMarkets(game);
  assert.equal(A.market.demand[1], 0, 'plenty of shops for the shoppers');
  // Between closes the bars hold still, though the bus keeps arriving.
  const fresh = twoTownFixture();
  tick(fresh.game, 35); const held = JSON.stringify(fresh.B.market.demand), months = fresh.game.history.length, visitors = fresh.B.market.visitorsNow;
  tick(fresh.game, 12);
  assert.equal(fresh.game.history.length, months); assert.equal(JSON.stringify(fresh.B.market.demand), held);
  assert.ok(fresh.B.market.visitorsNow > visitors);
});

test('demand speeds up matching zones by exactly (1 + .5 × bar), and never a slowed tier', () => {
  const { game, A } = twoTownFixture();
  tick(game, 35);
  const spot = (kind, progress) => {
    for (let y = A.y - 8; y <= A.y + 8; y++) for (let x = A.x - 8; x <= A.x + 8; x++) {
      const tile = tileAt(game, x, y);
      if (tile.road || tile.building || tile.zone || Math.hypot(x - A.x, y - A.y) >= 8 || game.stations.some(s => s.x === x && s.y === y) || (x === A.x && y === A.y) || [[1, 0], [0, 1], [1, 1]].some(([dx, dy]) => tileAt(game, x + dx, y + dy).building || tileAt(game, x + dx, y + dy).zone)) continue;
      if (!build(game, kind, x, y).ok) continue;
      game.zones.at(-1).progress = progress; return game.zones.at(-1);
    }
  };
  const works = spot('industrial', .2), homes = spot('residential', 1.2);
  assert.ok(works && homes);
  const ratio = (plot, sector) => {
    for (let day = 0; day < 30; day++) {
      const boosted = clone(game), flat = clone(game);
      for (const [copy, bar] of [[boosted, .8], [flat, 0]]) { copy.day = Math.floor(game.day) + day; const t = copy.cities.find(c => c.id === A.id); t.lastServiceDay = copy.day; t.market.demand = [0, 0, 0]; t.market.demand[sector] = bar; }
      const find = copy => copy.zones.find(z => z.x === plot.x && z.y === plot.y), p0 = find(boosted).progress;
      stepSettlements(boosted); stepSettlements(flat);
      const a = find(boosted).progress - p0, b = find(flat).progress - p0;
      if (b > 0) return a / b;
    }
    assert.fail('the zone never grew');
  };
  assert.ok(Math.abs(ratio(works, 2) - 1.4) < 1e-9);
  assert.ok(Math.abs(ratio(homes, 0) - 1) < 1e-12, 'food is missing, so town needs keep the slow tier as it was');
  // The inspector notes strong demand as a positive, never as a concern.
  A.market.demand = [.8, .2, .7];
  const homesNote = settlementSuitability(game, A, 'residential'), worksNote = settlementSuitability(game, works, 'industrial'), shopsNote = settlementSuitability(game, works, 'commercial');
  assert.ok(homesNote.positive.includes('Homes in demand')); assert.ok(worksNote.positive.includes('Workshops in demand')); assert.ok(!shopsNote.positive.includes('Shops in demand'));
  assert.ok(![homesNote, worksNote, shopsNote].some(note => note.negative.some(text => /demand/i.test(text))));
});

test('marketView never writes, and month-close hooks run only at a month close', () => {
  const { game, B } = twoTownFixture();
  game.routes[0].active = false;
  tick(game, 12);
  assert.equal(B.market, undefined);
  const saved = JSON.stringify(encodeGame(game)), twin = clone(game), calls = [];
  const hook = (_, city) => calls.push(city.id);
  CLOSE_HOOKS.push(hook);
  try {
    const view = marketView(game, B);
    assert.deepEqual(Object.keys(view.wants), [...FAMILIES]); assert.equal(view.demand.length, 3); assert.ok(view.wants.food > 0);
    assert.equal(B.market, undefined); assert.equal(JSON.stringify(encodeGame(game)), saved, 'the save is byte-identical');
    assert.deepEqual(calls, []);
    const made = ensureMarket(twin, twin.cities.find(c => c.id === B.id));
    assert.ok(validMarket(made)); assert.deepEqual(calls, [], 'a first-need market runs no close hook');
    reviewMarket(game, B, { target: JSON.parse(JSON.stringify(made)) }); assert.deepEqual(calls, []);
    monthlyMarkets(twin); assert.equal(calls.length, twin.cities.length);
  } finally { CLOSE_HOOKS.splice(CLOSE_HOOKS.indexOf(hook), 1); }
  const viewed = clone(game), untouched = clone(game);
  marketView(viewed, viewed.cities[1]);
  for (let day = 0; day < 60; day++) { marketView(viewed, viewed.cities[1]); tick(viewed, 1); tick(untouched, 1); }
  equivalent(viewed, untouched);
});

test('an unattended company earns the same with or without the market for thirty years', () => {
  const runs = [false, true].map(zeroed => {
    const game = createGame({ biome: 'taiga', seed: 1847, size: 'regional' }), seen = new Set(game.notifications.map(n => n.id));
    let money = game.money;
    for (let year = 1; year <= 30; year++) {
      for (let day = 0; day < 365; day++) { tick(game, 1); if (zeroed) for (const city of game.cities) if (city.market) city.market.demand = [0, 0, 0]; }
      assert.ok(game.money >= money, `year ${year}`); money = game.money;
      for (const notice of game.notifications) if (!seen.has(notice.id)) { seen.add(notice.id); assert.ok(!['warning', 'error'].includes(notice.type), notice.message); }
    }
    return game;
  });
  assert.equal(runs[0].nextId, runs[1].nextId);
  assert.ok(Math.abs(runs[0].money - runs[1].money) <= .005 * runs[1].money, `${Math.round(runs[0].money)} against ${Math.round(runs[1].money)}`);
  assert.ok(runs[0].cities.every(city => validMarket(city.market)));
});

test('partitioned frames match a whole tick with trucks, a bus and markets', () => {
  const make = () => { const fixture = twoTownFixture(); foodLine(fixture, 4); return fixture.game; };
  const whole = make(), parts = make();
  tick(whole, 40); advance(parts, 40, tick);
  assert.ok(whole.cities.every(city => city.market) && whole.routes[1].marketBonus > 0);
  equivalent(parts, whole);
});

test('markets save, restore and validate; legacy saves gain them at the first close', () => {
  const { game } = twoTownFixture();
  tick(game, 40);
  const restored = clone(game);
  assert.deepEqual(restored.cities.map(city => city.market), game.cities.map(city => city.market));
  const legacy = JSON.parse(JSON.stringify(encodeGame(game)));
  const old = restoreGame(legacy); for (const city of old.cities) delete city.market;
  const loaded = clone(old);
  assert.ok(loaded && validateGame(loaded) && loaded.cities.every(city => city.market === undefined));
  while (loaded.history.length === old.history.length) tick(loaded, 1);
  assert.ok(loaded.cities.every(city => validMarket(city.market)));
  const reject = (label, change) => { const copy = clone(game); change(copy); assert.equal(validateGame(copy), false, label); };
  reject('negative wants', copy => { copy.cities[0].market.wants.food = -1; });
  reject('fractional wants', copy => { copy.cities[0].market.wants.food = 1.5; });
  reject('met above one', copy => { copy.cities[0].market.met.food = 1.2; });
  reject('two demand bars', copy => { copy.cities[0].market.demand = [0, 0]; });
  reject('NaN supplied', copy => { copy.cities[0].market.supplied.food = NaN; });
  reject('an unknown family', copy => { copy.cities[0].market.wants.coal = 1; });
  reject('an unknown key', copy => { copy.cities[0].market.rent = 1; });
  reject('a missing key', copy => { delete copy.cities[0].market.bonusLast; });
  reject('negative route bonus', copy => { copy.routes[0].marketBonus = -1; });
  reject('negative history bonus', copy => { copy.history[0].marketBonus = -1; });
  reject('negative month bonus', copy => { copy.monthlyMarketBonus = -1; });
  const fine = clone(game); fine.routes[0].marketBonus = 12; fine.history[0].marketBonus = 12; fine.monthlyMarketBonus = 3;
  assert.equal(validateGame(fine), true);
});

// The pass reads each town's disc of tiles once; a day's tick (about 20 ms here since the allocation-free daily
// step) is the yardstick, timed in alternation so machine load weighs on both alike.
test('the monthly market pass stays well under a day of simulation on a 2048² world', () => {
  const game = createGame({ biome: 'taiga', seed: 1847, size: 'square2048' }), passes = [], ticks = [], time = run => { const start = performance.now(); run(); return performance.now() - start; };
  for (let n = 0; n < 3; n++) monthlyMarkets(game);
  for (let n = 0; n < 7; n++) { ticks.push(time(() => tick(game, 1))); passes.push(time(() => monthlyMarkets(game))); }
  ticks.sort((a, b) => a - b);
  const pass = Math.min(...passes), day = ticks[3];
  assert.ok(pass <= .5 * day, `${pass.toFixed(1)} ms against a ${day.toFixed(1)} ms day`);
  assert.ok(JSON.stringify(game.cities.map(city => city.market)).length < 320 * 400);
});
