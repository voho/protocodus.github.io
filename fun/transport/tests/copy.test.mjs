import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { money, perMonth, count, listJoin, tiles, cargoAmount, cargoName, dateShort, dateLong, modelYear, vehicleNoun, stopKind, token, plain, namesIn } from '../copy.js';
import { build, buildPath, addRoute, removeRoute, addRouteVehicle, sellRouteVehicle, renameRoute, borrow, repay, tick, refreshRouteConnections, vehicleNoun as modelNoun } from '../model.js';
import { routeHealth, industryStatus, townService } from '../gameplay-insights.js';
import { strings } from './ui-lint.test.mjs';
import { emptyGame, line, advance } from './helpers.mjs';

const MINUS = '−';

test('money uses a true minus, whole dollars and compact thresholds', () => {
  assert.equal(money(372875), '$372,875');assert.equal(money(372874.6), '$372,875');assert.equal(money(0), '$0');
  assert.equal(money(-154), `${MINUS}$154`);assert.ok(!money(-154).includes('-'), 'never a hyphen-minus');
  assert.equal(money(-0.4), '$0', 'a rounded zero has no sign');assert.equal(money(NaN), '$0');
  assert.equal(money(982, { signed: true }), '+$982');assert.equal(money(-154, { signed: true }), `${MINUS}$154`);assert.equal(money(0, { signed: true }), '$0');
  for (const [value, text] of [[999, '$999'], [1000, '$1k'], [1500, '$1.5k'], [18000, '$18k'], [372875, '$372.9k'], [999949, '$999.9k'], [999950, '$1M'], [1.2e6, '$1.2M'], [2.5e9, '$2.5B'], [-18000, `${MINUS}$18k`]]) assert.equal(money(value, { compact: true }), text, String(value));
  assert.equal(money(18000, { compact: true, signed: true }), '+$18k');
  assert.equal(perMonth(1356), '+$1,356 a month');assert.equal(perMonth(-154), `${MINUS}$154 a month`);assert.equal(perMonth(3040, { compact: true }), '+$3k a month');
});

test('counts, plurals, lists and units', () => {
  assert.equal(count(1, 'truck'), '1 truck');assert.equal(count(2, 'truck'), '2 trucks');assert.equal(count(0, 'route'), '0 routes');
  assert.equal(count(2, 'bus', 'buses'), '2 buses');assert.equal(count(1200, 'tile'), '1,200 tiles');
  assert.equal(tiles(1), '1 tile');assert.equal(tiles(14), '14 tiles');
  assert.equal(listJoin([]), '');assert.equal(listJoin(['A']), 'A');assert.equal(listJoin(['A', 'B']), 'A and B');assert.equal(listJoin(['A', 'B', 'C']), 'A, B and C');
  assert.equal(listJoin(['goods', 'fuel'], 'or'), 'goods or fuel');
  assert.equal(cargoAmount(144, 'stone'), '144 stone');assert.equal(cargoAmount(48, 'passengers'), '48 passengers');assert.equal(cargoAmount(1, 'passengers'), '1 passenger');
  assert.equal(cargoAmount(12, 'mail'), '12 mail');assert.equal(cargoAmount(3.4, 'iron'), '3 iron ore');assert.equal(cargoAmount(1500, 'coal'), '1,500 coal');
  assert.equal(cargoName('passengers'), 'passengers');assert.equal(cargoName('oil'), 'crude oil');
});

test('dates read Jan 1950 in the HUD and 12 Jan 1950 in News and records', () => {
  assert.equal(dateShort(0), 'Jan 1950');assert.equal(dateLong(0), '1 Jan 1950');assert.equal(dateLong(11), '12 Jan 1950');assert.equal(dateLong(11.9), '12 Jan 1950');
  assert.equal(dateShort(243), 'Sep 1950', 'three-letter months in every locale');assert.equal(dateShort(365), 'Jan 1951');assert.equal(dateLong(790), '1 Mar 1952');
  assert.equal(dateLong(1e12), '', 'a day outside the calendar prints nothing');
  assert.equal(modelYear(0), 1950);assert.equal(modelYear(3), 1953);assert.equal(modelYear(undefined), 1950);
});

test('vehicle and stop words cover every mode, mail and air included', () => {
  assert.equal(vehicleNoun('road', 'passengers'), 'bus');assert.equal(vehicleNoun('road', 'passengers', 2), 'buses');
  assert.equal(vehicleNoun('road', 'stone'), 'truck');assert.equal(vehicleNoun('road', 'stone', 0), 'trucks');
  assert.equal(vehicleNoun('rail', 'coal'), 'train');assert.equal(vehicleNoun('water', 'passengers'), 'ship');assert.equal(vehicleNoun('air', 'passengers'), 'plane');
  assert.deepEqual(['road', 'rail', 'water', 'air'].map(mode => vehicleNoun(mode, 'mail')), ['mail truck', 'mail train', 'mail ship', 'mail plane']);
  assert.equal(vehicleNoun('road', 'mail', 3), 'mail trucks');
  assert.deepEqual(['road', 'rail', 'water', 'air'].map(stopKind), ['road stop', 'rail station', 'port', 'airport']);
  for (const mode of ['road', 'rail', 'water']) for (const cargo of ['passengers', 'stone']) assert.equal(modelNoun(mode, cargo), vehicleNoun(mode, cargo), 'the model delegates');
});

test('templates carry tokens, and plain() names them or leaves them empty', () => {
  assert.equal(token('route', 'route-104'), '{route:route-104}');
  const game = { routes: [{ id: 'route-104', name: 'Stone run', mode: 'road', cargo: 'stone' }], stations: [{ id: 'station-2', name: 'Quarry yard' }], cities: [{ id: 'city-3', name: 'Birchmere' }], industries: [{ id: 'industry-9', kind: 'quarry' }], vehicles: [{ id: 'vehicle-7', routeId: 'route-104' }] };
  const names = namesIn(game);
  assert.equal(plain(`${token('route', 'route-104')} lost its buyer near ${token('town', 'city-3')}.`, names), 'Stone run lost its buyer near Birchmere.');
  assert.equal(plain('{industry:industry-9} and {stop:station-2} load {cargo:iron}. {vehicle:vehicle-7} earned {money:-1540} on {date:11}.', names), `Stone quarry and Quarry yard load iron ore. Truck earned ${MINUS}$1,540 on 12 Jan 1950.`);
  assert.equal(plain('{route:gone} and {town:gone}.', names), ' and .', 'unknown ids become empty');
  assert.equal(plain('{cargo:stone} only', undefined), 'stone only', 'cargo names need no game');
  assert.equal(plain('No tokens here.'), 'No tokens here.');
});

// Every DOM-free module by pattern: files that neither touch the DOM nor build markup.
const dir = new URL('../', import.meta.url), read = name => readFileSync(new URL(name, dir), 'utf8');
const DOM = /\bdocument\b|\bwindow\.|innerHTML|addEventListener|querySelector|<(span|div|svg|button|section|small|strong|li|p)[\s>]/;
const BANNED = { city: /\bcit(y|ies)\b/i, service: /servic/i, connection: /connection/i, arrow: /→/, 'middle dot': / · /, units: / units\b/, Gen: /\bGen\b/, 'Latest model': /Latest model/, producer: /producer/i };
// Identifiers are not words: ids, kinds, topics and keys such as 'route-connection', 'service-garage' and 'station:'.
const IDENTIFIER = /^[a-z][\w.:-]*$/;
// A town's services are its amenities (post office, bank, hotel), not routes.
const AMENITIES = new Set(['Services', 'Local services', 'Everyday services, from a letter to a night away.']);
test('DOM-free modules use the glossary in every string', () => {
  const modules = readdirSync(dir).filter(name => name.endsWith('.js') && !DOM.test(read(name))).sort();
  assert.ok(['model.js', 'gameplay-insights.js', 'route-planner.js', 'settlements.js', 'industry-simulation.js', 'ui-notices.js', 'milestones.js', 'contracts.js', 'construction-undo.js', 'copy.js'].every(name => modules.includes(name)), modules.join());
  const found = [];
  for (const name of modules) for (const { text, line } of strings(read(name))) {
    if (IDENTIFIER.test(text) || AMENITIES.has(text)) continue;
    for (const [word, pattern] of Object.entries(BANNED)) if (pattern.test(text)) found.push(`${name}:${line} ${word}: ${JSON.stringify(text)}`);
  }
  assert.deepEqual(found, []);
});

test('every model notice that names something carries a template and a target', () => {
  for (const name of ['model.js', 'industry-simulation.js']) for (const call of read(name).match(/(?<!function )\bnotify\(game,[^;]*;/g) || []) if (/target:/.test(call)) assert.match(call, /template:/, call);
});

// A short company: every result is a full sentence, and every notice's template reads as its message.
const sentence = (text, label) => { assert.match(text, /^[A-Z0-9$−].*\.$/s, `${label}: ${text}`); for (const [word, pattern] of Object.entries(BANNED)) assert.doesNotMatch(text, pattern, `${label} says ${word}: ${text}`); };
test('model results and notices are full sentences in the glossary', () => {
  const game = emptyGame(), said = (result, label) => { sentence(result.message, label); return result; };
  said(build(game, 'logging-camp', 10, 9), 'industry');said(build(game, 'sawmill', 30, 9), 'second industry');
  said(buildPath(game, 'road', line(10, 30, 12)), 'road');said(build(game, 'bus-stop', 10, 12), 'stop');said(build(game, 'bus-stop', 30, 12), 'stop');
  said(build(game, 'bus-stop', 10, 12), 'a second stop on a stop');said(build(game, 'city', 20, 30), 'town');said(build(game, 'city', 22, 30), 'town too close');
  const stops = game.stations.map(stop => stop.id);
  said(addRoute(game, { mode: 'road', stops, cargo: 'passengers' }), 'passengers without towns');
  const launched = said(addRoute(game, { name: 'Forest supply', mode: 'road', stops, cargo: 'timber' }), 'launch');
  assert.equal(launched.message, 'Route launched: Forest supply. $18,000 spent.');
  const route = launched.route;
  said(addRouteVehicle(game, route.id), 'add');said(sellRouteVehicle(game, route.id), 'sell');said(sellRouteVehicle(game, route.id), 'sell the last');
  said(renameRoute(game, route.id, 'Timber run'), 'rename');said(borrow(game), 'borrow');said(repay(game), 'repay');
  said(build(game, 'bulldoze', 10, 12), 'a stop a route uses');
  assert.equal(build(game, 'bulldoze', 10, 12).message, 'Timber run uses this stop. Retire the route first, then remove the stop.');
  said(build(game, 'bulldoze', 20, 30), 'a town centre');assert.equal(build(game, 'bulldoze', 20, 30).message, 'Town centres can’t be removed.');
  said(build(game, 'bulldoze', 20, 12), 'road');refreshRouteConnections(game);
  said(addRouteVehicle(game, route.id), 'add to a broken route');
  said(addRoute(game, { mode: 'road', stops, cargo: 'timber' }), 'a broken launch');
  assert.equal(addRoute(game, { mode: 'road', stops, cargo: 'timber' }).message, 'These stops aren’t joined by road. Build the missing road, including any bridge or tunnel, then launch again.');
  said(build(game, 'road', 20, 12), 'repair');refreshRouteConnections(game);
  said(build(game, 'bulldoze', 30, 10), 'the buyer');advance(game, 40, tick);
  for (const notice of game.notifications) {
    sentence(notice.message, `notice ${notice.topic}`);
    if (notice.target) { assert.ok(notice.template, notice.message); assert.equal(plain(notice.template, namesIn(game)), notice.message, 'the template reads as the message'); }
  }
  assert.deepEqual(['route-connection', 'route-supply', 'town'].map(topic => game.notifications.some(notice => notice.template && (notice.topic || notice.target.kind === 'city' && 'town') === topic)), [true, true, true]);
  const retired = said(removeRoute(game, route.id), 'retire');assert.match(retired.message, /^Route retired: Timber run\. \$[\d.]+k refunded\.$/);
});

test('statuses share one shape: state, tone, word, reason, and the old label and detail', () => {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 9).ok, true);assert.equal(build(game, 'sawmill', 30, 9).ok, true);assert.equal(build(game, 'city', 40, 30).ok, true);
  assert.equal(buildPath(game, 'road', line(10, 30, 12)).ok, true);assert.equal(build(game, 'bus-stop', 10, 12).ok, true);assert.equal(build(game, 'bus-stop', 30, 12).ok, true);
  const route = addRoute(game, { name: 'Forest supply', mode: 'road', stops: game.stations.map(stop => stop.id), cargo: 'timber' }).route;
  const TONES = ['ok', 'warn', 'error', 'paused', 'info'];
  const check = (status, words, label) => {
    assert.ok(TONES.includes(status.tone), label);assert.ok(words.some(word => word instanceof RegExp ? word.test(status.word) : word === status.word), `${label}: ${status.word}`);
    assert.equal(typeof status.reason, 'string');sentence(status.detail, label);assert.equal(status.detail, plain(status.reason, namesIn(game)));
    if (status.fix) assert.ok(status.fix.action && status.fix.label, label);
  };
  const ROUTE = ['Running', 'Loading', 'Stores full', 'Not connected', 'Stop missing', 'No supplier', 'No buyer', 'No passengers', 'No mail', 'Paused', 'First trip', /^Needs [a-z ]+$/];
  check(routeHealth(game, route), ROUTE, 'a new route');assert.equal(routeHealth(game, route).word, 'First trip');
  assert.equal(routeHealth(game, route).label, routeHealth(game, route).word, 'the old label stays equal to the word');
  game.industries[0].inventory.timber = 900;check(routeHealth(game, route), ROUTE, 'piling up');
  assert.deepEqual([routeHealth(game, route).state, routeHealth(game, route).word, routeHealth(game, route).fix], ['running', 'First trip', undefined], 'spare demand is never a state or a fix');
  route.active = false;check(routeHealth(game, route), ROUTE, 'broken');assert.deepEqual([routeHealth(game, route).word, routeHealth(game, route).tone, routeHealth(game, route).fix.action], ['Not connected', 'error', 'show-gap']);
  const INDUSTRY = ['Producing', 'Storage nearly full', 'Output piling up', 'Idle', /^Needs [a-z ]+$/];
  for (const site of game.industries) check(industryStatus(site, game), INDUSTRY, site.name);
  assert.equal(industryStatus(game.industries[1], game).word, 'Idle', 'a factory nothing has supplied yet is idle, not a fault');
  game.industries[1].received = 10;assert.deepEqual([industryStatus(game.industries[1], game).word, industryStatus(game.industries[1], game).tone], ['Needs timber', 'warn']);
  const TOWN = ['Growing', 'Steady', 'Out of room', /^Needs [a-z ]+$/];
  for (const town of game.cities) check(townService(game, town), TOWN, town.name);
});
