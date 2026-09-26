import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, build, constructionCost, createGame, findPath, loadGame, refreshRouteConnections, restoreGame, saveGame, validateGame } from '../model.js';
import { buildPlan, quoteBuildPlan } from '../construction-plan.js';
import { stepEcology } from '../environment.js';
import { encodeGame } from '../save-codec.js';
import { terrainLevel } from '../terrain-elevation.js';
import { emptyGame, line, tileAt } from './helpers.mjs';

function levelGame(biome = 'taiga') {
  const game = emptyGame(biome);
  for (const tile of game.tiles) tile.elevation = 4 / 16;
  return game;
}

function prepareSpan(game, tool, axis = 'x') {
  const points = axis === 'x' ? line(10, 14, 10) : Array.from({ length: 5 }, (_, i) => ({ x: 10, y: 10 + i }));
  const tunnel = tool.includes('tunnel');
  for (const [index, point] of points.entries()) {
    const tile = tileAt(game, point.x, point.y);
    tile.elevation = (index === 0 || index === points.length - 1 ? 4 : tunnel ? 7 : 2) / 16;
    tile.terrain = 'grass'; tile.detail = '';
  }
  return points;
}

function withStorage(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('raising and lowering move exactly one terrain level, charge the quote and respect inflation', () => {
  const game = levelGame(), point = { x: 12, y: 12 }, tile = tileAt(game, point.x, point.y);
  tile.elevation = .27;
  const cost = constructionCost(game, 'raise', point.x, point.y), oldMoney = game.money, revision = game.revision;
  assert.ok(cost > 0);
  const quote = quoteBuildPlan(game, 'raise', [point]), raised = buildPlan(game, 'raise', [point]);
  assert.equal(raised.ok, true); assert.equal(raised.cost, cost); assert.equal(quote.cost, cost);
  assert.equal(terrainLevel(tile), 5); assert.equal(tile.elevation, 5 / 16);
  assert.equal(game.money, oldMoney - cost); assert.ok(game.revision > revision);
  assert.equal(build(game, 'lower', point.x, point.y).ok, true);
  assert.equal(terrainLevel(tile), 4);
  game.day = 365 * 3;
  assert.ok(constructionCost(game, 'raise', point.x, point.y) > cost);
});

test('earthworks reject water, level limits, insufficient funds and every occupied site without mutation', () => {
  const cases = [
    ['raise', (game, tile) => { tile.elevation = 1; }],
    ['lower', (game, tile) => { tile.elevation = 1 / 16; }],
    ['raise', (game, tile) => { tile.terrain = 'water'; tile.elevation = 0; }],
    ['lower', game => { game.money = 0; }],
    ['raise', (game, tile) => { tile.road = true; }],
    ['lower', (game, tile) => { tile.rail = true; }],
    ['raise', (game, tile) => { tile.building = { kind: 'house-cheap-1', level: 1 }; }],
    ['lower', (game, tile) => { tile.zone = 'residential'; game.zones.push({ x: 12, y: 12, kind: 'residential', progress: 0 }); }],
    ['raise', game => { game.stations.push({ id: 'test-stop', name: 'Stop', x: 12, y: 12, mode: 'road' }); }],
    ['lower', game => { game.cities.push({ id: 'test-city', x: 12, y: 12 }); }],
    ['raise', game => { game.industries.push({ id: 'test-industry', kind: 'farm', x: 11, y: 11, footprint: 2 }); }],
  ];
  for (const [tool, setup] of cases) {
    const game = levelGame(); setup(game, tileAt(game, 12, 12)); const before = structuredClone(game);
    assert.equal(build(game, tool, 12, 12).ok, false, String(setup));
    assert.deepEqual(game, before, 'rejected earthworks do not charge or edit the world');
  }
});

for (const tool of ['bridge', 'railbridge', 'tunnel', 'railtunnel']) for (const axis of ['x', 'y']) {
  test(`${tool}: a ${axis}-axis span connects matching ground levels with preserved terrain and a repeat costs nothing`, () => {
    const game = levelGame(), points = prepareSpan(game, tool, axis), mode = tool.startsWith('rail') ? 'rail' : 'road';
    const terrain = points.map(point => ({ ...tileAt(game, point.x, point.y) }));
    const before = structuredClone(game), quote = quoteBuildPlan(game, tool, points);
    assert.deepEqual(game, before, 'construction preview is read-only');
    assert.ok(quote.cost > 0);
    const result = buildPlan(game, tool, points);
    assert.equal(result.ok, true, result.message); assert.equal(result.built, points.length);
    assert.equal(result.cost, quote.cost); assert.equal(game.money, before.money - result.cost);
    for (const [index, point] of points.entries()) {
      const tile = tileAt(game, point.x, point.y), interior = index > 0 && index < points.length - 1;
      assert.equal(tile[mode], true); assert.equal(tile.terrain, terrain[index].terrain);
      assert.equal(tile.elevation, terrain[index].elevation);
      assert.equal(Boolean(tile.bridge), interior && tool.includes('bridge'));
      assert.equal(Boolean(tile.tunnel), interior && tool.includes('tunnel'));
      assert.equal(tile.structureLevel, interior ? 4 : undefined);
      assert.equal(tile.structureAxis, interior ? axis : undefined);
    }
    assert.deepEqual(findPath(game, points[0], points.at(-1), mode), points);
    const money = game.money, repeated = buildPlan(game, tool, points);
    assert.equal(repeated.ok, true); assert.equal(repeated.cost, 0); assert.equal(repeated.built, 0);
    assert.equal(quoteBuildPlan(game, tool, points).cost, 0); assert.equal(game.money, money);
  });
}

test('bridges cross a mixture of valley floor and water without changing shoreline or ship connectivity', () => {
  const game = levelGame(), points = prepareSpan(game, 'bridge');
  for (let y = 8; y <= 12; y++) Object.assign(tileAt(game, 12, y), { terrain: 'water', elevation: 0, detail: 'river' });
  assert.equal(buildPlan(game, 'bridge', points).ok, true);
  assert.deepEqual(findPath(game, { x: 12, y: 8 }, { x: 12, y: 12 }, 'water'), Array.from({ length: 5 }, (_, i) => ({ x: 12, y: 8 + i })));
  assert.equal(tileAt(game, 12, 10).detail, 'river');
  assert.equal(tileAt(game, 12, 10).elevation, 0);
});

test('invalid span geometry, grades, obstructions and funds fail atomically', () => {
  const cases = [
    ['bridge', (game, points) => points.slice(0, 2)],
    ['bridge', (game, points) => [points[0], points[2], points[4]]],
    ['bridge', (game, points) => [points[0], points[1], { x: 11, y: 11 }]],
    ['bridge', (game, points) => { tileAt(game, 14, 10).elevation = 5 / 16; return points; }],
    ['bridge', (game, points) => { tileAt(game, 12, 10).elevation = 4 / 16; return points; }],
    ['tunnel', (game, points) => { tileAt(game, 12, 10).elevation = 4 / 16; return points; }],
    ['tunnel', (game, points) => { Object.assign(tileAt(game, 12, 10), { terrain: 'water', elevation: 0 }); return points; }],
    ['bridge', (game, points) => { tileAt(game, 12, 10).building = { kind: 'house-cheap-1', level: 1 }; return points; }],
    ['tunnel', (game, points) => { game.industries.push({ id: 'occupied-industry', kind: 'farm', x: 11, y: 9, footprint: 2 }); return points; }],
    ['bridge', (game, points) => { game.money = 1; return points; }],
  ];
  for (const [tool, alter] of cases) {
    const game = levelGame(), points = alter(game, prepareSpan(game, tool)), before = structuredClone(game);
    const quote = quoteBuildPlan(game, tool, points);
    assert.equal(quote.ok, false, String(alter));
    const result = buildPlan(game, tool, points);
    assert.equal(result.ok, false, String(alter)); assert.equal(result.cost, 0); assert.equal(result.built, 0);
    assert.deepEqual(game, before, 'a failed span never leaves a partial bridge or tunnel');
  }
});

test('span paths reject side entry and wrong deck heights, but retain ordinary and legacy connections', () => {
  for (const tool of ['bridge', 'tunnel']) {
    const game = levelGame(), points = prepareSpan(game, tool);
    assert.equal(buildPlan(game, tool, points).ok, true);
    for (let y = 8; y < 10; y++) assert.equal(build(game, 'road', 12, y).ok, true);
    assert.equal(findPath(game, { x: 12, y: 8 }, points[0]), null, 'surface roads cannot enter the side of an engineered span');
    tileAt(game, 10, 10).elevation = 3 / 16;
    assert.equal(findPath(game, points[0], points.at(-1)), null, 'ground cannot connect one level below the deck or portal');
    tileAt(game, 10, 10).elevation = 4 / 16;
    assert.ok(findPath(game, points[0], points.at(-1)));
    assert.equal(build(game, 'bulldoze', 12, 10).ok, true);
    assert.equal(tileAt(game, 12, 10).structureLevel, undefined);
    assert.equal(tileAt(game, 12, 10).structureAxis, undefined);
    assert.equal(findPath(game, points[0], points.at(-1)), null);
  }
  const game = levelGame();
  for (let x = 10; x <= 12; x++) {
    const tile = tileAt(game, x, 10); tile.elevation = x / 16;
    assert.equal(build(game, 'road', x, 10).ok, true);
  }
  assert.ok(findPath(game, { x: 10, y: 10 }, { x: 12, y: 10 }), 'legacy sloping ground roads stay connected');
  Object.assign(tileAt(game, 13, 10), { terrain: 'water', elevation: 0 });
  assert.equal(build(game, 'bridge', 13, 10).ok, true);
  assert.ok(findPath(game, { x: 10, y: 10 }, { x: 13, y: 10 }), 'untagged legacy water bridges remain compatible');
});

test('ecology preserves engineered heights and built spans as the surroundings evolve', () => {
  const game = levelGame(), points = prepareSpan(game, 'tunnel');
  assert.equal(buildPlan(game, 'tunnel', points).ok, true);
  for (let i = 0; i < 3; i++) assert.equal(build(game, 'raise', 20, 20).ok, true);
  const elevation = game.tiles.map(tile => tile.elevation), span = points.map(point => structuredClone(tileAt(game, point.x, point.y)));
  for (let day = 1; day <= 80; day++) { game.day = day; stepEcology(game); }
  assert.deepEqual(game.tiles.map(tile => tile.elevation), elevation);
  assert.deepEqual(points.map(point => tileAt(game, point.x, point.y)), span);
});

test('active routes disconnect and resume when an engineered crossing is removed and repaired', () => {
  const game = levelGame(), points = prepareSpan(game, 'bridge');
  assert.equal(buildPlan(game, 'bridge', points).ok, true);
  game.cities = [7, 17].map((x, index) => ({
    id: `engineering-town-${index}`, name: `Town ${index}`, x, y: 10,
    population: 300, activity: 0, growth: 0, passengers: 80, delivered: 0, supplies: 0, lastServiceDay: null,
  }));
  const a = build(game, 'bus-stop', 10, 10), b = build(game, 'bus-stop', 14, 10);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(addRoute(game, { name: 'Valley crossing', stops: [a.station.id, b.station.id] }).ok, true);
  const route = game.routes[0]; refreshRouteConnections(game);
  assert.equal(route.active, true); assert.deepEqual(route.path, points);
  const revision = game.networkRevision;
  assert.equal(build(game, 'bulldoze', 12, 10).ok, true); assert.ok(game.networkRevision > revision);
  refreshRouteConnections(game); assert.equal(route.active, false); assert.equal(route.status, 'Disconnected');
  assert.equal(buildPlan(game, 'bridge', points).ok, true);
  refreshRouteConnections(game); assert.equal(route.active, true); assert.equal(route.status, 'Running');
  assert.deepEqual(route.path, points); assert.equal(validateGame(game), true);
});

test('local saves preserve lowered ground and bridge/tunnel deck metadata', () => withStorage(() => {
  const game = levelGame(), bridge = prepareSpan(game, 'bridge');
  assert.equal(buildPlan(game, 'bridge', bridge).ok, true);
  const tunnel = line(20, 24, 10);
  for (const [index, point] of tunnel.entries()) tileAt(game, point.x, point.y).elevation = (index === 0 || index === 4 ? 4 : 7) / 16;
  assert.equal(buildPlan(game, 'railtunnel', tunnel).ok, true);
  assert.equal(build(game, 'lower', 15, 15).ok, true);
  assert.equal(validateGame(game), true); assert.equal(saveGame(game).ok, true);
  const restored = loadGame(); assert.ok(restored); assert.deepEqual(restored.tiles, game.tiles);
  assert.equal(restored.money, game.money);
  assert.deepEqual(findPath(restored, bridge[0], bridge.at(-1)), bridge);
  assert.deepEqual(findPath(restored, tunnel[0], tunnel.at(-1), 'rail'), tunnel);
}));

test('procedural saves keep earthworks and structures as sparse changes to the original generated map', () => {
  const game = createGame({ size: 'square512', seed: 413 });
  const points = line(2, 6, 2);
  for (const [i, point] of points.entries()) Object.assign(tileAt(game, point.x, point.y), {
    terrain: 'grass', elevation: (i === 0 || i === 4 ? 4 : 2) / 16, detail: '',
    road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null,
  });
  assert.equal(buildPlan(game, 'bridge', points).ok, true);
  Object.assign(tileAt(game, 8, 2), { terrain: 'grass', elevation: 4 / 16, road: false, rail: false, building: null, zone: null });
  assert.equal(build(game, 'lower', 8, 2).ok, true);
  const saved = encodeGame(game);
  assert.equal(saved.format, 'transport-procedural-v1'); assert.ok(saved.tiles.count <= 6);
  const restored = restoreGame(JSON.parse(JSON.stringify(saved))); assert.ok(restored);
  assert.deepEqual(restored.tiles, game.tiles);
  assert.deepEqual(findPath(restored, points[0], points.at(-1)), points);
});

test('save validation rejects malformed engineering metadata while preserving untagged old structures', () => {
  const game = levelGame(), points = prepareSpan(game, 'bridge');
  assert.equal(buildPlan(game, 'bridge', points).ok, true); assert.equal(validateGame(game), true);
  const corruptions = [
    tile => { tile.structureLevel = 0; },
    tile => { tile.structureLevel = 17; },
    tile => { tile.structureLevel = 4.5; },
    tile => { tile.structureAxis = 'z'; },
    tile => { delete tile.structureLevel; },
    tile => { delete tile.structureAxis; },
    tile => { tile.bridge = false; },
    tile => { tile.tunnel = true; },
    tile => { tile.road = false; },
  ];
  for (const corrupt of corruptions) {
    const invalid = structuredClone(game); corrupt(tileAt(invalid, 12, 10));
    assert.equal(validateGame(invalid), false, String(corrupt));
    assert.equal(restoreGame(invalid), null);
  }
  for (const point of points) { delete tileAt(game, point.x, point.y).structureLevel; delete tileAt(game, point.x, point.y).structureAxis; }
  assert.equal(validateGame(game), true, 'old saves with no engineering metadata still load');
});
