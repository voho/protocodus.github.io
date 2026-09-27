import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouteRenderIndex} from '../route-render-index.js';
const intersects=(a,b,q)=>!(Math.max(a.x,b.x)<q.x0||Math.min(a.x,b.x)>=q.x1||Math.max(a.y,b.y)<q.y0||Math.min(a.y,b.y)>=q.y1);
function visible(path,q,index){const segments=[];for(const[start,end]of index.query(q))for(let n=start;n<=end;n++)if(intersects(path[n-1],path[n],q))segments.push(n);return segments;}
test('visible route ranges retain every segment once and in original path order',()=>{
  const path=[{x:0,y:0}];let seed=1985;
  for(let n=0;n<12000;n++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const last=path.at(-1),dx=[1,0,-1,0][seed>>>30],dy=[0,1,0,-1][seed>>>30];path.push({x:last.x+dx,y:last.y+dy});}
  const index=createRouteRenderIndex(path);
  for(const x of[-64,-32,-1,0,31,32,64])for(const y of[-64,-32,-1,0,31,32,64]){
    const q={x0:x,y0:y,x1:x+33,y1:y+31},expected=[];for(let n=1;n<path.length;n++)if(intersects(path[n-1],path[n],q))expected.push(n);
    assert.deepEqual(visible(path,q,index),expected);
  }
});
test('a continental route query visits local runs without copying its whole path',()=>{
  const path=Array.from({length:100001},(_,x)=>({x,y:400})),index=createRouteRenderIndex(path),q={x0:50000,y0:380,x1:50040,y1:420},ranges=index.query(q);
  assert.deepEqual(visible(path,q,index),Array.from({length:41},(_,i)=>50000+i));
  assert.ok(ranges.reduce((sum,[a,b])=>sum+b-a+1,0)<100);
  assert.ok(index.bytes<30000,`compressed runs occupy ${index.bytes} bytes`);
});
