// NPC body sound follows a real torso contact, rather than the killing shot.
import assert from 'node:assert/strict';
import {aiFixture,soldier,advance} from './ai-fixture.mjs';
import {parseUntexturedGLB} from './rig-fixture.mjs';
const rig=await parseUntexturedGLB('soldier');

function scenario(actualRig=true) {
  const terrain={height:()=>0,surfaceAt:()=> 'stone',raycast:()=>Infinity};
  const f=aiFixture({terrain,soldierModel:actualRig?rig:null,definitions:[soldier(0,0)]});
  const {G,enemies}=f,e=enemies.list[0],impacts=[],fallback=[];
  G.audio.bodyImpact=(...args)=>impacts.push({time:G.time,args});
  G.audio.bodyFall=(...args)=>fallback.push({time:G.time,args});
  advance(G,enemies,.3);
  return {...f,e,impacts,fallback};
}

{
  const {G,enemies,e,impacts,fallback}=scenario(),deathAt=G.time;
  e.damage(1000,{x:0,y:0,z:30},'body',true);
  assert.ok(e.char.ragdoll,'the consumer has the actual shipped ragdoll');
  assert.equal(fallback.length,0,'a ragdoll does not also schedule the old guessed impact');
  assert.equal(impacts.length,0,'the killing hit is not a floor contact');
  advance(G,enemies,3);
  assert.equal(impacts.length,1,'one actual torso landing produces one world sound');
  const {time,args:[x,y,z,surface,speed]}=impacts[0];
  assert.ok(time>deathAt+.1,'the cue follows the fall through simulation time');
  assert.equal(surface,'stone','the cue uses the actual contact material');
  assert.ok(Number.isFinite(speed)&&speed>1,'the cue carries the incoming impact speed');
  assert.ok(Math.abs(y)<1e-6,'the cue originates at the contact surface');
  assert.ok(Math.hypot(x-e.pos.x,z-e.pos.z)>.05,'the falling body moves the cue away from its original feet');
  assert.equal(G.stats.kills,1,'contact sound cannot score another death');
}
console.log('ok    actual NPC torso contact emits one material-aware sound after the fall');

{
  const {G,enemies,e,impacts,fallback}=scenario();
  e.damage(1000,{x:0,y:0,z:30},'body',true);e.char.dispose();
  advance(G,enemies,3);
  assert.equal(impacts.length,0,'disposing the old character cancels its pending landing cue');
  assert.equal(fallback.length,0,'disposal cannot replace it with a delayed fallback');
}
{
  const {G,enemies,e,impacts,fallback}=scenario(false);
  e.damage(1000,{x:0,y:0,z:30},'body',true);
  assert.equal(e.char.ragdoll,undefined);
  assert.equal(fallback.length,1,'a non-ragdoll body keeps one legacy impact cue');
  advance(G,enemies,3);
  assert.equal(fallback.length,1);assert.equal(impacts.length,0);
}
console.log('ok    NPC disposal cancels landing audio and non-ragdoll bodies retain one fallback');
