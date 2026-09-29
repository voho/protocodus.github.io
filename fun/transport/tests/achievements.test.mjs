import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createGame, restoreGame, validateGame, tick, buildPath, networkTotals, invalidateNetworkPoints } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { captureWorld, materializeWorld } from '../world-transfer.js';
import { CARGO } from '../data.js';
import { chainProducts } from '../chains.js';
import { priceFor, inflationInfo, calendarMonth } from '../economy-pricing.js';
import { ACHIEVEMENTS, ACHIEVEMENT_FAMILIES, ACHIEVEMENT_GROUPS, ACHIEVEMENT_IDS, ACHIEVEMENT_TIERS, CARGO_ORDER, CARGO_BIT, CARGO_MASK, cargoMask, cargoCount, createAchievementState, noteDelivery, stepAchievements, drainAchievementUnlocks, achievementProgress, validAchievements, earnedCount } from '../achievements.js';
import { renderAchievements } from '../achievements-view.js';
import { achievementNotices } from '../ui-notices.js';
import { emptyGame, line, equivalent } from './helpers.mjs';

const dayOf = (year, month = 0, date = 1) => Math.round((Date.UTC(year, month, date) - Date.UTC(1950, 0, 1)) / 864e5);
const at = (game, day) => { game.day = day; game.lastDailyDay = day; game.lastMonth = calendarMonth(game); };
const days = (game, n, step = 1) => { for (let i = 0; i < n / step; i++) tick(game, step); };
const stamped = game => Object.keys(game.achievements.unlocked);
// A December close as tick() runs it: the day after the year's last day, with the closed month's index.
const closeYear = (game, year, options = {}) => { game.day = dayOf(year + 1); return stepAchievements(game, { closedMonth: (year - 1950) * 12 + 11, served: new Set(), ...options }); };
const closeMonth = (game, year, month, options = {}) => { game.day = dayOf(year, month + 1); return stepAchievements(game, { closedMonth: (year - 1950) * 12 + month, served: new Set(), ...options }); };
const fresh = () => { const game = emptyGame(); drainAchievementUnlocks(game); return game; };
const route = (id, a, b, extra = {}) => ({ id, name: id, mode: 'road', cargo: 'passengers', active: true, delivered: 0, revenue: 0, stops: [a, b], path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], ...extra });

test('the catalog: 41 records in 21 families and 6 groups, round targets rising within each family', () => {
  assert.equal(ACHIEVEMENTS.length, 41);assert.equal(ACHIEVEMENT_FAMILIES.length, 21);assert.equal(ACHIEVEMENT_GROUPS.length, 6);
  assert.equal(ACHIEVEMENT_IDS.size, 41);assert.ok(ACHIEVEMENTS.length <= 64);
  const groups = new Set(ACHIEVEMENT_GROUPS.map(g => g.id)), round = new Set([1, 10, 25, 50, 100, 250, 1000, 2500, 5000, 1e4, 1e5, 1e6, 1e7, 1e8]);
  for (const a of ACHIEVEMENTS) { assert.ok(a.id.length <= 40, a.id);assert.ok(groups.has(a.group), a.id);assert.ok(ACHIEVEMENT_TIERS.includes(a.tier), a.id);assert.ok(round.has(a.target), a.id);assert.ok(a.title && a.detail, a.id); }
  for (const f of ACHIEVEMENT_FAMILIES) {
    assert.ok(['day', 'month', 'year'].includes(f.cadence), f.id);assert.equal(typeof f.measure, 'function');
    f.rungs.forEach((r, i) => i && assert.ok(r.target > f.rungs[i - 1].target, `${f.id} rises`));
  }
  assert.equal(ACHIEVEMENTS.filter(a => a.hidden).length, 5);
  assert.ok(Object.isFrozen(ACHIEVEMENTS) && Object.isFrozen(ACHIEVEMENT_FAMILIES) && Object.isFrozen(CARGO_ORDER));
  assert.deepEqual([...CARGO_ORDER].sort(), Object.keys(CARGO).sort());assert.equal(new Set(CARGO_ORDER).size, CARGO_ORDER.length);
  assert.equal(CARGO_MASK, 2 ** CARGO_ORDER.length - 1);assert.equal(CARGO_BIT.passengers, 1);assert.equal(CARGO_BIT.mail, 1 << 20);
  // Every cargo the landscape makes, and mail; never passengers.
  assert.deepEqual(['taiga', 'tundra', 'desert'].map(b => cargoCount(cargoMask(b))), [13, 11, 12]);
  for (const b of ['taiga', 'tundra', 'desert']) { assert.equal(cargoMask(b) & CARGO_BIT.passengers, 0);assert.equal(cargoCount(cargoMask(b)), chainProducts(b).length + 1); }
  // Every ladder starts beyond the Company goals' last step.
  const rent = ACHIEVEMENT_FAMILIES.find(f => f.id === 'property');
  assert.deepEqual(rent.rungs.map(r => [r.id, r.tier, r.target]), [['property-10k', 'bronze', 1e4], ['property-100k', 'silver', 1e5], ['property-1m', 'gold', 1e6]]);
});

test('a new company starts with empty records and earns nothing in its first two months', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  assert.deepEqual(game.achievements, createAchievementState(0));assert.equal(validateGame(game), true);
  days(game, 60);
  assert.deepEqual(game.achievements.unlocked, {});assert.deepEqual(drainAchievementUnlocks(game), []);
  assert.ok(game.achievements.cargo & CARGO_BIT.passengers, 'the starter bus notes passengers');
});

test('day records stamp at the next day boundary, once, with that day', () => {
  const game = fresh();at(game, 40);
  game.totalDelivered = 99999;tick(game, 1);
  assert.deepEqual(stamped(game), []);
  game.totalDelivered = 100000;tick(game, .5);
  assert.deepEqual(stamped(game), [], 'no boundary, no stamp');
  tick(game, .5);
  assert.deepEqual(game.achievements.unlocked, { 'delivered-100k': 42 });
  assert.deepEqual(drainAchievementUnlocks(game), ['delivered-100k']);assert.deepEqual(drainAchievementUnlocks(game), []);
  tick(game, 3);assert.deepEqual(drainAchievementUnlocks(game), [], 'a stamp is never repeated');
});

test('a fleet of 1,000 earns three rungs on one day, returned in catalog order', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 }), bus = game.vehicles[0];
  for (let n = 1; n < 1000; n++) game.vehicles.push({ ...bus, id: `clone-${n}` });
  tick(game, 1);
  assert.deepEqual(drainAchievementUnlocks(game), ['fleet-10', 'fleet-100', 'fleet-1000']);
  assert.deepEqual(new Set(Object.values(game.achievements.unlocked)), new Set([1]));
  const direct = fresh();direct.vehicles = Array.from({ length: 100 }, (_, n) => ({ id: `v${n}` }));
  assert.deepEqual(stepAchievements(direct), ['fleet-10', 'fleet-100']);
});

test('network records wait for the month close; streets never count, bridges and tunnels do', () => {
  const game = fresh();at(game, dayOf(1950, 0, 20));
  const ok = result => assert.equal(result.ok, true, result.message);
  for (let row = 0; row < 10; row++) ok(buildPath(game, 'rail', line(10, 109, 10 + row * 2)));
  assert.equal(networkTotals(game).owned, 1000);
  const streets = line(10, 60, 60);for (const p of streets) Object.assign(game.tiles[p.y * game.width + p.x], { road: true, publicRoad: true });invalidateNetworkPoints(game, streets);
  assert.equal(networkTotals(game).owned, 1000, 'town streets are not yours');
  days(game, 10);
  assert.deepEqual(stamped(game), [], 'January has not closed');
  days(game, 2);
  assert.equal(game.achievements.unlocked['network-1k'], dayOf(1950, 1, 1));
  // Bridge and tunnel tiles count toward structures, a public street bridge does not.
  const spans = [...line(10, 69, 80), ...line(10, 49, 82)];
  spans.forEach((p, n) => Object.assign(game.tiles[p.y * game.width + p.x], n < 60 ? { rail: true, bridge: true } : { road: true, tunnel: true }));
  const street = line(70, 79, 84);for (const p of street) Object.assign(game.tiles[p.y * game.width + p.x], { road: true, publicRoad: true, bridge: true });
  invalidateNetworkPoints(game, [...spans, ...street]);
  const recount = () => { let owned = 0, structures = 0; for (const t of game.tiles) { if (t.rail || t.road && !t.publicRoad) owned++; if ((t.bridge || t.tunnel) && (t.rail || !t.publicRoad)) structures++; } return { owned, structures }; };
  assert.deepEqual({ owned: networkTotals(game).owned, structures: networkTotals(game).structures }, recount());
  assert.equal(networkTotals(game).structures, 100);
  days(game, 30);
  assert.equal(game.achievements.unlocked['structures-100'], dayOf(1950, 2, 1));
});

test('yearly money is in 1950 dollars: a route just short of a million misses, one just over earns at its year close', () => {
  const game = fresh(), r = route('r1', 'a', 'b');game.routes.push(r);
  const mid = year => dayOf(year, 6, 1);
  assert.ok(inflationInfo(game, mid(1955)).index > 1.05);
  r.profitLastYear = priceFor(game, 1e6, mid(1955)) - 10;closeYear(game, 1955);
  assert.equal(game.achievements.unlocked['route-year-1m'], undefined);assert.ok(game.achievements.bestRouteYear > 999980 && game.achievements.bestRouteYear < 1e6);
  r.profitLastYear = priceFor(game, 1e6, mid(1956)) + 10;closeYear(game, 1956);
  assert.equal(game.achievements.unlocked['route-year-1m'], dayOf(1957));
  // Operating profit: the company report's entry for the year, else its months in history.
  const index = inflationInfo(game, mid(1957)).index;
  game.annual = [{ year: 1957, revenue: 0, operatingProfit: 12e6 * index, delivered: 0, population: 0, routes: 0, bestRouteId: null }];
  closeYear(game, 1957);assert.equal(game.achievements.bestYear, 12e6);assert.equal(game.achievements.unlocked['profit-year-10m'], dayOf(1958));
  const later = fresh();later.history = Array.from({ length: 12 }, (_, m) => ({ month: 8 * 12 + m, operatingProfit: 1000 }));
  closeYear(later, 1958);assert.equal(later.achievements.bestYear, Math.round(12000 / inflationInfo(later, mid(1958)).index));
});

test('a real December close records the year: best year from its report entry and yearCargo cleared', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  at(game, dayOf(1955, 11, 1));game.achievements.yearCargo = CARGO_BIT.coal;
  days(game, 31);
  const entry = game.annual.at(-1), index = inflationInfo(game, dayOf(1955, 6, 1)).index;
  assert.equal(entry.year, 1955);assert.equal(game.achievements.bestYear, Math.max(0, Math.round(entry.operatingProfit / index)));
  assert.equal(game.achievements.yearCargo, 0);assert.equal(game.achievements.unlocked['whole-economy'], undefined);
  assert.equal(game.achievements.unlocked['years-10'], undefined, '1956 is six years in');
});

test('rent: $12,000 of 1950-dollar rent in a closed year earns bronze only', () => {
  const game = fresh(), index = inflationInfo(game, dayOf(1960, 6, 1)).index;
  game.history = Array.from({ length: 12 }, (_, m) => ({ month: 10 * 12 + m, property: 1000 * index }));
  closeYear(game, 1960);
  assert.equal(game.achievements.bestRent, 12000);
  assert.deepEqual(stamped(game).filter(id => id.startsWith('property')), ['property-10k']);
});

test('cargo: every cargo once for Every cargo, and all of it within one calendar year for Whole economy', () => {
  const game = fresh(), mask = cargoMask('taiga'), cargo = CARGO_ORDER.filter(key => mask & CARGO_BIT[key]);
  assert.equal(cargo.length, 13);
  for (const key of cargo.slice(1)) noteDelivery(game.achievements, key);
  noteDelivery(game.achievements, 'passengers');
  closeYear(game, 1950);
  assert.equal(game.achievements.unlocked['whole-economy'], undefined);assert.equal(game.achievements.unlocked['every-cargo'], undefined);
  assert.equal(game.achievements.yearCargo, 0, 'December clears the year');
  noteDelivery(game.achievements, cargo[0]);
  assert.equal(game.achievements.unlocked['every-cargo'], undefined, 'a delivery stamps nothing by itself');
  closeMonth(game, 1951, 0);
  assert.equal(game.achievements.unlocked['every-cargo'], dayOf(1951, 1, 1), 'the lifetime set completes at the month close');
  assert.equal(game.achievements.unlocked['whole-economy'], undefined);
  for (const key of cargo) noteDelivery(game.achievements, key);
  closeMonth(game, 1951, 5);assert.equal(game.achievements.unlocked['whole-economy'], undefined, 'only December judges the year');
  closeYear(game, 1951);
  assert.equal(game.achievements.unlocked['whole-economy'], dayOf(1952));assert.equal(game.achievements.yearCargo, 0);
});

test('back from the red: a month closed below zero, then $1 million in 1950 dollars; a loan changes nothing', () => {
  const game = fresh();at(game, dayOf(1962, 2, 20));game.money = -5000;game.loan = 250000;
  days(game, 12);
  assert.equal(game.achievements.red, true);
  game.money = priceFor(game, 1e6) - 1;tick(game, 1);
  assert.equal(game.achievements.unlocked['back-from-red'], undefined);
  game.money = priceFor(game, 1e6);tick(game, 1);
  assert.equal(game.achievements.unlocked['back-from-red'], Math.floor(game.day));
  const rich = fresh();rich.money = 5e6;rich.loan = 100000;tick(rich, 1);
  assert.equal(rich.achievements.unlocked['back-from-red'], undefined, 'never in the red');
});

test('hidden records: museum piece, grand central, heavy haul and a nominal billion', () => {
  const museum = fresh();museum.vehicles = [{ id: 'old', level: 0, load: 0 }, { id: 'new', level: 40, load: 0 }];
  closeMonth(museum, 1999, 10);assert.equal(museum.achievements.unlocked['museum-piece'], undefined);
  closeMonth(museum, 2000, 0);assert.equal(museum.achievements.unlocked['museum-piece'], dayOf(2000, 1, 1));
  const upgraded = fresh();upgraded.vehicles = [{ id: 'a', level: 45, load: 0 }, { id: 'b', level: 50, load: 0 }];
  closeMonth(upgraded, 2000, 0);assert.equal(upgraded.achievements.unlocked['museum-piece'], undefined);

  const hub = (count, distinct) => { const game = fresh();game.routes = Array.from({ length: count }, (_, n) => route(`r${n}`, 'hub', `s${n % distinct}`));return game; };
  const ten = hub(10, 10);closeMonth(ten, 1950, 3);assert.ok(ten.achievements.unlocked['grand-central'] >= 0);
  const twins = hub(10, 1);closeMonth(twins, 1950, 3);assert.equal(twins.achievements.unlocked['grand-central'], undefined, 'duplicate routes on one pair count once');
  const nine = hub(12, 9);closeMonth(nine, 1950, 3);assert.equal(nine.achievements.unlocked['grand-central'], undefined);
  const idle = hub(10, 10);idle.routes[0].active = false;closeMonth(idle, 1950, 3);assert.equal(idle.achievements.unlocked['grand-central'], undefined, 'only running routes count');

  const heavy = fresh();heavy.vehicles = [{ id: 'ship', level: 31, load: 1000 }];
  closeMonth(heavy, 1980, 5);assert.equal(heavy.achievements.unlocked['heavy-haul'], undefined);
  closeMonth(heavy, 1981, 5);assert.equal(heavy.achievements.unlocked['heavy-haul'], dayOf(1981, 6, 1));

  const billion = fresh();billion.money = 1e9 - 1;tick(billion, 1);assert.equal(billion.achievements.unlocked['billion-nominal'], undefined);
  billion.money = 1e9;tick(billion, 1);assert.equal(billion.achievements.unlocked['billion-nominal'], 2);
});

test('towns, with the served set injected', () => {
  const town = (n, population = 400, founded) => ({ id: `t${n}`, name: `T${n}`, x: n, y: 1, population, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, ...founded === undefined ? {} : { founded } });
  const game = fresh();game.cities = Array.from({ length: 60 }, (_, n) => town(n));
  closeMonth(game, 1960, 0, { served: new Set(game.cities.slice(0, 49)) });assert.equal(game.achievements.unlocked['served-50'], undefined);
  closeMonth(game, 1960, 1, { served: new Set(game.cities.slice(0, 50)) });assert.equal(game.achievements.unlocked['served-50'], dayOf(1960, 2, 1));
  assert.equal(game.achievements.unlocked['every-town'], undefined);
  const small = fresh();small.cities = Array.from({ length: 24 }, (_, n) => town(n));
  closeMonth(small, 1960, 0, { served: new Set(small.cities) });assert.equal(small.achievements.unlocked['every-town'], undefined, 'a world of 24 is too small');
  const all = fresh();all.cities = Array.from({ length: 25 }, (_, n) => town(n));
  closeMonth(all, 1960, 0, { served: new Set(all.cities.slice(1)) });assert.equal(all.achievements.unlocked['every-town'], undefined);
  closeMonth(all, 1960, 1, { served: new Set(all.cities) });assert.equal(all.achievements.unlocked['every-town'], dayOf(1960, 2, 1));

  const big = fresh();big.cities = Array.from({ length: 12 }, (_, n) => town(n, n < 9 ? 5000 : 4999));
  closeMonth(big, 1960, 0);assert.ok(big.achievements.unlocked['town-5000'] >= 0);assert.equal(big.achievements.unlocked['towns-5000-10'], undefined);
  big.cities[9].population = 5200;closeMonth(big, 1960, 1);assert.equal(big.achievements.unlocked['towns-5000-10'], dayOf(1960, 2, 1));

  const founded = fresh();founded.cities = [town(0, 3000), town(1, 2400, true), town(2, 3000, false)];
  closeMonth(founded, 1960, 0);assert.equal(founded.achievements.unlocked['founded-2500'], undefined, 'only a town you founded');
  founded.cities[1].population = 2500;closeMonth(founded, 1960, 1);assert.equal(founded.achievements.unlocked['founded-2500'], dayOf(1960, 2, 1));
});

test('an older save is credited quietly on load, from the day it loads', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 }), bus = game.vehicles[0];
  for (let n = 1; n < 12; n++) game.vehicles.push({ ...bus, id: `extra-${n}` });
  at(game, 400.5);game.totalDelivered = 150000;game.routes[0].delivered = 500;game.routes[0].profitLastYear = 5000;
  delete game.achievements;
  const nextId = game.nextId, notifications = structuredClone(game.notifications);
  const loaded = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(loaded);assert.equal(validateGame(loaded), true);
  const a = loaded.achievements;
  assert.equal(a.since, 400);assert.equal(a.unlocked['delivered-100k'], 400);assert.equal(a.unlocked['fleet-10'], 400);
  assert.equal(a.unlocked['fleet-100'], undefined);assert.equal(a.bestRouteYear, 5000);
  assert.ok(a.cargo & CARGO_BIT.passengers);assert.equal(a.yearCargo, 0);
  assert.deepEqual(drainAchievementUnlocks(loaded), [], 'a backfill never celebrates');
  assert.equal(loaded.nextId, nextId);assert.deepEqual(loaded.notifications, notifications);
  // Records kept in a save are never backfilled again.
  loaded.achievements.unlocked['years-10'] = 1;
  const again = restoreGame(JSON.parse(JSON.stringify(encodeGame(loaded))));
  assert.deepEqual(again.achievements, loaded.achievements);
});

test('saves and the worker transfer keep the records exactly', async () => {
  const game = createGame({ biome: 'tundra', size: 'regional', seed: 99 });
  Object.assign(game.achievements, { unlocked: { 'fleet-10': 0, 'from-the-future': 0 }, cargo: CARGO_BIT.coal | CARGO_BIT.mail, yearCargo: CARGO_BIT.coal, bestYear: 123, bestRouteYear: 45, bestRent: 6, red: true });
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.deepEqual(restored.achievements, game.achievements);assert.equal(earnedCount(restored), 1, 'unknown ids are kept and ignored');
  const loaded = await materializeWorld(await captureWorld(game, { cooperative: false }), { cooperative: false });
  assert.deepEqual(loaded.achievements, game.achievements);
});

test('validateGame rejects damaged records and accepts unknown ids', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });at(game, 100.5);
  const variant = change => { const copy = structuredClone(game);change(copy.achievements, copy);return validateGame(copy); };
  assert.equal(variant(a => { a.unlocked = { 'fleet-10': 100, 'someday-maybe': 3 }; }), true);
  assert.equal(variant((a, g) => { delete g.achievements; }), true);
  assert.equal(variant(a => { delete a.bestRent;delete a.red; }), true);
  for (const [name, change] of [
    ['a stamp after today', a => { a.unlocked['fleet-10'] = 101; }],
    ['a fractional stamp', a => { a.unlocked['fleet-10'] = 1.5; }],
    ['a 41-character id', a => { a.unlocked['x'.repeat(41)] = 1; }],
    ['65 ids', a => { for (let n = 0; n < 65; n++) a.unlocked[`id-${n}`] = 1; }],
    ['cargo bits beyond the list', a => { a.cargo = CARGO_MASK + 1; }],
    ['NaN best year', a => { a.bestYear = NaN; }],
    ['negative route year', a => { a.bestRouteYear = -1; }],
    ["red: 'yes'", a => { a.red = 'yes'; }],
    ['since after today', a => { a.since = 101; }],
    ['an array', (a, g) => { g.achievements = []; }],
    ['unlocked as an array', a => { a.unlocked = []; }],
  ]) assert.equal(variant(change), false, name);
  assert.equal(validAchievements({ day: 0 }), true);
});

test('records never change the simulation', () => {
  const a = createGame({ biome: 'taiga', size: 'regional', seed: 1847 }), b = structuredClone(a);delete b.achievements;
  a.totalDelivered = b.totalDelivered = 99990;a.money = b.money = 1e9;
  days(a, 400);days(b, 400);
  assert.ok(Object.keys(a.achievements.unlocked).length >= 2, 'records were earned along the way');
  for (const key of ['money', 'vehicles', 'industries', 'cities', 'notifications', 'nextId', 'routes', 'history']) assert.deepEqual(a[key], b[key], key);
});

test('only the records, their dialog, the model hooks and the interface read game.achievements', () => {
  const dir = new URL('../', import.meta.url);
  const readers = readdirSync(dir).filter(name => name.endsWith('.js') && /\.achievements\b/.test(readFileSync(new URL(name, dir), 'utf8'))).sort();
  assert.deepEqual(readers, ['achievements-view.js', 'achievements.js', 'app.js', 'model.js']);
  // The model only creates, feeds, validates and backfills them.
  const model = readFileSync(new URL('model.js', dir), 'utf8').split('\n').filter(line => /\.achievements\b/.test(line)).map(line => line.trim());
  assert.deepEqual(model, ['if(game.achievements)noteDelivery(game.achievements,route.cargo);', 'if(game.achievements===undefined)backfillAchievements(game,{networkTotals});']);
});

test('frame partitions: quarter days and whole days stamp the same records on the same days', () => {
  const make = () => { const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });game.totalDelivered = 99000;game.money = 999999000;return game; };
  const whole = make(), quarters = make();
  days(whole, 800);days(quarters, 800, .25);
  assert.ok(stamped(whole).length >= 2);
  equivalent(quarters.achievements, whole.achievements, 'achievements');
  equivalent(quarters.money, whole.money, 'money');
  assert.deepEqual(drainAchievementUnlocks(quarters), drainAchievementUnlocks(whole));
});

test('cost: a busy company’s month close stays under 8 ms and 100,000 days under 50 ms', () => {
  const game = { width: 1024, height: 1024, biome: 'taiga', day: dayOf(2001, 0, 1), money: 5e6, totalDelivered: 5e7, history: [], routes: [], vehicles: [], stations: [], industries: [], cities: [], achievements: createAchievementState(0) };
  for (let n = 0; n < 2000; n++) game.stations.push({ id: `station-${n}`, x: n % 1000, y: n % 997, mode: 'road' });
  for (let n = 0; n < 10000; n++) { const a = n % 2000, b = (a + 1 + Math.floor(n / 2000) % 4) % 2000;game.routes.push(route(`route-${n}`, `station-${a}`, `station-${b}`, { path: Array.from({ length: 2 + n % 200 }, (_, i) => ({ x: i, y: 0 })) })); }
  for (let n = 0; n < 10000; n++) game.vehicles.push({ id: `vehicle-${n}`, routeId: `route-${n}`, level: 1 + n % 50, load: n % 900 });
  for (let n = 0; n < 128; n++) game.cities.push({ id: `city-${n}`, name: `C${n}`, x: n, y: n, population: 1000 + n * 10, founded: n % 7 === 0 });
  for (let n = 0; n < 700; n++) game.industries.push({ id: `industry-${n}`, capacity: n % 5 === 0 ? 3 : 1.5 });
  const served = new Set(game.cities.slice(0, 40)), totals = { owned: 5000, structures: 50 }, networkTotals = () => totals;
  for (let n = 0; n < 5; n++) stepAchievements(game, { closedMonth: 612, served, networkTotals });
  let started = performance.now();
  for (let n = 0; n < 20; n++) stepAchievements(game, { closedMonth: 612, served, networkTotals });
  const month = (performance.now() - started) / 20;
  assert.deepEqual(Object.keys(game.achievements.unlocked).sort(), ['delivered-100k', 'delivered-1m', 'delivered-10m', 'fleet-10', 'fleet-100', 'fleet-1000', 'full-capacity-10', 'full-capacity-50', 'network-1k', 'years-10', 'years-25', 'years-50'].sort());
  assert.ok(month < 8, `month step ${month.toFixed(2)} ms`);
  started = performance.now();
  for (let n = 0; n < 1e5; n++) stepAchievements(game);
  const daily = performance.now() - started;
  assert.ok(daily < 50, `100,000 daily steps ${daily.toFixed(1)} ms`);
});

test('achievementProgress: the live measure against the next rung', () => {
  const game = fresh();game.totalDelivered = 412300;
  assert.deepEqual(achievementProgress(game, 'delivered'), { value: 412300, target: 1e5, pct: 100, rung: ACHIEVEMENT_FAMILIES[0].rungs[0], complete: false });
  Object.assign(game.achievements.unlocked, { 'delivered-100k': 0 });
  const second = achievementProgress(game, 'delivered');assert.equal(second.target, 1e6);assert.equal(second.pct, 41);assert.equal(second.rung.id, 'delivered-1m');
  Object.assign(game.achievements.unlocked, { 'delivered-1m': 1, 'delivered-10m': 2, 'delivered-100m': 3 });
  const done = achievementProgress(game, 'delivered');assert.equal(done.complete, true);assert.equal(done.rung.id, 'delivered-100m');
});

test('the dialog: six groups, 41 rows, five hidden ones until earned', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  const html = renderAchievements(game, { served: new Set(), network: { owned: 0, structures: 0 } });
  assert.match(html, /<strong data-num>0<\/strong> of 41 earned/);
  assert.equal((html.match(/class="achievement-group"/g) || []).length, 6);
  assert.equal((html.match(/class="achievement-row"/g) || []).length, 21);
  assert.equal((html.match(/<strong>Hidden achievement<\/strong>/g) || []).length, 5);
  for (const a of ACHIEVEMENTS.filter(a => a.hidden)) { assert.ok(!html.includes(a.title), a.title);assert.ok(!html.includes(a.detail), a.detail); }
  assert.doesNotMatch(html, /Records began/, 'a new company has kept records from the start');
  assert.doesNotMatch(html, / · /);
  game.achievements.unlocked['museum-piece'] = dayOf(2000, 1, 1);game.achievements.since = 400;
  const earned = renderAchievements(game, { served: new Set(), network: { owned: 0, structures: 0 } });
  assert.match(earned, /Museum piece/);assert.match(earned, /1 Feb 2000/);assert.match(earned, /<strong data-num>1<\/strong> of 41 earned/);
  assert.match(earned, /Records began in Feb 1951/);
  assert.equal((earned.match(/<strong>Hidden achievement<\/strong>/g) || []).length, 4);
});

test('notices: two records stay separate, three or more become one line at the top tier', () => {
  assert.deepEqual(achievementNotices([]), []);
  assert.deepEqual(achievementNotices(['delivered-100k', 'fleet-100']), [
    { message: 'Bronze achievement: 100,000 delivered.', tier: 'bronze' },
    { message: 'Silver achievement: A hundred vehicles.', tier: 'silver' },
  ]);
  assert.deepEqual(achievementNotices(['fleet-10', 'fleet-100', 'fleet-1000']), [{ message: '3 achievements earned: Ten vehicles, A hundred vehicles and A thousand vehicles.', tier: 'gold' }]);
  assert.deepEqual(achievementNotices(['fleet-10', 'fleet-100', 'years-10', 'years-25', 'delivered-100m']), [{ message: '5 achievements earned: Ten vehicles, A hundred vehicles, Ten years and 2 more.', tier: 'platinum' }]);
  assert.deepEqual(achievementNotices(['no-such-record']), []);
});
