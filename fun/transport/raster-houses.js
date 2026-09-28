// The nine generated originals occupy 256² transparent cells. This module owns
// their decoded artwork only; loading it never changes a company or its save.
export const HOUSE_KINDS = Object.freeze([
  'house-cheap-1', 'house-cheap-2', 'house-cheap-3',
  'house-normal-1', 'house-normal-2', 'house-normal-3',
  'house-expensive-1', 'house-expensive-2', 'house-expensive-3',
]);
export const HOUSE_BIOMES = Object.freeze(['taiga', 'tundra', 'desert']);
export const HOUSE_ATLAS_URLS = Object.freeze(Object.fromEntries(HOUSE_BIOMES.map(biome => [biome, new URL(`./assets/houses/${biome}/house-atlas.png`, import.meta.url).href])));
const SOURCE_CELL = 256;
const LOD_CELLS = Object.freeze([16, 32, 64, 128, 256]);
const indices = new Map(HOUSE_KINDS.map((kind, index) => [kind, index]));
// Hand-measured glass panes on each final 256² original. Store source pixel
// boxes for easy art review, then convert [left, top, width, height] to the
// 32-unit square used by drawRasterHouse. No roof/garden color guessing.
const sourceWindows = {
  taiga: {
    "house-cheap-1": [[69,145,4,7],[122,169,4,7],[173,154,4,7]],
    "house-cheap-2": [[84,147,4,7],[166,150,4,7]],
    "house-cheap-3": [[67,144,4,7],[130,169,4,7],[177,158,4,7]],
    "house-normal-1": [[51,145,4,9],[122,135,4,7],[187,173,4,8]],
    "house-normal-2": [[56,104,4,9],[178,139,4,8],[127,188,4,9]],
    "house-normal-3": [[130,168,4,7],[186,166,4,7]],
    "house-expensive-1": [[56,111,4,8],[89,125,4,8],[177,140,4,8]],
    "house-expensive-2": [[67,104,4,8],[96,117,4,8],[175,118,4,9]],
    "house-expensive-3": [[43,124,4,8],[94,140,4,8],[209,130,4,8]],
  },
  tundra: {
    "house-cheap-1": [[73,145,4,7],[124,163,4,7],[171,153,4,7]],
    "house-cheap-2": [[86,138,4,7],[168,141,4,7]],
    "house-cheap-3": [[67,141,4,7],[132,163,4,7],[175,151,4,7]],
    "house-normal-1": [[51,144,4,9],[122,134,4,7],[187,172,4,8]],
    "house-normal-2": [[56,104,4,9],[178,139,4,8],[127,188,4,9]],
    "house-normal-3": [[132,163,4,7],[187,161,4,7]],
    "house-expensive-1": [[57,111,4,8],[89,125,4,8],[177,140,4,8]],
    "house-expensive-2": [[68,104,4,8],[97,116,4,8],[175,117,4,9]],
    "house-expensive-3": [[42,123,4,8],[93,139,4,8],[208,129,4,8]],
  },
  desert: {
    "house-cheap-1": [[72,147,4,7],[125,164,4,7],[173,155,4,7]],
    "house-cheap-2": [[86,144,4,7],[168,145,4,7]],
    "house-cheap-3": [[65,146,4,7],[130,171,4,7],[174,159,4,7]],
    "house-normal-1": [[51,144,4,9],[122,134,4,7],[187,172,4,8]],
    "house-normal-2": [[56,104,4,9],[178,139,4,8],[127,188,4,9]],
    "house-normal-3": [[131,166,4,7],[187,164,4,7]],
    "house-expensive-1": [[56,111,4,8],[89,125,4,8],[176,140,4,8]],
    "house-expensive-2": [[67,103,4,8],[96,116,4,8],[174,117,4,9]],
    "house-expensive-3": [[42,123,4,8],[93,139,4,8],[208,129,4,8]],
  },
};
const windowAnchors = Object.fromEntries(Object.entries(sourceWindows).map(([biome, houses]) => [biome,
  Object.fromEntries(Object.entries(houses).map(([kind, panes]) => [kind, Object.freeze(panes.map(pane => Object.freeze(pane.map(value => value / 8))))])),
]));
const noWindows = Object.freeze([]);
const biomes = new Map(), listeners = new Set(), draws = new Map(), errors = new Map(), pending = new Map(), orderedLevels = new Map(), awaited = new Set();
let status = 'idle', revision = 0, lastCellSize = 0, lastBiome = null, unpublished = false, quiet = 0, latest = 0;

export const isRasterHouse = kind => indices.has(kind);
export const houseAssetsRevision = () => revision;

const resolveBiome = biome => biomes.has(biome) ? biome : biomes.has('taiga') ? 'taiga' : biomes.keys().next().value || null;
export const hasRasterHouse = (kind, biome = 'taiga') => indices.has(kind) && resolveBiome(biome) !== null;
export const houseWindowAnchors = (kind, biome = 'taiga') => windowAnchors[resolveBiome(biome)]?.[kind] || noWindows;

export function getHouseAssetStats(biome = 'taiga') {
  const activeBiome = resolveBiome(biome), levels = biomes.get(activeBiome);
  return {
    status, revision, biome, activeBiome, source: HOUSE_ATLAS_URLS[activeBiome || biome], sourceCellSize: SOURCE_CELL,
    atlasWidth: activeBiome ? SOURCE_CELL * 3 : 0, atlasHeight: activeBiome ? SOURCE_CELL * 3 : 0,
    availableBiomes: [...biomes.keys()], lodCellSizes: levels ? [...levels.keys()].sort((a, b) => a - b) : [],
    lastCellSize, lastBiome, rasterizedHouses: Object.fromEntries(draws), errors: Object.fromEntries(errors),
    decodedBytes:[...biomes.values()].reduce((sum,levels)=>sum+[...levels.values()].reduce((n,image)=>n+image.naturalWidth*image.naturalHeight*4,0),0),
  };
}

export function onHouseAssetsChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function decodeAtlas(biome, cell) {
  const image = new Image();
  image.decoding = 'async';
  // Wait for load separately: a few browsers reject decode() if it is called
  // before a newly assigned image request has begun.
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`${biome} house artwork (${cell}px) could not be loaded.`));
    image.src = new URL(`./assets/houses/${biome}/house-atlas${cell === 256 ? '' : '-'+cell}.png`, import.meta.url).href;
  });
  if (image.decode) await image.decode();
  if (image.naturalWidth !== cell * 3 || image.naturalHeight !== cell * 3) {
    throw new Error(`${biome} house artwork (${cell}px) must be a ${cell * 3} × ${cell * 3} atlas.`);
  }
  return [cell, image];
}

// Changes publish together, as world artwork does: 150 ms after the last one,
// at most 500 ms after the first, and at once when nothing is loading.
function publish() { clearTimeout(quiet); clearTimeout(latest); quiet = latest = 0; if (!unpublished) return; unpublished = false; revision++; for (const listener of listeners) queueMicrotask(listener); }
function changed() { unpublished = true; clearTimeout(quiet); quiet = setTimeout(publish, 150); latest ||= setTimeout(publish, 500); }

export function preloadHouses({ waitMs = 4000, retry = false, biome = null, cells = LOD_CELLS } = {}) {
  const requested = HOUSE_BIOMES.includes(biome) ? [biome] : HOUSE_BIOMES;
  if (!retry && requested.every(name => cells.every(cell => biomes.get(name)?.has(cell)))) return Promise.resolve(true);
  if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  const work=[];
  // A retry also fetches every density that failed before, not only the requested ones.
  for(const biome of requested)for(const cell of retry?LOD_CELLS.filter(cell=>cells.includes(cell)||errors.has(`${biome}/${cell}`)):cells){
      const key = `${biome}/${cell}`;
      if(biomes.get(biome)?.has(cell)||errors.has(key)&&!retry)continue;
      if(pending.has(key)){work.push(pending.get(key));continue;}
      status='loading';
      const task=(async()=>{
      try {
        // A slow or damaged zoom density must not discard healthy artwork.
        // A climate's first art, or a density some draw stood in for, joins the next
        // publication, which refreshes already-cached sprites. Others change no drawn pixel.
        const [, image] = await decodeAtlas(biome, cell), first = !biomes.has(biome);
        if (first) biomes.set(biome, new Map());
        biomes.get(biome).set(cell, image); orderedLevels.set(biome,[...biomes.get(biome).keys()].sort((a,b)=>a-b)); errors.delete(key); if (awaited.delete(key) || first) changed();
      } catch (reason) { errors.set(key, reason instanceof Error ? reason.message : String(reason)); if (awaited.delete(key)) changed(); }
      })().finally(()=>{pending.delete(key);if(!pending.size){status=biomes.size?'ready':'failed';publish();}});
      pending.set(key,task);work.push(task);
  }
  if (!work.length || waitMs <= 0) return Promise.resolve(requested.some(name=>biomes.has(name)));
  // Startup has a bounded wait. If a slow image arrives afterwards, revision
  // and listeners refresh the existing caches without resetting the world.
  let timer;
  return Promise.race([Promise.all(work).then(()=>requested.some(name=>biomes.has(name))), new Promise(resolve => { timer = setTimeout(() => resolve(false), waitMs); })])
    .finally(() => { clearTimeout(timer); publish(); });
}

export function drawRasterHouse(c, kind, { pixelScale = 1, biome = 'taiga' } = {}) {
  const index = indices.get(kind);
  if (index === undefined) return false;
  const activeBiome = resolveBiome(biome);
  const desired = 32 * (Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1);
  // Fetch the density an eager load would draw for this climate, or its nearest healthy neighbour
  // when that failed. The best loaded density stands in, and the draw awaits a republish.
  const home = HOUSE_BIOMES.includes(biome) ? biome : 'taiga', has = size => biomes.get(home)?.has(size), ideal = LOD_CELLS.find(size => size >= desired) || SOURCE_CELL;
  if (!has(ideal)) {
    const failed = size => errors.has(`${home}/${size}`), wanted = failed(ideal) ? LOD_CELLS.find(size => size > ideal && !failed(size)) ?? LOD_CELLS.findLast(size => size < ideal && !failed(size)) : ideal;
    awaited.add(`${home}/${ideal}`);
    if (wanted && !has(wanted)) { awaited.add(`${home}/${wanted}`); if (!pending.has(`${home}/${wanted}`)) void preloadHouses({ waitMs: 0, biome: home, cells: [wanted] }); }
  }
  if (activeBiome === null) return false;
  const levels = biomes.get(activeBiome), available = orderedLevels.get(activeBiome);
  const cell = available.find(size => size >= desired) || available.at(-1);
  const atlas = levels.get(cell);
  c.save();
  c.imageSmoothingEnabled = desired !== cell; c.imageSmoothingQuality = 'high';
  // createSprites has already translated its context down by eight pixels.
  // A square source stays square and sits inside the existing 32 × 40 envelope.
  c.drawImage(atlas, index % 3 * cell, Math.floor(index / 3) * cell, cell, cell, 0, 0, 32, 32);
  c.restore();
  lastCellSize = cell; lastBiome = activeBiome; draws.set(kind, (draws.get(kind) || 0) + 1);
  return true;
}
