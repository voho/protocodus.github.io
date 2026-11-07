// Actual ordinary-jump/headroom regressions, including real bunker doorway entry.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const THREE=await import('three');
const {createPlayer}=await import('../js/player.js');
const {createWorld,MOVE,SHOT}=await import('../js/world.js');
const {createCameraRig}=await import('../js/camera.js');
const {createInput}=await import('../js/input.js');
const {PLAYER,DEFAULT_SETTINGS}=await import('../js/config.js');
const bounds={minX:-10,maxX:10,minZ:-10,maxZ:10},terrain={height:()=>0,surfaceAt:()=> 'mud',raycast:()=>Infinity};
const worldOf=(col=null)=>{const w=createWorld({...bounds,terrain});if(col)w.add({...col});return w;};
const windowEvents=new EventTarget(),doc=new EventTarget();globalThis.window=windowEvents;document.addEventListener=doc.addEventListener.bind(doc);document.removeEventListener=doc.removeEventListener.bind(doc);
const input=createInput(new EventTarget()),noop=()=>{},svc=new Proxy({},{get:()=>noop});
const key=(type,code)=>{const e=new Event(type,{cancelable:true});e.code=code;windowEvents.dispatchEvent(e);};
const actualRows=[],footprintRows=[];
function run(fps,crouch,col,groundHeight=0,extraColliders=[],spawnX=0){
 const localTerrain={...terrain,height:()=>groundHeight};
 const world=createWorld({...bounds,terrain:localTerrain}),camera=new THREE.PerspectiveCamera(68,1.6,.05,100);if(col)world.add({...col});for(const c of extraColliders)world.add({...c});
 let calls=0;const limit=world.limitUpwardMove;world.limitUpwardMove=function(...args){assert.ok(args.at(-1)>0);calls++;return limit.apply(this,args);};
 const G={time:0,level:{playBounds:bounds},world,terrain:localTerrain,camera,scene:new THREE.Scene(),soldier:null,models:new Map(),matlib:{get:()=>new THREE.MeshBasicMaterial(),resolve:m=>m},audio:svc,hud:svc,effects:svc,lights:svc,debris:svc,casings:svc,events:{emit:noop},shared:{wet:{value:1}},enemies:[],stats:{damageTaken:0,shots:0,grenades:0}};
 G.rig=createCameraRig(camera,world);const P=createPlayer(G);G.player=P;input.enable(false);input.enable(true);P.reset([spawnX,-3.8,0]);
 const step=()=>{G.time+=1/fps;P.update(1/fps,input,DEFAULT_SETTINGS);input.endFrame();};
 if(crouch){key('keydown','KeyC');step();key('keyup','KeyC');assert.equal(P.crouch,true);}
 key('keydown','KeyW');for(let n=0;n<fps*6&&P.pos.z<.1;n++)step();key('keyup','KeyW');for(let n=0;n<fps/2;n++)step();
 assert.ok(P.pos.z>.1&&P.pos.z<.6&&P.pos.y===groundHeight&&P.grounded,'normal W reaches the supported underhang approach');
 assert.equal(calls,0,'ordinary grounded walking performs no upward sweep');
 const start=P.pos.toArray(),height=crouch?PLAYER.crouchHeight:PLAYER.height,frames=[];
 key('keydown','Space');
 for(let n=0;n<fps*2;n++){
  const before=P.pos.toArray();step();if(n===0)key('keyup','Space');
  const pos=P.pos.toArray(),q={x:pos[0],z:pos[2]},blocked=world.pushOut(q,PLAYER.radius,pos[1],height,PLAYER.step);
  frames.push({pos,vel:P.vel.toArray(),grounded:P.grounded,vault:!!P.vault,blocked,correction:Math.hypot(q.x-pos[0],q.z-pos[2]),horizontalStep:Math.hypot(pos[0]-before[0],pos[2]-before[2])});
 }
 const callsAfterJump=calls;for(let n=0;n<10;n++)step();assert.equal(calls,callsAfterJump,'idle after landing performs no upward sweep');
 assert.ok(frames.every(f=>!f.vault&&!f.blocked&&f.correction<1e-9&&f.horizontalStep<.004),'ordinary jump remains clear without horizontal ejection');
 input.enable(false);P.char.dispose();return{fps,crouch,height,start,maximumFeet:Math.max(...frames.map(f=>f.pos[1])),upwardCalls:callsAfterJump,frames};
}
const {worldColliders}=await import('../js/assets.js');
const military=await readFile(new URL('../assets/models/military.glb',import.meta.url));
const militaryJSON=JSON.parse(military.subarray(20,20+military.readUInt32LE(12)).toString());
const bunkerModel={colliders:JSON.parse(militaryJSON.nodes.find(n=>n.name==='bunker').extras.colliders)};
const bunkerColliders=worldColliders(bunkerModel,0,0,0,0,1,'stone');
const roof=bunkerColliders.find(c=>c.type==='box'&&c.hy===.45&&c.hz>2);
assert.ok(roof,'the authored bunker has its genuine compound ceiling');
for(const fps of[30,60,120]){
 const withRoof=run(fps,false,null,0,bunkerColliders,1.0941);
 const withoutRoof=run(fps,false,null,0,bunkerColliders.filter(c=>c!==roof),1.0941);
 assert.ok(withRoof.maximumFeet<roof.y-roof.hy-PLAYER.height+1e-9,'real doorway entry then ordinary jump remains below the roof');
 assert.ok(withoutRoof.maximumFeet>.4,'the same doorway path jumps freely with only the roof removed');
 actualRows.push({name:'authored-bunker',hit:true,...withRoof},{name:'bunker-roof-removed',hit:false,...withoutRoof});
}
for(const fps of[30,60,120])for(const crouch of[false,true]){
 const bottom=(crouch?PLAYER.crouchHeight:PLAYER.height)+.17;
 const box=(x,z,hx,hz,yaw=0)=>({type:'box',x,y:bottom+.05,z,hx,hy:.05,hz,yaw});
 const cases=[['open',null,false],['partial-edge',box(.4,.45,.1,.7),true],['rotated-edge',box(.38,.45,.08,.8,Math.PI/4),true],
  ['cylinder-edge',{type:'cyl',x:.45,y:bottom,z:.45,r:.2,h:.1},true],['rounded-corner-miss',box(.35,.8,.05,.05),false],
  ['cylinder-miss',{type:'cyl',x:.56,y:bottom,z:.45,r:.2,h:.1},false]];
 const control=run(fps,crouch,null);
 for(const[name,col,hit]of cases){const r=name==='open'?control:run(fps,crouch,col);if(hit)assert.ok(r.maximumFeet<=.1700000001&&r.maximumFeet>.15,'ascent stops under the actual partially overlapping underside');else assert.deepEqual(r.frames,control.frames,'clear/corner-miss jump, gravity and fall remain identical');actualRows.push({name,hit,...r});}
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9);
for(const yaw of[0,Math.PI/4,Math.PI/2]){
 const co=Math.cos(yaw),si=Math.sin(yaw),rotate=(x,z)=>[x*co+z*si,-x*si+z*co];
 for(const[gap,hit]of[[.23,true],[.25,false]]){
  const[x,z]=rotate(gap+.05,gap+.05),world=worldOf({type:'box',x,y:2,z,hx:.05,hy:.05,hz:.05,yaw});
  const y=world.limitUpwardMove(0,0,0,0,PLAYER.radius,0,PLAYER.height,.5);
  near(y,hit?1.95-PLAYER.height-1e-6:.5);footprintRows.push({kind:'rotated-rounded-corner',yaw,gap,hit,result:y});
 }
}
for(const[kind,col,args,expected]of[
 ['swept-middle',{type:'cyl',x:0,y:1.95,z:0,r:.05,h:.1},[-1,0,1,0,PLAYER.radius,0,PLAYER.height,.5],1.95-PLAYER.height-1e-6],
 ['time-separated-prefix',{type:'cyl',x:-.9,y:1.95,z:0,r:.05,h:.1},[-1,0,1,0,PLAYER.radius,0,PLAYER.height,.5],.5],
 ['non-MOVE',{type:'box',x:0,y:2,z:0,hx:1,hy:.05,hz:1,flags:SHOT},[0,0,0,0,PLAYER.radius,0,PLAYER.height,.5],.5],
 ['falling',{type:'box',x:0,y:2,z:0,hx:1,hy:.05,hz:1},[0,0,0,0,PLAYER.radius,0,PLAYER.height,-.1],-.1],
 ['zero',{type:'box',x:0,y:2,z:0,hx:1,hy:.05,hz:1},[0,0,0,0,PLAYER.radius,0,PLAYER.height,0],0],
 ['supported-floor',{type:'box',x:0,y:.1,z:0,hx:1,hy:.1,hz:1},[0,0,0,0,PLAYER.radius,0,PLAYER.height,.5],.5],
]){const world=worldOf(col),y=world.limitUpwardMove(...args);near(y,expected);footprintRows.push({kind,result:y,expected});}
for(const height of[PLAYER.height,PLAYER.crouchHeight])for(const bottom of[1.9503,3.7803,17.1234])for(const shape of['box','cyl']){
 const col=shape==='box'?{type:'box',x:0,y:bottom+.1,z:0,hx:1,hy:.1,hz:1}:{type:'cyl',x:0,y:bottom,z:0,r:1,h:.2};
 const world=worldOf(col),feet=bottom-height-.05,y=world.limitUpwardMove(0,0,0,0,PLAYER.radius,feet,height,.2),q={x:0,z:0};
 assert.ok(y>=feet&&y+height<world.colliders[0].bottom,'the rounded addition remains below the actual underside');
 assert.equal(world.pushOut(q,PLAYER.radius,y,height,PLAYER.step),false,'next-frame horizontal body solver does not eject the clamped body');
 footprintRows.push({kind:'rounding-next-body',height,bottom,shape,feet,result:y,head:y+height});
}
for(const fps of[30,60,120])for(const crouch of[false,true]){
 const height=crouch?PLAYER.crouchHeight:PLAYER.height,ground=1.95,bottom=ground+height+.0503;
 for(const shape of['box','cyl']){
  const col=shape==='box'?{type:'box',x:0,y:bottom+.1,z:.45,hx:1,hy:.1,hz:1}:{type:'cyl',x:0,y:bottom,z:.45,r:1,h:.2};
  const r=run(fps,crouch,col,ground);assert.ok(r.maximumFeet<ground+.0503);actualRows.push({name:'rounding-raised-'+shape,hit:true,...r});
 }
}
input.enable(false);
console.log(`player-upward-clearance-check: ${actualRows.length} actual input/headroom cases and ${footprintRows.length} exact footprint/rounding controls pass`);
