import test from 'node:test';
import assert from 'node:assert/strict';
import {shorelineContours} from '../shoreline.js';
const size=32;
const gameFor=predicate=>({width:size,height:size,seed:1847,tiles:Array.from({length:size*size},(_,i)=>({terrain:predicate(i%size,Math.floor(i/size))?'water':'grass'}))});
const bounds={x0:0,y0:0,x1:size,y1:size};
function curves(contours){
  return contours.flatMap(points=>points.map((p,i)=>{
    const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];
    return [[(prev[0]+p[0])/2,(prev[1]+p[1])/2],p,[(p[0]+next[0])/2,(p[1]+next[1])/2]];
  }));
}
function flattened(contours){
  return contours.map(points=>curves([points]).flatMap(([a,b,c])=>Array.from({length:8},(_,i)=>{
    const t=i/8,u=1-t;return [u*u*a[0]+2*t*u*b[0]+t*t*c[0],u*u*a[1]+2*t*u*b[1]+t*t*c[1]];
  })));
}
function inside(contours,x,y){
  let result=false;
  for(const polygon of contours)for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])result=!result;
  }
  return result;
}
const fixtures=[
  (x,y)=>x<5+Math.floor(y*.65)+Math.round(Math.sin(y*.7)*2),
  (x,y)=>y===12||(x===16&&y>2&&y<28),
  (x,y)=>x===12&&y===12,
  (x,y)=>!(x===12&&y===12),
  (x,y)=>(x+y)%2===0,
];
test('smoothed coast keeps tile centers, isolated ponds and one-tile waterways navigable',()=>{
  for(const fixture of fixtures){
    const game=gameFor(fixture),before=JSON.stringify(game),coast=flattened(shorelineContours(game,bounds));
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(const [dx,dy]of[[0,0],[4,0],[-4,0],[0,4],[0,-4]])assert.equal(inside(coast,(x+.5)*32+dx,(y+.5)*32+dy),fixture(x,y),`center ${x},${y} with four-pixel clearance`);
    assert.equal(JSON.stringify(game),before);
  }
});
test('padded chunks have exactly the same visible coast curves as the complete map',()=>{
  for(const fixture of fixtures){
    const game=gameFor(fixture),complete=new Set(curves(shorelineContours(game,bounds)).map(JSON.stringify));
    for(let y=0;y<size;y+=8)for(let x=0;x<size;x+=8){
      const local={x0:Math.max(0,x-2),y0:Math.max(0,y-2),x1:Math.min(size,x+10),y1:Math.min(size,y+10)};
      for(const curve of curves(shorelineContours(game,local))){
        const xs=curve.map(p=>p[0]),ys=curve.map(p=>p[1]);
        if(Math.max(...xs)<=x*32||Math.min(...xs)>=(x+8)*32||Math.max(...ys)<=y*32||Math.min(...ys)>=(y+8)*32)continue;
        assert.ok(complete.has(JSON.stringify(curve)),`chunk ${x},${y} has a different coast curve`);
      }
    }
  }
});
test('world-aligned bank variation is deterministic and changes with the seed',()=>{
  const game=gameFor((x,y)=>y<16),first=shorelineContours(game,bounds);
  assert.deepEqual(shorelineContours(game,bounds),first);
  game.seed++;assert.notDeepEqual(shorelineContours(game,bounds),first);
});
