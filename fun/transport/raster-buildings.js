import { atlasAvailable, drawAtlas, registerAtlas } from './atlas-runtime.js';

// These identities are generated raster cutouts, with native building art kept
// by the caller as a fallback while images load or when requests fail.
const families = Object.freeze({
  'buildings-civic': Object.freeze([
    'school', 'hospital', 'police-station', 'fire-station', 'stadium', 'church',
    'pub', 'shop-grocery', 'shop-bakery',
  ]),
  'buildings-commerce': Object.freeze([
    'shop-butcher', 'shop-hardware', 'shop-florist', 'service-post-office',
    'service-bank', 'service-hotel', 'service-garage', 'service-barber', null,
  ]),
});
export const RASTER_BUILDING_KINDS = Object.freeze(Object.values(families).flat().filter(Boolean));
const knownKinds = new Set(RASTER_BUILDING_KINDS);
const biomes = Object.freeze(['taiga', 'tundra', 'desert']);
const entryId = (kind, biome) => `civic:${kind}:${biome}`;
for (const biome of biomes) {
  for (const [family, kinds] of Object.entries(families)) {
    registerAtlas({
      id: `${family}:${biome}`,
      biome,
      path: `./assets/world/${family === 'buildings-commerce' ? 'buildings-commerce-camera-v2' : family}/${biome}/atlas`,
      columns: 3, rows: 3, maxCell: 256,
      entries: kinds.map(kind => kind ? entryId(kind, biome) : null),
    });
  }
}

function loadedBiome(kind, biome) {
  if (!knownKinds.has(kind)) return null;
  return [biome, ...biomes].find(candidate => atlasAvailable(entryId(kind, candidate))) || null;
}
export function hasRasterBuilding(kind, biome = 'taiga') {
  return loadedBiome(kind, biome) !== null;
}
export function drawRasterBuilding(c, kind, biome = 'taiga', pixelScale = 1) {
  if (!knownKinds.has(kind)) return false;
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  // drawAtlas starts a bounded, shared asynchronous request when an external
  // createSprites consumer has not called the app's preload path yet.
  for (const candidate of new Set([biome, ...biomes])) {
    if (drawAtlas(c, entryId(kind, candidate), 0, 0, 32, 32, { pixelScale: scale })) return true;
  }
  return false;
}
