// Ashline unit abilities: one active ability per combat role, shared by both races under their own names.
// A unit records absolute simulation times (abilityReadyAt, abilityUntil), plus e.barrage while a salvo is
// in the air; sim.js reads the hooks below and steps the salvo. Activation is a command between steps.
// The import cycle with sim.js is safe: neither module reads the other's bindings while it evaluates.
import {UNITS,alive,getEntity,unitRole,definition,unitRange,targetDistance,stopUnits,distance,center,cell,event,tally} from './sim.js';

export const ABILITIES={
  rifle:{id:'digIn',names:{organics:'Dig in',aiUnity:'Brace protocol'},target:'self',duration:10,cooldown:30,damageTaken:.65,holdsPosition:true,
    description:'Halts and digs in: 35% less damage for 10 seconds while holding position. A move, attack or explore order ends it; Stop keeps it.'},
  rocket:{id:'longShot',names:{organics:'Long shot',aiUnity:'Extended lock'},target:'self',duration:8,cooldown:35,range:3,
    description:'Extends firing and attack-move engagement range by 3 tiles for 8 seconds.'},
  scout:{id:'flare',names:{organics:'Flare',aiUnity:'Sensor probe'},target:'ground',reach:14,radius:7,duration:12,cooldown:40,
    description:'Lights a 7-tile radius around ground within 14 tiles for 12 seconds. Only your forces see it.'},
  tank:{id:'overdrive',names:{organics:'Overdrive',aiUnity:'Overclock'},target:'self',duration:6,cooldown:35,speed:1.4,
    description:'Moves 40% faster for 6 seconds.'},
  striker:{id:'afterburner',names:{organics:'Afterburner',aiUnity:'Sprint'},target:'self',duration:4,cooldown:30,speed:1.6,
    description:'Moves 60% faster for 4 seconds.'},
  artillery:{id:'barrage',names:{organics:'Barrage',aiUnity:'Arc barrage'},target:'ground',reachBonus:2,shots:4,interval:.7,damage:.7,scatter:1.2,direct:.75,splash:1.6,splashDamage:.45,cooldown:45,
    description:'Fires four scattered shells at explored ground within firing range plus 2 tiles, 0.7 seconds apart. Each deals 70% damage with splash.'},
  engineer:{id:'fieldPatch',names:{organics:'Field patch',aiUnity:'Nano-patch'},target:'self',reach:4,heal:.25,cooldown:30,
    description:'Instantly restores 25% of maximum HP to the most damaged friendly vehicle or structure within 4 tiles, paid at the engineer repair rate.'},
};
// Role keys such as "constructor" must never resolve to an inherited object member.
Object.setPrototypeOf(ABILITIES,null);
for(const [role,a] of Object.entries(ABILITIES))a.role=role;

export function abilityFor(value){return ABILITIES[unitRole(value)]??null;}
export function abilityName(value){const a=abilityFor(value),type=typeof value==='string'?value:value?.type;return a?a.names[UNITS[type]?.race]??a.names.organics:'';}
function abilityReach(s,u,a){return a.id==='barrage'?unitRange(s,u)+a.reachBonus:a.reach??0;}
export function abilityStatus(s,e){
  const a=e?.kind==='unit'?abilityFor(e):null;if(!a)return null;
  const remaining=Math.max(0,(e.abilityReadyAt??0)-s.time);
  return{id:a.id,name:abilityName(e),ready:alive(e)&&s.status==='playing'&&remaining<=0&&!e.barrage,remaining,active:e.abilityUntil>s.time||!!e.barrage,targeted:a.target==='ground',range:abilityReach(s,e,a)};
}

// Hooks for sim.js. A unit without an active ability returns the identity factor.
export function abilitySpeed(s,u){return u.abilityUntil>s.time?ABILITIES[unitRole(u)]?.speed??1:1;}
export function abilityRange(s,u){return u.abilityUntil>s.time?ABILITIES[unitRole(u)]?.range??0:0;}
// Dig in protects only a body that is actually holding still this tick.
export function abilityDamageTaken(s,e){return e.abilityUntil>s.time&&!e.moving?ABILITIES[unitRole(e)]?.damageTaken??1:1;}
export function endHeldAbility(u){if(u.abilityUntil!==undefined&&ABILITIES[unitRole(u)]?.holdsPosition)delete u.abilityUntil;}

function patchTarget(s,u,a){
  return s.entities.filter(e=>alive(e)&&e.team===u.team&&e!==u&&e.progress>=1&&e.hp<e.maxHp&&(e.kind==='building'||UNITS[e.type].armor!=='infantry')&&targetDistance(u,e)<=a.reach)
    .sort((x,y)=>x.hp/x.maxHp-y.hp/y.maxHp||x.id-y.id)[0];
}
// Applies one unit's ability; returns '' on success or the reason it could not act.
function activate(s,u,a,point){
  if(a.target==='ground'){
    if(!point)return'Choose a target point';
    if(!(point.x>=0&&point.y>=0&&point.x<s.width&&point.y<s.height))return'Target outside the sector';
    if(distance(center(u),point)>abilityReach(s,u,a)+1e-9)return'Target out of range';
  }
  if(a.id==='flare')(s.reveals??=[]).push({team:u.team,x:point.x,y:point.y,r:a.radius,until:s.time+a.duration});
  else if(a.id==='barrage'){
    if(!s.explored[u.team][cell(s,point.x,point.y)])return'Target unexplored ground';
    // The salvo fires inside the simulation steps; the crew holds regular fire until it lands.
    u.barrage={x:point.x,y:point.y,shots:a.shots,next:s.time};u.cooldown=Math.max(u.cooldown,a.shots*a.interval);
  }else if(a.id==='fieldPatch'){
    const target=patchTarget(s,u,a);if(!target)return'No damaged vehicle or structure in reach';
    const heal=Math.min(target.maxHp*a.heal,target.maxHp-target.hp),cost=heal*definition(target).cost*.35/target.maxHp;
    if(s.teams[u.team].credits<cost)return'Insufficient credits';
    target.hp=Math.min(target.maxHp,target.hp+heal);s.teams[u.team].credits-=cost;tally(s,u.team,'spent',cost);
  }else{
    if(a.holdsPosition&&u.order.type!=='idle')stopUnits(s,[u.id]);
    u.abilityUntil=s.time+a.duration;
  }
  u.abilityReadyAt=s.time+a.cooldown;return'';
}
// Command entry point: every ready unit of the team with an ability uses it. A flare needs one scout,
// so only the closest ready scout in reach fires it. Returns the ids that acted.
export function useAbility(s,team,ids,target){
  const result=(reason,used=[])=>({ok:used.length>0,reason:used.length?'':reason,used});
  if(s.status!=='playing')return result('Operation has ended');
  if(![0,1].includes(team)||!Array.isArray(ids))return result('Select units with an ability');
  const units=[...new Set(ids)].map(id=>getEntity(s,id)).filter(u=>u?.kind==='unit'&&u.team===team&&abilityFor(u)).sort((a,b)=>a.id-b.id);
  if(!units.length)return result('Select units with an ability');
  const ready=units.filter(u=>!(u.abilityReadyAt>s.time)&&!u.barrage);
  if(!ready.length)return result('Ability recharging');
  const point=target&&Number.isFinite(target.x)&&Number.isFinite(target.y)?{x:target.x,y:target.y}:null;
  const scouts=point?ready.filter(u=>unitRole(u)==='scout'&&distance(u,point)<=ABILITIES.scout.reach+1e-9).sort((a,b)=>distance(a,point)-distance(b,point)||a.id-b.id):[];
  const used=[];let reason='';
  for(const u of ready){
    const a=abilityFor(u);if(a.id==='flare'&&scouts.length&&u!==scouts[0])continue;
    const refused=activate(s,u,a,point);
    if(refused)reason||=refused;else used.push(u);
  }
  for(const type of new Set(used.map(u=>u.type))){
    const group=used.filter(u=>u.type===type),first=group[0];
    event(s,`${group.length>1?`${group.length} × `:''}${UNITS[type].name}: ${abilityName(type)}`,team,{kind:'ability',ability:abilityFor(type).id,count:group.length,entityId:first.id,role:unitRole(first),x:first.x,y:first.y});
  }
  return result(reason,used.map(u=>u.id));
}
