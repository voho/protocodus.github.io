/** Infinite terrain in tile coordinates. No mutable RNG state or chunk boundaries. */
export const MAP_TILE_SIZE = 100;

const UINT_RANGE = 4294967296;
const mix = value => {
  let n = value >>> 0;
  n = Math.imul(n ^ n >>> 16, 0x21f0aaad);
  n = Math.imul(n ^ n >>> 15, 0x735a2d97);
  return (n ^ n >>> 15) >>> 0;
};
const pointHash = (seed, x, y) => mix(seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77));
const unit = (seed, x, y) => pointHash(seed, x, y) / UINT_RANGE;
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const modulo = (n, period) => ((n % period) + period) % period;

/** Stable uint32 identity; changing either the world name or seed changes the map. */
export function hashLevel(worldId, seed = 'tyran-v2') {
  const text = `${String(seed).length}:${seed}:${worldId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return mix(hash);
}

function noise(seed, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), tx = smooth(x - ix), ty = smooth(y - iy);
  return lerp(lerp(unit(seed, ix, iy), unit(seed, ix + 1, iy), tx),
    lerp(unit(seed, ix, iy + 1), unit(seed, ix + 1, iy + 1), tx), ty);
}

function along(seed, y) {
  const row = Math.floor(y);
  return lerp(unit(seed, 0, row), unit(seed, 0, row + 1), smooth(y - row));
}

// A continuous river crosses the flight corridor. Its course never resets at a
// tile or chunk seam, including when scrolling through negative world rows.
function riverDistance(seed, x, y) {
  const center = 6 + (along(seed ^ 0x4a31, y / 18) - .5) * 10
    + (along(seed ^ 0x7e29, y / 49) - .5) * 5;
  return Math.abs(x - center);
}

function bodies(seed, x, y, asteroid = false) {
  const cellW = asteroid ? 7 : 8, cellH = asteroid ? 8 : 10;
  const cx = Math.floor(x / cellW), cy = Math.floor(y / cellH);
  let height = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy, chance = unit(seed ^ 0x9701, gx, gy);
      if (chance < (asteroid ? .23 : .12)) continue;
      const px = (gx + .25 + unit(seed ^ 0x187d, gx, gy) * .5) * cellW;
      const py = (gy + .25 + unit(seed ^ 0x905b, gx, gy) * .5) * cellH;
      const rx = (asteroid ? 1.5 : 2.2) + unit(seed ^ 0x278f, gx, gy) * 1.8;
      const ry = rx * (.85 + unit(seed ^ 0x9121, gx, gy) * .5);
      const distance = Math.hypot((x - px) / rx, (y - py) / ry);
      height = Math.max(height, .91 - distance * .61);
    }
  }
  return height + (noise(seed ^ 0x2713, x / 1.8, y / 1.8) - .5) * .12;
}

function city(seed, x, y) {
  const shiftX = unit(seed, 0, 0) * 6, shiftY = unit(seed, 1, 0) * 8;
  const avenueX = Math.abs(modulo(x + shiftX, 6) - 3);
  const avenueY = Math.abs(modulo(y + shiftY, 8) - 4);
  const road = Math.min(avenueX, avenueY);
  // Every third north/south avenue is a canal; streets and elevated city blocks
  // remain connected across every generated chunk.
  const canal = Math.abs(modulo(x + shiftX, 18) - 3);
  if (canal < .48) return .16 + canal * .2;
  return Math.min(.78, .31 + road * .43)
    + (noise(seed ^ 0x9147, x / 4, y / 5) - .5) * .08;
}

function fortress(seed, x, y) {
  const gx = Math.floor(x / 8), gy = Math.floor(y / 9);
  const px = (gx + .5) * 8, py = (gy + .5) * 9;
  const rx = 2.1 + unit(seed ^ 0x3157, gx, gy) * 1.4;
  const ry = 2.1 + unit(seed ^ 0x1379, gx, gy) * 1.5;
  const boxDistance = Math.max(Math.abs(x - px) / rx, Math.abs(y - py) / ry);
  const platform = .95 - boxDistance * .51;
  const bridge = .54 - Math.min(Math.abs(x - px), Math.abs(y - py)) * .48;
  return Math.max(platform, bridge);
}

function heightAt(seed, biome, x, y) {
  if (biome === 3 || biome === 4) return bodies(seed, x, y, biome === 4);
  if (biome === 7) return city(seed, x, y);
  if (biome === 9) return fortress(seed, x, y);
  const broad = noise(seed ^ 0x1217, x / 5.7, y / 8.3) - .5;
  const detail = noise(seed ^ 0x417d, x / 1.9, y / 2.7) - .5;
  const river = riverDistance(seed, x, y);
  switch (biome) {
    case 0: // Jungle: broad forest banks around a winding waterway.
      return Math.min(.62 + broad * .40 + detail * .15, .15 + river * .25);
    case 1: // Snow: glacial channels surrounded by wide elevated snowfields.
      return Math.min(.72 + broad * .40 + detail * .10, .15 + river * .23);
    case 2: { // Desert: elongated dune crests and a dry, eroded riverbed.
      const dune = Math.abs(noise(seed ^ 0x2591, x / 2.3, y / 10) - .5);
      return Math.min(.51 + dune * .63 + broad * .20, .20 + river * .38);
    }
    case 5: { // Mars: a deep canyon cuts across layered rock mesas.
      const ridge = noise(seed ^ 0x4793, x / 2.6, y / 12) - .5;
      return Math.min(.68 + ridge * .45 + broad * .18, .12 + river * .28);
    }
    case 6: { // Volcanic: branching lava channels between basalt islands.
      const branch = riverDistance(seed ^ 0x7953, x + 3, y + 23);
      return Math.min(.70 + broad * .42 + detail * .13, .14 + Math.min(river, branch) * .43);
    }
    case 8: // Alien: pools and raised fungal terraces around an erratic river.
      return Math.min(.58 + broad * .72 + detail * .20, .20 + river * .32);
    default: return .6;
  }
}

const materialAt = height => height < .28 ? 0 : height < .44 ? 1 : height < .68 ? 2 : 3;

/**
 * One logical tile, independent of request order.
 *
 * Materials/elevations: 0 deep water/void, 1 shore/low earth, 2 ground, 3 raised.
 * edgeMask connects SAME-material neighbors: N=1, E=2, S=4, W=8.
 * cornerMasks are threshold overlays [all, >=1, >=2, >=3], with corner bits
 * NW=1, NE=2, SE=4, SW=8. Draw these in order for continuous shore/cliff edges.
 * Shared corners use identical global samples, even across negative-row chunks.
 */
export function tileAt(levelHash, worldIndex, col, row) {
  const biome = modulo(Math.floor(worldIndex), 10);
  const seed = (levelHash ^ Math.imul(biome + 1, 0x632be5ab)) >>> 0;
  const sample = (x, y) => materialAt(heightAt(seed, biome, x, y));
  const material = sample(col + .5, row + .5);
  const corners = [sample(col, row), sample(col + 1, row), sample(col + 1, row + 1), sample(col, row + 1)];
  const cornerMasks = [15, 0, 0, 0];
  for (let corner = 0; corner < 4; corner++) {
    for (let layer = 1; layer <= corners[corner]; layer++) cornerMasks[layer] |= 1 << corner;
  }
  const edgeMask = (sample(col + .5, row - .5) === material ? 1 : 0)
    | (sample(col + 1.5, row + .5) === material ? 2 : 0)
    | (sample(col + .5, row + 1.5) === material ? 4 : 0)
    | (sample(col - .5, row + .5) === material ? 8 : 0);
  const decoration = pointHash(seed ^ 0xa527, col, row);
  return { col, row, material, elevation: material, variant: decoration % 6,
    edgeMask, cornerMasks, detail: decoration / UINT_RANGE };
}
