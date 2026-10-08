import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrainV2 } from '../world-terrain-v2.js';
import { populateWorldV2 } from '../world-placement-v2.js';
import { expandGeneratedIndustrySites, industrySiteProblem } from '../industry-sites.js';
import { WORLD_SIZES, WORLD_GENERATION_VERSION } from '../world.js';
import { createGame, findPath, restoreGame, validateGame, build, buildPath, addRoute, addRouteVehicle, tick } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { townOutlook } from '../settlements.js';
import { placeBuildingSite } from '../building-sites.js';
import { emptyGame, tileAt, line, equivalent } from './helpers.mjs';

for (const biome of ['taiga', 'tundra', 'desert']) test(`${biome}: towns, streets and industry follow the existing land surface`, () => {
  const config = WORLD_SIZES.square512;
  const context = generateTerrainV2(biome, 1847, config, { naturalRelief: true });
  const before = new Float64Array(context.tiles.map(tile => tile.elevation));
  const world = { ...config, biome, tiles: context.tiles, cities: [], industries: [], stations: [] };
  populateWorldV2(world, biome, 1847, config, context);
  expandGeneratedIndustrySites(world);
  let buildings = 0, roads = 0;
  for (let i = 0; i < world.tiles.length; i++) {
    assert.equal(world.tiles[i].elevation, before[i], `placement must not dig a pit at tile ${i}`);
    if (world.tiles[i].building) buildings++;
    if (world.tiles[i].road) roads++;
  }
  assert.ok(buildings > 100 && roads > 100);
  for (const site of world.industries) assert.equal(industrySiteProblem(world, site.kind, site.x, site.y, 2, site), null);
});

test('offshore starter land has feathered irregular shores, with usable towns and shipping', () => {
  const config = WORLD_SIZES.square512, seed = 418;
  const previous = generateTerrainV2('taiga', seed, config);
  const current = generateTerrainV2('taiga', seed, config, { naturalRelief: true });
  const { starterX: cx, starterY: cy } = current;
  const elevations = [], rowWidths = new Set();
  for (let y = cy - 14; y <= cy + 14; y++) {
    let width = 0;
    for (let x = cx - 14; x <= cx + 14; x++) {
      const index = y * config.width + x, tile = current.tiles[index];
      if (previous.tiles[index].terrain === 'water' && tile.terrain !== 'water') { elevations.push(tile.elevation); width++; }
    }
    if (width) rowWidths.add(width);
  }
  assert.ok(elevations.length > 40, 'dry shore extends beyond the old square platform');
  assert.ok(rowWidths.size > 6, 'the shoreline bends instead of following a rectangular footprint');
  assert.ok(Math.min(...elevations) < .03 && Math.max(...elevations) > .15, 'shore rises gradually into the town');
  assert.ok(new Set(elevations).size > 30);
  for (const biome of ['taiga', 'tundra', 'desert']) {
    const game = createGame({ biome, seed, size: 'square512' });
    assert.equal(game.generationVersion, WORLD_GENERATION_VERSION);
    assert.equal(validateGame(game), true);
    assert.equal(game.routes[0].path.length, 25);
    const [from, to] = game.cities.slice(0, 2).map(city => ({ x: city.x, y: city.y + 5 }));
    assert.ok(findPath(game, from, to, 'water')?.length > 2);
  }
});

test('recipe 3 saves retain flattened geography, while recipe 4 saves retain natural grades', () => {
  for (const generationVersion of [3, 4]) {
    const game = createGame({ biome: 'taiga', seed: 418, size: 'square512', generationVersion });
    game.tiles[17].detail = 'retained edit';
    const encoded = encodeGame(game), restored = restoreGame(JSON.parse(JSON.stringify(encoded)));
    assert.equal(encoded.generation.version, generationVersion);
    assert.ok(restored);
    assert.equal(restored.generationVersion, generationVersion);
    assert.deepEqual(restored.tiles, game.tiles);
    assert.deepEqual(restored.cities, game.cities);
    assert.deepEqual(restored.industries, game.industries);
  }
});

// Two flat towns joined by one street and a two-bus line fill their road-side lots within a year.
function servedTowns() {
  const game = emptyGame();
  build(game, 'city', 30, 30); build(game, 'city', 56, 30);
  buildPath(game, 'road', line(24, 62, 30));
  for (const x of [30, 56]) buildPath(game, 'road', [27, 28, 29, 31, 32, 33].map(y => ({ x, y })));
  build(game, 'bus-stop', 32, 30); build(game, 'bus-stop', 54, 30);
  assert.equal(addRoute(game, { mode: 'road', cargo: 'passengers', stops: game.stations.map(stop => stop.id) }).ok, true);
  addRouteVehicle(game, game.routes[0].id);
  for (const city of game.cities) city.population = 600;
  return game;
}
const days = (game, count, step = 1, options) => { for (let n = 0; n < count / step; n++) tick(game, step, options); };
const population = game => game.cities.reduce((sum, city) => sum + city.population, 0);
const streets = (game, before) => game.tiles.flatMap((tile, index) => tile.road && !before[index].road ? [{ x: index % game.width, y: Math.floor(index / game.width), tile, was: before[index] }] : []);

test('served towns lay short public streets once their lots run out, and keep growing', () => {
  const game = servedTowns();
  days(game, 180);
  const month6 = population(game), before = structuredClone(game.tiles), upkeep = game.infrastructureUpkeep;
  days(game, 900);
  const grown = population(game) / month6 - 1, added = streets(game, before);
  // At month six some reserved homes are still being built; their residents arrive later.
  assert.ok(grown >= .2 && grown <= .6, `towns grow ${Math.round(grown * 100)}% from month 6 to year 3`);
  assert.ok(added.length >= 6, `${added.length} street tiles`);
  for (const { x, y, tile, was } of added) {
    assert.equal(tile.publicRoad, true, `${x},${y} is a public street`);
    assert.ok(['grass', 'sand', 'snow', 'forest'].includes(was.terrain) && !was.rail && !was.zone && !was.building, `${x},${y} was open land`);
    assert.ok(game.stations.every(stop => Math.max(Math.abs(stop.x - x), Math.abs(stop.y - y)) > 2), `${x},${y} keeps clear of stops`);
  }
  assert.equal(game.infrastructureUpkeep, upkeep, 'public streets cost the company nothing');
  assert.ok(game.cities.every(city => Number.isInteger(city.lastStreetDay) && city.lastStreetDay <= game.day));
  assert.equal(validateGame(game), true);
});

test('town streets never take water, rock, zones, rails, station surroundings or the stroke being drawn', () => {
  const game = servedTowns();
  for (let x = 20; x <= 66; x++) {
    tileAt(game, x, 22).terrain = 'water'; tileAt(game, x, 38).terrain = 'rock';
    if (x % 4 === 0) tileAt(game, x, 25).rail = true;
  }
  for (const [x, y] of [[26, 34], [36, 27], [44, 33], [60, 26]]) { tileAt(game, x, y).zone = 'residential'; game.zones.push({ x, y, kind: 'residential', progress: 0 }); }
  days(game, 180);
  const before = structuredClone(game.tiles), drawn = structuredClone(game), preview = [];
  for (let y = 23; y <= 37; y++) for (let x = 20; x <= 66; x++) if (!tileAt(game, x, y).road) preview.push({ x, y });
  days(game, 900); days(drawn, 900, 1, { reserved: preview });
  const added = streets(game, before);
  assert.ok(added.length > 0, 'the towns still find room');
  assert.deepEqual(streets(drawn, before), [], 'a stroke being drawn is never built over');
  for (const { x, y, was } of added) {
    assert.ok(!['water', 'rock', 'mountain'].includes(was.terrain) && !was.rail && !was.zone, `${x},${y}`);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) assert.ok(!tileAt(game, x + dx, y + dy)?.rail, `${x},${y} keeps clear of rails`);
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) assert.ok(!before[(y - dy) * game.width + x - dx].zone, `${x},${y} leaves room for a zone to grow`);
  }
});

test('street growth is identical across frame partitions and survives a save', () => {
  const whole = servedTowns(), frames = structuredClone(whole);
  days(whole, 540); days(frames, 540, .25);
  assert.ok(whole.cities.some(city => city.lastStreetDay !== undefined), 'a street was laid');
  equivalent(frames, whole);
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(whole))));
  assert.ok(restored);
  assert.deepEqual(restored.tiles, whole.tiles);
  assert.deepEqual(restored.cities.map(city => city.lastStreetDay), whole.cities.map(city => city.lastStreetDay));
  for (const lastStreetDay of [whole.day + 1, -1, '12']) assert.equal(validateGame({ ...whole, cities: [{ ...whole.cities[0], lastStreetDay }, ...whole.cities.slice(1)] }), false);
});

test('a larger town reaches further for new lots', () => {
  const game = servedTowns();
  days(game, 180);
  const [small, large] = [structuredClone(game), structuredClone(game)];
  large.cities[0].population = 4000;
  const reach = town => Math.max(0, ...town.tiles.flatMap((tile, index) => tile.building?.populationCityId === town.cities[0].id && !game.tiles[index].building ? [Math.max(Math.abs(index % town.width - 30), Math.abs(Math.floor(index / town.width) - 30))] : []));
  days(small, 360); days(large, 360);
  assert.ok(reach(large) >= 8, `a town of 4,000 builds ${reach(large)} tiles out`);
  assert.ok(reach(small) <= 6 + Math.floor(Math.sqrt(small.cities[0].population / 400)), `a town of ${Math.round(small.cities[0].population)} builds ${reach(small)} tiles out`);
});

test('the town outlook counts the road-side lots within reach, and none once they are built on', () => {
  const game = emptyGame();
  build(game, 'city', 30, 30); buildPath(game, 'road', line(27, 33, 30));
  const town = game.cities[0], lots = [...line(26, 34, 29), ...line(26, 34, 31), { x: 26, y: 30 }, { x: 34, y: 30 }];
  assert.deepEqual([townOutlook(game, town).plots, townOutlook(game, town).reach], [lots.length, 6], 'a seven-tile street on open grass');
  assert.equal(townOutlook(game, town), townOutlook(game, town), 'counted once per day and revision');
  for (const { x, y } of line(26, 34, 31)) tileAt(game, x, y).terrain = 'rock';
  game.revision++;
  assert.equal(townOutlook(game, town).plots, lots.length - 9, 'rock is no plot');
  for (const { x, y } of lots) placeBuildingSite(game, 'house-cheap-1', x, y);
  game.revision++;
  assert.equal(townOutlook(game, town).plots, 0, 'a built-up street has no room left');
});

test('towns keep their last four monthly counts, and the outlook reads growth from them', () => {
  const game = servedTowns(), [town] = game.cities;
  days(game, 20);
  assert.equal(town.popHistory, undefined);
  assert.deepEqual([townOutlook(game, town).change, townOutlook(game, town).days], [null, null], 'nothing to compare in the first month');
  days(game, 161);
  assert.equal(game.day, 181, '1 July 1950');
  for (const city of game.cities) {
    assert.equal(city.popHistory.length, 4);
    assert.ok(city.popHistory.every(Number.isInteger));
    assert.equal(city.popHistory.at(-1), Math.floor(city.population));
  }
  const outlook = townOutlook(game, town);
  assert.equal(outlook.days, 91, 'since the count on 1 April');
  assert.equal(outlook.change, Math.floor(town.population) - town.popHistory[0]);
  assert.ok(outlook.change > 0, 'a served town grows');
  assert.equal(outlook.growth, town.growth);
  assert.equal(validateGame(game), true);
  for (const popHistory of [Array(13).fill(1), [-1], [NaN], [Infinity], '120', [1, '2'], {}]) assert.equal(validateGame({ ...game, cities: [{ ...town, popHistory }, ...game.cities.slice(1)] }), false, JSON.stringify(popHistory));
  const restored = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.deepEqual(restored.cities.map(city => city.popHistory), game.cities.map(city => city.popHistory));

  // A save from before the counts loads, and starts counting at the next month.
  for (const city of game.cities) delete city.popHistory;
  const legacy = restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
  assert.ok(legacy);
  assert.equal(townOutlook(legacy, legacy.cities[0]).change, null);
  days(legacy, 31);
  assert.ok(legacy.cities.every(city => city.popHistory.length === 1));
  assert.equal(validateGame(legacy), true);
});
