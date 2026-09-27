import { BIOMES, CARGO, INDUSTRIES, BUILD_COSTS, VEHICLE_COSTS, VEHICLE_CAPACITIES, TOWN_CARGO } from './data.js';
import { generateWorld, seedNumber, WORLD_SIZES, NEW_WORLD_SIZES, DEFAULT_WORLD_SIZE, supportsGenerationVersion, worldGenerationOptions, validGenerationOptions } from './world.js';
import { BUILDINGS } from './buildings.js';
import { allocateTerrainObjects } from './world-terrain-objects.js';
import { industryContains, industryDistance, industryTiles, industrySiteProblem, industrySize, industryFootprint } from './industry-sites.js';
import { buildingAt, buildingSize, buildingFootprint, buildingTiles, buildingSiteProblem, placeBuildingSite } from './building-sites.js';
import { encodeGame, decodeGame, rememberGeneratedWorld } from './save-codec.js';
import { randomAt, localEnvironment, weatherAt, stepEcology } from './environment.js';
import { stepSettlements, housingCapacity } from './settlements.js';
import { nearbyCities, nearbyIndustries, nearbyStations, nearbyZones } from './simulation-spatial.js';
import { networkIndex, updateNetworkIndex } from './network-index.js';
import { initializeIndustry, stepIndustries } from './industry-simulation.js';
import { availableVehicleLevel, priceFor, inflationInfo, calendarMonth } from './economy-pricing.js';
import { TERRAIN_OBJECT_KINDS, terrainObjectAt, terrainObjectSize, terrainObjectTiles, terrainObjectGroundIsFlat, releaseTerrainObjects } from './terrain-objects.js';
import { LAND_HEIGHT_LEVELS } from './terrain-elevation.js';
import { surfaceHeight } from './terrain-geometry.js';
import { terraformProblem, planTerraformLevel, planTerraformStroke, planStructureSpan, networkEdgeAllowed, transportElevation, validStructureMetadata, networkTerrainProblem, networkTerrainPlanProblem } from './terrain-engineering.js';
export { priceFor, inflationInfo } from './economy-pricing.js';
export { industryConditions } from './industry-simulation.js';
export { settlementSuitability } from './settlements.js';
export { weatherAt, localEnvironment } from './environment.js';
export { WORLD_SIZES, NEW_WORLD_SIZES, worldGenerationOptions } from './world.js';
export { BUILDINGS } from './buildings.js';
export { buildingAt, buildingSize, buildingFootprint } from './building-sites.js';
export { BIOMES, CARGO, INDUSTRIES, BUILD_COSTS, VEHICLE_COSTS } from './data.js';

export const SAVE_KEY = 'transport-save-v1';
export const STATION_RADIUS = 5;
const DIRECTIONS = [[1,0],[-1,0],[0,1],[0,-1]];
const ZONE_TYPES = ['residential','commercial','industrial'];
const TRANSPORT_MODES = ['road','rail','water'];
const NETWORK_TOOLS = ['road','rail','bridge','railbridge','tunnel','railtunnel'];
const TERRAIN = new Set(['grass','water','forest','mountain','rock','sand','snow']);
const MAX_INVENTORY = 900;
const owns = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const clamp = (n, min, max) => Math.max(min, Math.min(max,n));
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const result = (ok,message,extra={}) => ({ok,message,...extra});
const moneyText = n => `$${Math.round(n).toLocaleString('en-US')}`;
const makeId = (game,prefix) => `${prefix}-${game.nextId++}`;
export function tileAt(game,x,y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y*game.width+x] : null;
}
export function industryAt(game,x,y) { return game.industries.find(i => industryContains(i,x,y)) || null; }
export function stationAt(game,x,y) { return game.stations.find(s => s.x === x && s.y === y) || null; }
export function hasClearableDecoration(tile) { return Boolean(tile&&tile.terrain!=='water'&&tile.terrain!=='mountain'&&typeof tile.detail==='string'&&tile.detail); }
export function constructionCost(game,tool,x,y) {
  if(!owns(BUILD_COSTS,tool))return 0;
  const tile=tileAt(game,x,y);
  let base=BUILD_COSTS[tool];
  if(tile&&NETWORK_TOOLS.includes(tool)){
    const mode=tool.startsWith('rail')?'rail':'road',bridge=tool==='bridge'||tool==='railbridge',tunnel=tool==='tunnel'||tool==='railtunnel';
    if(tile[mode]&&(!bridge||tile.bridge)&&(!tunnel||tile.tunnel))return 0;
    if(!tunnel)base+=tile.terrain==='forest'?80:tile.terrain==='rock'?100:0;
  }
  return priceFor(game,base);
}
function notify(game,message,type='info') {
  game.notifications.unshift({ id: makeId(game,'notice'), day:game.day, message, text:message, type });
  game.notifications.length = Math.min(game.notifications.length,24);
}
export function createGame({biome='taiga',seed=1847,size=DEFAULT_WORLD_SIZE,generationVersion,townCount,industryDistricts}={}) {
  if (!owns(BIOMES,biome)) biome='taiga';
  const defaults = worldGenerationOptions(size, biome);
  const settings = { townCount: townCount ?? defaults.townCount, industryDistricts: industryDistricts ?? defaults.industryDistricts };
  const generationOptions = settings.townCount === defaults.townCount && settings.industryDistricts === defaults.industryDistricts ? undefined : settings;
  const game = {
    version:1, siteFootprintVersion:1, terrainObjectVersion:1, seed:seedNumber(seed), biome, ...generateWorld(biome,seed,size,generationVersion,generationOptions),
    money:400000, day:0, totalDelivered:0, totalRevenue:0,
    monthlyIncome:0, monthlyExpenses:0, monthlyOperatingExpenses:0, monthlyIncomeAtAccountingStart:0, lastMonthlyProfit:0, lastMonthlyOperatingProfit:0, accountingStartDay:0,
    history:[], notifications:[], revision:0, networkRevision:0, nextId:100,
    totalExpenses:0, totalOperatingExpenses:0, lastDailyDay:0, lastMonth:0,
  };
  rememberGeneratedWorld(game);
  for(const industry of game.industries)initializeIndustry(game,industry);
  game.stations.push(
    {id:'station-1',name:`${game.cities[0].name} Central`,x:game.cities[0].x,y:game.cities[0].y,mode:'road'},
    {id:'station-2',name:`${game.cities[1].name} Central`,x:game.cities[1].x,y:game.cities[1].y,mode:'road'},
  );
  addRoute(game,{name:`${game.cities[0].name} · ${game.cities[1].name}`,mode:'road',stops:['station-1','station-2'],cargo:'passengers'});
  game.money=400000; game.monthlyExpenses=0; game.totalExpenses=0;
  game.notifications=[];
  notify(game,`Welcome to ${BIOMES[biome].name}. Your first passenger service is running. Connect an industry to grow your company.`,'success');
  return game;
}

export function stationCoverage(game,station) {
  const cities=nearbyCities(game,station.x,station.y,STATION_RADIUS).filter(city => distance(city,station)<=STATION_RADIUS);
  const industries=nearbyIndustries(game,station.x,station.y,STATION_RADIUS+2).filter(industry => industryDistance(industry,station)<=STATION_RADIUS);
  const zones=nearbyZones(game,station.x,station.y,STATION_RADIUS).filter(zone => distance(zone,station)<=STATION_RADIUS);
  const produces=new Set(cities.length ? ['passengers'] : []);
  const accepts=new Set(cities.length ? ['passengers',...TOWN_CARGO] : []);
  for (const industry of industries) {
    for (const cargo of Object.keys(INDUSTRIES[industry.kind].outputs)) produces.add(cargo);
    for (const cargo of Object.keys(INDUSTRIES[industry.kind].inputs)) accepts.add(cargo);
  }
  return { cities,industries,zones,produces:[...produces],accepts:[...accepts] };
}
// A two-stop passenger service connects two actual towns, even where older
// maps have overlapping catchments. It must not collect and return the same town.
export function passengerEndpoints(game,from,to) {
  if(!from||!to)return null;
  // Passenger trips need towns only. Computing full station coverage here
  // needlessly walked every industry footprint and development zone per stop.
  const fromCities=nearbyCities(game,from.x,from.y,STATION_RADIUS).filter(city=>distance(city,from)<=STATION_RADIUS);
  const toCities=nearbyCities(game,to.x,to.y,STATION_RADIUS).filter(city=>distance(city,to)<=STATION_RADIUS);
  let best=null,bestDistance=Infinity;
  for(const a of fromCities)for(const b of toCities){
    if(a.id===b.id)continue;
    const walking=distance(a,from)+distance(b,to);
    if(walking<bestDistance){best=[a,b];bestDistance=walking;}
  }
  return best;
}
const pathSearchBuffers = new WeakMap();
function validNetwork(tile,mode) {
  if(mode==='water')return tile?.terrain==='water';
  return tile && tile[mode] && (tile.terrain!=='water' || tile.bridge) && (tile.terrain!=='mountain' || tile.tunnel || tile.bridge);
}
export function findPath(game,from,to,mode='road') {
  if (!TRANSPORT_MODES.includes(mode) || !from || !to || !validNetwork(tileAt(game,from.x,from.y),mode) || !validNetwork(tileAt(game,to.x,to.y),mode)) return null;
  const start=from.y*game.width+from.x, target=to.y*game.width+to.x;
  // Reuse the visited lane across route checks. The frontier grows only as far
  // as the search reaches, so a 25-tile opening trip never allocates a second
  // full-world 16 MiB queue on a 2048 × 2048 continent.
  let buffers=pathSearchBuffers.get(game);
  if(!buffers||buffers.parent.length!==game.tiles.length){buffers={parent:new Int32Array(game.tiles.length),queue:new Int32Array(Math.min(4096,game.tiles.length)),visited:0};pathSearchBuffers.set(game,buffers);}
  const parent=buffers.parent;let queue=buffers.queue;
  // Zero means unvisited; stored predecessors use index+1. Clear only the last
  // search's frontier, rather than touching all four million cells per route.
  for(let i=0;i<buffers.visited;i++)parent[queue[i]]=0;
  let head=0,tail=1;queue[0]=start;parent[start]=start+1;
  const heuristic=id=>Math.abs(id%game.width-to.x)+Math.abs(Math.floor(id/game.width)-to.y);
  // Breadth-first order is retained for local routes. Long cross-map trips use
  // admissible Manhattan A*: still a shortest four-way path, without flooding
  // the entire continent when the destination lies along an open corridor.
  if(heuristic(start)>128){
    const costs=buffers.costs||(buffers.costs=new Uint32Array(game.tiles.length)),heap=[];
    const before=(a,b)=>a.f<b.f||a.f===b.f&&a.h<b.h;
    const push=node=>{let i=heap.length;heap.push(node);while(i){const p=(i-1)>>>1;if(!before(node,heap[p]))break;heap[i]=heap[p];i=p;}heap[i]=node;};
    const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&before(heap[child+1],heap[child]))child++;if(!before(heap[child],last))break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
    costs[start]=0;push({id:start,g:0,h:heuristic(start),f:heuristic(start)});
    while(heap.length){
      const node=pop(),current=node.id;if(parent[current]<0||node.g!==costs[current])continue;
      if(current===target)break;
      parent[current]=-parent[current];
      const x=current%game.width,y=Math.floor(current/game.width);
      for(const [dx,dy]of DIRECTIONS){
        const nx=x+dx,ny=y+dy,tile=tileAt(game,nx,ny);
        if(!validNetwork(tile,mode)||!networkEdgeAllowed(game.tiles[current],tile,dx,dy,mode,game,x,y))continue;
        const next=ny*game.width+nx,g=node.g+1;if(parent[next]<0||parent[next]&&costs[next]<=g)continue;
        if(parent[next]===0){if(tail===queue.length){const expanded=new Int32Array(Math.min(game.tiles.length,queue.length*2));expanded.set(queue);queue=buffers.queue=expanded;}queue[tail++]=next;}
        costs[next]=g;parent[next]=current+1;const h=heuristic(next);push({id:next,g,h,f:g+h});
      }
    }
  }else while(head<tail) {
    const current=queue[head++]; if(current===target) break;
    const x=current%game.width,y=Math.floor(current/game.width);
    for(const [dx,dy] of DIRECTIONS) {
      const nx=x+dx,ny=y+dy,tile=tileAt(game,nx,ny);
      if(!validNetwork(tile,mode) || !networkEdgeAllowed(game.tiles[current],tile,dx,dy,mode,game,x,y)) continue;
      const next=ny*game.width+nx;
      if(parent[next]!==0) continue;
      if(tail===queue.length){const expanded=new Int32Array(Math.min(game.tiles.length,queue.length*2));expanded.set(queue);queue=buffers.queue=expanded;}
      parent[next]=current+1;queue[tail++]=next;
    }
  }
  buffers.visited=tail;
  if(parent[target]===0) return null;
  const path=[];
  for(let p=target;;p=Math.abs(parent[p])-1) { path.push({x:p%game.width,y:Math.floor(p/game.width)});if(p===start) break; }
  return path.reverse();
}
function invalidateNetwork(game,points){const previous=game.networkRevision||0;game.revision++;game.networkRevision=previous+1;updateNetworkIndex(game,points,previous);}
function spend(game,cost) { game.money-=cost;game.monthlyExpenses+=cost;game.totalExpenses+=cost; }
export function quoteStructureSpan(game,tool,points) {
  const plan=planStructureSpan(game,tool,points);if(!plan.ok)return plan;
  const placements=plan.placements.map(p=>({...p,cost:constructionCost(game,p.tool,p.x,p.y)}));
  const cost=placements.reduce((sum,p)=>sum+p.cost,0);
  return {...plan,placements,cost,...game.money<cost?{ok:false,message:`Need ${moneyText(cost)} for the complete ${plan.structure}.`}:{}};
}
export function buildStructureSpan(game,tool,points) {
  const plan=quoteStructureSpan(game,tool,points);
  if(!plan.ok)return {...plan,cost:0,built:0,failed:points.length,skipped:0};
  let built=0,skipped=0;
  // The whole span is checked before any charge or mutation, so an invalid
  // portal, obstacle or short budget can never leave half a crossing behind.
  releaseTerrainObjects(game,plan.placements.filter(p=>p.cost>0));
  for(const p of plan.placements){
    const t=tileAt(game,p.x,p.y);
    if(p.cost===0){skipped++;continue;}
    t[plan.mode]=true;
    if(p.interior){t[plan.structure]=true;t.structureLevel=plan.level;t.structureAxis=plan.axis;}
    if(t.terrain==='forest'&&(!p.interior||plan.structure!=='tunnel')){t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';t.detail='';}
    if(!p.interior)t.detail='';
    built++;
  }
  if(built){spend(game,plan.cost);invalidateNetwork(game,plan.placements);}
  return result(true,built?`${plan.mode==='rail'?'Rail':'Road'} ${plan.structure} · level ${plan.height} · ${moneyText(plan.cost)}`:'Already built.',{cost:plan.cost,built,failed:0,skipped,level:plan.level,height:plan.height});
}
export function quoteTerraformLevel(game, points, { targetLevel } = {}) {
  const plan=planTerraformLevel(game,points,targetLevel);if(!plan.ok)return plan;
  const unitPrice=priceFor(game,BUILD_COSTS.level),placements=plan.placements.map(p=>({...p,cost:p.steps*unitPrice}));
  const cost=placements.reduce((sum,p)=>sum+p.cost,0);
  return {...plan,placements,cost,...game.money<cost?{ok:false,message:`Need ${moneyText(cost)} to level the complete area.`}:{}};
}
export function buildTerraformLevel(game, points, options) {
  const plan=quoteTerraformLevel(game,points,options);
  if(!plan.ok)return {...plan,cost:0,built:0,failed:Array.isArray(points)?points.length:0,skipped:0};
  return commitTerraformPlan(game,plan,'Leveled');
}
export function quoteTerraformStroke(game,tool,points){
  const plan=planTerraformStroke(game,tool,points);if(!plan.ok)return plan;
  const unitPrice=priceFor(game,BUILD_COSTS[tool]),placements=plan.placements.map(p=>({...p,cost:unitPrice})),cost=placements.length*unitPrice;
  return {...plan,placements,cost,...game.money<cost?{ok:false,message:`Need ${moneyText(cost)} to shape these points.`}:{}};
}
export function buildTerraformStroke(game,tool,points){
  const plan=quoteTerraformStroke(game,tool,points);
  if(!plan.ok)return {...plan,cost:0,built:0,failed:Array.isArray(points)?points.length:0,skipped:0};
  return commitTerraformPlan(game,plan,tool==='raise'?'Raised':'Lowered');
}
function commitTerraformPlan(game,plan,verb){
  const changed=plan.placements.filter(p=>!p.unchanged);
  if(!changed.length)return result(true,'Already level.',{cost:0,built:0,failed:0,skipped:plan.placements.length,unchanged:true,level:plan.level});
  // Adjacent parcels depend on the edited tile's collar, too. Release all of
  // those shared objects before altering any height in the paid area.
  const affected=new Map();
  for(const p of changed)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)affected.set(`${p.x+dx},${p.y+dy}`,{x:p.x+dx,y:p.y+dy});
  releaseTerrainObjects(game,[...affected.values()]);
  for(const p of changed){
    const tile=tileAt(game,p.x,p.y);tile.elevation=p.level/LAND_HEIGHT_LEVELS;tile.detail='';
    if(tile.terrain==='forest'||(tile.terrain==='mountain'&&tile.elevation<12/16)||(tile.terrain==='rock'&&tile.elevation<10/16))tile.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
  }
  spend(game,plan.cost);game.revision++;
  return result(true,`${verb} ${changed.length} point${changed.length===1?'':'s'} · ${moneyText(plan.cost)}`,{cost:plan.cost,built:changed.length,failed:0,skipped:plan.placements.length-changed.length,...plan.level!==undefined?{level:plan.level}:{}});
}
function closestCity(game,point,max=Infinity) {
  let closest=null,best=max;
  for(const city of game.cities) {const d=distance(city,point);if(d<=best){closest=city;best=d;}}
  return closest;
}
function rememberHousingOwners(game){
  for(let i=0;i<game.tiles.length;i++){
    const building=game.tiles[i].building;
    if(housingCapacity(building)&&!owns(building,'populationCityId'))building.populationCityId=closestCity(game,{x:i%game.width,y:Math.floor(i/game.width)},10)?.id??null;
  }
}
export function build(game,tool,x,y) {
  const t=tileAt(game,x,y);
  if(!t) return result(false,'Choose a tile inside the map.');
  if(!owns(BUILD_COSTS,tool)) return result(false,'Unknown construction tool.');
  if(tool==='level')return buildTerraformLevel(game,[{x,y}]);
  const point={x,y},station=stationAt(game,x,y),industry=industryAt(game,x,y),site=buildingAt(game,x,y),nature=terrainObjectAt(game,x,y);
  const city=game.cities.find(c=>c.x===x&&c.y===y);
  if(tool==='raise'||tool==='lower') {
    const problem=terraformProblem(game,tool,x,y);if(problem)return result(false,problem);
    const cost=constructionCost(game,tool,x,y);if(game.money<cost)return result(false,`Need ${moneyText(cost)} to shape this point.`);
    const level=surfaceHeight(game,x,y)+(tool==='raise'?1:-1);
    releaseTerrainObjects(game,Array.from({length:9},(_,n)=>({x:x+n%3-1,y:y+Math.floor(n/3)-1})));
    spend(game,cost);t.elevation=level/LAND_HEIGHT_LEVELS;t.detail='';
    if(t.terrain==='forest'||(t.terrain==='mountain'&&t.elevation<12/16)||(t.terrain==='rock'&&t.elevation<10/16))t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
    game.revision++;
    return result(true,`${tool==='raise'?'Raised':'Lowered'} to level ${level} · ${moneyText(cost)}`,{cost,level});
  }
  if(tool==='bulldoze') {
    if(station && game.routes.some(r=>r.stops.includes(station.id))) return result(false,'Retire routes using this station before removing it.');
    if(city) return result(false,'A city center cannot be demolished.');
    if(!station&&!industry&&!site&&!t.zone&&!t.road&&!t.rail&&t.terrain!=='forest'&&t.terrain!=='rock'&&!hasClearableDecoration(t)) return result(false,'There is nothing to demolish here.');
    const cost=constructionCost(game,tool,x,y);
    if(game.money<cost) return result(false,'Not enough funds to demolish this tile.');
    spend(game,cost);
    if(nature&&['forest','rock'].includes(nature.object.kind)){
      const points=terrainObjectTiles(nature);releaseTerrainObjects(game,points);
      for(const p of points){const cell=tileAt(game,p.x,p.y);cell.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';cell.detail='';}
    }else releaseTerrainObjects(game,[point]);
    const residents=housingCapacity(site?.building),town=residents?(owns(site.building,'populationCityId')?game.cities.find(city=>city.id===site.building.populationCityId):closestCity(game,site,10)):null;
    if(town){town.population=Math.max(0,town.population-residents);town.passengers=Math.min(town.passengers,town.population*.9);}
    if(station) game.stations=game.stations.filter(s=>s.id!==station.id);
    if(industry){
      game.industries=game.industries.filter(i=>i.id!==industry.id);
      for(const point of industryTiles(industry)){const cell=tileAt(game,point.x,point.y);cell.detail='';if(['forest','rock'].includes(cell.terrain))cell.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';}
    }
    if(site){
      for(const p of buildingTiles(site)){const cell=tileAt(game,p.x,p.y);cell.building=null;cell.zone=null;cell.detail='';}
      const span=buildingSize(site.building);game.zones=game.zones.filter(z=>z.x<site.x||z.y<site.y||z.x>=site.x+span||z.y>=site.y+span);
    }
    game.zones=game.zones.filter(z=>z.x!==x||z.y!==y);
    const changedNetwork=t.road||t.rail||Boolean(station);
    t.road=false;t.rail=false;t.bridge=false;t.tunnel=false;t.building=null;t.zone=null;if(t.terrain!=='water')t.detail='';delete t.publicRoad;delete t.structureLevel;delete t.structureAxis;
    if(['forest','rock'].includes(t.terrain)) t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
    if(changedNetwork)invalidateNetwork(game,[point]);else game.revision++;
    return result(true,`Cleared ${site?'building site':industry?'industry site':nature?'terrain parcel':'tile'} · ${moneyText(cost)}`,{cost});
  }
  if(NETWORK_TOOLS.includes(tool)) {
    const mode=tool.startsWith('rail')?'rail':'road';
    const bridge=tool==='bridge'||tool==='railbridge',tunnel=tool==='tunnel'||tool==='railtunnel';
    if(t[mode] && (!bridge||t.bridge) && (!tunnel||t.tunnel)) return result(true,'Already built.',{cost:0,unchanged:true});
    if(t.structureAxis)return result(false,'Each elevated span carries one transport mode. Build another span alongside it.');
    if(industry||site||t.zone) return result(false,'Clear the building or zone before building a connection.');
    if(station&&station.mode!==mode) return result(false,'Cannot cross another transport mode at a station.');
    if(t.terrain==='water'&&!bridge&&!t.bridge) return result(false,`Water needs a ${mode==='rail'?'rail ':''}bridge.`);
    if(t.terrain==='mountain'&&!tunnel&&!t.tunnel) return result(false,`Mountains need a ${mode==='rail'?'rail ':''}tunnel.`);
    if(bridge&&t.terrain!=='water') return result(false,'Place bridges on water; connect the banks with ordinary track or road.');
    if(tunnel&&t.terrain!=='mountain'&&t.terrain!=='rock') return result(false,'Tunnels must cross mountains or rock.');
    if(!bridge&&!tunnel){const problem=networkTerrainProblem(game,x,y,mode);if(problem)return result(false,problem);}
    const cost=constructionCost(game,tool,x,y);
    if(game.money<cost) return result(false,`Need ${moneyText(cost)} for this connection.`);
    releaseTerrainObjects(game,[point]);
    spend(game,cost);t[mode]=true;if(bridge)t.bridge=true;if(tunnel)t.tunnel=true;
    if(t.terrain==='forest'){t.terrain=game.biome==='tundra'?'snow':game.biome==='desert'?'sand':'grass';t.detail='';}
    invalidateNetwork(game,[point]);
    return result(true,`${mode==='rail'?'Rail':'Road'} ${bridge?'bridge':tunnel?'tunnel':'built'} · ${moneyText(cost)}`,{cost});
  }
  if(tool==='bus-stop'||tool==='train-stop'||tool==='port') {
    const mode=tool==='port'?'water':tool==='bus-stop'?'road':'rail';
    if(station) return result(false,'There is already a station here.');
    if(mode==='water'){
      if(t.terrain!=='water')return result(false,'Place a port on water directly beside land.');
      if(industry||site||t.zone||t.road||t.rail||t.bridge||t.tunnel||city)return result(false,'Ports need empty shoreline water, away from bridges.');
      if(!DIRECTIONS.some(([dx,dy])=>{const shore=tileAt(game,x+dx,y+dy);return shore&&shore.terrain!=='water';}))return result(false,'Place a port directly beside the shore.');
    }else{
      if(industry||site||t.zone) return result(false,'Choose an unoccupied road or rail tile.');
      if(!validNetwork(t,mode)) return result(false,`Build a ${mode==='road'?'road':'railway'} here first.`);
      if(t.bridge||t.tunnel) return result(false,'Stations need open ground beside the connection.');
    }
    const cost=constructionCost(game,tool,x,y);if(game.money<cost)return result(false,`Need ${moneyText(cost)} for this station.`);
    const nearIndustry=game.industries.find(i=>industryDistance(i,point)<=STATION_RADIUS),nearCity=closestCity(game,point,STATION_RADIUS);
    const name=`${nearCity?.name||nearIndustry?.name||(mode==='water'?'Coastal':'Rural')} ${mode==='water'?'Port':mode==='road'?'Stop':'Station'} ${game.stations.length+1}`;
    const newStation={id:makeId(game,'station'),name,x,y,mode};
    spend(game,cost);game.stations.push(newStation);invalidateNetwork(game,[point]);
    return result(true,`${name} opened · ${moneyText(cost)}`,{cost,station:newStation});
  }
  if(station||industry||site||t.zone||t.road||t.rail||city) return result(false,'Choose an empty tile or clear this one first.');
  if(t.terrain==='water'||(t.terrain==='mountain'&&!INDUSTRIES[tool]?.terrain?.includes('mountain'))) return result(false,'This structure needs buildable land.');
  const cost=constructionCost(game,tool,x,y);if(game.money<cost)return result(false,`Need ${moneyText(cost)} for this construction.`);
  if(ZONE_TYPES.includes(tool)) {
    releaseTerrainObjects(game,[point]);
    spend(game,cost);t.zone=tool;t.detail='';
    if(t.terrain==='forest'||t.terrain==='rock')t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
    game.zones.push({x,y,kind:tool,progress:0});game.revision++;
    return result(true,`${tool[0].toUpperCase()+tool.slice(1)} zone designated · ${moneyText(cost)}`,{cost});
  }
  if(tool==='city') {
    const terrainProblem=networkTerrainProblem(game,x,y,'road');if(terrainProblem)return result(false,terrainProblem);
    if(game.cities.some(c=>distance(c,point)<11))return result(false,'Found a new city at least 11 tiles from another center.');
    if(['mountain','rock'].includes(t.terrain))return result(false,'A new city needs level land.');
    // Preserve the town credited for existing housing before a new center can
    // become nearer, including legacy buildings that predate explicit owners.
    rememberHousingOwners(game);
    const prefixes=game.biome==='taiga'?['Birch','Willow','Silver','Fern','Maple']:game.biome==='tundra'?['Ice','Frost','North','Winter','Snow']:['Amber','Gold','Dune','Palm','Sun'];
    const suffixes=['field','haven','ford','creek','ridge'];
    const n=Math.max(0,game.cities.length-4);
    const newCity={id:makeId(game,'city'),name:prefixes[n%prefixes.length]+suffixes[Math.floor(n/prefixes.length)%suffixes.length],x,y,population:80,activity:0,growth:0,passengers:12,delivered:0,supplies:0,lastServiceDay:null};
    releaseTerrainObjects(game,[point]);
    spend(game,cost);game.cities.push(newCity);t.road=true;t.detail='';t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';invalidateNetwork(game,[point]);
    notify(game,`${newCity.name} founded. Add housing and connect a passenger service.`,'success');
    return result(true,`${newCity.name} founded · ${moneyText(cost)}`,{cost,city:newCity});
  }
  if(owns(BUILDINGS,tool)) {
    const def=BUILDINGS[tool],nearCity=closestCity(game,point,10);
    const size=buildingFootprint(tool),problem=buildingSiteProblem(game,tool,x,y,size);if(problem)return result(false,problem);
    const placed=placeBuildingSite(game,tool,x,y,{size,building:{level:1,...def.residents?{populationCityId:nearCity?.id??null}:{}}});
    spend(game,cost);
    if(nearCity&&def.residents)nearCity.population+=def.residents;
    game.revision++;
    return result(true,`${def.name} constructed · ${size} × ${size} site · ${moneyText(cost)}`,{cost,building:placed.building});
  }
  const def=INDUSTRIES[tool];
  const siteProblem=industrySiteProblem(game,tool,x,y);if(siteProblem)return result(false,siteProblem);
  if(!def.biomes.includes(game.biome))return result(false,`${def.name} is unavailable in ${BIOMES[game.biome].name}.`);
  if(def.terrain&&!def.terrain.includes(t.terrain))return result(false,`${def.name} needs ${def.terrain.join(', ')} terrain.`);
  const inventory=Object.fromEntries([...Object.keys(def.inputs),...Object.keys(def.outputs)].map(cargo=>[cargo,0]));
  const size=industryFootprint(tool),newIndustry={id:makeId(game,'industry'),kind:tool,name:def.name,x,y,footprint:size,capacity:1,inventory,production:0,totalProduced:0,activity:0,shipped:0,received:0,idleDays:0,owner:'player'};
  initializeIndustry(game,newIndustry);
  releaseTerrainObjects(game,industryTiles(newIndustry));
  spend(game,cost);game.industries.push(newIndustry);game.revision++;
  return result(true,`${def.name} constructed · ${size} × ${size} site · ${moneyText(cost)}`,{cost,industry:newIndustry});
}

export function buildPath(game,tool,points) {
  if(!Array.isArray(points)||!points.length)return result(false,'Choose a construction path.');
  if(tool==='level')return buildTerraformLevel(game,points);
  if(tool==='raise'||tool==='lower')return buildTerraformStroke(game,tool,points);
  const unique=new Map();
  for(const point of points)if(point&&Number.isInteger(point.x)&&Number.isInteger(point.y)){
    const nature=tool==='bulldoze'?terrainObjectAt(game,point.x,point.y):null;
    const site=tool==='bulldoze'?(buildingAt(game,point.x,point.y)||industryAt(game,point.x,point.y)||(nature&&nature.object.kind!=='mountain'?nature:null)):null;
    const target=site?{x:site.x,y:site.y}:point;unique.set(`${target.x},${target.y}`,target);
  }
  if(tool==='road'||tool==='rail'){const problem=networkTerrainPlanProblem(game,[...unique.values()].map(p=>({...p,tool})));if(problem)return result(false,problem,{cost:0,built:0,failed:unique.size,skipped:0});}
  let count=0,cost=0,skipped=0;const errors=new Map();
  for(const {x,y} of unique.values()) {
    const built=build(game,tool,x,y);
    if(built.ok) {if(built.unchanged)skipped++;else count++;cost+=built.cost||0;}
    else errors.set(built.message,(errors.get(built.message)||0)+1);
  }
  const failures=[...errors.values()].reduce((a,b)=>a+b,0);
  const errorText=[...errors].slice(0,2).map(([message,n])=>`${n}× ${message}`).join(' ');
  const message=count?`Built ${count} tile${count===1?'':'s'} · ${moneyText(cost)}${failures?` · ${failures} skipped. ${errorText}`:''}`:errors.size?errorText:skipped?'Already built.':'Choose valid tiles.';
  return result(count>0||skipped>0,message,{cost,built:count,failed:failures,skipped});
}

function freightPair(game,a,b,cargo) {
  const source=stationCoverage(game,a),destination=stationCoverage(game,b);
  const producers=source.industries.filter(i=>INDUSTRIES[i.kind].outputs[cargo]);
  const consumers=destination.industries.filter(i=>INDUSTRIES[i.kind].inputs[cargo]);
  return producers.length>0&&(consumers.some(c=>producers.every(p=>p.id!==c.id))||(TOWN_CARGO.includes(cargo)&&destination.cities.length>0));
}
const vehicleLevel = vehicle => vehicle.level??0;
const vehicleSpeedMultiplier = level => 1+level*.1;
const vehicleCapacity = (mode,level) => Math.round(VEHICLE_CAPACITIES[mode]*(1+level*.2));
const fleetIndexCache=new WeakMap();
function fleetIndex(game){
  let cache=fleetIndexCache.get(game);
  if(cache&&cache.revision===game.revision&&cache.routes===game.routes&&cache.vehicles===game.vehicles&&cache.stations===game.stations&&cache.routeCount===game.routes.length&&cache.vehicleCount===game.vehicles.length&&cache.stationCount===game.stations.length)return cache;
  const routeById=new Map(game.routes.map(route=>[route.id,route])),vehiclesByRoute=new Map(),stationById=new Map(game.stations.map(station=>[station.id,station]));
  for(const vehicle of game.vehicles){if(!vehiclesByRoute.has(vehicle.routeId))vehiclesByRoute.set(vehicle.routeId,[]);vehiclesByRoute.get(vehicle.routeId).push(vehicle);}
  cache={revision:game.revision,routes:game.routes,vehicles:game.vehicles,stations:game.stations,routeCount:game.routes.length,vehicleCount:game.vehicles.length,stationCount:game.stations.length,routeById,vehiclesByRoute,stationById};fleetIndexCache.set(game,cache);return cache;
}

export function getVehiclePurchase(game,mode) {
  if(!TRANSPORT_MODES.includes(mode))return null;
  const level=availableVehicleLevel(game);
  return {level,cost:priceFor(game,VEHICLE_COSTS[mode]*(1+.4*level)),capacity:vehicleCapacity(mode,level),speedMultiplier:vehicleSpeedMultiplier(level)};
}

export function getVehicleUpgrade(game,routeId) {
  const index=fleetIndex(game),route=index.routeById.get(routeId),vehicles=route?index.vehiclesByRoute.get(routeId)||[]:[],targetLevel=availableVehicleLevel(game);
  const level=vehicles.length?Math.min(...vehicles.map(vehicleLevel)):0;
  const eligible=vehicles.filter(v=>vehicleLevel(v)<targetLevel);
  const cost=route?eligible.reduce((sum,v)=>sum+priceFor(game,VEHICLE_COSTS[route.mode]*.4*(targetLevel-vehicleLevel(v))),0):0;
  return {routeId,available:eligible.length>0,affordable:game.money>=cost,level,targetLevel,cost,capacity:vehicles.reduce((sum,v)=>sum+v.capacity,0),nextCapacity:vehicles.reduce((sum,v)=>sum+Math.max(v.capacity,vehicleCapacity(route.mode,Math.max(vehicleLevel(v),targetLevel))),0),speedMultiplier:vehicleSpeedMultiplier(level),nextSpeedMultiplier:vehicleSpeedMultiplier(Math.max(level,targetLevel)),vehicleCount:eligible.length};
}

export function getFleetUpgrade(game) {
  const routes=game.routes.map(route=>getVehicleUpgrade(game,route.id)).filter(upgrade=>upgrade.available);
  const cost=routes.reduce((sum,upgrade)=>sum+upgrade.cost,0),count=routes.reduce((sum,upgrade)=>sum+upgrade.vehicleCount,0);
  return {available:count>0,affordable:game.money>=cost,cost,count,vehicleCount:count,routeCount:routes.length,targetLevel:availableVehicleLevel(game),routes};
}

function applyVehicleUpgrade(game,route,targetLevel) {
  for(const vehicle of fleetIndex(game).vehiclesByRoute.get(route.id)||[]){
    if(vehicleLevel(vehicle)>=targetLevel)continue;
    const cost=priceFor(game,VEHICLE_COSTS[route.mode]*.4*(targetLevel-vehicleLevel(vehicle)));
    vehicle.paidPrice=(vehicle.paidPrice??VEHICLE_COSTS[route.mode])+cost;
    vehicle.level=targetLevel;
    vehicle.capacity=Math.max(vehicle.capacity,vehicleCapacity(route.mode,targetLevel));
  }
}

export function upgradeRouteVehicle(game,routeId) {
  const route=game.routes.find(r=>r.id===routeId);if(!route)return result(false,'Route not found.');
  const quote=getVehicleUpgrade(game,routeId);
  if(!quote.available)return result(false,'This service already has the newest vehicle generation.');
  if(!quote.affordable)return result(false,`Need ${moneyText(quote.cost)} to upgrade this service.`);
  spend(game,quote.cost);applyVehicleUpgrade(game,route,quote.targetLevel);game.revision++;
  return result(true,`${route.name} upgraded to generation ${quote.targetLevel+1} · ${moneyText(quote.cost)}`,{cost:quote.cost,upgrade:quote});
}

export function upgradeFleet(game) {
  const quote=getFleetUpgrade(game);
  if(!quote.available)return result(false,'Your fleet already has the newest vehicle generation.');
  if(!quote.affordable)return result(false,`Need ${moneyText(quote.cost)} to upgrade the whole fleet.`);
  // Preflight the whole price, then change all vehicles in one transaction.
  spend(game,quote.cost);
  for(const upgrade of quote.routes)applyVehicleUpgrade(game,fleetIndex(game).routeById.get(upgrade.routeId),quote.targetLevel);
  game.revision++;
  return result(true,`${quote.count} vehicle${quote.count===1?'':'s'} upgraded to generation ${quote.targetLevel+1} · ${moneyText(quote.cost)}`,{cost:quote.cost,upgrade:quote});
}

export function addRoute(game,{name,mode='road',stops,cargo='passengers'}={}) {
  if(!TRANSPORT_MODES.includes(mode)||!owns(CARGO,cargo))return result(false,'Choose a valid transport mode and cargo.');
  if(!Array.isArray(stops)||stops.length!==2||stops[0]===stops[1])return result(false,'Choose two different stations.');
  let stations=stops.map(id=>game.stations.find(s=>s.id===id));
  if(stations.some(s=>!s||s.mode!==mode))return result(false,mode==='water'?'Choose two ports for a ship route.':`Both stations must serve ${mode==='road'?'roads':'railways'}.`);
  if(cargo==='passengers') {
    if(!passengerEndpoints(game,...stations))return result(false,'Passenger stations must serve two different cities within 5 tiles.');
  } else if(!freightPair(game,stations[0],stations[1],cargo)) {
    if(freightPair(game,stations[1],stations[0],cargo))stations.reverse();
    else return result(false,`Stations need a ${CARGO[cargo].name.toLowerCase()} producer and a matching factory or town within 5 tiles.`);
  }
  const path=findPath(game,stations[0],stations[1],mode);
  if(!path)return result(false,mode==='water'?'Ports must share connected water. Choose ports on the same river, lake or sea.':`Connect both stations with continuous ${mode==='road'?'roads':'rails'}, including bridges and tunnels.`);
  if(path.length<3)return result(false,'Stations are too close for a transport service.');
  const purchase=getVehiclePurchase(game,mode),cost=purchase.cost;if(game.money<cost)return result(false,`Need ${moneyText(cost)} to buy this ${mode==='water'?'ship':mode==='rail'?'train':cargo==='passengers'?'bus':'truck'}.`);
  const palette=['#efc16f','#69c6bc','#d893b1','#88aee4','#b3cf83','#e5966d'];
  const route={id:makeId(game,'route'),name:String(name||`${stations[0].name} → ${stations[1].name}`).slice(0,100),mode,stops:stations.map(s=>s.id),cargo,delivered:0,revenue:0,expenses:0,accountingStartDay:game.day,revenueAtAccountingStart:0,color:palette[game.routes.length%palette.length],path,active:true,status:'Running',pathRevision:game.networkRevision||0};
  const vehicle={id:makeId(game,'vehicle'),routeId:route.id,x:path[0].x,y:path[0].y,angle:0,load:0,capacity:purchase.capacity,level:purchase.level,paidPrice:cost,progress:0,direction:1,totalDistance:0,dwellRemaining:0,tripSerial:0};
  spend(game,cost);game.routes.push(route);game.vehicles.push(vehicle);loadVehicle(game,route,vehicle,0);game.revision++;
  return result(true,`${route.name} launched · ${moneyText(cost)}`,{route,cost});
}
export function removeRoute(game,routeId) {
  const route=game.routes.find(r=>r.id===routeId);if(!route)return result(false,'Route not found.');
  const refund=game.vehicles.filter(v=>v.routeId===routeId).reduce((sum,v)=>sum+Math.round((v.paidPrice??VEHICLE_COSTS[route.mode])*.45),0);
  game.routes=game.routes.filter(r=>r.id!==routeId);game.vehicles=game.vehicles.filter(v=>v.routeId!==routeId);game.money+=refund;game.revision++;
  return result(true,`Service retired. Vehicle sale returned ${moneyText(refund)}.`,{refund});
}
function journeyContext(game) {
  return { stations:fleetIndex(game).stationById, coverage:new Map(), endpoints:new Map(), environments:new Map() };
}
function journeyEndpoints(game,route,context) {
  if(!context)return passengerEndpoints(game,...route.stops.map(id=>game.stations.find(stop=>stop.id===id)));
  const key=JSON.stringify(route.stops);
  if(!context.endpoints.has(key))context.endpoints.set(key,passengerEndpoints(game,...route.stops.map(id=>context.stations.get(id))));
  return context.endpoints.get(key);
}
function journeyCoverage(game,station,context) {
  if(!context)return stationCoverage(game,station);
  if(!context.coverage.has(station))context.coverage.set(station,stationCoverage(game,station));
  return context.coverage.get(station);
}
function loadVehicle(game,route,vehicle,stopIndex,context) {
  const station=context?context.stations.get(route.stops[stopIndex]):game.stations.find(s=>s.id===route.stops[stopIndex]);if(!station)return;
  let free=vehicle.capacity-vehicle.load;
  if(route.cargo==='passengers') {
    const endpoints=journeyEndpoints(game,route,context);
    for(const city of endpoints?[endpoints[stopIndex]]:[]) {
      const amount=Math.min(free,Math.floor(city.passengers||0));
      city.passengers-=amount;vehicle.load+=amount;free-=amount;city.activity+=amount*.18;
      if(free<=0)break;
    }
  } else if(stopIndex===0) {
    const coverage=journeyCoverage(game,station,context);
    for(const industry of coverage.industries) {
      if(!INDUSTRIES[industry.kind].outputs[route.cargo])continue;
      const amount=Math.min(free,Math.floor(industry.inventory[route.cargo]||0));
      industry.inventory[route.cargo]-=amount;industry.shipped+=amount;industry.activity+=amount;vehicle.load+=amount;free-=amount;
      if(free<=0)break;
    }
  }
}
function unloadVehicle(game,route,vehicle,stopIndex,arrivalDay=game.day,context) {
  if(vehicle.load<=0)return;
  const station=context?context.stations.get(route.stops[stopIndex]):game.stations.find(s=>s.id===route.stops[stopIndex]);if(!station)return;
  let remaining=vehicle.load,delivered=0;
  if(route.cargo==='passengers') {
    const endpoints=journeyEndpoints(game,route,context);if(!endpoints)return;
    const city=endpoints[stopIndex];city.activity+=remaining;city.delivered+=remaining;city.lastServiceDay=arrivalDay;delivered=remaining;remaining=0;
  } else if(stopIndex===1) {
    const coverage=journeyCoverage(game,station,context);
    for(const industry of coverage.industries) {
      if(!INDUSTRIES[industry.kind].inputs[route.cargo])continue;
      const available=Math.max(0,MAX_INVENTORY*industry.capacity-(industry.inventory[route.cargo]||0));
      const amount=Math.min(remaining,available);
      industry.inventory[route.cargo]=(industry.inventory[route.cargo]||0)+amount;
      industry.received+=amount;industry.activity+=amount;remaining-=amount;delivered+=amount;
      if(remaining<=0)break;
    }
    if(remaining>0&&TOWN_CARGO.includes(route.cargo)&&coverage.cities.length) {
      const city=coverage.cities[0];city.supplies+=remaining;city.activity+=remaining*.7;city.delivered+=remaining;city.lastServiceDay=arrivalDay;delivered+=remaining;remaining=0;
    }
  }
  vehicle.load=remaining;
  if(delivered>0) {
    // Shortest connected distance determines the fare; loops cannot manufacture income.
    const revenue=priceFor(game,delivered*CARGO[route.cargo].price*(1+Math.sqrt(route.path.length-1)*.55),arrivalDay);
    route.delivered+=delivered;route.revenue+=revenue;game.totalDelivered+=delivered;game.totalRevenue+=revenue;game.monthlyIncome+=revenue;game.money+=revenue;
  }
}
function updateRoutePath(game,route) {
  const networkRevision=game.networkRevision||0;
  if(route.pathRevision===networkRevision)return;
  const [a,b]=route.stops.map(id=>fleetIndex(game).stationById.get(id));
  const path=a&&b?findPath(game,a,b,route.mode):null;
  const wasActive=route.active;
  route.active=Boolean(path);route.pathRevision=networkRevision;
  if(!path) {route.status='Disconnected';if(wasActive)notify(game,route.mode==='water'?`${route.name} has lost its water connection. Ports need a continuous waterway.`:`${route.name} has lost its connection. Repair the network to resume.`,'warning');return;}
  route.status='Running';
  const changed=route.path.length!==path.length||route.path.some((p,i)=>p.x!==path[i].x||p.y!==path[i].y);
  if(changed) {
    for(const vehicle of fleetIndex(game).vehiclesByRoute.get(route.id)||[]) {
      let nearest=0,best=Infinity;
      for(let i=0;i<path.length;i++) {const d=distance(vehicle,path[i]);if(d<best){best=d;nearest=i;}}
      vehicle.progress=nearest;vehicle.x=path[nearest].x;vehicle.y=path[nearest].y;
    }
  }
  route.path=path;
}
export function refreshRouteConnections(game) { for(const route of game.routes)updateRoutePath(game,route); }
const movementCache=new WeakMap();
function waterTraffic(game, point, cache) {
  if (!cache.waterRoutes) {
    cache.waterRoutes = new Map(); cache.waterTraffic = new Map();
    for (const route of game.routes) if (route.mode === 'water' && route.active) for (const stop of route.stops) {
      if (!cache.waterRoutes.has(stop)) cache.waterRoutes.set(stop, []);
      cache.waterRoutes.get(stop).push(route);
    }
  }
  const key = point.y * game.width + point.x;
  if (cache.waterTraffic.has(key)) return cache.waterTraffic.get(key);
  const routes = new Set();
  for (const station of nearbyStations(game,point.x,point.y,4)) if (station.mode === 'water' && distance(station,point) <= 4) {
    for (const route of cache.waterRoutes.get(station.id) || []) routes.add(route);
  }
  cache.waterTraffic.set(key,routes.size);
  return routes.size;
}
function travelSpeed(game,route,vehicle,segment){
  const day=Math.floor(game.day);let cache=movementCache.get(game);
  if(!cache||cache.day!==day||cache.revision!==game.revision){cache={day,revision:game.revision,speeds:new Map()};movementCache.set(game,cache);}
  const key=`${vehicle.id}:${segment}`;if(cache.speeds.has(key))return cache.speeds.get(key);
  const a=route.path[segment],b=route.path[segment+1],ta=tileAt(game,a.x,a.y),tb=tileAt(game,b.x,b.y),climate=weatherAt(game,a.x,a.y,day);
  if(route.mode==='water'){
    // Open water is quicker than a shallow channel. Bridges stay navigable,
    // while approaches to busy ports slow ships without frame-based randomness.
    const neighbors=DIRECTIONS.map(([dx,dy])=>tileAt(game,a.x+dx,a.y+dy));
    const channel=.72+neighbors.filter(t=>t?.terrain==='water').length*.07;
    const traffic=waterTraffic(game,a,cache);
    const support=neighbors.filter(t=>t?.road||t?.rail).length*.015;
    const passage=(ta.bridge||tb.bridge)?.88:1;
    const variation=.94+randomAt(game,day,vehicle.id,511)*.12;
    const speed=1.8*channel*passage*climate.travel*(1-climate.cold*.12)*variation*(1-Math.min(.18,Math.max(0,traffic-1)*.035)+Math.min(.045,support))*vehicleSpeedMultiplier(vehicleLevel(vehicle));
    cache.speeds.set(key,speed);return speed;
  }
  let congestion=0,support=0;
  for(const city of nearbyCities(game,a.x,a.y,5)){const d=Math.hypot(city.x-a.x,city.y-a.y);if(d<5)congestion+=Math.min(.15,city.population/10000)*(1-d/6);}
  const supportingSites=new Set();
  for(const [dx,dy]of DIRECTIONS){const site=buildingAt(game,a.x+dx,a.y+dy),kind=site?.building.kind;if((kind==='service-garage'||kind==='police-station')&&!supportingSites.has(site.building)){supportingSites.add(site.building);support+=.035;}}
  const terrain=(ta.bridge||tb.bridge)?.8:(ta.tunnel||tb.tunnel)?.88:1;
  const grade=1-Math.min(.16,Math.abs(transportElevation(ta)-transportElevation(tb))*.4);
  const dailyVariation=.94+randomAt(game,day,vehicle.id,511)*.12;
  const speed=(route.mode==='road'?2.8:4.6)*terrain*grade*climate.travel*dailyVariation*(1-clamp(congestion,0,route.mode==='road'?.22:.06)+Math.min(.07,support))*vehicleSpeedMultiplier(vehicleLevel(vehicle));
  cache.speeds.set(key,speed);return speed;
}
// A trajectory has no economic side effects. Stop at its next arrival so that
// the fleet can commit cargo transfers in time order, even for a large tick.
function travelPlan(game,route,vehicle,days){
  const state={progress:vehicle.progress,totalDistance:vehicle.totalDistance||0,dwellRemaining:vehicle.dwellRemaining||0};
  const max=route.path.length-1,endpoint=vehicle.direction===1?max:0;
  let remaining=days,elapsed=0;
  if(state.dwellRemaining>0){const wait=Math.min(remaining,state.dwellRemaining);state.dwellRemaining=Math.max(0,state.dwellRemaining-wait);remaining-=wait;elapsed+=wait;}
  while(remaining>1e-10&&Math.abs(state.progress-endpoint)>1e-9){
    const segment=clamp(vehicle.direction===1?Math.floor(state.progress+1e-9):Math.ceil(state.progress-1e-9)-1,0,max-1);
    const speed=travelSpeed(game,route,vehicle,segment),boundary=vehicle.direction===1?segment+1:segment,space=Math.abs(boundary-state.progress),duration=space/speed;
    if(remaining+1e-12>=duration){state.progress=boundary;state.totalDistance+=space;remaining=Math.max(0,remaining-duration);elapsed+=duration;}
    else{const step=remaining*speed;state.progress+=step*vehicle.direction;state.totalDistance+=step;elapsed+=remaining;remaining=0;}
  }
  const arrived=state.dwellRemaining<=0&&Math.abs(state.progress-endpoint)<1e-9;
  if(arrived)state.progress=endpoint;
  return {state,elapsed:arrived?elapsed:days,arrived};
}
function arriveVehicle(game,route,vehicle,arrivalDay,context){
  const stopIndex=vehicle.direction===1?1:0;
  unloadVehicle(game,route,vehicle,stopIndex,arrivalDay,context);loadVehicle(game,route,vehicle,stopIndex,context);vehicle.direction*=-1;vehicle.tripSerial=(vehicle.tripSerial||0)+1;
  const stop=context?context.stations.get(route.stops[stopIndex]):game.stations.find(s=>s.id===route.stops[stopIndex]);
  let e=context?.environments.get(stop);
  if(!e){e=localEnvironment(game,stop.x,stop.y,2);context?.environments.set(stop,e);}
  vehicle.dwellRemaining=(.05+randomAt(game,Math.floor(arrivalDay),vehicle.id,500+vehicle.tripSerial)*.13)*(route.mode==='water'?1.8:1)*(1+vehicle.load/vehicle.capacity*.5)/(1+e.access*.35+e.services*.06);
}
function moveVehicles(game,days) {
  for(const route of game.routes)updateRoutePath(game,route);
  const routeIndex=fleetIndex(game).routeById;
  const fleet=game.vehicles.map(vehicle=>({vehicle,route:routeIndex.get(vehicle.routeId)})).filter(({route})=>route?.active&&route.path.length>1);
  // Trajectories do not interact until a stop transfers cargo. A chronological
  // arrival heap advances only the arriving vehicle, instead of replanning the
  // entire fleet after every arrival (quadratic for thousands of vehicles).
  const events=[],context=journeyContext(game);
  const earlier=(a,b)=>a.time<b.time||a.time===b.time&&a.order<b.order;
  const push=event=>{let i=events.length;events.push(event);while(i){const p=(i-1)>>>1;if(!earlier(event,events[p]))break;events[i]=events[p];i=p;}events[i]=event;};
  const pop=()=>{const first=events[0],last=events.pop();if(events.length){let i=0;while(i*2+1<events.length){let child=i*2+1;if(child+1<events.length&&earlier(events[child+1],events[child]))child++;if(!earlier(events[child],last))break;events[i]=events[child];i=child;}events[i]=last;}return first;};
  const schedule=(item,order,elapsed)=>{
    const plan=travelPlan(game,item.route,item.vehicle,Math.max(0,days-elapsed));
    if(plan.arrived)push({item,order,plan,time:elapsed+plan.elapsed});
    else item.finalState=plan.state;
  };
  if(days>1e-10)fleet.forEach((item,order)=>schedule(item,order,0));
  while(events.length){
    const {item,order,plan,time}=pop(),{vehicle,route}=item;
    Object.assign(vehicle,plan.state);
    arriveVehicle(game,route,vehicle,Math.min(game.day+days,game.day+time),context);
    if(days-time>1e-10)schedule(item,order,time);
  }
  for(const item of fleet)if(item.finalState)Object.assign(item.vehicle,item.finalState);
  for(const {vehicle,route}of fleet){
    const max=route.path.length-1,index=Math.min(Math.floor(vehicle.progress),max-1),fraction=vehicle.progress-index,a=route.path[index],b=route.path[index+1];
    vehicle.x=a.x+(b.x-a.x)*fraction;vehicle.y=a.y+(b.y-a.y)*fraction;vehicle.angle=Math.atan2((b.y-a.y)*vehicle.direction,(b.x-a.x)*vehicle.direction);
  }
}
const upkeepShareCache=new WeakMap();
function infrastructureShares(game){
  const revision=game.networkRevision||0,previous=upkeepShareCache.get(game);
  if(previous&&previous.revision===revision&&previous.routes===game.routes&&previous.count===game.routes.length)return previous.shares;
  const users=new Map(),shares=new Map(game.routes.map(route=>[route.id,0]));
  const add=(key,cost,route)=>{if(!cost)return;let entry=users.get(key);if(!entry){entry={cost,routes:new Set()};users.set(key,entry);}entry.routes.add(route.id);};
  for(const route of game.routes){
    if(route.mode!=='water')for(const point of route.path){
      const tile=tileAt(game,point.x,point.y),key=point.y*game.width+point.x;if(!tile?.[route.mode])continue;
      add(`${key}:${route.mode}`,route.mode==='rail'?.14:tile.publicRoad?0:.075,route);
      if(tile.bridge||tile.tunnel)add(`${key}:structure`,.2,route);
    }
    for(const id of route.stops){const station=fleetIndex(game).stationById.get(id);if(station)add(`station:${id}`,station.mode==='water'?6:station.mode==='road'?1.2:4,route);}
  }
  for(const {cost,routes}of users.values())for(const id of routes)shares.set(id,shares.get(id)+cost/routes.size);
  upkeepShareCache.set(game,{revision,routes:game.routes,count:game.routes.length,shares});return shares;
}
function maintenance(game) {
  if(game.maintenanceRevision!==(game.networkRevision||0)) {
    let upkeep=0;
    for(const id of networkIndex(game)){const t=game.tiles[id];upkeep+=(t.road&&!t.publicRoad?.075:0)+(t.rail?.14:0)+((t.bridge||t.tunnel)?.2:0);}
    upkeep+=game.stations.reduce((sum,s)=>sum+(s.mode==='water'?6:s.mode==='road'?1.2:4),0);
    game.infrastructureUpkeep=upkeep;game.maintenanceRevision=game.networkRevision||0;
  }
  const day=Math.floor(game.day),center=game.cities[0]||{x:game.width/2,y:game.height/2},weather=weatherAt(game,center.x,center.y,day);
  const routeCosts=new Map(game.routes.map(route=>[route.id,0])),routeIndex=fleetIndex(game).routeById,environments=new Map();
  const fleet=game.vehicles.reduce((sum,v)=>{
    const route=routeIndex.get(v.routeId),localWeather=weatherAt(game,v.x,v.y,day),key=Math.floor(v.y)*game.width+Math.floor(v.x);
    let e=environments.get(key);if(!e){e=localEnvironment(game,v.x,v.y,2);environments.set(key,e);}
    const support=1-Math.min(.12,e.police*.025+e.services*.015);
    const expense=(route?.mode==='water'?70:route?.mode==='rail'?90:22)*(route?.active?1:.45)*(.91+randomAt(game,day,v.id,521)*.18)*(1+localWeather.cold*(route?.mode==='water'?.23:.14)+localWeather.heat*.08)*support;
    if(route)routeCosts.set(route.id,routeCosts.get(route.id)+expense);
    return sum+expense;
  },0);
  const facilities=game.industries.reduce((sum,i)=>{
    if(i.owner!=='player')return sum;
    const localWeather=weatherAt(game,i.x,i.y,day),e=localEnvironment(game,i.x,i.y,3,industrySize(i)),support=1-Math.min(.15,e.fire*.035+e.services*.015);
    return sum+INDUSTRIES[i.kind].cost*.00008*(.9+randomAt(game,day,i.id,522)*.2)*(1+localWeather.cold*.2+localWeather.heat*.12)*support;
  },0);
  const infrastructureFactor=(1+weather.wetness*.16+weather.cold*.18)*(.94+randomAt(game,day,'infrastructure',523)*.12);
  const infrastructure=(game.infrastructureUpkeep||0)*infrastructureFactor,rawTotal=infrastructure+fleet+facilities;
  const expenses=priceFor(game,rawTotal),shares=infrastructureShares(game);
  for(const route of game.routes){
    // Allocate the real charge, including inflation, without charging shared
    // tracks twice. Unused infrastructure and factories remain company costs.
    const raw=(routeCosts.get(route.id)||0)+(shares.get(route.id)||0)*infrastructureFactor;
    route.expenses=(route.expenses||0)+(rawTotal>0?Math.floor(expenses*raw/rawTotal):0);
  }
  game.money-=expenses;game.monthlyExpenses+=expenses;game.totalExpenses+=expenses;
  game.monthlyOperatingExpenses=(game.monthlyOperatingExpenses||0)+expenses;
  game.totalOperatingExpenses=(game.totalOperatingExpenses||0)+expenses;
}

function monthlyUpdate(game) {
  game.lastMonthlyProfit=game.monthlyIncome-game.monthlyExpenses;
  game.lastMonthlyOperatingProfit=game.monthlyIncome-(game.monthlyIncomeAtAccountingStart||0)-(game.monthlyOperatingExpenses||0);
  game.history.push({month:game.lastMonth,day:Math.floor(game.day),income:game.monthlyIncome,expenses:game.monthlyExpenses,operatingExpenses:game.monthlyOperatingExpenses||0,operatingProfit:game.lastMonthlyOperatingProfit,profit:game.lastMonthlyProfit,money:game.money,population:game.cities.reduce((sum,c)=>sum+c.population,0),delivered:game.totalDelivered});
  if(game.history.length>36)game.history.shift();
  game.monthlyIncome=0;game.monthlyExpenses=0;game.monthlyOperatingExpenses=0;game.monthlyIncomeAtAccountingStart=0;
  if(game.money<0)notify(game,'Your company is operating on credit. Launch profitable deliveries or sell an underused service.','warning');
}
export function tick(game,days) {
  if(!Number.isFinite(days)||days<=0)return;
  // Split at day boundaries so large and fractional advances share the same economy.
  let remaining=Math.min(days,3650);
  while(remaining>.00000001) {
    const nextDay=Math.floor(game.day+.00000001)+1;
    const step=Math.min(remaining,nextDay-game.day);
    moveVehicles(game,step);game.day+=step;remaining-=step;
    if(game.day+.00000001>=nextDay) {
      game.day=nextDay;stepIndustries(game,notify);stepSettlements(game);stepEcology(game);maintenance(game);game.lastDailyDay=nextDay;
      const month=calendarMonth(game);
      if(month>game.lastMonth){monthlyUpdate(game);game.lastMonth=month;}
    }
  }
}

function finite(value,min=-Infinity,max=Infinity) {return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;}
function validFootprint(site,maximum) {return site.footprint===undefined||Number.isInteger(site.footprint)&&site.footprint>=1&&site.footprint<=maximum;}
function validPoint(game,p) {return p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<game.width&&p.y<game.height;}
export function validateGame(game) {
  if(!game||typeof game!=='object'||game.version!==1||!owns(BIOMES,game.biome)||!((game.width===100&&game.height===72)||Object.values(WORLD_SIZES).some(size=>size.width===game.width&&size.height===game.height)))return false;
  if(game.terrainObjectVersion!==undefined&&game.terrainObjectVersion!==1)return false;
  if(game.siteFootprintVersion!==undefined&&game.siteFootprintVersion!==1)return false;
  if(game.size!==undefined&&(!owns(WORLD_SIZES,game.size)||WORLD_SIZES[game.size].width!==game.width||WORLD_SIZES[game.size].height!==game.height))return false;
  if(game.generationVersion!==undefined&&(!supportsGenerationVersion(game.generationVersion)||!owns(NEW_WORLD_SIZES,game.size)))return false;
  if(!validGenerationOptions(game.size,game.generationOptions)||(game.generationOptions&&!(game.generationVersion>=7)))return false;
  if(!Array.isArray(game.tiles)||game.tiles.length!==game.width*game.height||!finite(game.money,-1e12,1e12)||!finite(game.day,0,1e8)||!Number.isInteger(game.nextId)||game.nextId<0)return false;
  if(game.networkRevision!==undefined&&(!Number.isInteger(game.networkRevision)||!finite(game.networkRevision,0,1e15)))return false;
  if(!Number.isInteger(game.seed)||!finite(game.seed,0,4294967295)||!Number.isInteger(game.revision)||!finite(game.lastMonthlyProfit))return false;
  for(const key of ['cities','industries','stations','routes','vehicles','zones','history','notifications'])if(!Array.isArray(game[key])||game[key].length>10000)return false;
  for(const key of ['totalDelivered','totalRevenue','monthlyIncome','monthlyExpenses','totalExpenses','revision','lastDailyDay','lastMonth'])if(!finite(game[key],0,1e15))return false;
  for(const key of ['monthlyOperatingExpenses','totalOperatingExpenses','monthlyIncomeAtAccountingStart'])if(game[key]!==undefined&&!finite(game[key],0,1e15))return false;
  if(game.accountingStartDay!==undefined&&!finite(game.accountingStartDay,0,game.day))return false;
  if(game.monthlyIncomeAtAccountingStart!==undefined&&game.monthlyIncomeAtAccountingStart>game.monthlyIncome)return false;
  if(game.lastMonthlyOperatingProfit!==undefined&&!finite(game.lastMonthlyOperatingProfit))return false;
  const ids=new Set();
  const uniqueId=obj=>{if(typeof obj?.id!=='string'||ids.has(obj.id))return false;ids.add(obj.id);return true;};
  if(!game.tiles.every(t=>t&&TERRAIN.has(t.terrain)&&finite(t.elevation)&&(t.detail===undefined||(typeof t.detail==='string'&&t.detail.length<80))&&(t.publicRoad===undefined||typeof t.publicRoad==='boolean')&&Number.isInteger(t.variant)&&['road','rail','bridge','tunnel'].every(k=>typeof t[k]==='boolean')&&(t.zone===null||ZONE_TYPES.includes(t.zone))&&(t.building===null||(t.building&&(owns(BUILDINGS,t.building.kind)||['house','apartment','shop','office','factory'].includes(t.building.kind))&&finite(t.building.level,1,3)&&validFootprint(t.building,buildingFootprint(t.building.kind))))))return false;
  if(!game.tiles.every((tile,index)=>validStructureMetadata(tile,game,index%game.width,Math.floor(index/game.width))))return false;
  if(!game.cities.every(c=>validPoint(game,c)&&uniqueId(c)&&typeof c.name==='string'&&finite(c.population,0,1e8)&&finite(c.activity,0)&&finite(c.passengers,0)&&finite(c.growth,0)&&finite(c.delivered,0)&&finite(c.supplies,0)))return false;
  if(!game.cities.every(c=>c.lastServiceDay===undefined||c.lastServiceDay===null||finite(c.lastServiceDay,0,game.day)))return false;
  if(!game.tiles.every(tile=>tile.building?.populationCityId===undefined||tile.building.populationCityId===null||game.cities.some(city=>city.id===tile.building.populationCityId)))return false;
  if(!game.industries.every(i=>validPoint(game,i)&&uniqueId(i)&&owns(INDUSTRIES,i.kind)&&typeof i.name==='string'&&finite(i.capacity,.1,10)&&finite(i.activity,0)&&finite(i.production,0)&&finite(i.shipped,0)&&finite(i.received,0)&&finite(i.idleDays,0)&&i.inventory&&Object.entries(i.inventory).every(([cargo,n])=>owns(CARGO,cargo)&&finite(n,0,1e9))))return false;
  if(!game.industries.every(i=>validFootprint(i,industryFootprint(i.kind))&&i.x+industrySize(i)<=game.width&&i.y+industrySize(i)<=game.height))return false;
  if(!game.industries.every(i=>(i.lastProductionDay===undefined||finite(i.lastProductionDay,0,game.day))&&(i.nextProductionDay===undefined||(Number.isInteger(i.nextProductionDay)&&finite(i.nextProductionDay,0,Math.floor(game.day)+3)))&&(i.nextReviewDay===undefined||(Number.isInteger(i.nextReviewDay)&&finite(i.nextReviewDay,0,Math.floor(game.day)+45)))&&(i.totalProduced===undefined||finite(i.totalProduced,0,1e15))))return false;
  if(!game.stations.every(s=>validPoint(game,s)&&uniqueId(s)&&typeof s.name==='string'&&TRANSPORT_MODES.includes(s.mode)))return false;
  if(!game.zones.every(z=>validPoint(game,z)&&ZONE_TYPES.includes(z.kind)&&finite(z.progress,0,3)))return false;
  // Only occupied cells need an index: even the largest world stays sparse.
  // The anchor owns the building; child copies or intersecting sites are corrupt.
  const occupied=new Map(),reserved=new Set([...game.cities,...game.stations].map(p=>p.y*game.width+p.x));
  const claim=(x,y,size,kind,anchor)=>{
    if(x+size>game.width||y+size>game.height)return false;
    for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++){
      const index=(y+dy)*game.width+x+dx,tile=game.tiles[index];
      if(occupied.has(index)||reserved.has(index)||tile.road||tile.rail||tile.bridge||tile.tunnel||tile.terrain==='water')return false;
      if(kind==='building'&&tile.terrain==='mountain')return false;
      if(tile.zone&&(kind!=='building'||dx||dy))return false;
      occupied.set(index,{kind,anchor});
    }
    return true;
  };
  const terrainSites=[];
  for(let index=0;index<game.tiles.length;index++){
    const building=game.tiles[index].building,object=game.tiles[index].terrainObject;
    if(object!==undefined){
      if(!object||!TERRAIN_OBJECT_KINDS.has(object.kind)||![2,3].includes(object.footprint)||typeof object.detail!=='string'||object.detail.length>=80||!Number.isInteger(object.variant))return false;
      terrainSites.push({x:index%game.width,y:Math.floor(index/game.width),object});
    }
    if(building&&!claim(index%game.width,Math.floor(index/game.width),buildingSize(building),'building',index))return false;
  }
  for(const industry of game.industries){
    if(industryTiles(industry).some(p=>game.tiles[p.y*game.width+p.x].terrain==='mountain'&&!INDUSTRIES[industry.kind].terrain?.includes('mountain')))return false;
    if(!claim(industry.x,industry.y,industrySize(industry),'industry',industry.y*game.width+industry.x))return false;
  }
  for(const site of terrainSites){
    const size=terrainObjectSize(site.object);
    if(!terrainObjectGroundIsFlat(game,site.x,site.y,size))return false;
    if(terrainObjectTiles(site).some(p=>game.tiles[p.y*game.width+p.x]?.terrain!==site.object.kind))return false;
    if(!claim(site.x,site.y,size,'terrainObject',site.y*game.width+site.x))return false;
  }
  for(const zone of game.zones){const index=zone.y*game.width+zone.x,site=occupied.get(index);if(site&&(site.kind!=='building'||site.anchor!==index))return false;}

  if(!game.routes.every(r=>uniqueId(r)&&typeof r.name==='string'&&TRANSPORT_MODES.includes(r.mode)&&owns(CARGO,r.cargo)&&typeof r.active==='boolean'&&finite(r.delivered,0)&&finite(r.revenue,0)&&Array.isArray(r.stops)&&r.stops.length===2&&r.stops.every(id=>game.stations.some(s=>s.id===id&&s.mode===r.mode))&&Array.isArray(r.path)&&r.path.length>1&&r.path.length<=game.tiles.length&&r.path.every(p=>validPoint(game,p))))return false;
  if(!game.routes.every(route=>route.expenses===undefined||finite(route.expenses,0,1e15)))return false;
  if(!game.routes.every(route=>(route.accountingStartDay===undefined||finite(route.accountingStartDay,0,game.day))&&(route.revenueAtAccountingStart===undefined||finite(route.revenueAtAccountingStart,0,route.revenue))))return false;
  if(!game.vehicles.every(v=>uniqueId(v)&&game.routes.some(r=>r.id===v.routeId)&&finite(v.x,0,game.width)&&finite(v.y,0,game.height)&&finite(v.angle)&&finite(v.capacity,1,1e9)&&finite(v.load,0,v.capacity)&&finite(v.progress,0,(game.routes.find(r=>r.id===v.routeId)?.path.length||1)-1)&&[1,-1].includes(v.direction)))return false;
  if(!game.vehicles.every(v=>(v.dwellRemaining===undefined||finite(v.dwellRemaining,0,3))&&(v.tripSerial===undefined||(Number.isInteger(v.tripSerial)&&finite(v.tripSerial,0,1e10)))&&(v.totalDistance===undefined||finite(v.totalDistance,0,1e15))))return false;
  const availableLevel=availableVehicleLevel(game);
  if(!game.vehicles.every(v=>(v.level===undefined||(Number.isInteger(v.level)&&finite(v.level,0,availableLevel)))&&(v.paidPrice===undefined||finite(v.paidPrice,0,1e15))))return false;
  for(const route of game.routes) {
    if(route.stops[0]===route.stops[1])return false;
    for(let i=1;i<route.path.length;i++)if(Math.abs(route.path[i].x-route.path[i-1].x)+Math.abs(route.path[i].y-route.path[i-1].y)!==1)return false;
    const endpoints=[route.path[0],route.path[route.path.length-1]];
    for(let i=0;i<2;i++) {const station=game.stations.find(s=>s.id===route.stops[i]);if(distance(station,endpoints[i])!==0)return false;}
  }
  if(!game.history.every(h=>h&&['month','day','income','expenses','profit','money','population','delivered'].every(k=>finite(h[k]))))return false;
  if(!game.history.every(h=>(h.operatingExpenses===undefined||finite(h.operatingExpenses,0,1e15))&&(h.operatingProfit===undefined||finite(h.operatingProfit))))return false;
  if(!game.notifications.every(n=>n&&typeof n.message==='string'&&typeof n.text==='string'&&typeof n.type==='string'&&finite(n.day,0)))return false;
  return true;
}
export function saveGame(game) {
  if(!validateGame(game))return result(false,'The game state could not be validated.');
  try {if(typeof localStorage==='undefined')return result(false,'Saving is unavailable in this environment.');localStorage.setItem(SAVE_KEY,JSON.stringify(encodeGame(game)));return result(true,'Company saved on this device.');}
  catch{return result(false,'Could not save. Browser storage may be full or unavailable.');}
}
// Expand old compact art only into genuinely empty adjoining land. No relocation,
// population changes, industry resets, or removal of a neighbor's construction.
function expandRestoredSites(game) {
  let changed=false;
  for(let index=0;index<game.tiles.length;index++){
    const building=game.tiles[index].building;if(!building)continue;
    const size=buildingFootprint(building.kind);if(buildingSize(building)>=size)continue;
    const site={x:index%game.width,y:Math.floor(index/game.width),building};
    if(!buildingSiteProblem(game,building.kind,site.x,site.y,size,{exclude:site})){
      placeBuildingSite(game,building.kind,site.x,site.y,{size,building,exclude:site});changed=true;
    }
  }
  for(const industry of game.industries){
    const size=industryFootprint(industry.kind);
    if(industrySize(industry)<size&&!industrySiteProblem(game,industry.kind,industry.x,industry.y,size,industry)){
      industry.footprint=size;releaseTerrainObjects(game,industryTiles(industry));changed=true;
    }
  }
  if(changed)game.revision++;
}
// Shared hydration keeps autosaves and named saves on the same migration path.
export function restoreGame(saved) {
  try {
    const game=decodeGame(saved);if(!validateGame(game))return null;
    if(game.siteFootprintVersion!==1){expandRestoredSites(game);game.siteFootprintVersion=1;}
    if(game.terrainObjectVersion!==1){allocateTerrainObjects(game);game.revision++;}
    game.networkRevision??=0;
    if(game.monthlyOperatingExpenses===undefined)game.monthlyIncomeAtAccountingStart=game.monthlyIncome;
    game.monthlyOperatingExpenses??=0;game.totalOperatingExpenses??=0;game.lastMonthlyOperatingProfit??=0;game.monthlyIncomeAtAccountingStart??=0;game.accountingStartDay??=game.day;
    game.lastMonth=calendarMonth(game);
    for(const industry of game.industries)initializeIndustry(game,industry);
    for(const vehicle of game.vehicles){vehicle.dwellRemaining??=0;vehicle.tripSerial??=0;vehicle.level??=0;vehicle.paidPrice??=VEHICLE_COSTS[game.routes.find(route=>route.id===vehicle.routeId).mode];}
    for(const city of game.cities)if(city.lastServiceDay===undefined)city.lastServiceDay=city.delivered>0?game.day:null;
    for(const route of game.routes){route.pathRevision=-1;if(route.expenses===undefined)route.revenueAtAccountingStart=route.revenue;route.expenses??=0;route.accountingStartDay??=game.day;route.revenueAtAccountingStart??=0;}
    game.maintenanceRevision=-1;
    return game;
  }catch{return null;}
}
export function loadGame() {
  try {
    if(typeof localStorage==='undefined')return null;
    const raw=localStorage.getItem(SAVE_KEY);if(!raw||raw.length>12000000)return null;
    return restoreGame(JSON.parse(raw));
  }catch{return null;}
}
export function deleteSave() {
  try{if(typeof localStorage!=='undefined')localStorage.removeItem(SAVE_KEY);return result(true,'Saved company deleted.');}catch{return result(false,'Could not access browser storage.');}
}
