import { registerAtlas, drawAtlas, atlasAvailable } from './atlas-runtime.js';

// Each biome has its own complete set of eligible industries. A site is drawn
// as a square inside the caller's +8px sprite envelope. Five-tile compounds
// use 160px; blocked legacy sites use the native drawings at their original
// footprint, so their human-sized features retain the common metre scale.
// Farm plots have separate fixed-scale 2×2 building-core atlases below.
export const FOOD_INDUSTRY_KINDS = Object.freeze(['dairy-farm', 'vegetable-farm', 'orchard', 'livestock-farm', 'dairy-plant', 'cannery', 'meat-packer']);
const sheets = [
  { family: 'taiga', biome: 'taiga', columns: 3, rows: 3, kinds: ['logging-camp', 'sawmill', 'coal-mine', 'iron-mine', 'steel-mill', 'farm', 'food-plant', 'furniture-factory', 'machine-works'] },
  { family: 'taiga-extra', biome: 'taiga', columns: 3, rows: 1, kinds: ['oil-well', 'refinery', 'quarry'] },
  { family: 'tundra', biome: 'tundra', columns: 3, rows: 3, kinds: ['coal-mine', 'iron-mine', 'steel-mill', 'machine-works', 'fishery', 'fish-processor', 'oil-well', 'refinery', 'quarry'] },
  { family: 'tundra-extra', biome: 'tundra', columns: 1, rows: 1, kinds: ['equipment-factory'] },
  { family: 'desert', biome: 'desert', columns: 3, rows: 3, kinds: ['farm', 'food-plant', 'oil-well', 'refinery', 'quarry', 'cement-works', 'sand-pit', 'glassworks', 'copper-mine'] },
  { family: 'desert-extra', biome: 'desert', columns: 2, rows: 1, kinds: ['wire-mill', 'goods-factory'] },
  ...['taiga', 'desert'].map(biome => ({ family: `food-${biome}`, biome, path: `./assets/world/food-industry-v1/${biome}/atlas`, columns: 3, rows: 3, kinds: FOOD_INDUSTRY_KINDS })),
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
  registerAtlas({ id: `industries-${sheet.family}`, path: sheet.path || `./assets/world/industries-${sheet.family}/atlas`, biome:sheet.biome, columns: sheet.columns, rows: sheet.rows, entries, maxCell: 256 });
}
export const RASTER_INDUSTRY_IDS = Object.freeze([...ids]);
// Large farms keep their surrounding ground fields separate from their 2×2
// building core. Compact saved farms continue to use the industry atlases above.
export const FARM_CORE_KINDS = Object.freeze(['farm', 'dairy-farm', 'vegetable-farm', 'orchard', 'livestock-farm']);
const coreIds = new Set();
for (const biome of ['taiga', 'desert']) {
  const entries = FARM_CORE_KINDS.map(kind => { const id = `farm-core:${kind}:${biome}`; coreIds.add(id); return id; });
  registerAtlas({ id: `farm-cores-${biome}`, path: `./assets/world/farm-cores-v1/${biome}/atlas`, biome, columns: 3, rows: 2, entries, maxCell: 256 });
}
export const RASTER_FARM_CORE_IDS = Object.freeze([...coreIds]);
const coreCandidates = (kind, biome) => [...new Set([`farm-core:${kind}:${biome}`, `farm-core:${kind}:taiga`, `farm-core:${kind}:desert`])].filter(id => coreIds.has(id));
export function hasRasterFarmCore(kind, biome = 'taiga') { return coreCandidates(kind, biome).some(atlasAvailable); }
export function drawRasterFarmCore(c, kind, biome = 'taiga', pixelScale = 1, { size = 64 } = {}) {
  const drawSize = Number.isFinite(size) && size > 0 ? size : 64;
  const density = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  return coreCandidates(kind, biome).some(id => drawAtlas(c, id, 0, 0, drawSize, drawSize, { pixelScale: density }));
}
const candidateIds = (kind, biome) => {
  const requested = `industry:${kind}:${biome}`;
  return [...new Set([...(ids.has(requested) ? [requested] : []), ...(byKind.get(kind) || [])])];
};
const loadedId = (kind, biome) => candidateIds(kind, biome).find(atlasAvailable);
export function hasRasterIndustry(kind, biome = 'taiga') {
  return Boolean(loadedId(kind, biome));
}
export function drawRasterIndustry(c, kind, biome = 'taiga', pixelScale = 1, { size = 160, footprint = 5 } = {}) {
  // Five-tile artwork can be a small UI thumbnail, but must not masquerade as
  // a smaller world parcel: downscaling the compound also downscales its doors.
  if (footprint !== 5) return false;
  const drawSize = Number.isFinite(size) && size > 0 ? size : 160;
  const density = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  for (const id of candidateIds(kind, biome)) {
    if (drawAtlas(c, id, 0, 0, drawSize, drawSize, { pixelScale: density })) return true;
  }
  return false;
}
