import assert from 'node:assert/strict';
import {UNITS,createGame,issueOrder,updateGame} from '../sim.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function scene(seed='formation'){
  const s=createGame(seed);s.ai.nextThink=Infinity;s.fogClock=Infinity;
  s.terrain.fill(0);s.minerals.fill(0);s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));
  const templates=Object.fromEntries(['rifle','harvester','refinery'].map(type=>[type,structuredClone(s.entities.find(e=>e.type===type))]));
  s.entities=[];s.navVersion++;
  const add=(type,x,y)=>{const d=UNITS[type],e={...structuredClone(templates[type==='harvester'?type:'rifle']),id:s.nextId++,type,size:d.size,hp:d.hp,maxHp:d.hp,x,y,order:{type:'idle'},path:[]};s.entities.push(e);return e;};
  return{s,add,refinery:templates.refinery};
}
const orders=units=>new Map(units.map(u=>[u.id,{x:u.order.x,y:u.order.y}]));
function checkGoals(s,units,goals){
  assert.equal(new Set([...goals.values()].map(p=>`${p.x},${p.y}`)).size,units.length,'Every mover owns a distinct destination');
  for(const u of units){const p=goals.get(u.id),r=u.size*.43+.08;
    assert(Number.isFinite(p.x+p.y));
    for(const dx of [-r,r])for(const dy of [-r,r])assert(p.x+dx>=0&&p.y+dy>=0&&p.x+dx<s.width&&p.y+dy<s.height&&!s.blocked[Math.floor(p.y+dy)*s.width+Math.floor(p.x+dx)],'Slots respect unit clearance, solid terrain and map edges');
    assert.equal(s.regions[Math.floor(p.y)*s.width+Math.floor(p.x)],s.regions[Math.floor(u.y)*s.width+Math.floor(u.x)],'A slot belongs to its unit’s reachable region');
  }
}
function run(s,seconds,each=()=>{}){for(let i=0;i<Math.ceil(seconds*20);i++){updateGame(s,.05);each(i);}}
function arrived(units,goals){
  for(const u of units){assert(distance(u,goals.get(u.id))<=.081,`${u.type}#${u.id} must reach its own slot (${distance(u,goals.get(u.id)).toFixed(3)} remaining)`);assert.equal(u.order.type,u.type==='harvester'?'harvest':'idle');}
  for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++)assert(distance(units[i],units[j])>=(units[i].size+units[j].size)*.43-.002,'Settled units retain full body separation');
}
function command(s,units,point,type='move'){
  issueOrder(s,units.map(u=>u.id),{type,...point});const goals=orders(units);checkGoals(s,units,goals);return goals;
}

// The full military/hauler cap settles, and refreshed/reordered selection cannot reshuffle slots.
function army(){
  const{s,add}=scene(),types=Object.keys(UNITS),units=Array.from({length:60},(_,i)=>add(types[i%types.length],20.5+i%6*1.1,20.5+Math.floor(i/6)*1.1));
  const point={x:45.23,y:38.71},goals=command(s,units,point);
  assert([...goals.values()].every(p=>distance(p,point)<5),'An open-field army stays near the click');
  units[0].trafficWait=.4;units[0].passUntil=s.time+1;
  issueOrder(s,units.map(u=>u.id).reverse(),{type:'move',...point});
  assert.equal(units[0].trafficWait,.4);assert.equal(units[0].passUntil,s.time+1);
  run(s,80,i=>{if(i<160&&i%20===0){issueOrder(s,units.map(u=>u.id).reverse(),{type:'move',...point});assert.deepEqual(orders(units),goals,'Repeated group orders preserve personal destinations');}});
  arrived(units,goals);return s;
}
const first=army(),second=army();assert.deepEqual(first.entities,second.entities);assert.equal(first.rng,second.rng,'Formation decisions remain deterministic');

// Selection order cannot send a nearby unit across a farther unit's route unnecessarily.
{
  const{s,add}=scene('assignment'),far=add('tank',20.5,25.5),near=add('rifle',40.5,25.5);
  const goals=command(s,[far,near],{x:40.5,y:25.5});assert.equal(distance(near,goals.get(near.id)),0);
  run(s,25);arrived([far,near],goals);
}

// A blocked click avoids rocks, lava, a real building and an already parked heavy unit.
{
  const{s,add,refinery}=scene('obstructed');refinery.x=90;refinery.y=72;s.entities.push(refinery);
  for(let y=73;y<=77;y++)for(let x=91;x<=95;x++)s.terrain[y*s.width+x]=(x+y)%2?1:3;
  const parked=add('tank',89.5,74.5),original={x:parked.x,y:parked.y};
  const units=Array.from({length:12},(_,i)=>add(Object.keys(UNITS)[i%6],82.5+i%4,73.5+Math.floor(i/4)));
  const goals=command(s,units,{x:92.4,y:74.3},'attackMove');
  for(const u of units)assert(distance(goals.get(u.id),parked)>(u.size+parked.size)*.43+.17);
  run(s,40);arrived(units,goals);assert(distance(parked,original)<.01,'Destination allocation leaves parked units in place');
}

// Formation clipping cannot collapse several units onto a map corner.
{
  const{s,add}=scene('edge'),units=Array.from({length:12},(_,i)=>add(i%2?'tank':'rifle',8.5+i%4,s.height-9.5+Math.floor(i/4)));
  const goals=command(s,units,{x:.01,y:s.height-.01});run(s,35);arrived(units,goals);
}

// A one-tile destination corridor expands the formation along its length, never into its walls.
{
  const{s,add}=scene('corridor');s.terrain.fill(1);for(let x=10;x<=70;x++)s.terrain[25*s.width+x]=0;
  const units=Array.from({length:12},(_,i)=>add(i%2?'artillery':'rifle',15.5+i,25.5));
  const goals=command(s,units,{x:55.3,y:25.4});assert([...goals.values()].every(p=>p.y===25.5));
  run(s,80);arrived(units,goals);
}

// Units on opposite sides of a solid wall get separate reachable destinations, even with one click.
{
  const{s,add}=scene('regions');for(let y=0;y<s.height;y++)s.terrain[y*s.width+72]=3;
  const units=Array.from({length:12},(_,i)=>add(i%2?'tank':'rocket',i<6?65.5+i%3:77.5+i%3,28.5+Math.floor(i/3)));
  const goals=command(s,units,{x:82.3,y:31.2});run(s,40);arrived(units,goals);
}

// New construction invalidates an old slot: reserve a new perimeter location instead of sharing A* fallback.
{
  const{s,add}=scene('changed-ground'),units=Array.from({length:8},(_,i)=>add('tank',20.5+i%4,25.5+Math.floor(i/4)));
  const old=command(s,units,{x:38.7,y:28.2});run(s,.2);
  for(const p of old.values())s.terrain[Math.floor(p.y)*s.width+Math.floor(p.x)]=1;s.navVersion++;
  run(s,.05);const goals=orders(units);checkGoals(s,units,goals);run(s,40);arrived(units,goals);
}

// A path node inside the destination cell is not enough: complete the fractional final segment.
{
  const{s,add}=scene('exact-final'),u=add('rifle',30.5,25.5),goals=command(s,[u],{x:33.13,y:27.79});run(s,8);arrived([u],goals);
}

// Impossible crowding has a finite fallback, without assigning several units one shared goal.
{
  const{s,add}=scene('no-space');s.terrain.fill(1);s.terrain[25*s.width+25]=0;
  const units=[add('rifle',25.3,25.5),add('rifle',25.7,25.5),add('rifle',25.5,25.5)];
  issueOrder(s,units.map(u=>u.id),{type:'move',x:40,y:40});
  assert.equal(units.filter(u=>u.order.type==='move').length,1);assert.equal(units.filter(u=>u.order.type==='idle').length,2);
}
console.log('Formation checks passed: 60 mixed units, deterministic repeated orders, exact arrivals, blocked/parked/edge/corridor/disconnected goals, changed ground, and finite crowding fallback.');
