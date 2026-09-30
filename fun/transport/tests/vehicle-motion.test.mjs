import test from 'node:test';
import assert from 'node:assert/strict';
import { shownProgress, tick, build, buildPath, addRoute } from '../model.js';
import { twoTownFixture, advance, emptyGame, line } from './helpers.mjs';

const route = (mode, length) => ({ mode, path: Array.from({ length: length + 1 }, (_, x) => ({ x, y: 0 })) });

test('vehicles leave a stop from rest, brake into the next and keep the steady pace between', () => {
  for (const [mode, ease] of [['road', .8], ['rail', 1.6], ['water', 1.2]]) {
    const r = route(mode, 20), forward = { direction: 1 }, back = { direction: -1 };
    assert.equal(shownProgress(r, forward, 0), 0); assert.equal(shownProgress(r, forward, 20), 20);
    assert.equal(shownProgress(r, back, 20), 20); assert.equal(shownProgress(r, back, 0), 0);
    assert.equal(shownProgress(r, forward, 10), 10, `${mode} cruises at its steady place`);
    assert.equal(shownProgress(r, forward, ease), ease, `${mode} has rejoined its place at the end of the ease`);
    assert.ok(shownProgress(r, forward, .1) < .1 * .3, `${mode} starts from rest`);
    assert.ok(shownProgress(r, forward, 19.9) > 19.9, `${mode} brakes: it is ahead, slowing, just before the stop`);
    let previous = -1;
    for (let p = 0; p <= 20; p += .05) { const shown = shownProgress(r, forward, p); assert.ok(shown >= previous - 1e-12, `${mode} never runs backwards`); previous = shown; }
    for (let p = 0; p <= 20; p += .5) assert.ok(Math.abs(shownProgress(r, back, p) - (20 - shownProgress(r, forward, 20 - p))) < 1e-12, `${mode} eases the same way back`);
  }
  assert.equal(shownProgress(route('air', 30), { direction: 1 }, 3), 3, 'planes keep their own flight model');
  const short = route('rail', 3);
  assert.ok(shownProgress(short, { direction: 1 }, 1) <= 1 && shownProgress(short, { direction: 1 }, 1.5) === 1.5, 'a short route eases over a third of it at most');
});

test('easing moves only where vehicles are drawn: progress and deliveries keep their pace', () => {
  const { game, route } = twoTownFixture({ buses: 2 });
  advance(game, 45, tick);
  for (const vehicle of game.vehicles) {
    const shown = shownProgress(route, vehicle), index = Math.min(Math.floor(shown), route.path.length - 2), f = shown - index, a = route.path[index], b = route.path[index + 1];
    assert.ok(Math.abs(vehicle.x - (a.x + (b.x - a.x) * f)) < 1e-9 && Math.abs(vehicle.y - (a.y + (b.y - a.y) * f)) < 1e-9, 'x and y follow the eased place');
  }
  assert.ok(route.delivered > 0, 'the buses still deliver');
});

// A coal line from (10,20) to (40,20) with a one-row detour over x 24–28, straightened later.
function detourLine() {
  const game = emptyGame();
  assert.ok(build(game, 'coal-mine', 8, 16).ok && build(game, 'steel-mill', 38, 16).ok);
  assert.ok(buildPath(game, 'rail', [...line(10, 24, 20), { x: 24, y: 21 }, ...line(25, 27, 21), { x: 27, y: 20 }, ...line(28, 40, 20)]).ok);
  build(game, 'train-stop', 10, 20); build(game, 'train-stop', 40, 20);
  const added = addRoute(game, { mode: 'rail', stops: game.stations.map(s => s.id), cargo: 'coal' });
  assert.ok(added.ok, added.message);
  return { game, route: added.route, train: game.vehicles[0] };
}

test('a rerouted vehicle steps from its steady-pace place, not from where it is drawn braking', () => {
  const { game, route, train } = detourLine();
  Object.assign(train, { progress: route.path.length - 1.55, direction: 1, dwellRemaining: 0, fullLoadSince: null });
  tick(game, 1e-7);
  const trips = train.tripSerial;
  assert.ok(train.x > 39.6, 'the braking train is drawn ahead of its steady place at x 39.45');
  assert.ok(buildPath(game, 'rail', line(24, 28, 20)).ok);
  tick(game, 1e-7);
  assert.equal(route.path.length, 31, 'the straight line replaces the detour');
  assert.ok(Math.abs(train.progress - 29) < 1e-3, `x 39.45 is nearest the tile at x 39 (progress ${train.progress})`);
  assert.equal(train.tripSerial, trips, 'the train still has a tile to run before it arrives');
});

test('the simulation never reads where a vehicle is drawn', () => {
  const run = scramble => {
    const { game } = detourLine();
    for (let day = 0; day < 40; day++) {
      if (day === 12) assert.ok(buildPath(game, 'rail', line(24, 28, 20)).ok);
      tick(game, .25); tick(game, .25); tick(game, .25); tick(game, .25);
      if (scramble) for (const vehicle of game.vehicles) { vehicle.x = 0; vehicle.y = 0; }
    }
    const [train] = game.vehicles;
    return { money: game.money, progress: train.progress, direction: train.direction, trips: train.tripSerial, load: train.load };
  };
  assert.deepEqual(run(true), run(false));
});
