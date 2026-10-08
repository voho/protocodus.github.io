import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, buildProblem, addRoute, tick, fareFor, payTiles, priceFor, stationCoverage, validateGame, restoreGame, drainDeliveryEvents, expandWorkshop, freightFits } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { placeBuildingSite, buildingAt } from '../building-sites.js';
import { settlementSuitability, workshopAnchor } from '../settlements.js';
import { WORKSHOP, WORKSHOP_RECIPES } from '../data.js';
import { townLedger, workshopLevels, workshopInputs, workshopOutputs, workshopRecipes } from '../town-market.js';
import { validateRoutePlan, forecastRoute } from '../route-planner.js';
import { routeHealth } from '../gameplay-insights.js';
import { openingSiteProblem } from '../industry-openings.js';
import { completeFixtureConstruction, emptyGame, tileAt, line, advance, equivalent, twoTownFixture } from './helpers.mjs';

const zoneMap = game => new Map(game.zones.map(zone => [zone.y * game.width + zone.x, zone]));
const clone = game => restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
const town = (game, x, y, id = `town-${game.cities.length + 1}`, population = 400) => { const city = { id, name: id, x, y, population, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null }; game.cities.push(city); game.revision++; return city; };
// A catalog workshop expanded to `level`. Ashford's empty 2 × 2 blocks lie 7 or more tiles out, between its streets.
function workshop(game, x, y, level = 1) {
  const placed = build(game, 'workshop', x, y);
  assert.ok(placed.ok, placed.message); completeFixtureConstruction(game, placed.building);
  for (let n = 1; n < level; n++) { const grown = expandWorkshop(game, x, y); assert.ok(grown.ok, grown.message); completeFixtureConstruction(game, grown.building); }
  return tileAt(game, x, y).building;
}
// Seed a valid industry record at its established compact anchor, as retained
// by an older company whose sites predate the current placement spacing.
function existingIndustry(game, kind, x, y) {
  const placed=build(game,kind,game.width-8,game.height-8);assert.ok(placed.ok,placed.message);
  Object.assign(placed.industry,{x,y});completeFixtureConstruction(game,placed.industry);game.revision++;
  return placed.industry;
}
// A sawmill 19 tiles west of Ashford, its stop, and a road into the town's street grid.
function sawmillLine({ game, A }) {
  assert.ok(buildPath(game, 'road', line(A.x - 19, A.x - 9, 48)).ok);
  const placed = build(game, 'sawmill', A.x - 19, 49); assert.ok(placed.ok); completeFixtureConstruction(game, placed.industry);
  return { sawmill: game.industries.at(-1), stop: build(game, 'bus-stop', A.x - 18, 48).station };
}
// A route form verdict and a launch must agree; a refusal returns the launch's result.
function launch(game, from, to, cargo) {
  const plan = validateRoutePlan(game, { mode: 'road', from: from.id, to: to.id, cargo }, { ignoreFunds: true }), launched = addRoute(game, { mode: 'road', stops: [from.id, to.id], cargo });
  assert.equal(plan.valid, launched.ok, `${cargo}: the form says “${plan.message}”, the launch “${launched.message}”`);
  if (!launched.ok && /another town/.test(launched.message)) assert.equal(plan.message, launched.message);
  return launched;
}
// One delivery of `load`: the vehicle reaches its end stop within the next quarter day, with no clock aboard.
function deliver(game, route, load) {
  const vehicle = game.vehicles.find(v => v.routeId === route.id);
  vehicle.load = load; delete vehicle.loadedDay; vehicle.direction = 1; vehicle.progress = route.path.length - 1.1; vehicle.x = route.path.at(-1).x - .1;
  drainDeliveryEvents(game); tick(game, .25);
  return drainDeliveryEvents(game).find(event => event.routeId === route.id);
}

test('the recipes: 2 materials make 1 product, in this order per environment', () => {
  assert.deepEqual({ ...WORKSHOP }, { cost: 12000, footprint: 2, rate: .5, store: 150, ratio: 2, maxLevel: 3 });
  assert.ok(Object.isFrozen(WORKSHOP) && Object.isFrozen(WORKSHOP_RECIPES));
  assert.deepEqual(WORKSHOP_RECIPES.taiga.map(r => [r.input, r.output]), [['lumber', 'furniture'], ['steel', 'machinery']]);
  assert.deepEqual(WORKSHOP_RECIPES.tundra.map(r => [r.input, r.output]), [['steel', 'goods']]);
  assert.deepEqual(WORKSHOP_RECIPES.desert.map(r => [r.input, r.output]), [['glass', 'goods'], ['wire', 'goods']]);
  assert.equal(workshopRecipes(emptyGame('desert')), WORKSHOP_RECIPES.desert);
});

test('a zoned 2 × 2 block develops one workshop at its NW tile, whichever tile is ready first', () => {
  const { game, A } = twoTownFixture(), x = A.x + 7, y = A.y + 1;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.ok(build(game, 'industrial', x + dx, y + dy).ok);
  for (const zone of game.zones) zone.progress = zone.x === x + 1 && zone.y === y + 1 ? .99 : 0;
  assert.ok(!settlementSuitability(game, { x: x + 1, y: y + 1 }, 'industrial').negative.includes('Needs 2 × 2 clear tiles'));
  assert.deepEqual(workshopAnchor(game, x + 1, y + 1, null), { x, y });
  let day = 0;
  while (!buildingAt(game, x, y) && day < 40) { tick(game, 1); day++; }
  const site = buildingAt(game, x + 1, y + 1);
  assert.ok(site, 'the ready SE tile develops the block within weeks, not when the NW tile catches up');
  assert.deepEqual([site.x, site.y, site.building.kind, site.building.level, site.building.footprint], [x, y, 'factory', 1, 2]);
  assert.deepEqual(game.zones.filter(z => Math.abs(z.x - x - .5) < 1 && Math.abs(z.y - y - .5) < 1).map(z => [z.x, z.y]), [[x, y]], 'the site takes the other zone records');
  assert.equal(site.building.owner, undefined, 'a developed workshop belongs to the town');
  while ((tileAt(game, x, y).building.level < 3 || tileAt(game, x, y).building.construction) && day < 1260) { tick(game, 1); day++; }
  assert.equal(tileAt(game, x, y).building.level, 3, `three development phases and 24 months of construction complete within 1260 days (${day})`);
  assert.equal(workshopLevels(game, A), 3);
});

test('a lone industrial tile develops on the same day and then constructs its workshop', () => {
  const { game, A } = twoTownFixture(), x = A.x + 7, y = A.y + 1;
  assert.ok(build(game, 'industrial', x, y).ok);
  while (!tileAt(game, x, y).building && game.day < 400) tick(game, 1);
  // Recorded from the code before workshops: the first building day and level.
  assert.equal(game.day, 135);
  const building = tileAt(game, x, y).building;
  assert.deepEqual(building, { kind: 'factory', level: 1, footprint: 2, construction: { startedDay: 135, completeDay: 315, activityGain: 10, benefitCityId: A.id } });
  assert.equal(workshopLevels(game, A), 0);
  tick(game, 180);
  assert.equal(building.construction, undefined);
  assert.equal(workshopLevels(game, A), 1);
});

test('an L of three industrial tiles whose only clear square needs an unzoned anchor never develops', () => {
  const { game, A } = twoTownFixture(), x = A.x + 7, y = A.y + 1, L = [[1, 0], [0, 1], [1, 1]];
  for (const [dx, dy] of L) assert.ok(build(game, 'industrial', x + dx, y + dy).ok);
  for (const [dx, dy] of L) assert.equal(workshopAnchor(game, x + dx, y + dy, null), null);
  tick(game, 360);
  assert.ok(game.zones.some(zone => zone.progress >= 1), 'the zones were ready');
  assert.ok(L.every(([dx, dy]) => !buildingAt(game, x + dx, y + dy)));
  for (const [dx, dy] of L) assert.ok(settlementSuitability(game, { x: x + dx, y: y + dy }, 'industrial').negative.includes('Needs 2 × 2 clear tiles'));
});

test('workshop levels come from the anchor tiles and follow founding and demolition the same day', () => {
  const { game, A, B, sa } = twoTownFixture();
  workshop(game, A.x + 7, A.y + 1);
  workshop(game, B.x - 8, B.y + 1, 3);
  assert.ok(placeBuildingSite(game, 'factory', B.x + 7, B.y + 1, { size: 2, building: { kind: 'factory', level: 2 } })); game.revision++;
  for (const city of [A, B]) assert.equal(workshopLevels(game, city), townLedger(game, city, zoneMap(game)).works, city.name);
  assert.deepEqual([workshopLevels(game, A), workshopLevels(game, B)], [1, 5]);
  assert.ok(stationCoverage(game, sa).accepts.includes('lumber'));
  // Carrow, 13 tiles out, lies nearer the Ashford workshop and takes it at once.
  const founded = build(game, 'city', A.x + 13, A.y + 2);
  assert.ok(founded.ok, founded.message);
  assert.deepEqual([workshopLevels(game, A), workshopLevels(game, founded.city)], [0, 1]);
  assert.ok(!stationCoverage(game, sa).accepts.includes('lumber'), 'the old town’s stop stops buying lumber');
  assert.ok(build(game, 'bulldoze', B.x - 7, B.y + 2).ok);
  assert.equal(workshopLevels(game, B), 2, 'bulldozing drops the levels the same day');
});

test('a completed catalog workshop makes its town buy materials and sell products', () => {
  const { game, A, sa } = twoTownFixture();
  assert.ok(!stationCoverage(game, sa).accepts.includes('lumber'));
  assert.deepEqual([workshopInputs(game, A), workshopOutputs(game, A)], [[], []]);
  workshop(game, A.x - 8, A.y + 1);
  const coverage = stationCoverage(game, sa);
  for (const cargo of ['lumber', 'steel']) assert.ok(coverage.accepts.includes(cargo), cargo);
  for (const cargo of ['furniture', 'machinery']) assert.ok(coverage.produces.includes(cargo), cargo);
  assert.deepEqual([workshopInputs(game, A), workshopOutputs(game, A)], [['lumber', 'steel'], ['furniture', 'machinery']]);
});

test('routes: materials into a town, its products out to another town, never back into itself', () => {
  const fixture = twoTownFixture(), { game, A, sa, sb } = fixture, { stop } = sawmillLine(fixture);
  workshop(game, A.x - 8, A.y + 1);
  assert.ok(launch(game, stop, sa, 'lumber').ok);
  assert.ok(launch(game, sa, sb, 'furniture').ok);
  const inTown = build(game, 'bus-stop', A.x - 1, A.y).station;
  const loop = 'Furniture from Ashford workshops must go to another town. Pick an end stop that doesn’t reach Ashford.';
  for (const [from, to] of [[sa, inTown], [inTown, sa]]) assert.equal(launch(game, from, to, 'furniture').message, loop);
  // An established five-tile stop between two compact towns covers both.
  town(game, A.x + 10, A.y, 'Carrow');
  const both = build(game, 'bus-stop', A.x + 5, A.y).station;
  both.catchmentRadius=5;
  assert.equal(stationCoverage(game, both).cities.length, 2);
  assert.equal(launch(game, inTown, both, 'furniture').message, loop);
  assert.equal(freightFits(game, stationCoverage(game, inTown), stationCoverage(game, both), 'furniture'), false);
  for (const [biome, source, cargo] of [['desert', 'glassworks', 'glass'], ['tundra', 'steel-mill', 'steel']]) {
    const world = emptyGame(biome), city = town(world, 40, 30);
    assert.ok(buildPath(world, 'road', line(10, 40, 32)).ok);
    assert.ok(build(world, source, 10, 33).ok);
    const [from, to] = [build(world, 'bus-stop', 11, 32).station, build(world, 'bus-stop', 40, 32).station];
    assert.equal(validateRoutePlan(world, { mode: 'road', from: from.id, to: to.id, cargo }).valid, false, `no ${cargo} buyer yet`);
    workshop(world, 43, 33);
    assert.ok(launch(world, from, to, cargo).ok, `${biome} ${cargo} into ${city.name}`);
  }
});

test('workshops turn two materials into one product and pause, losing nothing, when their store is full', () => {
  const fixture = twoTownFixture(), { game, A } = fixture;
  workshop(game, A.x - 8, A.y + 1, 3); workshop(game, A.x + 7, A.y + 1, 3);
  assert.equal(workshopLevels(game, A), 6);
  A.workshop = { input: { lumber: 900 }, output: {} };
  tick(game, 30);
  assert.ok(Math.abs(A.market.processed - 90) <= 1, `processed ${A.market.processed}`);
  assert.ok(Math.abs(A.workshop.output.furniture - 45) <= .5, `made ${A.workshop.output.furniture}`);
  tick(game, 1);
  assert.equal(A.market.processed, 0, 'a month close resets the count');
  assert.equal(A.market.utilization, 1);
  A.workshop = { input: { lumber: 900, steel: 30 }, output: { furniture: 880 } };
  tick(game, 30);
  assert.equal(A.workshop.output.furniture, 900);
  assert.ok(A.workshop.input.lumber > 800);
  assert.equal(A.workshop.input.lumber + 2 * A.workshop.output.furniture, 900 + 2 * 880, 'every unit is accounted for');
  assert.equal(A.workshop.input.steel, 0); assert.equal(A.workshop.output.machinery, 15);
  // A full store still takes and pays for a whole delivery.
  const { stop } = sawmillLine(fixture), route = launch(game, stop, fixture.sa, 'lumber').route;
  game.routes[0].active = false;
  A.workshop.input.lumber = 900;
  const delivered = A.delivered, event = deliver(game, route, 24);
  assert.equal(event.amount, 24);
  assert.equal(event.revenue, fareFor(game, 'lumber', payTiles(route.path) + 1, 24, event.day));
  assert.equal(A.delivered, delivered + 24); assert.equal(A.lastServiceDay, event.day);
  assert.equal(A.workshop.input.lumber, 900);
});

test('a goods truck loads the town’s finished stock, which stays loadable after the last workshop goes', () => {
  const { game, A, sa, sb } = twoTownFixture();
  workshop(game, A.x - 8, A.y + 1);
  A.workshop = { input: {}, output: { furniture: 30.7 } };
  const first = launch(game, sa, sb, 'furniture');
  assert.equal(game.vehicles.at(-1).load, 24);
  assert.ok(Math.abs(A.workshop.output.furniture - 6.7) < 1e-9);
  assert.ok(build(game, 'bulldoze', A.x - 8, A.y + 1).ok);
  assert.equal(workshopLevels(game, A), 0);
  const coverage = stationCoverage(game, sa);
  assert.ok(!coverage.accepts.includes('lumber'), 'no workshop, no materials bought');
  assert.ok(coverage.produces.includes('furniture'), 'the stock is still there to carry');
  assert.equal(routeHealth(game, first.route).word, 'First trip');
  assert.ok(launch(game, sa, sb, 'furniture').ok);
  assert.equal(game.vehicles.at(-1).load, 6);
  assert.equal(routeHealth(game, first.route).word, 'No supplier', 'with the stock carried off and no workshop left');
});

test('catalog workshops: the anchor’s town, the price, and expansion to level 3', () => {
  const game = emptyGame(), city = town(game, 40, 30, 'Ashford');
  assert.equal(buildProblem(game, 'workshop', 30, 30)?.message, 'Place workshops within 10 tiles of a town center.', 'the anchor is 10 tiles out, though the site’s centre is 9.5');
  const money = game.money, placed = build(game, 'workshop', 31, 30);
  assert.ok(placed.ok, placed.message);
  assert.equal(placed.cost, priceFor(game, 12000)); assert.equal(game.money, money - placed.cost);
  assert.match(placed.message, /^Workshop construction started\. Ready in 6 months\. \$12,000 spent\.$/);
  assert.equal(workshopLevels(game, city), 0);
  assert.equal(expandWorkshop(game, 32, 31).ok, false, 'the current building phase must finish first');
  completeFixtureConstruction(game, placed.building);
  assert.deepEqual(tileAt(game, 31, 30).building, { level: 1, owner: 'player', paid: 12000, kind: 'factory', footprint: 2 });
  assert.equal(workshopLevels(game, city), 1);
  for (const level of [2, 3]) {
    const before = game.money, grown = expandWorkshop(game, 32, 31);
    assert.ok(grown.ok, grown.message); assert.equal(before - game.money, priceFor(game, 12000));
    assert.equal(grown.message, `Workshop expansion started. Level ${level} opens in ${6 + (level - 1) * 2} months. $12,000 spent.`);
    assert.equal(workshopLevels(game, city), 0);
    completeFixtureConstruction(game, grown.building);
  }
  assert.deepEqual([tileAt(game, 31, 30).building.level, tileAt(game, 31, 30).building.paid], [3, 36000]);
  assert.equal(expandWorkshop(game, 31, 30).message, 'This workshop is fully expanded.');
  assert.ok(placeBuildingSite(game, 'factory', 44, 30, { size: 2, building: { kind: 'factory', level: 1 } }));
  assert.equal(expandWorkshop(game, 45, 31).message, 'Only your own workshops can be expanded.');
  assert.equal(expandWorkshop(game, 50, 50).message, 'Only your own workshops can be expanded.');
  game.money = 100;
  assert.deepEqual(buildProblem(game, 'workshop', 34, 34), { message: 'Need $12,000 for this workshop.', reason: 'funds' });
  assert.ok(buildProblem(game, 'workshop', 31, 31).message.startsWith('Clear all 4 tiles'));
});

test('freight that never touches a workshop earns exactly as before, even into a town with workshops', () => {
  const { game, A, B, sb } = twoTownFixture();
  assert.ok(placeBuildingSite(game, 'factory', B.x + 7, B.y + 1, { size: 2, building: { kind: 'factory', level: 2 } })); game.revision++;
  assert.ok(buildPath(game, 'road', line(A.x - 19, A.x - 9, 48)).ok);
  const quarry = build(game, 'quarry', A.x - 19, 49); assert.ok(quarry.ok); completeFixtureConstruction(game, quarry.industry);
  existingIndustry(game,'furniture-factory',A.x-14,43).inventory.furniture=900;
  const stop = build(game, 'bus-stop', A.x - 18, 48).station;
  stop.catchmentRadius=5; // Preserve this historical revenue calibration's service area.
  const furniture = addRoute(game, { mode: 'road', stops: [stop.id, sb.id], cargo: 'furniture' }).route, stone = addRoute(game, { mode: 'road', stops: [stop.id, sb.id], cargo: 'stone' }).route;
  assert.equal(workshopLevels(game, B), 2);
  tick(game, 180);
  // Recorded from the code before workshops.
  assert.deepEqual([furniture.revenue, furniture.delivered, stone.revenue, stone.delivered], [60352, 96, 11040, 72]);
});

test('a works stop that also reaches a town loads the works’ furniture first, then the town’s', () => {
  const game = emptyGame(), A = town(game, 40, 30, 'Ashford'), B = town(game, 70, 30, 'Brookby');
  assert.ok(buildPath(game, 'road', line(40, 70, 32)).ok);
  const works = existingIndustry(game,'furniture-factory',43,33), from = build(game, 'bus-stop', 40, 32).station, to = build(game, 'bus-stop', 70, 32).station;
  workshop(game, 36, 26);
  works.inventory.furniture = 10; A.workshop = { input: {}, output: { furniture: 30 } };
  assert.ok(stationCoverage(game, from).cities.includes(A) && !stationCoverage(game, to).cities.includes(A));
  assert.ok(launch(game, from, to, 'furniture').ok);
  assert.deepEqual([game.vehicles.at(-1).load, works.inventory.furniture, A.workshop.output.furniture], [24, 0, 16]);
  assert.equal(B.workshop, undefined);
});

test('a town source reads its stock for route status, waiting counts and the forecast', () => {
  const fixture = twoTownFixture(), { game, A, sa, sb } = fixture;
  workshop(game, A.x - 8, A.y + 1, 2);
  const route = launch(game, sa, sb, 'furniture').route;
  const idle = routeHealth(game, route);
  assert.equal(idle.state, 'waiting'); assert.equal(idle.word, 'Needs lumber');
  assert.equal(idle.detail, 'Deliver lumber to Ashford workshops. More trucks won’t help yet.');
  A.workshop = { input: { lumber: 40 }, output: { furniture: .5 } };
  assert.equal(routeHealth(game, route).state, 'running', 'waiting for the workshops to make more is normal running');
  assert.match(routeHealth(game, route).detail, /making more furniture/);
  A.workshop.output.furniture = 130.4;
  const stocked = routeHealth(game, route);
  assert.equal(stocked.waiting, 130); assert.equal(stocked.state, 'running');
  const draft = { mode: 'road', from: sa.id, to: sb.id, cargo: 'furniture' }, before = forecastRoute(game, draft);
  assert.equal(before.madeDay, 0); assert.equal(before.workshopsPending, true, 'no month has closed yet');
  A.workshop.input.lumber = 12;
  tick(game, 31);
  assert.ok(Math.abs(A.market.utilization - .4) < 1e-9, `${A.market.utilization}`);
  game.revision++;
  const after = forecastRoute(game, draft);
  assert.ok(Math.abs(after.madeDay - 2 * WORKSHOP.rate * A.market.utilization / WORKSHOP.ratio) < 1e-9, `${after.madeDay}`);
  assert.equal(after.workshopsPending, false);
});

test('a new sawmill may open near a town whose workshops buy lumber', () => {
  const game = emptyGame(), city = town(game, 40, 30, 'Ashford');
  assert.ok(build(game, 'logging-camp', 10, 30).ok);
  assert.equal(openingSiteProblem(game, 'sawmill', 20, 30), 'spacing', 'the camp it would buy from stands too close');
  assert.equal(openingSiteProblem(game, 'sawmill', 26, 45), 'partner');
  workshop(game, 43, 33);
  assert.equal(workshopLevels(game, city), 1);
  assert.equal(openingSiteProblem(game, 'sawmill', 26, 45), null);
});

// The review's calibration (t3.mjs): two logging camps feed a sawmill 19 tiles east of Ashford's stop, which is never refilled.
// Once Ashford has a workshop, one truck brings lumber and one takes furniture 38 tiles on to Brookby.
// Measure the fifth year, after every zoned construction phase has had time to finish.
function calibration(mode) {
  const { game, A, sa, sb } = twoTownFixture(), levels = {};
  const sawmill = completeFixtureConstruction(game, build(game, 'sawmill', 43, 50).industry);
  // The review's camps stand closer to each other and to the mill than the industry spacing now allows.
  for (const [n, x] of [40, 47].entries()) Object.assign(completeFixtureConstruction(game, build(game, 'logging-camp', 10 + n * 20, 80).industry), { x, y: 60 });
  for (let y = 49; y <= 61; y++) tileAt(game, 46, y).road = true;
  game.networkRevision++; game.revision++;
  const mill = build(game, 'bus-stop', 44, 48).station, camps = build(game, 'bus-stop', 46, 59).station;
  for (let n = 0; n < 2; n++) assert.ok(addRoute(game, { mode: 'road', stops: [camps.id, mill.id], cargo: 'timber' }).ok);
  if (mode === 'zones') for (const [bx, by] of [[4, 7], [7, 4]]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) assert.ok(build(game, 'industrial', A.x + bx + dx, A.y + by + dy).ok);
  else workshop(game, A.x + 4, A.y + 7);
  let launched = 0, baseline = {};
  for (let day = 1; day <= 1800; day++) {
    tick(game, 1);
    const L = workshopLevels(game, A);
    levels[L] ??= day;
    if (!launched && L > 0) { launched = day; assert.ok(addRoute(game, { mode: 'road', stops: [mill.id, sa.id], cargo: 'lumber' }).ok); assert.ok(addRoute(game, { mode: 'road', stops: [sa.id, sb.id], cargo: 'furniture' }).ok); game.money = 1e6; }
    if (day === 1440) baseline = Object.fromEntries(game.routes.map(route => [route.cargo, { revenue: route.revenue, delivered: route.delivered }]));
  }
  const months = 360 / 30.44, carried = cargo => game.routes.find(route => route.cargo === cargo);
  assert.ok(sawmill.received > 0);
  return { levels, lumber: (carried('lumber').revenue - baseline.lumber.revenue) / months, furniture: (carried('furniture').revenue - baseline.furniture.revenue) / months, made: (carried('furniture').delivered - baseline.furniture.delivered) / months };
}
const near = (value, target, label) => assert.ok(Math.abs(value / target - 1) <= .25, `${label}: ${Math.round(value)} against ${target}`);
test('calibration: zoned blocks and catalog workshops reach their expected completed earnings', () => {
  // The review paid by the square root of the distance; cargo payment's distance fares pay 38-tile furniture this much more.
  const fares = (38 + 12) / 9 / (1 + Math.sqrt(38) * .55);
  const zones = calibration('zones');
  near(zones.levels[1], 119 + 180, 'first completed level'); assert.ok(zones.levels[4] <= 1080 && zones.levels[6] <= 1440, JSON.stringify(zones.levels));
  near(zones.lumber, 6100, 'lumber a month'); near(zones.made, 22, 'furniture carried a month'); near(zones.furniture, 8400 * fares, 'furniture a month');
  const catalog = calibration('catalog');
  near(catalog.lumber, 6000, 'lumber a month, whatever the workshop’s size'); near(catalog.made, 7, 'furniture carried a month'); near(catalog.furniture, 2750 * fares, 'furniture a month');
});

test('partitioned frames match whole ticks with lumber and furniture trucks', () => {
  const make = () => {
    const fixture = twoTownFixture(), { game, A, sa, sb } = fixture;
    const sawmill = completeFixtureConstruction(game, build(game, 'sawmill', 43, 50).industry), stop = build(game, 'bus-stop', 44, 48).station;
    sawmill.inventory.lumber = 900;
    assert.ok(placeBuildingSite(game, 'factory', A.x + 7, A.y + 7, { size: 2, building: { kind: 'factory', level: 2, owner: 'player', paid: 24000 } })); game.revision++;
    for (const [bx, by] of [[4, 7], [-5, 7]]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) assert.ok(build(game, 'industrial', A.x + bx + dx, A.y + by + dy).ok);
    for (let n = 0; n < 2; n++) assert.ok(addRoute(game, { mode: 'road', stops: [stop.id, sa.id], cargo: 'lumber' }).ok);
    assert.ok(addRoute(game, { mode: 'road', stops: [sa.id, sb.id], cargo: 'furniture' }).ok);
    return game;
  };
  const whole = make(), parts = make();
  for (let n = 0; n < 6; n++) tick(whole, 60);
  advance(parts, 360, tick);
  assert.ok(whole.routes[1].delivered > 0 && whole.routes.at(-1).delivered > 0, 'lumber and furniture were carried');
  equivalent(parts, whole);
  assert.equal(parts.money, whole.money);
});

test('workshop stock and owned buildings save, restore and validate', () => {
  const { game, A } = twoTownFixture();
  workshop(game, A.x - 8, A.y + 1, 2);
  tick(game, 31);
  assert.equal(A.market.utilization, 0);
  A.workshop = { input: { lumber: 12.5, steel: 0 }, output: { furniture: 3 } };
  const restored = clone(game);
  assert.deepEqual(restored.cities[0].workshop, A.workshop);
  assert.deepEqual(tileAt(restored, A.x - 8, A.y + 1).building, { level: 2, owner: 'player', paid: 24000, kind: 'factory', footprint: 2 });
  const reject = (label, change) => { const copy = clone(game); change(copy); assert.equal(validateGame(copy), false, label); };
  reject('a cargo outside the recipes', copy => { copy.cities[0].workshop.input.glass = 1; });
  reject('an output as an input', copy => { copy.cities[0].workshop.input.furniture = 1; });
  reject('a negative stock', copy => { copy.cities[0].workshop.output.furniture = -1; });
  reject('another key', copy => { copy.cities[0].workshop.rate = 1; });
  reject('owner npc', copy => { tileAt(copy, A.x - 8, A.y + 1).building.owner = 'npc'; });
  reject('paid −1', copy => { tileAt(copy, A.x - 8, A.y + 1).building.paid = -1; });
  reject('a negative processed count', copy => { copy.cities[0].market.processed = -1; });
  reject('utilization above one', copy => { copy.cities[0].market.utilization = 1.5; });
  assert.equal(game.cities[1].market.utilization, undefined, 'a town without workshops keeps its market as it was');
});
