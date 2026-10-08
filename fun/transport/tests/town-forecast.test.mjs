import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, build, buildPath, addRoute, removeRoute, tick, priceFor, validateGame, restoreGame, saveGame, SAVE_KEY, drainDeliveryEvents, sellProperty } from '../model.js';
import { encodeGame, decodeGame } from '../save-codec.js';
import { quoteBuildPlan, buildPlan } from '../construction-plan.js';
import { placeBuildingSite } from '../building-sites.js';
import { residentialKind, commercialKind } from '../buildings.js';
import { housingCapacity, activeCities, zoneServiceActive, servedTownSet } from '../settlements.js';
import { fundedTown } from '../town-authority.js';
import { FORECAST, matureLevel, zoneForecast, buildingForecast, forecastNote } from '../town-forecast.js';
import { MARKET, OUTLET, CLOSE_HOOKS, townLedger, propertyBase, propertyOccupancy, marketView, monthlyMarkets, returnsTotals } from '../town-market.js';
import { writeSaveSlot, readSaveSlot } from '../save-slots.js';
import { emptyGame, tileAt, line, advance, equivalent, twoTownFixture } from './helpers.mjs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const clone = game => restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
const saved = game => JSON.stringify(encodeGame(game));
const zoneMap = game => new Map(game.zones.map(zone => [zone.y * game.width + zone.x, zone]));
const block = (x, y, w = 2, h = 2) => Array.from({ length: w * h }, (_, i) => ({ x: x + i % w, y: y + Math.floor(i / w) }));
const quote = (game, kind, points) => quoteBuildPlan(game, kind, points).placements;
const near = (value, target, share, label) => assert.ok(Math.abs(value - target) <= share * target, `${label}: ${value} against ${target}`);
// Whole days until `n` more months have closed; `each` runs before every day.
function closeMonths(game, n = 1, each) { const target = game.lastMonth + n; while (game.lastMonth < target) { each?.(); tick(game, 1); } }
// Ashford counts as served once its bus has arrived.
function served(fixture) { while (!Number.isFinite(fixture.A.lastServiceDay)) tick(fixture.game, 1); return fixture; }
// A block's plots and their rent at the last close, priced as bookRent prices a town's.
function blockRent(game, city, points) {
  const keys = new Set(points.map(p => `${p.x},${p.y}`)), plots = townLedger(game, city, zoneMap(game)).plots.filter(p => keys.has(`${p.x},${p.y}`));
  return { plots, rent: priceFor(game, plots.reduce((sum, p) => sum + propertyBase(p) * propertyOccupancy(city.market, p, city.population), 0)) };
}
// A grass town of `population` on its own, with public streets on four sides of the land from (x0, y0) to (x1, y1).
function streetTown(population = 600, [x0, y0, x1, y1] = [42, 32, 47, 35]) {
  const game = emptyGame(), city = { id: 'town-m', name: 'Millbrook', x: 40, y: 30, population, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null };
  game.cities.push(city);
  const street = points => { for (const p of points) Object.assign(tileAt(game, p.x, p.y), { road: true, publicRoad: true }); };
  street(line(x0 - 1, x1 + 1, y0 - 1)); street(line(x0 - 1, x1 + 1, y1 + 1));
  street(Array.from({ length: y1 - y0 + 3 }, (_, i) => ({ x: x0 - 1, y: y0 - 1 + i }))); street(Array.from({ length: y1 - y0 + 3 }, (_, i) => ({ x: x1 + 1, y: y0 - 1 + i })));
  game.networkRevision++; game.revision++;
  return { game, city };
}
// Ashford's workshop fed with lumber from a sawmill on the main road, its furniture carried on to Brookby.
function freightFixture() {
  const fixture = twoTownFixture(), { game, A, sa, sb } = fixture;
  const sawmill = build(game, 'sawmill', 43, 50).industry, stop = build(game, 'bus-stop', 44, 48).station;
  sawmill.inventory.lumber = 900;
  assert.ok(build(game, 'workshop', A.x - 8, A.y + 1).ok);
  const lumber = addRoute(game, { mode: 'road', stops: [stop.id, sa.id], cargo: 'lumber' }).route, furniture = addRoute(game, { mode: 'road', stops: [sa.id, sb.id], cargo: 'furniture' }).route;
  assert.ok(lumber && furniture);
  return { ...fixture, sawmill, lumber, furniture };
}
// Alder and Birch on one road with a stop each, a workshop in Alder and, optionally, a furniture works beside Alder's stop.
function worksWorld(works) {
  const game = emptyGame(), town = (id, name, x) => { const city = { id, name, x, y: 30, population: 800, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null }; game.cities.push(city); return city; };
  // Seed the industry before the towns: this is an established compact layout,
  // retained by old companies, rather than a new industry's siting proposal.
  const factory = works ? build(game, 'furniture-factory', 31, 33).industry : null;
  assert.ok(!works || factory);
  const A = town('town-a', 'Alder', 30), B = town('town-b', 'Birch', 70);
  game.revision++;
  assert.ok(buildPath(game, 'road', line(20, 75, 32)).ok);
  const sa = build(game, 'bus-stop', 30, 32).station, sb = build(game, 'bus-stop', 70, 32).station;
  assert.ok(build(game, 'workshop', 26, 33).ok);
  closeMonths(game, 1);
  return { game, A, B, sa, sb, factory };
}
// One delivery of `load`: the vehicle reaches its end stop within the next quarter day, with no clock aboard.
function deliver(game, route, load) {
  const vehicle = game.vehicles.find(v => v.routeId === route.id);
  vehicle.load = load; delete vehicle.loadedDay; vehicle.direction = 1; vehicle.progress = route.path.length - 1.1; vehicle.x = route.path.at(-1).x - .1;
  drainDeliveryEvents(game); tick(game, .25);
  return drainDeliveryEvents(game).find(event => event.routeId === route.id);
}

test('a residential block forecasts its homes, residents, rent and payback as they turn out', () => {
  const { game, A } = served(twoTownFixture()), points = block(A.x + 4, A.y + 7), placements = quote(game, 'residential', points);
  const f = zoneForecast(game, 'residential', placements);
  assert.deepEqual(points.map(p => matureLevel(game, 'residential', p.x, p.y)), [2, 2, 2, 2], 'level-3 homes are 2 × 2, so a block stops at 2');
  assert.deepEqual([f.levels, f.far, f.roadless, f.served, f.towns.map(town => [town.city.name, town.tiles])], [8, 0, 0, true, [['Ashford', 4]]]);
  assert.equal(f.residents, points.reduce((sum, p) => sum + housingCapacity({ kind: residentialKind(tileAt(game, p.x, p.y).variant, 2), level: 2 }), 0));
  assert.deepEqual([f.cost, f.payback], [4 * priceFor(game, 420), Math.ceil(f.cost / f.rent) + FORECAST.monthsToBuild]);
  assert.deepEqual(forecastNote(game, 'residential', placements), { forecast: `Ashford, about +${f.residents} residents and $${f.rent} a month in rent, pays back in about ${Math.round(f.payback / 12)} years`, warning: false });
  assert.ok(buildPlan(game, 'residential', points).ok);
  let total = 0, payback = null, twoYears = null;
  for (let month = 1; month <= 60 && (payback === null || !twoYears); month++) {
    closeMonths(game, 1);
    const realized = blockRent(game, A, points);
    total += realized.rent;
    if (payback === null && total >= f.cost) payback = month;
    if (month === 24) twoYears = realized;
  }
  assert.deepEqual(twoYears.plots.map(p => p.level), [2, 2, 2, 2], 'the block settles where the forecast said');
  assert.equal(twoYears.plots.reduce((sum, p) => sum + housingCapacity(p), 0), f.residents);
  near(f.rent, twoYears.rent, .15, 'rent at month 24');
  near(f.payback, payback, .2, 'months to pay back');
});

test('commercial blocks forecast their levels, rent and the shop wants they add', () => {
  const { game, A } = served(twoTownFixture()), east = block(A.x + 4, A.y + 7), west = block(A.x - 7, A.y + 4).filter(p => !tileAt(game, p.x, p.y).road);
  assert.equal(west.length, 2, 'a street takes half of the western block');
  const levels = [east, west].map(points => points.map(p => matureLevel(game, 'commercial', p.x, p.y)));
  assert.deepEqual(levels, [[3, 1, 1, 3], [3, 3]], 'a shop grows into a one-tile service, or stays a shop where its service is 2 × 2');
  const forecasts = [east, west].map(points => zoneForecast(game, 'commercial', quote(game, 'commercial', points)));
  assert.deepEqual(forecasts.map(f => f.levels), [8, 6]);
  // The wants a new food outlet adds, by city-market's formula at today's residents and outlets.
  const P = A.population, outlets = townLedger(game, A, zoneMap(game)).outlets, added = { food: 0, household: 0, fuel: 0 };
  east.forEach((p, i) => { const variant = tileAt(game, p.x, p.y).variant, sells = OUTLET[commercialKind(variant, levels[0][i])], grew = OUTLET[commercialKind(variant, 1)]; if (sells) added[sells] += levels[0][i]; if (grew && grew !== sells) added[grew] += levels[0][i]; });
  assert.ok(east.some((p, i) => OUTLET[commercialKind(tileAt(game, p.x, p.y).variant, levels[0][i])] === 'food'), 'the block grows a food shop');
  const wants = (n, family) => Math.round(P * MARKET.perResident[family] * Math.min(1, n * MARKET.reach[family] / P));
  assert.deepEqual(forecasts[0].wants, { family: 'food', units: wants(outlets.food + added.food, 'food') - wants(outlets.food, 'food'), cargo: 'food' });
  assert.ok(forecasts[0].wants.units > 0);
  assert.match(forecastNote(game, 'commercial', quote(game, 'commercial', east)).forecast, new RegExp(`^Ashford, about \\$${forecasts[0].rent} a month in rent, pays back in about \\d+ (months|years), shops would want about \\+${forecasts[0].wants.units} food$`));
  for (const points of [east, west]) assert.ok(buildPlan(game, 'commercial', points).ok);
  closeMonths(game, 30);
  [east, west].forEach((points, n) => {
    const realized = blockRent(game, A, points);
    assert.deepEqual(realized.plots.map(p => p.level), levels[n], `block ${n} settled at its forecast levels`);
    near(forecasts[n].rent, realized.rent, .15, `block ${n} rent`);
  });
});

test('industrial strokes forecast one workshop for each whole 2 × 2 square', () => {
  const { game } = streetTown(), forecast = points => zoneForecast(game, 'industrial', quote(game, 'industrial', points));
  const cases = [[[{ x: 42, y: 32 }, { x: 43, y: 32 }, { x: 42, y: 33 }], 0], [block(42, 32), 3], [block(42, 32, 2, 4), 6], [block(42, 32, 3, 3), 3], [block(42, 32, 6, 4), 18]];
  for (const [points, levels] of cases) {
    const f = forecast(points);
    assert.deepEqual([f.workshopLevels, f.goods], [levels, levels * 7.5], `${points.length} tiles`);
  }
  assert.equal(forecast(block(42, 32, 3, 3)).roadless, 4, 'inner tiles have no road beside them, yet their square still grows from its outer tiles');
  // Vacant industrial zones already there complete a square; one only of them, with nothing new in it, is not counted.
  for (const p of [{ x: 44, y: 32 }, { x: 44, y: 33 }]) assert.ok(build(game, 'industrial', p.x, p.y).ok);
  assert.equal(forecast([{ x: 45, y: 32 }, { x: 45, y: 33 }]).workshopLevels, 3);
  assert.equal(forecast([{ x: 42, y: 34 }]).workshopLevels, 0);
  // A town in service, or funded, earns ground rent at the workshops' floor while they wait for materials.
  game.cities[0].fundedUntil = Math.floor(game.day) + 365;
  const f = forecast(block(42, 34, 2, 2));
  assert.equal(f.rent, priceFor(game, 12 * 4 * 3 * .3));
  assert.deepEqual(forecastNote(game, 'industrial', quote(game, 'industrial', block(42, 34, 2, 2))), { forecast: `Millbrook, about 23 furniture a month from delivered lumber and $${f.rent} a month in rent`, warning: false });
  assert.deepEqual(forecastNote(game, 'industrial', quote(game, 'industrial', [{ x: 47, y: 34 }])), { forecast: 'Millbrook, a workshop needs a 2 × 2 block', warning: false });
  assert.equal(forecastNote(game, 'industrial', quote(game, 'industrial', [{ x: 46, y: 34 }])), null, 'a lone tile with no road says nothing the quote has not said');
});

test('the forecast shares the simulation’s road and service gates', () => {
  // A funded town develops without service; tiles with no road in their 3 × 3 ring count as roadless and earn nothing.
  const { game, city } = streetTown(), road = block(42, 32, 3, 1), both = block(42, 32, 3, 3).filter(p => p.y === 32 || p.x === 42);
  assert.equal(zoneForecast(game, 'residential', quote(game, 'residential', road)).served, false);
  assert.equal(zoneForecast(game, 'residential', quote(game, 'residential', road)).rent, null);
  city.fundedUntil = Math.floor(game.day) + 365;
  assert.equal(fundedTown(city, game.day), true);
  const alone = zoneForecast(game, 'residential', quote(game, 'residential', road)), mixed = zoneForecast(game, 'residential', quote(game, 'residential', block(42, 32, 3, 3)));
  assert.equal(alone.served, true);
  assert.deepEqual([mixed.roadless, mixed.towns[0].tiles], [4, 5]);
  const roadOnly = zoneForecast(game, 'residential', quote(game, 'residential', both));
  assert.deepEqual([mixed.residents, mixed.rent], [roadOnly.residents, roadOnly.rent], 'the roadless tiles add no residents and no rent');
  assert.ok(mixed.payback >= roadOnly.payback, 'but its price still counts');
  // Ashford is unserved until its bus arrives, served while a running route calls, and unserved again once the route is retired.
  const fixture = twoTownFixture(), { game: world, A, route } = fixture, points = block(A.x + 4, A.y + 7), f = () => zoneForecast(world, 'residential', quote(world, 'residential', points));
  assert.deepEqual([f().served, f().rent, f().payback], [false, null, null]);
  assert.deepEqual(forecastNote(world, 'residential', quote(world, 'residential', points)), { forecast: 'Develops once a route serves Ashford', warning: false });
  served(fixture);
  assert.equal(f().served, true);
  assert.ok(removeRoute(world, route.id).ok);
  for (let day = 0; day < 20; day++) tick(world, 1);
  assert.ok(world.day - A.lastServiceDay <= 30, 'its last service is recent');
  assert.deepEqual([servedTownSet(world).has(A), f().served, f().rent], [false, false, null], 'but no running route calls there');
  A.fundedUntil = Math.floor(world.day) + 365;
  assert.equal(f().served, true, 'a funded town develops without service');
});

test('the zone loop’s gate is the old one, day for day, as service comes and goes', () => {
  const fixture = twoTownFixture(), { game, A, B, route } = fixture;
  for (const [kind, points] of [['residential', block(A.x + 4, A.y + 7)], ['commercial', block(B.x + 4, B.y + 7)]]) assert.ok(buildPlan(game, kind, points).ok);
  const old = (city, connected, day) => (!!city && Number.isFinite(city.lastServiceDay) && game.day - city.lastServiceDay <= 30 && connected.has(city)) || fundedTown(city, day);
  let checks = 0, open = 0;
  for (let day = 0; day < 365; day++) {
    if (day === 120) assert.ok(removeRoute(game, route.id).ok);
    if (day === 170) B.fundedUntil = Math.floor(game.day) + 60;
    if (day === 250) assert.ok(addRoute(game, { mode: 'road', stops: [fixture.sa.id, fixture.sb.id], cargo: 'passengers' }).ok);
    const connected = activeCities(game);
    for (const city of [A, B, null]) { const gate = zoneServiceActive(game, city, connected); assert.equal(gate, old(city, connected, Math.floor(game.day)), `day ${day}`); assert.equal(zoneServiceActive(game, city, servedTownSet(game)), gate); checks++; open += gate; }
    tick(game, 1);
  }
  assert.ok(open > 100 && open < checks - 100, `the gate both opened and closed (${open} of ${checks})`);
});

test('a stroke far from every town is too far to develop', () => {
  const { game, A } = served(twoTownFixture()), points = block(A.x - 3, A.y + 12, 3, 2), placements = quote(game, 'residential', points);
  const f = zoneForecast(game, 'residential', placements);
  assert.deepEqual([f.far, f.towns, f.rent, f.served], [6, [], null, false]);
  assert.deepEqual(forecastNote(game, 'residential', placements), { forecast: 'Too far from a town to develop', warning: true });
  // A stroke over the town's edge names the tiles past it.
  const edge = Array.from({ length: 5 }, (_, i) => ({ x: A.x + 4, y: A.y + 7 + i })).filter(p => !tileAt(game, p.x, p.y).road), note = forecastNote(game, 'residential', quote(game, 'residential', edge));
  assert.equal(note.warning, true);
  assert.match(note.forecast, /^Ashford, about \+\d+ residents and \$\d+ a month in rent, pays back in about \d+ (months|years), 2 too far from a town$/);
});

test('placed homes, shops and workshops forecast rent from their town’s market; the town’s own buildings none', () => {
  const { game, A } = served(twoTownFixture()), view = marketView(game, A);
  const cottage = buildingForecast(game, 'house-cheap-1', A.x + 4, A.y + 7);
  assert.equal(cottage.city, A);
  assert.equal(cottage.rent, priceFor(game, .016 * 1400 * (.6 + .4 * view.demand[0])));
  assert.equal(cottage.payback, Math.ceil(priceFor(game, 1400) / cottage.rent));
  assert.deepEqual(forecastNote(game, 'house-cheap-1', [{ x: A.x + 4, y: A.y + 7 }]), { forecast: `Ashford, about $${cottage.rent} a month in rent, pays back in about ${Math.round(cottage.payback / 12)} years`, warning: false });
  const grocer = buildingForecast(game, 'shop-grocery', A.x + 5, A.y + 7);
  assert.equal(grocer.family, 'food');
  assert.ok(grocer.rent < grocer.stockedRent, `unstocked $${grocer.rent}, stocked $${grocer.stockedRent}`);
  assert.match(forecastNote(game, 'shop-grocery', [{ x: A.x + 5, y: A.y + 7 }]).forecast, new RegExp(`^Ashford, about \\$${grocer.rent} a month in rent or \\$${grocer.stockedRent} stocked with food, pays back in about \\d+ years$`));
  const works = buildingForecast(game, 'workshop', A.x - 8, A.y + 1);
  assert.deepEqual([works.rent, works.goods, works.input, works.output], [priceFor(game, .016 * 12000 * (.3 + .7 * (view.utilization || 0))), 7.5, 'lumber', 'furniture']);
  assert.equal(forecastNote(game, 'workshop', [{ x: A.x - 8, y: A.y + 1 }]).forecast, `Ashford, about 8 furniture a month from delivered lumber and $${works.rent} a month in rent`);
  assert.equal(buildingForecast(game, 'school', A.x + 7, A.y + 1), null);
  assert.equal(forecastNote(game, 'school', [{ x: A.x + 7, y: A.y + 1 }]), null);
  const far = buildingForecast(game, 'house-cheap-1', A.x, A.y + 11);
  assert.deepEqual([far.city, far.rent, far.payback], [null, 0, null]);
  assert.deepEqual(forecastNote(game, 'house-cheap-1', [{ x: A.x, y: A.y + 11 }]), { forecast: 'Countryside, earns no rent', warning: false });
  // The cottage's first rent, at the next close.
  assert.ok(build(game, 'house-cheap-1', A.x + 4, A.y + 7).ok);
  closeMonths(game, 1);
  near(cottage.rent, A.market.rent, .1, 'the cottage’s first rent');
});

test('forecasts only read: a town without a market stays byte for byte, and no market is made', () => {
  const { game, A } = twoTownFixture();
  assert.equal(A.market, undefined);
  const strokes = ['residential', 'commercial', 'industrial'].map(kind => [kind, quote(game, kind, block(A.x + 4, A.y + 7))]), before = JSON.stringify(game);
  for (const [kind, placements] of strokes) { zoneForecast(game, kind, placements); forecastNote(game, kind, placements); }
  for (const kind of ['house-cheap-1', 'shop-grocery', 'service-bank', 'workshop', 'school']) { buildingForecast(game, kind, A.x + 7, A.y + 1); forecastNote(game, kind, [{ x: A.x + 7, y: A.y + 1 }]); }
  assert.equal(JSON.stringify(game), before);
  assert.equal(A.market, undefined, 'ensureMarket never ran');
  assert.doesNotMatch(read('town-forecast.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /ensureMarket|reviewMarket|recordTownSupply|recordVisitors|randomAt|notify|nextId/);
  assert.doesNotMatch(read('model.js'), /town-forecast/, 'the simulation never imports it');
});

test('a town keeps twelve months of returns once it has earned something, and drops a year of nothing', () => {
  const { game, A, B } = twoTownFixture(), cottage = { x: A.x + 4, y: A.y + 7 };
  assert.ok(build(game, 'house-cheap-1', cottage.x, cottage.y).ok);
  let freight = null;
  const spy = (g, city, market) => { if (city === A) freight = market.worksFreightNow || 0; };
  CLOSE_HOOKS.splice(CLOSE_HOOKS.length - 1, 0, spy);
  try { closeMonths(game, 14); } finally { CLOSE_HOOKS.splice(CLOSE_HOOKS.indexOf(spy), 1); }
  assert.equal(A.market.returns.length, 12);
  assert.deepEqual(A.market.returns.at(-1), [A.market.rent, A.market.bonusLast, freight]);
  assert.ok(A.market.returns.every(entry => entry[0] > 0 && Number.isInteger(entry[0])));
  assert.deepEqual(returnsTotals(A.market), [A.market.returns.reduce((sum, entry) => sum + entry[0], 0), 0, 0]);
  assert.equal('returns' in B.market, false, 'a town that earned nothing keeps no ledger');
  assert.equal('worksFreightNow' in A.market, false, 'nor a workshop freight count');
  assert.ok(validateGame(game));
  // Sold, it earns nothing more: a whole year of zero months clears the ledger.
  assert.ok(sellProperty(game, cottage.x, cottage.y).ok);
  closeMonths(game, 11);
  assert.equal(A.market.returns.length, 12);
  closeMonths(game, 1);
  assert.equal(A.market.returns, undefined);
});

test('workshop freight counts the lumber its workshops took and the furniture only they could have made', () => {
  const fixture = freightFixture(), { game, A, B, lumber, furniture } = fixture;
  // Brookby's hardware shops want furniture, so part of its fare is market bonus, which the town's freight leaves out.
  for (const [dx, dy] of [[4, 7], [5, 7], [4, 8], [5, 8]]) assert.ok(placeBuildingSite(game, 'shop-hardware', B.x + dx, B.y + dy, { size: 1, building: { kind: 'shop-hardware', level: 1 } }));
  game.revision++;
  const months = [];
  let last = null;
  const spy = (g, city, market) => { if (city !== A) return; const now = [lumber.revenue, furniture.revenue, furniture.marketBonus || 0]; if (last) months.push({ freight: market.worksFreightNow || 0, lumber: now[0] - last[0], furniture: now[1] - last[1], bonus: now[2] - last[2] }); last = now; };
  CLOSE_HOOKS.splice(CLOSE_HOOKS.length - 1, 0, spy);
  try { closeMonths(game, 5); } finally { CLOSE_HOOKS.splice(CLOSE_HOOKS.indexOf(spy), 1); }
  assert.equal(months.length, 4);
  for (const month of months) assert.equal(month.freight, month.lumber + month.furniture - month.bonus, JSON.stringify(month));
  assert.ok(months.every(month => month.lumber > 0) && months.some(month => month.furniture > 0 && month.bonus > 0), JSON.stringify(months));
  assert.deepEqual(A.market.returns.slice(-4).map(entry => entry[2]), months.map(month => month.freight));
  assert.equal(B.market.returns?.some(entry => entry[2] > 0) ?? false, false, 'the buying town earns no workshop freight');
});

test('products credit nothing when an industry at the loading stop also makes them', () => {
  const credit = works => {
    const { game, A, sa, sb } = worksWorld(works);
    const route = addRoute(game, { mode: 'road', stops: [sa.id, sb.id], cargo: 'furniture' }).route;
    A.workshop = { input: {}, output: { furniture: 300 } };
    const event = deliver(game, route, 24);
    assert.ok(event.revenue > 0);
    return { freight: A.market.worksFreightNow || 0, revenue: event.revenue };
  };
  const alone = credit(false), beside = credit(true);
  assert.equal(alone.freight, alone.revenue, 'from the town’s workshops alone, the whole fare');
  assert.equal(beside.freight, 0, 'the stock may have come from the works');
});

test('a stop where an industry takes part of a lumber load credits the town its share by units', () => {
  const { game, A, sa, factory } = worksWorld(true);
  const sawmill = build(game, 'sawmill', 50, 33).industry, stop = build(game, 'bus-stop', 50, 32).station;
  sawmill.inventory.lumber = 900;
  const route = addRoute(game, { mode: 'road', stops: [stop.id, sa.id], cargo: 'lumber' }).route;
  factory.inventory.lumber = 900 * factory.capacity - 5; // model.js MAX_INVENTORY: the works take 5
  const before = A.market.worksFreightNow || 0, event = deliver(game, route, 24);
  assert.equal(factory.inventory.lumber, 900 * factory.capacity);
  assert.equal((A.market.worksFreightNow || 0) - before, Math.round(event.revenue * 19 / 24));
});

test('saved returns validate, and saves without them load as before', () => {
  const { game, A } = twoTownFixture();
  assert.ok(build(game, 'house-cheap-1', A.x + 4, A.y + 7).ok);
  closeMonths(game, 2);
  A.market.worksFreightNow = 1200;
  const copy = clone(game);
  assert.deepEqual([copy.cities[0].market.returns, copy.cities[0].market.worksFreightNow], [A.market.returns, 1200]);
  assert.equal(validateGame(copy), true);
  const reject = (label, change) => { const other = clone(game); change(other.cities[0].market); assert.equal(validateGame(other), false, label); };
  reject('an entry of two', market => { market.returns[0] = [1, 2]; });
  reject('an entry of four', market => { market.returns[0] = [1, 2, 3, 4]; });
  reject('a negative value', market => { market.returns[0][1] = -1; });
  reject('NaN', market => { market.returns[0][0] = NaN; });
  reject('thirteen months', market => { market.returns = Array.from({ length: 13 }, () => [1, 0, 0]); });
  reject('an empty ledger', market => { market.returns = []; });
  reject('not a list', market => { market.returns = { 0: [1, 0, 0] }; });
  reject('worksFreightNow −1', market => { market.worksFreightNow = -1; });
  const legacy = clone(game);
  for (const city of legacy.cities) { delete city.market.returns; delete city.market.worksFreightNow; }
  const loaded = clone(legacy);
  assert.ok(loaded && validateGame(loaded));
  closeMonths(loaded, 1);
  assert.equal(loaded.cities[0].market.returns.length, 1, 'a legacy save starts its ledger at its next close');
});

test('partitioned frames and a mid-month save continue the ledger exactly', () => {
  const whole = freightFixture().game, parts = freightFixture().game;
  tick(whole, 60); advance(parts, 60, tick);
  assert.ok(whole.cities[0].market.returns?.length >= 1 && whole.cities[0].market.returns.some(entry => entry[2] > 0));
  equivalent(parts, whole);
  const game = freightFixture().game;
  tick(game, 45);
  assert.ok(game.cities[0].market.worksFreightNow > 0, 'freight booked so far this month');
  const restored = clone(game);
  tick(game, 40); tick(restored, 40);
  assert.deepEqual(restored.cities.map(city => city.market), game.cities.map(city => city.market));
  assert.equal(restored.money, game.money);
});

test('a company left alone for 30 years keeps no ledger, spends no ids and earns exactly as without it', () => {
  const runs = [true, false].map(ledger => {
    const game = createGame({ biome: 'taiga', seed: 1847, size: 'regional' }), yearly = [], at = CLOSE_HOOKS.findIndex(hook => hook.name === 'bookReturns'), [hook] = ledger ? [] : CLOSE_HOOKS.splice(at, 1);
    assert.ok(at >= 0);
    try { for (let year = 0; year < 30; year++) { for (let day = 0; day < 365; day++) tick(game, 1); yearly.push(game.money); } } finally { if (hook) CLOSE_HOOKS.splice(at, 0, hook); }
    return { game, yearly };
  });
  assert.ok(runs[0].game.cities.every(city => city.market && !('returns' in city.market) && !('worksFreightNow' in city.market)));
  assert.deepEqual(runs[0].yearly, runs[1].yearly);
  assert.equal(runs[0].game.nextId, runs[1].game.nextId);
  assert.equal(saved(runs[0].game), saved(runs[1].game), 'the save is byte-identical to one without the ledger');
});

test('full ledgers in every town still pass the dense-save and vast quota checks', async () => {
  // Twelve months of seven-digit rent, bonus and freight in every town, and freight booked this month.
  const fill = game => { for (const city of game.cities) { city.market.returns = Array.from({ length: 12 }, (_, m) => [1234567 + m, 2345678 + m, 3456789 + m]); city.market.worksFreightNow = 4567890; } };
  // dense-save.test.mjs: a continent-wide network on a 512² world still saves as small baseline deltas, and losslessly.
  const dense = createGame({ biome: 'taiga', seed: 1847, size: 'square512' });
  for (let y = 0; y < dense.height; y++) for (let x = 0; x < dense.width; x++) {
    if (x % 8 && y % 8) continue;
    const tile = dense.tiles[y * dense.width + x];
    tile.road = true; tile.rail = true;
    if (tile.terrain === 'water') tile.bridge = true; if (tile.terrain === 'mountain') tile.tunnel = true;
    if (tile.terrain === 'forest') { tile.terrain = 'grass'; tile.detail = ''; }
    delete tile.terrainObject;
  }
  monthlyMarkets(dense); fill(dense);
  const encoded = encodeGame(dense);
  assert.ok(JSON.stringify(encoded).length < 200_000, `${JSON.stringify(encoded).length} characters`);
  assert.deepEqual(decodeGame(JSON.parse(JSON.stringify(encoded))).cities.map(city => city.market), dense.cities.map(city => city.market));
  // vast-world.test.mjs: a developed vast autosave and two vast slots fit 5 MiB and resume losslessly.
  const values = new Map(), old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), used = () => [...values].reduce((sum, [key, value]) => sum + (key.length + value.length) * 2, 0);
  const local = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key),
    setItem(key, value) { const prior = values.get(key), next = used() - (prior === undefined ? 0 : (key.length + prior.length) * 2) + (key.length + String(value).length) * 2; if (next > 5 * 1024 * 1024) throw new DOMException('Quota exceeded', 'QuotaExceededError'); values.set(key, String(value)); } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  try {
    const forest = createGame({ biome: 'taiga', size: 'vast', seed: 1847 }), desert = createGame({ biome: 'desert', size: 'vast', seed: 82461 });
    tick(forest, 360); tick(desert, 90); fill(forest); fill(desert);
    assert.ok(validateGame(forest) && validateGame(desert));
    assert.equal(saveGame(forest).ok, true);
    const first = await writeSaveSlot(forest, { name: 'Forest ledgers' }), second = await writeSaveSlot(desert, { name: 'Desert ledgers' });
    assert.equal(first.ok, true, first.message); assert.equal(second.ok, true, second.message);
    assert.ok(used() < 5 * 1024 * 1024);
    assert.deepEqual(JSON.parse(values.get(SAVE_KEY)).state.cities.map(city => city.market), forest.cities.map(city => city.market));
    const resumed = await readSaveSlot(first.id);
    assert.deepEqual(resumed.game.cities.map(city => city.market), forest.cities.map(city => city.market));
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old); else delete globalThis.localStorage;
  }
});

test('a 16 × 16 stroke forecasts within a millisecond on a 2048² world, and again from memory', () => {
  const game = createGame({ biome: 'taiga', seed: 1847, size: 'square2048' }), strokes = [];
  game.money = 1e9;
  for (const city of game.cities) {
    const placements = quote(game, 'residential', block(city.x + 2, city.y - 8, 16, 16));
    if (placements.filter(p => p.state === 'ok').length >= 150) strokes.push(placements);
    if (strokes.length === 5) break;
  }
  assert.equal(strokes.length, 5);
  for (const kind of ['residential', 'commercial', 'industrial']) {
    const cold = [], warm = [];
    for (const placements of strokes) {
      let start = performance.now(); zoneForecast(game, kind, placements); cold.push(performance.now() - start);
      start = performance.now(); zoneForecast(game, kind, placements); warm.push(performance.now() - start);
    }
    assert.ok(Math.min(...cold) < 1, `${kind}: ${Math.min(...cold).toFixed(3)} ms`);
    assert.ok(Math.min(...warm) < .05, `${kind} from memory: ${Math.min(...warm).toFixed(4)} ms`);
  }
});
