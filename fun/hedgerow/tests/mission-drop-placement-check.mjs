// Scaled actual loot geometry, same-side support and actual death consumers.
import assert from 'node:assert/strict';
import { pickupScenario, models } from './pickup-fixture.mjs';
const { createWorld, MOVE, SHOT } = await import('../js/world.js');
const { deathDropPoint } = await import('../js/pickup-placement.js');
const box=models.get('ammo_box').box,records=[];
const flat={height:()=>0,normal:()=>[0,1,0],surfaceAt:()=> 'stone',raycast:(_x,y,_z,_dx,dy,_dz,t)=>dy<0&&-y/dy<=t?-y/dy:Infinity};
const specs=[
 {name:'clear ground',expect:'original'},
 {name:'solid wall',boxes:[{x:1,y:1.5,z:.5,hx:.2,hy:1.5,hz:2}],expect:'feet'},
 {name:'wall corner',boxes:[{x:1,y:1.5,z:.5,hx:.2,hy:1.5,hz:2},{x:.4,y:1.5,z:.8,hx:2,hy:1.5,hz:.2}],expect:'feet'},
 {name:'thin wall with clear far endpoint',death:[.3,0,0],boxes:[{x:.7,y:1.5,z:0,hx:.01,hy:1.5,hz:2}],expect:'feet'},
 {name:'oblique separating wall',boxes:[{x:.76,y:1.5,z:.38,hx:2,hy:1.5,hz:.02,yaw:Math.atan2(.6,.3)}],expect:'feet'},
 {name:'thin cylindrical obstruction',boxes:[{type:'cyl',x:.8,y:0,z:.4,r:.01,h:3}],expect:'feet'},
 {name:'low step',boxes:[{x:1,y:.15,z:.5,hx:.3,hy:.15,hz:.4}],expect:'original',height:.3},
 {name:'ground below upper slab',boxes:[{x:0,y:2.9,z:0,hx:3,hy:.1,hz:3}],expect:'original',height:0},
 {name:'actual upper deck',death:[.4,3,.2],boxes:[{x:0,y:2.9,z:0,hx:3,hy:.1,hz:3}],expect:'original',height:3},
 {name:'upper ledge cannot drop downstairs',death:[.4,3,.2],boxes:[{x:0,y:2.9,z:0,hx:.65,hy:.1,hz:.65}],expect:'feet',height:3},
 {name:'linear slope',slope:true,expect:'original'},
];
for(const scale of[.5,1,2])for(const spec of specs){
 const terrain=spec.slope?{...flat,height:(x,z)=>.25*x+.1*z,raycast:()=>Infinity}:flat;
 const world=createWorld({minX:-10,maxX:10,minZ:-10,maxZ:10,terrain});
 for(const b of spec.boxes||[])world.add({type:'box',...b});
 const death=spec.death?{x:spec.death[0],y:spec.death[1],z:spec.death[2]}:{x:.4,y:terrain.height(.4,.2),z:.2};
 const body={x:death.x,z:death.z};world.pushOut(body,.34,death.y,1.78,.45);assert.ok(Math.hypot(body.x-death.x,body.z-death.z)<.02,'source actor body is clear: '+spec.name);
 let ground=0,push=0,query=0;const groundAt=world.groundAt,pushOut=world.pushOut,nearby=world.query;world.groundAt=(...a)=>{ground++;return groundAt(...a);};world.pushOut=(...a)=>{push++;return pushOut(...a);};world.query=(...a)=>{query++;return nearby(...a);};
 const random=Math.random;Math.random=()=>{throw Error('placement must not consume RNG');};let point;try{point=deathDropPoint(world,death,box,scale);}finally{Math.random=random;}
 assert.ok(point,spec.name+' has a physical local point');assert.ok(Math.hypot(point.x-death.x,point.z-death.z)<=Math.hypot(.6,.3)+1e-9);
 if(spec.expect==='original')assert.ok(Math.hypot(point.x-death.x-.6,point.z-death.z-.3)<1e-9,spec.name+' keeps its original safe offset');
 if(spec.expect==='feet')assert.ok(Math.hypot(point.x-death.x-.6,point.z-death.z-.3)>.01,spec.name+' declines its obstructed offset');
 if(spec.height!=null)assert.ok(Math.abs(point.y-spec.height)<1e-9);
 const radius=Math.hypot((box.max.x-box.min.x)*scale/2,(box.max.z-box.min.z)*scale/2),height=(box.max.y-box.min.y)*scale,clear={x:point.x,z:point.z};pushOut(clear,radius,point.y, height,0,MOVE|SHOT);assert.ok(Math.hypot(clear.x-point.x,clear.z-point.z)<1e-6,'real scaled loot bounds are collision-clear');
 let contact=Infinity,maxPenetration=0;
 for(let a=0;a<=12;a++)for(let b=0;b<=8;b++){const x=point.x+(box.min.x+(box.max.x-box.min.x)*a/12)*scale,z=point.z+(box.min.z+(box.max.z-box.min.z)*b/8)*scale,y=groundAt(x,z,death.y,.45,0),gap=point.y+box.min.y*scale-y;contact=Math.min(contact,gap);maxPenetration=Math.max(maxPenetration,-gap);}
 assert.ok(contact>=-1e-6&&contact<.002&&maxPenetration<1e-6,'scaled footprint is supported without terrain penetration');
 assert.ok(world.clear(death.x,death.y+1.62,death.z,point.x,point.y+.15,point.z),'the box is visible from the actual corpse side');
 assert.ok(ground<=576&&push<=6&&query<=6,'local helper call budget is strict');
 const calls={ground,push,query};
 const repeated=deathDropPoint(world,death,box,scale);assert.deepEqual(repeated,point,'choice is stable');
 records.push({name:spec.name,scale,death,point,...calls,contact,maxPenetration});
}
{
 const {createTerrain}=await import('../js/terrain.js');
 const oldScheduler=globalThis.scheduler;globalThis.scheduler={yield:async()=>{}};
 const terrain=await createTerrain({bounds:{minX:-1,maxX:2,minZ:-1,maxZ:2},height:(x,z)=>Math.abs(x-.5)<1e-8&&Math.abs(z-.5)<1e-8?.5:0,splat:()=>[1,0,0,0]}, {}, {wet:{value:0},rain:{value:0},time:{value:0},waterLevel:{value:-1e4}});globalThis.scheduler=oldScheduler;
 const world=createWorld({minX:-1,maxX:2,minZ:-1,maxZ:2,terrain}),death={x:-.05,y:0,z:.2},original={x:.55,z:.5};
 const five=[[original.x,original.z],...[box.min.x,box.max.x].flatMap(x=>[box.min.z,box.max.z].map(z=>[original.x+x,original.z+z]))].map(([x,z])=>terrain.height(x,z));
 assert.ok(Math.max(...five)<=.451&&terrain.height(.5,.5)>.451,'the actual master-grid crest is missed by centre/corner-only support samples');
 const point=deathDropPoint(world,death,box,1);assert.ok(point);assert.ok(Math.hypot(point.x-original.x,point.z-original.z)>.01,'exact footprint events reject the buried original point');
 records.push({name:'actual master-grid interior crest',scale:1,death,point,fiveSampleMax:Math.max(...five),realPeak:terrain.height(.5,.5)});
 const geometries=new Set();for(const mesh of terrain.group.children)for(const mode of['fine','coarse'])if(mesh.userData[mode])geometries.add(mesh.userData[mode]);for(const g of geometries)g.dispose();terrain.material.dispose();
}
{
 const radius=Math.hypot((box.max.x-box.min.x)/2,(box.max.z-box.min.z)/2),height=box.max.y-box.min.y,world=createWorld({minX:-4,maxX:4,minZ:-4,maxZ:4,terrain:flat});
 world.add({type:'cyl',x:.95,y:0,z:.5,r:.01,h:.2});world.add({type:'cyl',x:1+radius+.01,y:0,z:.5,r:.01,h:.2});world.add({type:'cyl',x:.7,y:0,z:.35,r:.04,h:.3});
 const endpoint={x:1,z:.5},hit=world.pushOut(endpoint,radius,0,height,0,MOVE|SHOT);assert.equal(hit,true);assert.ok(Math.hypot(endpoint.x-1,endpoint.z-.5)<1e-6,'opposing contacts cancel net correction but remain collisions');
 const point=deathDropPoint(world,{x:.4,y:0,z:.2},box);assert.ok(point);assert.ok(Math.hypot(point.x-1,point.z-.5)>.01,'overlap flag rejects the buried original even when corridor support is higher');
 const actual={x:point.x,z:point.z};assert.equal(world.pushOut(actual,radius,point.y,height,0,MOVE|SHOT),false,'alternative has no actual contacts');records.push({name:'opposing endpoint contacts below lifted corridor',scale:1,point,oldNet:endpoint,hit});
}
const cases=[];
const slope={height:(x,z)=>.25*x+.1*z,normal:()=>{const n=Math.hypot(.25,1,.1);return[-.25/n,1/n,-.1/n];},surfaceAt:()=> 'stone',raycast(x,y,z,dx,dy,dz,max){const d=dy-.25*dx-.1*dz;if(d>=0)return Infinity;const t=(.25*x+.1*z-y)/d;return t>=0&&t<=max?t:Infinity;}};
for(const kind of['clear','wall','corner','step','slope']){
 const s=pickupScenario({drop:true,type:'ammo',terrain:kind==='slope'?slope:null,level:{checkpoints:[{spawn:[0,0,0]},{x:0,z:0,r:1,spawn:[0,0,0]}]}});s.tick();assert.equal(s.M.checkpoint,1);
 if(kind==='wall'||kind==='corner')s.G.world.add({type:'box',x:1,y:1.5,z:.5,hx:.2,hy:1.5,hz:2,surface:'stone'});
 if(kind==='corner')s.G.world.add({type:'box',x:.4,y:1.5,z:.8,hx:2,hy:1.5,hz:.2,surface:'stone'});
 if(kind==='step')s.G.world.add({type:'box',x:1,y:.15,z:.5,hx:.3,hy:.15,hz:.4,surface:'stone'});
 for(const a of[s.P,...s.G.enemies]){const p=a.pos.clone();s.G.world.pushOut(p,.34,p.y,1.78,.45);assert.ok(p.distanceTo(a.pos)<.02,'living bodies are clear');}
 s.killForDrop();assert.equal(s.M.pickups.length,1);const k=s.M.pickups[0];assert.equal(k.type,'ammo');assert.ok(Math.hypot(k.x-s.G.enemies[0].pos.x,k.z-s.G.enemies[0].pos.z)<=.671);
 const sight=s.G.world.clear(...s.G.camera.position.toArray(),k.x,k.y+.15,k.z);assert.equal(sight,true,'actual source-side camera sees the supply');
 if(kind==='wall'||kind==='corner')assert.ok(k.x<.66,'loot stays fully on the corpse side');
 if(kind==='clear')assert.deepEqual([k.x,k.y,k.z],[1,0,.5],'clear ground preserves exact old offset');
 if(kind==='step')assert.ok(Math.abs(k.y-.3)<1e-9,'low step receives the supported box');
 s.tick();assert.equal(k.taken,true);assert.ok(Object.values(s.P.ammo).some(a=>a.reserve>0),'real P adds the unchanged ammunition amount');
 const inv=s.P.inventory(),count=s.M.pickups.length,position=[k.x,k.y,k.z],object=k.object;const saved=s.M.restoreCheckpoint();assert.equal(k.taken,false);s.enemies.resetLiving();s.P.reset(saved.spawn,saved.inventory);s.tick();assert.deepEqual(s.P.inventory(),inv,'inventory rollback then recollection yields one supply');assert.equal(s.M.pickups.length,count);assert.deepEqual([k.x,k.y,k.z],position);assert.equal(k.object,object);assert.equal(k.taken,true,'retry reuses the retained object without a new drop');
 cases.push({kind,position,sight});s.dispose();
}
// Captured from the actual published producer before this change. UUID
// creation remains in its established place between chance and type draws.
const established = [[1,10,'ammo'],[8,10,'grenades'],[9127,1,null],[12345,10,'ammo'],[33333,10,'ammo'],[9127123,1,null],[0xabcdef01,10,'ammo']];
for(const [seed,count,kind]of established)for(const mode of['clear','wall','sealed']){
 const s=pickupScenario({drop:true});
 if(mode==='wall')s.G.world.add({type:'box',x:1,y:1.5,z:.5,hx:.2,hy:1.5,hz:2,surface:'stone'});
 if(mode==='sealed')s.G.world.add({type:'box',x:.4,y:1.5,z:.2,hx:2,hy:1.5,hz:2,surface:'stone'});
 let state=seed>>>0,draws=0;
 s.killForDrop(()=>{draws++;state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;});
 assert.equal(draws,count,'actual death/drop global RNG order remains unchanged');
 assert.deepEqual(s.M.pickups.map(k=>k.type),mode==='sealed'||!kind?[]:[kind],'probability/type remain unchanged at valid locations; impossible enclosed locations create no hidden object');
 const born=s.M.pickups.map(k=>({type:k.type,x:k.x,y:k.y,z:k.z,taken:k.taken})),payload=[];
 const ammo=s.P.addAmmo,grenades=s.P.addGrenades;s.P.addAmmo=(n)=>{payload.push(['ammo',n]);return ammo(n);};s.P.addGrenades=(n)=>{payload.push(['grenades',n]);return grenades(n);};
 s.M.restoreCheckpoint();assert.deepEqual(s.M.pickups.map(k=>({type:k.type,x:k.x,y:k.y,z:k.z,taken:k.taken})),born,'retry never reruns or moves a born drop');s.tick();
 assert.deepEqual(payload,mode==='sealed'||!kind?[]:[[kind,kind==='ammo'?.5:2]],'actual P receives the established supply amount');
 s.dispose();
}
console.log('ok',records.length,'actual scaled geometry cases,5 actual death consumers and21 RNG/payload/retry controls');
