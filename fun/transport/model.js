import { BIOMES, CARGO, INDUSTRIES, BUILD_COSTS, VEHICLE_COSTS, VEHICLE_CAPACITIES, VEHICLE_UPKEEP, INFRASTRUCTURE_UPKEEP, TOWN_CARGO } from './data.js';
import { generateWorld, seedNumber, WORLD_SIZES, NEW_WORLD_SIZES, DEFAULT_WORLD_SIZE, supportsGenerationVersion, worldGenerationOptions, validGenerationOptions } from './world.js';
import { BUILDINGS } from './buildings.js';
import { allocateTerrainObjects } from './world-terrain-objects.js';
import { industryContains, industryDistance, industryTiles, industrySiteProblem, industrySpacingProblem, industrySize, industryFootprint } from './industry-sites.js';
import { buildingAt, buildingSize, buildingFootprint, buildingTiles, buildingSiteProblem, placeBuildingSite } from './building-sites.js';
import { encodeGame, decodeGame, rememberGeneratedWorld } from './save-codec.js';
import { randomAt, localEnvironment, weatherAt, stepEcology } from './environment.js';
import { stepSettlements, housingCapacity } from './settlements.js';
import { monthlyTownRelations, disturbTown, townActionQuote, TOWN_ACTIONS, TOWN_RADIUS, DISTURBANCE } from './town-authority.js';
import { monthlyMarkets, recordTownSupply, recordVisitors, validMarket, MARKET } from './town-market.js';
import { stepWorkshops, acceptWorkshopInput, workshopRecipes, workshopInputs, workshopOutputs, validWorkshop, townOf } from './town-market.js';
import { recordWorksFreight } from './town-market.js';
import { WORKSHOP } from './data.js';
import { propertyAt, propertySector, SALE_SHARE } from './town-market.js';
import { nearbyCities, nearbyIndustries, nearbyStations, nearbyZones } from './simulation-spatial.js';
import { nextLineColor, nextRouteNumber, ensureRouteNumbers, defaultRouteName, validRouteNumber } from './route-lines.js';
import { networkIndex, updateNetworkIndex, noteNetworkChanges, networkChangesSince } from './network-index.js';
import { noteSurfaceChanges } from './change-journal.js';
import { initializeIndustry, stepIndustries } from './industry-simulation.js';
import { evaluateMilestones, validMilestones } from './milestones.js';
import { stepContracts, contractBonus, validContracts } from './contracts.js';
import { planIndustryOpening } from './industry-openings.js';
import { availableVehicleLevel, priceFor, inflationInfo, calendarMonth, airAvailable, AIR_DEBUT_YEAR } from './economy-pricing.js';
import { distancePay, transitPay, payTiles } from './economy-pricing.js';
import { VEHICLE_SPEEDS } from './data.js';
import { isTownTraffic } from './data.js';
import { MAIL_POOL_SHARE } from './settlements.js';
import { TERRAIN_OBJECT_KINDS, terrainObjectAt, terrainObjectSize, terrainObjectTiles, terrainObjectGroundIsFlat, releaseTerrainObjects } from './terrain-objects.js';
import { LAND_HEIGHT_LEVELS } from './terrain-elevation.js';
import { surfaceHeight } from './terrain-geometry.js';
import { terraformProblem, planTerraformLevel, planTerraformStroke, planStructureSpan, networkEdgeAllowed, transportElevation, validStructureMetadata, networkTerrainProblem, networkTerrainPlanProblem } from './terrain-engineering.js';
import { money, count, tiles, listJoin, capital, cargoName, modelYear, vehicleNoun, stopKind, token } from './copy.js';
import { vehicleModel } from './vehicle-models.js';
import { reviewPerformance, validPerformance } from './company-rating.js';
import { createAchievementState, noteDelivery, stepAchievements, backfillAchievements, validAchievements } from './achievements.js';
import { STATION_RADIUS, AIRPORT_MIN_TILES, AIRPORT_REACH, AIR_TURNAROUND, AIR_DEPARTURE_DWELL, AIRPORT_TOOLS, stationSpan, stationReach, stationDistance, stationTiles, stationSiteAt, airPath } from './station-sites.js';
export { priceFor, inflationInfo, airAvailable, AIR_DEBUT_YEAR } from './economy-pricing.js';
export { distancePay, transitPay, scheduledDays, payTiles, travelTiles } from './economy-pricing.js';
export { industryConditions } from './industry-simulation.js';
export { settlementSuitability } from './settlements.js';
export { weatherAt, localEnvironment } from './environment.js';
export { WORLD_SIZES, NEW_WORLD_SIZES, worldGenerationOptions } from './world.js';
export { BUILDINGS } from './buildings.js';
export { buildingAt, buildingSize, buildingFootprint } from './building-sites.js';
export { BIOMES, CARGO, INDUSTRIES, BUILD_COSTS, VEHICLE_COSTS } from './data.js';

export const SAVE_KEY = 'transport-save-v1';
export { STATION_RADIUS, AIRPORT_REACH, AIRPORT_MIN_TILES, AIR_TURNAROUND, AIRPORT_TOOLS, stationSpan, stationReach, stationDistance, stationServes, stationTiles, stationSiteAt } from './station-sites.js';
const DIRECTIONS = [[1,0],[-1,0],[0,1],[0,-1]];
const ZONE_TYPES = ['residential','commercial','industrial'];
const TRANSPORT_MODES = ['road','rail','water','air'];
const NETWORK_TOOLS = ['road','rail','bridge','railbridge','tunnel','railtunnel'];
const TERRAIN = new Set(['grass','water','forest','mountain','rock','sand','snow']);
const MAX_INVENTORY = 900;
const owns = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const clamp = (n, min, max) => Math.max(min, Math.min(max,n));
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const result = (ok,message,extra={}) => ({ok,message,...extra});
const moneyText = n => money(n);
// A result names what it did, then the money: 'Road built. $1,200 spent.'
const spent = cost => cost>0?` ${moneyText(cost)} spent.`:'';
const makeId = (game,prefix) => `${prefix}-${game.nextId++}`;
// Generated towns and industries are numbered from 1, so a new one skips any id already taken.
function freshId(game,prefix,list){const used=new Set(list.map(item=>item.id));let id;do id=makeId(game,prefix);while(used.has(id));return id;}
export function tileAt(game,x,y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y*game.width+x] : null;
}
export function industryAt(game,x,y) { return game.industries.find(i => industryContains(i,x,y)) || null; }
export function stationAt(game,x,y) { return stationSiteAt(game,x,y); }
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
/** Why an airport cannot open with its north-west tile at (x, y): the whole 6 × 2 site must be dry, clear and level. */
export function airportSiteProblem(game,axis,x,y){
  const site={x,y,mode:'air',axis},{w,h}=stationSpan(site),fail=(message,reason='blocked')=>({message,reason});
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x+w>game.width||y+h>game.height)return fail('The whole 6 × 2 airport must fit inside the map.');
  for(const p of stationTiles(site)){
    const t=tileAt(game,p.x,p.y);
    if(t.terrain==='water')return fail('Airports need dry land. Pick a site away from water.','terrain');
    if(t.terrain==='mountain')return fail('Airports need level land, clear of mountains.','terrain');
    if(t.road||t.rail||t.bridge||t.tunnel||t.zone||buildingAt(game,p.x,p.y)||industryAt(game,p.x,p.y)||stationSiteAt(game,p.x,p.y)||game.cities.some(c=>c.x===p.x&&c.y===p.y))return fail('Clear all 12 tiles before building an airport.');
  }
  let low=Infinity,high=-Infinity;
  for(let v=y;v<=y+h;v++)for(let u=x;u<=x+w;u++){const z=surfaceHeight(game,u,v);low=Math.min(low,z);high=Math.max(high,z);}
  return high-low>.01?fail('Airports need level ground. Level the area in Terrain & crossings first.','terrain'):null;
}
function notify(game,message,type='info',extra) {
  game.notifications.unshift({ id: makeId(game,'notice'), day:game.day, message, text:message, type, ...(extra?.topic?{topic:extra.topic}:{}), ...(extra?.target?{target:extra.target}:{}), ...(extra?.template?{template:extra.template}:{}) });
  game.notifications.length = Math.min(game.notifications.length,24);
}
// Relaxed is the default and is never stored; Standard and Lean are the player's choice of a tighter start.
const STARTING_FUNDS=[100000,200000,400000];
export function createGame({biome='taiga',seed=1847,size=DEFAULT_WORLD_SIZE,generationVersion,townCount,industryDistricts,startingFunds}={}) {
  if (!owns(BIOMES,biome)) biome='taiga';
  const funds=STARTING_FUNDS.includes(startingFunds)?startingFunds:400000;
  const defaults = worldGenerationOptions(size, biome);
  const settings = { townCount: townCount ?? defaults.townCount, industryDistricts: industryDistricts ?? defaults.industryDistricts };
  const generationOptions = settings.townCount === defaults.townCount && settings.industryDistricts === defaults.industryDistricts ? undefined : settings;
  const game = {
    version:1, siteFootprintVersion:2, terrainObjectVersion:1, seed:seedNumber(seed), biome, ...generateWorld(biome,seed,size,generationVersion,generationOptions),
    money:funds, day:0, totalDelivered:0, totalRevenue:0,
    monthlyIncome:0, monthlyExpenses:0, monthlyOperatingExpenses:0, monthlyIncomeAtAccountingStart:0, lastMonthlyProfit:0, lastMonthlyOperatingProfit:0, accountingStartDay:0,
    history:[], notifications:[], revision:0, networkRevision:0, nextId:100,
    totalExpenses:0, totalOperatingExpenses:0, lastDailyDay:0, lastMonth:0,
    achievements:createAchievementState(0),
  };
  rememberGeneratedWorld(game);
  for(const city of game.cities)city.mail??=0;
  for(const industry of game.industries)initializeIndustry(game,industry);
  game.stations.push(
    {id:'station-1',name:`${game.cities[0].name} Central`,x:game.cities[0].x,y:game.cities[0].y,mode:'road'},
    {id:'station-2',name:`${game.cities[1].name} Central`,x:game.cities[1].x,y:game.cities[1].y,mode:'road'},
  );
  addRoute(game,{mode:'road',stops:['station-1','station-2'],cargo:'passengers'});ensureRouteNumbers(game);
  game.money=funds; game.monthlyExpenses=0; game.totalExpenses=0;
  if(funds!==400000)game.startingFunds=funds;
  game.notifications=[];
  notify(game,`Welcome to ${BIOMES[biome].name}. Your first bus is running.`,'success');
  return game;
}

export function stationCoverage(game,station) {
  // An airport serves towns only, at its wider reach: passengers and mail, never freight or industries.
  if(station.mode==='air'){const reach=stationReach(station),cities=nearbyCities(game,station.x,station.y,reach+5).filter(city=>stationDistance(station,city)<=reach),town=cities.length?['passengers','mail']:[];return {cities,industries:[],zones:[],produces:town,accepts:town.slice()};}
  const cities=nearbyCities(game,station.x,station.y,STATION_RADIUS).filter(city => distance(city,station)<=STATION_RADIUS);
  const industries=nearbyIndustries(game,station.x,station.y,STATION_RADIUS+2).filter(industry => industryDistance(industry,station)<=STATION_RADIUS);
  const zones=nearbyZones(game,station.x,station.y,STATION_RADIUS).filter(zone => distance(zone,station)<=STATION_RADIUS);
  const produces=new Set(cities.length ? ['passengers','mail'] : []);
  const accepts=new Set(cities.length ? ['passengers','mail',...TOWN_CARGO] : []);
  for (const industry of industries) {
    for (const cargo of Object.keys(INDUSTRIES[industry.kind].outputs)) produces.add(cargo);
    for (const cargo of Object.keys(INDUSTRIES[industry.kind].inputs)) accepts.add(cargo);
  }
  for (const city of cities) { for (const cargo of workshopOutputs(game,city)) produces.add(cargo); for (const cargo of workshopInputs(game,city)) accepts.add(cargo); }
  return { cities,industries,zones,produces:[...produces],accepts:[...accepts] };
}
// A two-stop passenger or mail service connects two actual towns, even where older
// maps have overlapping catchments. It must not collect and return the same town.
export function passengerEndpoints(game,from,to) {
  if(!from||!to)return null;
  // Passenger trips need towns only. Computing full station coverage here
  // needlessly walked every industry footprint and development zone per stop.
  const fromCities=nearbyCities(game,from.x,from.y,stationReach(from)+(from.mode==='air'?5:0)).filter(city=>stationDistance(from,city)<=stationReach(from));
  const toCities=nearbyCities(game,to.x,to.y,stationReach(to)+(to.mode==='air'?5:0)).filter(city=>stationDistance(to,city)<=stationReach(to));
  let best=null,bestDistance=Infinity;
  for(const a of fromCities)for(const b of toCities){
    if(a.id===b.id)continue;
    const walking=stationDistance(from,a)+stationDistance(to,b);
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
  if(mode==='air')return airPath(game,from,to);
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
function invalidateNetwork(game,points){const previous=game.networkRevision||0;game.revision++;game.networkRevision=previous+1;updateNetworkIndex(game,points,previous);noteNetworkChanges(game,points,previous);}
// Accounts, fleets and names change no map cell. Their revision step is journaled as an
// empty surface change, so view caches keep their terrain, scenery and vertex heights.
function noteBookkeeping(game){const from=game.revision||0;game.revision=from+1;noteSurfaceChanges(game,from,game.revision,[]);}
// Construction undo rewrites tiles outside build() and advances the same revisions.
export function invalidateNetworkPoints(game,points){invalidateNetwork(game,points);}
// Towns lay their own streets as upkeep-free public roads; one revision covers every town's day.
function placePublicRoads(game,points){for(const p of points){const t=tileAt(game,p.x,p.y);t.road=true;t.publicRoad=true;t.detail='';if(t.terrain==='forest')t.terrain=game.biome==='tundra'?'snow':game.biome==='desert'?'sand':'grass';}invalidateNetwork(game,points);}
function spend(game,cost) { game.money-=cost;game.monthlyExpenses+=cost;game.totalExpenses+=cost; }
export function quoteStructureSpan(game,tool,points) {
  const plan=planStructureSpan(game,tool,points);if(!plan.ok)return plan;
  const placements=plan.placements.map(p=>({...p,cost:constructionCost(game,p.tool,p.x,p.y)}));
  const cost=placements.reduce((sum,p)=>sum+p.cost,0);
  return {...plan,placements,cost,...game.money<cost?{ok:false,message:`Need ${moneyText(cost)} for the whole ${plan.structure}.`}:{}};
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
  return result(true,built?`${plan.mode==='rail'?'Rail':'Road'} ${plan.structure} built at level ${plan.height}.${spent(plan.cost)}`:'Already built.',{cost:plan.cost,built,failed:0,skipped,level:plan.level,height:plan.height});
}
export function quoteTerraformLevel(game, points, { targetLevel } = {}) {
  const plan=planTerraformLevel(game,points,targetLevel);if(!plan.ok)return plan;
  const unitPrice=priceFor(game,BUILD_COSTS.level),placements=plan.placements.map(p=>({...p,cost:p.steps*unitPrice}));
  const cost=placements.reduce((sum,p)=>sum+p.cost,0);
  return {...plan,placements,cost,...game.money<cost?{ok:false,message:`Need ${moneyText(cost)} to level the whole area.`}:{}};
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
  return result(true,`${verb} ${count(changed.length,'point')}.${spent(plan.cost)}`,{cost:plan.cost,built:changed.length,failed:0,skipped:plan.placements.length-changed.length,...plan.level!==undefined?{level:plan.level}:{}});
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
export function networkAlreadyBuilt(tile,tool) { return Boolean(tile[tool.startsWith('rail')?'rail':'road']&&(!['bridge','railbridge'].includes(tool)||tile.bridge)&&(!['tunnel','railtunnel'].includes(tool)||tile.tunnel)); }
/** Why build() would refuse this tile, checked in build()'s own order; null when it would succeed or is already built. Plans pass a running `money`. Area leveling is quoted by quoteTerraformLevel. */
export function buildProblem(game,tool,x,y,{money=game.money}={}) {
  const t=tileAt(game,x,y),fail=(message,reason='blocked')=>({message,reason});
  if(!t) return fail('Choose a tile inside the map.');
  if(!owns(BUILD_COSTS,tool)) return fail('Unknown construction tool.');
  if(tool==='level')return null;
  const point={x,y},station=stationAt(game,x,y),industry=industryAt(game,x,y),site=buildingAt(game,x,y);
  const city=game.cities.find(c=>c.x===x&&c.y===y);
  if(tool==='raise'||tool==='lower') {
    const problem=terraformProblem(game,tool,x,y);if(problem)return fail(problem,'terrain');
    const cost=constructionCost(game,tool,x,y);return money<cost?fail(`Need ${moneyText(cost)} to shape this point.`,'funds'):null;
  }
  if(tool==='bulldoze') {
    const serving=station?game.routes.filter(r=>r.stops.includes(station.id)).map(r=>r.name):[];
    if(serving.length) return fail(`${serving.length>2?`${serving.slice(0,2).join(', ')} and ${serving.length-2} more`:listJoin(serving)} ${serving.length>1?'use':'uses'} this stop. Retire ${serving.length>1?'those routes':'the route'} first, then remove the stop.`);
    if(city) return fail('Town centres can’t be removed.');
    if(!station&&!industry&&!site&&!t.zone&&!t.road&&!t.rail&&t.terrain!=='forest'&&t.terrain!=='rock'&&!hasClearableDecoration(t)) return fail('There’s nothing to bulldoze here.');
    return money<constructionCost(game,tool,x,y)?fail(`Need ${moneyText(constructionCost(game,tool,x,y))} to clear this tile.`,'funds'):null;
  }
  if(NETWORK_TOOLS.includes(tool)) {
    const mode=tool.startsWith('rail')?'rail':'road';
    const bridge=tool==='bridge'||tool==='railbridge',tunnel=tool==='tunnel'||tool==='railtunnel';
    if(networkAlreadyBuilt(t,tool)) return null;
    if(t.structureAxis)return fail('Each elevated span carries one transport mode. Build another span alongside it.');
    if(industry||site||t.zone) return fail('A building or zone is in the way. Clear it first, then build here.');
    if(station?.mode==='air') return fail('Roads and railways can’t cross an airport. Build around it.');
    if(station&&station.mode!==mode) return fail('Roads and railways can’t cross at a stop. Build around it.');
    if(t.terrain==='water'&&!bridge&&!t.bridge) return fail(`Water needs a ${mode==='rail'?'rail ':''}bridge.`,'terrain');
    if(t.terrain==='mountain'&&!tunnel&&!t.tunnel) return fail(`Mountains need a ${mode==='rail'?'rail ':''}tunnel.`,'terrain');
    if(bridge&&t.terrain!=='water') return fail('Place bridges on water; connect the banks with ordinary track or road.','terrain');
    if(tunnel&&t.terrain!=='mountain'&&t.terrain!=='rock') return fail('Tunnels must cross mountains or rock.','terrain');
    if(!bridge&&!tunnel){const problem=networkTerrainProblem(game,x,y,mode);if(problem)return fail(problem,'terrain');}
    const cost=constructionCost(game,tool,x,y);
    return money<cost?fail(`Need ${moneyText(cost)} to build here.`,'funds'):null;
  }
  if(AIRPORT_TOOLS.has(tool)) {
    if(!airAvailable(game))return fail(`Air travel arrives on 1 January ${AIR_DEBUT_YEAR}.`);
    const problem=airportSiteProblem(game,tool==='airport-y'?'y':'x',x,y);if(problem)return fail(problem.message,problem.reason);
    const cost=constructionCost(game,tool,x,y);return money<cost?fail(`Need ${moneyText(cost)} for this airport.`,'funds'):null;
  }
  if(tool==='bus-stop'||tool==='train-stop'||tool==='port') {
    const mode=tool==='port'?'water':tool==='bus-stop'?'road':'rail';
    if(station) return fail(`There’s already a stop here. ${mode==='water'?'Pick another spot beside the shore.':`Pick an empty ${mode} tile.`}`);
    if(mode==='water'){
      if(t.terrain!=='water')return fail('Place a port on water directly beside land.','terrain');
      if(industry||site||t.zone||t.road||t.rail||t.bridge||t.tunnel||city)return fail('Ports need empty shoreline water, away from bridges.');
      if(!DIRECTIONS.some(([dx,dy])=>{const shore=tileAt(game,x+dx,y+dy);return shore&&shore.terrain!=='water';}))return fail('Place a port directly beside the shore.','terrain');
    }else{
      if(industry||site||t.zone) return fail('Choose an unoccupied road or rail tile.');
      if(!validNetwork(t,mode)) return fail(`Build a ${mode==='road'?'road':'railway'} here first.`);
      if(t.bridge||t.tunnel) return fail('Stops can’t sit on a bridge or in a tunnel. Pick open ground beside it.');
    }
    const cost=constructionCost(game,tool,x,y);return money<cost?fail(`Need ${moneyText(cost)} for this stop.`,'funds'):null;
  }
  if(tool==='workshop') {
    const problem=buildingSiteProblem(game,'factory',x,y,WORKSHOP.footprint);if(problem)return fail(problem);
    if(!townOf(game,x,y))return fail('Place workshops within 10 tiles of a town center.');
    const cost=constructionCost(game,tool,x,y);return money<cost?fail(`Need ${moneyText(cost)} for this workshop.`,'funds'):null;
  }
  if(station||industry||site||t.zone||t.road||t.rail||city) return fail('Choose an empty tile or clear this one first.');
  if(t.terrain==='water'||(t.terrain==='mountain'&&!INDUSTRIES[tool]?.terrain?.includes('mountain'))) return fail('This structure needs buildable land.','terrain');
  const cost=constructionCost(game,tool,x,y);if(money<cost)return fail(`Need ${moneyText(cost)} to build this.`,'funds');
  if(ZONE_TYPES.includes(tool))return null;
  if(tool==='city') {
    const terrainProblem=networkTerrainProblem(game,x,y,'road');if(terrainProblem)return fail(terrainProblem,'terrain');
    if(game.cities.some(c=>distance(c,point)<11))return fail('This is too close to another town. Found it at least 11 tiles from any town centre.');
    if(['mountain','rock'].includes(t.terrain))return fail('A new town needs level land.','terrain');
    return null;
  }
  if(owns(BUILDINGS,tool)) {const problem=buildingSiteProblem(game,tool,x,y,buildingFootprint(tool));return problem?fail(problem):null;}
  const def=INDUSTRIES[tool];
  const siteProblem=industrySiteProblem(game,tool,x,y);if(siteProblem)return fail(siteProblem);
  if(!def.biomes.includes(game.biome))return fail(`${def.name} is unavailable in ${BIOMES[game.biome].name}.`);
  if(def.terrain&&!def.terrain.includes(t.terrain))return fail(`${def.name} needs ${listJoin(def.terrain,'or')} ground.`,'terrain');
  const spacing=industrySpacingProblem(game,tool,x,y);return spacing?fail(spacing):null;
}
// Counting from the number of stops keeps fresh-game names; after a demolition the count moves past names still in use.
function nextStationName(game,prefix) { const used=new Set(game.stations.map(s=>s.name));let n=game.stations.length+1;while(used.has(`${prefix} ${n}`))n++;return `${prefix} ${n}`; }
export function build(game,tool,x,y) {
  const problem=buildProblem(game,tool,x,y);if(problem)return result(false,problem.message);
  if(tool==='level')return buildTerraformLevel(game,[{x,y}]);
  const t=tileAt(game,x,y),point={x,y},station=stationAt(game,x,y),industry=industryAt(game,x,y),site=buildingAt(game,x,y),nature=terrainObjectAt(game,x,y);
  if(tool==='raise'||tool==='lower') {
    const cost=constructionCost(game,tool,x,y);
    const level=surfaceHeight(game,x,y)+(tool==='raise'?1:-1);
    releaseTerrainObjects(game,Array.from({length:9},(_,n)=>({x:x+n%3-1,y:y+Math.floor(n/3)-1})));
    spend(game,cost);t.elevation=level/LAND_HEIGHT_LEVELS;t.detail='';
    if(t.terrain==='forest'||(t.terrain==='mountain'&&t.elevation<12/16)||(t.terrain==='rock'&&t.elevation<10/16))t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
    game.revision++;
    return result(true,`${tool==='raise'?'Raised':'Lowered'} to level ${level}.${spent(cost)}`,{cost,level});
  }
  if(tool==='bulldoze') {
    const cost=constructionCost(game,tool,x,y);
    spend(game,cost);
    // A town remembers the buildings and woodland cleared near it (town-authority.js); industries, stops, zones and rocks never count.
    const woodland=industry?0:nature?.object.kind==='forest'?terrainObjectTiles(nature).length:t.terrain==='forest'?1:0,townSite=site?(owns(site.building,'populationCityId')?(site.building.populationCityId===null?null:game.cities.find(c=>c.id===site.building.populationCityId)):closestCity(game,site,TOWN_RADIUS)):null;
    disturbTown(townSite,DISTURBANCE.building);if(woodland)disturbTown(closestCity(game,nature||point,TOWN_RADIUS),woodland*DISTURBANCE.woodland);
    if(nature&&['forest','rock'].includes(nature.object.kind)){
      const points=terrainObjectTiles(nature);releaseTerrainObjects(game,points);
      for(const p of points){const cell=tileAt(game,p.x,p.y);cell.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';cell.detail='';}
    }else releaseTerrainObjects(game,[point]);
    const residents=housingCapacity(site?.building),town=residents?(owns(site.building,'populationCityId')?game.cities.find(city=>city.id===site.building.populationCityId):closestCity(game,site,10)):null;
    if(town){town.population=Math.max(0,town.population-residents);town.passengers=Math.min(town.passengers,town.population*.9);if(town.mail>town.population*MAIL_POOL_SHARE)town.mail=town.population*MAIL_POOL_SHARE;}
    if(station) game.stations=game.stations.filter(s=>s.id!==station.id);
    const supplied=industry?suppliedRoutes(game,industry):[];
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
    warnLostSupply(game,supplied);
    return result(true,`Cleared ${site?'the building':industry?`${industry.name||INDUSTRIES[industry.kind].name}`:station?.mode==='air'?'the airport':nature?nature.object.kind==='forest'?'the woodland':'the rocks':'the tile'}.${spent(cost)}`,{cost});
  }
  if(NETWORK_TOOLS.includes(tool)) {
    const mode=tool.startsWith('rail')?'rail':'road';
    const bridge=tool==='bridge'||tool==='railbridge',tunnel=tool==='tunnel'||tool==='railtunnel';
    if(networkAlreadyBuilt(t,tool)) return result(true,'Already built.',{cost:0,unchanged:true});
    const cost=constructionCost(game,tool,x,y);
    releaseTerrainObjects(game,[point]);
    spend(game,cost);t[mode]=true;if(bridge)t.bridge=true;if(tunnel)t.tunnel=true;
    if(t.terrain==='forest'){t.terrain=game.biome==='tundra'?'snow':game.biome==='desert'?'sand':'grass';t.detail='';}
    invalidateNetwork(game,[point]);
    return result(true,`${mode==='rail'?'Rail':'Road'} ${bridge?'bridge built':tunnel?'tunnel built':'built'}.${spent(cost)}`,{cost});
  }
  if(AIRPORT_TOOLS.has(tool)) {
    const axis=tool==='airport-y'?'y':'x',cost=constructionCost(game,tool,x,y),site={x,y,mode:'air',axis},points=stationTiles(site);
    const town=game.cities.filter(c=>stationDistance(site,c)<=stationReach(site)).sort((a,b)=>stationDistance(site,a)-stationDistance(site,b))[0]||closestCity(game,point,12);
    const base=`${town?.name||'Regional'} Airport`,name=game.stations.some(s=>s.name===base)?nextStationName(game,base):base;
    releaseTerrainObjects(game,points);
    for(const p of points){const cell=tileAt(game,p.x,p.y);cell.detail='';if(cell.terrain==='forest'||cell.terrain==='rock')cell.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';}
    const airport={id:makeId(game,'station'),name,x,y,mode:'air',axis};
    spend(game,cost);game.stations.push(airport);invalidateNetwork(game,[point]);
    return result(true,`${name} opened.${spent(cost)}`,{cost,station:airport});
  }
  if(tool==='bus-stop'||tool==='train-stop'||tool==='port') {
    const mode=tool==='port'?'water':tool==='bus-stop'?'road':'rail';
    const cost=constructionCost(game,tool,x,y);
    const nearIndustry=game.industries.find(i=>industryDistance(i,point)<=STATION_RADIUS),nearCity=closestCity(game,point,STATION_RADIUS);
    const name=nextStationName(game,`${nearCity?.name||nearIndustry?.name||(mode==='water'?'Coastal':'Rural')} ${mode==='water'?'Port':mode==='road'?'Stop':'Station'}`);
    const newStation={id:makeId(game,'station'),name,x,y,mode};
    spend(game,cost);game.stations.push(newStation);invalidateNetwork(game,[point]);
    return result(true,`${name} opened.${spent(cost)}`,{cost,station:newStation});
  }
  const cost=constructionCost(game,tool,x,y);
  if(ZONE_TYPES.includes(tool)) {
    releaseTerrainObjects(game,[point]);
    spend(game,cost);t.zone=tool;t.detail='';
    if(t.terrain==='forest'||t.terrain==='rock')t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
    game.zones.push({x,y,kind:tool,progress:0});game.revision++;
    return result(true,`${capital(tool)} zone designated.${spent(cost)}`,{cost});
  }
  if(tool==='city') {
    // Preserve the town credited for existing housing before a new center can
    // become nearer, including legacy buildings that predate explicit owners.
    rememberHousingOwners(game);
    const prefixes=game.biome==='taiga'?['Birch','Willow','Silver','Fern','Maple']:game.biome==='tundra'?['Ice','Frost','North','Winter','Snow']:['Amber','Gold','Dune','Palm','Sun'];
    const suffixes=['field','haven','ford','creek','ridge'];
    const n=Math.max(0,game.cities.length-4);
    const newCity={id:freshId(game,'city',game.cities),name:prefixes[n%prefixes.length]+suffixes[Math.floor(n/prefixes.length)%suffixes.length],x,y,population:80,activity:0,growth:0,passengers:12,mail:0,delivered:0,supplies:0,lastServiceDay:null,founded:true};
    releaseTerrainObjects(game,[point]);
    spend(game,cost);game.cities.push(newCity);t.road=true;t.detail='';t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';invalidateNetwork(game,[point]);
    const founded=town=>`${town} founded. Zone homes nearby and give it a passenger route.`;
    notify(game,founded(newCity.name),'success',{target:{kind:'city',id:newCity.id},template:founded(token('town',newCity.id))});
    return result(true,`${newCity.name} founded.${spent(cost)}`,{cost,city:newCity});
  }
  // A placed workshop is the town's 'factory' building at its first level; the anchor tile names its town.
  if(tool==='workshop') {
    const placed=placeBuildingSite(game,'factory',x,y,{size:WORKSHOP.footprint,building:{level:1,owner:'player',paid:cost}});
    spend(game,cost);game.revision++;
    return result(true,`Workshop built.${spent(cost)}`,{cost,building:placed.building});
  }
  if(owns(BUILDINGS,tool)) {
    const def=BUILDINGS[tool],nearCity=closestCity(game,point,10);
    const size=buildingFootprint(tool);
    const placed=placeBuildingSite(game,tool,x,y,{size,building:{level:1,...def.residents?{populationCityId:nearCity?.id??null}:{},...def.group==='community'?{}:{owner:'player',paid:cost}}});
    spend(game,cost);
    if(nearCity&&def.residents)nearCity.population+=def.residents;
    game.revision++;
    return result(true,`${def.name} built.${spent(cost)}`,{cost,building:placed.building});
  }
  const def=INDUSTRIES[tool];
  spend(game,cost);const newIndustry=placeIndustry(game,tool,x,y,{owner:'player'});
  return result(true,`${def.name} built.${spent(cost)}`,{cost,industry:newIndustry});
}
/** One more level for a workshop you placed, at the placing price; a developed one grows with its zone instead. */
export function expandWorkshop(game,x,y) {
  const site=buildingAt(game,x,y),cost=priceFor(game,WORKSHOP.cost);
  if(site?.building.kind!=='factory'||site.building.owner!=='player')return result(false,'Only your own workshops can be expanded.');
  if(site.building.level>=WORKSHOP.maxLevel)return result(false,'This workshop is fully expanded.');
  if(game.money<cost)return result(false,`Need ${moneyText(cost)} to expand this workshop.`);
  site.building.level+=1;site.building.paid=(site.building.paid||0)+cost;spend(game,cost);game.revision++;
  return result(true,`Workshop expanded to level ${site.building.level}.${spent(cost)}`,{cost,building:site.building});
}
/** A building you placed goes back to its town for 60% of today's value. It stays as it is, and its rent stops; no notice. */
export function sellProperty(game,x,y) {
  const site=buildingAt(game,x,y),zoned=Boolean(tileAt(game,x,y)?.zone||site&&tileAt(game,site.x,site.y).zone);
  if(!site||zoned&&site.building.owner!=='player')return result(false,'Only buildings you placed can be sold.');
  if(site.building.owner!=='player'||!propertySector(site.building.kind))return result(false,'This building is not yours to sell.');
  const property=propertyAt(game,site.x,site.y),refund=Math.round(SALE_SHARE*property.value),name=site.building.kind==='factory'?'Workshop':BUILDINGS[site.building.kind]?.name||'Building';
  delete site.building.owner;delete site.building.paid;game.money+=refund;game.revision++;
  return result(true,`${name} sold${property.town?` to ${property.town.name}`:''} for ${moneyText(refund)}.`,{refund,town:property.town});
}
// One placement for the Build tool and the region's own openings. A world
// producer starts with twelve days of output in stock, like a generated one.
function placeIndustry(game,kind,x,y,{owner,openedDay}){
  const def=INDUSTRIES[kind],stocked=owner!=='player'&&!Object.keys(def.inputs).length;
  const inventory=Object.fromEntries([...Object.keys(def.inputs),...Object.keys(def.outputs)].map(cargo=>[cargo,stocked&&owns(def.outputs,cargo)?def.outputs[cargo]*12:0]));
  const site={id:freshId(game,'industry',game.industries),kind,name:def.name,x,y,footprint:industryFootprint(kind),capacity:1,inventory,production:0,totalProduced:0,activity:0,shipped:0,received:0,idleDays:0,owner,...openedDay===undefined?{}:{openedDay}};
  initializeIndustry(game,site);
  releaseTerrainObjects(game,industryTiles(site));
  game.industries.push(site);game.revision++;
  return site;
}
/** The region's monthly opening near a served town, announced once; `force` (tests and debugging only) skips the date, freight and chance gates. */
export function openIndustry(game,month=calendarMonth(game),{force=false}={}){
  const plan=planIndustryOpening(game,month,{force});if(!plan)return null;
  const site=placeIndustry(game,plan.kind,plan.x,plan.y,{owner:'world',openedDay:Math.floor(game.day)}),size=industrySize(site);
  const town=closestCity(game,{x:site.x+(size-1)/2,y:site.y+(size-1)/2})||game.cities.find(city=>city.id===plan.anchorId);
  const opened=(industry,near)=>`New ${industry} opens near ${near}.`;
  notify(game,opened(INDUSTRIES[plan.kind].name.toLowerCase(),town.name),'success',{topic:'industry-opening',target:{kind:'industry',id:site.id},template:opened(token('industry',site.id),token('town',town.id))});
  return site;
}

export function buildPath(game,tool,points) {
  if(!Array.isArray(points)||!points.length)return result(false,'Choose a construction path.');
  if(tool==='level')return buildTerraformLevel(game,points);
  if(tool==='raise'||tool==='lower')return buildTerraformStroke(game,tool,points);
  const unique=new Map();
  for(const point of points)if(point&&Number.isInteger(point.x)&&Number.isInteger(point.y)){
    const nature=tool==='bulldoze'?terrainObjectAt(game,point.x,point.y):null,airport=tool==='bulldoze'?stationSiteAt(game,point.x,point.y):null;
    const site=tool==='bulldoze'?(buildingAt(game,point.x,point.y)||industryAt(game,point.x,point.y)||(airport?.mode==='air'?airport:null)||(nature&&nature.object.kind!=='mountain'?nature:null)):null;
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
  const errorText=[...errors.keys()].slice(0,2).join(' ');
  const message=count?`Built ${tiles(count)}.${spent(cost)}${failures?` ${tiles(failures)} skipped. ${errorText}`:''}`:errors.size?errorText:skipped?'Already built.':'Choose valid tiles.';
  return result(count>0||skipped>0,message,{cost,built:count,failed:failures,skipped});
}

/** Whether freight of this cargo runs from one stop's coverage to another's: the launch, loading and the route form share it.
 * The industry rule comes first and unchanged; then a town's workshop products load for a different town, and a town with workshops buys their materials. */
export function freightFits(game,source,destination,cargo) {
  const producers=source.industries.filter(i=>INDUSTRIES[i.kind].outputs[cargo]);
  const consumers=destination.industries.filter(i=>INDUSTRIES[i.kind].inputs[cargo]);
  if(producers.length>0&&(consumers.some(c=>producers.every(p=>p.id!==c.id))||(TOWN_CARGO.includes(cargo)&&destination.cities.length>0)))return true;
  const townSources=source.cities.filter(city=>!destination.cities.includes(city)&&workshopOutputs(game,city).includes(cargo));
  const townBuyers=destination.cities.filter(city=>workshopInputs(game,city).includes(cargo)||(TOWN_CARGO.includes(cargo)&&!townSources.includes(city)));
  return producers.length+townSources.length>0&&consumers.length+townBuyers.length>0;
}
/** The refusal for products that could only return to the town that made them: a town both stops reach, whose workshops make this cargo. */
export function workshopLoop(game,a,b,cargo) {
  const town=a.cities.find(city=>b.cities.includes(city)&&workshopOutputs(game,city).includes(cargo));
  return town?`${capital(cargoName(cargo))} from ${town.name} workshops must go to another town. Pick an end stop that doesn’t reach ${town.name}.`:'';
}
function freightPair(game,a,b,cargo) { return freightFits(game,stationCoverage(game,a),stationCoverage(game,b),cargo); }
// Demolishing a site a working freight route loads from or delivers to is a player
// action, so each route it leaves without a producer or buyer gets one warning.
function suppliedRoutes(game,industry) {
  const stops=new Map(game.stations.map(stop=>[stop.id,stop]));
  return game.routes.filter(route=>{const [a,b]=route.stops.map(id=>stops.get(id));return !isTownTraffic(route.cargo)&&a&&b&&(industryDistance(industry,a)<=STATION_RADIUS||industryDistance(industry,b)<=STATION_RADIUS)&&freightPair(game,a,b,route.cargo);});
}
function warnLostSupply(game,routes) {
  for(const route of routes){
    const [a,b]=route.stops.map(id=>game.stations.find(stop=>stop.id===id));if(freightPair(game,a,b,route.cargo))continue;
    const producer=stationCoverage(game,a).industries.some(i=>INDUSTRIES[i.kind].outputs[route.cargo]);
    const stop=producer?b:a,lost=(name,at)=>producer?`${name} lost its buyer. Add a buyer within ${STATION_RADIUS} tiles of ${at}, or retire the route.`:`${name} lost its ${cargoName(route.cargo)} supplier. Add one within ${STATION_RADIUS} tiles of ${at}, or retire the route.`;
    notify(game,lost(route.name,stop.name),'warning',{topic:'route-supply',target:{kind:'route',id:route.id},template:lost(token('route',route.id),token('stop',stop.id))});
  }
}
const vehicleLevel = vehicle => vehicle.level??0;
// A fleet's levels in fleet order, with the lowest and highest (0 for none), in one pass without spreading.
function fleetLevels(vehicles){const levels=new Array(vehicles.length);let minLevel=Infinity,maxLevel=-Infinity;for(let i=0;i<vehicles.length;i++){const level=levels[i]=vehicleLevel(vehicles[i]);if(level<minLevel)minLevel=level;if(level>maxLevel)maxLevel=level;}return vehicles.length?{levels,minLevel,maxLevel}:{levels,minLevel:0,maxLevel:0};}
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
  const {levels,minLevel:level,maxLevel}=fleetLevels(vehicles);
  const eligible=vehicles.filter(v=>vehicleLevel(v)<targetLevel);
  const cost=route?eligible.reduce((sum,v)=>sum+priceFor(game,VEHICLE_COSTS[route.mode]*.4*(targetLevel-vehicleLevel(v))),0):0;
  return {routeId,available:eligible.length>0,affordable:game.money>=cost,level,targetLevel,cost,capacity:vehicles.reduce((sum,v)=>sum+v.capacity,0),nextCapacity:vehicles.reduce((sum,v)=>sum+Math.max(v.capacity,vehicleCapacity(route.mode,Math.max(vehicleLevel(v),targetLevel))),0),speedMultiplier:vehicleSpeedMultiplier(level),nextSpeedMultiplier:vehicleSpeedMultiplier(Math.max(level,targetLevel)),vehicleCount:eligible.length,levels,maxLevel};
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
  const nouns=vehicleNoun(route.mode,route.cargo,2);
  if(!quote.available)return result(false,`${capital(nouns)} on this route are up to date.`);
  if(!quote.affordable)return result(false,`Need ${moneyText(quote.cost)} to upgrade the ${nouns} on this route.`);
  spend(game,quote.cost);applyVehicleUpgrade(game,route,quote.targetLevel);noteBookkeeping(game);
  return result(true,`${capital(nouns)} on ${route.name} upgraded to the ${vehicleModel(route.mode,route.cargo,quote.targetLevel).name}.${spent(quote.cost)}`,{cost:quote.cost,upgrade:quote});
}

export function upgradeFleet(game) {
  const quote=getFleetUpgrade(game);
  if(!quote.available)return result(false,'Your fleet is up to date.');
  if(!quote.affordable)return result(false,`Need ${moneyText(quote.cost)} to upgrade the whole fleet.`);
  // Preflight the whole price, then change all vehicles in one transaction.
  spend(game,quote.cost);
  for(const upgrade of quote.routes)applyVehicleUpgrade(game,fleetIndex(game).routeById.get(upgrade.routeId),quote.targetLevel);
  noteBookkeeping(game);
  return result(true,`${capital(count(quote.count,'vehicle'))} upgraded to the ${modelYear(quote.targetLevel)} models.${spent(quote.cost)}`,{cost:quote.cost,upgrade:quote});
}

// The service rules a launch and an edit share. Freight loads at its producer's end, whichever stop comes first.
function planRoute(game,{mode,stops,cargo},retry='launch again') {
  if(!TRANSPORT_MODES.includes(mode)||!owns(CARGO,cargo))return result(false,'Choose a valid transport mode and cargo.');
  if(!Array.isArray(stops)||stops.length!==2||stops[0]===stops[1])return result(false,'Choose two different stops.');
  let stations=stops.map(id=>game.stations.find(s=>s.id===id));
  if(stations.some(s=>!s||s.mode!==mode))return result(false,mode==='water'?'Choose two ports for a ship route.':mode==='air'?'Choose two airports for a flight.':`Both stops must be ${stopKind(mode)}s.`);
  if(mode==='air'&&!isTownTraffic(cargo))return result(false,'Planes carry passengers and mail.');
  if(isTownTraffic(cargo)) {
    if(!passengerEndpoints(game,...stations))return result(false,mode==='air'?`Airports must serve two different towns within ${AIRPORT_REACH} tiles.`:cargo==='mail'?'Mail stops must serve two different towns within 5 tiles.':'Passenger stops must serve two different towns within 5 tiles.');
  } else if(!freightPair(game,stations[0],stations[1],cargo)) {
    if(freightPair(game,stations[1],stations[0],cargo))stations.reverse();
    else return result(false,workshopLoop(game,...stations.map(stop=>stationCoverage(game,stop)),cargo)||`These stops need a supplier of ${cargoName(cargo)} and a buyer within 5 tiles.`);
  }
  const path=findPath(game,stations[0],stations[1],mode);
  if(!path)return result(false,mode==='water'?'These ports don’t share open water. Choose ports on the same river, lake or sea.':`These stops aren’t joined by ${mode}. Build the missing ${mode==='rail'?'track':'road'}, including any bridge or tunnel, then ${retry}.`);
  if(path.length<3)return result(false,'These stops are too close. Leave at least two tiles of travel between them.');
  if(mode==='air'&&path.length-1<AIRPORT_MIN_TILES)return result(false,`Airports must be at least ${AIRPORT_MIN_TILES} tiles apart for a flight.`);
  return result(true,'',{stations,path});
}
export function addRoute(game,{name,mode='road',stops,cargo='passengers',fullLoad=false}={}) {
  if(typeof fullLoad!=='boolean')return result(false,'Choose on or off.');
  if(fullLoad&&isTownTraffic(cargo))return result(false,'Full load is for freight routes.');
  const plan=planRoute(game,{mode,stops,cargo});if(!plan.ok)return plan;
  const {stations,path}=plan;
  if(game.vehicles.length>=MAX_VEHICLES)return result(false,FLEET_FULL);
  const purchase=getVehiclePurchase(game,mode),cost=purchase.cost;if(game.money<cost)return result(false,`Need ${moneyText(cost)} to buy this ${vehicleNoun(mode,cargo)}.`);
  const line=nextLineColor(game,stations.map(s=>s.id));
  const route={id:makeId(game,'route'),name:String(name||defaultRouteName(game,stations,cargo)).slice(0,100),number:nextRouteNumber(game),mode,stops:stations.map(s=>s.id),cargo,delivered:0,revenue:0,expenses:0,profitThisYear:0,accountingStartDay:game.day,revenueAtAccountingStart:0,color:line.fill,path,active:true,status:'Running',pathRevision:game.networkRevision||0};if(fullLoad)route.fullLoad=true;
  // The first plane starts at its stand, ready to taxi out.
  const vehicle={id:makeId(game,'vehicle'),routeId:route.id,x:path[0].x,y:path[0].y,angle:0,load:0,capacity:purchase.capacity,level:purchase.level,paidPrice:cost,progress:0,direction:1,totalDistance:0,dwellRemaining:mode==='air'?AIR_DEPARTURE_DWELL:0,tripSerial:0,loadedDay:Math.floor(game.day)};
  spend(game,cost);game.routes.push(route);game.vehicles.push(vehicle);beginFullLoadWait(route,vehicle,0,loadVehicle(game,route,vehicle,0),game.day);game.revision++;
  return result(true,`Route launched: ${route.name}.${spent(cost)}`,{route,cost});
}
// An edit moves a service to new stops or another freight without selling its vehicles. Nothing is
// bought or sold; the card counts the new service afresh, and a new cargo leaves the old load behind.
export function editRoute(game,routeId,{stops,cargo}={}) {
  const route=game.routes.find(r=>r.id===routeId);if(!route)return result(false,'Route not found.');
  if(cargo!==route.cargo&&(cargo==='mail'||route.cargo==='mail'))return result(false,'Mail needs its own route. Launch a new one instead.');
  if(cargo!==route.cargo&&(cargo==='passengers'||route.cargo==='passengers'))return result(false,'Passenger and freight vehicles differ. Launch a new route instead.');
  const plan=planRoute(game,{mode:route.mode,stops,cargo},'try again');if(!plan.ok)return plan;
  const [a,b]=plan.stations,changed=cargo!==route.cargo;
  if(!changed&&a.id===route.stops[0]&&b.id===route.stops[1])return result(false,'Nothing to change.');
  // A plane keeps its share of the flight, so one on the ground stays at its terminal.
  if(route.mode==='air'){const oldMax=route.path.length-1,newMax=plan.path.length-1;for(const vehicle of fleetIndex(game).vehiclesByRoute.get(route.id)||[])vehicle.progress=vehicle.progress/oldMax*newMax;}
  const old=route.path;route.stops=[a.id,b.id];route.path=plan.path;route.pathRevision=game.networkRevision||0;route.active=true;route.status='Running';
  if(route.mode!=='air')snapVehiclesToPath(game,route,old);
  // A queue at the old start leaves; the route keeps its full-load order for the next arrivals where it loads.
  for(const vehicle of fleetIndex(game).vehiclesByRoute.get(route.id)||[])if(waitingForFullLoad(vehicle))vehicle.fullLoadSince=null;
  if(changed){route.cargo=cargo;for(const vehicle of fleetIndex(game).vehiclesByRoute.get(route.id)||[])vehicle.load=0;}
  // Cargo aboard is dispatched afresh from the edited route, and its trip times start over.
  restartCargoClocks(game,route,game.day);clearRouteTransit(game,route.id);
  route.revenueAtAccountingStart=route.revenue;route.expenses=0;route.accountingStartDay=game.day;
  // A new routes array also retires the cached upkeep shares and fleet index.
  game.routes=game.routes.slice();game.revision++;
  return result(true,`Route updated: ${route.name} now ${changed?`carries ${cargoName(cargo)}`:'runs'} from ${a.name} to ${b.name}.`,{route});
}
export function removeRoute(game,routeId) {
  const route=game.routes.find(r=>r.id===routeId);if(!route)return result(false,'Route not found.');
  const refund=getRetirementRefund(game,routeId);
  game.routes=game.routes.filter(r=>r.id!==routeId);game.vehicles=game.vehicles.filter(v=>v.routeId!==routeId);game.money+=refund;game.revision++;
  clearRouteTransit(game,routeId);
  return result(true,`Route retired: ${route.name}.${refund>0?` ${money(refund,{compact:true})} refunded.`:''}`,{refund});
}
// Players name stops and routes freely, duplicates included, within the route form's 36 characters.
const NAME_LENGTH=36;
function renameEntry(game,entry,name) {
  const next=String(name??'').trim();
  if(!next)return result(false,'Enter a name.');
  if(next.length>NAME_LENGTH)return result(false,`Keep names to ${NAME_LENGTH} characters.`);
  if(next===entry.name)return result(false,'That is already its name.');
  entry.name=next;noteBookkeeping(game);
  return result(true,`Renamed to ${next}.`);
}
export function renameStation(game,id,name) { const station=game.stations.find(s=>s.id===id);return station?renameEntry(game,station,name):result(false,'Stop not found.'); }
export function renameRoute(game,id,name) { const route=game.routes.find(r=>r.id===id);return route?renameEntry(game,route,name):result(false,'Route not found.'); }
// Every route runs one or more vehicles. The fleet caps at 10,000 so saves stay valid.
export { vehicleNoun } from './copy.js';
export const MAX_VEHICLES=10000;
const FLEET_FULL='Your fleet has reached 10,000 vehicles.';
const saleValue=(route,vehicle)=>Math.round((vehicle.paidPrice??VEHICLE_COSTS[route.mode])*.45);
// Selling loses the least: the oldest generation, then the emptiest, then the latest in line.
function sellCandidate(vehicles) { let pick=null;for(const v of vehicles)if(!pick||vehicleLevel(v)<vehicleLevel(pick)||vehicleLevel(v)===vehicleLevel(pick)&&v.load<=pick.load)pick=v;return pick; }
export function getRetirementRefund(game,routeId) {
  const index=fleetIndex(game),route=index.routeById.get(routeId);
  return route?(index.vehiclesByRoute.get(routeId)||[]).reduce((sum,v)=>sum+saleValue(route,v),0):0;
}
export function getRouteFleet(game,routeId) {
  const index=fleetIndex(game),route=index.routeById.get(routeId),vehicles=route?index.vehiclesByRoute.get(routeId)||[]:[],{levels,minLevel,maxLevel}=fleetLevels(vehicles),pick=sellCandidate(vehicles);
  return {count:vehicles.length,capacity:vehicles.reduce((sum,v)=>sum+v.capacity,0),load:vehicles.reduce((sum,v)=>sum+v.load,0),minLevel,maxLevel,levels,sellRefund:pick?saleValue(route,pick):0};
}
// A round trip is a loop of 2L tiles: out along the path, then back. A new vehicle
// takes the middle of the widest gap in that loop, so a bought fleet never runs as a convoy.
export function addRouteVehicle(game,routeId) {
  const index=fleetIndex(game),route=index.routeById.get(routeId);if(!route)return result(false,'Route not found.');
  if(!route.active)return result(false,`This route isn’t connected. Repair it before adding ${vehicleNoun(route.mode,route.cargo,2)}.`);
  if(game.vehicles.length>=MAX_VEHICLES)return result(false,FLEET_FULL);
  const noun=vehicleNoun(route.mode,route.cargo),purchase=getVehiclePurchase(game,route.mode),cost=purchase.cost;
  if(game.money<cost)return result(false,`Need ${moneyText(cost)} to add a ${noun}.`);
  const L=route.path.length-1,cycle=2*L,phases=(index.vehiclesByRoute.get(route.id)||[]).map(v=>((v.direction===1?v.progress:cycle-v.progress)%cycle+cycle)%cycle).sort((a,b)=>a-b);
  let start=0,gap=cycle;
  for(let i=0;i<phases.length;i++){const span=(i+1<phases.length?phases[i+1]:phases[0]+cycle)-phases[i];if(i===0||span>gap+1e-9){start=phases[i];gap=span;}}
  const middle=phases.length?(start+gap/2)%cycle:0;
  let progress=middle<=L?middle:cycle-middle,direction=middle<=L?1:-1,stop=-1;
  // Within half a tile of a stop, start there as if just loaded and departing.
  if(progress<=.5){progress=0;direction=1;stop=0;}else if(progress>=L-.5){progress=L;direction=-1;stop=1;}
  const at=Math.min(Math.floor(progress),L-1),a=route.path[at],b=route.path[at+1],fraction=progress-at;
  const vehicle={id:makeId(game,'vehicle'),routeId:route.id,x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction,angle:Math.atan2((b.y-a.y)*direction,(b.x-a.x)*direction),load:0,capacity:purchase.capacity,level:purchase.level,paidPrice:cost,progress,direction,totalDistance:0,dwellRemaining:route.mode==='air'&&stop>=0?AIR_DEPARTURE_DWELL:0,tripSerial:0,loadedDay:Math.floor(game.day)};
  // A plane flies the straight chord: one started mid-flight appears at its place in the air.
  placeVehicle(route,vehicle);
  spend(game,cost);game.vehicles.push(vehicle);if(stop>=0)beginFullLoadWait(route,vehicle,stop,loadVehicle(game,route,vehicle,stop),game.day);noteBookkeeping(game);
  return result(true,`${capital(noun)} added to ${route.name}.${spent(cost)}`,{vehicle,cost});
}
export function sellRouteVehicle(game,routeId) {
  const index=fleetIndex(game),route=index.routeById.get(routeId);if(!route)return result(false,'Route not found.');
  const vehicles=index.vehiclesByRoute.get(route.id)||[];
  if(vehicles.length<=1)return result(false,`A route keeps at least one ${vehicleNoun(route.mode,route.cargo)}. Retire the route to sell its last one.`);
  const vehicle=sellCandidate(vehicles),refund=saleValue(route,vehicle);
  game.vehicles=game.vehicles.filter(v=>v!==vehicle);game.money+=refund;noteBookkeeping(game);
  return result(true,`${capital(vehicleNoun(route.mode,route.cargo))} sold from ${route.name}. ${moneyText(refund)} refunded.`,{vehicle,refund});
}
// Full load, Transport Tycoon's order: optional, off for every route and for freight only. A vehicle that reaches the
// stop where it loads short of full waits there, the earliest arrival first, until it is full, nothing there can supply
// it or a month has passed. route.fullLoad is written only once turned on; vehicle.fullLoadSince holds the day a wait
// began and turns null when it ends. Neither is ever deleted, so fleets keep their object shapes in the hot loops.
export const FULL_LOAD_MAX_WAIT=30;
export function waitingForFullLoad(v) { return typeof v?.fullLoadSince==='number'; }
export function setRouteFullLoad(game,routeId,on) {
  const route=game.routes.find(r=>r.id===routeId);if(!route)return result(false,'Route not found.');
  if(typeof on!=='boolean')return result(false,'Choose on or off.');
  if(isTownTraffic(route.cargo))return result(false,'Full load is for freight routes.');
  if((route.fullLoad===true)===on)return result(false,'Nothing to change.');
  const index=fleetIndex(game),nouns=capital(vehicleNoun(route.mode,route.cargo,2)),start=index.stationById.get(route.stops[0]);
  route.fullLoad=on;
  if(!on)for(const vehicle of index.vehiclesByRoute.get(route.id)||[])if(waitingForFullLoad(vehicle))vehicle.fullLoadSince=null;
  noteBookkeeping(game);
  return result(true,on?`${nouns} on ${route.name} wait at ${start?.name||'their first stop'} for a full load, for a month at most.`:`${nouns} on ${route.name} leave as soon as they have loaded.`,{route});
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
// The town whose workshops made a delivered product: only when no industry at the loading stop makes it, the first town there
// that loadVehicle would take it from (not one the end stop reaches) and that still makes it. Otherwise no town is credited.
function workshopMaker(game,route,destination,context) {
  const start=context?context.stations.get(route.stops[0]):game.stations.find(s=>s.id===route.stops[0]),source=start&&journeyCoverage(game,start,context);
  if(!source||source.industries.some(industry=>INDUSTRIES[industry.kind].outputs[route.cargo]))return null;
  return source.cities.find(city=>!destination.cities.includes(city)&&workshopOutputs(game,city).includes(route.cargo))||null;
}
// Returns the sources a freight start has: the covered industries that make its cargo, whatever their stock, or,
// without one, the towns whose workshops could load it here. Anywhere else 0; a full-load wait needs a source.
function loadVehicle(game,route,vehicle,stopIndex,context,day=game.day) {
  const station=context?context.stations.get(route.stops[stopIndex]):game.stations.find(s=>s.id===route.stops[stopIndex]);if(!station)return 0;
  const before=vehicle.load;
  let free=vehicle.capacity-vehicle.load,sources=0;
  if(isTownTraffic(route.cargo)) {
    const endpoints=journeyEndpoints(game,route,context),pool=route.cargo;
    for(const city of endpoints?[endpoints[stopIndex]]:[]) {
      const amount=Math.min(free,Math.floor(city[pool]||0));
      city[pool]=(city[pool]||0)-amount;vehicle.load+=amount;free-=amount;city.activity+=amount*.18;
      if(free<=0)break;
    }
  } else if(stopIndex===0) {
    const coverage=journeyCoverage(game,station,context);
    for(const industry of coverage.industries) {
      if(!INDUSTRIES[industry.kind].outputs[route.cargo])continue;
      sources++;if(free<=0)continue;
      const amount=Math.min(free,Math.floor(industry.inventory[route.cargo]||0));
      industry.inventory[route.cargo]-=amount;industry.shipped+=amount;industry.activity+=amount;vehicle.load+=amount;free-=amount;
    }
    // Then towns' workshop products, only for a different town, as freightFits reads the two stops.
    if(free>0&&coverage.cities.some(city=>city.workshop?.output[route.cargo]>=1)) {
      const end=context?context.stations.get(route.stops[1]):game.stations.find(s=>s.id===route.stops[1]),destination=end?journeyCoverage(game,end,context):null;
      for(const city of destination?coverage.cities:[]) {
        const amount=destination.cities.includes(city)?0:Math.min(free,Math.floor(city.workshop?.output[route.cargo]||0));
        if(amount<=0)continue;
        city.workshop.output[route.cargo]-=amount;vehicle.load+=amount;free-=amount;
        if(free<=0)break;
      }
    }
    if(!sources&&coverage.produces.includes(route.cargo)){const end=context?context.stations.get(route.stops[1]):game.stations.find(s=>s.id===route.stops[1]),destination=end?journeyCoverage(game,end,context):null;for(const city of destination?coverage.cities:[])if(!destination.cities.includes(city)&&workshopOutputs(game,city).includes(route.cargo))sources++;}
  }
  // The boarding day of what is aboard: a load-weighted mean when a load is topped up, so a wait counts.
  if(vehicle.load>before){const boarded=Math.floor(day);vehicle.loadedDay=before>0&&vehicle.loadedDay!==undefined?(vehicle.loadedDay*before+boarded*(vehicle.load-before))/vehicle.load:boarded;}
  return sources;
}
// A freight vehicle that reaches its loading stop short of full starts to wait there when its route asks for a full load
// and something there can supply it: from the arrival time, or the day it was bought.
function beginFullLoadWait(route,vehicle,stopIndex,sources,day){if(route.fullLoad===true&&!isTownTraffic(route.cargo)&&stopIndex===0&&sources>0&&vehicle.load<vehicle.capacity)vehicle.fullLoadSince=day;}
// The shortest connected path, capped at twice the stops' grid distance, sets the fare; loops and detours cannot manufacture income.
// Days on the way (undefined for legacy cargo) keep a share of it: see transitPay.
export function fareFor(game,cargo,pathLength,units,day=game.day,transitDays) { return priceFor(game,units*CARGO[cargo].price*distancePay(pathLength-1)*transitPay(cargo,transitDays),day); }
// Paid deliveries for the map's floating income: never saved, never keyed by nextId or randomAt.
const deliveryLog=new WeakMap();
export function drainDeliveryEvents(game) { const log=deliveryLog.get(game)||[];deliveryLog.delete(game);return log; }
// Recent days on the way per route, for the route cards: never saved, never keyed by nextId or randomAt.
const transitLog=new WeakMap();
function recordTransit(game,route,days){let m=transitLog.get(game);if(!m)transitLog.set(game,m=new Map());let r=m.get(route.id);if(!r)m.set(route.id,r=[]);r.push(days);if(r.length>8)r.shift();}
function clearRouteTransit(game,routeId){transitLog.get(game)?.delete(routeId);}
export function recentTransitDays(game,routeId){const r=transitLog.get(game)?.get(routeId);return r?.length?r.reduce((s,d)=>s+d,0)/r.length:null;}
// Cargo aboard a route that runs again (repaired or edited) is dispatched afresh: its clock restarts.
function restartCargoClocks(game,route,day){const today=Math.floor(day);for(const v of fleetIndex(game).vehiclesByRoute.get(route.id)||[])if(v.load>0)v.loadedDay=today;}
function unloadVehicle(game,route,vehicle,stopIndex,arrivalDay=game.day,context) {
  if(vehicle.load<=0)return;
  let bonusUnits=0,receiver=null,works=null,worksUnits=0,maker=null;
  const station=context?context.stations.get(route.stops[stopIndex]):game.stations.find(s=>s.id===route.stops[stopIndex]);if(!station)return;
  let remaining=vehicle.load,delivered=0;
  if(isTownTraffic(route.cargo)) {
    const endpoints=journeyEndpoints(game,route,context);if(!endpoints)return;
    const city=endpoints[stopIndex];city.activity+=remaining;city.delivered+=remaining;city.lastServiceDay=arrivalDay;if(route.cargo==='passengers')recordVisitors(game,city,remaining);delivered=remaining;remaining=0;
  } else if(stopIndex===1) {
    const coverage=journeyCoverage(game,station,context);
    let buyer=null;
    for(const industry of coverage.industries) {
      if(!INDUSTRIES[industry.kind].inputs[route.cargo])continue;
      buyer??=industry;
      const available=Math.max(0,MAX_INVENTORY*industry.capacity-(industry.inventory[route.cargo]||0));
      const amount=Math.min(remaining,available);
      industry.inventory[route.cargo]=(industry.inventory[route.cargo]||0)+amount;
      industry.received+=amount;industry.activity+=amount;remaining-=amount;delivered+=amount;
      if(remaining<=0)break;
    }
    // Workshop materials: the first town here with workshops takes and pays for everything left, whatever fits its store.
    if(remaining>0&&workshopRecipes(game).some(recipe=>recipe.input===route.cargo))for(const city of coverage.cities)if(workshopInputs(game,city).includes(route.cargo)){acceptWorkshopInput(game,city,route.cargo,remaining);city.delivered+=remaining;city.lastServiceDay=arrivalDay;delivered+=remaining;works=city;worksUnits=remaining;remaining=0;break;}
    if(remaining>0&&TOWN_CARGO.includes(route.cargo)&&coverage.cities.length) {
      const city=coverage.cities[0];city.supplies+=remaining;city.activity+=remaining*.7;city.delivered+=remaining;city.lastServiceDay=arrivalDay;delivered+=remaining;receiver=city;bonusUnits+=recordTownSupply(game,city,route.cargo,remaining);remaining=0;
      (city.lastSupply??={})[route.cargo]=arrivalDay;
    }
    // A buyer that lists the cargo takes and pays for the rest too; its store keeps only what fits, and only stored cargo adds activity.
    if(remaining>0&&buyer){buyer.received+=remaining;delivered+=remaining;remaining=0;}
    if(delivered>0&&workshopRecipes(game).some(recipe=>recipe.output===route.cargo))maker=workshopMaker(game,route,coverage,context);
  }
  vehicle.load=remaining;
  if(delivered>0) {
    const transit=vehicle.loadedDay===undefined?undefined:Math.max(0,Math.floor(arrivalDay)-vehicle.loadedDay);
    if(transit!==undefined)recordTransit(game,route,transit);
    // Wanted town cargo earns the market bonus on the wanted units: the delivery's own per-unit fare, so distance, days and prices carry over. Contracts pay on the fare alone.
    const fare=fareFor(game,route.cargo,payTiles(route.path)+1,delivered,arrivalDay,transit),bonus=bonusUnits>0?Math.round(MARKET.bonus*fare*bonusUnits/delivered):0,revenue=fare+bonus+(game.contracts?contractBonus(game,route,fare,arrivalDay,site=>journeyCoverage(game,site,context)):0);
    if(bonus>0){route.marketBonus=(route.marketBonus||0)+bonus;receiver.market.bonus+=bonus;game.monthlyMarketBonus=(game.monthlyMarketBonus||0)+bonus;}
    // A town's workshop freight: its workshops' share of a materials load by units, or products only they could have made, less the market bonus.
    if(works)recordWorksFreight(works,Math.round(revenue*worksUnits/delivered));else if(maker)recordWorksFreight(maker,revenue-bonus);
    route.delivered+=delivered;route.revenue+=revenue;game.totalDelivered+=delivered;game.totalRevenue+=revenue;game.monthlyIncome+=revenue;game.money+=revenue;
    if(game.achievements)noteDelivery(game.achievements,route.cargo);
    route.profitThisYear=(route.profitThisYear??0)+revenue;
    let log=deliveryLog.get(game);if(!log)deliveryLog.set(game,log=[]);
    if(log.length<64)log.push({x:station.x,y:station.y,revenue,cargo:route.cargo,amount:delivered,routeId:route.id,day:arrivalDay});
  }
}
// Each vehicle steps from its steady-pace place on the old path onto the nearest tile of the route's new path,
// keeping its direction and load.
function snapVehiclesToPath(game,route,old) {
  const path=route.path;
  for(const vehicle of fleetIndex(game).vehiclesByRoute.get(route.id)||[]) {
    const at=old.length>1?pathPoint(old,vehicle.progress):vehicle;let nearest=0,best=Infinity;
    for(let i=0;i<path.length;i++) {const d=distance(at,path[i]);if(d<best){best=d;nearest=i;}}
    vehicle.progress=nearest;placeVehicle(route,vehicle);
  }
}
// A live path found at pathRevision stays exact when every cell c changed since lies at |a−c|+|c−b| > L+2
// for its stops a, b and length L. Network edits never move heights or water, and terraforming never moves
// a network tile's corners, so only edges touching c changed. Long trips use A*, which pops only nodes with |a−n|+|n−b| ≤ g+h ≤ L and reads their four
// neighbours, so it never reads c and repeats the old search step for step. Breadth-first search floods the
// whole ball and may read c, but c can alter a node's level, parent or queue order only at a level k ≥ |a−c|
// and within k−|a−c| tiles of c. Path node i lies within L−i tiles of b, so that needs |a−c|+|c−b| ≤ L.
function unaffectedPath(game,route,a,b) {
  const path=route.path,end=path?.at(-1);
  if(!route.active||route.status!=='Running'||!a||!b||!(path?.length>1)||path[0].x!==a.x||path[0].y!==a.y||end.x!==b.x||end.y!==b.y)return false;
  const changes=networkChangesSince(game,route.pathRevision);if(!changes)return false;
  const reach=path.length+1,width=game.width;
  for(let i=0;i<changes.length;i++){const x=changes[i]%width,y=(changes[i]-x)/width;if(Math.abs(a.x-x)+Math.abs(a.y-y)+Math.abs(x-b.x)+Math.abs(y-b.y)<=reach)return false;}
  return true;
}
function updateRoutePath(game,route) {
  const networkRevision=game.networkRevision||0;
  if(route.pathRevision===networkRevision)return;
  // A flight depends only on its airports, which never move: no network change can reroute it.
  if(route.mode==='air'&&route.active&&route.path.length>1){const [a,b]=route.stops.map(id=>fleetIndex(game).stationById.get(id)),last=route.path[route.path.length-1];if(a&&b&&route.path[0].x===a.x&&route.path[0].y===a.y&&last.x===b.x&&last.y===b.y){route.pathRevision=networkRevision;return;}}
  const [a,b]=route.stops.map(id=>fleetIndex(game).stationById.get(id));
  if(unaffectedPath(game,route,a,b)){route.pathRevision=networkRevision;return;}
  const path=a&&b?findPath(game,a,b,route.mode):null;
  const wasActive=route.active;
  route.active=Boolean(path);route.pathRevision=networkRevision;
  const cut=name=>route.mode==='water'?`${name} is no longer connected by water. Ports need a continuous waterway.`:`${name} is no longer connected. Rebuild the missing ${route.mode==='rail'?'track':'road'}, including any bridge or tunnel.`;
  if(!path) {route.status='Disconnected';if(wasActive)notify(game,cut(route.name),'warning',{topic:'route-connection',target:{kind:'route',id:route.id},template:cut(token('route',route.id))});return;}
  route.status='Running';
  if(!wasActive)restartCargoClocks(game,route,game.day);
  const changed=route.path.length!==path.length||route.path.some((p,i)=>p.x!==path[i].x||p.y!==path[i].y);
  const old=route.path;route.path=path;
  if(changed)snapVehiclesToPath(game,route,old);
}
export function refreshRouteConnections(game) { for(const route of game.routes)updateRoutePath(game,route); }
// Where an offline route's last path first fails the pathfinder's own tile and edge rules; the midpoint when the gap is elsewhere.
export function routeBreakPoint(game,route) {
  const path=route?.path;if(!route||route.mode==='air'||route.active!==false||!path?.length)return null;
  for(let i=0;i<path.length;i++){
    const p=path[i],t=tileAt(game,p.x,p.y),a=path[i-1];
    if(!validNetwork(t,route.mode||'road')||a&&!networkEdgeAllowed(tileAt(game,a.x,a.y),t,p.x-a.x,p.y-a.y,route.mode||'road',game,a.x,a.y))return{x:p.x,y:p.y,index:i};
  }
  const middle=Math.floor(path.length/2);return{x:path[middle].x,y:path[middle].y,index:middle};
}
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
  if(route.mode==='air'){
    const key=`${vehicle.id}:air`;if(cache.speeds.has(key))return cache.speeds.get(key);
    // The saved staircase is Manhattan; each unit step covers straight/manhattan of a tile, so ground speed is constant.
    const first=route.path[0],last=route.path[route.path.length-1],manhattan=route.path.length-1,straight=Math.hypot(last.x-first.x,last.y-first.y)||manhattan;
    const climate=weatherAt(game,Math.round((first.x+last.x)/2),Math.round((first.y+last.y)/2),day),variation=.94+randomAt(game,day,vehicle.id,511)*.12;
    const speed=VEHICLE_SPEEDS.air*(manhattan/straight)*(.55+climate.travel*.45)*variation*vehicleSpeedMultiplier(vehicleLevel(vehicle));
    cache.speeds.set(key,speed);return speed;
  }
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
    const speed=VEHICLE_SPEEDS.water*channel*passage*climate.travel*(1-climate.cold*.12)*variation*(1-Math.min(.18,Math.max(0,traffic-1)*.035)+Math.min(.045,support))*vehicleSpeedMultiplier(vehicleLevel(vehicle));
    cache.speeds.set(key,speed);return speed;
  }
  let congestion=0,support=0;
  for(const city of nearbyCities(game,a.x,a.y,5)){const d=Math.hypot(city.x-a.x,city.y-a.y);if(d<5)congestion+=Math.min(.15,city.population/10000)*(1-d/6);}
  const supportingSites=new Set();
  for(const [dx,dy]of DIRECTIONS){const site=buildingAt(game,a.x+dx,a.y+dy),kind=site?.building.kind;if((kind==='service-garage'||kind==='police-station')&&!supportingSites.has(site.building)){supportingSites.add(site.building);support+=.035;}}
  const terrain=(ta.bridge||tb.bridge)?.8:(ta.tunnel||tb.tunnel)?.88:1;
  const grade=1-Math.min(.16,Math.abs(transportElevation(ta)-transportElevation(tb))*.4);
  const dailyVariation=.94+randomAt(game,day,vehicle.id,511)*.12;
  const speed=VEHICLE_SPEEDS[route.mode]*terrain*grade*climate.travel*dailyVariation*(1-clamp(congestion,0,route.mode==='road'?.22:.06)+Math.min(.07,support))*vehicleSpeedMultiplier(vehicleLevel(vehicle));
  cache.speeds.set(key,speed);return speed;
}
// A trajectory has no economic side effects. Stop at its next arrival so that
// the fleet can commit cargo transfers in time order, even for a large tick.
function travelPlan(game,route,vehicle,days){
  const state={progress:vehicle.progress,totalDistance:vehicle.totalDistance||0,dwellRemaining:vehicle.dwellRemaining||0};
  const max=route.path.length-1,endpoint=vehicle.direction===1?max:0;
  // A vehicle waiting for a full load holds still, its dwell kept for after. It falls through with no time to spend
  // rather than returning, so anything the tail counts per day on the way still counts the wait.
  const waiting=waitingForFullLoad(vehicle);
  let remaining=waiting?0:days,elapsed=0;
  if(state.dwellRemaining>0){const wait=Math.min(remaining,state.dwellRemaining);state.dwellRemaining=Math.max(0,state.dwellRemaining-wait);remaining-=wait;elapsed+=wait;}
  while(remaining>1e-10&&Math.abs(state.progress-endpoint)>1e-9){
    const segment=clamp(vehicle.direction===1?Math.floor(state.progress+1e-9):Math.ceil(state.progress-1e-9)-1,0,max-1);
    const speed=travelSpeed(game,route,vehicle,segment),boundary=vehicle.direction===1?segment+1:segment,space=Math.abs(boundary-state.progress),duration=space/speed;
    if(remaining+1e-12>=duration){state.progress=boundary;state.totalDistance+=space;remaining=Math.max(0,remaining-duration);elapsed+=duration;}
    else{const step=remaining*speed;state.progress+=step*vehicle.direction;state.totalDistance+=step;elapsed+=remaining;remaining=0;}
  }
  const arrived=!waiting&&state.dwellRemaining<=0&&Math.abs(state.progress-endpoint)<1e-9;
  if(arrived)state.progress=endpoint;
  return {state,elapsed:arrived?elapsed:days,arrived};
}
function arriveVehicle(game,route,vehicle,arrivalDay,context){
  const stopIndex=vehicle.direction===1?1:0;
  // Anything still aboard (a full buyer) is dispatched again from here: its clock restarts.
  unloadVehicle(game,route,vehicle,stopIndex,arrivalDay,context);if(vehicle.load>0)vehicle.loadedDay=Math.floor(arrivalDay);const sources=loadVehicle(game,route,vehicle,stopIndex,context,arrivalDay);vehicle.direction*=-1;vehicle.tripSerial=(vehicle.tripSerial||0)+1;
  // A plane's visit is a fixed ground timeline: landing roll, taxi, boarding, taxi and take-off.
  if(route.mode==='air'){vehicle.dwellRemaining=AIR_TURNAROUND;return;}
  const stop=context?context.stations.get(route.stops[stopIndex]):game.stations.find(s=>s.id===route.stops[stopIndex]);
  let e=context?.environments.get(stop);
  if(!e){e=localEnvironment(game,stop.x,stop.y,2);context?.environments.set(stop,e);}
  vehicle.dwellRemaining=(.05+randomAt(game,Math.floor(arrivalDay),vehicle.id,500+vehicle.tripSerial)*.13)*(route.mode==='water'?1.8:1)*(1+vehicle.load/vehicle.capacity*.5)/(1+e.access*.35+e.services*.06);
  // A full-load wait holds the vehicle here; the dwell just drawn runs once the wait is over.
  beginFullLoadWait(route,vehicle,stopIndex,sources,arrivalDay);
}
// Buses, trucks, trains and ships pull away from a stop and brake into the next: where a vehicle is drawn eases over
// the first and last stretch of each trip (s(u) = 2u² − u³, so it leaves from rest and rejoins the steady pace), and
// makes up the lag just after. Progress, arrivals, travel days and fares keep the steady pace; only x and y ease.
const EASE_TILES={road:.8,rail:1.6,water:1.2};
// The steady-pace point at a progress along a ground path. The simulation reads this, never a vehicle's drawn x and y.
function pathPoint(path,progress){const index=Math.min(Math.floor(progress),path.length-2),fraction=progress-index,a=path[index],b=path[index+1];return{x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction,a,b};}
// Where a vehicle is drawn: a plane on its straight chord, anything else at its eased progress along the path.
function placeVehicle(route,vehicle){
  const max=route.path.length-1;
  if(route.mode==='air'){const first=route.path[0],last=route.path[max],f=vehicle.progress/max;vehicle.x=first.x+(last.x-first.x)*f;vehicle.y=first.y+(last.y-first.y)*f;vehicle.angle=Math.atan2((last.y-first.y)*vehicle.direction,(last.x-first.x)*vehicle.direction);return;}
  const {x,y,a,b}=pathPoint(route.path,shownProgress(route,vehicle));
  vehicle.x=x;vehicle.y=y;vehicle.angle=Math.atan2((b.y-a.y)*vehicle.direction,(b.x-a.x)*vehicle.direction);
}
export function shownProgress(route,vehicle,progress=vehicle.progress){
  const max=route.path.length-1,ease=Math.min(EASE_TILES[route.mode]||0,max/3);if(!(ease>0))return progress;
  const forward=vehicle.direction!==-1,travelled=forward?progress:max-progress,left=max-travelled,s=u=>u*u*(2-u);
  const shown=travelled<ease?ease*s(Math.max(0,travelled)/ease):left<ease?max-ease*s(Math.max(0,left)/ease):travelled;
  return forward?shown:max-shown;
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
  for(const {vehicle,route}of fleet)placeVehicle(route,vehicle);
}
const upkeepShareCache=new WeakMap();
function infrastructureShares(game){
  const revision=game.networkRevision||0,previous=upkeepShareCache.get(game);
  if(previous&&previous.revision===revision&&previous.routes===game.routes&&previous.count===game.routes.length)return previous.shares;
  const users=new Map(),shares=new Map(game.routes.map(route=>[route.id,0]));
  const add=(key,cost,route)=>{if(!cost)return;let entry=users.get(key);if(!entry){entry={cost,routes:new Set()};users.set(key,entry);}entry.routes.add(route.id);};
  for(const route of game.routes){
    if(route.mode==='road'||route.mode==='rail')for(const point of route.path){
      const tile=tileAt(game,point.x,point.y),key=point.y*game.width+point.x;if(!tile?.[route.mode])continue;
      add(`${key}:${route.mode}`,route.mode==='rail'?INFRASTRUCTURE_UPKEEP.rail:tile.publicRoad?0:INFRASTRUCTURE_UPKEEP.road,route);
      if(tile.bridge||tile.tunnel)add(`${key}:structure`,INFRASTRUCTURE_UPKEEP.structure,route);
    }
    for(const id of route.stops){const station=fleetIndex(game).stationById.get(id);if(station)add(`station:${id}`,INFRASTRUCTURE_UPKEEP.stop[station.mode],route);}
  }
  for(const {cost,routes}of users.values())for(const id of routes)shares.set(id,shares.get(id)+cost/routes.size);
  upkeepShareCache.set(game,{revision,routes:game.routes,count:game.routes.length,shares});return shares;
}
// One pass over the network per revision: its upkeep, and the tiles the company built (achievements read those, never the simulation).
const networkCounts=new WeakMap();
function countNetwork(game){
  let upkeep=0,owned=0,structures=0;
  for(const id of networkIndex(game)){const t=game.tiles[id];upkeep+=(t.road&&!t.publicRoad?INFRASTRUCTURE_UPKEEP.road:0)+(t.rail?INFRASTRUCTURE_UPKEEP.rail:0)+((t.bridge||t.tunnel)?INFRASTRUCTURE_UPKEEP.structure:0);if(t.rail||t.road&&!t.publicRoad)owned++;if((t.bridge||t.tunnel)&&(t.rail||!t.publicRoad))structures++;}
  const totals={revision:game.networkRevision||0,tiles:game.tiles,upkeep,owned,structures};networkCounts.set(game,totals);return totals;
}
/** Road and rail tiles the company owns, and its bridge and tunnel tiles; recounted only after a network change. */
export function networkTotals(game){const totals=networkCounts.get(game);return totals&&totals.revision===(game.networkRevision||0)&&totals.tiles===game.tiles?totals:countNetwork(game);}
function maintenance(game) {
  if(game.maintenanceRevision!==(game.networkRevision||0)) {
    let upkeep=0;
    upkeep+=countNetwork(game).upkeep;
    upkeep+=game.stations.reduce((sum,s)=>sum+INFRASTRUCTURE_UPKEEP.stop[s.mode],0);
    game.infrastructureUpkeep=upkeep;game.maintenanceRevision=game.networkRevision||0;
  }
  const day=Math.floor(game.day),center=game.cities[0]||{x:game.width/2,y:game.height/2},weather=weatherAt(game,center.x,center.y,day);
  const routeCosts=new Map(game.routes.map(route=>[route.id,0])),routeIndex=fleetIndex(game).routeById,environments=new Map();
  const fleet=game.vehicles.reduce((sum,v)=>{
    // Upkeep reads the steady-pace place: easing near stops is only drawn.
    const route=routeIndex.get(v.routeId),at=route&&route.mode!=='air'&&route.path.length>1?pathPoint(route.path,v.progress):v;
    const localWeather=weatherAt(game,at.x,at.y,day),key=Math.floor(at.y)*game.width+Math.floor(at.x);
    let e=environments.get(key);if(!e){e=localEnvironment(game,at.x,at.y,2);environments.set(key,e);}
    const support=1-Math.min(.12,e.police*.025+e.services*.015);
    const expense=(VEHICLE_UPKEEP[route?.mode]??VEHICLE_UPKEEP.road)*(route?.active&&!waitingForFullLoad(v)?1:.45)*(.91+randomAt(game,day,v.id,521)*.18)*(1+localWeather.cold*(route?.mode==='water'?.23:.14)+localWeather.heat*.08)*support;
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
    const share=rawTotal>0?Math.floor(expenses*raw/rawTotal):0;route.expenses=(route.expenses||0)+share;route.profitThisYear=(route.profitThisYear??0)-share;
  }
  game.money-=expenses;game.monthlyExpenses+=expenses;game.totalExpenses+=expenses;
  game.monthlyOperatingExpenses=(game.monthlyOperatingExpenses||0)+expenses;
  game.totalOperatingExpenses=(game.totalOperatingExpenses||0)+expenses;
}
// Once a day, after upkeep charged the day by who waited through it, each vehicle waiting for a full load tries its
// stop again, the earliest arrival first. Stock grows only in stepIndustries, so within a day it can only shrink, and
// every split of the day retries at the same boundary. A route that is broken stays frozen; anything else ends the
// wait, and the vehicle leaves after its dwell. No randomness, notices, ids or revisions.
function serveFullLoads(game){
  const vehicles=game.vehicles;let waiting=null;
  for(let i=0;i<vehicles.length;i++)if(typeof vehicles[i].fullLoadSince==='number')(waiting??=[]).push(i);
  if(!waiting)return;
  waiting.sort((a,b)=>vehicles[a].fullLoadSince-vehicles[b].fullLoadSince||a-b);
  const routes=fleetIndex(game).routeById,context=journeyContext(game);
  for(const i of waiting){
    const v=vehicles[i],route=routes.get(v.routeId);
    if(!route||route.fullLoad!==true||isTownTraffic(route.cargo)){v.fullLoadSince=null;continue;}
    if(!route.active)continue;
    if(v.direction!==1||v.progress!==0){v.fullLoadSince=null;continue;}
    const sources=loadVehicle(game,route,v,0,context,game.day);
    if(v.load>=v.capacity||sources===0||game.day-v.fullLoadSince>=FULL_LOAD_MAX_WAIT)v.fullLoadSince=null;
  }
}

// An optional credit line in 1950 dollars: no due date, no automatic borrowing or repayment, and a
// flat monthly rate on what is owed. Loans are financing, so they are neither income nor expense.
const LOAN_STEP=50000,LOAN_LIMIT=250000,LOAN_MONTHLY_RATE=.005;
export function loanTerms(game) {
  const loan=game.loan||0,step=priceFor(game,LOAN_STEP),limit=priceFor(game,LOAN_LIMIT),next=Math.max(0,Math.min(step,limit-loan));
  return {loan,step,limit,rate:LOAN_MONTHLY_RATE,monthlyInterest:Math.round(loan*LOAN_MONTHLY_RATE),borrow:next,borrowInterest:Math.round(next*LOAN_MONTHLY_RATE),repay:Math.min(step,loan)};
}
export function borrow(game) {
  const {loan,borrow:amount}=loanTerms(game);
  if(amount<=0)return result(false,'Your credit line is fully used.');
  game.loan=loan+amount;game.money+=amount;noteBookkeeping(game);
  return result(true,`Borrowed ${moneyText(amount)}. Interest is ${moneyText(Math.round(game.loan*LOAN_MONTHLY_RATE))} a month.`,{amount});
}
export function repay(game) {
  const {loan,repay:amount}=loanTerms(game);
  if(loan<=0)return result(false,'No loan to repay.');
  if(game.money<amount)return result(false,`Need ${moneyText(amount)} to repay.`);
  game.money-=amount;game.loan=loan-amount;if(!game.loan)delete game.loan;noteBookkeeping(game);
  return result(true,game.loan?`Repaid ${moneyText(amount)}. ${moneyText(game.loan)} still owed.`:`Repaid ${moneyText(amount)}. Your loan is cleared.`,{amount});
}
// Closing December sums the year's months; the best route earned the most this year (its profitThisYear, before the rollover).
function closeYear(game) {
  const year=Math.floor(game.lastMonth/12),months=game.history.filter(h=>Math.floor(h.month/12)===year),before=game.history[game.history.indexOf(months[0])-1];
  let bestRouteId=null,best=0;
  for(const route of game.routes){const net=route.profitThisYear??0;if(net>best){best=net;bestRouteId=route.id;}}
  (game.annual??=[]).push({year:1950+year,revenue:months.reduce((sum,h)=>sum+h.income,0),operatingProfit:months.reduce((sum,h)=>sum+(h.operatingProfit??h.profit),0),delivered:months.at(-1).delivered-(before?.delivered??0),population:months.at(-1).population,routes:game.routes.length,bestRouteId});
  const property=months.reduce((sum,h)=>sum+(h.property||0),0);if(property>0)game.annual.at(-1).property=property;
  if(game.annual.length>200)game.annual.shift();
}
// The town hall: an optional purchase that runs silently to its end, with no upkeep, reminder or notice.
export function buyTownAction(game,cityId,action) {
  if(!owns(TOWN_ACTIONS,action))return result(false,'Choose a town action.');
  const city=game.cities.find(c=>c.id===cityId);if(!city)return result(false,'Town not found.');
  const quote=townActionQuote(game,city,action),advertise=action==='advertise';
  if(quote.active)return result(false,advertise?`An advertising campaign is already running in ${city.name}.`:`Development is already funded in ${city.name}.`);
  if(!quote.affordable)return result(false,`Need ${moneyText(quote.cost)} to ${advertise?'advertise':'fund development'} in ${city.name}.`);
  const until=Math.floor(game.day)+quote.days;spend(game,quote.cost);city[advertise?'advertisedUntil':'fundedUntil']=until;
  return result(true,`${advertise?`Advertising in ${city.name} for six months.`:`Development funded in ${city.name} for a year.`}${spent(quote.cost)}`,{cost:quote.cost,until});
}
function monthlyUpdate(game) {
  monthlyMarkets(game);
  const interest=Math.round((game.loan||0)*LOAN_MONTHLY_RATE);
  if(interest){game.money-=interest;game.monthlyExpenses+=interest;game.totalExpenses+=interest;game.monthlyOperatingExpenses=(game.monthlyOperatingExpenses||0)+interest;game.totalOperatingExpenses=(game.totalOperatingExpenses||0)+interest;}
  game.lastMonthlyProfit=game.monthlyIncome-game.monthlyExpenses;
  game.lastMonthlyOperatingProfit=game.monthlyIncome-(game.monthlyIncomeAtAccountingStart||0)-(game.monthlyOperatingExpenses||0);
  game.history.push({month:game.lastMonth,day:Math.floor(game.day),income:game.monthlyIncome,expenses:game.monthlyExpenses,operatingExpenses:game.monthlyOperatingExpenses||0,operatingProfit:game.lastMonthlyOperatingProfit,profit:game.lastMonthlyProfit,money:game.money,population:game.cities.reduce((sum,c)=>sum+c.population,0),delivered:game.totalDelivered,...game.monthlyMarketBonus>0?{marketBonus:game.monthlyMarketBonus}:{},...game.monthlyProperty>0?{property:game.monthlyProperty}:{}});
  delete game.monthlyMarketBonus;delete game.monthlyProperty;
  if(game.history.length>36)game.history.shift();
  // Each town keeps its last four counts, so the inspector can show recent growth.
  for(const city of game.cities){(city.popHistory??=[]).push(Math.floor(city.population));if(city.popHistory.length>4)city.popHistory.shift();}
  if(game.lastMonth%12===11)closeYear(game);
  if(game.lastMonth%12===11)for(const route of game.routes){route.profitLastYear=route.profitThisYear??0;route.profitThisYear=0;}
  // The quarterly company rating reads the closed months and last year's route profit; recognition only.
  if(game.lastMonth%3===2){reviewPerformance(game,{loanLimit:loanTerms(game).limit});const entry=game.annual?.at(-1);if(game.lastMonth%12===11&&entry?.year===1950+Math.floor(game.lastMonth/12))entry.performance=game.performance.score;}
  monthlyTownRelations(game);
  game.monthlyIncome=0;game.monthlyExpenses=0;game.monthlyOperatingExpenses=0;game.monthlyIncomeAtAccountingStart=0;
  stepContracts(game,site=>stationCoverage(game,site));
  if(game.money<0)notify(game,'Your balance is below zero. Take a loan in Company, or retire a route that earns less than its upkeep.','warning',{topic:'credit'});
}
// Reserved tiles belong to the stroke the player is drawing; towns never lay a street there.
export function tick(game,days,{reserved=[]}={}) {
  if(!Number.isFinite(days)||days<=0)return;
  // Split at day boundaries so large and fractional advances share the same economy.
  let remaining=Math.min(days,3650);
  while(remaining>.00000001) {
    const nextDay=Math.floor(game.day+.00000001)+1;
    const step=Math.min(remaining,nextDay-game.day);
    moveVehicles(game,step);game.day+=step;remaining-=step;
    if(game.day+.00000001>=nextDay) {
      game.day=nextDay;stepIndustries(game,notify);stepWorkshops(game);const served=stepSettlements(game,{extendStreets:points=>placePublicRoads(game,points),reserved});stepEcology(game);maintenance(game);serveFullLoads(game);evaluateMilestones(game);game.lastDailyDay=nextDay;
      const month=calendarMonth(game),closedMonth=month>game.lastMonth?game.lastMonth:null;
      if(closedMonth!==null){monthlyUpdate(game);game.lastMonth=month;openIndustry(game,month);}
      stepAchievements(game,{closedMonth,served,networkTotals});
    }
  }
}

function finite(value,min=-Infinity,max=Infinity) {return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;}
function validFootprint(site,maximum) {return site.footprint===undefined||Number.isInteger(site.footprint)&&site.footprint>=1&&site.footprint<=maximum;}
function validPoint(game,p) {return p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<game.width&&p.y<game.height;}
export function validateGame(game) {
  if(!game||typeof game!=='object'||game.version!==1||!owns(BIOMES,game.biome)||!((game.width===100&&game.height===72)||Object.values(WORLD_SIZES).some(size=>size.width===game.width&&size.height===game.height)))return false;
  if(game.terrainObjectVersion!==undefined&&game.terrainObjectVersion!==1)return false;
  if(game.siteFootprintVersion!==undefined&&![1,2].includes(game.siteFootprintVersion))return false;
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
  if(!game.tiles.every(t=>!t.building||(t.building.owner===undefined||t.building.owner==='player')&&(t.building.paid===undefined||finite(t.building.paid,0,1e12))))return false;
  if(!game.cities.every(c=>validPoint(game,c)&&uniqueId(c)&&typeof c.name==='string'&&finite(c.population,0,1e8)&&finite(c.activity,0)&&finite(c.passengers,0)&&finite(c.growth,0)&&finite(c.delivered,0)&&finite(c.supplies,0)&&(c.mail===undefined||finite(c.mail,0,1e9))))return false;
  if(!game.cities.every(c=>c.lastServiceDay===undefined||c.lastServiceDay===null||finite(c.lastServiceDay,0,game.day)))return false;
  if(!game.cities.every(c=>(c.serviceMonths===undefined||Number.isInteger(c.serviceMonths)&&finite(c.serviceMonths,0,10))&&(c.disturbance===undefined||finite(c.disturbance,0,DISTURBANCE.max))&&(c.advertisedUntil===undefined||Number.isInteger(c.advertisedUntil)&&finite(c.advertisedUntil,0,Math.floor(game.day)+TOWN_ACTIONS.advertise.days))&&(c.fundedUntil===undefined||Number.isInteger(c.fundedUntil)&&finite(c.fundedUntil,0,Math.floor(game.day)+TOWN_ACTIONS.fund.days))))return false;
  if(!game.cities.every(c=>c.market===undefined||validMarket(c.market)))return false;
  if(!game.cities.every(c=>c.workshop===undefined||validWorkshop(game,c.workshop)))return false;
  if(!game.routes.every(r=>r?.marketBonus===undefined||finite(r.marketBonus,0))||!game.history.every(h=>h?.marketBonus===undefined||finite(h.marketBonus,0))||game.monthlyMarketBonus!==undefined&&!finite(game.monthlyMarketBonus,0))return false;
  if(!game.cities.every(c=>c.lastStreetDay===undefined||finite(c.lastStreetDay,0,game.day)))return false;
  if(!game.cities.every(c=>c.popHistory===undefined||(Array.isArray(c.popHistory)&&c.popHistory.length<=12&&c.popHistory.every(n=>finite(n,0,1e8)))))return false;
  if(!game.tiles.every(tile=>tile.building?.populationCityId===undefined||tile.building.populationCityId===null||game.cities.some(city=>city.id===tile.building.populationCityId)))return false;
  if(!game.cities.every(c=>c.lastSupply===undefined||(c.lastSupply&&typeof c.lastSupply==='object'&&!Array.isArray(c.lastSupply)&&Object.entries(c.lastSupply).every(([cargo,day])=>TOWN_CARGO.includes(cargo)&&finite(day,0,game.day)))))return false;
  if(!game.industries.every(i=>validPoint(game,i)&&uniqueId(i)&&owns(INDUSTRIES,i.kind)&&typeof i.name==='string'&&finite(i.capacity,.1,10)&&finite(i.activity,0)&&finite(i.production,0)&&finite(i.shipped,0)&&finite(i.received,0)&&finite(i.idleDays,0)&&i.inventory&&Object.entries(i.inventory).every(([cargo,n])=>owns(CARGO,cargo)&&finite(n,0,1e9))))return false;
  if(!game.industries.every(i=>validFootprint(i,industryFootprint(i.kind))&&i.x+industrySize(i)<=game.width&&i.y+industrySize(i)<=game.height))return false;
  if(!game.industries.every(i=>(i.lastProductionDay===undefined||finite(i.lastProductionDay,0,game.day))&&(i.nextProductionDay===undefined||(Number.isInteger(i.nextProductionDay)&&finite(i.nextProductionDay,0,Math.floor(game.day)+3)))&&(i.nextReviewDay===undefined||(Number.isInteger(i.nextReviewDay)&&finite(i.nextReviewDay,0,Math.floor(game.day)+45)))&&(i.totalProduced===undefined||finite(i.totalProduced,0,1e15))&&(i.openedDay===undefined||(Number.isInteger(i.openedDay)&&finite(i.openedDay,0,Math.floor(game.day))))))return false;
  if(!game.stations.every(s=>validPoint(game,s)&&uniqueId(s)&&typeof s.name==='string'&&TRANSPORT_MODES.includes(s.mode)&&(s.mode==='air'?['x','y'].includes(s.axis):s.axis===undefined)))return false;
  if(!game.zones.every(z=>validPoint(game,z)&&ZONE_TYPES.includes(z.kind)&&finite(z.progress,0,3)))return false;
  if(!game.zones.every(z=>z.tiles===undefined||Number.isInteger(z.tiles)&&finite(z.tiles,1,9)))return false;
  // Only occupied cells need an index: even the largest world stays sparse.
  // The anchor owns the building; child copies or intersecting sites are corrupt.
  const occupied=new Map(),reserved=new Set([...game.cities,...game.stations.filter(s=>s.mode!=='air')].map(p=>p.y*game.width+p.x));
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
  // An airport claims its whole 6 × 2 site; flatness is not checked, so a load never fails over a slope.
  for(const station of game.stations)if(station.mode==='air'){
    const {w,h}=stationSpan(station);if(station.x+w>game.width||station.y+h>game.height)return false;
    for(const p of stationTiles(station)){const index=p.y*game.width+p.x,tile=game.tiles[index];if(occupied.has(index)||reserved.has(index)||tile.road||tile.rail||tile.bridge||tile.tunnel||tile.zone||tile.terrain==='water'||tile.terrain==='mountain')return false;occupied.set(index,{kind:'airport',anchor:station.y*game.width+station.x});}
  }
  for(const site of terrainSites){
    const size=terrainObjectSize(site.object);
    if(!terrainObjectGroundIsFlat(game,site.x,site.y,size))return false;
    if(terrainObjectTiles(site).some(p=>game.tiles[p.y*game.width+p.x]?.terrain!==site.object.kind))return false;
    if(!claim(site.x,site.y,size,'terrainObject',site.y*game.width+site.x))return false;
  }
  for(const zone of game.zones){const index=zone.y*game.width+zone.x,site=occupied.get(index);if(site&&(site.kind!=='building'||site.anchor!==index))return false;}

  if(!game.routes.every(r=>uniqueId(r)&&typeof r.name==='string'&&TRANSPORT_MODES.includes(r.mode)&&owns(CARGO,r.cargo)&&typeof r.active==='boolean'&&finite(r.delivered,0)&&finite(r.revenue,0)&&Array.isArray(r.stops)&&r.stops.length===2&&r.stops.every(id=>game.stations.some(s=>s.id===id&&s.mode===r.mode))&&Array.isArray(r.path)&&r.path.length>1&&r.path.length<=game.tiles.length&&r.path.every(p=>validPoint(game,p))))return false;
  for(const route of game.routes)if(route.number!==undefined&&!validRouteNumber(route.number))delete route.number;
  if(!game.routes.every(route=>route.expenses===undefined||finite(route.expenses,0,1e15)))return false;
  if(!game.routes.every(route=>['profitThisYear','profitLastYear'].every(key=>route[key]===undefined||finite(route[key],-1e15,1e15))))return false;
  if(!game.routes.every(route=>(route.accountingStartDay===undefined||finite(route.accountingStartDay,0,game.day))&&(route.revenueAtAccountingStart===undefined||finite(route.revenueAtAccountingStart,0,route.revenue))))return false;
  if(!game.routes.every(r=>r.fullLoad===undefined||typeof r.fullLoad==='boolean'))return false;
  if(!game.vehicles.every(v=>uniqueId(v)&&game.routes.some(r=>r.id===v.routeId)&&finite(v.x,0,game.width)&&finite(v.y,0,game.height)&&finite(v.angle)&&finite(v.capacity,1,1e9)&&finite(v.load,0,v.capacity)&&finite(v.progress,0,(game.routes.find(r=>r.id===v.routeId)?.path.length||1)-1)&&[1,-1].includes(v.direction)))return false;
  if(!game.vehicles.every(v=>(v.dwellRemaining===undefined||finite(v.dwellRemaining,0,3))&&(v.tripSerial===undefined||(Number.isInteger(v.tripSerial)&&finite(v.tripSerial,0,1e10)))&&(v.totalDistance===undefined||finite(v.totalDistance,0,1e15))&&(v.loadedDay===undefined||finite(v.loadedDay,0,game.day))))return false;
  if(!game.vehicles.every(v=>v.fullLoadSince===undefined||v.fullLoadSince===null||finite(v.fullLoadSince,0,game.day)))return false;
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
  if(!game.history.every(h=>h.property===undefined||finite(h.property,0))||!['monthlyProperty','totalProperty'].every(key=>game[key]===undefined||finite(game[key],0,1e15))||Array.isArray(game.annual)&&game.annual.some(a=>a?.property!==undefined&&!finite(a.property,0)))return false;
  if(game.annual!==undefined&&!(Array.isArray(game.annual)&&game.annual.length<=200&&game.annual.every(a=>a&&['year','revenue','operatingProfit','delivered','population','routes'].every(k=>finite(a[k]))&&(a.bestRouteId===null||typeof a.bestRouteId==='string'&&a.bestRouteId.length<=64))))return false;
  if(game.startingFunds!==undefined&&!STARTING_FUNDS.includes(game.startingFunds))return false;
  if(game.loan!==undefined&&!finite(game.loan,0,1e12))return false;
  if(!game.notifications.every(n=>n&&typeof n.message==='string'&&typeof n.text==='string'&&typeof n.type==='string'&&finite(n.day,0)))return false;
  if(!game.notifications.every(n=>(n.topic===undefined||typeof n.topic==='string'&&n.topic.length<=32)&&(n.template===undefined||typeof n.template==='string'&&n.template.length<=1000)&&(n.target===undefined||Boolean(n.target)&&['industry','city','route'].includes(n.target.kind)&&typeof n.target.id==='string'&&n.target.id.length<=64)))return false;
  if(!validPerformance(game)||game.annual?.some(a=>a.performance!==undefined&&!(Number.isInteger(a.performance)&&finite(a.performance,0,1000))))return false;
  if(!validMilestones(game)||!game.cities.every(c=>c.founded===undefined||typeof c.founded==='boolean'))return false;
  if(!validContracts(game))return false;
  if(game.headlines!==undefined&&!(Array.isArray(game.headlines)&&game.headlines.length<=24&&game.headlines.every((h,i,log)=>Boolean(h)&&typeof h.key==='string'&&h.key.length>0&&h.key.length<=64&&log.findIndex(o=>o?.key===h.key)===i&&typeof h.kind==='string'&&h.kind.length>0&&h.kind.length<=24&&Number.isInteger(h.day)&&h.day>=0&&h.day<=game.day&&typeof h.title==='string'&&h.title.length>0&&h.title.length<=140&&(h.detail===undefined||(typeof h.detail==='string'&&h.detail.length<=240))&&(h.art===undefined||(typeof h.art==='string'&&h.art.length<=16))&&(h.target===undefined||(Boolean(h.target)&&['industry','city','route'].includes(h.target.kind)&&typeof h.target.id==='string'&&h.target.id.length<=64)))))return false;
  if(!validAchievements(game))return false;
  return true;
}
export function saveGame(game) {
  if(!validateGame(game))return result(false,'The game state could not be validated.');
  try {if(typeof localStorage==='undefined')return result(false,'Saving is unavailable in this environment.');localStorage.setItem(SAVE_KEY,JSON.stringify(encodeGame(game)));return result(true,'Company saved on this device.');}
  catch{return result(false,'Could not save. Browser storage may be full or unavailable.');}
}
// Expand old compact buildings only into genuinely empty adjoining land. No relocation,
// population changes, or removal of a neighbor's construction.
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
  if(changed)game.revision++;
}
// Industries outgrew their sites twice, from single tiles and then from 2 × 2 (version 2). A save from before
// grows each smaller site to its full plot where free land allows, still covering the ground it had.
function expandCompactIndustries(game) {
  let changed=false;
  for(const industry of game.industries){
    const size=industryFootprint(industry.kind),slack=size-industrySize(industry);
    for(let i=0;slack>0&&i<(slack+1)**2;i++){
      const x=industry.x-i%(slack+1),y=industry.y-Math.floor(i/(slack+1));
      if(industrySiteProblem(game,industry.kind,x,y,size,industry))continue;
      Object.assign(industry,{x,y,footprint:size});releaseTerrainObjects(game,industryTiles(industry));changed=true;break;
    }
  }
  if(changed)game.revision++;
}
// Shared hydration keeps autosaves and named saves on the same migration path.
export function restoreGame(saved) {
  try {
    const game=decodeGame(saved);if(!validateGame(game))return null;
    if(game.siteFootprintVersion!==2){if(game.siteFootprintVersion!==1)expandRestoredSites(game);expandCompactIndustries(game);game.siteFootprintVersion=2;}
    if(game.terrainObjectVersion!==1){allocateTerrainObjects(game);game.revision++;}
    game.networkRevision??=0;
    if(game.monthlyOperatingExpenses===undefined)game.monthlyIncomeAtAccountingStart=game.monthlyIncome;
    game.monthlyOperatingExpenses??=0;game.totalOperatingExpenses??=0;game.lastMonthlyOperatingProfit??=0;game.monthlyIncomeAtAccountingStart??=0;game.accountingStartDay??=game.day;
    game.lastMonth=calendarMonth(game);
    for(const industry of game.industries)initializeIndustry(game,industry);
    // A wait lasts only on a freight route that still asks for full loads; an older or edited save simply lets it go.
    const routeById=new Map(game.routes.map(r=>[r.id,r]));
    for(const vehicle of game.vehicles){vehicle.dwellRemaining??=0;vehicle.tripSerial??=0;vehicle.level??=0;vehicle.paidPrice??=VEHICLE_COSTS[game.routes.find(route=>route.id===vehicle.routeId).mode];if(waitingForFullLoad(vehicle)){const r=routeById.get(vehicle.routeId);if(r?.fullLoad!==true||isTownTraffic(r.cargo))vehicle.fullLoadSince=null;}}
    for(const city of game.cities)if(city.lastServiceDay===undefined)city.lastServiceDay=city.delivered>0?game.day:null;
    for(const city of game.cities)city.mail??=0;
    for(const route of game.routes){route.pathRevision=-1;if(route.expenses===undefined)route.revenueAtAccountingStart=route.revenue;route.expenses??=0;route.accountingStartDay??=game.day;route.revenueAtAccountingStart??=0;if(route.fullLoad===true&&isTownTraffic(route.cargo))route.fullLoad=false;}
    ensureRouteNumbers(game);
    if(game.achievements===undefined)backfillAchievements(game,{networkTotals});
    // A save from before the rating is reviewed once, silently: every title it meets is stamped today.
    if(game.performance===undefined&&game.history.length>=3)reviewPerformance(game,{loanLimit:loanTerms(game).limit,backfill:true});
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
