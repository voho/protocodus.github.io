import test from 'node:test';
import assert from 'node:assert/strict';
import {tick,placeVehicle,build,buildPath,addRoute,addRouteVehicle,waitingForFullLoad} from '../model.js';
import {createVehicleMotion} from '../vehicle-motion.js';
import {aircraftPose} from '../air-flight.js';
import {emptyGame,line,equivalent} from './helpers.mjs';

const scalarFields=['progress','dwellRemaining','totalDistance','direction','tripSerial','load','capacity','level','fullLoadSince','x','y','angle'];
function motionEquivalent(actual,expected,label){
  for(const key of scalarFields){
    if(typeof actual[key]==='number'&&typeof expected[key]==='number')assert.ok(Math.abs(actual[key]-expected[key])<1e-8,`${label}.${key}: ${actual[key]} != ${expected[key]}`);
    else assert.equal(actual[key],expected[key],`${label}.${key}`);
  }
}
function fixture(mode){
  const game=emptyGame();
  for(const tile of game.tiles){tile.road=true;tile.rail=true;if(mode==='water')tile.terrain='water';}
  const path=[...line(10,14,20),{x:14,y:21},{x:14,y:22},{x:14,y:23},{x:14,y:24},...line(15,19,24)];
  game.stations.push({id:'motion-a',name:'A',mode,x:10,y:20,...mode==='air'?{axis:'x'}:{}},{id:'motion-b',name:'B',mode,x:19,y:24,...mode==='air'?{axis:'y'}:{}});
  const route={id:'motion-route',name:'Motion',mode,cargo:'passengers',stops:game.stations.map(stop=>stop.id),path,pathRevision:game.networkRevision,active:true,status:'Running',delivered:0,revenue:0,expenses:0,profitThisYear:0};
  game.routes.push(route);
  const vehicle={id:'motion-vehicle',routeId:route.id,progress:.25,direction:1,dwellRemaining:mode==='air'?.55:.13,totalDistance:0,tripSerial:0,load:0,capacity:32,level:0};
  if(mode==='air')vehicle.progress=0;
  placeVehicle(route,vehicle);game.vehicles.push(vehicle);game.revision++;
  return game;
}

for(const mode of ['road','rail','water','air'])test(`recorded ${mode} movement matches fractional simulation through bends, dwell and turnarounds`,()=>{
  const game=fixture(mode),initial=structuredClone(game),motion=createVehicleMotion();motion.captureFinal(game);
  const without=structuredClone(game);tick(without,8);tick(game,8,{motion});assert.deepEqual(game,without,'recording has no authoritative side effects');
  const frozen=structuredClone(game),vehicle=game.vehicles[0],first=motion.sample(game,vehicle,0);
  for(const day of [0,.031,.12,.17,.43,.77,1,1.03,1.81,2.4,3.003,3.91,4.6,5.09,6.17,7.7,8]){
    const reference=structuredClone(initial);if(day>0)tick(reference,day);
    const shown=motion.sample(game,vehicle,day);assert.equal(shown,first,'the presentation proxy is reused');
    motionEquivalent(shown,reference.vehicles[0],`${mode}@${day}`);
    if(mode==='air'){
      const options={heights:()=>.25,cruise:5.4};
      equivalent(aircraftPose(game.routes[0],game.stations,shown,options),aircraftPose(reference.routes[0],reference.stations,reference.vehicles[0],options));
    }
  }
  assert.deepEqual(game,frozen,'sampling never writes saved or economic fields');
});

test('recorded full-load waits retain dwell and apply loading only at the daily release',()=>{
  const game=emptyGame();
  assert.equal(build(game,'logging-camp',10,7).ok,true);assert.equal(build(game,'sawmill',30,7).ok,true);
  assert.equal(buildPath(game,'road',line(10,30,12)).ok,true);
  for(const x of [10,30])assert.equal(build(game,'bus-stop',x,12).ok,true);
  game.industries[0].inventory.timber=0;
  assert.equal(addRoute(game,{mode:'road',cargo:'timber',stops:game.stations.map(stop=>stop.id),fullLoad:true}).ok,true);
  game.industries[0].inventory.timber=20;
  const initial=structuredClone(game),motion=createVehicleMotion();motion.captureFinal(game);tick(game,8,{motion});
  for(const day of [.9,1,1.99,2,2.99,3,3.99,4,4.01,5,7.8,8]){
    const reference=structuredClone(initial);tick(reference,day);
    const shown=motion.sample(game,game.vehicles[0],day);motionEquivalent(shown,reference.vehicles[0],`full-load@${day}`);
    assert.equal(waitingForFullLoad(shown),waitingForFullLoad(reference.vehicles[0]));
  }
  assert.ok(game.vehicles[0].progress>0,'production eventually fills and releases the truck');
});

test('competing fleet histories preserve chronological cargo outcomes through repeated batches',()=>{
  const initial=fixture('road');for(let i=1;i<16;i++)initial.vehicles.push({...initial.vehicles[0],id:`motion-bus-${i}`,progress:i%12,dwellRemaining:0});
  for(const vehicle of initial.vehicles)placeVehicle(initial.routes[0],vehicle);
  initial.revision++;
  const game=structuredClone(initial),motion=createVehicleMotion();motion.captureFinal(game);
  for(let batch=0;batch<4;batch++)tick(game,3,{motion});
  const without=structuredClone(initial);tick(without,12);equivalent(game,without);
  for(const day of [2.3,3,3.07,5.21,6,7.77,9,10.03,11.8]){
    const reference=structuredClone(initial);tick(reference,day);
    for(let i=0;i<game.vehicles.length;i++)motionEquivalent(motion.sample(game,game.vehicles[i],day),reference.vehicles[i],`fleet-${i}@${day}`);
  }
});

test('edited routes and fresh vehicles use their live pose while removed vehicles release history',()=>{
  const game=fixture('road');
  // The shared motion fixture bypasses route launch. This purchase also needs
  // legitimate passenger endpoints because fleet orders revalidate the service.
  game.cities=game.stations.map(({id,name,x,y})=>({id:`town-${id}`,name,x,y,population:300,passengers:0,mail:0,activity:0,growth:0,delivered:0,supplies:0,lastServiceDay:null}));
  game.revision++;
  const motion=createVehicleMotion();motion.captureFinal(game);tick(game,3,{motion});
  const vehicle=game.vehicles[0],proxy=motion.sample(game,vehicle,1);
  game.routes[0].path=[...game.routes[0].path];vehicle.progress=3.2;placeVehicle(game.routes[0],vehicle);
  motionEquivalent(motion.sample(game,vehicle,1),vehicle,'edited path fallback');
  game.routes[0].active=false;
  motionEquivalent(motion.sample(game,vehicle,1),vehicle,'disconnected fallback');
  game.routes[0].active=true;motion.captureFinal(game);
  assert.equal(motion.sample(game,vehicle,3),proxy);
  const purchase=addRouteVehicle(game,game.routes[0].id);assert.equal(purchase.ok,true,purchase.message);
  const added=game.vehicles.at(-1);motionEquivalent(motion.sample(game,added,1),added,'new fleet member');
  game.vehicles=[added];game.revision++;motion.captureFinal(game);
  assert.equal(motion.getStats().vehicles,1);
  motion.reset();assert.equal(motion.getStats().records,0);assert.equal(motion.getStats().vehicles,0);
});

test('history trimming keeps the displayed interval and storage has a per-vehicle bound',()=>{
  const game=fixture('rail'),motion=createVehicleMotion({maxSegments:12});motion.captureFinal(game);
  for(let i=0;i<40;i++){tick(game,.25,{motion});motion.trim(game.day-.6);}
  assert.ok(motion.getStats().records<=12);
  const reference=fixture('rail');tick(reference,9.55);
  motionEquivalent(motion.sample(game,game.vehicles[0],9.55),reference.vehicles[0],'retained displayed interval');
  const held=motion.sample(game,game.vehicles[0],-100);
  assert.ok(Number.isFinite(held.x)&&Number.isFinite(held.y),'old samples hold at the earliest retained pose');
});

test('tracked presentation records only nearby fleets and uses live poses when changing the view',()=>{
  const game=fixture('road');game.vehicles.push({...game.vehicles[0],id:'distant-bus',progress:3});game.revision++;
  const plain=structuredClone(game),[nearby,distant]=game.vehicles,motion=createVehicleMotion();
  motion.setTracked([nearby]);motion.captureFinal(game);tick(game,2,{motion});tick(plain,2);
  assert.deepEqual(game,plain);
  assert.equal(motion.getStats().vehicles,1);assert.equal(motion.getStats().trackedVehicles,1);
  assert.equal(motion.sample(game,distant,1),distant,'untracked sampling avoids allocating a proxy');
  motion.setTracked([distant]);const freshProxy=motion.sample(game,distant,1);motionEquivalent(freshProxy,distant,'newly visible fallback');
  tick(game,1,{motion});motion.setTracked([nearby,distant]);
  motionEquivalent(motion.sample(game,nearby,2.5),nearby,'expired history fallback');
  assert.equal(motion.sample(game,distant,2.5),freshProxy,'a newly tracked carrier reuses its proxy after the next tick');
  motion.trim(2.1);assert.equal(motion.getStats().vehicles,1,'retired history leaves the retained time window');
});
