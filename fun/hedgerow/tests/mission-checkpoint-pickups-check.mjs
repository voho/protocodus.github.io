// Actual input/player/mission/main retry; render/audio beds are inert sinks.
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';
import{pickupScenario}from'./pickup-fixture.mjs';import{soldier}from'./ai-fixture.mjs';
const{DEFAULT_SETTINGS}=await import('../js/config.js');
const main=readFileSync('fun/hedgerow/js/main.js','utf8'),start=main.indexOf('function retryCheckpoint() {'),end=main.indexOf('\nfunction cancelCompletionPresentation()',start),retrySource=main.slice(start,end);
assert.ok(start>=0&&end>start,'actual main retry function is present');
const total=inv=>Object.values(inv.ammo).reduce((n,a)=>n+a.mag+a.reserve,0)+inv.grenades;
const checkpointLevel=(pickups=[],later=true)=>({pickups,hints:[],checkpoints:[{spawn:[0,0,0]},{x:0,z:5,r:.5,spawn:[0,5,0]},...(later?[{x:0,z:11,r:.5,spawn:[0,11,0]}]:[])],objectives:[{id:'approach',kind:'reach',x:0,z:5,r:.5,text:'Reach the checkpoint'},{id:'remaining',kind:'clear',groups:['remaining'],text:'Clear the remaining guard'}]});
function game(options={}){
 const s=pickupScenario({drop:true,definitions:[soldier(10,20,{hold:true,group:'remaining'})],...options});
 if(!options.full){for(const a of Object.values(s.P.ammo))a.mag=a.reserve=0;s.P.grenades=0;s.P.health=40;s.P.hurtTimer=0;}
 const sceneAdd=s.G.scene.add.bind(s.G.scene),adds=new Map();s.G.scene.add=(...objects)=>{for(const o of objects)adds.set(o,(adds.get(o)||0)+1);return sceneAdd(...objects);};
 const history=[];
 function key(code,on){const e=new Event(on?'keydown':'keyup',{cancelable:true});Object.defineProperty(e,'code',{value:code});window.dispatchEvent(e);}
 function frame(){s.G.time+=1/60;const before=s.M.checkpoint;s.P.update(1/60,s.input,DEFAULT_SETTINGS);for(const e of s.G.enemies)e.perceiveTimer=1e6;s.enemies.update(1/60);s.M.update(1/60,s.input);s.input.endFrame();if(s.M.checkpoint!==before)history.push({checkpoint:s.M.checkpoint,saved:structuredClone(s.M.inventory),live:s.P.inventory(),taken:s.M.pickups.map(k=>k.taken)});}
 function walk(z){const code=s.P.pos.z<z?'KeyW':'KeyS';key(code,true);let n=0;while((code==='KeyW'?s.P.pos.z<z:s.P.pos.z>z)&&n++<900)frame();key(code,false);for(let i=0;i<15;i++)frame();assert.ok(n<900,'real input reaches the test area');}
 const originalRestore=s.M.restoreCheckpoint;let restoreCalls=0,attemptCalls=null;
 s.M.restoreCheckpoint=()=>{restoreCalls++;attemptCalls?.push(['restore']);const random=Math.random;Math.random=()=>{throw Error('pickup restore must not instantiate or reroll');};try{return originalRestore();}finally{Math.random=random;}};
 function retry({die=true,graphicsLost=false}={}){
  if(die){s.input.enable(false);s.P.damage(1000);assert.equal(s.P.alive,false);}
  const noop=()=>{},service=new Proxy({}, {get:()=>noop}),calls=[];s.G.casings=s.G.chunks=s.G.steam=service;
  const context={graphicsLost,mission:s.M,audio:new Proxy({}, {get:(_,k)=>(...a)=>calls.push([k,...a])}),cancelCompletionPresentation:noop,player:s.P,G:s.G,deathSequence:0,explosives:service,enemies:s.enemies,resetAcoustics:noop,trackAttemptStart:noop,fade:{classList:{remove:noop}},resume(){s.input.enable(true);}};
  attemptCalls=calls;try{vm.runInNewContext('('+retrySource+')',context)();}finally{attemptCalls=null;}return{calls,restoreCalls};
 }
 return{...s,key,frame,walk,retry,history,adds,restoreCalls:()=>restoreCalls};
}
for(const type of['ammo','grenades','medkit'])for(const timing of['before','after','same']){
 const at=timing==='before'?1.5:timing==='same'?5.9:7.5,s=game({level:checkpointLevel([{type,x:0,z:at}])});s.walk(8);
 const k=s.M.pickups[0],object=k.object;assert.equal(k.taken,true);assert.equal(s.M.checkpoint,1);const saved=structuredClone(s.M.inventory),progress=[...s.M.completed],index=s.M.index,score=s.G.stats.objectives;
 if(timing==='same'){assert.equal(s.history[0].taken[0],true,'collection occurs in the checkpoint frame');assert.equal(total(s.history[0].saved),0,'same-frame inventory was captured before the supply');}
 for(let attempt=0;attempt<3;attempt++){
  const addBefore=s.adds.get(object)||0,result=s.retry();assert.equal(result.calls[0]?.[0],'cancelAttempt','old audio is canceled before supply restoration');assert.ok(result.calls.findIndex(c=>c[0]==='cancelActions')<result.calls.findIndex(c=>c[0]==='restore'));assert.equal(s.P.alive,true);assert.deepEqual(s.P.inventory(),saved,'saved inventory semantics stay unchanged');assert.equal(s.M.pickups.length,1);assert.equal(k.object,object);assert.deepEqual([...s.M.completed],progress);assert.equal(s.M.index,index);assert.equal(s.G.stats.objectives,score);
  if(timing==='before'){assert.equal(k.taken,true);assert.equal(object.parent,null);assert.equal(s.adds.get(object)||0,addBefore,'pre-checkpoint supply stays consumed');break;}
  assert.equal(k.taken,false);assert.equal(object.parent,s.G.scene);assert.equal(s.G.scene.children.filter(o=>o===object).length,1);assert.equal(s.adds.get(object),addBefore+1,'exact retained object is added once');
  const adds=s.adds.get(object);s.retry();assert.equal(s.adds.get(object),adds,'repeated retry without collection cannot duplicate it');
  if(type==='medkit'){s.P.health=40;s.P.hurtTimer=0;}
  s.walk(at);assert.equal(k.taken,true);assert.equal(object.parent,null);if(type==='medkit')assert.equal(s.P.health,100);else assert.ok(total(s.P.inventory())>total(saved),'post-checkpoint supply is usable again');assert.deepEqual(s.M.inventory,saved,'collection cannot silently bank a new inventory');
 }
 s.dispose();
}
for(const type of['ammo','grenades','medkit']){
 const s=game({full:true,level:checkpointLevel([{type,x:0,z:7.5}])});s.walk(8);const k=s.M.pickups[0],object=k.object;assert.equal(k.taken,false,'full capacity cannot consume a supply');const saved=structuredClone(s.M.inventory),adds=s.adds.get(object)||0;s.retry();assert.deepEqual(s.P.inventory(),saved);assert.equal(k.taken,false);assert.equal(k.object,object);assert.equal(s.adds.get(object)||0,adds,'unconsumed objects are not re-added');s.dispose();
}
{
 const s=game({level:checkpointLevel([{type:'ammo',x:0,z:7.5}])});s.walk(8);const k=s.M.pickups[0];assert.equal(k.taken,true);s.walk(11.5);assert.equal(s.M.checkpoint,2);const saved=structuredClone(s.M.inventory);s.retry();assert.equal(k.taken,true,'a later checkpoint commits the consumed supply');assert.deepEqual(s.P.inventory(),saved);s.dispose();
}
for(const type of['ammo','grenades'])for(const consumed of[false,true]){
 const definitions=[soldier(0,8,{hold:true,group:'victim'}),soldier(10,20,{hold:true,group:'remaining'})],s=game({definitions,level:checkpointLevel()});s.walk(5.1);let kills=0;s.G.events.on('enemyKilled',()=>kills++);
 s.killForDrop(()=>type==='ammo'?.3:.1);assert.equal(kills,1);assert.equal(s.G.enemies[0].dead,true);assert.equal(s.M.pickups.length,1);const k=s.M.pickups[0],object=k.object,position=[k.x,k.y,k.z];assert.equal(k.type,type);
 if(consumed){s.walk(8.5);assert.equal(k.taken,true);}else assert.equal(k.taken,false);
 const progress=[...s.M.completed],score=s.G.stats.objectives,addBefore=s.adds.get(object)||0;s.retry();assert.equal(s.G.enemies[0].dead,true,'actual resetLiving keeps the kill');assert.equal(kills,1);assert.equal(s.M.pickups.length,1);assert.equal(k.object,object);assert.deepEqual([k.x,k.y,k.z],position);assert.equal(k.taken,false);assert.equal(s.adds.get(object)||0,addBefore+(consumed?1:0));assert.deepEqual([...s.M.completed],progress);assert.equal(s.G.stats.objectives,score);
 s.walk(8.5);assert.equal(k.taken,true);s.retry();assert.equal(k.taken,false);assert.equal(kills,1,'retry cannot reroll an enemy drop');assert.equal(s.M.pickups.length,1);s.dispose();
}
{
 // Identical coordinates/types still have distinct checkpoint identities.
 const definitions=[soldier(-.6,1.2,{hold:true,group:'victim'}),soldier(10,20,{hold:true,group:'remaining'})],s=game({definitions,level:checkpointLevel([{type:'ammo',x:0,z:1.5}])});s.walk(5.5);const first=s.M.pickups[0];assert.equal(first.taken,true);s.killForDrop();const second=s.M.pickups[1];assert.deepEqual([first.x,first.y,first.z],[second.x,second.y,second.z]);assert.notEqual(first.object,second.object);s.walk(1.5);assert.equal(second.taken,true);s.retry();assert.equal(first.taken,true);assert.equal(second.taken,false);assert.equal(first.object.parent,null);assert.equal(second.object.parent,s.G.scene);s.dispose();
}
{
 const placed=new Map([['radio',{x:0,y:0,z:5,yaw:0,model:{anchors:{interact:[0,1,0]}},object:null}]]),level=checkpointLevel([{type:'ammo',x:0,z:7.5}]);level.objectives.splice(1,0,{id:'radio',kind:'interact',target:'radio',x:0,z:5,r:2.2,duration:2,action:'report',text:'Report'});const s=game({placed,level});s.walk(5.1);let actions=0;s.G.events.on('missionAction',()=>actions++);s.key('KeyF',true);for(let i=0;i<40;i++)s.frame();assert.ok(s.M.interaction?.elapsed>.5);s.retry();assert.equal(s.M.interaction,null);assert.equal(s.M.isComplete('radio'),false);s.key('KeyF',true);for(let i=0;i<90;i++)s.frame();assert.equal(s.M.isComplete('radio'),false,'partial work was not retained');for(let i=0;i<40;i++)s.frame();s.key('KeyF',false);assert.equal(s.M.isComplete('radio'),true);assert.equal(actions,1);s.walk(8);s.retry();assert.equal(s.M.isComplete('radio'),true);assert.equal(actions,1);assert.equal(s.M.index,2);assert.equal(s.M.pickups[0].taken,false);s.dispose();
}
{
 const level=checkpointLevel([{type:'ammo',x:0,z:7.5}]);level.objectives[1]={id:'finish',kind:'reach',x:0,z:9,r:.5,text:'Finish'};const s=game({definitions:[],level});s.walk(9.5);assert.equal(s.M.done,true);const k=s.M.pickups[0],state={inventory:s.P.inventory(),taken:k.taken,parent:k.object.parent,completed:[...s.M.completed]},calls=s.restoreCalls();const result=s.retry({die:false});assert.equal(result.calls.length,0,'actual main completion guard returns before cancellation/reset');assert.equal(s.restoreCalls(),calls);assert.deepEqual(s.P.inventory(),state.inventory);assert.equal(k.taken,state.taken);assert.equal(k.object.parent,state.parent);assert.deepEqual([...s.M.completed],state.completed);s.dispose();
}
console.log('ok authored/death supplies, all types, same-frame/later checkpoints, repeated real retries, capacity, identity, kills/actions and completion guard');
