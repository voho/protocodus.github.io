import { registerAtlas, drawAtlas, atlasAvailable, worldArtRevision } from './atlas-runtime.js';
import { forestComposition } from './tree-sprites.js';
import { normalizedDetail } from './terrain-sprites.js';
import { treeShadowGeometry, treeShadowBounds, drawTreeShadows } from './tree-shadows.js';

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
  registerAtlas({ id, path: `./assets/world/${id}/atlas`, biome, columns: 3, rows: 3, maxCell: 256, entries: kinds.map(kind => `${id}:${kind}`) });
}
for (const [biome, kinds] of Object.entries(GROUND_KINDS)) {
  const id = `nature-ground-${biome}`;
  registerAtlas({ id, path: `./assets/world/${id}/atlas`, biome, columns: 3, rows: 3, entries: kinds.map(kind => `${id}:${kind}`) });
}
registerAtlas({ id: 'nature-mountains', path: './assets/world/nature-mountains/atlas', columns: 3, rows: 3, maxCell: 256, entries: MOUNTAINS.map(kind => `nature-mountains:${kind}`) });
registerAtlas({ id: 'nature-rocks', path: './assets/world/nature-rocks/atlas', columns: 3, rows: 3, maxCell: 256, entries: ROCKS.map(kind => `nature-rocks:${kind}`) });

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
  // Generated woodland includes these habitat variants in addition to the
  // original simulation species. Select them from each stable tree seed so
  // existing companies gain the complete artwork without rewriting geography.
  if (!tree.bare && tree.size >= 12) {
    if (biome === 'tundra' && species === 'pine' && tree.seed % 4 === 0) species = 'ice-pine';
    else if (biome === 'tundra' && species === 'dwarf-birch' && tree.seed % 3 === 0) species = 'willow-tree';
    else if (biome === 'desert' && species === 'joshua' && tree.seed % 4 === 0) species = 'succulent-tree';
  }
  if (!TREE_KINDS[biome].includes(species)) species = TREE_KINDS[biome][0];
  return `nature-trees-${biome}:${species}`;
}
function drawTree(c, tree, biome, pixelScale) {
  const box = tree.size * 1.18;
  return drawAtlas(c, treeID(tree, biome), tree.x - box / 2, tree.y - box * .955, box, box, { pixelScale });
}
function groundID(detail, biome, variant = 0) {
  // Salt pans have both a thin ground crust and isolated crystalline outcrops.
  if (detail === 'saltflat' && biome === 'desert' && variant % 3 === 0) return 'nature-rocks:desert-salt';
  if (GROUND_KINDS[biome].includes(detail)) return `nature-ground-${biome}:${detail}`;
  const geological = { glacial: biome === 'tundra' ? 'tundra-glacial' : 'taiga-scree', ice: 'tundra-ice', snow: 'tundra-snow', dunes: 'desert-dunes', saltflat: 'desert-salt', canyon: 'desert-strata' };
  if (geological[detail]) return `nature-rocks:${geological[detail]}`;
  if (detail === 'deadwood') return `nature-trees-${biome}:deadwood`;
  // Older companies can contain vegetation from before biome-specific detail
  // palettes. Keep each exact detail visible rather than silently erasing it.
  for (const [sourceBiome, kinds] of Object.entries(GROUND_KINDS)) if (kinds.includes(detail)) return `nature-ground-${sourceBiome}:${detail}`;
  return null;
}

// The footprint grows along the ground axes. Tree height remains a mature-tree
// height instead of stretching a one-tile grove into a tower of foliage.
export function natureObjectLayout(footprint) {
  const span = clamp(Math.floor(footprint) || 2, 2, 3);
  return { width: 64 * span, height: 64 * span, anchorX: 32 * span, anchorY: 48 * span };
}

export function rasterForestComposition(biome='taiga',rawDetail='',variant=0,{density=1,footprint=1}={}){
  if (!TREE_KINDS[biome]) biome = 'taiga';
  const v=wrap(variant);
  if(footprint>1){
    const span=clamp(Math.floor(footprint)||2,2,3),r=random(seedFor(biome,rawDetail,v)),layout=natureObjectLayout(span);
    const species = forestComposition(biome, rawDetail, v), trees = [], extent = span - .85;
    const count = span === 2 ? 6 + v % 3 : 11 + v % 5;
    // Jittered cells and a minimum spacing create an irregular open grove, with
    // distinct trunks and gaps all the way to the front edge of the parcel.
    for (let i = 0; i < count; i++) {
      let u, w;
      for (let attempt = 0; attempt < 20; attempt++) {
        u = (r() - .5) * extent; w = (r() - .5) * extent;
        if (trees.every(tree => Math.hypot(tree.u - u, tree.w - w) > .28)) break;
      }
      const template = species[i % species.length], size = 27 + r() * 15;
      trees.push({ ...template, seed: template.seed + i * 17, size, u, w,
        x: layout.anchorX + (u - w) * 32,
        y: layout.anchorY + (u + w) * 16 });
    }
    return trees.sort((a,b)=>a.y-b.y);
  }
  const trees=forestComposition(biome,rawDetail,v);
  if(density>1){
    const extras=forestComposition(biome,rawDetail,v+23),target=density>=3?5:3;
    for(let i=0;trees.length<target;i++)trees.push({...extras[i%extras.length]});
    for(const tree of trees){
      tree.size=Math.min(35,tree.size*(density>=3?1.55:1.28));
      const box=tree.size*1.18;
      tree.x=clamp(16+(tree.x-16)*1.4,box/2-7,39-box/2);
      tree.y=clamp(16+(tree.y-16)*1.2,box*.955-15,31);
    }
    trees.sort((a,b)=>a.y-b.y);
  }
  return trees;
}

// All three physical-pixel zoom profiles share this allowance. Retina groves
// exhausted 8 MiB and rebuilt gradients every frame; keep their prepared stamps
// resident while bounding total memory across views and climates.
const shadowCache=new Map(),SHADOW_CACHE_LIMIT=32*1024*1024;
let shadowBytes=0,shadowRevision=-1,shadowCreated=0,shadowHits=0,shadowDrawn=0,shadowSkipped=0;
export function treeShadowCacheStats(){return {entries:shadowCache.size,bytes:shadowBytes,limit:SHADOW_CACHE_LIMIT,created:shadowCreated,hits:shadowHits,drawn:shadowDrawn,skipped:shadowSkipped};}

// x/y is the composition origin, not the tile center. The separate ground pass
// can extend beyond the upright sprite without clipping shadows at its edges.
export function drawRasterTreeShadows(c,{biome='taiga',detail='',variant=0,density=1,footprint=1,x=0,y=0,pixelScale=1,viewBounds=null,preparedState=false}={}){
  if(!TREE_KINDS[biome])biome='taiga';
  const revision=worldArtRevision();if(revision!==shadowRevision){shadowCache.clear();shadowBytes=0;shadowRevision=revision;}
  const scale=clamp(pixelScale,.5,4),span=clamp(Math.floor(footprint)||1,1,3),key=`${biome}:${detail}:${wrap(variant)}:${density}:${span}:${scale}`;
  let stamp=shadowCache.get(key);
  if(stamp){shadowCache.delete(key);shadowCache.set(key,stamp);shadowHits++;}
  else{
    let trees=rasterForestComposition(biome,detail,variant,{density,footprint:span});
    const fallback=!trees.every(tree=>atlasAvailable(treeID(tree,biome)));
    if(fallback){
      trees=forestComposition(biome,detail,variant);
      if(span>1){const layout=natureObjectLayout(span);trees=trees.map(tree=>({...tree,x:layout.anchorX+(tree.x-16)*span,y:layout.anchorY+(tree.y-16)*span,size:tree.size*span}));}
    }
    const opacity=(span>1?.76:density>=3?.7:density>1?.82:1)*(fallback?.72:1);
    const shadows=trees.map(tree=>treeShadowGeometry(tree,biome,{opacity,contact:!fallback})),bounds=treeShadowBounds(shadows);
    const width=bounds.right-bounds.left,height=bounds.bottom-bounds.top,canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
    const context=canvas.getContext('2d');context.scale(scale,scale);context.translate(-bounds.left,-bounds.top);drawTreeShadows(context,shadows);
    stamp={canvas,left:bounds.left,top:bounds.top,width:canvas.width/scale,height:canvas.height/scale,bytes:canvas.width*canvas.height*4};
    while(shadowBytes+stamp.bytes>SHADOW_CACHE_LIMIT&&shadowCache.size){const oldest=shadowCache.keys().next().value;shadowBytes-=shadowCache.get(oldest).bytes;shadowCache.delete(oldest);}
    shadowCache.set(key,stamp);shadowBytes+=stamp.bytes;shadowCreated++;
  }
  const left=x+stamp.left,top=y+stamp.top;
  if(viewBounds&&(left>viewBounds.right+2||top>viewBounds.bottom+2||left+stamp.width<viewBounds.left-2||top+stamp.height<viewBounds.top-2)){shadowSkipped++;return;}
  if(!preparedState){c.save();c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';}
  c.drawImage(stamp.canvas,left,top,stamp.width,stamp.height);shadowDrawn++;
  if(!preparedState)c.restore();
}

export function drawRasterNatureObject(c, kind, biome, rawDetail, variant, footprint, pixelScale = 1) {
  if (!TREE_KINDS[biome]) biome = 'taiga';
  const span = clamp(Math.floor(footprint) || 2, 2, 3), v = wrap(variant), layout = natureObjectLayout(span);
  if(kind==='forest'){
    const trees=rasterForestComposition(biome,rawDetail,v,{footprint:span});
    if(!trees.every(tree=>atlasAvailable(treeID(tree,biome))))return false;
    for(const tree of trees)drawTree(c,tree,biome,pixelScale);
    return true;
  }
  let id;
  if (kind === 'mountain') {
    let detail = rawDetail === 'bare-foothill' ? 'wooded-foothill' : rawDetail;
    if (!MOUNTAINS.includes(detail)) detail = biome === 'desert' ? 'mesa' : biome === 'tundra' ? 'frost-ridge' : 'granite-ridge';
    id = `nature-mountains:${detail}`;
  } else if (kind === 'rock') {
    const detail = normalizedDetail(rawDetail), rock = biome === 'tundra'
      ? detail === 'snow' ? 'tundra-snow' : detail === 'ice' ? 'tundra-ice' : 'tundra-glacial'
      : biome === 'desert' ? detail === 'saltflat' ? 'desert-salt' : detail === 'dunes' ? 'desert-dunes' : v % 3 ? 'desert-boulder' : 'desert-strata'
      : v % 4 ? 'taiga-boulder' : 'taiga-scree';
    id = `nature-rocks:${rock}`;
  } else return false;
  const size = (kind === 'mountain' ? 60 : 56) * span;
  return drawAtlas(c, id, layout.anchorX - size / 2, layout.anchorY + 14 * span - size, size, size, { pixelScale, flipX: v % 2 === 1 });
}

export function drawRasterNature(c, kind, biome = 'taiga', rawDetail = '', variant = 0, pixelScale = 1, { density = 1 } = {}) {
  if (!TREE_KINDS[biome]) biome = 'taiga';
  const detail = normalizedDetail(rawDetail), v = wrap(variant), r = random(seedFor(biome, rawDetail === 'bare-foothill' ? 'wooded-foothill' : detail, v));
  if (kind === 'forest') {
    const trees = rasterForestComposition(biome,rawDetail,v,{density});
    if (!trees.every(tree => atlasAvailable(treeID(tree, biome)))) return false;
    for (const tree of trees) drawTree(c, tree, biome, pixelScale);
    return true;
  }
  if (kind === 'tree') {
    const species = TREE_KINDS[biome].includes(rawDetail) ? rawDetail : biome === 'desert' ? 'acacia' : 'pine';
    const tree = { x: 16, y: 27, size: 22, species, bare: false, seed: v };
    return drawTree(c, tree, biome, pixelScale);
  }
  if (kind === 'mountain') {
    let mountain = rawDetail === 'bare-foothill' ? 'wooded-foothill' : rawDetail;
    if (!MOUNTAINS.includes(mountain)) mountain = biome === 'desert' ? (rawDetail === 'cliff' ? 'canyon' : 'mesa') : biome === 'tundra' ? 'frost-ridge' : 'granite-ridge';
    // A geological region contains related exposures, not an identical tiny
    // glacier/mesa on every marked tile. Keep the original identity dominant
    // across the region, with companion strata sharing its climate/material.
    if (v % 5 >= 2) {
      const family = RELIEF_NEIGHBORS[mountain];
      mountain = family[Math.floor(r() * family.length)];
    }
    const id = `nature-mountains:${mountain}`;
    if (!atlasAvailable(id)) return false;
    // Mixed outcrops and uneven baselines break the repeated peak-per-tile
    // silhouette while preserving the terrain's principal geological identity.
    const paired = r() < .52, width = 20 + r() * 11;
    const pieces = [{ id, width, height: width * (.88 + r() * .1), left: .5 + (31 - width) * r(), bottom: 25 + r() * 6, flip: r() < .5 }];
    if (paired) {
      const neighbors = RELIEF_NEIGHBORS[mountain], companion = neighbors[Math.floor(r() * neighbors.length)];
      const width = 10 + r() * 8;
      pieces.push({ id: `nature-mountains:${companion}`, width, height: width * .9,
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
    // "glacial" is also the old saved name for ordinary taiga scree. Respect
    // its climate rather than turning every northern rock into a tundra image.
    const rockKind = biome === 'tundra'
      ? (detail === 'snow' ? 'tundra-snow' : detail === 'ice' ? 'tundra-ice' : 'tundra-glacial')
      : biome === 'desert'
        ? (detail === 'saltflat' ? 'desert-salt' : detail === 'dunes' ? 'desert-dunes' : v % 3 ? 'desert-boulder' : 'desert-strata')
        : (v % 4 ? 'taiga-boulder' : 'taiga-scree');
    const id = `nature-rocks:${rockKind}`;
    if (!atlasAvailable(id)) return false;
    // Each regenerated patch already contains embedded fragments. A single
    // main outcrop and an occasional satellite avoid a pile of repeated icons.
    const rocks = Array.from({ length: v % 4 === 0 ? 2 : 1 }, (_, i) => ({ size: i === 0 ? 20 + r() * 10 : 6 + r() * 6, x: 5 + r() * 22, y: 13 + r() * 17 })).sort((a, b) => a.y - b.y);
    for (const rock of rocks) {
      const x = clamp(rock.x - rock.size / 2, .5, 31.5 - rock.size), y = clamp(rock.y - rock.size * .92, -7, 31 - rock.size);
      drawAtlas(c, id, x, y, rock.size, rock.size, { pixelScale });
    }
    return true;
  }
  if (kind !== 'terrain-detail' || !detail) return false;
  const id = groundID(detail, biome, v);
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
