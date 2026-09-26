import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrainV2 } from '../world-terrain-v2.js';
import { populateWorldV2 } from '../world-placement-v2.js';
import { expandGeneratedIndustrySites, industrySiteProblem } from '../industry-sites.js';
import { WORLD_SIZES } from '../world.js';
import { createGame, findPath, restoreGame, validateGame } from '../model.js';
import { encodeGame } from '../save-codec.js';

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
    assert.equal(game.generationVersion, 4);
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
