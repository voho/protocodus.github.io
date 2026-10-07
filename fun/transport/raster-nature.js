import { registerAtlas, drawAtlas, atlasAvailable, worldArtRevision } from './atlas-runtime.js';
import { forestComposition, drawTree as drawNativeTree } from './tree-sprites.js';
import { normalizedDetail } from './terrain-sprites.js';
import { treeShadowGeometry, treeShadowBounds, drawTreeShadows } from './tree-shadows.js';
import { TREE_KINDS, ORIGINAL_TREE_KINDS, EXTRA_TREE_ART, HOLLOW_TREE_ART, CACTUS_ART, TREE_ART_SCALE, CACTUS_ART_SCALE } from './tree-art-catalog.js';

// These are individual transparent objects, rather than repeated forest tiles.
// Their placement still uses the original deterministic 64 woodland variants.
const TREE_IDS = Object.fromEntries(Object.entries(TREE_KINDS).map(([biome,kinds])=>[biome,Object.fromEntries(kinds.map(kind=>[kind,`nature-trees-${biome}:${kind}`]))]));
const EXTRA_TREE_IDS = Object.fromEntries(Object.entries(EXTRA_TREE_ART).map(([biome,trees])=>[biome,trees.map(tree=>TREE_IDS[biome][tree.id])]));
const HOLLOW_TREE_IDS = HOLLOW_TREE_ART.map(tree=>TREE_IDS.tundra[tree.id]);
const HOLLOW_TREE_BY_KIND = Object.fromEntries(HOLLOW_TREE_ART.map(tree=>[tree.id,tree]));
const EXTRA_SHADOW_ART = Object.fromEntries([...Object.entries(EXTRA_TREE_ART).flatMap(([biome,trees])=>trees.map(tree=>[TREE_IDS[biome][tree.id],tree])),...HOLLOW_TREE_ART.map(tree=>[TREE_IDS.tundra[tree.id],tree])]);
const CACTUS_IDS = CACTUS_ART.map(plant=>`nature-ground-desert:${plant.id}`);
const CACTUS_IDS_BY_KIND = Object.fromEntries(CACTUS_ART.map((plant,index)=>[plant.id,CACTUS_IDS[index]]));
const CACTUS_ID_SET = new Set(CACTUS_IDS);
const JUVENILE_CONIFERS = new Set(['pine','spruce','fir','larch']);
const ORIGINAL_GROUND_KINDS = {
  taiga: ['wildflowers','bluebells','ferns','grass-tufts','berry-bushes','heather','shrubs','reeds','marsh'],
  tundra: ['arctic-poppies','cotton-grass','heather','lichen','willow-scrub','tundra-grass','shrubs','reeds','marsh'],
  desert: ['cactus','agave','prickly-pear','aloe','desert-flowers','dry-grass','scrub','reeds','saltflat'],
};
const GROUND_KINDS = Object.fromEntries(Object.entries(ORIGINAL_GROUND_KINDS).map(([biome,kinds])=>[biome,[...kinds,...kinds.map(kind=>`${kind}-sparse`),...(biome==='desert'?CACTUS_ART.map(plant=>plant.id):[])]]));
const MOUNTAINS = ['granite-ridge','wooded-foothill','granite-peak','ice-peak','glacier','frost-ridge','mesa','butte','canyon'];
const RELIEF_NEIGHBORS = {
  'granite-ridge': ['granite-peak','wooded-foothill'], 'wooded-foothill': ['granite-ridge','granite-peak'],
  'granite-peak': ['granite-ridge','wooded-foothill'], 'ice-peak': ['frost-ridge','glacier'],
  glacier: ['frost-ridge','ice-peak'], 'frost-ridge': ['glacier','ice-peak'],
  mesa: ['butte','canyon'], butte: ['mesa','canyon'], canyon: ['mesa','butte'],
};
const ROCKS = ['taiga-boulder','taiga-scree','tundra-glacial','tundra-snow','desert-boulder','desert-dunes','desert-salt','desert-strata','tundra-ice'];
// Read-only authored identities for the field guide; tree additions keep the
// established 64 woodland compositions. Copies prevent catalog callers from
// changing those internal species lists.
const frozenClimateLists = lists => Object.freeze(Object.fromEntries(Object.entries(lists).map(([biome, kinds]) => [biome, Object.freeze([...kinds])])));
export const NATURE_ART_CATALOG = Object.freeze({
  trees: frozenClimateLists(TREE_KINDS),
  ground: frozenClimateLists(GROUND_KINDS),
  mountains: Object.freeze([...MOUNTAINS]),
  rocks: Object.freeze([...ROCKS]),
});
for (const [biome, kinds] of Object.entries(ORIGINAL_TREE_KINDS)) {
  const id = `nature-trees-${biome}`;
  registerAtlas({ id, path: `./assets/world/${id}/atlas`, biome, columns: 3, rows: 3, maxCell: 256, entries: kinds.map(kind => `${id}:${kind}`) });
  for (let number=1;number<=2;number++) registerAtlas({
    id: `${id}-variety-${number}`, path: `./assets/world/${id}/variety-${number}/atlas`,
    biome, columns: 3, rows: 3, maxCell: 256,
    entries: EXTRA_TREE_IDS[biome].slice((number-1)*9,number*9),
  });
  if (biome==='tundra') registerAtlas({id:`${id}-hollow`,path:`./assets/world/${id}/hollow/atlas`,biome,columns:3,rows:1,maxCell:256,entries:HOLLOW_TREE_IDS});
}
for (const [biome, kinds] of Object.entries(ORIGINAL_GROUND_KINDS)) {
  const id = `nature-ground-${biome}`;
  registerAtlas({ id, path: `./assets/world/${id}/atlas`, biome, columns: 3, rows: 3, entries: kinds.map(kind => `${id}:${kind}`) });
  registerAtlas({ id:`${id}-sparse`, path:`./assets/world/${id}/sparse/atlas`, biome, columns:3, rows:3, entries:kinds.map(kind=>`${id}:${kind}-sparse`) });
}
registerAtlas({id:'nature-ground-desert-cacti',path:'./assets/world/nature-ground-desert/cacti/atlas',biome:'desert',columns:3,rows:3,maxCell:256,entries:CACTUS_IDS});
registerAtlas({ id: 'nature-mountains', path: './assets/world/nature-mountains/atlas', columns: 3, rows: 3, maxCell: 1024, entries: MOUNTAINS.map(kind => `nature-mountains:${kind}`) });
registerAtlas({ id: 'nature-rocks', path: './assets/world/nature-rocks/atlas', columns: 3, rows: 3, maxCell: 1024, entries: ROCKS.map(kind => `nature-rocks:${kind}`) });

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = value => ((Math.floor(value) || 0) % 64 + 64) % 64;
function random(seed) { let value = seed >>> 0; return () => { value += 0x6d2b79f5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seedFor(biome, detail, variant) { let seed = 2166136261; for (const char of `${biome}:${detail}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619); return seed ^ Math.imul(wrap(variant) + 1, 2654435761); }
function artworkChoice(seed) {
  let choice=seed>>>0;
  choice=Math.imul(choice^choice>>>16,0x7feb352d);
  choice=Math.imul(choice^choice>>>15,0x846ca68b);
  return (choice^choice>>>16)>>>0;
}
// Artwork selection uses each already-published tree seed. Its original species,
// size, position and bare state stay available to native drawing and shadows.
export function rasterTreeIdentity(tree, biome='taiga', exact=false) {
  if (!TREE_IDS[biome]) biome = 'taiga';
  if (exact) return TREE_IDS[biome][tree.species] || TREE_IDS[biome][TREE_KINDS[biome][0]];
  let species = tree.species;
  if (tree.bare) {
    if (biome==='tundra'&&tree.size>=12) {
      const choice=artworkChoice(tree.seed);
      if (choice%4===0) return HOLLOW_TREE_IDS[(choice>>>2)%HOLLOW_TREE_IDS.length];
    }
    species = tree.seed % 3 === 0 ? 'deadwood' : biome === 'desert' ? 'bare-acacia' : 'bare-birch';
  }
  else if (tree.size < 12) {
    if (biome === 'desert' && species === 'palm') species = 'small-palm';
    else if (biome === 'desert' && species === 'joshua') species = 'small-joshua';
    else if (biome !== 'desert' && JUVENILE_CONIFERS.has(species)) species = 'sapling';
  }
  // Generated woodland includes these habitat variants in addition to the
  // original simulation species. Select them from each stable tree seed so
  // existing companies gain the complete artwork without rewriting geography.
  if (!tree.bare && tree.size >= 12) {
    // Two-thirds of mature trees use an added species. Mix all seed bits so
    // neighboring templates and the original habitat rules do not correlate.
    const choice=artworkChoice(tree.seed);
    if (choice % 3) return EXTRA_TREE_IDS[biome][Math.floor(choice / 3) % EXTRA_TREE_IDS[biome].length];
    if (biome === 'tundra' && species === 'pine' && tree.seed % 4 === 0) species = 'ice-pine';
    else if (biome === 'tundra' && species === 'dwarf-birch' && tree.seed % 3 === 0) species = 'willow-tree';
    else if (biome === 'desert' && species === 'joshua' && tree.seed % 4 === 0) species = 'succulent-tree';
  }
  return TREE_IDS[biome][species] || TREE_IDS[biome][TREE_KINDS[biome][0]];
}
function drawTree(c, tree, biome, pixelScale, exact=false) {
  const box = tree.size * TREE_ART_SCALE.cellSizeMultiplier;
  return drawAtlas(c, rasterTreeIdentity(tree, biome, exact), tree.x - box / 2, tree.y - box * TREE_ART_SCALE.rootAnchor, box, box, { pixelScale });
}
// Added art keeps its calibrated height inside the same tree envelope. Match
// its projected crown shadow only when that exact art is usable; a missing
// download keeps the established native tree and its original shadow geometry.
export function rasterTreeShadowRecord(tree,biome='taiga') {
  const id=rasterTreeIdentity(tree,biome),art=EXTRA_SHADOW_ART[id];
  return art&&atlasAvailable(id)?{...tree,species:art.id,size:tree.size*art.heightMetres/TREE_ART_SCALE.nominalReferenceHeightMetres}:tree;
}
// Existing cactus parcels acquire new silhouettes without changing their saved
// detail or climate. Named catalog previews retain their requested identity.
export function rasterCactusIdentity(detail='cactus',variant=0) {
  if (CACTUS_IDS_BY_KIND[detail]) return CACTUS_IDS_BY_KIND[detail];
  if (detail!=='cactus'&&detail!=='prickly-pear') return null;
  const choice=artworkChoice(seedFor('desert',detail,variant));
  return choice%3?CACTUS_IDS[Math.floor(choice/3)%CACTUS_IDS.length]:`nature-ground-desert:${detail}`;
}
export const nativeNatureDetail=detail=>CACTUS_IDS_BY_KIND[detail]?'cactus':detail?.replace(/-sparse$/,'');
export function drawNativeHollowTree(c,detail,biome='tundra',variant=0,profile='town') {
  const art=HOLLOW_TREE_BY_KIND[detail];if(!art)return false;
  const tree={x:16,y:27,size:TREE_ART_SCALE.nominalSpriteSize*art.heightMetres/TREE_ART_SCALE.nominalReferenceHeightMetres,species:detail.slice(7),bare:true,seed:seedFor(biome,detail,variant)>>>0};
  drawNativeTree(c,tree,biome,profile);
  const width=tree.size*.065,height=tree.size*.32;
  c.save();c.fillStyle=tree.species==='birch'?'#b9bba5':'#827961';
  c.beginPath();c.moveTo(tree.x-width,tree.y);c.lineTo(tree.x-width*.85,tree.y-height*.8);
  c.lineTo(tree.x-width*.12,tree.y-height);c.lineTo(tree.x+width*.9,tree.y-height*.72);c.lineTo(tree.x+width,tree.y);c.closePath();c.fill();
  c.fillStyle='#334039';c.beginPath();c.ellipse(tree.x,tree.y-height*.48,width*.48,height*.31,0,0,Math.PI*2);c.fill();c.restore();
  return true;
}
function groundID(detail, biome, variant = 0) {
  // Salt pans have both a thin ground crust and isolated crystalline outcrops.
  if (detail === 'saltflat' && biome === 'desert' && variant % 3 === 0) return 'nature-rocks:desert-salt';
  if (biome==='desert') { const cactus=rasterCactusIdentity(detail,variant);if(cactus)return cactus; }
  if (GROUND_KINDS[biome].includes(detail)) return `nature-ground-${biome}:${detail}`;
  const geological = { glacial: biome === 'tundra' ? 'tundra-glacial' : 'taiga-scree', ice: 'tundra-ice', snow: 'tundra-snow', dunes: 'desert-dunes', saltflat: 'desert-salt', canyon: 'desert-strata' };
  if (geological[detail]) return `nature-rocks:${geological[detail]}`;
  if (detail === 'deadwood') return `nature-trees-${biome}:deadwood`;
  // Older companies can contain vegetation from before biome-specific detail
  // palettes. Keep each exact detail visible rather than silently erasing it.
  for (const [sourceBiome, kinds] of Object.entries(GROUND_KINDS)) if (kinds.includes(detail)) return `nature-ground-${sourceBiome}:${detail}`;
  return null;
}

// Sparse artwork is a distinct authored patch with open ground between clumps.
// Stable seed selection changes only rendering; no saved terrain is rewritten.
export function rasterGroundIdentity(detail, biome='taiga', variant=0) {
  const id=groundID(detail,biome,variant);
  if(!id||id!==`nature-ground-${biome}:${detail}`||detail.endsWith('-sparse')||!ORIGINAL_GROUND_KINDS[biome]?.includes(detail)||wrap(variant)===0)return id;
  return artworkChoice(seedFor(biome,`${detail}-density`,variant))%3!==0?`${id}-sparse`:id;
}

// The footprint grows along the ground axes. Tree height remains a mature-tree
// height instead of stretching a one-tile grove into a tower of foliage.
export function natureObjectLayout(footprint) {
  const span = clamp(Math.floor(footprint) || 2, 2, 6);
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
      const box=tree.size*TREE_ART_SCALE.cellSizeMultiplier;
      tree.x=clamp(16+(tree.x-16)*1.4,box/2-7,39-box/2);
      tree.y=clamp(16+(tree.y-16)*1.2,box*TREE_ART_SCALE.rootAnchor-15,31);
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
    const fallback=!trees.every(tree=>atlasAvailable(rasterTreeIdentity(tree,biome)));
    if(fallback){
      trees=forestComposition(biome,detail,variant);
      if(span>1){const layout=natureObjectLayout(span);trees=trees.map(tree=>({...tree,x:layout.anchorX+(tree.x-16)*span,y:layout.anchorY+(tree.y-16)*span,size:tree.size*span}));}
    }
    const opacity=(span>1?.76:density>=3?.7:density>1?.82:1)*(fallback?.72:1);
    const shadows=trees.map(tree=>treeShadowGeometry(fallback?tree:rasterTreeShadowRecord(tree,biome),biome,{opacity,contact:!fallback})),bounds=treeShadowBounds(shadows);
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
  const span = clamp(Math.floor(footprint) || 2, 2, kind === 'forest' ? 3 : 6), v = wrap(variant), layout = natureObjectLayout(span);
  if(kind==='forest'){
    const trees=rasterForestComposition(biome,rawDetail,v,{footprint:span});
    if(!trees.every(tree=>atlasAvailable(rasterTreeIdentity(tree,biome))))return false;
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
  return drawAtlas(c, id, layout.anchorX - size / 2, layout.anchorY + 14 * span - size, size, size, { pixelScale });
}

export function drawRasterNature(c, kind, biome = 'taiga', rawDetail = '', variant = 0, pixelScale = 1, { density = 1 } = {}) {
  if (!TREE_KINDS[biome]) biome = 'taiga';
  const detail = normalizedDetail(rawDetail), v = wrap(variant), r = random(seedFor(biome, rawDetail === 'bare-foothill' ? 'wooded-foothill' : detail, v));
  if (kind === 'forest') {
    const trees = rasterForestComposition(biome,rawDetail,v,{density});
    if (!trees.every(tree => atlasAvailable(rasterTreeIdentity(tree, biome)))) return false;
    for (const tree of trees) drawTree(c, tree, biome, pixelScale);
    return true;
  }
  if (kind === 'tree') {
    const species = TREE_IDS[biome][rawDetail] ? rawDetail : biome === 'desert' ? 'acacia' : 'pine';
    const tree = { x: 16, y: 27, size: TREE_ART_SCALE.nominalSpriteSize, species, bare: false, seed: v };
    return drawTree(c, tree, biome, pixelScale, true);
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
    r(); // Retain the published placement sequence; artwork keeps its aspect ratio.
    const pieces = [{ id, width, height: width, left: .5 + (31 - width) * r(), bottom: 25 + r() * 6, flip: r() < .5 }];
    if (paired) {
      const neighbors = RELIEF_NEIGHBORS[mountain], companion = neighbors[Math.floor(r() * neighbors.length)];
      const width = 10 + r() * 8;
      pieces.push({ id: `nature-mountains:${companion}`, width, height: width,
        left: .5 + (31 - width) * r(), bottom: 23 + r() * 8, flip: r() < .5 });
    }
    for (const piece of pieces.sort((a, b) => a.bottom - b.bottom)) {
      drawAtlas(c, piece.id, piece.left, Math.max(-7.3, piece.bottom - piece.height), piece.width, piece.height, { pixelScale });
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
  const id = rasterGroundIdentity(detail, biome, v);
  if (!id || !atlasAvailable(id)) return false;
  const cactus=CACTUS_ID_SET.has(id);
  const flat = ['ice','snow','dunes','saltflat','canyon','lichen','marsh'].includes(detail);
  const sparse = id.endsWith('-sparse');
  const count = sparse ? 1 : flat ? 1 + v % 2 : 1 + v % 3;
  const plants = Array.from({ length: count }, () => {
    const originalSize=flat?14+r()*11:detail==='deadwood'?10+r()*8:7+r()*9;
    return {size:cactus?CACTUS_ART_SCALE.nominalSpriteSize:originalSize,x:4+r()*24,y:8+r()*22};
  }).sort((a,b)=>a.y-b.y);
  c.save(); c.beginPath(); c.rect(0, 0, 32, 32); c.clip();
  if (['ice','snow','dunes','saltflat'].includes(detail)) c.globalAlpha *= .76;
  for (const plant of plants) {
    const x = clamp(plant.x - plant.size / 2, .5, 31.5 - plant.size), y = clamp(plant.y - plant.size * (cactus?CACTUS_ART_SCALE.rootAnchor:.9), .5, 31.5 - plant.size);
    drawAtlas(c, id, x, y, plant.size, plant.size, { pixelScale });
  }
  c.restore(); return true;
}
