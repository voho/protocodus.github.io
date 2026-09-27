import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, UNITS, issueOrder, stopUnits, updateGame, unitRole} from '../sim.js';
import {encodeGame, decodeGame} from '../save.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const goalsOf=units=>units.map(u=>({x:u.order.x,y:u.order.y}));
const span=(points,axis)=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]));

function scene(seed) {
  const s=createGame(seed,'normal',{width:72,height:56,aiTeams:[]});
  s.terrain.fill(0);s.minerals.fill(0);s.visible.forEach(v=>v.fill(1));
  const template=structuredClone(s.entities.find(e=>e.type==='rifle'));
  s.entities=[];s.navVersion++;
  const add=(type,x,y)=>{
    const d=UNITS[type],u={...structuredClone(template),id:s.nextId++,type,x,y,angle:0,size:d.size,hp:d.hp,maxHp:d.hp};
    if(d.role==='harvester')Object.assign(u,{cargo:0,unload:0,unloadDepotId:null,harvestPhase:'gather'});
    s.entities.push(u);return u;
  };
  return {s,add};
}

function checkGoals(s,units) {
  const goals=goalsOf(units);
  assert.equal(new Set(goals.map(p=>`${p.x},${p.y}`)).size,units.length,'Every unit reserves a distinct destination');
  units.forEach((u,i)=>{
    const p=goals[i],radius=u.size*.43+.08;
    assert(Number.isFinite(p.x+p.y));
    for(const dx of [-radius,radius])for(const dy of [-radius,radius]){
      const x=p.x+dx,y=p.y+dy;
      assert(x>=0&&y>=0&&x<s.width&&y<s.height&&!s.blocked[Math.floor(y)*s.width+Math.floor(x)],'Slots respect terrain and body clearance');
    }
    assert.equal(s.regions[Math.floor(p.y)*s.width+Math.floor(p.x)],s.regions[Math.floor(u.y)*s.width+Math.floor(u.x)],'Every slot remains reachable');
    for(let j=0;j<i;j++)assert(distance(p,goals[j])>=(u.size+units[j].size)*.43-.001,'Compact destinations never overlap');
  });
  return goals;
}

function arrive(s,units,goals,seconds) {
  for(let tick=0;tick<seconds*20;tick++){
    updateGame(s,.05);
    for(let i=0;i<units.length;i++)for(let j=0;j<i;j++)assert(distance(units[i],units[j])>=(units[i].size+units[j].size)*.43-.01,'Units do not pass through one another while gathering on open ground');
  }
  units.forEach((u,i)=>{
    assert(distance(u,goals[i])<=.081,`Unit ${u.id} reaches its own compact slot within ${seconds} seconds`);
    assert.equal(u.order.type,unitRole(u)==='harvester'?'harvest':'idle');
  });
}

test('a single-unit click beside an occupied point uses the nearest clear tile',()=>{
  const {s,add}=scene('single-occupied-point'),unit=add('tank',20.5,25.5),parked=add('tank',40.5,25.5);
  const target={x:parked.x,y:parked.y};
  issueOrder(s,[unit.id],{type:'move',...target});
  const [goal]=checkGoals(s,[unit]);
  assert(distance(goal,target)<=1,'An individual order must not inherit the wider flock parking spacing');
  assert(distance(goal,parked)>=(unit.size+parked.size)*.43,'The fallback clears the occupied body');
  assert.equal(unit.order.formation,undefined);
});

for(const type of ['move','attackMove'])test(`${type} gathers irregular mixed units into compact clear destinations`,()=>{
  const {s,add}=scene(`compact-mixed-${type}`);
  const units=[add('rifle',12.2,15.6),add('tank',14.4,15.9),add('harvester',13.1,18.4),add('scout',16.8,20.2),add('constructor',18.3,16.4)];
  const sourceWidth=span(units,'x'),target={x:48.3,y:31.7};
  issueOrder(s,units.map(u=>u.id),{type,...target});
  const goals=checkGoals(s,units);
  assert(goals.every(p=>distance(p,target)<3),'A small flock gathers close to the clicked point');
  assert(span(goals,'x')<sourceWidth*.65,'Loose source spacing is compressed at the destination');
});

test('a sparse grid gathers tightly while largely preserving front/back and left/right ordering',()=>{
  const {s,add}=scene('compact-sparse-grid'),units=[];
  for(let y=0;y<3;y++)for(let x=0;x<3;x++)units.push(add('tank',12+x*8,14+y*6));
  const starts=units.map(u=>({x:u.x,y:u.y})),target={x:50,y:34};
  issueOrder(s,units.map(u=>u.id).reverse(),{type:'move',...target});
  const goals=checkGoals(s,units);
  assert(goals.every(p=>distance(p,target)<=Math.sqrt(units.length)+1),'Gathering radius grows with flock size, not source spread');
  assert(span(goals,'x')<span(starts,'x')*.5&&span(goals,'y')<span(starts,'y')*.5,'Both source dimensions shrink into a compact flock');
  let comparisons=0,inversions=0;
  for(let i=0;i<units.length;i++)for(let j=0;j<i;j++){
    if(starts[i].y===starts[j].y){comparisons++;if((starts[i].x-starts[j].x)*(goals[i].x-goals[j].x)<-1e-8)inversions++;}
    if(starts[i].x===starts[j].x){comparisons++;if((starts[i].y-starts[j].y)*(goals[i].y-goals[j].y)<-1e-8)inversions++;}
  }
  assert(inversions<=comparisons*.15,'Compaction roughly preserves spatial rank instead of reversing the source rows');
  arrive(s,units,goals,80);
});

test('repeating a compact-flock click preserves reserved slots through temporary traffic distortion',()=>{
  const {s,add}=scene('compact-repeat'),units=[add('tank',20,20),add('rifle',21.5,20.4),add('scout',20.6,23.1)];
  const target={x:50.25,y:30.75};
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  const expected=checkGoals(s,units);
  units.forEach((u,i)=>{u.x=30+i*2;u.y=28-i;});
  issueOrder(s,units.map(u=>u.id).reverse(),{type:'move',...target});
  assert.deepEqual(goalsOf(units),expected);
});

test('a smaller selection regathers near the same click after the rest of its army stops',()=>{
  const {s,add}=scene('compact-subset'),units=[];
  for(let y=0;y<5;y++)for(let x=0;x<5;x++)units.push(add('tank',10+x*2,10+y*2));
  const target={x:50,y:35};
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  checkGoals(s,units);
  const subset=[...units].sort((a,b)=>distance(b.order,target)-distance(a.order,target)||a.id-b.id).slice(0,3);
  assert(subset.every(u=>distance(u.order,target)>3),'The chosen units previously owned outer slots in a large army');
  stopUnits(s,units.filter(u=>!subset.includes(u)).map(u=>u.id));
  issueOrder(s,subset.map(u=>u.id),{type:'move',...target});
  const goals=checkGoals(s,subset);
  assert(goals.every(p=>distance(p,target)<3),'A changed selection reserves a new small flock rather than keeping distant old slots');
});

test('repeating a legacy rigid-formation order gathers its saved units into a compact flock',()=>{
  const {s,add}=scene('compact-legacy-save');
  const units=[add('tank',12,15),add('tank',30,15),add('tank',12,27),add('tank',30,27)],target={x:50,y:35};
  for(const u of units){
    const dx=u.x-21,dy=u.y-21;
    u.order={type:'move',x:target.x+dx,y:target.y+dy,formation:{...target,dx,dy}};
  }
  const restored=decodeGame(encodeGame(s)).game,restoredUnits=units.map(u=>restored.entities.find(e=>e.id===u.id));
  assert(goalsOf(restoredUnits).every(p=>distance(p,target)>10),'The legacy save preserves widely separated source offsets');
  issueOrder(restored,restoredUnits.map(u=>u.id),{type:'move',...target});
  const goals=checkGoals(restored,restoredUnits);
  assert(goals.every(p=>distance(p,target)<3),'A new order migrates old rigid slots to compact destinations');
});

for(const type of ['tank','harvester'])test(`a repeated click retains compact slots after a ${type} arrives and the game is saved`,()=>{
  const {s,add}=scene(`compact-partial-arrival-${type}`),units=[add(type,20,20),add('tank',24,20)];
  const target={x:50,y:25};
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  const expected=checkGoals(s,units);
  units[0].x=units[0].order.x;units[0].y=units[0].order.y;
  updateGame(s,.05);
  assert.equal(units[0].order.type,type==='harvester'?'harvest':'idle');
  assert.equal(units[1].order.type,'move');
  const restored=decodeGame(encodeGame(s)).game,restoredUnits=units.map(u=>restored.entities.find(e=>e.id===u.id));
  issueOrder(restored,restoredUnits.map(u=>u.id),{type:'move',...target});
  assert.deepEqual(goalsOf(restoredUnits),expected);
});

test('a blocked gathering point reserves nearby clear slots and retains them on repeated clicks',()=>{
  const {s,add}=scene('compact-obstacle'),units=[add('tank',20,20),add('tank',22,20),add('tank',20,22),add('tank',22,22)];
  const target={x:49.5,y:29.5};
  s.terrain[29*s.width+49]=1;
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  const goals=checkGoals(s,units);
  assert(goals.every(p=>distance(p,target)<3),'A small obstruction should only spread slots into nearby clear ground');
  units.forEach((u,i)=>{u.x=30+i;u.y=25+i;});
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  assert.deepEqual(goalsOf(units),goals,'The same click retains valid obstacle fallback slots');
});

test('compact-flock fallbacks stay reachable across a sealed wall and map edge',()=>{
  const {s,add}=scene('compact-region'),units=[add('tank',20,20),add('tank',22,20),add('tank',20,22)];
  for(let y=0;y<s.height;y++)s.terrain[y*s.width+35]=1;
  issueOrder(s,units.map(u=>u.id),{type:'move',x:71.5,y:.5});
  checkGoals(s,units);
  for(const u of units)assert(u.order.x<35,'Unreachable clicks reserve positions on the source side of a sealed wall');
});

for(const angle of [0,Math.PI])test(`mixed units gather and settle from starting heading ${angle}`,()=>{
  const {s,add}=scene(`compact-travel-${angle}`);
  const units=[add('rifle',20,20),add('tank',23,20),add('scout',20,23),add('constructor',23,23)];
  units.forEach(u=>{u.angle=angle;});
  const target={x:50,y:35};
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  const goals=checkGoals(s,units);
  assert(goals.every(p=>distance(p,target)<3));
  arrive(s,units,goals,30);
});
