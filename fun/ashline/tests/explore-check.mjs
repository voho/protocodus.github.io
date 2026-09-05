import assert from 'node:assert/strict';
import {UNITS,createGame,updateGame,issueOrder,stopUnits,placeBuilding} from '../sim.js';

const advance=(s,seconds,check)=>{for(let i=0;i<Math.ceil(seconds/.1);i++){updateGame(s,.1);check?.();}};
const tile=(s,u)=>Math.floor(u.y)*s.width+Math.floor(u.x);
const footprint=(s,team=0)=>s.explored[team].reduce((sum,value)=>sum+value,0);
const field=(type='scout',team=0,seed='explore')=>{
  const s=createGame(seed),u=s.entities.find(e=>e.team===team&&e.type===type)||s.entities.find(e=>e.team===team&&e.type==='rifle');
  Object.assign(u,{type,hp:UNITS[type].hp,maxHp:UNITS[type].hp,size:UNITS[type].size,x:35.5,y:28.5,path:[],repath:0,cooldown:0,order:{type:type==='harvester'?'harvest':'idle'}});
  s.entities=[u];s.ai.nextThink=Infinity;s.terrain.fill(0);s.minerals.fill(0);s.navVersion++;
  for(const cells of [...s.visible,...s.explored])cells.fill(0);
  s.fogClock=0;advance(s,.1);return{s,u};
};

// Every unit type and either faction can enter the mode and return to its normal default.
for(const team of [0,1])for(const type of Object.keys(UNITS)){
  const {s,u}=field(type,team,`explore-${team}-${type}`),before=footprint(s,team);
  issueOrder(s,[u.id],{type:'explore'});assert.equal(u.order.type,'explore',`${type} accepts exploration for team ${team}`);
  advance(s,3);assert(footprint(s,team)>before,`${type} reveals new ground while exploring`);
  s.explored[team].fill(1);advance(s,.3);
  assert.equal(u.order.type,type==='harvester'?'harvest':'idle',`${type} returns to its default once the map is explored`);
}

// Exploration continues across several sight radii, without needing another player command.
const roaming=field(),initial=footprint(roaming.s);let traveled=0,last={x:roaming.u.x,y:roaming.u.y};
issueOrder(roaming.s,[roaming.u.id],{type:'explore'});
const measure=()=>{traveled+=Math.hypot(roaming.u.x-last.x,roaming.u.y-last.y);last={x:roaming.u.x,y:roaming.u.y};assert.equal(roaming.s.blocked[tile(roaming.s,roaming.u)],0);};
advance(roaming.s,15,measure);const midway=footprint(roaming.s);
assert(midway>initial+300,'One explore command reveals a substantial first area');
advance(roaming.s,55,measure);
assert(footprint(roaming.s)>midway+300,'Exploration keeps finding new areas after its first destination');
assert(traveled>roaming.s.width,'Automatic exploration travels farther than one map width');

// Manual orders and Stop replace the mode, including for economy units carrying cargo.
for(const type of ['rifle','harvester'])for(const command of ['move','attack','attackMove','harvest','stop']){
  const {s,u}=field(type);if(type==='harvester'){u.cargo=75;u.harvestPhase='return';}
  issueOrder(s,[u.id],{type:'explore'});advance(s,.2);
  if(command==='stop')stopUnits(s,[u.id]);else issueOrder(s,[u.id],{type:command,x:u.x+2,y:u.y});
  assert.notEqual(u.order.type,'explore',`${command} cancels ${type} exploration`);
  advance(s,4);assert.notEqual(u.order.type,'explore',`${type} must not silently restart exploration after ${command}`);
  if(type==='harvester')assert.equal(u.cargo,75,'Exploration and cancellation preserve carried minerals');
}

// Complete the reachable corridor, then give up cleanly on a disconnected unknown island.
for(const type of ['scout','harvester']){
  const {s,u}=field(type);s.terrain.fill(1);
  for(let y=25;y<=31;y++)for(let x=2;x<=45;x++)s.terrain[y*s.width+x]=0;
  for(let y=25;y<=31;y++)for(let x=62;x<=69;x++)s.terrain[y*s.width+x]=0;
  u.x=6.5;u.y=28.5;for(const cells of [...s.visible,...s.explored])cells.fill(0);s.navVersion++;s.fogClock=0;
  issueOrder(s,[u.id],{type:'explore'});advance(s,65);
  for(let y=25;y<=31;y++)for(let x=2;x<=45;x++)assert.equal(s.explored[0][y*s.width+x],1,'All reachable corridor ground is explored');
  assert.equal(s.explored[0][28*s.width+65],0,'Disconnected ground stays unexplored');
  assert.equal(u.order.type,type==='harvester'?'harvest':'idle','Unreachable unknown ground must not trap an explorer forever');
}

// A newly placed structure blocks an existing route; exploration uses the available detour.
const reroute=field(),core=createGame('explore-core').entities.find(e=>e.team===0&&e.type==='core');
core.id=reroute.s.nextId++;core.x=14;core.y=25;reroute.s.entities.push(core);reroute.s.terrain.fill(1);
for(let y=28;y<=29;y++)for(let x=2;x<=60;x++)reroute.s.terrain[y*reroute.s.width+x]=0;
for(let y=28;y<=34;y++)for(let x=22;x<=27;x++)reroute.s.terrain[y*reroute.s.width+x]=0;
reroute.u.x=19.5;reroute.u.y=28.5;for(const cells of [...reroute.s.visible,...reroute.s.explored])cells.fill(0);
reroute.s.navVersion++;reroute.s.fogClock=0;advance(reroute.s,.1);
issueOrder(reroute.s,[reroute.u.id],{type:'explore'});advance(reroute.s,.1);
assert(placeBuilding(reroute.s,0,'reactor',24,28).ok,'The public construction command can block the planned route');
let detoured=false,crossed=false;
advance(reroute.s,15,()=>{detoured ||= reroute.u.y>=30;crossed ||= reroute.u.x>28;assert.equal(reroute.s.blocked[tile(reroute.s,reroute.u)],0,'Explorers never enter construction footprints');});
assert(detoured&&crossed,'Explorer replans through the open route around new construction');

// Armed explorers guard visible threats in range, then resume without chasing or seeing through fog.
for(const type of ['rifle','scout','tank','artillery']){
  const {s,u}=field(type),enemy={...structuredClone(u),id:s.nextId++,team:1,type:'harvester',size:UNITS.harvester.size,hp:10000,maxHp:10000,cargo:0,harvestPhase:'gather',order:{type:'harvest'},path:[],x:u.x+3};
  s.entities.push(enemy);s.fogClock=Infinity;s.visible[0].fill(1);
  issueOrder(s,[u.id],{type:'explore'});const origin={x:u.x,y:u.y},before=enemy.hp;advance(s,.2);
  assert(enemy.hp<before,`Exploring ${type} guards against a visible nearby enemy`);
  assert.deepEqual({x:u.x,y:u.y},origin,`${type} holds position while firing`);assert.equal(u.order.type,'explore');
  enemy.x=u.x+UNITS[type].range+2;u.cooldown=0;const distantHp=enemy.hp,unopposed=structuredClone(s);
  unopposed.entities=unopposed.entities.filter(e=>e.id!==enemy.id);advance(s,1);advance(unopposed,1);
  assert.equal(enemy.hp,distantHp,`${type} does not attack an out-of-range former target`);
  assert.deepEqual({x:u.x,y:u.y},{x:unopposed.entities[0].x,y:unopposed.entities[0].y},`${type} follows its exploration route without chasing a distant enemy`);
  assert(Math.hypot(u.x-origin.x,u.y-origin.y)>.3,`${type} resumes exploring after the nearby threat leaves`);
  enemy.x=u.x+3;enemy.y=u.y;s.visible[0].fill(0);u.cooldown=0;const concealedHp=enemy.hp;advance(s,.2);
  assert.equal(enemy.hp,concealedHp,`${type} must not shoot a concealed enemy while exploring`);
}

// A group order activates every selected unit and produces identical exploration for a fixed seed.
const group=field('scout',0,'explore-group');
for(const [index,type] of ['rifle','tank','harvester'].entries()){
  const u={...structuredClone(group.u),id:group.s.nextId++,type,hp:UNITS[type].hp,maxHp:UNITS[type].hp,size:UNITS[type].size,x:group.u.x+index+2,cargo:0,harvestPhase:'gather',path:[]};group.s.entities.push(u);
}
const duplicate=structuredClone(group.s),ids=group.s.entities.map(e=>e.id);
issueOrder(group.s,ids,{type:'explore'});issueOrder(duplicate,ids,{type:'explore'});
assert(group.s.entities.every(e=>e.order.type==='explore'),'Mixed selected groups all enter exploration');
advance(group.s,25);advance(duplicate,25);
assert.deepEqual(group.s.entities,duplicate.entities,'Exploration remains deterministic for matching commands and seed');
assert.deepEqual(group.s.explored,duplicate.explored);
console.log('Ashline exploration checks passed: automatic discovery, every unit and faction, cancellation, completion, inaccessible terrain, construction rerouting, fog-safe guarding, and deterministic group orders.');
