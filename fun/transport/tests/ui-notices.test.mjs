import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, build, buildPath, refreshRouteConnections, tick, validateGame, createGame } from '../model.js';
import { stepIndustries } from '../industry-simulation.js';
import { collectNotices, groupNotices, crossedMilestone, newYearNotice, toastType } from '../ui-notices.js';
import { creditToast } from '../ui-notices.js';
import { emptyGame, line } from './helpers.mjs';

const notices = count => Array.from({ length: count }, (_, index) => ({ id: `notice-${200 - index}`, day: 10, message: `Notice ${200 - index}`, text: `Notice ${200 - index}`, type: 'info' }));

function sharedRoad() {
  const game = emptyGame();
  game.cities.push({ id: 'city-a', name: 'Aville', x: 10, y: 20, population: 800, activity: 20, growth: 0, passengers: 100, delivered: 0, supplies: 0, lastServiceDay: null });
  game.cities.push({ id: 'city-b', name: 'Btown', x: 40, y: 20, population: 800, activity: 20, growth: 0, passengers: 100, delivered: 0, supplies: 0, lastServiceDay: null });
  assert.equal(buildPath(game, 'road', line(8, 42, 20)).ok, true);
  for (const x of [9, 10, 11, 39, 40, 41]) assert.equal(build(game, 'bus-stop', x, 20).ok, true);
  for (let i = 0; i < 3; i++) assert.equal(addRoute(game, { name: 'Line ' + (i + 1), mode: 'road', stops: [game.stations[i].id, game.stations[i + 3].id], cargo: 'passengers' }).ok, true);
  tick(game, 1);
  return game;
}

test('unseen notices are collected oldest first up to the last one shown', () => {
  const list = notices(5);
  assert.deepEqual(collectNotices(list, 'notice-197').map(n => n.id), ['notice-198', 'notice-199', 'notice-200']);
  assert.deepEqual(collectNotices(list, 'notice-200'), []);
  assert.deepEqual(collectNotices([], undefined), []);
});

test('without a known last notice only the newest six are collected', () => {
  assert.deepEqual(collectNotices(notices(10), undefined).map(n => n.id), ['notice-195', 'notice-196', 'notice-197', 'notice-198', 'notice-199', 'notice-200']);
  assert.deepEqual(collectNotices(notices(10), 'notice-1').length, 6, 'a notice that rolled out of the log counts as absent');
  const welcome = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  assert.match(collectNotices(welcome.notifications, undefined)[0].message, /^Welcome/);
});

test('a burst of unseen notices is capped at the 24 stored entries', () => {
  const list = notices(30);
  assert.equal(collectNotices(list, 'notice-171').length, 24);
  assert.equal(collectNotices(list, 'notice-171', 8).length, 8);
  assert.equal(collectNotices(list, 'notice-171').at(-1).id, 'notice-200');
});

test('one bulldozed tile shared by three routes yields three topical notices and one grouped toast', () => {
  const game = sharedRoad(), last = game.notifications[0]?.id, nextId = game.nextId;
  assert.equal(build(game, 'bulldoze', 25, 20).ok, true);
  refreshRouteConnections(game);
  const fresh = collectNotices(game.notifications, last);
  assert.equal(fresh.length, 3);
  assert.equal(game.nextId, nextId + 3, 'each disconnect consumes exactly one notice id');
  assert.deepEqual(fresh.map(n => n.topic), ['route-connection', 'route-connection', 'route-connection']);
  assert.deepEqual(fresh.map(n => n.target), game.routes.map(route => ({ kind: 'route', id: route.id })));
  const grouped = groupNotices(fresh);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].message, '3 routes are no longer connected: Line 1, Line 2 and Line 3.');
  assert.equal(grouped[0].template, `3 routes are no longer connected: ${game.routes.slice(0, 2).map(route => `{route:${route.id}}`).join(', ')} and {route:${game.routes[2].id}}.`, 'the burst names each route as a reference');
  assert.equal(grouped[0].type, 'warning');
  assert.equal(grouped[0].count, 3);
  assert.deepEqual(grouped[0].targets.map(target => target.id), game.routes.map(route => route.id));
  assert.equal(validateGame(game), true);
});

test('a demolished buyer shared by two routes yields one grouped supply warning', () => {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 10).ok, true);
  assert.equal(build(game, 'sawmill', 30, 10).ok, true);
  assert.equal(buildPath(game, 'road', line(10, 30, 12)).ok, true);
  for (const x of [10, 30]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  for (const name of ['Timber one', 'Timber two']) assert.equal(addRoute(game, { name, mode: 'road', stops: game.stations.map(stop => stop.id), cargo: 'timber' }).ok, true);
  const last = game.notifications[0]?.id;
  assert.equal(build(game, 'bulldoze', 30, 10).ok, true);
  const fresh = collectNotices(game.notifications, last), grouped = groupNotices(fresh);
  assert.deepEqual(fresh.map(n => n.topic), ['route-supply', 'route-supply']);
  assert.deepEqual(grouped.map(entry => [entry.message, entry.type, entry.count]), [['2 routes lost a supplier or buyer: Timber one and Timber two.', 'warning', 2]]);
  assert.equal(grouped[0].template, `2 routes lost a supplier or buyer: {route:${game.routes[0].id}} and {route:${game.routes[1].id}}.`);
  assert.deepEqual(grouped[0].targets, game.routes.map(route => ({ kind: 'route', id: route.id })));
  assert.equal(validateGame(game), true);
});

test('legacy notices without a topic group by their wording and keep their order', () => {
  const legacy = [
    { id: 'notice-1', day: 3, message: 'Harbor Line has lost its water connection. Ports need a continuous waterway.', text: '', type: 'warning' },
    { id: 'notice-2', day: 3, message: 'Birchfield founded. Add housing and connect a passenger service.', text: '', type: 'success', target: { kind: 'city', id: 'city-9' } },
    { id: 'notice-3', day: 3, message: 'Iron mine expanded to 150% capacity.', text: '', type: 'success' },
    { id: 'notice-4', day: 3, message: 'Oak Line has lost its connection. Repair the network to resume.', text: '', type: 'warning' },
    { id: 'notice-5', day: 3, message: 'Sawmill expanded to 100% capacity.', text: '', type: 'success' },
  ];
  const grouped = groupNotices(legacy);
  assert.deepEqual(grouped.map(entry => entry.message), ['2 routes are no longer connected: Harbor Line and Oak Line.', 'Birchfield founded. Add housing and connect a passenger service.', '2 industries expanded: Iron mine and Sawmill.']);
  assert.deepEqual(grouped.map(entry => entry.template), [undefined, undefined, undefined], 'notices saved before templates stay plain');
  assert.deepEqual(grouped.map(entry => entry.topic), ['route-connection', '', 'industry-growth']);
  assert.deepEqual(grouped[1].targets, [{ kind: 'city', id: 'city-9' }]);
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `n-${i}`, day: 1, message: `Line ${i + 1} has lost its connection. Repair the network to resume.`, text: '', type: 'warning', topic: 'route-connection' }));
  assert.equal(groupNotices(many)[0].message, '5 routes are no longer connected: Line 1, Line 2, Line 3 and 2 more.');
  assert.equal(groupNotices([legacy[0]])[0].message, legacy[0].message, 'a single entry keeps its own message');
});

test('validation accepts notices with and without topic and target, and rejects malformed targets', () => {
  const game = emptyGame(), base = { id: 'notice-900', day: 1, message: 'Hello', text: 'Hello', type: 'info' };
  const valid = extra => { game.notifications = [{ ...base, ...extra }]; return validateGame(game); };
  assert.equal(valid({}), true);
  assert.equal(valid({ topic: 'industry-growth', target: { kind: 'industry', id: 'industry-4' } }), true);
  assert.equal(valid({ target: { kind: 'city', id: 'city-1' } }), true);
  assert.equal(valid({ target: { kind: 'route', id: 'route-1' } }), true);
  assert.equal(valid({ target: { kind: 'route', id: 'route-1' }, template: '{route:route-1} is no longer connected.' }), true);
  assert.equal(valid({ template: 7 }), false);assert.equal(valid({ template: 'x'.repeat(1001) }), false);
  assert.equal(valid({ topic: 'x'.repeat(33) }), false);
  assert.equal(valid({ topic: 7 }), false);
  assert.equal(valid({ target: { kind: 'station', id: 'station-1' } }), false);
  assert.equal(valid({ target: { kind: 'city', id: 12 } }), false);
  assert.equal(valid({ target: { kind: 'city', id: 'c'.repeat(65) } }), false);
  assert.equal(valid({ target: null }), false);
  assert.equal(valid({ target: 'city-1' }), false);
});

test('town founding and industry expansion notices carry their site', () => {
  const game = emptyGame();
  const founded = build(game, 'city', 30, 30);
  assert.equal(founded.ok, true);
  assert.deepEqual(game.notifications[0].target, { kind: 'city', id: founded.city.id });
  assert.equal(game.notifications[0].template, `{town:${founded.city.id}} founded. Zone homes nearby and give it a passenger route.`);
  assert.equal(build(game, 'logging-camp', 10, 10).ok, true);
  const camp = game.industries[0], calls = [];
  Object.assign(camp, { capacity: .98, activity: 400, totalProduced: 10, idleDays: 0, nextReviewDay: 0 });
  stepIndustries(game, (_, message, type, extra) => calls.push({ message, type, extra }));
  assert.ok(camp.capacity >= 1, 'the review expands the busy camp');
  assert.deepEqual(calls.map(call => call.extra), [{ topic: 'industry-growth', target: { kind: 'industry', id: camp.id }, template: `{industry:${camp.id}} expanded to ${Math.round(camp.capacity * 100)}% capacity.` }]);
  assert.equal(validateGame(game), true);
});

test('HUD moments: town thresholds, new-year text and toast styles', () => {
  assert.equal(crossedMilestone(980, 1004), 1000);
  assert.equal(crossedMilestone(1004, 1200), 0);
  assert.equal(crossedMilestone(900, 2600), 2500);
  assert.equal(crossedMilestone(9990, 12000), 10000);
  assert.equal(newYearNotice(1951, .023), 'New for 1951: vehicles carry 20% more and run 10% faster. Prices rise 2.3% this year.');
  assert.deepEqual(['success', 'info', 'warning', 'error', 'milestone', 'report'].map(toastType), ['ok', 'ok', 'warning', 'error', 'milestone', 'ok']);
});

test('in a headline year the January notice keeps only the price rise', () => {
  assert.equal(newYearNotice(1955, .023, { generation: false }), 'Prices rise 2.3% in 1955.');
  assert.equal(newYearNotice(1951, .023, { generation: true }), newYearNotice(1951, .023));
  assert.equal(newYearNotice(1951, .023), 'New for 1951: vehicles carry 20% more and run 10% faster. Prices rise 2.3% this year.');
});

test('a below-zero balance toasts when it begins and each January, while News keeps every month', () => {
  const history = [[31, 0, 5000], [59, 1, -200], [90, 2, -900], [334, 10, -50], [365, 11, -80], [396, 12, -10]].map(([day, month, money]) => ({ day, month, money }));
  const credit = day => ({ day, topic: 'credit' });
  assert.equal(creditToast(credit(59), history), true, 'the first month below zero');
  assert.equal(creditToast(credit(90), history), false, 'the streak continues quietly');
  assert.equal(creditToast(credit(365), history), true, 'January reminds once a year');
  assert.equal(creditToast(credit(396), history), false);
  assert.equal(creditToast(credit(31), history), true, 'no earlier month to compare');
  assert.equal(creditToast(credit(7), history), true, 'a notice outside the history still shows');
});

test('industry openings group into one sentence and keep every site', () => {
  const opening = (n, name, town) => ({ id: `notice-${n}`, day: 800, message: `New ${name} opens near ${town}.`, text: '', type: 'success', topic: 'industry-opening', target: { kind: 'industry', id: `industry-${n}` }, template: `New {industry:industry-${n}} opens near {town:city-${n}}.` });
  const list = [opening(301, 'coal mine', 'Pinehaven'), opening(302, 'grain farm', 'Alderbrook'), opening(303, 'oil well', 'Pinehaven')];
  const [grouped] = groupNotices(list);
  assert.equal(grouped.message, '3 new industries opened: coal mine, grain farm and oil well.');
  assert.equal(grouped.template, '3 new industries opened: {industry:industry-301}, {industry:industry-302} and {industry:industry-303}.');
  assert.deepEqual(grouped.targets, list.map(notice => notice.target));
  assert.equal(toastType(grouped.type), 'ok', 'openings toast quietly');
  assert.equal(groupNotices([list[0]])[0].message, 'New coal mine opens near Pinehaven.');
});
