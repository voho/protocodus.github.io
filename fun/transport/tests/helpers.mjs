import { createGame } from '../model.js';

export function emptyGame(biome = 'taiga') {
  const game = createGame({ biome, size: 'regional', seed: 1847 });
  for (const tile of game.tiles) Object.assign(tile, {
    terrain: biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass',
    detail: '', publicRoad: false,
    road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null,
  });
  for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) game[key] = [];
  game.money = 1_000_000;
  game.revision++;
  if (game.networkRevision !== undefined) game.networkRevision++;
  return game;
}

export const tileAt = (game, x, y) => game.tiles[y * game.width + x];
export const line = (x1, x2, y) => Array.from({ length: x2 - x1 + 1 }, (_, index) => ({ x: x1 + index, y }));
export const advance = (game, days, tick) => { for (let n = 0; n < days * 4; n++) tick(game, .25); };
