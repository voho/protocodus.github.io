import { registerAtlas, drawAtlas, atlasAvailable } from './atlas-runtime.js';

// Each biome has its own complete set of eligible industries. A site is drawn
// as a square inside the caller's +8px sprite envelope; the world renderer uses
// 96px for 3×3 sites, and 64px or 32px for smaller sites in older saves.
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

