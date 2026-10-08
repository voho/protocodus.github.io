import { industryAt, invalidateNetworkPoints, quoteNetworkConstruction, BUILDINGS, INDUSTRIES } from './model.js';
import { buildingAt, buildingTiles } from './building-sites.js';
import { industryTiles, industryFootprint } from './industry-sites.js';
import { terrainObjectAt, terrainObjectTiles } from './terrain-objects.js';
import { money as moneyText } from './copy.js';
import { MAIL_POOL_SHARE } from './settlements.js';
import { calendarMonth } from './economy-pricing.js';
import { stationSiteAt, stationTiles } from './station-sites.js';
import { airportPlacement } from './construction-plan.js';

// One construction gesture reversed as a diff: only the tiles, sites, residents,
// notices and money that this build changed go back, so vehicles, cargo and
// growth elsewhere keep running. Entries live in the session, never in saves.
const LISTS=['stations','industries','cities','zones'];
const NATURAL=new Set(['grass','forest','sand','snow']);
const NAMES={road:'Road',rail:'Rail',bridge:'Road bridge',railbridge:'Rail bridge',tunnel:'Road tunnel',railtunnel:'Rail tunnel',port:'Port',airport:'Airport','bus-stop':'Road stop','train-stop':'Rail station',residential:'Residential zone',commercial:'Commercial zone',industrial:'Industrial zone',workshop:'Workshop'};
const cover=terrain=>NATURAL.has(terrain)?'land':terrain;
const pinned=new WeakSet(); // Tile arrays whose homes all name their town already.
function same(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
}
// Wild growth may repaint ground cover and dissolve parcels; anything built, dug or zoned may not.
function settled(tile,after,exact){
  for(const key of new Set([...Object.keys(tile),...Object.keys(after)]))if(key!=='detail'&&key!=='terrainObject'&&!(key==='terrain'?(exact?tile.terrain===after.terrain:cover(tile.terrain)===cover(after.terrain)):same(tile[key],after[key])))return false;
  return true;
}
function block(game,points,from,to,into=new Set()){
  for(const {x,y} of points)for(let dy=from;dy<=to;dy++)for(let dx=from;dx<=to;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<game.width&&ny<game.height)into.add(ny*game.width+nx);}
  return into;
}
const pointOf=(game,index)=>({x:index%game.width,y:Math.floor(index/game.width)});
function restoreList(current,{before,after,added,removed}){
  if(current.length===after.length&&current.every((item,n)=>item===after[n]))return before.slice();
  const gone=new Set(added),list=current.filter(item=>!gone.has(item));
  for(const [index,item] of removed)list.splice(Math.min(index,list.length),0,item);
  return list;
}

/** Before buildPlan: the gesture, complete sites, quoted earthworks and their cleared objects, plus a three-tile collar and the counters a build moves. */
export function captureUndo(game,tool,points,{terrain}={}){
  const centers=[];
  for(const p of Array.isArray(points)?points:[])if(p&&Number.isInteger(p.x)&&Number.isInteger(p.y)){
    centers.push(p);
    if(Object.hasOwn(INDUSTRIES,tool)&&industryFootprint(tool)>3)centers.push(...industryTiles({...p,footprint:industryFootprint(tool)}));
    if(tool==='bulldoze'){const industry=industryAt(game,p.x,p.y),site=industry||buildingAt(game,p.x,p.y)||terrainObjectAt(game,p.x,p.y),airport=stationSiteAt(game,p.x,p.y);if(site)centers.push(site);if(industry)centers.push(...industryTiles(industry));if(airport?.mode==='air')centers.push(...stationTiles(airport));}
    // An airport's site lies either way around the pointer, depending on the runway.
    if(tool==='airport')for(const axis of ['x','y'])centers.push(...stationTiles({...airportPlacement(p,axis),mode:'air',axis}));
  }
  if(terrain===undefined&&['road','rail','bridge','railbridge','tunnel','railtunnel'].includes(tool))terrain=quoteNetworkConstruction(game,tool,points).terrain;
  if(terrain){
    centers.push(...terrain);
    const affected=block(game,terrain,-1,1,block(game,Array.isArray(points)?points.filter(p=>p&&Number.isInteger(p.x)&&Number.isInteger(p.y)):[],0,0));
    for(const index of affected){const p=pointOf(game,index),site=terrainObjectAt(game,p.x,p.y);if(site)centers.push(site);}
  }
  const indices=[...block(game,centers,-3,3)],owners=[];
  // Founding a town first pins every older home to its current town.
  if(tool==='city'&&!pinned.has(game.tiles)){for(const tile of game.tiles)if(tile.building&&!Object.hasOwn(tile.building,'populationCityId'))owners.push(tile.building);if(!owners.length)pinned.add(game.tiles);}
  return {tool,tiles:game.tiles,indices,before:structuredClone(indices.map(index=>game.tiles[index])),lists:Object.fromEntries(LISTS.map(key=>[key,game[key].slice()])),notifications:game.notifications.slice(),
    people:game.cities.map(city=>[city,city.population,city.passengers,city.mail]),money:[game.money,game.monthlyExpenses,game.totalExpenses],nextId:game.nextId,owners,
    calm:game.cities.map(city=>[city,city.disturbance||0])};
}

/** After buildPlan: the undo entry for what the build changed, or null when it changed nothing. */
export function finishUndo(entry,game,result){
  if(!entry||!result?.ok||game.tiles!==entry.tiles)return null;
  const changed=[],before=[],lists={};
  entry.indices.forEach((index,n)=>{if(!same(entry.before[n],game.tiles[index])){changed.push(index);before.push(entry.before[n]);}});
  for(const key of LISTS){
    const was=entry.lists[key],now=game[key];if(was.length===now.length&&was.every((item,n)=>item===now[n]))continue;
    const old=new Set(was),kept=new Set(now);
    lists[key]={before:was,after:now.slice(),added:now.filter(item=>!old.has(item)),removed:was.flatMap((item,index)=>kept.has(item)?[]:[[index,item]])};
  }
  const towns=new Set(game.cities),people=entry.people.filter(([city,population,passengers,mail])=>towns.has(city)&&(city.population!==population||city.passengers!==passengers||city.mail!==mail)).map(([city,population,passengers,mail])=>[city,population,city.population,passengers,city.passengers,mail,city.mail]);
  // A demolition's dent in a town's opinion is kept as the amount it added, so later fading or demolition stays.
  const disturbed=entry.calm.filter(([city,before])=>towns.has(city)&&(city.disturbance||0)!==before).map(([city,before])=>[city,(city.disturbance||0)-before]);
  const cost=result.cost||0;
  if(!changed.length&&!Object.keys(lists).length&&!people.length&&!disturbed.length&&!(cost>0))return null;
  // The watch covers each changed tile and every site the undo removes or brings back.
  const core=new Set(changed),exact=new Set(),add=({x,y})=>core.add(y*game.width+x),sites=key=>[...lists[key]?.added||[],...(lists[key]?.removed||[]).map(([,item])=>item)];
  for(const item of [...sites('stations').flatMap(stationTiles),...sites('cities')])add(item);
  for(const industry of sites('industries'))industryTiles(industry).forEach(add);
  before.forEach((tile,n)=>{
    const {x,y}=pointOf(game,changed[n]);
    if(tile.building)buildingTiles({x,y,building:tile.building}).forEach(add);
    if(tile.terrainObject)for(const p of terrainObjectTiles({x,y,object:tile.terrainObject})){const index=p.y*game.width+p.x;if(!core.has(index))exact.add(index);core.add(index);}
  });
  // Homes anchored up to two tiles away can cover a watched tile; new heights also carry their neighbours.
  const points=[...core].map(index=>pointOf(game,index)),watch=block(game,points,-2,0,new Set(core)),anchors=new Set([...watch].filter(index=>!core.has(index)));
  const lifted=changed.filter((index,n)=>before[n].elevation!==game.tiles[index].elevation).map(index=>pointOf(game,index));
  for(const index of block(game,lifted,-1,1))if(anchors.has(index)||!watch.has(index)){watch.add(index);anchors.delete(index);}
  const watched=[...watch],trades=(lists.industries?.added||[]).map(industry=>[industry,industry.shipped,industry.received]);
  const network=Boolean(lists.stations)||changed.some((index,n)=>['road','rail','bridge','tunnel'].some(key=>Boolean(before[n][key])!==Boolean(game.tiles[index][key])));
  const seen=new Set(entry.notifications),ids=new Set(game.notifications.filter(notice=>!seen.has(notice)).map(notice=>notice.id));
  return {tool:entry.tool,tiles:game.tiles,routes:game.routes,routeCount:game.routes.length,cost,changed,before,lists,people,disturbed,trades,network,
    points:[...changed.map(index=>pointOf(game,index)),...sites('stations').flatMap(stationTiles)],
    notices:{before:entry.notifications,after:game.notifications.slice(),ids},money:[entry.money,[game.money,game.monthlyExpenses,game.totalExpenses]],nextId:[entry.nextId,game.nextId],
    owners:entry.owners.filter(building=>Object.hasOwn(building,'populationCityId')),core,exact,anchors,watched,after:structuredClone(watched.map(index=>game.tiles[index])),
    // A building the company now owns earns rent at the next close, so undoing it stays within this month.
    property:changed.some((index,n)=>game.tiles[index].building?.owner==='player'&&before[n].building?.owner!=='player'),month:calendarMonth(game),
    known:new Set([...game.stations,...game.industries,...game.cities]),done:false};
}

/** True once the entry belongs to another world, predates a route change or was used; the app forgets it. */
export function undoStale(game,entry){return !entry||entry.done||game.tiles!==entry.tiles||game.routes!==entry.routes||game.routes.length!==entry.routeCount;}

/** Why this build can no longer be reversed, or null. */
export function undoProblem(game,entry){
  if(undoStale(game,entry))return entry&&!entry.done&&game.tiles===entry.tiles?'Can’t undo: your routes have changed since.':'Nothing to undo.';
  if(entry.property&&calendarMonth(game)!==entry.month)return 'Rent has been paid on this building. Sell it instead.';
  const changedLand='Can’t undo: the land there has changed since.',within=({x,y})=>entry.core.has(y*game.width+x);
  const reaches=(building,index)=>Boolean(building)&&buildingTiles({...pointOf(game,index),building}).some(within);
  for(let n=0;n<entry.watched.length;n++){
    const index=entry.watched[n],tile=game.tiles[index],after=entry.after[n];
    if(entry.anchors.has(index)?(reaches(tile.building,index)||reaches(after.building,index))&&!same(tile.building,after.building):!settled(tile,after,entry.exact.has(index)))return changedLand;
  }
  for(const key of LISTS){const list=entry.lists[key];if(list?.added.length){const present=new Set(game[key]);if(list.added.some(item=>!present.has(item)))return changedLand;}}
  if([...game.stations,...game.cities].some(item=>!entry.known.has(item)&&within(item))||game.industries.some(item=>!entry.known.has(item)&&industryTiles(item).some(within)))return 'Can’t undo: something new stands there now.';
  const stops=new Set((entry.lists.stations?.added||[]).map(station=>station.id));
  if(stops.size&&game.routes.some(route=>route.stops.some(id=>stops.has(id))))return 'Can’t undo: a route now uses this stop.';
  if(entry.trades.some(([industry,shipped,received])=>industry.shipped!==shipped||industry.received!==received))return 'Can’t undo: this industry has already traded cargo.';
  const towns=new Set((entry.lists.cities?.added||[]).map(city=>city.id));
  if(towns.size&&game.tiles.some(tile=>towns.has(tile.building?.populationCityId)))return 'Can’t undo: homes now belong to this town.';
  return null;
}
export const canUndo=(game,entry)=>!undoProblem(game,entry);

function undoLabel(entry){
  const {tool}=entry,stations=entry.lists.stations?.added||[];
  if(tool==='bulldoze')return 'Demolition undone';
  if(tool==='raise'||tool==='lower'||tool==='level')return 'Land restored';
  if(tool==='connection')return `${stations[0]?.mode==='rail'?'Railway':'Road'}${stations.length?' and stops':''} removed`;
  const name=tool==='stop'?stations.length>1?`${stations.length} stops`:stations[0]?.mode==='rail'?'Rail station':'Road stop':tool==='city'?entry.lists.cities?.added[0]?.name||'Town':NAMES[tool]||BUILDINGS[tool]?.name||INDUSTRIES[tool]?.name||'Construction';
  return `${name} removed`;
}

/** Reverse one build in place: tiles keep their identity, sites return to their old order and the recorded cost is refunded. */
export function undoConstruction(game,entry){
  const problem=undoProblem(game,entry);if(problem)return {ok:false,message:problem,cost:0};
  entry.changed.forEach((index,n)=>{const tile=game.tiles[index];for(const key of Object.keys(tile))delete tile[key];Object.assign(tile,entry.before[n]);});
  for(const key of LISTS)if(entry.lists[key])game[key]=restoreList(game[key],entry.lists[key]);
  const towns=new Set(game.cities);
  for(const [city,population,populationAfter,passengers,passengersAfter,mail,mailAfter] of entry.people)if(towns.has(city)){
    city.population=city.population===populationAfter?population:Math.max(0,city.population-(populationAfter-population));
    city.passengers=city.passengers===passengersAfter?passengers:Math.min(Math.max(0,city.passengers-(passengersAfter-passengers)),city.population*.9);
    if(mail!==undefined)city.mail=city.mail===mailAfter?mail:Math.min(Math.max(0,city.mail-(mailAfter-mail)),city.population*MAIL_POOL_SHARE);
  }
  for(const [city,delta] of entry.disturbed)if(towns.has(city)){const left=Math.max(0,(city.disturbance||0)-delta);if(left)city.disturbance=left;else delete city.disturbance;}
  for(const building of entry.owners)delete building.populationCityId;
  pinned.delete(game.tiles);
  const {before,after,ids}=entry.notices,notices=game.notifications;
  game.notifications=notices.length===after.length&&notices.every((notice,n)=>notice===after[n])?before.slice():notices.filter(notice=>!ids.has(notice.id));
  // A later month already booked the spend, so its figures only fall to zero.
  const [[money,monthly,total],[moneyAfter,monthlyAfter,totalAfter]]=entry.money,cost=entry.cost;
  game.money=game.money===moneyAfter?money:game.money+cost;
  game.monthlyExpenses=game.monthlyExpenses===monthlyAfter?monthly:Math.max(0,game.monthlyExpenses-cost);
  game.totalExpenses=game.totalExpenses===totalAfter?total:Math.max(0,game.totalExpenses-cost);
  if(game.nextId===entry.nextId[1])game.nextId=entry.nextId[0];
  if(entry.network)invalidateNetworkPoints(game,entry.points);else game.revision++;
  entry.done=true;
  return {ok:true,message:`${undoLabel(entry)}.${cost>0?` ${moneyText(cost)} refunded.`:''}`,cost};
}
