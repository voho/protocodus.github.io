import { landHeightLevel, LAND_HEIGHT_LEVELS, TERRAIN_LEVELS } from './terrain-elevation.js';
import { surfaceChangesSince } from './change-journal.js';

export const TERRAIN_TILE_SIZE = 32;
export const HEIGHT_STEP = 24;
export const MAX_VISUAL_HEIGHT = LAND_HEIGHT_LEVELS;
export const MAX_HEIGHT = MAX_VISUAL_HEIGHT;
export const TERRAIN_SLOPE_LIMIT = 1;
const CHUNK = 32, HALO = 8, CACHE_LIMIT = 96, BRIDGE_SCAN = 2048;
const caches = new WeakMap();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const tileAt = (game, x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
const toVisual = level => Math.round(clamp(level, 0, TERRAIN_LEVELS) * MAX_VISUAL_HEIGHT / TERRAIN_LEVELS);
function cacheFor(game) {
  let cache = caches.get(game);
  if (!cache || cache.tiles !== game.tiles || cache.revision !== game.revision || cache.width !== game.width || cache.height !== game.height) {
    // Ecology never changes elevation, water or bridges: its fields stay exact.
    if (cache && cache.tiles === game.tiles && cache.width === game.width && cache.height === game.height && surfaceChangesSince(game, cache.revision) !== null) { cache.revision = game.revision; return cache; }
    cache = { tiles: game.tiles, revision: game.revision, width: game.width, height: game.height, columns: Math.floor(game.width / CHUNK) + 1, chunks: new Map(), hotKey: -1, hotHeights: null, bridges: new Map(), bridgeSpans: new Map(), sampledTiles: 0, builtChunks: 0 };
    caches.set(game, cache);
  }
  return cache;
}

// Grid vertices have eight integer heights, 0–7. The Chebyshev lower envelope
// min(sourceHeight + distance) limits every neighboring vertex, diagonals
// included, to one level. Water-touching vertices are zero before this pass,
// so even concave coastlines obey the same slope bound. A local halo is enough:
// a source more than seven vertices away cannot lower the maximum height.
function fieldChunk(game, cx, cy) {
  const cache = cacheFor(game), key = cy * cache.columns + cx;
  // Adjacent corner queries normally touch the same field. Keep that field hot
  // without allocating string keys or rewriting the LRU for every vertex.
  if (cache.hotKey === key) return cache.hotHeights;
  let heights = cache.chunks.get(key);
  if (heights) { cache.chunks.delete(key); cache.chunks.set(key, heights); cache.hotKey = key; cache.hotHeights = heights; return heights; }
  const size = CHUNK + HALO * 2, stride = size + 1, field = new Uint8Array(size * size), sources = new Uint8Array(stride * stride), water = new Uint8Array(stride * stride), ox = cx * CHUNK - HALO, oy = cy * CHUNK - HALO;
  // Read each underlying tile once; the one-tile collar supplies all four
  // cells touching a vertex without multiplying viewport source reads.
  for (let y = 0; y < stride; y++) for (let x = 0; x < stride; x++) {
    const tile = game.tiles[clamp(oy + y - 1, 0, game.height - 1) * game.width + clamp(ox + x - 1, 0, game.width - 1)], index = y * stride + x;
    sources[index] = landHeightLevel(tile); water[index] = tile.terrain === 'water' ? 1 : 0;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nw = y * stride + x, se = nw + stride + 1;
    field[y * size + x] = water[nw] || water[nw + 1] || water[se - 1] || water[se] ? 0 : sources[se];
  }
  // Two directional chamfer sweeps compute the exact unit-cost 8-neighbor
  // distance transform, including arbitrary lower source heights.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (x) field[i] = Math.min(field[i], field[i - 1] + 1);
    if (y) {
      field[i] = Math.min(field[i], field[i - size] + 1);
      if (x) field[i] = Math.min(field[i], field[i - size - 1] + 1);
      if (x + 1 < size) field[i] = Math.min(field[i], field[i - size + 1] + 1);
    }
  }
  for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
    const i = y * size + x;
    if (x + 1 < size) field[i] = Math.min(field[i], field[i + 1] + 1);
    if (y + 1 < size) {
      field[i] = Math.min(field[i], field[i + size] + 1);
      if (x) field[i] = Math.min(field[i], field[i + size - 1] + 1);
      if (x + 1 < size) field[i] = Math.min(field[i], field[i + size + 1] + 1);
    }
  }
  heights = new Uint8Array(CHUNK * CHUNK);
  for (let y = 0; y < CHUNK; y++) heights.set(field.subarray((y + HALO) * size + HALO, (y + HALO) * size + HALO + CHUNK), y * CHUNK);
  cache.chunks.set(key, heights); cache.sampledTiles += sources.length; cache.builtChunks++;
  if (cache.chunks.size > CACHE_LIMIT) cache.chunks.delete(cache.chunks.keys().next().value);
  cache.hotKey = key; cache.hotHeights = heights;
  return heights;
}
function vertexHeight(game, x, y) {
  x = clamp(x, 0, game.width); y = clamp(y, 0, game.height);
  const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
  return fieldChunk(game, cx, cy)[(y - cy * CHUNK) * CHUNK + x - cx * CHUNK];
}
function heightsForTile(game, x, y) {
  if (x >= 0 && y >= 0 && x + 1 <= game.width && y + 1 <= game.height && x % CHUNK < CHUNK - 1 && y % CHUNK < CHUNK - 1) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), heights = fieldChunk(game, cx, cy), i = (y - cy * CHUNK) * CHUNK + x - cx * CHUNK;
    return { nw: heights[i], ne: heights[i + 1], se: heights[i + CHUNK + 1], sw: heights[i + CHUNK], center: (heights[i] + heights[i + CHUNK + 1]) / 2 };
  }
  const nw = vertexHeight(game, x, y), ne = vertexHeight(game, x + 1, y), se = vertexHeight(game, x + 1, y + 1), sw = vertexHeight(game, x, y + 1);
  return { nw, ne, se, sw, center: (nw + se) / 2 };
}

// Every quadrilateral uses the same NW–SE split for painting and picking.
// Both faces have diagonal derivative hSE-hNW, bounded to one level. Their
// projected doubled area is 32*(32-HEIGHT_STEP*(hSE-hNW)), strictly positive
// even at the steepest coast; no view-dependent fold or diagonal switching.
export function surfaceHeight(game, u, v) {
  u = clamp(u, 0, game.width); v = clamp(v, 0, game.height);
  if (Number.isInteger(u) && Number.isInteger(v)) return vertexHeight(game, u, v);
  const x = Math.min(Math.floor(u), game.width - 1), y = Math.min(Math.floor(v), game.height - 1), a = u - x, b = v - y;
  if (a === b) return vertexHeight(game, x, y) * (1 - a) + vertexHeight(game, x + 1, y + 1) * a;
  const h = heightsForTile(game, x, y);
  return a >= b ? h.nw + (h.ne - h.nw) * a + (h.se - h.ne) * b : h.nw + (h.se - h.sw) * a + (h.sw - h.nw) * b;
}
// A view may choose a height step in 0–28 px. Only projection changes: height
// continues to hold the original terrain level for engineering and saves.
export function projectTerrainPoint(u, v, height = 0, heightStep = HEIGHT_STEP) {
  return { u, v, x: (u - v) * TERRAIN_TILE_SIZE, y: (u + v) * TERRAIN_TILE_SIZE / 2 - height * heightStep, height };
}
export function projectGround(game, u, v, heightStep = HEIGHT_STEP) { return projectTerrainPoint(u, v, surfaceHeight(game, u, v), heightStep); }
export function tileSurface(game, x, y, heightStep = HEIGHT_STEP) {
  const h = heightsForTile(game, x, y), nw = projectTerrainPoint(x, y, h.nw, heightStep), ne = projectTerrainPoint(x + 1, y, h.ne, heightStep), se = projectTerrainPoint(x + 1, y + 1, h.se, heightStep), sw = projectTerrainPoint(x, y + 1, h.sw, heightStep), center = projectTerrainPoint(x + .5, y + .5, h.center, heightStep);
  return { nw, ne, se, sw, center, corners: [nw, ne, se, sw], triangles: [[nw, ne, se], [nw, se, sw]] };
}
// Decorations need a horizontal surface across their entire footprint. Read
// the same shared vertices as the mesh, including interior points of parcels.
export function groundIsFlat(game, x, y, span = 1) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(span) || span < 1 || x < 0 || y < 0 || x + span > game.width || y + span > game.height) return false;
  const height = vertexHeight(game, x, y);
  for (let v = y; v <= y + span; v++) for (let u = x; u <= x + span; u++) if (vertexHeight(game, u, v) !== height) return false;
  return true;
}
function barycentric(px, py, [a, b, c]) {
  const determinant = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(determinant) < 1e-10) return null;
  const u = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / determinant, v = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / determinant, w = 1 - u - v;
  return u >= -1e-8 && v >= -1e-8 && w >= -1e-8 ? [u, v, w] : null;
}
export function pickGround(game, projectedX, projectedY, heightStep = HEIGHT_STEP) {
  if (!Number.isFinite(projectedX) || !Number.isFinite(projectedY)) return null;
  const baseX = projectedY / TERRAIN_TILE_SIZE + projectedX / (2 * TERRAIN_TILE_SIZE), baseY = projectedY / TERRAIN_TILE_SIZE - projectedX / (2 * TERRAIN_TILE_SIZE), shift = MAX_VISUAL_HEIGHT * heightStep / TERRAIN_TILE_SIZE;
  let best = null, depth = -Infinity;
  for (let y = Math.max(0, Math.floor(baseY) - 1); y <= Math.min(game.height - 1, Math.floor(baseY + shift) + 1); y++) for (let x = Math.max(0, Math.floor(baseX) - 1); x <= Math.min(game.width - 1, Math.floor(baseX + shift) + 1); x++) {
    if (Math.abs(x - y - projectedX / TERRAIN_TILE_SIZE) > 1 + 1e-8) continue;
    for (const triangle of tileSurface(game, x, y, heightStep).triangles) {
      const weights = barycentric(projectedX, projectedY, triangle); if (!weights) continue;
      const u = triangle.reduce((sum, p, i) => sum + p.u * weights[i], 0), v = triangle.reduce((sum, p, i) => sum + p.v * weights[i], 0);
      if (u + v > depth) { best = { x: clamp(u, 0, game.width), y: clamp(v, 0, game.height) }; depth = u + v; }
    }
  }
  return best;
}

function bridgeAxis(game, x, y, mode, tile) {
  if (tile.structureAxis) return tile.structureAxis;
  const score = (dx, dy) => [-1, 1].reduce((sum, sign) => { const t = tileAt(game, x + dx * sign, y + dy * sign); return sum + (t?.[mode] ? 1 : 0) + (t?.bridge ? 1 : 0); }, 0);
  return score(1, 0) >= score(0, 1) ? 'x' : 'y';
}
export function bridgeSurface(game, x, y, mode = 'road') {
  x = Math.round(x); y = Math.round(y); const tile = tileAt(game, x, y);
  if (!tile?.bridge || !tile[mode]) return null;
  const cache = cacheFor(game), key = `${mode}:${x},${y}`, saved = cache.bridges.get(key); if (saved) return saved;
  for (const span of cache.bridgeSpans.values()) if (span.mode === mode && x >= span.x0 && x <= span.x1 && y >= span.y0 && y <= span.y1) return span.surface;
  const axis = bridgeAxis(game, x, y, mode, tile), dx = axis === 'x' ? 1 : 0, dy = axis === 'y' ? 1 : 0, ends = [], points = [{ x, y }];
  for (const sign of [-1, 1]) {
    let end = null;
    for (let step = 1; step <= BRIDGE_SCAN; step++) {
      const px = x + dx * step * sign, py = y + dy * step * sign, next = tileAt(game, px, py);
      if (!next || !next[mode]) break;
      if (!next.bridge) { if (next.terrain !== 'water') end = { x: px, y: py, height: surfaceHeight(game, px + .5, py + .5) }; break; }
      if (next.structureAxis && next.structureAxis !== axis) break;
      points.push({ x: px, y: py });
    }
    ends.push(end);
  }
  const existing = ends.filter(Boolean), height = existing.length ? Math.max(...existing.map(p => p.height)) : Number.isInteger(tile.structureLevel) ? toVisual(tile.structureLevel) : .25;
  const result = { height, axis, from: ends[0], to: ends[1], legacy: tile.structureLevel === undefined };
  // At most one world-width ray in either direction resolves even a continental
  // crossing. Cache its interval, avoiding a scan per visible deck segment.
  cache.bridges.set(key, result);
  cache.bridgeSpans.set(key, { mode, x0: Math.min(...points.map(p => p.x)), x1: Math.max(...points.map(p => p.x)), y0: Math.min(...points.map(p => p.y)), y1: Math.max(...points.map(p => p.y)), surface: result });
  if (cache.bridgeSpans.size > 128) cache.bridgeSpans.delete(cache.bridgeSpans.keys().next().value);
  while (cache.bridges.size > 128) cache.bridges.delete(cache.bridges.keys().next().value);
  return result;
}
export function bridgeDeckHeight(game, x, y, mode = 'road') { return bridgeSurface(game, x, y, mode)?.height ?? null; }
// Per-call scratch for transportHeight: the four neighbouring tile centres.
const nodeWeights = new Float64Array(4), nodeDecks = new Float64Array(4);
export function transportHeight(game, x, y, mode = 'road') {
  if (mode === 'water') return 0;
  const x0 = Math.floor(x), y0 = Math.floor(y), a = x - x0, b = y - y0;
  let nodes = 0, decks = 0;
  for (let k = 0; k < 4; k++) {
    const weight = (k & 1 ? a : 1 - a) * (k & 2 ? b : 1 - b);
    nodeWeights[k] = weight > 1e-12 ? weight : 0;
    if (!nodeWeights[k]) continue;
    nodes++;
    const deck = bridgeDeckHeight(game, x0 + (k & 1), y0 + (k >> 1), mode);
    nodeDecks[k] = deck ?? NaN;
    if (deck !== null) decks++;
  }
  // Away from bridges the ground surface alone decides; it is also the common case.
  if (!decks) return surfaceHeight(game, x + .5, y + .5);
  const ground = k => surfaceHeight(game, x0 + (k & 1) + .5, y0 + (k >> 1) + .5);
  // A bridge tile is flat all the way to its shared bank edge. Only the bank's
  // facing half tile ramps from its ground center to the deck, matching the
  // renderer's raised approach edge instead of lifting the vehicle too late.
  if (nodes === 2) {
    let deck = -1, bank = -1;
    for (let k = 0; k < 4; k++) if (nodeWeights[k]) { if (!Number.isNaN(nodeDecks[k])) { if (deck < 0) deck = k; } else if (bank < 0) bank = k; }
    if (deck >= 0 && bank >= 0) { const level = ground(bank); return level + (nodeDecks[deck] - level) * Math.min(1, nodeWeights[deck] * 2); }
  }
  let sum = 0;
  for (let k = 0; k < 4; k++) if (nodeWeights[k]) sum += (Number.isNaN(nodeDecks[k]) ? ground(k) : nodeDecks[k]) * nodeWeights[k];
  return sum;
}
export function terrainGeometryStats(game) {
  const cache = cacheFor(game);
  return { cachedChunks: cache.chunks.size, cacheLimit: CACHE_LIMIT, bytes: cache.chunks.size * CHUNK * CHUNK, sampledTiles: cache.sampledTiles, builtChunks: cache.builtChunks, bridgeEntries: cache.bridges.size };
}
export function clearTerrainGeometryCache(game) { caches.delete(game); }
