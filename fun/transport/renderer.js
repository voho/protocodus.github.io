import { resolveBuildTool, quoteBuildPlan, airportPlacement } from './construction-plan.js';
import { routeTileIndex } from './route-tiles.js';
import { terraformProblem, networkEdgeAllowed, networkTerrainShape } from './terrain-engineering.js';
import { isEngineeredTunnel, isUndergroundAt } from './structure-visibility.js';
import { TILE, PALETTES, createSprites, createSpriteCache, rng } from './sprites.js';
import { INDUSTRIES, BUILD_COSTS, VEHICLE_SPEEDS } from './data.js';
import { isTownTraffic } from './data.js';
import { STATION_RADIUS, priceFor, buildProblem, routeBreakPoint, shownProgress } from './model.js';
import { BUILDINGS, residentialKind, commercialKind } from './buildings.js';
import { ZOOM_VIEWS, nearestZoom, stepZoom } from './zoom.js';
import { cargoIcon } from './cargo-icons.js';
import { lensRole } from './chains.js';
import { townLensRole } from './chains.js';
import { industryService, industryStatus } from './gameplay-insights.js';
import { outputFill } from './industry-simulation.js';
import { landscapeScenery } from './landscape-scenery.js';
import { DEFAULT_LAYERS, normalizeLayers } from './visibility.js';
import { createMarineSprites, drawShipWake, MARINE_SIZE } from './marine-sprites.js';
import { createWeatherEffects } from './weather-effects.js';
import { paintWaterRelief, paintCoast, prepareWaterMotion, drawPreparedWaterMotion } from './water-art.js';
import { paintGrassGround } from './grass-art.js';
import { paintFoundationStones } from './foundation-stone.js';
import { houseAssetsRevision, getHouseAssetStats } from './raster-houses.js';
import { worldArtRevision, worldArtStats } from './atlas-runtime.js';
import { createVehicleSprites, drawRasterInfrastructure, drawRasterNetwork, drawRasterZone, hasRasterNetwork, hasRasterTransport } from './raster-transport.js';
import { industrySize, industryFootprint, industryTiles, industryContains, industryDistance } from './industry-sites.js';
import { createOverlayGrid, siteShape, insideShape } from './overlay-placement.js';
import { drawRasterIndustry } from './raster-industries.js';
import { drawRasterFarmCore } from './raster-industries.js';
import { drawNativeFarmCore } from './processing-sprites.js';
import { isLargeFarm, farmCore, paintFarmFields, farmFenceSections, paintFarmFence, farmFieldObjects, paintFarmFieldObject } from './farm-fields-art.js';
import { buildingSize, buildingFootprint, buildingAt } from './building-sites.js';
import { terrainObjectAt, terrainObjectSize } from './terrain-objects.js';
import { surfaceChangesSince, viewChangesSince } from './change-journal.js';
import { natureObjectLayout, drawRasterTreeShadows, treeShadowCacheStats } from './raster-nature.js';
import { terrainLevel, terrainElevation, terrainReliefRaster, terrainOverviewColor } from './terrain-elevation.js';
import { natureVariant as placedNatureVariant, natureDensity as placedNatureDensity } from './nature-placement.js';
import { populationText } from './formatters.js';
import { shorelineContours, appendShoreline } from './shoreline.js';
import { projectPoint, unprojectPoint, projectAngle } from './isometric.js';
import { projectGround as projectGroundAtHeight, projectTerrainPoint as projectTerrainPointAtHeight, surfaceHeight, tileSurface as tileSurfaceAtHeight, groundIsFlat, pickGround as pickGroundAtHeight, transportHeight, bridgeDeckHeight, bridgeSurface, HEIGHT_STEP, MAX_HEIGHT } from './terrain-geometry.js';
import { normalizeTerrainHeight } from './terrain-view.js';
import { drawTerrainMesh, paintTerrainTile } from './terrain-mesh.js';
import { partitionScenery, createSceneryBudget } from './scenery-batches.js';
import { createRouteRenderIndex } from './route-render-index.js';
import { lineFor, lineColor, validRouteNumber } from './route-lines.js';
import { COLORS, STATES, MAP, FONT, alpha } from './design-tokens.js';
import { networkIndex } from './network-index.js';
import { createIsometricInfrastructureSprites } from './isometric-infrastructure.js';
import { stationSpan, stationTiles, stationServes, stationContains, AIRPORT_REACH } from './station-sites.js';
import { aircraftPose } from './air-flight.js';
import { paintAirportGround, createAirportSprites, PART_FRONTS, PART_BOXES, localToWorld } from './airport-art.js';

const TAU=Math.PI*2;
const CHUNK_TILES=6, CHUNK_PIXELS=CHUNK_TILES*TILE, CHUNK_GUTTER=8;
const CACHE_BASE=48*1024*1024, CACHE_MAX=256*1024*1024;
const MINIMAP_EDGE=512;
const SCENE_PAN_MARGIN=96;
// An ecology day patches at most this many scene tiles; a larger change rebuilds the scene. Chunks it changed recompose
// two a frame, keeping their last picture meanwhile, so a busy 8× day never lands in a single frame.
const SCENE_PATCH_TILES=6000,LAZY_CHUNKS_PER_FRAME=2,EMPTY_CELLS=new Int32Array(0);
const LANDMARKS=new Set(['forest','rock']);
const BAKED_LAYERS=new Set(['trees','buildings','roads','rails','stations','zones']);
const MINIMAP_LAYERS=new Set(['trees','buildings','roads','rails','stations','industryIcons','routes','zones']);
// Map marks in display pixels (DESIGN.md 8 and 9): roundel radius per view, and one tile step of a route's projected path.
const ROUNDEL={region:4,town:5,detail:6},PATH_STEP=Math.hypot(TILE,TILE/2);
const FLOATER_FORMAT=new Intl.NumberFormat('en-US',{maximumFractionDigits:1});
const font=(weight,size)=>`${weight} ${size}px ${FONT.family}`;
function roundRect(ctx,x,y,w,h,r=5){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function line(ctx,points,color,width=1){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function dot(ctx,x,y,r,color){ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fillStyle=color;ctx.fill();}
// Picking reads each sprite back once, into a full-resolution 1-bit mask of
// alpha above 24: every GPU readback stalls, and returned sprites never change.
const alphaMasks=new WeakMap();
export function opaqueAt(image,sx,sy){
  let mask=alphaMasks.get(image);
  if(!mask&&image.width*image.height<=1<<20)try{
    const w=image.width,h=image.height,data=image.getContext('2d').getImageData(0,0,w,h).data,bits=new Uint8Array(Math.ceil(w*h/8));
    for(let i=0;i<w*h;i++)if(data[i*4+3]>24)bits[i>>3]|=1<<(i&7);
    alphaMasks.set(image,mask={w,h,bits});
  }catch{}
  if(!mask)return image.getContext('2d').getImageData(sx,sy,1,1).data[3]>24;
  const i=sy*mask.w+sx;return sx>=0&&sy>=0&&sx<mask.w&&sy<mask.h&&(mask.bits[i>>3]>>(i&7)&1)===1;
}
const titleCase=s=>String(s||'Industry').replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

export function createRenderer(canvas, initialGame, options={}) {
  let game=initialGame,ctx=canvas.getContext('2d'),W=1,H=1,dpr=1;
  let layers=normalizeLayers(options.layers||DEFAULT_LAYERS),heightStep=normalizeTerrainHeight(options.heightStep);
  let stopPickingMode=null;
  // Terrain projection is local to this renderer. Levels used by construction,
  // bridges, routes and saves keep their original meaning.
  const projectGround=(world,u,v)=>projectGroundAtHeight(world,u,v,heightStep);
  const projectTerrainPoint=(u,v,height=0)=>projectTerrainPointAtHeight(u,v,height,heightStep);
  const tileSurface=(world,x,y)=>tileSurfaceAtHeight(world,x,y,heightStep);
  const pickGround=(world,x,y)=>pickGroundAtHeight(world,x,y,heightStep);
  const reliefCanvas=document.createElement('canvas'),reliefContext=reliefCanvas.getContext('2d');
  const approachCanvas=document.createElement('canvas');
  const terrainSourceCanvas=document.createElement('canvas');
  let camera={x:48*TILE,y:32*TILE,zoom:nearestZoom(options.zoom),height:0};
  // The visible band (setBand), a camera glide in progress, and the hovered reference with the time it began, for its fade.
  let band=null,glide=null,lastHoverRef=null,hoverRefAt=-Infinity;
  let palette=PALETTES[game.biome]||PALETTES.taiga,sprite,uprightSprite,marine,vehicleSprites,infrastructureSprites,airportSprites,rasterScale=0,detailLevel='',cacheLimit=CACHE_BASE;
  // Region, Town and Detail retain their native-pixel sprites in one budget.
  // Returning to a zoom reuses its prepared artwork instead of scaling atlases
  // or throwing away the other views' still-useful images.
  const preparedSprites=createSpriteCache({limit:128*1024*1024}),gardenSurfaces=createSpriteCache({limit:16*1024*1024}),rasterBundles=new Map();
  const preparedTransport=createSpriteCache({limit:32*1024*1024});
  let preparedDpr=0;
  // The map can cover hundreds of thousands of tiles. Only visible, reusable
  // 6×6 chunks receive artwork at the current physical-pixel density. Small
  // chunks keep Detail's retina surfaces bounded; atlas terrain is capped at 512².
  const chunks=new Map(), minimapLayer=document.createElement('canvas'), codes=new Map(), cargoImages=new Map(),loadBadges=new Map();
  const waterMotionChunks=[];
  let waterMotionBuilds=0,waterMotionStats={chunks:0,waveGroups:0,shoreSegments:0,strokes:0,reducedMotion:false};
  const motionPreference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const drawWeather=createWeatherEffects({reducedMotion:()=>Boolean(motionPreference?.matches)});
  if(options.onInvalidate)motionPreference?.addEventListener('change',options.onInvalidate);
  let cachedRevision=-1, minimapRevision=-1, cachedBiome=game.biome, cachedSeed=game.seed, cachedHouseAssets=houseAssetsRevision(),cachedWorldAssets=worldArtRevision();
  let minimapPixels=null,minimapWords=null,minimapMask=null,minimapPalette=null;
  let minimapNetworkGame=null,minimapNetworkRevision=-1,minimapNetwork=null,minimapNetworkScans=0,minimapTerrainSamples=0;
  let industryIndex=new Map(), stationIndex=new Map(), buildingIndex=new Map(), terrainObjectIndex=new Map(), cacheBytes=0, composedChunks=0;
  // Airports cover 6 × 2 tiles: every tile maps to its airport; stationIndex stays anchor-only for signs and labels.
  let airportIndex=new Map(),airports=[],stationById=new Map();
  let objectHits=[],bridgeHits=[],sceneCache=null,gridCache=null,sceneViewBounds=null,capturedBillboards=null,propertyOutlines=0;
  const sceneryBudget=createSceneryBudget();
  const sceneryBatching=options.sceneryBatching!==false;
  let sceneryBatchBuilds=0,sceneryBatchDraws=0,sceneryDirectDraws=0,sceneryPreparationMs=0;
  // A settled view without ground traffic can replay its entire static layer.
  // Keep one display-sized surface, bounded independently of world size.
  let sceneryView=null,sceneryViewBuilds=0,sceneryViewDraws=0;
  const sceneryViewLimit=32*1024*1024;
  // Copying a full transparent display costs more than a few small objects.
  // Require enough saved submissions for the physical-pixel surface size.
  const sceneryViewMinimumDraws=bytes=>Math.max(32,Math.ceil(bytes/(128*1024)));
  const sceneryPrepareBudgetMs=3,sceneryPanSettleMs=90;
  let lastSceneCamera=null,lastCameraMotion=-Infinity,sceneryWaitingForCamera=false;
  const foundations=new Map();
  let sceneBuilds=0,scenePatches=0,foundationBuilds=0,projectedOrigin=null,lazyChunkBudget=LAZY_CHUNKS_PER_FRAME,lazyChunksWaiting=0;
  const routeIndexes=new WeakMap(),routePaths=new WeakMap(),minimapRoutePaths=new WeakMap();
  let routeSegmentsConsidered=0,routePathBuilds=0;
  const routeBreakPoints=new WeakMap();let routeBreaks=0,highlightedRoute=null;
  function routeBreak(r){const key=`${game.networkRevision||0}:${r.path.length}`;let entry=routeBreakPoints.get(r);if(entry?.key!==key)routeBreakPoints.set(r,entry={key,at:routeBreakPoint(game,r)});return entry.at;}
  // New homes move markers and nameplates without touching the network, so overlays also follow the site journal.
  let structureRevision=0,siteRevision=0;
  const frameVehicles=[];
  // Motion records are written by the one-second world update. Sampling only
  // changes presentation proxies; picks still return the company's real vehicle.
  let presentationMotion=null,presentationDay=null,presentationSources=new WeakMap();
  const presentationTime=()=>presentationDay??(game.day||0);
  function setPresentation(motion,day){presentationMotion=motion||null;presentationDay=Number.isFinite(day)?day:null;}
  function presentedVehicle(vehicle){
    const source=presentationSources.get(vehicle)||vehicle;
    if(!presentationMotion)return source;
    if(presentationMotion.tracks&&!presentationMotion.tracks(source))return source;
    const proxy=presentationMotion.sample(game,source,presentationTime());
    if(proxy!==source)presentationSources.set(proxy,source);
    return proxy;
  }
  // Planes: one pose per visible plane per frame (air-flight.js), in projected world px, the body at its height over
  // the ground point beneath it. Each route keeps its flight geometry and cruise level until its path or ground changes.
  const airPoses=new Map(),flightCaches=new WeakMap(),cruiseLevels=new WeakMap();let airStats={ground:0,air:0};
  const airportCentre=s=>{const w=localToWorld(s.axis,3,1);return{x:s.x+w.x,y:s.y+w.y};};
  function flightCache(route,a,b){const key=`${a.x},${a.y},${a.axis},${b.x},${b.y},${b.axis}`;let entry=flightCaches.get(route);if(entry?.path!==route.path||entry.key!==key)flightCaches.set(route,entry={path:route.path,key,cache:{}});return entry.cache;}
  function cruiseLevel(route,a,b){
    let entry=cruiseLevels.get(route);if(entry?.path===route.path&&entry.revision===structureRevision)return entry.value;
    const p=airportCentre(a),q=airportCentre(b),n=Math.max(1,Math.ceil(Math.hypot(q.x-p.x,q.y-p.y)/2));let top=Math.max(surfaceHeight(game,a.x,a.y),surfaceHeight(game,b.x,b.y));
    for(let i=0;i<=n;i++)top=Math.max(top,surfaceHeight(game,p.x+(q.x-p.x)*i/n,p.y+(q.y-p.y)*i/n));
    cruiseLevels.set(route,entry={path:route.path,revision:structureRevision,value:top+2.4});return entry.value;
  }
  function airPose(v,route){
    const [a,b]=(route.stops||[]).map(id=>stationById.get(id));if(!a||!b||!(route.path?.length>1))return null;
    const pose=aircraftPose(route,[a,b],v,{heights:s=>surfaceHeight(game,s.x,s.y),cruise:cruiseLevel(route,a,b),cache:flightCache(route,a,b)}),g=surfaceHeight(game,pose.x,pose.y),p=projectPoint(pose.x*TILE,pose.y*TILE);
    return{pose,route,body:{x:p.x,y:p.y-g*heightStep-(pose.z-g)*HEIGHT_STEP},ground:{x:p.x,y:p.y-g*heightStep},lift:Math.max(0,pose.z-g)};
  }
  let largestSurface=0, lastTime=0, vehicleIndicatorCounts={empty:0,partial:0,full:0};
  function code(value){if(!value)return 0;const key=String(value);if(codes.has(key))return codes.get(key);let h=0;for(let i=0;i<key.length;i++)h=(Math.imul(h,31)+key.charCodeAt(i))|0;codes.set(key,h);return h;}
  function clearChunks(){waterMotionChunks.length=0;sceneryBudget.clear();if(sceneryView){sceneryView.image.width=sceneryView.image.height=0;sceneryView=null;}objectHits=[];bridgeHits=[];sceneCache=null;gridCache=null;foundations.clear();gardenSurfaces.clear();for(const entry of chunks.values())entry.mesh.width=entry.mesh.height=0;chunks.clear();cacheBytes=0;}
  function setTerrainHeight(value){
    const next=normalizeTerrainHeight(value);if(next===heightStep)return heightStep;
    const origin=cameraPoint(),center=pickGround(game,origin.x,origin.y);
    heightStep=next;glide=null;projectedOrigin=null;overlays=null;clearChunks();
    if(center){camera.x=center.x*TILE;camera.y=center.y*TILE;camera.height=surfaceHeight(game,center.x,center.y);}
    bounds();options.onInvalidate?.();return heightStep;
  }
  const getTerrainHeight=()=>heightStep;
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
  function setLens(cargo){cargo=cargo&&!isTownTraffic(cargo)?cargo:null;if(cargo===lens)return;lens=cargo;lensStats=null;options.onInvalidate?.();}
  // Which sites a freight service loads at or delivers to changes only with sites, stops, routes and connections.
  // game.revision moves every day, so it stays out of the key; a route going offline moves no revision, so the active count is in it.
  let service={key:'',lists:[],sites:new Map()},markerStats={drawn:0,served:0,waiting:0,meters:0,covered:0};
  function servedSites(){const lists=[game.routes||[],game.stations||[],game.industries||[]];let active=0;for(const r of lists[0])if(r.active)active++;const key=`${game.networkRevision||0}:${lists.map(list=>list.length)}:${active}`;if(service.key!==key||service.lists.some((list,n)=>list!==lists[n]))service={key,lists,sites:industryService(game)};return service.sites;}
  // The routes calling at each stop, for its sign. Launching, editing and retiring a route all replace or grow the list;
  // whether each route runs is read live, as a break moves no revision.
  let calls={routes:null,count:-1,stops:new Map()},signStats={drawn:0,active:0,idle:0,broken:0,named:0};
  function stopCalls(){const routes=game.routes||[];if(calls.routes!==routes||calls.count!==routes.length){const stops=new Map();for(const r of routes)for(const id of r.stops||[]){const list=stops.get(id);if(list)list.push(r);else stops.set(id,[r]);}calls={routes,count:routes.length,stops};}return calls.stops;}
  function updateRaster(force=false){
    const scale=camera.zoom*dpr,detail=ZOOM_VIEWS.find(view=>view.zoom===camera.zoom).name.toLowerCase();
    if(force||preparedDpr!==dpr){rasterBundles.clear();preparedSprites.clear();preparedTransport.clear();preparedDpr=dpr;}
    if(force||rasterScale!==scale||detailLevel!==detail){
      rasterScale=scale;detailLevel=detail;
      let bundle=rasterBundles.get(detail);
      if(!bundle){bundle={sprite:createSprites(game.biome,{pixelScale:scale,detailLevel:detail,cache:preparedSprites,gardenGround:'terrain'}),uprightSprite:createSprites(game.biome,{pixelScale:scale*1.5,detailLevel:detail,cache:preparedSprites,gardenGround:'terrain'}),marine:createMarineSprites({pixelScale:scale,detailLevel:detail,cache:preparedTransport}),vehicleSprites:createVehicleSprites({pixelScale:scale,cache:preparedTransport}),infrastructureSprites:createIsometricInfrastructureSprites({pixelScale:scale,cache:preparedTransport}),airportSprites:createAirportSprites({pixelScale:scale,detailLevel:detail,biome:game.biome,cache:preparedTransport})};rasterBundles.set(detail,bundle);}
      ({sprite,uprightSprite,marine,vehicleSprites,infrastructureSprites,airportSprites}=bundle);
    }
  }
  function ensureRevision(){
    if(cachedHouseAssets!==houseAssetsRevision()||cachedWorldAssets!==worldArtRevision()){clearChunks();updateRaster(true);cachedHouseAssets=houseAssetsRevision();cachedWorldAssets=worldArtRevision();}
    if(cachedBiome!==game.biome||cachedSeed!==game.seed){clearChunks();palette=PALETTES[game.biome]||PALETTES.taiga;updateRaster(true);cachedBiome=game.biome;cachedSeed=game.seed;cachedRevision=-1;minimapRevision=-1;}
    if(cachedRevision===(game.revision||0))return;
    const view=viewChangesSince(game,cachedRevision);if(view){refreshSurface(view.surface,view.sites);return;}
    buildingIndex.clear();terrainObjectIndex.clear();foundations.clear();sceneryBudget.clear();sceneCache=null;gridCache=null;
    // A structural change is the player's: every chunk it reaches recomposes on the next frame, ahead of any ecology.
    for(const entry of chunks.values())entry.lazy=false;
    industryIndex=new Map((game.industries||[]).flatMap(item=>industryTiles(item).map(p=>[p.y*game.width+p.x,item])));
    stationIndex=new Map((game.stations||[]).map(item=>[item.y*game.width+item.x,item]));
    airports=(game.stations||[]).filter(item=>item.mode==='air');airportIndex=new Map(airports.flatMap(item=>stationTiles(item).map(p=>[p.y*game.width+p.x,item])));stationById=new Map((game.stations||[]).map(item=>[item.id,item]));
    cachedRevision=game.revision||0;structureRevision++;
  }
  // Ecology rewrites only terrain, detail and dissolved groves, never heights,
  // water, structures or sites. Keep every index, foundation, grid and route
  // path; forget only the changed parcels and re-fingerprint only chunks whose
  // bounds, padded by three tiles, hold a change. Those chunks recompose a few
  // a frame (drawChunk). The scene marks the changed tiles and their two-tile
  // reach (a grove's anchor, a forest's neighbours) and patches them when drawn.
  // A town's new homes (sites) take the same path: their cells also forget cached sites and foundations.
  function refreshSurface(changes,sites=EMPTY_CELLS){
    for(const index of sites){buildingIndex.delete(index);terrainObjectIndex.delete(index);for(let span=1;span<=7;span++)foundations.delete(index*8+span);}
    if(sites.length)siteRevision++;
    if(sites.length)changes=Int32Array.from(new Set([...changes,...sites]));
    if(sceneCache){
      const within=sceneCache.bounds,dirty=sceneCache.dirty||new Set();
      for(const index of changes){const x=index%game.width,y=(index-x)/game.width;for(let v=Math.max(within.y0,y-2);v<=Math.min(within.y1-1,y+2);v++)for(let u=Math.max(within.x0,x-2);u<=Math.min(within.x1-1,x+2);u++)dirty.add(v*game.width+u);}
      if(dirty.size>SCENE_PATCH_TILES){sceneryBudget.clear();sceneCache=null;}else if(dirty.size)sceneCache.dirty=dirty;
    }
    const reach=5,columns=Math.ceil(game.width/CHUNK_TILES)+2,near=new Set(),revision=game.revision||0;
    for(const index of changes){
      terrainObjectIndex.delete(index);
      const x=index%game.width,y=Math.floor(index/game.width);
      for(let cy=Math.ceil((y-reach-CHUNK_TILES+1)/CHUNK_TILES);cy<=Math.floor((y+reach)/CHUNK_TILES);cy++)for(let cx=Math.ceil((x-reach-CHUNK_TILES+1)/CHUNK_TILES);cx<=Math.floor((x+reach)/CHUNK_TILES);cx++)near.add((cy+1)*columns+cx+1);
    }
    // Only a chunk current at the previous revision may skip its fingerprint.
    for(const [key,entry] of chunks){if(entry.revision!==cachedRevision)continue;const [cx,cy]=key.split(',').map(Number);if(!near.has((cy+1)*columns+cx+1))entry.revision=revision;else entry.lazy=true;}
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
  const siteAt=(x,y)=>industryIndex.get(y*game.width+x)||buildingSiteAt(x,y)||airportIndex.get(y*game.width+x);
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
  const siteSize=site=>site?.mode==='air'?stationSpan(site):site?.object?terrainObjectSize(site.object):site?.building?buildingSize(site.building):industrySize(site);
  function selectionUnderlay(selected,tileOnly=false){
    if(!selected||!Number.isInteger(selected.x)||!Number.isInteger(selected.y)||!tile(selected.x,selected.y))return;
    // A logical terrain parcel still owns its whole area on a slope, where
    // its artwork may use smaller scenery. Resolve the actual parcel rather
    // than the flat-only billboard lookup used by pointer previews.
    const site=tileOnly?selected:siteAt(selected.x,selected.y)||terrainObjectAt(game,selected.x,selected.y)||selected,span=siteSize(site);
    const {w,h}=typeof span==='number'?{w:span,h:span}:span,mark=MAP.selection,z=camera.zoom;
    const point=(u,v,first=false)=>{const p=projectGround(game,u,v);first?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);};
    ctx.save();ctx.beginPath();
    // Project each tile so an uneven parcel follows the same ground faces as
    // the terrain. This is a transient overlay, never part of a cached chunk.
    for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++){
      const x=site.x+dx,y=site.y+dy;
      point(x,y,true);point(x+1,y);point(x+1,y+1);point(x,y+1);ctx.closePath();
    }
    ctx.fillStyle=alpha(mark.color,.18);ctx.fill();
    ctx.beginPath();point(site.x,site.y,true);
    for(let dx=1;dx<=w;dx++)point(site.x+dx,site.y);
    for(let dy=1;dy<=h;dy++)point(site.x+w,site.y+dy);
    for(let dx=w-1;dx>=0;dx--)point(site.x+dx,site.y+h);
    for(let dy=h-1;dy>0;dy--)point(site.x,site.y+dy);
    ctx.closePath();ctx.lineJoin='round';
    ctx.strokeStyle=mark.casing;ctx.lineWidth=mark.casingWidth/z;ctx.stroke();
    ctx.strokeStyle=mark.color;ctx.lineWidth=mark.width/z;ctx.stroke();ctx.restore();
    return {x:site.x,y:site.y,w,h};
  }
  function portLandDirection(x,y){return[[-1,0],[0,-1],[1,0],[0,1]].find(([dx,dy])=>tile(x+dx,y+dy)&&tile(x+dx,y+dy).terrain!=='water')||[-1,0];}
  // Simulation and saves keep their square grid. Only the view uses a 2:1
  // diamond projection; upright objects are composed in projected space.
  const projectTile=(x,y)=>projectGround(game,x+.5,y+.5);
  const cameraPoint=()=>{
    if(!projectedOrigin||projectedOrigin.cx!==camera.x||projectedOrigin.cy!==camera.y||projectedOrigin.height!==camera.height){
      const p=projectPoint(camera.x,camera.y);p.y-=(camera.height||0)*heightStep;
      projectedOrigin={...p,cx:camera.x,cy:camera.y,height:camera.height};
    }
    return projectedOrigin;
  };
  const screenPoint=p=>{const origin=cameraPoint();return{x:(p.x-origin.x)*camera.zoom+W/2,y:(p.y-origin.y)*camera.zoom+H/2};};
  const worldToScreen=(x,y)=>screenPoint(projectTile(x,y));
  const gridPointToScreen=(x,y)=>screenPoint(projectGround(game,x,y));
  const transportPoint=(x,y,mode)=>{const p=projectPoint((x+.5)*TILE,(y+.5)*TILE);p.y-=transportHeight(game,x,y,mode)*heightStep;return p;};
  const vehicleToScreen=(x,y,mode)=>screenPoint(transportPoint(x,y,mode));
  function foundationHeight(x,y,span){
    const key=(y*game.width+x)*8+span,cached=foundations.get(key);
    if(cached)return cached.height;
    let h=0;
    // A site's highest point may be an interior vertex, not its perimeter.
    for(let v=y;v<=y+span;v++)for(let u=x;u<=x+span;u++)h=Math.max(h,surfaceHeight(game,u,v));
    for(let v=y;v<y+span;v++)for(let u=x;u<x+span;u++)h=Math.max(h,surfaceHeight(game,u+.5,v+.5));
    if(foundations.size>=8192)foundations.clear();
    foundations.set(key,{height:h,paths:null});foundationBuilds++;return h;
  }
  function foundationPoint(x,y,span){const p=projectPoint((x+span/2)*TILE,(y+span/2)*TILE);p.y-=foundationHeight(x,y,span)*heightStep;return p;}
  const buildingToScreen=(x,y,span)=>screenPoint(foundationPoint(x,y,span));
  const groundTransform=c=>c.transform(1,.5,-1,.5,0,0);
  function screenToWorld(x,y){const origin=cameraPoint();return unprojectPoint((x-W/2)/camera.zoom+origin.x,(y-H/2)/camera.zoom+origin.y);}
  function viewportCorners(margin=0){return[[-margin,-margin],[W+margin,-margin],[W+margin,H+margin],[-margin,H+margin]].map(([x,y])=>screenToWorld(x,y));}
  function visibleBounds(extra=0){const points=viewportCorners((180+MAX_HEIGHT*heightStep+extra)*camera.zoom);return{x0:Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))/TILE)),y0:Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))/TILE)),x1:Math.min(game.width,Math.ceil(Math.max(...points.map(p=>p.x))/TILE)),y1:Math.min(game.height,Math.ceil(Math.max(...points.map(p=>p.y))/TILE))};}
  // A stop's sign box, its click target, is 16 px in Region and 18 px from Town in, centred up and to the right of the stop,
  // with the roundel at its centre. Signs,
  // labels and markers are placed in projected display pixels (see placeOverlays), so one shift puts every box on screen.
  const signSize=()=>detailLevel==='region'?16:18;
  function overlayShift(){const o=cameraPoint();return{x:W/2-o.x*camera.zoom,y:H/2-o.y*camera.zoom};}
  // An airport's sign stands over its terminal hall, clear of the control tower; every other stop's over its own tile.
  const signTile=st=>st.mode==='air'?(t=>({x:st.x+t.x-.5,y:st.y+t.y-.5}))(localToWorld(st.axis,1.1,.46)):st,signLift=st=>st.mode==='air'?50:28;
  function stationMarker(station){const sign=placeOverlays().signs.get(station.y*game.width+station.x),s=overlayShift();if(sign)return{x:sign.x+s.x,y:sign.y+s.y,size:sign.size};const q=signTile(station),p=worldToScreen(q.x,q.y),size=signSize();return{x:p.x+8*camera.zoom+7-size/2,y:p.y-signLift(station)*camera.zoom+7-size/2,size};}
  // Town labels rise clear of the stop signs beside a town centre; stations are cached per revision.
  const labelRects=[],signRects=[],signEnds=new Map();let townStops=null,townStopsIndex=null;
  function nearbyStops(city){
    if(townStopsIndex!==stationIndex){townStops=new Map();townStopsIndex=stationIndex;for(const c of game.cities||[]){const near=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const st=c.x+dx>=0&&c.x+dx<game.width?stationIndex.get((c.y+dy)*game.width+c.x+dx):null;if(st)near.push(st);}if(near.length)townStops.set(c,near.sort((a,b)=>projectTile(b.x,b.y).y-projectTile(a.x,a.y).y));}}
    return townStops.get(city);
  }
  // Signs are visited lowest first, so each lift can only meet the signs above it.
  function clearStopSigns(stops,x,w,y,above,below,sign){for(const st of stops){const m=sign(st);if(m.x<x+w&&m.x+(m.w||m.size)>x&&m.y<y+below+5&&m.y+m.size>y-above)y=m.y-below-5;}return y;}
  function resize(){const rect=canvas.getBoundingClientRect();W=Math.max(1,rect.width);H=Math.max(1,rect.height);dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.imageSmoothingEnabled=false;updateRaster();bounds();}
  function bounds(){
    camera.x=Math.max(TILE/2,Math.min((game.width-.5)*TILE,camera.x));
    camera.y=Math.max(TILE/2,Math.min((game.height-.5)*TILE,camera.y));
    // Snap the projected origin to physical pixels, then return to world space.
    const p=cameraPoint();
    const snapped=unprojectPoint((W/2-Math.round((W/2-p.x*camera.zoom)*dpr)/dpr)/camera.zoom,(H/2-Math.round((H/2-p.y*camera.zoom)*dpr)/dpr)/camera.zoom);
    camera.x=snapped.x+(camera.height||0)*heightStep;camera.y=snapped.y+(camera.height||0)*heightStep;
  }
  function focus(x,y){glide=null;camera.x=(x+.5)*TILE;camera.y=(y+.5)*TILE;camera.height=surfaceHeight(game,x+.5,y+.5);bounds();}
  function pan(dx,dy){glide=null;const move=unprojectPoint(dx/camera.zoom,dy/camera.zoom);camera.x-=move.x;camera.y-=move.y;bounds();}
  function setZoom(value,clientX,clientY){
    glide=null;const next=nearestZoom(value);if(next===camera.zoom)return;
    const rect=canvas.getBoundingClientRect(),sx=(clientX===undefined?W/2:clientX-rect.left)-W/2,sy=(clientY===undefined?H/2:clientY-rect.top)-H/2,old=camera.zoom;
    const move=unprojectPoint(sx/old-sx/next,sy/old-sy/next);
    camera.zoom=next;camera.x+=move.x;camera.y+=move.y;bounds();updateRaster();
  }
  function zoomAt(factor,clientX,clientY){if(!Number.isFinite(factor)||factor<=0||factor===1)return;setZoom(stepZoom(camera.zoom,Math.sign(factor-1)),clientX,clientY);}
  // DESIGN.md 10.2: framing uses the visible band, the canvas less the panels over it (setBand, local CSS px). glideTo eases the
  // camera to put a frame's centre (tiles, as resolveRef gives it) in the middle of the band, or at `offset` px from the canvas
  // centre, over `duration` ms on the --ease curve; 0 cuts. A zoom step lands first when it zooms out and last when it zooms in.
  // stepCamera(now) advances it from frame() and render() and says whether the camera or a locator fade still moves; any pan,
  // zoom or focus cancels it, as glideTo(null) does. screensTo measures the jump in band widths or heights at the zoom it would
  // travel at.
  function setBand(rect){band=rect&&rect.right-rect.left>=8&&rect.bottom-rect.top>=8?{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}:null;}
  const bandBox=()=>band?{left:Math.max(0,band.left),top:Math.max(0,band.top),right:Math.min(W,band.right),bottom:Math.min(H,band.bottom)}:{left:0,top:0,right:W,bottom:H};
  function frameCamera(frame,zoom,offset){
    const b=bandBox(),o=offset||{x:(b.left+b.right-W)/2,y:(b.top+b.bottom-H)/2},x=frame.cx??(frame.x0+frame.x1)/2,y=frame.cy??(frame.y0+frame.y1)/2,move=unprojectPoint(o.x/zoom,o.y/zoom);
    return {x:(x+.5)*TILE-move.x,y:(y+.5)*TILE-move.y,height:frame.height??surfaceHeight(game,Math.max(0,Math.min(game.width,x+.5)),Math.max(0,Math.min(game.height,y+.5)))};
  }
  function screensTo(frame,{zoom,offset}={}){
    if(!frame)return 0;const z=nearestZoom(zoom??camera.zoom),to=frameCamera(frame,z,offset),b=bandBox(),d=projectPoint(to.x-camera.x,to.y-camera.y),travel=Math.min(z,camera.zoom);
    return Math.max(Math.abs(d.x)/Math.max(1,b.right-b.left),Math.abs(d.y)/Math.max(1,b.bottom-b.top))*travel;
  }
  // The --ease curve, cubic-bezier(.2,.7,.2,1): time to curve parameter by bisection, then its progress.
  function ease(t){if(t<=0)return 0;if(t>=1)return 1;const bz=(s,a,b)=>3*(1-s)*(1-s)*s*a+3*(1-s)*s*s*b+s*s*s;let lo=0,hi=1;for(let i=0;i<24;i++){const s=(lo+hi)/2;if(bz(s,.2,.2)<t)lo=s;else hi=s;}return bz((lo+hi)/2,.7,1);}
  function zoomTo(zoom){if(zoom===camera.zoom)return;camera.zoom=zoom;bounds();updateRaster();}
  function glideTo(frame,{duration=0,zoom,offset}={}){
    if(!frame){glide=null;return;}const z=nearestZoom(zoom??camera.zoom);
    glide={frame,zoom:z,offset,from:{x:camera.x,y:camera.y,height:camera.height},start:performance.now(),duration:Math.max(0,Number(duration)||0)};
    if(z<camera.zoom)zoomTo(z);
    if(!glide.duration)stepCamera(glide.start);
  }
  function stepCamera(now){
    const fading=Boolean(lastHoverRef)&&!motionPreference?.matches&&now-hoverRefAt<MAP.locator.fadeMs;
    if(!glide||now<glide.start)return Boolean(glide)||fading;
    const g=glide,t=g.duration?Math.min(1,(now-g.start)/g.duration):1,to=frameCamera(g.frame,g.zoom,g.offset);
    if(t>=1){glide=null;zoomTo(g.zoom);camera.x=to.x;camera.y=to.y;camera.height=to.height;bounds();return fading;}
    const k=ease(t);camera.x=g.from.x+(to.x-g.from.x)*k;camera.y=g.from.y+(to.y-g.from.y)*k;camera.height=g.from.height+(to.height-g.from.height)*k;bounds();
    return true;
  }
  function screenToTile(clientX,clientY,{clamp=false}={}){
    const rect=canvas.getBoundingClientRect(),origin=cameraPoint(),px=(clientX-rect.left-W/2)/camera.zoom+origin.x,py=(clientY-rect.top-H/2)/camera.zoom+origin.y;
    // A high viaduct may cover a different ground tile in screen space. Pick
    // its visible deck before the land below, including for demolition.
    for(let i=bridgeHits.length-1;i>=0;i--){
      const hit=bridgeHits[i],p=unprojectPoint(px,py+hit.height*heightStep),u=p.x/TILE,v=p.y/TILE;
      if(Math.floor(u)===hit.x&&Math.floor(v)===hit.y&&Math.abs(hit.axis==='x'?v-hit.y-.5:u-hit.x-.5)<=9/TILE)return{x:hit.x,y:hit.y};
    }
    const p=pickGround(game,px,py);return p?{x:Math.floor(p.x),y:Math.floor(p.y)}:clamp?edgePoint(px,py,Math.floor,.5):{x:-1,y:-1};
  }
  // A construction drag that leaves the world ends at its nearest edge tile. As in
  // pickGround, the frontmost edge point whose ground reaches the pointer's ray wins.
  function edgePoint(px,py,snap,middle){
    const fit=p=>({x:Math.max(0,Math.min(game.width-1,snap(p.x/TILE))),y:Math.max(0,Math.min(game.height-1,snap(p.y/TILE)))});
    for(let h=MAX_HEIGHT;h>0;h-=.5){const edge=fit(unprojectPoint(px,py+h*heightStep));if(surfaceHeight(game,edge.x+middle,edge.y+middle)>=h)return edge;}
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
  function industryMarker(industry,placed=placeOverlays(),s=overlayShift()){
    const marker=placed.markers.get(industry.y*game.width+industry.x);
    if(marker)return {x:marker.x+s.x,y:marker.y+s.y,size:marker.size,stem:marker.stem&&{x:marker.stem.x+s.x,y:marker.stem.y+s.y}};
    if(isLargeFarm(industry)){const core=farmCore(industry),p=screenPoint(projectGround(game,core.x+1,industry.y+industrySize(industry)-.12)),size=detailLevel==='detail'?28:24;return{x:p.x,y:p.y+5+(size+6)/2,size};}
    const span=industrySize(industry),p=buildingToScreen(industry.x,industry.y,span),size=detailLevel==='detail'?28:24;
    return {x:p.x,y:p.y+16*span*camera.zoom+5+(size+6)/2,size};
  }
  // Town labels, then stop signs, then industry markers are placed together on a 64 px grid, in projected display pixels,
  // once per zoom, size, density, layers, structure revision and half-view cell of the camera, and picking reads the same
  // boxes. Moving vehicles never re-place them, and a pan across cells keeps everything in view where it was.
  // A sign steps to the nearest free side of a label or an earlier sign. A marker leaves the front of its site when another site,
  // a large building, a label, a sign or an earlier marker is there: onto its own building, else beside the front on a
  // stem to its front corner, else onto its own building regardless, so it never stands on another site.
  let overlays=null,overlayBuilds=0;
  // How far down its square an industry's artwork starts, read once per kind and biome from a 32 px thumbnail of its
  // atlas cell, so a low farm stands in the way of fewer markers than a tall mill. Stand-in art counts as a quarter down.
  const artTops=new Map(),topReader=document.createElement('canvas').getContext('2d',{willReadFrequently:true});topReader.canvas.width=topReader.canvas.height=32;
  function artTop(kind,core=false){
    const key=`${kind}:${game.biome}:${core}`;let top=artTops.get(key);if(top!==undefined)return top;
    top=.25;try{topReader.clearRect(0,0,32,32);if((core?drawRasterFarmCore:drawRasterIndustry)(topReader,kind,game.biome,1,{size:32})){const alpha=topReader.getImageData(0,0,32,32).data;let row=0;while(row<31&&!alpha.subarray(row*128,row*128+128).some((a,i)=>i%4===3&&a>24))row++;top=row/32;artTops.set(key,top);}}catch{}
    return top;
  }
  function placeOverlays(){
    ensureRevision();
    // Only places within half a view (and a margin for tall art) of any view the cell can show are placed, so the choices
    // in view never depend on the cell. They are found on the flat grid first: remote terrain is never sampled.
    const z=camera.zoom,o=cameraPoint(),cellX=Math.floor(o.x*z/(W/2)),cellY=Math.floor(o.y*z/(H/2)),key=[z,W,H,dpr,cellX,cellY,layers.names,layers.stations,layers.industryIcons,layers.buildings,structureRevision,siteRevision,cachedWorldAssets,document.fonts?.status].join();
    if(overlays?.key===key&&overlays.game===game)return overlays;
    const x0=(cellX-2)*W/2-256,x1=(cellX+3)*W/2+256,y0=(cellY-2)*H/2-256,y1=(cellY+3)*H/2+256+MAX_HEIGHT*heightStep*z,near=(site,span=1)=>{const x=(site.x-site.y)*TILE*z,y=(site.x+site.y+span)*TILE/2*z;return x>x0&&x<x1&&y>y0&&y<y1;};
    const grid=createOverlayGrid(64),labels=new Map(),signs=new Map(),markers=new Map(),stats={labels:0,signs:0,movedSigns:0,front:0,own:0,side:0},size=signSize();
    const at=(x,y)=>{const p=projectTile(x,y);return{x:p.x*z,y:p.y*z};},sign=st=>{const q=signTile(st),p=at(q.x,q.y),bullets=detailLevel==='region'?0:bulletsWidth(st);return{x:p.x+8*z+7-size/2,y:p.y-signLift(st)*z+7-size/2,size,w:bullets?size/2+(ROUNDEL[detailLevel]||ROUNDEL.town)+3+bullets:size};},pad=r=>({x:r.x-2,y:r.y-2,w:r.w+4,h:r.h+4});
    if(layers.names)for(const city of game.cities||[]){
      if(!near(city))continue;const p=at(city.x,city.y),stops=nearbyStops(city),name=city.name||'New city';let y=p.y-29*z,box;
      if(detailLevel==='region'){ctx.font=font(MAP.nameplate.regionName.weight,MAP.nameplate.regionName.size);const w=ctx.measureText(name).width+20;if(stops)y=clearStopSigns(stops,p.x-w/2-4,w+8,y,14,14,sign);box={x:p.x-w/2-4,y:y-14,w:w+8,h:28};if(grid.find(box))continue;}
      else{const w=nameplate(city).w;if(stops)y=clearStopSigns(stops,p.x-w/2,w,y,14,15,sign);box={x:p.x-w/2,y:y-14,w,h:29};}
      labels.set(city,grid.add({...box,kind:'label',owner:city,cx:p.x,cy:y}));stats.labels++;
    }
    for(const st of game.stations||[]){
      if(!near(st))continue;const q=signTile(st),p=at(q.x,q.y),d=sign(st),home={x:d.x,y:d.y,w:size,h:size},blocker=r=>grid.find(pad(r),item=>item.kind!=='site');let placed=home;
      const r=layers.stations&&blocker(home);if(r){const mid=r.y+(r.h-size)/2,away=c=>Math.hypot(c.x-home.x,c.y-home.y);placed=[{x:r.x+r.w+4,y:mid,w:size,h:size},{x:home.x,y:r.y-size-4,w:size,h:size},{x:r.x-size-4,y:mid,w:size,h:size},{x:home.x,y:r.y+r.h+4,w:size,h:size}].sort((a,b)=>away(a)-away(b)).find(c=>!blocker(c))||home;}
      const entry={...placed,kind:'sign',owner:st,size,stem:placed===home?null:{x:p.x,y:p.y-4*z}};signs.set(st.y*game.width+st.x,entry);
      if(layers.stations){grid.add(entry);stats.signs++;if(entry.stem)stats.movedSigns++;}
    }
    const mark=detailLevel==='detail'?28:24,mw=mark+8,mh=mark+6,sites=(game.industries||[]).filter(ind=>near(ind,industrySize(ind))).map(ind=>{
      const span=industrySize(ind);
      if(isLargeFarm(ind)){const core=farmCore(ind),c=projectGround(game,ind.x+span/2,ind.y+span/2),barn=foundationPoint(core.x,core.y,2),gate=projectGround(game,core.x+1,ind.y+span-.12);return{ind,span,cx:c.x*z,cy:c.y*z,height:surfaceHeight(game,ind.x+span/2,ind.y+span/2),barn:{x:barn.x*z,y:barn.y*z},gate:{x:gate.x*z,y:gate.y*z}};}
      const c=foundationPoint(ind.x,ind.y,span);return{ind,span,cx:c.x*z,cy:c.y*z,height:foundationHeight(ind.x,ind.y,span)};
    });
    if(layers.buildings)for(const s of sites){
      if(s.barn){grid.add(siteShape(s.cx,s.cy,32*s.span*z,16*s.span*z,16*s.span*z,s.ind));grid.add(siteShape(s.barn.x,s.barn.y,64*z,32*z,2*(36-48*artTop(s.ind.kind,true))*z,s.ind));}
      else grid.add(siteShape(s.cx,s.cy,32*s.span*z,16*s.span*z,s.span*(36-48*artTop(s.ind.kind))*z,s.ind));
    }
    for(const {ind,span,cx,cy,height,barn,gate} of sites){
      // Taken: the box meets another overlay, or the centre stands on another site's outline, footprint or a large building.
      const taken=c=>{
        if(grid.find(pad({x:c.x-mw/2,y:c.y-mh/2,w:mw,h:mh}),item=>item.kind!=='site'&&item.owner!==ind))return true;
        if(!layers.buildings)return false;if(grid.find({x:c.x-4,y:c.y-4,w:8,h:8},item=>item.kind==='site'&&item.owner!==ind&&insideShape(item,c.x,c.y,4)))return true;
        const g=unprojectPoint(c.x/z,c.y/z+height*heightStep),tx=Math.floor(g.x/TILE),ty=Math.floor(g.y/TILE);if(!tile(tx,ty))return false;
        const other=industryIndex.get(ty*game.width+tx);return other?other!==ind:buildingSize(buildingSiteAt(tx,ty)?.building)>1;
      };
      const front={x:gate?.x??cx,y:(gate?.y??cy+16*span*z)+5+mh/2},own={x:barn?.x??cx,y:barn?barn.y-20*z:cy-10*span*z},placed=[front,own,{x:front.x-mw-4,y:front.y},{x:front.x+mw+4,y:front.y}].find(c=>!taken(c))||own,place=placed===front?'front':placed===own?'own':'side';
      markers.set(ind.y*game.width+ind.x,{x:placed.x,y:placed.y,size:mark,place,stem:place==='side'?{x:front.x,y:front.y-5-mh/2}:null});stats[place]++;
      if(layers.industryIcons)grid.add({kind:'marker',owner:ind,x:placed.x-mw/2,y:placed.y-mh/2,w:mw,h:mh});
    }
    overlays={key,game,labels,signs,markers,stats};overlayBuilds++;return overlays;
  }
  // Stop signs float above their tile. The topmost sign within two pixels wins;
  // failing that, the sign whose centre is nearest, if its box lies within slop.
  function stationAtMarker(clientX,clientY,{slop=0}={}){
    if(!layers.stations&&!stopPickingMode)return null;
    const rect=canvas.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top,stations=game.stations||[];let best=null,nearest=Infinity;
    for(let i=stations.length-1;i>=0;i--){
      const st=stations[i],q=signTile(st);if(!visible(q.x,q.y))continue;
      if(stopPickingMode&&st.mode!==stopPickingMode)continue;
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
    const shown=v=>{const route=routesById.get(v.routeId);return route&&(route.mode==='air'?airPoses.has(v):route.mode==='water'||!isUndergroundAt(game,v.x,v.y))?route:null;};
    if(layers.vehicleLoads)for(let i=frameVehicles.length-1;i>=0;i--){const v=frameVehicles[i],route=shown(v);if(!route||!carrierVisible(v,route,40))continue;const b=badgeRect(v,route);if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h)return presentationSources.get(v)||v;}
    let best=null,nearest=Infinity;
    for(let i=frameVehicles.length-1;i>=0;i--){
      const v=frameVehicles[i],route=shown(v);if(!route)continue;
      const p=carrierPoint(v,route),reach=(route.mode==='water'?Math.max(20,20*camera.zoom):Math.max(10,14*camera.zoom))+slop,d=Math.hypot(x-p.x,y-p.y);
      if(d<=reach&&d<nearest){best=v;nearest=d;}
    }
    return best&&(presentationSources.get(best)||best);
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
      if(opaqueAt(hit.image,sx,sy))return{x:hit.tx,y:hit.ty};
    }
    return picked;
  }
  function setGame(next){lastSceneCamera=null;lastCameraMotion=-Infinity;game=next;presentationMotion=null;presentationDay=null;presentationSources=new WeakMap();frameVehicles.length=0;airPoses.clear();clearChunks();palette=PALETTES[game.biome]||PALETTES.taiga;updateRaster(true);cachedBiome=game.biome;cachedSeed=game.seed;cachedRevision=-1;minimapRevision=-1;const first=game.cities?.[0];if(first)focus(first.x+4.5,first.y-4.5);else bounds();}
  const natureVariant=(x,y,t)=>placedNatureVariant(game,x,y,t);
  const natureDensity=(x,y,t)=>placedNatureDensity(game,x,y,t);
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
      const ap=airportIndex.get(id);hash=Math.imul(hash^code(ap?.id)^(ap?.axis==='y'?0x9e37:0),16777619);
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
    paintGrassGround(c,b,tile,game.biome,game.seed||0,detailLevel);
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
    if(!layers.trees)return {waterPath,coasts};
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y);if(detailLevel==='region'||t.terrain==='water'||t.building||t.road||t.rail||airportIndex.get(y*game.width+x)||!groundIsFlat(game,x,y))continue;
      const r=rng(x*3461+y*3727);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(tile(x+dx,y+dy)?.terrain==='water'&&r()>(t.terrain==='forest'||['marsh','reeds','oasis'].includes(t.detail)?.6:.94)){for(let j=0;j<3;j++){const px=(x+.5)*TILE+dx*14+(dy?r()*12-6:0),py=(y+.5)*TILE+dy*14+(dx?r()*12-6:0);line(c,[[px,py],[px-1,py-3-r()*2]],'#71886b',1);}}
    }
    return {waterPath,coasts};
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
  // Road tiles joined into a block (2 × 2, 2 × 3 and larger) are one paved square, like a town square or car park:
  // a tile belongs to it when any 2 × 2 square around it is all plain road.
  const plainRoad=(x,y)=>{const n=tile(x,y);return Boolean(n?.road&&!n.rail&&!n.bridge&&!n.tunnel&&n.terrain!=='water'&&n.terrain!=='mountain');};
  const pavedSquare=(x,y)=>[[-1,-1],[0,-1],[-1,0],[0,0]].some(([ox,oy])=>plainRoad(x+ox,y+oy)&&plainRoad(x+ox+1,y+oy)&&plainRoad(x+ox,y+oy+1)&&plainRoad(x+ox+1,y+oy+1));
  // One asphalt surface without lanes; a kerb and parking bays where it meets land, open where a street joins it.
  function paveSquare(c,x,y,px,py){
    c.fillStyle='#6b6a66';c.fillRect(px,py,TILE,TILE);
    for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]){
      if(tile(x+dx,y+dy)?.road)continue;
      const ex=dx>0?px+TILE:px,ey=dy>0?py+TILE:py,along=dx?[0,1]:[1,0],inward=[-dx,-dy];
      const edge=(o,d)=>[ex+along[0]*o+inward[0]*d,ey+along[1]*o+inward[1]*d];
      if(detailLevel!=='region')for(let o=4;o<TILE;o+=8)line(c,[edge(o,2),edge(o,10)],'#d6d2c299',.8);
      line(c,[edge(0,1),edge(TILE,1)],'#c9c2aa',2);
    }
  }
  // A public road beside a building or a zone is a town street: paved sidewalks, lamps and bins.
  const townStreet=(x,y,t)=>Boolean(t.road&&t.publicRoad&&!t.bridge&&!t.tunnel&&t.terrain!=='water')&&[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]].some(([dx,dy])=>buildingSiteAt(x+dx,y+dy)||tile(x+dx,y+dy)?.zone);
  // A lamp on every other tile and now and then a bin, on the sidewalk beside the carriageway (tile pixels).
  function streetFurniture(x,y){
    const [n,e,s,w]=[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>Boolean(tile(x+dx,y+dy)?.road)),items=[];
    if((x+y)%2===0)items.push(['lamp',e||w?[16+(e?6:-6),5]:[27,16+(s?6:-6)]]);
    if((x*7+y*13)%5===0)items.push(['bin',e||w?[16+(w?-6:6),27]:[5,16+(n?-6:6)]]);
    return items;
  }
  function drawLamp(p){
    ctx.fillStyle='#2f37332a';ctx.beginPath();ctx.ellipse(p.x+1,p.y+.3,1.8,.7,0,0,TAU);ctx.fill();
    ctx.fillStyle='#38403c';ctx.fillRect(p.x-.6,p.y-15,1.2,15);ctx.fillRect(p.x-.6,p.y-15.6,3.6,1.1);
    ctx.fillStyle='#f4e7b0';ctx.fillRect(p.x+1.7,p.y-14.6,1.7,1.2);
  }
  function drawBin(p){
    ctx.fillStyle='#2f37332a';ctx.beginPath();ctx.ellipse(p.x+.6,p.y+.3,2,.8,0,0,TAU);ctx.fill();
    ctx.fillStyle='#4e6a57';ctx.fillRect(p.x-1.4,p.y-4,2.8,4);ctx.fillStyle='#6f8c78';ctx.fillRect(p.x-1.6,p.y-4.6,3.2,.9);
  }
  function network(c,x,y,t,mode,elevated=false){
    if(!t[mode])return;const px=x*TILE,py=y*TILE,cx=px+16,cy=py+16;
    if(mode==='road'&&!elevated&&pavedSquare(x,y)){paveSquare(c,x,y,px,py);return;}
    const neighbors=[[0,-1],[1,0],[0,1],[-1,0]].filter(([dx,dy])=>{
      const adjacent=tile(x+dx,y+dy);if(!adjacent?.[mode])return false;
      return networkEdgeAllowed(t,adjacent,dx,dy,mode,game,x,y);
    });
    const isolatedAxis=t.structureAxis||(!neighbors.length?networkTerrainShape(game,x,y).axis:null);
    const arms=neighbors.length?neighbors:isolatedAxis==='x'?[[-1,0],[1,0]]:[[0,-.48],[0,.48]];
    if(buried(t)){tunnelPortal(c,x,y,t,mode);return;}
    const bridge=t.terrain==='water'||t.bridge;const tunnel=!bridge&&(t.terrain==='mountain'||t.tunnel);
    const textured=!tunnel&&hasRasterNetwork(mode+(bridge?'-bridge':''));
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
    else{
      if(mode==='road'&&townStreet(x,y,t)){
        stroke('#a8a28c',27);stroke('#d3cdb6',25);
        if(detailLevel!=='region')for(const [dx,dy]of arms)for(let k=4;k<16;k+=4)for(const side of [-1,1]){const ox=dy*side*10.5,oy=-dx*side*10.5;line(c,[[cx+dx*k+ox-dy*side*1.5,cy+dy*k+oy+dx*side*1.5],[cx+dx*k+ox+dy*side*1.5,cy+dy*k+oy-dx*side*1.5]],'#b9b29a',.5);}
      }
      stroke(mode==='road'?'#b5a587':textured?'#796f5c':'#b6b698',mode==='road'?18:10);
    }
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
      // An ecology change waits for this frame's share; until then the chunk keeps its last picture.
      if(entry.lazy){if(lazyChunkBudget<=0){lazyChunksWaiting++;return entry;}lazyChunkBudget--;entry.lazy=false;}
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
    const {waterPath,coasts}=drawGround(c,b);
    entry.waterMotion=prepareWaterMotion({x0:cx*CHUNK_TILES,y0:cy*CHUNK_TILES,x1:Math.min(game.width,(cx+1)*CHUNK_TILES),y1:Math.min(game.height,(cy+1)*CHUNK_TILES)},coasts,tile,game.seed||0,detailLevel,waterPath,{pixelScale:rasterScale});
    waterMotionBuilds++;
    if(layers.buildings)paintFarmFields(c,b,(x,y)=>industryIndex.get(y*game.width+x),game.biome,game.seed||0);
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
      const t=tile(x,y),occupied=(layers.buildings&&siteAt(x,y))||terrainSiteAt(x,y);
      if(layers.zones&&t.zone&&!occupied){
        const color=t.zone==='residential'?'#e6e9b5':t.zone==='commercial'?'#c0d9db':'#e3c795';
        // Vacant plots remain tinted and outlined for zoning interactions. Their
        // authored lawn, paving and gravel are baked with the other ground art.
        c.save();c.beginPath();c.rect(x*TILE+2,y*TILE+2,28,28);c.clip();c.globalAlpha=detailLevel==='region'?.38:.65;
        drawRasterZone(c,t.zone,x*TILE,y*TILE,TILE,rasterScale);c.restore();
        c.fillStyle=color+'45';c.fillRect(x*TILE+2,y*TILE+2,28,28);c.strokeStyle=color+'b0';c.lineWidth=.7;c.setLineDash([3,3]);c.strokeRect(x*TILE+3,y*TILE+3,26,26);c.setLineDash([]);
      }
      if(!t.bridge&&t.terrain!=='water')for(const mode of ['road','rail'])if(layers[mode==='road'?'roads':'rails']&&!bridgeApproaches(x,y,t,mode).length)network(c,x,y,t,mode);
    }
    // An airport's field, runway and apron are ground, baked once like roads and rails; the mesh keeps only this chunk's cells.
    if(layers.stations&&airports.length){const painted=new Set();for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){const ap=airportIndex.get(y*game.width+x);if(!ap||painted.has(ap))continue;painted.add(ap);c.save();c.translate(ap.x*TILE,ap.y*TILE);paintAirportGround(c,{axis:ap.axis,biome:game.biome,detail:detailLevel,seed:(ap.x*31+ap.y)>>>0});c.restore();}}
    const m=entry.mesh.getContext('2d');m.setTransform(1,0,0,1,0,0);m.clearRect(0,0,entry.mesh.width,entry.mesh.height);m.scale(scale,scale);m.translate(-entry.meshX,-entry.meshY);m.imageSmoothingEnabled=true;m.imageSmoothingQuality='low';
    drawTerrainMesh(m,{game,heightStep,canvas:terrainSourceCanvas,sourceX:entry.x,sourceY:entry.y,sourceScale:scale,bounds:{x0:cx*CHUNK_TILES,y0:cy*CHUNK_TILES,x1:(cx+1)*CHUNK_TILES,y1:(cy+1)*CHUNK_TILES}});
    composedChunks++;return entry;
  }
  function drawWorld(x0,y0,x1,y1){
    waterMotionChunks.length=0;
    // Keep a whole visible frame resident instead of reducing raster quality.
    // Budget grows with the viewport, bounded even on a huge map. At 4K/DPR2
    // Detail this includes its border chunks without repeatedly evicting them.
    const across=Math.ceil(x1/CHUNK_TILES)-Math.floor(x0/CHUNK_TILES),down=Math.ceil(y1/CHUNK_TILES)-Math.floor(y0/CHUNK_TILES);
    const frameBytes=across*down*Math.ceil((CHUNK_PIXELS*2+4)*rasterScale)*Math.ceil((CHUNK_PIXELS+MAX_HEIGHT*heightStep+4)*rasterScale)*4;
    cacheLimit=Math.min(CACHE_MAX,Math.max(CACHE_BASE,Math.ceil(frameBytes*1.1)));
    while(cacheBytes>cacheLimit&&chunks.size){const oldest=chunks.keys().next().value,item=chunks.get(oldest);cacheBytes-=item.bytes;item.mesh.width=item.mesh.height=0;chunks.delete(oldest);}
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='low';
    for(let cy=Math.floor(y0/CHUNK_TILES);cy<Math.ceil(y1/CHUNK_TILES);cy++)for(let cx=Math.floor(x0/CHUNK_TILES);cx<Math.ceil(x1/CHUNK_TILES);cx++){if(!visible(cx*CHUNK_TILES+CHUNK_TILES/2-.5,cy*CHUNK_TILES+CHUNK_TILES/2-.5,CHUNK_PIXELS*camera.zoom+80))continue;const entry=drawChunk(cx,cy,rasterScale);ctx.drawImage(entry.mesh,entry.meshX,entry.meshY,entry.mesh.width/rasterScale,entry.mesh.height/rasterScale);if(entry.waterMotion?.waves.length||entry.waterMotion?.shores.length)waterMotionChunks.push(entry.waterMotion);}
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
    paintTerrainTile(ctx,approachCanvas,{game,heightStep,x,y,surface,sourceX,sourceY,sourceScale:rasterScale,shade:false});
  }
  function drawRaisedNetwork(x,y,t,mode){
    const h=transportHeight(game,x,y,mode),base=projectTile(x,y),deck=transportPoint(x,y,mode),drop=base.y-deck.y;
    bridgeHits.push({x,y,height:h,axis:bridgeSurface(game,x,y,mode)?.axis||t.structureAxis||'y'});
    if(drop>2){
      ctx.fillStyle='#293e3935';ctx.beginPath();ctx.ellipse(base.x+3,base.y+2,11,4,0,0,TAU);ctx.fill();
      for(const side of [-5,5]){line(ctx,[[deck.x+side,deck.y+2],[base.x+side,base.y]],side<0?'#9b9e85':'#68735f',3);line(ctx,[[base.x+side-3,base.y],[base.x+side+3,base.y]],'#68735f',2);}
    }
    ctx.save();ctx.translate(0,-h*heightStep);groundTransform(ctx);network(ctx,x,y,t,mode,true);ctx.restore();
  }
  // Raised plots stand on irregular rubble-stone walls. Terrain boundaries and
  // shading are cached per plot; small stone materials are shared across walls.
  const WALL={taiga:{top:'#9caa85',faces:['#7b8067','#9a9a80'],lip:'#bbc3a2'},tundra:{top:'#bfc9b9',faces:['#858d86','#a4aba2'],lip:'#d7dece'},desert:{top:'#c7b58d',faces:['#a88d63','#c4a878'],lip:'#d5c59e'}};
  function drawFoundation(x,y,span,terrainGarden=false){
    const height=foundationHeight(x,y,span),top=(u,v)=>{const p=projectPoint(u*TILE,v*TILE);p.y-=height*heightStep;return p;};
    const entry=foundations.get((y*game.width+x)*8+span);
    if(!entry.paths){
      const corners=[[x,y],[x+span,y],[x+span,y+span],[x,y+span]],heights=corners.map(([u,v])=>surfaceHeight(game,u,v)),wall=WALL[game.biome]||WALL.taiga;
      entry.paths=[];entry.walls=[];
      if(height-Math.min(...heights)<.06)return;
      const surface=new Path2D();corners.forEach(([u,v],i)=>{const p=top(u,v);i?surface.lineTo(p.x,p.y):surface.moveTo(p.x,p.y);});surface.closePath();
      entry.paths.push({path:surface,color:wall.top});
      for(const side of [0,1]){
        const edge=Array.from({length:span+1},(_,n)=>side?[x+n,y+span]:[x+span,y+n]),tops=edge.map(([u,v])=>top(u,v)),grounds=edge.map(([u,v])=>projectGround(game,u,v));
        const path=new Path2D();
        tops.forEach((p,i)=>i?path.lineTo(p.x,p.y):path.moveTo(p.x,p.y));
        for(const p of grounds.toReversed())path.lineTo(p.x,p.y);
        path.closePath();entry.paths.push({path,color:wall.faces[side]});
        const drop=Math.max(...grounds.map((p,i)=>p.y-tops[i].y)),lip=new Path2D();
        tops.forEach((p,i)=>i?lip.lineTo(p.x,p.y):lip.moveTo(p.x,p.y));
        const low=Math.max(...grounds.map(p=>p.y)),high=Math.min(...tops.map(p=>p.y)),shade=ctx.createLinearGradient(0,high,0,low);
        shade.addColorStop(0,'rgba(24,34,26,0)');shade.addColorStop(1,'rgba(24,34,26,.3)');
        const seed=Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(span,83492791)^(game.seed||0);
        entry.walls.push({path,tops,drop,side,seed,lip,shade,wall});
      }
    }
    for(const {path,color} of entry.paths){ctx.fillStyle=color;ctx.fill(path);}
    if(terrainGarden&&entry.paths.length){
      const bounds={x0:x,y0:y,x1:x+span,y1:y+span};
      if(entry.gardenRevision!==cachedRevision||entry.gardenScale!==rasterScale||entry.gardenDetail!==detailLevel){
        const reach={x0:Math.max(0,x-2),y0:Math.max(0,y-2),x1:Math.min(game.width,x+span+2),y1:Math.min(game.height,y+span+2)};
        entry.gardenKey=`${x}:${y}:${span}:${rasterScale}:${detailLevel}:${fingerprint(reach)}`;entry.gardenRevision=cachedRevision;entry.gardenScale=rasterScale;entry.gardenDetail=detailLevel;
      }
      let image=gardenSurfaces.get(entry.gardenKey);
      if(!image){
        image=document.createElement('canvas');image.width=image.height=Math.ceil(TILE*span*rasterScale);
        const c=image.getContext('2d');c.scale(rasterScale,rasterScale);c.translate(-x*TILE,-y*TILE);drawGround(c,bounds);gardenSurfaces.set(entry.gardenKey,image);
      }
      // A sloped parcel is levelled for its house. Replay the exact same
      // world-anchored grass/color field on that raised garden, rather than
      // revealing the old flat foundation tint through the lawn cutout.
      ctx.save();ctx.clip(entry.paths[0].path);ctx.translate(0,-height*heightStep);groundTransform(ctx);
      ctx.drawImage(image,x*TILE,y*TILE,TILE*span,TILE*span);ctx.restore();
    }
    if(!entry.walls?.length)return;
    ctx.save();ctx.lineCap='butt';
    for(const face of entry.walls){
      const {path,lip,shade,wall}=face;
      paintFoundationStones(ctx,face,game.biome,rasterScale);
      ctx.fillStyle=shade;ctx.fill(path);
      ctx.globalAlpha=.5;ctx.strokeStyle=wall.lip;ctx.lineWidth=.65;ctx.stroke(lip);ctx.globalAlpha=1;
    }
    ctx.restore();
  }
  function visibleFlat(x,y,margin=70){
    const origin=cameraPoint(),sx=((x-y)*TILE-origin.x)*camera.zoom+W/2,sy=((x+y+1)*TILE/2-origin.y)*camera.zoom+H/2;
    return sx>-margin&&sx<W+margin&&sy>-margin&&sy<H+margin+MAX_HEIGHT*heightStep*camera.zoom;
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
      ctx.fillStyle='#263c35';roundRect(ctx,-9,-4.5,18,9,2);ctx.fill();ctx.fillStyle=lineFor(route).fill;roundRect(ctx,-8,-3.5,16,7,2);ctx.fill();
      ctx.fillStyle='#e9ddbd';ctx.fillRect(-6,-2.5,10,5);ctx.fillStyle='#426878';ctx.fillRect(4,-2.5,2,5);
      if(train&&engine){ctx.fillStyle='#526361';ctx.fillRect(-2,-2,4,4);}
    }
    ctx.restore();
  }
  function ship(v,route){const p=transportPoint(v.x,v.y,'water');ctx.drawImage(marine.ship({...v,angle:projectAngle(v.angle||0)},route),p.x-MARINE_SIZE/2,p.y-MARINE_SIZE/2,MARINE_SIZE,MARINE_SIZE);}
  function billboard(image,x,y,w,h,tx,ty){
    if(!visibleRectangle(x,y,w,h))return;
    // Authored art is filtered once into a bitmap at this view's density.
    // Keep its native pixels through both direct drawing and scenery batches;
    // fractional display scales may have rounded the prepared dimensions.
    const native=Math.abs(image.width-w*rasterScale)<=.51&&Math.abs(image.height-h*rasterScale)<=.51;
    if(native){
      const width=image.width/rasterScale,height=image.height/rasterScale;
      x=Math.round((x+(w-width)/2)*rasterScale)/rasterScale;
      y=Math.round((y+h-height)*rasterScale)/rasterScale;
      w=width;h=height;
    }
    ctx.save();ctx.imageSmoothingEnabled=!native;if(!native)ctx.imageSmoothingQuality='high';
    ctx.drawImage(image,x,y,w,h);ctx.restore();
    // Ambient stones and plants use the same sampling without adding a hit.
    if(tx===undefined)return;
    if(capturedBillboards){capturedBillboards.push({image,x,y,w,h,tx,ty,world:true});return;}
    const origin=cameraPoint();
    objectHits.push({image,x:(x-origin.x)*camera.zoom+W/2,y:(y-origin.y)*camera.zoom+H/2,w:w*camera.zoom,h:h*camera.zoom,tx,ty});
  }
  function farmCoreSprite(kind){
    const density=rasterScale*1.5,key=`farm-core:${game.biome}:${detailLevel}:${density}:${kind}`,cached=preparedSprites.get(key);
    if(cached)return cached;
    const image=document.createElement('canvas');image.width=Math.max(1,Math.round(64*density));image.height=Math.max(1,Math.round(72*density));
    const c=image.getContext('2d');c.scale(image.width/64,image.height/72);c.translate(0,8);
    if(!drawRasterFarmCore(c,kind,game.biome,density,{size:64})){c.scale(2,2);drawNativeFarmCore(c,kind,rng(1937+kind.length*787),game.biome,detailLevel);}
    preparedSprites.set(key,image);return image;
  }
  function visibleRectangle(x,y,w,h){
    // Retain the filtering gutter at fractional display densities. The scene's
    // broad anchor margin keeps tall objects available; actual sprite bounds
    // avoid submitting fully clipped images around the edge of a dense view.
    const b=sceneViewBounds;return !b||x+w>b.left-2&&x<b.right+2&&y+h>b.top-2&&y<b.bottom+2;
  }
  function drawScenery(b,routesById){
    const traffic=frameVehicles.some(v=>{const mode=routesById.get(v.routeId)?.mode;return mode!=='water'&&(mode!=='air'||airPoses.get(v)?.pose.ground);});
    const bytes=canvas.width*canvas.height*4,origin=cameraPoint(),sceneKey=[camera.zoom,rasterScale,W,H].join(',');
    const key=`${origin.x},${origin.y},${camera.zoom},${W},${H},${dpr},${cachedRevision}`;
    const sourceDraws=sceneryView?.key===key&&sceneryView.scene===sceneCache&&sceneryView.layers===layers?sceneryView.sourceDraws:sceneryBatchDraws+sceneryDirectDraws;
    const sparse=sourceDraws<sceneryViewMinimumDraws(bytes);
    const ready=!stopPickingMode&&sceneryBatching&&options.sceneryViewCaching!==false&&!traffic&&!sparse&&bytes<=sceneryViewLimit&&lastSceneCamera?.key===sceneKey&&lastSceneCamera.x===origin.x&&lastSceneCamera.y===origin.y&&sceneCache?.key===sceneKey&&sceneCache.batchPlanReady&&!sceneCache.dirty&&!sceneCache.shadowPreparation&&sceneCache.pendingIndex>=sceneCache.pendingGroups.length&&performance.now()-lastCameraMotion>=sceneryPanSettleMs;
    if(!ready){if((traffic||sparse)&&sceneryView){sceneryView.image.width=sceneryView.image.height=0;sceneryView=null;}drawScene(b,routesById);return;}
    if(sceneryView?.key!==key||sceneryView.scene!==sceneCache||sceneryView.layers!==layers){
      const image=sceneryView?.image||document.createElement('canvas');
      image.width=canvas.width;image.height=canvas.height;
      const target=image.getContext('2d'),main=ctx;
      target.setTransform(main.getTransform());
      for(const prop of ['fillStyle','strokeStyle','lineWidth','lineCap','lineJoin','miterLimit','lineDashOffset','globalAlpha','globalCompositeOperation','imageSmoothingEnabled','imageSmoothingQuality'])target[prop]=main[prop];
      target.setLineDash(main.getLineDash());ctx=target;
      try{drawScene(b,routesById);}finally{ctx=main;}
      sceneryView={key,image,scene:sceneCache,layers,sourceDraws:sceneryBatchDraws+sceneryDirectDraws,hits:objectHits,bridges:bridgeHits};sceneryViewBuilds++;
    }else{objectHits=sceneryView.hits;bridgeHits=sceneryView.bridges;sceneryBatchDraws=1;sceneryDirectDraws=0;sceneryPreparationMs=0;}
    // The layer was painted with the exact world-to-display transform. Copy it
    // at native pixels; animated water, air traffic and overlays stay separate.
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.imageSmoothingEnabled=false;ctx.drawImage(sceneryView.image,0,0);ctx.restore();sceneryViewDraws++;
  }
  function drawScene(b,routesById){
    objectHits=[];bridgeHits=[];
    const origin=cameraPoint(),key=[camera.zoom,rasterScale,W,H].join(','),frameTime=performance.now();
    if(lastSceneCamera&&(lastSceneCamera.x!==origin.x||lastSceneCamera.y!==origin.y||lastSceneCamera.key!==key))lastCameraMotion=frameTime;
    lastSceneCamera={x:origin.x,y:origin.y,key};sceneryWaitingForCamera=frameTime-lastCameraMotion<sceneryPanSettleMs;
    sceneViewBounds={left:origin.x-W/(2*camera.zoom),right:origin.x+W/(2*camera.zoom),top:origin.y-H/(2*camera.zoom),bottom:origin.y+H/(2*camera.zoom)};
    const reused=sceneCache?.key===key&&Math.abs(origin.x-sceneCache.x)<=SCENE_PAN_MARGIN&&Math.abs(origin.y-sceneCache.y)<=SCENE_PAN_MARGIN;
    let objects=reused?sceneCache.objects:[],shadows=reused?sceneCache.shadows:[],cullPoint=null;
    // Static objects and shadows carry the tile that made them (-1 for none), so an ecology day can replace just its tiles.
    let sceneTile=-1,dimEligible=false;
    const add=(x,y,draw,priority=0,bounds=null)=>objects.push({depth:x+y,x,priority,draw,point:cullPoint,bounds,tile:sceneTile,dimEligible});
    const spriteBounds=(x,y,w,h)=>({left:x,top:y,right:x+w,bottom:y+h});
    const siteBounds=(x,y,span,center)=>{const b=spriteBounds(center.x-24*span,center.y-36*span-12,48*span,48*span+12);for(let n=0;n<=span;n++)for(const [u,v]of [[x+n,y],[x+n,y+span],[x,y+n],[x+span,y+n]]){const p=projectGround(game,u,v);b.left=Math.min(b.left,p.x);b.right=Math.max(b.right,p.x);b.top=Math.min(b.top,p.y);b.bottom=Math.max(b.bottom,p.y);}return b;};
    const addShadow=draw=>shadows.push({draw,point:cullPoint,tile:sceneTile});
    const compare=(a,b)=>a.depth-b.depth||a.x-b.x||a.priority-b.priority;
    // Equal keys keep the build's row-major order, which a patch must reproduce.
    const staticCompare=(a,b)=>compare(a,b)||a.tile-b.tile;
    // An airport's tower, terminal, hangar, depot, masts and windsock are prepared images, each sorted by its front corner.
    const airportHit=(r,ap)=>{if(capturedBillboards){capturedBillboards.push({image:r.image,x:r.x,y:r.y,w:r.w,h:r.h,tx:ap.x,ty:ap.y,world:true});return;}const o=cameraPoint();objectHits.push({image:r.image,x:(r.x-o.x)*camera.zoom+W/2,y:(r.y-o.y)*camera.zoom+H/2,w:r.w*camera.zoom,h:r.h*camera.zoom,tx:ap.x,ty:ap.y});};
    const addAirport=ap=>{
      const own=sceneTile;sceneTile=-1;
      const o=projectPoint(ap.x*TILE,ap.y*TILE);o.y-=surfaceHeight(game,ap.x,ap.y)*heightStep;
      for(const kind of Object.keys(PART_FRONTS)){const [u,v]=PART_FRONTS[kind],w=localToWorld(ap.axis,u,v),dx=ap.x+w.x-.5,dy=ap.y+w.y-.5,box=PART_BOXES[ap.axis][kind];cullPoint=projectTile(dx,dy);add(dx,dy,()=>airportHit(airportSprites.part(ctx,kind,ap.axis,o.x,o.y),ap),0,spriteBounds(o.x+box.left-2,o.y+box.top-2,box.width+4,box.height+4));}
      sceneTile=own;
    };
    // One tile's static objects and shadows. A full build walks every tile in view; a patch only the tiles an ecology day changed.
    const tileScenery=(x,y,uprights,property)=>{
      if(!visible(x,y,(180+SCENE_PAN_MARGIN)*camera.zoom))return;
      sceneTile=y*game.width+x;
      dimEligible=true;
      const t=tile(x,y),id=y*game.width+x,ind=industryIndex.get(id),st=stationIndex.get(id),ap=airportIndex.get(id),p=projectTile(x,y),occupied=layers.buildings&&(ind||buildingSiteAt(x,y)),nature=terrainSiteAt(x,y);
      cullPoint=p;
      if(nature&&!occupied&&!ap&&nature.x===x&&nature.y===y&&(nature.object.kind!=='forest'||layers.trees)){
        const object=nature.object,span=terrainObjectSize(object),center=projectTile(x+(span-1)/2,y+(span-1)/2),layout=natureObjectLayout(span),detail=!layers.trees&&object.detail==='wooded-foothill'?'bare-foothill':object.detail;
        if(object.kind==='forest')addShadow(()=>drawRasterTreeShadows(ctx,{biome:game.biome,detail,variant:object.variant||0,footprint:span,x:center.x-layout.anchorX,y:center.y-layout.anchorY,pixelScale:rasterScale,viewBounds:sceneViewBounds,preparedState:true}));
        add(x+span-1,y+span-1,()=>billboard(sprite(object.kind,object.variant||0,1,detail,span),center.x-layout.anchorX,center.y-layout.anchorY,layout.width,layout.height,x,y),0,spriteBounds(center.x-layout.anchorX,center.y-layout.anchorY,layout.width,layout.height));
      }
      if(!nature&&LANDMARKS.has(t.terrain)&&(t.terrain!=='forest'||layers.trees)&&!occupied&&!ap&&(!t.road||!layers.roads||isEngineeredTunnel(t))&&(!t.rail||!layers.rails||isEngineeredTunnel(t))&&(!t.zone||!layers.zones)&&groundIsFlat(game,x,y)){
        const forest=t.terrain==='forest',variant=natureVariant(x,y,t),density=natureDensity(x,y,t);
        if(forest&&density)addShadow(()=>drawRasterTreeShadows(ctx,{biome:game.biome,detail:t.detail,variant,density,x:p.x-16,y:p.y-24,pixelScale:rasterScale,viewBounds:sceneViewBounds,preparedState:true}));
        if(density)add(x,y,()=>{ctx.globalAlpha*=forest?.94:1;billboard(sprite(t.terrain,variant,density,!layers.trees&&t.detail==='wooded-foothill'?'bare-foothill':t.detail),p.x-(forest?24:16),p.y-(forest?40:30),forest?48:32,forest?48:40,x,y);ctx.globalAlpha=1;},0,spriteBounds(p.x-(forest?24:16),p.y-(forest?40:30),forest?48:32,forest?48:40));
      }
      if(!nature&&!LANDMARKS.has(t.terrain)&&t.terrain!=='mountain'&&t.terrain!=='water'&&!occupied&&!ap&&(!t.road||!layers.roads||isEngineeredTunnel(t))&&(!t.rail||!layers.rails||isEngineeredTunnel(t))&&(!t.zone||!layers.zones)&&groundIsFlat(game,x,y)){
        const scenery=landscapeScenery(game.biome,game.seed||0,x,y,t);
        // Stones and plants are already authored from the fixed camera. Keep
        // them upright; baking stones into ground would project them twice.
        if(scenery&&(scenery.kind==='stone'||layers.trees))add(x,y,()=>{if(!visibleRectangle(p.x-16,p.y-28,32,40))return;ctx.globalAlpha*=scenery.alpha;billboard(sprite('terrain-detail',natureVariant(x,y,t),1,scenery.detail),p.x-16,p.y-28,32,40);ctx.globalAlpha=1;},0,spriteBounds(p.x-16,p.y-28,32,40));
      }
      if(layers.buildings&&t.building){const variant=t.variant??x*13+y,level=t.building.level||1,legacy=t.building.kind,kind=['house','apartment'].includes(legacy)?residentialKind(variant,level):['shop','office'].includes(legacy)?commercialKind(variant,level):legacy,span=buildingSize(t.building),center=foundationPoint(x,y,span);add(x+span-1,y+span-1,()=>{drawFoundation(x,y,span,kind.startsWith('house-'));billboard(uprightSprite(kind,variant,level,'',span),center.x-24*span,center.y-36*span-12,48*span,48*span+12,x,y);},0,()=>siteBounds(x,y,span,center));}
      if(layers.buildings&&t.building&&(t.building.owner==='player'||t.zone))property?.push({x,y,span:buildingSize(t.building),owned:t.building.owner==='player'});
      if(layers.buildings&&isLargeFarm(ind)){
        const core=farmCore(ind);
        if(x===core.x&&y===core.y){const center=foundationPoint(x,y,core.span);add(x+1,y+1,()=>{drawFoundation(x,y,2);billboard(farmCoreSprite(ind.kind),center.x-48,center.y-84,96,108,ind.x,ind.y);},0,()=>siteBounds(x,y,2,center));}
        for(const section of farmFenceSections(ind,x,y)){
          const a=projectGround(game,...section.a),z=projectGround(game,...section.b),u=(section.a[0]+section.b[0])/2,v=(section.a[1]+section.b[1])/2;
          add(u-.5,v-.5,()=>paintFarmFence(ctx,section,(px,py)=>projectGround(game,px,py),game.biome),1,spriteBounds(Math.min(a.x,z.x)-2,Math.min(a.y,z.y)-7,Math.abs(a.x-z.x)+4,Math.abs(a.y-z.y)+9));
        }
        for(const object of farmFieldObjects(ind,x,y,game.seed||0)){
          const point=projectGround(game,object.x,object.y);
          add(object.x-.5,object.y-.5,()=>paintFarmFieldObject(ctx,object,point,game.biome),0,spriteBounds(point.x-8,point.y-17,16,20));
        }
      }else if(layers.buildings&&ind&&ind.x===x&&ind.y===y){const span=industrySize(ind),center=foundationPoint(x,y,span);add(x+span-1,y+span-1,()=>{drawFoundation(x,y,span);billboard(uprightSprite(ind.kind,x+y,span),center.x-24*span,center.y-36*span-12,48*span,48*span+12,x,y);},0,()=>siteBounds(x,y,span,center));}
      if(layers.roads&&detailLevel!=='region'&&townStreet(x,y,t)&&!pavedSquare(x,y))for(const [kind,[px,py]] of streetFurniture(x,y)){
        const u=x+px/TILE,v=y+py/TILE,q=projectGround(game,u,v);add(u,v,()=>{if(visibleRectangle(q.x-3,q.y-17,8,18))(kind==='lamp'?drawLamp:drawBin)(q);});
      }
      dimEligible=false;
      for(const mode of ['road','rail'])if(t[mode]&&layers[mode==='road'?'roads':'rails']){
        if(t.bridge||t.terrain==='water')add(x+.05,y+.05,()=>drawRaisedNetwork(x,y,t,mode));
        else{const approaches=bridgeApproaches(x,y,t,mode);if(approaches.length)add(x+.05,y+.05,()=>drawBridgeApproach(x,y,t,mode,approaches));}
      }
      if(layers.stations&&st){
        if(st.mode==='water'){const [dx,dy]=portLandDirection(x,y);add(x,y,()=>infrastructureSprites.port(ctx,dx,dy,p.x,p.y));}
        else if(st.mode!=='air')add(x+.12,y+.12,()=>infrastructureSprites.stop(ctx,st.mode,p.x+11,p.y+2));
      }
      // The first tile of an airport seen adds all its parts, so a half-visible site still stands.
      if(layers.stations&&ap&&!uprights.has(ap)){uprights.add(ap);addAirport(ap);cullPoint=p;}
      if(buried(t))for(const mode of ['road','rail'])if(t[mode]&&layers[mode==='road'?'roads':'rails'])for(const [dx,dy]of portalArms(x,y,t,mode)){
        const mouth=projectTile(x+dx*.18,y+dy*.18);add(x+dx*.18,y+dy*.18,()=>infrastructureSprites.portal(ctx,mode,dx,dy,mouth.x,mouth.y),2);
      }

      sceneTile=-1;
    };
    // A journaled ecology day marks tiles instead of dropping the scene (refreshSurface). Their objects and shadows are made
    // again from the camera the scene was built at, so the result is the scene a rebuild would give; the depth runs they touch
    // are regrouped, and every other prepared strip, and the shadow layer until its successor is ready, stays.
    if(reused&&sceneCache.dirty){
      const scene=sceneCache,dirty=scene.dirty,held={x:camera.x,y:camera.y,height:camera.height},touched=new Set(),within=scene.bounds;scene.dirty=null;
      objects=objects.filter(o=>{if(o.tile<0||!dirty.has(o.tile))return true;touched.add(o.depth);return false;});
      const kept=shadows.length;shadows=shadows.filter(s=>s.tile<0||!dirty.has(s.tile));let shadowsChanged=shadows.length!==kept;
      const count=objects.length,shadowCount=shadows.length,airportsDone=new Set(airports),property=scene.property.filter(site=>!dirty.has(site.y*game.width+site.x));
      Object.assign(camera,scene.camera);
      try{for(const id of dirty){const x=id%game.width,y=(id-x)/game.width;if(x>=within.x0&&x<within.x1&&y>=within.y0&&y<within.y1)tileScenery(x,y,airportsDone,property);}}
      finally{Object.assign(camera,held);cullPoint=null;}
      scene.property=property.sort((a,b)=>a.y-b.y||a.x-b.x);
      for(let i=count;i<objects.length;i++)touched.add(objects[i].depth);
      if(shadows.length!==shadowCount){shadowsChanged=true;shadows.sort((a,b)=>a.tile-b.tile);}
      objects.sort(staticCompare);scene.objects=objects;scene.shadows=shadows;
      regroupScene(scene,touched,shadowsChanged);scenePatches++;
    }
    if(!reused){
    // Keep a small world-space border so a drag reuses the same scenery and
    // depth order. Cull individual anchors below; no extra objects are drawn.
    // The company's property among the anchors, for outlines: owned buildings and developed plots. View state; never saved.
    b=visibleBounds(SCENE_PAN_MARGIN);const uprights=new Set(),property=[];
    for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++)tileScenery(x,y,uprights,property);
    objects.sort(staticCompare);
    sceneryBudget.clear();
    sceneCache={key,x:origin.x,y:origin.y,camera:{x:camera.x,y:camera.y,height:camera.height},bounds:b,dirty:null,objects,shadows,groups:null,shadow:null,batchPlanReady:false,readyGroups:0,property};sceneBuilds++;
    }
    const staticObjects=objects;objects=[];cullPoint=null;
    if(layers.vehicles)for(const v of frameVehicles){
      const route=routesById.get(v.routeId);
      // A plane on the ground is sorted among the airport's buildings; one in the air is drawn above the scenery.
      if(route?.mode==='air'){const a=airPoses.get(v);if(a?.pose.ground)add(a.pose.x-.5,a.pose.y-.5,()=>airportSprites.aircraft(ctx,a.pose.heading,lineFor(route).fill,a.body.x,a.body.y),1);continue;}
      if(route?.mode==='water'||!visible(v.x,v.y,100*camera.zoom))continue;
      if(route?.mode==='rail'&&route.path?.length>1){
        const path=route.path,max=path.length-1,direction=v.direction||1;
        for(const offset of [34/TILE,17/TILE]){const position=Math.max(0,Math.min(max,shownProgress(route,v,v.progress||0)-offset*direction)),index=Math.min(Math.floor(position),max-1),f=position-index,a=path[index],z=path[index+1],x=a.x+(z.x-a.x)*f,y=a.y+(z.y-a.y)*f,angle=Math.atan2((z.y-a.y)*direction,(z.x-a.x)*direction);add(x,y,()=>drawCar(v,route,x,y,angle,false),1);}
      }
      add(v.x,v.y,()=>drawCar(v,route,v.x,v.y,Number.isFinite(v.angle)?v.angle:0,route?.mode==='rail'),1);
    }
    const left=origin.x-W/(2*camera.zoom)-180,right=origin.x+W/(2*camera.zoom)+180,top=origin.y-H/(2*camera.zoom)-180,bottom=origin.y+H/(2*camera.zoom)+180;
    const inView=object=>object.point.x>left&&object.point.x<right&&object.point.y>top&&object.point.y<bottom;
    ctx.save();ctx.imageSmoothingEnabled=true;
    // Prepared shadows already contain the high-quality bake at this exact
    // display density. Replaying them needs only native-pixel sampling.
    if(sceneCache.shadow){ctx.imageSmoothingQuality='low';const s=sceneCache.shadow;ctx.drawImage(s.image,s.x,s.y,s.image.width/rasterScale,s.image.height/rasterScale);}
    else {ctx.imageSmoothingQuality='high';for(const shadow of shadows)if(inView(shadow))shadow.draw();}
    ctx.restore();
    // Merge vehicles into the exact original depth order. A group crossed by
    // any moving object falls back to its entries; complete stationary runs
    // are a single native-pixel blit, with the original sprite picking masks.
    objects.sort(compare);let moving=0;sceneryBatchDraws=0;sceneryDirectDraws=0;
    const drawStatic=object=>{if(!stopPickingMode||!object.dimEligible){object.draw();return;}ctx.save();ctx.globalAlpha*=.28;object.draw();ctx.restore();};
    const drawOriginal=object=>{while(moving<objects.length&&compare(objects[moving],object)<0)objects[moving++].draw();if(inView(object)){drawStatic(object);sceneryDirectDraws++;}};
    if(!sceneCache.readyGroups){
      // While dragging a fresh view, this is the original linear static merge.
      // Do not add group traversal or speculative raster work to panning.
      for(const object of staticObjects){while(moving<objects.length&&compare(objects[moving],object)<0)objects[moving++].draw();if(inView(object)){drawStatic(object);sceneryDirectDraws++;}}
    }else for(const group of sceneCache.groups){
      const first=group.objects[0],last=group.objects.at(-1);
      if(!first)continue;
      while(moving<objects.length&&compare(objects[moving],first)<0)objects[moving++].draw();
      if(group.image&&!visibleRectangle(group.x,group.y,group.image.width/rasterScale,group.image.height/rasterScale))continue;
      if(!group.image||(moving<objects.length&&compare(objects[moving],last)<0)||!group.objects.every(object=>inView(object)||!visibleRectangle(object.bounds.left,object.bounds.top,object.bounds.right-object.bounds.left,object.bounds.bottom-object.bounds.top))){for(const object of group.objects)drawOriginal(object);continue;}
      ctx.save();ctx.imageSmoothingEnabled=false;if(stopPickingMode&&first.dimEligible)ctx.globalAlpha*=.28;
      ctx.drawImage(group.image,group.x,group.y,group.image.width/rasterScale,group.image.height/rasterScale);ctx.restore();
      sceneryBatchDraws++;
      for(const hit of group.hits)if(visibleRectangle(hit.x,hit.y,hit.w,hit.h))objectHits.push(hit);
    }
    while(moving<objects.length)objects[moving++].draw();
    sceneryPreparationMs=0;if(sceneryBatching&&!sceneryWaitingForCamera)warmSceneBatches(sceneCache);
  }
  const sceneView=scene=>({left:scene.x-W/(2*camera.zoom),right:scene.x+W/(2*camera.zoom),top:scene.y-H/(2*camera.zoom),bottom:scene.y+H/(2*camera.zoom)});
  function shadowStage(scene){const view=sceneView(scene);return{index:0,surface:null,bounds:{left:view.left-SCENE_PAN_MARGIN,top:view.top-SCENE_PAN_MARGIN,right:view.right+SCENE_PAN_MARGIN,bottom:view.bottom+SCENE_PAN_MARGIN}};}
  // Strips still without a picture, nearest the view first.
  function queueSceneGroups(scene){
    const view=sceneView(scene),distance=group=>{const b=group.bounds;return b?Math.max(0,view.left-b.right,b.left-view.right)**2+Math.max(0,view.top-b.bottom,b.top-view.bottom)**2:Infinity;};
    scene.pendingGroups=scene.groups.filter(group=>!group.image&&group.bounds&&group.objects.length>=4&&distance(group)<=(SCENE_PAN_MARGIN+96)**2).sort((a,b)=>distance(a)-distance(b));
    scene.pendingIndex=0;
  }
  function prepareSceneBatches(scene){
    for(const object of scene.objects)if(typeof object.bounds==='function')object.bounds=object.bounds();
    scene.groups=partitionScenery(scene.objects,rasterScale);scene.batchPlanReady=true;
    // Stage the shadow layer off screen. Until every shadow is painted the
    // ordinary pass stays visible, so incremental preparation cannot flicker.
    if(scene.shadows.length>8)scene.shadowPreparation=shadowStage(scene);
    queueSceneGroups(scene);
  }
  // A strip's bitmap bytes, as allocate() will ask for them; 0 for one the budget refuses at any size.
  const stripBytes=b=>{const w=Math.ceil(b.right*rasterScale)+2-(Math.floor(b.left*rasterScale)-2),h=Math.ceil(b.bottom*rasterScale)+2-(Math.floor(b.top*rasterScale)-2);return w<1||h<1||w>8192||h>8192?0:w*h*4;};
  // After a patch, strips hold one depth each (partitionScenery), so every run the patch left alone keeps its strips and
  // picture; a touched run is partitioned again and queued. A changed shadow list stages a new layer while the old one
  // stays on screen, as a rebuilt scene's first layer does; if a new layer was already on its way, the one on screen is
  // two patches old and gives way to the direct pass. An unchanged list keeps both layers, and any painting continues
  // where it was. When the budget cannot hold every strip and the layer, a fresh scene's order (the layer, then strips
  // nearest first) decides which get pictures, so the patch starts that order afresh.
  function regroupScene(scene,touched,shadowsChanged){
    if(!scene.batchPlanReady)return;
    if(touched.size){
      const kept=new Map(),groups=[],objects=scene.objects;
      for(const group of scene.groups){const depth=group.objects[0].depth;if(touched.has(depth)){if(group.image)sceneryBudget.release(group.image);continue;}const list=kept.get(depth);if(list)list.push(group);else kept.set(depth,[group]);}
      for(let i=0;i<objects.length;){
        const depth=objects[i].depth;let j=i+1;while(j<objects.length&&objects[j].depth===depth)j++;
        if(touched.has(depth)){const run=objects.slice(i,j);for(const object of run)if(typeof object.bounds==='function')object.bounds=object.bounds();groups.push(...partitionScenery(run,rasterScale));}
        else groups.push(...(kept.get(depth)||[]));
        i=j;
      }
      scene.groups=groups;
    }
    queueSceneGroups(scene);
    const layer=scene.shadows.length>8?shadowStage(scene):null,pending=new Set(scene.pendingGroups),limit=sceneryBudget.stats().limit;
    const need=(layer?stripBytes(layer.bounds):0)+scene.groups.reduce((n,group)=>n+(group.image||pending.has(group)?stripBytes(group.bounds):0),0);
    if(need>limit){
      sceneryBudget.clear();for(const group of scene.groups)group.image=null;
      scene.shadow=null;scene.shadowPreparation=layer;queueSceneGroups(scene);
    }else if(shadowsChanged){
      const behind=Boolean(scene.shadowPreparation);
      if(scene.shadowPreparation?.surface)sceneryBudget.release(scene.shadowPreparation.surface.image);
      if(scene.shadow&&(!layer||behind||need+scene.shadow.image.width*scene.shadow.image.height*4>limit)){sceneryBudget.release(scene.shadow.image);scene.shadow=null;}
      scene.shadowPreparation=layer;
    }
    scene.readyGroups=scene.groups.reduce((n,group)=>n+(group.image?1:0),0);
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
        // A patched scene's old layer gives way when both do not fit.
        if(!shadow.surface&&scene.shadow){sceneryBudget.release(scene.shadow.image);scene.shadow=null;shadow.surface=allocate(shadow.bounds,true,'high');}
        if(!shadow.surface)scene.shadowPreparation=null;
        else{
          ctx=shadow.surface.context;sceneViewBounds=null;
          // Time checks also split this potentially thousands-of-trees loop.
          while(shadow.index<scene.shadows.length&&performance.now()<deadline)scene.shadows[shadow.index++].draw();
          if(shadow.index===scene.shadows.length){if(scene.shadow)sceneryBudget.release(scene.shadow.image);scene.shadow=shadow.surface;scene.shadowPreparation=null;sceneryBatchBuilds++;}
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
  // World labels are paper plates (DESIGN.md 9): paper at 94%, radius 4 and a 1 px ink edge at 14%, on whole pixels.
  function plate(x,y,w,h){const p=MAP.nameplate;ctx.fillStyle=alpha(p.fill,p.fillAlpha);roundRect(ctx,Math.round(x)+.5,Math.round(y)+.5,Math.round(w),Math.round(h),p.radius);ctx.fill();ctx.strokeStyle=alpha(p.edge,p.edgeAlpha);ctx.lineWidth=1;ctx.stroke();}
  function pill(x,y,label,opts={}){
    const size=Math.max(12,opts.size||12);ctx.font=font(opts.bold?600:500,size);
    const w=ctx.measureText(label).width+(opts.dot?25:16),h=opts.h||23;
    plate(x-w/2,y-h/2,w,h);ctx.fillStyle=opts.color||COLORS.ink;ctx.textAlign='left';ctx.textBaseline='middle';let tx=x-w/2+8;if(opts.dot){dot(ctx,tx+2,y,2.5,opts.dot);tx+=10;}ctx.fillText(label,tx,y+.3);return w;
  }
  // A town nameplate: its name 13/600, a 1 px rule and the population 12/500 in ink-2. Placement and drawing share the widths.
  function nameplate(city){
    const name=city.name||'New city',pop=populationText(city);ctx.font=font(MAP.nameplate.name.weight,MAP.nameplate.name.size);const nameW=ctx.measureText(name).width;
    ctx.font=font(MAP.nameplate.population.weight,MAP.nameplate.population.size);const popW=ctx.measureText(pop).width;return{name,pop,nameW,popW,w:nameW+popW+42};
  }
  function cargoImage(kind,size){
    const pixels=Math.ceil(size*dpr),key=`${kind}:${pixels}`;let image=cargoImages.get(key);
    if(!image){image=new Image();image.onload=()=>options.onInvalidate?.();image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(cargoIcon(kind,{decorative:true}).replace('width="32" height="32"',`width="${pixels}" height="${pixels}"`))}`;cargoImages.set(key,image);}
    return image;
  }
  // A load badge's display-pixel box above its carrier, shared by drawing and picking.
  // A carrier's screen point: a plane's body at its height, any other vehicle on its track.
  const carrierPoint=(v,route)=>route.mode==='air'?screenPoint(airPoses.get(v).body):vehicleToScreen(v.x,v.y,route.mode);
  const carrierVisible=(v,route,margin)=>{if(route.mode!=='air')return visible(v.x,v.y,margin);const p=airPoses.has(v)&&carrierPoint(v,route);return Boolean(p)&&p.x>-margin&&p.y>-margin&&p.x<W+margin&&p.y<H+margin;};
  function badgeRect(v,route){
    const p=carrierPoint(v,route),fraction=Math.max(0,Math.min(1,(v.load||0)/Math.max(1,v.capacity||1)));
    const state=fraction<=.00001?'empty':fraction>=.99999?'full':'partial',size=detailLevel==='detail'?22:18,w=state==='empty'?24:size+8,h=state==='empty'?11:size+13;
    return {p,fraction,state,size,w,h,x:Math.round(p.x-w/2),y:Math.round(p.y-(route.mode==='water'?22:route.mode==='air'?16:10)*camera.zoom-h-5)};
  }
  let loadBadgeBuilds=0;
  function vehicleLoadIndicator(v,route){
    if(!route||!carrierVisible(v,route,40)||(route.mode==='road'||route.mode==='rail')&&isUndergroundAt(game,v.x,v.y))return;
    const {p,fraction,state,size,w,h,x,y}=badgeRect(v,route);vehicleIndicatorCounts[state]++;
    // A badge fades where it crosses a town name or a stop sign, so the waiting bus never hides its stop.
    const covers=r=>x<r.x+r.w&&x+w>r.x&&y<r.y+r.h&&y+h>r.y;ctx.globalAlpha=labelRects.some(covers)||signRects.some(covers)?.35:1;
    // Badges use display pixels so a load remains legible at every map scale.
    // An empty carrier has only an unfilled meter; loaded carriers show cargo.
    // Each is a pill whose tail points down at its carrier, edged on the left in its route's colour; a thin stem bridges any gap.
    const foot=p.y-(route.mode==='water'?18:route.mode==='air'?12:6)*camera.zoom;if(foot-y-h>8)line(ctx,[[p.x,y+h+4],[p.x,foot]],'#475b455b',1);
    const image=state==='empty'?null:cargoImage(route.cargo||'passengers',size),loaded=Boolean(image?.complete&&image.naturalWidth),color=lineFor(route).fill;
    const key=`${dpr}:${size}:${state}:${state==='empty'?'':route.cargo||'passengers'}:${color}:${loaded}`;
    let badge=loadBadges.get(key);
    if(!badge){
      badge=document.createElement('canvas');badge.width=Math.ceil((w+2)*dpr);badge.height=Math.ceil((h+7)*dpr);
      const c=badge.getContext('2d'),r=Math.min(8,h/2),outline=()=>{c.beginPath();c.moveTo(r,0);c.arcTo(w,0,w,h,r);c.arcTo(w,h,0,h,r);c.lineTo(w/2+4,h);c.lineTo(w/2,h+4.5);c.lineTo(w/2-4,h);c.arcTo(0,h,0,0,r);c.arcTo(0,0,w,0,r);c.closePath();};c.scale(dpr,dpr);c.translate(1,1);
      outline();c.fillStyle=state==='empty'?'#f5f2e2de':'#faf6e7f5';c.fill();c.save();c.clip();c.fillStyle=color;c.fillRect(0,0,3,h);c.restore();
      outline();c.strokeStyle=state==='full'?'#567b4c':state==='empty'?'#8e9c8580':'#b18c4c';c.lineWidth=1;c.stroke();
      if(state!=='empty'){if(loaded)c.drawImage(image,(w-size)/2+1,3,size,size);else dot(c,w/2+1,3+size/2,3,'#849367');}
      c.fillStyle='#d4d9c8';roundRect(c,5,h-7,w-9,3,1);c.fill();
      if(loadBadges.size>=384)loadBadges.delete(loadBadges.keys().next().value);
      loadBadges.set(key,badge);loadBadgeBuilds++;
    }
    ctx.drawImage(badge,x-1,y-1,badge.width/dpr,badge.height/dpr);
    const meterX=x+5,meterY=y+h-7,meterW=w-9;
    if(fraction>0){ctx.fillStyle=state==='full'?'#4e7747':'#bd8e43';roundRect(ctx,meterX,meterY,Math.max(1,meterW*fraction),3,1);ctx.fill();}
    ctx.globalAlpha=1;
  }
  function drawFloaters(floaters,now){
    // Paid deliveries rise above their stop and fade. Region sums each 3×3-tile cell into one figure
    // and keeps the full screen offset, because vehicle load badges do not shrink with the map. An airport's figure starts
    // above its sign, which stands over the terminal.
    const region=detailLevel==='region',still=Boolean(motionPreference?.matches),shown=new Map(),format=FLOATER_FORMAT;
    for(const f of floaters){
      const t=(now-f.born)/1600;if(!(t>=0&&t<1)||!visible(f.x,f.y))continue;
      const key=region?Math.floor(f.x/3)+','+Math.floor(f.y/3):f,group=shown.get(key);
      if(!group)shown.set(key,{x:f.x,y:f.y,revenue:f.revenue,cargo:f.cargo,t,air:f.air});else{group.revenue+=f.revenue;if(t<group.t)Object.assign(group,{x:f.x,y:f.y,cargo:f.cargo,t,air:f.air});}
    }
    ctx.font=font(600,12);ctx.textAlign='left';ctx.textBaseline='middle';
    for(const {x,y,revenue,cargo,t,air} of shown.values()){
      const p=worldToScreen(x,y),label='+$'+(revenue>=10000?format.format(revenue/1000)+'k':format.format(Math.round(revenue))),image=cargoImage(cargo||'passengers',14);
      const w=ctx.measureText(label).width+35,h=23,left=Math.round(p.x-w/2);let start=p.y-(air?80:58)*Math.max(1,camera.zoom)-h/2,ceiling=-Infinity;
      // Town names keep their place: a figure that would cover one starts above it, one below stops rising under it.
      for(const r of labelRects)if(left<r.x+r.w&&left+w>r.x){if(start<r.y+r.h&&start+h>r.y)start=r.y-h-3;else if(start>=r.y+r.h)ceiling=Math.max(ceiling,r.y+r.h+3);}
      const top=Math.round(Math.max(ceiling,start-(still?0:22*(1-(1-t)**3))));
      ctx.globalAlpha=t<.6?1:(1-t)/.4;
      plate(left,top,w,h);
      if(image.complete&&image.naturalWidth)ctx.drawImage(image,left+8,top+(h-14)/2,14,14);else dot(ctx,left+15,top+h/2,3,'#849367');
      ctx.fillStyle=STATES.ok.color;ctx.fillText(label,left+27,top+h/2+.3);
    }
    ctx.globalAlpha=1;
  }
  // A marker's paper tile, icon, ring and baked shadow are one prepared image per cargo, ring, size and density,
  // so no marker blurs a shadow each frame; one whose icon is still loading is drawn directly and not kept.
  const markerTiles=new Map();
  function markerTile(kind,ring,size){
    const key=`${kind}:${ring||'none'}:${size}:${dpr}`;let tile=markerTiles.get(key);
    if(tile){markerTiles.delete(key);markerTiles.set(key,tile);return tile;}
    const image=cargoImage(kind,size),[color,width]=ring?ring.split('/'):['#fbfaedf0',1],w=size+8,h=size+6;
    tile=document.createElement('canvas');tile.width=Math.ceil((w+16)*dpr);tile.height=Math.ceil((h+16)*dpr);
    const c=tile.getContext('2d');c.scale(dpr,dpr);c.translate(8,8);
    c.shadowColor='#293d2630';c.shadowBlur=5;c.shadowOffsetY=2;c.fillStyle='#f7f4e7f5';roundRect(c,0,0,w,h,7);c.fill();c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetY=0;
    c.strokeStyle=color;c.lineWidth=+width;c.stroke();
    if(!image.complete||!image.naturalWidth){dot(c,w/2,h/2,4,'#849367');return tile;}
    c.drawImage(image,4,3,size,size);
    if(markerTiles.size>=256)markerTiles.delete(markerTiles.keys().next().value);
    markerTiles.set(key,tile);return tile;
  }
  // A stop is a roundel (DESIGN.md 9): a paper disc in a 2.5 px ring, over a 1 px paper halo so it reads on dark ground.
  function roundel(x,y,r,ring){dot(ctx,x,y,r+1,alpha(COLORS.paper,.9));dot(ctx,x,y,r,COLORS.paper);ctx.beginPath();ctx.arc(x,y,r-MAP.roundel.ringWidth/2,0,TAU);ctx.strokeStyle=ring;ctx.lineWidth=MAP.roundel.ringWidth;ctx.stroke();}
  // A route bullet (DESIGN.md 8.1): route.number in 12/700 in the line's on-colour, on a shape by mode (road a rounded square,
  // rail a circle, water a pill 1.6 times as wide, air a diamond) that stretches for two or more digits. On the map it wears a
  // paper halo, and a light fill a 1 px ink edge at 35%. Each is prepared once per mode, number, fill, size, density and
  // font state in a 256-entry LRU. x is the left edge and y the centre; returns the width.
  const shownBullets=new Set(); // 'stationId route-id' for each bullet the stop rows drew this frame
  const bulletTiles=new Map(),bulletWidths=new Map(),textMeter=document.createElement('canvas').getContext('2d');
  function bulletWidth(route,size){
    const text=validRouteNumber(route?.number)?String(route.number):'',mode=route?.mode||'road',key=`${mode}:${text}:${size}:${document.fonts?.status}`;let w=bulletWidths.get(key);
    if(w===undefined){textMeter.font=font(700,MAP.bullet.numeral.size);const t=text?textMeter.measureText(text).width:0;w=mode==='air'?text.length>1?Math.ceil(t+size*.8):size:Math.max(mode==='water'?Math.round(size*1.6):size,Math.ceil(t+(size>16?10:8)));if(bulletWidths.size>=512)bulletWidths.clear();bulletWidths.set(key,w);}
    return w;
  }
  function bulletTile(route,size){
    const line=lineFor(route),mode=route?.mode||'road',text=validRouteNumber(route?.number)?String(route.number):'',w=bulletWidth(route,size),key=`${mode}:${text}:${line.fill}:${size}:${dpr}:${document.fonts?.status}`;let tile=bulletTiles.get(key);
    if(tile){bulletTiles.delete(key);bulletTiles.set(key,tile);return tile;}
    tile=document.createElement('canvas');tile.width=Math.ceil((w+4)*dpr);tile.height=Math.ceil((size+4)*dpr);tile.bulletWidth=w;
    const c=tile.getContext('2d'),m=size/2;c.scale(dpr,dpr);c.translate(2,2);c.beginPath();
    if(mode==='air'){c.moveTo(0,m);c.lineTo(m,0);c.lineTo(w-m,0);c.lineTo(w,m);c.lineTo(w-m,size);c.lineTo(m,size);c.closePath();}else c.roundRect(0,0,w,size,mode==='road'?4:m);
    c.lineJoin='round';c.strokeStyle=alpha(COLORS.paper,.9);c.lineWidth=2.5;c.stroke();c.fillStyle=line.fill;c.fill();
    if(line.light){c.strokeStyle=alpha(MAP.bullet.lightEdge,MAP.bullet.lightEdgeAlpha);c.lineWidth=1;c.stroke();}
    if(text){c.fillStyle=line.on;c.font=font(700,MAP.bullet.numeral.size);c.textAlign='center';c.textBaseline='middle';c.fillText(text,w/2,m+.5);}
    if(bulletTiles.size>=256)bulletTiles.delete(bulletTiles.keys().next().value);
    bulletTiles.set(key,tile);return tile;
  }
  function drawBullet(target,x,y,route,size){const tile=bulletTile(route,size);target.drawImage(tile,Math.round((x-2)*dpr)/dpr,Math.round((y-size/2-2)*dpr)/dpr,tile.width/dpr,tile.height/dpr);return tile.bulletWidth;}
  // The routes a stop shows, lowest number first: three bullets, then a +N paper tag. Region shows only terminus bullets.
  const byNumber=(a,b)=>(validRouteNumber(a.number)?a.number:1e4)-(validRouteNumber(b.number)?b.number:1e4);
  function servingBullets(st,routes,region){const list=(region?routes.filter(route=>route.stops?.[0]===st.id||route.stops?.at(-1)===st.id):routes.slice()).sort(byNumber);return{shown:list.slice(0,3),more:Math.max(0,list.length-3)};}
  const tagWidth=(label,size)=>{textMeter.font=font(600,12);return Math.ceil(textMeter.measureText(label).width+(size>16?10:8));};
  function bulletsWidth(st,region=false){const size=region?MAP.bullet.small:MAP.bullet.size,list=servingBullets(st,stopCalls().get(st.id)||[],region);return list.shown.length?list.shown.reduce((sum,route)=>sum+bulletWidth(route,size)+2,-2)+(list.more?2+tagWidth(`+${list.more}`,size):0):0;}
  // Draws a stop's bullets from x, centred on y; an offline or paused route's bullet is at half strength. Region drops any
  // bullet that would meet a town name. Returns the right edge of what was drawn.
  function stopBullets(st,routes,x,y,region){
    const size=region?MAP.bullet.small:MAP.bullet.size,list=servingBullets(st,routes,region),clear=w=>!region||!labelRects.some(r=>x<r.x+r.w&&x+w>r.x&&y-size/2<r.y+r.h&&y+size/2>r.y);let end=x-3;
    for(const route of list.shown){const w=bulletWidth(route,size);if(!clear(w))continue;ctx.globalAlpha=route.active===false||route.paused?.5:1;drawBullet(ctx,x,y,route,size);shownBullets.add(`${st.id} ${route.id}`);ctx.globalAlpha=1;end=x+w;x+=w+2;}
    if(list.more){const label=`+${list.more}`,w=tagWidth(label,size);if(clear(w)){plate(x,y-size/2,w,size);ctx.font=font(600,12);ctx.fillStyle=COLORS.ink;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x+w/2,y+.5);end=x+w;}}
    return end;
  }
  // The cut glyph at a route's break: two short slashes across the line, in the error colour over a paper casing.
  function cutMark(x,y,dx,dy){
    const d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d,sx=-uy*.87+ux*.5,sy=ux*.87+uy*.5;ctx.save();ctx.lineCap='round';
    for(const [color,width] of [[COLORS.paper,5],[MAP.cut.color,2]]){ctx.beginPath();for(const o of [-3,3]){const cx=x+ux*o,cy=y+uy*o;ctx.moveTo(cx-sx*6,cy-sy*6);ctx.lineTo(cx+sx*6,cy+sy*6);}ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
    ctx.restore();
  }
  function resourceMarker(x,y,kind,size,label,role=null,mark={}){
    // Screen-space markers stay legible in Region and render at native display
    // density. SVG images are local data, cached separately from terrain chunks.
    // A served site is ringed in its route's colour; from Town view in, a bar reads the fullest output store,
    // and a served factory still missing an input shows those inputs beneath it (an amber dot in Region).
    const h=size+6,w=size+8,mx=Math.round((x-w/2)*dpr)/dpr,my=Math.round((y-h/2)*dpr)/dpr;
    const tile=markerTile(kind,mark.color?`${mark.color}/2`:role?`${LENS_COLORS[role]}/1.5`:'',size);ctx.drawImage(tile,mx-8,my-8,tile.width/dpr,tile.height/dpr);
    if(mark.fill>0){ctx.fillStyle=COLORS.well;roundRect(ctx,mx+6,my+h-5,w-12,3,1.5);ctx.fill();ctx.fillStyle=mark.fill>=.9?STATES.warn.color:COLORS.ink;roundRect(ctx,mx+6,my+h-5,Math.max(1.5,(w-12)*Math.min(1,mark.fill)),3,1.5);ctx.fill();}
    if(mark.missing?.length){
      if(detailLevel==='region'){dot(ctx,mx+w-2,my+2,4.6,'#fbf6e3');dot(ctx,mx+w-2,my+2,3.2,'#bd8e43');}
      else mark.missing.forEach((cargo,i)=>{const cx=Math.round(x-(mark.missing.length*18-2)/2+i*18),cy=my+h+3,image=cargoImage(cargo,12);ctx.fillStyle='#f7f4e7f5';roundRect(ctx,cx,cy,16,16,4);ctx.fill();ctx.strokeStyle='#bd8e43';ctx.lineWidth=1;ctx.stroke();if(image.complete&&image.naturalWidth)ctx.drawImage(image,cx+2,cy+2,12,12);else dot(ctx,cx+8,cy+8,2.5,'#bd8e43');});
    }
    if(label){
      ctx.font=font(500,12);const nameWidth=ctx.measureText(label).width+16;
      const right=x+w/2+4+nameWidth/2,left=x-w/2-4-nameWidth/2;
      pill(right+nameWidth/2>W-8?left:right,y,label,{h:28});
    }
    if(role)lensTab(x+w/2-2,y-h/2+2,role);
    if(mark.covered)coverTab(x-w/2+2,y-h/2+2);
  }
  // A stop being placed would reach this site: a green tab with a paper tick.
  function coverTab(x,y){dot(ctx,x,y,8,'#fbf6e3');dot(ctx,x,y,6.6,'#4e7747');ctx.beginPath();ctx.moveTo(x-3,y);ctx.lineTo(x-.9,y+2.2);ctx.lineTo(x+3.1,y-2.2);ctx.strokeStyle='#fbf6e3';ctx.lineWidth=1.6;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();ctx.lineCap='butt';ctx.lineJoin='miter';}
  // Lens roles: a green up tab marks a producer, a teal down tab a buyer; a town that buys the cargo carries its icon.
  function lensTab(x,y,role){dot(ctx,x,y,8,'#fbf6e3');dot(ctx,x,y,6.6,LENS_COLORS[role]);const d=role==='source'?-1:1;ctx.beginPath();ctx.moveTo(x,y+d*3.6);ctx.lineTo(x+3.8,y-d*2);ctx.lineTo(x-3.8,y-d*2);ctx.closePath();ctx.fillStyle='#fbf6e3';ctx.fill();}
  function lensChip(x,y,role='buyer'){
    const image=cargoImage(lens,14);ctx.shadowColor='#293d2630';ctx.shadowBlur=5;ctx.shadowOffsetY=2;ctx.fillStyle='#f7f4e7f5';roundRect(ctx,x-11,y-11,22,22,6);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.strokeStyle=LENS_COLORS[role];ctx.lineWidth=1.5;ctx.stroke();if(image.complete&&image.naturalWidth)ctx.drawImage(image,x-7,y-7,14,14);else dot(ctx,x,y,3,'#849367');
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
      ctx.strokeStyle=alpha(COLORS.ink,.35);ctx.lineWidth=arc.strong?4:3.5;ctx.stroke();ctx.setLineDash(arc.strong?[]:[4,4]);ctx.strokeStyle=COLORS.paper;ctx.lineWidth=arc.strong?2:1.5;ctx.stroke();ctx.setLineDash([]);
    }
    ctx.globalAlpha=1;contextTargets=arcs.length;
    return arcs.filter(arc=>arc.bubble).map(arc=>({...arc.bubble,rank:arc.rank,strong:arc.strong,dim:dim&&!arc.strong}));
  }
  function contextBubble({x,y,rank,strong,dim}){
    ctx.globalAlpha=dim?.35:1;dot(ctx,x,y,9,strong?COLORS.ink:COLORS.paper);
    ctx.strokeStyle=alpha(COLORS.ink,.35);ctx.lineWidth=1;ctx.stroke();ctx.font=font(600,12);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=strong?COLORS.onInk:COLORS.ink;ctx.fillText(String(rank),x,y+.5);ctx.globalAlpha=1;
  }
  function render(now,view={}){
    lastTime=now||0;const {tool='inspect',hover=null,preview=[],selected=null,routeStops=[],preferredMode='road'}=view;
    stopPickingMode=['road','rail','water','air'].includes(view.stopPicking?.mode)?view.stopPicking.mode:null;
    // A hovered reference (DESIGN.md 7.3): a route lights as highlightRoute does and wears its bullet at both ends; a town, industry,
    // stop or vehicle gets the orange locator ring, fading in over 120 ms (at once under reduced motion).
    stepCamera(now);shownBullets.clear();const hoverRef=typeof view.hoverRef==='string'?view.hoverRef:null,refAt=hoverRef?hoverRef.indexOf(':'):-1,refKind=refAt>0?hoverRef.slice(0,refAt):'',refId=refAt>0?hoverRef.slice(refAt+1):'';
    if(hoverRef!==lastHoverRef){lastHoverRef=hoverRef;hoverRefAt=now;}const locatorFade=motionPreference?.matches?1:Math.max(0,Math.min(1,(now-hoverRefAt)/MAP.locator.fadeMs));
    const showGrid=typeof view.showGrid==='boolean'?view.showGrid:layers.grid,showRoutes=typeof view.showRoutes==='boolean'?view.showRoutes:layers.routes;
    // A paused game brings no new days, so it finishes every waiting chunk at once (view.settle).
    ensureRevision();lazyChunkBudget=view.settle?Infinity:LAZY_CHUNKS_PER_FRAME;lazyChunksWaiting=0;const routesById=new Map((game.routes||[]).map(route=>[route.id,route]));vehicleIndicatorCounts={empty:0,partial:0,full:0};
    // A plane may stand beside its chord or high above it, so it keeps a wider margin.
    frameVehicles.length=0;if(layers.vehicles)for(const source of game.vehicles||[]){const vehicle=presentedVehicle(source);if(visibleFlat(vehicle.x,vehicle.y,Math.max(70,100*camera.zoom)+(routesById.get(vehicle.routeId)?.mode==='air'?220*camera.zoom:0)))frameVehicles.push(vehicle);}
    airPoses.clear();airStats={ground:0,air:0};for(const vehicle of frameVehicles){const route=routesById.get(vehicle.routeId);if(route?.mode!=='air')continue;const pose=airPose(vehicle,route);if(pose){airPoses.set(vehicle,pose);airStats[pose.pose.ground?'ground':'air']++;}}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);ctx.fillStyle=palette.ground;ctx.fillRect(0,0,W,H);
    ctx.save();ctx.translate(W/2,H/2);ctx.scale(camera.zoom,camera.zoom);const projectedCamera=cameraPoint();ctx.translate(-projectedCamera.x,-projectedCamera.y);
    const {x0,y0,x1,y1}=visibleBounds();
    drawWorld(x0,y0,x1,y1);
    // Chunks still waiting for their share ask for another frame, even on a paused map.
    if(lazyChunksWaiting&&options.onInvalidate)queueMicrotask(options.onInvalidate);
    // Water keeps one horizontal plane while land rises above it.
    ctx.save();groundTransform(ctx);
    const reducedMotion=Boolean(motionPreference?.matches);
    waterMotionStats={chunks:waterMotionChunks.length,waveGroups:0,shoreSegments:0,strokes:0,reducedMotion};
    for(const motion of waterMotionChunks){const counts=drawPreparedWaterMotion(ctx,motion,presentationTime(),game.biome,{reducedMotion});waterMotionStats.waveGroups+=counts.waves;waterMotionStats.shoreSegments+=counts.shores;waterMotionStats.strokes+=counts.strokes;}
    if(layers.vehicles)for(const v of frameVehicles){const route=routesById.get(v.routeId);if(route?.mode==='water'&&visible(v.x,v.y))drawShipWake(ctx,v,presentationTime()*1000,detailLevel);}
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
      // A flight is one straight line between its airports' centres, whatever the staircase it is saved as.
      if(r.mode==='air'){
        if(cached?.path===path&&cached.revision===structureRevision&&cached.heightStep===heightStep&&cached.mode==='air')return cached;
        const [a,b]=(r.stops||[]).map(id=>stationById.get(id)),drawing=new Path2D();
        if(a&&b){const p=projectGround(game,airportCentre(a).x,airportCentre(a).y),q=projectGround(game,airportCentre(b).x,airportCentre(b).y);drawing.moveTo(p.x,p.y);drawing.lineTo(q.x,q.y);}
        cached={path,length:path.length,key,revision:structureRevision,heightStep,mode:'air',drawing,ranges:[],count:a&&b?1:0,segments:1};routePaths.set(r,cached);routePathBuilds++;return cached;
      }
      if(!cached||cached.path!==path||cached.length!==path.length||cached.key!==key||cached.revision!==structureRevision||cached.mode!==r.mode||cached.heightStep!==heightStep){
        let index=routeIndexes.get(path);
        if(!index||index.length!==path.length){index={length:path.length,spatial:createRouteRenderIndex(path)};routeIndexes.set(path,index);}
        const drawing=new Path2D(),ranges=[],{x0:bx0,y0:by0,x1:bx1,y1:by1}=routeBounds;let previous=-1,count=0,segments=0;
        for(const[start,end]of index.spatial.query(routeBounds))for(let i=start;i<=end;i++){
          const a=path[i-1],b=path[i];segments++;
          if(Math.max(a.x,b.x)<bx0||Math.min(a.x,b.x)>=bx1||Math.max(a.y,b.y)<by0||Math.min(a.y,b.y)>=by1){previous=-1;continue;}
          if(previous!==i-1){const p=transportPoint(a.x,a.y,r.mode);drawing.moveTo(p.x,p.y);ranges.push([i,i]);}else ranges[ranges.length-1][1]=i;
          const edge=transportPoint((a.x+b.x)/2,(a.y+b.y)/2,r.mode),p=transportPoint(b.x,b.y,r.mode);drawing.lineTo(edge.x,edge.y);drawing.lineTo(p.x,p.y);previous=i;count++;
        }
        cached={path,length:path.length,key,revision:structureRevision,heightStep,mode:r.mode,drawing,ranges,count,segments};routePaths.set(r,cached);routePathBuilds++;
        routeSegmentsConsidered+=segments;
      }
      return cached;
    }
    // DESIGN.md 8.4: a core of 3, 3.5 or 4.5 screen px in the line's fill, over a paper halo (deep fills) or an ink casing
    // (light fills), 1.5 px wider when emphasised. An offline or paused route draws at 45% with no flow, and an offline one
    // dashes its broken stretch in the error colour.
    function strokeRoute(r,cached,fade=1,focus=false){
      const line=lineFor(r),z=camera.zoom,held=r.active===false||Boolean(r.paused),core=(MAP.line.core[detailLevel]||MAP.line.core.town)+(focus?MAP.line.emphasis:0),shown=(held?MAP.line.pausedAlpha:1)*fade;
      ctx.save();ctx.lineJoin=ctx.lineCap='round';if(r.mode==='air')ctx.setLineDash([6/z,8/z]);
      ctx.globalAlpha=shown*(line.light?MAP.line.casingAlpha:MAP.line.haloAlpha);ctx.strokeStyle=line.light?COLORS.ink:COLORS.paper;ctx.lineWidth=(core+(line.light?MAP.line.casing:MAP.line.halo))/z;ctx.stroke(cached.drawing);
      ctx.globalAlpha=shown;ctx.strokeStyle=line.fill;ctx.lineWidth=core/z;ctx.stroke(cached.drawing);
      if(!held&&!isTownTraffic(r.cargo))flowChevrons(r,cached.ranges,core,line.on);
      if(r.active===false)brokenStretch(r,core,fade);
      ctx.restore();
    }
    // Freight chevrons point from the loading stop to the delivery stop every 44 screen px, counted from the start of the
    // path so a pan never shifts them; they advance with the simulated day, so paused frames repeat exactly.
    function flowChevrons(r,ranges,core,color){
      const path=r.path,z=camera.zoom,gap=MAP.line.chevronGap/z,shift=presentationTime()*14/z%gap,arm=core*.28/z,reach=core*.28/z;ctx.beginPath();
      for(const [first,last] of ranges)for(let s=Math.ceil(((first-1)*PATH_STEP-shift)/gap)*gap+shift;s<last*PATH_STEP;s+=gap){
        const i=Math.floor(s/PATH_STEP),t=s/PATH_STEP-i,a=path[i],b=path[i+1];if(!a||!b||Math.max(a.x,b.x)<x0-1||Math.min(a.x,b.x)>x1||Math.max(a.y,b.y)<y0-1||Math.min(a.y,b.y)>y1)continue;
        const mid=transportPoint((a.x+b.x)/2,(a.y+b.y)/2,r.mode),from=t<.5?transportPoint(a.x,a.y,r.mode):mid,to=t<.5?mid:transportPoint(b.x,b.y,r.mode),u=t<.5?t*2:t*2-1;
        const dx=to.x-from.x,dy=to.y-from.y,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d,x=from.x+dx*u,y=from.y+dy*u;
        ctx.moveTo(x-ux*reach-uy*arm,y-uy*reach+ux*arm);ctx.lineTo(x+ux*reach,y+uy*reach);ctx.lineTo(x-ux*reach+uy*arm,y-uy*reach-ux*arm);
      }
      ctx.strokeStyle=color;ctx.lineWidth=Math.max(1,core*.26)/z;ctx.stroke();
    }
    // The tiles either side of an offline route's first gap: dashed in the error colour on the line's paper halo.
    function brokenStretch(r,core,fade){
      const at=routeBreak(r);if(!at)return;
      const path=r.path,z=camera.zoom,first=Math.max(0,at.index-1),last=Math.min(path.length-1,at.index+1);ctx.beginPath();
      for(let i=first;i<=last;i++){const p=transportPoint(path[i].x,path[i].y,r.mode);if(i===first)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}
      ctx.globalAlpha=fade*MAP.line.haloAlpha;ctx.strokeStyle=COLORS.paper;ctx.lineWidth=(core+MAP.line.halo)/z;ctx.stroke();
      ctx.globalAlpha=fade;ctx.lineCap='butt';ctx.setLineDash([4/z,3/z]);ctx.strokeStyle=MAP.cut.color;ctx.lineWidth=core/z;ctx.stroke();ctx.setLineDash([]);
    }
    // Route lines are projected for the view rounded out to 16-tile cells, so panning
    // rebuilds them only when the view crosses a cell edge, not on every tile.
    const cell=16,routeBounds={x0:Math.floor(x0/cell)*cell,y0:Math.floor(y0/cell)*cell,x1:Math.ceil(x1/cell)*cell,y1:Math.ceil(y1/cell)*cell};
    const routeKey=`${routeBounds.x0},${routeBounds.y0},${routeBounds.x1},${routeBounds.y1}`;highlightedRoute=view.highlightRoute??null;const focusRoute=(refKind==='route'?routesById.get(refId):null)||(highlightedRoute===null?null:routesById.get(highlightedRoute)||null);
    // DESIGN.md 7.4: the routes serving a selected stop, industry or town stand out; a hovered or highlighted route still wins.
    const serving=!focusRoute&&view.servingRoutes?.length?new Set(view.servingRoutes):null;
    if(showRoutes)for(const r of game.routes||[])if(r.path?.length){const cached=routeDrawing(r,routeKey);if(cached.count)strokeRoute(r,cached,focusRoute?r!==focusRoute?MAP.line.dim:1:serving&&!serving.has(r.id)?MAP.line.dim:1,Boolean(serving?.has(r.id)));}
    // Selection belongs to the ground. Full-opacity foundations, fences,
    // trees, buildings and vehicles paint over both its tint and its border,
    // including when the transparent scenery layer is replayed from cache.
    const selectedStation=selected&&(airportIndex.get(selected.y*game.width+selected.x)||(game.stations||[]).find(s=>s.x===selected.x&&s.y===selected.y));
    const placing=['stop','bus-stop','train-stop','port'].includes(tool)?hover:null,serviceCenter=placing?null:selectedStation;
    ctx.save();
    if(serviceCenter?.mode==='air')airportReach(serviceCenter);
    else if(serviceCenter){ctx.fillStyle=alpha(COLORS.paper,.1);ring(serviceCenter.x,serviceCenter.y,STATION_RADIUS);ctx.fill();reachRing(serviceCenter.x,serviceCenter.y);for(const node of [...(game.cities||[]),...(game.industries||[])])if((node.kind?industryDistance(node,serviceCenter):Math.hypot(node.x-serviceCenter.x,node.y-serviceCenter.y))<=STATION_RADIUS)highlight(node,COLORS.paper,false,industrySize(node));}
    ctx.restore();
    const chosenVehicle=view.selectedVehicleId==null?null:frameVehicles.find(v=>v.id===view.selectedVehicleId&&(routesById.get(v.routeId)?.mode!=='air'||airPoses.has(v)));
    const carrierTile=chosenVehicle&&!selected?vehicleWorldPoint(chosenVehicle):null;
    const selectionArea=selectionUnderlay(selected||(carrierTile&&{x:Math.floor(carrierTile.x+.5),y:Math.floor(carrierTile.y+.5)}),Boolean(carrierTile));
    if(chosenVehicle){
      const route=routesById.get(chosenVehicle.routeId),p=route?carrierPoint(chosenVehicle,route):vehicleToScreen(chosenVehicle.x,chosenVehicle.y),r=route?.mode==='water'?Math.max(20,20*camera.zoom):Math.max(11,14*camera.zoom);
      ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.beginPath();ctx.arc(p.x,p.y-2*camera.zoom,r,0,TAU);
      ctx.strokeStyle=MAP.selection.casing;ctx.lineWidth=MAP.selection.casingWidth;ctx.stroke();ctx.strokeStyle=MAP.selection.color;ctx.lineWidth=MAP.selection.width;ctx.stroke();ctx.restore();
    }
    if(layers.vehicles)for(const v of frameVehicles){const route=routesById.get(v.routeId);if(route?.mode==='water'&&visible(v.x,v.y))ship(v,route);}
    // Plane shadows fall on the ground before any upright, softer and paler the higher the plane flies.
    if(layers.vehicles&&airPoses.size){for(const a of airPoses.values()){const lift=a.lift*HEIGHT_STEP;ctx.globalAlpha=Math.max(.1,.28-lift/400);airportSprites.shadow(ctx,a.pose.heading,a.lift<.05?0:a.lift<1.5?1:2,a.ground.x+.43*lift,a.ground.y+.21*lift);}ctx.globalAlpha=1;}
    drawScenery({x0,y0,x1,y1},routesById);
    if(layers.vehicles&&airPoses.size)for(const a of [...airPoses.values()].filter(a=>!a.pose.ground).sort((a,b)=>a.body.y-b.body.y))airportSprites.aircraft(ctx,a.pose.heading,lineFor(a.route).fill,a.body.x,a.body.y);
    ctx.save();
    function surfacePath(points,fresh=true){if(fresh)ctx.beginPath();points.forEach(([u,v],i)=>{const p=projectGround(game,u,v);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.closePath();}
    function ring(x,y,radius){surfacePath(Array.from({length:80},(_,i)=>[x+.5+Math.cos(i/80*TAU)*radius,y+.5+Math.sin(i/80*TAU)*radius]));}
    // A highlighted route is restroked above the scenery, even with the routes layer off, and rings both of its stops.
    if(focusRoute?.path?.length){const cached=routeDrawing(focusRoute,routeKey);if(cached.count)strokeRoute(focusRoute,cached,1,true);for(const id of focusRoute.stops||[]){const s=(game.stations||[]).find(st=>st.id===id);if(!s)continue;if(s.mode==='air'){outline(s,stationSpan(s),{color:lineFor(focusRoute).fill,width:2.5,casing:alpha(COLORS.paper,.7),casingWidth:5});continue;}ring(s.x,s.y,21/TILE);ctx.strokeStyle=alpha(COLORS.paper,.7);ctx.lineWidth=5/camera.zoom;ctx.stroke();ctx.strokeStyle=lineFor(focusRoute).fill;ctx.lineWidth=2.5/camera.zoom;ctx.stroke();}}
    // A span is a square side or, for an airport, its {w, h}.
    function footprintPath(p,span=1,fresh=true){
      const {w,h}=typeof span==='number'?{w:span,h:span}:span,points=[],inset=.035,across=w-inset*2,down=h-inset*2;
      for(let n=0;n<=w;n++)points.push([p.x+inset+across*n/w,p.y+inset]);
      for(let n=1;n<=h;n++)points.push([p.x+w-inset,p.y+inset+down*n/h]);
      for(let n=1;n<=w;n++)points.push([p.x+w-inset-across*n/w,p.y+h-inset]);
      for(let n=1;n<h;n++)points.push([p.x+inset,p.y+h-inset-down*n/h]);
      surfacePath(points,fresh);
    }
    function highlight(p,color,filled=true,span=1){
      if(!p||p.x<0||p.y<0||p.x>=game.width||p.y>=game.height)return;
      footprintPath(p,span);ctx.fillStyle=color+'26';if(filled)ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1.5/camera.zoom;ctx.stroke();
    }
    // Cased footprint marks in screen px (DESIGN.md 9): the selection (signal over 5 px paper) and the pointer hover (paper at 85%).
    function outline(p,span,{color,width,casing=null,casingWidth=0,alpha:shade=1}){
      if(!p||p.x<0||p.y<0||p.x>=game.width||p.y>=game.height)return;
      footprintPath(p,span);const z=camera.zoom;ctx.lineJoin='round';
      if(casing){ctx.strokeStyle=casing;ctx.lineWidth=casingWidth/z;ctx.stroke();}
      ctx.globalAlpha=shade;ctx.strokeStyle=color;ctx.lineWidth=width/z;ctx.stroke();ctx.globalAlpha=1;
    }
    // A stop's catchment: a dashed paper ring over an ink casing at 35%.
    // An airport's reach: a rounded rectangle AIRPORT_REACH tiles around its tiles' centres, in the same dashed paper, with the towns it serves.
    function airportReach(site){
      const {w,h}=stationSpan(site),x0=site.x+.5,y0=site.y+.5,x1=site.x+w-.5,y1=site.y+h-.5,r=AIRPORT_REACH,z=camera.zoom,points=[];
      for(const [cx,cy,start] of [[x1,y0,-Math.PI/2],[x1,y1,0],[x0,y1,Math.PI/2],[x0,y0,Math.PI]])for(let i=0;i<=12;i++){const a=start+i/12*Math.PI/2;points.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}
      surfacePath(points);ctx.fillStyle=alpha(COLORS.paper,.1);ctx.fill();ctx.strokeStyle=alpha(MAP.reach.casing,MAP.reach.casingAlpha);ctx.lineWidth=3.5/z;ctx.stroke();ctx.setLineDash(MAP.reach.dash.map(n=>n/z));ctx.strokeStyle=MAP.reach.color;ctx.lineWidth=1.5/z;ctx.stroke();ctx.setLineDash([]);
      for(const city of game.cities||[])if(stationServes(site,city))highlight(city,COLORS.paper,false);
    }
    function reachRing(x,y){const z=camera.zoom;ring(x,y,STATION_RADIUS);ctx.strokeStyle=alpha(MAP.reach.casing,MAP.reach.casingAlpha);ctx.lineWidth=3.5/z;ctx.stroke();ctx.setLineDash(MAP.reach.dash.map(n=>n/z));ctx.strokeStyle=MAP.reach.color;ctx.lineWidth=1.5/z;ctx.stroke();ctx.setLineDash([]);}
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
    const previewSpan=p=>INDUSTRIES[tool]?industryFootprint(tool):BUILDINGS[tool]?buildingFootprint(tool):tool==='workshop'?2:siteSize(previewSite(p));
    // Placing an airport centres its 6 × 2 site on the pointer, in the model's colours, with its 7-tile reach.
    const airportSite=tool==='airport'&&hover&&tile(hover.x,hover.y)?{...airportPlacement(hover,view.airportAxis),mode:'air',axis:view.airportAxis==='y'?'y':'x'}:null;
    // Placing a stop draws its reach as a solid ring over the faint rings of existing stops of the same kind (64 at most).
    // Sites it would reach tick their markers rather than each drawing an outline; a town it reaches keeps its tile outline.
    if(placing){let rings=0;ctx.globalAlpha=.25;ctx.strokeStyle=COLORS.paper;ctx.lineWidth=1.5/camera.zoom;for(const st of game.stations||[])if(rings<64&&st.mode!=='air'&&(st.mode==='water')===(tool==='port')&&visible(st.x,st.y,STATION_RADIUS*TILE*camera.zoom)){ring(st.x,st.y,STATION_RADIUS);ctx.stroke();rings++;}ctx.globalAlpha=1;ctx.fillStyle=alpha(COLORS.paper,.13);ring(placing.x,placing.y,STATION_RADIUS);ctx.fill();reachRing(placing.x,placing.y);for(const city of game.cities||[])if(Math.hypot(city.x-placing.x,city.y-placing.y)<=STATION_RADIUS)highlight(city,COLORS.paper,false);}
    if(airportSite){highlight(airportSite,validPreview(airportSite.tool,airportSite)?'#f4d090':'#d7725f',true,stationSpan(airportSite));airportReach(airportSite);}
    // Your property, when app.js asks (building in towns, or inspecting a town or property), from the Town view in: buildings you
    // own solid, plots developers built on your zones dashed, each style one cased stroke. Vacant zones keep their own tint and square.
    propertyOutlines=0;
    if(view.propertyOutlines&&camera.zoom>=1&&sceneCache?.property){
      const z=camera.zoom,mark=MAP.property,shown=sceneCache.property.filter(site=>visible(site.x+site.span/2,site.y+site.span/2,48*site.span*z)&&!(selectionArea&&site.x===selectionArea.x&&site.y===selectionArea.y&&site.span===selectionArea.w&&site.span===selectionArea.h));
      ctx.save();ctx.lineJoin='round';
      for(const owned of [true,false]){
        ctx.beginPath();let count=0;for(const site of shown)if(site.owned===owned){footprintPath(site,site.span,false);count++;}
        if(!count)continue;
        ctx.setLineDash(owned?[]:mark.dash.map(n=>n/z));ctx.strokeStyle=alpha(mark.casing,mark.casingAlpha);ctx.lineWidth=mark.casingWidth/z;ctx.stroke();ctx.strokeStyle=mark.color;ctx.lineWidth=mark.width/z;ctx.stroke();propertyOutlines+=count;
      }
      ctx.restore();
    }
    // The locator ring (DESIGN.md 9): signal over a 5 px paper casing round a town's centre, an industry's footprint or a stop, and
    // along an airport's whole site.
    function locator(place,kind,fade){
      const size=kind==='industry'?industrySize(place):1,z=camera.zoom,mark=MAP.locator;ctx.save();ctx.globalAlpha=fade;
      if(kind==='stop'&&place.mode==='air')outline(place,stationSpan(place),{...mark,alpha:fade});
      else{ring(place.x+(size-1)/2,place.y+(size-1)/2,kind==='town'?1.6:kind==='industry'?size*.8:.85);ctx.lineJoin='round';ctx.strokeStyle=mark.casing;ctx.lineWidth=mark.casingWidth/z;ctx.stroke();ctx.strokeStyle=mark.color;ctx.lineWidth=mark.width/z;ctx.stroke();}
      ctx.restore();
    }
    if(refKind==='town'||refKind==='industry'||refKind==='stop'){const place=(refKind==='town'?game.cities:refKind==='industry'?game.industries:game.stations)?.find(item=>item.id===refId);if(place)locator(place,refKind,locatorFade);}
    const spanTool=['bridge','railbridge','tunnel','railtunnel'].includes(tool),spanPoints=preview?.length?preview:hover?[hover]:[];
    const spanQuote=(spanTool||['road','rail','raise','lower','level','residential','commercial','industrial','bulldoze'].includes(tool))&&spanPoints.length?spanTool&&spanPoints.length<3?{ok:false,placements:[]}:quoteBuildPlan(game,tool,spanPoints,{preferredMode}):null;
    // Stroke quotes mark each placement with the running-balance state that release will meet.
    const states=spanQuote?.placements?.[0]?.state?new Map(spanQuote.placements.map(p=>[p.y*game.width+p.x,p.state])):null,refused=['road','rail'].includes(tool)&&spanQuote?.ok===false,routeTiles=tool==='bulldoze'?routeTileIndex(game):null;
    const previewValid=p=>spanQuote&&!states?spanQuote.ok===true:validPreview(tool,p,preferredMode);
    // Zone strokes leave out roads and built tiles and demolition leaves out empty ground, so those tiles and a pointer
    // past a clamped rectangle stay unmarked; a zone tile no road reaches is muted.
    const sparse=['residential','commercial','industrial','bulldoze'].includes(tool)&&states&&spanPoints.length>1,roadless=spanQuote?.needRoad?new Set(spanQuote.placements.filter(p=>p.needsRoad).map(p=>p.y*game.width+p.x)):null,planned=p=>{if(!sparse)return true;const site=previewSite(p);return states.has(site.y*game.width+site.x)||previewValid(p);};
    const previewColor=(p,valid)=>{const site=previewSite(p),key=site.y*game.width+site.x,state=states?.get(key);if(!state)return previewValid(p)?valid:'#d7725f';return ['blocked','slope','funds'].includes(state)?'#d7725f':refused?'#cdbfa6':routeTiles?.has(key)?'#e3aa6d':roadless?.has(key)?'#c29a5b':valid;};
    const earthwork=['raise','lower','level'].includes(tool),highlightPreview=(p,color)=>earthwork?highlightVertex(p,color):highlight(previewSite(p),color,tool!=='inspect',previewSpan(p));
    for(const p of preview||[])if(planned(p))highlightPreview(p,previewColor(p,'#f2d88d'));
    if(hover&&!airportSite&&planned(hover)&&!preview?.area?.capped){if(tool==='inspect'){if(!selectionArea||hover.x<selectionArea.x||hover.y<selectionArea.y||hover.x>=selectionArea.x+selectionArea.w||hover.y>=selectionArea.y+selectionArea.h)outline(previewSite(hover),previewSpan(hover),MAP.hover);}else highlightPreview(hover,previewColor(hover,'#f4d090'));}
    // The keyboard cursor frames its own tile, or grid point for earthworks, in dashed signal orange over paper;
    // the frame sits just outside the tile, so the preview colour inside still shows whether it can be built.
    if(hover?.keyboard&&tile(hover.x,hover.y)){const {x,y}=hover,o=.09;if(earthwork){const c=projectGround(game,x,y);ctx.beginPath();ctx.arc(c.x,c.y,8/camera.zoom,0,TAU);}else surfacePath([[x-o,y-o],[x+1+o,y-o],[x+1+o,y+1+o],[x-o,y+1+o]]);ctx.lineJoin='round';ctx.strokeStyle=MAP.cursor.casing;ctx.lineWidth=4.5/camera.zoom;ctx.stroke();ctx.setLineDash(MAP.cursor.dash.map(n=>n/camera.zoom));ctx.strokeStyle=MAP.cursor.color;ctx.lineWidth=2.25/camera.zoom;ctx.stroke();ctx.setLineDash([]);}
    if(refused)for(const issue of spanQuote.issues)if(issue.at)highlight(issue.at,'#d7725f',false);
    for(const stop of routeStops){const s=typeof stop==='object'?stop:(game.stations||[]).find(st=>st.id===stop);if(s?.mode==='air')outline(s,stationSpan(s),{color:'#f4d397',width:2});else if(s){ctx.strokeStyle='#f4d397';ctx.lineWidth=2/camera.zoom;ring(s.x,s.y,21/TILE);ctx.stroke();}}
    ctx.restore();ctx.restore();
    drawWeather(ctx,{game,layers,camera,width:W,height:H,day:presentationTime()});
    if(hover&&(tool==='raise'||tool==='lower')){
      const t=tile(hover.x,hover.y);if(t){const p=gridPointToScreen(hover.x,hover.y),level=surfaceHeight(game,hover.x,hover.y),allowed=previewValid(hover);pill(p.x,p.y-28*camera.zoom,allowed?`Level ${level} → ${level+(tool==='raise'?1:-1)}`:`Level ${level}`,{h:25,color:allowed?COLORS.ink:STATES.error.color});}
    }
    const contextBubbles=contextArcs(view.context);
    // Labels stay crisp at every camera zoom, with population separated from place names.
    labelRects.length=0;const placed=placeOverlays(),shift=overlayShift();
    lensStats=lens?{cargo:lens,sources:0,buyers:0,towns:0}:null;const townLens=city=>lens?townLensRole(game,city,lens):null;
    if(layers.names)for(const city of game.cities||[]){const label=placed.labels.get(city);if(!label||!visible(city.x,city.y))continue;const p={x:label.cx+shift.x},y=label.cy+shift.y;labelRects.push({id:city.id,x:label.x+shift.x,y:label.y+shift.y,w:label.w,h:label.h});
      if(detailLevel==='region'){const name=city.name||'New city';ctx.font=font(MAP.nameplate.regionName.weight,MAP.nameplate.regionName.size);const w=ctx.measureText(name).width+16;plate(p.x-w/2,y-11,w,22);ctx.fillStyle=COLORS.ink;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name,p.x,y+.5);if(townLens(city))lensChip(label.x+shift.x-7,y,townLens(city));continue;}
      const {name,pop,nameW,w}=nameplate(city),left=p.x-w/2;plate(left,y-13,w,26);ctx.textAlign='left';ctx.textBaseline='middle';ctx.font=font(MAP.nameplate.name.weight,MAP.nameplate.name.size);ctx.fillStyle=COLORS.ink;ctx.fillText(name,left+10,y+.5);ctx.fillStyle=COLORS.rule;ctx.fillRect(Math.round(left+nameW+20),Math.round(y-7),1,14);ctx.font=font(MAP.nameplate.population.weight,MAP.nameplate.population.size);ctx.fillStyle=MAP.nameplate.population.color;ctx.fillText(pop,left+nameW+31,y+.5);
      if(townLens(city))lensChip(left-13,y,townLens(city));
    }
    // A cargo lens draws its producers and buyers last, at full strength with a role tab and, from Town view in, their names; other sites recede to half strength.
    // Served sites wear their route's ring, a hovered or chosen site names its state, and while a stop is placed the sites it would reach are ticked and the rest recede.
    const served=servedSites();markerStats={drawn:0,served:0,waiting:0,meters:0,covered:0};
    const industryBadge=(ind,role)=>{const marker=industryMarker(ind,placed,shift),known=Boolean(INDUSTRIES[ind.kind]),kind=Object.keys(INDUSTRIES[ind.kind]?.outputs||{})[0]||'goods',hovered=hover&&industryContains(ind,hover.x,hover.y),chosen=selected&&industryContains(ind,selected.x,selected.y),svc=served.get(ind.id),status=known&&(hovered||chosen||svc?.buyer)?industryStatus(ind):null,waiting=Boolean(svc?.buyer&&status.state==='waiting'),covered=Boolean(placing)&&industryDistance(ind,placing)<=STATION_RADIUS,name=ind.name||titleCase(ind.kind),label=layers.names&&(hovered||chosen||role&&detailLevel!=='region')?(hovered||chosen)&&status?`${name} · ${status.label}`:name:null;if(role&&marker.x>=0&&marker.y>=0&&marker.x<=W&&marker.y<=H)lensStats[role==='source'?'sources':'buyers']++;ctx.globalAlpha=lens&&!role&&!hovered&&!chosen||placing&&!covered?.5:1;if(layers.industryIcons){const fill=known&&detailLevel!=='region'?outputFill(ind):0;if(marker.stem)line(ctx,[[marker.x,marker.y],[marker.stem.x,marker.stem.y]],'#475b455b',1);if(marker.x>=0&&marker.y>=0&&marker.x<=W&&marker.y<=H){markerStats.drawn++;if(svc)markerStats.served++;if(waiting)markerStats.waiting++;if(fill>0)markerStats.meters++;if(covered)markerStats.covered++;}resourceMarker(marker.x,marker.y,kind,marker.size,label,role,{color:svc&&lineColor(svc.color).fill,fill,missing:waiting?status.missing:null,covered});}else if(label)pill(marker.x,marker.y,label,{h:28});ctx.globalAlpha=1;};
    const lensSites=[];for(const ind of game.industries||[]){if((!layers.names&&!layers.industryIcons)||!visible(ind.x,ind.y,180*camera.zoom))continue;const role=lensRole(ind.kind,lens);if(role)lensSites.push([ind,role]);else industryBadge(ind,null);}for(const [ind,role] of lensSites)industryBadge(ind,role);
    for(const bubble of contextBubbles)contextBubble(bubble);
    // A stop is a roundel centred in its sign box: an ink ring, an --edge ring when no route uses it and an error ring when all
    // its routes are offline. From Town in it carries the bullets of the routes that call there; Region keeps the terminus
    // bullets that miss the town names. A roundel stepped off a label or another stop keeps a thin stem to its stop.
    signStats={drawn:0,active:0,idle:0,broken:0,named:0};signRects.length=0;signEnds.clear();
    if(layers.stations){const calls=stopCalls(),region=detailLevel==='region',radius=ROUNDEL[detailLevel]||ROUNDEL.town;for(const st of game.stations||[]){const sign=placed.signs.get(st.y*game.width+st.x),q=signTile(st);if(!sign||!visible(q.x,q.y))continue;const x=sign.x+shift.x,y=sign.y+shift.y,cx=x+sign.size/2,cy=y+sign.size/2,routes=calls.get(st.id)||[],state=!routes.length?'idle':routes.some(r=>r.active!==false)?'active':'broken';if(sign.stem)line(ctx,[[cx,cy],[sign.stem.x+shift.x,sign.stem.y+shift.y]],alpha(COLORS.ink,.35),1);roundel(cx,cy,radius,state==='idle'?MAP.roundel.unusedRing:state==='broken'?STATES.error.color:MAP.roundel.ring);const end=stopBullets(st,routes,cx+radius+3,cy,region);signRects.push({x,y,w:Math.max(sign.size,end-x),h:sign.size});signEnds.set(st,end);signStats.drawn++;signStats[state]++;}}
    if(stopPickingMode){
      const pulse=view.stopPicking.reducedMotion||motionPreference?.matches?1:.78+.16*Math.sin(now/550);
      for(const st of game.stations||[]){
        const q=signTile(st);if(st.mode!==stopPickingMode||!visible(q.x,q.y))continue;
        const marker=stationMarker(st),cx=marker.x+marker.size/2,cy=marker.y+marker.size/2,chosen=st.id===view.stopPicking.selectedId||routeStops.includes(st.id),radius=(ROUNDEL[detailLevel]||ROUNDEL.town)+6;
        ctx.save();ctx.globalAlpha=chosen?1:pulse;ctx.beginPath();ctx.arc(cx,cy,radius,0,TAU);ctx.strokeStyle=MAP.selection.casing;ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle=chosen?MAP.selection.color:MAP.roundel.ring;ctx.lineWidth=2;ctx.stroke();ctx.restore();
        if(!layers.stations)roundel(cx,cy,ROUNDEL[detailLevel]||ROUNDEL.town,MAP.roundel.ring);
        if(chosen||hover&&stationContains(st,hover.x,hover.y))pill(cx,cy-radius-15,st.name||'Stop',{h:24});
      }
    }
    // A hovered route wears its bullet at both of its end stops: where the stop's row left it out (Region, or a fourth route), after
    // the row, or under the roundel when a town name is in the way.
    const refRoute=refKind==='route'?routesById.get(refId):null;if(refRoute)for(const id of [refRoute.stops?.[0],refRoute.stops?.at(-1)]){const st=(game.stations||[]).find(item=>item.id===id);if(!st||shownBullets.has(`${st.id} ${refRoute.id}`)||!visible(signTile(st).x,signTile(st).y))continue;const m=stationMarker(st),size=detailLevel==='region'?MAP.bullet.small:MAP.bullet.size,w=bulletWidth(refRoute,size),x=(signEnds.get(st)??m.x+m.size)+3,y=m.y+m.size/2,free=!labelRects.some(r=>x<r.x+r.w&&x+w>r.x&&y-size/2<r.y+r.h&&y+size/2>r.y);drawBullet(ctx,free?x:m.x+m.size/2-w/2,free?y:m.y+m.size+size/2+3,refRoute,size);}
    // The reach pill sits above stop signs and town names, so neither hides it.
    const airReach=airportSite||(serviceCenter?.mode==='air'?serviceCenter:null);
    if(airReach){const top=gridPointToScreen(airReach.x+.5-AIRPORT_REACH*Math.SQRT1_2,airReach.y+.5-AIRPORT_REACH*Math.SQRT1_2);pill(top.x,top.y-15,`${AIRPORT_REACH}-tile reach`,{h:25,color:COLORS.ink2});}
    else if(placing||serviceCenter){const center=placing||serviceCenter,p=worldToScreen(center.x,center.y);pill(p.x,p.y-STATION_RADIUS*TILE*Math.SQRT1_2*camera.zoom-15,'5-tile reach',{h:25,color:COLORS.ink2});}
    // A referenced carrier keeps its locator ring above the map; the chosen
    // carrier's ground area and ring were already drawn beneath its body.
    const refVehicle=refKind==='vehicle'?frameVehicles.find(v=>v.id===refId&&(routesById.get(v.routeId)?.mode!=='air'||airPoses.has(v))):null;if(refVehicle){const route=routesById.get(refVehicle.routeId),p=route?carrierPoint(refVehicle,route):vehicleToScreen(refVehicle.x,refVehicle.y),r=(route?.mode==='water'?Math.max(20,20*camera.zoom):Math.max(11,14*camera.zoom))+4;ctx.save();ctx.globalAlpha=locatorFade;ctx.beginPath();ctx.arc(p.x,p.y-2*camera.zoom,r,0,TAU);ctx.strokeStyle=MAP.locator.casing;ctx.lineWidth=MAP.locator.casingWidth;ctx.stroke();ctx.strokeStyle=MAP.locator.color;ctx.lineWidth=MAP.locator.width;ctx.stroke();ctx.restore();}
    if(layers.vehicles&&layers.vehicleLoads)for(const v of frameVehicles)vehicleLoadIndicator(v,routesById.get(v.routeId));
    // A pointed-at or chosen stop names itself beside its roundel and bullets, above the load badges of vehicles waiting there.
    for(const st of layers.stations&&layers.names?new Set([hover&&(stationIndex.get(hover.y*game.width+hover.x)||airportIndex.get(hover.y*game.width+hover.x)),selectedStation]):[]){if(!st||!visible(signTile(st).x,signTile(st).y))continue;const m=stationMarker(st),name=st.name||'Stop';ctx.font=font(500,12);const w=ctx.measureText(name).width+16,right=Math.max(m.x+m.size,signEnds.get(st)??0)+4+w/2;pill(right+w/2>W-8?m.x-4-w/2:right,m.y+m.size/2,name,{h:26});signStats.named++;}
    // An offline route pins its first gap with the cut glyph and a Not connected plate, above the load badges of vehicles stuck
    // beside it, so the fix is found on the map rather than in a toast.
    routeBreaks=0;for(const r of game.routes||[])if(r.active===false&&r.path?.length&&(showRoutes||r===focusRoute)){const at=routeBreak(r);if(!at||!visible(at.x,at.y))continue;const p=worldToScreen(at.x,at.y),a=r.path[Math.max(0,at.index-1)],b=r.path[Math.min(r.path.length-1,at.index+1)],pa=worldToScreen(a.x,a.y),pb=worldToScreen(b.x,b.y);routeBreaks++;cutMark(p.x,p.y,pb.x-pa.x,pb.y-pa.y);pill(p.x,p.y-24*Math.max(1,camera.zoom),'Not connected',{h:23,color:STATES.error.color});}
    if(layers.deliveries&&view.floaters?.length)drawFloaters(view.floaters,now);
    // Extremely light edge shade holds the terrain together without dimming the playfield.
    const vignette=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.3,W/2,H/2,Math.max(W,H)*.75);vignette.addColorStop(0,'#21382b00');vignette.addColorStop(1,'#21382b10');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
  }
  // The one overview pixel along an axis whose sample is tile t, or -1 when downsampling skips that tile.
  const minimapPixel=(t,step,size)=>{const p=Math.floor(t/step);for(let q=Math.max(0,p-1);q<=Math.min(size-1,p+1);q++)if(Math.floor((q+.5)*step)===t)return q;return -1;};
  function cacheMinimap(){
    ensureRevision();const scale=Math.min(1,MINIMAP_EDGE/Math.max(game.width,game.height));
    const width=Math.max(1,Math.round(game.width*scale)),height=Math.max(1,Math.round(game.height*scale));
    if(minimapRevision===cachedRevision&&minimapLayer.width===width&&minimapLayer.height===height)return;
    // An ecology day journals the few hundred cells it rewrote. With the same layers, size and
    // palette only their samples are recoloured; a pixel a network or industry overlay won stays.
    const changes=minimapRevision>=0&&minimapPalette===palette&&minimapPixels&&minimapLayer.width===width&&minimapLayer.height===height?surfaceChangesSince(game,minimapRevision):null;
    if(minimapLayer.width!==width||minimapLayer.height!==height||!minimapPixels){
      minimapLayer.width=width;minimapLayer.height=height;
      minimapPixels=minimapLayer.getContext('2d').createImageData(width,height);
      minimapWords=new Uint32Array(minimapPixels.data.buffer);minimapMask=new Uint8Array(width*height);
    }
    // Daily ecology visits at most 512² representative tiles, even on a 2048²
    // world. Thin roads would disappear under point sampling, so their sparse
    // index is rebuilt only when the transport network changes, never each day.
    const stepX=game.width/width,stepY=game.height/height;
    const packed=hex=>new Uint32Array(new Uint8Array([parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),255]).buffer)[0];
    const colors={grass:packed(palette.ground),water:packed(palette.deep),forest:packed(palette.forest),mountain:packed(palette.mountain),rock:packed(palette.mountain),sand:packed(palette.sand),snow:packed(palette.ground2),road:packed('#d7cbb0'),rail:packed('#655f52'),building:packed('#cfb78b'),zone:packed('#b2b78c'),marsh:packed('#708879'),saltflat:packed('#e3d9bc')};
    const sample=(tx,ty)=>{
      const t=game.tiles[ty*game.width+tx],terrain=t.terrain==='forest'&&!layers.trees?'grass':t.terrain;
      return layers.buildings&&(t.building||buildingAt(game,tx,ty))?colors.building:layers.rails&&t.rail?colors.rail:layers.roads&&t.road?colors.road:layers.zones&&t.zone?colors.zone:terrain==='water'?colors.water:terrain==='forest'?colors.forest:terrainOverviewColor(game,tx,ty);
    };
    if(changes){
      let x0=width,y0=height,x1=-1,y1=-1,samples=0;
      for(const index of changes){
        const tx=index%game.width,ty=Math.floor(index/game.width),x=minimapPixel(tx,stepX,width),y=minimapPixel(ty,stepY,height),at=y*width+x;
        if(x<0||y<0||minimapMask[at])continue;
        minimapWords[at]=sample(tx,ty);samples++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
      }
      minimapTerrainSamples=samples;
      if(samples)minimapLayer.getContext('2d').putImageData(minimapPixels,0,0,x0,y0,x1-x0+1,y1-y0+1);
      minimapRevision=cachedRevision;return;
    }
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)minimapWords[y*width+x]=sample(Math.floor((x+.5)*stepX),Math.floor((y+.5)*stepY));
    minimapTerrainSamples=width*height;minimapMask.fill(0);
    if(scale<1&&(layers.roads||layers.rails)){
      if(minimapNetworkGame!==game||minimapNetworkRevision!==(game.networkRevision||0)){
        minimapNetwork=networkIndex(game);
        minimapNetworkGame=game;minimapNetworkRevision=game.networkRevision||0;minimapNetworkScans++;
      }
      for(const id of minimapNetwork){const t=game.tiles[id],color=layers.buildings&&t.building?colors.building:layers.rails&&t.rail?colors.rail:layers.roads&&t.road?colors.road:null;if(color!==null){const at=Math.floor((Math.floor(id/game.width)+.5)/stepY)*width+Math.floor((id%game.width+.5)/stepX);minimapWords[at]=color;minimapMask[at]=1;}}
    }
    if(layers.buildings)for(const industry of game.industries||[])for(const p of industryTiles(industry)){const at=Math.floor((p.y+.5)/stepY)*width+Math.floor((p.x+.5)/stepX);minimapWords[at]=colors.building;minimapMask[at]=1;}
    if(layers.stations){const field=packed('#bdb8a6');for(const ap of airports)for(const p of stationTiles(ap)){const at=Math.floor((p.y+.5)/stepY)*width+Math.floor((p.x+.5)/stepX);minimapWords[at]=field;minimapMask[at]=1;}}
    minimapLayer.getContext('2d').putImageData(minimapPixels,0,0);minimapRevision=cachedRevision;minimapPalette=palette;
  }
  function drawMinimap(minimap){
    cacheMinimap();const rect=minimap.getBoundingClientRect();const mw=Math.round(rect.width||180),mh=Math.round(rect.height||115),ratio=Math.min(window.devicePixelRatio||1,2);if(minimap.width!==mw*ratio||minimap.height!==mh*ratio){minimap.width=mw*ratio;minimap.height=mh*ratio;}
    const c=minimap.getContext('2d');c.setTransform(ratio,0,0,ratio,0,0);c.imageSmoothingEnabled=false;c.drawImage(minimapLayer,0,0,mw,mh);c.imageSmoothingEnabled=true;
    const sx=mw/game.width,sy=mh/game.height;c.strokeStyle='#f5e4b4';c.lineWidth=1;
    if(layers.routes)for(const r of game.routes||[])if(r.path?.length){
      let entry=minimapRoutePaths.get(r);
      if(!entry||entry.path!==r.path||entry.length!==r.path.length||entry.sx!==sx||entry.sy!==sy){
        // A flight is drawn straight between its airports' centres.
        const path=new Path2D(),ends=r.mode==='air'?(r.stops||[]).map(id=>stationById.get(id)):null;
        if(ends?.every(Boolean))ends.map(airportCentre).forEach((p,i)=>i?path.lineTo(p.x*sx,p.y*sy):path.moveTo(p.x*sx,p.y*sy));
        else r.path.forEach((p,i)=>i?path.lineTo((p.x+.5)*sx,(p.y+.5)*sy):path.moveTo((p.x+.5)*sx,(p.y+.5)*sy));
        entry={path:r.path,length:r.path.length,sx,sy,drawing:path};minimapRoutePaths.set(r,entry);
      }
      const offline=r.active===false;c.strokeStyle=offline?STATES.error.color:lineFor(r).fill;c.lineWidth=1.4;if(offline)c.setLineDash([3,2]);c.stroke(entry.drawing);if(offline)c.setLineDash([]);
    }
    if(layers.industryIcons&&!lens){c.fillStyle='#d9ba7d';for(const ind of game.industries||[])c.fillRect((ind.x+.5)*sx-1,(ind.y+.5)*sy-1,2,2);}
    // Sites your freight serves stand out in green, or amber while a served factory still lacks an input.
    if(layers.industryIcons&&!lens){const served=servedSites();if(served.size)for(const ind of game.industries||[]){const svc=served.get(ind.id);if(!svc)continue;c.fillStyle=svc.buyer&&industryStatus(ind).state==='waiting'?'#bd8e43':'#4e7747';c.fillRect((ind.x+.5)*sx-1.5,(ind.y+.5)*sy-1.5,3,3);}}
    if(layers.buildings)for(const city of game.cities||[])dot(c,(city.x+.5)*sx,(city.y+.5)*sy,2.5,'#f7f2d8');
    if(layers.stations)for(const stop of game.stations||[]){const x=(stop.x+.5)*sx,y=(stop.y+.5)*sy;if(stop.mode==='air'){const m=airportCentre(stop),ax=m.x*sx,ay=m.y*sy;c.fillStyle='#e7e9ef';c.beginPath();c.moveTo(ax,ay-3.2);c.lineTo(ax+3.2,ay);c.lineTo(ax,ay+3.2);c.lineTo(ax-3.2,ay);c.closePath();c.fill();dot(c,ax,ay,1.3,'#56718a');}else if(stop.mode==='water'){c.fillStyle='#d4ebe1';c.beginPath();c.moveTo(x,y-3);c.lineTo(x+3,y);c.lineTo(x,y+3);c.lineTo(x-3,y);c.closePath();c.fill();dot(c,x,y,1.4,'#376e7e');}else dot(c,x,y,1.7,stop.mode==='rail'?'#365b59':'#658153');}
    const footprint=viewportCorners().map(p=>[p.x/TILE*sx,p.y/TILE*sy]);
    c.beginPath();footprint.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle='#f4efcc12';c.fill();c.strokeStyle='#f6edc7';c.lineWidth=1.3;c.stroke();
    // A cargo lens replaces the industry dots with its producers and buyers, squares in their role colours above the view outline, and rings the towns that buy it.
    if(lens){for(const city of game.cities||[]){const role=townLensRole(game,city,lens);if(!role)continue;c.beginPath();c.arc((city.x+.5)*sx,(city.y+.5)*sy,4,0,TAU);c.strokeStyle=LENS_COLORS[role];c.lineWidth=1.5;c.stroke();}for(const ind of game.industries||[]){const role=lensRole(ind.kind,lens);if(!role)continue;const span=industrySize(ind),x=Math.round((ind.x+span/2)*sx),y=Math.round((ind.y+span/2)*sy),s=mw>=300?6:4;c.fillStyle='#fbf6e3';c.fillRect(x-s/2-1.5,y-s/2-1.5,s+3,s+3);c.fillStyle=LENS_COLORS[role];c.fillRect(x-s/2,y-s/2,s,s);}}

  }
  // Where a vehicle is drawn, in tile coordinates: a plane's pose (on its stand, taxiing or in the air), else its track position.
  function vehicleWorldPoint(v){
    v=presentedVehicle(v);const route=(game.routes||[]).find(r=>r.id===v?.routeId);if(route?.mode!=='air')return{x:v.x,y:v.y};
    // Follow runs before render, so the previous frame's air pose can be stale.
    ensureRevision();const a=airPose(v,route);return a?{x:a.pose.x-.5,y:a.pose.y-.5}:{x:v.x,y:v.y};
  }
  // Record the visible fleet and vehicles that can enter it before the next
  // world update. Flat projection avoids touching terrain caches off screen.
  function motionVehicles(daysAhead=0){
    if(!layers.vehicles)return [];
    const routes=new Map((game.routes||[]).map(route=>[route.id,route])),selected=new Set(frameVehicles.map(v=>presentationSources.get(v)||v));
    const days=Math.max(0,Number(daysAhead)||0);
    for(const vehicle of game.vehicles||[]){
      const mode=routes.get(vehicle.routeId)?.mode;if(!mode)continue;
      // Model weather, seeded variation and service support stay below 1.3×.
      // A unit of travel projects to at most sqrt(2) tile widths; planes also
      // need their airport/flight height and curve gutter, as in frame culling.
      const travel=(VEHICLE_SPEEDS[mode]||0)*(1+(vehicle.level??0)*.1)*1.3*days;
      const margin=Math.max(70,100*camera.zoom)+(mode==='air'?220*camera.zoom:0)+travel*TILE*Math.SQRT2*camera.zoom;
      if(visibleFlat(vehicle.x,vehicle.y,margin))selected.add(vehicle);
    }
    return [...selected];
  }
  resize();const first=game.cities?.[0];if(first)focus(first.x+4.5,first.y-4.5);else bounds();
  return {setGame,setPresentation,setLayers,getLayers,setTerrainHeight,getTerrainHeight,setLens,render,resize,worldToScreen,gridPointToScreen,screenToVertex,stationMarker,stationAtMarker,drawBullet,vehicleAt,vehicleWorldPoint,motionVehicles,industryMarker,cityLabels:()=>labelRects.map(rect=>({...rect})),screenToTile,screenToInspectTile,pan,zoomAt,setZoom,focus,glideTo,stepCamera,setBand,screensTo,getCamera:()=>({...camera}),drawMinimap,getStats:()=>({projection:'isometric',presentationDay:presentationTime(),waterMotion:{builds:waterMotionBuilds,...waterMotionStats},terrainGeometry:true,maxTerrainHeight:MAX_HEIGHT,heightStep:heightStep,tileWidth:TILE*2,tileHeight:TILE,chunkCount:chunks.size,composedChunks,lazyChunks:lazyChunksWaiting,sceneBuilds,scenePatches,propertyOutlines,sceneryBatches:{...sceneryBudget.stats(),viewBytes:sceneryView?sceneryView.image.width*sceneryView.image.height*4:0,viewLimit:sceneryViewLimit,viewMinimumDraws:sceneryViewMinimumDraws(canvas.width*canvas.height*4),viewSourceDraws:sceneryView?.sourceDraws||0,viewBuilds:sceneryViewBuilds,viewDraws:sceneryViewDraws,enabled:sceneryBatching,builds:sceneryBatchBuilds,draws:sceneryBatchDraws,directDraws:sceneryDirectDraws,waitingForCamera:sceneryWaitingForCamera,pending:(sceneryBatching&&sceneCache&&!sceneCache.batchPlanReady?1:Math.max(0,(sceneCache?.pendingGroups?.length||0)-(sceneCache?.pendingIndex||0))+(sceneCache?.shadowPreparation?sceneCache.shadows.length-sceneCache.shadowPreparation.index:0))+lazyChunksWaiting+(sceneCache?.dirty?1:0),pendingGroups:Math.max(0,(sceneCache?.pendingGroups?.length||0)-(sceneCache?.pendingIndex||0)),pendingShadows:sceneCache?.shadowPreparation?sceneCache.shadows.length-sceneCache.shadowPreparation.index:0,preparationMs:sceneryPreparationMs,preparationBudgetMs:sceneryPrepareBudgetMs},foundationBuilds,foundationCacheSize:foundations.size,gardenSurfaces:gardenSurfaces.getStats(),routeSegmentsConsidered,routePathBuilds,routeBreaks,highlightRoute:highlightedRoute,hoverRef:lastHoverRef,gliding:Boolean(glide),contextTargets,lens:lensStats&&{...lensStats},industryMarkers:{...markerStats},markerTiles:markerTiles.size,overlays:{builds:overlayBuilds,...overlays?.stats},stopSigns:{...signStats},bulletTiles:bulletTiles.size,visibleVehicleCandidates:frameVehicles.length,cacheBytes,cacheLimit,cacheMax:CACHE_MAX,chunkTiles:CHUNK_TILES,rasterScale,pixelScale:rasterScale,detailLevel,view:ZOOM_VIEWS.find(view=>view.zoom===camera.zoom).name,devicePixelRatio:dpr,dpr,maxSurfaceWidth:largestSurface,maxSurfaceHeight:largestSurface,minimapWidth:minimapLayer.width,minimapHeight:minimapLayer.height,minimapMaxEdge:MINIMAP_EDGE,minimapWorldWidth:game.width,minimapWorldHeight:game.height,minimapTerrainSamples,minimapNetworkScans,minimapNetworkBytes:minimapNetwork?.bytes||0,vehicleIndicators:{...vehicleIndicatorCounts},preparedSprites:preparedSprites.getStats(),preparedTransport:preparedTransport.getStats(),vehicleSprites:vehicleSprites.getStats(),infrastructureSprites:infrastructureSprites.getStats(),preparedZooms:rasterBundles.size,loadBadgeCount:loadBadges.size,loadBadgeBuilds,airports:airports.length,aircraft:{...airStats},airportSprites:airportSprites?.getStats(),sprites:sprite?.getStats?.(),uprightSprites:uprightSprite?.getStats?.(),houseArtwork:getHouseAssetStats(game.biome),worldArtwork:worldArtStats(),treeShadows:treeShadowCacheStats(),weather:drawWeather.getStats(),marine:marine?.getStats?.(),layers:getLayers()})};
}
