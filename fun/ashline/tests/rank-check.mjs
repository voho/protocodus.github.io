import assert from 'node:assert/strict';
import {BUILDINGS,UNITS,createGame,updateGame,trainUnit,issueOrder,getEntity,unitRank,unitStats} from '../sim.js';

const advance=(s,seconds)=>{for(let i=0;i<Math.round(seconds*20);i++)updateGame(s,.05);};
const close=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-7,`${label}: ${actual} vs ${expected}`);
function quiet(){
  const s=createGame('rank-check');s.entities=[];s.ai.nextThink=Infinity;s.fogClock=Infinity;
  s.terrain.fill(0);s.minerals.fill(0);s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));s.navVersion++;
  return s;
}
function add(s,type,team=0,x=30.5,y=30.5,kills=0){
  const kind=BUILDINGS[type]?'building':'unit',d=BUILDINGS[type]||UNITS[type];
  const e={id:s.nextId++,kind,type,team,x,y,size:d.size,hp:d.hp,maxHp:d.hp,progress:1,angle:0,cooldown:0,order:{type:'idle'},path:[],repath:0};
  if(kind==='unit'){e.kills=kills;e.hp=e.maxHp=unitStats(e).hp;}
  else{e.queue=[];s.navVersion++;}
  if(type==='harvester')Object.assign(e,{cargo:0,unload:0,unloadDepotId:null,harvestPhase:'gather'});
  s.entities.push(e);return e;
}
const attack=(s,u,target)=>issueOrder(s,[u.id],{type:'attack',targetId:target.id});

// Every new unit, including the free hauler and paid production, starts without veterancy.
assert(createGame('rookies').entities.filter(e=>e.kind==='unit').every(e=>e.kills===0&&unitRank(e)===0));
{
  const s=quiet(),barracks=add(s,'barracks',0,30,30);add(s,'reactor',0,25,30);
  assert(trainUnit(s,0,'rifle',barracks.id).ok);advance(s,5.1);
  const trained=s.entities.find(e=>e.type==='rifle');assert(trained);assert.equal(trained.kills,0);
  delete trained.kills;assert.equal(unitRank(trained),0,'Old units without personal kills remain recruits');
}

// Rank is derived, capped at three, and all bonuses use base stats rather than compounding.
for(const type of Object.keys(UNITS))for(const kills of [0,4,5,9,10,14,15,30]){
  const e={kind:'unit',type,kills},rank=Math.min(3,Math.floor(kills/5)),stats=unitStats(e);
  assert.equal(unitRank(e),rank);assert.equal(stats.rank,rank);
  for(const key of ['hp','damage','speed'])close(stats[key],UNITS[type][key]*(1+rank*.2),`${type} rank ${rank} ${key}`);
}
assert.equal(unitRank({kind:'building',type:'turret',kills:20}),0);assert.equal(unitStats({kind:'building',type:'turret'}),null);

// Real confirmed kills cross all thresholds, preserve missing HP, and count once per victim.
{
  const s=quiet(),u=add(s,'tank');u.hp-=100;
  for(let kills=1;kills<=18;kills++){
    const enemy=add(s,'harvester',1,34.5,30.5);enemy.hp=1;u.cooldown=0;
    updateGame(s,.05);assert.equal(getEntity(s,enemy.id),undefined);
    assert.equal(u.kills,kills);assert.equal(s.teams[0].kills,kills);assert.equal(s.teams[1].kills,0);
    assert.equal(unitRank(u),Math.min(3,Math.floor(kills/5)));
    close(u.maxHp,unitStats(u).hp,'Promotion updates actual maximum HP');close(u.maxHp-u.hp,100,'Promotion preserves existing damage');
  }
  assert.equal(s.events.filter(e=>e.text.includes('promoted to rank')).length,3,'Exactly one event per earned rank');
  advance(s,1);assert.equal(u.kills,18);assert.equal(s.teams[0].kills,18,'Expired effects cannot award duplicate kills');
}

// Measured movement uses each class's effective speed, including unarmed haulers.
for(const type of Object.keys(UNITS))for(const kills of [0,5,10,15]){
  const s=quiet(),u=add(s,type,0,20.5,20.5,kills);
  issueOrder(s,[u.id],{type:'move',x:60.5,y:20.5});advance(s,.5);
  close(u.x-20.5,unitStats(u).speed*.5,`${type} rank ${unitRank(u)} actual movement`);
  assert.equal(u.y,20.5);
}

// Every weapon applies rank damage before the existing armor multiplier; splash scales too.
for(const [type,targetType,multiplier] of [['rifle','rifle',1],['scout','rifle',1.25],['tank','harvester',1],['artillery','reactor',1.5],['rocket','harvester',1.35]]){
  const s=quiet(),u=add(s,type,0,30.5,30.5,15),target=add(s,targetType,1,targetType==='reactor'?34:34.5,targetType==='reactor'?29:30.5);
  target.cooldown=999;
  const collateral=type==='artillery'?add(s,'harvester',1,36.3,30):type==='rocket'?add(s,'harvester',1,35.3,30.5):null;
  const friend=add(s,'harvester',0,34.5,31.6),before=target.hp;
  attack(s,u,target);updateGame(s,.05);
  if(type==='rocket'){assert.equal(target.hp,before);assert.equal(s.effects.find(e=>e.type==='rocket').damage,96);advance(s,.4);}
  close(before-target.hp,UNITS[type].damage*1.6*multiplier,`${type} ranked damage`);
  if(collateral)close(collateral.maxHp-collateral.hp,UNITS[type].damage*1.6*(type==='artillery'?.45*.8:.3*1.35),`${type} ranked splash`);
  assert.equal(friend.hp,friend.maxHp,'Ranked splash still protects friendly units');
}

// A promotion from the direct hit cannot increase collateral damage from that same shell.
{
  const s=quiet(),u=add(s,'artillery',0,30.5,30.5,4),direct=add(s,'harvester',1,34.5,30.5),splash=add(s,'harvester',1,34.5,31.4),survivor=add(s,'harvester',1,35.4,30.5);
  direct.hp=splash.hp=1;attack(s,u,direct);updateGame(s,.05);
  assert.equal(u.kills,6);assert.equal(unitRank(u),1);assert.equal(s.teams[0].kills,2,'Direct and splash victims each credit their owner');
  close(survivor.maxHp-survivor.hp,115*.45*.8,'The whole shell retains its pre-promotion damage');
  advance(s,.5);assert.equal(s.teams[0].kills,2);
}

// Two flights arrive out of order: the first rocket retains the damage it had at launch.
{
  const s=quiet(),u=add(s,'rocket',0,30.5,30.5,4),far=add(s,'harvester',1,36.5,30.5),near=add(s,'harvester',1,32.5,30.5);near.hp=1;
  attack(s,u,far);updateGame(s,.05);const first=s.effects.find(e=>e.type==='rocket');assert.equal(first.damage,60);
  u.cooldown=0;attack(s,u,near);updateGame(s,.05);advance(s,.15);
  assert.equal(u.kills,5);assert.equal(unitRank(u),1);assert(first.life>0,'The earlier long flight is still airborne at promotion');
  advance(s,.2);close(far.maxHp-far.hp,81,'Airborne damage does not change after a promotion');
  u.cooldown=0;attack(s,u,far);updateGame(s,.05);assert.equal(s.effects.find(e=>e.type==='rocket').damage,72,'Later launches use the new rank');
}

// Posthumous missiles preserve launch damage and team credit, but cannot promote a dead unit.
{
  const s=quiet(),u=add(s,'rocket',0,30.5,30.5,5),enemy=add(s,'harvester',1,34.5,30.5);enemy.hp=90;
  updateGame(s,.05);assert.equal(s.effects.find(e=>e.type==='rocket').damage,72);u.hp=0;advance(s,.4);
  assert.equal(getEntity(s,u.id),undefined);assert.equal(getEntity(s,enemy.id),undefined);
  assert.equal(s.teams[0].kills,1);assert.equal(u.kills,5,'Personal kills only go to living units');
}

// Defenses continue earning team kills without accumulating personal ranks or health bonuses.
for(const type of ['turret','rocketTower']){
  const s=quiet(),tower=add(s,type,0,30,30);add(s,'reactor',0,25,28);
  for(let i=0;i<6;i++){
    const enemy=add(s,'harvester',1,34.5,30.5);enemy.hp=1;tower.cooldown=0;advance(s,.5);
    assert.equal(getEntity(s,enemy.id),undefined);
  }
  assert.equal(s.teams[0].kills,6);assert.equal(tower.kills,undefined);assert.equal(unitRank(tower),0);assert.equal(tower.maxHp,BUILDINGS[type].hp);
}

// Paid nexus repairs honor the promoted maximum without over-healing it.
{
  const s=quiet(),u=add(s,'tank',0,30.5,30.5,15);add(s,'core',0,24,28);u.hp=u.maxHp-1;
  const before=s.teams[0].credits;advance(s,1);
  close(u.hp,520*1.6,'Repairs reach the promoted HP cap');close(s.teams[0].credits,before-.125,'Repair cost remains unchanged');
}

console.log('Ashline rank checks passed: thresholds/cap, kill ownership, missing-HP preservation, actual movement, every weapon/splash, launch snapshots, posthumous team credit, building exclusion, and repairs.');
