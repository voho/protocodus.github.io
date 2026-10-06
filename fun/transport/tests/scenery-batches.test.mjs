import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionScenery,transferSceneryGroups,createSceneryBudget} from '../scenery-batches.js';
const item=(id,depth,x, width=40)=>({id,depth,bounds:{left:x,top:0,right:x+width,bottom:48}});
test('batches retain all exact depth-order entries and split at non-batchable structures',()=>{
  const objects=[item(1,0,0),item(2,0,64),{id:3,depth:.1},item(4,1,0),item(5,1,64),item(6,2,0)];
  const groups=partitionScenery(objects,2);
  assert.deepEqual(groups.map(g=>g.objects.map(o=>o.id)),[[1,2],[3],[4,5],[6]]);
  assert.deepEqual(groups.flatMap(g=>g.objects),objects);
});
test('diagonal runs honor physical width and pixel budgets at each zoom',()=>{
  const objects=Array.from({length:90},(_,n)=>item(n,Math.floor(n/30),(n%30)*64));
  for(const scale of [.5,1,2,4])for(const group of partitionScenery(objects,scale,{maxWidth:320,maxPixels:40000})){
    assert.ok(group.objects.every(o=>o.depth===group.objects[0].depth));
    assert.ok((group.bounds.right-group.bounds.left)*scale<=320);
    assert.ok((group.bounds.right-group.bounds.left)*(group.bounds.bottom-group.bounds.top)*scale*scale<=40000);
  }
});
test('stop selection can fade scenery batches without fading adjacent infrastructure',()=>{
  const objects=[{...item(1,0,0),dimEligible:true},{...item(2,0,40),dimEligible:true},item(3,0,80),{...item(4,0,120),dimEligible:true}];
  assert.deepEqual(partitionScenery(objects,1).map(group=>group.objects.map(object=>object.id)),[[1,2],[3],[4]]);
});
const worldItem=(x,depth=64)=>({tile:2048+x,depth,x,priority:0,dimEligible:true,bounds:{left:x*64,top:0,right:x*64+40,bottom:48}});
test('world-x boundaries preserve interior strips when a scene recenters',()=>{
  const before=Array.from({length:40},(_,x)=>worldItem(x));
  const after=Array.from({length:40},(_,x)=>worldItem(x+3));
  const previous=partitionScenery(before,2),next=partitionScenery(after,2);
  assert.deepEqual(previous.map(group=>group.objects.map(object=>object.x)),[
    [0,1,2,3,4,5,6,7,8,9],[10,11,12,13,14,15,16,17,18,19],
    [20,21,22,23,24,25,26,27,28,29],[30,31,32,33,34,35,36,37,38,39],
  ]);
  const releases=[],images=previous.map((group,id)=>Object.assign(group,{image:{width:100,height:50,id},context:{id},x:group.bounds.left,y:0,hits:[{world:true,tx:group.objects[0].x}]}).image);
  const retainedContext=previous[1].context,retainedHits=previous[1].hits;
  assert.equal(transferSceneryGroups(previous,next,image=>releases.push(image)),3);
  assert.deepEqual(releases,[images[0]]);
  assert.equal(next[1].image,images[1]);assert.equal(next[1].context,retainedContext);assert.equal(next[1].hits,retainedHits);
  assert.equal(next[1].x,640);assert.equal(next[1].y,0);
  assert.ok(previous.every(group=>!group.image),'pictures have one owner after transfer');
  assert.deepEqual(next.flatMap(group=>group.objects),after,'the original depth order is unchanged');
  assert.equal(next[0].image,undefined);assert.equal(next.at(-1).image,undefined);
});
test('stable buckets tolerate negative positions and can be disabled',()=>{
  const objects=Array.from({length:12},(_,n)=>worldItem(n-2));
  assert.deepEqual(partitionScenery(objects,2).map(group=>group.objects.map(object=>object.x)),[[-2,-1],[0,1,2,3,4,5,6,7,8,9]]);
  assert.equal(partitionScenery(objects,2,{stableBuckets:false}).length,2,'the physical width cap still applies');
  const narrow=objects.slice(0,5);
  assert.equal(partitionScenery(narrow,1,{stableBuckets:false}).length,1);
  assert.equal(partitionScenery(narrow,1).length,2);
});
test('group reuse rejects changed identities, geometry, alpha eligibility and entry order',()=>{
  const mutations=[
    group=>{group.objects[0].tile++;},group=>{group.objects[0].depth++;},group=>{group.objects[0].x++;},
    group=>{group.objects[0].priority++;},group=>{group.objects[0].dimEligible=false;},
    group=>{group.objects[0].bounds.bottom++;},group=>{group.bounds.right++;},
    group=>{group.objects.reverse();},group=>{group.objects.pop();},group=>{delete group.objects[0].priority;},
  ];
  for(const mutate of mutations){
    const previous=partitionScenery([worldItem(3),worldItem(4)],1),next=partitionScenery([worldItem(3),worldItem(4)],1);
    const image={width:64,height:48};previous[0].image=image;mutate(next[0]);
    const releases=[];assert.equal(transferSceneryGroups(previous,next,image=>releases.push(image)),0);
    assert.deepEqual(releases,[image]);assert.equal(next[0].image,undefined);
  }
});
test('duplicate matching runs retain distinct pictures and unprepared runs stay unprepared',()=>{
  const make=()=>partitionScenery([worldItem(3),worldItem(4)],1)[0];
  const previous=[make(),make(),make()],next=[make(),make(),make()];
  previous[0].image={width:64,height:48,id:1};previous[1].image={width:64,height:48,id:2};
  const releases=[];assert.equal(transferSceneryGroups(previous,next,image=>releases.push(image)),2);
  assert.equal(releases.length,0);assert.equal(new Set(next.filter(group=>group.image).map(group=>group.image)).size,2);
  assert.equal(next.filter(group=>!group.image).length,1);
  assert.equal(transferSceneryGroups(null,[],image=>releases.push(image)),0);
});
test('cache stops allocating at its cap and releases every bitmap on invalidation',()=>{
  const saved=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0})};
  try {const budget=createSceneryBudget(256),a=budget.allocate(8,8);assert.ok(a);assert.equal(budget.allocate(1,1),null);assert.equal(budget.stats().bytes,256);budget.clear();assert.equal(a.width,0);assert.equal(a.height,0);assert.equal(budget.stats().bytes,0);assert.ok(budget.allocate(4,4));assert.equal(budget.allocate(9000,1),null);}finally{globalThis.document=saved;}
});
test('a released strip frees its bytes once and leaves the other bitmaps',()=>{
  const saved=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0})};
  try {const budget=createSceneryBudget(256),a=budget.allocate(4,4),b=budget.allocate(4,4);budget.release(a);assert.equal(a.width,0);assert.equal(budget.stats().bytes,64);assert.equal(budget.stats().surfaces,1);budget.release(a);budget.release(null);assert.equal(budget.stats().bytes,64);assert.equal(b.width,4);assert.ok(budget.allocate(8,6));}finally{globalThis.document=saved;}
});
test('transferring matching runs preserves their budget while releasing discarded runs',()=>{
  const saved=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0})};
  try{
    const budget=createSceneryBudget(256),previous=partitionScenery([worldItem(3),worldItem(24)],1),next=partitionScenery([worldItem(24)],1);
    const removed=previous[0].image=budget.allocate(4,4),retained=previous[1].image=budget.allocate(4,4);
    assert.equal(budget.stats().bytes,128);
    assert.equal(transferSceneryGroups(previous,next,image=>budget.release(image)),1);
    assert.equal(removed.width,0);assert.equal(next[0].image,retained);assert.equal(retained.width,4);
    assert.deepEqual(budget.stats(),{bytes:64,limit:256,surfaces:1});
    budget.clear();assert.equal(retained.width,0);assert.equal(budget.stats().bytes,0);
  }finally{globalThis.document=saved;}
});
