import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, findPath } from '../model.js';
import { emptyGame, line } from './helpers.mjs';
import { networkIndex, updateNetworkIndex } from '../network-index.js';

function equivalent(actual,expected,path='game') {
  if(typeof actual==='number'&&typeof expected==='number') {
    assert.ok(Math.abs(actual-expected)<=Math.max(1,Math.abs(expected))*1e-9,`${path}: ${actual} != ${expected}`);return;
  }
  if(actual&&expected&&typeof actual==='object'&&typeof expected==='object') {
    assert.deepEqual(Object.keys(actual),Object.keys(expected),path);
    for(const key of Object.keys(actual))equivalent(actual[key],expected[key],`${path}.${key}`);
    return;
  }
  assert.equal(actual,expected,path);
}

test('a dense competing fleet keeps arrival order and cargo accounting across frame partitions',()=>{
  const whole=createGame({size:'regional',seed:98361});
  const template=whole.vehicles[0];
  for(let i=1;i<256;i++)whole.vehicles.push({...template,id:`dense-bus-${i}`,load:0,progress:i%24,x:whole.routes[0].path[i%24].x,y:whole.routes[0].path[i%24].y});
  whole.revision++;
  const frames=structuredClone(whole),irregular=structuredClone(whole);
  tick(whole,20);
  for(let n=0;n<80;n++)tick(frames,.25);
  for(let n=0;n<20;n++)for(const fraction of [.125,.375,.0625,.4375])tick(irregular,fraction);
  equivalent(frames,whole);equivalent(irregular,whole);
  assert.ok(whole.totalDelivered>0);
});

test('warmed movement keeps live connections and refreshes fleet, path, level and terrain changes',()=>{
  const game=emptyGame();
  for(const tile of game.tiles)tile.road=true;
  const route={id:'cached-route',name:'Cached route',mode:'road',cargo:'passengers',stops:['cached-a','cached-b'],path:line(10,40,20),pathRevision:game.networkRevision,active:true,status:'Running',delivered:0,revenue:0,expenses:0,profitThisYear:0};
  game.stations.push({id:'cached-a',name:'A',mode:'road',x:10,y:20},{id:'cached-b',name:'B',mode:'road',x:40,y:20});
  game.routes.push(route);
  for(let i=0;i<64;i++)game.vehicles.push({id:`cached-bus-${i}`,routeId:route.id,x:10+i%24,y:20,angle:0,capacity:32,load:0,level:0,progress:i%24,direction:1,totalDistance:0,dwellRemaining:0,tripSerial:0});
  tick(game,.125);
  // A clone starts with no derived caches. Mutating the same input on each
  // side must produce the same future as the already warmed simulation.
  const compareAfter=(change,days=.125)=>{
    const fresh=structuredClone(game);change(game);change(fresh);
    tick(game,days);tick(fresh,days);assert.deepEqual(game,fresh);
  };
  const before=game.vehicles.map(vehicle=>vehicle.progress);
  compareAfter(g=>{g.routes[0].active=false;});
  assert.deepEqual(game.vehicles.map(vehicle=>vehicle.progress),before,'a disconnected route freezes even while its fleet remains cached');
  compareAfter(g=>{g.routes[0].active=true;});
  assert.ok(game.vehicles.some((vehicle,i)=>vehicle.progress!==before[i]),'reconnection resumes the same fleet');
  compareAfter(g=>{g.vehicles=g.vehicles.map(vehicle=>({...vehicle}));});
  compareAfter(g=>{g.routes=g.routes.map(entry=>({...entry}));});
  compareAfter(g=>{g.vehicles[0].level=2;});
  compareAfter(g=>{g.routes[0].path=[...line(10,19,20),{x:19,y:21},...line(20,25,21),{x:25,y:20},...line(26,40,20)];});
  compareAfter(g=>{g.tiles[19*g.width+24].building={kind:'service-garage',level:1,size:1};g.revision++;});
  compareAfter(g=>{g.tiles[20*g.width+24].elevation=.35;g.networkRevision++;});
  compareAfter(()=>{},1);
});

test('long A* searches remain shortest through obstacles and do not contaminate subsequent short searches',()=>{
  const game=emptyGame();
  for(const tile of game.tiles)tile.road=true;
  for(let y=0;y<90;y++)game.tiles[y*game.width+64].road=false;
  const from={x:5,y:5},to={x:120,y:5};
  // Force the long-search threshold without changing the known detour geometry.
  to.y=40;
  const route=findPath(game,from,to);
  assert.equal(route.length,115+85+50+1);
  assert.ok(route.every(point=>game.tiles[point.y*game.width+point.x].road));
  assert.equal(findPath(game,{x:1,y:1},{x:2,y:1}).length,2);
  for(let y=90;y<game.height;y++)game.tiles[y*game.width+64].road=false;
  assert.equal(findPath(game,from,to),null);
  assert.equal(findPath(game,{x:1,y:1},{x:2,y:1}).length,2);
});

test('the network bitset retains dense coverage and updates only the edited cells',()=>{
  const game=emptyGame();for(const tile of game.tiles)tile.rail=true;
  const index=networkIndex(game);
  assert.equal(index.count,game.tiles.length);
  assert.equal(index.bytes,Math.ceil(game.tiles.length/32)*4);
  assert.deepEqual([...index],Array.from({length:game.tiles.length},(_,i)=>i));
  const points=[{x:0,y:0},{x:31,y:0},{x:32,y:0},{x:127,y:95}];
  for(const {x,y}of points)game.tiles[y*game.width+x].rail=false;
  const previous=game.networkRevision++;updateNetworkIndex(game,points,previous);
  assert.equal(networkIndex(game),index);
  assert.equal(index.count,game.tiles.length-4);
  assert.equal([...index].length,index.count);
  game.tiles[1].road=false;game.tiles[1].rail=false;game.networkRevision++;
  assert.notEqual(networkIndex(game),index,'external revision invalidates and rebuilds the derived index');
});
