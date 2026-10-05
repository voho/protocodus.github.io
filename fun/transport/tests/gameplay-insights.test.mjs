import test from 'node:test';
import assert from 'node:assert/strict';
import { townService, industryStatus, industryService, routeHealth, nextProject, stopSiteKind, firstRouteSteps, routesNeedingAttention, routeNeedsAttention } from '../gameplay-insights.js';
import { routeCapacity } from '../gameplay-insights.js';
import { scheduledDays } from '../economy-pricing.js';
import { build, buildPath, addRoute, tick, createGame, passengerEndpoints } from '../model.js';
import { industryContains, industryDistance } from '../industry-sites.js';
import { emptyGame, line, advance, tileAt } from './helpers.mjs';
import { routeBreakPoint, refreshRouteConnections } from '../model.js';
import { buildPlan } from '../construction-plan.js';
import { fullLoadQueue } from '../gameplay-insights.js';

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
  game.routes[0].active=false;assert.equal(townService(game,city).label,'No route yet');
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
  const reason='{industry:quarry} grows while its {cargo:stone} is carried away. A route to a buyer would do that.';
  assert.deepEqual(industryStatus(quarry),{state:'backlog',tone:'warn',word:'Output piling up',label:'Output piling up',reason,detail:'Stone quarry grows while its stone is carried away. A route to a buyer would do that.',missing:[]});
  quarry.inventory.stone=449;assert.equal(industryStatus(quarry,game).state,'producing','under half full the site keeps growing');
  quarry.inventory.stone=540;assert.equal(industryStatus(quarry,game).detail,'Another truck on Stone run would carry more, and let Stone quarry grow.');
  assert.equal(industryStatus(quarry,game).reason,'Another truck on {route:r} would carry more, and let {industry:quarry} grow.');
  quarry.inventory.stone=810;assert.equal(industryStatus(quarry,game).state,'full','nine tenths full reads as nearly full');
  quarry.inventory.stone=900;assert.equal(industryStatus(quarry,game).label,'Storage nearly full');assert.equal(industryStatus(quarry,game).detail,'Another truck on Stone run would carry more.');
  const room='Stone quarry has almost no room left. A route to a buyer would carry its stone away.';
  assert.equal(industryStatus(quarry).detail,room,'the one-argument form is unchanged');
  game.routes[0].stops=['b','a'];assert.equal(industryStatus(quarry,game).detail,room,'a route that only unloads here carries nothing away');
  game.routes[0].stops=['a','b'];game.routes[0].active=false;assert.equal(industryStatus(quarry,game).detail,room);
  game.routes[0].active=true;game.routes[0].cargo='timber';assert.equal(industryStatus(quarry,game).detail,room);
});

test('route diagnostics explain missing customers, empty sources and blocked processing', () => {
  const game=routeGame(),route=game.routes[0];
  assert.deepEqual([routeHealth(game,route).state,routeHealth(game,route).label],['running','Running'],'waiting for the supplier is normal running');
  route.delivered=0;assert.deepEqual([routeHealth(game,route).label,routeHealth(game,route).tone],['First trip','info'],'before its first delivery a route is on its first trip');delete route.delivered;
  game.vehicles.push({routeId:'r',load:10});assert.equal(routeHealth(game,route).state,'running');
  game.industries[1].inventory.timber=900;assert.deepEqual([routeHealth(game,route).state,routeHealth(game,route).label],['running','Stores full'],'a full buyer still takes and pays');
  assert.equal(routeHealth(game,route).detail,'Deliveries still pay while Sawmill works through its timber.');
  game.industries[1].inventory.lumber=450;assert.equal(routeHealth(game,route).detail,'Deliveries still pay. Carry lumber away from Sawmill and it will use more timber.');
  game.industries.pop();assert.equal(routeHealth(game,route).label,'No buyer');
  game.industries=[];assert.equal(routeHealth(game,route).label,'No supplier');
  route.active=false;assert.equal(routeHealth(game,route).label,'Not connected');
});

test('route diagnostics measure industries to their nearest footprint tile, like the simulation', () => {
  const game=routeGame(),route=game.routes[0];
  for(const industry of game.industries)industry.footprint=2;
  game.stations=[{id:'a',x:16,y:13},{id:'b',x:25,y:13}];game.vehicles.push({routeId:'r',load:10});
  assert.equal(routeHealth(game,route).label,'Running','both stops sit five tiles from a footprint edge but farther from the anchor');
  game.stations[0].x=17;assert.equal(routeHealth(game,route).label,'No supplier');
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
  assert.equal(routeHealth(game,route).state,'running','a working route reads Running, whatever waits for it');
  const missing=routeHealth({...game,industries:game.industries.filter(site=>site.kind!=='iron-mine')},route);
  assert.equal(missing.label,'No supplier');assert.doesNotMatch(missing.detail,/\ba iron/);assert.match(missing.detail,/supplies iron ore/);
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
  assert.equal(routeHealth(game,game.routes[0]).label,'Needs iron ore');
  assert.match(routeHealth(game,game.routes[0]).detail,/iron/);
});

test('spare demand is never a state: a working route reads Running, and routeCapacity offers room after its first month', () => {
  const game=routeGame(),route=game.routes[0],path=Array.from({length:21},(_,n)=>({x:10+n,y:10}));Object.assign(route,{mode:'road',path});
  game.industries[0].inventory.timber=900;game.vehicles.push({routeId:'r',load:0,capacity:24});
  let health=routeHealth(game,route);
  assert.deepEqual([health.state,health.tone,health.label,health.waiting,health.capacity,health.fix],['running','ok','Running',900,24,undefined],'900 waiting for one truck still reads Running');
  assert.doesNotMatch(health.detail,/\bAdd\b|Another/,'health never asks for a vehicle');
  assert.equal(routeCapacity(game,route).room,false,'a route younger than a month offers nothing yet');
  game.day=40;
  let capacity=routeCapacity(game,route);
  assert.deepEqual([capacity.waiting,capacity.capacity,capacity.room],[900,24,true]);
  assert.equal(capacity.perMonth,Math.round(24*30/(2*scheduledDays('road',20,0))),'one more truck of today’s model, loaded one way');
  assert.equal(routeCapacity(game,route,{capacity:480}).room,false,'the caller may pass the fleet capacity it already summed');
  assert.equal(routeCapacity(game,route,null,health).room,true,'and the health it already read');
  game.industries[0].inventory.timber=49;assert.equal(routeCapacity(game,route).room,false,'under 50 never makes room');
  game.industries[0].inventory.timber=900;route.active=false;assert.equal(routeCapacity(game,route).room,false,'a route that cannot run has no room');
  route.active=true;Object.assign(route,{fullLoad:true});game.vehicles[0].fullLoadSince=39;
  assert.deepEqual([routeHealth(game,route).label,routeCapacity(game,route).room],['Loading',false],'a full-load line means one vehicle fewer would do');
  const towns=routeGame();Object.assign(towns.routes[0],{cargo:'passengers',mode:'road',path});towns.industries=[];towns.day=40;towns.vehicles.push({routeId:'r',load:0,capacity:24});
  towns.cities=[{id:'west',x:10,y:12,passengers:800.7},{id:'east',x:30,y:12,passengers:95}];
  health=routeHealth(towns,towns.routes[0]);
  assert.deepEqual([health.state,health.label,health.waiting],['running','Running',95],'the quieter town sets the waiting count');
  assert.equal(routeCapacity(towns,towns.routes[0]).room,false,'passengers need four full loads in the quieter town');
  towns.cities[1].passengers=96.2;capacity=routeCapacity(towns,towns.routes[0]);
  assert.deepEqual([capacity.waiting,capacity.room],[96,true]);
  assert.equal(capacity.perMonth,Math.round(2*24*30/(2*scheduledDays('road',20,0))),'a bus loads at both ends');
  assert.equal(routesNeedingAttention(game)+routesNeedingAttention(towns),0,'room never counts as attention');
});

test('a buyer with full stores keeps paying, and names the input that would set it working', () => {
  const game=routeGame(),route=game.routes[0];Object.assign(route,{cargo:'coal',delivered:40});
  game.industries=[site('source','coal-mine',10,{coal:30}),site('buyer','steel-mill',30,{coal:900})];game.vehicles.push({routeId:'r',load:24,capacity:24});
  let health=routeHealth(game,route);
  assert.deepEqual([health.state,health.tone,health.word,health.fix],['running','info','Stores full',undefined]);
  assert.equal(health.reason,'Deliveries still pay. Supply {cargo:iron} too and {industry:buyer} will make {cargo:steel}.');
  assert.equal(health.detail,'Deliveries still pay. Supply iron ore too and Steel mill will make steel.');
  assert.equal(routeNeedsAttention(game,route),false);
  game.vehicles[0].load=0;game.industries[0].inventory.coal=0;
  assert.equal(routeHealth(game,route).word,'Stores full','between loads the card still names the buyer');
  game.industries[0].inventory.coal=30;game.industries[1].inventory.coal=899;health=routeHealth(game,route);
  assert.deepEqual([health.state,health.word],['running','Running'],'room in the store reads as running');
});

test('a full-load route reads Loading while its trucks wait, naming the head of the line and how many wait behind it', () => {
  const game=routeGame(),route=game.routes[0];route.fullLoad=true;
  game.vehicles.push({id:'v5',routeId:'r',load:10,capacity:24,fullLoadSince:5});
  let health=routeHealth(game,route);
  assert.deepEqual([health.state,health.tone,health.label,health.detail],['running','ok','Loading','Waiting for a full load, 10 of 24.']);
  game.vehicles.unshift({id:'v6',routeId:'r',load:0,capacity:24,fullLoadSince:6},{id:'v7',routeId:'r',load:0,capacity:24,fullLoadSince:7});
  health=routeHealth(game,route);
  assert.equal(health.detail,'Waiting for a full load, 10 of 24, with 2 more in line.','the head is the earliest arrival, wherever it sits in the fleet');
  assert.deepEqual([health.waiting,health.capacity],[0,72]);
  const queue=fullLoadQueue(game,'r');
  assert.deepEqual([queue.count,queue.head.id],[3,'v5']);
  assert.deepEqual(routeHealth(game,route,{capacity:72,queue}),health,'the caller may pass the line it already found');
  assert.equal(routeNeedsAttention(game,route),false,'loading is the order at work, not a fault');
  game.vehicles.length=0;game.vehicles.push({id:'v8',routeId:'r',load:0,capacity:24});game.industries[0].inventory.timber=40;
  health=routeHealth(game,route);
  assert.deepEqual([health.label,health.detail],['Running','Trucks leave the start full, or after a month at most.']);
});

test('a waiting truck still points a stalled factory back to its missing input', () => {
  const game=routeGame(),route=game.routes[0];Object.assign(route,{cargo:'steel',fullLoad:true});
  game.industries=[site('source','steel-mill',10,{coal:5}),site('buyer','machine-works',30)];
  game.vehicles.push({id:'v1',routeId:'r',load:5,capacity:24,fullLoadSince:3});
  assert.equal(routeHealth(game,route).label,'Needs iron ore');
});

test('a route without full load never reads the line and reads as before', () => {
  const game=routeGame(),route=game.routes[0];let reads=0;
  const truck={id:'v1',routeId:'r',load:10,capacity:24};
  const before=routeHealth(game,route);game.vehicles.push(truck);const loaded=routeHealth(game,route);
  Object.defineProperty(truck,'fullLoadSince',{get(){reads++;return 5;},enumerable:true});
  assert.deepEqual(routeHealth(game,route),loaded);assert.equal(reads,0);
  game.vehicles.length=0;assert.deepEqual(routeHealth(game,route),before);
  route.fullLoad=false;game.vehicles.push(truck);assert.deepEqual(routeHealth(game,route),loaded);assert.equal(reads,0);
});

test('routes need attention only while they cannot run, and the count follows every cause', () => {
  const game=emptyGame();
  assert.equal(build(game,'logging-camp',10,10).ok,true);assert.equal(build(game,'sawmill',30,10).ok,true);
  assert.equal(buildPath(game,'road',line(10,30,12)).ok,true);
  assert.equal(build(game,'bus-stop',10,12).ok,true);assert.equal(build(game,'bus-stop',30,12).ok,true);
  const stops=game.stations.map(stop=>stop.id);
  for(const name of ['Timber one','Timber two'])assert.equal(addRoute(game,{name,mode:'road',stops,cargo:'timber'}).ok,true);
  const [one,two]=game.routes;
  assert.equal(routeHealth(game,one).state,'running');assert.equal(routesNeedingAttention(game),0,'waiting for cargo is normal, not a fault');
  game.industries[0].inventory.timber=900;game.revision++;
  assert.equal(routeHealth(game,one).state,'running');assert.equal(routesNeedingAttention(game),0,'spare demand is an opportunity, not a fault');
  two.active=false;
  assert.equal(routesNeedingAttention(game),1,'a route going offline counts without any revision change');
  assert.deepEqual([routeNeedsAttention(game,one),routeNeedsAttention(game,two)],[false,true]);
  two.active=true;assert.equal(routesNeedingAttention(game),0);
  assert.equal(build(game,'bulldoze',10,10).ok,true);
  assert.equal(routeHealth(game,one).label,'No supplier');assert.equal(routesNeedingAttention(game),2,'both routes lost their supplier');
  assert.equal(build(game,'logging-camp',6,13).ok,true);assert.equal(routesNeedingAttention(game),0,'a new producer in reach restores them');
});

test('optional projects progress through deliberate freight and town building, not passive starter bus revenue', () => {
  const game=emptyGame();game.cities=[{id:'home',name:'Home',x:15,y:12,lastServiceDay:null}];
  game.industries=[site('source','logging-camp',10),site('buyer','sawmill',30),site('furniture','furniture-factory',50)];
  const exists=project=>assert.ok(!project.target||[...game.industries,...game.cities].some(item=>item.id===project.target),project.title);
  game.totalDelivered=10000;game.routes=[{cargo:'passengers',delivered:10000}];
  assert.equal(nextProject(game).target,'source');exists(nextProject(game));
  game.routes.push({cargo:'timber',delivered:10});assert.match(nextProject(game).title,/100/);assert.deepEqual(nextProject(game).progress,{value:10,max:100});
  assert.equal(nextProject(game).detail,'10 of 100 delivered. Every freight delivery counts; passengers and mail don’t.','the goal says what counts, not what to keep doing');
  game.routes[1].delivered=100;
  let project=nextProject(game);assert.equal(project.action,'source');assert.equal(project.target,'source');assert.equal(project.buyer.id,'buyer');exists(project);
  assert.match(project.detail,/Carry timber from Logging camp to Sawmill, 20 tiles\. Sawmills turn 4 timber into 3 lumber\./);
  game.stations=[{id:'a',x:10,y:10,mode:'road'},{id:'b',x:30,y:10,mode:'road'}];game.routes[1].stops=['a','b'];
  project=nextProject(game);assert.equal(project.title,'Carry lumber onward');assert.equal(project.target,'buyer');assert.equal(project.buyer.id,'furniture');assert.match(project.detail,/from Sawmill to Furniture works/);exists(project);
  game.routes.push({cargo:'lumber',delivered:1});
  project=nextProject(game);assert.equal(project.action,'city');assert.equal(project.target,'home');exists(project);
  game.zones.push({x:1,y:1});project=nextProject(game);assert.equal(project.milestone,'processing','then the milestone ladder, where fares still never count');assert.deepEqual(project.choices,['processing','town-supply']);
});

test('carrying a half-supplied factory’s output onward says its first input pays either way', () => {
  const game=emptyGame();
  game.industries=[site('mine','coal-mine',10),site('mill','steel-mill',30),site('works','machine-works',50)];
  game.stations=[{id:'a',x:10,y:10,mode:'road'},{id:'b',x:30,y:10,mode:'road'}];game.routes=[{cargo:'coal',delivered:150,stops:['a','b']}];
  const project=nextProject(game);
  assert.deepEqual([project.title,project.target,project.buyer.id],['Carry steel onward','mill','works']);
  assert.equal(project.detail,'Carry steel from Steel mill to Machine works, 20 tiles. Steel mill also needs iron ore to make steel; coal deliveries pay either way.');
  assert.doesNotMatch(project.detail,/must|deadline|expires|last chance/i);
});

test('the starter bus reads Running from its first day to its first year, and room stays a quiet opportunity', () => {
  const game=createGame({biome:'taiga',seed:1847,size:'regional'}),starter=game.routes[0],read=()=>[routeHealth(game,starter).state,routeCapacity(game,starter).room];
  assert.deepEqual(read(),['running',false],'day 0: its first trip, and no room before a month has passed');
  for(let day=0;day<30;day++)tick(game,1);
  assert.deepEqual([routeHealth(game,starter).state,routeHealth(game,starter).label],['running','Running'],'day 30');
  for(let day=30;day<365;day++)tick(game,1);
  assert.deepEqual([routeHealth(game,starter).state,routeHealth(game,starter).label],['running','Running'],'day 365');
  assert.equal(read()[1],true,'a year on, towns hold four busloads: room for another bus, never a warning');
  assert.equal(routesNeedingAttention(game),0);
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
  const game=createGame({biome:'taiga',seed:1847,generationVersion:7});
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

// Airports serve towns within seven tiles of any of their twelve tiles, and never an industry.
const airTown = (id, x, y, passengers = 400) => ({ id, name: id, x, y, population: 1500, activity: 0, growth: 0, passengers, mail: 0, delivered: 0, supplies: 0, lastServiceDay: null });
function airGame() { const game = emptyGame(); game.day = game.lastDailyDay = 730; game.lastMonth = 24; return game; }

test('an air route reads Running once it delivers, and No passengers with one town at both ends', () => {
  const game = airGame(); game.cities = [airTown('home', 43, 60, 60), airTown('far', 103, 60, 60)];
  for (const city of game.cities) city.population = 200;
  const a = build(game, 'airport-x', 40, 64).station, b = build(game, 'airport-x', 100, 64).station;
  const { route } = addRoute(game, { mode: 'air', stops: [a.id, b.id], cargo: 'passengers' });
  assert.equal(routeHealth(game, route).word, 'First trip');
  for (let day = 0; day < 20 && !route.delivered; day++) tick(game, 1);
  assert.ok(route.delivered > 0); assert.equal(routeHealth(game, route).word, 'Running');
  game.cities = [game.cities[0]]; game.revision++;
  const health = routeHealth(game, route);
  assert.equal(health.word, 'No passengers'); assert.match(health.detail, /within 7 tiles/);
});

test('town service counts a town seven tiles from any airport tile', () => {
  const game = airGame(); game.cities = [airTown('edge', 45, 72), airTown('home', 43, 58), airTown('far', 103, 60)];
  const a = build(game, 'airport-x', 40, 64).station, b = build(game, 'airport-x', 100, 64).station;
  assert.equal(addRoute(game, { mode: 'air', stops: [a.id, b.id], cargo: 'passengers' }).ok, true);
  assert.equal(townService(game, game.cities[0]).connected, true, 'seven tiles below the runway end');
  game.cities[0].y = 73; assert.equal(townService(game, game.cities[0]).connected, false);
});

test('Waiting reads the town the airport actually serves, measured from its nearest tile', () => {
  const game = airGame();
  // Near the far end of the runway but eight tiles from its anchor, against a town nearer the anchor.
  game.cities = [airTown('runway-end', 47, 66, 100), airTown('by-anchor', 38, 60, 300), airTown('far', 103, 60, 5000)];
  const a = build(game, 'airport-x', 40, 64).station, b = build(game, 'airport-x', 100, 64).station;
  const { route } = addRoute(game, { mode: 'air', stops: [a.id, b.id], cargo: 'passengers' });
  const picked = passengerEndpoints(game, a, b);
  assert.equal(picked[0].id, 'runway-end');
  assert.equal(routeHealth(game, route).waiting, Math.floor(picked[0].passengers));
});

test('the first-route checklist never counts an airport as a stop', () => {
  const game = airGame(); game.cities = [airTown('a', 44, 68), airTown('b', 104, 68)];
  assert.equal(build(game, 'logging-camp', 40, 60).ok, true); assert.equal(build(game, 'sawmill', 100, 60).ok, true);
  assert.equal(build(game, 'airport-x', 40, 64).ok, true); assert.equal(build(game, 'airport-x', 100, 64).ok, true);
  const [camp, mill] = game.industries, choice = { source: camp, buyer: { id: mill.id, kind: 'industry', name: mill.name, x: mill.x, y: mill.y }, cargo: 'timber' };
  const steps = firstRouteSteps(game, choice);
  assert.deepEqual(steps.slice(0, 3).map(step => step.done), [false, false, false]);
  assert.ok(steps.every(step => step.mode !== 'air' && step.tool !== 'air'));
});
