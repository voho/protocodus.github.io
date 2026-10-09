import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build, buildPath, addRoute, tick, createGame, restoreGame, validateGame } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { MILESTONES, CHAPTERS, evaluateMilestones, nextMilestone, milestoneChapters, metMilestones, progressText, milestoneReward } from '../milestones.js';
import { priceFor } from '../economy-pricing.js';
import { nextProject } from '../gameplay-insights.js';
import { emptyGame, line, equivalent, completeFixtureConstruction } from './helpers.mjs';

const ok = result => assert.equal(result.ok, true, result.message);
// A flat town with a stone quarry beside it: the first freight route of a new company.
function quarryCompany() {
  const game = emptyGame();
  game.cities = [{ id: 'town', name: 'Town', x: 40, y: 41, population: 400, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null }];
  ok(build(game, 'quarry', 10, 40));
  completeFixtureConstruction(game, game.industries[0]);
  ok(buildPath(game, 'road', line(16, 37, 41)));ok(build(game, 'bus-stop', 16, 41));ok(build(game, 'bus-stop', 37, 41));
  ok(addRoute(game, { mode: 'road', stops: game.stations.map(stop => stop.id), cargo: 'stone' }));
  return game;
}
const days = (game, count, until = () => false) => { for (let n = 0; n < count && !until(); n++) tick(game, 1); };
const stamped = game => Object.keys(game.milestones || {});

test('chapter 1 is stamped in order, each on the day it was first met', () => {
  const game = quarryCompany(), stoneRoute = game.routes[0];
  // A farm and a food plant wait beside the town, linked before the town grows around the road.
  ok(build(game, 'farm', 10, 64));ok(build(game, 'food-plant', 40, 70));
  completeFixtureConstruction(game, ...game.industries.slice(-2));
  ok(buildPath(game, 'road', line(16, 37, 71)));ok(build(game, 'bus-stop', 16, 71));ok(build(game, 'bus-stop', 37, 71));
  ok(buildPath(game, 'road', Array.from({ length: 29 }, (_, i) => ({ x: 37, y: 42 + i }))));
  const [farmStop, plantStop] = game.stations.slice(-2);
  days(game, 1);
  assert.deepEqual(game.milestones, {}, 'a new company starts with no milestones');
  let firstDay = null;
  for (let n = 0; n < 120 && firstDay === null; n++) { tick(game, 1); if (stoneRoute.delivered > 0) firstDay = game.day; }
  assert.ok(firstDay, 'stone reaches the town');
  assert.deepEqual(stamped(game), ['first-freight']);
  assert.equal(game.milestones['first-freight'], firstDay, 'stamped on the day of the first delivery');
  days(game, 500, () => stoneRoute.delivered >= 100);
  const hundred = game.day;
  assert.ok(stoneRoute.delivered >= 100);assert.equal(game.milestones['freight-100'], hundred);
  assert.equal(game.milestones['town-supply'], undefined, 'stone is not a town supply');
  // Grain to the food plant, then its food to the town.
  ok(addRoute(game, { mode: 'road', stops: [farmStop.id, plantStop.id], cargo: 'grain' }));
  const plant = game.industries.find(site => site.kind === 'food-plant');
  days(game, 300, () => game.milestones.processing !== undefined);
  assert.ok(plant.received > 0 && plant.totalProduced > 0);assert.ok(game.milestones.processing > hundred);
  ok(addRoute(game, { mode: 'road', stops: [plantStop.id, game.stations[1].id], cargo: 'food' }));
  days(game, 300, () => game.milestones['town-supply'] !== undefined);
  assert.deepEqual(stamped(game), ['first-freight', 'freight-100', 'processing', 'town-supply']);
  assert.ok(game.milestones['town-supply'] > game.milestones.processing);
  assert.equal(validateGame(game), true);
  const chapter = milestoneChapters(game)[0];
  assert.equal(chapter.done, 4);assert.equal(chapter.complete, true);
});

test('passenger fares never complete a freight milestone', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  game.totalDelivered = 10000;game.routes[0].delivered = 10000;
  days(game, 3);
  assert.equal(game.milestones['first-freight'], undefined);assert.equal(game.milestones['freight-100'], undefined);assert.equal(game.milestones['freight-10k'], undefined);
  assert.equal(nextProject(game).title, 'Your first cargo route');
  assert.equal(MILESTONES.find(m => m.id === 'freight-100').progress(game).value, 0);
});

test('a legacy save gains its milestones silently on the first evaluation', () => {
  const game = quarryCompany();
  days(game, 500, () => game.routes[0].delivered >= 100);
  delete game.milestones;
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(restored);assert.equal(restored.milestones, undefined);
  const nextId = restored.nextId, notices = JSON.stringify(restored.notifications), money = restored.money;
  evaluateMilestones(restored);
  assert.deepEqual(restored.milestones, { 'first-freight': Math.floor(restored.day), 'freight-100': Math.floor(restored.day) });
  assert.equal(restored.nextId, nextId, 'no notice ids are spent');assert.equal(JSON.stringify(restored.notifications), notices);assert.equal(restored.money, money, 'a quiet credit pays no rewards');
  const again = restoreGame(JSON.parse(JSON.stringify(encodeGame(restored))));
  assert.deepEqual(again.milestones, restored.milestones, 'stamps survive a save');
});

test('each goal pays its reward once, at the prices of its day, and never as a fare', () => {
  const game = quarryCompany();
  assert.ok(MILESTONES.every(m => Number.isInteger(m.reward) && m.reward > 0), 'every goal names its reward');
  days(game, 120, () => game.milestones['first-freight'] !== undefined);
  const first = MILESTONES.find(m => m.id === 'first-freight'), day = game.milestones['first-freight'];
  assert.equal(milestoneReward(game, first, day), priceFor(game, first.reward, day));
  assert.equal(game.totalRewards, milestoneReward(game, first, day));
  days(game, 500, () => game.milestones['freight-100'] !== undefined);days(game, 40);
  const paid = Object.entries(game.milestones).reduce((sum, [id, stamp]) => sum + milestoneReward(game, MILESTONES.find(m => m.id === id), stamp), 0);
  assert.equal(game.totalRewards, paid, 'one payment per stamp');
  const months = game.history.filter(h => h.rewards > 0);
  assert.equal(months.reduce((sum, h) => sum + h.rewards, 0) + (game.monthlyRewards || 0), paid);
  for (const h of months) assert.equal(h.operatingProfit, h.income - h.operatingExpenses, 'operating profit leaves rewards out');
  assert.equal(validateGame(game), true);
  assert.equal(validateGame({ ...game, totalRewards: -1 }), false);
});

test('validation accepts only past whole days under short ids', () => {
  const game = quarryCompany();days(game, 3);
  const day = Math.floor(game.day), check = milestones => { const copy = { ...game, milestones }; return validateGame(copy); };
  assert.equal(check(undefined), true);assert.equal(check({}), true);assert.equal(check({ 'first-freight': day, retired: 0 }), true, 'unknown ids are ignored');
  assert.equal(check({ 'first-freight': day + 1 }), false, 'a future day');
  assert.equal(check({ 'first-freight': 1.5 }), false, 'a fractional day');
  assert.equal(check({ 'first-freight': -1 }), false);assert.equal(check({ 'first-freight': '2' }), false);
  assert.equal(check([]), false);assert.equal(check(null), false);assert.equal(check('first-freight'), false);
  assert.equal(check({ ['x'.repeat(41)]: 0 }), false, 'ids stay short');
  assert.equal(check(Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['m' + i, 0]))), false, 'at most 64 ids');
  const city = game.cities[0];city.founded = 'yes';assert.equal(validateGame(game), false);city.founded = true;assert.equal(validateGame(game), true);
});

test('a founded town is flagged, and counts once it is served', () => {
  const game = quarryCompany();
  ok(build(game, 'city', 90, 20));
  const founded = game.cities.at(-1);
  assert.equal(founded.founded, true);assert.equal(game.cities[0].founded, undefined, 'generated towns carry no flag');
  const town = MILESTONES.find(m => m.id === 'found-town');
  assert.equal(town.progress(game).value, 0);
  founded.lastServiceDay = Math.floor(game.day);
  assert.equal(town.progress(game).value, 1);
});

test('only a town the company serves counts toward 2,000 residents', () => {
  const game = quarryCompany(), town = MILESTONES.find(m => m.id === 'town-2000');
  game.cities.push({ id: 'far', name: 'Far', x: 100, y: 80, population: 2500, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null });
  assert.deepEqual(town.progress(game), { value: 400, target: 2000 }, 'a large town nobody serves is ignored');
  assert.equal(metMilestones(game).includes('town-2000'), false);
  game.cities[0].population = 2100;
  assert.equal(town.target(game), 'town');assert.equal(metMilestones(game).includes('town-2000'), true);
});

test('evaluation stays well under a millisecond a day on the dense fleet fixture', () => {
  const game = createGame({ size: 'regional', seed: 98361 }), template = game.vehicles[0];
  for (let i = 1; i < 256; i++) game.vehicles.push({ ...template, id: `dense-bus-${i}`, load: 0, progress: i % 24, x: game.routes[0].path[i % 24].x, y: game.routes[0].path[i % 24].y });
  tick(game, 20);
  for (let n = 0; n < 20; n++) { delete game.milestones; evaluateMilestones(game); }
  const runs = 200, start = performance.now();
  for (let n = 0; n < runs; n++) { delete game.milestones; evaluateMilestones(game); }
  const each = (performance.now() - start) / runs;
  assert.ok(each < 1, `${each.toFixed(3)} ms per evaluation`);
});

test('fractional frames stamp the same days as whole ticks', () => {
  const whole = quarryCompany(), frames = structuredClone(whole);
  tick(whole, 60);
  for (let n = 0; n < 240; n++) tick(frames, .25);
  assert.ok(whole.milestones['first-freight'] > 0);
  equivalent(frames, whole);
});

test('chapters open in turn when all but one goal is met, and the card offers the rest of the open chapter', () => {
  const game = quarryCompany();
  game.milestones = { 'first-freight': 0, 'freight-100': 0 };
  let next = nextMilestone(game);
  assert.equal(next.chapter, 1);assert.equal(next.milestone.id, 'processing');assert.deepEqual(next.choices, ['processing', 'town-supply']);
  assert.equal(nextMilestone(game, 'town-supply').milestone.id, 'town-supply', 'another idea stays chosen');
  assert.equal(nextMilestone(game, 'towns-5').milestone.id, 'processing', 'a choice outside the open chapter is ignored');
  game.milestones['town-supply'] = 0;
  next = nextMilestone(game);
  assert.equal(next.chapter, 2, 'one open goal never blocks the next chapter');assert.equal(next.milestone.id, 'towns-5');
  // Later chapters count early progress too: a ship route met out of order is already done.
  game.milestones['first-ship'] = 0;
  assert.equal(nextMilestone(game).choices.includes('first-ship'), false);
  for (const milestone of MILESTONES) game.milestones[milestone.id] = 0;
  assert.equal(nextMilestone(game), null);
  assert.equal(milestoneChapters(game).length, CHAPTERS.length);
});

test('after the first-route stages the goal card follows the milestone ladder', () => {
  const game = emptyGame();
  game.cities = [{ id: 'home', name: 'Home', x: 15, y: 12, population: 400, lastServiceDay: null }];
  game.routes = [{ id: 'r1', cargo: 'timber', delivered: 150, stops: [] }, { id: 'r2', cargo: 'lumber', delivered: 5, stops: [] }];game.zones = [{ x: 1, y: 1, kind: 'residential', progress: 1 }];
  game.milestones = { 'first-freight': 0, 'freight-100': 0, processing: 0 };
  let project = nextProject(game);
  assert.equal(project.milestone, 'towns-5');assert.equal(project.chapter, 2);assert.deepEqual(project.progress, { value: 0, max: 5 });
  assert.match(project.detail, /0 of 5 served/);assert.equal(project.choices.length, 5);assert.equal(project.choice, 0);
  project = nextProject(game, { source: 'rail-30' });
  assert.equal(project.title, 'A 30-tile railway');assert.equal(project.action, 'connect');assert.equal(project.tool, 'rail');
  for (const milestone of MILESTONES) game.milestones[milestone.id] = 0;
  assert.equal(nextProject(game).title, 'Build your own story');
});

test('progress reads as counts, money and percentages', () => {
  const find = id => MILESTONES.find(m => m.id === id);
  assert.equal(progressText(find('freight-100'), { value: 37, target: 100 }), '37 of 100 delivered');
  assert.equal(progressText(find('profit-25k'), { value: 12300, target: 25640 }), '$12,300 of $25,640');
  assert.equal(progressText(find('industry-200'), { value: 140, target: 200 }), '140% of 200%');
  assert.equal(progressText(find('first-ship'), { value: 0, target: 1 }), '');
  assert.ok(MILESTONES.every(m => /^[A-Z0-9$]/.test(m.title) && !/you must/i.test(m.title) && m.title === m.title[0] + m.title.slice(1).replace(/[A-Z]{2,}/g, '')), 'sentence-case noun phrases');
  assert.equal(new Set(MILESTONES.map(m => m.id)).size, MILESTONES.length);assert.ok(MILESTONES.every(m => m.id.length <= 40));
});

test('nothing but the ladder and its display reads the stamps; tick() pays what evaluateMilestones returns', async () => {
  const folder = new URL('../', import.meta.url), readers = [];
  for (const name of (await readdir(folder)).filter(name => name.endsWith('.js'))) if (/\.milestones\b|\[['"]milestones['"]\]/.test(await readFile(new URL(name, folder), 'utf8'))) readers.push(name);
  assert.deepEqual(readers.sort(), ['app.js', 'milestones.js']);
});
