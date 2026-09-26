import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, build, buildPath, VEHICLE_COSTS } from '../model.js';
import { filterRoutes, validateRoutePlan } from '../route-planner.js';
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
