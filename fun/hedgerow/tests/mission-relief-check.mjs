// Real mission-controller timing: an eliminated force can end Pont's hold
// after an authored minimum and a continuous confirmation, without spawns.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const {createMission}=await import('../js/mission.js');
const pont=(await import('../js/levels/pont-tournant.js')).default;
const pontHold=pont.objectives.find(o=>o.kind==='hold');
const relief={minimum:30,confirmation:6,message:'Bridge secured'};

function scenario({enemies=[{group:'counter',dead:true},{group:'pillbox',dead:true}],objective={...pontHold,earlyRelief:relief}}={}) {
  const events=[],orders=[],display={},handlers=new Map();
  const G={time:0,enemies,stats:{objectives:0},models:new Map(),scene:{add(){},remove(){}},rig:{yaw:0},
    player:{alive:true,health:100,pos:{x:objective.x,y:0,z:objective.z},inventory:()=>({})},
    hud:{objective(text){display.objective=text},notice(title){display.notice=title},prompt(){},objectiveMarker(){}},
    audio:{ui(){}},enemyCtl:{send(...args){orders.push(args)}},events:{
      on(name,callback){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(callback)},
      emit(name,payload){events.push({name,payload});for(const callback of handlers.get(name)||[])callback(payload)},
    },
  };
  const L={pickups:[],hints:[],checkpoints:[{spawn:[objective.x,objective.z,0]}],objectives:[objective]};
  const M=createMission(G,L,{placed:new Map()});M.start();
  const tick=dt=>{G.time+=dt;M.update(dt,{pressed:()=>false,held:()=>false})};
  return {G,M,tick,events,orders,display};
}

{
  const {G,M,tick,events,orders,display}=scenario();
  tick(30);assert.equal(M.done,false,'the minimum alone does not complete the hold');
  tick(5.9);assert.equal(M.done,false,'the secure confirmation must finish');
  tick(.1);assert.equal(M.done,true,'six secure seconds complete after the minimum');
  assert.match(display.objective,/Bridge secured — relief in 0 s/);
  assert.equal(orders.length,0,'defeated counter groups receive no imaginary attack order');
  assert.notEqual(display.notice,'Counter-attack!','no counter-attack warning is shown for a defeated force');
  tick(100);assert.equal(events.filter(e=>e.name==='missionComplete').length,1);assert.equal(G.stats.objectives,1);
}
{
  const {M,tick,display}=scenario();tick(29.5);tick(1);
  assert.equal(M.done,false,'a frame crossing the minimum cannot count the earlier wait as confirmation');
  assert.match(display.objective,/Bridge secured — relief in 6 s/);
  tick(5.4);assert.equal(M.done,false);tick(.1);assert.equal(M.done,true);
}
console.log('ok    Pont relief requires its minimum plus real secure time, with clear feedback and one completion');

for(const group of ['counter','distant-original-defender']) {
  const enemy={group,dead:false},{M,tick}=scenario({enemies:[{group:'counter',dead:true},enemy]});
  tick(89.9);assert.equal(M.done,false,`a living ${group} retains the full deadline`);
  tick(.1);assert.equal(M.done,true,'the ordinary ninety-second deadline still completes');
}
{
  const {M,tick}=scenario({enemies:[]});tick(89.9);assert.equal(M.done,false,'an empty roster is not proof that the mission force was defeated');tick(.1);assert.equal(M.done,true);
}
{
  const enemy={group:'counter',dead:false},{M,tick,orders}=scenario({enemies:[enemy]});
  tick(40);assert.equal(M.done,false);assert.equal(orders.length,1,'a living counter force still receives its real order');
  enemy.dead=true;tick(5.9);assert.equal(M.done,false);tick(.1);assert.equal(M.done,true,'a late defeat receives the full confirmation');
}
console.log('ok    any surviving mission soldier and missing force data preserve the ordinary hold deadline');

for(const interruption of ['range','death','checkpoint']) {
  const {G,M,tick}=scenario();tick(34);
  if(interruption==='range'){G.player.pos.x+=30;tick(10);G.player.pos.x-=30}
  if(interruption==='death'){G.player.alive=false;G.events.emit('playerDied');tick(10);M.restoreCheckpoint();G.player.alive=true}
  if(interruption==='checkpoint')M.restoreCheckpoint();
  assert.equal(M.held,34,`${interruption} retains ordinary hold progress`);
  tick(5.9);assert.equal(M.done,false,`${interruption} cannot inherit partial confirmation`);
  tick(.1);assert.equal(M.done,true,`${interruption} permits a fresh continuous confirmation`);
}
{
  const {G,M,tick}=scenario();tick(33);G.time+=3600;
  assert.equal(M.done,false,'paused wall time does not finish relief');
  tick(2.9);assert.equal(M.done,false);tick(.1);assert.equal(M.done,true,'only resumed simulation deltas count');
}
{
  const {earlyRelief:_,...ordinary}=pontHold;
  const timedControl={...ordinary,time:45};
  assert.equal(timedControl.earlyRelief,undefined);
  const {M,tick}=scenario({objective:timedControl});tick(44.9);assert.equal(M.done,false,'an ordinary timed hold keeps its full duration even with no surviving enemies');tick(.1);assert.equal(M.done,true);
}
assert.deepEqual(pontHold.earlyRelief,relief,'the actual Pont objective opts in explicitly');
console.log('ok    range/death/retry reset confirmation, menus freeze it, and holds without explicit relief keep their full authored duration');
