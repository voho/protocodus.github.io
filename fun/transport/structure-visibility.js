// Engineering metadata distinguishes new underground spans from legacy roads
// through mountain tiles, whose established rendering remains unchanged.
export function isEngineeredTunnel(tile) {
  return Boolean(tile?.tunnel && Number.isFinite(tile.structureLevel) && tile.structureLevel >= 1 && ['x', 'y'].includes(tile.structureAxis));
}

// Vehicle positions use tile centers (integer coordinates), rather than corners.
export function isUndergroundAt(game, x, y) {
  const tx = Math.floor(x + .5), ty = Math.floor(y + .5);
  return tx >= 0 && ty >= 0 && tx < game.width && ty < game.height && isEngineeredTunnel(game.tiles[ty * game.width + tx]);
}
