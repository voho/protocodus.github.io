// Ashline opposition: a deterministic commander that plays one team through the public commands.
// It reads the enemy only through current vision (seen, s.visible, impacts landing in its sight, its own
// entities being struck), its own fog memory (ai.known, ai.miningSites) and the map's structural layout (both
// starting anchors, where generation placed ore and the lane chokepoints named in s.sites). Expansion sites
// and wall checks judge explored ground by terrain, generated ore and its own and remembered footprints,
// never by s.blocked, s.regions or live ore amounts under fog, which also reflect unseen enemy structures and
// mining; structures are placed through placementCheck, which accepts only ground in current vision.
// Doctrines shape what it builds and where it strikes; difficulty sets how fast it thinks and which skills it uses.
// The import cycle with sim.js is safe: neither module reads the other's bindings while it evaluates.
import {BUILDINGS,UNITS,RESEARCH,BUILDING_UPGRADES,alive,seen,center,distance,cell,clamp,bucketKey,definition,entityRole,unitRole,buildingRole,targetDistance,armorMultiplier,
  random,unitStats,unitRange,powerStats,raceBuilding,raceUnit,placementCheck,placeBuilding,trainUnit,issueOrder,stopUnits,setUnitStance,
  researchStatus,startResearch,buildingUpgradeStatus,startBuildingUpgrade,deploymentStatus,deployNexus,planWallLine,buildWallLine} from './sim.js';
import {mapLayout,hash} from './terrain.js';
import {ABILITIES,abilityFor,useAbility} from './abilities.js';
import {missionDirective} from './mission.js';

// Doctrine knobs: mix is the desired share of each combat role; raid and wave scale attack timing and size;
// towers, walls (0 never, 1 Veteran, 2 Commander and up) and outpostTowers shape static defense; expand
// scales expansion timing and bases adds nexus slots; harass is the hauler-hunting squad size (raider
// doctrines also hunt on Commander); focus caps attackers per target; storm is how many times a remembered
// tower's strength a wave needs before it assaults instead of standing off; guns is how many siege crawlers a
// wave waits for while towers are known; foundries is how many foundries it stands up early; targets ranks
// raid objectives (towers only for waves with guns).
export const DOCTRINES={
  balanced:{name:'Balanced',commander:'Warden Kestrel',callsign:'Watchfire',unity:{commander:'Arbiter WK-9',callsign:'Lattice'},
    description:'Grows a steady economy, holds a powered perimeter and raids with staged combined-arms waves.',
    knobs:{mix:{rifle:.3,rocket:.16,scout:0,tank:.34,artillery:.1,striker:.1},raid:1,wave:1,towers:0,walls:1,outpostTowers:1,expand:1,bases:0,harass:2,raider:false,focus:0,towerAversion:8,storm:3,guns:0,foundries:1,engineers:.08,scouts:1,labs:1,
      research:['gridEfficiency','vehicleWeapons','infantryWeapons','advancedBallistics','infantryArmor','mobility'],
      targets:{refinery:1,reactor:1,lab:1,capacitor:2,core:2,barracks:2,factory:2,turret:3,rocketTower:3,wall:6}}},
  ironclad:{name:'Ironclad',commander:'Marshal Orsa Vantreck',callsign:'Anvil',unity:{commander:'Bastion mind OR-4',callsign:'Keel'},
    description:'Masses armor and siege guns behind walled sentry lines, then breaks the enemy with one heavy timing push.',
    knobs:{mix:{rifle:.16,rocket:.12,scout:0,tank:.5,artillery:.18,striker:.04},raid:1.7,wave:2,towers:2,walls:2,outpostTowers:2,expand:1.25,bases:-1,harass:0,raider:false,focus:3,towerAversion:4,storm:3,guns:0,foundries:2,engineers:.12,scouts:1,labs:1,
      research:['vehicleWeapons','gridEfficiency','mobility','advancedBallistics','infantryWeapons','infantryArmor'],
      targets:{core:1,factory:1,barracks:2,reactor:2,refinery:2,lab:3,capacitor:3,turret:3,rocketTower:3,wall:6}}},
  swarm:{name:'Swarm',commander:'Major Idris Kell',callsign:'Wasp',unity:{commander:'Swarm kernel IK-12',callsign:'Chorus'},
    description:'Floods the field with infantry, rovers and strikers, raids early and often, and hunts haulers on the shard runs.',
    knobs:{mix:{rifle:.42,rocket:.14,scout:.14,tank:.08,artillery:0,striker:.22},raid:.6,wave:.75,towers:-1,walls:0,outpostTowers:0,expand:1,bases:0,harass:3,raider:true,focus:0,towerAversion:10,storm:2,guns:0,foundries:1,engineers:0,scouts:2,labs:1,
      research:['gridEfficiency','advancedBallistics','infantryWeapons','infantryArmor','vehicleWeapons','mobility'],
      targets:{refinery:0,reactor:1,core:2,barracks:2,lab:2,capacitor:2,factory:3,turret:4,rocketTower:4,wall:6}}},
  prospector:{name:'Prospector',commander:'Quartermaster Juno Tal',callsign:'Lodestar',unity:{commander:'Survey core JT-3',callsign:'Assay'},
    description:'Claims remote shard fields early, fortifies each outpost, then turns a broad economy into a late heavy push.',
    knobs:{mix:{rifle:.26,rocket:.18,scout:0,tank:.36,artillery:.1,striker:.1},raid:1.5,wave:1.6,towers:0,walls:1,outpostTowers:1,expand:.55,bases:2,harass:2,raider:false,focus:0,towerAversion:8,storm:3,guns:0,foundries:1,engineers:.08,scouts:1,labs:2,
      research:['gridEfficiency','vehicleWeapons','mobility','infantryWeapons','advancedBallistics','infantryArmor'],
      targets:{refinery:0,core:1,reactor:2,lab:2,capacitor:2,barracks:2,factory:2,turret:3,rocketTower:3,wall:6}}},
  siegebreaker:{name:'Siegebreaker',commander:'Major Rhee Ostrander',callsign:'Hammerfall',unity:{commander:'Ballistic node RO-7',callsign:'Parallax'},
    description:'Spots for long guns with rovers and flares, levels defenses from beyond their reach, then shells the reactors dark.',
    knobs:{mix:{rifle:.24,rocket:.1,scout:.06,tank:.28,artillery:.32,striker:0},raid:1.1,wave:1.2,towers:0,walls:0,outpostTowers:1,expand:1,bases:0,harass:0,raider:false,focus:2,towerAversion:0,storm:8,guns:2,foundries:1,engineers:.15,scouts:2,labs:1,
      research:['vehicleWeapons','gridEfficiency','advancedBallistics','mobility','infantryWeapons','infantryArmor'],
      targets:{turret:0,rocketTower:0,reactor:1,capacitor:1,core:2,factory:2,barracks:3,refinery:3,lab:3,wall:6}}},
};
// Difficulty is behaviour as well as pace. Cadet thinks slowly, attacks late with small fixed columns, never
// retreats, adapts or uses abilities; Commander adapts and fights with abilities; Veteran adds focus fire,
// hauler raids, walls and a faster cadence. retreat/commit compare Lanchester sums of aiCombatPower.
const LEVELS={
  easy:{think:3.5,firstRaid:300,cadence:150,waveMin:8,waveMax:8,armyCap:13,caps:{rifle:6,rocket:2,scout:1,tank:4,artillery:0,striker:0},bases:2,expandAt:240,expandEvery:240,towers:2,adapt:0,focus:0,abilities:false,lanchester:false,retreat:0,commit:1,rescout:0,lab:false,queue:1,producers:1,haulers:2},
  normal:{think:2,firstRaid:150,cadence:90,waveMin:7,waveMax:12,armyCap:48,bases:4,expandAt:180,expandEvery:150,towers:2,adapt:1,focus:0,abilities:true,lanchester:true,retreat:.6,commit:1.15,rescout:80,lab:true,queue:2,producers:3,haulers:7},
  hard:{think:1.2,firstRaid:100,cadence:50,waveMin:5,waveMax:60,armyCap:160,bases:6,expandAt:120,expandEvery:150,towers:3,adapt:1.5,focus:3,abilities:true,lanchester:true,retreat:.8,commit:1.3,rescout:50,lab:true,queue:2,producers:4,haulers:10},
};
// Difficulty names as the briefing shows them.
export const LEVEL_NAMES={easy:'Cadet',normal:'Commander',hard:'Veteran'};
const COMBAT=['rifle','rocket','scout','tank','artillery','striker'];
// Below Veteran the opposition builds and trains slower; productionRate applies this pace on top of power.
export const AI_PACE={easy:.55,normal:.75,hard:1};
export function teamPace(s,team){return(s.aiTeams||[1]).includes(team)?AI_PACE[s.difficulty]:1;}

// 'random' resolves once, from the seed and team, so the same operation always meets the same commander.
export function randomDoctrine(seed,team){const keys=Object.keys(DOCTRINES);return keys[hash(`${seed}/rival-doctrine/${team}`)%keys.length];}
// Setup choices: Random first, then every doctrine with its commander in the rival race's naming, for the
// briefing selector.
export function doctrineOptions(race='organics'){
  return[{id:'random',name:'Random',commander:'Unknown commander',callsign:'',description:'A doctrine drawn from the operation seed.'},
    ...Object.entries(DOCTRINES).map(([id,d])=>{const named=race==='aiUnity'?d.unity:d;return{id,name:d.name,commander:named.commander,callsign:named.callsign,description:d.description};})];
}
// The rival commander's identity for a team, in its race's naming; null for a human-controlled team.
export function aiCommander(s,team){
  const ai=aiState(s,team);if(!ai)return null;
  const id=ai.doctrine??'balanced',d=DOCTRINES[id],unity=s.teams[team]?.race==='aiUnity';
  return{doctrine:id,name:d.name,commander:unity?d.unity.commander:d.commander,callsign:unity?d.unity.callsign:d.callsign,description:d.description};
}
// A profile names an optional doctrine. Absent fields are not stored, keeping default state unchanged.
export function newAI(difficulty,profile,context){
  const ai={nextThink:3,nextRaid:(LEVELS[difficulty]??LEVELS.normal).firstRaid,known:{},mode:'Establishing base',scoutIndex:0,buildIndex:0,raid:0};
  if(profile===undefined)return ai;
  if(profile===null||typeof profile!=='object'||Array.isArray(profile)||Object.keys(profile).some(key=>key!=='doctrine'))throw new RangeError('Unsupported AI profile');
  if(profile.doctrine!==undefined){
    const doctrine=profile.doctrine==='random'&&context?randomDoctrine(context.seed,context.team):profile.doctrine;
    if(!Object.hasOwn(DOCTRINES,doctrine))throw new RangeError('Unsupported AI doctrine');
    ai.doctrine=doctrine;ai.nextRaid*=DOCTRINES[doctrine].knobs.raid;
  }
  return ai;
}
export function aiState(s,team){return team===1?s.ai:s.aiByTeam?.[team];}
// The merged difficulty and doctrine settings for one commander.
// Cadet columns never exceed its eight-unit wave whatever the doctrine; doctrines vary a Cadet only through
// timing, composition and structures.
export function aiKnobs(s,ai){
  const level=LEVELS[s.difficulty]??LEVELS.normal,d=(DOCTRINES[ai.doctrine]??DOCTRINES.balanced).knobs,easy=s.difficulty==='easy',hard=s.difficulty==='hard';
  const wave=Math.max(3,Math.round(level.waveMin*d.wave));
  return{...level,level:s.difficulty,mix:d.mix,research:d.research,targets:d.targets,towerAversion:d.towerAversion,storm:d.storm,guns:easy?0:d.guns,foundries:easy?1:d.foundries,firstRaid:level.firstRaid*d.raid,cadence:level.cadence*d.raid,
    waveMin:easy?Math.min(level.waveMax,wave):wave,waveMax:easy?level.waveMax:Math.max(level.waveMax,wave),towers:Math.max(1,level.towers+d.towers),
    walls:!easy&&d.walls>=(hard?1:2),outpostTowers:easy?0:d.outpostTowers,bases:Math.max(1,level.bases+(easy?0:d.bases)),expandAt:level.expandAt*d.expand,
    expandEvery:level.expandEvery*d.expand,harass:easy||!(hard||d.raider)?0:d.harass,focus:easy?0:Math.max(level.focus,d.focus),engineers:easy?0:d.engineers,
    scouts:easy?1:d.scouts,labs:easy?0:d.labs,siege:!easy};
}

const armed=e=>e.kind==='unit'&&UNITS[e.type].damage>0;
const byId=(a,b)=>a.id-b.id;
// Memory records (ai.known) already hold a structure's centre and carry no size; live entities go through center().
const pointOf=e=>e.size===undefined?e:center(e);
const centroid=list=>{let x=0,y=0;for(const e of list){const c=pointOf(e);x+=c.x;y+=c.y;}return{x:x/list.length,y:y/list.length};};
const direction=(dx,dy)=>{const length=Math.hypot(dx,dy)||1;return{x:dx/length,y:dy/length};};
const onMap=(s,p)=>({x:clamp(p.x,.5,s.width-.5),y:clamp(p.y,.5,s.height-.5)});
const footprint=m=>{const size=BUILDINGS[m.type].size;return{x:Math.round(m.x-size/2),y:Math.round(m.y-size/2),size};};
const memoryPower=m=>{const d=m.kind==='building'?BUILDINGS[m.type]:UNITS[m.type];return d.damage?Math.sqrt(m.hp*d.damage/d.interval):0;};
const enemyAnchor=(s,team)=>{const {start,end}=mapLayout(s);return onMap(s,team===1?start:end);};
// True while a unit already holds this order, or has finished it there: re-issuing it would only re-plan
// the same parking slots through movementDestinations.
function bound(u,p,type){
  const o=u.order,goal=o.formation||o;
  if(o.type!==type&&!(o.type==='idle'&&type!=='attack'))return false;
  if(goal.x!==undefined)return Math.hypot(goal.x-p.x,goal.y-p.y)<(o.formation?.5:1.5);
  return o.type==='idle'&&distance(u,p)<1.5;
}
function orderGroup(s,units,type,p,pace){
  const ids=units.filter(u=>!bound(u,p,type)).map(u=>u.id);if(!ids.length)return false;
  issueOrder(s,ids,{type,x:p.x,y:p.y});
  // Strategic movement travels together; combat, retreats and later orders keep individual speed.
  if(pace)for(const u of units)if(ids.includes(u.id)&&u.order.type===type)u.order.speedLimit=pace;
  return true;
}
const pace=units=>Math.min(...units.map(u=>unitStats(u).speed));

// One pass over the entities per think. thinkAI runs after the step's spatial index is gone, so own() and
// getEntity() would each scan every entity; the commander's own index answers those questions instead.
function survey(s,team,ai){
  const v={units:[],buildings:[],byRole:Object.create(null),byId:new Map(),queued:Object.create(null),enemies:[],enemyById:new Map()};
  for(const e of s.entities){
    if(!alive(e))continue;
    if(e.team===team){
      v.byId.set(e.id,e);(e.kind==='unit'?v.units:v.buildings).push(e);(v.byRole[entityRole(e)]??=[]).push(e);
      if(e.queue)for(const q of e.queue){const role=unitRole(q.type);v.queued[role]=(v.queued[role]||0)+1;}
    }else if(seen(s,team,e)){v.enemies.push(e);v.enemyById.set(e.id,e);}
  }
  v.role=role=>v.byRole[role]||[];
  v.done=role=>v.role(role).filter(e=>e.kind==='building'&&e.progress>=1);
  v.count=role=>v.role(role).length+(v.queued[role]||0);
  v.add=e=>{v.byId.set(e.id,e);(e.kind==='unit'?v.units:v.buildings).push(e);(v.byRole[entityRole(e)]??=[]).push(e);};
  v.remove=e=>{v.byId.delete(e.id);for(const list of [v.units,v.buildings,v.role(entityRole(e))]){const i=list.indexOf(e);if(i>=0)list.splice(i,1);}};
  v.cores=v.role('core');v.core=v.cores.find(e=>e.progress>=1)||v.cores[0];
  v.army=v.units.filter(armed);v.threats=v.enemies.filter(e=>definition(e).damage>0);
  // Composition comes only from recent sightings; concealed reinforcements cannot change a decision.
  v.intel=Object.values(ai.known).filter(m=>m.kind==='building'||s.time-m.seenAt<90);
  v.knownBuildings=v.intel.filter(m=>m.kind==='building');v.knownTowers=v.knownBuildings.filter(m=>BUILDINGS[m.type].damage);
  let heavy=0,infantry=0;
  for(const m of v.intel)if(m.kind==='unit'&&UNITS[m.type].damage){const d=UNITS[m.type];if(d.armor==='heavy')heavy+=d.cost;else if(d.armor==='infantry')infantry+=d.cost;}
  v.seen={heavy,infantry};
  return v;
}

// Ground as this commander knows it: visible cells are exact; explored cells keep their terrain and the
// footprints of its own and remembered enemy structures; unexplored cells are assumed open.
function fairGround(s,team,v){
  if(v.fair)return v.fair;
  const {width:W,height:H}=s,N=W*H,grid=new Uint8Array(N),visible=s.visible[team],explored=s.explored[team],terrain=s.terrain;
  for(let i=0;i<N;i++){const t=terrain[i];grid[i]=visible[i]?s.blocked[i]:explored[i]&&(t===1||t===3||t===4)?1:0;}
  const mark=(x0,y0,size,hidden)=>{for(let y=Math.max(0,y0);y<Math.min(H,y0+size);y++)for(let x=Math.max(0,x0);x<Math.min(W,x0+size);x++)if(!hidden||!visible[y*W+x])grid[y*W+x]=1;};
  for(const b of v.buildings)mark(b.x,b.y,b.size,false);
  for(const m of v.knownBuildings){const f=footprint(m);mark(f.x,f.y,f.size,true);}
  return v.fair=grid;
}
function fairReach(s,team,v,origin){
  const grid=fairGround(s,team,v),{width:W,height:H}=s,N=W*H,key=cell(s,clamp(origin.x,0,W-1),clamp(origin.y,0,H-1));
  if(v.reach?.key===key)return v.reach.map;
  let start=-1,best=Infinity;
  for(let y=Math.max(0,Math.floor(origin.y)-5);y<=Math.min(H-1,Math.floor(origin.y)+5);y++)for(let x=Math.max(0,Math.floor(origin.x)-5);x<=Math.min(W-1,Math.floor(origin.x)+5);x++){
    const d=Math.hypot(x+.5-origin.x,y+.5-origin.y);if(!grid[y*W+x]&&d<best){best=d;start=y*W+x;}
  }
  const map=new Uint8Array(N);
  if(start>=0){
    const queue=new Int32Array(N);let tail=0;map[start]=1;queue[tail++]=start;
    const visit=next=>{if(!map[next]&&!grid[next]){map[next]=1;queue[tail++]=next;}};
    for(let head=0;head<tail;head++){const at=queue[head],x=at%W;if(x>0)visit(at-1);if(x<W-1)visit(at+1);if(at>=W)visit(at-W);if(at<N-W)visit(at+W);}
  }
  v.reach={key,map};return map;
}

// Placement searches square rings outward from the goal and stops once no farther ring can beat the third
// best legal spot; the commander then picks among those three with the shared stream.
function aiBuild(s,team,v,role,near,preferred){
  const type=raceBuilding(s,team,role),d=BUILDINGS[type],{width:W,height:H}=s,base=v.core;if(!base)return null;
  if(s.teams[team].credits<d.cost||d.requires.some(key=>!v.done(buildingRole(key)).length))return null;
  const c=center(base),toward=direction(W/2-c.x,H/2-c.y);
  const goal=preferred||near||(d.damage?{x:c.x+toward.x*9,y:c.y+toward.y*9}:c);
  const candidates=[],check=placementCheck(s,team,type),cx=Math.round(goal.x-d.size/2),cy=Math.round(goal.y-d.size/2);
  const visit=(x,y)=>{if(x<1||y<1||x+d.size>=W||y+d.size>=H||!check(x,y).ok)return;candidates.push({x,y,score:Math.hypot(x+d.size/2-goal.x,y+d.size/2-goal.y)});};
  for(let r=0;r<=24;r++){
    for(let x=cx-r;x<=cx+r;x++){visit(x,cy-r);if(r)visit(x,cy+r);}
    for(let y=cy-r+1;y<cy+r;y++){visit(cx-r,y);if(r)visit(cx+r,y);}
    if(candidates.length>=3){candidates.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);if(r-.5>candidates[2].score)break;}
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);
  const spot=candidates[Math.min(candidates.length-1,Math.floor(random(s)*3))];
  if(!placeBuilding(s,team,type,spot.x,spot.y).ok)return null;
  const e=s.entities.at(-1);v.add(e);v.placed=true;return e;
}
// Rocket towers answer armor; rail sentries answer infantry and light vehicles. Alternate when unsure.
function towerType(v){
  const turrets=v.role('turret').length,rockets=v.role('rocketTower').length,{heavy,infantry}=v.seen;
  if(!turrets)return'turret';
  // A starting escort says little about the army to come; the mix leans only once a real force was seen.
  if(heavy+infantry>=900){
    if(heavy>infantry*1.2)return'rocketTower';
    if(infantry>heavy*1.5)return'turret';
  }
  return rockets<turrets?'rocketTower':'turret';
}
// Towers fan out across the approach from the enemy side instead of stacking on one spot.
function frontSpot(s,team,from,index,reach=9){
  const enemy=enemyAnchor(s,team),angle=Math.atan2(enemy.y-from.y,enemy.x-from.x)+[0,-.6,.6,-1.1,1.1,-1.6,1.6][index%7];
  return{x:from.x+Math.cos(angle)*reach,y:from.y+Math.sin(angle)*reach};
}

// Expansion plans use observed ore and enemy sightings; hidden units never choose a site.
function rememberMiningSites(s,team,ai){
  if(s.time<(ai.nextMineralScan||0))return;
  ai.nextMineralScan=s.time+8;ai.miningSites??=[];
  for(const site of ai.miningSites)if(s.visible[team][cell(s,site.x,site.y)]){site.amount=s.minerals[cell(s,site.x,site.y)];site.seenAt=s.time;}
  // Sites move while ore is scanned. Eight-tile buckets hold site indices, so a match within
  // six tiles lies in the surrounding buckets and the lowest index is the first array match.
  const sites=ai.miningSites,buckets=new Map(),bucketOf=site=>bucketKey(Math.floor(site.x/8),Math.floor(site.y/8));
  const file=(index,key)=>{if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(index);};
  sites.forEach((site,index)=>file(index,bucketOf(site)));
  const visible=s.visible[team],minerals=s.minerals;
  for(let i=0;i<minerals.length;i++)if(visible[i]&&minerals[i]>100){
    const point={x:i%s.width+.5,y:Math.floor(i/s.width)+.5},bx=Math.floor(point.x/8),by=Math.floor(point.y/8);
    let match=-1;
    for(let y=by-1;y<=by+1;y++)for(let x=bx-1;x<=bx+1;x++)for(const index of buckets.get(bucketKey(x,y))||[])if((match<0||index<match)&&distance(sites[index],point)<6)match=index;
    if(match>=0){
      const site=sites[match];
      if(site.amount<minerals[i]){
        const previous=bucketOf(site);Object.assign(site,point,{amount:minerals[i],seenAt:s.time});
        const next=bucketOf(site);if(next!==previous){const list=buckets.get(previous);list.splice(list.indexOf(match),1);file(match,next);}
      }
    }else if(sites.length<64){sites.push({...point,amount:minerals[i],seenAt:s.time});file(sites.length-1,bucketOf(sites.at(-1)));}
  }
  ai.miningSites=ai.miningSites.filter(site=>site.amount>100);
}
// A 3 × 3 nexus inside a lane gate, ford or pass would plug that lane for both sides.
const CHOKEPOINTS=new Set(['gate','ford','pass']);
const chokepoints=s=>(s.sites||[]).filter(site=>CHOKEPOINTS.has(site.kind));
const inChoke=(chokes,p)=>chokes.some(site=>distance(p,site)<site.r+1.5);
// Ore under fog counts where the sector's generated layout placed it (s.mineralTypes, which mining never
// clears), so a field mined out unseen still reads as ore; only visible cells use the live amounts.
function expansionGround(s,team,v,ore,origin){
  const grid=fairGround(s,team,v),reach=fairReach(s,team,v,origin),explored=s.explored[team],visible=s.visible[team],W=s.width,chokes=chokepoints(s),candidates=[];
  for(let y=Math.max(1,Math.floor(ore.y)-9);y<Math.min(s.height-4,ore.y+8);y++)for(let x=Math.max(1,Math.floor(ore.x)-9);x<Math.min(W-4,ore.x+8);x++){
    const point={x:x+1.5,y:y+1.5},d=distance(point,ore);if(d<4.5||d>10||inChoke(chokes,point))continue;
    let legal=true;
    for(let yy=y;yy<y+3&&legal;yy++)for(let xx=x;xx<x+3;xx++){
      const at=yy*W+xx;
      if(!explored[at]||grid[at]||!reach[at]||s.terrain[at]===5||(visible[at]?s.minerals[at]>0:s.mineralTypes[at]>0)){legal=false;break;}
    }
    if(legal)candidates.push({x,y,score:distance(point,origin)+d*.4});
  }
  return candidates.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x)[0];
}
// Returns {held, saving}: credits to hold back for the expansion. Production continues from everything above
// it. While saving for the vehicle the hold grows from 35% to its full price over 45 seconds; once the
// vehicle is paid only the outpost's next structure is held.
function expandAI(s,team,ai,v,k,directive,pressed){
  rememberMiningSites(s,team,ai);
  const cores=v.cores,constructors=v.role('constructor');
  if(ai.outpostId){
    const outpost=v.byId.get(ai.outpostId);
    if(!outpost){delete ai.outpostId;delete ai.outpostOre;}
    else if(outpost.progress<1)return{held:BUILDINGS[raceBuilding(s,team,'refinery')].cost};
    else{
      const at=center(outpost),local=v.buildings.filter(e=>distance(center(e),at)<15),has=role=>local.filter(e=>entityRole(e)===role);
      const refinery=has('refinery')[0],towers=has('turret').length+has('rocketTower').length;
      const next=!refinery?['refinery',ai.outpostOre||at]:refinery.progress<1?null:!has('reactor').length?['reactor',at]:
        towers<k.outpostTowers?[towerType(v),at,frontSpot(s,team,at,towers,6)]:k.level!=='easy'&&!has('barracks').length?['barracks',at]:'done';
      if(next==='done'){delete ai.outpostId;delete ai.outpostOre;}
      else{
        if(next&&!local.some(e=>e.progress<1)){aiBuild(s,team,v,next[0],next[1],next[2]);ai.mode='Fortifying an expansion';}
        return{held:next?BUILDINGS[raceBuilding(s,team,next[0])].cost:0};
      }
    }
  }
  if(directive?.noExpand){delete ai.expansion;return{held:0};}
  // With every nexus lost, a plan made from the old base gives way to one from where the vehicle stands.
  if(!cores.length&&ai.expansion&&!ai.expansion.unitId)delete ai.expansion;
  if(!ai.expansion&&constructors.length){
    // A vehicle with no plan heads for the nearest known field clear of recent threats, or the nearest field.
    const unit=constructors[0],threats=v.intel.filter(m=>m.kind==='building'||s.time-m.seenAt<60);
    const fields=(ai.miningSites||[]).filter(site=>cores.every(core=>distance(center(core),site)>20)).sort((a,b)=>distance(a,unit)-distance(b,unit)||a.y-b.y||a.x-b.x);
    const ore=fields.find(site=>threats.every(m=>distance(m,site)>18))||fields[0]||unit;
    const spot=expansionGround(s,team,v,ore,unit)||{x:Math.floor(unit.x)-1,y:Math.floor(unit.y)-1};
    ai.expansion={x:spot.x,y:spot.y,oreX:ore.x,oreY:ore.y,unitId:unit.id,startedAt:s.time,lastProgressAt:s.time,lastX:unit.x,lastY:unit.y};
  }
  if(!ai.expansion&&!pressed&&cores.length<k.bases&&v.done('factory').length&&s.time>=(ai.nextExpand??k.expandAt)){
    const base=cores.find(e=>e.progress>=1);if(!base)return{held:0};
    const origin=center(base),threats=v.intel.filter(m=>m.kind==='building'||s.time-m.seenAt<60);
    const sites=(ai.miningSites||[]).filter(site=>cores.every(core=>distance(center(core),site)>20)&&threats.every(m=>distance(m,site)>18)).sort((a,b)=>distance(a,origin)-distance(b,origin)||a.y-b.y||a.x-b.x);
    for(const ore of sites){const spot=expansionGround(s,team,v,ore,origin);if(spot){ai.expansion={x:spot.x,y:spot.y,oreX:ore.x,oreY:ore.y,startedAt:s.time,lastProgressAt:s.time,lastX:origin.x,lastY:origin.y};break;}}
    // No usable field is known: the scout explores for one while the commander waits.
    if(!ai.expansion){(ai.intel??={index:0,next:0}).explore=s.time+40;ai.nextExpand=s.time+20;}
  }
  const plan=ai.expansion;if(!plan)return{held:0};
  const unit=plan.unitId?v.byId.get(plan.unitId):constructors[0];
  if(plan.unitId&&!unit){delete ai.expansion;ai.nextExpand=s.time+30;return{held:0};}
  const cost=UNITS[raceUnit(s,team,'constructor')].cost;
  if(!unit){
    // A broken army or a base under attack comes first: the vehicle waits, and nothing is held for it.
    if(!v.done('factory').length||pressed&&!v.queued.constructor)return{held:0};
    if(!v.queued.constructor&&trainUnit(s,team,raceUnit(s,team,'constructor')).ok)v.queued.constructor=1;
    ai.mode='Preparing a nexus construction vehicle';
    return{held:v.queued.constructor?0:cost*clamp((s.time-plan.startedAt)/45,.35,1),saving:true};
  }
  if(!plan.unitId){plan.unitId=unit.id;plan.lastX=unit.x;plan.lastY=unit.y;plan.lastProgressAt=s.time;}
  if(Math.hypot(unit.x-plan.lastX,unit.y-plan.lastY)>1){plan.lastX=unit.x;plan.lastY=unit.y;plan.lastProgressAt=s.time;}
  const point={x:plan.x+1.5,y:plan.y+1.5};
  if(distance(unit,point)<4){
    // Ground clear of chokepoints comes first; a vehicle redeploying from wherever it stands may have no other.
    const candidates=[],chokes=chokepoints(s);
    for(let y=Math.max(1,Math.floor(unit.y)-4);y<Math.min(s.height-3,unit.y+3);y++)for(let x=Math.max(1,Math.floor(unit.x)-4);x<Math.min(s.width-3,unit.x+3);x++)if(deploymentStatus(s,team,unit.id,x,y).ok){
      const at={x:x+1.5,y:y+1.5};candidates.push({x,y,score:distance(at,point)+(inChoke(chokes,at)?100:0)});
    }
    candidates.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);
    const spot=candidates[0];
    if(spot){
      const result=deployNexus(s,team,unit.id,spot.x,spot.y);
      if(result.ok){v.remove(unit);v.add(s.entities.find(e=>e.id===result.id));ai.outpostId=result.id;ai.outpostOre={x:plan.oreX,y:plan.oreY};delete ai.expansion;ai.nextExpand=s.time+k.expandEvery;ai.mode='Establishing a remote nexus';return{held:0};}
    }
  }
  if(s.time-plan.lastProgressAt>45){
    // Re-plan around a blocked site instead of spending forever against its edge.
    const spot=expansionGround(s,team,v,{x:plan.oreX,y:plan.oreY},unit);
    if(spot){plan.x=spot.x;plan.y=spot.y;}else{plan.x=Math.floor(unit.x)-1;plan.y=Math.floor(unit.y)-1;}
    plan.lastProgressAt=s.time;stopUnits(s,[unit.id]);
  }
  if(unit.order.type!=='move'||Math.hypot(unit.order.x-point.x,unit.order.y-point.y)>1)issueOrder(s,[unit.id],{type:'move',...point});
  ai.mode='Relocating command to a mineral field';
  // The vehicle is paid for; keep the outpost refinery affordable for when the nexus stands.
  return{held:BUILDINGS[raceBuilding(s,team,'refinery')].cost};
}

// Walls go two tiles in front of a tower, across the approach, only where they keep every spawn bay, hauler
// lane, the rally and the way out open. The check floods the commander's own picture of the ground. Each tower
// is considered once (ai.wallTried); a tower whose wall would block anything stays unwalled.
function wallPlan(s,team,ai,v,k,rally){
  const tried=ai.wallTried=(ai.wallTried||[]).filter(id=>v.byId.has(id)),enemy=enemyAnchor(s,team);
  const flooded={};
  for(const tower of [...v.done('turret'),...v.done('rocketTower')].sort(byId)){
    if(tried.includes(tower.id)||tried.length>=64)continue;
    const at=center(tower);
    if(v.role('wall').some(w=>distance(center(w),at)<tower.size/2+3.5)){tried.push(tower.id);continue;}
    const front=direction(enemy.x-at.x,enemy.y-at.y),side={x:-front.y,y:front.x},reach=tower.size/2+2,half=tower.size===1?1:2;
    const mid={x:at.x+front.x*reach,y:at.y+front.y*reach};
    const plan=planWallLine(s,team,Math.floor(mid.x-side.x*half),Math.floor(mid.y-side.y*half),Math.floor(mid.x+side.x*half),Math.floor(mid.y+side.y*half));
    const cells=[];for(const c of plan.cells){if(!c.ok)break;cells.push(c);}
    // Passing units or a momentary shortfall only postpone the wall; ground that cannot take it settles it.
    if(cells.length<2&&['Insufficient credits','Unit in construction area'].includes(plan.cells.find(c=>!c.ok)?.reason))continue;
    tried.push(tower.id);
    if(cells.length<2||!keepsGroundOpen(s,team,ai,v,cells,rally,flooded))continue;
    return{tower,cells,from:cells[0],to:cells.at(-1)};
  }
  return null;
}
function keepsGroundOpen(s,team,ai,v,cells,rally,flooded){
  const {width:W,height:H}=s,N=W*H,grid=fairGround(s,team,v),blocked=new Set(cells.map(c=>c.y*W+c.x));
  // Producers keep their whole spawn ring; hauler runs between depots and their ore keep a lane.
  const keepOut=v.buildings.filter(b=>['core','refinery','barracks','factory'].includes(entityRole(b)));
  const lanes=[];for(const depot of [...v.role('refinery'),...v.role('core')])for(const site of ai.miningSites||[])if(distance(center(depot),site)<18)lanes.push([center(depot),site]);
  for(const c of cells){
    const p={x:c.x+.5,y:c.y+.5};
    if(keepOut.some(b=>Math.max(b.x-c.x,c.x-b.x-b.size+1,b.y-c.y,c.y-b.y-b.size+1)<=3))return false;
    if(lanes.some(([a,b])=>{const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(a.x+dx*t-p.x,a.y+dy*t-p.y)<2;}))return false;
  }
  const flood=extra=>{
    const seenMap=new Uint8Array(N),queue=new Int32Array(N),core=center(v.core);let tail=0,start=-1,best=Infinity;
    for(let y=Math.max(0,Math.floor(core.y)-4);y<=Math.min(H-1,Math.floor(core.y)+4);y++)for(let x=Math.max(0,Math.floor(core.x)-4);x<=Math.min(W-1,Math.floor(core.x)+4);x++){const i=y*W+x,d=Math.hypot(x+.5-core.x,y+.5-core.y);if(!grid[i]&&!extra.has(i)&&d<best){best=d;start=i;}}
    if(start<0)return{map:seenMap,count:0};
    seenMap[start]=1;queue[tail++]=start;
    const visit=next=>{if(!seenMap[next]&&!grid[next]&&!extra.has(next)){seenMap[next]=1;queue[tail++]=next;}};
    for(let head=0;head<tail;head++){const at=queue[head],x=at%W;if(x>0)visit(at-1);if(x<W-1)visit(at+1);if(at>=W)visit(at-W);if(at<N-W)visit(at+W);}
    return{map:seenMap,count:tail};
  };
  const before=flooded.before??=flood(new Set()),after=flood(blocked);
  // No pocket of open ground larger than a few tiles may be cut off from the base.
  if(after.count<before.count-cells.length-6)return false;
  const reachable=p=>{for(let y=Math.max(0,Math.floor(p.y)-2);y<=Math.min(H-1,Math.floor(p.y)+2);y++)for(let x=Math.max(0,Math.floor(p.x)-2);x<=Math.min(W-1,Math.floor(p.x)+2);x++)if(after.map[y*W+x])return true;return false;};
  return reachable(rally)&&reachable(enemyAnchor(s,team))&&lanes.every(([,site])=>reachable(site));
}

// One structure at a time (two while credits float), in priority order. Returns credits to hold back for a
// priority structure that is waiting only on funds; essentials (refinery, power, barracks, foundry) may
// spend an expansion's hold, other priorities wait for it.
function buildBase(s,team,ai,v,k,power,rally,held){
  const credits=s.teams[team].credits,easy=k.level==='easy',hard=k.level==='hard',core=center(v.core);
  const underway=v.buildings.filter(e=>e.progress<1&&entityRole(e)!=='wall').length;
  // Emergency generation can be rebuilt alongside a stalled construction project.
  if(underway&&power.gridRatio<1&&!v.buildings.some(e=>entityRole(e)==='reactor'&&e.progress<1)){aiBuild(s,team,v,'reactor');return 0;}
  // One placement per look: a second placement check would rebuild the whole navigation grid.
  if(v.placed||underway>=(easy?1:credits-held>1600?2:1))return 0;
  const count=role=>v.role(role).length,done=role=>v.done(role).length;
  const baseTowers=[...v.role('turret'),...v.role('rocketTower')].filter(e=>distance(center(e),core)<20).length;
  const producers=[...v.done('barracks'),...v.done('factory')],busy=producers.length&&producers.every(e=>e.queue.length>=k.queue);
  const backlog=role=>v.done(role).length>0&&v.done(role).every(e=>e.queue.length>=k.queue);
  const armySize=v.army.length,vehicles=v.army.filter(u=>['tank','artillery','striker'].includes(entityRole(u))).length;
  const vehicleGap=armySize>=8&&v.done('factory').length>0&&v.done('factory').every(e=>e.queue.length>=1)&&vehicles<(k.mix.tank+k.mix.artillery+k.mix.striker)*armySize*.75;
  let want=null;
  const site=()=>{
    if(s.time<(ai.nextRefinery??(hard?150:220)))return null;
    const refineries=v.role('refinery');ai.nextRefinery=s.time+20;
    return(ai.miningSites||[]).filter(p=>refineries.every(e=>distance(center(e),p)>11)&&v.buildings.some(e=>e.progress>=1&&distance(center(e),p)<20)).sort((a,b)=>distance(a,core)-distance(b,core)||a.y-b.y||a.x-b.x)[0];
  };
  let ore;
  // Priority structures hold their price back from production until they can be placed.
  if(!done('refinery'))want={role:'refinery',essential:true};
  else if(power.supply-power.demand<25)want={role:'reactor',essential:true};
  else if(!done('barracks'))want={role:'barracks',essential:true};
  else if(!done('factory')&&s.time>(easy?70:35))want={role:'factory',essential:true};
  // Once two towers stand, walls in front of them come before anything else on the list.
  if(!want&&k.walls&&baseTowers>=2&&s.time>150&&credits-held>200&&(ai.nextWalls??0)<=s.time){
    const plan=wallPlan(s,team,ai,v,k,rally);ai.nextWalls=s.time+20;
    if(plan){const result=buildWallLine(s,team,plan.from.x,plan.from.y,plan.to.x,plan.to.y);for(const id of result.ids||[])v.add(s.entities.find(e=>e.id===id));if(result.ok){v.placed=true;ai.mode='Walling the sentry line';}return 0;}
  }
  if(!want){
    if(k.lab&&!count('lab')&&s.time>(hard?105:160))want={role:'lab'};
    else if(count('factory')<k.foundries&&s.time>(hard?90:150))want={role:'factory'};
    else if(baseTowers<k.towers&&s.time>75)want={role:towerType(v),preferred:frontSpot(s,team,core,baseTowers)};
    else if(!easy&&count('refinery')<(hard?4:3)+v.cores.length-1&&(ore=site()))want={role:'refinery',near:ore};
    // A single busy foundry cannot keep up with the doctrine's vehicle share: add another.
    else if(!easy&&vehicleGap&&count('factory')<Math.min(k.producers-1,1+v.cores.length))want={role:'factory'};
    else if(!easy&&!count('capacitor')&&s.time>160&&credits-held>600)want={role:'capacitor',optional:true};
  }
  if(!want){
    if(!easy&&count('barracks')<2&&credits-held>(k.mix.rifle>.4?500:900)&&s.time>(hard?0:240))want={role:'barracks',optional:true};
    // Spare credits behind a full production line buy another producer of that kind.
    else if(!easy&&credits-held>400&&backlog('factory')&&count('factory')<Math.min(k.producers-1,1+v.cores.length))want={role:'factory',optional:true};
    else if(!easy&&credits-held>(busy?300:1000)&&(backlog('barracks')||busy)&&count('barracks')<Math.min(k.producers,1+v.cores.length))want={role:'barracks',optional:true};
    else if(count('lab')<k.labs&&credits-held>1300&&Object.keys(RESEARCH).filter(id=>!s.teams[team].research?.[id]).length>=3)want={role:'lab',optional:true};
  }
  if(!want)return 0;
  const cost=BUILDINGS[raceBuilding(s,team,want.role)].cost;
  // Essentials outrank an expansion's hold; other priorities wait behind it instead of stacking a second hold.
  if(credits-(want.essential?0:held)<cost)return want.optional||!want.essential&&held?0:Math.min(cost,650);
  const built=aiBuild(s,team,v,want.role,want.near,want.preferred);
  if(built&&want.near)ai.mode='Expanding shard operations';
  return 0;
}

// Research goes first: while a laboratory is idle its next project's price is held back from production,
// unless the army is broken or the base is under attack. Upgrades only use credits that float.
function researchAI(s,team,v,k,power,held,pressed){
  if(!k.lab||!v.done('lab').length||power.gridRatio<1)return 0;
  const spare=()=>s.teams[team].credits-held;
  const order=[...k.research],ahead=id=>{const i=order.indexOf(id);if(i>0){order.splice(i,1);order.splice(order[0]==='gridEfficiency'?1:0,0,id);}};
  // Rocket teams and strikers are the answers to what was actually seen.
  if(v.seen.heavy>v.seen.infantry)ahead('infantryWeapons');
  if(v.seen.infantry>v.seen.heavy*1.3&&k.mix.striker>0)ahead('advancedBallistics');
  let waiting=0;
  for(const lab of v.done('lab').sort(byId))if(!lab.research){
    const next=order.find(id=>{const status=researchStatus(s,team,id);return status.ok||status.reason==='Insufficient credits';});if(!next)break;
    if(RESEARCH[next].cost<=spare())startResearch(s,team,next,lab.id);else{if(!pressed)waiting=RESEARCH[next].cost;break;}
  }
  // Strikers need an assembly bay as soon as the ballistics research lands; it is held for like research.
  const research=s.teams[team].research||{},bay=research.advancedBallistics&&k.mix.striker>0&&!v.done('factory').some(e=>e.upgrades?.advancedProduction||e.upgrade?.id==='advancedProduction')&&v.done('factory').sort(byId).find(e=>!e.upgrade);
  if(bay){if(buildingUpgradeStatus(s,team,bay.id,'advancedProduction').ok)startBuildingUpgrade(s,team,bay.id,'advancedProduction');else if(!pressed&&!waiting)waiting=BUILDING_UPGRADES.advancedProduction.cost;}
  if(spare()<650)return waiting;
  const floating=spare()>1400;
  const candidates=[];
  for(const factory of v.done('factory').sort(byId))candidates.push([factory,research.advancedBallistics&&k.mix.striker>0&&!factory.upgrades?.advancedProduction?'advancedProduction':'speed']);
  if(floating){
    for(const b of [...v.done('barracks'),...v.done('refinery')].sort(byId))candidates.push([b,'speed']);
    if(power.supply-power.demand<40)for(const b of [...v.done('factory'),...v.done('rocketTower')].sort(byId))candidates.push([b,'efficiency']);
  }
  for(const [b,id] of candidates)if(!b.upgrade&&buildingUpgradeStatus(s,team,b.id,id).ok){startBuildingUpgrade(s,team,b.id,id);break;}
  return waiting;
}

// Doctrine mix reweighted against the remembered enemy force: a role's value per credit is the damage it
// deals to what was seen, times its staying power against what that force deals (both via armorMultiplier).
// Outranging a foe cuts what it can deal back, decisively against towers that cannot close the distance.
function composition(s,team,v,k,available){
  const shares=Object.create(null);for(const role of COMBAT)shares[role]=available(role)?k.mix[role]||0:0;
  const byType=new Map();let total=0;
  for(const m of v.intel){const d=m.kind==='unit'?UNITS[m.type]:BUILDINGS[m.type];if(d.damage){const entry=byType.get(m.type)??{m,d,weight:0};entry.weight+=d.cost;byType.set(m.type,entry);total+=d.cost;}}
  const enemy=[...byType.values()];
  if(k.adapt&&total){
    const scores=[];
    for(const role of COMBAT)if(shares[role]){
      const type=raceUnit(s,team,role),d=UNITS[type],body={kind:'unit',type};let offense=0,incoming=0;
      for(const {m,d:e,weight} of enemy){
        const f=weight/total,outranged=d.range>e.range+1?(m.kind==='building'?.15:.6):1;
        offense+=f*armorMultiplier({type},{kind:m.kind,type:m.type})*d.damage/d.interval/d.cost;incoming+=f*armorMultiplier({type:m.type},body)*e.damage/e.interval/e.cost*outranged;
      }
      scores.push([role,Math.sqrt(offense*d.hp/d.cost/Math.max(1e-9,incoming))]);
    }
    const mean=scores.reduce((sum,[,score])=>sum+score,0)/scores.length;
    for(const [role,score] of scores)shares[role]*=Math.pow(score/mean,k.adapt);
  }
  const sum=COMBAT.reduce((n,role)=>n+shares[role],0)||1;for(const role of COMBAT)shares[role]/=sum;
  return shares;
}
// Every producer keeps working from the credits above the hold. The role furthest below its share goes
// next wherever a producer has room; when that unit is unaffordable, or only roles at their share have room,
// the commander saves rather than filling the queues with whatever is cheapest.
function produce(s,team,v,k,power,held){
  const credits=()=>s.teams[team].credits,easy=k.level==='easy',research=s.teams[team].research||{};
  const train=(role,producer,hold=held)=>{
    const type=raceUnit(s,team,role);if(credits()-hold<UNITS[type].cost)return false;
    if(!trainUnit(s,team,type,producer?.id).ok)return false;
    v.queued[role]=(v.queued[role]||0)+1;return true;
  };
  if(v.count('harvester')<Math.min(k.haulers,easy?2:1+2*v.done('refinery').length))train('harvester',undefined,0);
  const depth=k.queue+(credits()-held>1200?1:0);
  const producers={barracks:v.done('barracks'),factory:power.gridRatio<.65?[]:v.done('factory')};
  const free=role=>producers[['rifle','rocket','scout'].includes(role)?'barracks':'factory'].filter(e=>e.queue.length<depth&&(role!=='striker'||research.advancedBallistics&&e.upgrades?.advancedProduction))
    .sort((a,b)=>a.queue.length-b.queue.length||a.id-b.id)[0];
  const vehicles=v.units.filter(u=>armed(u)&&UNITS[u.type].armor!=='infantry').length;
  if(k.engineers&&vehicles>=6&&v.count('engineer')<Math.max(1,Math.floor(vehicles*k.engineers))&&free('tank'))train('engineer',free('tank'));
  if(!['rifle','tank'].some(role=>free(role)))return;
  // Shares cover only what can be built right now, so a missing foundry does not turn its share into rockets.
  // A foundry under construction keeps its roles' share, so the barracks do not spend it all on infantry.
  const planned=role=>['rifle','rocket','scout'].includes(role)?v.role('barracks').length>0:role==='striker'?producers.factory.some(e=>research.advancedBallistics&&e.upgrades?.advancedProduction):v.role('factory').length>0;
  const shares=composition(s,team,v,k,planned);
  for(let n=0;n<8;n++){
    const army=COMBAT.reduce((sum,role)=>sum+v.count(role),0),scoutShort=v.count('scout')<k.scouts;
    if(army>=k.armyCap&&!scoutShort)break;
    let best=null,gap=-Infinity;
    for(const role of COMBAT){
      if(k.caps&&v.count(role)>=k.caps[role]||!free(role))continue;
      const need=role==='scout'&&scoutShort?1e3:shares[role]?shares[role]*(army+1)-v.count(role):-Infinity;
      if(need>gap){gap=need;best=role;}
    }
    // A role already at its share waits: the credits go to the next unit that is actually short.
    if(!best||gap<=0||!train(best,free(best),best==='scout'&&scoutShort?0:held))break;
  }
}

function aiCombatPower(e,targets=[]){
  const d=definition(e),damage=e.kind==='unit'?unitStats(e).damage:d.damage;
  if(!damage)return 0;
  const effectiveness=targets.length?targets.reduce((sum,target)=>sum+armorMultiplier(e,target),0)/targets.length:1;
  return Math.sqrt(e.hp*damage/d.interval*effectiveness);
}
function aiRetreatPoint(s,buildings,unit,enemies){
  // Only nexuses repair military units; refineries also shelter working haulers.
  const havens=buildings.filter(b=>b.progress>=1&&(entityRole(b)==='core'||entityRole(unit)==='harvester'&&entityRole(b)==='refinery'));
  const danger=point=>enemies.reduce((sum,e)=>sum+(definition(e).damage&&distance(center(e),point)<12?aiCombatPower(e):0),0);
  const haven=havens.sort((a,b)=>distance(unit,center(a))+danger(center(a))*.08-distance(unit,center(b))-danger(center(b))*.08||a.id-b.id)[0];
  if(!haven)return null;
  const at=center(haven),threat=enemies.filter(e=>definition(e).damage).sort((a,b)=>distance(center(a),at)-distance(center(b),at)||a.id-b.id)[0];
  const dx=threat?at.x-center(threat).x:s.width/2-at.x,dy=threat?at.y-center(threat).y:s.height/2-at.y,length=Math.hypot(dx,dy)||1;
  return{x:clamp(at.x+dx/length*4.5,.5,s.width-.5),y:clamp(at.y+dy/length*4.5,.5,s.height-.5)};
}
function defendAI(s,army,buildings,intruders,enemies,power,reserved){
  const assigned=new Set(),groups=[];
  // Distinct incursions get their own nearby response. All inputs are currently
  // visible enemies; the commander cannot budget for concealed reinforcements.
  for(const enemy of [...intruders].sort(byId)){
    const group=groups.find(g=>distance(g.point,enemy)<10);
    if(group){group.enemies.push(enemy);group.point={x:group.enemies.reduce((sum,e)=>sum+e.x,0)/group.enemies.length,y:group.enemies.reduce((sum,e)=>sum+e.y,0)/group.enemies.length};}
    else groups.push({enemies:[enemy],point:{x:enemy.x,y:enemy.y}});
  }
  for(const group of groups){
    const threats=group.enemies.map(enemy=>({enemy,strength:aiCombatPower(enemy),cover:0}));
    // Share each powered sentry's strength only among enemies it can reach.
    // Overlapping coverage cannot pay for an intruder outside every gun's range.
    if(power.ratio>=1)for(const b of buildings)if(b.progress>=1&&definition(b).damage){
      const covered=threats.filter(t=>targetDistance(b,t.enemy)<=definition(b).range);
      if(!covered.length)continue;
      const share=aiCombatPower(b,covered.map(t=>t.enemy))*.8/covered.length;
      for(const threat of covered)threat.cover+=share;
    }
    const response=threats.filter(t=>t.cover<t.strength*1.25);
    if(!response.length)continue;
    // Fully covered enemies need no mobile budget and cannot make an exposed
    // flank look safe when its nearby defenders are actually outmatched.
    const hostile=response.reduce((sum,t)=>sum+t.strength,0),fixed=response.reduce((sum,t)=>sum+t.cover,0);
    const uncovered=response.filter(t=>t.cover===0),targets=(uncovered.length?uncovered:response).map(t=>t.enemy);
    const ids=new Set(targets.map(e=>e.id));
    // Reinforce with local units or idle reserves, not a column already fighting
    // on the far side of the map. An outmatched local force can fall back instead.
    const candidates=army.filter(u=>u.hp/u.maxHp>.3&&!assigned.has(u.id)&&(distance(u,group.point)<26||u.order.type==='idle')).map(u=>({u,strength:aiCombatPower(u,targets),
      arrival:distance(u,group.point)/unitStats(u).speed-(ids.has(u.order.targetId)?2:0)})).sort((a,b)=>a.arrival-b.arrival||a.u.id-b.u.id);
    const defenders=[];let available=fixed;
    for(const candidate of candidates){if(available>=hostile*1.25)break;defenders.push(candidate.u);available+=candidate.strength;assigned.add(candidate.u.id);}
    const overwhelmed=available<hostile*.65;
    for(const u of defenders){
      if(overwhelmed){
        // A losing local defense falls back without aborting an unrelated raid.
        const point=aiRetreatPoint(s,buildings,u,enemies);
        if(point&&(u.order.type!=='move'||distance(u.order,point)>2))issueOrder(s,[u.id],{type:'move',...point});
      }else if(u.order.type!=='attack'||!ids.has(u.order.targetId)){
        const target=[...targets].sort((a,b)=>targetDistance(u,a)-targetDistance(u,b)||a.id-b.id)[0];
        issueOrder(s,[u.id],{type:'attack',targetId:target.id,x:target.x,y:target.y});
      }
    }
  }
  // Raids use attack-move; direct attack commands are the perimeter response and AI micro (focus fire,
  // hauler raids). Release perimeter orders once their visible threat leaves, so one fast raider cannot
  // tow the defenders across the whole map.
  for(const u of army)if(u.order.type==='attack'&&!assigned.has(u.id)&&!reserved.has(u.id))stopUnits(s,[u.id]);
  return assigned;
}

// Scouting: the rover sweeps structural waypoints until it finds the enemy, then re-scouts on a cadence: the
// enemy main, the stalest remembered shard fields away from home and stale structures, standing off from
// remembered towers it can out-see. A damaged rover repairs at a nexus first.
function scoutAI(s,team,ai,v,k,ctx){
  const intel=ai.intel??={index:0,next:0};
  let scout=v.byId.get(intel.scoutId);
  if(!scout||entityRole(scout)!=='scout'||ctx.claimed.has(scout.id)){
    scout=v.role('scout').filter(u=>!ctx.claimed.has(u.id)&&!ctx.waveIds.has(u.id)&&!ctx.reserved.has(u.id)).sort((a,b)=>b.hp/b.maxHp-a.hp/a.maxHp||a.id-b.id)[0];
    if(scout)intel.scoutId=scout.id;else delete intel.scoutId;
  }
  if(!scout)return;
  ctx.claimed.add(scout.id);
  if(scout.hp/scout.maxHp<.45||intel.repair&&scout.hp/scout.maxHp<.9){
    intel.repair=true;const point=aiRetreatPoint(s,v.buildings,scout,v.enemies);
    if(point&&distance(scout,point)>1.5&&!bound(scout,point,'move'))issueOrder(s,[scout.id],{type:'move',...point});
    return;
  }
  delete intel.repair;
  if(intel.spot){if(s.time<intel.spot.until){const p={x:intel.spot.x,y:intel.spot.y};if(!bound(scout,p,'move'))issueOrder(s,[scout.id],{type:'move',...p});return;}delete intel.spot;}
  if(intel.explore){if(s.time<intel.explore){if(scout.order.type!=='explore')issueOrder(s,[scout.id],{type:'explore'});return;}delete intel.explore;}
  const {width:W,height:H}=s,{start}=mapLayout(s);
  if(!v.knownBuildings.length){
    const waypoints=[{x:W*35/72,y:H/2},{x:start.x+6,y:start.y+3},{x:W/6,y:H*15/56},{x:W*50/72,y:H*43/56},{x:start.x-3,y:start.y+11}].map(p=>onMap(s,team===1?p:{x:W-p.x,y:H-p.y}));
    if(distance(scout,waypoints[ai.scoutIndex%waypoints.length])<3)ai.scoutIndex++;
    const point=waypoints[ai.scoutIndex%waypoints.length];
    if(!bound(scout,point,'move'))issueOrder(s,[scout.id],{type:'move',...point});
    ai.mode='Scouting the sector';return;
  }
  if(!k.rescout){ctx.claimed.delete(scout.id);return;}
  if(!intel.route){
    if(s.time<intel.next){if(scout.order.type==='idle'&&distance(scout,ctx.rally)>6)issueOrder(s,[scout.id],{type:'move',...ctx.rally});return;}
    const home=v.cores.map(center),enemyCore=v.knownBuildings.filter(m=>entityRole(m.type)==='core').sort((a,b)=>distance(a,enemyAnchor(s,team))-distance(b,enemyAnchor(s,team))||a.id-b.id)[0];
    const fields=(ai.miningSites||[]).filter(p=>home.every(c=>distance(c,p)>22)).sort((a,b)=>a.seenAt-b.seenAt||a.y-b.y||a.x-b.x).slice(0,4);
    const stale=v.knownBuildings.filter(m=>s.time-m.seenAt>60&&entityRole(m.type)!=='wall').sort((a,b)=>a.seenAt-b.seenAt||a.id-b.id).slice(0,2);
    // A commander that has lost every nexus looks in from its rally instead.
    const base=v.core?center(v.core):ctx.rally;
    intel.route=[enemyCore||enemyAnchor(s,team),...fields,...stale].map(p=>{
      // Rovers out-see towers: look in from just beyond the nearest remembered tower's reach.
      const tower=v.knownTowers.filter(m=>distance(m,p)<11).sort((a,b)=>distance(a,p)-distance(b,p)||a.id-b.id)[0];
      if(!tower)return onMap(s,{x:p.x,y:p.y});
      const away=direction(base.x-tower.x,base.y-tower.y);return onMap(s,{x:tower.x+away.x*11.5,y:tower.y+away.y*11.5});
    });
    intel.index=0;
  }
  const point=intel.route[intel.index];
  if(!point||distance(scout,point)<4||scout.order.type==='idle'&&bound(scout,point,'move')){
    intel.index++;
    if(intel.index>=intel.route.length){delete intel.route;intel.index=0;intel.next=s.time+k.rescout;}
    return;
  }
  if(!bound(scout,point,'move'))issueOrder(s,[scout.id],{type:'move',...point});
}

// Hauler raids: a small fast squad goes for shard fields near remembered enemy depots, attacks only haulers
// it can see and leaves when it meets superior visible force or a remembered tower's reach.
function harassAI(s,team,ai,v,k,ctx,directive){
  const size=k.harass;
  if(!size||directive?.defend&&!directive.attack){if(ai.harass){delete ai.harass;}return;}
  let squad=ai.harass,members=squad?squad.ids.map(id=>v.byId.get(id)).filter(u=>u&&armed(u)&&!ctx.claimed.has(u.id)):[];
  if(squad&&!members.length){delete ai.harass;squad=null;ai.nextHarass=s.time+45;}
  if(!squad){
    if(s.time<Math.max(ai.nextHarass??0,k.firstRaid*.7))return;
    const fast=v.army.filter(u=>['scout','striker'].includes(entityRole(u))&&!ctx.claimed.has(u.id)&&!ctx.waveIds.has(u.id)&&u.hp/u.maxHp>.7&&u.order.type==='idle'&&distance(u,ctx.rally)<14).sort(byId).slice(0,size);
    if(fast.length<Math.min(2,size))return;
    const target=harassTarget(s,ai,v,centroid(fast),0);
    if(!target){ai.nextHarass=s.time+30;return;}
    squad=ai.harass={ids:fast.map(u=>u.id),tx:target.x,ty:target.y,state:'hunt',since:s.time,legs:0};members=fast;
    issueOrder(s,squad.ids,{type:'move',...target});
  }
  squad.ids=members.map(u=>u.id);
  for(const u of members){ctx.claimed.add(u.id);ctx.reserved.add(u.id);}
  const c=centroid(members),point={x:squad.tx,y:squad.ty};
  const guards=v.threats.filter(e=>distance(center(e),c)<10);
  const ours=members.reduce((sum,u)=>sum+aiCombatPower(u,guards),0),theirs=guards.reduce((sum,e)=>sum+aiCombatPower(e,members),0);
  const covered=v.knownTowers.some(m=>distance(m,c)<BUILDINGS[m.type].range+1.5);
  const wounded=members.reduce((sum,u)=>sum+u.hp,0)<members.reduce((sum,u)=>sum+u.maxHp,0)*.45;
  if(squad.state==='hunt'&&(theirs>ours*.8||covered||wounded||s.time-squad.since>110)){
    squad.state='return';squad.since=s.time;issueOrder(s,squad.ids,{type:'move',...ctx.rally});ai.nextHarass=s.time+40;return;
  }
  if(squad.state==='return'){
    if(members.every(u=>distance(u,ctx.rally)<10)||s.time-squad.since>60)delete ai.harass;
    return;
  }
  const prey=v.enemies.filter(e=>entityRole(e)==='harvester'&&distance(e,c)<13).sort((a,b)=>distance(a,c)-distance(b,c)||a.id-b.id)[0];
  if(prey){
    const idle=members.filter(u=>!(u.order.type==='attack'&&u.order.targetId===prey.id));
    if(idle.length)issueOrder(s,idle.map(u=>u.id),{type:'attack',targetId:prey.id});
    for(const u of members)if(targetDistance(u,prey)>unitRange(s,u))ctx.chasing.add(u.id);
    squad.preyAt=s.time;ai.mode='Raiding shard haulers';return;
  }
  if(distance(c,point)<5){
    if(s.time-Math.max(squad.preyAt??0,squad.arrived??s.time)>15){
      const next=harassTarget(s,ai,v,c,++squad.legs);delete squad.arrived;
      if(!next){squad.state='return';squad.since=s.time;issueOrder(s,squad.ids,{type:'move',...ctx.rally});return;}
      squad.tx=next.x;squad.ty=next.y;orderGroup(s,members,'move',next);
    }else squad.arrived??=s.time;
    return;
  }
  orderGroup(s,members,'move',point);
}
function harassTarget(s,ai,v,from,leg){
  const depots=v.knownBuildings.filter(m=>['refinery','core'].includes(entityRole(m.type)));
  const safe=p=>v.knownTowers.every(m=>distance(m,p)>BUILDINGS[m.type].range+3);
  const fields=(ai.miningSites||[]).filter(p=>depots.some(m=>distance(m,p)<18)&&safe(p)).sort((a,b)=>distance(a,from)-distance(b,from)||a.y-b.y||a.x-b.x);
  const p=fields[leg%Math.max(1,fields.length)];
  return p?onMap(s,{x:p.x,y:p.y}):null;
}

// Shelling from beyond vision. The commander uses only what lands in its sight: its own entities struck since
// its last look by a shooter it cannot see, and enemy impacts (shells, rockets, blasts) whose landing cell it
// currently sees, never where a projectile came from. Fire must be confirmed on two looks, so the last
// shots of a won fight do not send anyone chasing. The struck side of a formation faces the shooter; a rover
// or a flare lights that bearing, nearby fast units go for it and the rally steps back out of reach.
function shellingResponse(s,team,ai,v,k,ctx){
  if(ai.shelled&&s.time-ai.shelled.at>30)delete ai.shelled;
  if(k.level==='easy')return;
  const visible=s.visible[team],sees=p=>p.x>=0&&p.y>=0&&p.x<s.width&&p.y<s.height&&visible[cell(s,p.x,p.y)];
  const points=[];
  for(const e of [...v.units,...v.buildings])if(s.time-(e.lastHit??-99)<=k.think+.05&&!v.enemyById.has(e.attackerId))points.push(center(e));
  for(const fx of s.effects)if(fx.team!==team){
    const p=fx.type==='shell'||fx.type==='rocket'?{x:fx.tx,y:fx.ty}:fx.type==='explosion'&&fx.weapon?{x:fx.x,y:fx.y}:null;
    if(p&&sees(p))points.push(p);
  }
  if(!points.length)return;
  const hit=centroid(points);
  // A visible shooter explains the fire; the defense and the waves already answer it.
  if(v.threats.some(e=>targetDistance(e,hit)<=(definition(e).range||0)+2))return;
  const fire=ai.shelled;
  if(!fire||s.time-fire.at>8||Math.hypot(fire.x-hit.x,fire.y-hit.y)>12){ai.shelled={x:hit.x,y:hit.y,at:s.time,hits:1};return;}
  Object.assign(fire,{x:hit.x,y:hit.y,at:s.time,hits:fire.hits+1});
  if(s.time-(fire.answered??-99)<6)return;
  const nearby=v.army.filter(u=>distance(u,hit)<14),group=nearby.length?centroid(nearby):hit;
  let bearing=direction(hit.x-group.x,hit.y-group.y);
  if(Math.hypot(hit.x-group.x,hit.y-group.y)<.75){
    const ref=[...v.knownBuildings].sort((a,b)=>distance(a,hit)-distance(b,hit)||a.id-b.id)[0]||enemyAnchor(s,team);bearing=direction(ref.x-hit.x,ref.y-hit.y);
  }
  const spot=onMap(s,{x:hit.x+bearing.x*9,y:hit.y+bearing.y*9});
  Object.assign(fire,{bx:bearing.x,by:bearing.y,answered:s.time});ai.mode='Answering fire from concealment';
  const scouts=v.role('scout').filter(u=>u.hp/u.maxHp>.4&&(!ctx.claimed.has(u.id)||u.id===ai.intel?.scoutId)).sort((a,b)=>distance(a,spot)-distance(b,spot)||a.id-b.id);
  const flare=k.abilities&&scouts.find(u=>!(u.abilityReadyAt>s.time)&&distance(u,spot)<=ABILITIES.scout.reach);
  if(flare)useAbility(s,team,[flare.id],spot);
  else if(scouts[0]){
    (ai.intel??={index:0,next:0}).spot={x:spot.x,y:spot.y,until:s.time+10};ctx.claimed.add(scouts[0].id);
    if(!bound(scouts[0],spot,'move'))issueOrder(s,[scouts[0].id],{type:'move',...spot});
  }
  // A wave under fire turns on the bearing; otherwise nearby fast units form a short response.
  const near=new Set(nearby.map(u=>u.id)),wave=(ai.waves||[]).find(w=>w.ids.some(id=>near.has(id)));
  if(wave){wave.tx=spot.x;wave.ty=spot.y;delete wave.targetId;wave.state='advance';delete wave.rx;delete wave.ry;delete wave.need;return;}
  const responders=nearby.filter(u=>!ctx.claimed.has(u.id)&&!ctx.waveIds.has(u.id)&&u.hp/u.maxHp>.5&&['tank','striker','scout'].includes(entityRole(u))).sort(byId).slice(0,8);
  if(responders.length){
    (ai.waves??=[]).push({id:ai.waveId=(ai.waveId||0)+1,kind:'response',ids:responders.map(u=>u.id),tx:spot.x,ty:spot.y,state:'advance',since:s.time});
    for(const u of responders)ctx.waveIds.add(u.id);
    orderGroup(s,responders,'attackMove',spot);
  }
  // Whatever cannot answer steps back out of reach.
  const exposed=nearby.filter(u=>!ctx.claimed.has(u.id)&&!ctx.waveIds.has(u.id)&&s.time-(u.lastHit??-99)<3);
  if(exposed.length){const from=centroid(exposed);orderGroup(s,exposed,'move',onMap(s,{x:from.x-bearing.x*7,y:from.y-bearing.y*7}));for(const u of exposed)ctx.claimed.add(u.id);}
}

function pickTarget(s,team,ai,v,k,from,directive,exclude,guns=true){
  if(directive?.attack)return onMap(s,directive.attack);
  const candidates=v.knownBuildings.filter(m=>m.id!==exclude&&entityRole(m.type)!=='wall');
  if(candidates.length){
    // Without siege guns a wave goes for what towers do not cover, whatever the doctrine's appetite for towers.
    const priority=m=>!guns&&BUILDINGS[m.type].damage?Math.max(4,k.targets[entityRole(m.type)]??3):k.targets[entityRole(m.type)]??3;
    const score=m=>priority(m)*20+distance(from,m)+v.knownTowers.filter(t=>t.id!==m.id&&distance(t,m)<9.5).length*Math.max(k.towerAversion,guns?0:8);
    const m=candidates.map(m=>({m,score:score(m)})).sort((a,b)=>a.score-b.score||a.m.id-b.m.id)[0].m;
    return{x:m.x,y:m.y,id:m.id};
  }
  // Nothing remembered: probe the enemy's structural start, then the open sector.
  const anchor=enemyAnchor(s,team);
  if(!s.explored[team][cell(s,anchor.x,anchor.y)])return anchor;
  const {width:W,height:H}=s,{start}=mapLayout(s);
  const waypoints=[{x:W*35/72,y:H/2},{x:start.x+6,y:start.y+3},{x:W/6,y:H*15/56},{x:W*50/72,y:H*43/56},{x:start.x-3,y:start.y+11}].map(p=>onMap(s,team===1?p:{x:W-p.x,y:H-p.y}));
  return waypoints[ai.scoutIndex++%waypoints.length];
}
function aim(wave,target){wave.tx=target.x;wave.ty=target.y;if(target.id)wave.targetId=target.id;else delete wave.targetId;}

// Waves: launched from the rally on the doctrine's cadence, they chain objectives from where they stand,
// weigh every contact by Lanchester sums (visible enemies plus remembered towers), fall back to a forward
// regroup point when outmatched and merge with reinforcements there instead of pausing the whole army.
function manageWaves(s,team,ai,v,k,ctx,directive){
  const waves=ai.waves||[];
  for(const wave of waves){
    wave.ids=wave.ids.filter(id=>{const u=v.byId.get(id);return u&&armed(u)&&u.hp/u.maxHp>.3&&!ctx.claimed.has(id);});
    for(const id of wave.ids)ctx.claimed.add(id);
  }
  // Two advancing raids that meet on one objective fight as one.
  for(const wave of waves)for(const other of waves)if(wave!==other&&wave.ids.length&&other.ids.length&&wave.kind!=='response'&&other.kind!=='response'&&wave.state==='advance'&&other.state==='advance'&&
    wave.targetId===other.targetId&&wave.tx===other.tx&&wave.ty===other.ty&&distance(centroid(wave.ids.map(id=>v.byId.get(id))),centroid(other.ids.map(id=>v.byId.get(id))))<10){wave.ids.push(...other.ids);other.ids=[];}
  ai.waves=waves.filter(w=>w.ids.length);
  for(const wave of [...ai.waves])steerWave(s,team,ai,v,k,ctx,wave,directive);
  ai.waves=ai.waves.filter(w=>w.ids.length);
  // Fresh units at the rally reinforce a regrouping wave first, or form the next wave on cadence.
  const staged=v.army.filter(u=>!ctx.claimed.has(u.id)&&u.hp/u.maxHp>.3&&u.order.type!=='move'&&(distance(u,ctx.rally)<8||u.order.type==='idle'&&u.order.formation&&Math.hypot(u.order.formation.x-ctx.rally.x,u.order.formation.y-ctx.rally.y)<.5)).sort(byId);
  const regrouping=ai.waves.find(w=>w.state==='regroup'&&w.kind!=='response');
  const holdOnly=directive?.defend&&!directive.attack,waveMin=directive?.waveSize??k.waveMin,waveMax=Math.max(waveMin,directive?.waveSize??k.waveMax);
  if(regrouping&&staged.length>=2&&!holdOnly){
    regrouping.ids.push(...staged.map(u=>u.id));for(const u of staged)ctx.claimed.add(u.id);
    orderGroup(s,staged,'attackMove',{x:regrouping.rx,y:regrouping.ry});ai.mode='Reinforcing a forward regroup';
  }else if(!holdOnly&&s.time>=ai.nextRaid&&staged.length>=waveMin&&!(k.guns&&v.knownTowers.length&&staged.filter(u=>entityRole(u)==='artillery').length<k.guns&&s.time<ai.nextRaid+90)){
    // A siege doctrine holds the wave (for at most 90 s) until its guns can answer the known towers.
    const members=staged.slice(0,waveMax),target=pickTarget(s,team,ai,v,k,ctx.rally,directive,undefined,members.some(u=>entityRole(u)==='artillery'));
    const wave={id:ai.waveId=(ai.waveId||0)+1,kind:'raid',ids:members.map(u=>u.id),tx:target.x,ty:target.y,...(target.id?{targetId:target.id}:{}),state:'advance',since:s.time};
    ai.waves.push(wave);for(const u of members)ctx.claimed.add(u.id);
    orderGroup(s,members,'attackMove',target,pace(members));
    ai.nextRaid=s.time+k.cadence;ai.raid++;ai.mode=target.id?'Raiding enemy infrastructure':'Probing unexplored territory';
  }
  if(!ai.waves.length)delete ai.waves;
}
function steerWave(s,team,ai,v,k,ctx,wave,directive){
  const members=wave.ids.map(id=>v.byId.get(id)),c=centroid(members);
  const near=v.threats.filter(e=>distance(center(e),c)<14);
  const remembered=v.knownTowers.filter(m=>!v.enemyById.has(m.id)&&distance(m,c)<12);
  const ours=members.reduce((sum,u)=>sum+aiCombatPower(u,near),0);
  const theirs=near.reduce((sum,e)=>sum+aiCombatPower(e,members),0)+remembered.reduce((sum,m)=>sum+memoryPower(m),0);
  if(k.lanchester&&theirs>0&&ours<theirs*k.retreat){
    // Outmatched: fall back away from the contact, or all the way home if already falling back.
    const foe=near.length?centroid(near):remembered.length?centroid(remembered):{x:wave.tx,y:wave.ty},away=direction(c.x-foe.x,c.y-foe.y);
    let point=wave.state==='regroup'?ctx.rally:onMap(s,{x:c.x+away.x*12,y:c.y+away.y*12});
    // Near home the wave falls back to the rally. The comparison is inverted so that a point that is not a real
    // position also falls back there: the regroup point is saved with the wave.
    if(!(distance(point,ctx.rally)>=16&&distance(c,ctx.rally)>=16))point=ctx.rally;
    if(wave.state!=='regroup'||wave.rx!==point.x||wave.ry!==point.y){
      Object.assign(wave,{state:'regroup',since:s.time,need:+theirs.toFixed(3),rx:point.x,ry:point.y,tries:(wave.tries||0)+1});
      issueOrder(s,wave.ids,{type:'move',...point});ai.mode='Regrouping under pressure';
    }
    return;
  }
  if(wave.state==='regroup'){
    const point={x:wave.rx,y:wave.ry},gathered=members.filter(u=>distance(u,point)<8).length>=members.length*.7;
    const strength=members.reduce((sum,u)=>sum+aiCombatPower(u),0);
    if(gathered&&(strength>=wave.need*k.commit||s.time-wave.since>50)){
      if(wave.tries>=2){aim(wave,pickTarget(s,team,ai,v,k,c,directive,wave.targetId,members.some(u=>entityRole(u)==='artillery')));wave.tries=0;}
      wave.state='advance';wave.since=s.time;delete wave.rx;delete wave.ry;delete wave.need;
      orderGroup(s,members,'attackMove',{x:wave.tx,y:wave.ty},pace(members));
    }else orderGroup(s,members.filter(u=>u.order.type==='idle'&&distance(u,point)>8),'attackMove',point);
    return;
  }
  // Advancing. A destroyed or vanished objective hands the wave the next one from where it stands.
  const goal={x:wave.tx,y:wave.ty};
  const reached=wave.targetId?!ai.known[wave.targetId]:distance(c,goal)<6&&!near.length;
  if(reached){
    if(wave.kind==='response'||directive?.defend&&!directive.attack){orderGroup(s,members,'attackMove',ctx.rally);wave.ids=[];return;}
    if(!(directive?.attack&&!wave.targetId)){
      const next=pickTarget(s,team,ai,v,k,c,directive,undefined,members.some(u=>entityRole(u)==='artillery'));aim(wave,next);
      orderGroup(s,members,'attackMove',next,pace(members));ai.mode=next.id?'Pressing the attack':'Probing unexplored territory';
    }else orderGroup(s,members.filter(u=>u.order.type==='idle'&&distance(u,goal)>6),'attackMove',goal);
    for(const u of members)ctx.advancing.add(u.id);
    return;
  }
  for(const u of members)ctx.advancing.add(u.id);
  if(siegeWave(s,team,ai,v,k,ctx,wave,members,c))return;
  if(near.length&&k.focus)focusFire(s,v,k,members,near,ctx);
  const engaged=u=>u.order.type==='attack'&&near.some(e=>e.id===u.order.targetId);
  orderGroup(s,members.filter(u=>!engaged(u)),'attackMove',goal);
  if(near.length)for(const u of members)ctx.reserved.add(u.id);
}
// Focus fire: the most dangerous enemy per hit point first, at most k.focus attackers on any one target, and
// only shooters already within reach; a valid assignment is kept between thinks.
function focusFire(s,v,k,members,near,ctx){
  const targets=near.filter(e=>e.kind==='unit'||BUILDINGS[e.type].damage);if(!targets.length)return;
  const value=e=>aiCombatPower(e,members)/Math.max(1,e.hp)*(['artillery','rocket'].includes(entityRole(e))?1.5:1);
  const ranked=targets.map(e=>({e,value:value(e)})).sort((a,b)=>b.value-a.value||a.e.id-b.e.id).map(t=>t.e),load=new Map();
  const shooters=members.filter(u=>UNITS[u.type].damage>0).sort(byId),open=[];
  for(const u of shooters){
    const current=u.order.type==='attack'&&ranked.find(e=>e.id===u.order.targetId);
    if(current&&(load.get(current.id)||0)<k.focus&&targetDistance(u,current)<=unitRange(s,u)+1)load.set(current.id,(load.get(current.id)||0)+1);else open.push(u);
  }
  const orders=new Map();
  for(const u of open){
    const target=ranked.find(e=>(load.get(e.id)||0)<k.focus&&targetDistance(u,e)<=unitRange(s,u)+1);
    if(!target)continue;
    load.set(target.id,(load.get(target.id)||0)+1);if(!orders.has(target.id))orders.set(target.id,[]);orders.get(target.id).push(u.id);
  }
  for(const [targetId,ids] of orders)issueOrder(s,ids,{type:'attack',targetId});
  for(const u of shooters)if(u.order.type==='attack')ctx.reserved.add(u.id);
}
// Siege stand-off: against a remembered tower the guns park beyond its reach on the wave's side while the
// escort holds outside it; a rover or flare spots the tower, or a barrage goes onto its remembered spot.
function siegeWave(s,team,ai,v,k,ctx,wave,members,c){
  if(!k.siege)return false;
  const guns=members.filter(u=>entityRole(u)==='artillery');if(!guns.length)return false;
  const tower=v.knownTowers.filter(m=>distance(m,c)<17).sort((a,b)=>distance(a,c)-distance(b,c)||a.id-b.id)[0];
  if(!tower){delete wave.siege;return false;}
  const visible=v.enemyById.get(tower.id),defenders=v.threats.filter(e=>e.id!==tower.id&&distance(center(e),tower)<10);
  const theirs=(visible?aiCombatPower(visible,members):memoryPower(tower))+defenders.reduce((sum,e)=>sum+aiCombatPower(e,members),0);
  // An overwhelming wave simply storms the position.
  if(members.reduce((sum,u)=>sum+aiCombatPower(u),0)>theirs*k.storm){delete wave.siege;return false;}
  wave.siege=tower.id;ai.mode='Shelling known defenses';
  const range=BUILDINGS[tower.type].range,away=direction(c.x-tower.x,c.y-tower.y);
  const hold=onMap(s,{x:tower.x+away.x*(range+3.5),y:tower.y+away.y*(range+3.5)});
  orderGroup(s,members.filter(u=>entityRole(u)!=='artillery'&&!(u.order.type==='attack'&&v.enemyById.has(u.order.targetId)&&targetDistance(u,v.enemyById.get(u.order.targetId))<=unitRange(s,u))),'attackMove',hold);
  if(visible){const idle=guns.filter(u=>!(u.order.type==='attack'&&u.order.targetId===visible.id));if(idle.length)issueOrder(s,idle.map(u=>u.id),{type:'attack',targetId:visible.id});for(const u of guns)ctx.reserved.add(u.id);}
  else{
    // Each gun takes its own point on an arc beyond the tower's reach, so no parking slot drifts inside it.
    guns.sort(byId).forEach((u,i)=>{
      const turn=(i-(guns.length-1)/2)*.16,p=onMap(s,{x:tower.x+(away.x*Math.cos(turn)-away.y*Math.sin(turn))*10.8,y:tower.y+(away.x*Math.sin(turn)+away.y*Math.cos(turn))*10.8});
      if(!bound(u,p,'move'))issueOrder(s,[u.id],{type:'move',...p});
    });
    const scouts=v.role('scout').filter(u=>u.hp/u.maxHp>.45&&(u.id===ai.intel?.scoutId||!ctx.claimed.has(u.id))).sort((a,b)=>distance(a,tower)-distance(b,tower)||a.id-b.id);
    const flare=k.abilities&&scouts.find(u=>!(u.abilityReadyAt>s.time)&&distance(u,tower)<=ABILITIES.scout.reach);
    if(flare)useAbility(s,team,[flare.id],{x:tower.x,y:tower.y});
    else if(scouts[0]){
      const spot=onMap(s,{x:tower.x+away.x*11.5,y:tower.y+away.y*11.5});
      (ai.intel??={index:0,next:0}).spot={x:spot.x,y:spot.y,until:s.time+8};ctx.claimed.add(scouts[0].id);
      if(!bound(scouts[0],spot,'move'))issueOrder(s,[scouts[0].id],{type:'move',...spot});
    }
  }
  return true;
}

// Abilities, used only on what the commander sees or remembers: overdrive and afterburner to close or to
// escape, dig in while holding, long shot against armor just out of reach, barrage on remembered towers or
// visible clusters, field patches for badly damaged vehicles and structures.
function useAbilities(s,team,v,k,ctx){
  if(!k.abilities)return;
  const groups={rifle:[],tank:[],striker:[],rocket:[]};
  for(const u of v.units){
    if(u.abilityReadyAt>s.time||u.barrage||!abilityFor(u))continue;
    const role=entityRole(u),range=unitRange(s,u);
    if(role==='rifle'){if(u.order.type==='idle'&&!ctx.advancing.has(u.id)&&v.threats.some(e=>e.kind==='unit'&&targetDistance(u,e)<=range+1.5))groups.rifle.push(u.id);}
    else if(role==='tank'||role==='striker'){
      const closing=ctx.advancing.has(u.id)&&v.threats.some(e=>{const d=targetDistance(u,e);return d>range&&d<12;});
      const escaping=u.hp/u.maxHp<=.3&&u.order.type==='move'&&v.threats.some(e=>targetDistance(e,u)<9);
      if(closing||escaping||ctx.chasing.has(u.id))groups[role].push(u.id);
    }else if(role==='rocket'){if(u.order.type!=='move'&&v.enemies.some(e=>(e.kind==='building'?entityRole(e)!=='wall':UNITS[e.type].armor==='heavy')&&targetDistance(u,e)>range&&targetDistance(u,e)<=range+ABILITIES.rocket.range))groups.rocket.push(u.id);}
    else if(role==='artillery'){const point=barragePoint(s,v,u);if(point)useAbility(s,team,[u.id],point);}
    else if(role==='engineer'){
      if(s.teams[team].credits>250&&[...v.units,...v.buildings].some(e=>e!==u&&e.progress>=1&&e.hp<e.maxHp*.55&&(e.kind==='building'||UNITS[e.type].armor!=='infantry')&&targetDistance(u,e)<=ABILITIES.engineer.reach))useAbility(s,team,[u.id]);
    }
  }
  for(const ids of Object.values(groups))if(ids.length)useAbility(s,team,ids);
}
function barragePoint(s,v,u){
  const from=center(u),reach=unitRange(s,u)+ABILITIES.artillery.reachBonus;
  const tower=v.knownTowers.filter(m=>distance(m,from)<=reach-.2).sort((a,b)=>distance(a,from)-distance(b,from)||a.id-b.id)[0];
  if(tower)return{x:tower.x,y:tower.y};
  const local=v.enemies.filter(e=>distance(center(e),from)<=reach+1.4);let best=null,count=2;
  for(const e of local)if(e.kind==='unit'&&distance(e,from)<=reach-.2){
    const cluster=local.filter(o=>distance(center(o),e)<=1.6);
    if(cluster.length>count){count=cluster.length;best=centroid(cluster);}
  }
  return best&&distance(best,from)<=reach-.2?best:null;
}

function rallyPoint(s,team,ai,v,directive){
  const zone=directive?.defend;if(zone)return onMap(s,zone);
  if(!v.core)return v.army.length?onMap(s,centroid(v.army)):enemyAnchor(s,team===1?0:1);
  const c=center(v.core),{width:W,height:H}=s;let rally={x:c.x+(W/2-c.x)*.3,y:c.y+(H/2-c.y)*.3};
  // Shelled staging steps back toward the nexus for a while.
  const fire=ai.shelled;if(fire?.answered!==undefined&&s.time-fire.answered<30&&distance(fire,rally)<20)rally={x:rally.x-fire.bx*7,y:rally.y-fire.by*7};
  return onMap(s,rally);
}

export function thinkAI(s,team=1){
  const ai=aiState(s,team),k=aiKnobs(s,ai),directive=missionDirective(s,team);
  // Commanders on both sides think half an interval apart, so their work never lands in one step.
  ai.nextThink=s.time+k.think+(team===0&&s.time<4?k.think/2:0);
  const v=survey(s,team,ai),power=powerStats(s,team);
  const ctx={claimed:new Set(),reserved:new Set(),advancing:new Set(),chasing:new Set(),waveIds:new Set()};
  for(const wave of ai.waves||[])for(const id of wave.ids){ctx.waveIds.add(id);ctx.reserved.add(id);}
  for(const id of ai.harass?.ids||[])ctx.reserved.add(id);
  ctx.rally=rallyPoint(s,team,ai,v,directive);
  const haulers=v.role('harvester'),zone=directive?.defend;
  // A passing scout is left to guards; scout fire against structures or haulers gets the bounded response.
  // Raiders hitting haulers anywhere, threats at the rally and inside a defended zone are intruders too.
  const shooters=new Set(),raiders=new Set();
  for(const t of v.buildings)if(s.time-(t.lastHit??-99)<4)shooters.add(t.attackerId);
  for(const h of haulers)if(s.time-(h.lastHit??-99)<4){shooters.add(h.attackerId);raiders.add(h.attackerId);}
  // Coarse 13-tile cells around every structure reject distant enemies before the exact distance test.
  const near=new Set();for(const b of v.buildings){const c=center(b),bx=Math.floor(c.x/13),by=Math.floor(c.y/13);for(let y=by-1;y<=by+1;y++)for(let x=bx-1;x<=bx+1;x++)near.add(bucketKey(x,y));}
  const byBase=e=>near.has(bucketKey(Math.floor(e.x/13),Math.floor(e.y/13)))&&v.buildings.some(b=>distance(center(b),e)<13);
  const intruders=v.threats.filter(e=>e.kind==='unit'&&(
    (byBase(e)||distance(e,ctx.rally)<12)&&(entityRole(e)!=='scout'||shooters.has(e.id))||
    zone&&distance(e,zone)<zone.r+4||raiders.has(e.id)));
  if(v.core){
    // Saving for an expansion never outranks rebuilding a broken army, answering an attack or matching the
    // force last seen in the field, unless the treasury already covers both.
    const ours=v.army.reduce((sum,u)=>sum+aiCombatPower(u),0),seenForce=v.intel.reduce((sum,m)=>sum+(m.kind==='unit'?memoryPower(m):0),0);
    const pressed=(intruders.length>0||v.army.length<k.waveMin||ours<seenForce*.8)&&s.teams[team].credits<UNITS[raceUnit(s,team,'constructor')].cost+800;
    const plan=expandAI(s,team,ai,v,k,directive,pressed),held=plan.held;
    const waiting=buildBase(s,team,ai,v,k,power,ctx.rally,held);
    for(const b of v.buildings)if(b.progress>=1&&b.hp<b.maxHp*.7&&s.teams[team].credits>150)b.repairing=true;
    const tech=researchAI(s,team,v,k,power,held+waiting,pressed);
    produce(s,team,v,k,power,held+waiting+tech);
    for(const b of v.buildings){
      const role=entityRole(b);
      if(role==='refinery'){
        const ore=(ai.miningSites||[]).filter(site=>distance(site,center(b))<18).sort((a,c)=>distance(a,center(b))-distance(c,center(b))||a.y-c.y||a.x-c.x)[0];
        if(ore)b.rally={x:ore.x,y:ore.y};
      }else if((role==='barracks'||role==='factory')&&(b.rally?.x!==ctx.rally.x||b.rally?.y!==ctx.rally.y))b.rally={x:ctx.rally.x,y:ctx.rally.y};
    }
  }else if(v.role('constructor').length){
    // No nexus left (the Charter keeps the side in play while a vehicle survives): the vehicle redeploys at a
    // field and any surviving producers keep training from the treasury.
    const plan=expandAI(s,team,ai,v,k,directive,false);
    produce(s,team,v,k,power,plan.held);
  }
  const defenders=defendAI(s,v.army,v.buildings,intruders,v.enemies,power,ctx.reserved);
  for(const id of defenders)ctx.claimed.add(id);
  if(intruders.length)ai.mode='Defending perimeter';
  for(const u of [...v.army.filter(u=>u.hp/u.maxHp<=.3),...haulers.filter(h=>v.threats.some(e=>targetDistance(h,e)<7))]){
    const point=aiRetreatPoint(s,v.buildings,u,v.enemies);ctx.claimed.add(u.id);
    if(point&&distance(u,point)>1&&(u.order.type!=='move'||distance(u.order,point)>2))issueOrder(s,[u.id],{type:'move',...point});
  }
  scoutAI(s,team,ai,v,k,ctx);
  harassAI(s,team,ai,v,k,ctx,directive);
  shellingResponse(s,team,ai,v,k,ctx);
  manageWaves(s,team,ai,v,k,ctx,directive);
  for(const engineer of v.role('engineer'))if(engineer.order.type==='idle'&&!engineer.repairActive){
    const heavy=u=>['tank','artillery'].includes(entityRole(u)),escort=v.army.find(u=>ctx.waveIds.has(u.id)&&heavy(u))||v.army.find(heavy);
    if(escort&&distance(engineer,escort)>5)issueOrder(s,[engineer.id],{type:'attackMove',x:escort.x,y:escort.y});
  }
  useAbilities(s,team,v,k,ctx);
  // Unassigned units return to the rally and hold it in Defend stance, answering visible attackers.
  const loose=v.army.filter(u=>!ctx.claimed.has(u.id)&&u.order.type==='idle');
  const away=loose.filter(u=>distance(u,ctx.rally)>4&&!bound(u,ctx.rally,'attackMove'));
  if(away.length)issueOrder(s,away.map(u=>u.id),{type:'attackMove',...ctx.rally});
  if(k.level!=='easy')setUnitStance(s,loose.filter(u=>!away.includes(u)&&u.stance!=='defend').map(u=>u.id),'defend');
}
