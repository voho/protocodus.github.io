import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, build, buildPath, VEHICLE_COSTS } from '../model.js';
import { defaultRouteName, filterRoutes, routeCargoList, routeCargoOptions, validateRoutePlan } from '../route-planner.js';
import { emptyGame, line, tileAt } from './helpers.mjs';

function fixture(mode = 'road') {
  const game = emptyGame();
  assert.equal(build(game, 'logging-camp', 10, 10).ok, true);
  assert.equal(build(game, 'sawmill', 30, 10).ok, true);
  assert.equal(buildPath(game, mode, line(10, 30, 12)).ok, true);
  const tool = mode === 'rail' ? 'train-stop' : 'bus-stop';
  assert.equal(build(game, tool, 10, 12).ok, true);
  assert.equal(build(game, tool, 30, 12).ok, true);
  return { game, draft: { mode, cargo: 'timber', from: game.stations[0].id, to: game.stations[1].id } };
}

for (const mode of ['road', 'rail']) {
  test(`${mode} route preview checks complete bridge and tunnel connectivity without launching`, () => {
    const { game, draft } = fixture(mode), money = game.money;
    const water = tileAt(game, 18, 12), mountain = tileAt(game, 22, 12);
    Object.assign(water, { terrain: 'water', bridge: true });
    Object.assign(mountain, { terrain: 'mountain', tunnel: true });
    game.networkRevision++;
    let plan = validateRoutePlan(game, draft);
    assert.equal(plan.valid, true);
    assert.equal(plan.connected, true);
    assert.equal(plan.path.length, 21);
    assert.match(plan.message, /20 tiles/);
    assert.equal(game.money, money);
    assert.equal(game.routes.length, 0);
    assert.equal(game.vehicles.length, 0);
    water.bridge = false; game.networkRevision++;
    plan = validateRoutePlan(game, draft);
    assert.equal(plan.valid, false);
    assert.equal(plan.state, 'disconnected');
    assert.match(plan.message, /No connection/);
    water.bridge = true; mountain.tunnel = false; game.networkRevision++;
    assert.equal(validateRoutePlan(game, draft).connected, false, 'uncovered mountain breaks the network');
    mountain.tunnel = true; game.networkRevision++;
    assert.equal(validateRoutePlan(game, draft).valid, true, 'repair invalidates the cached path result');
  });
}

test('route preview rejects missing, identical and wrong-mode stops, and wrong cargo coverage', () => {
  const { game, draft } = fixture();
  for (const changes of [{ from: '' }, { to: '' }, { to: draft.from }, { mode: 'rail' }, { cargo: 'not-cargo' }]) {
    assert.equal(validateRoutePlan(game, { ...draft, ...changes }).valid, false, JSON.stringify(changes));
  }
  const mismatch = validateRoutePlan(game, { ...draft, cargo: 'coal' });
  assert.equal(mismatch.connected, true, 'physical connection remains visible separately from cargo demand');
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.message, /coal producer and buyer/);
  game.money = VEHICLE_COSTS.road - 1;
  assert.equal(validateRoutePlan(game, draft).valid, false);
  assert.match(validateRoutePlan(game, draft).message, /funds/);
  game.money++;
  assert.equal(validateRoutePlan(game, draft).valid, true);
});

test('preview identifies reverse freight loading and agrees with launch orientation', () => {
  const { game, draft } = fixture();
  const reversed = { ...draft, from: draft.to, to: draft.from };
  const plan = validateRoutePlan(game, reversed);
  assert.equal(plan.valid, true);
  assert.equal(plan.reversed, true);
  assert.match(plan.message, /Loads at end stop/);
  const result = addRoute(game, { ...reversed, stops: [reversed.from, reversed.to] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.route.stops, [draft.from, draft.to]);
});

test('passenger planning requires two different towns and refuses adjacent stops', () => {
  const { game, draft } = fixture();
  const passengers = { ...draft, cargo: 'passengers' };
  game.cities = [{ id: 'town-a', x: 10, y: 10 }];
  assert.equal(validateRoutePlan(game, passengers).valid, false);
  game.cities.push({ id: 'town-b', x: 30, y: 10 });
  assert.equal(validateRoutePlan(game, passengers).valid, true);
  game.stations[1].x = 11; game.networkRevision++;
  const close = validateRoutePlan(game, passengers);
  assert.equal(close.valid, false);
  assert.match(close.message, /too close/);
});

function quarryFixture() {
  const game = emptyGame();
  assert.equal(build(game, 'quarry', 10, 9).ok, true);
  game.cities = [{ id: 'town-a', name: 'Alderbrook', x: 30, y: 10 }];
  assert.equal(buildPath(game, 'road', line(10, 30, 12)).ok, true);
  assert.equal(build(game, 'bus-stop', 10, 12).ok, true);
  assert.equal(build(game, 'bus-stop', 30, 12).ok, true);
  const [quarry, town] = game.stations.map(stop => stop.id);
  return { game, draft: { mode: 'road', cargo: 'passengers', from: quarry, to: town } };
}
const fitting = options => options.filter(option => option.valid).map(option => option.cargo);

test('cargo options follow the chosen stops: a quarry stop and a town stop carry stone only', () => {
  const { game, draft } = quarryFixture();
  const options = routeCargoOptions(game, draft);
  assert.deepEqual(options.map(option => option.cargo).sort(), routeCargoList(game).slice().sort(), 'every biome cargo gets a verdict');
  assert.deepEqual(fitting(options), ['stone']);
  assert.deepEqual(options[0], { cargo: 'stone', valid: true, reversed: false, message: 'Connected · 20 tiles' });
  assert.match(options.find(option => option.cargo === 'passengers').message, /Each stop must serve a different town/);
  const reversed = routeCargoOptions(game, { ...draft, from: draft.to, to: draft.from });
  assert.deepEqual(fitting(reversed), ['stone']);
  assert.equal(reversed[0].reversed, true, 'loading at the end stop is still a fit');
  assert.equal(game.routes.length, 0);
});

test('a town-to-town pair fits passengers only, and cargo options ignore funds', () => {
  const { game, draft } = quarryFixture();
  game.cities.push({ id: 'town-b', name: 'Pinehaven', x: 10, y: 14 });
  const passengers = { ...draft, from: draft.to, to: draft.from };
  game.industries = [];
  assert.deepEqual(fitting(routeCargoOptions(game, passengers)), ['passengers']);
  game.money = 0;
  assert.match(validateRoutePlan(game, passengers).message, /funds/);
  assert.equal(validateRoutePlan(game, passengers).valid, false);
  assert.equal(validateRoutePlan(game, passengers, { ignoreFunds: true }).valid, true);
  assert.deepEqual(fitting(routeCargoOptions(game, passengers)), ['passengers'], 'short funds never hide a fitting cargo');
  const plan = validateRoutePlan(game, passengers, { ignoreFunds: true });
  assert.equal(defaultRouteName(game, plan, 'passengers'), 'Alderbrook · Pinehaven');
});

test('default route names describe the freight flow after reversal', () => {
  const { game, draft } = quarryFixture();
  const forward = validateRoutePlan(game, { ...draft, cargo: 'stone' });
  assert.equal(defaultRouteName(game, forward, 'stone'), 'Stone · Stone quarry → Alderbrook');
  const reversed = validateRoutePlan(game, { ...draft, cargo: 'stone', from: draft.to, to: draft.from });
  assert.equal(reversed.reversed, true);
  assert.equal(defaultRouteName(game, reversed, 'stone'), 'Stone · Stone quarry → Alderbrook');
  const [a, b] = forward.stations;
  assert.equal(defaultRouteName(game, forward, 'coal'), `${a.name} → ${b.name}`.slice(0, 35) + '…', 'stop names are the fallback');
  b.name = 'Alderbrook'; assert.equal(defaultRouteName(game, forward, 'coal'), `${a.name} → Alderbrook`);
  game.cities[0].name = 'Alderbrook-upon-the-Northern-Pines';
  const long = defaultRouteName(game, forward, 'stone');
  assert.ok(long.length <= 36, long);
  assert.equal(long, 'Stone quarry → Alderbrook-upon-the-…');
  assert.equal(defaultRouteName(game, validateRoutePlan(game, { ...draft, to: '' }), 'stone'), '');
});

test('connected stops without a shared cargo name what each end handles', () => {
  const { game, draft } = quarryFixture();
  game.cities = [];
  assert.equal(build(game, 'sawmill', 29, 9).ok, true);
  const options = routeCargoOptions(game, draft);
  assert.deepEqual(fitting(options), []);
  assert.ok(options.length > 0 && options.every(option => option.message === 'No shared cargo · start loads stone; end accepts timber'));
  assert.equal(validateRoutePlan(game, draft).message, 'No shared cargo · start loads stone; end accepts timber');
  game.cities = [{ id: 'town-a', name: 'Alderbrook', x: 30, y: 10 }];
  assert.match(validateRoutePlan(game, { ...draft, cargo: 'coal' }).message, /coal producer and buyer/, 'a single wrong cargo keeps its own advice');
});

test('disconnected stops give no cargo options', () => {
  const { game, draft } = quarryFixture();
  tileAt(game, 20, 12).road = false; game.networkRevision++;
  assert.equal(validateRoutePlan(game, { ...draft, cargo: 'stone' }).state, 'disconnected');
  assert.deepEqual(routeCargoOptions(game, draft), []);
  assert.deepEqual(routeCargoOptions(game, { ...draft, to: '' }), []);
});

test('route search combines stop, route, resource and vehicle terms with independent filters', () => {
  const game = {
    stations: [{ id: 'a', name: 'North Quarry' }, { id: 'b', name: 'Harbor Terminal' }, { id: 'c', name: 'Old Town' }],
    routes: [
      { id: 'one', name: 'Foundry Express', mode: 'rail', cargo: 'coal', active: true, stops: ['a', 'b'] },
      { id: 'two', name: 'Market Supply', mode: 'road', cargo: 'food', active: false, stops: ['b', 'c'] },
      { id: 'three', name: 'Coastal Shuttle', mode: 'road', cargo: 'passengers', active: true, stops: ['a', 'c'] },
    ],
  };
  const ids = filters => filterRoutes(game, filters).map(route => route.id);
  assert.deepEqual(ids({ query: 'NORTH coal' }), ['one']);
  assert.deepEqual(ids({ query: 'harbor' }), ['one', 'two']);
  assert.deepEqual(ids({ query: 'train' }), ['one']);
  assert.deepEqual(ids({ query: 'truck', status: 'disconnected', cargo: 'food', mode: 'road' }), ['two']);
  assert.deepEqual(ids({ query: 'bus', status: 'running' }), ['three']);
  assert.deepEqual(ids({ mode: 'rail', status: 'disconnected' }), []);
  assert.deepEqual(ids({ query: '  ', mode: 'all', cargo: 'all', status: 'all' }), ['one', 'two', 'three']);
  assert.equal(game.routes.length, 3, 'filtering never changes saved routes');
});
