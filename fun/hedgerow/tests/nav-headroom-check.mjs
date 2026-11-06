// Actual body clearance on sampled terrain, including a short headroom
// band missed by both the old body samples and an added head-height ray.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {createWorld}=await import('../js/world.js');
const {createNav}=await import('../js/nav.js');

function sampledTerrain(data) {
  const grid={...data,H:Float32Array.from(data.H)};
  function height(x,z) {
    const fx=Math.max(0,Math.min(grid.nx-1.001,(x-grid.minX)/grid.res));
    const fz=Math.max(0,Math.min(grid.nz-1.001,(z-grid.minZ)/grid.res));
    const i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j;
    const a=grid.H[j*grid.nx+i],b=grid.H[j*grid.nx+i+1],c=grid.H[(j+1)*grid.nx+i],d=grid.H[(j+1)*grid.nx+i+1];
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  }
  return {grid,height,raycast:()=>Infinity,surfaceAt:()=> 'mud'};
}
function blocked(world,start,path,height) {
  let from=start,y=world.groundAt(from.x,from.z,1e4,.45);
  for(const to of path) {
    const n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.025));
    for(let i=1;i<=n;i++) {
      const x=from.x+(to.x-from.x)*i/n,z=from.z+(to.z-from.z)*i/n;
      const floor=world.groundAt(x,z,y,.45),p={x,z};
      if(Math.abs(floor-y)>.451)return {x,z,reason:'step'};
      y=floor;world.pushOut(p,.35,y,height,.45);
      if(Math.hypot(p.x-x,p.z-z)>.02001)return {x,z,reason:'body'};
    }
    from=to;
  }
  return null;
}
const fixture=JSON.parse(readFileSync(new URL('./fixtures/ai/glider-headroom.json',import.meta.url)));
const terrain=sampledTerrain(fixture.grid),world=createWorld({...fixture.bounds,terrain});world.add(fixture.wing);
for(const height of [1.7,1.78]) {
  assert.ok(blocked(world,fixture.start,[fixture.goal],height),'the captured old straight leg genuinely intersects the standing body');
  const nav=createNav(world,fixture.bounds,{bodyHeight:height});
  assert.equal(nav.bodyHeight,height,'the path exposes its body-height contract');
  const path=nav.findPath(fixture.start.x,fixture.start.z,fixture.goal.x,fixture.goal.z);
  assert.ok(path?.length,`${height}m can walk around the low wing`);
  assert.ok(Math.hypot(path.at(-1).x-fixture.goal.x,path.at(-1).z-fixture.goal.z)<.05,'the detour reaches the actual goal');
  assert.equal(blocked(world,fixture.start,path,height),null,`${height}m: every returned leg clears the independently sampled body: ${JSON.stringify(path)}`);
}
console.log('ok    both NPC and full standing-player routes avoid a short sampled-terrain headroom band');

{
  const bounds={minX:-8,maxX:8,minZ:-8,maxZ:8};
  const w=createWorld({...bounds,terrain:{height:()=>0,raycast:()=>Infinity}});
  w.add({type:'box',x:0,y:1.94,z:0,hx:4,hy:.2,hz:.2});
  const npc=createNav(w,bounds),player=createNav(w,bounds,{bodyHeight:1.78});
  assert.equal(npc.bodyHeight,1.7);
  assert.equal(npc.lineClear(0,-3,0,3),true,'an NPC fits below a1.74m ceiling');
  assert.equal(player.lineClear(0,-3,0,3),false,'the taller standing player cannot use the same clearance');
  const route=player.findPath(0,-3,0,3);
  assert.ok(route?.length,'the standing player still has a route around the beam');
  assert.ok(Math.hypot(route.at(-1).x,route.at(-1).z-3)<.05,'the detour reaches the requested far side');
  assert.equal(blocked(w,{x:0,z:-3},route,1.78),null);
}
console.log('ok    optional player clearance preserves the narrower NPC contract and finds a real detour');

{
  const bounds={minX:-4,maxX:4,minZ:-4,maxZ:4},grid={...bounds,res:.5,nx:17,nz:17,H:[]};
  for(let j=0;j<grid.nz;j++)for(let i=0;i<grid.nx;i++){const x=grid.minX+i*grid.res;grid.H.push(Math.max(0,Math.min(.04,.04*(1-x/.5))));}
  const w=createWorld({...bounds,terrain:sampledTerrain(grid)});
  w.add({type:'cyl',x:.79,y:1.705,z:0,r:.05,h:.4});
  assert.ok(blocked(w,{x:0,z:0},[{x:3,z:0}],1.7),'a short cylinder intersection exists between ordinary body samples');
  const nav=createNav(w,bounds);
  assert.equal(nav.lineClear(0,0,3,0),false,'continuous vertical clearance also handles cylindrical supports');
  const path=nav.findPath(0,0,3,0);
  assert.ok(path?.length);
  assert.ok(Math.hypot(path.at(-1).x-3,path.at(-1).z)<.05,'the cylinder detour reaches its actual goal');
  assert.equal(blocked(w,{x:0,z:0},path,1.7),null);
}
console.log('ok    a short ceiling-entry band is checked against cylindrical as well as rotated box colliders');

{
  const bounds={minX:-4,maxX:4,minZ:-4,maxZ:4};
  const w=createWorld({...bounds,terrain:{height:()=>0,raycast:()=>Infinity}});
  w.add({type:'cyl',x:1/6,y:1.69,z:.36,r:.05,h:.15});
  assert.ok(blocked(w,{x:0,z:0},[{x:3,z:0}],1.7),'the flat grazing band exceeds the body correction tolerance');
  const nav=createNav(w,bounds);
  assert.equal(nav.lineClear(0,0,3,0),false,'a short grazing head collision matters even when floor height stays constant');
  const path=nav.findPath(0,0,3,0);
  assert.ok(path?.length,'the clear side of the small overhead obstruction remains reachable');
  assert.ok(Math.hypot(path.at(-1).x-3,path.at(-1).z)<.05,'the grazing detour reaches its actual goal');
  assert.equal(blocked(w,{x:0,z:0},path,1.7),null);
}
console.log('ok    flat-ground head grazes between body samples also take a physically clear route');
