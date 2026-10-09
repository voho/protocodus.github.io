import assert from 'node:assert/strict';
import {UNITS,MAP_SIZES,createGame,updateGame,canPlace,placeBuilding,trainUnit,researchStatus,buildingUpgradeStatus,issueOrder,getEntity,addEntity,sellBuilding,mapLayout,entityRole} from '../sim.js';
import {MISSIONS,SKIRMISH_MODES} from '../campaign.js';
import {MISSION_INTERVAL,missionOutcome,missionAllows,missionDirective} from '../mission.js';
import {encodeGame,decodeGame} from '../save.js';

const advance=(s,seconds)=>{for(let i=0;i<Math.round(seconds*20);i++)updateGame(s,.05);};
const stateJSON=s=>JSON.parse(encodeGame(s)).game;
const objective=(s,id)=>s.mission.objectives.find(o=>o.id===id);
const own=(s,team,role)=>s.entities.filter(e=>e.team===team&&e.hp>0&&entityRole(e)===role);
const army=s=>s.entities.filter(e=>e.team===0&&e.kind==='unit'&&UNITS[e.type].damage>0);
function build(s,type){
  const core=own(s,0,'core')[0];
  for(let r=4;r<14;r++)for(let y=core.y-r;y<=core.y+r;y++)for(let x=core.x-r;x<=core.x+r;x++)if(canPlace(s,0,type,x,y).ok)return getEntity(s,placeBuilding(s,0,type,x,y).id);
  throw new Error(`No site for ${type}`);
}
const DRILL={width:144,height:112,mission:'drill'};

assert(Array.isArray(SKIRMISH_MODES)&&SKIRMISH_MODES[0].id==='annihilation'&&SKIRMISH_MODES.every(m=>m.name&&m.description));
assert.throws(()=>createGame('x','normal',{mission:'nope'}),RangeError);
assert.throws(()=>createGame('x','normal',{mission:7}),RangeError);
assert.throws(()=>createGame('x','normal',{mission:'constructor'}),RangeError,'Inherited keys are not missions');
// Skirmishes carry no mission state and keep every rule ungated.
{
  const s=createGame('skirmish','normal',{width:72,height:56});
  assert(!('mission' in s));assert.equal(missionOutcome(s),null);assert(missionAllows(s,0,'units','tank'));assert.equal(missionDirective(s,1),null);
  assert.equal(trainUnit(s,0,'tank').reason,'Requires War foundry');
}

// Every authored mission builds on every map size and is plain, cloneable data.
for(const id of Object.keys(MISSIONS))for(const {width,height} of Object.values(MAP_SIZES)){
  const s=createGame(`clone-${id}`,'normal',{width,height,mission:id});
  assert.deepEqual(structuredClone(s.mission),s.mission);assert.deepEqual(JSON.parse(JSON.stringify(s.mission)),s.mission);
  // Campaign operations fix their own sector size, so index by the game's width.
  assert(s.mission.zones.every(z=>z.x>=0&&z.y>=0&&z.x<=s.width&&z.y<=s.height&&!s.blocked[Math.floor(z.y)*s.width+Math.floor(z.x)]),'Zones sit on open ground');
  decodeGame(encodeGame(s));
}

// The drill: settings, objectives, gating, triggers and a complete operation.
const s=createGame('drill-check','normal',DRILL);
{
  assert.deepEqual(s.teams.map(t=>t.race),['organics','aiUnity']);assert.deepEqual(s.aiTeams,[]);assert.equal(s.teams[0].credits,1200);
  assert(!own(s,1,'core').length,'The rival keeps only its scripted picket');assert.equal(own(s,0,'core').length,1);
  assert.deepEqual(s.mission.objectives.map(o=>[o.id,o.state,o.revealed]),[['muster','active',true],['barracks','active',true],['recruits','active',true],['range','active',false],['shards','active',true],['depot','active',true]]);
  assert.deepEqual(s.mission.fired,{});assert.equal(s.mission.nextCheck,MISSION_INTERVAL);assert.equal(s.mission.startedAt,0);
  assert.equal(s.entities.filter(e=>e.tag==='picket').length,4);assert.equal(s.mission.counters['tagged:picket'],4);
  assert.equal(s.entities.filter(e=>e.tag==='depot').map(e=>e.type).join(),'refinery');
  assert.equal(s.mission.counters['trained:harvester'],undefined,'Opening haulers are not training');
  assert.equal(s.events.at(-1).kind,'opening');assert.equal(s.events.at(-1).text,MISSIONS.drill.opening);
  const {start,end}=mapLayout(s),muster=s.mission.zones.find(z=>z.id==='muster');
  assert(Math.abs(muster.x-(start.x+(end.x-start.x)*.22))<1e-9,'Lane points follow the base anchors');
  // The player is limited to the operation's roster; the rival and skirmish rules are not.
  const core=own(s,0,'core')[0];
  assert.equal(canPlace(s,0,'factory',core.x+5,core.y).reason,'Not authorized for this operation');
  assert.equal(canPlace(s,0,'lab',core.x+5,core.y).reason,'Not authorized for this operation');
  assert.equal(trainUnit(s,0,'tank').reason,'Not authorized for this operation');
  assert.equal(trainUnit(s,0,'rifle').reason,'Requires Field barracks','Authorized units keep their usual requirements');
  assert.equal(researchStatus(s,0,'infantryWeapons').reason,'Not authorized for this operation');
  assert.equal(buildingUpgradeStatus(s,0,own(s,0,'refinery')[0].id,'speed').reason,'Not authorized for this operation');
  assert.equal(trainUnit(s,1,'unityTank').reason,'Insufficient credits','The rival is never gated');assert(missionAllows(s,1,'units','tank'));
  assert.equal(trainUnit(s,0,'unityRifle').reason,'Unit belongs to a different race');
}
{
  advance(s,.3);
  const line=s.events.find(e=>e.kind==='dialogue');assert.equal(line.speaker,'Range control');assert.equal(line.team,0);assert(s.mission.fired.briefing);
  const muster=s.mission.zones.find(z=>z.id==='muster'),scouts=army(s);
  issueOrder(s,scouts.map(e=>e.id),{type:'move',x:muster.x,y:muster.y});
  for(let i=0;i<60&&objective(s,'muster').state==='active';i++)advance(s,.5);
  assert.equal(objective(s,'muster').state,'done');assert(objective(s,'muster').progress>=3);
  const done=s.events.find(e=>e.kind==='objective'&&e.objective==='muster');
  assert.equal(done.text,'Objective complete: Move three units to the muster point');assert.deepEqual([done.x,done.y],[muster.x,muster.y],'Zone objectives point at their static marker');
  advance(s,.3);const supply=s.events.find(e=>e.kind==='mission');assert.equal(supply.amount,300);
}
{
  const barracks=build(s,'barracks');
  for(let i=0;i<80&&objective(s,'barracks').state==='active';i++)advance(s,.5);
  assert.equal(objective(s,'barracks').state,'done');
  assert(trainUnit(s,0,'rifle',barracks.id).ok);assert(trainUnit(s,0,'rifle',barracks.id).ok);
  advance(s,4);assert.equal(objective(s,'recruits').progress,0);
}
// A save taken while the trigger is pending continues exactly through the scripted wave.
const pending=decodeGame(encodeGame(s)).game;
{
  for(let i=0;i<60&&objective(s,'recruits').state==='active';i++)advance(s,.5);
  assert.equal(objective(s,'recruits').state,'done');assert.equal(objective(s,'recruits').progress,2);
  advance(s,.3);
  assert(objective(s,'range').revealed&&s.mission.fired['live-fire']);
  const reveal=s.events.find(e=>e.kind==='objective'&&e.text==='New objective: Clear the target range');assert(reveal);
  const wave=s.events.find(e=>e.kind==='wave'),range=s.mission.zones.find(z=>z.id==='range'),muster=s.mission.zones.find(z=>z.id==='muster');
  assert.equal(wave.count,2);assert.deepEqual([wave.x,wave.y],[range.x,range.y],'Waves name only their static arrival zone');
  assert.equal(s.mission.counters['tagged:picket'],6,'Spawned skirmishers carry the tag');
  const skirmishers=s.entities.filter(e=>e.tag==='picket'&&e.kind==='unit'&&e.order.type==='attackMove');
  assert.equal(skirmishers.length,2);assert(skirmishers.every(e=>Math.hypot(e.order.x-muster.x,e.order.y-muster.y)<5),'The wave attack-moves on the muster point');
  const replay=s.time-pending.time;advance(pending,replay);
  assert.deepEqual(stateJSON(pending),stateJSON(s),'Mission state, triggers and spawns continue exactly after loading');
}
const midwave=decodeGame(encodeGame(s)).game;
{
  for(const e of s.entities)if(e.tag==='picket')e.hp=Math.min(e.hp,5);
  for(const e of midwave.entities)if(e.tag==='picket')e.hp=Math.min(e.hp,5);
  const range=s.mission.zones.find(z=>z.id==='range');
  for(const game of [s,midwave])issueOrder(game,army(game).map(e=>e.id),{type:'attackMove',x:range.x,y:range.y});
  for(let i=0;i<180&&s.status==='playing';i++)advance(s,.5);
  assert.equal(s.status,'victory');assert.equal(missionOutcome(s),'victory');
  assert.equal(objective(s,'range').state,'done');assert.equal(objective(s,'depot').state,'done','Protected assets that survive are complete at victory');
  assert.equal(s.events.at(-1).kind,'victory');assert.equal(s.events.at(-1).text,MISSIONS.drill.victoryText);
  advance(midwave,s.time-midwave.time+1);assert.equal(midwave.status,'victory');
  assert.deepEqual(stateJSON(midwave),stateJSON(s),'A save in the middle of the wave reaches the same victory');
  assert.equal(s.events.filter(e=>e.kind==='victory').length,1);
}

// Losing the nexus ends the operation in the same tick through the damage path.
{
  const d=createGame('drill-defeat','normal',DRILL),core=own(d,0,'core')[0];
  const tank=addEntity(d,1,'unit','unityTank',core.x+4.5,core.y+1.5);tank.cooldown=0;core.hp=1;
  for(let i=0;i<40&&d.status==='playing';i++)updateGame(d,.05);
  assert.equal(d.status,'defeat');assert(!getEntity(d,core.id));
  assert.equal(d.events.at(-1).kind,'defeat');assert.equal(d.events.at(-1).text,'All nexuses and construction vehicles lost. Operation failed.');
  assert.equal(d.events.at(-1).time,d.time,'Defeat is decided when the nexus falls');
}
// A secondary objective can fail without ending the operation.
{
  const d=createGame('drill-sale','normal',DRILL),depot=own(d,0,'refinery')[0];
  assert(sellBuilding(d,depot.id).ok);assert.equal(d.status,'playing');advance(d,.3);
  assert.equal(objective(d,'depot').state,'failed');assert.equal(d.events.find(e=>e.kind==='objectiveFailed').text,'Objective failed: Keep the refinery intact');assert.equal(d.status,'playing');
}

// Synthetic operations cover every objective type, fail rule, trigger condition and action.
MISSIONS['check-commando']={id:'check-commando',name:'Commando check',races:['organics','aiUnity'],aiTeams:[],start:['none','none'],
  zones:[{id:'relay',label:'Relay',at:'center',r:5},{id:'drop',label:'Drop zone',at:{at:'start',dx:4,dy:-4},r:4}],
  objectives:[{id:'relay',type:'destroyTagged',tag:'relay',label:'Destroy the relay'},{id:'claims',type:'annihilate',label:'No hostile claims'},{id:'vip',type:'protectTagged',tag:'vip',label:'Protect the courier'},{id:'hunt',type:'kills',count:1,secondary:true,label:'Score a kill'}],
  fail:[{type:'allUnitsLost'},{type:'tagLost',tag:'vip',label:'The courier'}],
  triggers:[{id:'contact',when:{zoneEntered:'relay'},do:[{directive:{team:1,attack:'drop',defend:{at:'relay',r:6},noExpand:true,waveSize:6}},{spawn:{team:0,units:[['rifle',1]],at:'drop'}}]},
    {id:'after',when:{tagDestroyed:'relay',time:1},do:[{say:{speaker:'Courier',text:'Relay down.'}}]}],
  setup(s,api){
    api.spawn(0,'rifle',3,'drop',{kills:5,stance:'defend'});api.tag(api.spawn(0,'scout',1,'drop'),'vip');
    api.spawn(1,'reactor',1,'relay',{tag:'relay'});api.spawn(1,'rifle',1,{at:'relay',dx:-3});
  },
};
{
  const c=createGame('commando','normal',{width:144,height:112,mission:'check-commando'});
  const squad=c.entities.filter(e=>e.team===0&&e.type==='rifle');
  assert.equal(squad.length,3);assert(squad.every(e=>e.kills===5&&e.maxHp===UNITS.rifle.hp*1.2&&e.stance==='defend'),'Veterans deploy with their rank');
  assert.equal(c.entities.find(e=>e.tag==='vip').type,'scout');assert.equal(own(c,1,'reactor')[0].tag,'relay');
  advance(c,.3);assert.equal(objective(c,'claims').state,'done','A rival without a claim is already annihilated');assert.equal(c.status,'playing');
  const relay=c.mission.zones.find(z=>z.id==='relay');
  issueOrder(c,squad.map(e=>e.id),{type:'move',x:relay.x,y:relay.y});
  for(let i=0;i<120&&!c.mission.fired.contact;i++)advance(c,.5);
  assert.deepEqual(Object.keys(missionDirective(c,1)).sort(),['attack','defend','noExpand','waveSize']);
  assert.equal(missionDirective(c,1).defend.r,6);assert.equal(missionDirective(c,1).waveSize,6);assert.equal(missionDirective(c,0),null);
  assert.equal(c.events.find(e=>e.kind==='mission').text,'Reinforcements have arrived.');
  const restored=decodeGame(encodeGame(c)).game;
  for(const game of [c,restored])issueOrder(game,game.entities.filter(e=>e.team===0&&e.type==='rifle').map(e=>e.id),{type:'attackMove',x:relay.x,y:relay.y});
  for(let i=0;i<240&&c.status==='playing';i++)advance(c,.5);
  assert.equal(c.status,'victory');assert(c.mission.fired.after);
  advance(restored,c.time-restored.time);assert.deepEqual(stateJSON(restored),stateJSON(c));
  // Fail rules, checked in order: losing every unit, or the protected courier, ends the operation at once.
  const lost=createGame('commando','normal',{width:144,height:112,mission:'check-commando'});
  lost.entities.find(e=>e.tag==='vip').hp=0;advance(lost,.3);
  assert.equal(lost.status,'defeat');assert.equal(lost.events.at(-1).text,'The courier lost. Operation failed.');
  const wiped=createGame('commando','normal',{width:144,height:112,mission:'check-commando'});
  for(const e of wiped.entities)if(e.team===0&&e.tag!=='vip')e.hp=0;
  const courier=wiped.entities.find(e=>e.tag==='vip'),hunter=addEntity(wiped,1,'unit','unityTank',courier.x+3,courier.y);hunter.cooldown=0;courier.hp=1;
  for(let i=0;i<40&&wiped.status==='playing';i++)updateGame(wiped,.05);
  assert.equal(wiped.status,'defeat');assert.equal(wiped.events.at(-1).text,'All field units lost. Operation failed.');
}
MISSIONS['check-economy']={id:'check-economy',name:'Economy check',races:['organics','organics'],aiTeams:[],credits:[9000,0],
  zones:[{id:'home',label:'Home',at:'start',r:6},{id:'field',label:'Field',at:'lane:0.3',r:5}],
  objectives:[{id:'nexus',type:'nexusInZone',zone:'home',label:'Hold the nexus'},{id:'mint',type:'deliver',amount:150,mineralType:1,label:'Deliver mint'},
    {id:'grid',type:'build',role:'reactor',count:2,label:'Two reactors'},{id:'study',type:'research',research:'infantryWeapons',label:'Research'},
    {id:'patrol',type:'reachZone',zone:'field',roles:['scout'],count:1,label:'Scout the field'},{id:'hold',type:'holdZone',zone:'field',seconds:2,label:'Hold the field'},
    {id:'wait',type:'survive',seconds:4,hidden:true,label:'Wait'}],
  fail:[{type:'coreLost'},{type:'timeLimit',seconds:400}],
  triggers:[{id:'later',when:{objectiveDone:'grid'},do:[{reveal:'wait'},{credits:50}]}],
};
{
  const e=createGame('economy','normal',{width:144,height:112,mission:'check-economy'});
  assert.equal(e.teams[0].credits,9000);advance(e,.3);assert.equal(objective(e,'nexus').state,'done');
  for(let i=0;i<120&&objective(e,'mint').state==='active';i++)advance(e,1);
  assert.equal(objective(e,'mint').state,'done');assert(e.mission.counters.delivered>=150&&e.mission.counters['delivered:1']===e.mission.counters.delivered);
  build(e,'reactor');advance(e,.3);assert.equal(objective(e,'grid').progress,1,'Construction sites do not count');
  for(let i=0;i<60&&objective(e,'grid').state==='active';i++)advance(e,.5);
  assert.equal(objective(e,'grid').state,'done');advance(e,.3);assert(objective(e,'wait').revealed);
  e.teams[0].research={infantryWeapons:true};
  const field=e.mission.zones.find(z=>z.id==='field'),scout=own(e,0,'scout')[0];
  issueOrder(e,[scout.id],{type:'move',x:field.x,y:field.y});
  for(let i=0;i<120&&e.status==='playing';i++)advance(e,.5);
  assert.equal(e.status,'victory');
  assert.deepEqual(e.mission.objectives.map(o=>o.state),Array(7).fill('done'));
  assert.equal(objective(e,'hold').progress,2);assert.equal(objective(e,'wait').progress,4);
  const late=createGame('economy-late','normal',{width:144,height:112,mission:'check-economy'});late.mission.startedAt=-399.8;advance(late,.3);
  assert.equal(late.status,'defeat');assert.equal(late.events.at(-1).text,'The operation window has closed. Operation failed.');
}

// Authoring errors are refused when the operation is created.
for(const broken of [
  {objectives:[]},{objectives:[{id:'a',type:'teleport',label:'x'}]},{objectives:[{id:'a',type:'holdZone',zone:'nowhere',seconds:5,label:'x'}]},
  {objectives:[{id:'a',type:'kills',count:1,label:'x'},{id:'a',type:'kills',count:2,label:'y'}]},
  {objectives:[{id:'a',type:'kills',count:1,label:'x'}],triggers:[{id:'t',when:{objectiveDone:'b'},do:[]}]},
  {objectives:[{id:'a',type:'kills',count:1,label:'x'}],triggers:[{id:'t',when:{},do:[{spawn:{units:[['dragon',1]]}}]}]},
  {objectives:[{id:'a',type:'kills',count:1,label:'x'}],triggers:[{id:'t',when:{},do:[{spawn:{units:[['rifle',1]],at:'nowhere'}}]}]},
  {objectives:[{id:'a',type:'kills',count:1,label:'x'}],fail:[{type:'boredom'}]},{objectives:[{id:'a',type:'build',role:'tank',label:'x'}]},
  {objectives:[{id:'a',type:'survive',label:'x'}]},{objectives:[{id:'a',type:'research',research:'magic',label:'x'}]},{objectives:[{id:'a',type:'kills',label:'x'}]},
  {objectives:[{id:'a',type:'kills',count:1,label:'x'}],allow:{units:['dragon']}},{objectives:[{id:'a',type:'kills',count:1,label:'x'}],fail:[{type:'tagLost'}]},
  {objectives:[{id:'a',type:'deliver',amount:5,mineralType:4,label:'x'}]},{objectives:[{id:'a',type:'kills',count:1,label:'x'}],zones:[{id:'z',label:'',at:'center',r:3}]},
]){MISSIONS['check-broken']={id:'check-broken',...broken};assert.throws(()=>createGame('broken','normal',{width:72,height:56,mission:'check-broken'}),/Mission check-broken/);}
delete MISSIONS['check-broken'];

// Mission progress is validated when loading.
{
  const raw=encodeGame(createGame('validate','normal',DRILL));decodeGame(raw);
  for(const corrupt of [
    m=>{m.id='nope';},m=>{m.objectives.pop();},m=>{m.objectives[0].id='other';},m=>{m.objectives[0].state='won';},m=>{m.objectives[0].progress=-1;},
    m=>{m.objectives[0].revealed=1;},m=>{m.fired.unknown=true;},m=>{m.fired.briefing=1;},m=>{m.zones[0].x=1e6;},m=>{m.zones.push({...m.zones[0]});},
    m=>{m.zones[0].label='';},m=>{m.counters.delivered=-5;},m=>{m.counters=[];},m=>{m.nextCheck=99;},m=>{m.startedAt=50;},m=>{m.score=-1;},
    m=>{m.directives={2:{attack:null,defend:null,noExpand:false}};},m=>{m.directives={1:{attack:{x:-4,y:1},defend:null,noExpand:false}};},m=>{m.directives={1:{attack:null,defend:null,noExpand:'yes'}};},
  ]){const broken=JSON.parse(raw);corrupt(broken.game.mission);assert.throws(()=>decodeGame(JSON.stringify(broken)),'Mission progress is validated');}
  const tagged=JSON.parse(raw);tagged.game.entities[0].tag=7;assert.throws(()=>decodeGame(JSON.stringify(tagged)));
}

// Identical commands give identical operations.
{
  const run=()=>{const d=createGame('drill-twin','hard',DRILL);advance(d,2);issueOrder(d,army(d).map(e=>e.id),{type:'attackMove',...d.mission.zones[1]});advance(d,60);return d;};
  assert.deepEqual(stateJSON(run()),stateJSON(run()),'Missions are deterministic');
}

console.log('Ashline mission checks passed: drill objectives, triggers, dialogue, supply, scripted waves and victory; same-tick nexus defeat; secondary failure; every objective type, fail rule, trigger and directive; gating reasons; authoring validation; save validation and exact continuation; cloneable state.');
