import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, build, buildProblem, addRoute, removeRoute, tick, validateGame, restoreGame, buyTownAction, priceFor } from '../model.js';
import { buildPlan } from '../construction-plan.js';
import { encodeGame } from '../save-codec.js';
import { localEnvironment, randomAt, weatherAt } from '../environment.js';
import { passengerArrivals } from '../settlements.js';
import { townOpinion, townStopCounts, townActionQuote, opinionBand, actionActive, disturbTown, OPINION_BANDS, TOWN_ACTIONS, DISTURBANCE, TOWN_RADIUS } from '../town-authority.js';
import { emptyGame, tileAt, line, equivalent } from './helpers.mjs';

const starter = () => createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
const FIELDS = ['serviceMonths', 'disturbance', 'advertisedUntil', 'fundedUntil'];
const CITY_KEYS = ['id', 'name', 'x', 'y', 'population', 'activity', 'growth', 'passengers', 'delivered', 'supplies', 'lastServiceDay'];
const summary = opinion => ({ score: opinion.score, label: opinion.label, growth: opinion.growth });
const nextMonth = game => { const month = game.lastMonth; while (game.lastMonth === month) tick(game, 1); };
// Where build() would accept a tool, nearest the town centre first.
function freeSite(game, tool, town, reach = 8, accept = () => true) {
  for (let r = 1; r <= reach; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = town.x + dx, y = town.y + dy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && accept(x, y) && !buildProblem(game, tool, x, y)) return { x, y };
  }
  assert.fail(`no ${tool} site near ${town.name}`);
}
// A town at (30, 30) on flat open land, with homes it owns within reach.
function founded() {
  const game = emptyGame();
  assert.equal(build(game, 'city', 30, 30).ok, true);
  return { game, town: game.cities[0] };
}
function grove(game, x, y, footprint = 2) {
  for (let dy = 0; dy < footprint; dy++) for (let dx = 0; dx < footprint; dx++) Object.assign(tileAt(game, x + dx, y + dy), { terrain: 'forest', detail: 'pine' });
  tileAt(game, x, y).terrainObject = { kind: 'forest', detail: 'pine', variant: 3, footprint };
  assert.equal(validateGame(game), true);
}

test('a fresh company is Good everywhere, served towns note their stop, and new cities carry no opinion fields', () => {
  const game = starter(), [alderbrook] = game.cities, opinion = townOpinion(game, alderbrook);
  assert.equal(alderbrook.name, 'Alderbrook');
  assert.deepEqual(summary(opinion), { score: 55, label: 'Good', growth: 1 });
  assert.deepEqual(opinion.reasons.map(reason => reason.key), ['stops']);
  assert.deepEqual(opinion.reasons[0], { key: 'stops', count: 1, points: 5 });
  const unserved = townOpinion(game, game.cities[2]);
  assert.deepEqual(summary(unserved), { score: 50, label: 'Good', growth: 1 });
  assert.deepEqual(unserved.reasons, []);
  for (const city of game.cities) {
    assert.ok(FIELDS.every(key => !Object.hasOwn(city, key)), city.name);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(city))), CITY_KEYS);
  }
  // Membership matches the town-to-stop rule every other system uses.
  assert.deepEqual([...townStopCounts(game).keys()], game.cities.slice(0, 2));
});

test('regular service builds opinion over ten months, and a retired route fades it back to Good, never lower', () => {
  const game = starter(), start = game.lastMonth;
  while (game.lastMonth < start + 10) tick(game, 1);
  for (const city of game.cities.slice(0, 2)) {
    assert.equal(city.serviceMonths, 10, city.name);
    assert.deepEqual(summary(townOpinion(game, city)), { score: 80, label: 'Excellent', growth: 1.05 }, city.name);
  }
  assert.ok(game.cities.slice(2).every(city => city.serviceMonths === undefined), 'unserved towns keep no meter');
  assert.equal(removeRoute(game, game.routes[0].id).ok, true);
  const [alderbrook] = game.cities;
  assert.deepEqual(summary(townOpinion(game, alderbrook)), { score: 75, label: 'Very good', growth: 1 });
  for (let month = 0; month < 12; month++) {
    nextMonth(game);
    assert.ok(townOpinion(game, alderbrook).score >= 50, `month ${month}: ${townOpinion(game, alderbrook).score}`);
  }
  assert.equal(Object.hasOwn(alderbrook, 'serviceMonths'), false);
  assert.deepEqual(summary(townOpinion(game, alderbrook)), { score: 50, label: 'Good', growth: 1 });
});

test('demolishing homes, civic buildings and woodland near a town dents its opinion for a while', () => {
  const { game, town } = founded();
  for (const x of [33, 34, 35]) assert.equal(build(game, 'house-cheap-1', x, 30).ok, true);
  assert.ok(game.tiles.some(tile => tile.building?.populationCityId === town.id), 'the town owns its homes');
  for (const x of [33, 34, 35]) assert.equal(build(game, 'bulldoze', x, 30).ok, true);
  assert.equal(town.disturbance, 18);
  assert.equal(build(game, 'school', 36, 34).ok, true);
  assert.equal(build(game, 'bulldoze', 37, 35).ok, true);
  assert.equal(town.disturbance, 24, 'a school within 10 tiles');
  for (const x of [25, 26, 27, 28, 29]) { tileAt(game, x, 36).terrain = 'forest'; assert.equal(build(game, 'bulldoze', x, 36).ok, true); }
  assert.equal(town.disturbance, 29, 'five single forest tiles');
  tileAt(game, 30, 44).terrain = 'forest';
  assert.equal(build(game, 'bulldoze', 30, 44).ok, true);
  assert.equal(town.disturbance, 29, 'woodland 14 tiles away is not the town’s');
  assert.equal(build(game, 'house-cheap-2', 31, 27).ok, true);
  tileAt(game, 31, 27).building.populationCityId = null;
  assert.equal(build(game, 'bulldoze', 31, 27).ok, true);
  assert.equal(town.disturbance, 29, 'a countryside home with no town');
  const reason = townOpinion(game, town).reasons.find(item => item.key === 'demolition');
  assert.deepEqual(reason, { key: 'demolition', amount: 29, months: Math.ceil(29 / 5), points: -29 });
  assert.equal(townOpinion(game, town).score, 21);
  assert.equal(townOpinion(game, town).label, 'Very poor');
  assert.equal(townOpinion(game, town).growth, 1, 'no band slows growth');
});

test('a grove counts once, whether clicked or dragged over, and the dent caps, fades and disappears', () => {
  for (const drag of [false, true]) {
    const { game, town } = founded();
    grove(game, 26, 26);
    const result = drag ? buildPlan(game, 'bulldoze', [{ x: 26, y: 26 }, { x: 27, y: 26 }, { x: 26, y: 27 }, { x: 27, y: 27 }]) : build(game, 'bulldoze', 27, 27);
    assert.equal(result.ok, true, result.message);
    assert.equal(town.disturbance, 4 * DISTURBANCE.woodland, drag ? 'dragged' : 'clicked');
    assert.equal(build(game, 'bulldoze', 26, 26).ok, false, 'the cleared parcel has nothing left to clear');
    assert.equal(town.disturbance, 4);
  }
  const { game, town } = founded();
  town.disturbance = 58;
  assert.equal(build(game, 'house-cheap-1', 33, 30).ok, true);
  assert.equal(build(game, 'bulldoze', 33, 30).ok, true);
  assert.equal(town.disturbance, DISTURBANCE.max);
  assert.equal(disturbTown(town, 6), 0, 'a capped town takes no more');
  assert.equal(disturbTown(null, 6), 0);
  const seen = [];
  while (town.disturbance !== undefined) {
    assert.equal(townOpinion(game, town).reasons.find(item => item.key === 'demolition').months, Math.ceil(town.disturbance / 5));
    nextMonth(game); seen.push(town.disturbance);
  }
  assert.deepEqual(seen, [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, undefined]);
  assert.equal(Object.hasOwn(town, 'disturbance'), false);
});

test('roads, rails, zones and levelling through woodland never disturb a town', () => {
  const { game, town } = founded();
  const woods = (y, from = 24, to = 36) => { for (let x = from; x <= to; x++) tileAt(game, x, y).terrain = 'forest'; };
  woods(26); assert.equal(buildPlan(game, 'road', line(24, 36, 26)).ok, true);
  woods(34); assert.equal(buildPlan(game, 'rail', line(24, 36, 34)).ok, true);
  woods(36, 26, 29); assert.equal(buildPlan(game, 'residential', line(26, 29, 36)).ok, true);
  woods(22, 26, 27); woods(23, 26, 27); tileAt(game, 27, 23).elevation = .3;
  assert.equal(buildPlan(game, 'level', [{ x: 26, y: 22 }, { x: 27, y: 22 }, { x: 26, y: 23 }, { x: 27, y: 23 }]).ok, true);
  assert.equal(town.disturbance, undefined);
  assert.equal(TOWN_RADIUS, 10);
});

test('opinion never blocks building or routes and never changes fares, loading or growth below Excellent', () => {
  const game = starter(), calm = structuredClone(game);
  for (const city of game.cities.slice(0, 2)) city.disturbance = 60;
  assert.deepEqual(game.cities.slice(0, 2).map(city => townOpinion(game, city).label), ['Appalling', 'Appalling']);
  assert.equal(townOpinion(game, game.cities[0]).score, 0);
  const busy = structuredClone(game);
  tick(busy, 20); tick(calm, 20);
  assert.equal(busy.totalRevenue, calm.totalRevenue);
  assert.equal(busy.totalDelivered, calm.totalDelivered);
  assert.deepEqual(busy.cities.map(city => city.population), calm.cities.map(city => city.population));
  const [alderbrook] = game.cities;
  const road = freeSite(game, 'road', alderbrook, 10, (x, y) => !tileAt(game, x, y).road);
  assert.equal(build(game, 'road', road.x, road.y).ok, true);
  const stop = freeSite(game, 'bus-stop', alderbrook, 5, (x, y) => tileAt(game, x, y).road);
  const opened = build(game, 'bus-stop', stop.x, stop.y);
  assert.equal(opened.ok, true, opened.message);
  const zone = freeSite(game, 'residential', alderbrook);
  assert.equal(build(game, 'residential', zone.x, zone.y).ok, true);
  const home = freeSite(game, 'house-cheap-1', alderbrook);
  assert.equal(build(game, 'house-cheap-1', home.x, home.y).ok, true);
  const launched = addRoute(game, { mode: 'road', stops: [opened.station.id, game.stations[1].id], cargo: 'passengers' });
  assert.equal(launched.ok, true, launched.message);
});

test('opinion bands follow the TTD names, and no band slows growth', () => {
  assert.deepEqual([0, 15, 30, 40, 50, 65, 80, 90, 100].map(score => opinionBand(score).label), ['Appalling', 'Very poor', 'Poor', 'Mediocre', 'Good', 'Very good', 'Excellent', 'Outstanding', 'Outstanding']);
  assert.deepEqual([14, 29, 39, 49, 64, 79, 89].map(score => opinionBand(score).label), ['Appalling', 'Very poor', 'Poor', 'Mediocre', 'Good', 'Very good', 'Excellent']);
  assert.equal(OPINION_BANDS.length, 8);
  assert.ok(OPINION_BANDS.filter(band => band.min < 80).every(band => band.growth === 1));
  assert.ok(OPINION_BANDS.every(band => band.growth >= 1));
  assert.deepEqual(OPINION_BANDS.filter(band => band.growth > 1).map(band => [band.label, band.growth]), [['Outstanding', 1.1], ['Excellent', 1.05]]);
  assert.equal(actionActive(undefined, 10), false);
  assert.equal(actionActive(12, 11.9), true);
  assert.equal(actionActive(12, 12), false);
  assert.equal(actionActive(12.5, 1), false);
});

test('advertising is a priced, one-at-a-time campaign that lifts passengers by half and adds no opinion', () => {
  const game = starter(), [alderbrook, pinehaven] = game.cities;
  const quote = townActionQuote(game, alderbrook, 'advertise');
  assert.equal(quote.cost, Math.ceil(priceFor(game, 5000 + 12 * Math.floor(alderbrook.population)) / 100) * 100);
  assert.deepEqual(quote, { action: 'advertise', cost: 13900, days: 180, active: false, until: null, affordable: true });
  const opinion = townOpinion(game, alderbrook).score, money = game.money, expenses = game.monthlyExpenses, operating = game.monthlyOperatingExpenses, revision = game.revision, nextId = game.nextId, notices = game.notifications.length;
  const bought = buyTownAction(game, alderbrook.id, 'advertise');
  assert.equal(bought.ok, true, bought.message);
  assert.equal(bought.message, 'Advertising in Alderbrook for six months. $13,900 spent.');
  assert.deepEqual([bought.cost, bought.until], [13900, 180]);
  assert.equal(game.money, money - quote.cost);
  assert.equal(game.monthlyExpenses, expenses + quote.cost, 'counts as investment spending');
  assert.equal(game.monthlyOperatingExpenses, operating, 'never an operating cost');
  assert.deepEqual([game.revision, game.nextId, game.notifications.length], [revision, nextId, notices]);
  assert.equal(alderbrook.advertisedUntil, Math.floor(game.day) + 180);
  assert.equal(townActionQuote(game, alderbrook, 'advertise').active, true);
  assert.equal(townActionQuote(game, alderbrook, 'advertise').until, 180);
  assert.equal(townOpinion(game, alderbrook).score, opinion, 'money never buys opinion');
  const again = buyTownAction(game, alderbrook.id, 'advertise');
  assert.equal(again.ok, false); assert.match(again.message, /already/);
  assert.equal(game.money, money - quote.cost);
  const short = townActionQuote(game, pinehaven, 'advertise');
  game.money = short.cost - 1;
  const frozen = JSON.stringify(game), refused = buyTownAction(game, pinehaven.id, 'advertise');
  assert.equal(refused.ok, false);
  assert.equal(refused.message, `Need $${short.cost.toLocaleString('en-US')} to advertise in Pinehaven.`);
  assert.equal(JSON.stringify(game), frozen, 'a refusal changes nothing');
  assert.equal(buyTownAction(game, 'city-none', 'advertise').message, 'Town not found.');
  assert.equal(buyTownAction(game, alderbrook.id, 'statue').message, 'Choose a town action.');
  assert.equal(JSON.stringify(game), frozen);
  game.money = 400000;

  const plain = structuredClone(game);
  delete plain.cities[0].advertisedUntil;
  for (const copy of [game, plain]) copy.cities[0].passengers = 0;
  tick(game, 1); tick(plain, 1);
  assert.ok(plain.cities[0].passengers > 0);
  assert.ok(Math.abs(game.cities[0].passengers / plain.cities[0].passengers - 1.5) < 1e-9, `${game.cities[0].passengers} / ${plain.cities[0].passengers}`);

  while (Math.floor(game.day) < 180) tick(game, 1);
  assert.equal(game.cities[0].advertisedUntil, 180, 'the key waits for the month to close');
  assert.equal(townActionQuote(game, game.cities[0], 'advertise').active, false);
  const lapsed = structuredClone(game);
  delete lapsed.cities[0].advertisedUntil;
  for (const copy of [game, lapsed]) copy.cities[0].passengers = 0;
  tick(game, .5); tick(lapsed, .5); tick(game, .5); tick(lapsed, .5);
  assert.equal(game.cities[0].passengers, lapsed.cities[0].passengers, 'a lapsed campaign adds nothing');
  nextMonth(game);
  assert.equal(Object.hasOwn(game.cities[0], 'advertisedUntil'), false);
});

test('funding new buildings lets even an unserved town build homes for a year, then ends silently', () => {
  const game = starter(), unserved = game.cities[2], plain = structuredClone(game);
  assert.equal(townOpinion(game, unserved).reasons.length, 0);
  const quote = townActionQuote(game, unserved, 'fund');
  assert.equal(quote.cost, Math.ceil(priceFor(game, 15000 + 25 * Math.floor(unserved.population)) / 100) * 100);
  assert.equal(townActionQuote(game, game.cities[0], 'fund').cost, 33500);
  const bought = buyTownAction(game, unserved.id, 'fund');
  assert.equal(bought.ok, true, bought.message);
  assert.equal(bought.message, `New buildings funded in ${unserved.name} for a year. $${quote.cost.toLocaleString('en-US')} spent.`);
  assert.equal(unserved.fundedUntil, 365);
  assert.match(buyTownAction(game, unserved.id, 'fund').message, /^New buildings are already funded in /);
  const population = unserved.population, before = plain.cities[2].population;
  tick(game, 180); tick(plain, 180);
  assert.ok(unserved.population > population, `${population} to ${unserved.population}`);
  assert.equal(plain.cities[2].population, before, 'an unfunded unserved town stays as it is');
  while (Math.floor(game.day) < 364) tick(game, 1);
  assert.equal(townActionQuote(game, unserved, 'fund').active, true, 'funded through the last day of the year');
  nextMonth(game);
  assert.equal(Math.floor(game.day), 365);
  assert.equal(Object.hasOwn(unserved, 'fundedUntil'), false);
  assert.equal(game.notifications.some(notice => /fund/i.test(notice.message)), false, 'no end-of-campaign notice');
});

test('frame partitioning, saves and validation keep the four optional fields exact', () => {
  const game = starter();
  assert.equal(buyTownAction(game, game.cities[0].id, 'advertise').ok, true);
  assert.equal(buyTownAction(game, game.cities[2].id, 'fund').ok, true);
  game.cities[1].disturbance = 30;
  const whole = structuredClone(game), parts = structuredClone(game);
  tick(whole, 200);
  for (let n = 0; n < 800; n++) tick(parts, .25);
  equivalent(parts, whole);
  assert.ok(whole.cities[0].serviceMonths > 0 && whole.cities[1].disturbance === undefined && whole.cities[2].fundedUntil === 365);

  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(whole))));
  assert.ok(restored);
  assert.deepEqual(restored.cities, whole.cities);
  const day = Math.floor(whole.day);
  const invalid = [['disturbance', 61], ['disturbance', -1], ['disturbance', NaN], ['serviceMonths', 11], ['serviceMonths', 1.5], ['serviceMonths', -1], ['advertisedUntil', day + 181], ['advertisedUntil', 1.5], ['fundedUntil', day + 366], ['fundedUntil', '3']];
  for (const [key, value] of invalid) {
    const copy = structuredClone(whole); copy.cities[3][key] = value;
    assert.equal(validateGame(copy), false, `${key} ${value}`);
  }
  for (const [key, value] of [['disturbance', 60], ['disturbance', 0.5], ['serviceMonths', 0], ['serviceMonths', 10], ['advertisedUntil', day + 180], ['fundedUntil', day + 365], ['fundedUntil', 0]]) {
    const copy = structuredClone(whole); copy.cities[3][key] = value;
    assert.equal(validateGame(copy), true, `${key} ${value}`);
  }
  const legacy = starter();
  tick(legacy, 3);
  assert.equal(validateGame(legacy), true);
  const loaded = restoreGame(JSON.parse(JSON.stringify(encodeGame(legacy))));
  assert.ok(loaded.cities.every(city => FIELDS.every(key => !Object.hasOwn(city, key))), 'restoreGame adds none of them');
});

test('passenger arrivals are unchanged without a campaign and exactly half as many again with one', () => {
  const game = starter();
  tick(game, 40);
  const day = Math.floor(game.day);
  for (const city of game.cities) {
    const environment = localEnvironment(game, city.x, city.y), weather = weatherAt(game, city.x, city.y, day), draw = randomAt(game, day, city.id, 101);
    const clamp = value => Math.max(0, Math.min(1, value));
    const before = city.population * (.005 + .006 * clamp(environment.housing / 14) + .003 * environment.amenity + .002 * clamp(environment.shops / 6)) * (.55 + draw * .95) * (.70 + weather.travel * .3) * (1 - environment.pollution * .22);
    assert.equal(passengerArrivals(game, city, day), before, city.name);
    assert.equal(passengerArrivals(game, { ...city, advertisedUntil: day + 1 }, day), before * TOWN_ACTIONS.advertise.passengers);
    assert.equal(passengerArrivals(game, { ...city, advertisedUntil: day }, day), before, 'a campaign ends on its until day');
  }
});
