import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, findPath } from '../model.js';
import { emptyGame, tileAt, line } from './helpers.mjs';

test('construction deducts cash once per tile and rejects unaffordable work', () => {
  const game = emptyGame();
  const start = game.money;
  assert.equal(build(game, 'road', 10, 10).ok, true);
  const cost = start - game.money;
  assert.ok(cost > 0);
  build(game, 'road', 10, 10);
  assert.equal(game.money, start - cost, 'rebuilding existing infrastructure is free');
  assert.equal(buildPath(game, 'road', [{ x: 11, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }]).ok, true);
  assert.equal(game.money, start - cost * 3, 'drag paths deduplicate repeated tiles');
  game.money = 0;
  assert.equal(build(game, 'road', 13, 10).ok, false);
  assert.equal(tileAt(game, 13, 10).road, false);
  assert.equal(game.money, 0);
});

test('invalid coordinates and tool names cannot alter terrain or cash', () => {
  const game = emptyGame();
  const before = game.money;
  for (const [tool, x, y] of [['road', -1, 8], ['road', game.width, 8], ['rail', 8, game.height], ['road', NaN, 0], ['unknown-tool', 10, 10], ['toString', 10, 10], ['__proto__', 10, 10]]) {
    assert.equal(build(game, tool, x, y).ok, false);
  }
  assert.equal(game.money, before);
  assert.equal(tileAt(game, 10, 10).road, false);
});

for (const mode of ['road', 'rail']) {
  const bridgeTool = mode === 'road' ? 'bridge' : 'railbridge';
  const tunnelTool = mode === 'road' ? 'tunnel' : 'railtunnel';
  test(`${mode} routes require continuous infrastructure, including bridges and tunnels`, () => {
    const game = emptyGame();
    const from = { x: 10, y: 10 }, to = { x: 16, y: 10 };
    tileAt(game, 12, 10).terrain = 'water';
    tileAt(game, 14, 10).terrain = 'mountain';
    assert.equal(build(game, mode, 12, 10).ok, false, 'ordinary track cannot cross water');
    assert.equal(build(game, mode, 14, 10).ok, false, 'ordinary track cannot cross mountains');
    for (const x of [10, 11, 13, 15, 16]) assert.equal(build(game, mode, x, 10).ok, true);
    assert.equal(findPath(game, from, to, mode), null);
    assert.equal(build(game, bridgeTool, 12, 10).ok, true);
    assert.equal(findPath(game, from, to, mode), null, 'a remaining tunnel gap still disconnects the line');
    assert.equal(build(game, tunnelTool, 14, 10).ok, true);
    const path = findPath(game, from, to, mode);
    assert.ok(path && path.length >= 7);
    for (let i = 1; i < path.length; i++) {
      assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y), 1);
    }
    assert.equal(findPath(game, from, to, mode === 'road' ? 'rail' : 'road'), null, 'transport modes use their own networks');
    assert.equal(build(game, 'bulldoze', 13, 10).ok, true);
    assert.equal(findPath(game, from, to, mode), null, 'demolition immediately invalidates a cached route path');
  });
}

test('road and rail crossings retain both networks', () => {
  const game = emptyGame();
  assert.equal(buildPath(game, 'road', line(10, 14, 10)).ok, true);
  assert.equal(buildPath(game, 'rail', [8, 9, 10, 11, 12].map(y => ({ x: 12, y }))).ok, true);
  assert.equal(tileAt(game, 12, 10).road, true);
  assert.equal(tileAt(game, 12, 10).rail, true);
  assert.ok(findPath(game, { x: 10, y: 10 }, { x: 14, y: 10 }, 'road'));
  assert.ok(findPath(game, { x: 12, y: 8 }, { x: 12, y: 12 }, 'rail'));
});
