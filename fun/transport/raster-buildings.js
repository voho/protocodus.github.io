import { atlasAvailable, drawAtlas, registerAtlas } from './atlas-runtime.js';
import { CITY_PLOT_ATLASES } from './plot-building-catalog.js';

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
  // Generated hand-painted town-feature cutouts in a fixed 4 × 3 parcel grid.
  'buildings-town-features': Object.freeze([
    'park', 'playground', 'swimming-pool', 'sports-field', 'tennis-courts', 'ballpark',
    'sports-hall', 'town-hall', 'shop-cafe', 'shop-pharmacy', 'shop-bookshop', null,
  ]),
});
export const RASTER_BUILDING_FAMILIES = families;
export const SHOP_ART_KINDS = Object.freeze(['shop-grocery', 'shop-bakery', 'shop-butcher', 'shop-hardware', 'shop-florist']);
export const PARK_MALL_ART_KINDS = Object.freeze(['park-village', 'park-formal', 'park-woodland', 'mall-neighborhood', 'mall-shopping', 'mall-modern']);
export const RASTER_BUILDING_KINDS = Object.freeze([...Object.values(families).flat().filter(Boolean), ...PARK_MALL_ART_KINDS]);
export const BUILDING_ART_DESIGNS = Object.freeze([0, 1, 2]);
const knownKinds = new Set(RASTER_BUILDING_KINDS);
const footprints = new Map(CITY_PLOT_ATLASES.flatMap(atlas => atlas.entries.filter(Boolean).map(entry => [entry.kind, entry.footprint])));
const biomes = Object.freeze(['taiga', 'tundra', 'desert']);
const entryId = (kind, biome, design = 0) => `civic:${kind}:${biome}${design ? `:design-${design}` : ''}`;
for (const atlas of CITY_PLOT_ATLASES) {
  registerAtlas({
    id: `plot-building:${atlas.id}`, path: atlas.path,
    columns: atlas.columns, rows: atlas.rows, maxCell: 512,
    entries: atlas.entries.map(entry => entry?.runtimeIds || null),
  });
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
export function hasRasterBuilding(kind, biome = 'taiga', design = 0, footprint = footprints.get(kind)) {
  return knownKinds.has(kind) && footprint === footprints.get(kind) && candidates(kind, biome, design).some(atlasAvailable);
}
export function drawRasterBuilding(c, kind, biome = 'taiga', pixelScale = 1, { design = 0, footprint = footprints.get(kind) } = {}) {
  // World parcels must retain the authored human scale. A UI thumbnail may
  // resize a correct logical parcel without passing a different footprint.
  if (!knownKinds.has(kind) || footprint !== footprints.get(kind)) return false;
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  // drawAtlas starts a bounded, shared asynchronous request when an external
  // createSprites consumer has not called the app's preload path yet.
  for (const candidate of candidates(kind, biome, design)) {
    if (drawAtlas(c, candidate, 0, 0, 32, 32, { pixelScale: scale })) return true;
  }
  return false;
}
