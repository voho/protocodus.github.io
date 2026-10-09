// Ashline missions: deterministic objectives, fail rules and scripted triggers. Definitions (and any setup
// functions) stay in campaign.js; a game stores only plain progress in s.mission, so it saves,
// structured-clones and continues exactly. Objectives always describe the player, team 0. Mission logic
// may read the whole battlefield, but it only publishes static mission points, never hidden positions.
// The import cycle with sim.js is safe: neither module reads the other's bindings while it evaluates.
import {BUILDINGS,UNITS,RESEARCH,BUILDING_UPGRADES,own,alive,center,clamp,event,addEntity,issueOrder,setUnitStance,rebuildNavigation,raceUnit,raceBuilding,entityRole,unitStats} from './sim.js';
import {mapLayout} from './terrain.js';
import {MISSIONS} from './campaign.js';

export const MISSION_INTERVAL=.25;
const PLAYER=0,RIVAL=1;
export const OBJECTIVE_TYPES=['destroyTagged','annihilate','survive','holdZone','reachZone','nexusInZone','deliver','research','build','train','kills','protectTagged'];
export const FAIL_RULES=['coreLost','allUnitsLost','tagLost','timeLimit'];
const DEFAULT_FAIL=[{type:'coreLost'}];
const SETTINGS=['width','height','profile','races','aiTeams','aiProfiles'];
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
// Authoring errors surface when the operation is created, never halfway through a match.
function checkDefinition(def){
  const fail=reason=>{throw new Error(`Mission ${def.id}: ${reason}`);};
  const positive=value=>Number.isFinite(value)&&value>0,tag=value=>typeof value==='string'&&value.length>0&&value.length<=40;
  const ids=list=>{const seen=new Set();for(const item of list){if(typeof item.id!=='string'||!item.id||item.id.length>40||seen.has(item.id))fail(`bad or duplicate id ${item.id}`);seen.add(item.id);}return seen;};
  if(!Array.isArray(def.objectives)||!def.objectives.length)fail('needs objectives');
  const zones=ids(def.zones||[]),objectives=ids(def.objectives),triggers=def.triggers||[];ids(triggers);
  const zone=id=>{if(!zones.has(id))fail(`unknown zone ${id}`);};
  const known=new Set();
  const place=spec=>{
    if(spec&&typeof spec==='object'){if(spec.at!==undefined)place(spec.at);else if(!Number.isFinite(spec.x)||!Number.isFinite(spec.y))fail(`malformed point ${JSON.stringify(spec)}`);}
    else if(!['start','end','center','edge'].includes(spec)&&!LANE.test(spec)&&!known.has(spec))fail(`unknown point ${spec}`);
  };
  for(const z of def.zones||[]){if(!(z.r>0)||typeof z.label!=='string'||!z.label||z.label.length>80)fail(`zone ${z.id} needs a radius and label`);place(z.at);known.add(z.id);}
  for(const o of def.objectives){
    if(!OBJECTIVE_TYPES.includes(o.type))fail(`unknown objective type ${o.type}`);
    if(typeof o.label!=='string'||!o.label||o.label.length>120)fail(`objective ${o.id} needs a label`);
    if(['holdZone','reachZone','nexusInZone'].includes(o.type))zone(o.zone);
    if(['build','train'].includes(o.type)&&!(o.type==='build'?isBuildingRole:isUnitRole)(o.role))fail(`objective ${o.id} has an unknown role`);
    if(o.roles!==undefined&&!(Array.isArray(o.roles)&&o.roles.every(isUnitRole)))fail(`objective ${o.id} has unknown roles`);
    if(['destroyTagged','protectTagged'].includes(o.type)&&!tag(o.tag))fail(`objective ${o.id} needs a tag`);
    if(['survive','holdZone'].includes(o.type)&&!positive(o.seconds))fail(`objective ${o.id} needs seconds`);
    if(o.type==='deliver'&&(!positive(o.amount)||o.mineralType!==undefined&&![1,2,3].includes(o.mineralType)))fail(`objective ${o.id} needs an amount and a known mineral`);
    if(['reachZone','build','train','kills'].includes(o.type)&&(o.count!==undefined||o.type==='kills')&&!(Number.isInteger(o.count)&&o.count>0))fail(`objective ${o.id} needs a whole count`);
    if(o.type==='research'&&!Object.hasOwn(RESEARCH,o.research))fail(`objective ${o.id} names unknown research`);
  }
  for(const rule of def.fail??DEFAULT_FAIL){
    if(!FAIL_RULES.includes(rule.type))fail(`unknown fail rule ${rule.type}`);
    if(rule.type==='tagLost'&&!tag(rule.tag)||rule.type==='timeLimit'&&!positive(rule.seconds))fail(`fail rule ${rule.type} is incomplete`);
  }
  for(const t of triggers){
    const w=t.when||{};
    if(Object.keys(w).some(key=>!['time','objectiveDone','tagDestroyed','zoneEntered'].includes(key)))fail(`trigger ${t.id} has an unknown condition`);
    if(w.objectiveDone!==undefined&&!objectives.has(w.objectiveDone))fail(`trigger ${t.id} waits for an unknown objective`);
    if(w.zoneEntered!==undefined)zone(w.zoneEntered);
    if(!Array.isArray(t.do))fail(`trigger ${t.id} needs actions`);
    for(const action of t.do){
      if(Object.keys(action).some(key=>!['say','spawn','reveal','credits','directive'].includes(key)))fail(`trigger ${t.id} has an unknown action`);
      if(action.reveal!==undefined&&!objectives.has(action.reveal))fail(`trigger ${t.id} reveals an unknown objective`);
      if(action.credits!==undefined&&!positive(action.credits))fail(`trigger ${t.id} grants malformed credits`);
      if(action.say&&!(typeof action.say.text==='string'&&action.say.text.length<=1000&&typeof action.say.speaker==='string'&&action.say.speaker&&action.say.speaker.length<=40))fail(`trigger ${t.id} has a malformed line`);
      if(action.spawn){
        if(!(Array.isArray(action.spawn.units)&&action.spawn.units.every(([role,count=1])=>(isUnitRole(role)||isBuildingRole(role))&&Number.isInteger(count)&&count>0)))fail(`trigger ${t.id} spawns an unknown role`);
        if(action.spawn.at!==undefined)place(action.spawn.at);
        if(action.spawn.order!==undefined&&action.spawn.order!=='attackBase')place(action.spawn.order.zone??action.spawn.order);
        if(action.spawn.tag!==undefined&&!tag(action.spawn.tag)||action.spawn.team!==undefined&&![0,1].includes(action.spawn.team))fail(`trigger ${t.id} spawns for an unknown team or tag`);
      }
      for(const key of ['attack','defend'])if(action.directive?.[key])place(action.directive[key]);
    }
  }
  const catalog={buildings:isBuildingRole,units:isUnitRole,research:id=>Object.hasOwn(RESEARCH,id),upgrades:id=>Object.hasOwn(BUILDING_UPGRADES,id)};
  for(const [category,list] of Object.entries(def.allow||{}))if(!Object.hasOwn(catalog,category)||!Array.isArray(list)||!list.every(catalog[category]))fail(`allow.${category} must list known ids`);
  for(const [team,d] of Object.entries(def.directives||{})){if(!['0','1'].includes(team))fail('directives are keyed by team');for(const key of ['attack','defend'])if(d[key])place(d[key]);}
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
// Scripted forces: units on open ground around a point, structures on the nearest clear site.
function spawnForces(s,team,list,at,options={}){
  const p=resolvePoint(s,at,team),ids=[];
  for(const [role,count=1] of list){
    if(isUnitRole(role)){
      const type=raceUnit(s,team,role);
      for(const point of openGround(s,p,count)){
        const e=addEntity(s,team,'unit',type,point.x,point.y);
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
    // Scripted assaults know where the opposing claim stands; they are not commanders reading fog.
    const foe=own(s,1-team).sort((a,b)=>(entityRole(a)==='core'?0:a.kind==='building'?1:2)-(entityRole(b)==='core'?0:b.kind==='building'?1:2)||a.id-b.id)[0];
    return foe?center(foe):null;
  }
  return resolvePoint(s,order.zone??order,team);
}
function missionApi(s){
  return{
    point:spec=>resolvePoint(s,spec),
    spawn:(team,role,count=1,at='center',options={})=>spawnForces(s,team,[[role,count]],at,options),
    tag:(ids,tag)=>tagEntities(s,ids,tag),
    find:(team,role)=>own(s,team,role).map(e=>e.id),
    clearArea:(at,r)=>{
      // Flattens obstacles to ash so bespoke structures have room; shards stay.
      const p=resolvePoint(s,at);
      for(let y=Math.max(0,Math.floor(p.y-r));y<=Math.min(s.height-1,p.y+r);y++)for(let x=Math.max(0,Math.floor(p.x-r));x<=Math.min(s.width-1,p.x+r);x++)
        if(Math.hypot(x+.5-p.x,y+.5-p.y)<=r&&s.terrain[y*s.width+x]!==2)s.terrain[y*s.width+x]=0;
      s.navVersion++;
    },
    removeBase:team=>{s.entities=s.entities.filter(e=>e.team!==team);s.navVersion++;},
    credits:(team,amount)=>{s.teams[team].credits=Math.max(0,amount);},
  };
}
function setDirective(s,team,d){
  const m=s.mission;m.directives??={};
  const defend=d.defend?{...resolvePoint(s,d.defend,team),r:d.defend.r??8}:null;
  m.directives[team]={attack:d.attack?resolvePoint(s,d.attack,team):null,defend,noExpand:!!d.noExpand,...(Number.isInteger(d.waveSize)?{waveSize:d.waveSize}:{})};
}

// Builds s.mission after the opening forces; createGame then delivers refinery haulers and fog.
export function createMissionState(s,id){
  const def=missionDefinition(id);checkDefinition(def);rebuildNavigation(s);
  const m=s.mission={id,objectives:def.objectives.map(o=>({id:o.id,state:'active',progress:0,revealed:!o.hidden})),fired:{},zones:[],counters:{},nextCheck:s.time+MISSION_INTERVAL,startedAt:s.time};
  for(const z of def.zones||[]){
    // A zone whose centre falls on rock or a structure moves to the nearest reachable open tile.
    let p=resolvePoint(s,z.at);const i=Math.floor(p.y)*s.width+Math.floor(p.x);
    if(s.blocked[i]||s.regionSize[s.regions[i]]<40){const tile=nearestTiles(s,p,40,(x,y)=>!s.blocked[y*s.width+x]&&s.regionSize[s.regions[y*s.width+x]]>=40,1)[0];if(tile)p={x:tile.x+.5,y:tile.y+.5};}
    m.zones.push({id:z.id,x:p.x,y:p.y,r:z.r,label:z.label});
  }
  (def.credits||[]).forEach((amount,team)=>{if(Number.isFinite(amount))s.teams[team].credits=Math.max(0,amount);});
  for(const [team,d] of Object.entries(def.directives||{}))setDirective(s,Number(team),d);
  def.setup?.(s,missionApi(s));
  return m;
}

const inZone=(e,z)=>{const c=center(e);return Math.hypot(c.x-z.x,c.y-z.y)<=z.r;};
const zoneOf=(m,id)=>m.zones.find(z=>z.id===id);
const armed=e=>e.kind==='unit'&&UNITS[e.type].damage>0;
const remainingTagged=(s,tag,test=()=>true)=>s.entities.reduce((n,e)=>n+(alive(e)&&e.tag===tag&&test(e)?1:0),0);
const taggedTotal=(m,tag)=>m.counters[`tagged:${tag}`]||0;
const point=z=>z?{x:z.x,y:z.y}:{};

// Objectives record progress as the measure they compare: units, seconds, credits, counts or kills.
function measure(s,m,o,state){
  const zone=o.zone===undefined?null:zoneOf(m,o.zone);
  switch(o.type){
    case 'destroyTagged':{const total=taggedTotal(m,o.tag),left=remainingTagged(s,o.tag,e=>e.team!==PLAYER);state.progress=total-left;return total>0&&!left?'done':'';}
    case 'annihilate':{const left=own(s,RIVAL,'core').length+own(s,RIVAL,'constructor').length;state.progress=left?0:1;return left?'':'done';}
    case 'survive':state.progress=Math.min(o.seconds,state.progress+MISSION_INTERVAL);return state.progress>=o.seconds?'done':'';
    case 'holdZone':{
      const held=own(s,PLAYER).some(e=>armed(e)&&inZone(e,zone))&&!own(s,RIVAL).some(e=>armed(e)&&inZone(e,zone));
      if(held)state.progress=Math.min(o.seconds,state.progress+MISSION_INTERVAL);return state.progress>=o.seconds?'done':'';
    }
    case 'reachZone':state.progress=own(s,PLAYER).filter(e=>e.kind==='unit'&&(!o.roles||o.roles.includes(entityRole(e)))&&inZone(e,zone)).length;return state.progress>=(o.count??1)?'done':'';
    case 'nexusInZone':state.progress=own(s,PLAYER,'core').some(e=>e.progress>=1&&inZone(e,zone))?1:0;return state.progress?'done':'';
    case 'deliver':state.progress=m.counters[o.mineralType?`delivered:${o.mineralType}`:'delivered']||0;return state.progress>=o.amount?'done':'';
    case 'research':state.progress=s.teams[PLAYER].research?.[o.research]?1:0;return state.progress?'done':'';
    case 'build':state.progress=own(s,PLAYER,o.role).filter(e=>e.kind==='building'&&e.progress>=1).length;return state.progress>=(o.count??1)?'done':'';
    case 'train':state.progress=m.counters[`trained:${o.role}`]||0;return state.progress>=(o.count??1)?'done':'';
    case 'kills':state.progress=s.teams[PLAYER].kills;return state.progress>=o.count?'done':'';
    case 'protectTagged':{const left=remainingTagged(s,o.tag,e=>e.team===PLAYER);state.progress=left;return taggedTotal(m,o.tag)>0&&!left?'failed':'';}
  }
  return'';
}
function triggered(s,m,t){
  const w=t.when||{};
  if(w.time!==undefined&&s.time-m.startedAt<w.time)return false;
  if(w.objectiveDone!==undefined&&m.objectives.find(o=>o.id===w.objectiveDone)?.state!=='done')return false;
  if(w.tagDestroyed!==undefined&&!(taggedTotal(m,w.tagDestroyed)>0&&!remainingTagged(s,w.tagDestroyed)))return false;
  if(w.zoneEntered!==undefined&&!own(s,PLAYER).some(e=>e.kind==='unit'&&inZone(e,zoneOf(m,w.zoneEntered))))return false;
  return true;
}
function perform(s,m,def,action){
  if(action.say)event(s,action.say.text,PLAYER,{kind:'dialogue',speaker:action.say.speaker});
  if(action.reveal!==undefined){
    const index=def.objectives.findIndex(o=>o.id===action.reveal),o=def.objectives[index],state=m.objectives[index];
    if(!state.revealed){state.revealed=true;event(s,`New objective: ${o.label}`,PLAYER,{kind:'objective',objective:o.id,...point(zoneOf(m,o.zone))});}
  }
  if(action.credits){s.teams[PLAYER].credits+=action.credits;event(s,`Field supply: +${action.credits} credits`,PLAYER,{kind:'mission',amount:action.credits});}
  if(action.spawn){
    const {team=RIVAL,units,at='edge',order,tag,kills,stance,text}=action.spawn,ids=spawnForces(s,team,units,at,{order,tag,kills,stance});
    // Only a named zone is a static mission point; other arrival positions stay unpublished.
    const arrival=typeof at==='string'?point(zoneOf(m,at)):{};
    if(ids.length)event(s,text??(team===PLAYER?'Reinforcements have arrived.':'Hostile forces inbound.'),PLAYER,{kind:team===PLAYER?'mission':'wave',count:ids.length,...arrival});
  }
  if(action.directive){const {team=RIVAL,...d}=action.directive;setDirective(s,team,d);}
}
function ruleBroken(s,m,rule){
  if(rule.type==='coreLost')return!own(s,PLAYER,'core').length&&!own(s,PLAYER,'constructor').length;
  if(rule.type==='allUnitsLost')return!own(s,PLAYER).some(e=>e.kind==='unit');
  if(rule.type==='tagLost')return taggedTotal(m,rule.tag)>0&&!remainingTagged(s,rule.tag);
  if(rule.type==='timeLimit')return s.time-m.startedAt>=rule.seconds;
  return false;
}
const FAIL_TEXT={coreLost:'All nexuses and construction vehicles lost. Operation failed.',allUnitsLost:'All field units lost. Operation failed.',timeLimit:'The operation window has closed. Operation failed.'};
function outcome(s){
  const m=s.mission,def=MISSIONS[m.id];
  for(const rule of def.fail??DEFAULT_FAIL)if(ruleBroken(s,m,rule))return{status:'defeat',text:FAIL_TEXT[rule.type]??`${rule.label||'Mission asset'} lost. Operation failed.`};
  const primary=def.objectives.map((o,i)=>({o,state:m.objectives[i]})).filter(({o})=>!o.secondary);
  const failed=primary.find(({state})=>state.state==='failed');
  if(failed)return{status:'defeat',text:`Objective failed: ${failed.o.label}. Operation failed.`};
  // Protection objectives hold until the end; at least one achievement must complete the operation.
  if(primary.some(({o})=>o.type!=='protectTagged')&&primary.every(({o,state})=>state.state==='done'||o.type==='protectTagged'&&state.state==='active'))
    return{status:'victory',text:def.victoryText??'All objectives complete. Sector secured.'};
  return null;
}
export function missionOutcome(s){return s.mission?outcome(s)?.status??null:null;}
// Applies the outcome, if any: the status from the player's side and its closing event.
export function settleMission(s){
  const result=outcome(s);if(!result)return;
  if(result.status==='victory')MISSIONS[s.mission.id].objectives.forEach((o,i)=>{if(o.type==='protectTagged'&&s.mission.objectives[i].state==='active')s.mission.objectives[i].state='done';});
  s.status=result.status;event(s,result.text,PLAYER,{kind:result.status});
}

// Runs in step after dead entities are removed and before commanders think, four times a second.
export function updateMission(s){
  const m=s.mission;if(!m||s.status!=='playing'||s.time<m.nextCheck)return;
  m.nextCheck+=MISSION_INTERVAL;
  const def=MISSIONS[m.id];
  def.objectives.forEach((o,i)=>{
    const state=m.objectives[i];if(state.state!=='active'||!state.revealed)return;
    const result=measure(s,m,o,state);if(!result)return;
    state.state=result;
    event(s,`Objective ${result==='done'?'complete':'failed'}: ${o.label}`,PLAYER,{kind:result==='done'?'objective':'objectiveFailed',objective:o.id,...point(zoneOf(m,o.zone))});
  });
  for(const t of def.triggers||[])if(!m.fired[t.id]&&triggered(s,m,t)){m.fired[t.id]=true;for(const action of t.do)perform(s,m,def,action);}
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
