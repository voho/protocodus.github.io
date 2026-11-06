// Run with: node fun/hedgerow/tests/held-grenade-presentation-check.mjs
// Real original GLB rig and player rules, no renderer or mission world.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const THREE=await import('three');
const {GLTFLoader}=await import('../assets/vendor/GLTFLoader.js');
const {readSet}=await import('../js/assets.js');
const {createPlayer}=await import('../js/player.js');
const {createExplosives}=await import('../js/combat.js');
const {createWorld,MOVE}=await import('../js/world.js');
const {createCameraRig}=await import('../js/camera.js');
const {DEFAULT_SETTINGS}=await import('../js/config.js');
const here=new URL('../',import.meta.url).pathname;
function parse(name) {
  const b = readFileSync(`${here}assets/models/${name}.glb`);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials || []) {
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
  for (const k of ['extensionsUsed', 'extensionsRequired']) {
    j[k] = (j[k] || []).filter((e) => e !== 'EXT_texture_webp');
    if (!j[k].length) delete j[k];
  }
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = b.subarray(20 + jl);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length + bin.length, 8);
  head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const glb = Buffer.concat([head, json, bin]);
  return new Promise((res, rej) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length), '', res, rej));
}


const soldier=await parse('soldier'),models=new Map();
for(const name of ['weapons','military'])readSet(await parse(name),name,models);
const noop=()=>{},services=new Proxy({},{get:()=>noop});
const sizes={grenade_us:[.0647987611591816,.10656252130866051,.057249702513217926],grenade_de:[.07039999961853027,.07039999961853027,.36500006914138794]};
for(const [name,size]of Object.entries(sizes))assert.ok(models.get(name).box.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(...size))<1e-7,`${name}: original authored dimensions`);
const authoredPositions=new Map(Object.keys(sizes).flatMap(name=>models.get(name).prims.map(primitive=>
 [primitive.geometry,Array.from(primitive.geometry.attributes.position.array)])));
function fixture(outfit,{fps=60,ads=false,wall=false}={}){
 const dt=1/fps,bounds={minX:-10,maxX:10,minZ:-10,maxZ:10};
 const terrain={height:()=>0,surfaceAt:()=> 'mud',raycast:()=>Infinity};
 const world=createWorld({...bounds,terrain});
 if(wall)world.add({type:'box',x:0,y:1.5,z:.45,hx:2,hy:1.5,hz:.1,surface:'stone'});
 const grenadeName=outfit==='allied'?'grenade_us':'grenade_de';
 const G={time:0,level:{playBounds:bounds,loadout:outfit==='allied'?['garand','thompson']:['kar98k','mp40'],playerOutfit:outfit,playerIdentity:outfit==='axis'?'czech-resistance':null,playerGrenade:grenadeName},world,terrain,
  camera:new THREE.PerspectiveCamera(68,1.6,.05,100),scene:new THREE.Scene(),soldier,models,
  matlib:{get:()=>new THREE.MeshBasicMaterial(),resolve:m=>m||new THREE.MeshBasicMaterial()},renderer:{},
  hud:services,audio:services,effects:services,lights:services,debris:services,casings:services,
  events:{emit:noop},shared:{wet:{value:.28}},enemies:[],stats:{damageTaken:0,shots:0,hits:0,grenades:0}};
 G.rig=createCameraRig(G.camera,world);G.rig.cameraMotion=0;
 G.player=createPlayer(G);const P=G.player;P.reset([0,0,0]);
 G.explosives=createExplosives(G);
 const down=new Set(),edges=new Set();
 const input={mouseR:ads,mouseL:false,consumeMouse:()=>[0,0],consumeWheel:()=>0,fired:()=>false,held:k=>down.has(k),pressed:k=>edges.has(k),press(k){down.add(k);edges.add(k)},release(k){down.delete(k)}};
 const tick=(elapsed=dt)=>{G.time+=elapsed;P.update(elapsed,input,DEFAULT_SETTINGS);edges.clear();};
 const run=seconds=>{for(let i=0;i<Math.round(seconds/dt);i++)tick();};
 const grenade=()=>P.char.root.getObjectByName(grenadeName);
 const action=()=>P.char.mixer._actions.find(action=>action.getClip().name==='throw_up');
 const births=[];const realThrow=G.explosives.throwGrenade;
 G.explosives.throwGrenade=function(...args){
  const flight=realThrow.apply(G.explosives,args);
  births.push({at:G.time,pos:args[1].clone(),eye:G.camera.position.clone(),forward:G.camera.getWorldDirection(new THREE.Vector3()),
   held:P.char.heldGrenadeWorld(),orientation:P.char.heldGrenadeRotation(),phase:action().time,visible:grenade().visible,flight});
  return flight;
 };
 run(2);
 function hold(){input.press('KeyG');tick();run(.6);assert.ok(P.cooking>=0);return grenade();}
 function windup(){input.release('KeyG');tick();assert.ok(P.throwing>0);return G.time;}
 function clear(){G.explosives.clear();P.char.dispose();}
 return{G,P,input,tick,run,hold,windup,grenade,action,births,clear,dt};
}
function originalGeometry(f){
 const held=f.grenade(),model=models.get(f.G.level.playerGrenade);
 assert.equal(held.children.length,model.prims.length,'all original model primitives remain');
 held.children.forEach((mesh,index)=>{
  assert.equal(mesh.geometry,model.prims[index].geometry,'held model shares authored geometry');
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),authoredPositions.get(mesh.geometry),'holding never rewrites the original grenade vertices');
 });
 const scale=held.getWorldScale(new THREE.Vector3());
 assert.ok(scale.distanceTo(new THREE.Vector3(1,1,1))<1e-5,`grenade is never enlarged or squashed to fit the hand (${scale.toArray()})`);
 const grip=new THREE.Vector3(...(f.G.level.playerGrenade==='grenade_de'?[0,0,-.1265]:[0,-.005,0]));
 assert.ok(held.localToWorld(grip).distanceTo(f.P.char.socket.getWorldPosition(new THREE.Vector3()))<1e-8,'measured original grip sits in the hand socket');
}
function inView(f){
 const held=f.grenade(),point=f.P.char.heldGrenadeWorld().project(f.G.camera);
 assert.equal(held.visible,true,'prepared grenade is visible');
 assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1&&point.z>-1&&point.z<1,'grenade origin stays inside the actual camera frustum');
 const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(f.G.camera.projectionMatrix,f.G.camera.matrixWorldInverse));
 assert.ok(frustum.intersectsBox(new THREE.Box3().setFromObject(held,true)),'authored grenade surface intersects the camera frustum');
 assert.equal(f.P.char.weapon.parent,f.P.char.socketL,'weapon is carried by the left hand while preparing');
 originalGeometry(f);
}
const phaseRows=[];
for(const outfit of ['allied','axis'])for(const ads of [false,true])for(const fps of [20,60,120]){
 const f=fixture(outfit,{fps,ads});f.hold();inView(f);
 const point=f.P.char.heldGrenadeWorld(),rotation=f.P.char.heldGrenadeRotation(),time=f.G.time,cooking=f.P.cooking,aim=f.G.rig.aimT;
 for(let i=0;i<40;i++)f.tick(0);
 assert.ok(f.P.char.heldGrenadeWorld().distanceTo(point)<1e-8,'zero-dt updates do not drift the held grenade');
 assert.ok(Math.abs(f.P.char.heldGrenadeRotation().dot(rotation))>1-1e-12,'zero-dt updates do not rotate the held grenade');
 assert.equal(f.G.time,time);assert.equal(f.P.cooking,cooking);assert.equal(f.G.rig.aimT,aim);assert.equal(f.births.length,0);
 assert.ok(f.G.rig.aimT<.1,'cooking lowers ADS even if the aim button remains held');
 const start=f.windup();
 assert.ok(Math.abs(f.action().time-.18)<1e-8,'throw birth frame has the same authored phase at every cadence');
 for(let i=0;i<Math.round(.3/f.dt)-1;i++)f.tick();
 assert.equal(f.births.length,0,'the full 300 ms wind-up must pass before physical release');f.tick();
 assert.equal(f.births.length,1,'exactly one projectile is born at the release beat');
 const b=f.births[0],forward=b.pos.clone().sub(b.eye).dot(b.forward);
 assert.ok(Math.abs(b.at-start-.3)<1e-8,'release remains on simulation time');
 assert.ok(Math.abs(b.phase-.54)<1e-8,'release samples the same authored throwing phase at20/60/120Hz');
 assert.ok(forward>.15,'neutral projectile birth is in front of the actual eye');
 assert.ok(b.pos.distanceTo(b.held)<1e-8,'unobstructed projectile is born at the final held-model origin');
 assert.ok(b.flight.mesh.quaternion.toArray().every((value,index)=>Math.abs(value-b.orientation.toArray()[index])<1e-12),'projectile inherits the exact held-model world rotation');
 assert.equal(b.visible,true,'held copy exists immediately before the physical birth');
 assert.equal(f.grenade().visible,false,'held copy hides on the release frame');
 assert.equal(f.G.stats.grenades,1);assert.equal(f.G.explosives.list.length,1);
 f.run(1.4);assert.equal(f.births.length,1,'follow-through cannot duplicate the physical projectile');
 assert.equal(f.P.char.weapon.parent,f.P.char.socket,'weapon returns to the right hand');
 if(ads)assert.ok(f.G.rig.aimT>.95,'held aim returns after the action');
 phaseRows.push({outfit,ads,fps,phase:b.phase,forward});f.clear();
}
for(const outfit of ['allied','axis']){
 const f=fixture(outfit,{wall:true});f.hold();f.windup();f.run(.3);
 const b=f.births[0],delta=b.pos.clone().sub(b.eye),distance=delta.length();delta.normalize();
 assert.ok(b.pos.z<.35,'projectile cannot be born across a nearby stone face');
 assert.equal(f.G.world.raycast(b.eye.x,b.eye.y,b.eye.z,delta.x,delta.y,delta.z,distance,MOVE),null,'eye-to-birth segment stays on the near side of the solid');f.clear();
}
for(const outfit of ['allied','axis']){
 const f=fixture(outfit,{ads:true});const initial=f.P.weapon;f.hold();
 f.input.press('Digit2');f.tick();f.input.release('Digit2');
 assert.equal(f.P.weapon,initial,'switching cannot interrupt a cooking grenade');assert.equal(f.P.pendingWeapon,null);
 f.windup();f.input.press('Digit2');f.tick();f.input.release('Digit2');
 assert.equal(f.P.weapon,initial,'switching cannot interrupt a pending physical release');assert.ok(f.G.rig.aimT<.1);
 f.run(1.5);f.input.press('Digit2');f.tick();f.input.release('Digit2');f.run(.8);
 assert.notEqual(f.P.weapon,initial,'ordinary weapon selection works after the grenade action');f.clear();
 for(const action of ['cooking','windup']){
  const d=fixture(outfit);d.hold();if(action==='windup'){d.windup();d.run(.1)}
  const inventory=d.P.inventory();d.P.damage(1000,{x:0,y:0,z:4});
  assert.equal(d.P.alive,false);assert.equal(d.grenade().visible,false,'death hides the held grenade');
  d.run(.6);assert.equal(d.births.length,0,'death cancels the unreleased physical grenade');
  d.P.reset([0,0,0],inventory);d.run(.6);
  assert.equal(d.P.alive,true);assert.equal(d.births.length,0,'retry cannot revive the old wind-up');assert.equal(d.grenade().visible,false);
  assert.equal(d.P.char.weapon.parent,d.P.char.socket);d.clear();
 }
 const c=fixture(outfit);c.hold();c.P.char.cancelGrenade();
 assert.equal(c.grenade().visible,false,'explicit presentation cancellation hides the held copy');
 assert.equal(c.P.char.weapon.parent,c.P.char.socket);
 c.P.reset([0,0,0]);c.run(.6);assert.equal(c.births.length,0,'fresh reset clears the cooking action');c.clear();
 const r=fixture(outfit);r.hold();r.windup();r.run(.1);r.P.reset([0,0,0]);r.run(.6);
 assert.equal(r.births.length,0,'live reset cancels a pending release');assert.equal(r.grenade().visible,false);r.clear();
}
console.log(JSON.stringify(phaseRows));
console.log('held-grenade-presentation-check: real US/DE rigs preserve original grip/scale, stable cooking, cadence phase, single oriented release, wall containment and life/input guards');
process.exit(0);
