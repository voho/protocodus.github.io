import { BIOMES, CARGO, INDUSTRIES, BUILD_COSTS, VEHICLE_COSTS, VEHICLE_CAPACITIES, TOWN_CARGO } from './data.js';
import { generateWorld, seedNumber, WORLD_SIZES, NEW_WORLD_SIZES, DEFAULT_WORLD_SIZE, supportsGenerationVersion } from './world.js';
import { BUILDINGS } from './buildings.js';
import { industryContains, industryDistance, industryTiles, industrySiteProblem, industrySize } from './industry-sites.js';
import { encodeGame, decodeGame, rememberGeneratedWorld } from './save-codec.js';
import { randomAt, localEnvironment, weatherAt, stepEcology } from './environment.js';
import { stepSettlements, housingCapacity } from './settlements.js';
import { initializeIndustry, stepIndustries } from './industry-simulation.js';
import { availableVehicleLevel, priceFor, inflationInfo, calendarMonth } from './economy-pricing.js';
export { priceFor, inflationInfo } from './economy-pricing.js';
export { industryConditions } from './industry-simulation.js';
export { settlementSuitability } from './settlements.js';
export { weatherAt, localEnvironment } from './environment.js';
export { WORLD_SIZES, NEW_WORLD_SIZES } from './world.js';
export { BUILDINGS } from './buildings.js';
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
export function createGame({biome='taiga',seed=1847,size=DEFAULT_WORLD_SIZE,generationVersion}={}) {
  if (!owns(BIOMES,biome)) biome='taiga';
  const game = {
    version:1, seed:seedNumber(seed), biome, ...generateWorld(biome,seed,size,generationVersion),
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
  const cities=game.cities.filter(city => distance(city,station)<=STATION_RADIUS);
  const industries=game.industries.filter(industry => industryDistance(industry,station)<=STATION_RADIUS);
  const zones=game.zones.filter(zone => distance(zone,station)<=STATION_RADIUS);
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
  let best=null,bestDistance=Infinity;
  for(const a of stationCoverage(game,from).cities)for(const b of stationCoverage(game,to).cities){
    if(a.id===b.id)continue;
    const walking=distance(a,from)+distance(b,to);
    if(walking<bestDistance){best=[a,b];bestDistance=walking;}
  }
  return best;
}
const pathSearchBuffers = new WeakMap();
function validNetwork(tile,mode) {
  if(mode==='water')return tile?.terrain==='water';
  return tile && tile[mode] && (tile.terrain!=='water' || tile.bridge) && (tile.terrain!=='mountain' || tile.tunnel);
}
export function findPath(game,from,to,mode='road') {
  if (!TRANSPORT_MODES.includes(mode) || !from || !to || !validNetwork(tileAt(game,from.x,from.y),mode) || !validNetwork(tileAt(game,to.x,to.y),mode)) return null;
  const start=from.y*game.width+from.x, target=to.y*game.width+to.x;
  // Reuse the visited lane across route checks. The frontier grows only as far
  // as the search reaches, so a 25-tile opening trip never allocates a second
  // full-world 16 MiB queue on a 2048 × 2048 continent.
  let buffers=pathSearchBuffers.get(game);
  if(!buffers||buffers.parent.length!==game.tiles.length){buffers={parent:new Int32Array(game.tiles.length),queue:new Int32Array(Math.min(4096,game.tiles.length))};pathSearchBuffers.set(game,buffers);}
  const parent=buffers.parent.fill(-1);let queue=buffers.queue;
  let head=0,tail=1;queue[0]=start;parent[start]=start;
  while(head<tail) {
    const current=queue[head++]; if(current===target) break;
    const x=current%game.width,y=Math.floor(current/game.width);
    for(const [dx,dy] of DIRECTIONS) {
      const nx=x+dx,ny=y+dy,tile=tileAt(game,nx,ny);
      if(!validNetwork(tile,mode)) continue;
      const next=ny*game.width+nx;
      if(parent[next]!==-1) continue;
      if(tail===queue.length){const expanded=new Int32Array(Math.min(game.tiles.length,queue.length*2));expanded.set(queue);queue=buffers.queue=expanded;}
      parent[next]=current;queue[tail++]=next;
    }
  }
  if(parent[target]===-1) return null;
  const path=[];
  for(let p=target;;p=parent[p]) { path.push({x:p%game.width,y:Math.floor(p/game.width)});if(p===start) break; }
  return path.reverse();
}
function invalidateNetwork(game){game.revision++;game.networkRevision=(game.networkRevision||0)+1;}
function spend(game,cost) { game.money-=cost;game.monthlyExpenses+=cost;game.totalExpenses+=cost; }
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
  const point={x,y},station=stationAt(game,x,y),industry=industryAt(game,x,y);
  const city=game.cities.find(c=>c.x===x&&c.y===y);
  if(tool==='bulldoze') {
    if(station && game.routes.some(r=>r.stops.includes(station.id))) return result(false,'Retire routes using this station before removing it.');
    if(city) return result(false,'A city center cannot be demolished.');
    if(!station&&!industry&&!t.building&&!t.zone&&!t.road&&!t.rail&&t.terrain!=='forest'&&t.terrain!=='rock'&&!hasClearableDecoration(t)) return result(false,'There is nothing to demolish here.');
    const cost=constructionCost(game,tool,x,y);
    if(game.money<cost) return result(false,'Not enough funds to demolish this tile.');
    spend(game,cost);
    const residents=housingCapacity(t.building),town=residents?(owns(t.building,'populationCityId')?game.cities.find(city=>city.id===t.building.populationCityId):closestCity(game,point,10)):null;
    if(town){town.population=Math.max(0,town.population-residents);town.passengers=Math.min(town.passengers,town.population*.9);}
    if(station) game.stations=game.stations.filter(s=>s.id!==station.id);
    if(industry){
      game.industries=game.industries.filter(i=>i.id!==industry.id);
      for(const point of industryTiles(industry)){const cell=tileAt(game,point.x,point.y);cell.detail='';if(['forest','rock'].includes(cell.terrain))cell.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';}
    }
    game.zones=game.zones.filter(z=>z.x!==x||z.y!==y);
    const changedNetwork=t.road||t.rail||Boolean(station);
    t.road=false;t.rail=false;t.bridge=false;t.tunnel=false;t.building=null;t.zone=null;if(t.terrain!=='water')t.detail='';delete t.publicRoad;
    if(['forest','rock'].includes(t.terrain)) t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
    if(changedNetwork)invalidateNetwork(game);else game.revision++;
    return result(true,`Cleared tile · ${moneyText(cost)}`,{cost});
  }
  if(NETWORK_TOOLS.includes(tool)) {
    const mode=tool.startsWith('rail')?'rail':'road';
    const bridge=tool==='bridge'||tool==='railbridge',tunnel=tool==='tunnel'||tool==='railtunnel';
    if(t[mode] && (!bridge||t.bridge) && (!tunnel||t.tunnel)) return result(true,'Already built.',{cost:0,unchanged:true});
    if(industry||t.building||t.zone) return result(false,'Clear the building or zone before building a connection.');
    if(station&&station.mode!==mode) return result(false,'Cannot cross another transport mode at a station.');
    if(t.terrain==='water'&&!bridge&&!t.bridge) return result(false,`Water needs a ${mode==='rail'?'rail ':''}bridge.`);
    if(t.terrain==='mountain'&&!tunnel&&!t.tunnel) return result(false,`Mountains need a ${mode==='rail'?'rail ':''}tunnel.`);
    if(bridge&&t.terrain!=='water') return result(false,'Place bridges on water; connect the banks with ordinary track or road.');
    if(tunnel&&t.terrain!=='mountain'&&t.terrain!=='rock') return result(false,'Tunnels must cross mountains or rock.');
    const cost=constructionCost(game,tool,x,y);
    if(game.money<cost) return result(false,`Need ${moneyText(cost)} for this connection.`);
    spend(game,cost);t[mode]=true;if(bridge)t.bridge=true;if(tunnel)t.tunnel=true;
    if(t.terrain==='forest'){t.terrain=game.biome==='tundra'?'snow':game.biome==='desert'?'sand':'grass';t.detail='';}
    invalidateNetwork(game);
    return result(true,`${mode==='rail'?'Rail':'Road'} ${bridge?'bridge':tunnel?'tunnel':'built'} · ${moneyText(cost)}`,{cost});
  }
  if(tool==='bus-stop'||tool==='train-stop'||tool==='port') {
    const mode=tool==='port'?'water':tool==='bus-stop'?'road':'rail';
    if(station) return result(false,'There is already a station here.');
    if(mode==='water'){
      if(t.terrain!=='water')return result(false,'Place a port on water directly beside land.');
      if(industry||t.building||t.zone||t.road||t.rail||t.bridge||t.tunnel||city)return result(false,'Ports need empty shoreline water, away from bridges.');
      if(!DIRECTIONS.some(([dx,dy])=>{const shore=tileAt(game,x+dx,y+dy);return shore&&shore.terrain!=='water';}))return result(false,'Place a port directly beside the shore.');
    }else{
      if(industry||t.building||t.zone) return result(false,'Choose an unoccupied road or rail tile.');
      if(!validNetwork(t,mode)) return result(false,`Build a ${mode==='road'?'road':'railway'} here first.`);
      if(t.bridge||t.tunnel) return result(false,'Stations need open ground beside the connection.');
    }
    const cost=constructionCost(game,tool,x,y);if(game.money<cost)return result(false,`Need ${moneyText(cost)} for this station.`);
    const nearIndustry=game.industries.find(i=>industryDistance(i,point)<=STATION_RADIUS),nearCity=closestCity(game,point,STATION_RADIUS);
    const name=`${nearCity?.name||nearIndustry?.name||(mode==='water'?'Coastal':'Rural')} ${mode==='water'?'Port':mode==='road'?'Stop':'Station'} ${game.stations.length+1}`;
    const newStation={id:makeId(game,'station'),name,x,y,mode};
    spend(game,cost);game.stations.push(newStation);invalidateNetwork(game);
    return result(true,`${name} opened · ${moneyText(cost)}`,{cost,station:newStation});
  }
  if(station||industry||t.building||t.zone||t.road||t.rail||city) return result(false,'Choose an empty tile or clear this one first.');
  if(t.terrain==='water'||(t.terrain==='mountain'&&!INDUSTRIES[tool]?.terrain?.includes('mountain'))) return result(false,'This structure needs buildable land.');
  const cost=constructionCost(game,tool,x,y);if(game.money<cost)return result(false,`Need ${moneyText(cost)} for this construction.`);
  if(ZONE_TYPES.includes(tool)) {
    spend(game,cost);t.zone=tool;t.detail='';
    if(t.terrain==='forest'||t.terrain==='rock')t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
    game.zones.push({x,y,kind:tool,progress:0});game.revision++;
    return result(true,`${tool[0].toUpperCase()+tool.slice(1)} zone designated · ${moneyText(cost)}`,{cost});
  }
  if(tool==='city') {
    if(game.cities.some(c=>distance(c,point)<11))return result(false,'Found a new city at least 11 tiles from another center.');
    if(['mountain','rock'].includes(t.terrain))return result(false,'A new city needs level land.');
    // Preserve the town credited for existing housing before a new center can
    // become nearer, including legacy buildings that predate explicit owners.
    rememberHousingOwners(game);
    const prefixes=game.biome==='taiga'?['Birch','Willow','Silver','Fern','Maple']:game.biome==='tundra'?['Ice','Frost','North','Winter','Snow']:['Amber','Gold','Dune','Palm','Sun'];
    const suffixes=['field','haven','ford','creek','ridge'];
    const n=Math.max(0,game.cities.length-4);
    const newCity={id:makeId(game,'city'),name:prefixes[n%prefixes.length]+suffixes[Math.floor(n/prefixes.length)%suffixes.length],x,y,population:80,activity:0,growth:0,passengers:12,delivered:0,supplies:0,lastServiceDay:null};
    spend(game,cost);game.cities.push(newCity);t.road=true;t.detail='';t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';invalidateNetwork(game);
    notify(game,`${newCity.name} founded. Add housing and connect a passenger service.`,'success');
    return result(true,`${newCity.name} founded · ${moneyText(cost)}`,{cost,city:newCity});
  }
  if(owns(BUILDINGS,tool)) {
    const def=BUILDINGS[tool],nearCity=closestCity(game,point,10);
    spend(game,cost);t.building={kind:tool,level:1,...def.residents?{populationCityId:nearCity?.id??null}:{}};t.detail='';
    if(['forest','rock'].includes(t.terrain))t.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
    if(nearCity&&def.residents)nearCity.population+=def.residents;
    game.revision++;
    return result(true,`${def.name} constructed · ${moneyText(cost)}`,{cost,building:t.building});
  }
  const def=INDUSTRIES[tool];
  const siteProblem=industrySiteProblem(game,tool,x,y);if(siteProblem)return result(false,siteProblem);
  if(!def.biomes.includes(game.biome))return result(false,`${def.name} is unavailable in ${BIOMES[game.biome].name}.`);
  if(def.terrain&&!def.terrain.includes(t.terrain))return result(false,`${def.name} needs ${def.terrain.join(', ')} terrain.`);
  const inventory=Object.fromEntries([...Object.keys(def.inputs),...Object.keys(def.outputs)].map(cargo=>[cargo,0]));
  const newIndustry={id:makeId(game,'industry'),kind:tool,name:def.name,x,y,footprint:2,capacity:1,inventory,production:0,totalProduced:0,activity:0,shipped:0,received:0,idleDays:0,owner:'player'};
  initializeIndustry(game,newIndustry);
  spend(game,cost);game.industries.push(newIndustry);game.revision++;
  return result(true,`${def.name} constructed · 2 × 2 site · ${moneyText(cost)}`,{cost,industry:newIndustry});
}

export function buildPath(game,tool,points) {
  if(!Array.isArray(points)||!points.length)return result(false,'Choose a construction path.');
  const unique=new Map();for(const point of points)if(point&&Number.isInteger(point.x)&&Number.isInteger(point.y))unique.set(`${point.x},${point.y}`,point);
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

export function getVehiclePurchase(game,mode) {
  if(!TRANSPORT_MODES.includes(mode))return null;
  const level=availableVehicleLevel(game);
  return {level,cost:priceFor(game,VEHICLE_COSTS[mode]*(1+.4*level)),capacity:vehicleCapacity(mode,level),speedMultiplier:vehicleSpeedMultiplier(level)};
}

export function getVehicleUpgrade(game,routeId) {
  const route=game.routes.find(r=>r.id===routeId),vehicles=route?game.vehicles.filter(v=>v.routeId===routeId):[],targetLevel=availableVehicleLevel(game);
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
  for(const vehicle of game.vehicles.filter(v=>v.routeId===route.id&&vehicleLevel(v)<targetLevel)){
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
  for(const upgrade of quote.routes)applyVehicleUpgrade(game,game.routes.find(route=>route.id===upgrade.routeId),quote.targetLevel);
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
function loadVehicle(game,route,vehicle,stopIndex) {
  const station=game.stations.find(s=>s.id===route.stops[stopIndex]);if(!station)return;
  const coverage=stationCoverage(game,station);let free=vehicle.capacity-vehicle.load;
  if(route.cargo==='passengers') {
    const endpoints=passengerEndpoints(game,...route.stops.map(id=>game.stations.find(stop=>stop.id===id)));
    for(const city of endpoints?[endpoints[stopIndex]]:[]) {
      const amount=Math.min(free,Math.floor(city.passengers||0));
      city.passengers-=amount;vehicle.load+=amount;free-=amount;city.activity+=amount*.18;
      if(free<=0)break;
    }
  } else if(stopIndex===0) {
    for(const industry of coverage.industries) {
      if(!INDUSTRIES[industry.kind].outputs[route.cargo])continue;
      const amount=Math.min(free,Math.floor(industry.inventory[route.cargo]||0));
      industry.inventory[route.cargo]-=amount;industry.shipped+=amount;industry.activity+=amount;vehicle.load+=amount;free-=amount;
      if(free<=0)break;
    }
  }
}
function unloadVehicle(game,route,vehicle,stopIndex,arrivalDay=game.day) {
  if(vehicle.load<=0)return;
  const station=game.stations.find(s=>s.id===route.stops[stopIndex]);if(!station)return;
  const coverage=stationCoverage(game,station);let remaining=vehicle.load,delivered=0;
  if(route.cargo==='passengers') {
    const endpoints=passengerEndpoints(game,...route.stops.map(id=>game.stations.find(stop=>stop.id===id)));if(!endpoints)return;
    const city=endpoints[stopIndex];city.activity+=remaining;city.delivered+=remaining;city.lastServiceDay=arrivalDay;delivered=remaining;remaining=0;
  } else if(stopIndex===1) {
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
  const [a,b]=route.stops.map(id=>game.stations.find(s=>s.id===id));
  const path=a&&b?findPath(game,a,b,route.mode):null;
  const wasActive=route.active;
  route.active=Boolean(path);route.pathRevision=networkRevision;
  if(!path) {route.status='Disconnected';if(wasActive)notify(game,route.mode==='water'?`${route.name} has lost its water connection. Ports need a continuous waterway.`:`${route.name} has lost its connection. Repair the network to resume.`,'warning');return;}
  route.status='Running';
  const changed=route.path.length!==path.length||route.path.some((p,i)=>p.x!==path[i].x||p.y!==path[i].y);
  if(changed) {
    for(const vehicle of game.vehicles.filter(v=>v.routeId===route.id)) {
      let nearest=0,best=Infinity;
      for(let i=0;i<path.length;i++) {const d=distance(vehicle,path[i]);if(d<best){best=d;nearest=i;}}
      vehicle.progress=nearest;vehicle.x=path[nearest].x;vehicle.y=path[nearest].y;
    }
  }
  route.path=path;
}
export function refreshRouteConnections(game) { for(const route of game.routes)updateRoutePath(game,route); }
const movementCache=new WeakMap();
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
    const ports=game.stations.filter(s=>s.mode==='water'&&distance(s,a)<=4);
    const traffic=game.routes.filter(r=>r.mode==='water'&&r.active&&ports.some(port=>r.stops.includes(port.id))).length;
    const support=neighbors.filter(t=>t?.road||t?.rail).length*.015;
    const passage=(ta.bridge||tb.bridge)?.88:1;
    const variation=.94+randomAt(game,day,vehicle.id,511)*.12;
    const speed=1.8*channel*passage*climate.travel*(1-climate.cold*.12)*variation*(1-Math.min(.18,Math.max(0,traffic-1)*.035)+Math.min(.045,support))*vehicleSpeedMultiplier(vehicleLevel(vehicle));
    cache.speeds.set(key,speed);return speed;
  }
  let congestion=0,support=0;
  for(const city of game.cities){const d=Math.hypot(city.x-a.x,city.y-a.y);if(d<5)congestion+=Math.min(.15,city.population/10000)*(1-d/6);}
  for(const [dx,dy]of DIRECTIONS){const kind=tileAt(game,a.x+dx,a.y+dy)?.building?.kind;if(kind==='service-garage'||kind==='police-station')support+=.035;}
  const terrain=(ta.bridge||tb.bridge)?.8:(ta.tunnel||tb.tunnel)?.88:1;
  const grade=1-Math.min(.16,Math.abs(ta.elevation-tb.elevation)*.4);
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
function arriveVehicle(game,route,vehicle,arrivalDay){
  const stopIndex=vehicle.direction===1?1:0;
  unloadVehicle(game,route,vehicle,stopIndex,arrivalDay);loadVehicle(game,route,vehicle,stopIndex);vehicle.direction*=-1;vehicle.tripSerial=(vehicle.tripSerial||0)+1;
  const stop=game.stations.find(s=>s.id===route.stops[stopIndex]),e=localEnvironment(game,stop.x,stop.y,2);
  vehicle.dwellRemaining=(.05+randomAt(game,Math.floor(arrivalDay),vehicle.id,500+vehicle.tripSerial)*.13)*(route.mode==='water'?1.8:1)*(1+vehicle.load/vehicle.capacity*.5)/(1+e.access*.35+e.services*.06);
}
function moveVehicles(game,days) {
  for(const route of game.routes)updateRoutePath(game,route);
  const routeIndex=new Map(game.routes.map(route=>[route.id,route]));
  const fleet=game.vehicles.map(vehicle=>({vehicle,route:routeIndex.get(vehicle.routeId)})).filter(({route})=>route?.active&&route.path.length>1);
  let remaining=days,elapsed=0;
  while(remaining>1e-10&&fleet.length){
    const plans=fleet.map(({vehicle,route})=>travelPlan(game,route,vehicle,remaining));
    const step=plans.reduce((time,plan)=>plan.arrived?Math.min(time,plan.elapsed):time,remaining);
    for(let i=0;i<fleet.length;i++){
      const {vehicle,route}=fleet[i],plan=plans[i].elapsed>step+1e-12?travelPlan(game,route,vehicle,step):plans[i];
      Object.assign(vehicle,plan.state);
    }
    elapsed+=step;remaining=Math.max(0,remaining-step);
    for(const {vehicle,route}of fleet){
      const endpoint=vehicle.direction===1?route.path.length-1:0;
      if(vehicle.dwellRemaining<=0&&Math.abs(vehicle.progress-endpoint)<1e-9)arriveVehicle(game,route,vehicle,Math.min(game.day+days,game.day+elapsed));
    }
  }
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
    for(const id of route.stops){const station=game.stations.find(stop=>stop.id===id);if(station)add(`station:${id}`,station.mode==='water'?6:station.mode==='road'?1.2:4,route);}
  }
  for(const {cost,routes}of users.values())for(const id of routes)shares.set(id,shares.get(id)+cost/routes.size);
  upkeepShareCache.set(game,{revision,routes:game.routes,count:game.routes.length,shares});return shares;
}
function maintenance(game) {
  if(game.maintenanceRevision!==(game.networkRevision||0)) {
    let upkeep=0;
    for(const t of game.tiles)upkeep+=(t.road&&!t.publicRoad?.075:0)+(t.rail?.14:0)+((t.bridge||t.tunnel)?.2:0);
    upkeep+=game.stations.reduce((sum,s)=>sum+(s.mode==='water'?6:s.mode==='road'?1.2:4),0);
    game.infrastructureUpkeep=upkeep;game.maintenanceRevision=game.networkRevision||0;
  }
  const day=Math.floor(game.day),center=game.cities[0]||{x:game.width/2,y:game.height/2},weather=weatherAt(game,center.x,center.y,day);
  const routeCosts=new Map(game.routes.map(route=>[route.id,0]));
  const fleet=game.vehicles.reduce((sum,v)=>{
    const route=game.routes.find(r=>r.id===v.routeId),localWeather=weatherAt(game,v.x,v.y,day),e=localEnvironment(game,v.x,v.y,2);
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
function validPoint(game,p) {return p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<game.width&&p.y<game.height;}
export function validateGame(game) {
  if(!game||typeof game!=='object'||game.version!==1||!owns(BIOMES,game.biome)||!((game.width===100&&game.height===72)||Object.values(WORLD_SIZES).some(size=>size.width===game.width&&size.height===game.height)))return false;
  if(game.size!==undefined&&(!owns(WORLD_SIZES,game.size)||WORLD_SIZES[game.size].width!==game.width||WORLD_SIZES[game.size].height!==game.height))return false;
  if(game.generationVersion!==undefined&&(!supportsGenerationVersion(game.generationVersion)||!owns(NEW_WORLD_SIZES,game.size)))return false;
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
  if(!game.tiles.every(t=>t&&TERRAIN.has(t.terrain)&&finite(t.elevation)&&(t.detail===undefined||(typeof t.detail==='string'&&t.detail.length<80))&&(t.publicRoad===undefined||typeof t.publicRoad==='boolean')&&Number.isInteger(t.variant)&&['road','rail','bridge','tunnel'].every(k=>typeof t[k]==='boolean')&&(t.zone===null||ZONE_TYPES.includes(t.zone))&&(t.building===null||(t.building&&(owns(BUILDINGS,t.building.kind)||['house','apartment','shop','office','factory'].includes(t.building.kind))&&finite(t.building.level,1,3)))))return false;
  if(!game.cities.every(c=>validPoint(game,c)&&uniqueId(c)&&typeof c.name==='string'&&finite(c.population,0,1e8)&&finite(c.activity,0)&&finite(c.passengers,0)&&finite(c.growth,0)&&finite(c.delivered,0)&&finite(c.supplies,0)))return false;
  if(!game.cities.every(c=>c.lastServiceDay===undefined||c.lastServiceDay===null||finite(c.lastServiceDay,0,game.day)))return false;
  if(!game.tiles.every(tile=>tile.building?.populationCityId===undefined||tile.building.populationCityId===null||game.cities.some(city=>city.id===tile.building.populationCityId)))return false;
  if(!game.industries.every(i=>validPoint(game,i)&&uniqueId(i)&&owns(INDUSTRIES,i.kind)&&typeof i.name==='string'&&finite(i.capacity,.1,10)&&finite(i.activity,0)&&finite(i.production,0)&&finite(i.shipped,0)&&finite(i.received,0)&&finite(i.idleDays,0)&&i.inventory&&Object.entries(i.inventory).every(([cargo,n])=>owns(CARGO,cargo)&&finite(n,0,1e9))))return false;
  if(!game.industries.every(i=>(i.footprint===undefined||i.footprint===1||i.footprint===2)&&i.x+(i.footprint||1)<=game.width&&i.y+(i.footprint||1)<=game.height))return false;
  const industryCells=new Set();
  for(const industry of game.industries)for(const point of industryTiles(industry)){
    const index=point.y*game.width+point.x;if(industryCells.has(index))return false;industryCells.add(index);
    if(industry.footprint===2){const tile=game.tiles[index];if(tile.terrain==='water'||tile.building||tile.zone||tile.road||tile.rail||game.stations.some(s=>s.x===point.x&&s.y===point.y))return false;}
  }
  if(!game.industries.every(i=>(i.lastProductionDay===undefined||finite(i.lastProductionDay,0,game.day))&&(i.nextProductionDay===undefined||(Number.isInteger(i.nextProductionDay)&&finite(i.nextProductionDay,0,Math.floor(game.day)+3)))&&(i.nextReviewDay===undefined||(Number.isInteger(i.nextReviewDay)&&finite(i.nextReviewDay,0,Math.floor(game.day)+45)))&&(i.totalProduced===undefined||finite(i.totalProduced,0,1e15))))return false;
  if(!game.stations.every(s=>validPoint(game,s)&&uniqueId(s)&&typeof s.name==='string'&&TRANSPORT_MODES.includes(s.mode)))return false;
  if(!game.zones.every(z=>validPoint(game,z)&&ZONE_TYPES.includes(z.kind)&&finite(z.progress,0,3)))return false;
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
// Shared hydration keeps autosaves and named saves on the same migration path.
export function restoreGame(saved) {
  try {
    const game=decodeGame(saved);if(!validateGame(game))return null;
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
