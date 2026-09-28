import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildTool, quoteBuildPlan, buildPlan, zonePlanPoints } from '../construction-plan.js';
import { hasRoadAccess } from '../environment.js';
import { build, buildProblem, constructionCost, findPath } from '../model.js';
import { routeTileIndex } from '../route-tiles.js';
import { emptyGame, tileAt, line } from './helpers.mjs';

for (const mode of ['road', 'rail']) {
  test(`${mode} gestures automatically bridge water and tunnel mountains at the quoted inflated cost`, () => {
    const game = emptyGame(); game.day = 730;
    for (let y=0;y<game.height;y++) Object.assign(tileAt(game,12,y),{terrain:'water',elevation:0}); // Straight banks have an aligned grade.
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

// Policy: a gapped road is useless, so Road and Rail strokes are all-or-nothing.
test('a road through a house with too little money builds nothing and marks each problem tile', () => {
  const game = emptyGame(); game.day = 365;
  tileAt(game, 12, 10).building = { kind: 'house-cheap-1', level: 1 };
  const roadCost = constructionCost(game, 'road', 10, 10); game.money = roadCost * 2;
  const before = structuredClone(game), quote = quoteBuildPlan(game, 'road', line(10, 14, 10));
  assert.equal(quote.ok, false);
  assert.deepEqual(quote.placements.map(p => p.state), ['ok', 'ok', 'blocked', 'funds', 'funds']);
  assert.match(quote.placements[2].problem, /Clear the building/);
  assert.equal(quote.blocked, 1); assert.equal(quote.unaffordable, 2); assert.equal(quote.buildable, 2); assert.deepEqual(quote.issues, []);
  assert.equal(quote.cost, roadCost * 4, 'the blocked tile is not priced');
  assert.equal(quote.message, 'Clear the building or zone before building a connection.');
  const result = buildPlan(game, 'road', line(10, 14, 10));
  assert.equal(result.ok, false); assert.equal(result.cost, 0); assert.equal(result.built, 0); assert.equal(result.failed, 5);
  assert.deepEqual(game, before, 'a refused stroke leaves no road stub and takes no money');
  tileAt(game, 13, 10).building = { kind: 'house-cheap-1', level: 1 };
  assert.equal(quoteBuildPlan(game, 'road', line(10, 14, 10)).message, '2 tiles are blocked by buildings or zones — drag around them or bulldoze first');
  const railCost = constructionCost(game, 'rail', 10, 11); game.money = railCost * 2;
  const short = quoteBuildPlan(game, 'rail', line(10, 14, 11));
  assert.equal(short.ok, false); assert.deepEqual(short.placements.map(p => p.state), ['ok', 'ok', 'funds', 'funds', 'funds']);
  assert.equal(short.message, `Need $${(railCost * 5).toLocaleString('en-US')} · balance $${game.money.toLocaleString('en-US')}`);
  assert.equal(buildPlan(game, 'rail', line(10, 14, 11)).ok, false); assert.equal(game.money, railCost * 2);
});

test('a funded stroke that avoids the house builds fully at its quoted price', () => {
  const game = emptyGame(); tileAt(game, 12, 10).building = { kind: 'house-cheap-1', level: 1 };
  const points = [...line(10, 11, 10), ...line(11, 14, 11), { x: 14, y: 10 }], quote = quoteBuildPlan(game, 'road', points), money = game.money;
  assert.equal(quote.ok, true); assert.equal(quote.message, 'Follow flat ground or a straight grade.');
  assert.ok(quote.placements.every(p => p.state === 'ok'));
  const result = buildPlan(game, 'road', points);
  assert.equal(result.ok, true); assert.equal(result.built, 7); assert.equal(result.failed, 0); assert.equal(result.cost, quote.cost); assert.equal(game.money, money - quote.cost);
});

test('existing road plus one house is refused at no cost and names the house', () => {
  const game = emptyGame();
  for (const { x, y } of line(10, 13, 10)) build(game, 'road', x, y);
  tileAt(game, 14, 10).building = { kind: 'house-cheap-1', level: 1 };
  const money = game.money, quote = quoteBuildPlan(game, 'road', line(10, 14, 10));
  assert.equal(quote.ok, false); assert.equal(quote.cost, 0); assert.match(quote.message, /Clear the building/);
  assert.deepEqual(quote.placements.map(p => p.state), ['built', 'built', 'built', 'built', 'blocked']);
  const result = buildPlan(game, 'road', line(10, 14, 10));
  assert.equal(result.ok, false); assert.equal(result.built, 0); assert.equal(result.cost, 0); assert.equal(game.money, money);
});

test('zones and demolition stay partial, but the quote and the result say so', () => {
  const game = emptyGame(), zoneCost = constructionCost(game, 'residential', 10, 10); game.money = zoneCost * 2 + 1;
  const quote = quoteBuildPlan(game, 'residential', line(10, 18, 10));
  assert.equal(quote.ok, true); assert.equal(quote.partial, true); assert.equal(quote.buildable, 2); assert.equal(quote.unaffordable, 7);
  assert.equal(quote.message, 'Builds 2 of 9 · funds for 2');
  const result = buildPlan(game, 'residential', line(10, 18, 10));
  assert.equal(result.ok, true); assert.equal(result.built, 2); assert.equal(result.failed, 7, 'a partial build is reported as a warning, not a success');
  game.money = 1_000_000; tileAt(game, 14, 11).building = { kind: 'house-cheap-1', level: 1 }; build(game, 'industrial', 12, 11);
  const blocked = quoteBuildPlan(game, 'commercial', line(10, 18, 11));
  assert.equal(blocked.partial, true); assert.equal(blocked.message, 'Builds 7 of 8 · 1 blocked', 'the house is left out of the stroke; another zone still blocks');
  const occupied = quoteBuildPlan(game, 'industrial', line(10, 11, 10));
  assert.equal(occupied.ok, false); assert.equal(occupied.message, 'Choose an empty tile or clear this one first.');
  const nothing = buildPlan(game, 'industrial', line(10, 11, 10));
  assert.equal(nothing.ok, false, 'zero built plus a blocker is an error'); assert.equal(nothing.built, 0);
  const served = emptyGame(); build(served, 'road', 20, 20); build(served, 'bus-stop', 20, 20); served.routes.push({ id: 'route-1', name: 'Test freight', stops: [served.stations[0].id] });
  const retire = quoteBuildPlan(served, 'bulldoze', [{ x: 20, y: 20 }]);
  assert.equal(retire.ok, false); assert.equal(retire.message, 'Retire Test freight before removing this road stop.');
  served.routes.push({ id: 'route-2', name: 'Line 1', stops: [served.stations[0].id] });
  assert.equal(quoteBuildPlan(served, 'bulldoze', [{ x: 20, y: 20 }]).message, 'Retire Test freight and Line 1 before removing this road stop.');
  served.routes.push({ id: 'route-3', name: 'Night bus', stops: ['station-9', served.stations[0].id] }, { id: 'route-4', name: 'Elsewhere', stops: ['station-9'] });
  assert.equal(build(served, 'bulldoze', 20, 20).message, 'Retire Test freight, Line 1 and 1 more before removing this road stop.', 'the refusal names the routes that hold the stop');
});

test('single stops, ports and towns quote exactly what build() will say', () => {
  const game = emptyGame();
  const grass = quoteBuildPlan(game, 'stop', [{ x: 10, y: 10 }]);
  assert.equal(grass.ok, false); assert.equal(grass.message, 'Build a road here first.');
  build(game, 'road', 10, 10);
  assert.equal(quoteBuildPlan(game, 'stop', [{ x: 10, y: 10 }]).ok, true);
  assert.equal(quoteBuildPlan(game, 'port', [{ x: 12, y: 12 }]).message, 'Place a port on water directly beside land.');
  build(game, 'city', 30, 30);
  const near = quoteBuildPlan(game, 'city', [{ x: 35, y: 30 }]);
  assert.equal(near.ok, false); assert.equal(near.message, 'Found a new city at least 11 tiles from another center.');
  game.money = 10;
  assert.match(quoteBuildPlan(game, 'city', [{ x: 60, y: 60 }]).message, /^Need \$/);
});

test('route tiles name the running land routes a demolition would cut, and follow rerouting', () => {
  const game = emptyGame(), path = line(10, 14, 10), key = (x, y) => y * game.width + x;
  game.routes.push({ id: 'r1', name: 'Test freight', mode: 'road', active: true, path, stops: [] }, { id: 'r2', name: 'Ferry', mode: 'water', active: true, path, stops: [] }, { id: 'r3', name: 'Idle', mode: 'road', active: false, path, stops: [] });
  assert.deepEqual(routeTileIndex(game).get(key(12, 10)), ['Test freight'], 'ships and disconnected routes are never cut');
  assert.equal(routeTileIndex(game).has(key(12, 11)), false);
  game.routes[0].path = line(10, 14, 11);
  assert.equal(routeTileIndex(game).has(key(12, 10)), false, 'a new path replaces the cached one');
  game.routes = game.routes.slice(1);
  assert.equal(routeTileIndex(game).size, 0);
});

test('buildProblem gives build()’s exact refusal for random tools, tiles and balances', () => {
  const game = emptyGame();
  let seed = 7; const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let y = 20; y <= 26; y++) for (let x = 20; x <= 26; x++) tileAt(game, x, y).elevation = (4 + Math.max(0, x - 22)) / 7;
  for (let x = 8; x <= 40; x++) Object.assign(tileAt(game, x, 14), { terrain: 'water', detail: 'river', elevation: 0 });
  for (const [x, y, terrain] of [[24, 16, 'mountain'], [25, 16, 'rock'], [26, 16, 'forest'], [27, 16, 'sand'], [9, 20, 'forest'], [10, 20, 'forest'], [11, 20, 'rock']]) tileAt(game, x, y).terrain = terrain;
  for (const x of [10, 11, 12, 13]) build(game, 'road', x, 10);
  for (const y of [10, 11, 12]) build(game, 'rail', 15, y);
  for (const x of [16, 17, 18]) build(game, 'residential', x, 18);
  build(game, 'bus-stop', 11, 10); build(game, 'train-stop', 15, 11); build(game, 'house-cheap-1', 20, 10); build(game, 'house-cheap-1', 22, 12); build(game, 'city', 9, 17);
  build(game, 'port', 12, 14); build(game, 'logging-camp', 9, 23); build(game, 'road', 23, 22); game.routes.push({ id: 'route-x', name: 'Test freight', stops: [game.stations[0].id] });
  const tools = ['road', 'rail', 'residential', 'commercial', 'industrial', 'bulldoze', 'bus-stop', 'port', 'city'];
  const obstacles = [[11, 10], [15, 11], [9, 17], [12, 14], [13, 14], [20, 10], [16, 18], [9, 23], [10, 24], [23, 22], [24, 22], [24, 16], [25, 16], [15, 12]];
  for (let n = 0; n < 500; n++) {
    const tool = tools[Math.floor(random() * tools.length)], [x, y] = n % 3 ? [8 + Math.floor(random() * 20), 8 + Math.floor(random() * 20)] : obstacles[Math.floor(random() * obstacles.length)];
    game.money = [0, 150, 1e6][Math.floor(random() * 3)];
    // A predicted refusal must leave the world untouched, so only a predicted success needs a copy.
    const problem = buildProblem(game, tool, x, y), built = build(problem ? game : structuredClone(game), tool, x, y);
    assert.equal(problem?.message, built.ok ? undefined : built.message, `${tool} at ${x},${y} with $${game.money}`);
  }
});

test('the quote predicts exactly what a random drag builds, refuses and charges', () => {
  const game = emptyGame();
  let seed = 3; const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), pick = list => list[Math.floor(random() * list.length)];
  for (let y = 22; y <= 30; y++) for (let x = 22; x <= 30; x++) tileAt(game, x, y).elevation = (4 + Math.max(0, Math.min(2, x - 25)) + (x === 24 && y === 26 ? 1 : 0)) / 7;
  for (let y = 8; y <= 36; y++) tileAt(game, 18, y).terrain = 'water';
  for (let n = 0; n < 40; n++) build(game, pick(['house-cheap-1', 'residential', 'road', 'rail']), 8 + Math.floor(random() * 28), 8 + Math.floor(random() * 28));
  for (let n = 0; n < 12; n++) Object.assign(tileAt(game, 8 + Math.floor(random() * 28), 8 + Math.floor(random() * 28)), { terrain: pick(['forest', 'rock', 'mountain']) });
  build(game, 'road', 12, 12); build(game, 'bus-stop', 12, 12); game.routes.push({ id: 'route-x', name: 'Test freight', stops: [game.stations[0].id] });
  for (let n = 0; n < 150; n++) {
    const tool = pick(['road', 'rail', 'residential', 'commercial', 'industrial', 'bulldoze']), a = { x: 8 + Math.floor(random() * 28), y: 8 + Math.floor(random() * 28) }, b = { x: 8 + Math.floor(random() * 28), y: a.y + Math.floor(random() * 7) - 3 };
    const points = [...line(Math.min(a.x, b.x), Math.max(a.x, b.x), a.y), ...Array.from({ length: Math.abs(b.y - a.y) }, (_, i) => ({ x: b.x, y: a.y + Math.sign(b.y - a.y) * (i + 1) }))];
    game.money = pick([0, 500, 3000, 1e6]);
    const quote = quoteBuildPlan(game, tool, points), result = buildPlan(structuredClone(game), tool, points), ok = quote.placements.filter(p => p.state === 'ok');
    const label = `${tool} ${JSON.stringify(a)}→${JSON.stringify(b)} with $${game.money}: ${quote.message} / ${result.message}`;
    if (tool === 'road' || tool === 'rail') {
      assert.equal(result.built, quote.ok ? ok.length : 0, label); assert.equal(result.cost, quote.ok ? quote.cost : 0, label);
      if (quote.ok) assert.equal(result.failed, 0, label);
    } else {
      assert.equal(result.built, quote.buildable, label); assert.equal(result.failed, quote.blocked + quote.unaffordable, label);
      assert.equal(result.cost, ok.reduce((sum, p) => sum + p.cost, 0), label);
    }
  }
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

const rect = (x1, y1, x2, y2) => Array.from({ length: (y2 - y1 + 1) * (x2 - x1 + 1) }, (_, i) => ({ x: x1 + i % (x2 - x1 + 1), y: y1 + Math.floor(i / (x2 - x1 + 1)) }));

test('a zone rectangle across a street leaves the road out and zones both sides with road access', () => {
  const game = emptyGame();
  for (let x = 8; x <= 16; x++) build(game, 'road', x, 10);
  const roads = structuredClone(line(8, 16, 10).map(p => tileAt(game, p.x, p.y))), points = rect(10, 9, 14, 11), before = structuredClone(game);
  const quote = quoteBuildPlan(game, 'residential', points);
  assert.deepEqual(game, before, 'the quote is read-only');
  assert.equal(quote.placements.length, 10); assert.ok(quote.placements.every(p => p.y !== 10), 'the five road tiles are left out');
  assert.equal(quote.ok, true); assert.equal(quote.blocked, 0); assert.equal(quote.partial, false); assert.equal(quote.needRoad, 0);
  const result = buildPlan(game, 'residential', points);
  assert.equal(result.ok, true); assert.equal(result.built, 10); assert.equal(result.failed, 0); assert.equal(result.cost, quote.cost);
  assert.equal(game.money, before.money - quote.cost); assert.equal(game.zones.length, 10);
  for (const x of [10, 14]) { assert.equal(tileAt(game, x, 9).zone, 'residential'); assert.equal(tileAt(game, x, 11).zone, 'residential'); }
  assert.deepEqual(line(8, 16, 10).map(p => tileAt(game, p.x, p.y)), roads, 'the street is unchanged');
  const again = quoteBuildPlan(game, 'residential', points);
  assert.equal(again.ok, false, 'a rectangle of only road and the same zone keeps build()’s refusal'); assert.equal(again.cost, 0);
  const commercial = quoteBuildPlan(game, 'commercial', rect(9, 9, 15, 11));
  assert.equal(commercial.placements.length, 14); assert.equal(commercial.blocked, 10); assert.equal(commercial.buildable, 4, 'other zones stay in the plan as blocked tiles');
});

test('a zone block beside one road counts the tiles no road reaches', () => {
  const game = emptyGame();
  for (let x = 8; x <= 17; x++) build(game, 'road', x, 9);
  const quote = quoteBuildPlan(game, 'industrial', rect(10, 10, 15, 15));
  assert.equal(quote.placements.length, 36); assert.equal(quote.ok, true); assert.equal(quote.needRoad, 30);
  assert.deepEqual(quote.placements.filter(p => p.needsRoad).map(p => p.y).sort(), Array(30).fill(0).map((_, i) => 11 + Math.floor(i / 6)), 'only the row beside the road has access');
  assert.equal(hasRoadAccess(game, 12, 10), true); assert.equal(hasRoadAccess(game, 12, 11), false);
  tileAt(game, 30, 30).rail = true;
  assert.equal(hasRoadAccess(game, 30, 31), false, 'a railway is not a road for zone growth');
  game.money = constructionCost(game, 'industrial', 10, 10) * 2;
  const short = quoteBuildPlan(game, 'industrial', rect(10, 10, 15, 15));
  assert.equal(short.needRoad, 30, 'unaffordable tiles still say whether they would reach a road'); assert.equal(short.unaffordable, 34);
  assert.equal(quoteBuildPlan(emptyGame(), 'residential', [{ x: 20, y: 20 }]).needRoad, 1, 'a single hovered tile says so too');
  assert.equal(quoteBuildPlan(game, 'road', line(20, 24, 20)).needRoad, undefined);
});

test('zonePlanPoints drops what a zone can never claim and keeps other zones for the quote to refuse', () => {
  const game = emptyGame();
  build(game, 'road', 10, 10); build(game, 'bus-stop', 10, 10); build(game, 'road', 11, 10); build(game, 'rail', 12, 10); build(game, 'city', 13, 10);
  build(game, 'house-cheap-1', 14, 10); build(game, 'logging-camp', 15, 10); build(game, 'residential', 20, 10); build(game, 'commercial', 21, 10);
  Object.assign(tileAt(game, 22, 10), { terrain: 'water' }); Object.assign(tileAt(game, 23, 10), { terrain: 'mountain' }); Object.assign(tileAt(game, 24, 10), { terrain: 'forest' });
  const kept = zonePlanPoints(game, 'residential', [...line(10, 25, 10), { x: 25, y: 10 }, { x: -1, y: 10 }]).map(p => p.x);
  assert.deepEqual(kept, [17, 18, 19, 21, 24, 25], 'roads, a stop, rail, a town center, a house, an industry, the same zone, water and mountains are left out');
  assert.equal(zonePlanPoints(game, 'commercial', [{ x: 20, y: 10 }, { x: 21, y: 10 }]).length, 1);
  assert.equal(quoteBuildPlan(game, 'residential', [{ x: 11, y: 10 }]).message, 'Choose an empty tile or clear this one first.', 'one clicked tile still gets build()’s own refusal');
});

test('a demolition stroke passes over empty ground and counts only what it clears', () => {
  const game = emptyGame();
  for (const x of [10, 11, 12]) build(game, 'road', x, 10);
  build(game, 'house-cheap-1', 14, 11); build(game, 'residential', 15, 12);
  const points = rect(9, 9, 16, 13), quote = quoteBuildPlan(game, 'bulldoze', points);
  assert.deepEqual(quote.placements.map(p => `${p.x},${p.y}`), ['10,10', '11,10', '12,10', '14,11', '15,12']);
  assert.equal(quote.ok, true); assert.equal(quote.partial, false); assert.equal(quote.blocked, 0);
  const result = buildPlan(game, 'bulldoze', points);
  assert.equal(result.built, 5); assert.equal(result.failed, 0); assert.equal(result.cost, quote.cost); assert.doesNotMatch(result.message, /skipped/);
  const empty = quoteBuildPlan(game, 'bulldoze', points);
  assert.equal(empty.ok, false); assert.equal(empty.message, 'There is nothing to demolish here.', 'empty ground alone still says so');
});
