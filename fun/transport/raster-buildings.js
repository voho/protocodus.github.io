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
      path: `./assets/world/${family}/${biome}/atlas`,
      columns: 3, rows: 3,
      entries: kinds.map(kind => kind ? entryId(kind, biome) : null),
    });
  }
}

// Source rectangles are hand-measured on the final 256px transparent cells.
// Glass stays exposed in every climate finish. Stadium rectangles are the
// actual floodlight panels; the garage also has its visible workshop lamp.
// Provenance and reviewable source coordinates live beside the asset sheets.
const sourceWindows = {
  taiga: {
    'school': [[43,151,5,15],[76,151,5,15],[174,151,5,15]],
    'hospital': [[45,145,5,11],[172,145,5,11],[45,184,5,12]],
    'police-station': [[45,153,5,24],[174,153,5,24],[73,153,5,24]],
    'fire-station': [[66,183,8,5],[145,183,8,5]],
    'stadium': [[64,71,7,4],[181,70,7,4],[30,117,7,4],[219,116,6,4]],
    'church': [[62,182,4,14],[153,183,4,13],[181,182,4,14]],
    'pub': [[78,123,5,15],[151,124,5,15],[43,171,5,16],[169,172,5,15]],
    'shop-grocery': [[66,99,6,14],[117,99,6,14],[169,99,6,14]],
    'shop-bakery': [[69,120,6,10],[125,120,6,10]],
    'shop-butcher': [[63,106,5,12],[104,91,5,17],[156,106,5,12]],
    'shop-hardware': [[58,141,8,11],[145,141,8,11]],
    'shop-florist': [[51,146,9,9],[105,146,9,9]],
    'service-post-office': [[64,111,6,18],[113,111,6,18],[161,111,6,18],[64,170,6,18]],
    'service-bank': [[51,128,5,20],[115,129,5,10],[192,130,5,18]],
    'service-hotel': [[54,64,5,15],[96,60,5,15],[140,110,5,18],[141,172,5,18]],
    'service-garage': [[80,164,9,3],[218,159,4,18]],
    'service-barber': [[57,162,7,18],[101,162,7,18]],
  },
  tundra: {
    'school': [[48,150,5,14],[79,150,5,14],[171,150,5,14]],
    'hospital': [[50,144,5,10],[169,144,5,10],[50,180,5,11]],
    'police-station': [[50,151,5,22],[171,151,5,22],[76,151,5,22]],
    'fire-station': [[70,180,8,5],[144,180,8,5]],
    'stadium': [[68,75,7,4],[178,74,7,4],[36,118,7,4],[213,117,6,4]],
    'church': [[66,179,4,13],[151,180,4,12],[178,179,4,13]],
    'pub': [[81,123,5,14],[150,124,5,14],[48,168,5,15],[166,169,5,14]],
    'shop-grocery': [[70,101,6,13],[118,101,6,13],[166,101,6,13]],
    'shop-bakery': [[73,120,6,9],[125,120,6,9]],
    'shop-butcher': [[67,107,5,11],[106,93,5,16],[154,107,5,11]],
    'shop-hardware': [[62,140,8,10],[144,140,8,10]],
    'shop-florist': [[56,145,8,8],[106,145,8,8]],
    'service-post-office': [[68,112,6,17],[114,112,6,17],[159,112,6,17],[68,167,6,17]],
    'service-bank': [[56,128,5,19],[116,129,5,9],[188,130,5,17]],
    'service-hotel': [[59,68,5,14],[98,64,5,14],[139,111,5,17],[140,169,5,17]],
    'service-garage': [[83,162,8,3],[212,157,4,17]],
    'service-barber': [[61,160,7,17],[103,160,7,17]],
  },
  desert: {
    'school': [[48,150,5,14],[79,150,5,14],[171,150,5,14]],
    'hospital': [[50,144,5,10],[169,144,5,10],[50,180,5,11]],
    'police-station': [[50,151,5,22],[171,151,5,22],[76,151,5,22]],
    'fire-station': [[70,180,8,5],[144,180,8,5]],
    'stadium': [[68,75,7,4],[178,74,7,4],[36,118,7,4],[213,117,6,4]],
    'church': [[66,179,4,13],[151,180,4,12],[178,179,4,13]],
    'pub': [[81,123,5,14],[150,124,5,14],[48,168,5,15],[166,169,5,14]],
    'shop-grocery': [[70,101,6,13],[118,101,6,13],[166,101,6,13]],
    'shop-bakery': [[73,120,6,9],[125,120,6,9]],
    'shop-butcher': [[67,107,5,11],[106,93,5,16],[154,107,5,11]],
    'shop-hardware': [[62,140,8,10],[144,140,8,10]],
    'shop-florist': [[56,145,8,8],[106,145,8,8]],
    'service-post-office': [[68,112,6,17],[114,112,6,17],[159,112,6,17],[68,167,6,17]],
    'service-bank': [[56,128,5,19],[116,129,5,9],[188,130,5,17]],
    'service-hotel': [[59,68,5,14],[98,64,5,14],[139,111,5,17],[140,169,5,17]],
    'service-garage': [[83,162,8,3],[212,157,4,17]],
    'service-barber': [[61,160,7,17],[103,160,7,17]],
  },
};
const noWindows = Object.freeze([]);
const windows = Object.fromEntries(Object.entries(sourceWindows).map(([biome, kinds]) => [biome,
  Object.fromEntries(Object.entries(kinds).map(([kind, panes]) => [kind,
    Object.freeze(panes.map(pane => Object.freeze(pane.map(value => value / 8)))),
  ])),
]));
function loadedBiome(kind, biome) {
  if (!knownKinds.has(kind)) return null;
  return [biome, ...biomes].find(candidate => atlasAvailable(entryId(kind, candidate))) || null;
}
export function hasRasterBuilding(kind, biome = 'taiga') {
  return loadedBiome(kind, biome) !== null;
}
export function rasterBuildingWindows(kind, biome = 'taiga') {
  return windows[loadedBiome(kind, biome)]?.[kind] || noWindows;
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
