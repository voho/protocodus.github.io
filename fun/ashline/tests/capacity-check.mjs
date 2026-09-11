import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {UNIT_CAP,UNIT_CAP_PER_NEXUS,UNITS,createGame,updateGame,canPlace,placeBuilding,getEntity,trainUnit,issueOrder,buildingRole,unitRole,raceBuilding,raceUnit,unitCapacity} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';

const units=(s,team)=>s.entities.filter(e=>e.kind==='unit'&&e.hp>0&&(team===undefined||e.team===team));
const advance=(s,seconds)=>{for(let i=0;i<Math.round(seconds*20);i++)updateGame(s,.05);};
const snapshot=s=>JSON.parse(encodeGame(s)).game;
function scene(seed,races=['organics','aiUnity']){
  const s=createGame(seed,'hard',{races,aiTeams:[]});
  s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.visible.forEach(g=>g.fill(1));s.explored.forEach(g=>g.fill(1));s.navVersion++;
  s.entities=s.entities.filter(e=>e.kind==='building');s.teams.forEach(t=>t.credits=10000);return s;
}
function add(s,team,role,x,y){
  const type=raceUnit(s,team,role),d=UNITS[type];
  const e={id:s.nextId++,team,kind:'unit',type,x,y,hp:d.hp,maxHp:d.hp,size:d.size,angle:0,progress:1,cooldown:0,order:{type:'idle'},path:[],repath:0,kills:0,tech:[]};
  if(role==='harvester')Object.assign(e,{cargo:0,unload:0,unloadDepotId:null,harvestPhase:'gather'});
  s.entities.push(e);return e;
}
function build(s,team,role){
  const type=raceBuilding(s,team,role),core=s.entities.find(e=>e.team===team&&buildingRole(e)==='core');
  for(let y=Math.max(1,core.y-10);y<Math.min(s.height-4,core.y+10);y++)for(let x=Math.max(1,core.x-10);x<Math.min(s.width-4,core.x+13);x++)if(canPlace(s,team,type,x,y).ok){const e=getEntity(s,placeBuilding(s,team,type,x,y).id);e.progress=1;e.hp=e.maxHp;return e;}
  throw Error(`No placement for ${type}`);
}
const STRESS_CAP=200;
assert.equal(UNIT_CAP,2000);assert.equal(UNIT_CAP_PER_NEXUS,200);
{
  const s=scene('empty-field-backoff'),carrier=add(s,0,'harvester',60.5,60.5);
  updateGame(s,.05);assert.equal(carrier.mineralTile,-1);assert.equal(carrier.mineralRetryDelay,4);
  const firstRetry=carrier.mineralSearchAt;advance(s,3.5);assert.equal(carrier.mineralSearchAt,firstRetry,'An idle carrier does not repeatedly scan an empty known field');
  const restored=decodeGame(encodeGame(s)).game;advance(s,11);advance(restored,11);
  assert.deepEqual(snapshot(restored),snapshot(s),'No-resource retry backoff survives loading exactly');assert.equal(carrier.mineralRetryDelay,12);
  const tile=61*s.width+61;s.minerals[tile]=500;s.mineralTypes[tile]=1;
  s.navVersion++;updateGame(s,.05);assert.equal(carrier.mineralTile,tile,'A navigation change immediately wakes a waiting carrier');assert.equal(carrier.mineralRetryDelay,undefined,'Successful mining clears the retry backoff');
  s.minerals[tile]=0;updateGame(s,.05);assert.equal(carrier.mineralRetryDelay,4);
  s.minerals[tile]=500;issueOrder(s,[carrier.id],{type:'harvest',x:61.5,y:61.5});updateGame(s,.05);
  assert.equal(carrier.mineralTile,tile,'An explicit harvest command immediately wakes a waiting carrier');
}
for(const race of ['organics','aiUnity']){
  const s=scene(`capacity-${race}`,[race,race]),barracks=build(s,0,'barracks'),type=raceUnit(s,0,'rifle'),capacity=unitCapacity(s,0);
  for(let i=0;i<capacity-1;i++)add(s,0,'rifle',50.5+i%20,70.5+Math.floor(i/20));
  const before=s.teams[0].credits;
  assert(trainUnit(s,0,type,barracks.id).ok,'The final population slot accepts a queued unit');
  assert.match(trainUnit(s,0,type,barracks.id).reason,/200/,'Paid queues reserve population across producers');
  assert.equal(s.teams[0].credits,before-UNITS[type].cost,'A rejected queue never charges credits');
  barracks.queue[0].progress=1;updateGame(s,.05);
  assert.equal(units(s,0).length,capacity);assert.equal(barracks.queue.length,0);
  // Reserve a new refinery while two nexuses are available, then lose that capacity.
  const core=s.entities.find(e=>e.team===0&&buildingRole(e)==='core'),expansion={...structuredClone(core),id:s.nextId++,x:85,y:80};s.entities.push(expansion);s.navVersion++;
  const refinery=build(s,0,'refinery');expansion.hp=0;s.navVersion++;updateGame(s,.05);
  assert(refinery.haulerPending,'An included carrier waits at the full population cap');
  assert.equal(units(s,0).length,capacity);
  const restored=decodeGame(encodeGame(s)).game;
  for(const state of [s,restored]){units(state,0).at(-1).hp=0;updateGame(state,.05);}
  assert.equal(units(s,0).length,capacity);
  assert.equal(units(s,0).filter(e=>unitRole(e)==='harvester').length,1);
  assert.equal(refinery.haulerPending,false);
  assert.deepEqual(snapshot(restored),snapshot(s),'Pending carrier reservations resume identically after loading');
  const raw=JSON.parse(encodeGame(s)),template=raw.game.entities.find(e=>e.kind==='unit');
  for(let count=capacity;count<=UNIT_CAP;count++){const extra=structuredClone(template);extra.id=raw.game.nextId++;raw.game.entities.push(extra);}
  assert.throws(()=>decodeGame(JSON.stringify(raw)),'A malformed save cannot bypass the population cap');

  const ceiling=scene(`maximum-capacity-${race}`,[race,race]);
  for(const team of [0,1]){
    const producer=build(ceiling,team,'barracks'),origin=ceiling.entities.find(e=>e.team===team&&buildingRole(e)==='core');
    for(let index=0;index<10;index++)ceiling.entities.push({...structuredClone(origin),id:ceiling.nextId++,x:85+index%5*5,y:85+team*15+Math.floor(index/5)*5});
    for(let count=0;count<UNIT_CAP-1;count++)add(ceiling,team,'rifle',10.5+count%100,40.5+team*25+Math.floor(count/100));
    assert.equal(unitCapacity(ceiling,team),2000);assert(trainUnit(ceiling,team,type,producer.id).ok,'Ten nexuses accept the 2,000th reserved unit');
    assert.match(trainUnit(ceiling,team,type,producer.id).reason,/2000/,'Additional nexuses cannot reserve a 2,001st unit');
  }
  const restoredCeiling=decodeGame(encodeGame(ceiling)).game;
  assert.deepEqual([0,1].map(team=>units(restoredCeiling,team).length),[1999,1999],'Two large legal armies and their final queues fit the save format');
}

// A legal full-army volley can briefly exceed the old 4,096-effect save limit.
{
  const battle=scene('maximum-rocket-volley');battle.fogClock=1;
  for(const team of [0,1]){
    const core=battle.entities.find(e=>e.team===team&&buildingRole(e)==='core');
    for(let index=0;index<9;index++)battle.entities.push({...structuredClone(core),id:battle.nextId++,x:10+team*80+index*4,y:5});
    for(let index=0;index<UNIT_CAP;index++){
      const unit=add(battle,team,'rocket',15+(index%40)*1.5+team*.6,20+Math.floor(index/40)*1.5);
      unit.hp=1;
    }
    assert.equal(units(battle,team).length,unitCapacity(battle,team),'Both combat armies fit their completed nexus capacity');
  }
  battle.navVersion++;
  updateGame(battle,.05);
  assert.equal(battle.effects.filter(e=>e.type==='rocket').length,UNIT_CAP*2,'Every living launcher fires a real projectile before impacts occur');
  const inFlight=decodeGame(encodeGame(battle)).game;
  advance(battle,.15);advance(inFlight,.15);
  assert.equal(units(battle).length,0,'The damaged armies are destroyed by their opposing volleys');
  assert.equal(battle.effects.filter(e=>e.type==='explosion').length,UNIT_CAP*4,'Each projectile impact and unit death retains its own short-lived effect');
  assert(battle.effects.length>4096,'The regression exercises the former save rejection threshold');
  assert.equal(battle.status,'playing','Both headquarters survive the battle');
  assert.deepEqual(snapshot(inFlight),snapshot(battle),'Thousands of in-flight missiles resolve identically after loading');
  const aftermath=decodeGame(encodeGame(battle)).game;
  assert.equal(aftermath.effects.length,battle.effects.length,'Saving a large impact frame preserves all legitimate effects');
  advance(battle,.7);advance(aftermath,.7);
  assert.equal(battle.effects.length,0,'Impact and death effects expire normally after their saved frame');
  assert.deepEqual(snapshot(aftermath),snapshot(battle),'The large battle aftermath resumes without changing results or timing');
}

// Stationary dense groups do not drift when collision traffic has no movement command.
{
  const s=scene('stationary-crowd'),roles=['rifle','scout','tank','striker'];
  for(let i=0;i<STRESS_CAP;i++)add(s,0,roles[i%roles.length],75.94+(i%20)*.17,61.93+Math.floor(i/20)*.17);
  const positions=units(s,0).map(e=>({x:e.x,y:e.y,angle:e.angle}));
  advance(s,1);
  assert.deepEqual(units(s,0).map(e=>({x:e.x,y:e.y,angle:e.angle})),positions,'Idle bodies remain planted until they receive a movement command');
}

// Keep the movement benchmark at 400 bodies while large ceiling reservations are tested above.
const stress=scene('four-hundred-body-stress'),roles=['rifle','rocket','scout','tank','artillery','harvester','engineer','striker'];
for(let team=0;team<2;team++)for(let i=0;i<STRESS_CAP;i++)add(stress,team,roles[i%roles.length],40.5+team*70+i%20*.83,53.5+Math.floor(i/20)*.83);
const start=performance.now();
for(let team=0;team<2;team++){
  const army=units(stress,team);issueOrder(stress,army.map(e=>e.id),{type:'move',x:65.25+team*70,y:72.75});
  assert.equal(new Set(army.map(e=>`${e.order.x},${e.order.y}`)).size,STRESS_CAP,'All 200 group members receive separate destinations');
}
advance(stress,1);const restored=decodeGame(encodeGame(stress)).game,frames=[];
for(let tick=0;tick<120;tick++){
  const frame=performance.now();updateGame(stress,.05);frames.push(performance.now()-frame);updateGame(restored,.05);
}
assert.deepEqual(snapshot(restored),snapshot(stress),'400 moving bodies and collision steering resume deterministically');
assert.deepEqual([0,1].map(team=>units(stress,team).length),[STRESS_CAP,STRESS_CAP]);
assert(units(stress).every(e=>Number.isFinite(e.x+e.y+e.angle)&&e.x>0&&e.x<stress.width&&e.y>0&&e.y<stress.height));
for(let tick=0;tick<3000&&units(stress).some(e=>!['idle','harvest'].includes(e.order.type));tick++)updateGame(stress,.05);
for(const e of units(stress))assert(['idle','harvest'].includes(e.order.type),`${e.type} settles after a full-army command`);
for(let team=0;team<2;team++){
  const army=units(stress,team);
  for(let i=0;i<army.length;i++)for(let j=i+1;j<army.length;j++)assert(Math.hypot(army[i].x-army[j].x,army[i].y-army[j].y)>=(army[i].size+army[j].size)*.43-.002,'Settled bodies retain physical separation');
}
frames.sort((a,b)=>a-b);
console.log('Capacity checks passed: 200 per nexus, 2,000-unit ceiling/queue reservations, delayed carriers, saved empty-field retries, 4,000-launcher/8,000-effect battle saves, stationary collision stability and deterministic 400-unit movement.',JSON.stringify({medianTickMs:+frames[60].toFixed(2),p95TickMs:+frames[114].toFixed(2),settledAtSeconds:+stress.time.toFixed(2),totalMs:+(performance.now()-start).toFixed(0)}));
