import { registerAtlas, drawAtlas, atlasAvailable } from './atlas-runtime.js';

// Each biome has its own complete set of eligible industries. A site is drawn
// as a square inside the caller's +8px sprite envelope; the world renderer can
// use 64px for new 2×2 sites and 32px for existing single-tile saved industries.
const sheets = [
  { family: 'taiga', biome: 'taiga', columns: 3, rows: 3, kinds: ['logging-camp', 'sawmill', 'coal-mine', 'iron-mine', 'steel-mill', 'farm', 'food-plant', 'furniture-factory', 'machine-works'] },
  { family: 'taiga-extra', biome: 'taiga', columns: 3, rows: 1, kinds: ['oil-well', 'refinery', 'quarry'] },
  { family: 'tundra', biome: 'tundra', columns: 3, rows: 3, kinds: ['coal-mine', 'iron-mine', 'steel-mill', 'machine-works', 'fishery', 'fish-processor', 'oil-well', 'refinery', 'quarry'] },
  { family: 'tundra-extra', biome: 'tundra', columns: 1, rows: 1, kinds: ['equipment-factory'] },
  { family: 'desert', biome: 'desert', columns: 3, rows: 3, kinds: ['farm', 'food-plant', 'oil-well', 'refinery', 'quarry', 'cement-works', 'sand-pit', 'glassworks', 'copper-mine'] },
  { family: 'desert-extra', biome: 'desert', columns: 2, rows: 1, kinds: ['wire-mill', 'goods-factory'] },
];
const byKind = new Map(), ids = new Set();
for (const sheet of sheets) {
  const entries = sheet.kinds.map(kind => {
    const id = `industry:${kind}:${sheet.biome}`;
    ids.add(id);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(id);
    return id;
  });
  registerAtlas({ id: `industries-${sheet.family}`, path: `./assets/world/industries-${sheet.family}/atlas`, biome:sheet.biome, columns: sheet.columns, rows: sheet.rows, entries, maxCell: 256 });
}
export const RASTER_INDUSTRY_IDS = Object.freeze([...ids]);
const candidateIds = (kind, biome) => {
  const requested = `industry:${kind}:${biome}`;
  return [...new Set([...(ids.has(requested) ? [requested] : []), ...(byKind.get(kind) || [])])];
};
const loadedId = (kind, biome) => candidateIds(kind, biome).find(atlasAvailable);
export function hasRasterIndustry(kind, biome = 'taiga') {
  return Boolean(loadedId(kind, biome));
}
export function drawRasterIndustry(c, kind, biome = 'taiga', pixelScale = 1, { size = 64 } = {}) {
  const drawSize = Number.isFinite(size) && size > 0 ? size : 64;
  const density = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  for (const id of candidateIds(kind, biome)) {
    if (drawAtlas(c, id, 0, 0, drawSize, drawSize, { pixelScale: density })) return true;
  }
  return false;
}

// Small glass panes measured on the final 256px originals, not generic lights
// placed over roofs or machinery. Empty entries are open pits or windowless
// structures. Export in the same 32-unit coordinates used by house lighting;
// callers scale by the actual industry footprint (normally two tiles).
const sourceWindows = {
  taiga: {
    'logging-camp': [[94, 153, 3, 5], [134, 171, 3, 5]],
    sawmill: [],
    'coal-mine': [],
    'iron-mine': [[204, 177, 3, 5]],
    'steel-mill': [[48, 142, 3, 6], [217, 162, 3, 6]],
    farm: [[62, 137, 3, 4]],
    'food-plant': [[108, 130, 3, 5], [135, 150, 3, 5], [196, 167, 3, 5]],
    'furniture-factory': [[58, 146, 3, 7], [92, 152, 3, 7], [152, 165, 3, 7]],
    'machine-works': [[55, 129, 3, 6], [202, 142, 3, 6]],
    'oil-well': [[176, 181, 3, 4]],
    refinery: [[60, 181, 3, 4], [87, 192, 3, 4]],
    quarry: [],
  },
  tundra: {
    'coal-mine': [],
    'iron-mine': [[208, 145, 3, 5]],
    'steel-mill': [[159, 181, 3, 7], [177, 171, 3, 7]],
    'machine-works': [[82, 151, 3, 6], [108, 162, 3, 6], [151, 174, 3, 6]],
    fishery: [[63, 118, 3, 5], [82, 125, 3, 5], [73, 100, 3, 5], [151, 132, 3, 5]],
    'fish-processor': [],
    'oil-well': [],
    refinery: [[41, 177, 3, 5], [56, 182, 3, 5]],
    quarry: [],
    'equipment-factory': [[181, 159, 3, 6], [194, 153, 3, 6]],
  },
  desert: {
    farm: [[69, 122, 3, 4], [139, 151, 3, 4]],
    'food-plant': [[131, 144, 3, 4], [150, 153, 3, 4], [180, 152, 3, 4]],
    'oil-well': [[190, 188, 3, 4]],
    refinery: [[99, 190, 3, 4], [127, 202, 3, 4]],
    quarry: [],
    'cement-works': [[190, 111, 3, 4]],
    'sand-pit': [],
    glassworks: [[50, 158, 3, 6], [70, 171, 3, 6], [128, 176, 3, 7]],
    'copper-mine': [],
    'wire-mill': [[57, 128, 3, 6], [118, 136, 3, 5]],
    'goods-factory': [[55, 119, 3, 4], [80, 136, 3, 4], [163, 158, 3, 4]],
  },
};
const noWindows = Object.freeze([]);
const windows = new Map();
for (const [biome, sites] of Object.entries(sourceWindows)) for (const [kind, panes] of Object.entries(sites)) {
  windows.set(`industry:${kind}:${biome}`, Object.freeze(panes.map(pane => Object.freeze(pane.map(value => value / 8)))));
}
export function rasterIndustryWindows(kind, biome = 'taiga') {
  return windows.get(loadedId(kind, biome) || candidateIds(kind, biome)[0]) || noWindows;
}
