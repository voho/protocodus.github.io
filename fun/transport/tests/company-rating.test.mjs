import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createGame, tick, validateGame, restoreGame, buildPath, build, addRoute, editRoute, priceFor, BUILD_COSTS } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { calendarMonth } from '../economy-pricing.js';
import { CAREER_TITLES, RATING_PARTS, titleForScore, ratingPoints, ratingInputs, reviewPerformance, validPerformance, companyValue, careerTitle, nextTitle, nextReviewDay } from '../company-rating.js';
import { emptyGame, line } from './helpers.mjs';
import { twoTownFixture } from './helpers.mjs';
import { placeBuildingSite } from '../building-sites.js';

const starter = () => createGame({ size: 'regional', seed: 1847 });
const days = (game, n, step = 1) => { for (let i = 0; i < n / step; i++) tick(game, step); };
const yearDay = year => (Date.UTC(year, 0, 1) - Date.UTC(1950, 0, 1)) / 86400000, until = (game, day) => days(game, day - game.day);
// Extra copies of the starter route, each with `count` buses, rated on a whole year of `profit`.
function addRoutes(game, profits, count) {
  const [route] = game.routes, [bus] = game.vehicles.filter(v => v.routeId === route.id);
  game.vehicles = game.vehicles.filter(v => v.routeId !== route.id); game.routes = [];
  profits.forEach((profit, n) => {
    game.routes.push({ ...structuredClone(route), id: `rated-${n}`, number: n + 1, profitLastYear: profit, accountingStartDay: 0 });
    for (let k = 0; k < count; k++) game.vehicles.push({ ...structuredClone(bus), id: `rated-${n}-${k}`, routeId: `rated-${n}` });
  });
  return game;
}

test('points follow the square-root curve, the linear parts and the loan share', () => {
  const game = starter();
  const points = ratingPoints(game, [160, 150, 16000, 1250000, 2500000, 100000, 4, 25000000, 100000], 0, 250000);
  assert.deepEqual(points, [80, 100, 80, 25, 50, 200, 25, 25, 30]);
  assert.equal(points.reduce((a, b) => a + b, 0), 615); assert.equal(titleForScore(615), 5);
  assert.equal(RATING_PARTS.reduce((sum, part) => sum + part.max, 0), 1000);
});

test('money targets rise with prices', () => {
  const game = starter(); game.day = 7305;
  const target = priceFor(game, 5e6), values = n => [0, 0, null, n, 0, 0, 0, 0, 0];
  assert.ok(target > 5e6);
  assert.equal(ratingPoints(game, values(target), game.day)[3], 50);
  assert.equal(ratingPoints(game, values(target - 1), game.day)[3], 49);
});

test('negative values, a missing weakest route and a loan without a limit score nothing; no loan scores 50', () => {
  const game = starter();
  assert.deepEqual(ratingPoints(game, [-5, 0, null, -1e6, -1, 0, 0, -50, 0], 0, 0), [0, 0, 0, 0, 0, 0, 0, 0, 50]);
  assert.equal(ratingPoints(game, [0, 0, -16000, 0, 0, 0, 0, 0, 1000], 0, 0)[2], 0);
  assert.equal(ratingPoints(game, [0, 0, 0, 0, 0, 0, 0, 0, 1000], 0, 0)[8], 0);
});

test('a title every 120 points, in sentence case', () => {
  assert.deepEqual([0, 119, 120, 959, 960, 1000].map(titleForScore), [0, 0, 1, 7, 8, 8]);
  assert.equal(CAREER_TITLES.length, 9); assert.equal(CAREER_TITLES[8], 'Tycoon');
  for (const title of CAREER_TITLES) assert.equal(title.slice(1), title.slice(1).toLowerCase(), title);
  const game = starter(); assert.equal(careerTitle(game), 0); assert.deepEqual(nextTitle(game), { index: 1, name: 'Traffic manager', score: 120 });
  game.performance = { reached: Array(9).fill(0) }; assert.equal(nextTitle(game), null);
});

test('the first review closes March: on 1 April 1950, day 90', () => {
  const game = starter();
  days(game, 89); assert.equal(game.performance, undefined);
  days(game, 1);
  const performance = game.performance;
  assert.equal(performance.day, 90); assert.deepEqual(performance.reached, [90]);
  assert.equal(performance.values[2], null); assert.equal(performance.weakest, null);
  assert.ok(performance.score < 120, `score ${performance.score}`);
  assert.deepEqual([0, 90, 36524].map(day => nextReviewDay({ day })), [90, 181, 36525]);
});

test('whole and quarter ticks review identically', () => {
  const whole = starter(), frames = starter();
  days(whole, 400); days(frames, 400, .25);
  assert.deepStrictEqual(frames.performance, whole.performance);
  assert.deepStrictEqual(frames.routes.map(r => r.profitLastYear), whole.routes.map(r => r.profitLastYear));
  assert.equal(frames.nextId, whole.nextId);
  assert.ok(whole.performance.day === 365 && typeof whole.routes[0].profitLastYear === 'number');
});

test('a review changes nothing but game.performance', () => {
  const game = starter(); days(game, 200);
  const before = structuredClone(game); delete before.performance;
  reviewPerformance(game, { loanLimit: 250000 });
  const after = structuredClone(game); delete after.performance;
  assert.deepStrictEqual(after, before);
  assert.equal(game.nextId, before.nextId); assert.equal(game.money, before.money); assert.equal(game.revision, before.revision);
});

test('a route is rated on last year only when its accounts cover the whole year', () => {
  const game = emptyGame(), y = 10;
  game.cities.push({ id: 'city-a', name: 'Ayle', x: 10, y, population: 900, activity: 0, growth: 0, passengers: 400, delivered: 0, supplies: 0, lastServiceDay: null },
    { id: 'city-b', name: 'Bree', x: 40, y, population: 900, activity: 0, growth: 0, passengers: 400, delivered: 0, supplies: 0, lastServiceDay: null });
  assert.equal(buildPath(game, 'road', line(10, 40, y)).ok, true);
  const stops = [10, 40].map(x => build(game, 'bus-stop', x, y).station.id);
  until(game, 100);
  const added = addRoute(game, { name: 'Line', mode: 'road', cargo: 'passengers', stops }).route;
  until(game, yearDay(1951));
  assert.equal(typeof added.profitLastYear, 'number');
  assert.equal(ratingInputs(game).values[0], 0, 'launched in April: 1950 is not a whole year of its accounts');
  until(game, yearDay(1952));
  const rated = ratingInputs(game).values[0];
  assert.equal(rated, added.profitLastYear > 0 ? 1 : 0);
  assert.equal(game.performance.values[0], rated);
  // An edit in April 1952 restarts the accounts, so the route is rated again only on 1953.
  until(game, yearDay(1952) + 100);
  assert.equal(editRoute(game, added.id, { stops: [...added.stops].reverse(), cargo: 'passengers' }).ok, true);
  until(game, yearDay(1953));
  assert.equal(ratingInputs(game).values[0], 0);
  until(game, yearDay(1954));
  assert.equal(ratingInputs(game).values[0], added.profitLastYear > 0 ? 1 : 0);
});

test('the weakest route is named from ten rated vehicles', () => {
  const game = addRoutes(starter(), [90000, -20000, 40000], 4); game.day = 400;
  const performance = reviewPerformance(game);
  assert.equal(performance.weakest, 'rated-1'); assert.equal(performance.values[2], -5000); assert.equal(performance.points[2], 0);
  assert.equal(performance.values[0], 8, 'the two profitable routes run 8 buses');
  const few = addRoutes(starter(), [90000, -20000], 4); few.day = 400;
  const small = reviewPerformance(few);
  assert.equal(small.values[2], null); assert.equal(small.weakest, null);
});

test('titles are kept once earned; a review stamps only the titles it adds', () => {
  const game = starter(); days(game, 100);
  game.performance = { ...structuredClone(game.performance), reached: [0, 10, 20, 30, 40], best: 610 };
  const low = reviewPerformance(game);
  assert.ok(low.score < 120); assert.deepEqual(low.reached, [0, 10, 20, 30, 40]); assert.equal(low.best, 610); assert.equal(careerTitle(game), 4);
  // A company that earned Traffic manager, fell to about 100 and now scores in the 240s gains one title, today.
  const climb = starter(); days(climb, 100);
  climb.performance = { ...structuredClone(climb.performance), reached: [0, 30], score: 100, best: 130 };
  climb.history = Array.from({ length: 12 }, (_, month) => ({ ...climb.history[0], month, delivered: 10000 * (month + 1), operatingProfit: 1000 }));
  const day = Math.floor(climb.day), review = reviewPerformance(climb, { loanLimit: 250000 });
  assert.ok(review.score >= 240 && review.score < 360, `score ${review.score}`);
  assert.deepEqual(review.reached, [0, 30, day]);
});

test('the century is stamped once, when December 2049 closes', () => {
  const game = starter(); game.day = 36524.5; game.lastMonth = calendarMonth(game); game.lastDailyDay = 36524;
  tick(game, .5);
  const { century } = game.performance;
  assert.deepEqual(century, { day: 36525, score: game.performance.score, title: game.performance.reached.length - 1, value: companyValue(game).total });
  days(game, 100);
  assert.ok(game.performance.day > 36525); assert.deepEqual(game.performance.century, century);
  assert.equal(validateGame(game), true);
});

test('saves validate the rating and reject malformed ones', () => {
  const legacy = starter(); assert.equal(validateGame(legacy), true);
  const game = starter(); days(game, 400); game.performance.century = { day: 365, score: game.performance.score, title: 0, value: 12345 };
  assert.equal(validateGame(game), true); assert.equal(validPerformance(game), true);
  assert.equal(game.annual.at(-1).performance, game.performance.score, 'the year summary keeps the December review');
  const breaks = {
    'score 1001': p => { p.score = 1001; }, 'a 1.5 day': p => { p.day = 1.5; }, 'a future day': p => { p.day = Math.floor(game.day) + 1; },
    'best under score': p => { p.best = p.score - 1; }, '8 values': p => { p.values.pop(); }, 'NaN value': p => { p.values[3] = NaN; },
    'points not summing': p => { p.points[5] += 1; }, 'empty reached': p => { p.reached = []; }, 'decreasing reached': p => { p.reached = [5, 4]; },
    'century title beyond reached': p => { p.century.title = p.reached.length; }, 'numeric weakest': p => { p.weakest = 5; },
    'null values other than weakest': p => { p.values[0] = null; }, 'a long weakest': p => { p.weakest = 'r'.repeat(101); },
  };
  for (const [name, change] of Object.entries(breaks)) { const copy = structuredClone(game); change(copy.performance); assert.equal(validateGame(copy), false, name); }
  const annual = structuredClone(game); annual.annual.at(-1).performance = 1001; assert.equal(validateGame(annual), false, 'annual performance 1001');
  const fraction = structuredClone(game); fraction.annual.at(-1).performance = 1.5; assert.equal(validateGame(fraction), false, 'annual performance 1.5');
});

test('a save keeps the rating exactly', () => {
  const game = starter(); days(game, 400);
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.deepStrictEqual(restored.performance, game.performance);
  assert.deepStrictEqual(restored.annual, game.annual);
});

test('an older save is reviewed silently on load', () => {
  const game = starter(); days(game, 730);
  const legacy = structuredClone(game); delete legacy.performance; for (const entry of legacy.annual) delete entry.performance;
  const notices = legacy.notifications.length, nextId = legacy.nextId;
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(legacy))));
  assert.ok(restored.performance);
  assert.ok(restored.performance.reached.every(day => day === Math.floor(restored.day)));
  assert.equal(restored.performance.century, undefined);
  assert.equal(restored.notifications.length, notices); assert.equal(restored.nextId, nextId);
  const young = starter(); days(young, 70); assert.equal(young.history.length, 2);
  assert.equal(restoreGame(JSON.parse(JSON.stringify(encodeGame(young)))).performance, undefined);
  // A save already past 2050 gets no century from the backfill.
  const late = structuredClone(game); delete late.performance; late.day = 36600; late.lastDailyDay = 36600;
  late.history = late.history.map((h, i) => ({ ...h, month: 1180 + i })); delete late.annual;
  assert.equal(restoreGame(JSON.parse(JSON.stringify(encodeGame(late)))).performance.century, undefined);
});

test('company value adds cash, vehicle resale and half of today\'s infrastructure, less the loan', () => {
  const game = emptyGame(); game.day = 3000;
  assert.equal(buildPath(game, 'road', line(10, 19, 10)).ok, true);
  for (const x of [10, 19]) assert.equal(build(game, 'bus-stop', x, 10).ok, true);
  const paid = 23456; game.vehicles.push({ id: 'truck', routeId: 'none', paidPrice: paid }); game.loan = 50000;
  const value = companyValue(game);
  assert.equal(value.infrastructure, Math.round(priceFor(game, 10 * BUILD_COSTS.road + 2 * BUILD_COSTS['bus-stop']) * .5));
  assert.equal(value.vehicles, Math.round(paid * .45)); assert.equal(value.cash, Math.round(game.money)); assert.equal(value.loan, 50000);
  assert.equal(value.total, value.cash - value.loan + value.vehicles + value.infrastructure);
});

test('company value counts property at resale: placed buildings at their sale price, plots at half their zoning', () => {
  const { game, A } = twoTownFixture(); game.day = 3000;
  assert.equal(build(game, 'house-cheap-1', A.x + 4, A.y + 7).ok, true);
  for (const [dx, dy] of [[7, -2], [7, 1], [-2, 7], [1, 7]]) {
    const x = A.x + dx, y = A.y + dy;
    assert.equal(build(game, 'residential', x, y).ok, true);
    assert.ok(placeBuildingSite(game, 'house-normal-1', x, y, { size: 1, building: { kind: 'house-normal-1', level: 2, populationCityId: A.id }, allowZone: true }));
  }
  game.revision++;
  const without = companyValue(emptyGame()).property, value = companyValue(game);
  assert.equal(without, 0);
  assert.equal(value.property, Math.round(.6 * priceFor(game, 1400) + .5 * 4 * priceFor(game, BUILD_COSTS.residential)));
  assert.equal(value.total, value.cash - value.loan + value.vehicles + value.infrastructure + value.property);
});

test('a review of 2,000 routes and 10,000 vehicles stays quick', () => {
  const game = addRoutes(starter(), Array.from({ length: 2000 }, (_, n) => (n % 7) * 1000 - 2000), 5), month = { income: 0, expenses: 0, profit: 0, money: 0, population: 0, day: 0 };
  for (let n = 0; n < 36; n++) game.history.push({ ...month, month: n, delivered: n * 100 });
  game.day = 1100;
  reviewPerformance(game);
  const start = performance.now(); reviewPerformance(game); const elapsed = performance.now() - start;
  assert.ok(elapsed < 20, `${elapsed.toFixed(1)} ms`);
});

test('an untouched starter company stays Engineer for three years', () => {
  const game = starter(); days(game, 3 * 365);
  assert.ok(game.performance.best < 120, `best ${game.performance.best}`);
  assert.equal(careerTitle(game), 0);
});

test('only the rating, the review hook and the interface read game.performance', () => {
  const dir = new URL('../', import.meta.url);
  const readers = readdirSync(dir).filter(name => name.endsWith('.js') && /game\.performance\b/.test(readFileSync(new URL(name, dir), 'utf8'))).sort();
  assert.deepEqual(readers, ['app.js', 'company-rating.js', 'model.js']);
});
