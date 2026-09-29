// DOM-free station geometry shared by the simulation, planners and renderer.
// Stops and ports occupy their one tile; an airport occupies a 6 × 2 site whose
// saved anchor is its north-west (lowest x, lowest y) tile. Leaf module: it
// imports nothing, so building, industry and terrain checks can all use it.
export const STATION_RADIUS = 5;
/** Towns count when their centre is within this many tiles of any airport tile. */
export const AIRPORT_REACH = 7;
/** Runway tiles along the axis, and rows across it (runway row + apron row). */
export const AIRPORT_LENGTH = 6, AIRPORT_WIDTH = 2;
/** Shortest flight, in path tiles (Manhattan distance between the two anchors). */
export const AIRPORT_MIN_TILES = 16;
/** Days on the ground at each airport: landing roll, taxi, boarding, taxi, take-off roll. */
export const AIR_TURNAROUND = 1.6;
/** A newly bought plane starts at its stand, ready to taxi out: the taxi-out and take-off roll remain. */
export const AIR_DEPARTURE_DWELL = .55;
export const AIRPORT_TOOLS = new Set(['airport-x', 'airport-y']);

export function stationSpan(station) {
  if (station?.mode !== 'air') return { w: 1, h: 1 };
  return station.axis === 'y' ? { w: AIRPORT_WIDTH, h: AIRPORT_LENGTH } : { w: AIRPORT_LENGTH, h: AIRPORT_WIDTH };
}
export const stationReach = station => station?.mode === 'air' ? AIRPORT_REACH : STATION_RADIUS;
/** Euclidean distance from a point to the station's nearest tile; exactly distance() for one-tile stops. */
export function stationDistance(station, point) {
  const { w, h } = stationSpan(station);
  return Math.hypot(Math.max(station.x - point.x, 0, point.x - station.x - w + 1), Math.max(station.y - point.y, 0, point.y - station.y - h + 1));
}
export const stationServes = (station, point) => stationDistance(station, point) <= stationReach(station);
export function stationContains(station, x, y) {
  const { w, h } = stationSpan(station);
  return x >= station.x && y >= station.y && x < station.x + w && y < station.y + h;
}
export function stationTiles(station) {
  const { w, h } = stationSpan(station), tiles = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) tiles.push({ x: station.x + dx, y: station.y + dy });
  return tiles;
}
// Occupancy is looked up per tile by construction checks, ecology and growth.
// One map per stations array; build(), bulldozing and loading replace or grow it.
const indexes = new WeakMap();
export function stationSiteAt(game, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= game.width || y >= game.height) return null;
  const stations = game.stations || [];
  let entry = indexes.get(game), revision = game.networkRevision || 0;
  // Every station build or removal bumps networkRevision; the array checks also catch direct edits in tests.
  if (!entry || entry.revision !== revision || entry.stations !== stations || entry.length !== stations.length || entry.last !== stations.at(-1)) {
    const map = new Map();
    for (const station of stations) for (const p of stationTiles(station)) map.set(p.y * game.width + p.x, station);
    entry = { revision, stations, length: stations.length, last: stations.at(-1), map };
    indexes.set(game, entry);
  }
  return entry.map.get(y * game.width + x) || null;
}
/** Straight flight as a 4-connected staircase between two tiles: every saved-path invariant holds, and its
 * length is the Manhattan distance the fare uses. Ties step along y, so the result is deterministic. */
export function airPath(game, from, to) {
  const inside = p => p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < game.width && p.y < game.height;
  if (!inside(from) || !inside(to)) return null;
  const nx = Math.abs(to.x - from.x), ny = Math.abs(to.y - from.y), sx = Math.sign(to.x - from.x), sy = Math.sign(to.y - from.y);
  const path = new Array(nx + ny + 1);
  let x = from.x, y = from.y, ix = 0, iy = 0;
  path[0] = { x, y };
  for (let n = 1; n <= nx + ny; n++) {
    if (iy >= ny || (ix < nx && (.5 + ix) / nx < (.5 + iy) / ny)) { x += sx; ix++; } else { y += sy; iy++; }
    path[n] = { x, y };
  }
  return path;
}
