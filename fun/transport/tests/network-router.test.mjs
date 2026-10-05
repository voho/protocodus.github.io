import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, buildProblem, findPath, build, addRoute, tick, STATION_RADIUS } from '../model.js';
import { buildPlan, quoteBuildPlan } from '../construction-plan.js';
import { planNetworkStroke, planConnection, gridLine } from '../network-router.js';
import { networkTerrainShape } from '../terrain-engineering.js';
import { placeBuildingSite } from '../building-sites.js';
import { industryDistance } from '../industry-sites.js';
import { nextProject } from '../gameplay-insights.js';
import { emptyGame, tileAt, advance } from './helpers.mjs';

function levels(surface) {
  const game = emptyGame();
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) tileAt(game, x, y).elevation = surface(x, y) / 7;
  game.revision++;
  return game;
}
const flat = () => levels(() => 4);
const zone = (game, points) => { for (const [x, y] of points) tileAt(game, x, y).zone = 'residential'; game.revision++; };
const ring = ({ x, y }) => [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]].map(([dx, dy]) => [x + dx, y + dy]);
const contiguous = path => path.every((p, i) => !i || Math.abs(p.x - path[i - 1].x) + Math.abs(p.y - path[i - 1].y) === 1);
const clean = quote => quote.ok && !quote.issues.length && !quote.blocked;
// Reason tests lift the time budget so a busy machine cannot turn a route into a fallback.
const route = (game, mode, a, b) => planNetworkStroke(game, mode, a, b, { budgetMs: 1e9 });

// Build a copy: the whole route connects and costs exactly its quote.
function assertBuilds(game, mode, plan, a, b) {
  const copy = structuredClone(game), quote = quoteBuildPlan(copy, mode, plan.path), money = copy.money, result = buildPlan(copy, mode, plan.path);
  assert.equal(result.ok, true, result.message);
  assert.equal(money - copy.money, quote.cost, 'the release spends exactly the quote');
  assert.ok(findPath(copy, a, b, mode), 'the built stroke connects both ends');
}

test('gridLine keeps the longer axis first unless the first axis is named', () => {
  const a = { x: 10, y: 10 }, b = { x: 13, y: 12 };
  assert.deepEqual(gridLine(a, b).map(p => `${p.x},${p.y}`), ['10,10', '11,10', '12,10', '13,10', '13,11', '13,12']);
  assert.deepEqual(gridLine(a, b, 'y').map(p => `${p.x},${p.y}`), ['10,10', '10,11', '10,12', '11,12', '12,12', '13,12']);
  assert.deepEqual(gridLine(a, { x: 11, y: 14 }).slice(0, 2), [a, { x: 10, y: 11 }]);
  assert.deepEqual(gridLine(a, a), [a]);
});

for (const mode of ['road', 'rail']) {
  test(`${mode}: a clean flat L is returned unchanged`, () => {
    const game = flat(), a = { x: 10, y: 10 }, b = { x: 24, y: 17 };
    assert.deepEqual(route(game, mode, a, b), { path: gridLine(a, b), reason: 'direct', expanded: 0 });
    game.money = 0;
    assert.equal(route(game, mode, a, b).reason, 'direct', 'funds never reshape a drag');
  });

  test(`${mode}: the other bend is used when only it builds`, () => {
    const game = flat(), a = { x: 10, y: 10 }, b = { x: 24, y: 17 };
    zone(game, [[20, 10]]);
    const plan = route(game, mode, a, b);
    assert.equal(plan.reason, 'flipped');
    assert.deepEqual(plan.path, gridLine(a, b, 'y'));
  });

  test(`${mode}: a crown or a 2×2 house on the line makes the drag detour with a clean quote`, () => {
    const crown = levels((x, y) => x === 20 && y === 20 ? 5 : 4), house = flat();
    assert.ok(placeBuildingSite(house, 'house-expensive-1', 19, 19));
    assert.equal(networkTerrainShape(crown, 20, 20).kind, 'complex');
    for (const game of [crown, house]) {
      const a = { x: 12, y: 20 }, b = { x: 28, y: 20 }, line = gridLine(a, b);
      assert.equal(quoteBuildPlan(game, mode, line).ok, false);
      const plan = route(game, mode, a, b), quote = quoteBuildPlan(game, mode, plan.path);
      assert.equal(plan.reason, 'routed');
      assert.ok(clean(quote), quote.message); assert.deepEqual(quote.issues, []);
      assert.deepEqual(plan.path[0], a); assert.deepEqual(plan.path.at(-1), b); assert.ok(contiguous(plan.path));
      assert.ok(plan.path.every(p => p.y !== 20 || p.x < 19 || p.x > 20), 'the path leaves the blocked tiles');
      assert.ok(plan.path.length <= line.length + 2, `a short detour: ${plan.path.length} tiles`);
      assertBuilds(game, mode, plan, a, b);
    }
  });

  test(`${mode}: ramps are entered and left only along their axis`, () => {
    const game = levels(x => 4 + Math.max(0, Math.min(2, x - 20))), a = { x: 21, y: 10 }, b = { x: 21, y: 24 };
    assert.equal(networkTerrainShape(game, 21, 16).axis, 'x');
    assert.equal(quoteBuildPlan(game, mode, gridLine(a, b)).ok, false, 'a straight drag would climb sideways');
    const plan = route(game, mode, a, b);
    assert.equal(plan.reason, 'routed'); assert.ok(clean(quoteBuildPlan(game, mode, plan.path)));
    let ramps = 0;
    for (const [i, p] of plan.path.entries()) {
      if (networkTerrainShape(game, p.x, p.y).kind !== 'incline') continue;
      ramps++;
      for (const q of [plan.path[i - 1], plan.path[i + 1]]) if (q) assert.equal(q.y, p.y, `${p.x},${p.y} is used along its x axis`);
    }
    assert.ok(ramps >= 2, 'both ends sit on the ramp');
    assertBuilds(game, mode, plan, a, b);
  });

  test(`${mode}: a ramp beside an older parallel line is avoided`, () => {
    const game = levels((x, y) => 4 + Math.max(0, Math.min(2, y - 20))), a = { x: 21, y: 14 }, b = { x: 21, y: 27 };
    for (let y = 19; y <= 22; y++) tileAt(game, 20, y)[mode] = true;
    game.networkRevision++;
    assert.deepEqual(quoteBuildPlan(game, mode, gridLine(a, b)).issues.map(issue => issue.kind), ['sideways', 'sideways']);
    const plan = route(game, mode, a, b);
    assert.equal(plan.reason, 'routed'); assert.ok(clean(quoteBuildPlan(game, mode, plan.path)));
    assert.ok(!plan.path.some(p => p.x === 21 && (p.y === 20 || p.y === 21)), 'no new ramp touches the old line from the side');
    assertBuilds(game, mode, plan, a, b);
  });

  test(`${mode}: an existing line is reused at $0`, () => {
    const game = flat(), a = { x: 10, y: 20 }, b = { x: 30, y: 20 };
    zone(game, Array.from({ length: game.height }, (_, y) => [20, y]).filter(([, y]) => y !== 24));
    for (let x = 15; x <= 25; x++) tileAt(game, x, 24)[mode] = true;
    game.networkRevision++;
    const plan = route(game, mode, a, b), quote = quoteBuildPlan(game, mode, plan.path);
    assert.equal(plan.reason, 'routed'); assert.ok(clean(quote));
    const reused = quote.placements.filter(p => tileAt(game, p.x, p.y)[mode]);
    assert.ok(reused.length >= 3, 'the path follows the old line through the gap');
    assert.ok(reused.every(p => p.state === 'built' && p.cost === 0));
    assert.equal(quote.cost, quote.placements.filter(p => p.state === 'ok').reduce((sum, p) => sum + p.cost, 0));
    assertBuilds(game, mode, plan, a, b);
  });

  test(`${mode}: identical inputs give identical paths`, () => {
    const game = levels((x, y) => x === 20 && y === 20 ? 5 : 4), a = { x: 12, y: 20 }, b = { x: 28, y: 23 };
    zone(game, [[12, 22]]);
    const copy = structuredClone(game), first = route(game, mode, a, b);
    assert.equal(first.reason, 'routed');
    assert.deepEqual(route(game, mode, a, b), first);
    assert.deepEqual(route(copy, mode, a, b), first);
  });

  test(`${mode}: an unreachable end falls back to the failing L`, () => {
    const game = flat(), a = { x: 10, y: 10 }, b = { x: 22, y: 16 };
    zone(game, ring(b));
    const plan = route(game, mode, a, b);
    assert.equal(plan.reason, 'fallback'); assert.deepEqual(plan.path, gridLine(a, b));
    assert.equal(quoteBuildPlan(game, mode, plan.path).ok, false, 'the red L still explains the refusal');
  });

  test(`${mode}: a wall that forces a long detour is refused as too far`, () => {
    const game = flat(), a = { x: 20, y: 20 }, b = { x: 20, y: 30 };
    zone(game, Array.from({ length: game.width }, (_, x) => [x, 25]).filter(([x]) => x !== 8));
    const plan = route(game, mode, a, b);
    assert.equal(plan.reason, 'too-far'); assert.deepEqual(plan.path, gridLine(a, b));
    zone(game, [[8, 25]]);
    assert.equal(route(game, mode, a, b).reason, 'fallback', 'a closed wall has no route at all');
  });
}

test('a 120-tile drag without a route stays under the expansion cap and the time budget', () => {
  const game = flat(), a = { x: 4, y: 40 }, b = { x: 124, y: 40 };
  zone(game, ring(b));
  const started = performance.now(), plan = planNetworkStroke(game, 'road', a, b), elapsed = performance.now() - started;
  assert.equal(plan.reason, 'fallback'); assert.ok(plan.expanded > 0 && plan.expanded <= 40000, `${plan.expanded} expansions`);
  assert.ok(elapsed < 60, `${elapsed.toFixed(1)} ms`);
  assert.equal(planNetworkStroke(game, 'road', a, b, { maxExpanded: 300, budgetMs: 1e9 }).expanded, 300, 'the cap stops the search exactly');
  assert.ok(planNetworkStroke(game, 'road', a, b, { budgetMs: 0 }).expanded <= 128, 'a spent budget stops at the next check');
});

test('taiga 1847: most drags whose two L bends both fail are rescued quickly', () => {
  const game = createGame({ biome: 'taiga', seed: 1847 });
  const open = (x, y) => !buildProblem(game, 'road', x, y, { money: Infinity }) && networkTerrainShape(game, x, y).kind === 'flat';
  let seed = 1847, tries = 0, rescued = 0;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32, times = [];
  for (let found = 0; found < 40 && tries++ < 5000;) {
    const a = { x: 20 + Math.floor(random() * (game.width - 40)), y: 20 + Math.floor(random() * (game.height - 40)) }, reach = 8 + Math.floor(random() * 15), angle = random() * Math.PI * 2;
    const b = { x: a.x + Math.round(Math.cos(angle) * reach), y: a.y + Math.round(Math.sin(angle) * reach) };
    if (!open(a.x, a.y) || !open(b.x, b.y) || ['direct', 'flipped'].includes(planNetworkStroke(game, 'road', a, b, { maxExpanded: 0 }).reason)) continue;
    found++;
    const plan = route(game, 'road', a, b);
    if (plan.reason === 'routed') { rescued++; assert.ok(clean(quoteBuildPlan(game, 'road', plan.path)), `${a.x},${a.y} → ${b.x},${b.y}`); }
    const started = performance.now(); planNetworkStroke(game, 'road', a, b); times.push(performance.now() - started);
  }
  assert.equal(times.length, 40, 'the sample finds 40 drags whose two bends fail');
  assert.ok(rescued >= 30, `${rescued} of 40 rescued`);
  const p95 = times.sort((x, y) => x - y)[Math.floor(times.length * .95)];
  assert.ok(p95 < 15, `p95 ${p95.toFixed(2)} ms`);
});

// The first-route planner builds exactly what it quotes: the line, its new stops, then a service between them.
const connect = (game, source, target, mode = 'road') => planConnection(game, source, target, mode, { budgetMs: 1e9 });
const inReach = (site, stop) => industryDistance(site, stop) > 0 && industryDistance(site, stop) <= STATION_RADIUS;
function launch(game, plan, cargo) {
  const copy = structuredClone(game), money = copy.money, ids = plan.ends.map(stop => stop?.id);
  assert.equal(buildPlan(copy, plan.mode, plan.path).ok, true, 'the line builds');
  for (const stop of plan.stops) { const built = build(copy, plan.mode === 'rail' ? 'train-stop' : 'bus-stop', stop.x, stop.y); assert.equal(built.ok, true, built.message); ids[stop.end] = built.station.id; }
  const route = addRoute(copy, { mode: plan.mode, stops: ids, cargo });
  assert.equal(route.ok, true, route.message);
  return { copy, route: route.route, spent: money - copy.money - route.cost };
}
const farmAndPlant = (game, plant = { x: 38, y: 26 }) => [build(game, 'farm', 20, 20).industry, build(game, 'food-plant', plant.x, plant.y).industry];

// Recipe 7 pins its known quarry; the default recipe is checked below without coordinates.
test('taiga 1847 recipe 7: the quarry plan joins Alderbrook Central with one stop beside the quarry', () => {
  const game = createGame({ biome: 'taiga', seed: 1847, generationVersion: 7 }), quarry = game.industries.find(site => site.kind === 'quarry' && site.x === 217 && site.y === 255), town = game.cities.find(city => city.name === 'Alderbrook');
  const plan = connect(game, quarry, town);
  assert.equal(plan.ok, true, plan.reason);
  assert.ok(clean(quoteBuildPlan(game, 'road', plan.path)), 'the whole line quotes clean'); assert.ok(contiguous(plan.path));
  assert.equal(plan.ends[0], null); assert.equal(plan.ends[1]?.id, 'station-1', 'Alderbrook Central already serves the town');
  assert.equal(plan.stops.length, 1, 'one new stop');
  assert.deepEqual([plan.stops[0].x, plan.stops[0].y, plan.stops[0].end], [plan.path[0].x, plan.path[0].y, 0]);
  assert.ok(inReach(quarry, plan.stops[0]), 'the stop loads at the quarry');
  assert.ok(plan.tiles > 0 && plan.tiles <= plan.path.length && plan.vehicleCost > 0);
  const { copy, route, spent } = launch(game, plan, 'stone');
  assert.equal(spent, plan.cost, 'Build spends exactly the plan');
  advance(copy, 30, tick);
  assert.ok(route.delivered > 0, 'stone reaches Alderbrook within a month');
  assert.deepEqual(connect(game, quarry, town), plan, 'identical inputs give identical plans');
});

for (const biome of ['taiga', 'tundra', 'desert']) test(`${biome} 1847: the default world's first freight plan builds and delivers within a month`, () => {
  const game = createGame({ biome, seed: 1847 }), project = nextProject(game), choice = project.choices[project.choice];
  assert.equal(project.plan, 'road', 'the opening pair can be joined over land');
  const plan = connect(game, choice.source, choice.buyer);
  assert.equal(plan.ok, true, plan.reason);
  assert.ok(clean(quoteBuildPlan(game, 'road', plan.path)), 'the whole line quotes clean'); assert.ok(contiguous(plan.path));
  assert.ok(plan.stops.length <= 2 && plan.stops.every(stop => game.tiles[stop.y * game.width + stop.x].terrain !== 'water'));
  const { copy, route, spent } = launch(game, plan, choice.cargo);
  assert.equal(spent, plan.cost, 'Build spends exactly the plan');
  advance(copy, 30, tick);
  assert.ok(route.delivered > 0, `${choice.cargo} arrives within a month`);
});

for (const mode of ['road', 'rail']) test(`${mode}: a plan between two unserved sites places a stop beside each, then finds them joined`, () => {
  const game = flat(), [farm, plant] = farmAndPlant(game), plan = connect(game, farm, plant, mode);
  assert.equal(plan.ok, true, plan.reason); assert.deepEqual(plan.ends, [null, null]);
  assert.deepEqual(plan.stops.map(stop => stop.end), [0, 1]);
  assert.ok(inReach(farm, plan.stops[0]) && inReach(plant, plan.stops[1]), 'each stop serves its own site');
  assert.ok(clean(quoteBuildPlan(game, mode, plan.path))); assert.equal(plan.tiles, plan.path.length);
  const { copy, route, spent } = launch(game, plan, 'grain');
  assert.equal(spent, plan.cost);
  const joined = connect(copy, ...copy.industries, mode);
  assert.deepEqual([joined.tiles, joined.stops, joined.cost], [0, [], 0], 'nothing is left to build');
  assert.deepEqual(joined.ends.map(stop => stop.id), route.stops);
});

test('a stop that already serves the source is reused and its line followed', () => {
  const game = flat(), [farm, plant] = farmAndPlant(game);
  assert.equal(buildPlan(game, 'road', gridLine({ x: 23, y: 21 }, { x: 28, y: 21 })).ok, true);
  const stop = build(game, 'bus-stop', 23, 21).station, plan = connect(game, farm, plant);
  assert.equal(plan.ends[0]?.id, stop.id); assert.deepEqual(plan.stops.map(stop => stop.end), [1]);
  assert.ok(plan.tiles <= plan.path.length - 6, 'the old road carries the first tiles');
  launch(game, plan, 'grain');
});

test('sites whose catchments overlap still get stops three tiles apart', () => {
  const game = flat(), [farm, plant] = farmAndPlant(game, { x: 23, y: 20 }), plan = connect(game, farm, plant);
  assert.equal(plan.ok, true, plan.reason); assert.ok(plan.path.length >= 3);
  launch(game, plan, 'grain');
});

test('a walled-off buyer or a boxed-in producer has no plan', () => {
  const game = flat(), [farm, plant] = farmAndPlant(game);
  zone(game, Array.from({ length: game.height }, (_, y) => [30, y]));
  assert.deepEqual([connect(game, farm, plant).ok, connect(game, farm, plant).reason], [false, 'no-route']);
  const boxed = flat(), [site, buyer] = farmAndPlant(boxed), cells = [];
  for (let y = 14; y <= 27; y++) for (let x = 14; x <= 27; x++) if (x < 20 || x > 21 || y < 20 || y > 21) cells.push([x, y]);
  zone(boxed, cells);
  assert.equal(connect(boxed, site, buyer).reason, 'no-site');
});
