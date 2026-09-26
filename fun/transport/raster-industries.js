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
  registerAtlas({ id: `industries-${sheet.family}`, path: `./assets/world/industries-${sheet.family}/atlas`, columns: sheet.columns, rows: sheet.rows, entries, maxCell: 256 });
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
    'logging-camp': [[94, 172, 3, 7], [148, 179, 3, 6]],
    sawmill: [[194, 174, 3, 6]],
    'coal-mine': [],
    'iron-mine': [[177, 167, 3, 5]],
    'steel-mill': [[42, 153, 3, 7], [173, 197, 3, 7]],
    farm: [[59, 149, 3, 4]],
    'food-plant': [[52, 164, 3, 5], [143, 159, 3, 5]],
    'furniture-factory': [[55, 150, 3, 7], [97, 152, 3, 7], [161, 157, 3, 7]],
    'machine-works': [[49, 139, 4, 4], [50, 170, 3, 6], [192, 192, 3, 6]],
    'oil-well': [[194, 197, 3, 4]],
    refinery: [[61, 197, 3, 5], [92, 203, 3, 5], [119, 202, 3, 5]],
    quarry: [[125, 182, 3, 4]],
  },
  tundra: {
    'coal-mine': [],
    'iron-mine': [[210, 167, 3, 6]],
    'steel-mill': [[154, 197, 3, 7], [175, 194, 3, 7]],
    'machine-works': [[136, 161, 3, 7], [171, 174, 3, 7], [216, 198, 3, 5]],
    fishery: [[61, 129, 3, 5], [89, 134, 3, 5], [74, 107, 3, 5], [161, 139, 3, 5]],
    'fish-processor': [],
    'oil-well': [],
    refinery: [[36, 197, 3, 5], [51, 201, 3, 5], [89, 199, 3, 5]],
    quarry: [],
    'equipment-factory': [[185, 159, 3, 6], [197, 153, 3, 6]],
  },
  desert: {
    farm: [[62, 127, 3, 4], [145, 151, 3, 4]],
    'food-plant': [[135, 143, 3, 4], [161, 152, 3, 4], [184, 161, 3, 4]],
    'oil-well': [[210, 205, 3, 5]],
    refinery: [[105, 210, 3, 5], [136, 214, 3, 4]],
    quarry: [],
    'cement-works': [[187, 87, 3, 5], [197, 218, 3, 4]],
    'sand-pit': [],
    glassworks: [[50, 159, 3, 6], [72, 171, 3, 6], [129, 179, 3, 8]],
    'copper-mine': [[183, 214, 3, 4]],
    'wire-mill': [[56, 131, 3, 7], [183, 158, 3, 7]],
    'goods-factory': [[57, 130, 3, 4], [97, 146, 3, 5], [155, 153, 3, 5]],
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
