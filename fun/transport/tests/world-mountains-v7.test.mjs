import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateTerrainV2 } from '../world-terrain-v2.js';
import { applyMountainReliefV7 } from '../world-mountains-v7.js';
import { generateWorld, WORLD_SIZES, WORLD_GENERATION_VERSION } from '../world.js';
import { createGame, findPath, INDUSTRIES, tick, validateGame } from '../model.js';
import { surfaceHeight, tileSurface, MAX_HEIGHT } from '../terrain-geometry.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const config = WORLD_SIZES.square512;
const frozenRecipe6 = {
  taiga: 'a29b66c49ce612eb7084ffc475f00684dca03ca8087c1fd4dd1cb7d8bc1e53cc',
  tundra: 'f91b783cff75fdad31de1b98bebbcf5b870b015419959ad7a1a98996795446cb',
  desert: 'ce7ef76be910e26d4270e61ee91498903490b3480ac89d0ac00bda7ab879c434',
};
const frozenRecipe7 = {
  taiga: 'bf32ef9d930d404650e71ec61230ef5366b44e0d953a20438b10a9a5d2a49e5a',
  tundra: 'b0d80566e19de0d4aea7b4d34a68c025c4b73ca739649a887a95d06dc5e3d17f',
  desert: 'afe77cf7259375f0c778f83afd756347a10e230cd97baf47b68ce45bc666c546',
};
const terrain = (biome, seed = 1847) => generateTerrainV2(biome, seed, config, { naturalRelief: true });

for (const biome of ['taiga', 'tundra', 'desert']) {
  test(`${biome}: recipe 7 remains byte-exact after standardizing industry sites`, () => {
    assert.equal(digest(generateWorld(biome, 1847, 'square512', 7)), frozenRecipe7[biome]);
  });

  test(`${biome}: recipe 6 remains byte-exact after introducing mountain relief`, () => {
    assert.equal(digest(generateWorld(biome, 1847, 'square512', 6)), frozenRecipe6[biome]);
  });

  test(`${biome}: local saved peaks reach maximum height while water, opening land and broad valleys survive`, () => {
    const context = terrain(biome), tiles = context.tiles, references = tiles.slice();
    const opening = (x, y) => x >= context.starterX - 40 && x <= context.starterX + 64 && y >= context.starterY - 32 && y <= context.starterY + 32;
    const fixed = tiles.flatMap((tile, i) => tile.terrain === 'water' || opening(i % config.width, Math.floor(i / config.width)) ? [i] : []);
    const before = digest(fixed.map(i => tiles[i]));
    const oldElevations = Float64Array.from(tiles, tile => tile.elevation);
    const result = applyMountainReliefV7(context, biome, 1847, config);
    assert.equal(context.tiles, tiles);
    assert.equal(digest(fixed.map(i => tiles[i])), before, 'all water and protected opening tiles remain exact');
    assert.ok(result.features >= 20 && result.features <= 100, 'sparse local mountains leave room for towns and networks');
    let dry = 0, valleys = 0, mountain = 0;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      assert.equal(tile, references[i], 'relief modifies the original tile, without replacing world objects');
      assert.ok(tile.elevation >= 0 && tile.elevation <= 1);
      if (tile.terrain !== 'water') { dry++; if (tile.elevation < .595) valleys++; }
      if (tile.terrain === 'mountain') { mountain++; assert.ok(tile.elevation >= .665); }
    }
    assert.ok(valleys / dry > .85, 'most dry land remains broad buildable valleys');
    assert.ok(mountain / dry > .01 && mountain / dry < .09);
    const world = { ...config, tiles, revision: 0 };
    const fullPeaks = result.summits.filter(peak => surfaceHeight(world, peak.x, peak.y) === MAX_HEIGHT);
    assert.ok(fullPeaks.length > 10, 'the actual shared-vertex mesh reaches maximum height, not just the raw elevation');
    for (const peak of result.summits) assert.ok(oldElevations[peak.y * config.width + peak.x] >= .565, 'mountain sites favor pre-existing highlands');
    let localRelief = 0;
    for (const peak of fullPeaks) {
      const edgeHeights = [[16, 0], [-16, 0], [0, 16], [0, -16]].map(([dx, dy]) => surfaceHeight(world, peak.x + dx, peak.y + dy));
      if (edgeHeights.filter(height => height < MAX_HEIGHT * .66).length >= 3) localRelief++;
    }
    assert.ok(localRelief >= fullPeaks.length * .75, 'peaks descend into nearby valleys rather than forming vast flat shelves');
    const repeat = terrain(biome);
    assert.deepEqual(applyMountainReliefV7(repeat, biome, 1847, config), result);
    assert.equal(digest(repeat.tiles), digest(tiles), 'saved recipe is deterministic');
  });

  test(`${biome}: recipe 7 keeps complete industries, connected starter services and a profitable opening`, () => {
    const game = createGame({ biome, seed: 1847, size: 'square512', generationVersion: 7 });
    assert.equal(game.generationVersion, 7);
    assert.equal(WORLD_GENERATION_VERSION, 9);
    assert.equal(validateGame(game), true);
    assert.equal(game.cities.length, 48);
    for (const [kind, definition] of Object.entries(INDUSTRIES)) if (!definition.buildOnly&&definition.biomes.includes(biome)) {
      assert.equal(game.industries.filter(site => site.kind === kind).length, 8, `${kind} is available in every district`);
    }
    assert.equal(game.routes[0].path.length, 25);
    for (const route of game.routes) {
      const [from, to] = route.stops.map(id => game.stations.find(station => station.id === id));
      assert.ok(findPath(game, from, to, route.mode)?.length > 1);
      assert.ok(game.vehicles.some(vehicle => vehicle.routeId === route.id));
    }
    const [from, to] = game.cities.slice(0, 2).map(city => ({ x: city.x, y: city.y + 5 }));
    assert.ok(findPath(game, from, to, 'water')?.length > 2);
    const startMoney = game.money;
    for (let quarter = 0; quarter < 480; quarter++) tick(game, .25);
    assert.ok(game.totalDelivered > 0 && game.totalRevenue > 0 && game.money > startMoney);
  });
}

test('different seeds produce different irregular mountain positions and summit heights', () => {
  const a = terrain('taiga'), b = terrain('taiga', 7193);
  const first = applyMountainReliefV7(a, 'taiga', 1847, config), second = applyMountainReliefV7(b, 'taiga', 7193, config);
  assert.notDeepEqual(first.summits, second.summits);
  assert.ok(new Set(first.summits.map(peak => peak.height)).size >= 3);
  assert.ok(new Set(first.summits.map(peak => peak.x % 40)).size >= 15);
  assert.ok(new Set(first.summits.map(peak => peak.y % 40)).size >= 15);
});


for (const biome of ['taiga', 'tundra', 'desert']) for (const seed of [1847, 418, 7193]) {
  test(`${biome} seed ${seed}: eight vertex levels retain middle ground, high summits and broad flat parcels`, () => {
    const world = generateWorld(biome, seed, 'square512', 7), levels = Array(MAX_HEIGHT + 1).fill(0);
    let dry = 0, flat = 0, sampled = 0;
    assert.equal(MAX_HEIGHT, 7, 'eight available levels include sea level zero');
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const tile = world.tiles[y * world.width + x], height = surfaceHeight(world, x, y);
      assert.ok(Number.isInteger(height) && height >= 0 && height <= MAX_HEIGHT, 'every grid vertex uses a discrete level');
      if (tile.terrain === 'water') { assert.equal(height, 0); continue; }
      levels[height]++; dry++;
      if (x % 4 === 0 && y % 4 === 0) {
        const surface = tileSurface(world, x, y);
        assert.equal(surface.triangles.length, 2, 'each tile has two planes');
        assert.equal(surface.center.height, (surface.nw.height + surface.se.height) / 2, 'tile center lies on the shared NW-SE diagonal');
        sampled++; if (surface.corners.every(corner => corner.height === surface.nw.height)) flat++;
      }
    }
    assert.ok((levels[3] + levels[4]) / dry > .8, 'the large majority of dry vertices are middle levels three and four');
    assert.ok(levels[MAX_HEIGHT] > 10, 'each climate and seed retains several true maximum-height summits');
    assert.ok(flat / sampled > .65, 'most sampled dry tiles remain flat and easy to build on');
  });
}
