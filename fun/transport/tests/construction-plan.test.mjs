import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildTool, quoteBuildPlan, buildPlan } from '../construction-plan.js';
import { build, constructionCost, findPath } from '../model.js';
import { emptyGame, tileAt, line } from './helpers.mjs';

for (const mode of ['road', 'rail']) {
  test(`${mode} gestures automatically bridge water and tunnel mountains at the quoted inflated cost`, () => {
    const game = emptyGame(); game.day = 730;
    const points = line(10, 16, 10), terrains = ['grass', 'forest', 'water', 'grass', 'mountain', 'rock', 'grass'];
    for (const [i, point] of points.entries()) Object.assign(tileAt(game, point.x, point.y), { terrain: terrains[i], detail: terrains[i] === 'water' ? 'river' : '' });
    const before = structuredClone(game), quote = quoteBuildPlan(game, mode, [...points, points[2]]);
    assert.deepEqual(game, before, 'previewing a gesture does not mutate terrain, funds or clocks');
    assert.equal(quote.placements.length, 7);
    assert.deepEqual(quote.placements.map(item => item.tool), [mode, mode, mode === 'rail' ? 'railbridge' : 'bridge', mode, mode === 'rail' ? 'railtunnel' : 'tunnel', mode, mode]);
    assert.equal(quote.cost, quote.placements.reduce((sum, placement) => sum + constructionCost(game, placement.tool, placement.x, placement.y), 0));
    const result = buildPlan(game, mode, [...points, points[2]]);
    assert.equal(result.ok, true); assert.equal(result.built, 7); assert.equal(result.failed, 0);
    assert.equal(result.cost, quote.cost); assert.equal(game.money, before.money - quote.cost);
    assert.ok(findPath(game, points[0], points.at(-1), mode), 'the completed mixed-terrain path is actually connected');
    assert.equal(tileAt(game, 12, 10).detail, 'river'); assert.equal(tileAt(game, 12, 10).terrain, 'water');
    assert.equal(tileAt(game, 14, 10).terrain, 'mountain'); assert.equal(tileAt(game, 14, 10).tunnel, true);
    assert.equal(tileAt(game, 15, 10).tunnel, false, 'rock stays an ordinary connection unless a tunnel was explicitly selected');
    const repeatQuote = quoteBuildPlan(game, mode, points), money = game.money, repeat = buildPlan(game, mode, points);
    assert.equal(repeatQuote.cost, 0); assert.equal(repeat.cost, 0); assert.equal(repeat.skipped, 7); assert.equal(repeat.built, 0); assert.equal(game.money, money);
  });
}

test('one Stop tool follows the existing network and the selected mode at crossings', () => {
  for (const preferredMode of ['road', 'rail']) {
    const game = emptyGame();
    build(game, 'road', 10, 10); build(game, 'rail', 11, 10); build(game, 'road', 12, 10); build(game, 'rail', 12, 10);
    const options = { preferredMode }, points = line(10, 12, 10), quote = quoteBuildPlan(game, 'stop', points, options), money = game.money;
    assert.deepEqual(quote.placements.map(item => item.tool), ['bus-stop', 'train-stop', preferredMode === 'rail' ? 'train-stop' : 'bus-stop']);
    const result = buildPlan(game, 'stop', points, options);
    assert.equal(result.built, 3); assert.equal(result.cost, quote.cost); assert.equal(game.money, money - quote.cost);
    assert.deepEqual(game.stations.map(station => station.mode), ['road', 'rail', preferredMode]);
  }
});

test('Stop never creates a free network or port, and reports a useful missing-network error', () => {
  for (const preferredMode of ['road', 'rail']) {
    const game = emptyGame(), before = structuredClone(game), expected = preferredMode === 'rail' ? 'train-stop' : 'bus-stop';
    assert.equal(resolveBuildTool(game, 'stop', 10, 10, { preferredMode }), expected);
    const result = buildPlan(game, 'stop', [{ x: 10, y: 10 }], { preferredMode });
    assert.equal(result.ok, false); assert.equal(result.failed, 1); assert.equal(result.cost, 0);
    assert.match(result.message, preferredMode === 'rail' ? /Build a railway/ : /Build a road/);
    assert.deepEqual(game, before);
    Object.assign(tileAt(game, 12, 10), { terrain: 'water', detail: 'river' });
    assert.equal(resolveBuildTool(game, 'stop', 12, 10, { preferredMode }), expected);
    assert.equal(buildPlan(game, 'stop', [{ x: 12, y: 10 }], { preferredMode }).ok, false);
    assert.equal(game.stations.length, 0);
  }
});

test('explicit construction tools preserve model behavior, including ports and rock tunnels', () => {
  const cases = [['bridge', 'water'], ['railbridge', 'water'], ['tunnel', 'rock'], ['railtunnel', 'rock'], ['port', 'water'], ['residential', 'grass'], ['logging-camp', 'grass'], ['bulldoze', 'forest']];
  for (const [tool, terrain] of cases) {
    const game = emptyGame(); Object.assign(tileAt(game, 10, 10), { terrain });
    const reference = structuredClone(game), points = [{ x: 10, y: 10 }];
    assert.equal(resolveBuildTool(game, tool, 10, 10), tool);
    const result = buildPlan(game, tool, points), expected = build(reference, tool, 10, 10);
    assert.deepEqual(result, { ...expected, cost: expected.cost || 0, built: expected.ok && !expected.unchanged ? 1 : 0, failed: expected.ok ? 0 : 1, skipped: expected.ok && expected.unchanged ? 1 : 0 }, `${tool} retains the model message and object result`);
    assert.deepEqual(game, reference, `${tool} retains the original economics and world mutations`);
  }
});

test('a deduplicated stop click returns its station and repeated demolition says Cleared', () => {
  const game = emptyGame(); build(game, 'rail', 10, 10);
  const point = { x: 10, y: 10 }, station = buildPlan(game, 'stop', [point, { ...point }]);
  assert.equal(station.built, 1); assert.equal(station.failed, 0); assert.equal(station.skipped, 0);
  assert.equal(station.station, game.stations[0]); assert.equal(station.station.mode, 'rail'); assert.match(station.message, /opened/);
  const existing = buildPlan(game, 'rail', [point, point]);
  assert.equal(existing.message, 'Already built.'); assert.equal(existing.unchanged, true); assert.equal(existing.built, 0); assert.equal(existing.skipped, 1);
  for (const x of [11, 12]) Object.assign(tileAt(game, x, 10), { terrain: 'forest', detail: 'pine' });
  const cleared = buildPlan(game, 'bulldoze', line(11, 12, 10));
  assert.equal(cleared.built, 2); assert.match(cleared.message, /^Cleared 2 tiles/);
});

test('partial paths skip blocked and unaffordable tiles while charging only completed connections', () => {
  const game = emptyGame(); game.day = 365;
  Object.assign(tileAt(game, 11, 10), { terrain: 'water', detail: 'river' });
  tileAt(game, 12, 10).building = { kind: 'house-cheap-1', level: 1 };
  const roadCost = constructionCost(game, 'road', 10, 10); game.money = roadCost * 2;
  const quote = quoteBuildPlan(game, 'road', line(10, 13, 10));
  assert.ok(quote.cost > game.money, 'the preview exposes the full requested cost');
  const result = buildPlan(game, 'road', line(10, 13, 10));
  assert.equal(result.ok, true); assert.equal(result.built, 2); assert.equal(result.failed, 2); assert.equal(result.cost, roadCost * 2);
  assert.equal(game.money, 0); assert.equal(tileAt(game, 11, 10).road, false); assert.equal(tileAt(game, 11, 10).bridge, false);
  assert.ok(tileAt(game, 12, 10).building); assert.equal(tileAt(game, 13, 10).road, true);
});

test('duplicates, invalid coordinates, unknown tools and empty requests cannot create spurious charges', () => {
  const game = emptyGame(), before = structuredClone(game);
  for (const points of [undefined, [], [null, {}, { x: 10.5, y: 10 }, { x: NaN, y: 10 }]]) {
    assert.deepEqual(quoteBuildPlan(game, 'road', points), { placements: [], cost: 0 });
    assert.equal(buildPlan(game, 'road', points).ok, false);
  }
  for (const tool of ['unknown-tool', 'toString', '__proto__']) {
    assert.equal(quoteBuildPlan(game, tool, [{ x: 10, y: 10 }]).cost, 0);
    assert.equal(buildPlan(game, tool, [{ x: 10, y: 10 }]).ok, false);
  }
  const invalid = buildPlan(game, 'road', [{ x: -1, y: 10 }, { x: game.width, y: 10 }]);
  assert.equal(invalid.ok, false); assert.equal(invalid.cost, 0); assert.equal(invalid.failed, 2); assert.deepEqual(game, before);
  const point = { x: 10, y: 10 }, quote = quoteBuildPlan(game, 'road', [point, point, { ...point }]);
  const result = buildPlan(game, 'road', [point, point, { ...point }]);
  assert.equal(quote.placements.length, 1); assert.equal(result.built, 1); assert.equal(result.cost, quote.cost); assert.equal(game.money, before.money - quote.cost);
});
