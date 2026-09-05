import assert from 'node:assert/strict';
import {BUILDINGS,UNITS,createGame,updateGame,canPlace,placeBuilding,trainUnit,setRallyPoint,stopUnits,powerStats,getEntity} from '../sim.js';

const advance=(s,seconds)=>{for(let i=0;i<Math.ceil(seconds*20);i++)updateGame(s,.05);};
const own=(s,type,team=0)=>s.entities.filter(e=>e.team===team&&e.type===type&&e.hp>0);
function quiet(seed='rockets'){
  const s=createGame(seed);s.ai.nextThink=Infinity;s.fogClock=Infinity;
  s.terrain.fill(0);s.minerals.fill(0);s.navVersion++;
  s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));
  s.entities=s.entities.filter(e=>e.kind==='building');
  s.teams.forEach(t=>{t.credits=10000;});return s;
}
function construct(s,type,team=0,finish=true){
  for(let y=1;y<s.height-4;y++)for(let x=1;x<s.width-4;x++)if(canPlace(s,team,type,x,y).ok){
    const result=placeBuilding(s,team,type,x,y);assert(result.ok);
    const e=getEntity(s,result.id);
    if(finish){advance(s,BUILDINGS[type].buildTime/Math.max(.2,powerStats(s,team).ratio)+.1);assert.equal(e.progress,1);}
    return e;
  }
  throw Error(`No legal ${type} site`);
}
function fixture(s,type,team,x,y){
  const kind=BUILDINGS[type]?'building':'unit',d=(kind==='building'?BUILDINGS:UNITS)[type];
  const e={id:s.nextId++,kind,type,team,x,y,hp:d.hp,maxHp:d.hp,size:d.size,angle:0,progress:1,cooldown:0,order:{type:'idle'},path:[],repath:0};
  if(kind==='building'){e.queue=[];s.navVersion++;}
  if(type==='harvester')Object.assign(e,{cargo:0,unload:0,unloadDepotId:null,harvestPhase:'gather'});
  s.entities.push(e);return e;
}
const close=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-6,`${message}: ${actual} vs ${expected}`);

// Both factions pay for barracks training; new infantry uses existing factory rally/guard rules.
for(const team of [0,1]){
  const s=quiet(`rocket-training-${team}`);
  assert.equal(trainUnit(s,team,'rocket').ok,false);
  assert.equal(canPlace(s,team,'rocketTower',24,30).ok,false,'Tower needs a barracks');
  const barracks=construct(s,'barracks',team),rally={x:35.5,y:28.5};
  assert(setRallyPoint(s,team,[barracks.id],rally).ok);
  const before=s.teams[team].credits;
  assert(trainUnit(s,team,'rocket',barracks.id).ok);
  assert.equal(s.teams[team].credits,before-UNITS.rocket.cost);
  advance(s,4);assert.equal(own(s,'rocket',team).length,0);
  close(barracks.queue[0].progress,4/UNITS.rocket.trainTime,'Training advances at declared speed');
  advance(s,5.1);const rocket=own(s,'rocket',team)[0];assert(rocket);
  assert.deepEqual(rocket.order,{type:'attackMove',...rally});
  stopUnits(s,[rocket.id]);assert.equal(rocket.order.type,'idle');rocket.cooldown=999;
  const credits=s.teams[team].credits,tower=construct(s,'rocketTower',team,false);
  assert.equal(s.teams[team].credits,credits-BUILDINGS.rocketTower.cost);
  assert.equal(tower.size,2);assert.equal(tower.progress,0);tower.cooldown=0;
  const enemy=fixture(s,'harvester',1-team,tower.x+5,tower.y+1);
  advance(s,23);assert.equal(enemy.hp,enemy.maxHp,'Construction cannot fire');
  advance(s,2);assert.equal(tower.progress,1);assert(enemy.hp<enemy.maxHp,'Completed powered tower guards automatically');
}

// Missiles travel before applying damage; armor gets more damage than infantry.
for(const type of ['harvester','rifle']){
  const s=quiet(),rocket=fixture(s,'rocket',0,30.5,30.5),target=fixture(s,type,1,34.5,30.5);
  target.cooldown=999;updateGame(s,.05);
  const fx=s.effects.find(e=>e.type==='rocket');assert(fx);
  assert.equal(fx.weapon,'rocket');assert.equal(fx.attackerId,rocket.id);assert.equal(fx.targetId,target.id);
  assert.equal(target.hp,target.maxHp,'Launch does not apply hitscan damage');
  advance(s,.4);close(target.maxHp-target.hp,type==='harvester'?81:18,'Anti-armor multiplier');
  assert(s.effects.some(e=>e.type==='explosion'&&e.weapon==='rocket'),'Missile ends in an impact burst');
  const hp=target.hp;advance(s,1);assert.equal(target.hp,hp,'Launcher has a slow reload');
}

// Tower splash hits nearby enemies only, and power loss disables future launches.
{
  const s=quiet(),tower=fixture(s,'rocketTower',0,28,29),target=fixture(s,'harvester',1,33,30);
  const nearby=fixture(s,'harvester',1,34.3,30),far=fixture(s,'harvester',1,35.6,30),friend=fixture(s,'harvester',0,33,31.3);
  updateGame(s,.05);assert.equal(target.hp,target.maxHp);advance(s,.4);
  close(target.maxHp-target.hp,102,'Tower direct damage');close(nearby.maxHp-nearby.hp,45.9,'Tower splash damage');
  assert.equal(far.hp,far.maxHp);assert.equal(friend.hp,friend.maxHp,'No friendly splash damage');
  own(s,'reactor')[0].hp=0;s.navVersion++;assert(powerStats(s,0).ratio<1);
  const hp=target.hp;advance(s,4);assert.equal(target.hp,hp,'Underpowered tower cannot launch');
  construct(s,'reactor');advance(s,.7);assert(target.hp<hp,'Restored power resumes tower defense');
  tower.hp=0;s.navVersion++;
}

// Concealment prevents launch and hidden movement cannot steer an already launched rocket.
{
  const s=quiet(),rocket=fixture(s,'rocket',0,30.5,30.5),target=fixture(s,'harvester',1,34.5,30.5);
  s.visible[0].fill(0);advance(s,.1);assert.equal(s.effects.length,0,'Hidden enemies are never acquired');
  s.visible[0].fill(1);updateGame(s,.05);const fx=s.effects.find(e=>e.type==='rocket');assert(fx);
  s.visible[0].fill(0);target.x=40.5;advance(s,.05);assert.equal(fx.tx,34.5,'Hidden target movement does not alter destination');
  advance(s,.4);assert.equal(target.hp,target.maxHp,'Target outside last-known blast location evades damage');
  assert.equal(rocket.targetId,null);
}

// A fired missile survives its launcher and attributes its kill to the launcher's team.
{
  const s=quiet(),rocket=fixture(s,'rocket',0,30.5,30.5),target=fixture(s,'harvester',1,34.5,30.5);
  target.hp=50;updateGame(s,.05);rocket.hp=0;
  target.x+=.3;advance(s,.05);assert.equal(s.effects.find(e=>e.type==='rocket').tx,target.x,'Visible target can be tracked');
  advance(s,.4);assert.equal(getEntity(s,rocket.id),undefined);assert.equal(getEntity(s,target.id),undefined);
  assert.equal(s.teams[0].kills,1,'Delayed kill belongs to the destroyed shooter');
}

// An ordinary opponent pays for both new counters while retaining its economic progression.
const ai=createGame('rocket-ai','normal');let infantry=false,tower=false;
for(let i=0;i<2400&&ai.status==='playing';i++){
  updateGame(ai,.1);infantry||=own(ai,'rocket',1).length>0;tower||=own(ai,'rocketTower',1).some(e=>e.progress>=1);
  assert(ai.teams.every(t=>t.credits>=0));
}
assert(infantry&&tower,'AI integrates trained rocket infantry and a completed rocket tower');
assert(own(ai,'factory',1).length&&own(ai,'harvester',1).length,'New counters do not prevent AI industry or harvesting');
console.log('Ashline rocket checks passed: paid training/rallies, tower construction and power, guard, delayed anti-armor hits, splash, fog, dead-shooter credit, and AI counters.');
