// Ashline missions: deterministic objectives, fail rules and scripted triggers. Definitions (and any setup
// functions) stay in campaign.js; a game stores only plain progress in s.mission, so it saves,
// structured-clones and continues exactly. Objectives always describe the player, team 0. Mission logic
// may read the whole battlefield, but it only publishes static mission points, never hidden positions.
// The import cycle with sim.js is safe: neither module reads the other's bindings while it evaluates.
// Numeric trigger state lives in s.mission.counters beside the objective counters: 'repeat:<id>' (fires so
// far), 'next:<id>' (next scheduled time since start) and 'at:<id>' (time of the last fire), plus
// 'rivalHold:<zone>' for the rival's cumulative hold of a contested zone.
import {BUILDINGS,UNITS,UNIT_CAP,RESEARCH,BUILDING_UPGRADES,own,alive,center,clamp,event,addEntity,issueOrder,setUnitStance,rebuildNavigation,raceUnit,raceBuilding,entityRole,unitStats} from './sim.js';
import {mapLayout,hash} from './terrain.js';
import {MISSIONS} from './campaign.js';

export const MISSION_INTERVAL=.25;
const PLAYER=0,RIVAL=1;
export const OBJECTIVE_TYPES=['destroyTagged','annihilate','survive','holdZone','reachZone','nexusInZone','deliver','research','build','train','kills','protectTagged','limitLosses','endure'];
export const FAIL_RULES=['coreLost','allUnitsLost','tagLost','timeLimit','rivalHold'];
// Objectives that hold until the end: they can fail during play and complete at victory.
const HOLDING=['protectTagged','limitLosses'];
const DEFAULT_FAIL=[{type:'coreLost'}];
const SETTINGS=['width','height','profile','races','aiTeams','aiProfiles'];
const CONDITIONS=['time','every','limit','until','after','objectiveDone','objectiveFailed','tagDestroyed','tagsLeft','zoneEntered','kills'];
const ACTIONS=['say','spawn','reveal','credits','directive','rally'];
const MAX_RADIUS=48,MAX_VETERANS=12;
export const WAVE_SCALE={easy:.7,normal:1,hard:1.3};
// A point along the line from the player's base anchor (0) to the rival's (1).
const LANE=/^lane:(0(?:\.\d+)?|1(?:\.0+)?)$/;

export function missionDefinition(id){
  if(typeof id!=='string'||!Object.hasOwn(MISSIONS,id))throw new RangeError('Unsupported mission');
  return MISSIONS[id];
}
// A mission fixes whichever skirmish settings it defines; profiles follow its own AI teams.
export function missionSettings(def,options){
  const settings={...options};
  for(const key of SETTINGS)if(def[key]!==undefined)settings[key]=def[key];
  if(def.aiTeams!==undefined&&def.aiProfiles===undefined)settings.aiProfiles=Object.fromEntries(Object.entries(options.aiProfiles||{}).filter(([team])=>def.aiTeams.map(String).includes(team)));
  return settings;
}

const isUnitRole=role=>Object.hasOwn(UNITS,role)&&UNITS[role].role===role;
const isBuildingRole=role=>Object.hasOwn(BUILDINGS,role)&&BUILDINGS[role].role===role;
const whole=(value,min=0,max=UNIT_CAP)=>Number.isInteger(value)&&value>=min&&value<=max;
// Authoring errors surface when the operation is created, never halfway through a match. Every bound here
// matches save validation, so an operation that starts can always be saved and loaded again.
function checkDefinition(def){
  const fail=reason=>{throw new Error(`Mission ${def.id}: ${reason}`);};
  const positive=value=>Number.isFinite(value)&&value>0,tag=value=>typeof value==='string'&&value.length>0&&value.length<=40;
  const radius=value=>Number.isFinite(value)&&value>=.5&&value<=MAX_RADIUS,text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
  const ids=list=>{const seen=new Set();for(const item of list){if(typeof item.id!=='string'||!item.id||item.id.length>40||seen.has(item.id))fail(`bad or duplicate id ${item.id}`);seen.add(item.id);}return seen;};
  if(!Array.isArray(def.objectives)||!def.objectives.length)fail('needs objectives');
  if(!def.objectives.some(o=>!o.secondary))fail('needs a primary objective');
  const zones=ids(def.zones||[]),objectives=ids(def.objectives),triggers=def.triggers||[],triggerIds=ids(triggers);
  // Trigger and zone state shares the 256 saved counters with objective tallies.
  if(triggers.length>60||zones.size>16)fail('too many triggers or zones');
  const zone=id=>{if(!zones.has(id))fail(`unknown zone ${id}`);};
  const known=new Set();
  // Only arriving forces may use 'fogEdge', which depends on what the opposing side currently sees.
  const place=(spec,arrival=false)=>{
    if(spec&&typeof spec==='object'){
      if(spec.at!==undefined){place(spec.at,arrival);if(!['dx','dy'].every(key=>spec[key]===undefined||Number.isFinite(spec[key])))fail(`malformed offset ${JSON.stringify(spec)}`);}
      else if(!Number.isFinite(spec.x)||!Number.isFinite(spec.y))fail(`malformed point ${JSON.stringify(spec)}`);
    }
    else if(!['start','end','center','edge'].includes(spec)&&!(arrival&&spec==='fogEdge')&&!LANE.test(spec)&&!known.has(spec))fail(`unknown point ${spec}`);
  };
  const directive=(d,where)=>{
    if(d.team!==undefined&&![0,1].includes(d.team))fail(`${where} names an unknown team`);
    if(d.attack!=null)place(d.attack);
    if(d.defend!=null){place(d.defend);if(d.defend.r!==undefined&&!radius(d.defend.r))fail(`${where} defends a malformed radius`);}
    if(d.noExpand!==undefined&&typeof d.noExpand!=='boolean')fail(`${where} has a malformed noExpand`);
    if(d.waveSize!=null&&!whole(d.waveSize,1))fail(`${where} needs a waveSize of at least one`);
  };
  for(const z of def.zones||[]){
    if(!radius(z.r)||!text(z.label,80))fail(`zone ${z.id} needs a radius and label`);
    if(z.lit!==undefined&&typeof z.lit!=='boolean')fail(`zone ${z.id} has a malformed lit flag`);
    place(z.at);known.add(z.id);
  }
  for(const o of def.objectives){
    if(!OBJECTIVE_TYPES.includes(o.type))fail(`unknown objective type ${o.type}`);
    if(!text(o.label,120))fail(`objective ${o.id} needs a label`);
    if(['holdZone','reachZone','nexusInZone'].includes(o.type))zone(o.zone);
    if(['build','train'].includes(o.type)&&!(o.type==='build'?isBuildingRole:isUnitRole)(o.role))fail(`objective ${o.id} has an unknown role`);
    if(o.roles!==undefined&&!(Array.isArray(o.roles)&&o.roles.every(isUnitRole)))fail(`objective ${o.id} has unknown roles`);
    if(['destroyTagged','protectTagged'].includes(o.type)&&!tag(o.tag))fail(`objective ${o.id} needs a tag`);
    if(o.all!==undefined&&(o.type!=='protectTagged'||typeof o.all!=='boolean'))fail(`objective ${o.id} cannot protect all`);
    if(['survive','holdZone'].includes(o.type)&&!positive(o.seconds))fail(`objective ${o.id} needs seconds`);
    if(o.type==='deliver'&&(!positive(o.amount)||o.mineralType!==undefined&&![1,2,3].includes(o.mineralType)))fail(`objective ${o.id} needs an amount and a known mineral`);
    if(['reachZone','build','train','kills'].includes(o.type)&&(o.count!==undefined||o.type==='kills')&&!(Number.isInteger(o.count)&&o.count>0))fail(`objective ${o.id} needs a whole count`);
    if(o.type==='research'&&!Object.hasOwn(RESEARCH,o.research))fail(`objective ${o.id} names unknown research`);
    if(o.type==='limitLosses'&&(o.units===undefined&&o.structures===undefined||![o.units,o.structures].every(n=>n===undefined||whole(n,0,100000))))fail(`objective ${o.id} needs whole loss limits`);
    if(o.sufficient!==undefined&&(o.sufficient!==true||o.secondary||HOLDING.includes(o.type)))fail(`objective ${o.id} cannot be sufficient`);
  }
  for(const rule of def.fail??DEFAULT_FAIL){
    if(!FAIL_RULES.includes(rule.type))fail(`unknown fail rule ${rule.type}`);
    if(rule.type==='tagLost'&&!tag(rule.tag)||['timeLimit','rivalHold'].includes(rule.type)&&!positive(rule.seconds))fail(`fail rule ${rule.type} is incomplete`);
    if(rule.type==='rivalHold')zone(rule.zone);
    if(rule.label!==undefined&&!text(rule.label,40))fail(`fail rule ${rule.type} has a malformed label`);
  }
  for(const t of triggers){
    const w=t.when||{};
    if(Object.keys(w).some(key=>!CONDITIONS.includes(key)))fail(`trigger ${t.id} has an unknown condition`);
    for(const key of ['time','until'])if(w[key]!==undefined&&!(Number.isFinite(w[key])&&w[key]>=0))fail(`trigger ${t.id} has a malformed ${key}`);
    if(w.every!==undefined&&!(Number.isFinite(w.every)&&w.every>=1))fail(`trigger ${t.id} must repeat at most once a second`);
    if((w.limit!==undefined||w.until!==undefined)&&w.every===undefined)fail(`trigger ${t.id} limits a trigger that does not repeat`);
    if(w.limit!==undefined&&!whole(w.limit,1,10000))fail(`trigger ${t.id} has a malformed limit`);
    if(w.after!==undefined&&!(w.after&&triggerIds.has(w.after.trigger)&&w.after.trigger!==t.id&&Number.isFinite(w.after.seconds)&&w.after.seconds>=0))fail(`trigger ${t.id} follows an unknown trigger`);
    for(const key of ['objectiveDone','objectiveFailed'])if(w[key]!==undefined&&!objectives.has(w[key]))fail(`trigger ${t.id} waits for an unknown objective`);
    if(w.tagDestroyed!==undefined&&!tag(w.tagDestroyed)||w.tagsLeft!==undefined&&!(w.tagsLeft&&tag(w.tagsLeft.tag)&&whole(w.tagsLeft.count,0)))fail(`trigger ${t.id} watches a malformed tag`);
    if(w.zoneEntered!==undefined)zone(w.zoneEntered);
    if(w.kills!==undefined&&!whole(w.kills,1,1e6))fail(`trigger ${t.id} needs a whole kill count`);
    if(!Array.isArray(t.do))fail(`trigger ${t.id} needs actions`);
    for(const action of t.do){
      if(Object.keys(action).some(key=>!ACTIONS.includes(key)))fail(`trigger ${t.id} has an unknown action`);
      if(action.reveal!==undefined&&!objectives.has(action.reveal))fail(`trigger ${t.id} reveals an unknown objective`);
      if(action.credits!==undefined&&!positive(action.credits))fail(`trigger ${t.id} grants malformed credits`);
      if(action.say&&!(text(action.say.text,1000)&&text(action.say.speaker,40)))fail(`trigger ${t.id} has a malformed line`);
      const spawn=action.spawn;
      if(spawn){
        if(!(Array.isArray(spawn.units)&&spawn.units.length&&spawn.units.every(([role,count=1,growth=0,from=0])=>(isUnitRole(role)||isBuildingRole(role))&&whole(count,0)&&Number.isFinite(growth)&&growth>=0&&growth<=100&&whole(from,0,10000))))fail(`trigger ${t.id} spawns an unknown role or count`);
        if(spawn.team!==undefined&&![0,1].includes(spawn.team)||spawn.tag!==undefined&&!tag(spawn.tag))fail(`trigger ${t.id} spawns for an unknown team or tag`);
        if(spawn.at!==undefined)place(spawn.at,true);
        // A scripted assault knows where the player's claim stands; the player's forces never get that route.
        if(spawn.order==='attackBase'&&(spawn.team??RIVAL)!==RIVAL)fail(`trigger ${t.id} sends the player at the rival base`);
        if(spawn.order!==undefined&&spawn.order!=='attackBase')place(spawn.order.zone??spawn.order);
        if(spawn.cap!==undefined&&!whole(spawn.cap,1)||spawn.kills!==undefined&&!whole(spawn.kills,0,1000)||spawn.stance!==undefined&&!['guard','defend'].includes(spawn.stance)||spawn.text!==undefined&&!text(spawn.text,200))fail(`trigger ${t.id} has malformed spawn options`);
      }
      if(action.directive)directive(action.directive,`trigger ${t.id}`);
      if(action.rally){
        const {team,at,max}=action.rally;
        if(team!==undefined&&![0,1].includes(team)||max!==undefined&&!whole(max,1))fail(`trigger ${t.id} rallies an unknown team`);
        place(at);
      }
    }
  }
  const catalog={buildings:isBuildingRole,units:isUnitRole,research:id=>Object.hasOwn(RESEARCH,id),upgrades:id=>Object.hasOwn(BUILDING_UPGRADES,id)};
  for(const [category,list] of Object.entries(def.allow||{}))if(!Object.hasOwn(catalog,category)||!Array.isArray(list)||!list.every(catalog[category]))fail(`allow.${category} must list known ids`);
  for(const [team,d] of Object.entries(def.directives||{})){if(!['0','1'].includes(team))fail('directives are keyed by team');directive(d,'directive');}
  if(def.score!==undefined&&def.score!=='survival')fail('unknown scoring');
}

const clampPoint=(s,x,y)=>({x:clamp(x,.5,s.width-.5),y:clamp(y,.5,s.height-.5)});
function resolvePoint(s,spec,team=RIVAL){
  if(spec&&typeof spec==='object'){
    if(spec.at!==undefined){const p=resolvePoint(s,spec.at,team);return clampPoint(s,p.x+(spec.dx||0),p.y+(spec.dy||0));}
    if(Number.isFinite(spec.x)&&Number.isFinite(spec.y))return clampPoint(s,spec.x,spec.y);
  }
  if(typeof spec==='string'){
    const {start,end}=mapLayout(s);
    if(spec==='start')return{...start};if(spec==='end')return{...end};if(spec==='center')return{x:s.width/2,y:s.height/2};
    if(spec==='edge'){
      // The map edge behind the spawning side's base anchor.
      const p=team===PLAYER?start:end,gaps=[p.x,s.width-p.x,p.y,s.height-p.y],side=gaps.indexOf(Math.min(...gaps));
      return clampPoint(s,side===0?0:side===1?s.width:p.x,side===2?0:side===3?s.height:p.y);
    }
    const lane=LANE.exec(spec);
    if(lane){const t=Number(lane[1]);return{x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t};}
    const zone=s.mission?.zones.find(z=>z.id===spec);if(zone)return{x:zone.x,y:zone.y};
  }
  throw new RangeError(`Unknown mission point ${JSON.stringify(spec)}`);
}
// A map-edge point on the far half of the sector that the opposing side does not currently see. The key
// varies the choice per wave, so successive assaults come from different directions.
function fogEdge(s,team,key){
  const {start,end}=mapLayout(s),anchor=team===PLAYER?end:start,reach=Math.hypot(end.x-start.x,end.y-start.y)/2,seen=s.visible[1-team],points=[];
  for(let x=2;x<s.width-2;x+=6)points.push({x:x+.5,y:1.5},{x:x+.5,y:s.height-1.5});
  for(let y=8;y<s.height-8;y+=6)points.push({x:1.5,y:y+.5},{x:s.width-1.5,y:y+.5});
  const far=points.filter(p=>Math.hypot(p.x-anchor.x,p.y-anchor.y)>=reach),hidden=far.filter(p=>!seen[Math.floor(p.y)*s.width+Math.floor(p.x)]);
  const pool=hidden.length?hidden:far.length?far:points;
  return pool[hash(`${s.seed}:${key}`)%pool.length];
}
// Tiles outward from a point in square rings, each ring sorted by distance so groups gather tightly.
function nearestTiles(s,p,radius,accept,wanted){
  const W=s.width,H=s.height,cx=clamp(Math.floor(p.x),0,W-1),cy=clamp(Math.floor(p.y),0,H-1),found=[];
  for(let r=0;r<=radius&&found.length<wanted;r++){
    const ring=[];
    const visit=(x,y)=>{if(x>=0&&y>=0&&x<W&&y<H)ring.push({x,y,d:Math.hypot(x+.5-p.x,y+.5-p.y)});};
    if(!r)visit(cx,cy);
    else{for(let x=cx-r;x<=cx+r;x++){visit(x,cy-r);visit(x,cy+r);}for(let y=cy-r+1;y<cy+r;y++){visit(cx-r,y);visit(cx+r,y);}}
    ring.sort((a,b)=>a.d-b.d||a.y-b.y||a.x-b.x);
    for(const tile of ring)if(found.length<wanted&&accept(tile.x,tile.y))found.push(tile);
  }
  return found;
}
// Open ground in an area large enough to leave, like a production exit, one body per tile.
function openGround(s,p,count){
  if(count<1)return[];
  rebuildNavigation(s);
  const taken=s.entities.filter(e=>alive(e)&&e.kind==='unit'&&Math.abs(e.x-p.x)<40&&Math.abs(e.y-p.y)<40).map(e=>({x:e.x,y:e.y}));
  return nearestTiles(s,p,40,(x,y)=>{
    const i=y*s.width+x;if(s.blocked[i]||s.regionSize[s.regions[i]]<40)return false;
    if(taken.some(e=>Math.hypot(e.x-x-.5,e.y-y-.5)<.9))return false;
    taken.push({x:x+.5,y:y+.5});return true;
  },count).map(t=>({x:t.x+.5,y:t.y+.5}));
}
// Clear construction ground for a scripted structure: no rock, roots, lava, crater, shards or bodies.
function buildingSite(s,size,p,wall){
  rebuildNavigation(s);
  const W=s.width,H=s.height,origin={x:p.x-size/2+.5,y:p.y-size/2+.5};
  const solid=i=>[1,3,4].includes(s.terrain[i]);
  return nearestTiles(s,origin,30,(x,y)=>{
    if(x<1||y<1||x+size>=W||y+size>=H)return false;
    for(let yy=y;yy<y+size;yy++)for(let xx=x;xx<x+size;xx++){const i=yy*W+xx;if(s.blocked[i]||s.terrain[i]===5||s.minerals[i]>0)return false;}
    // Keep a ring of open ground so a bespoke structure cannot plug a narrow pass.
    if(!wall)for(let yy=y-1;yy<=y+size;yy++)for(let xx=x-1;xx<=x+size;xx++)if(solid(yy*W+xx))return false;
    return !s.entities.some(e=>alive(e)&&e.kind==='unit'&&e.x>x-.3&&e.x<x+size+.3&&e.y>y-.3&&e.y<y+size+.3);
  },1)[0];
}
function tagEntities(s,ids,tag){
  if(typeof tag!=='string'||!tag||tag.length>40)throw new RangeError('Mission tags are 1-40 characters');
  for(const id of [ids].flat()){
    const e=s.entities.find(e=>e.id===id&&alive(e));if(!e||e.tag===tag)continue;
    e.tag=tag;s.mission.counters[`tagged:${tag}`]=(s.mission.counters[`tagged:${tag}`]||0)+1;
  }
}
const livingUnits=(s,team)=>s.entities.reduce((n,e)=>n+(e.team===team&&e.kind==='unit'&&alive(e)?1:0),0);
// Scripted forces: units on open ground around a point, structures on the nearest clear site. Units never
// exceed the team's population cap (UNIT_CAP, or a smaller wave cap), so every operation stays loadable.
function spawnForces(s,team,list,at,options={}){
  const p=resolvePoint(s,at,team),ids=[];
  let room=Math.min(UNIT_CAP,options.cap??UNIT_CAP)-livingUnits(s,team);
  for(const [role,count=1] of list){
    if(isUnitRole(role)){
      const type=raceUnit(s,team,role);
      for(const point of openGround(s,p,Math.min(count,room))){
        const e=addEntity(s,team,'unit',type,point.x,point.y);room--;
        if(options.kills>0){e.kills=Math.floor(options.kills);e.hp=e.maxHp=unitStats(e).hp;}
        if(options.stance)setUnitStance(s,[e.id],options.stance);
        ids.push(e.id);
      }
    }else for(let n=0;n<count;n++){
      const type=raceBuilding(s,team,role),site=buildingSite(s,BUILDINGS[type].size,p,role==='wall');if(!site)break;
      ids.push(addEntity(s,team,'building',type,site.x,site.y).id);rebuildNavigation(s);
    }
  }
  if(options.tag)tagEntities(s,ids,options.tag);
  const units=ids.map(id=>s.entities.find(e=>e.id===id)).filter(e=>e.kind==='unit');
  const goal=orderGoal(s,team,options.order);
  if(goal&&units.length)issueOrder(s,units.map(e=>e.id),{type:'attackMove',x:goal.x,y:goal.y});
  return ids;
}
function orderGoal(s,team,order){
  if(order===undefined)return null;
  if(order==='attackBase'){
    if(team!==RIVAL)throw new RangeError('Only rival forces assault the opposing base');
    // Scripted assaults know where the player's claim stands; they are not commanders reading fog.
    const foe=own(s,PLAYER).sort((a,b)=>(entityRole(a)==='core'?0:a.kind==='building'?1:2)-(entityRole(b)==='core'?0:b.kind==='building'?1:2)||a.id-b.id)[0];
    return foe?center(foe):null;
  }
  return resolvePoint(s,order.zone??order,team);
}
// Campaign veterans arrive as plain {role, kills} records from the launcher, never from storage here.
function veteranRoster(veterans){
  if(veterans===undefined)return[];
  if(!Array.isArray(veterans)||veterans.length>MAX_VETERANS||!veterans.every(v=>v&&typeof v==='object'&&isUnitRole(v.role)&&UNITS[v.role].damage>0&&whole(v.kills,0,1000)))throw new RangeError('Unsupported veterans');
  return veterans.map(({role,kills})=>({role,kills}));
}
function missionApi(s,options){
  const veterans=veteranRoster(options.veterans);
  return{
    point:spec=>resolvePoint(s,spec),
    spawn:(team,role,count=1,at='center',options={})=>spawnForces(s,team,[[role,count]],at,options),
    tag:(ids,tag)=>tagEntities(s,ids,tag),
    find:(team,role)=>own(s,team,role).map(e=>e.id),
    veterans:()=>veterans.map(v=>({...v})),
    clearArea:(at,r,{shards=false}={})=>{
      // Flattens obstacles to ash so bespoke structures have room; shards stay unless asked.
      const p=resolvePoint(s,at);
      for(let y=Math.max(0,Math.floor(p.y-r));y<=Math.min(s.height-1,p.y+r);y++)for(let x=Math.max(0,Math.floor(p.x-r));x<=Math.min(s.width-1,p.x+r);x++){
        if(Math.hypot(x+.5-p.x,y+.5-p.y)>r)continue;const i=y*s.width+x;
        if(s.terrain[i]!==2)s.terrain[i]=0;if(shards){s.minerals[i]=0;s.mineralTypes[i]=0;}
      }
      s.navVersion++;
    },
    removeBase:team=>{s.entities=s.entities.filter(e=>e.team!==team);s.navVersion++;},
    credits:(team,amount)=>{s.teams[team].credits=Math.max(0,amount);},
  };
}
// A directive action changes only the keys it names; the rest of the team's standing directive remains.
function setDirective(s,team,d){
  const m=s.mission;m.directives??={};
  const next={attack:null,defend:null,noExpand:false,...m.directives[team]};
  if('attack' in d)next.attack=d.attack?resolvePoint(s,d.attack,team):null;
  if('defend' in d)next.defend=d.defend?{...resolvePoint(s,d.defend,team),r:d.defend.r??8}:null;
  if('noExpand' in d)next.noExpand=!!d.noExpand;
  if('waveSize' in d){if(d.waveSize==null)delete next.waveSize;else next.waveSize=d.waveSize;}
  m.directives[team]=next;
}

// A point on rock or a structure moves to the nearest open tile of a region large enough to stand in.
function openPoint(s,p){
  const open=i=>!s.blocked[i]&&s.regionSize[s.regions[i]]>=40,i=Math.floor(p.y)*s.width+Math.floor(p.x);
  if(open(i))return{x:p.x,y:p.y};
  const tile=nearestTiles(s,p,40,(x,y)=>open(y*s.width+x),1)[0];
  return tile?{x:tile.x+.5,y:tile.y+.5}:{x:p.x,y:p.y};
}
// Builds s.mission after the opening forces; createGame then delivers refinery haulers and fog.
export function createMissionState(s,id,options={}){
  const def=missionDefinition(id);checkDefinition(def);rebuildNavigation(s);
  const m=s.mission={id,objectives:def.objectives.map(o=>({id:o.id,state:'active',progress:0,revealed:!o.hidden})),fired:{},zones:[],counters:{},nextCheck:s.time+MISSION_INTERVAL,startedAt:s.time};
  for(const z of def.zones||[]){const p=openPoint(s,resolvePoint(s,z.at));m.zones.push({id:z.id,x:p.x,y:p.y,r:z.r,label:z.label});}
  (def.credits||[]).forEach((amount,team)=>{if(Number.isFinite(amount))s.teams[team].credits=Math.max(0,amount);});
  for(const [team,d] of Object.entries(def.directives||{}))setDirective(s,Number(team),d);
  def.setup?.(s,missionApi(s,options));
  // A structure placed on a zone's centre (an outpost around its archive) moves the marker beside it.
  rebuildNavigation(s);for(const z of m.zones)Object.assign(z,openPoint(s,z));
  if(def.score)m.score=0;
  lightZones(s,def,m);
  return m;
}

const inZone=(e,z)=>{const c=center(e);return Math.hypot(c.x-z.x,c.y-z.y)<=z.r;};
const zoneOf=(m,id)=>m.zones.find(z=>z.id===id);
const armed=e=>e.kind==='unit'&&UNITS[e.type].damage>0;
const remainingTagged=(s,tag,test=()=>true)=>s.entities.reduce((n,e)=>n+(alive(e)&&e.tag===tag&&test(e)?1:0),0);
const taggedTotal=(m,tag)=>m.counters[`tagged:${tag}`]||0;
const point=z=>z?{x:z.x,y:z.y}:{};
const elapsed=(s,m)=>s.time-m.startedAt;
// Contested zones broadcast their surroundings to both sides, so holding one never relies on hidden units.
function lightZones(s,def,m){
  for(const z of def.zones||[]){
    if(!z.lit)continue;const zone=zoneOf(m,z.id),r=Math.min(20,zone.r+2);
    for(const team of [PLAYER,RIVAL]){
      const reveal=s.reveals?.find(r=>r.source==='zone'&&r.team===team&&r.x===zone.x&&r.y===zone.y);
      if(reveal)reveal.until=s.time+1;else(s.reveals??=[]).push({team,x:zone.x,y:zone.y,r,until:s.time+1,source:'zone'});
    }
  }
}
// Who holds a zone: the side with armed units inside while the other has none.
function zoneHolder(s,zone){
  const player=own(s,PLAYER).some(e=>armed(e)&&inZone(e,zone)),rival=own(s,RIVAL).some(e=>armed(e)&&inZone(e,zone));
  return player===rival?null:player?PLAYER:RIVAL;
}

// Objectives record progress as the measure they compare: units, seconds, credits, counts or kills.
function measure(s,m,o,state){
  const zone=o.zone===undefined?null:zoneOf(m,o.zone),stats=s.teams[PLAYER].stats||{};
  switch(o.type){
    case 'destroyTagged':{const total=taggedTotal(m,o.tag),left=remainingTagged(s,o.tag,e=>e.team!==PLAYER);state.progress=total-left;return total>0&&!left?'done':'';}
    case 'annihilate':{const left=own(s,RIVAL,'core').length+own(s,RIVAL,'constructor').length;state.progress=left?0:1;return left?'':'done';}
    case 'survive':state.progress=Math.min(o.seconds,state.progress+MISSION_INTERVAL);return state.progress>=o.seconds?'done':'';
    case 'endure':state.progress+=MISSION_INTERVAL;return'';
    case 'holdZone':if(zoneHolder(s,zone)===PLAYER)state.progress=Math.min(o.seconds,state.progress+MISSION_INTERVAL);return state.progress>=o.seconds?'done':'';
    case 'reachZone':state.progress=own(s,PLAYER).filter(e=>e.kind==='unit'&&(!o.roles||o.roles.includes(entityRole(e)))&&inZone(e,zone)).length;return state.progress>=(o.count??1)?'done':'';
    case 'nexusInZone':state.progress=own(s,PLAYER,'core').some(e=>e.progress>=1&&inZone(e,zone))?1:0;return state.progress?'done':'';
    case 'deliver':state.progress=m.counters[o.mineralType?`delivered:${o.mineralType}`:'delivered']||0;return state.progress>=o.amount?'done':'';
    case 'research':state.progress=s.teams[PLAYER].research?.[o.research]?1:0;return state.progress?'done':'';
    case 'build':state.progress=own(s,PLAYER,o.role).filter(e=>e.kind==='building'&&e.progress>=1).length;return state.progress>=(o.count??1)?'done':'';
    case 'train':state.progress=m.counters[`trained:${o.role}`]||0;return state.progress>=(o.count??1)?'done':'';
    case 'kills':state.progress=s.teams[PLAYER].kills;return state.progress>=o.count?'done':'';
    case 'protectTagged':{const total=taggedTotal(m,o.tag),left=remainingTagged(s,o.tag,e=>e.team===PLAYER);state.progress=left;return total>0&&(o.all?left<total:!left)?'failed':'';}
    case 'limitLosses':{
      // Unit losses and structure losses (walls included) come from the team's match statistics.
      const units=stats.lost||0,structures=stats.structuresLost||0;state.progress=units+structures;
      return o.units!==undefined&&units>o.units||o.structures!==undefined&&structures>o.structures?'failed':'';
    }
  }
  return'';
}
function triggered(s,m,t,repeats){
  const w=t.when||{},c=m.counters,since=elapsed(s,m);
  if(repeats){if(since<(c[`next:${t.id}`]??w.time??w.every))return false;}
  else if(w.time!==undefined&&since<w.time)return false;
  if(w.after!==undefined){const at=c[`at:${w.after.trigger}`];if(at===undefined||since-at<w.after.seconds)return false;}
  if(w.objectiveDone!==undefined&&m.objectives.find(o=>o.id===w.objectiveDone)?.state!=='done')return false;
  if(w.objectiveFailed!==undefined&&m.objectives.find(o=>o.id===w.objectiveFailed)?.state!=='failed')return false;
  if(w.tagDestroyed!==undefined&&!(taggedTotal(m,w.tagDestroyed)>0&&!remainingTagged(s,w.tagDestroyed)))return false;
  if(w.tagsLeft!==undefined&&!(taggedTotal(m,w.tagsLeft.tag)>0&&remainingTagged(s,w.tagsLeft.tag)<=w.tagsLeft.count))return false;
  if(w.zoneEntered!==undefined&&!own(s,PLAYER).some(e=>e.kind==='unit'&&inZone(e,zoneOf(m,w.zoneEntered))))return false;
  if(w.kills!==undefined&&s.teams[PLAYER].kills<w.kills)return false;
  return true;
}
// Runs one trigger's actions; wave is the trigger's fire index, which scales repeating spawns.
function perform(s,m,def,t,action,wave){
  if(action.say)event(s,action.say.text,PLAYER,{kind:'dialogue',speaker:action.say.speaker});
  if(action.reveal!==undefined){
    const index=def.objectives.findIndex(o=>o.id===action.reveal),o=def.objectives[index],state=m.objectives[index];
    if(!state.revealed){state.revealed=true;event(s,`New objective: ${o.label}`,PLAYER,{kind:'objective',status:'new',objective:o.id,...point(zoneOf(m,o.zone))});}
  }
  if(action.credits){s.teams[PLAYER].credits+=action.credits;event(s,`Field supply: +${action.credits} credits`,PLAYER,{kind:'mission',amount:action.credits});}
  if(action.spawn){
    const {team=RIVAL,units,at='edge',order,tag,kills,stance,text,cap}=action.spawn;
    // [role, count, growth per later wave, first wave]: repeating waves grow and add heavier roles over time.
    // Rival waves scale with the chosen opposition; a role that appears keeps at least one unit.
    const scale=team===RIVAL?WAVE_SCALE[s.difficulty]??1:1;
    const list=units.map(([role,count=1,growth=0,from=0])=>{const n=wave<from?0:count+Math.floor(growth*(wave-from)+1e-9);return[role,n>0?Math.max(1,Math.round(n*scale)):0];});
    const origin=at==='fogEdge'?fogEdge(s,team,`${t.id}:${wave}`):at,ids=spawnForces(s,team,list,origin,{order,tag,kills,stance,cap});
    // Only a named zone is a static mission point; other arrival positions stay unpublished.
    const arrival=typeof at==='string'?point(zoneOf(m,at)):{};
    if(ids.length)event(s,(text??(team===PLAYER?'Reinforcements have arrived.':'Hostile forces inbound.')).replaceAll('{wave}',String(wave+1)),PLAYER,{kind:team===PLAYER?'mission':'wave',count:ids.length,...arrival});
  }
  if(action.directive){const {team=RIVAL,...d}=action.directive;setDirective(s,team,d);}
  if(action.rally){
    // Sends idle armed units, lowest id first, so a scripted push never overrides orders already given.
    const {team=RIVAL,at,max=UNIT_CAP}=action.rally,goal=resolvePoint(s,at,team);
    const ids=own(s,team).filter(e=>armed(e)&&e.order.type==='idle').sort((a,b)=>a.id-b.id).slice(0,max).map(e=>e.id);
    if(ids.length)issueOrder(s,ids,{type:'attackMove',x:goal.x,y:goal.y});
  }
}
function fire(s,m,def,t){
  const w=t.when||{},c=m.counters,since=elapsed(s,m);
  if(w.every===undefined){m.fired[t.id]=true;c[`at:${t.id}`]=since;for(const action of t.do)perform(s,m,def,t,action,0);return;}
  const wave=c[`repeat:${t.id}`]||0,next=(c[`next:${t.id}`]??w.time??w.every)+w.every;
  c[`repeat:${t.id}`]=wave+1;c[`at:${t.id}`]=since;
  // A wave held back by its other conditions resumes the rhythm from now rather than firing a backlog.
  c[`next:${t.id}`]=next>since?next:since+w.every;
  for(const action of t.do)perform(s,m,def,t,action,wave);
  if(wave+1>=(w.limit??Infinity)||c[`next:${t.id}`]>=(w.until??Infinity))m.fired[t.id]=true;
}
function ruleBroken(s,m,rule){
  if(rule.type==='coreLost')return!own(s,PLAYER,'core').length&&!own(s,PLAYER,'constructor').length;
  if(rule.type==='allUnitsLost')return!own(s,PLAYER).some(e=>e.kind==='unit');
  if(rule.type==='tagLost')return taggedTotal(m,rule.tag)>0&&!remainingTagged(s,rule.tag);
  if(rule.type==='timeLimit')return elapsed(s,m)>=rule.seconds;
  if(rule.type==='rivalHold')return(m.counters[`rivalHold:${rule.zone}`]||0)>=rule.seconds;
  return false;
}
const FAIL_TEXT={coreLost:'All nexuses and construction vehicles lost. Operation failed.',allUnitsLost:'All field units lost. Operation failed.',timeLimit:'The operation window has closed. Operation failed.'};
function failText(rule){
  if(FAIL_TEXT[rule.type])return FAIL_TEXT[rule.type];
  if(rule.type==='rivalHold')return`${rule.label||'The rival'} holds the ${rule.zone}. Operation failed.`;
  return`${rule.label||'Mission asset'} lost. Operation failed.`;
}
function outcome(s){
  const m=s.mission,def=MISSIONS[m.id];
  for(const rule of def.fail??DEFAULT_FAIL)if(ruleBroken(s,m,rule))return{status:'defeat',text:failText(rule)};
  const primary=def.objectives.map((o,i)=>({o,state:m.objectives[i]})).filter(({o})=>!o.secondary);
  const failed=primary.find(({state})=>state.state==='failed');
  if(failed)return{status:'defeat',text:`Objective failed: ${failed.o.label}. Operation failed.`};
  const victory={status:'victory',text:def.victoryText??'All objectives complete. Sector secured.'};
  // A sufficient objective wins alone, such as destroying every rival claim in a relay contest.
  if(primary.some(({o,state})=>o.sufficient&&state.state==='done'))return victory;
  // Holding objectives last until the end; at least one achievement must complete the operation.
  const required=primary.filter(({o})=>!o.sufficient);
  if(required.some(({o})=>!HOLDING.includes(o.type))&&required.every(({o,state})=>state.state==='done'||HOLDING.includes(o.type)&&state.state==='active'))return victory;
  return null;
}
export function missionOutcome(s){return s.mission?outcome(s)?.status??null:null;}
// Applies the outcome, if any: the status from the player's side and its closing event.
export function settleMission(s){
  const result=outcome(s);if(!result)return;
  if(result.status==='victory')MISSIONS[s.mission.id].objectives.forEach((o,i)=>{const state=s.mission.objectives[i];if(HOLDING.includes(o.type)&&state.revealed&&state.state==='active')state.state='done';});
  s.status=result.status;event(s,result.text,PLAYER,{kind:result.status});
}

// Runs in step after dead entities are removed and before commanders think, four times a second.
export function updateMission(s){
  const m=s.mission;if(!m||s.status!=='playing'||s.time<m.nextCheck)return;
  m.nextCheck+=MISSION_INTERVAL;
  const def=MISSIONS[m.id];
  lightZones(s,def,m);
  for(const rule of def.fail??[])if(rule.type==='rivalHold'&&zoneHolder(s,zoneOf(m,rule.zone))===RIVAL){const key=`rivalHold:${rule.zone}`;m.counters[key]=Math.min(rule.seconds,(m.counters[key]||0)+MISSION_INTERVAL);}
  def.objectives.forEach((o,i)=>{
    const state=m.objectives[i];if(state.state!=='active'||!state.revealed)return;
    const result=measure(s,m,o,state);if(!result)return;
    state.state=result;
    event(s,`Objective ${result==='done'?'complete':'failed'}: ${o.label}`,PLAYER,{kind:result==='done'?'objective':'objectiveFailed',status:result==='done'?'complete':'failed',objective:o.id,...point(zoneOf(m,o.zone))});
  });
  for(const t of def.triggers||[])if(!m.fired[t.id]&&triggered(s,m,t,t.when?.every!==undefined))fire(s,m,def,t);
  // Survival scoring: whole seconds survived times kills, in tenths.
  if(def.score==='survival')m.score=Math.floor(elapsed(s,m)*s.teams[PLAYER].kills/10);
  settleMission(s);
}

// Gates the player's construction, recruitment, research and upgrades to what the operation allows.
export function missionAllows(s,team,category,id){
  if(!s.mission||team!==PLAYER)return true;
  const list=MISSIONS[s.mission.id].allow?.[category];
  return !list||list.includes(id);
}
// Scripted guidance for a commander: where to attack or hold, and whether to expand.
export function missionDirective(s,team){return s.mission?.directives?.[team]??null;}
export function noteDelivery(s,team,amount,type){
  if(team!==PLAYER)return;const c=s.mission.counters;
  c.delivered=(c.delivered||0)+amount;c[`delivered:${type}`]=(c[`delivered:${type}`]||0)+amount;
}
// Opening haulers are part of the deployment, not training.
export function noteTrained(s,team,role){if(team===PLAYER&&s.time>s.mission.startedAt)s.mission.counters[`trained:${role}`]=(s.mission.counters[`trained:${role}`]||0)+1;}
