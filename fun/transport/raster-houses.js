import { houseGroundStats } from './house-ground.js';
import { HOUSE_PLOT_ATLASES } from './plot-building-catalog.js';

// Each of the three designs holds nine 256² transparent house cells in two
// physical orientations. This module owns
// their decoded artwork only; loading it never changes a company or its save.
export const HOUSE_KINDS = Object.freeze([
  'house-cheap-1', 'house-cheap-2', 'house-cheap-3',
  'house-normal-1', 'house-normal-2', 'house-normal-3',
  'house-expensive-1', 'house-expensive-2', 'house-expensive-3',
]);
export const HOUSE_BIOMES = Object.freeze(['taiga', 'tundra', 'desert']);
export const HOUSE_ROTATIONS = Object.freeze([0, 1]);
export const HOUSE_DESIGNS = Object.freeze([0, 1, 2]);
const atlasFor = (rotation, design) => HOUSE_PLOT_ATLASES.find(atlas => atlas.entries[0].rotation === rotation && atlas.entries[0].design === design);
const directory = (biome, rotation, design) => atlasFor(rotation, design).id + '/';
export const HOUSE_DESIGN_ATLAS_URLS = Object.freeze(Object.fromEntries(HOUSE_BIOMES.map(biome => [
  biome, Object.freeze(HOUSE_DESIGNS.map(design => Object.freeze(HOUSE_ROTATIONS.map(rotation =>
    new URL(`${atlasFor(rotation, design).path}-256.png`, import.meta.url).href)))),
])));
export const HOUSE_ROTATION_ATLAS_URLS = Object.freeze(Object.fromEntries(HOUSE_BIOMES.map(biome => [biome, HOUSE_DESIGN_ATLAS_URLS[biome][0]])));
// Keep the public URL maps; every climate now shares the same neutral RGBA art.
export const HOUSE_ATLAS_URLS = Object.freeze(Object.fromEntries(HOUSE_BIOMES.map(biome => [biome, HOUSE_ROTATION_ATLAS_URLS[biome][0]])));
const SOURCE_CELL = 256;
const MAX_CELL = 512;
const LOD_CELLS = Object.freeze([16, 32, 64, 128, 256, 512]);
const indices = new Map(HOUSE_KINDS.map((kind, index) => [kind, index]));
const footprints = new Map(HOUSE_PLOT_ATLASES[0].entries.map(entry => [entry.kind, entry.footprint]));
const sheets = new Map(), listeners = new Set(), draws = new Map(), errors = new Map(), pending = new Map(), orderedLevels = new Map(), awaited = new Set();
const resolvedSheets = new Map();
const candidateDesigns = new Map(HOUSE_DESIGNS.map(design => [design, [...new Set([design, 0, ...HOUSE_DESIGNS])]]));
let status = 'idle', revision = 0, lastCellSize = 0, lastBiome = null, lastRotation = null, lastDesign = null, unpublished = false, quiet = 0, latest = 0;
const normalizeRotation = rotation => rotation === 1 ? 1 : 0;
const normalizeDesign = design => HOUSE_DESIGNS.includes(design) ? design : 0;
// Climate is an API identity, never an additional decoded sheet.
const sheetKey = (biome, rotation, design) => `${design}/${rotation}`;
const loadKey = (biome, rotation, design, cell) => `${directory(biome, rotation, design)}${cell}`;
const levelsFor = (biome, rotation, design = 0) => sheets.get(sheetKey(biome, rotation, design));
const availableBiomes = (rotation, design) => HOUSE_BIOMES.filter(biome => (design === undefined ? HOUSE_DESIGNS : [design]).some(d => (rotation === undefined ? HOUSE_ROTATIONS : [rotation]).some(r => levelsFor(biome, r, d)?.size)));
export function houseArtworkVariant(variant = 0) {
  // Lower bits already choose the procedural residential kind (modulo 3).
  // Select architecture from the higher group so every kind gets each design.
  const value = ((Math.floor(Number(variant) || 0) % 18) + 18) % 18;
  return { rotation: value % 2, design: Math.floor(value / 6) % 3 };
}

export const isRasterHouse = kind => indices.has(kind);
export const houseAssetsRevision = () => revision;

function resolveSheet(biome, rotation, design) {
  biome = HOUSE_BIOMES.includes(biome) ? biome : 'taiga';
  let resolved = resolvedSheets.get(biome);
  if (!resolved) { resolved = []; resolvedSheets.set(biome, resolved); }
  const identity = design * 2 + rotation;
  if (resolved[identity] !== undefined) return resolved[identity];
  // An available neutral design/orientation stands in while the requested one
  // loads. It composites over the requested climate's actual world ground.
  // Availability changes only when a sheet first decodes. Reuse its selection
  // on sprite-cache hits rather than allocating candidates for every house.
  for(const d of candidateDesigns.get(design))for(let choice = 0; choice < 2; choice++) {
    const r = choice ? 1-rotation : rotation;
    if(levelsFor(biome, r, d)?.size)return resolved[identity] = { biome, rotation: r, design: d };
  }
  return resolved[identity] = null;
}
export const hasRasterHouse = (kind, biome = 'taiga', rotation = 0, design = 0, footprint = footprints.get(kind)) => indices.has(kind) && footprint === footprints.get(kind) && resolveSheet(biome, normalizeRotation(rotation), normalizeDesign(design)) !== null;

export function getHouseAssetStats(biome = 'taiga', rotation = 0, design = 0) {
  const active = resolveSheet(biome, normalizeRotation(rotation), normalizeDesign(design)), activeBiome = active?.biome || null, levels = active && levelsFor(active.biome, active.rotation, active.design);
  return {
    status, revision, biome, activeBiome, source: HOUSE_DESIGN_ATLAS_URLS[activeBiome || biome]?.[active?.design || 0]?.[active?.rotation || 0], sourceCellSize: SOURCE_CELL,
    atlasWidth: activeBiome ? SOURCE_CELL * 3 : 0, atlasHeight: activeBiome ? SOURCE_CELL * 3 : 0,
    availableBiomes: availableBiomes(), lodCellSizes: levels ? [...levels.keys()].sort((a, b) => a - b) : [],
    lastCellSize, lastBiome, lastRotation, lastDesign, activeRotation: active?.rotation ?? null, activeDesign: active?.design ?? null,
    availableRotations: HOUSE_ROTATIONS.filter(r => levelsFor(activeBiome, r, active?.design)?.size),
    availableDesigns: HOUSE_DESIGNS.filter(d => HOUSE_ROTATIONS.some(r => levelsFor(activeBiome, r, d)?.size)),
    rotationStats: Object.fromEntries(HOUSE_ROTATIONS.map(r => [r, { availableBiomes: availableBiomes(r, 0), lodCellSizes: Object.fromEntries(availableBiomes(r, 0).map(name => [name, [...orderedLevels.get(sheetKey(name, r, 0))]])) }])),
    designStats: Object.fromEntries(HOUSE_DESIGNS.map(d => [d, { availableBiomes: availableBiomes(undefined, d), rotations: Object.fromEntries(HOUSE_ROTATIONS.map(r => [r, { availableBiomes: availableBiomes(r, d), lodCellSizes: Object.fromEntries(availableBiomes(r, d).map(name => [name, [...orderedLevels.get(sheetKey(name, r, d))]])) }])) }])),
    rasterizedHouses: Object.fromEntries(draws), errors: Object.fromEntries(errors),
    decodedBytes:[...sheets.values()].reduce((sum,levels)=>sum+[...levels.values()].reduce((n,image)=>n+image.naturalWidth*image.naturalHeight*4,0),0),
    gardenGround:houseGroundStats(),
  };
}

export function onHouseAssetsChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function decodeAtlas(biome, rotation, design, cell) {
  const image = new Image();
  image.decoding = 'async';
  // Wait for load separately: a few browsers reject decode() if it is called
  // before a newly assigned image request has begun.
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`${biome} house artwork (design ${design}, rotation ${rotation}, ${cell}px) could not be loaded.`));
    image.src = new URL(`${atlasFor(rotation, design).path}-${cell}.png`, import.meta.url).href;
  });
  if (image.decode) await image.decode();
  if (image.naturalWidth !== cell * 3 || image.naturalHeight !== cell * 3) {
    throw new Error(`${biome} house artwork (design ${design}, rotation ${rotation}, ${cell}px) must be a ${cell * 3} × ${cell * 3} atlas.`);
  }
  return image;
}

// Changes publish together, as world artwork does: 150 ms after the last one,
// at most 500 ms after the first, and at once when nothing is loading.
function publish() { clearTimeout(quiet); clearTimeout(latest); quiet = latest = 0; if (!unpublished) return; unpublished = false; revision++; for (const listener of listeners) queueMicrotask(listener); }
function changed() { unpublished = true; clearTimeout(quiet); quiet = setTimeout(publish, 150); latest ||= setTimeout(publish, 500); }

export function preloadHouses({ waitMs = 4000, retry = false, biome = null, cells = LOD_CELLS, rotations = HOUSE_ROTATIONS, designs = HOUSE_DESIGNS } = {}) {
  const requested = HOUSE_BIOMES.includes(biome) ? [biome] : HOUSE_BIOMES, orientations = HOUSE_ROTATIONS.filter(r => rotations.includes(r)), architecture = HOUSE_DESIGNS.filter(d => designs.includes(d));
  const usable = () => requested.some(name => HOUSE_DESIGNS.some(d => HOUSE_ROTATIONS.some(r => levelsFor(name, r, d)?.size)));
  if (!retry && requested.every(name => architecture.every(d => orientations.every(r => cells.every(cell => levelsFor(name, r, d)?.has(cell)))))) return Promise.resolve(true);
  if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  const work=[];
  // Every requested neutral orientation gets usable art before a sharper level.
  // A retry also fetches failed densities, not only the requested startup ones.
  for(const cell of LOD_CELLS)for(const design of architecture)for(const rotation of orientations){
      const biome = requested[0];
      const key = loadKey(biome, rotation, design, cell), sheet = sheetKey(biome, rotation, design);
      if(!cells.includes(cell)&&!(retry&&errors.has(key)))continue;
      if(levelsFor(biome, rotation, design)?.has(cell)||errors.has(key)&&!retry)continue;
      if(pending.has(key)){work.push(pending.get(key));continue;}
      status='loading';
      const task=(async()=>{
      try {
        // A slow or damaged density must not discard healthy artwork. A sheet's
        // first art, or a level some draw stood in for, refreshes cached sprites.
        const image = await decodeAtlas(biome, rotation, design, cell), first = !sheets.has(sheet);
        if (first) { sheets.set(sheet, new Map()); resolvedSheets.clear(); }
        sheets.get(sheet).set(cell, image); orderedLevels.set(sheet,[...sheets.get(sheet).keys()].sort((a,b)=>a-b)); errors.delete(key); if (awaited.delete(key) || first) changed();
      } catch (reason) { errors.set(key, reason instanceof Error ? reason.message : String(reason)); if (awaited.delete(key)) changed(); }
      })().finally(()=>{pending.delete(key);if(!pending.size){status=sheets.size?'ready':'failed';publish();}});
      pending.set(key,task);work.push(task);
  }
  if (!work.length || waitMs <= 0) return Promise.resolve(usable());
  // Startup has a bounded wait. A late orientation/density refreshes existing
  // caches through revision/listeners without resetting the world.
  let timer;
  return Promise.race([Promise.all(work).then(usable), new Promise(resolve => { timer = setTimeout(() => resolve(false), waitMs); })])
    .finally(() => { clearTimeout(timer); publish(); });
}

function requestDensity(biome, rotation, design, desired) {
  const has = size => levelsFor(biome, rotation, design)?.has(size), ideal = LOD_CELLS.find(size => size >= desired) || MAX_CELL;
  if (has(ideal)) return;
  const failed = size => errors.has(loadKey(biome, rotation, design, size));
  const wanted = failed(ideal) ? LOD_CELLS.find(size => size > ideal && !failed(size)) ?? LOD_CELLS.findLast(size => size < ideal && !failed(size)) : ideal;
  awaited.add(loadKey(biome, rotation, design, ideal));
  if (wanted && !has(wanted)) {
    const key = loadKey(biome, rotation, design, wanted);awaited.add(key);
    if (!pending.has(key)) void preloadHouses({ waitMs: 0, biome, cells: [wanted], rotations: [rotation], designs: [design] });
  }
}

export function drawRasterHouse(c, kind, { pixelScale = 1, biome = 'taiga', rotation = 0, design = 0, gardenGround = 'art', footprint = footprints.get(kind) } = {}) {
  const index = indices.get(kind);
  // A compact saved site needs native architecture at its actual metre scale.
  // UI thumbnails omit footprint and may resize the correct logical parcel.
  if (index === undefined || footprint !== footprints.get(kind)) return false;
  rotation = normalizeRotation(rotation);
  design = normalizeDesign(design);
  const desired = 32 * (Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1);
  // Request only this neutral orientation's ideal density, sharing in-flight
  // requests. Loaded primary art stands in for the same house until it arrives.
  const home = HOUSE_BIOMES.includes(biome) ? biome : 'taiga';
  requestDensity(home, rotation, design, desired);
  const active = resolveSheet(biome, rotation, design);
  if (active === null) return false;
  // A fallback is still drawn at this view's density. Sharpen it on demand and
  // publish its late arrivals so cached sprites do not retain blurry fallback art.
  if (active.biome !== home || active.rotation !== rotation || active.design !== design) requestDensity(active.biome, active.rotation, active.design, desired);
  const sheet = sheetKey(active.biome, active.rotation, active.design), levels = sheets.get(sheet), available = orderedLevels.get(sheet);
  const cell = available.find(size => size >= desired) || available.at(-1);
  // Authored alpha is the terrain key for every climate. Use it directly:
  // colour scanning could remove green roofs, shrubs or painted shadows.
  const atlas = levels.get(cell);
  c.save();
  c.imageSmoothingEnabled = desired !== cell; c.imageSmoothingQuality = 'high';
  // createSprites has already translated its context down by eight pixels.
  // Both physical rotations retain the same square fenced-plot envelope.
  c.drawImage(atlas, index % 3 * cell, Math.floor(index / 3) * cell, cell, cell, 0, 0, 32, 32);
  c.restore();
  lastCellSize = cell; lastBiome = active.biome; lastRotation = active.rotation; lastDesign = active.design; draws.set(kind, (draws.get(kind) || 0) + 1);
  return true;
}
