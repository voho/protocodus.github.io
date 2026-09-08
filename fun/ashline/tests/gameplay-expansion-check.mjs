import assert from 'node:assert/strict';
import {BUILDINGS,UNITS,RESEARCH,BUILDING_UPGRADES,createGame,updateGame,canPlace,placeBuilding,getEntity,trainUnit,unitStats,researchStatus,startResearch,cancelResearch,powerStats,salvageValue,sellBuilding,buildingUpgradeStatus,startBuildingUpgrade,issueOrder} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';

const near=(a,b,message)=>assert(Math.abs(a-b)<1e-6,`${message}: ${a} ≠ ${b}`);
const advance=(s,seconds)=>{for(let i=0;i<Math.round(seconds*20);i++)updateGame(s,.05);};
const own=(s,type,team=0)=>s.entities.filter(e=>e.hp>0&&e.team===team&&e.type===type);
const state=s=>JSON.parse(encodeGame(s)).game;
const quiet=seed=>{
  const s=createGame(seed,'hard',{width:72,height:56});s.ai.nextThink=1e12;s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.navVersion++;
  for(const grid of [...s.visible,...s.explored])grid.fill(1);s.teams[0].credits=10000;return s;
};
function build(s,type){
  const core=own(s,'core')[0];
  for(let y=Math.max(1,core.y-10);y<core.y+10;y++)for(let x=Math.max(1,core.x-10);x<core.x+12;x++)if(canPlace(s,0,type,x,y).ok){const e=getEntity(s,placeBuilding(s,0,type,x,y).id);e.progress=1;e.hp=e.maxHp;return e;}
  throw new Error(`No site for ${type}`);
}
const develop=s=>{build(s,'barracks');build(s,'factory');const lab=build(s,'lab');build(s,'reactor');return lab;};
const complete=(s,lab,id)=>{const before=s.teams[0].credits;assert(startResearch(s,0,id,lab.id).ok);near(s.teams[0].credits,before-RESEARCH[id].cost,'Research charges once');assert(!startResearch(s,0,id).ok);lab.research.progress=.99999;updateGame(s,.05);assert(researchStatus(s,0,id).completed);assert(!lab.research);};

const research=quiet('research-tree'),lab=develop(research),rifle=own(research,'rifle')[0],scout=own(research,'scout')[0];
for(const id of ['toString','missing'])assert(!researchStatus(research,0,id).ok);
assert(!researchStatus(research,0,'infantryArmor').ok);
assert(!researchStatus(research,0,'mobility').ok);
assert(!trainUnit(research,0,'striker').ok);
complete(research,lab,'infantryWeapons');near(unitStats(rifle).damage,UNITS.rifle.damage*1.18,'Research affects deployed infantry');
const lost=rifle.maxHp-rifle.hp;complete(research,lab,'infantryArmor');near(rifle.maxHp,UNITS.rifle.hp*1.2,'Field armor increases maximum health');near(rifle.maxHp-rifle.hp,lost,'Existing damage is retained');
complete(research,lab,'vehicleWeapons');complete(research,lab,'mobility');near(unitStats(scout).speed,UNITS.scout.speed*1.15,'Mobility affects existing vehicles');
const demand=powerStats(research,0).demand;complete(research,lab,'gridEfficiency');near(powerStats(research,0).demand,demand*.8,'Grid upgrade reduces all consumption');
complete(research,lab,'advancedBallistics');assert(!trainUnit(research,0,'striker').ok,'Striker also needs its local assembly bay');
const foundry=own(research,'factory')[0];assert(startBuildingUpgrade(research,0,foundry.id,'advancedProduction').ok);foundry.upgrade.progress=.99999;updateGame(research,.05);assert(buildingUpgradeStatus(research,0,foundry.id,'advancedProduction').completed);
assert(trainUnit(research,0,'striker',foundry.id).ok);foundry.queue[0].progress=.99999;updateGame(research,.05);const striker=own(research,'striker')[0];assert(striker);near(unitStats(striker).damage,UNITS.striker.damage*1.18,'New vehicles inherit researched armaments');
assert(striker.tech.includes('mobility'));assert(!buildingUpgradeStatus(research,0,lab.id,'advancedProduction').ok);
const oldDemand=powerStats(research,0).demand;assert(startBuildingUpgrade(research,0,foundry.id,'efficiency').ok);foundry.upgrade.progress=.99999;updateGame(research,.05);near(powerStats(research,0).demand,oldDemand-BUILDINGS.factory.power*-.25*.8,'Local and global efficiency combine');
assert(startBuildingUpgrade(research,0,foundry.id,'speed').ok);foundry.upgrade.progress=.99999;updateGame(research,.05);assert(trainUnit(research,0,'tank',foundry.id).ok);advance(research,1);near(foundry.queue[0].progress,1.25/UNITS.tank.trainTime,'Local speed scales assembly progress');

const refunds=quiet('research-refunds'),refundLab=develop(refunds),before=refunds.teams[0].credits;
assert(startResearch(refunds,0,'gridEfficiency').ok);assert(cancelResearch(refunds,refundLab.id).ok);near(refunds.teams[0].credits,before,'Cancellation fully refunds paid research');
assert(startResearch(refunds,0,'gridEfficiency').ok);assert(startBuildingUpgrade(refunds,0,refundLab.id,'speed').ok);
const expected=Math.floor(BUILDINGS.lab.cost/2)+RESEARCH.gridEfficiency.cost+BUILDING_UPGRADES.speed.cost;assert.equal(salvageValue(refundLab),expected);assert.equal(sellBuilding(refunds,refundLab.id).refund,expected);assert(!refunds.teams[0].research?.gridEfficiency,'Sale does not finish research');

const battery=quiet('capacitor-reserve'),batteryLab=develop(battery),capacitor=build(battery,'capacitor');
advance(battery,10);near(capacitor.reserve,300,'Capacitor charges from real surplus, capped at 30 per second');
for(const reactor of own(battery,'reactor'))assert(sellBuilding(battery,reactor.id).ok);
let power=powerStats(battery,0);assert.equal(power.status,'reserve');assert.equal(power.ratio,1);const deficit=power.demand-power.supply;
assert(startResearch(battery,0,'gridEfficiency',batteryLab.id).ok);advance(battery,1);near(capacitor.reserve,300-deficit,'Reserve drains the actual power deficit');near(batteryLab.research.progress,1/RESEARCH.gridEfficiency.time,'Research runs at full speed while reserve bridges outage');
advance(battery,4);power=powerStats(battery,0);assert.equal(capacitor.reserve,0);assert.equal(power.status,'brownout');assert(power.ratio<1);
const progress=batteryLab.research.progress;advance(battery,1);near(batteryLab.research.progress-progress,power.ratio/RESEARCH.gridEfficiency.time,'Brownout scales research truthfully');
const emergency=build(battery,'reactor');emergency.progress=0;emergency.hp=emergency.maxHp*.2;advance(battery,1);assert(emergency.progress>0,'Emergency construction can recover a damaged grid');

const defense=quiet('brownout-defenses');develop(defense);const sentry=build(defense,'turret'),hostile=own(defense,'scout',1)[0];
defense.entities=defense.entities.filter(e=>e.kind==='building'||e===hostile);Object.assign(sentry,{x:30,y:28,cooldown:0});Object.assign(hostile,{x:35,y:29,order:{type:'idle'}});defense.navVersion++;
const originalHp=hostile.hp;updateGame(defense,.05);assert(hostile.hp<originalHp,'Powered defenses can fire');
for(const reactor of own(defense,'reactor'))sellBuilding(defense,reactor.id);sentry.cooldown=0;const offlineHp=hostile.hp;updateGame(defense,.05);assert.equal(hostile.hp,offlineHp,'Brownout disables defensive weapons immediately');

const destroyed=quiet('research-loss'),destroyedLab=develop(destroyed),attacker=own(destroyed,'scout',1)[0];
assert(startResearch(destroyed,0,'gridEfficiency').ok);Object.assign(destroyedLab,{x:30,y:28,hp:1});Object.assign(attacker,{x:35,y:29,cooldown:0,order:{type:'attack',targetId:destroyedLab.id,x:31,y:29}});destroyed.navVersion++;
const lostInvestment=destroyed.teams[0].credits;updateGame(destroyed,.05);assert(!getEntity(destroyed,destroyedLab.id));near(destroyed.teams[0].credits,lostInvestment,'Destruction loses research investment without a sale refund');assert(!destroyed.teams[0].research?.gridEfficiency);

const repairs=quiet('support-engineer'),repairLab=develop(repairs),repairFactory=own(repairs,'factory')[0];
assert(trainUnit(repairs,0,'engineer').ok);repairFactory.queue[0].progress=.99999;updateGame(repairs,.05);const engineer=own(repairs,'engineer')[0];
assert(trainUnit(repairs,0,'tank').ok);repairFactory.queue[0].progress=.99999;updateGame(repairs,.05);const tank=own(repairs,'tank')[0];
Object.assign(engineer,{x:35,y:36,order:{type:'idle'}});Object.assign(tank,{x:36,y:36,hp:300,order:{type:'idle'}});const credits=repairs.teams[0].credits;
advance(repairs,1);near(tank.hp,318,'Field engineer restores 18 vehicle HP per second');near(credits-repairs.teams[0].credits,18*UNITS.tank.cost*.35/tank.maxHp,'Repair cost matches actual work');assert(engineer.repairActive&&engineer.repairTargetId===tank.id);
repairs.teams[0].credits=0;advance(repairs,1);near(tank.hp,318,'Repair waits for credits');assert(!engineer.repairActive);
repairs.teams[0].credits=100;issueOrder(repairs,[engineer.id],{type:'move',x:42,y:36});advance(repairs,.2);assert(!engineer.repairActive,'Direct move interrupts repair');
const target=own(repairs,'rifle')[0];Object.assign(target,{x:engineer.x+1,y:engineer.y,hp:50});Object.assign(tank,{x:50,y:45});engineer.order={type:'idle'};advance(repairs,1);assert(!engineer.repairActive,'Maintenance equipment does not heal infantry');

for(const type of [1,2,3]){
  const s=quiet(`mineral-density-${type}`),hauler=own(s,'harvester')[0],tile=35*s.width+35;s.minerals[tile]=1000;s.mineralTypes[tile]=type;
  Object.assign(hauler,{x:35.5,y:35.5,cargo:0,harvestPhase:'gather',mineralTile:tile,order:{type:'harvest'},mineralNavVersion:s.navVersion});advance(s,1);near(hauler.cargo,type===3?56:28,'Red mineral density doubles extraction');assert.equal(hauler.cargoType,type);
}

const saved=quiet('persistent-upgrades'),savedLab=develop(saved),savedCap=build(saved,'capacitor');assert(startResearch(saved,0,'infantryWeapons').ok);assert(startBuildingUpgrade(saved,0,own(saved,'factory')[0].id,'speed').ok);advance(saved,4);
const clone=decodeGame(encodeGame(saved,{x:20,y:20,zoom:8})).game;assert.equal(own(clone,'capacitor')[0].reserve,savedCap.reserve);
for(let i=0;i<10;i++){advance(saved,1);advance(clone,1);assert.deepEqual(state(clone),state(saved),'Reserve, research and upgrades continue exactly after loading');}
for(const mutate of [s=>s.teams[0].research={mobility:true},s=>own(s,'capacitor')[0].reserve=1201,s=>own(s,'lab')[0].research.id='unknown',s=>own(s,'factory')[0].upgrade.id='unknown',s=>s.mineralTypes[0]=4]){const raw=JSON.parse(encodeGame(saved));mutate(raw.game);assert.throws(()=>decodeGame(JSON.stringify(raw)),'Invalid persisted expansion state is rejected');}
const legacy=JSON.parse(encodeGame(saved));delete legacy.game.mineralTypes;assert.equal(decodeGame(JSON.stringify(legacy)).game.mineralTypes.length,saved.width*saved.height,'Legacy deposits receive a compatible mineral palette');
const memory={...structuredClone(own(saved,'refinery',1)[0]),research:null,upgrade:null,powerRatio:.5,powerStatus:'brownout',rememberedAt:saved.time};
assert.deepEqual(decodeGame(encodeGame(saved,{rememberedBuildings:[memory]})).rememberedBuildings,[memory],'Idle enemy snapshots with empty projects and last-seen power remain saveable');
console.log('Gameplay expansion checks passed: research tree/stat inheritance, local upgrades, assembly gating, refunds, capacitor depletion, brownouts, paid engineer support, mineral density, malformed saves and exact continuation.');
