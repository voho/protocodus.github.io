import assert from 'node:assert/strict';
import {UNITS,BUILDINGS,createGame,updateGame,issueOrder,stopUnits,getEntity,addEntity,unitStats,unitRange,seen} from '../sim.js';
import {ABILITIES,abilityFor,abilityName,abilityStatus,useAbility} from '../abilities.js';
import {encodeGame,decodeGame} from '../save.js';

const advance=(s,seconds)=>{for(let i=0;i<Math.round(seconds*20);i++)updateGame(s,.05);};
const close=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-7,`${label}: ${actual} vs ${expected}`);
const stateJSON=s=>JSON.parse(encodeGame(s)).game;
// An open, fully explored field without commanders. Fog stays frozen unless a check enables it.
function quiet(seed='abilities',races=['organics','aiUnity']){
  const s=createGame(seed,'normal',{width:72,height:56,races,aiTeams:[]});
  s.entities=[];s.fogClock=Infinity;s.terrain.fill(0);s.minerals.fill(0);s.navVersion++;
  s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));s.teams.forEach(t=>{t.credits=5000;});
  return s;
}
const unit=(s,role,team,x,y)=>addEntity(s,team,'unit',team&&s.teams[1].race==='aiUnity'?`unity${role[0].toUpperCase()}${role.slice(1)}`:role,x,y);

// Every combat role has exactly one ability, named for each race; support and economy units have none.
for(const role of ['rifle','rocket','scout','tank','striker','artillery','engineer']){
  const a=abilityFor(role);assert(a&&a.role===role&&a.names.organics&&a.names.aiUnity&&a.cooldown>0);
  assert.equal(abilityFor(`unity${role[0].toUpperCase()}${role.slice(1)}`),a);
}
for(const role of ['harvester','constructor','unityConstructor','core','wall'])assert.equal(abilityFor(role),null);
assert.equal(new Set(Object.values(ABILITIES).map(a=>a.id)).size,7);
assert.equal(abilityName('rifle'),'Dig in');assert.equal(abilityName('unityRifle'),'Brace protocol');assert.equal(abilityName('unityArtillery'),'Arc barrage');

// Dig in: 35% less damage while holding still, for its duration only; any new order ends it.
{
  const s=quiet('dig-in'),rifle=unit(s,'rifle',0,30.5,30.5),enemy=unit(s,'rifle',1,33.5,30.5);
  rifle.cooldown=999;enemy.cooldown=0;
  const shot=()=>{const before=rifle.hp;enemy.cooldown=0;updateGame(s,.05);return before-rifle.hp;};
  const base=unitStats(enemy).damage;
  close(shot(),base,'Unprotected squads take full fire');
  const result=useAbility(s,0,[rifle.id]);
  assert.deepEqual(result,{ok:true,reason:'',used:[rifle.id]});
  close(rifle.abilityUntil,s.time+10,'Dig in lasts ten seconds');close(rifle.abilityReadyAt,s.time+30,'Dig in recharges for thirty seconds');
  const status=abilityStatus(s,rifle);assert.equal(status.id,'digIn');assert(status.active&&!status.ready&&status.remaining>29.9&&!status.targeted);
  assert.equal(s.events.at(-1).kind,'ability');assert.equal(s.events.at(-1).ability,'digIn');assert.equal(s.events.at(-1).text,'Rifle squad: Dig in');
  close(shot(),base*.65,'Dug-in squads take 65% damage');
  assert.deepEqual(useAbility(s,0,[rifle.id]),{ok:false,reason:'Ability recharging',used:[]});
  rifle.hp=rifle.maxHp;issueOrder(s,[rifle.id],{type:'move',x:24.5,y:30.5});
  assert.equal(rifle.abilityUntil,undefined,'A move order ends Dig in');
  close(shot(),base,'Full damage after leaving the position');
  enemy.cooldown=1e9;advance(s,30.1);assert(abilityStatus(s,rifle).ready&&rifle.abilityReadyAt===undefined,'Recharged after the cooldown');
  // Activating on a moving squad halts it in place; the bonus expires on schedule.
  issueOrder(s,[rifle.id],{type:'move',x:10.5,y:30.5});advance(s,.5);
  assert(useAbility(s,0,[rifle.id]).ok);assert.equal(rifle.order.type,'idle');
  advance(s,10.05);assert.equal(rifle.abilityUntil,undefined);assert.equal(abilityStatus(s,rifle).active,false);
}

// Long shot: +3 range for idle guards, attack orders and attack-move engagement, then back to base range.
{
  const s=quiet('long-shot'),rocket=unit(s,'rocket',0,30.5,30.5),target=unit(s,'harvester',1,39.5,30.5);
  rocket.cooldown=0;updateGame(s,.05);
  assert.equal(s.effects.filter(e=>e.type==='rocket').length,0,'Nine tiles is beyond base rocket range');
  assert.equal(unitRange(s,rocket),UNITS.rocket.range);
  assert(useAbility(s,0,[rocket.id]).ok);assert.equal(unitRange(s,rocket),UNITS.rocket.range+3);
  updateGame(s,.05);assert.equal(s.effects.filter(e=>e.type==='rocket'&&e.attackerId===rocket.id).length,1,'Idle guard fires at extended range');
  rocket.cooldown=0;issueOrder(s,[rocket.id],{type:'attack',targetId:target.id});const x=rocket.x;updateGame(s,.05);
  assert.equal(rocket.x,x,'An attack order fires from the extended range without closing in');
  advance(s,8);assert.equal(unitRange(s,rocket),UNITS.rocket.range,'Long shot expires');
}

// Overdrive and Afterburner: steady movement at the boosted speed while active.
for(const [role,factor,duration] of [['tank',1.4,6],['striker',1.6,4]]){
  const s=quiet(`speed-${role}`),u=unit(s,role,0,10.5,20.5),control=unit(s,role,0,10.5,30.5);
  assert(useAbility(s,0,[u.id]).ok);
  issueOrder(s,[u.id],{type:'move',x:66.5,y:20.5});issueOrder(s,[control.id],{type:'move',x:66.5,y:30.5});
  advance(s,1.5);const a=u.x,b=control.x;advance(s,.5);
  close(u.x-a,UNITS[role].speed*factor*.5,`${role} boosted movement`);close(control.x-b,UNITS[role].speed*.5,`${role} normal movement`);
  advance(s,duration);const later=u.x;advance(s,.5);assert(u.x-later<UNITS[role].speed*.5+1e-6,`${role} boost expires`);
}

// Flare: lights ground within reach for its own team only and expires; one scout of a group fires it.
{
  const make=()=>{
    const s=quiet('flare');s.visible.forEach(v=>v.fill(0));s.explored.forEach(v=>v.fill(0));s.fogClock=0;
    const scouts=[unit(s,'scout',0,10.5,20.5),unit(s,'scout',0,12.5,20.5)],hidden=unit(s,'rifle',1,38.5,20.5),watcher=unit(s,'scout',1,60.5,45.5);
    hidden.cooldown=watcher.cooldown=999;updateGame(s,.05);return{s,scouts,hidden};
  };
  const {s,scouts,hidden}=make(),plain=make().s,cellAt=(x,y)=>Math.floor(y)*s.width+Math.floor(x);
  assert(!seen(s,0,hidden),'The rifle starts outside sensor range');
  assert.deepEqual(useAbility(s,0,scouts.map(e=>e.id),{x:30,y:20.5}),{ok:false,reason:'Target out of range',used:[]},'Flares reach 14 tiles');
  const result=useAbility(s,0,scouts.map(e=>e.id),{x:26.4,y:20.5});
  assert.deepEqual(result.used,[scouts[1].id],'The closest ready scout fires the only flare');
  assert.deepEqual(s.reveals,[{team:0,x:26.4,y:20.5,r:7,until:s.time+12}]);
  advance(s,.25);advance(plain,.25);
  assert(s.visible[0][cellAt(32.5,20.5)]&&s.explored[0][cellAt(32.5,20.5)],'The flare lights its radius');
  assert(seen(s,0,hidden)===false&&s.visible[0][cellAt(38.5,20.5)]===0,'Ground beyond the flare stays concealed');
  assert.deepEqual(s.visible[1],plain.visible[1],'The rival team sees nothing from the flare');
  assert.deepEqual(s.explored[1],plain.explored[1]);
  hidden.x=31.5;advance(s,.25);assert(seen(s,0,hidden),'Units inside the flare become visible to its team');
  const restored=decodeGame(encodeGame(s)).game;assert.deepEqual(restored.reveals,s.reveals,'Active reveals are saved');
  advance(s,12);advance(restored,12);
  assert.equal(s.reveals,undefined,'Expired reveals are pruned');assert.equal(s.visible[0][cellAt(31.5,20.5)],0,'The flare goes dark');
  assert.deepEqual(stateJSON(restored),stateJSON(s),'Saved reveals continue exactly');
}

// Barrage: four scattered shells, 0.7 seconds apart, at explored ground within range + 2.
{
  const make=seed=>{
    const s=quiet(seed),gun=unit(s,'artillery',0,30.5,30.5),targets=[unit(s,'tank',1,43.5,30.5),unit(s,'tank',1,43.5,31.5),unit(s,'rifle',1,42.5,30)],ally=unit(s,'tank',0,44.5,29.5);
    for(const e of [...targets,ally])e.cooldown=999;gun.cooldown=0;s.fogClock=1;return{s,gun,targets,ally};
  };
  const {s,gun,targets,ally}=make('barrage'),twin=make('barrage');
  const reach=UNITS.artillery.range+2;assert.equal(abilityStatus(s,gun).range,reach);assert(abilityStatus(s,gun).targeted);
  assert.equal(useAbility(s,0,[gun.id],{x:30.5+reach+.5,y:30.5}).reason,'Target out of range');
  s.explored[0][30*s.width+43]=0;assert.equal(useAbility(s,0,[gun.id],{x:43.5,y:30.5}).reason,'Target unexplored ground');s.explored[0][30*s.width+43]=1;
  assert.equal(useAbility(s,0,[gun.id]).reason,'Choose a target point');
  const rng=s.rng;
  for(const game of [s,twin.s])assert(useAbility(game,0,[game===s?gun.id:twin.gun.id],{x:43.5,y:30.5}).ok);
  assert.equal(s.rng,rng,'Activation draws nothing from the shared stream');
  assert.deepEqual(gun.barrage,{x:43.5,y:30.5,shots:4,next:s.time});assert(gun.cooldown>=2.8,'Regular fire waits for the salvo');
  const hp=()=>targets.map(e=>e.hp);
  updateGame(s,.05);updateGame(twin.s,.05);
  assert.equal(gun.barrage.shots,3);assert.notEqual(s.rng,rng,'Each shell scatters with the shared stream');
  assert.equal(s.effects.filter(e=>e.type==='shell'&&e.weapon==='artillery').length,1);assert(s.effects.some(e=>e.type==='explosion'&&e.weapon==='artillery'));
  const mid=decodeGame(encodeGame(s)).game;assert.deepEqual(getEntity(mid,gun.id).barrage,gun.barrage,'A salvo in flight is saved');
  advance(s,.6);assert.equal(gun.barrage.shots,3,'Shells are 0.7 seconds apart');advance(s,.1);assert.equal(gun.barrage.shots,2);
  advance(s,1.5);advance(mid,2.2);advance(twin.s,2.2);
  assert.equal(gun.barrage,undefined,'Four shells end the salvo');
  assert.deepEqual(stateJSON(mid),stateJSON(s),'Save during a barrage continues exactly');
  assert.deepEqual(twin.targets.map(e=>e.hp),hp(),'Scatter is deterministic');
  const dealt=targets.reduce((sum,e)=>sum+e.maxHp-e.hp,0),shell=unitStats(gun).damage*.7;
  assert(dealt>0&&targets.every(e=>e.maxHp-e.hp<=4*shell+1e-9),'Each shell deals at most 70% of a direct hit');
  assert.equal(ally.hp,ally.maxHp,'Friendly units at the impact are spared');
  assert.equal(useAbility(s,0,[gun.id],{x:43.5,y:30.5}).reason,'Ability recharging');
}

// Field patch: restores 25% to the most damaged friendly vehicle or structure in reach, at the engineer rate.
{
  const s=quiet('patch'),engineer=unit(s,'engineer',0,30.5,30.5),tank=unit(s,'tank',0,32.5,30.5),truck=unit(s,'harvester',0,29.5,32.5),rifle=unit(s,'rifle',0,31.5,29.5);
  const reactor=addEntity(s,0,'building','reactor',25,28),far=unit(s,'tank',0,40.5,30.5);
  tank.hp=tank.maxHp*.5;truck.hp=truck.maxHp*.8;rifle.hp=1;reactor.hp=reactor.maxHp*.6;far.hp=1;
  const credits=s.teams[0].credits,spent=s.teams[0].stats.spent;
  assert(useAbility(s,0,[engineer.id]).ok);
  close(tank.hp,tank.maxHp*.75,'The most damaged vehicle in reach is patched');
  const cost=tank.maxHp*.25*UNITS.tank.cost*.35/tank.maxHp;
  close(s.teams[0].credits,credits-cost,'Patching costs the engineer repair rate');close(s.teams[0].stats.spent,spent+cost,'Patching is recorded as spending');
  assert.equal(rifle.hp,1,'Infantry are not machinery');assert.equal(far.hp,1,'Out of reach');
  advance(s,30.1);reactor.hp=reactor.maxHp*.4;s.teams[0].credits=1;
  assert.equal(useAbility(s,0,[engineer.id]).reason,'Insufficient credits');assert.equal(reactor.hp,reactor.maxHp*.4);
  s.teams[0].credits=5000;assert(useAbility(s,0,[engineer.id]).ok);close(reactor.hp,reactor.maxHp*.65,'Structures are patched too');
  const lone=quiet('patch-idle'),idle=unit(lone,'engineer',0,30.5,30.5);
  assert.equal(useAbility(lone,0,[idle.id]).reason,'No damaged vehicle or structure in reach');assert.equal(idle.abilityReadyAt,undefined,'A refused patch keeps its charge');
}

// Commands only reach the caller's living units with abilities.
{
  const s=quiet('ownership'),mine=unit(s,'tank',0,20.5,20.5),theirs=unit(s,'tank',1,40.5,20.5),truck=unit(s,'harvester',0,22.5,22.5);
  assert.equal(useAbility(s,0,[theirs.id]).reason,'Select units with an ability');
  assert.equal(useAbility(s,1,[mine.id]).reason,'Select units with an ability');
  assert.equal(useAbility(s,0,[truck.id]).reason,'Select units with an ability');assert.equal(abilityStatus(s,truck),null);
  assert.equal(useAbility(s,0,'nope').reason,'Select units with an ability');
  mine.hp=0;assert.equal(useAbility(s,0,[mine.id]).reason,'Select units with an ability');
  assert.equal(abilityStatus(s,theirs).name,'Overclock');
  s.status='victory';assert.equal(useAbility(s,1,[theirs.id]).reason,'Operation has ended');
}

// Whole operations: abilities of both races replay identically and survive saving mid-effect.
{
  const run=()=>{
    const s=createGame('ability-duel','hard',{width:144,height:112,races:['organics','aiUnity'],aiTeams:[0,1]});
    for(let t=0;t<120;t++){
      updateGame(s,1);
      for(const team of [0,1]){
        const ready=s.entities.filter(e=>e.team===team&&e.kind==='unit'&&abilityStatus(s,e)?.ready&&!abilityStatus(s,e).targeted);
        if(ready.length&&t%7===team)useAbility(s,team,ready.map(e=>e.id));
        const scout=s.entities.find(e=>e.team===team&&abilityStatus(s,e)?.id==='flare'&&abilityStatus(s,e).ready);
        if(scout&&t%11===0)useAbility(s,team,[scout.id],{x:scout.x+(team?-8:8),y:scout.y});
      }
    }
    return s;
  };
  const a=run(),b=run();assert.deepEqual(stateJSON(a),stateJSON(b),'Ability use is deterministic');
  assert(a.events.some(e=>e.kind==='ability'&&e.team===0)&&a.events.some(e=>e.kind==='ability'&&e.team===1));
  const restored=decodeGame(encodeGame(a)).game;
  for(let i=0;i<6;i++){advance(a,5);advance(restored,5);assert.deepEqual(stateJSON(restored),stateJSON(a),'Saved ability state continues exactly');}
  const untouched=createGame('ability-free','normal',{width:72,height:56});advance(untouched,20);
  assert(untouched.entities.every(e=>e.abilityReadyAt===undefined&&e.abilityUntil===undefined&&e.barrage===undefined)&&untouched.reveals===undefined,'Skirmish state carries no ability fields until one is used');
}

// Ability fields are validated in saves.
{
  const s=quiet('ability-save');s.fogClock=1;const gun=unit(s,'artillery',0,30.5,30.5),rifle=unit(s,'rifle',0,25.5,30.5);unit(s,'tank',1,40.5,30.5);
  useAbility(s,0,[gun.id],{x:38.5,y:30.5});useAbility(s,0,[rifle.id]);
  const raw=encodeGame(s);decodeGame(raw);
  for(const corrupt of [
    g=>{g.entities.find(e=>e.type==='rifle').abilityUntil=g.time+11;},g=>{g.entities.find(e=>e.type==='rifle').abilityReadyAt=g.time+31;},
    g=>{g.entities.find(e=>e.type==='unityTank').abilityUntil=g.time+1;g.entities.find(e=>e.type==='unityTank').abilityReadyAt=g.time+50;},
    g=>{g.entities.find(e=>e.type==='artillery').barrage.shots=5;},g=>{g.entities.find(e=>e.type==='artillery').barrage.x=g.width+1;},
    g=>{g.entities.find(e=>e.type==='rifle').barrage={x:1,y:1,shots:1,next:g.time};},g=>{g.entities.find(e=>e.type==='artillery').abilityUntil=g.time;},
    g=>{g.reveals=[{team:2,x:1,y:1,r:7,until:g.time+1}];},g=>{g.reveals=[{team:0,x:1,y:1,r:70,until:g.time+1}];},g=>{g.reveals={};},
    g=>{g.entities[0].tag='';},g=>{g.entities[0].tag='x'.repeat(41);},g=>{g.events.at(-1).ability='teleport';},g=>{g.events.at(-1).count=0;},
  ]){const broken=JSON.parse(raw);corrupt(broken.game);assert.throws(()=>decodeGame(JSON.stringify(broken)),'Ability state is validated');}
}

console.log('Ashline ability checks passed: race names, Dig in (65% damage, order cancel, halt), Long shot range, Overdrive/Afterburner speed, team-only flares with expiry, deterministic barrage salvos and save continuation, paid field patches, ownership, cooldowns and save validation.');
