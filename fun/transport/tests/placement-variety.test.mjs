import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrainV2 } from '../world-terrain-v2.js';
import { populateWorldV2 } from '../world-placement-v2.js';
import { NEW_WORLD_SIZES } from '../world.js';
import { INDUSTRIES } from '../data.js';

const config = NEW_WORLD_SIZES.square512;
function createTerrain(biome, seed) {
  const context = generateTerrainV2(biome, seed, config);
  const game = { width: config.width, height: config.height, size: 'square512', generationVersion: 2, tiles: context.tiles, cities: [], industries: [], zones: [], stations: [], routes: [], vehicles: [] };
  return { game, context };
}
const terrainCodes = ['grass', 'snow', 'sand', 'forest', 'rock', 'mountain', 'water'];

for (const biome of ['taiga', 'tundra', 'desert']) test(`${biome}: varied settlements respect existing habitats and retain full production chains`, () => {
  for (const seed of [1, 1847, 987654]) {
    const { game, context } = createTerrain(biome, seed);
    const before = Uint8Array.from(game.tiles, tile => terrainCodes.indexOf(tile.terrain));
    populateWorldV2(game, biome, seed, config, context);
    assert.equal(game.cities.length, config.towns);
    assert.equal(new Set(game.cities.map(city => city.name)).size, config.towns);
    for (const [kind, definition] of Object.entries(INDUSTRIES)) if (definition.biomes.includes(biome)) assert.equal(game.industries.filter(site => site.kind === kind).length, config.clusters);
    assert.equal(new Set(game.industries.map(site => site.y * game.width + site.x)).size, game.industries.length);
    for (const site of game.industries) {
      const index = site.y * game.width + site.x, previous = terrainCodes[before[index]], current = game.tiles[index];
      assert.ok(!current.road && !current.building && current.terrain !== 'water');
      if (site.kind.includes('mine') || site.kind === 'quarry') assert.ok(['rock', 'mountain'].includes(previous), `${site.kind} follows a real rock deposit`);
      if (site.kind === 'logging-camp') assert.equal(previous, 'forest', 'timber comes from an existing forest');
      if (site.kind === 'farm') assert.equal(previous, 'grass', 'farmland follows fertile ground');
      if (site.kind === 'sand-pit') assert.equal(previous, 'sand');
      if (INDUSTRIES[site.kind].coastal) assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => before[(site.y + dy) * game.width + site.x + dx] === 6), 'fisheries occupy a natural water bank');
    }
    const buildingCounts = game.cities.slice(2).map(city => {
      let count = 0;
      for (let y = city.y - 12; y <= city.y + 12; y++) for (let x = city.x - 12; x <= city.x + 12; x++) if (game.tiles[y * game.width + x]?.building) count++;
      return count;
    });
    assert.ok(new Set(buildingCounts).size >= 20, 'settlements have substantially different footprints');
    assert.ok(Math.min(...buildingCounts) < 30 && Math.max(...buildingCounts) > 60, 'small hamlets and large town cores coexist');
    for (let index = 0; index < game.tiles.length; index++) {
      const tile = game.tiles[index];
      if (tile.building) assert.notEqual(before[index], 6, 'settlement buildings do not reclaim natural water');
      if (before[index] === 6) assert.equal(tile.terrain, 'water', 'industry placement never turns a shoreline into land');
      if (tile.road) {
        assert.equal(tile.publicRoad, true);
        if (tile.terrain === 'water') { assert.equal(tile.bridge, true); assert.equal(tile.elevation, 0); }
      }
    }
  }
});

test('a neighbouring town street never removes an existing building', () => {
  const seed = 1847, biome = 'taiga', first = createTerrain(biome, seed);
  populateWorldV2(first.game, biome, seed, config, first.context);
  const index = first.game.tiles.findIndex((tile, index) => tile.road && first.game.cities.slice(0, 2).every(city => Math.hypot(index % config.width - city.x, Math.floor(index / config.width) - city.y) > 20));
  assert.ok(index >= 0);
  const second = createTerrain(biome, seed), landmark = { kind: 'church', level: 3 };
  second.game.tiles[index].building = landmark;
  populateWorldV2(second.game, biome, seed, config, second.context);
  assert.equal(second.game.tiles[index].building, landmark);
  assert.equal(second.game.tiles[index].road, false);
});
