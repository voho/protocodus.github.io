// Winnability probe for the operations with a rival commander: a scripted Expedition 07 plays each operation
// through the public commands at a chosen Opposition setting (raised by the operation's aiStep, as the
// briefing launches it). It builds an economy and an army, takes expansions when they are cleared, and either
// pushes once 18 units stand (rush) or holds until 420 s and 30 units (macro); it expands only where an objective
// asks for more nexuses. It knows where rival nexuses
// stand, as a commander who has scouted would, and attacks the nearest; on Hold the Relay it takes the relay.
// --doctrine replaces the operation's rival doctrine ('operation' keeps it), so doctrines can be compared.
// A measurement tool, not a pass/fail check: it prints one JSON line per game.
import assert from 'node:assert/strict';
import {createGame,updateGame,UNITS,BUILDINGS,canPlace,placeBuilding,trainUnit,issueOrder,startResearch,researchStatus,powerStats,entityRole,center,mapLayout,deploymentStatus,deployNexus} from '../sim.js';
import {MISSIONS} from '../campaign.js';
import {DOCTRINES} from '../ai.js';
import {launchSettings} from '../campaign-ui.js';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const missions=(option('--mission')||'red-ledger,hold-the-relay,severance').split(','),difficulty=option('--difficulty')||'normal';
const styles=(option('--style')||'rush,macro').split(','),doctrines=(option('--doctrine')||'operation').split(','),limit=Number(option('--limit')||2400);
assert.ok(missions.every(id=>MISSIONS[id]?.aiTeams?.includes(1)),'--mission takes operations with a rival commander');
assert.ok(['easy','normal','hard'].includes(difficulty)&&styles.every(style=>['rush','macro'].includes(style)));
assert.ok(doctrines.every(id=>id==='operation'||Object.hasOwn(DOCTRINES,id)),'--doctrine takes doctrine ids or operation');
const research=['vehicleWeapons','infantryWeapons','gridEfficiency','infantryArmor','mobility','advancedBallistics'];
const FIELDS=['natural','third','contested','outpost','crown'];
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),toward=(from,to,f)=>({x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f});

function play(mission,style,doctrine){
  const def=MISSIONS[mission],kept=def.aiProfiles;
  if(doctrine!=='operation')def.aiProfiles={1:{doctrine}};
  const launch=launchSettings(mission,{difficulty}),s=createGame(launch.seed,launch.difficulty,launch.options);
  if(kept===undefined)delete def.aiProfiles;else def.aiProfiles=kept;
  const mine=role=>s.entities.filter(e=>e.team===0&&e.hp>0&&entityRole(e)===role),done=role=>mine(role).filter(e=>e.progress>=1);
  const queued=role=>s.entities.reduce((n,e)=>n+(e.team===0&&e.queue?e.queue.filter(q=>entityRole(q.type)===role).length:0),0);
  const {start,end}=mapLayout(s),home=()=>{const c=done('core')[0]||mine('core')[0];return c?center(c):start;};
  const place=(type,near,radius=16)=>{
    const size=BUILDINGS[type].size,x0=Math.floor(near.x-size/2),y0=Math.floor(near.y-size/2);
    for(let r=0;r<radius;r++)for(let y=y0-r;y<=y0+r;y++)for(let x=x0-r;x<=x0+r;x++)if(Math.max(Math.abs(x-x0),Math.abs(y-y0))===r&&canPlace(s,0,type,x,y).ok)return placeBuilding(s,0,type,x,y).ok;
    return false;
  };
  // Explored ore only; red seam counts as six tiles nearer, since Red Ledger audits its crystal.
  const oreNear=(from,min,max)=>{
    let best=null;
    for(let i=0;i<s.minerals.length;i++)if(s.minerals[i]>200&&s.explored[0][i]){const p={x:i%s.width+.5,y:Math.floor(i/s.width)+.5},d=dist(p,from)-(s.mineralTypes[i]===3?6:0);if(d>=min&&d<=max&&(!best||d<best.d))best={...p,d};}
    return best;
  };
  let plan=null,saving=false,pushing=false,lastOrder=-99,firstPush=null;
  const claims=def.objectives.some(o=>o.type==='build'&&o.role==='core');
  // Up to three nexuses: the own natural first, then (on Red Ledger) the red contested seams, then own outposts.
  const expand=()=>{
    saving=false;
    if(!claims||!mine('core').length||!done('factory').length||mine('core').length>=3)return;
    const h=home(),truck=mine('constructor')[0];
    // Training pauses while the vehicle's price is saved.
    if(!truck){if(s.time>=240&&!queued('constructor'))saving=trainUnit(s,0,'constructor',done('factory')[0].id).reason==='Insufficient credits';return;}
    if(plan?.unitId!==truck.id){
      const rank=site=>dist(site,h)+(site.kind==='natural'?-100:site.kind==='contested'?(mission==='red-ledger'?-40:20):0);
      const site=(s.sites||[]).filter(site=>FIELDS.includes(site.kind)&&(site.side??0)===0&&mine('core').every(c=>dist(center(c),site)>14)).sort((a,b)=>rank(a)-rank(b)||a.y-b.y||a.x-b.x)[0];
      if(!site)return;plan={unitId:truck.id,goal:toward(site,h,7/Math.max(7,dist(site,h)))};
    }
    if(dist(truck,plan.goal)<4)for(let r=0;r<=4;r++)for(let y=Math.floor(truck.y)-1-r;y<=truck.y-1+r;y++)for(let x=Math.floor(truck.x)-1-r;x<=truck.x-1+r;x++)if(deploymentStatus(s,0,truck.id,x,y).ok){deployNexus(s,0,truck.id,x,y);plan=null;return;}
    if(truck.order.type!=='move'||dist(truck.order,plan.goal)>1)issueOrder(s,[truck.id],{type:'move',...plan.goal});
  };
  const target=()=>{
    const relay=s.mission.zones.find(z=>z.id==='relay');if(relay)return{x:relay.x,y:relay.y};
    const h=home(),claims=s.entities.filter(e=>e.team===1&&e.hp>0&&['core','constructor'].includes(entityRole(e))).sort((a,b)=>dist(center(a),h)-dist(center(b),h)||a.id-b.id);
    return claims[0]?center(claims[0]):end;
  };
  for(let tick=0;tick<limit*4&&s.status==='playing';tick++){
    updateGame(s,.25);
    if(tick%4)continue;
    const h=home(),credits=s.teams[0].credits,power=powerStats(s,0);
    if(mine('core').length&&!s.entities.some(e=>e.team===0&&e.kind==='building'&&e.progress<1)){
      const front=toward(h,end,.12),outpost=done('core').find(c=>!mine('refinery').some(r=>dist(center(r),center(c))<12));
      if(power.supply-power.demand<30&&credits>=240)place('reactor',h);
      else if(!mine('barracks').length)place('barracks',front);
      else if(!mine('factory').length)place('factory',front);
      else if(mine('refinery').length<2&&credits>=500){const ore=oreNear(h,8,26);if(ore)place('refinery',toward(ore,h,.25));}
      else if(!mine('lab').length&&s.time>150&&credits>=450)place('lab',h);
      else if(mine('turret').length<2&&s.time>90&&credits>=300)place('turret',toward(h,end,.18));
      else if(mine('factory').length<2&&credits>=900)place('factory',front);
      else if(mine('barracks').length<2&&credits>=700)place('barracks',front);
      else if(mine('refinery').length<3&&credits>=900){const ore=oreNear(h,10,34);if(ore)place('refinery',toward(ore,h,.25));}
      else if(outpost&&credits>=500){const ore=oreNear(center(outpost),3,14);if(ore)place('refinery',toward(ore,center(outpost),.3));}
    }
    expand();
    if(mine('harvester').length+queued('harvester')<Math.min(10,2*done('refinery').length))trainUnit(s,0,'harvester');
    for(const b of done('barracks'))if(!saving&&b.queue.length<2&&s.teams[0].credits>=160)trainUnit(s,0,(mine('rocket').length+queued('rocket'))*2<mine('rifle').length+queued('rifle')?'rocket':'rifle',b.id);
    for(const f of done('factory'))if(!saving&&f.queue.length<2&&s.teams[0].credits>=300){
      const tanks=mine('tank').length+queued('tank'),guns=mine('artillery').length+queued('artillery');
      if(!trainUnit(s,0,!mine('engineer').length&&!queued('engineer')&&tanks>=4?'engineer':guns*3<tanks&&tanks>=3?'artillery':'tank',f.id).ok)trainUnit(s,0,'tank',f.id);
    }
    for(const lab of done('lab'))if(!lab.research){const next=research.find(id=>researchStatus(s,0,id).ok);if(next)startResearch(s,0,next,lab.id);}
    const army=s.entities.filter(e=>e.team===0&&e.hp>0&&e.kind==='unit'&&UNITS[e.type].damage>0&&entityRole(e)!=='scout');
    if(!pushing&&(style==='macro'?s.time>=420&&army.length>=30:army.length>=18||s.time>=480&&army.length>=10)){pushing=true;firstPush??=s.time;}
    if(pushing&&army.length<6)pushing=false;
    if(s.time-lastOrder<6)continue;
    lastOrder=s.time;
    const goal=pushing?target():toward(h,target(),.25),ids=army.filter(u=>u.order.type==='idle'||pushing&&dist(u.order,goal)>3).map(u=>u.id);
    if(ids.length)issueOrder(s,ids,{type:'attackMove',...goal});
    const engineers=mine('engineer').filter(e=>e.order.type==='idle');
    if(engineers.length&&army.length){const c={x:army.reduce((n,u)=>n+u.x,0)/army.length,y:army.reduce((n,u)=>n+u.y,0)/army.length};issueOrder(s,engineers.filter(e=>dist(e,c)>5).map(e=>e.id),{type:'move',...c});}
  }
  return{mission,style,setting:difficulty,difficulty:s.difficulty,doctrine:s.ai.doctrine??'balanced',status:s.status,time:+s.time.toFixed(2),firstPush:firstPush&&+firstPush.toFixed(2),
    kills:s.teams.map(team=>team.kills),objectives:Object.fromEntries(s.mission.objectives.map(o=>[o.id,o.state]))};
}
for(const mission of missions)for(const doctrine of doctrines)for(const style of styles)console.log(JSON.stringify(play(mission,style,doctrine)));
