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
    'service-bank', 'service-hotel', 'service-garage', 'service-barber', 'factory',
  ]),
});
export const SHOP_ART_KINDS = Object.freeze(['shop-grocery', 'shop-bakery', 'shop-butcher', 'shop-hardware', 'shop-florist']);
export const PARK_MALL_ART_KINDS = Object.freeze(['park-village', 'park-formal', 'park-woodland', 'mall-neighborhood', 'mall-shopping', 'mall-modern']);
export const RASTER_BUILDING_KINDS = Object.freeze([...Object.values(families).flat().filter(Boolean), ...PARK_MALL_ART_KINDS]);
export const BUILDING_ART_DESIGNS = Object.freeze([0, 1, 2]);
const knownKinds = new Set([...RASTER_BUILDING_KINDS, ...PARK_MALL_ART_KINDS]);
const biomes = Object.freeze(['taiga', 'tundra', 'desert']);
const entryId = (kind, biome, design = 0) => `civic:${kind}:${biome}${design ? `:design-${design}` : ''}`;
const varietyFamilies = Object.freeze({
  'civic-retail': Object.freeze([
    ...PARK_MALL_ART_KINDS.map(kind => [kind, 0]),
    ...SHOP_ART_KINDS.slice(0, 3).map(kind => [kind, 1]),
  ]),
  'shop-alternates': Object.freeze([
    ...SHOP_ART_KINDS.slice(3).map(kind => [kind, 1]),
    ...SHOP_ART_KINDS.map(kind => [kind, 2]), null, null,
  ]),
});
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
  for (const [family, entries] of Object.entries(varietyFamilies)) {
    registerAtlas({
      id: `town-variety:${family}:${biome}`, biome,
      path: `./assets/world/town-variety-v1/${family}/${biome}/atlas`,
      columns: 3, rows: 3, maxCell: 256,
      entries: entries.map(entry => entry ? entryId(entry[0], biome, entry[1]) : null),
    });
  }
}

// A saved shop seed independently selects its five-way identity and three-way
// exterior. Fifteen repeatable states preserve every identity/style pairing.
export function buildingArtworkDesign(variant = 0) {
  const value = Number.isFinite(variant) ? Math.floor(variant) : 0;
  return Math.floor(((value % 15) + 15) % 15 / 5);
}
function candidates(kind, biome, design) {
  const selected = SHOP_ART_KINDS.includes(kind) && Number.isFinite(design) ? ((Math.floor(design) % 3) + 3) % 3 : 0;
  const climates = [...new Set([biome, ...biomes])];
  // A loading alternate first falls back to the same climate's established
  // artwork, before considering any other climate.
  return climates.flatMap(climate => selected ? [entryId(kind, climate, selected), entryId(kind, climate)] : [entryId(kind, climate)]);
}
export function hasRasterBuilding(kind, biome = 'taiga', design = 0) {
  return knownKinds.has(kind) && candidates(kind, biome, design).some(atlasAvailable);
}
export function drawRasterBuilding(c, kind, biome = 'taiga', pixelScale = 1, { design = 0 } = {}) {
  if (!knownKinds.has(kind)) return false;
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  // drawAtlas starts a bounded, shared asynchronous request when an external
  // createSprites consumer has not called the app's preload path yet.
  for (const candidate of candidates(kind, biome, design)) {
    if (drawAtlas(c, candidate, 0, 0, 32, 32, { pixelScale: scale })) return true;
  }
  return false;
}
