// Ashline opposition: a deterministic commander that plays one team through the public commands.
// Its picture of the enemy comes only from current vision (seen, s.visible) and its own fog memory (ai.known).
// The import cycle with sim.js is safe: neither module reads the other's bindings while it evaluates.
import {BUILDINGS,UNITS,own,completed,alive,seen,center,distance,cell,clamp,bucketKey,definition,entityRole,targetDistance,armorMultiplier,
  random,queued,getEntity,unitStats,powerStats,raceBuilding,raceUnit,placementCheck,placeBuilding,trainUnit,issueOrder,stopUnits,
  researchStatus,startResearch,buildingUpgradeStatus,startBuildingUpgrade,deploymentStatus,deployNexus} from './sim.js';
import {mapLayout} from './terrain.js';

export const DOCTRINES={
  balanced:{name:'Balanced',commander:'Warden Kestrel',description:'Grows a steady economy, holds a powered perimeter and raids with staged combined-arms waves.'},
};
// Below Veteran the opposition builds and trains slower; productionRate applies this pace on top of power.
export const AI_PACE={easy:.55,normal:.75,hard:1};
export function teamPace(s,team){return(s.aiTeams||[1]).includes(team)?AI_PACE[s.difficulty]:1;}
// A profile names an optional doctrine. Absent fields are not stored, keeping default state unchanged.
export function newAI(difficulty,profile){
  const ai={nextThink:3,nextRaid:difficulty==='easy'?300:difficulty==='hard'?100:150,known:{},mode:'Establishing base',scoutIndex:0,buildIndex:0,raid:0};
  if(profile===undefined)return ai;
  if(profile===null||typeof profile!=='object'||Array.isArray(profile)||Object.keys(profile).some(key=>key!=='doctrine'))throw new RangeError('Unsupported AI profile');
  if(profile.doctrine!==undefined){if(!Object.hasOwn(DOCTRINES,profile.doctrine))throw new RangeError('Unsupported AI doctrine');ai.doctrine=profile.doctrine;}
  return ai;
}
export function aiState(s,team){return team===1?s.ai:s.aiByTeam?.[team];}
function aiBuild(s,team,type,near){
  type=raceBuilding(s,team,type);
  const {width:W,height:H}=s;
  const base=own(s,team,'core')[0];if(!base)return false;
  const c=center(base),toward={x:(W/2-c.x),y:(H/2-c.y)};const length=Math.hypot(toward.x,toward.y);toward.x/=length;toward.y/=length;
  const preferred=near||(BUILDINGS[type].damage?{x:c.x+toward.x*9,y:c.y+toward.y*9}:c);
  const candidates=[];
  if(s.teams[team].credits<BUILDINGS[type].cost||BUILDINGS[type].requires.some(key=>!completed(s,team,key)))return false;
  const checked=new Set(),anchors=near?own(s,team).filter(e=>e.kind==='building'&&e.progress>=1):[base],check=placementCheck(s,team,type);
  for(const anchor of anchors)for(let y=Math.max(1,anchor.y-11);y<Math.min(H-4,anchor.y+14);y++)for(let x=Math.max(1,anchor.x-12);x<Math.min(W-4,anchor.x+14);x++){
    const at=y*W+x;if(checked.has(at))continue;checked.add(at);
    if(check(x,y).ok)candidates.push({x,y,score:Math.hypot(x+BUILDINGS[type].size/2-preferred.x,y+BUILDINGS[type].size/2-preferred.y)});
  }
  candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)return false;
  const spot=candidates[Math.min(candidates.length-1,Math.floor(random(s)*3))];return placeBuilding(s,team,type,spot.x,spot.y).ok;
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
function defendAI(s,army,buildings,intruders,enemies,power){
  const assigned=new Set(),groups=[];
  // Distinct incursions get their own nearby response. All inputs are currently
  // visible enemies; the commander cannot budget for concealed reinforcements.
  for(const enemy of [...intruders].sort((a,b)=>a.id-b.id)){
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
        // A losing local defense falls back without aborting an unrelated raid
        // through the commander's global regroup timer.
        const point=aiRetreatPoint(s,buildings,u,enemies);
        if(point&&(u.order.type!=='move'||distance(u.order,point)>2))issueOrder(s,[u.id],{type:'move',...point});
      }else if(u.order.type!=='attack'||!ids.has(u.order.targetId)){
        const target=[...targets].sort((a,b)=>targetDistance(u,a)-targetDistance(u,b)||a.id-b.id)[0];
        issueOrder(s,[u.id],{type:'attack',targetId:target.id,x:target.x,y:target.y});
      }
    }
  }
  // AI raids use attack-move; direct attack commands are its perimeter response.
  // Release those orders as soon as their visible threat leaves the perimeter,
  // instead of letting one fast raider tow the defenders across the whole map.
  for(const u of army)if(u.order.type==='attack'&&!assigned.has(u.id))stopUnits(s,[u.id]);
  return assigned;
}

export function thinkAI(s,team=1){
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
  // A passing scout is left to guards; actual scout fire against our structures
  // or haulers warrants the same bounded response as other armed intrusions.
  const protectedUnits=units.filter(e=>entityRole(e)==='harvester');
  const intruders=enemies.filter(e=>e.kind==='unit'&&UNITS[e.type].damage>0&&buildings.some(b=>distance(center(b),e)<13)&&
    (entityRole(e)!=='scout'||[...buildings,...protectedUnits].some(target=>target.attackerId===e.id&&s.time-(target.lastHit??-99)<4)));
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
  const defenders=defendAI(s,army,buildings,intruders,enemies,power);
  if(intruders.length)ai.mode='Defending perimeter';
  for(const u of [...army.filter(u=>u.hp/u.maxHp<=.3),...haulers.filter(h=>enemies.some(e=>definition(e).damage&&targetDistance(h,e)<7))]){
    const point=aiRetreatPoint(s,buildings,u,enemies);
    if(point&&distance(u,point)>1&&(u.order.type!=='move'||distance(u.order,point)>2))issueOrder(s,[u.id],{type:'move',...point});
  }
  const scout=army.find(e=>entityRole(e)==='scout'&&e.hp/e.maxHp>.3&&!defenders.has(e.id));
  const {start}=mapLayout(s);
  const waypoints=[{x:W*35/72,y:H/2},{x:start.x+6,y:start.y+3},{x:W/6,y:H*15/56},{x:W*50/72,y:H*43/56},{x:start.x-3,y:start.y+11}].map(p=>team===1?p:{x:W-p.x,y:H-p.y});
  if(scout&&scout.order.type!=='explore'&&!knownBuildings.length&&(scout.order.type==='idle'||s.time>25&&scout.order.type==='attackMove')){
    const point=waypoints[ai.scoutIndex%waypoints.length];if(distance(scout,point)<3)ai.scoutIndex++;const dest=waypoints[ai.scoutIndex%waypoints.length];issueOrder(s,[scout.id],{type:'move',...dest});ai.mode='Scouting the sector';
  }
  const fighting=army.filter(e=>e!==scout&&e.hp/e.maxHp>.3&&!defenders.has(e.id));
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
