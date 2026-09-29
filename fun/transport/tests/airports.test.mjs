import test from 'node:test';
import assert from 'node:assert/strict';
import { airAvailable, getVehiclePurchase, createGame, build, buildPath, addRoute, addRouteVehicle, removeRoute, tick, validateGame, stationAt, stationCoverage, passengerEndpoints, findPath, airportSiteProblem, stationSiteAt, stationDistance, restoreGame, routeBreakPoint, AIRPORT_REACH, AIR_TURNAROUND } from '../model.js';
import { AIR_DEPARTURE_DWELL } from '../station-sites.js';
import { encodeGame } from '../save-codec.js';
import { stepEcology } from '../environment.js';
import { stepSettlements } from '../settlements.js';
import { routeTileIndex } from '../route-tiles.js';
import { quoteBuildPlan, buildPlan } from '../construction-plan.js';

function flatGame(size = 'large') {
  const game = createGame({ biome: 'taiga', size, seed: 1847 });
  for (const tile of game.tiles) { Object.assign(tile, { terrain: 'grass', detail: '', elevation: .25, publicRoad: false, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null }); delete tile.terrainObject; }
  for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) game[key] = [];
  game.money = 5_000_000; game.revision++; game.networkRevision++;
  game.day = game.lastDailyDay = 730; game.lastMonth = 24; // 1 January 1952: air travel is open
  return game;
}
const town = (id, x, y, population = 1500) => ({ id, name: id, x, y, population, activity: 20, growth: 0, passengers: 600, mail: 0, delivered: 0, supplies: 0, lastServiceDay: null });
function airLink(game, { a = [40, 60], b = [100, 60], axisA = 'x', axisB = 'x' } = {}) {
  game.cities.push(town('town-a', a[0] + 3, a[1] - 4), town('town-b', b[0] + 3, b[1] - 4));
  const A = build(game, `airport-${axisA}`, ...a), B = build(game, `airport-${axisB}`, ...b);
  assert.equal(A.ok, true, A.message); assert.equal(B.ok, true, B.message);
  return [A.station, B.station];
}

test('an airport occupies a clear, dry, level 6 × 2 site in either orientation', () => {
  const game = flatGame(), before = game.money;
  const r = build(game, 'airport-x', 40, 60);
  assert.equal(r.ok, true); assert.equal(r.station.mode, 'air'); assert.equal(r.station.axis, 'x');
  assert.equal(before - game.money, r.cost);
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 6; dx++) { assert.equal(stationSiteAt(game, 40 + dx, 60 + dy), r.station); assert.equal(stationAt(game, 40 + dx, 60 + dy), r.station); }
  assert.equal(stationSiteAt(game, 46, 60), null); assert.equal(stationSiteAt(game, 40, 62), null);
  const y = build(game, 'airport-y', 60, 60); assert.equal(y.ok, true);
  assert.equal(stationSiteAt(game, 61, 65), y.station); assert.equal(stationSiteAt(game, 62, 60), null);
  assert.equal(validateGame(game), true);
});

test('airport refusals name the problem and change nothing', () => {
  const game = flatGame();
  game.tiles[61 * game.width + 43].terrain = 'water';
  const money = game.money;
  assert.match(build(game, 'airport-x', 40, 60).message, /dry land/);
  game.tiles[61 * game.width + 43].terrain = 'grass';
  buildPath(game, 'road', [{ x: 42, y: 61 }]); const afterRoad = game.money;
  assert.match(build(game, 'airport-x', 40, 60).message, /Clear all 12 tiles/);
  assert.match(build(game, 'airport-x', game.width - 3, 10).message, /fit inside the map/);
  game.tiles[20 * game.width + 21].elevation = .6; game.revision++;
  assert.match(build(game, 'airport-x', 20, 19).message, /level ground/);
  assert.equal(airportSiteProblem(game, 'x', 20, 19).reason, 'terrain');
  assert.ok(money > afterRoad); assert.equal(game.money, afterRoad); // only the road tile was paid for
  assert.equal(game.stations.length, 0);
});

test('every other system treats all 12 tiles as occupied', () => {
  const game = flatGame(); const { station } = build(game, 'airport-x', 40, 60);
  assert.equal(build(game, 'road', 45, 61).message, 'Roads and railways can’t cross an airport. Build around it.'); assert.equal(game.tiles[61 * game.width + 45].road, false);
  assert.equal(build(game, 'residential', 44, 60).ok, false);
  assert.equal(build(game, 'school', 44, 59).ok, false);
  assert.equal(build(game, 'sawmill', 44, 59).ok, false);
  assert.equal(build(game, 'bus-stop', 44, 60).ok, false);
  assert.equal(build(game, 'raise', 43, 61).ok, false);
  assert.equal(build(game, 'city', 43, 61).ok, false);
  // Ecology never grows on the site, and towns never build on it.
  game.cities.push(town('town-a', 43, 56));
  for (let d = 0; d < 400; d++) { game.day++; stepEcology(game); stepSettlements(game); }
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 6; dx++) { const t = game.tiles[(60 + dy) * game.width + 40 + dx]; assert.equal(t.terrain, 'grass'); assert.equal(t.building, null); assert.equal(t.road, false); }
  assert.equal(stationSiteAt(game, 40, 60), station);
});

test('coverage: towns within 7 tiles of any airport tile; passengers and mail only', () => {
  const game = flatGame(); const { station } = build(game, 'airport-x', 40, 60);
  game.cities.push(town('near', 48, 63), town('edge', 45, 68), town('far', 53, 61));
  game.industries.push({ id: 'industry-q', kind: 'quarry', name: 'Quarry', x: 44, y: 63, footprint: 2, capacity: 1, inventory: { stone: 100 }, production: 0, shipped: 0, received: 0, activity: 0, idleDays: 0 });
  const coverage = stationCoverage(game, station);
  assert.deepEqual(coverage.cities.map(c => c.id).sort(), ['edge', 'near']);
  assert.equal(stationDistance(station, { x: 45, y: 68 }), 7);
  assert.deepEqual(coverage.industries, []); assert.deepEqual(coverage.produces, ['passengers', 'mail']); assert.deepEqual(coverage.accepts, ['passengers', 'mail']);
  assert.equal(AIRPORT_REACH, 7);
});

test('a flight is a straight staircase path between the anchors', () => {
  const game = flatGame(); const [A, B] = airLink(game, { a: [40, 60], b: [100, 90], axisB: 'y' });
  const path = findPath(game, A, B, 'air');
  assert.equal(path.length - 1, 60 + 30);
  assert.deepEqual(path[0], { x: 40, y: 60 }); assert.deepEqual(path.at(-1), { x: 100, y: 90 });
  for (let i = 1; i < path.length; i++) assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y), 1);
  for (const p of path) { const t = ((p.x - 40) * 60 + (p.y - 60) * 30) / (60 * 60 + 30 * 30); assert.ok(Math.hypot(40 + 60 * t - p.x, 60 + 30 * t - p.y) < 1); }
});

test('air routes: passengers and mail, two airports 16 tiles apart; the plane starts at its stand', () => {
  const game = flatGame(); const [A, B] = airLink(game);
  assert.equal(addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'stone' }).message, 'Planes carry passengers and mail.');
  const near = build(game, 'airport-x', 40, 70).station; game.cities.push(town('town-c', 44, 74));
  assert.match(addRoute(game, { mode: 'air', stops: [A.id, near.id], cargo: 'passengers' }).message, /at least 16 tiles apart/);
  const lone = build(game, 'airport-x', 40, 80).station;
  assert.equal(addRoute(game, { mode: 'air', stops: [near.id, lone.id], cargo: 'passengers' }).message, 'Airports must serve two different towns within 7 tiles.');
  const money = game.money, r = addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'passengers' });
  assert.equal(r.ok, true, r.message); assert.equal(money - game.money, r.cost);
  const v = game.vehicles.at(-1); assert.equal(v.capacity, getVehiclePurchase(game, 'air').capacity); assert.equal(v.capacity, 56);
  assert.ok(v.dwellRemaining > 0 && v.dwellRemaining < AIR_TURNAROUND);
  assert.equal(v.load, 56);
  assert.equal(validateGame(game), true);
  assert.equal(addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'mail' }).ok, true);
});

test('flights earn by grid distance, fly the chord and never disconnect', () => {
  const game = flatGame(); const [A, B] = airLink(game, { a: [40, 60], b: [100, 120] });
  const { route } = addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'passengers' });
  buildPath(game, 'road', Array.from({ length: 30 }, (_, i) => ({ x: 55 + i, y: 80 })));
  assert.equal(routeTileIndex(game).size, 0);
  for (let d = 0; d < 60; d++) tick(game, 1);
  assert.equal(route.active, true); assert.ok(route.delivered > 0); assert.ok(route.revenue > 0);
  const v = game.vehicles[0], max = route.path.length - 1, f = v.progress / max;
  assert.ok(Math.abs(v.x - (40 + 60 * f)) < 1e-9 && Math.abs(v.y - (60 + 60 * f)) < 1e-9);
  assert.ok(Math.hypot(60, 60) < max);
});

test('tick partitions give the same flights, fares and upkeep, even across a mid-day revision', () => {
  const make = () => { const game = flatGame(); const [A, B] = airLink(game, { a: [40, 60], b: [120, 100], axisB: 'y' }); addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'passengers' }); addRoute(game, { mode: 'air', stops: [B.id, A.id], cargo: 'passengers' }); return game; };
  const one = make(), two = make(), three = make();
  for (let d = 0; d < 120; d++) tick(one, 1);
  for (let d = 0; d < 480; d++) tick(two, .25);
  for (let d = 0; d < 480; d++) { tick(three, .25); if (Math.floor(d / 4) % 10 === 0 && d % 4 !== 3) three.revision++; }
  for (const other of [two, three]) {
    assert.equal(one.money, other.money);
    one.vehicles.forEach((v, i) => { assert.ok(Math.abs(v.progress - other.vehicles[i].progress) < 1e-9); assert.ok(Math.abs(v.dwellRemaining - other.vehicles[i].dwellRemaining) < 1e-9); });
  }
});

test('saves round-trip airports and flights; validation guards the footprint and axis', () => {
  const game = flatGame(); const [A, B] = airLink(game, { a: [40, 60], b: [150, 20], axisB: 'y' });
  addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'passengers' }); for (let d = 0; d < 20; d++) tick(game, 1);
  assert.equal(game.routes[0].path.length, 151);
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(restored); assert.deepEqual(restored.stations, game.stations); assert.deepEqual(restored.routes[0].path, game.routes[0].path);
  for (let d = 0; d < 30; d++) { tick(game, 1); tick(restored, 1); }
  assert.equal(restored.money, game.money);
  const bad = structuredClone(game); delete bad.stations[0].axis; assert.equal(validateGame(bad), false);
  const bad2 = structuredClone(game); bad2.tiles[61 * bad2.width + 45].road = true; assert.equal(validateGame(bad2), false);
  const bad3 = structuredClone(game); bad3.stations.push({ id: 'station-x', name: 'x', x: 10, y: 10, mode: 'road', axis: 'x' }); assert.equal(validateGame(bad3), false);
  const legacy = createGame({ seed: 1847, size: 'regional' }); assert.equal(validateGame(legacy), true);
});

test('an airport in use cannot be bulldozed; a free one clears in one charge', () => {
  const game = flatGame(); const [A, B] = airLink(game);
  const { route } = addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'passengers' });
  assert.match(build(game, 'bulldoze', 44, 61).message, /Retire the route first/);
  removeRoute(game, route.id);
  const quote = quoteBuildPlan(game, 'bulldoze', [{ x: 41, y: 60 }, { x: 45, y: 61 }]);
  assert.equal(quote.placements.length, 1);
  const money = game.money, cleared = buildPlan(game, 'bulldoze', [{ x: 41, y: 60 }, { x: 45, y: 61 }]);
  assert.equal(cleared.ok, true); assert.equal(money - game.money, quote.cost);
  assert.equal(stationSiteAt(game, 44, 61), null); assert.equal(game.stations.some(s => s.id === A.id), false);
  assert.match(build(game, 'bulldoze', 100, 60).message, /Cleared the airport/);
  assert.equal(validateGame(game), true);
});

test('a passenger airport pair uses distinct towns; one town at both ends is refused', () => {
  const game = flatGame();
  game.cities.push(town('solo', 50, 56));
  const A = build(game, 'airport-x', 44, 58).station, B = build(game, 'airport-x', 44, 49).station;
  assert.deepEqual(stationCoverage(game, B).cities.map(c => c.id), ['solo']); assert.deepEqual(stationCoverage(game, A).cities.map(c => c.id), ['solo']);
  assert.equal(passengerEndpoints(game, A, B), null);
});

test('air travel opens on 1 January 1952; earlier the tool explains why', () => {
  const game = flatGame(); game.day = game.lastDailyDay = 729; game.lastMonth = 23;
  assert.equal(airAvailable(game), false);
  const money = game.money; assert.equal(build(game, 'airport-x', 40, 60).message, 'Air travel arrives on 1 January 1952.'); assert.equal(game.money, money);
  tick(game, 1); assert.equal(airAvailable(game), true); assert.equal(build(game, 'airport-x', 40, 60).ok, true);
});

test('network changes never replan a flight, and a flight has no break point', () => {
  const game = flatGame(); const [A, B] = airLink(game);
  const { route } = addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'passengers' }), path = route.path;
  buildPath(game, 'road', Array.from({ length: 20 }, (_, i) => ({ x: 50 + i, y: 70 }))); tick(game, .5);
  assert.equal(route.path, path); assert.equal(route.pathRevision, game.networkRevision); assert.equal(route.active, true);
  route.active = false; assert.equal(routeBreakPoint(game, route), null); route.active = true;
});

test('added planes take the widest gap: at the far stand, then mid-flight on the chord', () => {
  const game = flatGame(); const [A, B] = airLink(game);
  const { route } = addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'passengers' }), L = route.path.length - 1;
  assert.equal(game.vehicles[0].progress, 0); assert.ok(game.vehicles[0].dwellRemaining > 0);
  const second = addRouteVehicle(game, route.id).vehicle;
  assert.equal(second.progress, L); assert.equal(second.direction, -1); assert.equal(second.dwellRemaining, AIR_DEPARTURE_DWELL); assert.ok(second.load > 0);
  for (let d = 0; d < 3; d++) tick(game, 1);
  const third = addRouteVehicle(game, route.id).vehicle, first = route.path[0], last = route.path[L], f = third.progress / L;
  assert.equal(third.dwellRemaining, 0); assert.ok(third.progress > 0 && third.progress < L);
  assert.ok(Math.abs(third.x - (first.x + (last.x - first.x) * f)) < 1e-9 && Math.abs(third.y - (first.y + (last.y - first.y) * f)) < 1e-9);
  assert.equal(validateGame(game), true);
});

test('a plane flies at one ground speed a day, sampled once at the chord midpoint', () => {
  const game = flatGame(); const [A, B] = airLink(game, { a: [40, 60], b: [140, 110] });
  const { route } = addRoute(game, { mode: 'air', stops: [A.id, B.id], cargo: 'passengers' }), v = game.vehicles[0], L = route.path.length - 1;
  while (v.dwellRemaining > 0) tick(game, .05);
  // Mid-flight, a day's advance splits into equal shares over any partition of that day.
  tick(game, Math.ceil(game.day) - game.day);
  const start = v.progress, steps = [];
  for (let n = 0; n < 8; n++) { const before = v.progress; tick(game, .125); steps.push(v.progress - before); }
  assert.ok(v.progress < L);
  for (const step of steps) assert.ok(Math.abs(step - steps[0]) < 1e-9, `${step} vs ${steps[0]}`);
  const straight = Math.hypot(100, 50), perDay = v.progress - start;
  // Ground speed along the chord stays near the 12 tiles a day base (generation 2 flies 20% faster).
  assert.ok(perDay * straight / L > 12 * .5 && perDay * straight / L < 12 * 1.2 * 1.1);
});

test('undo takes back a new airport over its whole site, and never one a route uses', async () => {
  const { captureUndo, finishUndo, canUndo, undoConstruction } = await import('../construction-undo.js');
  const game = flatGame(); game.cities.push(town('town-a', 43, 56), town('town-b', 103, 56));
  const place = (point, axis) => { const entry = captureUndo(game, 'airport', [point]), result = buildPlan(game, 'airport', [point], { airportAxis: axis }); assert.equal(result.ok, true, result.message); return finishUndo(entry, game, result); };
  const before = game.money, undo = place({ x: 42, y: 60 }, 'x');
  assert.ok(undo, 'an airport journals an undo');
  assert.equal(canUndo(game, undo), true);
  const done = undoConstruction(game, undo);
  assert.equal(done.ok, true, done.message); assert.equal(game.money, before);
  for (let dx = 0; dx < 6; dx++) assert.equal(stationAt(game, 40 + dx, 60), null);
  assert.equal(validateGame(game), true);
  const A = place({ x: 42, y: 60 }, 'x'), B = place({ x: 100, y: 62 }, 'y');
  assert.equal(addRoute(game, { mode: 'air', stops: game.stations.map(s => s.id), cargo: 'passengers' }).ok, true);
  assert.equal(canUndo(game, A) || canUndo(game, B), false, 'a route now uses both airports');
});
