import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionScenery,createSceneryBudget} from '../scenery-batches.js';
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
test('cache stops allocating at its cap and releases every bitmap on invalidation',()=>{
  const saved=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0})};
  try {const budget=createSceneryBudget(256),a=budget.allocate(8,8);assert.ok(a);assert.equal(budget.allocate(1,1),null);assert.equal(budget.stats().bytes,256);budget.clear();assert.equal(a.width,0);assert.equal(a.height,0);assert.equal(budget.stats().bytes,0);assert.ok(budget.allocate(4,4));assert.equal(budget.allocate(9000,1),null);}finally{globalThis.document=saved;}
});
test('a released strip frees its bytes once and leaves the other bitmaps',()=>{
  const saved=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0})};
  try {const budget=createSceneryBudget(256),a=budget.allocate(4,4),b=budget.allocate(4,4);budget.release(a);assert.equal(a.width,0);assert.equal(budget.stats().bytes,64);assert.equal(budget.stats().surfaces,1);budget.release(a);budget.release(null);assert.equal(budget.stats().bytes,64);assert.equal(b.width,4);assert.ok(budget.allocate(8,6));}finally{globalThis.document=saved;}
});
