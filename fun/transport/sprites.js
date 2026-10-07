import { BUILDINGS, SHOP_KINDS, residentialKind, commercialKind } from './buildings.js';
import { INDUSTRIES, WORKSHOP } from './data.js';
import { worldArtRevision, preloadWorldArt, startupArtCells } from './atlas-runtime.js';
import { drawRasterIndustry, hasRasterIndustry } from './raster-industries.js';
import { drawRasterBuilding, hasRasterBuilding, buildingArtworkDesign } from './raster-buildings.js';
import { drawRasterNature, drawRasterNatureObject, natureObjectLayout, nativeNatureDetail, drawNativeHollowTree } from './raster-nature.js';
import { drawTownBuilding } from './building-sprites.js';
import { drawTownFeature } from './town-feature-sprites.js';
import { drawProcessingPlant } from './processing-sprites.js';
import { featureSpriteUnits, SPRITE_SCALE } from './sprite-art-direction.js';
import { drawTerrainDetail } from './terrain-sprites.js';
import { drawForest, drawTree } from './tree-sprites.js';
import { drawMountain, drawBoulder } from './relief-sprites.js';
import { drawRasterHouse, hasRasterHouse, houseAssetsRevision, preloadHouses } from './raster-houses.js';
import { createSpriteCache } from './sprite-cache.js';
export { createSpriteCache } from './sprite-cache.js';
// Generated artwork and emergency code-native fallbacks share one bounded cache.
export const TILE = 32;
export const PALETTES = {
  taiga: { ground: '#91a77a', ground2: '#9aae82', ground3: '#879f72', speck: '#bcc19a', dark: '#738e65', water: '#548f95', deep: '#326b77', shore: '#aaaf91', forest: '#799664', mountain: '#999d91', sand: '#c4ba94' },
  tundra: { ground: '#cbd4c5', ground2: '#d7dece', ground3: '#bfcbbc', speck: '#dde3d4', dark: '#91a695', water: '#709da7', deep: '#426f83', shore: '#b8c5bb', forest: '#99ac9c', mountain: '#afb7b6', sand: '#c8c8b1' },
  desert: { ground: '#c6b48b', ground2: '#cfbc92', ground3: '#bfaa7f', speck: '#e6d0a1', dark: '#b29b70', water: '#629f9d', deep: '#367984', shore: '#c6b185', forest: '#b5ae7f', mountain: '#aa9e8c', sand: '#d4bc8d' },
};
export function rng(seed) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function polygon(ctx, points, fill) { ctx.fillStyle = fill; ctx.beginPath(); points.forEach(([x,y],i)=>i ? ctx.lineTo(x,y):ctx.moveTo(x,y)); ctx.closePath(); ctx.fill(); }
function ellipse(ctx,x,y,rx,ry,fill) {ctx.fillStyle=fill;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function windowRow(ctx,x,y,count,color='#f4dfad',step=4,footprint=1) { const w=featureSpriteUnits(.9,footprint),h=featureSpriteUnits(SPRITE_SCALE.windowHeightMetres,footprint);ctx.fillStyle='#40565b';for(let i=0;i<count;i++){ctx.fillRect(x+i*step,y,w,h);ctx.fillStyle=color;ctx.fillRect(x+i*step,y,w*.55,h*.55);ctx.fillStyle='#40565b';} }
function conifer(ctx,x,y,size,r,biome,detailLevel='town',species='pine') {
  drawTree(ctx,{x,y,size,species:biome==='desert'?'acacia':species,bare:false,seed:Math.floor(r()*4294967296)},biome,detailLevel);
}
const boulder=drawBoulder;
function house(ctx,r,level,biome) {
  const w=level>1?24:20+r()*3,h=level>1?18:15+r()*2,x=16-w/2,y=level>1?8:9;
  ctx.strokeStyle='#c5c5a883';ctx.lineWidth=.65;ctx.strokeRect(2,3,28,27);
  ctx.fillStyle='#afa98a';ctx.fillRect(14,25,3,7);
  ellipse(ctx,4,26,2.5,2,'#687d4c');ellipse(ctx,27,6,2,2,'#728854');
  const roof=biome==='desert'?['#b48765','#a77555','#c19970']:['#997354','#ad7756','#617677','#9e8661','#8d6450'];
  const c=roof[Math.floor(r()*roof.length)];
  ctx.fillStyle='#34433636';ctx.fillRect(x+3,y+5,w+3,h+1);
  ctx.fillStyle='#8b8874';ctx.fillRect(x,y+4,w,h);
  ctx.fillStyle='#d2cfb5';ctx.fillRect(x,y+4,w-2,h-1);
  windowRow(ctx,x+2,y+h-1,Math.max(2,Math.floor(w/4)-1));
  ctx.fillStyle='#e0d8ba';ctx.fillRect(x,y+4,w-2,2);
  if(level>1) windowRow(ctx,x+2,y+h-5,3);
  polygon(ctx,[[x-1,y+10],[x+2,y],[x+w-2,y],[x+w+1,y+10]],c);
  polygon(ctx,[[x+2,y],[x+w-2,y],[x+w-1,y+4],[x+1,y+4]],'#192c272c');
  polygon(ctx,[[x+1,y+4],[x+w-1,y+4],[x+w+1,y+10],[x-1,y+10]],'#ffffff10');
  ctx.strokeStyle='#4e40323b';ctx.lineWidth=.55;for(let i=2;i<10;i+=2){ctx.beginPath();ctx.moveTo(x+1-i*.1,y+i);ctx.lineTo(x+w-1+i*.1,y+i);ctx.stroke();}
  ctx.strokeStyle='#dbc49b67';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x+1,y+4);ctx.lineTo(x+w-1,y+4);ctx.stroke();
  ctx.fillStyle='#544c403a';ctx.fillRect(x-1,y+10,w+2,1);
  ctx.fillStyle='#6a6255';ctx.fillRect(x+w-5,y+2,2,5);ctx.fillStyle='#b7a78e';ctx.fillRect(x+w-5,y+1,2,2);
  ctx.fillStyle='#796b57';ctx.fillRect(x+w/2-1,y+h+1,3,3);
  ctx.fillStyle='#a7ac80';ctx.fillRect(x-3,y+h+1,2,3);ctx.fillRect(x+w+1,y+h-3,2,4);
}
function building(ctx,kind,r,level,biome) {
  if(kind==='house'){house(ctx,r,level,biome);return;}
  const tall=kind==='apartment'||kind==='office'; const h=tall?Math.min(19,9+level*3):12;
  const y=22-h, x=5, w=22;
  ctx.fillStyle='#293c333d';polygon(ctx,[[x+3,y+4],[29,y+4],[32,27],[10,29]],'#26362d35');
  ctx.fillStyle=kind==='shop'?'#b3a082':'#d8d6be';ctx.fillRect(x,y+3,w,h);
  ctx.fillStyle='#a6ad9e';ctx.fillRect(x+17,y+3,5,h);
  ctx.fillStyle=kind==='office'?'#788e91':kind==='factory'?'#75898a':kind==='shop'?'#d1b593':'#8f9b97';ctx.fillRect(x-1,y,24,8);
  ctx.fillStyle='#ffffff32';ctx.fillRect(x,y,22,1);ctx.fillRect(x,y,1,7);
  ctx.fillStyle='#405554';ctx.fillRect(x+16,y+2,5,3);ctx.fillStyle='#b5bab0';ctx.fillRect(x+17,y+2,4,2);
  ctx.fillStyle='#526866';ctx.fillRect(x+3,y+3,6,2);
  for(let yy=y+10;yy<y+h+3;yy+=4) windowRow(ctx,x+3,yy,4,tall?'#dce5d7':'#d4e1d4');
  if(kind==='shop') {ctx.fillStyle='#5b7d6d';ctx.fillRect(x,y+9,17,3);ctx.fillStyle='#e9d9b2';for(let i=0;i<4;i++)ctx.fillRect(x+i*4,y+9,2,3);ctx.fillStyle='#3e5657';ctx.fillRect(x+3,23,6,3);}
  if(kind==='factory'){ctx.fillStyle='#8d715c';ctx.fillRect(22,2,4,12);ctx.fillStyle='#67534a';ctx.fillRect(21,2,6,2);}
}
function industry(ctx,kind,r,biome,detailLevel='town',footprint=5,{gardenGround='art'}={}) {
  if(drawProcessingPlant(ctx,kind,r,biome,detailLevel,footprint,{gardenGround}))return;
  if(gardenGround!=='terrain') {
    ctx.fillStyle=biome==='desert'?'#b6a787':'#a1a68e';ctx.fillRect(2,12,28,17);
    ctx.fillStyle='#65766355';ctx.fillRect(1,29,30,1);ctx.fillStyle='#d0c3a0';ctx.fillRect(2,27,28,2);
  }
  if(/mine|quarry|coal|iron|copper|ore|salt/.test(kind)) {
    ellipse(ctx,14,21,11,7,'#6c7062');ellipse(ctx,14,21,8,5,'#858570');ellipse(ctx,14,21,5,3,'#515a50');
    ctx.strokeStyle='#8b785b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(20,25);ctx.lineTo(24,7);ctx.lineTo(28,25);ctx.moveTo(21,18);ctx.lineTo(27,18);ctx.moveTo(23,11);ctx.lineTo(26,11);ctx.stroke();
    ctx.strokeStyle='#414e47';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(10,24);ctx.lineTo(22,16);ctx.lineTo(27,16);ctx.stroke();
    boulder(ctx,6,14,7,r,biome,detailLevel);ctx.fillStyle='#c3a358';ctx.fillRect(5,24,5,3);ctx.fillStyle='#354845';ctx.fillRect(5,26,2,2);ctx.fillRect(9,26,2,2);
  } else if(/forest|logging|lumber/.test(kind)) {
    conifer(ctx,8,17,10,r,biome,detailLevel);conifer(ctx,23,15,13,r,biome,detailLevel);
    for(let i=0;i<4;i++){ctx.fillStyle='#8f7051';ctx.fillRect(6,20+i*2,17,2);ctx.fillStyle='#c9ad76';ctx.fillRect(6,20+i*2,2,2);ctx.fillStyle='#604e3b';ctx.fillRect(22,20+i*2,2,2);}
    ctx.fillStyle='#c5a54c';ctx.fillRect(23,23,6,4);ctx.fillStyle='#435347';ctx.fillRect(23,27,2,2);ctx.fillRect(27,27,2,2);
  } else if(/farm|grain|wheat|ranch|plantation|cotton/.test(kind)) {
    ctx.fillStyle='#a49a61';ctx.fillRect(3,16,26,12);ctx.strokeStyle='#d1bb77';ctx.lineWidth=1;for(let x=4;x<28;x+=3){ctx.beginPath();ctx.moveTo(x,17);ctx.lineTo(x,27);ctx.stroke();}
    ctx.fillStyle='#ddd5ae';ctx.fillRect(4,8,15,10);polygon(ctx,[[3,9],[11,3],[20,9],[20,12],[3,12]],'#9f6e4e');ctx.fillStyle='#595e47';ctx.fillRect(9,13,5,5);ellipse(ctx,25,10,3,5,'#b7b6a0');ellipse(ctx,25,6,3,2,'#d9d4b8');
  } else if(kind==='oil-well') {
    ctx.fillStyle='#737b6c';ctx.fillRect(4,24,24,3);ctx.strokeStyle='#646657';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(12,25);ctx.lineTo(17,11);ctx.lineTo(22,25);ctx.moveTo(14,19);ctx.lineTo(20,19);ctx.stroke();
    ctx.strokeStyle='#b39c67';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(7,8);ctx.lineTo(25,15);ctx.stroke();
    polygon(ctx,[[5,6],[10,7],[8,16],[4,15]],'#b7a276');ctx.strokeStyle='#49584d';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(5,14);ctx.lineTo(5,26);ctx.stroke();
    ellipse(ctx,25,23,4,4,'#a5aa92');ctx.fillStyle='#7c806a';ctx.fillRect(25,22,5,6);
  } else if(kind==='fishery') {
    ctx.fillStyle='#79989b';ctx.fillRect(3,21,27,9);ctx.fillStyle='#b49f74';ctx.fillRect(4,19,25,3);ctx.fillRect(24,19,4,11);
    ctx.fillStyle='#ddd7b8';ctx.fillRect(3,10,18,12);polygon(ctx,[[2,10],[11,4],[22,10],[22,13],[2,13]],'#657e84');windowRow(ctx,6,15,3,'#c6ddd3',4,footprint);ctx.fillStyle='#415f63';ctx.fillRect(11,22-featureSpriteUnits(SPRITE_SCALE.doorHeightMetres,footprint),featureSpriteUnits(SPRITE_SCALE.doorWidthMetres,footprint),featureSpriteUnits(SPRITE_SCALE.doorHeightMetres,footprint));
    ellipse(ctx,14,27,7,2.5,'#e2d7b3');ctx.fillStyle='#739197';ctx.fillRect(10,25,8,2);ctx.fillStyle='#bd8d62';ctx.fillRect(13,24,3,2);
  } else if(/oil|refinery|chemical/.test(kind)) {
    [6,16,26].forEach((x,i)=>{ctx.fillStyle='#b7b7a3';ctx.fillRect(x-3,13+i*3,6,11-i*3);ellipse(ctx,x,13+i*3,3,3,'#dfddc2');ctx.fillStyle='#848f85';ctx.fillRect(x,16+i*2,1,6);});
    ctx.strokeStyle='#c7a75d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(3,25);ctx.lineTo(28,25);ctx.lineTo(28,16);ctx.stroke();ctx.fillStyle='#866f57';ctx.fillRect(20,3,3,17);ctx.fillStyle='#e0c069';ctx.fillRect(20,2,3,2);
  } else if(/power/.test(kind)) {
    ctx.fillStyle='#747f78';ctx.fillRect(2,18,27,9);ctx.fillStyle='#bcc2af';ctx.fillRect(4,17,22,5);
    polygon(ctx,[[6,23],[7,17],[7,10],[5,6],[15,6],[13,10],[13,17],[15,23]],'#bdc1b0');ellipse(ctx,10,6,5,2,'#87948d');ellipse(ctx,10,6,3,1,'#4c645f');
    polygon(ctx,[[17,25],[19,19],[19,12],[17,8],[27,8],[25,12],[25,19],[27,25]],'#d4d5be');ellipse(ctx,22,8,5,2,'#a2aca0');ellipse(ctx,22,8,3,1,'#526861');
  } else { // Workshop, mill, food plant, steel works, and goods factories.
    ctx.fillStyle='#5b6f6c';ctx.fillRect(3,13,26,13);ctx.fillStyle='#c4c4ac';ctx.fillRect(3,19,26,8);
    polygon(ctx,[[2,18],[7,10],[12,10],[12,18]],'#8d9b92');polygon(ctx,[[11,18],[16,10],[21,10],[21,18]],'#7c8f89');polygon(ctx,[[20,18],[25,10],[30,10],[30,18]],'#9caaa0');
    windowRow(ctx,5,21,6,'#b5d1c3',4,footprint);ctx.fillStyle='#496561';ctx.fillRect(16,27-featureSpriteUnits(SPRITE_SCALE.loadingBayHeightMetres,footprint),featureSpriteUnits(4,footprint),featureSpriteUnits(SPRITE_SCALE.loadingBayHeightMetres,footprint));
    ctx.fillStyle='#a68d70';ctx.fillRect(5,3,4,13);ctx.fillStyle='#705e4a';ctx.fillRect(4,3,6,2);ctx.fillStyle='#d0bb91';ctx.fillRect(5,8,4,2);
    ctx.fillStyle='#bb9954';ctx.fillRect(24,25,6,3);
  }
}
export function createSprites(biome,{pixelScale=2,detailLevel='town',cache:sharedCache=null,gardenGround='art'}={}) {
  // Every consumer, including detached previews, starts the generated artwork.
  // Revision checks replace temporary fallbacks as batches of images arrive; the
  // smallest densities make it usable, and each draw fetches the sharper one it needs.
  void preloadHouses({waitMs:0,biome,cells:startupArtCells(1)});
  void preloadWorldArt({waitMs:0,biome,cells:startupArtCells(1)});
  const density=Number.isFinite(pixelScale)&&pixelScale>0?pixelScale:2;
  const profile=['region','town','detail'].includes(detailLevel)?detailLevel:'town';
  // A renderer can share one byte budget across all exact zoom/DPR factories.
  // Detail/retina views need more backing pixels for the same woodland
  // variants. A fixed 16 MiB cache evicted visible trees before the next frame
  // could reuse them. Grow with display density, within a firm 64 MiB ceiling;
  // canvases are still allocated only when a view actually needs them.
  const cache=sharedCache||createSpriteCache({limit:16*1024*1024*Math.min(4,Math.max(1,density*density))}),prefix=`${biome}:${density}:${profile}:${gardenGround}:`;
  let assetRevision=houseAssetsRevision(),worldRevision=worldArtRevision(),created=0,hits=0;
  cache.syncRevision(`${assetRevision}:${worldRevision}`);
  const natureKinds=new Set(['forest','rock','mountain','terrain-detail']);
  const shopKinds=new Set(SHOP_KINDS);
  function sprite(kind,variant=0,level=INDUSTRIES[kind]?.footprint||1,detail='',footprint=undefined) {
    // Saved companies and external previews can still use the original names.
    // Resolve before caching so these share the exact current artwork identity.
    if(kind==='house'||kind==='apartment')kind=residentialKind(variant,level);
    else if(kind==='shop'||kind==='office')kind=commercialKind(variant,level);
    if(assetRevision!==houseAssetsRevision()||worldRevision!==worldArtRevision()){assetRevision=houseAssetsRevision();worldRevision=worldArtRevision();cache.syncRevision(`${assetRevision}:${worldRevision}`);}
    const house=kind.startsWith('house-'),shop=shopKinds.has(kind),variants=house?18:shop?15:natureKinds.has(kind)?64:12;
    variant=((Math.floor(variant)%variants)+variants)%variants;
    const houseRotation=house?variant%2:0,houseDesign=house?Math.floor(variant/6)%3:0;
    const shopDesign=shop?buildingArtworkDesign(variant):0;
    const span=Math.max(1,Math.min(Object.hasOwn(INDUSTRIES,kind)?5:['rock','mountain'].includes(kind)?6:3,Math.floor(Object.hasOwn(INDUSTRIES,kind)?level:footprint)||1));
    // An explicit footprint is a world site's saved extent. Omitted extents
    // retain the normalized thumbnail API while drawing the catalog parcel.
    const logicalFootprint=footprint===undefined?undefined:span;
    const physicalFootprint=logicalFootprint??BUILDINGS[kind]?.footprint??(kind==='factory'?WORKSHOP.footprint:span);
    const parcelKey=BUILDINGS[kind]||kind==='factory'?`:parcel-${physicalFootprint}`:'';
    // Share repeated seeds while retaining each house design and orientation.
    const authored=(BUILDINGS[kind]||kind==='factory')&&(hasRasterHouse(kind,biome,houseRotation,houseDesign,logicalFootprint)||hasRasterBuilding(kind,biome,shopDesign,logicalFootprint))||Object.hasOwn(INDUSTRIES,kind)&&hasRasterIndustry(kind,biome);
    const key=prefix+(authored?`${kind}:art:${span}${house?`:d${houseDesign}:r${houseRotation}`:shop?`:d${shopDesign}`:''}`:`${kind}:${variant}:${level}:${detail}:${span}`)+parcelKey,cached=cache.get(key);
    if(cached){hits++;return cached;}
    const natureObject=span>1&&['forest','rock','mountain'].includes(kind),layout=natureObject?natureObjectLayout(span):null;
    const forest=kind==='forest',width=layout?.width||(forest?48:TILE*span),height=layout?.height||(forest?48:TILE*span+8);
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*density));canvas.height=Math.max(1,Math.round(height*density));
    // Prepared pixels also supply alpha hit masks. Keep their raster backing
    // consistent: mixing accelerated and software preparation can choose
    // different high-quality filters for the same tiny fractional tree draw
    // after a zoom/climate change, before scenery batching even starts.
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.scale(canvas.width/width,canvas.height/height);if(!natureObject)ctx.translate(forest?8:0,forest?16:8);
    const r=rng(7331+variant*799+kind.length*371+level*97);
    if(natureObject){
      if(!drawRasterNatureObject(ctx,kind,biome,detail,variant,span,density)){
        ctx.save();ctx.translate(layout.anchorX-16*span,layout.anchorY-16*span);ctx.scale(span,span);
        if(forest)drawForest(ctx,biome,detail,variant,profile);else if(kind==='mountain')drawMountain(ctx,detail,r,biome,profile);else drawBoulder(ctx,16,22,12,r,biome,profile);
        ctx.restore();
      }
    }
    else if(BUILDINGS[kind]) {ctx.save();ctx.scale(span,span);if(!drawRasterHouse(ctx,kind,{pixelScale:density*span,biome,rotation:houseRotation,design:houseDesign,gardenGround,footprint:logicalFootprint})&&!drawRasterBuilding(ctx,kind,biome,density*span,{design:shopDesign,gardenGround,footprint:logicalFootprint})&&!drawTownFeature(ctx,kind,biome,profile,{gardenGround,footprint:logicalFootprint}))drawTownBuilding(ctx,kind,biome,profile,variant,{gardenGround,footprint:logicalFootprint});ctx.restore();}
    else if(Object.hasOwn(INDUSTRIES,kind)||kind==='factory'){
      const siteKind=kind==='factory'?(biome==='tundra'?'equipment-factory':biome==='desert'?'goods-factory':'furniture-factory'):kind;
      let cityArt=false;
      if(kind==='factory'){ctx.save();ctx.scale(span,span);cityArt=drawRasterBuilding(ctx,kind,biome,density*span,{gardenGround,footprint:logicalFootprint});ctx.restore();}
      if(!cityArt&&!drawRasterIndustry(ctx,siteKind,biome,density,{size:32*span,footprint:span,gardenGround})){ctx.save();ctx.scale(span,span);industry(ctx,siteKind,r,biome,profile,span,{gardenGround});ctx.restore();}
    }
    else if(drawRasterNature(ctx,kind,biome,detail,variant,density,{density:kind==='forest'?level:1})){}
    else if(kind==='terrain-detail') drawTerrainDetail(ctx,nativeNatureDetail(detail),r,biome,profile);
    else if(kind==='forest') drawForest(ctx,biome,detail,variant,profile);
    else if(kind==='tree'){if(!drawNativeHollowTree(ctx,detail,biome,variant,profile))conifer(ctx,16,25,14,r,biome,profile);}
    else if(kind==='rock') {
      const count=1+variant%5,stones=Array.from({length:count},(_,i)=>{
        const size=i===0?10+r()*6:2+r()*7,margin=size*.9+1;
        return {x:Math.max(margin,Math.min(32-margin,4+r()*24)),y:Math.max(size*.75,8+r()*19),size};
      }).sort((a,b)=>a.y-b.y);
      if(detail)drawTerrainDetail(ctx,detail,r,biome,profile);
      for(const stone of stones)boulder(ctx,stone.x,stone.y,stone.size,r,detail==='glacial'?'tundra':biome,profile);
    }
    else if(kind==='mountain') drawMountain(ctx,detail,r,biome,profile);
    else if(['house','apartment','shop','office','factory'].includes(kind)) building(ctx,kind,r,level,biome);
    else {ctx.save();ctx.scale(span,span);industry(ctx,kind,r,biome,profile,span,{gardenGround});ctx.restore();}
    cache.set(key,canvas);created++;return canvas;
  }
  sprite.getStats=()=>({...cache.getStats(),created,hits,shared:Boolean(sharedCache)});
  return sprite;
}
