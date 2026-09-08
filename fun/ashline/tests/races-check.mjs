import assert from 'node:assert/strict';
import {BUILDINGS,UNITS,RACES,createGame,updateGame,buildingRole,unitRole,teamRace,raceBuilding,raceUnit,canPlace,placeBuilding,trainUnit,getEntity,startResearch,startBuildingUpgrade,unitStats,powerStats,issueOrder} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';
const advance=(s,seconds)=>{for(let i=0;i<Math.round(seconds*20);i++)updateGame(s,.05);};
const snapshot=s=>JSON.parse(encodeGame(s)).game;
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);
function scene(race){
  const s=createGame(`race-${race}`,'hard',{width:72,height:56,races:[race,race],aiTeams:[]});
  s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.visible.forEach(grid=>grid.fill(1));s.explored.forEach(grid=>grid.fill(1));s.navVersion++;s.teams[0].credits=20000;return s;
}
function build(s,role){
  const type=raceBuilding(s,0,role),base=s.entities.find(e=>e.team===0&&buildingRole(e)==='core');
  for(let y=Math.max(1,base.y-10);y<base.y+10;y++)for(let x=Math.max(1,base.x-10);x<base.x+13;x++)if(canPlace(s,0,type,x,y).ok){const e=getEntity(s,placeBuilding(s,0,type,x,y).id);e.progress=1;e.hp=e.maxHp;return e;}
  throw Error(`No site for ${type}`);
}
for(const race of Object.keys(RACES)){
  const s=scene(race);assert.equal(teamRace(s,0),race);assert.equal(raceBuilding(s,0,'wall'),'wall');
  for(const e of s.entities){const d=e.kind==='building'?BUILDINGS[e.type]:UNITS[e.type];assert.equal(d.race,race);assert.equal(e.type,e.kind==='building'?raceBuilding(s,e.team,d.role):raceUnit(s,e.team,d.role));}
  const harvester=s.entities.find(e=>e.team===0&&unitRole(e)==='harvester');assert(harvester&&harvester.cargo===0&&harvester.order.type==='harvest','Each race receives its own automatic carrier');
  const opposite=race==='organics'?'unityRifle':'rifle';assert(!trainUnit(s,0,opposite).ok,'Cross-race recruitment is refused');
  build(s,'reactor');const barracks=build(s,'barracks'),factory=build(s,'factory'),lab=build(s,'lab'),cap=build(s,'capacitor');
  assert(build(s,'wall'),'Both races share legal wall construction');
  for(const id of ['infantryWeapons','infantryArmor','vehicleWeapons','mobility','gridEfficiency','advancedBallistics']){assert(startResearch(s,0,id,lab.id).ok);lab.research.progress=.99999;updateGame(s,.05);}
  assert(startBuildingUpgrade(s,0,factory.id,'advancedProduction').ok);factory.upgrade.progress=.99999;updateGame(s,.05);
  assert(startBuildingUpgrade(s,0,factory.id,'efficiency').ok);factory.upgrade.progress=.99999;updateGame(s,.05);
  for(const role of ['rifle','rocket','scout','tank','artillery','harvester','engineer','striker']){
    const type=raceUnit(s,0,role),d=UNITS[type],producer=s.entities.find(e=>e.team===0&&e.type===d.producer),before=s.nextId;
    assert(trainUnit(s,0,type,producer.id).ok);producer.queue[0].progress=.99999;updateGame(s,.05);
    const unit=s.entities.find(e=>e.id>=before&&e.type===type);assert(unit,`${type} deploys from its matching facility`);assert.equal(unitRole(unit),role);assert.equal(unit.tech.length,6);
    near(unit.maxHp,d.hp*(d.armor==='infantry'?1.2:1));
  }
  advance(s,1);assert(cap.reserve>0&&powerStats(s,0).ratio===1);
  const restored=decodeGame(encodeGame(s)).game;assert.deepEqual(snapshot(restored),snapshot(s));
  for(let i=0;i<4;i++){advance(s,.5);advance(restored,.5);assert.deepEqual(snapshot(restored),snapshot(s),'Race economy, stats, support and research continue identically');}
}
assert(UNITS.unityRifle.hp>UNITS.rifle.hp&&UNITS.unityRifle.speed<UNITS.rifle.speed,'Unity cohorts exchange speed for resilience');
assert(UNITS.unityScout.speed>UNITS.scout.speed&&UNITS.unityScout.hp<UNITS.scout.hp,'Unity skimmers exchange armor for speed');
assert(UNITS.unityTank.speed>UNITS.tank.speed&&UNITS.unityTank.damage<UNITS.tank.damage,'Walkers have a different mobility/firepower tradeoff');
for(const role of ['rifle','rocket','scout','tank','artillery','harvester','engineer','striker']){
  const organic=UNITS[role],unity=UNITS[`unity${role[0].toUpperCase()}${role.slice(1)}`];
  if(organic.damage)assert(unity.cost>organic.cost&&unity.cost<=organic.cost*1.125,'Unity combat mobility and durability carry a modest recruitment premium');
  else assert.equal(unity.cost,organic.cost,'Carrier and support economies remain equivalent');
}

// Both commanders use independent fog knowledge and full hard-difficulty production pace.
const duel=createGame('AI-RACE-CONTINUATION','hard',{width:72,height:56,races:['organics','aiUnity'],aiTeams:[0,1]});advance(duel,105);
assert(duel.aiByTeam[0]!==duel.ai&&duel.aiByTeam[0].known!==duel.ai.known);
assert(duel.entities.some(e=>e.team===0&&buildingRole(e)==='factory')&&duel.entities.some(e=>e.team===1&&buildingRole(e)==='factory'),'Both independent commanders develop their own race economy');
for(const team of [0,1]){
  const wave=duel.entities.filter(e=>e.team===team&&e.order.speedLimit);assert(wave.length>=5,'Both commanders assemble a real attack wave');
  assert.equal(new Set(wave.map(e=>e.order.speedLimit)).size,1,'A mixed attack wave shares a travel pace');
  assert(wave.every(e=>e.order.speedLimit<=unitStats(e).speed),'A coordinated wave never grants free movement speed');
}
const restored=decodeGame(encodeGame(duel)).game;
for(let i=0;i<10;i++){advance(duel,1);advance(restored,1);assert.deepEqual(snapshot(restored),snapshot(duel),'A two-race AI duel resumes exactly');}
for(const ai of [duel.aiByTeam[0],duel.ai])for(const memory of Object.values(ai.known))assert(memory.seenAt<=duel.time);

const legacy=JSON.parse(encodeGame(createGame('legacy-organics','hard',{width:72,height:56})));
delete legacy.game.aiTeams;delete legacy.game.aiByTeam;for(const team of legacy.game.teams)delete team.race;
const old=decodeGame(JSON.stringify(legacy)).game;assert.equal(teamRace(old,0),'organics');advance(old,.1);
for(const mutate of [s=>s.teams[0].race='unknown',s=>s.aiTeams=[0,0],s=>{delete s.aiByTeam;},s=>s.teams[0].race='aiUnity']){
  const raw=JSON.parse(encodeGame(duel));mutate(raw.game);assert.throws(()=>decodeGame(JSON.stringify(raw)),'Malformed race/controller state is rejected');
}
console.log('Race checks passed: both complete rosters, own-race production/research/upgrades, shared walls, distinct stat tradeoffs, carriers, support, dual AI, fog knowledge, exact saves and legacy Organics.');
