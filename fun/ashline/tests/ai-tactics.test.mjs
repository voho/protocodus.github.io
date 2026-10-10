// Commander tactics on small cleared fields: waves, Lanchester regroups, focus fire, counters, shelling,
// hauler raids, siege stand-off, walls, abilities, mission directives and fog-fair site choice. Every
// behaviour also gets a fog check: concealed forces and projectile origins must not change a decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,updateGame,issueOrder,UNITS,BUILDINGS,raceUnit,raceBuilding,buildingRole,entityRole,unitStats,center,addEntity} from '../sim.js';
import {aiKnobs} from '../ai.js';
import {encodeGame,decodeGame} from '../save.js';

function scene({race='organics',difficulty='hard',doctrine,seed='ai-tactics'}={}){
  const s=createGame(seed,difficulty,{width:72,height:56,races:[race,race],aiTeams:[1],...(doctrine?{aiProfiles:{1:{doctrine}}}:{})});
  const template=structuredClone(s.entities.find(e=>e.kind==='unit'));
  const core=s.entities.find(e=>e.team===1&&buildingRole(e)==='core'),enemyCore=s.entities.find(e=>e.team===0&&buildingRole(e)==='core');
  s.entities=s.entities.filter(e=>e===core||e===enemyCore);
  Object.assign(core,{x:60,y:6});Object.assign(enemyCore,{x:4,y:46});
  s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.navVersion++;
  s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));
  s.teams.forEach(t=>t.credits=0);Object.assign(s.ai,{nextThink:0,nextRaid:1e4,nextExpand:1e4,scoutIndex:0});
  const unit=(role,x,y,team=1)=>{
    const type=raceUnit(s,team,role),d=UNITS[type];
    const e={...structuredClone(template),id:s.nextId++,team,type,x,y,size:d.size,hp:d.hp,maxHp:d.hp,angle:0,cooldown:1000,order:{type:'idle'},path:[],repath:0,kills:0,tech:[]};
    if(role==='harvester')Object.assign(e,{cargo:0,unload:0,unloadDepotId:null,harvestPhase:'gather',order:{type:'harvest'}});
    s.entities.push(e);return e;
  };
  const building=(role,x,y,team=1)=>{
    const type=raceBuilding(s,team,role),d=BUILDINGS[type];
    const e={...structuredClone(core),id:s.nextId++,team,type,x,y,size:d.size,hp:d.hp,maxHp:d.hp,queue:[],cooldown:1000,progress:1};delete e.rally;
    s.entities.push(e);s.navVersion++;return e;
  };
  const remember=(e,seenAt=s.time)=>{const c=center(e);s.ai.known[e.id]={id:e.id,kind:e.kind,type:e.type,x:c.x,y:c.y,hp:e.hp,seenAt};};
  // A small shard field the commander has already recorded.
  const field=(x,y,seenAt=0)=>{for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++){s.minerals[yy*s.width+xx]=4000;s.mineralTypes[yy*s.width+xx]=1;}(s.ai.miningSites??=[]).push({x:x+.5,y:y+.5,amount:4000,seenAt});};
  return {s,core,enemyCore,unit,building,remember,field};
}
// One commander look with full vision, except the cells of the listed hidden entities.
function think(s,hidden=[]){
  s.ai.nextThink=s.time;s.fogClock=.2;s.visible.forEach(v=>v.fill(1));
  for(const e of hidden){
    if(e.kind==='building'){for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)s.visible[1][y*s.width+x]=0;}
    else{const c=center(e);s.visible[1][Math.floor(c.y)*s.width+Math.floor(c.x)]=0;}
  }
  updateGame(s,.05);
}
const orders=s=>s.entities.filter(e=>e.kind==='unit'&&e.team===1).map(e=>({id:e.id,order:e.order}));
const snapshot=s=>JSON.parse(encodeGame(s)).game;

test('a wave launches together, then chains to the next remembered objective from where it stands',()=>{
  const {s,unit,building,remember}=scene();
  const wave=Array.from({length:6},(_,i)=>unit('tank',52+i%3*1.4,13+Math.floor(i/3)*1.4));
  const refinery=building('refinery',30,30,0),reactor=building('reactor',16,30,0);remember(refinery);remember(reactor);
  s.ai.nextRaid=0;think(s);
  const plan=s.ai.waves?.[0];
  assert(plan&&plan.kind==='raid'&&plan.ids.length===6,'Staged units form one wave');
  assert.equal(s.ai.raid,1);
  assert(wave.every(u=>u.order.type==='attackMove'&&u.order.speedLimit===Math.min(...wave.map(w=>unitStats(w).speed))),'The wave shares the slowest member pace');
  const first=plan.targetId,other=first===refinery.id?reactor:refinery;
  // The first objective is destroyed where the wave can see it: memory drops it, and the wave moves on.
  s.entities=s.entities.filter(e=>e.id!==first);delete s.ai.known[first];s.navVersion++;
  for(const u of wave){u.x-=14;u.y+=12;}
  think(s);
  assert.equal(s.ai.waves[0].targetId,other.id,'The surviving wave takes the next objective');
  assert(wave.every(u=>u.order.type==='attackMove'&&Math.hypot(u.order.formation.x-center(other).x,u.order.formation.y-center(other).y)<.5),'It heads there instead of returning to the rally');
});

test('an outmatched wave regroups forward, merges reinforcements and never pauses the commander',()=>{
  const {s,unit,building,remember}=scene();
  const wave=Array.from({length:4},(_,i)=>unit('rifle',22+i,32));
  const target=building('refinery',8,40,0);remember(target);
  s.ai.waves=[{id:1,kind:'raid',ids:wave.map(u=>u.id),tx:center(target).x,ty:center(target).y,targetId:target.id,state:'advance',since:0}];s.ai.waveId=1;
  for(let i=0;i<8;i++)unit('tank',14+i%4*1.2,38+Math.floor(i/4)*1.2,0);
  think(s);
  const plan=s.ai.waves[0];
  assert.equal(plan.state,'regroup','Visible superior force sends the wave to a regroup point');
  assert(wave.every(u=>u.order.type==='move'),'Members disengage');
  assert(Math.hypot(plan.rx-23.5,plan.ry-32)>8&&Math.hypot(plan.rx-53.85,plan.ry-13.65)>10,'The regroup point lies away from the contact, short of the home rally');
  assert.equal(s.ai.regroupUntil,undefined,'No global pause');
  // The wave reaches its regroup point, out of contact; fresh units are staged at the rally.
  wave.forEach((u,i)=>{u.x=plan.rx+i*.9-1.3;u.y=plan.ry;});
  const reinforcements=Array.from({length:3},(_,i)=>unit('tank',53+i*1.4,14));
  think(s);
  assert.equal(s.ai.waves[0].state,'regroup','Still too weak to return');
  assert(reinforcements.every(u=>s.ai.waves[0].ids.includes(u.id)),'Fresh units at the rally join the regrouping wave');
  assert(reinforcements.every(u=>u.order.type==='attackMove'&&Math.hypot(u.order.formation.x-s.ai.waves[0].rx,u.order.formation.y-s.ai.waves[0].ry)<.5),'and travel to its regroup point');
});

test('hidden forces never change wave decisions',()=>{
  const build=hiddenForce=>{
    const f=scene(),wave=Array.from({length:5},(_,i)=>f.unit('tank',36+i,26)),target=f.building('refinery',14,36,0);f.remember(target);
    f.s.ai.waves=[{id:1,kind:'raid',ids:wave.map(u=>u.id),tx:center(target).x,ty:center(target).y,targetId:target.id,state:'advance',since:0}];f.s.ai.waveId=1;
    const hidden=hiddenForce?Array.from({length:10},(_,i)=>f.unit('tank',30+i%5,31+Math.floor(i/5),0)):[];
    think(f.s,hidden);return f.s;
  };
  const a=build(false),b=build(true);
  assert.deepEqual(orders(a),orders(b),'Concealed tanks next to the wave do not affect its orders');
  assert.deepEqual(a.ai.waves,b.ai.waves);
});

test('Veteran focus fire caps attackers per target and prefers dangerous wounded targets',()=>{
  const {s,unit,building,remember}=scene();
  const wave=Array.from({length:8},(_,i)=>unit('tank',30+i%4*1.2,24+Math.floor(i/4)*1.2));
  const target=building('refinery',8,40,0);remember(target);
  s.ai.waves=[{id:1,kind:'raid',ids:wave.map(u=>u.id),tx:center(target).x,ty:center(target).y,targetId:target.id,state:'advance',since:0}];s.ai.waveId=1;
  const gun=unit('artillery',27,29,0),fresh=unit('rifle',29,30,0),hurt=unit('rifle',31,30,0);hurt.hp=20;
  think(s);
  const cap=aiKnobs(s,s.ai).focus,load=new Map();
  for(const u of wave)if(u.order.type==='attack')load.set(u.order.targetId,(load.get(u.order.targetId)||0)+1);
  assert(cap>0&&[...load.values()].every(n=>n<=cap),'No target draws more than the focus cap');
  assert(load.get(gun.id)>0&&load.get(hurt.id)>0,'The siege gun and the wounded squad are focused');
  assert(!load.has(fresh.id)||load.get(fresh.id)<=load.get(hurt.id),'A healthy screen is not preferred over a wounded one');
  const before=structuredClone(orders(s));think(s);
  assert.deepEqual(orders(s).filter(o=>o.order.type==='attack'),before.filter(o=>o.order.type==='attack'),'Valid assignments are kept between looks');
});

test('focus fire and production ignore concealed enemies',()=>{
  const focus=hiddenForce=>{
    const {s,unit,building,remember}=scene();
    const wave=Array.from({length:8},(_,i)=>unit('tank',30+i%4*1.2,24+Math.floor(i/4)*1.2));
    const target=building('refinery',8,40,0);remember(target);
    s.ai.waves=[{id:1,kind:'raid',ids:wave.map(u=>u.id),tx:center(target).x,ty:center(target).y,targetId:target.id,state:'advance',since:0}];s.ai.waveId=1;
    unit('artillery',27,29,0);const hurt=unit('rifle',31,30,0);hurt.hp=20;
    const hidden=hiddenForce?[unit('artillery',28,31,0),unit('rocket',29,27,0),unit('tank',26,26,0)]:[];
    think(s,hidden);return orders(s);
  };
  assert.deepEqual(focus(true),focus(false),'Concealed artillery and rockets beside the fight draw no attackers');
  const recruit=hiddenForce=>{
    const {s,unit,building,remember}=scene({seed:'counter-fog'});
    building('barracks',50,4);building('factory',54,12);building('reactor',57,11);s.teams[1].credits=4000;
    for(let i=0;i<6;i++)remember(unit('rifle',10+i,40,0));
    const hidden=hiddenForce?Array.from({length:10},(_,i)=>unit('tank',12+i,44,0)):[];
    think(s,hidden);return s.entities.filter(e=>e.team===1&&e.queue).map(e=>e.queue.map(q=>q.type));
  };
  assert.deepEqual(recruit(true),recruit(false),'An unseen armored column does not change what is recruited');
});

test('Commander balanced commanders do not micro focus fire',()=>{
  const {s,unit,building,remember}=scene({difficulty:'normal'});
  const wave=Array.from({length:8},(_,i)=>unit('tank',30+i%4*1.2,24+Math.floor(i/4)*1.2));
  const target=building('refinery',8,40,0);remember(target);
  s.ai.waves=[{id:1,kind:'raid',ids:wave.map(u=>u.id),tx:center(target).x,ty:center(target).y,targetId:target.id,state:'advance',since:0}];s.ai.waveId=1;
  unit('artillery',27,29,0);unit('rifle',29,30,0);
  think(s);
  assert(wave.every(u=>u.order.type==='attackMove'));
});

test('production counters the remembered enemy force',()=>{
  const mix=enemyRole=>{
    const {s,unit,building,remember}=scene({seed:`counter-${enemyRole}`});
    building('barracks',50,6);building('reactor',56,12);
    s.teams[1].credits=4000;
    for(let i=0;i<10;i++)remember(unit(enemyRole,10+i,40,0));
    think(s);
    const queue=s.entities.find(e=>e.team===1&&buildingRole(e)==='barracks').queue.map(q=>entityRole(q.type));
    return queue;
  };
  const versusInfantry=mix('rifle'),versusArmor=mix('tank');
  assert(versusArmor.includes('rocket'),'Remembered armor brings rocket teams');
  assert(!versusInfantry.includes('rocket'),'Rockets are not wasted on a remembered infantry screen');
});

test('shelling from concealment is answered along the bearing, using only impacts the commander sees',()=>{
  const build=variant=>{
    const f=scene(),{s,unit}=f;
    const staged=Array.from({length:6},(_,i)=>unit(i<4?'tank':'rifle',50+i%3*1.4,16+Math.floor(i/3)*1.4)),scout=unit('scout',56,12);
    // The struck side of the formation faces the hidden battery to the south-west.
    const hidden=unit('artillery',40,26,0);
    for(const look of [0,1]){
      if(variant!=='quiet')for(const u of staged.slice(0,2)){u.lastHit=s.time;u.attackerId=hidden.id;u.hp-=30;}
      if(variant==='fog')for(const u of staged.slice(0,2)){delete u.lastHit;u.hp=u.maxHp;}
      const origin=variant==='moved'?{x:20,y:50}:{x:40,y:26};
      if(variant!=='quiet')s.effects.push({type:'shell',weapon:'artillery',x:origin.x,y:origin.y,tx:variant==='fog'?30:50.5,ty:variant==='fog'?40:16.5,life:.35,maxLife:.35,team:0});
      // In the fog variant the shell lands in ground the commander does not see.
      const hide=variant==='fog'?[hidden,{kind:'unit',x:30,y:40}]:[hidden];
      think(s,hide);
      if(!look)assert(!s.ai.shelled?.answered,'One look is not yet a confirmed bombardment');
    }
    return {s,scout};
  };
  const {s,scout}=build('shelled');
  assert(s.ai.shelled?.answered!==undefined,'Fire from concealment is confirmed');
  assert(s.ai.shelled.bx<0&&s.ai.shelled.by>0,'The bearing points toward the struck flank');
  const response=s.ai.waves?.find(w=>w.kind==='response');
  assert(response&&response.ids.length>=3,'Fast units form a response along the bearing');
  assert(scout.order.type==='move'||s.reveals?.some(r=>r.team===1),'A rover moves to spot, or a flare lights the bearing');
  const moved=build('moved').s;
  assert.deepEqual(orders(moved),orders(s),'A different concealed origin cannot change the answer');
  assert.deepEqual(moved.ai.shelled,s.ai.shelled);
  const fog=build('fog').s,quiet=build('quiet').s;
  assert.deepEqual(orders(fog),orders(quiet),'Shells landing in unseen ground change nothing');
  assert.equal(fog.ai.shelled,undefined);
});

test('a raider squad hunts only haulers it can see and leaves superior force',()=>{
  const build=({visible=true,hiddenHauler=false,guards=false}={})=>{
    const f=scene({doctrine:'swarm',difficulty:'normal'}),{s,unit,building,remember,field}=f;
    s.time=120;const depot=building('refinery',8,36,0);remember(depot);field(16,42,60);
    unit('scout',57,10);const squad=[unit('scout',53,14),unit('scout',54.5,14),unit('scout',56,14)];
    think(s);
    const plan=s.ai.harass;
    assert(plan&&plan.state==='hunt'&&squad.every(u=>plan.ids.includes(u.id)),'Fast idle units form the raid');
    assert(squad.every(u=>u.order.type==='move'),'The squad travels by move orders, not into every fight on the way');
    squad.forEach((u,i)=>{u.x=17+i;u.y=40;});
    const prey=unit('harvester',19,44,0),hidden=hiddenHauler?[prey]:[];
    if(!visible)hidden.push(prey);
    if(guards)for(let i=0;i<5;i++)unit('tank',15+i,37,0);
    think(s,hidden);
    return {s,squad,prey};
  };
  const hunt=build();
  assert(hunt.squad.every(u=>u.order.type==='attack'&&u.order.targetId===hunt.prey.id),'Every raider fires on the visible hauler');
  const blind=build({visible:false});
  assert(blind.squad.every(u=>u.order.type!=='attack'),'A hauler under fog is never targeted');
  const quiet=build({visible:false});
  assert.deepEqual(orders(blind.s),orders(quiet.s));
  const guarded=build({guards:true});
  assert.equal(guarded.s.ai.harass.state,'return','Superior visible guards end the raid');
  assert(guarded.squad.every(u=>u.order.type==='move'));
});

test('haulers attacked far from any structure still get defenders',()=>{
  const build=hit=>{
    const {s,unit}=scene();
    const hauler=unit('harvester',24,22),raider=unit('rifle',25,25,0),reserve=[unit('tank',52,14),unit('tank',54,14)];
    if(hit){hauler.lastHit=s.time;hauler.attackerId=raider.id;}
    think(s);return {reserve,raider,hauler};
  };
  const attacked=build(true),passing=build(false);
  assert(attacked.reserve.some(u=>u.order.type==='attack'&&u.order.targetId===attacked.raider.id),'A reserve answers the hauler raid');
  assert(passing.reserve.every(u=>u.order.type!=='attack'),'A rifle that never fired on the hauler is left alone');
});

test('siege guns stand off beyond a remembered tower while a rover spots it',()=>{
  const {s,unit,building,remember}=scene({doctrine:'siegebreaker'});
  const tower=building('rocketTower',20,32,0),target=building('refinery',12,38,0);remember(tower);remember(target);
  const guns=[unit('artillery',33,24),unit('artillery',34,25)],escort=Array.from({length:4},(_,i)=>unit('tank',32+i,22));
  const scout=unit('scout',52,14);
  s.ai.waves=[{id:1,kind:'raid',ids:[...guns,...escort].map(u=>u.id),tx:center(target).x,ty:center(target).y,targetId:target.id,state:'advance',since:0}];s.ai.waveId=1;
  for(const u of guns)u.abilityReadyAt=1e9;
  think(s,[tower]);
  const at=center(tower),range=BUILDINGS[tower.type].range;
  assert.equal(s.ai.waves[0].siege,tower.id,'The wave sets up against the remembered tower');
  for(const u of guns){const d=Math.hypot(u.order.x-at.x,u.order.y-at.y);assert(u.order.type==='move'&&d>range+.5&&d<=UNITS.artillery.range,`Guns park inside their reach and outside the tower's (${d.toFixed(2)})`);}
  for(const u of escort)assert(Math.hypot(u.order.formation.x-at.x,u.order.formation.y-at.y)>range+2,'The escort holds outside the tower reach');
  assert(s.ai.intel.spot&&Math.hypot(s.ai.intel.spot.x-at.x,s.ai.intel.spot.y-at.y)>range&&scout.order.type==='move','A rover moves to spot from beyond the tower reach');
  think(s);
  assert(guns.every(u=>u.order.type==='attack'&&u.order.targetId===tower.id),'Once spotted, the guns engage the tower directly');
});

test('abilities fire on what is seen: overdrive, dig in, field patch and barrage',()=>{
  const {s,unit,building,remember}=scene();
  s.teams[1].credits=2000;
  const target=building('refinery',8,40,0);remember(target);
  const tanks=[unit('tank',30,24),unit('tank',31,24),unit('tank',30,25.5)];
  s.ai.waves=[{id:1,kind:'raid',ids:tanks.map(u=>u.id),tx:center(target).x,ty:center(target).y,targetId:target.id,state:'advance',since:0}];s.ai.waveId=1;
  unit('rifle',21,30,0);
  // Rifles holding a forward regroup point, with a lone enemy squad in reach.
  const rifles=[unit('rifle',40,10),unit('rifle',41,10),unit('rifle',40,11),unit('rifle',41,11)];unit('rifle',41,15.5,0);
  s.ai.waves.push({id:2,kind:'raid',ids:rifles.map(u=>u.id),tx:center(target).x,ty:center(target).y,targetId:target.id,state:'regroup',since:0,rx:40.5,ry:10.5,need:1e4,tries:1});s.ai.waveId=2;
  const engineer=unit('engineer',58,16),hurt=unit('tank',59,16);hurt.hp=hurt.maxHp*.4;
  const gun=unit('artillery',44,40);for(const [x,y] of [[36,46],[36.6,46.4],[35.6,46.6],[36.2,45.6]])unit('rifle',x,y,0);
  think(s);
  assert(tanks.some(u=>u.abilityUntil>s.time),'Advancing tanks overdrive toward a visible enemy just out of reach');
  assert(rifles.every(u=>u.abilityUntil>s.time),'Rifles holding a regroup point dig in against a threat in reach');
  assert(hurt.hp>hurt.maxHp*.6,'The engineer patches a badly damaged tank');
  assert(gun.barrage&&Math.hypot(gun.barrage.x-36,gun.barrage.y-46)<1.5,'The siege gun barrages the visible cluster');
});

test('barrages never go into concealed clusters and Cadets use no abilities',()=>{
  const {s,unit}=scene();
  const gun=unit('artillery',44,40),cluster=[unit('rifle',36,46,0),unit('rifle',36.6,46.4,0),unit('rifle',35.6,46.6,0)];
  think(s,cluster);
  assert.equal(gun.barrage,undefined,'Hidden infantry cannot be barraged');
  const cadet=scene({difficulty:'easy'}),rifles=[cadet.unit('rifle',53,14),cadet.unit('rifle',54,14)];cadet.unit('rifle',55,19.5,0);
  think(cadet.s);
  assert(rifles.every(u=>u.abilityUntil===undefined),'Cadet commanders never use abilities');
});

function directiveScene(directive){
  const s=createGame('directive-check','hard',{width:72,height:56,mission:'drill'});
  s.aiTeams=[1];Object.assign(s.ai,{nextThink:0,nextRaid:0});
  s.mission.directives={1:{attack:null,defend:null,noExpand:false,...directive}};
  const units=Array.from({length:6},(_,i)=>addEntity(s,1,'unit',raceUnit(s,1,'tank'),40+i%3*1.4,20+Math.floor(i/3)*1.4));
  return {s,units};
}
test('mission directives steer the commander: attack point, wave size and defended zone',()=>{
  const {s}=directiveScene({attack:{x:12.5,y:40.5},waveSize:4});
  updateGame(s,.05);
  const wave=s.ai.waves?.[0];
  assert(wave&&wave.ids.length===4,'The directive wave size sets the wave');
  assert.deepEqual([wave.tx,wave.ty],[12.5,40.5],'Waves go to the directed attack point');
  const hold=directiveScene({defend:{x:30.5,y:30.5,r:6}});
  updateGame(hold.s,.05);
  assert.equal(hold.s.ai.waves,undefined,'A defend-only directive launches no raids');
  assert(hold.units.every(u=>u.order.type==='attackMove'&&Math.hypot(u.order.formation.x-30.5,u.order.formation.y-30.5)<.5),'The force holds the defended zone');
});

test('noExpand directives stop nexus expansion, and a depleted army postpones it',()=>{
  const plan=noExpand=>{
    const {s,unit,building,field}=scene();
    for(let i=0;i<6;i++)unit('tank',52+i*1.2,14);
    s.mission=createGame('directive-check','hard',{width:72,height:56,mission:'drill'}).mission;s.mission.directives={1:{attack:null,defend:null,noExpand}};
    building('barracks',50,4);building('factory',54,12);building('reactor',57,11);s.teams[1].credits=5000;
    s.ai.nextExpand=0;field(30,30);
    think(s);return s.ai.expansion;
  };
  assert(plan(false),'Without the directive the commander plans an expansion');
  assert.equal(plan(true),undefined,'noExpand holds it back');
  const {s,building,field}=scene();
  building('barracks',50,4);building('factory',54,12);building('reactor',57,11);s.teams[1].credits=1500;s.ai.nextExpand=0;field(30,30);
  think(s);
  assert.equal(s.ai.expansion,undefined,'With no army left and a thin treasury the commander rebuilds before it expands');
});

test('expansion sites ignore concealed enemy structures but respect remembered ones',()=>{
  const plan=variant=>{
    const {s,unit,building,remember,field}=scene();
    for(let i=0;i<6;i++)unit('tank',52+i*1.2,14);
    building('barracks',50,4);building('factory',54,12);building('reactor',57,11);s.teams[1].credits=5000;
    s.ai.nextExpand=0;field(30,30);
    const intruder=variant==='open'?null:building('refinery',24,26,0);
    if(variant==='remembered')remember(intruder);
    // The field was explored earlier; the ground around it is not in current vision.
    s.ai.nextThink=s.time;s.fogClock=.2;s.visible.forEach(v=>v.fill(1));
    for(let y=16;y<44;y++)for(let x=14;x<46;x++)s.visible[1][y*s.width+x]=0;
    updateGame(s,.05);
    return s.ai.expansion&&{x:s.ai.expansion.x,y:s.ai.expansion.y};
  };
  const open=plan('open'),hidden=plan('hidden'),remembered=plan('remembered');
  assert(open,'A site is chosen on explored ground');
  assert.deepEqual(hidden,open,'An unseen enemy refinery on the chosen ground changes nothing');
  assert.notDeepEqual(remembered,open,'A remembered enemy structure is avoided');
});

test('expansion sites read ore under fog from the generated layout, never from live amounts',()=>{
  const plan=minedUnseen=>{
    const {s,unit,building}=scene();
    for(let i=0;i<6;i++)unit('tank',52+i*1.2,14);
    building('barracks',50,4);building('factory',54,12);building('reactor',57,11);s.teams[1].credits=5000;s.ai.nextExpand=0;
    // A broad field, explored earlier, with one clearing on its far side; the commander recorded its richest cell.
    for(let y=21;y<=39;y++)for(let x=21;x<=39;x++)if(!(x>=22&&x<=25&&y>=34&&y<=37)){s.minerals[y*s.width+x]=4000;s.mineralTypes[y*s.width+x]=1;}
    s.ai.miningSites=[{x:30.5,y:30.5,amount:4000,seenAt:0}];
    // The quarter facing the commander's base was mined out while nobody on its side could see it.
    if(minedUnseen)for(let y=21;y<=30;y++)for(let x=31;x<=39;x++)s.minerals[y*s.width+x]=0;
    s.ai.nextThink=s.time;s.fogClock=.2;s.visible.forEach(v=>v.fill(1));
    for(let y=14;y<46;y++)for(let x=12;x<48;x++)s.visible[1][y*s.width+x]=0;
    updateGame(s,.05);
    return {s,site:s.ai.expansion&&{x:s.ai.expansion.x,y:s.ai.expansion.y}};
  };
  const intact=plan(false),mined=plan(true);
  assert(intact.site&&intact.site.x>=22&&intact.site.x<=23&&intact.site.y>=34&&intact.site.y<=35,'The site is the clearing the commander saw');
  assert.deepEqual(mined.site,intact.site,'Ore mined out under fog changes nothing');
  for(let y=intact.site.y;y<intact.site.y+3;y++)for(let x=intact.site.x;x<intact.site.x+3;x++)assert.equal(intact.s.mineralTypes[y*intact.s.width+x],0,'The planned nexus stays off generated ore');
});

test('a wave outmatched only by a remembered tower regroups at a real point and stays saveable',()=>{
  for(const difficulty of ['normal','hard']){
    const {s,unit,remember}=scene({difficulty});
    const tower=addEntity(s,0,'building',raceBuilding(s,0,'rocketTower'),20,32);tower.progress=1;remember(tower);
    const wave=[unit('rifle',28,26),unit('rifle',29,26)];
    s.ai.waves=[{id:1,kind:'raid',ids:wave.map(u=>u.id),tx:8,ty:44,state:'advance',since:0}];s.ai.waveId=1;
    think(s,[tower]);
    const plan=s.ai.waves[0],c=center(tower);
    assert.equal(plan.state,'regroup',`${difficulty}: the remembered tower outweighs the wave`);
    assert(Number.isFinite(plan.rx)&&Number.isFinite(plan.ry),`${difficulty}: the regroup point is a real position`);
    assert(Math.hypot(plan.rx-c.x,plan.ry-c.y)>Math.hypot(28.5-c.x,26-c.y),`${difficulty}: it falls back away from the tower`);
    assert(wave.every(u=>u.order.type==='move'&&Number.isFinite(u.order.x)&&Math.hypot(u.order.x-plan.rx,u.order.y-plan.ry)<3),`${difficulty}: members head for it`);
    const restored=decodeGame(encodeGame(s)).game;
    assert.deepEqual(restored.ai.waves,s.ai.waves,`${difficulty}: the plan saves and loads`);
    // Gathered there and given time, the wave leaves the regroup instead of absorbing the army forever.
    wave.forEach((u,i)=>{u.x=plan.rx+i*.9;u.y=plan.ry;u.order={type:'idle'};});s.time+=55;
    think(s,[tower]);
    assert.notEqual(s.ai.waves?.[0]?.state,'regroup',`${difficulty}: the wave moves on once gathered`);
    decodeGame(encodeGame(s));
  }
});

test('a commander without a nexus keeps thinking: its rover re-scouts and its vehicle redeploys',()=>{
  const {s,core,enemyCore,unit,remember,field}=scene();
  s.entities=s.entities.filter(e=>e!==core);s.navVersion++;
  const tower=addEntity(s,0,'building','turret',10,40);tower.progress=1;remember(enemyCore);remember(tower);
  field(40,16,5);
  const vehicle=unit('constructor',54,10),scout=unit('scout',56,12);s.ai.intel={index:0,next:0};
  think(s,[enemyCore,tower]);
  const route=s.ai.intel.route;
  assert(route?.length&&route.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),'The rover plans its re-scouting route from the rally');
  assert(route.every(p=>Math.hypot(p.x-center(tower).x,p.y-center(tower).y)>BUILDINGS.turret.range+1),'and still stands off from remembered towers');
  assert.equal(scout.order.type,'move');
  assert(s.ai.expansion?.unitId===vehicle.id&&vehicle.order.type==='move','The vehicle heads for the nearest known field');
  for(let i=0;i<4*90&&!s.entities.some(e=>e.team===1&&entityRole(e)==='core');i++)updateGame(s,.25);
  const nexus=s.entities.find(e=>e.team===1&&entityRole(e)==='core');
  assert(nexus&&Math.hypot(center(nexus).x-40.5,center(nexus).y-16.5)<11,'It redeploys a nexus beside that field');
  assert.equal(s.status,'playing');
  decodeGame(encodeGame(s));
});

test('the commander keeps producing while it saves for an expansion, and drops the saving under attack',()=>{
  const build=({threat=false,saving=0}={})=>{
    const {s,unit,building}=scene();
    building('barracks',50,4);building('factory',54,12);building('reactor',57,11);building('refinery',62,12);
    for(let i=0;i<6;i++)unit('rifle',52+i,14);for(let i=0;i<3;i++)unit('harvester',63+i,17);unit('scout',57,12);
    s.teams[1].credits=1000;s.time=200;
    s.ai.expansion={x:30,y:30,oreX:32.5,oreY:34.5,startedAt:200-saving,lastProgressAt:200,lastX:60,lastY:8};
    if(threat){const raider=unit('rifle',58,10,0);raider.cooldown=1000;}
    think(s);
    return {s,queued:s.entities.filter(e=>e.team===1&&e.queue).reduce((n,e)=>n+e.queue.filter(q=>UNITS[q.type].damage).length,0)};
  };
  const early=build();
  assert(early.queued>0,'Units are still recruited while the vehicle is being saved for');
  assert(early.s.teams[1].credits>=1800*.35-1e-6,'The vehicle reserve is kept');
  const late=build({saving:60});
  assert.equal(late.queued,0,'After a long save the full price is held back');
  const pressed=build({saving:60,threat:true});
  assert(pressed.queued>0,'An attack on the base releases the saving');
});

test('scouting: re-scout routes stand off from towers, damaged rovers repair and lost rovers are replaced',()=>{
  const {s,unit,building,remember,enemyCore,field}=scene();
  remember(enemyCore);const tower=building('turret',10,42,0);remember(tower);field(30,44,5);
  const scout=unit('scout',54,14);s.ai.intel={index:0,next:0};
  think(s,[enemyCore,tower]);
  const route=s.ai.intel.route;
  assert(route?.length>=2,'A re-scouting route covers the enemy main and remembered fields');
  for(const p of route)assert(Math.hypot(p.x-center(tower).x,p.y-center(tower).y)>BUILDINGS.turret.range+1,'Route points stay outside remembered tower reach');
  assert.equal(scout.order.type,'move');
  scout.hp=scout.maxHp*.4;think(s,[enemyCore,tower]);
  assert(s.ai.intel.repair&&scout.order.type==='move'&&Math.hypot(scout.order.x-61.5,scout.order.y-7.5)<7,'A damaged rover heads home for repairs');
  const fresh=scene();fresh.building('barracks',50,4);fresh.building('refinery',62,12);fresh.building('reactor',57,11);for(let i=0;i<3;i++)fresh.unit('harvester',63+i,17);
  fresh.s.teams[1].credits=600;think(fresh.s);
  assert(fresh.s.entities.some(e=>e.team===1&&e.queue?.some(q=>entityRole(q.type)==='scout')),'A commander without a rover trains one');
});

test('two commanders think half an interval apart',()=>{
  const s=createGame('stagger','hard',{width:72,height:56,aiTeams:[0,1]});
  while(s.time<3.1)updateGame(s,.05);
  assert(Math.abs((s.aiByTeam[0].nextThink-s.ai.nextThink)-aiKnobs(s,s.ai).think/2)<1e-9,'Team 0 runs half an interval after team 1');
});

test('commander plans survive saving and continue identically',()=>{
  const {s,unit,building,remember,field}=scene({doctrine:'swarm',difficulty:'normal'});
  s.time=120;const depot=building('refinery',8,36,0);remember(depot);field(16,42,60);
  unit('scout',57,10);for(let i=0;i<3;i++)unit('scout',53+i*1.5,14);
  const wave=Array.from({length:4},(_,i)=>unit('rifle',30+i,26));
  s.ai.waves=[{id:1,kind:'raid',ids:wave.map(u=>u.id),tx:center(depot).x,ty:center(depot).y,targetId:depot.id,state:'advance',since:100}];s.ai.waveId=1;
  think(s);
  assert(s.ai.harass&&s.ai.waves&&s.ai.intel,'The fixture exercises plans');
  const restored=decodeGame(encodeGame(s)).game;
  for(let i=0;i<120;i++){updateGame(s,.05);updateGame(restored,.05);}
  assert.deepEqual(snapshot(restored),snapshot(s));
});
