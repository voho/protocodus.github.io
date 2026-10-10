// Operation Ashline: every campaign operation and skirmish mode is well-formed, plays 600 s under AI
// without errors, gates the player's roster, fires each trigger exactly once across save and load, and can
// be completed. Also covers the engine extensions (repeating waves, population cap, directive merging,
// lit zones, fog-edge arrivals, witnessed tag counts, deployment zones) and the campaign progress, medal,
// debrief and career rules.
import assert from 'node:assert/strict';
import {UNITS,BUILDINGS,RESEARCH,BUILDING_UPGRADES,UNIT_CAP,MAP_SIZES,createGame,updateGame,canPlace,trainUnit,researchStatus,buildingUpgradeStatus,issueOrder,addEntity,deploymentStatus,deployNexus,entityRole,mapLayout} from '../sim.js';
import {newAI} from '../ai.js';
import {MISSIONS,CAMPAIGN,SKIRMISH_MODES,ARCHIVE} from '../campaign.js';
import {missionAllows,missionDirective,noteDelivery,noteTagLost,objectiveVoid,missionDeployment,WAVE_SCALE} from '../mission.js';
import {objectiveRows,objectiveProgress} from '../objectives-hud.js';
import {encodeGame,decodeGame} from '../save.js';
import {matchReport,medalFor,missionTime,commanderGoals,survivingVeterans,addToCareer,readCareer,emptyCareer,rivalName,COMMANDER_GOALS} from '../debrief.js';
import {readProgress,emptyProgress,isUnlocked,recordResult,launchSettings,newlyCleared,archiveEntries,steppedDifficulty} from '../campaign-ui.js';

const advance=(s,seconds)=>{for(let t=0;t<seconds&&s.status==='playing';t++)updateGame(s,1);};
const json=s=>JSON.parse(encodeGame(s)).game;
const own=(s,team,role)=>s.entities.filter(e=>e.team===team&&e.hp>0&&entityRole(e)===role);
const objective=(s,id)=>s.mission.objectives.find(o=>o.id===id);
const tagged=(s,tag)=>s.entities.filter(e=>e.tag===tag&&e.hp>0);
const zone=(s,id)=>s.mission.zones.find(z=>z.id===id);
const destroy=list=>{for(const e of list)e.hp=0;};
const rivals=s=>s.entities.filter(e=>e.team===1&&e.kind==='unit'&&e.hp>0);
// A loss on ground the player sees, as combat reports it; destroy() stands for losses under fog.
const witness=(s,list)=>{for(const e of list){const x=Math.floor(e.kind==='building'?e.x+e.size/2:e.x),y=Math.floor(e.kind==='building'?e.y+e.size/2:e.y);s.visible[0][y*s.width+x]=1;noteTagLost(s,e);e.hp=0;}};
const progressText=(s,id)=>{const def=MISSIONS[s.mission.id],i=def.objectives.findIndex(o=>o.id===id);return objectiveProgress(s,def.objectives[i],s.mission.objectives[i]);};
// Modes take the skirmish settings; campaign operations fix their own sector.
const MODE_SETTINGS={width:144,height:112,profile:'rift',races:['organics','aiUnity']};
const start=(id,seed,difficulty='normal',extra={})=>createGame(seed??MISSIONS[id].seed??`MODE-${id}`,difficulty,{...(MISSIONS[id].seed?{}:MODE_SETTINGS),mission:id,...extra});
const PLAYABLE=[...CAMPAIGN,'relay-control','last-light'];

// ---- Data -----------------------------------------------------------------------------------------------
assert.deepEqual(CAMPAIGN.map(id=>MISSIONS[id].name),['Landfall','Hold the Line','Signal in the Ash','Convoy to Cinder Gap','Red Ledger','Dead Signal','Hold the Relay','Severance']);
for(const id of CAMPAIGN){
  const def=MISSIONS[id];
  assert(def.seed&&def.location&&def.summary&&def.briefing&&def.opening&&def.victoryText&&Array.isArray(def.story)&&def.story.length,`${id} carries its briefing copy`);
  assert(Number.isFinite(def.par)&&def.par>0&&def.width&&def.height&&def.profile,`${id} fixes its sector and par time`);
  assert.equal(def.races[0],'organics','The player commands Expedition 07');
  for(const t of def.triggers)for(const action of t.do)if(action.say)assert(action.say.speaker.length<=40&&!/!/.test(action.say.text),`${id} dialogue keeps the house tone`);
}
// Every zone does a job: an unused zone still draws a labelled ring once explored, inviting a defence there.
for(const id of PLAYABLE){
  const def=MISSIONS[id],uses=JSON.stringify({...def,zones:undefined})+String(def.setup??'');
  for(const z of def.zones||[])assert(uses.includes(`"${z.id}"`)||uses.includes(`'${z.id}'`),`${id} uses its ${z.id} zone`);
}
assert.deepEqual(SKIRMISH_MODES.map(m=>m.id),['annihilation','relay','lastLight']);
assert(SKIRMISH_MODES.every(m=>m.name&&m.description&&(m.mission===undefined||Object.hasOwn(MISSIONS,m.mission))));
// Every unit and structure of both races has an archive entry with an original flavor line.
for(const type of [...Object.keys(UNITS),...Object.keys(BUILDINGS)])assert(typeof ARCHIVE.flavor[type]==='string'&&ARCHIVE.flavor[type].length>20,`Archive flavor for ${type}`);
assert(['world','factions','people'].every(key=>ARCHIVE[key].length&&ARCHIVE[key].every(e=>e.title&&e.text)));
assert.equal(archiveEntries('organics').length+archiveEntries('unity').length,Object.keys(UNITS).length+Object.keys(BUILDINGS).length+1,'Both factions list their roster; the shared wall appears in each');
assert(archiveEntries('unity').every(e=>e.title&&e.text&&e.meta&&e.flavor));
// Unlocks follow the canon: walls, sentries, capacitors and Vael launchers arrive with Hold the Line.
assert.deepEqual(newlyCleared('hold-the-line'),['Bulwark wall','Rail sentry','Grid capacitor','Rocket infantry']);
assert(newlyCleared('signal-in-the-ash').includes('Signal laboratory')&&newlyCleared('signal-in-the-ash').includes('War foundry')&&newlyCleared('signal-in-the-ash').includes('Vanguard tank')&&newlyCleared('signal-in-the-ash').includes('Field engineer'));
assert(newlyCleared('red-ledger').includes('Nexus construction vehicle'));
assert(newlyCleared('hold-the-relay').includes('Rocket tower')&&!newlyCleared('hold-the-relay').includes('Command nexus'));

// ---- Every operation builds as plain data, on its own seed and on a remixed one --------------------------
for(const id of PLAYABLE)for(const seed of [undefined,'REMIX-CHECK']){
  const s=start(id,seed,'normal',id==='severance'?{veterans:[{role:'rifle',kills:6},{role:'rocket',kills:12}]}:{});
  assert.deepEqual(structuredClone(s.mission),s.mission);assert.deepEqual(JSON.parse(JSON.stringify(s.mission)),s.mission);
  const clone=structuredClone(s);advance(clone,3);assert.equal(clone.status,'playing','A structured clone keeps playing');
  assert(s.mission.zones.every(z=>!s.blocked[Math.floor(z.y)*s.width+Math.floor(z.x)]),`${id} zones sit on open ground`);
  assert.deepEqual(json(decodeGame(encodeGame(s)).game),json(s));
  assert.equal(s.events.at(-1).kind,'opening');assert.equal(s.events.at(-1).text,MISSIONS[id].opening);
}

// ---- Rosters are gated to what each operation clears -------------------------------------------------------
const CATALOG={buildings:Object.keys(BUILDINGS).filter(k=>BUILDINGS[k].race!=='aiUnity'),units:Object.keys(UNITS).filter(k=>UNITS[k].race==='organics'),research:Object.keys(RESEARCH),upgrades:Object.keys(BUILDING_UPGRADES)};
for(const id of CAMPAIGN){
  const s=start(id),def=MISSIONS[id];
  for(const [category,list] of Object.entries(CATALOG))for(const key of list)assert.equal(missionAllows(s,0,category,key),!def.allow||def.allow[category].includes(key),`${id} gates ${category} ${key}`);
  assert(missionAllows(s,1,'units','tank'),'The rival is never gated');
}
{
  const s=start('landfall'),core=own(s,0,'core')[0];
  assert.equal(canPlace(s,0,'wall',core.x+5,core.y).reason,'Not authorized for this operation');
  assert.equal(trainUnit(s,0,'rocket').reason,'Not authorized for this operation');
  assert.equal(researchStatus(s,0,'infantryWeapons').reason,'Not authorized for this operation');
  assert.equal(buildingUpgradeStatus(s,0,own(s,0,'refinery')[0].id,'speed').reason,'Not authorized for this operation');
  const signal=start('signal-in-the-ash');assert.equal(trainUnit(signal,0,'tank').reason,'Requires War foundry','Cleared units keep their usual requirements');
  assert.equal(trainUnit(signal,0,'constructor').reason,'Not authorized for this operation');
}

// ---- 600 s under AI: no errors, triggers fire once, a save mid-operation continues exactly ---------------
const ONE_SHOT=new Set();
for(const id of PLAYABLE)for(const t of MISSIONS[id].triggers||[])if(t.when?.every===undefined)ONE_SHOT.add(`${id}:${t.id}`);
for(const id of PLAYABLE){
  const s=start(id);
  // An AI commands the player's side too, so every operation sees real combat and production.
  s.aiTeams=[...s.aiTeams,0];s.aiByTeam={...s.aiByTeam,0:newAI('normal')};
  advance(s,240);
  const saved=decodeGame(encodeGame(s)).game;
  advance(s,120);advance(saved,120);
  assert.deepEqual(json(saved),json(s),`${id} continues exactly after a save`);
  advance(s,240);
  assert(s.time>=599.99||s.status!=='playing',`${id} runs for ten minutes or ends`);
  const lines=s.events.filter(e=>e.kind==='dialogue').map(e=>`${e.speaker}|${e.text}`);
  assert.equal(new Set(lines).size,lines.length,`${id} never repeats a one-shot transmission`);
  for(const key of Object.keys(s.mission.fired))assert(MISSIONS[id].triggers.some(t=>t.id===key));
  for(const e of s.events.filter(e=>['objective','objectiveFailed'].includes(e.kind)))assert(['new','complete','failed'].includes(e.status)&&e.objective,`${id} objective events carry a status`);
  for(const e of s.events.filter(e=>e.kind==='wave'))assert(e.x===undefined||s.mission.zones.some(z=>z.x===e.x&&z.y===e.y),'Waves publish only static zones');
  const living=[0,1].map(team=>s.entities.filter(e=>e.team===team&&e.kind==='unit').length);
  assert(living.every(n=>n<=UNIT_CAP));
  decodeGame(encodeGame(s));
}

// ---- Each operation can be completed --------------------------------------------------------------------
const completed={};
function win(s,label){assert.equal(s.status,'victory',`${label} ends in victory`);assert.equal(s.events.at(-1).kind,'victory');assert.equal(s.events.at(-1).text,MISSIONS[s.mission.id].victoryText);completed[s.mission.id]=s;}
// Clear construction ground for a scripted structure, including a nexus that no command can place.
const clearSite=(s,size,near,radius=30)=>{
  for(let r=0;r<radius;r++)for(let y=Math.floor(near.y)-r;y<=near.y+r;y++)for(let x=Math.floor(near.x)-r;x<=near.x+r;x++){
    if(x<1||y<1||x+size>=s.width||y+size>=s.height)continue;
    let ok=true;for(let yy=y;yy<y+size&&ok;yy++)for(let xx=x;xx<x+size&&ok;xx++){const i=yy*s.width+xx;ok=!s.blocked[i]&&s.terrain[i]!==5&&!(s.minerals[i]>0);}
    if(ok&&!s.entities.some(e=>e.hp>0&&e.kind==='unit'&&e.x>x-.5&&e.x<x+size+.5&&e.y>y-.5&&e.y<y+size+.5))return{x,y};
  }
  throw new Error('No clear site');
};
const place=(s,type,near,radius=14)=>{
  for(let r=3;r<radius;r++)for(let y=Math.floor(near.y)-r;y<=near.y+r;y++)for(let x=Math.floor(near.x)-r;x<=near.x+r;x++)if(canPlace(s,0,type,x,y).ok)return addEntity(s,0,'building',type,x,y,true);
  throw new Error(`No site for ${type}`);
};
// Landfall plays through its tutorial chain with real orders, construction and training.
{
  const s=start('landfall'),marker=zone(s,'marker');
  assert.deepEqual(s.mission.objectives.filter(o=>o.revealed).map(o=>o.id),['marker','overlook','hauler','losses']);
  const squad=s.entities.filter(e=>e.team===0&&e.kind==='unit'&&UNITS[e.type].damage>0);
  // The picket's units are never totalled, so the tracker cannot count forces under fog.
  assert.equal(s.mission.counters['mobile:picket'],4);assert.equal(progressText(s,'picket'),'');
  issueOrder(s,squad.map(e=>e.id),{type:'move',x:marker.x,y:marker.y});
  for(let i=0;i<90&&objective(s,'marker').state==='active';i++)advance(s,1);
  assert.equal(objective(s,'marker').state,'done');advance(s,1);
  // A quick commander reaches the marker before the walking hint is due; the stale hint never plays.
  assert(s.events.find(e=>e.objective==='marker').time<8);advance(s,8);assert(!s.mission.fired['first-steps']);
  assert(objective(s,'barracks').revealed,'Reaching the marker reveals the barracks step');
  const reveal=s.events.find(e=>e.kind==='objective'&&e.objective==='barracks');assert.equal(reveal.status,'new');assert.equal(reveal.text,'New objective: Build a Field barracks');
  const done=s.events.find(e=>e.kind==='objective'&&e.objective==='marker');assert.equal(done.status,'complete');assert.deepEqual([done.x,done.y],[marker.x,marker.y]);
  const barracks=place(s,'barracks',own(s,0,'core')[0]);
  advance(s,2);assert.equal(objective(s,'barracks').state,'done');advance(s,1);
  assert(objective(s,'shards').revealed&&objective(s,'shards').state==='active','The shard quota counts from its reveal');
  for(let i=0;i<3;i++)assert(trainUnit(s,0,'rifle',barracks.id).ok);
  for(let i=0;i<60&&objective(s,'rifles').state==='active';i++)advance(s,1);
  assert.equal(objective(s,'rifles').state,'done');
  for(let i=0;i<120&&objective(s,'shards').state==='active';i++)advance(s,1);
  assert.equal(objective(s,'shards').state,'done','Haulers deliver the shard quota');
  advance(s,1);assert(objective(s,'picket').revealed);
  // The squads attack-move on the picket after it is weakened; combat finishes it.
  for(const e of tagged(s,'picket'))e.hp=Math.min(e.hp,4);
  const picket=zone(s,'picket'),army=s.entities.filter(e=>e.team===0&&e.kind==='unit'&&UNITS[e.type].damage>0);
  issueOrder(s,army.map(e=>e.id),{type:'attackMove',x:picket.x,y:picket.y});
  for(let i=0;i<200&&s.status==='playing';i++)advance(s,1);
  win(s,'Landfall');
  assert.equal(objective(s,'picket').state,'done');assert.equal(objective(s,'losses').state,'done','A loss limit that holds is complete at victory');
  assert.equal(s.mission.counters['seen:picket'],4,'Losses in sight are witnessed');assert.equal(progressText(s,'picket'),'4 destroyed');
}
// An idle commander gets the walking hint on time; an unseen loss is never witnessed.
{
  const s=start('landfall');advance(s,9);assert(s.mission.fired['first-steps']);
  const [scout]=tagged(s,'picket').filter(e=>e.type==='unityScout');
  assert(!s.visible[0][Math.floor(scout.y)*s.width+Math.floor(scout.x)]);noteTagLost(s,scout);assert.equal(s.mission.counters['seen:picket'],undefined);
  witness(s,[scout]);assert.equal(s.mission.counters['seen:picket'],1);
}
// Hold the Line: raids arrive every 50 s from hidden edges; the defenders clear them and raise sentries.
{
  const s=start('hold-the-line');
  for(let t=0;t<520&&s.status==='playing';t++){
    updateGame(s,1);
    destroy(rivals(s));
    if(t===100){const core=own(s,0,'core')[0];place(s,'barracks',core);place(s,'turret',core);place(s,'turret',core);}
  }
  win(s,'Hold the Line');
  const waves=s.events.filter(e=>e.kind==='wave');
  assert.equal(s.mission.counters['repeat:raids'],9,'Nine raids between 45 s and 450 s');assert.equal(waves.length,10,'Nine raids and the final assault');
  assert(waves.every(e=>e.x===undefined),'Edge arrivals publish no position');
  assert(s.mission.fired.raids,'The raid schedule ends at its until time');
  assert.equal(objective(s,'hold').state,'done');assert.equal(objective(s,'sentries').state,'done');assert.equal(objective(s,'intact').state,'done');
}
// Signal in the Ash: browning out the outpost, then destroying the archive.
{
  const s=start('signal-in-the-ash'),lance=tagged(s,'lance');
  assert.equal(lance.length,2);assert.equal(tagged(s,'spire').length,1);assert.equal(tagged(s,'archive')[0].type,'unityLab');
  // The archive's outpost is a briefed static target: the tracker locates it and its sorties name it.
  assert.equal(objectiveRows(s).rows.find(r=>r.id==='archive').zone.label,'Unity relay outpost');
  destroy(tagged(s,'spire'));advance(s,60);
  assert.equal(objective(s,'spire').state,'done');
  assert.equal(s.teams[1].powerStatus,'brownout','Without its spire the outpost browns out once the reserve drains');
  assert(objective(s,'nodes').revealed,'The Lance node objective is revealed with the briefing on the nodes, before any fight');
  const outpost=zone(s,'outpost'),scout=own(s,0,'scout')[0];scout.x=outpost.x;scout.y=outpost.y;advance(s,1);
  assert(s.mission.fired.intrusion,'Entering the outpost draws the archive guard');
  destroy(tagged(s,'archive'));advance(s,1);
  win(s,'Signal in the Ash');
  assert.equal(medalFor(s),'bronze','Unfinished secondaries leave a bronze medal');
  // A unit loss limit counts unit losses only.
  const g=start('signal-in-the-ash');g.teams[0].stats.lost=9;g.teams[0].stats.structuresLost=3;advance(g,1);
  assert.equal(objective(g,'losses').state,'active');assert.equal(objective(g,'losses').progress,9);assert.equal(progressText(g,'losses'),'9 / 10 lost');
  g.teams[0].stats.lost=11;advance(g,1);assert.equal(objective(g,'losses').state,'failed');assert.equal(progressText(g,'losses'),'11 / 10 lost');
  // The two Lance nodes are structures placed with the operation: their total is a published fact.
  assert.equal(progressText(g,'nodes'),'0 / 2');
}
// Convoy: the construction vehicle deploys inside Cinder Gap and the nexus comes online.
{
  const s=start('convoy'),gap=zone(s,'gap'),vehicle=own(s,0,'constructor')[0];
  assert(vehicle&&!own(s,0,'core').length,'The convoy starts with no base');
  assert.equal(tagged(s,'mechanic').length,1);
  // The only construction vehicle cannot file the claim anywhere but the gap, so it is never stranded.
  const near={x:Math.floor(vehicle.x)+1,y:Math.floor(vehicle.y)-4};
  assert(Math.hypot(near.x+1.5-gap.x,near.y+1.5-gap.y)>gap.r);
  assert.equal(deploymentStatus(s,0,vehicle.id,near.x,near.y).reason,'Deploy inside the Cinder Gap claim site');
  assert.equal(missionDeployment(s,1,near.x,near.y),'','The rival deploys anywhere');
  vehicle.x=gap.x;vehicle.y=gap.y;advance(s,2);
  for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++)s.explored[0][(Math.floor(gap.y)+y)*s.width+Math.floor(gap.x)+x]=1;
  let site=null;
  for(let r=0;r<4&&!site;r++)for(let y=-r;y<=r&&!site;y++)for(let x=-r;x<=r&&!site;x++)if(deploymentStatus(s,0,vehicle.id,Math.floor(gap.x)-1+x,Math.floor(gap.y)-1+y).ok)site={x:Math.floor(gap.x)-1+x,y:Math.floor(gap.y)-1+y};
  assert(site,'Cinder Gap has a clear deployment site');
  assert(deployNexus(s,0,vehicle.id,site.x,site.y).ok);
  for(let i=0;i<90&&s.status==='playing';i++){updateGame(s,1);destroy(rivals(s));}
  win(s,'Convoy to Cinder Gap');
  assert(s.mission.fired.arrival&&s.mission.fired.counter,'Arriving at the gap draws the counterattack');
  // The counterattack sets out from the lane beyond the gap, near enough to reach the site while a nexus builds.
  const c=start('convoy'),claim=zone(c,'gap'),truck=own(c,0,'constructor')[0];destroy(c.entities.filter(e=>e.team===1));
  truck.x=claim.x;truck.y=claim.y;advance(c,30);assert.equal(tagged(c,'counter').length,0);advance(c,2);
  const counter=tagged(c,'counter');
  assert.equal(counter.length,7);assert(counter.every(e=>Math.hypot(e.x-claim.x,e.y-claim.y)<34&&!c.visible[0][Math.floor(e.y)*c.width+Math.floor(e.x)]),'The counterattack sets out near the gap, out of sight');
}
// Red Ledger: a full rival commander; three operating claims and a red seam quota win the audit.
{
  const s=start('red-ledger');
  assert.deepEqual(s.teams.map(t=>t.race),['organics','organics']);assert.deepEqual(s.aiTeams,[1]);assert.equal(rivalName(s),'Red Ledger');
  advance(s,30);
  const {start:home}=mapLayout(s);
  for(const near of [{x:home.x+14,y:home.y-10},{x:home.x-12,y:home.y+12}]){const site=clearSite(s,3,near);addEntity(s,0,'building','core',site.x,site.y,true);}
  noteDelivery(s,0,2500,3);
  for(let i=0;i<5&&s.status==='playing';i++)advance(s,1);
  win(s,'Red Ledger');
}
// Dead Signal: three spires, then the hidden relay mainframe; survivors become veterans.
{
  const s=start('dead-signal');
  assert(!own(s,0,'core').length&&own(s,0,'rifle').every(e=>e.kills===5),'A ranked strike team without a base');
  assert(!objective(s,'relay').revealed);
  const spires=tagged(s,'spire');assert.equal(spires.length,3);
  assert.equal(progressText(s,'spires'),'0 / 3','The three spires are published targets');
  witness(s,spires.slice(0,1));advance(s,1);assert(s.mission.fired.reroute);assert.equal(progressText(s,'spires'),'1 / 3');
  // One falls out of sight as the last is seen: the objective completes, and "one spire left" never plays late.
  destroy(spires.slice(1,2));witness(s,spires.slice(2));advance(s,1);
  assert(!s.mission.fired['last-spire']);assert.equal(progressText(s,'spires'),'3 / 3');
  assert(objective(s,'relay').revealed,'Silencing the spires exposes the relay mainframe');
  assert(s.events.some(e=>e.kind==='objective'&&e.status==='new'&&e.objective==='relay'));
  destroy(tagged(s,'relay'));advance(s,1);
  win(s,'Dead Signal');
  const veterans=survivingVeterans(s);
  assert(veterans.length>=5&&veterans.every(v=>v.kills>=5&&UNITS[v.role].damage>0),'Ranked survivors carry over');
  // A spire lost under fog is not announced.
  const fog=start('dead-signal');destroy(tagged(fog,'spire').slice(0,1));advance(fog,1);assert(!fog.mission.fired.reroute);assert.equal(progressText(fog,'spires'),'0 / 3');
  // The engineer's parts budget keeps the rovers running; nothing else can be bought with it.
  const parts=start('dead-signal'),rover=own(parts,0,'scout')[0],engineer=own(parts,0,'engineer')[0];
  assert.equal(parts.teams[0].credits,400);rover.hp=rover.maxHp/2;rover.x=engineer.x+1.5;rover.y=engineer.y;advance(parts,3);
  assert(rover.hp>rover.maxHp/2&&parts.teams[0].credits<400,'The engineer repairs a rover from the parts budget');
  // The unarmed engineer alone cannot finish the strike, so the operation ends with the last armed unit.
  const alone=start('dead-signal');destroy(alone.entities.filter(e=>e.team===0&&e.kind==='unit'&&entityRole(e)!=='engineer'));advance(alone,1);
  assert.equal(alone.status,'defeat');assert.equal(alone.events.at(-1).text,'All armed units lost. Operation failed.');
}
// Hold the Relay: armor holds the lit relay; rival units that enter are cleared.
{
  const s=start('hold-the-relay');
  assert.equal(launchSettings('hold-the-relay',{difficulty:'normal'}).difficulty,'hard','Veteran cohorts: one opposition level up');
  const relay=zone(s,'relay');
  assert(s.visible[0][Math.floor(relay.y)*s.width+Math.floor(relay.x)]&&s.visible[1][Math.floor(relay.y)*s.width+Math.floor(relay.x)],'The relay is lit for both claimants');
  assert.deepEqual(missionDirective(s,1).attack,{x:relay.x,y:relay.y});
  const holders=Array.from({length:3},(_,i)=>addEntity(s,0,'unit','tank',relay.x-1+i,relay.y));
  for(let i=0;i<260&&s.status==='playing';i++){updateGame(s,1);for(const e of rivals(s))if(Math.hypot(e.x-relay.x,e.y-relay.y)<12)e.hp=0;}
  win(s,'Hold the Relay');
  assert(holders.some(e=>e.hp>0));assert.equal(objective(s,'hold').progress,240);
  // The rival's opening units head straight for the relay, so its clock is called out early.
  assert(s.events.some(e=>e.kind==='dialogue'&&/counts against us/.test(e.text)&&e.time<21),'The rival hold is called out early');
  // The alternative: voiding every rival claim wins outright.
  const alt=start('hold-the-relay');destroy([...own(alt,1,'core'),...own(alt,1,'constructor')]);advance(alt,1);
  assert.equal(alt.status,'victory');assert.equal(objective(alt,'claims').state,'done');
}
// Severance: Dead Signal veterans deploy ranked; every mainframe and constructor must fall.
{
  const veterans=survivingVeterans(completed['dead-signal']);
  const s=start('severance',undefined,'normal',launchSettings('severance',{},{...emptyProgress(),veterans}).options);
  const deployed=tagged(s,'veteran');
  assert.equal(deployed.length,veterans.length);assert(deployed.every(e=>e.kills>=5&&e.maxHp>UNITS[e.type].hp),'Veterans keep their rank');
  assert.equal(own(s,1,'core').length,3,'The main mainframe and two outlying cores');
  destroy(tagged(s,'outlier'));advance(s,1);assert.equal(objective(s,'outliers').state,'done');assert.equal(s.status,'playing');
  destroy([...own(s,1,'core'),...own(s,1,'constructor')]);advance(s,1);
  win(s,'Severance');
  assert.equal(objective(s,'veterans').state,'done');
  assert.throws(()=>start('severance',undefined,'normal',{veterans:[{role:'harvester',kills:5}]}),RangeError,'Only combat veterans carry over');
  assert(!objectiveVoid(s.mission,'veterans')&&objectiveRows(s).rows.some(r=>r.id==='veterans'));
  // Without veterans their objective does not apply: it is not listed, classified or counted for medals.
  const bare=start('severance');
  assert(objectiveVoid(bare.mission,'veterans'));assert.deepEqual(objectiveRows(bare).rows.map(r=>r.id),['sever','outliers']);assert.equal(objectiveRows(bare).classified,0);
  destroy(tagged(bare,'outlier'));destroy([...own(bare,1,'core'),...own(bare,1,'constructor')]);advance(bare,1);
  assert.equal(bare.status,'victory');assert.equal(objective(bare,'veterans').state,'active');
  assert.deepEqual(matchReport(bare).secondary,{done:1,total:1});assert.equal(medalFor(bare),'gold');
}
// Relay control: either side can win the relay.
{
  const s=start('relay-control'),relay=zone(s,'relay');
  addEntity(s,0,'unit','tank',relay.x,relay.y);
  for(let i=0;i<320&&s.status==='playing';i++){updateGame(s,1);for(const e of rivals(s))if(Math.hypot(e.x-relay.x,e.y-relay.y)<12)e.hp=0;}
  win(s,'Relay control');
  assert(s.events.some(e=>e.kind==='dialogue'&&/Its clock runs/.test(e.text)&&e.time<21),'The rival hold is called out early');
  // Without its commander's own orders, a rival tank parked on the relay holds it.
  const lost=start('relay-control'),hub=zone(lost,'relay');lost.aiTeams=[];
  addEntity(lost,1,'unit','unityTank',hub.x,hub.y);
  for(let i=0;i<320&&lost.status==='playing';i++){updateGame(lost,1);for(const e of lost.entities)if(e.team===0&&e.kind==='unit'&&Math.hypot(e.x-hub.x,e.y-hub.y)<12)e.hp=0;}
  assert.equal(lost.status,'defeat');assert.equal(lost.events.at(-1).text,'The rival holds the relay. Operation failed.');
  assert.equal(lost.mission.counters['rivalHold:relay'],300);
}
// Last Light: endless waves from hidden edges under a live population cap; the score grows until the end.
{
  const s=start('last-light'),core=own(s,0,'core')[0];
  assert.deepEqual(s.aiTeams,[]);assert(!s.entities.some(e=>e.team===1));
  for(let i=0;i<4;i++)addEntity(s,0,'unit','tank',core.x+4+i,core.y+4);
  let checked=0,peak=0;
  for(let t=0;t<700&&s.status==='playing';t++){
    const before=new Set(s.entities.map(e=>e.id));updateGame(s,1);
    const arrivals=s.entities.filter(e=>e.team===1&&!before.has(e.id));
    if(arrivals.length&&checked<4){checked++;assert(arrivals.every(e=>!s.visible[0][Math.floor(e.y)*s.width+Math.floor(e.x)]),'Waves arrive outside the player\'s vision');}
    // The base holds so the attackers accumulate against the cap.
    for(const e of own(s,0,'core').concat(own(s,0,'reactor'),own(s,0,'refinery')))e.hp=e.maxHp;
    peak=Math.max(peak,rivals(s).length);assert(rivals(s).length<=150,'Live wave population stays capped');
  }
  assert.equal(peak,150,'Waves fill up to the live cap');
  assert(s.mission.counters['repeat:waves']>=16&&s.mission.score>0);
  const waves=s.events.filter(e=>e.kind==='wave');
  // Later waves may be clipped by the live cap, so compare the largest with the first.
  assert(Math.max(...waves.map(e=>e.count))>waves[0].count,'Waves grow');assert(waves.every(e=>e.x===undefined));
  assert.equal(objective(s,'ten').state,'done');
  destroy([...own(s,0,'core')]);advance(s,1);
  assert.equal(s.status,'defeat');
  const report=matchReport(s);assert.equal(report.survival,s.mission.score);assert(report.score===report.survival&&'SABCD'.includes(report.grade));
  // The briefing states the formula the score uses.
  for(const text of [MISSIONS['last-light'].briefing,SKIRMISH_MODES.find(m=>m.id==='lastLight').description])assert.match(text,/Score is seconds survived × kills ÷ 10\./);
  // Twenty seconds before the first wave, ten kills: about 20 points, where seconds × kills would be 200.
  const scored=start('last-light');scored.teams[0].kills=10;advance(scored,20);
  assert(scored.mission.score>=19&&scored.mission.score<=20,`score ${scored.mission.score}`);
}
// Kills made out of sight stay unconfirmed during play: kill objectives, kill triggers and the live score count
// only the rest, so a barrage into fog cannot be read off the tracker. The final score counts every kill.
{
  const s=start('last-light'),team=s.teams[0];team.kills=team.stats.unitKills=10;team.stats.unseenUnitKills=4;advance(s,20);
  assert.equal(objective(s,'hundred').progress,6);assert.equal(progressText(s,'hundred'),'6 / 100');
  assert(s.mission.score>=11&&s.mission.score<=12,`score ${s.mission.score}`);
  destroy(own(s,0,'core'));advance(s,1);assert.equal(s.status,'defeat');
  assert.equal(s.mission.score,Math.floor((s.time-s.mission.startedAt)*10/10));assert.equal(matchReport(s).kills,10);
  const h=start('hold-the-line'),held=h.teams[0];held.kills=held.stats.unitKills=7;held.stats.unseenUnitKills=3;advance(h,2);
  assert(!h.mission.fired['first-blood'],'Unseen kills never fire a kill trigger');
  held.stats.unseenUnitKills=2;advance(h,1);assert(h.mission.fired['first-blood']);
}
assert.deepEqual(Object.keys(completed).sort(),[...CAMPAIGN,'relay-control'].sort(),'Every operation and the relay mode were completed');

// ---- Engine extensions ----------------------------------------------------------------------------------
// Repeating triggers fire on schedule, grow, scale with opposition and end at their limit; saves continue.
MISSIONS['check-waves']={id:'check-waves',name:'Wave check',races:['organics','aiUnity'],aiTeams:[],start:['standard','none'],
  zones:[{id:'gate',label:'Gate',at:'lane:0.6',r:5}],
  objectives:[{id:'hold',type:'survive',seconds:200,label:'Hold'}],
  directives:{1:{attack:'gate',defend:{at:'gate',r:6},noExpand:true,waveSize:4}},
  triggers:[
    {id:'waves',when:{time:10,every:10,limit:3},do:[{spawn:{team:1,units:[['rifle',2,2],['tank',1,0,1]],at:'gate',tag:'wave',text:'Wave {wave}.'}}]},
    {id:'pulse',when:{every:15,until:60},do:[{credits:10}]},
    {id:'retarget',when:{time:40},do:[{directive:{team:1,attack:{x:3,y:3}}}]},
  ]};
{
  const s=createGame('waves','normal',{width:144,height:112,mission:'check-waves'});
  const near=(time,target)=>Math.abs(time-target)<=.3;
  advance(s,25);const saved=decodeGame(encodeGame(s)).game;
  advance(s,50);advance(saved,50);assert.deepEqual(json(saved),json(s),'Repeating triggers continue exactly after a save');
  const waves=s.events.filter(e=>e.kind==='wave');
  assert.deepEqual(waves.map(e=>[e.count,e.text]),[[2,'Wave 1.'],[5,'Wave 2.'],[7,'Wave 3.']],'Waves grow and add armor from the second');
  assert(waves.every((e,i)=>near(e.time,10*(i+1))),'Waves fire at 10, 20 and 30 s');
  assert.equal(s.mission.counters['repeat:waves'],3);assert(s.mission.fired.waves);
  const supplies=s.events.filter(e=>e.kind==='mission');assert.equal(supplies.length,3,'An until time ends the repetition');assert(supplies.every((e,i)=>near(e.time,15*(i+1))));
  const gate=zone(s,'gate');
  assert.deepEqual(missionDirective(s,1),{attack:{x:3,y:3},defend:{x:gate.x,y:gate.y,r:6},noExpand:true,waveSize:4},'A directive action changes only the keys it names');
  for(const [level,scale] of Object.entries(WAVE_SCALE)){
    const g=createGame('waves',level,{width:144,height:112,mission:'check-waves'});advance(g,11);
    assert.equal(g.events.find(e=>e.kind==='wave').count,Math.max(1,Math.round(2*scale)),`Waves scale for ${level} opposition`);
  }
}
// Scripted forces never push a side past its population cap, so every operation stays loadable.
MISSIONS['check-cap']={id:'check-cap',name:'Cap check',races:['organics','aiUnity'],aiTeams:[],start:['standard','none'],zones:[],
  objectives:[{id:'hold',type:'survive',seconds:50,label:'Hold'}],
  triggers:[{id:'flood',when:{time:1},do:[{spawn:{team:1,units:[['rifle',40]],at:'end',cap:25}}]},{id:'more',when:{time:2},do:[{spawn:{team:1,units:[['rifle',40]],at:'center'}}]}]};
{
  const s=createGame('cap','normal',{width:144,height:112,mission:'check-cap'});
  const open=[];for(let y=2;y<s.height-2&&open.length<UNIT_CAP-10;y++)for(let x=2;x<s.width-2&&open.length<UNIT_CAP-10;x++)if(!s.blocked[y*s.width+x])open.push({x:x+.5,y:y+.5});
  updateGame(s,1.3);assert.equal(rivals(s).length,25,'A wave cap limits the live population');
  for(const p of open.slice(0,UNIT_CAP-35))addEntity(s,1,'unit','unityRifle',p.x,p.y);
  updateGame(s,1);
  assert.equal(s.entities.filter(e=>e.team===1&&e.kind==='unit').length,UNIT_CAP,'Spawns stop at the population cap');
  assert.equal(s.events.filter(e=>e.kind==='wave').at(-1).count,10);
  decodeGame(encodeGame(s));
}
// A wave names its arrival zone only once the player may see it (a revealed objective's zone, or explored
// ground), so an alert never points into unexplored ground at a hidden garrison.
MISSIONS['check-arrival']={id:'check-arrival',name:'Arrival check',races:['organics','aiUnity'],aiTeams:[],start:['standard','none'],
  zones:[{id:'den',label:'Den',at:'end',r:5},{id:'gate',label:'Gate',at:'center',r:5}],
  objectives:[{id:'hold',type:'survive',seconds:200,label:'Hold'},{id:'gate',type:'reachZone',zone:'gate',hidden:true,label:'Reach the gate'}],
  triggers:[
    {id:'den',when:{time:2,every:4,limit:2},do:[{spawn:{team:1,units:[['rifle',1]],at:'den',text:'Den'}}]},
    {id:'gate',when:{time:2,every:2,limit:2},do:[{spawn:{team:1,units:[['rifle',1]],at:'gate',text:'Gate'}}]},
    {id:'open',when:{time:3},do:[{reveal:'gate'}]},
  ]};
{
  const s=createGame('arrival','normal',{width:144,height:112,mission:'check-arrival'}),den=zone(s,'den'),gate=zone(s,'gate');
  const cell=z=>Math.floor(z.y)*s.width+Math.floor(z.x),arrivals=text=>s.events.filter(e=>e.kind==='wave'&&e.text===text).map(e=>e.x===undefined?null:[e.x,e.y]);
  assert(!s.explored[0][cell(den)]&&!s.explored[0][cell(gate)]);
  advance(s,5);s.explored[0][cell(den)]=1;advance(s,2);
  assert.deepEqual(arrivals('Gate'),[null,[gate.x,gate.y]],'A hidden objective\'s zone is named once the objective is revealed');
  assert.deepEqual(arrivals('Den'),[null,[den.x,den.y]],'A garrison zone is named once its centre is explored');
}
delete MISSIONS['check-waves'];delete MISSIONS['check-cap'];delete MISSIONS['check-arrival'];
// Authoring errors that saves would refuse are rejected when the operation is created.
const base={objectives:[{id:'a',type:'kills',count:1,label:'x'}]};
for(const broken of [
  {directives:{1:{waveSize:0}}},{directives:{1:{defend:{at:'center',r:100}}}},{zones:[{id:'z',label:'Zone',at:'center',r:.2}]},{zones:[{id:'z',label:'Zone',at:'center',r:60}]},
  {zones:[{id:'z',label:'Zone',at:{at:'center',dx:NaN},r:4}]},{triggers:[{id:'t',when:{},do:[{spawn:{team:0,units:[['rifle',1]],order:'attackBase'}}]}]},
  {triggers:[{id:'t',when:{limit:3},do:[]}]},{triggers:[{id:'t',when:{every:.5},do:[]}]},{triggers:[{id:'t',when:{soon:true},do:[]}]},
  {triggers:[{id:'t',when:{},do:[{spawn:{units:[['rifle',1]],cap:0}}]}]},{triggers:[{id:'t',when:{},do:[{spawn:{units:[['rifle',1]],kills:2000}}]}]},
  {triggers:[{id:'t',when:{after:{trigger:'t',seconds:1}},do:[]}]},{triggers:[{id:'t',when:{},do:[{say:{speaker:'x'.repeat(41),text:'Hello.'}}]}]},
  {fail:[{type:'rivalHold',zone:'nowhere',seconds:5}]},{triggers:[{id:'t',when:{},do:[{spawn:{units:[['rifle',1]],at:'fogEdge',order:{zone:'fogEdge'}}}]}]},
  {fail:[{type:'coreLost',armed:true}]},{deployZone:'nowhere'},{triggers:[{id:'t',when:{objectiveActive:'nope'},do:[]}]},
]){MISSIONS['check-broken']={id:'check-broken',...base,...broken};assert.throws(()=>createGame('broken','normal',{width:72,height:56,mission:'check-broken'}),/Mission check-broken/,JSON.stringify(broken));}
delete MISSIONS['check-broken'];

// ---- Campaign progress, medals, debrief and career ------------------------------------------------------
{
  let progress=emptyProgress();
  assert.deepEqual(CAMPAIGN.map(id=>isUnlocked(progress,id)),[true,false,false,false,false,false,false,false],'Only Landfall opens a new campaign');
  const landfall=completed.landfall,report=matchReport(landfall);
  assert.equal(report.status,'victory');assert(report.rival,'The rival record appears once the operation ends');
  assert(report.rating>=50&&report.rating<=100&&report.score===report.rating*100&&'SABCD'.includes(report.grade));
  assert.equal(report.medal,medalFor(landfall));
  progress=recordResult(progress,landfall,report);
  assert(isUnlocked(progress,'hold-the-line')&&!isUnlocked(progress,'signal-in-the-ash'));
  assert.equal(progress.missions.landfall.wins,1);assert.equal(progress.missions.landfall.best,report.time);
  // A worse result never lowers the medal or the best time; a defeat counts as a play.
  const defeat=start('landfall');destroy(own(defeat,0,'core'));advance(defeat,1);assert.equal(defeat.status,'defeat');
  const after=recordResult(progress,defeat,matchReport(defeat));
  assert.deepEqual({...after.missions.landfall,plays:0},{...progress.missions.landfall,plays:0});assert.equal(after.missions.landfall.plays,2);
  assert.equal(medalFor(defeat),null);
  // Medal tiers: silver needs every secondary, gold also needs the par time.
  const gold=structuredClone(landfall);gold.mission.objectives.forEach(o=>{o.state='done';});gold.time=MISSIONS.landfall.par-1;
  assert.equal(medalFor(gold),'gold');gold.time=MISSIONS.landfall.par+1;assert.equal(medalFor(gold),'silver');
  gold.mission.objectives.find(o=>o.id==='overlook').state='active';assert.equal(medalFor(gold),'bronze');
  // Hold the Line ends on its survival timer, on a quarter-second check just past the par; a perfect run earns gold.
  const line=structuredClone(completed['hold-the-line']);line.mission.objectives.forEach(o=>{o.state='done';});
  assert(missionTime(line)>=MISSIONS['hold-the-line'].par);assert.equal(medalFor(line),'gold','A perfect Hold the Line earns gold');
  // Its fixed length earns only a neutral tempo share, and the economy share counts starting credits and supply
  // as income: a run with heavy losses and a missed secondary no longer grades S beside a bronze medal.
  line.mission.objectives.find(o=>o.id==='walls').state='active';line.teams[0].kills=80;line.teams[0].credits=0;
  Object.assign(line.teams[0].stats,{unitKills:80,structureKills:0,unseenUnitKills:0,unseenStructureKills:0,lost:35,structuresLost:3,mined:6000,spent:8000});
  assert.deepEqual([matchReport(line).rating,matchReport(line).grade,medalFor(line)],[85,'A','bronze']);
  line.teams[0].credits=8000;assert.equal(matchReport(line).rating,80,'Unspent income lowers the economy share');
  line.teams[0].stats.mined=0;assert.equal(matchReport(line).rating,80,'Without mining the economy share is neutral');
  // Dead Signal survivors become the Severance roster; stored progress is sanitized.
  progress=recordResult(progress,completed['dead-signal'],matchReport(completed['dead-signal']));
  assert.deepEqual(progress.veterans,survivingVeterans(completed['dead-signal']));
  assert.deepEqual(launchSettings('severance',{difficulty:'easy'},progress).options.veterans,progress.veterans);
  assert.equal(launchSettings('landfall',{seed:'REMIX-1'}).seed,'REMIX-1');assert.equal(launchSettings('landfall').seed,'LANDFALL-07');
  assert.equal(steppedDifficulty('hard',1),'hard');assert.equal(steppedDifficulty('easy',1),'normal');
  const stored=readProgress(JSON.parse(JSON.stringify({...progress,missions:{...progress.missions,bogus:{wins:3},landfall:{...progress.missions.landfall,medal:'platinum',best:-5}},veterans:[...progress.veterans,{role:'harvester',kills:9},{role:'rifle',kills:1e9}],tab:'elsewhere'})));
  assert.equal(stored.missions.bogus,undefined);assert.equal(stored.missions.landfall.medal,null);assert.equal(stored.missions.landfall.best,null);
  assert.deepEqual(stored.veterans,progress.veterans);assert.equal(stored.tab,'skirmish');
  assert.deepEqual(readProgress('garbage'),emptyProgress());
  const lastLight=recordResult(emptyProgress(),{mission:{id:'last-light'}},{survival:420});assert.equal(lastLight.lastLight.best,420);
  // Career totals count each finished operation once.
  let career=addToCareer(emptyCareer(),report,'k1');career=addToCareer(career,report,'k1');
  assert.equal(career.operations,1);assert.equal(career.victories,1);assert.equal(career.kills,report.kills);assert.equal(career.bestGrade,report.grade);
  assert.equal(career.fastestVictory,Math.round(report.time));
  assert.deepEqual(readCareer(JSON.parse(JSON.stringify(career))),career);assert.deepEqual(readCareer({operations:-1,bestGrade:'Z'}),emptyCareer());
}
// Commander's goals read only the player's own statistics and never un-tick; old saves have none.
{
  const s=createGame('goals','normal',{width:144,height:112});
  assert.equal(commanderGoals(s).filter(g=>g.done).length,0);assert.equal(COMMANDER_GOALS.length,8);
  s.teams[0].stats.mined=2500;s.teams[1].stats.mined=1e6;
  assert.deepEqual(commanderGoals(s).filter(g=>g.done).map(g=>g.id),['payroll']);
  delete s.teams[0].stats;assert.equal(commanderGoals(s),null);assert.equal(matchReport(s).you,null);
  const playing=matchReport(createGame('goals','normal',{width:144,height:112}));assert.equal(playing.rival,null,'No rival record while the operation is live');
}

console.log(`Ashline campaign checks passed: ${CAMPAIGN.length} operations and ${SKIRMISH_MODES.length-1} skirmish modes build on canonical and remixed seeds, gate their rosters, play 600 s under AI with exact save continuation and single-fire triggers, and are completed (${Object.keys(completed).join(', ')}); repeating and scaled waves, population caps, directive merging, lit zones, fog-edge arrivals, witnessed tag counts, deployment zones, armed-unit fail rules, void objectives, authoring validation, medals, progress, veterans, debrief and career records.`);
