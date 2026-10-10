// Ashline: deterministic, dependency-free skirmish simulation. Coordinates are tiles.
// Map generation lives in terrain.js, the opposition in ai.js, scripted operations in mission.js (with
// their data in campaign.js) and unit abilities in abilities.js; all of them build on these exports.
import {createFlockSnapshot,flockSteering} from './flocking.js';
import {findTrafficDetour} from './traffic.js';
import {MAP_SIZES,MAP_PROFILES,mapLayout,hash,generateMap} from './terrain.js';
import {newAI,aiState,thinkAI,teamPace} from './ai.js';
import {missionDefinition,missionSettings,createMissionState,updateMission,settleMission,missionAllows,noteDelivery,noteTrained,missionDeployment,noteTagLost} from './mission.js';
import {ABILITIES,abilitySpeed,abilityRange,abilityDamageTaken,endHeldAbility} from './abilities.js';
export {MAP_SIZES,MAP_PROFILES,mapLayout};
export const UNIT_CAP=2000;
export const UNIT_CAP_PER_NEXUS=200,NEXUS_DEPLOY_RANGE=4;
export const BUILDINGS = {
  wall: {name:'Bulwark wall',cost:40,hp:600,size:1,buildTime:4,power:0,requires:['core'],race:'both',role:'wall',description:'Low armored barrier. Blocks movement, shields approaches, and can be repaired or sold.',sight:3},
  core: {name:'Command nexus',cost:1800,hp:3000,size:3,buildTime:40,power:20,requires:[],description:'Provides 200 unit slots, up to 2,000. Deploy a construction vehicle to establish another base. Protect your nexuses and construction vehicles.',sight:12},
  reactor: {name:'Flux reactor',cost:240,hp:700,size:2,buildTime:12,power:100,requires:['core'],description:'Produces 100 power for production and defenses.',sight:7},
  refinery: {name:'Shard refinery',cost:500,hp:1400,size:3,buildTime:20,power:-30,requires:['core'],description:'Includes one automatic shard hauler. Converts deliveries into credits.',sight:9},
  barracks: {name:'Field barracks',cost:320,hp:1100,size:2,buildTime:15,power:-15,requires:['core'],description:'Trains rifle squads, rocket infantry, and recon rovers.',sight:8},
  factory: {name:'War foundry',cost:650,hp:1700,size:3,buildTime:26,power:-40,requires:['barracks','refinery'],description:'Builds armored vehicles, field engineers, and nexus construction vehicles.',sight:8},
  lab: {name:'Signal laboratory',cost:450,hp:950,size:2,buildTime:22,power:-25,requires:['barracks','reactor'],description:'Researches permanent army and grid upgrades. One project per laboratory.',sight:9},
  capacitor: {name:'Grid capacitor',cost:300,hp:850,size:2,buildTime:16,power:-5,requires:['reactor'],reserveCapacity:1200,description:'Stores 1,200 power-seconds from surplus generation. Bridges outages until its reserve empties.',sight:7},
  turret: {name:'Rail sentry',cost:300,hp:900,size:1,buildTime:15,power:-20,requires:['barracks'],description:'Powered anti-vehicle defense. Vulnerable to siege fire.',sight:11,range:8,damage:42,interval:1.1},
  rocketTower: {name:'Rocket tower',cost:480,hp:1100,size:2,buildTime:24,power:-35,requires:['barracks','reactor'],description:'Powered missile defense with explosive splash. Strong against clustered armor.',sight:11,range:9,damage:85,interval:2.6,splash:1.8,splashDamage:.45},
};
export const UNITS = {
  rifle: {name:'Rifle squad',cost:80,hp:105,size:.45,speed:2.7,range:4.8,damage:15,trainTime:5,buildTime:5,power:0,requires:[],producer:'barracks',description:'Cheap infantry. Holds ground and screens armor; weak against vehicles.',sight:8,interval:.75,armor:'infantry'},
  rocket: {name:'Rocket infantry',cost:160,hp:95,size:.48,speed:2.4,range:7,damage:60,trainTime:9,buildTime:9,power:0,requires:[],producer:'barracks',description:'Long-range anti-armor launcher. Slow firing and vulnerable to rifle squads.',sight:8,interval:2.4,armor:'infantry',splash:.9,splashDamage:.3},
  scout: {name:'Recon rover',cost:140,hp:200,size:.65,speed:4.1,range:5.5,damage:18,trainTime:8,buildTime:8,power:0,requires:[],producer:'barracks',description:'Fast scout with a wide sensor radius and anti-infantry gun.',sight:13,interval:.65,armor:'light'},
  tank: {name:'Vanguard tank',cost:300,hp:520,size:.8,speed:2.1,range:7,damage:72,trainTime:14,buildTime:14,power:0,requires:[],producer:'factory',description:'Armored main battle tank. Crushes vehicles and defenses.',sight:9,interval:1.55,armor:'heavy'},
  artillery: {name:'Siege crawler',cost:380,hp:270,size:.8,speed:1.7,range:11.5,damage:115,trainTime:19,buildTime:19,power:0,requires:[],producer:'factory',description:'Long-range splash damage. Devastates buildings; protect it.',sight:9,interval:3.2,armor:'light'},
  harvester: {name:'Shard hauler',cost:300,hp:600,size:.8,speed:2.7,range:0,damage:0,trainTime:14,buildTime:14,power:0,requires:[],producer:'refinery',description:'Automatically collects shards and delivers 200 credits per load. Resumes after moving.',sight:8,interval:1,armor:'heavy',capacity:200},
  engineer: {name:'Field engineer',cost:220,hp:290,size:.7,speed:2.8,range:0,damage:0,trainTime:11,buildTime:11,power:0,requires:[],producer:'factory',description:'Unarmed maintenance vehicle. Automatically repairs nearby vehicles and structures for credits; needs power.',sight:9,interval:1,armor:'light',repairRange:4,repairRate:18},
  constructor: {name:'Nexus construction vehicle',cost:1800,hp:650,size:.9,speed:2,range:0,damage:0,trainTime:30,buildTime:30,power:0,requires:[],producer:'factory',description:'Unarmed mobile base. Deploy within 4 tiles to build a new nexus, opening a remote base and adding 200 unit slots when complete. Deployment consumes this vehicle at no extra cost.',sight:10,interval:1,armor:'heavy'},
  striker: {name:'Pike striker',cost:260,hp:320,size:.7,speed:3.5,range:6,damage:27,trainTime:12,buildTime:12,power:0,requires:[],research:'advancedBallistics',producer:'factory',description:'Fast six-wheel assault vehicle with twin autocannons. Shreds infantry; weak against heavy armor.',sight:10,interval:.55,armor:'light'},
};
// Unit identity "constructor" must never resolve to an inherited object constructor.
Object.setPrototypeOf(BUILDINGS,null);Object.setPrototypeOf(UNITS,null);

export const RACES = {
  organics:{name:'Organics',description:'Human and alien crews field rugged industrial armor. Reliable firepower, sturdy vehicles and fast infantry.'},
  aiUnity:{name:'AI Unity',description:'Autonomous cohorts combine durable combat robots with agile, lighter, cheaper machines and efficient infrastructure.'},
};
const unityId=role=>`unity${role[0].toUpperCase()}${role.slice(1)}`;
const UNITY_BUILDINGS={
  core:{name:'Unity mainframe',hp:3100,power:20},reactor:{name:'Resonance spire',hp:800,power:95,description:'Armored autonomous generator. Produces 95 power for industry and defenses.'},refinery:{name:'Prism assimilator',hp:1300,power:-28,description:'Includes one automatic Prism carrier. Efficient conversion of shard deliveries into credits.'},
  barracks:{name:'Cohort assembler',hp:1050,description:'Prints Needle cohorts, Breach automata and Veil skimmers.'},factory:{name:'Walker forge',hp:1550,power:-38,description:'Builds articulated combat walkers, Mender drones, and Mainframe constructors.'},lab:{name:'Logic archive',hp:1000,power:-24,description:'Develops permanent combat and infrastructure algorithms. One project per archive.'},
  capacitor:{name:'Charge nexus',hp:800},turret:{name:'Lance node',hp:820,damage:44,interval:1.15},rocketTower:{name:'Shard battery',hp:1000,damage:80,interval:2.45},
  wall:{name:'Interlock barrier',hp:600},
};
// Prices keep strength per credit, √(health × damage ÷ interval) ÷ cost, level with Organics: the durable,
// weaker-hitting cohorts cost what organic infantry costs and the lighter machines cost less (docs/BALANCE.md).
const UNITY_UNITS={
  rifle:{name:'Needle cohort',cost:80,hp:120,speed:2.4,damage:13,description:'Durable biped combat robots. Slower than organic infantry, with sustained pulse fire.'},
  rocket:{name:'Breach automaton',cost:160,hp:108,speed:2.15,damage:53,description:'Heavy biped launcher platforms. Tougher but slower than organic rocket teams.'},
  scout:{name:'Veil skimmer',cost:130,hp:165,speed:4.55,description:'Agile sensor machine with light armor. Wide sight and rapid anti-infantry fire.'},
  tank:{name:'Bastion walker',cost:280,hp:470,speed:2.4,damage:67,interval:1.5,description:'Articulated assault walker. Trades some armor and shell weight for mobility and a lower price.'},
  artillery:{name:'Arc siege walker',cost:350,hp:235,speed:1.95,damage:110,interval:3.1,description:'Mobile long-range siege platform. Lighter armor demands careful screening.'},
  harvester:{name:'Prism carrier',hp:540,speed:2.7,description:'Autonomous shard carrier with a rear mineral chamber. Same cargo capacity and extraction economy as organic haulers.'},
  engineer:{name:'Mender drone',hp:250,speed:3.1,repairRate:18,description:'Unarmed maintenance machine. Fast relocation; repairs nearby vehicles and structures for credits and power.'},
  constructor:{name:'Mainframe constructor',hp:600,speed:2.2,description:'Unarmed mobile mainframe. Deploy within 4 tiles to establish a remote base and add 200 unit slots when complete. Deployment consumes this machine at no extra cost.'},
  striker:{name:'Talon runner',cost:245,hp:285,speed:3.85,damage:26,interval:.53,description:'Fast multi-legged hunter with paired anti-infantry pulse cannons. Vulnerable to heavy armor.'},
};
// Distinct identities share gameplay roles; faction ownership paint is independent of race.
for(const [role,d] of Object.entries(BUILDINGS)){
  if(d.race==='both'){d.role=role;continue;}
  Object.assign(d,{role,race:'organics'});
  BUILDINGS[unityId(role)]={...d,...UNITY_BUILDINGS[role],role,race:'aiUnity',requires:d.requires.map(unityId)};
}
for(const [role,d] of Object.entries(UNITS)){
  Object.assign(d,{role,race:'organics'});
  UNITS[unityId(role)]={...d,...UNITY_UNITS[role],role,race:'aiUnity',producer:unityId(d.producer),requires:d.requires.map(unityId)};
}
export function buildingRole(value){const type=typeof value==='string'?value:value?.type;return BUILDINGS[type]?.role||type;}
export function unitRole(value){const type=typeof value==='string'?value:value?.type;return UNITS[type]?.role||type;}
export function teamRace(s,team){return s.teams[team]?.race||'organics';}
export function raceBuilding(s,team,role){const key=buildingRole(role);return BUILDINGS[key]?.race==='both'?key:teamRace(s,team)==='aiUnity'?unityId(key):key;}
export function raceUnit(s,team,role){return teamRace(s,team)==='aiUnity'?unityId(unitRole(role)):unitRole(role);}
export const entityRole=value=>buildingRole(unitRole(value));

export const RESEARCH = {
  infantryWeapons:{name:'Pulse accelerators',branch:'Infantry',cost:220,time:30,requires:[],description:'Rifle and rocket infantry deal 18% more damage.'},
  infantryArmor:{name:'Composite field armor',branch:'Infantry',cost:320,time:40,requires:['infantryWeapons'],description:'Infantry gain 20% maximum health, including deployed squads.'},
  vehicleWeapons:{name:'Stabilized armaments',branch:'Vehicles',cost:300,time:35,requires:[],description:'Armed vehicles deal 18% more damage.'},
  mobility:{name:'Adaptive drivetrains',branch:'Vehicles',cost:350,time:40,requires:['vehicleWeapons'],description:'All vehicles, including haulers and engineers, move 15% faster.'},
  gridEfficiency:{name:'Efficient power routing',branch:'Infrastructure',cost:250,time:30,requires:[],description:'All structures consume 20% less electricity.'},
  advancedBallistics:{name:'Advanced ballistics',branch:'Infrastructure',cost:400,time:45,requires:['gridEfficiency'],description:'Unlocks the Pike striker. Rocket infantry and siege crawlers deal 10% more damage.'},
};
export const BUILDING_UPGRADES = {
  speed:{name:'Accelerated operations',cost:200,time:25,types:['barracks','factory','refinery','lab'],requires:['lab'],description:'This facility trains units, researches and processes minerals 25% faster.'},
  efficiency:{name:'Efficient converters',cost:180,time:25,types:['refinery','barracks','factory','lab','capacitor','turret','rocketTower'],requires:['lab'],description:'This structure consumes 25% less electricity. Combines with grid research.'},
  advancedProduction:{name:'Advanced assembly bay',cost:260,time:35,types:['factory'],requires:['lab'],description:'This foundry can build Pike strikers after Advanced ballistics research.'},
};

export const MAP_WIDTH=MAP_SIZES.frontier.width,MAP_HEIGHT=MAP_SIZES.frontier.height;
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const sq=(x)=>x*x;
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const center=e=>e.kind==='building'?{x:e.x+e.size/2,y:e.y+e.size/2}:e;
export const cell=(s,x,y)=>Math.floor(y)*s.width+Math.floor(x);
const inside=(s,x,y)=>x>=0&&y>=0&&x<s.width&&y<s.height;
const good=()=>({ok:true,reason:''});
const bad=reason=>({ok:false,reason});
export const alive=e=>e.hp>0;
export const own=(s,t,type)=>{
  const owned=spatialStates.get(s)?.owned[t];
  if(owned)return(type?owned.types.get(type)||[]:owned.all).filter(alive);
  return s.entities.filter(e=>alive(e)&&e.team===t&&(!type||e.type===type||entityRole(e)===type));
};
export const completed=(s,t,type)=>own(s,t,type).some(e=>e.kind==='building'&&e.progress>=1);
export const definition=e=>e.kind==='building'?BUILDINGS[e.type]:UNITS[e.type];
// Per-step spatial state is derived, never serialized. Ordering stays identical to entities.
const spatialStates=new WeakMap(),SPATIAL_CELL=6;
// Integer keys for integer grid buckets; on-map coordinates stay far inside the 16-bit fields.
export const bucketKey=(x,y)=>(y+64)*65536+x+64;
const spatialKey=e=>{const p=center(e);return bucketKey(Math.floor(p.x/SPATIAL_CELL),Math.floor(p.y/SPATIAL_CELL));};
const bumpVersion=(versions,key)=>versions.set(key,(versions.get(key)||0)+1);
function indexEntity(s,e){
  const spatial=spatialStates.get(s);if(!spatial)return;
  const key=spatialKey(e),previous=spatial.entries.get(e.id);
  if(previous?.key===key)return;
  // Only the two touched buckets change membership; cached rectangles check their bucket versions.
  bumpVersion(spatial.versions,key);
  if(previous){bumpVersion(spatial.versions,previous.key);const bucket=spatial.buckets.get(previous.key);bucket.splice(bucket.indexOf(previous),1);}
  const entry={e,key,index:previous?.index??spatial.nextIndex++};spatial.entries.set(e.id,entry);
  if(!previous){
    const owned=spatial.owned[e.team];owned.all.push(e);
    const role=entityRole(e);
    for(const type of e.type===role?[role]:[e.type,role]){
      if(!owned.types.has(type))owned.types.set(type,[]);owned.types.get(type).push(e);
    }
  }
  if(!spatial.buckets.has(key))spatial.buckets.set(key,[]);spatial.buckets.get(key).push(entry);
}
function beginSpatialStep(s){
  spatialStates.set(s,{buckets:new Map(),versions:new Map(),entries:new Map(),queries:new Map(),owned:[0,1].map(()=>({all:[],types:new Map()})),nextIndex:0,flock:createFlockSnapshot(s.entities)});
  for(const e of s.entities)if(alive(e))indexEntity(s,e);
}
function nearbyEntities(s,p,r){
  const spatial=spatialStates.get(s);if(!spatial)return s.entities;
  const left=Math.floor((p.x-r)/SPATIAL_CELL),right=Math.floor((p.x+r)/SPATIAL_CELL),top=Math.floor((p.y-r)/SPATIAL_CELL),bottom=Math.floor((p.y+r)/SPATIAL_CELL);
  const {versions,queries}=spatial,key=((left+64)*1024+right+64)*1048576+(top+64)*1024+bottom+64,cached=queries.get(key);
  if(cached){
    let valid=true,n=0;
    for(let y=top;y<=bottom&&valid;y++)for(let x=left;x<=right&&valid;x++)valid=(versions.get(bucketKey(x,y))||0)===cached.stamp[n++];
    if(valid)return cached.result;
  }
  const entries=[],stamp=[];
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
    const k=bucketKey(x,y),bucket=spatial.buckets.get(k);stamp.push(versions.get(k)||0);
    if(bucket)for(const entry of bucket)entries.push(entry);
  }
  const result=entries.sort((a,b)=>a.index-b.index).map(entry=>entry.e);
  // Callers filter live positions; membership/order only changes on bucket moves
  // and births. Bound retained queries even for unusually scattered armies.
  if(queries.size>=256)queries.clear();
  queries.set(key,{result,stamp});return result;
}

export function unitRank(e){return e?.kind==='unit'?Math.min(3,Math.floor(Math.max(0,e.kills||0)/5)):0;}
// Each rank adds 20% damage and maximum HP but only 5% speed, so veterans keep pace with their formation.
export function unitStats(e){
  const d=UNITS[e?.type];if(!d)return null;
  const rank=unitRank(e),bonus=1+rank*.2,tech=e.tech||[],infantry=d.armor==='infantry';
  return{rank,hp:d.hp*bonus*(infantry&&tech.includes('infantryArmor')?1.2:1),damage:d.damage*bonus*(tech.includes(infantry?'infantryWeapons':'vehicleWeapons')?1.18:1)*(tech.includes('advancedBallistics')&&['rocket','artillery'].includes(entityRole(e))?1.1:1),speed:d.speed*(1+rank*.05)*(!infantry&&tech.includes('mobility')?1.15:1),range:d.range};
}
// Firing range including a temporary ability bonus. Defend leashes keep the unit's base range.
export function unitRange(s,u){return UNITS[u.type].range+abilityRange(s,u);}

const militaryUnit=u=>u?.kind==='unit'&&UNITS[u.type]?.damage>0;
export function effectiveUnitStance(u){return militaryUnit(u)&&u.order?.type==='idle'&&u.stance==='defend'?'defend':'guard';}
function clearDefendState(u){delete u.defendAnchor;delete u.retaliationTargetId;delete u.defendReturning;}
export function setUnitStance(s,ids,stance){
  if(!['guard','defend'].includes(stance))return;
  for(const id of new Set(ids)){
    const u=getEntity(s,id);if(!militaryUnit(u)||(u.stance||'guard')===stance)continue;
    u.stance=stance;clearDefendState(u);
    if(u.order.type==='idle'){
      u.path=[];u.repath=0;u.targetId=null;u.moveSpeed=0;clearTrafficOrder(u);
      if(stance==='defend')u.defendAnchor={x:u.x,y:u.y};
    }
  }
}

// The shared simulation stream. Every draw shifts later combat and AI choices.
export function random(s){let x=s.rng|0;x^=x<<13;x^=x>>>17;x^=x<<5;s.rng=x>>>0;return s.rng/4294967296;}
// Event kinds are stable identifiers; text stays player-facing copy. x/y and entity details only ever
// describe the event team's own entities (or static mission points), so a log entry cannot leak fog.
export const EVENT_KINDS=['opening','power','researchStarted','researchComplete','upgradeStarted','upgradeComplete','placed','online','deployed','walls','sold','delivery','explored','underAttack','promotion','unitLost','structureLost','haulersLost','victory','defeat','ready','bayBlocked','objective','objectiveFailed','dialogue','wave','mission','ability','trainingCancelled'];
export function event(s,text,team=0,extra){s.events.push({text,team,time:s.time,...extra});}
const subject=e=>{const c=center(e);return{entityId:e.id,role:entityRole(e),x:c.x,y:c.y};};
// Match statistics are optional (older saves lack them); only mission objectives and the interface read them.
// The unseen kill counts are the part of the kill counts that the killing team did not see happen.
export const TEAM_STATS=['trained','lost','built','structuresLost','unitKills','structureKills','mined','spent','damageDealt','damageTaken','peakArmy','researched','unseenUnitKills','unseenStructureKills'];
export function tally(s,team,key,amount=1){const stats=s.teams[team]?.stats;if(stats)stats[key]=Math.max(0,(stats[key]??0)+amount);}
// The kills a team has confirmed. A kill out of its sight (splash, a barrage on remembered ground) is confirmed
// only when the operation ends, so no counter shown or acted on during play reports a death under fog.
export function confirmedKills(s,team){const t=s.teams[team],stats=s.status==='playing'?t.stats:null;return t.kills-(stats?.unseenUnitKills||0)-(stats?.unseenStructureKills||0);}
const armySize=(s,team)=>own(s,team).filter(militaryUnit).length;
export function getEntity(s,id){
  if(id===undefined||id===null)return undefined;
  const spatial=spatialStates.get(s);
  if(spatial){const e=spatial.entries.get(id)?.e;return e&&alive(e)?e:undefined;}
  return s.entities.find(e=>e.id===id&&alive(e));
}
export function unitCapacity(s,team){return Math.min(UNIT_CAP,own(s,team,'core').filter(e=>e.kind==='building'&&e.progress>=1).length*UNIT_CAP_PER_NEXUS);}
function reservedUnits(s,team){return own(s,team).reduce((n,e)=>n+(e.kind==='unit'?1:e.queue.length+(e.haulerPending?1:0)),0);}
export function powerStats(s,team){
  let supply=0,demand=0,reserve=0,reserveCapacity=0;
  for(const e of own(s,team)){
    if(e.kind!=='building'||e.progress<1)continue;const d=BUILDINGS[e.type],p=d.power;
    if(p>0)supply+=p;else demand-=p*(e.upgrades?.efficiency?.75:1);
    if(d.reserveCapacity){reserveCapacity+=d.reserveCapacity;reserve+=clamp(e.reserve||0,0,d.reserveCapacity);}
  }
  if(s.teams[team]?.research?.gridEfficiency)demand*=.8;
  const gridRatio=demand?Math.min(1,supply/demand):1,usingReserve=gridRatio<1&&reserve>1e-8,ratio=usingReserve?1:gridRatio;
  const surplus=Math.max(0,supply-demand),productionMultiplier=1+.25*surplus/(demand+100+surplus);
  return{supply,demand,gridRatio,ratio,productionMultiplier,reserve,reserveCapacity,usingReserve,status:usingReserve?'reserve':gridRatio<1?'brownout':'stable',reserveSeconds:demand>supply?reserve/(demand-supply):0};
}

function advancePower(s,team,dt){
  const p=powerStats(s,team),capacitors=own(s,team,'capacitor').filter(e=>e.progress>=1);
  if(p.usingReserve){
    const needed=(p.demand-p.supply)*dt,used=Math.min(p.reserve,needed);let remaining=used;
    for(const e of capacitors){const draw=Math.min(e.reserve||0,remaining);e.reserve=(e.reserve||0)-draw;remaining-=draw;}
    p.ratio=Math.min(1,(p.supply+used/dt)/p.demand);
  }else if(p.supply>p.demand){
    let charge=(p.supply-p.demand)*dt;
    for(const e of capacitors){const amount=Math.min(BUILDINGS[e.type].reserveCapacity-(e.reserve||0),30*dt,charge);e.reserve=(e.reserve||0)+amount;charge-=amount;}
  }
  const previous=s.teams[team].powerStatus;
  if(previous!==p.status){
    s.teams[team].powerStatus=p.status;const detail={kind:'power',status:p.status};
    if(p.status==='brownout')event(s,'Power shortage: defenses offline; production, research and repairs slowed.',team,detail);else if(p.status==='reserve')event(s,'Capacitor reserve engaged. Restore power before it empties.',team,detail);else if(previous)event(s,'Power grid restored.',team,detail);
  }
  return p;
}

export function researchStatus(s,team,id){
  const base={completed:!!s.teams[team]?.research?.[id],queued:own(s,team,'lab').some(e=>e.research?.id===id)};
  const result=reason=>({...bad(reason),...base});
  if(!Object.hasOwn(RESEARCH,id)||![0,1].includes(team))return result('Unknown research');
  if(base.completed)return result('Research complete');
  if(base.queued)return result('Research in progress');
  if(!missionAllows(s,team,'research',id))return result('Not authorized for this operation');
  if(s.status!=='playing')return result('Operation has ended');
  const missing=RESEARCH[id].requires.find(key=>!s.teams[team].research?.[key]);
  if(missing)return result(`Requires ${RESEARCH[missing].name}`);
  const labs=own(s,team,'lab').filter(e=>e.progress>=1);
  if(!labs.length)return result(`Requires ${BUILDINGS[raceBuilding(s,team,'lab')].name}`);
  if(!labs.some(e=>!e.research))return result('Laboratory is busy');
  if(s.teams[team].credits<RESEARCH[id].cost)return result('Insufficient credits');
  return{...good(),...base};
}
export function startResearch(s,team,id,labId){
  const result=researchStatus(s,team,id);if(!result.ok)return result;
  const lab=own(s,team,'lab').find(e=>e.progress>=1&&!e.research&&(labId===undefined||e.id===labId));
  if(!lab)return bad('Selected laboratory unavailable');
  s.teams[team].credits-=RESEARCH[id].cost;tally(s,team,'spent',RESEARCH[id].cost);lab.research={id,progress:0};event(s,`${RESEARCH[id].name}: research started`,team,{kind:'researchStarted',...subject(lab)});return{...good(),id:lab.id};
}
export function cancelResearch(s,id,team=0){
  const lab=getEntity(s,id);
  if(s.status!=='playing'||!lab||lab.team!==team||entityRole(lab)!=='lab'||!lab.research)return bad('Select your active laboratory');
  const refund=RESEARCH[lab.research.id].cost;s.teams[team].credits+=refund;tally(s,team,'spent',-refund);delete lab.research;return{...good(),refund};
}
function finishResearch(s,lab){
  const id=lab.research.id;s.teams[lab.team].research??={};s.teams[lab.team].research[id]=true;delete lab.research;
  for(const e of own(s,lab.team))if(e.kind==='unit'){e.tech=Object.keys(RESEARCH).filter(key=>s.teams[e.team].research[key]);const hp=unitStats(e).hp;e.hp=Math.min(hp,e.hp+hp-e.maxHp);e.maxHp=hp;}
  tally(s,lab.team,'researched');event(s,`${RESEARCH[id].name}: research complete`,lab.team,{kind:'researchComplete',...subject(lab)});
}
export function buildingUpgradeStatus(s,team,entityId,id){
  const e=getEntity(s,entityId),d=BUILDING_UPGRADES[id],base={completed:!!e?.upgrades?.[id],queued:e?.upgrade?.id===id};
  const result=reason=>({...bad(reason),...base});
  if(!Object.hasOwn(BUILDING_UPGRADES,id)||!e||e.kind!=='building'||e.team!==team)return result('Select your structure');
  if(!d.types.includes(entityRole(e)))return result('Upgrade unavailable for this structure');
  if(base.completed)return result('Upgrade complete');if(base.queued)return result('Upgrade in progress');
  if(!missionAllows(s,team,'upgrades',id))return result('Not authorized for this operation');
  if(s.status!=='playing')return result('Operation has ended');
  if(e.progress<1)return result('Finish construction first');
  if(e.upgrade)return result('Structure upgrade in progress');
  const missing=d.requires.find(key=>!completed(s,team,key));if(missing)return result(`Requires ${BUILDINGS[raceBuilding(s,team,missing)].name}`);
  if(s.teams[team].credits<d.cost)return result('Insufficient credits');
  return{...good(),...base};
}
export function startBuildingUpgrade(s,team,entityId,id){
  const result=buildingUpgradeStatus(s,team,entityId,id);if(!result.ok)return result;
  const e=getEntity(s,entityId);s.teams[team].credits-=BUILDING_UPGRADES[id].cost;tally(s,team,'spent',BUILDING_UPGRADES[id].cost);e.upgrade={id,progress:0};event(s,`${BUILDING_UPGRADES[id].name}: upgrade started`,team,{kind:'upgradeStarted',...subject(e)});return good();
}

// The single entity constructor. Missions use it for scripted forces; players go through the commands.
export function addEntity(s,team,kind,type,x,y,built=true){
  const d=kind==='building'?BUILDINGS[type]:UNITS[type];
  const e={id:s.nextId++,team,kind,type,x,y,hp:built?d.hp:d.hp*.2,maxHp:d.hp,size:d.size,angle:team?Math.PI:0,progress:built?1:0,cooldown:random(s),order:{type:'idle'},path:[],repath:0};
  if(kind==='unit'){e.kills=0;e.tech=Object.keys(RESEARCH).filter(key=>s.teams[team].research?.[key]);e.hp=e.maxHp=unitStats(e).hp;}
  const role=entityRole(type);
  if(role==='capacitor')e.reserve=0;
  if(kind==='building'){e.queue=[];if(role==='refinery')e.haulerPending=true;if(role==='refinery'||role==='core'){e.processingAmount=0;e.processingTotal=0;}s.navVersion++;}else if(role==='harvester'){e.cargo=0;e.unload=0;e.unloadDepotId=null;e.harvestPhase='gather';e.order={type:'harvest'};}
  s.entities.push(e);indexEntity(s,e);
  const stats=kind==='unit'&&s.teams[team].stats;if(stats)stats.peakArmy=Math.max(stats.peakArmy??0,armySize(s,team));
  return e;
}

export function createGame(seed='ASH-001',difficulty='normal',options={}){
  // An operation fixes the settings it defines; an unknown mission is refused before generation.
  const operation=options.mission===undefined?null:missionDefinition(options.mission);
  const {width:W=MAP_WIDTH,height:H=MAP_HEIGHT,profile='rift',races=['organics','organics'],aiTeams=[1],aiProfiles={}}=operation?missionSettings(operation,options):options;
  if(!((W===72&&H===56)||Object.values(MAP_SIZES).some(size=>W===size.width&&H===size.height)))throw new RangeError('Unsupported map dimensions');
  if(!Object.hasOwn(MAP_PROFILES,profile))throw new RangeError('Unsupported terrain profile');
  if(!Array.isArray(races)||races.length!==2||races.some(race=>!Object.hasOwn(RACES,race)))throw new RangeError('Unsupported race pairing');
  if(!Array.isArray(aiTeams)||aiTeams.some(team=>![0,1].includes(team))||new Set(aiTeams).size!==aiTeams.length)throw new RangeError('Unsupported AI teams');
  // Profiles are keyed by AI team; newAI validates each profile's contents.
  if(aiProfiles===null||typeof aiProfiles!=='object'||Array.isArray(aiProfiles)||Object.keys(aiProfiles).some(key=>!aiTeams.map(String).includes(key)))throw new RangeError('Unsupported AI profiles');
  const N=W*H,level=['easy','normal','hard'].includes(difficulty)?difficulty:'normal';
  const s={width:W,height:H,mapProfile:profile,seed:String(seed),difficulty:level,rng:hash(seed),nextId:1,time:0,status:'playing',terrain:new Uint8Array(N),minerals:new Float32Array(N),mineralTypes:new Uint8Array(N),visible:[new Uint8Array(N),new Uint8Array(N)],explored:[new Uint8Array(N),new Uint8Array(N)],entities:[],teams:[{credits:1800,kills:0},{credits:1800,kills:0}],effects:[],events:[],navVersion:0,navBuilt:-1,blocked:new Uint8Array(N),fogClock:0,ai:newAI(level,aiProfiles[1],{seed:String(seed),team:1})};
  s.teams.forEach((team,index)=>{team.race=races[index];});s.aiTeams=[...aiTeams];
  if(aiTeams.includes(0))s.aiByTeam={0:newAI(level,aiProfiles[0],{seed:String(seed),team:0})};
  generateMap(s);
  const {start,end}=mapLayout(s);
  for(let team=0;team<2;team++){
    if(operation?.start?.[team]==='none')continue;
    const building=(role,x,y)=>{const type=raceBuilding(s,team,role);return addEntity(s,team,'building',type,team?end.x+11-x-BUILDINGS[type].size:start.x+x-12,team?end.y+36-y-BUILDINGS[type].size:start.y+y-37);};
    const unit=(role,x,y)=>addEntity(s,team,'unit',raceUnit(s,team,role),team?end.x+11-x:start.x+x-12,team?end.y+36-y:start.y+y-37);
    building('core',10,35);building('reactor',6,35);building('refinery',15,38);
    for(let j=0;j<3;j++)unit('rifle',11+j,33.7);
    unit('scout',15.5,33);
  }
  // Initial footprints must never contain shards, including the generated field fringe.
  for(const e of s.entities)if(e.kind==='building')for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++){s.terrain[y*W+x]=0;s.minerals[y*W+x]=0;}
  if(operation)createMissionState(s,options.mission,options);
  rebuildNavigation(s);for(const e of [...s.entities])deliverRefineryHauler(s,e);
  // Statistics start after the opening deployment: starting forces and haulers are not counted as trained.
  s.teams.forEach((team,index)=>{team.stats={...Object.fromEntries(TEAM_STATS.map(key=>[key,0])),peakArmy:armySize(s,index)};});
  updateFog(s);event(s,operation?.opening??'Command online. Secure the shards. Destroy the hostile nexus.',0,{kind:'opening'});
  return s;
}

// A summed blocked-tile grid proves empty swept rectangles in constant time.
// It is derived from navigation, never serialized or shared between games.
const clearanceGrids=new WeakMap();
function rebuildClearance(s){
  const stride=s.width+1,sums=new Uint32Array(stride*(s.height+1));
  for(let y=0;y<s.height;y++){
    let row=0;const source=y*s.width,above=y*stride,next=(y+1)*stride;
    for(let x=0;x<s.width;x++){row+=s.blocked[source+x];sums[next+x+1]=sums[above+x+1]+row;}
  }
  clearanceGrids.set(s,{sums,stride});
}
export function rebuildNavigation(s){
  const {width:W,height:H}=s,N=W*H;
  if(s.navBuilt===s.navVersion&&s.regionSize){if(!clearanceGrids.has(s))rebuildClearance(s);return;}
  const {terrain,blocked}=s;
  for(let i=0;i<N;i++)blocked[i]=terrain[i]===1||terrain[i]===3||terrain[i]===4?1:0;
  for(const e of s.entities)if(alive(e)&&e.kind==='building')for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)blocked[y*W+x]=1;
  // Connected regions let haulers skip isolated mineral pockets without repeated A* failures.
  const regions=s.regions=new Uint16Array(N),queue=new Int32Array(N);let region=0,tail=0;
  const visit=next=>{if(!blocked[next]&&!regions[next]){regions[next]=region;queue[tail++]=next;}};
  for(let start=0;start<N;start++)if(!blocked[start]&&!regions[start]){
    region++;tail=0;visit(start);
    for(let head=0;head<tail;head++){const at=queue[head],x=at%W;if(x>0)visit(at-1);if(x<W-1)visit(at+1);if(at>=W)visit(at-W);if(at<N-W)visit(at+W);}
  }
  // Region sizes are derived, never saved: a loaded map rebuilds them once.
  const sizes=s.regionSize=new Uint32Array(region+1);for(let i=0;i<N;i++)sizes[regions[i]]++;
  s.navBuilt=s.navVersion;rebuildClearance(s);
}
function walkable(s,x,y,r=.19){
  const {width:W,height:H}=s;
  if(x<r||y<r||x>=W-r||y>=H-r)return false;
  const b=s.blocked,top=Math.floor(y-r)*W,bottom=Math.floor(y+r)*W,left=Math.floor(x-r),right=Math.floor(x+r);
  return !(b[top+left]||b[top+right]||b[bottom+left]||b[bottom+right]);
}
export function seen(s,team,e){if(e.team===team)return true;const c=center(e);if(!inside(s,c.x,c.y))return false;if(s.visible[team][cell(s,c.x,c.y)])return true;if(e.kind==='building')for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)if(s.visible[team][y*s.width+x])return true;return false;}

// Placement validation in two parts: position-independent checks evaluated once, and a
// per-cell check for planners that test many cells of one unchanged state. Reasons and
// their order are exactly those of canPlace.
export function placementCheck(s,team,type){
  const {width:W,height:H}=s,d=BUILDINGS[type];
  let rejected='',unavailable='';
  if(s.status!=='playing')rejected='Operation has ended';
  else if(!d||![0,1].includes(team))rejected='Unknown structure';
  else if(d.race!=='both'&&d.race!==teamRace(s,team))rejected='Structure belongs to a different race';
  else if(!missionAllows(s,team,'buildings',buildingRole(type)))rejected='Not authorized for this operation';
  else{
    const missing=d.requires.find(key=>!completed(s,team,key));
    if(buildingRole(type)==='core')unavailable='Deploy a nexus construction vehicle to establish a new nexus';
    else if(s.teams[team].credits<d.cost)unavailable='Insufficient credits';
    else if(missing)unavailable=`Requires ${BUILDINGS[missing].name}`;
    else if(buildingRole(type)==='refinery'&&reservedUnits(s,team)>=unitCapacity(s,team))unavailable=`Unit limit reached (${unitCapacity(s,team)}); refinery includes a hauler`;
  }
  let unitChecks=0,unitTiles=null,finished=null,walls=null;
  // One check scans every unit; repeated checks bucket units by tile once. A unit
  // strictly inside the widened footprint lies in a tile from x-1 to x+size.
  const unitInArea=(x,y)=>{
    const inArea=e=>e.x>x-.3&&e.x<x+d.size+.3&&e.y>y-.3&&e.y<y+d.size+.3;
    if(!unitChecks++)return s.entities.some(e=>alive(e)&&e.kind==='unit'&&inArea(e));
    if(!unitTiles){
      unitTiles=new Map();
      for(const e of s.entities)if(alive(e)&&e.kind==='unit'){const key=bucketKey(Math.floor(e.x),Math.floor(e.y));if(!unitTiles.has(key))unitTiles.set(key,[]);unitTiles.get(key).push(e);}
    }
    for(let yy=y-1;yy<=y+d.size;yy++)for(let xx=x-1;xx<=x+d.size;xx++){const tile=unitTiles.get(bucketKey(xx,yy));if(tile&&tile.some(inArea))return true;}
    return false;
  };
  return(x,y)=>{
    if(rejected)return bad(rejected);
    if(!Number.isFinite(x)||!Number.isFinite(y)||x!==Math.floor(x)||y!==Math.floor(y))return bad('Place on the ground grid');
    if(unavailable)return bad(unavailable);
    if(x<1||y<1||x+d.size>=W||y+d.size>=H)return bad('Outside construction zone');
    rebuildNavigation(s);
    for(let yy=y;yy<y+d.size;yy++)for(let xx=x;xx<x+d.size;xx++){
      const i=yy*W+xx;if(!s.visible[team][i])return bad('Requires sensor coverage');if(s.terrain[i]===3)return bad('Lava prevents construction');if(s.terrain[i]===4)return bad('Tree roots obstruct construction');if(s.terrain[i]===5)return bad('Crater ground cannot support construction');if(s.blocked[i])return bad('Ground is obstructed');if(s.minerals[i]>0)return bad('Shard field obstructs construction');
    }
    if(unitInArea(x,y))return bad('Unit in construction area');
    finished??=own(s,team).filter(e=>e.kind==='building'&&e.progress>=1);
    walls??=buildingRole(type)==='wall'?own(s,team).filter(e=>e.kind==='building'&&buildingRole(e)==='wall'):[];
    const nearFinished=finished.some(e=>Math.hypot(Math.max(e.x-x-d.size,x-e.x-e.size,0),Math.max(e.y-y-d.size,y-e.y-e.size,0))<=7);
    const extendsWall=walls.some(e=>Math.abs(e.x-x)+Math.abs(e.y-y)===1);
    if(!nearFinished&&!extendsWall)return bad('Build within 7 tiles of a finished structure');
    return good();
  };
}
export function canPlace(s,team,type,x,y){return placementCheck(s,team,type)(x,y);}
export function placeBuilding(s,team,type,x,y){
  const result=canPlace(s,team,type,x,y);if(!result.ok)return result;
  s.teams[team].credits-=BUILDINGS[type].cost;tally(s,team,'spent',BUILDINGS[type].cost);tally(s,team,'built');
  const entity=addEntity(s,team,'building',type,x,y,false);event(s,`${BUILDINGS[type].name}: construction started`,team,{kind:'placed',...subject(entity)});return{...result,id:entity.id};
}
export function deploymentStatus(s,team,unitId,x,y){
  if(s.status!=='playing')return bad('Operation has ended');
  const u=getEntity(s,unitId);
  if(![0,1].includes(team)||!u||u.team!==team||u.kind!=='unit'||unitRole(u)!=='constructor')return bad('Select your nexus construction vehicle');
  if(!Number.isInteger(x)||!Number.isInteger(y))return bad('Place on the ground grid');
  const d=BUILDINGS[raceBuilding(s,team,'core')];
  if(x<1||y<1||x+d.size>=s.width||y+d.size>=s.height)return bad('Outside construction zone');
  if(s.mission){const reason=missionDeployment(s,team,x+d.size/2,y+d.size/2);if(reason)return bad(reason);}
  if(distance(u,{x:x+d.size/2,y:y+d.size/2})>NEXUS_DEPLOY_RANGE)return bad(`Deploy within ${NEXUS_DEPLOY_RANGE} tiles of the construction vehicle`);
  rebuildNavigation(s);
  // Check exploration first so an invalid preview cannot disclose unseen ground.
  for(let yy=y;yy<y+d.size;yy++)for(let xx=x;xx<x+d.size;xx++)if(!s.explored[team][yy*s.width+xx])return bad('Explore the deployment site first');
  for(let yy=y;yy<y+d.size;yy++)for(let xx=x;xx<x+d.size;xx++){
    const i=yy*s.width+xx;
    if(s.terrain[i]===3)return bad('Lava prevents construction');if(s.terrain[i]===4)return bad('Tree roots obstruct construction');if(s.terrain[i]===5)return bad('Crater ground cannot support construction');if(s.blocked[i])return bad('Ground is obstructed');if(s.minerals[i]>0)return bad('Shard field obstructs construction');
  }
  if(s.entities.some(e=>e!==u&&alive(e)&&e.kind==='unit'&&e.x>x-.3&&e.x<x+d.size+.3&&e.y>y-.3&&e.y<y+d.size+.3))return bad('Unit in construction area');
  return good();
}
export function deployNexus(s,team,unitId,x,y){
  const result=deploymentStatus(s,team,unitId,x,y);if(!result.ok)return result;
  const u=getEntity(s,unitId),integrity=clamp(u.hp/u.maxHp,0,1),type=raceBuilding(s,team,'core');
  const nexus=addEntity(s,team,'building',type,x,y,false);nexus.hp*=integrity;
  // Deployment is an exchange, so full armies can expand without reserving another unit slot.
  s.entities=s.entities.filter(e=>e!==u);
  tally(s,team,'built');event(s,`${BUILDINGS[type].name}: deployment started`,team,{kind:'deployed',...subject(nexus)});
  checkOutcome(s,team,'constructor');
  return{...good(),id:nexus.id};
}
// Four-connected stair steps make diagonal drags solid, without corner-sized holes.
function wallLineCells(x1,y1,x2,y2){
  const reverse=x1>x2||x1===x2&&y1>y2;
  if(reverse)[x1,y1,x2,y2]=[x2,y2,x1,y1];
  const dx=Math.abs(x2-x1),dy=Math.abs(y2-y1),sx=Math.sign(x2-x1),sy=Math.sign(y2-y1),cells=[{x:x1,y:y1}];
  let x=x1,y=y1,nx=0,ny=0;
  while(nx<dx||ny<dy){
    if(ny===dy||nx<dx&&(nx+.5)*dy<=(ny+.5)*dx){x+=sx;nx++;}else{y+=sy;ny++;}
    cells.push({x,y});
  }
  return reverse?cells.reverse():cells;
}
export function planWallLine(s,team,x1,y1,x2,y2){
  const empty=reason=>({ok:false,reason,cells:[],count:0,cost:0,affordable:false,truncated:false});
  if(![0,1].includes(team)||![x1,y1,x2,y2].every(Number.isFinite))return empty('Choose two ground cells');
  [x1,y1,x2,y2]=[x1,y1,x2,y2].map(Math.floor);
  if(x1<1||x2<1||y1<1||y2<1||x1>=s.width-1||x2>=s.width-1||y1>=s.height-1||y2>=s.height-1)return empty('Outside construction zone');
  const all=wallLineCells(x1,y1,x2,y2),raw=all.slice(0,48),cost=BUILDINGS.wall.cost,cells=[],check=placementCheck(s,team,'wall');
  let remaining=s.teams[team].credits,reason='',count=0;
  for(const point of raw){
    let result=reason?bad('Previous segment is unavailable'):check(point.x,point.y);
    // A valid preceding segment supplies construction adjacency without altering the real battlefield.
    if(!result.ok&&result.reason==='Build within 7 tiles of a finished structure'&&count>0)result=good();
    if(result.ok&&remaining<cost)result=bad('Insufficient credits for the next wall segment');
    if(result.ok){remaining-=cost;count++;}else if(!reason)reason=result.reason;
    cells.push({...point,...result,cost});
  }
  const truncated=all.length>48;if(!reason&&truncated)reason='Maximum 48 wall segments per drag';
  return{ok:!reason,reason,cells,count,cost:count*cost,affordable:s.teams[team].credits>=raw.length*cost,truncated};
}
export function buildWallLine(s,team,x1,y1,x2,y2){
  const plan=planWallLine(s,team,x1,y1,x2,y2),ids=[];let reason=plan.reason;
  for(const segment of plan.cells){
    if(!segment.ok)break;
    const eventsBefore=s.events.length,result=placeBuilding(s,team,'wall',segment.x,segment.y);
    if(!result.ok){reason=result.reason;break;}
    ids.push(result.id);s.events.splice(eventsBefore); // Summarize one drag with one event.
  }
  const cost=ids.length*BUILDINGS.wall.cost;
  if(ids.length)event(s,`${ids.length} wall segment${ids.length===1?'':'s'} started: ${cost} credits`,team,{kind:'walls',...subject(getEntity(s,ids[ids.length>>1]))});
  return{ok:ids.length>0,count:ids.length,cost,reason,ids};
}

export function toggleRepair(s,id,team=0){
  if(s.status!=='playing')return bad('Operation has ended');
  const e=getEntity(s,id);
  if(!e||e.kind!=='building'||e.team!==team||![0,1].includes(team))return bad('Select one of your structures');
  if(e.progress<1)return bad('Finish construction before repairing');
  if(e.hp>=e.maxHp){e.repairing=false;return bad('Structure is at full integrity');}
  e.repairing=!e.repairing;return{...good(),repairing:e.repairing};
}
export function salvageValue(e){
  if(e?.kind!=='building'||entityRole(e)==='core'||!alive(e))return 0;
  // A deployed included hauler survives the sale; its value cannot be cashed out again.
  const cost=BUILDINGS[e.type].cost-(entityRole(e)==='refinery'&&!e.haulerPending?UNITS.harvester.cost:0)+Object.keys(e.upgrades||{}).reduce((sum,id)=>sum+BUILDING_UPGRADES[id].cost,0);
  return Math.floor(cost*.5*clamp(e.hp/e.maxHp,0,1)+1e-8)+e.queue.reduce((sum,q)=>sum+UNITS[q.type].cost,0)+(e.research?RESEARCH[e.research.id].cost:0)+(e.upgrade?BUILDING_UPGRADES[e.upgrade.id].cost:0);
}
export function sellBuilding(s,id,team=0){
  if(s.status!=='playing')return bad('Operation has ended');
  const e=getEntity(s,id);
  if(!e||e.kind!=='building'||e.team!==team||![0,1].includes(team))return bad('Select one of your structures');
  if(entityRole(e)==='core')return bad('The command nexus cannot be sold');
  const refund=salvageValue(e);s.teams[team].credits+=refund;
  s.entities=s.entities.filter(entity=>entity!==e);s.navVersion++;
  for(const hauler of s.entities)if(hauler.unloadDepotId===id){hauler.unload=0;hauler.unloadDepotId=null;hauler.path=[];hauler.repath=0;}
  event(s,`${BUILDINGS[e.type].name} sold: +${refund} credits`,team,{kind:'sold',...subject(e),amount:refund});
  checkOutcome(s,team,entityRole(e));
  return{...good(),refund};
}
export function trainUnit(s,team,type,producerId){
  const d=UNITS[type];if(s.status!=='playing')return bad('Operation has ended');if(!d||![0,1].includes(team))return bad('Unknown unit');
  if(d.race!==teamRace(s,team))return bad('Unit belongs to a different race');
  if(!missionAllows(s,team,'units',unitRole(type)))return bad('Not authorized for this operation');
  if(s.teams[team].credits<d.cost)return bad('Insufficient credits');
  const producers=own(s,team,d.producer).filter(e=>e.kind==='building'&&e.progress>=1&&(producerId===undefined||e.id===producerId));
  if(!producers.length)return bad(producerId===undefined?`Requires ${BUILDINGS[d.producer].name}`:'Selected producer unavailable');
  if(d.requires.some(key=>!completed(s,team,key)))return bad('Technology unavailable');
  if(d.research&&!s.teams[team].research?.[d.research])return bad(`Requires ${RESEARCH[d.research].name}`);
  const remaining=e=>e.queue.reduce((seconds,q)=>seconds+UNITS[q.type].trainTime*(1-q.progress),0);
  if(unitRole(type)==='striker'&&!producers.some(e=>e.upgrades?.advancedProduction))return bad('Requires Advanced assembly bay at the foundry');
  const producer=producers.filter(e=>e.queue.length<6&&(unitRole(type)!=='striker'||e.upgrades?.advancedProduction)).sort((a,b)=>remaining(a)-remaining(b)||a.id-b.id)[0];
  if(!producer)return bad('Production queue full');
  if(reservedUnits(s,team)>=unitCapacity(s,team))return bad(`Unit limit reached (${unitCapacity(s,team)}); deploy another nexus`);
  s.teams[team].credits-=d.cost;tally(s,team,'spent',d.cost);producer.queue.push({type,progress:0});return good();
}
// Removes one queued unit, including the one in training, and refunds its full price.
export function cancelTraining(s,team,producerId,index){
  if(s.status!=='playing')return bad('Operation has ended');
  const e=getEntity(s,producerId);
  if(![0,1].includes(team)||!e||e.team!==team||e.kind!=='building')return bad('Select your production building');
  if(!Number.isInteger(index)||index<0||index>=e.queue.length)return bad('No unit at that queue position');
  const [q]=e.queue.splice(index,1),refund=UNITS[q.type].cost;s.teams[team].credits+=refund;tally(s,team,'spent',-refund);
  event(s,`${UNITS[q.type].name} training cancelled: +${refund} credits`,team,{kind:'trainingCancelled',...subject(e),amount:refund});
  return{...good(),refund,type:q.type};
}

export function setRallyPoint(s,team,ids,point){
  if(s.status!=='playing')return bad('Operation has ended');
  if(![0,1].includes(team)||!Array.isArray(ids)||!ids.length)return bad('Select a production building');
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||!inside(s,point.x,point.y))return bad('Rally point outside the sector');
  const producers=[...new Set(ids)].map(id=>getEntity(s,id));
  if(producers.some(e=>!e||e.team!==team||e.kind!=='building'||!['barracks','factory','refinery'].includes(entityRole(e))))return bad('Select your barracks, foundries, or refineries');
  for(const e of producers)e.rally={x:point.x,y:point.y};
  return good();
}

function movementDestinations(s,units,x,y,formation){
  rebuildNavigation(s);
  const members=[...units].sort((a,b)=>a.id-b.id),selected=new Set(members.map(u=>u.id)),occupied=new Map(),assigned=new Map();
  let groupId=2166136261;for(const u of members)groupId=Math.imul(groupId^u.id,16777619)>>>0;
  const occupy=p=>{const key=bucketKey(Math.floor(p.x/2),Math.floor(p.y/2));if(!occupied.has(key))occupied.set(key,[]);occupied.get(key).push(p);};
  for(const e of s.entities)if(alive(e)&&e.kind==='unit'&&!selected.has(e.id)){
    if(e.team===units[0].team&&['move','attackMove'].includes(e.order.type))occupy({...e.order,size:e.size});
    else if((e.order.type==='idle'||!e.moving)&&seen(s,units[0].team,e))occupy(e);
  }
  const free=(p,size,region,margin=0)=>{
    if(!inside(s,p.x,p.y)||s.regions[cell(s,p.x,p.y)]!==region||!region||!walkable(s,p.x,p.y,size*.43+.08))return false;
    const cx=Math.floor(p.x/2),cy=Math.floor(p.y/2);
    for(let yy=cy-1;yy<=cy+1;yy++)for(let xx=cx-1;xx<=cx+1;xx++){const near=occupied.get(bucketKey(xx,yy));if(near)for(const e of near)if(sq(p.x-e.x)+sq(p.y-e.y)<sq((size+e.size)*.43+margin)-1e-10)return false;}
    return true;
  };
  const preserve=Number.isFinite(formation?.angle),angle=preserve?Math.atan2(Math.sin(formation.angle),Math.cos(formation.angle)):0;
  const facing=preserve&&Number.isFinite(formation.facing)?Math.atan2(Math.sin(formation.facing),Math.cos(formation.facing)):undefined;
  const reserve=(u,p,offset)=>{
    const layout=offset?{x,y,dx:offset.x,dy:offset.y,angle,compact:false,group:groupId,...(facing!==undefined?{facing}:{})}:{x,y,dx:p.x-x,dy:p.y-y,compact:true,group:groupId};
    const goal={x:p.x,y:p.y,...(units.length>1||preserve?{formation:layout}:{})};
    assigned.set(u.id,goal);
  };
  // Single-unit orders retain precise clicks and the nearest clear tile fallback.
  // Only a group rally needs the wider spacing of compact flock destinations.
  if(preserve||units.length===1){
    const cx=units.reduce((sum,u)=>sum+u.x,0)/units.length,cy=units.reduce((sum,u)=>sum+u.y,0)/units.length;
    const supplied=Array.isArray(formation?.offsets)?new Map(formation.offsets.filter(p=>p&&Number.isInteger(p.id)&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=s.width&&Math.abs(p.y)<=s.height).map(p=>[p.id,p])):null;
    const fixed=supplied&&units.every(u=>supplied.has(u.id)),cos=Math.cos(angle),sin=Math.sin(angle);
    const plans=members.map(u=>{
      const previous=u.order.formation,reuse=!fixed&&previous&&!previous.compact&&previous.group===groupId&&previous.x===x&&previous.y===y&&previous.angle===angle;
      const offset=fixed?supplied.get(u.id):reuse?{x:previous.dx,y:previous.dy}:{x:u.x-cx,y:u.y-cy};
      return{u,offset,reuse,region:s.regions[cell(s,u.x,u.y)],desired:{x:x+offset.x*cos-offset.y*sin,y:y+offset.x*sin+offset.y*cos}};
    });
    const park=(plan,p)=>{reserve(plan.u,p,plan.offset);occupy({...p,size:plan.u.size});};
    for(const p of plans)if(p.reuse&&free(p.u.order,p.u.size,p.region))park(p,p.u.order);
    for(const p of plans)if(!assigned.has(p.u.id)&&free(p.desired,p.u.size,p.region))park(p,p.desired);
    // Preserve every unobstructed rotated position first. Only blocked members
    // move to nearby reachable ground, so one bad slot cannot reshape the group.
    for(const p of plans)if(!assigned.has(p.u.id)){
      const tx=clamp(Math.floor(p.desired.x),0,s.width-1),ty=clamp(Math.floor(p.desired.y),0,s.height-1);
      let best=null,bestScore=Infinity,bestCell=Infinity;
      const consider=(xx,yy)=>{
        if(!inside(s,xx,yy))return;
        const i=yy*s.width+xx;if(s.blocked[i]||s.regions[i]!==p.region)return;
        const goal={x:xx+.5,y:yy+.5},score=sq(goal.x-p.desired.x)+sq(goal.y-p.desired.y);
        if(score>bestScore||score===bestScore&&i>=bestCell||!free(goal,p.u.size,p.region))return;
        best=goal;bestScore=score;bestCell=i;
      };
      for(let r=0;r<Math.max(s.width,s.height);r++){
        const left=tx-r,right=tx+r,top=ty-r,bottom=ty+r;
        for(let xx=left;xx<=right;xx++){consider(xx,top);if(r)consider(xx,bottom);}
        for(let yy=top+1;yy<bottom;yy++){consider(left,yy);if(r)consider(right,yy);}
        if(best){
          const outside=Math.min(left>0?Math.abs(p.desired.x-(left-.5)):Infinity,right<s.width-1?Math.abs(right+1.5-p.desired.x):Infinity,
            top>0?Math.abs(p.desired.y-(top-.5)):Infinity,bottom<s.height-1?Math.abs(bottom+1.5-p.desired.y):Infinity);
          if(sq(outside)>bestScore+1e-10)break;
        }
      }
      if(best)park(p,best);
    }
    return assigned;
  }
  // A group click reserves a compact rally area, independent of how far apart
  // its selected units started.
  const groups=new Map();
  for(const u of members){
    const region=s.regions[cell(s,u.x,u.y)],previous=u.order.formation;
    // New orders migrate older, rigid formation saves. Repeating a compact
    // rally keeps its reservations even after some units arrive or detour.
    if(units.length>1&&previous?.compact&&previous.group===groupId&&previous.x===x&&previous.y===y&&free(u.order,u.size,region)){
      reserve(u,u.order);occupy({...u.order,size:u.size});continue;
    }
    if(!groups.has(region))groups.set(region,{units:[],slots:[],size:0});
    const group=groups.get(region);group.units.push(u);group.size=Math.max(group.size,u.size);
  }
  if(!groups.size)return assigned;
  const maxSize=Math.max(...[...groups.values()].map(g=>g.size)),spacing=maxSize*1.72+.25,row=spacing*Math.sqrt(3)/2;
  const unfilled=()=>[...groups.values()].some(g=>g.slots.length<g.units.length);
  const collect=points=>{
    points.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);
    for(const p of points){
      const region=s.regions[cell(s,p.x,p.y)],group=groups.get(region);
      if(!group||group.slots.length===group.units.length)continue;
      // Leave enough space for late arrivals to pass between parked bodies,
      // including their stopping tolerance, rather than sealing the army's rim.
      const margin=units.length>1?group.size*.86+.25:0;
      if(!free(p,group.size,region,margin))continue;
      group.slots.push(p);occupy({...p,size:group.size});
    }
  };
  // Candidates are claimed in (distance, y, x) order. Doubling distance bands partition
  // them by exact score, which keeps that order while a filled rally skips the rest of
  // the map. Each enumeration covers a box one tile wider than its band.
  const reach=Math.hypot(Math.max(x,s.width-x),Math.max(y,s.height-y));
  const sweep=enumerate=>{
    for(let low=-Infinity,radius=spacing*(2+Math.sqrt(units.length));unfilled();radius*=2){
      const last=radius>=reach,high=last?Infinity:radius*radius,band=[];
      enumerate(last?Infinity:radius+1,(px,py)=>{const score=sq(px-x)+sq(py-y);if(score>=low&&score<high)band.push({x:px,y:py,score});});
      collect(band);if(last)return;low=high;
    }
  };
  // Hex rows around the click, limited to the map and the groups' regions.
  sweep((limit,visit)=>{
    for(let j=Math.max(Math.ceil(-y/row),Math.ceil(-limit/row));j<=Math.min((s.height-y)/row,limit/row);j++){
      const shift=(j&1)*spacing/2,py=y+j*row;
      for(let i=Math.max(Math.ceil((-x-shift)/spacing),Math.ceil((-limit-shift)/spacing));i<=Math.min((s.width-x-shift)/spacing,(limit-shift)/spacing);i++){
        const px=x+i*spacing+shift;
        if(inside(s,px,py)&&groups.has(s.regions[cell(s,px,py)]))visit(px,py);
      }
    }
  });
  // Narrow terrain may miss every hex row. Tile centers provide a bounded,
  // reachable fallback in corridors, disconnected pockets and clipped corners.
  if(unfilled())sweep((limit,visit)=>{
    for(let ty=Math.max(0,Math.floor(y-limit));ty<=Math.min(s.height-1,y+limit);ty++)for(let tx=Math.max(0,Math.floor(x-limit));tx<=Math.min(s.width-1,x+limit);tx++){
      const i=ty*s.width+tx;if(!s.blocked[i]&&groups.has(s.regions[i]))visit(tx+.5,ty+.5);
    }
  });
  // Match spatial ranks recursively. This keeps broad left/right and front/back
  // relationships without copying the source gaps or doing a cubic assignment.
  const match=(members,slots)=>{
    if(!slots.length)return;
    if(slots.length===1){reserve(members[0],slots[0]);return;}
    const span=axis=>Math.max(...slots.map(p=>p[axis]))-Math.min(...slots.map(p=>p[axis]));
    const axis=span('x')>=span('y')?'x':'y',other=axis==='x'?'y':'x';
    members.sort((a,b)=>a[axis]-b[axis]||a[other]-b[other]||a.id-b.id);
    slots.sort((a,b)=>a[axis]-b[axis]||a[other]-b[other]);
    const half=Math.floor(slots.length/2);
    match(members.slice(0,half),slots.slice(0,half));match(members.slice(half),slots.slice(half));
  };
  for(const group of groups.values())match(group.units.slice(0,group.slots.length),group.slots);
  return assigned;
}
function clearTrafficOrder(u){
  for(const key of ['trafficWait','passUntil','passTargetId','avoidUntil','trafficBlockedAt','crowdPlanAt','yieldReturn','yieldPoint','yieldFor','yieldWaiting','formationReady'])delete u[key];
}
export function issueOrder(s,ids,order){
  const {width:W,height:H}=s;
  if(!order||!['move','attack','attackMove','attackmove','harvest','explore'].includes(order.type))return;
  const selectedIds=[...new Set(ids)],lookup=selectedIds.length>32?new Map(s.entities.filter(alive).map(e=>[e.id,e])):null;
  const units=selectedIds.map(id=>lookup?lookup.get(id):getEntity(s,id)).filter(e=>e?.kind==='unit');
  const plans=units.map(u=>{
    let x=Number.isFinite(order.x)?clamp(order.x,.5,W-.5):u.x,y=Number.isFinite(order.y)?clamp(order.y,.5,H-.5):u.y;
    const target=getEntity(s,order.targetId);if(target&&seen(s,u.team,target)){const c=center(target);x=c.x;y=c.y;}
    const type=entityRole(u)==='harvester'&&!['harvest','explore'].includes(order.type)?'move':order.type==='attackmove'?'attackMove':order.type;
    return{u,type,x,y,target:target&&seen(s,u.team,target)?target.id:null};
  });
  const groups=new Map();
  for(const p of plans)if(p.type==='move'||p.type==='attackMove'){const key=`${p.x},${p.y}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
  for(const group of groups.values()){
    const preserve=Number.isFinite(order.formationAngle),formation=preserve?{angle:order.formationAngle,offsets:order.formationOffsets,facing:order.facing}:undefined;
    const goals=movementDestinations(s,group.map(p=>p.u),group[0].x,group[0].y,formation);
    const pace=preserve&&group.length>1?Math.min(...group.map(p=>unitStats(p.u).speed)):undefined;
    const turnPace=preserve&&group.length>1?Math.min(...group.map(p=>movementTurnRate(p.u))):undefined;
    for(const p of group){const goal=goals.get(p.u.id);if(goal){p.x=goal.x;p.y=goal.y;p.formation=goal.formation;p.speedLimit=pace;p.turnRateLimit=turnPace;p.facing=preserve&&Number.isFinite(order.facing)?Math.atan2(Math.sin(order.facing),Math.cos(order.facing)):undefined;}else p.type=entityRole(p.u)==='harvester'?'harvest':'idle';}
  }
  plans.forEach(({u,type,x,y,target,formation,speedLimit,turnRateLimit,facing})=>{
    clearDefendState(u);
    const previous=u.order.formation,sameFormation=previous?.group===formation?.group&&previous?.compact===formation?.compact&&previous?.angle===formation?.angle&&previous?.x===formation?.x&&previous?.y===formation?.y;
    const unchanged=!u.yieldReturn&&sameFormation&&u.order.type===type&&u.order.x===x&&u.order.y===y&&u.order.facing===facing&&(u.order.targetId??null)===target;
    if(!unchanged)clearTrafficOrder(u);
    u.order=type==='explore'||type==='idle'||type==='harvest'&&order.type!=='harvest'?{type}:{type,x,y,...(target?{targetId:target}:{}),...(formation?{formation}:{}),...(speedLimit?{speedLimit}:{}),...(turnRateLimit?{turnRateLimit}:{}),...(facing!==undefined?{facing}:{})};
    if(unchanged)return;
    endHeldAbility(u);u.targetId=null;u.path=[];u.repath=0;
    if(entityRole(u)==='harvester'){u.unloadDepotId=null;if(u.cargo>=UNITS.harvester.capacity)u.harvestPhase='return';}
  });
}
export function stopUnits(s,ids){for(const id of ids){const u=getEntity(s,id);if(u?.kind==='unit'){u.order={type:entityRole(u)==='harvester'?'harvest':'idle'};u.targetId=null;u.path=[];u.repath=0;clearTrafficOrder(u);clearDefendState(u);if(entityRole(u)==='harvester')u.unloadDepotId=null;}}}

// Lights every cell whose centre lies within r of c, for one team's current and explored fog.
function lightDisc(s,v,explored,c,r){
  const {width:W,height:H}=s;
  // Each row of a disc is one contiguous span. Estimate its ends with sqrt, then settle
  // them with the original cell-centre test so every boundary cell matches exactly.
  const r2=r*r,lit=(x,dy2)=>sq(x+.5-c.x)+dy2<=r2;
  for(let y=Math.max(0,Math.floor(c.y-r));y<=Math.min(H-1,c.y+r);y++){
    const dy2=sq(y+.5-c.y);if(dy2>r2)continue;
    const half=Math.sqrt(r2-dy2);let a=Math.max(0,Math.ceil(c.x-.5-half)),b=Math.min(W-1,Math.floor(c.x-.5+half));
    while(a>0&&lit(a-1,dy2))a--;while(a<=b&&!lit(a,dy2))a++;
    while(b<W-1&&lit(b+1,dy2))b++;while(b>=a&&!lit(b,dy2))b--;
    if(a<=b){v.fill(1,y*W+a,y*W+b+1);explored.fill(1,y*W+a,y*W+b+1);}
  }
}
function updateFog(s){
  // Ability reveals (flares) light ground for their own team only, until they expire.
  if(s.reveals){s.reveals=s.reveals.filter(r=>r.until>s.time);if(!s.reveals.length)delete s.reveals;}
  for(let team=0;team<2;team++){
    const v=s.visible[team],explored=s.explored[team];v.fill(0);
    for(const e of own(s,team))lightDisc(s,v,explored,center(e),e.progress<1?4:definition(e).sight);
    if(s.reveals)for(const r of s.reveals)if(r.team===team)lightDisc(s,v,explored,r,r.r);
  }
  for(const team of s.aiTeams||[1]){
    const ai=aiState(s,team);if(!ai)continue;
    for(const e of s.entities)if(e.team!==team&&alive(e)&&seen(s,team,e)){const c=center(e);ai.known[e.id]={id:e.id,kind:e.kind,type:e.type,x:c.x,y:c.y,hp:e.hp,seenAt:s.time};}
    for(const [id,m] of Object.entries(ai.known))if(s.visible[team][cell(s,m.x,m.y)]){const e=getEntity(s,Number(id));if(!e||!seen(s,team,e))delete ai.known[id];}
  }
}

// A* searches static terrain/buildings. Units use local separation instead of blocking routes.
// A fixed search budget spreads obstructed army orders across ticks; direct open routes bypass A*.
let pathBudget=16,scratch={N:0};
function findPath(s,u,tx,ty,stop=0){
  if(clearStep(s,u,tx,ty))return[{x:tx,y:ty}];
  if(pathBudget<=0)return null;pathBudget--;
  const {width:W,height:H}=s,N=W*H,blocked=s.blocked;
  const start=cell(s,u.x,u.y),goalX=clamp(Math.floor(tx),0,W-1),goalY=clamp(Math.floor(ty),0,H-1);
  if(scratch.N!==N)scratch={N,costs:new Float32Array(N),parent:new Int32Array(N),heuristic:new Float64Array(N),opened:new Uint32Array(N),closed:new Uint32Array(N),generation:0,heapCells:[],heapScores:[]};
  // Generation stamps replace whole-map resets: a cell's cost, parent and heuristic
  // belong to this search only once it is opened with the current generation.
  if(scratch.generation===0xffffffff){scratch.opened.fill(0);scratch.closed.fill(0);scratch.generation=0;}
  const {costs,parent,heuristic,opened,closed,heapCells,heapScores}=scratch,generation=++scratch.generation;let heapSize=0;
  // Reuse numeric heap storage instead of allocating two objects per insertion.
  // Comparisons and left/right tie handling remain identical to the original A*.
  const push=(i,f)=>{
    let p=heapSize++;while(p){const q=(p-1)>>1;if(heapScores[q]<=f)break;heapCells[p]=heapCells[q];heapScores[p]=heapScores[q];p=q;}
    heapCells[p]=i;heapScores[p]=f;
  };
  const pop=()=>{
    const out=heapCells[0],last=heapCells[--heapSize],score=heapScores[heapSize];
    if(heapSize){let p=0;while(p*2+1<heapSize){let q=p*2+1;if(q+1<heapSize&&heapScores[q+1]<heapScores[q])q++;if(heapScores[q]>=score)break;heapCells[p]=heapCells[q];heapScores[p]=heapScores[q];p=q;}heapCells[p]=last;heapScores[p]=score;}
    return out;
  };
  // insideMovementLeash, with the stance and range resolved once per search.
  const leashAnchor=u.defendAnchor&&effectiveUnitStance(u)==='defend'?u.defendAnchor:null,leash=leashAnchor?unitStats(u).range+1e-8:0;
  let best=start,bestH=Math.hypot(start%W+.5-tx,Math.floor(start/W)+.5-ty),count=0;
  opened[start]=generation;costs[start]=0;parent[start]=-1;heuristic[start]=bestH;push(start,bestH);
  while(heapSize&&count++<N){
    const cur=pop();if(closed[cur]===generation)continue;closed[cur]=generation;
    const h=heuristic[cur];if(h<bestH){best=cur;bestH=h;}
    const x=cur%W,y=Math.floor(cur/W);if(stop>=.2&&h<=Math.max(.75,stop)||(x===goalX&&y===goalY)){best=cur;break;}
    const cost=costs[cur];
    for(let dy=-1;dy<=1;dy++){
      const yy=y+dy;if(yy<0||yy>=H)continue;
      for(let dx=-1;dx<=1;dx++){
        const xx=x+dx;if(!dx&&!dy||xx<0||xx>=W)continue;
        const next=yy*W+xx;if(blocked[next]||closed[next]===generation||(dx&&dy&&(blocked[y*W+xx]||blocked[yy*W+x])))continue;
        if(leashAnchor&&!(Math.hypot(xx+.5-leashAnchor.x,yy+.5-leashAnchor.y)<=leash))continue;
        const g=cost+(dx&&dy?1.4142:1);if(opened[next]===generation&&g>=costs[next])continue;
        const estimate=Math.hypot(xx+.5-tx,yy+.5-ty);opened[next]=generation;costs[next]=g;parent[next]=cur;heuristic[next]=estimate;push(next,g+estimate);
      }
    }
  }
  const path=[];for(let at=best;at!==start&&at>=0;at=parent[at])path.push({x:at%W+.5,y:Math.floor(at/W)+.5});path.reverse();
  if(stop<.2&&insideMovementLeash(u,tx,ty)&&clearStep(s,path.at(-1)||u,tx,ty))path.push({x:tx,y:ty});
  // Curved travel can stop off-center beside an inside corner. Grid A* starts
  // at the cell center, so explicitly reconnect the actual pose to that center.
  if(path.length&&!clearStep(s,u,path[0].x,path[0].y)){
    const startCenter={x:start%W+.5,y:Math.floor(start/W)+.5};
    if(clearStep(s,u,startCenter.x,startCenter.y))path.unshift(startCenter);
  }
  // Long straight grid runs share one bend candidate, avoiding repeated long swept checks.
  const bends=path.filter((p,i)=>!i||i===path.length-1||
    (p.x-path[i-1].x)*(path[i+1].y-p.y)!==(p.y-path[i-1].y)*(path[i+1].x-p.x));
  // Extend each clear leg until the next bend is blocked; don't rescan the distant route per corner.
  const route=[];let anchor=u;
  for(let i=0;i<bends.length;){
    let end=i;
    // After the first shortcut, limit extra rays to 12 tiles so full-army detours stay responsive.
    while(end+1<bends.length&&(end===i||distance(anchor,bends[end+1])<=12)&&clearStep(s,anchor,bends[end+1].x,bends[end+1].y))end++;
    anchor=bends[end];route.push(anchor);i=end+1;
  }
  return route;
}

function insideMovementLeash(u,x,y){return !u.defendAnchor||effectiveUnitStance(u)!=='defend'||Math.hypot(x-u.defendAnchor.x,y-u.defendAnchor.y)<=unitStats(u).range+1e-8;}
// True when the summed blocked-tile grid proves no blocked tile touches the rectangle.
function clearRect(s,grid,left,top,right,bottom){
  if(!grid||!(left>=0&&top>=0&&right<s.width&&bottom<s.height))return false;
  const a=grid.sums,x0=Math.floor(left),x1=Math.floor(right)+1,y0=Math.floor(top)*grid.stride,y1=(Math.floor(bottom)+1)*grid.stride;
  return a[y1+x1]-a[y0+x1]-a[y1+x0]+a[y0+x0]===0;
}
function clearStep(s,u,x,y){
  // A circle is convex, so constraining both ends also constrains every swept
  // point. This applies to travel, detours and contact corrections alike.
  if(!insideMovementLeash(u,x,y))return false;
  // An empty expanded rectangle proves every swept footprint clear. The prefix
  // grid also makes long unobstructed routes cheap; occupied rectangles still use
  // exactly the same corner-safe segment checks below.
  const grid=clearanceGrids.get(s);
  if(clearRect(s,grid,Math.min(u.x,x)-.19,Math.min(u.y,y)-.19,Math.max(u.x,x)+.19,Math.max(u.y,y)+.19))return true;
  // Check the whole segment so sidesteps and waypoint shortcuts cannot cut solid corners.
  // Samples are monotonic along the segment, so every corner tested for indices i0..i1
  // lies between the positions at i0-1 and i1. A clear, slightly widened rectangle
  // proves a whole chunk; only chunks touching blocked tiles are sampled.
  const steps=Math.max(1,Math.ceil(Math.hypot(x-u.x,y-u.y)/.12));
  let previousX=u.x,previousY=u.y;
  for(let i0=1;i0<=steps;i0+=12){
    const i1=Math.min(steps,i0+11),ex=u.x+(x-u.x)*i1/steps,ey=u.y+(y-u.y)*i1/steps;
    if(clearRect(s,grid,Math.min(previousX,ex)-.19-1e-9,Math.min(previousY,ey)-.19-1e-9,Math.max(previousX,ex)+.19+1e-9,Math.max(previousY,ey)+.19+1e-9)){previousX=ex;previousY=ey;continue;}
    for(let i=i0;i<=i1;i++){
      const nx=u.x+(x-u.x)*i/steps,ny=u.y+(y-u.y)*i/steps;
      if(!walkable(s,nx,ny)||!walkable(s,nx,previousY)||!walkable(s,previousX,ny))return false;
      previousX=nx;previousY=ny;
    }
  }
  return true;
}
function unitSpacing(a,b,time){return(a.size+b.size)*.43*(a.team===b.team&&(a.passUntil>time&&a.passTargetId===b.id||b.passUntil>time&&b.passTargetId===a.id)?0:1);}

function segmentDistance(a,b,p){
  const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
  return Math.hypot(a.x+dx*t-p.x,a.y+dy*t-p.y);
}
function trafficDetour(s,u,blocker,fx,fy){
  const side=u.steerUntil>s.time?u.steerSide:1;
  let hasRoom=false;
  for(const margin of [.25,.03])for(const direction of [side,-side]){
    const spacing=(u.size+blocker.size)*.43+margin;
    const ox=blocker.x-u.x,oy=blocker.y-u.y;
    const forward=Math.max(0,ox*fx+oy*fy),lateral=ox*-fy+oy*fx;
    const offset=lateral+spacing*direction;
    // First step out of the lane, then continue beyond the body before rejoining.
    const advance=Math.max(0,forward-spacing);
    const detour={x:u.x+fx*advance-fy*offset,y:u.y+fy*advance+fx*offset,flock:true,trafficId:blocker.id};
    const beyond={x:u.x+fx*(forward+spacing)-fy*offset,y:u.y+fy*(forward+spacing)+fx*offset,flock:true,trafficId:blocker.id};
    if(!clearStep(s,u,detour.x,detour.y)||!insideMovementLeash(u,beyond.x,beyond.y)||!clearStep(s,detour,beyond.x,beyond.y))continue;
    const route=u.path.find(p=>!p.flock)||u.path.at(-1);
    if(route&&!clearStep(s,beyond,route.x,route.y))continue;
    hasRoom=true;
    const occupied=nearbyEntities(s,u,4).some(other=>other!==u&&other.kind==='unit'&&alive(other)&&
      segmentDistance(u,detour,other)<Math.min((u.size+other.size)*.43+.03,distance(u,other)-.001));
    if(occupied)continue;
    return{points:[detour,beyond],side:direction};
  }
  return hasRoom?{waiting:true}:null;
}

function yieldParkedAlly(s,u,neighbors){
  for(const other of neighbors){
    const assembling=other.order.type==='move'&&other.formationReady;
    if(other.team!==u.team||!(assembling||other.order.type==='idle'&&!militaryUnit(other))||other.yieldReturn||other.targetId||other.repairActive||distance(u,other)>2)continue;
    const angle=Math.atan2(other.y-u.y,other.x-u.x);
    for(const turn of [0,Math.PI/4,-Math.PI/4]){
      const goal={x:other.x+Math.cos(angle+turn)*1.1,y:other.y+Math.sin(angle+turn)*1.1};
      if(!walkable(s,goal.x,goal.y,other.size*.43+.08)||!clearStep(s,other,goal.x,goal.y))continue;
      if(neighbors.some(body=>body!==other&&segmentDistance(other,goal,body)<(other.size+body.size)*.43+.02))continue;
      // Keep the assigned slot exact across repeated yields; returning within
      // another arrival radius of the stopped position would accumulate drift.
      other.yieldReturn={x:other.order.x??other.x,y:other.order.y??other.y};other.yieldPoint=goal;other.yieldFor=u.id;other.path=[];other.repath=0;
      delete other.formationReady;
      other.order={...other.order,type:'move',x:other.order.x??other.x,y:other.order.y??other.y};
      if(other.order.formation?.facing!==undefined)other.order.facing=other.order.formation.facing;
      return true;
    }
  }
  return false;
}

function movementTurnRate(u){return UNITS[u.type].armor==='infantry'?7:['scout','striker'].includes(entityRole(u))?2.6:1.8;}
function turnUnit(u,heading,dt,aiming=false){
  const infantry=UNITS[u.type].armor==='infantry';
  const delta=Math.atan2(Math.sin(heading-u.angle),Math.cos(heading-u.angle));
  const rate=aiming?(infantry?7:3.2):Math.min(movementTurnRate(u),u.order.turnRateLimit??Infinity);
  if(Math.abs(delta)<.012){u.angle+=clamp(delta,-rate*dt,rate*dt);u.angle=Math.atan2(Math.sin(u.angle),Math.cos(u.angle));u.turnVelocity=0;return;}
  const desired=clamp(delta*5,-rate,rate),acceleration=aiming?(infantry?28:12):rate>2.6?28:7;
  u.turnVelocity=(u.turnVelocity||0)+clamp(desired-(u.turnVelocity||0),-acceleration*dt,acceleration*dt);
  const turn=u.turnVelocity*dt;
  if(Math.sign(turn)===Math.sign(delta)&&Math.abs(turn)>=Math.abs(delta)){u.angle+=delta;u.turnVelocity=0;}
  else u.angle+=turn;
  u.angle=Math.atan2(Math.sin(u.angle),Math.cos(u.angle));
}

function navigate(s,u,tx,ty,dt,stop=.2,movement){
  const precise=stop<.2;
  if(precise&&(!walkable(s,tx,ty,u.size*.43+.08)||s.regions[cell(s,tx,ty)]!==s.regions[cell(s,u.x,u.y)])){
    const goal=movementDestinations(s,[u],tx,ty).get(u.id);if(!goal)return false;
    // Temporary retaliation and yield legs must not rewrite a retained parking
    // reservation. Only an explicit destination can adopt its reachable fallback.
    if(['move','attackMove'].includes(u.order.type)&&u.order.x===tx&&u.order.y===ty){u.order.x=goal.x;u.order.y=goal.y;}
    tx=goal.x;ty=goal.y;u.repath=0;
  }
  if(Math.hypot(tx-u.x,ty-u.y)<=stop+(precise?0:.12)){u.path=[];u.moveSpeed=0;if(u.order.facing===undefined)u.turnVelocity=0;return true;}
  if(u.repath<=0&&!u.path[0]?.flock||u.pathVersion!==s.navVersion||!u.pathGoal||Math.hypot(u.pathGoal.x-tx,u.pathGoal.y-ty)>1.4){
    const found=findPath(s,u,tx,ty,stop);if(!found){u.path=[];return false;}
    u.path=found;u.pathGoal={x:tx,y:ty};u.pathVersion=s.navVersion;u.repath=1.3+random(s)*.6;
  }
  if(!u.path.length){
    if(!precise)return Math.hypot(tx-u.x,ty-u.y)<=Math.max(stop+.8,1.1);
    if(!clearStep(s,u,tx,ty))return false;
    u.path=[{x:tx,y:ty}];
  }
  let p=u.path[0];
  if((u.path.length>1||p.flock)&&distance(u,p)<.1){
    u.path.shift();p=u.path[0];if(!p){u.repath=0;return false;}
  }
  const dx=p.x-u.x,dy=p.y-u.y,d=Math.hypot(dx,dy);
  if(d<1e-6){u.path.shift();return false;}
  // Boids neighbors lie within 4 tiles. When that whole expanded square is free of
  // static blockers, every swept clearStep to them succeeds; only the leash remains.
  const openArea=clearRect(s,clearanceGrids.get(s),u.x-4.2,u.y-4.2,u.x+4.2,u.y+4.2);
  const flock=spatialStates.get(s).flock(u).filter(openArea?other=>insideMovementLeash(u,other.x,other.y):other=>clearStep(s,u,other.x,other.y));
  const steering=flockSteering(u,{x:tx,y:ty},flock,s.time,p);
  let heading=Math.atan2(dy,dx);
  if(steering&&!p.trafficId){
    const look=Math.min(d,.8),lookX=u.x+steering.x*look,lookY=u.y+steering.y*look;
    if(clearStep(s,u,lookX,lookY))heading=Math.atan2(steering.y,steering.x);
  }
  turnUnit(u,heading,dt);
  const headingError=Math.atan2(Math.sin(heading-u.angle),Math.cos(heading-u.angle));
  // Drive along the actual body heading while turning. Slow for sharp bends so
  // vehicle inertia cannot make the body slide sideways or orbit a waypoint.
  const alignment=Math.max(0,Math.cos(headingError));
  const baseSpeed=Math.min(unitStats(u).speed,u.order.speedLimit??Infinity)*abilitySpeed(s,u);
  const fx=Math.cos(u.angle),fy=Math.sin(u.angle),neighbors=nearbyEntities(s,u,4).filter(e=>e!==u&&e.kind==='unit'&&alive(e)&&distance(u,e)<4);
  let followingSpeed=baseSpeed;
  for(const other of neighbors){
    const ox=other.x-u.x,oy=other.y-u.y,forward=ox*fx+oy*fy,lateral=Math.abs(oy*fx-ox*fy),spacing=unitSpacing(u,other,s.time);
    if(!spacing||forward<=0)continue;
    // A newly commanded leader may not have planned its path yet this tick.
    // Its order still describes the convoy; do not mistake it for parked traffic.
    const route=other.path.find(p=>!p.flock)||other.path[0]||other.yieldPoint||(['move','attackMove'].includes(other.order.type)?other.order:null),rx=(route?.x??other.x)-other.x,ry=(route?.y??other.y)-other.y,rd=Math.hypot(rx,ry);
    const formation=['move','attackMove'].includes(u.order.type)?u.order.formation:null;
    const otherFormation=['move','attackMove'].includes(other.order.type)?other.order.formation:null;
    const sameFormation=formation&&otherFormation&&formation.x===otherFormation.x&&formation.y===otherFormation.y;
    // Members of one formation can recognize their common route while turning.
    // Independent traffic must already face the same way before following it.
    const convoy=other.team===u.team&&other.order.type!=='idle'&&rd>.1&&
      (sameFormation?(rx*dx+ry*dy)/(rd*d):(rx*fx+ry*fy)/rd)>.9;
    // An intact formation shares speed and turn limits. Its translated parallel
    // trajectories cannot collide; braking behind diagonal ranks would break
    // that agreement and manufacture congestion on the first movement frame.
    const coherent=convoy&&sameFormation&&!formation.compact&&
      !p.trafficId&&!other.path[0]?.trafficId&&!other.yieldReturn&&Math.hypot(ox-(other.order.x-tx),oy-(other.order.y-ty))<Math.max(.2,baseSpeed*dt*1.5);
    if(coherent)continue;
    if(convoy&&!p.trafficId&&lateral<spacing+.1&&forward>lateral){
      // Follow the leader's speed instead of repeatedly overtaking a slower ally.
      // Nearly side-by-side bodies must not each wait for the other to lead.
      // A committed bypass must not speed-follow the body it is going around.
      followingSpeed=Math.min(followingSpeed,Math.max(0,(other.moveSpeed||0)*(Math.cos(other.angle)*fx+Math.sin(other.angle)*fy)+(forward-spacing-.2)*1.5));
      continue;
    }
    if(u.path[0].trafficId||u.avoidUntil>s.time||forward>Math.min(d,2.8))continue;
    const vx=fx*baseSpeed-(other.moving?Math.cos(other.angle)*(other.moveSpeed||0):0),vy=fy*baseSpeed-(other.moving?Math.sin(other.angle)*(other.moveSpeed||0):0);
    const t=clamp((ox*vx+oy*vy)/(vx*vx+vy*vy||1),0,1.2);
    if(Math.hypot(ox-vx*t,oy-vy*t)>=spacing+.15)continue;
    u.avoidUntil=s.time+.3;
    const detour=trafficDetour(s,u,other,dx/d,dy/d);
    if(detour?.points){
      while(u.path[0]?.flock)u.path.shift();
      u.path.unshift(...detour.points);u.steerSide=detour.side;u.steerUntil=s.time+4;u.moveSpeed=0;
      movement.set(u.id,{x:u.x,y:u.y,dx:0,dy:0,step:0,traffic:false});return false;
    }
  }
  const remaining=Math.min(d,Math.max(0,Math.hypot(tx-u.x,ty-u.y)-stop));
  // The body must be able to turn faster than the bearing to a close waypoint
  // changes. Otherwise a slow-turning vehicle can orbit its tiny final leg.
  const bearingError=Math.atan2(dy,dx)-u.angle;
  const approachRate=Math.min(3,Math.min(movementTurnRate(u),u.order.turnRateLimit??Infinity)*.7/Math.max(.3,Math.abs(Math.sin(bearingError))));
  const targetSpeed=Math.min(followingSpeed,Math.sqrt(remaining*baseSpeed*3),d*approachRate)*alignment*alignment;
  u.moveSpeed=Math.min(targetSpeed,(u.moveSpeed||0)+baseSpeed*2.8*dt);
  const step=Math.min(d,u.moveSpeed*dt);
  const intent={x:u.x,y:u.y,dx:fx,dy:fy,step,traffic:false};movement.set(u.id,intent);
  const nx=u.x+fx*step,ny=u.y+fy*step;
  if(!clearStep(s,u,nx,ny)){
    u.moveSpeed=0;
    // A tight corner may require finishing the turn while stopped. Keep its
    // valid waypoint instead of replanning back and forth from the tile edge.
    if(!clearStep(s,u,p.x,p.y)){u.repath=0;u.path=[];}
    return false;
  }
  const blocker=neighbors.find(other=>{
    const next=Math.hypot(nx-other.x,ny-other.y);
    if(next>=unitSpacing(u,other,s.time)-.001||next>=distance(u,other)-.001)return false;
    if(other.team===u.team)intent.traffic=true;return true;
  });
  if(blocker){
    u.moveSpeed=0;
    // Let one committed bypass finish. Reciprocal detours otherwise keep moving
    // the obstacle each vehicle is circling and can carry both far off route.
    if(blocker.team===u.team&&blocker.id<u.id&&blocker.path.some(p=>p.trafficId===u.id))return false;
    // A safe bypass can need a tighter turn than the body can drive through.
    // Finish that turn against the same clear leg instead of replacing its
    // waypoint every tick as the current heading points into the neighbor.
    if(p.trafficId&&segmentDistance(u,p,blocker)>=Math.min(unitSpacing(u,blocker,s.time),distance(u,blocker))-.001)return false;
    u.trafficBlockedAt??=s.time;
    // Near a parking slot, chaining one-body doglegs can circle the entire
    // parked formation. Search the crowd once a bypass reaches a second body.
    if(p.trafficId&&p.trafficId!==blocker.id&&(blocker.order.type==='idle'||blocker.formationReady)&&Math.hypot(tx-u.x,ty-u.y)<6&&!(u.crowdPlanAt>s.time)&&pathBudget>0){
      u.crowdPlanAt=s.time+1;pathBudget--;
      const crowd=nearbyEntities(s,u,8).filter(e=>e!==u&&e.kind==='unit'&&alive(e)&&distance(u,e)<8);
      const goal=u.path.find(p=>!p.flock)||{x:tx,y:ty};
      const route=findTrafficDetour(u,goal,crowd,(a,b)=>insideMovementLeash(u,b.x,b.y)&&clearStep(s,a,b.x,b.y));
      if(route){while(u.path[0]?.flock)u.path.shift();u.path.unshift(...route.map(p=>({...p,flock:true,trafficId:blocker.id})));return false;}
      if(yieldParkedAlly(s,u,crowd))return false;
    }
    const detour=trafficDetour(s,u,blocker,dx/d,dy/d);
    if(detour?.points){
      // Discard a stale flock correction before making a deliberate local bypass.
      while(u.path[0]?.flock)u.path.shift();
      u.path.unshift(...detour.points);u.steerSide=detour.side;u.steerUntil=s.time+4;
      intent.traffic=false;
    }else if(!detour&&blocker.team===u.team)intent.passTargetId=blocker.id;
    else if(s.time-u.trafficBlockedAt>.5&&!(u.crowdPlanAt>s.time)&&pathBudget>0){
      u.crowdPlanAt=s.time+1;pathBudget--;
      const crowd=nearbyEntities(s,u,8).filter(e=>e!==u&&e.kind==='unit'&&alive(e)&&distance(u,e)<8);
      const goal=u.path.find(p=>!p.flock)||{x:tx,y:ty};
      const route=findTrafficDetour(u,goal,crowd,(a,b)=>insideMovementLeash(u,b.x,b.y)&&clearStep(s,a,b.x,b.y));
      if(route){while(u.path[0]?.flock)u.path.shift();u.path.unshift(...route.map(p=>({...p,flock:true,trafficId:blocker.id})));}
      else yieldParkedAlly(s,u,crowd);
    }
    return false;
  }
  u.x=nx;u.y=ny;
  if(step>.001)delete u.trafficBlockedAt;
  if(distance(u,p)<1e-6)u.path.shift();
  return false;
}

// Visits cells in square rings of growing radius around (cx,cy), clipped to the map, until
// done(r) reports that no cell at Chebyshev radius r or beyond can change the result.
function scanRings(s,cx,cy,visit,done){
  const W=s.width,H=s.height,last=Math.max(cx,W-1-cx,cy,H-1-cy);
  for(let r=0;r<=last&&!(r&&done(r));r++){
    const top=cy-r,bottom=cy+r,left=Math.max(0,cx-r),right=Math.min(W-1,cx+r);
    if(top>=0&&top<H)for(let x=left;x<=right;x++)visit(top*W+x);
    if(r&&bottom>=0&&bottom<H)for(let x=left;x<=right;x++)visit(bottom*W+x);
    for(let y=Math.max(0,top+1);y<=Math.min(H-1,bottom-1);y++){if(cx-r>=0&&cx-r<W)visit(y*W+cx-r);if(r&&cx+r>=0&&cx+r<W)visit(y*W+cx+r);}
  }
}
function nearestMineral(s,u,x=u.x,y=u.y){
  const W=s.width,{minerals,blocked,regions}=s,explored=s.explored[u.team],region=regions[cell(s,u.x,u.y)];
  let best=-1,score=Infinity;
  // Rings around the search point stop once every remaining cell is farther than the best;
  // equal distances keep the lowest index, exactly like a row-major scan.
  scanRings(s,Math.floor(x),Math.floor(y),i=>{
    if(!(minerals[i]>0&&explored[i]&&!blocked[i]&&regions[i]===region))return;
    const d=sq(i%W+.5-x)+sq(Math.floor(i/W)+.5-y);if(d<score||d===score&&i<best){best=i;score=d;}
  },r=>sq(r-1)>score);
  return best;
}
function harvest(s,u,dt,movement,power){
  const W=s.width;
  const cap=UNITS.harvester.capacity;
  if(u.cargo>=cap-.001)u.harvestPhase='return';
  if(u.harvestPhase==='return'){
    const refineries=own(s,u.team,'refinery').filter(e=>e.progress>=1),depot=(refineries.length?refineries:own(s,u.team,'core').filter(e=>e.progress>=1)).sort((a,b)=>distance(u,center(a))-distance(u,center(b)))[0];
    if(!depot)return;
    const c=center(depot),stop=depot.size/2+.7;
    if(navigate(s,u,c.x,c.y,dt,stop,movement)||distance(u,c)<stop+.4){
      if(u.cargo>0)u.unloadDepotId=depot.id;
      u.unload=Math.min(1.2,(u.unload||0)+dt*power.ratio*(depot.upgrades?.speed?1.25:1));
      if(u.unload>=1.2){
        const amount=u.cargo*(entityRole(depot)==='core'?.6:1);s.teams[u.team].credits+=amount;tally(s,u.team,'mined',amount);if(s.mission)noteDelivery(s,u.team,amount,u.cargoType??1);
        // Processing is visual bookkeeping after the existing immediate credit deposit.
        depot.processingType=depot.processingAmount>0&&depot.processingType!==(u.cargoType??1)?0:(u.cargoType??1);
        depot.processingAmount=(depot.processingAmount||0)+u.cargo;depot.processingTotal=(depot.processingTotal||0)+u.cargo;
        event(s,`Shard delivery: +${Math.floor(amount)} credits`,u.team,{kind:'delivery',...subject(u),amount,mineralType:u.cargoType??1});
        u.cargo=0;u.cargoType=0;u.unload=0;u.unloadDepotId=null;u.harvestPhase='gather';u.repath=0;
      }
    }
    return;
  }
  if(u.mineralTile===undefined||s.minerals[u.mineralTile]<=0||u.mineralTile<0&&s.time>=(u.mineralSearchAt||0)||u.mineralNavVersion!==s.navVersion||u.harvestTargetX!==u.order.x||u.harvestTargetY!==u.order.y){
    u.mineralTile=nearestMineral(s,u,u.order.x??u.x,u.order.y??u.y);u.harvestTargetX=u.order.x;u.harvestTargetY=u.order.y;u.mineralNavVersion=s.navVersion;u.repath=0;
    // An empty known field needs occasional scouting retries, not synchronized whole-map scans.
    // Only failed searches back off; new orders and navigation changes still wake the carrier immediately.
    if(u.mineralTile<0){u.mineralRetryDelay=Math.min(12,(u.mineralRetryDelay||2)*2);u.mineralSearchAt=s.time+u.mineralRetryDelay+(u.id%5)*.1;}
    else{delete u.mineralRetryDelay;u.mineralSearchAt=s.time+1;}
  }
  if(u.mineralTile<0){if(u.cargo>0)u.harvestPhase='return';return;}
  const x=u.mineralTile%W+.5,y=Math.floor(u.mineralTile/W)+.5;
  if(navigate(s,u,x,y,dt,.75,movement)||Math.hypot(u.x-x,u.y-y)<1.1){const type=s.mineralTypes?.[u.mineralTile]||1,amount=Math.min(28*dt*(type===3?2:1),s.minerals[u.mineralTile],cap-u.cargo);if(amount>0)u.cargoType=u.cargo<=0?type:(u.cargoType??1)===type?type:0;s.minerals[u.mineralTile]-=amount;u.cargo+=amount;}
}
const crowdingGrids=new WeakMap();
function explore(s,u,dt,movement){
  const {width:W,height:H}=s,N=W*H,{blocked,regions}=s,explored=s.explored[u.team];
  const order=u.order;
  if(order.tile!==undefined&&order.navVersion===s.navVersion&&u.path.length&&s.time>=order.nextPlan){
    // Finish a clear straight leg instead of stopping whenever its goal enters vision.
    // Still notice a fully explored reachable region promptly, including shared scouting.
    order.nextPlan=s.time+1;const region=regions[cell(s,u.x,u.y)];
    let unexplored=false;for(let i=0;i<N&&!unexplored;i++)unexplored=!explored[i]&&!blocked[i]&&regions[i]===region;
    if(!unexplored){stopUnits(s,[u.id]);event(s,`${UNITS[u.type].name}: reachable territory explored`,u.team,{kind:'explored',...subject(u)});return;}
  }
  if(order.tile===undefined||order.navVersion!==s.navVersion||explored[order.tile]&&s.time>=order.nextPlan){
    let best=-1,score=Infinity;const region=regions[cell(s,u.x,u.y)],speed=UNITS[u.type].speed;
    // Mark only the nearby cells around other destinations, keeping large scout groups cheap.
    // The derived grid is reused and its marked cells are zeroed again after this plan.
    let crowding=crowdingGrids.get(s);if(crowding?.length!==N)crowdingGrids.set(s,crowding=new Float32Array(N));
    const marked=[];
    for(const e of own(s,u.team))if(e!==u&&e.order.type==='explore'&&e.order.tile!==undefined){
      const tx=e.order.tile%W,ty=Math.floor(e.order.tile/W);
      for(let y=Math.max(0,ty-5);y<=Math.min(H-1,ty+5);y++)for(let x=Math.max(0,tx-5);x<=Math.min(W-1,tx+5);x++){crowding[y*W+x]+=Math.max(0,6-Math.hypot(x-tx,y-ty));marked.push(y*W+x);}
    }
    // Every value is at least the travel distance, so rings stop once their inner edge
    // passes the best value; ties keep the lowest index, exactly like a row-major scan.
    scanRings(s,Math.floor(u.x),Math.floor(u.y),i=>{
      if(explored[i]||blocked[i]||regions[i]!==region)return;
      const x=i%W+.5,y=Math.floor(i/W)+.5;
      // Prefer continuing forward now that every heading change requires a stationary turn.
      const heading=Math.atan2(y-u.y,x-u.x),turn=Math.abs(Math.atan2(Math.sin(heading-u.angle),Math.cos(heading-u.angle)));
      const value=Math.hypot(x-u.x,y-u.y)+turn*speed+crowding[i];
      if(value<score||value===score&&i<best){best=i;score=value;}
    },r=>r-1>score);
    for(const i of marked)crowding[i]=0;
    if(best<0){stopUnits(s,[u.id]);event(s,`${UNITS[u.type].name}: reachable territory explored`,u.team,{kind:'explored',...subject(u)});return;}
    order.tile=best;order.x=best%W+.5;order.y=Math.floor(best/W)+.5;order.navVersion=s.navVersion;order.nextPlan=s.time+1;
    u.path=[];u.repath=0;
  }
  if(navigate(s,u,order.x,order.y,dt,.35,movement))order.tile=undefined;
}

export function targetDistance(a,b){const ca=center(a),cb=center(b);return Math.max(0,distance(ca,cb)-(b.kind==='building'?b.size*.45:0));}
function acquire(s,e,r,closest=false){
  let best=null,score=Infinity;for(const enemy of nearbyEntities(s,center(e),r+1.5)){if(enemy.team===e.team||!alive(enemy)||!seen(s,e.team,enemy))continue;const d=targetDistance(e,enemy);if(d>r)continue;const threat=closest?0:enemy.kind==='building'?(BUILDINGS[enemy.type].damage?-1:1):entityRole(enemy)==='harvester'?.8:0;const value=d+threat;if(value<score||value===score&&enemy.id<best.id){score=value;best=enemy;}}
  return best;
}

function recordRetaliation(target,attacker){
  if(effectiveUnitStance(target)!=='defend'||target.team===attacker.team)return;
  target.defendAnchor??={x:target.x,y:target.y};
  if(target.retaliationTargetId!==attacker.id){target.path=[];target.repath=0;clearTrafficOrder(target);}
  target.retaliationTargetId=attacker.id;delete target.defendReturning;
}

function idleMilitary(s,u,dt,movement){
  const range=unitStats(u).range,defend=effectiveUnitStance(u)==='defend';
  let attacker=null;
  if(defend){
    u.defendAnchor??={x:u.x,y:u.y};
    attacker=getEntity(s,u.retaliationTargetId);
    if(!attacker||attacker.team===u.team||!seen(s,u.team,attacker)||targetDistance(u.defendAnchor,attacker)>range*2){
      if(u.retaliationTargetId!==undefined){delete u.retaliationTargetId;u.path=[];u.repath=0;clearTrafficOrder(u);}
      attacker=null;
      if(distance(u,u.defendAnchor)>.08)u.defendReturning=true;
    }
  }
  // Idle stances always reconsider the closest visible enemy already in range;
  // a prior target or distant attacker cannot displace that immediate shot.
  const target=acquire(s,u,unitRange(s,u),true);u.targetId=target?.id??null;
  if(target){
    u.path=[];u.repath=0;const c=center(target);
    turnUnit(u,Math.atan2(c.y-u.y,c.x-u.x),dt,true);
    if(u.cooldown<=0)shoot(s,u,target);
    return;
  }
  if(!defend)return;
  if(attacker){
    const c=center(attacker),dx=c.x-u.defendAnchor.x,dy=c.y-u.defendAnchor.y,d=Math.hypot(dx,dy),scale=Math.min(1,range/Math.max(d,.001));
    navigate(s,u,u.defendAnchor.x+dx*scale,u.defendAnchor.y+dy*scale,dt,.005,movement);
    // Static A* can return its closest reachable cell when the desired point is
    // sealed. If that endpoint cannot reach firing range, do not camp at a wall.
    const end=u.path.at(-1);
    if(end&&targetDistance(end,attacker)>range+.005&&Math.hypot(end.x-(u.defendAnchor.x+dx*scale),end.y-(u.defendAnchor.y+dy*scale))>.1){
      delete u.retaliationTargetId;u.defendReturning=true;u.path=[];u.repath=0;clearTrafficOrder(u);
    }
  }else if(u.defendReturning&&navigate(s,u,u.defendAnchor.x,u.defendAnchor.y,dt,.08,movement)){
    delete u.defendReturning;u.path=[];u.repath=0;
  }
}
const ARMOR_MULTIPLIERS={rifle:{infantry:1,light:.55,heavy:.23,building:.4},rocket:{infantry:.3,light:.9,heavy:1.8,building:.7},scout:{infantry:1.25,light:.65,heavy:.26,building:.4},striker:{infantry:1.5,light:.8,heavy:.22,building:.35},tank:{infantry:.5,light:1.1,heavy:1,building:1},artillery:{infantry:.9,light:1,heavy:.8,building:1.5},turret:{infantry:.75,light:1,heavy:1,building:.8},rocketTower:{infantry:.45,light:1,heavy:1.2,building:.8}};
export function armorMultiplier(attacker,target){
  const armor=target.kind==='building'?'building':UNITS[target.type].armor;
  return ARMOR_MULTIPLIERS[entityRole(attacker)]?.[armor]??1;
}
// Crater floors (terrain 5) give units cover from direct fire.
export function terrainCover(s,e){
  return e?.kind==='unit'&&e.hp>0&&inside(s,e.x,e.y)&&s.terrain[cell(s,e.x,e.y)]===5?.15:0;
}
function hurt(s,target,amount,attacker){
  if(!alive(target))return;
  if(!['artillery','rocket','rocketTower'].includes(entityRole(attacker)))amount*=1-terrainCover(s,target);
  amount*=abilityDamageTaken(s,target);
  const dealt=Math.min(amount,target.hp);tally(s,attacker.team,'damageDealt',dealt);tally(s,target.team,'damageTaken',dealt);
  target.hp-=amount;target.lastHit=s.time;target.attackerId=attacker.id;
  // A throttled alert for forces that are not already fighting on the player's orders; the HUD turns it into a warning toast and minimap ping.
  const engaging=target.kind==='unit'&&(target.order.type==='attack'||target.order.type==='attackMove'||s.time-(target.lastShot??-99)<3);
  if(target.team===0&&!engaging&&s.time-(s.alertAt??-99)>8){s.alertAt=s.time;event(s,`${definition(target).name} under attack`,0,{kind:'underAttack',...subject(target)});}
  if(target.hp<=0){
    if(s.mission&&target.tag)noteTagLost(s,target);
    s.teams[attacker.team].kills++;
    const structure=target.kind==='building',unseen=!seen(s,attacker.team,target);tally(s,attacker.team,structure?'structureKills':'unitKills');tally(s,target.team,structure?'structuresLost':'lost');
    if(unseen)tally(s,attacker.team,structure?'unseenStructureKills':'unseenUnitKills');
    // Walls count toward team kills, but a cheap unarmed barrier never earns a unit its rank.
    const killer=getEntity(s,attacker.id);
    if(killer?.kind==='unit'&&killer.team===attacker.team&&!(structure&&buildingRole(target)==='wall')){
      const previousRank=unitRank(killer);killer.kills=(killer.kills||0)+1;if(unseen)killer.unseenKills=(killer.unseenKills||0)+1;
      if(unitRank(killer)>previousRank){
        const stats=unitStats(killer);killer.hp=Math.min(stats.hp,killer.hp+stats.hp-killer.maxHp);killer.maxHp=stats.hp;
        event(s,`${UNITS[killer.type].name} promoted to rank ${stats.rank}`,killer.team,{kind:'promotion',rank:stats.rank,...subject(killer)});
      }
    }
    const c=center(target);s.effects.push({type:'explosion',x:c.x,y:c.y,life:.6,maxLife:.6,team:target.team,size:target.kind==='building'?target.size:1});
    if(structure){s.navVersion++;event(s,`${BUILDINGS[target.type].name} destroyed`,target.team,{kind:'structureLost',...subject(target)});}
    else{
      event(s,`${UNITS[target.type].name} lost`,target.team,{kind:'unitLost',rank:unitRank(target),...subject(target)});
      if(entityRole(target)==='harvester'&&!own(s,target.team,'harvester').length&&!queued(s,target.team,'harvester')&&!own(s,target.team,'refinery').some(r=>r.haulerPending))event(s,'All haulers lost. Train a new one at the refinery.',target.team,{kind:'haulersLost',...subject(target)});
    }
    checkOutcome(s,target.team,entityRole(target));
  }
}
// Called whenever an entity leaves play. Skirmishes keep the Charter rule: a side without a nexus or
// construction vehicle loses its claim. A mission settles its own objectives and fail rules instead.
function checkOutcome(s,team,role){
  if(s.mission){if(s.status==='playing')settleMission(s);return;}
  if(['core','constructor'].includes(role)&&!own(s,team,'core').length&&!own(s,team,'constructor').length){s.status=team===0?'defeat':'victory';event(s,team===0?'All nexuses and construction vehicles lost. Operation failed.':'All hostile nexuses and construction vehicles destroyed. Sector secured.',0,{kind:s.status});}
}
function shoot(s,e,target){
  const d=definition(e),a=center(e),b=center(target),damage=e.kind==='unit'?unitStats(e).damage:d.damage;e.aimAngle=Math.atan2(b.y-a.y,b.x-a.x);if(e.kind==='building')e.angle=e.aimAngle;e.cooldown=d.interval||1;e.lastShot=s.time;
  // Dispatch, rather than delayed projectile impact, defines who fired on an
  // idle defender. A shot from before an explicit command cannot wake it later.
  recordRetaliation(target,e);
  if(entityRole(e)==='rocket'||entityRole(e)==='rocketTower'){
    const flight=clamp(distance(a,b)/15,.2,.65);
    s.effects.push({type:'rocket',weapon:entityRole(e),attackerId:e.id,targetId:target.id,damage,x:a.x,y:a.y,tx:b.x,ty:b.y,life:flight,maxLife:flight,team:e.team});
    return;
  }
  s.effects.push({type:entityRole(e)==='artillery'?'shell':'shot',weapon:entityRole(e),x:a.x,y:a.y,tx:b.x,ty:b.y,life:entityRole(e)==='artillery'?.35:.13,maxLife:entityRole(e)==='artillery'?.35:.13,team:e.team});
  hurt(s,target,damage*armorMultiplier(e,target),e);
  if(entityRole(e)==='artillery')for(const other of nearbyEntities(s,b,1.6))if(other!==target&&other.team!==e.team&&alive(other)&&distance(center(other),b)<1.6)hurt(s,other,damage*.45*armorMultiplier(e,other),e);
}

function rocketImpact(s,fx){
  const d=fx.weapon==='rocketTower'?BUILDINGS.rocketTower:UNITS.rocket,damage=fx.damage??d.damage;
  const attacker={id:fx.attackerId,type:fx.weapon,team:fx.team},impact={x:fx.tx,y:fx.ty};
  s.effects.push({type:'explosion',weapon:fx.weapon,x:impact.x,y:impact.y,life:.35,maxLife:.35,team:fx.team,size:fx.weapon==='rocketTower'?1.15:.65});
  for(const target of nearbyEntities(s,impact,d.splash)){
    if(!alive(target)||target.team===fx.team||distance(center(target),impact)>d.splash)continue;
    hurt(s,target,damage*(target.id===fx.targetId?1:d.splashDamage)*armorMultiplier(attacker,target),attacker);
  }
}

function finishOrder(u,type='idle'){
  delete u.formationReady;
  const {formation,x,y}=u.order;
  u.order=formation?{type,x,y,formation}:{type};
}
function finishMovement(u,dt,movement,type='idle'){
  if(u.order.facing!==undefined){
    turnUnit(u,u.order.facing,dt);
    movement.set(u.id,{x:u.x,y:u.y,dx:0,dy:0,step:0,rotating:true});
    const remaining=Math.atan2(Math.sin(u.order.facing-u.angle),Math.cos(u.order.facing-u.angle));
    if(Math.abs(remaining)>1e-8)return;
  }
  if(u.order.type==='move'&&u.order.formation&&!u.order.formation.compact){u.formationReady=true;return;}
  finishOrder(u,type);
}
function finishFormationAssemblies(s){
  const groups=new Map();
  for(const u of s.entities){
    const f=u.order?.formation;
    if(!alive(u)||u.kind!=='unit'||u.order.type!=='move'||!f||f.compact)continue;
    const key=`${u.team}:${f.group}:${f.x}:${f.y}:${f.angle}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(u);
  }
  for(const group of groups.values())if(group.every(u=>u.formationReady&&!u.yieldReturn))for(const u of group){
    delete u.formationReady;finishOrder(u,entityRole(u)==='harvester'?'harvest':'idle');
  }
}
// One shell of an active barrage: scattered around its ground point with the shared stream, so salvos
// replay exactly after loading. It hits whatever stands there, using the siege crawler's damage table.
function fireBarrage(s,u){
  const b=u.barrage,a=ABILITIES.artillery;if(s.time<b.next)return;
  const angle=random(s)*Math.PI*2,spread=Math.sqrt(random(s))*a.scatter,from=center(u);
  const impact={x:clamp(b.x+Math.cos(angle)*spread,0,s.width-1e-6),y:clamp(b.y+Math.sin(angle)*spread,0,s.height-1e-6)},damage=unitStats(u).damage*a.damage;
  s.effects.push({type:'shell',weapon:'artillery',x:from.x,y:from.y,tx:impact.x,ty:impact.y,life:.35,maxLife:.35,team:u.team});
  s.effects.push({type:'explosion',weapon:'artillery',x:impact.x,y:impact.y,life:.35,maxLife:.35,team:u.team,size:.8});
  for(const other of nearbyEntities(s,impact,a.splash+3)){
    if(other.team===u.team||!alive(other))continue;
    const d=other.kind==='building'?Math.hypot(Math.max(other.x-impact.x,impact.x-other.x-other.size,0),Math.max(other.y-impact.y,impact.y-other.y-other.size,0)):distance(other,impact);
    if(d<=a.splash)hurt(s,other,damage*(d<=a.direct?1:a.splashDamage)*armorMultiplier(u,other),u);
  }
  if(--b.shots>0)b.next+=a.interval;else delete u.barrage;
}
function stepUnit(s,u,dt,movement,power){
  if(entityRole(u)==='harvester')u.unloadDepotId=null;
  u.repath-=dt;u.cooldown=Math.max(0,u.cooldown-dt);
  // Ability timers exist only while they matter.
  if(u.abilityReadyAt<=s.time)delete u.abilityReadyAt;if(u.abilityUntil<=s.time)delete u.abilityUntil;
  if(u.barrage)fireBarrage(s,u);
  if(u.yieldReturn){
    const mover=getEntity(s,u.yieldFor);
    const cleared=!mover||mover.order.type==='idle'||mover.order.type==='harvest'&&!mover.moving&&!mover.path.length;
    // A later arrival can occupy the temporary pullout before we reach it.
    // Once its beneficiary has finished, abandon that obsolete outbound leg
    // immediately instead of trying to park there before returning home.
    if(u.yieldWaiting||cleared&&distance(u.yieldPoint,u.yieldReturn)>.001){
      // Rejoin once the passing body clears the whole return corridor. A fixed
      // wide radius needlessly leaves small units waiting after traffic passes.
      if(!cleared&&segmentDistance(u,u.yieldReturn,mover)<(u.size+mover.size)*.43+.15)return;
      u.yieldPoint={...u.yieldReturn};delete u.yieldWaiting;u.path=[];u.repath=0;
    }
    if(navigate(s,u,u.yieldPoint.x,u.yieldPoint.y,dt,.08,movement)){
      if(distance(u,u.yieldReturn)<.081){delete u.yieldReturn;delete u.yieldPoint;delete u.yieldFor;finishMovement(u,dt,movement);}
      else u.yieldWaiting=true;
    }
    return;
  }
  if(entityRole(u)==='harvester'&&!['move','explore'].includes(u.order.type)){if(u.order.type!=='harvest')u.order={type:'harvest'};harvest(s,u,dt,movement,power);return;}
  const d=UNITS[u.type],order=u.order;
  if(order.type==='move'){
    if(entityRole(u)==='engineer'){u.repairActive=false;u.repairTargetId=null;}
    const arrived=navigate(s,u,order.x,order.y,dt,.08,movement);
    // Movement goals are reachable parking slots; traffic must not cancel an unfinished delivery move.
    if(arrived)finishMovement(u,dt,movement,entityRole(u)==='harvester'?'harvest':'idle');
    return;
  }
  if(entityRole(u)==='engineer'){
    u.repairActive=false;u.repairTargetId=null;u.targetId=null;
    const target=nearbyEntities(s,u,d.repairRange+1.5).filter(e=>alive(e)&&e.team===u.team&&e!==u&&e.progress>=1&&e.hp<e.maxHp&&(e.kind==='building'||UNITS[e.type].armor!=='infantry')&&targetDistance(u,e)<=d.repairRange).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id-b.id)[0];
    if(target&&s.teams[u.team].credits>0){
      const costPerHp=definition(target).cost*.35/target.maxHp,amount=Math.min(target.maxHp-target.hp,dt*d.repairRate*power.ratio,s.teams[u.team].credits/costPerHp);
      const credits=s.teams[u.team].credits;target.hp+=amount;s.teams[u.team].credits=Math.max(0,credits-amount*costPerHp);tally(s,u.team,'spent',credits-s.teams[u.team].credits);u.repairTargetId=target.id;u.repairActive=amount>0;
      if(u.repairActive){const c=center(target);turnUnit(u,Math.atan2(c.y-u.y,c.x-u.x),dt,true);return;}
    }
    if(order.type==='explore')explore(s,u,dt,movement);
    else if(['attack','attackMove'].includes(order.type)&&navigate(s,u,order.x,order.y,dt,.08,movement))finishMovement(u,dt,movement);
    return;
  }
  if(order.type==='idle'&&militaryUnit(u)){idleMilitary(s,u,dt,movement);return;}
  // A range ability extends both firing range and attack-move engagement distance.
  const bonus=abilityRange(s,u),range=d.range+bonus,sight=d.sight+bonus;
  let target=getEntity(s,order.type==='attack'?order.targetId:u.targetId);
  if(target&&(target.team===u.team||!seen(s,u.team,target)))target=null;
  if(target&&order.type!=='attack'&&targetDistance(u,target)>(order.type==='attackMove'?sight+1:range))target=null;
  if(!target&&d.damage>0)target=acquire(s,u,order.type==='attackMove'?sight:range);
  u.targetId=target?.id??null;
  if(target){
    const c=center(target);if(order.type==='attack'&&target.id===order.targetId){order.x=c.x;order.y=c.y;}
    if(targetDistance(u,target)<=range){u.path=[];u.repath=0;const heading=Math.atan2(c.y-u.y,c.x-u.x);turnUnit(u,heading,dt,true);if(u.cooldown<=0)shoot(s,u,target);return;}
    if(order.type==='attack'||order.type==='attackMove'){
      // A committed target beyond a barrier must not leave an army walking into the wall forever.
      const dx=c.x-u.x,dy=c.y-u.y,length=Math.hypot(dx,dy);
      const barrier=nearbyEntities(s,u,range+1.5).filter(e=>e.kind==='building'&&buildingRole(e)==='wall'&&e.team!==u.team&&alive(e)&&seen(s,u.team,e)&&targetDistance(u,e)<=range).filter(e=>{
        const p=center(e),along=((p.x-u.x)*dx+(p.y-u.y)*dy)/Math.max(.01,length),across=Math.abs((p.x-u.x)*dy-(p.y-u.y)*dx)/Math.max(.01,length);
        return along>0&&along<length&&across<e.size*.72+.25;
      }).sort((a,b)=>targetDistance(u,a)-targetDistance(u,b)||a.id-b.id)[0];
      if(barrier){u.targetId=barrier.id;const p=center(barrier);turnUnit(u,Math.atan2(p.y-u.y,p.x-u.x),dt,true);if(u.cooldown<=0)shoot(s,u,barrier);return;}
      navigate(s,u,c.x,c.y,dt,range+(target.kind==='building'?target.size*.45:0)-.2,movement);return;
    }
  }
  if(order.type==='explore'){explore(s,u,dt,movement);return;}
  if(order.type==='attackMove'||order.type==='attack'){
    // A concealed building's centre is solid ground: stop at its edge instead of searching the whole map.
    const goal=order.type==='attack'?getEntity(s,order.targetId):null,stop=order.type==='attackMove'?.08:goal?.kind==='building'?goal.size*.71+.75:.45;
    if(navigate(s,u,order.x,order.y,dt,stop,movement))finishMovement(u,dt,movement);
  }
}

function spawnAt(s,producer,type){
  if(own(s,producer.team).filter(e=>e.kind==='unit').length>=unitCapacity(s,producer.team))return false;
  const c=center(producer);let best=null,bestScore=Infinity;
  for(let y=producer.y-2;y<=producer.y+producer.size+2;y++)for(let x=producer.x-2;x<=producer.x+producer.size+2;x++){
    // Never deploy into a sealed pocket between buildings: such a unit could not follow any order.
    if(!walkable(s,x+.5,y+.5,.3)||s.regionSize[s.regions[y*s.width+x]]<40)continue;
    const crowded=nearbyEntities(s,{x:x+.5,y:y+.5},1).filter(e=>e.kind==='unit'&&alive(e)&&Math.hypot(e.x-x-.5,e.y-y-.5)<.8).length;
    const score=distance(c,{x:x+.5,y:y+.5})+crowded*5;if(score<bestScore){best={x:x+.5,y:y+.5};bestScore=score;}
  }
  if(!best)return false;
  const u=addEntity(s,producer.team,'unit',type,best.x,best.y);
  if(producer.rally)issueOrder(s,[u.id],{type:unitRole(type)==='harvester'?'move':'attackMove',...producer.rally});
  tally(s,producer.team,'trained');if(s.mission)noteTrained(s,producer.team,unitRole(type));
  event(s,`${UNITS[type].name} ready`,producer.team,{kind:'ready',...subject(u)});return true;
}

function deliverRefineryHauler(s,e){
  // Keep the included hauler pending if its exit is blocked or the army is full.
  if(e.haulerPending&&e.progress>=1&&spawnAt(s,e,raceUnit(s,e.team,'harvester')))e.haulerPending=false;
}

function separateUnits(s,dt,movement){
  const units=s.entities.filter(e=>e.kind==='unit'&&alive(e));
  // A deterministic spatial broad phase keeps large battles local. Candidate pairs retain entity order.
  const buckets=new Map(),locations=new Array(units.length),key=u=>bucketKey(Math.floor(u.x/2),Math.floor(u.y/2));
  const relocate=i=>{
    const next=key(units[i]),previous=locations[i];if(previous===next)return false;
    if(previous!==undefined){const list=buckets.get(previous);list.splice(list.indexOf(i),1);if(!list.length)buckets.delete(previous);}
    if(!buckets.has(next))buckets.set(next,[]);buckets.get(next).push(i);locations[i]=next;return true;
  };
  units.forEach((_,i)=>relocate(i));
  const neighbors=(i,after)=>{
    const u=units[i],x=Math.floor(u.x/2),y=Math.floor(u.y/2),list=[];
    for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++){const bucket=buckets.get(bucketKey(xx,yy));if(bucket)for(const j of bucket)if(j>after)list.push(j);}
    return list.sort((a,b)=>a-b);
  };
  for(let i=0;i<units.length;i++){
    const candidates=neighbors(i,i),pending=new Set(candidates);
    for(let index=0;index<candidates.length;index++){
    const j=candidates[index];pending.delete(j);
    const a=units[i],b=units[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);const min=unitSpacing(a,b,s.time);
    if(d>=min)continue;if(d<.001){dx=.01;dy=.004;d=Math.hypot(dx,dy);}
    const intentA=movement.get(a.id),intentB=movement.get(b.id),movingA=!!intentA&&!intentA.rotating,movingB=!!intentB&&!intentB.rotating,shareA=movingA===movingB?.5:movingA?1:0;
    const push=Math.min((min-d)*.9,dt*1.8),px=dx/d*push,py=dy/d*push;
    // Contact correction stays on the body axis; guards and combat aiming stay planted.
    const displace=(u,intent,amount)=>{
      if(!intent||intent.rotating)return;
      const fx=Math.cos(u.angle),fy=Math.sin(u.angle),progress=(u.x-intent.x)*fx+(u.y-intent.y)*fy;
      const along=Math.max(-Math.max(0,progress),(px*fx+py*fy)*amount);
      const x=u.x+fx*along,y=u.y+fy*along;
      if(clearStep(s,u,x,y)){u.x=x;u.y=y;}
    };
    displace(a,intentA,-shareA);displace(b,intentB,1-shareA);
    const changed=relocate(i);relocate(j);
    if(changed){
      for(const next of neighbors(i,j))if(!pending.has(next)){candidates.push(next);pending.add(next);}
      const tail=candidates.splice(index+1).sort((a,b)=>a-b);candidates.push(...tail);
    }
    }
  }
  for(const u of units){
    indexEntity(s,u);
    const intent=movement.get(u.id);
    u.moving=!!intent&&Math.hypot(u.x-intent.x,u.y-intent.y)>.008;
    if(intent?.rotating){u.moveSpeed=0;continue;}
    if(!intent){u.moveSpeed=0;if(!u.targetId&&!u.repairActive)u.turnVelocity=0;delete u.trafficWait;delete u.passUntil;delete u.passTargetId;continue;}
    if(u.passUntil<=s.time){delete u.passUntil;delete u.passTargetId;}
    const progress=(u.x-intent.x)*intent.dx+(u.y-intent.y)*intent.dy;
    if(intent.passTargetId&&!(u.passUntil>s.time)&&progress<intent.step*.25)u.trafficWait=Math.min(.8,(u.trafficWait||0)+dt);
    else u.trafficWait=Math.max(0,(u.trafficWait||0)-dt*2);
    // Only friendly spacing softens during a jam; static geometry stays solid.
    if(u.trafficWait>=.8-1e-8){u.passUntil=s.time+1.5;u.passTargetId=intent.passTargetId;u.trafficWait=0;}
  }
}

export function queued(s,team,type){return own(s,team).reduce((sum,e)=>sum+(e.queue?.filter(q=>q.type===type||unitRole(q)===type).length||0),0);}
// Power throttles everything; the opposition additionally builds and trains slower below Veteran (teamPace).
export function productionRate(s,team,power=powerStats(s,team)){return power.ratio*(power.productionMultiplier??1)*teamPace(s,team);}
function step(s,dt){
  if(s.status!=='playing')return;s.time+=dt;rebuildNavigation(s);pathBudget=16;
  beginSpatialStep(s);
  s.fogClock-=dt;if(s.fogClock<=0){updateFog(s);s.fogClock=.2;}
  const powers=[advancePower(s,0,dt),advancePower(s,1,dt)],movement=new Map();
  for(const e of [...s.entities]){
    if(!alive(e))continue;
    if(e.kind==='building'){
      const rate=powers[e.team].ratio,pace=productionRate(s,e.team,powers[e.team])*(e.upgrades?.speed?1.25:1);
      // Emergency construction retains 20% speed, allowing reactors to recover a collapsed grid.
      if(e.progress<1){const buildPace=Math.max(.2,rate)*powers[e.team].productionMultiplier*teamPace(s,e.team),delta=Math.min(1-e.progress,dt/BUILDINGS[e.type].buildTime*buildPace);e.progress=Math.min(1,e.progress+delta);e.hp=Math.min(e.maxHp,e.hp+e.maxHp*.8*delta);if(e.progress>=1){event(s,`${BUILDINGS[e.type].name} online`,e.team,{kind:'online',...subject(e)});deliverRefineryHauler(s,e);}continue;}
      if(e.repairing){
        const costPerHp=BUILDINGS[e.type].cost*.5/e.maxHp;
        const amount=Math.min(e.maxHp-e.hp,dt*e.maxHp*.02*rate,s.teams[e.team].credits/costPerHp);
        const credits=s.teams[e.team].credits;e.hp=Math.min(e.maxHp,e.hp+amount);s.teams[e.team].credits=Math.max(0,credits-amount*costPerHp);tally(s,e.team,'spent',credits-s.teams[e.team].credits);
        if(e.hp>=e.maxHp)e.repairing=false;
      }
      if(e.processingAmount>0){e.processingAmount=Math.max(0,e.processingAmount-dt*UNITS.harvester.capacity/6*rate*powers[e.team].productionMultiplier*(e.upgrades?.speed?1.25:1));if(e.processingAmount<1e-8){e.processingAmount=e.processingTotal=0;e.processingType=0;}}
      if(e.research){e.research.progress=Math.min(1,e.research.progress+dt/RESEARCH[e.research.id].time*pace);if(e.research.progress>=1)finishResearch(s,e);}
      if(e.upgrade){e.upgrade.progress=Math.min(1,e.upgrade.progress+dt/BUILDING_UPGRADES[e.upgrade.id].time*productionRate(s,e.team,powers[e.team]));if(e.upgrade.progress>=1){const id=e.upgrade.id;e.upgrades??={};e.upgrades[id]=true;delete e.upgrade;event(s,`${BUILDING_UPGRADES[id].name}: upgrade complete`,e.team,{kind:'upgradeComplete',...subject(e)});}}
      deliverRefineryHauler(s,e);
      const q=e.queue[0];if(q){q.progress=Math.min(1,q.progress+dt/UNITS[q.type].trainTime*pace);if(q.progress>=1){if(spawnAt(s,e,q.type))e.queue.shift();else if(Math.floor(s.time/10)!==Math.floor((s.time-dt)/10))event(s,`${BUILDINGS[e.type].name}: deployment bay blocked`,e.team,{kind:'bayBlocked',...subject(e)});}}
      if(BUILDINGS[e.type].damage){e.cooldown=Math.max(0,e.cooldown-dt*rate);const target=acquire(s,e,BUILDINGS[e.type].range);e.targetId=target?.id??null;if(target&&e.cooldown<=0&&powers[e.team].ratio>=1)shoot(s,e,target);}
    }else{
      const angle=e.angle,x=e.x,y=e.y;stepUnit(s,e,dt,movement,powers[e.team]);
      // Combat aiming and engineer work also turn in place and cannot be displaced by traffic.
      if(e.angle!==angle&&!movement.has(e.id))movement.set(e.id,{x,y,dx:0,dy:0,step:0,traffic:false,rotating:true});
      indexEntity(s,e);
    }
  }
  separateUnits(s,dt,movement);
  finishFormationAssemblies(s);
  // Damaged vehicles can fall back to their nexus for slow paid repairs.
  const repairCores=[0,1].map(team=>own(s,team,'core').filter(core=>core.progress>=1));
  for(const e of s.entities)if(alive(e)&&e.kind==='unit'&&e.hp<e.maxHp&&s.time-(e.lastHit??-99)>8&&s.teams[e.team].credits>1&&repairCores[e.team].some(core=>distance(e,center(core))<7)){const amount=Math.min(e.maxHp-e.hp,dt*5*powers[e.team].ratio,s.teams[e.team].credits*8);e.hp+=amount;s.teams[e.team].credits-=amount/8;tally(s,e.team,'spent',amount/8);}
  for(const effect of s.effects){
    if(entityRole(effect)==='rocket'){
      const target=getEntity(s,effect.targetId);
      if(target&&seen(s,effect.team,target)){const c=center(target);effect.tx=c.x;effect.ty=c.y;}
    }
    effect.life-=dt;
    if(entityRole(effect)==='rocket'&&effect.life<=1e-8){effect.life=0;if(s.status==='playing')rocketImpact(s,effect);}
  }
  s.effects=s.effects.filter(e=>e.life>0);
  s.entities=s.entities.filter(alive);
  spatialStates.delete(s);
  if(s.mission)updateMission(s);
  if(s.status==='playing')for(const team of s.aiTeams||[1])if(s.time>=aiState(s,team).nextThink)thinkAI(s,team);
}
export function updateGame(s,dt){
  if(!Number.isFinite(dt)||dt<=0||s.status!=='playing')return;
  // Fixed upper step keeps projectile cooldowns, harvest rates, and collision stable.
  let remaining=Math.min(dt,1);while(remaining>1e-8&&s.status==='playing'){const amount=Math.min(.05,remaining);step(s,amount);remaining-=amount;}
}
