import { networkEdgeAllowed, networkTerrainShape } from './terrain-engineering.js';
import { SPRITE_SCALE } from './sprite-art-direction.js';

const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const tileAt = (game, x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;

// Stops are undirected: reversing a route must not turn its shelter around.
// Existing stops derive their view from the live network, without save fields.
export function stopOrientation(game, station) {
  const { x, y, mode } = station, tile = tileAt(game, x, y);
  const arms = DIRECTIONS.filter(([dx, dy]) => {
    const neighbor = tileAt(game, x + dx, y + dy);
    return tile?.[mode] && neighbor?.[mode] && networkEdgeAllowed(tile, neighbor, dx, dy, mode, game, x, y);
  });
  const alongX = arms.filter(([dx]) => dx).length, alongY = arms.length - alongX;
  const axis = alongX || alongY ? alongY > alongX ? 'y' : 'x' : tile?.structureAxis || networkTerrainShape(game, x, y).axis || 'x';
  // The platform sits outside the carriageway/ballast. At a T or corner,
  // prefer the side without a perpendicular arm; a full junction has a stable
  // northwest-side placement, independent of route order or traffic direction.
  const across = arms.filter(([dx, dy]) => axis === 'x' ? dy : dx).map(([dx, dy]) => axis === 'x' ? dy : dx);
  const side = across.length === 1 ? -across[0] : -1;
  const offset = (mode === 'rail' ? 5.3 : 6) / SPRITE_SCALE.tileMetres;
  const halfLength = (mode === 'rail' ? 7 : 4) / SPRITE_SCALE.tileMetres;
  const halfWidth = (mode === 'rail' ? 2.5 : 1.8) / SPRITE_SCALE.tileMetres;
  // Four-way crossings have no empty side at their centre. Move the platform
  // along the incoming arm until its end clears the crossing carriageway.
  const along = across.length === 2 ? -(halfLength + (mode === 'rail' ? 2.6 : 4) / SPRITE_SCALE.tileMetres + .025) : 0;
  const dx = axis === 'y' ? side * offset : along, dy = axis === 'x' ? side * offset : along;
  return { axis, x: x + dx, y: y + dy, frontX: x + dx + (axis === 'x' ? halfLength : halfWidth), frontY: y + dy + (axis === 'y' ? halfLength : halfWidth) };
}
