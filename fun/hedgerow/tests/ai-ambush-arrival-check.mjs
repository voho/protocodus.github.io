// Actual-rig ambush arrival must reach reserved real cover before waiting.
import assert from 'node:assert/strict';
import { aiFixture, soldier, advance } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const {createWorld,SHOT}=await import('../js/world.js');
const {createNav}=await import('../js/nav.js');
const rig=await parseUntexturedGLB('soldier');
for(const kind of['clear','crowded','partial'])for(const hz of[20,30,60]){
 const bounds={minX:-5,maxX:5,minZ:-5,maxZ:15},terrain={height:()=>0,normal:()=>[0,1,0],raycast:()=>Infinity,surfaceAt:()=> 'stone'},world=createWorld({...bounds,terrain});
 for(const b of[{x:-1,y:1.5,z:4,hx:.3,hy:1.5,hz:5},{x:1,y:1.5,z:4,hx:.3,hy:1.5,hz:5},{x:0,y:.5,z:8.8,hx:.7,hy:.5,hz:.2},...(kind==='partial'?[{x:0,y:1.5,z:3.4,hx:.7,hy:1.5,hz:.2}]:[])])world.add({type:'box',...b});
 const nav=createNav(world,bounds),f=aiFixture({world,nav,soldierModel:rig,player:[0,-90],definitions:[soldier(0,0),...(kind==='crowded'?[soldier(0,4,{hold:true,group:'post'})]:[])]}),{G,enemies}=f,e=enemies.list[0];
 G.player.visible=0;for(const o of enemies.list)o.perceiveTimer=1e6;
 const c=G.cover.find(p=>p.low&&Math.abs(p.x)<1e-9&&Math.abs(p.z-8)<1e-9);
 assert.ok(c,'the destination is actual generated low-wall cover');
 assert.equal(world.clear(c.x,c.y+.95,c.z,0,1.2,20,SHOT),false,'the destination physically protects a crouched body from the watched point');
 assert.equal(world.clear(c.x,c.y+1.55,c.z,0,1.5,20,SHOT),true,'standing at this actual low wall permits looking out');
 c.taken=e;e.cover=c;e.state='ambush';e.amb={x:0,z:20,phase:'move',timer:40,peekSpot:null};
 let falseWait=null,arrived=null,search=null;
 advance(G,enemies,18,()=>{
  const distance=Math.hypot(e.pos.x-c.x,e.pos.z-c.z);
  if(e.amb?.phase==='wait'){arrived??={time:G.time,distance};if(distance>1.2)falseWait??={time:G.time,distance,pos:e.pos.toArray(),pathFails:e.pathFails};}
  if(!search&&e.state==='search')search={time:G.time,x:e.srch.x,z:e.srch.z,reason:e.srch.reason,coverReleased:c.taken===null,ambushCleared:e.amb===null};
  assert.equal(e.contact,null);assert.equal(e.lastKnown,null);assert.equal(enemies.intel.size,0,'navigation failure cannot invent player intel');
 },1/hz);
 if(kind==='clear'){assert.ok(arrived);assert.ok(arrived.distance<.2);assert.equal(falseWait,null);assert.equal(search,null);assert.equal(e.state,'ambush');assert.equal(c.taken,e);}
 else {assert.equal(falseWait,null,'giving up on a route cannot claim arrival at distant cover');assert.ok(search,'the existing search fallback resumes');assert.equal(search.x,0);assert.equal(search.z,20);assert.equal(search.reason,'search');assert.equal(search.coverReleased,true);assert.equal(search.ambushCleared,true);}
 assert.equal(f.shots.length,0);assert.equal(f.hits.length,0);assert.equal(f.thrown.length,0);
 for(const o of enemies.list)o.char.dispose();
}
console.log('ok    actual rigs reach generated cover before waiting; crowded and partial routes release shelter and resume stored-target search at20/30/60Hz without invented intel or fire');
