import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlayGrid,siteShape,insideShape} from '../overlay-placement.js';
const meets=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
test('the overlay grid finds exactly the boxes a query overlaps, across cells and negative coordinates',()=>{
  const grid=createOverlayGrid(64),boxes=[];let seed=1847;
  const next=()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32;
  for(let n=0;n<400;n++)boxes.push(grid.add({id:n,x:next()*1600-800,y:next()*1200-600,w:4+next()*180,h:4+next()*60}));
  assert.equal(grid.items,400);
  for(let n=0;n<300;n++){
    const q={x:next()*1700-850,y:next()*1300-650,w:1+next()*90,h:1+next()*40},expected=boxes.filter(box=>meets(box,q)).map(box=>box.id).sort((a,b)=>a-b),seen=new Set();
    grid.find(q,box=>{seen.add(box.id);return false;});
    assert.deepEqual([...seen].sort((a,b)=>a-b),expected);
    assert.equal(Boolean(grid.find(q)),expected.length>0);
  }
});
test('touching boxes do not overlap and a test can skip a box',()=>{
  const grid=createOverlayGrid(64),a=grid.add({kind:'label',x:0,y:0,w:64,h:28}),b=grid.add({kind:'sign',x:70,y:0,w:16,h:16});
  assert.equal(grid.find({x:64,y:0,w:6,h:28}),null,'a box ending where another starts is clear');
  assert.equal(grid.find({x:60,y:10,w:20,h:4}),a);
  assert.equal(grid.find({x:60,y:10,w:20,h:4},box=>box.kind==='sign'),b);
  assert.equal(grid.find({x:-200,y:-200,w:10,h:10}),null);
});
test('a site outline covers its footprint and block but not the open corners of its box',()=>{
  // A 2 × 2 site at Town zoom: 64 px half width, 32 px half depth and a roof peaking 84 px above its centre.
  const site=siteShape(100,200,64,32,84,'mill');
  assert.deepEqual([site.x,site.y,site.w,site.h],[36,116,128,116]);
  for(const [x,y] of [[100,200],[100,231],[37,200],[163,200],[100,168],[100,117],[70,140],[163,150]])assert.equal(insideShape(site,x,y),true,`${x},${y} is on the site`);
  for(const [x,y] of [[40,228],[160,228],[100,234],[100,114],[166,200],[40,118],[160,118]])assert.equal(insideShape(site,x,y),false,`${x},${y} is off the site`);
  assert.equal(insideShape(site,100,234,4),true,'a margin reaches just past the front corner');
});
