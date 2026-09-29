import test from 'node:test';
import assert from 'node:assert/strict';
import { stationDistance, stationSpan, stationTiles, stationSiteAt, stationServes, stationReach, airPath, AIRPORT_REACH, STATION_RADIUS } from '../station-sites.js';

const seeded = seed => () => { seed = Math.imul(seed ^ (seed >>> 15), 2246822519) ^ Math.imul(seed ^ (seed >>> 13), 3266489917); seed ^= seed >>> 16; return (seed >>> 0) / 4294967296; };

test('a one-tile stop measures exactly as Math.hypot, bit for bit', () => {
  const r = seeded(99);
  for (let n = 0; n < 1000; n++) {
    const stop = { x: Math.floor(r() * 200), y: Math.floor(r() * 200), mode: ['road', 'rail', 'water'][n % 3] }, point = { x: Math.floor(r() * 200), y: Math.floor(r() * 200) };
    assert.equal(stationDistance(stop, point), Math.hypot(point.x - stop.x, point.y - stop.y));
    assert.equal(Object.is(stationDistance(stop, point), Math.hypot(stop.x - point.x, stop.y - point.y)), true);
  }
  assert.equal(stationReach({ mode: 'road' }), STATION_RADIUS); assert.equal(stationReach({ mode: 'air', axis: 'x' }), AIRPORT_REACH);
});

test('airports span 6 × 2 along their runway axis and measure from the nearest tile', () => {
  const x = { x: 10, y: 20, mode: 'air', axis: 'x' }, y = { x: 10, y: 20, mode: 'air', axis: 'y' };
  assert.deepEqual(stationSpan(x), { w: 6, h: 2 }); assert.deepEqual(stationSpan(y), { w: 2, h: 6 }); assert.deepEqual(stationSpan({ x: 1, y: 1, mode: 'road' }), { w: 1, h: 1 });
  assert.equal(stationTiles(x).length, 12); assert.deepEqual(stationTiles(x).at(-1), { x: 15, y: 21 }); assert.deepEqual(stationTiles(y).at(-1), { x: 11, y: 25 });
  assert.deepEqual(stationTiles({ x: 3, y: 4, mode: 'rail' }), [{ x: 3, y: 4 }]);
  assert.equal(stationDistance(x, { x: 13, y: 18 }), 2); assert.equal(stationDistance(x, { x: 15, y: 28 }), 7);
  assert.equal(stationServes(x, { x: 15, y: 28 }), true); assert.equal(stationServes(x, { x: 16, y: 28 }), false);
});

test('a flight is a deterministic 4-connected staircase along the straight line', () => {
  const game = { width: 200, height: 150 };
  for (const [from, to] of [[{ x: 10, y: 10 }, { x: 70, y: 40 }], [{ x: 100, y: 5 }, { x: 20, y: 120 }], [{ x: 3, y: 50 }, { x: 60, y: 50 }], [{ x: 30, y: 30 }, { x: 60, y: 60 }]]) {
    const path = airPath(game, from, to);
    assert.equal(path.length, Math.abs(to.x - from.x) + Math.abs(to.y - from.y) + 1);
    assert.deepEqual(path[0], from); assert.deepEqual(path.at(-1), to);
    for (let i = 1; i < path.length; i++) assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y), 1);
    assert.deepEqual(airPath(game, from, to), path);
  }
  assert.equal(airPath(game, { x: -1, y: 0 }, { x: 5, y: 5 }), null); assert.equal(airPath(game, { x: 0, y: 0 }, { x: 200, y: 5 }), null);
});

test('the footprint index follows pushes, filters and in-place replacements', () => {
  const game = { width: 100, height: 100, networkRevision: 0, stations: [{ id: 'a', x: 10, y: 10, mode: 'road' }] };
  assert.equal(stationSiteAt(game, 10, 10).id, 'a'); assert.equal(stationSiteAt(game, 11, 10), null);
  game.stations.push({ id: 'b', x: 20, y: 20, mode: 'air', axis: 'x' });
  assert.equal(stationSiteAt(game, 25, 21).id, 'b'); assert.equal(stationSiteAt(game, 26, 21), null);
  game.stations = game.stations.filter(s => s.id !== 'b');
  assert.equal(stationSiteAt(game, 25, 21), null);
  game.stations[0] = { id: 'c', x: 40, y: 40, mode: 'air', axis: 'y' }; game.networkRevision++;
  assert.equal(stationSiteAt(game, 10, 10), null); assert.equal(stationSiteAt(game, 41, 45).id, 'c');
  assert.equal(stationSiteAt(game, -1, 0), null); assert.equal(stationSiteAt(game, 0, 100), null); assert.equal(stationSiteAt(game, 1.5, 2), null);
});
