import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, UNITS, issueOrder, updateGame} from '../sim.js';
import {encodeGame, decodeGame} from '../save.js';

const close=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-9,message);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

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

function translated(units,target) {
  const cx=units.reduce((sum,u)=>sum+u.x,0)/units.length,cy=units.reduce((sum,u)=>sum+u.y,0)/units.length;
  return units.map(u=>({x:target.x+u.x-cx,y:target.y+u.y-cy}));
}

function assertGoals(units,expected) {
  units.forEach((u,i)=>{
    close(u.order.x,expected[i].x,`Unit ${i} preserves its horizontal source offset`);
    close(u.order.y,expected[i].y,`Unit ${i} preserves its vertical source offset`);
  });
}

for(const type of ['move','attackMove'])test(`${type} preserves an irregular mixed-unit formation exactly on open ground`,()=>{
  const {s,add}=scene(`mixed-formation-${type}`);
  const units=[add('rifle',12.2,15.6),add('tank',14.4,15.9),add('harvester',13.1,18.4),add('scout',16.8,20.2),add('constructor',18.3,16.4)];
  const target={x:48.3,y:31.7},expected=translated(units,target);
  issueOrder(s,units.map(u=>u.id),{type,...target});
  assertGoals(units,expected);
  close(units.reduce((sum,u)=>sum+u.order.x,0)/units.length,target.x,'The formation center reaches the clicked x coordinate');
  close(units.reduce((sum,u)=>sum+u.order.y,0)/units.length,target.y,'The formation center reaches the clicked y coordinate');
});

test('repeating a group click preserves the original formation through temporary traffic distortion',()=>{
  const {s,add}=scene('formation-repeat'),units=[add('tank',20,20),add('rifle',21.5,20.4),add('scout',20.6,23.1)];
  const target={x:50.25,y:30.75},expected=translated(units,target);
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  units.forEach((u,i)=>{u.x=30+i*2;u.y=28-i;});
  issueOrder(s,units.map(u=>u.id).reverse(),{type:'move',...target});
  assertGoals(units,expected);
});

for(const type of ['tank','harvester'])test(`a repeated click retains the formation after a ${type} arrives and the game is saved`,()=>{
  const {s,add}=scene(`formation-partial-arrival-${type}`),units=[add(type,20,20),add('tank',24,20)];
  const target={x:50,y:25},expected=translated(units,target);
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  // Exercise the natural arrival transition while another group member is still
  // en route, without depending on which vehicle happens to win a traffic yield.
  units[0].x=units[0].order.x;units[0].y=units[0].order.y;
  updateGame(s,.05);
  assert.equal(units[0].order.type,type==='harvester'?'harvest':'idle');
  assert.equal(units[1].order.type,'move');
  const restored=decodeGame(encodeGame(s)).game,restoredUnits=units.map(u=>restored.entities.find(e=>e.id===u.id));
  issueOrder(restored,restoredUnits.map(u=>u.id),{type:'move',...target});
  assertGoals(restoredUnits,expected);
});

test('an obstructed translated slot moves locally while the other formation slots stay exact',()=>{
  const {s,add}=scene('formation-obstacle'),units=[add('tank',20,20),add('tank',22,20),add('tank',20,22),add('tank',22,22)];
  const target={x:49.5,y:29.5},expected=translated(units,target);
  s.terrain[Math.floor(expected[0].y)*s.width+Math.floor(expected[0].x)]=1;
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  assert(distance(units[0].order,expected[0])>.1,'The blocked slot cannot remain inside rock');
  assert(distance(units[0].order,expected[0])<=1.01,'Only the obstructed unit uses the nearest local fallback');
  assertGoals(units.slice(1),expected.slice(1));
  units.forEach((u,i)=>{
    assert.equal(s.blocked[Math.floor(u.order.y)*s.width+Math.floor(u.order.x)],0);
    for(let j=0;j<i;j++)assert(distance(u.order,units[j].order)>=(u.size+units[j].size)*.43,'Fallback slots retain body clearance');
  });
  const fallback=units.map(u=>({...u.order}));
  units.forEach((u,i)=>{u.x=30+i;u.y=25+i;});
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  assert.deepEqual(units.map(u=>u.order),fallback,'The same click also retains a valid obstacle fallback');
});

test('formation fallbacks stay reachable when translated positions cross a sealed wall or map edge',()=>{
  const {s,add}=scene('formation-region'),units=[add('tank',20,20),add('tank',22,20),add('tank',20,22)];
  for(let y=0;y<s.height;y++)s.terrain[y*s.width+35]=1;
  issueOrder(s,units.map(u=>u.id),{type:'move',x:71.5,y:.5});
  for(const u of units){
    assert(u.order.x<35&&u.order.y>=0&&u.order.y<s.height,'An unreachable translated slot falls back within the battlefield');
    assert.equal(s.regions[Math.floor(u.order.y)*s.width+Math.floor(u.order.x)],s.regions[Math.floor(u.y)*s.width+Math.floor(u.x)],'Fallback shares the source connected region');
  }
  for(let i=0;i<units.length;i++)for(let j=0;j<i;j++)assert(distance(units[i].order,units[j].order)>=(units[i].size+units[j].size)*.43);
});

for(const angle of [0,Math.PI])test(`mixed units preserve their relative positions during open-ground cruise from heading ${angle}`,()=>{
  const {s,add}=scene(`formation-cruise-${angle}`);
  const units=[add('rifle',20,20),add('tank',23,20),add('scout',20,23),add('constructor',23,23)];
  units.forEach(u=>{u.angle=angle;});
  const starts=units.map(u=>({x:u.x,y:u.y})),target={x:50,y:35},goals=translated(units,target);
  issueOrder(s,units.map(u=>u.id),{type:'move',...target});
  for(const u of units)assert.equal(u.order.speedLimit,2,'A mixed formation shares the slowest unit’s travel pace');
  for(let tick=0;tick<240;tick++){
    updateGame(s,.05);
    if(tick<100)continue;
    for(let i=0;i<units.length;i++)for(let j=0;j<i;j++){
      const dx=(units[i].x-starts[i].x)-(units[j].x-starts[j].x),dy=(units[i].y-starts[i].y)-(units[j].y-starts[j].y);
      const allowance=angle===0?.15:2;
      assert(Math.hypot(dx,dy)<allowance,'Cruising units retain their source offsets without a large gap after turning');
    }
  }
  units.forEach((u,i)=>assert(distance(u,starts[i])>10,'The formation must make progress while retaining its shape'));
  for(let tick=240;tick<600;tick++)updateGame(s,.05);
  units.forEach((u,i)=>{assert(distance(u,goals[i])<=.081,'Every unit settles into its original translated offset');assert.equal(u.order.type,'idle');});
});
