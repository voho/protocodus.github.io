import test from 'node:test';
import assert from 'node:assert/strict';
import {opaqueAt} from '../renderer.js';
// A sprite canvas stand-in whose context records every readback.
const sprite=(width,height,alpha,{fail=false}={})=>{
  const reads=[];
  const context={getImageData(x,y,w,h){reads.push([x,y,w,h]);if(fail&&w*h>1)throw new Error('readback failed');const data=new Uint8ClampedArray(w*h*4);for(let j=0;j<h;j++)for(let i=0;i<w;i++)data[(j*w+i)*4+3]=alpha(x+i,y+j);return{data};}};
  return {width,height,reads,getContext:()=>context};
};
const pattern=(x,y)=>(x*37+y*101+x*y*13)%256;
test('picking masks match the alpha threshold at every pixel, including widths off a byte boundary',()=>{
  for(const [w,h] of [[13,7],[64,72],[1,1],[9,1]]){
    const image=sprite(w,h,pattern);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)assert.equal(opaqueAt(image,x,y),pattern(x,y)>24,`${w}×${h} at ${x},${y}`);
    assert.deepEqual(image.reads,[[0,0,w,h]],'each sprite is read back once');
  }
});
test('the threshold is exclusive: alpha 24 is clear and 25 is opaque',()=>{
  const image=sprite(2,1,x=>x?25:24);
  assert.equal(opaqueAt(image,0,0),false);
  assert.equal(opaqueAt(image,1,0),true);
});
test('points beyond the sprite are clear, as a one-pixel read outside a canvas is',()=>{
  const image=sprite(3,2,()=>255);
  for(const [x,y] of [[3,0],[0,2],[-1,1],[2,-1]])assert.equal(opaqueAt(image,x,y),false,`${x},${y}`);
  assert.equal(opaqueAt(image,2,1),true);
});
test('full five-tile Retina Detail sprites retain one cached readback while hovering',()=>{
  const image=sprite(1440,1512,(x,y)=>x>y?255:0);
  for(let n=0;n<20;n++){
    assert.equal(opaqueAt(image,1100+n,1000),true);
    assert.equal(opaqueAt(image,1000,1100+n),false);
  }
  assert.deepEqual(image.reads,[[0,0,1440,1512]],'large building masks avoid repeated GPU reads');
});
test('sprites beyond the half-megabyte bitmask budget keep one-pixel reads',()=>{
  const image=sprite(2049,2048,(x,y)=>x>y?255:0);
  assert.equal(opaqueAt(image,5,2),true);
  assert.equal(opaqueAt(image,2,5),false);
  assert.deepEqual(image.reads,[[5,2,1,1],[2,5,1,1]]);
  const edge=sprite(2048,2048,()=>255);opaqueAt(edge,0,0);opaqueAt(edge,2047,2047);
  assert.deepEqual(edge.reads,[[0,0,2048,2048]],'exactly512KiB of mask bits stays cached');
});
test('a failing full readback falls back to the one-pixel read',()=>{
  const image=sprite(8,8,(x,y)=>x===3&&y===4?200:0,{fail:true});
  assert.equal(opaqueAt(image,3,4),true);
  assert.equal(opaqueAt(image,4,3),false);
  assert.deepEqual(image.reads.filter(read=>read[2]===1),[[3,4,1,1],[4,3,1,1]]);
});
