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

test('building quotes cover every reserved tile and charge once for the whole site', () => {
  for (const [kind, span] of [['house-cheap-1', 1], ['hospital', 2], ['stadium', 3], ['steel-mill', 3]]) {
    const game = emptyGame(), points = [{ x: 20, y: 20 }], before = structuredClone(game);
    const quote = quoteBuildPlan(game, kind, points);
    assert.equal(quote.ok, true); assert.equal(quote.span, span);
    assert.equal(quote.cost, constructionCost(game, kind, 20, 20));
    assert.deepEqual(game, before, 'the complete-site quote is read-only');
    const edge = quoteBuildPlan(game, kind, [{ x: game.width - span + 1, y: 20 }]);
    assert.equal(edge.ok, false, 'a partly out-of-map site cannot be offered');
    const corner = tileAt(game, 20 + span - 1, 20 + span - 1);
    corner.road = true;
    const blocked = quoteBuildPlan(game, kind, points);
    assert.equal(blocked.ok, false, 'an occupied far corner prevents the whole placement');
    const balance = game.money;
    assert.equal(buildPlan(game, kind, points).ok, false);
    assert.equal(game.money, balance, 'a rejected site never takes payment');
    corner.road = false;
    const built = buildPlan(game, kind, points);
    assert.equal(built.ok, true); assert.equal(built.built, 1); assert.equal(built.cost, quote.cost);
  }
});

test('a bulldozer drag crossing one large building bills and demolishes one complete site', () => {
  for (const kind of ['hospital', 'stadium', 'steel-mill']) {
    const game = emptyGame(); assert.equal(build(game, kind, 20, 20).ok, true);
    const points = [{ x: 21, y: 21 }, { x: 20, y: 21 }, { x: 20, y: 20 }, { x: 21, y: 20 }];
    const quote = quoteBuildPlan(game, 'bulldoze', points), money = game.money;
    assert.equal(quote.placements.length, 1);
    assert.equal(quote.cost, constructionCost(game, 'bulldoze', 20, 20));
    const cleared = buildPlan(game, 'bulldoze', points);
    assert.equal(cleared.ok, true); assert.equal(cleared.built, 1); assert.equal(cleared.failed, 0);
    assert.equal(cleared.cost, quote.cost); assert.equal(game.money, money - quote.cost);
    assert.equal(tileAt(game, 20, 20).building, null); assert.equal(game.industries.length, 0);
    assert.equal(build(game, 'road', 21, 21).ok, true, 'covered cells are released with the anchor');
  }
});

test('a bulldozer drag across a grove or outcrop quotes and clears the whole parcel once', () => {
  for (const kind of ['forest', 'rock']) for (const span of [2, 3]) {
    const game = emptyGame(), x = 20, y = 20, points = [];
    for (let dy = -1; dy <= span; dy++) for (let dx = -1; dx <= span; dx++) tileAt(game, x + dx, y + dy).elevation = 6 / 16;
    for (let dy = 0; dy < span; dy++) for (let dx = 0; dx < span; dx++) {
      Object.assign(tileAt(game, x + dx, y + dy), { terrain: kind, detail: kind === 'forest' ? 'pine' : 'boulders' });
      points.push({ x: x + dx, y: y + dy });
    }
    tileAt(game, x, y).terrainObject = { kind, detail: kind === 'forest' ? 'pine' : 'boulders', variant: 3, footprint: span };
    const before = structuredClone(game), quote = quoteBuildPlan(game, 'bulldoze', points.toReversed());
    assert.deepEqual(game, before, 'hovering a child cell never changes the parcel');
    assert.equal(quote.placements.length, 1);
    assert.deepEqual({ x: quote.placements[0].x, y: quote.placements[0].y }, { x, y });
    assert.equal(quote.cost, constructionCost(game, 'bulldoze', x, y));
    const result = buildPlan(game, 'bulldoze', points.toReversed());
    assert.equal(result.ok, true); assert.equal(result.built, 1); assert.equal(result.failed, 0);
    assert.equal(result.cost, quote.cost); assert.equal(game.money, before.money - quote.cost);
    for (const point of points) {
      const tile = tileAt(game, point.x, point.y);
      assert.equal(tile.terrain, 'grass'); assert.equal(tile.detail, ''); assert.equal(tile.terrainObject, undefined);
      assert.equal(tile.elevation, 6 / 16, 'clearing scenery leaves the landscape height intact');
    }
  }
});
