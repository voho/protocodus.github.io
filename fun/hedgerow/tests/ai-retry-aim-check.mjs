// Actual-rig checkpoint retries restart first-volley aim memory.
import assert from 'node:assert/strict';
import{aiFixture,soldier,advance}from'./ai-fixture.mjs';
import{parseUntexturedGLB}from'./rig-fixture.mjs';
const{readSet}=await import('../js/assets.js');
const rig=await parseUntexturedGLB('soldier'),models=new Map();readSet(await parseUntexturedGLB('weapons'),'weapons',models);
const fresh=new Map();
function scenario(type){
 const f=aiFixture({soldierModel:rig,models,player:[0,20],definitions:[soldier(0,0,{type,hold:true})]}),{G,enemies}=f,e=enemies.list[0],alerts=[];
 G.events.on('enemyAlert',actor=>alerts.push({time:G.time,shotsAtTarget:actor.shotsAtTarget,firstShot:actor.firstShot,state:actor.state,mag:actor.mag}));
 function rounds(n){advance(G,enemies,120,()=>f.shots.length>=n?false:undefined);assert.equal(f.shots.length,n,'the real rig fires the requested rounds through normal perception/combat/reload');}
 const volley=()=>({shotsAtTarget:e.shotsAtTarget,firstShot:e.firstShot,mag:e.mag,state:e.state});
 return{...f,e,alerts,rounds,volley,dispose(){e.char.dispose();}};
}
let current=null;
try{
 // Continuous engagements retain normal shot tracking before any checkpoint reset.
 for(const type of['rifle','smg']){
  const s=scenario(type);current=s;s.rounds(1);fresh.set(type,{volley:s.volley(),alert:s.alerts[0]});assert.equal(s.alerts[0].firstShot,true);assert.equal(s.alerts[0].shotsAtTarget,0);s.rounds(12);assert.equal(s.e.shotsAtTarget,12,'a live engagement retains its ordinary accumulated warmup');s.dispose();current=null;
 }
 {
  const s=scenario('rifle');current=s;s.rounds(8);s.e.damage(1000,s.G.player.pos,'body',true);assert.ok(s.e.char.ragdoll,'dead-state control has the shipped ragdoll');const body=s.e.char.ragdoll;
  const state=()=>({dead:s.e.dead,state:s.e.state,health:s.e.health,shotsAtTarget:s.e.shotsAtTarget,mag:s.e.mag,position:s.e.pos.toArray(),pelvis:body.pelvis.toArray(),kills:s.G.stats.kills});
  const before=state();s.enemies.resetLiving();s.enemies.resetLiving();assert.deepEqual(state(),before,'dead guard/corpse/earned kill are untouched');assert.equal(s.e.char.ragdoll,body);s.dispose();current=null;
 }
 for(const type of['rifle','smg']){
  const s=scenario(type);current=s;s.rounds(8);assert.equal(s.e.shotsAtTarget,8);
  for(let attempt=0;attempt<3;attempt++){
   const previous=s.shots.length;s.enemies.resetLiving();
   const reset={shotsAtTarget:s.e.shotsAtTarget,state:s.e.state,awareness:s.e.awareness,lastKnown:s.e.lastKnown,mag:s.e.mag,reload:s.e.reloadT};
   assert.equal(reset.state,'idle');assert.equal(reset.awareness,0);assert.equal(reset.lastKnown,null);assert.equal(reset.mag,s.e.wdef.mag);assert.equal(reset.reload,0);
   const alertCount=s.alerts.length;s.rounds(previous+1);assert.equal(s.alerts.length,alertCount+1,'natural vision reacquires the player after the reset');const alert=s.alerts.at(-1),volley=s.volley();
   assert.equal(alert.firstShot,true,'enterCombat retains the existing first-shot penalty');
   assert.equal(alert.shotsAtTarget,fresh.get(type).alert.shotsAtTarget,'natural reacquisition starts with the fresh target warmup');
   assert.deepEqual(volley,fresh.get(type).volley,'first actual post-retry volley matches a fresh guard');
  }
  s.enemies.resetLiving();s.enemies.resetLiving();assert.equal(s.e.shotsAtTarget,0,'repeated resets without firing stay fresh');s.dispose();current=null;
 }
 console.log('ok actual rifle/SMG firing, reset and natural first-volley reacquisition; repeated resets, dead guards and live tracking controls');
}finally{current?.dispose();}
