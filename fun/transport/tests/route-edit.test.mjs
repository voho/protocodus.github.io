import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, addRoute, addRouteVehicle, editRoute, upgradeRouteVehicle, tick, validateGame, restoreGame } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { emptyGame, line } from './helpers.mjs';

const town = (id, x, y) => ({ id, name: id, x, y, population: 300, passengers: 100, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null });

// One road east from a quarry and a logging camp, past Stoneford to Millbrook and its sawmill.
// A road stub near Stoneford is not joined to it, and a rail station stands apart.
function networkFixture() {
  const game = emptyGame(); game.cities = [town('Stoneford', 30, 9), town('Millbrook', 75, 9)];
  for (const [kind, x, y] of [['quarry', 9, 7], ['logging-camp', 14, 7], ['sawmill', 76, 13]]) assert.equal(build(game, kind, x, y).ok, true, kind);
  assert.equal(buildPath(game, 'road', line(10, 75, 12)).ok, true);
  assert.equal(buildPath(game, 'road', line(25, 28, 6)).ok, true);
  assert.equal(buildPath(game, 'rail', line(30, 36, 20)).ok, true);
  for (const [tool, x, y] of [['bus-stop', 10, 12], ['bus-stop', 30, 12], ['bus-stop', 75, 12], ['bus-stop', 27, 6], ['train-stop', 30, 20]]) assert.equal(build(game, tool, x, y).ok, true, `${tool} ${x},${y}`);
  const [quarryStop, stoneford, millbrook, island, rail] = game.stations.map(stop => stop.id);
  game.industries[0].inventory.stone = 2000; game.industries[1].inventory.timber = 2000;
  return { game, stops: { quarryStop, stoneford, millbrook, island, rail } };
}
const launch = (game, stops, cargo) => { const launched = addRoute(game, { name: 'Stone run', mode: 'road', stops, cargo }); assert.equal(launched.ok, true, launched.message); return launched.route; };
const fleet = (game, route) => game.vehicles.filter(vehicle => vehicle.routeId === route.id);
const snapshot = game => JSON.stringify({ routes: game.routes, vehicles: game.vehicles, money: game.money, revision: game.revision });

test('editing the end stop keeps every vehicle, its generation and its price, and costs nothing', () => {
  const { game, stops } = networkFixture(), route = launch(game, [stops.quarryStop, stops.stoneford], 'stone');
  assert.equal(addRouteVehicle(game, route.id).ok, true);
  game.day = 365;
  assert.equal(upgradeRouteVehicle(game, route.id).ok, true);
  assert.equal(addRouteVehicle(game, route.id).ok, true);
  tick(game, 2.6);
  const before = fleet(game, route).map(({ id, level, paidPrice, capacity, load, direction }) => ({ id, level, paidPrice, capacity, load, direction }));
  const { money, routes, nextId } = game, delivered = route.delivered;
  route.expenses = 900;
  const edited = editRoute(game, route.id, { stops: [stops.quarryStop, stops.millbrook], cargo: 'stone' });
  assert.equal(edited.ok, true, edited.message);
  assert.equal(edited.message, 'Route updated: Stone run now runs from Stone quarry Stop 1 to Millbrook Stop 3.');
  assert.equal(edited.route, route);
  assert.equal(game.money, money, 'an edit buys and sells nothing');
  assert.equal(game.nextId, nextId);
  assert.deepEqual(fleet(game, route).map(({ id, level, paidPrice, capacity, load, direction }) => ({ id, level, paidPrice, capacity, load, direction })), before, 'the same vehicles keep their loads');
  assert.ok(before.every(vehicle => vehicle.level === 1), 'upgraded and newer vehicles keep their generation');
  assert.deepEqual(route.stops, [stops.quarryStop, stops.millbrook]);
  const ends = [route.path[0], route.path.at(-1)], stations = route.stops.map(id => game.stations.find(stop => stop.id === id));
  assert.deepEqual(ends.map(({ x, y }) => ({ x, y })), stations.map(({ x, y }) => ({ x, y })), 'the new path runs between the new stops');
  assert.equal(route.path.length, 66);
  for (const vehicle of fleet(game, route)) {
    assert.ok(vehicle.progress >= 0 && vehicle.progress <= route.path.length - 1);
    assert.deepEqual({ x: vehicle.x, y: vehicle.y }, { x: route.path[vehicle.progress].x, y: route.path[vehicle.progress].y }, 'vehicles stand on the new path');
  }
  assert.deepEqual([route.active, route.status, route.pathRevision], [true, 'Running', game.networkRevision]);
  assert.deepEqual([route.revenueAtAccountingStart, route.expenses, route.accountingStartDay, route.delivered], [route.revenue, 0, game.day, delivered], 'the card counts the new service afresh; deliveries stay a lifetime count');
  assert.notEqual(game.routes, routes, 'a new routes array drops cached upkeep shares');
  assert.equal(validateGame(game), true);
  tick(game, 40);
  assert.equal(validateGame(game), true);
  assert.ok(route.delivered > delivered, 'the edited service delivers at its new stop');
});

test('an edited route survives a save round trip', () => {
  const { game, stops } = networkFixture(), route = launch(game, [stops.quarryStop, stops.stoneford], 'stone');
  addRouteVehicle(game, route.id); tick(game, 3.3);
  assert.equal(editRoute(game, route.id, { stops: [stops.millbrook, stops.quarryStop], cargo: 'timber' }).ok, true);
  assert.deepEqual(route.stops, [stops.quarryStop, stops.millbrook], 'freight loads at its producer, whichever end was picked first');
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(restored);
  assert.equal(validateGame(restored), true);
  const saved = routes => routes.map(({ pathRevision, ...route }) => JSON.parse(JSON.stringify(route)));
  assert.deepEqual(saved(restored.routes), saved(game.routes), 'stops, path, cargo and accounting load as edited');
  assert.deepEqual(restored.vehicles.map(({ id, progress, x, y, load }) => ({ id, progress, x, y, load })), game.vehicles.map(({ id, progress, x, y, load }) => ({ id, progress, x, y, load })));
});

test('a freight cargo change empties the vehicles; passenger and freight services never swap', () => {
  const { game, stops } = networkFixture(), route = launch(game, [stops.quarryStop, stops.millbrook], 'stone');
  addRouteVehicle(game, route.id); tick(game, .5);
  assert.ok(fleet(game, route).some(vehicle => vehicle.load > 0), 'the fixture starts with stone aboard');
  const changed = editRoute(game, route.id, { stops: [stops.quarryStop, stops.millbrook], cargo: 'timber' });
  assert.equal(changed.ok, true, changed.message);
  assert.equal(changed.message, 'Route updated: Stone run now carries timber from Stone quarry Stop 1 to Millbrook Stop 3.');
  assert.equal(route.cargo, 'timber');
  assert.deepEqual(fleet(game, route).map(vehicle => vehicle.load), [0, 0], 'stone aboard is left behind');
  assert.equal(validateGame(game), true);
  const bus = launch(game, [stops.stoneford, stops.millbrook], 'passengers');
  for (const [target, cargo] of [[bus, 'stone'], [route, 'passengers']]) {
    const before = snapshot(game), refused = editRoute(game, target.id, { stops: [stops.stoneford, stops.millbrook], cargo });
    assert.deepEqual([refused.ok, refused.message], [false, 'Passenger and freight vehicles differ. Launch a new route instead.']);
    assert.equal(snapshot(game), before);
  }
});

test('an invalid edit changes nothing', () => {
  const { game, stops } = networkFixture(), route = launch(game, [stops.quarryStop, stops.stoneford], 'stone');
  addRouteVehicle(game, route.id); tick(game, 1.4);
  const routes = game.routes;
  for (const [edit, message] of [
    [{ stops: [stops.quarryStop, stops.island], cargo: 'stone' }, 'These stops aren’t joined by road. Build the missing road, including any bridge or tunnel, then try again.'],
    [{ stops: [stops.quarryStop, stops.rail], cargo: 'stone' }, 'Both stops must be road stops.'],
    [{ stops: [stops.quarryStop, stops.quarryStop], cargo: 'stone' }, 'Choose two different stops.'],
    [{ stops: [stops.quarryStop, 'station-missing'], cargo: 'stone' }, 'Both stops must be road stops.'],
    [{ stops: [stops.stoneford, stops.millbrook], cargo: 'stone' }, 'These stops need a supplier of stone and a buyer within 5 tiles.'],
    [{ stops: [stops.quarryStop, stops.stoneford], cargo: 'unobtainium' }, 'Choose a valid transport mode and cargo.'],
    [{ stops: [stops.quarryStop, stops.stoneford], cargo: 'stone' }, 'Nothing to change.'],
    [{ stops: [stops.stoneford, stops.quarryStop], cargo: 'stone' }, 'Nothing to change.'],
    [{ cargo: 'stone' }, 'Choose two different stops.'],
  ]) {
    const before = snapshot(game), refused = editRoute(game, route.id, edit);
    assert.deepEqual([refused.ok, refused.message], [false, message], JSON.stringify(edit));
    assert.equal(snapshot(game), before, `${JSON.stringify(edit)} leaves the route as it was`);
  }
  assert.equal(game.routes, routes);
  assert.deepEqual([editRoute(game, 'route-missing', { stops: [stops.quarryStop, stops.millbrook], cargo: 'stone' }).message], ['Route not found.']);
});

test('after an edit onto new track, a maintenance day charges the route its new share, like a fresh launch', () => {
  const edited = networkFixture(), fresh = networkFixture(), unchanged = networkFixture();
  const route = launch(edited.game, [edited.stops.quarryStop, edited.stops.stoneford], 'stone');
  const control = launch(unchanged.game, [unchanged.stops.quarryStop, unchanged.stops.stoneford], 'stone');
  const launched = launch(fresh.game, [fresh.stops.quarryStop, fresh.stops.millbrook], 'stone');
  for (const { game } of [edited, fresh, unchanged]) tick(game, 1);
  assert.equal(editRoute(edited.game, route.id, { stops: [edited.stops.quarryStop, edited.stops.millbrook], cargo: 'stone' }).ok, true);
  // Park every truck where the fresh one stands, so only the route's track and stops differ.
  const state = ({ x, y, angle, progress, direction, load, dwellRemaining, totalDistance, tripSerial }) => ({ x, y, angle, progress, direction, load, dwellRemaining, totalDistance, tripSerial });
  for (const { game } of [edited, unchanged]) Object.assign(game.vehicles[0], state(fresh.game.vehicles[0]));
  const charges = [[edited, route], [fresh, launched], [unchanged, control]].map(([{ game }, service]) => {
    const expenses = service.expenses, money = game.money;
    tick(game, 1);
    return { route: service.expenses - expenses, company: money - game.money };
  });
  assert.deepEqual(charges[0], charges[1], 'the edited route pays what the same route launched fresh pays');
  assert.ok(charges[0].route > charges[2].route, `the longer track costs more: ${charges[0].route} vs ${charges[2].route}`);
});
