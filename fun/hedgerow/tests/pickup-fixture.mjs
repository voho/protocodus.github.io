// Shared real player/input/mission collision fixture for supply checks.
import assert from 'node:assert/strict';
import { aiFixture, soldier } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { readSet } = await import('../js/assets.js');
const { createPlayer } = await import('../js/player.js');
const { createMission } = await import('../js/mission.js');
const { createCameraRig } = await import('../js/camera.js');
const { createInput } = await import('../js/input.js');
const { DEFAULT_SETTINGS, WEAPONS, GRENADE } = await import('../js/config.js');
export const models = new Map(); readSet(await parseUntexturedGLB('military'), 'military', models);
const service = new Proxy({}, { get: () => () => {} });
export function pickupScenario({ level: levelOverride = null, definitions = null, placed = null, terrain: terrainOverride = null, kind = 'open', type = 'medkit', distance = 1.2, full = false, count = 1, drop = false } = {}) {
  const platform = kind === 'upper-floor' ? 3 : kind === 'curb' ? .3 : 0;
  const top = kind === 'crate-top' ? .8 : kind === 'height-boundary' ? 1.4 : kind === 'height-outside' ? 1.401 : 0;
  const wall = kind === 'wall';
  const boxes = wall ? [{ x:0,y:1.5,z:.5,hx:2,hy:1.5,hz:.1 }] : platform ? [{x:0,y:platform/2,z:0,hx:.5,hy:platform/2,hz:.5}] : top ? [{x:distance,y:top/2,z:0,hx:.35,hy:top/2,hz:.35}] : [];
  const {G,enemies}=aiFixture({boxes,models,terrain:terrainOverride,player:[0,0],definitions:definitions??(drop?[soldier(.4,.2,{hold:true})]:[])});
  const windowEvents=new EventTarget(),documentEvents=new EventTarget();globalThis.window=windowEvents;
  document.addEventListener=documentEvents.addEventListener.bind(documentEvents);document.removeEventListener=documentEvents.removeEventListener.bind(documentEvents);document.pointerLockElement=null;
  const input=createInput(new EventTarget());input.enable(true);
  G.hud=service;G.effects=service;G.audio=service;G.lights=service;G.debris=service;G.rig=createCameraRig(G.camera,G.world);G.enemies=enemies.list;
  const pickup=wall?{x:0,z:1,type}:{x:distance,z:0,type};
  const level={playBounds:G.world.bounds,pickups:drop?[]:Array.from({length:count},()=>({...pickup})),hints:[],checkpoints:[{spawn:[0,0,0]}],objectives:[{id:'later',kind:'reach',text:'Rally',x:80,z:80,r:1}],...levelOverride};
  G.level=level;G.stats.objectives=0;const P=createPlayer(G);G.player=P;P.reset([0,0,0]);P.hurtTimer=0;
  if(kind==='crouch'){const event=new Event('keydown');Object.defineProperty(event,'code',{value:'KeyC'});windowEvents.dispatchEvent(event);}
  for(let i=0;i<(kind==='crouch'?40:1);i++){G.time+=1/60;P.update(1/60,input,DEFAULT_SETTINGS);input.endFrame();}
  P.health=full?100:40;P.hurtTimer=0;P.grenades=full?GRENADE.max:0;
  for(const [id,a]of Object.entries(P.ammo))a.reserve=full?Math.floor(WEAPONS[id].reserve*1.5):0;
  const M=createMission(G,level,{placed:placed??new Map()});M.start();G.mission=M;
  let rays=0,inMission=false;const clear=G.world.clear;G.world.clear=(...args)=>{if(inMission)rays++;return clear(...args);};
  const tick=(advance=true)=>{if(advance)G.time+=1/60;inMission=true;try{M.update(1/60,input);}finally{inMission=false;}input.endFrame();};
  const body=P.pos.clone();G.world.pushOut(body,.34,body.y,P.crouch?1.15:1.78,.45);assert.ok(body.distanceTo(P.pos)<.02,'actual player body is clear');
  assert.ok(Math.abs(G.world.groundAt(0,0,P.pos.y,.45)-platform)<1e-6,'actual player stands on the specified support');
  return {G,P,M,input,enemies,tick,rays:()=>rays,dispose(){P.char.dispose();for(const e of enemies.list)e.char.dispose();input.enable(false);},killForDrop(draw=()=>.3){const random=Math.random;Math.random=draw;try{enemies.list[0].damage(1000,P.pos,'body',true);}finally{Math.random=random;}}};
}
