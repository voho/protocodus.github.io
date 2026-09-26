import { registerAtlas, drawAtlas, atlasAvailable } from './atlas-runtime.js';
import { forestComposition } from './tree-sprites.js';
import { normalizedDetail } from './terrain-sprites.js';

// These are individual transparent objects, rather than repeated forest tiles.
// Their placement still uses the original deterministic 64 woodland variants.
const TREE_KINDS = {
  taiga: ['pine','spruce','fir','birch','oak','aspen','deadwood','bare-birch','sapling'],
  tundra: ['pine','larch','dwarf-birch','dwarf-pine','deadwood','bare-birch','sapling','ice-pine','willow-tree'],
  desert: ['palm','acacia','joshua','tamarisk','deadwood','small-palm','bare-acacia','small-joshua','succulent-tree'],
};
const GROUND_KINDS = {
  taiga: ['wildflowers','bluebells','ferns','grass-tufts','berry-bushes','heather','shrubs','reeds','marsh'],
  tundra: ['arctic-poppies','cotton-grass','heather','lichen','willow-scrub','tundra-grass','shrubs','reeds','marsh'],
  desert: ['cactus','agave','prickly-pear','aloe','desert-flowers','dry-grass','scrub','reeds','saltflat'],
};
const MOUNTAINS = ['granite-ridge','wooded-foothill','granite-peak','ice-peak','glacier','frost-ridge','mesa','butte','canyon'];
const RELIEF_NEIGHBORS = {
  'granite-ridge': ['granite-peak','wooded-foothill'], 'wooded-foothill': ['granite-ridge','granite-peak'],
  'granite-peak': ['granite-ridge','wooded-foothill'], 'ice-peak': ['frost-ridge','glacier'],
  glacier: ['frost-ridge','ice-peak'], 'frost-ridge': ['glacier','ice-peak'],
  mesa: ['butte','canyon'], butte: ['mesa','canyon'], canyon: ['mesa','butte'],
};
const ROCKS = ['taiga-boulder','taiga-scree','tundra-glacial','tundra-snow','desert-boulder','desert-dunes','desert-salt','desert-strata','tundra-ice'];
for (const [biome, kinds] of Object.entries(TREE_KINDS)) {
  const id = `nature-trees-${biome}`;
  registerAtlas({ id, path: `./assets/world/${id}/atlas`, columns: 3, rows: 3, entries: kinds.map(kind => `${id}:${kind}`) });
}
for (const [biome, kinds] of Object.entries(GROUND_KINDS)) {
  const id = `nature-ground-${biome}`;
  registerAtlas({ id, path: `./assets/world/${id}/atlas`, columns: 3, rows: 3, entries: kinds.map(kind => `${id}:${kind}`) });
}
registerAtlas({ id: 'nature-mountains', path: './assets/world/nature-mountains/atlas', columns: 3, rows: 3, entries: MOUNTAINS.map(kind => `nature-mountains:${kind}`) });
registerAtlas({ id: 'nature-rocks', path: './assets/world/nature-rocks/atlas', columns: 3, rows: 3, entries: ROCKS.map(kind => `nature-rocks:${kind}`) });

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = value => ((Math.floor(value) || 0) % 64 + 64) % 64;
function random(seed) { let value = seed >>> 0; return () => { value += 0x6d2b79f5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seedFor(biome, detail, variant) { let seed = 2166136261; for (const char of `${biome}:${detail}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619); return seed ^ Math.imul(wrap(variant) + 1, 2654435761); }
function treeID(tree, biome) {
  let species = tree.species;
  if (tree.bare) species = tree.seed % 3 === 0 ? 'deadwood' : biome === 'desert' ? 'bare-acacia' : 'bare-birch';
  else if (tree.size < 12) {
    if (biome === 'desert' && species === 'palm') species = 'small-palm';
    else if (biome === 'desert' && species === 'joshua') species = 'small-joshua';
    else if (biome !== 'desert' && ['pine','spruce','fir','larch'].includes(species)) species = 'sapling';
  }
  if (!TREE_KINDS[biome].includes(species)) species = TREE_KINDS[biome][0];
  return `nature-trees-${biome}:${species}`;
}
function drawTree(c, tree, biome, pixelScale) {
  const box = tree.size * 1.18;
  return drawAtlas(c, treeID(tree, biome), tree.x - box / 2, tree.y - box * .955, box, box, { pixelScale });
}
function groundID(detail, biome) {
  if (GROUND_KINDS[biome].includes(detail)) return `nature-ground-${biome}:${detail}`;
  const geological = { glacial: biome === 'tundra' ? 'tundra-glacial' : 'taiga-scree', ice: 'tundra-ice', snow: 'tundra-snow', dunes: 'desert-dunes', saltflat: 'desert-salt', canyon: 'desert-strata' };
  if (geological[detail]) return `nature-rocks:${geological[detail]}`;
  if (detail === 'deadwood') return `nature-trees-${biome}:deadwood`;
  // Older companies can contain vegetation from before biome-specific detail
  // palettes. Keep each exact detail visible rather than silently erasing it.
  for (const [sourceBiome, kinds] of Object.entries(GROUND_KINDS)) if (kinds.includes(detail)) return `nature-ground-${sourceBiome}:${detail}`;
  return null;
}

export function drawRasterNature(c, kind, biome = 'taiga', rawDetail = '', variant = 0, pixelScale = 1) {
  if (!TREE_KINDS[biome]) biome = 'taiga';
  const detail = normalizedDetail(rawDetail), v = wrap(variant), r = random(seedFor(biome, rawDetail === 'bare-foothill' ? 'wooded-foothill' : detail, v));
  if (kind === 'forest') {
    const trees = forestComposition(biome, rawDetail, v);
    if (!trees.every(tree => atlasAvailable(treeID(tree, biome)))) return false;
    for (const tree of trees) drawTree(c, tree, biome, pixelScale);
    return true;
  }
  if (kind === 'tree') {
    const tree = { x: 16, y: 27, size: 22, species: biome === 'desert' ? 'acacia' : 'pine', bare: false, seed: v };
    return drawTree(c, tree, biome, pixelScale);
  }
  if (kind === 'mountain') {
    let mountain = rawDetail === 'bare-foothill' ? 'wooded-foothill' : rawDetail;
    if (!MOUNTAINS.includes(mountain)) mountain = biome === 'desert' ? (rawDetail === 'cliff' ? 'canyon' : 'mesa') : biome === 'tundra' ? 'frost-ridge' : 'granite-ridge';
    const id = `nature-mountains:${mountain}`;
    if (!atlasAvailable(id)) return false;
    // Mixed outcrops and uneven baselines break the repeated peak-per-tile
    // silhouette while preserving the terrain's principal geological identity.
    const paired = r() < .58, width = (paired ? 18 : 21) + r() * 10;
    const pieces = [{ id, width, height: 20 + r() * 16, left: .5 + (31 - width) * r(), bottom: 23 + r() * 8, flip: r() < .5 }];
    if (paired) {
      const neighbors = RELIEF_NEIGHBORS[mountain], companion = neighbors[Math.floor(r() * neighbors.length)];
      const width = 10 + r() * 11;
      pieces.push({ id: `nature-mountains:${companion}`, width, height: 12 + r() * 13,
        left: .5 + (31 - width) * r(), bottom: 23 + r() * 8, flip: r() < .5 });
    }
    for (const piece of pieces.sort((a, b) => a.bottom - b.bottom)) {
      drawAtlas(c, piece.id, piece.left, Math.max(-7.3, piece.bottom - piece.height), piece.width, piece.height, { pixelScale, flipX: piece.flip });
    }
    // The bare variant uses the very same rocky hill without the optional trees.
    if (rawDetail === 'wooded-foothill') for (let i = 0; i < 1 + v % 3; i++) {
      const tree = { x: 6 + r() * 21, y: 21 + r() * 7, size: 6 + r() * 4, species: i % 2 ? 'fir' : 'pine', bare: false, seed: v + i };
      drawTree(c, tree, biome, pixelScale);
    }
    return true;
  }
  if (kind === 'rock') {
    const id = `nature-rocks:${detail === 'glacial' || biome === 'tundra' ? 'tundra-glacial' : biome === 'desert' ? (v % 3 ? 'desert-boulder' : 'desert-strata') : (v % 4 ? 'taiga-boulder' : 'taiga-scree')}`;
    if (!atlasAvailable(id)) return false;
    const rocks = Array.from({ length: 1 + v % 5 }, (_, i) => ({ size: i === 0 ? 14 + r() * 12 : 5 + r() * 10, x: 5 + r() * 22, y: 13 + r() * 17 })).sort((a, b) => a.y - b.y);
    for (const rock of rocks) {
      const x = clamp(rock.x - rock.size / 2, .5, 31.5 - rock.size), y = clamp(rock.y - rock.size * .92, -7, 31 - rock.size);
      drawAtlas(c, id, x, y, rock.size, rock.size, { pixelScale });
    }
    return true;
  }
  if (kind !== 'terrain-detail' || !detail) return false;
  const id = groundID(detail, biome);
  if (!id || !atlasAvailable(id)) return false;
  const flat = ['ice','snow','dunes','saltflat','canyon','lichen','marsh'].includes(detail);
  const count = flat ? 1 + v % 2 : 1 + v % 3;
  const plants = Array.from({ length: count }, () => ({ size: flat ? 14 + r() * 11 : detail === 'deadwood' ? 10 + r() * 8 : 7 + r() * 9, x: 4 + r() * 24, y: 8 + r() * 22 })).sort((a, b) => a.y - b.y);
  c.save(); c.beginPath(); c.rect(0, 0, 32, 32); c.clip();
  if (['ice','snow','dunes','saltflat'].includes(detail)) c.globalAlpha *= .76;
  for (const plant of plants) {
    const x = clamp(plant.x - plant.size / 2, .5, 31.5 - plant.size), y = clamp(plant.y - plant.size * .9, .5, 31.5 - plant.size);
    drawAtlas(c, id, x, y, plant.size, plant.size, { pixelScale });
  }
  c.restore(); return true;
}
