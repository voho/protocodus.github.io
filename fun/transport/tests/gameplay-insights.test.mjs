import test from 'node:test';
import assert from 'node:assert/strict';
import { townService, industryStatus, industryService, routeHealth, nextProject, stopSiteKind, firstRouteSteps, routesNeedingAttention, routeNeedsAttention } from '../gameplay-insights.js';
import { build, buildPath, addRoute, tick, createGame } from '../model.js';
import { industryContains, industryDistance } from '../industry-sites.js';
import { emptyGame, line, advance, tileAt } from './helpers.mjs';
import { routeBreakPoint, refreshRouteConnections } from '../model.js';
import { buildPlan } from '../construction-plan.js';

const site = (id, kind, x, inventory = {}) => ({ id, kind, x, y: 12, inventory, capacity: 1 });
const routeGame = () => ({
  day: 10, cities: [], industries: [site('source','logging-camp',10),site('buyer','sawmill',30)],
  stations: [{id:'a',x:10,y:10},{id:'b',x:30,y:10}],
  routes: [{id:'r',active:true,cargo:'timber',stops:['a','b']}], vehicles: [],
});

test('town service distinguishes planned coverage from recent deliveries and uses the real five-tile radius', () => {
  const game=routeGame(),city={x:10,y:15,lastServiceDay:null};
  assert.equal(townService(game,city).label,'Awaiting deliveries');
  city.lastServiceDay=5;assert.equal(townService(game,city).served,true);
  city.y=15.1;assert.equal(townService(game,city).connected,false);
  city.y=15;city.lastServiceDay=-30;assert.equal(townService(game,city).served,false);
  game.routes[0].active=false;assert.equal(townService(game,city).label,'No service');
});

test('factory explanations identify every missing ingredient and distinguish full stock from production', () => {
  const mill=site('mill','steel-mill',10,{coal:100});
  assert.deepEqual(industryStatus(mill).missing,['iron']);
  mill.inventory.iron=.01;assert.equal(industryStatus(mill).state,'producing','fractional recipes can operate');
  mill.inventory.steel=900;assert.equal(industryStatus(mill).state,'full');
  mill.capacity=2;assert.equal(industryStatus(mill).state,'backlog','capacity also controls storage');
});

test('a half-full store is more to carry, and names the route another vehicle would help', () => {
  const game=routeGame(),quarry=site('quarry','quarry',10,{stone:540});game.industries=[quarry];Object.assign(game.routes[0],{name:'Stone run',cargo:'stone'});
  assert.deepEqual(industryStatus(quarry),{state:'backlog',label:'More to carry',missing:[],detail:'Stock is building up. Another vehicle would earn more and let it expand.'});
  quarry.inventory.stone=449;assert.equal(industryStatus(quarry,game).state,'producing','under half full the site keeps growing');
  quarry.inventory.stone=540;assert.equal(industryStatus(quarry,game).detail,'Another vehicle on Stone run would carry more.');
  quarry.inventory.stone=900;assert.equal(industryStatus(quarry,game).label,'Storage full');assert.equal(industryStatus(quarry,game).detail,'Another vehicle on Stone run would carry more.');
  assert.equal(industryStatus(quarry).detail,'Carry output to a buyer to make room.','the one-argument form is unchanged');
  game.routes[0].stops=['b','a'];assert.equal(industryStatus(quarry,game).detail,'Carry output to a buyer to make room.','a route that only unloads here carries nothing away');
  game.routes[0].stops=['a','b'];game.routes[0].active=false;assert.equal(industryStatus(quarry,game).detail,'Carry output to a buyer to make room.');
  game.routes[0].active=true;game.routes[0].cargo='timber';assert.equal(industryStatus(quarry,game).detail,'Carry output to a buyer to make room.');
});

test('route diagnostics explain missing customers, empty sources and blocked processing', () => {
  const game=routeGame(),route=game.routes[0];
  assert.equal(routeHealth(game,route).label,'Waiting for cargo');
  game.vehicles.push({routeId:'r',load:10});assert.equal(routeHealth(game,route).state,'running');
  game.industries[1].inventory.timber=900;assert.equal(routeHealth(game,route).label,'Buyer full');
  game.industries.pop();assert.equal(routeHealth(game,route).label,'No buyer');
  game.industries=[];assert.equal(routeHealth(game,route).label,'No producer');
  route.active=false;assert.equal(routeHealth(game,route).label,'Disconnected');
});

test('route diagnostics measure industries to their nearest footprint tile, like the simulation', () => {
  const game=routeGame(),route=game.routes[0];
  for(const industry of game.industries)industry.footprint=2;
  game.stations=[{id:'a',x:16,y:13},{id:'b',x:25,y:13}];game.vehicles.push({routeId:'r',load:10});
  assert.equal(routeHealth(game,route).label,'Running','both stops sit five tiles from a footprint edge but farther from the anchor');
  game.stations[0].x=17;assert.equal(routeHealth(game,route).label,'No producer');
});

test('a working iron route beside large sites reads as running and names its cargo cleanly', () => {
  const game=emptyGame();
  assert.equal(build(game,'iron-mine',20,40).ok,true);assert.equal(build(game,'steel-mill',60,40).ok,true);
  assert.equal(buildPath(game,'road',line(24,56,41)).ok,true);
  assert.equal(build(game,'bus-stop',26,41).ok,true);assert.equal(build(game,'bus-stop',55,41).ok,true);
  const result=addRoute(game,{name:'Ore run',mode:'road',stops:game.stations.map(stop=>stop.id),cargo:'iron'});
  assert.equal(result.ok,true,result.message);
  advance(game,60,tick);
  const route=game.routes[0];assert.ok(route.delivered>0,'the simulation delivers the ore');
  assert.match(routeHealth(game,route).state,/^(running|busy)$/,'a working route may ask for more trucks but is never blocked');
  const missing=routeHealth({...game,industries:game.industries.filter(site=>site.kind!=='iron-mine')},route);
  assert.equal(missing.label,'No producer');assert.doesNotMatch(missing.detail,/\ba iron/);assert.match(missing.detail,/producer of iron ore/);
});

test('industry service marks the sites a freight route loads at and delivers to, never a passenger stop', () => {
  const game=emptyGame();
  assert.equal(build(game,'iron-mine',20,40).ok,true);assert.equal(build(game,'steel-mill',60,40).ok,true);assert.equal(build(game,'quarry',30,44).ok,true);
  assert.equal(buildPath(game,'road',line(24,56,41)).ok,true);
  assert.equal(build(game,'bus-stop',26,41).ok,true);assert.equal(build(game,'bus-stop',55,41).ok,true);
  const [mine,mill,quarry]=game.industries,stops=game.stations.map(stop=>stop.id);
  assert.deepEqual(industryService(game),new Map(),'stops alone serve nothing');
  assert.equal(build(game,'city',25,37).ok,true);assert.equal(build(game,'city',56,37).ok,true);
  assert.equal(addRoute(game,{mode:'road',stops,cargo:'passengers'}).ok,true);
  assert.deepEqual(industryService(game),new Map(),'a passenger stop beside the mine does not serve it');
  assert.equal(addRoute(game,{name:'Ore run',mode:'road',stops,cargo:'iron'}).ok,true);
  const service=industryService(game),ore=game.routes[1];
  assert.deepEqual(service.get(mine.id),{source:true,buyer:false,color:ore.color},'the mine loads the ore');
  assert.deepEqual(service.get(mill.id),{source:false,buyer:true,color:ore.color},'the mill takes it');
  assert.equal(service.has(quarry.id),false,'a covered quarry does not produce iron ore');
  assert.equal(build(game,'bulldoze',40,41).ok,true);refreshRouteConnections(game);
  assert.equal(ore.active,false);assert.equal(industryService(game).size,0,'a broken connection serves nothing');
});

test('a broken route names the first gap on its old path, using the pathfinder’s own rules', () => {
  const game=emptyGame();
  assert.equal(build(game,'iron-mine',20,40).ok,true);assert.equal(build(game,'steel-mill',60,40).ok,true);
  assert.equal(buildPath(game,'road',line(24,56,41)).ok,true);
  assert.equal(build(game,'bus-stop',26,41).ok,true);assert.equal(build(game,'bus-stop',55,41).ok,true);
  assert.equal(addRoute(game,{mode:'road',stops:game.stations.map(stop=>stop.id),cargo:'iron'}).ok,true);
  const route=game.routes[0];assert.equal(routeBreakPoint(game,route),null,'a running route has no break');
  assert.equal(build(game,'bulldoze',40,41).ok,true);refreshRouteConnections(game);
  assert.equal(route.active,false);assert.deepEqual(routeBreakPoint(game,route),{x:40,y:41,index:14},'the bulldozed tile is the break');
  assert.equal(build(game,'bulldoze',30,41).ok,true);assert.deepEqual(routeBreakPoint(game,route),{x:30,y:41,index:4},'the first gap from the start stop wins');
  assert.equal(build(game,'road',30,41).ok,true);assert.deepEqual(routeBreakPoint(game,route),{x:40,y:41,index:14},'the remaining gap is reported');
  assert.equal(build(game,'road',40,41).ok,true);const middle=Math.floor(route.path.length/2);
  assert.deepEqual(routeBreakPoint(game,route),{x:route.path[middle].x,y:41,index:middle},'an intact path awaiting its refresh falls back to the midpoint');
  refreshRouteConnections(game);assert.equal(route.active,true);assert.equal(routeBreakPoint(game,route),null,'a repaired route is clear');
  assert.equal(routeBreakPoint(game,{...route,active:false,path:[]}),null,'a route without a path has no pin');
});

test('a processing route points back to its missing input instead of recommending more vehicles', () => {
  const game=routeGame();game.routes[0].cargo='steel';
  game.industries=[site('source','steel-mill',10,{coal:5}),site('buyer','machine-works',30)];
  assert.equal(routeHealth(game,game.routes[0]).label,'Needs inputs');
  assert.match(routeHealth(game,game.routes[0]).detail,/iron/);
});

test('a running route turns busy when cargo or passengers pile up beyond two full loads', () => {
  const game=routeGame(),route=game.routes[0];
  game.industries[0].inventory.timber=900;game.vehicles.push({routeId:'r',load:0,capacity:24});
  let health=routeHealth(game,route);
  assert.deepEqual([health.state,health.label,health.waiting,health.capacity],['busy','Cargo piling up',900,24]);
  assert.equal(health.detail,'About 38 loads. Add a truck.','the card shows the count beside it; the detail says what to do');
  assert.equal(routeHealth(game,route,{capacity:480}).state,'running','the caller may pass the fleet capacity it already summed');
  game.industries[0].inventory.timber=40;health=routeHealth(game,route);
  assert.deepEqual([health.state,health.waiting,health.capacity],['running',40,24]);
  const towns=routeGame();Object.assign(towns.routes[0],{cargo:'passengers',mode:'road'});towns.industries=[];towns.vehicles.push({routeId:'r',load:0,capacity:24});
  towns.cities=[{id:'west',x:10,y:12,passengers:800.7},{id:'east',x:30,y:12,passengers:50}];
  health=routeHealth(towns,towns.routes[0]);
  assert.deepEqual([health.state,health.label,health.waiting],['busy','Passengers waiting',50],'the quieter town limits what another bus can carry');
  assert.equal(health.detail,'About 2 loads. Add a bus.');
  towns.cities[1].passengers=40;health=routeHealth(towns,towns.routes[0]);
  assert.deepEqual([health.state,health.waiting],['running',40]);
});

test('routes need attention only while they cannot run, and the count follows every cause', () => {
  const game=emptyGame();
  assert.equal(build(game,'logging-camp',10,10).ok,true);assert.equal(build(game,'sawmill',30,10).ok,true);
  assert.equal(buildPath(game,'road',line(10,30,12)).ok,true);
  assert.equal(build(game,'bus-stop',10,12).ok,true);assert.equal(build(game,'bus-stop',30,12).ok,true);
  const stops=game.stations.map(stop=>stop.id);
  for(const name of ['Timber one','Timber two'])assert.equal(addRoute(game,{name,mode:'road',stops,cargo:'timber'}).ok,true);
  const [one,two]=game.routes;
  assert.equal(routeHealth(game,one).state,'waiting');assert.equal(routesNeedingAttention(game),0,'waiting for cargo is normal, not a fault');
  game.industries[0].inventory.timber=900;game.revision++;
  assert.equal(routeHealth(game,one).state,'busy');assert.equal(routesNeedingAttention(game),0,'a busy route is an opportunity, not a fault');
  two.active=false;
  assert.equal(routesNeedingAttention(game),1,'a route going offline counts without any revision change');
  assert.deepEqual([routeNeedsAttention(game,one),routeNeedsAttention(game,two)],[false,true]);
  two.active=true;assert.equal(routesNeedingAttention(game),0);
  assert.equal(build(game,'bulldoze',10,10).ok,true);
  assert.equal(routeHealth(game,one).label,'No producer');assert.equal(routesNeedingAttention(game),2,'both services lost their producer');
  assert.equal(build(game,'logging-camp',6,13).ok,true);assert.equal(routesNeedingAttention(game),0,'a new producer in reach restores them');
});

test('optional projects progress through deliberate freight and town building, not passive starter bus revenue', () => {
  const game=emptyGame();game.cities=[{id:'home',name:'Home',x:15,y:12,lastServiceDay:null}];
  game.industries=[site('source','logging-camp',10),site('buyer','sawmill',30),site('furniture','furniture-factory',50)];
  const exists=project=>assert.ok(!project.target||[...game.industries,...game.cities].some(item=>item.id===project.target),project.title);
  game.totalDelivered=10000;game.routes=[{cargo:'passengers',delivered:10000}];
  assert.equal(nextProject(game).target,'source');exists(nextProject(game));
  game.routes.push({cargo:'timber',delivered:10});assert.match(nextProject(game).title,/100/);assert.deepEqual(nextProject(game).progress,{value:10,max:100});
  game.routes[1].delivered=100;
  let project=nextProject(game);assert.equal(project.action,'source');assert.equal(project.target,'source');assert.equal(project.buyer.id,'buyer');exists(project);
  assert.match(project.detail,/Timber from Logging camp → Sawmill \(20 tiles\)\. Sawmills turn 4 timber into 3 lumber\./);
  game.stations=[{id:'a',x:10,y:10,mode:'road'},{id:'b',x:30,y:10,mode:'road'}];game.routes[1].stops=['a','b'];
  project=nextProject(game);assert.equal(project.title,'Carry lumber onward');assert.equal(project.target,'buyer');assert.equal(project.buyer.id,'furniture');assert.match(project.detail,/Sawmill → Furniture works/);exists(project);
  game.routes.push({cargo:'lumber',delivered:1});
  project=nextProject(game);assert.equal(project.action,'city');assert.equal(project.target,'home');exists(project);
  game.zones.push({x:1,y:1});project=nextProject(game);assert.equal(project.milestone,'processing','then the milestone ladder, where fares still never count');assert.deepEqual(project.choices,['processing','town-supply']);
});

test('first cargo suggestions skip producers that no stop can ever reach and offer distinct alternatives', () => {
  const game=emptyGame();game.cities=[{id:'home',name:'Home',x:40,y:20,lastServiceDay:null}];
  const quarry={id:'quarry',kind:'quarry',name:'Stone quarry',x:30,y:20,footprint:2,inventory:{},capacity:1};
  game.industries=[quarry,{...site('camp','logging-camp',70),y:40,footprint:2},{...site('mill','sawmill',90),y:40,footprint:2}];
  assert.equal(nextProject(game).target,'quarry','an open quarry beside town is the obvious first route');
  for(let y=14;y<=27;y++)for(let x=24;x<=37;x++)if(!industryContains(quarry,x,y)&&industryDistance(quarry,{x,y})<=6)tileAt(game,x,y).terrain='mountain';
  game.networkRevision++;
  assert.equal(stopSiteKind(game,quarry),null);assert.equal(stopSiteKind(game,game.cities[0]),'road');
  const project=nextProject(game);
  assert.equal(project.target,'camp');assert.ok(project.choices.every(choice=>choice.source.id!=='quarry'));
  assert.match(project.detail,/Carry timber from Logging camp to Sawmill/);
  for(let y=19;y<=22;y++)tileAt(game,25,y).terrain='water';game.networkRevision++;
  assert.equal(stopSiteKind(game,quarry),'port','shoreline water still takes a port');
  assert.equal(nextProject(game).target,'camp','port-only sites rank behind road access');
  assert.deepEqual(nextProject(game).choices.map(choice=>choice.source.id),['camp','quarry']);
  assert.equal(nextProject(game,{source:'quarry'}).target,'quarry','a chosen alternative stays selected');
  assert.equal(nextProject(game,{source:'quarry'}).choice,1);
  assert.equal(nextProject(game,{source:'gone'}).target,'camp');
  assert.equal(nextProject(game).plan,'road');assert.equal(nextProject(game,{source:'quarry'}).plan,null,'a port-only site is never planned as a road');
});

test('the first route card offers a planned line until the two ends are joined', () => {
  const game=createGame({biome:'taiga',seed:1847});
  assert.equal(nextProject(game).plan,'road','the quarry and Alderbrook are not joined yet');
  assert.equal(buildPlan(game,'road',Array.from({length:7},(_,n)=>({x:219,y:251-n}))).ok,true);assert.equal(build(game,'bus-stop',219,251).ok,true);
  const project=nextProject(game);
  assert.deepEqual(project.steps.map(step=>step.done),[true,true,true,false,false]);assert.equal(project.plan,null,'a joined pair needs no plan');
});

test('first route steps tick exactly when each stop, connection, route and delivery exists', () => {
  const game=emptyGame();game.cities=[{id:'town',name:'Town',x:40,y:41,population:400,activity:0,growth:0,passengers:0,delivered:0,supplies:0,lastServiceDay:null}];
  assert.equal(build(game,'quarry',10,40).ok,true);
  const quarry=game.industries[0],choice={source:quarry,buyer:{id:'town',kind:'city',name:'Town',x:40,y:41},cargo:'stone'};
  const done=()=>firstRouteSteps(game,choice).map(step=>step.done);
  assert.deepEqual(firstRouteSteps(game,choice).map(step=>step.label),['Stop near Stone quarry','Stop near Town','Connect them','Launch a stone route','First delivery']);
  assert.deepEqual(done(),[false,false,false,false,false]);
  assert.equal(firstRouteSteps(game,choice)[0].tool,'road','no road yet: build one first');
  assert.equal(buildPath(game,'road',line(17,30,41)).ok,true);assert.equal(build(game,'road',37,41).ok,true);
  assert.equal(firstRouteSteps(game,choice)[0].tool,'road','the road stops six tiles from the footprint');
  assert.equal(build(game,'bus-stop',17,41).ok,true);
  assert.deepEqual(done(),[false,false,false,false,false],'six tiles from the footprint is outside the catchment');
  assert.equal(build(game,'bulldoze',17,41).ok,true);assert.equal(buildPath(game,'road',line(16,17,41)).ok,true);
  assert.equal(firstRouteSteps(game,choice)[0].tool,'bus-stop');assert.equal(firstRouteSteps(game,choice)[0].button,'Place stop');
  assert.equal(build(game,'bus-stop',16,41).ok,true);
  assert.deepEqual(done(),[true,false,false,false,false],'five tiles from the footprint edge counts although the anchor is farther');
  assert.equal(build(game,'bus-stop',37,41).ok,true);
  assert.deepEqual(done(),[true,true,false,false,false],'two stops on separate roads are not connected');
  assert.equal(buildPath(game,'road',line(30,37,41)).ok,true);
  assert.deepEqual(done(),[true,true,true,false,false]);
  const launch=firstRouteSteps(game,choice)[3];assert.deepEqual([launch.mode,launch.from,launch.to,launch.cargo],['road',game.stations[0].id,game.stations[1].id,'stone']);
  assert.equal(addRoute(game,{mode:'road',stops:[game.stations[1].id,game.stations[0].id],cargo:'stone'}).ok,true);
  assert.deepEqual(done(),[true,true,true,true,false]);
  for(let day=0;day<60&&!game.routes[0].delivered;day++)advance(game,1,tick);
  assert.ok(game.routes[0].delivered>0);assert.deepEqual(done(),[true,true,true,true,true]);
});

test('next projects are memoised without going stale as the company grows', () => {
  const game=emptyGame();
  game.cities=[{id:'town',name:'Town',x:40,y:41,population:400,activity:0,growth:0,passengers:0,delivered:0,supplies:0,lastServiceDay:null}];
  assert.equal(build(game,'quarry',10,40).ok,true);assert.equal(build(game,'logging-camp',10,70).ok,true);assert.equal(build(game,'sawmill',40,70).ok,true);
  const same=label=>assert.deepEqual(nextProject(game),nextProject(structuredClone(game)),label);
  same('fresh world');
  assert.equal(buildPath(game,'road',line(16,37,41)).ok,true);assert.equal(build(game,'bus-stop',16,41).ok,true);assert.equal(build(game,'bus-stop',37,41).ok,true);
  same('stops and roads');
  assert.equal(addRoute(game,{mode:'road',stops:game.stations.map(stop=>stop.id),cargo:'stone'}).ok,true);
  same('a route');
  assert.equal(build(game,'city',80,20).ok,true);same('a founded town');
  assert.equal(build(game,'refinery',60,20).ok,true);same('a new industry');
  for(let day=0;day<400&&game.routes[0].delivered<100;day++)advance(game,1,tick);
  assert.ok(game.routes[0].delivered>=100);assert.equal(nextProject(game).title,'Supply a factory');same('100 deliveries');
});

test('the first cargo suggestion is cheap to repeat on a vast world', () => {
  const game=createGame({biome:'taiga',seed:1847,size:'square2048'});
  const first=nextProject(game);assert.equal(first.title,'Your first cargo route');
  const start=performance.now();nextProject(game);const elapsed=performance.now()-start;
  assert.ok(elapsed<1,`${elapsed.toFixed(2)} ms`);
});
