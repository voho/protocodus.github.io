import assert from 'node:assert/strict';
import {GPUCanvas2D} from '../gpu-canvas.js';
import {mockCanvas} from './gpu-mock.mjs';

const image=(name,width=32,height=32)=>({name,width,height,_tyranTextureVersion:1});
function renderer(){const surface=mockCanvas();return {surface,c:new GPUCanvas2D(surface.width,surface.height,surface)};}
let cases=0;
{
  const {c,surface}=renderer(),sprite=image('transformed');c.prewarm(sprite);c.beginFrame();c.setTransform(2,0,0,3,5,7);c.globalAlpha=.5;c.drawImage(sprite,10,20,30,40);c.endFrame();
  const draw=surface.draws[0],s=draw.stride;assert.equal(draw.count,6);
  assert.deepEqual([0,1,2,3,4,5].map(i=>Array.from(draw.vertices.slice(i*s,i*s+4))),[[25,67,0,0],[85,67,1,0],[85,187,1,1],[25,67,0,0],[85,187,1,1],[25,187,0,1]]);
  assert(draw.images.every(entry=>entry.source===sprite));assert.equal(draw.vertices[7],.5);c.dispose();cases++;
}
{
  const {c,surface}=renderer(),sprites=Array.from({length:19},(_,i)=>image(`slot${i}`));c.prewarm(sprites);c.beginFrame();
  const expected=[];for(let round=0;round<3;round++)for(let i=0;i<sprites.length;i++){const sprite=sprites[(i+round*3)%sprites.length];expected.push(sprite);c.globalCompositeOperation=round===1&&i%3===0?'screen':'source-over';c.drawImage(sprite,i*5,round*12);}
  c.endFrame();const actual=[];for(const draw of surface.draws)for(let i=0;i<draw.count;i+=6)actual.push(draw.images[i].source);assert.deepEqual(actual,expected,'Sampler rollover preserves image/painter order');c.dispose();cases++;
}
{
  const {c,surface}=renderer(),sprite=image('terrain');c.prewarm(sprite);const checked=surface.calls.getError;assert(checked>0,'New texture allocation is checked');surface.events.length=0;c.beginFrame();c.drawImage(sprite,0,0);sprite._tyranTextureVersion++;sprite._tyranTextureDirty={x:1,y:2,width:3,height:4};c.prewarm(sprite);c.drawImage(sprite,3,4);c.endFrame();
  assert.deepEqual(surface.events.map(e=>[e.kind,e.kind==='draw'?e.draw.images[0].version:e.version]),[['draw',1],['texture',2],['draw',2]],'Texture mutation flushes older image uses first');
  c.markTextureDirty(sprite,{x:2,y:3,width:4,height:5});c.markTextureDirty(sprite,{x:1,y:2,width:3,height:4});c.prewarm(sprite);const upload=surface.events.at(-1);assert.deepEqual(upload.skip,[1,2]);assert.deepEqual(upload.args.slice(2,6),[1,2,5,6]);assert.equal(surface.calls.getError,checked,'Existing scenery patches avoid synchronous driver queries');c.dispose();cases++;
}
{
  const {c,surface}=renderer(),sprite=image('segments');c.prewarm(sprite);c.beginFrame();const start=surface.allocations.length;
  for(let i=0;i<7;i++){c.drawImage(sprite,i,10);c.flush();}assert.equal(surface.allocations.length-start,1,'Small passes share one backing allocation');assert.deepEqual(surface.uploads.map(u=>u.offset),[0,1,2,3,4,5,6].map(i=>i*6*surface.stride*4));
  const cursor=surface.uploads.at(-1).offset;c.present();c.drawImage(sprite,20,30);c.endFrame();assert(surface.uploads.at(-1).offset>cursor,'Post-present interference appends safely');
  c.beginFrame();c.drawImage(sprite,2,3);c.endFrame();assert.equal(surface.uploads.at(-1).offset,0);c.dispose();cases++;
}
{
  const {c,surface}=renderer(),sprite=image('capacity');c.prewarm(sprite);c.beginFrame();const capacity=surface.allocations[0].bytes/(surface.stride*4),start=surface.allocations.length;
  for(let i=0;i<capacity/6+1;i++)c.drawImage(sprite,i%500,1);c.endFrame();assert.equal(surface.allocations.length-start,2);assert.deepEqual(surface.uploads.map(u=>u.offset),[0,0]);assert.equal(surface.draws.reduce((n,d)=>n+d.count,0),capacity+6);c.dispose();cases++;
}
{
  const {c,surface}=renderer(),sprites=Array.from({length:6},(_,i)=>image(`ship-layer${i}`));c.prewarm(sprites);c.beginFrame();
  for(let ship=0;ship<10;ship++)for(let layer=0;layer<6;layer++){c.globalCompositeOperation=layer%2?'screen':'source-over';c.drawImage(sprites[layer],ship*20,layer);}
  c.endFrame();assert.equal(surface.draws.length,60);assert.deepEqual(surface.draws.map(d=>d.images[0].source),Array.from({length:10},()=>sprites).flat());
  c.dispose();cases++;
}
console.log(`GPU batch checks passed (${cases} groups).`);
