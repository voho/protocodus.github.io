import { registerAtlas, drawAtlas, atlasAvailable } from './atlas-runtime.js';
import { INDUSTRY_PLOT_ATLASES, FARM_CORE_PLOT_ATLASES, COMPACT_INDUSTRY_PLOT_ATLASES } from './plot-building-catalog.js';

// Eligible climate identities share neutral transparent architectural sheets.
// A site is drawn
// as a square inside the caller's +8px sprite envelope. Five-tile compounds
// use 160px; blocked legacy sites use separately authored compact art when
// available, or native drawings at their original metre scale.
// Five-tile plots request 512px cells on dense Town displays, packed directly
// from the calibrated originals rather than enlarged from the 256px atlases.
// Farm plots have separate fixed-scale 2×2 building-core atlases below.
export const FOOD_INDUSTRY_KINDS = Object.freeze(['dairy-farm', 'vegetable-farm', 'orchard', 'livestock-farm', 'dairy-plant', 'cannery', 'meat-packer']);
const byKind = new Map(), ids = new Set();
for (const sheet of INDUSTRY_PLOT_ATLASES) {
  const entries = sheet.entries.map(entry => {
    if (!entry) return null;
    for (const id of entry.runtimeIds) ids.add(id);
    byKind.set(entry.kind, [...entry.runtimeIds]);
    return entry.runtimeIds;
  });
  registerAtlas({ id: `plot-building:${sheet.id}`, path: sheet.path, columns: sheet.columns, rows: sheet.rows, entries, maxCell: 512 });
}
export const RASTER_INDUSTRY_IDS = Object.freeze([...ids]);
const compactSheets = new Map(COMPACT_INDUSTRY_PLOT_ATLASES.flatMap(sheet => sheet.entries.map(entry => [`${entry.kind}:${entry.footprint}`, { sheet, entry }])));
const registeredCompact = new Set();
function compactCandidates(kind, footprint) {
  const match = compactSheets.get(`${kind}:${footprint}`);
  if (!match) return [];
  const { sheet, entry } = match;
  if (!registeredCompact.has(sheet.id)) {
    registerAtlas({ id: `plot-building:${sheet.id}`, path: sheet.path, columns: sheet.columns, rows: sheet.rows, entries: sheet.entries.map(entry => entry.runtimeIds), maxCell: 512 });
    registeredCompact.add(sheet.id);
  }
  return entry.runtimeIds;
}
// Large farms keep their surrounding ground fields separate from their 2×2
// building core. Compact saved farms continue to use the industry atlases above.
export const FARM_CORE_KINDS = Object.freeze(['farm', 'dairy-farm', 'vegetable-farm', 'orchard', 'livestock-farm']);
const coreIds = new Set();
for (const sheet of FARM_CORE_PLOT_ATLASES) {
  const entries = sheet.entries.map(entry => {
    if (!entry) return null;
    for (const id of entry.runtimeIds) coreIds.add(id);
    return entry.runtimeIds;
  });
  registerAtlas({ id: `plot-building:${sheet.id}`, path: sheet.path, columns: sheet.columns, rows: sheet.rows, entries, maxCell: 512 });
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
export function hasRasterIndustry(kind, biome = 'taiga', footprint = 5) {
  return footprint === 5 ? Boolean(loadedId(kind, biome)) : compactCandidates(kind, footprint).some(atlasAvailable);
}
export function drawRasterIndustry(c, kind, biome = 'taiga', pixelScale = 1, { footprint = 5, size = 32 * footprint } = {}) {
  // Five-tile artwork can be a small UI thumbnail, but must not masquerade as
  // a smaller world parcel: downscaling the compound also downscales its doors.
  const candidates = footprint === 5 ? candidateIds(kind, biome) : compactCandidates(kind, footprint);
  if (!candidates.length) return false;
  const drawSize = Number.isFinite(size) && size > 0 ? size : 32 * footprint;
  const density = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  for (const id of candidates) {
    if (drawAtlas(c, id, 0, 0, drawSize, drawSize, { pixelScale: density })) return true;
  }
  return false;
}
