import test from 'node:test';
import assert from 'node:assert/strict';
import { packRoutePaths, readRoutePaths } from '../route-save-codec.js';
import { createGame } from '../model.js';
import { encodeGame,decodeGame,inspectSavedGame } from '../save-codec.js';

const path=[];
for(let x=5;x<2000;x++)path.push({x,y:5});
for(let y=6;y<2000;y++)path.push({x:1999,y});
for(let x=1998;x>5;x--)path.push({x,y:1999});
for(let y=1998;y>5;y--)path.push({x:6,y});
const state={width:2048,height:2048,routes:[{id:'long-trip',path}]};

test('long routes retain every exact point and all four directions with compact direction runs',()=>{
  const packed=packRoutePaths(state);
  assert.deepEqual(packed.routes[0].path.runs,[7972,7974,7969,7971]);
  assert.equal(packed.routes[0].path.format,'cardinal-runs-v1');
  assert.ok(JSON.stringify(packed).length<250);
  assert.ok(JSON.stringify(state).length>100000);
  assert.equal(state.routes[0].path,path,'saving never changes the running route');
  assert.deepEqual(readRoutePaths(JSON.parse(JSON.stringify(packed)),{expand:true}),state);
  assert.equal(readRoutePaths(packed),packed,'metadata validation does not expand millions of points');
});

test('nonstandard paths preserve point metadata, diagonal segments and legacy short paths',()=>{
  for(const edit of [p=>p[20].future='value',p=>p[20]={x:20,y:20},p=>p.splice(5,1),p=>p.length=4]) {
    const changed=structuredClone(state);edit(changed.routes[0].path);
    assert.equal(packRoutePaths(changed),changed);
    assert.deepEqual(readRoutePaths(changed,{expand:true}),changed);
  }
});

test('corrupt direction runs are rejected without expansion',()=>{
  const packed=packRoutePaths(state);
  for(const edit of [p=>p.format='future',p=>p.start=[-1,5],p=>p.start=[5.5,5],p=>p.length++,p=>p.length=Infinity,p=>p.runs[0]=-1,p=>p.runs[0]=100000000,p=>p.runs[0]=.1,p=>p.runs=[]]) {
    const changed=structuredClone(packed);edit(changed.routes[0].path);
    assert.throws(()=>readRoutePaths(changed),/saved route/);
    assert.throws(()=>readRoutePaths(changed,{expand:true}),/saved route/);
  }
});

test('the entire compressed fleet is allocation-bounded before any route expands',()=>{
  const runs=Array.from({length:2048},(_,i)=>(2047-1)*4+i%2);
  const path={format:'cardinal-runs-v1',start:[0,0],length:2048*2047+1,runs};
  const oversized={width:2048,height:2048,routes:Array.from({length:5},()=>({path}))};
  assert.throws(()=>readRoutePaths(oversized),/Too many saved route points/);
  assert.throws(()=>readRoutePaths(oversized,{expand:true}),/Too many saved route points/);
});

test('compact and procedural companies integrate route packing and restore exact journeys',()=>{
  for(const size of ['regional','square512']) {
    const game=createGame({size}),route=game.routes[0];
    route.path=Array.from({length:100},(_,x)=>({x,y:10}));
    const saved=encodeGame(game);
    assert.equal(saved.state.routes[0].path.format,'cardinal-runs-v1');
    assert.equal(inspectSavedGame(saved).routes[0].path.length,100);
    assert.deepEqual(decodeGame(saved),game);
    const corrupted=structuredClone(saved);corrupted.state.routes[0].path.length++;
    assert.throws(()=>inspectSavedGame(corrupted),/saved route/);
    assert.throws(()=>decodeGame(corrupted),/saved route/);
  }
});
