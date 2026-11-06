// Actual combat reloads move to cover; each sound sequence follows the
// actor's position and ends through the matching lifecycle path.
import assert from 'node:assert/strict';
import {aiFixture,soldier,advance,forceCombat} from './ai-fixture.mjs';
function reloadScenario() {
 const f=aiFixture({boxes:[{x:0,y:.6,z:5,hx:3,hy:.6,hz:.3}],definitions:[soldier(0,0)]});
 const {G,enemies}=f,e=enemies.list[0],runs=[];
 G.audio.reloadActor=(kind,getPosition,options)=>{
  const actor={kind,options,elapsed:0,positions:[],cancelled:0,finished:0};runs.push(actor);
  return {advance(dt){actor.elapsed+=dt;actor.positions.push({...getPosition()});},cancel(){actor.cancelled++;},finish(){actor.finished++;}};
 };
 forceCombat(e,G);e.sees=true;e.exposure=1;e.perceiveTimer=1e6;e.mag=1;e.aimTimer=0;e.target={x:0,z:0};
 advance(G,enemies,.1);
 assert.equal(runs.length,1,'emptying the magazine starts one actor-owned reload');
 e.fireTimer=1e6;
 return {...f,e,runs};
}
{
 const {G,enemies,e,runs}=reloadScenario(),sound=runs[0];
 assert.equal(sound.kind,'kar98k','the actor uses his actual weapon mechanism');
 assert.equal(sound.options.duration,e.reloadTotal,'the sound uses the same simulation duration as the reload');
 assert.ok(sound.options.events.some(event=>event.name==='clip_seated'),'the hand/prop clip events accompany the sound sequence');
 const origin=e.pos.clone();
 advance(G,enemies,e.reloadTotal+.1);
 assert.ok(e.pos.distanceTo(origin)>1,'this actual combat reload physically moves toward cover');
 assert.ok(sound.positions.some(p=>Math.hypot(p.x-origin.x,p.z-origin.z)>1),'later reload beats follow the moving actor');
 assert.equal(sound.finished,1,'normal completion lets emitted tails finish');
 assert.equal(sound.cancelled,0,'normal completion does not abruptly cancel the final beat');
 assert.equal(e.reloadAudio,null,'completed reloads release the AI handle');
 assert.equal(e.mag,e.wdef.mag);
}
console.log('ok    a real retreat-to-cover reload follows the moving soldier and finishes without clipping its tail');
for(const ending of ['death','reset']) {
 const {G,enemies,e,runs}=reloadScenario(),sound=runs[0];
 const calls=sound.positions.length;
 G.player.visible=0;
 if(ending==='death')e.damage(1000,{x:0,y:0,z:30},'body',true);else enemies.resetLiving();
 assert.equal(sound.cancelled,1,`${ending} cancels the actor's pending reload beats`);
 advance(G,enemies,4);
 assert.equal(sound.positions.length,calls,`${ending} cannot advance a stale actor sound`);
 assert.equal(sound.finished,0,`${ending} does not finish a canceled reload later`);
 assert.equal(e.reloadAudio,null);
}
console.log('ok    death and checkpoint reset cancel pending enemy reloads without affecting unrelated actors');

{
 const {G,enemies,e,runs}=reloadScenario(),sound=runs[0];
 G.player.pos.z=220;G.player.visible=0;
 advance(G,enemies,e.reloadTotal+.2);
 assert.equal(e.active,false,'the soldier left the active encounter radius');
 assert.equal(e.reloadT,0,'an already-started reload finishes while combat simulation is inactive');
 assert.equal(sound.finished,1,'the inactive actor does not retain a pending audio action');
 assert.equal(e.reloadAudio,null,'the inactive actor releases his audio handle');
 assert.equal(e.mag,e.wdef.mag,'the magazine is ready when the player returns');
}
console.log('ok    leaving the encounter radius does not freeze a live reload action');
