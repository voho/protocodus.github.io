// Ashline: deterministic, dependency-free skirmish simulation. Coordinates are tiles.
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
  aiUnity:{name:'AI Unity',description:'Costlier autonomous cohorts combine durable combat robots with agile, lighter machines and efficient infrastructure.'},
};
const unityId=role=>`unity${role[0].toUpperCase()}${role.slice(1)}`;
const UNITY_BUILDINGS={
  core:{name:'Unity mainframe',hp:3100,power:20},reactor:{name:'Resonance spire',hp:800,power:95,description:'Armored autonomous generator. Produces 95 power for industry and defenses.'},refinery:{name:'Prism assimilator',hp:1300,power:-28,description:'Includes one automatic Prism carrier. Efficient conversion of shard deliveries into credits.'},
  barracks:{name:'Cohort assembler',hp:1050,description:'Prints Needle cohorts, Breach automata and Veil skimmers.'},factory:{name:'Walker forge',hp:1550,power:-38,description:'Builds articulated combat walkers, Mender drones, and Mainframe constructors.'},lab:{name:'Logic archive',hp:1000,power:-24,description:'Develops permanent combat and infrastructure algorithms. One project per archive.'},
  capacitor:{name:'Charge nexus',hp:800},turret:{name:'Lance node',hp:820,damage:44,interval:1.15},rocketTower:{name:'Shard battery',hp:1000,damage:80,interval:2.45},
  wall:{name:'Interlock barrier',hp:600},
};
const UNITY_UNITS={
  rifle:{name:'Needle cohort',cost:90,hp:120,speed:2.4,damage:13,description:'Durable biped combat robots. Slower than organic infantry, with sustained pulse fire.'},
  rocket:{name:'Breach automaton',cost:175,hp:108,speed:2.15,damage:53,description:'Heavy biped launcher platforms. Tougher but slower than organic rocket teams.'},
  scout:{name:'Veil skimmer',cost:150,hp:165,speed:4.55,description:'Agile sensor machine with light armor. Wide sight and rapid anti-infantry fire.'},
  tank:{name:'Bastion walker',cost:325,hp:470,speed:2.4,damage:67,interval:1.5,description:'Articulated assault walker. Trades some armor and shell weight for mobility.'},
  artillery:{name:'Arc siege walker',cost:410,hp:235,speed:1.95,damage:110,interval:3.1,description:'Mobile long-range siege platform. Lighter armor demands careful screening.'},
  harvester:{name:'Prism carrier',hp:540,speed:2.7,description:'Autonomous shard carrier with a rear mineral chamber. Same cargo capacity and extraction economy as organic haulers.'},
  engineer:{name:'Mender drone',hp:250,speed:3.1,repairRate:18,description:'Unarmed maintenance machine. Fast relocation; repairs nearby vehicles and structures for credits and power.'},
  constructor:{name:'Mainframe constructor',hp:600,speed:2.2,description:'Unarmed mobile mainframe. Deploy within 4 tiles to establish a remote base and add 200 unit slots when complete. Deployment consumes this machine at no extra cost.'},
  striker:{name:'Talon runner',cost:280,hp:285,speed:3.85,damage:26,interval:.53,description:'Fast multi-legged hunter with paired anti-infantry pulse cannons. Vulnerable to heavy armor.'},
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
const entityRole=value=>buildingRole(unitRole(value));

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

export const MAP_SIZES={
  standard:{name:'Standard',width:144,height:112},
  frontier:{name:'Frontier',width:192,height:144},
  vast:{name:'Vast',width:224,height:168},
};
export const MAP_PROFILES={
  rift:{name:'Volcanic rift',description:'Lava shores, broken ridges, and exposed rich central deposits.'},
  basin:{name:'Basalt basin',description:'Broad open basalt plains, sheltered expansions, and scattered mesas.'},
  highlands:{name:'Shattered highlands',description:'Raised plateaus, defended passes, and valuable flanking expansions.'},
};
export const MAP_WIDTH=MAP_SIZES.frontier.width,MAP_HEIGHT=MAP_SIZES.frontier.height;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const sq=(x)=>x*x;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const center=e=>e.kind==='building'?{x:e.x+e.size/2,y:e.y+e.size/2}:e;
const cell=(s,x,y)=>Math.floor(y)*s.width+Math.floor(x);
const inside=(s,x,y)=>x>=0&&y>=0&&x<s.width&&y<s.height;
const good=()=>({ok:true,reason:''});
const bad=reason=>({ok:false,reason});
const alive=e=>e.hp>0;
const own=(s,t,type)=>s.entities.filter(e=>alive(e)&&e.team===t&&(!type||e.type===type||entityRole(e)===type));
const completed=(s,t,type)=>own(s,t,type).some(e=>e.kind==='building'&&e.progress>=1);
const definition=e=>e.kind==='building'?BUILDINGS[e.type]:UNITS[e.type];
// Per-step spatial state is derived, never serialized. Ordering stays identical to entities.
const spatialStates=new WeakMap(),SPATIAL_CELL=6;
const spatialKey=e=>{const p=center(e);return `${Math.floor(p.x/SPATIAL_CELL)},${Math.floor(p.y/SPATIAL_CELL)}`;};
function indexEntity(s,e){
  const spatial=spatialStates.get(s);if(!spatial)return;
  const key=spatialKey(e),previous=spatial.entries.get(e.id);
  if(previous?.key===key)return;
  if(previous){const bucket=spatial.buckets.get(previous.key);bucket.splice(bucket.indexOf(previous),1);}
  const entry={e,key,index:previous?.index??spatial.nextIndex++};spatial.entries.set(e.id,entry);
  if(!spatial.buckets.has(key))spatial.buckets.set(key,[]);spatial.buckets.get(key).push(entry);
}
function beginSpatialStep(s){
  spatialStates.set(s,{buckets:new Map(),entries:new Map(),nextIndex:0});
  for(const e of s.entities)if(alive(e))indexEntity(s,e);
}
function nearbyEntities(s,p,r){
  const spatial=spatialStates.get(s);if(!spatial)return s.entities;
  const entries=[];
  for(let y=Math.floor((p.y-r)/SPATIAL_CELL);y<=Math.floor((p.y+r)/SPATIAL_CELL);y++)for(let x=Math.floor((p.x-r)/SPATIAL_CELL);x<=Math.floor((p.x+r)/SPATIAL_CELL);x++)for(const entry of spatial.buckets.get(`${x},${y}`)||[])entries.push(entry);
  return entries.sort((a,b)=>a.index-b.index).map(entry=>entry.e);
}

export function unitRank(e){return e?.kind==='unit'?Math.min(3,Math.floor(Math.max(0,e.kills||0)/5)):0;}
export function unitStats(e){
  const d=UNITS[e?.type];if(!d)return null;
  const rank=unitRank(e),bonus=1+rank*.2,tech=e.tech||[],infantry=d.armor==='infantry';
  return{rank,hp:d.hp*bonus*(infantry&&tech.includes('infantryArmor')?1.2:1),damage:d.damage*bonus*(tech.includes(infantry?'infantryWeapons':'vehicleWeapons')?1.18:1)*(tech.includes('advancedBallistics')&&['rocket','artillery'].includes(entityRole(e))?1.1:1),speed:d.speed*bonus*(!infantry&&tech.includes('mobility')?1.15:1)};
}

export function mapLayout(s){
  if(s.width===72&&s.height===56)return{start:{x:12,y:37},end:{x:59,y:12},bend:10};
  const start={x:Math.round(s.width/6),y:Math.round(s.height*.72)},end={x:s.width+1-start.x,y:s.height+1-start.y};
  const bend=(s.mapProfile==='basin'?12:s.mapProfile==='highlands'?9:10)*Math.min(s.width/72,s.height/56);
  return{start,end,bend};
}

function random(s){let x=s.rng|0;x^=x<<13;x^=x>>>17;x^=x<<5;s.rng=x>>>0;return s.rng/4294967296;}
function hash(seed){let h=2166136261;for(const c of String(seed)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0||1;}
function event(s,text,team=0){s.events.push({text,team,time:s.time});}
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
  if(previous!==p.status){s.teams[team].powerStatus=p.status;if(p.status==='brownout')event(s,'Power shortage: defenses offline; production, research and repairs slowed.',team);else if(p.status==='reserve')event(s,'Capacitor reserve engaged. Restore power before it empties.',team);else if(previous)event(s,'Power grid restored.',team);}
  return p;
}

export function researchStatus(s,team,id){
  const base={completed:!!s.teams[team]?.research?.[id],queued:own(s,team,'lab').some(e=>e.research?.id===id)};
  const result=reason=>({...bad(reason),...base});
  if(!Object.hasOwn(RESEARCH,id)||![0,1].includes(team))return result('Unknown research');
  if(base.completed)return result('Research complete');
  if(base.queued)return result('Research in progress');
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
  s.teams[team].credits-=RESEARCH[id].cost;lab.research={id,progress:0};event(s,`${RESEARCH[id].name}: research started`,team);return{...good(),id:lab.id};
}
export function cancelResearch(s,id,team=0){
  const lab=getEntity(s,id);
  if(s.status!=='playing'||!lab||lab.team!==team||entityRole(lab)!=='lab'||!lab.research)return bad('Select your active laboratory');
  const refund=RESEARCH[lab.research.id].cost;s.teams[team].credits+=refund;delete lab.research;return{...good(),refund};
}
function finishResearch(s,lab){
  const id=lab.research.id;s.teams[lab.team].research??={};s.teams[lab.team].research[id]=true;delete lab.research;
  for(const e of own(s,lab.team))if(e.kind==='unit'){e.tech=Object.keys(RESEARCH).filter(key=>s.teams[e.team].research[key]);const hp=unitStats(e).hp;e.hp=Math.min(hp,e.hp+hp-e.maxHp);e.maxHp=hp;}
  event(s,`${RESEARCH[id].name}: research complete`,lab.team);
}
export function buildingUpgradeStatus(s,team,entityId,id){
  const e=getEntity(s,entityId),d=BUILDING_UPGRADES[id],base={completed:!!e?.upgrades?.[id],queued:e?.upgrade?.id===id};
  const result=reason=>({...bad(reason),...base});
  if(!Object.hasOwn(BUILDING_UPGRADES,id)||!e||e.kind!=='building'||e.team!==team)return result('Select your structure');
  if(!d.types.includes(entityRole(e)))return result('Upgrade unavailable for this structure');
  if(base.completed)return result('Upgrade complete');if(base.queued)return result('Upgrade in progress');
  if(s.status!=='playing')return result('Operation has ended');
  if(e.progress<1)return result('Finish construction first');
  if(e.upgrade)return result('Structure upgrade in progress');
  const missing=d.requires.find(key=>!completed(s,team,key));if(missing)return result(`Requires ${BUILDINGS[raceBuilding(s,team,missing)].name}`);
  if(s.teams[team].credits<d.cost)return result('Insufficient credits');
  return{...good(),...base};
}
export function startBuildingUpgrade(s,team,entityId,id){
  const result=buildingUpgradeStatus(s,team,entityId,id);if(!result.ok)return result;
  s.teams[team].credits-=BUILDING_UPGRADES[id].cost;getEntity(s,entityId).upgrade={id,progress:0};event(s,`${BUILDING_UPGRADES[id].name}: upgrade started`,team);return good();
}

function addEntity(s,team,kind,type,x,y,built=true){
  const d=kind==='building'?BUILDINGS[type]:UNITS[type];
  const e={id:s.nextId++,team,kind,type,x,y,hp:built?d.hp:d.hp*.2,maxHp:d.hp,size:d.size,angle:team?Math.PI:0,progress:built?1:0,cooldown:random(s),order:{type:'idle'},path:[],repath:0};
  if(kind==='unit'){e.kills=0;e.tech=Object.keys(RESEARCH).filter(key=>s.teams[team].research?.[key]);e.hp=e.maxHp=unitStats(e).hp;}
  const role=entityRole(type);
  if(role==='capacitor')e.reserve=0;
  if(kind==='building'){e.queue=[];if(role==='refinery')e.haulerPending=true;if(role==='refinery'||role==='core'){e.processingAmount=0;e.processingTotal=0;}s.navVersion++;}else if(role==='harvester'){e.cargo=0;e.unload=0;e.unloadDepotId=null;e.harvestPhase='gather';e.order={type:'harvest'};}
  s.entities.push(e);indexEntity(s,e);return e;
}

// Relief primitives: integer-hash value noise. Map generation never consumes combat RNG.
const lat=(x,y,k)=>{let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(k|0,1274126177))|0;h=Math.imul(h^h>>>15,2246822519);h=Math.imul(h^h>>>13,3266489917);return((h^h>>>16)>>>0)/4294967296;};
function vnoise(x,y,k){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);return(lat(ix,iy,k)*(1-u)+lat(ix+1,iy,k)*u)*(1-v)+(lat(ix,iy+1,k)*(1-u)+lat(ix+1,iy+1,k)*u)*v;}
function fbm(x,y,k,oct=3){let sum=0,amp=1,norm=0;for(let o=0;o<oct;o++){sum+=vnoise(x,y,k+o*101)*amp;norm+=amp;x=x*2.03+7.1;y=y*1.97+3.3;amp*=.5;}return sum/norm;}
const quantile=(a,q)=>{const sorted=a.slice().sort();return sorted[Math.min(a.length-1,Math.floor(a.length*q))];};
const PROFILE_RELIEF={
  rift:{wavelength:23,ridges:.22,mesas:.045,basalt:.22,gap:.43,ring:2.4,route:2.9,flank:2.5,trees:.028,lava:7,outcrop:4.5},
  basin:{wavelength:29,ridges:.10,mesas:.07,basalt:.47,gap:.5,ring:1.9,route:3.9,flank:3.2,trees:.04,lava:2,outcrop:3.8},
  highlands:{wavelength:19,ridges:.26,mesas:.08,basalt:.16,gap:.4,ring:3,route:2.7,flank:2.4,trees:.035,lava:3.5,outcrop:3.4},
};
const terrainProfile=s=>PROFILE_RELIEF[s.mapProfile]||PROFILE_RELIEF.rift;
// Every terrain mutation has a mirrored partner, including gates, mineral access, lava and tree roots.
function mirroredTerrain(s,i,type){s.terrain[i]=type;s.terrain[s.terrain.length-1-i]=type;}

function relief(s){
  const {width:W,height:H}=s,N=W*H,k=hash(`${s.seed}:relief:${s.mapProfile}`),rules=terrainProfile(s),{start,end}=mapLayout(s);
  const cx=W/2,cy=H/2,dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
  const field=(u,v)=>{
    const px=u/rules.wavelength,py=v*.63/rules.wavelength;
    const wx=px+(fbm(px*.7+31,py*.7,k+7,2)-.5)*.9,wy=py+(fbm(px*.7,py*.7+17,k+13,2)-.5)*.9;
    const r=fbm(wx*1.3+5,wy*1.3,k+40,2);
    return[fbm(wx,wy,k,3),1-Math.abs(2*r-1),vnoise(u/10,v/10,k+120)];
  };
  const height=new Float32Array(N),ridge=new Float32Array(N),gap=new Float32Array(N);
  for(let i=0;i<N/2;i++){
    const x=i%W+.5-cx,y=Math.floor(i/W)+.5-cy,u=x*ux+y*uy,v=-x*uy+y*ux;
    let f;
    if(u>=3)f=field(u,v);else if(u<=-3)f=field(-u,-v);
    else{const a=field(u,v),b=field(-u,-v),t=u/6+.5,w=t*t*(3-2*t);f=[a[0]*w+b[0]*(1-w),a[1]*w+b[1]*(1-w),a[2]*w+b[2]*(1-w)];}
    const m=N-1-i;height[i]=height[m]=f[0];ridge[i]=ridge[m]=f[1];gap[i]=gap[m]=f[2];
  }
  const open=ridge.filter((_,i)=>gap[i]>rules.gap),mesa=quantile(height,1-rules.mesas),basin=quantile(height,rules.basalt),crest=open.length?quantile(open,Math.max(0,1-rules.ridges*N/open.length)):Infinity;
  for(let i=0;i<N/2;i++)mirroredTerrain(s,i,ridge[i]>crest&&gap[i]>rules.gap||height[i]>mesa?1:height[i]<basin?2:0);
  // Rounded satellite outcrops leave room for maneuver, and supply separate broad lava shores.
  const rng={rng:hash(`${s.seed}:outcrops:${s.mapProfile}`)},target=Math.round(6*Math.sqrt(N/(72*56))),exclusion=19;
  const rockNear=(x,y,R)=>{for(let yy=Math.floor(y-R);yy<=y+R;yy++)for(let xx=Math.floor(x-R);xx<=x+R;xx++)if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<=R*R&&s.terrain[yy*W+xx]===1)return true;return false;};
  for(let attempt=0,placed=0;placed<target&&attempt<target*48;attempt++){
    const r=2+random(rng)*(rules.outcrop-2),x=5+Math.floor(random(rng)*(W-10)),y=5+Math.floor(random(rng)*(H/2-10)),m={x:W-1-x,y:H-1-y};
    if(distance({x,y},m)<2*r+4||[start,end].some(c=>distance(c,{x,y})<exclusion+r||distance(c,m)<exclusion+r)||rockNear(x,y,r+1.2))continue;
    placed++;
    for(let yy=Math.floor(y-r-1);yy<=y+r+1;yy++)for(let xx=Math.floor(x-r-1);xx<=x+r+1;xx++){
      const rr=r+(vnoise(xx/3,yy/3,k+77)-.5)*1.4;
      if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<rr*rr)mirroredTerrain(s,yy*W+xx,1);
    }
  }
}
// Broken plateau gates and protected approach lanes give each base the same defensive footprint.
function plateauRing(s,protectedGround){
  const {width:W,height:H}=s,k=hash(`${s.seed}:relief`)+50,{start}=mapLayout(s),scale=Math.min(W/72,H/56),ringIn=12.5+scale,ringOut=ringIn+terrainProfile(s).ring;
  if(scale<2)return;
  const c=start;
  for(let y=Math.max(0,Math.floor(c.y-ringOut-2));y<=Math.min(H-1,c.y+ringOut+2);y++)for(let x=Math.max(0,Math.floor(c.x-ringOut-2));x<=Math.min(W-1,c.x+ringOut+2);x++){
    const i=y*W+x;if(protectedGround[i])continue;
    const d=Math.hypot(x-c.x,y-c.y)+(vnoise(x/5,y/5,k)-.5)*3;
    if(d>=ringIn&&d<=ringOut)mirroredTerrain(s,i,1);
  }
}
function mineralBowls(s,centers){
  const {width:W,height:H}=s,k=hash(`${s.seed}:relief`)+60;
  for(const c of centers)for(let y=Math.max(0,Math.floor(c.y-7));y<=Math.min(H-1,c.y+7);y++)for(let x=Math.max(0,Math.floor(c.x-7));x<=Math.min(W-1,c.x+7);x++){
    const i=y*W+x,d=Math.hypot(x-c.x,y-c.y)+(vnoise(x/4,y/4,k)-.5)*2;
    if(d<=5.7&&s.terrain[i]===1)mirroredTerrain(s,i,0);
  }
}
// One flood and one multi-source breadth-first search connect every large or resource-bearing pocket.
// Unlike the former all-pairs nearest-tile scan, work is linear in map area, even on the vast setting.
function breachPockets(s,clear){
  const {width:W}=s,N=s.terrain.length,{start}=mapLayout(s),regions=new Uint32Array(N),queue=new Int32Array(N),sizes=[0],resources=[false];
  let count=0;
  const neighbors=(at,visit)=>{const x=at%W;if(x>0)visit(at-1);if(x<W-1)visit(at+1);if(at>=W)visit(at-W);if(at<N-W)visit(at+W);};
  for(let i=0;i<N;i++){
    if(regions[i]||s.terrain[i]===1||s.terrain[i]===3||s.terrain[i]===4)continue;
    const id=++count;let tail=1;queue[0]=i;regions[i]=id;sizes[id]=0;resources[id]=false;
    for(let head=0;head<tail;head++){
      const at=queue[head];sizes[id]++;if(s.minerals[at]>0)resources[id]=true;
      neighbors(at,next=>{if(!regions[next]&&[0,2,5].includes(s.terrain[next])){regions[next]=id;queue[tail++]=next;}});
    }
  }
  const main=regions[cell(s,start.x,start.y)],needed=new Set();
  for(let id=1;id<=count;id++)if(id!==main&&(sizes[id]>=30||resources[id]))needed.add(id);
  if(!needed.size)return;
  const parent=new Int32Array(N);parent.fill(-1);let tail=0;
  for(let i=0;i<N;i++)if(regions[i]===main){queue[tail++]=i;parent[i]=i;}
  for(let head=0;head<tail&&needed.size;head++){
    const at=queue[head];
    neighbors(at,next=>{
      if(parent[next]!==-1)return;parent[next]=at;queue[tail++]=next;
      const id=regions[next];if(!needed.has(id))return;
      needed.delete(id);
      for(let p=next;parent[p]!==p;p=parent[p])clear(p%W,Math.floor(p/W),1.65);
    });
  }
}

function generateMap(s){
  const {width:W,height:H}=s,N=W*H,{start,end,bend}=mapLayout(s),rules=terrainProfile(s);
  relief(s);
  const protectedGround=new Uint8Array(N);
  const clear=(x,y,r)=>{for(let yy=Math.floor(y-r);yy<=y+r;yy++)for(let xx=Math.floor(x-r);xx<=x+r;xx++)if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<=r*r){const i=yy*W+xx;mirroredTerrain(s,i,0);protectedGround[i]=protectedGround[N-1-i]=1;}};
  clear(start.x,start.y,11.5);clear(end.x,end.y,11.5);
  plateauRing(s,protectedGround);
  // Three broad, continuous routes; their bends leave flanking expansion shelves between them.
  const routeSteps=Math.ceil(distance(start,end)*2);
  for(let i=0;i<=routeSteps;i++){
    const t=i/routeSteps,x=start.x+(end.x-start.x)*t,y=start.y+(end.y-start.y)*t;
    clear(x,y,rules.route);clear(x,y+Math.sin(t*Math.PI)*bend,rules.flank);clear(x,y-Math.sin(t*Math.PI)*bend,rules.flank);
  }
  const centers=[],scatterRng={rng:hash(`${s.seed}:mineral-scatter`)},treeRng={rng:hash(`${s.seed}:trees`)};
  const access=(a,b)=>{const steps=Math.max(1,Math.ceil(distance(a,b)*2));for(let i=0;i<=steps;i++)clear(a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps,.95);};
  const field=(a,type)=>{
    const b={x:W-1-a.x,y:H-1-a.y},candidates=[];
    for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){
      const radius=x*x+y*y;if(!radius||radius>22)continue;
      const points=[{x:a.x+x,y:a.y+y},{x:b.x-x,y:b.y-y}];
      if(points.some(p=>p.x<1||p.y<1||p.x>=W-1||p.y>=H-1||distance(p,start)<7||distance(p,end)<7))continue;
      candidates.push({x,y,radius,score:random(scatterRng)});
    }
    candidates.sort((a,b)=>a.score-b.score);
    // Loose inner deposits and outer satellites retain visible gaps at every zoom.
    const offsets=[{x:0,y:0},...candidates.filter(p=>p.radius<=8).slice(0,10),...candidates.filter(p=>p.radius>8).slice(0,8)];
    centers.push(a,b);
    for(const p of offsets){
      const x=a.x+p.x,y=a.y+p.y,i=y*W+x,amount=(320+Math.floor(random(scatterRng)*300))*(type===3?2:1);
      access(a,{x,y});s.minerals[i]=s.minerals[N-1-i]=amount;s.mineralTypes[i]=s.mineralTypes[N-1-i]=type;
    }
  };
  // Safe mint starter fields, a blue natural expansion, and richer exposed central red reserves.
  field({x:start.x+8,y:start.y+1},1);field({x:start.x,y:start.y+9},1);
  const near={x:start.x-7,y:start.y-14};field(near,2);
  const central={x:Math.round(W*.43),y:Math.round(H*.46)};field(central,3);
  const flank={x:Math.round(W*.39),y:Math.round(H*(s.mapProfile==='highlands'?.76:.70))};field(flank,s.mapProfile==='basin'?2:3);
  const resourceRng={rng:hash(`${s.seed}:fields:${s.mapProfile}`)},targetPairs=Math.max(5,Math.round(4+N/2400));
  for(let attempt=0;centers.length<targetPairs*2&&attempt<1600;attempt++){
    const a={x:6+Math.floor(random(resourceRng)*(W/2-12)),y:6+Math.floor(random(resourceRng)*(H-12))},b={x:W-1-a.x,y:H-1-a.y};
    if([a,b].some(p=>distance(p,start)<20||distance(p,end)<20||centers.some(c=>distance(c,p)<10))||distance(a,b)<10)continue;
    const contested=Math.abs(a.x-W/2)<W*.18&&distance(a,start)>W*.26;
    field(a,contested?3:2);
  }
  mineralBowls(s,centers);
  breachPockets(s,clear);
  addLavaPools(s);
  // Each mirrored pair is isolated by an open neighbor ring, so roots cannot close a route.
  for(let i=W+1;i<N/2;i++){
    const x=i%W,y=Math.floor(i/W),mx=W-1-x,my=H-1-y,m=N-1-i;
    if(x<1||x>=W-1||random(treeRng)>rules.trees||protectedGround[i]||protectedGround[m]||Math.abs(x-mx)<3&&Math.abs(y-my)<3)continue;
    let open=true;
    for(const at of [i,m])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const p=at+dy*W+dx;if(![0,2,5].includes(s.terrain[p])||s.minerals[p]>0)open=false;}
    if(open)mirroredTerrain(s,i,4);
  }
  addCraters(s,protectedGround,centers);
}

// Craters offer exposed firing positions beside the main approaches. They never overwrite a route,
// resource bowl, base clearing, tree root or rock obstacle, so cover cannot close a guaranteed path.
function addCraters(s,protectedGround,fields){
  const {width:W,height:H}=s,N=W*H;if(N<8000)return;
  const rng={rng:hash(`${s.seed}:craters:${s.mapProfile}`)},k=hash(`${s.seed}:crater-rims`),{start,end}=mapLayout(s);
  const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy),target=Math.round((s.mapProfile==='highlands'?5:s.mapProfile==='basin'?3:4)*Math.sqrt(N/(72*56))),centers=[];
  for(let attempt=0;centers.length<target&&attempt<target*90;attempt++){
    const c={x:7+Math.floor(random(rng)*(W-14)),y:7+Math.floor(random(rng)*(H/2-14))},r=2.8+random(rng)*2.1,m={x:W-1-c.x,y:H-1-c.y};
    const routeDistance=Math.abs(-dy*(c.x-start.x)+dx*(c.y-start.y))/length;
    if(routeDistance>Math.min(W,H)*.3||distance(c,m)<r*2+4||[c,m].some(p=>[start,end].some(base=>distance(p,base)<r+18)||fields.some(field=>distance(p,field)<r+6)||centers.some(other=>distance(p,other)<r+7)))continue;
    const cells=[];let available=true;
    for(let y=Math.floor(c.y-r-1);y<=c.y+r+1;y++)for(let x=Math.floor(c.x-r-1);x<=c.x+r+1;x++){
      const edge=r+(vnoise(x/3,y/3,k)-.5)*.6;
      if(sq(x-c.x)+sq((y-c.y)/.83)>edge*edge)continue;
      const i=y*W+x;
      if(!inside(s,x,y)||protectedGround[i]||![0,2].includes(s.terrain[i])||s.minerals[i]>0){available=false;break;}
      cells.push(i);
    }
    if(!available||cells.length<16)continue;
    centers.push(c);for(const i of cells)mirroredTerrain(s,i,5);
  }
}
export function terrainCover(s,e){
  return e?.kind==='unit'&&e.hp>0&&inside(s,e.x,e.y)&&s.terrain[cell(s,e.x,e.y)]===5?.15:0;
}

function addLavaPools(s){
  const {width:W,height:H}=s,N=W*H,{start:base,end}=mapLayout(s),dx=end.x-base.x,dy=end.y-base.y,rules=terrainProfile(s);
  // Recolor complete, compact formations; shorelines cannot obstruct an existing route.
  const visited=new Uint8Array(N),pools=[],lavaRng={rng:hash(`${s.seed}:lava:${s.mapProfile}`)};
  for(let start=0;start<N;start++){
    if(visited[start]||s.terrain[start]!==1)continue;
    const tiles=[start];visited[start]=1;let minX=W,maxX=0,minY=H,maxY=0,maxAt=start;
    for(let head=0;head<tiles.length;head++){
      const at=tiles[head],x=at%W,y=Math.floor(at/W);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);maxAt=Math.max(maxAt,at);
      for(const next of [x>0?at-1:-1,x<W-1?at+1:-1,y>0?at-W:-1,y<H-1?at+W:-1])if(next>=0&&!visited[next]&&s.terrain[next]===1){visited[next]=1;tiles.push(next);}
    }
    // Only select one member of a mirror pair, and keep long ridge walls as raised rock.
    if(start>N-1-maxAt||tiles.length<12||tiles.length>220||minX<3||maxX>=W-3||minY<3||maxY>=H-3||tiles.length/((maxX-minX+1)*(maxY-minY+1))<.38)continue;
    const x=(minX+maxX)/2,y=(minY+maxY)/2,routeDistance=Math.abs(-dy*(x-base.x)+dx*(y-base.y))/Math.hypot(dx,dy);
    pools.push({tiles,score:Math.max(0,routeDistance-7)+random(lavaRng)*14});
  }
  pools.sort((a,b)=>a.score-b.score||a.tiles[0]-b.tiles[0]);
  const count=Math.round(rules.lava*Math.sqrt(N/(72*56)));
  for(const pool of pools.slice(0,count))for(const at of pool.tiles)mirroredTerrain(s,at,3);
}

const newAI=difficulty=>({nextThink:3,nextRaid:difficulty==='easy'?300:difficulty==='hard'?100:150,known:{},mode:'Establishing base',scoutIndex:0,buildIndex:0,raid:0});
function aiState(s,team){return team===1?s.ai:s.aiByTeam?.[team];}
export function createGame(seed='ASH-001',difficulty='normal',{width:W=MAP_WIDTH,height:H=MAP_HEIGHT,profile='rift',races=['organics','organics'],aiTeams=[1]}={}){
  if(!((W===72&&H===56)||Object.values(MAP_SIZES).some(size=>W===size.width&&H===size.height)))throw new RangeError('Unsupported map dimensions');
  if(!Object.hasOwn(MAP_PROFILES,profile))throw new RangeError('Unsupported terrain profile');
  if(!Array.isArray(races)||races.length!==2||races.some(race=>!Object.hasOwn(RACES,race)))throw new RangeError('Unsupported race pairing');
  if(!Array.isArray(aiTeams)||aiTeams.some(team=>![0,1].includes(team))||new Set(aiTeams).size!==aiTeams.length)throw new RangeError('Unsupported AI teams');
  const N=W*H;
  const s={width:W,height:H,mapProfile:profile,seed:String(seed),difficulty:['easy','normal','hard'].includes(difficulty)?difficulty:'normal',rng:hash(seed),nextId:1,time:0,status:'playing',terrain:new Uint8Array(N),minerals:new Float32Array(N),mineralTypes:new Uint8Array(N),visible:[new Uint8Array(N),new Uint8Array(N)],explored:[new Uint8Array(N),new Uint8Array(N)],entities:[],teams:[{credits:1800,kills:0},{credits:1800,kills:0}],effects:[],events:[],navVersion:0,navBuilt:-1,blocked:new Uint8Array(N),fogClock:0,ai:{nextThink:3,nextRaid:105,known:{},mode:'Establishing base',scoutIndex:0,buildIndex:0,raid:0}};
  s.ai.nextRaid=s.difficulty==='easy'?300:s.difficulty==='hard'?100:150;
  s.teams.forEach((team,index)=>{team.race=races[index];});s.aiTeams=[...aiTeams];
  if(aiTeams.includes(0))s.aiByTeam={0:newAI(s.difficulty)};
  generateMap(s);
  const {start,end}=mapLayout(s);
  for(let team=0;team<2;team++){
    const building=(role,x,y)=>{const type=raceBuilding(s,team,role);return addEntity(s,team,'building',type,team?end.x+11-x-BUILDINGS[type].size:start.x+x-12,team?end.y+36-y-BUILDINGS[type].size:start.y+y-37);};
    const unit=(role,x,y)=>addEntity(s,team,'unit',raceUnit(s,team,role),team?end.x+11-x:start.x+x-12,team?end.y+36-y:start.y+y-37);
    building('core',10,35);building('reactor',6,35);building('refinery',15,38);
    for(let j=0;j<3;j++)unit('rifle',11+j,33.7);
    unit('scout',15.5,33);
  }
  // Initial footprints must never contain shards, including the generated field fringe.
  for(const e of s.entities)if(e.kind==='building')for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++){s.terrain[y*W+x]=0;s.minerals[y*W+x]=0;}
  rebuildNavigation(s);for(const e of [...s.entities])deliverRefineryHauler(s,e);
  updateFog(s);event(s,'Command online. Secure the shards. Destroy the hostile nexus.');
  return s;
}

function rebuildNavigation(s){
  const {width:W,height:H}=s,N=W*H;
  if(s.navBuilt===s.navVersion&&s.regionSize)return;
  for(let i=0;i<N;i++)s.blocked[i]=s.terrain[i]===1||s.terrain[i]===3||s.terrain[i]===4?1:0;
  for(const e of s.entities)if(alive(e)&&e.kind==='building')for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)s.blocked[y*W+x]=1;
  // Connected regions let haulers skip isolated mineral pockets without repeated A* failures.
  s.regions=new Uint16Array(N);let region=0;const queue=new Int32Array(N);
  for(let start=0;start<N;start++)if(!s.blocked[start]&&!s.regions[start]){
    region++;let head=0,tail=1;queue[0]=start;s.regions[start]=region;
    while(head<tail){const at=queue[head++],x=at%W,y=Math.floor(at/W);for(const next of [x>0?at-1:-1,x<W-1?at+1:-1,y>0?at-W:-1,y<H-1?at+W:-1])if(next>=0&&!s.blocked[next]&&!s.regions[next]){s.regions[next]=region;queue[tail++]=next;}}
  }
  // Region sizes are derived, never saved: a loaded map rebuilds them once.
  s.regionSize=new Uint32Array(region+1);for(let i=0;i<N;i++)s.regionSize[s.regions[i]]++;
  s.navBuilt=s.navVersion;
}
function walkable(s,x,y,r=.19){
  const {width:W,height:H}=s;
  if(x<r||y<r||x>=W-r||y>=H-r)return false;
  for(const yy of [y-r,y+r])for(const xx of [x-r,x+r])if(s.blocked[cell(s,xx,yy)])return false;
  return true;
}
function seen(s,team,e){if(e.team===team)return true;const c=center(e);if(!inside(s,c.x,c.y))return false;if(s.visible[team][cell(s,c.x,c.y)])return true;if(e.kind==='building')for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)if(s.visible[team][y*s.width+x])return true;return false;}

export function canPlace(s,team,type,x,y){
  const {width:W,height:H}=s;
  const d=BUILDINGS[type];if(s.status!=='playing')return bad('Operation has ended');if(!d||![0,1].includes(team))return bad('Unknown structure');
  if(d.race!=='both'&&d.race!==teamRace(s,team))return bad('Structure belongs to a different race');
  if(!Number.isFinite(x)||!Number.isFinite(y)||x!==Math.floor(x)||y!==Math.floor(y))return bad('Place on the ground grid');
  if(buildingRole(type)==='core')return bad('Deploy a nexus construction vehicle to establish a new nexus');
  if(s.teams[team].credits<d.cost)return bad('Insufficient credits');
  const missing=d.requires.find(key=>!completed(s,team,key));if(missing)return bad(`Requires ${BUILDINGS[missing].name}`);
  if(buildingRole(type)==='refinery'&&reservedUnits(s,team)>=unitCapacity(s,team))return bad(`Unit limit reached (${unitCapacity(s,team)}); refinery includes a hauler`);
  if(x<1||y<1||x+d.size>=W||y+d.size>=H)return bad('Outside construction zone');
  rebuildNavigation(s);
  for(let yy=y;yy<y+d.size;yy++)for(let xx=x;xx<x+d.size;xx++){
    const i=yy*W+xx;if(!s.visible[team][i])return bad('Requires sensor coverage');if(s.terrain[i]===3)return bad('Lava prevents construction');if(s.terrain[i]===4)return bad('Tree roots obstruct construction');if(s.terrain[i]===5)return bad('Crater ground cannot support construction');if(s.blocked[i])return bad('Ground is obstructed');if(s.minerals[i]>0)return bad('Shard field obstructs construction');
  }
  if(s.entities.some(e=>alive(e)&&e.kind==='unit'&&e.x>x-.3&&e.x<x+d.size+.3&&e.y>y-.3&&e.y<y+d.size+.3))return bad('Unit in construction area');
  const nearFinished=own(s,team).some(e=>e.kind==='building'&&e.progress>=1&&Math.hypot(Math.max(e.x-x-d.size,x-e.x-e.size,0),Math.max(e.y-y-d.size,y-e.y-e.size,0))<=7);
  const extendsWall=buildingRole(type)==='wall'&&own(s,team).some(e=>e.kind==='building'&&buildingRole(e)==='wall'&&Math.abs(e.x-x)+Math.abs(e.y-y)===1);
  if(!nearFinished&&!extendsWall)return bad('Build within 7 tiles of a finished structure');
  return good();
}
export function placeBuilding(s,team,type,x,y){
  const result=canPlace(s,team,type,x,y);if(!result.ok)return result;
  s.teams[team].credits-=BUILDINGS[type].cost;const entity=addEntity(s,team,'building',type,x,y,false);event(s,`${BUILDINGS[type].name}: construction started`,team);return{...result,id:entity.id};
}
export function deploymentStatus(s,team,unitId,x,y){
  if(s.status!=='playing')return bad('Operation has ended');
  const u=getEntity(s,unitId);
  if(![0,1].includes(team)||!u||u.team!==team||u.kind!=='unit'||unitRole(u)!=='constructor')return bad('Select your nexus construction vehicle');
  if(!Number.isInteger(x)||!Number.isInteger(y))return bad('Place on the ground grid');
  const d=BUILDINGS[raceBuilding(s,team,'core')];
  if(x<1||y<1||x+d.size>=s.width||y+d.size>=s.height)return bad('Outside construction zone');
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
  event(s,`${BUILDINGS[type].name}: deployment started`,team);
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
  const all=wallLineCells(x1,y1,x2,y2),raw=all.slice(0,48),cost=BUILDINGS.wall.cost,cells=[];
  let remaining=s.teams[team].credits,reason='',count=0;
  for(const point of raw){
    let result=reason?bad('Previous segment is unavailable'):canPlace(s,team,'wall',point.x,point.y);
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
  if(ids.length)event(s,`${ids.length} wall segment${ids.length===1?'':'s'} started: ${cost} credits`,team);
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
  event(s,`${BUILDINGS[e.type].name} sold: +${refund} credits`,team);
  return{...good(),refund};
}
export function trainUnit(s,team,type,producerId){
  const d=UNITS[type];if(s.status!=='playing')return bad('Operation has ended');if(!d||![0,1].includes(team))return bad('Unknown unit');
  if(d.race!==teamRace(s,team))return bad('Unit belongs to a different race');
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
  s.teams[team].credits-=d.cost;producer.queue.push({type,progress:0});return good();
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

function movementDestinations(s,units,x,y){
  rebuildNavigation(s);
  const selected=new Set(units.map(u=>u.id)),groups=new Map(),slots=[];
  for(const u of units){const region=s.regions[cell(s,u.x,u.y)];if(!groups.has(region))groups.set(region,{count:0,size:0});const g=groups.get(region);g.count++;g.size=Math.max(g.size,u.size);}
  const occupied=new Map(),occupy=p=>{const key=`${Math.floor(p.x/2)},${Math.floor(p.y/2)}`;if(!occupied.has(key))occupied.set(key,[]);occupied.get(key).push(p);};
  for(const e of s.entities)if(alive(e)&&e.kind==='unit'&&!selected.has(e.id)){
    if(e.team===units[0].team&&['move','attackMove'].includes(e.order.type))occupy({...e.order,size:e.size});
    else if((e.order.type==='idle'||!e.moving)&&seen(s,units[0].team,e))occupy(e);
  }
  const free=(p,size)=>{
    if(!walkable(s,p.x,p.y,size*.43+.08))return false;
    const cx=Math.floor(p.x/2),cy=Math.floor(p.y/2);
    for(let yy=cy-1;yy<=cy+1;yy++)for(let xx=cx-1;xx<=cx+1;xx++)for(const e of occupied.get(`${xx},${yy}`)||[])if(sq(p.x-e.x)+sq(p.y-e.y)<=sq((size+e.size)*.43+.18))return false;
    return true;
  };
  const region=s.regions[cell(s,x,y)];
  // Keep precise single-unit clicks when free; groups reserve distinct cells so A* cannot merge them.
  if(units.length===1&&region&&region===s.regions[cell(s,units[0].x,units[0].y)]&&free({x,y},units[0].size))return new Map([[units[0].id,{x,y}]]);
  const candidates=[];
  for(let i=0;i<s.blocked.length;i++)if(!s.blocked[i]&&groups.has(s.regions[i])&&s.regions[i])candidates.push(i);
  const score=i=>sq(i%s.width+.5-x)+sq(Math.floor(i/s.width)+.5-y);
  candidates.sort((a,b)=>score(a)-score(b)||a-b);
  // One bounded map scan also handles blocked clicks, map edges and disconnected destinations.
  for(const i of candidates){
    const region=s.regions[i],g=groups.get(region);if(!g.count)continue;
    const p={x:i%s.width+.5,y:Math.floor(i/s.width)+.5,region};
    if(!free(p,g.size))continue;slots.push(p);occupy({...p,size:g.size});g.count--;
    if(slots.length===units.length)break;
  }
  const assigned=new Map(),remaining=[...units].sort((a,b)=>a.id-b.id);
  // Repeated orders keep the same individual slot, including an active traffic yield.
  for(let i=remaining.length-1;i>=0;i--){const u=remaining[i],at=slots.findIndex(p=>p.x===u.order.x&&p.y===u.order.y&&p.region===s.regions[cell(s,u.x,u.y)]);if(at>=0){assigned.set(u.id,slots.splice(at,1)[0]);remaining.splice(i,1);}}
  if(remaining.length>200){
    // Large armies assign nearer units first in quadratic time, avoiding a cubic frame stall.
    remaining.sort((a,b)=>sq(a.x-x)+sq(a.y-y)-sq(b.x-x)-sq(b.y-y)||a.id-b.id);
    for(const u of remaining){
      const region=s.regions[cell(s,u.x,u.y)];let best=Infinity,slot=-1;
      for(let i=0;i<slots.length;i++)if(slots[i].region===region){const d=sq(u.x-slots[i].x)+sq(u.y-slots[i].y);if(d<best){best=d;slot=i;}}
      if(slot>=0)assigned.set(u.id,slots.splice(slot,1)[0]);
    }
    return assigned;
  }
  while(remaining.length&&slots.length){
    let best=Infinity,unit=-1,slot=-1;
    for(let i=0;i<remaining.length;i++)for(let j=0;j<slots.length;j++)if(slots[j].region===s.regions[cell(s,remaining[i].x,remaining[i].y)]){
      const d=sq(remaining[i].x-slots[j].x)+sq(remaining[i].y-slots[j].y);if(d<best){best=d;unit=i;slot=j;}
    }
    if(unit<0)break;
    assigned.set(remaining[unit].id,slots.splice(slot,1)[0]);remaining.splice(unit,1);
  }
  return assigned;
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
    const goals=movementDestinations(s,group.map(p=>p.u),group[0].x,group[0].y);
    for(const p of group){const goal=goals.get(p.u.id);if(goal){p.x=goal.x;p.y=goal.y;}else p.type=entityRole(p.u)==='harvester'?'harvest':'idle';}
  }
  plans.forEach(({u,type,x,y,target})=>{
    if(u.order.type===type&&u.order.x===x&&u.order.y===y&&(u.order.targetId??null)===target)return;
    if(u.order.type!==type||Math.hypot((u.order.x??u.x)-x,(u.order.y??u.y)-y)>1){delete u.trafficWait;delete u.passUntil;}
    u.order=type==='explore'||type==='idle'||type==='harvest'&&order.type!=='harvest'?{type}:{type,x,y,...(target?{targetId:target}:{})};u.targetId=null;u.path=[];u.repath=0;
    if(entityRole(u)==='harvester'){u.unloadDepotId=null;if(u.cargo>=UNITS.harvester.capacity)u.harvestPhase='return';}
  });
}
export function stopUnits(s,ids){for(const id of ids){const u=getEntity(s,id);if(u?.kind==='unit'){u.order={type:entityRole(u)==='harvester'?'harvest':'idle'};u.targetId=null;u.path=[];u.repath=0;delete u.trafficWait;delete u.passUntil;if(entityRole(u)==='harvester')u.unloadDepotId=null;}}}

function updateFog(s){
  const {width:W,height:H}=s;
  for(let team=0;team<2;team++){
    const v=s.visible[team],explored=s.explored[team];v.fill(0);
    for(const e of own(s,team)){
      const c=center(e),r=e.progress<1?4:definition(e).sight;
      for(let y=Math.max(0,Math.floor(c.y-r));y<=Math.min(H-1,c.y+r);y++)for(let x=Math.max(0,Math.floor(c.x-r));x<=Math.min(W-1,c.x+r);x++)if(sq(x+.5-c.x)+sq(y+.5-c.y)<=r*r){v[y*W+x]=1;explored[y*W+x]=1;}
    }
  }
  for(const team of s.aiTeams||[1]){
    const ai=aiState(s,team);if(!ai)continue;
    for(const e of s.entities)if(e.team!==team&&alive(e)&&seen(s,team,e)){const c=center(e);ai.known[e.id]={id:e.id,kind:e.kind,type:e.type,x:c.x,y:c.y,hp:e.hp,seenAt:s.time};}
    for(const [id,m] of Object.entries(ai.known))if(s.visible[team][cell(s,m.x,m.y)]&&!s.entities.some(e=>e.id===Number(id)&&alive(e)&&seen(s,team,e)))delete ai.known[id];
  }
}

// A* searches static terrain/buildings. Units use local separation instead of blocking routes.
// A fixed search budget spreads obstructed army orders across ticks; direct open routes bypass A*.
let pathBudget=16,scratch={N:0};
function findPath(s,u,tx,ty,stop=0){
  if(clearStep(s,u,tx,ty))return[{x:tx,y:ty}];
  if(pathBudget<=0)return null;pathBudget--;
  const {width:W,height:H}=s,N=W*H;
  const start=cell(s,u.x,u.y),goalX=clamp(Math.floor(tx),0,W-1),goalY=clamp(Math.floor(ty),0,H-1);
  if(scratch.N!==N)scratch={N,costs:new Float32Array(N),parent:new Int32Array(N),closed:new Uint8Array(N)};
  const {costs,parent,closed}=scratch,heap=[];costs.fill(Infinity);costs[start]=0;parent.fill(-1);closed.fill(0);
  const heuristic=i=>Math.hypot(i%W+.5-tx,Math.floor(i/W)+.5-ty);
  const push=(i,f)=>{let p=heap.length;heap.push({i,f});while(p){const q=(p-1)>>1;if(heap[q].f<=f)break;heap[p]=heap[q];p=q;}heap[p]={i,f};};
  const pop=()=>{const out=heap[0],last=heap.pop();if(heap.length){let p=0;while(p*2+1<heap.length){let q=p*2+1;if(q+1<heap.length&&heap[q+1].f<heap[q].f)q++;if(heap[q].f>=last.f)break;heap[p]=heap[q];p=q;}heap[p]=last;}return out.i;};
  let best=start,bestH=heuristic(start);push(start,bestH);let count=0;
  while(heap.length&&count++<N){
    const cur=pop();if(closed[cur])continue;closed[cur]=1;
    const h=heuristic(cur);if(h<bestH){best=cur;bestH=h;}
    const x=cur%W,y=Math.floor(cur/W);if(stop>=.2&&h<=Math.max(.75,stop)||(x===goalX&&y===goalY)){best=cur;break;}
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(!inside(s,xx,yy))continue;
      const next=yy*W+xx;if(s.blocked[next]||closed[next]||(dx&&dy&&(s.blocked[y*W+xx]||s.blocked[yy*W+x])))continue;
      const g=costs[cur]+(dx&&dy?1.4142:1);if(g>=costs[next])continue;costs[next]=g;parent[next]=cur;push(next,g+heuristic(next));
    }
  }
  const path=[];for(let at=best;at!==start&&at>=0;at=parent[at])path.push({x:at%W+.5,y:Math.floor(at/W)+.5});path.reverse();
  if(stop<.2&&clearStep(s,path.at(-1)||u,tx,ty))path.push({x:tx,y:ty});
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

function clearStep(s,u,x,y){
  // Check the whole segment so sidesteps and waypoint shortcuts cannot cut solid corners.
  const steps=Math.max(1,Math.ceil(Math.hypot(x-u.x,y-u.y)/.12));
  let previousX=u.x,previousY=u.y;
  for(let i=1;i<=steps;i++){
    const nx=u.x+(x-u.x)*i/steps,ny=u.y+(y-u.y)*i/steps;
    if(!walkable(s,nx,ny)||!walkable(s,nx,previousY)||!walkable(s,previousX,ny))return false;
    previousX=nx;previousY=ny;
  }
  return true;
}
function unitSpacing(a,b,time){return(a.size+b.size)*.43*(a.team===b.team&&Math.max(a.passUntil||0,b.passUntil||0)>time?0:1);}

function turnUnit(u,heading,dt,aiming=false){
  const infantry=UNITS[u.type].armor==='infantry';
  const delta=Math.atan2(Math.sin(heading-u.angle),Math.cos(heading-u.angle));
  if(Math.abs(delta)<.012){u.turnVelocity=0;return;}
  const rate=infantry?7:aiming?3.2:['scout','striker'].includes(entityRole(u))?2.6:1.8;
  const desired=clamp(delta*5,-rate,rate),acceleration=infantry?28:aiming?12:7;
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
    tx=u.order.x=goal.x;ty=u.order.y=goal.y;u.repath=0;
  }
  if(Math.hypot(tx-u.x,ty-u.y)<=stop+(precise?0:.12)){u.path=[];u.moveSpeed=0;u.turnVelocity=0;return true;}
  if(u.repath<=0||u.pathVersion!==s.navVersion||!u.pathGoal||Math.hypot(u.pathGoal.x-tx,u.pathGoal.y-ty)>1.4){
    const found=findPath(s,u,tx,ty,stop);if(!found){u.path=[];return false;}
    u.path=found;u.pathGoal={x:tx,y:ty};u.pathVersion=s.navVersion;u.repath=1.3+random(s)*.6;
  }
  if(!u.path.length){
    if(!precise)return Math.hypot(tx-u.x,ty-u.y)<=Math.max(stop+.8,1.1);
    if(!clearStep(s,u,tx,ty))return false;
    u.path=[{x:tx,y:ty}];
  }
  // Each pruned path leg is straight. Units stop and turn before starting the next leg.
  const p=u.path[0],dx=p.x-u.x,dy=p.y-u.y,d=Math.hypot(dx,dy);
  if(d<1e-6){u.path.shift();u.moveSpeed=0;return false;}
  const heading=Math.atan2(dy,dx),turn=Math.abs(Math.atan2(Math.sin(heading-u.angle),Math.cos(heading-u.angle)));
  if(turn>1e-8){
    u.moveSpeed=0;
    if(turn<.012){u.angle=heading;u.turnVelocity=0;}else turnUnit(u,heading,dt);
    movement.set(u.id,{x:u.x,y:u.y,dx:0,dy:0,step:0,traffic:false,rotating:true});
    return false;
  }
  u.turnVelocity=0;
  const baseSpeed=Math.min(unitStats(u).speed,u.order.speedLimit??Infinity);
  const remaining=Math.min(d,Math.max(0,Math.hypot(tx-u.x,ty-u.y)-stop));
  const targetSpeed=Math.min(baseSpeed,Math.max(.35,Math.sqrt(remaining*baseSpeed*3)));
  u.moveSpeed=Math.min(targetSpeed,(u.moveSpeed||0)+baseSpeed*2.8*dt);
  const step=Math.min(d,u.moveSpeed*dt),fx=dx/d,fy=dy/d;
  const intent={x:u.x,y:u.y,dx:fx,dy:fy,step,traffic:false};movement.set(u.id,intent);
  const nx=u.x+fx*step,ny=u.y+fy*step;
  if(!clearStep(s,u,nx,ny)){u.moveSpeed=0;u.repath=0;u.path=[];return false;}
  const neighbors=nearbyEntities(s,u,1.7).filter(e=>e!==u&&e.kind==='unit'&&alive(e)&&Math.abs(e.x-u.x)<1.7&&Math.abs(e.y-u.y)<1.7);
  const blocker=neighbors.find(other=>{
    const next=Math.hypot(nx-other.x,ny-other.y);
    if(next>=unitSpacing(u,other,s.time)-.001||next>=distance(u,other)-.001)return false;
    if(other.team===u.team)intent.traffic=true;return true;
  });
  if(blocker){
    u.moveSpeed=0;
    // Friendly traffic keeps its straight route and briefly shares space after yielding.
    // Hostile bodies remain solid; insert a separate straight detour leg around them.
    if(blocker.team!==u.team){
      const side=u.steerUntil>s.time?u.steerSide:1,offset=unitSpacing(u,blocker,s.time)+.5;
      for(const direction of [side,-side]){
        const detour={x:u.x-fy*offset*direction,y:u.y+fx*offset*direction};
        if(!clearStep(s,u,detour.x,detour.y))continue;
        u.steerSide=direction;u.steerUntil=s.time+2;u.path.unshift(detour);u.repath=Math.max(u.repath,2);break;
      }
    }
    return false;
  }
  u.x=nx;u.y=ny;
  if(step>=d-1e-8){u.path.shift();u.moveSpeed=0;}
  return false;
}

function nearestMineral(s,u,x=u.x,y=u.y){
  const W=s.width,N=W*s.height;
  let best=-1,score=Infinity;const region=s.regions[cell(s,u.x,u.y)];
  for(let i=0;i<N;i++)if(s.minerals[i]>0&&s.explored[u.team][i]&&!s.blocked[i]&&s.regions[i]===region){const d=sq(i%W+.5-x)+sq(Math.floor(i/W)+.5-y);if(d<score){best=i;score=d;}}
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
        const amount=u.cargo*(entityRole(depot)==='core'?.6:1);s.teams[u.team].credits+=amount;
        // Processing is visual bookkeeping after the existing immediate credit deposit.
        depot.processingType=depot.processingAmount>0&&depot.processingType!==(u.cargoType??1)?0:(u.cargoType??1);
        depot.processingAmount=(depot.processingAmount||0)+u.cargo;depot.processingTotal=(depot.processingTotal||0)+u.cargo;
        event(s,`Shard delivery: +${Math.floor(amount)} credits`,u.team);
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

function explore(s,u,dt,movement){
  const {width:W,height:H}=s,N=W*H;
  const order=u.order;
  if(order.tile!==undefined&&order.navVersion===s.navVersion&&u.path.length&&s.time>=order.nextPlan){
    // Finish a clear straight leg instead of stopping whenever its goal enters vision.
    // Still notice a fully explored reachable region promptly, including shared scouting.
    order.nextPlan=s.time+1;const region=s.regions[cell(s,u.x,u.y)];
    if(!s.explored[u.team].some((known,i)=>!known&&!s.blocked[i]&&s.regions[i]===region)){stopUnits(s,[u.id]);event(s,`${UNITS[u.type].name}: reachable territory explored`,u.team);return;}
  }
  if(order.tile===undefined||order.navVersion!==s.navVersion||s.explored[u.team][order.tile]&&s.time>=order.nextPlan){
    let best=-1,score=Infinity;const region=s.regions[cell(s,u.x,u.y)];
    // Mark only the nearby cells around other destinations, keeping large scout groups cheap.
    const crowding=new Float32Array(N);
    for(const e of own(s,u.team))if(e!==u&&e.order.type==='explore'&&e.order.tile!==undefined){
      const tx=e.order.tile%W,ty=Math.floor(e.order.tile/W);
      for(let y=Math.max(0,ty-5);y<=Math.min(H-1,ty+5);y++)for(let x=Math.max(0,tx-5);x<=Math.min(W-1,tx+5);x++)crowding[y*W+x]+=Math.max(0,6-Math.hypot(x-tx,y-ty));
    }
    for(let i=0;i<N;i++)if(!s.explored[u.team][i]&&!s.blocked[i]&&s.regions[i]===region){
      const x=i%W+.5,y=Math.floor(i/W)+.5;
      // Prefer continuing forward now that every heading change requires a stationary turn.
      const heading=Math.atan2(y-u.y,x-u.x),turn=Math.abs(Math.atan2(Math.sin(heading-u.angle),Math.cos(heading-u.angle)));
      const value=Math.hypot(x-u.x,y-u.y)+turn*UNITS[u.type].speed+crowding[i];
      if(value<score){best=i;score=value;}
    }
    if(best<0){stopUnits(s,[u.id]);event(s,`${UNITS[u.type].name}: reachable territory explored`,u.team);return;}
    order.tile=best;order.x=best%W+.5;order.y=Math.floor(best/W)+.5;order.navVersion=s.navVersion;order.nextPlan=s.time+1;
    u.path=[];u.repath=0;
  }
  if(navigate(s,u,order.x,order.y,dt,.35,movement))order.tile=undefined;
}

function targetDistance(a,b){const ca=center(a),cb=center(b);return Math.max(0,distance(ca,cb)-(b.kind==='building'?b.size*.45:0));}
function acquire(s,e,r){
  let best=null,score=Infinity;for(const enemy of nearbyEntities(s,center(e),r+1.5)){if(enemy.team===e.team||!alive(enemy)||!seen(s,e.team,enemy))continue;const d=targetDistance(e,enemy);if(d>r)continue;const threat=enemy.kind==='building'?(BUILDINGS[enemy.type].damage?-1:1):entityRole(enemy)==='harvester'?.8:0;const value=d+threat;if(value<score){score=value;best=enemy;}}
  return best;
}
function armorMultiplier(attacker,target){
  const armor=target.kind==='building'?'building':UNITS[target.type].armor;
  const table={rifle:{infantry:1,light:.55,heavy:.23,building:.4},rocket:{infantry:.3,light:.9,heavy:1.8,building:.7},scout:{infantry:1.25,light:.65,heavy:.26,building:.4},striker:{infantry:1.5,light:.8,heavy:.22,building:.35},tank:{infantry:.5,light:1.1,heavy:1,building:1},artillery:{infantry:.9,light:1,heavy:.8,building:1.5},turret:{infantry:.75,light:1,heavy:1,building:.8},rocketTower:{infantry:.45,light:1,heavy:1.2,building:.8}};
  return table[entityRole(attacker)]?.[armor]??1;
}
function hurt(s,target,amount,attacker){
  if(!alive(target))return;
  if(!['artillery','rocket','rocketTower'].includes(entityRole(attacker)))amount*=1-terrainCover(s,target);
  target.hp-=amount;target.lastHit=s.time;target.attackerId=attacker.id;
  // A throttled alert for forces that are not already fighting on the player's orders; the HUD turns it into a warning toast and minimap ping.
  const engaging=target.kind==='unit'&&(target.order.type==='attack'||target.order.type==='attackMove'||s.time-(target.lastShot??-99)<3);
  if(target.team===0&&!engaging&&s.time-(s.alertAt??-99)>8){s.alertAt=s.time;event(s,`${definition(target).name} under attack`,0);}
  if(target.hp<=0){
    s.teams[attacker.team].kills++;
    const killer=getEntity(s,attacker.id);
    if(killer?.kind==='unit'&&killer.team===attacker.team){
      const previousRank=unitRank(killer);killer.kills=(killer.kills||0)+1;
      if(unitRank(killer)>previousRank){
        const stats=unitStats(killer);killer.hp=Math.min(stats.hp,killer.hp+stats.hp-killer.maxHp);killer.maxHp=stats.hp;
        event(s,`${UNITS[killer.type].name} promoted to rank ${stats.rank}`,killer.team);
      }
    }
    const c=center(target);s.effects.push({type:'explosion',x:c.x,y:c.y,life:.6,maxLife:.6,team:target.team,size:target.kind==='building'?target.size:1});
    if(target.kind==='building'){s.navVersion++;event(s,`${BUILDINGS[target.type].name} destroyed`,target.team);}
    else{event(s,`${UNITS[target.type].name} lost`,target.team);if(entityRole(target)==='harvester'&&!own(s,target.team,'harvester').length&&!queued(s,target.team,'harvester')&&!own(s,target.team,'refinery').some(r=>r.haulerPending))event(s,'All haulers lost. Train a new one at the refinery.',target.team);}
    if(['core','constructor'].includes(entityRole(target))&&!own(s,target.team,'core').length&&!own(s,target.team,'constructor').length){s.status=target.team===0?'defeat':'victory';event(s,target.team===0?'All nexuses and construction vehicles lost. Operation failed.':'All hostile nexuses and construction vehicles destroyed. Sector secured.');}
  }
}
function shoot(s,e,target){
  const d=definition(e),a=center(e),b=center(target),damage=e.kind==='unit'?unitStats(e).damage:d.damage;e.aimAngle=Math.atan2(b.y-a.y,b.x-a.x);if(e.kind==='building')e.angle=e.aimAngle;e.cooldown=d.interval||1;e.lastShot=s.time;
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

function stepUnit(s,u,dt,movement,power){
  if(entityRole(u)==='harvester')u.unloadDepotId=null;
  u.repath-=dt;u.cooldown=Math.max(0,u.cooldown-dt);
  if(entityRole(u)==='harvester'&&!['move','explore'].includes(u.order.type)){if(u.order.type!=='harvest')u.order={type:'harvest'};harvest(s,u,dt,movement,power);return;}
  const d=UNITS[u.type],order=u.order;
  if(order.type==='move'){
    if(entityRole(u)==='engineer'){u.repairActive=false;u.repairTargetId=null;}
    const arrived=navigate(s,u,order.x,order.y,dt,.08,movement);
    // Movement goals are reachable parking slots; traffic must not cancel an unfinished delivery move.
    if(arrived)u.order={type:entityRole(u)==='harvester'?'harvest':'idle'};
    return;
  }
  if(entityRole(u)==='engineer'){
    u.repairActive=false;u.repairTargetId=null;u.targetId=null;
    const target=nearbyEntities(s,u,d.repairRange+1.5).filter(e=>alive(e)&&e.team===u.team&&e!==u&&e.progress>=1&&e.hp<e.maxHp&&(e.kind==='building'||UNITS[e.type].armor!=='infantry')&&targetDistance(u,e)<=d.repairRange).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id-b.id)[0];
    if(target&&s.teams[u.team].credits>0){
      const costPerHp=definition(target).cost*.35/target.maxHp,amount=Math.min(target.maxHp-target.hp,dt*d.repairRate*power.ratio,s.teams[u.team].credits/costPerHp);
      target.hp+=amount;s.teams[u.team].credits=Math.max(0,s.teams[u.team].credits-amount*costPerHp);u.repairTargetId=target.id;u.repairActive=amount>0;
      if(u.repairActive){const c=center(target);turnUnit(u,Math.atan2(c.y-u.y,c.x-u.x),dt,true);return;}
    }
    if(order.type==='explore')explore(s,u,dt,movement);
    else if(['attack','attackMove'].includes(order.type)&&navigate(s,u,order.x,order.y,dt,.08,movement))u.order={type:'idle'};
    return;
  }
  let target=getEntity(s,order.type==='attack'?order.targetId:u.targetId);
  if(target&&(target.team===u.team||!seen(s,u.team,target)))target=null;
  if(target&&order.type!=='attack'&&targetDistance(u,target)>(order.type==='attackMove'?d.sight+1:d.range))target=null;
  if(!target&&d.damage>0)target=acquire(s,u,order.type==='attackMove'?d.sight:d.range);
  u.targetId=target?.id??null;
  if(target){
    const c=center(target);if(order.type==='attack'&&target.id===order.targetId){order.x=c.x;order.y=c.y;}
    if(targetDistance(u,target)<=d.range){u.path=[];u.repath=0;const heading=Math.atan2(c.y-u.y,c.x-u.x);turnUnit(u,heading,dt,true);if(u.cooldown<=0)shoot(s,u,target);return;}
    if(order.type==='attack'||order.type==='attackMove'){
      // A committed target beyond a barrier must not leave an army walking into the wall forever.
      const dx=c.x-u.x,dy=c.y-u.y,length=Math.hypot(dx,dy);
      const barrier=nearbyEntities(s,u,d.range+1.5).filter(e=>e.kind==='building'&&buildingRole(e)==='wall'&&e.team!==u.team&&alive(e)&&seen(s,u.team,e)&&targetDistance(u,e)<=d.range).filter(e=>{
        const p=center(e),along=((p.x-u.x)*dx+(p.y-u.y)*dy)/Math.max(.01,length),across=Math.abs((p.x-u.x)*dy-(p.y-u.y)*dx)/Math.max(.01,length);
        return along>0&&along<length&&across<e.size*.72+.25;
      }).sort((a,b)=>targetDistance(u,a)-targetDistance(u,b)||a.id-b.id)[0];
      if(barrier){u.targetId=barrier.id;const p=center(barrier);turnUnit(u,Math.atan2(p.y-u.y,p.x-u.x),dt,true);if(u.cooldown<=0)shoot(s,u,barrier);return;}
      navigate(s,u,c.x,c.y,dt,d.range+(target.kind==='building'?target.size*.45:0)-.2,movement);return;
    }
  }
  if(order.type==='explore'){explore(s,u,dt,movement);return;}
  if(order.type==='attackMove'||order.type==='attack'){
    // A concealed building's centre is solid ground: stop at its edge instead of searching the whole map.
    const goal=order.type==='attack'?getEntity(s,order.targetId):null,stop=order.type==='attackMove'?.08:goal?.kind==='building'?goal.size*.71+.75:.45;
    if(navigate(s,u,order.x,order.y,dt,stop,movement))u.order={type:'idle'};
  }
}

function spawnAt(s,producer,type){
  if(own(s,producer.team).filter(e=>e.kind==='unit').length>=unitCapacity(s,producer.team))return false;
  const c=center(producer);let best=null,bestScore=Infinity;
  for(let y=producer.y-2;y<=producer.y+producer.size+2;y++)for(let x=producer.x-2;x<=producer.x+producer.size+2;x++){
    // Never deploy into a sealed pocket between buildings: such a unit could not follow any order.
    if(!walkable(s,x+.5,y+.5,.3)||s.regionSize[s.regions[y*s.width+x]]<40)continue;
    const crowded=s.entities.filter(e=>e.kind==='unit'&&alive(e)&&Math.hypot(e.x-x-.5,e.y-y-.5)<.8).length;
    const score=distance(c,{x:x+.5,y:y+.5})+crowded*5;if(score<bestScore){best={x:x+.5,y:y+.5};bestScore=score;}
  }
  if(!best)return false;
  const u=addEntity(s,producer.team,'unit',type,best.x,best.y);
  if(producer.rally)issueOrder(s,[u.id],{type:unitRole(type)==='harvester'?'move':'attackMove',...producer.rally});
  event(s,`${UNITS[type].name} ready`,producer.team);return true;
}

function deliverRefineryHauler(s,e){
  // Keep the included hauler pending if its exit is blocked or the army is full.
  if(e.haulerPending&&e.progress>=1&&spawnAt(s,e,raceUnit(s,e.team,'harvester')))e.haulerPending=false;
}

function separateUnits(s,dt,movement){
  const units=s.entities.filter(e=>e.kind==='unit'&&alive(e));
  // A deterministic spatial broad phase keeps large battles local. Candidate pairs retain entity order.
  const buckets=new Map(),locations=new Array(units.length),key=u=>`${Math.floor(u.x/2)},${Math.floor(u.y/2)}`;
  const relocate=i=>{
    const next=key(units[i]),previous=locations[i];if(previous===next)return false;
    if(previous!==undefined){const list=buckets.get(previous);list.splice(list.indexOf(i),1);if(!list.length)buckets.delete(previous);}
    if(!buckets.has(next))buckets.set(next,[]);buckets.get(next).push(i);locations[i]=next;return true;
  };
  units.forEach((_,i)=>relocate(i));
  const neighbors=(i,after)=>{
    const u=units[i],x=Math.floor(u.x/2),y=Math.floor(u.y/2),list=[];
    for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++)for(const j of buckets.get(`${xx},${yy}`)||[])if(j>after)list.push(j);
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
    // Separation can only slide along an unchanged body heading; rotating units stay planted.
    const displace=(u,intent,amount)=>{
      if(!intent||intent.rotating)return;
      const fx=Math.cos(u.angle),fy=Math.sin(u.angle),along=(px*fx+py*fy)*amount;
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
    if(!intent){u.moveSpeed=0;if(!u.targetId&&!u.repairActive)u.turnVelocity=0;delete u.trafficWait;delete u.passUntil;continue;}
    if(u.passUntil<=s.time)delete u.passUntil;
    const progress=(u.x-intent.x)*intent.dx+(u.y-intent.y)*intent.dy;
    if(intent.traffic&&!(u.passUntil>s.time)&&progress<intent.step*.25)u.trafficWait=Math.min(.8,(u.trafficWait||0)+dt);
    else u.trafficWait=Math.max(0,(u.trafficWait||0)-dt*2);
    // Only friendly spacing softens during a jam; static geometry stays solid.
    if(u.trafficWait>=.8-1e-8){u.passUntil=s.time+1.5;u.trafficWait=0;}
  }
}

function aiBuild(s,team,type,near){
  type=raceBuilding(s,team,type);
  const {width:W,height:H}=s;
  const base=own(s,team,'core')[0];if(!base)return false;
  const c=center(base),toward={x:(W/2-c.x),y:(H/2-c.y)};const length=Math.hypot(toward.x,toward.y);toward.x/=length;toward.y/=length;
  const preferred=near||(BUILDINGS[type].damage?{x:c.x+toward.x*9,y:c.y+toward.y*9}:c);
  const candidates=[];
  if(s.teams[team].credits<BUILDINGS[type].cost||BUILDINGS[type].requires.some(key=>!completed(s,team,key)))return false;
  const checked=new Set(),anchors=near?own(s,team).filter(e=>e.kind==='building'&&e.progress>=1):[base];
  for(const anchor of anchors)for(let y=Math.max(1,anchor.y-11);y<Math.min(H-4,anchor.y+14);y++)for(let x=Math.max(1,anchor.x-12);x<Math.min(W-4,anchor.x+14);x++){
    const at=y*W+x;if(checked.has(at))continue;checked.add(at);
    if(canPlace(s,team,type,x,y).ok)candidates.push({x,y,score:Math.hypot(x+BUILDINGS[type].size/2-preferred.x,y+BUILDINGS[type].size/2-preferred.y)});
  }
  candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)return false;
  const spot=candidates[Math.min(candidates.length-1,Math.floor(random(s)*3))];return placeBuilding(s,team,type,spot.x,spot.y).ok;
}
function queued(s,team,type){return own(s,team).reduce((sum,e)=>sum+(e.queue?.filter(q=>q.type===type||unitRole(q)===type).length||0),0);}
// Expansion plans use observed ore and enemy sightings; hidden units never choose a site.
function rememberMiningSites(s,team,ai){
  if(s.time<(ai.nextMineralScan||0))return;
  ai.nextMineralScan=s.time+8;ai.miningSites??=[];
  for(const site of ai.miningSites)if(s.visible[team][cell(s,site.x,site.y)]){site.amount=s.minerals[cell(s,site.x,site.y)];site.seenAt=s.time;}
  for(let i=0;i<s.minerals.length;i++)if(s.visible[team][i]&&s.minerals[i]>100){
    const point={x:i%s.width+.5,y:Math.floor(i/s.width)+.5};
    const site=ai.miningSites.find(site=>distance(site,point)<6);
    if(site){if(site.amount<s.minerals[i])Object.assign(site,point,{amount:s.minerals[i],seenAt:s.time});}
    else if(ai.miningSites.length<64)ai.miningSites.push({...point,amount:s.minerals[i],seenAt:s.time});
  }
  ai.miningSites=ai.miningSites.filter(site=>site.amount>100);
}
function expansionGround(s,team,ore,origin){
  // A building's centre is blocked; use the nearest open ground around its footprint.
  let region=s.regions[cell(s,origin.x,origin.y)],nearest=Infinity;
  if(!region)for(let y=Math.max(0,Math.floor(origin.y)-5);y<=Math.min(s.height-1,Math.floor(origin.y)+5);y++)for(let x=Math.max(0,Math.floor(origin.x)-5);x<=Math.min(s.width-1,Math.floor(origin.x)+5);x++){
    const candidate=s.regions[y*s.width+x],d=Math.hypot(x+.5-origin.x,y+.5-origin.y);
    if(candidate&&d<nearest){region=candidate;nearest=d;}
  }
  if(!region)return null;
  const candidates=[];
  for(let y=Math.max(1,Math.floor(ore.y)-9);y<Math.min(s.height-4,ore.y+8);y++)for(let x=Math.max(1,Math.floor(ore.x)-9);x<Math.min(s.width-4,ore.x+8);x++){
    const point={x:x+1.5,y:y+1.5},d=distance(point,ore);if(d<4.5||d>10)continue;
    let legal=true;
    for(let yy=y;yy<y+3&&legal;yy++)for(let xx=x;xx<x+3;xx++){
      const at=yy*s.width+xx;
      if(!s.explored[team][at]||s.blocked[at]||s.terrain[at]===5||s.minerals[at]>0||s.regions[at]!==region){legal=false;break;}
    }
    if(legal)candidates.push({x,y,score:distance(point,origin)+d*.4});
  }
  return candidates.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x)[0];
}
function expandAI(s,team,ai){
  rememberMiningSites(s,team,ai);
  const cores=own(s,team,'core'),constructors=own(s,team,'constructor');
  if(ai.outpostId){
    const outpost=getEntity(s,ai.outpostId);
    if(!outpost){delete ai.outpostId;delete ai.outpostOre;}
    else if(outpost.progress>=1){
      const at=center(outpost),local=own(s,team).filter(e=>e.kind==='building'&&distance(center(e),at)<15),refinery=local.find(e=>entityRole(e)==='refinery');
      if(!refinery){aiBuild(s,team,'refinery',ai.outpostOre||at);ai.mode='Building an expansion refinery';return true;}
      if(refinery.progress<1)return true;
      if(!local.some(e=>entityRole(e)==='reactor')){aiBuild(s,team,'reactor',at);return true;}
      if(!local.some(e=>entityRole(e)==='barracks')){aiBuild(s,team,'barracks',at);return true;}
      delete ai.outpostId;delete ai.outpostOre;
    }else return true;
  }
  const maxBases=s.difficulty==='easy'?2:s.difficulty==='hard'?6:4;
  if(!ai.expansion&&constructors.length){
    const unit=constructors[0],ore=ai.miningSites.filter(site=>cores.every(core=>distance(center(core),site)>20)).sort((a,b)=>distance(a,unit)-distance(b,unit))[0]||unit;
    const spot=expansionGround(s,team,ore,unit)||{x:Math.floor(unit.x)-1,y:Math.floor(unit.y)-1};
    ai.expansion={x:spot.x,y:spot.y,oreX:ore.x,oreY:ore.y,unitId:unit.id,startedAt:s.time,lastProgressAt:s.time,lastX:unit.x,lastY:unit.y};
  }
  if(!ai.expansion&&cores.length<maxBases&&completed(s,team,'factory')&&s.time>=(ai.nextExpand??(s.difficulty==='easy'?240:s.difficulty==='hard'?120:180))){
    const base=cores.find(e=>e.progress>=1);if(!base)return false;
    const origin=center(base),knownThreats=Object.values(ai.known).filter(e=>e.kind==='building'||s.time-e.seenAt<60);
    const sites=ai.miningSites.filter(site=>cores.every(core=>distance(center(core),site)>20)&&knownThreats.every(e=>distance(e,site)>18)).sort((a,b)=>distance(a,origin)-distance(b,origin));
    for(const ore of sites){const spot=expansionGround(s,team,ore,origin);if(spot){ai.expansion={x:spot.x,y:spot.y,oreX:ore.x,oreY:ore.y,startedAt:s.time,lastProgressAt:s.time,lastX:origin.x,lastY:origin.y};break;}}
    if(!ai.expansion){
      const scout=own(s,team,'scout').find(e=>e.hp/e.maxHp>.5);
      if(scout&&scout.order.type!=='explore')issueOrder(s,[scout.id],{type:'explore'});
      ai.nextExpand=s.time+20;
    }
  }
  const plan=ai.expansion;if(!plan)return false;
  let unit=plan.unitId?getEntity(s,plan.unitId):constructors[0];
  if(plan.unitId&&!unit){delete ai.expansion;ai.nextExpand=s.time+30;return false;}
  if(!unit){
    if(!queued(s,team,'constructor'))trainUnit(s,team,raceUnit(s,team,'constructor'));
    ai.mode='Preparing a nexus construction vehicle';return true;
  }
  if(!plan.unitId){plan.unitId=unit.id;plan.lastX=unit.x;plan.lastY=unit.y;plan.lastProgressAt=s.time;}
  if(Math.hypot(unit.x-plan.lastX,unit.y-plan.lastY)>1){plan.lastX=unit.x;plan.lastY=unit.y;plan.lastProgressAt=s.time;}
  const point={x:plan.x+1.5,y:plan.y+1.5};
  if(distance(unit,point)<4){
    const candidates=[];
    for(let y=Math.max(1,Math.floor(unit.y)-4);y<Math.min(s.height-3,unit.y+3);y++)for(let x=Math.max(1,Math.floor(unit.x)-4);x<Math.min(s.width-3,unit.x+3);x++)if(deploymentStatus(s,team,unit.id,x,y).ok)candidates.push({x,y,score:distance({x:x+1.5,y:y+1.5},point)});
    candidates.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);
    const spot=candidates[0];if(spot){const result=deployNexus(s,team,unit.id,spot.x,spot.y);if(result.ok){ai.outpostId=result.id;ai.outpostOre={x:plan.oreX,y:plan.oreY};delete ai.expansion;ai.nextExpand=s.time+(s.difficulty==='easy'?240:150);ai.mode='Establishing a remote nexus';return true;}}
  }
  if(s.time-plan.lastProgressAt>45){
    // Re-plan around a blocked site instead of spending forever against its edge.
    const spot=expansionGround(s,team,{x:plan.oreX,y:plan.oreY},unit);
    if(spot){plan.x=spot.x;plan.y=spot.y;}else{plan.x=Math.floor(unit.x)-1;plan.y=Math.floor(unit.y)-1;}
    plan.lastProgressAt=s.time;stopUnits(s,[unit.id]);
  }
  if(unit.order.type!=='move'||Math.hypot(unit.order.x-point.x,unit.order.y-point.y)>1)issueOrder(s,[unit.id],{type:'move',...point});
  ai.mode='Relocating command to a mineral field';return true;
}

function thinkAI(s,team=1){
  const {width:W,height:H}=s;
  const ai=aiState(s,team),hard=s.difficulty==='hard',easy=s.difficulty==='easy';ai.nextThink=s.time+(hard?1.2:easy?3.5:2);
  const expanding=expandAI(s,team,ai);
  const core=own(s,team,'core').find(e=>e.progress>=1)||own(s,team,'core')[0];if(!core)return;const c=center(core),buildings=own(s,team).filter(e=>e.kind==='building');
  const units=own(s,team).filter(e=>e.kind==='unit'),army=units.filter(e=>UNITS[e.type].damage>0),support=units.filter(e=>entityRole(e)==='engineer');
  const expansion=Math.max(0,army.length-50);
  const enemies=s.entities.filter(e=>e.team!==team&&alive(e)&&seen(s,team,e));
  // Composition is inferred only from recent sightings; concealed reinforcements cannot change a decision.
  const intelligence=Object.values(ai.known).filter(e=>e.kind==='building'||s.time-e.seenAt<90),knownBuildings=intelligence.filter(e=>e.kind==='building');
  const armorSeen=intelligence.filter(e=>e.kind==='unit'&&UNITS[e.type].armor==='heavy').length,infantrySeen=intelligence.filter(e=>e.kind==='unit'&&UNITS[e.type].armor==='infantry').length,defensesSeen=knownBuildings.filter(e=>BUILDINGS[e.type].damage).length;
  // A parked rover or hauler is left to the guards; only an armed intrusion pulls the army home.
  const intruders=enemies.filter(e=>e.kind==='unit'&&entityRole(e)!=='scout'&&UNITS[e.type].damage>0&&buildings.some(b=>distance(center(b),e)<13));
  const constructing=buildings.some(e=>e.progress<1),power=powerStats(s,team);
  // Emergency generation can be rebuilt alongside a stalled construction project.
  if(constructing&&power.gridRatio<1&&!buildings.some(e=>entityRole(e)==='reactor'&&e.progress<1))aiBuild(s,team,'reactor');
  if(!constructing){
    if(!completed(s,team,'refinery'))aiBuild(s,team,'refinery');
    else if(power.supply-power.demand<25)aiBuild(s,team,'reactor');
    else if(!completed(s,team,'barracks'))aiBuild(s,team,'barracks');
    else if(!completed(s,team,'factory')&&s.time>(easy?70:35))aiBuild(s,team,'factory');
    else if(expanding){} // Reserve credits for the constructor and its mining outpost.
    else if(!easy&&!completed(s,team,'lab')&&s.time>(hard?105:160)&&s.teams[team].credits>650)aiBuild(s,team,'lab');
    else if(!easy&&!own(s,team,'capacitor').length&&s.time>160&&s.teams[team].credits>700)aiBuild(s,team,'capacitor');
    else if(own(s,team,'turret').length+own(s,team,'rocketTower').length<(hard?3:2)&&s.time>75)aiBuild(s,team,own(s,team,'turret').length?'rocketTower':'turret');
    else if(s.teams[team].credits>1200&&own(s,team,'barracks').length<2&&!easy&&s.time>(hard?0:240))aiBuild(s,team,'barracks');
    else if(!easy&&expansion>0&&s.teams[team].credits>1400&&own(s,team,'factory').length<3)aiBuild(s,team,'factory');
    else if(!easy&&s.time>(ai.nextExpand??220)&&s.teams[team].credits>900&&own(s,team,'refinery').length<(hard?4:3)){
      const refineries=own(s,team,'refinery'),deposits=[];
      for(let i=0;i<s.minerals.length;i++)if(s.visible[team][i]&&s.minerals[i]>100){const p={x:i%W+.5,y:Math.floor(i/W)+.5};if(refineries.every(e=>distance(center(e),p)>11))deposits.push(p);}
      deposits.sort((a,b)=>distance(a,c)-distance(b,c));
      if(deposits.length){if(aiBuild(s,team,'refinery',deposits[0]))ai.mode='Expanding shard operations';ai.nextExpand=s.time+45;}else ai.nextExpand=s.time+30;
    }
  }
  for(const b of buildings)if(b.progress>=1&&b.hp<b.maxHp*.7&&s.teams[team].credits>150)b.repairing=true;
  // Keep enough for an unpaid constructor and its outpost, but use spare funds for research.
  const expansionReserve=expanding?(ai.expansion&&!ai.expansion.unitId&&!queued(s,team,'constructor')?2600:1100):0;
  if(!easy&&completed(s,team,'lab')&&s.teams[team].credits>550+expansionReserve&&power.gridRatio>=1){
    const priorities=armorSeen>infantrySeen?['gridEfficiency','infantryWeapons','vehicleWeapons','advancedBallistics','mobility','infantryArmor']:['gridEfficiency','vehicleWeapons','infantryWeapons','advancedBallistics','infantryArmor','mobility'];
    const next=priorities.find(id=>researchStatus(s,team,id).ok);if(next)startResearch(s,team,next);
    const factory=buildings.find(e=>entityRole(e)==='factory'&&e.progress>=1);
    if(factory&&s.teams[team].credits>650){const id=s.teams[team].research?.advancedBallistics?'advancedProduction':'speed';if(buildingUpgradeStatus(s,team,factory.id,id).ok)startBuildingUpgrade(s,team,factory.id,id);}
  }
  const haulers=units.filter(e=>entityRole(e)==='harvester');
  if(haulers.length+queued(s,team,'harvester')<(easy?2:Math.min(hard?7:5,2+own(s,team,'refinery').length)))trainUnit(s,team,raceUnit(s,team,'harvester'));
  if(!expanding&&completed(s,team,'barracks')){
    if(!units.some(e=>entityRole(e)==='scout')&&!queued(s,team,'scout'))trainUnit(s,team,raceUnit(s,team,'scout'));
    if(s.time>(easy?75:45)&&units.filter(e=>entityRole(e)==='rocket').length+queued(s,team,'rocket')<Math.min(easy?2:(hard?8:6)+Math.floor(expansion/12),Math.floor(army.length/3)+armorSeen)&&s.teams[team].credits>(completed(s,team,'factory')?300:600))trainUnit(s,team,raceUnit(s,team,'rocket'));
    if(queued(s,team,'rifle')<2&&units.filter(e=>entityRole(e)==='rifle').length<(easy?6:(hard?14:10)+Math.floor(expansion/6))&&s.teams[team].credits>(completed(s,team,'factory')?180:450))trainUnit(s,team,raceUnit(s,team,'rifle'));
  }
  if(!expanding&&completed(s,team,'factory')&&s.teams[team].credits>300){
    if(!easy&&support.length+queued(s,team,'engineer')<1+Math.floor(expansion/50)&&army.length>7&&s.teams[team].credits>600)trainUnit(s,team,raceUnit(s,team,'engineer'));
    const tanks=units.filter(e=>entityRole(e)==='tank').length,siege=units.filter(e=>entityRole(e)==='artillery').length;
    // Cadet opposition fields a small armored column and never brings siege guns.
    const strikerReady=s.teams[team].research?.advancedBallistics&&buildings.some(e=>entityRole(e)==='factory'&&e.upgrades?.advancedProduction);
    const type=!easy&&strikerReady&&infantrySeen>armorSeen&&units.filter(e=>entityRole(e)==='striker').length<tanks?'striker':!easy&&tanks>=2&&siege<Math.min(4+Math.floor(expansion/25),Math.floor(tanks/3)+Math.min(2,defensesSeen))?'artillery':'tank';if(!(easy&&tanks>=4)&&queued(s,team,type)<2&&power.gridRatio>.65)trainUnit(s,team,raceUnit(s,team,type));
  }
  const rally={x:c.x+(W/2-c.x)*.3,y:c.y+(H/2-c.y)*.3};
  for(const b of buildings){
    if(entityRole(b)==='refinery'){
      const ore=(ai.miningSites||[]).filter(site=>distance(site,center(b))<18).sort((a,b)=>distance(a,center(b))-distance(b,center(b)))[0];
      if(ore)b.rally={x:ore.x,y:ore.y};
    }else b.rally=rally;
  }
  if(intruders.length){
    ai.mode='Defending perimeter';const threat=intruders.sort((a,b)=>distance(c,a)-distance(c,b))[0];
    // One grouped order per response keeps the destination search bounded for large armies.
    issueOrder(s,army.filter(u=>u.hp/u.maxHp>.25).map(u=>u.id),{type:'attack',targetId:threat.id,x:threat.x,y:threat.y});
    const fleeing=haulers.filter(h=>enemies.some(e=>e.kind==='unit'&&entityRole(e)!=='harvester'&&distance(h,e)<7));
    if(fleeing.length)issueOrder(s,fleeing.map(h=>h.id),{type:'move',x:c.x+3,y:c.y+4});
    return;
  }
  const wounded=army.filter(u=>u.hp/u.maxHp<.3&&distance(u,c)>7);
  if(wounded.length)issueOrder(s,wounded.map(u=>u.id),{type:'move',x:c.x+4,y:c.y+4});
  const scout=army.find(e=>entityRole(e)==='scout'&&e.hp/e.maxHp>.3);
  const {start}=mapLayout(s);
  const waypoints=[{x:W*35/72,y:H/2},{x:start.x+6,y:start.y+3},{x:W/6,y:H*15/56},{x:W*50/72,y:H*43/56},{x:start.x-3,y:start.y+11}].map(p=>team===1?p:{x:W-p.x,y:H-p.y});
  if(scout&&scout.order.type!=='explore'&&!knownBuildings.length&&(scout.order.type==='idle'||s.time>25&&scout.order.type==='attackMove')){
    const point=waypoints[ai.scoutIndex%waypoints.length];if(distance(scout,point)<3)ai.scoutIndex++;const dest=waypoints[ai.scoutIndex%waypoints.length];issueOrder(s,[scout.id],{type:'move',...dest});ai.mode='Scouting the sector';
  }
  const fighting=army.filter(e=>e!==scout&&e.hp/e.maxHp>.3);
  // Local threat estimates use current vision only. Pull back a losing column, then wait for replacements.
  const exposed=fighting.filter(u=>distance(u,c)>18&&enemies.some(e=>definition(e).damage>0&&distance(u,center(e))<10));
  if(!easy&&exposed.length){
    const front={x:exposed.reduce((sum,u)=>sum+u.x,0)/exposed.length,y:exposed.reduce((sum,u)=>sum+u.y,0)/exposed.length};
    const friendly=army.filter(u=>distance(u,front)<12).reduce((sum,u)=>sum+u.hp,0),hostile=enemies.filter(e=>definition(e).damage>0&&distance(center(e),front)<12).reduce((sum,e)=>sum+e.hp*(e.kind==='building'?.7:1),0);
    if(hostile>friendly*1.65){issueOrder(s,exposed.map(u=>u.id),{type:'move',...rally});ai.regroupUntil=s.time+35;ai.nextRaid=Math.max(ai.nextRaid,ai.regroupUntil);ai.mode='Regrouping under pressure';}
  }
  for(const engineer of support)if(engineer.order.type==='idle'&&!engineer.repairActive&&fighting.length){const escort=fighting.find(u=>['tank','artillery'].includes(entityRole(u)))||fighting[0];if(distance(engineer,escort)>5)issueOrder(s,[engineer.id],{type:'attackMove',x:escort.x,y:escort.y});}
  if(s.time<(ai.regroupUntil||0)){ai.mode='Regrouping and repairing';return;}
  const staged=fighting.filter(u=>distance(u,rally)<8&&u.order.type!=='move');
  if(s.time>=ai.nextRaid&&staged.length>=(easy?9:hard?5:7)){
    const priority={refinery:1,reactor:defensesSeen?0:1,lab:1,capacitor:2,turret:4,rocketTower:4,core:2,barracks:2,factory:2};
    const target=knownBuildings.sort((a,b)=>(priority[entityRole(a)]??2)-(priority[entityRole(b)]??2)||distance(c,a)-distance(c,b))[0];
    const dest=target||waypoints[ai.scoutIndex++%waypoints.length];
    const wave=staged.slice(0,easy?8:hard?Infinity:10),pace=Math.min(...wave.map(u=>unitStats(u).speed));
    issueOrder(s,wave.map(e=>e.id),{type:'attackMove',x:dest.x,y:dest.y});
    // Strategic waves travel together; combat, retreat and later manual orders retain individual speed.
    for(const u of wave)if(u.order.type==='attackMove')u.order.speedLimit=pace;
    ai.nextRaid=s.time+(easy?150:hard?50:90);ai.raid++;ai.mode=target?'Raiding enemy infrastructure':'Probing unexplored territory';
  }else{
    const idle=fighting.filter(u=>u.order.type==='idle'&&distance(u,rally)>4);
    if(idle.length)issueOrder(s,idle.map(u=>u.id),{type:'attackMove',...rally});
  }
}

// Power throttles everything; the opposition additionally builds and trains slower below Veteran.
const AI_PACE={easy:.55,normal:.75,hard:1};
const teamPace=(s,team)=>(s.aiTeams||[1]).includes(team)?AI_PACE[s.difficulty]:1;
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
      if(e.progress<1){const buildPace=Math.max(.2,rate)*powers[e.team].productionMultiplier*teamPace(s,e.team),delta=Math.min(1-e.progress,dt/BUILDINGS[e.type].buildTime*buildPace);e.progress=Math.min(1,e.progress+delta);e.hp=Math.min(e.maxHp,e.hp+e.maxHp*.8*delta);if(e.progress>=1){event(s,`${BUILDINGS[e.type].name} online`,e.team);deliverRefineryHauler(s,e);}continue;}
      if(e.repairing){
        const costPerHp=BUILDINGS[e.type].cost*.5/e.maxHp;
        const amount=Math.min(e.maxHp-e.hp,dt*e.maxHp*.02*rate,s.teams[e.team].credits/costPerHp);
        e.hp=Math.min(e.maxHp,e.hp+amount);s.teams[e.team].credits=Math.max(0,s.teams[e.team].credits-amount*costPerHp);
        if(e.hp>=e.maxHp)e.repairing=false;
      }
      if(e.processingAmount>0){e.processingAmount=Math.max(0,e.processingAmount-dt*UNITS.harvester.capacity/6*rate*powers[e.team].productionMultiplier*(e.upgrades?.speed?1.25:1));if(e.processingAmount<1e-8){e.processingAmount=e.processingTotal=0;e.processingType=0;}}
      if(e.research){e.research.progress=Math.min(1,e.research.progress+dt/RESEARCH[e.research.id].time*pace);if(e.research.progress>=1)finishResearch(s,e);}
      if(e.upgrade){e.upgrade.progress=Math.min(1,e.upgrade.progress+dt/BUILDING_UPGRADES[e.upgrade.id].time*productionRate(s,e.team,powers[e.team]));if(e.upgrade.progress>=1){const id=e.upgrade.id;e.upgrades??={};e.upgrades[id]=true;delete e.upgrade;event(s,`${BUILDING_UPGRADES[id].name}: upgrade complete`,e.team);}}
      deliverRefineryHauler(s,e);
      const q=e.queue[0];if(q){q.progress=Math.min(1,q.progress+dt/UNITS[q.type].trainTime*pace);if(q.progress>=1){if(spawnAt(s,e,q.type))e.queue.shift();else if(Math.floor(s.time/10)!==Math.floor((s.time-dt)/10))event(s,`${BUILDINGS[e.type].name}: deployment bay blocked`,e.team);}}
      if(BUILDINGS[e.type].damage){e.cooldown=Math.max(0,e.cooldown-dt*rate);const target=acquire(s,e,BUILDINGS[e.type].range);e.targetId=target?.id??null;if(target&&e.cooldown<=0&&powers[e.team].ratio>=1)shoot(s,e,target);}
    }else{
      const angle=e.angle,x=e.x,y=e.y;stepUnit(s,e,dt,movement,powers[e.team]);
      // Combat aiming and engineer work also turn in place and cannot be displaced by traffic.
      if(e.angle!==angle&&!movement.has(e.id))movement.set(e.id,{x,y,dx:0,dy:0,step:0,traffic:false,rotating:true});
      indexEntity(s,e);
    }
  }
  separateUnits(s,dt,movement);
  // Damaged vehicles can fall back to their nexus for slow paid repairs.
  const repairCores=[0,1].map(team=>own(s,team,'core').filter(core=>core.progress>=1));
  for(const e of s.entities)if(alive(e)&&e.kind==='unit'&&e.hp<e.maxHp&&s.time-(e.lastHit??-99)>8&&s.teams[e.team].credits>1&&repairCores[e.team].some(core=>distance(e,center(core))<7)){const amount=Math.min(e.maxHp-e.hp,dt*5*powers[e.team].ratio,s.teams[e.team].credits*8);e.hp+=amount;s.teams[e.team].credits-=amount/8;}
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
  if(s.status==='playing')for(const team of s.aiTeams||[1])if(s.time>=aiState(s,team).nextThink)thinkAI(s,team);
}
export function updateGame(s,dt){
  if(!Number.isFinite(dt)||dt<=0||s.status!=='playing')return;
  // Fixed upper step keeps projectile cooldowns, harvest rates, and collision stable.
  let remaining=Math.min(dt,1);while(remaining>1e-8&&s.status==='playing'){const amount=Math.min(.05,remaining);step(s,amount);remaining-=amount;}
}
