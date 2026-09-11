import assert from 'node:assert/strict';
import {BUILDINGS,UNITS,UNIT_CAP,UNIT_CAP_PER_NEXUS,createGame,updateGame,canPlace,placeBuilding,getEntity,trainUnit,issueOrder,buildingRole,unitRole,raceBuilding,raceUnit,unitCapacity,deploymentStatus,deployNexus,powerStats,productionRate,startResearch,startBuildingUpgrade} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';

const near=(a,b,message)=>assert(Math.abs(a-b)<1e-7,`${message}: ${a} ≠ ${b}`);
const advance=(s,seconds)=>{for(let tick=0;tick<Math.ceil(seconds*20);tick++)updateGame(s,.05);};
const own=(s,team,role)=>s.entities.filter(e=>e.hp>0&&e.team===team&&(!role||(e.kind==='building'?buildingRole(e):unitRole(e))===role));
const units=(s,team)=>own(s,team).filter(e=>e.kind==='unit');
const snapshot=s=>JSON.parse(encodeGame(s)).game;
const capacity=UNIT_CAP_PER_NEXUS;
function scene(seed,race='organics'){
  const s=createGame(seed,'hard',{width:144,height:112,races:[race,race],aiTeams:[]});
  s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.visible.forEach(g=>g.fill(1));s.explored.forEach(g=>g.fill(1));s.fogClock=.2;s.navVersion++;
  s.entities=s.entities.filter(e=>e.kind==='building');s.teams.forEach(t=>t.credits=100000);return s;
}
function addUnit(s,team,role,x=65.5,y=55.5){
  const type=raceUnit(s,team,role),d=UNITS[type],e={id:s.nextId++,team,kind:'unit',type,x,y,hp:d.hp,maxHp:d.hp,size:d.size,angle:0,progress:1,cooldown:0,order:{type:'idle'},path:[],repath:0,kills:0,tech:[]};
  if(role==='harvester')Object.assign(e,{cargo:0,unload:0,unloadDepotId:null,harvestPhase:'gather',order:{type:'harvest'}});
  s.entities.push(e);return e;
}
function addNexus(s,team,x=70,y=45,progress=1){
  const source=s.entities.find(e=>e.team===team&&buildingRole(e)==='core'),e={...structuredClone(source),id:s.nextId++,x,y,progress,queue:[],hp:source.maxHp*(.2+.8*progress)};
  s.entities.push(e);s.navVersion++;return e;
}
function build(s,team,role,finish=true,anchor=own(s,team,'core')[0]){
  const type=raceBuilding(s,team,role);
  for(let y=Math.max(1,anchor.y-8);y<Math.min(s.height-4,anchor.y+10);y++)for(let x=Math.max(1,anchor.x-8);x<Math.min(s.width-4,anchor.x+13);x++)if(canPlace(s,team,type,x,y).ok){
    const result=placeBuilding(s,team,type,x,y);assert(result.ok);const e=getEntity(s,result.id);if(finish){e.progress=1;e.hp=e.maxHp;}return e;
  }
  throw Error(`No ${type} construction site`);
}
function eliminate(s,target){
  const x=target.x+(target.kind==='building'?target.size/2:0),y=target.y+(target.kind==='building'?target.size/2:0);
  const attacker=addUnit(s,1-target.team,'tank',x+5,y);target.hp=1;
  issueOrder(s,[attacker.id],{type:'attack',targetId:target.id,x,y});updateGame(s,.05);
  assert(!getEntity(s,target.id),'Fixture destroys its intended target in combat');
  s.entities=s.entities.filter(e=>e!==attacker);
}

for(const race of ['organics','aiUnity']){
  const s=scene(`nexus-deployment-${race}`,race),core=own(s,0,'core')[0],barracks=build(s,0,'barracks'),factory=build(s,0,'factory'),type=raceUnit(s,0,'constructor');
  assert.equal(unitCapacity(s,0),capacity,'One starting nexus supports 200 live or reserved units');
  assert.equal(capacity,200);assert.equal(UNIT_CAP,2000);
  assert.equal(UNITS[type].producer,factory.type);assert.equal(UNITS[type].damage,0,'The expansion vehicle is unarmed');
  const credits=s.teams[0].credits;assert(trainUnit(s,0,type,factory.id).ok);assert.equal(s.teams[0].credits,credits-UNITS[type].cost);
  const queued=decodeGame(encodeGame(s)).game;
  assert.equal(getEntity(queued,factory.id).queue[0].type,type,'Both races persist a queued construction vehicle');
  factory.queue[0].progress=1;updateGame(s,.05);
  const vehicle=own(s,0,'constructor')[0];assert(vehicle,'The matching foundry completes a construction vehicle');
  Object.assign(vehicle,{x:71.5,y:46.5,order:{type:'idle'},path:[]});
  const x=70,y=45;
  assert(Math.hypot(core.x-x,core.y-y)>25,'Deployment fixture is remote from the starting base');
  assert.equal(canPlace(s,0,raceBuilding(s,0,'reactor'),x,y).ok,false,'Remote construction is unavailable before a nexus arrives');
  s.visible[0].fill(0);
  assert(deploymentStatus(s,0,vehicle.id,x,y).ok,'Deployment uses explored ground and does not require an old base nearby');
  const reject=(team,id,px,py,label)=>{const before=structuredClone({entities:s.entities,teams:s.teams,nextId:s.nextId,events:s.events});assert.equal(deployNexus(s,team,id,px,py).ok,false,label);assert.deepEqual({entities:s.entities,teams:s.teams,nextId:s.nextId,events:s.events},before,'Invalid deployment never consumes the vehicle, credits or world state');};
  reject(1,vehicle.id,x,y,'Enemy constructor cannot be commanded');
  reject(0,barracks.id,x,y,'A building cannot deploy a nexus');
  reject(0,-1,x,y,'Missing constructor is rejected');
  for(const [px,py] of [[NaN,y],[x+.5,y],[-1,y],[s.width-1,y],[x+10,y]])reject(0,vehicle.id,px,py,'Grid, map bounds and deployment reach are enforced');
  const cell=y*s.width+x;
  s.explored[0][cell]=0;reject(0,vehicle.id,x,y,'Unexplored footprint is rejected');s.explored[0][cell]=1;
  for(const terrain of [1,3,4,5]){s.terrain[cell]=terrain;s.navVersion++;reject(0,vehicle.id,x,y,'Rocks, lava, roots and craters cannot support a nexus');s.terrain[cell]=0;s.navVersion++;}
  s.minerals[cell]=100;reject(0,vehicle.id,x,y,'Mineral deposits block construction');s.minerals[cell]=0;
  const blocker=addUnit(s,0,'rifle',x+.5,y+.5);reject(0,vehicle.id,x,y,'Another unit cannot be consumed or trapped by unfolding');s.entities=s.entities.filter(e=>e!==blocker);
  s.status='victory';reject(0,vehicle.id,x,y,'Deployment cannot alter a finished operation');s.status='playing';
  // An unfolding vehicle may stand inside its own footprint, and needs no second payment.
  const paid=s.teams[0].credits,navVersion=s.navVersion,result=deployNexus(s,0,vehicle.id,x,y);assert(result.ok,result.reason);
  const expanded=getEntity(s,result.id);assert.equal(expanded.type,raceBuilding(s,0,'core'));assert(expanded.progress<1);assert.equal(expanded.x,x);assert.equal(expanded.y,y);
  assert(!getEntity(s,vehicle.id));assert.equal(s.teams[0].credits,paid);assert(s.navVersion>navVersion);
  assert.equal(unitCapacity(s,0),capacity,'Unfinished nexuses do not add capacity');
  const restored=decodeGame(encodeGame(s)).game;assert.deepEqual(snapshot(restored),snapshot(s),'Unfolded bases and consumed vehicles round-trip exactly');
  for(const match of [s,restored]){match.visible[0].fill(1);advance(match,BUILDINGS[expanded.type].buildTime+1);}
  assert.deepEqual(snapshot(restored),snapshot(s),'Remote nexus construction resumes deterministically');
  assert.equal(expanded.progress,1);assert.equal(unitCapacity(s,0),capacity*2);
  const refinery=build(s,0,'refinery',false,expanded);assert(Math.hypot(refinery.x-core.x,refinery.y-core.y)>20,'A completed remote nexus supports a new mining base');
  refinery.progress=1;refinery.hp=refinery.maxHp;updateGame(s,.05);assert(own(s,0,'harvester').some(e=>Math.hypot(e.x-refinery.x,e.y-refinery.y)<7),'The expansion refinery supplies its own hauler');
  for(let index=0;index<12;index++)addNexus(s,0,90+index%6*5,70+Math.floor(index/6)*5);
  assert.equal(unitCapacity(s,0),UNIT_CAP,'Additional nexuses respect the global 2,000-unit ceiling');
}

for(const race of ['organics','aiUnity']){
  const s=scene(`nexus-population-${race}`,race),barracks=build(s,0,'barracks'),other=build(s,0,'barracks'),type=raceUnit(s,0,'rifle');
  for(let index=0;index<capacity-1;index++)addUnit(s,0,'rifle',50.5+index%10,62.5+Math.floor(index/10));
  const credits=s.teams[0].credits;assert(trainUnit(s,0,type,barracks.id).ok);
  assert.equal(trainUnit(s,0,type,other.id).ok,false,'Paid queues reserve the shared final population slot across buildings');
  assert.equal(s.teams[0].credits,credits-UNITS[type].cost);
  const beforeBuild=s.teams[0].credits;
  assert.equal(canPlace(s,0,raceBuilding(s,0,'refinery'),20,60).ok,false,'An included hauler cannot reserve a 201st unit');assert.equal(s.teams[0].credits,beforeBuild);
  barracks.queue[0].progress=1;updateGame(s,.05);assert.equal(units(s,0).length,capacity);
  const expanded=addNexus(s,0);assert(trainUnit(s,0,type,barracks.id).ok);
  for(let index=0;index<10;index++)addUnit(s,0,'rifle',85.5+index,60.5);
  expanded.hp=0;s.navVersion++;barracks.queue[0].progress=1;updateGame(s,.05);
  assert.equal(unitCapacity(s,0),capacity);assert.equal(units(s,0).length,capacity+10,'Losing a nexus preserves existing units even above the reduced cap');
  assert.equal(barracks.queue.length,1,'An already-paid unit waits after capacity is lost');assert.equal(trainUnit(s,0,type,other.id).ok,false);
  const recovered=decodeGame(encodeGame(s)).game;assert.equal(units(recovered,0).length,capacity+10,'Legal over-cap survivors must remain saveable');
  for(const match of [s,recovered]){addNexus(match,0);updateGame(match,.05);}
  assert.equal(units(s,0).length,capacity+11);assert.equal(barracks.queue.length,0);assert.deepEqual(snapshot(recovered),snapshot(s),'Queued units resume identically when nexus capacity returns');

  const pending=scene(`reserved-refinery-${race}`,race),producer=build(pending,0,'barracks');
  for(let index=0;index<capacity-1;index++)addUnit(pending,0,'rifle',50.5+index%10,62.5+Math.floor(index/10));
  const refinery=build(pending,0,'refinery',false);assert(refinery.haulerPending);
  assert.equal(trainUnit(pending,0,type,producer.id).ok,false,'An unfinished refinery reserves its included hauler');
  refinery.progress=1;refinery.hp=refinery.maxHp;updateGame(pending,.05);assert.equal(units(pending,0).length,capacity);assert.equal(refinery.haulerPending,false);
}

// Command survives losing the original nexus while a second base or construction vehicle remains.
for(const team of [0,1])for(const fallback of ['finished','unfinished','vehicle']){
  const s=scene(`last-command-${team}-${fallback}`),first=own(s,team,'core')[0];
  const replacement=fallback==='vehicle'?addUnit(s,team,'constructor',71.5,46.5):addNexus(s,team,70,45,fallback==='finished'?1:.3);
  eliminate(s,first);assert.equal(s.status,'playing',`${fallback} command replacement keeps the operation alive`);
  if(fallback==='vehicle'){
    const result=deployNexus(s,team,replacement.id,70,45);assert(result.ok,'A surviving vehicle can rebuild after the last nexus falls');
    eliminate(s,getEntity(s,result.id));
  }else eliminate(s,replacement);
  assert.equal(s.status,team===0?'defeat':'victory','The operation ends only after the final recovery option is destroyed');
}

for(const race of ['organics','aiUnity']){
  const base=scene(`surplus-production-${race}`,race),barracks=build(base,0,'barracks'),factory=build(base,0,'factory'),lab=build(base,0,'lab');
  assert(trainUnit(base,0,raceUnit(base,0,'tank'),factory.id).ok);assert(startResearch(base,0,'gridEfficiency',lab.id).ok);assert(startBuildingUpgrade(base,0,barracks.id,'speed').ok);
  const construction=build(base,0,'reactor',false),states=[base,structuredClone(base),structuredClone(base)];
  for(let level=1;level<states.length;level++)for(let count=0;count<level;count++)build(states[level],0,'reactor');
  const powers=states.map(s=>powerStats(s,0));
  assert(powers.every(p=>p.ratio===1&&p.productionMultiplier>1&&p.productionMultiplier<=1.25),'Healthy surplus adds a restrained industry bonus while power coverage remains bounded');
  assert(powers[0].productionMultiplier<powers[1].productionMultiplier&&powers[1].productionMultiplier<powers[2].productionMultiplier,'Every additional equal generator provides more production');
  assert(powers[2].productionMultiplier-powers[1].productionMultiplier<powers[1].productionMultiplier-powers[0].productionMultiplier,'Successive equal power investments have diminishing returns');
  const result=states.map((s,index)=>{const rate=productionRate(s,0);advance(s,1);const f=getEntity(s,factory.id),b=getEntity(s,barracks.id),l=getEntity(s,lab.id),c=getEntity(s,construction.id);near(f.queue[0].progress,rate/UNITS[f.queue[0].type].trainTime,'Measured assembly uses the displayed production rate');return{unit:f.queue[0].progress,research:l.research.progress,upgrade:b.upgrade.progress,construction:c.progress};});
  for(const activity of ['unit','research','upgrade','construction'])assert(result[0][activity]<result[1][activity]&&result[1][activity]<result[2][activity],`${activity} work benefits from additional surplus generation`);
  const low=structuredClone(base);for(const reactor of own(low,0,'reactor'))reactor.hp=0;
  const brownout=powerStats(low,0);assert(brownout.ratio<1);assert.equal(brownout.productionMultiplier,1,'A power deficit does not grant the surplus bonus');near(productionRate(low,0),brownout.ratio,'Brownouts still throttle industrial work');
}

console.log('Nexus checks passed: both-race vehicle production and safe remote deployment, base construction/mining, 200-per-nexus reservations, capacity loss/recovery, final-command defeat, bounded diminishing power bonuses and exact saves.');
