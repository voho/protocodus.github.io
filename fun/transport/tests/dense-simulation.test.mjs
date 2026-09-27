import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, findPath } from '../model.js';
import { emptyGame } from './helpers.mjs';
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
