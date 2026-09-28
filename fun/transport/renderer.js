import { resolveBuildTool, quoteBuildPlan } from './construction-plan.js';
import { routeTileIndex } from './route-tiles.js';
import { terraformProblem, networkEdgeAllowed, networkTerrainShape } from './terrain-engineering.js';
import { isEngineeredTunnel, isUndergroundAt } from './structure-visibility.js';
import { TILE, PALETTES, createSprites, createSpriteCache, rng } from './sprites.js';
import { INDUSTRIES, BUILD_COSTS } from './data.js';
import { STATION_RADIUS, priceFor, buildProblem, routeBreakPoint } from './model.js';
import { BUILDINGS, residentialKind, commercialKind } from './buildings.js';
import { ZOOM_VIEWS, nearestZoom, stepZoom } from './zoom.js';
import { cargoIcon } from './cargo-icons.js';
import { lensRole } from './chains.js';
import { landscapeScenery } from './landscape-scenery.js';
import { DEFAULT_LAYERS, normalizeLayers } from './visibility.js';
import { createMarineSprites, drawShipWake, MARINE_SIZE } from './marine-sprites.js';
import { createLighting } from './lighting.js';
import { createWeatherEffects } from './weather-effects.js';
import { paintWaterRelief, paintCoast, drawWaterMotion } from './water-art.js';
import { houseAssetsRevision, getHouseAssetStats } from './raster-houses.js';
import { worldArtRevision, worldArtStats } from './atlas-runtime.js';
import { createVehicleSprites, drawRasterInfrastructure, drawRasterNetwork, hasRasterTransport } from './raster-transport.js';
import { industrySize, industryFootprint, industryTiles, industryContains, industryDistance } from './industry-sites.js';
import { buildingSize, buildingFootprint, buildingAt } from './building-sites.js';
import { terrainObjectAt, terrainObjectSize } from './terrain-objects.js';
import { surfaceChangesSince } from './change-journal.js';
import { natureObjectLayout, drawRasterTreeShadows, treeShadowCacheStats } from './raster-nature.js';
import { terrainLevel, terrainElevation, terrainReliefRaster, terrainOverviewColor } from './terrain-elevation.js';
import { noise, hashNoise } from './world-noise.js';
import { populationText } from './formatters.js';
import { shorelineContours, appendShoreline } from './shoreline.js';
import { projectPoint, unprojectPoint, projectAngle } from './isometric.js';
import { projectGround, projectTerrainPoint, surfaceHeight, tileSurface, groundIsFlat, pickGround, transportHeight, bridgeDeckHeight, bridgeSurface, HEIGHT_STEP, MAX_HEIGHT } from './terrain-geometry.js';
import { drawTerrainMesh, paintTerrainTile } from './terrain-mesh.js';
import { partitionScenery, createSceneryBudget } from './scenery-batches.js';
import { createRouteRenderIndex } from './route-render-index.js';
import { networkIndex } from './network-index.js';
import { createIsometricInfrastructureSprites } from './isometric-infrastructure.js';

const TAU=Math.PI*2;
const CHUNK_TILES=6, CHUNK_PIXELS=CHUNK_TILES*TILE, CHUNK_GUTTER=8;
const CACHE_BASE=48*1024*1024, CACHE_MAX=256*1024*1024;
const MINIMAP_EDGE=512;
const SCENE_PAN_MARGIN=96;
const LANDMARKS=new Set(['forest','rock']);
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
  const approachCanvas=document.createElement('canvas');
  const terrainSourceCanvas=document.createElement('canvas');
  let camera={x:48*TILE,y:32*TILE,zoom:nearestZoom(options.zoom),height:0};
  let palette=PALETTES[game.biome]||PALETTES.taiga,sprite,uprightSprite,marine,vehicleSprites,infrastructureSprites,rasterScale=0,detailLevel='',cacheLimit=CACHE_BASE;
  // Region, Town and Detail retain their native-pixel sprites in one budget.
  // Returning to a zoom reuses its prepared artwork instead of scaling atlases
  // or throwing away the other views' still-useful images.
  const preparedSprites=createSpriteCache({limit:128*1024*1024}),rasterBundles=new Map();
  const preparedTransport=createSpriteCache({limit:32*1024*1024});
  let preparedDpr=0;
  // The map can cover hundreds of thousands of tiles. Only visible, reusable
  // 6×6 chunks receive artwork at the current physical-pixel density. Small
  // chunks keep Detail's retina surfaces bounded; atlas terrain is capped at 512².
  const chunks=new Map(), minimapLayer=document.createElement('canvas'), codes=new Map(), cargoImages=new Map(),loadBadges=new Map();
  const drawLighting=createLighting();
  const motionPreference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const drawWeather=createWeatherEffects({reducedMotion:()=>Boolean(motionPreference?.matches)});
  if(options.onInvalidate)motionPreference?.addEventListener('change',options.onInvalidate);
  let cachedRevision=-1, minimapRevision=-1, cachedBiome=game.biome, cachedSeed=game.seed, cachedHouseAssets=houseAssetsRevision(),cachedWorldAssets=worldArtRevision();
  let minimapPixels=null,minimapWords=null;
  let minimapNetworkGame=null,minimapNetworkRevision=-1,minimapNetwork=null,minimapNetworkScans=0,minimapTerrainSamples=0;
  let industryIndex=new Map(), stationIndex=new Map(), buildingIndex=new Map(), terrainObjectIndex=new Map(), cacheBytes=0, composedChunks=0;
  let objectHits=[],bridgeHits=[],sceneCache=null,gridCache=null,sceneViewBounds=null,capturedBillboards=null;
  const sceneryBudget=createSceneryBudget();
  const sceneryBatching=options.sceneryBatching!==false;
  let sceneryBatchBuilds=0,sceneryBatchDraws=0,sceneryDirectDraws=0,sceneryPreparationMs=0;
  const sceneryPrepareBudgetMs=3,sceneryPanSettleMs=90;
  let lastSceneCamera=null,lastCameraMotion=-Infinity,sceneryWaitingForCamera=false;
  const foundations=new Map();
  let sceneBuilds=0,foundationBuilds=0,projectedOrigin=null;
  const routeIndexes=new WeakMap(),routePaths=new WeakMap(),minimapRoutePaths=new WeakMap();
  let routeSegmentsConsidered=0,routePathBuilds=0;
  const routeBreakPoints=new WeakMap();let routeBreaks=0,highlightedRoute=null;
  function routeBreak(r){const key=`${game.networkRevision||0}:${r.path.length}`;let entry=routeBreakPoints.get(r);if(entry?.key!==key)routeBreakPoints.set(r,entry={key,at:routeBreakPoint(game,r)});return entry.at;}
  let structureRevision=0;
  const frameVehicles=[];
  let largestSurface=0, lastTime=0, vehicleIndicatorCounts={empty:0,partial:0,full:0};
  function code(value){if(!value)return 0;const key=String(value);if(codes.has(key))return codes.get(key);let h=0;for(let i=0;i<key.length;i++)h=(Math.imul(h,31)+key.charCodeAt(i))|0;codes.set(key,h);return h;}
  function clearChunks(){sceneryBudget.clear();objectHits=[];bridgeHits=[];sceneCache=null;gridCache=null;foundations.clear();for(const entry of chunks.values())entry.mesh.width=entry.mesh.height=0;chunks.clear();cacheBytes=0;}
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
  // A cargo lens is view state, never saved: producers and buyers of one cargo stand out on the map, minimap and atlas.
  const LENS_COLORS={source:'#4e7747',buyer:'#3f7f88'};let lens=null,lensStats=null;
  function setLens(cargo){cargo=cargo&&cargo!=='passengers'?cargo:null;if(cargo===lens)return;lens=cargo;lensStats=null;options.onInvalidate?.();}
  function updateRaster(force=false){
    const scale=camera.zoom*dpr,detail=ZOOM_VIEWS.find(view=>view.zoom===camera.zoom).name.toLowerCase();
    if(force||preparedDpr!==dpr){rasterBundles.clear();preparedSprites.clear();preparedTransport.clear();preparedDpr=dpr;}
    if(force||rasterScale!==scale||detailLevel!==detail){
      rasterScale=scale;detailLevel=detail;
      let bundle=rasterBundles.get(detail);
      if(!bundle){bundle={sprite:createSprites(game.biome,{pixelScale:scale,detailLevel:detail,cache:preparedSprites}),uprightSprite:createSprites(game.biome,{pixelScale:scale*1.5,detailLevel:detail,cache:preparedSprites}),marine:createMarineSprites({pixelScale:scale,detailLevel:detail,cache:preparedTransport}),vehicleSprites:createVehicleSprites({pixelScale:scale,cache:preparedTransport}),infrastructureSprites:createIsometricInfrastructureSprites({pixelScale:scale,cache:preparedTransport})};rasterBundles.set(detail,bundle);}
      ({sprite,uprightSprite,marine,vehicleSprites,infrastructureSprites}=bundle);
    }
  }
  function ensureRevision(){
    if(cachedHouseAssets!==houseAssetsRevision()||cachedWorldAssets!==worldArtRevision()){clearChunks();updateRaster(true);cachedHouseAssets=houseAssetsRevision();cachedWorldAssets=worldArtRevision();}
    if(cachedBiome!==game.biome||cachedSeed!==game.seed){clearChunks();palette=PALETTES[game.biome]||PALETTES.taiga;updateRaster(true);cachedBiome=game.biome;cachedSeed=game.seed;cachedRevision=-1;minimapRevision=-1;}
    if(cachedRevision===(game.revision||0))return;
    const surface=surfaceChangesSince(game,cachedRevision);if(surface){refreshSurface(surface);return;}
    buildingIndex.clear();terrainObjectIndex.clear();foundations.clear();sceneryBudget.clear();sceneCache=null;gridCache=null;
    industryIndex=new Map((game.industries||[]).flatMap(item=>industryTiles(item).map(p=>[p.y*game.width+p.x,item])));
    stationIndex=new Map((game.stations||[]).map(item=>[item.y*game.width+item.x,item]));
    cachedRevision=game.revision||0;structureRevision++;
  }
  // Ecology rewrites only terrain, detail and dissolved groves, never heights,
  // water, structures or sites. Keep every index, foundation, grid and route
  // path; forget only the changed parcels and re-fingerprint only chunks whose
  // bounds, padded by three tiles, hold a change. Scenery still rebuilds whole.
  function refreshSurface(changes){
    sceneryBudget.clear();sceneCache=null;
    const reach=5,columns=Math.ceil(game.width/CHUNK_TILES)+2,near=new Set(),revision=game.revision||0;
    for(const index of changes){
      terrainObjectIndex.delete(index);
      const x=index%game.width,y=Math.floor(index/game.width);
      for(let cy=Math.ceil((y-reach-CHUNK_TILES+1)/CHUNK_TILES);cy<=Math.floor((y+reach)/CHUNK_TILES);cy++)for(let cx=Math.ceil((x-reach-CHUNK_TILES+1)/CHUNK_TILES);cx<=Math.floor((x+reach)/CHUNK_TILES);cx++)near.add((cy+1)*columns+cx+1);
    }
    // Only a chunk current at the previous revision may skip its fingerprint.
    for(const [key,entry] of chunks){if(entry.revision!==cachedRevision)continue;const [cx,cy]=key.split(',').map(Number);if(!near.has((cy+1)*columns+cx+1))entry.revision=revision;}
    cachedRevision=revision;
  }
  const tile=(x,y)=> x<0||y<0||x>=game.width||y>=game.height?null:game.tiles[y*game.width+x];
  function buildingSiteAt(x,y){
    if(!tile(x,y))return null;
    const id=y*game.width+x;if(buildingIndex.has(id))return buildingIndex.get(id);
    // Cache only queried parcels; never scan a multi-million-tile world each
    // frame. A long paused pan also has a fixed memory ceiling.
    if(buildingIndex.size>=65536)buildingIndex.clear();
    const site=buildingAt(game,x,y);buildingIndex.set(id,site);return site;
  }
  const siteAt=(x,y)=>industryIndex.get(y*game.width+x)||buildingSiteAt(x,y);
  function terrainSiteAt(x,y){
    if(!tile(x,y))return null;
    const id=y*game.width+x;if(terrainObjectIndex.has(id))return terrainObjectIndex.get(id);
    if(terrainObjectIndex.size>=65536)terrainObjectIndex.clear();
    const found=terrainObjectAt(game,x,y);let site=found?.object.kind==='mountain'?null:found;
    // Saved parcels use the original elevation recipe. Only draw their large
    // artwork when every displayed vertex is level; small fallback scenery
    // is eligible separately on each remaining flat cell.
    if(site&&!groundIsFlat(game,site.x,site.y,terrainObjectSize(site.object)))site=null;
    if(found){const span=terrainObjectSize(found.object);for(let dy=0;dy<span;dy++)for(let dx=0;dx<span;dx++)terrainObjectIndex.set((found.y+dy)*game.width+found.x+dx,site);}
    else terrainObjectIndex.set(id,null);
    return site;
  }
  const inspectSiteAt=(x,y)=>siteAt(x,y)||terrainSiteAt(x,y);
  const siteSize=site=>site?.object?terrainObjectSize(site.object):site?.building?buildingSize(site.building):industrySize(site);
  function portLandDirection(x,y){return[[-1,0],[0,-1],[1,0],[0,1]].find(([dx,dy])=>tile(x+dx,y+dy)&&tile(x+dx,y+dy).terrain!=='water')||[-1,0];}
  // Simulation and saves keep their square grid. Only the view uses a 2:1
  // diamond projection; upright objects are composed in projected space.
  const projectTile=(x,y)=>projectGround(game,x+.5,y+.5);
  const cameraPoint=()=>{
    if(!projectedOrigin||projectedOrigin.cx!==camera.x||projectedOrigin.cy!==camera.y||projectedOrigin.height!==camera.height){
      const p=projectPoint(camera.x,camera.y);p.y-=(camera.height||0)*HEIGHT_STEP;
      projectedOrigin={...p,cx:camera.x,cy:camera.y,height:camera.height};
    }
    return projectedOrigin;
  };
  const screenPoint=p=>{const origin=cameraPoint();return{x:(p.x-origin.x)*camera.zoom+W/2,y:(p.y-origin.y)*camera.zoom+H/2};};
  const worldToScreen=(x,y)=>screenPoint(projectTile(x,y));
  const gridPointToScreen=(x,y)=>screenPoint(projectGround(game,x,y));
  const transportPoint=(x,y,mode)=>{const p=projectPoint((x+.5)*TILE,(y+.5)*TILE);p.y-=transportHeight(game,x,y,mode)*HEIGHT_STEP;return p;};
  const vehicleToScreen=(x,y,mode)=>screenPoint(transportPoint(x,y,mode));
  function foundationHeight(x,y,span){
    const key=(y*game.width+x)*4+span,cached=foundations.get(key);
    if(cached)return cached.height;
    let h=0;
    // A site's highest point may be an interior vertex, not its perimeter.
    for(let v=y;v<=y+span;v++)for(let u=x;u<=x+span;u++)h=Math.max(h,surfaceHeight(game,u,v));
    for(let v=y;v<y+span;v++)for(let u=x;u<x+span;u++)h=Math.max(h,surfaceHeight(game,u+.5,v+.5));
    if(foundations.size>=8192)foundations.clear();
    foundations.set(key,{height:h,paths:null});foundationBuilds++;return h;
  }
  function foundationPoint(x,y,span){const p=projectPoint((x+span/2)*TILE,(y+span/2)*TILE);p.y-=foundationHeight(x,y,span)*HEIGHT_STEP;return p;}
  const buildingToScreen=(x,y,span)=>screenPoint(foundationPoint(x,y,span));
  const groundTransform=c=>c.transform(1,.5,-1,.5,0,0);
  function screenToWorld(x,y){const origin=cameraPoint();return unprojectPoint((x-W/2)/camera.zoom+origin.x,(y-H/2)/camera.zoom+origin.y);}
  function viewportCorners(margin=0){return[[-margin,-margin],[W+margin,-margin],[W+margin,H+margin],[-margin,H+margin]].map(([x,y])=>screenToWorld(x,y));}
  function visibleBounds(extra=0){const points=viewportCorners((180+MAX_HEIGHT*HEIGHT_STEP+extra)*camera.zoom);return{x0:Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))/TILE)),y0:Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))/TILE)),x1:Math.min(game.width,Math.ceil(Math.max(...points.map(p=>p.x))/TILE)),y1:Math.min(game.height,Math.ceil(Math.max(...points.map(p=>p.y))/TILE))};}
  function stationMarker(station){const p=worldToScreen(station.x,station.y);return{x:p.x+8*camera.zoom,y:p.y-28*camera.zoom,size:14};}
  // Town labels rise clear of the stop signs beside a town centre; stations are cached per revision.
  const labelRects=[];let townStops=null,townStopsIndex=null;
  function nearbyStops(city){
    if(townStopsIndex!==stationIndex){townStops=new Map();townStopsIndex=stationIndex;for(const c of game.cities||[]){const near=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const st=c.x+dx>=0&&c.x+dx<game.width?stationIndex.get((c.y+dy)*game.width+c.x+dx):null;if(st)near.push(st);}if(near.length)townStops.set(c,near.sort((a,b)=>projectTile(b.x,b.y).y-projectTile(a.x,a.y).y));}}
    return townStops.get(city);
  }
  // Signs are visited lowest first, so each lift can only meet the signs above it.
  function clearStopSigns(stops,x,w,y,above,below){for(const st of stops){const m=stationMarker(st);if(m.x<x+w&&m.x+m.size>x&&m.y<y+below+5&&m.y+m.size>y-above)y=m.y-below-5;}return y;}
  function resize(){const rect=canvas.getBoundingClientRect();W=Math.max(1,rect.width);H=Math.max(1,rect.height);dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.imageSmoothingEnabled=false;updateRaster();bounds();}
  function bounds(){
    camera.x=Math.max(TILE/2,Math.min((game.width-.5)*TILE,camera.x));
    camera.y=Math.max(TILE/2,Math.min((game.height-.5)*TILE,camera.y));
    // Snap the projected origin to physical pixels, then return to world space.
    const p=cameraPoint();
    const snapped=unprojectPoint((W/2-Math.round((W/2-p.x*camera.zoom)*dpr)/dpr)/camera.zoom,(H/2-Math.round((H/2-p.y*camera.zoom)*dpr)/dpr)/camera.zoom);
    camera.x=snapped.x+(camera.height||0)*HEIGHT_STEP;camera.y=snapped.y+(camera.height||0)*HEIGHT_STEP;
  }
  function focus(x,y){camera.x=(x+.5)*TILE;camera.y=(y+.5)*TILE;camera.height=surfaceHeight(game,x+.5,y+.5);bounds();}
  function pan(dx,dy){const move=unprojectPoint(dx/camera.zoom,dy/camera.zoom);camera.x-=move.x;camera.y-=move.y;bounds();}
  function setZoom(value,clientX,clientY){
    const next=nearestZoom(value);if(next===camera.zoom)return;
    const rect=canvas.getBoundingClientRect(),sx=(clientX===undefined?W/2:clientX-rect.left)-W/2,sy=(clientY===undefined?H/2:clientY-rect.top)-H/2,old=camera.zoom;
    const move=unprojectPoint(sx/old-sx/next,sy/old-sy/next);
    camera.zoom=next;camera.x+=move.x;camera.y+=move.y;bounds();updateRaster();
  }
  function zoomAt(factor,clientX,clientY){if(!Number.isFinite(factor)||factor<=0||factor===1)return;setZoom(stepZoom(camera.zoom,Math.sign(factor-1)),clientX,clientY);}
  function screenToTile(clientX,clientY,{clamp=false}={}){
    const rect=canvas.getBoundingClientRect(),origin=cameraPoint(),px=(clientX-rect.left-W/2)/camera.zoom+origin.x,py=(clientY-rect.top-H/2)/camera.zoom+origin.y;
    // A high viaduct may cover a different ground tile in screen space. Pick
    // its visible deck before the land below, including for demolition.
    for(let i=bridgeHits.length-1;i>=0;i--){
      const hit=bridgeHits[i],p=unprojectPoint(px,py+hit.height*HEIGHT_STEP),u=p.x/TILE,v=p.y/TILE;
      if(Math.floor(u)===hit.x&&Math.floor(v)===hit.y&&Math.abs(hit.axis==='x'?v-hit.y-.5:u-hit.x-.5)<=9/TILE)return{x:hit.x,y:hit.y};
    }
    const p=pickGround(game,px,py);return p?{x:Math.floor(p.x),y:Math.floor(p.y)}:clamp?edgePoint(px,py,Math.floor,.5):{x:-1,y:-1};
  }
  // A construction drag that leaves the world ends at its nearest edge tile. As in
  // pickGround, the frontmost edge point whose ground reaches the pointer's ray wins.
  function edgePoint(px,py,snap,middle){
    const fit=p=>({x:Math.max(0,Math.min(game.width-1,snap(p.x/TILE))),y:Math.max(0,Math.min(game.height-1,snap(p.y/TILE)))});
    for(let h=MAX_HEIGHT;h>0;h-=.5){const edge=fit(unprojectPoint(px,py+h*HEIGHT_STEP));if(surfaceHeight(game,edge.x+middle,edge.y+middle)>=h)return edge;}
    return fit(unprojectPoint(px,py));
  }
  function screenToVertex(clientX,clientY,{clamp=false}={}){
    const rect=canvas.getBoundingClientRect(),origin=cameraPoint(),px=(clientX-rect.left-W/2)/camera.zoom+origin.x,py=(clientY-rect.top-H/2)/camera.zoom+origin.y;
    const picked=pickGround(game,px,py);if(!picked)return clamp?edgePoint(px,py,Math.round,0):{x:-1,y:-1};
    let nearest=null,distance=Infinity;
    // Snap to the closest visible corner, including on foreshortened slopes.
    for(const y of [Math.floor(picked.y),Math.ceil(picked.y)])for(const x of [Math.floor(picked.x),Math.ceil(picked.x)]){
      if(x<0||y<0||x>=game.width||y>=game.height)continue;
      const p=projectGround(game,x,y),d=(p.x-px)**2+(p.y-py)**2;
      if(d<distance){nearest={x,y};distance=d;}
    }
    return nearest||{x:-1,y:-1};
  }
  function industryMarker(industry){
    const span=industrySize(industry),p=buildingToScreen(industry.x,industry.y,span),size=detailLevel==='detail'?28:24;
    return {x:p.x,y:p.y+16*span*camera.zoom+5+(size+6)/2,size};
  }
  // Stop signs float above their tile. The topmost sign within two pixels wins;
  // failing that, the sign whose centre is nearest, if its box lies within slop.
  function stationAtMarker(clientX,clientY,{slop=0}={}){
    if(!layers.stations)return null;
    const rect=canvas.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top,stations=game.stations||[];let best=null,nearest=Infinity;
    for(let i=stations.length-1;i>=0;i--){
      const st=stations[i];if(!visible(st.x,st.y))continue;
      const m=stationMarker(st),dx=Math.max(m.x-x,0,x-m.x-m.size),dy=Math.max(m.y-y,0,y-m.y-m.size);if(dx<=2&&dy<=2)return st;
      const d=Math.hypot(x-m.x-m.size/2,y-m.y-m.size/2);if(Math.hypot(dx,dy)<=slop&&d<nearest){best=st;nearest=d;}
    }
    return best;
  }
  // Carriers are picked on demand from the last frame's culled list: load badges
  // first, as they are drawn above everything, then the nearest vehicle itself.
  function vehicleAt(clientX,clientY,{slop=0}={}){
    if(!layers.vehicles)return null;
    const rect=canvas.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top,routesById=new Map((game.routes||[]).map(route=>[route.id,route]));
    const shown=v=>{const route=routesById.get(v.routeId);return route&&(route.mode==='water'||!isUndergroundAt(game,v.x,v.y))?route:null;};
    if(layers.vehicleLoads)for(let i=frameVehicles.length-1;i>=0;i--){const v=frameVehicles[i],route=shown(v);if(!route||!visible(v.x,v.y,40))continue;const b=badgeRect(v,route);if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h)return v;}
    let best=null,nearest=Infinity;
    for(let i=frameVehicles.length-1;i>=0;i--){
      const v=frameVehicles[i],route=shown(v);if(!route)continue;
      const p=vehicleToScreen(v.x,v.y,route.mode),reach=(route.mode==='water'?Math.max(20,20*camera.zoom):Math.max(10,14*camera.zoom))+slop,d=Math.hypot(x-p.x,y-p.y);
      if(d<=reach&&d<nearest){best=v;nearest=d;}
    }
    return best;
  }
  function screenToInspectTile(clientX,clientY,{slop=0}={}){
    ensureRevision();
    const rect=canvas.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top;
    // Stop signs are drawn above resource badges, so a sign wins a shared pixel.
    const sign=stationAtMarker(clientX,clientY);if(sign)return{x:sign.x,y:sign.y};
    // Resource badges are drawn beyond their tile; inspecting one should open
    // its industry while construction continues to target the exact grid tile.
    for(let i=layers.industryIcons?(game.industries||[]).length-1:-1;i>=0;i--){
      const industry=game.industries[i];if(!visible(industry.x,industry.y,180*camera.zoom))continue;
      const marker=industryMarker(industry);
      if(Math.abs(x-marker.x)<=(marker.size+8)/2&&Math.abs(y-marker.y)<=(marker.size+6)/2)return {x:industry.x,y:industry.y};
    }
    const near=slop&&stationAtMarker(clientX,clientY,{slop});if(near)return{x:near.x,y:near.y};
    const picked=screenToTile(clientX,clientY),site=tile(picked.x,picked.y)&&inspectSiteAt(picked.x,picked.y);
    // A reserved site remains clickable across its full footprint,
    // including open yards beneath neighboring overhanging tree crowns.
    if(site)return{x:site.x,y:site.y};
    // Roofs and tree crowns extend behind their ground parcel. Pick the last
    // visible opaque sprite pixel, matching the same back-to-front draw order.
    const origin=cameraPoint();
    for(let i=objectHits.length-1;i>=0;i--){const hit=objectHits[i];
      // Cached strips retain the source sprite masks in world coordinates.
      // Convert only when picking, avoiding thousands of per-frame objects.
      const hx=hit.world?(hit.x-origin.x)*camera.zoom+W/2:hit.x,hy=hit.world?(hit.y-origin.y)*camera.zoom+H/2:hit.y,hw=hit.w*(hit.world?camera.zoom:1),hh=hit.h*(hit.world?camera.zoom:1);
      if(x<hx||y<hy||x>=hx+hw||y>=hy+hh)continue;
      const sx=Math.floor((x-hx)/hw*hit.image.width),sy=Math.floor((y-hy)/hh*hit.image.height);
      if(hit.image.getContext('2d').getImageData(sx,sy,1,1).data[3]>24)return{x:hit.tx,y:hit.ty};
    }
    return picked;
  }
  function setGame(next){lastSceneCamera=null;lastCameraMotion=-Infinity;game=next;clearChunks();drawLighting.clear?.();palette=PALETTES[game.biome]||PALETTES.taiga;updateRaster(true);cachedBiome=game.biome;cachedSeed=game.seed;cachedRevision=-1;minimapRevision=-1;const first=game.cities?.[0];if(first)focus(first.x+4.5,first.y-4.5);else bounds();}
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
    return hashNoise(x,y,seed+2267)<chance*.18?1:0;
  }
  function chunkBounds(cx,cy){return{x0:Math.max(0,cx*CHUNK_TILES-2),y0:Math.max(0,cy*CHUNK_TILES-2),x1:Math.min(game.width,(cx+1)*CHUNK_TILES+2),y1:Math.min(game.height,(cy+1)*CHUNK_TILES+2)};}
  function fingerprint(b){
    let hash=2166136261;
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y),id=y*game.width+x,ind=industryIndex.get(id),st=stationIndex.get(id),building=buildingSiteAt(x,y)?.building,nature=terrainSiteAt(x,y)?.object;
      const flags=(t.road?1:0)|(t.rail?2:0)|(t.bridge?4:0)|(t.tunnel?8:0);
      hash=Math.imul(hash^code(t.terrain),16777619);hash=Math.imul(hash^code(t.detail),16777619);
      hash=Math.imul(hash^Math.round(terrainElevation(t)*65536)^((t.structureLevel||0)<<8)^code(t.structureAxis),16777619);
      hash=Math.imul(hash^(t.variant||0)^flags,16777619);hash=Math.imul(hash^code(t.zone),16777619);
      hash=Math.imul(hash^code(building?.kind)^((building?.level||0)<<12)^(buildingSize(building)<<20),16777619);
      hash=Math.imul(hash^code(ind?.kind)^((ind?.footprint||1)<<10)^code(st?.mode),16777619);
      hash=Math.imul(hash^code(nature?.kind)^code(nature?.detail)^((nature?.variant||0)<<8)^((nature?.footprint||0)<<24),16777619);
    }
    for(let y=Math.max(0,b.y0-10);y<Math.min(game.height,b.y1+10);y++)for(let x=Math.max(0,b.x0-10);x<Math.min(game.width,b.x1+10);x++){
      const t=tile(x,y);hash=Math.imul(hash^Math.round(terrainElevation(t)*65536)^(t.terrain==='water'?1:0),16777619);
    }
    return hash;
  }
  function drawGround(c,b){
    const relief=terrainReliefRaster(game,b,6,{lighting:false});
    if(reliefCanvas.width!==relief.width||reliefCanvas.height!==relief.height){reliefCanvas.width=relief.width;reliefCanvas.height=relief.height;}
    reliefContext.putImageData(new ImageData(relief.pixels,relief.width,relief.height),0,0);
    c.save();c.imageSmoothingEnabled=true;c.imageSmoothingQuality='low';
    c.drawImage(reliefCanvas,b.x0*TILE,b.y0*TILE,(b.x1-b.x0)*TILE,(b.y1-b.y0)*TILE);c.restore();
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y),px=x*TILE,py=y*TILE,r=rng((game.seed||1847)+x*17651+y*2671);if(t.terrain==='water')continue;
      for(let n=0;n<5;n++){const xx=px+r()*31,yy=py+r()*31,w=.45+r(),h=.35+r()*.65;if(detailLevel==='region'&&n%3!==0)continue;c.fillStyle=n%3===0?palette.speck+'18':palette.dark+'12';c.fillRect(xx,yy,w,h);}
    }
    // World-anchored contour smoothing softens staircase coasts while keeping
    // every water and land tile center on its original side of the shoreline.
    const waterPath=new Path2D();
    const coasts=shorelineContours(game,b,TILE);appendShoreline(waterPath,coasts);
    // A narrow damp edge grounds the water; sandbars are local patches, never a
    // uniform pale ribbon running around every lake and river.
    c.lineJoin='round';
    c.fillStyle=palette.deep;c.fill(waterPath,'evenodd');c.save();c.clip(waterPath,'evenodd');
    paintWaterRelief(c,b,tile,game.biome,game.seed||0,detailLevel,layers,{treeIsVisible:(x,y)=>groundIsFlat(game,x,y)});
    c.restore();
    paintCoast(c,coasts,tile,game.biome,game.seed||0,detailLevel,waterPath);
    if(!layers.trees)return;
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y);if(detailLevel==='region'||t.terrain==='water'||t.building||t.road||t.rail||!groundIsFlat(game,x,y))continue;
      const r=rng(x*3461+y*3727);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(tile(x+dx,y+dy)?.terrain==='water'&&r()>(t.terrain==='forest'||['marsh','reeds','oasis'].includes(t.detail)?.6:.94)){for(let j=0;j<3;j++){const px=(x+.5)*TILE+dx*14+(dy?r()*12-6:0),py=(y+.5)*TILE+dy*14+(dx?r()*12-6:0);line(c,[[px,py],[px-1,py-3-r()*2]],'#71886b',1);}}
    }
  }
  const buried=t=>Boolean(t&&(isEngineeredTunnel(t)||t.tunnel||(t.terrain==='mountain'&&!t.bridge)));
  function portalArms(x,y,t,mode){
    return [[0,-1],[1,0],[0,1],[-1,0]].filter(([dx,dy])=>{const adjacent=tile(x+dx,y+dy);return (!t.structureAxis||(t.structureAxis==='x'?dy===0:dx===0))&&adjacent?.[mode]&&!buried(adjacent)&&networkEdgeAllowed(t,adjacent,dx,dy,mode,game,x,y);});
  }
  function tunnelPortal(c,x,y,t,mode){
    const cx=(x+.5)*TILE,cy=(y+.5)*TILE;
    // Only the short exposed approaches belong in the ground layer. Stone
    // mouths are upright objects, depth-sorted with buildings and vehicles.
    for(const [dx,dy]of portalArms(x,y,t,mode)){
      const mouthX=cx+dx*6,mouthY=cy+dy*6;
      line(c,[[mouthX,mouthY],[cx+dx*16,cy+dy*16]],mode==='road'?'#b5a587':'#b6b698',mode==='road'?18:11);
      line(c,[[mouthX,mouthY],[cx+dx*16,cy+dy*16]],mode==='road'?'#696963':'#79775f',mode==='road'?12:7);
      if(mode==='rail')for(const o of [-2.4,2.4])line(c,[[mouthX+dy*o,mouthY-dx*o],[cx+dx*16+dy*o,cy+dy*16-dx*o]],'#d4d7c6',1.1);
    }
  }
  function network(c,x,y,t,mode,elevated=false){
    if(!t[mode])return;const px=x*TILE,py=y*TILE,cx=px+16,cy=py+16;
    const neighbors=[[0,-1],[1,0],[0,1],[-1,0]].filter(([dx,dy])=>{
      const adjacent=tile(x+dx,y+dy);if(!adjacent?.[mode])return false;
      return networkEdgeAllowed(t,adjacent,dx,dy,mode,game,x,y);
    });
    const isolatedAxis=t.structureAxis||(!neighbors.length?networkTerrainShape(game,x,y).axis:null);
    const arms=neighbors.length?neighbors:isolatedAxis==='x'?[[-1,0],[1,0]]:[[0,-.48],[0,.48]];
    if(buried(t)){tunnelPortal(c,x,y,t,mode);return;}
    const bridge=t.terrain==='water'||t.bridge;const tunnel=!bridge&&(t.terrain==='mountain'||t.tunnel);
    const textured=!tunnel&&hasRasterTransport('infra:'+mode+(bridge?'-bridge':''));
    const points=arms.map(([dx,dy])=>[cx+dx*16,cy+dy*16]);
    c.lineCap='butt';c.lineJoin='round';
    const stroke=(color,width)=>{for(const p of points)line(c,[[cx,cy],p],color,width);dot(c,cx,cy,width/2,color);};
    if(bridge){
      if(!elevated){const clearance=t.structureLevel?Math.max(1,t.structureLevel-terrainLevel(t)):1,drop=Math.min(18,4+clearance*2);
      c.save();c.translate(3+drop*.3,drop);stroke('#203c4840',18);c.restore();
      if(t.structureLevel){
        // Visible southeast faces give land viaducts the same sense of height
        // as water crossings; the deck itself stays aligned with the route.
        c.fillStyle='#4d574a80';c.beginPath();c.moveTo(cx-4,cy+5);c.lineTo(cx+3,cy+5);c.lineTo(cx+3+drop*.3,cy+5+drop);c.lineTo(cx-4+drop*.3,cy+5+drop);c.closePath();c.fill();
        line(c,[[cx-4,cy+5],[cx-4+drop*.3,cy+5+drop]],'#c4bea0',2.5);
        line(c,[[cx-5+drop*.3,cy+5+drop],[cx+5+drop*.3,cy+5+drop]],'#626b5680',3);
      }
      }stroke('#b7b4a0',17);stroke('#737f73',15);
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
      const sourceWidth=Math.ceil(((cx+1)*CHUNK_PIXELS+CHUNK_GUTTER)*scale)-left,sourceHeight=Math.ceil(((cy+1)*CHUNK_PIXELS+CHUNK_GUTTER)*scale)-top;
      const mesh=document.createElement('canvas'),gx=cx*CHUNK_TILES,gy=cy*CHUNK_TILES;
      const meshX=Math.floor(((gx-gy-CHUNK_TILES)*TILE-2)*scale)/scale;
      entry={sourceWidth,sourceHeight,mesh,meshX,meshY:0,bytes:0,x:left/scale,y:top/scale,revision:cachedRevision,signature:fingerprint(b)};chunks.set(key,entry);
    }
    // Crop only transparent headroom, retaining physical-pixel registration and
    // the two-pixel clip gutter. Reserving all seven height levels for every
    // flat chunk could evict visible Detail meshes and rebuild them each frame.
    let topY=Infinity,bottomY=-Infinity;
    for(let y=cy*CHUNK_TILES;y<=Math.min(game.height,(cy+1)*CHUNK_TILES);y++)for(let x=cx*CHUNK_TILES;x<=Math.min(game.width,(cx+1)*CHUNK_TILES);x++){
      const p=projectGround(game,x,y);topY=Math.min(topY,p.y);bottomY=Math.max(bottomY,p.y);
    }
    const meshTop=Math.floor((topY-2)*scale),meshBottom=Math.ceil((bottomY+2)*scale),meshWidth=Math.ceil((CHUNK_PIXELS*2+4)*scale),meshHeight=meshBottom-meshTop,bytes=meshWidth*meshHeight*4;
    while(cacheBytes-entry.bytes+bytes>cacheLimit&&chunks.size>1){const oldest=chunks.keys().next().value,item=chunks.get(oldest);cacheBytes-=item.bytes;item.mesh.width=item.mesh.height=0;chunks.delete(oldest);}
    cacheBytes+=bytes-entry.bytes;entry.bytes=bytes;entry.meshY=meshTop/scale;
    if(entry.mesh.width!==meshWidth)entry.mesh.width=meshWidth;
    if(entry.mesh.height!==meshHeight)entry.mesh.height=meshHeight;
    largestSurface=Math.max(largestSurface,entry.sourceWidth,entry.sourceHeight,meshWidth,meshHeight);
    // Only the projected mesh is retained. Its source is scratch space shared
    // by all chunks, avoiding a second large bitmap per visible Retina tile.
    if(terrainSourceCanvas.width!==entry.sourceWidth||terrainSourceCanvas.height!==entry.sourceHeight){terrainSourceCanvas.width=entry.sourceWidth;terrainSourceCanvas.height=entry.sourceHeight;}
    const c=terrainSourceCanvas.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,entry.sourceWidth,entry.sourceHeight);c.scale(scale,scale);c.translate(-entry.x,-entry.y);c.imageSmoothingEnabled=false;
    drawGround(c,b);
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y),occupied=(layers.buildings&&siteAt(x,y))||terrainSiteAt(x,y);
      if(layers.zones&&t.zone&&!occupied){const color=t.zone==='residential'?'#e6e9b5':t.zone==='commercial'?'#c0d9db':'#e3c795';c.fillStyle=color+'45';c.fillRect(x*TILE+2,y*TILE+2,28,28);c.strokeStyle=color+'b0';c.lineWidth=.7;c.setLineDash([3,3]);c.strokeRect(x*TILE+3,y*TILE+3,26,26);c.setLineDash([]);}
      if(!t.bridge&&t.terrain!=='water')for(const mode of ['road','rail'])if(layers[mode==='road'?'roads':'rails']&&!bridgeApproaches(x,y,t,mode).length)network(c,x,y,t,mode);
    }
    const m=entry.mesh.getContext('2d');m.setTransform(1,0,0,1,0,0);m.clearRect(0,0,entry.mesh.width,entry.mesh.height);m.scale(scale,scale);m.translate(-entry.meshX,-entry.meshY);m.imageSmoothingEnabled=true;m.imageSmoothingQuality='low';
    drawTerrainMesh(m,{game,canvas:terrainSourceCanvas,sourceX:entry.x,sourceY:entry.y,sourceScale:scale,bounds:{x0:cx*CHUNK_TILES,y0:cy*CHUNK_TILES,x1:(cx+1)*CHUNK_TILES,y1:(cy+1)*CHUNK_TILES}});
    composedChunks++;return entry;
  }
  function drawWorld(x0,y0,x1,y1){
    // Keep a whole visible frame resident instead of reducing raster quality.
    // Budget grows with the viewport, bounded even on a huge map. At 4K/DPR2
    // Detail this includes its border chunks without repeatedly evicting them.
    const across=Math.ceil(x1/CHUNK_TILES)-Math.floor(x0/CHUNK_TILES),down=Math.ceil(y1/CHUNK_TILES)-Math.floor(y0/CHUNK_TILES);
    const frameBytes=across*down*Math.ceil((CHUNK_PIXELS*2+4)*rasterScale)*Math.ceil((CHUNK_PIXELS+MAX_HEIGHT*HEIGHT_STEP+4)*rasterScale)*4;
    cacheLimit=Math.min(CACHE_MAX,Math.max(CACHE_BASE,Math.ceil(frameBytes*1.1)));
    while(cacheBytes>cacheLimit&&chunks.size){const oldest=chunks.keys().next().value,item=chunks.get(oldest);cacheBytes-=item.bytes;item.mesh.width=item.mesh.height=0;chunks.delete(oldest);}
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='low';
    for(let cy=Math.floor(y0/CHUNK_TILES);cy<Math.ceil(y1/CHUNK_TILES);cy++)for(let cx=Math.floor(x0/CHUNK_TILES);cx<Math.ceil(x1/CHUNK_TILES);cx++){if(!visible(cx*CHUNK_TILES+CHUNK_TILES/2-.5,cy*CHUNK_TILES+CHUNK_TILES/2-.5,CHUNK_PIXELS*camera.zoom+80))continue;const entry=drawChunk(cx,cy,rasterScale);ctx.drawImage(entry.mesh,entry.meshX,entry.meshY,entry.mesh.width/rasterScale,entry.mesh.height/rasterScale);}
  }
  function bridgeApproaches(x,y,t,mode){
    if(!t[mode]||t.bridge||t.terrain==='water'||buried(t))return [];
    return [[-1,0],[1,0],[0,-1],[0,1]].filter(([dx,dy])=>{const n=tile(x+dx,y+dy);return n?.bridge&&n[mode]&&networkEdgeAllowed(t,n,dx,dy,mode,game,x,y);});
  }
  function drawBridgeApproach(x,y,t,mode,directions){
    // Keep the authored road/rail texture, but lift its shore-facing edge to
    // the deck. Baking this on the riverbank would leave a road below the bridge.
    const size=Math.ceil((TILE+4)*rasterScale);
    if(approachCanvas.width!==size)approachCanvas.width=approachCanvas.height=size;
    const c=approachCanvas.getContext('2d'),sourceX=x*TILE-2,sourceY=y*TILE-2;
    c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,size,size);c.scale(rasterScale,rasterScale);c.translate(-sourceX,-sourceY);network(c,x,y,t,mode);
    const surface=tileSurface(game,x,y);
    for(const [dx,dy]of directions){
      const height=bridgeDeckHeight(game,x+dx,y+dy,mode),edge=dx===1?[surface.ne,surface.se]:dx===-1?[surface.nw,surface.sw]:dy===1?[surface.sw,surface.se]:[surface.nw,surface.ne];
      for(const p of edge)Object.assign(p,projectTerrainPoint(p.u,p.v,height));
    }
    // Engineered approaches keep the road at ground height at the bank's
    // center, then climb to the deck at its edge, matching vehicle movement.
    surface.triangles=surface.corners.map((p,i)=>[p,surface.corners[(i+1)%4],surface.center]);
    paintTerrainTile(ctx,approachCanvas,{game,x,y,surface,sourceX,sourceY,sourceScale:rasterScale,shade:false});
  }
  function drawRaisedNetwork(x,y,t,mode){
    const h=transportHeight(game,x,y,mode),base=projectTile(x,y),deck=transportPoint(x,y,mode),drop=base.y-deck.y;
    bridgeHits.push({x,y,height:h,axis:bridgeSurface(game,x,y,mode)?.axis||t.structureAxis||'y'});
    if(drop>2){
      ctx.fillStyle='#293e3935';ctx.beginPath();ctx.ellipse(base.x+3,base.y+2,11,4,0,0,TAU);ctx.fill();
      for(const side of [-5,5]){line(ctx,[[deck.x+side,deck.y+2],[base.x+side,base.y]],side<0?'#9b9e85':'#68735f',3);line(ctx,[[base.x+side-3,base.y],[base.x+side+3,base.y]],'#68735f',2);}
    }
    ctx.save();ctx.translate(0,-h*HEIGHT_STEP);groundTransform(ctx);network(ctx,x,y,t,mode,true);ctx.restore();
  }
  function drawFoundation(x,y,span){
    const height=foundationHeight(x,y,span),top=(u,v)=>{const p=projectPoint(u*TILE,v*TILE);p.y-=height*HEIGHT_STEP;return p;};
    const entry=foundations.get((y*game.width+x)*4+span);
    if(entry.paths){for(const {path,color} of entry.paths){ctx.fillStyle=color;ctx.fill(path);}return;}
    const corners=[[x,y],[x+span,y],[x+span,y+span],[x,y+span]],heights=corners.map(([u,v])=>surfaceHeight(game,u,v));
    entry.paths=[];
    if(height-Math.min(...heights)<.06)return;
    const surface=new Path2D();corners.forEach(([u,v],i)=>{const p=top(u,v);i?surface.lineTo(p.x,p.y):surface.moveTo(p.x,p.y);});surface.closePath();
    entry.paths.push({path:surface,color:game.biome==='desert'?'#c7b58d':game.biome==='tundra'?'#bfc9b9':'#9caa85'});
    for(const side of [0,1]){
      const edge=Array.from({length:span+1},(_,n)=>side?[x+n,y+span]:[x+span,y+n]);
      const path=new Path2D();
      edge.forEach(([u,v],i)=>{const p=top(u,v);i?path.lineTo(p.x,p.y):path.moveTo(p.x,p.y);});
      for(const [u,v]of edge.toReversed()){const p=projectGround(game,u,v);path.lineTo(p.x,p.y);}
      path.closePath();entry.paths.push({path,color:side?'#8d947d':'#727d6b'});
    }
    for(const {path,color} of entry.paths){ctx.fillStyle=color;ctx.fill(path);}
  }
  function visibleFlat(x,y,margin=70){
    const origin=cameraPoint(),sx=((x-y)*TILE-origin.x)*camera.zoom+W/2,sy=((x+y+1)*TILE/2-origin.y)*camera.zoom+H/2;
    return sx>-margin&&sx<W+margin&&sy>-margin&&sy<H+margin+MAX_HEIGHT*HEIGHT_STEP*camera.zoom;
  }
  function visible(x,y,margin=70){
    // Reject distant objects before asking the local height cache to sample
    // their terrain. Whole-world label lists must not populate remote chunks.
    if(!visibleFlat(x,y,margin))return false;
    const p=worldToScreen(x,y);return p.x>-margin&&p.y>-margin&&p.x<W+margin&&p.y<H+margin;
  }
  function drawCar(v,route,x,y,worldAngle,engine){
    if(isUndergroundAt(game,x,y))return;
    const p=transportPoint(x,y,route?.mode),angle=projectAngle(worldAngle),train=route?.mode==='rail';
    ctx.save();ctx.translate(p.x,p.y);
    if(!vehicleSprites.draw(ctx,v,route,{engine,heading:angle})){
      ctx.rotate(angle);
      ctx.fillStyle='#263c35';roundRect(ctx,-9,-4.5,18,9,2);ctx.fill();ctx.fillStyle=route?.color||'#c78753';roundRect(ctx,-8,-3.5,16,7,2);ctx.fill();
      ctx.fillStyle='#e9ddbd';ctx.fillRect(-6,-2.5,10,5);ctx.fillStyle='#426878';ctx.fillRect(4,-2.5,2,5);
      if(train&&engine){ctx.fillStyle='#526361';ctx.fillRect(-2,-2,4,4);}
    }
    ctx.restore();
  }
  function ship(v,route){const p=transportPoint(v.x,v.y,'water');ctx.drawImage(marine.ship({...v,angle:projectAngle(v.angle||0)},route),p.x-MARINE_SIZE/2,p.y-MARINE_SIZE/2,MARINE_SIZE,MARINE_SIZE);}
  function billboard(image,x,y,w,h,tx,ty){
    if(!visibleRectangle(x,y,w,h))return;
    ctx.drawImage(image,x,y,w,h);
    if(capturedBillboards){capturedBillboards.push({image,x,y,w,h,tx,ty,world:true});return;}
    const origin=cameraPoint();
    objectHits.push({image,x:(x-origin.x)*camera.zoom+W/2,y:(y-origin.y)*camera.zoom+H/2,w:w*camera.zoom,h:h*camera.zoom,tx,ty});
  }
  function visibleRectangle(x,y,w,h){
    // Retain the filtering gutter at fractional display densities. The scene's
    // broad anchor margin keeps tall objects available; actual sprite bounds
    // avoid submitting fully clipped images around the edge of a dense view.
    const b=sceneViewBounds;return !b||x+w>b.left-2&&x<b.right+2&&y+h>b.top-2&&y<b.bottom+2;
  }
  function drawScene(b,routesById){
    objectHits=[];bridgeHits=[];
    const origin=cameraPoint(),key=[camera.zoom,rasterScale,W,H].join(','),frameTime=performance.now();
    if(lastSceneCamera&&(lastSceneCamera.x!==origin.x||lastSceneCamera.y!==origin.y||lastSceneCamera.key!==key))lastCameraMotion=frameTime;
    lastSceneCamera={x:origin.x,y:origin.y,key};sceneryWaitingForCamera=frameTime-lastCameraMotion<sceneryPanSettleMs;
    sceneViewBounds={left:origin.x-W/(2*camera.zoom),right:origin.x+W/(2*camera.zoom),top:origin.y-H/(2*camera.zoom),bottom:origin.y+H/(2*camera.zoom)};
    const reused=sceneCache?.key===key&&Math.abs(origin.x-sceneCache.x)<=SCENE_PAN_MARGIN&&Math.abs(origin.y-sceneCache.y)<=SCENE_PAN_MARGIN;
    let objects=reused?sceneCache.objects:[],shadows=reused?sceneCache.shadows:[],cullPoint=null;
    const add=(x,y,draw,priority=0,bounds=null)=>objects.push({depth:x+y,x,priority,draw,point:cullPoint,bounds});
    const spriteBounds=(x,y,w,h)=>({left:x,top:y,right:x+w,bottom:y+h});
    const siteBounds=(x,y,span,center)=>{const b=spriteBounds(center.x-24*span,center.y-36*span-12,48*span,48*span+12);for(let n=0;n<=span;n++)for(const [u,v]of [[x+n,y],[x+n,y+span],[x,y+n],[x+span,y+n]]){const p=projectGround(game,u,v);b.left=Math.min(b.left,p.x);b.right=Math.max(b.right,p.x);b.top=Math.min(b.top,p.y);b.bottom=Math.max(b.bottom,p.y);}return b;};
    const addShadow=draw=>shadows.push({draw,point:cullPoint});
    const compare=(a,b)=>a.depth-b.depth||a.x-b.x||a.priority-b.priority;
    if(!reused){
    // Keep a small world-space border so a drag reuses the same scenery and
    // depth order. Cull individual anchors below; no extra objects are drawn.
    b=visibleBounds(SCENE_PAN_MARGIN);
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      if(!visible(x,y,(180+SCENE_PAN_MARGIN)*camera.zoom))continue;
      const t=tile(x,y),id=y*game.width+x,ind=industryIndex.get(id),st=stationIndex.get(id),p=projectTile(x,y),occupied=layers.buildings&&(ind||buildingSiteAt(x,y)),nature=terrainSiteAt(x,y);
      cullPoint=p;
      if(nature&&!occupied&&nature.x===x&&nature.y===y&&(nature.object.kind!=='forest'||layers.trees)){
        const object=nature.object,span=terrainObjectSize(object),center=projectTile(x+(span-1)/2,y+(span-1)/2),layout=natureObjectLayout(span),detail=!layers.trees&&object.detail==='wooded-foothill'?'bare-foothill':object.detail;
        if(object.kind==='forest')addShadow(()=>drawRasterTreeShadows(ctx,{biome:game.biome,detail,variant:object.variant||0,footprint:span,x:center.x-layout.anchorX,y:center.y-layout.anchorY,pixelScale:rasterScale,viewBounds:sceneViewBounds,preparedState:true}));
        add(x+span-1,y+span-1,()=>billboard(sprite(object.kind,object.variant||0,1,detail,span),center.x-layout.anchorX,center.y-layout.anchorY,layout.width,layout.height,x,y),0,spriteBounds(center.x-layout.anchorX,center.y-layout.anchorY,layout.width,layout.height));
      }
      if(!nature&&LANDMARKS.has(t.terrain)&&(t.terrain!=='forest'||layers.trees)&&!occupied&&(!t.road||!layers.roads||isEngineeredTunnel(t))&&(!t.rail||!layers.rails||isEngineeredTunnel(t))&&(!t.zone||!layers.zones)&&groundIsFlat(game,x,y)){
        const forest=t.terrain==='forest',variant=natureVariant(x,y,t),density=natureDensity(x,y,t);
        if(forest&&density)addShadow(()=>drawRasterTreeShadows(ctx,{biome:game.biome,detail:t.detail,variant,density,x:p.x-16,y:p.y-24,pixelScale:rasterScale,viewBounds:sceneViewBounds,preparedState:true}));
        if(density)add(x,y,()=>{ctx.globalAlpha=forest?.94:1;billboard(sprite(t.terrain,variant,density,!layers.trees&&t.detail==='wooded-foothill'?'bare-foothill':t.detail),p.x-(forest?24:16),p.y-(forest?40:30),forest?48:32,forest?48:40,x,y);ctx.globalAlpha=1;},0,spriteBounds(p.x-(forest?24:16),p.y-(forest?40:30),forest?48:32,forest?48:40));
      }
      if(!nature&&!LANDMARKS.has(t.terrain)&&t.terrain!=='mountain'&&t.terrain!=='water'&&!occupied&&(!t.road||!layers.roads||isEngineeredTunnel(t))&&(!t.rail||!layers.rails||isEngineeredTunnel(t))&&(!t.zone||!layers.zones)&&groundIsFlat(game,x,y)){
        const scenery=landscapeScenery(game.biome,game.seed||0,x,y,t);
        // Stones and plants are already authored from the fixed camera. Keep
        // them upright; baking stones into ground would project them twice.
        if(scenery&&(scenery.kind==='stone'||layers.trees))add(x,y,()=>{if(!visibleRectangle(p.x-16,p.y-28,32,40))return;ctx.globalAlpha=scenery.alpha;ctx.drawImage(sprite('terrain-detail',natureVariant(x,y,t),1,scenery.detail),p.x-16,p.y-28,32,40);ctx.globalAlpha=1;},0,spriteBounds(p.x-16,p.y-28,32,40));
      }
      if(layers.buildings&&t.building){const variant=t.variant??x*13+y,level=t.building.level||1,legacy=t.building.kind,kind=['house','apartment'].includes(legacy)?residentialKind(variant,level):['shop','office'].includes(legacy)?commercialKind(variant,level):legacy,span=buildingSize(t.building),center=foundationPoint(x,y,span);add(x+span-1,y+span-1,()=>{drawFoundation(x,y,span);billboard(uprightSprite(kind,variant,level,'',span),center.x-24*span,center.y-36*span-12,48*span,48*span+12,x,y);},0,()=>siteBounds(x,y,span,center));}
      if(layers.buildings&&ind&&ind.x===x&&ind.y===y){const span=industrySize(ind),center=foundationPoint(x,y,span);add(x+span-1,y+span-1,()=>{drawFoundation(x,y,span);billboard(uprightSprite(ind.kind,x+y,span),center.x-24*span,center.y-36*span-12,48*span,48*span+12,x,y);},0,()=>siteBounds(x,y,span,center));}
      for(const mode of ['road','rail'])if(t[mode]&&layers[mode==='road'?'roads':'rails']){
        if(t.bridge||t.terrain==='water')add(x+.05,y+.05,()=>drawRaisedNetwork(x,y,t,mode));
        else{const approaches=bridgeApproaches(x,y,t,mode);if(approaches.length)add(x+.05,y+.05,()=>drawBridgeApproach(x,y,t,mode,approaches));}
      }
      if(layers.stations&&st){
        if(st.mode==='water'){const [dx,dy]=portLandDirection(x,y);add(x,y,()=>infrastructureSprites.port(ctx,dx,dy,p.x,p.y));}
        else add(x+.12,y+.12,()=>infrastructureSprites.stop(ctx,st.mode,p.x+11,p.y+2));
      }
      if(buried(t))for(const mode of ['road','rail'])if(t[mode]&&layers[mode==='road'?'roads':'rails'])for(const [dx,dy]of portalArms(x,y,t,mode)){
        const mouth=projectTile(x+dx*.18,y+dy*.18);add(x+dx*.18,y+dy*.18,()=>infrastructureSprites.portal(ctx,mode,dx,dy,mouth.x,mouth.y),2);
      }

    }
    objects.sort(compare);
    sceneryBudget.clear();
    sceneCache={key,x:origin.x,y:origin.y,objects,shadows,groups:null,shadow:null,batchPlanReady:false,readyGroups:0};sceneBuilds++;
    }
    const staticObjects=objects;objects=[];cullPoint=null;
    if(layers.vehicles)for(const v of frameVehicles){
      const route=routesById.get(v.routeId);if(route?.mode==='water'||!visible(v.x,v.y,100*camera.zoom))continue;
      if(route?.mode==='rail'&&route.path?.length>1){
        const path=route.path,max=path.length-1,direction=v.direction||1;
        for(const offset of [34/TILE,17/TILE]){const position=Math.max(0,Math.min(max,(v.progress||0)-offset*direction)),index=Math.min(Math.floor(position),max-1),f=position-index,a=path[index],z=path[index+1],x=a.x+(z.x-a.x)*f,y=a.y+(z.y-a.y)*f,angle=Math.atan2((z.y-a.y)*direction,(z.x-a.x)*direction);add(x,y,()=>drawCar(v,route,x,y,angle,false),1);}
      }
      add(v.x,v.y,()=>drawCar(v,route,v.x,v.y,Number.isFinite(v.angle)?v.angle:0,route?.mode==='rail'),1);
    }
    const left=origin.x-W/(2*camera.zoom)-180,right=origin.x+W/(2*camera.zoom)+180,top=origin.y-H/(2*camera.zoom)-180,bottom=origin.y+H/(2*camera.zoom)+180;
    const inView=object=>object.point.x>left&&object.point.x<right&&object.point.y>top&&object.point.y<bottom;
    ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    if(sceneCache.shadow){const s=sceneCache.shadow;ctx.drawImage(s.image,s.x,s.y,s.image.width/rasterScale,s.image.height/rasterScale);}
    else for(const shadow of shadows)if(inView(shadow))shadow.draw();
    ctx.restore();
    // Merge vehicles into the exact original depth order. A group crossed by
    // any moving object falls back to its entries; complete stationary runs
    // are a single native-pixel blit, with the original sprite picking masks.
    objects.sort(compare);let moving=0;sceneryBatchDraws=0;sceneryDirectDraws=0;
    const drawOriginal=object=>{while(moving<objects.length&&compare(objects[moving],object)<0)objects[moving++].draw();if(inView(object)){object.draw();sceneryDirectDraws++;}};
    if(!sceneCache.readyGroups){
      // While dragging a fresh view, this is the original linear static merge.
      // Do not add group traversal or speculative raster work to panning.
      for(const object of staticObjects){while(moving<objects.length&&compare(objects[moving],object)<0)objects[moving++].draw();if(inView(object)){object.draw();sceneryDirectDraws++;}}
    }else for(const group of sceneCache.groups){
      const first=group.objects[0],last=group.objects.at(-1);
      if(!first)continue;
      while(moving<objects.length&&compare(objects[moving],first)<0)objects[moving++].draw();
      if(group.image&&!visibleRectangle(group.x,group.y,group.image.width/rasterScale,group.image.height/rasterScale))continue;
      if(!group.image||(moving<objects.length&&compare(objects[moving],last)<0)||!group.objects.every(object=>inView(object)||!visibleRectangle(object.bounds.left,object.bounds.top,object.bounds.right-object.bounds.left,object.bounds.bottom-object.bounds.top))){for(const object of group.objects)drawOriginal(object);continue;}
      ctx.drawImage(group.image,group.x,group.y,group.image.width/rasterScale,group.image.height/rasterScale);sceneryBatchDraws++;
      for(const hit of group.hits)if(visibleRectangle(hit.x,hit.y,hit.w,hit.h))objectHits.push(hit);
    }
    while(moving<objects.length)objects[moving++].draw();
    sceneryPreparationMs=0;if(sceneryBatching&&!sceneryWaitingForCamera)warmSceneBatches(sceneCache);
  }
  function prepareSceneBatches(scene){
    const view={left:scene.x-W/(2*camera.zoom),right:scene.x+W/(2*camera.zoom),top:scene.y-H/(2*camera.zoom),bottom:scene.y+H/(2*camera.zoom)};
    for(const object of scene.objects)if(typeof object.bounds==='function')object.bounds=object.bounds();
    scene.groups=partitionScenery(scene.objects,rasterScale);scene.batchPlanReady=true;
    // Stage the shadow layer off screen. Until every shadow is painted the
    // ordinary pass stays visible, so incremental preparation cannot flicker.
    if(scene.shadows.length>8)scene.shadowPreparation={index:0,surface:null,bounds:{left:view.left-SCENE_PAN_MARGIN,top:view.top-SCENE_PAN_MARGIN,right:view.right+SCENE_PAN_MARGIN,bottom:view.bottom+SCENE_PAN_MARGIN}};
    const distance=group=>{const b=group.bounds;return b?Math.max(0,view.left-b.right,b.left-view.right)**2+Math.max(0,view.top-b.bottom,b.top-view.bottom)**2:Infinity;};
    scene.pendingGroups=scene.groups.filter(group=>group.bounds&&group.objects.length>=4&&distance(group)<=(SCENE_PAN_MARGIN+96)**2).sort((a,b)=>distance(a)-distance(b));
    scene.pendingIndex=0;
  }
  function warmSceneBatches(scene){
    if(scene.batchPlanReady&&!scene.shadowPreparation&&scene.pendingIndex>=scene.pendingGroups.length)return;
    const start=performance.now(),deadline=start+sceneryPrepareBudgetMs,target=ctx,view=sceneViewBounds,hits=objectHits;
    if(!scene.batchPlanReady)prepareSceneBatches(scene);
    // Pixel-aligned origins preserve the original sprite filtering, including
    // fractional DPRs. Each strip has at most 32 entries and a capped area.
    const allocate=(bounds,smooth=target.imageSmoothingEnabled,quality=target.imageSmoothingQuality)=>{
      const left=Math.floor(bounds.left*rasterScale)-2,top=Math.floor(bounds.top*rasterScale)-2;
      const right=Math.ceil(bounds.right*rasterScale)+2,bottom=Math.ceil(bounds.bottom*rasterScale)+2;
      const image=sceneryBudget.allocate(right-left,bottom-top);if(!image)return null;
      const context=image.getContext('2d');context.setTransform(rasterScale,0,0,rasterScale,-left,-top);context.imageSmoothingEnabled=smooth;context.imageSmoothingQuality=quality;
      return{image,context,x:left/rasterScale,y:top/rasterScale,hits:[]};
    };
    try{
      const shadow=scene.shadowPreparation;
      if(shadow){
        shadow.surface||=allocate(shadow.bounds,true,'high');
        if(!shadow.surface)scene.shadowPreparation=null;
        else{
          ctx=shadow.surface.context;sceneViewBounds=null;
          // Time checks also split this potentially thousands-of-trees loop.
          while(shadow.index<scene.shadows.length&&performance.now()<deadline)scene.shadows[shadow.index++].draw();
          if(shadow.index===scene.shadows.length){scene.shadow=shadow.surface;scene.shadowPreparation=null;sceneryBatchBuilds++;}
        }
      }
      while(!scene.shadowPreparation&&scene.pendingIndex<scene.pendingGroups.length&&performance.now()<deadline){
        const group=scene.pendingGroups[scene.pendingIndex++],surface=allocate(group.bounds);
        if(!surface)continue;
        ctx=surface.context;sceneViewBounds=null;capturedBillboards=surface.hits;
        for(const object of group.objects)object.draw();
        capturedBillboards=null;Object.assign(group,surface);scene.readyGroups++;sceneryBatchBuilds++;
      }
    }finally{capturedBillboards=null;ctx=target;sceneViewBounds=view;objectHits=hits;sceneryPreparationMs=performance.now()-start;}
  }
  function validPreview(tool,p,preferredMode='road'){
    tool=resolveBuildTool(game,tool,p.x,p.y,{preferredMode});
    const t=tile(p.x,p.y);if(!t)return false;if(tool==='inspect')return true;
    if(tool==='raise'||tool==='lower'||tool==='level')return game.money>=priceFor(game,BUILD_COSTS[tool]||0)&&!terraformProblem(game,tool,p.x,p.y);
    // The model's own predicate, so a highlight can never promise what build() refuses.
    return !buildProblem(game,tool,p.x,p.y);
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
    if(!image){image=new Image();image.onload=()=>options.onInvalidate?.();image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(cargoIcon(kind,{decorative:true}).replace('width="32" height="32"',`width="${pixels}" height="${pixels}"`))}`;cargoImages.set(key,image);}
    return image;
  }
  // A load badge's display-pixel box above its carrier, shared by drawing and picking.
  function badgeRect(v,route){
    const p=vehicleToScreen(v.x,v.y,route.mode),fraction=Math.max(0,Math.min(1,(v.load||0)/Math.max(1,v.capacity||1)));
    const state=fraction<=.00001?'empty':fraction>=.99999?'full':'partial',size=detailLevel==='detail'?22:18,w=state==='empty'?24:size+8,h=state==='empty'?11:size+13;
    return {p,fraction,state,size,w,h,x:Math.round(p.x-w/2),y:Math.round(p.y-(route.mode==='water'?22:10)*camera.zoom-h-5)};
  }
  function vehicleLoadIndicator(v,route){
    if(!route||!visible(v.x,v.y,40)||(route.mode!=='water'&&isUndergroundAt(game,v.x,v.y)))return;
    const {p,fraction,state,size,w,h,x,y}=badgeRect(v,route);vehicleIndicatorCounts[state]++;
    ctx.globalAlpha=labelRects.some(r=>x<r.x+r.w&&x+w>r.x&&y<r.y+r.h&&y+h>r.y)?.35:1;
    // Badges use display pixels so a load remains legible at every map scale.
    // An empty carrier has only an unfilled meter; loaded carriers show cargo.
    line(ctx,[[p.x,y+h],[p.x,p.y-(route.mode==='water'?18:6)*camera.zoom]],'#475b455b',1);
    const image=state==='empty'?null:cargoImage(route.cargo||'passengers',size),loaded=Boolean(image?.complete&&image.naturalWidth);
    const key=`${dpr}:${size}:${state}:${state==='empty'?'':route.cargo||'passengers'}:${loaded}`;
    let badge=loadBadges.get(key);
    if(!badge){
      badge=document.createElement('canvas');badge.width=Math.ceil((w+2)*dpr);badge.height=Math.ceil((h+2)*dpr);
      const c=badge.getContext('2d');c.scale(dpr,dpr);c.translate(1,1);
      c.fillStyle=state==='empty'?'#f5f2e2de':'#faf6e7f5';roundRect(c,0,0,w,h,5);c.fill();
      c.strokeStyle=state==='full'?'#567b4c':state==='empty'?'#8e9c8580':'#b18c4c';c.lineWidth=1;c.stroke();
      if(state!=='empty'){if(loaded)c.drawImage(image,(w-size)/2,3,size,size);else dot(c,w/2,3+size/2,3,'#849367');}
      c.fillStyle='#d4d9c8';roundRect(c,4,h-7,w-8,3,1);c.fill();
      if(loadBadges.size>=192)loadBadges.delete(loadBadges.keys().next().value);
      loadBadges.set(key,badge);
    }
    ctx.drawImage(badge,x-1,y-1,badge.width/dpr,badge.height/dpr);
    const meterX=x+4,meterY=y+h-7,meterW=w-8;
    if(fraction>0){ctx.fillStyle=state==='full'?'#4e7747':'#bd8e43';roundRect(ctx,meterX,meterY,Math.max(1,meterW*fraction),3,1);ctx.fill();}
    ctx.globalAlpha=1;
  }
  function drawFloaters(floaters,now){
    // Paid deliveries rise above their stop and fade. Region sums each 3×3-tile cell into one figure
    // and keeps the full screen offset, because vehicle load badges do not shrink with the map.
    const region=detailLevel==='region',still=Boolean(motionPreference?.matches),shown=new Map(),format=new Intl.NumberFormat('en-US',{maximumFractionDigits:1});
    for(const f of floaters){
      const t=(now-f.born)/1600;if(!(t>=0&&t<1)||!visible(f.x,f.y))continue;
      const key=region?Math.floor(f.x/3)+','+Math.floor(f.y/3):f,group=shown.get(key);
      if(!group)shown.set(key,{x:f.x,y:f.y,revenue:f.revenue,cargo:f.cargo,t});else{group.revenue+=f.revenue;if(t<group.t)Object.assign(group,{x:f.x,y:f.y,cargo:f.cargo,t});}
    }
    ctx.font='600 12px Space, system-ui, sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
    for(const {x,y,revenue,cargo,t} of shown.values()){
      const p=worldToScreen(x,y),label='+$'+(revenue>=10000?format.format(revenue/1000)+'k':format.format(Math.round(revenue))),image=cargoImage(cargo||'passengers',14);
      const w=ctx.measureText(label).width+35,h=23,left=Math.round(p.x-w/2);let start=p.y-58*Math.max(1,camera.zoom)-h/2,ceiling=-Infinity;
      // Town names keep their place: a figure that would cover one starts above it, one below stops rising under it.
      for(const r of labelRects)if(left<r.x+r.w&&left+w>r.x){if(start<r.y+r.h&&start+h>r.y)start=r.y-h-3;else if(start>=r.y+r.h)ceiling=Math.max(ceiling,r.y+r.h+3);}
      const top=Math.round(Math.max(ceiling,start-(still?0:22*(1-(1-t)**3))));
      ctx.globalAlpha=t<.6?1:(1-t)/.4;
      ctx.shadowColor='#293d2620';ctx.shadowBlur=8;ctx.shadowOffsetY=2;ctx.fillStyle='#f7f4e7f0';roundRect(ctx,left,top,w,h,5);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
      ctx.strokeStyle='#f8f6e8b0';ctx.lineWidth=.7;ctx.stroke();
      if(image.complete&&image.naturalWidth)ctx.drawImage(image,left+8,top+(h-14)/2,14,14);else dot(ctx,left+15,top+h/2,3,'#849367');
      ctx.fillStyle='#3f6b45';ctx.fillText(label,left+27,top+h/2+.3);
    }
    ctx.globalAlpha=1;
  }
  function resourceMarker(x,y,kind,size,label,role=null){
    // Screen-space markers stay legible in Region and render at native display
    // density. SVG images are local data, cached separately from terrain chunks.
    const image=cargoImage(kind,size);
    const h=size+6,w=size+8;
    ctx.shadowColor='#293d2630';ctx.shadowBlur=5;ctx.shadowOffsetY=2;
    ctx.fillStyle='#f7f4e7f5';roundRect(ctx,x-w/2,y-h/2,w,h,7);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.strokeStyle=role?LENS_COLORS[role]:'#fbfaedf0';ctx.lineWidth=role?1.5:1;ctx.stroke();
    if(image.complete&&image.naturalWidth)ctx.drawImage(image,x-size/2,y-size/2,size,size);else dot(ctx,x,y,4,'#849367');
    if(label){
      ctx.font='500 12px Space, system-ui, sans-serif';const nameWidth=ctx.measureText(label).width+16;
      const right=x+w/2+4+nameWidth/2,left=x-w/2-4-nameWidth/2;
      pill(right+nameWidth/2>W-8?left:right,y,label,{size:12,h:28,fill:'#f7f4e7f5',color:'#3e5547',radius:5});
    }
    if(role)lensTab(x+w/2-2,y-h/2+2,role);
  }
  // Lens roles: a green up tab marks a producer, a teal down tab a buyer; a town that buys the cargo carries its icon.
  function lensTab(x,y,role){dot(ctx,x,y,8,'#fbf6e3');dot(ctx,x,y,6.6,LENS_COLORS[role]);const d=role==='source'?-1:1;ctx.beginPath();ctx.moveTo(x,y+d*3.6);ctx.lineTo(x+3.8,y-d*2);ctx.lineTo(x-3.8,y-d*2);ctx.closePath();ctx.fillStyle='#fbf6e3';ctx.fill();}
  function lensChip(x,y){
    const image=cargoImage(lens,14);ctx.shadowColor='#293d2630';ctx.shadowBlur=5;ctx.shadowOffsetY=2;ctx.fillStyle='#f7f4e7f5';roundRect(ctx,x-11,y-11,22,22,6);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.strokeStyle=LENS_COLORS.buyer;ctx.lineWidth=1.5;ctx.stroke();if(image.complete&&image.naturalWidth)ctx.drawImage(image,x-7,y-7,14,14);else dot(ctx,x,y,3,'#849367');
    if(lensStats&&x>=0&&y>=0&&x<=W&&y<=H)lensStats.towns++;
  }
  // An inspected industry reaches for its nearest targets: light dashed arcs in display pixels, beneath the labels, bowed upward.
  // Numbered bubbles match the inspector's rows; one whose arc leaves the open map, off screen or under a card, waits where it leaves.
  let contextTargets=0;
  function contextArcs(context){
    contextTargets=0;const source=context&&(game.industries||[]).find(i=>i.id===context.industryId);if(!source)return [];
    const from=industryMarker(source),covers=context.covers||[],arcs=[],dim=context.targets.some(t=>t.rank===context.highlight);
    const open=p=>p.x>=16&&p.y>=16&&p.x<=W-16&&p.y<=H-16&&!covers.some(r=>p.x>r.x-16&&p.x<r.x+r.w+16&&p.y>r.y-16&&p.y<r.y+r.h+16);
    for(const t of context.targets){
      const site=t.kind==='industry'&&(game.industries||[]).find(i=>i.id===t.id);if(t.kind==='industry'&&!site)continue;
      const to=site?industryMarker(site):(p=>({x:p.x,y:p.y-29*camera.zoom}))(worldToScreen(t.x,t.y)),dx=to.x-from.x,dy=to.y-from.y,d=Math.hypot(dx,dy);if(d<4)continue;
      const side=dx>0?-1:1,c={x:(from.x+to.x)/2-side*dy*.18,y:(from.y+to.y)/2+side*dx*.18},at=s=>({x:(1-s)**2*from.x+2*(1-s)*s*c.x+s*s*to.x,y:(1-s)**2*from.y+2*(1-s)*s*c.y+s*s*to.y});
      let bubble=open(to)&&open(at(.7))?at(.7):null;
      if(!bubble){let i=0;while(i<=48&&!open(at(i/48)))i++;const start=i/48;while(i<48&&open(at((i+1)/48)))i++;if(i<48){let a=i/48,b=(i+1)/48;for(let n=0;n<6;n++){const m=(a+b)/2;if(open(at(m)))a=m;else b=m;}bubble=at(a);}else if(i===48)bubble=at(start);}
      arcs.push({to,c,bubble,rank:t.rank,strong:t.rank===context.highlight});
    }
    for(const arc of [...arcs.filter(arc=>!arc.strong),...arcs.filter(arc=>arc.strong)]){
      ctx.globalAlpha=dim&&!arc.strong?.35:1;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.quadraticCurveTo(arc.c.x,arc.c.y,arc.to.x,arc.to.y);
      ctx.strokeStyle='#1f332a40';ctx.lineWidth=arc.strong?4:3;ctx.stroke();ctx.setLineDash(arc.strong?[]:[4,4]);ctx.strokeStyle='#f4d397';ctx.lineWidth=arc.strong?2:1.5;ctx.stroke();ctx.setLineDash([]);
    }
    ctx.globalAlpha=1;contextTargets=arcs.length;
    return arcs.filter(arc=>arc.bubble).map(arc=>({...arc.bubble,rank:arc.rank,strong:arc.strong,dim:dim&&!arc.strong}));
  }
  function contextBubble({x,y,rank,strong,dim}){
    ctx.globalAlpha=dim?.35:1;ctx.shadowColor='#293d2630';ctx.shadowBlur=5;ctx.shadowOffsetY=2;dot(ctx,x,y,8,strong?'#354b3e':'#f7f4e7f5');ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.strokeStyle='#f4d397';ctx.lineWidth=1.5;ctx.stroke();ctx.font='600 10px Space, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=strong?'#f7f4e7':'#354b3e';ctx.fillText(String(rank),x,y+.5);ctx.globalAlpha=1;
  }
  function render(now,view={}){
    lastTime=now||0;const {tool='inspect',hover=null,preview=[],selected=null,routeStops=[],preferredMode='road'}=view;
    const showGrid=typeof view.showGrid==='boolean'?view.showGrid:layers.grid,showRoutes=typeof view.showRoutes==='boolean'?view.showRoutes:layers.routes;
    ensureRevision();const routesById=new Map((game.routes||[]).map(route=>[route.id,route]));vehicleIndicatorCounts={empty:0,partial:0,full:0};
    frameVehicles.length=0;if(layers.vehicles)for(const vehicle of game.vehicles||[])if(visibleFlat(vehicle.x,vehicle.y,Math.max(70,100*camera.zoom)))frameVehicles.push(vehicle);
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);ctx.fillStyle=palette.ground;ctx.fillRect(0,0,W,H);
    ctx.save();ctx.translate(W/2,H/2);ctx.scale(camera.zoom,camera.zoom);const projectedCamera=cameraPoint();ctx.translate(-projectedCamera.x,-projectedCamera.y);
    const {x0,y0,x1,y1}=visibleBounds();
    drawWorld(x0,y0,x1,y1);
    // Water keeps one horizontal plane while land rises above it.
    ctx.save();groundTransform(ctx);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const t=tile(x,y);if(t?.terrain!=='water'||t.road||t.rail)continue;const river=t.detail==='river';const vertical=river&&[tile(x,y-1),tile(x,y+1)].filter(n=>n?.terrain==='water').length>[tile(x-1,y),tile(x+1,y)].filter(n=>n?.terrain==='water').length;drawWaterMotion(ctx,x,y,river,vertical,game.day||0,game.biome,{profile:detailLevel,seed:game.seed||0,tile});}
    if(layers.vehicles)for(const v of frameVehicles){const route=routesById.get(v.routeId);if(route?.mode==='water'&&visible(v.x,v.y))drawShipWake(ctx,v,(game.day||0)*1000,detailLevel);}
    ctx.restore();
    if(showGrid){
      const key=`${x0},${y0},${x1},${y1}`;
      if(gridCache?.key!==key){
        const path=new Path2D();
        for(let x=x0;x<=x1;x++)for(let y=y0;y<y1;y++){const a=projectGround(game,x,y),b=projectGround(game,x,y+1);path.moveTo(a.x,a.y);path.lineTo(b.x,b.y);}
        for(let y=y0;y<=y1;y++)for(let x=x0;x<x1;x++){const a=projectGround(game,x,y),b=projectGround(game,x+1,y);path.moveTo(a.x,a.y);path.lineTo(b.x,b.y);}
        gridCache={key,path};
      }
      ctx.strokeStyle=(game.biome==='taiga'?'#f2eed5':'#55604d')+(detailLevel==='region'?'16':'24');ctx.lineWidth=.65/camera.zoom;ctx.stroke(gridCache.path);
    }
    routeSegmentsConsidered=0;
    // One cached projection per route serves the overlay and a highlight drawn with the layer off.
    function routeDrawing(r,key){
      const path=r.path;let cached=routePaths.get(r);
      if(!cached||cached.path!==path||cached.length!==path.length||cached.key!==key||cached.revision!==structureRevision||cached.mode!==r.mode){
        let index=routeIndexes.get(path);
        if(!index||index.length!==path.length){index={length:path.length,spatial:createRouteRenderIndex(path)};routeIndexes.set(path,index);}
        const drawing=new Path2D();let previous=-1,count=0,segments=0;
        for(const[start,end]of index.spatial.query({x0,y0,x1,y1}))for(let i=start;i<=end;i++){
          const a=path[i-1],b=path[i];segments++;
          if(Math.max(a.x,b.x)<x0||Math.min(a.x,b.x)>=x1||Math.max(a.y,b.y)<y0||Math.min(a.y,b.y)>=y1){previous=-1;continue;}
          if(previous!==i-1){const p=transportPoint(a.x,a.y,r.mode);drawing.moveTo(p.x,p.y);}
          const edge=transportPoint((a.x+b.x)/2,(a.y+b.y)/2,r.mode),p=transportPoint(b.x,b.y,r.mode);drawing.lineTo(edge.x,edge.y);drawing.lineTo(p.x,p.y);previous=i;count++;
        }
        cached={path,length:path.length,key,revision:structureRevision,mode:r.mode,drawing,count,segments};routePaths.set(r,cached);routePathBuilds++;
        routeSegmentsConsidered+=segments;
      }
      return cached;
    }
    // A pale casing and a solid core no longer read as lane paint; Detail widens both against its wider roads.
    // Freight flow marches with the simulated day, so paused frames repeat exactly.
    function strokeRoute(r,drawing,fade=1,focus=false){
      const z=camera.zoom>1?camera.zoom/1.4:camera.zoom,offline=r.active===false;ctx.save();ctx.lineJoin=ctx.lineCap='round';ctx.strokeStyle='#fbf6e3';
      if(focus){ctx.globalAlpha=.7;ctx.lineWidth=7/z;}else{ctx.globalAlpha=.5*fade;ctx.lineWidth=5/z;}ctx.stroke(drawing);
      ctx.globalAlpha=(offline?.85:.95)*fade;ctx.strokeStyle=offline?'#d7725f':r.color||'#ce9d55';ctx.lineWidth=(focus?4:3)/z;if(offline)ctx.setLineDash([4/z,4/z]);ctx.stroke(drawing);
      if(!offline&&r.cargo!=='passengers'){ctx.globalAlpha=.8*fade;ctx.setLineDash([2/z,12/z]);ctx.lineDashOffset=-(game.day||0)*14/z;ctx.strokeStyle='#fffbe8';ctx.lineWidth=(focus?2:1.5)/z;ctx.stroke(drawing);}
      ctx.restore();
    }
    const routeKey=`${x0},${y0},${x1},${y1}`;highlightedRoute=view.highlightRoute??null;const focusRoute=highlightedRoute===null?null:routesById.get(highlightedRoute)||null;
    if(showRoutes)for(const r of game.routes||[])if(r.path?.length){const cached=routeDrawing(r,routeKey);if(cached.count)strokeRoute(r,cached.drawing,focusRoute&&r!==focusRoute?.35:1);}
    if(layers.vehicles)for(const v of frameVehicles){const route=routesById.get(v.routeId);if(route?.mode==='water'&&visible(v.x,v.y))ship(v,route);}
    drawScene({x0,y0,x1,y1},routesById);
    ctx.save();
    function surfacePath(points){ctx.beginPath();points.forEach(([u,v],i)=>{const p=projectGround(game,u,v);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.closePath();}
    function ring(x,y,radius){surfacePath(Array.from({length:80},(_,i)=>[x+.5+Math.cos(i/80*TAU)*radius,y+.5+Math.sin(i/80*TAU)*radius]));}
    // A highlighted route is restroked above the scenery, even with the routes layer off, and rings both of its stops.
    if(focusRoute?.path?.length){const cached=routeDrawing(focusRoute,routeKey);if(cached.count)strokeRoute(focusRoute,cached.drawing,1,true);for(const id of focusRoute.stops||[]){const s=(game.stations||[]).find(st=>st.id===id);if(!s)continue;ring(s.x,s.y,21/TILE);ctx.strokeStyle='#fbf6e3b3';ctx.lineWidth=5/camera.zoom;ctx.stroke();ctx.strokeStyle=focusRoute.active===false?'#d7725f':focusRoute.color||'#ce9d55';ctx.lineWidth=2.5/camera.zoom;ctx.stroke();}}
    function highlight(p,color,filled=true,span=1){
      if(!p||p.x<0||p.y<0||p.x>=game.width||p.y>=game.height)return;
      const points=[],inset=.035,edge=span-inset*2;
      for(let n=0;n<=span;n++)points.push([p.x+inset+edge*n/span,p.y+inset]);
      for(let n=1;n<=span;n++)points.push([p.x+span-inset,p.y+inset+edge*n/span]);
      for(let n=1;n<=span;n++)points.push([p.x+span-inset-edge*n/span,p.y+span-inset]);
      for(let n=1;n<span;n++)points.push([p.x+inset,p.y+span-inset-edge*n/span]);
      surfacePath(points);ctx.fillStyle=color+'26';if(filled)ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1.5/camera.zoom;ctx.stroke();
    }
    function highlightVertex(p,color){
      if(!p||!tile(p.x,p.y))return;
      const center=projectGround(game,p.x,p.y);ctx.beginPath();
      for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){
        if(p.x+dx<0||p.y+dy<0||p.x+dx>game.width||p.y+dy>game.height)continue;
        const edge=projectGround(game,p.x+dx,p.y+dy);ctx.moveTo(center.x,center.y);ctx.lineTo(edge.x,edge.y);
      }
      ctx.strokeStyle=color+'99';ctx.lineWidth=1.5/camera.zoom;ctx.stroke();
      dot(ctx,center.x,center.y,4.5/camera.zoom,'#233b32');dot(ctx,center.x,center.y,3/camera.zoom,color);
    }
    const previewSite=p=>{const site=inspectSiteAt(p.x,p.y);return (tool==='inspect'||tool==='bulldoze'&&site?.object?.kind!=='mountain')&&site?site:p;};
    const previewSpan=p=>INDUSTRIES[tool]?industryFootprint(tool):BUILDINGS[tool]?buildingFootprint(tool):siteSize(previewSite(p));
    const selectedStation=selected&&(game.stations||[]).find(s=>s.x===selected.x&&s.y===selected.y);
    const serviceCenter=['stop','bus-stop','train-stop','port'].includes(tool)?hover:selectedStation;
    if(serviceCenter){ctx.fillStyle='#eff2cd19';ctx.strokeStyle='#f3e5ad';ctx.lineWidth=1.3/camera.zoom;ctx.setLineDash([5/camera.zoom,5/camera.zoom]);ring(serviceCenter.x,serviceCenter.y,STATION_RADIUS);ctx.fill();ctx.stroke();ctx.setLineDash([]);for(const node of [...(game.cities||[]),...(game.industries||[])])if((node.kind?industryDistance(node,serviceCenter):Math.hypot(node.x-serviceCenter.x,node.y-serviceCenter.y))<=STATION_RADIUS)highlight(node,'#efe8b2',false,industrySize(node));}
    if(selected&&typeof selected.x==='number'){const site=inspectSiteAt(selected.x,selected.y);highlight(site||selected,'#fbefba',false,siteSize(site));}
    const spanTool=['bridge','railbridge','tunnel','railtunnel'].includes(tool),spanPoints=preview?.length?preview:hover?[hover]:[];
    const spanQuote=(spanTool||['road','rail','raise','lower','level','residential','commercial','industrial','bulldoze'].includes(tool))&&spanPoints.length?spanTool&&spanPoints.length<3?{ok:false,placements:[]}:quoteBuildPlan(game,tool,spanPoints,{preferredMode}):null;
    // Stroke quotes mark each placement with the running-balance state that release will meet.
    const states=spanQuote?.placements?.[0]?.state?new Map(spanQuote.placements.map(p=>[p.y*game.width+p.x,p.state])):null,refused=['road','rail'].includes(tool)&&spanQuote?.ok===false,routeTiles=tool==='bulldoze'?routeTileIndex(game):null;
    const previewValid=p=>spanQuote&&!states?spanQuote.ok===true:validPreview(tool,p,preferredMode);
    const previewColor=(p,valid)=>{const site=previewSite(p),key=site.y*game.width+site.x,state=states?.get(key);if(!state)return previewValid(p)?valid:'#d7725f';return ['blocked','slope','funds'].includes(state)?'#d7725f':refused?'#cdbfa6':routeTiles?.has(key)?'#e3aa6d':valid;};
    const earthwork=['raise','lower','level'].includes(tool),highlightPreview=(p,color)=>earthwork?highlightVertex(p,color):highlight(previewSite(p),color,tool!=='inspect',previewSpan(p));
    for(const p of preview||[])highlightPreview(p,previewColor(p,'#f2d88d'));
    if(hover)highlightPreview(hover,tool==='inspect'?'#f7efd3':previewColor(hover,'#f4d090'));
    // The keyboard cursor frames its own tile, or grid point for earthworks, in the orange of the map's focus outline;
    // the frame sits just outside the tile, so the preview colour inside still shows whether it can be built.
    if(hover?.keyboard&&tile(hover.x,hover.y)){const {x,y}=hover,o=.09;if(earthwork){const c=projectGround(game,x,y);ctx.beginPath();ctx.arc(c.x,c.y,8/camera.zoom,0,TAU);}else surfacePath([[x-o,y-o],[x+1+o,y-o],[x+1+o,y+1+o],[x-o,y+1+o]]);ctx.lineJoin='round';ctx.strokeStyle='#fbf6e3';ctx.lineWidth=4.5/camera.zoom;ctx.stroke();ctx.strokeStyle='#e17b4a';ctx.lineWidth=2.25/camera.zoom;ctx.stroke();}
    if(refused)for(const issue of spanQuote.issues)if(issue.at)highlight(issue.at,'#d7725f',false);
    for(const stop of routeStops){const s=typeof stop==='object'?stop:(game.stations||[]).find(st=>st.id===stop);if(s){ctx.strokeStyle='#f4d397';ctx.lineWidth=2/camera.zoom;ring(s.x,s.y,21/TILE);ctx.stroke();}}
    ctx.restore();ctx.restore();
    drawLighting(ctx,{game,layers,camera,dpr,artRevision:`${cachedWorldAssets}:${cachedHouseAssets}`,width:W,height:H,bounds:{x0:Math.max(0,x0-1),y0:Math.max(0,y0-1),x1,y1},industryIndex,stationIndex,routesById,vehicles:frameVehicles,project:worldToScreen,projectVehicle:vehicleToScreen,projectBuilding:buildingToScreen,projected:true});
    drawWeather(ctx,{game,layers,camera,width:W,height:H});
    if(hover&&(tool==='raise'||tool==='lower')){
      const t=tile(hover.x,hover.y);if(t){const p=gridPointToScreen(hover.x,hover.y),level=surfaceHeight(game,hover.x,hover.y),allowed=previewValid(hover);pill(p.x,p.y-28*camera.zoom,allowed?`Level ${level} → ${level+(tool==='raise'?1:-1)}`:`Level ${level}`,{size:12,h:25,fill:allowed?'#f7f1ddef':'#f5e7dfef',color:allowed?'#43573b':'#934f3f'});}
    }
    if(serviceCenter){const p=worldToScreen(serviceCenter.x,serviceCenter.y);pill(p.x,p.y-STATION_RADIUS*TILE*Math.SQRT1_2*camera.zoom-15,'5-tile reach',{size:11,h:25,fill:'#f5f3e8e8',color:'#5c7155'});}
    const contextBubbles=contextArcs(view.context);
    // Labels stay crisp at every camera zoom, with population separated from place names.
    labelRects.length=0;
    lensStats=lens?{cargo:lens,sources:0,buyers:0,towns:0}:null;const townLens=lensRole('towns',lens)==='buyer';
    if(layers.names)for(const city of game.cities||[]){if(!visible(city.x,city.y))continue;const p=worldToScreen(city.x,city.y),stops=nearbyStops(city);let y=p.y-29*camera.zoom;
      if(detailLevel==='region'){const name=city.name||'New city';ctx.font='600 11px Space, system-ui, sans-serif';const w=ctx.measureText(name).width+20;if(stops)y=clearStopSigns(stops,p.x-w/2-4,w+8,y,14,14);const box={id:city.id,x:p.x-w/2-4,y:y-14,w:w+8,h:28};if(labelRects.some(other=>box.x<other.x+other.w&&box.x+box.w>other.x&&box.y<other.y+other.h&&box.y+box.h>other.y))continue;labelRects.push(box);pill(p.x,y,name,{size:11,bold:true,h:23,fill:'#f7f5e9f0'});if(townLens)lensChip(p.x-w/2-11,y);continue;}
      ctx.font='600 13px Space, system-ui, sans-serif';const name=city.name||'New city';const nameW=ctx.measureText(name).width;const pop=populationText(city);ctx.font='500 11px Space, system-ui, sans-serif';const popW=ctx.measureText(pop).width;const w=nameW+popW+42;
      if(stops)y=clearStopSigns(stops,p.x-w/2,w,y,14,15);labelRects.push({id:city.id,x:p.x-w/2,y:y-14,w,h:29});
      ctx.shadowColor='#1b38202a';ctx.shadowBlur=10;ctx.shadowOffsetY=2;ctx.fillStyle='#f7f5e9f5';roundRect(ctx,p.x-w/2,y-14,w,29,6);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.strokeStyle='#fbfaee';ctx.lineWidth=.7;ctx.stroke();ctx.textAlign='left';ctx.textBaseline='middle';ctx.font='600 13px Space, system-ui, sans-serif';ctx.fillStyle='#314639';ctx.fillText(name,p.x-w/2+10,y+.5);ctx.fillStyle='#e6e9da';roundRect(ctx,p.x+w/2-popW-22,y-9,popW+16,19,3);ctx.fill();ctx.font='500 11px Space, system-ui, sans-serif';ctx.fillStyle='#60705a';ctx.fillText(pop,p.x+w/2-popW-14,y+.5);
      if(townLens)lensChip(p.x-w/2-13,y);
    }
    // A cargo lens draws its producers and buyers last, at full strength with a role tab and, from Town view in, their names; other sites recede to half strength.
    const industryBadge=(ind,role)=>{const marker=industryMarker(ind),kind=Object.keys(INDUSTRIES[ind.kind]?.outputs||{})[0]||'goods',hovered=hover&&industryContains(ind,hover.x,hover.y),chosen=selected&&industryContains(ind,selected.x,selected.y),label=layers.names&&(hovered||chosen||role&&detailLevel!=='region')?ind.name||titleCase(ind.kind):null;if(role&&marker.x>=0&&marker.y>=0&&marker.x<=W&&marker.y<=H)lensStats[role==='source'?'sources':'buyers']++;ctx.globalAlpha=lens&&!role&&!hovered&&!chosen?.5:1;if(layers.industryIcons)resourceMarker(marker.x,marker.y,kind,marker.size,label,role);else if(label)pill(marker.x,marker.y,label,{size:12,h:28,fill:'#f7f4e7f5',color:'#3e5547',radius:5});ctx.globalAlpha=1;};
    const lensSites=[];for(const ind of game.industries||[]){if((!layers.names&&!layers.industryIcons)||!visible(ind.x,ind.y,180*camera.zoom))continue;const role=lensRole(ind.kind,lens);if(role)lensSites.push([ind,role]);else industryBadge(ind,null);}for(const [ind,role] of lensSites)industryBadge(ind,role);
    for(const bubble of contextBubbles)contextBubble(bubble);
    if(layers.stations)for(const st of game.stations||[]){if(!visible(st.x,st.y))continue;const marker=stationMarker(st),mx=marker.x,my=marker.y;ctx.fillStyle=st.mode==='water'?'#376e7e':st.mode==='rail'?'#3f655a':'#516d53';roundRect(ctx,mx,my,14,14,3);ctx.fill();if(st.mode==='water'){ctx.strokeStyle='#f0eacb';ctx.lineWidth=1.1;ctx.beginPath();ctx.arc(mx+7,my+3.5,1.2,0,TAU);ctx.stroke();line(ctx,[[mx+7,my+4.7],[mx+7,my+11]],'#f0eacb',1.1);line(ctx,[[mx+4,my+6],[mx+10,my+6]],'#f0eacb',1.1);ctx.beginPath();ctx.moveTo(mx+3,my+8);ctx.quadraticCurveTo(mx+3,my+11,mx+7,my+11);ctx.quadraticCurveTo(mx+11,my+11,mx+11,my+8);ctx.stroke();}else{ctx.fillStyle='#f0eacb';ctx.font='bold 9px Space, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(st.mode==='rail'?'T':'B',mx+7,my+7.2);}}
    // A chosen carrier is ringed in display pixels beneath its load badge, instead of a tile outline, and stays marked in a tunnel.
    const chosenVehicle=view.selectedVehicleId==null?null:frameVehicles.find(v=>v.id===view.selectedVehicleId);if(chosenVehicle){const route=routesById.get(chosenVehicle.routeId),p=vehicleToScreen(chosenVehicle.x,chosenVehicle.y,route?.mode),r=route?.mode==='water'?Math.max(20,20*camera.zoom):Math.max(11,14*camera.zoom);ctx.beginPath();ctx.arc(p.x,p.y-2*camera.zoom,r,0,TAU);ctx.strokeStyle='#26372e4d';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='#fbefba';ctx.lineWidth=2;ctx.stroke();}
    if(layers.vehicles&&layers.vehicleLoads)for(const v of frameVehicles)vehicleLoadIndicator(v,routesById.get(v.routeId));
    // An offline route pins its first gap, above the load badges of vehicles stuck beside it, so the fix is found on the map rather than in a toast.
    routeBreaks=0;for(const r of game.routes||[])if(r.active===false&&r.path?.length&&(showRoutes||r===focusRoute)){const at=routeBreak(r);if(!at||!visible(at.x,at.y))continue;const p=worldToScreen(at.x,at.y);routeBreaks++;dot(ctx,p.x,p.y,6,'#fbf6e3');dot(ctx,p.x,p.y,4,'#d7725f');pill(p.x,p.y-24,'Connection broken',{size:11,h:23,fill:'#f5e7dfef',color:'#934f3f'});}
    if(layers.deliveries&&view.floaters?.length)drawFloaters(view.floaters,now);
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
      minimapWords[y*width+x]=layers.buildings&&(t.building||buildingAt(game,tx,ty))?colors.building:layers.rails&&t.rail?colors.rail:layers.roads&&t.road?colors.road:layers.zones&&t.zone?colors.zone:terrain==='water'?colors.water:terrain==='forest'?colors.forest:terrainOverviewColor(game,tx,ty);
    }
    minimapTerrainSamples=width*height;
    if(scale<1&&(layers.roads||layers.rails)){
      if(minimapNetworkGame!==game||minimapNetworkRevision!==(game.networkRevision||0)){
        minimapNetwork=networkIndex(game);
        minimapNetworkGame=game;minimapNetworkRevision=game.networkRevision||0;minimapNetworkScans++;
      }
      for(const id of minimapNetwork){const t=game.tiles[id],color=layers.buildings&&t.building?colors.building:layers.rails&&t.rail?colors.rail:layers.roads&&t.road?colors.road:null;if(color!==null)minimapWords[Math.floor((Math.floor(id/game.width)+.5)/stepY)*width+Math.floor((id%game.width+.5)/stepX)]=color;}
    }
    if(layers.buildings)for(const industry of game.industries||[])for(const p of industryTiles(industry))minimapWords[Math.floor((p.y+.5)/stepY)*width+Math.floor((p.x+.5)/stepX)]=colors.building;
    minimapLayer.getContext('2d').putImageData(minimapPixels,0,0);minimapRevision=cachedRevision;
  }
  function drawMinimap(minimap){
    cacheMinimap();const rect=minimap.getBoundingClientRect();const mw=Math.round(rect.width||180),mh=Math.round(rect.height||115),ratio=Math.min(window.devicePixelRatio||1,2);if(minimap.width!==mw*ratio||minimap.height!==mh*ratio){minimap.width=mw*ratio;minimap.height=mh*ratio;}
    const c=minimap.getContext('2d');c.setTransform(ratio,0,0,ratio,0,0);c.imageSmoothingEnabled=false;c.drawImage(minimapLayer,0,0,mw,mh);c.imageSmoothingEnabled=true;
    const sx=mw/game.width,sy=mh/game.height;c.strokeStyle='#f5e4b4';c.lineWidth=1;
    if(layers.routes)for(const r of game.routes||[])if(r.path?.length){
      let entry=minimapRoutePaths.get(r);
      if(!entry||entry.path!==r.path||entry.length!==r.path.length||entry.sx!==sx||entry.sy!==sy){
        const path=new Path2D();r.path.forEach((p,i)=>i?path.lineTo((p.x+.5)*sx,(p.y+.5)*sy):path.moveTo((p.x+.5)*sx,(p.y+.5)*sy));
        entry={path:r.path,length:r.path.length,sx,sy,drawing:path};minimapRoutePaths.set(r,entry);
      }
      const offline=r.active===false;c.strokeStyle=offline?'#d7725f':r.color||'#e4c38c';c.lineWidth=1.4;if(offline)c.setLineDash([3,2]);c.stroke(entry.drawing);if(offline)c.setLineDash([]);
    }
    if(layers.industryIcons&&!lens){c.fillStyle='#d9ba7d';for(const ind of game.industries||[])c.fillRect((ind.x+.5)*sx-1,(ind.y+.5)*sy-1,2,2);}
    if(layers.buildings)for(const city of game.cities||[])dot(c,(city.x+.5)*sx,(city.y+.5)*sy,2.5,'#f7f2d8');
    if(layers.stations)for(const stop of game.stations||[]){const x=(stop.x+.5)*sx,y=(stop.y+.5)*sy;if(stop.mode==='water'){c.fillStyle='#d4ebe1';c.beginPath();c.moveTo(x,y-3);c.lineTo(x+3,y);c.lineTo(x,y+3);c.lineTo(x-3,y);c.closePath();c.fill();dot(c,x,y,1.4,'#376e7e');}else dot(c,x,y,1.7,stop.mode==='rail'?'#365b59':'#658153');}
    const footprint=viewportCorners().map(p=>[p.x/TILE*sx,p.y/TILE*sy]);
    c.beginPath();footprint.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle='#f4efcc12';c.fill();c.strokeStyle='#f6edc7';c.lineWidth=1.3;c.stroke();
    // A cargo lens replaces the industry dots with its producers and buyers, squares in their role colours above the view outline, and rings the towns that buy it.
    if(lens){for(const city of lensRole('towns',lens)?game.cities||[]:[]){c.beginPath();c.arc((city.x+.5)*sx,(city.y+.5)*sy,4,0,TAU);c.strokeStyle=LENS_COLORS.buyer;c.lineWidth=1.5;c.stroke();}for(const ind of game.industries||[]){const role=lensRole(ind.kind,lens);if(!role)continue;const span=industrySize(ind),x=Math.round((ind.x+span/2)*sx),y=Math.round((ind.y+span/2)*sy),s=mw>=300?6:4;c.fillStyle='#fbf6e3';c.fillRect(x-s/2-1.5,y-s/2-1.5,s+3,s+3);c.fillStyle=LENS_COLORS[role];c.fillRect(x-s/2,y-s/2,s,s);}}

  }
  resize();const first=game.cities?.[0];if(first)focus(first.x+4.5,first.y-4.5);else bounds();
  return {setGame,setLayers,getLayers,setLens,render,resize,worldToScreen,gridPointToScreen,screenToVertex,stationMarker,stationAtMarker,vehicleAt,industryMarker,cityLabels:()=>labelRects.map(rect=>({...rect})),screenToTile,screenToInspectTile,pan,zoomAt,setZoom,focus,getCamera:()=>({...camera}),drawMinimap,getStats:()=>({projection:'isometric',terrainGeometry:true,maxTerrainHeight:MAX_HEIGHT,heightStep:HEIGHT_STEP,tileWidth:TILE*2,tileHeight:TILE,chunkCount:chunks.size,composedChunks,sceneBuilds,sceneryBatches:{...sceneryBudget.stats(),enabled:sceneryBatching,builds:sceneryBatchBuilds,draws:sceneryBatchDraws,directDraws:sceneryDirectDraws,waitingForCamera:sceneryWaitingForCamera,pending:sceneryBatching&&sceneCache&&!sceneCache.batchPlanReady?1:Math.max(0,(sceneCache?.pendingGroups?.length||0)-(sceneCache?.pendingIndex||0))+(sceneCache?.shadowPreparation?sceneCache.shadows.length-sceneCache.shadowPreparation.index:0),pendingGroups:Math.max(0,(sceneCache?.pendingGroups?.length||0)-(sceneCache?.pendingIndex||0)),pendingShadows:sceneCache?.shadowPreparation?sceneCache.shadows.length-sceneCache.shadowPreparation.index:0,preparationMs:sceneryPreparationMs,preparationBudgetMs:sceneryPrepareBudgetMs},foundationBuilds,foundationCacheSize:foundations.size,routeSegmentsConsidered,routePathBuilds,routeBreaks,highlightRoute:highlightedRoute,contextTargets,lens:lensStats&&{...lensStats},visibleVehicleCandidates:frameVehicles.length,cacheBytes,cacheLimit,cacheMax:CACHE_MAX,chunkTiles:CHUNK_TILES,rasterScale,pixelScale:rasterScale,detailLevel,view:ZOOM_VIEWS.find(view=>view.zoom===camera.zoom).name,devicePixelRatio:dpr,dpr,maxSurfaceWidth:largestSurface,maxSurfaceHeight:largestSurface,minimapWidth:minimapLayer.width,minimapHeight:minimapLayer.height,minimapMaxEdge:MINIMAP_EDGE,minimapWorldWidth:game.width,minimapWorldHeight:game.height,minimapTerrainSamples,minimapNetworkScans,minimapNetworkBytes:minimapNetwork?.bytes||0,vehicleIndicators:{...vehicleIndicatorCounts},preparedSprites:preparedSprites.getStats(),preparedTransport:preparedTransport.getStats(),vehicleSprites:vehicleSprites.getStats(),infrastructureSprites:infrastructureSprites.getStats(),preparedZooms:rasterBundles.size,loadBadgeCount:loadBadges.size,sprites:sprite?.getStats?.(),uprightSprites:uprightSprite?.getStats?.(),houseArtwork:getHouseAssetStats(game.biome),worldArtwork:worldArtStats(),treeShadows:treeShadowCacheStats(),weather:drawWeather.getStats(),lighting:drawLighting.getStats?.(),marine:marine?.getStats?.(),layers:getLayers()})};
}
