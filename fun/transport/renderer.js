import { resolveBuildTool, quoteBuildPlan } from './construction-plan.js';
import { terraformProblem, networkEdgeAllowed } from './terrain-engineering.js';
import { isEngineeredTunnel, isUndergroundAt } from './structure-visibility.js';
import { TILE, PALETTES, createSprites, rng } from './sprites.js';
import { INDUSTRIES, BUILD_COSTS } from './data.js';
import { STATION_RADIUS, priceFor, hasClearableDecoration } from './model.js';
import { BUILDINGS, residentialKind, commercialKind } from './buildings.js';
import { ZOOM_VIEWS, nearestZoom, stepZoom } from './zoom.js';
import { cargoIcon } from './cargo-icons.js';
import { isPlantDetail } from './terrain-sprites.js';
import { DEFAULT_LAYERS, normalizeLayers } from './visibility.js';
import { createMarineSprites, drawShipWake, MARINE_SIZE } from './marine-sprites.js';
import { createLighting } from './lighting.js';
import { paintWaterRelief, drawWaterMotion } from './water-art.js';
import { houseAssetsRevision, getHouseAssetStats } from './raster-houses.js';
import { worldArtRevision, worldArtStats } from './atlas-runtime.js';
import { drawRasterVehicle, drawRasterInfrastructure, drawRasterNetwork, hasRasterTransport } from './raster-transport.js';
import { industrySize, industryTiles, industryContains, industryDistance, industrySiteProblem } from './industry-sites.js';
import { hasRasterIndustry } from './raster-industries.js';
import { terrainLevel, terrainElevation, terrainReliefRaster, terrainOverviewColor } from './terrain-elevation.js';
import { noise, hashNoise } from './world-noise.js';
import { shorelineContours, appendShoreline } from './shoreline.js';

const TAU=Math.PI*2;
const CHUNK_TILES=8, CHUNK_PIXELS=CHUNK_TILES*TILE, CHUNK_GUTTER=2;
const CACHE_BASE=48*1024*1024, CACHE_MAX=256*1024*1024;
const MINIMAP_EDGE=512;
const LANDMARKS=new Set(['forest','mountain','rock']);
const BAKED_LAYERS=new Set(['trees','buildings','roads','rails','stations','zones']);
const MINIMAP_LAYERS=new Set(['trees','buildings','roads','rails','stations','industryIcons','routes','zones']);
function roundRect(ctx,x,y,w,h,r=5){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function line(ctx,points,color,width=1){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function dot(ctx,x,y,r,color){ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fillStyle=color;ctx.fill();}
const titleCase=s=>String(s||'Industry').replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

export function createRenderer(canvas, initialGame, options={}) {
  let game=initialGame,ctx=canvas.getContext('2d'),W=1,H=1,dpr=1;
  let layers=normalizeLayers(options.layers||DEFAULT_LAYERS);
  const reliefCanvas=document.createElement('canvas'),reliefContext=reliefCanvas.getContext('2d');
  let camera={x:48*TILE,y:32*TILE,zoom:nearestZoom(options.zoom)};
  let palette=PALETTES[game.biome]||PALETTES.taiga,sprite,marine,rasterScale=0,detailLevel='',cacheLimit=CACHE_BASE;
  // The map can cover hundreds of thousands of tiles. Only visible, reusable
  // 8×8 chunks receive artwork at the current physical-pixel density. Small
  // chunks keep Detail's retina surfaces bounded; atlas terrain is capped at 512².
  const chunks=new Map(), minimapLayer=document.createElement('canvas'), codes=new Map(), cargoImages=new Map();
  const drawLighting=createLighting();
  let cachedRevision=-1, minimapRevision=-1, cachedBiome=game.biome, cachedSeed=game.seed, cachedHouseAssets=houseAssetsRevision(),cachedWorldAssets=worldArtRevision();
  let minimapPixels=null,minimapWords=null;
  let minimapNetworkGame=null,minimapNetworkRevision=-1,minimapNetwork=[],minimapNetworkScans=0,minimapTerrainSamples=0;
  let industryIndex=new Map(), stationIndex=new Map(), cacheBytes=0, composedChunks=0;
  let largestSurface=0, lastTime=0, vehicleIndicatorCounts={empty:0,partial:0,full:0};
  function code(value){if(!value)return 0;const key=String(value);if(codes.has(key))return codes.get(key);let h=0;for(let i=0;i<key.length;i++)h=(Math.imul(h,31)+key.charCodeAt(i))|0;codes.set(key,h);return h;}
  function clearChunks(){for(const entry of chunks.values()){entry.canvas.width=0;entry.canvas.height=0;}chunks.clear();cacheBytes=0;}
  function getLayers(){return {...layers};}
  function setLayers(partial={}){
    if(!partial||typeof partial!=='object')return getLayers();
    const next={...layers},changed=[];
    for(const key of Object.keys(DEFAULT_LAYERS))if(typeof partial[key]==='boolean'&&partial[key]!==layers[key]){next[key]=partial[key];changed.push(key);}
    if(!changed.length)return getLayers();
    layers=normalizeLayers(next);
    if(changed.some(key=>BAKED_LAYERS.has(key)))clearChunks();
    if(changed.some(key=>MINIMAP_LAYERS.has(key)))minimapRevision=-1;
    return getLayers();
  }
  function updateRaster(force=false){
    const scale=camera.zoom*dpr,detail=ZOOM_VIEWS.find(view=>view.zoom===camera.zoom).name.toLowerCase();
    if(force||rasterScale!==scale||detailLevel!==detail){rasterScale=scale;detailLevel=detail;sprite=createSprites(game.biome,{pixelScale:scale,detailLevel:detail});marine=createMarineSprites({pixelScale:scale,detailLevel:detail});}
  }
  function ensureRevision(){
    if(cachedHouseAssets!==houseAssetsRevision()||cachedWorldAssets!==worldArtRevision()){clearChunks();updateRaster(true);cachedHouseAssets=houseAssetsRevision();cachedWorldAssets=worldArtRevision();}
    if(cachedBiome!==game.biome||cachedSeed!==game.seed){clearChunks();palette=PALETTES[game.biome]||PALETTES.taiga;updateRaster(true);cachedBiome=game.biome;cachedSeed=game.seed;cachedRevision=-1;minimapRevision=-1;}
    if(cachedRevision===(game.revision||0))return;
    industryIndex=new Map((game.industries||[]).flatMap(item=>industryTiles(item).map(p=>[p.y*game.width+p.x,item])));
    stationIndex=new Map((game.stations||[]).map(item=>[item.y*game.width+item.x,item]));
    cachedRevision=game.revision||0;
  }
  const tile=(x,y)=> x<0||y<0||x>=game.width||y>=game.height?null:game.tiles[y*game.width+x];
  function portLandAngle(x,y){const shore=[[-1,0],[0,-1],[1,0],[0,1]].find(([dx,dy])=>tile(x+dx,y+dy)&&tile(x+dx,y+dy).terrain!=='water')||[-1,0];return Math.atan2(shore[1],shore[0]);}
  const worldToScreen=(x,y)=>({x:(x*TILE+TILE/2-camera.x)*camera.zoom+W/2,y:(y*TILE+TILE/2-camera.y)*camera.zoom+H/2});
  function resize(){const rect=canvas.getBoundingClientRect();W=Math.max(1,rect.width);H=Math.max(1,rect.height);dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.imageSmoothingEnabled=false;updateRaster();bounds();}
  function bounds(){
    const halfW=W/(2*camera.zoom),halfH=H/(2*camera.zoom);
    camera.x=Math.max(Math.min(halfW,game.width*TILE/2),Math.min(game.width*TILE-Math.min(halfW,game.width*TILE/2),camera.x));
    camera.y=Math.max(Math.min(halfH,game.height*TILE/2),Math.min(game.height*TILE-Math.min(halfH,game.height*TILE/2),camera.y));
    // Snap the actual world origin, so both rendering and tile picking use the
    // same camera and a cached texel always lands on one physical display pixel.
    camera.x=(W/2-Math.round((W/2-camera.x*camera.zoom)*dpr)/dpr)/camera.zoom;
    camera.y=(H/2-Math.round((H/2-camera.y*camera.zoom)*dpr)/dpr)/camera.zoom;
  }
  function focus(x,y){camera.x=(x+.5)*TILE;camera.y=(y+.5)*TILE;bounds();}
  function pan(dx,dy){camera.x-=dx/camera.zoom;camera.y-=dy/camera.zoom;bounds();}
  function setZoom(value,clientX,clientY){
    const next=nearestZoom(value);if(next===camera.zoom)return;
    const rect=canvas.getBoundingClientRect(),sx=(clientX===undefined?W/2:clientX-rect.left)-W/2,sy=(clientY===undefined?H/2:clientY-rect.top)-H/2,old=camera.zoom;
    camera.zoom=next;camera.x+=sx/old-sx/next;camera.y+=sy/old-sy/next;bounds();updateRaster();
  }
  function zoomAt(factor,clientX,clientY){if(!Number.isFinite(factor)||factor<=0||factor===1)return;setZoom(stepZoom(camera.zoom,Math.sign(factor-1)),clientX,clientY);}
  function screenToTile(clientX,clientY){const rect=canvas.getBoundingClientRect();return{x:Math.floor(((clientX-rect.left-W/2)/camera.zoom+camera.x)/TILE),y:Math.floor(((clientY-rect.top-H/2)/camera.zoom+camera.y)/TILE)};}
  function industryMarker(industry){
    const span=industrySize(industry),p=worldToScreen(industry.x+(span-1)/2,industry.y+span-1),size=detailLevel==='detail'?28:24;
    return {x:p.x,y:p.y+16*camera.zoom+5+(size+6)/2,size};
  }
  function screenToInspectTile(clientX,clientY){
    const rect=canvas.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top;
    // Resource badges are drawn beyond their tile; inspecting one should open
    // its industry while construction continues to target the exact grid tile.
    for(let i=layers.industryIcons?(game.industries||[]).length-1:-1;i>=0;i--){
      const industry=game.industries[i];if(!visible(industry.x,industry.y))continue;
      const marker=industryMarker(industry);
      if(Math.abs(x-marker.x)<=(marker.size+8)/2&&Math.abs(y-marker.y)<=(marker.size+6)/2)return {x:industry.x,y:industry.y};
    }
    const picked=screenToTile(clientX,clientY),industry=industryIndex.get(picked.y*game.width+picked.x);return industry?{x:industry.x,y:industry.y}:picked;
  }
  function setGame(next){game=next;clearChunks();palette=PALETTES[game.biome]||PALETTES.taiga;updateRaster(true);cachedBiome=game.biome;cachedSeed=game.seed;cachedRevision=-1;minimapRevision=-1;const first=game.cities?.[0];if(first)focus(first.x+9,first.y);else bounds();}
  function natureVariant(x,y,t) {
    let h=(game.seed||0)^Math.imul(x+1,374761393)^Math.imul(y+1,668265263)^Math.imul((t.variant||0)+1,1274126177);
    h=Math.imul(h^(h>>>13),1274126177);return (h^(h>>>16))>>>26;
  }
  function natureDensity(x,y,t) {
    const seed=game.seed||0;
    if(t.terrain==='forest'){
      let neighbors=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&tile(x+dx,y+dy)?.terrain==='forest')neighbors++;
      const patch=noise(x,y,seed+2179,7.3)*.7+noise(x,y,seed+2203,19)*.3;
      // Woodland interiors form canopy, softer edges and broad open glades.
      if(neighbors<=3||patch<.3)return 1;
      return neighbors>=6&&patch>.42?3:2;
    }
    let rocky=0,min=terrainElevation(t),max=min;
    for(const [dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){
      const n=tile(x+dx,y+dy);if(!n)continue;
      if(n.terrain==='mountain'||n.terrain==='rock')rocky++;
      const height=terrainElevation(n);min=Math.min(min,height);max=Math.max(max,height);
    }
    const patch=noise(x,y,seed+2221,6.3),mountain=t.terrain==='mountain';
    let chance=(mountain?.045:.08)+patch*patch*(mountain?.32:.48)+Math.min(.1,(max-min)*.05);
    chance*=.55+rocky*.1125;
    if(patch<.36)chance*=.18;else if(patch>.7)chance*=1.5;
    return hashNoise(x,y,seed+2267)<chance?1:0;
  }
  function chunkBounds(cx,cy){return{x0:Math.max(0,cx*CHUNK_TILES-2),y0:Math.max(0,cy*CHUNK_TILES-2),x1:Math.min(game.width,(cx+1)*CHUNK_TILES+2),y1:Math.min(game.height,(cy+1)*CHUNK_TILES+2)};}
  function fingerprint(b){
    let hash=2166136261;
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y),id=y*game.width+x,ind=industryIndex.get(id),st=stationIndex.get(id);
      const flags=(t.road?1:0)|(t.rail?2:0)|(t.bridge?4:0)|(t.tunnel?8:0);
      hash=Math.imul(hash^code(t.terrain),16777619);hash=Math.imul(hash^code(t.detail),16777619);
      hash=Math.imul(hash^Math.round(terrainElevation(t)*65536)^((t.structureLevel||0)<<8)^code(t.structureAxis),16777619);
      hash=Math.imul(hash^(t.variant||0)^flags,16777619);hash=Math.imul(hash^code(t.zone),16777619);
      hash=Math.imul(hash^code(t.building?.kind)^((t.building?.level||0)<<12),16777619);
      hash=Math.imul(hash^code(ind?.kind)^((ind?.footprint||1)<<10)^code(st?.mode),16777619);
    }
    return hash;
  }
  function drawGround(c,b){
    const relief=terrainReliefRaster(game,b);
    if(reliefCanvas.width!==relief.width||reliefCanvas.height!==relief.height){reliefCanvas.width=relief.width;reliefCanvas.height=relief.height;}
    reliefContext.putImageData(new ImageData(relief.pixels,relief.width,relief.height),0,0);
    c.save();c.imageSmoothingEnabled=true;c.imageSmoothingQuality='low';
    c.drawImage(reliefCanvas,b.x0*TILE,b.y0*TILE,(b.x1-b.x0)*TILE,(b.y1-b.y0)*TILE);c.restore();
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y),px=x*TILE,py=y*TILE,r=rng((game.seed||1847)+x*17651+y*2671);if(t.terrain==='water')continue;
      if(t.terrain==='sand'){
        for(let j=0;j<3;j++){const xx=px+r()*25,yy=py+r()*32;if(detailLevel==='region'&&j>0)continue;c.strokeStyle='#f0dda325';c.lineWidth=.7;c.beginPath();c.ellipse(xx,yy,9,2,0,Math.PI,TAU);c.stroke();}
      }
      if(t.terrain==='snow'||t.detail==='marsh'||t.detail==='glacial'||t.detail==='saltflat'){
        const color=t.detail==='marsh'?'#657d6a':t.detail==='saltflat'?'#eeead3':t.terrain==='mountain'?palette.mountain:'#e5ead8',wash=c.createRadialGradient(px+16,py+16,2,px+16,py+16,27);wash.addColorStop(0,color+'14');wash.addColorStop(1,color+'00');c.fillStyle=wash;c.fillRect(px-11,py-11,54,54);
      }
      for(let n=0;n<8;n++){const xx=px+r()*31,yy=py+r()*31,w=.7+r()*1.5,h=.5+r();if(detailLevel==='region'&&n%4!==0)continue;c.fillStyle=n%3===0?palette.speck+'28':palette.dark+'18';c.fillRect(xx,yy,w,h);}
      if(layers.trees&&r()>.97&&detailLevel!=='region'&&!t.building&&!t.road&&!t.rail&&t.terrain==='grass'){for(let n=0;n<3;n++)dot(c,px+10+r()*8,py+10+r()*8,.7,game.biome==='tundra'?'#e7dfb2':'#e9cf92');}
    }
    // World-anchored contour smoothing softens staircase coasts while keeping
    // every water and land tile center on its original side of the shoreline.
    const waterPath=new Path2D();
    appendShoreline(waterPath,shorelineContours(game,b,TILE));
    // A narrow damp edge grounds the water; sandbars are local patches, never a
    // uniform pale ribbon running around every lake and river.
    c.lineJoin='round';c.strokeStyle=palette.dark+'40';c.lineWidth=2.5;c.stroke(waterPath);
    c.fillStyle=palette.deep;c.fill(waterPath,'evenodd');c.save();c.clip(waterPath,'evenodd');
    paintWaterRelief(c,b,tile,game.biome,game.seed||0,detailLevel,layers);
    c.restore();
    if(!layers.trees)return;
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y);if(detailLevel==='region'||t.terrain==='water'||t.building||t.road||t.rail)continue;
      const r=rng(x*3461+y*3727);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(tile(x+dx,y+dy)?.terrain==='water'&&r()>(t.terrain==='forest'||['marsh','reeds','oasis'].includes(t.detail)?.6:.94)){for(let j=0;j<3;j++){const px=(x+.5)*TILE+dx*14+(dy?r()*12-6:0),py=(y+.5)*TILE+dy*14+(dx?r()*12-6:0);line(c,[[px,py],[px-1,py-3-r()*2]],'#71886b',1);}}
    }
  }
  function tunnelPortal(c,x,y,t,mode,arms){
    // A buried alignment contributes no visible track between its mouths.
    // Each mouth faces an exposed approach on the engineering axis.
    const cx=(x+.5)*TILE,cy=(y+.5)*TILE;
    for(const [dx,dy]of arms){
      const adjacent=tile(x+dx,y+dy);if(!adjacent?.[mode]||isEngineeredTunnel(adjacent))continue;
      const angle=Math.atan2(dy,dx),mouthX=cx+dx*6,mouthY=cy+dy*6;
      line(c,[[mouthX,mouthY],[cx+dx*16,cy+dy*16]],mode==='road'?'#b5a587':'#b6b698',mode==='road'?18:11);
      line(c,[[mouthX,mouthY],[cx+dx*16,cy+dy*16]],mode==='road'?'#696963':'#79775f',mode==='road'?12:7);
      if(mode==='rail')for(const o of [-2.4,2.4])line(c,[[mouthX+dy*o,mouthY-dx*o],[cx+dx*16+dy*o,cy+dy*16-dx*o]],'#d4d7c6',1.1);
      c.save();c.translate(mouthX,mouthY);c.rotate(angle-Math.PI/2);
      if(!drawRasterInfrastructure(c,mode+'-tunnel',-16,-20,32,32,rasterScale)){
        c.fillStyle='#8d927d';roundRect(c,-11,-8,22,15,7);c.fill();
        c.fillStyle='#d0ceb0';roundRect(c,-9,-7,18,14,6);c.fill();
        c.fillStyle='#26362c';roundRect(c,-6,-3,12,11,4);c.fill();
      }
      c.restore();
    }
  }
  function network(c,x,y,t,mode){
    if(!t[mode])return;const px=x*TILE,py=y*TILE,cx=px+16,cy=py+16;
    const neighbors=[[0,-1],[1,0],[0,1],[-1,0]].filter(([dx,dy])=>{
      const adjacent=tile(x+dx,y+dy);if(!adjacent?.[mode])return false;
      return networkEdgeAllowed(t,adjacent,dx,dy,mode);
    });
    const arms=neighbors.length?neighbors:t.structureAxis==='x'?[[-1,0],[1,0]]:[[0,-.48],[0,.48]];
    if(isEngineeredTunnel(t)){tunnelPortal(c,x,y,t,mode,arms);return;}
    const bridge=t.terrain==='water'||t.bridge;const tunnel=!bridge&&(t.terrain==='mountain'||t.tunnel);
    const textured=!tunnel&&hasRasterTransport('infra:'+mode+(bridge?'-bridge':''));
    const points=arms.map(([dx,dy])=>[cx+dx*16,cy+dy*16]);
    c.lineCap='butt';c.lineJoin='round';
    const stroke=(color,width)=>{for(const p of points)line(c,[[cx,cy],p],color,width);dot(c,cx,cy,width/2,color);};
    if(bridge){
      const clearance=t.structureLevel?Math.max(1,t.structureLevel-terrainLevel(t)):1,drop=Math.min(18,4+clearance*2);
      c.save();c.translate(3+drop*.3,drop);stroke('#203c4840',18);c.restore();
      if(t.structureLevel){
        // Visible southeast faces give land viaducts the same sense of height
        // as water crossings; the deck itself stays aligned with the route.
        c.fillStyle='#4d574a80';c.beginPath();c.moveTo(cx-4,cy+5);c.lineTo(cx+3,cy+5);c.lineTo(cx+3+drop*.3,cy+5+drop);c.lineTo(cx-4+drop*.3,cy+5+drop);c.closePath();c.fill();
        line(c,[[cx-4,cy+5],[cx-4+drop*.3,cy+5+drop]],'#c4bea0',2.5);
        line(c,[[cx-5+drop*.3,cy+5+drop],[cx+5+drop*.3,cy+5+drop]],'#626b5680',3);
      }
      stroke('#b7b4a0',17);stroke('#737f73',15);
    }
    else stroke(mode==='road'?'#b5a587':textured?'#796f5c':'#b6b698',mode==='road'?18:10);
    if(mode==='road'){
      stroke('#676762',12);stroke('#6c6b67',10);c.lineCap='butt';
      if(!textured&&detailLevel!=='region')for(const p of points){c.setLineDash([3,4]);line(c,[[cx,cy],p],'#d3cfa773',.75);c.setLineDash([]);}
      if(bridge)for(const [dx,dy]of arms){const ox=dy*7,oy=-dx*7;line(c,[[cx+ox,cy+oy],[cx+dx*16+ox,cy+dy*16+oy]],'#dfd9bd',1);line(c,[[cx-ox,cy-oy],[cx+dx*16-ox,cy+dy*16-oy]],'#d6d2b5',1);}
    }else{
      stroke('#666f615c',9);
      if(!textured)for(const [dx,dy]of arms){for(let p=2;p<17;p+=detailLevel==='region'?8:4){const ax=cx+dx*p,ay=cy+dy*p;line(c,[[ax+dy*4,ay-dx*4],[ax-dy*4,ay+dx*4]],'#796c56',2);}
        for(const o of [-2.4,2.4])line(c,[[cx+dy*o,cy-dx*o],[cx+dx*16+dy*o,cy+dy*16-dx*o]],'#d4d7c6',1.1);
      }
    }
    if(!tunnel)drawRasterNetwork(c,mode+(bridge?'-bridge':''),cx,cy,arms,rasterScale);
    if(tunnel){const exit=arms.find(([dx,dy])=>{const adjacent=tile(x+dx,y+dy);return adjacent&&adjacent.terrain!=='mountain'&&!adjacent.tunnel;});
      if(exit){c.save();c.translate(cx,cy);c.rotate(Math.atan2(exit[1],exit[0])-Math.PI/2);const painted=drawRasterInfrastructure(c,mode+'-tunnel',-16,-19,32,36,rasterScale);c.restore();if(painted)return;}
      else return;
    }
    if(tunnel){const dir=arms[0];c.save();c.translate(cx,cy);c.rotate(Math.atan2(dir[1],dir[0]));c.fillStyle='#7c8476';c.fillRect(-6,-9,5,18);c.fillStyle='#d0d0b5';c.fillRect(-6,-8,3,16);c.fillStyle='#3e4d44';c.fillRect(-4,-5,3,10);c.restore();}
  }
  function drawChunk(cx,cy,scale){
    const key=`${cx},${cy},${scale},${detailLevel}`,b=chunkBounds(cx,cy);let entry=chunks.get(key);
    if(entry){
      chunks.delete(key);chunks.set(key,entry);
      if(entry.revision===cachedRevision)return entry;
      const signature=fingerprint(b);entry.revision=cachedRevision;if(entry.signature===signature)return entry;
      entry.signature=signature;
    }else{
      // Align each chunk's source origin too, including fractional display DPRs.
      const left=Math.floor((cx*CHUNK_PIXELS-CHUNK_GUTTER)*scale),top=Math.floor((cy*CHUNK_PIXELS-CHUNK_GUTTER)*scale);
      const surface=document.createElement('canvas');surface.width=Math.ceil(((cx+1)*CHUNK_PIXELS+CHUNK_GUTTER)*scale)-left;surface.height=Math.ceil(((cy+1)*CHUNK_PIXELS+CHUNK_GUTTER)*scale)-top;
      const bytes=surface.width*surface.height*4;
      while(cacheBytes+bytes>cacheLimit&&chunks.size){const oldest=chunks.keys().next().value,item=chunks.get(oldest);cacheBytes-=item.bytes;item.canvas.width=0;item.canvas.height=0;chunks.delete(oldest);}
      entry={canvas:surface,bytes,x:left/scale,y:top/scale,revision:cachedRevision,signature:fingerprint(b)};chunks.set(key,entry);cacheBytes+=bytes;largestSurface=Math.max(largestSurface,surface.width,surface.height);
    }
    const c=entry.canvas.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,entry.canvas.width,entry.canvas.height);c.scale(scale,scale);c.translate(-entry.x,-entry.y);c.imageSmoothingEnabled=false;
    drawGround(c,b);
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y);
      const variant=natureVariant(x,y,t),sparseDetail=['snow','glacial','dunes','ice','saltflat'].includes(t.detail)?variant%5===0:variant%4!==0;
      if(t.detail&&sparseDetail&&(layers.trees||!isPlantDetail(t.detail))&&!LANDMARKS.has(t.terrain)&&t.terrain!=='water'&&(!t.building||!layers.buildings)&&(!t.road||!layers.roads||isEngineeredTunnel(t))&&(!t.rail||!layers.rails||isEngineeredTunnel(t))&&(!t.zone||!layers.zones)&&(!industryIndex.has(y*game.width+x)||!layers.buildings)){c.save();c.globalAlpha=.48;c.drawImage(sprite('terrain-detail',variant,1,t.detail),x*TILE,y*TILE-8,32,40);c.restore();}
      if(layers.zones&&t.zone&&(!t.building||!layers.buildings)){const color=t.zone==='residential'?'#e6e9b5':t.zone==='commercial'?'#c0d9db':'#e3c795';c.fillStyle=color+'45';c.fillRect(x*TILE+2,y*TILE+2,28,28);c.strokeStyle=color+'b0';c.lineWidth=.7;c.setLineDash([3,3]);c.strokeRect(x*TILE+3,y*TILE+3,26,26);c.setLineDash([]);}
      if(layers.roads)network(c,x,y,t,'road');if(layers.rails)network(c,x,y,t,'rail');
    }
    // Draw objects in row order; padded chunks also include overhanging tree crowns.
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y),id=y*game.width+x,ind=industryIndex.get(id),st=stationIndex.get(id);
      if(LANDMARKS.has(t.terrain)&&(t.terrain!=='forest'||layers.trees)&&(!t.building||!layers.buildings)&&(!t.road||!layers.roads||isEngineeredTunnel(t))&&(!t.rail||!layers.rails||isEngineeredTunnel(t))&&(!t.zone||!layers.zones)&&(!ind||!layers.buildings)){
        const forest=t.terrain==='forest',variant=natureVariant(x,y,t),density=natureDensity(x,y,t);
        // Relief describes the landform. A few subdued outcrops describe its
        // material, instead of repeating a mountain icon on every high tile.
        if(density){
          c.save();c.globalAlpha=forest?.94:1;
          c.drawImage(sprite(t.terrain,variant,density,!layers.trees&&t.detail==='wooded-foothill'?'bare-foothill':t.detail),x*TILE-(forest?8:0),y*TILE-(forest?16:8),forest?48:32,forest?48:40);c.restore();
        }
      }
      if(layers.buildings&&t.building){const variant=t.variant??x*13+y,level=t.building.level||1,legacy=t.building.kind,kind=['house','apartment'].includes(legacy)?residentialKind(variant,level):['shop','office'].includes(legacy)?commercialKind(variant,level):legacy;c.drawImage(sprite(kind,variant,level),x*TILE,y*TILE-8,32,40);}
      if(layers.buildings&&ind&&ind.x===x&&ind.y===y){const span=industrySize(ind);c.drawImage(sprite(ind.kind,x+y,span),x*TILE,y*TILE-8,32*span,32*span+8);}
      if(layers.stations&&st){if(st.mode==='water'){c.drawImage(marine.port(portLandAngle(x,y)),(x+.5)*TILE-MARINE_SIZE/2,(y+.5)*TILE-MARINE_SIZE/2,MARINE_SIZE,MARINE_SIZE);}else if(!drawRasterInfrastructure(c,st.mode==='rail'?'train-stop':'bus-stop',x*TILE+17,y*TILE+1,17,29,rasterScale)){const px=x*TILE,py=y*TILE;c.fillStyle='#294d435c';c.fillRect(px+22,py+5,8,21);c.fillStyle='#d8d6b7';c.fillRect(px+22,py+3,6,22);c.fillStyle='#8c9c83';c.fillRect(px+23,py+5,4,12);c.fillStyle='#f1e0b8';c.fillRect(px+24,py+5,2,11);c.fillStyle='#526c5b';c.fillRect(px+22,py+3,7,3);c.fillStyle='#374d42';c.fillRect(px+25,py+22,1,6);c.fillStyle=st.mode==='rail'?'#bc8260':'#ceaa5b';c.fillRect(px+23,py+20,5,4);}}
    }
    composedChunks++;return entry;
  }
  function drawWorld(x0,y0,x1,y1){
    // Keep a whole visible frame resident instead of reducing raster quality.
    // Budget grows with the viewport, bounded even on a huge map. At 4K/DPR2
    // Detail this includes its border chunks without repeatedly evicting them.
    const across=Math.ceil(x1/CHUNK_TILES)-Math.floor(x0/CHUNK_TILES),down=Math.ceil(y1/CHUNK_TILES)-Math.floor(y0/CHUNK_TILES);
    const frameBytes=across*down*(Math.ceil((CHUNK_PIXELS+CHUNK_GUTTER*2)*rasterScale)+1)**2*4;
    cacheLimit=Math.min(CACHE_MAX,Math.max(CACHE_BASE,Math.ceil(frameBytes*1.1)));
    while(cacheBytes>cacheLimit&&chunks.size){const oldest=chunks.keys().next().value,item=chunks.get(oldest);cacheBytes-=item.bytes;item.canvas.width=0;item.canvas.height=0;chunks.delete(oldest);}
    ctx.imageSmoothingEnabled=false;
    for(let cy=Math.floor(y0/CHUNK_TILES);cy<Math.ceil(y1/CHUNK_TILES);cy++)for(let cx=Math.floor(x0/CHUNK_TILES);cx<Math.ceil(x1/CHUNK_TILES);cx++){const entry=drawChunk(cx,cy,rasterScale);ctx.drawImage(entry.canvas,entry.x,entry.y,entry.canvas.width/rasterScale,entry.canvas.height/rasterScale);}
  }
  function visible(x,y,margin=70){const p=worldToScreen(x,y);return p.x>-margin&&p.y>-margin&&p.x<W+margin&&p.y<H+margin;}
  function vehicle(v,route){
    if(!visible(v.x,v.y))return;const train=route?.mode==='rail';const color=route?.color||'#c78753';
    if(route?.mode==='water'){drawShipWake(ctx,v,lastTime,detailLevel);ctx.drawImage(marine.ship(v,route),(v.x+.5)*TILE-MARINE_SIZE/2,(v.y+.5)*TILE-MARINE_SIZE/2,MARINE_SIZE,MARINE_SIZE);return;}
    function car(x,y,angle,engine){if(isUndergroundAt(game,x,y))return;ctx.save();ctx.translate((x+.5)*TILE,(y+.5)*TILE);ctx.rotate(angle);if(drawRasterVehicle(ctx,v,route,{engine,pixelScale:rasterScale,heading:angle})){ctx.restore();return;}if(detailLevel==='region'){ctx.fillStyle='#293e36';roundRect(ctx,-8,-4.5,16,9,2);ctx.fill();ctx.fillStyle=color;ctx.fillRect(-7,-3.5,14,7);ctx.fillStyle='#f1ddb5';ctx.fillRect(-6,-2.5,9,5);ctx.fillStyle='#3d6269';ctx.fillRect(4,-2.5,2,5);if(train&&engine){ctx.fillStyle='#526361';ctx.fillRect(-2,-2,4,4);}ctx.restore();return;}ctx.fillStyle='#233e3a40';roundRect(ctx,-4,-1,12,6,1.5);ctx.fill();ctx.fillStyle='#343d37';ctx.fillRect(-5,-4,3,1.5);ctx.fillRect(3,-4,3,1.5);ctx.fillRect(-5,2.5,3,1.5);ctx.fillRect(3,2.5,3,1.5);ctx.fillStyle=color;roundRect(ctx,-7,-3.5,14,7,1.5);ctx.fill();ctx.fillStyle='#ead8ad';ctx.fillRect(-6,-2.5,10,5);ctx.fillStyle='#536e71';ctx.fillRect(4,-2.3,2,4.6);ctx.fillStyle='#829b99';ctx.fillRect(-4,-2.5,6,1);ctx.fillRect(-4,1.5,6,1);ctx.fillStyle='#ddd3ac';ctx.fillRect(6,-2,1,1);ctx.fillRect(6,1,1,1);if(train&&engine){ctx.fillStyle='#526361';ctx.fillRect(-2,-2,4,4);ctx.fillStyle='#adbead';ctx.fillRect(-1,-1,2,2);}ctx.restore();}
    if(train&&route.path?.length>1){
      const path=route.path,max=path.length-1,direction=v.direction||1;
      for(const offset of [34/TILE,17/TILE]){const position=Math.max(0,Math.min(max,(v.progress||0)-offset*direction));const index=Math.min(Math.floor(position),max-1),f=position-index,a=path[index],b=path[index+1];car(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f,Math.atan2((b.y-a.y)*direction,(b.x-a.x)*direction),false);}
    }
    car(v.x,v.y,Number.isFinite(v.angle)?v.angle:0,train);
  }
  function validPreview(tool,p,preferredMode='road'){
    tool=resolveBuildTool(game,tool,p.x,p.y,{preferredMode});
    const t=tile(p.x,p.y);if(!t)return false;if(tool==='inspect')return true;
    if(tool==='raise'||tool==='lower')return game.money>=priceFor(game,BUILD_COSTS[tool]||0)&&!terraformProblem(game,tool,p.x,p.y);
    const station=(game.stations||[]).find(s=>s.x===p.x&&s.y===p.y),industry=(game.industries||[]).find(s=>industryContains(s,p.x,p.y)),city=(game.cities||[]).find(s=>s.x===p.x&&s.y===p.y);
    if(INDUSTRIES[tool])return game.money>=priceFor(game,BUILD_COSTS[tool])&&!industrySiteProblem(game,tool,p.x,p.y);
    if(tool==='bulldoze')return game.money>=priceFor(game,BUILD_COSTS.bulldoze)&&!city&&!(station&&(game.routes||[]).some(r=>r.stops.includes(station.id)))&&Boolean(station||industry||t.building||t.zone||t.road||t.rail||['forest','rock'].includes(t.terrain)||hasClearableDecoration(t));
    if(['road','rail','bridge','railbridge','tunnel','railtunnel'].includes(tool)){
      const mode=tool.startsWith('rail')?'rail':'road',bridge=tool==='bridge'||tool==='railbridge',tunnel=tool==='tunnel'||tool==='railtunnel';
      if(t.structureAxis&&!t[mode])return false;
      if(t[mode]&&(!bridge||t.bridge)&&(!tunnel||t.tunnel))return true;
      return game.money>=priceFor(game,BUILD_COSTS[tool]+(t.terrain==='forest'?80:t.terrain==='rock'&&!tunnel?100:0))&&!industry&&!t.building&&!t.zone&&(!station||station.mode===mode)&&!(t.terrain==='water'&&!bridge&&!t.bridge)&&!(t.terrain==='mountain'&&!tunnel&&!t.tunnel)&&(!bridge||t.terrain==='water')&&(!tunnel||['mountain','rock'].includes(t.terrain));
    }
    if(priceFor(game,BUILD_COSTS[tool]||0)>game.money)return false;
    if(tool==='port')return t.terrain==='water'&&!station&&!industry&&!city&&!t.building&&!t.zone&&!t.road&&!t.rail&&!t.bridge&&!t.tunnel&&[[-1,0],[0,-1],[1,0],[0,1]].some(([dx,dy])=>tile(p.x+dx,p.y+dy)&&tile(p.x+dx,p.y+dy).terrain!=='water');
    if(tool==='bus-stop'||tool==='train-stop'){const mode=tool==='bus-stop'?'road':'rail';return !station&&!industry&&!t.building&&!t.zone&&t[mode]&&!t.bridge&&!t.tunnel;}
    if(station||industry||city||t.building||t.zone||t.road||t.rail||t.terrain==='water')return false;
    if(tool==='city')return !['mountain','rock'].includes(t.terrain)&&!(game.cities||[]).some(c=>Math.hypot(c.x-p.x,c.y-p.y)<11);
    if(BUILDINGS[tool])return t.terrain!=='mountain';
    const def=INDUSTRIES[tool];if(!def)return t.terrain!=='mountain';
    return def.biomes.includes(game.biome)&&(!def.terrain||def.terrain.includes(t.terrain))&&(t.terrain!=='mountain'||def.terrain?.includes('mountain'))&&(!def.coastal||[[0,1],[0,-1],[1,0],[-1,0]].some(([dx,dy])=>tile(p.x+dx,p.y+dy)?.terrain==='water'));
  }
  function pill(x,y,label,opts={}){
    const size=opts.size||11;ctx.font=`${opts.bold?600:500} ${size}px Space, system-ui, sans-serif`;
    const w=ctx.measureText(label).width+(opts.dot?25:16),h=opts.h||23;
    ctx.shadowColor='#293d2620';ctx.shadowBlur=8;ctx.shadowOffsetY=2;
    ctx.fillStyle=opts.fill||'#f5f3e8ee';roundRect(ctx,x-w/2,y-h/2,w,h,opts.radius||5);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.strokeStyle=opts.stroke||'#f8f6e8b0';ctx.lineWidth=.7;ctx.stroke();ctx.fillStyle=opts.color||'#354b3e';ctx.textAlign='left';ctx.textBaseline='middle';let tx=x-w/2+8;if(opts.dot){dot(ctx,tx+2,y,2.5,opts.dot);tx+=10;}ctx.fillText(label,tx,y+.3);return w;
  }
  function cargoImage(kind,size){
    const pixels=Math.ceil(size*dpr),key=`${kind}:${pixels}`;let image=cargoImages.get(key);
    if(!image){image=new Image();image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(cargoIcon(kind,{decorative:true}).replace('width="32" height="32"',`width="${pixels}" height="${pixels}"`))}`;cargoImages.set(key,image);}
    return image;
  }
  function vehicleLoadIndicator(v,route){
    if(!route||!visible(v.x,v.y,40)||(route.mode!=='water'&&isUndergroundAt(game,v.x,v.y)))return;
    const p=worldToScreen(v.x,v.y),fraction=Math.max(0,Math.min(1,(v.load||0)/Math.max(1,v.capacity||1)));
    const state=fraction<=.00001?'empty':fraction>=.99999?'full':'partial';vehicleIndicatorCounts[state]++;
    const size=detailLevel==='detail'?22:18,w=state==='empty'?24:size+8,h=state==='empty'?11:size+13;
    const x=Math.round(p.x-w/2),y=Math.round(p.y-(route.mode==='water'?22:10)*camera.zoom-h-5);
    // Badges use display pixels so a load remains legible at every map scale.
    // An empty carrier has only an unfilled meter; loaded carriers show cargo.
    line(ctx,[[p.x,y+h],[p.x,p.y-(route.mode==='water'?18:6)*camera.zoom]],'#475b455b',1);
    ctx.fillStyle=state==='empty'?'#f5f2e2de':'#faf6e7f5';roundRect(ctx,x,y,w,h,5);ctx.fill();
    ctx.strokeStyle=state==='full'?'#567b4c':state==='empty'?'#8e9c8580':'#b18c4c';ctx.lineWidth=1;ctx.stroke();
    if(state!=='empty'){
      const image=cargoImage(route.cargo||'passengers',size);
      if(image.complete&&image.naturalWidth)ctx.drawImage(image,x+(w-size)/2,y+3,size,size);
      else dot(ctx,x+w/2,y+3+size/2,3,'#849367');
    }
    const meterX=x+4,meterY=y+h-7,meterW=w-8;
    ctx.fillStyle='#d4d9c8';roundRect(ctx,meterX,meterY,meterW,3,1);ctx.fill();
    if(fraction>0){ctx.fillStyle=state==='full'?'#4e7747':'#bd8e43';roundRect(ctx,meterX,meterY,Math.max(1,meterW*fraction),3,1);ctx.fill();}
  }
  function resourceMarker(x,y,kind,size,label){
    // Screen-space markers stay legible in Region and render at native display
    // density. SVG images are local data, cached separately from terrain chunks.
    const image=cargoImage(kind,size);
    const h=size+6,w=size+8;
    ctx.shadowColor='#293d2630';ctx.shadowBlur=5;ctx.shadowOffsetY=2;
    ctx.fillStyle='#f7f4e7f5';roundRect(ctx,x-w/2,y-h/2,w,h,7);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.strokeStyle='#fbfaedf0';ctx.lineWidth=1;ctx.stroke();
    if(image.complete&&image.naturalWidth)ctx.drawImage(image,x-size/2,y-size/2,size,size);else dot(ctx,x,y,4,'#849367');
    if(label){
      ctx.font='500 12px Space, system-ui, sans-serif';const nameWidth=ctx.measureText(label).width+16;
      const right=x+w/2+4+nameWidth/2,left=x-w/2-4-nameWidth/2;
      pill(right+nameWidth/2>W-8?left:right,y,label,{size:12,h:28,fill:'#f7f4e7f5',color:'#3e5547',radius:5});
    }
  }
  function render(now,view={}){
    lastTime=now||0;const {tool='inspect',hover=null,preview=[],selected=null,routeStops=[],preferredMode='road'}=view;
    const showGrid=typeof view.showGrid==='boolean'?view.showGrid:layers.grid,showRoutes=typeof view.showRoutes==='boolean'?view.showRoutes:layers.routes;
    ensureRevision();const routesById=new Map((game.routes||[]).map(route=>[route.id,route]));vehicleIndicatorCounts={empty:0,partial:0,full:0};
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);ctx.fillStyle=palette.ground;ctx.fillRect(0,0,W,H);
    ctx.save();ctx.translate(W/2,H/2);ctx.scale(camera.zoom,camera.zoom);ctx.translate(-camera.x,-camera.y);
    const x0=Math.max(0,Math.floor((camera.x-W/2/camera.zoom)/TILE)),y0=Math.max(0,Math.floor((camera.y-H/2/camera.zoom)/TILE)),x1=Math.min(game.width,Math.ceil((camera.x+W/2/camera.zoom)/TILE)),y1=Math.min(game.height,Math.ceil((camera.y+H/2/camera.zoom)/TILE));
    drawWorld(x0,y0,x1,y1);
    // Small specular currents drift over the cached water texture.
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const t=tile(x,y);if(detailLevel==='region'||t?.terrain!=='water'||t.road||t.rail)continue;const river=t.detail==='river';if((x*7+y*13)%(river?5:11)!==0)continue;const vertical=river&&[tile(x,y-1),tile(x,y+1)].filter(n=>n?.terrain==='water').length>[tile(x-1,y),tile(x+1,y)].filter(n=>n?.terrain==='water').length;drawWaterMotion(ctx,x,y,river,vertical,game.day||0,game.biome);}
    if(showGrid){ctx.strokeStyle='#f6f2d330';ctx.lineWidth=.7/camera.zoom;ctx.beginPath();for(let x=x0;x<=x1;x++){ctx.moveTo(x*TILE,y0*TILE);ctx.lineTo(x*TILE,y1*TILE);}for(let y=y0;y<=y1;y++){ctx.moveTo(x0*TILE,y*TILE);ctx.lineTo(x1*TILE,y*TILE);}ctx.stroke();}
    if(showRoutes)for(const r of game.routes||[])if(r.path?.length){ctx.save();ctx.globalAlpha=.65;ctx.setLineDash([3,7]);ctx.lineDashOffset=-now*.003;line(ctx,r.path.map(p=>[(p.x+.5)*TILE,(p.y+.5)*TILE]),r.color||'#ce9d55',1.3/camera.zoom);ctx.restore();}
    // Steam stacks add activity to mills, factories, and power plants.
    if(layers.buildings)for(const ind of game.industries||[]){if(detailLevel==='region'||hasRasterIndustry(ind.kind,game.biome)||!visible(ind.x,ind.y)||!(ind.production>0)||/mine|quarry|forest|logging|farm|grain|wheat|ranch|plantation/.test(ind.kind))continue;for(let i=0;i<3;i++){const age=(now*.00014+i*.33)%1;ctx.fillStyle=`rgba(240,239,213,${.21*(1-age)})`;ctx.beginPath();ctx.ellipse(ind.x*TILE+7+age*9,ind.y*TILE-2-age*19,1+age*4,2+age*3,0,0,TAU);ctx.fill();}}
    if(layers.vehicles){
      const crossings=new Set();
      // Water traffic goes beneath bridge decks. Redraw only nearby deck pieces
      // over ships, then draw road and rail traffic above the finished crossing.
      for(const v of game.vehicles||[]){const route=routesById.get(v.routeId);if(route?.mode!=='water'||!visible(v.x,v.y))continue;vehicle(v,route);for(let y=Math.floor(v.y)-1;y<=Math.floor(v.y)+1;y++)for(let x=Math.floor(v.x)-1;x<=Math.floor(v.x)+1;x++){const t=tile(x,y);if(t&&(t.bridge||t.terrain==='water')&&((layers.roads&&t.road)||(layers.rails&&t.rail)))crossings.add(y*game.width+x);}}
      for(const id of crossings){const x=id%game.width,y=Math.floor(id/game.width),t=tile(x,y);if(layers.roads)network(ctx,x,y,t,'road');if(layers.rails)network(ctx,x,y,t,'rail');}
      for(const v of game.vehicles||[]){const route=routesById.get(v.routeId);if(route?.mode!=='water')vehicle(v,route);}
    }
    function highlight(p,color,filled=true,span=1){if(!p||p.x<0||p.y<0||p.x>=game.width||p.y>=game.height)return;const x=p.x*TILE,y=p.y*TILE,edge=span*TILE-2;ctx.fillStyle=color+'26';if(filled)ctx.fillRect(x+1,y+1,edge,edge);ctx.strokeStyle=color;ctx.lineWidth=1.5/camera.zoom;ctx.strokeRect(x+1,y+1,edge,edge);}
    const previewSite=p=>{const site=industryIndex.get(p.y*game.width+p.x);return (tool==='inspect'||tool==='bulldoze')&&site?site:p;};
    const previewSpan=p=>INDUSTRIES[tool]?2:industrySize(previewSite(p));
    const selectedStation=selected&&(game.stations||[]).find(s=>s.x===selected.x&&s.y===selected.y);
    const serviceCenter=['stop','bus-stop','train-stop','port'].includes(tool)?hover:selectedStation;
    if(serviceCenter){const x=(serviceCenter.x+.5)*TILE,y=(serviceCenter.y+.5)*TILE;ctx.fillStyle='#eff2cd19';ctx.strokeStyle='#f3e5ad';ctx.lineWidth=1.3/camera.zoom;ctx.setLineDash([5/camera.zoom,5/camera.zoom]);ctx.beginPath();ctx.arc(x,y,STATION_RADIUS*TILE,0,TAU);ctx.fill();ctx.stroke();ctx.setLineDash([]);for(const node of [...(game.cities||[]),...(game.industries||[])])if((node.kind?industryDistance(node,serviceCenter):Math.hypot(node.x-serviceCenter.x,node.y-serviceCenter.y))<=STATION_RADIUS)highlight(node,'#efe8b2',false,industrySize(node));}
    if(selected&&typeof selected.x==='number'){const site=industryIndex.get(selected.y*game.width+selected.x);highlight(site||selected,'#fbefba',false,industrySize(site));}
    const spanTool=['bridge','railbridge','tunnel','railtunnel'].includes(tool),spanPoints=preview?.length?preview:hover?[hover]:[];
    const spanQuote=spanTool&&spanPoints.length?quoteBuildPlan(game,tool,spanPoints,{preferredMode}):null;
    const previewValid=p=>spanQuote?spanQuote.ok===true:validPreview(tool,p,preferredMode);
    for(const p of preview||[])highlight(previewSite(p),previewValid(p)?tool==='bulldoze'?'#e3aa6d':'#f2d88d':'#d7725f',true,previewSpan(p));
    if(hover)highlight(previewSite(hover),tool==='inspect'?'#f7efd3':previewValid(hover)?tool==='bulldoze'?'#e3aa6d':'#f4d090':'#d7725f',tool!=='inspect',previewSpan(hover));
    for(const stop of routeStops){const s=typeof stop==='object'?stop:(game.stations||[]).find(st=>st.id===stop);if(s){ctx.strokeStyle='#f4d397';ctx.lineWidth=2/camera.zoom;ctx.beginPath();ctx.arc((s.x+.5)*TILE,(s.y+.5)*TILE,21,0,TAU);ctx.stroke();}}
    ctx.restore();
    drawLighting(ctx,{game,layers,camera,width:W,height:H,bounds:{x0:Math.max(0,x0-1),y0:Math.max(0,y0-1),x1,y1},industryIndex,stationIndex,routesById});
    if(hover&&(tool==='raise'||tool==='lower')){
      const t=tile(hover.x,hover.y);if(t){const p=worldToScreen(hover.x,hover.y),level=terrainLevel(t),allowed=validPreview(tool,hover,preferredMode);pill(p.x,p.y-28*camera.zoom,allowed?`Level ${level} → ${level+(tool==='raise'?1:-1)}`:`Level ${level}`,{size:12,h:25,fill:allowed?'#f7f1ddef':'#f5e7dfef',color:allowed?'#43573b':'#934f3f'});}
    }
    if(serviceCenter){const p=worldToScreen(serviceCenter.x,serviceCenter.y);pill(p.x,p.y-STATION_RADIUS*TILE*camera.zoom-15,'5-tile reach',{size:11,h:25,fill:'#f5f3e8e8',color:'#5c7155'});}
    // Labels stay crisp at every camera zoom, with population separated from place names.
    const regionLabels=[];
    if(layers.names)for(const city of game.cities||[]){if(!visible(city.x,city.y))continue;const p=worldToScreen(city.x,city.y),y=p.y-29*camera.zoom;
      if(detailLevel==='region'){const name=city.name||'New city';ctx.font='600 11px Space, system-ui, sans-serif';const w=ctx.measureText(name).width+20,box={x:p.x-w/2-4,y:y-14,w:w+8,h:28};if(regionLabels.some(other=>box.x<other.x+other.w&&box.x+box.w>other.x&&box.y<other.y+other.h&&box.y+box.h>other.y))continue;regionLabels.push(box);pill(p.x,y,name,{size:11,bold:true,h:23,fill:'#f7f5e9f0'});continue;}
      ctx.font='600 13px Space, system-ui, sans-serif';const name=city.name||'New city';const nameW=ctx.measureText(name).width;const pop=Number(city.population||0).toLocaleString('en-US');ctx.font='500 11px Space, system-ui, sans-serif';const popW=ctx.measureText(pop).width;const w=nameW+popW+42;
      ctx.shadowColor='#1b38202a';ctx.shadowBlur=10;ctx.shadowOffsetY=2;ctx.fillStyle='#f7f5e9f5';roundRect(ctx,p.x-w/2,y-14,w,29,6);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.strokeStyle='#fbfaee';ctx.lineWidth=.7;ctx.stroke();ctx.textAlign='left';ctx.textBaseline='middle';ctx.font='600 13px Space, system-ui, sans-serif';ctx.fillStyle='#314639';ctx.fillText(name,p.x-w/2+10,y+.5);ctx.fillStyle='#e6e9da';roundRect(ctx,p.x+w/2-popW-22,y-9,popW+16,19,3);ctx.fill();ctx.font='500 11px Space, system-ui, sans-serif';ctx.fillStyle='#60705a';ctx.fillText(pop,p.x+w/2-popW-14,y+.5);
    }
    for(const ind of game.industries||[]){if(!visible(ind.x,ind.y)||(!layers.names&&!layers.industryIcons))continue;const marker=industryMarker(ind),kind=Object.keys(INDUSTRIES[ind.kind]?.outputs||{})[0]||'goods',hovered=hover&&Math.abs(hover.x-ind.x)<2&&Math.abs(hover.y-ind.y)<2,chosen=selected&&selected.x===ind.x&&selected.y===ind.y,label=layers.names&&(hovered||chosen)?ind.name||titleCase(ind.kind):null;if(layers.industryIcons)resourceMarker(marker.x,marker.y,kind,marker.size,label);else if(label)pill(marker.x,marker.y,label,{size:12,h:28,fill:'#f7f4e7f5',color:'#3e5547',radius:5});}
    if(layers.stations)for(const st of game.stations||[]){if(!visible(st.x,st.y))continue;const p=worldToScreen(st.x,st.y),mx=p.x+8*camera.zoom,my=p.y-18*camera.zoom;ctx.fillStyle=st.mode==='water'?'#376e7e':st.mode==='rail'?'#3f655a':'#516d53';roundRect(ctx,mx,my,14,14,3);ctx.fill();if(st.mode==='water'){ctx.strokeStyle='#f0eacb';ctx.lineWidth=1.1;ctx.beginPath();ctx.arc(mx+7,my+3.5,1.2,0,TAU);ctx.stroke();line(ctx,[[mx+7,my+4.7],[mx+7,my+11]],'#f0eacb',1.1);line(ctx,[[mx+4,my+6],[mx+10,my+6]],'#f0eacb',1.1);ctx.beginPath();ctx.moveTo(mx+3,my+8);ctx.quadraticCurveTo(mx+3,my+11,mx+7,my+11);ctx.quadraticCurveTo(mx+11,my+11,mx+11,my+8);ctx.stroke();}else{ctx.fillStyle='#f0eacb';ctx.font='bold 9px Space, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(st.mode==='rail'?'T':'B',mx+7,my+7.2);}}
    if(layers.vehicles&&layers.vehicleLoads)for(const v of game.vehicles||[])vehicleLoadIndicator(v,routesById.get(v.routeId));
    // Extremely light edge shade holds the terrain together without dimming the playfield.
    const vignette=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.3,W/2,H/2,Math.max(W,H)*.75);vignette.addColorStop(0,'#21382b00');vignette.addColorStop(1,'#21382b10');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
  }
  function cacheMinimap(){
    ensureRevision();const scale=Math.min(1,MINIMAP_EDGE/Math.max(game.width,game.height));
    const width=Math.max(1,Math.round(game.width*scale)),height=Math.max(1,Math.round(game.height*scale));
    if(minimapRevision===cachedRevision&&minimapLayer.width===width&&minimapLayer.height===height)return;
    if(minimapLayer.width!==width||minimapLayer.height!==height||!minimapPixels){
      minimapLayer.width=width;minimapLayer.height=height;
      minimapPixels=minimapLayer.getContext('2d').createImageData(width,height);
      minimapWords=new Uint32Array(minimapPixels.data.buffer);
    }
    // Daily ecology visits at most 512² representative tiles, even on a 2048²
    // world. Thin roads would disappear under point sampling, so their sparse
    // index is rebuilt only when the transport network changes, never each day.
    const stepX=game.width/width,stepY=game.height/height;
    const packed=hex=>new Uint32Array(new Uint8Array([parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),255]).buffer)[0];
    const colors={grass:packed(palette.ground),water:packed(palette.deep),forest:packed(palette.forest),mountain:packed(palette.mountain),rock:packed(palette.mountain),sand:packed(palette.sand),snow:packed(palette.ground2),road:packed('#d7cbb0'),rail:packed('#655f52'),building:packed('#cfb78b'),zone:packed('#b2b78c'),marsh:packed('#708879'),saltflat:packed('#e3d9bc')};
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const tx=Math.floor((x+.5)*stepX),ty=Math.floor((y+.5)*stepY),t=game.tiles[ty*game.width+tx],terrain=t.terrain==='forest'&&!layers.trees?'grass':t.terrain;
      minimapWords[y*width+x]=layers.buildings&&t.building?colors.building:layers.rails&&t.rail?colors.rail:layers.roads&&t.road?colors.road:layers.zones&&t.zone?colors.zone:terrain==='water'?colors.water:terrain==='forest'?colors.forest:terrainOverviewColor(game,tx,ty);
    }
    minimapTerrainSamples=width*height;
    if(scale<1&&(layers.roads||layers.rails)){
      if(minimapNetworkGame!==game||minimapNetworkRevision!==(game.networkRevision||0)){
        minimapNetwork=[];for(let i=0;i<game.tiles.length;i++)if(game.tiles[i].road||game.tiles[i].rail)minimapNetwork.push(i);
        minimapNetworkGame=game;minimapNetworkRevision=game.networkRevision||0;minimapNetworkScans++;
      }
      for(const id of minimapNetwork){const t=game.tiles[id],color=layers.buildings&&t.building?colors.building:layers.rails&&t.rail?colors.rail:layers.roads&&t.road?colors.road:null;if(color!==null)minimapWords[Math.floor((Math.floor(id/game.width)+.5)/stepY)*width+Math.floor((id%game.width+.5)/stepX)]=color;}
    }
    if(layers.buildings)for(const industry of game.industries||[])minimapWords[Math.floor((industry.y+.5)/stepY)*width+Math.floor((industry.x+.5)/stepX)]=colors.building;
    minimapLayer.getContext('2d').putImageData(minimapPixels,0,0);minimapRevision=cachedRevision;
  }
  function drawMinimap(minimap){
    cacheMinimap();const rect=minimap.getBoundingClientRect();const mw=Math.round(rect.width||180),mh=Math.round(rect.height||115),ratio=Math.min(window.devicePixelRatio||1,2);if(minimap.width!==mw*ratio||minimap.height!==mh*ratio){minimap.width=mw*ratio;minimap.height=mh*ratio;}
    const c=minimap.getContext('2d');c.setTransform(ratio,0,0,ratio,0,0);c.imageSmoothingEnabled=false;c.drawImage(minimapLayer,0,0,mw,mh);c.imageSmoothingEnabled=true;
    const sx=mw/game.width,sy=mh/game.height;c.strokeStyle='#f5e4b4';c.lineWidth=1;
    if(layers.routes)for(const r of game.routes||[])if(r.path?.length)line(c,r.path.map(p=>[(p.x+.5)*sx,(p.y+.5)*sy]),r.color||'#e4c38c',1.4);
    if(layers.industryIcons){c.fillStyle='#d9ba7d';for(const ind of game.industries||[])c.fillRect((ind.x+.5)*sx-1,(ind.y+.5)*sy-1,2,2);}
    if(layers.buildings)for(const city of game.cities||[])dot(c,(city.x+.5)*sx,(city.y+.5)*sy,2.5,'#f7f2d8');
    if(layers.stations)for(const stop of game.stations||[]){const x=(stop.x+.5)*sx,y=(stop.y+.5)*sy;if(stop.mode==='water'){c.fillStyle='#d4ebe1';c.beginPath();c.moveTo(x,y-3);c.lineTo(x+3,y);c.lineTo(x,y+3);c.lineTo(x-3,y);c.closePath();c.fill();dot(c,x,y,1.4,'#376e7e');}else dot(c,x,y,1.7,stop.mode==='rail'?'#365b59':'#658153');}
    const vx=(camera.x-W/2/camera.zoom)/TILE*sx,vy=(camera.y-H/2/camera.zoom)/TILE*sy,vw=W/camera.zoom/TILE*sx,vh=H/camera.zoom/TILE*sy;
    c.fillStyle='#f4efcc12';c.fillRect(vx,vy,vw,vh);c.strokeStyle='#f6edc7';c.lineWidth=1.3;c.strokeRect(vx+.5,vy+.5,vw-1,vh-1);c.strokeStyle='#425c4940';c.lineWidth=.6;c.strokeRect(vx-.5,vy-.5,vw+1,vh+1);
  }
  resize();const first=game.cities?.[0];if(first)focus(first.x+9,first.y);else bounds();
  return {setGame,setLayers,getLayers,render,resize,screenToTile,screenToInspectTile,pan,zoomAt,setZoom,focus,getCamera:()=>({...camera}),drawMinimap,getStats:()=>({chunkCount:chunks.size,composedChunks,cacheBytes,cacheLimit,cacheMax:CACHE_MAX,chunkTiles:CHUNK_TILES,rasterScale,pixelScale:rasterScale,detailLevel,view:ZOOM_VIEWS.find(view=>view.zoom===camera.zoom).name,devicePixelRatio:dpr,dpr,maxSurfaceWidth:largestSurface,maxSurfaceHeight:largestSurface,minimapWidth:minimapLayer.width,minimapHeight:minimapLayer.height,minimapMaxEdge:MINIMAP_EDGE,minimapWorldWidth:game.width,minimapWorldHeight:game.height,minimapTerrainSamples,minimapNetworkScans,vehicleIndicators:{...vehicleIndicatorCounts},houseArtwork:getHouseAssetStats(game.biome),worldArtwork:worldArtStats(),layers:getLayers()})};
}
