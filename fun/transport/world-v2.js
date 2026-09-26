import { generateTerrainV2 } from './world-terrain-v2.js';
import { populateWorldV2 } from './world-placement-v2.js';

// Save recipe 2: irregular natural regions and settlements. Keep this recipe
// available when introducing future geography so existing sparse saves restore.
export function generateWorldV2(biome, seed, size, config, options) {
  const context = generateTerrainV2(biome, seed, config, options);
  const game = {
    width: config.width, height: config.height, size, generationVersion: 2,
    tiles: context.tiles, cities: [], industries: [], zones: [], stations: [], routes: [], vehicles: [],
  };
  populateWorldV2(game, biome, seed, config, context);
  return game;
}
