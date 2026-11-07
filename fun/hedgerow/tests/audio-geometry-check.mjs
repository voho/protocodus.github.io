// Real collision geometry distinguishes open sky, a roofed opening and an
// adjacent wall; source movement must invalidate a shared acoustic cache cell.
import assert from 'node:assert/strict';
import { createAcousticOcclusion } from '../js/audio-space.js';
import { createWorld, SHOT } from '../js/world.js';
const bounds={minX:-20,maxX:20,minZ:-20,maxZ:20};
function probeFor(world){return(lx,ly,lz,sx,sy,sz)=>{
 const dx=sx-lx,dy=sy-ly,dz=sz-lz,d=Math.hypot(dx,dy,dz);
 return world.raycast(lx,ly,lz,dx/d,dy/d,dz/d,Math.max(0,d-.25),SHOT,{noWater:true});
};}
for(const yaw of [0,Math.PI/2,.37]){
 const world=createWorld(bounds),c=Math.cos(yaw),s=Math.sin(yaw),point=(x,z)=>[x*c+z*s,-x*s+z*c];
 for(const x of[-3.2,3.2]){const[wx,wz]=point(x,0);world.add({type:'box',x:wx,y:2,z:wz,hx:1,hy:2,hz:5,yaw,surface:'stone'});}
 world.add({type:'box',x:0,y:4.2,z:0,hx:4.2,hy:.2,hz:5,yaw,surface:'stone'});
 const roof=(x,z)=>world.raycast(x,1.45,z,0,1,0,18,SHOT,{noTerrain:true,noWater:true});
 assert.ok(roof(0,0),'the actual roof shelters the opening');
 for(const p of [[0,7],[0,-7],[7,0],[-7,0]])assert.equal(roof(...point(...p)),null,'surrounding approaches remain open to the sky');
 const acoustic=createAcousticOcclusion();acoustic.setProbe(probeFor(world));
 let[lx,lz]=point(0,-6.2),[sx,sz]=point(0,6.2);acoustic.setListener(lx,1.4,lz);
 assert.equal(acoustic.sample(sx,1.4,sz,0).blocked,false,'sound crosses the real usable opening');
 [lx,lz]=point(3.2,-6.2);[sx,sz]=point(3.2,6.2);acoustic.setProbe(probeFor(world));acoustic.setListener(lx,1.4,lz);
 assert.equal(acoustic.sample(sx,1.4,sz,0).surface,'masonry','the adjacent rotated wing muffles a source');
}
{
 const world=createWorld(bounds);world.add({type:'box',x:0,y:1.5,z:0,hx:.25,hy:1.5,hz:1.7,surface:'stone'});
 const acoustic=createAcousticOcclusion();acoustic.setProbe(probeFor(world));acoustic.setListener(-4,1.4,0);
 const hidden=[4,1.4,3.3],exposed=[4,1.4,3.8];
 assert.deepEqual(hidden.map((v,i)=>Math.floor(v/(i===1?.5:2))),exposed.map((v,i)=>Math.floor(v/(i===1?.5:2))),'both actual source positions share a coarse cache cell');
 assert.equal(acoustic.sample(...hidden,1).blocked,true);
 assert.equal(acoustic.sample(...exposed,1.05).blocked,false,'a50cm step around a wall invalidates the old blocker before its TTL');
 assert.equal(acoustic.status.probes,2,'the changed path receives its own bounded real world query');
}
console.log('audio-geometry-check: three real rotated roof/opening/masonry fixtures and same-cell source edge invalidation pass');
