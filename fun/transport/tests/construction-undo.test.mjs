import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addRoute, build, buildProblem, tick, validateGame, restoreGame } from '../model.js';
import { stationCoverage } from '../model.js';
import { buildPlan, quoteBuildPlan } from '../construction-plan.js';
import { captureUndo, finishUndo, canUndo, undoProblem, undoStale, undoConstruction } from '../construction-undo.js';
import { encodeGame } from '../save-codec.js';
import { terrainObjectAt } from '../terrain-objects.js';
import { emptyGame, tileAt, line } from './helpers.mjs';
import { sellProperty } from '../model.js';
import { twoTownFixture } from './helpers.mjs';

const counters = ({ revision, networkRevision, ...rest }) => rest;
const town = (game, x, y, extra = {}) => { const city = { id: `city-t${x}`, name: `Testford ${x}`, x, y, population: 400, activity: 20, growth: 0, passengers: 300, delivered: 0, supplies: 0, lastServiceDay: null, ...extra }; game.cities.push(city); return city; };
function journal(game, tool, points, options) {
  const entry = captureUndo(game, tool, points), result = buildPlan(game, tool, points, options);
  assert.equal(result.ok, true, `${tool}: ${result.message}`);
  const undo = finishUndo(entry, game, result);
  assert.ok(undo, `${tool} journals an undo`);
  return { undo, result };
}
function roundTrip(game, tool, points, options) {
  const before = structuredClone(game), tiles = game.tiles, { undo, result } = journal(game, tool, points, options);
  assert.equal(canUndo(game, undo), true, undoProblem(game, undo));
  const outcome = undoConstruction(game, undo);
  assert.equal(outcome.ok, true, outcome.message); assert.equal(outcome.cost, result.cost);
  assert.equal(game.tiles, tiles, 'tiles are restored in place, keeping the save baseline');
  assert.deepEqual(counters(game), counters(before), `${tool}: undo restores everything but the revision counters`);
  assert.ok(game.revision > before.revision, 'undo advances the revision');
  assert.equal(validateGame(game), true);
  assert.equal(canUndo(game, undo), false, 'an entry undoes once');
  return outcome;
}
function prepareSpan(game, tunnel) {
  for (const tile of game.tiles) tile.elevation = 2 / 7;
  const points = line(10, 14, 10);
  for (const [index, point] of points.entries()) for (let offset = -3; offset <= 3; offset++) Object.assign(tileAt(game, point.x, point.y + offset), { elevation: (index <= 1 || index === 4 ? 2 : tunnel ? 3 : 1) / 7, terrain: 'grass', detail: '' });
  return points;
}
function grove(game, x = 20, y = 20) {
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) Object.assign(tileAt(game, x + dx, y + dy), { terrain: 'forest', detail: 'pine', elevation: .5 });
  for (let dy = -6; dy <= 8; dy++) for (let dx = -6; dx <= 8; dx++) tileAt(game, x + dx, y + dy).elevation = .5;
  tileAt(game, x, y).terrainObject = { kind: 'forest', detail: 'pine', variant: 7, footprint: 3 };
  assert.equal(validateGame(game), true);
}

test('every tool builds and undoes back to the exact prior state', () => {
  const cases = [
    ['road', () => line(10, 20, 10)],
    ['rail', () => line(10, 20, 12)],
    ['residential', () => line(30, 33, 30)],
    ['commercial', () => [{ x: 30, y: 32 }]],
    ['house-normal-1', () => [{ x: 40, y: 40 }]],
    ['house-expensive-1', () => [{ x: 44, y: 40 }]],
    ['school', () => [{ x: 48, y: 40 }]],
    ['sawmill', () => [{ x: 50, y: 60 }]],
    ['steel-mill', () => [{ x: 56, y: 50 }]],
    ['raise', () => [{ x: 60, y: 20 }, { x: 61, y: 20 }]],
    ['lower', () => [{ x: 60, y: 24 }]],
    ['level', () => [{ x: 64, y: 30 }, { x: 65, y: 30 }, { x: 64, y: 31 }, { x: 65, y: 31 }]],
  ];
  for (const [tool, points] of cases) {
    const game = emptyGame(); town(game, 42, 44);
    if (tool === 'level') tileAt(game, 65, 31).elevation = .4;
    roundTrip(game, tool, points());
  }
});

for (const tool of ['bridge', 'railbridge', 'tunnel', 'railtunnel']) test(`a ${tool} span undoes completely`, () => {
  const game = emptyGame();
  roundTrip(game, tool, prepareSpan(game, tool.includes('tunnel')));
});

test('stops, stations and ports undo, and the next id is handed out again', () => {
  const game = emptyGame();
  build(game, 'road', 10, 10); build(game, 'road', 11, 10); build(game, 'rail', 10, 14);
  for (let y = 0; y < game.height; y++) Object.assign(tileAt(game, 30, y), { terrain: 'water', elevation: 0 });
  const nextId = game.nextId;
  assert.match(roundTrip(game, 'stop', [{ x: 10, y: 10 }, { x: 11, y: 10 }], { preferredMode: 'road' }).message, /^2 stops removed\. \$/);
  assert.match(roundTrip(game, 'stop', [{ x: 10, y: 14 }], { preferredMode: 'rail' }).message, /^Rail station removed/);
  assert.match(roundTrip(game, 'port', [{ x: 30, y: 20 }]).message, /^Port removed/);
  assert.equal(game.nextId, nextId);
});

test('founding a town undoes its centre, notice and the owners it assigned to older homes', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  const homes = game.tiles.filter(tile => tile.building && !Object.hasOwn(tile.building, 'populationCityId')).length;
  assert.ok(homes > 0, 'the generated world has homes without an owner yet');
  let site;
  for (let y = 4; y < game.height - 4 && !site; y++) for (let x = 4; x < game.width - 4; x++) {
    if (!game.cities.some(city => Math.hypot(city.x - x, city.y - y) < 12) && !buildProblem(game, 'city', x, y)) { site = { x, y }; break; }
  }
  assert.ok(site, 'a town site exists');
  const outcome = roundTrip(game, 'city', [site]);
  assert.match(outcome.message, /removed\. \$/);
});

test('bulldozing a home, a grove, a stop and an industry undoes back to the prior state', () => {
  const game = emptyGame(), city = town(game, 42, 44);
  assert.equal(build(game, 'house-expensive-2', 40, 40).ok, true);
  const population = city.population;
  city.passengers = population * .9;
  let entry = journal(game, 'bulldoze', [{ x: 41, y: 41 }]);
  assert.ok(city.population < population && city.passengers <= city.population * .9);
  assert.equal(undoConstruction(game, entry.undo).ok, true);
  assert.equal(city.population, population, 'residents return');
  assert.equal(city.passengers, population * .9, 'the passengers the demolition turned away return');

  grove(game);
  roundTrip(game, 'bulldoze', [{ x: 22, y: 21 }]);
  assert.equal(terrainObjectAt(game, 22, 22).object.footprint, 3, 'the whole grove parcel returns');
  roundTrip(game, 'road', line(18, 24, 21));

  build(game, 'road', 10, 30); build(game, 'road', 11, 30); build(game, 'bus-stop', 10, 30); build(game, 'bus-stop', 11, 30);
  assert.equal(build(game, 'sawmill', 60, 60).ok, true); assert.equal(build(game, 'farm', 70, 60).ok, true);
  roundTrip(game, 'bulldoze', [{ x: 10, y: 30 }]);
  roundTrip(game, 'bulldoze', [{ x: 61, y: 61 }]);
  roundTrip(game, 'bulldoze', line(10, 12, 30));
});

test('a demolition dents its town by a recorded amount, and undo takes back just that', () => {
  const game = emptyGame(), city = town(game, 42, 44);
  assert.equal(build(game, 'house-cheap-1', 40, 40).ok, true); assert.equal(build(game, 'house-cheap-1', 44, 40).ok, true);
  const before = structuredClone(game), first = journal(game, 'bulldoze', [{ x: 40, y: 40 }]).undo;
  assert.equal(city.disturbance, 6);
  const second = journal(game, 'bulldoze', [{ x: 44, y: 40 }]).undo;
  assert.equal(city.disturbance, 12);
  assert.equal(undoConstruction(game, second).ok, true);
  assert.equal(city.disturbance, 6);
  assert.equal(undoConstruction(game, first).ok, true);
  assert.equal(Object.hasOwn(city, 'disturbance'), false);
  assert.equal(city.population, before.cities[0].population);
  assert.deepEqual(counters(game), counters(before), 'undo restores everything but the revision counters');
  // A month may fade the dent before the undo; the undo never takes a town below calm.
  const faded = journal(game, 'bulldoze', [{ x: 40, y: 40 }]).undo, month = game.lastMonth;
  while (game.lastMonth === month) tick(game, 1);
  assert.equal(city.disturbance, 1);
  assert.equal(undoConstruction(game, faded).ok, true);
  assert.equal(Object.hasOwn(city, 'disturbance'), false);
  assert.equal(validateGame(game), true);
});

test('a later tick keeps cargo, vehicles and growth instead of rewinding them', () => {
  const game = emptyGame(), city = town(game, 52, 20);
  for (let x = 20; x <= 34; x++) build(game, 'road', x, 30);
  assert.equal(build(game, 'logging-camp', 17, 25).ok, true); assert.equal(build(game, 'sawmill', 35, 25).ok, true);
  build(game, 'bus-stop', 20, 30); build(game, 'bus-stop', 34, 30);
  const [camp, mill] = game.industries;
  camp.inventory.timber = 400;
  assert.equal(addRoute(game, { mode: 'road', stops: game.stations.map(s => s.id), cargo: 'timber' }).ok, true);
  game.day = Math.floor(game.day) + .1;
  const { undo } = journal(game, 'sawmill', [{ x: 60, y: 60 }]), money = game.money;
  const vehicle = game.vehicles[0], progress = vehicle.progress;
  tick(game, .5);
  assert.notEqual(vehicle.progress, progress, 'the unrelated route moved during the half day');
  const industries = structuredClone(game.industries.slice(0, 2)), vehicles = structuredClone(game.vehicles), people = structuredClone(city);
  assert.equal(undoConstruction(game, undo).ok, true);
  assert.deepEqual(game.industries, industries, 'inventories stay as they are now');
  assert.deepEqual(game.vehicles, vehicles);
  assert.deepEqual(city, people);
  assert.ok(Math.abs(game.money - money - undo.cost) < 1e-6);
  assert.equal(camp, game.industries[0]); assert.equal(mill, game.industries[1]);
});

const far = (game, points, gap) => points.every(p => [...game.cities, ...game.industries, ...game.stations].every(site => Math.max(Math.abs(site.x - p.x), Math.abs(site.y - p.y)) > gap));
function freeRoad(game, length, gap = 12) {
  for (let y = 6; y < game.height - 6; y += 2) for (let x = 6; x < game.width - length - 6; x += 2) {
    const points = line(x, x + length - 1, y);
    if (far(game, points, gap) && quoteBuildPlan(game, 'road', points).ok) return points;
  }
  assert.fail('a free road site exists');
}

test('undo survives a month boundary but not a route change, development or earnings', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  const x = game.cities[0].x + 1, y = game.cities[0].y + 1;
  Object.assign(tileAt(game, x, y), { terrain: 'grass', road: false, rail: false, building: null, zone: null });
  const zoned = journal(game, 'residential', [{ x, y }]).undo, paved = journal(game, 'road', freeRoad(game, 5)), roadEntry = paved.undo;
  const month = game.lastMonth;
  for (let day = 0; day < 180 && (day < 35 || !tileAt(game, x, y).building); day++) tick(game, 1);
  assert.ok(game.lastMonth > month, 'at least one month closed');
  assert.ok(tileAt(game, x, y).building, 'the zone developed');
  assert.equal(canUndo(game, zoned), false);
  assert.match(undoProblem(game, zoned), /changed/);
  assert.equal(canUndo(game, roadEntry), true, undoProblem(game, roadEntry));
  const money = game.money, spent = game.totalExpenses, outcome = undoConstruction(game, roadEntry);
  assert.equal(outcome.ok, true); assert.match(outcome.message, /^Road removed\. \$[\d,]+ refunded\.$/);
  assert.ok(Math.abs(game.money - money - paved.result.cost) < 1e-6, 'the recorded cost is refunded');
  assert.ok(Math.abs(spent - game.totalExpenses - paved.result.cost) < 1e-6 && game.monthlyExpenses >= 0);
  assert.equal(validateGame(game), true);

  const stop = emptyGame(), city = town(stop, 20, 20), other = town(stop, 40, 20);
  for (let rx = 20; rx <= 40; rx++) build(stop, 'road', rx, 21);
  build(stop, 'bus-stop', 21, 21);
  const stopEntry = journal(stop, 'stop', [{ x: 39, y: 21 }]).undo;
  assert.ok(city && other);
  assert.equal(addRoute(stop, { mode: 'road', stops: stop.stations.map(s => s.id), cargo: 'passengers' }).ok, true);
  assert.equal(undoStale(stop, stopEntry), true);
  assert.equal(canUndo(stop, stopEntry), false, 'refused after addRoute');
  assert.equal(undoConstruction(stop, stopEntry).ok, false);
  assert.equal(stop.stations.length, 2);

  const plant = emptyGame(), placed = journal(plant, 'sawmill', [{ x: 30, y: 30 }]).undo;
  tick(plant, 45);
  assert.equal(canUndo(plant, placed), true, 'an idle industry can be undone in a later month');
  plant.industries[0].received += 5;
  assert.match(undoProblem(plant, placed), /traded/);
});

test('undo refuses when a later build stands on its tiles, and a newer undo frees an older one', () => {
  const game = emptyGame(), first = journal(game, 'road', line(10, 14, 10)).undo, second = journal(game, 'bus-stop', [{ x: 12, y: 10 }]).undo;
  assert.equal(canUndo(game, first), false, 'a stop placed on the road blocks undoing the road beneath it');
  assert.equal(undoConstruction(game, second).ok, true);
  assert.equal(canUndo(game, first), true);
  const third = journal(game, 'road', line(14, 18, 10)).undo;
  assert.equal(canUndo(game, first), true, 'an extension that did not change the first road leaves it undoable');
  assert.equal(undoConstruction(game, first).ok, true);
  assert.equal(tileAt(game, 14, 10).road, false); assert.equal(tileAt(game, 16, 10).road, true);
  assert.equal(undoConstruction(game, third).ok, true, 'the extension still undoes on its own');
  assert.ok(game.tiles.every(tile => !tile.road)); assert.equal(validateGame(game), true);

  const zone = emptyGame(), bulldozed = (() => { grove(zone); return journal(zone, 'bulldoze', [{ x: 20, y: 20 }]).undo; })();
  assert.equal(build(zone, 'house-expensive-1', 21, 21).ok, true);
  assert.equal(canUndo(zone, bulldozed), false, 'a home on the cleared grove keeps the grove from returning');
  const cleared = emptyGame(), clearing = (() => { grove(cleared); return journal(cleared, 'bulldoze', [{ x: 20, y: 20 }]).undo; })();
  assert.equal(build(cleared, 'sawmill', 21, 21).ok, true);
  assert.equal(canUndo(cleared, clearing), false, 'an industry that changed no tile still blocks the grove');
  const corner = emptyGame(), cornered = (() => { grove(corner); return journal(corner, 'bulldoze', [{ x: 20, y: 20 }]).undo; })();
  assert.equal(build(corner, 'house-normal-1', 18, 20).ok, true);
  assert.equal(canUndo(corner, cornered), true, 'a one-tile home beside the clearing does not matter');
  assert.equal(build(corner, 'house-expensive-1', 19, 19).ok, true);
  assert.equal(canUndo(corner, cornered), false, 'a larger home anchored outside still covers the clearing');
});

test('a save after undo matches never having built', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
  const body = saved => ({ ...saved, state: counters(saved.state) }), saved = body(encodeGame(game)), { undo } = journal(game, 'road', freeRoad(game, 7, 3));
  assert.equal(undoConstruction(game, undo).ok, true);
  const encoded = encodeGame(game);
  assert.deepEqual(body(encoded), saved);
  const restored = restoreGame(JSON.parse(JSON.stringify(encoded)));
  assert.ok(restored); assert.equal(validateGame(restored), true);
});

test('random builds, days and undos in any order never leave an invalid world', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, pick = list => list[Math.floor(random() * list.length)];
  const tools = ['road', 'rail', 'stop', 'residential', 'bulldoze', 'bulldoze', 'raise', 'lower', 'city', 'house-cheap-1', 'house-expensive-1', 'sawmill', 'port'];
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 31 }), stack = [];
  game.money = 5e7;
  let undone = 0;
  for (let step = 0; step < 240; step++) {
    const roll = random();
    if (roll < .6) {
      const tool = pick(tools), town = pick(game.cities), x = Math.max(1, Math.min(game.width - 8, town.x + Math.floor(random() * 24 - 12))), y = Math.max(1, Math.min(game.height - 8, town.y + Math.floor(random() * 24 - 12)));
      const points = ['road', 'rail', 'residential', 'bulldoze'].includes(tool) ? line(x, x + Math.floor(random() * 4), y) : [{ x, y }];
      const entry = captureUndo(game, tool, points), undo = finishUndo(entry, game, buildPlan(game, tool, points, { preferredMode: 'road' }));
      if (undo) stack.push(undo);
    } else if (roll < .85 && stack.length) {
      const undo = random() < .7 ? stack.at(-1) : pick(stack), outcome = undoConstruction(game, undo);
      if (outcome.ok || random() < .5) stack.splice(stack.indexOf(undo), 1);
      if (outcome.ok) { undone++; assert.equal(validateGame(game), true, `after undoing ${undo.tool}`); }
    } else tick(game, random() * 12);
  }
  assert.ok(undone > 40, `${undone} undos ran`);
});

test('undoing a workshop stops its town buying lumber the same day', () => {
  const game = emptyGame(); town(game, 42, 44);
  assert.equal(build(game, 'road', 42, 46).ok, true);
  const stop = build(game, 'bus-stop', 42, 46).station, buys = () => stationCoverage(game, stop).accepts.includes('lumber');
  assert.equal(buys(), false);
  const { undo, result } = journal(game, 'workshop', [{ x: 44, y: 40 }]);
  assert.equal(result.message, 'Workshop built. $12,000 spent.');
  assert.equal(buys(), true);
  assert.equal(undoConstruction(game, undo).message, 'Workshop removed. $12,000 refunded.');
  assert.equal(buys(), false);
  assert.equal(validateGame(game), true);
});

test('a building the company owns undoes only within the month it was placed, before any rent', () => {
  const same = twoTownFixture().game, home = same.cities[0];
  roundTrip(same, 'house-cheap-1', [{ x: home.x + 4, y: home.y + 7 }]);
  const { game, A } = twoTownFixture(), money = game.money;
  const cottage = journal(game, 'house-cheap-1', [{ x: A.x + 4, y: A.y + 7 }]).undo, zoned = journal(game, 'residential', [{ x: A.x - 8, y: A.y + 1 }]).undo;
  assert.equal(canUndo(game, cottage), true, undoProblem(game, cottage));
  const month = game.lastMonth;
  while (game.lastMonth === month) tick(game, 1);
  assert.ok(game.history.at(-1).property > 0, 'the close booked rent');
  assert.equal(canUndo(game, cottage), false);
  assert.equal(undoProblem(game, cottage), 'Rent has been paid on this building. Sell it instead.');
  assert.equal(undoConstruction(game, cottage).ok, false);
  assert.ok(game.money > money - cottage.cost, 'nothing refunded');
  assert.equal(canUndo(game, zoned), true, 'a zone still undoes in a later month: it earns nothing until built up');
  assert.equal(undoConstruction(game, zoned).ok, true);
  // Selling changes the tile, so the placement cannot come back either.
  const later = journal(game, 'house-normal-1', [{ x: A.x + 1, y: A.y + 7 }]).undo;
  assert.equal(sellProperty(game, A.x + 1, A.y + 7).ok, true);
  assert.equal(canUndo(game, later), false); assert.match(undoProblem(game, later), /changed/);
  assert.equal(validateGame(game), true);
});

 test('a road stop on bare land undoes its stop, road, cleared vegetation and combined price together', () => {
  const game=emptyGame();Object.assign(tileAt(game,10,10),{terrain:'forest',detail:'pine'});
  const outcome=roundTrip(game,'stop',[{x:10,y:10}],{preferredMode:'road'});
  assert.match(outcome.message,/Road stop removed/);
});
