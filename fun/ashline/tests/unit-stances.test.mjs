import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, UNITS, raceUnit, unitStats, issueOrder, stopUnits, updateGame, setUnitStance, effectiveUnitStance} from '../sim.js';
import {encodeGame, decodeGame} from '../save.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

function scene(seed,race='organics') {
  const s=createGame(seed,'normal',{width:72,height:56,races:[race,race],aiTeams:[]});
  const template=structuredClone(s.entities.find(e=>e.kind==='unit'&&UNITS[e.type].damage));
  s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);
  s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));
  s.entities=[];s.effects=[];s.navVersion++;
  const add=(role,x,y,team=0)=>{
    const type=raceUnit(s,team,role),d=UNITS[type];
    const u={...structuredClone(template),id:s.nextId++,type,team,x,y,angle:0,size:d.size,hp:d.hp,maxHp:d.hp,order:{type:'idle'},path:[],repath:0,cooldown:1000};
    if(role==='harvester')Object.assign(u,{cargo:0,unload:0,unloadDepotId:null,harvestPhase:'gather'});
    s.entities.push(u);return u;
  };
  return {s,add};
}

// Keep these combat fixtures fully observed except for explicitly hidden targets.
// Visibility remains real simulation input, and rockets still have to fly and hit.
function advance(s,seconds,check=()=>{},hidden=[]) {
  for(let tick=0;tick<Math.round(seconds/.05);tick++){
    s.fogClock=1;s.visible.forEach(v=>v.fill(1));
    for(const {team,unit} of hidden)s.visible[team][Math.floor(unit.y)*s.width+Math.floor(unit.x)]=0;
    updateGame(s,.05);check();
  }
}

function fireOnce(s,attacker,defender) {
  const hp=defender.hp;
  attacker.cooldown=0;
  advance(s,.05);
  assert.equal(attacker.lastShot,s.time,'The fixture initiates retaliation with an actual enemy shot');
  attacker.cooldown=1000;
  advance(s,.7);
  assert(defender.hp<hp,'Incoming fire actually damages the defender, including projectile flight');
}

for(const race of ['organics','aiUnity']){
  test(`${race} Guard holds position and replaces targets with the closest visible in-range enemy`,()=>{
    const {s,add}=scene(`guard-nearest-${race}`,race),guard=add('tank',20,20),near=add('harvester',23,20,1),far=add('rifle',23.5,20,1);
    const origin={x:guard.x,y:guard.y};
    delete guard.stance;guard.cooldown=0;
    advance(s,.05);
    assert(near.hp<near.maxHp,'A closer unarmed enemy takes priority over a more threatening unit');
    assert.equal(far.hp,far.maxHp);
    const closer=add('rifle',21.5,20,1);guard.cooldown=0;
    advance(s,.05);
    assert(closer.hp<closer.maxHp,'An existing living target does not prevent choosing a newly closer enemy');
    const previousNearHp=near.hp,previousCloserHp=closer.hp;guard.cooldown=0;
    advance(s,.05,()=>{},[{team:0,unit:closer}]);
    assert(near.hp<previousNearHp,'A hidden nearest enemy is excluded from current target selection');
    assert.equal(closer.hp,previousCloserHp);
    far.x=30;near.x=31;closer.x=32;
    advance(s,3,()=>assert.equal(distance(guard,origin),0,'Guard never follows an enemy out of range'));
  });

  test(`${race} idle Guard remains planted while commanded allies navigate around it`,()=>{
    const {s,add}=scene(`guard-traffic-${race}`,race),guard=add('tank',20,20),mover=add('tank',15,20);
    const origin={x:guard.x,y:guard.y},goal={x:25,y:20};
    issueOrder(s,[mover.id],{type:'move',...goal});
    advance(s,18,()=>{
      assert.equal(distance(guard,origin),0,'An idle guard cannot be moved by temporary yielding or collision separation');
      assert(distance(guard,mover)>=(guard.size+mover.size)*.43-.001,'The moving ally respects the stationary body');
    });
    assert(distance(mover,goal)<=.081,'A stationary guard is navigated around on clear ground');
    assert.equal(guard.order.type,'idle');
  });

  test(`${race} Defend ignores mere sightings, pursues real incoming fire, and keeps one fixed leash`,()=>{
    const {s,add}=scene(`defend-leash-${race}`,race),defender=add('tank',20,20),attacker=add('artillery',29,20,1);
    const origin={x:defender.x,y:defender.y},range=unitStats(defender).range;
    setUnitStance(s,[defender.id],'defend');
    advance(s,3,()=>assert.equal(distance(defender,origin),0,'Seeing an out-of-range enemy cannot start pursuit'));
    fireOnce(s,attacker,defender);
    attacker.x=33.5;
    let furthest=distance(defender,origin);
    advance(s,8,()=>{
      furthest=Math.max(furthest,distance(defender,origin));
      assert(distance(defender,origin)<=range+1e-6,'Every pursuit step remains within the original firing-range radius');
      assert.deepEqual(defender.defendAnchor,origin,'The leash origin cannot follow the pursuing unit');
    });
    assert(furthest>5.5,'Defend meaningfully closes the range to its actual attacker');
    attacker.x=36;
    advance(s,18,()=>assert(distance(defender,origin)<=range+1e-6));
    assert(distance(defender,origin)<=.081,'A fleeing attacker beyond the reachable firing envelope makes Defend return');
    assert.equal(defender.order.type,'idle');
  });

  test(`${race} directed rocket fire activates Defend while the projectile flies and hits`,()=>{
    const {s,add}=scene(`defend-rocket-${race}`,race),defender=add('rifle',20,20),attacker=add('rocket',26,20,1);
    const origin={x:defender.x,y:defender.y};
    setUnitStance(s,[defender.id],'defend');
    fireOnce(s,attacker,defender);
    advance(s,3);
    assert(distance(defender,origin)>.8,'Rocket attackers outside rifle range trigger an actual defensive approach');
    assert(distance(defender,origin)<=unitStats(defender).range+1e-6);
    assert.equal(defender.retaliationTargetId,attacker.id);
  });
}

for(const reason of ['death','hidden'])test(`Defend returns to its original idle point after attacker ${reason}`,()=>{
  const {s,add}=scene(`defend-return-${reason}`),defender=add('tank',20,20),attacker=add('artillery',30,20,1);
  const origin={x:defender.x,y:defender.y};
  setUnitStance(s,[defender.id],'defend');fireOnce(s,attacker,defender);advance(s,3);
  assert(distance(defender,origin)>2,'The fixture begins after a real pursuit');
  if(reason==='death')attacker.hp=0;
  advance(s,15,()=>assert(distance(defender,origin)<=unitStats(defender).range+1e-6),reason==='hidden'?[{team:0,unit:attacker}]:[]);
  assert(distance(defender,origin)<=.081,'Ended retaliation returns to the original point instead of parking at the last target');
  assert.equal(defender.retaliationTargetId,undefined);
});

test('Defend cannot take a terrain detour outside its anchored firing-range radius',()=>{
  const {s,add}=scene('defend-bounded-detour'),defender=add('rifle',20.5,20.5),attacker=add('artillery',28.5,20.5,1);
  const origin={x:defender.x,y:defender.y},range=unitStats(defender).range;
  for(let y=16;y<=24;y++)s.terrain[y*s.width+23]=1;
  s.navVersion++;setUnitStance(s,[defender.id],'defend');fireOnce(s,attacker,defender);
  advance(s,20,()=>{
    assert(distance(defender,origin)<=range+1e-6,'Routing around an obstacle must obey the leash along the entire route');
    assert.equal(s.blocked[Math.floor(defender.y)*s.width+Math.floor(defender.x)],0,'The leash does not permit crossing solid terrain');
  });
  assert(distance(defender,origin)<=.081,'An attacker with no reachable firing position inside the leash is abandoned');
});

test('Defend can fire back at an attacker near the outer edge of its reachable envelope',()=>{
  const {s,add}=scene('defend-outer-boundary'),defender=add('rifle',20.5,20.5),attacker=add('artillery',30,20.5,1);
  const origin={x:defender.x,y:defender.y},range=unitStats(defender).range;
  assert(Math.abs(distance(defender,attacker)-(range*2-.1))<1e-9);
  setUnitStance(s,[defender.id],'defend');fireOnce(s,attacker,defender);defender.cooldown=0;
  advance(s,12,()=>assert(distance(defender,origin)<=range+1e-6,'Arrival tolerance cannot push a defender past its leash'));
  assert(attacker.hp<attacker.maxHp,'The defender must reach firing range instead of stopping short at the leash boundary');
});

test('Defend follows a legal terrain detour inside the anchored circle and reaches firing range',()=>{
  const {s,add}=scene('defend-inside-detour'),defender=add('rifle',20.5,20.5),attacker=add('artillery',28.5,20.5,1);
  const origin={x:defender.x,y:defender.y},range=unitStats(defender).range;
  for(let y=19;y<=21;y++)s.terrain[y*s.width+23]=1;
  s.navVersion++;setUnitStance(s,[defender.id],'defend');fireOnce(s,attacker,defender);defender.cooldown=0;
  let lateral=0;
  advance(s,18,()=>{
    lateral=Math.max(lateral,Math.abs(defender.y-origin.y));
    assert(distance(defender,origin)<=range+1e-6,'The whole valid detour stays inside the leash');
    assert.equal(s.blocked[Math.floor(defender.y)*s.width+Math.floor(defender.x)],0);
  });
  assert(lateral>1.6,'The fixture requires movement around the wall rather than through it');
  assert(attacker.hp<attacker.maxHp,'A reachable attacker is not abandoned merely because the direct route is blocked');
});

test('a blocked Defend chase preserves the idle formation reservation through pursuit, save, and return',()=>{
  const {s,add}=scene('defend-retained-slot'),defender=add('rifle',20.5,20.5),attacker=add('artillery',28.5,20.5,1);
  const origin={x:defender.x,y:defender.y};
  issueOrder(s,[defender.id],{type:'move',...origin,formationAngle:0});advance(s,.05);
  assert.equal(defender.order.type,'idle');assert(defender.order.formation,'The formation reservation originates in a completed real command');
  const reservation=structuredClone(defender.order);
  // The radial chase point is (25.3,20.5), inside this newly obstructed cell.
  s.terrain[20*s.width+25]=1;s.navVersion++;
  setUnitStance(s,[defender.id],'defend');fireOnce(s,attacker,defender);
  assert.deepEqual(defender.order,reservation,'A temporary navigation fallback cannot replace the reserved formation slot');
  const restored=decodeGame(encodeGame(s)).game;
  advance(s,3,()=>assert.deepEqual(defender.order,reservation));advance(restored,3);
  assert.deepEqual(restored.entities,s.entities,'Fallback pursuit resumes without corrupting saved idle order coordinates');
  attacker.hp=0;
  advance(s,15,()=>assert.deepEqual(defender.order,reservation,'Returning to the Defend anchor retains the original formation assignment'));
  assert(distance(defender,origin)<=.081);
});

test('a move command clears retaliation, reaches its destination, then establishes a fresh Defend origin',()=>{
  const {s,add}=scene('defend-command-reset'),defender=add('tank',20,20),attacker=add('artillery',30,20,1);
  setUnitStance(s,[defender.id],'defend');fireOnce(s,attacker,defender);advance(s,2);
  const goal={x:20,y:30};
  issueOrder(s,[defender.id],{type:'move',...goal});
  assert.equal(effectiveUnitStance(defender),'guard');
  assert.equal(defender.defendAnchor,undefined);assert.equal(defender.retaliationTargetId,undefined);
  advance(s,18);
  assert(distance(defender,goal)<=.081,'The explicit move finishes without being pulled back by the previous attack');
  assert.equal(defender.order.type,'idle');assert.equal(effectiveUnitStance(defender),'defend');
  const arrived={x:defender.x,y:defender.y};
  advance(s,2,()=>assert.equal(distance(defender,arrived),0,'An old hit cannot reactivate at the new idle origin'));
  attacker.x=29;attacker.y=30;fireOnce(s,attacker,defender);advance(s,2);
  assert(distance(defender,arrived)>1,'New incoming fire reactivates Defend after command completion');
  assert.deepEqual(defender.defendAnchor,arrived);
});

for(const type of ['attack','attackMove','explore'])test(`${type} commands suppress Defend and discard prior retaliation`,()=>{
  const {s,add}=scene(`defend-command-${type}`),defender=add('tank',20,20),attacker=add('artillery',30,20,1),orderedEnemy=add('tank',10,20,1);
  setUnitStance(s,[defender.id],'defend');fireOnce(s,attacker,defender);advance(s,1);
  // Explore needs unexplored cells to remain active in this isolated scene.
  if(type==='explore'){s.explored[0].fill(0);s.explored[0][20*s.width+20]=1;}
  issueOrder(s,[defender.id],{type,x:10,y:20,...(type==='attack'?{targetId:orderedEnemy.id}:{})});
  assert.equal(effectiveUnitStance(defender),'guard');assert.equal(defender.defendAnchor,undefined);assert.equal(defender.retaliationTargetId,undefined);
  const start={x:defender.x,y:defender.y};
  fireOnce(s,attacker,defender);
  assert.equal(defender.defendAnchor,undefined,'A new incoming shot during a command cannot start an idle pursuit');
  assert.equal(defender.retaliationTargetId,undefined);
  assert.equal(defender.stance,'defend','The selected preference survives explicit commands');
  stopUnits(s,[defender.id]);const stopped={x:defender.x,y:defender.y};
  advance(s,1,()=>assert.equal(distance(defender,stopped),0,'Stopping cannot resurrect a previous hit'));
  assert.equal(effectiveUnitStance(defender),'defend');
  assert.deepEqual(defender.defendAnchor,stopped);
  assert(distance(start,stopped)<3,'Command execution remains physically bounded');
});

test('a missile dispatched before an explicit command cannot revive retaliation after command completion',()=>{
  const {s,add}=scene('defend-old-missile'),defender=add('rifle',20,20),attacker=add('rocket',26,20,1);
  setUnitStance(s,[defender.id],'defend');attacker.cooldown=0;
  advance(s,.05);attacker.cooldown=1000;
  assert(s.effects.some(e=>e.type==='rocket'&&e.targetId===defender.id),'The old shot is still in flight');
  assert.equal(defender.hp,defender.maxHp);
  const origin={x:defender.x,y:defender.y};
  issueOrder(s,[defender.id],{type:'move',...origin});
  advance(s,.05);
  assert.equal(defender.order.type,'idle','The explicit command finishes before the missile arrives');
  const restored=decodeGame(encodeGame(s)).game;
  advance(s,2,()=>assert.equal(distance(defender,origin),0,'The old missile cannot activate fresh idle retaliation'));
  advance(restored,2);
  assert(defender.hp<defender.maxHp,'The regression includes actual delayed damage after becoming idle again');
  assert.equal(defender.retaliationTargetId,undefined);
  assert.deepEqual(restored.entities,s.entities,'Saving with an old projectile in flight preserves its command suppression');
});

test('switching from Defend to Guard stops an active pursuit at the current position',()=>{
  const {s,add}=scene('defend-switch-guard'),defender=add('tank',20,20),attacker=add('artillery',31,20,1);
  setUnitStance(s,[defender.id],'defend');fireOnce(s,attacker,defender);advance(s,1);
  assert(distance(defender,{x:20,y:20})>.2);
  setUnitStance(s,[defender.id],'guard');const stopped={x:defender.x,y:defender.y};
  fireOnce(s,attacker,defender);
  advance(s,3,()=>assert.equal(distance(defender,stopped),0,'Guard does not continue pursuit or the previous return route'));
  assert.equal(defender.defendAnchor,undefined);assert.equal(defender.retaliationTargetId,undefined);
});

test('a preserved formation saves partial assembly and becomes immovable Guard only when its cohort finishes',()=>{
  const {s,add}=scene('guard-formation-assembly'),units=[add('tank',20,20),add('tank',24,20)];
  issueOrder(s,units.map(u=>u.id),{type:'move',x:40,y:30,formationAngle:Math.PI/2,facing:Math.PI/2});
  const goals=units.map(u=>({x:u.order.x,y:u.order.y}));
  for(let tick=0;tick<600&&!units.some(u=>u.formationReady);tick++)advance(s,.05);
  assert(units.some(u=>u.formationReady)&&units.some(u=>!u.formationReady),'The fixture saves an early arrival while another cohort member is still assembling');
  assert(units.every(u=>u.order.type==='move'),'Early arrivals remain part of the explicit formation command');
  const saved=encodeGame(s),restored=decodeGame(saved).game;
  assert(restored.entities.some(u=>u.formationReady),'Readiness survives save restoration');
  const invalid=JSON.parse(saved),ready=invalid.game.entities.find(u=>u.formationReady);ready.order.type='idle';
  assert.throws(()=>decodeGame(JSON.stringify(invalid)),/damaged|incompatible/i,'Readiness cannot be attached to an idle Guard');
  advance(s,20,()=>assert(units.every(u=>u.order.type===units[0].order.type),'The cohort finishes together instead of freezing an early Guard in a late arrival route'));
  advance(restored,20);
  assert.deepEqual(restored.entities,s.entities,'Partial assembly continues identically after loading');
  units.forEach((u,i)=>{assert.equal(u.order.type,'idle');assert.equal(u.formationReady,undefined);assert(distance(u,goals[i])<=.081);});
  const parked=units.map(u=>({x:u.x,y:u.y})),mover=add('tank',35,parked[0].y);
  issueOrder(s,[mover.id],{type:'move',x:45,y:parked[0].y});
  advance(s,18,()=>units.forEach((u,i)=>assert.equal(distance(u,parked[i]),0,'Completed cohort members now hold exact Guard positions under new traffic')));
  assert(distance(mover,{x:45,y:parked[0].y})<=.081,'New traffic still navigates around the finished formation');
});

test('Defend pursuit and return continue identically after saving',()=>{
  const {s,add}=scene('defend-save'),defender=add('tank',20,20),attacker=add('artillery',31,20,1);
  setUnitStance(s,[defender.id],'defend');fireOnce(s,attacker,defender);advance(s,1);
  assert(distance(defender,{x:20,y:20})>.2,'Save occurs during an active pursuit');
  const restored=decodeGame(encodeGame(s)).game,copy=restored.entities.find(e=>e.id===defender.id);
  for(let i=0;i<40;i++){advance(s,.05);advance(restored,.05);}
  assert.deepEqual(restored.entities,s.entities,'Saved pursuit resumes the same steering, target, and fixed anchor');
  attacker.hp=0;restored.entities.find(e=>e.id===attacker.id).hp=0;
  advance(s,.4);advance(restored,.4);
  const returning=decodeGame(encodeGame(s)).game;
  advance(s,15);advance(restored,15);advance(returning,15);
  assert(distance(defender,{x:20,y:20})<=.081);assert(distance(copy,{x:20,y:20})<=.081);
  assert.deepEqual(restored.entities,s.entities);assert.deepEqual(returning.entities,s.entities,'A save taken during return also reaches the same origin');
  assert.equal(restored.rng,s.rng);assert.equal(returning.rng,s.rng);
});

test('stance saves retain preferences, reject invalid metadata, and default legacy units to Guard',()=>{
  const {s,add}=scene('stance-save-schema'),unit=add('tank',20,20),unarmed=add('constructor',24,20);
  setUnitStance(s,[unit.id,unarmed.id],'defend');
  assert.equal(unit.stance,'defend');assert.equal(unarmed.stance,undefined,'Unarmed units cannot acquire a military stance');
  const serialized=encodeGame(s),decodeMutation=mutate=>{
    const data=JSON.parse(serialized);mutate(data.game.entities[0],data.game.entities[1]);return()=>decodeGame(JSON.stringify(data));
  };
  for(const mutate of [u=>u.stance='attack',(_u,v)=>v.stance='defend',u=>u.defendAnchor={x:-1,y:20},u=>u.retaliationTargetId=s.nextId,u=>{delete u.defendAnchor;u.retaliationTargetId=unit.id;},u=>{u.order={type:'move',x:25,y:20};},u=>u.defendReturning='yes'])assert.throws(decodeMutation(mutate),/damaged|incompatible/i);
  const legacy=JSON.parse(serialized);
  for(const u of legacy.game.entities){delete u.stance;delete u.defendAnchor;delete u.retaliationTargetId;delete u.defendReturning;}
  const loaded=decodeGame(JSON.stringify(legacy)).game,guard=loaded.entities.find(e=>e.id===unit.id),origin={x:guard.x,y:guard.y};
  assert.equal(effectiveUnitStance(guard),'guard');
  advance(loaded,2,()=>assert.equal(distance(guard,origin),0));
  assert.equal(decodeGame(serialized).game.entities[0].stance,'defend');
});
