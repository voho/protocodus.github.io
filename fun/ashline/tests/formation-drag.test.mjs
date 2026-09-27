import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, UNITS, issueOrder, updateGame} from '../sim.js';
import {encodeGame, decodeGame} from '../save.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const angleDifference=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const goalsOf=units=>units.map(u=>({x:u.order.x,y:u.order.y}));

function scene(seed) {
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

function rotatedGoals(units,target,angle) {
  const cx=units.reduce((sum,u)=>sum+u.x,0)/units.length,cy=units.reduce((sum,u)=>sum+u.y,0)/units.length;
  return units.map(u=>({x:target.x+(u.x-cx)*Math.cos(angle)-(u.y-cy)*Math.sin(angle),y:target.y+(u.x-cx)*Math.sin(angle)+(u.y-cy)*Math.cos(angle)}));
}

function checkGoals(s,units,expected) {
  units.forEach((u,i)=>{
    const goal=u.order,radius=u.size*.43+.08;
    if(expected)assert(distance(goal,expected[i])<1e-9,`Unit ${i} receives its rotated source offset around the clicked center`);
    for(const dx of [-radius,radius])for(const dy of [-radius,radius]){
      const x=goal.x+dx,y=goal.y+dy;
      assert(x>=0&&y>=0&&x<s.width&&y<s.height&&!s.blocked[Math.floor(y)*s.width+Math.floor(x)],'Rotated slots retain full terrain clearance');
    }
    assert.equal(s.regions[Math.floor(goal.y)*s.width+Math.floor(goal.x)],s.regions[Math.floor(u.y)*s.width+Math.floor(u.x)]);
    for(let j=0;j<i;j++)assert(distance(goal,units[j].order)>=(u.size+units[j].size)*.43-.001,'Rotated units own separate slots');
  });
}

for(const degrees of [0,90,180,270])test(`a formation drag rotates source offsets by ${degrees} degrees around the clicked center`,()=>{
  const {s,add}=scene(`formation-drag-${degrees}`);
  const units=[add('rifle',12.2,15.6),add('tank',17.4,15.9),add('scout',13.1,22.4),add('constructor',22.3,18.4)];
  const target={x:48.3,y:31.7},formationAngle=degrees*Math.PI/180,expected=rotatedGoals(units,target,formationAngle);
  issueOrder(s,units.map(u=>u.id).reverse(),{type:'move',...target,formationAngle});
  checkGoals(s,units,expected);
  for(let i=0;i<units.length;i++)for(let j=0;j<i;j++)assert(Math.abs(distance(units[i].order,units[j].order)-distance(units[i],units[j]))<1e-9,'Rotation preserves pair distances instead of compacting the dragged layout');
});

test('a repeated formation drag retains its rotated slots after traffic distortion and save restoration',()=>{
  const {s,add}=scene('formation-drag-repeat'),units=[add('tank',20,20),add('rifle',24,20),add('scout',21,25)];
  const command={type:'move',x:50.25,y:30.75,formationAngle:Math.PI/2,facing:Math.PI/2},expected=rotatedGoals(units,command,command.formationAngle);
  issueOrder(s,units.map(u=>u.id),command);
  checkGoals(s,units,expected);
  units.forEach((u,i)=>{u.x=30+i*2;u.y=28-i;});
  const restored=decodeGame(encodeGame(s)).game,restoredUnits=units.map(u=>restored.entities.find(e=>e.id===u.id));
  issueOrder(restored,restoredUnits.map(u=>u.id).reverse(),command);
  checkGoals(restored,restoredUnits,expected);
});

test('a held drag uses frozen source offsets even when units move before release',()=>{
  const {s,add}=scene('formation-drag-frozen'),units=[add('tank',20,20),add('rifle',24,20),add('scout',21,25)];
  const cx=units.reduce((sum,u)=>sum+u.x,0)/units.length,cy=units.reduce((sum,u)=>sum+u.y,0)/units.length;
  const offsets=units.map(u=>({id:u.id,x:u.x-cx,y:u.y-cy}));
  const command={type:'move',x:50.25,y:30.75,formationAngle:Math.PI/2,facing:Math.PI/2},expected=rotatedGoals(units,command,command.formationAngle);
  // The ongoing order keeps running while the player holds the preview open.
  issueOrder(s,units.map(u=>u.id),{type:'move',x:35,y:25});
  for(let tick=0;tick<30;tick++)updateGame(s,.05);
  const currentLayout=rotatedGoals(units,command,command.formationAngle);
  assert(currentLayout.some((p,i)=>distance(p,expected[i])>.1),'The fixture changes the source layout while holding the drag');
  issueOrder(s,units.map(u=>u.id),{...command,formationOffsets:[...offsets].reverse()});
  checkGoals(s,units,expected);
});

test('saving during the final facing turn resumes the same bounded stationary rotation',()=>{
  const {s,add}=scene('formation-final-turn-save'),u=add('tank',20,20);
  const command={type:'move',x:23,y:20,formationAngle:0,facing:Math.PI/2};
  issueOrder(s,[u.id],command);
  for(let tick=0;tick<200;tick++){
    updateGame(s,.05);
    if(distance(u,command)<=.081&&u.order.type==='move'&&Math.abs(u.turnVelocity||0)>.01&&angleDifference(u.angle,command.facing)>.05)break;
  }
  assert(distance(u,command)<=.081&&u.order.type==='move'&&angleDifference(u.angle,command.facing)>.05,'The save is taken after arrival but before the final body turn completes');
  const parked={x:u.x,y:u.y},restored=decodeGame(encodeGame(s)).game;
  for(let tick=0;tick<100;tick++){
    const previous=u.angle;
    updateGame(s,.05);updateGame(restored,.05);
    assert(distance(u,parked)<1e-9,'Final facing changes do not displace the parked unit');
    assert(angleDifference(u.angle,previous)<=1.8*.05+1e-8,'Final facing respects the vehicle turn-rate bound');
  }
  assert.deepEqual(restored.entities,s.entities,'Saved turn velocity and facing continue identically');
  assert.equal(restored.rng,s.rng);
  assert.equal(u.order.type,'idle');
  assert(angleDifference(u.angle,command.facing)<=.012);
});

test('a blocked rotated slot uses nearby ground while other preserved slots remain exact',()=>{
  const {s,add}=scene('formation-drag-obstacle'),units=[add('tank',20,20),add('tank',24,20),add('tank',20,24),add('tank',24,24)];
  const command={type:'move',x:49.5,y:29.5,formationAngle:Math.PI/2},expected=rotatedGoals(units,command,command.formationAngle);
  s.terrain[Math.floor(expected[0].y)*s.width+Math.floor(expected[0].x)]=1;
  issueOrder(s,units.map(u=>u.id),command);
  checkGoals(s,units);
  assert(distance(units[0].order,expected[0])>.1&&distance(units[0].order,expected[0])<=1.01,'Only the obstructed slot moves to the nearest clear cell');
  units.slice(1).forEach((u,i)=>assert(distance(u.order,expected[i+1])<1e-9,'Unobstructed rotated offsets stay fixed'));
  const goals=goalsOf(units);
  issueOrder(s,units.map(u=>u.id).reverse(),command);
  assert.deepEqual(goalsOf(units),goals,'Repeating a drag keeps valid obstacle fallback slots');
});

test('quick-click and held-drag orders switch between compact and preserved layouts',()=>{
  const {s,add}=scene('formation-drag-modes'),units=[add('tank',12,20),add('tank',20,20),add('tank',28,20)];
  const command={type:'move',x:50,y:30},expected=rotatedGoals(units,command,0);
  issueOrder(s,units.map(u=>u.id),{...command,formationAngle:0});
  checkGoals(s,units,expected);
  issueOrder(s,units.map(u=>u.id),command);
  assert(goalsOf(units).every(p=>distance(p,command)<3),'A quick click compacts a previously preserved formation');
  issueOrder(s,units.map(u=>u.id),{...command,formationAngle:0});
  checkGoals(s,units,expected);
});

test('dragged units turn while moving and settle into their rotated slots with the requested facing',()=>{
  const {s,add}=scene('formation-drag-facing');
  const units=[add('rifle',20,20,Math.PI),add('tank',24,20,Math.PI),add('scout',20,24,Math.PI),add('constructor',24,24,Math.PI)];
  const command={type:'move',x:40,y:30,formationAngle:Math.PI/2,facing:-Math.PI/2},expected=rotatedGoals(units,command,command.formationAngle);
  issueOrder(s,units.map(u=>u.id),command);
  checkGoals(s,units,expected);
  let movingTurn=false;
  for(let tick=0;tick<600;tick++){
    const before=units.map(u=>({x:u.x,y:u.y,angle:u.angle}));
    updateGame(s,.05);
    units.forEach((u,i)=>{movingTurn ||= distance(u,before[i])>1e-6&&angleDifference(u.angle,before[i].angle)>1e-6;});
    for(let i=0;i<units.length;i++)for(let j=0;j<i;j++)assert(distance(units[i],units[j])>=(units[i].size+units[j].size)*.43-.01,'Dragged units do not cross through one another');
  }
  assert(movingTurn,'Units visibly rotate while traveling through the maneuver');
  units.forEach((u,i)=>{
    assert(distance(u,expected[i])<=.081,'Every dragged unit reaches its rotated slot within 30 seconds');
    assert.equal(u.order.type,'idle');
    assert(angleDifference(u.angle,command.facing)<=.012,'The final body heading matches the drag direction');
  });
});
