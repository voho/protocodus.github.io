import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld, WORLD_GENERATION_VERSION } from '../world.js';
import { build } from '../model.js';
import { siteGap, competingIndustries, industrySpacingProblem, worldSpacingProblem, MIN_SITE_GAP, MIN_PLOT_GAP, MIN_CONNECTION_LENGTH } from '../industry-sites.js';
import { emptyGame } from './helpers.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const structure = tile => tile.road || tile.bridge || tile.building || tile.zone;

// Free tiles (Chebyshev) between each plot and the nearest town street, bridge, building or zone.
function streetClearance(world) {
  let least = Infinity;
  for (const site of world.industries) {
    const size = site.footprint, reach = MIN_CONNECTION_LENGTH + 2;
    for (let y = Math.max(0, site.y - reach); y < Math.min(world.height, site.y + size + reach); y++) for (let x = Math.max(0, site.x - reach); x < Math.min(world.width, site.x + size + reach); x++) {
      if (structure(world.tiles[y * world.width + x])) least = Math.min(least, Math.max(site.x - x, x - (site.x + size - 1), site.y - y, y - (site.y + size - 1)) - 1);
    }
  }
  return least;
}
// Free tiles between the built-up areas of two different towns. Each street or building belongs to its
// nearest town centre; the two opening towns share the road that joins them.
function townClearance(world) {
  const { width, height, tiles, cities } = world, owner = new Int32Array(width * height).fill(-1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tile = tiles[y * width + x];
    if (!tile.road && !tile.building) continue;
    let best = -1, nearest = Infinity;
    cities.forEach((city, index) => { const d = Math.max(Math.abs(city.x - x), Math.abs(city.y - y)); if (d < nearest) { nearest = d; best = index; } });
    if (nearest <= 11) owner[y * width + x] = best;
  }
  let least = Infinity;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const own = owner[y * width + x];
    if (own < 0) continue;
    for (let dy = -MIN_CONNECTION_LENGTH; dy <= MIN_CONNECTION_LENGTH; dy++) for (let dx = -MIN_CONNECTION_LENGTH; dx <= MIN_CONNECTION_LENGTH; dx++) {
      const u = x + dx, v = y + dy, other = u >= 0 && v >= 0 && u < width && v < height ? owner[v * width + u] : -1;
      if (other >= 0 && other !== own && !(own < 2 && other < 2)) least = Math.min(least, Math.max(Math.abs(dx), Math.abs(dy)) - 1);
    }
  }
  return least;
}

for (const biome of ['taiga', 'tundra', 'desert']) {
  test(`${biome}: recipe 13 keeps rivals apart and leaves room for a road around every site`, () => {
    assert.equal(WORLD_GENERATION_VERSION, 13);
    for (const [seed, options] of [[1847, undefined], [9731, { townCount: 96, industryDistricts: 16 }]]) {
      const world = generateWorld(biome, seed, 'square512', 13, options);
      if (options) assert.equal(world.cities.length, options.townCount);
      for (const [i, site] of world.industries.entries()) {
        for (const other of world.industries.slice(i + 1)) {
          const gap = siteGap(site, other);
          assert.ok(gap >= MIN_PLOT_GAP, `${seed}: ${site.name} and ${other.name} leave ${gap - 1} free tiles`);
          if (competingIndustries(site.kind, other.kind)) assert.ok(gap >= MIN_SITE_GAP, `${seed}: rivals ${site.name} and ${other.name} share a stop range`);
        }
        for (const city of world.cities) assert.ok(siteGap(site, city) >= MIN_SITE_GAP, `${seed}: ${site.name} crowds ${city.name}`);
      }
      assert.ok(streetClearance(world) >= MIN_CONNECTION_LENGTH, `${seed}: a plot stands within ${MIN_CONNECTION_LENGTH} tiles of a town`);
      assert.ok(townClearance(world) >= MIN_CONNECTION_LENGTH, `${seed}: two towns grew into each other`);
      // The best sites still grow into cities (1,500 residents or more) on a default map.
      if (!options) assert.ok(world.cities.filter(city => city.population >= 1500).length >= 3);
    }
    assert.equal(digest(generateWorld(biome, 4242, 'square512', 13)), digest(generateWorld(biome, 4242, 'square512', 13)), 'deterministic');
  });
}

test('the world keeps rivals and every plot apart; players may still group unrelated industries', () => {
  // Furniture works and machine works both buy steel; food plant and fish processor both make food.
  assert.equal(competingIndustries('furniture-factory', 'machine-works'), true);
  assert.equal(competingIndustries('food-plant', 'fish-processor'), true);
  assert.equal(competingIndustries('oil-well', 'logging-camp'), false);
  const game = emptyGame();
  assert.equal(build(game, 'furniture-factory', 20, 20).ok, true);
  const rival = 20 + 4 + MIN_SITE_GAP;
  assert.match(worldSpacingProblem(game, 'machine-works', rival - 1, 20), /5-tile road between the industries/);
  assert.equal(worldSpacingProblem(game, 'machine-works', rival, 20), null);
  // An unrelated world plot needs five free tiles between the fences: x 25–29 stay open beside the works at 20–24.
  assert.match(worldSpacingProblem(game, 'oil-well', 29, 20), /5 free tiles between the plots/);
  assert.equal(worldSpacingProblem(game, 'oil-well', 30, 20), null);
  assert.equal(siteGap(game.industries[0], { x: 30, y: 20, footprint: 5 }), MIN_PLOT_GAP);
  // A player may group unrelated plots around one shared stop, as before.
  assert.equal(industrySpacingProblem(game, 'machine-works', rival - 1, 20), null);
  assert.equal(build(game, 'oil-well', 25, 20).ok, true);
});
