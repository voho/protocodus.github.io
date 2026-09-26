// The nine generated originals occupy 256² transparent cells. This module owns
// their decoded artwork only; loading it never changes a company or its save.
export const HOUSE_KINDS = Object.freeze([
  'house-cheap-1', 'house-cheap-2', 'house-cheap-3',
  'house-normal-1', 'house-normal-2', 'house-normal-3',
  'house-expensive-1', 'house-expensive-2', 'house-expensive-3',
]);
export const HOUSE_BIOMES = Object.freeze(['taiga', 'tundra', 'desert']);
export const HOUSE_ATLAS_URLS = Object.freeze(Object.fromEntries(HOUSE_BIOMES.map(biome => [biome, new URL(`./assets/houses/${biome}/house-atlas.png`, import.meta.url).href])));
const SOURCE_CELL = 256;
const LOD_CELLS = Object.freeze([16, 32, 64, 128]);
const indices = new Map(HOUSE_KINDS.map((kind, index) => [kind, index]));
// Hand-measured glass panes on each final 256² original. Store source pixel
// boxes for easy art review, then convert [left, top, width, height] to the
// 32-unit square used by drawRasterHouse. No roof/garden color guessing.
const sourceWindows = {
  taiga: {
    'house-cheap-1': [[61,159,7,18],[159,159,7,18]],
    'house-cheap-2': [[78,159,6,16],[90,159,7,16]],
    'house-cheap-3': [[53,178,6,15],[172,178,6,15]],
    'house-normal-1': [[63,104,7,15],[151,113,7,15],[51,169,7,16]],
    'house-normal-2': [[52,106,7,17],[113,107,7,17],[175,124,7,16],[52,165,7,17]],
    'house-normal-3': [[146,180,8,17],[167,180,8,17]],
    'house-expensive-1': [[57,130,7,17],[114,130,7,17],[173,180,7,17]],
    'house-expensive-2': [[79,108,5,16],[118,108,5,16],[160,162,5,16]],
    'house-expensive-3': [[46,150,7,11],[111,155,7,8],[181,169,6,11],[47,184,7,11]],
  },
  tundra: {
    'house-cheap-1': [[62,158,7,17],[158,158,7,17]],
    'house-cheap-2': [[79,159,6,15],[91,159,6,15]],
    'house-cheap-3': [[55,177,6,14],[172,177,6,14]],
    'house-normal-1': [[65,103,6,15],[151,113,7,15],[53,168,7,16]],
    'house-normal-2': [[53,106,7,17],[113,107,7,17],[175,124,7,15],[53,164,7,16]],
    'house-normal-3': [[146,179,8,17],[167,179,8,17]],
    'house-expensive-1': [[58,130,7,16],[114,130,7,16],[172,178,7,16]],
    'house-expensive-2': [[80,108,5,16],[118,108,5,16],[160,162,5,16]],
    'house-expensive-3': [[47,151,6,10],[111,155,7,8],[180,168,6,11],[48,184,6,10]],
  },
  desert: {
    'house-cheap-1': [[64,158,7,17],[157,158,7,17]],
    'house-cheap-2': [[81,158,6,15],[92,158,6,15]],
    'house-cheap-3': [[57,177,6,15],[171,177,6,15]],
    'house-normal-1': [[67,105,6,15],[151,113,7,15],[54,168,7,15]],
    'house-normal-2': [[55,108,7,16],[113,108,7,16],[172,124,7,16],[55,163,7,16]],
    'house-normal-3': [[146,179,8,16],[167,179,8,16]],
    'house-expensive-1': [[59,130,7,16],[114,130,7,16],[171,178,7,16]],
    'house-expensive-2': [[80,109,5,16],[118,109,5,16],[158,161,5,16]],
    'house-expensive-3': [[48,151,6,10],[112,155,7,8],[179,169,6,11],[48,184,6,10]],
  },
};
const windowAnchors = Object.fromEntries(Object.entries(sourceWindows).map(([biome, houses]) => [biome,
  Object.fromEntries(Object.entries(houses).map(([kind, panes]) => [kind, Object.freeze(panes.map(pane => Object.freeze(pane.map(value => value / 8))))])),
]));
const noWindows = Object.freeze([]);
const biomes = new Map(), listeners = new Set(), draws = new Map(), errors = new Map();
let status = 'idle', revision = 0, pending = null, lastCellSize = 0, lastBiome = null;

export const isRasterHouse = kind => indices.has(kind);
export const houseAssetsRevision = () => revision;

const resolveBiome = biome => biomes.has(biome) ? biome : biomes.has('taiga') ? 'taiga' : biomes.keys().next().value || null;
export const hasRasterHouse = (kind, biome = 'taiga') => indices.has(kind) && resolveBiome(biome) !== null;
export const houseWindowAnchors = (kind, biome = 'taiga') => windowAnchors[resolveBiome(biome)]?.[kind] || noWindows;

export function getHouseAssetStats(biome = 'taiga') {
  const activeBiome = resolveBiome(biome), levels = biomes.get(activeBiome);
  return {
    status, revision, biome, activeBiome, source: HOUSE_ATLAS_URLS[activeBiome || biome], sourceCellSize: SOURCE_CELL,
    atlasWidth: activeBiome ? SOURCE_CELL * 3 : 0, atlasHeight: activeBiome ? SOURCE_CELL * 3 : 0,
    availableBiomes: [...biomes.keys()], lodCellSizes: levels ? [...levels.keys()].sort((a, b) => a - b) : [],
    lastCellSize, lastBiome, rasterizedHouses: Object.fromEntries(draws), errors: Object.fromEntries(errors),
  };
}

export function onHouseAssetsChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function decodeAtlas(biome, cell) {
  const image = new Image();
  image.decoding = 'async';
  // Wait for load separately: a few browsers reject decode() if it is called
  // before a newly assigned image request has begun.
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`${biome} house artwork (${cell}px) could not be loaded.`));
    image.src = new URL(`./assets/houses/${biome}/house-atlas-${cell}.png`, import.meta.url).href;
  });
  if (image.decode) await image.decode();
  if (image.naturalWidth !== cell * 3 || image.naturalHeight !== cell * 3) {
    throw new Error(`${biome} house artwork (${cell}px) must be a ${cell * 3} × ${cell * 3} atlas.`);
  }
  return [cell, image];
}

export function preloadHouses({ waitMs = 4000, retry = false } = {}) {
  const complete = HOUSE_BIOMES.every(biome => biomes.get(biome)?.size === LOD_CELLS.length);
  if (status === 'ready' && (!retry || complete)) return Promise.resolve(true);
  if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  if (!pending && (status === 'idle' || retry)) {
    status = 'loading';
    pending = Promise.all(HOUSE_BIOMES.flatMap(biome => LOD_CELLS.filter(cell => !biomes.get(biome)?.has(cell)).map(async cell => {
      const key = `${biome}/${cell}`;
      try {
        // A slow or damaged zoom density must not discard healthy artwork.
        // Publish each density immediately and refresh already-cached sprites.
        const [, image] = await decodeAtlas(biome, cell);
        if (!biomes.has(biome)) biomes.set(biome, new Map());
        biomes.get(biome).set(cell, image); errors.delete(key); revision++;
        for (const listener of listeners) queueMicrotask(listener);
      } catch (reason) { errors.set(key, reason instanceof Error ? reason.message : String(reason)); }
    }))).then(() => { status = biomes.size ? 'ready' : 'failed'; return biomes.size > 0; })
      .finally(() => { pending = null; });
  }
  if (!pending || waitMs <= 0) return Promise.resolve(false);
  // Startup has a bounded wait. If a slow image arrives afterwards, revision
  // and listeners refresh the existing caches without resetting the world.
  let timer;
  return Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(false), waitMs); })])
    .finally(() => clearTimeout(timer));
}

export function drawRasterHouse(c, kind, { pixelScale = 1, biome = 'taiga' } = {}) {
  const index = indices.get(kind);
  if (index === undefined) return false;
  const activeBiome = resolveBiome(biome);
  if (activeBiome === null) { if (status === 'idle') void preloadHouses({ waitMs: 0 }); return false; }
  const desired = 32 * (Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1);
  const levels = biomes.get(activeBiome), available = [...levels.keys()].sort((a, b) => a - b);
  const cell = available.find(size => size >= desired) || available.at(-1);
  const atlas = levels.get(cell);
  c.save();
  c.imageSmoothingEnabled = desired !== cell; c.imageSmoothingQuality = 'high';
  // createSprites has already translated its context down by eight pixels.
  // A square source stays square and sits inside the existing 32 × 40 envelope.
  c.drawImage(atlas, index % 3 * cell, Math.floor(index / 3) * cell, cell, cell, 0, 0, 32, 32);
  c.restore();
  lastCellSize = cell; lastBiome = activeBiome; draws.set(kind, (draws.get(kind) || 0) + 1);
  return true;
}
