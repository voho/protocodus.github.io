import assert from 'node:assert/strict';
import {BUILDINGS,UNITS,createGame,updateGame,canPlace,placeBuilding,trainUnit,issueOrder,stopUnits,getEntity} from '../sim.js';

const advance=(s,seconds)=>{for(let i=0;i<Math.ceil(seconds/.1);i++)updateGame(s,.1);};
const entities=(s,team,type)=>s.entities.filter(e=>e.hp>0&&e.team===team&&(!type||e.type===type));
const quiet=seed=>{const s=createGame(seed);s.ai.nextThink=Infinity;s.terrain.fill(0);s.minerals.fill(0);s.navVersion++;return s;};
const construct=(s,team,type)=>{
  for(let y=1;y<s.height-4;y++)for(let x=1;x<s.width-4;x++)if(canPlace(s,team,type,x,y).ok){
    const result=placeBuilding(s,team,type,x,y);assert(result.ok);return getEntity(s,result.id);
  }
  throw Error(`No ${type} placement for team ${team}`);
};

// Starting and newly constructed refineries each include one free, automatic hauler.
for(const team of [0,1]){
  const s=quiet(`refinery-${team}`);
  assert.equal(entities(s,team,'harvester').length,1,'Starting refinery includes exactly one hauler');
  assert.equal(entities(s,team,'harvester')[0].order.type,'harvest');
  const before=s.teams[team].credits,originalIds=new Set(entities(s,team,'harvester').map(e=>e.id));
  const refinery=construct(s,team,'refinery');
  advance(s,BUILDINGS.refinery.buildTime/2);
  assert(refinery.progress<1);assert.equal(entities(s,team,'harvester').length,1,'Construction must finish before delivery');
  advance(s,BUILDINGS.refinery.buildTime/2+1);
  assert.equal(refinery.progress,1);
  const delivered=entities(s,team,'harvester').filter(e=>!originalIds.has(e.id));
  assert.equal(delivered.length,1,'Completed refinery delivers one hauler');
  assert.equal(delivered[0].order.type,'harvest');
  assert.equal(s.teams[team].credits,before-BUILDINGS.refinery.cost,'Included hauler has no extra charge');
  delivered[0].hp=0;advance(s,3);
  assert.equal(entities(s,team,'harvester').length,1,'Destroying an included hauler must not grant replacements');
  assert(trainUnit(s,team,'harvester').ok,'Extra haulers remain available for paid training');
  advance(s,UNITS.harvester.trainTime+1);
  assert.equal(entities(s,team,'harvester').length,2);
  assert.equal(s.teams[team].credits,before-BUILDINGS.refinery.cost-UNITS.harvester.cost);
}

// Delivery waits for a usable exit and retries once that exit opens.
const blocked=quiet('refinery-blocked'),blockedRefinery=construct(blocked,0,'refinery');
for(let y=blockedRefinery.y-2;y<=blockedRefinery.y+blockedRefinery.size+2;y++)for(let x=blockedRefinery.x-2;x<=blockedRefinery.x+blockedRefinery.size+2;x++)if(x>=0&&y>=0&&x<blocked.width&&y<blocked.height)blocked.terrain[y*blocked.width+x]=1;
blocked.navVersion++;advance(blocked,BUILDINGS.refinery.buildTime+1);
assert.equal(blockedRefinery.progress,1);assert.equal(entities(blocked,0,'harvester').length,1,'Blocked exits delay delivery');
blocked.terrain.fill(0);blocked.navVersion++;advance(blocked,1);
assert.equal(entities(blocked,0,'harvester').length,2,'Opening an exit releases the included hauler');
advance(blocked,2);assert.equal(entities(blocked,0,'harvester').length,2,'Retried delivery still happens only once');

// The included unit waits at the army cap instead of exceeding it or being lost.
const capped=quiet('refinery-cap'),cappedRefinery=construct(capped,0,'refinery');
const template=entities(capped,0,'rifle')[0];
while(entities(capped,0).filter(e=>e.kind==='unit').length<60){
  const i=entities(capped,0).filter(e=>e.kind==='unit').length;
  capped.entities.push({...structuredClone(template),id:capped.nextId++,x:1.5+i%10,y:47.5+Math.floor(i/10),path:[]});
}
advance(capped,BUILDINGS.refinery.buildTime+1);
assert.equal(cappedRefinery.progress,1);assert.equal(entities(capped,0,'harvester').length,1);
assert.equal(entities(capped,0).filter(e=>e.kind==='unit').length,60,'Refinery delivery respects the unit cap');
entities(capped,0,'rifle').at(-1).hp=0;advance(capped,1);
assert.equal(entities(capped,0,'harvester').length,2,'The included hauler arrives when a slot becomes free');
assert.equal(entities(capped,0).filter(e=>e.kind==='unit').length,60);

// Explicit movement can reposition haulers, then automatic harvesting resumes.
const haulerField=seed=>{
  const s=quiet(seed),u=entities(s,0,'harvester')[0],tile=43*s.width+22;
  s.minerals[tile]=10000;s.explored[0].fill(1);u.x=22.5;u.y=43.5;u.path=[];
  return{s,u,tile};
};
for(const command of ['start','stop','move','attackMove','attack']){
  const {s,u,tile}=haulerField(`automatic-${command}`);
  if(command==='stop')stopUnits(s,[u.id]);
  else if(command!=='start')issueOrder(s,[u.id],{type:command,x:24.5,y:43.5});
  advance(s,20);
  assert(s.minerals[tile]<10000,`Hauler automatically gathers after ${command}`);
  assert.equal(u.order.type,'harvest',`Hauler resumes automatic work after ${command}`);
}
for(const command of ['move','attack']){
  const {s,u,tile}=haulerField(`hauler-building-${command}`),building=entities(s,command==='attack'?1:0,'refinery')[0];
  if(command==='attack'){building.x=26;building.y=43;s.navVersion++;s.visible[0].fill(1);}
  issueOrder(s,[u.id],{type:command,x:building.x+building.size/2,y:building.y+building.size/2,...(command==='attack'?{targetId:building.id}:{})});
  advance(s,20);
  assert.equal(u.order.type,'harvest',`Hauler finishes ${command} at a building's reachable perimeter`);
  assert(s.minerals[tile]<10000,`Hauler resumes gathering after ${command} targeting a building`);
}
const cargo=haulerField('cargo-redirect');
cargo.u.cargo=UNITS.harvester.capacity;cargo.u.harvestPhase='return';
issueOrder(cargo.s,[cargo.u.id],{type:'harvest',x:22.5,y:43.5});
const credits=cargo.s.teams[0].credits;advance(cargo.s,12);
assert(cargo.s.teams[0].credits>=credits+UNITS.harvester.capacity,'Redirecting a full returning hauler must still deposit its cargo');
for(const command of ['harvest','move','stop']){
  const {s,u,tile}=haulerField(`partial-return-${command}`),partialLoad=75,before=s.teams[0].credits;
  u.cargo=partialLoad;u.harvestPhase='return';
  if(command==='stop')stopUnits(s,[u.id]);
  else issueOrder(s,[u.id],{type:command,x:24.5,y:43.5});
  for(let i=0;i<200&&s.teams[0].credits===before;i++){
    advance(s,.1);
    assert.equal(s.minerals[tile],10000,`${command} must preserve partial-load return before gathering more`);
  }
  assert.equal(s.teams[0].credits,before+partialLoad,`${command} deposits the existing partial load before resuming gathering`);
  assert.equal(u.cargo,0);
}
assert.equal(UNITS.harvester.damage,0);assert.equal(UNITS.harvester.range,0,'Haulers remain unarmed');

// Train each armed type through real production, then isolate its guarding behavior.
for(const type of ['rifle','scout','tank','artillery']){
  const s=quiet(`guard-${type}`);s.teams[0].credits=10000;
  construct(s,0,'barracks');advance(s,BUILDINGS.barracks.buildTime+1);
  if(UNITS[type].producer==='factory'){construct(s,0,'factory');advance(s,BUILDINGS.factory.buildTime+1);}
  const previous=new Set(s.entities.map(e=>e.id));assert(trainUnit(s,0,type).ok);advance(s,UNITS[type].trainTime+1);
  const u=entities(s,0,type).find(e=>!previous.has(e.id));assert(u,`${type} finishes production`);
  const enemy=entities(s,1,'harvester')[0];
  s.entities=s.entities.filter(e=>e.kind==='building'||e===u||e===enemy);
  u.x=30.5;u.y=30.5;u.path=[];u.cooldown=0;
  enemy.x=33.5;enemy.y=30.5;enemy.hp=enemy.maxHp=10000;
  s.visible[0].fill(1);s.fogClock=Infinity;
  const still=()=>({x:u.x,y:u.y});
  let before=enemy.hp,position=still();advance(s,.1);
  assert(enemy.hp<before,`New ${type} fires at nearby enemies without an attack order`);
  assert.deepEqual(still(),position,`Guarding ${type} holds its ground`);

  s.visible[0].fill(0);issueOrder(s,[u.id],{type:'move',x:31.5,y:30.5});advance(s,2);
  assert(Math.hypot(u.x-31.5,u.y-30.5)<.5,`${type} finishes its move`);
  enemy.x=u.x+3;enemy.y=u.y;s.visible[0].fill(1);u.cooldown=0;before=enemy.hp;advance(s,.1);
  assert(enemy.hp<before,`${type} guards after arriving at a move destination`);

  issueOrder(s,[u.id],{type:'move',x:45.5,y:30.5});stopUnits(s,[u.id]);
  u.cooldown=0;before=enemy.hp;position=still();advance(s,.1);
  assert(enemy.hp<before,`Stopped ${type} guards nearby enemies`);assert.deepEqual(still(),position);

  // A previously acquired enemy leaving range must not mask a new nearby threat.
  enemy.x=u.x+UNITS[type].range+.5;
  const nearer={...structuredClone(enemy),id:s.nextId++,x:u.x+3,path:[]};s.entities.push(nearer);
  u.cooldown=0;before=nearer.hp;advance(s,.1);
  assert(nearer.hp<before,`${type} reacquires a nearby target when its former target leaves range`);

  s.entities=s.entities.filter(e=>e!==nearer);stopUnits(s,[u.id]);
  enemy.x=u.x+UNITS[type].range+2;u.cooldown=0;before=enemy.hp;position=still();advance(s,2);
  assert.equal(enemy.hp,before,`Guarding ${type} does not fire beyond weapon range`);
  assert.deepEqual(still(),position,`Guarding ${type} does not chase distant enemies`);

  enemy.x=u.x+3;s.visible[0].fill(0);before=enemy.hp;advance(s,2);
  assert.equal(enemy.hp,before,`${type} must not attack concealed enemies`);
}
console.log('Ashline order checks passed: free refinery haulers, delayed delivery, automatic harvesting, and default guarding for every armed unit.');
