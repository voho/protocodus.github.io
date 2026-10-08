import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, build, buildPath, addRoute, removeRoute, tick, priceFor, validateGame, restoreGame, expandWorkshop, sellProperty } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { placeBuildingSite, buildingAt } from '../building-sites.js';
import { BUILDINGS } from '../buildings.js';
import { money } from '../copy.js';
import { GROUND_RENT, BUILT_YIELD, OCCUPANCY_FLOOR, CLOSE_HOOKS, townOf, townLedger, ensureMarket, monthlyMarkets, propertyBase, propertyOccupancy, propertyValue, propertyAt, companyProperty, drainPropertyEvents } from '../town-market.js';
import { completeFixtureConstruction, emptyGame, tileAt, line, advance, equivalent, twoTownFixture } from './helpers.mjs';

const clone = game => restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
const saved = game => JSON.stringify(encodeGame(game));
const ledgerOf = (game, city) => townLedger(game, city, new Map(game.zones.map(zone => [zone.y * game.width + zone.x, zone])));
// Whole days until `n` more months have closed; `each` runs before every day.
function closeMonths(game, n = 1, each) { const target = game.lastMonth + n; while (game.lastMonth < target) { each?.(); tick(game, 1); } }
// The run without the rent step, for comparisons: every other close step is untouched.
function withoutRent(run) { const hooks = CLOSE_HOOKS.splice(0); try { return run(); } finally { CLOSE_HOOKS.push(...hooks); } }
// Shops get everything they want this month, as deliveries would bring.
function stock(game, city) { const market = ensureMarket(game, city); for (const family of ['food', 'household', 'fuel', 'materials']) market.supplied[family] = Math.max(market.supplied[family], market.wants[family]); }
// Developers build on a zone, as the settlement commit does: a level over the zone, spreading onto a larger footprint.
function develop(game, kind, x, y, level = 1, size = 1) {
  const building = { kind, level }, town = townOf(game, x, y);
  if (BUILDINGS[kind]?.residents) building.populationCityId = town?.id ?? null;
  assert.ok(placeBuildingSite(game, kind, x, y, { size, building, exclude: buildingAt(game, x, y), allowZone: true }), `${kind} at ${x},${y}`);
  game.revision++;
  return building;
}
const place = (game, kind, x, y) => { const placed = build(game, kind, x, y); assert.equal(placed.ok, true, `${kind}: ${placed.message}`); completeFixtureConstruction(game, placed.building, placed.industry); return placed; };
const zoneBlock = (game, kind, x, y) => { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) place(game, kind, x + dx, y + dy); };
// Ashford's clear 2 × 2 blocks between its streets, out of the built-up centre: (4, 7), (7, 1), (7, 4), (−8, 1), (−2, 7), (1, 7), (7, −2).

test('what the company paid for is its property: placed homes, shops and services, and its zones once built up', () => {
  const { game, A } = twoTownFixture();
  const cottage = place(game, 'house-cheap-1', A.x + 4, A.y + 7);
  assert.equal(cottage.building.owner, 'player'); assert.equal(cottage.building.paid, cottage.cost); assert.equal(cottage.cost, priceFor(game, 1400));
  const grocer = place(game, 'shop-grocery', A.x + 5, A.y + 7).building, bank = place(game, 'service-bank', A.x - 8, A.y + 1).building;
  assert.deepEqual([grocer.owner, bank.owner, bank.paid], ['player', 'player', priceFor(game, 16000)]);
  for (const [kind, x, y] of [['school', A.x + 7, A.y + 1], ['pub', A.x + 4, A.y + 8]]) {
    const { building } = place(game, kind, x, y);
    assert.deepEqual([building.owner, building.paid], [undefined, undefined], `${kind} is a public building`);
  }
  place(game, 'residential', A.x + 5, A.y + 8);
  let ledger = ledgerOf(game, A);
  assert.deepEqual(ledger.owned.map(p => [p.kind, p.sector, p.family]), [['service-bank', 'shops', null], ['house-cheap-1', 'homes', null], ['shop-grocery', 'shops', 'food']]);
  assert.deepEqual(ledger.plots, [], 'an undeveloped zone is land waiting for developers');
  develop(game, 'house-normal-1', A.x + 5, A.y + 8, 2);
  ledger = ledgerOf(game, A);
  assert.deepEqual(ledger.plots, [{ x: A.x + 5, y: A.y + 8, kind: 'house-normal-1', level: 2, tiles: 1, sector: 'homes', family: null, zoneKind: 'residential' }]);
  assert.equal(propertyAt(game, A.x + 5, A.y + 8).kind, 'plot'); assert.equal(propertyAt(game, A.x + 4, A.y + 7).kind, 'owned');
  assert.equal(propertyAt(game, A.x + 7, A.y + 1), null); assert.equal(propertyAt(game, A.x + 4, A.y + 8), null);
  assert.equal(validateGame(game), true);
});

test('an undeveloped zone, the countryside and public buildings earn nothing', () => {
  const { game, A } = twoTownFixture();
  place(game, 'residential', A.x + 4, A.y + 7); place(game, 'house-cheap-1', A.x, A.y + 11);
  place(game, 'school', A.x + 7, A.y + 1).building.owner = 'player';
  assert.equal(townOf(game, A.x, A.y + 11), null, 'eleven tiles from every centre');
  closeMonths(game, 2);
  assert.equal(tileAt(game, A.x + 4, A.y + 7).building, null, 'the zone is still waiting');
  assert.equal(game.totalProperty, undefined); assert.ok(game.history.every(h => h.property === undefined));
  assert.deepEqual(ledgerOf(game, A).owned, [], 'a school is never property, whatever its owner field says');
  assert.equal(propertyAt(game, A.x + 7, A.y + 1), null);
  const far = propertyAt(game, A.x, A.y + 11);
  assert.deepEqual([far.town, far.rent, far.occupancy, far.value], [null, 0, 0, priceFor(game, 1400)]);
  assert.ok(game.cities.every(city => city.market.rent === undefined), 'a town without property keeps its market as it was');
  assert.deepEqual(companyProperty(game), []);
});

test('ground rent follows the zone tiles paid for, not a building that spreads over empty land', () => {
  const { game, A } = twoTownFixture(), x = A.x + 7, y = A.y + 1;
  place(game, 'residential', x, y);
  develop(game, 'house-expensive-1', x, y, 3, 2);
  const [plot] = ledgerOf(game, A).plots;
  assert.deepEqual([plot.tiles, plot.level, propertyBase(plot)], [1, 3, 8 * 1 * 3]);
  assert.equal(game.zones.find(z => z.x === x && z.y === y).tiles, undefined, 'a zone of its own stores nothing extra');
  // A zoned block taken into one building keeps its four tiles on the anchor record.
  zoneBlock(game, 'residential', A.x + 4, A.y + 7);
  develop(game, 'house-expensive-2', A.x + 4, A.y + 7, 3, 2);
  assert.deepEqual(game.zones.filter(z => z.y > A.y + 5).map(z => [z.x - A.x, z.y - A.y, z.tiles]), [[4, 7, 4]]);
  const block = ledgerOf(game, A).plots.find(p => p.y === A.y + 7);
  assert.deepEqual([block.tiles, propertyBase(block)], [4, 8 * 4 * 3]);
  develop(game, 'house-expensive-3', A.x + 4, A.y + 7, 3, 2);
  assert.equal(game.zones.find(z => z.y === A.y + 7).tiles, 4, 'rebuilding in place keeps the count');
  assert.equal(validateGame(game), true);
  // A plot that consolidated before the count was kept pays for the one tile it always earned on.
  delete game.zones.find(z => z.y === A.y + 7).tiles;
  assert.equal(ledgerOf(game, A).plots.find(p => p.y === A.y + 7).tiles, 1);
});

test('rent is its base times occupancy, priced at the close, and every sector has a floor', () => {
  const plot = { x: 0, y: 0, kind: 'house-normal-1', level: 2, tiles: 1, sector: 'homes', family: null, zoneKind: 'residential' };
  const market = { demand: [.5, 0, 0], met: { food: 1, household: 0, fuel: 0, materials: 0 }, visitors: 0, shops: 1 };
  assert.equal(propertyBase(plot), 16); assert.ok(Math.abs(propertyOccupancy(market, plot, 0) - .8) < 1e-12);
  assert.equal(priceFor(emptyGame(), propertyBase(plot) * propertyOccupancy(market, plot, 0)), 13, '12.8, priced');
  const grocer = { kind: 'shop-grocery', level: 1, tiles: 1, sector: 'shops', family: 'food' };
  assert.ok(Math.abs(propertyBase(grocer) - 88) < 1e-9); assert.equal(propertyOccupancy(market, grocer, 200), 1, 'met in full and 200 shoppers for one shop');
  assert.ok(Math.abs(propertyBase({ kind: 'factory', level: 2, tiles: 4, sector: 'works', family: null }) - BUILT_YIELD * 24000) < 1e-9);
  const quiet = { demand: [0, 0, 0], met: { food: 0, household: 0, fuel: 0, materials: 0 }, visitors: 0, shops: 0 };
  assert.deepEqual(['homes', 'shops', 'works'].map(sector => propertyOccupancy(quiet, { sector, family: null }, 0)), [.6, .4, .3]);
  assert.deepEqual({ ...GROUND_RENT }, { homes: 8, shops: 10, works: 12 }); assert.deepEqual({ ...OCCUPANCY_FLOOR }, { homes: .6, shops: .4, works: .3 });
  assert.ok(Object.isFrozen(GROUND_RENT) && Object.isFrozen(OCCUPANCY_FLOOR));
  // A close books exactly that sum over the town's property.
  const { game, A } = twoTownFixture();
  place(game, 'house-cheap-1', A.x + 4, A.y + 7); place(game, 'shop-grocery', A.x + 5, A.y + 7); place(game, 'workshop', A.x - 8, A.y + 1); place(game, 'residential', A.x + 4, A.y + 8);
  develop(game, 'house-normal-2', A.x + 4, A.y + 8, 2);
  closeMonths(game, 2, () => stock(game, A));
  const ledger = ledgerOf(game, A), expected = priceFor(game, [...ledger.plots, ...ledger.owned].reduce((sum, p) => sum + propertyBase(p) * propertyOccupancy(A.market, p, A.population), 0));
  assert.equal(ledger.plots.length + ledger.owned.length, 4);
  assert.deepEqual([A.market.rent, A.market.plots, A.market.owned, game.history.at(-1).property], [expected, 1, 3, expected]);
  const share = propertyAt(game, A.x + 5, A.y + 7);
  assert.deepEqual([share.sector, share.family, share.rent], ['shops', 'food', priceFor(game, 88 * share.occupancy)]);
});

// The calibration table, in 1950 dollars: one investment at a time in Ashford, served by one bus; rent in the 36th month.
test('returns match the calibration within a quarter', () => {
  const run = (setup, { months = 36, stocked = false } = {}) => { const { game, A } = twoTownFixture(); setup(game, A); closeMonths(game, months, stocked ? () => stock(game, A) : undefined); return { game, A, rent: game.history.at(-1).property }; };
  const near = (value, target, label) => assert.ok(Math.abs(value - target) <= .25 * target, `${label}: $${value} against $${target}`);
  near(run((game, A) => zoneBlock(game, 'residential', A.x + 4, A.y + 7)).rent, 59, 'a residential 2 × 2 zone block');
  // The same four zones, each alone with room to spread, earn a little more once built up for using four times the land.
  const singles = [[7, -2], [7, 1], [-2, 7], [1, 7]], spread = run((game, A) => singles.forEach(([dx, dy]) => place(game, 'residential', A.x + dx, A.y + dy)), { months: 72 });
  near(spread.rent, 88, 'four single zones once built up');
  assert.ok(singles.every(([dx, dy]) => buildingAt(spread.game, spread.A.x + dx, spread.A.y + dy)?.building.footprint === 2), 'each spread over its empty neighbours');
  near(run((game, A) => place(game, 'house-cheap-1', A.x + 4, A.y + 7)).rent, 21, 'a cottage');
  near(run((game, A) => place(game, 'shop-grocery', A.x + 4, A.y + 7), { stocked: true }).rent, 96, 'a stocked grocer');
  near(run((game, A) => place(game, 'shop-grocery', A.x + 4, A.y + 7)).rent, 38, 'an unstocked grocer');
  // Ashford's whole free land zoned 70/20/10 earns $1.0–1.2k a month.
  const whole = run((game, A) => {
    const plots = [];
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) { const x = A.x + dx, y = A.y + dy, tile = tileAt(game, x, y); if (Math.hypot(dx, dy) < 10 && !tile.road && !buildingAt(game, x, y) && !game.stations.some(s => s.x === x && s.y === y)) plots.push({ x, y, d: Math.hypot(dx, dy) }); }
    plots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x).forEach((p, n) => place(game, n % 10 < 7 ? 'residential' : n % 10 < 9 ? 'commercial' : 'industrial', p.x, p.y));
  }, { stocked: true });
  assert.ok(whole.rent >= 750 && whole.rent <= 1500, `a fully zoned town: $${whole.rent}`);
  assert.ok(whole.A.population > 3000, `${Math.round(whole.A.population)} residents`);
});

test('rent is company income in the closing month, never route revenue', () => {
  const runs = [true, false].map(rent => {
    const fixture = twoTownFixture(), { game, A } = fixture;
    place(game, 'house-cheap-1', A.x + 4, A.y + 7); zoneBlock(game, 'residential', A.x - 2, A.y + 7);
    (rent ? run => run() : withoutRent)(() => closeMonths(game, 14));
    return fixture;
  });
  const [{ game, route }, { game: plain, route: plainRoute }] = runs;
  assert.ok(game.history.every(h => h.property > 0));
  game.history.forEach((h, n) => {
    const other = plain.history[n];
    assert.deepEqual([h.income - other.income, h.profit - other.profit, h.operatingProfit - other.operatingProfit, h.expenses - other.expenses], [h.property, h.property, h.property, 0], `month ${h.month}`);
    assert.equal(other.property, undefined);
  });
  assert.equal(game.lastMonthlyProfit - plain.lastMonthlyProfit, game.history.at(-1).property);
  assert.equal(game.lastMonthlyOperatingProfit - plain.lastMonthlyOperatingProfit, game.history.at(-1).property);
  assert.deepEqual([route.revenue, route.expenses, game.totalRevenue], [plainRoute.revenue, plainRoute.expenses, plain.totalRevenue], 'route accounting never includes rent');
  assert.equal(game.totalProperty, game.history.reduce((sum, h) => sum + h.property, 0));
  assert.equal(game.money - plain.money, game.totalProperty);
  assert.equal(game.monthlyProperty, undefined, 'the month total resets when the month closes');
  const year = game.history.filter(h => h.month < 12).reduce((sum, h) => sum + h.property, 0);
  assert.deepEqual([game.annual[0].year, game.annual[0].property, plain.annual[0].property], [1950, year, undefined]);
  assert.equal(game.annual[0].revenue - plain.annual[0].revenue, year);
});

test('completed property retains its occupancy floor while rebuilding property earns no rent', () => {
  const { game, A } = twoTownFixture();
  zoneBlock(game, 'residential', A.x + 4, A.y + 7); zoneBlock(game, 'residential', A.x + 7, A.y + 4);
  place(game, 'shop-grocery', A.x - 5, A.y + 7); place(game, 'workshop', A.x - 8, A.y + 1); place(game, 'house-normal-1', A.x + 1, A.y + 7);
  closeMonths(game, 24);
  const served = game.history.at(-1).property, sites = [...ledgerOf(game, A).plots, ...ledgerOf(game, A).owned];
  assert.ok(sites.length >= 7, `${sites.length} properties`);
  for (const route of [...game.routes]) assert.ok(removeRoute(game, route.id).ok);
  let lowest = Infinity;
  for (let month = 0; month < 24; month++) {
    closeMonths(game, 1);
    lowest = Math.min(lowest, game.history.at(-1).property || 0);
    for (const p of sites) { const share = propertyAt(game, p.x, p.y); if (buildingAt(game, p.x, p.y).building.construction) assert.equal(share.occupancy, 0); else assert.ok(share.occupancy >= OCCUPANCY_FLOOR[share.sector] - 1e-12, `${p.kind} at ${share.occupancy}`); }
  }
  assert.ok(lowest > 0 && lowest < served, `rent fell from $${served} to at least $${lowest}`);
});

test('selling returns 60% of today’s value, keeps the building and stops its rent', () => {
  const { game, A } = twoTownFixture(), x = A.x + 4, y = A.y + 7;
  const { building } = place(game, 'house-cheap-1', x, y);
  closeMonths(game, 13);
  assert.ok(game.history.at(-1).property > 0);
  const value = priceFor(game, 1400), before = game.money, sold = sellProperty(game, x, y);
  assert.equal(sold.ok, true); assert.equal(sold.refund, Math.round(.6 * value));
  assert.equal(sold.message, `Workers’ cottage sold to Ashford for ${money(sold.refund)}.`);
  assert.equal(game.money, before + sold.refund);
  assert.equal(tileAt(game, x, y).building, building);
  assert.deepEqual(building, { kind: 'house-cheap-1', level: 1, footprint: 1, populationCityId: A.id }, 'the town takes it over as it stands');
  const total = game.totalProperty;
  closeMonths(game, 1);
  assert.deepEqual([game.totalProperty, game.history.at(-1).property, A.market.rent, A.market.owned], [total, undefined, 0, 0], 'its rent stops at the next close');
  assert.equal(validateGame(game), true);
});

test('a sold workshop keeps its level and stock; plots, public and town buildings cannot be sold', () => {
  const { game, A } = twoTownFixture(), x = A.x + 4, y = A.y + 7;
  place(game, 'workshop', A.x - 8, A.y + 1); const expansion = expandWorkshop(game, A.x - 8, A.y + 1); assert.ok(expansion.ok); completeFixtureConstruction(game, expansion.building);
  game.cities[0].workshop = { input: { lumber: 40 }, output: { furniture: 12 } };
  const works = sellProperty(game, A.x - 7, A.y + 2);
  assert.equal(works.refund, Math.round(.6 * priceFor(game, 24000))); assert.match(works.message, /^Workshop sold to Ashford for \$[\d,]+\.$/);
  assert.deepEqual(tileAt(game, A.x - 8, A.y + 1).building, { kind: 'factory', level: 2, footprint: 2 });
  assert.deepEqual(game.cities[0].workshop, { input: { lumber: 40 }, output: { furniture: 12 } });
  assert.equal(expandWorkshop(game, A.x - 8, A.y + 1).message, 'Only your own workshops can be expanded.');
  // Refusals change nothing.
  place(game, 'house-cheap-1', x, y); sellProperty(game, x, y);
  place(game, 'residential', A.x + 1, A.y + 7); develop(game, 'house-cheap-2', A.x + 1, A.y + 7);
  place(game, 'school', A.x + 7, A.y + 1);
  const home = game.tiles.findIndex(tile => tile.building?.populationCityId === A.id && !tile.zone && tile.building.owner === undefined && tile.building.kind !== 'house-cheap-1');
  const snapshot = saved(game);
  for (const [px, py, message] of [[A.x + 1, A.y + 7, 'Only buildings you placed can be sold.'], [A.x + 8, A.y + 2, 'This building is not yours to sell.'], [home % game.width, Math.floor(home / game.width), 'This building is not yours to sell.'], [A.x + 2, A.y + 12, 'Only buildings you placed can be sold.'], [x, y, 'This building is not yours to sell.']]) {
    const refused = sellProperty(game, px, py);
    assert.deepEqual([refused.ok, refused.message], [false, message], `${px},${py}`);
  }
  assert.equal(saved(game), snapshot);
  // In the countryside no town takes it over by name.
  place(game, 'house-cheap-1', A.x, A.y + 11);
  assert.equal(sellProperty(game, A.x, A.y + 11).message, `Workers’ cottage sold for ${money(Math.round(.6 * priceFor(game, 1400)))}.`);
  assert.equal(validateGame(game), true);
});

test('a company that owns no property books no rent and spends no ids', () => {
  const runs = [true, false].map(rent => {
    const game = createGame({ biome: 'taiga', seed: 1847, size: 'regional' });
    (rent ? run => run() : withoutRent)(() => { for (let day = 0; day < 3 * 365; day++) tick(game, 1); });
    return game;
  });
  assert.equal(runs[0].totalProperty, undefined); assert.ok(runs[0].history.every(h => !('property' in h)));
  assert.ok(runs[0].cities.every(city => city.market && !('rent' in city.market)));
  assert.equal(runs[0].nextId, runs[1].nextId);
  assert.equal(saved(runs[0]), saved(runs[1]), 'the save is byte-identical to one without the rent step');
});

test('each renting town sends one month-end event, drained once and never saved', () => {
  const setup = () => { const fixture = twoTownFixture(), { game, A, B } = fixture; place(game, 'house-cheap-1', A.x + 4, A.y + 7); place(game, 'house-normal-1', B.x + 4, B.y + 7); return fixture; };
  const { game, A, B } = setup();
  drainPropertyEvents(game); closeMonths(game, 1);
  const events = drainPropertyEvents(game);
  assert.deepEqual(events, [A, B].map(city => ({ cityId: city.id, x: city.x, y: city.y, rent: city.market.rent, day: Math.floor(game.day) })));
  assert.ok(events.every(event => event.rent > 0));
  assert.deepEqual(drainPropertyEvents(game), []);
  closeMonths(game, 33);
  assert.equal(drainPropertyEvents(game).length, 64, 'at most 64 wait for a drain');
  const drained = setup().game, kept = setup().game;
  closeMonths(drained, 6, () => drainPropertyEvents(drained)); closeMonths(kept, 6);
  assert.equal(saved(drained), saved(kept));
});

test('property saves, restores and validates; a legacy save’s zones earn from its first close', () => {
  const { game, A } = twoTownFixture();
  zoneBlock(game, 'residential', A.x + 4, A.y + 7); develop(game, 'house-expensive-1', A.x + 4, A.y + 7, 3, 2);
  place(game, 'house-cheap-1', A.x + 1, A.y + 7);
  closeMonths(game, 2); game.monthlyProperty = 12;
  const restored = clone(game);
  assert.deepEqual(restored.zones, game.zones); assert.equal(restored.zones[0].tiles, 4);
  assert.deepEqual([restored.monthlyProperty, restored.totalProperty], [12, game.totalProperty]);
  assert.deepEqual(restored.history, game.history); assert.deepEqual(restored.cities.map(city => city.market), game.cities.map(city => city.market));
  assert.equal(tileAt(restored, A.x + 1, A.y + 7).building.owner, 'player');
  // A save from before property: no counts, rent keys or owners. Its zones still earn from the first close.
  const legacy = clone(game);
  delete legacy.totalProperty; delete legacy.monthlyProperty; for (const h of legacy.history) delete h.property; for (const zone of legacy.zones) delete zone.tiles;
  for (const city of legacy.cities) { delete city.market.rent; delete city.market.plots; delete city.market.owned; }
  for (const tile of legacy.tiles) if (tile.building) { delete tile.building.owner; delete tile.building.paid; }
  const loaded = clone(legacy);
  assert.ok(loaded && validateGame(loaded));
  closeMonths(loaded, 1);
  assert.ok(loaded.history.at(-1).property > 0); assert.equal(loaded.totalProperty, loaded.history.at(-1).property);
  assert.equal(loaded.cities[0].market.plots, 1); assert.equal(loaded.cities[0].market.owned, 0, 'an old catalog home stays the town’s');
  const reject = (label, change) => { const copy = clone(game); change(copy); assert.equal(validateGame(copy), false, label); };
  reject('zone tiles 0', copy => { copy.zones[0].tiles = 0; }); reject('zone tiles 10', copy => { copy.zones[0].tiles = 10; }); reject('zone tiles 1.5', copy => { copy.zones[0].tiles = 1.5; });
  reject('history rent NaN', copy => { copy.history[0].property = NaN; }); reject('total rent below zero', copy => { copy.totalProperty = -1; });
  reject('month rent below zero', copy => { copy.monthlyProperty = -1; }); reject('annual rent below zero', copy => { copy.annual = [{ year: 1950, revenue: 0, operatingProfit: 0, delivered: 0, population: 0, routes: 1, bestRouteId: null, property: -1 }]; });
  reject('owner town', copy => { tileAt(copy, A.x + 1, A.y + 7).building.owner = 'town'; });
  reject('market rent below zero', copy => { copy.cities[0].market.rent = -1; }); reject('fractional plots', copy => { copy.cities[0].market.plots = 1.5; });
});

test('partitioned frames match a whole tick with property, food supply and a workshop', () => {
  const make = () => {
    const { game, A, sa } = twoTownFixture();
    place(game, 'house-cheap-1', A.x + 4, A.y + 7); place(game, 'shop-grocery', A.x + 5, A.y + 7); place(game, 'workshop', A.x - 8, A.y + 1); zoneBlock(game, 'residential', A.x + 7, A.y + 4);
    assert.ok(buildPath(game, 'road', line(A.x - 19, A.x - 9, 48)).ok); place(game, 'food-plant', A.x - 19, 49);
    const plant = game.industries.at(-1), stop = place(game, 'bus-stop', A.x - 18, 48).station; plant.inventory.food = 900;
    assert.ok(addRoute(game, { mode: 'road', stops: [stop.id, sa.id], cargo: 'food' }).ok);
    return game;
  };
  const whole = make(), parts = make();
  tick(whole, 90); advance(parts, 90, tick);
  assert.ok(whole.history.length >= 2 && whole.history.every(h => h.property > 0));
  equivalent(parts, whole);
});

// A day's tick is the yardstick, as for the market pass, timed in alternation so machine load weighs on both alike.
test('the monthly pass with property stays within the market budget on a 2048² world', () => {
  const game = createGame({ biome: 'taiga', seed: 1847, size: 'square2048' }), passes = [], ticks = [], time = run => { const start = performance.now(); run(); return performance.now() - start; };
  game.money = 1e9;
  let placed = 0;
  for (const city of game.cities.slice(0, 60)) for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) {
    const x = city.x + dx, y = city.y + dy;
    if (build(game, (dx + dy) % 4 ? 'house-cheap-1' : 'residential', x, y).ok) { placed++; if (tileAt(game, x, y).zone) develop(game, 'house-normal-1', x, y, 2); }
  }
  assert.ok(placed > 1000, `${placed} properties`);
  for (let n = 0; n < 3; n++) monthlyMarkets(game);
  assert.ok(game.totalProperty > 0);
  for (let n = 0; n < 7; n++) { ticks.push(time(() => tick(game, 1))); passes.push(time(() => monthlyMarkets(game))); }
  ticks.sort((a, b) => a - b);
  const pass = Math.min(...passes), day = ticks[3];
  assert.ok(pass <= .5 * day, `${pass.toFixed(1)} ms against a ${day.toFixed(1)} ms day`);
  const start = performance.now(); companyProperty(game); const report = performance.now() - start;
  assert.ok(report < 50, `the report's property pass took ${report.toFixed(1)} ms`);
});
