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
      columns: 3, rows: 3, maxCell: 256,
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
    "school": [[55,124,4,8],[94,140,4,8],[209,132,4,8]],
    "hospital": [[49,106,4,8],[96,130,4,8],[210,139,4,8]],
    "police-station": [[44,128,4,8],[214,143,4,8],[150,166,4,8]],
    "fire-station": [[64,155,5,3],[209,164,4,8],[193,131,4,8]],
    "stadium": [[93,46,5,3],[32,82,4,3],[199,78,4,3],[176,145,5,3]],
    "church": [[125,182,3,7],[182,174,3,8]],
    "pub": [[80,107,4,8],[126,135,4,8],[201,117,4,8]],
    "shop-grocery": [[104,109,4,8],[191,128,4,8],[139,124,4,8]],
    "shop-bakery": [[72,104,4,7],[109,122,4,8],[158,129,4,8]],
    "shop-butcher": [[59,93,4,8],[90,103,4,8],[196,122,4,8]],
    "shop-hardware": [[63,145,4,9],[194,146,4,8]],
    "shop-florist": [[194,139,4,8],[124,99,3,6]],
    "service-post-office": [[61,110,4,8],[129,135,4,8],[189,129,4,8]],
    "service-bank": [[47,112,4,8],[204,128,4,8]],
    "service-hotel": [[89,79,4,8],[128,91,4,8],[172,128,4,8]],
    "service-garage": [[78,142,5,3],[204,162,4,8]],
    "service-barber": [[58,158,4,8],[94,169,4,8],[192,153,4,8]],
  },
  tundra: {
    "school": [[55,124,4,8],[94,140,4,8],[209,132,4,8]],
    "hospital": [[49,104,4,8],[96,128,4,8],[209,137,4,8]],
    "police-station": [[44,126,4,8],[214,141,4,8],[150,164,4,8]],
    "fire-station": [[64,155,5,3],[209,164,4,8],[193,131,4,8]],
    "stadium": [[93,48,5,3],[33,83,4,3],[198,79,4,3],[175,145,5,3]],
    "church": [[125,181,3,7],[182,173,3,8]],
    "pub": [[80,107,4,8],[125,135,4,8],[200,117,4,8]],
    "shop-grocery": [[103,110,4,8],[190,129,4,8],[138,125,4,8]],
    "shop-bakery": [[72,104,4,7],[109,122,4,8],[158,129,4,8]],
    "shop-butcher": [[58,93,4,8],[89,103,4,8],[195,122,4,8]],
    "shop-hardware": [[62,144,4,9],[193,145,4,8]],
    "shop-florist": [[194,139,4,8],[124,99,3,6]],
    "service-post-office": [[61,111,4,8],[128,136,4,8],[188,130,4,8]],
    "service-bank": [[48,111,4,8],[203,127,4,8]],
    "service-hotel": [[89,79,4,8],[128,91,4,8],[172,128,4,8]],
    "service-garage": [[78,140,5,3],[204,160,4,8]],
    "service-barber": [[58,158,4,8],[94,169,4,8],[192,153,4,8]],
  },
  desert: {
    "school": [[54,125,4,8],[93,141,4,8],[208,133,4,8]],
    "hospital": [[48,104,4,8],[95,128,4,8],[210,137,4,8]],
    "police-station": [[44,126,4,8],[214,141,4,8],[150,164,4,8]],
    "fire-station": [[65,154,5,3],[210,163,4,8],[194,130,4,8]],
    "stadium": [[93,46,5,3],[32,82,4,3],[199,78,4,3],[176,144,5,3]],
    "church": [[125,182,3,7],[182,174,3,8]],
    "pub": [[80,106,4,8],[126,134,4,8],[201,116,4,8]],
    "shop-grocery": [[104,110,4,8],[191,129,4,8],[139,125,4,8]],
    "shop-bakery": [[72,102,4,7],[109,120,4,8],[158,127,4,8]],
    "shop-butcher": [[59,95,4,8],[90,105,4,8],[195,123,4,8]],
    "shop-hardware": [[62,145,4,9],[193,146,4,8]],
    "shop-florist": [[195,139,4,8],[125,98,3,6]],
    "service-post-office": [[61,111,4,8],[128,135,4,8],[188,130,4,8]],
    "service-bank": [[48,111,4,8],[203,126,4,8]],
    "service-hotel": [[89,79,4,8],[128,91,4,8],[171,127,4,8]],
    "service-garage": [[79,142,5,3],[203,161,4,8]],
    "service-barber": [[58,158,4,8],[94,169,4,8],[192,153,4,8]],
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
