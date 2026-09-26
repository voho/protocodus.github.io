import { terrainLevel, TERRAIN_LEVELS } from './terrain-elevation.js';
import { industryContains } from './industry-sites.js';

export const SPAN_TOOLS = new Set(['bridge', 'railbridge', 'tunnel', 'railtunnel']);
const tileAt = (game, x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
const at = (point, x, y) => point.x === x && point.y === y;
const occupied = (game, x, y) => game.industries.some(i => industryContains(i, x, y)) || game.cities.some(c => at(c, x, y));

export function terraformProblem(game, tool, x, y) {
  const tile = tileAt(game, x, y);
  if (!tile) return 'Choose a tile inside the map.';
  if (tool !== 'raise' && tool !== 'lower') return 'Choose Raise or Lower terrain.';
  if (tile.terrain === 'water') return 'Shape dry land; rivers and seas keep their shoreline.';
  if (tile.building || tile.zone || tile.road || tile.rail || tile.bridge || tile.tunnel || occupied(game, x, y) || game.stations.some(s => at(s, x, y))) return 'Clear buildings, zones and networks before changing this tile’s level.';
  const level = terrainLevel(tile);
  if (tool === 'raise' && level >= TERRAIN_LEVELS) return `Highest terrain level is ${TERRAIN_LEVELS}.`;
  if (tool === 'lower' && level <= 1) return 'Lowest dry-land level is 1.';
  return null;
}

// Only interiors carry a deck/bore level. Ordinary network tiles keep their
// original grade rules; a structure can be entered only along its own axis.
export function transportElevation(tile) {
  return Number.isInteger(tile?.structureLevel) ? tile.structureLevel / TERRAIN_LEVELS : tile?.elevation || 0;
}
export function networkEdgeAllowed(a, b, dx, dy, mode) {
  if (mode === 'water') return true;
  if (!a?.structureAxis && !b?.structureAxis) return true;
  const axis = dx ? 'x' : 'y';
  if ((a.structureAxis && a.structureAxis !== axis) || (b.structureAxis && b.structureAxis !== axis)) return false;
  const level = tile => tile.structureLevel ?? terrainLevel(tile);
  return level(a) === level(b);
}
export function validStructureMetadata(tile) {
  if (tile.structureLevel === undefined && tile.structureAxis === undefined) return true;
  return Number.isInteger(tile.structureLevel) && tile.structureLevel >= 1 && tile.structureLevel <= TERRAIN_LEVELS && ['x', 'y'].includes(tile.structureAxis) && Boolean(tile.road) !== Boolean(tile.rail) && Boolean(tile.bridge) !== Boolean(tile.tunnel) &&
    (tile.bridge ? tile.terrain === 'water' || terrainLevel(tile) < tile.structureLevel : tile.terrain !== 'water' && terrainLevel(tile) > tile.structureLevel);
}

/** Geometry and occupancy only: callers add prices, then commit atomically. */
export function planStructureSpan(game, tool, points) {
  const mode = tool.startsWith('rail') ? 'rail' : 'road', structure = tool.endsWith('bridge') ? 'bridge' : 'tunnel';
  const fail = message => ({ ok: false, message, placements: [], cost: 0, structure });
  if (!SPAN_TOOLS.has(tool)) return fail('Choose a bridge or tunnel.');
  if (!Array.isArray(points) || points.length < 3) return fail('Drag a straight span of at least 3 tiles, including both ends.');
  const first = points[0], last = points.at(-1);
  if (!first || !last || (first.x !== last.x && first.y !== last.y)) return fail('Bridges and tunnels must be straight.');
  const axis = first.y === last.y ? 'x' : 'y', direction = Math.sign(last[axis] - first[axis]);
  if (!direction) return fail('Choose two different endpoints.');
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || !tileAt(game, p.x, p.y)) return fail('Keep the whole span inside the map.');
    if (p[axis] !== first[axis] + i * direction || p[axis === 'x' ? 'y' : 'x'] !== first[axis === 'x' ? 'y' : 'x']) return fail('Drag one continuous, straight span.');
  }
  const start = tileAt(game, first.x, first.y), end = tileAt(game, last.x, last.y), level = terrainLevel(start);
  if ([start, end].some(t => ['water', 'mountain'].includes(t.terrain) || t.bridge || t.tunnel)) return fail('Both ends need open dry land, outside existing bridges or tunnels.');
  if (level < 1 || level !== terrainLevel(end)) return fail(`Match both ends: start level ${level}, end level ${terrainLevel(end)}. Use Raise or Lower.`);
  const placements = [];
  for (let i = 0; i < points.length; i++) {
    const { x, y } = points[i], tile = tileAt(game, x, y), interior = i > 0 && i < points.length - 1;
    if (tile.building || tile.zone || occupied(game, x, y)) return fail('Clear buildings and zones along the span first.');
    const station = game.stations.find(s => at(s, x, y));
    if (station && (interior || station.mode !== mode)) return fail('Keep stations outside the span on a matching network.');
    if (interior) {
      if (structure === 'bridge' && tile.terrain !== 'water' && terrainLevel(tile) >= level) return fail(`Bridge deck is level ${level}; every middle tile must be lower or water.`);
      if (structure === 'tunnel' && (tile.terrain === 'water' || terrainLevel(tile) <= level)) return fail(`Tunnel is level ${level}; every middle tile must be higher dry land.`);
      const same = tile[mode] && tile[structure] && tile.structureLevel === level && tile.structureAxis === axis;
      if ((tile.road || tile.rail || tile.bridge || tile.tunnel) && !same) return fail('Clear existing networks inside the span first.');
      if (tile[mode === 'road' ? 'rail' : 'road']) return fail('Each span carries one transport mode.');
    }
    placements.push({ x, y, tool: interior ? tool : mode, interior, level, axis });
  }
  return { ok: true, message: `${structure === 'bridge' ? 'Bridge' : 'Tunnel'} · level ${level}`, placements, level, axis, mode, structure };
}
