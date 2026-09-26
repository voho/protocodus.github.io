import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, UNITS, issueOrder, updateGame, stopUnits} from '../sim.js';
import {encodeGame, decodeGame} from '../save.js';
import {createFlockSnapshot, flockSteering} from '../flocking.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const turn=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
function scene(seed='boids-regression') {
  const s=createGame(seed,'normal',{width:72,height:56,aiTeams:[]});
  s.terrain.fill(0);s.minerals.fill(0);s.visible.forEach(v=>v.fill(1));
  const template=structuredClone(s.entities.find(e=>e.type==='rifle'));
  s.entities=[];s.navVersion++;
  const add=(type,x,y,angle=0)=>{
    const d=UNITS[type],u={...structuredClone(template),id:s.nextId++,type,x,y,angle,size:d.size,hp:d.hp,maxHp:d.hp};
    s.entities.push(u);return u;
  };
  return {s,add};
}
function command(s,u,x,y) {
  issueOrder(s,[u.id],{type:'move',x,y});
  return {x:u.order.x,y:u.order.y};
}
function advance(s) {
  const before=new Map(s.entities.map(u=>[u.id,{x:u.x,y:u.y,angle:u.angle}]));
  updateGame(s,.05);
  for(const u of s.entities) {
    const old=before.get(u.id),length=distance(old,u);
    const d=UNITS[u.type],rate=d.armor==='infantry'?7:['scout','striker'].includes(d.role)?2.6:1.8;
    assert(turn(old.angle,u.angle)<=rate*.05+1e-8,'Flocking uses a bounded body turn');
    const dx=u.x-old.x,dy=u.y-old.y,fx=Math.cos(u.angle),fy=Math.sin(u.angle);
    assert(Math.abs(dx*fy-dy*fx)<=1e-8&&dx*fx+dy*fy>=-1e-8,`Flocking travel follows the current body heading: unit ${u.id} at ${s.time.toFixed(2)}s moved (${dx}, ${dy}) with heading ${u.angle}`);
    const steps=Math.max(1,Math.ceil(length/.08));
    for(let step=1;step<=steps;step++)for(const dx of [-.189,.189])for(const dy of [-.189,.189]) {
      const x=old.x+(u.x-old.x)*step/steps+dx,y=old.y+(u.y-old.y)*step/steps+dy;
      assert(x>=0&&y>=0&&x<s.width&&y<s.height,'Steering stays within the battlefield');
      assert.equal(s.blocked[Math.floor(y)*s.width+Math.floor(x)],0,'Steering cannot cut a solid obstacle');
    }
  }
}

test('cohesion steers toward compatible distant neighbors without following guards or enemies',()=>{
  const u={id:1,team:0,x:20,y:25,size:.8},goal={x:50,y:25};
  const other={id:2,team:0,x:20,y:28,size:.8,vx:0,vy:0,goal:{x:50,y:28}};
  const direction=flockSteering(u,goal,[other],0);
  assert(direction&&direction.x>0&&direction.y>0,'An ally beyond separation range attracts the group');
  for(const neighbor of [{...other,goal:null},{...other,team:1},{...other,goal:{x:10,y:28}}]) {
    assert.equal(flockSteering(u,goal,[neighbor],0),null,'Guards, enemies and unrelated orders do not attract the group');
  }
});

test('alignment responds to the actual headings of nearby traveling allies',()=>{
  const u={id:1,team:0,x:20,y:25,size:.8},goal={x:50,y:25};
  const other={id:2,team:0,x:23,y:25,size:.8,vx:1,vy:0,goal:{x:50,y:25}};
  assert.equal(flockSteering(u,goal,[other],0),null,'Matching motion on a straight route needs no lateral steering');
  const direction=flockSteering(u,goal,[{...other,vy:1}],0);
  assert(direction&&direction.y>0,'A turning herd biases the mover toward its shared heading');
  assert.equal(flockSteering(u,goal,[{...other,vx:0,vy:0}],0),null,'Stationary bodies have no velocity to align to');
});

test('formation cohesion preserves offsets and corrects displacement from assigned lanes',()=>{
  const formation={x:50,y:25,dx:0,dy:-1.5};
  const u={id:1,team:0,x:20,y:23.5,size:.8,order:{type:'move',formation}},goal={x:50,y:23.5};
  const other={id:2,team:0,x:20,y:26.5,size:.8,vx:1,vy:0,goal:{x:50,y:26.5},formation:{...formation,dy:1.5}};
  assert.equal(flockSteering(u,goal,[other],0),null,'An intact formation must not contract toward its center');
  const displaced={...u,y:20.5};
  const correction=flockSteering(displaced,goal,[{...other,y:23.5}],0,{x:50,y:20.5});
  assert.equal(correction,null,'Equal displacement of both lanes preserves their relative offsets');
  const narrow={...other,y:23.5,goal:{x:50,y:23.5},formation:{...formation,dy:-1.5}};
  assert(flockSteering(displaced,goal,[narrow],0,{x:50,y:20.5})?.y>0,'A unit displaced from the shared translation rejoins the formation');
});

test('separation avoids parked bodies and coincident spawns and remains active during arrival',()=>{
  const u={id:1,team:0,x:20,y:25,size:.8},goal={x:50,y:25};
  const parked={id:2,team:0,x:20,y:25.8,size:.8,vx:0,vy:0,goal:null};
  assert(flockSteering(u,goal,[parked],0).y<0,'A parked ally still repels an approaching unit');
  assert(flockSteering(u,goal,[{...parked,team:1}],0).y<0,'Hostile body spacing remains solid');
  const a=flockSteering(u,goal,[{...parked,x:20,y:25}],0);
  const b=flockSteering({...u,id:2},goal,[{...parked,id:1,x:20,y:25}],0);
  assert(Number.isFinite(a.x+a.y+b.x+b.y)&&a.y*b.y<0,'Coincident units choose finite opposite escape directions');
  assert(flockSteering(u,{x:20.5,y:25},[parked],0).y<0,'Body clearance still takes priority beside the destination');
});

test('comfortably spaced parallel movers keep stable straight lanes',()=>{
  const {s,add}=scene('stable-flock'),a=add('tank',20,25),b=add('tank',20,25.9);
  command(s,a,50,25);command(s,b,50,25.9);
  for(let tick=0;tick<800;tick++) {
    advance(s);
    assert.equal(a.y,25);assert.equal(b.y,25.9);
    assert.equal(a.angle,0);assert.equal(b.angle,0);
  }
  assert.equal(a.order.type,'idle');assert.equal(b.order.type,'idle');
});

test('a flock neighborhood is fixed for a tick and ignores dead units and buildings',()=>{
  const {s,add}=scene('flock-snapshot'),a=add('tank',20,25),b=add('tank',22,25),c=add('tank',21,27);
  command(s,b,50,25);b.moving=true;b.moveSpeed=2;
  c.hp=0;
  const building={...structuredClone(b),id:s.nextId++,kind:'building'};
  const neighbors=createFlockSnapshot([...s.entities,building]),before=structuredClone(neighbors(a));
  assert.deepEqual(before.map(u=>u.id),[b.id]);
  b.x=60;b.angle=Math.PI;b.order.x=5;
  assert.deepEqual(neighbors(a),before,'Moving an earlier entity cannot change a later unit’s neighborhood');
});

test('parked workers and repairing engineers do not advertise stale flock destinations',()=>{
  const {s,add}=scene('stationary-workers'),mover=add('tank',20,25),worker=add('harvester',23,25),engineer=add('engineer',20,28);
  worker.order={type:'harvest'};worker.path=[];worker.pathGoal={x:50,y:25};worker.moving=false;
  engineer.order={type:'attackMove',x:50,y:25};engineer.path=[{x:50,y:25}];engineer.repairActive=true;
  const neighbors=createFlockSnapshot(s.entities)(mover);
  assert.deepEqual(neighbors.map(u=>u.goal),[null,null],'Work in place does not attract passing units toward an obsolete route');
  assert.equal(flockSteering(mover,{x:50,y:25},neighbors,0),null);
  worker.moving=true;worker.moveSpeed=2;worker.order.formation={x:40,y:25,dx:0,dy:0};
  const hauling=createFlockSnapshot(s.entities)(mover).find(other=>other.id===worker.id);
  assert.deepEqual(hauling.goal,worker.pathGoal,'An active hauler advertises its current resource route');
  assert.equal(hauling.formation,null,'Resumed harvesting cannot reactivate a completed formation');
});

test('a nearby herd across a solid wall does not pull a unit off its clear route',()=>{
  const {s,add}=scene('separated-herds'),a=add('tank',20,25.5),b=add('tank',20,27.5);
  for(let x=0;x<s.width;x++)s.terrain[26*s.width+x]=1;
  command(s,a,50,25.5);command(s,b,50,27.5);
  for(let tick=0;tick<300;tick++) {
    advance(s);
    assert.equal(a.y,25.5,'An obstructed neighbor cannot cause cohesion steering');
    assert.equal(a.angle,0);
  }
  assert(a.x>30,'The unit follows its own open route');
});

test('compressed parallel movers separate and still settle into their exact destinations',()=>{
  const {s,add}=scene(),a=add('tank',20,25),b=add('tank',20,25.72);
  const goals=[command(s,a,50,25),command(s,b,50,25.9)];
  assert.deepEqual(goals,[{x:50,y:25},{x:50,y:25.9}],'Distinct reserved destinations remain at their requested spacing');
  let separation=distance(a,b),activeSteering=false,curving=false;
  for(let tick=0;tick<1600;tick++) {
    const previous={x:a.x,y:a.y,angle:a.angle};
    advance(s);
    if(Math.max(a.x,b.x)<35)separation=Math.max(separation,distance(a,b));
    activeSteering ||= a.y<24.99;
    curving ||= distance(previous,a)>1e-8&&turn(previous.angle,a.angle)>1e-8;
    assert(distance(a,b)>=(a.size+b.size)*.43-.01,'Separation never lets the moving bodies intersect');
  }
  assert(activeSteering&&curving,'The fixture exercises visible flock steering while traveling');
  assert(separation>.85,'Compressed allies restore comfortable clearance while moving together');
  [a,b].forEach((u,i)=>{assert(distance(u,goals[i])<=.081);assert.equal(u.order.type,'idle');assert.equal(u.moving,false);});
});

test('an active flock turn resumes exactly from a save and a stop cancels it',()=>{
  const {s,add}=scene('saved-flock'),units=[add('tank',20,25),add('tank',20,25.72)];
  units.forEach((u,i)=>command(s,u,50,25+i*.9));
  let curving=false;
  for(let tick=0;tick<200&&!curving;tick++){
    const before=units.map(u=>({x:u.x,y:u.y,angle:u.angle}));advance(s);
    curving=units.some((u,i)=>distance(u,before[i])>1e-8&&turn(u.angle,before[i].angle)>1e-8);
  }
  assert(curving,'Save while the herd is visibly turning and traveling');
  const saved=encodeGame(s),restored=decodeGame(saved).game;
  const damaged=JSON.parse(saved),path=damaged.game.entities.find(u=>u.path.length).path;
  path[0].flock='true';
  assert.throws(()=>decodeGame(JSON.stringify(damaged)),/damaged|incompatible/,'Saved steering flags must be boolean');
  for(const invalid of [0,-1,.5,s.nextId,'1']) {
    const malformed=JSON.parse(saved);malformed.game.entities[0].passTargetId=invalid;
    assert.throws(()=>decodeGame(JSON.stringify(malformed)),/damaged|incompatible/,'A temporary passing target must be a valid entity ID');
    const badRoute=JSON.parse(saved);badRoute.game.entities.find(u=>u.path.length).path[0].trafficId=invalid;
    assert.throws(()=>decodeGame(JSON.stringify(badRoute)),/damaged|incompatible/,'A traffic detour must reference a valid entity ID');
  }
  const cancelled=decodeGame(encodeGame(s)).game;
  stopUnits(cancelled,units.map(u=>u.id));
  const stopped=cancelled.entities.map(u=>({x:u.x,y:u.y}));
  for(let tick=0;tick<30;tick++)advance(cancelled);
  assert.deepEqual(cancelled.entities.map(u=>({x:u.x,y:u.y})),stopped,'Stopping during a curve holds the current position');
  for(let tick=0;tick<700;tick++) {advance(s);advance(restored);}
  assert.deepEqual(restored.entities,s.entities,'Stored steering decisions continue identically');
  assert.equal(restored.rng,s.rng);
});

test('a flock passes a narrow obstacle opening without cutting corners or losing its assigned slots',()=>{
  const {s,add}=scene('flock-obstacles');
  for(let y=0;y<s.height;y++)if(y<25||y>26)s.terrain[y*s.width+34]=1;
  const units=[add('tank',20.5,23.5),add('tank',20.5,25.5),add('tank',20.5,27.5)];
  issueOrder(s,units.map(u=>u.id),{type:'move',x:49.2,y:25.7});
  const goals=units.map(u=>({x:u.order.x,y:u.order.y}));
  for(let tick=0;tick<1800&&units.some(u=>u.order.type==='move');tick++)advance(s);
  units.forEach((u,i)=>{assert(distance(u,goals[i])<=.081,`Unit ${i} reaches its own slot`);assert.equal(u.order.type,'idle');});
});
