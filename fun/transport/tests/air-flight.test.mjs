import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, build, addRoute, tick, AIR_TURNAROUND } from '../model.js';
import { AIR_DEPARTURE_DWELL } from '../station-sites.js';
import { aircraftPose, flightPath, groundPaths, landingSign, groundPhase, standFor } from '../air-flight.js';
import { surfaceHeight } from '../terrain-geometry.js';

function world() {
  const game = createGame({ biome: 'taiga', size: 'large', seed: 1847 });
  for (const tile of game.tiles) { Object.assign(tile, { terrain: 'grass', detail: '', elevation: .25, publicRoad: false, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null }); delete tile.terrainObject; }
  for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) game[key] = [];
  game.money = 1e9; game.revision++; game.networkRevision++;
  game.day = game.lastDailyDay = 730; game.lastMonth = 24;
  return game;
}
const town = (id, x, y) => ({ id, name: id, x, y, population: 1500, activity: 20, growth: 0, passengers: 900, delivered: 0, supplies: 0, lastServiceDay: null });
function flight(a, b) {
  const game = world(), A = build(game, `airport-${a[2]}`, a[0], a[1]), B = build(game, `airport-${b[2]}`, b[0], b[1]);
  assert.equal(A.ok && B.ok, true, A.message + B.message);
  game.cities.push(town('t-a', a[0] + 3, a[1] - 3), town('t-b', b[0] + 3, b[1] - 3));
  const r = addRoute(game, { mode: 'air', stops: [A.station.id, B.station.id], cargo: 'passengers' });
  assert.equal(r.ok, true, r.message);
  return { game, route: r.route, stops: [A.station, B.station], vehicle: game.vehicles[0] };
}
const CASES = [[[30, 60, 'x'], [90, 60, 'x']], [[30, 40, 'x'], [80, 100, 'y']], [[120, 140, 'y'], [124, 60, 'y']], [[100, 30, 'x'], [80, 30, 'x']], [[40, 150, 'x'], [42, 110, 'y']]];

test('a plane never jumps: continuous ground, turns and heights through four round trips', () => {
  for (const [a, b] of CASES) {
    const { game, route, stops, vehicle } = flight(a, b), cache = {}, heights = s => surfaceHeight(game, s.x, s.y), cruise = 5.4, phases = new Set();
    let previous = null, trips = 0, serial = vehicle.tripSerial;
    for (let n = 0; n < 8000 && trips < 8; n++) {
      tick(game, .01);
      if (vehicle.tripSerial !== serial) { trips++; serial = vehicle.tripSerial; }
      const pose = aircraftPose(route, stops, vehicle, { heights, cruise, cache });
      phases.add(pose.phase);
      assert.ok(pose.z >= Math.min(heights(stops[0]), heights(stops[1])) - 1e-9 && pose.z <= cruise + 1e-9, `${pose.z}`);
      if (previous) {
        const step = Math.hypot(pose.x - previous.x, pose.y - previous.y);
        let turn = Math.abs(pose.heading - previous.heading); turn = Math.min(turn, 2 * Math.PI - turn);
        assert.ok(step <= .2, `${a}→${b}: step ${step} at ${previous.phase}→${pose.phase}`);
        if (step > 1e-4) assert.ok(turn <= 50 * Math.PI / 180, `${a}→${b}: turn ${turn} at ${previous.phase}→${pose.phase}`);
      }
      previous = pose;
    }
    assert.equal(trips, 8);
    assert.deepEqual([...phases].sort(), ['air', 'parked', 'roll', 'rollout', 'taxiIn', 'taxiOut']);
  }
});

test('the flight leaves the take-off roll and meets the landing roll exactly', () => {
  for (const [a, b] of CASES) {
    const { stops: [from, to] } = flight(a, b), path = flightPath(from, to);
    for (const stand of [0, 1]) {
      const roll = groundPaths(from, landingSign(from, to), stand).roll.points.at(-1), rollout = groundPaths(to, landingSign(to, from), stand).rollout.points[0];
      assert.ok(Math.hypot(roll.x - path.points[0].x, roll.y - path.points[0].y) < 1e-9);
      assert.ok(Math.hypot(rollout.x - path.points.at(-1).x, rollout.y - path.points.at(-1).y) < 1e-9);
    }
  }
});

test('landing runs one way and take-off the other at each airport', () => {
  for (const [a, b] of CASES) {
    const { stops: [from, to] } = flight(a, b);
    for (const [here, other] of [[from, to], [to, from]]) {
      const sign = landingSign(here, other), paths = groundPaths(here, sign, 0);
      assert.ok(sign === 1 || sign === -1);
      const land = paths.rollout.points, lift = paths.roll.points, dot = (land.at(-1).x - land[0].x) * (lift.at(-1).x - lift[0].x) + (land.at(-1).y - land[0].y) * (lift.at(-1).y - lift[0].y);
      assert.ok(dot < 0);
    }
  }
});

test('ground phases follow the fixed turnaround; stands and poses are pure', () => {
  assert.deepEqual([1.6, 1.35, .8, AIR_DEPARTURE_DWELL, .1].map(groundPhase), ['rollout', 'taxiIn', 'parked', 'taxiOut', 'roll']);
  assert.equal(AIR_TURNAROUND, 1.6);
  for (const id of ['vehicle-1', 'vehicle-2', 'vehicle-103', 'x']) assert.ok([0, 1].includes(standFor({ id })));
  const { game, route, stops, vehicle } = flight(...CASES[1]), heights = s => surfaceHeight(game, s.x, s.y);
  for (let n = 0; n < 40; n++) {
    tick(game, .07);
    const before = structuredClone(vehicle);
    aircraftPose(route, stops, vehicle, { heights, cruise: 5, cache: {} });
    assert.deepEqual(vehicle, before);
  }
});
